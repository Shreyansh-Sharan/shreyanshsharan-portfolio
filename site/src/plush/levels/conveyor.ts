// Conveyor Lunchbox (race). Through a cardboard packing line into the lunchbox: three sorting belts that
// reverse on a colour cue (green go, amber about to turn, red against you), a stamp alley where presses pound
// down and flatten you for a second (carry a crate over your head and it takes the hit instead), a belt with
// spinning sorter paddles, and a final stretch where the belts run at double speed.
// Tricks: reverse the belt under a rival, fire a stamp at them early, or snatch the crate out of their paws.
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel } from '../engine/types'
import {
  Course, canvasTex, finishArch, follow, hash01, mat, raceHud, raceInit, racePack, raceRank, raceRespawn, raceSpawn, raceSpeedHazard,
  raceTick, raceUnpack, rbox, solid, stripeTex, type BotMem, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#fbbf24'
const LANES = [-3.4, 0, 3.4]
const LANE_W = 3.2
/** Belts: id, x, z range, width, speed, cycle, offset. Sections: A (sorting lanes), B (stamp alley), C (paddles), D (final stretch). */
interface Belt {
  x: number
  z0: number
  z1: number
  w: number
  speed: number
  P: number
  off: number
  fwd: number
  amber: number
}
const BELTS: Belt[] = [
  ...LANES.map((x, i) => ({ x, z0: -43, z1: -21, w: LANE_W, speed: 3.2, P: 7, off: (i * 7) / 3, fwd: 0.6, amber: 0.72 })),
  { x: 0, z0: -17, z1: 5, w: 10, speed: 3.2, P: 9, off: 0, fwd: 0.62, amber: 0.72 },
  { x: 0, z0: 9, z1: 25, w: 10, speed: 2.6, P: 8, off: 3, fwd: 0.62, amber: 0.72 },
  ...LANES.map((x, i) => ({ x, z0: 29, z1: 47, w: LANE_W, speed: 6.4, P: 5, off: (i * 5) / 3, fwd: 0.55, amber: 0.68 })),
]
const PRESSES = [-13, -7.5, -2, 3.5].map((z, i) => ({ z, off: i * 0.7 }))
const PRESS_P = 2.8
const PADDLES = [
  { z: 13, speed: 1.6 },
  { z: 21, speed: -1.7 },
]
const DISPENSERS = [-4.2, 4.2]
const CRATES = 6

interface CLState {
  race: RaceState
  /** Belt b forced into reverse until this time. */
  rev: number[]
  /** Press i fired early at this time. */
  stampAt: number[]
  // Host only.
  crates: RigidBody[]
  flatT: Map<string, number>
  belts: { setDir(s: number): void }[]
  // Visuals.
  vis: { lamps: THREE.Mesh[]; arrows: THREE.Mesh[] }
}

/** Belt phase 0..1 and direction: +1 forwards (green, amber near the end), -1 against you (red). */
function beltU(b: number, t: number) {
  const B = BELTS[b]
  return ((((t + B.off) / B.P) % 1) + 1) % 1
}

function beltDir(st: CLState, b: number, t: number) {
  if (st.rev[b] > t) return -1
  return beltU(b, t) < BELTS[b].amber ? 1 : -1
}

/** 0 green, 1 amber, 2 red. */
function beltCue(st: CLState, b: number, t: number) {
  if (st.rev[b] > t) return 2
  const u = beltU(b, t)
  return u < BELTS[b].fwd ? 0 : u < BELTS[b].amber ? 1 : 2
}

/** Seconds of forward running left on belt b (0 if it is reversed). */
function fwdLeft(st: CLState, b: number, t: number) {
  if (beltDir(st, b, t) < 0) return 0
  return (BELTS[b].amber - beltU(b, t)) * BELTS[b].P
}

function beltAt(x: number, z: number) {
  for (let b = 0; b < BELTS.length; b++) {
    const B = BELTS[b]
    if (z >= B.z0 && z <= B.z1 && Math.abs(x - B.x) <= B.w / 2 + 0.1) return b
  }
  return -1
}

function pressU(st: CLState, i: number, t: number) {
  const e = t - st.stampAt[i]
  if (e >= 0 && e < PRESS_P * 0.5) return 0.5 + e / PRESS_P
  return ((((t + PRESSES[i].off) / PRESS_P) % 1) + 1) % 1
}

/** Press head bottom height: 2.4 up, slams to 0.1. */
function pressY(st: CLState, i: number, t: number) {
  const u = pressU(st, i, t)
  if (u < 0.5 || u >= 0.85) return 2.4
  if (u < 0.56) return 2.4 - ((u - 0.5) / 0.06) * 2.3
  if (u < 0.7) return 0.1
  return 0.1 + ((u - 0.7) / 0.15) * 2.3
}

/** Seconds until press i next starts coming down (0 while it is down). */
function pressGap(st: CLState, i: number, t: number) {
  const u = pressU(st, i, t)
  if (u >= 0.5 && u < 0.72) return 0
  return (((0.5 - u) % 1) + 1) % 1 * PRESS_P
}

function buildPath(side: number, crate: boolean): Wp[] {
  const p: Wp[] = [{ x: 0, y: 0, z: -45, w: 3 }, { x: 0, y: 0, z: -32, w: 3 }, { x: 0, y: 0, z: -19, w: 3 }]
  if (crate) p.push({ x: DISPENSERS[side > 0 ? 1 : 0] * 0.82, y: 0, z: -19.4, r: 0.6 })
  PRESSES.forEach((pr, i) => p.push({ x: 0, y: 0, z: pr.z - 2.4, w: 3, wait: i, r: 1.2 }))
  p.push({ x: 0, y: 0, z: 7, w: 3 }, { x: side * 4.1, y: 0, z: 9.8, r: 0.9 }, { x: side * 4.15, y: 0, z: 17, r: 1 }, { x: side * 4.15, y: 0, z: 24.5, r: 1 }, { x: 0, y: 0, z: 27, w: 3 })
  p.push({ x: 0, y: 0, z: 38, w: 3 }, { x: 0, y: 0, z: 48.6, w: 3 })
  return p
}

const PATHS = [buildPath(-1, false), buildPath(1, false), buildPath(-1, true), buildPath(1, true)]

const course = new Course({
  path: PATHS[0],
  cps: [
    { x: 0, y: 0, z: -19, hx: 5, hz: 2, yaw: 0, name: 'Crate store' },
    { x: 0, y: 0, z: 7, hx: 5, hz: 2, yaw: 0, name: 'Past the stamps' },
    { x: 0, y: 0, z: 27, hx: 5, hz: 2, yaw: 0, name: 'Final stretch' },
  ],
  finish: { x: 0, y: 0, z: 48.6, hx: 5, hz: 0.7 },
  podium: { x: 0, y: 0, z: 52.4, yaw: Math.PI },
})

function cardboardTex(label = '') {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c8955c'
    g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(120,80,40,0.18)'
    for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 2, h)
    g.fillStyle = '#e8d3a8'
    g.fillRect(0, h / 2 - 10, w, 20)
    if (label) {
      g.fillStyle = '#7f1d1d'
      g.font = '800 18px ui-rounded, system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText(label, w / 2, h / 2 + 34)
    }
  }, [1, 1])
}

