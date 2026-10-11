// The island's animals: a few kinds of low-poly creatures (built in code) plus the sheep model. They
// wander near home, avoid water and props, can be bounced on (Mario-style), and every spell makes the
// one it hits react: shrink/grow tweens, ice, flips, a shock with skeleton flashes, tumbles and flight.
import { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { heightAt } from './terrain'
import { WATER_LEVEL } from './regions'
import { animals, dryLand, pickWander, type Animal, type AnimalKind } from './wildlife'
import { resolve } from './colliders'
import { castSpell, castZap, IMPACT, randomSpell } from './spells'
import { damage, fight, impact, nearestEnemy } from './combat'
import { emit, SHAPE, type Emit } from './particles'
import { player } from './Characters'
import { controls } from './controls'
import { useModel } from './Models'
import { world } from './store'
import { play } from '../lib/sound'

/* ---------- Geometry baking ---------- */

type V3 = [number, number, number]
interface Part {
  g: THREE.BufferGeometry
  c: string
  p: V3
  r?: V3
  s?: V3 | number
}

const SPH = new THREE.IcosahedronGeometry(1, 1)
const BALL = new THREE.SphereGeometry(1, 14, 10)
const BOX = new THREE.BoxGeometry(1, 1, 1)
const CONE = new THREE.ConeGeometry(1, 1, 7)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 7)
const RIB = new THREE.TorusGeometry(1, 0.08, 4, 12, Math.PI)
const CURL = new THREE.TorusGeometry(0.07, 0.022, 4, 10)

const bm = new THREE.Matrix4()
const bq = new THREE.Quaternion()
const be = new THREE.Euler()
const bp = new THREE.Vector3()
const bs = new THREE.Vector3()

/** Merge primitive parts into one vertex-coloured geometry: one draw call per animal. */
function bake(parts: Part[]) {
  const geos = parts.map(({ g, c, p, r = [0, 0, 0], s = 1 }) => {
    const geo = g.index ? g.toNonIndexed() : g.clone()
    geo.deleteAttribute('uv')
    const sc = typeof s === 'number' ? ([s, s, s] as V3) : s
    bm.compose(bp.set(...p), bq.setFromEuler(be.set(...r)), bs.set(...sc))
    geo.applyMatrix4(bm)
    const col = new THREE.Color(c)
    const n = geo.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r
      arr[i * 3 + 1] = col.g
      arr[i * 3 + 2] = col.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return geo
  })
  const merged = mergeGeometries(geos)!
  merged.computeBoundingSphere()
  return merged
}

const mirror = (x: number, make: (x: number) => Part): Part[] => [make(-x), make(x)]

/* ---------- Kinds (all face +z) ---------- */

const CRITTER = { body: '#ffcf5c', belly: '#fff2cf', cheek: '#ff8da1', feet: '#e0a93f', eye: '#20232e' }

function critterParts(): Part[] {
  const c = CRITTER
  return [
    { g: BALL, c: c.body, p: [0, 0.55, 0], s: 0.55 },
    { g: BALL, c: c.belly, p: [0, 0.42, 0.24], s: [0.34, 0.34, 0.34] },
    ...mirror(0.2, (x) => ({ g: BALL, c: c.eye, p: [x, 0.72, 0.44], s: 0.1 })),
    ...mirror(0.18, (x) => ({ g: BALL, c: '#ffffff', p: [x * 0.95, 0.76, 0.52], s: 0.032 })),
    ...mirror(0.34, (x) => ({ g: BALL, c: c.cheek, p: [x, 0.6, 0.4], s: 0.09 })),
    ...mirror(0.3, (x) => ({ g: CONE, c: c.body, p: [x, 1.02, 0], r: [0, 0, x < 0 ? 0.3 : -0.3], s: [0.16, 0.34, 0.16] })),
    ...mirror(0.22, (x) => ({ g: BALL, c: c.feet, p: [x, 0.08, 0.1], s: 0.15 })),
  ]
}

