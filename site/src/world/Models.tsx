// Landmark architecture and scattered props. Each district's buildings stream in as the camera approaches
// (placeholder blocks stand in from afar, so the fly-over still reads as a city, a keep, a stadium) and are
// dropped again once far away. Walkable sets (towns, the city block, the fortress) get their walls measured
// from the mesh so you can walk their streets.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { AVAILABLE_MODELS, REGIONS, type Landmark, type ModelName, type Region } from './regions'
import { heightAt } from './terrain'
import { scatterLayout, type ScatterName } from './layout'
import { boxCollider, circleCollider, landmarkKey, setLandmarkCollider, setLandmarkFloor, setScatterFactor, type Collider } from './colliders'
import { showLoader, trackManager } from '../lib/loader3d'
import { world } from './store'

export const modelUrl = (name: string) => `${import.meta.env.BASE_URL}world/models/${name}.glb`

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Baked-looking contact shading: vertices near the ground are darkened through a vertex colour, so buildings
 * sit into the terrain instead of floating on a flat lit base. Applied once per geometry (shared by clones).
 */
const shaded = new WeakSet<THREE.BufferGeometry>()
function groundShade(root: THREE.Object3D, height: number) {
  root.updateWorldMatrix(true, true)
  const band = Math.min(3.2, Math.max(0.8, height * 0.22))
  const v = new THREE.Vector3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const geo = m.geometry
    if (shaded.has(geo) || geo.attributes.color) return
    shaded.add(geo)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      const k = 0.5 + 0.5 * smoothstep(0, band, v.y)
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats) {
      mat.vertexColors = true
      mat.needsUpdate = true
    }
  })
}

/** Model scaled to `height` metres, centred on x/z, resting on y = 0. */
export function useModel(name: ModelName, height: number) {
  const gltf = useGLTF(modelUrl(name), false, true)
  return useMemo(() => {
    const root = gltf.scene.clone(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = height / Math.max(size.y, 1e-3)
    root.scale.setScalar(s)
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    const wrap = new THREE.Group()
    wrap.add(root)
    if (height >= 3) groundShade(wrap, height)
    return wrap
  }, [gltf, height])
}

const vtx = new THREE.Vector3()
const rel = new THREE.Matrix4()
const inv = new THREE.Matrix4()

/**
 * Ground footprint of a model in its own frame: the bounds of the vertices below `sliceTop`, so a
 * crane's jib or a tree's canopy doesn't inflate what you bump into at walking height.
 */
function baseFootprint(obj: THREE.Object3D, sliceTop: number) {
  obj.updateWorldMatrix(true, true)
  inv.copy(obj.matrixWorld).invert()
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  const xs: number[] = [], zs: number[] = []
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.attributes.position as THREE.BufferAttribute
    rel.multiplyMatrices(inv, m.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      vtx.fromBufferAttribute(pos, i).applyMatrix4(rel)
      if (vtx.y > sliceTop) continue
      minX = Math.min(minX, vtx.x)
      maxX = Math.max(maxX, vtx.x)
      minZ = Math.min(minZ, vtx.z)
      maxZ = Math.max(maxZ, vtx.z)
      xs.push(vtx.x)
      zs.push(vtx.z)
    }
  })
  if (!xs.length) return null
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  let rmax = 0
  for (let i = 0; i < xs.length; i++) rmax = Math.max(rmax, Math.hypot(xs[i] - cx, zs[i] - cz))
  return { cx, cz, hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2, rmax }
}

/* ---------- Walkable sets: walls and floors measured from the mesh ---------- */

const SET_CELL = 2
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()

/**
 * Rasterise the model's triangles into 2 m cells (in the landmark's frame, y up from its base). Steep faces between
 * knee and head height make a cell solid (a wall, a pillar, a parked cart); near-horizontal faces up to 6 m record
 * a floor (a courtyard, a quay, a terrace) you can stand on.
 */
