// The Loft: a cosy attic at toy scale where everyone waits between Shows. Floorboards, a slanted roof with
// rafters, a round window with warm god-rays, string lights, and props: the toy chest in the middle (jump in
// to start a Show), a rocking horse, boxes, an armchair and the sewing station (dress-up spot). The four
// themed corners from the design are simple stand-ins for now: Disco Closet, Houseplant Jungle, Bathtub Beach
// and Cardboard Arcade.
import * as THREE from 'three'
import { prop, propSize } from '../engine/assets'
import { avoidWalls, hopObstacles, steerTo } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { PROP_GROUPS } from '../engine/physics'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'

/** Corners and spots toys wander between. Exported so other agents can hang hidden games off them. */
export const LOFT_ZONES = {
  disco: { name: 'Disco Closet', x: -12.5, z: -12.5, r: 5 },
  jungle: { name: 'Houseplant Jungle', x: 12.5, z: -12.5, r: 5 },
  beach: { name: 'Bathtub Beach', x: 12.5, z: 12.5, r: 5 },
  arcade: { name: 'Cardboard Arcade', x: -12.5, z: 12.5, r: 5 },
  sewing: { name: 'Sewing Table', x: 8, z: 3, r: 3 },
  chest: { name: 'Toy Chest', x: 0, z: 0, r: 4.5 },
} as const
export type LoftZone = keyof typeof LOFT_ZONES

const HW = 18
const _col = new THREE.Color()
const HD = 18
// The toy chest: footprint and wall height of its box (the lid stands open behind it).
const CHEST = { x: 0, z: 0, hw: 1.7, hd: 1.25, wall: 1.45 }

interface LoftState {
  /** Animated bits (all screens). */
  horse: THREE.Object3D | null
  ball: THREE.Object3D | null
  tiles: THREE.InstancedMesh | null
  topSpin: THREE.Object3D | null
  /** Seconds since a toy was popped out of the chest (host). */
  pop: Map<Toy, number>
  /** Toy that already triggered the chest (debounce). */
  fired: Set<Toy>
  t: number
}

function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra })
}

function placeProp(ctx: LevelCtx, obj: THREE.Object3D, x: number, z: number, rotY = 0) {
  obj.position.set(x, 0, z)
  obj.rotation.y = rotY
  ctx.root.add(obj)
  return obj
}

/** A box collider matching a placed prop's bounds (optionally shrunk). */
function solid(ctx: LevelCtx, obj: THREE.Object3D, shrink = 0.85, maxH = 99) {
  obj.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(obj)
  const s = b.getSize(new THREE.Vector3())
  const c = b.getCenter(new THREE.Vector3())
  const h = Math.min(s.y, maxH)
  ctx.phys.box({ x: c.x, y: h / 2, z: c.z }, { x: (s.x * shrink) / 2, y: h / 2, z: (s.z * shrink) / 2 })
}

function sign(ctx: LevelCtx, text: string, x: number, z: number, y = 4.2) {
  const s = textSprite(text, { bg: '#7c2d12', size: 0.6 })
  s.position.set(x, y, z)
  ctx.root.add(s)
}

