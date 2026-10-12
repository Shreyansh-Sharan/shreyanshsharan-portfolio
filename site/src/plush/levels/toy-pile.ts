// Top of the Toy Pile (final). A wobbling heap of toys rises in the middle of the attic with the crown on top.
// Climb it, grab the crown and hold it on the pile for 10 seconds to win the Show. The heap leans towards
// whichever side the crowd climbs, lurches now and then, and gets shakier the longer the round runs. A hard
// enough hit knocks the crown off the holder's head and it tumbles down the pile; bounce pads round the base
// fling fallen toys back in. Dirty tricks: shake the whole pile, or give the crown holder butterfingers.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { avoidWalls, skill, steerTo } from '../engine/bots'
import { ceremony, ceremonyCamera, crownCeremony, crownMesh, type Ceremony } from '../engine/finale'
import { buildAttic } from '../engine/helpers'
import { canvasTex, roundRect } from '../engine/paint'
import { G, groups, type RigidBody } from '../engine/physics'
import { ToyRig, type RigState } from '../engine/rig'
import { wobble } from '../engine/rng'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'

/** Tiers of the heap (a stepped mound): radius and the height of the walkable top. */
const TIERS = [
  { r: 6.2, h: 0.9 },
  { r: 5.0, h: 1.8 },
  { r: 3.9, h: 2.7 },
  { r: 2.9, h: 3.6 },
  { r: 2.0, h: 4.5 },
  { r: 1.35, h: 5.3 },
]
const SUMMIT = TIERS[TIERS.length - 1].h
const WIN = 10
const PAD_R = 8.8
const PADS = 6
const DUR = 180

interface PileState {
  /** Who holds the crown (-1: it is loose). */
  holder: number
  /** Seconds each toy has held the crown on the pile. */
  hold: number[]
  /** Lean of the heap towards the crowd (radians about x and z), and the shake trick's end time. */
  lx: number
  lz: number
  shakeT: number
  /** Last lurch time. */
  lurch: number
  // Host only.
  lostBy: number
  lostAt: number
  crownBody: RigidBody | null
  // Visuals.
  vis: {
    pile: THREE.Group | null
    loose: THREE.Object3D | null
    beacon: THREE.Mesh | null
    worn: { idx: number; off: (() => void) | null }
    padMeshes: THREE.Mesh[]
    padSquash: number[]
    cer: Ceremony
  }
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()

/** The heap's tilt at round time t: wobble that grows with time, plus the crowd's lean and the shake trick. */
function tilt(st: PileState, t: number, playing: boolean) {
  const k = playing ? THREE.MathUtils.clamp(t / DUR, 0, 1) : 0
  const amp = playing ? 0.012 + 0.05 * k * k : 0
  const shake = playing && st.shakeT > t ? 0.09 * Math.min(1, (st.shakeT - t) / 0.6) : 0
  const lurch = playing && t - st.lurch < 1.2 ? 0.07 * Math.sin((t - st.lurch) * 9) * (1.2 - (t - st.lurch)) : 0
  const ax = st.lx + wobble(t * 0.35, 1) * amp + wobble(t * 2.2, 5) * shake + lurch
  const az = st.lz + wobble(t * 0.3, 2) * amp + wobble(t * 2.4, 6) * shake + lurch * 0.6
  return { ax, az }
}

/** Which tier a toy stands on (-1: the floor). */
function tierOf(feet: number, r: number) {
  let best = -1
  for (let i = 0; i < TIERS.length; i++) if (r < TIERS[i].r + 0.4 && feet > TIERS[i].h - 0.45) best = i
  return best
}

function blockTexture(letter: string, col: string) {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#f3d9a4'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = col
    roundRect(g, 12, 12, 104, 104, 16)
    g.fill()
    g.fillStyle = '#fff7ed'
    g.font = '900 80px ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(letter, 64, 70)
  })
}

