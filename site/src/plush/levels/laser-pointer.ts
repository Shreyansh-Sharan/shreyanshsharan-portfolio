// Laser Pointer Pounce (survival). Toys stand on a long, sunny windowsill. Outside the open window sits a giant
// cat, and someone is playing with a laser pointer: a red dot dances over the sill, and wherever it stops the
// cat's paw slams down. The paw's shadow grows where it will land (the tell). Anyone under it is pounced; anyone
// near is bowled away, maybe off the sill. Curtains billow in now and then and hide whoever is behind them.
// From 30 s a second dot (and the other paw) joins; from 55 s the dot starts faking: it settles, then darts
// off and the paw lands there instead. Tricks: grab the laser (aim the next pounce at a rival) and drop a
// curtain on someone (they are tangled up for 2 seconds, in the open).
import * as THREE from 'three'
import { skill, steerTo } from '../engine/bots'
import { textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { blobShadow, feltTexture, flat, paint, r1, r2, rbox, soft, warnRing, survivalTimeUp } from './kit'

/** The sill: x half length, z half depth (front edge at -HZ, window at +HZ). */
const HX = 11
const HZ = 3.2
const R_HIT = 1.55
const R_KNOCK = 3.2
const SECOND_AT = 30
const FAKE_AT = 48
const CURTAINS = [-7.2, 0, 7.2]
const CURTAIN_W = 3.6
const CAT_Z = HZ + 5.2
/** Window opening height. */
const WIN = 9
/** Paw phases: 0 dot moving, 1 tell (shadow grows), 2 slam and lift. */
type Ph = 0 | 1 | 2

interface Paw {
  on: number
  ph: Ph
  t0: number
  dur: number
  ax: number
  az: number
  bx: number
  bz: number
  /** This tell will dart away (a fake-out). */
  fake: number
  /** The dot was aimed by a player's laser trick. */
  aimed: number
}

interface LaserState {
  paws: Paw[]
  /** Tangled in a curtain until (per toy). */
  tangle: number[]
  // Host only.
  survive: number[]
  hitDone: number[]
  vis: {
    dots: THREE.Object3D[]
    shadows: THREE.Mesh[]
    rings: THREE.Mesh[]
    paws: { arm: THREE.Mesh; paw: THREE.Group; y: number }[]
    eyes: THREE.Object3D[]
    curtains: { g: THREE.Group; mat: THREE.MeshStandardMaterial }[]
    beams: THREE.Line[]
    wraps: THREE.Mesh[]
    tail: THREE.Object3D | null
    slammed: number[]
  }
}

/* ---------------- Rules ---------------- */

/** How far curtain i is billowed in over the sill at time t, 0 (open) .. 1 (closed). Pure function of time. */
function curtainK(i: number, t: number, seed: number) {
  const P = 12
  const ph = (((t + i * 4.1 + (seed % 7)) % P) + P) % P
  if (t <= 4) return 0
  if (ph < 0.6) return ph / 0.6
  if (ph < 3.6) return 1
  if (ph < 4.2) return 1 - (ph - 3.6) / 0.6
  return 0
}

/** Is a toy hidden behind a closed curtain? */
function hidden(x: number, z: number, t: number, seed: number) {
  if (z < HZ - 2.3) return false
  for (let i = 0; i < CURTAINS.length; i++) if (Math.abs(x - CURTAINS[i]) < CURTAIN_W / 2 && curtainK(i, t, seed) > 0.7) return true
  return false
}

/** Where a paw's dot is now. */
function dotAt(p: Paw, t: number, out: { x: number; z: number }) {
  if (p.ph === 0) {
    const k = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp((t - p.t0) / Math.max(0.05, p.dur), 0, 1), 0, 1)
    out.x = p.ax + (p.bx - p.ax) * k
    out.z = p.az + (p.bz - p.az) * k
  } else {
    out.x = p.bx
    out.z = p.bz
  }
  return out
}

function tellTime(t: number, press: number) {
  return Math.max(0.55, 1 - t * 0.0045 - press * 0.2)
}

function clampSill(x: number, z: number, out: { x: number; z: number }) {
  out.x = THREE.MathUtils.clamp(x, -HX + 0.8, HX - 0.8)
  out.z = THREE.MathUtils.clamp(z, -HZ + 0.6, HZ - 0.6)
  return out
}

const _d = { x: 0, z: 0 }
const _e = { x: 0, z: 0 }

