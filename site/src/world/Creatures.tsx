// Draws the creatures (creatures.ts): every species is three instanced meshes (body, and two diagonal limb
// pairs that swing against each other), baked from primitives with vertex colours, so sixty creatures of five
// species cost fifteen draw calls. Squash, stretch, leans, the buried crabs' sand mounds, the hovering
// drones' rotors and the gargoyles' wing beats all live in the instance matrices; the per-instance colour
// doubles as the hit flash and the Alpha's golden sheen. Also here: the floating health bars, the zap bolts,
// and the Spark Sphere.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { creatures, MAX_CREATURES, ride, sphere, SPECIES_LIST, tickBlend, type Creature, type SpeciesId } from './creatures'

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
const q2 = new THREE.Quaternion()
const eu = new THREE.Euler()
const vp = new THREE.Vector3()
const vs = new THREE.Vector3()
const dir = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)

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
  const merged = mergeGeometries(geos)!
  merged.computeBoundingSphere()
  return merged
}

const SPH = new THREE.IcosahedronGeometry(1, 1)
const BALL = new THREE.SphereGeometry(1, 12, 8)
const BOX = new THREE.BoxGeometry(1, 1, 1)
const CONE = new THREE.ConeGeometry(1, 1, 6)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 7)
const PLATE = new THREE.BoxGeometry(1, 0.06, 1)
const DOME = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)

const mirror = (x: number, make: (x: number) => Part): Part[] => [make(-x), make(x)]

/* ---------- Species parts (all face +z, feet at y = 0, one metre tall at scale 1) ---------- */

interface Build {
  body: Part[]
  /** Limb pair A (left front, right back) and B; each swings about its own pivot. */
  limbA: Part[]
  limbB: Part[]
  pivotA: V3
  pivotB: V3
  /** How the limbs animate. */
  gait: 'legs' | 'rotor' | 'wings' | 'claws'
}

function thornback(): Build {
  const b = '#8b5a2b', d = '#5a3a1c', t = '#f4e8d0'
  const bristles: Part[] = []
  for (let i = 0; i < 6; i++) bristles.push({ g: CONE, c: d, p: [(i % 2 ? 0.08 : -0.08), 0.98, 0.35 - i * 0.14], r: [-0.3, 0, 0], s: [0.09, 0.26, 0.09] })
  return {
    body: [
      { g: BALL, c: b, p: [0, 0.6, -0.05], s: [0.5, 0.42, 0.72] },
      { g: BALL, c: b, p: [0, 0.6, 0.58], s: [0.36, 0.34, 0.36] },
      { g: CYL, c: d, p: [0, 0.5, 0.88], r: [Math.PI / 2, 0, 0], s: [0.16, 0.2, 0.16] },
      ...mirror(0.16, (x) => ({ g: CONE, c: t, p: [x, 0.42, 0.86], r: [1.1, 0, x < 0 ? 0.5 : -0.5], s: [0.05, 0.22, 0.05] })),
      ...mirror(0.17, (x) => ({ g: SPH, c: '#ff4040', p: [x, 0.74, 0.8], s: 0.05 })),
      ...mirror(0.22, (x) => ({ g: CONE, c: d, p: [x, 0.95, 0.5], r: [0, 0, x < 0 ? 0.4 : -0.4], s: [0.08, 0.2, 0.06] })),
      { g: CYL, c: d, p: [0, 0.72, -0.78], r: [0.6, 0, 0], s: [0.035, 0.3, 0.035] },
      ...bristles,
    ],
    limbA: [
      { g: CYL, c: d, p: [-0.24, 0.17, 0.35], s: [0.08, 0.36, 0.08] },
      { g: CYL, c: d, p: [0.24, 0.17, -0.4], s: [0.08, 0.36, 0.08] },
    ],
    limbB: [
      { g: CYL, c: d, p: [0.24, 0.17, 0.35], s: [0.08, 0.36, 0.08] },
      { g: CYL, c: d, p: [-0.24, 0.17, -0.4], s: [0.08, 0.36, 0.08] },
    ],
    pivotA: [0, 0.38, 0],
    pivotB: [0, 0.38, 0],
    gait: 'legs',
  }
}

