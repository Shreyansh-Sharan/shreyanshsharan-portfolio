// Landmark architecture and scattered props. Each district's buildings stream in as the camera approaches
// (placeholder blocks stand in from afar, so the fly-over still reads as a city, a keep, a stadium) and are
// dropped again once far away. Walkable sets (towns, the city block, the fortress) get their walls measured
// from the mesh so you can walk their streets.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { AVAILABLE_MODELS, REGIONS, type Landmark, type ModelName, type Region } from './regions'
import { heightAt } from './terrain'
import { scatterLayout, type ScatterName } from './layout'
import { boxCollider, circleCollider, groundAt, landmarkKey, setLandmarkCollider, setLandmarkFloor, setScatterFactor, type Collider } from './colliders'
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

/* ---------- Grounding ---------- */

/**
 * Where a model's base goes: the lowest terrain under its measured base footprint (centre, corners and edge
 * midpoints), sunk a little (more for buildings) so slopes never show a gap under a wall.
 */
function groundUnder(obj: THREE.Object3D, x: number, z: number, yaw: number, height: number) {
  const f = baseFootprint(obj, 0.4)
  const sink = height >= 3 ? 0.3 : 0.05
  if (!f) return heightAt(x, z) - sink
  const c = Math.cos(yaw), s = Math.sin(yaw)
  let h = Infinity
  for (const u of [-1, 0, 1])
    for (const v of [-1, 0, 1]) {
      const lx = f.cx + u * f.hx, lz = f.cz + v * f.hz
      h = Math.min(h, heightAt(x + lx * c + lz * s, z - lx * s + lz * c))
    }
  return h - sink
}

/** Every placed model by key, for the `?snap` grounding check (see groundReport). */
export const placed = new Map<string, { name: string; region: string; obj: THREE.Object3D; buried?: boolean }>()

/**
 * For tests: every placed model whose base floats above the ground (or the floor of a room) anywhere under its
 * footprint by more than 0.15 m, or is buried by more than 1 m. Trees and props scattered by layout.ts are checked too.
 */
export function groundReport(extra: Iterable<{ name: string; region: string; obj: THREE.Object3D }> = []) {
  const out: { name: string; region: string; float: number; buried: number }[] = []
  const v = new THREE.Vector3()
  const toLocal = new THREE.Matrix4()
  let checked = 0
  for (const p of [...placed.values(), ...extra]) {
    p.obj.updateWorldMatrix(true, true)
    toLocal.copy(p.obj.matrixWorld).invert()
    // Vertices in the model's own frame (so a rotated footprint is sampled along its own sides), and its base height.
    const local: THREE.Vector3[] = []
    let minY = Infinity
    p.obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const pos = m.geometry.attributes.position as THREE.BufferAttribute
      const step = Math.max(1, Math.floor(pos.count / 4000))
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
        if (v.y < minY) minY = v.y
        local.push(v.clone().applyMatrix4(toLocal))
      }
    })
    if (!local.length) continue
    checked++
    let lowY = Infinity
    for (const q of local) lowY = Math.min(lowY, q.y)
    // The base: everything within 0.4 m of the lowest point; its footprint corners, edges and centre are sampled.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    const scale = new THREE.Vector3().setFromMatrixScale(p.obj.matrixWorld).y || 1
    for (const q of local)
      if (q.y < lowY + 0.4 / scale) {
        x0 = Math.min(x0, q.x)
        x1 = Math.max(x1, q.x)
        z0 = Math.min(z0, q.z)
        z1 = Math.max(z1, q.z)
      }
    // Rooms stand on their floor; everything else on the terrain (not on its own measured terraces).
    const indoors = p.region === 'room'
    let float = -Infinity, buried = -Infinity
    for (const sx of [x0, (x0 + x1) / 2, x1])
      for (const sz of [z0, (z0 + z1) / 2, z1]) {
        v.set(sx, lowY, sz).applyMatrix4(p.obj.matrixWorld)
        const g = indoors ? groundAt(v.x, v.z, minY + 0.5) : heightAt(v.x, v.z)
        float = Math.max(float, minY - g)
        buried = Math.max(buried, g - minY)
      }
    const deep = 'buried' in p && p.buried
    if (float > 0.15 || (!deep && buried > 1)) out.push({ name: p.name, region: p.region, float: +float.toFixed(2), buried: +buried.toFixed(2) })
  }
  for (const check of scatterChecks.values()) {
    const r = check()
    checked += r.checked
    out.push(...r.bad)
  }
  return { checked, bad: out }
}

