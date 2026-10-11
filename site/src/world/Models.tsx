import { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { AVAILABLE_MODELS, REGIONS, type Landmark, type ModelName, type Region, type Scatter } from './regions'
import { flatness, heightAt, isNearPad, mulberry32 } from './terrain'
import { MISSIONS } from './missions'

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

function LandmarkModel({ region, l }: { region: Region; l: Landmark }) {
  const obj = useModel(l.model, l.height)
  const ref = useRef<THREE.Group>(null)
  const x = region.center[0] + l.at[0], z = region.center[1] + l.at[1]
  const y = heightAt(x, z)
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
        r.landmarks
          .filter((l) => AVAILABLE_MODELS.has(l.model))
          .map((l, i) => (
            <Suspense key={`${r.id}-${i}`} fallback={null}>
              <LandmarkModel region={r} l={l} />
            </Suspense>
          )),
      )}
    </>
  )
}

/* ---------- Scatter (instanced) ---------- */

function scatterTransforms(region: Region, s: Scatter, seed: number) {
  const rnd = mulberry32(seed)
  const out: THREE.Matrix4[] = []
  const q = new THREE.Quaternion()
  let tries = 0
  while (out.length < s.count && tries++ < s.count * 12) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * s.radius
    const x = region.center[0] + Math.cos(a) * r, z = region.center[1] + Math.sin(a) * r
    const h = heightAt(x, z)
    const minH = s.model === 'palm' ? 0.9 : 1.6
    if (h < minH || isNearPad(x, z, s.model === 'rock' || s.model === 'bush' ? 1.5 : 4)) continue
    if (s.model !== 'rock' && flatness(x, z) < 0.78) continue
    if (region.biome === 'speedway' || region.biome === 'neon') continue
    if (Math.hypot(x, z) < 20 && region.id !== 'hub') continue
    // Keep the ground around mission beacons (and the spawn points next to them) clear.
    if (MISSIONS.some((m) => Math.hypot(x - m.x, z - m.z) < 10)) continue
    const height = THREE.MathUtils.lerp(s.height[0], s.height[1], rnd())
    q.setFromEuler(new THREE.Euler(s.model === 'rock' ? rnd() * 0.6 : 0, rnd() * Math.PI * 2, 0))
    const sx = s.model === 'rock' ? 0.8 + rnd() * 0.8 : 1
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.15, z), q, new THREE.Vector3(height * sx, height, height * sx)))
  }
  return out
}

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

export function Scatters() {
  const groups = useMemo(() => {
    const byModel = new Map<string, THREE.Matrix4[]>()
    REGIONS.forEach((r, ri) =>
      r.scatter.forEach((s, si) => {
        if (s.model !== 'rock' && s.model !== 'bush' && !AVAILABLE_MODELS.has(s.model)) return
        const list = byModel.get(s.model) ?? []
        list.push(...scatterTransforms(r, s, 1000 + ri * 97 + si * 13))
        byModel.set(s.model, list)
      }),
    )
    return [...byModel.entries()]
  }, [])

  return (
    <>
      {groups.map(([name, matrices]) =>
        name === 'rock' || name === 'bush' ? (
          <InstancedPrimitive key={name} kind={name} matrices={matrices} />
        ) : (
          <Suspense key={name} fallback={null}>
            <InstancedModel name={name as ModelName} matrices={matrices} />
          </Suspense>
        ),
      )}
    </>
  )
}
