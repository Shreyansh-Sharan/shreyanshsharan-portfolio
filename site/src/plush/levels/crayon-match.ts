// Crayon Match (logic). The floor is a giant colouring-book page covered in crayon patches. A crayon rises and
// calls a colour: get onto a patch of that colour before the rest of the page is scribbled out (anyone off a
// right patch is scribbled out with it). Later calls are mixes (blue + yellow means green), a cheeky parrot toy
// shouts fake calls, and each round some patches are scribbled out for good. Dirty tricks: smudge the patch a
// rival is standing on into another colour, make the parrot squawk a fake call, or wax a rival's feet.
import * as THREE from 'three'
import { avoidWalls, bully, skill, steerTo } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { blobShape, canvasTex, roundRect, scribble } from '../engine/paint'
import { makeRng } from '../engine/rng'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx } from '../engine/types'

const SP = 3.7 // patch spacing
const PR = 1.5 // patch half size

const IDLE = 0, CALL = 1, SCRIBBLE = 2, RESET = 3
type Ph = 0 | 1 | 2 | 3

const COLS = [
  { name: 'RED', c: '#e53935' },
  { name: 'BLUE', c: '#1e6fd9' },
  { name: 'YELLOW', c: '#f7c815' },
  { name: 'GREEN', c: '#2fa84f' },
  { name: 'ORANGE', c: '#f57c1f' },
  { name: 'PURPLE', c: '#8e44c9' },
  { name: 'PINK', c: '#f06fa8' },
  { name: 'BROWN', c: '#8d5a2b' },
]
const RED = 0, BLUE = 1, YELLOW = 2, GREEN = 3, ORANGE = 4, PURPLE = 5, PINK = 6
/** Mixed calls: [a, b] makes the result. White is -1 (pink = red + white). */
const MIXES: { a: number; b: number; r: number }[] = [
  { a: BLUE, b: YELLOW, r: GREEN },
  { a: RED, b: YELLOW, r: ORANGE },
  { a: RED, b: BLUE, r: PURPLE },
  { a: RED, b: -1, r: PINK },
]
const colName = (i: number) => (i < 0 ? 'WHITE' : COLS[i].name)
const colHex = (i: number) => (i < 0 ? '#ffffff' : COLS[i].c)

interface CMState {
  ph: Ph
  pt: number
  dur: number
  cycle: number
  /** The answer (a colour index), and the call shown: [a, b] (b = -2 when it is a single colour). */
  target: number
  callA: number
  callB: number
  /** Colour per patch (-1 = scribbled out for good). */
  col: number[]
  /** Smudged patches this call (bitmask-free list: patch index → colour it was). */
  smudge: number[]
  /** Parrot: the fake colour it is shouting (-1 none) and until when. */
  parrot: number
  parrotT: number
  /** Wax (skid) until this time, per toy. */
  wax: number[]
  misses: number[]
  // Host only.
  cols: number
  rows: number
  // Visuals.
  vis: {
    patches: THREE.Mesh[]
    mats: THREE.MeshStandardMaterial[]
    inks: THREE.Mesh[]
    inkMats: THREE.MeshBasicMaterial[]
    crayons: THREE.Group[]
    crayonMats: THREE.MeshStandardMaterial[]
    crayonY: number
    parrot: THREE.Group | null
    parrotHead: THREE.Object3D | null
    beak: THREE.Object3D | null
    bubble: THREE.Sprite | null
    bubbleTex: THREE.CanvasTexture | null
    bubbleKey: number
    plus: THREE.Sprite | null
    lastPh: number
    tickT: number
    waxMeshes: THREE.Mesh[]
  }
}

function gridSize(n: number) {
  if (n <= 6) return { cols: 3, rows: 3 }
  if (n <= 11) return { cols: 4, rows: 3 }
  return { cols: 4, rows: 4 }
}

function patchPos(st: { cols: number; rows: number }, i: number) {
  const cx = i % st.cols, cz = Math.floor(i / st.cols)
  return { x: (cx - (st.cols - 1) / 2) * SP, z: (cz - (st.rows - 1) / 2) * SP }
}

/** Is (x, z) on patch i? (A rounded-square test that matches the blob shapes.) */
function onPatch(st: CMState, i: number, x: number, z: number) {
  const p = patchPos(st, i)
  const u = Math.abs(x - p.x) / PR, v = Math.abs(z - p.z) / PR
  return u * u * u * u + v * v * v * v < 0.82
}

function patchAt(st: CMState, x: number, z: number) {
  for (let i = 0; i < st.col.length; i++) if (st.col[i] >= 0 && onPatch(st, i, x, z)) return i
  return -1
}

