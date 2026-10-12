// Jigsaw Drop (survival, can be a final). Three half-finished jigsaw puzzles on three stacked tables. A piece
// shakes when a toy steps on it and drops a moment later, so the floor erodes under everyone: falling through
// lands you on the puzzle below, and falling through the bottom one puts you out. From 60 s pieces start
// dropping on their own. Last toys standing win. Tricks: flick the piece out from under a rival, and knock a
// rival's table so everyone on that layer stumbles and the pieces round them come loose.
import * as THREE from 'three'
import { nearestRival, skill, steerTo } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { PROP_GROUPS, type Collider } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type Toy } from '../engine/types'
import { flat, paint, r1, rbox, soft, survivalTimeUp } from './kit'

const N = 11
const SIZE = 1.75
const LAYERS = 3
const LAYER_Y = [0, -7, -14]
const THICK = 0.32
const HALF = (N * SIZE) / 2
const PER = N * N
const DELAY = 2.9
const SELF_FALL_AT = 60
const FALL_HIDE = 2.6

interface JigState {
  /** Round time each piece drops (-1: solid, untouched). Pieces shake from dropAt - delay. */
  dropAt: Float32Array
  /** When each piece was triggered (for the shake). */
  trigAt: Float32Array
  // Host only.
  survive: number[]
  layerOf: number[]
  colliders: Collider[]
  nextSelf: number
  vis: {
    meshes: THREE.InstancedMesh[]
    mats: THREE.MeshStandardMaterial[][]
    done: Uint8Array
    home: THREE.Vector3[]
    spin: THREE.Vector3[]
    faded: boolean[]
  }
}

/* ---------------- Geometry & pictures ---------------- */

/** One jigsaw piece: tabs on +x and +y, blanks on -x and -y, so identical pieces tile. */
function pieceShape(size: number) {
  const h = size / 2 - 0.012
  const R = size * 0.16
  const s = new THREE.Shape()
  const pts: THREE.Vector2[] = []
  const edge = (ax: number, ay: number, bx: number, by: number, sign: number) => {
    const len = Math.hypot(bx - ax, by - ay)
    const dx = (bx - ax) / len, dy = (by - ay) / len
    const nx = dy, ny = -dx // outward for a counter-clockwise outline
    const mx = (ax + bx) / 2, my = (ay + by) / 2
    const w = R * 0.62
    const cx = mx + nx * sign * R * 0.78, cy = my + ny * sign * R * 0.78
    const ns = new THREE.Vector2(mx - dx * w, my - dy * w), ne = new THREE.Vector2(mx + dx * w, my + dy * w)
    const r = Math.hypot(ns.x - cx, ns.y - cy)
    pts.push(new THREE.Vector2(ax, ay), ns)
    const a0 = Math.atan2(ns.y - cy, ns.x - cx), a1 = Math.atan2(ne.y - cy, ne.x - cx)
    // Sweep the long way round, through the knob's far side.
    const far = Math.atan2(ny * sign, nx * sign)
    let sweep = a1 - a0
    const mid = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    const passes = (sw: number) => {
      const steps = 24
      for (let i = 1; i < steps; i++) if (Math.abs(mid(a0 + (sw * i) / steps - far)) < 0.2) return true
      return false
    }
    sweep = mid(sweep)
    if (!passes(sweep)) sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2
    const k = 7
    for (let i = 1; i < k; i++) {
      const a = a0 + (sweep * i) / k
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
    }
    pts.push(ne)
  }
  // Counter-clockwise: bottom (-y, blank), right (+x, tab), top (+y, tab), left (-x, blank).
  edge(-h, -h, h, -h, -1)
  edge(h, -h, h, h, 1)
  edge(h, h, -h, h, 1)
  edge(-h, h, -h, -h, -1)
  s.setFromPoints(pts)
  return s
}

