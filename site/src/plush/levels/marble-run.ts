// Marble Run Rumble (survival, can be a final). A big pegboard balanced on a wooden ball tilts towards wherever
// the crowd stands, and marbles pour in from the high side and roll down at the toys. Get hit and you go
// tumbling (maybe off the edge with them). Hide behind the rulers and erasers glued to the board; spread out to
// keep it level. Huge, slow marbles join at 30 s, and the board tilts further as time goes on. Tricks: aim a
// marble at a rival, and drop a paperweight next to someone so the board tips (and the marbles roll) their way.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { skill, steerTo } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { blobShadow, flat, paint, r1, r2, rbox, soft, survivalTimeUp } from './kit'

const HALF = 9
const THICK = 0.6
const SMALL_R = 0.42
const HUGE_R = 1.15
const N_SMALL = 14
const N_HUGE = 3
const HUGE_AT = 30
const PARK_Y = -40
/** Cover glued to the board: [x, z, rotY, kind] (0 ruler, 1 eraser). */
const COVER: [number, number, number, number][] = [
  [-4.2, -3.6, 0.3, 0],
  [3.8, 3.2, -0.25, 0],
  [4.6, -4.4, 1.4, 1],
  [-4.4, 4.2, 0.6, 1],
  [0.4, -0.2, 0.9, 1],
  [-0.8, 6.2, 1.57, 0],
  [6.6, 0.4, 1.2, 0],
]

interface Marble {
  body: RigidBody
  mesh: THREE.Mesh
  huge: boolean
  live: boolean
}

interface MarbleState {
  /** Board tilt about x and z (synced). */
  tx: number
  tz: number
  /** Paperweights: flat [x, z, until, ...] in board coordinates. */
  weights: number[]
  nextDrop: number
  nextHuge: number
  // Host only.
  marbles: Marble[]
  hit: Map<string, number>
  survive: number[]
  vis: {
    board: THREE.Group | null
    body: RigidBody | null
    tx: number
    tz: number
    shadows: THREE.Mesh[]
    weights: THREE.Mesh[]
    rumble: number
  }
}

/* ---------------- Board maths ---------------- */

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()

function boardQuat(tx: number, tz: number, out: THREE.Quaternion) {
  return out.setFromEuler(_e.set(tx, 0, tz, 'XZY'))
}

/** Board surface height at world (x, z) (small-angle). */
function heightAt(tx: number, tz: number, x: number, z: number) {
  return x * Math.sin(tz) - z * Math.sin(tx)
}

/** Unit downhill direction on the board (x, z), and the slope. */
function downhill(tx: number, tz: number) {
  const dx = -Math.sin(tz), dz = Math.sin(tx)
  const l = Math.hypot(dx, dz)
  return { x: l > 1e-4 ? dx / l : 0, z: l > 1e-4 ? dz / l : 1, slope: l }
}

function maxTilt(t: number, press: number) {
  return Math.min(0.3, 0.1 + t * 0.0015 + press * 0.06)
}

/* ---------------- Visuals ---------------- */

function boardTexture() {
  // A pegboard with painted marble tracks.
  return paint(1024, 1024, (g, w, h) => {
    g.fillStyle = '#e7c58f'
    g.fillRect(0, 0, w, h)
    const step = w / 30
    g.fillStyle = 'rgba(90,55,20,0.45)'
    for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) {
      g.beginPath()
      g.arc(x, y, 3.2, 0, Math.PI * 2)
      g.fill()
    }
    const tracks = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7']
    g.lineCap = 'round'
    tracks.forEach((c, i) => {
      g.strokeStyle = c
      g.globalAlpha = 0.55
      g.lineWidth = 16
      g.beginPath()
      const y0 = (i + 0.5) * (h / tracks.length)
      g.moveTo(-20, y0)
      for (let x = 0; x <= w + 20; x += 40) g.lineTo(x, y0 + Math.sin(x * 0.012 + i * 1.7) * 70)
      g.stroke()
      g.globalAlpha = 1
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      g.lineWidth = 3
      g.stroke()
    })
    g.strokeStyle = '#7c4a24'
    g.lineWidth = 18
    g.strokeRect(0, 0, w, h)
  })
}

