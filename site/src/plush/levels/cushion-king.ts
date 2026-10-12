// King of the Cushion (final). One big sofa cushion balanced on a tower of building bricks over a pit full of
// them. Last toy on the cushion wins the crown. The cushion squashes and tips towards wherever it is crowded,
// so a huddle slides everyone off; it deflates (smaller and tippier) every 20 seconds; feathers puff up out of
// it and drift across your view. Every toy has one Shove-Boost (R). Dirty tricks: a pillow puff of feathers
// over a rival's screen, and a springy seam that pops a rival up and outwards.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { bully, skill, steerTo } from '../engine/bots'
import { ceremony, ceremonyCamera, crownCeremony, type Ceremony } from '../engine/finale'
import { buildAttic } from '../engine/helpers'
import { canvasTex } from '../engine/paint'
import type { Collider } from '../engine/physics'
import { wobble } from '../engine/rng'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'

const DUR = 120
const SIZES = [5.6, 5.0, 4.4, 3.8, 3.25, 2.75] // half size per deflation step
const STEP_EVERY = 20
const THICK = 0.6
const FLOOR_Y = -5
const SEG = 22
const FEATHERS = 46

interface CushionState {
  /** Deflation step, the lean (radians about x and z) and when the last deflate happened. */
  step: number
  lx: number
  lz: number
  deflateAt: number
  /** Shove-Boost used, per toy (0/1). */
  boost: number[]
  falls: number[]
  // Host only.
  dizzy: number[]
  alive: number[]
  col: Collider | null
  // Visuals.
  vis: {
    group: THREE.Group | null
    top: THREE.Mesh | null
    side: THREE.Mesh | null
    base: Float32Array | null
    half: number
    feathers: THREE.InstancedMesh | null
    fd: { x: number; y: number; z: number; vx: number; vz: number; s: number; r: number; spin: number }[]
    puffT: number
    cer: Ceremony
    boostFx: number[]
  }
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _v = new THREE.Vector3()

function half(st: CushionState, t: number) {
  const k = st.step
  const target = SIZES[Math.min(SIZES.length - 1, k)]
  const prev = SIZES[Math.max(0, k - 1)]
  const f = THREE.MathUtils.clamp((t - st.deflateAt) / 1.5, 0, 1)
  return k === 0 ? SIZES[0] : THREE.MathUtils.lerp(prev, target, THREE.MathUtils.smoothstep(f, 0, 1))
}

function tilt(st: CushionState, t: number, playing: boolean) {
  const amp = playing ? 0.012 + st.step * 0.006 : 0
  return { ax: st.lx + wobble(t * 0.4, 3) * amp, az: st.lz + wobble(t * 0.37, 4) * amp }
}

function onCushion(toy: Toy, h: number) {
  return toy.feet > -0.8 && Math.abs(toy.pos.x) < h + 0.3 && Math.abs(toy.pos.z) < h + 0.3
}

function fabricTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b4534a'
    g.fillRect(0, 0, w, h)
    // Plaid.
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? 'rgba(253,230,138,0.22)' : 'rgba(30,58,138,0.25)'
      g.fillRect(i * 64 + 20, 0, i % 2 ? 10 : 26, h)
      g.fillRect(0, i * 64 + 20, w, i % 2 ? 10 : 26)
    }
    // Stitched piping round the edge and tufted buttons.
    g.setLineDash([12, 9])
    g.strokeStyle = 'rgba(255,240,220,0.7)'
    g.lineWidth = 5
    g.strokeRect(16, 16, w - 32, h - 32)
    g.setLineDash([])
    for (const [x, y] of [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]]) {
      const gr = g.createRadialGradient(x * w, y * h, 2, x * w, y * h, 40)
      gr.addColorStop(0, 'rgba(60,20,15,0.55)')
      gr.addColorStop(1, 'rgba(60,20,15,0)')
      g.fillStyle = gr
      g.fillRect(x * w - 40, y * h - 40, 80, 80)
      g.fillStyle = '#7f1d1d'
      g.beginPath()
      g.arc(x * w, y * h, 9, 0, Math.PI * 2)
      g.fill()
    }
  })
}

