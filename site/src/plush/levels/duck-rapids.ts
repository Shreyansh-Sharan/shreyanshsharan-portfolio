// Rubber Duck Rapids (race). A river race down a filling bathtub: hop across bobbing rubber ducks that tip
// under your weight, choose the soap-bar fast lane (slippery, quick) or the squishy sponge lane, then cross the
// rapids on pairs of ducks swept side to side by the tap's current. Fall in and you float back to your last
// island. The water keeps rising, flooding the low tiers of the islands as the course shrinks to the plug end.
// Tricks: grease a rival's soap bar, cannonball their duck so it tips, and (mean spice) turn on the hot tap
// for a flood surge.
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import {
  Course, airAim, bake, canvasTex, finishArch, follow, hash01, mat, mover, poseOf, raceHud, raceInit, racePack, raceRank, raceRespawn, raceSpawn, raceSpeedHazard,
  raceTick, raceUnpack, rbox, solid, type BotMem, type Mover, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#38bdf8'
const TUB = { x: 7, z0: -48, z1: 44, rim: 3 }
const DUCK_ROWS = [-37, -33.7, -30.4, -27.1, -23.8, -20.5]
const LANES = [-4.2, 0, 4.2]
const SOAPS = [-9.0, -3.2, 2.6]
const SOAP_X = -3.6
const SPONGES = [-10.3, -6.6, -2.9, 0.8, 4.5]
const SPONGE_X = 2.6
const RAPID_ROWS = [14.8, 18.4, 22, 25.6, 29.2, 32.8]
const STREAM = { z0: 16.5, z1: 23.5, push: 1.4 }
const DUCK_R = 1.25
const RISE_T = 95

type Kind = 0 | 1 | 2 | 3 // duck, soap, sponge, rapids duck
interface Float {
  kind: Kind
  x: number
  z: number
  phase: number
  /** Rapids: row and which of the pair. */
  row: number
  side: number
}

const FLOATS: Float[] = []
DUCK_ROWS.forEach((z, r) => LANES.forEach((x, l) => FLOATS.push({ kind: 0, x, z, phase: hash01(r, l) * 6.28, row: r, side: 0 })))
SOAPS.forEach((z, i) => FLOATS.push({ kind: 1, x: SOAP_X, z, phase: i * 1.7, row: i, side: 0 }))
SPONGES.forEach((z, i) => FLOATS.push({ kind: 2, x: SPONGE_X, z, phase: i * 1.3, row: i, side: 0 }))
RAPID_ROWS.forEach((z, r) => [-1, 1].forEach((side) => FLOATS.push({ kind: 3, x: 0, z, phase: hash01(r, 9) * 6.28, row: r, side })))

/** Which floats use which synced field (keeps the snapshot small). */
const TIPPY = FLOATS.flatMap((f, i) => (f.kind === 0 || f.kind === 3 ? [i] : []))
const SQUISHY = FLOATS.flatMap((f, i) => (f.kind === 2 ? [i] : []))
const SOAPY = FLOATS.flatMap((f, i) => (f.kind === 1 ? [i] : []))

interface DRState {
  race: RaceState
  /** Round time the hot tap was turned on (-99 never). */
  surge: number
  /** Tilt per float (pitch, roll), host-driven from who stands where. */
  tilt: number[]
  /** Sponge squish per float. */
  sink: number[]
  /** Soap greased until. */
  grease: number[]
  // Host only / every screen.
  movers: Mover[]
  vis: { water: THREE.Mesh | null; tex: THREE.Texture | null; foam: THREE.Mesh | null; stream: THREE.Mesh | null; lows: { mesh: THREE.Mesh; top: number }[] }
}

/** The water level at time t (rising, plus the hot-tap surge). */
function waterY(st: DRState, t: number) {
  const base = 0.05 + THREE.MathUtils.clamp(t / RISE_T, 0, 1)
  const e = t - st.surge
  const s = e < 0 || e > 9 ? 0 : e < 1.2 ? e / 1.2 : e > 7.8 ? (9 - e) / 1.2 : 1
  return base + s * 0.4
}

/** Rapids pair x for row r at time t: the pair glides across together, 3.6 m apart. */
function rapidX(r: number, side: number, t: number) {
  const s = Math.sin(t * (0.55 + r * 0.07) + RAPID_PHASE[r])
  return side * (1.8 + 2 * s * side)
}

function floatPos(st: DRState, i: number, t: number, out: THREE.Vector3) {
  const f = FLOATS[i]
  const w = waterY(st, t)
  const bob = Math.sin(t * 1.7 + f.phase) * 0.06
  if (f.kind === 0) return out.set(f.x + Math.sin(t * 0.5 + f.phase) * 0.5, w + 0.42 + bob - 0.3, f.z)
  if (f.kind === 1) return out.set(f.x, w + 0.28 + bob * 0.5 - 0.3, f.z)
  if (f.kind === 2) return out.set(f.x, w + 0.5 - (st.sink[i] ?? 0) - 0.5, f.z)
  return out.set(rapidX(f.row, f.side, t), w + 0.42 + bob - 0.3, f.z)
}

const _v = new THREE.Vector3()

function buildPath(route: number): Wp[] {
  const L = LANES[route % 3]
  const p: Wp[] = [{ x: L * 0.5, y: 2.1, z: -43, w: 1 }, { x: L, y: 2.1, z: -40.2, r: 0.8, jump: 1.2 }]
  for (const z of DUCK_ROWS) p.push({ x: L, y: 1, z, r: 0.9 })
  p.push({ x: L * 0.5, y: 1.2, z: -16, w: 1.5 })
  // Off the high tier of the island (the low one floods later on).
  if (route % 2 === 0) {
    p.push({ x: -2.1, y: 1.6, z: -13.7, r: 0.7, jump: 0.9 })
    for (const z of SOAPS) p.push({ x: SOAP_X, y: 1, z: z + 1.4, r: 1.3 })
  } else {
    p.push({ x: 2.1, y: 1.6, z: -13.7, r: 0.7, jump: 0.9 })
    for (const z of SPONGES) p.push({ x: SPONGE_X, y: 1, z, r: 1.1 })
  }
  p.push({ x: 0, y: 1.75, z: 9.3, w: 1.5 }, { x: 0, y: 1.75, z: 11, r: 1.2 })
  for (const z of RAPID_ROWS) p.push({ x: 0, y: 1, z, r: 1.6, w: 1 })
  p.push({ x: 0, y: 1.25, z: 35.3, w: 2, r: 1 }, { x: 0, y: 2.1, z: 37.8, w: 2 })
  return p
}

const RAPID_PHASE = RAPID_ROWS.map((_z, r) => hash01(r, 9) * 6.28)
const PATHS = [0, 1, 2, 3, 4, 5].map(buildPath)
const RAPIDS_START = PATHS.map((p) => p.findIndex((w) => Math.abs(w.z - 11) < 0.01))

const course = new Course({
  path: PATHS[1],
  cps: [
    { x: 0, y: 0.75, z: -15.6, hx: 6.2, hz: 3.6, yaw: 0, name: 'Soap dish', spot: { x: 0, y: 1.6, z: -15.7, hx: 2.3, hz: 2.3 } },
    { x: 0, y: 0.9, z: 9.3, hx: 6.4, hz: 3.1, yaw: 0, name: 'Shampoo island', spot: { x: 0, y: 1.75, z: 9.3, hx: 2, hz: 1.9 } },
  ],
  finish: { x: 0, y: 2.1, z: 37.4, hx: 6.6, hz: 1.2 },
  podium: { x: 0, y: 2.1, z: 41.4, yaw: Math.PI },
})

function rippleTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#7dd3fc'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(255,255,255,0.35)'
    g.lineWidth = 3
    for (let i = 0; i < 18; i++) {
      g.beginPath()
      const y = (i * 37) % h, x = (i * 53) % w
      g.ellipse(x, y, 14 + (i % 4) * 6, 5, 0, 0, Math.PI * 2)
      g.stroke()
    }
  }, [5, 30])
}

