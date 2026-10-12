// Pinball Panic (race). Race UP a giant tabletop pinball machine: pop bumpers fling you (sometimes forwards),
// a trench across the table is crossed on flippers that flip you when they fire, a row of drop targets blocks
// the middle, and steel balls roll down at you; when the leader passes halfway, it's multiball. The table tilts
// steeper every 20 seconds.
// Tricks: launch an extra ball down a rival's lane, supercharge the bumper next to them, or fire the flipper
// they are standing on early.
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import {
  Course, canvasTex, finishArch, follow, hash01, mat, mover, raceHud, raceInit, racePack, raceProgress, raceRank, raceRespawn, raceSpeedHazard,
  raceTick, raceUnpack, rbox, type BotMem, type Mover, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#e879f9'
const HW = 9
const LEN = 72
const PIVOT = new THREE.Vector3(0, 1, -36)
const TRENCH = { z0: 24, z1: 28 }
const FLIPPERS = [-6.75, -2.25, 2.25, 6.75].map((x, i) => ({ x, phase: [0, 0.5, 0.25, 0.75][i] }))
const FLIP_P = 4.2
const TARGETS = [-7, -3.5, 0, 3.5, 7]
const TARGET_Z = 44
const BUMPERS = [
  { x: -4, z: 12 },
  { x: 4, z: 12 },
  { x: 0, z: 17.5 },
  { x: -5, z: 52 },
  { x: 5, z: 52 },
  { x: -2, z: 58 },
  { x: 3, z: 61 },
]
const BUMP_R = 1.1
const BALL_R = 0.75
const BALLS = 4
const STEP_T = 20

interface PBState {
  race: RaceState
  /** Round time each bumper last fired (flash), and supercharged until. */
  bump: number[]
  boost: number[]
  /** Flipper i fired early at this time. */
  flipAt: number[]
  /** Drop target i knocked down at this time (-9 standing). */
  down: number[]
  multi: number
  // Host only.
  step: number
  active: boolean[]
  balls: RigidBody[]
  flipUp: boolean[]
  hitT: Map<string, number>
  // Every screen.
  M: THREE.Matrix4
  Mi: THREE.Matrix4
  flippers: Mover[]
  vis: { table: THREE.Group | null; caps: THREE.Object3D[]; pillar: THREE.Object3D | null }
}

/** Table tilt (radians) at time t: 5° stepping up 1.5° every 20 s (to 11°), each step eased over 2 s. */
function tiltAt(t: number) {
  t = Math.max(0, t)
  const n = Math.min(4, Math.floor(t / STEP_T))
  if (n === 0) return THREE.MathUtils.degToRad(5)
  const e = THREE.MathUtils.smoothstep(Math.min(1, (t - n * STEP_T) / 2), 0, 1)
  return THREE.MathUtils.degToRad(5 + 1.5 * (n - 1) + 1.5 * e)
}

function tableM(t: number, out: THREE.Matrix4) {
  return out.makeRotationX(-tiltAt(t)).setPosition(PIVOT)
}

/** Flipper angle (0 flat, a bridge; up to ~1.2 rad raised). */
function flipAngle(st: PBState, i: number, t: number) {
  const e = t - st.flipAt[i]
  let u: number
  if (e >= 0 && e < 1.5) u = 0.55 + e / FLIP_P
  else u = ((((t / FLIP_P) + FLIPPERS[i].phase) % 1) + 1) % 1
  if (u < 0.55 || u >= 0.9) return 0
  if (u < 0.59) return ((u - 0.55) / 0.04) * 1.2
  if (u < 0.78) return 1.2
  return 1.2 * (1 - (u - 0.78) / 0.12)
}

/** Safe to start across: flat now and for a good while yet. */
function flipSafe(st: PBState, i: number, t: number) {
  if (t - st.flipAt[i] < 1.6 && t >= st.flipAt[i]) return false
  const u = ((((t / FLIP_P) + FLIPPERS[i].phase) % 1) + 1) % 1
  return u >= 0.9 || u < 0.25
}

function targetUp(st: PBState, i: number, t: number) {
  const e = t - st.down[i]
  if (e < 0 || e > 5.5) return 1
  if (e < 0.15) return 1 - e / 0.15
  if (e > 5.2) return (e - 5.2) / 0.3
  return 0
}

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()

function buildPath(lane: number, gap: number): Wp[] {
  const fx = FLIPPERS[lane].x
  const gx = gap
  return [
    { x: 0, y: 0, z: 6, w: 5 },
    { x: 0, y: 0, z: 11, w: 1.4 },
    { x: -2.6, y: 0, z: 16, w: 0.8 },
    { x: 0, y: 0, z: 21.5, w: 4 },
    { x: fx, y: 0, z: 23.3, r: 0.6, wait: lane },
    { x: fx, y: 0, z: 26.2, noGap: true, r: 0.9 },
    { x: fx * 0.8, y: 0, z: 30, w: 1 },
    { x: gx, y: 0, z: 40, w: 0.6 },
    { x: gx, y: 0, z: 42.9, r: 0.5 },
    { x: gx, y: 0, z: 45.6, r: 0.8 },
    { x: 0, y: 0, z: 48.6, w: 4 },
    { x: 0, y: 0, z: 52, w: 1.5 },
    { x: 0.6, y: 0, z: 55.5, w: 0.8 },
    { x: -4.6, y: 0, z: 60, w: 0.8 },
    { x: 0, y: 0, z: 64, w: 3 },
    { x: 0, y: 0, z: 68.2, w: 5 },
  ]
}

const GAPS = [-5.25, -1.75, 1.75, 5.25]
const PATHS = [0, 1, 2, 3].map((l) => buildPath(l, GAPS[l]))

const course = new Course({
  path: PATHS[1],
  cps: [
    { x: 0, y: 0, z: 21.5, hx: HW - 0.5, hz: 2, yaw: 0, name: 'Before the flippers' },
    { x: 0, y: 0, z: 30.3, hx: HW - 0.5, hz: 1.8, yaw: 0, name: 'Over the trench' },
    { x: 0, y: 0, z: 48.3, hx: HW - 0.5, hz: 1.8, yaw: 0, name: 'Past the targets' },
  ],
  finish: { x: 0, y: 0, z: 67.8, hx: HW, hz: 0.6 },
  podium: { x: 0, y: 0, z: 70.3, yaw: Math.PI },
})

function playfieldTex() {
  return canvasTex(256, 1024, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, '#1e1b4b')
    grad.addColorStop(1, '#312e81')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + (i % 5) * 0.08})`
      g.fillRect((i * 67) % w, (i * 131) % h, 2, 2)
    }
    // Up arrows down the middle.
    const cols = ['#f472b6', '#facc15', '#22d3ee', '#a3e635']
    for (let i = 0; i < 9; i++) {
      const y = h - 80 - i * 105
      g.fillStyle = cols[i % 4]
      g.beginPath()
      g.moveTo(w / 2, y - 26)
      g.lineTo(w / 2 + 22, y + 6)
      g.lineTo(w / 2 - 22, y + 6)
      g.fill()
    }
    g.strokeStyle = 'rgba(250,204,21,0.7)'
    g.lineWidth = 4
    g.beginPath()
    g.arc(w / 2, h * 0.5, 60, 0, Math.PI * 2)
    g.stroke()
    g.fillStyle = '#fde68a'
    g.font = '800 26px ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText('PLUSH', w / 2, h * 0.5 - 4)
    g.fillText('PINBALL', w / 2, h * 0.5 + 26)
  })
}

function backglassTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, '#7e22ce')
    grad.addColorStop(1, '#db2777')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 30; i++) {
      g.fillStyle = i % 2 ? '#fde68a' : '#a5f3fc'
      g.beginPath()
      g.arc((i * 97) % w, (i * 53) % h, 4 + (i % 4) * 2, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = '#ffffff'
    g.font = '900 64px ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText('PINBALL', w / 2, h / 2 + 4)
    g.font = '800 34px ui-rounded, system-ui, sans-serif'
    g.fillText('PANIC', w / 2, h / 2 + 52)
  })
}

export default defineLevel<PBState>({
  id: 'pinball',
  name: 'Pinball Panic',
  type: 'race',
  blurb: 'Race up a giant pinball table past bumpers, flippers and rolling steel balls. It keeps tilting.',
  howTo: [
    'Run uphill to the top lanes: bumpers fling you, sometimes forwards',
    'Cross the trench on a flipper while it lies flat (it flips you when it fires)',
    'Squeeze between the drop targets, or shove one down',
    'Multiball when the leader passes halfway; the table tilts every 20 s',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 120,
  camera: { kind: 'chase', dist: 7.6 },
  introOrbit: { radius: 32, height: 18, center: [0, 4, 0] },
  sprinkles: { start: 1 },
  fallY: -6,
  sky: { color: '#1c1326', fogNear: 70, fogFar: 180 },

  tricks: [
    {
      id: 'extra',
      name: 'Extra Ball',
      icon: 'star',
      cost: 2,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: 'Launch a steel ball from the top, straight down a rival’s lane.',
      counter: 'Side-step it, or hide behind a bumper.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const lp = course.local(target.pos)
        let b = s.active.findIndex((a) => !a)
        if (b < 0) b = 0
        launchBall(ctx, s, b, THREE.MathUtils.clamp(lp.x, -HW + 1, HW - 1), 7)
        ctx.fx.popup(target, 'Extra ball!', '#e9d5ff')
      },
    },
    {
      id: 'boost',
      name: 'Bumper Boost',
      icon: 'zap',
      cost: 2,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: 'Supercharge the bumper next to a rival for 5 seconds: double the bounce.',
      counter: 'Give glowing bumpers a wide berth.',
      can: (_c, _s, _u, t) => (t && nearestBumper(t) >= 0 ? true : 'No bumper near them'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const i = nearestBumper(target)
        if (i >= 0) s.boost[i] = ctx.time + 5
        ctx.fx.sfx('zap', target.pos)
        ctx.fx.popup(target, 'Boosted bumper!', '#f0abfc')
      },
    },
    {
      id: 'flip',
      name: 'Flip Early',
      icon: 'slam',
      cost: 2,
      cooldown: 10,
      busy: 0.6,
      target: 'rival',
      desc: 'Fire the flipper a rival is on (or about to step on) right now.',
      counter: 'Cross quickly, or wait for a flipper that has just come down.',
      can: (_c, _s, _u, t) => {
        if (!t) return 'Pick a rival'
        const lp = course.local(t.pos)
        return lp.z > TRENCH.z0 - 2.5 && lp.z < TRENCH.z1 + 0.5 ? true : 'Only at the flippers'
      },
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const lp = course.local(target.pos)
        let best = 0
        FLIPPERS.forEach((f, i) => {
          if (Math.abs(f.x - lp.x) < Math.abs(FLIPPERS[best].x - lp.x)) best = i
        })
        s.flipAt[best] = ctx.time
        ctx.fx.popup(target, 'Flip!', '#fca5a5')
      },
    },
    bubbleWrap<PBState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 32, hd: 64, ridge: 36, knee: 8, y: -12, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    // A fixed stand under the bottom end of the machine.
    const stand = new THREE.Mesh(rbox(HW * 2 + 2, 12.5, 4, 0.3), mat('#3b0764'))
    stand.position.set(0, -5.6, PIVOT.z + 1.5)
    ctx.root.add(stand)
  },

  init(ctx) {
    const st: PBState = {
      race: raceInit(ctx),
      bump: BUMPERS.map(() => -9),
      boost: BUMPERS.map(() => -9),
      flipAt: FLIPPERS.map(() => -9),
      down: TARGETS.map(() => -9),
      multi: 0,
      step: 0,
      active: new Array(BALLS).fill(false),
      balls: [],
      flipUp: FLIPPERS.map(() => false),
      hitT: new Map(),
      M: tableM(0, new THREE.Matrix4()),
      Mi: new THREE.Matrix4(),
      flippers: [],
      vis: { table: null, caps: [], pillar: null },
    }
    st.Mi.copy(st.M).invert()
    course.space = {
      toLocal: (p, out) => out.set(p.x, p.y, p.z).applyMatrix4(st.Mi),
      toWorld: (p, out) => out.set(p.x, p.y, p.z).applyMatrix4(st.M),
    }
    raceSpeedHazard(ctx, st.race, 5.6)
    // The table follows the tilt: one hazard keeps the matrices (and the visual group) up to date.
    const table = new THREE.Group()
    table.matrixAutoUpdate = false
    ctx.root.add(table)
    st.vis.table = table
    ctx.hazards.add({
      update(_c, t) {
        tableM(t, st.M)
        st.Mi.copy(st.M).invert()
        table.matrix.copy(st.M)
        table.matrixWorldNeedsUpdate = true
      },
    })
    buildTable(ctx, st, table)
    // Two slabs (the trench between them) carrying rails, bumpers and walls, all tilting together.
    const slab = (z0: number, z1: number, extra: { pos: [number, number, number]; half: [number, number, number]; r?: number; restitution?: number }[]) => {
      const cz = (z0 + z1) / 2
      const rel = (x: number, y: number, z: number): [number, number, number] => [x, y + 0.25, z - cz]
      const ex = extra.map((e) => ({ ...e, pos: rel(...e.pos) }))
      for (const s of [-1, 1]) ex.push({ pos: rel(s * (HW + 0.3), 0.6, cz), half: [0.3, 0.6, (z1 - z0) / 2] })
      mover(ctx, {
        half: [HW, 0.25, (z1 - z0) / 2],
        obj: new THREE.Group(),
        extra: ex,
        friction: 0.7,
        pose: (t, out) => {
          tableM(t, out)
          out.multiply(_m2.makeTranslation(0, -0.25, cz))
          return true
        },
      })
    }
    const bumpCol = (b: { x: number; z: number }) => ({ pos: [b.x, 0.6, b.z] as [number, number, number], half: [0, 0.6, 0] as [number, number, number], r: BUMP_R, restitution: 0.9 })
    slab(0, TRENCH.z0, [
      { pos: [-5.5, 0.6, -0.3], half: [3.5, 0.6, 0.3] },
      { pos: [5.5, 0.6, -0.3], half: [3.5, 0.6, 0.3] },
      { pos: [-7.2, 0.6, 6], half: [0.45, 0.6, 1.8], restitution: 0.8 },
      { pos: [7.2, 0.6, 6], half: [0.45, 0.6, 1.8], restitution: 0.8 },
      ...BUMPERS.slice(0, 3).map(bumpCol),
    ])
    slab(TRENCH.z1, LEN, [
      { pos: [0, 0.6, LEN + 0.3], half: [HW + 0.6, 0.6, 0.3] },
      { pos: [-3, 0.5, 37.5], half: [0.15, 0.5, 3.5] },
      { pos: [3, 0.5, 37.5], half: [0.15, 0.5, 3.5] },
      ...BUMPERS.slice(3).map(bumpCol),
    ])
    // Flippers: drawbridges over the trench.
    FLIPPERS.forEach((f, i) => {
      const g = new THREE.Group()
      const body = new THREE.Mesh(rbox(4.3, 0.4, 4.2, 0.18), mat(i % 2 ? '#ef4444' : '#f8fafc', { roughness: 0.35 }))
      const band = new THREE.Mesh(rbox(4.4, 0.25, 0.3, 0.1), mat(i % 2 ? '#f8fafc' : '#ef4444'))
      band.position.z = 2.0
      g.add(body, band)
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
      st.flippers.push(
        mover(ctx, {
          half: [2.15, 0.2, 2.1],
          obj: g,
          pose: (t, out) => {
            tableM(t, out)
            out.multiply(_m2.makeTranslation(f.x, 0, TRENCH.z0)).multiply(_m.makeRotationX(-flipAngle(st, i, t))).multiply(_m2.makeTranslation(0, -0.2, 2.1))
            return true
          },
        }),
      )
    })
    // Drop targets.
    const starTex = canvasTex(64, 64, (g2, w, h) => {
      g2.fillStyle = '#facc15'
      g2.fillRect(0, 0, w, h)
      g2.fillStyle = '#7c2d12'
      g2.font = '900 44px ui-rounded, system-ui, sans-serif'
      g2.textAlign = 'center'
      g2.fillText('★', w / 2, h / 2 + 15)
    })
    TARGETS.forEach((x, i) => {
      const m = new THREE.Mesh(rbox(2.6, 1.4, 0.4, 0.1), new THREE.MeshStandardMaterial({ map: starTex, roughness: 0.5, emissive: '#422006', emissiveIntensity: 0.3 }))
      m.castShadow = true
      mover(ctx, {
        half: [1.3, 0.7, 0.2],
        obj: m,
        pose: (t, out) => {
          const k = targetUp(st, i, t)
          tableM(t, out)
          out.multiply(_m2.makeTranslation(x, k * 1.45 - 0.75, TARGET_Z))
          return true
        },
      })
    })
    // Steel balls (dynamic, streamed to clients). Parked out of sight until launched.
    const ballGeo = new THREE.SphereGeometry(BALL_R, 24, 16)
    const chrome = mat('#e5e7eb', { metalness: 1, roughness: 0.15 })
    for (let i = 0; i < BALLS; i++) {
      const b = ctx.phys.dynamic({ x: i * 3, y: -40, z: 0 }, { damping: 0.45, ccd: true })
      ctx.phys.attach(b, ctx.RAPIER.ColliderDesc.ball(BALL_R).setDensity(5), { friction: 0.3, restitution: 0.5, groups: PROP_GROUPS })
      b.setEnabled(false)
      const mesh = new THREE.Mesh(ballGeo, chrome)
      mesh.castShadow = true
      ctx.root.add(mesh)
      ctx.syncProp(b, mesh)
      st.balls.push(b)
    }
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    const s = ctx.spawnGrid(n, { x: 0, z: 3.4, yaw: 0, spacing: 1.45, cols: 7 })[i]
    const w = _w.set(s.x, 0, s.z).applyMatrix4(tableM(0, _m))
    return { x: w.x, y: w.y, z: w.z, yaw: 0 }
  },

  start(ctx, st) {
    launchBall(ctx, st, 0, 0, 3)
  },

  tick(ctx, st) {
    const t = ctx.time
    raceTick(ctx, st.race, course)
    // Multiball once the leader is halfway.
    if (!st.multi) {
      const lead = ctx.leader()
      if (lead && raceProgress(st.race, course, lead) > 0.5) {
        st.multi = t
        for (let b = 1; b < BALLS; b++) launchBall(ctx, st, b, -6 + b * 3, 2 + b)
        ctx.fx.say('MULTIBALL!', ACCENT, 1.8)
        ctx.fx.sfx('ding')
      }
    }
    // Tilt warnings.
    const n = Math.min(4, Math.floor(t / STEP_T))
    if (n > st.step) {
      st.step = n
      ctx.fx.say('TILT!', '#fbbf24', 1.2)
      ctx.fx.shake(0.4)
      ctx.fx.sfx('crack')
    }
    // Bumpers fling toys (and balls) away; supercharged ones twice as hard.
    BUMPERS.forEach((b, i) => {
      const pow = st.boost[i] > t ? 2 : 1
      for (const toy of ctx.toys) {
        if (toy.status !== 'play') continue
        const lp = course.local(toy.pos)
        const dx = lp.x - b.x, dz = lp.z - b.z
        const d = Math.hypot(dx, dz)
        const key = `${toy.idx}:b${i}`
        if (d > BUMP_R + 0.55 || lp.y - 0.5 > 1.5 || (st.hitT.get(key) ?? -9) > t - 0.5) continue
        st.hitT.set(key, t)
        // Sometimes the bounce has a helpful up-table kick in it.
        const fwd = hash01(toy.idx, Math.floor(t * 3), i) < 0.35 ? 0.8 : 0
        _v.set(dx / (d || 1), 0, dz / (d || 1) + fwd).normalize().transformDirection(st.M)
        ctx.knock(toy, { x: _v.x * 9.5 * pow, y: 4 + pow, z: _v.z * 9.5 * pow }, 0.45)
        st.bump[i] = t
        ctx.fx.sfx('boing', toy.pos)
        ctx.fx.puff(toy.pos, 'spark', 8)
      }
    })
    // Balls: recycle at the bottom, kick off bumpers, bowl toys over.
    st.balls.forEach((ball, bi) => {
      if (!st.active[bi]) return
      const p = ball.translation()
      const lp = _w.set(p.x, p.y, p.z).applyMatrix4(st.Mi)
      if (lp.z < 1.2 || p.y < -6 || Math.abs(lp.x) > HW + 2) {
        launchBall(ctx, st, bi, ctx.rng.range(-6, 6), 2)
        return
      }
      const lx = lp.x, lz = lp.z
      BUMPERS.forEach((b, i) => {
        const dx = lx - b.x, dz = lz - b.z
        const d = Math.hypot(dx, dz)
        if (d < BUMP_R + BALL_R + 0.15) {
          _v.set(dx / d, 0, dz / d).transformDirection(st.M)
          const v = ball.linvel()
          ball.setLinvel({ x: v.x + _v.x * 5, y: v.y, z: v.z + _v.z * 5 }, true)
          st.bump[i] = t
        }
      })
      const v = ball.linvel()
      const sp = Math.hypot(v.x, v.y, v.z)
      if (sp < 2.2) return
      for (const toy of ctx.toys) {
        if (toy.status !== 'play') continue
        const d = Math.hypot(toy.pos.x - p.x, toy.pos.y - p.y, toy.pos.z - p.z)
        const key = `${toy.idx}:ball`
        if (d > BALL_R + 0.55 || (st.hitT.get(key) ?? -9) > t - 0.8) continue
        st.hitT.set(key, t)
        ctx.knock(toy, { x: (v.x / sp) * (3 + sp * 0.8), y: 3.5, z: (v.z / sp) * (3 + sp * 0.8) }, 0.7)
        ctx.fx.sfx('crunch', toy.pos)
      }
    })
    // Flippers flip whoever is on them as they fire.
    FLIPPERS.forEach((_f, i) => {
      const up = flipAngle(st, i, t) > 0.05
      if (up && !st.flipUp[i]) {
        _v.set(0, 0, 1).transformDirection(st.M)
        for (const toy of ctx.toys) {
          if (toy.status !== 'play' || !st.flippers[i].carrying(toy)) continue
          ctx.knock(toy, { x: _v.x * 6, y: 9.5, z: _v.z * 6 }, 0.3)
          ctx.fx.popup(toy, 'FLIPPED!', '#fde68a')
        }
        ctx.fx.sfx('slam', st.flippers[i].obj.position)
      }
      st.flipUp[i] = up
    })
    // Drop targets: shove (or dive into) one to knock it down.
    TARGETS.forEach((x, i) => {
      if (targetUp(st, i, t) < 1) return
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || (!toy.pad.shove && toy.dive <= 0)) continue
        const lp = course.local(toy.pos)
        if (Math.abs(lp.x - x) < 1.6 && lp.z < TARGET_Z && lp.z > TARGET_Z - 1.6) {
          st.down[i] = t
          ctx.fx.sfx('ding', toy.pos)
          break
        }
      }
    })
  },

  onFall(ctx, st, toy) {
    raceRespawn(ctx, st.race, course, toy, 'Drained! Back to the checkpoint')
  },

  rank(ctx, st) {
    return raceRank(ctx, st.race, course)
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as BotMem
    const t = ctx.time
    if (d.route === undefined) d.route = Math.floor(hash01(toy.idx, ctx.seed, 4) * 4)
    const path = PATHS[d.route]
    follow(ctx, toy, path, {
      pace: sk.pace,
      dt,
      toWorld: (w, out) => out.set(w.x, w.y, w.z).applyMatrix4(st.M),
      wait: (id) => !flipSafe(st, id, t),
    })
    const lp = course.local(toy.pos).clone()
    // A drop target in the way: shove it down.
    if (lp.z > TARGET_Z - 1.5 && lp.z < TARGET_Z && (d.stuck ?? 0) > 0.8) {
      TARGETS.forEach((x, i) => {
        if (targetUp(st, i, t) >= 1 && Math.abs(lp.x - x) < 1.5) {
          toy.pad.shove = true
          toy.yaw = Math.atan2(_v.set(0, 0, 1).transformDirection(st.M).x, _v.z)
        }
      })
    }
    // Dodge a ball rolling at us.
    st.balls.forEach((ball, bi) => {
      if (!st.active[bi]) return
      const p = ball.translation()
      const bl = _w.set(p.x, p.y, p.z).applyMatrix4(st.Mi)
      const ahead = bl.z - lp.z, side = bl.x - lp.x
      if (ahead > 0 && ahead < 5.5 && Math.abs(side) < 1.6 && ctx.rng.chance(sk.accuracy)) {
        _v.set(side > 0 ? -1 : 1, 0, 0).transformDirection(st.M)
        toy.pad.mx = _v.x
        toy.pad.mz = _v.z
      }
    })
  },

  pack(_c, st) {
    const r2 = (x: number) => Math.round(x * 100) / 100
    return [racePack(st.race), st.bump.map(r2), st.boost.map(r2), st.flipAt.map(r2), st.down.map(r2), r2(st.multi)]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number[], number[], number[], number[], number]
    raceUnpack(st.race, a[0])
    st.bump = a[1]
    st.boost = a[2]
    st.flipAt = a[3]
    st.down = a[4]
    st.multi = a[5]
  },

  visual(ctx, st) {
    const t = ctx.time
    st.vis.caps.forEach((c, i) => {
      const e = t - st.bump[i]
      const s = e >= 0 && e < 0.25 ? 1.25 - e : 1
      c.scale.set(s, 1, s)
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial
      m.emissiveIntensity = st.boost[i] > t ? 1.2 + Math.sin(t * 20) * 0.4 : e >= 0 && e < 0.25 ? 1 : 0.25
      m.emissive.set(st.boost[i] > t ? '#ef4444' : '#f472b6')
    })
    if (st.vis.pillar) {
      // From the attic floor up to the underside of the table's top end.
      const a = tiltAt(t)
      const top = PIVOT.y + Math.sin(a) * (LEN - 6) - 0.6
      const h = top + 12
      st.vis.pillar.scale.y = h
      st.vis.pillar.position.set(0, -12 + h / 2, PIVOT.z + Math.cos(a) * (LEN - 6))
    }
  },

  hud(ctx, st, me) {
    const t = ctx.time
    const deg = Math.round(THREE.MathUtils.radToDeg(tiltAt(t)))
    const chips = [`Tilt ${deg}°`]
    if (st.multi) chips.push('Multiball')
    let status: { text: string; color: string; pulse?: boolean } | undefined
    const n = Math.floor(t / STEP_T)
    if (ctx.phase === 'play' && n < 4 && (n + 1) * STEP_T - t < 3) status = { text: 'TILTING…', color: '#fbbf24', pulse: true }
    let prompt: string | undefined
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const lp = course.local(me.pos)
      if (lp.z > 19 && lp.z < TRENCH.z1) prompt = 'Cross on a flipper while it lies flat. It flips you when it fires!'
      else if (lp.z > 36 && lp.z < TARGET_Z + 0.5) prompt = 'Squeeze between the drop targets, or shove (click) one down.'
      else if (lp.z < 19) prompt = 'Run uphill! Bumpers fling you, sometimes forwards.'
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status, chips })
  },
})

function nearestBumper(t: Toy) {
  const lp = course.local(t.pos)
  let best = -1, bd = 7
  BUMPERS.forEach((b, i) => {
    const d = Math.hypot(lp.x - b.x, lp.z - b.z)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** Put ball b at the top of the table at local x, rolling down. */
function launchBall(ctx: LevelCtx, st: PBState, b: number, x: number, speed: number) {
  const ball = st.balls[b]
  if (!ball) return
  st.active[b] = true
  ball.setEnabled(true)
  const p = _w.set(x, BALL_R + 0.1, LEN - 2.2).applyMatrix4(st.M)
  ball.setTranslation({ x: p.x, y: p.y, z: p.z }, true)
  const v = _v.set(ctx.rng.range(-0.8, 0.8), 0, -speed).transformDirection(st.M).multiplyScalar(speed)
  ball.setLinvel({ x: v.x, y: v.y, z: v.z }, true)
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
  ctx.fx.sfx('boop', p)
}

/** The tilting table's visuals, in table space (the group follows the tilt). */
function buildTable(ctx: LevelCtx, st: PBState, table: THREE.Group) {
  const pf = playfieldTex()
  const field = new THREE.MeshStandardMaterial({ map: pf, roughness: 0.55 })
  const plane = (z0: number, z1: number) => {
    const g = new THREE.PlaneGeometry(HW * 2, z1 - z0).rotateX(-Math.PI / 2)
    // UVs: map this strip onto its share of the whole playfield texture.
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, (z0 + uv.getY(i) * (z1 - z0)) / LEN)
    const m = new THREE.Mesh(g, field)
    m.position.set(0, 0.005, (z0 + z1) / 2)
    m.receiveShadow = true
    table.add(m)
  }
  plane(0, TRENCH.z0)
  plane(TRENCH.z1, LEN)
  // Cabinet sides and underside, chrome rails.
  const cab = mat('#581c87', { roughness: 0.5 })
  const chrome = mat('#e5e7eb', { metalness: 0.9, roughness: 0.2 })
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, LEN + 1), cab)
    side.position.set(s * (HW + 0.3), -0.9, LEN / 2)
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, LEN, 10).rotateX(Math.PI / 2), chrome)
    rail.position.set(s * (HW + 0.3), 1.2, LEN / 2)
    table.add(side, rail)
  }
  for (const [z0, z1] of [[0, TRENCH.z0], [TRENCH.z1, LEN]]) {
    const under = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 0.5, z1 - z0), cab)
    under.position.set(0, -0.26, (z0 + z1) / 2)
    table.add(under)
  }
  const trench = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, TRENCH.z1 - TRENCH.z0).rotateX(-Math.PI / 2), mat('#0f0a1a'))
  trench.position.set(0, -2.4, (TRENCH.z0 + TRENCH.z1) / 2)
  table.add(trench)
  for (const zz of [-0.3, LEN + 0.3]) {
    const w = new THREE.Mesh(rbox(HW * 2 + 1.2, 1.2, 0.6, 0.2), cab)
    w.position.set(0, 0.6, zz)
    if (zz < 0) {
      // The drain gap in the bottom wall.
      const gap = new THREE.Mesh(new THREE.BoxGeometry(4, 1.3, 0.7), mat('#0f0a1a'))
      gap.position.set(0, 0.6, zz)
      table.add(gap)
    }
    table.add(w)
  }
  // Slingshots and lane guides.
  for (const s of [-1, 1]) {
    const sl = new THREE.Mesh(rbox(0.9, 1.2, 3.6, 0.3), mat('#f8fafc', { roughness: 0.4 }))
    sl.position.set(s * 7.2, 0.6, 6)
    const band = new THREE.Mesh(rbox(0.3, 0.5, 3.8, 0.1), mat('#ef4444'))
    band.position.set(s * 6.75, 0.6, 6)
    const guide = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 7), chrome)
    guide.position.set(s * 3, 0.5, 37.5)
    table.add(sl, band, guide)
  }
  // Pop bumpers: a body, a ring, a glowing cap.
  const bodyG = new THREE.CylinderGeometry(BUMP_R, BUMP_R * 1.05, 1.0, 20)
  const capG = new THREE.CylinderGeometry(BUMP_R * 0.95, BUMP_R * 0.8, 0.35, 20)
  const ringG = new THREE.TorusGeometry(BUMP_R * 1.02, 0.12, 8, 24).rotateX(Math.PI / 2)
  BUMPERS.forEach((b, i) => {
    const body = new THREE.Mesh(bodyG, mat('#f8fafc', { roughness: 0.4 }))
    body.position.set(b.x, 0.5, b.z)
    const ring = new THREE.Mesh(ringG, mat('#fbbf24', { metalness: 0.6, roughness: 0.3 }))
    ring.position.set(b.x, 0.75, b.z)
    const cap = new THREE.Mesh(capG, mat(['#ec4899', '#a855f7', '#22d3ee'][i % 3], { emissive: '#f472b6', emissiveIntensity: 0.25 }))
    cap.position.set(b.x, 1.17, b.z)
    body.castShadow = cap.castShadow = true
    table.add(body, ring, cap)
    st.vis.caps.push(cap)
  })
  // The backbox with its lit backglass, and the finish line across the top lanes.
  const box = new THREE.Mesh(rbox(HW * 2 + 1.2, 9, 1.6, 0.3), cab)
  box.position.set(0, 4.5, LEN + 1.4)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 - 1, 7), new THREE.MeshBasicMaterial({ map: backglassTex(), toneMapped: false }))
  glass.position.set(0, 4.8, LEN + 0.58)
  glass.rotation.y = Math.PI
  table.add(box, glass)
  const arch = finishArch(ctx, { x: 0, y: 0, z: 67.8, width: HW * 2 - 0.4, color: ACCENT, text: 'TOP LANES' })
  table.add(arch)
  for (const c of course.cps) {
    const s = textSprite('Checkpoint', { bg: '#86198f', size: 0.55 })
    s.position.set(HW - 1.4, 2.3, c.z)
    table.add(s)
  }
  table.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.receiveShadow = true
  })
  // A hydraulic pillar under the top end grows as the table tilts.
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1, 12), mat('#9ca3af', { metalness: 0.7, roughness: 0.3 }))
  pillar.position.set(0, -6, PIVOT.z + LEN - 6)
  ctx.root.add(pillar)
  st.vis.pillar = pillar
}
