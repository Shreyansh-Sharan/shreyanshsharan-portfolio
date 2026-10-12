// Hamster Wheel Heights (race). Up a tower of hamster-cage platforms joined by clear plastic tubes (some
// segments pop off and drop you to the bedding) and two gaps spanned by turnstile bridges. Each bridge turns on
// its own, but a hamster wheel beside it drives it: run forwards in the wheel to spin the bridge faster for
// everyone, or backwards to swing it away from a rival. Sunflower seeds give a short burst of speed.
// Tricks: pop the tube a rival is in, jam a bridge, and flick a seed shell to trip a rival.
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type Toy } from '../engine/types'
import {
  Course, canvasTex, finishArch, follow, hash01, mat, mover, pickupMesh, poseOf, raceHud, raceInit, racePack, raceRank, raceRespawn, raceSpawn,
  raceSpeedHazard, raceTick, raceUnpack, rbox, solid, type BotMem, type Mover, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#84cc16'
const HW = 6
/** Platforms: z range and height. */
const PLAT = [
  { z0: -46, z1: -38, y: 0 },
  { z0: -26, z1: -18, y: 3 },
  { z0: -8, z1: 0, y: 3 },
  { z0: 12, z1: 20, y: 6.5 },
  { z0: 30, z1: 37, y: 6.5 },
  { z0: 47, z1: 55, y: 9.5 },
]
/** Tube runs between platforms: from platform a to a+1, lane x positions. */
const RUNS = [
  { from: 0, lanes: [-3, 3] },
  { from: 2, lanes: [-3.6, 0, 3.6] },
  { from: 4, lanes: [-2.6, 2.6] },
]
const SEGS = 3
const TUBE_W = 2.4
/** Turnstile bridges over the gaps after platforms 1 and 3, each with a wheel. */
const BRIDGES = [
  { z: -13, y: 3, base: 0.3, wheel: { x: 4.3, z: -22.5 } },
  { z: 25, y: 6.5, base: -0.3, wheel: { x: -4.3, z: 16 } },
]
const ARM = 5.2
const SEEDS = [
  { x: -2.5, z: -21 },
  { x: 2, z: -24 },
  { x: -3, z: -2 },
  { x: 3.5, z: -5 },
  { x: 2, z: 14 },
  { x: -1, z: 18.5 },
  { x: -3, z: 33 },
  { x: 3, z: 35.5 },
]
const POP_WARN = 0.9
const POP_GONE = 3

interface Seg {
  run: number
  lane: number
  k: number
  x: number
  z0: number
  z1: number
  y0: number
  y1: number
  period: number
  off: number
}

const SEG_LIST: Seg[] = []
RUNS.forEach((r, ri) => {
  const a = PLAT[r.from], b = PLAT[r.from + 1]
  const len = b.z0 - a.z1
  r.lanes.forEach((x, li) => {
    for (let k = 0; k < SEGS; k++) {
      const z0 = a.z1 + (len * k) / SEGS, z1 = a.z1 + (len * (k + 1)) / SEGS
      const y0 = a.y + ((b.y - a.y) * k) / SEGS, y1 = a.y + ((b.y - a.y) * (k + 1)) / SEGS
      SEG_LIST.push({ run: ri, lane: li, k, x, z0, z1, y0, y1, period: 16 + hash01(ri, li, k) * 10, off: hash01(k, li, ri + 7) * 26 })
    }
  })
})

interface HWState {
  race: RaceState
  /** Bridge angles and turn rates (host-integrated), wheel spin, jams. */
  ang: number[]
  omega: number[]
  wheel: number[]
  jam: number[]
  /** Segment popped by a trick at this time. */
  popAt: number[]
  /** Seeds on the floor (bitmask) and when each comes back (host). */
  seeds: number
  seedBack: number[]
  bridges: Mover[][]
  segs: Mover[]
  vis: { wheels: THREE.Object3D[]; seeds: { m: THREE.Object3D; y: number; i: number }[] }
}

/** Segment state at t: 0 solid, 1 shaking (about to pop), 2 gone (falling), with seconds into that state. */
function segState(st: HWState, i: number, t: number): [number, number] {
  const s = SEG_LIST[i]
  const e = t - st.popAt[i]
  if (e >= 0 && e < POP_WARN + POP_GONE) return e < POP_WARN ? [1, e] : [2, e - POP_WARN]
  if (t < 8) return [0, 0]
  const u = ((((t + s.off) / s.period) % 1) + 1) % 1 * s.period
  if (u < POP_WARN) return [1, u]
  if (u < POP_WARN + POP_GONE) return [2, u - POP_WARN]
  return [0, 0]
}

/** Seconds this segment will stay solid (0 if shaking or gone). */
function segSafe(st: HWState, i: number, t: number) {
  if (segState(st, i, t)[0] !== 0) return 0
  for (let k = 1; k <= 8; k++) if (segState(st, i, t + k * 0.4)[0] !== 0) return k * 0.4
  return 3.6
}

function laneSafe(st: HWState, run: number, lane: number, t: number) {
  let m = 99
  SEG_LIST.forEach((s, i) => {
    if (s.run === run && s.lane === lane) m = Math.min(m, segSafe(st, i, t))
  })
  return m
}

/** How close a bridge is to lining up with the course (0 = an arm points straight along it). */
function bridgeOff(st: HWState, b: number) {
  const a = (((st.ang[b] % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2))
  return Math.min(a, Math.PI / 2 - a)
}

function wheelZone(b: number, toy: Toy) {
  const w = BRIDGES[b].wheel
  return Math.abs(toy.pos.x - w.x) < 1.0 && Math.abs(toy.pos.z - w.z) < 1.6 && Math.abs(toy.feet - BRIDGES[b].y) < 0.5
}

function buildPath(l0: number, l1: number, l2: number): Wp[] {
  const p: Wp[] = [{ x: 0, y: 0, z: -42, w: 3 }]
  const tube = (ri: number, li: number) => {
    const r = RUNS[ri], a = PLAT[r.from], b = PLAT[r.from + 1]
    const x = r.lanes[li]
    p.push({ x, y: a.y, z: a.z1 - 1.2, r: 0.6, wait: 10 + ri })
    p.push({ x, y: (a.y + b.y) / 2, z: (a.z1 + b.z0) / 2, r: 1, noGap: true })
    p.push({ x: x * 0.6, y: b.y, z: b.z0 + 1.6, r: 1.2, noGap: true })
  }
  tube(0, l0)
  p.push({ x: 0, y: 3, z: -19, w: 1.4, wait: 0, r: 1.4 }, { x: 0, y: 3, z: -13, noGap: true, r: 1.6 }, { x: 0, y: 3, z: -6, w: 2 })
  tube(1, l1)
  p.push({ x: 0, y: 6.5, z: 19, w: 1.4, wait: 1, r: 1.4 }, { x: 0, y: 6.5, z: 25, noGap: true, r: 1.6 }, { x: 0, y: 6.5, z: 32, w: 2 })
  tube(2, l2)
  p.push({ x: 0, y: 9.5, z: 48.8, w: 3 })
  return p
}

const PATHS: Wp[][] = []
const routeOf = (a: number, b: number, c: number) => a * 6 + b * 2 + c
for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 2; c++) PATHS[routeOf(a, b, c)] = buildPath(a, b, c)

const course = new Course({
  path: PATHS[routeOf(0, 1, 0)],
  cps: [
    { x: 0, y: 3, z: -22, hx: HW - 0.6, hz: 3.6, yaw: 0, name: 'First cage' },
    { x: 0, y: 3, z: -4, hx: HW - 0.6, hz: 3.6, yaw: 0, name: 'Over the first bridge' },
    { x: 0, y: 6.5, z: 16, hx: HW - 0.6, hz: 3.6, yaw: 0, name: 'Second cage' },
    { x: 0, y: 6.5, z: 33.5, hx: HW - 0.6, hz: 3.2, yaw: 0, name: 'Over the second bridge' },
  ],
  finish: { x: 0, y: 9.5, z: 48.8, hx: HW, hz: 0.7 },
  podium: { x: 0, y: 9.5, z: 52.6, yaw: Math.PI },
})

function shavingsTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#e8cf9e'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = i % 2 ? 'rgba(170,120,60,0.45)' : 'rgba(255,240,210,0.7)'
      g.lineWidth = 2
      g.beginPath()
      const x = (i * 37) % w, y = (i * 59) % h
      g.arc(x, y, 4 + (i % 5), 0, Math.PI * (1 + (i % 3) * 0.3))
      g.stroke()
    }
  }, [8, 16])
}