function measureSet(obj: THREE.Object3D, groundY = 0) {
  obj.updateWorldMatrix(true, true)
  inv.copy(obj.matrixWorld).invert()
  const solid = new Map<string, [number, number]>()
  const floor = new Map<string, number>()
  const key = (x: number, z: number) => `${Math.floor(x / SET_CELL)},${Math.floor(z / SET_CELL)}`
  const markWall = (x: number, y: number, z: number) => {
    if (y < groundY + 0.35 || y > 18) return
    const k = key(x, z)
    const s = solid.get(k)
    if (!s) solid.set(k, [y, y])
    else {
      if (y < s[0]) s[0] = y
      if (y > s[1]) s[1] = y
    }
  }
  const markFloor = (x: number, y: number, z: number) => {
    if (y < groundY + 0.25 || y > 16) return
    const k = key(x, z)
    floor.set(k, Math.max(floor.get(k) ?? 0, y))
  }
  const tops = new Map<string, number>()
  const markTop = (x: number, y: number, z: number) => {
    const k = key(x, z)
    tops.set(k, Math.max(tops.get(k) ?? 0, y))
  }
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const geo = m.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const idx = geo.index
    rel.multiplyMatrices(inv, m.matrixWorld)
    const count = idx ? idx.count : pos.count
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2
      a.fromBufferAttribute(pos, i0).applyMatrix4(rel)
      b.fromBufferAttribute(pos, i1).applyMatrix4(rel)
      c.fromBufferAttribute(pos, i2).applyMatrix4(rel)
      const lo = Math.min(a.y, b.y, c.y), hi = Math.max(a.y, b.y, c.y)
      if (lo > 18.5) {
        markTop(a.x, hi, a.z)
        continue
      }
      e1.subVectors(b, a)
      e2.subVectors(c, a)
      n.crossVectors(e1, e2)
      const area2 = n.length()
      if (area2 < 1e-6) continue
      n.divideScalar(area2)
      const flat = Math.abs(n.y) > 0.6
      const mark = flat ? markFloor : markWall
      // Sample the triangle at about one point per 0.8 m.
      const longest = Math.max(e1.length(), e2.length(), b.distanceTo(c))
      const steps = Math.min(40, Math.max(1, Math.ceil(longest / 0.8)))
      for (let i = 0; i <= steps; i++)
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps, v = j / steps
          const x = a.x + e1.x * u + e2.x * v, y = a.y + e1.y * u + e2.y * v, z = a.z + e1.z * u + e2.z * v
          mark(x, y, z)
          markTop(x, y, z)
        }
    }
  })
  return { solid, floor, tops }
}

/* ---------- Placeholders ---------- */

const IMPOSTOR_MATS = new Map<string, THREE.MeshLambertMaterial>()
function impostorMaterial(accent: string) {
  let m = IMPOSTOR_MATS.get(accent)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(accent).multiplyScalar(0.4).lerp(new THREE.Color('#7d8089'), 0.75) })
    IMPOSTOR_MATS.set(accent, m)
  }
  return m
}

/** A plain block the size of the building, shown until (and while) the real model streams in. */
function Impostor({ region, l }: { region: Region; l: Landmark }) {
  if (l.ghost || (!l.foot && l.height < 6)) return null
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const y = heightAt(x, z)
  const [w, d] = l.foot ?? [l.height * 0.55, l.height * 0.55]
  return (
    <mesh position={[x, y + l.height * 0.42, z]} rotation={[0, ((l.rot ?? 0) * Math.PI) / 180, 0]} material={impostorMaterial(region.accent)}>
      <boxGeometry args={[w, l.height * 0.84, d]} />
    </mesh>
  )
}

/* ---------- Landmarks ---------- */

const loadedModels = new Set<string>()

