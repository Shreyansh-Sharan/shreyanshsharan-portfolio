// Cookie Cutter (logic). Everyone sits round one big biscuit-tin lid with a biscuit in front of them, embossed
// with a shape: a circle (easy), a star or an umbrella (hard). Trace the outline with the pointer or stick;
// moving too fast or leaving the line fills your crack meter. Finish to go through; crack it and you are out
// (Quick Play: a new biscuit and a time penalty). Clean stretches earn Sprinkles to spend on dirty tricks, and
// every trick lifts your own needle for a moment. In the last 20 seconds the lid rattles for everyone.
import * as THREE from 'three'
import { discMaterial } from '../engine/assets'
import { skill } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { makeRng, wobble } from '../engine/rng'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy, type TrickDef } from '../engine/types'

const LID_Y = 0.35
const TOP_Y = LID_Y + 0.08
const BISCUIT_R = 0.95
/** On-line tolerance and the distance at which the needle counts as off the biscuit (metres). */
const TOL = 0.065
const OFF = 0.24
const RATTLE_LAST = 20

type V2 = [number, number]

interface Shape {
  name: string
  pts: V2[]
  cum: number[]
  len: number
  /** Safe tracing speed (m/s): faster than this cracks the biscuit. */
  safe: number
  /** Clean metres per Sprinkle. */
  every: number
}

function resample(path: V2[], n: number): { pts: V2[]; cum: number[]; len: number } {
  const seg: number[] = [0]
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  const total = seg[seg.length - 1]
  const pts: V2[] = []
  const cum: number[] = []
  let j = 1
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total
    while (j < seg.length - 1 && seg[j] < d) j++
    const a = path[j - 1], b = path[j]
    const t = (d - seg[j - 1]) / Math.max(1e-6, seg[j] - seg[j - 1])
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    cum.push(d)
  }
  return { pts, cum, len: total }
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): V2[] {
  const out: V2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n)
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

function makeShapes(): Shape[] {
  const circle = arc(0, 0, 0.56, Math.PI / 2, Math.PI / 2 - Math.PI * 2, 96)
  const star: V2[] = []
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 - (i / 10) * Math.PI * 2
    const r = i % 2 ? 0.27 : 0.64
    star.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  // Umbrella: hook tip → round the hook → up the shaft → scallops left → canopy over the top → scallops back.
  const umb: V2[] = []
  umb.push(...arc(-0.12, -0.44, 0.12, Math.PI, Math.PI * 2, 12))
  umb.push([0, -0.44], [0, 0.04])
  const scallop = (x0: number, x1: number) => {
    const cx = (x0 + x1) / 2, r = Math.abs(x1 - x0) / 2
    return arc(cx, 0.04, r, x0 < x1 ? Math.PI : 0, x0 < x1 ? 0 : Math.PI, 10).map(([x, y]) => [x, 0.04 + (y - 0.04) * 0.55] as V2)
  }
  umb.push(...scallop(0, -0.28), ...scallop(-0.28, -0.56))
  umb.push(...arc(0, 0.04, 0.56, Math.PI, 0, 40))
  umb.push(...scallop(0.56, 0.28), ...scallop(0.28, 0))
  const mk = (name: string, path: V2[], secs: number, perSprinkle: number): Shape => {
    const r = resample(path, 220)
    return { name, ...r, safe: r.len / secs, every: r.len * perSprinkle }
  }
  return [mk('Circle', circle, 22, 0.2), mk('Star', star, 27, 0.15), mk('Umbrella', umb, 33, 0.11)]
}

const SHAPES = makeShapes()

interface Plate {
  shape: number
  /** Progress along the outline (metres) and crack meter (0..1). */
  s: number
  crack: number
  soft: number
  wob: number
  wobA: number
  paw: number
  pawA: number
  pawB: number
  crumbs: number[]
  /** Needle in plate space (u right, v towards the lid centre) and whether it is pressed. */
  nu: number
  nv: number
  down: number
  // Host only.
  v: number
  clean: number
  brush: number
  pu: number
  pv: number
  sdx: number
  sdy: number
  fresh: number
}

interface Seat {
  cx: number
  cz: number
  yaw: number
}

interface SeatVis {
  group: THREE.Group
  groove: THREE.Mesh
  prog: THREE.Mesh
  start: THREE.Mesh
  cracks: THREE.Mesh[]
  crumbs: THREE.Mesh[]
  paw: THREE.Group
  milk: THREE.Mesh
  needle: THREE.Group
  shown: number
  fake: number
}

interface CCState {
  plates: Plate[]
  seats: Seat[]
  slam: { by: number; at: number } | null
  rattle: number
  lidR: number
  vis: SeatVis[]
  lid: THREE.Group | null
  /** The shape table (read-only; handy for tools and tests). */
  shapes: readonly Shape[]
}

function freshPlate(shape: number): Plate {
  return { shape, s: 0, crack: 0, soft: 0, wob: 0, wobA: 0, paw: 0, pawA: 0, pawB: 0, crumbs: [], nu: 0, nv: -0.3, down: 0, v: 0, clean: 0, brush: 0, pu: 0, pv: 0, sdx: 0, sdy: 0, fresh: 0 }
}

