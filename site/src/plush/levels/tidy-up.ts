// Tidy Up Time (team). The playroom rug is a mess. Carry the small toys (blocks, balls, ducks, crayons) to your
// team's basket and lob them in; push the big ones (the rocking horse, the spinning top, the beach ball) onto your
// team's mat; the golden duck is worth five. Baskets count what's inside them right now, so steal from theirs, and
// knock theirs over to spill it (a teammate stands it back up with R). In the last 30 seconds a giant toddler hand
// drops more mess on the rug. Most tidied when time runs out wins.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { prop } from '../engine/assets'
import { avoidWalls, bully, hopObstacles, nearestRival, skill, steerTo, teamRank } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import type { RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { basketMesh, carryTo, fetch, holdChanges, holderOf, looseBody, mat, paint, park, parked, poss, r2, stripeTex, unpark } from './team-kit'

const HW = 12
const HD = 9
const BASKET_X = 9.6
const BR = 1.15
const BH = 0.8
/** Big toys count once pushed past this line into a team's end of the room. */
const LINE_X = 5
const MAT_X = (LINE_X + HW) / 2
const HAND_AT = 90
const N_SMALL = 22
const N_POOL = 10
const BIG_VALUE = 3
const GOLD_VALUE = 5

type Kind = 'block' | 'ball' | 'duck' | 'crayon' | 'ring' | 'gold'

interface TidyState {
  /** Items in each basket right now and big toys on each mat (synced, for the HUD). */
  inBasket: [number, number]
  onMat: [number, number]
  /** Basket tipped over until this time (0 = upright). */
  tipped: [number, number]
  /** The toddler hand: where it is heading and its drop phase (synced). */
  hand: { x: number; z: number; t0: number; on: number }
  goldOut: number
  // Host only.
  items: RigidBody[]
  kinds: Kind[]
  big: RigidBody[]
  baskets: [RigidBody, RigidBody]
  prev: number[]
  nextDrop: number
  // Visuals.
  vis: { baskets: THREE.Object3D[]; hand: THREE.Group; beam: THREE.Mesh; gold: THREE.Object3D | null; mats: THREE.Mesh[] }
}

const basketX = (team: number) => (team === 0 ? -BASKET_X : BASKET_X)
const matX = (team: number) => (team === 0 ? -MAT_X : MAT_X)

function inBasket(team: number, p: { x: number; y: number; z: number }) {
  return Math.hypot(p.x - basketX(team), p.z) < BR - 0.1 && p.y < BH + 0.6
}
function onMat(team: number, p: { x: number; z: number }) {
  return team === 0 ? p.x < -LINE_X : p.x > LINE_X
}
function valueOf(k: Kind) {
  return k === 'gold' ? GOLD_VALUE : 1
}

/** The playroom rug: a little town with roads. */
function townTex() {
  return paint(512, 384, (g, w, h) => {
    g.fillStyle = '#7fb069'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#5c8f4c'
    for (let i = 0; i < 40; i++) g.fillRect((i * 97) % w, (i * 53) % h, 10, 10)
    g.fillStyle = '#5b6170'
    const road = (x: number, y: number, rw: number, rh: number) => g.fillRect(x, y, rw, rh)
    road(0, h * 0.45, w, 36)
    road(w * 0.3, 0, 36, h)
    road(w * 0.7, 0, 36, h)
    g.strokeStyle = '#f8fafc'
    g.lineWidth = 3
    g.setLineDash([14, 12])
    g.beginPath()
    g.moveTo(0, h * 0.45 + 18)
    g.lineTo(w, h * 0.45 + 18)
    g.moveTo(w * 0.3 + 18, 0)
    g.lineTo(w * 0.3 + 18, h)
    g.moveTo(w * 0.7 + 18, 0)
    g.lineTo(w * 0.7 + 18, h)
    g.stroke()
    g.setLineDash([])
    // Houses and a pond.
    const cols = ['#e76f51', '#f4a261', '#e9c46a', '#2a9d8f', '#9b5de5']
    for (let i = 0; i < 10; i++) {
      const x = 30 + ((i * 131) % (w - 80)), y = 30 + ((i * 71) % (h - 80))
      if (Math.abs(y - h * 0.45) < 50) continue
      g.fillStyle = cols[i % cols.length]
      g.fillRect(x, y, 34, 26)
      g.fillStyle = '#7c2d12'
      g.beginPath()
      g.moveTo(x - 4, y)
      g.lineTo(x + 17, y - 16)
      g.lineTo(x + 38, y)
      g.fill()
    }
    g.fillStyle = '#60a5fa'
    g.beginPath()
    g.ellipse(w * 0.5, h * 0.18, 40, 22, 0, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = '#f5deb3'
    g.lineWidth = 10
    g.strokeRect(5, 5, w - 10, h - 10)
  })
}

function letterTex(ch: string, bg: string) {
  return paint(64, 64, (g, w, h) => {
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(255,255,255,0.7)'
    g.lineWidth = 4
    g.strokeRect(5, 5, w - 10, h - 10)
    g.fillStyle = '#ffffff'
    g.font = '900 40px ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(ch, w / 2, h / 2 + 2)
  })
}

/** Meshes for the small toys (shared geometry and materials). */
function itemFactory() {
  const block = new RoundedBoxGeometry(0.46, 0.46, 0.46, 1, 0.05)
  const blockMats = [['A', '#ef4444'], ['B', '#3b82f6'], ['C', '#22c55e'], ['D', '#f59e0b']].map(([c, b]) => new THREE.MeshStandardMaterial({ map: letterTex(c, b), roughness: 0.7 }))
  const ballGeo = new THREE.IcosahedronGeometry(0.3, 1)
  const ballMats = [['#f43f5e', '#fde68a'], ['#0ea5e9', '#ffffff'], ['#a855f7', '#fef08a']].map((c) => new THREE.MeshStandardMaterial({ map: stripeTex(c, 6, true), roughness: 0.5 }))
  const duckBody = new THREE.SphereGeometry(0.28, 10, 8)
  const duckHead = new THREE.SphereGeometry(0.17, 10, 8)
  const beak = new THREE.ConeGeometry(0.07, 0.16, 6).rotateZ(-Math.PI / 2)
  const yellow = mat('#facc15', { roughness: 0.45 })
  const gold = mat('#fbbf24', { metalness: 0.85, roughness: 0.25, emissive: '#b45309', emissiveIntensity: 0.35 })
  const orange = mat('#f97316')
  const crayonGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.62, 8).rotateZ(Math.PI / 2)
  const tipGeo = new THREE.ConeGeometry(0.1, 0.18, 8).rotateZ(-Math.PI / 2)
  const crayonMats = ['#dc2626', '#2563eb', '#16a34a', '#9333ea'].map((c) => mat(c, { roughness: 0.6 }))
  const ringGeo = new THREE.TorusGeometry(0.24, 0.1, 6, 14).rotateX(Math.PI / 2)
  const ringMats = ['#f472b6', '#38bdf8', '#a3e635'].map((c) => mat(c, { roughness: 0.4 }))
  return (k: Kind, i: number): THREE.Object3D => {
    if (k === 'block') return new THREE.Mesh(block, blockMats[i % blockMats.length])
    if (k === 'ball') return new THREE.Mesh(ballGeo, ballMats[i % ballMats.length])
    if (k === 'crayon') {
      const g = new THREE.Group()
      const m = crayonMats[i % crayonMats.length]
      const tip = new THREE.Mesh(tipGeo, m)
      tip.position.x = 0.4
      g.add(new THREE.Mesh(crayonGeo, m), tip)
      return g
    }
    if (k === 'ring') return new THREE.Mesh(ringGeo, ringMats[i % ringMats.length])
    // Ducks (and the golden duck).
    const m = k === 'gold' ? gold : yellow
    const g = new THREE.Group()
    const body = new THREE.Mesh(duckBody, m)
    body.scale.set(1, 0.8, 1.2)
    const head = new THREE.Mesh(duckHead, m)
    head.position.set(0, 0.22, 0.16)
    const b = new THREE.Mesh(beak, orange)
    b.rotation.y = -Math.PI / 2
    b.position.set(0, 0.2, 0.33)
    g.add(body, head, b)
    if (k === 'gold') g.scale.setScalar(1.35)
    return g
  }
}

function shape(k: Kind): Parameters<typeof looseBody>[2] {
  if (k === 'block') return { box: [0.23, 0.23, 0.23] }
  if (k === 'crayon') return { capsule: [0.25, 0.1] }
  if (k === 'ring') return { box: [0.3, 0.1, 0.3] }
  if (k === 'gold') return { ball: 0.4 }
  return { ball: 0.29 }
}

/** The toddler's hand: a chubby palm, four fingers and a thumb, and a striped sleeve. */
function handMesh() {
  const g = new THREE.Group()
  const skin = mat('#f2c4a0', { roughness: 0.6 })
  const palm = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.9, 2.2, 2, 0.4), skin)
  g.add(palm)
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 3, 8), skin)
    f.rotation.x = Math.PI / 2 - 0.5
    f.position.set(-0.85 + i * 0.57, -0.4, 1.45)
    g.add(f)
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.7, 3, 8), skin)
  thumb.rotation.set(0.3, 0, 1.1)
  thumb.position.set(1.5, -0.3, 0.3)
  g.add(thumb)
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 6, 12), new THREE.MeshStandardMaterial({ map: stripeTex(['#60a5fa', '#fde68a'], 8), roughness: 0.9 }))
  sleeve.position.set(0, 3.4, -0.6)
  sleeve.rotation.x = -0.25
  g.add(sleeve)
  return g
}