function foxParts(): Part[] {
  const o = '#e8742c', w = '#f6efe6', d = '#3b2a24'
  return [
    { g: SPH, c: o, p: [0, 0.58, -0.02], s: [0.34, 0.3, 0.58] },
    { g: SPH, c: w, p: [0, 0.55, 0.3], s: [0.25, 0.25, 0.28] },
    { g: SPH, c: o, p: [0, 0.86, 0.5], s: [0.27, 0.25, 0.27] },
    { g: SPH, c: w, p: [0, 0.79, 0.6], s: [0.21, 0.13, 0.19] },
    { g: CONE, c: o, p: [0, 0.81, 0.78], r: [Math.PI / 2, 0, 0], s: [0.11, 0.3, 0.1] },
    { g: SPH, c: '#1b1b1b', p: [0, 0.81, 0.93], s: 0.05 },
    ...mirror(0.1, (x) => ({ g: SPH, c: '#1b1b1b', p: [x, 0.93, 0.71], s: 0.045 })),
    ...mirror(0.13, (x) => ({ g: CONE, c: o, p: [x, 1.13, 0.45], r: [0, 0, x < 0 ? 0.2 : -0.2], s: [0.09, 0.24, 0.07] })),
    ...mirror(0.14, (x) => ({ g: CONE, c: d, p: [x * 1.12, 1.23, 0.45], r: [0, 0, x < 0 ? 0.2 : -0.2], s: [0.04, 0.07, 0.035] })),
    ...mirror(0.15, (x) => ({ g: CYL, c: d, p: [x, 0.2, 0.28], s: [0.055, 0.4, 0.055] })),
    ...mirror(0.15, (x) => ({ g: CYL, c: d, p: [x, 0.2, -0.3], s: [0.055, 0.4, 0.055] })),
    { g: SPH, c: o, p: [0, 0.66, -0.72], r: [-0.7, 0, 0], s: [0.15, 0.15, 0.42] },
    { g: SPH, c: w, p: [0, 0.88, -0.98], r: [-0.7, 0, 0], s: [0.1, 0.1, 0.14] },
  ]
}

function bunnyParts(): Part[] {
  const f = '#ece6dc', pink = '#f3a9b6'
  return [
    { g: SPH, c: f, p: [0, 0.36, -0.04], s: [0.32, 0.3, 0.38] },
    { g: SPH, c: f, p: [0, 0.66, 0.24], s: [0.23, 0.22, 0.22] },
    ...mirror(0.08, (x) => ({ g: SPH, c: f, p: [x, 0.98, 0.16], r: [-0.15, 0, x < 0 ? 0.14 : -0.14], s: [0.065, 0.26, 0.04] })),
    ...mirror(0.08, (x) => ({ g: SPH, c: pink, p: [x, 0.97, 0.195], r: [-0.15, 0, x < 0 ? 0.14 : -0.14], s: [0.035, 0.19, 0.02] })),
    ...mirror(0.11, (x) => ({ g: SPH, c: '#1d1d24', p: [x, 0.71, 0.4], s: 0.04 })),
    { g: SPH, c: pink, p: [0, 0.64, 0.455], s: 0.032 },
    { g: SPH, c: '#ffffff', p: [0, 0.42, -0.43], s: 0.11 },
    ...mirror(0.14, (x) => ({ g: SPH, c: f, p: [x, 0.05, 0.08], s: [0.09, 0.06, 0.17] })),
  ]
}

function pigParts(): Part[] {
  const p = '#f5a7b8', d = '#e48299'
  return [
    { g: SPH, c: p, p: [0, 0.62, 0], s: [0.5, 0.45, 0.68] },
    { g: SPH, c: p, p: [0, 0.75, 0.62], s: [0.36, 0.34, 0.34] },
    { g: CYL, c: d, p: [0, 0.7, 0.95], r: [Math.PI / 2, 0, 0], s: [0.14, 0.14, 0.14] },
    ...mirror(0.05, (x) => ({ g: SPH, c: '#5b2a35', p: [x, 0.71, 1.02], s: 0.03 })),
    ...mirror(0.2, (x) => ({ g: CONE, c: d, p: [x, 1.05, 0.56], r: [0.35, 0, x < 0 ? 0.5 : -0.5], s: [0.1, 0.2, 0.06] })),
    ...mirror(0.14, (x) => ({ g: SPH, c: '#1d1d24', p: [x, 0.86, 0.88], s: 0.045 })),
    ...mirror(0.25, (x) => ({ g: CYL, c: d, p: [x, 0.16, 0.35], s: [0.09, 0.34, 0.09] })),
    ...mirror(0.25, (x) => ({ g: CYL, c: d, p: [x, 0.16, -0.35], s: [0.09, 0.34, 0.09] })),
    { g: CURL, c: d, p: [0, 0.78, -0.7], r: [0, Math.PI / 2, 0] },
  ]
}

/** Proportions for the cartoon skeleton shown in the lightning strobe. */
interface Bones {
  bodyY: number
  half: number
  head: V3
  headR: number
  ribR: number
  legX: number
  legZ: [number, number]
  legH: number
}