function tileTex() {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#e0f2fe'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#93c5fd'
    g.lineWidth = 3
    g.strokeRect(1, 1, w / 2 - 2, h / 2 - 2)
    g.strokeRect(w / 2 + 1, 1, w / 2 - 2, h / 2 - 2)
    g.strokeRect(1, h / 2 + 1, w / 2 - 2, h / 2 - 2)
    g.strokeRect(w / 2 + 1, h / 2 + 1, w / 2 - 2, h / 2 - 2)
  }, [10, 6])
}

function spongeTex() {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#fde047'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#eab308'
    for (let i = 0; i < 26; i++) {
      g.beginPath()
      g.arc((i * 23) % w, (i * 41) % h, 2 + (i % 3), 0, Math.PI * 2)
      g.fill()
    }
  })
}

/** Shared duck parts (one geometry and material set for every duck). */
function duckFactory() {
  const body = new THREE.SphereGeometry(1, 16, 10)
  const head = new THREE.SphereGeometry(0.55, 12, 8)
  const beak = new THREE.ConeGeometry(0.22, 0.5, 8).rotateX(Math.PI / 2)
  const eye = new THREE.SphereGeometry(0.09, 6, 4)
  const yellow = mat('#facc15', { roughness: 0.35 })
  const orange = mat('#f97316', { roughness: 0.4 })
  const black = mat('#111827')
  // Build one duck, bake it into a single vertex-coloured mesh, and share that for every duck.
  const proto = (() => {
    const g = new THREE.Group()
    const b = new THREE.Mesh(body, yellow)
    b.scale.set(DUCK_R * 1.02, 0.55, DUCK_R * 1.18)
    b.position.y = 0
    const h = new THREE.Mesh(head, yellow)
    h.position.set(0, 0.55, 0.85)
    const k = new THREE.Mesh(beak, orange)
    k.position.set(0, 0.5, 1.45)
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eye, black)
      e.position.set(s * 0.3, 0.72, 1.28)
      g.add(e)
    }
    g.add(b, h, k)
    return bake(g, { roughness: 0.35 }).children[0] as THREE.Mesh
  })()
  return (scale = 1) => {
    const m = new THREE.Mesh(proto.geometry, proto.material)
    m.scale.setScalar(scale)
    m.castShadow = m.receiveShadow = true
    return m
  }
}