function grizzlebear(): Build {
  const f = '#6b4a32', l = '#a07a5a', d = '#2b1d14'
  return {
    body: [
      { g: BALL, c: f, p: [0, 1.0, -0.05], s: [0.72, 0.78, 0.9] },
      { g: BALL, c: l, p: [0, 0.85, 0.5], s: [0.45, 0.5, 0.45] },
      { g: BALL, c: f, p: [0, 1.6, 0.55], s: [0.4, 0.38, 0.42] },
      { g: BALL, c: l, p: [0, 1.48, 0.88], s: [0.2, 0.16, 0.18] },
      { g: SPH, c: d, p: [0, 1.52, 1.04], s: 0.07 },
      ...mirror(0.16, (x) => ({ g: SPH, c: d, p: [x, 1.68, 0.9], s: 0.05 })),
      ...mirror(0.28, (x) => ({ g: BALL, c: f, p: [x, 1.9, 0.45], s: 0.12 })),
    ],
    limbA: [
      { g: CYL, c: f, p: [-0.42, 0.3, 0.45], s: [0.17, 0.62, 0.17] },
      { g: CYL, c: f, p: [0.42, 0.3, -0.5], s: [0.17, 0.62, 0.17] },
      ...mirror(0.42, (x) => ({ g: CONE, c: '#e8dcc8', p: [x, 0.04, x < 0 ? 0.68 : -0.27], r: [Math.PI / 2, 0, 0], s: [0.05, 0.14, 0.04] })),
    ],
    limbB: [
      { g: CYL, c: f, p: [0.42, 0.3, 0.45], s: [0.17, 0.62, 0.17] },
      { g: CYL, c: f, p: [-0.42, 0.3, -0.5], s: [0.17, 0.62, 0.17] },
      ...mirror(0.42, (x) => ({ g: CONE, c: '#e8dcc8', p: [x, 0.04, x > 0 ? 0.68 : -0.27], r: [Math.PI / 2, 0, 0], s: [0.05, 0.14, 0.04] })),
    ],
    pivotA: [0, 0.62, 0],
    pivotB: [0, 0.62, 0],
    gait: 'legs',
  }
}

function scrapdrone(): Build {
  const g = '#8d9bb0', d = '#3b4252', c = '#22d3ee'
  return {
    body: [
      { g: BALL, c: g, p: [0, 0.4, 0], s: [0.42, 0.26, 0.42] },
      { g: CYL, c: d, p: [0, 0.4, 0], s: [0.46, 0.1, 0.46] },
      { g: BALL, c: c, p: [0, 0.4, 0.36], s: [0.14, 0.12, 0.1] },
      { g: CYL, c: d, p: [0, 0.68, -0.1], s: [0.02, 0.3, 0.02] },
      { g: SPH, c: '#f43f5e', p: [0, 0.84, -0.1], s: 0.04 },
      ...mirror(0.14, (x) => ({ g: CYL, c: d, p: [x, 0.18, 0.05], s: [0.03, 0.2, 0.03] })),
      ...mirror(0.14, (x) => ({ g: BOX, c: d, p: [x, 0.08, 0.05], s: [0.06, 0.04, 0.14] })),
    ],
    // Four rotor blades on a hub; the two meshes spin together.
    limbA: [
      { g: BOX, c: d, p: [0, 0.56, 0], s: [1.0, 0.02, 0.1] },
      { g: CYL, c: d, p: [0, 0.56, 0], s: [0.07, 0.06, 0.07] },
    ],
    limbB: [{ g: BOX, c: d, p: [0, 0.56, 0], s: [0.1, 0.02, 1.0] }],
    pivotA: [0, 0.56, 0],
    pivotB: [0, 0.56, 0],
    gait: 'rotor',
  }
}