const BONES: Record<AnimalKind, Bones> = {
  critter: { bodyY: 0.55, half: 0.25, head: [0, 0.82, 0.12], headR: 0.26, ribR: 0.3, legX: 0.2, legZ: [0.08, 0.08], legH: 0.3 },
  sheep: { bodyY: 0.6, half: 0.42, head: [0, 0.78, 0.58], headR: 0.18, ribR: 0.27, legX: 0.18, legZ: [0.3, -0.3], legH: 0.42 },
  fox: { bodyY: 0.58, half: 0.42, head: [0, 0.86, 0.52], headR: 0.2, ribR: 0.22, legX: 0.15, legZ: [0.28, -0.3], legH: 0.4 },
  bunny: { bodyY: 0.38, half: 0.25, head: [0, 0.68, 0.25], headR: 0.17, ribR: 0.2, legX: 0.13, legZ: [0.1, -0.12], legH: 0.22 },
  pig: { bodyY: 0.62, half: 0.5, head: [0, 0.76, 0.66], headR: 0.26, ribR: 0.34, legX: 0.25, legZ: [0.35, -0.35], legH: 0.36 },
}

function skeletonParts(b: Bones): Part[] {
  const bone = '#ffffff', dark = '#05070d'
  const parts: Part[] = [
    { g: SPH, c: bone, p: b.head, s: b.headR },
    ...mirror(b.headR * 0.38, (x) => ({ g: SPH, c: dark, p: [x, b.head[1] + b.headR * 0.15, b.head[2] + b.headR * 0.78], s: b.headR * 0.28 })),
    { g: CYL, c: bone, p: [0, b.bodyY + b.ribR * 0.2, 0], r: [Math.PI / 2, 0, 0], s: [0.035, b.half * 2.2, 0.035] },
    { g: BOX, c: bone, p: [0, b.bodyY, -b.half], s: [b.ribR * 1.2, 0.08, 0.12] },
  ]
  const ribs = 4
  for (let i = 0; i < ribs; i++) {
    const z = THREE.MathUtils.lerp(-b.half * 0.6, b.half * 0.7, i / (ribs - 1))
    const r = b.ribR * (0.8 + 0.2 * Math.sin((i / (ribs - 1)) * Math.PI))
    parts.push({ g: RIB, c: bone, p: [0, b.bodyY + b.ribR * 0.2, z], r: [0, 0, Math.PI], s: [r, r, r] })
  }
  for (const z of b.legZ)
    for (const x of [-b.legX, b.legX]) parts.push({ g: CYL, c: bone, p: [x, b.legH / 2, z], s: [0.03, b.legH, 0.03] })
  return parts
}

function flowerParts(): Part[] {
  const parts: Part[] = [{ g: SPH, c: '#ffd23f', p: [0, 0.05, 0], s: 0.06 }]
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    parts.push({ g: SPH, c: i % 2 ? '#ff7eb6' : '#ff9fcb', p: [Math.cos(a) * 0.1, 0.04, Math.sin(a) * 0.1], r: [0, -a, 0], s: [0.075, 0.025, 0.05] })
  }
  parts.push({ g: SPH, c: '#4caf50', p: [0.12, 0.0, -0.06], r: [0, 0.6, 0.3], s: [0.07, 0.015, 0.035] })
  return parts
}

const BODY_PARTS: Record<Exclude<AnimalKind, 'sheep'>, () => Part[]> = { critter: critterParts, fox: foxParts, bunny: bunnyParts, pig: pigParts }

/** Where the bloom flower sits (top of the head). */
const HEAD_TOP: Record<AnimalKind, V3> = {
  critter: [0, 1.08, 0.1],
  sheep: [0, 1.02, 0.5],
  fox: [0, 1.08, 0.56],
  bunny: [0, 0.86, 0.3],
  pig: [0, 1.04, 0.7],
}

const geoCache = new Map<string, THREE.BufferGeometry>()
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key)
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}

/* ---------- Shared materials ---------- */

const SHELL_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0.35, 0.75, 1.6),
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
})
const SKELETON_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.6, 3), toneMapped: false })
const ICE_MAT = new THREE.MeshStandardMaterial({
  color: '#cbeeff',
  emissive: '#5ec4ff',
  emissiveIntensity: 0.35,
  roughness: 0.08,
  metalness: 0.1,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  flatShading: true,
})
const FLOWER_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true })
const ICE_GEO = new THREE.IcosahedronGeometry(1, 0)

const ELECTRIC = new THREE.Color(0.45, 0.85, 1.0)
const WHITE = new THREE.Color(1, 1, 1)
const ICY = new THREE.Color('#9fdcff')
const CHAR = new THREE.Color('#1c1a1e')
const PINK = new THREE.Color('#ff6fb5')
const BLACK = new THREE.Color(0, 0, 0)

/** The sheep model's head points along +x; turn it to face +z like the others. */
const SHEEP_YAW = -Math.PI / 2

/* ---------- Particles helpers (one reusable options object) ---------- */

const P_HEART = new THREE.Color('#ff5fa2')
const P_PETAL = new THREE.Color('#ffc2dc')
const P_ICE = new THREE.Color('#d8f4ff')
const P_DUST = new THREE.Color('#bba98c')
const P_STAR = new THREE.Color('#ffe066')
const P_SMOKE = new THREE.Color('#5a5a62')
const P_SPARK = new THREE.Color('#9be7ff')
const opts: Emit = { count: 0, x: 0, y: 0, z: 0, speed: [0, 0], color: P_HEART, size: [0, 0], life: [0, 0] }