/** Pick the next stop: near a toy (busy spots more often), never under a closed curtain for long. */
function pickStop(ctx: LevelCtx, s: LaserState, i: number, out: { x: number; z: number }) {
  const act = ctx.active()
  if (!act.length) return clampSill(ctx.rng.range(-HX, HX), ctx.rng.range(-HZ, HZ), out)
  // Each paw prefers its own half of the sill when both are out.
  const both = s.paws[1].on
  let pool = act
  if (both) {
    const side = act.filter((t) => (i === 0 ? t.pos.x < 2 : t.pos.x > -2))
    if (side.length) pool = side
  }
  let best = pool[0], bs = -1e9
  for (const t of pool) {
    let crowd = 0
    for (const o of act) if (o !== t && o.pos.distanceTo(t.pos) < 2.5) crowd++
    const sc = crowd * 1.2 + ctx.rng.range(0, 2.5) - (hidden(t.pos.x, t.pos.z, ctx.time, ctx.seed) ? 3 : 0)
    if (sc > bs) {
      bs = sc
      best = t
    }
  }
  const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(0, 1.1)
  return clampSill(best.pos.x + Math.cos(a) * r + best.vel.x * 0.25, best.pos.z + Math.sin(a) * r + best.vel.z * 0.25, out)
}

function startMove(ctx: LevelCtx, s: LaserState, i: number, to: { x: number; z: number }, dur: number) {
  const p = s.paws[i]
  dotAt(p, ctx.time, _d)
  p.ph = 0
  p.t0 = ctx.time
  p.dur = dur
  p.ax = r2(_d.x)
  p.az = r2(_d.z)
  p.bx = r2(to.x)
  p.bz = r2(to.z)
}

/* ---------------- Visuals ---------------- */

function sunTexture() {
  // Sunlight through the window: bright panes with soft mullion shadows.
  return paint(512, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    const cols = 6
    for (let i = 0; i < cols; i++) {
      const x0 = (i / cols) * w + 10, x1 = ((i + 1) / cols) * w - 10
      const gr = g.createLinearGradient(0, 0, 0, h)
      gr.addColorStop(0, 'rgba(255,226,150,0.32)')
      gr.addColorStop(1, 'rgba(255,226,150,0.04)')
      g.fillStyle = gr
      g.beginPath()
      g.moveTo(x0 + 30, 0)
      g.lineTo(x1 + 30, 0)
      g.lineTo(x1, h)
      g.lineTo(x0, h)
      g.fill()
    }
  })
}

function catMesh(ctx: LevelCtx) {
  // A huge ginger tabby sitting just outside the window, peering in.
  const g = new THREE.Group()
  const fur = soft('#f59e0b', {
    map: paint(256, 256, (c, w, h) => {
      c.fillStyle = '#f59e0b'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#c2410c'
      for (let y = 10; y < h; y += 34) {
        c.beginPath()
        c.ellipse(w / 2, y, w * 0.6, 7, 0, 0, Math.PI * 2)
        c.fill()
      }
      for (let i = 0; i < 2000; i++) {
        c.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
        c.fillRect((i * 37) % w, (i * 73) % h, 2, 3)
      }
    }),
  })
  const cream = soft('#fde7c3')
  // Mostly hidden below the window: the head peeks in over the sill line.
  const body = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), fur)
  body.scale.set(1.2, 1, 0.9)
  body.position.set(0, -3.5, CAT_Z + 3)
  const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 16), fur)
  head.scale.set(1.15, 0.95, 0.9)
  head.position.set(0, 4.6, CAT_Z)
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 10), cream)
  muzzle.scale.set(1.3, 0.85, 0.8)
  muzzle.position.set(0, 3.6, CAT_Z - 2.3)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), soft('#f472b6'))
  nose.scale.set(1.3, 0.8, 0.8)
  nose.position.set(0, 4.15, CAT_Z - 3.25)
  g.add(body, head, muzzle, nose)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.4, 4), fur)
    ear.position.set(s * 2.2, 7.4, CAT_Z)
    ear.rotation.set(0, Math.PI / 4, s * -0.35)
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.5, 4), soft('#fbcfe8'))
    inner.position.set(s * 2.15, 7.25, CAT_Z - 0.6)
    inner.rotation.set(0, Math.PI / 4, s * -0.35)
    g.add(ear, inner)
    for (let k = 0; k < 3; k++) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 4), soft('#ffffff'))
      wh.rotation.z = Math.PI / 2 + s * (k - 1) * 0.15
      wh.position.set(s * 2.7, 3.75 - k * 0.3, CAT_Z - 2.7)
      g.add(wh)
    }
  }
  // Eyes that follow the dots.
  const eyes: THREE.Object3D[] = []
  for (const s of [-1, 1]) {
    const eye = new THREE.Group()
    eye.position.set(s * 1.35, 5.3, CAT_Z - 2.25)
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.82, 16, 12), soft('#d9f99d', { roughness: 0.25 }))
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: '#111827' }))
    pupil.scale.set(0.35, 1.25, 0.5)
    pupil.position.z = -0.58
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    glint.position.set(0.2, 0.28, -0.75)
    eye.add(ball, pupil, glint)
    g.add(eye)
    eyes.push(eye)
  }
  // A tail swishing behind.
  const tail = new THREE.Mesh(new THREE.TorusGeometry(4, 0.8, 8, 20, Math.PI), fur)
  tail.position.set(5.5, 1.5, CAT_Z + 5)
  tail.rotation.y = 0.6
  g.add(tail)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = false))
  ctx.root.add(g)
  return { eyes, tail }
}

