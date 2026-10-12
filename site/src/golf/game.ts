// BOGEY BRAWL engine: one hole played by everyone at once. Swings, the ball race, melee, items, golf carts,
// hazards, checkpoints, chaos events, scoring, the third-person camera and the HUD feed.
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { CONFIG, deg } from './config'
import { Course, holeById } from './course'
import { Ground, launch, stepBall, type BallMode, type BallState } from './ball'
import { Golfer, type ItemType, type MoveInput, type Personality } from './golfer'
import { makeGolfer, prop, type GolfAssets, type PropName } from './assets'
import { aiThink } from './ai'
import { Cart, CART_RADIUS, type CartEvents } from './cart'
import { decorate, type Scenery } from './scenery'
import { Particles, Trail } from '../racer/fx'
import { isMuted } from '../lib/sound'
import { isGolfMsg, type GolfNet, type GolfSlot } from './net'

export type Phase = 'intro' | 'play' | 'overtime' | 'results'

export const ITEM_INFO: Record<ItemType, { name: string; color: string; enabled: boolean }> = {
  rocket: { name: 'Rocket Launcher', color: '#f97316', enabled: true },
  pistol: { name: 'Dueling Pistol', color: '#facc15', enabled: true },
  shield: { name: 'Electromagnet', color: '#38bdf8', enabled: true },
  landmine: { name: 'Landmine', color: '#ef4444', enabled: true },
  laser: { name: 'Orbital Laser', color: '#e879f9', enabled: true },
  airhorn: { name: 'Air Horn', color: '#a3e635', enabled: true },
  cart: { name: 'Golf Cart', color: '#f8fafc', enabled: true },
  coffee: { name: 'Coffee', color: '#a16207', enabled: true },
  springboots: { name: 'Spring Boots', color: '#22d3ee', enabled: true },
  elephant: { name: 'Elephant Gun', color: '#78716c', enabled: true },
  driver: { name: 'Rocket Driver', color: '#fb7185', enabled: true },
  freeze: { name: 'Freeze Bomb', color: '#bae6fd', enabled: true },
  tornado: { name: 'Tornado', color: '#94a3b8', enabled: true },
  swap: { name: 'Ball Swap', color: '#c084fc', enabled: true },
  banana: { name: 'Banana Peel', color: '#fde047', enabled: true },
  bouncy: { name: 'Bouncy Ball', color: '#f472b6', enabled: true },
  meteor: { name: 'Meteor', color: '#fb923c', enabled: true },
}

/** Chaos events (the Chaos toggle): one every ~30 s. */
export const CHAOS_EVENTS = ['meteors', 'gust', 'lowgrav', 'loot', 'twister'] as const
export type ChaosKind = (typeof CHAOS_EVENTS)[number]
const CHAOS_NAMES: Record<ChaosKind, [string, string]> = {
  meteors: ['METEOR SHOWER', '#fb923c'],
  gust: ['WIND GUST', '#7dd3fc'],
  lowgrav: ['LOW GRAVITY', '#c4b5fd'],
  loot: ['BRIEFCASE RAIN', '#a855f7'],
  twister: ['TWISTER ON THE LOOSE', '#cbd5e1'],
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
  /** Which hole (clients rebuild the same one from its id). */
  hole?: string
  /** Random chaos events every ~30 s. */
  chaos?: boolean
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
  /** Handbrake (Space held) while driving. */
  hb: boolean
  acts: string[]
  /** Online clients report where they've moved their own golfer. */
  pos?: [number, number, number, number]
  /** ...and the cart they're driving: x, y, z, yaw, vx, vz, vy. */
  cart?: number[]
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
  | { k: 'laser'; p: V3 }
  | { k: 'meteor'; p: V3 }
  | { k: 'swap'; a: V3; b: V3 }
  | { k: 'slip'; p: V3 }
  | { k: 'honk'; p: V3 }
  | { k: 'crash'; p: V3; v: number }
  | { k: 'ram'; p: V3 }
  | { k: 'fire'; p: V3 }
  | { k: 'boing'; p: V3 }
  | { k: 'twister'; p: V3 }
  | { k: 'poof'; p: V3 }
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
  k: number[][] // carts
  l: number[][] // orbital lasers
  x: number[][] // meteors
  t: number[][] // tornadoes
  b: number[][] // banana peels
  w: number[] // wind x, wind z, gravity, chaos event (-1 none), chaos time left
}

interface Mine {
  id: number
  owner: Golfer
  pos: THREE.Vector3
  arm: number // seconds until armed
  life: number
  mesh: THREE.Object3D
}

interface Laser {
  id: number
  owner: Golfer | null
  target: Golfer | null
  pos: THREE.Vector3
  t: number // seconds to the blast
  mesh: THREE.Group
}

interface Meteor {
  id: number
  owner: Golfer | null
  pos: THREE.Vector3 // impact point
  t: number // seconds to impact
  mesh: THREE.Group // the rock (falls) and the warning ring (stays)
}

interface Tornado {
  id: number
  owner: Golfer | null
  pos: THREE.Vector3
  heading: number
  turnT: number
  life: number
  mesh: THREE.Group
  caught: Map<object, number> // golfer/ball → time it can be caught again
}