const MARBLE_COLS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#a78bfa']

function marbleMaterial(color: string) {
  // Glassy: a dark core swirl painted on a bright, shiny ball.
  const tex = paint(128, 64, (g, w, h) => {
    g.fillStyle = color
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(255,255,255,0.75)'
    g.lineWidth = 7
    g.beginPath()
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h / 2 + Math.sin((x / w) * Math.PI * 4) * h * 0.3)
    g.stroke()
    g.strokeStyle = 'rgba(0,0,0,0.25)'
    g.lineWidth = 3
    g.stroke()
  })
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.08, metalness: 0.15, emissive: color, emissiveIntensity: 0.12 })
}

function ruler(len: number) {
  return new THREE.MeshStandardMaterial({
    map: paint(256, 32, (g, w, h) => {
      g.fillStyle = '#fde68a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#78350f'
      for (let x = 4; x < w; x += 6) g.fillRect(x, 0, 1.4, x % 30 < 6 ? 14 : 7)
      g.font = '700 11px ui-rounded, system-ui, sans-serif'
      for (let x = 30, n = 1; x < w; x += 30, n++) g.fillText(String(n), x - 3, h - 5)
    }, [len / 4, 1]),
    roughness: 0.5,
  })
}

/* ---------------- Marbles ---------------- */

function park(m: Marble, i: number) {
  m.body.setTranslation({ x: i * 3 - 30, y: PARK_Y, z: 30 }, true)
  m.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  m.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  m.body.sleep()
  m.live = false
}

/** Drop a marble in from the high side (or aim it at a toy). */
function launch(ctx: LevelCtx, s: MarbleState, huge: boolean, at?: Toy, speed = 2.5) {
  const m = s.marbles.find((x) => x.huge === huge && !x.live)
  if (!m) return false
  const d = downhill(s.tx, s.tz)
  let dx = d.x, dz = d.z
  if (d.slope < 0.03) {
    const a = ctx.rng.range(0, Math.PI * 2)
    dx = Math.cos(a)
    dz = Math.sin(a)
  }
  // Start on the uphill edge, somewhere along it (or in line with the target).
  const px = -dz, pz = dx
  let side = ctx.rng.range(-HALF + 1.2, HALF - 1.2)
  if (at) side = THREE.MathUtils.clamp(at.pos.x * px + at.pos.z * pz, -HALF + 1, HALF - 1)
  const r = huge ? HUGE_R : SMALL_R
  const x = -dx * (HALF - r - 0.2) + px * side, z = -dz * (HALF - r - 0.2) + pz * side
  const y = heightAt(s.tx, s.tz, x, z) + r + 0.6
  let vx = dx * speed, vz = dz * speed
  if (at) {
    const ax = at.pos.x - x, az = at.pos.z - z
    const l = Math.hypot(ax, az) || 1
    vx = (ax / l) * speed
    vz = (az / l) * speed
  }
  m.body.wakeUp()
  m.body.setTranslation({ x, y, z }, true)
  m.body.setLinvel({ x: vx, y: 0, z: vz }, true)
  m.live = true
  ctx.fx.sfx(huge ? 'rumble' : 'click', { x, y, z })
  return true
}

const _p = new THREE.Vector3()