function puff(o: Partial<Emit> & Pick<Emit, 'count' | 'x' | 'y' | 'z' | 'color'>) {
  opts.spread = 0
  opts.up = 0.3
  opts.color2 = undefined
  opts.hdr = 1
  opts.gravity = 0
  opts.drag = 0
  opts.shape = SHAPE.glow
  opts.grow = false
  opts.speed = [1, 2]
  opts.size = [0.2, 0.3]
  opts.life = [0.5, 0.8]
  Object.assign(opts, o)
  emit(opts)
}

/* ---------- Rig ---------- */

interface Rig {
  outer: THREE.Group
  scaler: THREE.Group
  pivot: THREE.Group
  body: THREE.Object3D
  shell: THREE.Object3D
  skeleton: THREE.Object3D
  ice: THREE.Mesh
  flower: THREE.Mesh
  mats: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[]
  tinted: boolean
}

function makeRig(a: Animal, body: THREE.Object3D, shell: THREE.Object3D, mats: THREE.MeshStandardMaterial[]): Rig {
  const h = a.spec.height
  const outer = new THREE.Group()
  outer.name = `animal:${a.kind}:${a.id}`
  outer.userData.animal = a
  const scaler = new THREE.Group()
  // Rotations (flips, tumbles, falls) pivot around the body's middle; scaling stays anchored at the feet.
  const pivot = new THREE.Group()
  const offset = new THREE.Group()
  offset.position.y = -h * 0.5
  const skeleton = new THREE.Mesh(
    cached(`bones:${a.kind}`, () => bake(skeletonParts(BONES[a.kind]))),
    SKELETON_MAT,
  )
  const flower = new THREE.Mesh(cached('flower', () => bake(flowerParts())), FLOWER_MAT)
  flower.position.set(...HEAD_TOP[a.kind])
  const ice = new THREE.Mesh(ICE_GEO, ICE_MAT)
  ice.position.y = h * 0.5
  ice.scale.set(a.spec.radius * 1.9, h * 0.75, a.spec.radius * 1.9)
  shell.scale.multiplyScalar(1.05)
  for (const o of [shell, skeleton, ice, flower]) o.visible = false
  offset.add(body, shell, skeleton, flower, ice)
  pivot.add(offset)
  scaler.add(pivot)
  outer.add(scaler)
  return { outer, scaler, pivot, body, shell, skeleton, ice, flower, mats: mats.map((mat) => ({ mat, base: mat.color.clone() })), tinted: false }
}

/** Per-frame pose, written by `think` and applied to the rig. One shared scratch object (no allocations). */
const pose = {
  ox: 0, oy: 0, oz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
  tint: WHITE as THREE.Color, tintAmt: 0, emis: BLACK as THREE.Color, emisI: 0,
  body: true, shell: false, skeleton: false, ice: false, flower: 0,
}

const smooth = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}
/** 0 -> 1 with a springy overshoot. */
const springIn = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return 1 - Math.cos(t * Math.PI * 2.5) * Math.exp(-t * 5)
}
/** Holds 1 in the middle of [0, dur], springing in over `inT` and easing out over `outT`. */
const envelope = (t: number, dur: number, inT: number, outT: number) => Math.min(springIn(t / inT), smooth((dur - t) / outT))
const jitter = (amp: number) => (Math.random() - 0.5) * 2 * amp

const fleeFrom = new THREE.Vector2()

