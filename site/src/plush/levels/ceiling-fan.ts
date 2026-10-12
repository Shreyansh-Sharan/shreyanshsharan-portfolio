// Ceiling Fan Frenzy (survival, can be a final). The toys ride the blades of a big ceiling fan hanging high above
// a bedroom. It turns slowly at first, then the speed setting clicks up from 1 to 3: the faster it spins, the
// harder you are flung outwards, and the more it wobbles. The centre hub is the safe spot, but only a few fit.
// At speed 2 the two pull cords swing out into sweeping bars: jump them, or hold Grab to ride one (let go over a
// blade!). Tricks: flick the blade a rival stands on (it tips up and dumps them) and pull the cord yourself (a
// speed boost for everyone, you included).
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { skill, steerTo } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import type { RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type Toy } from '../engine/types'
import { flat, paint, r2, rbox, soft, wrap, survivalTimeUp } from './kit'

const BLADES = 5
const HUB_R = 1.9
const MOTOR_R = 1.0
const B_IN = 1.4
const B_OUT = 8.6
const B_W = 1.05 // half width
const B_T = 0.25
const FLOOR_Y = -16
/** Spin by speed setting (rad/s) and when each setting clicks in. */
const OMEGA = [0, 0.42, 0.78, 1.18]
const SPEED_AT = [0, 0, 40, 80]
const CORD_Y = 0.95
const CORD_LEN = 7.2
const FLIP_TIME = 1.3
/** How fast the cords slip behind the blades (rad/s): the sweep you have to jump. */
const CORD_SLIP = 0.3

interface FanState {
  /** Spin angle and rate (synced; clients extrapolate). */
  theta: number
  omega: number
  level: number
  /** Pull-the-cord boost until. */
  boost: number
  /** Blade flick start times (-1 none). */
  flip: number[]
  // Host only.
  survive: number[]
  cordHit: Map<string, number>
  vis: {
    th: number
    blades: THREE.Group[]
    hub: THREE.Group | null
    cords: THREE.Group[]
    lamp: THREE.MeshStandardMaterial | null
    hum: number
  }
  bodies: { blades: RigidBody[]; hub: RigidBody | null }
}

/* ---------------- Fan maths (shared by every screen) ---------------- */

const _qt = new THREE.Quaternion()
const _qy = new THREE.Quaternion()
const _qx = new THREE.Quaternion()
const _axis = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _xx = new THREE.Vector3(1, 0, 0)

/** Wobble: a tilt that grows with the speed setting, precessing round. */
function tilt(level: number, th: number, t: number, out: THREE.Quaternion) {
  const amp = 0.012 + (level - 1) * 0.022 + Math.max(0, t - 90) * 0.0004
  const ph = th * 0.45 + t * 0.35
  _axis.set(Math.cos(ph), 0, Math.sin(ph))
  return out.setFromAxisAngle(_axis, amp)
}

/** Blade flick pitch (rad) at time t for a flick that began at f. */
function pitch(f: number, t: number) {
  if (f < 0) return 0
  const e = t - f
  if (e < 0 || e > FLIP_TIME) return 0
  const k = e < 0.15 ? e / 0.15 : e < 0.95 ? 1 : 1 - (e - 0.95) / (FLIP_TIME - 0.95)
  return k * 0.62
}

function bladeQuat(s: FanState, b: number, th: number, t: number, out: THREE.Quaternion) {
  tilt(s.level, th, t, _qt)
  _qy.setFromAxisAngle(_up, th + (b / BLADES) * Math.PI * 2)
  _qx.setFromAxisAngle(_xx, pitch(s.flip[b], t))
  return out.copy(_qt).multiply(_qy).multiply(_qx)
}

/** Fan-local polar coords of a world point: which blade (or -1), distance along it, and across it. */
function onBlade(th: number, x: number, z: number) {
  const r = Math.hypot(x, z)
  // World angle → fan angle (three.js: rotation about +y by a takes +x to (cos a, -sin a)).
  const a = Math.atan2(-z, x) - th
  let best = -1, bestLat = 99
  for (let b = 0; b < BLADES; b++) {
    const d = wrap(a - (b / BLADES) * Math.PI * 2)
    const lat = Math.sin(d) * r
    if (Math.cos(d) > 0 && Math.abs(lat) < Math.abs(bestLat)) {
      bestLat = lat
      best = b
    }
  }
  return { b: best, r, lat: bestLat, on: r < HUB_R || (best >= 0 && r > B_IN - 0.2 && r < B_OUT && Math.abs(bestLat) < B_W) }
}

