// Bookshelf Climb (race). A vertical race up the face of a tall bookshelf, seen side-on. Each shelf is a run
// with a way up at its end: book stairs (one book tips), bookmark ribbons to climb, pop-up books that spring
// open into platforms. Wobbly books at shelf edges can be shoved off onto whoever is below, sliding books shove
// you towards the edge, and every 15 s the big dictionary slams down on the leader's shelf.
// Tricks: drop a book on a rival, call the dictionary on them, or snip a ribbon / fold a pop-up under them.
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type Toy } from '../engine/types'
import {
  Course, bake, canvasTex, finishArch, follow, mat, mover, poseOf, raceHud, raceInit, racePack, raceRank, raceRespawn, raceSpeedHazard, raceTick,
  raceUnpack, rbox, solid, type BotMem, type RaceState, type Wp,
} from './race-kit'

const ACCENT = '#f59e0b'
const Y = [0, 3.6, 7.2, 10.8, 14.4]
const XW = 12.5 // half width inside the side panels
const HOLE = 9 // holes run from ±HOLE to ±XW
const ZB = -1.2 // front of the back row of books
const ZF = 2.2 // front edge of the shelves
const BOOK_COLS = ['#7f1d1d', '#1e3a8a', '#065f46', '#78350f', '#581c87', '#9a3412', '#334155', '#b45309', '#0f766e', '#be123c']
/** Which way each climb is: +1 right end, -1 left end (climb k goes from shelf k-1 up to shelf k). */
const CLIMB_SIDE = [0, 1, -1, 1, -1]
const ROPES = [
  { x: -10.3, z: 0.6, k: 2 },
  { x: -11.7, z: -0.4, k: 2 },
]
const POPUPS = [
  { x: 10.1, phase: 0 },
  { x: 11.75, phase: 0.5 },
]
const POP_P = 5.4
/** Wobbly books at shelf front edges: x and the shelf they stand on. */
const WOBBLY = [
  { x: 2.6, k: 1 },
  { x: -4, k: 1 },
  { x: 4.2, k: 2 },
  { x: -5.2, k: 3 },
  { x: 1.4, k: 3 },
  { x: -2.2, k: 4 },
  { x: 3.6, k: 4 },
]
const SLIDERS = [
  { x: 0.2, k: 1, phase: 0 },
  { x: -1.8, k: 3, phase: 1.3 },
  { x: 4.6, k: 3, phase: 0 },
]
const SLIDE_P = 3.4
const DICT_EVERY = 15
const DICT_WARN = 1.6
const DICT_STAY = 3.5
/** Book staircases: climb k, at the right (+1) or left (-1) end. */
const STAIRS = [
  { k: 1, side: 1 },
  { k: 4, side: -1 },
]
const SEESAW = { x: 0, k: 2 }

interface Drop {
  x: number
  /** Floor the book lands on. */
  y: number
  /** Round time it lands. */
  t: number
  /** 0 a book, 1 the dictionary. */
  kind: number
}

interface BSState {
  race: RaceState
  drops: Drop[]
  /** Wobbly book i fell at this time (-9 standing). */
  wob: number[]
  /** Ribbon i snipped until this time. */
  cut: number[]
  /** Pop-up i folded shut until this time. */
  fold: number[]
  nextDict: number
  // Visuals.
  vis: { books: THREE.Mesh[]; dict: THREE.Group | null; marks: THREE.Mesh[]; wob: THREE.Object3D[]; ribbons: THREE.Mesh[]; look: THREE.Vector3; pos: THREE.Vector3 }
}

const _v = new THREE.Vector3()

function popU(i: number, t: number) {
  return ((((t / POP_P) + POPUPS[i].phase) % 1) + 1) % 1
}

/** Pop-up height 0 (closed) .. 1 (open, flush with the shelf above). */
function popOpen(st: BSState, i: number, t: number) {
  if (st.fold[i] > t) return 0
  const u = popU(i, t)
  if (u < 0.07) return THREE.MathUtils.smootherstep(u / 0.07, 0, 1)
  if (u < 0.4) return 1
  if (u < 0.62) return 1 - THREE.MathUtils.smoothstep((u - 0.4) / 0.22, 0, 1)
  return 0
}

function slideK(i: number, t: number) {
  const u = ((((t + SLIDERS[i].phase) / SLIDE_P) % 1) + 1) % 1
  if (u < 0.22) return THREE.MathUtils.smootherstep(u / 0.22, 0, 1)
  if (u < 0.45) return 1
  return 1 - THREE.MathUtils.smoothstep((u - 0.45) / 0.4, 0, 1)
}

/** Which shelf a toy is on (by height). */
function shelfOf(t: Toy) {
  let k = 0
  for (let i = 0; i < Y.length; i++) if (t.feet > Y[i] - 0.5) k = i
  return k
}

/** Shelf k's walkable span (x) excluding its hole. */
function span(k: number): [number, number] {
  if (k === 0) return [-XW, XW]
  return CLIMB_SIDE[k] > 0 ? [-XW, HOLE] : [-HOLE, XW]
}

