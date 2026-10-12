// Robo-Vac Sweep (survival). A robot vacuum hunts the rug in front of the sofa: get sucked into its intake and
// you are out. It runs fast in a straight line but turns slowly, so sidestep it or jump its bumper. Lint balls
// lie about: vacuums can't resist them, so throw one at a rival's feet. A second vacuum joins at 30 s and a
// third at 60 s, and they rev up for turbo dashes. Tricks: stick lint on a rival (every vacuum hunts them) and
// the turbo remote (send the nearest vacuum dashing at someone). Gallery crumbs land at a toy's feet as bait.
//
// This is also the README's worked example: read it top to bottom for a complete, small survival level.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { nearestRival, skill } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import type { RigidBody } from '../engine/physics'
import { PROP_GROUPS } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { blobShadow, feltTexture, flat, paint, r1, r2, rbox, soft, wrap, survivalTimeUp } from './kit'

/** Rug radius and the round fence of furniture round it (metres). */
const RUG = 9.5
const ARENA = 11.2
/** Vacuum body radius, intake reach and suction cone. */
const VAC_R = 1.0
const INTAKE = 1.5
const SUCTION = 3.4
/** Round times the 2nd and 3rd vacuums roll out of the dock. */
const JOIN = [0, 30, 60]
const DOCK = { x: 0, z: -ARENA + 0.4 }
const LINT_N = 6
/** Round poufs on the rug to hide behind (vacuums steer round them). */
const POUFS = [
  { x: -4.6, z: 2.6, r: 1.1 },
  { x: 4.9, z: -1.4, r: 1.0 },
  { x: 0.8, z: 5.6, r: 0.9 },
]

interface Vac {
  x: number
  z: number
  yaw: number
  /** 0 parked in the dock, 1 hunting. */
  on: number
  /** Turbo dash until this round time; it revs (the tell) before that. */
  turbo: number
  rev: number
  /** Turbo target (toy idx) or -1. */
  tgt: number
  /** Stops to digest lint until this time. */
  pause: number
  /** Bucking spin (a toy is riding on top) until this time. */
  buck: number
}

interface VacState {
  vacs: Vac[]
  /** A toy wearing a lint ball (every vacuum hunts it) until lureT. */
  lure: number
  lureT: number
  /** Gallery crumbs on the rug: flat [x, z, until, ...]. */
  crumbs: number[]
  /** Next turbo decision per vacuum (host). */
  think: number[]
  lint: { body: RigidBody; mesh: THREE.Object3D; back: number }[]
  bodies: RigidBody[]
  survive: number[]
  vis: {
    vacs: { g: THREE.Group; eyes: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial; brushes: THREE.Object3D[]; x: number; z: number; yaw: number; squash: number }[]
    crumb: THREE.InstancedMesh | null
    lintHat: THREE.Mesh | null
    hum: number
  }
}

/* ---------------- Visuals ---------------- */

function rugTexture() {
  // A braided round rug: many thin coils in muted wool colours, each with little diagonal braid ticks.
  const wool = ['#b9603c', '#e3b866', '#8a5a3c', '#d48c6e', '#efdcb6', '#5f8f87', '#a8503a', '#e8c98f', '#7a8f5f']
  return paint(512, 512, (g, w) => {
    const c = w / 2
    g.fillStyle = '#6b3d2a'
    g.fillRect(0, 0, w, w)
    const n = 34
    for (let i = n; i > 0; i--) {
      const r = (i / n) * (c - 2)
      g.beginPath()
      g.arc(c, c, r, 0, Math.PI * 2)
      g.fillStyle = wool[(i * 7 + (i >> 2)) % wool.length]
      g.fill()
      // Braid ticks along the coil.
      const coil = c / n
      const ticks = Math.max(12, Math.floor((Math.PI * 2 * r) / 9))
      g.strokeStyle = 'rgba(60,30,15,0.28)'
      g.lineWidth = 1.5
      for (let k = 0; k < ticks; k++) {
        const a = (k / ticks) * Math.PI * 2
        const r0 = r - coil * 0.85, r1 = r - coil * 0.1
        g.beginPath()
        g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0)
        g.lineTo(c + Math.cos(a + 0.6 / Math.max(r, 1) * 6) * r1, c + Math.sin(a + 0.6 / Math.max(r, 1) * 6) * r1)
        g.stroke()
      }
    }
    // Fluffy noise.
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = i % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)'
      g.fillRect((i * 7919) % w, (i * 104729) % w, 2, 2)
    }
  })
}

