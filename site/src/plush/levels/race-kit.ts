// Race kit: the shared parts of the race pack, written on top of the public level API (no engine changes).
//
// - Course: a bot route (waypoints), checkpoints, a finish zone and a podium. Progress along the route ranks the
//   field, checkpoints set where a fallen toy comes back, and each new checkpoint pays a Sprinkle.
// - raceTick / raceFall / raceRank / raceHud / racePack: the race rules every race level shares. A trick's `busy`
//   time ties the user's paws up (they stand still), which is the price of mischief in a race.
// - follow(): waypoint steering for bots, with gap jumps, obstacle hops, waits and a stuck detector.
// - mover(): a kinematic box driven by a pose function (pistons, drawers, carriages, flippers, bridges) that
//   carries toys standing on it and, optionally, shoves toys it runs into.
// - Small builders for the toy-like look: rounded boxes, canvas textures, finish arches, site decor models.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { hopObstacles } from '../engine/bots'
import type { Hazard } from '../engine/hazards'
import { textSprite } from '../engine/helpers'
import type { RigidBody } from '../engine/physics'
import { FOOT } from '../engine/toy'
import type { LevelCtx, LevelHud, Spawn, Toy } from '../engine/types'

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const _e = new THREE.Euler()
const _cl = new THREE.Vector3()
const _cw = new THREE.Vector3()

/* ================================ Look ================================ */

export function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...extra })
}