function LandmarkModel({ region, l, index }: { region: Region; l: Landmark; index: number }) {
  const obj = useModel(l.model, l.height)
  const ref = useRef<THREE.Group>(null)
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const y = heightAt(x, z) + (l.lift ?? 0)
  useEffect(() => {
    if (!l.tint) return
    const tint = new THREE.Color(l.tint)
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const sm = mat as THREE.MeshStandardMaterial & { tinted?: boolean }
        if (sm.tinted || !sm.color) continue
        sm.tinted = true
        sm.color.multiply(tint)
      }
    })
  }, [obj, l.tint])
  const footprint = useMemo(() => (l.set || l.ghost ? null : baseFootprint(obj, Math.min(2.5, l.height * 0.35))), [obj, l.height, l.set, l.ghost])
  useEffect(() => {
    loadedModels.add(l.model)
    const st = (streamState[region.id] ??= { near: true, mounted: 0 })
    st.mounted++
    return () => {
      st.mounted--
    }
  }, [l.model, region.id])

  // Report the measured footprint so the player bumps into the building itself, not its flattened pad.
  useEffect(() => {
    if (l.ghost) {
      setLandmarkCollider(landmarkKey(region.id, index), null)
      return
    }
    const yaw = ((l.rot ?? 0) * Math.PI) / 180
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const toWorld = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c]
    if (l.set) {
      const { solid, floor, tops } = measureSet(obj, -(l.lift ?? 0))
      const list: Collider[] = []
      for (const [k, [lo, hi]] of solid) {
        const [gx, gz] = k.split(',').map(Number)
        const lx = (gx + 0.5) * SET_CELL, lz = (gz + 0.5) * SET_CELL
        const [wx, wz] = toWorld(lx, lz)
        // A wall that rises straight from a floor counts from that floor; the cell's top is its roof.
        const base = floor.get(k) ?? 0
        list.push(boxCollider(wx, wz, SET_CELL / 2, SET_CELL / 2, yaw, y + Math.max(hi, tops.get(k) ?? hi), y + Math.min(lo, base + 0.3)))
      }
      setLandmarkCollider(landmarkKey(region.id, index), list)
      setLandmarkFloor(landmarkKey(region.id, index), { x, z, y, yaw, cell: SET_CELL, floor })
      return
    }
    const f = footprint
    if (!f) return
    const [wx, wz] = toWorld(f.cx, f.cz)
    const avg = (f.hx + f.hz) / 2
    const top = y + l.height + (l.anim === 'float' ? 1.2 : 0)
    // Round bases (stills, silos, domes) get a circle; spinning ones too, sized to their sweep.
    const collider =
      l.anim === 'spin'
        ? circleCollider(x, z, Math.hypot(f.cx, f.cz) + f.rmax * 0.9, top)
        : f.rmax < avg * 1.18
          ? circleCollider(wx, wz, f.rmax * 0.92, top)
          : boxCollider(wx, wz, f.hx * 0.94, f.hz * 0.94, yaw, top)
    setLandmarkCollider(landmarkKey(region.id, index), [collider])
  }, [footprint, obj, x, y, z, l.rot, l.anim, l.height, l.set, l.ghost, l.lift, region.id, index])

  useFrame(({ clock }) => {
    const g = ref.current
    if (!g || !l.anim) return
    const t = clock.elapsedTime
    if (l.anim === 'spin') g.rotation.y = t * 0.6
    if (l.anim === 'float') g.position.y = y + 0.6 + Math.sin(t * 1.2) * 0.5
    if (l.anim === 'bob') g.rotation.z = Math.sin(t * 1.6) * 0.05
  })
  return (
    <group ref={ref} position={[x, y, z]} rotation={[0, ((l.rot ?? 0) * Math.PI) / 180, 0]}>
      <primitive object={obj} />
    </group>
  )
}

let readyAt = 0
function settled() {
  if (!world.get().assetsReady) return false
  if (!readyAt) readyAt = performance.now()
  return performance.now() - readyAt > 2500
}

/** Districts whose models have been asked for at least once this session (their URLs are in the loader cache). */
const entered = new Set<string>()
/** For tests (`?snap`): streaming state per district. */
export const streamState: Record<string, { near: boolean; mounted: number }> = {}
export const streamed = () => [...entered]

/**
 * One district: placeholders from afar; the real buildings once the camera is within the district's streaming
 * distance (with hysteresis, so a player pacing the boundary never thrashes the loader). The first time the explorer
 * walks into a district, the 3D loader covers the download; the fly-over streams silently behind the site.
 */
function District({ region }: { region: Region }) {
  const [near, setNear] = useState(false)
  const frame = useRef(0)
  useFrame(({ camera }) => {
    if (frame.current++ % 12 !== 0) return
    // The first paint is the harbour alone; the other districts wait until the island has settled.
    if (region.id !== 'hub' && !settled()) return
    const d = Math.hypot(camera.position.x - region.center[0], camera.position.z - region.center[1]) - region.radius * 0.5
    const far = region.stream + 90
    if (!near && d < region.stream) setNear(true)
    else if (near && d > far) setNear(false)
  })
  const st = (streamState[region.id] ??= { near: false, mounted: 0 })
  st.near = near
  useEffect(() => {
    if (!near || entered.has(region.id)) return
    entered.add(region.id)
    // Only the explorer sees the loader, and only when something will actually download.
    const fresh = region.landmarks.some((l) => AVAILABLE_MODELS.has(l.model) && !loadedModels.has(l.model))
    if (!world.get().playing || !fresh) return
    const h = showLoader({ status: `Entering ${region.name}…`, progress: null })
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      trackManager(h, ctrl.signal, 12000).then(() => {
        h.update({ progress: 1 })
        h.release()
      })
    }, 150)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
      h.release()
    }
  }, [near, region])

  const landmarks = region.landmarks.filter((l) => AVAILABLE_MODELS.has(l.model))
  return (
    <>
      {landmarks.map((l, i) =>
        near ? (
          <Suspense key={`${region.id}-${i}`} fallback={<Impostor region={region} l={l} />}>
            <LandmarkModel region={region} l={l} index={region.landmarks.indexOf(l)} />
          </Suspense>
        ) : (
          <Impostor key={`${region.id}-${i}`} region={region} l={l} />
        ),
      )}
    </>
  )
}

