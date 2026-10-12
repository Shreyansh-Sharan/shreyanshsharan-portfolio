// Train Set Express (race). Across a model railway on a big felt table: little trains cross the course at level
// crossings whose barriers drop before each train, an express runs alongside (hop on a flat wagon for a fast
// ride, hop off at the halt), and a mountain blocks the way: its tunnel spits you out at a random exit. The
// station clock ticks over every 20 seconds and every train gets faster.
// Tricks: drop a crossing's barriers early in front of a rival, switch the points so their tunnel trip goes
// backwards, and send the ticket inspector to bump a rival off a train.
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { FOOT } from '../engine/toy'
import { defineLevel } from '../engine/types'
import {
  Course, canvasTex, decor, detachDecor, finishArch, follow, hash01, mat, mover, poseOf, raceHud, raceInit, racePack, raceRank, raceRespawn, raceSpawn,
  raceSpeedHazard, raceTick, raceUnpack, rbox, solid, stripeTex, type BotMem, type Mover, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#ef4444'
const X0 = -16 // table left edge
const X1 = 9 // table right edge
const RUN_R = 4.6 // right edge of the running area
const EXP_X = 7.2 // express track
const Z0 = -54
const Z1 = 52
/** Level crossings: track z, direction of travel, phase on the loop. */
const CROSS = [
  { z: -30, dir: 1, phase: 0 },
  { z: 18, dir: -1, phase: 21 },
  { z: 29, dir: 1, phase: 40 },
  { z: 32.5, dir: -1, phase: 9 },
]
const CROSS_LEN = RUN_R + 0.5 - X0 // visible track length
const CAR_L = 3.3
const CROSS_TRAIN = 3 * CAR_L
const CROSS_LOOP = 58
const CROSS_V = 7
const MOUNTAIN = { z0: -4, z1: 8 }
const MOUTH = { x: -2.5, z: MOUNTAIN.z0 }
/** Tunnel exits: where you pop out and which way you face. */
const EXITS = [
  { x: -2.5, z: MOUNTAIN.z1 + 1.4, yaw: 0, name: 'Out the far side!' },
  { x: -12.5, z: 24, yaw: Math.PI / 2, name: 'Express exit!' },
  { x: -9, z: MOUNTAIN.z0 - 1.6, yaw: Math.PI, name: 'Spat back out!' },
]
const EXP_LOOP = 160
const EXP_V = 10
const EXP_CARS = 6 // loco + 5 flat wagons
const EXP_START = Z0 - 2
const EXP_END = 40
const HALT = { x0: 4.3, x1: 5.75, z0: 20, z1: 27 }
const STATION = { x0: 4.3, x1: 5.75, z0: -50, z1: -38 }
const LAP = 20

interface TSState {
  race: RaceState
  /** Crossing c forced shut until this time. */
  early: number[]
  /** Toy's next tunnel trip goes backwards until this time. */
  points: number[]
  // Host only.
  express: Mover[]
  // Visuals.
  vis: { lights: THREE.Mesh[]; hand: THREE.Object3D | null; bell: number[] }
}

/** Track distance covered by a train moving at 1 m/s × the clock's speed-ups (pure function of time). */
function dist(t: number) {
  t = Math.max(0, t)
  const n = Math.min(5, Math.floor(t / LAP))
  return LAP * n + LAP * 0.12 * ((n * (n - 1)) / 2) + (t - LAP * n) * (1 + 0.12 * n)
}

function mult(t: number) {
  return 1 + 0.12 * Math.min(5, Math.floor(Math.max(0, t) / LAP))
}

/** Crossing train c: head position along its loop (0 = entering at its first portal). */
function crossU(c: number, t: number) {
  return (((dist(t) * CROSS_V + CROSS[c].phase) % CROSS_LOOP) + CROSS_LOOP) % CROSS_LOOP
}

/** Is a crossing train in the crossing (or arriving within `ahead` seconds)? */
function crossBusy(c: number, t: number, ahead = 0) {
  const u = crossU(c, t + ahead)
  return u < CROSS_LEN + CROSS_TRAIN
}

function gateShut(st: TSState, c: number, t: number) {
  return st.early[c] > t || crossBusy(c, t, 0) || crossBusy(c, t, 2.1)
}

/** Barrier position 0 (up) .. 1 (down), eased over ~0.6 s. */
function gateK(st: TSState, c: number, t: number) {
  let k = 0
  for (let i = 0; i < 4; i++) if (gateShut(st, c, t - i * 0.18)) k += 0.25
  return k
}

/** Express head position (z) for train j at time t. */
function expHead(j: number, t: number) {
  const u = (((dist(t) * EXP_V + j * (EXP_LOOP / 2)) % EXP_LOOP) + EXP_LOOP) % EXP_LOOP
  return EXP_START + u
}

function expCarZ(j: number, i: number, t: number) {
  return expHead(j, t) - 1.8 - i * CAR_L
}

const visibleExp = (z: number) => z > Z0 + 3.2 && z < EXP_END + 0.5

function buildPath(ride: boolean): Wp[] {
  const p: Wp[] = [{ x: -3, y: 0, z: -44, w: 4 }]
  if (ride) {
    p.push({ x: 3.6, y: 0, z: -43.5, r: 0.8 }, { x: 5.1, y: 1, z: -43, r: 0.7, wait: 9 }, { x: EXP_X, y: 1, z: -41, r: 0.9, noGap: true, ride: true })
    p.push({ x: 5, y: 1, z: 24, r: 1.2, noGap: true }, { x: -2, y: 0, z: 24.5, w: 3 })
  } else {
    p.push({ x: -3, y: 0, z: -32.3, w: 4, wait: 0, r: 1.4 }, { x: -3, y: 0, z: -26, w: 4 }, { x: -2.6, y: 0, z: -7, w: 1, r: 0.8 }, { x: MOUTH.x, y: 0, z: MOUTH.z - 0.2, r: 0.5 })
    p.push({ x: -3, y: 0, z: 12.5, w: 4 }, { x: -3, y: 0, z: 15.7, w: 4, wait: 1, r: 1.4 }, { x: -3, y: 0, z: 22, w: 4 })
  }
  p.push({ x: -3, y: 0, z: 26.8, w: 4, wait: 2, r: 1.2 }, { x: -3, y: 0, z: 30.75, w: 3, wait: 3, r: 1.0 }, { x: -3, y: 0, z: 36, w: 4 }, { x: -3, y: 0, z: 43.5, w: 4 })
  return p
}

const PATHS = [buildPath(false), buildPath(true)]
const P0 = PATHS[0]
const idxOf = (p: Wp[], z: number) => p.findIndex((w) => Math.abs(w.z - z) < 0.01)

const course = new Course({
  path: P0,
  cps: [
    { x: -3, y: 0, z: -24, hx: 6.5, hz: 1.6, yaw: 0, name: 'Past the first crossing' },
    { x: -3, y: 0, z: 12, hx: 6.5, hz: 2.5, yaw: 0, name: 'Over the mountain' },
    { x: -3, y: 0, z: 23.5, hx: 6.5, hz: 3, yaw: 0, name: 'The halt' },
  ],
  finish: { x: -3, y: 0, z: 43.5, hx: 7.5, hz: 0.6 },
  podium: { x: -3, y: 0.6, z: 48.5, yaw: Math.PI },
})

function feltTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4d7c3a'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 140; i++) {
      g.fillStyle = i % 3 ? 'rgba(120,170,80,0.22)' : 'rgba(40,80,30,0.25)'
      g.beginPath()
      g.arc((i * 97) % w, (i * 57 + i * i) % h, 6 + (i % 7) * 3, 0, Math.PI * 2)
      g.fill()
    }
  }, [6, 24])
}