/** Per scattered model (one per instanced chunk): checks every instance's base against the terrain. */
const scatterChecks = new Map<string, () => { checked: number; bad: { name: string; region: string; float: number; buried: number }[] }>()

/** Other instanced dressing (fences, walls, the scarecrows) reports its own grounding check here. */
export function registerGroundCheck(key: string, check: (() => { checked: number; bad: { name: string; region: string; float: number; buried: number }[] }) | null) {
  if (check) scatterChecks.set(key, check)
  else scatterChecks.delete(key)
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

/* ---------- Stands: stepped seating you can climb ---------- */

const STAND_CELL = 1

/**
 * The treads of a grandstand in 1 m cells (landmark frame): the lowest upward-facing surface in each cell, below the
 * roof. Rows rise a few tens of centimetres per cell, so the floor lookup steps the player up them one at a time.
 */
function measureStand(obj: THREE.Object3D, height: number) {
  obj.updateWorldMatrix(true, true)
  inv.copy(obj.matrixWorld).invert()
  const floor = new Map<string, number>()
  const roof = height * 0.8
  const key = (x: number, z: number) => `${Math.floor(x / STAND_CELL)},${Math.floor(z / STAND_CELL)}`
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const geo = m.geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    const idx = geo.index
    rel.multiplyMatrices(inv, m.matrixWorld)
    const count = idx ? idx.count : pos.count
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(rel)
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(rel)
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(rel)
      if (Math.max(a.y, b.y, c.y) > roof) continue
      e1.subVectors(b, a)
      e2.subVectors(c, a)
      n.crossVectors(e1, e2)
      const len = n.length()
      if (len < 1e-6 || n.y / len < 0.55) continue
      const longest = Math.max(e1.length(), e2.length(), b.distanceTo(c))
      const steps = Math.min(30, Math.max(1, Math.ceil(longest / 0.4)))
      for (let i = 0; i <= steps; i++)
        for (let j = 0; j <= steps - i; j++) {
          const u = i / steps, v = j / steps
          const y = a.y + e1.y * u + e2.y * v
          if (y < 0.2) continue
          const k = key(a.x + e1.x * u + e2.x * v, a.z + e1.z * u + e2.z * v)
          const f = floor.get(k)
          if (f === undefined || y < f) floor.set(k, y)
        }
    }
  })
  // The front row sits on a low wall: make its tread one easy step from the ground.
  for (const [k, h] of floor) if (h > 1.1 && h < 2.2) floor.set(k, 1.1)
  return floor
}

/* ---------- Passages: the lining of an opening cut through a shell ---------- */

const LINING = new THREE.MeshStandardMaterial({ color: '#4a4f5c', roughness: 0.9, side: THREE.DoubleSide })

const PORTAL = new THREE.MeshStandardMaterial({ color: '#2f5fb3', roughness: 0.6, metalness: 0.2 })

function PassageLining({ half, top, z0, z1 }: { half: number; top: number; z0: number; z1: number }) {
  const len = z1 - z0, mid = (z0 + z1) / 2
  return (
    <group>
      {/* A clean frame round each mouth of the opening. */}
      {[z0, z1].map((z) => (
        <group key={z} position={[0, 0, z]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (half + 0.35), top / 2 + 0.2, 0]} material={PORTAL}>
              <boxGeometry args={[0.7, top + 0.4, 0.7]} />
            </mesh>
          ))}
          <mesh position={[0, top + 0.35, 0]} material={PORTAL}>
            <boxGeometry args={[half * 2 + 1.4, 0.7, 0.7]} />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * half, top / 2, mid]} rotation={[0, Math.PI / 2, 0]} material={LINING}>
          <planeGeometry args={[len, top]} />
        </mesh>
      ))}
      <mesh position={[0, top, mid]} rotation={[Math.PI / 2, 0, 0]} material={LINING}>
        <planeGeometry args={[half * 2, len]} />
      </mesh>
      <pointLight position={[0, top - 0.6, mid]} color="#fff1d0" intensity={5} distance={len + 6} />
    </group>
  )
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