function pawMesh() {
  const g = new THREE.Group()
  const fur = soft('#fb923c')
  const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), fur)
  pad.scale.set(1.25, 0.6, 1.4)
  g.add(pad)
  const bean = soft('#f9a8d4', { roughness: 0.5 })
  const big = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 6), bean)
  big.scale.set(1.3, 0.4, 1)
  big.position.set(0, -0.48, 0.25)
  g.add(big)
  for (let k = 0; k < 4; k++) {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), fur)
    const a = (k - 1.5) * 0.42
    toe.position.set(Math.sin(a) * 1.05, 0.05, -Math.cos(a) * 1.05 + 0.15)
    const tb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), bean)
    tb.scale.set(1, 0.5, 1)
    tb.position.set(Math.sin(a) * 1.05, -0.32, -Math.cos(a) * 1.05 + 0.15)
    g.add(toe, tb)
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

function curtainMesh(color: string, x: number) {
  const g = new THREE.Group()
  // Folded fabric: a strip with sine folds, hung from the rod.
  const geo = new THREE.PlaneGeometry(CURTAIN_W, 8.2, 18, 6)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 4.2) * 0.18)
  geo.computeVertexNormals()
  geo.translate(0, -4.1, 0)
  const mat = new THREE.MeshStandardMaterial({ map: feltTexture(color, 'rgba(255,255,255,0.18)', 'rgba(0,0,0,0.08)', [2, 3]), side: THREE.DoubleSide, roughness: 0.95, transparent: true })
  const m = new THREE.Mesh(geo, mat)
  m.castShadow = true
  g.add(m)
  g.position.set(x, 8.6, HZ - 0.2)
  return { g, mat }
}

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _look = new THREE.Vector3()