export default defineLevel<TidyState>({
  id: 'tidy-up',
  name: 'Tidy Up Time',
  type: 'team',
  blurb: 'The playroom is a mess. Tidy more toys into your basket than the other team.',
  howTo: [
    'Grab (E) small toys and let go near your basket to lob them in',
    'Push the big toys over your team’s line: three each. The golden duck: five',
    'Baskets count what is in them now: steal from theirs, knock it over',
    'A tipped basket spills: stand it up with R. Last 30 s: the toddler drops more mess',
  ],
  accent: '#22c55e',
  players: [2, 16],
  duration: 120,
  teams: { names: ['Neatniks', 'Tidy Paws'], colors: ['#f59e0b', '#14b8a6'], scoreName: 'tidied' },
  sprinkles: { start: 1 },
  camera: { kind: 'chase', dist: 7.5 },
  introOrbit: { radius: 15, height: 9 },
  sky: { color: '#2b1a12', fogNear: 40, fogFar: 120 },

  tricks: [
    {
      id: 'tip',
      name: 'Tip It Over',
      icon: 'slam',
      cost: 3,
      cooldown: 18,
      busy: 1.2,
      target: 'none',
      desc: "Knock the other team's basket over: everything in it spills out across the rug.",
      counter: 'A teammate stands it back up with R (it rights itself after 8 s).',
      can: (ctx, s, user) => (s.tipped[1 - user.team] > ctx.time ? 'Already tipped' : true),
      apply: (ctx, s, user) => tipBasket(ctx, s, 1 - user.team, user),
      botUse: (ctx, s, user) => {
        const them = 1 - user.team
        return s.tipped[them] <= ctx.time && s.inBasket[them] >= 4 ? null : false
      },
    },
    {
      id: 'sticky',
      name: 'Sticky Fingers',
      icon: 'magnet',
      cost: 2,
      cooldown: 12,
      busy: 1,
      target: 'none',
      desc: "Swipe the two best toys out of the other team's basket and into yours.",
      counter: 'Keep a guard by your basket: it only works when theirs has something in it.',
      can: (ctx, s, user) => (s.inBasket[1 - user.team] < 1 ? 'Their basket is empty' : s.tipped[user.team] > ctx.time ? 'Your basket is tipped over' : true),
      apply: (ctx, s, user) => {
        const them = 1 - user.team
        const loot = s.items.map((b, i) => ({ b, i })).filter(({ b }) => inBasket(them, b.translation()) && !holderOf(ctx, b))
        loot.sort((a, b) => valueOf(s.kinds[b.i]) - valueOf(s.kinds[a.i]))
        for (const { b } of loot.slice(0, 2)) {
          ctx.fx.puff(b.translation(), 'spark', 8)
          unpark(b, basketX(user.team) + ctx.rng.range(-0.3, 0.3), 2.2, ctx.rng.range(-0.3, 0.3))
        }
        ctx.fx.say('STICKY FINGERS!', ctx.teams[user.team].color, 1.3)
        ctx.fx.sfx('zap')
      },
      botUse: (_c, s, user) => (s.inBasket[1 - user.team] >= 3 ? null : false),
    },
    {
      id: 'marbles',
      name: 'Marble Spill',
      icon: 'crumb',
      cost: 2,
      cooldown: 9,
      busy: 0.5,
      target: 'rival',
      desc: 'Roll marbles under a rival: they skid over and drop whatever they are carrying.',
      counter: 'Bubble Wrap, or jump as they roll in.',
      apply: (ctx, _s, _u, target) => {
        if (!target) return
        const a = ctx.rng.range(0, Math.PI * 2)
        ctx.knock(target, { x: Math.cos(a) * 4, y: 3, z: Math.sin(a) * 4 }, 1)
        ctx.fx.puff(target.pos, 'spark', 12)
        ctx.fx.popup(target, 'Marbles!', '#93c5fd')
        ctx.fx.sfx('tick', target.pos)
      },
      botUse: (ctx, _s, user) => {
        for (const t of ctx.rivalsOf(user)) if (t.holdingProp && t.pos.distanceTo(user.pos) < 12) return t
        return false
      },
    },
    bubbleWrap<TidyState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: HW, hd: HD, ridge: 15, knee: 4, lights: ctx.quality === 'low' ? 20 : 40, quality: ctx.quality })
    const rugTex = townTex()
    rugTex.wrapS = rugTex.wrapT = THREE.ClampToEdgeWrapping
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 - 2, HD * 2 - 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }))
    rug.position.y = 0.01
    rug.receiveShadow = true
    ctx.root.add(rug)
    // Shelves along the back wall (empty: everything is on the floor) and a toy chest.
    const shelf = mat('#a0663a', { roughness: 0.7 })
    for (const y of [0.9, 2.1, 3.3]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(8, 0.15, 1.2), shelf)
      b.position.set(-2, y, -HD + 0.6)
      ctx.root.add(b)
    }
    for (const x of [-6, 2]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.5, 1.2), shelf)
      side.position.set(x, 1.75, -HD + 0.6)
      ctx.root.add(side)
    }
    ctx.phys.box({ x: -2, y: 1.75, z: -HD + 0.6 }, { x: 4, y: 1.75, z: 0.6 })
    const chest = prop(ctx.assets, 'chest', 2.4)
    chest.position.set(6, 0, -HD + 1.4)
    ctx.root.add(chest)
    ctx.phys.box({ x: 6, y: 1, z: -HD + 1.4 }, { x: 1.6, y: 1, z: 1 })
    const boxes = prop(ctx.assets, 'boxes', 2.6)
    boxes.position.set(-9, 0, HD - 1.2)
    ctx.root.add(boxes)
    ctx.phys.box({ x: -9, y: 1.2, z: HD - 1.2 }, { x: 1.4, y: 1.2, z: 1 })
  },

  init(ctx) {
    const make = itemFactory()
    const st: TidyState = {
      inBasket: [0, 0], onMat: [0, 0], tipped: [0, 0], hand: { x: 0, z: 0, t0: -99, on: 0 }, goldOut: 0,
      items: [], kinds: [], big: [], baskets: null as unknown as [RigidBody, RigidBody], prev: [], nextDrop: HAND_AT,
      vis: null as unknown as TidyState['vis'],
    }
    // Baskets: a ring of thin walls on a kinematic body (moved away while tipped), and the team mat.
    const baskets: RigidBody[] = []
    const bmeshes: THREE.Object3D[] = []
    const mats: THREE.Mesh[] = []
    for (const team of [0, 1]) {
      const kb = ctx.phys.kinematic({ x: basketX(team), y: 0, z: 0 })
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const c = ctx.RAPIER.ColliderDesc.cuboid(0.07, BH / 2, 0.32).setTranslation(Math.sin(a) * BR, BH / 2, Math.cos(a) * BR).setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) })
        ctx.phys.attach(kb, c, { friction: 0.5 })
      }
      baskets.push(kb)
      const m = basketMesh(BR, BH, ctx.teams[team].color)
      m.position.set(basketX(team), 0, 0)
      ctx.root.add(m)
      bmeshes.push(m)
      // The team's end of the room: a tinted floor and a striped tape line (big toys past it count).
      const end = new THREE.Mesh(new THREE.PlaneGeometry(HW - LINE_X, HD * 2 - 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ctx.teams[team].color, transparent: true, opacity: 0.16, depthWrite: false }))
      end.position.set(matX(team), 0.02, 0)
      ctx.root.add(end)
      const tape = stripeTex([ctx.teams[team].color, '#fff7ed'], 2)
      tape.repeat.set(1, 20)
      const mt = new THREE.Mesh(new THREE.PlaneGeometry(0.35, HD * 2 - 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tape, roughness: 1 }))
      mt.position.set(team === 0 ? -LINE_X : LINE_X, 0.03, 0)
      ctx.root.add(mt)
      mats.push(mt)
    }
    st.baskets = baskets as [RigidBody, RigidBody]
    // Small toys scattered over the middle of the rug (mirrored, so neither team gets the closer half).
    const kinds: Kind[] = ['block', 'ball', 'duck', 'crayon', 'ring']
    const addItem = (k: Kind, x: number, z: number, i: number) => {
      const b = looseBody(ctx, { x, y: 0.5, z }, shape(k), { density: k === 'gold' ? 0.6 : 0.45, restitution: k === 'ball' ? 0.6 : 0.2 })
      const m = make(k, i)
      m.traverse((o) => ((o as THREE.Mesh).castShadow = true))
      ctx.root.add(m)
      ctx.grabbable(b, m)
      st.items.push(b)
      st.kinds.push(k)
      return b
    }
    for (let i = 0; i < N_SMALL / 2; i++) {
      const x = ctx.rng.range(0.6, 6.5), z = ctx.rng.range(-7.5, 7.5)
      const k = kinds[i % kinds.length]
      addItem(k, x, z, i)
      addItem(k, -x, -z, i + 1)
    }
    // The golden duck waits in the middle (then a second one drops with the toddler).
    addItem('gold', 0, 0, 0)
    // More mess for the toddler hand (parked until then), and a second golden duck.
    for (let i = 0; i < N_POOL; i++) park(addItem(kinds[i % kinds.length], 0, 0, i), i)
    park(addItem('gold', 0, 0, 1), 20)
    // Big toys to push: the rocking horse, the spinning top and a beach ball.
    const bigs: [THREE.Object3D, Parameters<typeof looseBody>[2], number, number, number][] = [
      [prop(ctx.assets, 'horse', 1.7), { box: [0.35, 0.75, 0.85] }, 0, -4.5, 0.9],
      [prop(ctx.assets, 'top', 1.4), { ball: 0.68 }, 0, 4.5, 1.1],
      [new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 2), new THREE.MeshStandardMaterial({ map: stripeTex(['#ef4444', '#ffffff', '#3b82f6', '#ffffff', '#facc15', '#ffffff'], 6, true), roughness: 0.35 })), { ball: 0.85 }, 0, 0, 0.35],
    ]
    bigs.forEach(([obj, sh, x, z, dens], i) => {
      const b = looseBody(ctx, { x, y: 1, z: i === 2 ? 2.2 : z }, sh, { density: dens, friction: 0.45, restitution: i === 2 ? 0.55 : 0.1, damping: 0.5 })
      if (i < 2) b.lockRotations(true, false)
      const holder = new THREE.Group()
      if (i < 2) obj.position.y = i === 0 ? -0.75 : -0.68
      holder.add(obj)
      obj.traverse((o) => ((o as THREE.Mesh).castShadow = true))
      ctx.root.add(holder)
      ctx.syncProp(b, holder)
      st.big.push(b)
    })
    // The toddler hand and a golden beam over the golden duck.
    const hand = handMesh()
    hand.visible = false
    ctx.root.add(hand)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 7, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
    ctx.root.add(beam)
    st.prev = new Array(st.items.length).fill(-1)
    st.vis = { baskets: bmeshes, hand, beam, gold: null, mats }
    return st
  },

  spawn(ctx, _s, toy, i) {
    const team = toy.team === 1 ? 1 : 0
    let k = 0, n = 0
    ctx.toys.forEach((t, j) => {
      if (t.team !== toy.team) return
      n++
      if (j < i) k++
    })
    return ctx.spawnGrid(n, { x: team === 0 ? -6.9 : 6.9, z: 0, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2, spacing: 1.3, cols: 4 })[k]
  },

  tick(ctx, s) {
    const t = ctx.time
    // Let go near your own basket and the toy is lobbed in (a gentle assist); elsewhere it's a plain toss.
    for (const ev of holdChanges(ctx, s.items, s.prev)) {
      const b = s.items[ev.i]
      const team = ev.by.team
      const bx = basketX(team)
      const p = b.translation()
      const d = Math.hypot(p.x - bx, p.z)
      if (d < 4.2 && s.tipped[team] <= t) {
        const T = 0.38 + d * 0.06
        b.setLinvel({ x: (bx - p.x) / T + ctx.rng.range(-0.3, 0.3), y: (BH + 0.4 - p.y + 12 * T * T) / T, z: (0 - p.z) / T + ctx.rng.range(-0.3, 0.3) }, true)
      }
    }
    // Count.
    let sb0 = 0, sb1 = 0, n0 = 0, n1 = 0
    s.items.forEach((b, i) => {
      if (parked(b) || holderOf(ctx, b)) return
      const p = b.translation()
      const v = valueOf(s.kinds[i])
      if (s.tipped[0] <= t && inBasket(0, p)) {
        sb0 += v
        n0++
      } else if (s.tipped[1] <= t && inBasket(1, p)) {
        sb1 += v
        n1++
      }
    })
    let m0 = 0, m1 = 0
    for (const b of s.big) {
      const p = b.translation()
      if (onMat(0, p)) m0++
      else if (onMat(1, p)) m1++
    }
    // A cheer when a big toy lands on a mat.
    if (m0 > s.onMat[0] || m1 > s.onMat[1]) {
      const team = m0 > s.onMat[0] ? 0 : 1
      ctx.fx.say(`BIG TOY OVER THE ${ctx.teams[team].name.toUpperCase()} LINE: +3`, ctx.teams[team].color, 1.4)
      ctx.fx.sfx('ding', { x: matX(team), y: 1, z: 0 })
      for (const toy of ctx.teamToys(team)) if (onMat(team, toy.pos)) ctx.addSprinkles(toy, 1)
    }
    s.inBasket = [n0, n1]
    s.onMat = [m0, m1]
    ctx.setTeamScore(0, sb0 + m0 * BIG_VALUE)
    ctx.setTeamScore(1, sb1 + m1 * BIG_VALUE)

    // Baskets: right a tipped one with R (or wait), and a dive into a basket knocks it over.
    for (const team of [0, 1]) {
      const kb = s.baskets[team]
      const tipped = s.tipped[team] > t
      kb.setNextKinematicTranslation({ x: basketX(team), y: tipped ? -5 : 0, z: 0 })
      if (tipped) {
        for (const toy of ctx.teamToys(team)) {
          if (toy.pad.act && Math.hypot(toy.pos.x - basketX(team), toy.pos.z) < 2.3) {
            s.tipped[team] = 0
            ctx.fx.popup(toy, 'Basket up!', ctx.teams[team].color)
            ctx.fx.sfx('thud', toy.pos)
            ctx.addSprinkles(toy, 1)
            break
          }
        }
      } else {
        for (const toy of ctx.toys) {
          if (toy.status !== 'play' || toy.team === team || toy.dive <= 0) continue
          if (Math.hypot(toy.pos.x - basketX(team), toy.pos.z) < BR + 0.6) {
            tipBasket(ctx, s, team, toy)
            break
          }
        }
      }
    }

    // Items knocked out of the room come back in the middle.
    for (const b of [...s.items, ...s.big]) {
      if (parked(b)) continue
      const p = b.translation()
      if (p.y < -3 || Math.abs(p.x) > HW + 1 || Math.abs(p.z) > HD + 1) unpark(b, ctx.rng.range(-3, 3), 2, ctx.rng.range(-3, 3))
    }

    // The toddler hand: from 90 s it drops a few more toys at a time on the rug (and bonks whoever is under it).
    if (t >= s.nextDrop) {
      const pool = s.items.filter((b) => parked(b))
      if (pool.length) {
        if (s.hand.t0 < 0) ctx.fx.say('UH OH. THE TODDLER IS HERE!', '#f472b6', 2.2)
        s.hand = { x: ctx.rng.range(-5, 5), z: ctx.rng.range(-5.5, 5.5), t0: t, on: 1 }
        s.nextDrop = t + 6
      } else s.nextDrop = Infinity
    }
    if (s.hand.on === 1 && t - s.hand.t0 > 1.1) {
      // Drop: a handful of toys (the second golden duck comes in a late drop).
      s.hand.on = 2
      let k = 0
      const goldPark = s.items.find((b, i) => s.kinds[i] === 'gold' && parked(b))
      const last = ctx.timeLeft < 12 || s.items.filter((b) => parked(b)).length <= 4
      if (goldPark && last) {
        unpark(goldPark, s.hand.x, 3, s.hand.z)
        s.goldOut++
        ctx.fx.say('A GOLDEN DUCK!', '#fde047', 1.6)
        k++
      }
      for (const b of s.items) {
        if (k >= 3) break
        if (!parked(b) || b === goldPark) continue
        unpark(b, s.hand.x + ctx.rng.range(-0.8, 0.8), 3 + k * 0.4, s.hand.z + ctx.rng.range(-0.8, 0.8))
        k++
      }
      ctx.fx.sfx('thud', { x: s.hand.x, y: 0, z: s.hand.z })
      ctx.fx.shake(0.25)
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || Math.hypot(toy.pos.x - s.hand.x, toy.pos.z - s.hand.z) > 1.6) continue
        const a = Math.atan2(toy.pos.x - s.hand.x, toy.pos.z - s.hand.z)
        ctx.knock(toy, { x: Math.sin(a) * 6, y: 4, z: Math.cos(a) * 6 }, 0.9)
        ctx.fx.popup(toy, 'Pat pat!', '#f9a8d4')
      }
    }
  },

  bot(ctx, s, toy) {
    const sk = skill(ctx)
    const t = ctx.time
    const team = toy.team === 1 ? 1 : 0
    const them = 1 - team
    const pace = sk.pace
    const d = toy.data as { job?: string; until?: number; item?: number; big?: number }
    // Our basket is over: the nearest teammate stands it up.
    if (s.tipped[team] > t) {
      const { rank } = teamRank(ctx, toy, (o) => Math.hypot(o.pos.x - basketX(team), o.pos.z))
      if (rank === 0) {
        toy.pad.grab = false
        const dd = steerTo(toy, basketX(team) + (team === 0 ? 1.4 : -1.4), 0, { stop: 0.3, pace })
        if (dd < 1.2 && ctx.rng.chance(0.15)) toy.pad.act = true
        return
      }
    }
    // Carrying a toy: home to the basket, let go close by (it lobs in).
    const held = toy.holdingProp
    if (held) {
      const dd = carryTo(ctx, toy, basketX(team) + (team === 0 ? 1.6 : -1.6), 0, pace, 0.3)
      hopObstacles(ctx, toy)
      if (dd < 2.2 + sk.accuracy) toy.pad.grab = false
      // A rival right on top of us: try to shove them off first.
      const r = nearestRival(ctx, toy, 1.2)
      if (r && ctx.rng.chance(sk.aggression * 0.02)) bully(toy, r)
      return
    }
    // Jobs: a guard per team (when there are enough of us), pushers for the big toys, gatherers for the rest.
    if (!d.job || (d.until ?? 0) < t) {
      const { rank, n } = teamRank(ctx, toy, (o) => o.idx * 0.37 % 1)
      const loose = s.items.filter((b) => !parked(b) && !inBasket(0, b.translation()) && !inBasket(1, b.translation())).length
      const bigLeft = s.big.some((b) => !onMat(team, b.translation()))
      const stealK = loose < 4 ? 0.75 : 0.15 + sk.aggression * 0.1
      d.job = n >= 4 && rank === 0 ? 'guard' : bigLeft && ((n >= 3 && rank === 1) || (n <= 2 && rank === 0)) && ctx.rng.chance(0.7) ? 'push' : ctx.rng.chance(stealK) ? 'steal' : 'gather'
      d.until = t + ctx.rng.range(6, 10)
      d.item = undefined
      d.big = undefined
    }
    if (d.job === 'guard') {
      const thief = ctx.rivalsOf(toy).find((r) => Math.hypot(r.pos.x - basketX(team), r.pos.z) < 3.5)
      if (thief) {
        const dd = steerTo(toy, thief.pos.x, thief.pos.z, { stop: 0.2, pace })
        if (dd < 2.4 && toy.diveCd <= 0 && ctx.rng.chance(0.1)) toy.pad.dive = true
        else bully(toy, thief, 1.4)
        return
      }
      // Otherwise tidy what's lying near our basket.
      const near = pickItem(ctx, s, toy, 6, false)
      if (near >= 0) fetch(ctx, toy, s.items[near], pace)
      else steerTo(toy, basketX(team) + (team === 0 ? 2.2 : -2.2), Math.sin(t * 0.6 + toy.idx) * 1.5, { stop: 0.4, pace: pace * 0.6 })
      return
    }
    if (d.job === 'push') {
      // Get behind the nearest big toy that's not on our mat and walk it over.
      if (d.big === undefined) {
        let best = -1, bd = Infinity
        s.big.forEach((b, i) => {
          const p = b.translation()
          if (onMat(team, p)) return
          const dd = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z) + Math.abs(p.x - matX(team)) * 0.3
          if (dd < bd) {
            bd = dd
            best = i
          }
        })
        if (best < 0) d.job = 'gather'
        else d.big = best
      }
      const b = d.big !== undefined ? s.big[d.big] : null
      if (b) {
        const p = b.translation()
        if (onMat(team, p)) {
          d.big = undefined
          return
        }
        const gx = (team === 0 ? -LINE_X - 2.5 : LINE_X + 2.5) - p.x, gz = -p.z * 0.5
        const gl = Math.hypot(gx, gz) || 1
        const r = d.big === 2 ? 1.2 : 1.25
        const bx = p.x - (gx / gl) * r, bz = p.z - (gz / gl) * r
        const behind = Math.hypot(toy.pos.x - bx, toy.pos.z - bz)
        if (behind > 0.7) {
          // Walk round to the far side without bumping it the wrong way.
          const side = (toy.pos.x - p.x) * (gz / gl) - (toy.pos.z - p.z) * (gx / gl) > 0 ? 1 : -1
          const wx = behind > 1.8 ? bx + (-gz / gl) * side * 1.2 : bx, wz = behind > 1.8 ? bz + (gx / gl) * side * 1.2 : bz
          steerTo(toy, wx, wz, { stop: 0.2, pace })
        } else {
          toy.pad.mx = gx / gl
          toy.pad.mz = gz / gl
          if (toy.diveCd <= 0 && ctx.rng.chance(0.012)) toy.pad.dive = true
        }
        avoidWalls(ctx, toy)
        return
      }
    }
    // Gather (or steal from their basket).
    if (d.item === undefined || !s.items[d.item] || holderOf(ctx, s.items[d.item]) || parked(s.items[d.item]) || inBasket(team, s.items[d.item].translation())) {
      d.item = d.job === 'steal' && s.inBasket[them] > 0 && s.tipped[them] <= t ? pickFromBasket(ctx, s, them) : pickItem(ctx, s, toy, 99, true)
      if (d.item < 0) d.item = pickItem(ctx, s, toy, 99, true)
    }
    // Raiders tip a well-stocked basket over with a dive.
    const tb = Math.hypot(toy.pos.x - basketX(them), toy.pos.z)
    if (d.job === 'steal' && s.inBasket[them] >= 4 && s.tipped[them] <= t && tb < 3.2 && toy.diveCd <= 0 && ctx.rng.chance(0.05)) {
      toy.yaw = Math.atan2(basketX(them) - toy.pos.x, -toy.pos.z)
      toy.pad.mx = Math.sin(toy.yaw)
      toy.pad.mz = Math.cos(toy.yaw)
      toy.pad.dive = true
      return
    }
    if (d.item !== undefined && d.item >= 0) fetch(ctx, toy, s.items[d.item], pace)
    else if (d.job === 'steal') steerTo(toy, basketX(them) + (them === 0 ? 1.8 : -1.8), 0, { pace })
    else steerTo(toy, 0, Math.sin(toy.idx) * 4, { pace: pace * 0.6 })
    const r = nearestRival(ctx, toy, 1.3)
    if (r && r.holdingProp && ctx.rng.chance(sk.aggression * 0.06)) bully(toy, r, 1.3)
  },

  rank(ctx) {
    const lead = (ctx.teams[0]?.score ?? 0) >= (ctx.teams[1]?.score ?? 0) ? 0 : 1
    return ctx.active().sort((a, b) => (a.team === lead ? 0 : 1) - (b.team === lead ? 0 : 1))
  },

  pack(_c, s) {
    return [s.inBasket[0], s.inBasket[1], s.onMat[0], s.onMat[1], r2(s.tipped[0]), r2(s.tipped[1]), r2(s.hand.x), r2(s.hand.z), r2(s.hand.t0), s.hand.on, s.goldOut]
  },

  unpack(_c, s, d) {
    const a = d as number[]
    s.inBasket = [a[0], a[1]]
    s.onMat = [a[2], a[3]]
    s.tipped = [a[4], a[5]]
    s.hand.x = a[6]
    s.hand.z = a[7]
    s.hand.t0 = a[8]
    s.hand.on = a[9]
    s.goldOut = a[10]
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    // Tipped baskets lie on their side.
    for (const team of [0, 1]) {
      const m = v.baskets[team]
      const want = s.tipped[team] > t ? Math.PI / 2 : 0
      m.rotation.z = THREE.MathUtils.damp(m.rotation.z, want * (team === 0 ? -1 : 1), 8, dt)
      m.position.y = Math.abs(Math.sin(m.rotation.z)) * BR * 0.9
    }
    // The hand swoops down, opens, and lifts away.
    const ht = t - s.hand.t0
    v.hand.visible = s.hand.on > 0 && ht < 2.6
    if (v.hand.visible) {
      const down = ht < 1.1 ? THREE.MathUtils.smoothstep(ht, 0, 1.1) : 1 - THREE.MathUtils.smoothstep(ht, 1.4, 2.6)
      v.hand.position.set(s.hand.x, 12 - down * 9.6, s.hand.z - 0.6)
      v.hand.rotation.set(0.15 + (ht > 1.1 ? 0.25 : 0), 0, 0)
    }
    // A golden beam over any golden duck lying loose.
    let gold: RigidBody | null = null
    s.items.forEach((b, i) => {
      if (s.kinds[i] === 'gold' && !parked(b) && !inBasket(0, b.translation()) && !inBasket(1, b.translation())) gold = b
    })
    v.beam.visible = !!gold
    if (gold) {
      const p = (gold as RigidBody).translation()
      v.beam.position.set(p.x, p.y + 3.4, p.z)
      ;(v.beam.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.1 * Math.sin(t * 5)
    }
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const chips = [`${ctx.teams[0].name}: ${s.inBasket[0]} in, ${s.onMat[0]} big`, `${ctx.teams[1].name}: ${s.inBasket[1]} in, ${s.onMat[1]} big`]
    if (t < HAND_AT && ctx.phase === 'play') chips.push(`Toddler in ${Math.ceil(HAND_AT - t)} s`)
    let status: { text: string; color: string; pulse?: boolean } | undefined
    let prompt: string | undefined
    if (me && me.status === 'play') {
      const team = me.team === 1 ? 1 : 0
      if (s.tipped[team] > t) {
        status = { text: 'YOUR BASKET IS OVER!', color: '#ef4444', pulse: true }
        prompt = 'Run to your basket and press R to stand it up'
      } else if (me.holdingProp) prompt = 'Let go of E near your basket to lob it in'
      else prompt = 'Hold E to pick up toys · push the big ones over your line · dive into their basket to tip it'
    }
    if (s.hand.on && t - s.hand.t0 < 2.6) status = { text: 'TODDLER!', color: '#f472b6', pulse: true }
    return { chips, status, prompt }
  },
})