function bookTexture() {
  return canvasTex(256, 64, (g) => {
    const cols = ['#7f1d1d', '#1e3a8a', '#065f46', '#9a3412', '#581c87', '#0f766e', '#a16207']
    let x = 0
    let i = 0
    while (x < 256) {
      const w = 18 + ((i * 13) % 20)
      g.fillStyle = cols[i % cols.length]
      g.fillRect(x, 0, w, 64)
      g.fillStyle = 'rgba(253,230,138,0.8)'
      g.fillRect(x + 3, 10, w - 6, 3)
      g.fillRect(x + 3, 50, w - 6, 3)
      x += w
      i++
    }
  }, { repeat: [3, 1] })
}

function drumTexture() {
  return canvasTex(256, 64, (g) => {
    g.fillStyle = '#dc2626'
    g.fillRect(0, 0, 256, 64)
    g.strokeStyle = '#fde68a'
    g.lineWidth = 4
    g.beginPath()
    for (let i = 0; i <= 8; i++) {
      g.moveTo(i * 32, 8)
      g.lineTo(i * 32 + 16, 56)
      g.lineTo(i * 32 + 32, 8)
    }
    g.stroke()
    g.fillStyle = '#f8fafc'
    g.fillRect(0, 0, 256, 7)
    g.fillRect(0, 57, 256, 7)
  }, { repeat: [3, 1] })
}

function dropCrown(ctx: LevelCtx, st: PileState, from: Toy, push: { x: number; z: number }) {
  if (st.holder !== from.idx || !st.crownBody) return
  st.holder = -1
  st.lostBy = from.idx
  st.lostAt = ctx.time
  const b = st.crownBody
  b.setBodyType(ctx.RAPIER.RigidBodyType.Dynamic, true)
  b.setTranslation({ x: from.pos.x, y: from.pos.y + 1, z: from.pos.z }, true)
  const l = Math.hypot(push.x, push.z) || 1
  b.setLinvel({ x: (push.x / l) * 3.5, y: 5, z: (push.z / l) * 3.5 }, true)
  b.setAngvel({ x: ctx.rng.range(-6, 6), y: ctx.rng.range(-6, 6), z: ctx.rng.range(-6, 6) }, true)
  from.runSpeed = 5.6
  ctx.fx.sfx('crack', from.pos)
  ctx.fx.say(`${from.name} dropped the crown!`, '#fde047', 1.4)
  ctx.fx.puff(from.pos, 'spark', 14)
  ctx.emit({ drop: from.idx })
}