function snapcrab(): Build {
  const r = '#e2574c', d = '#9e2f27', w = '#fff2e0'
  const legs = (side: number): Part[] => {
    const out: Part[] = []
    for (let i = 0; i < 3; i++) out.push({ g: CYL, c: d, p: [side * 0.5, 0.14, -0.2 + i * 0.16], r: [0, 0, side * 0.9], s: [0.03, 0.3, 0.03] })
    return out
  }
  return {
    body: [
      { g: BALL, c: r, p: [0, 0.3, 0], s: [0.5, 0.22, 0.4] },
      { g: BALL, c: w, p: [0, 0.22, 0.05], s: [0.4, 0.14, 0.3] },
      ...mirror(0.14, (x) => ({ g: CYL, c: d, p: [x, 0.5, 0.26], s: [0.025, 0.2, 0.025] })),
      ...mirror(0.14, (x) => ({ g: SPH, c: '#1b1b1b', p: [x, 0.6, 0.27], s: 0.05 })),
    ],
    // Claws open and close; the little legs scuttle with them.
    limbA: [
      { g: CYL, c: r, p: [-0.42, 0.3, 0.36], r: [Math.PI / 2, 0, 0], s: [0.07, 0.3, 0.07] },
      { g: BALL, c: r, p: [-0.46, 0.3, 0.56], s: [0.14, 0.1, 0.17] },
      { g: CONE, c: d, p: [-0.46, 0.33, 0.74], r: [Math.PI / 2, 0, 0], s: [0.05, 0.16, 0.05] },
      ...legs(-1),
    ],
    limbB: [
      { g: CYL, c: r, p: [0.42, 0.3, 0.36], r: [Math.PI / 2, 0, 0], s: [0.07, 0.3, 0.07] },
      { g: BALL, c: r, p: [0.46, 0.3, 0.56], s: [0.14, 0.1, 0.17] },
      { g: CONE, c: d, p: [0.46, 0.33, 0.74], r: [Math.PI / 2, 0, 0], s: [0.05, 0.16, 0.05] },
      ...legs(1),
    ],
    pivotA: [-0.4, 0.3, 0.3],
    pivotB: [0.4, 0.3, 0.3],
    gait: 'claws',
  }
}

function gargoyle(): Build {
  const s = '#5c6472', d = '#3a404b'
  return {
    body: [
      { g: BALL, c: s, p: [0, 0.68, 0], s: [0.36, 0.44, 0.34] },
      { g: BALL, c: s, p: [0, 1.1, 0.16], s: [0.26, 0.24, 0.26] },
      ...mirror(0.14, (x) => ({ g: CONE, c: d, p: [x, 1.38, 0.1], r: [0, 0, x < 0 ? 0.35 : -0.35], s: [0.06, 0.22, 0.06] })),
      ...mirror(0.1, (x) => ({ g: SPH, c: '#ffb020', p: [x, 1.12, 0.38], s: 0.05 })),
      { g: CONE, c: d, p: [0, 1.02, 0.42], r: [Math.PI / 2, 0, 0], s: [0.07, 0.16, 0.05] },
      ...mirror(0.18, (x) => ({ g: CYL, c: d, p: [x, 0.26, 0.05], r: [0.3, 0, 0], s: [0.07, 0.4, 0.07] })),
      { g: CYL, c: d, p: [0, 0.6, -0.5], r: [-1.1, 0, 0], s: [0.04, 0.5, 0.04] },
      { g: CONE, c: d, p: [0, 0.82, -0.82], r: [-1.2, 0, 0], s: [0.07, 0.14, 0.04] },
    ],
    limbA: [
      { g: PLATE, c: d, p: [-0.62, 0.9, -0.05], r: [0, 0, 0.12], s: [1.0, 1, 0.55] },
      { g: CONE, c: d, p: [-1.1, 0.95, 0.12], r: [0, 0, -1.3], s: [0.05, 0.16, 0.05] },
    ],
    limbB: [
      { g: PLATE, c: d, p: [0.62, 0.9, -0.05], r: [0, 0, -0.12], s: [1.0, 1, 0.55] },
      { g: CONE, c: d, p: [1.1, 0.95, 0.12], r: [0, 0, 1.3], s: [0.05, 0.16, 0.05] },
    ],
    pivotA: [-0.2, 0.88, 0],
    pivotB: [0.2, 0.88, 0],
    gait: 'wings',
  }
}

const BUILDS: Record<SpeciesId, () => Build> = { thornback, grizzlebear, scrapdrone, snapcrab, gargoyle }

/* ---------- Meshes ---------- */

const FLASH = new THREE.Color(3, 3, 3)
const WHITE = new THREE.Color(1, 1, 1)
const GOLD = new THREE.Color(1.35, 1.15, 0.7)
const TAME = new THREE.Color(1.05, 1.1, 1.2)
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)

interface SpeciesMeshes {
  build: Build
  body: THREE.InstancedMesh
  limbA: THREE.InstancedMesh
  limbB: THREE.InstancedMesh
}

function makeMesh(geo: THREE.BufferGeometry, shadow: boolean, mat?: THREE.Material) {
  const im = new THREE.InstancedMesh(geo, mat ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }), MAX_CREATURES)
  im.castShadow = shadow
  im.frustumCulled = false
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  for (let i = 0; i < MAX_CREATURES; i++) im.setMatrixAt(i, ZERO)
  im.setColorAt(0, WHITE)
  im.instanceColor!.setUsage(THREE.DynamicDrawUsage)
  return im
}