/** Buildings with a distant version in world/models/far: a few hundred triangles, colours baked into the vertices. */
const FAR = new Set<string>(
  ('castle-arcade city-brownstone city-corner city-deco-tower city-glass-tower cyber-shop cyber-tower scifi-tower fish-market ' +
    'fisher-house harbour-townhouse tavern lighthouse village-cottage village-forge village-stonehouse fortress-gate fortress-keep ' +
    'fortress-tower fortress-wall fortress-pillar temple shipwreck burrow-house cabin windmill distillery silos warehouse observatory ' +
    'clock-tower lab crane neon-tower portal crystals metal-bridge corner-shop retail-infill metro-headhouse neon-storefront ' +
    'media-facade stadium-bowl floodlight giant-billboard hotel-neon-blade metro-train ai-core pot-still drone-bot hover-car tree-oak ' +
    'tree-birch tree-round tree-poplar tree-fir tree-fir-wide autumn-tree pine palm').split(' '),
)
const farUrl = (name: string) => `${import.meta.env.BASE_URL}world/models/far/${name}.glb`
// Faceted and a touch cool, so the skyline reads through the haze without competing with what's close.
const FAR_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#dde2ea' })

function FarModel({ region, l }: { region: Region; l: Landmark }) {
  const gltf = useGLTF(farUrl(l.model), false, true)
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const yaw = ((l.rot ?? 0) * Math.PI) / 180
  const [obj, y] = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.material = FAR_MAT
    })
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = l.height / Math.max(size.y, 1e-3)
    root.scale.setScalar(s)
    root.position.set(-center.x * s, -box.min.y * s, -center.z * s)
    const wrap = new THREE.Group()
    wrap.add(root)
    return [wrap, groundUnder(wrap, x, z, yaw, l.height) + (l.lift ?? 0)] as const
  }, [gltf, l.height, l.lift, x, z, yaw])
  return <primitive object={obj} position={[x, y, z]} rotation={[0, yaw, 0]} />
}

/** A plain block the size of the building: the stand-in for the moment before its far version arrives. */
function ImpostorBox({ region, l }: { region: Region; l: Landmark }) {
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const y = heightAt(x, z)
  const [w, d] = l.foot ?? [l.height * 0.55, l.height * 0.55]
  return (
    <mesh position={[x, y + l.height * 0.42, z]} rotation={[0, ((l.rot ?? 0) * Math.PI) / 180, 0]} material={impostorMaterial(region.accent)}>
      <boxGeometry args={[w, l.height * 0.84, d]} />
    </mesh>
  )
}

/** What a district shows from afar, and while its real models stream in: the far version (a few KB), a block until it arrives. */
function Impostor({ region, l }: { region: Region; l: Landmark }) {
  // Street furniture (lamps, signs) has no far version: too slight to read at a distance, and a block would look wrong.
  if (l.ghost || l.lod === 'near' || !FAR.has(l.model) || (!l.foot && l.height < 6)) return null
  const box = <ImpostorBox region={region} l={l} />
  return (
    <Suspense fallback={box}>
      <FarModel region={region} l={l} />
    </Suspense>
  )
}

/* ---------- Skyline towers ---------- */

/** A tower of the neon skyline: one of the generated towers stretched to a block, its roof at `top`. */
export type Tower = { name: ModelName; x: number; z: number; w: number; d: number; top: number; roof: number }

/** Parts of a model normalised to a 1 x 1 x 1 box resting on y = 0 (instances then scale it to their block). */
function boxParts(scene: THREE.Object3D, far: boolean): Part[] {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const norm = new THREE.Matrix4()
    .makeScale(1 / Math.max(size.x, 1e-3), 1 / Math.max(size.y, 1e-3), 1 / Math.max(size.z, 1e-3))
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z))
  const list: Part[] = []
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) list.push({ geometry: m.geometry, material: far ? FAR_MAT : m.material, local: norm.clone().multiply(m.matrixWorld) })
  })
  return list
}

function towerMatrices(list: Tower[]) {
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
  return list.map((t) => {
    // Set down on the lowest ground under the block, a little sunk; stretched so the roof stays at `top`.
    let g = heightAt(t.x, t.z)
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g = Math.min(g, heightAt(t.x + (u * t.w) / 2, t.z + (v * t.d) / 2))
    const y = g - 0.3
    return new THREE.Matrix4().compose(p.set(t.x, y, t.z), q, sc.set(t.w, (t.top - y) / t.roof, t.d))
  })
}