/** A point on blade b (fan-local radius r, lateral offset) in world x/z at angle th. */
function bladePoint(th: number, b: number, r: number, lat: number, out: { x: number; z: number }) {
  const a = th + (b / BLADES) * Math.PI * 2
  // Local blade axis is +x rotated by a about y: (cos a, -sin a); lateral is its left (-sin a, -cos a)…
  out.x = Math.cos(a) * r - Math.sin(a) * lat
  out.z = -Math.sin(a) * r - Math.cos(a) * lat
  return out
}

function cordAngle(_s: FanState, i: number, th: number, t: number) {
  // The cords lag behind the blades, so they sweep across them.
  return th - Math.max(0, t - SPEED_AT[2]) * CORD_SLIP + i * Math.PI + 0.3
}

function cordsOut(s: FanState) {
  return s.level >= 2
}

/* ---------------- Visuals ---------------- */

function woodTexture() {
  return paint(256, 64, (g, w, h) => {
    g.fillStyle = '#8b5a2b'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(60,30,10,0.35)'
    g.lineWidth = 2
    for (let y = 4; y < h; y += 7) {
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.04 + y * 0.7) * 2.5)
      g.stroke()
    }
    g.fillStyle = 'rgba(255,220,170,0.12)'
    g.fillRect(0, 0, w, 6)
  })
}

function bladeMesh(tex: THREE.Texture) {
  const g = new THREE.Group()
  const len = B_OUT - B_IN
  // A paddle: slightly wider at the tip, rounded.
  const shape = new THREE.Shape()
  shape.moveTo(0, -B_W * 0.8)
  shape.lineTo(len - 0.9, -B_W)
  shape.quadraticCurveTo(len, -B_W, len, 0)
  shape.quadraticCurveTo(len, B_W, len - 0.9, B_W)
  shape.lineTo(0, B_W * 0.8)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: B_T, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 1, curveSegments: 6 })
  geo.rotateX(Math.PI / 2)
  geo.translate(B_IN, 0, 0)
  tex.repeat.set(1 / len, 1 / (B_W * 2))
  tex.offset.set(0, 0.5)
  const mesh = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }), flat('#5b3a1c')])
  mesh.castShadow = mesh.receiveShadow = true
  // The iron bracket that holds it to the hub.
  const iron = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.7), flat('#a16207', { metalness: 0.6, roughness: 0.35 }))
  iron.position.set(B_IN + 0.3, 0.05, 0)
  g.add(mesh, iron)
  return g
}

function hubMesh() {
  const g = new THREE.Group()
  const brass = flat('#c08a2b', { metalness: 0.6, roughness: 0.35 })
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R * 0.95, 0.6, 32), brass)
  plate.position.y = -0.3
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(MOTOR_R, MOTOR_R * 1.1, 2.3, 24), soft('#3f3f46', { roughness: 0.4, metalness: 0.4 }))
  motor.position.y = 1.15
  const ring = new THREE.Mesh(new THREE.TorusGeometry(MOTOR_R * 1.05, 0.1, 6, 24).rotateX(Math.PI / 2), brass)
  ring.position.y = 0.35
  const ring2 = ring.clone()
  ring2.position.y = 2.1
  // The light bowl under the hub.
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffcf7a', emissiveIntensity: 0.9, roughness: 0.3 })
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lamp)
  bowl.position.y = -0.6
  g.add(plate, motor, ring, ring2, bowl)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return { g, lamp }
}

function cordMesh() {
  // A bead chain with a wooden pull at the end; built along +x so it can swing out.
  const g = new THREE.Group()
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, CORD_LEN, 6).rotateZ(Math.PI / 2), flat('#d4d4d8', { metalness: 0.7, roughness: 0.3 }))
  chain.position.x = MOTOR_R + CORD_LEN / 2
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), flat('#e4e4e7', { metalness: 0.7, roughness: 0.3 }), 16)
  for (let i = 0; i < 16; i++) beads.setMatrixAt(i, new THREE.Matrix4().makeTranslation(MOTOR_R + (i + 0.5) * (CORD_LEN / 16), 0, 0))
  const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.8, 10).rotateZ(Math.PI / 2), flat('#a16207'))
  pull.position.x = MOTOR_R + CORD_LEN + 0.3
  g.add(chain, beads, pull)
  return g
}

