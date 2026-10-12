// Floor is Hot Glue (survival). A craft table with a hot glue gun drifting overhead: it drips glue that spreads
// across the cutting mat. Step in it and you slow to a crawl and start to set: stay in too long and you are glued
// down for good (a friend can grab you and drag you out). Felt pads, big buttons and a cotton spool are safe
// islands, but from 20 s they melt into the glue one by one. Pom-poms roll across the table and bowl toys off.
// Tricks: squirt glue at a rival, bowl a pom-pom at someone, and (Normal spice and up) melt a rival's island.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { hopObstacles, nearestRival, skill, steerTo } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx } from '../engine/types'
import { blobShadow, feltTexture, flat, paint, r1, r2, rbox, soft, survivalTimeUp } from './kit'

/** Table half sizes, glue cell size and grid. */
const HX = 11
const HZ = 8
const CELL = 1
const GX = (HX * 2) / CELL
const GZ = (HZ * 2) / CELL
const STICKY = 0.45
const SET_RATE = 0.32
const DRIP_EVERY = 0.45
const DRIP_FALL = 0.55
const GUN_Y = 6.5
const MELT_WARN = 3
const MELT_SINK = 1.4
const POM_R = 0.7

type IslandKind = 'felt' | 'button' | 'spool'
interface Island {
  x: number
  z: number
  r: number
  h: number
  kind: IslandKind
  color: string
}

interface GlueState {
  /** Glue level per cell, 0..1 (synced as digits). */
  glue: Float32Array
  /** Round time each island began melting (-1 solid). */
  melt: number[]
  /** Set-meter per toy (1 = glued down). */
  stuck: number[]
  /** Sticky feet (glue squirt) until this time, per toy. */
  sticky: number[]
  /** Pom-poms rolling: [t0, x0, z0, dx, dz, speed, colour index]. */
  poms: number[][]
  nextMelt: number
  nextPom: number
  /** When the last islands began to shrink (-1 not yet). */
  shrinkAt: number
  // Host only.
  melted: boolean[]
  islands: Island[]
  colliders: ReturnType<LevelCtx['phys']['cylinder']>[]
  survive: number[]
  glueKey: string
  pomHit: Map<string, number>
  vis: {
    canvas: HTMLCanvasElement | null
    tex: THREE.CanvasTexture | null
    bump: THREE.CanvasTexture | null
    bumpCanvas: HTMLCanvasElement | null
    drawn: string
    islandMeshes: THREE.Object3D[]
    gun: THREE.Object3D | null
    drips: THREE.InstancedMesh | null
    pomMeshes: THREE.Mesh[]
    goo: THREE.InstancedMesh | null
    sizzle: number
  }
}

const POM_COLS = ['#f472b6', '#fbbf24', '#60a5fa', '#a78bfa', '#34d399', '#fb7185']

/* ---------------- Layout ---------------- */

function islands(ctx: LevelCtx): Island[] {
  // A jittered grid of crafts with hop-able gaps (2 to 3.5 m apart edge to edge).
  const out: Island[] = []
  const cols = 4, rows = 3
  const kinds: IslandKind[] = ['felt', 'button', 'felt', 'spool', 'button', 'felt', 'button', 'felt', 'spool', 'felt', 'button', 'felt']
  const feltCols = ['#f9a8d4', '#93c5fd', '#fde68a', '#86efac', '#c4b5fd', '#fdba74']
  const btnCols = ['#ef4444', '#14b8a6', '#f97316', '#8b5cf6']
  let k = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const kind = kinds[k++ % kinds.length]
      const x = (c - (cols - 1) / 2) * 5.2 + ctx.rng.range(-0.6, 0.6)
      const z = (r - (rows - 1) / 2) * 5 + ctx.rng.range(-0.5, 0.5)
      const rad = kind === 'spool' ? 1.05 : kind === 'button' ? ctx.rng.range(1.25, 1.5) : ctx.rng.range(1.3, 1.7)
      const h = kind === 'spool' ? 0.7 : kind === 'button' ? 0.42 : 0.3
      out.push({ x, z, r: rad, h, kind, color: kind === 'button' ? ctx.rng.pick(btnCols) : ctx.rng.pick(feltCols) })
    }
  }
  return out
}

function cellOf(x: number, z: number) {
  const ix = Math.floor((x + HX) / CELL), iz = Math.floor((z + HZ) / CELL)
  if (ix < 0 || iz < 0 || ix >= GX || iz >= GZ) return -1
  return iz * GX + ix
}

function cellCenter(i: number, out: { x: number; z: number }) {
  out.x = -HX + ((i % GX) + 0.5) * CELL
  out.z = -HZ + (Math.floor(i / GX) + 0.5) * CELL
  return out
}

/** The island a point is over (solid enough to stand on at time t), or -1. */
function islandAt(s: GlueState, x: number, z: number, pad: number, t: number) {
  for (let i = 0; i < s.islands.length; i++) {
    const il = s.islands[i]
    if (meltK(s, i, t) >= 0.5) continue
    if (Math.hypot(x - il.x, z - il.z) < rad(s, i, t) + pad) return i
  }
  return -1
}

/** 0 solid … 1 fully sunk into the glue. */
function meltK(s: GlueState, i: number, t: number) {
  const m = s.melt[i]
  if (m < 0) return 0
  return THREE.MathUtils.clamp((t - m - MELT_WARN) / MELT_SINK, 0, 1)
}

/** An island's radius at time t: the last few shrink once few are left. */
function rad(s: GlueState, i: number, t: number) {
  const r = s.islands[i].r
  return s.shrinkAt < 0 ? r : r * Math.max(0.45, 1 - (t - s.shrinkAt) / 45)
}

function islandTop(s: GlueState, i: number, t: number) {
  return s.islands[i].h * (1 - meltK(s, i, t)) - meltK(s, i, t) * 0.2
}

/** Glue covers cell i (and nothing solid stands over it). */
function gluey(s: GlueState, x: number, z: number, t: number) {
  const c = cellOf(x, z)
  if (c < 0 || s.glue[c] < STICKY) return false
  for (let i = 0; i < s.islands.length; i++) {
    const il = s.islands[i]
    if (Math.hypot(x - il.x, z - il.z) < rad(s, i, t) && meltK(s, i, t) < 0.6) return false
  }
  return true
}

/** Where the glue gun is at time t (pure function of time and seed). */
function gunAt(t: number, seed: number, out: { x: number; z: number }) {
  const ph = (seed % 89) * 0.21
  out.x = Math.sin(t * 0.23 + ph) * (HX - 1.5) * 0.92 + Math.sin(t * 0.61 + ph * 2) * 1.2
  out.z = Math.sin(t * 0.31 + ph * 1.7) * (HZ - 1.2) * 0.9
  return out
}