function TowerDetail({ name, matrices }: { name: ModelName; matrices: THREE.Matrix4[] }) {
  const gltf = useGLTF(modelUrl(name), false, true)
  const parts = useMemo(() => boxParts(gltf.scene, false), [gltf])
  return (
    <>
      {parts.map((p, i) => (
        <InstancedPart key={i} geometry={p.geometry} material={p.material} local={p.local} matrices={matrices} />
      ))}
    </>
  )
}

function TowerKind({ name, list, detailed }: { name: ModelName; list: Tower[]; detailed: boolean }) {
  const gltf = useGLTF(farUrl(name), false, true)
  const farParts = useMemo(() => boxParts(gltf.scene, true), [gltf])
  const matrices = useMemo(() => towerMatrices(list), [list])
  const far = (
    <>
      {farParts.map((p, i) => (
        <InstancedPart key={i} geometry={p.geometry} material={p.material} local={p.local} matrices={matrices} shadow={false} />
      ))}
    </>
  )
  if (!detailed) return far
  return (
    <Suspense fallback={far}>
      <TowerDetail name={name} matrices={matrices} />
    </Suspense>
  )
}

/** The skyline as instanced towers: far versions from across the island, the full models once the camera is close. */
export function SkylineTowers({ towers, detailed, fallback }: { towers: Tower[]; detailed: boolean; fallback: React.ReactNode }) {
  const kinds = useMemo(() => {
    const by = new Map<ModelName, Tower[]>()
    for (const t of towers) by.set(t.name, [...(by.get(t.name) ?? []), t])
    return [...by]
  }, [towers])
  return (
    <Suspense fallback={fallback}>
      {kinds.map(([name, list]) => (
        <TowerKind key={name} name={name} list={list} detailed={detailed} />
      ))}
    </Suspense>
  )
}

/* ---------- Landmarks ---------- */

const loadedModels = new Set<string>()