function featherTexture() {
  return canvasTex(64, 128, (g) => {
    g.translate(32, 64)
    g.strokeStyle = 'rgba(255,255,255,0.95)'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, 60)
    g.quadraticCurveTo(4, 0, 0, -60)
    g.stroke()
    g.fillStyle = 'rgba(255,250,240,0.9)'
    g.beginPath()
    g.moveTo(0, 50)
    g.bezierCurveTo(-26, 20, -22, -40, 0, -60)
    g.bezierCurveTo(22, -40, 26, 20, 0, 50)
    g.fill()
    g.strokeStyle = 'rgba(200,190,180,0.6)'
    g.lineWidth = 1
    for (let y = -45; y < 40; y += 7) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(-16, y - 8)
      g.moveTo(0, y)
      g.lineTo(16, y - 8)
      g.stroke()
    }
  })
}

function brickTexture() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = 'rgba(0,0,0,0.12)'
    for (const [x, y] of [[16, 16], [48, 16], [16, 48], [48, 48]]) {
      g.beginPath()
      g.arc(x, y, 10, 0, Math.PI * 2)
      g.fill()
    }
    g.fillStyle = 'rgba(255,255,255,0.9)'
    for (const [x, y] of [[14, 14], [46, 14], [14, 46], [46, 46]]) {
      g.beginPath()
      g.arc(x, y, 8, 0, Math.PI * 2)
      g.fill()
    }
  })
}

/** Feather flurry somewhere (local): wakes `n` feathers near `p`. */
function flurry(st: CushionState, p: THREE.Vector3Like, n: number, spread: number) {
  for (let i = 0; i < n; i++) {
    const f = st.vis.fd[(Math.random() * FEATHERS) | 0]
    f.x = p.x + (Math.random() - 0.5) * spread
    f.y = p.y + Math.random() * 1.5
    f.z = p.z + (Math.random() - 0.5) * spread
    f.vx = (Math.random() - 0.5) * 1.2
    f.vz = (Math.random() - 0.5) * 1.2
    f.s = 0.9 + Math.random() * 0.9
  }
}

function boostShove(ctx: LevelCtx, st: CushionState, toy: Toy) {
  if (st.boost[toy.idx]) return
  st.boost[toy.idx] = 1
  const f = toy.facing(_v)
  let hit = 0
  for (const o of ctx.toys) {
    if (o === toy || o.status !== 'play') continue
    const dx = o.pos.x - toy.pos.x, dz = o.pos.z - toy.pos.z
    const d = Math.hypot(dx, dz)
    if (d > 2.6 || d < 1e-3 || (dx * f.x + dz * f.z) / d < 0.35) continue
    ctx.knock(o, { x: (dx / d) * 10.5, y: 4, z: (dz / d) * 10.5 }, 0.6, toy)
    hit++
  }
  toy.pushT = 0.6
  ctx.fx.sfx('whoosh', toy.pos)
  ctx.fx.sfx('boing', toy.pos)
  ctx.fx.puff({ x: toy.pos.x + f.x, y: toy.pos.y, z: toy.pos.z + f.z }, 'spark', 16)
  ctx.fx.popup(toy, hit ? 'SHOVE-BOOST!' : 'Whiff!', '#fde047')
  if (hit) ctx.fx.hitStop(0.08)
  ctx.emit({ boost: toy.idx })
}