function buildCorners(ctx: LevelCtx, st: LoftState) {
  // Disco Closet: a wardrobe with its doors open, a foil mirror ball and a light-up floor.
  const d = LOFT_ZONES.disco
  const wardrobe = new THREE.Group()
  const wood = mat('#5b3a29')
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 0.4), wood)
  body.position.set(0, 4, -2.6)
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 3), wood)
  sideL.position.set(-3, 4, -1.2)
  const sideR = sideL.clone()
  sideR.position.x = 3
  const top = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.4, 3.4), wood)
  top.position.set(0, 8, -1.2)
  const doorL = new THREE.Mesh(new THREE.BoxGeometry(3, 7.6, 0.25), mat('#7b4a33'))
  doorL.position.set(-4.3, 3.9, 0.4)
  doorL.rotation.y = 0.9
  const doorR = doorL.clone()
  doorR.position.x = 4.3
  doorR.rotation.y = -0.9
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.6, 6).rotateZ(Math.PI / 2), mat('#d1d5db', { metalness: 0.8, roughness: 0.3 }))
  rail.position.set(0, 6.6, -1.4)
  wardrobe.add(body, sideL, sideR, top, doorL, doorR, rail)
  wardrobe.position.set(d.x, 0, d.z)
  wardrobe.rotation.y = Math.PI / 4
  wardrobe.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  ctx.root.add(wardrobe)
  wardrobe.updateMatrixWorld(true)
  ctx.phys.box({ x: d.x - 1.8, y: 4, z: d.z - 1.8 }, { x: 3, y: 4, z: 0.4 }, { rotY: Math.PI / 4 })
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), mat('#e5e7eb', { metalness: 1, roughness: 0.15 }))
  ball.position.set(d.x + 1.5, 6.2, d.z + 1.5)
  ctx.root.add(ball)
  st.ball = ball
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.08, 1.1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.35 }), 25)
  const m = new THREE.Matrix4()
  for (let i = 0; i < 25; i++) {
    const x = (i % 5) - 2, z = Math.floor(i / 5) - 2
    tiles.setMatrixAt(i, m.makeTranslation(d.x + 2 + x * 1.15, 0.04, d.z + 2 + z * 1.15))
    tiles.setColorAt(i, new THREE.Color().setHSL(((x + z + 10) % 5) / 5, 0.8, 0.55))
  }
  tiles.receiveShadow = true
  ctx.root.add(tiles)
  st.tiles = tiles
  sign(ctx, 'Disco Closet', d.x + 1.5, d.z + 1.5, 8.6)

  // Houseplant Jungle: pots with big leaves and a watering can.
  const j = LOFT_ZONES.jungle
  const potMat = mat('#c2410c')
  const leaf = mat('#3f9b4f')
  const leaf2 = mat('#2f7d3f')
  for (const [px, pz, s] of [[0, 0, 1.3], [-2.6, 1.4, 1], [1.6, -2.4, 0.85], [2.8, 1.8, 0.7]] as const) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * s, 0.8 * s, 1.6 * s, 10), potMat)
    pot.position.set(j.x + px, 0.8 * s, j.z + pz)
    pot.castShadow = true
    ctx.root.add(pot)
    ctx.phys.cylinder({ x: j.x + px, y: 0.8 * s, z: j.z + pz }, 0.8 * s, 1.05 * s)
    for (let k = 0; k < 6; k++) {
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 3.2 * s, 5), k % 2 ? leaf : leaf2)
      const a = (k / 6) * Math.PI * 2
      l.position.set(j.x + px + Math.sin(a) * 0.5 * s, 2.6 * s + (k % 3) * 0.4, j.z + pz + Math.cos(a) * 0.5 * s)
      l.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6)
      l.castShadow = true
      ctx.root.add(l)
    }
  }
  const can = new THREE.Group()
  const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.3, 12), mat('#60a5fa', { metalness: 0.4, roughness: 0.4 }))
  canBody.position.y = 0.65
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.6, 8), canBody.material)
  spout.position.set(0.9, 1.1, 0)
  spout.rotation.z = -0.9
  can.add(canBody, spout)
  can.position.set(j.x - 2.5, 0, j.z - 2)
  ctx.root.add(can)
  sign(ctx, 'Houseplant Jungle', j.x, j.z, 6)

  // Bathtub Beach: a tub with water, a rubber duck lifeguard and a towel.
  const b = LOFT_ZONES.beach
  const tub = new THREE.Group()
  const enamel = mat('#f8fafc', { roughness: 0.3 })
  const tubShape = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 3.4), enamel)
  tubShape.position.y = 1.5
  const water = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.2, 2.8), new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.1, transparent: true, opacity: 0.85 }))
  water.position.y = 2.55
  tub.add(tubShape, water)
  for (const fx of [-2.6, 2.6]) for (const fz of [-1.3, 1.3]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat('#d4a017', { metalness: 0.7, roughness: 0.3 }))
    foot.position.set(fx, 0.3, fz)
    tub.add(foot)
  }
  tub.position.set(b.x + 1, 0, b.z + 1)
  tub.rotation.y = -Math.PI / 4
  tub.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  ctx.root.add(tub)
  ctx.phys.box({ x: b.x + 1, y: 1.3, z: b.z + 1 }, { x: 3, y: 1.3, z: 1.7 }, { rotY: -Math.PI / 4 })
  const duck = new THREE.Group()
  const yellow = mat('#facc15')
  const dbody = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), yellow)
  dbody.scale.set(1.2, 0.9, 1)
  const dhead = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), yellow)
  dhead.position.set(0.55, 0.65, 0)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 6).rotateZ(-Math.PI / 2), mat('#f97316'))
  beak.position.set(1, 0.6, 0)
  duck.add(dbody, dhead, beak)
  duck.position.set(b.x - 2.5, 0.55, b.z - 1.5)
  duck.rotation.y = 2.4
  ctx.root.add(duck)
  const towel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.12, 2.2), mat('#fb7185'))
  towel.position.set(b.x - 1, 0.06, b.z - 3.5)
  towel.rotation.y = 0.3
  towel.receiveShadow = true
  ctx.root.add(towel)
  sign(ctx, 'Bathtub Beach', b.x, b.z, 5)

  // Cardboard Arcade: box cabinets with glowing screens and a claw machine.
  const a = LOFT_ZONES.arcade
  const card = mat('#c8a26b')
  const screens = ['#22d3ee', '#f472b6', '#a3e635']
  for (let k = 0; k < 3; k++) {
    const cab = new THREE.Group()
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 3.6, 1.6), card)
    box.position.y = 1.8
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1), new THREE.MeshBasicMaterial({ color: screens[k], toneMapped: false }))
    scr.position.set(0, 2.6, 0.81)
    cab.add(box, scr)
    cab.position.set(a.x - 2.5 + k * 2.1, 0, a.z - 2.2)
    cab.rotation.y = 0
    cab.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    ctx.root.add(cab)
    ctx.phys.box({ x: a.x - 2.5 + k * 2.1, y: 1.8, z: a.z - 2.2 }, { x: 0.9, y: 1.8, z: 0.8 })
  }
  const claw = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.4), card)
  base.position.y = 0.8
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.4, 2.3), new THREE.MeshStandardMaterial({ color: '#bfdbfe', transparent: true, opacity: 0.25, roughness: 0.1 }))
  glass.position.y = 2.8
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.4, 2.5), mat('#ef4444'))
  roof.position.y = 4.2
  claw.add(base, glass, roof)
  claw.position.set(a.x + 2.2, 0, a.z + 1.8)
  ctx.root.add(claw)
  ctx.phys.box({ x: a.x + 2.2, y: 2.2, z: a.z + 1.8 }, { x: 1.2, y: 2.2, z: 1.2 })
  sign(ctx, 'Cardboard Arcade', a.x, a.z, 6)
}