function vacMesh() {
  const g = new THREE.Group()
  const shell = soft('#e8eef2', { roughness: 0.35 })
  const dark = soft('#334155', { roughness: 0.5 })
  const body = new THREE.Mesh(new THREE.CylinderGeometry(VAC_R, VAC_R * 1.02, 0.42, 32), shell)
  body.position.y = 0.27
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(VAC_R * 0.82, VAC_R * 0.86, 0.06, 32), dark)
  lid.position.y = 0.5
  const ringMat = new THREE.MeshBasicMaterial({ color: '#22d3ee', toneMapped: false })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(VAC_R * 0.6, 0.035, 6, 32).rotateX(Math.PI / 2), ringMat)
  ring.position.y = 0.54
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), shell)
  button.position.y = 0.55
  // Front bumper: a grey half ring.
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(VAC_R + 0.02, 0.07, 6, 20, Math.PI), soft('#64748b', { roughness: 0.6 }))
  bumper.rotation.x = Math.PI / 2
  bumper.rotation.z = Math.PI
  bumper.position.y = 0.22
  // Eyes (they glow red when it revs).
  const eyes = new THREE.MeshBasicMaterial({ color: '#22d3ee', toneMapped: false })
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6), eyes)
    e.scale.set(1, 1.4, 0.6)
    e.position.set(s * 0.28, 0.4, VAC_R * 0.93)
    g.add(e)
  }
  // Intake mouth.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.2), new THREE.MeshBasicMaterial({ color: '#0f172a' }))
  mouth.position.set(0, 0.12, VAC_R * 0.88)
  // Side brushes: little bristle stars at the front corners.
  const brushes: THREE.Object3D[] = []
  const bristle = soft('#fbbf24', { roughness: 0.9 })
  for (const s of [-1, 1]) {
    const b = new THREE.Group()
    for (let k = 0; k < 3; k++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.55), bristle)
      arm.position.z = 0.22
      const pivot = new THREE.Group()
      pivot.rotation.y = (k / 3) * Math.PI * 2
      pivot.add(arm)
      b.add(pivot)
    }
    b.position.set(s * 0.7, 0.05, VAC_R * 0.62)
    g.add(b)
    brushes.push(b)
  }
  g.add(body, lid, ring, button, bumper, mouth)
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.castShadow = true
  })
  const sh = blobShadow(0.45)
  sh.scale.setScalar(VAC_R * 1.35)
  sh.position.y = 0.025
  g.add(sh)
  return { g, eyes, ring: ringMat, brushes }
}

function lintMesh() {
  // A fuzzy grey ball: an icosphere with jittered vertices.
  const geo = new THREE.IcosahedronGeometry(0.3, 1)
  const p = geo.attributes.position
  for (let i = 0; i < p.count; i++) {
    const k = 1 + ((i * 2654435761) % 100) / 100 * 0.35
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
  }
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, flat('#cbd5e1', { roughness: 1 }))
  m.castShadow = true
  return m
}

function sofa(root: THREE.Object3D) {
  // A chunky corduroy sofa along the back of the rug.
  const g = new THREE.Group()
  const fab = soft('#5b8e7d', { map: feltTexture('#6fa190', 'rgba(255,255,255,0.1)', 'rgba(0,0,0,0.12)', [3, 1]) })
  const base = new THREE.Mesh(rbox(12, 1.7, 3.4, 0.35), fab)
  base.position.y = 0.95
  const back = new THREE.Mesh(rbox(12, 3.2, 1.2, 0.45), fab)
  back.position.set(0, 2.6, -1.3)
  const armL = new THREE.Mesh(rbox(1.3, 2.6, 3.6, 0.5), fab)
  armL.position.set(-6.4, 1.4, 0)
  const armR = armL.clone()
  armR.position.x = 6.4
  const cushion = soft('#7fb3a1')
  for (const x of [-3, 0, 3]) {
    const c = new THREE.Mesh(rbox(2.9, 0.6, 2.6, 0.25), cushion)
    c.position.set(x, 2.05, 0.25)
    g.add(c)
  }
  g.add(base, back, armL, armR)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true))
  g.position.set(0, 0, -ARENA - 1.6)
  root.add(g)
}

/* ---------------- Rules helpers ---------------- */

/** Where a vacuum is heading: its turbo target, the lint-lured toy, bait on the floor, or the nearest toy. */
function quarry(ctx: LevelCtx, s: VacState, v: Vac, out: { x: number; z: number; toy: Toy | null }) {
  const t = ctx.time
  if (v.turbo > t || v.rev > t) {
    const q = ctx.toys[v.tgt]
    if (q && q.status === 'play') return Object.assign(out, { x: q.pos.x, z: q.pos.z, toy: q })
  }
  if (s.lureT > t && ctx.toys[s.lure]?.status === 'play') {
    const q = ctx.toys[s.lure]
    return Object.assign(out, { x: q.pos.x, z: q.pos.z, toy: q })
  }
  // Bait: loose lint on the floor, or gallery crumbs. It smells them from 6 m.
  let best = 6 * 6
  let bx = 0, bz = 0, bait = false
  for (const l of s.lint) {
    const p = l.body.translation()
    if (p.y > 0.8 || p.y < -1) continue
    const d = (p.x - v.x) ** 2 + (p.z - v.z) ** 2
    if (d < best) {
      best = d
      bx = p.x
      bz = p.z
      bait = true
    }
  }
  for (let i = 0; i < s.crumbs.length; i += 3) {
    if (s.crumbs[i + 2] < t) continue
    const d = (s.crumbs[i] - v.x) ** 2 + (s.crumbs[i + 1] - v.z) ** 2
    if (d < best * 1.5) {
      best = d
      bx = s.crumbs[i]
      bz = s.crumbs[i + 1]
      bait = true
    }
  }
  if (bait) return Object.assign(out, { x: bx, z: bz, toy: null })
  const q = ctx.nearest({ x: v.x + Math.sin(v.yaw) * 2, y: 0, z: v.z + Math.cos(v.yaw) * 2 }, (tt) => tt.status === 'play' && tt.pos.y < 3)
  if (q) return Object.assign(out, { x: q.pos.x, z: q.pos.z, toy: q })
  return Object.assign(out, { x: 0, z: 0, toy: null })
}

const _q = { x: 0, z: 0, toy: null as Toy | null }
const _m4 = new THREE.Matrix4()