const rboxCache = new Map<string, THREE.BufferGeometry>()
/** A rounded box geometry (toy-like edges), cached per size so repeats share one buffer. */
export function rbox(w: number, h: number, d: number, r = 0.12, seg = 2) {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}|${r}|${seg}`
  let g = rboxCache.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))
    rboxCache.set(key, g)
  }
  return g
}

/** Forget cached geometries (call from dispose: the engine disposes everything under ctx.root). */
export function clearKitCache() {
  rboxCache.clear()
}

/** A canvas-painted texture. `draw` gets a 2D context of w×h pixels. */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat: [number, number] = [1, 1]) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 4
  return t
}

/** Black-and-white chequers (finish lines). */
export function checkerTex(cols = 8, rows = 2, a = '#111827', b = '#f8fafc') {
  return canvasTex(cols * 16, rows * 16, (g) => {
    for (let x = 0; x < cols; x++)
      for (let y = 0; y < rows; y++) {
        g.fillStyle = (x + y) % 2 ? a : b
        g.fillRect(x * 16, y * 16, 16, 16)
      }
  })
}

/** Light stripes or a stitch pattern on a base colour (knit socks, cardboard, felt). */
export function stripeTex(base: string, stripe: string, n = 4, vertical = false, stitch = false) {
  return canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = base
    g.fillRect(0, 0, w, h)
    g.fillStyle = stripe
    for (let i = 0; i < n; i++) {
      const p = (i / n) * (vertical ? w : h)
      if (vertical) g.fillRect(p, 0, w / n / 2, h)
      else g.fillRect(0, p, w, h / n / 2)
    }
    if (stitch) {
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.lineWidth = 2
      for (let y = 4; y < h; y += 8)
        for (let x = 0; x < w; x += 8) {
          g.beginPath()
          g.moveTo(x, y)
          g.lineTo(x + 4, y + 4)
          g.lineTo(x + 8, y)
          g.stroke()
        }
    }
  })
}

export interface SolidOpts {
  /** Centre. */
  pos: [number, number, number]
  size: [number, number, number]
  material: THREE.Material
  rotY?: number
  /** Full rotation (overrides rotY). */
  quat?: THREE.Quaternion
  round?: number
  /** Add a box collider (default true). */
  collide?: boolean
  friction?: number
  shadow?: boolean
  parent?: THREE.Object3D
}

/** A visible block with a matching box collider: floors, walls, ledges. */
export function solid(ctx: LevelCtx, o: SolidOpts) {
  const [w, h, d] = o.size
  const geo = o.round ? rbox(w, h, d, o.round) : new THREE.BoxGeometry(w, h, d)
  const m = new THREE.Mesh(geo, o.material)
  m.position.set(...o.pos)
  if (o.quat) m.quaternion.copy(o.quat)
  else if (o.rotY) m.rotation.y = o.rotY
  m.receiveShadow = true
  m.castShadow = o.shadow ?? true
  ;(o.parent ?? ctx.root).add(m)
  if (o.collide !== false) {
    ctx.phys.box({ x: o.pos[0], y: o.pos[1], z: o.pos[2] }, { x: w / 2, y: h / 2, z: d / 2 }, { rotY: o.rotY, quat: o.quat, friction: o.friction ?? 0.8 })
  }
  return m
}

/** A ramp (a tilted box) rising from (x, y0, z0) to (x, y1, z1) along z, or along x with `alongX`. */
export function ramp(ctx: LevelCtx, o: { x: number; z: number; y0: number; y1: number; len: number; width: number; material: THREE.Material; alongX?: boolean; thick?: number }) {
  const rise = o.y1 - o.y0
  const ang = Math.atan2(rise, o.len)
  const L = Math.hypot(rise, o.len)
  const t = o.thick ?? 0.4
  // Sink the slab by half its thickness so its top surface runs from y0 to y1.
  const cy = (o.y0 + o.y1) / 2 - (t / 2) * Math.cos(ang)
  const q = new THREE.Quaternion()
  if (o.alongX) q.setFromEuler(_e.set(0, 0, ang))
  else q.setFromEuler(_e.set(-ang, 0, 0))
  const size: [number, number, number] = o.alongX ? [L, t, o.width] : [o.width, t, L]
  return solid(ctx, { pos: [o.x, cy, o.z], size, material: o.material, quat: q })
}

/** Finish arch: two posts, a chequered strip on the ground and a banner. Visual only. */
export function finishArch(ctx: LevelCtx, o: { x: number; y: number; z: number; width: number; rotY?: number; color: string; text?: string; posts?: boolean }) {
  const g = new THREE.Group()
  g.position.set(o.x, o.y, o.z)
  g.rotation.y = o.rotY ?? 0
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(o.width, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checkerTex(Math.round(o.width * 2), 2), roughness: 0.9 }))
  strip.position.y = 0.03
  strip.receiveShadow = true
  g.add(strip)
  const postMat = mat(o.color, { emissive: o.color, emissiveIntensity: 0.15 })
  for (const s of o.posts === false ? [] : [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 4.4, 10), postMat)
    post.position.set((s * o.width) / 2, 2.2, 0)
    post.castShadow = true
    g.add(post)
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), postMat)
    knob.position.set((s * o.width) / 2, 4.5, 0)
    g.add(knob)
  }
  if (o.posts !== false) {
    const bar = new THREE.Mesh(rbox(o.width, 0.5, 0.3, 0.1), new THREE.MeshStandardMaterial({ map: checkerTex(Math.round(o.width * 1.5), 1), roughness: 0.8 }))
    bar.position.y = 4.3
    g.add(bar)
  }
  const sign = textSprite(o.text ?? 'FINISH', { bg: o.color, size: 1 })
  sign.position.y = o.posts === false ? 2.6 : 5.3
  g.add(sign)
  ctx.root.add(g)
  return g
}

/* Site decor models (public/<dir>/models/*.glb), loaded on demand. Purely cosmetic: they pop in when loaded. */
const decorCache = new Map<string, Promise<THREE.Object3D | null>>()
let decorLoader: GLTFLoader | null = null

export function decor(ctx: LevelCtx, path: string, size: number, at: [number, number, number], o: { by?: 'height' | 'max' | 'width'; rotY?: number; shadows?: boolean } = {}) {
  const holder = new THREE.Group()
  holder.position.set(...at)
  holder.rotation.y = o.rotY ?? 0
  ctx.root.add(holder)
  decorLoader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const url = `${import.meta.env.BASE_URL}${path}`
  let p = decorCache.get(url)
  if (!p) {
    p = decorLoader
      .loadAsync(url)
      .then((g) => g.scene)
      .catch(() => null)
    decorCache.set(url, p)
  }
  p.then((src) => {
    if (!src || !holder.parent) return
    const root = src.clone(true)
    // Own copies of materials and geometry are not needed: clone(true) shares them, and they live in the cache.
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const s = box.getSize(new THREE.Vector3())
    const c = box.getCenter(new THREE.Vector3())
    const by = o.by ?? 'height'
    const ref = by === 'height' ? s.y : by === 'width' ? Math.max(s.x, s.z) : Math.max(s.x, s.y, s.z)
    const k = size / Math.max(ref, 1e-4)
    root.scale.multiplyScalar(k)
    root.position.set(-c.x * k, -box.min.y * k, -c.z * k)
    root.traverse((x) => {
      const m = x as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = o.shadows ?? false
        m.receiveShadow = true
        // Mark so the round teardown can't free the cached source's GPU data (see dispose note above).
        m.userData.shared = true
      }
    })
    holder.add(root)
  })
  return holder
}

/**
 * Before the engine disposes the round, detach decor clones that share geometry with the cache (call from the
 * level's dispose hook). Otherwise a second round would render disposed buffers.
 */
export function detachDecor(ctx: LevelCtx) {
  const shared: THREE.Object3D[] = []
  ctx.root.traverse((x) => {
    if (x.userData.shared) shared.push(x)
  })
  for (const x of shared) x.removeFromParent()
}

/* ================================ Course ================================ */

/** A box zone on the course: centre (x, z), floor height y, half sizes. */
export interface Zone {
  x: number
  y: number
  z: number
  hx: number
  hz: number
  /** How far above the floor still counts (default 3). */
  up?: number
}

export interface Checkpoint extends Zone {
  /** Facing when you come back here. */
  yaw: number
  name?: string
  /** Landing this far below the checkpoint's floor (on lower ground) counts as a fall. Default 2.5 m. */
  drop?: number
  /** Where fallen toys come back, if not the checkpoint zone itself (e.g. the dry top of an island). */
  spot?: Zone
}

/** A bot waypoint. */
export interface Wp {
  x: number
  y: number
  z: number
  /** Arrival radius (default 1.1). */
  r?: number
  /** Lateral spread (metres either side) so bots don't queue in a line. */
  w?: number
  /** Jump when this close (horizontal metres). */
  jump?: number
  /** Dive when this close. */
  dive?: number
  /** A wait id: the level's `wait(id, toy)` says when to hold still before heading here. */
  wait?: number
  /** Don't do the automatic gap jump on the way here (bridges, rides). */
  noGap?: boolean
  /** Arrived once the toy is this high (vertical sections). */
  minY?: number
  /** Reached by riding something up (a lift): don't back off just because it is far above. */
  ride?: boolean
}

export class Course {
  readonly path: Wp[]
  readonly cps: Checkpoint[]
  readonly finish: Zone
  readonly podium: Spawn
  /** Arc length along the route at each waypoint. */
  readonly cum: number[]
  /** For each checkpoint, the route index nearest it. */
  readonly cpWp: number[]
  readonly total: number
  /** For a course that moves: map world positions into course space and back (default: the world itself). */
  space: { toLocal(p: THREE.Vector3Like, out: THREE.Vector3): THREE.Vector3; toWorld(p: THREE.Vector3Like, out: THREE.Vector3): THREE.Vector3 } | null = null

  constructor(o: { path: Wp[]; cps: Checkpoint[]; finish: Zone; podium: Spawn }) {
    this.path = o.path
    this.cps = o.cps
    this.finish = o.finish
    this.podium = o.podium
    this.cum = [0]
    for (let i = 1; i < o.path.length; i++) {
      const a = o.path[i - 1], b = o.path[i]
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, (b.y - a.y) * 1.5, b.z - a.z))
    }
    this.total = this.cum[this.cum.length - 1]
    this.cpWp = o.cps.map((c) => this.nearestWp(c.x, c.y, c.z))
  }

  /** A world position in course space (a shared scratch vector: use it straight away). */
  local(p: THREE.Vector3): THREE.Vector3 {
    return this.space ? this.space.toLocal(p, _cl) : p
  }

  /** A course-space spawn in the world. */
  worldSpawn(s: Spawn): Spawn {
    if (!this.space) return s
    const w = this.space.toWorld(_cw.set(s.x, s.y, s.z), _cw)
    return { x: w.x, y: w.y, z: w.z, yaw: s.yaw }
  }

  nearestWp(x: number, y: number, z: number, from = 0) {
    let best = from, bd = Infinity
    for (let i = from; i < this.path.length; i++) {
      const w = this.path[i]
      const d = Math.hypot(w.x - x, (w.y - y) * 2, w.z - z)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  /** Arc length of the closest point on the route, searching the stretch after checkpoint `cp`. */
  progress(p: THREE.Vector3Like, cp: number) {
    const lo = cp >= 0 ? Math.max(0, this.cpWp[cp] - 1) : 0
    const hi = cp + 1 < this.cps.length ? Math.min(this.path.length - 1, this.cpWp[cp + 1] + 1) : this.path.length - 1
    let best = this.cum[lo], bd = Infinity
    for (let i = lo; i < hi; i++) {
      const a = this.path[i], b = this.path[i + 1]
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
      const l2 = abx * abx + aby * aby + abz * abz || 1e-6
      const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1)
      const dx = a.x + abx * t - p.x, dy = (a.y + aby * t - p.y) * 2, dz = a.z + abz * t - p.z
      const d = dx * dx + dy * dy + dz * dz
      if (d < bd) {
        bd = d
        best = this.cum[i] + (this.cum[i + 1] - this.cum[i]) * t
      }
    }
    return best
  }
}

export function inZone(z: Zone, x: number, feet: number, zz: number) {
  return Math.abs(x - z.x) <= z.hx && Math.abs(zz - z.z) <= z.hz && feet >= z.y - 0.7 && feet <= z.y + (z.up ?? 3)
}

/** Spread spots inside a zone (respawns, podium) so toys don't land on each other. */
export function zoneSpot(z: Zone, i: number, yaw: number): Spawn {
  const cols = Math.max(1, Math.floor((z.hx * 2) / 1.3))
  const rows = Math.max(1, Math.floor((z.hz * 2) / 1.3))
  const k = i % (cols * rows)
  const cx = k % cols, cz = Math.floor(k / cols)
  return { x: z.x - z.hx + 0.65 + cx * ((z.hx * 2 - 1.3) / Math.max(1, cols - 1) || 0), y: z.y, z: z.z - z.hz + 0.65 + cz * ((z.hz * 2 - 1.3) / Math.max(1, rows - 1) || 0), yaw }
}

/* ================================ Race rules ================================ */

export interface RaceState {
  /** Checkpoint reached per toy (-1 = start). Synced. */
  cp: number[]
  /** Round time until which a toy is held (flattened, tangled...). Synced (visuals use it). */
  hold: number[]
  /** Round time until which a toy runs fast (seeds, soap). Synced (clients predict their own toy with it). */
  fast: number[]
  /** Round time until which a toy is slowed (snags). Synced. */
  slow: number[]
  // Host only.
  podium: number
  respawns: number[]
}

export function raceInit(ctx: LevelCtx): RaceState {
  const n = Math.max(1, ctx.toys.length)
  return { cp: new Array(n).fill(-1), hold: new Array(n).fill(0), fast: new Array(n).fill(0), slow: new Array(n).fill(0), podium: 0, respawns: new Array(n).fill(0) }
}

const r1 = (x: number) => Math.round(x * 10) / 10

export function racePack(rs: RaceState) {
  return [rs.cp, rs.hold.map(r1), rs.fast.map(r1), rs.slow.map(r1)]
}

export function raceUnpack(rs: RaceState, d: unknown) {
  const a = d as number[][]
  if (!Array.isArray(a)) return
  rs.cp = a[0]
  rs.hold = a[1]
  rs.fast = a[2]
  rs.slow = a[3]
}

/** Top speed for a toy right now, from the race state (run on every screen through raceSpeedHazard). */
export function raceSpeed(ctx: LevelCtx, rs: RaceState, toy: Toy, base: number) {
  let s = base
  if ((rs.fast[toy.idx] ?? 0) > ctx.time) s *= 1.45
  if ((rs.slow[toy.idx] ?? 0) > ctx.time) s *= 0.5
  return s
}

/**
 * A hazard that applies speed boosts and slows from the race state. It predicts, so a client's own toy runs at
 * the same speed the host gives it. Register it in init().
 */
export function raceSpeedHazard(ctx: LevelCtx, rs: RaceState, base: number, extra?: (toy: Toy) => number) {
  return ctx.hazards.add({
    predict: true,
    update() {},
    affect(c, toy) {
      toy.runSpeed = raceSpeed(c, rs, toy, base) * (extra ? extra(toy) : 1)
    },
  })
}

/** Put a toy back at its checkpoint (or the start), with a short daze. */
export function raceRespawn(ctx: LevelCtx, rs: RaceState, course: Course, toy: Toy, why = '') {
  const cp = rs.cp[toy.idx] ?? -1
  rs.respawns[toy.idx] = (rs.respawns[toy.idx] ?? 0) + 1
  const n = rs.respawns[toy.idx] + toy.idx * 3
  const at = cp >= 0 ? course.worldSpawn(zoneSpot(course.cps[cp].spot ?? course.cps[cp], n, course.cps[cp].yaw)) : toy.spawn
  ctx.respawn(toy, at, 0.5)
  rs.hold[toy.idx] = 0
  const d = toy.data as BotMem
  d.resync = true
  d.stuck = 0
  d.bestD = Infinity
  if (why) ctx.fx.popup(toy, why, '#bae6fd')
}

/**
 * The shared race rules (host, every tick): checkpoints (+1 Sprinkle each), the finish and the podium, paws tied
 * up while a trick is played or while held, and stuck bots sent back to their checkpoint. Zones live in the
 * course's space (see Course.space), so a course that moves (the tilting pinball table) still works.
 */
export function raceTick(ctx: LevelCtx, rs: RaceState, course: Course) {
  for (const toy of ctx.toys) {
    if (toy.status === 'qualified') {
      // A breather, then off to the podium out of everyone's way.
      if (!toy.data.podium && ctx.time - toy.doneAt > 1.1) {
        toy.data.podium = 1
        const z = course.podium
        const k = rs.podium++
        const sx = Math.cos(z.yaw), sz = -Math.sin(z.yaw)
        const fx = Math.sin(z.yaw), fz = Math.cos(z.yaw)
        const col = (k % 6) - 2.5, row = Math.floor(k / 6)
        ctx.respawn(toy, course.worldSpawn({ x: z.x + sx * col * 1.25 - fx * row * 1.3, y: z.y, z: z.z + sz * col * 1.25 - fz * row * 1.3, yaw: z.yaw }), 0)
      }
      toy.frozen = !!toy.data.podium
      continue
    }
    if (toy.status !== 'play') continue
    toy.frozen = toy.busy > 0 || (rs.hold[toy.idx] ?? 0) > ctx.time
    const lp = course.local(toy.pos)
    const feet = lp.y - FOOT
    // Checkpoints: any later one counts (shortcuts skip ahead).
    for (let i = course.cps.length - 1; i > (rs.cp[toy.idx] ?? -1); i--) {
      if (!inZone(course.cps[i], lp.x, feet, lp.z)) continue
      const first = i > rs.cp[toy.idx]
      rs.cp[toy.idx] = i
      if (first) {
        ctx.addSprinkles(toy, 1, 'checkpoint')
        ctx.fx.sfx('ding', toy.pos, toy)
      }
      break
    }
    if (inZone(course.finish, lp.x, feet, lp.z)) {
      const place = ctx.qualifiedCount() + 1
      ctx.qualify(toy, `#${place}`)
      toy.frozen = false
      continue
    }
    // Knocked down onto lower ground than your checkpoint: that's a fall too.
    const cpz = course.cps[rs.cp[toy.idx] ?? -1]
    if (cpz && toy.grounded && feet < cpz.y - (cpz.drop ?? 2.5)) {
      raceRespawn(ctx, rs, course, toy, 'Back to the checkpoint')
      continue
    }
    // Bots that got wedged somewhere go back to their checkpoint.
    if (toy.bot && ((toy.data as BotMem).stuck ?? 0) > 9) raceRespawn(ctx, rs, course, toy, 'Unstuck!')
  }
}