export default defineLevel<LoftState>({
  id: 'loft',
  name: 'The Loft',
  type: 'hub',
  blurb: 'A cosy attic where the toys wait between Shows.',
  howTo: ['Walk with WASD, look with the mouse', 'Jump into the toy chest to start a Show', 'Visit the sewing table to change your look', '1 2 3: wave, dance, stomp'],
  accent: '#f59e0b',
  players: [1, 16],
  duration: 99999,
  camera: { kind: 'chase' },

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: HW, hd: HD, ridge: 20, knee: 4, lights: ctx.quality === 'low' ? 40 : 80, quality: ctx.quality })

    // The toy chest in the middle, with alphabet-block steps up to its rim.
    const chest = prop(ctx.assets, 'chest', 3.4, 'width')
    placeProp(ctx, chest, CHEST.x, CHEST.z + 0.2)
    const cw = CHEST.hw, cd = CHEST.hd, wall = CHEST.wall, t = 0.18
    ctx.phys.box({ x: CHEST.x, y: wall / 2, z: CHEST.z - cd }, { x: cw, y: wall / 2, z: t })
    ctx.phys.box({ x: CHEST.x, y: wall / 2, z: CHEST.z + cd }, { x: cw, y: wall / 2, z: t })
    ctx.phys.box({ x: CHEST.x - cw, y: wall / 2, z: CHEST.z }, { x: t, y: wall / 2, z: cd })
    ctx.phys.box({ x: CHEST.x + cw, y: wall / 2, z: CHEST.z }, { x: t, y: wall / 2, z: cd })
    ctx.phys.box({ x: CHEST.x, y: 0.2, z: CHEST.z }, { x: cw, y: 0.2, z: cd })
    // The open lid behind the chest.
    ctx.phys.box({ x: CHEST.x, y: 2.3, z: CHEST.z - cd - 0.4 }, { x: cw, y: 1.1, z: 0.2 })
    const blockColors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
    const steps: [number, number, number][] = [[-0.5, 3.0, 0.7], [0.6, 2.6, 0.7], [0.0, 1.9, 1.4]]
    steps.forEach(([x, z, h], i) => {
      const blk = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.1), mat(blockColors[i % blockColors.length]))
      blk.position.set(CHEST.x + x, h / 2, CHEST.z + z)
      blk.castShadow = blk.receiveShadow = true
      ctx.root.add(blk)
      ctx.phys.box({ x: CHEST.x + x, y: h / 2, z: CHEST.z + z }, { x: 0.55, y: h / 2, z: 0.55 })
      const letter = textSprite('ABC'[i], { color: '#ffffff', size: 0.6 })
      letter.position.set(CHEST.x + x, h + 0.35, CHEST.z + z)
      ctx.root.add(letter)
    })
    const chestSign = textSprite('Jump in to play!', { bg: '#1d4ed8', size: 0.7 })
    chestSign.position.set(CHEST.x, 4.4, CHEST.z)
    ctx.root.add(chestSign)

    const horse = prop(ctx.assets, 'horse', 3.6)
    placeProp(ctx, horse, -8, 7, 0.5)
    solid(ctx, horse, 0.6, 2.2)
    const boxes = prop(ctx.assets, 'boxes', 5.5)
    placeProp(ctx, boxes, 13.5, -3, -0.3)
    solid(ctx, boxes, 0.9)
    const chair = prop(ctx.assets, 'armchair', 6.5)
    placeProp(ctx, chair, -11, -2, 1.2)
    solid(ctx, chair, 0.8, 2.6)
    const sewing = prop(ctx.assets, 'sewing', 3, 'width')
    placeProp(ctx, sewing, LOFT_ZONES.sewing.x, LOFT_ZONES.sewing.z)
    const ss = propSize(sewing)
    ctx.phys.cylinder({ x: LOFT_ZONES.sewing.x, y: ss.y / 2, z: LOFT_ZONES.sewing.z }, ss.y / 2, Math.min(ss.x, ss.z) * 0.42)
    sign(ctx, 'Sewing Table', LOFT_ZONES.sewing.x, LOFT_ZONES.sewing.z, ss.y + 1.4)
    const tin = prop(ctx.assets, 'tin', 2.6, 'width')
    placeProp(ctx, tin, 4.5, -9)
    solid(ctx, tin, 0.85)
    const top = prop(ctx.assets, 'top', 1.8)
    placeProp(ctx, top, -4, -8)

    // Loose toys to pick up (E) and throw: alphabet blocks and a beach ball.
    const looseCols = ['#f97316', '#22c55e', '#3b82f6', '#e11d48']
    for (let i = 0; i < 5; i++) {
      const a = 0.8 + i * 1.25
      const x = Math.sin(a) * 8.5, z = Math.cos(a) * 8.5
      const ball = i === 4
      const body = ctx.phys.dynamic({ x, y: 1 + i * 0.1, z }, { damping: 0.4 })
      ctx.phys.attach(body, ball ? ctx.RAPIER.ColliderDesc.ball(0.45).setDensity(0.3) : ctx.RAPIER.ColliderDesc.cuboid(0.35, 0.35, 0.35).setDensity(0.4), { friction: 0.7, restitution: ball ? 0.75 : 0.2, groups: PROP_GROUPS })
      const mesh = ball
        ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 2), mat('#f43f5e', { roughness: 0.35 }))
        : new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(looseCols[i % looseCols.length]))
      mesh.castShadow = true
      ctx.root.add(mesh)
      ctx.grabbable(body, mesh)
    }

    // A rug under the chest.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(6.5, 40).rotateX(-Math.PI / 2), mat('#9f1239', { roughness: 1 }))
    rug.position.y = 0.01
    rug.receiveShadow = true
    ctx.root.add(rug)
    const rugRing = new THREE.Mesh(new THREE.RingGeometry(5.6, 5.9, 48).rotateX(-Math.PI / 2), mat('#fde68a', { roughness: 1 }))
    rugRing.position.y = 0.02
    ctx.root.add(rugRing)
  },

  init(ctx) {
    const st: LoftState = { horse: null, ball: null, tiles: null, topSpin: null, pop: new Map(), fired: new Set(), t: 0 }
    ctx.root.traverse((o) => {
      if (o.name === 'prop:horse') {
        st.horse = o
        // Rock about the horse's own axis, after its turn.
        o.rotation.order = 'YXZ'
      }
      if (o.name === 'prop:top') st.topSpin = o
    })
    buildCorners(ctx, st)
    return st
  },

  spawn(ctx, _s, toy, i, n) {
    // People near the chest, bots spread round the room.
    if (toy.c.human) return ctx.spawnRing(Math.max(1, n), { x: 0, z: 0, radius: 5, faceIn: true })[i]
    const spots = Object.values(LOFT_ZONES).filter((z) => z.r >= 5)
    const z = spots[i % spots.length]
    return { x: z.x * 0.75 + (i % 3) - 1, y: 0, z: z.z * 0.75 + ((i * 7) % 3) - 1, yaw: i }
  },

  tick(ctx, st, dt) {
    st.t += dt
    // Toy chest: you jump in, the Show starts. Anyone else is bounced back out.
    for (const toy of ctx.toys) {
      const inside = Math.abs(toy.pos.x - CHEST.x) < CHEST.hw - 0.2 && Math.abs(toy.pos.z - CHEST.z) < CHEST.hd - 0.2 && toy.feet < CHEST.wall - 0.1
      if (!inside) {
        st.fired.delete(toy)
        continue
      }
      if (st.fired.has(toy)) continue
      st.fired.add(toy)
      ctx.fx.confetti(toy.pos)
      ctx.fx.sfx('boing', toy.pos)
      if (toy === ctx.me) ctx.signal('chest', toy)
      else {
        ctx.knock(toy, { x: 0, y: 9, z: 4 }, 0.3)
        if (toy.c.human) ctx.fx.popup(toy, 'Ready! The host starts the Show', '#93c5fd')
      }
    }
  },

  bot(ctx, st, toy) {
    // Wander between the corners, stop to emote, sometimes boop a neighbour.
    const d = toy.data as { goal?: [number, number]; wait?: number; next?: number }
    if (d.wait && d.wait > st.t) return
    if (!d.goal || Math.hypot(toy.pos.x - d.goal[0], toy.pos.z - d.goal[1]) < 1.2) {
      if (d.goal) {
        d.wait = st.t + ctx.rng.range(2, 7)
        toy.pad.emote = ctx.rng.pick(['wave', 'dance', 'stomp', 'dance'] as const)
      }
      const spots = Object.values(LOFT_ZONES).filter((z) => z !== LOFT_ZONES.chest)
      const z = ctx.rng.pick(spots)
      d.goal = [z.x + ctx.rng.range(-2.5, 2.5), z.z + ctx.rng.range(-2.5, 2.5)]
      return
    }
    steerTo(toy, d.goal[0], d.goal[1], { pace: 0.55 })
    // Never into the chest.
    const cx = toy.pos.x - CHEST.x, cz = toy.pos.z - CHEST.z
    if (Math.hypot(cx, cz) < 3.4) {
      toy.pad.mx += cx * 0.4
      toy.pad.mz += cz * 0.4
    }
    avoidWalls(ctx, toy)
    hopObstacles(ctx, toy)
  },

  visual(ctx, st, dt) {
    st.t += ctx.isHost ? 0 : dt
    const t = ctx.time
    if (st.horse) st.horse.rotation.x = Math.sin(t * 1.6) * 0.12
    if (st.ball) st.ball.rotation.y += dt * 0.8
    if (st.topSpin) st.topSpin.rotation.y += dt * 9
    if (st.tiles) {
      const c = _col
      const beat = Math.floor(t * 2)
      if (st.tiles.userData.beat !== beat) {
        st.tiles.userData.beat = beat
        for (let i = 0; i < 25; i++) st.tiles.setColorAt(i, c.setHSL(((i * 7 + beat) % 10) / 10, 0.85, 0.55))
        if (st.tiles.instanceColor) st.tiles.instanceColor.needsUpdate = true
      }
    }
    // Which corner am I in? The page shows a prompt (and the sewing table opens the wardrobe).
    const me = ctx.me
    if (me) {
      let zone = ''
      for (const [id, z] of Object.entries(LOFT_ZONES)) if (Math.hypot(me.pos.x - z.x, me.pos.z - z.z) < z.r) zone = id
      ctx.signal(`zone:${zone}`, me)
    }
  },
})