function dripRate(t: number) {
  return t < 5 ? 0 : t < 40 ? 1 : 1.6
}

/* ---------------- Visuals ---------------- */

function matTexture() {
  // A green self-healing cutting mat with a grid and ruler ticks.
  return paint(1024, 768, (g, w, h) => {
    g.fillStyle = '#2f7d5b'
    g.fillRect(0, 0, w, h)
    const step = w / (HX * 2)
    g.strokeStyle = 'rgba(220,255,235,0.28)'
    g.lineWidth = 1.5
    for (let x = 0; x <= w; x += step) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, h)
      g.stroke()
    }
    for (let y = 0; y <= h; y += step) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(w, y)
      g.stroke()
    }
    g.strokeStyle = 'rgba(220,255,235,0.5)'
    g.lineWidth = 3
    for (let x = 0; x <= w; x += step * 5) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, h)
      g.stroke()
    }
    // Ruler ticks round the edge.
    g.fillStyle = 'rgba(240,255,245,0.7)'
    for (let x = 0; x < w; x += step / 4) {
      const big = Math.abs((x / step) % 1) < 0.01
      g.fillRect(x, 0, 1.5, big ? 18 : 8)
      g.fillRect(x, h - (big ? 18 : 8), 1.5, big ? 18 : 8)
    }
    g.fillStyle = 'rgba(240,255,245,0.55)'
    g.font = '600 15px ui-rounded, system-ui, sans-serif'
    for (let i = 1; i < HX * 2; i++) g.fillText(String(i), i * step + 3, 34)
    // A few old craft stains.
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(${i % 2 ? '255,220,120' : '255,255,255'},0.05)`
      g.beginPath()
      g.arc(((i * 337) % w), ((i * 211) % h), 10 + (i % 5) * 9, 0, Math.PI * 2)
      g.fill()
    }
  })
}

function islandMesh(il: Island) {
  const g = new THREE.Group()
  if (il.kind === 'felt') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(il.r, il.r * 1.02, il.h, 28), soft(il.color, { map: feltTexture(il.color, 'rgba(255,255,255,0.15)', 'rgba(0,0,0,0.1)', [2, 1]) }))
    m.position.y = il.h / 2
    // Blanket stitch round the rim.
    const stitch = new THREE.Mesh(new THREE.TorusGeometry(il.r - 0.12, 0.025, 4, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff7ed' }))
    stitch.position.y = il.h + 0.005
    g.add(m, stitch)
  } else if (il.kind === 'button') {
    const mat = soft(il.color, { roughness: 0.35 })
    const m = new THREE.Mesh(new THREE.CylinderGeometry(il.r, il.r * 0.97, il.h, 32), mat)
    m.position.y = il.h / 2
    const rim = new THREE.Mesh(new THREE.TorusGeometry(il.r * 0.92, 0.1, 6, 32).rotateX(Math.PI / 2), mat)
    rim.position.y = il.h
    const hole = new THREE.CylinderGeometry(0.13, 0.13, 0.02, 12)
    const dark = new THREE.MeshBasicMaterial({ color: '#1f2937' })
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4
      const hm = new THREE.Mesh(hole, dark)
      hm.position.set(Math.sin(a) * 0.32, il.h + 0.005, Math.cos(a) * 0.32)
      g.add(hm)
    }
    g.add(m, rim)
  } else {
    // A cotton spool: thread wound between two wooden flanges.
    const wood = flat('#d6a76a')
    const thread = soft(il.color, {
      map: paint(16, 64, (gg, w, h) => {
        gg.fillStyle = il.color
        gg.fillRect(0, 0, w, h)
        gg.fillStyle = 'rgba(0,0,0,0.12)'
        for (let y = 0; y < h; y += 3) gg.fillRect(0, y, w, 1)
      }, [6, 1]),
    })
    const core = new THREE.Mesh(new THREE.CylinderGeometry(il.r * 0.82, il.r * 0.82, il.h - 0.16, 24), thread)
    core.position.y = il.h / 2
    const f1 = new THREE.Mesh(new THREE.CylinderGeometry(il.r, il.r, 0.08, 24), wood)
    f1.position.y = 0.04
    const f2 = f1.clone()
    f2.position.y = il.h - 0.04
    const holeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.01, 12), new THREE.MeshBasicMaterial({ color: '#3f2a14' }))
    holeTop.position.y = il.h + 0.005
    g.add(core, f1, f2, holeTop)
  }
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
    }
  })
  g.position.set(il.x, 0, il.z)
  return g
}

function gunMesh() {
  // A chunky hot glue gun pointing down at the table.
  const g = new THREE.Group()
  const body = soft('#22c55e', { roughness: 0.45 })
  const grey = soft('#475569', { roughness: 0.5 })
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 3.4, 18), body)
  barrel.rotation.z = Math.PI / 2
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), body)
  handle.position.set(-0.6, -1.3, 0)
  handle.rotation.z = 0.25
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.3), soft('#facc15'))
  trigger.position.set(0.3, -0.9, 0)
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.1, 14).rotateZ(Math.PI / 2), grey)
  nozzle.position.set(2.2, 0, 0)
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8).rotateZ(Math.PI / 2), soft('#b45309'))
  tip.position.set(2.9, 0, 0)
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 2.2, 14).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#fef9c3', roughness: 0.2, transparent: true, opacity: 0.75 }),
  )
  stick.position.set(-2.6, 0.1, 0)
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: '#f97316', toneMapped: false }))
  glow.position.set(-0.2, 0.75, 0.45)
  g.add(barrel, handle, trigger, nozzle, tip, stick, glow)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  // Point the nozzle down and slightly forward.
  const pivot = new THREE.Group()
  g.rotation.z = -Math.PI / 2 + 0.35
  g.position.set(-0.9, 2.6, 0)
  pivot.add(g)
  return pivot
}

function pomMesh(color: string) {
  const geo = new THREE.IcosahedronGeometry(POM_R, 2)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (((i * 2654435761) >>> 0) % 100) / 100 * 0.16
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
  }
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, soft(color, { map: feltTexture(color, 'rgba(255,255,255,0.2)', 'rgba(0,0,0,0.15)', [3, 3]), flatShading: true }))
  m.castShadow = true
  return m
}

function drawGlue(s: GlueState) {
  const v = s.vis
  if (!v.canvas || !v.bumpCanvas) return
  const g = v.bumpCanvas.getContext('2d')!
  const w = v.bumpCanvas.width, h = v.bumpCanvas.height
  const px = w / GX
  g.clearRect(0, 0, w, h)
  g.filter = 'blur(5px)'
  g.fillStyle = '#ffffff'
  const c = { x: 0, z: 0 }
  for (let i = 0; i < s.glue.length; i++) {
    const lv = s.glue[i]
    if (lv < 0.08) continue
    cellCenter(i, c)
    g.beginPath()
    g.arc(((c.x + HX) / (HX * 2)) * w, ((c.z + HZ) / (HZ * 2)) * h, px * (0.35 + 0.5 * lv), 0, Math.PI * 2)
    g.fill()
  }
  g.filter = 'none'
  // Threshold the blurred mask into glossy blobs: alpha for the colour map, the soft mask stays as the bump.
  const img = g.getImageData(0, 0, w, h)
  const out = v.canvas.getContext('2d')!
  const col = out.createImageData(w, h)
  const d = img.data, o = col.data
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    const k = Math.min(1, Math.max(0, (a - 0.3) / 0.2))
    // Honey-clear at the thin edges, creamier where it is thick.
    o[i] = 255
    o[i + 1] = 226 + Math.round(a * 24)
    o[i + 2] = 150 + Math.round(a * 75)
    o[i + 3] = Math.round(k * (130 + a * 85))
    // The bump map reads the red channel: write the soft mask there (opaque).
    d[i] = d[i + 1] = d[i + 2] = Math.round(a * 255)
    d[i + 3] = 255
  }
  out.putImageData(col, 0, 0)
  g.putImageData(img, 0, 0)
  if (v.tex) v.tex.needsUpdate = true
  if (v.bump) v.bump.needsUpdate = true
}

/* ---------------- Level ---------------- */

function glueKey(s: GlueState) {
  let k = ''
  for (let i = 0; i < s.glue.length; i++) k += Math.min(9, Math.round(s.glue[i] * 9))
  return k
}

function addGlue(s: GlueState, x: number, z: number, amount: number, t: number) {
  const c = cellOf(x, z)
  if (c < 0) return
  const add = (i: number, a: number) => {
    if (i < 0) return
    const cc = cellCenter(i, { x: 0, z: 0 })
    // Solid islands shed glue.
    for (let k = 0; k < s.islands.length; k++) {
      const il = s.islands[k]
      if (Math.hypot(cc.x - il.x, cc.z - il.z) < rad(s, k, t) - 0.1 && meltK(s, k, t) < 0.6) return
    }
    s.glue[i] = Math.min(1, s.glue[i] + a)
  }
  add(c, amount)
  const ix = c % GX, iz = Math.floor(c / GX)
  if (ix > 0) add(c - 1, amount * 0.5)
  if (ix < GX - 1) add(c + 1, amount * 0.5)
  if (iz > 0) add(c - GX, amount * 0.5)
  if (iz < GZ - 1) add(c + GX, amount * 0.5)
}

function launchPom(ctx: LevelCtx, s: GlueState, tx: number, tz: number, speed: number) {
  // From a table edge, rolling across through (tx, tz).
  const side = ctx.rng.int(0, 4)
  let x0: number, z0: number
  if (side === 0) {
    x0 = -HX - 1
    z0 = ctx.rng.range(-HZ + 1, HZ - 1)
  } else if (side === 1) {
    x0 = HX + 1
    z0 = ctx.rng.range(-HZ + 1, HZ - 1)
  } else if (side === 2) {
    z0 = -HZ - 1
    x0 = ctx.rng.range(-HX + 1, HX - 1)
  } else {
    z0 = HZ + 1
    x0 = ctx.rng.range(-HX + 1, HX - 1)
  }
  const dx = tx - x0, dz = tz - z0
  const d = Math.hypot(dx, dz) || 1
  s.poms.push([r1(ctx.time), r2(x0), r2(z0), r2(dx / d), r2(dz / d), speed, ctx.rng.int(0, POM_COLS.length)])
  if (s.poms.length > 6) s.poms.shift()
}

const _p = { x: 0, z: 0 }
const _m4 = new THREE.Matrix4()
const _v3 = new THREE.Vector3()

function pomPos(s: GlueState, p: number[], t: number, out: { x: number; z: number; y: number; live: boolean }) {
  const [t0, x0, z0, dx, dz, sp] = p
  const k = (t - t0) * sp
  out.x = x0 + dx * k
  out.z = z0 + dz * k
  out.live = t >= t0 && Math.abs(out.x) < HX + 2 && Math.abs(out.z) < HZ + 2
  // Ride over islands.
  let base = 0
  for (let i = 0; i < s.islands.length; i++) {
    const il = s.islands[i]
    if (Math.hypot(out.x - il.x, out.z - il.z) < rad(s, i, t)) base = Math.max(base, islandTop(s, i, t))
  }
  out.y = base + POM_R + Math.abs(Math.sin(k * 1.7)) * 0.25
  return out
}
const _pp = { x: 0, z: 0, y: 0, live: false }

export default defineLevel<GlueState>({
  id: 'hot-glue',
  name: 'Floor is Hot Glue',
  type: 'survival',
  blurb: 'Hop between crafts as hot glue spreads across the table and sticks anyone who touches it.',
  howTo: [
    'Glue slows you to a crawl, then sets: get out before your meter fills',
    'Hold Grab on a stuck friend and drag them out (they owe you)',
    'Felt pads, buttons and the spool are safe, until they melt one by one',
    'Pom-poms roll across: jump them or get bowled into the glue',
  ],
  accent: '#facc15',
  players: [2, 16],
  duration: 90,
  camera: { kind: 'chase', dist: 8, height: 0.8 },
  introOrbit: { radius: 15, height: 11 },
  sprinkles: { start: 2 },
  fallY: -4,
  sky: { color: '#2c1d12', fogNear: 50, fogFar: 130 },

  tricks: [
    {
      id: 'squirt',
      name: 'Glue Squirt',
      icon: 'drop',
      cost: 2,
      cooldown: 8,
      busy: 0.6,
      target: 'rival',
      range: 10,
      desc: 'Squirt hot glue at a rival: a puddle round their feet, or sticky feet (slow, weak jumps) for 3.5 s on an island.',
      counter: 'Keep hopping and get a friend to pull you out.',
      apply: (ctx, s, user, target) => {
        if (!target) return
        s.sticky[target.idx] = ctx.time + 3.5
        s.stuck[target.idx] = Math.min(0.8, s.stuck[target.idx] + 0.25)
        addGlue(s, target.pos.x, target.pos.z, 1, ctx.time)
        ctx.emit({ k: 'squirt', a: user.idx, b: target.idx })
        ctx.fx.sfx('splash', target.pos)
        ctx.fx.popup(target, 'Sticky!', '#fef08a')
      },
      botUse: (ctx, s, user) => {
        // Squirt someone who is about to jump between islands, or the toy beside us on a crowded island.
        const r = nearestRival(ctx, user, 7)
        if (!r || s.sticky[r.idx] > ctx.time) return false
        return r
      },
    },
    {
      id: 'pompom',
      name: 'Pom-pom Bowl',
      icon: 'ball',
      cost: 2,
      cooldown: 9,
      busy: 0.8,
      target: 'rival',
      desc: 'Roll a big pom-pom straight at a rival from the table edge.',
      counter: 'Step aside or jump it as it arrives.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        launchPom(ctx, s, target.pos.x, target.pos.z, 6.5)
        ctx.fx.sfx('whoosh', target.pos)
        ctx.fx.popup(target, 'Pom-pom!', '#f9a8d4')
      },
    },
    {
      id: 'melt',
      name: 'Melt Down',
      icon: 'zap',
      cost: 4,
      cooldown: 20,
      busy: 1,
      once: true,
      minSpice: 1,
      target: 'rival',
      desc: "Point the glue gun's heat at a rival's island: it starts melting now.",
      counter: 'Watch for the orange glow and hop to another island.',
      can: (ctx, s, user, target) => {
        if (!target) return 'Pick a rival'
        const i = islandAt(s, target.pos.x, target.pos.z, 0.2, ctx.time)
        if (i < 0) return 'They are not on an island'
        if (s.melt[i] >= 0) return 'It is already melting'
        if (i === islandAt(s, user.pos.x, user.pos.z, 0.2, ctx.time)) return 'That is your island too'
        if (s.melt.filter((m) => m >= 0 && ctx.time - m < MELT_WARN + MELT_SINK).length >= 2) return 'Two are already melting'
        return s.islands.filter((_il, k) => s.melt[k] < 0).length > 3 ? true : 'Too few islands left'
      },
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const i = islandAt(s, target.pos.x, target.pos.z, 0.2, ctx.time)
        if (i < 0 || s.melt[i] >= 0) return
        s.melt[i] = ctx.time
        s.nextMelt = Math.max(s.nextMelt, ctx.time + 6)
        ctx.fx.sfx('sizzle', target.pos)
        ctx.fx.popup(target, 'MELTING!', '#fb923c')
      },
      // Bots only melt a crowded island they are not on.
      botUse: (ctx, s, user) => {
        if (ctx.time < 25 || !ctx.rng.chance(0.3)) return false
        const mine = islandAt(s, user.pos.x, user.pos.z, 0.2, ctx.time)
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play') continue
          const i = islandAt(s, t.pos.x, t.pos.z, 0.2, ctx.time)
          if (i >= 0 && i !== mine) return t
        }
        return false
      },
    },
    bubbleWrap<GlueState>(2),
  ],

  build(ctx) {
    // The table stands in the attic, the floor far below.
    buildAttic(ctx.root, ctx.assets, null, { hw: 26, hd: 26, ridge: 24, knee: 7, y: -9, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    ctx.phys.box({ x: 0, y: -0.25, z: 0 }, { x: HX, y: 0.25, z: HZ }, { friction: 0.8 })
    const top = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 0.5, HZ * 2), [
      flat('#9a6a3e'), flat('#9a6a3e'), new THREE.MeshStandardMaterial({ map: matTexture(), roughness: 0.75 }), flat('#7c5130'), flat('#9a6a3e'), flat('#9a6a3e'),
    ])
    top.position.y = -0.25
    top.receiveShadow = true
    ctx.root.add(top)
    // Wooden rulers laid round the edge: a lip that stops sliding toys going over.
    const rulerTex = paint(512, 32, (g, w, h) => {
      g.fillStyle = '#e9c27a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#5b3a1a'
      for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1.5, x % 40 === 0 ? 14 : 7)
      g.font = '700 11px ui-rounded, system-ui, sans-serif'
      for (let x = 40, n = 1; x < w; x += 40, n++) g.fillText(String(n), x + 2, h - 6)
    }, [3, 1])
    const rulerMat = new THREE.MeshStandardMaterial({ map: rulerTex, roughness: 0.6 })
    const LIP = 0.55
    for (const [x, z, w, d] of [[0, -HZ - 0.2, HX * 2 + 0.8, 0.4], [0, HZ + 0.2, HX * 2 + 0.8, 0.4], [-HX - 0.2, 0, 0.4, HZ * 2], [HX + 0.2, 0, 0.4, HZ * 2]] as const) {
      const r = new THREE.Mesh(rbox(w, LIP, d, 0.06, 1), rulerMat)
      r.position.set(x, LIP / 2 - 0.02, z)
      r.castShadow = r.receiveShadow = true
      ctx.root.add(r)
      ctx.phys.box({ x, y: LIP, z }, { x: w / 2, y: LIP, z: d / 2 })
    }
    const apron = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 0.6, 0.9, HZ * 2 + 0.6), flat('#7c5130'))
    apron.position.y = -0.95
    ctx.root.add(apron)
    const legMat = flat('#6b4426')
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 8.6, 1), legMat)
        leg.position.set(sx * (HX - 0.8), -5.1, sz * (HZ - 0.8))
        leg.castShadow = true
        ctx.root.add(leg)
      }
    // Craft clutter round the edge (decor): crayons, a tin of buttons, the sewing basket, scissors on the floor.
    const crayon = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6).rotateZ(Math.PI / 2), flat('#ffffff'), 10)
    const tipGeo = new THREE.InstancedMesh(new THREE.ConeGeometry(0.14, 0.35, 6).rotateZ(-Math.PI / 2), flat('#ffffff'), 10)
    const col = new THREE.Color()
    const cols = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899', '#14b8a6', '#f43f5e', '#6366f1']
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3()
    for (let i = 0; i < 10; i++) {
      const a = ctx.rng.range(-0.25, 0.25) + (i % 2 ? Math.PI : 0)
      p.set(-HX - 1.6 - (i % 3) * 0.4, -9 + 0.14, -6 + i * 1.3)
      q.setFromAxisAngle(_v3.set(0, 1, 0), a)
      crayon.setMatrixAt(i, _m4.compose(p, q, sc))
      crayon.setColorAt(i, col.set(cols[i]))
      _v3.set(0.97, 0, 0).applyQuaternion(q)
      tipGeo.setMatrixAt(i, _m4.compose(p.clone().add(_v3), q, sc))
      tipGeo.setColorAt(i, col.set(cols[i]))
    }
    ctx.root.add(crayon, tipGeo)
    const tin = prop(ctx.assets, 'tin', 1.4, 'height')
    tin.position.set(HX - 1.6, 0, -HZ - 2.4)
    const basket = prop(ctx.assets, 'sewing', 5, 'max')
    basket.position.set(-HX - 4, -9, 3)
    const sc2 = prop(ctx.assets, 'scissors', 5, 'max')
    sc2.position.set(HX + 4, -9, -2)
    sc2.rotation.y = 0.6
    // A side shelf for the tin.
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 3), flat('#8a5a35'))
    shelf.position.set(HX - 1.6, -0.2, -HZ - 2.4)
    ctx.root.add(tin, basket, sc2, shelf)
  },

  init(ctx) {
    const isl = islands(ctx)
    const st: GlueState = {
      glue: new Float32Array(GX * GZ),
      melt: isl.map(() => -1),
      stuck: ctx.toys.map(() => 0),
      sticky: ctx.toys.map(() => 0),
      poms: [],
      nextMelt: 12,
      nextPom: 9,
      shrinkAt: -1,
      melted: isl.map(() => false),
      islands: isl,
      colliders: [],
      survive: ctx.toys.map(() => 0),
      glueKey: '',
      pomHit: new Map(),
      vis: { canvas: null, tex: null, bump: null, bumpCanvas: null, drawn: '', islandMeshes: [], gun: null, drips: null, pomMeshes: [], goo: null, sizzle: 0 },
    }
    for (const il of isl) {
      st.colliders.push(ctx.phys.cylinder({ x: il.x, y: il.h / 2, z: il.z }, il.h / 2, il.r, { friction: 0.8 }))
      const m = islandMesh(il)
      ctx.root.add(m)
      st.vis.islandMeshes.push(m)
    }
    // A couple of puddles to begin with (same on every screen: seeded).
    for (let k = 0; k < 5; k++) {
      const x = ctx.rng.range(-HX + 2, HX - 2), z = ctx.rng.range(-HZ + 2, HZ - 2)
      if (islandAt(st, x, z, 1.5, 0) >= 0) continue
      addGlue(st, x, z, 1, 0)
      addGlue(st, x + 0.8, z, 0.6, 0)
    }
    st.glueKey = glueKey(st)
    // The glue layer: a canvas drawn from the grid, glossy, with a soft bump at the edges.
    const canvas = document.createElement('canvas')
    canvas.width = GX * 12
    canvas.height = GZ * 12
    const bumpCanvas = document.createElement('canvas')
    bumpCanvas.width = canvas.width
    bumpCanvas.height = canvas.height
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const bump = new THREE.CanvasTexture(bumpCanvas)
    const glue = new THREE.Mesh(
      new THREE.PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.12, metalness: 0, bumpMap: bump, bumpScale: 6, depthWrite: false }),
    )
    glue.position.y = 0.025
    glue.receiveShadow = true
    glue.renderOrder = 1
    ctx.root.add(glue)
    Object.assign(st.vis, { canvas, bumpCanvas, tex, bump })
    drawGlue(st)
    st.vis.drawn = st.glueKey
    // Glue gun, drips, pom-poms, goo on stuck toys.
    const gun = gunMesh()
    ctx.root.add(gun)
    st.vis.gun = gun
    const drips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.1, emissive: '#f59e0b', emissiveIntensity: 0.25 }), 8)
    drips.count = 0
    ctx.root.add(drips)
    st.vis.drips = drips
    for (let i = 0; i < 6; i++) {
      const m = pomMesh(POM_COLS[i % POM_COLS.length])
      m.visible = false
      const sh = blobShadow(0.4)
      sh.scale.setScalar(POM_R * 1.1)
      sh.name = 'shadow'
      ctx.root.add(m, sh)
      m.userData.shadow = sh
      st.vis.pomMeshes.push(m)
    }
    const goo = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#fffbeb', roughness: 0.1, transparent: true, opacity: 0.85 }), 16)
    goo.count = 0
    ctx.root.add(goo)
    st.vis.goo = goo

    // Glue sticks: on the host for everyone, and predicted on a client for its own toy.
    ctx.hazards.add({
      predict: true,
      update(c, t) {
        // Melting islands sink (collider and mesh): every screen, from the synced melt times.
        st.islands.forEach((il, i) => {
          const k = meltK(st, i, t)
          const y = il.h / 2 - k * (il.h + 0.3)
          st.colliders[i].setTranslation({ x: il.x, y, z: il.z })
          if (st.shrinkAt >= 0) st.colliders[i].setRadius(rad(st, i, t))
        })
        void c
      },
      affect(c, toy, dt) {
        if (toy.status !== 'play' || c.phase !== 'play' || toy.mode !== 'walk') return
        const t = c.time
        const inGlue = toy.feet < 0.2 && toy.feet > -0.4 && gluey(st, toy.pos.x, toy.pos.z, t)
        const sticky = st.sticky[toy.idx] > t
        if (!inGlue && !sticky) return
        if (toy.grabbedBy) return
        const lv = toy.body.linvel()
        const max = inGlue ? (toy.stun > 0 ? 1.6 : 1.1) : 2.4
        const sp = Math.hypot(lv.x, lv.z)
        let vx = lv.x, vz = lv.z, vy = lv.y
        if (sp > max && (toy.stun <= 0 || inGlue) && toy.airT === 0) {
          vx *= max / sp
          vz *= max / sp
        }
        // Weak jumps out of glue.
        if (vy > 4 && toy.airT === 0) vy *= inGlue ? 0.62 : 0.8
        toy.body.setLinvel({ x: vx, y: vy, z: vz }, true)
        void dt
      },
    })
    return st
  },

  spawn(ctx, s, _toy, i, n) {
    // Spread over the islands, a few per island.
    const il = s.islands[i % s.islands.length]
    const k = Math.floor(i / s.islands.length)
    const a = k * 2.1 + i
    const rr = k === 0 ? 0 : il.r * 0.55
    void n
    return { x: il.x + Math.sin(a) * rr, y: il.h, z: il.z + Math.cos(a) * rr, yaw: ctx.rng.range(0, Math.PI * 2) }
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const active = ctx.active()
    const press = ctx.mode === 'show' ? Math.max(0, (t / 90 - 0.5) / 0.5) * (active.length > ctx.target ? 1 : 0.2) : 0
    // Drips from the gun: land DRIP_FALL seconds after leaving the nozzle.
    const rate = dripRate(t) * (1 + press)
    const prevN = Math.floor(((t - dt) * rate) / DRIP_EVERY), nowN = Math.floor((t * rate) / DRIP_EVERY)
    if (rate > 0 && nowN > prevN) {
      gunAt(t - DRIP_FALL, ctx.seed, _p)
      addGlue(s, _p.x, _p.z, 1, t)
      if (ctx.rng.chance(0.25)) ctx.fx.sfx('sizzle', { x: _p.x, y: 0, z: _p.z })
    }
    // Spread: thick glue creeps into its neighbours (faster later on).
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) {
      const k = (t < 30 ? 0.035 : t < 60 ? 0.06 : 0.1) * (1 + press)
      const g = s.glue
      const add = new Float32Array(g.length)
      for (let i = 0; i < g.length; i++) {
        if (g[i] < 0.75) continue
        const ix = i % GX, iz = Math.floor(i / GX)
        if (ix > 0) add[i - 1] += k
        if (ix < GX - 1) add[i + 1] += k
        if (iz > 0) add[i - GX] += k
        if (iz < GZ - 1) add[i + GX] += k
      }
      const c = { x: 0, z: 0 }
      for (let i = 0; i < g.length; i++) {
        if (!add[i]) continue
        cellCenter(i, c)
        let blocked = false
        for (let j = 0; j < s.islands.length; j++) {
          const il = s.islands[j]
          if (Math.hypot(c.x - il.x, c.z - il.z) < rad(s, j, t) - 0.1 && meltK(s, j, t) < 0.6) blocked = true
        }
        if (!blocked) g[i] = Math.min(1, g[i] + add[i] * ctx.rng.range(0.5, 1.5))
      }
    }
    // Islands melt one by one (never the last two).
    const solid = s.melt.filter((m) => m < 0).length
    if (t >= s.nextMelt && solid > 2) {
      s.nextMelt = t + Math.max(4.5, 8.5 - t * 0.035 - press * 3)
      // Prefer quiet islands early, busy ones later.
      const cands = s.islands.map((_il, i) => i).filter((i) => s.melt[i] < 0)
      const crowd = (i: number) => active.filter((a) => Math.hypot(a.pos.x - s.islands[i].x, a.pos.z - s.islands[i].z) < s.islands[i].r + 0.3).length
      cands.sort((a, b) => (t < 45 ? crowd(a) - crowd(b) : crowd(b) - crowd(a)) + ctx.rng.range(-0.8, 0.8))
      const i = cands[0]
      s.melt[i] = t
      ctx.fx.say('AN ISLAND IS MELTING!', '#fb923c', 1.4)
      ctx.fx.sfx('sizzle', { x: s.islands[i].x, y: 0.5, z: s.islands[i].z })
    }
    // Three left: they start to shrink.
    if (s.shrinkAt < 0 && s.melt.filter((m) => m < 0).length <= 3) {
      s.shrinkAt = t
      ctx.fx.say('THE LAST ISLANDS ARE SHRINKING!', '#fb923c', 1.6)
    }
    // Melted islands turn into glue.
    s.islands.forEach((il, i) => {
      if (s.melted[i] || s.melt[i] < 0 || meltK(s, i, t) < 1) return
      s.melted[i] = true
      for (let a = 0; a < 6; a++) addGlue(s, il.x + Math.sin(a) * il.r * 0.5, il.z + Math.cos(a) * il.r * 0.5, 1, t)
      addGlue(s, il.x, il.z, 1, t)
    })
    // Pom-poms.
    if (t >= s.nextPom) {
      s.nextPom = t + Math.max(2.2, ctx.rng.range(5, 8) - t * 0.04 - press * 2)
      const a = ctx.rng.pick(active.length ? active : ctx.toys)
      launchPom(ctx, s, a.pos.x + ctx.rng.range(-2, 2), a.pos.z + ctx.rng.range(-2, 2), ctx.rng.range(4, 6) + t * 0.015)
    }
    for (let pi = 0; pi < s.poms.length; pi++) {
      const pp = pomPos(s, s.poms[pi], t, _pp)
      if (!pp.live) continue
      const [, , , dx, dz] = s.poms[pi]
      for (const toy of active) {
        const ddx = toy.pos.x - pp.x, ddz = toy.pos.z - pp.z
        const d = Math.hypot(ddx, ddz)
        if (d > POM_R + 0.45 || toy.feet > pp.y + 0.3) continue
        const key = `${toy.idx}:${s.poms[pi][0]}:${s.poms[pi][1]}`
        if (s.pomHit.has(key)) continue
        s.pomHit.set(key, t)
        const side = (ddx * dz - ddz * dx) >= 0 ? 1 : -1
        ctx.knock(toy, { x: dx * 4.6 + dz * side * 1.6, y: 3.8, z: dz * 4.6 - dx * side * 1.6 }, 0.6)
        ctx.fx.sfx('boing', toy.pos)
        ctx.fx.puff(toy.pos, 'spark', 8)
      }
    }
    if (s.pomHit.size > 200) s.pomHit.clear()
    // The set meter: rises in glue, drains out of it; a friend's grab pulls you free fast.
    for (const toy of active) {
      // Hopping about in it doesn't help: glue strands hold anyone low over it. Only solid, clean ground drains it.
      const inGlue = toy.feet < 0.6 && gluey(s, toy.pos.x, toy.pos.z, t)
      let m = s.stuck[toy.idx]
      if (toy.grabbedBy) m -= 0.9 * dt
      else if (inGlue) m += SET_RATE * dt * (1 + press * 0.5)
      else if (toy.grounded) m -= 0.45 * dt
      s.stuck[toy.idx] = THREE.MathUtils.clamp(m, 0, 1)
      if (inGlue && ctx.rng.chance(dt * 1.2)) ctx.fx.sfx('sizzle', toy.pos)
      if (s.stuck[toy.idx] >= 1) {
        ctx.fx.puff(toy.pos, 'milk', 14)
        ctx.fx.sfx('slam', toy.pos)
        ctx.fail(toy, 'glued down')
        s.stuck[toy.idx] = 0
        if (ctx.mode !== 'show') s.sticky[toy.idx] = 0
      }
      // A Sprinkle for every 10 s still un-glued.
      s.survive[toy.idx] += dt
      if (s.survive[toy.idx] >= 10) {
        s.survive[toy.idx] -= 10
        ctx.addSprinkles(toy, 1)
      }
    }
    // Freed by a friend: the rescued toy's grudge points at nobody (no blame for help).
    for (const toy of active) if (toy.grabbedBy && s.stuck[toy.idx] > 0.2 && toy.grudge === toy.grabbedBy) toy.grudge = null
    s.glueKey = glueKey(s)
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const t = ctx.time
    const d = toy.data as { goal?: number; until?: number; help?: number; helpT?: number }
    const here = islandAt(s, toy.pos.x, toy.pos.z, 0.1, t)
    const crowdAt = (i: number) => ctx.toys.filter((o) => o !== toy && o.status === 'play' && Math.hypot(o.pos.x - s.islands[i].x, o.pos.z - s.islands[i].z) < s.islands[i].r + 0.4).length
    const score = (i: number) => {
      const il = s.islands[i]
      if (s.melt[i] >= 0) return -99
      const cap = Math.max(1, (rad(s, i, t) ** 2) / 0.45)
      return rad(s, i, t) * 1.2 - Math.max(0, crowdAt(i) - cap * 0.5) * 1.5 - Math.hypot(il.x - toy.pos.x, il.z - toy.pos.z) * 0.35 + (i === here ? 1.5 : 0)
    }
    if (d.goal === undefined || (d.until ?? 0) < t || s.melt[d.goal] >= 0) {
      let best = -1, bs = -1e9
      for (let i = 0; i < s.islands.length; i++) {
        const sc = score(i) + ctx.rng.range(-0.4, 0.4)
        if (sc > bs) {
          bs = sc
          best = i
        }
      }
      d.goal = best
      d.until = t + ctx.rng.range(1.5, 3.5)
    }
    // Help a stuck neighbour now and then (drag them onto our island).
    if (d.help !== undefined) {
      const f = ctx.toys[d.help]
      if (!f || f.status !== 'play' || !toy.holding || (d.helpT ?? 0) < t) {
        d.help = undefined
        toy.pad.grab = false
      } else {
        toy.pad.grab = true
        const il = s.islands[here >= 0 ? here : (d.goal ?? 0)]
        steerTo(toy, il.x, il.z, { pace: 0.5, stop: 0.2 })
        return
      }
    }
    if (here >= 0 && sk.aggression < 0.9) {
      for (const o of ctx.toys) {
        if (o === toy || o.status !== 'play' || s.stuck[o.idx] < 0.35 || o.grabbedBy) continue
        const dd = o.pos.distanceTo(toy.pos)
        if (dd < 1.3 && ctx.rng.chance(dt * 1.5)) {
          d.help = o.idx
          d.helpT = t + 1.4
          toy.yaw = Math.atan2(o.pos.x - toy.pos.x, o.pos.z - toy.pos.z)
          toy.pad.grab = true
          return
        }
      }
    }
    const goal = d.goal ?? 0
    const il = s.islands[goal]
    // Stay on the island (wander a little inside it), or head there.
    let gx = il.x, gz = il.z
    if (here === goal) {
      const a = toy.idx * 1.7 + t * 0.3
      gx += Math.sin(a) * rad(s, goal, t) * 0.35
      gz += Math.cos(a) * rad(s, goal, t) * 0.35
    }
    // Dodge pom-poms rolling at us.
    let dodgeX = 0, dodgeZ = 0
    for (const p of s.poms) {
      const pp = pomPos(s, p, t, _pp)
      if (!pp.live) continue
      const rx = toy.pos.x - pp.x, rz = toy.pos.z - pp.z
      const ahead = rx * p[3] + rz * p[4]
      const side = rx * p[4] - rz * p[3]
      if (ahead > 0 && ahead < 4.5 && Math.abs(side) < 1.6) {
        const s2 = side >= 0 ? 1 : -1
        dodgeX += p[4] * s2 * 1.5
        dodgeZ += -p[3] * s2 * 1.5
        if (ahead < 1.8 && toy.grounded && ctx.rng.chance(sk.accuracy * 0.5)) toy.pad.jump = true
      }
    }
    steerTo(toy, gx + dodgeX, gz + dodgeZ, { pace: sk.pace, stop: here === goal ? 0.25 : 0.1 })
    // Jump onto islands and over glue gaps.
    hopObstacles(ctx, toy)
    const sp = Math.hypot(toy.pad.mx, toy.pad.mz)
    if (toy.grounded && sp > 0.3 && here !== goal) {
      const ax = toy.pos.x + (toy.pad.mx / sp) * 0.9, az = toy.pos.z + (toy.pad.mz / sp) * 0.9
      const edge = here >= 0 && islandAt(s, ax, az, 0, t) !== here
      if ((edge && gluey(s, ax, az, t)) || (here < 0 && s.stuck[toy.idx] > 0.1)) toy.pad.jump = true
    }
    // Crowded island: shove someone off.
    if (here >= 0 && crowdAt(here) > 2) {
      const r = nearestRival(ctx, toy, 1.3)
      if (r && ctx.rng.chance(sk.aggression * 2 * dt)) {
        toy.pad.mx = r.pos.x - toy.pos.x
        toy.pad.mz = r.pos.z - toy.pos.z
        toy.pad.shove = true
      }
    }
  },

  rank(ctx, s) {
    return ctx.active().sort((a, b) => s.stuck[a.idx] - s.stuck[b.idx])
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'least stuck', "stuck in the glue at the bell")
  },

  retry(ctx, s, toy) {
    // Quick Play: back onto the biggest solid island.
    let best = 0
    s.islands.forEach((il, i) => {
      if (s.melt[i] === -1 && il.r > s.islands[best].r) best = i
    })
    const il = s.islands[best]
    s.stuck[toy.idx] = 0
    ctx.respawn(toy, { x: il.x, y: il.h, z: il.z, yaw: 0 }, 1)
  },

  onFall(ctx, s, toy) {
    s.stuck[toy.idx] = 0
    ctx.fail(toy, 'fell off the table')
  },

  pack(_c, s) {
    return [s.glueKey, s.melt.map(r1), s.stuck.map(r1), s.sticky.map(r1), s.poms, r1(s.shrinkAt)]
  },

  unpack(_c, s, d) {
    const [key, melt, stuck, sticky, poms, shrinkAt] = d as [string, number[], number[], number[], number[][], number]
    if (key !== s.glueKey) {
      s.glueKey = key
      for (let i = 0; i < s.glue.length && i < key.length; i++) s.glue[i] = Number(key[i]) / 9
    }
    s.melt = melt
    s.stuck = stuck
    s.sticky = sticky
    s.poms = poms
    s.shrinkAt = shrinkAt
  },

  onEvent(ctx, _s, data) {
    const e = data as { k?: string; a?: number; b?: number }
    if (e.k !== 'squirt') return
    const b = ctx.toys[e.b ?? -1]
    if (b) ctx.fxLocal.puff({ x: b.pos.x, y: b.feet + 0.2, z: b.pos.z }, 'milk', 12)
  },

  visual(ctx, s, dt) {
    const t = Math.max(0, ctx.time)
    const v = s.vis
    if (v.drawn !== s.glueKey) {
      v.drawn = s.glueKey
      drawGlue(s)
    }
    // The gun drifts overhead and bobs as it squeezes out drips.
    if (v.gun) {
      gunAt(t, ctx.seed, _p)
      const lead = gunAt(t + 0.3, ctx.seed, { x: 0, z: 0 })
      v.gun.position.set(_p.x, GUN_Y - 2.6 + Math.sin(t * 6) * 0.08, _p.z)
      v.gun.rotation.y = Math.atan2(lead.x - _p.x, lead.z - _p.z) - Math.PI / 2
    }
    // Falling drips (pure function of time).
    if (v.drips) {
      const rate = dripRate(t)
      let n = 0
      if (rate > 0 && ctx.phase === 'play') {
        const now = (t * rate) / DRIP_EVERY
        for (let k = Math.floor(now); k > now - 3 && n < 8; k--) {
          const t0 = (k * DRIP_EVERY) / rate
          const age = t - t0
          if (age < 0 || age > DRIP_FALL) continue
          gunAt(t0, ctx.seed, _p)
          const y = GUN_Y - 0.4 - (age / DRIP_FALL) ** 2 * (GUN_Y - 0.4)
          _m4.makeScale(1, 1.4, 1).setPosition(_p.x, y, _p.z)
          v.drips.setMatrixAt(n++, _m4)
        }
      }
      v.drips.count = n
      v.drips.instanceMatrix.needsUpdate = true
    }
    // Islands: glow, wobble and sink as they melt.
    v.islandMeshes.forEach((m, i) => {
      const il = s.islands[i]
      const melting = s.melt[i] >= 0
      const k = meltK(s, i, t)
      const warn = melting && k <= 0
      m.position.y = -k * (il.h + 0.3)
      m.visible = k < 1
      const w = warn ? Math.sin(t * 30) * 0.03 * (1 + (t - s.melt[i])) : 0
      m.position.x = il.x + w
      const rs = rad(s, i, t) / il.r
      m.scale.set(rs * (1 + k * 0.25), 1 - k * 0.5, rs * (1 + k * 0.25))
      m.traverse((o) => {
        const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
        if (mm && 'emissive' in mm && mm.emissive) {
          mm.emissive.set(melting ? '#f97316' : '#000000')
          mm.emissiveIntensity = melting ? 0.25 + 0.25 * Math.sin(t * 12) : 0
        }
      })
      if (melting && k < 1 && Math.random() < dt * 6) ctx.fxLocal.puff({ x: il.x + (Math.random() - 0.5) * il.r, y: il.h * (1 - k) + 0.2, z: il.z + (Math.random() - 0.5) * il.r }, 'dust', 2)
    })
    // Pom-poms.
    v.pomMeshes.forEach((m, i) => {
      const p = s.poms[s.poms.length - 1 - i]
      const sh = m.userData.shadow as THREE.Mesh
      if (!p || ctx.phase !== 'play') {
        m.visible = sh.visible = false
        return
      }
      const pp = pomPos(s, p, t, _pp)
      m.visible = sh.visible = pp.live
      if (!pp.live) return
      ;(m.material as THREE.MeshStandardMaterial).color.set(POM_COLS[p[6] % POM_COLS.length])
      m.position.set(pp.x, pp.y, pp.z)
      m.rotation.x = (t - p[0]) * p[5] * p[4] / POM_R
      m.rotation.z = -(t - p[0]) * p[5] * p[3] / POM_R
      sh.position.set(pp.x, 0.04 + (pp.y - POM_R - Math.abs(Math.sin((t - p[0]) * p[5] * 1.7)) * 0.25), pp.z)
    })
    // Goo round stuck toys' feet.
    if (v.goo) {
      let n = 0
      for (const toy of ctx.toys) {
        const m = s.stuck[toy.idx] ?? 0
        if (toy.status !== 'play' || m < 0.05 || n >= 16) continue
        const sc = 0.6 + m * 0.9
        _m4.makeScale(sc, 0.5 + m * 1.4, sc).setPosition(toy.pos.x, toy.feet, toy.pos.z)
        v.goo.setMatrixAt(n++, _m4)
      }
      v.goo.count = n
      v.goo.instanceMatrix.needsUpdate = true
    }
    // Local sizzle when I am stuck.
    v.sizzle -= dt
    const me = ctx.me
    if (me && me.status === 'play' && (s.stuck[me.idx] ?? 0) > 0.1 && v.sizzle <= 0) {
      v.sizzle = 0.5
      ctx.fxLocal.sfx('sizzle', me.pos)
    }
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const solid = s.melt.filter((m) => m === -1).length
    const chips = [`${solid} island${solid === 1 ? '' : 's'} left`]
    let glued = 0
    for (let i = 0; i < s.glue.length; i++) if (s.glue[i] >= STICKY) glued++
    chips.push(`Glue ${Math.round((glued / s.glue.length) * 100)}%`)
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    const bars: { label: string; value: number; color: string; danger?: boolean }[] = []
    if (me && me.status === 'play') {
      const m = s.stuck[me.idx] ?? 0
      bars.push({ label: 'Setting', value: m, color: '#fde68a', danger: m > 0.6 })
      if (m > 0.05) {
        status = { text: m > 0.6 ? 'ALMOST GLUED!' : 'STUCK IN GLUE', color: '#fde047', pulse: m > 0.6 }
        prompt = 'Jump towards an island! A friend can hold Grab on you and drag you out.'
      } else if (s.sticky[me.idx] > t) prompt = 'Sticky feet! Short hops only for a moment.'
      else {
        const i = islandAt(s, me.pos.x, me.pos.z, 0.1, t)
        if (i >= 0 && s.melt[i] >= 0) {
          status = { text: 'YOUR ISLAND IS MELTING', color: '#fb923c', pulse: true }
          prompt = 'Hop to another island!'
        } else if (t < 6) prompt = 'Stay on the crafts. Glue sticks, then sets!'
      }
    }
    return { chips, prompt, status, bars }
  },
})

