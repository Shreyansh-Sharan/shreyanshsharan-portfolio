// Block Memory (logic). A grid of giant alphabet blocks sits on top of a deep toy box. Each round the block tops
// light up with a pattern (colours, then letters, then animals), the lights go out, and a symbol is called:
// stand on a block that showed it before the timer ends. Every other block drops into the box, and so does
// anyone standing on one. Safe blocks get scarcer and the pattern shows for less time each round, so the last
// seconds are a shoving match on the few safe tops. Dirty tricks: flash a fake pattern on a rival's screen,
// cover their eyes while the pattern shows, or glue their feet during the call.
import * as THREE from 'three'
import { avoidWalls, bully, skill, steerTo } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { canvasTex, roundRect } from '../engine/paint'
import { makeRng } from '../engine/rng'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx } from '../engine/types'

const BS = 2.3 // block size (metres)
const GAP = 0.1
const WALL_H = 2.6
const SHAKE = 0.6
const _dir = new THREE.Vector3()

/** Round phases: the pattern shows, lights out, the call, wrong blocks drop, blocks rise back. */
const SHOW = 0, DARK = 1, CALL = 2, DROP = 3, RESET = 4
type Ph = 0 | 1 | 2 | 3 | 4

const COLOURS = [
  { name: 'RED', c: '#ef4444' },
  { name: 'BLUE', c: '#3b82f6' },
  { name: 'YELLOW', c: '#facc15' },
  { name: 'GREEN', c: '#22c55e' },
  { name: 'PURPLE', c: '#a855f7' },
  { name: 'ORANGE', c: '#f97316' },
]
const LETTERS = ['A', 'B', 'D', 'K', 'M', 'R', 'S', 'Z']
const LETTER_COLS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777', '#0891b2', '#65a30d']
const ANIMALS = ['CAT', 'FISH', 'BIRD', 'SNAIL', 'FROG', 'PIG', 'BUNNY', 'TURTLE']
const ANIMAL_EMOJI = ['🐱', '🐟', '🐦', '🐌', '🐸', '🐷', '🐰', '🐢']
const SET_NAMES = ['Colours', 'Letters', 'Animals']

/** Atlas cells (6×6): 0 blank, 1..6 colours, 7..14 letters, 15..22 animals. */
const CELLS = 6
const cellOf = (set: number, sym: number) => (sym < 0 ? 0 : set === 0 ? 1 + sym : set === 1 ? 7 + sym : 15 + sym)

function symName(set: number, sym: number) {
  if (sym < 0) return '?'
  return set === 0 ? COLOURS[sym].name : set === 1 ? LETTERS[sym] : ANIMALS[sym]
}
function symColor(set: number, sym: number) {
  if (sym < 0) return '#fde68a'
  return set === 0 ? COLOURS[sym].c : set === 1 ? LETTER_COLS[sym] : '#fde68a'
}

interface BMState {
  ph: Ph
  pt: number
  dur: number
  cycle: number
  set: number
  target: number
  /** Symbol per block for this cycle. */
  sym: number[]
  /** Glue (slow feet) until this round time, per toy. */
  glue: number[]
  misses: number[]
  // Host only.
  cols: number
  rows: number
  // Visuals (every screen).
  vis: {
    tops: THREE.Mesh[]
    topTex: THREE.Texture[]
    sides: THREE.InstancedMesh[]
    sideOf: { mesh: number; slot: number }[]
    shown: number[]
    /** Blocks that dropped this cycle (they rise back in the reset). */
    dropped: boolean[]
    callSigns: THREE.Sprite[]
    callTex: THREE.CanvasTexture | null
    callKey: string
    fakeT: number
    fake: number[]
    blindT: number
    paw: THREE.Object3D | null
    glueMeshes: THREE.Mesh[]
    lastPh: number
    tickT: number
  }
}

/* ---------------- Painting ---------------- */