/** A hamster wheel: two rims, spokes and rungs. Spins about its local x axis. */
function wheelMesh() {
  const g = new THREE.Group()
  const spin = new THREE.Group()
  g.add(spin)
  const rimM = mat('#f472b6', { roughness: 0.4 })
  for (const s of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.09, 8, 32).rotateY(Math.PI / 2), rimM)
    rim.position.x = s * 1.0
    spin.add(rim)
    for (let k = 0; k < 6; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.6, 0.08), rimM)
      sp.position.x = s * 1.0
      sp.rotation.x = (k / 6) * Math.PI
      spin.add(sp)
    }
  }
  const rungs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 5).rotateZ(Math.PI / 2), mat('#e5e7eb', { metalness: 0.6 }), 28)
  const m = new THREE.Matrix4()
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2
    rungs.setMatrixAt(k, m.makeTranslation(0, Math.cos(a) * 1.78, Math.sin(a) * 1.78))
  }
  spin.add(rungs)
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.9, 8), mat('#9ca3af'))
  stand.position.set(-1.25, -0.95, 0)
  g.add(stand)
  return { g, spin }
}

export default defineLevel<HWState>({
  id: 'hamster',
  name: 'Hamster Wheel Heights',
  type: 'race',
  blurb: 'Climb a tower of hamster tubes and cages. Run in a wheel to spin a bridge for everyone, or against them.',
  howTo: [
    'Climb the clear tubes: shaking ones are about to pop off',
    'Turnstile bridges span the gaps: cross when an arm lines up',
    'Run in a hamster wheel to spin its bridge: forwards to help, backwards to sabotage',
    'Grab sunflower seeds for a burst of speed',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 150,
  camera: { kind: 'chase', dist: 7.2 },
  introOrbit: { radius: 28, height: 16, center: [0, 4, 4] },
  sprinkles: { start: 1 },
  fallY: -4.5,
  sky: { color: '#20180f', fogNear: 60, fogFar: 170 },

  tricks: [
    {
      id: 'pop',
      name: 'Pop the Tube',
      icon: 'crack',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'Pop the tube piece a rival is climbing through. It shakes, then drops.',
      counter: 'Jump to the next piece the moment it shakes.',
      can: (_c, _s, _u, t) => (t && nearestSeg(t) >= 0 ? true : 'They are not in a tube'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const i = nearestSeg(target)
        if (i < 0) return
        s.popAt[i] = ctx.time - 0.2
        ctx.fx.popup(target, 'Pop!', '#fca5a5')
        ctx.fx.sfx('pop', target.pos)
      },
    },
    {
      id: 'jam',
      name: 'Jam the Bridge',
      icon: 'tack',
      cost: 2,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: 'Wedge a seed in the turnstile nearest a rival: it stops dead for 3.5 seconds.',
      counter: 'Run in the wheel to shake it loose, or wait it out.',
      can: (_c, _s, _u, t) => (t && BRIDGES.some((b) => Math.abs(b.z - t.pos.z) < 11) ? true : 'No bridge near them'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const b = Math.abs(BRIDGES[0].z - target.pos.z) < Math.abs(BRIDGES[1].z - target.pos.z) ? 0 : 1
        s.jam[b] = ctx.time + 3.5
        ctx.fx.popup(target, 'Bridge jammed!', '#fca5a5')
        ctx.fx.sfx('crunch', { x: 0, y: BRIDGES[b].y, z: BRIDGES[b].z })
      },
      botUse: (ctx, s, user) => {
        // Jam it while it's turned away and a rival waits at the edge.
        for (const [b, br] of BRIDGES.entries()) {
          if (bridgeOff(s, b) < 0.5) continue
          const r = ctx.toys.find((t) => t !== user && t.status === 'play' && Math.abs(t.pos.z - (br.z - 6)) < 2.5 && Math.abs(t.feet - br.y) < 0.6)
          if (r) return r
        }
        return false
      },
    },
    {
      id: 'shell',
      name: 'Seed Shell',
      icon: 'crumb',
      cost: 1,
      cooldown: 6,
      busy: 0.5,
      target: 'rival',
      range: 9,
      desc: 'Flick a slippery seed shell under a rival: they skid and lose any seed boost.',
      counter: 'Bubble Wrap, or keep your distance.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.race.fast[target.idx] = 0
        const a = ctx.rng.range(0, Math.PI * 2)
        ctx.knock(target, { x: Math.cos(a) * 3, y: 2, z: Math.sin(a) * 3 }, 0.6)
        ctx.fx.popup(target, 'Skid!', '#fde68a')
      },
    },
    bubbleWrap<HWState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 28, hd: 66, ridge: 34, knee: 8, y: -6, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    // Bedding far below (no collider: landing in it is a fall).
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(26, 112).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: shavingsTex(), roughness: 1 }))
    bed.position.set(0, -5.95, 4)
    bed.receiveShadow = true
    ctx.root.add(bed)
    // Cage platforms (pastel plastic trays with a rim).
    const cols = ['#a7f3d0', '#fbcfe8', '#ddd6fe', '#fde68a', '#bae6fd', '#fecaca']
    PLAT.forEach((p, i) => {
      solid(ctx, { pos: [0, p.y - 0.3, (p.z0 + p.z1) / 2], size: [HW * 2, 0.6, p.z1 - p.z0], material: mat(cols[i], { roughness: 0.5 }), round: 0.2 })
      for (const s of [-1, 1]) solid(ctx, { pos: [s * (HW - 0.12), p.y + 0.3, (p.z0 + p.z1) / 2], size: [0.24, 0.6, p.z1 - p.z0], material: mat('#f8fafc', { roughness: 0.4 }), round: 0.08 })
      // A pillar down to the bedding.
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, p.y + 6, 10), mat('#d1d5db'))
      pillar.position.set(0, (p.y - 6) / 2 - 0.3, (p.z0 + p.z1) / 2)
      ctx.root.add(pillar)
    })
    // The cage: wire bars down both sides (instanced).
    const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 20, 5), mat('#cbd5e1', { metalness: 0.7, roughness: 0.3 }), 200)
    const m4 = new THREE.Matrix4()
    let n = 0
    for (const s of [-1, 1])
      for (let z = -48; z <= 57 && n < 200; z += 1.1) bars.setMatrixAt(n++, m4.makeTranslation(s * (HW + 1.6), 4, z))
    bars.count = n
    ctx.root.add(bars)
    for (const y of [-5.8, 13.8]) {
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 106), mat('#94a3b8', { metalness: 0.7 }))
        rail.position.set(s * (HW + 1.6), y, 4.5)
        ctx.root.add(rail)
      }
    }
    // Water bottle on the cage side, the food bowl finish.
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4, 14), new THREE.MeshStandardMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.55, roughness: 0.1 }))
    bottle.position.set(HW + 1.2, 5, -2)
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8).rotateZ(Math.PI / 2.6), mat('#e5e7eb', { metalness: 0.9 }))
    spout.position.set(HW + 0.2, 2.6, -2)
    ctx.root.add(bottle, spout)
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(2.6, 0), new THREE.Vector2(3.2, 1.2), new THREE.Vector2(2.9, 1.25), new THREE.Vector2(2.4, 0.3), new THREE.Vector2(0, 0.3)], 24),
      mat('#f97316', { roughness: 0.4 }),
    )
    bowl.position.set(-3.2, PLAT[5].y, 53.2)
    ctx.root.add(bowl)
    ctx.phys.cylinder({ x: -3.2, y: PLAT[5].y + 0.6, z: 53.2 }, 0.6, 3.1)
    finishArch(ctx, { x: 0, y: PLAT[5].y, z: 48.8, width: HW * 2 - 0.4, color: ACCENT, text: 'FOOD BOWL!' })
    for (const c of course.cps) {
      const s = textSprite('Checkpoint', { bg: '#4d7c0f', size: 0.5 })
      s.position.set(HW - 1, c.y + 2.4, c.z)
      ctx.root.add(s)
    }
  },

  init(ctx) {
    const st: HWState = {
      race: raceInit(ctx),
      ang: BRIDGES.map(() => 0.6),
      omega: BRIDGES.map((b) => b.base),
      wheel: BRIDGES.map(() => 0),
      jam: BRIDGES.map(() => -9),
      popAt: SEG_LIST.map(() => -99),
      seeds: (1 << SEEDS.length) - 1,
      seedBack: SEEDS.map(() => 0),
      bridges: [],
      segs: [],
      vis: { wheels: [], seeds: [] },
    }
    raceSpeedHazard(ctx, st.race, 5.6)
    // Tube segments: a floor and low walls, a clear cover, popping off on their own schedule.
    const floorM = mat('#f0abfc', { roughness: 0.45 })
    const coverM = new THREE.MeshStandardMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.28, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false })
    SEG_LIST.forEach((s, i) => {
      const len = Math.hypot(s.z1 - s.z0, s.y1 - s.y0) + 0.08
      const pitch = -Math.atan2(s.y1 - s.y0, s.z1 - s.z0)
      const g = new THREE.Group()
      const floor = new THREE.Mesh(rbox(TUBE_W, 0.3, len, 0.1), floorM)
      floor.receiveShadow = true
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(TUBE_W / 2 + 0.15, TUBE_W / 2 + 0.15, len, 16, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), coverM)
      cover.position.y = 0.15
      g.add(floor, cover)
      st.segs.push(
        mover(ctx, {
          half: [TUBE_W / 2, 0.15, len / 2],
          obj: g,
          extra: [-1, 1].map((sx) => ({ pos: [sx * (TUBE_W / 2 + 0.1), 0.5, 0] as [number, number, number], half: [0.1, 0.4, len / 2] as [number, number, number] })),
          pose: (t, out) => {
            const [state, e] = segState(st, i, t)
            const cx = s.x, cy = (s.y0 + s.y1) / 2 - 0.15, cz = (s.z0 + s.z1) / 2
            if (state === 1) {
              poseOf(out, cx + Math.sin(e * 70) * 0.05, cy, cz, 0, pitch, Math.sin(e * 55) * 0.03)
              return true
            }
            if (state === 2) {
              const y = cy - 12 * e * e
              if (y < -14) return false
              poseOf(out, cx, y, cz, 0, pitch + e * 0.8, e * 0.5)
              return true
            }
            poseOf(out, cx, cy, cz, 0, pitch, 0)
            return true
          },
        }),
      )
    })
    // Turnstile bridges: two crossed planks on a post, turned by the host and synced.
    const plankM = mat('#fbbf24', { roughness: 0.5 })
    BRIDGES.forEach((b, bi) => {
      const arms: Mover[] = []
      for (let k = 0; k < 2; k++) {
        const plank = new THREE.Mesh(rbox(2.6, 0.3, ARM * 2, 0.1), plankM)
        plank.castShadow = plank.receiveShadow = true
        arms.push(
          mover(ctx, {
            half: [1.3, 0.15, ARM],
            obj: plank,
            pose: (_t, out) => {
              poseOf(out, 0, b.y - 0.15, b.z, st.ang[bi] + (k * Math.PI) / 2)
              return true
            },
          }),
        )
      }
      st.bridges.push(arms)
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, b.y + 6, 10), mat('#a16207'))
      post.position.set(0, (b.y - 6) / 2 - 0.3, b.z)
      ctx.root.add(post)
      const wh = wheelMesh()
      wh.g.position.set(b.wheel.x, b.y + 1.8, b.wheel.z)
      ctx.root.add(wh.g)
      st.vis.wheels.push(wh.spin)
      const sign = textSprite('Run here: spin the bridge!', { bg: '#be185d', size: 0.4 })
      sign.position.set(b.wheel.x, b.y + 4.1, b.wheel.z)
      ctx.root.add(sign)
    })
    // Bridge turning between snapshots (every screen) and the wheel treadmills (predicted).
    ctx.hazards.add({
      predict: true,
      update(c, _t, dt) {
        if (c.phase !== 'play') return
        for (let b = 0; b < BRIDGES.length; b++) st.ang[b] += st.omega[b] * dt
      },
      affect(c, toy, dt) {
        if (toy.status !== 'play') return
        for (let b = 0; b < BRIDGES.length; b++) {
          if (!wheelZone(b, toy)) continue
          // Running in the wheel keeps you in place.
          const p = toy.body.translation()
          toy.body.setTranslation({ x: p.x, y: p.y, z: p.z - toy.vel.z * dt * 0.92 }, true)
          if (c.isHost) st.wheel[b] = THREE.MathUtils.clamp(st.wheel[b] + toy.vel.z * 0.9 * dt, -4, 4)
        }
      },
    })
    // Seeds.
    st.vis.seeds = SEEDS.map((s, i) => {
      const m = pickupMesh('#3f3f46', 'seed')
      const y = s.z < 10 ? 3 : 6.5
      m.position.set(s.x, y + 0.6, s.z)
      ctx.root.add(m)
      return { m, y, i }
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return raceSpawn(ctx, { x: 0, y: 0, z: -43, yaw: 0, cols: 7 }, i, n)
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    raceTick(ctx, st.race, course)
    // Bridges: base turn plus the wheel's drive; jammed ones stop.
    for (let b = 0; b < BRIDGES.length; b++) {
      st.wheel[b] *= Math.max(0, 1 - dt * 0.7)
      st.omega[b] = st.jam[b] > t ? 0 : BRIDGES[b].base + st.wheel[b] * 0.17
    }
    // Seeds: a burst of speed.
    SEEDS.forEach((s, i) => {
      const y = s.z < 10 ? 3 : 6.5
      if (!(st.seeds & (1 << i))) {
        if (t > st.seedBack[i]) st.seeds |= 1 << i
        return
      }
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || Math.hypot(toy.pos.x - s.x, toy.pos.z - s.z) > 0.9 || Math.abs(toy.feet - y) > 1) continue
        st.seeds &= ~(1 << i)
        st.seedBack[i] = t + 10
        st.race.fast[toy.idx] = t + 3
        ctx.fx.popup(toy, 'Seed rush!', '#bef264')
        ctx.fx.sfx('coin', toy.pos)
        break
      }
    })
  },

  onFall(ctx, st, toy) {
    raceRespawn(ctx, st.race, course, toy, 'Into the bedding!')
  },

  rank(ctx, st) {
    return raceRank(ctx, st.race, course)
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as BotMem & { l?: number[] }
    const t = ctx.time
    if (!d.l) d.l = [Math.floor(hash01(toy.idx, 1) * 2), Math.floor(hash01(toy.idx, 2) * 3), Math.floor(hash01(toy.idx, 3) * 2)]
    d.route = routeOf(d.l[0], d.l[1], d.l[2])
    const path = PATHS[d.route]
    // Mischief: a mean bot near a wheel runs backwards in it while a rival waits at the bridge.
    for (let b = 0; b < BRIDGES.length; b++) {
      const w = BRIDGES[b].wheel
      if (Math.hypot(toy.pos.x - w.x, toy.pos.z - w.z) > 2.2 || Math.abs(toy.feet - BRIDGES[b].y) > 0.5) continue
      const rival = ctx.toys.some((r) => r !== toy && r.status === 'play' && Math.abs(r.pos.z - (BRIDGES[b].z - 5.5)) < 1.8 && Math.abs(r.feet - BRIDGES[b].y) < 0.5)
      if (rival && sk.aggression > 0.5 && hash01(toy.idx, Math.floor(t / 6)) < sk.aggression * 0.5) {
        toy.pad.mx = (w.x - toy.pos.x) * 1.5
        toy.pad.mz = wheelZone(b, toy) ? -1 : (w.z - toy.pos.z) * 1.5
        return
      }
    }
    follow(ctx, toy, path, {
      pace: sk.pace,
      dt,
      wait: (id) => {
        if (id < 10) return bridgeOff(st, id) > 0.12 || Math.sign(st.omega[id]) === 0
        // A tube run: switch to the lane that will stay up longest, and wait if none will.
        const ri = id - 10
        let best = d.l![ri], bs = laneSafe(st, ri, best, t)
        RUNS[ri].lanes.forEach((_x, li) => {
          const s = laneSafe(st, ri, li, t)
          if (s > bs + 0.6) {
            bs = s
            best = li
          }
        })
        if (best !== d.l![ri]) {
          d.l![ri] = best
          d.route = routeOf(d.l![0], d.l![1], d.l![2])
        }
        return bs < 2.6
      },
    })
  },

  pack(_c, st) {
    const r2 = (x: number) => Math.round(x * 1000) / 1000
    return [racePack(st.race), st.ang.map(r2), st.omega.map(r2), st.wheel.map((x) => Math.round(x * 10) / 10), st.jam.map((x) => Math.round(x * 10) / 10), st.popAt.map((x) => Math.round(x * 10) / 10), st.seeds]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number[], number[], number[], number[], number[], number]
    raceUnpack(st.race, a[0])
    st.ang = a[1]
    st.omega = a[2]
    st.wheel = a[3]
    st.jam = a[4]
    st.popAt = a[5]
    st.seeds = a[6]
  },

  visual(ctx, st, dt) {
    const t = ctx.time
    st.vis.wheels.forEach((w, b) => {
      w.rotation.x += (st.wheel[b] / 1.8) * dt
    })
    for (const s of st.vis.seeds) {
      s.m.visible = (st.seeds & (1 << s.i)) > 0
      s.m.rotation.y += dt * 2.5
      s.m.position.y = s.y + 0.6 + Math.sin(t * 3 + s.i) * 0.1
    }
    // Seed rush: a little speed lean.
    for (const toy of ctx.toys) {
      if (!toy.rig) continue
      toy.rig.root.rotation.x = (st.race.fast[toy.idx] ?? 0) > t && toy.status === 'play' ? 0.12 : 0
    }
  },

  hud(ctx, st, me) {
    const t = ctx.time
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    const chips: string[] = []
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const inWheel = BRIDGES.findIndex((_b, i) => wheelZone(i, me))
      const nearB = BRIDGES.findIndex((b) => Math.abs(me.pos.z - b.z) < 9 && Math.abs(me.feet - b.y) < 1)
      if (inWheel >= 0) {
        prompt = 'Run forwards (towards the bridge) to spin it faster, backwards to swing it away!'
        status = { text: `Wheel ${st.wheel[inWheel] >= 0 ? '+' : ''}${st.wheel[inWheel].toFixed(1)}`, color: ACCENT }
      } else if (nearB >= 0) {
        if (st.jam[nearB] > t) status = { text: 'BRIDGE JAMMED', color: '#fca5a5', pulse: true }
        else if (bridgeOff(st, nearB) < 0.15) status = { text: 'BRIDGE LINED UP: GO!', color: ACCENT, pulse: true }
        prompt = 'Cross when an arm of the turnstile lines up. The wheel beside it drives it.'
      } else if (SEG_LIST.some((s, i) => Math.abs(me.pos.x - s.x) < 1.4 && me.pos.z > s.z0 - 0.5 && me.pos.z < s.z1 + 0.5 && segState(st, i, t)[0] === 1)) {
        status = { text: 'TUBE POPPING!', color: '#fca5a5', pulse: true }
        prompt = 'Your tube is shaking: jump to the next piece!'
      } else prompt = 'Up the tubes! Shaking pieces are about to pop off.'
      if ((st.race.fast[me.idx] ?? 0) > t) chips.push('Seed rush!')
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status, chips })
  },
})

/** The tube piece a toy is inside (or -1). */
function nearestSeg(t: Toy) {
  for (let i = 0; i < SEG_LIST.length; i++) {
    const s = SEG_LIST[i]
    if (Math.abs(t.pos.x - s.x) < TUBE_W / 2 + 0.2 && t.pos.z >= s.z0 - 0.2 && t.pos.z <= s.z1 + 0.2 && Math.abs(t.feet - (s.y0 + s.y1) / 2) < 1.6) return i
  }
  return -1
}
