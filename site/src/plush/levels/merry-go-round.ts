// Merry-Go-Round Huddle (final). Everyone rides a toy carousel while the music plays. When it stops, a number
// is shown: race into the little playhouses round the carousel in groups of exactly that many. A room locks the
// moment it is full; anyone left outside, or in a room that isn't full when time runs out, is out. Doors can
// be held shut by grabbing them (E), to choose who gets in. Fewer rooms open every spin until one toy is left.
// Dirty tricks: slam a door in a rival's face, make a rival dizzy, or flash them the wrong number.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { avoidWalls, skill, steerTo } from '../engine/bots'
import { ceremony, ceremonyCamera, crownCeremony, type Ceremony } from '../engine/finale'
import { buildAttic } from '../engine/helpers'
import { canvasTex, roundRect } from '../engine/paint'
import type { Collider } from '../engine/physics'
import { makeRng } from '../engine/rng'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx } from '../engine/types'

const ROOMS = 6
const R_ROOM = 13.5
const HS = 1.9 // room interior half size
const WALL_T = 0.25
const WALL_H = 2.6
const DOOR_W = 1.8
const CAR_R = 5.6
const CAR_Y = 0.5
const HORSES = 4

const RIDE = 0, RUSH = 1, RETURN = 2
type Ph = 0 | 1 | 2

interface MGState {
  ph: Ph
  pt: number
  dur: number
  spin: number
  /** Carousel angle (synced) and the group size this spin. */
  ang: number
  n: number
  /** Bitmasks: rooms open this spin, boarded up for good, locked (full), held shut by someone. */
  open: number
  boarded: number
  locked: number
  held: number
  /** Door slammed (by the trick) until this time, per room. */
  slam: number[]
  /** Toys inside each room. */
  count: number[]
  dizzy: number[]
  misses: number[]
  // Host only.
  avail: number
  // Visuals.
  vis: {
    car: THREE.Group | null
    horses: THREE.Object3D[]
    fence: THREE.Group | null
    doors: THREE.Mesh[]
    doorX: number[]
    lamps: THREE.MeshBasicMaterial[]
    planks: THREE.Object3D[]
    plates: { sprite: THREE.Sprite; tex: THREE.CanvasTexture; key: string }[]
    numSign: { sprite: THREE.Sprite; tex: THREE.CanvasTexture; key: string } | null
    fibT: number
    fibN: number
    lastPh: number
    cer: Ceremony
  }
}

/* ---------------- Geometry helpers ---------------- */

function roomFrame(k: number) {
  const a = (k / ROOMS) * Math.PI * 2 + Math.PI / ROOMS
  const cx = Math.sin(a) * R_ROOM, cz = Math.cos(a) * R_ROOM
  // Forward (local +z) points from the room towards the carousel; right is local +x.
  const fx = -Math.sin(a), fz = -Math.cos(a)
  const rotY = Math.atan2(fx, fz)
  return { cx, cz, fx, fz, rx: fz, rz: -fx, rotY }
}

/** A point in a room's local frame → world. */
function roomPoint(k: number, lx: number, lz: number) {
  const f = roomFrame(k)
  return { x: f.cx + f.rx * lx + f.fx * lz, z: f.cz + f.rz * lx + f.fz * lz }
}

/** Which room (interior) a point is in, or -1. */
function roomOf(x: number, z: number) {
  for (let k = 0; k < ROOMS; k++) {
    const f = roomFrame(k)
    const dx = x - f.cx, dz = z - f.cz
    const lx = dx * f.rx + dz * f.rz, lz = dx * f.fx + dz * f.fz
    if (Math.abs(lx) < HS - 0.1 && lz > -HS + 0.1 && lz < HS - 0.05) return k
  }
  return -1
}

/** Distance from a point to a room's doorway (just outside it). */
function doorDist(k: number, x: number, z: number) {
  const p = roomPoint(k, 0, HS + 0.5)
  return Math.hypot(x - p.x, z - p.z)
}

function omega(st: MGState, t: number, playing: boolean) {
  if (!playing) return 0
  const el = t - st.pt
  if (st.ph === RIDE) return Math.min(0.85, el * 0.5) * (st.spin % 2 ? -1 : 1)
  if (st.ph === RUSH) return Math.max(0, 0.85 - el * 1.1) * (st.spin % 2 ? -1 : 1)
  return 0
}

function doorShut(st: MGState, k: number, t: number) {
  const bit = 1 << k
  return st.ph !== RUSH || !(st.open & bit) || !!(st.boarded & bit) || !!(st.locked & bit) || !!(st.held & bit) || st.slam[k] > t
}

function setPh(ctx: LevelCtx, st: MGState, ph: Ph, dur: number) {
  st.ph = ph
  st.pt = ctx.time
  st.dur = dur
}