function LandmarkModel({ region, l, index }: { region: Region; l: Landmark; index: number }) {
  const obj = useModel(l.model, l.height)
  const ref = useRef<THREE.Group>(null)
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const y = useMemo(() => groundUnder(obj, x, z, ((l.rot ?? 0) * Math.PI) / 180, l.height) + (l.lift ?? 0), [obj, x, z, l.rot, l.height, l.lift])
  useEffect(() => {
    if (l.ghost || l.anim === 'float') return
    const key = landmarkKey(region.id, index)
    placed.set(key, { name: l.model, region: region.id, obj, buried: (l.lift ?? 0) < -0.6 })
    return () => {
      placed.delete(key)
    }
  }, [obj, l.model, l.ghost, l.anim, l.lift, region.id, index])
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
  const footprint = useMemo(() => (l.set || l.ghost || l.stand ? null : baseFootprint(obj, Math.min(2.5, l.height * 0.35))), [obj, l.height, l.set, l.ghost, l.stand])
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
    if (l.stand) {
      // Treads are floors; a tread too high to step onto from the ground is solid below its step height, so you
      // climb the rows from the front instead of walking into the stand from behind or below.
      const floor = measureStand(obj, l.height)
      const list: Collider[] = []
      for (const [k, h] of floor) {
        if (h <= 1.2) continue
        const [gx, gz] = k.split(',').map(Number)
        const [wx, wz] = toWorld((gx + 0.5) * STAND_CELL, (gz + 0.5) * STAND_CELL)
        list.push(boxCollider(wx, wz, STAND_CELL / 2, STAND_CELL / 2, yaw, y + h - 1.2))
      }
      setLandmarkCollider(landmarkKey(region.id, index), list)
      setLandmarkFloor(landmarkKey(region.id, index), { x, z, y, yaw, cell: STAND_CELL, floor })
      return () => setLandmarkFloor(landmarkKey(region.id, index), null)
    }
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
    if (l.passage) {
      // Solid either side of the opening, clear through the middle.
      const [pw] = l.passage
      const list: Collider[] = []
      for (const sgn of [-1, 1]) {
        const inner = sgn * pw, outer = f.cx + sgn * f.hx
        const half = Math.abs(outer - inner) / 2
        if (half < 0.2) continue
        const [wx, wz] = toWorld((inner + outer) / 2, f.cz)
        list.push(boxCollider(wx, wz, half, f.hz, yaw, y + l.height))
      }
      setLandmarkCollider(landmarkKey(region.id, index), list)
      return
    }
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
  }, [footprint, obj, x, y, z, l.rot, l.anim, l.height, l.set, l.ghost, l.lift, l.stand, l.passage, region.id, index])

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
      {l.passage?.[2] && footprint && <PassageLining half={l.passage[0]} top={l.passage[1]} z0={footprint.cz - footprint.hz} z1={footprint.cz + footprint.hz} />}
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
  // Far stand-ins (a closed stadium bowl) load only once the island has settled, so they never weigh on first paint.
  const [farReady, setFarReady] = useState(false)
  const frame = useRef(0)
  useFrame(({ camera }) => {
    if (frame.current++ % 12 !== 0) return
    if (!farReady && settled()) setFarReady(true)
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
    // Streaming starts well before the district's edge: only cover the screen when the explorer is already inside it
    // (a teleport, the airship); walking up to it, the buildings stream in silently over the placeholders.
    const me = world.get().player
    if (Math.hypot(me.x - region.center[0], me.z - region.center[1]) > region.radius * 1.1) return
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
        l.lod === 'far' ? (
          !near && farReady ? (
            <Suspense key={`${region.id}-${i}`} fallback={null}>
              <LandmarkModel region={region} l={l} index={region.landmarks.indexOf(l)} />
            </Suspense>
          ) : null
        ) : near ? (
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

/* ---------- Foliage: wind, levels of detail, culling ---------- */

/** Shared wind clock for every swaying instanced model. */
const wind = { value: 0 }

/** Sway (metres at the top) per model; trees bend gently, ferns and reeds more. */
const SWAY: Partial<Record<ScatterName, number>> = {
  'tree-oak': 0.22, 'tree-birch': 0.3, 'tree-round': 0.2, 'tree-poplar': 0.3, 'tree-fir': 0.25, 'tree-fir-wide': 0.25, pine: 0.2,
  palm: 0.35, 'autumn-tree': 0.18, fern: 0.08, reeds: 0.18, 'bush-bloom': 0.04,
}
/** Far versions swapped in beyond LOD_DIST. */
const LOD: Partial<Record<ScatterName, ModelName>> = {
  'tree-oak': 'tree-oak-lod', 'tree-birch': 'tree-birch-lod', 'tree-round': 'tree-round-lod', 'tree-poplar': 'tree-poplar-lod',
  'tree-fir': 'tree-fir-lod', 'tree-fir-wide': 'tree-fir-wide-lod',
}
const LOD_DIST = 170
/** Wide, low things (a log, a boulder pile) get a footprint as wide as they really are. */
const MAX_FACTOR: Partial<Record<ScatterName, number>> = { log: 2.2, 'rock-cluster': 0.75 }
/** Small foliage is only drawn within this distance of the camera (per 110 m chunk, measured to its centre). */
const CULL: Partial<Record<ScatterName, number>> = { fern: 150, reeds: 170, 'bush-bloom': 190, mushroom: 110, pebble: 110, log: 220, 'rock-cluster': 260 }
/** Small things neither cast shadows nor need them (cheap). */
const NO_SHADOW = new Set<ScatterName>(['fern', 'reeds', 'mushroom', 'pebble', 'bush-bloom'])
/** Foliage that streams in once the island has settled (never part of the first paint). */
export const LATE = new Set<ScatterName>(['fern', 'reeds', 'log', 'rock-cluster', 'bush-bloom', 'mushroom', 'pebble'])

const swayCache = new Map<string, THREE.Material>()
/** A copy of a material that bends with the wind: the higher above the instance's base, the further it sways. */
function swaying(mat: THREE.Material, key: string, amp: number, localH: number) {
  const k = `${key}:${mat.uuid}`
  let m = swayCache.get(k)
  if (m) return m
  m = mat.clone()
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind
    shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
float hN = clamp((mvPosition.y - instanceMatrix[3].y) / max(0.001, length(instanceMatrix[1].xyz) * ${localH.toFixed(4)}), 0.0, 1.2);
float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
float sw = hN * hN * ${amp.toFixed(3)} * (0.75 + 0.25 * sin(uWind * 0.31 + ph * 0.1));
mvPosition.x += sin(uWind * 1.3 + ph) * sw;
mvPosition.z += cos(uWind * 1.05 + ph * 1.3) * sw * 0.7;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
    )
    // A branch right in front of the camera (walking under a canopy) is cut away instead of filling the screen.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  if (length(vViewPosition) < 2.6) discard;`,
    )
  }
  m.customProgramCacheKey = () => `sway-${amp}-${localH.toFixed(3)}`
  swayCache.set(k, m)
  return m
}

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }

/** Normalise a model to 1 m tall, centred, resting on y = 0 (per-instance scale then sets the height). */
function partsOf(scene: THREE.Object3D, name: ScatterName): Part[] {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const s = 1 / Math.max(size.y, 1e-3)
  const norm = new THREE.Matrix4().makeScale(s, s, s).premultiply(new THREE.Matrix4().makeTranslation(-center.x * s, -box.min.y * s, -center.z * s))
  const list: Part[] = []
  const amp = SWAY[name]
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const sy = new THREE.Vector3().setFromMatrixScale(m.matrixWorld).y || 1
    const localH = size.y / sy
    const material = amp ? (Array.isArray(m.material) ? m.material.map((x) => swaying(x, name, amp, localH)) : swaying(m.material, name, amp, localH)) : m.material
    list.push({ geometry: m.geometry, material, local: norm.clone().multiply(m.matrixWorld) })
  })
  return list
}

function InstancedModel({ name, matrices }: { name: ModelName; matrices: THREE.Matrix4[] }) {
  const lodName = LOD[name]
  const gltf = useGLTF(modelUrl(name), false, true)
  const lodGltf = useGLTF(modelUrl(lodName ?? name), false, true)
  const lodParts = useMemo(() => (lodName ? partsOf(lodGltf.scene, name) : null), [lodGltf, lodName, name])
  const nearRef = useRef<THREE.Group>(null)
  const farRef = useRef<THREE.Group>(null)
  const centre = useMemo(() => {
    const c = new THREE.Vector3()
    for (const m of matrices) c.add(new THREE.Vector3(m.elements[12], m.elements[13], m.elements[14]))
    return c.divideScalar(Math.max(1, matrices.length))
  }, [matrices])
  const tick = useRef(Math.floor(Math.random() * 15))
  const cull = CULL[name]
  useFrame(({ camera }) => {
    if (tick.current++ % 15 !== 0) return
    const d = Math.hypot(camera.position.x - centre.x, camera.position.z - centre.z) - CHUNK * 0.5
    const shown = cull === undefined || d < cull
    if (nearRef.current) nearRef.current.visible = shown && (!lodParts || d < LOD_DIST)
    if (farRef.current) farRef.current.visible = shown && !!lodParts && d >= LOD_DIST
  })
  const parts = useMemo(() => partsOf(gltf.scene, name), [gltf, name])

  // The model's base footprint (vertices in the bottom 4 cm of the 1 m model): every instance is set down on the
  // lowest ground under it (corners, edges and centre), a little sunk, so no root flare floats on a slope.
  const base = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const p of parts) {
      const pos = p.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        vtx.fromBufferAttribute(pos, i).applyMatrix4(p.local)
        if (vtx.y > 0.04) continue
        x0 = Math.min(x0, vtx.x)
        x1 = Math.max(x1, vtx.x)
        z0 = Math.min(z0, vtx.z)
        z1 = Math.max(z1, vtx.z)
      }
    }
    return x0 > x1 ? null : { xs: [x0, (x0 + x1) / 2, x1], zs: [z0, (z0 + z1) / 2, z1] }
  }, [parts])
  const grounded = useMemo(() => {
    if (!base) return matrices
    const w = new THREE.Vector3()
    return matrices.map((m) => {
      let g = Infinity
      for (const sx of base.xs)
        for (const sz of base.zs) {
          w.set(sx, 0, sz).applyMatrix4(m)
          g = Math.min(g, heightAt(w.x, w.z))
        }
      const out = m.clone()
      out.elements[13] = g - 0.15
      return out
    })
  }, [base, matrices])

  // For the grounding check.
  useEffect(() => {
    if (!base) return
    const key = `${name}:${matrices.length}:${matrices[0]?.elements[12] ?? 0}`
    scatterChecks.set(key, () => {
      const bad: { name: string; region: string; float: number; buried: number }[] = []
      const w = new THREE.Vector3()
      for (const m of grounded) {
        const baseY = w.set(base.xs[1], 0, base.zs[1]).applyMatrix4(m).y
        let float = -Infinity, buried = -Infinity
        for (const sx of base.xs)
          for (const sz of base.zs) {
            w.set(sx, 0, sz).applyMatrix4(m)
            const g = heightAt(w.x, w.z)
            float = Math.max(float, baseY - g)
            buried = Math.max(buried, g - baseY)
          }
        if (float > 0.15 || buried > 1) bad.push({ name, region: `scatter@${m.elements[12].toFixed(0)},${m.elements[14].toFixed(0)}`, float: +float.toFixed(2), buried: +buried.toFixed(2) })
      }
      return { checked: grounded.length, bad }
    })
    return () => {
      scatterChecks.delete(key)
    }
  }, [base, grounded, name, matrices])

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
    if (r > 0) setScatterFactor(name, THREE.MathUtils.clamp(r * 0.9, 0.04, MAX_FACTOR[name] ?? 0.3))
  }, [parts, name])

  const shadow = !NO_SHADOW.has(name)
  return (
    <>
      <group ref={nearRef}>
        {parts.map((p, i) => (
          <InstancedPart key={i} geometry={p.geometry} material={p.material} local={p.local} matrices={grounded} shadow={shadow} />
        ))}
      </group>
      {lodParts && (
        <group ref={farRef} visible={false}>
          {lodParts.map((p, i) => (
            <InstancedPart key={i} geometry={p.geometry} material={p.material} local={p.local} matrices={grounded} shadow={shadow} />
          ))}
        </group>
      )}
    </>
  )
}