/** AI, physics and the spell reaction for one animal; fills `pose`. */
function think(a: Animal, dt: number, time: number) {
  const spec = a.spec
  const h = spec.height
  pose.ox = pose.oy = pose.oz = pose.rx = pose.ry = pose.rz = 0
  pose.sx = pose.sy = pose.sz = 1
  pose.tintAmt = 0
  pose.emisI = 0
  pose.tint = WHITE
  pose.emis = BLACK
  pose.body = true
  pose.shell = pose.skeleton = pose.ice = false
  pose.flower = 0

  const eff = a.effect
  let id = eff ? eff.spell.id : null
  let et = 0
  let R = 1
  if (eff) {
    eff.t += dt
    et = eff.t
    R = eff.spell.react
    if (et >= R) {
      // Rough spells end with the animal running off.
      if (id === 'rockDrop' || id === 'carRun' || id === 'gunShot' || id === 'lightning') a.flee = 1.8
      a.effect = null
      id = null
    }
  }
  const impact = id ? (IMPACT[id] ?? 0) : 0
  const sinceHit = et - impact
  const firstHit = !!eff && id !== null && !eff.hit && et >= impact
  if (firstHit) eff!.hit = true
  let canWalk = id === null || id === 'shrink'
  let speedMul = id === 'shrink' ? 1.7 : 1
  let scale = 1
  const x = a.pos.x, y = a.pos.y, z = a.pos.z

  switch (id) {
    case 'bloom': {
      const env = smooth(et / 0.2) * smooth((R - et) / 0.4)
      const s = Math.abs(Math.sin(et * 8.5))
      pose.oy += s * 0.5 * env
      pose.sy *= 1 + (s - 0.5) * 0.16 * env
      pose.ry = Math.sin(et * 5) * 0.5 * env
      pose.emis = PINK
      pose.emisI = 0.35 * env
      pose.flower = springIn(et / 0.5) * smooth((R - et) / 0.3)
      if (eff!.t - eff!.tick > 0.32) {
        eff!.tick = eff!.t
        puff({ count: 2, x, y: y + h * 1.05, z, color: P_HEART, shape: SHAPE.heart, up: 0.95, speed: [1.2, 2], size: [0.3, 0.42], life: [1, 1.3], gravity: -0.6, drag: 1.4, spread: 0.3 })
        puff({ count: 3, x, y: y + h * 0.8, z, color: P_PETAL, color2: P_HEART, up: 0.5, speed: [1.5, 3], size: [0.12, 0.2], life: [0.8, 1.2], gravity: 2, drag: 1, spread: 0.3 })
      }
      break
    }
    case 'shrink':
      scale = THREE.MathUtils.lerp(1, 0.38, envelope(et, R, 0.5, 0.45))
      pose.rz = Math.sin(et * 28) * 0.05
      break
    case 'grow': {
      const e = envelope(et, R, 0.6, 0.5)
      scale = THREE.MathUtils.lerp(1, 2.2, e)
      // Heavy stomps while giant.
      const stomp = Math.max(0, Math.sin(et * 7))
      pose.oy += stomp * 0.12 * e
      pose.rz = Math.sin(et * 3.5) * 0.12 * e
      if (eff!.t - eff!.tick > 0.9 && e > 0.8) {
        eff!.tick = eff!.t
        puff({ count: 10, x, y: y + 0.1, z, color: P_DUST, shape: SHAPE.smoke, up: 0.15, speed: [1.5, 3], size: [0.4, 0.7], life: [0.6, 0.9], drag: 3, grow: true, spread: 0.8 })
      }
      break
    }
    case 'freeze': {
      const breakAt = R - 0.55
      const frozen = et < breakAt
      pose.tint = ICY
      pose.tintAmt = frozen ? 0.8 * smooth(et / 0.2) : 0.8 * (1 - smooth((et - breakAt) / 0.5))
      pose.emis = ICY
      pose.emisI = pose.tintAmt * 0.35
      pose.ice = frozen
      if (frozen && et > breakAt - 0.5) pose.ox = Math.sin(et * 90) * 0.035 // the ice starts to crack
      if (!frozen && !eff!.ended) {
        eff!.ended = true
        puff({ count: 26, x, y: y + h * 0.5, z, color: P_ICE, color2: ICY, shape: SHAPE.shard, hdr: 1.4, up: 0.5, speed: [3, 6], size: [0.14, 0.26], life: [0.6, 1], gravity: 14, spread: 0.4 })
      }
      if (!frozen) pose.rz = Math.sin((et - breakAt) * 40) * 0.15 * (1 - smooth((et - breakAt) / 0.5))
      break
    }
    case 'bounce': {
      if (firstHit) {
        a.vy = 11
        a.grounded = false
        puff({ count: 14, x, y: y + 0.1, z, color: P_STAR, shape: SHAPE.star, hdr: 1.6, up: 0.4, speed: [2, 4], size: [0.25, 0.35], life: [0.4, 0.7], spread: 0.3 })
      }
      // Exactly two front flips over the jump's air time.
      const air = (2 * 11) / 24
      pose.rx = smooth(et / air) * Math.PI * 4
      break
    }
    case 'rockDrop': {
      if (sinceHit < 0) {
        // Looks up at the falling rock, trembling.
        pose.rx = -0.35 * smooth(et / 0.3)
        pose.ox = Math.sin(et * 70) * 0.025
      } else {
        // Flattened like a pancake, then pops back up, dizzy.
        const flat = 1 - springIn((sinceHit - 0.9) / 0.5)
        pose.sy *= THREE.MathUtils.lerp(1, 0.25, flat)
        pose.sx *= THREE.MathUtils.lerp(1, 1.5, flat)
        pose.sz *= THREE.MathUtils.lerp(1, 1.5, flat)
        const dizzy = sinceHit > 0.9 ? 1 - smooth((sinceHit - 0.9) / (R - impact - 0.9)) : 0
        pose.rz = Math.sin(time * 9) * 0.22 * dizzy
        pose.ry = Math.sin(time * 4.5) * 0.4 * dizzy
        if (dizzy > 0.1 && eff!.t - eff!.tick > 0.18) {
          eff!.tick = eff!.t
          const ang = time * 6
          puff({ count: 1, x: x + Math.cos(ang) * 0.4, y: y + h + 0.15, z: z + Math.sin(ang) * 0.4, color: P_STAR, shape: SHAPE.star, hdr: 1.5, up: 1, speed: [0.2, 0.4], size: [0.22, 0.3], life: [0.5, 0.6] })
        }
      }
      break
    }
    case 'carRun': {
      const air = (2 * 6.5) / 24
      if (sinceHit < 0) {
        pose.ox = Math.sin(et * 60) * 0.02
        pose.sy *= 1.06 // startled
      } else {
        if (firstHit) {
          a.vy = 6.5
          a.grounded = false
          a.kick.set(eff!.dir.x * 7, eff!.dir.z * 7)
          // Side-on to the car so the tumble rolls along its path.
          a.yaw = Math.atan2(eff!.dir.x, eff!.dir.z) + Math.PI / 2
          puff({ count: 12, x, y: y + h * 0.5, z, color: P_STAR, shape: SHAPE.star, hdr: 1.6, up: 0.5, speed: [2, 4], size: [0.22, 0.32], life: [0.4, 0.6] })
        }
        const getUp = smooth((sinceHit - 1.5) / 0.35)
        // Tumbles a full roll and a quarter, lies on its side, then scrambles up.
        pose.rz = smooth(sinceHit / air) * (Math.PI * 2.5) * (1 - getUp) + getUp * Math.PI * 2
        pose.oy = -h * 0.2 * smooth(sinceHit / air) * (1 - getUp)
        if (sinceHit > air && sinceHit < 1.5) pose.ry = Math.sin(time * 30) * 0.06 // twitch
      }
      break
    }
    case 'gunShot': {
      // Flinches at each bullet, the last one knocks it over backwards.
      const flinch = Math.max(0, 1 - Math.abs(((et + 0.02) % 0.15) - 0.15) * 20)
      if (sinceHit < 0) pose.ox = jitter(0.04) * flinch
      else {
        if (firstHit) {
          a.yaw = Math.atan2(eff!.from.x - a.pos.x, eff!.from.z - a.pos.z)
          a.kick.set(eff!.dir.x * 4.5, eff!.dir.z * 4.5)
          a.vy = 3
          a.grounded = false
        }
        const getUp = smooth((sinceHit - 1.4) / 0.35)
        pose.rx = -(Math.PI / 2) * smooth(sinceHit / 0.25) * (1 - getUp)
        pose.oy = -h * 0.22 * smooth(sinceHit / 0.25) * (1 - getUp)
        if (sinceHit > 0.3 && sinceHit < 1.4) pose.rz = Math.sin(time * 26) * 0.05
      }
      break
    }
    case 'lightning': {
      const shock = 1.3
      if (et < shock) {
        // Strobing between a white-hot body and an x-ray flash of the skeleton, shaking all over.
        const xray = Math.floor(et * 16) % 2 === 1
        pose.body = !xray
        pose.shell = xray
        pose.skeleton = xray
        pose.tint = ELECTRIC
        pose.tintAmt = 0.65
        pose.emis = ELECTRIC
        pose.emisI = 0.7 + Math.random() * 0.9
        pose.ox = jitter(0.07)
        pose.oy = Math.abs(jitter(0.06))
        pose.oz = jitter(0.07)
        pose.rz = jitter(0.14)
        pose.rx = jitter(0.08)
        const j = 1 + jitter(0.07)
        pose.sx *= j
        pose.sy *= 1.08 + jitter(0.06)
        pose.sz *= j
        if (eff!.t - eff!.tick > 0.07) {
          eff!.tick = eff!.t
          puff({ count: 3, x, y: y + h * 0.6, z, color: P_SPARK, color2: WHITE, hdr: 3, up: 0.3, speed: [2, 5], size: [0.08, 0.14], life: [0.15, 0.3], gravity: 9, spread: spec.radius })
        }
      } else {
        // Singed and smoking, then a quick shake-off.
        const k = (et - shock) / (R - shock)
        pose.tint = CHAR
        pose.tintAmt = 0.8 * (1 - smooth(k * 1.2))
        const shake = Math.max(0, Math.sin(k * Math.PI * 1.4))
        pose.rz = Math.sin(et * 38) * 0.18 * shake * (k > 0.25 ? 1 : 0)
        if (eff!.t - eff!.tick > 0.14 && k < 0.7) {
          eff!.tick = eff!.t
          puff({ count: 1, x: x + jitter(0.2), y: y + h * 0.9, z: z + jitter(0.2), color: P_SMOKE, shape: SHAPE.smoke, up: 1, speed: [0.6, 1], size: [0.3, 0.45], life: [0.8, 1.2], grow: true, drag: 0.5 })
        }
      }
      break
    }
  }

  // ---- Wandering, fleeing and the occasional pause. ----
  if (a.flee > 0 && id === null) {
    a.flee -= dt
    canWalk = true
    speedMul = 2.4
    fleeFrom.set(a.pos.x - player.pos.x, a.pos.z - player.pos.z)
    if (fleeFrom.lengthSq() < 1e-4) fleeFrom.set(1, 0)
    fleeFrom.normalize()
    a.wander.set(a.pos.x + fleeFrom.x * 6, 0, a.pos.z + fleeFrom.y * 6)
    // Don't run too far from home.
    if (Math.hypot(a.pos.x - a.home.x, a.pos.z - a.home.z) > a.home.r * 2) a.flee = 0
  }
  let moving = false
  if (canWalk && a.grounded) {
    if (a.pause > 0 && a.flee <= 0) a.pause -= dt
    else {
      const dx = a.wander.x - a.pos.x, dz = a.wander.z - a.pos.z
      const d = Math.hypot(dx, dz)
      if (d < 0.8) {
        pickWander(a)
        a.pause = 0.8 + Math.random() * 3
      } else {
        const step = Math.min(d, spec.speed * speedMul * dt)
        const nx = a.pos.x + (dx / d) * step, nz = a.pos.z + (dz / d) * step
        if (dryLand(nx, nz)) {
          const px = a.pos.x, pz = a.pos.z
          a.pos.x = nx
          a.pos.z = nz
          resolve(a.pos, spec.radius * a.scale, a.pos.y)
          // Blocked by a prop: give up on this target after a moment.
          const progress = Math.hypot(a.pos.x - px, a.pos.z - pz)
          a.stuck = progress < step * 0.3 ? a.stuck + dt : 0
          if (a.stuck > 0.6) {
            a.stuck = 0
            a.flee = 0
            pickWander(a)
          }
          moving = true
        } else {
          a.flee = 0
          pickWander(a)
        }
        let dy = Math.atan2(dx, dz) - a.yaw
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        a.yaw += dy * Math.min(1, dt * 8)
      }
    }
  }

  // ---- Knock-back slide and gravity. ----
  if (a.kick.lengthSq() > 1e-4) {
    const nx = a.pos.x + a.kick.x * dt, nz = a.pos.z + a.kick.y * dt
    if (dryLand(nx, nz)) {
      a.pos.x = nx
      a.pos.z = nz
      resolve(a.pos, spec.radius * a.scale, a.pos.y)
    } else a.kick.set(0, 0)
    a.kick.multiplyScalar(a.grounded ? Math.exp(-dt * 7) : 1)
  }
  const ground = Math.max(heightAt(a.pos.x, a.pos.z), WATER_LEVEL)
  a.vy -= 24 * dt
  a.pos.y += a.vy * dt
  if (a.pos.y <= ground) {
    if (!a.grounded && a.vy < -5) a.squash = Math.min(1, -a.vy / 14)
    a.pos.y = ground
    a.vy = 0
    a.grounded = true
  } else if (a.pos.y > ground + 0.05) a.grounded = false

  // ---- Gait. ----
  if (moving) {
    a.phase += dt * (spec.gait === 'hop' ? 7 : 9) * Math.min(speedMul, 1.8)
    const s = Math.abs(Math.sin(a.phase))
    if (spec.gait === 'hop') {
      pose.oy += s * 0.16 * h
      pose.sy *= 1 - Math.pow(1 - s, 4) * 0.12
    } else {
      pose.rz += Math.sin(a.phase) * 0.07
      pose.oy += s * 0.04
      pose.rx += 0.05
    }
  } else if (id === null) {
    // Idle: breathing, and grazers dip their heads now and then.
    pose.sy *= 1 + Math.sin(time * 2.2 + a.id) * 0.02
    if (spec.gait === 'waddle') pose.rx += Math.max(0, Math.sin(time * 0.9 + a.id * 1.3)) * 0.12
  }

  // ---- Squash from being bounced on, or a hard landing. ----
  a.squash = Math.max(0, a.squash - dt * 3)
  pose.sy *= 1 - a.squash * 0.4
  pose.sx *= 1 + a.squash * 0.3
  pose.sz *= 1 + a.squash * 0.3
  a.scale = scale

  // ---- Mario-style bounce: the player landing on top bounces off. ----
  const r = spec.radius * scale
  const above = player.pos.y - a.pos.y
  if (
    world.get().playing &&
    player.vy < -0.5 &&
    Math.hypot(player.pos.x - a.pos.x, player.pos.z - a.pos.z) < r + 0.35 &&
    above > h * scale * 0.45 &&
    above < h * scale + 1.2
  ) {
    player.pos.y = a.pos.y + h * scale + 0.05
    player.bounce = 10
    a.squash = 1
    play('move')
  }
}