function drawAnimal(g: CanvasRenderingContext2D, i: number, cx: number, cy: number, s: number) {
  const P = (x: number, y: number) => [cx + x * s, cy + y * s] as const
  const circle = (x: number, y: number, r: number, fill: string) => {
    g.fillStyle = fill
    g.beginPath()
    g.arc(...P(x, y), r * s, 0, Math.PI * 2)
    g.fill()
  }
  const ell = (x: number, y: number, rx: number, ry: number, fill: string, rot = 0) => {
    g.fillStyle = fill
    g.beginPath()
    g.ellipse(...P(x, y), rx * s, ry * s, rot, 0, Math.PI * 2)
    g.fill()
  }
  const tri = (pts: [number, number][], fill: string) => {
    g.fillStyle = fill
    g.beginPath()
    pts.forEach(([x, y], k) => (k ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y))))
    g.closePath()
    g.fill()
  }
  const eye = (x: number, y: number) => {
    circle(x, y, 0.07, '#ffffff')
    circle(x + 0.01, y + 0.01, 0.04, '#1c1917')
  }
  g.lineWidth = s * 0.03
  g.strokeStyle = '#1c1917'
  switch (i) {
    case 0: // cat
      tri([[-0.42, -0.1], [-0.36, -0.55], [-0.08, -0.32]], '#fb923c')
      tri([[0.42, -0.1], [0.36, -0.55], [0.08, -0.32]], '#fb923c')
      circle(0, 0.05, 0.42, '#fb923c')
      eye(-0.15, -0.02)
      eye(0.15, -0.02)
      tri([[-0.06, 0.12], [0.06, 0.12], [0, 0.2]], '#f472b6')
      g.beginPath()
      for (const sd of [-1, 1]) for (const dy of [0.16, 0.24]) {
        g.moveTo(...P(sd * 0.12, dy))
        g.lineTo(...P(sd * 0.5, dy + (dy - 0.2)))
      }
      g.stroke()
      break
    case 1: // fish
      tri([[0.25, 0], [0.62, -0.3], [0.62, 0.3]], '#38bdf8')
      ell(-0.05, 0, 0.45, 0.3, '#0ea5e9')
      tri([[-0.05, -0.28], [0.15, -0.45], [0.2, -0.22]], '#38bdf8')
      eye(-0.28, -0.06)
      break
    case 2: // bird
      ell(0.05, 0.12, 0.4, 0.32, '#facc15')
      circle(-0.25, -0.2, 0.22, '#facc15')
      tri([[-0.45, -0.22], [-0.65, -0.14], [-0.44, -0.1]], '#f97316')
      ell(0.12, 0.1, 0.22, 0.14, '#eab308', -0.4)
      eye(-0.28, -0.24)
      g.beginPath()
      g.moveTo(...P(-0.02, 0.42))
      g.lineTo(...P(-0.05, 0.6))
      g.moveTo(...P(0.14, 0.42))
      g.lineTo(...P(0.12, 0.6))
      g.stroke()
      break
    case 3: { // snail
      ell(-0.05, 0.36, 0.55, 0.13, '#86efac')
      circle(0.08, 0.02, 0.36, '#b45309')
      g.strokeStyle = '#fde68a'
      g.lineWidth = s * 0.05
      g.beginPath()
      for (let k = 0; k < 60; k++) {
        const a = k * 0.22, r = 0.3 - k * 0.0048
        const p = P(0.08 + Math.cos(a) * r, 0.02 + Math.sin(a) * r)
        if (k) g.lineTo(...p)
        else g.moveTo(...p)
      }
      g.stroke()
      g.strokeStyle = '#1c1917'
      g.lineWidth = s * 0.03
      g.beginPath()
      g.moveTo(...P(-0.48, 0.3))
      g.lineTo(...P(-0.56, -0.02))
      g.moveTo(...P(-0.4, 0.3))
      g.lineTo(...P(-0.38, -0.02))
      g.stroke()
      circle(-0.56, -0.04, 0.05, '#1c1917')
      circle(-0.38, -0.04, 0.05, '#1c1917')
      break
    }
    case 4: // frog
      ell(0, 0.12, 0.52, 0.36, '#22c55e')
      circle(-0.24, -0.2, 0.17, '#22c55e')
      circle(0.24, -0.2, 0.17, '#22c55e')
      eye(-0.24, -0.22)
      eye(0.24, -0.22)
      g.beginPath()
      g.arc(...P(0, 0.08), 0.26 * s, 0.2, Math.PI - 0.2)
      g.stroke()
      break
    case 5: // pig
      tri([[-0.4, -0.18], [-0.34, -0.5], [-0.12, -0.34]], '#f9a8d4')
      tri([[0.4, -0.18], [0.34, -0.5], [0.12, -0.34]], '#f9a8d4')
      circle(0, 0.05, 0.43, '#f9a8d4')
      ell(0, 0.14, 0.17, 0.12, '#f472b6')
      circle(-0.06, 0.14, 0.035, '#831843')
      circle(0.06, 0.14, 0.035, '#831843')
      eye(-0.17, -0.08)
      eye(0.17, -0.08)
      break
    case 6: // bunny
      ell(-0.14, -0.4, 0.1, 0.3, '#e7e5e4', -0.15)
      ell(0.14, -0.4, 0.1, 0.3, '#e7e5e4', 0.15)
      ell(-0.14, -0.4, 0.05, 0.2, '#f9a8d4', -0.15)
      ell(0.14, -0.4, 0.05, 0.2, '#f9a8d4', 0.15)
      circle(0, 0.12, 0.36, '#e7e5e4')
      eye(-0.13, 0.06)
      eye(0.13, 0.06)
      circle(0, 0.2, 0.05, '#f472b6')
      break
    case 7: // turtle
      for (const [x, y] of [[-0.32, 0.28], [0.32, 0.28], [-0.22, 0.34], [0.22, 0.34]] as [number, number][]) circle(x, y, 0.09, '#4ade80')
      circle(-0.55, 0.12, 0.13, '#4ade80')
      g.fillStyle = '#15803d'
      g.beginPath()
      g.ellipse(...P(0, 0.2), 0.45 * s, 0.4 * s, 0, Math.PI, Math.PI * 2)
      g.fill()
      g.strokeStyle = '#bbf7d0'
      g.beginPath()
      g.moveTo(...P(-0.2, 0.2))
      g.lineTo(...P(-0.1, -0.12))
      g.lineTo(...P(0.1, -0.12))
      g.lineTo(...P(0.2, 0.2))
      g.stroke()
      g.fillStyle = '#1c1917'
      circle(-0.6, 0.08, 0.03, '#1c1917')
      break
  }
}