interface Peel {
  id: number
  owner: Golfer | null
  pos: THREE.Vector3
  life: number
  grace: number
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
  markers: { id: number; x: number; y: number; color: string; dist: number; me: boolean; edge: boolean; angle: number }[]
  feed: { id: number; text: string; mine: boolean }[]
  popups: { id: number; text: string; color: string; x: number; y: number; age: number }[]
  banner: { text: string; color: string } | null
  hint: string
  locked: boolean
  /** "E · Drive the golf cart" when one is in reach. */
  prompt: string | null
  driving: boolean
  cartSpeed: number
  wind: { angle: number; speed: number } | null
  chaos: { name: string; color: string; t: number } | null
  armed: string[]
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
  readonly course: Course
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
  carts: Cart[] = []
  lasers: Laser[] = []
  meteors: Meteor[] = []
  tornadoes: Tornado[] = []
  peels: Peel[] = []
  chaos: { kind: ChaosKind; t: number } | null = null
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
  private scenery!: Scenery
  private sun: THREE.DirectionalLight
  private sunDir = new THREE.Vector3(0.45, 0.62, -0.35)
  private water!: THREE.Mesh
  private chaosT: number = CONFIG.chaos_first
  private meteorT = 0
  private baseWind = new THREE.Vector3()
  private windT = 0
  private mouseT = -99 // last time the mouse moved the camera
  private fireTrails = new Map<Golfer, Trail>()
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
    this.course = new Course(holeById(opts.hole))
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
    // The snow hole's wind blows across the fairway (gusting; see updateWind).
    if (this.course.hole.wind > 0) {
      const a = 1.9
      this.baseWind.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(this.course.hole.wind)
      this.course.wind.copy(this.baseWind)
    }
    if (opts.net) this.listen(opts.net)
  }

  /* ---------- World ---------- */

  private buildWorld() {
    const s = this.scene
    const a = this.opts.assets
    const env = this.course.hole.env
    this.sunDir.set(...env.sunDir).normalize()
    s.fog = new THREE.Fog(env.fog[0], env.fog[1], env.fog[2])
    this.renderer.toneMappingExposure = env.exposure
    if ('turbidity' in env.sky) {
      s.background = new THREE.Color(env.fog[0])
      const sky = new Sky()
      sky.scale.setScalar(4000)
      const u = sky.material.uniforms
      u.turbidity.value = env.sky.turbidity
      u.rayleigh.value = env.sky.rayleigh
      u.mieCoefficient.value = 0.004
      u.mieDirectionalG.value = 0.8
      u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000)
      s.add(sky)
    } else {
      s.background = gradientTexture(env.sky.top, env.sky.bottom)
      s.add(starField())
    }
    s.add(new THREE.HemisphereLight(env.hemi[0], env.hemi[1], env.hemi[2]))
    const sun = new THREE.DirectionalLight(env.sun[0], env.sun[1])
    sun.name = 'sun'
    sun.position.copy(this.sunDir).multiplyScalar(120)
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
    // The sea (or the lava) at the waterline.
    const lava = this.course.hole.hazard === 'lava'
    const sea = env.sea
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      lava
        ? new THREE.MeshStandardMaterial({ color: sea.color, emissive: sea.emissive ?? sea.color, emissiveIntensity: 1.2, emissiveMap: lavaTexture(), map: lavaTexture(), roughness: 0.6 })
        : new THREE.MeshStandardMaterial({ color: sea.color, roughness: 0.15, metalness: 0.1, transparent: sea.opacity < 1, opacity: sea.opacity }),
    )
    if (lava) {
      for (const m of [(this.water.material as THREE.MeshStandardMaterial).map!, (this.water.material as THREE.MeshStandardMaterial).emissiveMap!]) m.repeat.set(160, 160)
    }
    this.water.position.y = 0.02
    s.add(this.water)

    // Tee mat and markers.
    const tee = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 5), new THREE.MeshStandardMaterial({ color: '#4ade80', roughness: 0.9 }))
    tee.position.set(0, this.course.tee.y + 0.04, 0)
    tee.receiveShadow = true
    s.add(tee)
    for (const x of [-4, 4]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshStandardMaterial({ color: '#f8fafc', emissive: '#f8fafc', emissiveIntensity: lava ? 0.6 : 0 }))
      m.position.set(x, this.course.tee.y + 0.25, 1.5)
      s.add(m)
    }

    // Cup and flag.
    const cup = this.course.cup
    const hole = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.cup_radius, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b0f0a' }))
    hole.position.set(cup.x, this.ground.y(cup.x, cup.z) + 0.03, cup.z)
    s.add(hole)
    s.add(a?.props.flag ? place(prop(a.props.flag, 3.2), cup.x + 0.05, this.ground.y(cup.x, cup.z), cup.z) : fallbackFlag(cup, this.ground))
    if (lava) {
      // Night: a beacon over the cup.
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.5, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#f0abfc', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }))
      beam.position.set(cup.x, this.ground.y(cup.x, cup.z) + 20, cup.z)
      s.add(beam)
    }

    // Trees: instanced per model.
    const groups = new Map<string, THREE.Matrix4[]>()
    for (const t of this.course.trees) {
      const list = groups.get(t.kind) ?? []
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(t.x, this.ground.y(t.x, t.z) - 0.1, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0)), new THREE.Vector3(t.scale, t.scale, t.scale)))
      groups.set(t.kind, list)
    }
    const treeModel: Record<string, PropName> = { tree: 'tree', pine: 'pine', autumn: 'autumn-tree', palm: 'palm', cactus: 'cactus', crystal: 'crystals' }
    const treeHeight: Record<string, number> = { tree: 7, pine: 9, autumn: 7.5, palm: 8, cactus: 3.6, crystal: 3.2 }
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

    // Parked golf carts (ids 0..n-1 on every screen).
    this.course.cartSpots.forEach((spot, i) => {
      const c = new Cart(i, a, { pos: spot.pos.clone(), yaw: spot.yaw }, null)
      c.updateMesh(1, this.ground)
      s.add(c.mesh)
      this.carts.push(c)
    })

    // The biome's scenery: props (some solid), animals, balloons, the volcano, weather.
    this.scenery = decorate({ scene: s, assets: a, course: this.course, ground: this.ground })
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
      const mine = slot.id === selfId
      const rig = makeGolfer(this.opts.assets, p.color)
      // Your own ball glows brighter so it's easy to pick out among the others.
      const ballMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 12),
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: p.color, emissiveIntensity: mine ? 0.7 : 0.25 }),
      )
      ballMesh.castShadow = true
      // Taller, brighter beacon for your ball; a thin pillar for everyone else.
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(mine ? 0.09 : 0.05, mine ? 0.09 : 0.05, mine ? 3.4 : 2.2, mine ? 10 : 6),
        new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: mine ? 0.95 : 0.7, toneMapped: false }),
      )
      marker.position.y = mine ? 1.7 : 1.2
      ballMesh.add(marker)
      if (mine) {
        // A spinning halo over your ball as an extra "this one is yours" cue.
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.5, 0.06, 8, 20),
          new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.9, toneMapped: false }),
        )
        halo.rotation.x = Math.PI / 2
        halo.position.y = 3.5
        halo.name = 'myHalo'
        ballMesh.add(halo)
      }
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
      carts: this.carts.map((c) => ({ id: c.id, x: +c.pos.x.toFixed(1), y: +c.pos.y.toFixed(1), z: +c.pos.z.toFixed(1), speed: +c.speed.toFixed(1), driver: c.driver?.name ?? null, passenger: c.passenger?.name ?? null, sunk: c.sunk > 0 })),
      riding: this.golfers.map((g) => (g.cart ? g.cart.id : -1)),
      lasers: this.lasers.length,
      meteors: this.meteors.length,
      tornadoes: this.tornadoes.length,
      peels: this.peels.length,
      chaos: this.chaos?.kind ?? null,
      wind: +this.course.wind.length().toFixed(1),
      gravity: this.course.gravity,
      hole: this.course.hole.id,
      feed: this.feedList.map((f) => f.text),
      stats: this.stats,
    }
  }

  /** Counters for tests and the curious: cart rides, run-overs, balls hit by carts. */
  readonly stats = { rides: 0, rams: 0, ballHits: 0 }

  /** Test hook: put an item in a golfer's active slot. */
  debugGive(idx: number, item: ItemType) {
    const g = this.golfers[idx]
    if (!g) return false
    g.inventory[g.active] = null
    g.mineCharges = 0
    return g.give(item)
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
    if (Math.abs(e.movementX) > 1) this.mouseT = this.time
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
    if (playing) {
      this.updateChaos(dt)
      this.updateWind(dt)
    }
    for (const g of this.golfers) {
      let m: MoveInput | null = null
      if (playing) {
        if (g === this.me && this.opts.autopilot) m = aiThink(this, g, dt)
        else if (g.human) m = this.applyPad(g, g === this.me ? pad : this.padFor(g))
        else m = aiThink(this, g, dt)
      }
      // In a cart, the driver's input steers the cart; the golfer just rides along.
      if (g.cart) {
        if (g.cart.driver === g) g.cart.control = m
        g.update(dt, null, this.ground, this.course, this.golfers)
      } else g.update(dt, m, this.ground, this.course, this.golfers)
      if (g.charging > 0) g.charging += dt
      // A remote player moves their own golfer; trust it while nothing here is pushing them around.
      const rp = g !== this.me && g.remoteId ? this.remotePads.get(g.remoteId)?.pos : undefined
      if (rp && !this.forced(g) && Math.hypot(rp[0] - g.pos.x, rp[2] - g.pos.z) < 6) {
        g.pos.set(rp[0], rp[1], rp[2])
        g.yaw = rp[3]
      }
      this.afterMove(g, dt)
    }
    this.updateCarts(dt)
    // Balls.
    for (const g of this.golfers) {
      const ev = stepBall(g.ball, dt, this.ground, this.course)
      if (ev.holed) this.holed(g)
      if (ev.water) {
        this.fx({ k: 'splash', p: v3(g.ball.pos) })
        this.startRespawn(g)
      }
      if (ev.bounced && g.ball.bouncy && this.near(g.ball.pos, 60)) this.beep(520 + Math.random() * 200, 0.12, 'sine', 0.05)
      else if (ev.bounced && this.near(g.ball.pos, 60)) this.beep(140, 0.05, 'triangle', 0.05)
      // The shot's over: the rubber and the fire wear off.
      if (g.ball.mode === 'rest' || g.ball.mode === 'holed' || g.ball.mode === 'water') {
        g.ball.bouncy = false
        g.ballFire = 0
      } else if (g.ballFire > 0) g.ballFire = Math.max(0, g.ballFire - dt)
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
    this.updateLasers(dt)
    this.updateMeteors(dt)
    this.updateTornadoes(dt)
    this.updatePeels(dt)
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
    if (pressed.has('KeyE')) acts.push('enter')
    if (pressed.has('KeyH')) acts.push('horn')
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
    return { x, y, yaw: this.camYaw, loft: this.me.loft, creep: k.has('KeyC') || k.has('AltLeft'), hb: k.has('Space'), acts }
  }

  private padFor(g: Golfer): Pad {
    return this.remotePads.get(g.remoteId ?? '') ?? { x: 0, y: 0, yaw: g.aim, loft: g.loft, creep: false, hb: false, acts: [] }
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
      else if (a === 'enter') this.toggleCart(g)
      else if (a === 'horn') this.honk(g)
      else if (a === 'item' && g.canAct && g.charging <= 0) this.useItem(g)
      else if (a === 'press' && g.canAct && g.cooldown <= 0 && !g.cart) {
        if (this.canSwing(g)) this.startCharge(g, pad.yaw)
        else this.melee(g)
      }
    }
    if (g.charging > 0) this.faceShot(g, pad.yaw)
    if (pad.acts.includes('release') && g.charging > 0) this.release(g, pad.yaw, g.loft)
    if (g.cart) return { x: pad.x, y: pad.y, yaw: pad.yaw, jump: false, dive: false, creep: false, brake: pad.hb }
    return { x: pad.x, y: pad.y, yaw: pad.yaw, jump: pad.acts.includes('jump'), dive: pad.acts.includes('dive'), creep: pad.creep }
  }

  /** The host is moving this golfer itself (knocked about, lining up a swing, respawning, riding...). */
  private forced(g: Golfer) {
    return g.stun > 0 || g.respawn > 0 || g.charging > 0 || g.finished || g.leap > 0 || g.frozen > 0 || g.kb.lengthSq() > 1 || !!g.cart || g.spin > 0
  }

  /* ---------- Swing ---------- */

  canSwing(g: Golfer) {
    return g.ball.mode === 'rest' && !g.cart && g.ball.pos.distanceTo(g.pos) < CONFIG.swing_reach && g.canAct
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
    // Rocket Driver: a full swing at double power with a fiery trail (putts don't use it up).
    const rocket = g.driverArmed && !putt
    g.ball.vel.copy(launch(dir, power, loft, putt, rocket ? CONFIG.rocket_driver_power / 100 : 1))
    g.ball.mode = putt ? 'rolling' : 'air'
    g.ball.skips = 0
    if (rocket) {
      g.driverArmed = false
      g.ballFire = 6
      this.fx({ k: 'fire', p: v3(g.ball.pos) })
    }
    // Bouncy Ball: this shot is rubber.
    if (g.bouncyArmed) {
      g.bouncyArmed = false
      g.ball.bouncy = true
      this.fx({ k: 'boing', p: v3(g.ball.pos) })
    }
    g.strokes++
    this.fx({ k: 'thwack', v: putt ? 0.4 : power })
  }

  /** A club swing with no ball nearby is a melee attack. */
  melee(g: Golfer) {
    if (!g.canAct || g.swing > 0 || g.cooldown > 0 || g.cart) return
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
    // Things you can't do from a cart seat, and a swap with nobody ahead of you.
    if (g.cart && (it === 'springboots' || it === 'cart')) {
      this.say('Get out of the cart first (E)', '#f87171', 1.2, g)
      return false
    }
    const swapWith = it === 'swap' ? this.swapTarget(g) : null
    if (it === 'swap' && !swapWith) {
      this.say("Nobody's ball is ahead of yours", '#f87171', 1.2, g)
      return false
    }
    // Landmines and banana peels come in a pack: the slot empties on the last one.
    if (it === 'landmine' && (g.mineCharges = (g.mineCharges || CONFIG.landmine_charges) - 1) > 0) {
      /* keep the item */
    } else if (it === 'banana' && (g.peelCharges = (g.peelCharges || CONFIG.banana_charges) - 1) > 0) {
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
    } else if (it === 'laser') {
      // A targeting beam locks on to the leader and drifts after them, then the blast.
      const tgt = target ?? this.leaderExcept(g) ?? this.nearestRival(g, 999)
      const at = tgt ? tgt.pos.clone() : g.pos.clone().addScaledVector(fwd, 30)
      at.y = this.ground.y(at.x, at.z)
      this.lasers.push({ id: this.entityId++, owner: g, target: tgt, pos: at, t: CONFIG.laser_delay, mesh: this.makeLaser(at) })
      this.feed(`${g.name} called down an Orbital Laser${tgt ? ` on ${tgt.name}` : ''}`, tgt ? [g, tgt] : [g])
      if (tgt) this.say('ORBITAL LASER ON YOU · RUN!', '#e879f9', 2, tgt)
      this.fx({ k: 'beep', f: 880, d: 0.5, w: 'sawtooth', g: 0.05 })
    } else if (it === 'driver') {
      g.driverArmed = true
      this.say('Rocket Driver armed · next swing ×2', '#fb7185', 1.8, g)
      this.fx({ k: 'beep', f: 180, d: 0.45, w: 'sawtooth', g: 0.07 })
    } else if (it === 'cart') {
      // A cart appears beside you and you hop straight in.
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
      const p = g.pos.clone().addScaledVector(right, 2.6)
      if (this.ground.y(p.x, p.z) < 0.4 || !this.ground.inBounds(p.x, p.z)) p.copy(g.pos)
      p.y = this.ground.y(p.x, p.z)
      const c = new Cart(this.entityId++, this.opts.assets, null, g, g.color)
      c.reset(p, yaw)
      c.updateMesh(1, this.ground)
      this.scene.add(c.mesh)
      this.carts.push(c)
      this.enterCart(g, c)
      this.fx({ k: 'poof', p: v3(p) })
      this.feed(`${g.name} summoned a golf cart`, [g])
    } else if (it === 'tornado') {
      const p = g.pos.clone().addScaledVector(fwd, 9)
      this.spawnTornado(p, yaw, g)
      this.feed(`${g.name} unleashed a Tornado`, [g])
    } else if (it === 'swap' && swapWith) {
      this.swapBalls(g, swapWith)
    } else if (it === 'banana') {
      const p = g.pos.clone().addScaledVector(fwd, -1.4)
      p.y = this.ground.y(p.x, p.z)
      this.peels.push({ id: this.entityId++, owner: g, pos: p, life: CONFIG.banana_lifetime, grace: 1.5, mesh: this.makePeel(p) })
      this.fx({ k: 'beep', f: 520, d: 0.1, w: 'triangle', g: 0.05 })
    } else if (it === 'bouncy') {
      g.bouncyArmed = true
      this.say('Bouncy Ball · your next shot is rubber', '#f472b6', 1.8, g)
      this.fx({ k: 'boing', p: v3(g.pos) })
    } else if (it === 'meteor') {
      const tgt = target ?? this.leaderExcept(g)
      const at = tgt ? tgt.pos.clone() : g.pos.clone().addScaledVector(fwd, 25)
      const a = Math.random() * Math.PI * 2, d = Math.random() * CONFIG.meteor_spread
      at.x += Math.cos(a) * d
      at.z += Math.sin(a) * d
      this.spawnMeteor(at, g)
      this.feed(`${g.name} called a Meteor${tgt ? ` on ${tgt.name}` : ''}`, tgt ? [g, tgt] : [g])
      if (tgt) this.say('METEOR INCOMING!', '#fb923c', 1.6, tgt)
    }
    return true
  }

  /* ---------- Golf carts ---------- */

  /** E: get in the nearest cart with a free seat, or get out. */
  toggleCart(g: Golfer) {
    if (g.cart) {
      this.leaveCart(g, false)
      return
    }
    if (!g.canAct || g.charging > 0 || g.leap > 0 || g.air > 1) return
    const c = this.cartNear(g.pos, CONFIG.cart_enter_range)
    if (c) this.enterCart(g, c)
  }

  /** The nearest cart with a free seat within `range` (the driver's seat if `needDriverSeat`). */
  cartNear(p: THREE.Vector3, range: number, needDriverSeat = false) {
    let best: Cart | null = null
    let bd = range
    for (const c of this.carts) {
      if (c.sunk > 0 || (c.driver && (c.passenger || needDriverSeat))) continue
      c.closest(p.x, p.z, tmpA)
      const d = Math.hypot(tmpA.x - p.x, tmpA.z - p.z)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return best
  }

  cartById(id: number) {
    return this.carts.find((c) => c.id === id) ?? null
  }

  enterCart(g: Golfer, c: Cart) {
    if (!c.driver) {
      c.driver = g
      g.seat = 0
    } else if (!c.passenger) {
      c.passenger = g
      g.seat = 1
    } else return false
    g.cart = c
    this.stats.rides++
    g.charging = 0
    g.creeping = false
    g.vel.set(0, 0, 0)
    g.ai.plan = null
    c.idle = 0
    c.seatPos(g.seat, g.pos)
    g.yaw = c.yaw
    this.fxTo(g, { k: 'beep', f: 520, d: 0.12, w: 'triangle', g: 0.06 })
    return true
  }

  /** Step out beside the cart (or get thrown out: the knockback does the rest). */
  leaveCart(g: Golfer, thrown: boolean) {
    const c = g.cart
    if (!c) return
    if (c.driver === g) {
      c.driver = null
      c.control = null
    }
    if (c.passenger === g) c.passenger = null
    g.cart = null
    if (thrown) return
    // Out on your own side (the other side, or the back, if that's water).
    const lx = Math.cos(c.yaw), lz = -Math.sin(c.yaw) // the cart's local +x (the driver's side)
    const side = g.seat === 0 ? 1 : -1
    const tries: [number, number][] = [
      [c.pos.x + lx * side * 1.7, c.pos.z + lz * side * 1.7],
      [c.pos.x - lx * side * 1.7, c.pos.z - lz * side * 1.7],
      [c.pos.x - Math.sin(c.yaw) * 2.2, c.pos.z - Math.cos(c.yaw) * 2.2],
    ]
    const spot = tries.find(([x, z]) => this.ground.y(x, z) > 0.3) ?? tries[0]
    g.pos.set(spot[0], this.ground.y(spot[0], spot[1]), spot[1])
    g.vy = 0
    g.vel.copy(c.vel).multiplyScalar(0.3)
    this.fxTo(g, { k: 'beep', f: 420, d: 0.1, w: 'triangle', g: 0.05 })
  }

  private lastHonk = new Map<Golfer, number>()

  honk(g: Golfer) {
    if (!g.cart || this.time - (this.lastHonk.get(g) ?? -9) < 0.8) return
    this.lastHonk.set(g, this.time)
    this.fx({ k: 'honk', p: v3(g.pos) })
  }

  /** Carts: drive, run people over, launch balls, sink in the lake. Host and solo. */
  private updateCarts(dt: number) {
    for (const c of this.carts) {
      if (c.sunk > 0) {
        c.sunk -= dt
        c.updateMesh(dt, this.ground)
        if (c.sunk <= 0) {
          if (c.home) {
            c.reset(c.home.pos, c.home.yaw)
            c.updateMesh(1, this.ground)
            this.fx({ k: 'poof', p: v3(c.pos) })
          } else c.idle = Infinity
        }
        continue
      }
      c.hold = Math.max(0, c.hold - dt)
      if (!c.driver) c.control = null
      // An online driver steers their own cart; trust it while nothing here is throwing it about.
      const d = c.driver
      const rc = d && d !== this.me && d.remoteId ? this.remotePads.get(d.remoteId)?.cart : undefined
      const ev: CartEvents = {}
      if (rc && rc.length >= 8 && c.hold <= 0 && Math.hypot(rc[0] - c.pos.x, rc[2] - c.pos.z) < 8) {
        c.pos.set(rc[0], rc[1], rc[2])
        c.yaw = rc[3]
        c.vel.set(rc[4], 0, rc[5])
        c.vy = rc[6]
        c.grounded = rc[7] === 1
        c.updateMesh(dt, this.ground)
      } else c.step(dt, this.ground, this.course, ev)
      if (ev.hit && ev.hit > 4) this.fx({ k: 'crash', p: v3(c.pos), v: Math.min(1, ev.hit / CONFIG.cart_speed) })
      if (ev.landed && ev.landed > 5) this.fx({ k: 'crash', p: v3(c.pos), v: Math.min(1, ev.landed / 14) })
      this.cartHits(c)
      // Into the water (or the lava), or off the map.
      if ((this.ground.y(c.pos.x, c.pos.z) < 0.05 && c.pos.y < 0.6) || !this.ground.inBounds(c.pos.x, c.pos.z)) {
        this.sinkCart(c)
        continue
      }
      if (c.driver) {
        c.seatPos(0, c.driver.pos)
        c.driver.yaw = c.yaw
      }
      if (c.passenger) {
        c.seatPos(1, c.passenger.pos)
        c.passenger.yaw = c.yaw
      }
      if (c.driver || c.passenger) c.idle = 0
      else c.idle += dt
    }
    // Summoned carts nobody is using (or that sank) go away.
    for (const c of this.carts) {
      if (c.home || c.idle <= CONFIG.cart_idle_life) continue
      if (Number.isFinite(c.idle)) this.fx({ k: 'poof', p: v3(c.pos) })
      this.scene.remove(c.mesh)
    }
    this.carts = this.carts.filter((c) => c.home || c.idle <= CONFIG.cart_idle_life)
  }

  /** Running people over, driving through balls, carts bumping carts. */
  private cartHits(c: Cart) {
    const sp = c.speed
    const by = c.driver
    for (const o of this.golfers) {
      if (o.cart || o.respawn > 0 || o.finished || o.pos.y > c.pos.y + 1.8) continue
      c.closest(o.pos.x, o.pos.z, tmpA)
      let dx = o.pos.x - tmpA.x, dz = o.pos.z - tmpA.z
      const d = Math.hypot(dx, dz)
      const reach = CART_RADIUS + CONFIG.player_radius
      if (d >= reach) continue
      if (d < 1e-3) {
        dx = Math.cos(c.yaw)
        dz = -Math.sin(c.yaw)
      } else {
        dx /= d
        dz /= d
      }
      const closing = c.vel.x * dx + c.vel.z * dz
      if (sp > CONFIG.cart_ram_min_speed && closing > 1.5 && o.protect <= 0) {
        const shielded = o.shield > 0
        tmpB.copy(c.vel).multiplyScalar(0.7 / sp).add(tmpC.set(dx * 0.3, 0, dz * 0.3))
        const hit = this.knock(o, by, 'Golf Cart', CONFIG.cart_ram_stun, CONFIG.cart_ram_knockback * Math.min(1, sp / CONFIG.cart_speed), tmpB, false)
        if (hit) {
          this.stats.rams++
          o.vy = Math.max(o.vy, 4 + sp * 0.35)
          this.fx({ k: 'ram', p: v3(o.pos) })
          c.vel.multiplyScalar(0.85)
        } else if (shielded) {
          // The Electromagnet bounces the cart off.
          c.vel.multiplyScalar(-0.45)
          c.hold = 0.5
        }
      }
      // Either way they end up beside the cart, not under it.
      o.pos.x = tmpA.x + dx * reach
      o.pos.z = tmpA.z + dz * reach
    }
    for (const o of this.golfers) {
      const b = o.ball
      if (b.mode === 'holed' || b.mode === 'water' || b.pos.y > c.pos.y + 1.4) continue
      c.closest(b.pos.x, b.pos.z, tmpA)
      let dx = b.pos.x - tmpA.x, dz = b.pos.z - tmpA.z
      const d = Math.hypot(dx, dz)
      const reach = CART_RADIUS + CONFIG.ball_radius
      if (d >= reach) continue
      if (d < 1e-3) {
        dx = Math.sin(c.yaw)
        dz = Math.cos(c.yaw)
      } else {
        dx /= d
        dz /= d
      }
      b.pos.x = tmpA.x + dx * reach * 1.05
      b.pos.z = tmpA.z + dz * reach * 1.05
      if (sp < 0.8 || this.time < (c.hits.get(b) ?? 0)) continue
      c.hits.set(b, this.time + 0.4)
      this.stats.ballHits++
      // Off it goes, along the cart's travel and splayed by where it was hit.
      const out = Math.max(1.5, sp * CONFIG.cart_ball_mult)
      tmpB.set((c.vel.x / sp) * 0.75 + dx * 0.45, 0, (c.vel.z / sp) * 0.75 + dz * 0.45).normalize()
      const lift = sp > 6
      b.vel.set(tmpB.x * out, lift ? 2 + sp * 0.45 : 0, tmpB.z * out)
      b.mode = lift ? 'air' : 'rolling'
      b.pos.y = this.ground.y(b.pos.x, b.pos.z) + CONFIG.ball_radius + (lift ? 0.05 : 0)
      this.fx({ k: 'thwack', v: Math.min(1, sp / CONFIG.cart_speed) })
      if (lift && by && o !== by) this.feed(`${by.name} launched ${o.name}'s ball with a golf cart`, [by, o])
    }
    // Carts push each other apart.
    for (const k of this.carts) {
      if (k === c || k.sunk > 0) continue
      const dx = c.pos.x - k.pos.x, dz = c.pos.z - k.pos.z
      const d = Math.hypot(dx, dz)
      if (d > 2.2 || d < 1e-3) continue
      const push = (2.2 - d) * 0.5
      c.pos.x += (dx / d) * push
      c.pos.z += (dz / d) * push
      k.pos.x -= (dx / d) * push
      k.pos.z -= (dz / d) * push
      const vn = (c.vel.x - k.vel.x) * (dx / d) + (c.vel.z - k.vel.z) * (dz / d)
      if (vn < -3) {
        this.fx({ k: 'crash', p: v3(c.pos), v: Math.min(1, -vn / CONFIG.cart_speed) })
        k.vel.addScaledVector(tmpB.set(-dx / d, 0, -dz / d), -vn * 0.6)
        c.vel.multiplyScalar(0.5)
        k.hold = 0.4
      }
    }
  }

  private sinkCart(c: Cart) {
    if (c.sunk > 0) return
    c.sunk = CONFIG.cart_sink_time
    c.vel.set(0, 0, 0)
    this.fx({ k: 'splash', p: v3(c.pos) })
    const who = c.driver
    for (const r of c.riders()) this.startRespawn(r)
    if (who) this.feed(`${who.name} drove into the ${this.course.hole.hazard === 'lava' ? 'lava' : 'water'}`, [who])
  }

  /* ---------- Chaos items ---------- */

  /** A blast that stuns everyone in `radius` (but its owner), throws balls about and flips carts. */
  private blast(at: THREE.Vector3, owner: Golfer | null, radius: number, stun: number, kb: number, weapon: string) {
    for (const c of this.carts) {
      if (c.sunk > 0 || Math.hypot(c.pos.x - at.x, c.pos.z - at.z) > radius) continue
      c.vy = 9
      c.grounded = false
      c.spin = 1
      c.hold = 1
    }
    for (const o of this.golfers) {
      if (o === owner) continue
      const d = Math.hypot(o.pos.x - at.x, o.pos.z - at.z)
      if (d < radius && this.knock(o, owner, weapon, stun, kb * (1 - (d / radius) * 0.5), tmpB.set(o.pos.x - at.x, 0, o.pos.z - at.z), true)) o.vy = Math.max(o.vy, 8)
    }
    for (const o of this.golfers) {
      const b = o.ball
      if (b.mode === 'holed' || b.mode === 'water') continue
      const d = Math.hypot(b.pos.x - at.x, b.pos.z - at.z)
      if (d > radius) continue
      tmpB.set(b.pos.x - at.x, 0, b.pos.z - at.z)
      if (tmpB.lengthSq() < 1e-4) tmpB.set(Math.random() - 0.5, 0, Math.random() - 0.5)
      tmpB.normalize().multiplyScalar(14 * (1 - d / radius) + 3)
      b.vel.set(tmpB.x, 9, tmpB.z)
      b.mode = 'air'
    }
    for (const m of this.mines) if (m.pos.distanceTo(at) < radius) m.life = -1
    for (const p of this.peels) if (p.pos.distanceTo(at) < radius) p.life = -1
  }

  private updateLasers(dt: number) {
    for (const l of this.lasers) {
      l.t -= dt
      const t = l.target
      if (t && !t.finished && t.respawn <= 0) {
        tmpA.set(t.pos.x - l.pos.x, 0, t.pos.z - l.pos.z)
        const d = tmpA.length()
        if (d > 0.05) l.pos.addScaledVector(tmpA, Math.min(d, CONFIG.laser_track_speed * dt) / d)
      }
      l.pos.y = Math.max(0, this.ground.y(l.pos.x, l.pos.z))
      l.mesh.position.copy(l.pos)
      if (l.t <= 0) {
        this.fx({ k: 'laser', p: v3(l.pos) })
        this.blast(l.pos, l.owner, CONFIG.laser_radius, CONFIG.laser_stun, CONFIG.laser_knockback, 'Orbital Laser')
      }
    }
    for (const l of this.lasers) if (l.t <= 0) this.scene.remove(l.mesh)
    this.lasers = this.lasers.filter((l) => l.t > 0)
  }

  spawnMeteor(at: THREE.Vector3, owner: Golfer | null) {
    at.y = Math.max(0, this.ground.y(at.x, at.z))
    this.meteors.push({ id: this.entityId++, owner, pos: at, t: CONFIG.meteor_delay, mesh: this.makeMeteor(at) })
    this.fx({ k: 'beep', f: 1400, d: 0.6, w: 'sine', g: 0.03 })
  }

  private updateMeteors(dt: number) {
    for (const m of this.meteors) {
      m.t -= dt
      if (m.t <= 0) {
        this.fx({ k: 'meteor', p: v3(m.pos) })
        this.blast(m.pos, m.owner, CONFIG.meteor_radius, CONFIG.meteor_stun, CONFIG.meteor_knockback, 'Meteor')
      }
    }
    for (const m of this.meteors) if (m.t <= 0) this.scene.remove(m.mesh)
    this.meteors = this.meteors.filter((m) => m.t > 0)
  }

  spawnTornado(p: THREE.Vector3, heading: number, owner: Golfer | null) {
    const b = this.course.bounds
    p.x = THREE.MathUtils.clamp(p.x, b.minX + 10, b.maxX - 10)
    p.z = THREE.MathUtils.clamp(p.z, b.minZ + 10, b.maxZ - 10)
    p.y = Math.max(0, this.ground.y(p.x, p.z))
    this.tornadoes.push({ id: this.entityId++, owner, pos: p, heading, turnT: 1, life: CONFIG.tornado_life, mesh: this.makeTornado(p), caught: new Map() })
    this.fx({ k: 'twister', p: v3(p) })
  }

  private updateTornadoes(dt: number) {
    for (const t of this.tornadoes) {
      t.life -= dt
      t.turnT -= dt
      if (t.turnT <= 0) {
        // It wanders, drawn towards golfers (never its owner) and back towards the fairway.
        t.turnT = 1.2 + Math.random() * 1.3
        let want = t.heading + (Math.random() - 0.5) * 1.6
        let prey: Golfer | null = null
        let pd = 40
        for (const o of this.golfers) {
          if (o === t.owner || o.finished || o.respawn > 0) continue
          const d = o.pos.distanceTo(t.pos)
          if (d < pd) {
            pd = d
            prey = o
          }
        }
        if (prey && Math.random() < 0.65) want = Math.atan2(prey.pos.x - t.pos.x, prey.pos.z - t.pos.z)
        const rn = this.course.routeNearest(t.pos.x, t.pos.z)
        if (rn.dist > 28) {
          const rp = this.course.routePoint(rn.s)
          want = Math.atan2(rp.x - t.pos.x, rp.z - t.pos.z)
        }
        t.heading = want
      }
      t.pos.x += Math.sin(t.heading) * CONFIG.tornado_speed * dt
      t.pos.z += Math.cos(t.heading) * CONFIG.tornado_speed * dt
      const b = this.course.bounds
      t.pos.x = THREE.MathUtils.clamp(t.pos.x, b.minX + 10, b.maxX - 10)
      t.pos.z = THREE.MathUtils.clamp(t.pos.z, b.minZ + 10, b.maxZ - 10)
      t.pos.y = Math.max(0, this.ground.y(t.pos.x, t.pos.z))
      t.mesh.position.copy(t.pos)
      // Golfers are dragged in, then caught and flung.
      for (const o of this.golfers) {
        if (o === t.owner || o.respawn > 0 || o.finished) continue
        const dx = o.pos.x - t.pos.x, dz = o.pos.z - t.pos.z
        const d = Math.hypot(dx, dz) || 0.01
        if (d < CONFIG.tornado_radius && (t.caught.get(o) ?? 0) <= this.time) {
          t.caught.set(o, this.time + 2.5)
          tmpB.set(-dz / d + (dx / d) * 0.6, 0, dx / d + (dz / d) * 0.6)
          const c = o.cart
          if (c) {
            c.vy = 10
            c.grounded = false
            c.spin = 1.5
            c.hold = 1
          }
          if (this.knock(o, t.owner, 'Tornado', CONFIG.tornado_stun, CONFIG.tornado_fling, tmpB, false)) o.vy = CONFIG.tornado_lift
        } else if (d < CONFIG.tornado_pull_radius && !o.cart && o.stun <= 0) {
          o.kb.x -= (dx / d) * CONFIG.tornado_pull * 4 * dt
          o.kb.z -= (dz / d) * CONFIG.tornado_pull * 4 * dt
        }
      }
      // Empty carts get picked up too.
      for (const c of this.carts) {
        if (c.sunk > 0 || c.driver || Math.hypot(c.pos.x - t.pos.x, c.pos.z - t.pos.z) > CONFIG.tornado_radius + 1 || (t.caught.get(c) ?? 0) > this.time) continue
        t.caught.set(c, this.time + 3)
        c.vy = 10
        c.grounded = false
        c.spin = 1.5
        c.vel.set(Math.sin(t.heading) * 8, 0, Math.cos(t.heading) * 8)
      }
      // Balls are whisked up and flung.
      for (const o of this.golfers) {
        const bl = o.ball
        if (bl.mode === 'holed' || bl.mode === 'water' || bl.pos.y > t.pos.y + 10 || (t.caught.get(bl) ?? 0) > this.time) continue
        const dx = bl.pos.x - t.pos.x, dz = bl.pos.z - t.pos.z
        const d = Math.hypot(dx, dz) || 0.01
        if (d > CONFIG.tornado_radius + 0.5) continue
        t.caught.set(bl, this.time + 1.5)
        bl.vel.set((-dz / d) * 10 + (dx / d) * 5, CONFIG.tornado_lift * 0.9, (dx / d) * 10 + (dz / d) * 5)
        bl.mode = 'air'
      }
      if (t.life <= 0) this.fx({ k: 'poof', p: v3(t.pos) })
    }
    for (const t of this.tornadoes) if (t.life <= 0) this.scene.remove(t.mesh)
    this.tornadoes = this.tornadoes.filter((t) => t.life > 0)
  }

  private updatePeels(dt: number) {
    for (const p of this.peels) {
      p.life -= dt
      p.grace -= dt
      for (const o of this.golfers) {
        if (o.cart || o.respawn > 0 || o.finished || o.air > 0.6) continue
        if (o === p.owner && p.grace > 0) continue
        if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) > CONFIG.banana_radius) continue
        // Whoosh: they slide on along their way, spinning.
        if (o.vel.lengthSq() > 0.25) tmpB.copy(o.vel)
        else tmpB.set(Math.sin(o.yaw), 0, Math.cos(o.yaw))
        if (this.knock(o, o === p.owner ? null : p.owner, 'Banana Peel', CONFIG.banana_stun, CONFIG.banana_slide, tmpB, false)) o.spin = CONFIG.banana_stun
        p.life = -1
        this.fx({ k: 'slip', p: v3(p.pos) })
        break
      }
      if (p.life <= 0) continue
      for (const c of this.carts) {
        if (c.sunk > 0) continue
        c.closest(p.pos.x, p.pos.z, tmpA)
        if (Math.hypot(tmpA.x - p.pos.x, tmpA.z - p.pos.z) > CART_RADIUS + 0.3) continue
        c.spin = 1.4
        c.hold = 0.8
        c.vel.multiplyScalar(0.75)
        p.life = -1
        this.fx({ k: 'slip', p: v3(p.pos) })
        if (c.driver) this.feed(`${c.driver.name} spun out on a banana peel`, [c.driver])
        break
      }
    }
    for (const p of this.peels) if (p.life <= 0) this.scene.remove(p.mesh)
    this.peels = this.peels.filter((p) => p.life > 0)
  }

  /** The rival ball furthest ahead of yours (Ball Swap's target), or null when yours is in front. */
  swapTarget(g: Golfer) {
    if (g.finished || g.ball.mode === 'holed' || g.ball.mode === 'water') return null
    let best: Golfer | null = null
    let bp = this.course.progress(g.ball.pos.x, g.ball.pos.z) + CONFIG.swap_min_gain
    for (const o of this.golfers) {
      const b = o.ball
      if (o === g || o.finished || b.mode === 'holed' || b.mode === 'water') continue
      const p = this.course.progress(b.pos.x, b.pos.z)
      if (p > bp) {
        bp = p
        best = o
      }
    }
    return best
  }

  private swapBalls(g: Golfer, o: Golfer) {
    const a = g.ball, b = o.ball
    tmpA.copy(a.pos)
    a.pos.copy(b.pos)
    b.pos.copy(tmpA)
    for (const x of [a, b] as BallState[]) {
      x.vel.set(0, 0, 0)
      x.mode = 'rest'
      x.bouncy = false
      x.pos.y = this.ground.y(x.pos.x, x.pos.z) + CONFIG.ball_radius
    }
    g.ai.plan = o.ai.plan = null
    g.ballFire = o.ballFire = 0
    this.fx({ k: 'swap', a: v3(a.pos), b: v3(b.pos) })
    this.feed(`${g.name} swapped balls with ${o.name}`, [g, o])
    this.say('BALL SWAPPED!', '#c084fc', 1.8, o)
    this.say(`Swapped with ${o.name}'s ball`, '#c084fc', 1.6, g)
  }

  /* ---------- Chaos events ---------- */

  private gust = new THREE.Vector3()

  private updateChaos(dt: number) {
    const ch = this.chaos
    if (ch) {
      ch.t -= dt
      if (ch.kind === 'meteors') {
        this.meteorT -= dt
        if (this.meteorT <= 0) {
          this.meteorT = 6 / CONFIG.chaos_meteors
          const live = this.golfers.filter((g) => !g.finished && g.respawn <= 0)
          const who = live[Math.floor(Math.random() * live.length)]
          if (who) {
            const at = (Math.random() < 0.5 ? who.pos : who.ball.pos).clone()
            const a = Math.random() * Math.PI * 2, d = Math.random() * 10
            at.x += Math.cos(a) * d
            at.z += Math.sin(a) * d
            this.spawnMeteor(at, null)
          }
        }
      }
      if (ch.t <= 0) {
        if (ch.kind === 'lowgrav') this.course.gravity = 1
        this.chaos = null
      }
      return
    }
    if (!this.opts.chaos) return
    this.chaosT -= dt
    if (this.chaosT > 0) return
    this.chaosT = CONFIG.chaos_interval + (Math.random() - 0.5) * 8
    this.startChaos(CHAOS_EVENTS[Math.floor(Math.random() * CHAOS_EVENTS.length)])
  }

  /** Start a chaos event now (also a test hook). */
  startChaos(kind: ChaosKind) {
    const [name, color] = CHAOS_NAMES[kind]
    if (this.chaos?.kind === 'lowgrav') this.course.gravity = 1
    this.chaos = { kind, t: kind === 'loot' ? 3 : kind === 'meteors' ? 6 : kind === 'twister' ? CONFIG.tornado_life : CONFIG.chaos_duration }
    this.say(`CHAOS · ${name}`, color, 2.6)
    this.feed(`Chaos: ${name.toLowerCase()}`, [])
    this.fx({ k: 'beep', f: 330, d: 0.25, w: 'square', g: 0.05 })
    this.fx({ k: 'beep', f: 495, d: 0.35, w: 'square', g: 0.04 })
    const live = this.golfers.filter((g) => !g.finished && g.respawn <= 0)
    if (kind === 'meteors') this.meteorT = 0.3
    else if (kind === 'gust') {
      const a = Math.random() * Math.PI * 2
      this.gust.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(CONFIG.chaos_wind)
    } else if (kind === 'lowgrav') this.course.gravity = CONFIG.chaos_gravity
    else if (kind === 'loot') {
      for (let k = 0, n = 0; k < 30 && n < CONFIG.chaos_loot && live.length; k++) {
        const who = live[k % live.length]
        const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 9
        const x = who.pos.x + Math.cos(a) * d, z = who.pos.z + Math.sin(a) * d
        if (this.ground.y(x, z) < 0.5 || !this.ground.inBounds(x, z)) continue
        const p = new THREE.Vector3(x, this.ground.y(x, z), z)
        const it = this.rollItem()
        this.cases.push({ id: this.entityId++, pos: p, ready: true, timer: 0, mesh: this.itemMesh(it, p), item: it })
        this.fx({ k: 'poof', p: v3(p) })
        n++
      }
    } else if (kind === 'twister') {
      const c = new THREE.Vector3()
      for (const g of live) c.add(g.pos)
      if (live.length) c.multiplyScalar(1 / live.length)
      c.x += (Math.random() - 0.5) * 24
      c.z += (Math.random() - 0.5) * 24
      this.spawnTornado(c, Math.random() * Math.PI * 2, null)
    }
  }

  /** The snow hole's wind swirls and gusts; a chaos gust blows on top. */
  private updateWind(dt: number) {
    this.windT += dt
    const w = this.course.wind
    const base = this.course.hole.wind
    if (base > 0) {
      const a = Math.atan2(this.baseWind.x, this.baseWind.z) + Math.sin(this.windT * 0.07) * 0.7
      const k = 0.55 + 0.45 * Math.sin(this.windT * 0.31) + (Math.sin(this.windT * 1.3) > 0.85 ? 0.45 : 0)
      w.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(base * k)
    } else w.set(0, 0, 0)
    const ch = this.chaos
    if (ch?.kind === 'gust') w.addScaledVector(this.gust, Math.max(0, Math.min(1, ch.t / 2, (CONFIG.chaos_duration - ch.t) / 1.5)))
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

  private makeLaser(at: THREE.Vector3) {
    const g = new THREE.Group()
    const mat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 300, 12, 1, true), mat('#e879f9', 0.5))
    beam.position.y = 150
    beam.name = 'beam'
    const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.laser_radius - 0.35, CONFIG.laser_radius, 48).rotateX(-Math.PI / 2), mat('#d946ef', 0.9))
    ring.position.y = 0.15
    ring.name = 'ring'
    const disc = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.laser_radius, 48).rotateX(-Math.PI / 2), mat('#c026d3', 0.18))
    disc.position.y = 0.1
    disc.name = 'disc'
    g.add(beam, ring, disc)
    g.position.copy(at)
    this.scene.add(g)
    return g
  }

  private makeMeteor(at: THREE.Vector3) {
    const g = new THREE.Group()
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CONFIG.meteor_radius - 0.3, CONFIG.meteor_radius, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f97316', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    )
    ring.position.y = 0.15
    ring.name = 'ring'
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 0), new THREE.MeshStandardMaterial({ color: '#3b2a22', emissive: '#ff5a14', emissiveIntensity: 0.9, flatShading: true }))
    rock.name = 'rock'
    rock.castShadow = true
    g.add(ring, rock)
    g.position.copy(at)
    this.scene.add(g)
    return g
  }

  private makeTornado(at: THREE.Vector3) {
    const g = new THREE.Group()
    const tex = stripeTexture()
    const layers: [number, number, number, number][] = [
      [5.5, 0.7, 16, 0.5],
      [4.2, 1.1, 13, 0.4],
      [2.6, 1.6, 7, 0.35],
    ]
    for (const [top, bottom, h, op] of layers) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(top, bottom, h, 20, 6, true),
        new THREE.MeshBasicMaterial({ color: '#cbd5e1', map: tex, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }),
      )
      m.position.y = h / 2
      g.add(m)
    }
    g.position.copy(at)
    this.scene.add(g)
    return g
  }

  private makePeel(at: THREE.Vector3) {
    const g = new THREE.Group()
    const skin = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.6, flatShading: true })
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 6), skin)
      leaf.rotation.z = Math.PI / 2 - 0.25
      leaf.position.set(0.25, 0.06, 0)
      const arm = new THREE.Group()
      arm.rotation.y = (i / 4) * Math.PI * 2 + 0.4
      arm.add(leaf)
      g.add(arm)
    }
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: '#713f12' }))
    nub.position.y = 0.08
    g.add(nub)
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    g.position.copy(at)
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
    g.peelCharges = 0
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
    // Knocked clean out of a cart seat.
    if (victim.cart) this.leaveCart(victim, true)
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
    // Desert: walk into a cactus and it pricks you.
    if (!g.cart && g.respawn <= 0 && g.protect <= 0 && g.air < 2 && this.course.hole.terrain === 'canyon') {
      for (const t of this.course.trees) {
        if (t.kind !== 'cactus') continue
        const dx = t.x - g.pos.x, dz = t.z - g.pos.z
        const r = t.r * t.scale + CONFIG.player_radius + 0.08
        if (dx * dx + dz * dz > r * r || g.vel.x * dx + g.vel.z * dz < 1.2 * Math.sqrt(dx * dx + dz * dz)) continue
        if (this.knock(g, null, 'Cactus', 0.9, 4, tmpB.set(-dx, 0, -dz), false)) this.say('OUCH! Cactus', '#a3e635', 1, g)
        break
      }
    }
    // Water or off the edge (in a cart, the cart deals with it).
    if (g.respawn <= 0 && !g.finished && !g.cart && g.inHazard(this.ground)) {
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
      if (Math.hypot(c.pos.x - g.pos.x, c.pos.z - g.pos.z) > (g.cart ? 2.6 : 1.6)) continue
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
    this.leaveCart(g, true)
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
    this.leaveCart(g, false)
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
    for (const c of this.carts) {
      if (c.sunk > 0 || c.pos.distanceTo(at) > 3) continue
      c.vy = 7
      c.grounded = false
      c.hold = 0.8
    }
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
      const down = g.stun > 0 && g.frozen <= 0 && g.spin <= 0 ? Math.min(1, (g.stunTotal - g.stun) / 0.25, g.stun / 0.35) : 0
      rig.body.rotation.x += (down * -1.35 - rig.body.rotation.x) * Math.min(1, dt * 14)
      // In a cart: sat down in the seat.
      rig.body.position.y = g.cart ? -0.42 : down * 0.25
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
      if (g.boost > 0 && Math.random() < dt * 20) this.fx_.emit(tmpA.copy(g.pos).setY(g.pos.y + 0.2), tmpB.set(0, 1, 0), 0.4, 0.4, tmpCol.setRGB(2.5, 2.2, 0.6), 0.6)
      // The ball: pink and glowing when bouncy, on fire after a Rocket Driver.
      const bm = g.ballMesh.material as THREE.MeshStandardMaterial
      const flying = g.ball.mode === 'air' || g.ball.mode === 'rolling'
      if (g.ball.bouncy) {
        bm.emissive.set('#f472b6')
        bm.emissiveIntensity = 0.9
        g.ballMesh.scale.setScalar(1.25 + Math.sin(this.time * 18) * 0.12)
      } else if (g.ballFire > 0 && flying) {
        bm.emissive.set('#ff6a1a')
        bm.emissiveIntensity = 1.4
        g.ballMesh.scale.setScalar(1.2)
      } else {
        bm.emissive.set(g.color)
        bm.emissiveIntensity = g.driverArmed || g.bouncyArmed ? 0.6 + Math.sin(this.time * 8) * 0.3 : 0.25
        g.ballMesh.scale.setScalar(1)
      }
      let trail = this.fireTrails.get(g)
      if (g.ballFire > 0 && flying) {
        if (!trail) {
          trail = new Trail('#ff7a1a', 0.45, 32, 2.6)
          this.fireTrails.set(g, trail)
          this.scene.add(trail.mesh)
        }
        trail.push(g.ball.pos)
        if (Math.random() < dt * 50) this.fx_.emit(g.ball.pos, tmpB.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), 0.5, 0.7, tmpCol.setRGB(3, 1.2, 0.25), 1, 1)
      } else if (trail) {
        trail.fadeOut(Math.max(0, 1 - dt * 4))
      }
    }
    // Carts kick up dust; the parked ones just sit there.
    for (const c of this.carts) {
      if (c.sunk > 0 || !c.grounded || c.speed < 5 || Math.random() > dt * 28) continue
      const s = this.ground.surface(c.pos.x, c.pos.z)
      const col = s === 'sand' ? tmpCol.setRGB(0.9, 0.78, 0.55) : s === 'ice' || this.course.hole.terrain === 'snow' ? tmpCol.setRGB(0.95, 0.97, 1) : this.course.hole.terrain === 'canyon' ? tmpCol.setRGB(0.82, 0.62, 0.42) : tmpCol.setRGB(0.55, 0.5, 0.38)
      const side = Math.random() < 0.5 ? -0.55 : 0.55
      tmpA.set(c.pos.x - Math.sin(c.yaw) * 1.1 + Math.cos(c.yaw) * side, c.pos.y + 0.2, c.pos.z - Math.cos(c.yaw) * 1.1 - Math.sin(c.yaw) * side)
      this.smoke.emit(tmpA, tmpB.set((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5), 1.2, 0.9, col, 0.55, 2.2)
    }
    // Orbital lasers: the beam thickens and the ring spins as the blast nears.
    for (const l of this.lasers) {
      const k = 1 - Math.max(0, l.t) / CONFIG.laser_delay
      const beam = l.mesh.getObjectByName('beam') as THREE.Mesh
      beam.scale.set(0.3 + k * 2.4, 1, 0.3 + k * 2.4)
      ;(beam.material as THREE.MeshBasicMaterial).opacity = 0.25 + k * 0.5 + Math.sin(this.time * 40) * 0.08
      const ring = l.mesh.getObjectByName('ring')!
      ring.rotation.y += dt * (2 + k * 8)
      ring.scale.setScalar(1 - k * 0.15 + Math.sin(this.time * 12) * 0.03)
      const before = Math.floor((l.t + dt) * (2 + k * 6))
      if (Math.floor(l.t * (2 + k * 6)) !== before && this.near(l.pos, 45)) this.beep(900 + k * 600, 0.06, 'square', 0.035)
    }
    // Meteors fall out of the sky towards their warning rings.
    for (const m of this.meteors) {
      const u = Math.max(0, m.t) / CONFIG.meteor_delay
      const rock = m.mesh.getObjectByName('rock')!
      rock.position.set(-30 * u, 1 + 130 * u, -22 * u)
      rock.rotation.x += dt * 4
      rock.rotation.z += dt * 3
      const ring = m.mesh.getObjectByName('ring')!
      ring.scale.setScalar(1 + Math.sin(this.time * 14) * 0.05)
      rock.getWorldPosition(tmpA)
      if (Math.random() < dt * 60) this.fx_.emit(tmpA, tmpB.set((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3), 0.6, 1.4, tmpCol.setRGB(3, 1.3, 0.3), 1, 1.5)
      if (Math.random() < dt * 20) this.smoke.emit(tmpA, tmpB.set(0, 1, 0), 2, 2, tmpCol.setRGB(0.25, 0.22, 0.2), 0.6, 2)
    }
    // Tornadoes spin and throw up debris.
    for (const t of this.tornadoes) {
      t.mesh.children.forEach((c, i) => {
        c.rotation.y += dt * (5 + i * 2.5)
        c.position.x = Math.sin(this.time * 3 + i) * 0.4
      })
      if (Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2
        tmpA.set(t.pos.x + Math.cos(a) * 2, t.pos.y + 0.3, t.pos.z + Math.sin(a) * 2)
        this.smoke.emit(tmpA, tmpB.set(-Math.sin(a) * 6, 5 + Math.random() * 5, Math.cos(a) * 6), 1.4, 1.2, tmpCol.setRGB(0.55, 0.5, 0.45), 0.6, 1.5, 0.3)
      }
    }
    for (const p of this.peels) p.mesh.rotation.y += dt * 0.5
    this.scenery.update(dt, this.time, this.me.pos, this.course.wind)
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
    // Lava churns.
    if (this.course.hole.hazard === 'lava') {
      const mat = this.water.material as THREE.MeshStandardMaterial
      if (mat.map) mat.map.offset.set(this.time * 0.004, this.time * 0.006)
      mat.emissiveIntensity = 1.1 + Math.sin(this.time * 1.3) * 0.15
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
    } else if (g.cart) {
      // Chase cam: swings round behind the cart unless you've just looked around with the mouse.
      const c = g.cart
      if (this.time - this.mouseT > 1.2 && (c.speed > 2 || this.opts.autopilot)) {
        let d = (c.forward < -0.5 ? c.yaw + Math.PI : c.yaw) - this.camYaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        this.camYaw += d * Math.min(1, dt * 2.5)
      }
      const yaw = this.camYaw
      const dist = 8.5
      pos = new THREE.Vector3(c.pos.x - Math.sin(yaw) * Math.cos(this.camPitch) * dist, c.pos.y + 2.6 + Math.sin(this.camPitch) * dist, c.pos.z - Math.cos(yaw) * Math.cos(this.camPitch) * dist)
      look = new THREE.Vector3(c.pos.x + Math.sin(yaw) * 6, c.pos.y + 1.4, c.pos.z + Math.cos(yaw) * 6)
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
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 140)
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
    const scale = g.driverArmed && !putt ? CONFIG.rocket_driver_power / 100 : 1
    const b: BallState = { pos: g.ball.pos.clone(), vel: launch(this.camYaw, power, g.loft, putt, scale), mode: (putt ? 'rolling' : 'air') as BallMode, bouncy: g.bouncyArmed }
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
        // A mine under a cart flips it.
        if (o.cart) {
          o.cart.vy = 8
          o.cart.grounded = false
          o.cart.hold = 0.8
        }
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
      case 'laser': {
        const at = P(e.p)
        this.fx_.burst(at.clone().setY(at.y + 0.5), 140, 22, 0.9, 2.2, new THREE.Color(3, 1, 3.2), 1, 0.9)
        this.fx_.burst(at.clone().setY(at.y + 6), 60, 8, 0.6, 3, new THREE.Color(2.4, 2.4, 3.2), 1, 2)
        for (let i = 0; i < 24; i++) this.smoke.emit(at, new THREE.Vector3((Math.random() - 0.5) * 12, 2 + Math.random() * 5, (Math.random() - 0.5) * 12), 2, 3, new THREE.Color(0.35, 0.25, 0.4), 0.7, 1.6)
        this.boom()
        this.beep(1800, 0.5, 'sawtooth', 0.06)
        if (this.near(at, 50)) this.shake = Math.max(this.shake, 1)
        break
      }
      case 'meteor': {
        const at = P(e.p)
        this.fx_.burst(at.clone().setY(at.y + 0.6), 120, 18, 1, 2.4, new THREE.Color(3, 1.4, 0.3), 1, 1.2)
        for (let i = 0; i < 30; i++) this.smoke.emit(at, new THREE.Vector3((Math.random() - 0.5) * 14, 2 + Math.random() * 6, (Math.random() - 0.5) * 14), 2.4, 3.2, new THREE.Color(0.3, 0.26, 0.22), 0.75, 1.8)
        this.boom()
        this.noise(1.2, 0.5, 300)
        if (this.near(at, 60)) this.shake = Math.max(this.shake, 1.2)
        break
      }
      case 'swap': {
        for (const p of [P(e.a), P(e.b)]) this.fx_.burst(p.setY(p.y + 0.4), 50, 7, 0.7, 0.8, new THREE.Color(2.2, 1, 3), 1, 1.5)
        this.beep(300, 0.3, 'sine', 0.06)
        window.setTimeout(() => this.beep(1200, 0.3, 'sine', 0.05), 120)
        break
      }
      case 'slip': {
        this.fx_.burst(P(e.p).setY(e.p[1] + 0.3), 20, 5, 0.4, 0.5, new THREE.Color(3, 2.6, 0.5), 1, 0.6)
        if (this.near(P(e.p), 50)) {
          this.audioSlide(400, 1400, 0.35)
          this.noise(0.25, 0.25, 4000)
        }
        break
      }
      case 'honk':
        if (this.near(P(e.p), 70)) {
          this.beep(392, 0.28, 'square', 0.07)
          this.beep(494, 0.28, 'square', 0.05)
        }
        break
      case 'crash': {
        const at = P(e.p)
        this.smoke.burst(at.clone().setY(at.y + 0.4), Math.round(10 + e.v * 20), 4, 1, 1.4, new THREE.Color(0.5, 0.45, 0.38), 0.6, 0.8, 1.5)
        if (this.near(at, 50)) {
          this.noise(0.25, 0.25 + e.v * 0.4, 900)
          this.shake = Math.max(this.shake, e.v * 0.5)
        }
        break
      }
      case 'ram':
        this.fx_.burst(P(e.p).setY(e.p[1] + 1), 40, 9, 0.5, 0.8, new THREE.Color(3, 2.6, 1), 1, 1)
        this.whack()
        this.beep(110, 0.25, 'square', 0.08)
        break
      case 'fire':
        this.fx_.burst(P(e.p), 60, 10, 0.6, 1.2, new THREE.Color(3, 1.3, 0.3), 1, 1.2)
        this.boom()
        break
      case 'boing':
        if (this.near(P(e.p), 60)) this.audioSlide(180, 720, 0.3)
        break
      case 'twister':
        this.smoke.burst(P(e.p).setY(e.p[1] + 1), 40, 8, 1.2, 2, new THREE.Color(0.6, 0.58, 0.55), 0.7, 1.2, 1)
        if (this.near(P(e.p), 80)) this.noise(1.6, 0.35, 500)
        break
      case 'poof':
        this.smoke.burst(P(e.p).setY(e.p[1] + 0.8), 26, 4, 0.8, 1.6, new THREE.Color(0.9, 0.9, 0.95), 0.7, 1, 1.2)
        this.fx_.burst(P(e.p).setY(e.p[1] + 0.8), 16, 5, 0.4, 0.5, new THREE.Color(2.5, 2.5, 3), 1, 1)
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
          const pad = this.remotePads.get(from) ?? { x: 0, y: 0, yaw: 0, loft: deg(28), creep: false, hb: false, acts: [] }
          const p = m.p
          pad.x = p[0]
          pad.y = p[1]
          pad.yaw = p[2]
          pad.loft = p[3]
          pad.creep = p[4] === 1
          pad.pos = [p[5], p[6], p[7], p[8]]
          pad.hb = p[9] === 1
          pad.cart = p.length >= 18 ? p.slice(10, 18) : undefined
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
      const p = [pad.x, pad.y, pad.yaw, pad.loft, pad.creep ? 1 : 0, me.pos.x, me.pos.y, me.pos.z, me.yaw, pad.hb ? 1 : 0]
      // Driving: where this screen has the cart (the host trusts it, like your golfer).
      const c = me.cart
      if (c && c.driver === me) p.push(c.pos.x, c.pos.y, c.pos.z, c.yaw, c.vel.x, c.vel.z, c.vy, c.grounded ? 1 : 0)
      net.link.send({ t: 'g-in', p, a: this.pendingActs })
      this.pendingActs = []
    }
    const S = this.snap
    if (!S) return
    const s = S.s
    const age = Math.min(0.25, (performance.now() - S.at) / 1000)
    this.phase = s.ph
    this.phaseTime = s.pt + age
    const playing = this.phase === 'play' || this.phase === 'overtime'
    // Conditions: wind, gravity and the chaos event.
    if (s.w) {
      this.course.wind.set(s.w[0], 0, s.w[1])
      this.course.gravity = s.w[2]
      this.chaos = s.w[3] >= 0 ? { kind: CHAOS_EVENTS[s.w[3]], t: s.w[4] - age } : null
    }
    this.syncCarts(s.k ?? [], age, dt, pad, playing)
    s.g.forEach((row, i) => {
      const g = this.golfers[i]
      if (!g) return
      g.spin = row[35] ?? 0
      g.driverArmed = ((row[36] ?? 0) & 1) > 0
      g.bouncyArmed = ((row[36] ?? 0) & 2) > 0
      g.ball.bouncy = ((row[36] ?? 0) & 4) > 0
      g.ballFire = row[37] ?? 0
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
      const hostDrives = row[6] > 0 || row[11] > 0 || row[12] > 0 || row[14] === 1 || row[28] > 0 || row[29] > 0 || row[33] > 1 || (row[35] ?? 0) > 0
      if (g.cart) {
        // Riding: sat in the seat of the cart (synced above).
        g.cart.seatPos(g.seat, g.pos)
        g.yaw = g.cart.yaw
        g.vel.set(0, 0, 0)
        if (g === me) g.aim = pad.yaw
      } else if (g === me && !hostDrives && playing && g.pos.distanceTo(target) < 8) {
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
    this.syncLasers(s.l ?? [], age)
    this.syncMeteors(s.x ?? [], age)
    this.syncTornadoes(s.t ?? [], dt)
    this.syncPeels(s.b ?? [])
    this.updateCases(dt, false)
  }

  /** Online client: the host's carts, with the one you drive predicted on this screen. */
  private syncCarts(rows: number[][], age: number, dt: number, pad: Pad, playing: boolean) {
    const me = this.me
    const seen = new Set<number>()
    for (const g of this.golfers) g.cart = null
    for (const row of rows) {
      const [id, x, y, z, yaw, vx, vz, vy, grounded, driverId, passId, sunk, spin, hold, ownerId] = row
      seen.add(id)
      let c = this.cartById(id)
      if (!c) {
        const owner = this.golfers[ownerId] ?? null
        c = new Cart(id, this.opts.assets, null, owner, owner?.color)
        c.reset(new THREE.Vector3(x, y, z), yaw)
        this.scene.add(c.mesh)
        this.carts.push(c)
      }
      c.driver = this.golfers[driverId] ?? null
      c.passenger = this.golfers[passId] ?? null
      if (c.driver) {
        c.driver.cart = c
        c.driver.seat = 0
      }
      if (c.passenger) {
        c.passenger.cart = c
        c.passenger.seat = 1
      }
      c.sunk = sunk
      c.hold = hold
      tmpA.set(x + vx * age, y + vy * age, z + vz * age)
      const mine = c.driver === me && playing && sunk <= 0 && hold <= 0 && spin <= 0
      if (mine && c.pos.distanceTo(tmpA) < 8) {
        // Drive it here at once; the host trusts this screen's cart.
        c.control = { x: pad.x, y: pad.y, yaw: pad.yaw, jump: false, dive: false, creep: false, brake: pad.hb }
        c.step(dt, this.ground, this.course)
        continue
      }
      c.control = null
      c.spin = spin
      c.grounded = grounded === 1
      c.vy = vy
      c.vel.set(vx, 0, vz)
      if (c.pos.distanceTo(tmpA) > 8 || sunk > 0) c.pos.copy(tmpA)
      else c.pos.lerp(tmpA, Math.min(1, dt * 14))
      let d = yaw - c.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      c.yaw += d * Math.min(1, dt * 14)
      c.updateMesh(dt, this.ground)
    }
    for (const c of this.carts) if (!seen.has(c.id)) this.scene.remove(c.mesh)
    this.carts = this.carts.filter((c) => seen.has(c.id))
  }

  private syncLasers(rows: number[][], age: number) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      let l = this.lasers.find((x) => x.id === row[0])
      const p = tmpA.set(row[1], row[2], row[3])
      if (!l) {
        l = { id: row[0], owner: null, target: null, pos: p.clone(), t: row[4], mesh: this.makeLaser(p) }
        this.lasers.push(l)
      }
      l.pos.lerp(p, 0.3)
      l.t = row[4] - age
      l.mesh.position.copy(l.pos)
    }
    for (const l of this.lasers) if (!seen.has(l.id)) this.scene.remove(l.mesh)
    this.lasers = this.lasers.filter((l) => seen.has(l.id))
  }

  private syncMeteors(rows: number[][], age: number) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      let m = this.meteors.find((x) => x.id === row[0])
      if (!m) {
        const p = new THREE.Vector3(row[1], row[2], row[3])
        m = { id: row[0], owner: null, pos: p, t: row[4], mesh: this.makeMeteor(p) }
        this.meteors.push(m)
      }
      m.t = row[4] - age
    }
    for (const m of this.meteors) if (!seen.has(m.id)) this.scene.remove(m.mesh)
    this.meteors = this.meteors.filter((m) => seen.has(m.id))
  }

  private syncTornadoes(rows: number[][], dt: number) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      let t = this.tornadoes.find((x) => x.id === row[0])
      const p = tmpA.set(row[1], row[2], row[3])
      if (!t) {
        t = { id: row[0], owner: null, pos: p.clone(), heading: 0, turnT: 0, life: row[4], mesh: this.makeTornado(p), caught: new Map() }
        this.tornadoes.push(t)
      }
      t.pos.lerp(p, Math.min(1, dt * 10))
      t.life = row[4]
      t.mesh.position.copy(t.pos)
    }
    for (const t of this.tornadoes) if (!seen.has(t.id)) this.scene.remove(t.mesh)
    this.tornadoes = this.tornadoes.filter((t) => seen.has(t.id))
  }

  private syncPeels(rows: number[][]) {
    const seen = new Set<number>()
    for (const row of rows) {
      seen.add(row[0])
      if (this.peels.some((x) => x.id === row[0])) continue
      const p = new THREE.Vector3(row[1], row[2], row[3])
      this.peels.push({ id: row[0], owner: null, pos: p, life: 1, grace: 0, mesh: this.makePeel(p) })
    }
    for (const p of this.peels) if (!seen.has(p.id)) this.scene.remove(p.mesh)
    this.peels = this.peels.filter((p) => seen.has(p.id))
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
          r2(g.kb.length()), g.human ? 1 : 0, r2(g.spin), (g.driverArmed ? 1 : 0) | (g.bouncyArmed ? 2 : 0) | (b.bouncy ? 4 : 0), r2(g.ballFire),
        ]
      }),
      r: this.rockets.map((r) => [r.id, r2(r.pos.x), r2(r.pos.y), r2(r.pos.z), r2(r.vel.x), r2(r.vel.y), r2(r.vel.z), r.target ? r.target.id : -1]),
      c: this.cases.map((c) => [c.id, c.ready ? 1 : 0, c.item ? ITEM_CODES.indexOf(c.item) : -1, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)]),
      m: this.mines.map((m) => [m.id, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), m.arm <= 0 ? 1 : 0]),
      k: this.carts.map((c) => [
        c.id, r2(c.pos.x), r2(c.pos.y), r2(c.pos.z), r2(c.yaw), r2(c.vel.x), r2(c.vel.z), r2(c.vy), c.grounded ? 1 : 0,
        c.driver ? c.driver.id : -1, c.passenger ? c.passenger.id : -1, r2(c.sunk), r2(c.spin), r2(c.hold), c.owner ? c.owner.id : -1,
      ]),
      l: this.lasers.map((l) => [l.id, r2(l.pos.x), r2(l.pos.y), r2(l.pos.z), r2(l.t)]),
      x: this.meteors.map((m) => [m.id, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.t)]),
      t: this.tornadoes.map((t) => [t.id, r2(t.pos.x), r2(t.pos.y), r2(t.pos.z), r2(t.life)]),
      b: this.peels.map((p) => [p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)]),
      w: [r2(this.course.wind.x), r2(this.course.wind.z), r2(this.course.gravity), this.chaos ? CHAOS_EVENTS.indexOf(this.chaos.kind) : -1, this.chaos ? r2(this.chaos.t) : 0],
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

  /** An on-screen arrow clamped to the viewport edge, pointing toward an off-screen world point. */
  private edgePointer(p: THREE.Vector3) {
    const w = this.container.clientWidth, h = this.container.clientHeight
    const v = p.clone().project(this.camera)
    // Behind the camera: flip so the arrow points the right way.
    let nx = v.x, ny = v.y
    if (v.z > 1) {
      nx = -nx
      ny = -ny
    }
    // Direction from screen centre, in CSS pixels (y is flipped from NDC).
    const dx = nx,
      dz = -ny
    const ang = Math.atan2(dz, dx)
    const margin = 46
    const hw = w / 2 - margin,
      hh = h / 2 - margin
    // Clamp the ray to the edge rectangle.
    const scale = Math.min(hw / (Math.abs(Math.cos(ang)) || 1e-3), hh / (Math.abs(Math.sin(ang)) || 1e-3))
    return { x: w / 2 + Math.cos(ang) * scale, y: h / 2 + Math.sin(ang) * scale, angle: ang }
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
      const me = o === g
      const s = this.project(o.ball.pos.clone().setY(o.ball.pos.y + 2.6))
      const dist = Math.round(o.ball.pos.distanceTo(this.course.cup))
      const w = this.container.clientWidth, h = this.container.clientHeight
      const onScreen = s && s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h
      if (onScreen) {
        markers.push({ id: o.id, x: s.x, y: s.y, color: o.color, dist, me, edge: false, angle: 0 })
      } else if (me) {
        // Your own ball is off-screen: clamp a pointer to the screen edge aimed at the ball.
        const toward = this.edgePointer(o.ball.pos)
        markers.push({ id: o.id, x: toward.x, y: toward.y, color: o.color, dist, me, edge: true, angle: toward.angle })
      }
    }
    const popups: Hud['popups'] = []
    for (const p of this.popups) {
      const s = this.project(p.pos)
      if (s) popups.push({ id: p.id, text: p.text, color: p.color, x: s.x, y: s.y - p.age * 40, age: p.age })
    }
    const timeLeft = this.phase === 'overtime' ? CONFIG.overtime - this.phaseTime : this.phase === 'play' ? this.holeTime - this.phaseTime : this.holeTime
    const canSwing = this.canSwing(g)
    // A cart in reach (or the one you're in).
    let prompt: string | null = null
    if (g.cart) prompt = g.cart.driver === g ? 'E · Get out · H · Horn' : 'E · Get out'
    else if (!g.finished && g.respawn <= 0 && g.charging <= 0) {
      const c = this.cartNear(g.pos, CONFIG.cart_enter_range)
      if (c) prompt = c.driver ? `E · Ride with ${c.driver.name}` : 'E · Drive the golf cart'
    }
    const w = this.course.wind
    const ws = Math.hypot(w.x, w.z)
    const armed: string[] = []
    if (g.driverArmed) armed.push('Rocket Driver armed')
    if (g.bouncyArmed) armed.push('Bouncy Ball armed')
    if (g.ball.bouncy) armed.push('Bouncy!')
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
        : g.cart
          ? g.cart.driver === g
            ? 'W/S drive · A/D steer · Space handbrake · run them over!'
            : 'Riding along · right click to use an item'
          : canSwing
            ? this.isPutt(g)
              ? 'Hold left click to putt · release to hit'
              : 'Hold left click to charge · scroll for loft · release to swing'
            : 'Run to your ball · left click near a rival to swing your club',
      locked: this.locked || !!this.opts.autopilot,
      prompt,
      driving: !!g.cart && g.cart.driver === g,
      cartSpeed: g.cart ? Math.round(g.cart.speed * 3.6) : 0,
      // The arrow is relative to where the camera looks (0 = blowing straight ahead).
      wind: ws > 0.3 ? { angle: Math.atan2(w.x, w.z) - this.camYaw, speed: Math.round(ws) } : null,
      chaos: this.chaos ? { name: CHAOS_NAMES[this.chaos.kind][0], color: CHAOS_NAMES[this.chaos.kind][1], t: Math.max(0, this.chaos.t) } : null,
      armed,
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
    if (this.course.hole.hazard === 'lava') {
      // A sizzle and a puff of fire instead.
      this.fx_.burst(at.clone().setY(0.4), 50, 7, 0.9, 1, new THREE.Color(3, 1.2, 0.2), 1, 2)
      for (let i = 0; i < 8; i++) this.smoke.emit(at.clone().setY(0.5), new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2), 2, 1.6, new THREE.Color(0.2, 0.18, 0.18), 0.6, 1.5)
      if (this.near(at, 60)) this.noise(0.7, 0.3, 2500)
      return
    }
    this.fx_.burst(at.clone().setY(0.3), 40, 6, 0.8, 0.8, new THREE.Color(1.6, 2.2, 2.6), 0.9, 2)
    if (this.near(at, 60)) this.noise(0.4, 0.3, 1200)
  }

  /** A pitch sweep (banana slip, bouncy boing). */
  private audioSlide(from: number, to: number, dur: number) {
    const a = this.audio
    if (!a || isMuted()) return
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(from, a.currentTime)
    o.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur)
    g.gain.setValueAtTime(0.07, a.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur)
    o.connect(g).connect(a.destination)
    o.start()
    o.stop(a.currentTime + dur + 0.02)
  }

  private cupDrop() {
    this.beep(523, 0.12, 'triangle', 0.1)
    window.setTimeout(() => this.beep(784, 0.25, 'triangle', 0.1), 110)
  }
}