/** Ranking: furthest checkpoint, then furthest along the route; finished toys first in finishing order. */
export function raceRank(ctx: LevelCtx, rs: RaceState, course: Course) {
  const act = ctx.active()
  const score = new Map<Toy, number>()
  for (const t of act) {
    const lp = course.local(t.pos)
    score.set(t, course.progress(lp, rs.cp[t.idx] ?? -1))
  }
  return act.sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0))
}

/** Progress 0..1 for a toy (HUD). */
export function raceProgress(rs: RaceState, course: Course, toy: Toy) {
  if (toy.status === 'qualified') return 1
  const lp = course.local(toy.pos)
  return THREE.MathUtils.clamp(course.progress(lp, rs.cp[toy.idx] ?? -1) / course.total, 0, 1)
}

/** The shared HUD: progress bar, checkpoint and qualifying chips, and a prompt slot. */
export function raceHud(ctx: LevelCtx, rs: RaceState, course: Course, me: Toy | null, accent: string, extra: Partial<LevelHud> = {}): LevelHud {
  const chips: string[] = []
  const q = ctx.qualifiedCount()
  if (ctx.mode !== 'show') chips.push(`${q} finished`)
  if (me && me.status === 'play') chips.push(`Checkpoint ${Math.max(0, (rs.cp[me.idx] ?? -1) + 1)}/${course.cps.length}`)
  if (extra.chips) chips.push(...extra.chips)
  let prompt = extra.prompt
  if (me?.status === 'qualified') prompt = ctx.mode === 'show' ? 'Through! Watch the rest from the podium.' : 'Finished!'
  else if (me && me.busy > 0 && !prompt) prompt = 'Paws busy with your trick…'
  const bars = me ? [{ label: 'Course', value: raceProgress(rs, course, me), color: accent }, ...(extra.bars ?? [])] : extra.bars
  return { chips, prompt, bars, status: extra.status }
}