export default defineLevel<MarbleState>({
  id: 'marble-run',
  name: 'Marble Run Rumble',
  type: 'survival',
  blurb: 'Dodge marbles rolling down a tilting board. Get hit and you roll off with them.',
  howTo: [
    'The board tips towards wherever the crowd stands: marbles roll in from the high side',
    'Hide behind the rulers and erasers, or jump the small marbles',
    'Huge, slow marbles join at 30 s: get out of their way',
    'The tilt grows and the marbles keep coming',
  ],
  accent: '#38bdf8',
  players: [2, 16],
  duration: 120,
  canBeFinal: true,
  camera: { kind: 'chase', dist: 8.5, height: 1.4 },
  introOrbit: { radius: 15, height: 9 },
  sprinkles: { start: 2 },
  fallY: -7,
  sky: { color: '#1f160f', fogNear: 45, fogFar: 120 },

  tricks: [
    {
      id: 'aim',
      name: 'Aim a Marble',
      icon: 'ball',
      cost: 2,
      cooldown: 7,
      busy: 0.6,
      target: 'rival',
      desc: 'Flick a fast marble from the high edge straight at a rival.',
      counter: 'Hear the click: hop over it or duck behind a ruler.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        if (launch(ctx, s, false, target, 9)) ctx.fx.popup(target, 'Incoming marble!', '#7dd3fc')
      },
    },
    {
      id: 'weight',
      name: 'Paperweight',
      icon: 'weight',
      cost: 3,
      cooldown: 14,
      busy: 1,
      target: 'rival',
      desc: 'Drop a heavy glass paperweight beside a rival: for 6 s the board tips their way, and so do the marbles.',
      counter: 'Get away from it, uphill.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.weights = s.weights.filter((_v, i, a) => a[i - (i % 3) + 2] > ctx.time)
        s.weights.push(r2(target.pos.x * 0.9), r2(target.pos.z * 0.9), r1(ctx.time + 6))
        if (s.weights.length > 9) s.weights.splice(0, 3)
        ctx.fx.sfx('thud', target.pos)
        ctx.fx.shake(0.25)
        ctx.fx.popup(target, 'Paperweight!', '#bae6fd')
      },
      botUse: (ctx, _s, user) => {
        // Weigh down a rival standing near an edge, away from us.
        let best: Toy | null = null, bd = 4
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play' || t.pos.distanceTo(user.pos) < 5) continue
          const e = HALF - Math.max(Math.abs(t.pos.x), Math.abs(t.pos.z))
          if (e < bd) {
            bd = e
            best = t
          }
        }
        return best ?? false
      },
    },
    bubbleWrap<MarbleState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 24, hd: 24, ridge: 28, knee: 9, y: -12, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    // The fulcrum: a wooden ball on a stand.
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.4, 10, 12), flat('#6b4423'))
    stand.position.y = -7.3
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14), flat('#b45309'))
    ball.position.y = -1.6
    ctx.root.add(stand, ball)
    // Old marble-run towers round the board (decor).
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b']
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const g = new THREE.Group()
      for (let k = 0; k < 4; k++) {
        const blk = new THREE.Mesh(rbox(2, 2, 2, 0.15, 1), flat(colors[(i + k) % 4]))
        blk.position.y = 1 + k * 2
        g.add(blk)
        const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 8, 1, true).rotateZ(Math.PI / 2 - 0.3), flat('#e5e7eb', { side: THREE.DoubleSide }))
        chute.position.set(k % 2 ? 1.2 : -1.2, 1.5 + k * 2, 0)
        g.add(chute)
      }
      g.position.set(Math.sin(a) * (HALF + 6), -12, Math.cos(a) * (HALF + 6))
      g.rotation.y = a
      ctx.root.add(g)
    }
    const tin = prop(ctx.assets, 'tin', 3, 'height')
    tin.position.set(-HALF - 7, -12, 2)
    const boxes = prop(ctx.assets, 'boxes', 5, 'height')
    boxes.position.set(HALF + 6, -12, -8)
    ctx.root.add(tin, boxes)
  },

  init(ctx) {
    const st: MarbleState = {
      tx: 0,
      tz: 0,
      weights: [],
      nextDrop: 1.5,
      nextHuge: HUGE_AT,
      marbles: [],
      hit: new Map(),
      survive: ctx.toys.map(() => 0),
      vis: { board: null, body: null, tx: 0, tz: 0, shadows: [], weights: [], rumble: 0 },
    }
    // The board: one kinematic body (board + glued-on cover) and one visual group.
    const group = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, THICK, HALF * 2), [
      flat('#7c4a24'), flat('#7c4a24'), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.7 }), flat('#6b3f1f'), flat('#7c4a24'), flat('#7c4a24'),
    ])
    top.position.y = -THICK / 2
    top.receiveShadow = true
    group.add(top)
    const body = ctx.phys.kinematic({ x: 0, y: 0, z: 0 })
    ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid(HALF, THICK / 2, HALF).setTranslation(0, -THICK / 2, 0), { friction: 0.6 })
    const eraserMat = [soft('#f9a8d4'), soft('#93c5fd')]
    for (const [x, z, ry, kind] of COVER) {
      const size = kind === 0 ? [4.2, 0.75, 0.32] : [1.5, 0.85, 0.95]
      const m = kind === 0 ? new THREE.Mesh(rbox(size[0], size[1], size[2], 0.05, 1), ruler(size[0])) : new THREE.Mesh(rbox(size[0], size[1], size[2], 0.2, 2), eraserMat[Math.round(x) & 1])
      m.position.set(x, size[1] / 2, z)
      m.rotation.y = ry
      m.castShadow = m.receiveShadow = true
      group.add(m)
      _q.setFromEuler(_e.set(0, ry, 0))
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(x, size[1] / 2, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }), { friction: 0.5 })
    }
    // Paperweights (visual, on the board).
    for (let i = 0; i < 3; i++) {
      const pw = new THREE.Mesh(new THREE.SphereGeometry(0.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#bae6fd', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8 }))
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), soft('#f43f5e'))
      flower.position.y = 0.3
      pw.add(flower)
      pw.visible = false
      group.add(pw)
      st.vis.weights.push(pw)
    }
    ctx.root.add(group)
    st.vis.board = group
    st.vis.body = body
    // Marbles: a pool of dynamic balls, streamed to clients.
    for (let i = 0; i < N_SMALL + N_HUGE; i++) {
      const huge = i >= N_SMALL
      const r = huge ? HUGE_R : SMALL_R
      const b = ctx.phys.dynamic({ x: i * 3 - 30, y: PARK_Y, z: 30 }, { damping: 0.05, ccd: true })
      b.setAngularDamping(0.15)
      ctx.phys.attach(b, ctx.RAPIER.ColliderDesc.ball(r).setDensity(huge ? 1.2 : 2.2), { friction: 0.5, restitution: 0.35, groups: PROP_GROUPS })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, huge ? 24 : 16, huge ? 16 : 10), marbleMaterial(MARBLE_COLS[i % MARBLE_COLS.length]))
      mesh.castShadow = true
      ctx.root.add(mesh)
      ctx.syncProp(b, mesh)
      const m: Marble = { body: b, mesh, huge, live: false }
      st.marbles.push(m)
      if (ctx.isHost) park(m, i)
      const sh = blobShadow(0.35)
      sh.scale.setScalar(r * 1.2)
      sh.visible = false
      ctx.root.add(sh)
      st.vis.shadows.push(sh)
    }
    // The board tilts on every screen (clients ease towards the synced tilt); toys slide a little downhill.
    ctx.hazards.add({
      predict: true,
      update(c, _t, dt) {
        const v = st.vis
        if (c.isHost) {
          v.tx = st.tx
          v.tz = st.tz
        } else {
          v.tx += (st.tx - v.tx) * Math.min(1, dt * 8)
          v.tz += (st.tz - v.tz) * Math.min(1, dt * 8)
        }
        body.setNextKinematicRotation(boardQuat(v.tx, v.tz, _q))
      },
      affect(c, toy, dt) {
        if (toy.status !== 'play' || c.phase !== 'play' || !toy.grounded || toy.mode !== 'walk') return
        if (Math.abs(toy.pos.x) > HALF || Math.abs(toy.pos.z) > HALF) return
        const d = downhill(st.vis.tx, st.vis.tz)
        // Dazed toys slide much further.
        const k = d.slope * (toy.stun > 0 ? 14 : 5) * dt
        const p = toy.body.translation()
        toy.body.setTranslation({ x: p.x + d.x * k, y: p.y, z: p.z + d.z * k }, true)
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 0, radius: Math.min(6.5, 2.5 + n * 0.3), faceIn: false })[i]
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const active = ctx.active()
    const press = ctx.mode === 'show' ? Math.max(0, (t / 120 - 0.55) / 0.45) * (active.length > ctx.target ? 1 : 0.2) : 0
    // Tilt towards the crowd's weight (plus paperweights), rate-limited, within a limit that grows.
    let mx = 0, mz = 0, w = 0
    for (const a of active) {
      if (Math.abs(a.pos.x) > HALF || Math.abs(a.pos.z) > HALF || a.pos.y < -2) continue
      mx += a.pos.x
      mz += a.pos.z
      w++
    }
    for (let i = 0; i < s.weights.length; i += 3) {
      if (s.weights[i + 2] < t) continue
      mx += s.weights[i] * 4
      mz += s.weights[i + 1] * 4
      w += 4
    }
    const lim = maxTilt(t, press)
    const k = lim / 3.2
    // A sway of its own that grows, so even a well-spread crowd gets tipped about.
    const sway = (0.03 + t * 0.0007) * Math.sin(t * 0.37 + ctx.seed)
    const wantZ = THREE.MathUtils.clamp(w ? (-mx / w) * k : 0, -lim, lim) + sway
    const wantX = THREE.MathUtils.clamp(w ? (mz / w) * k : 0, -lim, lim) - sway * 0.6
    s.tz += THREE.MathUtils.clamp(wantZ - s.tz, -0.16 * dt, 0.16 * dt)
    s.tx += THREE.MathUtils.clamp(wantX - s.tx, -0.16 * dt, 0.16 * dt)
    // Marbles pour in from the high side, faster and faster; huge ones from 30 s.
    if (ctx.round.final && t >= 80 && t - dt < 80) ctx.fx.say('MARBLE AVALANCHE!', '#7dd3fc', 1.6)
    if (t >= s.nextDrop) {
      const rush = ctx.round.final && t > 80 ? 0.55 : 1
      s.nextDrop = t + Math.max(0.3, (1.5 - t * 0.009 - press * 0.3) * rush) * ctx.rng.range(0.7, 1.3)
      launch(ctx, s, false, undefined, ctx.rng.range(1.5, 3.5))
      if (t > 60 && ctx.rng.chance(0.3)) launch(ctx, s, false, undefined, ctx.rng.range(1.5, 3))
    }
    if (t >= s.nextHuge) {
      s.nextHuge = t + Math.max(ctx.round.final && t > 80 ? 3 : 5, 10 - t * 0.04) * ctx.rng.range(0.8, 1.2)
      if (launch(ctx, s, true, undefined, 1.2)) ctx.fx.say('HUGE MARBLE!', '#7dd3fc', 1.1)
    }
    // Hits, and marbles that have rolled away.
    s.marbles.forEach((m, i) => {
      if (!m.live) return
      const p = m.body.translation()
      if (p.y < -9 || Math.abs(p.x) > 30 || Math.abs(p.z) > 30) {
        park(m, i)
        return
      }
      const v = m.body.linvel()
      const sp = Math.hypot(v.x, v.z)
      if (sp < 1.2) return
      const r = m.huge ? HUGE_R : SMALL_R
      for (const toy of active) {
        const dx = toy.pos.x - p.x, dy = toy.pos.y - p.y, dz = toy.pos.z - p.z
        if (dx * dx + dy * dy + dz * dz > (r + 0.5) ** 2) continue
        const key = `${i}:${toy.idx}`
        if ((s.hit.get(key) ?? -9) > t - 0.7) continue
        s.hit.set(key, t)
        const pow = (m.huge ? 8.5 : 5.5) + sp * 0.6
        ctx.knock(toy, { x: (v.x / sp) * pow + dx * 1.5, y: m.huge ? 5 : 3.5, z: (v.z / sp) * pow + dz * 1.5 }, m.huge ? 1 : 0.75)
        ctx.fx.sfx(m.huge ? 'slam' : 'thud', toy.pos)
        if (m.huge) {
          ctx.fx.hitStop(0.06)
          ctx.fx.shake(0.4, toy)
        }
      }
    })
    if (s.hit.size > 300) s.hit.clear()
    for (const a of active) {
      s.survive[a.idx] += dt
      if (s.survive[a.idx] >= 10) {
        s.survive[a.idx] -= 10
        ctx.addSprinkles(a, 1)
      }
    }
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const t = ctx.time
    const d = toy.data as { wx?: number; wz?: number; wt?: number; jumpT?: number }
    // Threats: marbles on a course to pass close in the next second.
    let fx = 0, fz = 0, threat = 0
    for (const m of s.marbles) {
      if (!m.live) continue
      const p = m.body.translation()
      const v = m.body.linvel()
      const sp = Math.hypot(v.x, v.z)
      if (sp < 0.6) continue
      const rx = toy.pos.x - p.x, rz = toy.pos.z - p.z
      const along = (rx * v.x + rz * v.z) / sp
      if (along < -0.5 || along > sp * 1.3 + 1) continue
      const side = (rx * v.z - rz * v.x) / sp
      const r = (m.huge ? HUGE_R : SMALL_R) + 0.7
      if (Math.abs(side) > r + 0.6) continue
      const eta = along / sp
      const w = (1.5 - Math.min(1.4, eta)) * (m.huge ? 2 : 1)
      const sg = side >= 0 ? 1 : -1
      fx += (v.z / sp) * sg * w
      fz += (-v.x / sp) * sg * w
      threat = Math.max(threat, w)
      // Small ones: hop them as they arrive.
      if (!m.huge && eta < 0.32 && eta > 0.08 && toy.grounded && (d.jumpT ?? 0) < t - 0.6 && ctx.rng.chance(sk.accuracy * 0.85)) {
        d.jumpT = t
        toy.pad.jump = true
      }
    }
    const dh = downhill(s.tx, s.tz)
    if (threat > 0.2) {
      // Dodge sideways, never towards the low edge.
      let gx = toy.pos.x + fx * 3, gz = toy.pos.z + fz * 3
      gx = THREE.MathUtils.clamp(gx, -HALF + 1.5, HALF - 1.5)
      gz = THREE.MathUtils.clamp(gz, -HALF + 1.5, HALF - 1.5)
      steerTo(toy, gx, gz, { pace: sk.pace })
      return
    }
    // Calm: pick a spot behind cover (downhill of a ruler or eraser), or uphill-ish of the middle.
    if (!d.wt || d.wt < t) {
      d.wt = t + ctx.rng.range(1.5, 3.5)
      if (ctx.rng.chance(0.55)) {
        const c = COVER[ctx.rng.int(0, COVER.length)]
        d.wx = c[0] + dh.x * 1.1 + ctx.rng.range(-0.6, 0.6)
        d.wz = c[1] + dh.z * 1.1 + ctx.rng.range(-0.6, 0.6)
      } else {
        d.wx = ctx.rng.range(-HALF + 2.5, HALF - 2.5) - dh.x * 2
        d.wz = ctx.rng.range(-HALF + 2.5, HALF - 2.5) - dh.z * 2
      }
    }
    steerTo(toy, d.wx ?? 0, d.wz ?? 0, { pace: sk.pace * 0.7, stop: 0.4 })
    // Lean against the slope near the low edge.
    const edge = HALF - Math.max(Math.abs(toy.pos.x), Math.abs(toy.pos.z))
    if (edge < 2) {
      toy.pad.mx -= Math.sign(toy.pos.x) * (Math.abs(toy.pos.x) > Math.abs(toy.pos.z) ? 0.8 : 0)
      toy.pad.mz -= Math.sign(toy.pos.z) * (Math.abs(toy.pos.z) >= Math.abs(toy.pos.x) ? 0.8 : 0)
    }
    void dt
  },

  rank(ctx) {
    return ctx.active().sort((a, b) => Math.max(Math.abs(a.pos.x), Math.abs(a.pos.z)) - Math.max(Math.abs(b.pos.x), Math.abs(b.pos.z)))
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'nearest the middle', "too near the edge")
  },

  onThrow(ctx, s, kind, target) {
    // The gallery's crumbs turn into little marbles flicked at the target.
    if (kind !== 'crumb') return false
    if (!launch(ctx, s, false, target, 6.5)) return false
    ctx.fx.popup(target, 'Marble from the gallery!', '#7dd3fc')
    return true
  },

  onFall(ctx, _s, toy) {
    ctx.fail(toy, toy.grudge ? `rolled off (thanks, ${toy.grudge.name})` : 'rolled off the board')
  },

  retry(ctx, s, toy) {
    const d = downhill(s.tx, s.tz)
    ctx.respawn(toy, { x: -d.x * 3, y: heightAt(s.tx, s.tz, -d.x * 3, -d.z * 3) + 0.2, z: -d.z * 3, yaw: 0 }, 1)
  },

  pack(_c, s) {
    return [Math.round(s.tx * 1000) / 1000, Math.round(s.tz * 1000) / 1000, s.weights]
  },

  unpack(_c, s, d) {
    const [tx, tz, weights] = d as [number, number, number[]]
    s.tx = tx
    s.tz = tz
    s.weights = weights
  },

  visual(ctx, s, dt) {
    const v = s.vis
    const t = ctx.time
    if (v.board) v.board.quaternion.copy(boardQuat(v.tx, v.tz, _q))
    // Marble shadows on the board, and hide parked marbles.
    let loud = 99
    s.marbles.forEach((m, i) => {
      const p = m.body.translation()
      const live = p.y > PARK_Y + 5
      m.mesh.visible = live
      const sh = v.shadows[i]
      const onBoard = live && Math.abs(p.x) < HALF && Math.abs(p.z) < HALF
      sh.visible = onBoard
      if (onBoard) sh.position.set(p.x, heightAt(v.tx, v.tz, p.x, p.z) + 0.03, p.z)
      if (live && m.huge && ctx.me) loud = Math.min(loud, _p.set(p.x, p.y, p.z).distanceTo(ctx.me.pos))
    })
    v.rumble -= dt
    if (loud < 10 && v.rumble <= 0 && ctx.phase === 'play') {
      v.rumble = 0.6
      ctx.fxLocal.sfx('rumble', ctx.me?.pos)
    }
    // Paperweights sit on the board where they were dropped.
    v.weights.forEach((pw, k) => {
      const i = s.weights.length - 3 * (k + 1)
      const on = i >= 0 && s.weights[i + 2] > t
      pw.visible = on
      if (on) pw.position.set(s.weights[i], 0, s.weights[i + 1])
    })
    void _v
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const deg = Math.round((Math.hypot(s.tx, s.tz) * 180) / Math.PI)
    const chips = [`Tilt ${deg}°`]
    if (t < HUGE_AT && ctx.phase === 'play') chips.push(`Huge marbles in ${Math.ceil(HUGE_AT - t)} s`)
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    const bars: { label: string; value: number; color: string; danger?: boolean }[] = []
    bars.push({ label: 'Tilt', value: Math.min(1, Math.hypot(s.tx, s.tz) / 0.27), color: '#38bdf8', danger: deg > 11 })
    if (me && me.status === 'play') {
      const edge = HALF - Math.max(Math.abs(me.pos.x), Math.abs(me.pos.z))
      if (edge < 1.5) status = { text: 'NEAR THE EDGE!', color: '#f87171', pulse: true }
      if (t < 6) prompt = 'Marbles roll in from the high side. Spread out to keep the board level!'
    }
    return { chips, prompt, status, bars }
  },
})