/** Pick the group size and how many rooms open: at least one toy must be left over. */
function deal(ctx: LevelCtx, st: MGState) {
  const alive = ctx.active().length
  const usable = [...Array(ROOMS).keys()].filter((k) => !(st.boarded & (1 << k)))
  const cands: { n: number; r: number; s: number }[] = []
  for (let n = 1; n < alive; n++) {
    const r = Math.min(usable.length, st.avail, Math.floor((alive - 1) / n))
    if (r >= 1) cands.push({ n, r, s: r * n })
  }
  if (!cands.length) cands.push({ n: 1, r: 1, s: 1 })
  cands.sort((a, b) => b.s - a.s || a.n - b.n)
  const pick = ctx.rng.pick(cands.slice(0, Math.min(3, cands.length)))
  st.n = pick.n
  st.open = 0
  for (const k of ctx.rng.shuffle(usable.slice()).slice(0, pick.r)) st.open |= 1 << k
  st.locked = 0
  st.held = 0
  st.slam.fill(0)
}

/* ---------------- Painting ---------------- */

function stripes(a: string, b: string, n: number, scallop = false) {
  return canvasTex(512, 128, (g, w, h) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? a : b
      g.fillRect((i * w) / n, 0, w / n + 1, h)
    }
    if (scallop) {
      g.globalCompositeOperation = 'destination-out'
      for (let i = 0; i < n; i++) {
        g.beginPath()
        g.arc(((i + 0.5) * w) / n, h + 8, w / n / 2, 0, Math.PI * 2)
        g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    }
    g.fillStyle = 'rgba(253,224,71,0.9)'
    g.fillRect(0, 0, w, 10)
  })
}

function wallpaper(col: string) {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = col
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = 'rgba(255,255,255,0.45)'
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        g.beginPath()
        g.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, 5, 0, Math.PI * 2)
        g.fill()
      }
  }, { repeat: [2, 1] })
}