/** Spawn a field on a start zone (rows facing yaw). */
export function raceSpawn(ctx: LevelCtx, start: { x: number; y: number; z: number; yaw: number; cols?: number }, i: number, n: number) {
  return ctx.spawnGrid(n, { x: start.x, y: start.y, z: start.z, yaw: start.yaw, spacing: 1.45, cols: start.cols ?? 6 })[i]
}

/* ================================ Bots ================================ */

export interface BotMem {
  wp?: number
  lane?: number
  stuck?: number
  bestD?: number
  bestT?: number
  hopT?: number
  route?: number
  wanderT?: number
  wanderA?: number
  /** Re-find the route after a respawn. */
  resync?: boolean
}

/**
 * Steer a bot along a route: head for the next waypoint (spread across `w`), jump where told, jump gaps in
 * the floor ahead, hop low obstacles, and hold still while `wait(id, toy)` says so. Tracks how long it has
 * made no headway (BotMem.stuck), which raceTick uses to send it back to its checkpoint.
 */
export function follow(
  ctx: LevelCtx,
  toy: Toy,
  path: Wp[],
  o: { pace: number; dt: number; wait?: (id: number, toy: Toy, w: Wp) => boolean; toWorld?: (w: Wp, out: THREE.Vector3) => THREE.Vector3; jumpGaps?: boolean },
) {
  const d = toy.data as BotMem
  if (d.wp === undefined) d.wp = 0
  if (d.resync) {
    // Back at a checkpoint: pick up the route at the waypoint nearest to here.
    d.resync = false
    let best = 0, bd = Infinity
    for (let i = 0; i < path.length; i++) {
      const w = o.toWorld ? o.toWorld(path[i], _w) : _w.set(path[i].x, path[i].y, path[i].z)
      const dd = Math.hypot(w.x - toy.pos.x, (w.y - toy.feet) * 2, w.z - toy.pos.z)
      if (dd <= bd + 0.01) {
        bd = dd
        best = i
      }
    }
    d.wp = best
  }
  if (d.lane === undefined) d.lane = (((toy.idx * 7919 + ctx.seed) % 1000) / 1000) * 2 - 1
  if (d.wp >= path.length) d.wp = path.length - 1
  const lane = d.lane
  /** Waypoint i in the world, shifted across its leg by this bot's lane. */
  const target = (i: number, out: THREE.Vector3) => {
    const w = path[i]
    if (o.toWorld) o.toWorld(w, out)
    else out.set(w.x, w.y, w.z)
    if (w.w && i > 0) {
      const pv = path[i - 1]
      const pw = o.toWorld ? o.toWorld(pv, _v) : _v.set(pv.x, pv.y, pv.z)
      let lx = out.x - pw.x, lz = out.z - pw.z
      const ll = Math.hypot(lx, lz) || 1
      lx /= ll
      lz /= ll
      out.x += -lz * w.w * lane
      out.z += lx * w.w * lane
    }
    return out
  }
  let holding = false
  // Advance past reached waypoints (a waypoint with a wait holds the bot there until the level says go).
  for (let guard = 0; guard < 3 && d.wp < path.length - 1; guard++) {
    const w = path[d.wp]
    const wp = target(d.wp, _w)
    const dx = wp.x - toy.pos.x, dz = wp.z - toy.pos.z
    const feet = toy.pos.y - FOOT
    const dyOk = w.minY !== undefined ? feet >= w.minY - 0.3 : Math.abs(feet - wp.y) < 1.4
    let reached = Math.hypot(dx, dz) < (w.r ?? 1.1) && dyOk
    if (!reached && d.wp > 0 && dyOk) {
      // Past the waypoint's plane (perpendicular to the leg that arrives at it).
      const pw = target(d.wp - 1, _p)
      const lx = wp.x - pw.x, lz = wp.z - pw.z
      const ll = Math.hypot(lx, lz)
      if (ll > 0.5 && ((toy.pos.x - wp.x) * lx + (toy.pos.z - wp.z) * lz) / ll > 0.2 && Math.hypot(dx, dz) < 3) reached = true
    }
    if (!reached) break
    if (w.wait !== undefined && o.wait?.(w.wait, toy, w)) {
      holding = true
      break
    }
    d.wp++
    d.bestD = Infinity
    d.stuck = 0
  }
  // A high waypoint (after a bounce or a climb) and we're back on the ground below it: retry the way up.
  const cw = path[d.wp]
  if (d.wp > 0 && toy.grounded && !cw.ride) {
    const cy = o.toWorld ? o.toWorld(cw, _p).y : cw.y
    if (cw.minY !== undefined ? toy.feet < cw.minY - 1.2 : cy - toy.feet > 1.5) d.wp--
  }
  const w = path[d.wp]
  const wp = target(d.wp, _w)
  const tx = wp.x, tz = wp.z
  if (holding) {
    // Stand on the spot (nudge back onto it if pushed off).
    const hd = Math.hypot(tx - toy.pos.x, tz - toy.pos.z)
    toy.pad.mx = hd > 0.5 ? ((tx - toy.pos.x) / hd) * 0.5 : 0
    toy.pad.mz = hd > 0.5 ? ((tz - toy.pos.z) / hd) * 0.5 : 0
    d.stuck = 0
    d.bestD = Infinity
    return
  }
  const dx = tx - toy.pos.x, dz = tz - toy.pos.z
  const dist = Math.hypot(dx, dz)
  if (dist > 0.05) {
    const k = o.pace * Math.min(1, dist / 0.5 + 0.35)
    toy.pad.mx = (dx / dist) * k
    toy.pad.mz = (dz / dist) * k
  }
  // In the air over a waypoint we can reach: aim to land on it rather than sail past.
  if (!toy.grounded && dist < 6 && wp.y <= toy.feet + 0.3) airAim(toy, tx, wp.y, tz)
  if (toy.grounded) {
    if (w.jump && dist < w.jump) toy.pad.jump = true
    if (w.dive && dist < w.dive && toy.diveCd <= 0) toy.pad.dive = true
    // A gap in the floor just ahead: jump it.
    if (o.jumpGaps !== false && !w.noGap && dist > 1.2) {
      const fx = dx / dist, fz = dz / dist
      const g = ctx.phys.groundBelow({ x: toy.pos.x + fx * 0.9, y: toy.feet + 0.6, z: toy.pos.z + fz * 0.9 }, 2.2, toy.body)
      if (g < 0) toy.pad.jump = true
    }
    hopObstacles(ctx, toy)
  }
  // Headway: distance to the waypoint should keep shrinking (hops don't count as progress).
  const dd = Math.hypot(dx, dz) + (w.minY !== undefined ? Math.max(0, w.minY - toy.feet) : 0)
  if (dd < (d.bestD ?? Infinity) - 0.3) {
    d.bestD = dd
    d.stuck = 0
  } else {
    d.stuck = (d.stuck ?? 0) + o.dt
    // Wiggle and hop when it stalls; wander off for a moment if that doesn't help.
    if ((d.stuck ?? 0) > 1.6 && toy.grounded && (d.hopT ?? 0) < ctx.time) {
      d.hopT = ctx.time + 0.8
      toy.pad.jump = true
      d.lane = -(d.lane ?? 0) * 0.8
    }
    if ((d.stuck ?? 0) > 3.5 && (d.wanderT ?? 0) < ctx.time - 2) {
      d.wanderT = ctx.time + 0.7
      d.wanderA = ((toy.idx * 2.39996 + ctx.time * 1.7) % (Math.PI * 2))
    }
  }
  if ((d.wanderT ?? 0) > ctx.time) {
    toy.pad.mx = Math.sin(d.wanderA ?? 0) * o.pace
    toy.pad.mz = Math.cos(d.wanderA ?? 0) * o.pace
  }
}