/** The best loose toy for a bot: value over distance (golden ducks first), not in a basket, not held. */
function pickItem(ctx: LevelCtx, s: TidyState, toy: Toy, range: number, avoidTheirs: boolean) {
  let best = -1, bs = -Infinity
  const crowd = new Map<number, number>()
  for (const o of ctx.teammatesOf(toy)) {
    const it = (o.data as { item?: number }).item
    if (it !== undefined) crowd.set(it, (crowd.get(it) ?? 0) + 1)
  }
  s.items.forEach((b, i) => {
    if (parked(b) || holderOf(ctx, b)) return
    const p = b.translation()
    if (inBasket(toy.team, p) || (avoidTheirs && inBasket(1 - toy.team, p))) return
    const dd = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z)
    if (dd > range) return
    const home = Math.hypot(p.x - basketX(toy.team), p.z)
    const score = valueOf(s.kinds[i]) * 6 - dd - home * 0.35 - (crowd.get(i) ?? 0) * 5
    if (score > bs) {
      bs = score
      best = i
    }
  })
  return best
}

function pickFromBasket(ctx: LevelCtx, s: TidyState, team: number) {
  let best = -1
  s.items.forEach((b, i) => {
    if (best < 0 && !holderOf(ctx, b) && inBasket(team, b.translation())) best = i
  })
  return best
}