function crateTex() {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#d4a373'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#8b5a2b'
    g.lineWidth = 5
    g.strokeRect(3, 3, w - 6, h - 6)
    g.beginPath()
    g.moveTo(4, 4)
    g.lineTo(w - 4, h - 4)
    g.stroke()
  })
}

function crateHome(i: number) {
  const side = i % 2
  return { x: DISPENSERS[side], y: 0.45 + Math.floor(i / 2) * 0.92, z: -19.9 }
}

export default defineLevel<CLState>({
  id: 'conveyor',
  name: 'Conveyor Lunchbox',
  type: 'race',
  blurb: 'Run the cardboard packing line: reversing belts, pounding stamps and spinning sorter paddles.',
  howTo: [
    'Belts reverse on the light: green go, amber turning, red against you',
    'Stamps flatten you for a second: carry a crate (hold E) and it takes the hit',
    'Hug the edges past the spinning sorter paddles',
    'The last belts run at double speed: hop to a green lane',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 120,
  camera: { kind: 'chase', dist: 7.4 },
  introOrbit: { radius: 28, height: 15, center: [0, 0, 2] },
  sprinkles: { start: 1 },
  fallY: -5,
  sky: { color: '#271b10', fogNear: 60, fogFar: 170 },

  tricks: [
    {
      id: 'reverse',
      name: 'Reverse Belt',
      icon: 'swap',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'Throw the switch: the belt under a rival runs backwards for 2.5 seconds.',
      counter: 'Hop to another lane, or sprint it out.',
      can: (_c, _s, _u, t) => (t && beltAt(t.pos.x, t.pos.z) >= 0 ? true : 'They are not on a belt'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const b = beltAt(target.pos.x, target.pos.z)
        if (b >= 0) s.rev[b] = ctx.time + 2.5
        ctx.fx.sfx('buzz', target.pos)
        ctx.fx.popup(target, 'Reversed!', '#fca5a5')
      },
      botUse: (ctx, s, user) => ctx.toys.find((t) => t !== user && t.status === 'play' && beltAt(t.pos.x, t.pos.z) >= 0 && beltDir(s, beltAt(t.pos.x, t.pos.z), ctx.time) > 0 && t.pos.z > user.pos.z - 3) ?? false,
    },
    {
      id: 'stamp',
      name: 'Early Stamp',
      icon: 'slam',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'Fire the stamp nearest a rival right now.',
      counter: 'Carry a crate through the stamp alley.',
      can: (_c, _s, _u, t) => (t && t.pos.z > -17 && t.pos.z < 6 ? true : 'Only in the stamp alley'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        let best = 0
        PRESSES.forEach((p, i) => {
          if (Math.abs(p.z - target.pos.z) < Math.abs(PRESSES[best].z - target.pos.z)) best = i
        })
        s.stampAt[best] = ctx.time
        ctx.fx.popup(target, 'Stamp!', '#fca5a5')
      },
    },
    {
      id: 'snatch',
      name: 'Crate Snatch',
      icon: 'magnet',
      cost: 1,
      cooldown: 8,
      busy: 0.5,
      target: 'rival',
      range: 8,
      desc: 'Hook the crate out of a rival’s paws (and give them a jolt).',
      counter: 'Keep a Bubble Wrap, or grab another crate.',
      can: (_c, _s, _u, t) => (t && t.holdingProp ? true : 'They have no crate'),
      apply: (ctx, _s, _user, target) => {
        if (!target) return
        target.release(true)
        ctx.knock(target, { x: 0, y: 2, z: -2 }, 0.4)
        ctx.fx.popup(target, 'Crate gone!', '#fca5a5')
        ctx.fx.sfx('pop', target.pos)
      },
    },
    bubbleWrap<CLState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 30, hd: 66, ridge: 32, knee: 7, y: -10, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    const board = new THREE.MeshStandardMaterial({ map: cardboardTex(), roughness: 0.95 })
    const fragile = new THREE.MeshStandardMaterial({ map: cardboardTex('FRAGILE'), roughness: 0.95 })
    // Cardboard platforms between the belts.
    const pad = (z0: number, z1: number, label = false) => solid(ctx, { pos: [0, -0.5, (z0 + z1) / 2], size: [10.4, 1, z1 - z0], material: label ? fragile : board, round: 0.12 })
    pad(-51, -43)
    pad(-21, -17, true)
    pad(5, 9)
    pad(25, 29, true)
    // Box stacks holding the belts up.
    for (const z of [-32, -6, 17, 38]) {
      const leg = new THREE.Mesh(rbox(6, 9, 3, 0.2), fragile)
      leg.position.set(0, -5.6, z)
      ctx.root.add(leg)
    }
    // The lunchbox at the end: a tin box with its lid open, an apple and a sandwich.
    const tin = mat('#2563eb', { metalness: 0.3, roughness: 0.4 })
    solid(ctx, { pos: [0, -0.5, 50.6], size: [11, 1, 7.2], material: mat("#dbeafe") })
    for (const s of [-1, 1]) solid(ctx, { pos: [s * 5.6, 1, 51], size: [0.4, 3, 6.2], material: tin, round: 0.1 })
    solid(ctx, { pos: [0, 1, 54.2], size: [11.6, 3, 0.4], material: tin, round: 0.1 })
    const lid = new THREE.Mesh(rbox(11.6, 0.4, 6.2, 0.12), tin)
    lid.position.set(0, 4.3, 56.4)
    lid.rotation.x = -1.2
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.18, 8, 20, Math.PI), mat('#facc15'))
    handle.position.set(0, 2.5, 54.5)
    ctx.root.add(lid, handle)
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), mat('#dc2626', { roughness: 0.4 }))
    apple.position.set(-3.8, 0.9, 53)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), mat('#65a30d'))
    stem.position.set(-3.8, 1.9, 53)
    const bread = mat('#f5deb3')
    const sandwich = new THREE.Group()
    for (const [y, m] of [[0.15, bread], [0.35, mat('#22c55e')], [0.5, mat('#ef4444')], [0.7, bread]] as const) {
      const l = new THREE.Mesh(rbox(1.8, 0.2, 1.8, 0.06), m)
      l.position.y = y
      sandwich.add(l)
    }
    sandwich.position.set(3.8, 0, 53)
    ctx.root.add(apple, stem, sandwich)
    ctx.phys.cylinder({ x: -3.8, y: 0.9, z: 53 }, 0.9, 0.9)
    ctx.phys.box({ x: 3.8, y: 0.4, z: 53 }, { x: 0.9, y: 0.4, z: 0.9 })
    finishArch(ctx, { x: 0, y: 0, z: 48.6, width: 10.4, color: ACCENT, text: 'PACKED!' })
    // Crate shelves at the crate store.
    for (const x of DISPENSERS) {
      const shelf = new THREE.Mesh(rbox(1.6, 0.15, 1.4, 0.04), mat('#8b5a2b'))
      shelf.position.set(x, 0.02, -19.9)
      ctx.root.add(shelf)
    }
    const sign = textSprite('Crates: hold E', { bg: '#92400e', size: 0.5 })
    sign.position.set(0, 3, -19.5)
    ctx.root.add(sign)
    for (const c of course.cps) {
      const s = textSprite('Checkpoint', { bg: '#b45309', size: 0.5 })
      s.position.set(4.4, 2.4, c.z)
      ctx.root.add(s)
    }
  },

  init(ctx) {
    const st: CLState = { race: raceInit(ctx), rev: BELTS.map(() => -9), stampAt: PRESSES.map(() => -9), crates: [], flatT: new Map(), belts: [], vis: { lamps: [], arrows: [] } }
    raceSpeedHazard(ctx, st.race, 5.6)
    // The belts (the engine's conveyor), steered from the shared schedule on every screen.
    for (const B of BELTS) st.belts.push(ctx.hazards.conveyor({ x: B.x, y: 0, z: (B.z0 + B.z1) / 2, width: B.w - 0.1, length: B.z1 - B.z0, speed: B.speed }))
    ctx.hazards.add({
      update(_c, t) {
        for (let b = 0; b < BELTS.length; b++) st.belts[b].setDir(beltDir(st, b, Math.max(0, t)))
      },
    })
    // Cue lamps and big arrows over each belt.
    const lampG = new THREE.SphereGeometry(0.32, 12, 8)
    const arrowG = new THREE.ConeGeometry(0.5, 1, 3).rotateX(Math.PI / 2)
    BELTS.forEach((B) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), mat('#374151'))
      pole.position.set(B.x + B.w / 2 - 0.3, 1.3, B.z0 + 0.4)
      const lamp = new THREE.Mesh(lampG, new THREE.MeshBasicMaterial({ color: '#22c55e', toneMapped: false }))
      lamp.position.set(B.x + B.w / 2 - 0.3, 2.7, B.z0 + 0.4)
      const arrow = new THREE.Mesh(arrowG, new THREE.MeshBasicMaterial({ color: '#22c55e', toneMapped: false, transparent: true, opacity: 0.85 }))
      arrow.position.set(B.x, 3.4, B.z0 + 1.6)
      ctx.root.add(pole, lamp, arrow)
      st.vis.lamps.push(lamp)
      st.vis.arrows.push(arrow)
    })
    // Stamping presses: heavy heads on pistons (no collider: the stamp rule flattens whoever is under).
    const hazardTex = stripeTex('#facc15', '#111827', 8, true)
    PRESSES.forEach((pr, i) => {
      const frame = mat('#7f1d1d', { roughness: 0.5 })
      for (const s of [-1, 1]) solid(ctx, { pos: [s * 5.6, 2.2, pr.z], size: [0.6, 4.4, 1.2], material: frame, round: 0.1 })
      solid(ctx, { pos: [0, 4.6, pr.z], size: [11.8, 0.6, 1.4], material: frame, round: 0.15, collide: false })
      const g = new THREE.Group()
      const head = new THREE.Mesh(rbox(10, 1, 2.4, 0.12), new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.5 }))
      head.position.y = 0.5
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4, 10), mat('#9ca3af', { metalness: 0.8, roughness: 0.25 }))
      rod.position.y = 3
      g.add(head, rod)
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
      ctx.root.add(g)
      ctx.hazards.add({
        update(_c, t) {
          g.position.set(0, pressY(st, i, Math.max(0, t)), pr.z)
        },
      })
    })
    // Sorter paddles.
    for (const pd of PADDLES) ctx.hazards.rotatingBar({ x: 0, y: 0.6, z: pd.z, length: 3.6, speed: pd.speed, thick: 0.3, color: '#16a34a' })
    // Crates: grab one (E) to carry it over your head.
    const cm = new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.8 })
    const cg = rbox(0.9, 0.9, 0.9, 0.06)
    for (let i = 0; i < CRATES; i++) {
      const h = crateHome(i)
      const body = ctx.phys.dynamic(h, { damping: 0.4 })
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid(0.45, 0.45, 0.45).setDensity(0.4), { friction: 0.7, groups: PROP_GROUPS })
      const mesh = new THREE.Mesh(cg, cm)
      mesh.castShadow = true
      ctx.root.add(mesh)
      ctx.grabbable(body, mesh)
      st.crates.push(body)
    }
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return raceSpawn(ctx, { x: 0, y: 0, z: -47.5, yaw: 0, cols: 7 }, i, n)
  },

  tick(ctx, st) {
    const t = ctx.time
    raceTick(ctx, st.race, course)
    // Stamps.
    PRESSES.forEach((pr, i) => {
      if (pressY(st, i, t) > 1.0) return
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || Math.abs(toy.pos.z - pr.z) > 1.35 || Math.abs(toy.pos.x) > 5.2 || toy.feet > 0.9) continue
        const key = `${toy.idx}:${i}`
        if ((st.flatT.get(key) ?? -9) > t - 1.2) continue
        st.flatT.set(key, t)
        if (toy.holdingProp) {
          // The crate takes the hit and goes back to the store.
          const c = toy.holdingProp
          toy.release(false)
          const k = st.crates.indexOf(c)
          const h = crateHome(Math.max(0, k))
          c.setTranslation(h, true)
          c.setLinvel({ x: 0, y: 0, z: 0 }, true)
          ctx.fx.popup(toy, 'Crate saved you!', '#bbf7d0')
          ctx.fx.sfx('crunch', toy.pos)
          ctx.fx.puff(toy.pos, 'crumbs', 12)
          continue
        }
        st.race.hold[toy.idx] = t + 1.1
        ctx.fx.popup(toy, 'FLAT!', '#fde68a')
        ctx.fx.sfx('slam', toy.pos)
        ctx.fx.shake(0.3, toy)
      }
    })
    // Crates that fall off the line go back to the store.
    st.crates.forEach((c, i) => {
      const p = c.translation()
      if (p.y < -4) {
        c.setTranslation(crateHome(i), true)
        c.setLinvel({ x: 0, y: 0, z: 0 }, true)
      }
    })
  },

  onFall(ctx, st, toy) {
    raceRespawn(ctx, st.race, course, toy, 'Back to the checkpoint')
  },

  rank(ctx, st) {
    return raceRank(ctx, st.race, course)
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as BotMem
    const t = ctx.time
    if (d.route === undefined) d.route = Math.floor(hash01(toy.idx, ctx.seed, 6) * 4)
    const path = PATHS[d.route]
    if (toy.holdingProp) toy.pad.grab = true
    // Lane belts: ride a green lane, hop across when ours is about to turn.
    const z = toy.pos.z
    if ((z > -43 && z < -21.5) || (z > 29 && z < 47)) {
      const first = z < 0 ? 0 : 5
      const here = beltAt(toy.pos.x, z)
      let best = here >= 0 ? here : first + 1, score = -99
      for (let k = 0; k < 3; k++) {
        const b = first + k
        const s = fwdLeft(st, b, t) - Math.abs(LANES[k] - toy.pos.x) * 0.35 + (b === here ? 0.6 : 0)
        if (s > score) {
          score = s
          best = b
        }
      }
      const tx = BELTS[best].x
      const dx = tx - toy.pos.x
      toy.pad.mx = THREE.MathUtils.clamp(dx * 1.2, -1, 1) * sk.pace
      toy.pad.mz = Math.sqrt(Math.max(0, 1 - toy.pad.mx * toy.pad.mx)) * sk.pace
      if (Math.abs(dx) > 1.6 && toy.grounded && ctx.rng.chance(0.08)) toy.pad.jump = true
      // Keep the route index moving along with us.
      const wi = path.findIndex((w) => w.z > z + 1)
      if (wi > 0 && (d.wp ?? 0) < wi) d.wp = wi
      d.stuck = 0
      return
    }
    // Crate route: pick one up at the store.
    const w = path[d.wp ?? 0]
    if (w && Math.abs(w.z + 19.4) < 0.01 && !toy.holdingProp) {
      let near: RigidBody | null = null, nd = 99
      for (const c of st.crates) {
        const p = c.translation()
        const dd = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z)
        if (dd < nd && p.z < -15 && p.z > -22 && p.y < 3) {
          nd = dd
          near = c
        }
      }
      if (near && nd < 3) {
        const p = near.translation()
        const dx = p.x - toy.pos.x, dz = p.z - toy.pos.z
        const l = Math.hypot(dx, dz) || 1
        toy.pad.mx = (dx / l) * (l > 1.0 ? 0.6 : 0.15)
        toy.pad.mz = (dz / l) * (l > 1.0 ? 0.6 : 0.15)
        toy.yaw = Math.atan2(dx, dz)
        if (l < 1.4) toy.pad.grab = true
        if (toy.holdingProp || (d.stuck ?? 0) > 3) d.wp = (d.wp ?? 0) + 1
        d.stuck = (d.stuck ?? 0) + dt
        return
      }
      d.wp = (d.wp ?? 0) + 1
    }
    follow(ctx, toy, path, {
      pace: sk.pace,
      dt,
      wait: (id, me) => {
        if (me.holdingProp) return false
        // Cross a stamp when it will stay up long enough for us to get past.
        const b = beltAt(me.pos.x, me.pos.z)
        const speed = 5.2 * sk.pace + (b >= 0 ? beltDir(st, b, t) * BELTS[b].speed : 0)
        const cross = 4.6 / Math.max(1.5, speed) + sk.reaction
        return pressGap(st, id, t) < cross
      },
    })
  },

  pack(_c, st) {
    return [racePack(st.race), st.rev.map((x) => Math.round(x * 10) / 10), st.stampAt.map((x) => Math.round(x * 100) / 100)]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number[], number[]]
    raceUnpack(st.race, a[0])
    st.rev = a[1]
    st.stampAt = a[2]
  },

  visual(ctx, st, dt) {
    const t = Math.max(0, ctx.time)
    const cols = ['#22c55e', '#f59e0b', '#ef4444']
    BELTS.forEach((_B, b) => {
      const cue = beltCue(st, b, t)
      const lamp = st.vis.lamps[b]
      const on = cue !== 1 || Math.floor(t * 6) % 2 === 0
      ;(lamp.material as THREE.MeshBasicMaterial).color.set(on ? cols[cue] : '#3f3f46')
      const a = st.vis.arrows[b]
      ;(a.material as THREE.MeshBasicMaterial).color.set(cols[cue])
      a.rotation.y = beltDir(st, b, t) > 0 ? 0 : Math.PI
      a.position.y = 3.4 + Math.sin(t * 4 + b) * 0.12
    })
    // Flattened toys squash flat.
    for (const toy of ctx.toys) {
      if (!toy.rig) continue
      const flat = (st.race.hold[toy.idx] ?? 0) > ctx.time && toy.status === 'play'
      const s = toy.rig.root.scale
      const k = Math.min(1, dt * 14)
      s.set(s.x + ((flat ? 1.4 : 1) - s.x) * k, s.y + ((flat ? 0.25 : 1) - s.y) * k, s.z + ((flat ? 1.4 : 1) - s.z) * k)
    }
  },

  hud(ctx, st, me) {
    const t = ctx.time
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const b = beltAt(me.pos.x, me.pos.z)
      if (b >= 0) {
        const cue = beltCue(st, b, t)
        if (cue === 1) status = { text: 'BELT TURNING!', color: '#f59e0b', pulse: true }
        else if (cue === 2) status = { text: 'REVERSED', color: '#ef4444' }
      }
      const z = me.pos.z
      if ((st.race.hold[me.idx] ?? 0) > t) prompt = 'Flattened! Pop back up in a moment…'
      else if (z > -21 && z < -16 && !me.holdingProp) prompt = 'Grab a crate (hold E): a stamp hits the crate instead of you.'
      else if (z > -17 && z < 5) prompt = me.holdingProp ? 'Crate up! Walk straight through the stamps.' : 'Time your run under the stamps.'
      else if (z > 9 && z < 25) prompt = 'Hug the edge to get past the spinning paddles.'
      else if (z > 29) prompt = 'Double speed! Stay on a green lane.'
      else if (z < -21) prompt = 'Green belts carry you, red ones push you back. Hop lanes!'
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status })
  },
})