function applyPose(rig: Rig, a: Animal) {
  const h = a.spec.height
  rig.outer.position.copy(a.pos)
  rig.outer.rotation.y = a.yaw + pose.ry
  rig.scaler.scale.set(a.scale * pose.sx, a.scale * pose.sy, a.scale * pose.sz)
  rig.pivot.position.set(pose.ox, h * 0.5 + pose.oy, pose.oz)
  rig.pivot.rotation.set(pose.rx, 0, pose.rz)
  rig.body.visible = pose.body
  rig.shell.visible = pose.shell
  rig.skeleton.visible = pose.skeleton
  rig.ice.visible = pose.ice
  rig.flower.visible = pose.flower > 0.01
  if (rig.flower.visible) rig.flower.scale.setScalar(pose.flower * 1.6)
  if (pose.tintAmt > 0 || pose.emisI > 0) {
    for (const m of rig.mats) {
      m.mat.color.copy(m.base).lerp(pose.tint, pose.tintAmt)
      m.mat.emissive.copy(pose.emis)
      m.mat.emissiveIntensity = pose.emisI
    }
    rig.tinted = true
  } else if (rig.tinted) {
    for (const m of rig.mats) {
      m.mat.color.copy(m.base)
      m.mat.emissive.copy(BLACK)
      m.mat.emissiveIntensity = 0
    }
    rig.tinted = false
  }
}