function stairX(side: number) {
  return side * 10.8
}

function buildPath(rope: boolean): Wp[] {
  const p: Wp[] = [{ x: -6, y: 0, z: 0.4, w: 1 }, { x: -3.6, y: 0, z: 0.4, w: 1 }, { x: 0.3, y: 0, z: 0.4, w: 1 }, { x: 3.9, y: 2, z: 0.4, w: 0.8 }, { x: 6.8, y: 0, z: 1.2, w: 0.6 }]
  // Climb 1: book stairs into the depth, then up through the hole onto shelf 1.
  const stairs = (side: number, k: number) => {
    const sx = stairX(side)
    const y0 = Y[k - 1]
    p.push(
      { x: sx - side * 1.6, y: y0, z: 1.7, r: 0.7 },
      { x: sx, y: y0 + 0.9, z: 1.65, r: 0.7, noGap: true },
      { x: sx, y: y0 + 1.8, z: 0.5, r: 0.7, noGap: true },
      { x: sx - side * 0.6, y: y0 + 2.7, z: -0.6, r: 0.6, noGap: true },
      { x: side * (HOLE - 1.4), y: Y[k], z: -0.3, minY: Y[k] - 0.3, jump: 1.9, noGap: true },
    )
  }
  stairs(1, 1)
  // Shelf 1: run left past the slider (wait for it to tuck in) and the wobbly books.
  p.push({ x: 4, y: Y[1], z: 0.9, w: 0.8 }, { x: 2.1, y: Y[1], z: 1.5, w: 0.4, wait: 3, r: 0.8 }, { x: -1.7, y: Y[1], z: 1.4, w: 0.4 }, { x: -6.5, y: Y[1], z: 0.6, w: 1 })
  // Climb 2: a bookmark ribbon.
  const r = ROPES[rope ? 1 : 0]
  p.push({ x: r.x + 0.4, y: Y[1], z: r.z, r: 0.45, noGap: true }, { x: -HOLE + 1.6, y: Y[2], z: 0.2, minY: Y[2] - 0.3, noGap: true })
  // Shelf 2: across the seesaw book over the gap.
  p.push({ x: -2.4, y: Y[2], z: 0.5, w: 0.6, noGap: true }, { x: 0, y: Y[2], z: 0.5, w: 0.5, noGap: true }, { x: 2.6, y: Y[2], z: 0.5, w: 0.8, noGap: true }, { x: 7.2, y: Y[2], z: 0.5, w: 0.8 })
  // Climb 3: the first pop-up book (wait beside it until it has just shut, stand on it, ride it up).
  p.push({ x: 8.5, y: Y[2], z: 0.5, r: 0.5, wait: 10 }, { x: POPUPS[0].x, y: Y[3], z: 0.5, r: 0.55, noGap: true, ride: true }, { x: HOLE - 1.6, y: Y[3], z: 0.4, noGap: true })
  // Shelf 3: two sliders.
  p.push({ x: 6.5, y: Y[3], z: 1.5, w: 0.4, wait: 5, r: 0.8 }, { x: 2.3, y: Y[3], z: 1.4, w: 0.4 }, { x: 0.1, y: Y[3], z: 1.5, w: 0.4, wait: 6, r: 0.8 }, { x: -3.6, y: Y[3], z: 1.2, w: 0.4 }, { x: -7, y: Y[3], z: 0.7, w: 1 })
  // Climb 4: book stairs again, onto the top.
  stairs(-1, 4)
  p.push({ x: 0, y: Y[4], z: 0.3, w: 1 }, { x: 9.4, y: Y[4], z: 0.3, w: 1 })
  return p
}

const PATHS = [buildPath(false), buildPath(true)]

const course = new Course({
  path: PATHS[0],
  cps: [
    { x: 5.8, y: Y[1], z: 0.5, hx: 3, hz: 1.6, yaw: -Math.PI / 2, name: 'Shelf 1' },
    { x: -5.8, y: Y[2], z: 0.5, hx: 3, hz: 1.6, yaw: Math.PI / 2, name: 'Shelf 2' },
    { x: 5.8, y: Y[3], z: 0.5, hx: 3, hz: 1.6, yaw: -Math.PI / 2, name: 'Shelf 3' },
    { x: -5.8, y: Y[4], z: 0.5, hx: 3, hz: 1.6, yaw: Math.PI / 2, name: 'The top' },
  ],
  finish: { x: 9.6, y: Y[4], z: 0.5, hx: 0.5, hz: 2 },
  podium: { x: -17, y: 1.2, z: 3, yaw: Math.PI / 2 },
})

function spineTex() {
  return canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(0,0,0,0.25)'
    g.fillRect(0, 14, w, 6)
    g.fillRect(0, h - 22, w, 6)
    g.fillStyle = 'rgba(255,230,160,0.8)'
    g.fillRect(10, 36, w - 20, 4)
    g.fillRect(14, 46, w - 28, 3)
    g.fillRect(10, h - 44, w - 20, 4)
  })
}