/**
 * Mid-air steering for bots: set the stick so the toy lands on (x, y, z). Uses the time until its feet come
 * back down to y under gravity, and asks for the horizontal speed that covers the gap in that time.
 */
export function airAim(toy: Toy, x: number, y: number, z: number) {
  const vy = toy.vel.y
  const drop = toy.feet - y
  const disc = vy * vy + 48 * drop
  if (disc < 0) return
  const T = Math.max(0.12, (vy + Math.sqrt(disc)) / 24)
  const wx = (x - toy.pos.x) / T, wz = (z - toy.pos.z) / T
  const sp = toy.runSpeed || 5.6
  const l = Math.hypot(wx, wz) / sp
  const k = l > 1 ? 1 / l : 1
  toy.pad.mx = (wx / sp) * k
  toy.pad.mz = (wz / sp) * k
}

/* ================================ Movers ================================ */

export interface Mover extends Hazard {
  body: RigidBody
  obj: THREE.Object3D
  half: THREE.Vector3
  /** Current pose (world). */
  cur: THREE.Matrix4
  /** World velocity of the centre (m/s), for shoves. */
  vel: THREE.Vector3
  on: boolean
  /** Is this toy standing on top of it right now? */
  carrying(toy: Toy): boolean
}

/**
 * A kinematic box that follows `pose(t, out)` (write a world matrix into `out`; return false to hide it). Toys
 * standing on it ride along (position and turn); with `shove`, toys it runs into get knocked along its motion
 * (host only). Its visual `obj` (default: a rounded box in `material`) is placed every step.
 */