/** The colour a patch shows right now (a smudge overrides it for the call). */
function shown(st: CMState, i: number) {
  return st.smudge[i] >= 0 ? st.smudge[i] : st.col[i]
}

function callTime(cycle: number) {
  return Math.max(2.8, 5.6 - cycle * 0.35)
}

function setPh(ctx: LevelCtx, st: CMState, ph: Ph, dur: number) {
  st.ph = ph
  st.pt = ctx.time
  st.dur = dur
}

/** New colours for the live patches; the next answer is placed on a few of them. */
function recolour(ctx: LevelCtx, st: CMState) {
  const live = st.col.map((c, i) => (c >= 0 ? i : -1)).filter((i) => i >= 0)
  const mixed = st.cycle >= 2 && ctx.rng.chance(Math.min(0.65, 0.3 + st.cycle * 0.06))
  if (mixed) {
    const m = ctx.rng.pick(MIXES)
    st.target = m.r
    st.callA = m.a
    st.callB = m.b
  } else {
    st.target = ctx.rng.int(0, 6)
    st.callA = st.target
    st.callB = -2
  }
  const active = ctx.active().length || ctx.toys.length
  const k = Math.max(1, Math.min(live.length - 2, Math.ceil(active / (3.6 + st.cycle * 0.55))))
  // Decoys: the mix's ingredients are on the page too, to catch the hasty.
  const others = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => c !== st.target)
  ctx.rng.shuffle(others)
  if (st.callB !== -2) {
    for (const c of [st.callA, st.callB]) {
      if (c < 0) continue
      others.splice(others.indexOf(c), 1)
      others.unshift(c)
    }
  }
  const order = ctx.rng.shuffle(live.slice())
  order.forEach((p, j) => {
    st.col[p] = j < k ? st.target : others[(j - k) % Math.min(5, others.length)]
  })
  st.smudge.fill(-1)
}

/* ---------------- Painting & props ---------------- */

function pageTexture() {
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#fbf8ef'
    g.fillRect(0, 0, w, h)
    // Faint drawings in the margins, like a colouring book.
    g.strokeStyle = 'rgba(60,50,40,0.18)'
    g.lineWidth = 5
    for (let i = 0; i < 9; i++) {
      const x = 60 + ((i * 337) % 900), y = 60 + ((i * 211) % 900)
      g.beginPath()
      if (i % 3 === 0) g.arc(x, y, 34, 0, Math.PI * 2)
      else if (i % 3 === 1) {
        for (let k = 0; k <= 10; k++) {
          const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? 16 : 40
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
        }
      } else {
        g.moveTo(x - 40, y + 20)
        g.quadraticCurveTo(x, y - 40, x + 40, y + 20)
        g.lineTo(x - 40, y + 20)
      }
      g.stroke()
    }
    g.strokeStyle = 'rgba(80,120,200,0.14)'
    g.lineWidth = 2
    for (let y = 40; y < h; y += 48) {
      g.beginPath()
      g.moveTo(0, y)
      g.lineTo(w, y)
      g.stroke()
    }
  }, { repeat: [1, 1] })
}

/** Waxy white strokes on transparent: tinted per patch by the material colour. */
function waxTexture(seed: number) {
  return canvasTex(256, 256, (g) => {
    scribble(g, 0, 0, 256, 256, '#ffffff', { density: 1.15, seed, width: 16, angle: -0.6 })
  })
}

function inkTexture() {
  return canvasTex(256, 256, (g) => {
    g.globalAlpha = 1
    scribble(g, 0, 0, 256, 256, '#26221f', { density: 1.4, seed: 99, width: 12, angle: 0.5 })
    scribble(g, 0, 0, 256, 256, '#26221f', { density: 0.8, seed: 7, width: 9, angle: -0.9 })
  })
}

function crayonMesh(mat: THREE.MeshStandardMaterial, label: THREE.Texture) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 4, 14), mat)
  body.position.y = 2
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 2.6, 14, 1, true), new THREE.MeshStandardMaterial({ map: label, roughness: 0.8 }))
  wrap.position.y = 1.8
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1, 14), mat)
  tip.position.y = 4.5
  g.add(body, wrap, tip)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

