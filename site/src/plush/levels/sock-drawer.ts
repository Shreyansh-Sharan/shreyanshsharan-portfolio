// Sock Drawer Dash (race). Through a giant open dresser: drawers punch out of the sides like pistons, then a pit
// you cross on a wave of sliding drawers, then rolled socks bounce you up to the dresser top (or dive into the
// mothball tunnel), and the last stretch is the dresser top while the house cat swipes across it.
// Tricks: slam a drawer shut under a rival (or fire a piston at them), catnip the cat onto a rival, and snag a
// rival's feet with a loose sock.
import * as THREE from 'three'
import { prop, propSize, tiledMaterial } from '../engine/assets'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { FOOT } from '../engine/toy'
import { defineLevel, type Toy } from '../engine/types'
import {
  Course, bake, canvasTex, detachDecor, finishArch, follow, hash01, mat, mover, poseOf, raceHud, raceInit, racePack, raceRank, raceRespawn, raceSpawn,
  raceSpeedHazard, raceTick, raceUnpack, rbox, solid, stripeTex, trampoline, type BotMem, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#a78bfa'
const HW = 5 // half width of the course
const TOP = 4.2 // dresser top height
const PISTONS = [
  { z: -38, side: -1, phase: 0 },
  { z: -32.5, side: 1, phase: 1.1 },
  { z: -27, side: -1, phase: 2.0 },
  { z: -21.5, side: 1, phase: 0.6 },
]
const PISTON_P = 3
const ROWS = [-9.6, -4.8, 0, 4.8, 9.6]
const ROW_P = 5
const ROW_LAG = 0.16
const SOCKS = [-1.2, 2.4]
const SOCK_Z = 23
const TUNNEL = { x: -3.9, exit: 33 }
const PAW_WARN = 1.0
const PAW_SWING = 0.7

interface SDState {
  race: RaceState
  /** Round time a piston was fired early by a trick (-9 none). */
  fire: number[]
  /** Round time a drawer row was slammed shut by a trick. */
  slam: number[]
  /** Next cat swipe: start time of the swing, and its z band. */
  paw: [number, number]
  // Host only.
  pawHit: Set<Toy>
  // Visuals.
  vis: { paw: THREE.Group | null; shadow: THREE.Mesh | null; cat: THREE.Group | null; head: THREE.Object3D | null }
}

/** Piston extension 0..1 at time t: fast out, a short hold, slow back. */
function pistonK(st: SDState, i: number, t: number) {
  const f = st.fire[i]
  let u: number
  if (f > -1 && t - f < PISTON_P * 0.6) u = (t - f) / PISTON_P
  else u = ((((t + PISTONS[i].phase) / PISTON_P) % 1) + 1) % 1
  if (u < 0.25) return THREE.MathUtils.smootherstep(u / 0.25, 0, 1)
  if (u < 0.45) return 1
  return 1 - THREE.MathUtils.smoothstep((u - 0.45) / 0.55, 0, 1)
}

/** Drawer row phase (0..1); open while < 0.56. */
function rowU(k: number, t: number) {
  return ((((t / ROW_P) - ROW_LAG * k) % 1) + 1) % 1
}

/** How far a drawer row is open (1 = bridging the pit). */
function rowOpen(st: SDState, k: number, t: number) {
  const u = rowU(k, t)
  let o: number
  if (u < 0.56) o = 1
  else if (u < 0.72) o = 1 - THREE.MathUtils.smoothstep((u - 0.56) / 0.16, 0, 1)
  else if (u < 0.84) o = 0
  else o = THREE.MathUtils.smoothstep((u - 0.84) / 0.16, 0, 1)
  const s = st.slam[k]
  if (s > -1 && t - s < 2.2) {
    const e = t - s
    const k2 = e < 0.3 ? e / 0.3 : e > 1.7 ? 1 - (e - 1.7) / 0.5 : 1
    o = Math.min(o, 1 - THREE.MathUtils.clamp(k2, 0, 1))
  }
  return o
}

/** Where the paw is during a swing (x), or null outside it. */
function pawX(st: SDState, t: number) {
  const e = t - st.paw[0]
  if (e < 0 || e > PAW_SWING) return null
  return THREE.MathUtils.lerp(-10, 10, THREE.MathUtils.smoothstep(e / PAW_SWING, 0, 1))
}

function buildPath(sock: number, tunnel: boolean): Wp[] {
  const p: Wp[] = [
    { x: 0, y: 0, z: -48, w: 3 },
    { x: 2.8, y: 0, z: -41, w: 1.2 },
    { x: 2.8, y: 0, z: -36.5, w: 1 },
    { x: -2.8, y: 0, z: -34.5, w: 1 },
    { x: -2.8, y: 0, z: -30.5, w: 1 },
    { x: 2.8, y: 0, z: -29, w: 1 },
    { x: 2.8, y: 0, z: -25, w: 1 },
    { x: -2.8, y: 0, z: -23.5, w: 1 },
    { x: -2.8, y: 0, z: -19.5, w: 1 },
    { x: 0, y: 0, z: -16, w: 3 },
    { x: 0, y: 0, z: -13.1, w: 3, wait: 1, r: 0.6 },
    ...ROWS.map((z) => ({ x: 0, y: 0, z, w: 2.6, noGap: true, r: 1.4 })),
    { x: 0, y: 0, z: 15, w: 3 },
  ]
  if (tunnel) p.push({ x: TUNNEL.x, y: 0, z: 23, r: 0.7 }, { x: TUNNEL.x, y: 0, z: 25.7, dive: 2.3, r: 0.3 })
  else p.push({ x: SOCKS[sock], y: 0.55, z: SOCK_Z, r: 0.7 }, { x: SOCKS[sock] * 0.6, y: TOP, z: 29, minY: TOP - 0.3, w: 1.5 })
  p.push({ x: 0, y: TOP, z: 36, w: 3 }, { x: 0, y: TOP, z: 43, w: 3 }, { x: 0, y: TOP, z: 50, w: 3 }, { x: 0, y: TOP, z: 57.8, w: 3 })
  return p
}

const PATHS = [buildPath(0, false), buildPath(1, false), buildPath(0, true)]

const course = new Course({
  path: PATHS[0],
  cps: [
    { x: 0, y: 0, z: -15.5, hx: HW - 0.4, hz: 2.5, yaw: 0, name: 'Drawer ledge' },
    { x: 0, y: 0, z: 15.5, hx: HW - 0.4, hz: 3, yaw: 0, name: 'Sock hop' },
    { x: 0, y: TOP, z: 30.5, hx: HW - 0.4, hz: 4.2, yaw: 0, name: 'Dresser top' },
    { x: 0, y: TOP, z: 45.5, hx: HW - 0.4, hz: 1.5, yaw: 0, name: 'Halfway across' },
  ],
  finish: { x: 0, y: TOP, z: 57.6, hx: HW, hz: 0.7 },
  podium: { x: 0, y: TOP, z: 61.4, yaw: Math.PI },
})

/** Folded socks in a drawer, seen from above. */
function sockTopTex() {
  const cols = ['#f472b6', '#60a5fa', '#facc15', '#34d399', '#f87171', '#a78bfa', '#fb923c']
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#6b4226'
    g.fillRect(0, 0, w, h)
    let i = 0
    for (let y = 16; y < h; y += 30)
      for (let x = 18 + ((y / 30) % 2) * 14; x < w; x += 32) {
        g.fillStyle = cols[i++ % cols.length]
        g.beginPath()
        g.arc(x, y, 14, 0, Math.PI * 2)
        g.fill()
        g.strokeStyle = 'rgba(255,255,255,0.55)'
        g.lineWidth = 3
        g.beginPath()
        g.arc(x, y, 8, 0, Math.PI * 2)
        g.stroke()
      }
  })
}