function onFloat(st: DRState, toy: Toy) {
  for (let i = 0; i < st.movers.length; i++) {
    const m = st.movers[i]
    if (Math.abs(m.obj.position.z - toy.pos.z) > 3 || Math.abs(m.obj.position.x - toy.pos.x) > 3) continue
    if (m.carrying(toy)) return i
  }
  return -1
}

function tipKick(ctx: LevelCtx, st: DRState, i: number) {
  st.tilt[i * 2] = ctx.rng.chance(0.5) ? 0.45 : -0.45
  st.tilt[i * 2 + 1] = ctx.rng.chance(0.5) ? 0.45 : -0.45
}

export default defineLevel<DRState>({
  id: 'duck-rapids',
  name: 'Rubber Duck Rapids',
  type: 'race',
  blurb: 'Race down a filling bathtub on bobbing ducks, slippery soap bars and squishy sponges.',
  howTo: [
    'Hop duck to duck: they tip towards whoever stands on them',
    'Soap bars are a slippery fast lane, sponges are slow but steady',
    'Fall in and you float back to the last island',
    'The water keeps rising: the low tiers of the islands flood',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 150,
  camera: { kind: 'chase', dist: 7.2 },
  introOrbit: { radius: 26, height: 16, center: [0, 0, -2] },
  sprinkles: { start: 1 },
  fallY: -5,
  sky: { color: '#1f2a33', fogNear: 60, fogFar: 170 },

  tricks: [
    {
      id: 'grease',
      name: 'Grease the Soap',
      icon: 'milk',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'Rub extra soap on the bar a rival is on: it gets wildly slippery for 3.5 seconds.',
      counter: 'Jump to the next bar, or take the sponge lane.',
      can: (_c, _s, _u, t) => (t && Math.abs(t.pos.x - SOAP_X) < 2.5 && t.pos.z > -12.5 && t.pos.z < 5 ? true : 'Only on the soap lane'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        let best = -1, bd = 99
        FLOATS.forEach((f, i) => {
          if (f.kind !== 1) return
          const d = Math.abs(f.z - target.pos.z)
          if (d < bd) {
            bd = d
            best = i
          }
        })
        if (best >= 0) s.grease[best] = ctx.time + 3.5
        ctx.fx.popup(target, 'Greased!', '#bae6fd')
        ctx.fx.sfx('squeak', target.pos)
      },
      botUse: (ctx, _s, user) => ctx.toys.find((t) => t !== user && t.status === 'play' && Math.abs(t.pos.x - SOAP_X) < 2 && t.pos.z > -12 && t.pos.z < 5) ?? false,
    },
    {
      id: 'cannon',
      name: 'Cannonball',
      icon: 'crack',
      cost: 2,
      cooldown: 9,
      busy: 0.8,
      target: 'rival',
      desc: 'A big splash next to a rival: the duck or sponge under them tips right over.',
      counter: 'Hop to another float before it tips.',
      can: (_c, s, _u, t) => (t && onFloat(s, t) >= 0 ? true : 'Only on a float'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const i = onFloat(s, target)
        if (i >= 0) tipKick(ctx, s, i)
        ctx.knock(target, { x: ctx.rng.range(-1.5, 1.5), y: 2.5, z: 0 }, 0.3)
        ctx.fx.sfx('splash', target.pos)
        ctx.fx.puff(target.pos, 'milk', 16)
      },
    },
    {
      id: 'tap',
      name: 'Hot Tap',
      icon: 'zap',
      cost: 3,
      cooldown: 30,
      busy: 1.2,
      target: 'none',
      once: true,
      minSpice: 1,
      desc: 'Turn the tap right up: the water surges 40 cm for 8 seconds and floods the low tiers.',
      counter: 'Get to the high middle of an island, or stay on the floats (they rise too).',
      apply: (ctx, s, user) => {
        s.surge = ctx.time
        ctx.fx.say(`${user.name} turned on the hot tap!`, '#38bdf8', 1.8)
        ctx.fx.sfx('splash')
      },
      botUse: (ctx, s, user) => {
        const w = waterY(s, ctx.time)
        const low = ctx.toys.filter((t) => t !== user && t.status === 'play' && t.grounded && t.feet < w + 0.45 && onFloat(s, t) < 0).length
        return low >= 2 && user.feet > w + 0.8 ? null : false
      },
    },
    bubbleWrap<DRState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 30, hd: 66, ridge: 30, knee: 7, y: -4, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    // The tub: enamel walls with a rolled rim, gold claw feet, a tiled splashback.
    const enamel = mat('#f8fafc', { roughness: 0.25 })
    const L = TUB.z1 - TUB.z0, zc = (TUB.z0 + TUB.z1) / 2
    for (const s of [-1, 1]) {
      solid(ctx, { pos: [s * (TUB.x + 0.4), (TUB.rim - 4) / 2, zc], size: [0.8, TUB.rim + 4, L], material: enamel, round: 0.3 })
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, L, 12).rotateX(Math.PI / 2), enamel)
      rim.position.set(s * (TUB.x + 0.4), TUB.rim, zc)
      ctx.root.add(rim)
    }
    solid(ctx, { pos: [0, (TUB.rim - 4) / 2, TUB.z0 - 0.4], size: [TUB.x * 2 + 1.6, TUB.rim + 4, 0.8], material: enamel, round: 0.3 })
    solid(ctx, { pos: [0, (TUB.rim - 4) / 2, TUB.z1 + 0.4], size: [TUB.x * 2 + 1.6, TUB.rim + 4, 0.8], material: enamel, round: 0.3 })
    solid(ctx, { pos: [0, -3.2, zc], size: [TUB.x * 2, 0.4, L], material: mat('#e2e8f0') })
    const gold = mat('#d4a24c', { metalness: 0.8, roughness: 0.3 })
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), gold)
        foot.position.set(sx * (TUB.x - 0.5), -3.9, zc + sz * (L / 2 - 3))
        ctx.root.add(foot)
      }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(L + 6, 12), new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.4 }))
    wall.position.set(TUB.x + 3, 2, zc)
    wall.rotation.y = -Math.PI / 2
    ctx.root.add(wall)
    // Start and finish ledges (the ends of the tub), steps, and the islands (two tiers each).
    const ceramic = mat('#f1f5f9', { roughness: 0.3 })
    const blueC = mat('#bae6fd', { roughness: 0.3 })
    solid(ctx, { pos: [0, -0.95, (TUB.z0 - 39.6) / 2], size: [TUB.x * 2, 6.1, -39.6 - TUB.z0], material: blueC, round: 0.2 })
    solid(ctx, { pos: [0, -0.95, (36.2 + TUB.z1) / 2], size: [TUB.x * 2, 6.1, TUB.z1 - 36.2], material: blueC, round: 0.2 })
    solid(ctx, { pos: [0, -0.875, 35.3], size: [13, 4.25, 1.8], material: mat('#fde047'), round: 0.2 })
    const lows: DRState['vis']['lows'] = []
    const tier = (x0: number, x1: number, z0: number, z1: number, top: number, m: THREE.MeshStandardMaterial) => {
      const mesh = solid(ctx, { pos: [(x0 + x1) / 2, (top - 3) / 2, (z0 + z1) / 2], size: [x1 - x0, top + 3, z1 - z0], material: m.clone(), round: 0.25 })
      lows.push({ mesh, top })
    }
    tier(-6.2, 6.2, -19.2, -12, 0.75, ceramic)
    tier(-2.6, 2.6, -18.2, -13.2, 1.6, blueC)
    tier(-6.4, 6.4, 6.2, 12.4, 0.9, ceramic)
    tier(-2.2, 2.2, 7.2, 11.4, 1.75, mat('#fbcfe8', { roughness: 0.3 }))
    ;(ctx.root.userData as { lows?: unknown }).lows = lows
    // Shampoo bottles on the second island, and the taps.
    const bottle = (x: number, z: number, color: string) => {
      const b = new THREE.Mesh(rbox(1.5, 2.6, 1.0, 0.3), mat(color, { roughness: 0.3 }))
      b.position.set(x, 0.9 + 1.3, z)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.5, 10), mat('#f8fafc'))
      cap.position.set(x, 0.9 + 2.85, z)
      ctx.root.add(b, cap)
      ctx.phys.box({ x, y: 2.2, z }, { x: 0.75, y: 1.3, z: 0.5 })
    }
    bottle(-4.6, 11.6, '#ec4899')
    bottle(4.6, 11.6, '#22c55e')
    const label = textSprite('SHAMPOO', { color: '#ffffff', size: 0.3 })
    label.position.set(-4.6, 2.4, 11.05)
    ctx.root.add(label)
    const chrome = mat('#e5e7eb', { metalness: 0.9, roughness: 0.15 })
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 12).rotateZ(Math.PI / 2), chrome)
    tap.position.set(TUB.x - 0.5, 4.8, 20)
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), chrome)
    spout.position.set(TUB.x - 1.6, 4.4, 20)
    const knobs = [-1, 1].map((s) => {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 6), mat(s < 0 ? '#ef4444' : '#3b82f6'))
      k.position.set(TUB.x + 0.3, 5.3, 20 + s * 1.2)
      return k
    })
    ctx.root.add(tap, spout, ...knobs)
    // The plug and chain at the finish.
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.7, 0.3, 16), mat('#111827', { roughness: 0.4 }))
    plug.position.set(4.5, 2.25, 40)
    ctx.root.add(plug)
    const chain = new THREE.InstancedMesh(new THREE.TorusGeometry(0.16, 0.05, 6, 10), chrome, 12)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion()
    for (let i = 0; i < 12; i++) {
      q.setFromAxisAngle(_v.set(0, 0, 1), i % 2 ? Math.PI / 2 : 0)
      chain.setMatrixAt(i, m4.compose(_v.set(4.5 + i * 0.22, 2.3, 40 + i * 0.18), q, new THREE.Vector3(1, 1, 1)))
    }
    ctx.root.add(chain)
    finishArch(ctx, { x: 0, y: 2.1, z: 37.4, width: 13, color: ACCENT, text: 'PLUG END' })
    for (const c of course.cps) {
      const s = textSprite('Checkpoint', { bg: '#0369a1', size: 0.55 })
      s.position.set(c.x, (c.spot?.y ?? c.y) + 2.4, c.z)
      ctx.root.add(s)
    }
  },

  init(ctx) {
    const st: DRState = {
      race: raceInit(ctx),
      surge: -99,
      tilt: FLOATS.flatMap(() => [0, 0]),
      sink: FLOATS.map(() => 0),
      grease: FLOATS.map(() => 0),
      movers: [],
      vis: { water: null, tex: null, foam: null, stream: null, lows: ((ctx.root.userData as { lows?: DRState['vis']['lows'] }).lows ?? []) },
    }
    // Soap is a fast lane, sponges are slow.
    raceSpeedHazard(ctx, st.race, 5.6, (toy) => {
      const i = toy.data.float as number | undefined
      if (i === undefined || i < 0) return 1
      const k = FLOATS[i]?.kind
      return k === 1 ? 1.25 : k === 2 ? 0.8 : 1
    })
    const duck = duckFactory()
    const soapMats = [mat('#f9a8d4', { roughness: 0.2 }), mat('#a5f3fc', { roughness: 0.2 }), mat('#c4b5fd', { roughness: 0.2 })]
    const sponge = new THREE.MeshStandardMaterial({ map: spongeTex(), roughness: 1 })
    const scrub = mat('#16a34a', { roughness: 1 })
    FLOATS.forEach((f, i) => {
      let obj: THREE.Object3D
      let half: [number, number, number]
      let cyl = false
      if (f.kind === 0 || f.kind === 3) {
        obj = duck(f.kind === 3 ? 1.05 : 1)
        half = [DUCK_R, 0.3, DUCK_R]
        cyl = true
      } else if (f.kind === 1) {
        const g = new THREE.Group()
        const bar = new THREE.Mesh(rbox(2, 0.6, 5.4, 0.28), soapMats[i % 3])
        bar.castShadow = true
        const word = textSprite('SOAP', { color: '#ffffff', size: 0.5 })
        word.position.y = 0.45
        g.add(bar, word)
        obj = g
        half = [1, 0.3, 2.7]
      } else {
        const g = new THREE.Group()
        const body = new THREE.Mesh(rbox(3.2, 0.8, 3.2, 0.25), sponge)
        body.position.y = -0.1
        const top = new THREE.Mesh(rbox(3.2, 0.25, 3.2, 0.1), scrub)
        top.position.y = 0.38
        g.add(body, top)
        g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
        obj = g
        half = [1.6, 0.5, 1.6]
      }
      const m = mover(ctx, {
        half,
        obj,
        cyl,
        pose: (t, out) => {
          floatPos(st, i, t, _v)
          poseOf(out, _v.x, _v.y, _v.z, f.kind === 0 || f.kind === 3 ? Math.sin(t * 0.4 + f.phase) * 0.3 : 0, st.tilt[i * 2], st.tilt[i * 2 + 1])
          return true
        },
      })
      st.movers.push(m)
    })
    // Water forces on whoever stands on a float (predicted, so a player's own toy feels them at once):
    // tipped floats tip you off, greased soap slides you sideways, soap carries you forwards, the tap's current.
    ctx.hazards.add({
      predict: true,
      update() {},
      affect(c, toy, dt) {
        if (toy.status !== 'play' || toy.mode !== 'walk') return
        const i = onFloat(st, toy)
        toy.data.float = i
        if (i < 0) return
        const f = FLOATS[i]
        let vx = 0, vz = 0
        // Downhill on a tipped float.
        vx -= Math.sin(st.tilt[i * 2 + 1]) * 7
        vz += Math.sin(st.tilt[i * 2]) * 7
        if (f.kind === 1) {
          vz += 1.2
          if (st.grease[i] > c.time) vx += Math.sin(c.time * 3.2) * 4
        }
        if (f.kind === 3 && toy.pos.z > STREAM.z0 && toy.pos.z < STREAM.z1) vx -= STREAM.push
        if (vx === 0 && vz === 0) return
        const p = toy.body.translation()
        toy.body.setTranslation({ x: p.x + vx * dt, y: p.y, z: p.z + vz * dt }, true)
      },
    })
    // Water, foam and the tap's stream.
    const rt = rippleTex()
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(TUB.x * 2, TUB.z1 - TUB.z0).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: rt, color: '#bfe9ff', transparent: true, opacity: 0.8, roughness: 0.12, metalness: 0.1, depthWrite: false }),
    )
    water.position.set(0, 0.05, (TUB.z0 + TUB.z1) / 2)
    water.renderOrder = 2
    ctx.root.add(water)
    st.vis.water = water
    st.vis.tex = rt
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false }))
    stream.position.set(TUB.x - 1.6, 2, 20)
    ctx.root.add(stream)
    st.vis.stream = stream
    const foam = new THREE.Mesh(new THREE.CircleGeometry(2.2, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }))
    foam.position.set(TUB.x - 1.6, 0.1, 20)
    foam.renderOrder = 3
    ctx.root.add(foam)
    st.vis.foam = foam
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return raceSpawn(ctx, { x: 0, y: 2.1, z: -44.5, yaw: 0, cols: 7 }, i, n)
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    raceTick(ctx, st.race, course)
    const w = waterY(st, t)
    // Tipping and squishing: floats lean towards whoever stands on them.
    const wantX = new Array(FLOATS.length).fill(0), wantZ = new Array(FLOATS.length).fill(0), load = new Array(FLOATS.length).fill(0)
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      const i = onFloat(st, toy)
      if (i >= 0) {
        const m = st.movers[i]
        load[i]++
        wantZ[i] -= (toy.pos.x - m.obj.position.x) * 0.1
        wantX[i] += (toy.pos.z - m.obj.position.z) * 0.1
      }
      // In the water: float back to the last island.
      if (toy.feet < w - 0.12) {
        ctx.fx.sfx('splash', toy.pos)
        ctx.fx.puff({ x: toy.pos.x, y: w, z: toy.pos.z }, 'milk', 16)
        raceRespawn(ctx, st.race, course, toy, 'Splash!')
      }
    }
    const k = Math.min(1, dt * 1.6)
    FLOATS.forEach((f, i) => {
      if (f.kind === 1) return
      if (f.kind === 2) {
        st.sink[i] += ((load[i] ? Math.min(0.35, 0.18 + load[i] * 0.06) : 0) - st.sink[i]) * Math.min(1, dt * 4)
        return
      }
      const cap = 0.3
      st.tilt[i * 2] += (THREE.MathUtils.clamp(wantX[i], -cap, cap) - st.tilt[i * 2]) * k
      st.tilt[i * 2 + 1] += (THREE.MathUtils.clamp(wantZ[i], -cap, cap) - st.tilt[i * 2 + 1]) * k
    })
  },

  onFall(ctx, st, toy) {
    raceRespawn(ctx, st.race, course, toy, 'Splash!')
  },

  rank(ctx, st) {
    return raceRank(ctx, st.race, course)
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as BotMem
    const t = ctx.time
    if (d.route === undefined) d.route = Math.floor(hash01(toy.idx, ctx.seed, 2) * 6)
    const path = PATHS[d.route]
    // The rapids: line up with a duck in the next row, then hop on.
    if ((d.wp ?? 0) >= RAPIDS_START[d.route] && toy.pos.z > 6.5 && toy.pos.z < 34.2) {
      let row = -1
      RAPID_ROWS.forEach((z, r) => {
        if (Math.abs(toy.pos.z - z) < 1.5) row = r
      })
      const next = row + 1
      if (next >= RAPID_ROWS.length) {
        d.wp = path.length - 2
      } else {
        // The duck in the next row nearest us, where it will be in a moment.
        let bx = 0, bd = 99
        for (const side of [-1, 1]) {
          const x = rapidX(next, side, t + 0.35)
          if (Math.abs(x - toy.pos.x) < bd) {
            bd = Math.abs(x - toy.pos.x)
            bx = x
          }
        }
        const nz = RAPID_ROWS[next]
        const top = waterY(st, t) + 0.42
        if (!toy.grounded) {
          // Mid-hop: land on the duck we went for, wherever it has glided to.
          const aim = (toy.data.aim as number | undefined) ?? 1
          const ar = (toy.data.aimRow as number | undefined) ?? next
          airAim(toy, rapidX(ar, aim, t + 0.25), top, RAPID_ROWS[ar])
          return
        }
        if (bd < 0.9 || (row < 0 && bd < 1.1 && toy.pos.z > 10.4)) {
          const dx = bx - toy.pos.x, dz = nz - toy.pos.z
          const l = Math.hypot(dx, dz) || 1
          const pace = Math.min(sk.pace, 0.35 + dz * 0.2)
          toy.pad.mx = (dx / l) * pace
          toy.pad.mz = (dz / l) * pace
          if (dz < 3.9 && dz > 0.8) {
            toy.pad.jump = true
            toy.data.aimRow = next
            toy.data.aim = Math.abs(rapidX(next, 1, t + 0.35) - toy.pos.x) < Math.abs(rapidX(next, -1, t + 0.35) - toy.pos.x) ? 1 : -1
          }
        } else {
          // Ride our own duck (keep to its middle), or line up along the island's edge.
          const cur = onFloat(st, toy)
          const hx = cur >= 0 ? st.movers[cur].obj.position.x : THREE.MathUtils.clamp(bx, -1.9, 1.9)
          const hz = cur >= 0 ? st.movers[cur].obj.position.z : 11
          toy.pad.mx = THREE.MathUtils.clamp((hx - toy.pos.x) * 1.5, -1, 1) * sk.pace
          toy.pad.mz = THREE.MathUtils.clamp((hz - toy.pos.z) * 1.5, -1, 1) * sk.pace
        }
        d.stuck = 0
        return
      }
    }
    follow(ctx, toy, path, { pace: sk.pace, dt })
  },

  onThrow(ctx, st, kind, target) {
    // A paper ball landing in the water by a float sets it rocking.
    if (kind === 'paper') {
      const i = onFloat(st, target)
      if (i >= 0) tipKick(ctx, st, i)
    }
    return false
  },

  pack(_c, st) {
    const r2 = (x: number) => Math.round(x * 100) / 100
    return [racePack(st.race), r2(st.surge), TIPPY.flatMap((i) => [r2(st.tilt[i * 2]), r2(st.tilt[i * 2 + 1])]), SQUISHY.map((i) => r2(st.sink[i])), SOAPY.map((i) => Math.round(st.grease[i] * 10) / 10)]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number, number[], number[], number[]]
    raceUnpack(st.race, a[0])
    st.surge = a[1]
    TIPPY.forEach((i, k) => {
      st.tilt[i * 2] = a[2][k * 2]
      st.tilt[i * 2 + 1] = a[2][k * 2 + 1]
    })
    SQUISHY.forEach((i, k) => (st.sink[i] = a[3][k]))
    SOAPY.forEach((i, k) => (st.grease[i] = a[4][k]))
  },

  visual(ctx, st) {
    const t = ctx.time
    const w = waterY(st, t)
    const v = st.vis
    if (v.water) v.water.position.y = w
    if (v.tex) {
      v.tex.offset.y = -t * 0.04
      v.tex.offset.x = Math.sin(t * 0.3) * 0.02
    }
    if (v.foam) {
      v.foam.position.y = w + 0.02
      v.foam.scale.setScalar(1 + Math.sin(t * 5) * 0.06 + (t - st.surge < 9 && t > st.surge ? 0.5 : 0))
    }
    if (v.stream) {
      const top = 4.1
      const len = Math.max(0.2, top - w)
      v.stream.scale.set(t - st.surge < 9 && t > st.surge ? 2 : 1, len, t - st.surge < 9 && t > st.surge ? 2 : 1)
      v.stream.position.y = w + len / 2
    }
    // Flooded tiers look wet and dark.
    for (const lo of v.lows) {
      const m = lo.mesh.material as THREE.MeshStandardMaterial
      m.emissive?.set(w > lo.top - 0.05 ? '#0c4a6e' : '#000000')
    }
    // Greased soap glistens.
    st.movers.forEach((m, i) => {
      if (FLOATS[i].kind !== 1) return
      const bar = m.obj.children[0] as THREE.Mesh
      bar.scale.x = st.grease[i] > t ? 1 + Math.sin(t * 20) * 0.04 : 1
    })
  },

  hud(ctx, st, me) {
    const t = ctx.time
    const w = waterY(st, t)
    const chips = [`Water ${Math.round((w / 1.05) * 100)}%`]
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (t > st.surge && t - st.surge < 9) status = { text: 'FLOOD SURGE!', color: '#38bdf8', pulse: true }
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const z = me.pos.z
      const i = (me.data.float as number | undefined) ?? -1
      const f = i >= 0 ? FLOATS[i] : null
      if (f?.kind === 1 && st.grease[i] > t) prompt = 'Greased soap! Jump off it!'
      else if (f?.kind === 1) prompt = 'Soap: slippery and fast. Keep jumping forwards.'
      else if (f && Math.abs(st.tilt[i * 2]) + Math.abs(st.tilt[i * 2 + 1]) > 0.35) prompt = 'Your float is tipping! Move to the high side or hop off.'
      else if (z < -21) prompt = 'Hop from duck to duck. Ducks tip towards whoever stands on them.'
      else if (z < 6) prompt = 'Left: the soap fast lane. Right: the slow, steady sponges.'
      else if (z < 34) prompt = 'The rapids: wait for a duck to glide in line, then hop.'
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status, chips })
  },
})