function InstancedPart({
  geometry,
  material,
  local,
  matrices,
  shadow = true,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  local: THREE.Matrix4
  matrices: THREE.Matrix4[]
  shadow?: boolean
}) {
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geometry, material, matrices.length)
    const m = new THREE.Matrix4()
    matrices.forEach((mat, i) => im.setMatrixAt(i, m.copy(mat).multiply(local)))
    im.castShadow = shadow
    im.receiveShadow = true
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    return im
  }, [geometry, material, local, matrices, shadow])
  return <primitive object={mesh} />
}

const ROCK = new THREE.DodecahedronGeometry(0.6, 0)
const BUSH = new THREE.IcosahedronGeometry(0.6, 0)
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: '#8a8379', roughness: 0.95, flatShading: true })
const BUSH_MAT = new THREE.MeshStandardMaterial({ color: '#4f8f3c', roughness: 0.9, flatShading: true })

/** A toadstool: pale stem, red spotted cap (vertex coloured). */
function mushroomGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    g.deleteAttribute('uv')
    return g.index ? g.toNonIndexed() : g
  }
  const stem = new THREE.CylinderGeometry(0.06, 0.08, 0.32, 6)
  stem.translate(0, 0.16, 0)
  parts.push(paint(stem, '#efe6d2'))
  const cap = new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)
  cap.scale(1, 0.7, 1)
  cap.translate(0, 0.3, 0)
  parts.push(paint(cap, '#d8432f'))
  for (let i = 0; i < 4; i++) {
    const dot = new THREE.SphereGeometry(0.035, 4, 3)
    const a = i * 1.7
    dot.translate(Math.cos(a) * 0.11, 0.41, Math.sin(a) * 0.11)
    parts.push(paint(dot, '#fff7ea'))
  }
  // A second, smaller one beside it.
  const s2 = mergeGeometries(parts.map((g) => g.clone()))!
  s2.scale(0.6, 0.6, 0.6)
  s2.translate(0.22, 0, 0.1)
  return mergeGeometries([...parts, s2])!
}

const MUSHROOM = mushroomGeometry()
/** Three pebbles in a little scatter. */
const PEBBLE = (() => {
  const gs: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const g = new THREE.DodecahedronGeometry(0.12 + i * 0.04, 0)
    g.scale(1.3, 0.55, 1)
    g.translate(Math.cos(i * 2.2) * 0.25, 0.04, Math.sin(i * 2.2) * 0.25)
    g.deleteAttribute('uv')
    gs.push(g)
  }
  return mergeGeometries(gs)!
})()
const MUSHROOM_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })
const PEBBLE_MAT = new THREE.MeshStandardMaterial({ color: '#9a948b', roughness: 0.95, flatShading: true })