export default defineLevel<CushionState>({
  id: 'cushion-king',
  name: 'King of the Cushion',
  type: 'final',
  blurb: 'Last toy on the sofa cushion wins. The bricks below hurt, so nobody wants to fall.',
  howTo: [
    'Stay on the cushion: the last toy left on it wins the crown',
    'It tips towards crowds, so a huddle slides everyone off',
    'You get ONE Shove-Boost (R): a huge shove, so save it',
    'Every 20 seconds it deflates: smaller and tippier',
  ],
  accent: '#f87171',
  players: [2, 6],
  duration: DUR,
  camera: { kind: 'chase', dist: 8.5, height: 1.6 },
  introOrbit: { radius: 13, height: 7 },
  sprinkles: { start: 1 },
  fallY: -4.3,
  sky: { color: '#1f140c', fogNear: 40, fogFar: 110 },

  tricks: [
    {
      id: 'puff',
      name: 'Pillow Puff',
      icon: 'star',
      cost: 1,
      cooldown: 8,
      busy: 0.5,
      target: 'rival',
      desc: 'A burst of feathers right in front of their eyes for 3 seconds.',
      counter: 'Hold still in the middle until it clears.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        ctx.emit({ puff: 3 }, target)
        s.dizzy[target.idx] = ctx.time + 2.5
        ctx.fx.popup(target, 'Feathers!', '#fef3c7')
        ctx.fx.puff(target.pos, 'stuff', 12)
      },
    },
    {
      id: 'seam',
      name: 'Springy Seam',
      icon: 'zap',
      cost: 3,
      cooldown: 12,
      busy: 0.7,
      target: 'rival',
      range: 12,
      desc: 'The cushion springs under them and pops them up and towards the edge.',
      counter: 'Stay near the middle, and steer back in while you fly.',
      can: (ctx, s, _u, target) => (ctx.time < 12 ? 'The seams are still tight' : target && onCushion(target, half(s, ctx.time)) && target.grounded ? true : 'Only on someone standing on the cushion'),
      apply: (ctx, _s, user, target) => {
        if (!target) return
        const r = Math.hypot(target.pos.x, target.pos.z) || 1
        ctx.knock(target, { x: (target.pos.x / r) * 4.2, y: 7, z: (target.pos.z / r) * 4.2 }, 0.2, user)
        ctx.fx.sfx('boing', target.pos)
        ctx.fx.popup(target, 'Boing!', '#fde68a')
      },
    },
    bubbleWrap<CushionState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 16, hd: 16, ridge: 26, knee: 9, y: FLOOR_Y, lights: ctx.quality === 'low' ? 30 : 56, quality: ctx.quality })
    // The pit of bricks: instanced, scattered in heaps over the attic floor.
    const n = ctx.quality === 'low' ? 380 : 620
    const bricks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.45, 0.4), new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.35 }), n)
    const cols = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#f97316', '#f8fafc', '#a855f7']
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const a = ctx.rng.range(0, Math.PI * 2), r = Math.sqrt(ctx.rng.next()) * 14
      const x = Math.sin(a) * r, z = Math.cos(a) * r
      const pile = Math.max(0, 1.4 - Math.abs(Math.sin(x * 0.4) * Math.cos(z * 0.5)) * 1.2)
      _p.set(x, FLOOR_Y + 0.2 + ctx.rng.range(0, pile), z)
      _q.setFromEuler(_e.set(ctx.rng.range(-0.5, 0.5), ctx.rng.range(0, Math.PI), ctx.rng.range(-0.5, 0.5)))
      bricks.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1)))
      bricks.setColorAt(i, c.set(ctx.rng.pick(cols)))
    }
    bricks.receiveShadow = true
    ctx.root.add(bricks)
    // The tower of giant bricks the cushion balances on.
    const tower = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 1.2, 1.4), new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.35 }), 8)
    for (let i = 0; i < 8; i++) {
      _p.set(i % 2 ? 0.3 : -0.3, FLOOR_Y + 0.6 + Math.floor(i / 2) * 1.2, 0)
      _q.setFromEuler(_e.set(0, (Math.floor(i / 2) % 2) * (Math.PI / 2) + (i % 2) * 0.1, 0))
      tower.setMatrixAt(i, _m.compose(_p, _q, _s.set(1, 1, 1)))
      tower.setColorAt(i, c.set(cols[i % cols.length]))
    }
    tower.castShadow = true
    ctx.root.add(tower)
    // Giant sofa arms and an armchair round the pit, for scale.
    const chair = prop(ctx.assets, 'armchair', 9, 'height')
    chair.position.set(0, FLOOR_Y, 14)
    chair.rotation.y = Math.PI
    ctx.root.add(chair)
  },

  init(ctx) {
    const n = ctx.toys.length || 6
    const st: CushionState = {
      step: 0, lx: 0, lz: 0, deflateAt: 0, boost: new Array(n).fill(0), falls: new Array(n).fill(0), dizzy: new Array(n).fill(0), alive: new Array(n).fill(0), col: null,
      vis: { group: null, top: null, side: null, base: null, half: SIZES[0], feathers: null, fd: [], puffT: 0, cer: ceremony(), boostFx: [] },
    }
    const body = ctx.phys.kinematic({ x: 0, y: 0, z: 0 })
    st.col = ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid(SIZES[0], THICK / 2, SIZES[0]).setTranslation(0, -THICK / 2, 0), { friction: 0.9 })
    // The cushion: a puffy top (dented under toys every frame) on a fabric box.
    const group = new THREE.Group()
    ctx.root.add(group)
    st.vis.group = group
    const fabric = fabricTexture()
    const topGeo = new THREE.PlaneGeometry(2, 2, SEG, SEG).rotateX(-Math.PI / 2)
    st.vis.base = Float32Array.from(topGeo.attributes.position.array as Float32Array)
    const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ map: fabric, roughness: 0.95 }))
    top.receiveShadow = true
    top.castShadow = true
    group.add(top)
    st.vis.top = top
    const sideMat = new THREE.MeshStandardMaterial({ color: '#9b3d35', roughness: 0.95 })
    const side = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 2), [sideMat, sideMat, sideMat, sideMat, sideMat, sideMat])
    side.castShadow = true
    group.add(side)
    st.vis.side = side
    ctx.hazards.add({
      update(c, t) {
        const h = half(st, t)
        const { ax, az } = tilt(st, t, c.phase === 'play')
        _q.setFromEuler(_e.set(ax, 0, az))
        body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        group.quaternion.copy(_q)
        st.col?.setHalfExtents({ x: h, y: THICK / 2, z: h })
        st.vis.half = h
      },
      affect(c, toy, dt) {
        if (c.phase !== 'play' || !onCushion(toy, st.vis.half)) return
        if (!toy.grounded) {
          // Bouncing off the soft top: a little air drag over the cushion.
          if (toy.feet < 1.2) {
            const v = toy.body.linvel()
            const k = Math.max(0, 1 - 2.4 * dt)
            toy.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true)
          }
          return
        }
        // Slide downhill on the tipped cushion.
        const { ax, az } = tilt(st, c.time, true)
        const v = toy.body.linvel()
        // The soft cushion soaks up some of a shove (but not all of it).
        const sp = Math.hypot(v.x, v.z)
        const soak = sp > toy.runSpeed + 0.5 ? Math.max(0, 1 - 3.2 * dt) : 1
        toy.body.setLinvel({ x: v.x * soak - Math.sin(az) * 24 * dt * 3.2, y: v.y, z: v.z * soak + Math.sin(ax) * 24 * dt * 3.2 }, true)
      },
    })
    // Feathers (local): drifting up out of the cushion and the pit.
    const feathers = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.35, 0.7),
      new THREE.MeshBasicMaterial({ map: featherTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.05 }),
      FEATHERS,
    )
    feathers.frustumCulled = false
    ctx.root.add(feathers)
    st.vis.feathers = feathers
    for (let i = 0; i < FEATHERS; i++)
      st.vis.fd.push({ x: (Math.random() - 0.5) * 20, y: FLOOR_Y + Math.random() * 12, z: (Math.random() - 0.5) * 20, vx: 0, vz: 0, s: 0.6 + Math.random() * 0.6, r: Math.random() * 6, spin: 0.5 + Math.random() })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 0, radius: Math.min(3.6, 1.6 + n * 0.35), faceIn: true })[i]
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    // Deflate.
    if (st.step < SIZES.length - 1 && t >= (st.step + 1) * STEP_EVERY) {
      st.step++
      st.deflateAt = t
      ctx.fx.sfx('deflate')
      ctx.fx.say(st.step === SIZES.length - 1 ? 'Almost flat!' : 'Pffffft… the cushion deflates!', '#fca5a5', 1.4)
      ctx.fx.shake(0.3)
      ctx.emit({ deflate: 1 })
    }
    // The cushion tips towards the crowd: weight × distance from the middle, more when it is flatter.
    let sx = 0, sz = 0
    const h = half(st, t)
    for (const toy of ctx.toys) {
      if (toy.status !== 'play' || !onCushion(toy, h)) continue
      sx += toy.pos.x
      sz += toy.pos.z
    }
    const k = 0.012 + st.step * 0.006
    const tx = THREE.MathUtils.clamp(sz * k, -0.22, 0.22), tz = THREE.MathUtils.clamp(-sx * k, -0.22, 0.22)
    st.lx += (tx - st.lx) * Math.min(1, dt * 1.5)
    st.lz += (tz - st.lz) * Math.min(1, dt * 1.5)
    // A Sprinkle for every 12 seconds on the cushion.
    for (const toy of ctx.toys) {
      if (toy.status !== 'play' || !onCushion(toy, h)) continue
      st.alive[toy.idx] = (st.alive[toy.idx] ?? 0) + dt
      if (st.alive[toy.idx] >= 12) {
        st.alive[toy.idx] -= 12
        ctx.addSprinkles(toy, 1)
      }
    }
    // Shove-Boost on the action key.
    for (const toy of ctx.toys) if (toy.status === 'play' && toy.pad.act && toy.canAct && !st.boost[toy.idx]) boostShove(ctx, st, toy)
  },

  onFall(ctx, st, toy) {
    st.falls[toy.idx]++
    ctx.fx.sfx('crunch', toy.pos)
    ctx.fx.puff({ x: toy.pos.x, y: FLOOR_Y + 0.5, z: toy.pos.z }, 'crumbs', 18)
    ctx.emit({ fall: [toy.pos.x, toy.pos.z] })
    if (ctx.mode === 'show') ctx.fail(toy, 'landed on the bricks. Ouch!')
    else {
      const a = ctx.rng.range(0, Math.PI * 2)
      ctx.respawn(toy, { x: Math.sin(a) * 1.2, y: 0.4, z: Math.cos(a) * 1.2, yaw: a }, 1)
      ctx.fx.popup(toy, `Ouch! (${st.falls[toy.idx]})`, '#fca5a5')
    }
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => st.falls[a.idx] - st.falls[b.idx] || Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const h = half(st, ctx.time)
    const d = toy.data as { tgt?: number; until?: number; spotA?: number }
    const { ax, az } = tilt(st, ctx.time, true)
    // Home: near the middle, a little uphill, spread out from the others.
    d.spotA ??= ctx.rng.range(0, Math.PI * 2)
    let gx = Math.sin(d.spotA) * h * 0.22 + Math.sin(az) * h * 1.2
    let gz = Math.cos(d.spotA) * h * 0.22 - Math.sin(ax) * h * 1.2
    for (const o of ctx.toys) {
      if (o === toy || o.status !== 'play') continue
      const dx = toy.pos.x - o.pos.x, dz = toy.pos.z - o.pos.z
      const dd = Math.hypot(dx, dz)
      if (dd < 1.6 && dd > 0.01) {
        gx += (dx / dd) * (1.6 - dd)
        gz += (dz / dd) * (1.6 - dd)
      }
    }
    // Pick on someone nearer the edge than me.
    if (!d.until || ctx.time > d.until) {
      d.until = ctx.time + ctx.rng.range(1.5, 3.5)
      d.tgt = -1
      // Everyone circles warily for the first few seconds.
      if (ctx.time < 4 + ctx.rng.range(0, 4)) return void steerTo(toy, gx, gz, { pace: 0.5, stop: 0.3 })
      const myEdge = h - Math.max(Math.abs(toy.pos.x), Math.abs(toy.pos.z))
      // Late on, or down to the last few, everyone gets bolder.
      const few = ctx.toys.filter((o) => o.status === 'play').length <= 2
      const prey = ctx.toys.filter((o) => o !== toy && o.status === 'play' && o.pos.distanceTo(toy.pos) < 4.5 && (few || h - Math.max(Math.abs(o.pos.x), Math.abs(o.pos.z)) < myEdge))
      if (prey.length && ctx.rng.chance(0.12 + sk.aggression * 0.35 + (ctx.time / DUR) * 0.45)) d.tgt = ctx.rng.pick(prey).idx
    }
    const tgt = d.tgt !== undefined && d.tgt >= 0 ? ctx.toys[d.tgt] : null
    let pace = sk.pace * 0.7
    if (tgt && tgt.status === 'play') {
      // Come at them from the middle side.
      const r = Math.hypot(tgt.pos.x, tgt.pos.z) || 1
      gx = tgt.pos.x - (tgt.pos.x / r) * 0.9
      gz = tgt.pos.z - (tgt.pos.z / r) * 0.9
      pace = sk.pace
      const dist = tgt.pos.distanceTo(toy.pos)
      if (dist < 2.3) {
        toy.yaw = Math.atan2(tgt.pos.x - toy.pos.x, tgt.pos.z - toy.pos.z)
        const nearEdge = h - Math.max(Math.abs(tgt.pos.x), Math.abs(tgt.pos.z)) < 1.6
        if (!st.boost[toy.idx] && dist < 2.1 && ctx.time > 10 && (nearEdge || ctx.time > 60) && ctx.rng.chance(sk.aggression * 1.2 * dt)) toy.pad.act = true
        else if (dist < 1.4 && (nearEdge || ctx.rng.chance(0.3))) bully(toy, tgt, 1.4)
      }
    }
    // Never get near the edge on purpose.
    const lim = h - 1.5
    gx = THREE.MathUtils.clamp(gx, -lim, lim)
    gz = THREE.MathUtils.clamp(gz, -lim, lim)
    steerTo(toy, gx, gz, { pace, stop: 0.25 })
    // Pillow-puffed: can't see, so it wanders a bit.
    if (st.dizzy[toy.idx] > ctx.time) {
      toy.pad.mx = THREE.MathUtils.clamp(toy.pad.mx + Math.sin(ctx.time * 7 + toy.idx) * 0.45, -1, 1)
      toy.pad.mz = THREE.MathUtils.clamp(toy.pad.mz + Math.cos(ctx.time * 6 + toy.idx) * 0.45, -1, 1)
    }
    // Sliding towards an edge: lean back in hard.
    const edge = h - Math.max(Math.abs(toy.pos.x), Math.abs(toy.pos.z))
    if (edge < 0.8) {
      const r = Math.hypot(toy.pos.x, toy.pos.z) || 1
      toy.pad.mx = -toy.pos.x / r
      toy.pad.mz = -toy.pos.z / r
    }
  },

  pack(_c, st) {
    const r = (x: number) => Math.round(x * 1000) / 1000
    return [st.step, r(st.lx), r(st.lz), Math.round(st.deflateAt * 10) / 10, st.boost, st.falls]
  },

  unpack(_c, st, d) {
    const a = d as [number, number, number, number, number[], number[]]
    st.step = a[0]
    st.lx = a[1]
    st.lz = a[2]
    st.deflateAt = a[3]
    st.boost = a[4]
    st.falls = a[5]
  },

  onEvent(ctx, st, data) {
    const e = data as { puff?: number; fall?: [number, number]; deflate?: number; boost?: number }
    if (e.puff) {
      // A cloud of feathers right in front of this screen's camera.
      st.vis.puffT = e.puff
      const cam = ctx.cam.camera
      cam.getWorldDirection(_v)
      flurry(st, { x: cam.position.x + _v.x * 2.2, y: cam.position.y - 1, z: cam.position.z + _v.z * 2.2 }, 34, 2.4)
      ctx.fxLocal.sfx('whoosh')
    }
    if (e.fall) flurry(st, { x: e.fall[0], y: FLOOR_Y, z: e.fall[1] }, 10, 2)
    if (e.deflate) flurry(st, { x: 0, y: -0.5, z: 0 }, 16, st.vis.half * 2)
    if (e.boost !== undefined) ctx.toys[e.boost]?.rig?.kick(0.3)
  },

  visual(ctx, st, dt) {
    const v = st.vis
    const t = ctx.time
    const h = v.half
    // Puffy top with dents under each toy (crowds make a bowl that tips them in together).
    if (v.top && v.base && v.group && v.side) {
      const thick = THICK * (1 - st.step * 0.08)
      v.side.scale.set(h, thick, h)
      v.side.position.y = -thick / 2 - 0.05
      const pos = v.top.geometry.attributes.position as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      const inv = _q.copy(v.group.quaternion).invert()
      const local: { x: number; z: number }[] = []
      for (const toy of ctx.toys) {
        if (toy.status === 'failed' || !onCushion(toy, h)) continue
        _v.set(toy.pos.x, 0, toy.pos.z).applyQuaternion(inv)
        local.push({ x: _v.x, z: _v.z })
      }
      const puff = 0.28 * (1 - st.step * 0.12)
      for (let i = 0; i < arr.length; i += 3) {
        const bx = v.base[i] * h, bz = v.base[i + 2] * h
        const ux = v.base[i], uz = v.base[i + 2]
        let y = puff * (1 - ux * ux * ux * ux) * (1 - uz * uz * uz * uz)
        for (const p of local) {
          const dx = bx - p.x, dz = bz - p.z
          y -= 0.32 * Math.exp(-(dx * dx + dz * dz) * 1.3)
        }
        arr[i] = bx
        arr[i + 1] = Math.max(-0.2, y)
        arr[i + 2] = bz
      }
      pos.needsUpdate = true
      v.top.geometry.computeVertexNormals()
      v.top.geometry.computeBoundingSphere()
    }
    // Feathers drift up, sway and spin; recycled at the bottom.
    if (v.feathers) {
      v.puffT = Math.max(0, v.puffT - dt)
      const rate = 0.35 + st.step * 0.08
      for (let i = 0; i < FEATHERS; i++) {
        const f = v.fd[i]
        f.y += dt * rate * (0.6 + (i % 5) * 0.12)
        f.x += (f.vx + Math.sin(t * 0.8 + i) * 0.4) * dt
        f.z += (f.vz + Math.cos(t * 0.7 + i * 1.3) * 0.4) * dt
        f.vx *= 1 - dt
        f.vz *= 1 - dt
        f.r += dt * f.spin
        if (f.y > 9) {
          f.y = FLOOR_Y + Math.random() * 2
          const a = Math.random() * Math.PI * 2, rr = h + 1 + Math.random() * 5
          f.x = Math.sin(a) * rr
          f.z = Math.cos(a) * rr
        }
        _p.set(f.x, f.y, f.z)
        _q.setFromEuler(_e.set(Math.sin(f.r) * 0.8, f.r, Math.cos(f.r * 0.7) * 0.5))
        v.feathers.setMatrixAt(i, _m.compose(_p, _q, _s.setScalar(f.s)))
      }
      v.feathers.instanceMatrix.needsUpdate = true
    }
    crownCeremony(ctx, v.cer, dt)
  },

  cameraUpdate(ctx, st, cam, dt) {
    if (ceremonyCamera(ctx, st.vis.cer, cam, dt)) return true
    // Out (or watching): a grandstand view of the whole cushion, not a camera stuck under it in the bricks.
    const me = ctx.me
    if (ctx.phase === 'play' && (!me || me.status === 'failed')) {
      const a = ctx.time * 0.12
      _p.set(Math.sin(a) * 11, 8.5, Math.cos(a) * 11)
      cam.place(_p, _v.set(0, -0.5, 0), dt, 2)
      return true
    }
    return false
  },

  hud(ctx, st, me) {
    const left = ctx.toys.filter((t) => t.status === 'play').length
    const next = st.step < SIZES.length - 1 ? Math.max(0, Math.ceil((st.step + 1) * STEP_EVERY - ctx.time)) : -1
    const chips = [`${left} on the cushion`, next >= 0 ? `Deflates in ${next} s` : 'Flat as a pancake']
    if (ctx.mode === 'quick' && me) chips.push(`Falls: ${st.falls[me.idx] ?? 0}`)
    let prompt: string | undefined
    if (me?.status === 'play') {
      if (st.vis.puffT > 0) prompt = 'Feathers everywhere! Hold still in the middle.'
      else if (!st.boost[me.idx]) prompt = 'Shove-Boost ready: press R (once!) when a rival is near the edge.'
      else prompt = 'Stay in the middle and away from crowds: the cushion tips towards them.'
    }
    const tiltAmt = Math.hypot(st.lx, st.lz) / 0.22
    return {
      chips,
      prompt,
      status: ctx.phase === 'play' && tiltAmt > 0.55 ? { text: 'TIPPING!', color: '#fca5a5', pulse: true } : undefined,
      bars: me ? [{ label: 'Tilt', value: Math.min(1, tiltAmt), color: '#f87171', danger: tiltAmt > 0.55 }] : [],
    }
  },
})