function paintPlate(p: { tex: THREE.CanvasTexture }, text: string, bg: string) {
  const c = p.tex.image as HTMLCanvasElement
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = bg
  roundRect(g, 6, 6, c.width - 12, c.height - 12, 22)
  g.fill()
  g.strokeStyle = 'rgba(255,255,255,0.8)'
  g.lineWidth = 5
  roundRect(g, 12, 12, c.width - 24, c.height - 24, 16)
  g.stroke()
  g.fillStyle = '#fff'
  g.font = `900 ${Math.round(c.height * 0.55)}px ui-rounded, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, c.width / 2, c.height / 2 + 4)
  p.tex.needsUpdate = true
}

const _v = new THREE.Vector3()
const _q = new THREE.Quaternion()

/* ---------------- Level ---------------- */

export default defineLevel<MGState>({
  id: 'merry-go-round',
  name: 'Merry-Go-Round Huddle',
  type: 'final',
  blurb: 'Ride the carousel, then race into a room with exactly the number shown. Odd toys out are out.',
  howTo: [
    'Ride the carousel while the music plays',
    'When it stops, a number shows: get into a room in a group of exactly that many',
    'Rooms lock when full. Anyone outside, or in a room that is not full, is out',
    'Hold a door shut by grabbing it (E) to choose who gets in. Fewer rooms each spin',
  ],
  accent: '#f472b6',
  players: [2, 8],
  duration: 150,
  camera: { kind: 'chase', dist: 8.5, height: 1.5 },
  introOrbit: { radius: 17, height: 9 },
  sprinkles: { start: 1 },
  sky: { color: '#27190f', fogNear: 45, fogFar: 130 },

  tricks: [
    {
      id: 'slam',
      name: 'Slam Door',
      icon: 'slam',
      cost: 2,
      cooldown: 8,
      busy: 0.6,
      target: 'rival',
      desc: 'The nearest door slams in their face for 2 seconds and bumps them back.',
      counter: 'Aim for a room with more than one door free, and keep moving.',
      can: (ctx, s, _u, target) => {
        if (s.ph !== RUSH) return 'Only during the rush'
        if (!target) return 'Pick a rival'
        let best = 99
        for (let k = 0; k < ROOMS; k++) if (s.open & (1 << k) && !(s.locked & (1 << k))) best = Math.min(best, doorDist(k, target.pos.x, target.pos.z))
        return best < 3.5 || ctx.phase !== 'play' ? true : 'They are not near a door'
      },
      apply: (ctx, s, user, target) => {
        if (!target) return
        let room = -1, bd = 99
        for (let k = 0; k < ROOMS; k++) {
          const d = doorDist(k, target.pos.x, target.pos.z)
          if (d < bd) {
            bd = d
            room = k
          }
        }
        if (room < 0) return
        s.slam[room] = ctx.time + 2
        const f = roomFrame(room)
        if (roomOf(target.pos.x, target.pos.z) !== room) ctx.knock(target, { x: f.fx * 5, y: 3, z: f.fz * 5 }, 0.5, user)
        ctx.fx.sfx('slam', target.pos)
        ctx.fx.shake(0.3, target)
        ctx.fx.popup(target, 'SLAM!', '#fca5a5')
      },
      botUse: (ctx, s, user) => {
        if (s.ph !== RUSH) return false
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play' || roomOf(t.pos.x, t.pos.z) >= 0) continue
          for (let k = 0; k < ROOMS; k++) if (s.open & (1 << k) && !(s.locked & (1 << k)) && doorDist(k, t.pos.x, t.pos.z) < 2.5) return t
        }
        return false
      },
    },
    {
      id: 'dizzy',
      name: 'Dizzy Spin',
      icon: 'swap',
      cost: 2,
      cooldown: 10,
      busy: 0.5,
      target: 'rival',
      desc: 'Spins them round: for 3 seconds they walk in wobbly curves.',
      counter: 'Aim a little wide of where you want to go, or wait a moment.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.dizzy[target.idx] = ctx.time + 3
        ctx.fx.popup(target, 'Dizzy!', '#c4b5fd')
        ctx.fx.sfx('whoosh', target.pos)
      },
      botUse: (ctx, s, user) => {
        if (!(s.ph === RIDE && s.dur - (ctx.time - s.pt) < 2.5) && !(s.ph === RUSH && ctx.time - s.pt < 1.5)) return false
        return ctx.leader(user) ?? false
      },
    },
    {
      id: 'fib',
      name: 'Fib Number',
      icon: 'crack',
      cost: 1,
      cooldown: 9,
      busy: 0.5,
      target: 'rival',
      desc: 'Flashes the wrong group size on their screen for 2 seconds.',
      counter: 'Count the toys going into each room. The room plates show the real number.',
      can: (_c, s) => (s.ph === RUSH || s.ph === RIDE ? true : 'Wait for the next spin'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const alive = ctx.active().length
        let wrong = ctx.rng.int(1, Math.max(2, alive))
        if (wrong === s.n) wrong = s.n + 1
        ctx.emit({ fib: wrong }, target)
        if (target.bot && ctx.rng.chance(0.6 - ctx.difficulty * 0.18)) target.data.fib = [wrong, ctx.time + 2]
      },
    },
    bubbleWrap<MGState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 20, hd: 20, ridge: 24, knee: 6, lights: ctx.quality === 'low' ? 30 : 60, quality: ctx.quality })
    // A round rug the carousel stands on.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(9, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 1 }))
    rug.position.y = 0.01
    ctx.root.add(rug)
    // Carousel base: a fixed drum the toys stand on (the ride itself turns them, see init()).
    ctx.phys.cylinder({ x: 0, y: CAR_Y / 2, z: 0 }, CAR_Y / 2, CAR_R, { friction: 0.9 })
    // The centre pole is solid.
    ctx.phys.cylinder({ x: 0, y: 3, z: 0 }, 3, 0.45)
    // The playhouses.
    const palette = ['#f87171', '#60a5fa', '#facc15', '#4ade80', '#a78bfa', '#fb923c']
    const roofCols = ['#b91c1c', '#1d4ed8', '#ca8a04', '#15803d', '#7e22ce', '#c2410c']
    for (let k = 0; k < ROOMS; k++) {
      const f = roomFrame(k)
      const g = new THREE.Group()
      g.position.set(f.cx, 0, f.cz)
      g.rotation.y = f.rotY
      ctx.root.add(g)
      const wallMat = new THREE.MeshStandardMaterial({ map: wallpaper(palette[k]), roughness: 0.8 })
      const side = (w: number, lx: number, lz: number, rot: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, WALL_T), wallMat)
        m.position.set(lx, WALL_H / 2, lz)
        m.rotation.y = rot
        m.castShadow = m.receiveShadow = true
        g.add(m)
        const p = roomPoint(k, lx, lz)
        const hx = rot ? WALL_T / 2 : w / 2, hz = rot ? w / 2 : WALL_T / 2
        ctx.phys.box({ x: p.x, y: WALL_H / 2, z: p.z }, { x: hx, y: WALL_H / 2 + 0.6, z: hz }, { rotY: f.rotY })
      }
      const full = HS * 2 + WALL_T * 2
      side(full, 0, -HS - WALL_T / 2, 0)
      side(full, -HS - WALL_T / 2, 0, Math.PI / 2)
      side(full, HS + WALL_T / 2, 0, Math.PI / 2)
      const seg = (full - DOOR_W) / 2
      side(seg, -(DOOR_W / 2 + seg / 2), HS + WALL_T / 2, 0)
      side(seg, DOOR_W / 2 + seg / 2, HS + WALL_T / 2, 0)
      // Lintel over the door and a pointy roof.
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, 0.5, WALL_T), wallMat)
      lintel.position.set(0, WALL_H - 0.25, HS + WALL_T / 2)
      g.add(lintel)
      const roof = new THREE.Mesh(new THREE.ConeGeometry(HS * 1.75, 2, 4), new THREE.MeshStandardMaterial({ color: roofCols[k], roughness: 0.6, flatShading: true }))
      roof.position.y = WALL_H + 1
      roof.rotation.y = Math.PI / 4
      roof.castShadow = true
      g.add(roof)
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(HS * 2, HS * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.9 }))
      floor.position.y = 0.02
      g.add(floor)
    }
    // A couple of big toys watching from the edges.
    const horse = prop(ctx.assets, 'horse', 3.4)
    horse.position.set(-17, 0, -15)
    horse.rotation.y = 0.7
    ctx.root.add(horse)
  },

  init(ctx) {
    const n = ctx.toys.length || 8
    const st: MGState = {
      ph: RIDE, pt: 0, dur: 99, spin: 0, ang: 0, n: 1, open: 0, boarded: 0, locked: 0, held: 0, slam: new Array(ROOMS).fill(0), count: new Array(ROOMS).fill(0),
      dizzy: new Array(n).fill(0), misses: new Array(n).fill(0), avail: Math.min(ROOMS, Math.max(1, n - 1)),
      vis: { car: null, horses: [], fence: null, doors: [], doorX: new Array(ROOMS).fill(0), lamps: [], planks: [], plates: [], numSign: null, fibT: 0, fibN: 0, lastPh: -1, cer: ceremony() },
    }
    // Rooms beyond what this field needs start boarded up.
    const r0 = makeRng(ctx.seed ^ 0x77)
    const order = r0.shuffle([...Array(ROOMS).keys()])
    for (const k of order.slice(st.avail)) st.boarded |= 1 << k
    // The carousel (it turns from the synced angle).
    const car = new THREE.Group()
    ctx.root.add(car)
    st.vis.car = car
    const skirtTex = stripes('#dc2626', '#fef3c7', 24)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(CAR_R, CAR_R + 0.1, CAR_Y, 40, 1, true), new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.5 }))
    drum.position.y = CAR_Y / 2
    car.add(drum)
    const deck = new THREE.Mesh(
      new THREE.CircleGeometry(CAR_R, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        roughness: 0.6,
        map: canvasTex(512, 512, (g) => {
          g.fillStyle = '#b45309'
          g.fillRect(0, 0, 512, 512)
          for (let i = 0; i < 16; i++) {
            g.fillStyle = i % 2 ? '#d97706' : '#92400e'
            g.beginPath()
            g.moveTo(256, 256)
            g.arc(256, 256, 256, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2)
            g.fill()
          }
          g.fillStyle = '#fde68a'
          g.beginPath()
          g.arc(256, 256, 60, 0, Math.PI * 2)
          g.fill()
        }),
      }),
    )
    deck.position.y = CAR_Y + 0.01
    deck.receiveShadow = true
    car.add(deck)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 6, 16), new THREE.MeshStandardMaterial({ map: stripes('#f472b6', '#ffffff', 10), roughness: 0.4 }))
    pole.position.y = 3
    car.add(pole)
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(CAR_R + 0.6, 2.2, 24, 1, true), new THREE.MeshStandardMaterial({ map: stripes('#2563eb', '#fef3c7', 24), roughness: 0.6, side: THREE.DoubleSide }))
    canopy.position.y = 7.1
    car.add(canopy)
    const valance = new THREE.Mesh(
      new THREE.CylinderGeometry(CAR_R + 0.6, CAR_R + 0.6, 0.8, 24, 1, true),
      new THREE.MeshStandardMaterial({ map: stripes('#dc2626', '#fde68a', 24, true), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }),
    )
    valance.position.y = 5.6
    car.add(valance)
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: '#fff3c4', toneMapped: false }), 24)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      bulbs.setMatrixAt(i, m4.makeTranslation(Math.sin(a) * (CAR_R + 0.65), 6.05, Math.cos(a) * (CAR_R + 0.65)))
    }
    car.add(bulbs)
    // Rocking horses on golden poles (each a kinematic body, so they shove toys round as it turns).
    const gold = new THREE.MeshStandardMaterial({ color: '#eab308', metalness: 0.8, roughness: 0.3 })
    const horseBodies = [...Array(HORSES).keys()].map(() => {
      const b = ctx.phys.kinematic({ x: 0, y: 1, z: 0 })
      ctx.phys.attach(b, ctx.RAPIER.ColliderDesc.cuboid(0.35, 0.7, 0.9), { friction: 0.3 })
      return b
    })
    for (let i = 0; i < HORSES; i++) {
      const g = new THREE.Group()
      const a = (i / HORSES) * Math.PI * 2
      g.position.set(Math.sin(a) * 3.3, 0, Math.cos(a) * 3.3)
      g.rotation.y = a + Math.PI / 2
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6.5, 6), gold)
      rod.position.y = 3.6
      const h = prop(ctx.assets, 'horse', 1.9)
      g.add(rod, h)
      car.add(g)
      st.vis.horses.push(h)
    }
    // The fence round the edge while it rides (posts and a rope), and its colliders.
    const fence = new THREE.Group()
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6)
    const posts = new THREE.InstancedMesh(postGeo, gold, 20)
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2
      posts.setMatrixAt(i, m4.makeTranslation(Math.sin(a) * (CAR_R - 0.15), 0.5, Math.cos(a) * (CAR_R - 0.15)))
    }
    const rope = new THREE.Mesh(new THREE.TorusGeometry(CAR_R - 0.15, 0.05, 6, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.8 }))
    rope.position.y = 0.95
    fence.add(posts, rope)
    car.add(fence)
    st.vis.fence = fence
    const fenceCols: Collider[] = []
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2
      fenceCols.push(ctx.phys.box({ x: Math.sin(a) * (CAR_R + 0.1), y: CAR_Y + 0.8, z: Math.cos(a) * (CAR_R + 0.1) }, { x: 1.0, y: 0.8, z: 0.12 }, { rotY: a }))
    }
    // Doors (colliders on when shut), lamps, planks and room plates.
    const doorCols: Collider[] = []
    for (let k = 0; k < ROOMS; k++) {
      const f = roomFrame(k)
      const p = roomPoint(k, 0, HS + WALL_T / 2)
      doorCols.push(ctx.phys.box({ x: p.x, y: WALL_H / 2, z: p.z }, { x: DOOR_W / 2, y: WALL_H / 2, z: WALL_T / 2 + 0.05 }, { rotY: f.rotY }))
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(DOOR_W, WALL_H - 0.5, 0.12),
        new THREE.MeshStandardMaterial({
          roughness: 0.6,
          map: canvasTex(128, 192, (g) => {
            g.fillStyle = '#92400e'
            g.fillRect(0, 0, 128, 192)
            g.strokeStyle = '#78350f'
            g.lineWidth = 6
            g.strokeRect(12, 12, 104, 168)
            g.fillStyle = '#bae6fd'
            g.beginPath()
            g.arc(64, 60, 26, 0, Math.PI * 2)
            g.fill()
            g.fillStyle = '#fde047'
            g.beginPath()
            g.arc(100, 110, 8, 0, Math.PI * 2)
            g.fill()
          }),
        }),
      )
      ctx.root.add(door)
      st.vis.doors.push(door)
      const lampMat = new THREE.MeshBasicMaterial({ color: '#4ade80', toneMapped: false })
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), lampMat)
      const lp = roomPoint(k, 0, HS + WALL_T + 0.15)
      lamp.position.set(lp.x, WALL_H + 0.15, lp.z)
      ctx.root.add(lamp)
      st.vis.lamps.push(lampMat)
      const planks = new THREE.Group()
      const plankMat = new THREE.MeshStandardMaterial({ color: '#a16207', roughness: 0.9 })
      for (const r of [0.6, -0.6]) {
        const pl = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.6, 0.3, 0.1), plankMat)
        pl.rotation.z = r
        planks.add(pl)
      }
      const pp = roomPoint(k, 0, HS + WALL_T + 0.2)
      planks.position.set(pp.x, WALL_H / 2, pp.z)
      planks.rotation.y = f.rotY
      ctx.root.add(planks)
      st.vis.planks.push(planks)
      const tex = canvasTex(160, 96, () => {})
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
      sprite.scale.set(1.7, 1, 1)
      const sp = roomPoint(k, 0, HS + 0.6)
      sprite.position.set(sp.x, WALL_H + 1.1, sp.z)
      ctx.root.add(sprite)
      st.vis.plates.push({ sprite, tex, key: '' })
    }
    const numTex = canvasTex(256, 256, () => {})
    const num = new THREE.Sprite(new THREE.SpriteMaterial({ map: numTex, transparent: true, depthWrite: false }))
    num.scale.set(3.2, 3.2, 1)
    num.position.set(0, 9.6, 0)
    ctx.root.add(num)
    st.vis.numSign = { sprite: num, tex: numTex, key: '' }
    // Every screen: turn the carousel, carry the riders, move the horses, open and shut the doors.
    ctx.hazards.add({
      predict: true,
      update(c, t, dt) {
        const playing = c.phase === 'play'
        if (playing && !c.isHost) st.ang += omega(st, t, true) * dt
        car.rotation.y = st.ang
        for (let i = 0; i < HORSES; i++) {
          const a = (i / HORSES) * Math.PI * 2 + st.ang
          const bob = Math.sin(t * 3 + i * 1.6) * 0.35 * (omega(st, t, playing) !== 0 ? 1 : 0.2)
          horseBodies[i].setNextKinematicTranslation({ x: Math.sin(a) * 3.3, y: CAR_Y + 0.9 + bob, z: Math.cos(a) * 3.3 })
          _q.setFromAxisAngle(_v.set(0, 1, 0), a + Math.PI / 2)
          horseBodies[i].setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
          st.vis.horses[i].position.y = CAR_Y + 0.15 + bob
        }
        const fenceUp = !playing || st.ph === RIDE
        for (const fc of fenceCols) fc.setEnabled(fenceUp)
        fence.position.y = THREE.MathUtils.lerp(fence.position.y, fenceUp ? 0 : -1.3, Math.min(1, dt * 6))
        for (let k = 0; k < ROOMS; k++) {
          const shut = !playing || doorShut(st, k, t)
          doorCols[k].setEnabled(shut)
          st.vis.doorX[k] = THREE.MathUtils.lerp(st.vis.doorX[k], shut ? 0 : DOOR_W * 0.95, Math.min(1, dt * 9))
          const p = roomPoint(k, st.vis.doorX[k], HS + WALL_T / 2)
          const d = st.vis.doors[k]
          d.position.set(p.x, (WALL_H - 0.5) / 2, p.z)
          d.rotation.y = roomFrame(k).rotY
        }
      },
      affect(c, toy, dt) {
        // Riders turn with the carousel.
        const w = omega(st, c.time, c.phase === 'play')
        if (!w || !toy.grounded || Math.abs(toy.feet - CAR_Y) > 0.35 || Math.hypot(toy.pos.x, toy.pos.z) > CAR_R) return
        const p = toy.body.translation()
        const a = w * dt, cs = Math.cos(a), sn = Math.sin(a)
        toy.body.setTranslation({ x: p.x * cs + p.z * sn, y: p.y, z: -p.x * sn + p.z * cs }, true)
        toy.yaw += a
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 0, y: CAR_Y, radius: 4.4, faceIn: false })[i]
  },

  start(ctx, st) {
    setPh(ctx, st, RIDE, ctx.rng.range(5, 7.5))
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    st.ang += omega(st, t, true) * dt
    const el = t - st.pt
    // Who is in which room.
    st.count.fill(0)
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      const k = roomOf(toy.pos.x, toy.pos.z)
      if (k >= 0) st.count[k]++
    }
    if (st.ph === RIDE && el >= st.dur) {
      deal(ctx, st)
      setPh(ctx, st, RUSH, Math.max(6.5, 9.5 - st.spin * 0.6))
      ctx.fx.say(`GROUPS OF ${st.n}!`, '#f472b6', 1.6)
      ctx.fx.sfx('ding')
      ctx.fx.sfx('go')
    } else if (st.ph === RUSH) {
      // Rooms lock as they fill. Toys squeezed in past the number are bumped back out.
      for (let k = 0; k < ROOMS; k++) {
        const bit = 1 << k
        if (!(st.open & bit) || st.locked & bit || st.count[k] < st.n) continue
        st.locked |= bit
        const inside = ctx.toys.filter((o) => o.status === 'play' && roomOf(o.pos.x, o.pos.z) === k)
        const f = roomFrame(k)
        inside.sort((a, b) => (a.pos.x - f.cx) * f.fx + (a.pos.z - f.cz) * f.fz - ((b.pos.x - f.cx) * f.fx + (b.pos.z - f.cz) * f.fz))
        for (const extra of inside.slice(st.n)) {
          const p = roomPoint(k, 0, HS + 1.4)
          ctx.respawn(extra, { x: p.x, y: 0, z: p.z, yaw: f.rotY }, 0.6)
          ctx.fx.popup(extra, 'Full!', '#fca5a5')
        }
        st.count[k] = Math.min(st.count[k], st.n)
        ctx.fx.sfx('slam', { x: f.cx, y: 1, z: f.cz })
        ctx.fx.feed(`Room ${k + 1} is full`)
      }
      // Doors held shut: someone in the doorway grabbing (E).
      st.held = 0
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || !toy.pad.grab || toy.holding || toy.holdingProp) continue
        for (let k = 0; k < ROOMS; k++) {
          const p = roomPoint(k, 0, HS)
          if (st.open & (1 << k) && !(st.locked & (1 << k)) && Math.hypot(toy.pos.x - p.x, toy.pos.z - p.z) < 1.3) st.held |= 1 << k
        }
      }
      if (el >= st.dur) {
        // The odd toys out (unless nobody made a group at all: then it's a re-spin).
        const safe = (toy: (typeof ctx.toys)[number]) => {
          const k = roomOf(toy.pos.x, toy.pos.z)
          return k >= 0 && !!(st.locked & (1 << k)) && st.count[k] === st.n
        }
        const alive = ctx.active()
        if (!alive.some(safe)) ctx.fx.say('Nobody made a group! Spin again', '#fde68a', 1.6)
        else
          for (const toy of alive) {
            if (safe(toy)) {
              ctx.addSprinkles(toy, 1)
              continue
            }
            st.misses[toy.idx]++
            ctx.fx.puff(toy.pos, 'stuff', 12)
            ctx.fail(toy, roomOf(toy.pos.x, toy.pos.z) >= 0 ? 'room not full' : 'odd toy out')
          }
        // The last toy standing takes a bow on the carousel (out of the little room) for the crown.
        const left = ctx.active()
        if (ctx.mode === 'show' && left.length === 1) ctx.respawn(left[0], { x: 0, y: CAR_Y, z: 3.4, yaw: 0 }, 0)
        st.spin++
        st.avail = Math.max(1, st.avail - 1)
        // Board up a room for good (fewer rooms each spin).
        const usable = [...Array(ROOMS).keys()].filter((k) => !(st.boarded & (1 << k)))
        while (usable.length > st.avail) {
          const k = usable.splice(ctx.rng.int(0, usable.length), 1)[0]
          st.boarded |= 1 << k
        }
        setPh(ctx, st, RETURN, 2.4)
      }
    } else if (st.ph === RETURN && el >= st.dur) {
      // Everyone left climbs back on for the next spin.
      const alive = ctx.active()
      const spots = ctx.spawnRing(alive.length, { x: 0, z: 0, y: CAR_Y, radius: 4.4, faceIn: false })
      alive.forEach((toy, i) => ctx.respawn(toy, spots[i], 0.2))
      st.open = 0
      st.locked = 0
      setPh(ctx, st, RIDE, ctx.rng.range(4.5, 7.5))
      ctx.fx.say(`Spin ${st.spin + 1}`, '#fde68a', 1.2)
    }
    // Dizzy: walking curves.
    for (const toy of ctx.toys) {
      if (st.dizzy[toy.idx] <= t || toy.status !== 'play' || !toy.grounded) continue
      const v = toy.body.linvel()
      const a = Math.sin(t * 2.3 + toy.idx) * 2.2 * dt
      const cs = Math.cos(a), sn = Math.sin(a)
      toy.body.setLinvel({ x: v.x * cs + v.z * sn, y: v.y, z: -v.x * sn + v.z * cs }, true)
    }
  },

  onFall(ctx, _st, toy) {
    ctx.respawn(toy, { x: 0, y: CAR_Y, z: 4.4, yaw: 0 }, 0.5)
  },

  retry(ctx, _st, toy, reason) {
    // Quick Play: no eliminations; a miss just counts.
    ctx.fx.popup(toy, reason, '#fca5a5')
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => st.misses[a.idx] - st.misses[b.idx] || Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { goal?: number; decideAt?: number; rushPt?: number; fib?: [number, number]; ride?: number; holdT?: number }
    if (st.ph === RIDE) {
      // Ride near the edge, ready to run.
      d.ride ??= ctx.rng.range(0, Math.PI * 2)
      const a = d.ride + st.ang
      steerTo(toy, Math.sin(a) * 4.6, Math.cos(a) * 4.6, { pace: 0.5, stop: 0.4 })
      return
    }
    if (st.ph !== RUSH) return
    if (d.rushPt !== st.pt) {
      d.rushPt = st.pt
      d.goal = -1
      d.decideAt = st.pt + sk.reaction * ctx.rng.range(1, 2)
    }
    if (ctx.time < (d.decideAt ?? 0)) return
    const n = d.fib && d.fib[1] > ctx.time ? d.fib[0] : st.n
    const mine = roomOf(toy.pos.x, toy.pos.z)
    // Re-pick when my room filled up without me (or never had space).
    const goalOk = d.goal !== undefined && d.goal >= 0 && st.open & (1 << d.goal) && (!(st.locked & (1 << d.goal)) || mine === d.goal)
    if (!goalOk) {
      let best = -1, bs = Infinity
      for (let k = 0; k < ROOMS; k++) {
        if (!(st.open & (1 << k)) || st.locked & (1 << k)) continue
        // Count those inside plus those about to arrive; weaker bots count sloppily.
        let coming = 0
        for (const o of ctx.toys) if (o !== toy && o.status === 'play' && roomOf(o.pos.x, o.pos.z) !== k && doorDist(k, o.pos.x, o.pos.z) < doorDist(k, toy.pos.x, toy.pos.z)) coming++
        const room = n - st.count[k] - (ctx.rng.chance(sk.accuracy) ? coming : 0)
        // Prefer topping up a room that already has toys in (that's how groups get made).
        const sc = doorDist(k, toy.pos.x, toy.pos.z) + (room <= 0 ? 30 : 0) - st.count[k] * 3 * sk.accuracy + ctx.rng.range(0, 2)
        if (sc < bs) {
          bs = sc
          best = k
        }
      }
      d.goal = best
    }
    if (d.goal === undefined || d.goal < 0) return
    let gx: number, gz: number
    if (mine === d.goal) {
      // In: move to the back so the doorway is clear. Hold the door against my grudge if it's coming.
      const p = roomPoint(d.goal, ((toy.idx % 3) - 1) * 0.9, -HS + 0.7)
      gx = p.x
      gz = p.z
      const g = toy.grudge
      if (g && g.status === 'play' && st.count[d.goal] < st.n - 1 && doorDist(d.goal, g.pos.x, g.pos.z) < 3 && ctx.rng.chance(sk.aggression * 0.6)) {
        const dp = roomPoint(d.goal, 0, HS - 0.5)
        gx = dp.x
        gz = dp.z
        d.holdT = ctx.time + 1.2
      }
      toy.pad.grab = (d.holdT ?? 0) > ctx.time && Math.hypot(toy.pos.x - gx, toy.pos.z - gz) < 1
    } else {
      // Go to the doorway first, then in.
      const out = roomPoint(d.goal, 0, HS + 1.2)
      const inn = roomPoint(d.goal, 0, 0)
      const near = Math.hypot(toy.pos.x - out.x, toy.pos.z - out.z) < 1.2
      gx = near ? inn.x : out.x
      gz = near ? inn.z : out.z
    }
    steerTo(toy, gx, gz, { pace: sk.pace, stop: 0.25 })
    if (mine < 0) avoidWalls(ctx, toy)
    // Jump off the carousel edge if moving.
    if (Math.hypot(toy.pos.x, toy.pos.z) > CAR_R - 0.8 && toy.feet > CAR_Y - 0.2 && toy.grounded && ctx.rng.chance(4 * dt)) toy.pad.jump = true
  },

  pack(_c, st) {
    const r = (x: number) => Math.round(x * 1000) / 1000
    return [st.ph, Math.round(st.pt * 100) / 100, Math.round(st.dur * 100) / 100, st.spin, r(st.ang), st.n, st.open, st.boarded, st.locked, st.held, st.slam.map((s) => Math.round(s * 10) / 10), st.count, st.dizzy.map((s) => Math.round(s * 10) / 10), st.misses]
  },

  unpack(_c, st, d) {
    const a = d as [Ph, number, number, number, number, number, number, number, number, number, number[], number[], number[], number[]]
    ;[st.ph, st.pt, st.dur, st.spin, st.ang, st.n, st.open, st.boarded, st.locked, st.held] = a
    st.slam = a[10]
    st.count = a[11]
    st.dizzy = a[12]
    st.misses = a[13]
  },

  onEvent(ctx, st, data) {
    const e = data as { fib?: number }
    if (e.fib !== undefined) {
      st.vis.fibT = 2
      st.vis.fibN = e.fib
      ctx.fxLocal.sfx('zap')
    }
  },

  visual(ctx, st, dt) {
    const v = st.vis
    const t = ctx.time
    const playing = ctx.phase === 'play'
    v.fibT = Math.max(0, v.fibT - dt)
    // Music while it rides.
    if (playing && v.lastPh !== st.ph) {
      if (st.ph === RIDE) ctx.music.start(150 + st.spin * 12)
      else if (st.ph === RUSH) ctx.music.windDown(0.6)
      v.lastPh = st.ph
    }
    if (!playing && v.lastPh !== -1) {
      ctx.music.stop()
      v.lastPh = -1
    }
    // The big number over the carousel (a fib shows the wrong one on this screen).
    if (v.numSign) {
      const show = playing && st.ph === RUSH
      const n = v.fibT > 0 ? v.fibN : st.n
      v.numSign.sprite.visible = show
      const key = `${n}`
      if (show && v.numSign.key !== key) {
        paintPlate(v.numSign, `${n}`, '#db2777')
        v.numSign.key = key
      }
      const s = 3.2 * (1 + Math.max(0, 0.4 - (t - st.pt)) * 1.5)
      v.numSign.sprite.scale.set(s, s, 1)
    }
    for (let k = 0; k < ROOMS; k++) {
      const bit = 1 << k
      const boarded = !!(st.boarded & bit)
      v.planks[k].visible = boarded
      const open = playing && st.ph === RUSH && !!(st.open & bit)
      const locked = !!(st.locked & bit)
      v.lamps[k].color.set(boarded ? '#44403c' : locked ? '#ef4444' : open ? (st.held & bit ? '#f59e0b' : '#4ade80') : '#78716c')
      const pl = v.plates[k]
      pl.sprite.visible = open || locked
      const key = `${st.count[k]}/${st.n}:${locked}`
      if (pl.sprite.visible && pl.key !== key) {
        paintPlate(pl, locked ? 'FULL' : `${st.count[k]}/${st.n}`, locked ? '#dc2626' : '#16a34a')
        pl.key = key
      }
    }
    crownCeremony(ctx, v.cer, dt)
  },

  cameraUpdate(ctx, st, cam, dt) {
    return ceremonyCamera(ctx, st.vis.cer, cam, dt)
  },

  hud(ctx, st, me) {
    if (ctx.phase !== 'play') return null
    const el = ctx.time - st.pt
    const left = Math.max(0, st.dur - el)
    const n = st.vis.fibT > 0 ? st.vis.fibN : st.n
    const rooms = [...Array(ROOMS).keys()].filter((k) => st.open & (1 << k)).length
    const status =
      st.ph === RIDE
        ? { text: 'RIDE THE CAROUSEL', color: '#fde68a' }
        : st.ph === RUSH
          ? { text: `GROUPS OF ${n}!`, color: '#f472b6', pulse: left < 2 }
          : { text: 'ALL ABOARD AGAIN', color: '#fde68a' }
    const chips = [`Spin ${st.spin + 1}`, `${ctx.toys.filter((t) => t.status === 'play').length} left`]
    if (st.ph === RUSH) chips.push(`${rooms} room${rooms === 1 ? '' : 's'} open`)
    if (ctx.mode === 'quick' && me) chips.push(`Misses: ${st.misses[me.idx] ?? 0}`)
    let prompt: string | undefined
    if (me?.status === 'play') {
      const mine = roomOf(me.pos.x, me.pos.z)
      if (st.dizzy[me.idx] > ctx.time) prompt = 'Dizzy! You walk in curves for a moment.'
      else if (st.ph === RIDE) prompt = 'Get ready to run: watch for the number when the music stops.'
      else if (st.ph === RUSH && mine >= 0) prompt = st.locked & (1 << mine) ? 'Safe! The room is full.' : `In room ${mine + 1}: ${st.count[mine]}/${st.n}. Hold E in the doorway to keep someone out.`
      else if (st.ph === RUSH) prompt = `Find a room with space for you: groups of ${n}! Green lamps are open.`
    }
    const bars = st.ph === RUSH ? [{ label: 'Doors close', value: left / st.dur, color: '#f472b6', danger: left < 2 }] : []
    return { status, chips, prompt, bars }
  },
})