const _q = new THREE.Quaternion()
const _p = { x: 0, z: 0 }
const _seg = new THREE.Vector3()

export default defineLevel<FanState>({
  id: 'ceiling-fan',
  name: 'Ceiling Fan Frenzy',
  type: 'survival',
  blurb: 'Stay on the blades of a ceiling fan as it speeds up and tries to fling you off.',
  howTo: [
    'The faster it spins, the harder you are flung out: walk inwards',
    'The hub in the middle is safest, but only a few fit',
    'From speed 2 the pull cords swing out: jump them, or hold Grab to ride one',
    'The speed setting climbs from 1 to 3, and it wobbles more and more',
  ],
  accent: '#c08a2b',
  players: [2, 16],
  duration: 120,
  canBeFinal: true,
  camera: { kind: 'chase', dist: 8, height: 1 },
  introOrbit: { radius: 14, height: 7, center: [0, 0, 0] },
  sprinkles: { start: 2 },
  fallY: -9,
  sky: { color: '#1d140d', fogNear: 45, fogFar: 120 },

  tricks: [
    {
      id: 'flick',
      name: 'Blade Flick',
      icon: 'fan',
      cost: 3,
      cooldown: 12,
      busy: 0.6,
      target: 'rival',
      desc: "Give a rival's blade a spin: it tips up on its side for a second and dumps whoever is on it.",
      counter: 'Feel it twitch and run for the hub, or jump as it tips.',
      can: (ctx, s, _u, target) => {
        if (!target) return 'Pick a rival'
        if (ctx.time < 12) return 'The fan is still warming up'
        const o = onBlade(s.vis.th, target.pos.x, target.pos.z)
        if (o.r < HUB_R) return 'They are on the hub'
        if (!o.on) return 'They are not on a blade'
        return s.flip[o.b] >= 0 && ctx.time - s.flip[o.b] < FLIP_TIME + 2 ? 'That blade is still settling' : true
      },
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const o = onBlade(s.vis.th, target.pos.x, target.pos.z)
        if (o.b < 0) return
        s.flip[o.b] = r2(ctx.time + 0.25)
        ctx.emit({ k: 'flick', b: o.b })
        ctx.fx.sfx('click', target.pos)
        ctx.fx.popup(target, 'Blade flick!', '#fcd34d')
      },
      botUse: (ctx, s, user) => {
        // Flick a blade with the most rivals on it (not ours).
        const mine = onBlade(s.vis.th, user.pos.x, user.pos.z).b
        let best: Toy | null = null, bc = 0
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play') continue
          const o = onBlade(s.vis.th, t.pos.x, t.pos.z)
          if (!o.on || o.r < HUB_R || o.b === mine) continue
          const c = ctx.toys.filter((x) => x.status === 'play' && onBlade(s.vis.th, x.pos.x, x.pos.z).b === o.b).length
          if (c > bc) {
            bc = c
            best = t
          }
        }
        return best ?? false
      },
    },
    {
      id: 'cord',
      name: 'Pull the Cord',
      icon: 'wind',
      cost: 3,
      cooldown: 15,
      busy: 1,
      once: true,
      target: 'none',
      desc: 'Yank the pull cord: one speed setting faster for 6 seconds, for everyone (you too).',
      counter: 'Stay near the hub when someone reaches for the cord.',
      can: (ctx, s) => (s.boost > ctx.time ? 'Already boosted' : true),
      apply: (ctx, s, user) => {
        s.boost = ctx.time + 6
        ctx.fx.say(`${user.name} PULLED THE CORD!`, '#fbbf24', 1.5)
        ctx.fx.sfx('click')
        ctx.fx.shake(0.3)
      },
      botUse: (ctx, s, user) => {
        // Only from the safety of the hub.
        return Math.hypot(user.pos.x, user.pos.z) < HUB_R - 0.2 && s.level >= 2 && ctx.rng.chance(0.4) ? null : false
      },
    },
    bubbleWrap<FanState>(2),
  ],

  build(ctx) {
    // A bedroom far below, in the attic.
    buildAttic(ctx.root, ctx.assets, null, { hw: 24, hd: 24, ridge: 34, knee: 12, y: FLOOR_Y, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    const rug = new THREE.Mesh(new THREE.CircleGeometry(9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      map: paint(256, 256, (g, w) => {
        for (let i = 12; i > 0; i--) {
          g.fillStyle = ['#1e3a8a', '#fbbf24', '#be123c', '#f8fafc'][i % 4]
          g.beginPath()
          g.arc(w / 2, w / 2, (i / 12) * (w / 2), 0, Math.PI * 2)
          g.fill()
        }
      }),
      roughness: 1,
    }))
    rug.position.y = FLOOR_Y + 0.02
    ctx.root.add(rug)
    const bed = new THREE.Group()
    const frame = new THREE.Mesh(rbox(9, 2.4, 14, 0.3), flat('#7c4a24'))
    frame.position.y = 1.2
    const mattress = new THREE.Mesh(rbox(8.4, 1.4, 13, 0.5), soft('#e0e7ff'))
    mattress.position.y = 2.9
    const quilt = new THREE.Mesh(rbox(8.8, 0.5, 9, 0.25), soft('#f472b6', { map: paint(64, 64, (g, w, h) => {
      g.fillStyle = '#f9a8d4'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#fbcfe8'
      for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) if (((x + y) / 16) % 2 === 0) g.fillRect(x, y, 16, 16)
    }, [4, 4]) }))
    quilt.position.set(0, 3.7, 2)
    const pillow = new THREE.Mesh(rbox(5, 0.9, 2.2, 0.4), soft('#ffffff'))
    pillow.position.set(0, 3.9, -4.8)
    const head = new THREE.Mesh(rbox(9, 5, 0.6, 0.2), flat('#7c4a24'))
    head.position.set(0, 2.5, -7)
    bed.add(frame, mattress, quilt, pillow, head)
    bed.position.set(-12, FLOOR_Y, -8)
    bed.rotation.y = 0.2
    ctx.root.add(bed)
    const chest = prop(ctx.assets, 'chest', 5, 'width')
    chest.position.set(13, FLOOR_Y, 6)
    chest.rotation.y = -0.8
    const chair = prop(ctx.assets, 'armchair', 6, 'height')
    chair.position.set(12, FLOOR_Y, -12)
    chair.rotation.y = -0.6
    const horse = prop(ctx.assets, 'horse', 5, 'height')
    horse.position.set(-10, FLOOR_Y, 12)
    horse.rotation.y = 2
    ctx.root.add(chest, chair, horse)
    // The downrod and ceiling canopy.
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 16, 10), flat('#c08a2b', { metalness: 0.6, roughness: 0.35 }))
    rod.position.y = 2.3 + 8
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 0.8, 16), flat('#c08a2b', { metalness: 0.6, roughness: 0.35 }))
    canopy.position.y = 18
    ctx.root.add(rod, canopy)
    // A warm glow from the fan's lamp onto the room.
    const lamp = new THREE.PointLight('#ffcf7a', 60, 40, 1.6)
    lamp.position.set(0, -1.6, 0)
    ctx.root.add(lamp)
  },

  init(ctx) {
    const st: FanState = {
      theta: 0,
      omega: 0,
      level: 1,
      boost: 0,
      flip: new Array(BLADES).fill(-1),
      survive: ctx.toys.map(() => 0),
      cordHit: new Map(),
      vis: { th: 0, blades: [], hub: null, cords: [], lamp: null, hum: 0 },
      bodies: { blades: [], hub: null },
    }
    const tex = woodTexture()
    for (let b = 0; b < BLADES; b++) {
      const m = bladeMesh(tex.clone())
      ctx.root.add(m)
      st.vis.blades.push(m)
      const body = ctx.phys.kinematic({ x: 0, y: 0, z: 0 })
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid((B_OUT - B_IN) / 2, B_T / 2, B_W).setTranslation((B_IN + B_OUT) / 2, -B_T / 2, 0), { friction: 0.8 })
      st.bodies.blades.push(body)
    }
    const hub = hubMesh()
    ctx.root.add(hub.g)
    st.vis.hub = hub.g
    st.vis.lamp = hub.lamp
    const hb = ctx.phys.kinematic({ x: 0, y: 0, z: 0 })
    ctx.phys.attach(hb, ctx.RAPIER.ColliderDesc.cylinder(0.3, HUB_R).setTranslation(0, -0.3, 0), { friction: 0.8 })
    ctx.phys.attach(hb, ctx.RAPIER.ColliderDesc.cylinder(1.15, MOTOR_R).setTranslation(0, 1.15, 0), { friction: 0.2 })
    st.bodies.hub = hb
    for (let i = 0; i < 2; i++) {
      const c = cordMesh()
      ctx.root.add(c)
      st.vis.cords.push(c)
    }

    // The fan turns on every screen (clients extrapolate the synced angle); it carries and flings toys.
    ctx.hazards.add({
      predict: true,
      update(c, t, dt) {
        const v = st.vis
        if (c.isHost) v.th = st.theta
        else {
          v.th += st.omega * dt
          v.th += wrap(st.theta - v.th) * Math.min(1, dt * 4)
        }
        for (let b = 0; b < BLADES; b++) st.bodies.blades[b].setNextKinematicRotation(bladeQuat(st, b, v.th, t, _q))
        tilt(st.level, v.th, t, _qt)
        _qy.setFromAxisAngle(_up, v.th)
        st.bodies.hub?.setNextKinematicRotation(_q.copy(_qt).multiply(_qy))
      },
      affect(c, toy, dt) {
        if (toy.status === 'failed' || c.phase !== 'play') return
        const v = st.vis
        const hang = toy.data.hang as { i: number; r: number; until: number } | undefined
        if (hang) {
          // Riding a pull cord: carried round with it, until Grab is let go (or it slips).
          const a = cordAngle(st, hang.i, v.th + st.omega * dt, c.time + dt)
          const x = Math.cos(a) * hang.r, z = -Math.sin(a) * hang.r
          if (!toy.pad.grab || c.time > hang.until || !cordsOut(st) || toy.stun > 0) {
            toy.data.hang = undefined
            return
          }
          toy.body.setTranslation({ x, y: CORD_Y - 0.55, z }, true)
          toy.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          return
        }
        if (toy.feet < -1.2 || toy.feet > 0.7) return
        const o = onBlade(v.th, toy.pos.x, toy.pos.z)
        if (!o.on || (!toy.grounded && toy.feet > 0.25)) return
        // Carried round with the fan, and flung outwards (harder the faster and further out).
        const da = st.omega * dt
        const p = toy.body.translation()
        const cs = Math.cos(da), sn = Math.sin(da)
        let nx = p.x * cs + p.z * sn, nz = -p.x * sn + p.z * cs
        const r = Math.hypot(nx, nz)
        if (r > 0.05) {
          const out = 0.2 * st.omega * st.omega * r * dt
          nx += (nx / r) * out
          nz += (nz / r) * out
        }
        toy.body.setTranslation({ x: nx, y: p.y, z: nz }, true)
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    // Spread over the blades, a couple per blade.
    const b = i % BLADES
    const k = Math.floor(i / BLADES)
    bladePoint(0, b, 3.2 + k * 1.5, 0, _p)
    void n
    return { x: _p.x, y: 0, z: _p.z, yaw: ctx.rng.range(0, Math.PI * 2) }
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const active = ctx.active()
    const press = ctx.mode === 'show' ? Math.max(0, (t / 120 - 0.6) / 0.4) * (active.length > ctx.target ? 1 : 0.2) : 0
    // Speed settings.
    const lvl = t >= SPEED_AT[3] ? 3 : t >= SPEED_AT[2] ? 2 : 1
    if (ctx.round.final && t >= 95 && t - dt < 95) {
      ctx.fx.say('OVERDRIVE!', '#f87171', 1.6)
      ctx.fx.shake(0.5)
    }
    if (lvl !== s.level) {
      s.level = lvl
      ctx.fx.say(`SPEED ${lvl}!`, lvl === 3 ? '#f87171' : '#fbbf24', 1.6)
      ctx.fx.sfx('click')
      ctx.fx.shake(0.4)
      if (lvl === 2) ctx.fx.feed('The pull cords swing out!')
    }
    // A final has to end: in the last 25 s the fan runs past its top setting.
    const overdrive = ctx.round.final && t > 95 ? (t - 95) * 0.035 : 0
    const target = OMEGA[Math.min(3, s.level + (s.boost > t ? 1 : 0))] + (s.boost > t && s.level === 3 ? 0.35 : 0) + press * 0.25 + overdrive
    s.omega += THREE.MathUtils.clamp(target - s.omega, -0.4 * dt, 0.4 * dt)
    s.theta += s.omega * dt
    // Pull cords sweep across the blades at chest height: jump them or grab them.
    if (cordsOut(s)) {
      for (let i = 0; i < 2; i++) {
        const a = cordAngle(s, i, s.theta, t)
        const ex = Math.cos(a), ez = -Math.sin(a)
        for (const toy of active) {
          if (toy.data.hang) continue
          const along = toy.pos.x * ex + toy.pos.z * ez
          if (along < HUB_R - 0.1 || along > MOTOR_R + CORD_LEN + 0.4) continue
          _seg.set(toy.pos.x - ex * along, 0, toy.pos.z - ez * along)
          const d = _seg.length()
          if (d > 0.55 || toy.feet > CORD_Y - 0.2 || toy.feet < -1) continue
          if (toy.pad.grab && toy.canAct) {
            toy.data.hang = { i, r: along, until: t + 2.6 }
            ctx.fx.sfx('squeak', toy.pos)
            ctx.fx.popup(toy, 'Hold on!', '#fde68a')
            ctx.addSprinkles(toy, 1, 'cord ride')
            continue
          }
          const key = `${i}:${toy.idx}`
          if ((s.cordHit.get(key) ?? -9) > t - 0.8) continue
          s.cordHit.set(key, t)
          // The cords lag behind the blades, so a cord sweeps a toy backwards off the trailing edge.
          ctx.knock(toy, { x: -ez * 2.8, y: 3.4, z: ex * 2.8 }, 0.4)
          ctx.fx.sfx('thud', toy.pos)
        }
      }
    }
    // Blade flicks: a flipping blade throws what is on it sideways.
    for (let b = 0; b < BLADES; b++) {
      const f = s.flip[b]
      if (f < 0 || t < f || t - f > 0.2) continue
      for (const toy of active) {
        const o = onBlade(s.theta, toy.pos.x, toy.pos.z)
        if (o.b !== b || o.r < HUB_R || !toy.grounded) continue
        const a = s.theta + (b / BLADES) * Math.PI * 2
        const lx = -Math.sin(a), lz = -Math.cos(a)
        if ((toy.data.flipT as number) === f) continue
        toy.data.flipT = f
        ctx.knock(toy, { x: lx * 3.8, y: 4, z: lz * 3.8 }, 0.45)
      }
    }
    for (const toy of active) {
      s.survive[toy.idx] += dt
      if (s.survive[toy.idx] >= 10) {
        s.survive[toy.idx] -= 10
        ctx.addSprinkles(toy, 1)
      }
    }
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const t = ctx.time
    const th = s.vis.th
    const d = toy.data as { b?: number; r?: number; until?: number; hang?: unknown; ride?: number; grabUntil?: number }
    // Riding a cord: let go once over a blade, near the middle of it.
    if (d.hang) {
      const o = onBlade(th, toy.pos.x, toy.pos.z)
      toy.pad.grab = !(o.on && Math.abs(o.lat) < B_W * 0.5 && o.r > HUB_R && t > (d.ride ?? 0))
      return
    }
    if ((d.grabUntil ?? 0) > t) toy.pad.grab = true
    const o = onBlade(th, toy.pos.x, toy.pos.z)
    const hubCount = ctx.toys.filter((x) => x !== toy && x.status === 'play' && Math.hypot(x.pos.x, x.pos.z) < HUB_R).length
    if (d.b === undefined || (d.until ?? 0) < t) {
      d.until = t + ctx.rng.range(2, 4)
      // Inner when fast; the hub if there's room.
      const want = s.level === 1 ? ctx.rng.range(3, 5.5) : s.level === 2 ? ctx.rng.range(2.2, 3.6) : ctx.rng.range(1.7, 2.8)
      if (s.level >= 2 && hubCount < 4 && ctx.rng.chance(0.35 + s.level * 0.1)) d.r = 1.4
      else d.r = want
      const counts = new Array(BLADES).fill(0)
      for (const x of ctx.toys) if (x !== toy && x.status === 'play') {
        const ox = onBlade(th, x.pos.x, x.pos.z)
        if (ox.b >= 0 && ox.r > HUB_R) counts[ox.b]++
      }
      const here = o.b >= 0 ? o.b : 0
      d.b = counts[here] <= Math.min(...counts) + 1 ? here : counts.indexOf(Math.min(...counts))
    }
    // A flick on our blade: run for the hub.
    const flipping = o.b >= 0 && s.flip[o.b] >= 0 && t > s.flip[o.b] - 0.25 + sk.reaction * 0.5 && t < s.flip[o.b] + FLIP_TIME
    const r = flipping ? 1 : d.r ?? 3
    // Moving to another blade means going via the hub.
    const b = d.b ?? 0
    let gx: number, gz: number
    if (o.b !== b && o.r > HUB_R - 0.2) {
      // Off to another blade: back to the hub first…
      bladePoint(th, o.b >= 0 ? o.b : b, 1.4, 0, _p)
    } else if (o.b !== b) {
      // …round the hub ring to the right blade's root…
      bladePoint(th + s.omega * 0.3, b, 1.45, 0, _p)
    } else bladePoint(th + s.omega * 0.25, b, r, 0, _p)
    gx = _p.x
    gz = _p.z
    if (r < 1.5 && o.b === b) {
      // On the hub: a spot round the motor.
      const a = Math.atan2(toy.pos.z, toy.pos.x)
      gx = Math.cos(a) * 1.45
      gz = Math.sin(a) * 1.45
    }
    steerTo(toy, gx, gz, { pace: sk.pace, stop: 0.15 })
    // Lean in against the fling.
    const rr = Math.hypot(toy.pos.x, toy.pos.z)
    if (rr > 2) {
      toy.pad.mx -= (toy.pos.x / rr) * 0.15 * s.level
      toy.pad.mz -= (toy.pos.z / rr) * 0.15 * s.level
    }
    // Cords: jump as one sweeps in (or grab it now and then).
    if (cordsOut(s) && toy.grounded) {
      for (let i = 0; i < 2; i++) {
        const a = cordAngle(s, i, th, t)
        const ex = Math.cos(a), ez = -Math.sin(a)
        const along = toy.pos.x * ex + toy.pos.z * ez
        if (along < MOTOR_R || along > MOTOR_R + CORD_LEN) continue
        // Relative to a toy riding the blades, a cord sweeps backwards at CORD_SLIP rad/s.
        const sn = toy.pos.x * ez - toy.pos.z * ex
        const eta = -sn / (CORD_SLIP * along)
        if (eta > 0.05 && eta < 0.32) {
          if (ctx.rng.chance(0.15 * sk.aggression)) {
            d.grabUntil = t + 0.5
            d.ride = t + 0.8
          } else if (ctx.rng.chance(sk.accuracy)) toy.pad.jump = true
        }
      }
    }
    if (flipping && toy.grounded && t > s.flip[o.b] - 0.1 && ctx.rng.chance(sk.accuracy * 0.5)) toy.pad.jump = true
    // Crowded hub: shove someone out.
    if (rr < HUB_R && hubCount >= 4) {
      for (const x of ctx.toys) {
        if (x === toy || x.status !== 'play' || x.pos.distanceTo(toy.pos) > 1.2) continue
        if (ctx.rng.chance(sk.aggression * 2.5 * dt)) {
          toy.pad.mx = x.pos.x - toy.pos.x
          toy.pad.mz = x.pos.z - toy.pos.z
          toy.pad.shove = true
        }
      }
    }
  },

  rank(ctx) {
    // Nearest the middle is best.
    return ctx.active().sort((a, b) => Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'closest to the hub', "too far out on the blades")
  },

  onFall(ctx, _s, toy) {
    toy.data.hang = undefined
    ctx.fail(toy, toy.grudge ? `flung off (thanks, ${toy.grudge.name})` : 'flung off the fan')
  },

  retry(ctx, s, toy) {
    toy.data.hang = undefined
    bladePoint(s.vis.th, ctx.rng.int(0, BLADES), 1.4, 0, _p)
    ctx.respawn(toy, { x: _p.x, y: 0.2, z: _p.z, yaw: 0 }, 1)
  },

  pack(_c, s) {
    return [Math.round(s.theta * 1000) / 1000, Math.round(s.omega * 1000) / 1000, s.level, r2(s.boost), s.flip]
  },

  unpack(_c, s, d) {
    const [theta, omega, level, boost, flip] = d as [number, number, number, number, number[]]
    s.theta = theta
    s.omega = omega
    s.level = level
    s.boost = boost
    s.flip = flip
  },

  onEvent(ctx, s, data) {
    const e = data as { k?: string; b?: number }
    if (e.k === 'flick' && e.b !== undefined) {
      bladePoint(s.vis.th, e.b, 5, 0, _p)
      ctx.fxLocal.puff({ x: _p.x, y: 0.3, z: _p.z }, 'dust', 10)
    }
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    for (let b = 0; b < BLADES; b++) v.blades[b].quaternion.copy(bladeQuat(s, b, v.th, t, _q))
    if (v.hub) {
      tilt(s.level, v.th, t, _qt)
      _qy.setFromAxisAngle(_up, v.th)
      v.hub.quaternion.copy(_qt).multiply(_qy)
    }
    // Cords: hanging down at speed 1, swinging out into bars after.
    const out = cordsOut(s)
    v.cords.forEach((c, i) => {
      const a = out ? cordAngle(s, i, v.th, t) : v.th + i * Math.PI + 0.3
      c.position.set(0, out ? CORD_Y : -0.2, 0)
      c.rotation.set(0, a, out ? Math.sin(t * 3 + i) * 0.04 : -1.35 + Math.sin(t * 2 + i) * 0.08)
    })
    if (v.lamp) v.lamp.emissiveIntensity = 0.8 + Math.sin(t * 50) * 0.03 * s.level
    // A hum that rises with the speed (local, throttled).
    v.hum -= dt
    if (ctx.phase === 'play' && v.hum <= 0) {
      v.hum = Math.max(0.5, 2.2 - s.omega * 1.2)
      ctx.fxLocal.sfx(s.level >= 3 ? 'wind' : 'whoosh', { x: 0, y: 0, z: 0 })
    }
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const chips = [`Speed ${s.level}${s.boost > t ? ' (boosted!)' : ''}`]
    const next = SPEED_AT.find((a) => a > t)
    if (next !== undefined && ctx.phase === 'play') chips.push(`Speed ${s.level + 1} in ${Math.ceil(next - t)} s`)
    const onHub = ctx.toys.filter((x) => x.status === 'play' && Math.hypot(x.pos.x, x.pos.z) < HUB_R).length
    chips.push(`On the hub: ${onHub}`)
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    const bars: { label: string; value: number; color: string; danger?: boolean }[] = []
    if (me && me.status === 'play') {
      const r = Math.hypot(me.pos.x, me.pos.z)
      const fling = Math.min(1, (s.omega * s.omega * r) / 9)
      bars.push({ label: 'Fling', value: fling, color: '#fb923c', danger: fling > 0.6 })
      if (me.data.hang) status = { text: 'RIDING THE CORD: LET GO OVER A BLADE', color: '#fde68a', pulse: true }
      else {
        const o = onBlade(s.vis.th, me.pos.x, me.pos.z)
        if (o.b >= 0 && s.flip[o.b] >= 0 && t > s.flip[o.b] - 0.25 && t < s.flip[o.b] + FLIP_TIME && r > HUB_R) status = { text: 'YOUR BLADE IS FLIPPING!', color: '#f87171', pulse: true }
      }
      if (t < 6) prompt = 'Stay on the blades. The faster it spins, the harder it flings!'
      else if (cordsOut(s) && t < SPEED_AT[2] + 6) prompt = 'Pull cords! Jump over them, or hold Grab to ride one.'
    }
    return { chips, prompt, status, bars }
  },
})