export function mover(
  ctx: LevelCtx,
  o: {
    half: [number, number, number]
    pose: (t: number, out: THREE.Matrix4) => boolean
    obj?: THREE.Object3D
    material?: THREE.Material
    round?: number
    shove?: number
    stun?: number
    friction?: number
    /** Extra colliders in the body's local space. */
    extra?: { pos: [number, number, number]; half: [number, number, number]; r?: number; restitution?: number }[]
    onKnock?: (toy: Toy) => void
    /** A round platform (radius = half[0]) instead of a box. */
    cyl?: boolean
  },
) {
  const RAPIER = ctx.RAPIER
  const body = ctx.phys.kinematic({ x: 0, y: -50, z: 0 })
  const shape = o.cyl ? RAPIER.ColliderDesc.cylinder(o.half[1], o.half[0]) : RAPIER.ColliderDesc.cuboid(o.half[0], o.half[1], o.half[2])
  ctx.phys.attach(body, shape, { friction: o.friction ?? 0.8 })
  for (const e of o.extra ?? []) {
    const d = e.r ? RAPIER.ColliderDesc.cylinder(e.half[1], e.r) : RAPIER.ColliderDesc.cuboid(...e.half)
    ctx.phys.attach(body, d.setTranslation(...e.pos), { friction: 0.6, restitution: e.restitution ?? 0.05 })
  }
  let obj = o.obj
  if (!obj) {
    const m = new THREE.Mesh(rbox(o.half[0] * 2, o.half[1] * 2, o.half[2] * 2, o.round ?? 0.1), o.material ?? mat('#f59e0b'))
    m.castShadow = true
    m.receiveShadow = true
    obj = m
  }
  ctx.root.add(obj)
  const half = new THREE.Vector3(...o.half)
  const cur = new THREE.Matrix4().makeTranslation(0, -50, 0)
  const next = new THREE.Matrix4()
  const delta = new THREE.Matrix4()
  const vel = new THREE.Vector3()
  const hitT = new Map<Toy, number>()
  const prevPos = new THREE.Vector3(0, -50, 0)
  let primed = false
  const reach = Math.max(half.x, half.y, half.z) + 1.6
  const far = (toy: Toy) => Math.abs(toy.pos.x - obj.position.x) > reach || Math.abs(toy.pos.z - obj.position.z) > reach || Math.abs(toy.pos.y - obj.position.y) > reach
  const local = (toy: Toy, m: THREE.Matrix4) => {
    _inv.copy(m).invert()
    return _v.set(toy.pos.x, toy.pos.y - FOOT, toy.pos.z).applyMatrix4(_inv)
  }
  const h: Mover = {
    body,
    obj,
    half,
    cur,
    vel,
    on: true,
    predict: true,
    carrying(toy: Toy) {
      if (!h.on || toy.status === 'failed' || toy.mode === 'seated') return false
      if ((!toy.grounded && toy.airT > 0.06) || far(toy)) return false
      const l = local(toy, cur)
      const inside = o.cyl ? Math.hypot(l.x, l.z) <= half.x + 0.25 : Math.abs(l.x) <= half.x + 0.25 && Math.abs(l.z) <= half.z + 0.25
      return inside && l.y > half.y - 0.35 && l.y < half.y + 0.45
    },
    update(_c, t, dt) {
      const on = o.pose(Math.max(0, t), next)
      if (!on) next.makeTranslation(0, -60, 0)
      h.on = on
      next.decompose(_p, _q, _s)
      body.setNextKinematicTranslation({ x: _p.x, y: _p.y, z: _p.z })
      body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      if (!primed) {
        // First placement: teleport (no sweep, no velocity).
        body.setTranslation({ x: _p.x, y: _p.y, z: _p.z }, true)
        body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true)
        prevPos.copy(_p)
        primed = true
      }
      vel.copy(_p).sub(prevPos).divideScalar(Math.max(1e-4, dt))
      if (vel.lengthSq() > 900) vel.set(0, 0, 0)
      prevPos.copy(_p)
      obj.position.copy(_p)
      obj.quaternion.copy(_q)
      obj.visible = on
      cur.copy(next)
    },
    affect(c, toy) {
      if (!h.on || toy.status === 'failed' || toy.mode === 'seated' || toy.body.isKinematic()) return
      if (h.carrying(toy)) {
        // Ride along: apply the motion from the current pose to the one update() is about to set.
        if (!o.pose(Math.max(0, c.time), next)) return
        delta.multiplyMatrices(next, _m.copy(cur).invert())
        const tp = toy.body.translation()
        _w.set(tp.x, tp.y, tp.z).applyMatrix4(delta)
        toy.body.setTranslation({ x: _w.x, y: _w.y, z: _w.z }, true)
        // Turn with it (yaw only).
        _e.setFromRotationMatrix(delta, 'YXZ')
        toy.yaw += _e.y
        return
      }
      if (!o.shove || !c.isHost || far(toy)) return
      const sp = vel.length()
      if (sp < 1.2) return
      const l = local(toy, cur)
      if (Math.abs(l.x) > half.x + 0.45 || Math.abs(l.z) > half.z + 0.45 || l.y > half.y - 0.15 || l.y < -half.y - 1.1) return
      if ((hitT.get(toy) ?? -9) > c.time - 0.6) return
      hitT.set(toy, c.time)
      _w.copy(vel).setY(0).normalize()
      const pow = o.shove + sp * 0.6
      c.knock(toy, { x: _w.x * pow, y: 3.2, z: _w.z * pow }, o.stun ?? 0.6)
      c.fx.sfx('thud', toy.pos)
      o.onKnock?.(toy)
    },
  }
  return ctx.hazards.add(h)
}