function vacSpeed(ctx: LevelCtx, v: Vac) {
  const t = ctx.time
  if (v.pause > t) return 0
  if (v.turbo > t) return 7
  if (v.rev > t) return 1.2
  return Math.min(4.9, 3.3 + t * 0.016)
}

function spawnLint(ctx: LevelCtx, s: VacState, i: number) {
  const l = s.lint[i]
  // Away from the vacuums, on the rug.
  let x = 0, z = 0
  for (let k = 0; k < 8; k++) {
    const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(2, RUG - 1.5)
    x = Math.sin(a) * r
    z = Math.cos(a) * r
    if (s.vacs.every((v) => !v.on || Math.hypot(v.x - x, v.z - z) > 4) && POUFS.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + 0.6)) break
  }
  l.body.setTranslation({ x, y: 0.6, z }, true)
  l.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
  l.back = 0
}

/** Danger to a toy at (x, z): close vacuums, worse in front of their intake. */
function danger(s: VacState, x: number, z: number) {
  let d = 0
  for (const v of s.vacs) {
    if (!v.on) continue
    const dx = x - v.x, dz = z - v.z
    const r = Math.hypot(dx, dz) || 0.01
    const front = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / r
    d += (front > 0.3 ? 1.6 : 0.8) / Math.max(0.6, r - VAC_R)
  }
  return d
}