function knob(r = 0.22) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat('#d4a24c', { metalness: 0.7, roughness: 0.3 }))
}

/** A plush house cat: body, head with ears and eyes, a striped tail. */
function catMesh() {
  const g = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ map: stripeTex('#f59e0b', '#c2410c', 5, true), roughness: 0.95 })
  const cream = mat('#fde7c4', { roughness: 0.95 })
  const body = new THREE.Mesh(new THREE.SphereGeometry(3.4, 20, 14), fur)
  body.scale.set(1, 1.15, 1.1)
  body.position.y = 3.4
  const head = new THREE.Group()
  head.position.set(0, 8.2, 0.6)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14), fur)
  skull.scale.set(1.1, 0.95, 1)
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), cream)
  muzzle.position.set(1.7, -0.6, 0)
  muzzle.scale.set(0.8, 0.7, 1.1)
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), mat('#f472b6'))
  nose.position.set(2.45, -0.3, 0)
  head.add(skull, muzzle, nose)
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 4), fur)
    ear.position.set(0.1, 2.1, s * 1.2)
    ear.rotation.x = s * 0.35
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), mat('#4ade80', { emissive: '#166534', emissiveIntensity: 0.4 }))
    eye.position.set(1.95, 0.55, s * 0.85)
    eye.scale.set(0.5, 1, 1)
    const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.16), mat('#111827'))
    pupil.position.set(2.2, 0.55, s * 0.85)
    head.add(ear, eye, pupil)
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.55, 8, 16, Math.PI * 1.2), fur)
  tail.position.set(-2.4, 1.2, -2.2)
  tail.rotation.set(Math.PI / 2, 0, 0.4)
  g.add(body, head, tail)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return { g, head }
}