/** Compose a pose matrix from position and Euler angles (YXZ order: yaw, then pitch, then roll). */
export function poseOf(out: THREE.Matrix4, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
  _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'))
  return out.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1))
}

/** Deterministic 0..1 noise from integers (same on every screen). */
export function hash01(a: number, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** A spinning pickup star mesh (Sprinkles, seeds...). */
export function pickupMesh(color: string, kind: 'star' | 'seed' = 'star') {
  if (kind === 'seed') {
    const g = new THREE.Group()
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8).scale(0.75, 1.3, 0.45), mat('#3f3f46', { roughness: 0.5 }))
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.285, 10, 8).scale(0.2, 1.31, 0.46), mat('#e5e7eb'))
    g.add(shell, stripe)
    return g
  }
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const r = i % 2 ? 0.16 : 0.38
    if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r)
    else s.lineTo(Math.sin(a) * r, Math.cos(a) * r)
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false })
  geo.center()
  return new THREE.Mesh(geo, mat(color, { emissive: color, emissiveIntensity: 0.45, roughness: 0.4 }))
}

/**
 * A springy pad (rolled socks, sponges, pop-up books): a solid cylinder `top` metres tall whose top launches
 * toys that land on it. Predicts, so a client's own toy bounces without waiting for the host.
 */