function parrotMesh() {
  const g = new THREE.Group()
  const m = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, flatShading: true })
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), m('#22c55e'))
  body.scale.set(0.85, 1.25, 0.9)
  body.position.y = 1
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), m('#fde047'))
  belly.scale.set(0.8, 1.1, 0.5)
  belly.position.set(0, 0.9, 0.42)
  const head = new THREE.Group()
  head.position.set(0, 2, 0.1)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), m('#ef4444'))
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 8), m('#f59e0b'))
  beak.rotation.x = Math.PI / 2 + 0.5
  beak.position.set(0, -0.1, 0.5)
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), m('#ffffff'))
    eye.position.set(sx * 0.27, 0.12, 0.36)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), m('#111827'))
    pupil.position.set(sx * 0.3, 0.13, 0.46)
    head.add(eye, pupil)
  }
  head.add(skull, beak)
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), m('#3b82f6'))
    wing.scale.set(0.3, 1, 0.75)
    wing.position.set(sx * 0.6, 1.05, -0.05)
    wing.rotation.z = sx * 0.2
    g.add(wing)
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.4, 6), m('#2563eb'))
  tail.position.set(0, 0.2, -0.55)
  tail.rotation.x = -2.6
  g.add(body, belly, head, tail)
  g.userData.head = head
  g.userData.beak = beak
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

function paintBubble(tex: THREE.CanvasTexture, col: number) {
  const c = tex.image as HTMLCanvasElement
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffffff'
  roundRect(g, 8, 8, c.width - 16, c.height - 50, 30)
  g.fill()
  g.beginPath()
  g.moveTo(60, c.height - 44)
  g.lineTo(40, c.height - 6)
  g.lineTo(100, c.height - 44)
  g.fill()
  g.fillStyle = '#6b7280'
  g.font = '700 28px ui-rounded, system-ui, sans-serif'
  g.textAlign = 'center'
  g.fillText('Squawk! Pick…', c.width / 2, 50)
  g.fillStyle = colHex(col)
  g.font = '900 64px ui-rounded, system-ui, sans-serif'
  g.fillText(`${colName(col)}!`, c.width / 2, 118)
  tex.needsUpdate = true
}

/* ---------------- Level ---------------- */

