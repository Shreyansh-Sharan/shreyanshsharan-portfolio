// The mission enemies: small, round, cross little critters that hop after you. All of them are drawn with
// four instanced meshes (body, face, spikes, helmet), so a whole wave costs four draw calls. The body's
// per-instance colour doubles as the white hit flash; squash, stretch and the death pop live in the matrices.
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ENEMY_COLORS, enemies, MAX_ENEMIES } from './combat'

type V3 = [number, number, number]
interface Part {
  g: THREE.BufferGeometry
  c: string
  p: V3
  r?: V3
  s?: V3 | number
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const eu = new THREE.Euler()
const vp = new THREE.Vector3()
const vs = new THREE.Vector3()

function bake(parts: Part[]) {
  const geos = parts.map(({ g, c, p, r = [0, 0, 0], s = 1 }) => {
    const geo = g.index ? g.toNonIndexed() : g.clone()
    geo.deleteAttribute('uv')
    const sc = typeof s === 'number' ? ([s, s, s] as V3) : s
    m4.compose(vp.set(...p), q.setFromEuler(eu.set(...r)), vs.set(...sc))
    geo.applyMatrix4(m4)
    const col = new THREE.Color(c)
    const n = geo.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return geo
  })
  return mergeGeometries(geos)!
}

const BALL = new THREE.IcosahedronGeometry(1, 2)
const SMALL = new THREE.IcosahedronGeometry(1, 1)
const BOX = new THREE.BoxGeometry(1, 1, 1)
const CONE = new THREE.ConeGeometry(1, 1, 6)
const DOME = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
const RIM = new THREE.TorusGeometry(1, 0.08, 4, 16)

// Bodies are baked white so the per-instance colour sets their hue; the face keeps its own colours.
const bodyParts = (): Part[] => [
  { g: BALL, c: '#ffffff', p: [0, 0.4, 0], s: [0.44, 0.4, 0.44] },
  { g: SMALL, c: '#d9d9d9', p: [-0.18, 0.06, 0.06], s: [0.13, 0.08, 0.16] },
  { g: SMALL, c: '#d9d9d9', p: [0.18, 0.06, 0.06], s: [0.13, 0.08, 0.16] },
  { g: SMALL, c: '#e6e6e6', p: [-0.42, 0.36, 0.05], s: [0.09, 0.09, 0.09] },
  { g: SMALL, c: '#e6e6e6', p: [0.42, 0.36, 0.05], s: [0.09, 0.09, 0.09] },
]
const faceParts = (): Part[] => [
  { g: SMALL, c: '#ffffff', p: [-0.14, 0.48, 0.34], s: [0.11, 0.12, 0.07] },
  { g: SMALL, c: '#ffffff', p: [0.14, 0.48, 0.34], s: [0.11, 0.12, 0.07] },
  { g: SMALL, c: '#16121f', p: [-0.13, 0.47, 0.4], s: 0.055 },
  { g: SMALL, c: '#16121f', p: [0.13, 0.47, 0.4], s: 0.055 },
  // Cross little eyebrows.
  { g: BOX, c: '#16121f', p: [-0.14, 0.6, 0.37], r: [0, 0, -0.45], s: [0.15, 0.035, 0.03] },
  { g: BOX, c: '#16121f', p: [0.14, 0.6, 0.37], r: [0, 0, 0.45], s: [0.15, 0.035, 0.03] },
  { g: BOX, c: '#3b1530', p: [0, 0.33, 0.4], s: [0.12, 0.035, 0.03] },
]
const spikeParts = (): Part[] => [
  { g: CONE, c: '#fde68a', p: [0, 0.86, -0.02], s: [0.08, 0.2, 0.08] },
  { g: CONE, c: '#fde68a', p: [-0.2, 0.78, -0.08], r: [0, 0, 0.5], s: [0.07, 0.18, 0.07] },
  { g: CONE, c: '#fde68a', p: [0.2, 0.78, -0.08], r: [0, 0, -0.5], s: [0.07, 0.18, 0.07] },
  { g: CONE, c: '#fde68a', p: [0, 0.7, -0.3], r: [-0.8, 0, 0], s: [0.07, 0.18, 0.07] },
]
const helmetParts = (): Part[] => [
  { g: DOME, c: '#9aa3b2', p: [0, 0.5, 0], s: [0.47, 0.42, 0.47] },
  { g: RIM, c: '#6b7280', p: [0, 0.52, 0], r: [Math.PI / 2, 0, 0], s: [0.47, 0.47, 0.47] },
  { g: SMALL, c: '#fbbf24', p: [0, 0.95, 0], s: 0.07 },
]

const FLASH = new THREE.Color(3, 3, 3)
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
const tmpColor = new THREE.Color()

function makeMesh(geo: THREE.BufferGeometry, shadow: boolean) {
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, flatShading: true }), MAX_ENEMIES)
  im.castShadow = shadow
  im.frustumCulled = false
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  for (let i = 0; i < MAX_ENEMIES; i++) im.setMatrixAt(i, ZERO)
  return im
}