/** The swiping paw: a furry arm with a pad and pink toe beans, pointing along +x. */
function pawMesh() {
  const g = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ map: stripeTex('#f59e0b', '#c2410c', 4, false), roughness: 0.95 })
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 11, 12).rotateZ(Math.PI / 2), fur)
  arm.position.x = -5.8
  const pad = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), fur)
  pad.scale.set(1, 0.7, 1.15)
  const bean = mat('#f9a8d4', { roughness: 0.6 })
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), bean)
    b.position.set(0.95, -0.25, (i - 1.5) * 0.48)
    g.add(b)
  }
  g.add(arm, pad)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

function onDrawerRow(t: Toy) {
  if (Math.abs(t.feet) > 0.6) return -1
  for (let k = 0; k < ROWS.length; k++) if (Math.abs(t.pos.z - ROWS[k]) < 2.5) return k
  return -1
}

export default defineLevel<SDState>({
  id: 'sock-drawer',
  name: 'Sock Drawer Dash',
  type: 'race',
  blurb: 'Dash through a giant dresser: piston drawers, a pit of sliding drawers, sock trampolines and a cat.',
  howTo: [
    'Dodge the drawers that punch out of the sides',
    'Cross the pit on the wave of opening drawers: go as the first one opens',
    'Bounce up on a rolled sock, or DIVE into the mothball tunnel',
    'On the dresser top, watch for the paw shadow',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 150,
  camera: { kind: 'chase', dist: 7.2 },
  introOrbit: { radius: 30, height: 18, center: [0, 0, 4] },
  sprinkles: { start: 1 },
  fallY: -5,
  sky: { color: '#2a1a12', fogNear: 60, fogFar: 170 },

  tricks: [
    {
      id: 'slam',
      name: 'Slam Shut',
      icon: 'slam',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'Slam the drawer they stand on shut, or fire the nearest piston drawer at them.',
      counter: 'Keep moving across the drawers, and stay off the piston side.',
      can: (_c, _s, _u, t) => (t && (onDrawerRow(t) >= 0 || (t.pos.z > -42 && t.pos.z < -18 && t.feet < 1)) ? true : 'Only near the drawers'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const row = onDrawerRow(target)
        if (row >= 0) {
          s.slam[row] = ctx.time
          ctx.fx.sfx('slam', target.pos)
          ctx.fx.popup(target, 'SLAM!', '#fca5a5')
          return
        }
        let best = 0
        for (let i = 1; i < PISTONS.length; i++) if (Math.abs(PISTONS[i].z - target.pos.z) < Math.abs(PISTONS[best].z - target.pos.z)) best = i
        s.fire[best] = ctx.time
        ctx.fx.sfx('whoosh', target.pos)
        ctx.fx.popup(target, 'Drawer!', '#fca5a5')
      },
      botUse: (ctx, _s, user) => {
        const r = ctx.toys.find((t) => t !== user && t.status === 'play' && onDrawerRow(t) >= 0 && t.pos.z > user.pos.z - 2)
        return r ?? false
      },
    },
    {
      id: 'catnip',
      name: 'Catnip',
      icon: 'paw',
      cost: 2,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: 'Sprinkle catnip on a rival on the dresser top: the next swipe comes straight at them.',
      counter: 'Watch for the shadow and step out of its stripe.',
      can: (_c, _s, _u, t) => (t && t.feet > TOP - 0.5 ? true : 'Only on the dresser top'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const swinging = ctx.time >= s.paw[0] - PAW_WARN && ctx.time <= s.paw[0] + PAW_SWING
        s.paw[0] = swinging ? s.paw[0] + PAW_SWING + 0.3 + PAW_WARN : ctx.time + 1.1
        s.paw[1] = THREE.MathUtils.clamp(target.pos.z, 28, 56)
        s.pawHit.clear()
        ctx.fx.popup(target, 'Catnip!', '#bef264')
        ctx.fx.sfx('squeak', target.pos)
      },
      botUse: (ctx, _s, user) => {
        const lead = ctx.leader(user)
        return lead && lead.feet > TOP - 0.5 ? lead : false
      },
    },
    {
      id: 'snag',
      name: 'Sock Snag',
      icon: 'tack',
      cost: 1,
      cooldown: 7,
      busy: 0.5,
      target: 'rival',
      range: 10,
      desc: 'Flick a loose sock round their feet: half speed for 2.5 seconds.',
      counter: 'Bounce on a rolled sock to shake it off.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.race.slow[target.idx] = ctx.time + 2.5
        ctx.fx.popup(target, 'Snagged!', '#fca5a5')
        ctx.fx.sfx('snip', target.pos)
      },
    },
    bubbleWrap<SDState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 34, hd: 80, ridge: 34, knee: 7, y: -14, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    const wood = tiledMaterial(ctx.assets, 'floor', 2, '#9a6b43')
    const dark = mat('#5b3a22')
    const panel = mat('#a8774f')
    // The pulled-out bottom drawer: start, piston alley and the ledge before the pit.
    solid(ctx, { pos: [0, -0.5, -34.1], size: [HW * 2, 1, 43.8], material: wood })
    // Its sides: low lips.
    for (const s of [-1, 1]) solid(ctx, { pos: [s * (HW - 0.12), 0.15, -34.1], size: [0.24, 0.3, 43.8], material: panel, round: 0.08 })
    // Drawer front behind the start, with two big knobs.
    const front = solid(ctx, { pos: [0, 0.4, -56.3], size: [HW * 2 + 0.6, 4, 0.6], material: panel, round: 0.15 })
    for (const s of [-1, 1]) {
      const k = knob(0.4)
      k.position.set(s * 2.6, 1.2, -0.45)
      front.add(k)
    }
    // Piston housings: chunks of dresser side with a slot each drawer shoots out of.
    for (const p of PISTONS) {
      const x = p.side * (HW + 2.8)
      solid(ctx, { pos: [x, 1.0, p.z], size: [5.4, 4, 4], material: panel, round: 0.2 })
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.9), mat('#1c1209'))
      slot.position.set(p.side * (HW + 0.09), 0.85, p.z)
      slot.rotation.y = p.side > 0 ? -Math.PI / 2 : Math.PI / 2
      ctx.root.add(slot)
    }
    // The pit: two tall cabinets either side (the drawers live in them), a dark bottom far below.
    for (const s of [-1, 1]) {
      const cab = solid(ctx, { pos: [s * (HW + 0.3 + 5.6), -1.9, 0], size: [11.2, 10.2, 24.4], material: panel })
      cab.castShadow = false
      ROWS.forEach((z) => {
        const slot = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.3), mat('#1c1209'))
        slot.position.set(s * (HW + 0.29), -0.55, z)
        slot.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2
        ctx.root.add(slot)
      })
    }
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 24.4).rotateX(-Math.PI / 2), mat('#120b06'))
    pit.position.set(0, -7, 0)
    ctx.root.add(pit)
    // Sock hop floor and the dresser body up to the top.
    solid(ctx, { pos: [0, -0.5, 19.1], size: [HW * 2, 1, 13.8], material: wood })
    for (const s of [-1, 1]) solid(ctx, { pos: [s * (HW - 0.12), 0.15, 19.1], size: [0.24, 0.3, 13.8], material: panel, round: 0.08 })
    const body = solid(ctx, { pos: [0, TOP / 2 - 4, 45], size: [HW * 2, TOP + 8, 38], material: panel })
    body.castShadow = false
    const topBoard = solid(ctx, { pos: [0, TOP - 0.15, 45], size: [HW * 2 + 0.5, 0.3, 38.4], material: wood, round: 0.1 })
    topBoard.castShadow = false
    // Drawer fronts on the face of the dresser (the wall you bounce over), with knobs.
    for (const s of [-1, 1]) {
      const df = new THREE.Mesh(rbox(4.3, 3.4, 0.25, 0.12), mat('#b9875c'))
      df.position.set(s * 2.4 + (s < 0 ? 0 : 0), 2.0, 25.95)
      ctx.root.add(df)
      const k = knob(0.3)
      k.position.set(s * 2.4 + (s < 0 ? 1.1 : 0), 2.2, 25.75)
      if (s > 0) ctx.root.add(k)
    }
    // Mothball tunnel mouth.
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), mat('#0b0705'))
    mouth.position.set(TUNNEL.x, 0.95, 25.8)
    mouth.rotation.y = Math.PI
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 8, 24), mat('#e7e5e4'))
    ring.position.copy(mouth.position).setZ(25.78)
    ctx.root.add(mouth, ring)
    const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), mat('#f5f5f4', { roughness: 0.4 }), 9)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      balls.setMatrixAt(i, m4.makeTranslation(TUNNEL.x + Math.cos(a) * 1.25, 0.95 + Math.sin(a) * 1.25, 25.7))
    }
    ctx.root.add(balls)
    const sign = textSprite('Mothball tunnel: DIVE in!', { bg: '#57534e', size: 0.45 })
    sign.position.set(TUNNEL.x, 2.55, 25.4)
    ctx.root.add(sign)
    // Dresser-top clutter: a jewellery tin and a box to run round, a mirror at the back.
    const tin = prop(ctx.assets, 'tin', 1.5)
    tin.position.set(3, TOP, 38.5)
    ctx.root.add(tin)
    const ts = propSize(tin)
    ctx.phys.cylinder({ x: 3, y: TOP + ts.y / 2, z: 38.5 }, ts.y / 2, Math.max(ts.x, ts.z) / 2)
    const box = prop(ctx.assets, 'boxes', 1.4)
    box.position.set(-3.1, TOP, 51)
    ctx.root.add(box)
    const bs = propSize(box)
    ctx.phys.box({ x: -3.1, y: TOP + bs.y / 2, z: 51 }, { x: bs.x / 2, y: bs.y / 2, z: bs.z / 2 })
    const mirror = new THREE.Mesh(rbox(8, 7, 0.3, 0.3), mat('#7c4a2b'))
    mirror.position.set(0, TOP + 4.5, 64.2)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), mat('#bfdbfe', { metalness: 0.9, roughness: 0.08, envMapIntensity: 1.5 }))
    glass.position.set(0, TOP + 4.5, 64.03)
    glass.rotation.y = Math.PI
    ctx.root.add(mirror, glass)
    ctx.phys.box({ x: 0, y: TOP + 2, z: 64.4 }, { x: HW, y: 2, z: 0.3 })
    finishArch(ctx, { x: 0, y: TOP, z: 57.6, width: HW * 2 - 0.4, color: ACCENT, text: 'FINISH' })
    const cp = (z: number, y: number, label: string) => {
      const s = textSprite(label, { bg: '#7c3aed', size: 0.55 })
      s.position.set(HW - 1, y + 2.6, z)
      ctx.root.add(s)
    }
    cp(-15.5, 0, 'Checkpoint')
    cp(15.5, 0, 'Checkpoint')
    cp(30, TOP, 'Checkpoint')
    cp(45.5, TOP, 'Checkpoint')
    // The dark interior behind it all reads as the inside of the dresser.
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), dark)
    back.position.set(0, -6, -57.5)
    ctx.root.add(back)
  },

  init(ctx) {
    const st: SDState = {
      race: raceInit(ctx),
      fire: PISTONS.map(() => -9),
      slam: ROWS.map(() => -9),
      paw: [6, 40],
      pawHit: new Set(),
      vis: { paw: null, shadow: null, cat: null, head: null },
    }
    raceSpeedHazard(ctx, st.race, 5.6)
    const panel = mat('#b98758')
    // Piston drawers.
    PISTONS.forEach((p, i) => {
      const g = new THREE.Group()
      const box = new THREE.Mesh(rbox(5, 1.6, 3, 0.12), panel)
      box.castShadow = box.receiveShadow = true
      const face = new THREE.Mesh(rbox(0.25, 1.9, 3.4, 0.08), mat('#d6a679'))
      face.position.x = -p.side * 2.55
      const k = knob(0.24)
      k.position.x = -p.side * 2.8
      g.add(box, face, k)
      mover(ctx, {
        half: [2.5, 0.8, 1.5],
        obj: bake(g),
        shove: 7.5,
        stun: 0.7,
        pose: (t, out) => {
          const k2 = pistonK(st, i, t)
          poseOf(out, p.side * THREE.MathUtils.lerp(HW + 2.7, 2.2, k2), 0.8, p.z)
          return true
        },
      })
    })
    // Drawer rows over the pit: full of rolled socks.
    const topTex = sockTopTex()
    const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.95 })
    const sideMat = mat('#a8774f')
    ROWS.forEach((z, k) => {
      const side = k % 2 ? 1 : -1
      const g = new THREE.Group()
      const box = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 1, 4.4), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat])
      box.receiveShadow = true
      const face = new THREE.Mesh(rbox(0.3, 1.4, 4.6, 0.1), mat('#d6a679'))
      face.position.set(-side * (HW + 0.1), -0.15, 0)
      const kn = knob(0.26)
      kn.position.set(-side * (HW + 0.35), -0.2, 0)
      g.add(box, face, kn)
      mover(ctx, {
        half: [HW, 0.5, 2.2],
        obj: bake(g),
        pose: (t, out) => {
          poseOf(out, side * THREE.MathUtils.lerp(HW * 2 + 0.6, 0, rowOpen(st, k, t)), -0.5, z)
          return true
        },
      })
    })
    // Rolled socks: trampolines in front of the dresser face.
    const sockMats = [
      new THREE.MeshStandardMaterial({ map: stripeTex('#f472b6', '#fdf2f8', 4, false, true), roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: stripeTex('#38bdf8', '#f0f9ff', 4, false, true), roughness: 1 }),
    ]
    SOCKS.forEach((x, i) => {
      const g = new THREE.Group()
      const roll = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 12), sockMats[i])
      roll.scale.set(1, 0.48, 1)
      roll.position.y = 0.28
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.2, 8, 20).rotateX(Math.PI / 2), sockMats[i])
      cuff.position.y = 0.55
      g.add(roll, cuff)
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
      trampoline(ctx, {
        x, y: 0, z: SOCK_Z, r: 1.15, top: 0.55, power: 16, obj: g,
        onBounce: (toy) => {
          if (st.race.slow[toy.idx] > ctx.time) {
            st.race.slow[toy.idx] = 0
            ctx.fx.popup(toy, 'Shook it off!', '#a7f3d0')
          }
        },
      })
    })
    // The cat and its paw.
    const cat = catMesh()
    cat.g.position.set(-12.5, -2, 47)
    cat.g.rotation.y = 0
    ctx.root.add(cat.g)
    st.vis.cat = cat.g
    st.vis.head = cat.head
    const paw = pawMesh()
    paw.visible = false
    ctx.root.add(paw)
    st.vis.paw = paw
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(HW * 2 + 0.4, 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: stripeTex('#7f1d1d', '#000000', 6, true), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    )
    shadow.position.y = TOP + 0.03
    ctx.root.add(shadow)
    st.vis.shadow = shadow
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return raceSpawn(ctx, { x: 0, y: 0, z: -50.5, yaw: 0 }, i, n)
  },

  tick(ctx, st) {
    const t = ctx.time
    raceTick(ctx, st.race, course)
    // The mothball tunnel: divers are whisked through to the dresser top.
    for (const toy of ctx.toys) {
      if (toy.status !== 'play' || (toy.dive <= 0 && toy.flop <= 0)) continue
      if (Math.abs(toy.pos.x - TUNNEL.x) < 1.05 && toy.pos.z > 24.3 && toy.pos.z < 26.2 && toy.feet < 1.2) {
        ctx.fx.puff(toy.pos, 'dust', 10)
        ctx.fx.sfx('whoosh', toy.pos)
        toy.teleport(TUNNEL.x + 0.3, TOP + FOOT + 0.1, TUNNEL.exit, 0)
        toy.body.setLinvel({ x: 0, y: 3, z: 6.5 }, true)
        toy.dive = 0
        toy.flop = 0
        ctx.fx.puff(toy.pos, 'spark', 14)
        ctx.fx.popup(toy, 'Shortcut!', '#e9d5ff')
        const d = toy.data as BotMem
        if (d.route === 2) d.wp = PATHS[2].length - 4
      }
    }
    // The cat: schedule swipes, sometimes aimed at whoever is on top.
    if (t > st.paw[0] + PAW_SWING + 0.2) {
      const gap = t < 50 ? 2.3 : t < 90 ? 1.6 : 1.1
      st.paw[0] = t + gap + PAW_WARN
      const onTop = ctx.toys.filter((x) => x.status === 'play' && x.feet > TOP - 0.5 && x.pos.z > 27 && x.pos.z < 57)
      st.paw[1] = onTop.length && ctx.rng.chance(0.55) ? THREE.MathUtils.clamp(ctx.rng.pick(onTop).pos.z + ctx.rng.range(-1, 1), 28, 56) : ctx.rng.range(28, 56)
      st.pawHit.clear()
    }
    const px = pawX(st, t)
    if (px !== null) {
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || st.pawHit.has(toy)) continue
        if (Math.abs(toy.pos.z - st.paw[1]) < 1.6 && Math.abs(toy.pos.x - px) < 1.4 && toy.feet > TOP - 0.6 && toy.feet < TOP + 2.2) {
          st.pawHit.add(toy)
          ctx.knock(toy, { x: 11, y: 5.5, z: ctx.rng.range(-1, 1) }, 1)
          ctx.fx.sfx('thud', toy.pos)
          ctx.fx.popup(toy, 'SWIPE!', '#fdba74')
          ctx.fx.shake(0.4, toy)
        }
      }
    }
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
    if (d.route === undefined) {
      const h = hash01(toy.idx, ctx.seed)
      d.route = h < 0.28 * sk.pace ? 2 : h < 0.64 ? 0 : 1
    }
    // The paw: get out of a warned stripe, and wait at the edge of one ahead.
    const t = ctx.time
    if (toy.feet > TOP - 0.6 && t > st.paw[0] - PAW_WARN && t < st.paw[0] + PAW_SWING) {
      const dz = toy.pos.z - st.paw[1]
      if (Math.abs(dz) < 2.1) {
        toy.pad.mz = dz > -0.6 ? 1 : -1
        toy.pad.mx = -toy.pos.x * 0.15
        return
      }
      if (dz < 0 && dz > -3.6) {
        toy.pad.mx = toy.pad.mz = 0
        return
      }
    }
    follow(ctx, toy, PATHS[d.route], {
      pace: sk.pace,
      dt,
      // Wait at the pit until the first drawer has just opened, then ride the wave.
      wait: (id) => id === 1 && !(rowU(0, t) < 0.2 && rowOpen(st, 0, t) > 0.95),
    })
  },

  pack(_c, st) {
    return [racePack(st.race), st.fire.map((x) => Math.round(x * 100) / 100), st.slam.map((x) => Math.round(x * 100) / 100), st.paw.map((x) => Math.round(x * 100) / 100)]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number[], number[], [number, number]]
    raceUnpack(st.race, a[0])
    st.fire = a[1]
    st.slam = a[2]
    st.paw = a[3]
  },

  visual(ctx, st, dt) {
    const t = ctx.time
    const v = st.vis
    const play = ctx.phase === 'play'
    const warn = play && t > st.paw[0] - PAW_WARN && t < st.paw[0]
    const px = play ? pawX(st, t) : null
    if (v.shadow) {
      const m = v.shadow.material as THREE.MeshBasicMaterial
      const want = warn ? 0.35 + Math.sin(t * 18) * 0.15 : px !== null ? 0.25 : 0
      m.opacity += (want - m.opacity) * Math.min(1, dt * 12)
      v.shadow.visible = m.opacity > 0.01
      v.shadow.position.z = st.paw[1]
    }
    if (v.paw) {
      v.paw.visible = warn || px !== null
      if (warn) {
        // Wind up at the side, high.
        const k = 1 - (st.paw[0] - t) / PAW_WARN
        v.paw.position.set(-HW - 4.5 + k * 0.8, TOP + 2.6 - k * 0.9, st.paw[1])
        v.paw.rotation.z = 0.35
      } else if (px !== null) {
        v.paw.position.set(px, TOP + 0.75, st.paw[1])
        v.paw.rotation.z = 0
      }
    }
    if (v.head) {
      // The cat watches the stripe it is about to swipe.
      const want = Math.atan2(-(st.paw[1] - 47), 9) * 0.6
      v.head.rotation.y += (want - v.head.rotation.y) * Math.min(1, dt * 3)
      v.head.rotation.z = warn ? 0.15 : 0
    }
    // Snagged toys trail a sock (a little wobble).
    for (const toy of ctx.toys) {
      const rig = toy.rig
      if (!rig) continue
      const slow = (st.race.slow[toy.idx] ?? 0) > t && toy.status === 'play'
      rig.root.rotation.z = slow ? Math.sin(t * 16 + toy.idx) * 0.12 : 0
    }
  },

  hud(ctx, st, me) {
    const t = ctx.time
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const z = me.pos.z
      if (me.feet > TOP - 0.6) {
        if (t > st.paw[0] - PAW_WARN && t < st.paw[0] + PAW_SWING) status = { text: 'PAW!', color: '#fb923c', pulse: true }
        prompt = 'The cat swipes across the striped shadow. Step out of it!'
      } else if (z > -18 && z < -12) prompt = 'Wait for the first drawer to open, then ride the wave across.'
      else if (z > 12 && z < 26) prompt = 'Bounce up on a rolled sock, or DIVE (Shift) into the mothball tunnel.'
      else if (z < -18) prompt = 'Piston drawers! Run on the side away from the slot.'
      if ((st.race.slow[me.idx] ?? 0) > t) prompt = 'A sock snagged your feet! Bounce on a rolled sock to shake it off.'
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status })
  },

  dispose(ctx) {
    detachDecor(ctx)
  },
})