function pieceGeometry() {
  const g = new THREE.ExtrudeGeometry(pieceShape(SIZE), { depth: THICK, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 1 })
  // Lie flat with the top at y = 0 (shape +y → world -z).
  g.rotateX(-Math.PI / 2)
  g.translate(0, -THICK - 0.03, 0)
  return g
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void

const PICTURES: Painter[] = [
  // A sunny meadow with a red barn.
  (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.5)
    sky.addColorStop(0, '#38bdf8')
    sky.addColorStop(1, '#a5e3fb')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#fde047'
    g.beginPath()
    g.arc(w * 0.8, h * 0.16, w * 0.09, 0, Math.PI * 2)
    g.fill()
    const hill = (y: number, c: string, a: number) => {
      g.fillStyle = c
      g.beginPath()
      g.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / w * Math.PI * 2 * a + y) * h * 0.05)
      g.lineTo(w, h)
      g.fill()
    }
    hill(h * 0.42, '#86efac', 1.2)
    hill(h * 0.55, '#4ade80', 0.8)
    hill(h * 0.72, '#22c55e', 1.6)
    g.fillStyle = '#dc2626'
    g.fillRect(w * 0.18, h * 0.42, w * 0.2, h * 0.16)
    g.fillStyle = '#7f1d1d'
    g.beginPath()
    g.moveTo(w * 0.16, h * 0.43)
    g.lineTo(w * 0.28, h * 0.33)
    g.lineTo(w * 0.4, h * 0.43)
    g.fill()
    g.fillStyle = '#fef3c7'
    g.fillRect(w * 0.25, h * 0.48, w * 0.06, h * 0.1)
    for (let i = 0; i < 160; i++) {
      g.fillStyle = ['#f472b6', '#fde047', '#ffffff', '#c084fc'][i % 4]
      g.beginPath()
      g.arc((i * 97) % w, h * 0.62 + ((i * 53) % (h * 0.38)), 3 + (i % 3), 0, Math.PI * 2)
      g.fill()
    }
  },
  // The seaside: waves, a sailboat, a sandy beach.
  (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.4)
    sky.addColorStop(0, '#fbcfe8')
    sky.addColorStop(1, '#fef9c3')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i % 2 ? '#0ea5e9' : '#38bdf8'
      g.fillRect(0, h * 0.36 + i * h * 0.045, w, h * 0.05)
    }
    g.fillStyle = '#fcd34d'
    g.beginPath()
    g.moveTo(0, h * 0.78)
    g.quadraticCurveTo(w * 0.5, h * 0.68, w, h * 0.8)
    g.lineTo(w, h)
    g.lineTo(0, h)
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.moveTo(w * 0.6, h * 0.12)
    g.lineTo(w * 0.6, h * 0.4)
    g.lineTo(w * 0.78, h * 0.4)
    g.fill()
    g.fillStyle = '#ef4444'
    g.beginPath()
    g.moveTo(w * 0.52, h * 0.42)
    g.lineTo(w * 0.82, h * 0.42)
    g.lineTo(w * 0.76, h * 0.47)
    g.lineTo(w * 0.56, h * 0.47)
    g.fill()
    g.fillStyle = '#f97316'
    for (let i = 0; i < 6; i++) {
      g.beginPath()
      g.arc(w * (0.1 + i * 0.15), h * (0.86 + (i % 2) * 0.06), w * 0.025, 0, Math.PI * 2)
      g.fill()
    }
  },
  // Hot-air balloons at sunset.
  (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#fb923c')
    sky.addColorStop(0.6, '#fda4af')
    sky.addColorStop(1, '#c4b5fd')
    g.fillStyle = sky
    g.fillRect(0, 0, w, h)
    const cols = ['#ef4444', '#facc15', '#22d3ee', '#a855f7', '#22c55e', '#f472b6']
    for (let i = 0; i < 7; i++) {
      const x = w * ((i * 0.37 + 0.1) % 1), y = h * ((i * 0.29 + 0.15) % 0.8), r = w * (0.05 + (i % 3) * 0.025)
      g.fillStyle = cols[i % cols.length]
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(x - r * 0.15, y - r, r * 0.3, r * 2)
      g.fillStyle = '#7c2d12'
      g.fillRect(x - r * 0.25, y + r * 1.3, r * 0.5, r * 0.4)
    }
    g.fillStyle = '#4c1d95'
    g.beginPath()
    g.moveTo(0, h)
    for (let x = 0; x <= w; x += 16) g.lineTo(x, h * 0.88 - Math.abs(Math.sin(x * 0.02)) * h * 0.08)
    g.lineTo(w, h)
    g.fill()
  },
]