export default defineLevel<VacState>({
  id: 'robo-vac',
  name: 'Robo-Vac Sweep',
  type: 'survival',
  blurb: 'A robot vacuum hunts the rug. Get sucked up and you are out.',
  howTo: [
    'It chases whoever is closest, fast in a line but slow to turn: sidestep it',
    'Jump its bumper to escape (and earn a Sprinkle)',
    'Grab a lint ball and throw it at a rival: vacuums cannot resist lint',
    'A 2nd vacuum joins at 30 s, a 3rd at 60 s. Red eyes = turbo dash',
  ],
  accent: '#22d3ee',
  players: [2, 16],
  duration: 90,
  canBeFinal: true,
  camera: { kind: 'chase', dist: 8 },
  introOrbit: { radius: 13, height: 9 },
  sprinkles: { start: 2 },
  sky: { color: '#2a1b12', fogNear: 45, fogFar: 120 },

  tricks: [
    {
      id: 'lint',
      name: 'Lint Lure',
      icon: 'star',
      cost: 2,
      cooldown: 10,
      busy: 0.5,
      target: 'rival',
      desc: 'Stick a lint ball on a rival: every vacuum hunts them for 4 seconds.',
      counter: 'Run behind someone else, or jump the bumper.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.lure = target.idx
        s.lureT = ctx.time + 4
        ctx.fx.popup(target, 'LINT!', '#e5e7eb')
        ctx.fx.puff(target.pos, 'dust', 10)
        ctx.fx.sfx('pop', target.pos)
      },
      botUse: (ctx, s, user) => {
        // Lure them onto whoever is nearest a vacuum (but not us).
        let best: Toy | null = null
        let bd = 6
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play') continue
          const d = s.vacs.reduce((m, v) => (v.on ? Math.min(m, Math.hypot(v.x - t.pos.x, v.z - t.pos.z)) : m), 99)
          if (d < bd && t.pos.distanceTo(user.pos) > 3) {
            bd = d
            best = t
          }
        }
        return best ?? false
      },
    },
    {
      id: 'turbo',
      name: 'Turbo Remote',
      icon: 'remote',
      cost: 3,
      cooldown: 14,
      busy: 1,
      target: 'rival',
      desc: 'Grab the remote: the vacuum nearest a rival revs up and turbo-dashes straight at them.',
      counter: 'Red eyes mean a dash is coming: step sideways as it launches.',
      can: (_c, s) => (s.vacs.some((v) => v.on) ? true : 'No vacuum yet'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        let best = -1, bd = Infinity
        s.vacs.forEach((v, i) => {
          if (!v.on) return
          const d = Math.hypot(v.x - target.pos.x, v.z - target.pos.z)
          if (d < bd) {
            bd = d
            best = i
          }
        })
        const v = s.vacs[best]
        if (!v) return
        v.tgt = target.idx
        v.rev = ctx.time + 0.55
        v.turbo = ctx.time + 0.55 + 2.4
        ctx.fx.popup(target, 'TURBO INCOMING!', '#f87171')
        ctx.fx.sfx('buzz', { x: v.x, y: 0.5, z: v.z })
      },
    },
    bubbleWrap<VacState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 18, hd: 18, ridge: 17, knee: 4, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    // The rug (flat: it is just a texture on the floorboards).
    const rug = new THREE.Mesh(new THREE.CircleGeometry(RUG, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }))
    rug.position.y = 0.012
    rug.receiveShadow = true
    ctx.root.add(rug)
    // A ring fence of furniture: invisible round wall plus props along it.
    const segs = 28
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      ctx.phys.box({ x: Math.sin(a) * (ARENA + 0.5), y: 2, z: Math.cos(a) * (ARENA + 0.5) }, { x: 1.4, y: 2, z: 0.5 }, { rotY: a })
    }
    sofa(ctx.root)
    const place = (name: Parameters<typeof prop>[1], size: number, a: number, r: number, rot = 0, by: 'height' | 'max' | 'width' = 'height') => {
      const p = prop(ctx.assets, name, size, by)
      p.position.set(Math.sin(a) * r, 0, Math.cos(a) * r)
      p.rotation.y = a + Math.PI + rot
      ctx.root.add(p)
    }
    place('armchair', 4.2, 1.15, ARENA + 1.8, 0, 'height')
    place('armchair', 4.2, -1.15, ARENA + 1.8, 0, 'height')
    place('chest', 3, 2.3, ARENA + 1.6, 0, 'width')
    place('boxes', 3.2, -2.35, ARENA + 1.6, 0.4, 'height')
    place('horse', 3.2, Math.PI - 0.0, ARENA + 2.4, Math.PI / 2, 'height')
    // A book pile and a lamp for scale.
    const books = new THREE.InstancedMesh(rbox(1, 1, 1, 0.04, 1), flat('#ffffff'), 18)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color()
    const bookCols = ['#7f1d1d', '#1e3a8a', '#065f46', '#78350f', '#581c87', '#9a3412']
    for (let i = 0; i < 18; i++) {
      const stack = i < 9 ? 0 : 1
      const k = i % 9
      const a = stack ? 2.85 : -2.85
      p.set(Math.sin(a) * (ARENA + 1.3), 0.25 + k * 0.42, Math.cos(a) * (ARENA + 1.3))
      sc.set(ctx.rng.range(1.8, 2.4), 0.4, ctx.rng.range(1.3, 1.6))
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ctx.rng.range(-0.3, 0.3) + a)
      books.setMatrixAt(i, m4.compose(p, q, sc))
      books.setColorAt(i, col.set(ctx.rng.pick(bookCols)))
    }
    books.castShadow = books.receiveShadow = true
    ctx.root.add(books)
    // Poufs to hide behind.
    const poufMat = soft('#f472b6', { map: feltTexture('#f9a8d4', 'rgba(255,255,255,0.12)', 'rgba(120,0,60,0.1)', [3, 1]) })
    for (const pf of POUFS) {
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(pf.r * 0.95, 0.02), new THREE.Vector2(pf.r, 0.25), new THREE.Vector2(pf.r * 1.02, 0.6), new THREE.Vector2(pf.r * 0.9, 0.95), new THREE.Vector2(0, 1.02)]
      const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), poufMat)
      mesh.position.set(pf.x, 0, pf.z)
      mesh.castShadow = mesh.receiveShadow = true
      ctx.root.add(mesh)
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), soft('#be185d'))
      btn.position.set(pf.x, 1.02, pf.z)
      ctx.root.add(btn)
      ctx.phys.cylinder({ x: pf.x, y: 0.5, z: pf.z }, 0.5, pf.r)
    }
    // The charging dock.
    const dock = new THREE.Mesh(rbox(2.6, 1.1, 0.7, 0.15), soft('#e2e8f0', { roughness: 0.4 }))
    dock.position.set(DOCK.x, 0.55, DOCK.z - 0.9)
    const light = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: '#22d3ee', toneMapped: false }))
    light.position.set(DOCK.x, 0.85, DOCK.z - 0.54)
    ctx.root.add(dock, light)
  },

  init(ctx) {
    const st: VacState = {
      vacs: JOIN.map((_, i) => ({ x: DOCK.x + (i - 1) * 2.2, z: DOCK.z + 0.6, yaw: 0, on: 0, turbo: 0, rev: 0, tgt: -1, pause: 0, buck: 0 })),
      lure: -1,
      lureT: 0,
      crumbs: [],
      think: JOIN.map(() => 8),
      lint: [],
      bodies: [],
      survive: ctx.toys.map(() => 0),
      vis: { vacs: [], crumb: null, lintHat: null, hum: 0 },
    }
    for (let i = 0; i < JOIN.length; i++) {
      const v = vacMesh()
      ctx.root.add(v.g)
      st.vis.vacs.push({ ...v, x: st.vacs[i].x, z: st.vacs[i].z, yaw: 0, squash: 0 })
      // A solid kinematic body: toys bump off its sides and can stand on top.
      const b = ctx.phys.kinematic({ x: st.vacs[i].x, y: 0.27, z: st.vacs[i].z })
      ctx.phys.attach(b, ctx.RAPIER.ColliderDesc.cylinder(0.24, VAC_R), { friction: 0.3 })
      st.bodies.push(b)
    }
    // Lint balls: loose, grabbable, and irresistible to vacuums.
    for (let i = 0; i < LINT_N; i++) {
      const a = (i / LINT_N) * Math.PI * 2 + 0.4
      const r = 3 + (i % 3) * 1.8
      const body = ctx.phys.dynamic({ x: Math.sin(a) * r, y: 0.5, z: Math.cos(a) * r }, { damping: 0.6 })
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.ball(0.3).setDensity(0.25), { friction: 0.9, restitution: 0.3, groups: PROP_GROUPS })
      const mesh = lintMesh()
      ctx.root.add(mesh)
      ctx.grabbable(body, mesh)
      st.lint.push({ body, mesh, back: 0 })
    }
    // Crumbs (gallery bait) and the lint ball stuck on a lured toy.
    const crumb = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.16, 0), flat('#d9a066'), 24)
    crumb.count = 0
    ctx.root.add(crumb)
    st.vis.crumb = crumb
    const hat = lintMesh()
    hat.visible = false
    ctx.root.add(hat)
    st.vis.lintHat = hat
    // Keep the kinematic bodies on the (synced, smoothed) vacuum poses on every screen.
    ctx.hazards.add({
      update(c, _t, dt) {
        st.vacs.forEach((v, i) => {
          const vv = st.vis.vacs[i]
          if (c.isHost) {
            vv.x = v.x
            vv.z = v.z
            vv.yaw = v.yaw
          } else {
            const k = Math.min(1, dt * 12)
            vv.x += (v.x - vv.x) * k
            vv.z += (v.z - vv.z) * k
            vv.yaw += wrap(v.yaw - vv.yaw) * k
          }
          st.bodies[i].setNextKinematicTranslation({ x: vv.x, y: 0.27, z: vv.z })
        })
      },
      // Suction: toys on the floor in front of a running vacuum are dragged towards the intake.
      predict: true,
      affect(c, toy, dt) {
        if (toy.status !== 'play' || c.phase !== 'play' || toy.feet > 0.4) return
        for (const v of st.vacs) {
          if (!v.on || v.pause > c.time) continue
          const dx = v.x - toy.pos.x, dz = v.z - toy.pos.z
          const d = Math.hypot(dx, dz)
          if (d > SUCTION || d < 0.01) continue
          const front = -(dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / d
          if (front < 0.45) continue
          const k = (1 - d / SUCTION) * 9 * dt * (v.turbo > c.time ? 1.4 : 1)
          const lv = toy.body.linvel()
          toy.body.setLinvel({ x: lv.x + (dx / d) * k, y: lv.y, z: lv.z + (dz / d) * k }, true)
        }
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 1, radius: Math.min(RUG - 1.5, 3 + n * 0.32), faceIn: false })[i]
  },

  start(ctx, s) {
    s.vacs[0].on = 1
    s.vacs[0].z = DOCK.z + 1.4
    ctx.fx.sfx('click', { x: 0, y: 0.5, z: DOCK.z })
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const press = ctx.mode === 'show' ? Math.max(0, (t / 90 - 0.55) / 0.45) * (ctx.active().length > ctx.target ? 1 : 0.3) : 0
    // New vacuums roll out of the dock.
    JOIN.forEach((at, i) => {
      if (i === 0 || s.vacs[i].on || t < at) return
      const v = s.vacs[i]
      v.on = 1
      v.x = DOCK.x
      v.z = DOCK.z + 1.4
      v.yaw = 0
      v.pause = t + 0.8
      ctx.fx.say(i === 1 ? 'A SECOND VACUUM!' : 'VACUUM NUMBER THREE!', '#22d3ee', 1.6)
      ctx.fx.sfx('click', { x: 0, y: 0.5, z: DOCK.z })
      ctx.fx.shake(0.25)
    })
    s.vacs.forEach((v, i) => {
      if (!v.on) return
      // Turbo dashes: a rev (red eyes) then a fast straight lunge. More often as time goes on.
      s.think[i] -= dt
      if (s.think[i] <= 0 && v.turbo < t && v.rev < t) {
        s.think[i] = Math.max(3.5, ctx.rng.range(7, 12) - t * 0.05 - press * 3)
        const q = quarry(ctx, s, v, _q)
        if (q.toy && t > 8 && ctx.rng.chance(0.55 + press * 0.4)) {
          v.tgt = q.toy.idx
          v.rev = t + 0.7
          v.turbo = t + 0.7 + 1.6
          ctx.fx.sfx('buzz', { x: v.x, y: 0.5, z: v.z })
        }
      }
      // Steer: towards the quarry, round poufs, away from the rim and the other vacuums.
      const q = quarry(ctx, s, v, _q)
      let wx = q.x - v.x, wz = q.z - v.z
      const wl = Math.hypot(wx, wz) || 1
      wx /= wl
      wz /= wl
      for (const p of POUFS) {
        const dx = v.x - p.x, dz = v.z - p.z
        const d = Math.hypot(dx, dz)
        if (d < p.r + VAC_R + 1.4) {
          const k = (p.r + VAC_R + 1.4 - d) * 0.9
          wx += (dx / d) * k
          wz += (dz / d) * k
        }
      }
      for (const o of s.vacs) {
        if (o === v || !o.on) continue
        const dx = v.x - o.x, dz = v.z - o.z
        const d = Math.hypot(dx, dz)
        if (d < 2.6 && d > 0.01) {
          wx += (dx / d) * (2.6 - d) * 0.6
          wz += (dz / d) * (2.6 - d) * 0.6
        }
      }
      const rr = Math.hypot(v.x, v.z)
      if (rr > ARENA - 2.2) {
        wx -= (v.x / rr) * (rr - (ARENA - 2.2)) * 1.5
        wz -= (v.z / rr) * (rr - (ARENA - 2.2)) * 1.5
      }
      const want = Math.atan2(wx, wz)
      const turn = v.turbo > t && v.rev < t ? 1.3 : v.buck > t ? 9 : 2.1
      const d = wrap(want - v.yaw)
      v.yaw = wrap(v.yaw + THREE.MathUtils.clamp(d, -turn * dt, turn * dt) + (v.buck > t ? 8 * dt : 0))
      const sp = vacSpeed(ctx, v) * (1 + press * 0.15) * (Math.abs(d) > 1.2 && v.turbo < t ? 0.55 : 1)
      v.x += Math.sin(v.yaw) * sp * dt
      v.z += Math.cos(v.yaw) * sp * dt
      const r2_ = Math.hypot(v.x, v.z)
      if (r2_ > ARENA - VAC_R) {
        v.x *= (ARENA - VAC_R) / r2_
        v.z *= (ARENA - VAC_R) / r2_
      }
      // Eat lint and crumbs in front of the intake.
      const mx = v.x + Math.sin(v.yaw) * 0.8, mz = v.z + Math.cos(v.yaw) * 0.8
      for (const l of s.lint) {
        const p = l.body.translation()
        if (p.y > 0.9 || p.y < -1 || Math.hypot(p.x - mx, p.z - mz) > 0.9) continue
        if (ctx.toys.some((tt) => tt.holdingProp === l.body)) continue
        l.body.setTranslation({ x: 0, y: -30, z: 0 }, true)
        l.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        l.back = t + 6
        v.pause = t + 0.45
        ctx.fx.sfx('suck', { x: v.x, y: 0.4, z: v.z })
        ctx.fx.puff({ x: mx, y: 0.3, z: mz }, 'dust', 10)
      }
      for (let k = 0; k < s.crumbs.length; k += 3) {
        if (s.crumbs[k + 2] < t || Math.hypot(s.crumbs[k] - mx, s.crumbs[k + 1] - mz) > 0.9) continue
        s.crumbs[k + 2] = 0
        v.pause = t + 0.3
        ctx.fx.puff({ x: mx, y: 0.3, z: mz }, 'crumbs', 8)
        ctx.fx.sfx('crunch', { x: v.x, y: 0.4, z: v.z })
      }
      // Toys: sucked up at the intake; riding on top makes it buck; hopping over it earns a Sprinkle.
      for (const toy of ctx.toys) {
        if (toy.status !== 'play') continue
        const dx = toy.pos.x - v.x, dz = toy.pos.z - v.z
        const dd = Math.hypot(dx, dz)
        if (dd > INTAKE + 0.6) continue
        const front = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / Math.max(dd, 0.01)
        if (dd < INTAKE && front > 0.35 && toy.feet < 0.32 && v.pause < t) {
          ctx.emit({ k: 'suck', i: toy.idx, v: i })
          ctx.fx.sfx('suck', toy.pos)
          ctx.fx.puff(toy.pos, 'stuff', 16)
          ctx.fx.shake(0.4, toy)
          ctx.fail(toy, 'sucked up')
          if ((toy.status as string) === 'failed') toy.body.setEnabled(false)
          v.pause = t + 0.6
          continue
        }
        if (dd < VAC_R + 0.1 && toy.feet > 0.42 && toy.grounded) {
          // Riding on top: after a moment it spins and throws them off.
          const ride = ((toy.data.ride as number) ?? 0) + dt
          toy.data.ride = ride
          if (ride > 1.3 && v.buck < t) {
            v.buck = t + 0.6
            ctx.knock(toy, { x: (dx / Math.max(dd, 0.1)) * 6 + 1, y: 5, z: (dz / Math.max(dd, 0.1)) * 6 }, 0.6)
            ctx.fx.sfx('boing', toy.pos)
            toy.data.ride = 0
          }
        } else if (dd > VAC_R + 0.4) toy.data.ride = 0
        if (!toy.grounded && toy.feet > 0.55 && dd < VAC_R && ((toy.data.hopT as number) ?? -9) < t - 2.5) {
          toy.data.hopT = t
          ctx.addSprinkles(toy, 1, 'hop!')
          ctx.fx.sfx('ding', toy.pos)
        }
      }
    })
    // Lint comes back.
    s.lint.forEach((l, i) => {
      if (l.back > 0 && t > l.back) spawnLint(ctx, s, i)
      const p = l.body.translation()
      if (l.back === 0 && (p.y < -3 || Math.hypot(p.x, p.z) > ARENA + 1)) spawnLint(ctx, s, i)
    })
    // A Sprinkle for every 12 s survived.
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      s.survive[toy.idx] = (s.survive[toy.idx] ?? 0) + dt
      if (s.survive[toy.idx] >= 12) {
        s.survive[toy.idx] -= 12
        ctx.addSprinkles(toy, 1)
      }
    }
    if (s.lureT > 0 && (s.lureT < t || ctx.toys[s.lure]?.status !== 'play')) {
      s.lureT = 0
      s.lure = -1
    }
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { wx?: number; wz?: number; wt?: number; jumpAt?: number; lintT?: number }
    const t = ctx.time
    // Wander target (re-picked now and then), pushed away from danger.
    if (!d.wt || d.wt < t) {
      d.wt = t + ctx.rng.range(1.5, 3)
      const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(1, RUG - 2)
      d.wx = Math.sin(a) * r
      d.wz = Math.cos(a) * r
    }
    let mx = (d.wx ?? 0) - toy.pos.x, mz = (d.wz ?? 0) - toy.pos.z
    const ml = Math.hypot(mx, mz) || 1
    mx = (mx / ml) * 0.35
    mz = (mz / ml) * 0.35
    let threat = 0
    let near: Vac | null = null
    let nd = 99
    for (const v of s.vacs) {
      if (!v.on) continue
      const dx = toy.pos.x - v.x, dz = toy.pos.z - v.z
      const r = Math.hypot(dx, dz) || 0.01
      if (r < nd) {
        nd = r
        near = v
      }
      if (r > 8) continue
      const front = (dx * Math.sin(v.yaw) + dz * Math.cos(v.yaw)) / r
      // Flee sideways from the vacuum's heading (it turns slowly), plus straight away.
      const side = Math.sign(dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw)) || 1
      const sx = Math.cos(v.yaw) * side, sz = -Math.sin(v.yaw) * side
      const w = (front > 0 ? 1.6 : 0.7) * (v.turbo > t || v.rev > t ? 1.6 : 1) / Math.max(0.5, r - 0.8)
      mx += ((dx / r) * 0.6 + sx * (front > 0.2 ? 0.9 : 0.2)) * w
      mz += ((dz / r) * 0.6 + sz * (front > 0.2 ? 0.9 : 0.2)) * w
      threat = Math.max(threat, w)
    }
    // Keep off the rim and out of corners; poufs block.
    const rr = Math.hypot(toy.pos.x, toy.pos.z)
    if (rr > ARENA - 3) {
      mx -= (toy.pos.x / rr) * (rr - (ARENA - 3)) * 1.2
      mz -= (toy.pos.z / rr) * (rr - (ARENA - 3)) * 1.2
    }
    for (const p of POUFS) {
      const dx = toy.pos.x - p.x, dz = toy.pos.z - p.z
      const dd = Math.hypot(dx, dz)
      if (dd < p.r + 0.9) {
        mx += (dx / dd) * 0.8
        mz += (dz / dd) * 0.8
      }
    }
    // Lint: pick one up when calm, throw it at a rival near us.
    if (toy.holdingProp) {
      toy.pad.grab = true
      const r = nearestRival(ctx, toy, 6)
      if (r && r.pos.distanceTo(toy.pos) > 2) {
        mx = (r.pos.x - toy.pos.x) * 0.3
        mz = (r.pos.z - toy.pos.z) * 0.3
        const f = toy.facing()
        const dx = r.pos.x - toy.pos.x, dz = r.pos.z - toy.pos.z
        if ((dx * f.x + dz * f.z) / Math.hypot(dx, dz) > 0.85) toy.pad.grab = false
      }
      if ((d.lintT ?? 0) + 4 < t) toy.pad.grab = false
    } else if (threat < 0.5 && ctx.rng.chance(sk.aggression * 0.6 * dt * 10)) {
      for (const l of s.lint) {
        const p = l.body.translation()
        if (p.y > 1 || p.y < -1) continue
        const dl = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z)
        if (dl < 3.5) {
          mx = p.x - toy.pos.x
          mz = p.z - toy.pos.z
          if (dl < 1.3) {
            toy.pad.grab = true
            d.lintT = t
          }
          break
        }
      }
    }
    const len = Math.hypot(mx, mz)
    const pace = sk.pace * (threat > 0.4 ? 1 : 0.65)
    toy.pad.mx = len > 0.05 ? (mx / len) * Math.min(1, len) * pace : 0
    toy.pad.mz = len > 0.05 ? (mz / len) * Math.min(1, len) * pace : 0
    // Hop the bumper when it is right there (and coming at us).
    if (near && nd < INTAKE + 0.9 + vacSpeed(ctx, near) * sk.reaction * 0.5) {
      const dx = toy.pos.x - near.x, dz = toy.pos.z - near.z
      const front = (dx * Math.sin(near.yaw) + dz * Math.cos(near.yaw)) / nd
      if (front > 0.2 && toy.grounded && (d.jumpAt ?? -9) < t - 0.6) {
        d.jumpAt = t
        if (ctx.rng.chance(sk.accuracy * 0.92)) {
          toy.pad.jump = true
          // Jump over it, not along with it.
          toy.pad.mx = -Math.sin(near.yaw) * 0.6 + toy.pad.mx * 0.4
          toy.pad.mz = -Math.cos(near.yaw) * 0.6 + toy.pad.mz * 0.4
        } else if (ctx.rng.chance(0.5)) toy.pad.dive = true
      }
    }
    // A cheeky shove into a vacuum's path.
    const r = nearestRival(ctx, toy, 1.4)
    if (r && danger(s, r.pos.x, r.pos.z) > 0.8 && ctx.rng.chance(sk.aggression * 3 * dt)) {
      toy.pad.mx = r.pos.x - toy.pos.x
      toy.pad.mz = r.pos.z - toy.pos.z
      toy.pad.shove = true
    }
  },

  rank(ctx, s) {
    // Best first: furthest from danger.
    return ctx.active().sort((a, b) => danger(s, a.pos.x, a.pos.z) - danger(s, b.pos.x, b.pos.z))
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'furthest from the vacuums', "too close to a vacuum")
  },

  retry(ctx, s, toy) {
    // Quick Play: pop back out somewhere quiet.
    let best = { x: 0, z: 0 }, bd = Infinity
    for (let i = 0; i < 10; i++) {
      const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(2, RUG - 2)
      const x = Math.sin(a) * r, z = Math.cos(a) * r
      const dd = danger(s, x, z)
      if (dd < bd) {
        bd = dd
        best = { x, z }
      }
    }
    toy.body.setEnabled(true)
    ctx.respawn(toy, { x: best.x, y: 0, z: best.z, yaw: 0 }, 1)
  },

  onThrow(ctx, s, kind, target) {
    if (kind !== 'crumb') return false
    // Crumbs land at their feet: vacuums love crumbs.
    s.crumbs = s.crumbs.filter((_v, i, a) => a[i - (i % 3) + 2] > ctx.time)
    s.crumbs.push(r2(target.pos.x + ctx.rng.range(-0.4, 0.4)), r2(target.pos.z + ctx.rng.range(-0.4, 0.4)), r1(ctx.time + 8))
    if (s.crumbs.length > 24) s.crumbs.splice(0, 3)
    ctx.fx.puff({ x: target.pos.x, y: 0.2, z: target.pos.z }, 'crumbs', 10)
    ctx.fx.popup(target, 'Crumbs!', '#fcd34d')
    return true
  },

  pack(_c, s) {
    return [s.vacs.map((v) => [r2(v.x), r2(v.z), r2(v.yaw), v.on, r1(v.turbo), r1(v.rev), r1(v.pause)]), s.lure, r1(s.lureT), s.crumbs]
  },

  unpack(_c, s, d) {
    const [vacs, lure, lureT, crumbs] = d as [number[][], number, number, number[]]
    vacs.forEach((row, i) => {
      const v = s.vacs[i]
      if (!v) return
      ;[v.x, v.z, v.yaw, v.on, v.turbo, v.rev, v.pause] = row
    })
    s.lure = lure
    s.lureT = lureT
    s.crumbs = crumbs
  },

  onEvent(ctx, s, data) {
    const e = data as { k?: string; i?: number; v?: number }
    if (e.k !== 'suck' || e.v === undefined) return
    const vv = s.vis.vacs[e.v]
    if (vv) vv.squash = 1
    const toy = ctx.toys[e.i ?? -1]
    if (toy && !ctx.isHost) ctx.fxLocal.puff(toy.pos, 'stuff', 10)
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    let loud = 0
    s.vis.vacs.forEach((vv, i) => {
      const v = s.vacs[i]
      if (!v.on) {
        vv.g.position.set(v.x, 0, v.z)
        vv.g.rotation.y = 0
        vv.eyes.color.set('#475569')
        vv.ring.color.set('#334155')
        return
      }
      const rev = v.rev > t, turbo = v.turbo > t && !rev
      vv.squash = Math.max(0, vv.squash - dt * 3)
      const bob = rev ? Math.sin(t * 60) * 0.03 : 0
      vv.g.position.set(vv.x + bob, 0, vv.z)
      vv.g.rotation.y = vv.yaw
      vv.g.scale.set(1 + vv.squash * 0.15, 1 - vv.squash * 0.25, 1 + vv.squash * 0.15)
      const hot = rev ? (Math.sin(t * 30) > 0 ? '#ef4444' : '#fca5a5') : turbo ? '#f97316' : v.pause > t ? '#a3e635' : '#22d3ee'
      vv.eyes.color.set(hot)
      vv.ring.color.set(hot)
      const spin = (turbo ? 40 : 18) * dt
      vv.brushes[0].rotation.y += spin
      vv.brushes[1].rotation.y -= spin
      if (ctx.me) loud = Math.max(loud, 1 - Math.hypot(ctx.me.pos.x - vv.x, ctx.me.pos.z - vv.z) / 14)
      // A puff of dust trails a turbo dash.
      if (turbo && Math.random() < dt * 20) ctx.fxLocal.puff({ x: vv.x - Math.sin(vv.yaw), y: 0.15, z: vv.z - Math.cos(vv.yaw) }, 'dust', 2)
    })
    // A soft hum when one is close (local sound, throttled).
    s.vis.hum -= dt
    if (ctx.phase === 'play' && loud > 0.55 && s.vis.hum <= 0 && ctx.me?.status === 'play') {
      s.vis.hum = 0.9
      ctx.fxLocal.sfx('suck', ctx.me.pos)
    }
    // Crumbs.
    const cr = s.vis.crumb
    if (cr) {
      const m = _m4
      let n = 0
      for (let i = 0; i < s.crumbs.length && n < 24; i += 3) {
        if (s.crumbs[i + 2] < t) continue
        for (let k = 0; k < 3 && n < 24; k++) {
          m.makeTranslation(s.crumbs[i] + (k - 1) * 0.22, 0.08, s.crumbs[i + 1] + (k % 2) * 0.2)
          cr.setMatrixAt(n++, m)
        }
      }
      cr.count = n
      cr.instanceMatrix.needsUpdate = true
    }
    // The lint ball stuck on a lured toy.
    const hat = s.vis.lintHat
    if (hat) {
      const lt = s.lureT > t ? ctx.toys[s.lure] : null
      hat.visible = !!lt && lt.status === 'play'
      if (lt) {
        hat.position.set(lt.pos.x, lt.pos.y + 0.75, lt.pos.z)
        hat.rotation.y += dt * 3
      }
    }
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const live = s.vacs.filter((v) => v.on).length
    const chips = [`${live} vacuum${live === 1 ? '' : 's'}`]
    const next = JOIN.find((a) => a > t)
    if (next !== undefined && ctx.phase === 'play') chips.push(`Next vacuum in ${Math.ceil(next - t)} s`)
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (me && me.status === 'play') {
      const hunted = s.vacs.some((v) => v.on && (v.rev > t || v.turbo > t) && v.tgt === me.idx)
      if (hunted) status = { text: 'TURBO! SIDESTEP!', color: '#f87171', pulse: true }
      else if (s.lureT > t && s.lure === me.idx) status = { text: 'YOU HAVE LINT ON YOU', color: '#e5e7eb', pulse: true }
      if (me.holdingProp) prompt = 'Let go of Grab to throw the lint at a rival: the vacuums will follow it.'
      else if (t < 6) prompt = 'Keep away from the intake! Jump the bumper when it gets close.'
    }
    return { chips, prompt, status }
  },
})