let cache: {
  species: Record<SpeciesId, SpeciesMeshes>
  mound: THREE.InstancedMesh
  barBack: THREE.InstancedMesh
  barFill: THREE.InstancedMesh
  bolt: THREE.InstancedMesh
} | null = null

function meshes() {
  if (cache) return cache
  const species = {} as Record<SpeciesId, SpeciesMeshes>
  for (const s of SPECIES_LIST) {
    const build = BUILDS[s.id]()
    // Limbs are baked around their pivot so a rotation swings them from the hip / shoulder.
    const shift = (parts: Part[], pv: V3): Part[] => parts.map((p) => ({ ...p, p: [p.p[0] - pv[0], p.p[1] - pv[1], p.p[2] - pv[2]] as V3 }))
    species[s.id] = {
      build,
      body: makeMesh(bake(build.body), true),
      limbA: makeMesh(bake(shift(build.limbA, build.pivotA)), true),
      limbB: makeMesh(bake(shift(build.limbB, build.pivotB)), true),
    }
  }
  const mound = makeMesh(bake([{ g: DOME, c: '#e8d6a8', p: [0, 0, 0], s: [0.75, 0.3, 0.75] }]), false)
  const bar = new THREE.PlaneGeometry(1, 1)
  const barBack = makeMesh(bar, false, new THREE.MeshBasicMaterial({ color: '#10131c', transparent: true, opacity: 0.75, depthWrite: false }))
  // Both bar planes go through the transparent pass so the fill is composited after the plate, not under it.
  const barFill = makeMesh(bar, false, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }))
  const bolt = makeMesh(BOX, false, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 3), toneMapped: false }))
  barBack.renderOrder = 5
  barFill.renderOrder = 6
  cache = { species, mound, barBack, barFill, bolt }
  return cache
}

const GREEN = new THREE.Color('#4ade80')
const AMBER = new THREE.Color('#fbbf24')
const RED = new THREE.Color('#f43f5e')
const BLUE = new THREE.Color('#7dd3fc')
const rpos = new THREE.Vector3()