export default defineLevel<CMState>({
  id: 'crayon-match',
  name: 'Crayon Match',
  type: 'logic',
  blurb: 'A crayon calls a colour. Get onto it before the rest of the page is scribbled out.',
  howTo: [
    'Watch the big crayon: stand on a patch of the colour it calls',
    'Mixes: BLUE + YELLOW means stand on GREEN',
    'The parrot lies! Only the crayon counts',
    'Shove others off your patch. Fewer patches every round',
  ],
  accent: '#f97316',
  players: [2, 16],
  duration: 100,
  camera: { kind: 'overhead', height: 15, back: 10.5, follow: 0.3 },
  introOrbit: { radius: 15, height: 11 },
  sprinkles: { start: 1 },
  sky: { color: '#24180f', fogNear: 45, fogFar: 120 },

  tricks: [
    {
      id: 'smudge',
      name: 'Smudge',
      icon: 'milk',
      cost: 3,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: "Smudges the patch they're standing on into another colour until the call ends.",
      counter: 'Keep a second patch in mind, and move the moment yours changes.',
      can: (ctx, s, _u, target) => {
        if (s.ph !== CALL) return 'Only during a call'
        if (s.dur - (ctx.time - s.pt) < 1.3) return 'Too late'
        return target && patchAt(s, target.pos.x, target.pos.z) >= 0 ? true : 'They are not on a patch'
      },
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const p = patchAt(s, target.pos.x, target.pos.z)
        if (p < 0) return
        let c = ctx.rng.int(0, 8)
        if (c === s.target) c = (c + 1 + ctx.rng.int(0, 6)) % 8
        if (c === s.target) c = (c + 1) % 8
        s.smudge[p] = c
        const pp = patchPos(s, p)
        ctx.fx.puff({ x: pp.x, y: 0.3, z: pp.z }, 'milk', 16)
        ctx.fx.sfx('splash', target.pos)
        ctx.fx.popup(target, 'Smudged!', colHex(c))
        for (const t of ctx.toys) if (t.bot) t.data.goal = undefined
      },
      botUse: (ctx, s, user) => {
        if (s.ph !== CALL || s.dur - (ctx.time - s.pt) < 1.4) return false
        // Smudge the most crowded right patch that I'm not on.
        const mine = patchAt(s, user.pos.x, user.pos.z)
        let best = null as null | (typeof ctx.toys)[number]
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play') continue
          const p = patchAt(s, t.pos.x, t.pos.z)
          if (p >= 0 && p !== mine && shown(s, p) === s.target) best = t
        }
        return best ?? false
      },
    },
    {
      id: 'squawk',
      name: 'Parrot Squawk',
      icon: 'star',
      cost: 1,
      cooldown: 8,
      busy: 0.5,
      target: 'none',
      desc: 'The parrot shouts a fake colour for everyone to hear.',
      counter: 'Only the crayon counts. Ignore the parrot.',
      can: (_c, s) => (s.ph === IDLE || s.ph === CALL ? true : 'Wait for the next call'),
      apply: (ctx, s) => {
        let c = ctx.rng.int(0, 7)
        if (c === s.target) c = (c + 1) % 7
        s.parrot = c
        s.parrotT = ctx.time + 2.2
        ctx.fx.sfx('squawk')
        for (const t of ctx.toys) if (t.bot && ctx.rng.chance(0.55 - ctx.difficulty * 0.17)) t.data.fooled = c
      },
    },
    {
      id: 'wax',
      name: 'Wax Feet',
      icon: 'crumb',
      cost: 2,
      cooldown: 10,
      busy: 0.6,
      target: 'rival',
      range: 10,
      desc: 'Crayon wax on their feet: they skid about for 2.5 seconds.',
      counter: 'Steer early and gently, or stand still and wait it out.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.wax[target.idx] = ctx.time + 2.5
        ctx.fx.popup(target, 'Slippy!', '#fde68a')
        ctx.fx.sfx('squeak', target.pos)
      },
    },
    bubbleWrap<CMState>(2),
  ],

  build(ctx) {
    const { cols, rows } = gridSize(ctx.toys.length || 16)
    const hw = (cols * SP) / 2 + 1.6, hd = (rows * SP) / 2 + 1.6
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 22, hd: 22, ridge: 32, knee: 7, lights: ctx.quality === 'low' ? 24 : 48, quality: ctx.quality, solid: true })
    // The colouring book: a cover, the open page and a spiral binding.
    const cover = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.8, 0.25, hd * 2 + 0.8), new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.6 }))
    cover.position.y = -0.13
    cover.receiveShadow = true
    ctx.root.add(cover)
    const page = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hd * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: pageTexture(), roughness: 0.95 }))
    page.position.y = 0.005
    page.receiveShadow = true
    ctx.root.add(page)
    const ring = new THREE.TorusGeometry(0.32, 0.06, 6, 14)
    const rings = new THREE.InstancedMesh(ring, new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.8, roughness: 0.3 }), 18)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0))
    for (let i = 0; i < 18; i++) rings.setMatrixAt(i, m.compose(new THREE.Vector3(-hw - 0.1, 0.1, -hd + 0.6 + (i * (hd * 2 - 1.2)) / 17), q, new THREE.Vector3(1, 1, 1)))
    ctx.root.add(rings)
    // A low kerb so nobody wanders off the page.
    ctx.phys.walls(0, 0, hw, hd, 2, 0.4)
    // The crayon box (where the real calls come from) and the parrot's perch.
    const boxTex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#facc15'
      g.fillRect(0, 0, 256, 256)
      g.fillStyle = '#16a34a'
      g.beginPath()
      g.moveTo(0, 150)
      g.quadraticCurveTo(128, 90, 256, 150)
      g.lineTo(256, 256)
      g.lineTo(0, 256)
      g.fill()
      g.fillStyle = '#b91c1c'
      g.font = '900 54px ui-rounded, system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('CRAYONS', 128, 70)
      g.fillStyle = '#fff'
      g.font = '800 30px ui-rounded, system-ui, sans-serif'
      g.fillText('64 colours', 128, 215)
    })
    const box = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 2), new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.7 }))
    box.position.set(hw + 2.6, 1.7, 0)
    box.rotation.y = -Math.PI / 2
    box.castShadow = true
    ctx.root.add(box)
    const perch = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 2.6, 10), new THREE.MeshStandardMaterial({ color: '#92400e', roughness: 0.8 }))
    perch.position.set(-hw - 2.6, 1.3, 1)
    perch.castShadow = true
    ctx.root.add(perch)
  },

  init(ctx) {
    const n = ctx.toys.length || 16
    const { cols, rows } = gridSize(n)
    const np = cols * rows
    const st: CMState = {
      ph: RESET, pt: 0, dur: 1, cycle: 0, target: 0, callA: 0, callB: -2, col: new Array(np).fill(0), smudge: new Array(np).fill(-1), parrot: -1, parrotT: 0,
      wax: new Array(n).fill(0), misses: new Array(n).fill(0), cols, rows,
      vis: {
        patches: [], mats: [], inks: [], inkMats: [], crayons: [], crayonMats: [], crayonY: -6, parrot: null, parrotHead: null, beak: null, bubble: null, bubbleTex: null,
        bubbleKey: -9, plus: null, lastPh: -1, tickT: 0, waxMeshes: [],
      },
    }
    // Starting colours (seeded so every screen draws the same first page).
    const r0 = makeRng(ctx.seed ^ 0xc0ffee)
    for (let i = 0; i < np; i++) st.col[i] = r0.int(0, 8)
    const waxes = [waxTexture(3), waxTexture(11), waxTexture(29)]
    const ink = inkTexture()
    for (let i = 0; i < np; i++) {
      const p = patchPos(st, i)
      const shape = blobShape(r0, 0, 0, PR, PR, 30, 0.07)
      const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)
      // UVs from positions so the wax texture covers the blob.
      const pos = geo.attributes.position, uv = geo.attributes.uv
      for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / (PR * 2) + 0.5, pos.getZ(k) / (PR * 2) + 0.5)
      const outline = new THREE.Mesh(new THREE.ShapeGeometry(blobShape(makeRng(i + 5), 0, 0, PR + 0.12, PR + 0.12, 30, 0.07)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#2b2622' }))
      outline.position.set(p.x, 0.012, p.z)
      ctx.root.add(outline)
      const mat = new THREE.MeshStandardMaterial({ map: waxes[i % 3], color: COLS[st.col[i]].c, roughness: 0.75, transparent: true, emissive: '#ffffff', emissiveIntensity: 0 })
      const patch = new THREE.Mesh(geo, mat)
      patch.position.set(p.x, 0.02, p.z)
      patch.receiveShadow = true
      ctx.root.add(patch)
      st.vis.patches.push(patch)
      st.vis.mats.push(mat)
      const inkMat = new THREE.MeshBasicMaterial({ map: ink, transparent: true, opacity: 0, depthWrite: false })
      const inkM = new THREE.Mesh(geo, inkMat)
      inkM.position.set(p.x, 0.03, p.z)
      ctx.root.add(inkM)
      st.vis.inks.push(inkM)
      st.vis.inkMats.push(inkMat)
    }
    // The calling crayons (two, for mixes) rise out of the box.
    const hw = (cols * SP) / 2 + 1.6
    for (let k = 0; k < 2; k++) {
      const mat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.45, emissive: '#000000' })
      const label = canvasTex(256, 64, (g) => {
        g.fillStyle = '#f8fafc'
        g.fillRect(0, 0, 256, 64)
        g.fillStyle = '#111'
        g.fillRect(0, 6, 256, 4)
        g.fillRect(0, 54, 256, 4)
        g.font = '900 30px ui-rounded, system-ui, sans-serif'
        g.textAlign = 'center'
        g.fillText('~ CRAYON ~', 128, 42)
      })
      const c = crayonMesh(mat, label)
      c.position.set(hw + 2.6 + (k ? 0.6 : -0.6), -6, k ? 0.6 : -0.6)
      ctx.root.add(c)
      st.vis.crayons.push(c)
      st.vis.crayonMats.push(mat)
    }
    const plus = textSprite('+', { color: '#ffffff', size: 1.4 })
    plus.visible = false
    ctx.root.add(plus)
    st.vis.plus = plus
    const parrot = parrotMesh()
    parrot.position.set(-hw - 2.6, 2.6, 1)
    parrot.rotation.y = Math.PI / 2
    ctx.root.add(parrot)
    st.vis.parrot = parrot
    st.vis.parrotHead = parrot.userData.head as THREE.Object3D
    st.vis.beak = parrot.userData.beak as THREE.Object3D
    const bubbleTex = canvasTex(320, 180, () => {})
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false }))
    bubble.scale.set(4, 2.25, 1)
    bubble.position.set(-hw - 1.6, 5, 1)
    bubble.visible = false
    ctx.root.add(bubble)
    st.vis.bubble = bubble
    st.vis.bubbleTex = bubbleTex
    const waxMat = new THREE.MeshBasicMaterial({ color: '#fef3c7', transparent: true, opacity: 0.7, depthWrite: false })
    for (let i = 0; i < n; i++) {
      const w = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.6, 16).rotateX(-Math.PI / 2), waxMat)
      w.visible = false
      ctx.root.add(w)
      st.vis.waxMeshes.push(w)
    }
    return st
  },

  spawn(ctx, st, _toy, i) {
    // Spread out over the patches.
    const np = st.cols * st.rows
    const p = patchPos(st, (i * 7) % np)
    const k = Math.floor(i / np)
    return { x: p.x + (k % 2 ? 0.6 : -0.6) * (k > 0 ? 1 : 0), y: 0, z: p.z + (k > 1 ? 0.6 : 0), yaw: ctx.rng.range(-Math.PI, Math.PI) }
  },

  start(ctx, st) {
    setPh(ctx, st, RESET, 0.8)
  },

  tick(ctx, st) {
    const t = ctx.time
    const el = t - st.pt
    if (st.parrot >= 0 && t > st.parrotT) st.parrot = -1
    if (el >= st.dur) {
      if (st.ph === RESET) {
        recolour(ctx, st)
        setPh(ctx, st, IDLE, Math.max(1.4, 2.6 - st.cycle * 0.15))
        // The parrot fakes a call more and more often.
        if (ctx.rng.chance(Math.min(0.85, 0.25 + st.cycle * 0.12))) {
          let c = ctx.rng.int(0, 7)
          if (c === st.target) c = (c + 2) % 7
          st.parrot = c
          st.parrotT = t + 1.8
          ctx.fx.sfx('squawk')
          for (const toy of ctx.toys) if (toy.bot && ctx.rng.chance(0.4 - ctx.difficulty * 0.12)) toy.data.fooled = c
        }
      } else if (st.ph === IDLE) {
        setPh(ctx, st, CALL, callTime(st.cycle))
        ctx.fx.sfx('whoosh')
        ctx.fx.say(st.callB === -2 ? `${colName(st.target)}!` : `${colName(st.callA)} + ${colName(st.callB)}`, st.callB === -2 ? colHex(st.target) : '#fef3c7', 1.5)
      } else if (st.ph === CALL) {
        setPh(ctx, st, SCRIBBLE, 1.3)
        ctx.fx.sfx('crunch')
      } else if (st.ph === SCRIBBLE) {
        // Anyone not on a right patch is scribbled out.
        for (const toy of ctx.active()) {
          const p = patchAt(st, toy.pos.x, toy.pos.z)
          if (p >= 0 && shown(st, p) === st.target && toy.feet > -0.5) {
            ctx.addSprinkles(toy, 1)
            continue
          }
          st.misses[toy.idx]++
          ctx.fx.puff(toy.pos, 'stuff', 12)
          ctx.knock(toy, { x: ctx.rng.range(-2, 2), y: 6, z: ctx.rng.range(-2, 2) }, 1)
          ctx.fail(toy, 'scribbled out')
        }
        // Some patches go for good.
        const live = st.col.map((c, i) => (c >= 0 ? i : -1)).filter((i) => i >= 0)
        const drop = Math.min(live.length - 3, Math.max(1, Math.round(live.length * 0.16)))
        for (const p of ctx.rng.shuffle(live).slice(0, Math.max(0, drop))) st.col[p] = -1
        st.cycle++
        setPh(ctx, st, RESET, 1.2)
      }
    }
    // Wax: skid (keep most of the old velocity, so steering barely bites).
    for (const toy of ctx.toys) {
      const d = toy.data as { wx?: number; wz?: number }
      if (st.wax[toy.idx] > t && toy.grounded && toy.status === 'play') {
        const v = toy.body.linvel()
        const nx = (d.wx ?? v.x) * 0.97 + (v.x - (d.wx ?? v.x)) * 0.08
        const nz = (d.wz ?? v.z) * 0.97 + (v.z - (d.wz ?? v.z)) * 0.08
        toy.body.setLinvel({ x: nx, y: v.y, z: nz }, true)
        d.wx = nx
        d.wz = nz
      } else {
        d.wx = toy.vel.x
        d.wz = toy.vel.z
      }
    }
  },

  retry(ctx, st, toy) {
    // Quick Play: back onto a right patch, a little dazed.
    const right = st.col.map((c, i) => (c === st.target ? i : -1)).filter((i) => i >= 0)
    const p = patchPos(st, right.length ? ctx.rng.pick(right) : 0)
    ctx.respawn(toy, { x: p.x, y: 0.3, z: p.z, yaw: 0 }, 1)
  },

  onTimeUp(ctx) {
    if (ctx.mode === 'show') for (const t of ctx.active()) ctx.qualify(t, 'survived')
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => st.misses[a.idx] - st.misses[b.idx])
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { goal?: number; decideAt?: number; callPt?: number; fooled?: number; colour?: number; wander?: number; wx2?: number; wz2?: number }
    if (st.ph === CALL && d.callPt !== st.pt) {
      d.callPt = st.pt
      d.goal = undefined
      d.decideAt = st.pt + sk.reaction * ctx.rng.range(0.9, 1.8) + (st.callB !== -2 ? 0.4 : 0)
      // Work out the colour: mixes trip up weaker bots; a fooled bot may stick with the parrot.
      let c = st.target
      if (st.callB !== -2 && !ctx.rng.chance(sk.accuracy * 0.92)) c = st.callA
      if (d.fooled !== undefined && d.fooled >= 0 && ctx.rng.chance((1 - sk.accuracy) * 1.6)) c = d.fooled
      d.colour = c
      d.fooled = undefined
    }
    if (st.ph === CALL && ctx.time >= (d.decideAt ?? 0)) {
      const goalOk = d.goal !== undefined && d.goal >= 0 && shown(st, d.goal) === d.colour
      if (!goalOk) {
        let best = -1, bs = Infinity
        for (let i = 0; i < st.col.length; i++) {
          if (st.col[i] < 0 || shown(st, i) !== d.colour) continue
          const p = patchPos(st, i)
          let crowd = 0
          for (const o of ctx.toys) if (o !== toy && o.status === 'play' && onPatch(st, i, o.pos.x, o.pos.z)) crowd++
          const sc = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z) + crowd * 1.6
          if (sc < bs) {
            bs = sc
            best = i
          }
        }
        d.goal = best
      }
    }
    let gx = toy.pos.x, gz = toy.pos.z
    if ((st.ph === CALL || st.ph === SCRIBBLE) && d.goal !== undefined && d.goal >= 0) {
      const p = patchPos(st, d.goal)
      gx = p.x + ((toy.idx % 3) - 1) * 0.45
      gz = p.z + ((Math.floor(toy.idx / 3) % 3) - 1) * 0.45
    } else if (st.ph === IDLE || st.ph === RESET) {
      // Drift towards the middle of the page so every patch is in reach; a fooled bot drifts to the parrot's colour.
      if (d.wander === undefined || ctx.time > d.wander) {
        d.wander = ctx.time + ctx.rng.range(1, 2.5)
        let tgt = -1
        if (d.fooled !== undefined && d.fooled >= 0) tgt = st.col.findIndex((c) => c === d.fooled)
        const live = st.col.map((c, i) => (c >= 0 ? i : -1)).filter((i) => i >= 0)
        const p = patchPos(st, tgt >= 0 ? tgt : live.length ? ctx.rng.pick(live) : 0)
        d.wx2 = p.x * 0.5
        d.wz2 = p.z * 0.5
      }
      gx = d.wx2 ?? 0
      gz = d.wz2 ?? 0
    }
    steerTo(toy, gx, gz, { pace: st.ph === CALL ? sk.pace : 0.45, stop: st.ph === CALL ? 0.25 : 0.6 })
    avoidWalls(ctx, toy)
    // Crowded right patch near the end of the call: shove someone off.
    if (st.ph === CALL && st.dur - (ctx.time - st.pt) < 1.5) {
      for (const o of ctx.toys) {
        if (o === toy || o.status !== 'play' || o.pos.distanceTo(toy.pos) > 1.3) continue
        if (ctx.rng.chance(sk.aggression * 2 * dt)) bully(toy, o)
        break
      }
    }
  },

  pack(_c, st) {
    return [st.ph, Math.round(st.pt * 100) / 100, Math.round(st.dur * 100) / 100, st.cycle, st.target, st.callA, st.callB, st.col, st.smudge, st.parrot, Math.round(st.parrotT * 10) / 10, st.wax.map((w) => Math.round(w * 10) / 10), st.misses]
  },

  unpack(_c, st, d) {
    const a = d as [Ph, number, number, number, number, number, number, number[], number[], number, number, number[], number[]]
    ;[st.ph, st.pt, st.dur, st.cycle, st.target, st.callA, st.callB] = a
    st.col = a[7]
    st.smudge = a[8]
    st.parrot = a[9]
    st.parrotT = a[10]
    st.wax = a[11]
    st.misses = a[12]
  },

  visual(ctx, st, dt) {
    const v = st.vis
    const t = ctx.time
    const el = t - st.pt
    const playing = ctx.phase === 'play'
    const tmp = _col
    for (let i = 0; i < v.patches.length; i++) {
      const c = shown(st, i)
      const dead = st.col[i] < 0
      const mat = v.mats[i]
      tmp.set(dead ? '#3f3a36' : colHex(c))
      mat.color.lerp(tmp, Math.min(1, dt * 12))
      // The right patches glow a little once the scribbling starts.
      const right = !dead && c === st.target && (st.ph === SCRIBBLE || st.ph === RESET)
      mat.emissive.copy(mat.color)
      mat.emissiveIntensity = right ? 0.35 + Math.sin(t * 10) * 0.1 : 0
      // Scribble-out: wrong patches get covered in graphite.
      const im = v.inkMats[i]
      let want = dead ? 0.9 : 0
      if (playing && st.ph === SCRIBBLE && !dead && c !== st.target) want = Math.min(0.95, el / st.dur * 1.4)
      if (playing && st.ph === RESET && !dead && c !== st.target) want = Math.max(0, 0.95 - el * 2)
      im.opacity = want
      v.inks[i].visible = want > 0.01
      v.inks[i].scale.setScalar(0.4 + Math.min(1, want * 1.2) * 0.6)
      v.inks[i].rotation.y = dead ? 0 : el * 0.5
    }
    // The calling crayons.
    const mixed = st.callB !== -2
    const up = playing && (st.ph === CALL || st.ph === SCRIBBLE)
    v.crayonY += ((up ? 1.4 : -6) - v.crayonY) * Math.min(1, dt * 6)
    v.crayons.forEach((c, k) => {
      const col = k === 0 ? st.callA : st.callB
      const on = k === 0 || mixed
      c.visible = on && v.crayonY > -5.5
      c.position.y = v.crayonY + (k ? 0.3 : 0)
      c.rotation.z = mixed ? (k ? -0.25 : 0.25) : Math.sin(t * 2) * 0.05
      v.crayonMats[k].color.set(colHex(col))
      v.crayonMats[k].emissive.set(colHex(col))
      v.crayonMats[k].emissiveIntensity = up ? 0.25 : 0
    })
    if (v.plus) {
      v.plus.visible = mixed && up
      const c0 = v.crayons[0].position
      v.plus.position.set(c0.x, v.crayonY + 6.4, c0.z + 0.6)
    }
    // The parrot: bobs, and squawks its fake call.
    if (v.parrot && v.parrotHead && v.beak) {
      const squawk = st.parrot >= 0 && playing
      v.parrot.position.y = 2.6 + Math.abs(Math.sin(t * (squawk ? 9 : 2))) * (squawk ? 0.35 : 0.08)
      v.parrotHead.rotation.z = squawk ? Math.sin(t * 14) * 0.3 : Math.sin(t * 1.3) * 0.15
      v.beak.rotation.x = Math.PI / 2 + 0.5 + (squawk ? Math.abs(Math.sin(t * 20)) * 0.5 : 0)
      if (v.bubble && v.bubbleTex) {
        v.bubble.visible = squawk
        if (squawk && v.bubbleKey !== st.parrot) {
          paintBubble(v.bubbleTex, st.parrot)
          v.bubbleKey = st.parrot
        }
      }
    }
    // Ticks during the call.
    if (playing && st.ph === CALL) {
      v.tickT -= dt
      if (v.tickT <= 0) {
        v.tickT = st.dur - el < 1.5 ? 0.25 : 0.5
        ctx.fxLocal.sfx('tick')
      }
    }
    if (playing && st.ph !== v.lastPh) {
      if (st.ph === SCRIBBLE) ctx.fxLocal.shake(0.2)
      v.lastPh = st.ph
    }
    for (const toy of ctx.toys) {
      const w = v.waxMeshes[toy.idx]
      if (!w) continue
      w.visible = playing && st.wax[toy.idx] > t && toy.status === 'play'
      if (w.visible) w.position.set(toy.pos.x, toy.feet + 0.04, toy.pos.z)
    }
  },

  hud(ctx, st, me) {
    if (ctx.phase !== 'play') return { chips: ['Only the crayon counts!'] }
    const el = ctx.time - st.pt
    const left = Math.max(0, st.dur - el)
    const live = st.col.filter((c) => c >= 0).length
    const mixed = st.callB !== -2
    const call = mixed ? `${colName(st.callA)} + ${colName(st.callB)} = ?` : colName(st.target)
    const status =
      st.ph === CALL
        ? { text: `CRAYON: ${call}`, color: mixed ? '#fef3c7' : colHex(st.target), pulse: left < 1.5 }
        : st.ph === SCRIBBLE
          ? { text: 'SCRIBBLE!', color: '#d6d3d1', pulse: true }
          : st.parrot >= 0
            ? { text: `Parrot: "${colName(st.parrot)}!"`, color: '#86efac' }
            : { text: 'WATCH THE CRAYON', color: '#fde68a' }
    const chips = [`Round ${st.cycle + 1}`, `${live} patches`]
    if (ctx.mode === 'quick' && me) chips.push(`Misses: ${st.misses[me.idx] ?? 0}`)
    let prompt: string | undefined
    if (me?.status === 'play') {
      if (st.wax[me.idx] > ctx.time) prompt = 'Waxy feet! Steer gently.'
      else if (st.ph === CALL && mixed) prompt = `Mix it: ${colName(st.callA)} + ${colName(st.callB)} makes… which colour?`
      else if (st.ph === CALL) prompt = `Get onto ${colName(st.target)}! Shove others off if it is crowded.`
      else if (st.parrot >= 0) prompt = "The parrot lies! Wait for the crayon."
    }
    const bars = st.ph === CALL ? [{ label: 'Call', value: left / st.dur, color: mixed ? '#fde68a' : colHex(st.target), danger: left < 1.5 }] : []
    return { status, chips, prompt, bars }
  },
})

const _col = new THREE.Color()