let meshCache: { body: THREE.InstancedMesh; face: THREE.InstancedMesh; spikes: THREE.InstancedMesh; helmet: THREE.InstancedMesh } | null = null
/** Built once per session and reused every time a fight starts. */
function enemyMeshes() {
  if (meshCache) return meshCache
  const body = makeMesh(bake(bodyParts()), true)
  body.setColorAt(0, tmpColor.set(1, 1, 1))
  body.instanceColor!.setUsage(THREE.DynamicDrawUsage)
  meshCache = { body, face: makeMesh(bake(faceParts()), false), spikes: makeMesh(bake(spikeParts()), true), helmet: makeMesh(bake(helmetParts()), true) }
  return meshCache
}

export function Enemies() {
  const meshes = enemyMeshes()

  useFrame(({ clock }) => {
    const { body, face, spikes, helmet } = enemyMeshes()
    let any = false
    for (let i = 0; i < MAX_ENEMIES; i++) {
      const e = enemies[i]
      if (!e.alive && e.dying < 0) {
        body.setMatrixAt(i, ZERO)
        face.setMatrixAt(i, ZERO)
        spikes.setMatrixAt(i, ZERO)
        helmet.setMatrixAt(i, ZERO)
        continue
      }
      any = true
      // Pop in with a springy overshoot; squash on landings and hits; stretch on the way up.
      const t = e.spawn
      let s = t < 1 ? 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-t * 5) : 1
      let sy = 1 - e.squash * 0.4 + (e.grounded ? 0 : Math.max(0, e.vel.y) * 0.035)
      let sxz = 1 + e.squash * 0.3
      if (e.dying >= 0) {
        // Death: a fat squash, then gone (the confetti takes over).
        const k = e.dying / 0.16
        s = k < 1 ? 1 : 0
        sxz = 1 + k * 0.7
        sy = 1 - k * 0.55
      }
      const wobble = e.grounded ? Math.sin(clock.elapsedTime * 9 + i) * 0.06 : 0
      eu.set(e.stun > 0 ? -0.3 : 0, e.yaw, wobble)
      q.setFromEuler(eu)
      vs.set(sxz * s, sy * s, sxz * s)
      m4.compose(e.pos, q, vs)
      body.setMatrixAt(i, m4)
      face.setMatrixAt(i, m4)
      spikes.setMatrixAt(i, e.kind === 'spiky' ? m4 : ZERO)
      helmet.setMatrixAt(i, e.helmet ? m4 : ZERO)
      body.setColorAt(i, e.flash > 0 || e.dying >= 0 ? FLASH : ENEMY_COLORS[e.kind])
    }
    body.visible = face.visible = spikes.visible = helmet.visible = any
    if (!any) return
    body.instanceMatrix.needsUpdate = face.instanceMatrix.needsUpdate = true
    spikes.instanceMatrix.needsUpdate = helmet.instanceMatrix.needsUpdate = true
    body.instanceColor!.needsUpdate = true
  })

  return (
    <>
      <primitive object={meshes.body} />
      <primitive object={meshes.face} />
      <primitive object={meshes.spikes} />
      <primitive object={meshes.helmet} />
    </>
  )
}
