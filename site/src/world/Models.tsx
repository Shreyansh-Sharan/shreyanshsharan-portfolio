import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { AVAILABLE_MODELS, REGIONS, type Landmark, type ModelName, type Region } from './regions'
import { heightAt } from './terrain'
import { scatterLayout, type ScatterName } from './layout'
import { boxCollider, circleCollider, landmarkKey, setLandmarkCollider, setScatterFactor } from './colliders'

export const modelUrl = (name: string) => `${import.meta.env.BASE_URL}world/models/${name}.glb`

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

function LandmarkModel({ region, l, index }: { region: Region; l: Landmark; index: number }) {
  const obj = useModel(l.model, l.height)
  const ref = useRef<THREE.Group>(null)
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const y = heightAt(x, z)
  const footprint = useMemo(() => baseFootprint(obj, Math.min(2.5, l.height * 0.35)), [obj, l.height])

  // Report the measured footprint so the player bumps into the building itself, not its flattened pad.
  useEffect(() => {
    const f = footprint
    if (!f) return
    const yaw = ((l.rot ?? 0) * Math.PI) / 180
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const wx = x + f.cx * c + f.cz * s, wz = z - f.cx * s + f.cz * c
    const avg = (f.hx + f.hz) / 2
    const top = y + l.height + (l.anim === 'float' ? 1.2 : 0)
    // Round bases (stills, silos, domes) get a circle; spinning ones too, sized to their sweep.
    const collider =
      l.anim === 'spin'
        ? circleCollider(x, z, Math.hypot(f.cx, f.cz) + f.rmax * 0.9, top)
        : f.rmax < avg * 1.18
          ? circleCollider(wx, wz, f.rmax * 0.92, top)
          : boxCollider(wx, wz, f.hx * 0.94, f.hz * 0.94, yaw, top)
    setLandmarkCollider(landmarkKey(region.id, index), collider)
  }, [footprint, x, y, z, l.rot, l.anim, l.height, region.id, index])

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

export function Landmarks() {
  return (
    <>
      {REGIONS.flatMap((r) =>
        r.landmarks.map((l, i) =>
          AVAILABLE_MODELS.has(l.model) ? (
            <Suspense key={`${r.id}-${i}`} fallback={null}>
              <LandmarkModel region={r} l={l} index={i} />
            </Suspense>
          ) : null,
        ),
      )}
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