/* ---------- Helpers ---------- */

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpCol = new THREE.Color()

let stripes: THREE.CanvasTexture | null = null
/** Diagonal streaks for the tornado funnel (so you can see it spin). */
function stripeTexture() {
  if (stripes) return stripes
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, 128, 128)
  for (let i = -128; i < 256; i += 18) {
    g.strokeStyle = `rgba(255,255,255,${0.35 + ((i / 18) % 3) * 0.2})`
    g.lineWidth = 6 + ((i / 18) % 2) * 5
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 70, 128)
    g.stroke()
  }
  stripes = new THREE.CanvasTexture(c)
  stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping
  stripes.repeat.set(3, 1)
  return stripes
}

/** A night sky: a vertical gradient as the background. */
function gradientTexture(top: string, bottom: string) {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 0, 256)
  grd.addColorStop(0, top)
  grd.addColorStop(1, bottom)
  g.fillStyle = grd
  g.fillRect(0, 0, 4, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Stars on a dome far away (seeded, so every screen has the same sky). */
function starField() {
  let seed = 5
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const n = 700
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, h = 0.08 + rnd() * 0.92
    const r = Math.sqrt(1 - h * h)
    pos.set([Math.cos(a) * r * 1500, h * 1500, Math.sin(a) * r * 1500], i * 3)
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }))
  pts.frustumCulled = false
  return pts
}

let lavaTex: THREE.CanvasTexture | null = null
/** Glowing lava blobs on dark crust. */
function lavaTexture() {
  if (lavaTex) return lavaTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#5a1606'
  g.fillRect(0, 0, 128, 128)
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 46; i++) {
    const x = rnd() * 128, y = rnd() * 128, r = 6 + rnd() * 18
    for (const [dx, dy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      grd.addColorStop(0, rnd() < 0.5 ? '#ffd27a' : '#ff9a2e')
      grd.addColorStop(0.5, '#ff5a14')
      grd.addColorStop(1, 'rgba(90,22,6,0)')
      g.fillStyle = grd
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
    }
  }
  lavaTex = new THREE.CanvasTexture(c)
  lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping
  lavaTex.colorSpace = THREE.SRGBColorSpace
  return lavaTex
}

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