function roadTex() {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#c9a66b'
    g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(120,90,50,0.25)'
    for (let i = 0; i < 40; i++) g.fillRect((i * 13) % w, (i * 29) % h, 3, 3)
  }, [3, 30])
}

function windowTex(color: string) {
  return canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = color
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#fef3c7'
    for (let i = 0; i < 3; i++) g.fillRect(10 + i * 40, 12, 28, 24)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(0, h - 10, w, 10)
  })
}

const wheelGeo = () => new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10).rotateX(Math.PI / 2)

/** A carriage (crossing trains: long along x; the express: flat wagons along z). */
function carMesh(kind: 'loco' | 'coach' | 'flat', color: string, alongX: boolean) {
  const g = new THREE.Group()
  const body = new THREE.Group()
  g.add(body)
  const black = mat('#1f2937', { roughness: 0.5 })
  const L = CAR_L - 0.2
  if (kind === 'flat') {
    const deck = new THREE.Mesh(rbox(2.4, 0.3, L, 0.06), mat(color))
    deck.position.y = 0.85
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, L - 0.4), black)
    chassis.position.y = 0.45
    body.add(deck, chassis)
  } else if (kind === 'coach') {
    const m = new THREE.MeshStandardMaterial({ map: windowTex(color), roughness: 0.6 })
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, L), [m, m, mat(color), black, m, m])
    box.position.y = 0.95
    const roof = new THREE.Mesh(rbox(1.7, 0.18, L + 0.1, 0.08), mat('#e5e7eb'))
    roof.position.y = 1.58
    body.add(box, roof)
  } else {
    const cab = new THREE.Mesh(rbox(1.6, 1.4, 1.2, 0.08), mat(color))
    cab.position.set(0, 1.1, -L / 2 + 0.65)
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, L - 1.2, 14).rotateX(Math.PI / 2), mat(color, { metalness: 0.3 }))
    boiler.position.set(0, 1.0, 0.55)
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.7, 10), black)
    chimney.position.set(0, 1.8, L / 2 - 0.5)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#fde68a', toneMapped: false }))
    lamp.position.set(0, 1.0, L / 2)
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, L), black)
    base.position.y = 0.45
    body.add(cab, boiler, chimney, lamp, base)
  }
  const wg = wheelGeo()
  const wm = mat('#111827', { metalness: 0.4, roughness: 0.4 })
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wg, wm)
      w.rotation.y = Math.PI / 2
      w.position.set(sx * 0.72, 0.32, sz * (L / 2 - 0.55))
      body.add(w)
    }
  body.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  if (alongX) body.rotation.y = Math.PI / 2
  return g
}