function useAnimalFrame(a: Animal, rig: Rig) {
  useFrame(({ clock }, rawDt) => {
    if (world.get().open !== null) return
    think(a, Math.min(rawDt, 0.05), clock.elapsedTime)
    applyPose(rig, a)
  })
}

/* ---------- Animal views ---------- */

function ProceduralAnimal({ a }: { a: Animal }) {
  const rig = useMemo(() => {
    const kind = a.kind as Exclude<AnimalKind, 'sheep'>
    const geo = cached(`body:${kind}`, () => bake(BODY_PARTS[kind]()))
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78 })
    const body = new THREE.Mesh(geo, mat)
    body.castShadow = true
    const shell = new THREE.Mesh(geo, SHELL_MAT)
    return makeRig(a, body, shell, [mat])
  }, [a])
  useAnimalFrame(a, rig)
  return <primitive object={rig.outer} />
}

function SheepAnimal({ a }: { a: Animal }) {
  const model = useModel('sheep', a.spec.height)
  const rig = useMemo(() => {
    // Own materials per sheep so the tint of one doesn't colour the flock.
    const mats: THREE.MeshStandardMaterial[] = []
    const body = model.clone(true)
    body.rotation.y = SHEEP_YAW
    body.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone()
        m.material = mat
        mats.push(mat)
      }
    })
    const shell = model.clone(true)
    shell.rotation.y = SHEEP_YAW
    shell.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.material = SHELL_MAT
        m.castShadow = false
      }
    })
    return makeRig(a, body, shell, mats)
  }, [a, model])
  useAnimalFrame(a, rig)
  return <primitive object={rig.outer} />
}