/** One canvas holds every symbol: colour gems, letters and animals, plus the blank (lights-out) top. */
function makeAtlas() {
  const S = 1024 / CELLS
  return canvasTex(1024, 1024, (g) => {
    const cell = (k: number, paint: (x: number, y: number) => void) => {
      const x = (k % CELLS) * S, y = Math.floor(k / CELLS) * S
      g.save()
      paint(x, y)
      g.restore()
    }
    const base = (x: number, y: number, fill: string, border = '#7c4a1e') => {
      g.fillStyle = border
      g.fillRect(x, y, S, S)
      g.fillStyle = fill
      roundRect(g, x + 8, y + 8, S - 16, S - 16, 18)
      g.fill()
    }
    // Blank: warm wood with a faint stitched star.
    cell(0, (x, y) => {
      base(x, y, '#d6a56b')
      g.strokeStyle = 'rgba(120,70,30,0.35)'
      g.lineWidth = 3
      for (let i = 0; i < 7; i++) {
        g.beginPath()
        g.moveTo(x + 12, y + 20 + i * 22)
        g.bezierCurveTo(x + S * 0.3, y + 14 + i * 22, x + S * 0.7, y + 30 + i * 22, x + S - 12, y + 18 + i * 22)
        g.stroke()
      }
      g.setLineDash([8, 7])
      g.strokeStyle = 'rgba(255,240,210,0.5)'
      g.beginPath()
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? S * 0.12 : S * 0.28
        const px = x + S / 2 + Math.cos(a) * r, py = y + S / 2 + Math.sin(a) * r
        if (i) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.stroke()
    })
    COLOURS.forEach((col, i) =>
      cell(1 + i, (x, y) => {
        base(x, y, col.c, '#fef3c7')
        const gr = g.createRadialGradient(x + S * 0.38, y + S * 0.34, 4, x + S / 2, y + S / 2, S * 0.5)
        gr.addColorStop(0, 'rgba(255,255,255,0.55)')
        gr.addColorStop(0.4, 'rgba(255,255,255,0)')
        g.fillStyle = gr
        g.fillRect(x + 8, y + 8, S - 16, S - 16)
      }),
    )
    LETTERS.forEach((l, i) =>
      cell(7 + i, (x, y) => {
        base(x, y, '#fff7e6', LETTER_COLS[i])
        g.fillStyle = LETTER_COLS[i]
        g.font = `900 ${Math.round(S * 0.72)}px ui-rounded, system-ui, sans-serif`
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(l, x + S / 2, y + S / 2 + S * 0.05)
      }),
    )
    const pastel = ['#fde68a', '#bae6fd', '#fef9c3', '#d9f99d', '#bbf7d0', '#fce7f3', '#e0e7ff', '#ccfbf1']
    ANIMALS.forEach((_a, i) =>
      cell(15 + i, (x, y) => {
        base(x, y, pastel[i], '#7c4a1e')
        drawAnimal(g, i, x + S / 2, y + S / 2, S * 0.62)
      }),
    )
  })
}

/** Block sides: a wooden alphabet block face with a carved letter (six variants, tinted panels). */
function sideTexture(letter: string, panel: string) {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#e8c08a'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = panel
    roundRect(g, 12, 12, 104, 104, 14)
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,0.6)'
    g.lineWidth = 3
    roundRect(g, 18, 18, 92, 92, 10)
    g.stroke()
    g.fillStyle = '#fffbeb'
    g.font = '900 78px ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(letter, 64, 70)
  })
}

/** The call sign: the symbol to find, drawn big. */
function paintCall(tex: THREE.CanvasTexture, set: number, sym: number) {
  const c = tex.image as HTMLCanvasElement
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = '#1f2937'
  roundRect(g, 6, 6, c.width - 12, c.height - 12, 40)
  g.fill()
  g.strokeStyle = symColor(set, sym)
  g.lineWidth = 10
  roundRect(g, 14, 14, c.width - 28, c.height - 28, 34)
  g.stroke()
  g.fillStyle = '#fef3c7'
  g.font = '800 46px ui-rounded, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('FIND', c.width / 2, 52)
  const cx = c.width / 2, cy = c.height / 2 + 26, s = 150
  if (set === 0) {
    g.fillStyle = COLOURS[sym].c
    g.beginPath()
    g.arc(cx, cy, s * 0.5, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff'
    g.font = '900 40px ui-rounded, system-ui, sans-serif'
    g.fillText(COLOURS[sym].name, cx, cy + 4)
  } else if (set === 1) {
    g.fillStyle = LETTER_COLS[sym]
    g.font = `900 ${s}px ui-rounded, system-ui, sans-serif`
    g.fillText(LETTERS[sym], cx, cy + 10)
  } else drawAnimal(g, sym, cx, cy, s)
  tex.needsUpdate = true
}

/* ---------------- Rules ---------------- */

function gridSize(n: number) {
  if (n <= 6) return { cols: 4, rows: 4 }
  if (n <= 11) return { cols: 5, rows: 5 }
  return { cols: 6, rows: 5 }
}

function blockPos(st: BMState, i: number) {
  const cx = i % st.cols, cz = Math.floor(i / st.cols)
  return { x: (cx - (st.cols - 1) / 2) * BS, z: (cz - (st.rows - 1) / 2) * BS }
}

/** Which block a toy stands over (-1 for none). */
function blockAt(st: BMState, x: number, z: number) {
  const cx = Math.round(x / BS + (st.cols - 1) / 2), cz = Math.round(z / BS + (st.rows - 1) / 2)
  if (cx < 0 || cz < 0 || cx >= st.cols || cz >= st.rows) return -1
  return cz * st.cols + cx
}

function memoTime(cycle: number) {
  return Math.max(1.6, 5 - cycle * 0.45)
}
function callTime(cycle: number) {
  return Math.max(2.8, 4.6 - cycle * 0.22)
}
function setFor(cycle: number) {
  return cycle < 2 ? 0 : cycle < 5 ? 1 : 2
}

function setPh(ctx: LevelCtx, st: BMState, ph: Ph, dur: number) {
  st.ph = ph
  st.pt = ctx.time
  st.dur = dur
}

/** Deal a new pattern: a few safe blocks with the target, the rest with other symbols. */
function deal(ctx: LevelCtx, st: BMState) {
  const n = st.cols * st.rows
  st.set = setFor(st.cycle)
  const kinds = st.set === 0 ? Math.min(6, 4 + Math.floor(st.cycle / 1)) : st.set === 1 ? Math.min(8, 5 + (st.cycle - 2)) : Math.min(8, 6 + (st.cycle - 5))
  const syms = ctx.rng.shuffle([...Array(st.set === 0 ? 6 : 8).keys()]).slice(0, kinds)
  st.target = syms[0]
  const active = ctx.active().length || ctx.toys.length
  const safe = Math.max(1, Math.min(n - 2, Math.ceil(active / (3 + st.cycle * 0.5))))
  const order = ctx.rng.shuffle([...Array(n).keys()])
  st.sym = new Array(n).fill(0)
  order.forEach((b, k) => {
    st.sym[b] = k < safe ? st.target : syms[1 + ((k - safe) % (syms.length - 1))]
  })
}

/* ---------------- Visual bits ---------------- */

function pawMesh() {
  const g = new THREE.Group()
  const fur = new THREE.MeshStandardMaterial({ color: '#d9a066', roughness: 0.95, flatShading: true, emissive: '#3b2414', emissiveIntensity: 0.4 })
  const pad = new THREE.MeshStandardMaterial({ color: '#f472b6', roughness: 0.7, emissive: '#831843', emissiveIntensity: 0.35 })
  const palm = new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 10), fur)
  palm.scale.set(1, 0.45, 1.15)
  g.add(palm)
  const big = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), pad)
  big.scale.set(1, 0.3, 0.85)
  big.position.set(0, -0.95, 0.3)
  g.add(big)
  for (let i = 0; i < 4; i++) {
    const a = -0.75 + i * 0.5
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), fur)
    toe.scale.set(1, 0.6, 1)
    toe.position.set(Math.sin(a) * 2.3, 0.1, Math.cos(a) * 2.3 + 0.4)
    const bean = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), pad)
    bean.scale.set(1, 0.3, 1)
    bean.position.set(Math.sin(a) * 2.35, -0.5, Math.cos(a) * 2.35 + 0.5)
    g.add(toe, bean)
  }
  return g
}