function pictureMaterials(layer: number, size: number) {
  const tex = paint(512, 512, PICTURES[layer])
  const pic = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
  // UVs from each piece's place in the finished picture (an instanced attribute), so a falling piece keeps its bit.
  pic.onBeforeCompile = (sh) => {
    sh.uniforms.uPicSize = { value: size }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aHome;\nuniform float uPicSize;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vec2((aHome.x + position.x) / uPicSize + 0.5, 0.5 - (aHome.y + position.z) / uPicSize);\n#endif')
  }
  pic.customProgramCacheKey = () => 'jigsaw-pic'
  const side = flat('#d6b58a', { roughness: 0.95 })
  return [pic, side]
}

/* ---------------- Rules helpers ---------------- */

/** Piece index under (x, z) on a layer, or -1. */
function cell(layer: number, x: number, z: number) {
  const ix = Math.floor((x + HALF) / SIZE), iz = Math.floor((z + HALF) / SIZE)
  if (ix < 0 || iz < 0 || ix >= N || iz >= N) return -1
  return layer * PER + iz * N + ix
}

function center(i: number, out: { x: number; y: number; z: number }) {
  const layer = Math.floor(i / PER), k = i % PER
  out.x = -HALF + ((k % N) + 0.5) * SIZE
  out.z = -HALF + (Math.floor(k / N) + 0.5) * SIZE
  out.y = LAYER_Y[layer]
  return out
}

/** Which layer a toy is standing on (or just above), or -1. */
function layerOf(toy: Toy) {
  for (let l = 0; l < LAYERS; l++) if (toy.feet > LAYER_Y[l] - 0.4 && toy.feet < LAYER_Y[l] + 2.2) return l
  return -1
}

const solid = (s: JigState, i: number, t: number) => i >= 0 && (s.dropAt[i] < 0 || s.dropAt[i] > t)
const fresh = (s: JigState, i: number) => i >= 0 && s.dropAt[i] < 0

function trigger(s: JigState, i: number, t: number, delay: number) {
  if (i < 0) return
  if (s.dropAt[i] >= 0 && s.dropAt[i] <= t + delay) return
  if (s.dropAt[i] < 0) s.trigAt[i] = t
  s.dropAt[i] = t + delay
}

const _c = { x: 0, y: 0, z: 0 }
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3(1, 1, 1)
const _p = new THREE.Vector3()
const _zero = new THREE.Vector3(0, 0, 0)