function stonePortal(r = 1.4) {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.32, 8, 20, Math.PI), mat('#a8a29e', { flatShading: true }))
  const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 20, 0, Math.PI), mat('#0b0705'))
  hole.position.z = -0.05
  g.add(ring, hole)
  return g
}

export default defineLevel<TSState>({
  id: 'train-set',
  name: 'Train Set Express',
  type: 'race',
  blurb: 'Race across a model railway: level crossings, an express to ride and a tunnel with a random exit.',
  howTo: [
    'Barriers drop before each train: wait, or risk the hop',
    'Hop on the express flat wagons for a fast ride, hop off at the halt',
    'The mountain tunnel spits you out at a random exit',
    'Every lap of the station clock, the trains speed up',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 150,
  camera: { kind: 'chase', dist: 7.5 },
  introOrbit: { radius: 34, height: 20, center: [-3, 0, 0] },
  sprinkles: { start: 1 },
  fallY: -5,
  sky: { color: '#241811', fogNear: 70, fogFar: 190 },

  tricks: [
    {
      id: 'gate',
      name: 'Early Crossing',
      icon: 'slam',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'Drop the barriers at the next crossing in front of a rival for 3 seconds.',
      counter: 'Hop the barrier, if you dare the tracks.',
      can: (_c, _s, _u, t) => (t && CROSS.some((c) => c.z > t.pos.z && c.z - t.pos.z < 14) ? true : 'No crossing ahead of them'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const c = CROSS.findIndex((x) => x.z > target.pos.z)
        if (c < 0) return
        s.early[c] = ctx.time + 3
        ctx.fx.sfx('ding', { x: -3, y: 1, z: CROSS[c].z })
        ctx.fx.popup(target, 'Barrier!', '#fca5a5')
      },
    },
    {
      id: 'points',
      name: 'Points Switch',
      icon: 'swap',
      cost: 2,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: "Switch the points: a rival's next trip through the tunnel spits them out backwards.",
      counter: 'Skip the tunnel: ride the express or run the track bed.',
      can: (_c, _s, _u, t) => (t && t.pos.z < MOUNTAIN.z0 ? true : 'They are past the mountain'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.points[target.idx] = ctx.time + 25
        ctx.fx.popup(target, 'Points switched!', '#fca5a5')
        ctx.fx.sfx('tick', target.pos)
      },
    },
    {
      id: 'ticket',
      name: 'Ticket Inspector',
      icon: 'zap',
      cost: 1,
      cooldown: 6,
      busy: 0.5,
      target: 'rival',
      desc: 'Ticket please! Bumps a rival off the express (or off the track bed).',
      counter: 'Ride near the middle of the wagon, or keep a Bubble Wrap.',
      can: (_c, _s, _u, t) => (t && t.pos.x > RUN_R + 0.6 ? true : 'They are not on the railway'),
      apply: (ctx, _s, _user, target) => {
        if (!target) return
        ctx.knock(target, { x: -5.5, y: 4.5, z: -1 }, 0.8)
        ctx.fx.popup(target, 'Ticket please!', '#fde68a')
        ctx.fx.sfx('buzz', target.pos)
      },
      botUse: (ctx, _s, user) => ctx.toys.find((t) => t !== user && t.status === 'play' && t.pos.x > RUN_R + 0.6) ?? false,
    },
    bubbleWrap<TSState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 34, hd: 70, ridge: 34, knee: 8, y: -12, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    // The table: felt top, wooden frame and legs.
    const top = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.6, Z1 - Z0), [mat('#7c4a2b'), mat('#7c4a2b'), new THREE.MeshStandardMaterial({ map: feltTex(), roughness: 1 }), mat('#7c4a2b'), mat('#7c4a2b'), mat('#7c4a2b')])
    top.position.set((X0 + X1) / 2, -0.3, (Z0 + Z1) / 2)
    top.receiveShadow = true
    ctx.root.add(top)
    ctx.phys.box({ x: (X0 + X1) / 2, y: -0.3, z: (Z0 + Z1) / 2 }, { x: (X1 - X0) / 2, y: 0.3, z: (Z1 - Z0) / 2 }, { friction: 0.8 })
    for (const lx of [X0 + 1, X1 - 1])
      for (const lz of [Z0 + 2, 0, Z1 - 2]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 11.4, 8), mat('#6b3f22'))
        leg.position.set(lx, -6.3, lz)
        ctx.root.add(leg)
      }
    // A sandy road for the runners.
    const road = new THREE.Mesh(new THREE.PlaneGeometry(13, Z1 - Z0 - 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: roadTex(), roughness: 1 }))
    road.position.set(-3, 0.01, (Z0 + Z1) / 2)
    road.receiveShadow = true
    ctx.root.add(road)
    // Tracks: sleepers (instanced) and rails.
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.12, 0.35), mat('#6b4a2f'), 260)
    const railMat = mat('#9ca3af', { metalness: 0.7, roughness: 0.35 })
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3()
    let n = 0
    const yRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    for (const c of CROSS) {
      for (let x = X0 + 0.4; x < RUN_R + 0.6 && n < 260; x += 0.8) sleepers.setMatrixAt(n++, m4.compose(p.set(x, 0.06, c.z), yRot, one))
      for (const s of [-0.55, 0.55]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(RUN_R + 0.6 - X0, 0.12, 0.1), railMat)
        r.position.set((X0 + RUN_R + 0.6) / 2, 0.17, c.z + s)
        ctx.root.add(r)
      }
    }
    for (let z = Z0 + 0.4; z < EXP_END + 1 && n < 260; z += 0.8) sleepers.setMatrixAt(n++, m4.compose(p.set(EXP_X, 0.06, z), q.identity(), one))
    for (const s of [-0.55, 0.55]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, EXP_END + 1 - Z0), railMat)
      r.position.set(EXP_X + s, 0.17, (Z0 + EXP_END + 1) / 2)
      ctx.root.add(r)
    }
    sleepers.count = n
    sleepers.receiveShadow = true
    ctx.root.add(sleepers)
    // Hills with portals the crossing trains vanish into (right side) and the express portals.
    const hill = mat('#5b8a3c', { flatShading: true })
    for (const c of CROSS) {
      solid(ctx, { pos: [RUN_R + 0.55, 1.4, c.z], size: [1.3, 2.8, 2.6], material: hill, round: 0.5 })
      const pt = stonePortal(1.0)
      pt.position.set(RUN_R - 0.12, 0, c.z)
      pt.rotation.y = -Math.PI / 2
      ctx.root.add(pt)
    }
    solid(ctx, { pos: [EXP_X + 0.4, 2, EXP_END + 4], size: [X1 - RUN_R + 0.6, 4, 7], material: hill, round: 0.8 })
    const ep = stonePortal(1.5)
    ep.position.set(EXP_X, 0, EXP_END + 0.45)
    ctx.root.add(ep)
    solid(ctx, { pos: [EXP_X + 0.4, 2, Z0 + 1.5], size: [X1 - RUN_R + 0.6, 4, 3], material: hill, round: 0.8 })
    const sp = stonePortal(1.5)
    sp.position.set(EXP_X, 0, Z0 + 3.05)
    sp.rotation.y = Math.PI
    ctx.root.add(sp)
    // Fence: once past the halt you can't run the track bed round the last crossings.
    const fence = mat('#f8fafc')
    solid(ctx, { pos: [RUN_R + 0.7, 0.6, (HALT.z1 + EXP_END) / 2], size: [0.15, 1.2, EXP_END - HALT.z1], material: fence })
    // The station platform and the halt (deck height, so you can step onto a wagon).
    const plat = mat('#d6c3a1')
    for (const P of [STATION, HALT]) {
      solid(ctx, { pos: [(P.x0 + P.x1) / 2, 0.5, (P.z0 + P.z1) / 2], size: [P.x1 - P.x0, 1, P.z1 - P.z0], material: plat, round: 0.08 })
      solid(ctx, { pos: [P.x0 - 0.5, 0.25, (P.z0 + P.z1) / 2], size: [1, 0.5, P.z1 - P.z0], material: mat('#bfa98a'), round: 0.06 })
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, P.z1 - P.z0), mat('#facc15'))
      edge.position.set(P.x1 - 0.1, 1.01, (P.z0 + P.z1) / 2)
      ctx.root.add(edge)
    }
    const halt = textSprite('Express halt: hop off!', { bg: '#b91c1c', size: 0.6 })
    halt.position.set(5, 3.2, (HALT.z0 + HALT.z1) / 2)
    ctx.root.add(halt)
    const sta = textSprite('All aboard!', { bg: '#b91c1c', size: 0.6 })
    sta.position.set(5, 3.2, -44)
    ctx.root.add(sta)
    // The mountain and its tunnel.
    const mz = (MOUNTAIN.z0 + MOUNTAIN.z1) / 2
    solid(ctx, { pos: [(X0 + RUN_R + 1) / 2, 2.4, mz], size: [RUN_R + 1 - X0, 4.8, MOUNTAIN.z1 - MOUNTAIN.z0], material: hill, round: 1.6 })
    const peaks = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 3.6, 6), mat('#78716c', { flatShading: true }), 5)
    for (let i = 0; i < 5; i++) {
      const s = 0.7 + hash01(i, 3) * 0.6
      peaks.setMatrixAt(i, m4.compose(p.set(X0 + 2.5 + i * 4.4, 4.8 + s, mz + (hash01(i) - 0.5) * 4), q.identity(), new THREE.Vector3(s, s, s)))
    }
    ctx.root.add(peaks)
    const snow = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 1.3, 6), mat('#f8fafc', { flatShading: true }), 5)
    for (let i = 0; i < 5; i++) {
      const s = 0.7 + hash01(i, 3) * 0.6
      snow.setMatrixAt(i, m4.compose(p.set(X0 + 2.5 + i * 4.4, 4.8 + s * 2.3, mz + (hash01(i) - 0.5) * 4), q.identity(), new THREE.Vector3(s, s, s)))
    }
    ctx.root.add(snow)
    const mouth = stonePortal(1.4)
    mouth.position.set(MOUTH.x, 0, MOUNTAIN.z0 - 0.05)
    mouth.rotation.y = Math.PI
    ctx.root.add(mouth)
    const ms = textSprite('Tunnel: random exit!', { bg: '#57534e', size: 0.55 })
    ms.position.set(MOUTH.x, 3.1, MOUNTAIN.z0 - 0.6)
    ctx.root.add(ms)
    for (const e of EXITS) {
      const pt = stonePortal(1.2)
      pt.position.set(e.x - Math.sin(e.yaw) * 1.1, 0, e.z - Math.cos(e.yaw) * 1.1)
      pt.rotation.y = e.yaw
      ctx.root.add(pt)
      if (e === EXITS[1]) solid(ctx, { pos: [e.x - 1.9, 1.3, e.z], size: [1.6, 2.6, 3.2], material: hill, round: 0.5 })
    }
    // Finish and the terminus.
    finishArch(ctx, { x: -3, y: 0, z: 43.5, width: 14, color: ACCENT, text: 'TERMINUS' })
    solid(ctx, { pos: [-3, 0.3, 48.5], size: [14, 0.6, 4.5], material: plat, round: 0.08 })
    const roof = new THREE.Mesh(rbox(15, 0.4, 5.5, 0.15), mat('#991b1b'))
    roof.position.set(-3, 4.6, 49)
    ctx.root.add(roof)
    for (const sx of [-10, 4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 4, 8), mat('#e5e7eb'))
      post.position.set(sx, 2.6, 50.6)
      ctx.root.add(post)
    }
    ctx.phys.box({ x: -3, y: 2, z: 51.4 }, { x: 8, y: 2, z: 0.4 })
    // Scenery on the far side of the table: pines, sheep and a clock tower.
    for (let i = 0; i < 6; i++) {
      const z = -46 + i * 15 + hash01(i, 7) * 4
      if (Math.abs(z - mz) < 8 || CROSS.some((c) => Math.abs(c.z - z) < 3)) continue
      decor(ctx, 'world/models/pine.glb', 3.2 + hash01(i) * 1.5, [X0 + 1.6, 0, z])
      ctx.phys.cylinder({ x: X0 + 1.6, y: 1.5, z }, 1.5, 0.6)
    }
    for (const [x, z] of [[-13.5, -40], [-14, 14.5], [-13, 37]] as const) {
      decor(ctx, 'world/models/sheep.glb', 1.1, [x, 0, z], { rotY: hash01(x, z) * 6 })
      ctx.phys.cylinder({ x, y: 0.5, z }, 0.5, 0.6)
    }
    decor(ctx, 'world/models/clock-tower.glb', 7, [X0 + 2.5, 0, -51], { shadows: true })
    ctx.phys.box({ x: X0 + 2.5, y: 3, z: -51 }, { x: 1.6, y: 3, z: 1.6 })
    for (const c of course.cps) {
      const s = textSprite('Checkpoint', { bg: '#b91c1c', size: 0.55 })
      s.position.set(c.x + 6.2, 2.4, c.z)
      ctx.root.add(s)
    }
  },

  init(ctx) {
    const st: TSState = { race: raceInit(ctx), early: CROSS.map(() => -9), points: ctx.toys.map(() => 0), express: [], vis: { lights: [], hand: null, bell: CROSS.map(() => 0) } }
    raceSpeedHazard(ctx, st.race, 5.6)
    const colors = ['#2563eb', '#16a34a', '#eab308', '#9333ea']
    // Crossing trains: loco and two coaches, moving along x.
    CROSS.forEach((c, ci) => {
      for (let i = 0; i < 3; i++) {
        const kind = i === 0 ? 'loco' : 'coach'
        const obj = carMesh(kind, i === 0 ? '#b91c1c' : colors[(ci + i) % colors.length], true)
        if (c.dir < 0) obj.children[0].rotation.y = -Math.PI / 2
        mover(ctx, {
          half: [CAR_L / 2 - 0.1, 0.8, 0.8],
          obj,
          shove: 6,
          stun: 1.1,
          pose: (t, out) => {
            const u = crossU(ci, t) - (i * CAR_L + CAR_L / 2)
            if (u < -0.2 || u > CROSS_LEN + 0.2) return false
            const x = c.dir > 0 ? X0 + u : RUN_R + 0.5 - u
            poseOf(out, x, 0.85, c.z)
            return true
          },
        })
      }
      // Barrier arms on the approach side: two halves meeting in the middle.
      for (const side of [-1, 1]) {
        const g = new THREE.Group()
        const arm = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.24, 0.2), new THREE.MeshStandardMaterial({ map: stripeTex('#dc2626', '#f8fafc', 6, true), roughness: 0.6 }))
        g.add(arm)
        const pivot = side < 0 ? -10.4 : 4.3
        mover(ctx, {
          half: [3.6, 0.13, 0.12],
          obj: g,
          pose: (t, out) => {
            const k = gateK(st, ci, t)
            const a = (1 - k) * 1.45 * -side
            // Rotate about the pivot end.
            const cx = pivot - side * 3.6 * Math.cos(a), cy = 0.85 - side * 3.6 * Math.sin(a)
            poseOf(out, cx, cy, c.z - 1.9, 0, 0, a)
            return true
          },
        })
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.6, 8), mat('#e5e7eb'))
        post.position.set(pivot + side * 0.25, 0.8, c.z - 1.9)
        ctx.root.add(post)
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: '#7f1d1d', toneMapped: false }))
        light.position.set(pivot + side * 0.25, 1.75, c.z - 1.9)
        ctx.root.add(light)
        st.vis.lights.push(light)
      }
    })
    // Two express trains on one loop: a loco pulling five flat wagons, along z.
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < EXP_CARS; i++) {
        const loco = i === 0
        const obj = carMesh(loco ? 'loco' : 'flat', loco ? '#1d4ed8' : ['#f59e0b', '#ef4444', '#22c55e', '#a855f7', '#06b6d4'][(i + j) % 5], false)
        const mv = mover(ctx, {
          half: loco ? [0.8, 0.9, CAR_L / 2 - 0.1] : [1.2, 0.45, CAR_L / 2 - 0.1],
          obj,
          shove: loco ? 7 : 3.5,
          stun: 1,
          pose: (t, out) => {
            const z = expCarZ(j, i, t)
            if (!visibleExp(z)) return false
            poseOf(out, EXP_X, loco ? 0.95 : 0.55, z)
            return true
          },
        })
        if (!loco) st.express.push(mv)
      }
    }
    // The station clock: a big face whose hand goes round once per speed-up.
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g) => {
      g.fillStyle = '#fef9c3'
      g.beginPath()
      g.arc(64, 64, 62, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#1f2937'
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        g.fillRect(64 + Math.sin(a) * 50 - 3, 64 - Math.cos(a) * 50 - 3, 6, 6)
      }
    }), roughness: 0.6 }))
    face.position.set(3.2, 4.2, -36)
    face.rotation.y = -Math.PI / 2
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.14, 8, 32), mat('#b91c1c'))
    rim.position.copy(face.position)
    rim.rotation.y = -Math.PI / 2
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.06), mat('#111827'))
    hand.geometry.translate(0, 0.5, 0)
    hand.position.set(3.15, 4.2, -36)
    hand.rotation.y = -Math.PI / 2
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.8, 8), mat('#374151'))
    pole.position.set(3.3, 1.4, -36)
    ctx.root.add(face, rim, hand, pole)
    ctx.phys.cylinder({ x: 3.3, y: 1.4, z: -36 }, 1.4, 0.2)
    st.vis.hand = hand
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return raceSpawn(ctx, { x: -3, y: 0, z: -48.5, yaw: 0 }, i, n)
  },

  tick(ctx, st) {
    raceTick(ctx, st.race, course)
    // The tunnel: in at the mouth, out at a random exit (or backwards, if someone switched the points).
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      if (Math.abs(toy.pos.x - MOUTH.x) < 1.3 && toy.pos.z > MOUTH.z - 1.1 && toy.pos.z < MOUTH.z + 0.2 && toy.feet < 1.2) {
        let e = ctx.rng.chance(0.5) ? 0 : ctx.rng.chance(0.5) ? 1 : 2
        if (st.points[toy.idx] > ctx.time) {
          e = 2
          st.points[toy.idx] = 0
        }
        const ex = EXITS[e]
        ctx.fx.sfx('whoosh', toy.pos)
        ctx.fx.puff(toy.pos, 'dust', 10)
        toy.teleport(ex.x, FOOT + 0.05, ex.z, ex.yaw)
        toy.body.setLinvel({ x: Math.sin(ex.yaw) * 5, y: 2.5, z: Math.cos(ex.yaw) * 5 }, true)
        ctx.fx.puff(toy.pos, 'dust', 14)
        ctx.fx.popup(toy, ex.name, e === 2 ? '#fca5a5' : '#bbf7d0')
        ctx.fx.sfx(e === 2 ? 'buzz' : 'ding', toy.pos, toy)
        const d = toy.data as BotMem
        if (d.route === 0) d.wp = e === 0 ? idxOf(P0, 12.5) : e === 1 ? idxOf(P0, 26.8) : idxOf(P0, -7)
        d.stuck = 0
        d.bestD = Infinity
      }
    }
    // Crossing bells.
    CROSS.forEach((c, i) => {
      const shut = gateShut(st, i, ctx.time)
      if (shut && ctx.time > st.vis.bell[i]) {
        st.vis.bell[i] = ctx.time + 1.2
        ctx.fx.sfx('tick', { x: -3, y: 1, z: c.z })
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
    if (d.route === undefined) d.route = hash01(toy.idx, ctx.seed, 5) < 0.3 ? 1 : 0
    const path = PATHS[d.route]
    // Riding the express: stand still until the halt, then hop off to the left.
    const riding = st.express.some((m) => m.carrying(toy))
    if (riding) {
      if (toy.pos.z < HALT.z0 + 1.5) {
        toy.pad.mx = (EXP_X - toy.pos.x) * 0.6
        toy.pad.mz = 0
      } else {
        toy.pad.mx = -1
        toy.pad.mz = 0.3
        const hi = path.findIndex((w) => Math.abs(w.z - 24) < 0.01)
        if (hi >= 0) d.wp = hi
      }
      return
    }
    // Boarding: aim for the wagon passing the platform.
    const w = path[d.wp ?? 0]
    if (w && w.ride && d.route === 1) {
      let best: Mover | null = null
      for (const m of st.express) if (m.on && Math.abs(m.obj.position.z - toy.pos.z - 1) < 2.2) best = m
      if (best) {
        toy.pad.mx = 1
        toy.pad.mz = (best.obj.position.z + 1 - toy.pos.z) * 0.5
        if (Math.abs(toy.pos.x - EXP_X) < 0.6) d.wp = (d.wp ?? 0) + 1
        return
      }
      // Missed it: back to the platform edge to wait for the next one.
      d.wp = Math.max(0, (d.wp ?? 1) - 1)
    }
    follow(ctx, toy, path, {
      pace: sk.pace,
      dt,
      wait: (id) => {
        if (id < CROSS.length) return gateShut(st, id, t) || crossBusy(id, t, 1.2 + sk.reaction)
        if (id === 9) return !st.express.some((m) => m.on && m.obj.position.z < toy.pos.z + 1.5 && m.obj.position.z > toy.pos.z - 1.2)
        return false
      },
    })
  },

  pack(_c, st) {
    return [racePack(st.race), st.early.map((x) => Math.round(x * 10) / 10), st.points.map((x) => Math.round(x))]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number[], number[]]
    raceUnpack(st.race, a[0])
    st.early = a[1]
    st.points = a[2]
  },

  visual(ctx, st) {
    const t = ctx.time
    st.vis.lights.forEach((l, i) => {
      const c = Math.floor(i / 2)
      const on = gateShut(st, c, t) && Math.floor(t * 3 + (i % 2) * 0.5) % 2 === 0
      ;(l.material as THREE.MeshBasicMaterial).color.set(on ? '#ef4444' : '#450a0a')
    })
    if (st.vis.hand) st.vis.hand.rotation.x = -((Math.max(0, t) % LAP) / LAP) * Math.PI * 2
  },

  hud(ctx, st, me) {
    const t = ctx.time
    const chips = [`Trains ×${mult(t).toFixed(2).replace(/0$/, '')}`]
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (ctx.phase === 'play' && LAP - (Math.max(0, t) % LAP) < 2.5 && t < LAP * 5) status = { text: 'TRAINS SPEED UP!', color: '#fca5a5', pulse: true }
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const z = me.pos.z
      const near = CROSS.findIndex((c) => c.z > z && c.z - z < 5)
      if (st.express.some((m) => m.carrying(me))) prompt = 'Riding the express! Hop off left at the halt before the tunnel.'
      else if (near >= 0 && gateShut(st, near, t)) prompt = 'Barrier down: a train is coming!'
      else if (z < MOUNTAIN.z0 && z > -24) prompt = 'Into the tunnel for a random exit, or along the railway (mind the express).'
      else if (z < -36 && me.pos.x > 1) prompt = 'Wait on the platform and step onto a flat wagon.'
      if (st.points[me.idx] > t && z < MOUNTAIN.z0) prompt = 'Someone switched the points: the tunnel will send you backwards!'
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status, chips })
  },

  dispose(ctx) {
    detachDecor(ctx)
  },
})
