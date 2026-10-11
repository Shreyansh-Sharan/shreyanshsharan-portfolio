// BOGEY BRAWL engine: one hole played by everyone at once. Swings, the ball race, melee, items, hazards,
// checkpoints, scoring, the third-person camera and the HUD feed.
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { CONFIG, deg } from './config'
import { Course } from './course'
import { Ground, launch, stepBall, type BallMode } from './ball'
import { Golfer, type ItemType, type MoveInput, type Personality } from './golfer'
import { makeGolfer, prop, type GolfAssets, type PropName } from './assets'
import { aiThink } from './ai'
import { Particles, Trail } from '../racer/fx'
import { isMuted } from '../lib/sound'
import { isGolfMsg, type GolfNet, type GolfSlot } from './net'

export type Phase = 'intro' | 'play' | 'overtime' | 'results'

export const ITEM_INFO: Record<ItemType, { name: string; color: string; enabled: boolean }> = {
  rocket: { name: 'Rocket Launcher', color: '#f97316', enabled: true },
  pistol: { name: 'Dueling Pistol', color: '#facc15', enabled: true },
  shield: { name: 'Electromagnet', color: '#38bdf8', enabled: true },
  landmine: { name: 'Landmine', color: '#ef4444', enabled: true },
  laser: { name: 'Orbital Laser', color: '#e879f9', enabled: false },
  airhorn: { name: 'Air Horn', color: '#a3e635', enabled: true },
  cart: { name: 'Golf Cart', color: '#f8fafc', enabled: false },
  coffee: { name: 'Coffee', color: '#a16207', enabled: true },
  springboots: { name: 'Spring Boots', color: '#22d3ee', enabled: true },
  elephant: { name: 'Elephant Gun', color: '#78716c', enabled: true },
  driver: { name: 'Rocket Driver', color: '#fb7185', enabled: false },
  freeze: { name: 'Freeze Bomb', color: '#bae6fd', enabled: true },
}

const PLAYERS: { name: string; color: string; personality: Personality }[] = [
  { name: 'You', color: '#3b82f6', personality: 'Golfer' },
  { name: 'Mulligan', color: '#ef4444', personality: 'Griefer' },
  { name: 'Birdie', color: '#facc15', personality: 'Golfer' },
  { name: 'Divot', color: '#22c55e', personality: 'Sniper' },
]

export interface GolfOptions {
  difficulty: number
  bots: number // 1–3 (solo)
  assets: GolfAssets | null
  autopilot?: boolean
  /** Online: who plays, and this browser's role. Solo when absent. */
  net?: GolfNet
}

/** Item order for compact snapshots. */
const ITEM_CODES = Object.keys(ITEM_INFO) as ItemType[]

/** One player's controls: held values plus one-shot actions since the last frame. */
interface Pad {
  x: number
  y: number
  yaw: number
  loft: number
  creep: boolean
  acts: string[]
  /** Online clients report where they've moved their own golfer. */
  pos?: [number, number, number, number]
}

/** Visual and sound events: played locally and, on the host, streamed to everyone (`to` = one player only). */
type V3 = [number, number, number]
type FxEv =
  | { k: 'boom'; p: V3; small?: boolean }
  | { k: 'splash'; p: V3 }
  | { k: 'tracer'; a: V3; b: V3 }
  | { k: 'thwack'; v: number }
  | { k: 'whack' }
  | { k: 'groan' }
  | { k: 'cup'; c: string }
  | { k: 'block'; p: V3 }
  | { k: 'ice'; p: V3 }
  | { k: 'horn'; p: V3 }
  | { k: 'lob'; a: V3; b: V3; t: number }
  | { k: 'leap'; p: V3 }
  | { k: 'say'; s: string; c: string; t: number }
  | { k: 'feed'; s: string; ids: number[] }
  | { k: 'pop'; s: string; c: string; p: V3 }
  | { k: 'beep'; f: number; d: number; w: OscillatorType; g: number }
  | { k: 'shake'; v: number }
type Targeted = FxEv & { to?: string }

const BALL_MODES: BallMode[] = ['rest', 'rolling', 'air', 'water', 'holed']
const v3 = (p: THREE.Vector3): V3 => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100]

/** Host → clients, 20 times a second. Golfer rows are flat number arrays (see buildSnap for the layout). */
interface Snap {
  ph: Phase
  pt: number
  g: number[][]
  r: number[][]
  c: number[][]
  m: number[][]
}

interface Mine {
  id: number
  owner: Golfer
  pos: THREE.Vector3
  arm: number // seconds until armed
  life: number
  mesh: THREE.Object3D
}

interface Lob {
  owner: Golfer
  to: THREE.Vector3
  t: number
}

export interface Hud {
  phase: Phase
  hole: { name: string; biome: string; par: number }
  time: number
  overtime: boolean
  board: { id: number; name: string; color: string; strokes: number; points: number; finished: boolean; place: number; me: boolean }[]
  items: (ItemType | null)[]
  active: number
  power: number | null
  loft: number
  putt: boolean
  canSwing: boolean
  strokes: number
  boost: number
  shield: number
  protect: number
  stun: number
  respawn: number
  lockOn: boolean
  markers: { id: number; x: number; y: number; color: string; dist: number; me: boolean }[]
  feed: { id: number; text: string; mine: boolean }[]
  popups: { id: number; text: string; color: string; x: number; y: number; age: number }[]
  banner: { text: string; color: string } | null
  hint: string
  locked: boolean
}

export interface ResultRow {
  id: number
  name: string
  color: string
  me: boolean
  place: number // finishing place (0 = did not finish)
  strokes: number
  breakdown: { label: string; points: number }[]
  total: number
}

export interface HoleResult {
  rows: ResultRow[]
  highlight: string
  par: number
  name: string
}

interface Rocket {
  id: number
  owner: Golfer
  target: Golfer | null
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  mesh: THREE.Object3D
  trail: Trail
}

interface Case {
  id: number
  pos: THREE.Vector3
  ready: boolean
  timer: number
  mesh: THREE.Object3D
  item?: ItemType // a dropped item lying on the ground instead of a briefcase
}

export class Game {
  readonly opts: GolfOptions
  readonly course = new Course()
  readonly ground: Ground
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
  readonly renderer: THREE.WebGLRenderer
  readonly fx_ = new Particles(1500, true)
  readonly smoke = new Particles(800, false)
  golfers: Golfer[] = []
  me!: Golfer
  cases: Case[] = []
  rockets: Rocket[] = []
  mines: Mine[] = []
  phase: Phase = 'intro'
  time = 0
  phaseTime = 0
  holeTime: number
  onHud: ((h: Hud) => void) | null = null
  onResult: ((r: HoleResult) => void) | null = null
  /** Online: the host left (clients) — the page goes back to the menu. */
  onDisconnect: ((why: string) => void) | null = null
  readonly role: 'solo' | 'host' | 'client'

  private container: HTMLElement
  private raf = 0
  private last = 0
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private mouseDown = false
  private mousePressed = false
  private mouseReleased = false
  private rightPressed = false
  private wheel = 0
  private camYaw = 0
  private camPitch = 0.28
  private locked = false
  private finishedCount = 0
  private feedList: { id: number; text: string; mine: boolean; age: number }[] = []
  private popups: { id: number; text: string; color: string; pos: THREE.Vector3; age: number }[] = []
  private nextId = 0
  private banner: { text: string; color: string; t: number } | null = null
  private aimLine: THREE.Points
  private checkpointMeshes: THREE.Group[] = []
  private shieldMeshes = new Map<Golfer, THREE.Mesh>()
  private tracers: { line: THREE.Line; t: number }[] = []
  private sheep: { obj: THREE.Object3D; target: THREE.Vector3; wait: number }[] = []
  private balloons: THREE.Object3D[] = []
  private sun: THREE.DirectionalLight
  private resultSent = false
  private audio: AudioContext | null = null
  private ro: ResizeObserver
  private shake = 0
  // Items in flight and on the ground.
  private lobs: Lob[] = []
  private flying: { mesh: THREE.Object3D; a: THREE.Vector3; b: THREE.Vector3; t: number; dur: number }[] = []
  private iceMeshes = new Map<Golfer, THREE.Mesh>()
  private entityId = 1000
  // Online.
  private remotePads = new Map<string, Pad>()
  private outEvents: Targeted[] = []
  private snapT = 0
  private inputT = 0
  private pendingActs: string[] = []
  private snap: { s: Snap; at: number } | null = null
  private unsub: (() => void)[] = []