export default defineLevel<PileState>({
  id: 'toy-pile',
  name: 'Top of the Toy Pile',
  type: 'final',
  blurb: 'Climb the wobbling toy pile, grab the crown and hold it for 10 seconds.',
  howTo: [
    'Jump up the heap, tier by tier, to the crown on top',
    'Hold the crown on the pile for 10 seconds to win (it is heavy: you walk slower)',
    'A shove, dive or knock makes the holder drop it, and it tumbles down the pile',
    'The pile leans where the crowd climbs and gets shakier. Bounce pads fling you back in',
  ],
  accent: '#facc15',
  players: [2, 6],
  duration: DUR,
  camera: { kind: 'chase', dist: 8, height: 1.4 },
  introOrbit: { radius: 15, height: 9, center: [0, 3, 0] },
  sprinkles: { start: 2 },
  fallY: -6,
  sky: { color: '#26180e', fogNear: 45, fogFar: 120 },

  tricks: [
    {
      id: 'shake',
      name: 'Shake the Pile',
      icon: 'slam',
      cost: 2,
      cooldown: 10,
      busy: 1,
      target: 'none',
      desc: 'Kick the bottom of the heap: everyone up on the pile stumbles, and a dazed holder drops the crown.',
      counter: 'Stay near the middle of a tier, and jump as it shakes.',
      apply: (ctx, s, user) => {
        s.shakeT = ctx.time + 1.6
        ctx.fx.shake(0.5)
        ctx.fx.sfx('slam')
        ctx.fx.say(`${user.name} shook the pile!`, '#fb923c', 1.2)
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play' || t.feet < 0.6 || !t.grounded) continue
          const a = ctx.rng.range(0, Math.PI * 2)
          ctx.knock(t, { x: Math.cos(a) * 2.2, y: 3, z: Math.sin(a) * 2.2 }, t.idx === s.holder ? 0.4 : 0.25, user)
        }
      },
      botUse: (ctx, s, user) => {
        // When someone else holds the crown and I'm down low.
        return s.holder >= 0 && s.holder !== user.idx && user.feet < 1.5 && ctx.toys[s.holder]?.feet > 2 ? null : false
      },
    },
    {
      id: 'butter',
      name: 'Butterfingers',
      icon: 'tickle',
      cost: 2,
      cooldown: 8,
      busy: 0.6,
      target: 'rival',
      range: 11,
      desc: 'The crown holder fumbles: the crown pops off their head and rolls away.',
      counter: 'Bubble Wrap, or keep out of range near the top.',
      can: (_c, s, _u, target) => (target && target.idx === s.holder ? true : 'Only on the crown holder'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const a = ctx.rng.range(0, Math.PI * 2)
        dropCrown(ctx, s, target, { x: Math.cos(a), z: Math.sin(a) })
        ctx.fx.popup(target, 'Oops!', '#fde047')
      },
      botUse: (ctx, s, user) => (s.holder >= 0 && s.holder !== user.idx ? (ctx.toys[s.holder] ?? false) : false),
    },
    bubbleWrap<PileState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 18, hd: 18, ridge: 22, knee: 6, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    // A rug under the heap.
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        roughness: 1,
        map: canvasTex(512, 512, (g) => {
          g.fillStyle = '#7c2d12'
          g.fillRect(0, 0, 512, 512)
          for (let r = 250; r > 20; r -= 34) {
            g.strokeStyle = r % 68 ? '#fbbf24' : '#b91c1c'
            g.lineWidth = 14
            g.beginPath()
            g.arc(256, 256, r, 0, Math.PI * 2)
            g.stroke()
          }
        }),
      }),
    )
    rug.position.y = 0.01
    rug.receiveShadow = true
    ctx.root.add(rug)
    // Some toys lying about the floor (cosmetic).
    const horse = prop(ctx.assets, 'horse', 2.6)
    horse.position.set(-12, 0, 9)
    horse.rotation.y = 0.8
    ctx.root.add(horse)
    const chest = prop(ctx.assets, 'chest', 3.2, 'width')
    chest.position.set(12, 0, -10)
    chest.rotation.y = -0.6
    ctx.root.add(chest)
    ctx.phys.box({ x: 12, y: 1.2, z: -10 }, { x: 1.6, y: 1.2, z: 1.2 }, { rotY: -0.6 })
  },

  init(ctx) {
    const n = ctx.toys.length || 6
    const st: PileState = {
      holder: -1, hold: new Array(n).fill(0), lx: 0, lz: 0, shakeT: 0, lurch: -9, lostBy: -1, lostAt: -9, crownBody: null,
      vis: { pile: null, loose: null, beacon: null, worn: { idx: -1, off: null }, padMeshes: [], padSquash: new Array(PADS).fill(0), cer: ceremony() },
    }
    // The heap: one kinematic body (stacked cylinders = tiers, a few round bumps), and a group of toys on top.
    const body = ctx.phys.kinematic({ x: 0, y: 0, z: 0 })
    const pile = new THREE.Group()
    ctx.root.add(pile)
    st.vis.pile = pile
    TIERS.forEach((t) => ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cylinder(t.h / 2, t.r).setTranslation(0, t.h / 2, 0), { friction: 0.9 }))
    const letters = 'ABCDEFGHJKLMNPRSTUWXYZ'
    const blockCols = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777']
    const blockMats = blockCols.map((c, i) => new THREE.MeshStandardMaterial({ map: blockTexture(letters[(i * 5) % letters.length], c), roughness: 0.6 }))
    const bookMat = new THREE.MeshStandardMaterial({ map: bookTexture(), roughness: 0.8 })
    const pageMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.9 })
    const drumMat = new THREE.MeshStandardMaterial({ map: drumTexture(), roughness: 0.5 })
    const skinMat = new THREE.MeshStandardMaterial({ color: '#fefce8', roughness: 0.7 })
    const ballMats = ['#ef4444', '#3b82f6', '#facc15', '#22c55e'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }))
    const rnd = ctx.rng
    // Each tier's visible band (from the tier below's top up to this top) is covered in toys: blocks, books, drums.
    TIERS.forEach((t, k) => {
      const below = k ? TIERS[k - 1].h : 0
      const inner = TIERS[k + 1]?.r ?? 0
      const mid = (t.r + inner) / 2
      const m = Math.max(3, Math.round((2 * Math.PI * Math.max(mid, 0.8)) / 1.9))
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2 + k * 0.7 + rnd.range(-0.08, 0.08)
        const kind = (i + k) % 3
        const radial = Math.max(1, t.r - inner + 0.25)
        const tang = (2 * Math.PI * t.r) / m + 0.35
        const hgt = t.h - below + 0.15
        let mesh: THREE.Mesh
        if (k === TIERS.length - 1) {
          // The summit: a big toy drum.
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(t.r + 0.05, t.r + 0.1, hgt, 24), [drumMat, skinMat, skinMat])
          mesh.position.set(0, below - 0.15 + hgt / 2, 0)
          pile.add(mesh)
          break
        }
        if (kind === 0) {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(tang, hgt, radial), blockMats[(i + k * 2) % blockMats.length])
        } else if (kind === 1) {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(tang, hgt, radial), [pageMat, pageMat, bookMat, pageMat, bookMat, bookMat])
        } else {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(tang, radial) / 2 + 0.2, Math.min(tang, radial) / 2 + 0.25, hgt, 14), [drumMat, skinMat, skinMat])
        }
        const rr = t.r - radial / 2 + 0.1
        mesh.position.set(Math.sin(a) * rr, below - 0.15 + hgt / 2, Math.cos(a) * rr)
        mesh.rotation.y = a + rnd.range(-0.12, 0.12)
        mesh.castShadow = mesh.receiveShadow = true
        pile.add(mesh)
      }
    })
    // Beach balls wedged round the bottom.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3
      const r = rnd.range(0.55, 0.8)
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), ballMats[i % 4])
      b.position.set(Math.sin(a) * (TIERS[0].r + 0.2), r * 0.85, Math.cos(a) * (TIERS[0].r + 0.2))
      b.castShadow = true
      pile.add(b)
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.ball(r).setTranslation(b.position.x, b.position.y, b.position.z), { friction: 0.6, restitution: 0.5 })
    }
    // The four plush toys, giant-sized, slumped on the heap (posed once, then left still).
    const kinds = ctx.assets.kinds.length ? ctx.assets.kinds : []
    const tints = ['#f472b6', '#60a5fa', '#a3e635', '#fb923c']
    const rs: RigState = { anim: 'idle', speed: 0, vy: 0, grounded: true, ball: false, ballVel: new THREE.Vector3(), ballScale: 1, stun: 0 }
    kinds.slice(0, 4).forEach((kind, i) => {
      const rig = new ToyRig(ctx.assets, kind, tints[i], ctx.quality === 'high')
      rs.anim = i % 2 ? 'knock' : 'wave'
      rig.update(0.01, rs)
      rig.update(i % 2 ? 0.9 : 0.5, rs)
      rig.ring.visible = false
      const tier = TIERS[1 + i]
      const a = i * 1.7 + 0.9
      const rr = tier.r + 0.15
      rig.root.position.set(Math.sin(a) * rr, TIERS[i].h - 0.15, Math.cos(a) * rr)
      rig.root.rotation.y = a
      rig.root.scale.setScalar(2.1 - i * 0.15)
      pile.add(rig.root)
      // A soft round bump where it lies (something to hop onto).
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.ball(0.6).setTranslation(rig.root.position.x, rig.root.position.y + 0.55, rig.root.position.z), { friction: 0.6 })
    })
    // The heap moves with its tilt on every screen.
    ctx.hazards.add({
      update(c, t) {
        const { ax, az } = tilt(st, t, c.phase === 'play')
        _q.setFromEuler(_e.set(ax, 0, az))
        body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        pile.quaternion.copy(_q)
      },
      affect(c, toy, dt) {
        // On a tilted heap you slide downhill.
        if (c.phase !== 'play' || !toy.grounded || toy.feet < 0.5 || Math.hypot(toy.pos.x, toy.pos.z) > TIERS[0].r + 0.3) return
        const { ax, az } = tilt(st, c.time, true)
        const v = toy.body.linvel()
        toy.body.setLinvel({ x: v.x - Math.sin(az) * 24 * 0.75 * dt * 6, y: v.y, z: v.z + Math.sin(ax) * 24 * 0.75 * dt * 6 }, true)
      },
    })
    // Bounce pads round the base: they fling you up and back in towards the heap.
    const padMat = new THREE.MeshStandardMaterial({ color: '#ec4899', emissive: '#be185d', emissiveIntensity: 0.4, roughness: 0.4 })
    for (let i = 0; i < PADS; i++) {
      const a = (i / PADS) * Math.PI * 2 + Math.PI / PADS
      const pm = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.3, 20), padMat)
      pm.position.set(Math.sin(a) * PAD_R, 0.15, Math.cos(a) * PAD_R)
      pm.castShadow = pm.receiveShadow = true
      ctx.root.add(pm)
      st.vis.padMeshes.push(pm)
      ctx.phys.cylinder({ x: pm.position.x, y: 0.15, z: pm.position.z }, 0.15, 1.05, { restitution: 0.3 })
    }
    ctx.hazards.add({
      predict: true,
      update(_c, _t, dt) {
        st.vis.padSquash.forEach((s, i) => {
          st.vis.padSquash[i] = Math.max(0, s - dt * 4)
          st.vis.padMeshes[i].scale.y = 1 - st.vis.padSquash[i] * 0.6
        })
      },
      affect(c, toy) {
        if (!toy.grounded || toy.feet > 0.6) return
        for (let i = 0; i < PADS; i++) {
          const p = st.vis.padMeshes[i].position
          const dx = toy.pos.x - p.x, dz = toy.pos.z - p.z
          if (dx * dx + dz * dz > 1.1 * 1.1) continue
          const r = Math.hypot(p.x, p.z)
          toy.body.setLinvel({ x: (-p.x / r) * 7.5, y: 13.5, z: (-p.z / r) * 7.5 }, true)
          toy.grounded = false
          st.vis.padSquash[i] = 1
          if (c.isHost) c.fx.sfx('boing', toy.pos)
        }
      },
    })
    // The crown: loose, it is a tumbling physics prop with a beacon over it; worn, it sits on the holder's head.
    const loose = crownMesh(ctx.assets, 0.9)
    loose.position.y = -0.25
    const holder = new THREE.Group()
    holder.add(loose)
    ctx.root.add(holder)
    st.vis.loose = holder
    const cb = ctx.phys.dynamic({ x: 0, y: SUMMIT + 0.6, z: 0 }, { damping: 0.3, ccd: true })
    ctx.phys.attach(cb, ctx.RAPIER.ColliderDesc.cylinder(0.22, 0.42), { friction: 0.7, restitution: 0.35, groups: groups(G.PROP, G.WORLD | G.PROP) })
    cb.setAdditionalMass(0.4, true)
    ctx.syncProp(cb, holder)
    st.crownBody = cb
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.7, 7, 16, 1, true).translate(0, 3.5, 0),
      new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    )
    ctx.root.add(beacon)
    st.vis.beacon = beacon
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 0, radius: 10.5, faceIn: true })[i]
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    const cb = st.crownBody
    if (!cb) return
    // The heap leans towards where the crowd is (smoothed so it sways rather than snaps).
    let sx = 0, sz = 0
    for (const toy of ctx.toys) {
      if (toy.status !== 'play' || toy.feet < 0.6 || Math.hypot(toy.pos.x, toy.pos.z) > TIERS[0].r + 0.3) continue
      const w = 0.5 + toy.feet / SUMMIT
      sx += toy.pos.x * w
      sz += toy.pos.z * w
    }
    const k = 0.0045 * (1 + t / DUR)
    const tx = THREE.MathUtils.clamp(sz * k, -0.07, 0.07), tz = THREE.MathUtils.clamp(-sx * k, -0.07, 0.07)
    st.lx += (tx - st.lx) * Math.min(1, dt * 1.2)
    st.lz += (tz - st.lz) * Math.min(1, dt * 1.2)
    // Lurches: the pile shifts every 25 s or so.
    if (t - st.lurch > 25 && t > 20) {
      st.lurch = t
      ctx.fx.say('The pile shifts!', '#fdba74', 1.2)
      ctx.fx.sfx('thud')
      ctx.fx.shake(0.4)
      for (const toy of ctx.toys) if (toy.status === 'play' && toy.grounded && toy.feet > 2.5 && ctx.rng.chance(0.5)) ctx.knock(toy, { x: toy.pos.x * 0.4, y: 2.5, z: toy.pos.z * 0.4 }, 0.15)
    }
    // The crown.
    if (st.holder >= 0) {
      const h = ctx.toys[st.holder]
      if (!h || h.status === 'failed') {
        st.holder = -1
        cb.setBodyType(ctx.RAPIER.RigidBodyType.Dynamic, true)
      } else if (h.stun > 0.18 || h.grabbedBy || h.feet < -2) {
        dropCrown(ctx, st, h, { x: h.vel.x || 1, z: h.vel.z })
      } else {
        h.runSpeed = 4.7
        cb.setNextKinematicTranslation({ x: h.pos.x, y: h.pos.y + 1.2, z: h.pos.z })
        // Time only counts up on the heap.
        if (h.feet > 0.6 && Math.hypot(h.pos.x, h.pos.z) < TIERS[0].r + 0.4) {
          const before = Math.floor(st.hold[h.idx])
          st.hold[h.idx] += dt
          const now = Math.floor(st.hold[h.idx])
          if (now !== before && now >= WIN - 3 && now < WIN) ctx.fx.sfx('tick', h.pos)
          if (st.hold[h.idx] >= WIN) {
            ctx.qualify(h, 'crowned')
            h.frozen = true
            if (ctx.mode !== 'show') ctx.end()
          }
        }
      }
    } else {
      const p = cb.translation()
      if (p.y < -3 || Math.abs(p.x) > 17 || Math.abs(p.z) > 17) {
        cb.setTranslation({ x: 0, y: SUMMIT + 1, z: 0 }, true)
        cb.setLinvel({ x: 0, y: 0, z: 0 }, true)
      }
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || toy.stun > 0 || (toy.idx === st.lostBy && t - st.lostAt < 1.2) || t - st.lostAt < 0.35) continue
        const dx = toy.pos.x - p.x, dz = toy.pos.z - p.z, dy = p.y - toy.pos.y
        if (dx * dx + dz * dz < 1.1 && dy > -1.2 && dy < 1.4) {
          st.holder = toy.idx
          cb.setBodyType(ctx.RAPIER.RigidBodyType.KinematicPositionBased, true)
          ctx.fx.sfx('ding', toy.pos)
          ctx.fx.popup(toy, 'CROWN!', '#fde047')
          ctx.fx.say(`${toy.name} has the crown!`, '#fde047', 1.3)
          ctx.addSprinkles(toy, 1)
          break
        }
      }
    }
  },

  onFall(ctx, _st, toy) {
    // Off the map somehow: back on the floor by a pad.
    const a = ctx.rng.range(0, Math.PI * 2)
    ctx.respawn(toy, { x: Math.sin(a) * 10, y: 0, z: Math.cos(a) * 10, yaw: a + Math.PI }, 0.8)
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => st.hold[b.idx] - st.hold[a.idx] || (b.idx === st.holder ? 1 : 0) - (a.idx === st.holder ? 1 : 0) || b.feet - a.feet)
  },

  onThrow(ctx, st, kind, target) {
    // A paper ball can knock the crown off.
    if (kind === 'paper' && target.idx === st.holder && ctx.rng.chance(0.4)) {
      dropCrown(ctx, st, target, { x: ctx.rng.range(-1, 1), z: ctx.rng.range(-1, 1) })
    }
    return false
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { stuck?: number; lastR?: number; lastF?: number; jitter?: number }
    const cb = st.crownBody
    if (!cb) return
    const r = Math.hypot(toy.pos.x, toy.pos.z)
    const myTier = tierOf(toy.feet, r)
    let gx: number, gz: number, gy: number
    const holder = st.holder >= 0 ? ctx.toys[st.holder] : null
    if (holder === toy) {
      // King of the hill: sit on the summit and shove anyone who comes up.
      gx = 0
      gz = 0
      gy = SUMMIT
      for (const o of ctx.toys) {
        if (o === toy || o.status !== 'play' || o.pos.distanceTo(toy.pos) > 1.6) continue
        toy.yaw = Math.atan2(o.pos.x - toy.pos.x, o.pos.z - toy.pos.z)
        if (toy.shoveCd <= 0 && ctx.rng.chance(sk.aggression * 3 * dt + 0.02)) toy.pad.shove = true
      }
    } else if (holder) {
      gx = holder.pos.x
      gz = holder.pos.z
      gy = holder.feet
      const dist = holder.pos.distanceTo(toy.pos)
      if (dist < 2.4 && Math.abs(holder.feet - toy.feet) < 0.7) {
        toy.yaw = Math.atan2(holder.pos.x - toy.pos.x, holder.pos.z - toy.pos.z)
        if (dist < 1.3 && toy.shoveCd <= 0 && ctx.rng.chance(sk.aggression * 4 * dt + 0.03)) toy.pad.shove = true
        else if (dist < 2.3 && toy.diveCd <= 0 && ctx.rng.chance(sk.aggression * 1.5 * dt)) toy.pad.dive = true
      }
    } else {
      const p = cb.translation()
      gx = p.x
      gz = p.z
      gy = p.y - 0.3
    }
    const gr = Math.hypot(gx, gz)
    const goalTier = tierOf(gy, gr)
    let ax = gx, az = gz
    if (goalTier > myTier) {
      // Climb: head for the edge of the next tier up, then jump onto it.
      const next = TIERS[myTier + 1]
      const ang = r > 0.3 ? Math.atan2(toy.pos.x, toy.pos.z) : Math.atan2(gx, gz)
      const want = Math.atan2(gx, gz)
      let da = want - ang
      da = Math.atan2(Math.sin(da), Math.cos(da))
      const a = ang + THREE.MathUtils.clamp(da, -0.5, 0.5)
      const rr = Math.max(0, next.r - 0.9)
      ax = Math.sin(a) * rr
      az = Math.cos(a) * rr
      if (r < next.r + 0.75 && toy.grounded && toy.feet < next.h - 0.3 && ctx.rng.chance(0.35 + sk.accuracy * 0.5)) toy.pad.jump = true
    } else if (goalTier < myTier - 1 && gr > r) {
      // Down: just walk off the edge towards it.
      ax = gx
      az = gz
    }
    steerTo(toy, ax, az, { pace: sk.pace, stop: holder === toy ? 0.4 : 0.2 })
    if (myTier < 0) avoidWalls(ctx, toy)
    // Unstick: no progress for a while → hop.
    d.jitter = (d.jitter ?? 0) - dt
    if (d.jitter <= 0) {
      d.jitter = 1.2
      if (Math.abs((d.lastR ?? 0) - r) < 0.2 && Math.abs((d.lastF ?? 0) - toy.feet) < 0.2 && toy.grounded && (holder !== toy)) toy.pad.jump = true
      d.lastR = r
      d.lastF = toy.feet
    }
  },

  pack(_c, st) {
    const r = (x: number) => Math.round(x * 1000) / 1000
    return [st.holder, st.hold.map((h) => Math.round(h * 10) / 10), r(st.lx), r(st.lz), Math.round(st.shakeT * 10) / 10, Math.round(st.lurch * 10) / 10]
  },

  unpack(_c, st, d) {
    const a = d as [number, number[], number, number, number, number]
    st.holder = a[0]
    st.hold = a[1]
    st.lx = a[2]
    st.lz = a[3]
    st.shakeT = a[4]
    st.lurch = a[5]
  },

  onEvent(ctx, _st, data) {
    const e = data as { drop?: number }
    if (e.drop !== undefined) ctx.toys[e.drop]?.rig?.kick(-0.3)
  },

  visual(ctx, st, dt) {
    const v = st.vis
    // The worn crown follows the holder (every screen attaches it to the holder's head).
    if (v.worn.idx !== st.holder) {
      v.worn.off?.()
      v.worn.off = null
      const prev = ctx.toys[v.worn.idx]
      if (prev) prev.data.crowned = false
      v.worn.idx = st.holder
      const h = ctx.toys[st.holder]
      if (h?.rig) {
        v.worn.off = h.rig.attach('head', crownMesh(ctx.assets, 0.42), { offset: [0, 0.18, 0] })
        h.data.crowned = true
      }
    }
    if (v.loose) v.loose.visible = st.holder < 0
    if (v.beacon) {
      const target = st.holder >= 0 ? ctx.toys[st.holder]?.pos : v.loose?.position
      v.beacon.visible = !!target && ctx.phase !== 'end'
      if (target) v.beacon.position.set(target.x, target.y + (st.holder >= 0 ? 1.2 : 0.2), target.z)
      ;(v.beacon.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(ctx.time * 4) * 0.05
    }
    if (v.loose && st.holder < 0) v.loose.rotation.y += dt * 1.5
    crownCeremony(ctx, v.cer, dt)
  },

  cameraUpdate(ctx, st, cam, dt) {
    return ceremonyCamera(ctx, st.vis.cer, cam, dt)
  },

  hud(ctx, st, me) {
    const holder = st.holder >= 0 ? ctx.toys[st.holder] : null
    const bars: { label: string; value: number; color: string; danger?: boolean }[] = []
    if (me) bars.push({ label: 'Your crown time', value: Math.min(1, (st.hold[me.idx] ?? 0) / WIN), color: '#fde047' })
    const lead = ctx.toys.reduce<Toy | null>((b, t) => (t !== me && (!b || st.hold[t.idx] > st.hold[b.idx]) ? t : b), null)
    if (lead && st.hold[lead.idx] > 0) bars.push({ label: `${lead.name}`, value: Math.min(1, st.hold[lead.idx] / WIN), color: '#fb923c', danger: st.hold[lead.idx] > WIN - 3 })
    const status = holder
      ? { text: holder === me ? `YOU HAVE THE CROWN ${Math.max(0, WIN - st.hold[holder.idx]).toFixed(1)} s` : `${holder.name.toUpperCase()} HAS THE CROWN`, color: '#fde047', pulse: st.hold[holder.idx] > WIN - 3 }
      : { text: 'THE CROWN IS LOOSE', color: '#fef3c7' }
    let prompt: string | undefined
    if (me?.status === 'play') {
      if (holder === me) prompt = me.feet < 0.6 ? 'Get back on the pile: the crown only counts up there!' : 'Hold on! Shove anyone who climbs up after you.'
      else if (holder) prompt = 'Knock the crown off them: shove, dive, or Butterfingers.'
      else prompt = 'Climb the pile (jump from tier to tier) and grab the crown!'
    }
    const shaky = Math.round(100 * (0.25 + 0.75 * THREE.MathUtils.clamp(ctx.time / DUR, 0, 1)))
    return { status: ctx.phase === 'play' ? status : undefined, bars, prompt, chips: [`Hold ${WIN} s to win`, `Wobble ${shaky}%`] }
  },
})