export function Landmarks() {
  return (
    <>
      {REGIONS.map((r) => (
        <District key={r.id} region={r} />
      ))}
    </>
  )
}

/* ---------- Scatter (instanced) ---------- */

function InstancedModel({ name, matrices }: { name: ModelName; matrices: THREE.Matrix4[] }) {
  const gltf = useGLTF(modelUrl(name), false, true)
  const parts = useMemo(() => {
    const scene = gltf.scene
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    // Normalise to 1 m tall, centred, resting on y = 0; per-instance scale then sets the height.
    const s = 1 / Math.max(size.y, 1e-3)
    const norm = new THREE.Matrix4().makeScale(s, s, s).premultiply(new THREE.Matrix4().makeTranslation(-center.x * s, -box.min.y * s, -center.z * s))
    const list: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }[] = []
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) list.push({ geometry: m.geometry, material: m.material, local: norm.clone().multiply(m.matrixWorld) })
    })
    return list
  }, [gltf])

  // Trunk/base radius as a fraction of height, from the vertices in the bottom tenth of the model.
  useEffect(() => {
    let r = 0
    for (const p of parts) {
      const pos = p.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        vtx.fromBufferAttribute(pos, i).applyMatrix4(p.local)
        if (vtx.y < 0.1) r = Math.max(r, Math.hypot(vtx.x, vtx.z))
      }
    }
    if (r > 0) setScatterFactor(name, THREE.MathUtils.clamp(r * 0.9, 0.04, 0.3))
  }, [parts, name])

  return (
    <>
      {parts.map((p, i) => (
        <InstancedPart key={i} geometry={p.geometry} material={p.material} local={p.local} matrices={matrices} />
      ))}
    </>
  )
}

function InstancedPart({
  geometry,
  material,
  local,
  matrices,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  local: THREE.Matrix4
  matrices: THREE.Matrix4[]
}) {
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geometry, material, matrices.length)
    const m = new THREE.Matrix4()
    matrices.forEach((mat, i) => im.setMatrixAt(i, m.copy(mat).multiply(local)))
    im.castShadow = true
    im.receiveShadow = true
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    return im
  }, [geometry, material, local, matrices])
  return <primitive object={mesh} />
}

const ROCK = new THREE.DodecahedronGeometry(0.6, 0)
const BUSH = new THREE.IcosahedronGeometry(0.6, 0)
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#8a8379', roughness: 0.95, flatShading: true })
const BUSH_MAT = new THREE.MeshStandardMaterial({ color: '#4f8f3c', roughness: 0.9, flatShading: true })

function InstancedPrimitive({ kind, matrices }: { kind: 'rock' | 'bush'; matrices: THREE.Matrix4[] }) {
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(kind === 'rock' ? ROCK : BUSH, kind === 'rock' ? ROCK_MAT : BUSH_MAT, matrices.length)
    const lift = new THREE.Matrix4().makeTranslation(0, 0.35, 0)
    matrices.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(lift)))
    im.castShadow = true
    im.receiveShadow = true
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    return im
  }, [kind, matrices])
  return <primitive object={mesh} />
}

/** Side of the square chunks props are batched in: each chunk is frustum-culled on its own (camera and shadows). */
const CHUNK = 110

/** Split each model's instances into spatial chunks, one instanced mesh per (model, chunk). */
function chunkLayout() {
  const out: { key: string; name: ScatterName; matrices: THREE.Matrix4[] }[] = []
  for (const [name, matrices] of scatterLayout()) {
    const byCell = new Map<string, THREE.Matrix4[]>()
    for (const m of matrices) {
      const cell = `${Math.floor(m.elements[12] / CHUNK)},${Math.floor(m.elements[14] / CHUNK)}`
      const list = byCell.get(cell) ?? []
      list.push(m)
      byCell.set(cell, list)
    }
    for (const [cell, list] of byCell) out.push({ key: `${name}:${cell}`, name, matrices: list })
  }
  return out
}

export function Scatters() {
  const chunks = useMemo(chunkLayout, [])

  return (
    <>
      {chunks.map(({ key, name, matrices }) =>
        name === 'rock' || name === 'bush' ? (
          <InstancedPrimitive key={key} kind={name} matrices={matrices} />
        ) : (
          <Suspense key={key} fallback={null}>
            <InstancedModel name={name as ModelName} matrices={matrices} />
          </Suspense>
        ),
      )}
    </>
  )
}