  constructor(container: HTMLElement, opts: GolfOptions) {
    this.container = container
    this.opts = opts
    this.role = opts.net ? opts.net.role : 'solo'
    this.ground = new Ground(this.course)
    this.holeTime = this.course.hole.par <= 3 ? CONFIG.hole_time_par3 : this.course.hole.par === 4 ? CONFIG.hole_time_par4 : CONFIG.hole_time_par5

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.9
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'golf-canvas'
    container.appendChild(this.renderer.domElement)

    this.buildWorld()
    this.spawnGolfers()

    const pts = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(90 * 3), 3))
    this.aimLine = new THREE.Points(pts, new THREE.PointsMaterial({ color: '#ffffff', size: 0.28, transparent: true, opacity: 0.9, depthWrite: false }))
    this.aimLine.frustumCulled = false
    this.aimLine.visible = false
    this.scene.add(this.aimLine)
    this.scene.add(this.fx_.points, this.smoke.points)

    this.sun = this.scene.getObjectByName('sun') as THREE.DirectionalLight
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    const el = this.renderer.domElement
    el.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    document.addEventListener('pointerlockchange', this.onLockChange)
    this.camYaw = Math.atan2(this.course.hole.route[1][0], this.course.hole.route[1][1])
    this.banner = { text: `${this.course.hole.name} · Par ${this.course.hole.par}`, color: '#fde047', t: 3 }
    if (opts.net) this.listen(opts.net)
  }

  /* ---------- World ---------- */

  private buildWorld() {
    const s = this.scene
    const a = this.opts.assets
    s.background = new THREE.Color('#9fd4ff')
    s.fog = new THREE.Fog('#bfe3ff', 260, 900)
    const sky = new Sky()
    sky.scale.setScalar(4000)
    const u = sky.material.uniforms
    u.turbidity.value = 2.2
    u.rayleigh.value = 1.4
    u.mieCoefficient.value = 0.004
    u.mieDirectionalG.value = 0.8
    const sunDir = new THREE.Vector3(0.45, 0.62, -0.35).normalize()
    u.sunPosition.value.copy(sunDir).multiplyScalar(1000)
    s.add(sky)
    s.add(new THREE.HemisphereLight('#dff1ff', '#5b7a3a', 1.1))
    const sun = new THREE.DirectionalLight('#fff4dd', 2.4)
    sun.name = 'sun'
    sun.position.copy(sunDir).multiplyScalar(120)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = sc.bottom = -70
    sc.right = sc.top = 70
    sc.near = 10
    sc.far = 400
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.04
    s.add(sun, sun.target)

    s.add(this.course.buildMesh())
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#2b9fd6', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    )
    water.position.y = 0.02
    s.add(water)

    // Tee mat and markers.
    const tee = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 5), new THREE.MeshStandardMaterial({ color: '#4ade80', roughness: 0.9 }))
    tee.position.set(0, this.course.tee.y + 0.04, 0)
    tee.receiveShadow = true
    s.add(tee)
    for (const x of [-4, 4]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshStandardMaterial({ color: '#f8fafc' }))
      m.position.set(x, this.course.tee.y + 0.25, 1.5)
      s.add(m)
    }

    // Cup and flag.
    const cup = this.course.cup
    const hole = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.cup_radius, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b0f0a' }))
    hole.position.set(cup.x, this.ground.y(cup.x, cup.z) + 0.03, cup.z)
    s.add(hole)
    s.add(a?.props.flag ? place(prop(a.props.flag, 3.2), cup.x + 0.05, this.ground.y(cup.x, cup.z), cup.z) : fallbackFlag(cup, this.ground))

    // Trees: instanced per model.
    const groups = new Map<string, THREE.Matrix4[]>()
    for (const t of this.course.trees) {
      const list = groups.get(t.kind) ?? []
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(t.x, this.ground.y(t.x, t.z) - 0.1, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0)), new THREE.Vector3(t.scale, t.scale, t.scale)))
      groups.set(t.kind, list)
    }
    const treeModel: Record<string, PropName> = { tree: 'tree', pine: 'pine', autumn: 'autumn-tree', palm: 'palm' }
    const treeHeight: Record<string, number> = { tree: 7, pine: 9, autumn: 7.5, palm: 8 }
    for (const [kind, mats] of groups) {
      const src = a?.props[treeModel[kind]]
      s.add(src ? instanced(prop(src, treeHeight[kind]), mats) : fallbackTrees(mats, kind))
    }

    // Briefcases.
    for (const p of this.course.briefcases) {
      const mesh = new THREE.Group()
      mesh.add(a?.props.briefcase ? prop(a.props.briefcase, 1.1) : new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.4), new THREE.MeshStandardMaterial({ color: '#7c3aed' })))
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#a855f7', transparent: true, opacity: 0.55, depthWrite: false }))
      glow.position.y = -0.55
      mesh.add(glow)
      mesh.position.set(p.x, p.y + 0.8, p.z)
      s.add(mesh)
      this.cases.push({ id: this.cases.length, pos: p.clone(), ready: true, timer: 0, mesh })
    }

    // Checkpoints: floating rings, red until you pass them.
    for (const c of this.course.checkpoints) {
      const g = new THREE.Group()
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 28), new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#7f1d1d' }))
      ring.position.y = 3.2
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#e5e7eb' }))
      pole.position.y = 1.6
      g.add(ring, pole)
      g.position.copy(c)
      s.add(g)
      this.checkpointMeshes.push(g)
    }

    // Scenery: clubhouse, benches, cart, windmill, rocks, bushes, sheep, tractor, signpost, balloons.
    const addProp = (name: PropName, size: number, x: number, z: number, yaw = 0, collide = 0, h = 5) => {
      const src = a?.props[name]
      if (!src) return null
      const obj = place(prop(src, size), x, this.ground.y(x, z) - 0.05, z)
      obj.rotation.y = yaw
      s.add(obj)
      if (collide) this.course.trees.push({ x, z, r: collide, kind: 'prop', scale: 1, yaw, h })
      return obj
    }
    addProp('clubhouse', 11, -28, -26, 0.5, 9, 12)
    addProp('tractor', 2.6, -12, -36, 1.4, 2)
    addProp('barrels', 1.3, -18, -15, 0, 1)
    addProp('signpost', 2.6, -6, 3, Math.PI / 2, 0.4)
    addProp('cart', 1.9, 7, -4, -0.3, 1.4, 2)
    addProp('bench', 1.0, -7, -6, 0.2, 0.9, 1.2)
    addProp('bench', 1.0, this.course.hole.green[0] + 22, this.course.hole.green[1] + 6, -1.6, 0.9, 1.2)
    addProp('podium', 1.8, -16, -42, 0.5, 2.2)
    addProp('trophy', 1.2, -16, -42.2 + 0, 0.5)
    addProp('windmill', 16, -58, 205, 0.8, 4, 16)
    addProp('windmill', 13, 255, 60, -0.6, 3.5, 14)
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0, placed = 0; k < 400 && placed < 26; k++) {
      const x = -60 + rnd() * 320, z = -40 + rnd() * 360
      const d = this.course.routeNearest(x, z).dist
      if (d < 16 || this.ground.y(x, z) < 1 || this.course.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) continue
      const rock = rnd() < 0.45
      if (addProp(rock ? 'rocks' : 'bush', rock ? 1.6 + rnd() * 1.4 : 1.1 + rnd() * 0.5, x, z, rnd() * 6, rock ? 1.4 : 0)) placed++
    }
    // A flock in the rough on the far side of the lake.
    for (let k = 0; k < 7; k++) {
      const x = 120 + rnd() * 30, z = 60 + rnd() * 30
      const obj = addProp('sheep', 1.1, x, z, rnd() * 6)
      if (obj) this.sheep.push({ obj, target: new THREE.Vector3(x, 0, z), wait: rnd() * 5 })
    }
    for (let k = 0; k < 3; k++) {
      const src = a?.props.balloon
      if (!src) break
      const b = prop(src, 14)
      b.position.set(-80 + k * 160, 70 + k * 18, 120 + k * 60)
      s.add(b)
      this.balloons.push(b)
    }
  }

  private spawnGolfers() {
    const skill = CONFIG.ai_skill[this.opts.difficulty] ?? 0.55
    // Solo: you plus 1–3 bots. Online: the lobby's slots, people first.
    const slots: GolfSlot[] = this.opts.net?.slots ?? [
      { kind: 'human', id: 'local', name: PLAYERS[0].name },
      ...PLAYERS.slice(1, 1 + Math.max(1, Math.min(3, this.opts.bots))).map((p, i) => ({ kind: 'ai' as const, id: `ai-${i}`, name: p.name })),
    ]
    const selfId = this.opts.net ? this.opts.net.link.selfId : 'local'
    const count = slots.length
    slots.forEach((slot, i) => {
      const p = PLAYERS[i % PLAYERS.length]
      const human = slot.kind === 'human'
      const rig = makeGolfer(this.opts.assets, p.color)
      const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: p.color, emissiveIntensity: 0.25 }))
      ballMesh.castShadow = true
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.7 }))
      marker.position.y = 1.2
      ballMesh.add(marker)
      const tee = this.course.tee.clone()
      // Bots get a little random spread in skill (decided by the host; clients never run them).
      const g = new Golfer(i, slot.name, p.color, human, human ? 1 : THREE.MathUtils.clamp(skill + (Math.random() - 0.5) * 0.1, 0.2, 0.95), p.personality, rig, ballMesh, tee)
      g.remoteId = human ? slot.id : null
      // Balls in a row on the tee, golfers behind them.
      const x = (i - (count - 1) / 2) * 2
      g.ball.pos.set(x, this.ground.y(x, 0.5) + CONFIG.ball_radius, 0.5)
      g.pos.set(x, this.ground.y(x, -1.2), -1.2)
      g.yaw = 0
      g.aim = this.camYaw
      this.scene.add(rig.root, ballMesh)
      this.golfers.push(g)
      if (slot.id === selfId) this.me = g
    })
    if (!this.me) this.me = this.golfers[0]
    for (const g of this.golfers) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(CONFIG.shield_block_radius, 20, 14),
        new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      bubble.position.y = 0.95
      bubble.visible = false
      g.rig.root.add(bubble)
      this.shieldMeshes.set(g, bubble)
      const ice = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 2.1, 1.3),
        new THREE.MeshStandardMaterial({ color: '#bae6fd', transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.1, emissive: '#0ea5e9', emissiveIntensity: 0.25 }),
      )
      ice.position.y = 1
      ice.visible = false
      g.rig.root.add(ice)
      this.iceMeshes.set(g, ice)
    }
  }

  /* ---------- Lifecycle ---------- */

  start() {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = THREE.MathUtils.clamp((now - this.last) / 1000, 0, 0.05)
      this.last = now
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    for (const u of this.unsub) u()
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    void this.audio?.close()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** Test hook (?snap): advance without the live loop. */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    this.frame(step, true)
  }

  debugState() {
    return {
      phase: this.phase,
      time: +this.time.toFixed(1),
      golfers: this.golfers.map((g) => ({
        name: g.name, strokes: g.strokes, ball: g.ball.mode, bx: +g.ball.pos.x.toFixed(1), bz: +g.ball.pos.z.toFixed(1), x: +g.pos.x.toFixed(1), z: +g.pos.z.toFixed(1),
        finished: g.finished, place: g.finishPlace, items: g.inventory.join(','), ko: g.knockouts, stun: +g.stun.toFixed(1), cp: g.passed.size,
      })),
      rockets: this.rockets.length,
      feed: this.feedList.map((f) => f.text),
    }
  }

  /* ---------- Input ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.code
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) e.preventDefault()
    if (e.metaKey || e.ctrlKey) return
    if (!this.keys.has(k)) this.pressed.add(k)
    this.keys.add(k)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    this.mouseDown = false
  }

  private onMouseDown = (e: MouseEvent) => {
    this.ensureAudio()
    if (!this.locked) {
      this.renderer.domElement.requestPointerLock?.()
      return
    }
    if (e.button === 0) {
      this.mouseDown = true
      this.mousePressed = true
    } else if (e.button === 2) this.rightPressed = true
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 && this.mouseDown) {
      this.mouseDown = false
      this.mouseReleased = true
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return
    this.camYaw -= e.movementX * 0.0032
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * 0.0024, -0.15, 1.1)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.wheel += Math.sign(e.deltaY)
  }

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement
  }

  /* ---------- Frame ---------- */

  private frame(dt: number, render = true) {
    this.time += dt
    this.phaseTime += dt
    const pressed = this.pressed
    this.pressed = new Set()
    const pad = this.localPad(pressed)
    if (this.role === 'client') this.clientFrame(dt, pad)
    else this.simFrame(dt, pad)
    this.updateFlying(dt)
    this.updateEffects(dt)
    this.updateCamera(dt)
    if (!render) return
    this.renderer.render(this.scene, this.camera)
    this.emitHud()
  }

  /** Solo and host: run the hole. */
  private simFrame(dt: number, pad: Pad) {
    if (this.phase === 'intro' && this.phaseTime > 3) this.setPhase('play')
    if (this.phase === 'play' && this.phaseTime >= this.holeTime) {
      if (this.golfers.some((g) => !g.finished)) {
        this.setPhase('overtime')
        this.fx({ k: 'say', s: 'OVERTIME', c: '#f87171', t: 2 })
        this.fx({ k: 'beep', f: 220, d: 0.4, w: 'sine', g: 0.08 })
      } else this.endHole()
    }
    if (this.phase === 'overtime' && this.phaseTime >= CONFIG.overtime) {
      for (const g of this.golfers) if (!g.finished) g.timedOut = true
      this.endHole()
    }
    if ((this.phase === 'play' || this.phase === 'overtime') && this.golfers.every((g) => g.finished)) this.endHole()

    const playing = this.phase === 'play' || this.phase === 'overtime'
    for (const g of this.golfers) {
      let m: MoveInput | null = null
      if (playing) {
        if (g === this.me && this.opts.autopilot) m = aiThink(this, g, dt)
        else if (g.human) m = this.applyPad(g, g === this.me ? pad : this.padFor(g))
        else m = aiThink(this, g, dt)
      }
      g.update(dt, m, this.ground, this.course, this.golfers)
      if (g.charging > 0) g.charging += dt
      // A remote player moves their own golfer; trust it while nothing here is pushing them around.
      const rp = g !== this.me && g.remoteId ? this.remotePads.get(g.remoteId)?.pos : undefined
      if (rp && !this.forced(g) && Math.hypot(rp[0] - g.pos.x, rp[2] - g.pos.z) < 6) {
        g.pos.set(rp[0], rp[1], rp[2])
        g.yaw = rp[3]
      }
      this.afterMove(g, dt)
    }
    // Balls.
    for (const g of this.golfers) {
      const ev = stepBall(g.ball, dt, this.ground, this.course)
      if (ev.holed) this.holed(g)
      if (ev.water) {
        this.fx({ k: 'splash', p: v3(g.ball.pos) })
        this.startRespawn(g)
      }
      if (ev.bounced && this.near(g.ball.pos, 60)) this.beep(140, 0.05, 'triangle', 0.05)
      // Players nudge loose balls they run into.
      if (g.ball.mode === 'rest') {
        for (const o of this.golfers) {
          if (o.respawn > 0) continue
          const dx = g.ball.pos.x - o.pos.x, dz = g.ball.pos.z - o.pos.z
          const d = Math.hypot(dx, dz)
          const sp = o.vel.length()
          if (d < 0.55 && sp > 4 && o.charging <= 0) {
            g.ball.vel.set((dx / d) * sp * 0.5, 0, (dz / d) * sp * 0.5)
            g.ball.mode = 'rolling'
          }
        }
      }
      g.ballMesh.position.copy(g.ball.pos)
      g.ballMesh.visible = g.ball.mode !== 'holed'
    }
    this.updateRockets(dt)
    this.updateMines(dt)
    this.updateLobs(dt)
    this.updateCases(dt)
    for (const r of this.remotePads.values()) r.acts = []
    // Host: stream the state at 20 Hz with the effects since the last snapshot.
    if (this.role === 'host' && this.opts.net) {
      this.snapT -= dt
      if (this.snapT <= 0) {
        this.snapT = 1 / CONFIG.net_snapshot_hz
        this.opts.net.link.send({ t: 'g-snap', s: this.buildSnap(), e: this.outEvents })
        this.outEvents = []
      }
    }
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.phaseTime = 0
  }

  /** This browser's controls as a pad: held movement and aim, plus the one-shot actions since last frame. */
  private localPad(pressed: Set<string>): Pad {
    const k = this.keys
    const acts: string[] = []
    if (pressed.has('Digit1')) acts.push('s1')
    if (pressed.has('Digit2')) acts.push('s2')
    if (pressed.has('Digit3')) acts.push('s3')
    if (pressed.has('KeyQ')) acts.push('cycle')
    if (pressed.has('KeyF')) acts.push('drop')
    if (pressed.has('Space')) acts.push('jump')
    if (pressed.has('ShiftLeft') || pressed.has('ShiftRight') || pressed.has('ControlLeft')) acts.push('dive')
    if (this.rightPressed) acts.push('item')
    if (this.mousePressed) acts.push('press')
    if (this.mouseReleased) acts.push('release')
    this.rightPressed = this.mousePressed = this.mouseReleased = false
    // Wheel adjusts loft.
    if (this.wheel !== 0) {
      this.me.loft = THREE.MathUtils.clamp(this.me.loft - this.wheel * deg(4), deg(CONFIG.loft_min), deg(CONFIG.loft_max))
      this.wheel = 0
    }
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    return { x, y, yaw: this.camYaw, loft: this.me.loft, creep: k.has('KeyC') || k.has('AltLeft'), acts }
  }

  private padFor(g: Golfer): Pad {
    return this.remotePads.get(g.remoteId ?? '') ?? { x: 0, y: 0, yaw: g.aim, loft: g.loft, creep: false, acts: [] }
  }

  /** A person's pad drives their golfer: slots, drop, items, swing (hold to charge at your ball, else a club attack). */
  private applyPad(g: Golfer, pad: Pad): MoveInput {
    g.aim = pad.yaw
    g.loft = THREE.MathUtils.clamp(pad.loft, deg(CONFIG.loft_min), deg(CONFIG.loft_max))
    for (const a of pad.acts) {
      if (a === 's1') g.active = 0
      else if (a === 's2') g.active = 1
      else if (a === 's3') g.active = 2
      else if (a === 'cycle') g.active = (g.active + 1) % 3
      else if (a === 'drop') this.drop(g)
      else if (a === 'item' && g.canAct && g.charging <= 0) this.useItem(g)
      else if (a === 'press' && g.canAct && g.cooldown <= 0) {
        if (this.canSwing(g)) this.startCharge(g, pad.yaw)
        else this.melee(g)
      }
    }
    if (g.charging > 0) this.faceShot(g, pad.yaw)
    if (pad.acts.includes('release') && g.charging > 0) this.release(g, pad.yaw, g.loft)
    return { x: pad.x, y: pad.y, yaw: pad.yaw, jump: pad.acts.includes('jump'), dive: pad.acts.includes('dive'), creep: pad.creep }
  }

  /** The host is moving this golfer itself (knocked about, lining up a swing, respawning...). */
  private forced(g: Golfer) {
    return g.stun > 0 || g.respawn > 0 || g.charging > 0 || g.finished || g.leap > 0 || g.frozen > 0 || g.kb.lengthSq() > 1
  }

  /* ---------- Swing ---------- */

  canSwing(g: Golfer) {
    return g.ball.mode === 'rest' && g.ball.pos.distanceTo(g.pos) < CONFIG.swing_reach && g.canAct
  }

  isPutt(g: Golfer) {
    return this.ground.surface(g.ball.pos.x, g.ball.pos.z) === 'green'
  }

  /** Stand beside the ball, side-on to the target (the swing clip addresses the ball facing across the line). */
  faceShot(g: Golfer, dir: number) {
    const fx = Math.sin(dir), fz = Math.cos(dir)
    // The golfer's left points at the target; the ball sits in front of their feet.
    g.yaw = dir - Math.PI / 2
    const sx = Math.sin(g.yaw), sz = Math.cos(g.yaw)
    g.pos.x = g.ball.pos.x - sx * 0.62 + fx * 0.03
    g.pos.z = g.ball.pos.z - sz * 0.62 + fz * 0.03
    g.vel.set(0, 0, 0)
  }

  startCharge(g: Golfer, dir: number) {
    if (!this.canSwing(g) || g.cooldown > 0) return
    this.faceShot(g, dir)
    g.charging = 0.0001
  }

  power(g: Golfer) {
    return Math.min(1, g.charging / CONFIG.swing_charge_time)
  }

  release(g: Golfer, dir: number, loft: number) {
    const power = Math.max(0.03, this.power(g))
    g.charging = 0
    g.swing = 0.5
    g.cooldown = CONFIG.swing_cooldown
    if (g.ball.mode !== 'rest' || g.ball.pos.distanceTo(g.pos) > CONFIG.swing_reach + 0.5) return
    const putt = this.isPutt(g)
    g.ball.vel.copy(launch(dir, power, loft, putt))
    g.ball.mode = putt ? 'rolling' : 'air'
    g.strokes++
    this.fx({ k: 'thwack', v: putt ? 0.4 : power })
  }

  /** A club swing with no ball nearby is a melee attack. */
  melee(g: Golfer) {
    if (!g.canAct || g.swing > 0 || g.cooldown > 0) return
    g.swing = 0.5
    g.cooldown = CONFIG.swing_cooldown
    const f = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw))
    for (const o of this.golfers) {
      if (o === g) continue
      const d = o.pos.clone().sub(g.pos).setY(0)
      const dist = d.length()
      if (dist > CONFIG.melee_range || dist < 0.01) continue
      if (d.normalize().dot(f) < 0.25) continue
      if (this.knock(o, g, 'Club', CONFIG.melee_stun, 3, d, false)) {
        g.boost = Math.max(g.boost, CONFIG.melee_boost)
        this.fx({ k: 'whack' })
      }
    }
  }

  /* ---------- Items ---------- */

  useItem(g: Golfer, target?: Golfer) {
    const it = g.inventory[g.active]
    if (!it || !ITEM_INFO[it].enabled) return false
    // Landmines come in a pack: the slot empties on the last one.
    if (it === 'landmine' && (g.mineCharges = (g.mineCharges || CONFIG.landmine_charges) - 1) > 0) {
      /* keep the item */
    } else g.take()
    // Where it's aimed: at the target for bots, along the camera for people.
    const yaw = target ? Math.atan2(target.pos.x - g.pos.x, target.pos.z - g.pos.z) : this.aimYaw(g)
    if (target) g.yaw = yaw
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    if (it === 'rocket') {
      const tgt = target ?? this.nearestRival(g, CONFIG.rocket_lock_range)
      const f = fwd.clone().setY(0.15).normalize()
      const r = this.makeRocket(this.entityId++, g.pos.clone().setY(g.pos.y + 1.4).addScaledVector(f, 1), f.multiplyScalar(CONFIG.rocket_speed))
      this.rockets.push({ ...r, owner: g, target: tgt, life: CONFIG.rocket_lifetime })
      this.fx({ k: 'beep', f: 320, d: 0.25, w: 'sawtooth', g: 0.08 })
    } else if (it === 'pistol') {
      // Hitscan along the aim.
      const from = g.pos.clone().setY(g.pos.y + 1.4)
      const dir = target
        ? target.pos.clone().setY(target.pos.y + 1).sub(from).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.12 * (1 - g.skill))
        : fwd.clone().setY(-0.03).normalize()
      g.yaw = Math.atan2(dir.x, dir.z)
      let hit: Golfer | null = null
      let best: number = CONFIG.pistol_range
      for (const o of this.golfers) {
        if (o === g || o.respawn > 0 || o.finished) continue
        const to = o.pos.clone().setY(o.pos.y + 1).sub(from)
        const along = to.dot(dir)
        if (along < 0 || along > best) continue
        const off = to.clone().addScaledVector(dir, -along).length()
        if (off < 0.8) {
          best = along
          hit = o
        }
      }
      const end = from.clone().addScaledVector(dir, hit ? best : CONFIG.pistol_range)
      this.fx({ k: 'tracer', a: v3(from), b: v3(end) })
      if (hit) this.knock(hit, g, 'Dueling Pistol', CONFIG.pistol_stun, 2, dir.clone().setY(0), true)
    } else if (it === 'shield') {
      g.shield = CONFIG.shield_duration
      this.fx({ k: 'beep', f: 660, d: 0.3, w: 'sine', g: 0.06 })
    } else if (it === 'landmine') {
      const p = g.pos.clone().addScaledVector(fwd, -1.6)
      p.y = this.ground.y(p.x, p.z)
      this.mines.push({ id: this.entityId++, owner: g, pos: p, arm: CONFIG.landmine_arm_time, life: CONFIG.landmine_lifetime, mesh: this.makeMine(p) })
      this.fx({ k: 'beep', f: 420, d: 0.12, w: 'square', g: 0.05 })
    } else if (it === 'airhorn') {
      // A wall of sound: rivals nearby are blown back and loose balls nearby go flying.
      this.fx({ k: 'horn', p: v3(g.pos) })
      for (const o of this.golfers) {
        if (o === g) continue
        const d = o.pos.distanceTo(g.pos)
        if (d < CONFIG.airhorn_range) this.knock(o, g, 'Air Horn', CONFIG.airhorn_stun, CONFIG.airhorn_knockback * (1 - d / CONFIG.airhorn_range), o.pos.clone().sub(g.pos), false)
        const b = o.ball
        const bd = b.pos.distanceTo(g.pos)
        if ((b.mode === 'rest' || b.mode === 'rolling') && bd < CONFIG.airhorn_range) {
          const push = b.pos.clone().sub(g.pos).setY(0).normalize().multiplyScalar(CONFIG.airhorn_ball_speed * CONFIG.airhorn_overshoot_mult * (1 - bd / CONFIG.airhorn_range))
          b.vel.copy(push).setY(3)
          b.mode = 'air'
        }
      }
    } else if (it === 'coffee') {
      g.boost = Math.max(g.boost, CONFIG.coffee_duration)
      this.fx({ k: 'beep', f: 740, d: 0.2, w: 'triangle', g: 0.07 })
    } else if (it === 'freeze') {
      const to = g.pos.clone().addScaledVector(fwd, CONFIG.freeze_throw)
      to.y = this.ground.y(to.x, to.z)
      this.lobs.push({ owner: g, to, t: CONFIG.freeze_fuse })
      this.fx({ k: 'lob', a: v3(g.pos.clone().setY(g.pos.y + 1.5)), b: v3(to), t: CONFIG.freeze_fuse })
    } else if (it === 'springboots') {
      // An arcing leap along the aim; you can't steer until you land.
      const vy = CONFIG.springboots_jump_speed
      const flight = (2 * vy) / CONFIG.jump_gravity
      g.vy = vy
      g.grounded = false
      g.leap = flight
      g.leapVel.copy(fwd).multiplyScalar(CONFIG.springboots_distance / flight)
      g.yaw = yaw
      this.fx({ k: 'leap', p: v3(g.pos) })
    } else if (it === 'elephant') {
      // A huge close-range blast in a cone; the recoil throws you back too.
      const from = g.pos.clone().setY(g.pos.y + 1.3)
      this.fx({ k: 'boom', p: v3(from.clone().addScaledVector(fwd, 1.2)), small: true })
      const cone = Math.cos(deg(CONFIG.elephant_cone))
      for (const o of this.golfers) {
        if (o === g) continue
        const to = o.pos.clone().sub(g.pos).setY(0)
        const d = to.length()
        if (d < CONFIG.elephant_range && d > 0.01 && to.normalize().dot(fwd) > cone) this.knock(o, g, 'Elephant Gun', CONFIG.elephant_stun, CONFIG.elephant_knockback, to, true)
      }
      g.kb.copy(fwd).multiplyScalar((-CONFIG.elephant_self_knockback / CONFIG.stun_knockback_time) * 0.75)
      g.vy = Math.max(g.vy, 3)
    }
    return true
  }

  private makeRocket(id: number, pos: THREE.Vector3, vel: THREE.Vector3) {
    const mesh = new THREE.Group()
    const src = this.opts.assets?.props.rocket
    mesh.add(src ? prop(src, 1.2, 'max') : new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f97316' })))
    const trail = new Trail('#ffb347', 0.4, 26, 1.6, true)
    mesh.position.copy(pos)
    this.scene.add(mesh, trail.mesh)
    return { id, pos, vel, mesh, trail }
  }

  private makeMine(p: THREE.Vector3) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.14, 12), new THREE.MeshStandardMaterial({ color: '#3f3f46', roughness: 0.6, metalness: 0.4 }))
    body.position.y = 0.07
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ef4444' }))
    light.position.y = 0.17
    light.name = 'light'
    g.add(body, light)
    g.position.copy(p)
    this.scene.add(g)
    return g
  }

  selectAndUse(g: Golfer, item: ItemType, target?: Golfer) {
    const i = g.inventory.indexOf(item)
    if (i < 0) return false
    g.active = i
    return this.useItem(g, target)
  }

  private aimYaw(g: Golfer) {
    return g.human && !(g === this.me && this.opts.autopilot) ? g.aim : g.yaw
  }

  private drop(g: Golfer) {
    const it = g.take()
    if (!it) return
    g.mineCharges = 0
    const p = g.pos.clone().add(new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw)).multiplyScalar(-1.5))
    p.y = this.ground.y(p.x, p.z)
    this.cases.push({ id: this.entityId++, pos: p, ready: true, timer: 0, mesh: this.itemMesh(it, p), item: it })
  }

  /** A dropped item lying on the ground, waiting to be picked up. */
  private itemMesh(it: ItemType, p: THREE.Vector3) {
    const mesh = new THREE.Group()
    const key = it === 'rocket' ? 'rocket' : it === 'pistol' ? 'pistol' : it === 'shield' ? 'magnet' : null
    const src = key ? this.opts.assets?.props[key] : undefined
    mesh.add(src ? prop(src, 0.9, 'max') : new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: ITEM_INFO[it].color, emissive: ITEM_INFO[it].color, emissiveIntensity: 0.4 })))
    mesh.position.set(p.x, p.y + 0.6, p.z)
    this.scene.add(mesh)
    return mesh
  }

  nearestRival(g: Golfer, range: number) {
    let best: Golfer | null = null
    let bd = range
    for (const o of this.golfers) {
      if (o === g || o.finished || o.respawn > 0) continue
      const d = o.pos.distanceTo(g.pos)
      if (d < bd) {
        bd = d
        best = o
      }
    }
    return best
  }

  /** The rival furthest along the hole (homing items and AI target them). */
  leaderExcept(g: Golfer) {
    let best: Golfer | null = null
    let bp = -Infinity
    for (const o of this.golfers) {
      if (o === g || o.finished || o.respawn > 0) continue
      const p = this.course.progress(o.ball.pos.x, o.ball.pos.z)
      if (p > bp) {
        bp = p
        best = o
      }
    }
    return best
  }

  rocketOn(g: Golfer) {
    let best: { eta: number } | null = null
    for (const r of this.rockets) {
      if (r.target !== g) continue
      const eta = r.pos.distanceTo(g.pos) / CONFIG.rocket_speed
      if (!best || eta < best.eta) best = { eta }
    }
    return best
  }

  /**
   * Stun with knockback. Returns false if the hit was blocked (Shield, post-hit protection, dive i-frames).
   * Scoring: +10 knockout for the attacker; the Shield owner gets +5 per block.
   */
  knock(victim: Golfer, by: Golfer | null, weapon: string, stun: number, kbMetres: number, dir: THREE.Vector3, projectile: boolean) {
    if (victim.respawn > 0 || victim.finished) return false
    if (victim.shield > 0) {
      victim.shieldBlocks++
      this.popup(victim, `+${CONFIG.points_shield_block} BLOCK`, '#7dd3fc')
      this.fx({ k: 'block', p: v3(victim.pos) })
      return false
    }
    if (victim.protect > 0) return false
    if (projectile && victim.dive > CONFIG.dive_duration - CONFIG.dive_iframes) return false
    victim.stun = stun
    victim.stunTotal = stun
    victim.charging = 0
    victim.ai.plan = null
    // Repeated hits within the window raise the post-hit protection level.
    victim.protectLevel = this.time - victim.lastKnockedAt < CONFIG.protection_window ? Math.min(CONFIG.protection_levels, victim.protectLevel + 1) : 1
    victim.lastKnockedAt = this.time
    victim.protect = stun + CONFIG.protection_duration[victim.protectLevel - 1]
    const d = dir.clone().setY(0)
    if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5)
    d.normalize()
    const kb = (kbMetres * CONFIG.knockback_multiplier) / 100
    victim.kb.copy(d).multiplyScalar((kb / CONFIG.stun_knockback_time) * 0.75)
    victim.vy = Math.max(victim.vy, 3)
    if (by) {
      by.knockouts++
      by.victims.add(victim.id)
      victim.knockedBy = { by, at: this.time }
      this.popup(by, `+${CONFIG.points_knockout} KO`, '#fde047')
      this.feed(`${by.name} knocked out ${victim.name} — ${weapon}`, [by, victim])
    }
    this.fxTo(victim, { k: 'shake', v: 0.5 })
    this.fx({ k: 'groan' })
    return true
  }

  /* ---------- Simulation pieces ---------- */

  private afterMove(g: Golfer, dt: number) {
    // Checkpoints: pass within the radius to turn them green and move your respawn point.
    this.course.checkpoints.forEach((c, i) => {
      if (g.passed.has(i)) return
      if (Math.hypot(c.x - g.pos.x, c.z - g.pos.z) < CONFIG.checkpoint_radius) {
        g.passed.add(i)
        g.checkpoint = c.clone()
        this.fxTo(g, { k: 'beep', f: 880, d: 0.12, w: 'triangle', g: 0.06 })
      }
    })
    // Water or off the edge.
    if (g.respawn <= 0 && !g.finished && g.inHazard(this.ground)) {
      this.fx({ k: 'splash', p: v3(g.pos) })
      if (g.knockedBy && this.time - g.knockedBy.at < 4) {
        const by = g.knockedBy.by
        by.waterKnocks++
        this.popup(by, `+${CONFIG.points_water_knock} SPLASH`, '#38bdf8')
        this.feed(`${by.name} knocked ${g.name} into the water`, [by, g])
      }
      this.startRespawn(g)
    }
    if (g.respawn > 0) {
      g.respawn -= dt
      if (g.respawn <= 0) this.finishRespawn(g)
    }
    // Briefcases and dropped items.
    for (const c of this.cases) {
      if (!c.ready || g.respawn > 0 || g.finished) continue
      if (Math.hypot(c.pos.x - g.pos.x, c.pos.z - g.pos.z) > 1.6) continue
      const item = c.item ?? this.rollItem()
      if (!g.give(item)) {
        if (this.phaseTime % 1 < dt) this.say('Inventory full · F to drop', '#f87171', 1, g)
        continue
      }
      if (c.item) {
        this.scene.remove(c.mesh)
        c.ready = false
        c.timer = Infinity
      } else {
        c.ready = false
        c.timer = CONFIG.briefcase_respawn
        c.mesh.visible = false
      }
      this.say(ITEM_INFO[item].name, ITEM_INFO[item].color, 1.4, g)
      this.fxTo(g, { k: 'beep', f: 988, d: 0.15, w: 'triangle', g: 0.08 })
    }
  }

  private rollItem(): ItemType {
    const items = CONFIG.enabled_items as ItemType[]
    let total = 0
    for (const it of items) total += CONFIG.item_weights[it] ?? 1
    let r = Math.random() * total
    for (const it of items) {
      r -= CONFIG.item_weights[it] ?? 1
      if (r <= 0) return it
    }
    return items[0]
  }

  private startRespawn(g: Golfer) {
    if (g.respawn > 0 || g.finished) return
    g.respawn = CONFIG.respawn_delay
    g.charging = 0
    g.ai.plan = null
    if (g.ball.mode !== 'holed') g.ball.mode = 'water'
    g.rig.root.visible = false
  }

  /** Back to the last green checkpoint with the ball, +1 stroke. */
  private finishRespawn(g: Golfer) {
    const c = g.checkpoint
    g.pos.set(c.x, this.ground.y(c.x, c.z), c.z)
    g.vel.set(0, 0, 0)
    g.kb.set(0, 0, 0)
    g.vy = 0
    g.stun = 0
    g.rig.root.visible = true
    const ahead = this.course.routePoint(this.course.routeNearest(c.x, c.z).s + 2)
    const bx = ahead.x, bz = ahead.z
    g.ball.pos.set(bx, this.ground.y(bx, bz) + CONFIG.ball_radius, bz)
    g.ball.vel.set(0, 0, 0)
    g.ball.mode = 'rest'
    g.strokes += CONFIG.respawn_penalty_strokes
    g.protect = Math.max(g.protect, 1.5)
    this.say(`+${CONFIG.respawn_penalty_strokes} stroke`, '#f87171', 1.2, g)
  }

  private holed(g: Golfer) {
    if (g.finished) return
    g.finished = true
    g.finishPlace = ++this.finishedCount
    g.charging = 0
    const pts = [CONFIG.points_first, CONFIG.points_second, CONFIG.points_third, CONFIG.points_fourth][g.finishPlace - 1] ?? CONFIG.points_fifth_plus
    this.popup(g, `+${pts} ${ordinal(g.finishPlace)}`, '#4ade80')
    const label = g.strokes === 1 ? 'HOLE IN ONE!' : g.finishPlace === 1 ? `${g.name.toUpperCase()} WINS THE HOLE` : `${g.name} holed out`
    this.say(label, g.color, 2.5)
    if (g.finishPlace === 1) this.say('FIRST IN THE HOLE!', g.color, 2.5, g)
    this.feed(`${g.name} holed out ${ordinal(g.finishPlace)} in ${g.strokes} strokes`, [g])
    this.fx({ k: 'cup', c: g.color })
  }

  private endHole() {
    if (this.phase === 'results') return
    this.setPhase('results')
    const res = this.results()
    if (!this.resultSent) {
      this.resultSent = true
      // Flush the last effects, then everyone gets the same table.
      if (this.role === 'host' && this.opts.net) {
        this.opts.net.link.send({ t: 'g-snap', s: this.buildSnap(), e: this.outEvents })
        this.outEvents = []
        this.opts.net.link.send({ t: 'g-result', r: res })
      }
      this.onResult?.(res)
    }
  }

  /** Hole points: position, strokes against par, knockouts, domination, splashes, blocks, overtime penalty. */
  results(): HoleResult {
    const par = this.course.hole.par
    const rows: ResultRow[] = this.golfers.map((g) => {
      const b: { label: string; points: number }[] = []
      if (g.finished) {
        const pos = [CONFIG.points_first, CONFIG.points_second, CONFIG.points_third, CONFIG.points_fourth][g.finishPlace - 1] ?? CONFIG.points_fifth_plus
        b.push({ label: `${ordinal(g.finishPlace)} in the hole`, points: pos })
        if (g.strokes === 1) b.push({ label: 'Hole in one', points: CONFIG.points_hole_in_one })
        else if (g.strokes < par) b.push({ label: 'Under par', points: CONFIG.points_under_par })
        else if (g.strokes === par) b.push({ label: 'At par', points: CONFIG.points_at_par })
      }
      if (g.knockouts) b.push({ label: `${g.knockouts} knockout${g.knockouts > 1 ? 's' : ''}`, points: g.knockouts * CONFIG.points_knockout })
      if (g.victims.size >= CONFIG.points_domination_count) b.push({ label: 'Domination', points: CONFIG.points_domination })
      if (g.waterKnocks) b.push({ label: 'Splashed a rival', points: g.waterKnocks * CONFIG.points_water_knock })
      if (g.shieldBlocks) b.push({ label: 'Shield blocks', points: g.shieldBlocks * CONFIG.points_shield_block })
      if (g.timedOut) b.push({ label: 'Timed out in overtime', points: CONFIG.overtime_timeout_penalty })
      const total = b.reduce((a, x) => a + x.points, 0)
      g.points = total
      return { id: g.id, name: g.name, color: g.color, me: g === this.me, place: g.finishPlace, strokes: g.strokes, breakdown: b, total }
    })
    rows.sort((a, b) => b.total - a.total || a.strokes - b.strokes)
    const bully = [...this.golfers].sort((a, b) => b.knockouts - a.knockouts)[0]
    const highlight =
      bully && bully.knockouts >= 2
        ? `${bully.name} knocked out ${bully.knockouts} players`
        : this.golfers.find((g) => g.finishPlace === 1)
          ? `${this.golfers.find((g) => g.finishPlace === 1)!.name} was first in the hole`
          : 'Nobody made it to the cup'
    return { rows, highlight, par, name: this.course.hole.name }
  }

  private updateRockets(dt: number) {
    const turn = deg(CONFIG.rocket_turn_rate) * dt
    for (const r of this.rockets) {
      r.life -= dt
      const t = r.target && !r.target.finished && r.target.respawn <= 0 ? r.target : null
      if (t) {
        const want = t.pos.clone().setY(t.pos.y + 1).sub(r.pos).normalize()
        const cur = r.vel.clone().normalize()
        const angle = cur.angleTo(want)
        if (angle > 1e-3) {
          const axis = new THREE.Vector3().crossVectors(cur, want).normalize()
          if (axis.lengthSq() > 0) cur.applyAxisAngle(axis, Math.min(angle, turn))
        }
        r.vel.copy(cur.multiplyScalar(CONFIG.rocket_speed))
        if (Math.floor(this.time * 6) !== Math.floor((this.time - dt) * 6)) this.fxTo(t, { k: 'beep', f: 1200, d: 0.05, w: 'square', g: 0.05 })
      }
      r.pos.addScaledVector(r.vel, dt)
      r.mesh.position.copy(r.pos)
      r.mesh.lookAt(r.pos.clone().add(r.vel))
      r.trail.push(r.pos)
      if (Math.random() < dt * 40) this.smoke.emit(r.pos.clone(), new THREE.Vector3((Math.random() - 0.5), 1, (Math.random() - 0.5)), 1.0, 0.9, new THREE.Color(0.85, 0.85, 0.85), 0.5, 2)
      // Impact: a rival, the ground, or timeout.
      let boom = r.life <= 0 || r.pos.y < this.ground.y(r.pos.x, r.pos.z) + 0.2
      for (const o of this.golfers) {
        if (o === r.owner || o.respawn > 0 || o.finished) continue
        const reach = o.shield > 0 ? CONFIG.shield_block_radius : 1.1
        if (o.pos.clone().setY(o.pos.y + 1).distanceTo(r.pos) < reach) boom = true
      }
      if (boom) {
        r.life = -1
        this.explode(r.pos, r.owner)
      }
    }
    for (const r of this.rockets) {
      if (r.life > 0) continue
      this.scene.remove(r.mesh, r.trail.mesh)
    }
    this.rockets = this.rockets.filter((r) => r.life > 0)
  }

  private explode(at: THREE.Vector3, owner: Golfer) {
    this.fx({ k: 'boom', p: v3(at) })
    for (const o of this.golfers) {
      if (o === owner) continue
      const d = o.pos.clone().setY(o.pos.y + 1).distanceTo(at)
      if (d < 2.6) this.knock(o, owner, 'Rocket Launcher', CONFIG.rocket_stun, CONFIG.rocket_knockback, o.pos.clone().sub(at), true)
    }
    // Blasts knock balls too.
    for (const o of this.golfers) {
      const b = o.ball
      if (b.mode === 'holed' || b.mode === 'water') continue
      const d = b.pos.distanceTo(at)
      if (d < 4) {
        const push = b.pos.clone().sub(at).setY(0).normalize().multiplyScalar((4 - d) * 3)
        b.vel.add(push).setY(2)
        b.mode = 'air'
      }
    }
  }

  private updateCases(dt: number, sim = true) {
    for (const c of this.cases) {
      if (!c.ready) {
        if (!sim) continue
        c.timer -= dt
        if (c.timer <= 0 && !c.item) {
          c.ready = true
          c.mesh.visible = true
        }
        continue
      }
      c.mesh.rotation.y += dt * 1.2
      c.mesh.position.y = c.pos.y + 0.8 + Math.sin(this.time * 2 + c.pos.x) * 0.15
    }
  }

  private updateEffects(dt: number) {
    for (const g of this.golfers) {
      const rig = g.rig
      rig.root.position.copy(g.pos)
      rig.root.rotation.y = g.yaw
      // Ragdoll-ish stun: topple over, then get back up.
      // Frozen golfers stand stiff in their ice block instead of toppling.
      const down = g.stun > 0 && g.frozen <= 0 ? Math.min(1, (g.stunTotal - g.stun) / 0.25, g.stun / 0.35) : 0
      rig.body.rotation.x += (down * -1.35 - rig.body.rotation.x) * Math.min(1, dt * 14)
      rig.body.position.y = down * 0.25
      this.shieldMeshes.get(g)!.visible = g.shield > 0
      this.iceMeshes.get(g)!.visible = g.frozen > 0
      // Blink while protected.
      rig.root.visible = g.respawn <= 0 && (g.protect <= 0 || g.stun > 0 || Math.floor(this.time * 10) % 2 === 0)
      if (rig.mixer) {
        const a = rig.actions
        const moving = g.vel.length() > 0.6 && g.stun <= 0
        const want = g.charging > 0 || g.swing > 0 ? 'swing' : moving ? 'run' : 'idle'
        // Crossfade only on a change of state (a paused swing is still the current clip).
        if (want !== rig.current && a[want]) {
          const next = a[want]!
          const prev = rig.current ? a[rig.current] : undefined
          next.reset().setEffectiveWeight(1).play()
          if (prev) next.crossFadeFrom(prev, 0.15, false)
          rig.current = want
        }
        if (a.run) a.run.timeScale = g.vel.length() / CONFIG.run_speed * 1.1
        // Frozen: the pose holds.
        if (g.frozen > 0) {
          rig.mixer.timeScale = 0
          continue
        }
        rig.mixer.timeScale = 1
        if (a.swing) {
          // golf_drive clip: address 0–0.3 s, top of the backswing ~1.0 s, impact ~1.2 s, follow-through to ~1.6 s.
          // Charging holds the backswing (deeper with power); releasing snaps to just before impact and plays through.
          if (g.charging > 0) {
            a.swing.paused = true
            a.swing.time = 0.3 + 0.65 * this.power(g)
            rig.swingPhase = 'hold'
          } else if (g.swing > 0) {
            if (rig.swingPhase !== 'out') {
              a.swing.paused = false
              a.swing.time = rig.swingPhase === 'hold' ? 1.12 : 0.92 // a melee swipe starts from the top
              a.swing.timeScale = 1.4
              rig.swingPhase = 'out'
            }
          } else rig.swingPhase = null
        }
        rig.mixer.update(dt)
      }
      if (g.boost > 0 && Math.random() < dt * 20) this.fx_.emit(g.pos.clone().setY(g.pos.y + 0.2), new THREE.Vector3(0, 1, 0), 0.4, 0.4, new THREE.Color(2.5, 2.2, 0.6), 0.6)
    }
    // Armed mines blink.
    for (const m of this.mines) {
      const light = m.mesh.getObjectByName('light')
      if (light) light.visible = m.arm > 0 || Math.floor(this.time * 4 + m.id) % 2 === 0
    }
    // Checkpoint colours from the player's progress.
    this.checkpointMeshes.forEach((m, i) => {
      const ring = m.children[0] as THREE.Mesh
      const mat = ring.material as THREE.MeshStandardMaterial
      const done = this.me.passed.has(i)
      mat.color.set(done ? '#22c55e' : '#ef4444')
      mat.emissive.set(done ? '#14532d' : '#7f1d1d')
      ring.rotation.y += dt * 0.8
    })
    for (const tr of this.tracers) {
      tr.t -= dt
      ;(tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.t / 0.15)
      if (tr.t <= 0) this.scene.remove(tr.line)
    }
    this.tracers = this.tracers.filter((t) => t.t > 0)
    // Sheep wander; balloons drift.
    for (const s of this.sheep) {
      s.wait -= dt
      if (s.wait <= 0) {
        s.target.set(120 + Math.random() * 30, 0, 60 + Math.random() * 30)
        s.wait = 4 + Math.random() * 6
      }
      const d = s.target.clone().sub(s.obj.position).setY(0)
      if (d.length() > 0.5) {
        d.normalize()
        s.obj.position.addScaledVector(d, dt * 0.6)
        s.obj.rotation.y = Math.atan2(d.x, d.z)
        s.obj.position.y = this.ground.y(s.obj.position.x, s.obj.position.z)
      }
    }
    for (const [i, b] of this.balloons.entries()) {
      b.position.x += dt * (1.2 + i * 0.3)
      b.position.y += Math.sin(this.time * 0.3 + i) * dt * 0.4
      if (b.position.x > 360) b.position.x = -160
    }
    this.fx_.update(dt)
    this.smoke.update(dt)
    for (const f of this.feedList) f.age += dt
    this.feedList = this.feedList.filter((f) => f.age < 6)
    for (const p of this.popups) p.age += dt
    this.popups = this.popups.filter((p) => p.age < 1.6)
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }
  }

  private updateCamera(dt: number) {
    const cam = this.camera
    const g = this.me
    const k = 1 - Math.exp(-dt * 8)
    let pos: THREE.Vector3, look: THREE.Vector3
    if (this.phase === 'intro') {
      // Fly from the green back to the tee.
      const t = Math.min(1, this.phaseTime / 3)
      const e = t * t * (3 - 2 * t)
      const green = this.course.cup
      pos = new THREE.Vector3().lerpVectors(new THREE.Vector3(green.x - 30, 60, green.z - 40), new THREE.Vector3(0, 9, -14), e)
      look = new THREE.Vector3().lerpVectors(green, new THREE.Vector3(0, 3, 20), e)
      cam.position.copy(pos)
      cam.lookAt(look)
      this.aimLine.visible = false
      return
    }
    if (g.finished || this.phase === 'results') {
      // Spectator: a wide view of the green.
      const c = this.course.cup
      pos = new THREE.Vector3(c.x - Math.sin(this.time * 0.1) * 45, 28, c.z - Math.cos(this.time * 0.1) * 45)
      look = c.clone()
    } else if (g.charging > 0 || (this.canSwing(g) && !this.opts.autopilot)) {
      // Behind the ball looking down the aim line.
      const yaw = this.camYaw
      const b = g.ball.pos
      pos = new THREE.Vector3(b.x - Math.sin(yaw) * 5.2, b.y + 2.4 + this.camPitch * 2, b.z - Math.cos(yaw) * 5.2)
      look = new THREE.Vector3(b.x + Math.sin(yaw) * 12, b.y + 0.8, b.z + Math.cos(yaw) * 12)
    } else {
      const yaw = this.camYaw
      const dist = 6.5
      const h = 1.6 + Math.sin(this.camPitch) * dist
      pos = new THREE.Vector3(g.pos.x - Math.sin(yaw) * Math.cos(this.camPitch) * dist, g.pos.y + h, g.pos.z - Math.cos(yaw) * Math.cos(this.camPitch) * dist)
      look = new THREE.Vector3(g.pos.x + Math.sin(yaw) * 4, g.pos.y + 1.4, g.pos.z + Math.cos(yaw) * 4)
    }
    pos.y = Math.max(pos.y, this.ground.y(pos.x, pos.z) + 0.6)
    cam.position.lerp(pos, k)
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake
      cam.position.y += (Math.random() - 0.5) * this.shake
      this.shake = Math.max(0, this.shake - dt * 2)
    }
    cam.lookAt(look)
    // The sun's shadow box follows the player.
    this.sun.target.position.set(g.pos.x, g.pos.y, g.pos.z)
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(0.45, 0.62, -0.35).multiplyScalar(140))
    this.updateAimLine()
  }

  /** Dotted preview of the shot (loft arc and roll) at the current charge. */
  private updateAimLine() {
    const g = this.me
    const show = !g.finished && (g.charging > 0 || this.canSwing(g)) && !this.opts.autopilot
    this.aimLine.visible = show
    if (!show) return
    const power = g.charging > 0 ? Math.max(0.15, this.power(g)) : 0.5
    const putt = this.isPutt(g)
    const b = { pos: g.ball.pos.clone(), vel: launch(this.camYaw, power, g.loft, putt), mode: (putt ? 'rolling' : 'air') as BallMode }
    const arr = (this.aimLine.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
    let n = 0
    for (let i = 0; i < 90 && n < 90; i++) {
      for (let s = 0; s < 2; s++) stepBall(b, 1 / 30, this.ground, this.course)
      arr.set([b.pos.x, b.pos.y + 0.05, b.pos.z], n * 3)
      n++
      if (b.mode === 'rest' || b.mode === 'water' || b.mode === 'holed') break
    }
    for (let i = n; i < 90; i++) arr.set([b.pos.x, b.pos.y, b.pos.z], i * 3)
    this.aimLine.geometry.attributes.position.needsUpdate = true
  }

  /* ---------- Mines, lobs, things in flight ---------- */

  private updateMines(dt: number) {
    for (const m of this.mines) {
      m.arm -= dt
      m.life -= dt
      if (m.arm > 0) continue
      for (const o of this.golfers) {
        if (o.respawn > 0 || o.finished) continue
        // Your own mine can get you too, once you've had a moment to walk off it.
        if (o === m.owner && m.arm > -CONFIG.landmine_self_grace) continue
        if (Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) > CONFIG.landmine_trigger_radius || o.air > 1) continue
        m.life = -1
        this.fx({ k: 'boom', p: v3(m.pos.clone().setY(m.pos.y + 0.3)), small: true })
        this.knock(o, o === m.owner ? null : m.owner, 'Landmine', CONFIG.landmine_stun, CONFIG.landmine_knockback, o.pos.clone().sub(m.pos), false)
        o.vy = Math.max(o.vy, 7)
        break
      }
    }
    for (const m of this.mines) if (m.life <= 0) this.scene.remove(m.mesh)
    this.mines = this.mines.filter((m) => m.life > 0)
  }

  private updateLobs(dt: number) {
    for (const l of this.lobs) {
      l.t -= dt
      if (l.t > 0) continue
      this.fx({ k: 'ice', p: v3(l.to) })
      for (const o of this.golfers) {
        if (o === l.owner || Math.hypot(o.pos.x - l.to.x, o.pos.z - l.to.z) > CONFIG.freeze_radius) continue
        if (this.knock(o, l.owner, 'Freeze Bomb', CONFIG.freeze_duration, 0, o.pos.clone().sub(l.to), true)) {
          o.frozen = CONFIG.freeze_duration
          o.vel.set(0, 0, 0)
        }
      }
      // Balls caught in the blast stop dead.
      for (const o of this.golfers) {
        const b = o.ball
        if ((b.mode === 'rolling' || b.mode === 'air') && b.pos.distanceTo(l.to) < CONFIG.freeze_radius) {
          b.vel.set(0, 0, 0)
          b.pos.y = this.ground.y(b.pos.x, b.pos.z) + CONFIG.ball_radius
          b.mode = 'rest'
        }
      }
    }
    this.lobs = this.lobs.filter((l) => l.t > 0)
  }

  /** Purely visual projectiles (the Freeze Bomb's arc), on every screen. */
  private updateFlying(dt: number) {
    for (const f of this.flying) {
      f.t += dt
      const u = Math.min(1, f.t / f.dur)
      f.mesh.position.lerpVectors(f.a, f.b, u)
      f.mesh.position.y += Math.sin(u * Math.PI) * 5
      f.mesh.rotation.x += dt * 8
      if (u >= 1) this.scene.remove(f.mesh)
    }
    this.flying = this.flying.filter((f) => f.t < f.dur)
  }

  /* ---------- Effects (local, and streamed by the host) ---------- */

  private fx(e: FxEv) {
    this.playFx(e)
    if (this.role === 'host') this.outEvents.push(e)
  }

  /** An effect for one golfer only (their banner, their beep). */
  private fxTo(g: Golfer, e: FxEv) {
    if (g === this.me) this.playFx(e)
    else if (this.role === 'host' && g.remoteId) this.outEvents.push({ ...e, to: g.remoteId })
  }

  private playFx(e: FxEv) {
    const P = (p: V3) => new THREE.Vector3(p[0], p[1], p[2])
    switch (e.k) {
      case 'boom': {
        const at = P(e.p)
        const k = e.small ? 0.5 : 1
        this.fx_.burst(at, Math.round(70 * k), 14 * k, 0.7, 2 * k, new THREE.Color(3, 1.6, 0.4), 1, 1)
        for (let i = 0; i < 20 * k; i++) this.smoke.emit(at.clone(), new THREE.Vector3((Math.random() - 0.5) * 6 * k, 2 + Math.random() * 3, (Math.random() - 0.5) * 6 * k), 1.8 * k, 2.4, new THREE.Color(0.3, 0.3, 0.32), 0.7, 1.6)
        this.boom()
        if (this.near(at, 30)) this.shake = Math.max(this.shake, 0.6 * k)
        break
      }
      case 'splash':
        this.splash(P(e.p))
        break
      case 'tracer': {
        const a = P(e.a), b = P(e.b)
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#fde047', transparent: true }))
        this.scene.add(line)
        this.tracers.push({ line, t: 0.15 })
        this.fx_.burst(a.clone().lerp(b, 0.6 / Math.max(0.6, a.distanceTo(b))), 10, 5, 0.2, 0.5, new THREE.Color(3, 2.6, 1))
        this.bang()
        break
      }
      case 'thwack':
        this.thwack(e.v)
        break
      case 'whack':
        this.whack()
        break
      case 'groan':
        this.groan()
        break
      case 'cup':
        this.cupDrop()
        this.fx_.burst(this.course.cup.clone().setY(this.course.cup.y + 0.6), 70, 9, 1.0, 0.9, new THREE.Color(e.c).multiplyScalar(2), 1, 1.5)
        break
      case 'block':
        this.fx_.burst(P(e.p).setY(e.p[1] + 1), 30, 7, 0.4, 0.6, new THREE.Color(1.2, 2.4, 3))
        break
      case 'ice': {
        const at = P(e.p)
        this.fx_.burst(at.clone().setY(at.y + 0.5), 90, 10, 0.9, 1.2, new THREE.Color(1.4, 2.4, 3), 1, 0.6)
        for (let i = 0; i < 16; i++) this.smoke.emit(at.clone(), new THREE.Vector3((Math.random() - 0.5) * 8, 1 + Math.random() * 2, (Math.random() - 0.5) * 8), 1.6, 1.8, new THREE.Color(0.85, 0.95, 1), 0.6, 1.4)
        this.beep(1500, 0.3, 'sine', 0.06)
        this.beep(900, 0.4, 'triangle', 0.05)
        break
      }
      case 'horn': {
        const at = P(e.p)
        this.fx_.burst(at.clone().setY(at.y + 1.4), 60, 12, 0.5, 0.8, new THREE.Color(1.6, 2.6, 0.8), 0, 0.2)
        this.beep(233, 0.7, 'sawtooth', 0.12)
        this.beep(311, 0.7, 'sawtooth', 0.08)
        if (this.near(at, CONFIG.airhorn_range)) this.shake = Math.max(this.shake, 0.3)
        break
      }
      case 'lob': {
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: '#bae6fd', emissive: '#38bdf8', emissiveIntensity: 0.8 }))
        this.scene.add(mesh)
        this.flying.push({ mesh, a: P(e.a), b: P(e.b), t: 0, dur: e.t })
        this.beep(600, 0.15, 'triangle', 0.05)
        break
      }
      case 'leap':
        this.fx_.burst(P(e.p).setY(e.p[1] + 0.2), 40, 8, 0.5, 0.7, new THREE.Color(0.8, 2.6, 2.8), 1, 0.4)
        this.beep(300, 0.25, 'square', 0.06)
        window.setTimeout(() => this.beep(600, 0.2, 'square', 0.05), 80)
        break
      case 'say':
        this.banner = { text: e.s, color: e.c, t: e.t }
        break
      case 'feed':
        this.feedList.push({ id: this.nextId++, text: e.s, mine: e.ids.includes(this.me.id), age: 0 })
        if (this.feedList.length > 5) this.feedList.shift()
        break
      case 'pop':
        this.popups.push({ id: this.nextId++, text: e.s, color: e.c, pos: P(e.p), age: 0 })
        break
      case 'beep':
        this.beep(e.f, e.d, e.w, e.g)
        break
      case 'shake':
        this.shake = Math.max(this.shake, e.v)
        break
    }
  }

  /* ---------- Online ---------- */

  private listen(net: GolfNet) {
    const link = net.link
    this.unsub.push(
      link.onMessage((m, from) => {
        if (!isGolfMsg(m)) return
        if (this.role === 'host' && m.t === 'g-in') {
          const pad = this.remotePads.get(from) ?? { x: 0, y: 0, yaw: 0, loft: deg(28), creep: false, acts: [] }
          const p = m.p
          pad.x = p[0]
          pad.y = p[1]
          pad.yaw = p[2]
          pad.loft = p[3]
          pad.creep = p[4] === 1
          pad.pos = [p[5], p[6], p[7], p[8]]
          pad.acts.push(...m.a)
          this.remotePads.set(from, pad)
        } else if (this.role === 'client' && m.t === 'g-snap') {
          this.snap = { s: m.s as Snap, at: performance.now() }
          for (const e of m.e as Targeted[]) if (!e.to || e.to === link.selfId) this.playFx(e)
        } else if (this.role === 'client' && m.t === 'g-result') {
          const r = m.r as HoleResult
          this.phase = 'results'
          if (!this.resultSent) {
            this.resultSent = true
            this.onResult?.({ ...r, rows: r.rows.map((row) => ({ ...row, me: row.id === this.me.id })) })
          }
        }
      }),
      link.onPeer((ev, id) => {
        if (ev !== 'leave') return
        if (this.role === 'client' && id === 'host') this.onDisconnect?.('The host left the game.')
        if (this.role === 'host') {
          // A bot takes over for a player who left.
          const g = this.golfers.find((x) => x.remoteId === id)
          if (g) {
            g.human = false
            g.remoteId = null
            this.remotePads.delete(id)
            this.feed(`${g.name} left · a bot takes over`, [])
          }
        }
      }),
    )
  }

  /** Online client: send the controls, then show the host's latest state (own golfer predicted locally). */
  private clientFrame(dt: number, pad: Pad) {
    const net = this.opts.net!
    const me = this.me
    this.pendingActs.push(...pad.acts)
    this.inputT -= dt
    if (this.inputT <= 0 || pad.acts.length) {
      this.inputT = 1 / CONFIG.net_input_hz
      net.link.send({ t: 'g-in', p: [pad.x, pad.y, pad.yaw, pad.loft, pad.creep ? 1 : 0, me.pos.x, me.pos.y, me.pos.z, me.yaw], a: this.pendingActs })
      this.pendingActs = []
    }
    const S = this.snap
    if (!S) return
    const s = S.s
    const age = Math.min(0.25, (performance.now() - S.at) / 1000)
    this.phase = s.ph
    this.phaseTime = s.pt + age
    const playing = this.phase === 'play' || this.phase === 'overtime'
    s.g.forEach((row, i) => {
      const g = this.golfers[i]
      if (!g) return
      ;[g.stun, g.stunTotal, g.boost, g.shield, g.protect, g.respawn] = [row[6], row[7], row[8], row[9], row[10], row[11]]
      g.charging = row[12] > 0 ? row[12] + age : 0
      g.swing = row[13]
      g.finished = row[14] === 1
      g.finishPlace = row[15]
      g.strokes = row[16]
      g.knockouts = row[17]
      g.active = row[18]
      g.inventory = [row[19], row[20], row[21]].map((c) => (c >= 0 ? ITEM_CODES[c] : null))
      if (g !== me) g.loft = row[22]
      g.frozen = row[28]
      g.leap = row[29]
      g.human = row[34] === 1
      const target = new THREE.Vector3(row[0] + row[4] * age, row[1], row[2] + row[5] * age)
      const hostDrives = row[6] > 0 || row[11] > 0 || row[12] > 0 || row[14] === 1 || row[28] > 0 || row[29] > 0 || row[33] > 1
      if (g === me && !hostDrives && playing && g.pos.distanceTo(target) < 8) {
        // Your own golfer moves at once; the host trusts it while nothing is pushing you around.
        g.update(dt, { x: pad.x, y: pad.y, yaw: pad.yaw, jump: pad.acts.includes('jump'), dive: pad.acts.includes('dive'), creep: pad.creep }, this.ground, this.course, this.golfers)
        g.aim = pad.yaw
      } else {
        if (g.pos.distanceTo(target) > 8) g.pos.copy(target)
        else g.pos.lerp(target, Math.min(1, dt * (g === me ? 16 : 12)))
        let d = row[3] - g.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        g.yaw += d * Math.min(1, dt * 12)
        g.vel.set(row[4], 0, row[5])
      }
      // Ball.
      const b = g.ball
      b.mode = BALL_MODES[row[26]]
      const moving = b.mode === 'air' || b.mode === 'rolling'
      const bt = new THREE.Vector3(row[23] + (moving ? row[30] * age : 0), row[24] + (moving ? row[31] * age : 0), row[25] + (moving ? row[32] * age : 0))
      if (b.pos.distanceTo(bt) > 6 || !moving) b.pos.copy(bt)
      else b.pos.lerp(bt, Math.min(1, dt * 20))
      b.vel.set(row[30], row[31], row[32])
      g.ballMesh.position.copy(b.pos)
      g.ballMesh.visible = b.mode !== 'holed'
      if (g === me) {
        g.passed.clear()
        this.course.checkpoints.forEach((_, k) => row[27] & (1 << k) && g.passed.add(k))
      }
    })
    this.syncRockets(s.r, age)
    this.syncCases(s.c)
    this.syncMines(s.m)
    this.updateCases(dt, false)
  }

  private buildSnap(): Snap {
    const code = (it: ItemType | null) => (it ? ITEM_CODES.indexOf(it) : -1)
    const r2 = (x: number) => Math.round(x * 100) / 100
    return {
      ph: this.phase,
      pt: r2(this.phaseTime),
      g: this.golfers.map((g) => {
        let mask = 0
        for (const k of g.passed) mask |= 1 << k
        const b = g.ball
        return [
          r2(g.pos.x), r2(g.pos.y), r2(g.pos.z), r2(g.yaw), r2(g.vel.x + g.kb.x), r2(g.vel.z + g.kb.z),
          r2(g.stun), r2(g.stunTotal), r2(g.boost), r2(g.shield), r2(g.protect), r2(g.respawn), r2(g.charging), r2(g.swing),
          g.finished ? 1 : 0, g.finishPlace, g.strokes, g.knockouts, g.active, code(g.inventory[0]), code(g.inventory[1]), code(g.inventory[2]), r2(g.loft),
          r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), BALL_MODES.indexOf(b.mode), mask, r2(g.frozen), r2(g.leap), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z),
          r2(g.kb.length()), g.human ? 1 : 0,
        ]
      }),
      r: this.rockets.map((r) => [r.id, r2(r.pos.x), r2(r.pos.y), r2(r.pos.z), r2(r.vel.x), r2(r.vel.y), r2(r.vel.z), r.target ? r.target.id : -1]),
      c: this.cases.map((c) => [c.id, c.ready ? 1 : 0, c.item ? ITEM_CODES.indexOf(c.item) : -1, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)]),
      m: this.mines.map((m) => [m.id, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), m.arm <= 0 ? 1 : 0]),
    }
  }

  private syncRockets(rows: number[][], age: number) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      const pos = new THREE.Vector3(row[1] + row[4] * age, row[2] + row[5] * age, row[3] + row[6] * age)
      const vel = new THREE.Vector3(row[4], row[5], row[6])
      let r = this.rockets.find((x) => x.id === row[0])
      if (!r) {
        r = { ...this.makeRocket(row[0], pos.clone(), vel.clone()), owner: this.golfers[0], target: null, life: 1 }
        this.rockets.push(r)
      }
      r.target = this.golfers[row[7]] ?? null
      r.vel.copy(vel)
      r.pos.lerp(pos, 0.5)
      r.mesh.position.copy(r.pos)
      r.mesh.lookAt(r.pos.clone().add(r.vel))
      r.trail.push(r.pos)
    }
    for (const r of this.rockets) if (!seen.has(r.id)) this.scene.remove(r.mesh, r.trail.mesh)
    this.rockets = this.rockets.filter((r) => seen.has(r.id))
  }

  private syncCases(rows: number[][]) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      let c = this.cases.find((x) => x.id === row[0])
      if (!c && row[2] >= 0) {
        const it = ITEM_CODES[row[2]]
        const p = new THREE.Vector3(row[3], row[4], row[5])
        c = { id: row[0], pos: p, ready: true, timer: 0, mesh: this.itemMesh(it, p), item: it }
        this.cases.push(c)
      }
      if (!c) continue
      c.ready = row[1] === 1
      c.mesh.visible = c.ready
    }
    for (const c of this.cases) if (c.item && !seen.has(c.id)) this.scene.remove(c.mesh)
    this.cases = this.cases.filter((c) => !c.item || seen.has(c.id))
  }

  private syncMines(rows: number[][]) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      let m = this.mines.find((x) => x.id === row[0])
      if (!m) {
        const p = new THREE.Vector3(row[1], row[2], row[3])
        m = { id: row[0], owner: this.golfers[0], pos: p, arm: 1, life: 1, mesh: this.makeMine(p) }
        this.mines.push(m)
      }
      m.arm = row[4] === 1 ? 0 : 1
    }
    for (const m of this.mines) if (!seen.has(m.id)) this.scene.remove(m.mesh)
    this.mines = this.mines.filter((m) => seen.has(m.id))
  }

  /* ---------- HUD ---------- */

  private feed(text: string, involved: Golfer[]) {
    this.fx({ k: 'feed', s: text, ids: involved.map((g) => g.id) })
  }

  private popup(g: Golfer, text: string, color: string) {
    this.fx({ k: 'pop', s: text, c: color, p: v3(g.pos.clone().setY(g.pos.y + 2.3)) })
  }

  /** A banner for everyone, or just for golfer `g`. */
  private say(text: string, color: string, t: number, g?: Golfer) {
    const e: FxEv = { k: 'say', s: text, c: color, t }
    if (g) this.fxTo(g, e)
    else this.fx(e)
  }

  private near(p: THREE.Vector3, r: number) {
    return p.distanceTo(this.me.pos) < r
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera)
    if (v.z > 1) return null
    return { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight }
  }

  private emitHud() {
    if (!this.onHud) return
    const g = this.me
    const ranked = [...this.golfers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return this.course.progress(b.ball.pos.x, b.ball.pos.z) - this.course.progress(a.ball.pos.x, a.ball.pos.z)
    })
    const markers: Hud['markers'] = []
    for (const o of this.golfers) {
      if (o.ball.mode === 'holed') continue
      const s = this.project(o.ball.pos.clone().setY(o.ball.pos.y + 2.6))
      if (s) markers.push({ id: o.id, x: s.x, y: s.y, color: o.color, dist: Math.round(o.ball.pos.distanceTo(this.course.cup)), me: o === g })
    }
    const popups: Hud['popups'] = []
    for (const p of this.popups) {
      const s = this.project(p.pos)
      if (s) popups.push({ id: p.id, text: p.text, color: p.color, x: s.x, y: s.y - p.age * 40, age: p.age })
    }
    const timeLeft = this.phase === 'overtime' ? CONFIG.overtime - this.phaseTime : this.phase === 'play' ? this.holeTime - this.phaseTime : this.holeTime
    const canSwing = this.canSwing(g)
    this.onHud({
      phase: this.phase,
      hole: { name: this.course.hole.name, biome: this.course.hole.biome, par: this.course.hole.par },
      time: Math.max(0, timeLeft),
      overtime: this.phase === 'overtime',
      board: ranked.map((o, i) => ({ id: o.id, name: o.name, color: o.color, strokes: o.strokes, points: o.knockouts * CONFIG.points_knockout, finished: o.finished, place: i + 1, me: o === g })),
      items: [...g.inventory],
      active: g.active,
      power: g.charging > 0 ? this.power(g) : null,
      loft: Math.round((g.loft * 180) / Math.PI),
      putt: this.isPutt(g),
      canSwing,
      strokes: g.strokes,
      boost: g.boost,
      shield: g.shield,
      protect: g.stun > 0 ? 0 : g.protect,
      stun: g.stun,
      respawn: g.respawn,
      lockOn: !!this.rocketOn(g),
      markers,
      feed: this.feedList.map(({ id, text, mine }) => ({ id, text, mine })),
      popups,
      banner: this.banner ? { text: this.banner.text, color: this.banner.color } : null,
      hint: g.finished
        ? 'You holed out. Watch the others race the clock.'
        : canSwing
          ? this.isPutt(g)
            ? 'Hold left click to putt · release to hit'
            : 'Hold left click to charge · scroll for loft · release to swing'
          : 'Run to your ball · left click near a rival to swing your club',
      locked: this.locked || !!this.opts.autopilot,
    })
  }

  /* ---------- Audio ---------- */

  private ensureAudio() {
    if (this.audio) return
    try {
      this.audio = new AudioContext()
    } catch {
      this.audio = null
    }
  }

  private beep(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08) {
    const a = this.audio
    if (!a || isMuted()) return
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, a.currentTime)
    g.gain.setValueAtTime(gain, a.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur)
    o.connect(g).connect(a.destination)
    o.start()
    o.stop(a.currentTime + dur + 0.02)
  }

  private noise(dur: number, gain: number, freq: number) {
    const a = this.audio
    if (!a || isMuted()) return
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const src = a.createBufferSource()
    src.buffer = buf
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = freq
    const g = a.createGain()
    g.gain.value = gain
    src.connect(f).connect(g).connect(a.destination)
    src.start()
  }

  private thwack(power: number) {
    this.noise(0.08, 0.35 + power * 0.3, 3500)
    this.beep(180 + power * 120, 0.12, 'triangle', 0.12)
  }

  private whack() {
    this.noise(0.12, 0.5, 1800)
  }

  private bang() {
    this.noise(0.18, 0.6, 2500)
  }

  private boom() {
    this.noise(0.9, 0.7, 600)
    this.beep(60, 0.5, 'sine', 0.3)
  }

  private groan() {
    this.beep(160, 0.35, 'sawtooth', 0.04)
  }

  private splash(at: THREE.Vector3) {
    this.fx_.burst(at.clone().setY(0.3), 40, 6, 0.8, 0.8, new THREE.Color(1.6, 2.2, 2.6), 0.9, 2)
    if (this.near(at, 60)) this.noise(0.4, 0.3, 1200)
  }

  private cupDrop() {
    this.beep(523, 0.12, 'triangle', 0.1)
    window.setTimeout(() => this.beep(784, 0.25, 'triangle', 0.1), 110)
  }
}