export default defineLevel<JigState>({
  id: 'jigsaw',
  name: 'Jigsaw Drop',
  type: 'survival',
  blurb: 'Puzzle pieces fall away a moment after you step on them. Last toy standing wins.',
  howTo: [
    'A piece shakes when you step on it, then drops: keep moving',
    'Fall through and you land on the puzzle below; fall through the bottom one and you are out',
    'Every step erases floor for everyone: steal the pieces others need',
    'From 60 s pieces fall on their own',
  ],
  accent: '#a78bfa',
  players: [2, 16],
  duration: 120,
  canBeFinal: true,
  camera: { kind: 'chase', dist: 8.5, height: 1.2 },
  introOrbit: { radius: 17, height: 8, center: [0, -6, 0] },
  sprinkles: { start: 2 },
  fallY: -22,
  sky: { color: '#1f160f', fogNear: 40, fogFar: 110 },

  tricks: [
    {
      id: 'flick',
      name: 'Piece Flick',
      icon: 'puzzle',
      cost: 2,
      cooldown: 7,
      busy: 0.5,
      target: 'rival',
      desc: 'Flick the piece out from under a rival: it drops almost at once.',
      counter: 'Jump the moment it twitches, onto a neighbouring piece.',
      can: (_c, _s, _u, target) => (target && layerOf(target) >= 0 ? true : 'They are mid-air'),
      apply: (ctx, s, _user, target) => {
        if (!target) return
        const l = layerOf(target)
        const i = cell(l, target.pos.x, target.pos.z)
        if (i < 0) return
        trigger(s, i, ctx.time, 0.4)
        ctx.fx.sfx('snip', target.pos)
        ctx.fx.popup(target, 'Flick!', '#c4b5fd')
      },
      botUse: (ctx, s, user) => {
        // Flick someone on a layer above ours or our own, standing on a solid piece.
        const mine = layerOf(user)
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play') continue
          const l = layerOf(t)
          if (l < 0 || l > mine) continue
          if (fresh(s, cell(l, t.pos.x, t.pos.z))) return t
        }
        return false
      },
    },
    {
      id: 'knock',
      name: 'Table Knock',
      icon: 'slam',
      cost: 3,
      cooldown: 15,
      busy: 1,
      target: 'rival',
      desc: "Bang a rival's table: everyone on that puzzle stumbles and the pieces round the rival come loose.",
      counter: 'Hop as the table jolts: toys in the air are not shaken.',
      can: (_c, _s, _u, target) => (target && layerOf(target) >= 0 ? true : 'They are mid-air'),
      apply: (ctx, s, user, target) => {
        if (!target) return
        const l = layerOf(target)
        if (l < 0) return
        for (const t of ctx.toys) {
          if (t.status !== 'play' || layerOf(t) !== l || !t.grounded) continue
          const a = ctx.rng.range(0, Math.PI * 2)
          ctx.knock(t, { x: Math.cos(a) * 2.2, y: 2.5, z: Math.sin(a) * 2.2 }, 0.35, t === user ? null : user)
        }
        for (let k = 0; k < 7; k++) {
          const i = cell(l, target.pos.x + ctx.rng.range(-3, 3), target.pos.z + ctx.rng.range(-3, 3))
          if (fresh(s, i)) trigger(s, i, ctx.time, ctx.rng.range(0.8, 1.6))
        }
        ctx.emit({ k: 'knock', l })
        ctx.fx.sfx('slam', target.pos)
        ctx.fx.say(`${user.name} KNOCKED THE TABLE!`, '#c4b5fd', 1.4)
      },
    },
    bubbleWrap<JigState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 30, hd: 30, ridge: 46, knee: 14, y: -26, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    // Three tables: a wooden frame round each puzzle and legs down to the next.
    const wood = flat('#8b5a2b')
    const dark = flat('#6b4423')
    for (let l = 0; l < LAYERS; l++) {
      const y = LAYER_Y[l]
      const w = HALF * 2 + 2.4
      for (const [x, z, sx, sz] of [[0, -HALF - 0.9, w, 1], [0, HALF + 0.9, w, 1], [-HALF - 0.9, 0, 1, w - 2], [HALF + 0.9, 0, 1, w - 2]] as const) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.6, sz), wood)
        b.position.set(x, y - 0.55, z)
        b.receiveShadow = true
        ctx.root.add(b)
      }
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6.4, 0.8), dark)
          leg.position.set(sx * (HALF + 0.9), y - 3.9, sz * (HALF + 0.9))
          leg.castShadow = true
          ctx.root.add(leg)
        }
    }
    // The puzzle boxes, propped against the stack (the pictures on their lids).
    for (let l = 0; l < LAYERS; l++) {
      const lid = new THREE.Mesh(rbox(5, 0.7, 4, 0.1, 1), [
        soft('#e7e5e4'), soft('#e7e5e4'), new THREE.MeshStandardMaterial({ map: paint(256, 256, PICTURES[l]), roughness: 0.6 }), soft('#e7e5e4'), soft('#e7e5e4'), soft('#e7e5e4'),
      ])
      lid.position.set(HALF + 5 + l * 0.6, -26 + 2.2 + l * 0.75, -6 + l * 5.5)
      lid.rotation.set(0, -0.3 + l * 0.2, Math.PI / 2 - 0.25)
      lid.castShadow = true
      ctx.root.add(lid)
    }
    // Spilled spare pieces on the attic floor.
    const spare = new THREE.InstancedMesh(pieceGeometry(), flat('#c4b5fd'), 12)
    const col = new THREE.Color()
    for (let i = 0; i < 12; i++) {
      _p.set(ctx.rng.range(-20, 20), -26 + 0.4, ctx.rng.range(-20, 20))
      if (Math.abs(_p.x) < HALF + 2 && Math.abs(_p.z) < HALF + 2) _p.x += HALF * 2
      _q.setFromEuler(_e.set(0, ctx.rng.range(0, 6), 0))
      spare.setMatrixAt(i, _m.compose(_p, _q, _s))
      spare.setColorAt(i, col.set(['#f9a8d4', '#86efac', '#93c5fd', '#fde68a'][i % 4]))
    }
    ctx.root.add(spare)
  },

  init(ctx) {
    const total = PER * LAYERS
    const st: JigState = {
      dropAt: new Float32Array(total).fill(-1),
      trigAt: new Float32Array(total).fill(-1),
      survive: ctx.toys.map(() => 0),
      layerOf: ctx.toys.map(() => 0),
      colliders: [],
      nextSelf: SELF_FALL_AT,
      vis: { meshes: [], mats: [], done: new Uint8Array(total), home: [], spin: [], faded: [false, false, false] },
    }
    const geo = pieceGeometry()
    for (let l = 0; l < LAYERS; l++) {
      const mats = pictureMaterials(l, N * SIZE)
      const g = geo.clone()
      const home = new Float32Array(PER * 2)
      for (let k = 0; k < PER; k++) {
        center(l * PER + k, _c)
        home[k * 2] = _c.x
        home[k * 2 + 1] = _c.z
      }
      g.setAttribute('aHome', new THREE.InstancedBufferAttribute(home, 2))
      const mesh = new THREE.InstancedMesh(g, mats, PER)
      for (let k = 0; k < PER; k++) {
        const i = l * PER + k
        center(i, _c)
        const hv = new THREE.Vector3(_c.x, _c.y, _c.z)
        st.vis.home.push(hv)
        st.vis.spin.push(new THREE.Vector3(ctx.rng.range(-3, 3), ctx.rng.range(-2, 2), ctx.rng.range(-3, 3)))
        mesh.setMatrixAt(k, _m.makeTranslation(hv.x, hv.y, hv.z))
        // Pieces are props for the camera (it doesn't bump into the puzzle above), solid for toys.
        st.colliders.push(ctx.phys.box({ x: _c.x, y: _c.y - THICK / 2, z: _c.z }, { x: SIZE / 2 - 0.01, y: THICK / 2, z: SIZE / 2 - 0.01 }, { friction: 0.8, groups: PROP_GROUPS }))
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      ctx.root.add(mesh)
      st.vis.meshes.push(mesh)
      st.vis.mats.push(mats as THREE.MeshStandardMaterial[])
    }
    // Colliders follow the synced drop times on every screen.
    ctx.hazards.add({
      update(c, t) {
        for (let i = 0; i < st.dropAt.length; i++) {
          const on = !(st.dropAt[i] >= 0 && st.dropAt[i] <= t)
          if (st.colliders[i].isEnabled() !== on) st.colliders[i].setEnabled(on)
        }
        void c
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    // One toy per piece, spread over the top puzzle.
    const step = Math.max(1, Math.floor(PER / Math.max(1, n)))
    const k = (i * step + Math.floor(step / 2)) % PER
    center(k, _c)
    return { x: _c.x, y: LAYER_Y[0], z: _c.z, yaw: ctx.rng.range(0, Math.PI * 2) }
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const active = ctx.active()
    const press = ctx.mode === 'show' ? Math.max(0, (t / 120 - 0.5) / 0.5) * (active.length > ctx.target ? 1 : 0.2) : 0
    const delay = Math.max(1.6, DELAY - t * 0.006 - press * 0.5)
    for (const toy of active) {
      const l = layerOf(toy)
      if (l >= 0 && l > s.layerOf[toy.idx]) {
        s.layerOf[toy.idx] = l
        ctx.fx.popup(toy, l === LAYERS - 1 ? 'Last puzzle!' : 'Down a layer!', l === LAYERS - 1 ? '#fca5a5' : '#c4b5fd')
        if (l === LAYERS - 1) ctx.fx.say('BOTTOM PUZZLE: NO MORE FLOORS BELOW', '#fca5a5', 1.4, toy)
      }
      // Standing on a piece starts it shaking.
      if (toy.grounded && l >= 0 && Math.abs(toy.feet - LAYER_Y[l]) < 0.3) {
        const i = cell(l, toy.pos.x, toy.pos.z)
        if (fresh(s, i)) {
          trigger(s, i, t, delay)
          if (ctx.rng.chance(0.3)) ctx.fx.sfx('tick', toy.pos)
        }
      }
      s.survive[toy.idx] += dt
      if (s.survive[toy.idx] >= 12) {
        s.survive[toy.idx] -= 12
        ctx.addSprinkles(toy, 1)
      }
    }
    // From 60 s the puzzles start to come apart on their own, faster and faster.
    if (t >= s.nextSelf) {
      s.nextSelf = t + Math.max(0.12, 0.9 - (t - SELF_FALL_AT) * 0.012 - press * 0.3)
      if (Math.floor(t) === SELF_FALL_AT && Math.floor(t - dt) < SELF_FALL_AT) ctx.fx.say('THE PUZZLES ARE CRUMBLING!', '#c4b5fd', 1.6)
      for (let k = 0; k < 6; k++) {
        const i = ctx.rng.int(0, PER * LAYERS)
        if (fresh(s, i)) {
          trigger(s, i, t, 1.4)
          break
        }
      }
    }
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const t = ctx.time
    const l = layerOf(toy)
    if (l < 0) return // falling
    const d = toy.data as { goal?: number; until?: number }
    const here = cell(l, toy.pos.x, toy.pos.z)
    const hereLeft = here >= 0 && s.dropAt[here] >= 0 ? s.dropAt[here] - t : 99
    // Score a candidate piece: solid and untouched, with solid neighbours, away from other toys.
    const score = (i: number) => {
      if (!fresh(s, i)) return -99
      center(i, _c)
      const k = i % PER
      const ix = k % N, iz = Math.floor(k / N)
      let nb = 0
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + ox, jz = iz + oz
        if (jx >= 0 && jz >= 0 && jx < N && jz < N && fresh(s, l * PER + jz * N + jx)) nb++
      }
      let crowd = 0
      for (const o of ctx.toys) if (o !== toy && o.status === 'play' && Math.hypot(o.pos.x - _c.x, o.pos.z - _c.z) < 1.6) crowd++
      const dist = Math.hypot(_c.x - toy.pos.x, _c.z - toy.pos.z)
      const edge = Math.min(ix, iz, N - 1 - ix, N - 1 - iz) === 0 ? 0.6 : 0
      return nb * 1.1 - crowd * 2 - Math.abs(dist - SIZE) * 0.8 - edge
    }
    const pickNext = () => {
      // Look round the 5x5 block around us for the best next piece.
      const k = here >= 0 ? here % PER : 0
      const ix = k % N, iz = Math.floor(k / N)
      let best = -1, bs = -1e9
      for (let ox = -2; ox <= 2; ox++)
        for (let oz = -2; oz <= 2; oz++) {
          const jx = ix + ox, jz = iz + oz
          if (jx < 0 || jz < 0 || jx >= N || jz >= N || (ox === 0 && oz === 0)) continue
          const i = l * PER + jz * N + jx
          const sc = score(i) + ctx.rng.range(-0.3, 0.3)
          if (sc > bs) {
            bs = sc
            best = i
          }
        }
      // Nothing fresh near: any solid piece on this layer.
      if (bs < -50) for (let i = l * PER; i < (l + 1) * PER; i++) if (solid(s, i, t + 0.6)) best = i
      return best
    }
    const goalOk = d.goal !== undefined && d.goal >= 0 && d.goal !== here && Math.floor(d.goal / PER) === l && solid(s, d.goal, t + 0.3)
    if (!goalOk) {
      // Patient bots stand on their piece until it is about to go (sloppy ones leave late or early).
      const late = ctx.rng.chance(sk.blunder * 0.5) ? 0.35 : 0
      if (here >= 0 && hereLeft > sk.reaction + 0.3 - late && (d.until ?? 0) < t + 99) {
        d.goal = here
        toy.pad.mx = toy.pad.mz = 0
        return
      }
      d.goal = pickNext()
      d.until = t + 2
    }
    const shaking = hereLeft < 50
    if (d.goal === undefined || d.goal < 0) return
    center(d.goal, _c)
    steerTo(toy, _c.x, _c.z, { pace: sk.pace * (shaking ? 1 : 0.8), stop: 0.2 })
    // Jump over holes in the way.
    const sp = Math.hypot(toy.pad.mx, toy.pad.mz)
    if (toy.grounded && sp > 0.2) {
      const ax = toy.pos.x + (toy.pad.mx / sp) * 0.8, az = toy.pos.z + (toy.pad.mz / sp) * 0.8
      const ahead = cell(l, ax, az)
      if (ahead !== here && !solid(s, ahead, t + 0.2)) toy.pad.jump = true
    }
    // Shove a rival who is standing on the piece we want.
    const r = nearestRival(ctx, toy, 1.3)
    if (r && ctx.rng.chance(sk.aggression * 0.5 * dt)) {
      toy.pad.mx = r.pos.x - toy.pos.x
      toy.pad.mz = r.pos.z - toy.pos.z
      toy.pad.shove = true
    }
  },

  rank(ctx, s) {
    return ctx.active().sort((a, b) => s.layerOf[a.idx] - s.layerOf[b.idx] || b.pos.y - a.pos.y)
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'highest puzzle', "lower down at the bell")
  },

  onFall(ctx, _s, toy) {
    ctx.fail(toy, 'fell through every puzzle')
  },

  retry(ctx, s, toy) {
    // Quick Play: back on top, on a solid piece if there is one.
    let pick = -1
    for (let k = 0; k < 40 && pick < 0; k++) {
      const i = ctx.rng.int(0, PER)
      if (fresh(s, i)) pick = i
    }
    for (let i = 0; i < PER * LAYERS && pick < 0; i++) if (fresh(s, i)) pick = i
    if (pick < 0) pick = 0
    center(pick, _c)
    s.layerOf[toy.idx] = Math.floor(pick / PER)
    ctx.respawn(toy, { x: _c.x, y: _c.y, z: _c.z, yaw: 0 }, 1)
  },

  pack(ctx, s) {
    // Dropped pieces as a hex bitmask, plus the ones still shaking with their times.
    const t = ctx.time
    let mask = ''
    for (let i = 0; i < s.dropAt.length; i += 4) {
      let v = 0
      for (let b = 0; b < 4; b++) if (s.dropAt[i + b] >= 0 && s.dropAt[i + b] <= t - 2) v |= 1 << b
      mask += v.toString(16)
    }
    const live: number[] = []
    for (let i = 0; i < s.dropAt.length; i++) if (s.dropAt[i] >= 0 && s.dropAt[i] > t - 2) live.push(i, r1(s.trigAt[i]), r1(s.dropAt[i]))
    return [mask, live]
  },

  unpack(_c, s, d) {
    const [mask, live] = d as [string, number[]]
    for (let i = 0; i < mask.length; i++) {
      const v = parseInt(mask[i], 16)
      for (let b = 0; b < 4; b++) {
        const k = i * 4 + b
        if (v & (1 << b) && s.dropAt[k] < 0) {
          s.dropAt[k] = 0.01
          s.trigAt[k] = 0
        }
      }
    }
    for (let i = 0; i < live.length; i += 3) {
      s.trigAt[live[i]] = live[i + 1]
      s.dropAt[live[i]] = live[i + 2]
    }
  },

  onEvent(ctx, s, data) {
    const e = data as { k?: string; l?: number }
    if (e.k !== 'knock' || e.l === undefined) return
    ctx.fxLocal.shake(0.5)
    void s
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    // Fade the puzzles between the camera and the toy it follows.
    const camY = ctx.cam.camera.position.y, focusY = ctx.cam.focus.y
    for (let l = 0; l < LAYERS; l++) {
      const fade = ctx.phase !== 'intro' && LAYER_Y[l] > focusY + 0.6 && LAYER_Y[l] < camY + 2
      if (fade !== v.faded[l]) {
        v.faded[l] = fade
        v.mats[l].forEach((m, k) => {
          m.transparent = fade
          m.opacity = fade ? (k === 0 ? 0.1 : 0) : 1
          m.depthWrite = !fade
          m.needsUpdate = true
        })
        v.meshes[l].castShadow = !fade
      }
    }
    // Shaking and falling pieces.
    const dirty = [false, false, false]
    for (let i = 0; i < s.dropAt.length; i++) {
      const da = s.dropAt[i]
      if (da < 0 || v.done[i]) continue
      const l = Math.floor(i / PER), k = i % PER
      const h = v.home[i]
      if (t < da) {
        // Shake harder as the drop nears.
        const left = da - t
        const amp = 0.02 + Math.max(0, 0.7 - left) * 0.08
        _q.setFromEuler(_e.set(Math.sin(t * 47 + i) * amp, 0, Math.cos(t * 53 + i) * amp))
        _p.set(h.x, h.y + Math.abs(Math.sin(t * 31 + i)) * amp * 0.6, h.z)
        v.meshes[l].setMatrixAt(k, _m.compose(_p, _q, _s))
      } else {
        const f = t - da
        if (f > FALL_HIDE) {
          v.meshes[l].setMatrixAt(k, _m.compose(h, _q.identity(), _zero))
          v.done[i] = 1
        } else {
          const sp = v.spin[i]
          _q.setFromEuler(_e.set(sp.x * f, sp.y * f, sp.z * f))
          _p.set(h.x + sp.y * f * 0.3, h.y - 12 * f * f, h.z + sp.x * f * 0.2)
          v.meshes[l].setMatrixAt(k, _m.compose(_p, _q, _s))
        }
      }
      dirty[l] = true
    }
    dirty.forEach((d, l) => {
      if (d) v.meshes[l].instanceMatrix.needsUpdate = true
    })
    void dt
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const left = [0, 0, 0]
    for (let i = 0; i < s.dropAt.length; i++) if (solid(s, i, t)) left[Math.floor(i / PER)]++
    const chips = left.map((n, l) => `${['Top', 'Middle', 'Bottom'][l]}: ${n}`)
    if (t < SELF_FALL_AT && ctx.phase === 'play') chips.push(`Crumbling in ${Math.ceil(SELF_FALL_AT - t)} s`)
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (me && me.status === 'play') {
      const l = layerOf(me)
      if (l >= 0) {
        status = { text: ['TOP PUZZLE', 'MIDDLE PUZZLE', 'LAST PUZZLE!'][l], color: ['#c4b5fd', '#93c5fd', '#fca5a5'][l], pulse: l === LAYERS - 1 }
        const i = cell(l, me.pos.x, me.pos.z)
        if (i >= 0 && s.dropAt[i] > t) prompt = 'Your piece is shaking: move!'
        else if (t < 5) prompt = 'Keep moving: every piece you step on drops a moment later.'
      }
    }
    return { chips, prompt, status }
  },
})