/** Knock a basket over: it spills everything and stops counting until a teammate stands it up. */
function tipBasket(ctx: LevelCtx, s: TidyState, team: number, by: Toy) {
  if (s.tipped[team] > ctx.time) return
  s.tipped[team] = ctx.time + 8
  const bx = basketX(team)
  for (const b of s.items) {
    const p = b.translation()
    if (!inBasket(team, p) || holderOf(ctx, b)) continue
    const a = ctx.rng.range(-1.2, 1.2) + (team === 0 ? 0 : Math.PI)
    b.setTranslation({ x: p.x, y: Math.max(p.y, 0.6), z: p.z }, true)
    b.setLinvel({ x: Math.cos(a) * ctx.rng.range(3, 6), y: ctx.rng.range(3, 5), z: Math.sin(a) * ctx.rng.range(3, 6) }, true)
  }
  ctx.fx.say(`${poss(ctx.teams[team].name).toUpperCase()} BASKET IS OVER!`, ctx.teams[1 - team].color, 1.8)
  ctx.fx.sfx('slam', { x: bx, y: 0.5, z: 0 })
  ctx.fx.puff({ x: bx, y: 0.6, z: 0 }, 'dust', 16)
  ctx.fx.shake(0.3)
  ctx.fx.feed(`${by.name} tipped over the ${ctx.teams[team].name} basket`)
  for (const v of ctx.teamToys(team)) ctx.blame(v, by)
}