/* ---------- Helpers ---------- */

function ordinal(n: number) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}

function place(obj: THREE.Object3D, x: number, y: number, z: number) {
  obj.position.set(x, y, z)
  return obj
}

function instanced(model: THREE.Object3D, matrices: THREE.Matrix4[]) {
  const group = new THREE.Group()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length)
    const tmp = new THREE.Matrix4()
    matrices.forEach((mat, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mat, m.matrixWorld)))
    im.castShadow = true
    im.receiveShadow = true
    im.computeBoundingSphere()
    group.add(im)
  })
  return group
}

function fallbackTrees(matrices: THREE.Matrix4[], kind: string) {
  const g = new THREE.Group()
  const canopy = new THREE.InstancedMesh(
    kind === 'pine' ? new THREE.ConeGeometry(2.2, 6, 7).translate(0, 5, 0) : new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5, 0),
    new THREE.MeshStandardMaterial({ color: kind === 'autumn' ? '#d97706' : '#2f7d32', flatShading: true }),
    matrices.length,
  )
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: '#7c4a21', flatShading: true }), matrices.length)
  matrices.forEach((m, i) => {
    canopy.setMatrixAt(i, m)
    trunk.setMatrixAt(i, m)
  })
  canopy.castShadow = trunk.castShadow = true
  g.add(canopy, trunk)
  return g
}

function fallbackFlag(cup: THREE.Vector3, ground: Ground) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), new THREE.MeshStandardMaterial({ color: '#f8fafc' }))
  pole.position.y = 1.5
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshStandardMaterial({ color: '#ef4444', side: THREE.DoubleSide }))
  flag.position.set(0.5, 2.6, 0)
  g.add(pole, flag)
  g.position.set(cup.x, ground.y(cup.x, cup.z), cup.z)
  return g
}