/* ---------------- Level ---------------- */

export default defineLevel<BMState>({
  id: 'block-memory',
  name: 'Block Memory',
  type: 'logic',
  blurb: 'A pattern lights up the blocks. Stand on the right one when the lights go off.',
  howTo: [
    'Remember the pattern on the block tops: colours, then letters, then animals',
    'When the lights go out, a symbol is called: get onto a block that showed it',
    'Every other block drops into the toy box, with anyone on it',
    'Safe blocks get fewer and the pattern shows for less time each round',
  ],
  accent: '#38bdf8',
  players: [2, 16],
  duration: 150,
  camera: { kind: 'overhead', height: 14, back: 10.5, follow: 0.3 },
  introOrbit: { radius: 14, height: 12 },
  sprinkles: { start: 1 },
  fallY: -6,
  sky: { color: '#1d140d', fogNear: 40, fogFar: 110 },

  tricks: [
    {
      id: 'flash',
      name: 'Fake Flash',
      icon: 'zap',
      cost: 2,
      cooldown: 9,
      busy: 0.6,
      target: 'rival',
      desc: 'Flashes a fake pattern on their screen just after the lights go out.',
      counter: 'Trust your memory: the real pattern only shows while the lights are on.',
      can: (_c, s) => (s.ph === DARK || s.ph === CALL ? true : 'After the lights go out'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        ctx.emit({ fake: ctx.rng.int(1, 1e6) }, target)
        ctx.fx.popup(target, 'Flash!', '#fde047')
        // Bots fall for it sometimes: their memory gets muddled.
        if (target.bot && ctx.rng.chance(0.75 - ctx.difficulty * 0.2)) {
          const mem = target.data.mem as number[] | undefined
          if (mem) for (let i = 0; i < mem.length; i++) if (ctx.rng.chance(0.5)) mem[i] = s.sym[ctx.rng.int(0, s.sym.length)]
          target.data.goal = undefined
        }
      },
      botUse: (ctx, s, user) => {
        if (s.ph !== DARK && !(s.ph === CALL && ctx.time - s.pt < 1)) return false
        return ctx.leader(user) ?? false
      },
    },
    {
      id: 'paw',
      name: 'Paw Over Eyes',
      icon: 'paw',
      cost: 2,
      cooldown: 10,
      busy: 0.8,
      target: 'rival',
      desc: 'A big plush paw covers their view of the pattern for 1.8 seconds.',
      counter: 'Remember what you saw before the paw, or follow someone you trust.',
      can: (_c, s) => (s.ph === SHOW ? true : 'Only while the pattern shows'),
      apply: (ctx, _s, _user, target) => {
        if (!target) return
        ctx.emit({ blind: 1.8 }, target)
        ctx.fx.popup(target, 'Paw!', '#f9a8d4')
        ctx.fx.sfx('thud', target.pos)
        if (target.bot) target.data.blind = ctx.time + 1.8
      },
    },
    {
      id: 'glue',
      name: 'Glue Dab',
      icon: 'tack',
      cost: 1,
      cooldown: 7,
      busy: 0.5,
      target: 'rival',
      range: 9,
      desc: 'Glue on their feet: they toddle at half speed for 2 seconds during the call.',
      counter: 'Stand near the middle so every block is a short walk.',
      can: (_c, s) => (s.ph === CALL ? true : 'Only during the call'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.glue[target.idx] = ctx.time + 2
        ctx.fx.popup(target, 'Sticky!', '#fef08a')
        ctx.fx.sfx('splash', target.pos)
      },
    },
    bubbleWrap<BMState>(2),
  ],

  build(ctx) {
    const { cols, rows } = gridSize(ctx.toys.length || 16)
    const hw = (cols * BS) / 2, hd = (rows * BS) / 2
    buildAttic(ctx.root, ctx.assets, null, { hw: 26, hd: 26, ridge: 38, knee: 9, y: -14, lights: ctx.quality === 'low' ? 24 : 48, quality: ctx.quality })
    // The toy box the blocks sit in: painted walls rising above the blocks, a deep dark inside.
    const boxTex = canvasTex(256, 128, (g) => {
      g.fillStyle = '#2563eb'
      g.fillRect(0, 0, 256, 128)
      g.fillStyle = '#fde047'
      for (let i = 0; i < 9; i++) {
        const x = 14 + i * 28 + (i % 2) * 6, y = 30 + (i % 3) * 30
        g.beginPath()
        for (let k = 0; k <= 10; k++) {
          const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? 4 : 10
          g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
        }
        g.fill()
      }
      g.fillStyle = '#facc15'
      g.fillRect(0, 0, 256, 10)
    }, { repeat: [3, 1] })
    const wallMat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.7 })
    const rimMat = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.6 })
    const inner = new THREE.MeshStandardMaterial({ color: '#1e1b4b', roughness: 1 })
    const T = 0.6
    const wallH = WALL_H + 14
    for (const [x, z, w, d] of [
      [0, -hd - T / 2, hw * 2 + T * 2, T],
      [0, hd + T / 2, hw * 2 + T * 2, T],
      [-hw - T / 2, 0, T, hd * 2],
      [hw + T / 2, 0, T, hd * 2],
    ] as [number, number, number, number][]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), [wallMat, wallMat, rimMat, rimMat, wallMat, wallMat])
      m.position.set(x, WALL_H - wallH / 2, z)
      m.receiveShadow = true
      ctx.root.add(m)
      ctx.phys.box({ x, y: 4, z }, { x: w / 2, y: 8, z: d / 2 })
    }
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hd * 2).rotateX(-Math.PI / 2), inner)
    pit.position.y = -13.9
    ctx.root.add(pit)
    // Corner posts with wooden balls, like an old toy box.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10), rimMat)
        ball.position.set(sx * (hw + T / 2), WALL_H + 0.55, sz * (hd + T / 2))
        ball.castShadow = true
        ctx.root.add(ball)
      }
  },

  init(ctx) {
    const n = ctx.toys.length || 16
    const { cols, rows } = gridSize(n)
    const nb = cols * rows
    const st: BMState = {
      ph: RESET, pt: 0, dur: 1.5, cycle: 0, set: 0, target: 0, sym: new Array(nb).fill(-1), glue: new Array(n).fill(0), misses: new Array(n).fill(0), cols, rows,
      vis: {
        tops: [], topTex: [], sides: [], sideOf: [], shown: new Array(nb).fill(-99), dropped: new Array(nb).fill(false), callSigns: [], callTex: null, callKey: '', fakeT: 0, fake: [], blindT: 0, paw: null,
        glueMeshes: [], lastPh: -1, tickT: 0,
      },
    }
    // Block bodies: six alphabet-block designs, instanced. Tops: one mesh each (they light up individually).
    const sideLetters = ['A', 'B', 'C', 'D', 'E', 'F']
    const panels = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777']
    const boxGeo = new THREE.BoxGeometry(BS - GAP, BS, BS - GAP)
    const per = Math.ceil(nb / 6)
    for (let k = 0; k < 6; k++) {
      const mat = new THREE.MeshStandardMaterial({ map: sideTexture(sideLetters[k], panels[k]), roughness: 0.65 })
      const im = new THREE.InstancedMesh(boxGeo, mat, per)
      im.count = 0
      im.castShadow = true
      im.receiveShadow = true
      im.frustumCulled = false
      ctx.root.add(im)
      st.vis.sides.push(im)
    }
    const atlas = makeAtlas()
    const topGeo = new THREE.PlaneGeometry(BS - GAP - 0.06, BS - GAP - 0.06).rotateX(-Math.PI / 2).rotateY(Math.PI)
    const order = makeRng(ctx.seed ^ 0x1234).shuffle([...Array(nb).keys()])
    for (let i = 0; i < nb; i++) {
      const k = order[i] % 6
      const im = st.vis.sides[k]
      st.vis.sideOf.push({ mesh: k, slot: im.count })
      im.count++
      const tex = atlas.clone()
      tex.repeat.set(1 / CELLS, 1 / CELLS)
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.55 })
      const top = new THREE.Mesh(topGeo, mat)
      top.receiveShadow = true
      ctx.root.add(top)
      st.vis.tops.push(top)
      st.vis.topTex.push(tex)
    }
    // Colliders that follow the blocks as they drop and rise (a hazard, so every screen agrees).
    const cols2 = [...Array(nb).keys()].map((i) => {
      const p = blockPos(st, i)
      return ctx.phys.box({ x: p.x, y: -BS / 2, z: p.z }, { x: (BS - GAP) / 2, y: BS / 2, z: (BS - GAP) / 2 }, { friction: 0.8 })
    })
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3()
    const blockY = (i: number, t: number) => {
      const el = t - st.pt
      const safe = st.sym[i] === st.target
      if (st.ph === DROP && !safe) return el < SHAKE ? 0 : -(el - SHAKE) * (el - SHAKE) * 14
      if (st.ph === RESET && st.vis.dropped[i]) return -8 * (1 - THREE.MathUtils.smootherstep(el / Math.max(0.1, st.dur * 0.8), 0, 1))
      return 0
    }
    ctx.hazards.add({
      update(_c, t) {
        for (let i = 0; i < nb; i++) {
          if (st.ph === DROP) st.vis.dropped[i] = st.sym[i] !== st.target
          let y = blockY(i, t)
          const el = t - st.pt
          let jx = 0, jz = 0
          if (st.ph === DROP && st.sym[i] !== st.target && el < SHAKE) {
            jx = Math.sin(t * 70 + i) * 0.06
            jz = Math.cos(t * 63 + i * 2) * 0.06
          }
          if (st.ph === SHOW) st.vis.dropped[i] = false
          if (y < -12) y = -12
          const p = blockPos(st, i)
          const solid = y > -0.25
          cols2[i].setEnabled(solid)
          cols2[i].setTranslation({ x: p.x, y: y - BS / 2, z: p.z })
          const so = st.vis.sideOf[i]
          pv.set(p.x + jx, y - BS / 2, p.z + jz)
          st.vis.sides[so.mesh].setMatrixAt(so.slot, m4.compose(pv, q, sc))
          st.vis.tops[i].position.set(p.x + jx, y + 0.012, p.z + jz)
          st.vis.tops[i].visible = y > -11
        }
        for (const im of st.vis.sides) im.instanceMatrix.needsUpdate = true
      },
    })
    // The call signs, either side of the toy box (clear of the HUD at the top of the screen).
    const callTex = canvasTex(320, 300, () => {})
    const signMat = new THREE.SpriteMaterial({ map: callTex, transparent: true, depthWrite: false })
    for (const sx of [-1, 1]) {
      const sign = new THREE.Sprite(signMat)
      sign.scale.set(3.6, 3.4, 1)
      sign.position.set(sx * ((cols * BS) / 2 + 3), WALL_H + 0.6, 0.5)
      sign.visible = false
      ctx.root.add(sign)
      st.vis.callSigns.push(sign)
    }
    st.vis.callTex = callTex
    const paw = pawMesh()
    paw.visible = false
    ctx.root.add(paw)
    st.vis.paw = paw
    const glueMat = new THREE.MeshStandardMaterial({ color: '#fef9c3', roughness: 0.2, transparent: true, opacity: 0.85 })
    for (let i = 0; i < n; i++) {
      const gm = new THREE.Mesh(new THREE.CircleGeometry(0.55, 14).rotateX(-Math.PI / 2), glueMat)
      gm.visible = false
      ctx.root.add(gm)
      st.vis.glueMeshes.push(gm)
    }
    return st
  },

  spawn(ctx, st, _toy, i, n) {
    return ctx.spawnGrid(n, { x: 0, z: 0, yaw: 0, spacing: Math.min(1.6, (st.cols * BS - 2) / Math.min(n, 5)), cols: Math.min(n, 5) })[i]
  },

  start(ctx, st) {
    setPh(ctx, st, RESET, 1)
  },

  tick(ctx, st) {
    const t = ctx.time
    const el = t - st.pt
    if (el >= st.dur) {
      if (st.ph === RESET) {
        deal(ctx, st)
        setPh(ctx, st, SHOW, memoTime(st.cycle))
        ctx.fx.sfx('ding')
      } else if (st.ph === SHOW) {
        setPh(ctx, st, DARK, 0.8)
        ctx.fx.sfx('thud')
      } else if (st.ph === DARK) {
        setPh(ctx, st, CALL, callTime(st.cycle))
        ctx.fx.say(`FIND: ${symName(st.set, st.target)}`, symColor(st.set, st.target), 1.6)
        ctx.fx.sfx('go')
      } else if (st.ph === CALL) {
        setPh(ctx, st, DROP, 3)
        ctx.fx.sfx('crack')
        ctx.fx.shake(0.35)
      } else if (st.ph === DROP) {
        // Survivors of the cycle earn a Sprinkle.
        for (const toy of ctx.active()) {
          const b = blockAt(st, toy.pos.x, toy.pos.z)
          if (b >= 0 && st.sym[b] === st.target && toy.pos.y > -1) ctx.addSprinkles(toy, 1)
        }
        st.cycle++
        setPh(ctx, st, RESET, 1.6)
        if (st.cycle === 2) ctx.fx.say('Now: LETTERS', '#93c5fd', 1.4)
        if (st.cycle === 5) ctx.fx.say('Now: ANIMALS', '#86efac', 1.4)
      }
    }
    // Glue.
    for (const toy of ctx.toys) toy.runSpeed = st.glue[toy.idx] > t ? 2.6 : 5.6
  },

  onFall(ctx, st, toy) {
    st.misses[toy.idx]++
    if (ctx.mode === 'show') ctx.fail(toy, 'dropped into the toy box')
    else ctx.fail(toy, 'wrong block!')
  },

  retry(ctx, st, toy) {
    // Quick Play: back on a block that is still up.
    const safe = st.sym.map((s, i) => (s === st.target || st.ph !== DROP ? i : -1)).filter((i) => i >= 0)
    const b = safe.length ? ctx.rng.pick(safe) : 0
    const p = blockPos(st, b)
    ctx.respawn(toy, { x: p.x, y: 0.2, z: p.z, yaw: 0 }, 1)
  },

  onTimeUp(ctx) {
    // Everyone still on a block remembered well enough.
    if (ctx.mode === 'show') for (const t of ctx.active()) ctx.qualify(t, 'survived')
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => st.misses[a.idx] - st.misses[b.idx] || Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { mem?: number[]; memCycle?: number; goal?: number; decideAt?: number; callPt?: number; blind?: number; jumped?: number; idleX?: number; idleZ?: number }
    const nb = st.cols * st.rows
    // Memorise while the pattern shows (imperfectly: harder sets and shorter looks mean more mistakes).
    if (st.ph === SHOW && d.memCycle !== st.cycle && ctx.time - st.pt > sk.reaction) {
      d.memCycle = st.cycle
      const look = memoTime(st.cycle)
      const blinded = (d.blind ?? 0) > ctx.time
      const p = THREE.MathUtils.clamp(sk.accuracy * (0.5 + look * 0.11) - st.set * 0.07 - (blinded ? 0.35 : 0), 0.2, 0.97)
      d.mem = st.sym.map((s) => (ctx.rng.chance(p) ? s : st.sym[ctx.rng.int(0, nb)]))
      d.goal = undefined
      d.idleX = THREE.MathUtils.clamp(toy.pos.x + ctx.rng.range(-1.2, 1.2), (-st.cols * BS) / 2 + 1, (st.cols * BS) / 2 - 1)
      d.idleZ = THREE.MathUtils.clamp(toy.pos.z + ctx.rng.range(-1.2, 1.2), (-st.rows * BS) / 2 + 1, (st.rows * BS) / 2 - 1)
    }
    if (st.ph === CALL && d.callPt !== st.pt) {
      d.callPt = st.pt
      d.decideAt = st.pt + sk.reaction * ctx.rng.range(0.8, 1.6)
      d.goal = undefined
    }
    if (st.ph === CALL && ctx.time >= (d.decideAt ?? 0) && d.goal === undefined) {
      const mem = d.mem ?? st.sym
      // Blocks I think are right, nearest and least crowded first.
      let best = -1, bs = Infinity
      for (let i = 0; i < nb; i++) {
        if (mem[i] !== st.target) continue
        const p = blockPos(st, i)
        let crowd = 0
        for (const o of ctx.toys) if (o !== toy && o.status === 'play' && Math.abs(o.pos.x - p.x) < BS / 2 && Math.abs(o.pos.z - p.z) < BS / 2) crowd++
        const sc = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z) + crowd * 1.4
        if (sc < bs) {
          bs = sc
          best = i
        }
      }
      if (best < 0) {
        // Nothing remembered: follow the crowd.
        const counts = new Array(nb).fill(0)
        for (const o of ctx.toys) if (o !== toy && o.status === 'play') {
          const b = blockAt(st, o.pos.x, o.pos.z)
          if (b >= 0) counts[b]++
        }
        best = counts.indexOf(Math.max(...counts))
      }
      d.goal = best
    }
    let gx = d.idleX ?? toy.pos.x, gz = d.idleZ ?? toy.pos.z
    const settle = (st.ph === DROP && ctx.time - st.pt > SHAKE + 0.3) || st.ph === RESET
    if (settle) {
      // Blocks are down round here: stay on the middle of the block I'm on.
      const b = blockAt(st, toy.pos.x, toy.pos.z)
      const p = b >= 0 ? blockPos(st, b) : { x: toy.pos.x, z: toy.pos.z }
      gx = p.x
      gz = p.z
      d.idleX = p.x
      d.idleZ = p.z
    } else if ((st.ph === CALL || st.ph === DROP) && d.goal !== undefined && d.goal >= 0) {
      const p = blockPos(st, d.goal)
      gx = p.x
      gz = p.z
    }
    // Rescue jump: my block is shaking and a safe one is next to me.
    if (st.ph === DROP && ctx.time - st.pt < SHAKE + 0.1 && d.jumped !== st.pt && toy.grounded) {
      const b = blockAt(st, toy.pos.x, toy.pos.z)
      if (b >= 0 && st.sym[b] !== st.target && ctx.rng.chance(sk.accuracy * 0.6)) {
        let bestN = -1, bd = 3.6
        for (let i = 0; i < nb; i++) {
          if (st.sym[i] !== st.target) continue
          const p = blockPos(st, i)
          const dd = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z)
          if (dd < bd) {
            bd = dd
            bestN = i
          }
        }
        if (bestN >= 0) {
          d.goal = bestN
          const p = blockPos(st, bestN)
          gx = p.x
          gz = p.z
          toy.pad.jump = true
        }
        d.jumped = st.pt
      }
    }
    steerTo(toy, gx, gz, { pace: settle ? 0.5 : sk.pace, stop: st.ph === CALL || st.ph === DROP || settle ? 0.35 : 0.8 })
    avoidWalls(ctx, toy)
    // Crowded safe block: push someone off it near the end of the call.
    if (st.ph === CALL && st.dur - (ctx.time - st.pt) < 1.6) {
      for (const o of ctx.toys) {
        if (o === toy || o.status !== 'play' || o.pos.distanceTo(toy.pos) > 1.3) continue
        if (ctx.rng.chance(sk.aggression * 2.2 * dt)) bully(toy, o)
        break
      }
    }
  },

  pack(_c, st) {
    return [st.ph, Math.round(st.pt * 100) / 100, Math.round(st.dur * 100) / 100, st.cycle, st.set, st.target, st.sym, st.glue.map((g) => Math.round(g * 10) / 10), st.misses]
  },

  unpack(_c, st, d) {
    const a = d as [Ph, number, number, number, number, number, number[], number[], number[]]
    st.ph = a[0]
    st.pt = a[1]
    st.dur = a[2]
    st.cycle = a[3]
    st.set = a[4]
    st.target = a[5]
    st.sym = a[6]
    st.glue = a[7]
    st.misses = a[8]
  },

  onEvent(ctx, st, data) {
    const e = data as { fake?: number; blind?: number }
    if (e.fake !== undefined) {
      // A scrambled pattern flickers on this screen only.
      const r = makeRng(e.fake)
      const kinds = st.set === 0 ? 6 : 8
      st.vis.fake = st.sym.map(() => r.int(0, kinds))
      st.vis.fakeT = 1.3
      ctx.fxLocal.sfx('zap')
    }
    if (e.blind !== undefined) {
      st.vis.blindT = e.blind
      ctx.fxLocal.sfx('thud')
    }
  },

  visual(ctx, st, dt) {
    const v = st.vis
    const t = ctx.time
    const el = t - st.pt
    v.fakeT = Math.max(0, v.fakeT - dt)
    v.blindT = Math.max(0, v.blindT - dt)
    const playing = ctx.phase === 'play'
    // What each top shows on this screen.
    const reveal = playing && (st.ph === SHOW || st.ph === DROP)
    for (let i = 0; i < v.tops.length; i++) {
      let cell = 0
      let glow = 0
      if (reveal && v.blindT <= 0) {
        cell = cellOf(st.set, st.sym[i])
        glow = st.ph === SHOW ? 0.55 + Math.sin(t * 6) * 0.1 : st.sym[i] === st.target ? 0.8 : 0.1
      } else if (playing && v.fakeT > 0 && (st.ph === DARK || st.ph === CALL) && Math.sin(v.fakeT * 40) > -0.3) {
        cell = cellOf(st.set, v.fake[i] ?? 0)
        glow = 0.45
      }
      // Lights-out flicker as the pattern goes.
      if (playing && st.ph === DARK && el < 0.25 && Math.sin(el * 90) > 0) cell = cellOf(st.set, st.sym[i])
      const key = cell * 100 + Math.round(glow * 20)
      if (v.shown[i] !== key) {
        v.topTex[i].offset.set((cell % CELLS) / CELLS, 1 - (Math.floor(cell / CELLS) + 1) / CELLS)
        ;(v.tops[i].material as THREE.MeshStandardMaterial).emissiveIntensity = glow
        v.shown[i] = key
      }
    }
    // The call sign.
    if (v.callTex) {
      const on = playing && (st.ph === CALL || st.ph === DROP)
      const key = `${st.set}:${st.target}`
      if (on && v.callKey !== key) {
        paintCall(v.callTex, st.set, st.target)
        v.callKey = key
      }
      const s = st.ph === CALL && el < 0.3 ? 1 + (0.3 - el) * 1.5 : 1
      for (const sign of v.callSigns) {
        sign.visible = on
        sign.scale.set(3.6 * s, 3.4 * s, 1)
      }
    }
    // Ticks during the call.
    if (playing && st.ph === CALL) {
      v.tickT -= dt
      const left = st.dur - el
      if (v.tickT <= 0 && left > 0) {
        v.tickT = left < 1.5 ? 0.25 : 0.5
        ctx.fxLocal.sfx('tick')
      }
    }
    if (v.lastPh !== st.ph && playing) {
      if (st.ph === DROP) ctx.fxLocal.puff({ x: 0, y: 0.5, z: 0 }, 'dust', 4)
      v.lastPh = st.ph
    }
    // The paw over this screen's view.
    if (v.paw) {
      v.paw.visible = v.blindT > 0
      if (v.paw.visible) {
        const cam = ctx.cam.camera
        const k = Math.min(1, (1.8 - v.blindT) * 6, v.blindT * 6)
        // It presses down over the lens from the top of the view, pads towards you.
        cam.getWorldDirection(_dir)
        v.paw.position.copy(cam.position).addScaledVector(_dir, 6)
        v.paw.position.y += 1.2 + (1 - k) * 6
        v.paw.lookAt(cam.position)
        v.paw.rotateX(-Math.PI / 2)
        v.paw.scale.setScalar(0.85)
      }
    }
    for (const toy of ctx.toys) {
      const gm = v.glueMeshes[toy.idx]
      if (!gm) continue
      gm.visible = playing && st.glue[toy.idx] > t && toy.status === 'play'
      if (gm.visible) gm.position.set(toy.pos.x, toy.feet + 0.03, toy.pos.z)
    }
  },

  hud(ctx, st, me) {
    if (ctx.phase !== 'play') return { chips: [`${SET_NAMES[0]} → ${SET_NAMES[1]} → ${SET_NAMES[2]}`] }
    const el = ctx.time - st.pt
    const left = Math.max(0, st.dur - el)
    const name = symName(st.set, st.target)
    const icon = st.set === 2 ? ` ${ANIMAL_EMOJI[st.target]}` : ''
    const status =
      st.ph === SHOW
        ? { text: 'MEMORISE!', color: '#7dd3fc', pulse: true }
        : st.ph === DARK
          ? { text: 'LIGHTS OUT…', color: '#cbd5e1' }
          : st.ph === CALL
            ? { text: `FIND: ${name}${icon}`, color: symColor(st.set, st.target), pulse: left < 1.5 }
            : st.ph === DROP
              ? { text: 'DROP!', color: '#f87171', pulse: true }
              : { text: 'GET READY', color: '#fde68a' }
    const chips = [`Round ${st.cycle + 1}`, SET_NAMES[setFor(st.cycle)], `Look time ${memoTime(st.cycle).toFixed(1)} s`]
    if (ctx.mode === 'quick' && me) chips.push(`Misses: ${st.misses[me.idx] ?? 0}`)
    let prompt: string | undefined
    if (me?.status === 'play') {
      if (st.ph === SHOW) prompt = 'Remember where each symbol is. Paw Over Eyes can blind a rival now.'
      else if (st.ph === CALL) prompt = `Stand on a block that showed ${name}${icon}. Shove others off if it is crowded!`
      else if (st.glue[me.idx] > ctx.time) prompt = 'Glue on your feet!'
    }
    const bars = st.ph === CALL ? [{ label: 'Call', value: left / st.dur, color: symColor(st.set, st.target), danger: left < 1.5 }] : []
    return { status, chips, prompt, bars }
  },
})