/** Plate-space (u, v) → world, and back. */
function toWorld(seat: Seat, u: number, v: number, out: THREE.Vector3, y = TOP_Y) {
  const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw)
  const rx = -Math.cos(seat.yaw), rz = Math.sin(seat.yaw)
  return out.set(seat.cx + rx * u + fx * v, y, seat.cz + rz * u + fz * v)
}
function toPlate(seat: Seat, x: number, z: number): V2 {
  const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw)
  const rx = -Math.cos(seat.yaw), rz = Math.sin(seat.yaw)
  const dx = x - seat.cx, dz = z - seat.cz
  return [dx * rx + dz * rz, dx * fx + dz * fz]
}

/** Index of the outline point at arc length s. */
function idxAt(sh: Shape, s: number) {
  const n = sh.cum.length
  const k = Math.round((s / sh.len) * (n - 1))
  return Math.max(0, Math.min(n - 1, k))
}

/**
 * Nearest point on the outline to (u, v) within the arc window [s0, s1], projected onto the segments so the
 * arc length is continuous (no stair-steps between outline points). Returns arc length `s` and distance `d`.
 */
function nearestOnPath(sh: Shape, u: number, v: number, s0: number, s1: number) {
  let bs = 0, bd = Infinity
  const i0 = idxAt(sh, Math.max(0, s0)), i1 = Math.min(sh.pts.length - 1, idxAt(sh, Math.min(sh.len, s1)) + 1)
  for (let i = Math.max(1, i0); i <= i1; i++) {
    const [ax, ay] = sh.pts[i - 1], [bx, by] = sh.pts[i]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy || 1e-9
    const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / l2))
    const px = ax + dx * t, py = ay + dy * t
    const d = (px - u) ** 2 + (py - v) ** 2
    if (d < bd) {
      bd = d
      bs = sh.cum[i - 1] + (sh.cum[i] - sh.cum[i - 1]) * t
    }
  }
  return { s: bs, d: Math.sqrt(bd) }
}

/** A flat ribbon along plate-space points (local x = -u, z = v), drawn progressively with drawRange. */
function ribbon(pts: V2[], width: number, y: number, mat: THREE.Material) {
  const n = pts.length
  const pos = new Float32Array(n * 2 * 3)
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    let tx = b[0] - a[0], ty = b[1] - a[1]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const nx = -ty * (width / 2), ny = tx * (width / 2)
    const [u, v] = pts[i]
    pos.set([-(u + nx), y, v + ny, -(u - nx), y, v - ny], i * 6)
  }
  const idx: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, mat)
  m.renderOrder = 3
  return m
}

function crackPaths(seed: number): V2[][] {
  const rng = makeRng(seed)
  const out: V2[][] = []
  for (let c = 0; c < 4; c++) {
    const a = rng.range(0, Math.PI * 2)
    let u = Math.cos(a) * 0.92, v = Math.sin(a) * 0.92
    const pts: V2[] = [[u, v]]
    let dir = a + Math.PI + rng.range(-0.5, 0.5)
    for (let i = 0; i < 9; i++) {
      dir += rng.range(-0.7, 0.7)
      u += Math.cos(dir) * 0.11
      v += Math.sin(dir) * 0.11
      pts.push([u, v])
    }
    out.push(pts)
  }
  return out
}

const _tmp = new THREE.Vector3()
const _look = new THREE.Vector3()
const grooveMat = new THREE.MeshBasicMaterial({ color: '#6b3a17', transparent: true, opacity: 0.85, depthWrite: false })
const progMat = new THREE.MeshBasicMaterial({ color: '#fff7d6', toneMapped: false, depthWrite: false })
const crackMat = new THREE.MeshBasicMaterial({ color: '#2b160a', depthWrite: false })

function pawMesh(color: string) {
  const g = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
  const pad = new THREE.MeshStandardMaterial({ color: '#f9a8d4', roughness: 1, flatShading: true })
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), fur)
  palm.scale.set(1, 0.45, 1.15)
  g.add(palm)
  for (let i = 0; i < 4; i++) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), fur)
    toe.position.set(-0.3 + i * 0.2, 0.05, 0.42 + (i === 1 || i === 2 ? 0.08 : 0))
    g.add(toe)
  }
  const bean = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), pad)
  bean.position.set(0, 0.17, 0)
  bean.scale.set(1.3, 0.3, 1)
  g.add(bean)
  return g
}

function needleMesh(color: string) {
  const g = new THREE.Group()
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.004, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#d1d5db', metalness: 0.9, roughness: 0.25 }))
  pin.position.y = 0.25
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }))
  head.position.y = 0.52
  g.add(pin, head)
  return g
}

function seatOf(st: CCState, toy: Toy) {
  return st.seats[toy.idx]
}