export default defineLevel<LaserState>({
  id: 'laser-pointer',
  name: 'Laser Pointer Pounce',
  type: 'survival',
  blurb: 'A red dot dances across the sill and a cat paw slams down wherever it stops.',
  howTo: [
    'Watch the dot, not the paw: where it stops, the paw comes down',
    'A growing shadow shows where it will land: get out from under it',
    'Billowing curtains hide you from the cat for a moment',
    'A second dot joins at 30 s; from 55 s the dot starts faking',
  ],
  accent: '#ef4444',
  players: [2, 16],
  duration: 90,
  canBeFinal: true,
  camera: { kind: 'chase', dist: 8 },
  introOrbit: { radius: 13, height: 8, center: [0, 2, 0] },
  sprinkles: { start: 2 },
  fallY: -6,
  sky: { color: '#a9d8ff', fogNear: 70, fogFar: 180 },

  tricks: [
    {
      id: 'laser',
      name: 'Grab the Laser',
      icon: 'target',
      cost: 3,
      cooldown: 14,
      busy: 1.2,
      target: 'rival',
      desc: 'Point the laser at a rival: the nearest dot zips straight to them and the paw follows.',
      counter: 'When the dot lands on you, run the moment the shadow appears.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        let best = 0, bd = Infinity
        s.paws.forEach((p, i) => {
          if (!p.on) return
          dotAt(p, ctx.time, _d)
          const d = Math.hypot(_d.x - target.pos.x, _d.z - target.pos.z)
          if (d < bd && p.ph !== 2) {
            bd = d
            best = i
          }
        })
        const p = s.paws[best]
        if (p.ph === 2) return
        startMove(ctx, s, best, clampSill(target.pos.x, target.pos.z, _e), 0.55)
        p.fake = 0
        p.aimed = 1
        ctx.fx.popup(target, 'Red dot on you!', '#f87171')
        ctx.fx.sfx('zap', target.pos)
      },
      botUse: (ctx, _s, user) => {
        // Aim at a crowd we are not in.
        let best: Toy | null = null, bc = 1
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play' || t.pos.distanceTo(user.pos) < 4 || hidden(t.pos.x, t.pos.z, ctx.time, ctx.seed)) continue
          let c = 0
          for (const o of ctx.toys) if (o.status === 'play' && o.pos.distanceTo(t.pos) < 2) c++
          if (c > bc) {
            bc = c
            best = t
          }
        }
        return best ?? false
      },
    },
    {
      id: 'curtain',
      name: 'Curtain Drop',
      icon: 'wind',
      cost: 2,
      cooldown: 10,
      busy: 0.6,
      target: 'rival',
      desc: 'Yank a curtain loose onto a rival: tangled up for 2 seconds, and in plain sight of the cat.',
      counter: 'Bubble Wrap, or keep out of the open when the shadow comes.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.tangle[target.idx] = ctx.time + 2
        target.frozen = true
        ctx.fx.sfx('whoosh', target.pos)
        ctx.fx.puff(target.pos, 'dust', 10)
        ctx.fx.popup(target, 'Tangled!', '#fde68a')
      },
      botUse: (ctx, s, user) => {
        // Tangle someone standing near a growing shadow.
        for (const p of s.paws) {
          if (!p.on || p.ph !== 1) continue
          for (const t of ctx.toys) {
            if (t === user || t.status !== 'play' || s.tangle[t.idx] > ctx.time) continue
            if (Math.hypot(t.pos.x - p.bx, t.pos.z - p.bz) < R_HIT + 1.2) return t
          }
        }
        return false
      },
    },
    bubbleWrap<LaserState>(2),
  ],

  build(ctx) {
    // The sill, the wall under it, the room floor far below and the window round it.
    ctx.phys.box({ x: 0, y: -0.3, z: 0 }, { x: HX, y: 0.3, z: HZ }, { friction: 0.8 })
    const wood = new THREE.MeshStandardMaterial({
      map: paint(512, 128, (g, w, h) => {
        g.fillStyle = '#eadcc2'
        g.fillRect(0, 0, w, h)
        g.strokeStyle = 'rgba(160,140,110,0.25)'
        for (let y = 6; y < h; y += 12) {
          g.beginPath()
          g.moveTo(0, y)
          for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 2)
          g.stroke()
        }
      }),
      roughness: 0.55,
    })
    const sill = new THREE.Mesh(rbox(HX * 2 + 0.4, 0.6, HZ * 2 + 0.3, 0.12, 2), wood)
    sill.position.set(0, -0.3, 0)
    sill.receiveShadow = true
    ctx.root.add(sill)
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(HX * 2, HZ * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: sunTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    )
    sun.position.set(0, 0.012, 0)
    sun.renderOrder = 1
    ctx.root.add(sun)
    const paper = new THREE.MeshStandardMaterial({
      map: paint(128, 128, (g, w, h) => {
        g.fillStyle = '#e9d5b7'
        g.fillRect(0, 0, w, h)
        g.fillStyle = '#d6bf9c'
        for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 6, h)
      }, [10, 4]),
      roughness: 0.95,
    })
    const under = new THREE.Mesh(new THREE.PlaneGeometry(50, 11), paper)
    under.position.set(0, -5.8, HZ + 0.1)
    under.rotation.y = Math.PI
    ctx.root.add(under)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2), flat('#8a5a35'))
    floor.position.set(0, -11, -10)
    floor.receiveShadow = true
    ctx.root.add(floor)
    // A radiator under the sill.
    const rad = new THREE.Group()
    for (let i = 0; i < 14; i++) {
      const fin = new THREE.Mesh(rbox(0.5, 3, 0.5, 0.2, 1), flat('#e5e7eb'))
      fin.position.set(-4 + i * 0.62, -7.5, HZ - 0.5)
      rad.add(fin)
    }
    ctx.root.add(rad)
    // The window: a wall with a big opening, a frame, glass on the outer panes, a curtain rod.
    const wall = new THREE.Shape()
    wall.moveTo(-30, 0)
    wall.lineTo(30, 0)
    wall.lineTo(30, 18)
    wall.lineTo(-30, 18)
    wall.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-HX, 0.01)
    hole.lineTo(HX, 0.01)
    hole.lineTo(HX, WIN)
    hole.lineTo(-HX, WIN)
    hole.closePath()
    wall.holes.push(hole)
    const wallMesh = new THREE.Mesh(new THREE.ShapeGeometry(wall), paper)
    wallMesh.position.set(0, 0, HZ + 0.3)
    wallMesh.rotation.y = Math.PI
    ctx.root.add(wallMesh)
    const frame = flat('#ffffff', { roughness: 0.4 })
    for (const x of [-HX, -HX / 3, HX / 3, HX]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, WIN + 0.1, 0.4), frame)
      post.position.set(x, WIN / 2, HZ + 0.2)
      ctx.root.add(post)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 0.4, 0.4, 0.45), frame)
    lintel.position.set(0, WIN + 0.1, HZ + 0.2)
    ctx.root.add(lintel)
    const glass = new THREE.MeshStandardMaterial({ color: '#dbeafe', transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false })
    for (const x of [-HX * 2 / 3, HX * 2 / 3]) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 / 3 - 0.3, WIN - 0.3), glass)
      pane.position.set(x, WIN / 2, HZ + 0.2)
      ctx.root.add(pane)
      const bar = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 / 3, 0.14, 0.2), frame)
      bar.position.set(x, WIN / 2, HZ + 0.15)
      ctx.root.add(bar)
    }
    // Toys can't leave through the window or the ends.
    ctx.phys.box({ x: 0, y: 4, z: HZ + 0.6 }, { x: HX + 1, y: 4, z: 0.4 })
    for (const sx of [-1, 1]) ctx.phys.box({ x: sx * (HX + 0.4), y: 4, z: 0 }, { x: 0.4, y: 4, z: HZ + 1 })
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, HX * 2 + 2, 8).rotateZ(Math.PI / 2), flat('#a16207', { metalness: 0.5 }))
    rod.position.set(0, 8.7, HZ - 0.2)
    ctx.root.add(rod)
    // Pot plants at the ends of the sill.
    for (const x of [-HX + 1.4, HX - 1.4]) {
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.75, 0), new THREE.Vector2(0.95, 1.1), new THREE.Vector2(1.05, 1.15), new THREE.Vector2(1.05, 1.35), new THREE.Vector2(0, 1.35)]
      const pot = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), flat('#c2410c'))
      pot.position.set(x, 0, HZ - 1.3)
      pot.castShadow = true
      ctx.root.add(pot)
      for (let k = 0; k < 7; k++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), flat('#16a34a'))
        leaf.scale.set(0.5, 1.4, 0.25)
        const a = (k / 7) * Math.PI * 2
        leaf.position.set(x + Math.sin(a) * 0.45, 2 + (k % 3) * 0.3, HZ - 1.3 + Math.cos(a) * 0.45)
        leaf.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5)
        ctx.root.add(leaf)
      }
      ctx.phys.cylinder({ x, y: 0.68, z: HZ - 1.3 }, 0.68, 1)
    }
    // Outside: a hedge and a fence, far off in the sun.
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(80, 4, 2), flat('#4d7c0f'))
    hedge.position.set(0, -3, 34)
    const sign = textSprite('Do not feed the cat', { bg: '#b91c1c', size: 0.6 })
    sign.position.set(-HX + 2.5, 6.6, HZ - 0.4)
    ctx.root.add(hedge, sign)
    // A warm light pouring in through the window (no shadows: the engine's key light does those).
    const light = new THREE.DirectionalLight('#ffe2b0', 0.55)
    light.position.set(-6, 14, 20)
    ctx.root.add(light)
  },

  init(ctx) {
    const st: LaserState = {
      paws: [0, 1].map((i) => ({ on: i === 0 ? 1 : 0, ph: 0 as Ph, t0: 0, dur: 1.5, ax: i ? 6 : -6, az: 0, bx: i ? 6 : -6, bz: 0, fake: 0, aimed: 0 })),
      tangle: ctx.toys.map(() => 0),
      survive: ctx.toys.map(() => 0),
      hitDone: [0, 0],
      vis: { dots: [], shadows: [], rings: [], paws: [], eyes: [], curtains: [], beams: [], wraps: [], tail: null, slammed: [-1, -1] },
    }
    const cat = catMesh(ctx)
    st.vis.eyes = cat.eyes
    st.vis.tail = cat.tail
    for (let i = 0; i < 2; i++) {
      const dot = new THREE.Group()
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }))
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
      core.position.y = 0.03
      glow.position.y = 0.025
      dot.add(core, glow)
      dot.visible = false
      ctx.root.add(dot)
      st.vis.dots.push(dot)
      const sh = blobShadow(0)
      ctx.root.add(sh)
      st.vis.shadows.push(sh)
      const ring = warnRing('#ef4444')
      ctx.root.add(ring)
      st.vis.rings.push(ring)
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 1, 12), soft('#f59e0b'))
      arm.castShadow = true
      const paw = pawMesh()
      ctx.root.add(arm, paw)
      st.vis.paws.push({ arm, paw, y: 7 })
      // The laser beam, from the window corner.
      const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.35, toneMapped: false }))
      beam.frustumCulled = false
      ctx.root.add(beam)
      st.vis.beams.push(beam)
    }
    const colors = ['#fca5a5', '#fde68a', '#a5f3fc']
    CURTAINS.forEach((x, i) => {
      const c = curtainMesh(colors[i], x)
      ctx.root.add(c.g)
      st.vis.curtains.push(c)
    })
    for (let i = 0; i < 6; i++) {
      const wrap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.5, 10, 1, true), new THREE.MeshStandardMaterial({ map: feltTexture('#fde68a'), side: THREE.DoubleSide, roughness: 1 }))
      wrap.visible = false
      ctx.root.add(wrap)
      st.vis.wraps.push(wrap)
    }
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnGrid(n, { x: 0, z: -0.3, yaw: 0, spacing: 1.9, cols: Math.min(n, 8) })[i]
  },

  start(ctx, s) {
    startMove(ctx, s, 0, pickStop(ctx, s, 0, _e), 1.8)
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const active = ctx.active()
    const press = ctx.mode === 'show' ? Math.max(0, (t / 90 - 0.5) / 0.5) * (active.length > ctx.target ? 1 : 0.2) : 0
    if (!s.paws[1].on && t >= SECOND_AT) {
      s.paws[1].on = 1
      startMove(ctx, s, 1, pickStop(ctx, s, 1, _e), 1.4)
      ctx.fx.say('THE OTHER PAW!', '#ef4444', 1.5)
      ctx.fx.sfx('meow')
    }
    if (Math.floor(t) === FAKE_AT && Math.floor(t - dt) < FAKE_AT) ctx.fx.say('THE DOT IS GETTING SNEAKY', '#fca5a5', 1.5)
    s.paws.forEach((p, i) => {
      if (!p.on) return
      const el = t - p.t0
      if (p.ph === 0 && el >= p.dur) {
        // The dot settles: the tell begins.
        p.ph = 1
        p.t0 = t
        p.dur = p.aimed === 2 ? 0.5 : tellTime(t, press) * (p.aimed ? 1.1 : 1)
        p.fake = t >= FAKE_AT && !p.aimed && ctx.rng.chance(0.3 + press * 0.3) ? 1 : 0
        if (ctx.rng.chance(0.25)) ctx.fx.sfx('meow', { x: p.bx, y: 3, z: CAT_Z - 3 })
      } else if (p.ph === 1 && p.fake && el >= p.dur * 0.55) {
        // Fake-out: the dot darts off and the paw lands there instead, quicker.
        const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(2.2, 3.4)
        startMove(ctx, s, i, clampSill(p.bx + Math.cos(a) * r, p.bz + Math.sin(a) * r * 0.6, _e), 0.22)
        p.fake = 0
        p.aimed = 2
      } else if (p.ph === 1 && el >= p.dur) {
        p.ph = 2
        p.t0 = t
        p.dur = 0.85
        s.hitDone[i] = 0
      } else if (p.ph === 2) {
        if (!s.hitDone[i] && el >= 0.1) {
          s.hitDone[i] = 1
          ctx.fx.sfx('slam', { x: p.bx, y: 0, z: p.bz })
          ctx.fx.shake(0.35)
          ctx.fx.puff({ x: p.bx, y: 0.2, z: p.bz }, 'dust', 18)
          for (const toy of active) {
            if (toy.status !== 'play') continue
            const dx = toy.pos.x - p.bx, dz = toy.pos.z - p.bz
            const d = Math.hypot(dx, dz)
            if (d > R_KNOCK || toy.feet > 2.2) continue
            if (hidden(toy.pos.x, toy.pos.z, t, ctx.seed)) {
              ctx.fx.popup(toy, 'Hidden!', '#a7f3d0')
              continue
            }
            if (d < R_HIT && toy.feet < 1.2) {
              ctx.fx.hitStop(0.08)
              ctx.fx.popup(toy, 'POUNCED!', '#f87171')
              ctx.knock(toy, { x: 0, y: 2, z: 0 }, 1.2)
              ctx.fail(toy, 'pounced')
              continue
            }
            // Near miss: bowled away (harder the closer it was) and a Sprinkle for the nerve.
            const k = (1 / Math.max(0.3, d)) * (2.2 + 2.2 * (1 - d / R_KNOCK))
            ctx.knock(toy, { x: dx * k, y: 3, z: dz * k }, 0.3)
            ctx.addSprinkles(toy, 1, 'close!')
          }
        }
        if (el >= p.dur) {
          p.aimed = 0
          startMove(ctx, s, i, pickStop(ctx, s, i, _e), ctx.rng.range(0.8, 1.7) * Math.max(0.6, 1 - t * 0.004))
        }
      }
    })
    // Curtain tangles wear off.
    for (const toy of ctx.toys) {
      if (s.tangle[toy.idx] > 0 && s.tangle[toy.idx] <= t) {
        s.tangle[toy.idx] = 0
        toy.frozen = false
      }
    }
    for (const toy of active) {
      s.survive[toy.idx] += dt
      if (s.survive[toy.idx] >= 12) {
        s.survive[toy.idx] -= 12
        ctx.addSprinkles(toy, 1)
      }
    }
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const t = ctx.time
    const d = toy.data as { wx?: number; wz?: number; wt?: number; seen?: number[]; miss?: number[] }
    // Danger: tells (after a reaction delay) and dots that are about to settle.
    let fx = 0, fz = 0, threat = 0
    s.paws.forEach((p, i) => {
      if (!p.on) return
      const seen = (d.seen ??= [0, 0])
      const miss = (d.miss ??= [-1, -1])
      if (p.ph === 1 && seen[i] !== p.t0) {
        if (t - p.t0 < sk.reaction * ctx.rng.range(0.7, 1.3)) return
        seen[i] = p.t0
        // Sometimes a bot is watching the wrong thing and never notices.
        if (ctx.rng.chance(sk.blunder * 2.2)) miss[i] = p.t0
      }
      if (p.ph >= 1 && miss[i] === p.t0) return
      dotAt(p, t, _d)
      const tx = p.ph === 0 ? p.bx : _d.x, tz = p.ph === 0 ? p.bz : _d.z
      const dx = toy.pos.x - tx, dz = toy.pos.z - tz
      const dd = Math.hypot(dx, dz) || 0.01
      const reach = p.ph === 0 ? R_HIT + 0.8 : R_HIT + 1.4
      if (dd < reach) {
        const w = (reach - dd) / reach * (p.ph === 1 ? 3 : 1)
        fx += (dx / dd) * w
        fz += (dz / dd) * w
        threat = Math.max(threat, w)
      }
    })
    // Under a closed curtain near a threat: stay put; otherwise wander and keep spread out.
    if (threat > 0.3) {
      // Flee sideways rather than towards the front edge.
      fz *= 0.6
      if (toy.pos.z < -HZ + 1.6) fz += 1.2
      const l = Math.hypot(fx, fz) || 1
      steerTo(toy, toy.pos.x + (fx / l) * 3, THREE.MathUtils.clamp(toy.pos.z + (fz / l) * 3, -HZ + 1.2, HZ - 0.6), { pace: sk.pace })
      if (threat > 2 && toy.grounded && ctx.rng.chance(sk.accuracy * 0.4)) toy.pad.dive = true
      return
    }
    if (!d.wt || d.wt < t) {
      d.wt = t + ctx.rng.range(1.2, 3)
      // Prefer a closed curtain's shelter sometimes, else somewhere quiet away from others.
      const ci = CURTAINS.findIndex((_x, i) => curtainK(i, t + 1, ctx.seed) > 0.8)
      if (ci >= 0 && ctx.rng.chance(0.5)) {
        d.wx = CURTAINS[ci] + ctx.rng.range(-1, 1)
        d.wz = HZ - 1
      } else {
        d.wx = ctx.rng.range(-HX + 1.5, HX - 1.5)
        d.wz = ctx.rng.range(-HZ + 1.4, HZ - 0.8)
      }
    }
    steerTo(toy, d.wx ?? 0, d.wz ?? 0, { pace: sk.pace * 0.6, stop: 0.4 })
    // Keep a little room from neighbours.
    for (const o of ctx.toys) {
      if (o === toy || o.status !== 'play') continue
      const dx = toy.pos.x - o.pos.x, dz = toy.pos.z - o.pos.z
      const dd = Math.hypot(dx, dz)
      if (dd < 1.3 && dd > 0.01) {
        toy.pad.mx += (dx / dd) * 0.4
        toy.pad.mz += (dz / dd) * 0.4
      }
    }
    void dt
  },

  rank(ctx) {
    return ctx.active().sort((a, b) => b.pos.z - a.pos.z)
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'furthest from the paws', "in the paw's sights")
  },

  onFall(ctx, s, toy) {
    s.tangle[toy.idx] = 0
    toy.frozen = false
    ctx.fail(toy, 'fell off the sill')
  },

  retry(ctx, s, toy) {
    s.tangle[toy.idx] = 0
    toy.frozen = false
    ctx.respawn(toy, { x: ctx.rng.range(-6, 6), y: 0, z: 1.5, yaw: 0 }, 1)
  },

  pack(_c, s) {
    return [s.paws.map((p) => [p.on, p.ph, r2(p.t0), r2(p.dur), p.ax, p.az, p.bx, p.bz, p.aimed]), s.tangle.map(r1)]
  },

  unpack(_c, s, d) {
    const [paws, tangle] = d as [number[][], number[]]
    paws.forEach((row, i) => {
      const p = s.paws[i]
      ;[p.on, p.ph, p.t0, p.dur, p.ax, p.az, p.bx, p.bz, p.aimed] = row as [number, Ph, number, number, number, number, number, number, number]
    })
    s.tangle = tangle
  },

  cameraUpdate(ctx, _s, cam, dt) {
    // From the room, a little above the sill, looking out of the window (so the cat is in view).
    if (ctx.phase === 'intro') return false
    const me = ctx.me
    const f = me && me.status !== 'failed' ? me : ctx.leader()
    const fx = f ? f.pos.x : 0
    cam.yaw = 0
    if (f) cam.focus.copy(f.pos)
    _v.set(fx * 0.78, 5.4, -HZ - 5.6)
    _look.set(fx * 0.86, 0.8, 1.6)
    cam.place(_v, _look, dt, 5)
    return true
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    const playing = ctx.phase === 'play'
    s.paws.forEach((p, i) => {
      const on = !!p.on && playing
      dotAt(p, t, _d)
      const dot = v.dots[i]
      dot.visible = on && p.ph !== 2
      dot.position.set(_d.x + Math.sin(t * 23 + i) * 0.04, 0, _d.z + Math.cos(t * 19 + i) * 0.04)
      const beam = v.beams[i]
      beam.visible = dot.visible
      if (dot.visible) {
        const pos = beam.geometry.attributes.position as THREE.BufferAttribute
        pos.setXYZ(0, i ? 18 : -18, 14, -22)
        pos.setXYZ(1, dot.position.x, 0.03, dot.position.z)
        pos.needsUpdate = true
      }
      // Shadow and ring: the tell.
      const sh = v.shadows[i], ring = v.rings[i]
      const tell = on && p.ph === 1 ? THREE.MathUtils.clamp((t - p.t0) / Math.max(0.1, p.dur), 0, 1) : on && p.ph === 2 ? 1 : 0
      ;(sh.material as THREE.MeshBasicMaterial).opacity = tell * 0.6
      sh.visible = tell > 0
      sh.scale.setScalar(0.4 + tell * (R_HIT * 1.1 - 0.4))
      sh.position.set(p.bx, 0.02, p.bz)
      const rm = ring.material as THREE.MeshBasicMaterial
      rm.opacity = on && p.ph === 1 ? 0.35 + Math.sin(t * 25) * 0.25 : 0
      ring.visible = rm.opacity > 0.01
      ring.scale.setScalar(R_HIT)
      ring.position.set(p.bx, 0.03, p.bz)
      // The paw: hovers high, sinks during the tell, slams, then lifts.
      const pw = v.paws[i]
      let y = 7.2, px = _d.x, pz = _d.z
      if (p.ph === 1) y = 7.2 - tell * 3
      else if (p.ph === 2) {
        const el = t - p.t0
        y = el < 0.1 ? 4.3 - (el / 0.1) * 3.75 : el < 0.55 ? 0.55 : 0.55 + ((el - 0.55) / 0.3) * 6
        px = p.bx
        pz = p.bz
        if (el >= 0.1 && v.slammed[i] !== p.t0) {
          v.slammed[i] = p.t0
          if (!ctx.isHost) ctx.fxLocal.puff({ x: px, y: 0.2, z: pz }, 'dust', 12)
        }
      }
      if (!on) y = 14
      pw.y += (y - pw.y) * Math.min(1, dt * (p.ph === 2 ? 40 : 8))
      pw.paw.position.set(px, pw.y, pz)
      pw.paw.visible = on
      pw.paw.scale.set(1, p.ph === 2 && t - p.t0 < 0.3 ? 0.75 : 1, 1)
      // Arm from the cat's shoulder (outside the window) to the paw.
      _v.set(i ? 3.6 : -3.6, 2.5, CAT_Z - 0.5)
      _w.set(px, pw.y + 0.3, pz + 0.6)
      const len = _v.distanceTo(_w)
      pw.arm.visible = on
      pw.arm.position.copy(_v).add(_w).multiplyScalar(0.5)
      pw.arm.scale.set(1, len, 1)
      pw.arm.quaternion.setFromUnitVectors(_up, _w.sub(_v).normalize())
    })
    // The cat's eyes follow the nearest dot.
    const live = s.paws.filter((p) => p.on)
    const target = live.length ? live[Math.floor(t / 3) % live.length] : null
    if (target) dotAt(target, t, _d)
    for (const eye of v.eyes) {
      _look.set(target ? _d.x : 0, 0, target ? _d.z : 0)
      eye.lookAt(_look)
      eye.rotateY(Math.PI)
    }
    if (v.tail) v.tail.rotation.z = Math.sin(t * 1.3) * 0.25
    // Curtains billow in and out; see-through when they hide this screen's toy.
    const me = ctx.me
    v.curtains.forEach((c, i) => {
      const k = curtainK(i, t, ctx.seed)
      c.g.rotation.x = -k * 0.42 + Math.sin(t * 1.7 + i) * 0.03
      c.g.scale.y = 1 - k * 0.06
      const mine = !!me && me.status === 'play' && Math.abs(me.pos.x - CURTAINS[i]) < CURTAIN_W / 2 + 0.5 && me.pos.z > HZ - 3
      c.mat.opacity += ((mine && k > 0.3 ? 0.45 : 1) - c.mat.opacity) * Math.min(1, dt * 8)
    })
    // Tangled toys are wrapped in fabric.
    let w = 0
    for (const toy of ctx.toys) {
      if (w >= v.wraps.length) break
      if (toy.status !== 'play' || (s.tangle[toy.idx] ?? 0) <= t) continue
      const m = v.wraps[w++]
      m.visible = true
      m.position.set(toy.pos.x, toy.feet + 0.75, toy.pos.z)
      m.rotation.y += dt * 2
    }
    for (; w < v.wraps.length; w++) v.wraps[w].visible = false
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const live = s.paws.filter((p) => p.on).length
    const chips = [`${live} paw${live === 1 ? '' : 's'}`]
    if (t < SECOND_AT && ctx.phase === 'play') chips.push(`Second paw in ${Math.ceil(SECOND_AT - t)} s`)
    else if (t < FAKE_AT && ctx.phase === 'play') chips.push(`Fakes in ${Math.ceil(FAKE_AT - t)} s`)
    else if (ctx.phase === 'play') chips.push('Fakes!')
    let status: { text: string; color: string; pulse?: boolean } | undefined
    let prompt: string | undefined
    if (me && me.status === 'play') {
      const under = s.paws.some((p) => p.on && p.ph === 1 && Math.hypot(me.pos.x - p.bx, me.pos.z - p.bz) < R_HIT + 0.3)
      if (under) status = { text: 'MOVE! PAW COMING', color: '#ef4444', pulse: true }
      else if (hidden(me.pos.x, me.pos.z, t, ctx.seed)) status = { text: 'HIDDEN BY THE CURTAIN', color: '#86efac' }
      if (s.tangle[me.idx] > t) prompt = 'Tangled in a curtain! Hang on…'
      else if (t < 6) prompt = 'Watch the red dot: where it stops, the paw slams down.'
    }
    return { chips, status, prompt }
  },
})