/** One book as a mesh (cover colour, pale pages on the sides). */
function bookMesh(w: number, h: number, d: number, color: string) {
  const g = new THREE.Group()
  const cover = new THREE.Mesh(rbox(w, h, d, 0.05), mat(color, { roughness: 0.6 }))
  cover.castShadow = true
  const pages = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h * 0.9, d * 1.01), mat('#fef3c7', { roughness: 0.9 }))
  g.add(cover, pages)
  return bake(g)
}

function dictMesh() {
  const g = new THREE.Group()
  const b = bookMesh(2.6, 1.6, 3.4, '#4c1d95')
  g.add(b)
  const label = textSprite('DICTIONARY', { color: '#fde68a', size: 0.42 })
  label.position.set(0, 0, 1.75)
  g.add(label)
  return g
}

export default defineLevel<BSState>({
  id: 'bookshelf',
  name: 'Bookshelf Climb',
  type: 'race',
  blurb: 'Race up a towering bookshelf: book stairs, ribbon climbs, pop-up books and a falling dictionary.',
  howTo: [
    'Climb shelf by shelf: book stairs, bookmark ribbons, pop-up books',
    'Shove a wobbly book off the edge to flatten whoever is below',
    'The dictionary slams down on the leader every 15 seconds',
    'First to the bookend trophy on top wins',
  ],
  accent: ACCENT,
  players: [2, 16],
  duration: 150,
  runSpeed: 5.2,
  introOrbit: { radius: 24, height: 4, center: [0, 7, 0] },
  sprinkles: { start: 1 },
  fallY: -6,
  sky: { color: '#271a10', fogNear: 50, fogFar: 140 },

  tricks: [
    {
      id: 'drop',
      name: 'Book Drop',
      icon: 'slam',
      cost: 2,
      cooldown: 9,
      busy: 0.8,
      target: 'rival',
      desc: 'Knock a book off the shelf above onto a rival. It lands in under a second.',
      counter: 'Watch for the shadow and step aside.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.drops.push({ x: THREE.MathUtils.clamp(target.pos.x + target.vel.x * 0.25, -XW + 0.8, XW - 0.8), y: Y[shelfOf(target)], t: ctx.time + 0.8, kind: 0 })
        ctx.fx.sfx('whoosh', target.pos)
        ctx.fx.popup(target, 'Look up!', '#fde68a')
      },
    },
    {
      id: 'dict',
      name: 'Dictionary',
      icon: 'crack',
      cost: 3,
      cooldown: 20,
      busy: 1.2,
      target: 'rival',
      minSpice: 1,
      desc: 'Call the dictionary down on a rival right now (it still gives a short warning).',
      counter: 'Run as soon as the big shadow appears.',
      can: (_c, s) => (s.drops.some((d) => d.kind === 1) ? 'The dictionary is busy' : true),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const k = shelfOf(target)
        const [a, b] = span(k)
        s.drops.push({ x: THREE.MathUtils.clamp(target.pos.x, a + 1.4, b - 1.4), y: Y[k], t: ctx.time + DICT_WARN, kind: 1 })
        s.nextDict = Math.max(s.nextDict, ctx.time + DICT_EVERY)
        ctx.fx.say('DICTIONARY!', '#c4b5fd', 1.2)
      },
    },
    {
      id: 'paper',
      name: 'Paper Cut',
      icon: 'tack',
      cost: 2,
      cooldown: 10,
      busy: 0.6,
      target: 'rival',
      desc: 'Snip the ribbon they are climbing, or fold the pop-up book under them, for 4 seconds.',
      counter: 'Use the other ribbon or the other pop-up book.',
      can: (_c, _s, _u, t) => (t && (t.pos.x < -HOLE + 1 || t.pos.x > HOLE - 1) && t.feet < Y[3] + 0.5 && t.feet > Y[1] - 0.5 ? true : 'Only at a ribbon or a pop-up'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        if (target.pos.x < 0) {
          let best = 0
          ROPES.forEach((r, i) => {
            if (Math.abs(r.x - target.pos.x) < Math.abs(ROPES[best].x - target.pos.x)) best = i
          })
          s.cut[best] = ctx.time + 4
        } else {
          let best = 0
          POPUPS.forEach((r, i) => {
            if (Math.abs(r.x - target.pos.x) < Math.abs(POPUPS[best].x - target.pos.x)) best = i
          })
          s.fold[best] = ctx.time + 4
        }
        ctx.fx.sfx('snip', target.pos)
        ctx.fx.popup(target, 'Snip!', '#fca5a5')
      },
    },
    bubbleWrap<BSState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 28, hd: 26, ridge: 36, knee: 10, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    const wood = mat('#8b5a33', { roughness: 0.8 })
    const woodDark = mat('#5f3b1f', { roughness: 0.85 })
    // Side panels, back panel and a crown on top.
    for (const s of [-1, 1]) solid(ctx, { pos: [s * (XW + 0.3), Y[4] / 2 + 0.6, 0], size: [0.6, Y[4] + 1.2, 4.9], material: wood, round: 0.12 })
    solid(ctx, { pos: [0, Y[4] / 2, -2.45], size: [XW * 2 + 1.2, Y[4] + 0.4, 0.3], material: woodDark })
    // Boards (the floor is shelf 0), each with a hole at its climbing end and a little lip at the front.
    for (let k = 1; k < Y.length; k++) {
      const [a, b] = span(k)
      const pieces: [number, number][] = k === SEESAW.k ? [[a, SEESAW.x - 1.1], [SEESAW.x + 1.1, b]] : [[a, b]]
      for (const [p0, p1] of pieces) {
        solid(ctx, { pos: [(p0 + p1) / 2, Y[k] - 0.175, -0.1], size: [p1 - p0, 0.35, 4.7], material: wood })
        solid(ctx, { pos: [(p0 + p1) / 2, Y[k] + 0.12, ZF + 0.1], size: [p1 - p0, 0.24, 0.2], material: woodDark, round: 0.06 })
      }
    }
    // Floor lip so nobody wanders off the bottom shelf.
    solid(ctx, { pos: [0, 0.12, ZF + 0.1], size: [XW * 2, 0.24, 0.2], material: woodDark, round: 0.06 })
    // Back rows of books on every shelf (instanced).
    const spine = spineTex()
    const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: spine, roughness: 0.7 }), 200)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3()
    const col = new THREE.Color()
    let n = 0
    for (let k = 0; k < Y.length - 1; k++) {
      const [a, b] = k === 0 ? [-XW, XW] : span(k)
      let x = a + 0.1
      while (x < b - 0.5 && n < 200) {
        const w = ctx.rng.range(0.35, 0.75), h = ctx.rng.range(1.8, 2.9)
        p.set(x + w / 2, Y[k] + h / 2, (ZB - 2.3) / 2)
        q.setFromAxisAngle(_v.set(0, 0, 1), ctx.rng.chance(0.08) ? ctx.rng.range(-0.18, 0.18) : 0)
        sc.set(w * 0.96, h, ZB + 2.3)
        books.setMatrixAt(n, m4.compose(p, q, sc))
        books.setColorAt(n, col.set(ctx.rng.pick(BOOK_COLS)))
        n++
        x += w
      }
    }
    books.count = n
    books.castShadow = true
    books.receiveShadow = true
    ctx.root.add(books)
    ctx.phys.box({ x: 0, y: Y[4] / 2, z: (ZB - 2.3) / 2 }, { x: XW, y: Y[4] / 2, z: (ZB + 2.3) / 2 })
    // Shelf 0: a fallen book to hop, and a tall stack with a leaning book as a ramp.
    const hurdle = bookMesh(0.9, 0.7, 3.4, '#1e3a8a')
    hurdle.position.set(-3.6, 0.35, 0.5)
    ctx.root.add(hurdle)
    ctx.phys.box({ x: -3.6, y: 0.35, z: 0.5 }, { x: 0.45, y: 0.35, z: 1.7 })
    const stack = bookMesh(1.4, 2, 3.4, '#065f46')
    stack.position.set(4, 1, 0.5)
    ctx.root.add(stack)
    ctx.phys.box({ x: 4, y: 1, z: 0.5 }, { x: 0.7, y: 1, z: 1.7 })
    {
      const rise = 2, run = 3.5
      const ang = Math.atan2(rise, run)
      const L = Math.hypot(rise, run)
      const lean = bookMesh(L, 0.3, 3.2, '#b45309')
      const cx = 3.3 - run / 2, cy = rise / 2 - 0.15 * Math.cos(ang)
      lean.position.set(cx, cy, 0.5)
      lean.rotation.z = ang
      ctx.root.add(lean)
      const qq = new THREE.Quaternion().setFromAxisAngle(_v.set(0, 0, 1), ang)
      ctx.phys.box({ x: cx, y: cy, z: 0.5 }, { x: L / 2, y: 0.15, z: 1.6 }, { quat: qq, friction: 0.9 })
    }
    // Book stairs that climb into the depth of the shelf, under the hole above.
    for (const s of STAIRS) {
      const sx = stairX(s.side), y0 = Y[s.k - 1]
      for (const [i, h, z] of [[0, 0.9, 1.65], [1, 1.8, 0.5], [2, 2.7, -0.63]] as const) {
        const b = bookMesh(3, h, 1.13, BOOK_COLS[(s.k * 3 + i) % BOOK_COLS.length])
        b.position.set(sx, y0 + h / 2, z)
        ctx.root.add(b)
        ctx.phys.box({ x: sx, y: y0 + h / 2, z }, { x: 1.5, y: h / 2, z: 0.565 })
      }
    }
    // A bookend trophy and a finish line on top.
    finishArch(ctx, { x: 9.6, y: Y[4], z: 0.2, width: 4.2, rotY: Math.PI / 2, color: ACCENT, text: 'FINISH', posts: false })
    const trophy = new THREE.Group()
    const cup = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.15, 0.3), new THREE.Vector2(0.15, 0.7), new THREE.Vector2(0.75, 1.0), new THREE.Vector2(0.95, 1.8), new THREE.Vector2(0.85, 1.8), new THREE.Vector2(0.0, 1.2)], 20), mat('#fbbf24', { metalness: 0.8, roughness: 0.3 }))
    trophy.add(cup)
    trophy.position.set(11.4, Y[4], -1.2)
    ctx.root.add(trophy)
    // The podium: a stack of big books beside the bookshelf.
    for (let i = 0; i < 3; i++) {
      const b = bookMesh(5.6 - i * 0.3, 0.4, 8.6 - i * 0.4, BOOK_COLS[i + 2])
      b.position.set(-17, 0.2 + i * 0.4, 3)
      ctx.root.add(b)
    }
    ctx.phys.box({ x: -17, y: 0.6, z: 3 }, { x: 2.8, y: 0.6, z: 4.3 })
    const sign = textSprite('Through!', { bg: ACCENT, size: 0.8 })
    sign.position.set(-17, 4.2, 3)
    ctx.root.add(sign)
    for (const c of course.cps) {
      const s = textSprite('Checkpoint', { bg: '#b45309', size: 0.45 })
      s.position.set(c.x, c.y + 2.3, ZB + 0.2)
      ctx.root.add(s)
    }
  },

  init(ctx) {
    const st: BSState = {
      race: raceInit(ctx),
      drops: [],
      wob: WOBBLY.map(() => -9),
      cut: ROPES.map(() => -9),
      fold: POPUPS.map(() => -9),
      nextDict: DICT_EVERY - DICT_WARN,
      vis: { books: [], dict: null, marks: [], wob: [], ribbons: [], look: new THREE.Vector3(0, 2, 0), pos: new THREE.Vector3(0, 4, 14) },
    }
    raceSpeedHazard(ctx, st.race, 5.2)
    // The seesaw book over the gap in shelf 2.
    mover(ctx, {
      half: [1.5, 0.15, 1.6],
      obj: bookMesh(3, 0.3, 3.2, '#0f766e'),
      pose: (t, out) => {
        poseOf(out, SEESAW.x, Y[SEESAW.k] - 0.15, 0.5, 0, 0, Math.sin(t * 1.3) * 0.32)
        return true
      },
    })
    // Sliding books that shove you towards the edge.
    SLIDERS.forEach((s, i) => {
      mover(ctx, {
        half: [0.8, 0.6, 1.5],
        obj: bookMesh(1.6, 1.2, 3, BOOK_COLS[(i * 3 + 1) % BOOK_COLS.length]),
        shove: 6.5,
        stun: 0.6,
        pose: (t, out) => {
          poseOf(out, s.x, Y[s.k] + 0.6, THREE.MathUtils.lerp(-3.4, 0.35, slideK(i, t)))
          return true
        },
      })
    })
    // Pop-up books.
    POPUPS.forEach((pp, i) => {
      const base = bookMesh(1.6, 0.45, 3, '#9a3412')
      base.position.set(pp.x, Y[2] + 0.225, 0.5)
      ctx.root.add(base)
      ctx.phys.box({ x: pp.x, y: Y[2] + 0.2, z: 0.5 }, { x: 0.8, y: 0.2, z: 1.5 })
      const g = new THREE.Group()
      const plat = new THREE.Mesh(rbox(1.5, 0.3, 2.9, 0.06), mat('#fef9c3', { roughness: 0.9 }))
      const tower = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 4), mat('#fca5a5'))
      tower.position.set(0, 0.75, -1.1)
      const tower2 = tower.clone()
      tower2.position.x = 0.45
      tower2.scale.setScalar(0.7)
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 2.2), mat('#fde68a'))
      stem.name = 'stem'
      g.add(plat, tower, tower2, stem)
      mover(ctx, {
        half: [0.75, 0.15, 1.45],
        obj: g,
        pose: (t, out) => {
          const o = popOpen(st, i, t)
          poseOf(out, pp.x, THREE.MathUtils.lerp(Y[2] + 0.3, Y[3] - 0.15, o), 0.5)
          // Stretch the paper stem down to the book.
          stem.scale.y = Math.max(0.01, o * (Y[3] - Y[2] - 0.6))
          stem.position.y = -stem.scale.y / 2
          return true
        },
      })
    })
    // Bookmark ribbons (climbing is a predicted hazard: you grab on when you touch one).
    ROPES.forEach((r, i) => {
      const len = Y[r.k] - Y[r.k - 1] - 0.4
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.32, len, 0.05), mat(i ? '#dc2626' : '#2563eb', { roughness: 0.5 }))
      rib.position.set(r.x, Y[r.k - 1] + 0.4 + len / 2, r.z)
      ctx.root.add(rib)
      const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6), mat('#fbbf24'))
      tassel.position.set(r.x, Y[r.k - 1] + 0.25, r.z)
      ctx.root.add(tassel)
      st.vis.ribbons.push(rib)
    })
    ctx.hazards.add({
      predict: true,
      update() {},
      affect(c, toy) {
        if (toy.status !== 'play' || toy.mode !== 'walk') return
        const d = toy.data as { rope?: number; ropeCd?: number }
        if (d.rope === undefined) {
          if ((d.ropeCd ?? -9) > c.time) return
          for (let i = 0; i < ROPES.length; i++) {
            const r = ROPES[i]
            if (st.cut[i] > c.time) continue
            if (Math.abs(toy.pos.x - r.x) < 0.55 && Math.abs(toy.pos.z - r.z) < 0.9 && toy.feet > Y[r.k - 1] - 0.3 && toy.feet < Y[r.k] - 0.6) {
              d.rope = i
              break
            }
          }
          if (d.rope === undefined) return
        }
        const r = ROPES[d.rope]
        if (toy.pad.jump || st.cut[d.rope] > c.time || toy.stun > 0) {
          d.rope = undefined
          d.ropeCd = c.time + 0.7
          return
        }
        if (toy.feet >= Y[r.k] + 0.35) {
          // Over the top: a hop out onto the shelf.
          d.rope = undefined
          d.ropeCd = c.time + 1
          toy.body.setLinvel({ x: 6.2, y: 6.2, z: 0 }, true)
          toy.yaw = Math.PI / 2
          return
        }
        toy.body.setLinvel({ x: (r.x - toy.pos.x) * 8, y: 4.4, z: (r.z + 0.3 - toy.pos.z) * 8 }, true)
        toy.yaw = Math.PI
      },
    })
    // Wobbly books (visual; the rules are in tick()).
    WOBBLY.forEach((w, i) => {
      const b = bookMesh(0.5, 1.7, 1.2, i % 2 ? '#b91c1c' : '#7e22ce')
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.04), mat('#fde047'))
      ribbon.position.set(0, -0.95, 0.61)
      b.add(ribbon)
      b.position.set(w.x, Y[w.k] + 0.85, ZF - 0.55)
      ctx.root.add(b)
      st.vis.wob.push(b)
    })
    // Falling books and the dictionary (pooled), plus their landing shadows.
    for (let i = 0; i < 5; i++) {
      const b = bookMesh(1.3, 0.45, 2.6, BOOK_COLS[(i * 2) % BOOK_COLS.length])
      b.visible = false
      ctx.root.add(b)
      st.vis.books.push(b as unknown as THREE.Mesh)
    }
    const dict = dictMesh()
    dict.visible = false
    ctx.root.add(dict)
    st.vis.dict = dict
    // A solid dictionary while it lies on a shelf.
    mover(ctx, {
      half: [1.3, 0.8, 1.7],
      obj: new THREE.Group(),
      pose: (t, out) => {
        const d = st.drops.find((x) => x.kind === 1 && t >= x.t && t < x.t + DICT_STAY)
        if (!d) return false
        poseOf(out, d.x, d.y + 0.8, 0.4)
        return true
      },
    })
    for (let i = 0; i < 6; i++) {
      const mk = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false }))
      mk.visible = false
      ctx.root.add(mk)
      st.vis.marks.push(mk)
    }
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnGrid(n, { x: -8.2, y: 0, z: 0.5, yaw: Math.PI / 2, spacing: 1.15, cols: 3 })[i]
  },

  tick(ctx, st) {
    const t = ctx.time
    raceTick(ctx, st.race, course)
    // The dictionary: every 15 s, on the leader's shelf.
    if (t >= st.nextDict) {
      st.nextDict = t + DICT_EVERY
      const lead = ctx.leader()
      if (lead && !st.drops.some((d) => d.kind === 1)) {
        const k = shelfOf(lead)
        const [a, b] = span(k)
        st.drops.push({ x: THREE.MathUtils.clamp(lead.pos.x + ctx.rng.range(-1.5, 1.5) + lead.vel.x * 0.6, a + 1.4, b - 1.4), y: Y[k], t: t + DICT_WARN, kind: 1 })
        ctx.fx.sfx('wind')
      }
    }
    // Wobbly books: shove (or dive into) one and it falls onto the shelf below.
    WOBBLY.forEach((w, i) => {
      if (st.wob[i] > -1 && t - st.wob[i] > 7) st.wob[i] = -9
      if (st.wob[i] > -1) return
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || (!toy.pad.shove && toy.dive <= 0)) continue
        if (Math.abs(toy.pos.x - w.x) < 1.3 && Math.abs(toy.feet - Y[w.k]) < 0.5 && toy.pos.z > 0) {
          st.wob[i] = t
          st.drops.push({ x: w.x, y: Y[w.k - 1], t: t + 0.65, kind: 2 })
          ctx.fx.sfx('whoosh', toy.pos)
          ;(toy.data as { pusher?: boolean }).pusher = true
          // Whoever is below gets the blame on the pusher.
          for (const v of ctx.toys) if (v !== toy && v.status === 'play' && Math.abs(v.pos.x - w.x) < 1.6 && shelfOf(v) === w.k - 1) ctx.blame(v, toy)
          break
        }
      }
    })
    // Landings.
    for (let i = st.drops.length - 1; i >= 0; i--) {
      const d = st.drops[i]
      if (!(d as { hit?: boolean }).hit && t >= d.t) {
        ;(d as { hit?: boolean }).hit = true
        const half = d.kind === 1 ? 1.4 : 0.85
        ctx.fx.puff({ x: d.x, y: d.y + 0.2, z: 0.5 }, 'dust', d.kind === 1 ? 22 : 10)
        ctx.fx.sfx(d.kind === 1 ? 'slam' : 'thud', { x: d.x, y: d.y, z: 0.5 })
        if (d.kind === 1) ctx.fx.shake(0.6)
        for (const toy of ctx.toys) {
          if (toy.status !== 'play' || Math.abs(toy.pos.x - d.x) > half + 0.3 || toy.feet < d.y - 0.4 || toy.feet > d.y + 1.9) continue
          st.race.hold[toy.idx] = t + (d.kind === 1 ? 1.6 : 1.1)
          ctx.knock(toy, { x: Math.sign(toy.pos.x - d.x || 1) * (d.kind === 1 ? 5 : 2), y: 1, z: 0 }, 0.2)
          ctx.fx.popup(toy, 'FLAT!', '#fde68a')
        }
      }
      if (t > d.t + (d.kind === 1 ? DICT_STAY : 1.2)) st.drops.splice(i, 1)
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
    const d = toy.data as BotMem & { rope?: number }
    if (d.route === undefined) d.route = toy.idx % 2
    if (d.rope !== undefined) {
      // On a ribbon: the next goal is the shelf above.
      const path = PATHS[d.route]
      for (let i = d.wp ?? 0; i < path.length; i++)
        if (path[i].minY !== undefined) {
          d.wp = i
          break
        }
      return
    }
    const t = ctx.time
    // Run out from under a falling book.
    for (const dr of st.drops) {
      if (t > dr.t || Math.abs(toy.feet - dr.y) > 0.6) continue
      const half = dr.kind === 1 ? 1.4 : 0.85
      const dx = toy.pos.x - dr.x
      if (Math.abs(dx) < half + 0.5 && dr.t - t < 1.6) {
        toy.pad.mx = dx >= 0 ? 1 : -1
        toy.pad.mz = 0
        return
      }
    }
    // Mischief: shove a wobbly book onto someone below.
    if (ctx.rng.chance(sk.aggression * 0.5 * dt * 4)) {
      for (let i = 0; i < WOBBLY.length; i++) {
        const w = WOBBLY[i]
        if (st.wob[i] > -1 || Math.abs(toy.pos.x - w.x) > 1.1 || Math.abs(toy.feet - Y[w.k]) > 0.4) continue
        if (ctx.toys.some((v) => v !== toy && v.status === 'play' && Math.abs(v.pos.x - w.x) < 1 && shelfOf(v) === w.k - 1)) {
          toy.pad.shove = true
          toy.yaw = 0
          return
        }
      }
    }
    follow(ctx, toy, PATHS[d.route], {
      pace: sk.pace,
      dt,
      wait: (id) => {
        if (id === 3 || id === 5 || id === 6) {
          // Sliders: go once it is on its way back in (or tucked away).
          const si = id === 3 ? 0 : id === 5 ? 2 : 1
          const u = ((((t + SLIDERS[si].phase) / SLIDE_P) % 1) + 1) % 1
          return !(u > 0.6 && slideK(si, t) < 0.45)
        }
        if (id >= 10) {
          // Step onto the pop-up while it is shut and will stay shut a moment.
          const u = popU(id - 10, t)
          return !(u > 0.64 && u < 0.84) || st.fold[id - 10] > t
        }
        return false
      },
    })
  },

  pack(_c, st) {
    const r2 = (x: number) => Math.round(x * 100) / 100
    return [racePack(st.race), st.drops.map((d) => [r2(d.x), d.y, r2(d.t), d.kind]), st.wob.map(r2), st.cut.map(r2), st.fold.map(r2), r2(st.nextDict)]
  },

  unpack(_c, st, d) {
    const a = d as [unknown, number[][], number[], number[], number[], number]
    raceUnpack(st.race, a[0])
    st.drops = a[1].map((r) => ({ x: r[0], y: r[1], t: r[2], kind: r[3] }))
    st.wob = a[2]
    st.cut = a[3]
    st.fold = a[4]
    st.nextDict = a[5]
  },

  visual(ctx, st, dt) {
    const t = ctx.time
    const v = st.vis
    // Wobbly books: wobble, then topple off the edge and fall.
    WOBBLY.forEach((w, i) => {
      const b = v.wob[i]
      const e = t - st.wob[i]
      if (st.wob[i] < -1 || e > 7) {
        b.visible = true
        b.position.set(w.x, Y[w.k] + 0.85, ZF - 0.55)
        b.rotation.set(Math.sin(t * 3 + i) * 0.04, 0, 0)
      } else if (e < 0.65) {
        b.visible = true
        const k = e / 0.65
        b.rotation.set(k * 1.57, 0, 0)
        b.position.set(w.x, THREE.MathUtils.lerp(Y[w.k] + 0.85, Y[w.k - 1] + 0.3, k * k), ZF - 0.55 + Math.min(1, k * 3) * 0.85)
      } else if (e < 1.8) {
        b.visible = true
        b.rotation.set(1.57, 0, 0)
        b.position.set(w.x, Y[w.k - 1] + 0.3 - Math.max(0, e - 1.4) * 1.5, ZF - 0.7)
      } else b.visible = false
    })
    // Falling books, the dictionary and their shadows.
    let bi = 0, mi = 0
    for (const d of st.drops) {
      const fall = d.t - t
      if (d.kind === 1) {
        const g = v.dict!
        g.visible = true
        const y = fall > 0 ? d.y + 0.8 + Math.min(18, fall * fall * 9 + fall * 2) : d.y + 0.8
        g.position.set(d.x, y, 0.4)
        g.rotation.z = fall > 0 ? Math.sin(t * 6) * 0.05 : 0
        const lift = t - d.t - (DICT_STAY - 0.4)
        if (lift > 0) g.position.y += lift * lift * 60
      } else if (bi < v.books.length && d.kind === 0) {
        const b = v.books[bi++]
        const show = fall > -0.9
        b.visible = show
        if (show) {
          b.position.set(d.x, fall > 0 ? d.y + 0.25 + Math.min(10, fall * fall * 12 + fall * 3) : d.y + 0.25, 0.4)
          b.rotation.set(fall > 0 ? fall * 4 : 0, 0, 0)
        }
      }
      if (fall > 0 && mi < v.marks.length) {
        const mk = v.marks[mi++]
        mk.visible = true
        mk.position.set(d.x, d.y + 0.03, 0.5)
        const s = (d.kind === 1 ? 1.6 : 0.95) * (1.3 - Math.min(1, fall / 1.6) * 0.5)
        mk.scale.set(s, 1, s * 1.4)
        ;(mk.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 16) * 0.12
      }
    }
    for (; bi < v.books.length; bi++) v.books[bi].visible = false
    for (; mi < v.marks.length; mi++) v.marks[mi].visible = false
    if (v.dict && !st.drops.some((d) => d.kind === 1)) v.dict.visible = false
    // Snipped ribbons hang short.
    v.ribbons.forEach((r, i) => {
      const cut = st.cut[i] > t
      r.scale.y += ((cut ? 0.25 : 1) - r.scale.y) * Math.min(1, dt * 8)
      const len = Y[ROPES[i].k] - Y[ROPES[i].k - 1] - 0.4
      r.position.y = Y[ROPES[i].k] - (len * r.scale.y) / 2
    })
    // Flattened toys.
    for (const toy of ctx.toys) {
      if (!toy.rig) continue
      const flat = (st.race.hold[toy.idx] ?? 0) > t && toy.status === 'play'
      const s = toy.rig.root.scale
      const ty = flat ? 0.3 : 1, txz = flat ? 1.35 : 1
      s.set(s.x + (txz - s.x) * Math.min(1, dt * 14), s.y + (ty - s.y) * Math.min(1, dt * 14), s.z + (txz - s.z) * Math.min(1, dt * 14))
    }
  },

  cameraUpdate(ctx, st, cam, dt) {
    // Side-on: A/D run along the shelf, W/S move in and out of it.
    let focus: Toy | null = ctx.me && ctx.me.status !== 'failed' ? ctx.me : null
    if (!focus) focus = ctx.leader() ?? ctx.toys[0] ?? null
    if (!focus) return false
    cam.yaw = Math.PI
    cam.pitch = 0.3
    const v = st.vis
    const fx = THREE.MathUtils.clamp(focus.pos.x, -XW + 3, XW - 3)
    const fy = focus.status === 'qualified' && focus.data.podium ? focus.pos.y : focus.pos.y
    v.look.set(fx, fy + 0.6, 0)
    v.pos.set(fx * 0.92, fy + 3.4, 12.5)
    cam.place(v.pos, v.look, dt, 5)
    return true
  },

  hud(ctx, st, me) {
    const t = ctx.time
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    const dict = st.drops.find((d) => d.kind === 1 && d.t > t)
    if (dict) status = { text: 'DICTIONARY!', color: '#c4b5fd', pulse: true }
    else if (ctx.phase === 'play' && st.nextDict - t < 4 && st.nextDict > t) status = { text: `Dictionary in ${Math.ceil(st.nextDict - t + DICT_WARN)}`, color: '#a78bfa' }
    if (me && me.status === 'play' && ctx.phase === 'play') {
      const k = shelfOf(me)
      const ropeOn = (me.data as { rope?: number }).rope !== undefined
      if ((st.race.hold[me.idx] ?? 0) > t) prompt = 'Flattened! Pop back up in a moment…'
      else if (ropeOn) prompt = 'Climbing the ribbon… (Space lets go)'
      else if (k === 0 || k === 3) prompt = 'Book stairs: climb into the shelf, then jump up through the gap. The red book tips!'
      else if (k === 1) prompt = 'Grab a bookmark ribbon at the left end to climb up.'
      else if (k === 2) prompt = 'Hop on a pop-up book while it is shut: it springs you up a shelf.'
      else prompt = 'Run for the trophy! Shove (click) wobbly books onto whoever is below.'
    }
    return raceHud(ctx, st.race, course, me, ACCENT, { prompt, status })
  },
})