const zapTo = new THREE.Vector3()

/** Casting: F (or right click) fires a random spell at the nearest animal, or zaps an enemy in a fight. */
function Caster() {
  const cooldown = useRef(0)
  useFrame((_, dt) => {
    cooldown.current = Math.max(0, cooldown.current - dt)
    if (!controls.cast) return
    controls.cast = false
    if (cooldown.current > 0 || world.get().open !== null) return
    cooldown.current = 0.35
    // In a mission fight the cast is a ranged zap at the nearest enemy; otherwise a random spell at an animal.
    const e = fight ? nearestEnemy(player.pos.x, player.pos.z, 22) : null
    if (e) {
      zapTo.set(e.pos.x, e.pos.y + 0.5, e.pos.z)
      player.yaw = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
      castZap(player.pos, zapTo, player.yaw)
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) || 1
      damage(e, 1, (e.pos.x - player.pos.x) / d, (e.pos.z - player.pos.z) / d, 6, 4)
      impact(0.05, 0.2)
      return
    }
    castSpell(randomSpell(), player.pos, player.yaw)
    play('select')
  })
  return null
}

export function Animals({ casting }: { casting: boolean }) {
  const list = useMemo(() => animals(), [])
  return (
    <>
      {list.map((a) =>
        a.kind === 'sheep' ? (
          <Suspense key={a.id} fallback={null}>
            <SheepAnimal a={a} />
          </Suspense>
        ) : (
          <ProceduralAnimal key={a.id} a={a} />
        ),
      )}
      {casting && <Caster />}
    </>
  )
}