/** The rival furthest ahead (for Plate Swap). */
function leaderOf(ctx: LevelCtx, st: CCState, except: Toy) {
  let best: Toy | null = null
  let bp = -1
  for (const t of ctx.toys) {
    if (t === except || t.status !== 'play') continue
    const p = st.plates[t.idx]
    const prog = p.s / SHAPES[p.shape].len
    if (prog > bp) {
      bp = prog
      best = t
    }
  }
  return best
}

const progress = (p: Plate) => p.s / SHAPES[p.shape].len

type Trick = TrickDef<CCState>

const tricks: Trick[] = [
  {
    id: 'crumb',
    name: 'Crumb Flick',
    icon: 'crumb',
    cost: 1,
    cooldown: 3,
    busy: 0.5,
    target: 'rival',
    desc: 'Flick a crumb onto their line. Trace into it and their biscuit takes a big crack.',
    counter: 'Brush it off: press R twice, or swipe over it twice with the needle up.',
    can: (_c, s, _u, t) => (t && s.plates[t.idx].crumbs.length >= 3 ? 'Their plate is full of crumbs' : true),
    apply: (ctx, s, _user, target) => {
      if (!target) return
      const p = s.plates[target.idx]
      const sh = SHAPES[p.shape]
      p.crumbs.push(Math.min(sh.len - 0.05, p.s + ctx.rng.range(0.07, 0.14) * sh.len))
      ctx.fx.sfx('tick', target.pos)
      ctx.fx.popup(target, 'Crumb!', '#c98a3e')
    },
  },
  {
    id: 'slam',
    name: 'Table Slam',
    icon: 'slam',
    cost: 1,
    cooldown: 8,
    busy: 1,
    target: 'none',
    desc: "Everyone's needle wobbles for 2 seconds (yours too, but less). There is a wind-up first.",
    counter: 'Lift your needle when someone winds up.',
    can: (_c, s) => (s.slam ? 'Someone is already winding up' : true),
    apply: (ctx, s, user) => {
      s.slam = { by: user.idx, at: ctx.time + 0.85 }
      ctx.fx.say(`${user.name} winds up a TABLE SLAM! Lift your needle!`, '#fb923c', 1.2)
      ctx.fx.sfx('whoosh', user.pos)
    },
    botUse: (_c, s, user) => (progress(s.plates[user.idx]) < 0.8 ? null : false),
  },
  {
    id: 'milk',
    name: 'Milk Splash',
    icon: 'milk',
    cost: 2,
    cooldown: 8,
    busy: 1,
    target: 'rival',
    minSpice: 1,
    desc: 'Their biscuit goes soft for 5 seconds: it cracks twice as easily, but cuts faster.',
    counter: 'Slow right down, or gamble and rush it.',
    apply: (ctx, s, _user, target) => {
      if (!target) return
      s.plates[target.idx].soft = 5
      ctx.fx.sfx('splash', target.pos)
      ctx.emit({ milk: target.idx })
    },
  },
  {
    id: 'paw',
    name: 'Paw Over',
    icon: 'paw',
    cost: 2,
    cooldown: 8,
    busy: 1,
    target: 'rival',
    desc: 'A big plush paw covers part of their shape for 3 seconds.',
    counter: 'Trace from memory, or wait it out.',
    apply: (ctx, s, _user, target) => {
      if (!target) return
      const p = s.plates[target.idx]
      const sh = SHAPES[p.shape]
      p.paw = 3
      p.pawA = p.s + sh.len * 0.02
      p.pawB = Math.min(sh.len, p.s + sh.len * 0.3)
      ctx.fx.sfx('thud', target.pos)
    },
  },
  {
    id: 'fake',
    name: 'Fake Crack',
    icon: 'crack',
    cost: 1,
    cooldown: 5,
    busy: 0.5,
    target: 'rival',
    desc: 'A loud crack and a shudder on their screen only. No real damage.',
    counter: 'Keep calm and keep tracing.',
    apply: (ctx, s, _user, target) => {
      if (!target) return
      ctx.emit({ fake: target.idx }, target)
      if (target.bot && ctx.rng.chance(0.55 - ctx.difficulty * 0.15)) target.busy = Math.max(target.busy, 0.8)
      void s
    },
  },
  {
    id: 'swap',
    name: 'Plate Swap',
    icon: 'swap',
    cost: 4,
    cooldown: 2,
    busy: 2,
    target: 'none',
    once: true,
    minSpice: 1,
    desc: 'Swap biscuits with the leader, progress and cracks included. Only when you are behind, once a round.',
    counter: 'Finish before they save up four Sprinkles.',
    can: (ctx, s, user) => {
      const lead = leaderOf(ctx, s, user)
      if (!lead) return 'Nobody to swap with'
      return progress(s.plates[lead.idx]) > progress(s.plates[user.idx]) + 0.05 ? true : 'Only when you are behind'
    },
    apply: (ctx, s, user) => {
      const lead = leaderOf(ctx, s, user)
      if (!lead) return
      const a = s.plates[user.idx], b = s.plates[lead.idx]
      s.plates[user.idx] = b
      s.plates[lead.idx] = a
      a.fresh = b.fresh = 0
      lead.grudge = user
      user.c.stats.menace++
      lead.c.stats.betrayed++
      ctx.fx.say(`${user.name} swapped plates with ${lead.name}!`, '#c084fc', 2)
      ctx.fx.sfx('whoosh')
      ctx.emit({ swap: [user.idx, lead.idx] })
    },
    botUse: (ctx, s, user) => {
      const lead = leaderOf(ctx, s, user)
      if (!lead) return false
      return progress(s.plates[lead.idx]) - progress(s.plates[user.idx]) > 0.3 ? null : false
    },
  },
  bubbleWrap<CCState>(2),
]