type PrimitiveKind = 'rock' | 'bush' | 'mushroom' | 'pebble'
const PRIMS: Record<PrimitiveKind, { geo: THREE.BufferGeometry; mat: THREE.Material; lift: number; shadow: boolean }> = {
  rock: { geo: ROCK, mat: ROCK_MAT, lift: 0.35, shadow: true },
  bush: { geo: BUSH, mat: BUSH_MAT, lift: 0.35, shadow: true },
  mushroom: { geo: MUSHROOM, mat: MUSHROOM_MAT, lift: 0, shadow: false },
  pebble: { geo: PEBBLE, mat: PEBBLE_MAT, lift: 0, shadow: false },
}
export const PRIMITIVES = new Set<string>(Object.keys(PRIMS))

function InstancedPrimitive({ kind, matrices }: { kind: PrimitiveKind; matrices: THREE.Matrix4[] }) {
  const spec = PRIMS[kind]
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(spec.geo, spec.mat, matrices.length)
    const lift = new THREE.Matrix4().makeTranslation(0, spec.lift, 0)
    matrices.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(lift)))
    im.castShadow = spec.shadow
    im.receiveShadow = true
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    return im
  }, [spec, matrices])
  // Grounding check: the base footprint of the (lifted) geometry under every instance.
  useEffect(() => {
    const key = `prim:${kind}:${matrices.length}:${matrices[0]?.elements[12] ?? 0}`
    const pos = spec.geo.attributes.position as THREE.BufferAttribute
    let minY = Infinity
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i) + spec.lift)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < pos.count; i++)
      if (pos.getY(i) + spec.lift < minY + 0.05) {
        x0 = Math.min(x0, pos.getX(i))
        x1 = Math.max(x1, pos.getX(i))
        z0 = Math.min(z0, pos.getZ(i))
        z1 = Math.max(z1, pos.getZ(i))
      }
    scatterChecks.set(key, () => {
      const bad: { name: string; region: string; float: number; buried: number }[] = []
      const w = new THREE.Vector3()
      for (const m of matrices) {
        const baseY = w.set((x0 + x1) / 2, minY, (z0 + z1) / 2).applyMatrix4(m).y
        let float = -Infinity, buried = -Infinity
        for (const sx of [x0, (x0 + x1) / 2, x1])
          for (const sz of [z0, (z0 + z1) / 2, z1]) {
            w.set(sx, minY, sz).applyMatrix4(m)
            const g = heightAt(w.x, w.z)
            float = Math.max(float, baseY - g)
            buried = Math.max(buried, g - baseY)
          }
        // Rocks are meant to sit partly sunk; only a gap underneath is a fault.
        if (float > 0.15 || (kind !== 'rock' && buried > 1)) bad.push({ name: kind, region: `scatter@${m.elements[12].toFixed(0)},${m.elements[14].toFixed(0)}`, float: +float.toFixed(2), buried: +buried.toFixed(2) })
      }
      return { checked: matrices.length, bad }
    })
    return () => {
      scatterChecks.delete(key)
    }
  }, [spec, matrices, kind])
  const ref = useRef<THREE.InstancedMesh>(null)
  const centre = useMemo(() => {
    const c = new THREE.Vector3()
    for (const m of matrices) c.add(new THREE.Vector3(m.elements[12], 0, m.elements[14]))
    return c.divideScalar(Math.max(1, matrices.length))
  }, [matrices])
  const tick = useRef(Math.floor(Math.random() * 15))
  const cull = CULL[kind]
  useFrame(({ camera }) => {
    if (cull === undefined || tick.current++ % 15 !== 0 || !ref.current) return
    ref.current.visible = Math.hypot(camera.position.x - centre.x, camera.position.z - centre.z) - CHUNK * 0.5 < cull
  })
  return <primitive ref={ref} object={mesh} />
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

export function Scatters({ light = false }: { light?: boolean }) {
  const chunks = useMemo(chunkLayout, [])
  // Undergrowth, logs and boulders stream in after the island has settled; the low graphics tier skips the tiniest.
  const [late, setLate] = useState(false)
  useFrame(({ clock }) => {
    wind.value = clock.elapsedTime
    if (!late && settled()) setLate(true)
  })
  return (
    <>
      {chunks.map(({ key, name, matrices }) =>
        (LATE.has(name) && !late) || (light && (name === 'pebble' || name === 'mushroom')) ? null : PRIMITIVES.has(name) ? (
          <InstancedPrimitive key={key} kind={name as PrimitiveKind} matrices={matrices} />
        ) : (
          <Suspense key={key} fallback={null}>
            <InstancedModel name={name as ModelName} matrices={matrices} />
          </Suspense>
        ),
      )}
    </>
  )
}