export function trampoline(ctx: LevelCtx, o: { x: number; y: number; z: number; r: number; top: number; power: number; obj?: THREE.Object3D; onBounce?: (toy: Toy) => void }) {
  ctx.phys.cylinder({ x: o.x, y: o.y + o.top / 2, z: o.z }, o.top / 2, o.r, { restitution: 0.3 })
  let squash = 0
  if (o.obj) {
    o.obj.position.set(o.x, o.y, o.z)
    ctx.root.add(o.obj)
  }
  return ctx.hazards.add({
    predict: true,
    update(_c, _t, dt) {
      squash = Math.max(0, squash - dt * 4)
      if (o.obj) o.obj.scale.set(1 + squash * 0.25, 1 - squash * 0.45, 1 + squash * 0.25)
    },
    affect(c, toy) {
      if (!toy.grounded || toy.mode !== 'walk' || Math.hypot(toy.pos.x - o.x, toy.pos.z - o.z) > o.r + 0.1 || Math.abs(toy.feet - (o.y + o.top)) > 0.3) return
      const v = toy.body.linvel()
      toy.body.setLinvel({ x: v.x, y: o.power, z: v.z }, true)
      toy.grounded = false
      squash = 1
      if (c.isHost) {
        c.fx.sfx('boing', toy.pos)
        o.onBounce?.(toy)
      }
    },
  })
}

/** Is any active rival within `r` metres of (x, z) (and near height y)? */
export function rivalNear(ctx: LevelCtx, me: Toy, x: number, y: number, z: number, r: number) {
  for (const t of ctx.toys) {
    if (t === me || t.status !== 'play') continue
    if (Math.hypot(t.pos.x - x, t.pos.z - z) < r && Math.abs(t.feet - y) < 2) return t
  }
  return null
}