export default defineLevel<CCState>({
  id: 'cookie-cutter',
  name: 'Cookie Cutter',
  type: 'logic',
  blurb: 'Trace the shape out of your biscuit without cracking it, while flicking crumbs at your friends.',
  howTo: [
    'Hold the mouse (or Space) to press the needle and trace the line from the green dot',
    'Too fast or off the line fills your crack meter; crack it and you are out',
    'Clean tracing earns Sprinkles: click a rival plate, then spend them on tricks (1 to 7)',
    'Every trick lifts your own needle for a moment. The lid rattles in the last 20 s',
  ],
  accent: '#f59e0b',
  players: [2, 16],
  duration: 90,
  bodyMode: 'seated',
  pointer: 'free',
  pointerPlaneY: TOP_Y,
  introOrbit: { radius: 7, height: 9 },
  sprinkles: { start: 1 },
  keepFailed: true,
  throwables: ['crumb', 'paper', 'feather'],
  sky: { color: '#2e1d12', fogNear: 30, fogFar: 90 },
  tricks,

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 18, hd: 18, ridge: 18, knee: 4, lights: ctx.quality === 'low' ? 30 : 70, quality: ctx.quality })
  },

  init(ctx) {
    const n = Math.max(1, ctx.toys.length)
    const rPlate = Math.max(3, (n * 2.25) / (Math.PI * 2))
    const rToy = rPlate + 1.45
    const lidR = rToy + 0.9
    const st: CCState = { plates: [], seats: [], slam: null, rattle: 0, lidR, vis: [], lid: null, shapes: SHAPES }
    // The tin lid.
    const lid = new THREE.Group()
    const top = new THREE.Mesh(new THREE.CircleGeometry(lidR, 72).rotateX(-Math.PI / 2), discMaterial(ctx.assets, 'tinlid', '#1d4ed8'))
    top.position.y = LID_Y
    top.receiveShadow = true
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(lidR, lidR, LID_Y, 72, 1, true), new THREE.MeshStandardMaterial({ color: '#1e3a8a', metalness: 0.6, roughness: 0.35 }))
    rim.position.y = LID_Y / 2
    const lip = new THREE.Mesh(new THREE.TorusGeometry(lidR, 0.06, 6, 72).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#d4a017', metalness: 0.8, roughness: 0.3 }))
    lip.position.y = LID_Y
    lid.add(top, rim, lip)
    ctx.root.add(lid)
    st.lid = lid
    ctx.phys.cylinder({ x: 0, y: LID_Y / 2, z: 0 }, LID_Y / 2, lidR)

    const biscuitMat = discMaterial(ctx.assets, 'biscuit', '#d99a4e')
    const plateMat = new THREE.MeshStandardMaterial({ color: '#fdfaf3', roughness: 0.35 })
    const milkMat = () => new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0, roughness: 0.1, depthWrite: false })
    const shapes = ctx.rng.shuffle([0, 1, 2, 0, 1, 2, 1, 2, 0, 2, 1, 0, 2, 1, 0, 1])
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      // Seat i: plate at rPlate, toy behind it at rToy, everyone facing the middle.
      const seat: Seat = { cx: Math.sin(a) * rPlate, cz: Math.cos(a) * rPlate, yaw: a + Math.PI }
      st.seats.push(seat)
      st.plates.push(freshPlate(shapes[i % shapes.length]))
      const g = new THREE.Group()
      g.position.set(seat.cx, 0, seat.cz)
      g.rotation.y = seat.yaw
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.1, 0.05, 40), plateMat)
      plate.position.y = LID_Y + 0.025
      plate.receiveShadow = true
      const biscuit = new THREE.Mesh(new THREE.CylinderGeometry(BISCUIT_R, BISCUIT_R, 0.05, 48), [new THREE.MeshStandardMaterial({ color: '#b8722e', roughness: 0.9 }), biscuitMat, biscuitMat])
      biscuit.position.y = LID_Y + 0.055
      biscuit.castShadow = true
      biscuit.receiveShadow = true
      const milk = new THREE.Mesh(new THREE.CircleGeometry(BISCUIT_R * 0.98, 32).rotateX(-Math.PI / 2), milkMat())
      milk.position.y = TOP_Y + 0.004
      const start = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#22c55e', toneMapped: false }))
      const crumbs: THREE.Mesh[] = []
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: '#a8692b', roughness: 1, flatShading: true }))
        c.visible = false
        g.add(c)
        crumbs.push(c)
      }
      const cracks = crackPaths(ctx.seed + i * 131).map((p) => ribbon(p, 0.022, TOP_Y + 0.006, crackMat))
      for (const c of cracks) c.geometry.setDrawRange(0, 0)
      const paw = pawMesh('#b07040')
      paw.visible = false
      const needle = needleMesh(ctx.toys[i]?.c.tint ?? '#ffffff')
      g.add(plate, biscuit, milk, start, paw, ...cracks)
      ctx.root.add(g)
      ctx.root.add(needle)
      const vis: SeatVis = { group: g, groove: null as unknown as THREE.Mesh, prog: null as unknown as THREE.Mesh, start, cracks, crumbs, paw, milk, needle, shown: -1, fake: 0 }
      st.vis.push(vis)
    }
    return st
  },

  spawn(_ctx, st, _toy, i) {
    const s = st.seats[i]
    const back = 1.45
    return { x: s.cx - Math.sin(s.yaw) * back, y: LID_Y, z: s.cz - Math.cos(s.yaw) * back, yaw: s.yaw }
  },

  setup(ctx) {
    for (const t of ctx.toys) {
      t.seat = { x: t.spawn.x, y: t.spawn.y + 0.5, z: t.spawn.z, yaw: t.spawn.yaw }
      t.teleport(t.seat.x, t.seat.y, t.seat.z, t.seat.yaw)
    }
  },

  pointerHome(_ctx, st, me) {
    const s = st.seats[me.idx]
    const p = new THREE.Vector3()
    const sh = SHAPES[st.plates[me.idx].shape]
    toWorld(s, sh.pts[0][0], sh.pts[0][1], p)
    return { x: p.x, z: p.z }
  },

  pick(ctx, st, point) {
    let best: Toy | null = null
    let bd = 1.4
    st.seats.forEach((s, i) => {
      const d = Math.hypot(point.x - s.cx, point.z - s.cz)
      const t = ctx.toys[i]
      if (t && d < bd && t !== ctx.me && t.status === 'play') {
        bd = d
        best = t
      }
    })
    return best
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    st.rattle = ctx.timeLeft < RATTLE_LAST ? 1 : 0
    // The slam lands.
    if (st.slam && t >= st.slam.at) {
      const by = ctx.toys[st.slam.by]
      st.slam = null
      ctx.fx.sfx('slam')
      ctx.fx.shake(0.45)
      for (const toy of ctx.toys) {
        if (toy.status !== 'play') continue
        const p = st.plates[toy.idx]
        const down = toy.bot ? ((toy.data as { lifted?: number }).lifted ?? 0) <= t : p.down === 1 && toy.busy <= 0
        if (!down && toy !== by) continue
        p.wob = toy === by ? 1 : 2
        p.wobA = toy === by ? 0.03 : 0.055
        if (by && toy !== by) ctx.blame(toy, by)
      }
    }
    for (const toy of ctx.toys) {
      const p = st.plates[toy.idx]
      p.soft = Math.max(0, p.soft - dt)
      p.wob = Math.max(0, p.wob - dt)
      p.paw = Math.max(0, p.paw - dt)
      if (toy.status !== 'play') continue
      const sh = SHAPES[p.shape]
      const seat = seatOf(st, toy)
      const softK = p.soft > 0 ? 2 : 1
      let cracked = 0
      let ds = 0
      if (toy.bot) {
        // Bots trace at a skill-based rate with the odd slip.
        const d = toy.data as { pace?: number; lifted?: number; brushAt?: number }
        const sk = skill(ctx)
        d.pace ??= sk.pace * ctx.rng.range(0.85, 1.05)
        const lifted = (d.lifted ?? 0) > t || toy.busy > 0 || !toy.pad.down
        p.down = lifted ? 0 : 1
        if (!lifted) {
          const pawed = p.paw > 0 && p.s >= p.pawA && p.s <= p.pawB
          const rate = sh.safe * d.pace * (p.soft > 0 ? 1.35 : 1) * (pawed ? 0.55 : 1) * (p.wob > 0 ? 0.6 : 1)
          ds = rate * dt
          let slip = sk.blunder * (p.wob > 0 ? 4 : 1) * (st.rattle ? 1.6 : 1) * (p.soft > 0 ? 1.5 : 1)
          if (pawed) slip *= 2
          if (ctx.rng.chance(slip * dt)) cracked += ctx.rng.range(0.08, 0.2) * softK
        }
        // Crumbs: brush them off after a beat (easy bots sometimes don't notice).
        const next = p.crumbs.find((c) => c > p.s && c - p.s < sh.len * 0.12)
        if (next !== undefined) {
          if (d.brushAt === undefined) d.brushAt = ctx.rng.chance(sk.accuracy) ? t + sk.reaction * ctx.rng.range(1, 2.2) : t + 99
          if (t >= d.brushAt) {
            p.crumbs = p.crumbs.filter((c) => c !== next)
            toy.busy = Math.max(toy.busy, 0.5)
            d.brushAt = undefined
            ctx.fx.puff(toy.pos, 'crumbs', 6)
          }
        } else d.brushAt = undefined
        const i = idxAt(sh, p.s)
        p.nu = sh.pts[i][0] + wobble(t, toy.idx) * 0.02
        p.nv = sh.pts[i][1] + wobble(t, toy.idx + 9) * 0.02
      } else {
        // People: the needle follows their pointer on the plate.
        // The hand (raw pointer) and the needle tip (shaken by slams, throws and the rattling lid).
        const [u0, v0] = toPlate(seat, toy.pad.px, toy.pad.pz)
        const amp = (p.wob > 0 ? p.wobA : 0) + (st.rattle ? 0.022 : 0)
        const u = u0 + wobble(t, toy.idx) * amp
        const v = v0 + wobble(t, toy.idx + 9) * amp
        const handMove = Math.hypot(u0 - p.pu, v0 - p.pv)
        // Brushing: R presses, or quick swipes over a crumb with the needle up.
        const pvx = (u0 - p.pu) / dt, pvy = (v0 - p.pv) / dt
        const sp = Math.hypot(pvx, pvy)
        if (toy.pad.act) p.brush++
        if (!toy.pad.down && sp > 1.1 && p.crumbs.length) {
          const near = p.crumbs.some((c) => {
            const k = idxAt(sh, c)
            return Math.hypot(sh.pts[k][0] - u, sh.pts[k][1] - v) < 0.3
          })
          if (near && pvx * p.sdx + pvy * p.sdy < 0) p.brush++
        }
        if (sp > 0.3) {
          p.sdx = pvx
          p.sdy = pvy
        }
        if (p.brush >= 2 && p.crumbs.length) {
          p.crumbs.sort((a, b) => Math.abs(a - p.s) - Math.abs(b - p.s))
          p.crumbs.shift()
          p.brush = 0
          ctx.fx.puff(toy.pos, 'crumbs', 6)
          ctx.fx.sfx('whoosh', toy.pos)
        }
        p.pu = u0
        p.pv = v0
        p.nu = u
        p.nv = v
        const down = toy.pad.down && toy.busy <= 0
        p.down = down ? 1 : 0
        if (down) {
          // The shaken tip decides on/off the line; only the hand's own movement counts as cutting speed.
          const hit = nearestOnPath(sh, u, v, p.s - sh.len * 0.03, p.s + sh.len * 0.08)
          if (hit.d <= OFF) {
            if (hit.d > TOL) cracked += (hit.d - TOL) * 3.2 * dt * softK
            else if (hit.s > p.s) ds = Math.min(hit.s - p.s, handMove + 0.002, sh.len * 0.05)
          }
        }
        // Too fast cracks it (smoothed speed so the 30 Hz online pad doesn't spike).
        p.v += (ds / dt - p.v) * Math.min(1, dt / 0.18)
        const safe = sh.safe * (p.soft > 0 ? 1.6 : 1)
        if (p.v > safe * 1.15) cracked += (p.v / safe - 1.15) * 0.55 * dt * softK
      }
      // Into a crumb: crunch.
      if (ds > 0) {
        const hitCrumb = p.crumbs.find((c) => c > p.s - 0.01 && c <= p.s + ds + 0.02)
        if (hitCrumb !== undefined) {
          p.crumbs = p.crumbs.filter((c) => c !== hitCrumb)
          cracked += 0.32 * softK
          ctx.fx.sfx('crunch', toy.pos)
          ctx.fx.popup(toy, 'CRUNCH', '#fca5a5')
        }
        p.s = Math.min(sh.len, p.s + ds)
      }
      // Clean stretches earn Sprinkles (harder shapes earn faster).
      if (cracked > 0) {
        p.crack = Math.min(1, p.crack + cracked)
        p.clean = 0
        if (cracked > 0.08) ctx.fx.sfx('crack', toy.pos, toy)
      } else if (ds > 0) {
        p.clean += ds
        if (p.clean >= sh.every) {
          p.clean -= sh.every
          ctx.addSprinkles(toy, 1)
        }
      } else if (!p.down) p.crack = Math.max(0, p.crack - 0.015 * dt)
      if (p.s >= sh.len - 0.03) {
        p.s = sh.len
        ctx.qualify(toy, sh.name)
        ctx.emit({ done: toy.idx })
      } else if (p.crack >= 1) {
        ctx.fx.sfx('crunch', toy.pos)
        ctx.emit({ broke: toy.idx })
        ctx.fail(toy, `cracked the ${sh.name.toLowerCase()}`)
      }
    }
  },

  retry(ctx, st, toy) {
    // Quick Play: a fresh biscuit with the same shape, and a time penalty.
    const p = st.plates[toy.idx]
    st.plates[toy.idx] = freshPlate(p.shape)
    toy.busy = 3
    ctx.fx.say('CRACKED! New biscuit (+3 s)', '#fca5a5', 2, toy)
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { lifted?: number; slamSeen?: number }
    toy.pad.down = true
    // Lift for an incoming slam if they spot it (one decision per slam).
    if (st.slam && st.slam.by !== toy.idx && d.slamSeen !== st.slam.at) {
      d.slamSeen = st.slam.at
      if (ctx.rng.chance(sk.accuracy * 0.8)) d.lifted = st.slam.at + 0.15
    }
    // Soft biscuit: careful bots pause a moment.
    if (st.plates[toy.idx].soft > 0 && ctx.rng.chance(0.6 * sk.accuracy * dt)) d.lifted = ctx.time + 0.6
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => progress(st.plates[b.idx]) - progress(st.plates[a.idx]) || st.plates[a.idx].crack - st.plates[b.idx].crack)
  },

  onThrow(ctx, st, kind, target) {
    const p = st.plates[target.idx]
    const sh = SHAPES[p.shape]
    if (kind === 'crumb') {
      if (p.crumbs.length < 3) p.crumbs.push(Math.min(sh.len - 0.05, p.s + ctx.rng.range(0.05, 0.1) * sh.len))
    } else {
      p.wob = Math.max(p.wob, kind === 'paper' ? 1 : 1.4)
      p.wobA = Math.max(p.wob > 0 ? p.wobA : 0, kind === 'paper' ? 0.05 : 0.03)
    }
    ctx.fx.puff(target.pos, kind === 'crumb' ? 'crumbs' : 'spark', 6)
    return true
  },

  pack(_c, st) {
    const r = (x: number) => Math.round(x * 1000) / 1000
    return [
      st.slam ? [st.slam.by, r(st.slam.at)] : 0,
      st.rattle,
      st.plates.map((p) => [p.shape, r(p.s), r(p.crack), r(p.soft), r(p.wob), r(p.wobA), r(p.paw), r(p.pawA), r(p.pawB), p.crumbs.map(r), r(p.nu), r(p.nv), p.down]),
    ]
  },

  unpack(_c, st, data) {
    const [slam, rattle, plates] = data as [[number, number] | 0, number, [number, number, number, number, number, number, number, number, number, number[], number, number, number][]]
    st.slam = slam ? { by: slam[0], at: slam[1] } : null
    st.rattle = rattle
    plates.forEach((a, i) => {
      const p = st.plates[i] ?? (st.plates[i] = freshPlate(a[0]))
      ;[p.shape, p.s, p.crack, p.soft, p.wob, p.wobA, p.paw, p.pawA, p.pawB] = a
      p.crumbs = a[9]
      p.nu = a[10]
      p.nv = a[11]
      p.down = a[12]
    })
  },

  onEvent(ctx, st, data) {
    const e = data as { fake?: number; milk?: number; swap?: [number, number]; broke?: number; done?: number }
    if (e.fake !== undefined) {
      const v = st.vis[e.fake]
      if (v) v.fake = 0.7
      ctx.fxLocal.sfx('crack')
      ctx.fxLocal.shake(0.5)
    }
    if (e.milk !== undefined) {
      const t = ctx.toys[e.milk]
      if (t) ctx.fxLocal.puff({ x: st.seats[e.milk].cx, y: TOP_Y + 0.2, z: st.seats[e.milk].cz }, 'milk', 18)
    }
    if (e.swap) for (const i of e.swap) if (st.vis[i]) st.vis[i].fake = 0
    if (e.broke !== undefined) ctx.fxLocal.puff({ x: st.seats[e.broke].cx, y: TOP_Y + 0.1, z: st.seats[e.broke].cz }, 'crumbs', 22)
    if (e.done !== undefined) ctx.fxLocal.puff({ x: st.seats[e.done].cx, y: TOP_Y + 0.2, z: st.seats[e.done].cz }, 'spark', 16)
  },

  visual(ctx, st, dt) {
    const t = ctx.time
    const me = ctx.me
    // The lid rattles in the last stretch.
    if (st.lid) {
      const a = st.rattle && ctx.phase === 'play' ? 0.02 : 0
      st.lid.position.set(wobble(t * 3, 1) * a, Math.abs(wobble(t * 4, 2)) * a, wobble(t * 3, 3) * a)
    }
    const tmp = _tmp
    st.vis.forEach((v, i) => {
      const p = st.plates[i]
      if (!p) return
      const sh = SHAPES[p.shape]
      if (v.shown !== p.shape) {
        // (Re)build the outline for this plate's shape (also after a Plate Swap).
        if (v.groove) {
          v.group.remove(v.groove, v.prog)
          v.groove.geometry.dispose()
          v.prog.geometry.dispose()
        }
        v.groove = ribbon(sh.pts, 0.03, TOP_Y + 0.003, grooveMat)
        v.prog = ribbon(sh.pts, 0.04, TOP_Y + 0.005, progMat)
        v.group.add(v.groove, v.prog)
        v.start.position.set(-sh.pts[0][0], TOP_Y + 0.007, sh.pts[0][1])
        v.shown = p.shape
      }
      const segs = Math.max(0, Math.min(sh.pts.length - 1, idxAt(sh, p.s)))
      v.prog.geometry.setDrawRange(0, segs * 6)
      // The paw hides part of the outline (on the plate everyone sees).
      v.paw.visible = p.paw > 0
      if (p.paw > 0) {
        const k = idxAt(sh, (p.pawA + p.pawB) / 2)
        v.paw.position.set(-sh.pts[k][0] * 0.8, TOP_Y + 0.12, sh.pts[k][1] * 0.8)
        v.paw.scale.setScalar(1 + Math.sin(t * 6) * 0.03)
      }
      v.fake = Math.max(0, v.fake - dt)
      const show = Math.max(p.crack, v.fake > 0 ? 0.9 : 0)
      v.cracks.forEach((c, k) => {
        const f = THREE.MathUtils.clamp((show - k * 0.18) / 0.4, 0, 1)
        c.geometry.setDrawRange(0, Math.floor(f * 9) * 6)
      })
      v.crumbs.forEach((c, k) => {
        const arcPos = p.crumbs[k]
        c.visible = arcPos !== undefined
        if (arcPos === undefined) return
        const q = idxAt(sh, arcPos)
        c.position.set(-sh.pts[q][0], TOP_Y + 0.05, sh.pts[q][1])
        c.rotation.y += dt
      })
      ;(v.milk.material as THREE.MeshStandardMaterial).opacity = p.soft > 0 ? 0.45 * Math.min(1, p.soft) : 0
      // Needles: mine under my pointer (no network delay), everyone else's from the host.
      const toy = ctx.toys[i]
      const seat = st.seats[i]
      let nu = p.nu, nv = p.nv, down = p.down === 1
      if (toy && toy === me && toy.status === 'play') {
        const local = toPlate(seat, ctx.pointer.x, ctx.pointer.z)
        const amp = (p.wob > 0 ? p.wobA : 0) + (st.rattle ? 0.022 : 0)
        nu = local[0] + wobble(t, i) * amp
        nv = local[1] + wobble(t, i + 9) * amp
        down = ctx.pointer.down && toy.busy <= 0
      }
      const r = Math.hypot(nu, nv)
      if (r > BISCUIT_R + 0.4) {
        nu *= (BISCUIT_R + 0.4) / r
        nv *= (BISCUIT_R + 0.4) / r
      }
      toWorld(seat, nu, nv, tmp, TOP_Y + (down ? 0 : 0.12))
      v.needle.position.lerp(tmp, toy === me ? 1 : Math.min(1, dt * 14))
      v.needle.visible = !!toy && toy.status !== 'failed'
    })
  },

  cameraUpdate(ctx, st, cam, dt) {
    const me = ctx.me
    const tmp = _tmp, look = _look
    if (me && ctx.phase !== 'intro') {
      const s = st.seats[me.idx]
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw)
      // Behind and above your seat: your biscuit big in the lower half, every other plate across the lid.
      tmp.set(s.cx - fx * 2.7, TOP_Y + 3.7, s.cz - fz * 2.7)
      look.set(s.cx + fx * 1.35, TOP_Y, s.cz + fz * 1.35)
      cam.place(tmp, look, dt, 6)
      return true
    }
    // Spectators: a slow orbit over the lid.
    const a = ctx.time * 0.08
    tmp.set(Math.sin(a) * st.lidR * 0.9, st.lidR * 1.1 + 2, Math.cos(a) * st.lidR * 0.9)
    cam.place(tmp, look.set(0, 0, 0), dt, 3)
    return true
  },

  hud(ctx, st, me) {
    if (!me) return null
    const p = st.plates[me.idx]
    const sh = SHAPES[p.shape]
    const chips = [sh.name]
    if (st.rattle && ctx.phase === 'play') chips.push('Lid rattling!')
    let prompt: string | undefined
    if (me.status === 'play' && ctx.phase === 'play') {
      if (st.slam && st.slam.by !== me.idx) prompt = 'TABLE SLAM incoming: lift your needle!'
      else if (p.crumbs.some((c) => c > p.s && c - p.s < sh.len * 0.15)) prompt = 'Crumb on your line! Press R twice, or swipe over it twice with the needle up.'
      else if (p.soft > 0) prompt = 'Milk! Your biscuit is soft: it cracks twice as easily (but cuts faster).'
      else if (p.paw > 0) prompt = 'A paw is covering your shape: trace from memory, or wait.'
      else if (me.busy > 0) prompt = 'Needle lifted while you play your trick…'
      else if (p.s < 0.05) prompt = 'Start at the green dot. Hold the mouse (or Space) and follow the line slowly.'
    }
    if (me.status === 'qualified') prompt = `You cut out the ${sh.name.toLowerCase()}!`
    if (me.status === 'failed') prompt = 'Cracked! Throw things from the peanut gallery (1 2 3).'
    return {
      chips,
      prompt,
      status: me.status === 'play' && ctx.phase === 'play' ? (p.down ? { text: 'NEEDLE DOWN', color: '#86efac' } : { text: 'NEEDLE UP', color: '#cbd5e1' }) : undefined,
      bars: [
        { label: 'Cut', value: progress(p), color: '#86efac' },
        { label: 'Crack', value: p.crack, color: '#f87171', danger: p.crack > 0.6 },
      ],
    }
  },
})