export function Creatures() {
  const m = meshes()
  const sphereRef = useRef<THREE.Group>(null)
  const sphereTop = useRef<THREE.Mesh>(null)

  useFrame(({ camera, clock }) => {
    const blend = tickBlend() / 30
    const time = clock.elapsedTime
    const counts: Partial<Record<SpeciesId, boolean>> = {}
    let mounds = 0
    let bars = 0
    let bolts = 0
    for (let i = 0; i < MAX_CREATURES; i++) {
      const c = creatures[i]
      const sm = m.species[c.species]
      if ((!c.alive && c.dying < 0) || c.hidden) {
        sm.body.setMatrixAt(i, ZERO)
        sm.limbA.setMatrixAt(i, ZERO)
        sm.limbB.setMatrixAt(i, ZERO)
        continue
      }
      counts[c.species] = true
      const spec = c.spec
      const H = spec.height * c.size
      rpos.set(c.pos.x + c.vel.x * blend, c.pos.y + (spec.fly ? c.vel.y * blend : 0), c.pos.z + c.vel.z * blend)

      if (c.buried) {
        // Only a mound of sand shows.
        sm.body.setMatrixAt(i, ZERO)
        sm.limbA.setMatrixAt(i, ZERO)
        sm.limbB.setMatrixAt(i, ZERO)
        m4.compose(rpos, q.setFromEuler(eu.set(0, c.yaw, 0)), vs.set(c.size, c.size, c.size))
        m.mound.setMatrixAt(mounds++, m4)
        continue
      }

      // ---- Body pose: pop-in, squash on hits and landings, leans per state. ----
      let s = c.spawn < 1 ? 1 - Math.cos(c.spawn * Math.PI * 2.5) * Math.exp(-c.spawn * 5) : 1
      let sy = 1 - c.squash * 0.35 + (!c.grounded && !spec.fly ? Math.max(0, c.vel.y) * 0.03 : 0)
      let sxz = 1 + c.squash * 0.25
      if (c.dying >= 0) {
        const k = c.dying / 0.16
        s = k < 1 ? 1 : 0
        sxz = 1 + k * 0.7
        sy = 1 - k * 0.55
      }
      const speed = Math.hypot(c.vel.x, c.vel.z)
      let pitch = 0, roll = 0, bob = 0
      const t = c.stateT
      if (c.state === 'attack') {
        if (spec.attack === 'charge') {
          if (t < 0.55) roll = Math.sin(time * 40) * 0.06
          else pitch = 0.3
        } else if (spec.attack === 'swipe') pitch = t < 0.5 ? -0.5 * (t / 0.5) : 0.35 * Math.max(0, 1 - (t - 0.5) * 2)
        else if (spec.attack === 'nip') pitch = t < 0.18 ? -0.3 : 0.25
        else if (spec.attack === 'dive') pitch = Math.max(-0.6, Math.min(0.9, -c.vel.y * 0.08))
        else if (spec.attack === 'zap') roll = Math.sin(time * 50) * 0.04
      } else if (c.state === 'flee') roll = Math.sin(c.phase * 2) * 0.08
      if (c.stun > 0) pitch -= 0.25
      if (!spec.fly) bob = Math.abs(Math.sin(c.phase)) * Math.min(1, speed / 3) * 0.06
      else {
        bob = Math.sin(time * 3 + i) * 0.05
        if (c.state !== 'attack') {
          pitch = Math.min(0.5, speed * 0.05)
          roll = Math.sin(time * 1.5 + i) * 0.06
        }
      }
      vp.copy(rpos)
      vp.y += bob * H
      eu.set(pitch, c.yaw, roll)
      q.setFromEuler(eu)
      vs.set(sxz * s * H, sy * s * H, sxz * s * H)
      m4.compose(vp, q, vs)
      sm.body.setMatrixAt(i, m4)
      const col = c.flash > 0 || c.dying >= 0 ? FLASH : c.alpha ? GOLD : c.tame >= 0 ? TAME : WHITE
      sm.body.setColorAt(i, col)
      sm.limbA.setColorAt(i, col)
      sm.limbB.setColorAt(i, col)

      // ---- Limbs: swing from their pivots (legs), spin (rotor), beat (wings) or snap (claws). ----
      const b = sm.build
      let aA = 0, aB = 0, axis: 'x' | 'y' | 'z' = 'x'
      if (b.gait === 'legs') {
        const amp = Math.min(1, speed / 2.5) * 0.55
        aA = Math.sin(c.phase) * amp
        aB = -aA
        if (c.state === 'attack' && spec.attack === 'swipe' && t < 0.5) aA = aB = -1.1 * (t / 0.5)
        if (c.state === 'attack' && spec.attack === 'swipe' && t >= 0.5) aA = aB = 0.8 * Math.max(0, 1 - (t - 0.5) * 2)
      } else if (b.gait === 'rotor') {
        axis = 'y'
        aA = aB = c.phase
      } else if (b.gait === 'wings') {
        axis = 'z'
        const beat = Math.sin(c.phase * 0.9) * (c.state === 'attack' ? 0.25 : 0.55)
        aA = -beat - 0.1
        aB = beat + 0.1
      } else {
        axis = 'y'
        const snap = c.state === 'attack' ? (t < 0.18 ? 0.8 : -0.1) : 0.25 + Math.sin(c.phase * 1.3) * 0.2
        aA = snap
        aB = -snap
      }
      const bx = rpos.x, by = rpos.y + bob * H, bz = rpos.z
      const limb = (im: THREE.InstancedMesh, pivot: V3, angle: number) => {
        // The pivot in body space goes to world space; the swing is applied on top of the body rotation.
        vp.set(pivot[0] * vs.x, pivot[1] * vs.y, pivot[2] * vs.z).applyQuaternion(q)
        vp.x += bx
        vp.y += by
        vp.z += bz
        eu.set(axis === 'x' ? angle : 0, axis === 'y' ? angle : 0, axis === 'z' ? angle : 0)
        q2.setFromEuler(eu).premultiply(q)
        im.setMatrixAt(i, m4.compose(vp, q2, vs))
      }
      limb(sm.limbA, b.pivotA, aA)
      limb(sm.limbB, b.pivotB, aB)

      // ---- Health bar (recently hurt, Alphas, pals), facing the camera. ----
      if ((c.hurtT > 0 || c.alpha || c.tame >= 0) && c.alive && bars < MAX_CREATURES) {
        const w = c.alpha ? 2.2 : 1.1
        vp.set(rpos.x, rpos.y + H + 0.35 + (c.alpha ? 0.3 : 0), rpos.z)
        q2.copy(camera.quaternion)
        m.barBack.setMatrixAt(bars, m4.compose(vp, q2, vs.set(w + 0.08, 0.16, 1)))
        const f = Math.max(0, c.hp / c.maxHp)
        // Anchor the fill to the left edge (the plane is centred): shift by the missing half.
        dir.set(-(w * (1 - f)) / 2, 0, 0).applyQuaternion(q2)
        vp.add(dir)
        vp.add(dir.set(0, 0, 0.01).applyQuaternion(q2))
        m.barFill.setMatrixAt(bars, m4.compose(vp, q2, vs.set(Math.max(0.01, w * f), 0.1, 1)))
        m.barFill.setColorAt(bars, c.tame >= 0 ? BLUE : f > 0.5 ? GREEN : f > 0.25 ? AMBER : RED)
        bars++
      }

      // ---- Zap bolt: a thin bright box from the drone's eye to its target. ----
      if (c.zapT > 0 && bolts < MAX_CREATURES) {
        vp.set(rpos.x, rpos.y + H * 0.5, rpos.z)
        dir.copy(c.zapTo).sub(vp)
        const len = dir.length()
        if (len > 0.1) {
          dir.divideScalar(len)
          q2.setFromUnitVectors(Z, dir)
          vp.addScaledVector(dir, len / 2)
          const jag = 0.05 + Math.random() * 0.06
          m.bolt.setMatrixAt(bolts++, m4.compose(vp, q2, vs.set(jag, jag, len)))
        }
      }
    }
    for (const s of SPECIES_LIST) {
      const sm = m.species[s.id]
      const vis = !!counts[s.id]
      sm.body.visible = sm.limbA.visible = sm.limbB.visible = vis
      if (!vis) continue
      sm.body.instanceMatrix.needsUpdate = sm.limbA.instanceMatrix.needsUpdate = sm.limbB.instanceMatrix.needsUpdate = true
      sm.body.instanceColor!.needsUpdate = sm.limbA.instanceColor!.needsUpdate = sm.limbB.instanceColor!.needsUpdate = true
    }
    for (let k = mounds; k < MAX_CREATURES; k++) m.mound.setMatrixAt(k, ZERO)
    for (let k = bars; k < MAX_CREATURES; k++) {
      m.barBack.setMatrixAt(k, ZERO)
      m.barFill.setMatrixAt(k, ZERO)
    }
    for (let k = bolts; k < MAX_CREATURES; k++) m.bolt.setMatrixAt(k, ZERO)
    m.mound.visible = mounds > 0
    m.barBack.visible = m.barFill.visible = bars > 0
    m.bolt.visible = bolts > 0
    m.mound.instanceMatrix.needsUpdate = m.barBack.instanceMatrix.needsUpdate = m.barFill.instanceMatrix.needsUpdate = m.bolt.instanceMatrix.needsUpdate = true
    m.barFill.instanceColor!.needsUpdate = true

    // ---- The Spark Sphere: flies, drops, wobbles three times, then opens. ----
    const g = sphereRef.current
    if (g) {
      g.visible = sphere.active
      if (sphere.active) {
        g.position.copy(sphere.pos)
        if (sphere.phase === 'fly') g.rotation.set(sphere.t * 14, 0, 0)
        else if (sphere.phase === 'wobble') {
          const w = sphere.t % 0.55
          const amp = w < 0.3 ? Math.sin((w / 0.3) * Math.PI * 2) * 0.45 : 0
          g.rotation.set(0, 0, amp)
        } else g.rotation.set(0, 0, 0)
        if (sphereTop.current) sphereTop.current.position.y = sphere.phase === 'open' ? Math.min(0.5, sphere.t * 2) : 0
      }
    }
  })

  const list = useMemo(() => SPECIES_LIST.map((s) => m.species[s.id]), [m])
  return (
    <>
      {list.map((sm, i) => (
        <group key={i}>
          <primitive object={sm.body} />
          <primitive object={sm.limbA} />
          <primitive object={sm.limbB} />
        </group>
      ))}
      <primitive object={m.mound} />
      <primitive object={m.barBack} />
      <primitive object={m.barFill} />
      <primitive object={m.bolt} />
      <group ref={sphereRef} visible={false}>
        <mesh ref={sphereTop}>
          <sphereGeometry args={[0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#7ef5c8" emissive="#2dd4bf" emissiveIntensity={0.6} roughness={0.3} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.3, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#ffe066" emissive="#f59e0b" emissiveIntensity={0.4} roughness={0.3} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.035, 6, 20]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <pointLight color="#7ef5c8" intensity={2} distance={4} />
      </group>
    </>
  )
}

/** The creature under the rider (for the camera / HUD): null when on foot. */
export const mounted = (): Creature | null => ride.pal
