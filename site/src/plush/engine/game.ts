// PLUSH PANIC engine. One Game per visit to the stage: it owns the renderer, input, audio, camera and the
// roster, and runs rounds (the Loft hub, Quick Play levels and Show rounds). Solo and host browsers simulate;
// online clients draw the host's snapshots and predict their own toy. Levels plug in through types.ts.
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { TOY_KINDS, type PlushAssets, type ToyKind } from './assets'
import { PlushAudio } from './audio'
import { CamRig } from './camera'
import { CONFETTI, Particles, PUFF_COLORS } from './fx'
import { Hazards } from './hazards'
import { spawnGrid, spawnRing } from './helpers'
import { LocalInput, type InputFrame } from './input'
import { isPlushMsg, type Look, type NetSession, type PlushMsg, type RosterRow, type RoundSetup } from './net'
import { loadPhysics, Phys, RAPIER, STEP, type RigidBody } from './physics'
import { ANIMS, EMOTES, ToyRig, type AnimKey, type EmoteKey, type RigState } from './rig'
import { makeRng, type Rng } from './rng'
import { Sabotage, THROW_INFO, trickPrice } from './sabotage'
import { awardsFor, botName, planShow, roundTarget, TINTS, type Profile, type RoundPlan, type ShowResults, type ShowSettings } from './show'
import { BALL_DROP, clearOneShots, emptyPad, FOOT, Toy, type BodyMode, type Pad, type ToyEvents } from './toy'
import {
  freshStats, THROW_KINDS, type AnyLevel, type Contestant, type FxApi, type LevelCtx, type LevelHud, type PlayMode, type Spawn, type Spice, type ThrowKind,
  type TrickDef, type TrickIcon,
} from './types'
import { LEVELS, levelById } from '../levels'
import { cleanOutfit, outfitKey, randomOutfit } from '../wardrobe/catalog'
import { dressRig } from '../wardrobe/dress'

export type StagePhase = 'loft' | 'intro' | 'countdown' | 'play' | 'end' | 'results'
const PHASES: StagePhase[] = ['loft', 'intro', 'countdown', 'play', 'end', 'results']
const INTRO = 4.5
const COUNTDOWN = 3
const END = 4.2
const SNAP_HZ = 20
const INPUT_HZ = 30
/** Failed toys poof away after this long (unless the level keeps them, like Cookie Cutter's slumped losers). */
const GONE_AFTER = 1.6

export interface GameOptions {
  assets: PlushAssets
  profile: Profile
  net?: NetSession
  /** Test mode: no animation loop; advance with simulate(). */
  snap?: boolean
  quality?: 'low' | 'high'
}

export interface TrickHud {
  id: string
  name: string
  icon: TrickIcon
  cost: number
  price: number
  revenge: boolean
  cd: number
  cooldown: number
  ready: boolean
  reason: string
  desc: string
  counter: string
  key: number
}

export interface Hud {
  phase: StagePhase
  phaseLeft: number
  mode: PlayMode
  role: 'solo' | 'host' | 'client'
  level: { id: string; name: string; type: string; blurb: string; howTo: string[]; accent: string; tricks: { name: string; cost: number; desc: string; counter: string; icon: TrickIcon }[]; resource: string } | null
  round: { index: number; total: number; final: boolean }
  target: number
  qualified: number
  active: number
  field: number
  timeLeft: number
  countdown: number
  me: { status: 'play' | 'qualified' | 'failed' | 'gallery' | 'none'; sprinkles: number; busy: number; grudge: string | null; bubble: boolean; name: string; tint: string }
  spectating: string | null
  tricks: TrickHud[]
  ammo: { kind: ThrowKind; name: string; n: number; ready: boolean; desc: string }[]
  aim: { name: string; grudge: boolean } | null
  levelHud: LevelHud | null
  feed: { id: number; text: string }[]
  banner: { id: number; text: string; color: string } | null
  roundEnd: { through: string[]; out: string[] } | null
  results: ShowResults | null
  roster: { idx: number; name: string; tint: string; kind: string; human: boolean; me: boolean; out: boolean }[]
  online: { code: string; role: 'host' | 'client'; people: number } | null
  pointer: 'look' | 'free'
  locked: boolean
  touch: boolean
  zone: string | null
  quality: 'low' | 'high'
}

interface Round {
  setup: RoundSetup
  level: AnyLevel
  state: unknown
  ctx: Ctx
  phys: Phys
  root: THREE.Group
  hazards: Hazards
  toys: Toy[]
  rigs: ToyRig[]
  props: { body: RigidBody; obj: THREE.Object3D }[]
  grabbables: RigidBody[]
  sab: Sabotage
  rng: Rng
  ended: boolean
  outOrder: number[]
  tags: { el: HTMLDivElement; name: HTMLSpanElement; mark: HTMLSpanElement }[]
}

/** One effect event (host → clients). `to` = contestant index for screen-only effects. */
type NetEv = { k: string; to?: number; [key: string]: unknown }

interface RemoteIn {
  pad: Pad
  pos: [number, number, number, number] | null
  acts: string[]
  /** performance.now() of the last input: a silent player (hidden tab, dropped link) is driven by a bot. */
  last: number
}

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _ray = new THREE.Raycaster()
const _plane = new THREE.Plane()
const _ndc = new THREE.Vector2()
const _col = new THREE.Color()

function detectQuality(): 'low' | 'high' {
  try {
    const q = new URLSearchParams(window.location.search).get('quality')
    if (q === 'low' || q === 'high') return q
    const small = window.innerWidth < 820 || matchMedia('(pointer: coarse)').matches
    const cores = navigator.hardwareConcurrency ?? 4
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const r = (info && gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) as string | undefined
    const weak = !!r && /(Intel.*(HD|UHD) Graphics|Microsoft Basic Render|SwiftShader|llvmpipe|Software)/i.test(r)
    return small || cores <= 4 || mem <= 4 || weak ? 'low' : 'high'
  } catch {
    return 'low'
  }
}

/** Everything a level sees. Thin: it forwards to the game and the current round. */
class Ctx implements LevelCtx {
  readonly THREE = THREE
  readonly RAPIER = RAPIER
  private g: Game
  private r: Round
  rng: Rng
  constructor(g: Game, r: Round, rng: Rng) {
    this.g = g
    this.r = r
    this.rng = rng
  }
  get root() {
    return this.r.root
  }
  get scene() {
    return this.g.scene
  }
  get phys() {
    return this.r.phys
  }
  get assets() {
    return this.g.opts.assets
  }
  get seed() {
    return this.r.setup.seed
  }
  get mode() {
    return this.r.setup.mode
  }
  get role() {
    return this.g.role
  }
  get isHost() {
    return this.g.role !== 'client'
  }
  get difficulty() {
    return this.r.setup.settings.difficulty
  }
  get spice() {
    return this.r.setup.settings.spice as Spice
  }
  get quality() {
    return this.g.quality
  }
  get toys() {
    return this.r.toys
  }
  get me() {
    return this.r.toys.find((t) => t.c.idx === this.g.meIdx) ?? null
  }
  get target() {
    return this.r.setup.target
  }
  get round() {
    return { index: this.r.setup.index, total: this.r.setup.total, final: this.r.setup.final }
  }
  get time() {
    return this.g.clock
  }
  get timeLeft() {
    return Math.max(0, this.r.level.duration - Math.max(0, this.g.clock))
  }
  get phase(): 'intro' | 'countdown' | 'play' | 'end' {
    const p = this.g.phase
    return p === 'loft' ? 'play' : p === 'results' ? 'end' : p
  }
  get fx() {
    return this.g.fxApi
  }
  get fxLocal() {
    return this.g.fxLocal
  }
  get pointer() {
    return this.g.pointer
  }
  get hazards() {
    return this.r.hazards
  }
  get cam() {
    return this.g.cam
  }
  get music() {
    return this.g.audio.music
  }
  get sound() {
    return this.g.audio
  }

  qualify(toy: Toy, note = '') {
    if (toy.status !== 'play' || !this.isHost) return
    toy.status = 'qualified'
    toy.doneAt = this.g.clock
    toy.doneNote = note
    this.fx.confetti(toy.pos)
    this.fx.sfx('cheer', toy.pos)
    this.fx.say(this.mode === 'quick' ? 'FINISHED!' : this.r.setup.final ? 'YOU WIN!' : 'QUALIFIED!', '#86efac', 2, toy)
    this.fx.feed(`${toy.name} ${this.r.setup.final && this.mode === 'show' ? 'wins the crown!' : 'is through'}${note ? ` (${note})` : ''}`)
  }

  fail(toy: Toy, reason: string) {
    if (toy.status !== 'play' || !this.isHost) return
    if (this.mode !== 'show') {
      this.fx.popup(toy, reason, '#fca5a5')
      if (this.r.level.retry) this.r.level.retry(this, this.r.state, toy, reason)
      else this.respawn(toy, undefined, 1)
      return
    }
    toy.status = 'failed'
    toy.doneAt = this.g.clock
    toy.doneNote = reason
    toy.release(false)
    if (toy.grabbedBy) toy.grabbedBy.release(false)
    this.r.outOrder.push(toy.c.idx)
    this.r.sab.joinGallery(toy.c)
    this.fx.puff(toy.pos, 'stuff', 18)
    this.fx.sfx('out', toy.pos)
    this.fx.popup(toy, 'OUT', '#f87171')
    this.fx.say('ELIMINATED', '#f87171', 2.2, toy)
    this.fx.feed(`${toy.name} is out: ${reason}`)
  }

  end() {
    this.r.ended = true
  }

  active() {
    return this.r.toys.filter((t) => t.status === 'play')
  }

  qualifiedCount() {
    let n = 0
    for (const t of this.r.toys) if (t.status === 'qualified') n++
    return n
  }

  addSprinkles(toy: Toy, n: number, why?: string) {
    toy.sprinkles = Math.max(0, Math.min(99, toy.sprinkles + n))
    if (n > 0) this.g.emitFx({ k: 'pu', i: toy.idx, t: `+${n} ✦${why ? ' ' + why : ''}`, c: '#fde68a', to: toy.c.idx })
  }

  knock(toy: Toy, impulse: THREE.Vector3Like, stun: number, by?: Toy | null) {
    toy.knock(impulse.x, impulse.y, impulse.z, stun)
    if (by && by !== toy) toy.grudge = by
    const pow = Math.hypot(impulse.x, impulse.z)
    if (pow > 4) {
      this.fx.puff(toy.pos, 'stuff', 6)
      this.fx.sfx('squeak', toy.pos)
    }
  }

  respawn(toy: Toy, at?: Spawn, stun = 0.6) {
    const s = at ?? toy.spawn
    const lift = toy.mode === 'ball' ? BALL_DROP : 0
    toy.release(false)
    toy.teleport(s.x, s.y + FOOT + lift + 0.05, s.z, s.yaw)
    toy.stun = Math.max(toy.stun, stun)
    toy.forced = Math.max(toy.forced, 0.6)
    this.fx.puff({ x: s.x, y: s.y + 0.3, z: s.z }, 'dust', 10)
  }

  setBodyMode(toy: Toy, mode: BodyMode) {
    toy.setMode(this.r.phys, mode)
    if (this.g.role === 'client' && !toy.isMe) toy.setPuppet(true)
  }

  blame(victim: Toy, by: Toy) {
    if (victim !== by) victim.grudge = by
  }

  emit(data: unknown, to?: Toy) {
    if (!this.isHost) {
      this.r.level.onEvent?.(this, this.r.state, data)
      return
    }
    this.g.emitFx({ k: 'lv', d: data, to: to ? to.c.idx : undefined })
  }

  syncProp(body: RigidBody, obj: THREE.Object3D) {
    this.r.props.push({ body, obj })
    if (this.g.role === 'client') body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
  }

  grabbable(body: RigidBody, obj: THREE.Object3D) {
    this.syncProp(body, obj)
    this.r.grabbables.push(body)
  }

  signal(name: string, toy: Toy | null) {
    this.g.handleSignal(name, toy)
  }

  spawnGrid(n: number, opts: { x: number; z: number; y?: number; yaw: number; spacing?: number; cols?: number }) {
    return spawnGrid(n, opts)
  }

  spawnRing(n: number, opts: { x: number; z: number; y?: number; radius: number; faceIn?: boolean }) {
    return spawnRing(n, opts)
  }

  nearest(pos: THREE.Vector3Like, filter?: (t: Toy) => boolean) {
    let best: Toy | null = null
    let bd = Infinity
    for (const t of this.r.toys) {
      if (filter ? !filter(t) : t.status !== 'play') continue
      const d = (t.pos.x - pos.x) ** 2 + (t.pos.z - pos.z) ** 2
      if (d < bd) {
        bd = d
        best = t
      }
    }
    return best
  }

  leader(except?: Toy) {
    const ranked = this.r.level.rank ? this.r.level.rank(this, this.r.state) : this.active()
    for (const t of ranked) if (t !== except && t.status === 'play') return t
    return null
  }
}

export class Game {
  readonly opts: GameOptions
  readonly role: 'solo' | 'host' | 'client'
  readonly scene = new THREE.Scene()
  readonly cam = new CamRig()
  readonly renderer: THREE.WebGLRenderer
  readonly audio = new PlushAudio()
  readonly input: LocalInput
  quality: 'low' | 'high'
  roster: Contestant[] = []
  meIdx = 0
  settings: ShowSettings
  round: Round | null = null
  phase: StagePhase = 'loft'
  phaseT = 0
  /** Round clock: negative during the countdown, seconds of play after. */
  clock = 0
  results: ShowResults | null = null
  autopilot = false
  onHud: ((h: Hud) => void) | null = null
  /** The page hears about hub signals (e.g. 'sewing' when you walk up to the sewing table). */
  onSignal: ((name: string, contestant: number) => void) | null = null
  onDisconnect: ((why: string) => void) | null = null
  /** The local player's look (name, toy, tint). */
  look: Look
  readonly fxApi: FxApi
  readonly fxLocal: FxApi
  /** This screen's free pointer (see LevelCtx.pointer). */
  get pointer() {
    const p = this.ptr
    p.x = this.myPad.px
    p.z = this.myPad.pz
    p.down = this.myPad.down
    return p
  }
  private ptr = { x: 0, z: 0, down: false }
  /** Toy event handlers per round (built once, not per step). */
  private evCache: { r: Round; ev: ToyEvents; quiet: ToyEvents } | null = null
  private events(r: Round) {
    if (this.evCache?.r !== r) {
      const ev = this.toyEvents(r)
      const quiet: ToyEvents = { ...ev, onHit: () => {}, onJump: (t) => this.audio.play('boop', t.pos), onDive: (t) => this.audio.play('whoosh', t.pos), onGrab: () => {}, onWriggle: () => {} }
      this.evCache = { r, ev, quiet }
    }
    return this.evCache
  }
  private rigState: RigState = { anim: 'idle', speed: 0, vy: 0, grounded: true, ball: false, ballVel: new THREE.Vector3(), ballScale: 1, stun: 0 }
  private localFlags = { jump: false, dive: false, shove: false, act: false, emote: '' as Pad['emote'] }

  private container: HTMLElement
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private puffs: Particles
  private confetti: Particles
  private raf = 0
  private last = 0
  private acc = 0
  private disposed = false
  private ro: ResizeObserver
  private tagLayer: HTMLDivElement
  private popLayer: HTMLDivElement
  private plan: RoundPlan[] | null = null
  private planIdx = 0
  private planMode: PlayMode = 'show'
  private myPad: Pad = emptyPad()
  private myActs: string[] = []
  private virt = { x: 0, z: 0, set: false }
  private pinned = -1
  private hover = -1
  private spec = -1
  private hitStop = 0
  private feedList: { id: number; text: string; age: number }[] = []
  private banner: { id: number; text: string; color: string; t: number } | null = null
  private nextId = 1
  private hudT = 0
  private lastHudPhase: StagePhase | null = null
  private zone: string | null = null
  private flying: { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; t: number; dur: number }[] = []
  private flyPool: THREE.Mesh[] = []
  private perf = { t: 0, frames: 0, slow: 0, step: 0 }
  // Online.
  private remote = new Map<string, RemoteIn>()
  private outEvents: NetEv[] = []
  private snapT = 0
  private inputT = 0
  private pending: string[] = []
  private snap: { s: Snap; at: number } | null = null
  private unsub: (() => void)[] = []
  private padFlags = { jump: false, dive: false, shove: false, act: false, emote: '' as Pad['emote'] }
  private shadowsOn: boolean

  constructor(container: HTMLElement, opts: GameOptions) {
    this.container = container
    this.opts = opts
    this.role = opts.net ? opts.net.role : 'solo'
    this.quality = opts.quality ?? detectQuality()
    this.settings = { ...opts.profile.settings }
    this.look = { name: opts.profile.name, kind: opts.profile.kind, tint: opts.profile.tint, outfit: opts.profile.outfit }

    const high = this.quality === 'high'
    this.renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.5 : 1))
    this.shadowsOn = high
    this.renderer.shadowMap.enabled = high
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'pp-canvas'
    container.appendChild(this.renderer.domElement)

    this.tagLayer = document.createElement('div')
    this.tagLayer.className = 'pp-tags'
    container.appendChild(this.tagLayer)
    this.popLayer = document.createElement('div')
    this.popLayer.className = 'pp-pops'
    container.appendChild(this.popLayer)

    // Warm attic light: a low golden sky baked into the environment, a key light from the window, warm fill.
    this.bakeEnvironment()
    this.hemi = new THREE.HemisphereLight('#ffe7c4', '#5a3a24', 0.6)
    this.sun = new THREE.DirectionalLight('#ffd49a', 1.7)
    this.sun.castShadow = high
    this.sun.shadow.mapSize.set(1024, 1024)
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -13
    sc.right = sc.top = 13
    sc.near = 1
    sc.far = 70
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.hemi, this.sun, this.sun.target)
    this.scene.background = new THREE.Color('#2e1d12')
    this.scene.fog = new THREE.Fog('#3b2516', 45, 140)

    this.puffs = new Particles(high ? 900 : 450)
    this.confetti = new Particles(high ? 700 : 300, { square: true, gravity: -4.5 })
    this.scene.add(this.puffs.points, this.confetti.points)
    this.scene.add(this.cam.camera)

    this.input = new LocalInput(this.renderer.domElement)
    this.input.onGesture = () => this.audio.ensure()

    const makeFx = (out: (e: NetEv) => void): FxApi => ({
      puff: (p, kind = 'dust', n = 10) => out({ k: 'p', x: r2(p.x), y: r2(p.y), z: r2(p.z), c: kind, n }),
      confetti: (p) => out({ k: 'c', x: r2(p.x), y: r2(p.y), z: r2(p.z) }),
      shake: (a, toy) => out({ k: 'sh', a, to: toy ? toy.c.idx : undefined }),
      sfx: (n, p, toy) => out({ k: 's', n, x: p ? r2(p.x) : undefined, y: p ? r2(p.y) : undefined, z: p ? r2(p.z) : undefined, to: toy ? toy.c.idx : undefined }),
      say: (t, c = '#fde68a', d = 2, toy) => out({ k: 'say', t, c, d, to: toy ? toy.c.idx : undefined }),
      feed: (t) => out({ k: 'f', t }),
      popup: (toy, t, c = '#ffffff') => out({ k: 'pu', i: toy.idx, t, c }),
      hitStop: (d = 0.08) => out({ k: 'hs', d }),
    })
    this.fxApi = makeFx((e) => this.emitFx(e))
    this.fxLocal = makeFx((e) => {
      if (e.to === undefined || e.to === this.meIdx) this.playFx(e)
    })

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    if (opts.net) this.listen(opts.net)
  }

  /* ================= Lifecycle ================= */

  /** Load physics, then enter the Loft (solo/host) or wait for the host's round (client). */
  async init() {
    await loadPhysics()
    if (this.disposed) return
    this.ready = true
    if (this.role !== 'client') {
      this.buildRoster('hub')
      this.startHub()
    } else if (this.pendingRound) {
      const m = this.pendingRound
      this.pendingRound = null
      this.clientMsg(m)
    }
  }
  private ready = false
  private pendingRound: PlushMsg | null = null

  start() {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - this.last) / 1000)
      this.last = now
      this.frame(dt, true)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const u of this.unsub) u()
    this.ro.disconnect()
    this.input.dispose()
    this.audio.dispose()
    this.teardownRound()
    this.puffs.dispose()
    this.confetti.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.tagLayer.remove()
    this.popLayer.remove()
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.cam.resize(w, h)
  }

  private bakeEnvironment() {
    const pm = new THREE.PMREMGenerator(this.renderer)
    const s = new THREE.Scene()
    const sky = new Sky()
    sky.scale.setScalar(1000)
    const u = sky.material.uniforms
    u.turbidity.value = 7
    u.rayleigh.value = 2.4
    u.mieCoefficient.value = 0.006
    u.mieDirectionalG.value = 0.86
    // A low golden-hour sun: the warm light of an attic window late in the afternoon.
    u.sunPosition.value.set(400, 120, 600)
    s.add(sky)
    // Warm wood all round the horizon so reflections read as "indoors".
    const room = new THREE.Mesh(new THREE.SphereGeometry(400, 16, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), new THREE.MeshBasicMaterial({ color: '#6b4428', side: THREE.BackSide }))
    s.add(room)
    const env = pm.fromScene(s, 0.04).texture
    this.scene.environment = env
    this.scene.environmentIntensity = 0.7
    pm.dispose()
    sky.geometry.dispose()
    sky.material.dispose()
  }

  /** Tests: step the simulation (and visuals) without rendering every frame; renders once at the end. */
  simulate(seconds: number, render = true) {
    const step = 1 / 30
    for (let t = 0; t < seconds - 1e-6; t += step) this.frame(step, false)
    if (render) this.frame(step, true)
  }

  /** Tests: hold the free pointer at a world point (x, z) on the pointer plane, pressed or not. null releases it. */
  testPointer: { x: number; z: number; down: boolean } | null = null

  /* ================= Roster & Show flow (solo/host) ================= */

  private contestant(idx: number, id: string, look: Look, human: boolean): Contestant {
    const kinds = this.opts.assets.kinds.length ? this.opts.assets.kinds : (TOY_KINDS as readonly ToyKind[])
    const kind = (kinds as readonly string[]).includes(look.kind) ? (look.kind as ToyKind) : kinds[0]
    return { idx, id, name: look.name.slice(0, 16) || 'Stitchling', kind, tint: look.tint, outfit: cleanOutfit(look.outfit), human, out: false, outRound: -1, place: 0, stats: freshStats() }
  }

  /** People first, then bots: `hub` keeps a few ambient bots in the Loft, `show` fills to the Show size. */
  private buildRoster(kind: 'hub' | 'show', size = this.settings.size) {
    const humans = this.roster.filter((c) => c.human)
    if (!humans.length || this.role === 'solo') {
      humans.length = 0
      humans.push(this.contestant(0, this.role === 'host' ? 'host' : 'me', this.look, true))
    }
    const people = humans.map((c, i) => ({ ...c, idx: i, out: false, outRound: -1, place: 0, stats: freshStats() }))
    const total = kind === 'hub' ? Math.min(people.length + Math.max(0, Math.min(size - people.length, 5)), 12) : Math.max(people.length, Math.min(16, size))
    const taken = new Set(people.map((p) => p.name))
    const rng = makeRng((Date.now() & 0xffff) + people.length)
    const roster: Contestant[] = [...people]
    for (let i = people.length; i < total; i++) {
      const name = botName(i * 7 + rng.int(0, 20), taken)
      taken.add(name)
      const kinds = this.opts.assets.kinds.length ? this.opts.assets.kinds : ['sock']
      roster.push(this.contestant(i, `bot-${i}`, { name, kind: rng.pick(kinds), tint: rng.pick(TINTS.slice(1)), outfit: randomOutfit(() => rng.next()) }, false))
    }
    this.roster = roster
    this.meIdx = this.role === 'client' ? this.meIdx : 0
  }

  rosterRows(): RosterRow[] {
    return this.roster.map((c) => ({ idx: c.idx, id: c.id, name: c.name, kind: c.kind, tint: c.tint, outfit: c.outfit, human: c.human, out: c.out, outRound: c.outRound }))
  }

  /** Back to the Loft (solo/host). */
  toLoft() {
    if (this.role === 'client') return
    this.results = null
    this.plan = null
    this.buildRoster('hub')
    this.startHub()
  }

  private startHub() {
    const setup: RoundSetup = {
      levelId: 'loft', seed: 1234, mode: 'hub', toys: this.roster.map((c) => c.idx), target: 0, index: 0, total: 0, final: false, settings: { ...this.settings },
    }
    this.beginRound(setup)
  }

  /** Start a full Show from the Loft (solo/host). */
  startShow() {
    if (this.role === 'client' || !this.round) return
    this.buildRoster('show')
    const rng = makeRng(Date.now() & 0xffffff)
    this.plan = planShow(LEVELS, this.roster.length, this.settings.rounds, rng)
    this.planIdx = 0
    this.planMode = 'show'
    this.results = null
    this.nextPlannedRound()
  }

  /** Quick Play: one level, no eliminations (solo/host). */
  startQuick(levelId: string) {
    if (this.role === 'client') return
    const lv = levelById(levelId)
    if (!lv) return
    this.buildRoster('show', Math.max(lv.players[0], Math.min(lv.players[1], this.settings.size)))
    this.plan = [{ levelId: lv.id, final: false }]
    this.planIdx = 0
    this.planMode = 'quick'
    this.results = null
    this.nextPlannedRound()
  }

  /** Tests: play a specific level as the next Show round. */
  forceRound(levelId: string, final = false) {
    if (!this.plan) {
      this.buildRoster('show')
      this.plan = []
      this.planMode = 'show'
    }
    this.plan.splice(this.planIdx, 0, { levelId, final })
    this.nextPlannedRound()
  }

  private nextPlannedRound() {
    const plan = this.plan
    if (!plan) return
    const alive = this.roster.filter((c) => !c.out)
    // Two left: straight to the final.
    if (this.planMode === 'show' && alive.length <= 2 && !plan[this.planIdx].final) this.planIdx = plan.length - 1
    const p = plan[this.planIdx]
    const lv = levelById(p.levelId) ?? LEVELS[0]
    const quick = this.planMode === 'quick'
    const target = quick ? alive.length : roundTarget(alive.length, plan.length - this.planIdx, p.final, this.roster.length)
    const setup: RoundSetup = {
      levelId: lv.id,
      seed: (Date.now() & 0xffffff) ^ (this.planIdx * 977),
      mode: this.planMode,
      toys: alive.map((c) => c.idx),
      target,
      index: this.planIdx,
      total: plan.length,
      final: p.final,
      settings: { ...this.settings },
    }
    this.beginRound(setup)
  }

  /* ================= Round building (every screen) ================= */

  private teardownRound() {
    const r = this.round
    if (!r) return
    try {
      r.level.dispose?.(r.ctx, r.state)
    } catch {
      // A level's cleanup failing must not wedge the next round.
    }
    for (const rig of r.rigs) rig.dispose()
    r.root.removeFromParent()
    disposeTree(r.root, this.opts.assets)
    r.phys.free()
    for (const t of r.tags) t.el.remove()
    for (const f of this.flying) f.mesh.visible = false
    this.flying.length = 0
    this.audio.music.stop()
    this.round = null
  }

  private beginRound(setup: RoundSetup) {
    this.teardownRound()
    const level = levelById(setup.levelId) ?? LEVELS[0]
    const phys = new Phys()
    const root = new THREE.Group()
    root.name = `level:${level.id}`
    this.scene.add(root)
    const rng = makeRng(setup.seed)
    const r = { setup, level, phys, root, toys: [], rigs: [], props: [], grabbables: [], rng, ended: false, outOrder: [], tags: [] } as unknown as Round
    r.ctx = new Ctx(this, r, rng)
    r.hazards = new Hazards(() => r.ctx)
    this.round = r
    this.clock = 0
    this.phase = setup.mode === 'hub' ? 'loft' : 'intro'
    this.phaseT = 0
    this.acc = 0
    this.pinned = this.hover = this.spec = -1
    this.virt.set = false
    this.zone = null

    const sky = level.sky ?? { color: '#2e1d12', fogNear: 45, fogFar: 140 }
    ;(this.scene.background as THREE.Color).set(sky.color)
    const fog = this.scene.fog as THREE.Fog
    fog.color.set(sky.color)
    fog.near = sky.fogNear
    fog.far = sky.fogFar

    level.build(r.ctx)
    // Toys exist (unplaced) before init so a level can size itself to the field; spawn() then places them.
    const n = setup.toys.length
    setup.toys.forEach((cIdx, i) => {
      const c = this.roster[cIdx]
      if (!c) return
      const toy = new Toy(phys, r.toys.length, c, { x: i * 2, y: -50, z: 0 }, 0, false)
      toy.isMe = c.idx === this.meIdx
      r.toys.push(toy)
    })
    r.state = level.init(r.ctx)
    r.toys.forEach((toy, i) => {
      const s = level.spawn ? level.spawn(r.ctx, r.state, toy, i, n) : spawnGrid(n, { x: 0, z: 0, yaw: 0 })[i]
      toy.spawn = { ...s }
      toy.teleport(s.x, s.y + FOOT + 0.05, s.z, s.yaw)
      toy.forced = 0
      toy.sprinkles = level.sprinkles?.start ?? 0
      if (level.runSpeed) toy.runSpeed = level.runSpeed
      const rig = new ToyRig(this.opts.assets, toy.c.kind, toy.c.tint, this.shadowsOn)
      dressRig(rig, toy.c.outfit, this.opts.assets)
      toy.rig = rig
      r.rigs.push(rig)
      root.add(rig.root, rig.ball)
    })
    if (level.bodyMode && level.bodyMode !== 'walk') for (const t of r.toys) r.ctx.setBodyMode(t, level.bodyMode)
    level.setup?.(r.ctx, r.state)
    if (this.role === 'client') for (const t of r.toys) if (!t.isMe) t.setPuppet(true)
    for (const t of r.toys) t.bot = !t.c.human || (t.isMe && this.autopilot)

    r.sab = new Sabotage({
      ctx: r.ctx,
      level,
      state: r.state,
      toys: r.toys,
      roster: this.roster,
      rng: makeRng(setup.seed ^ 0x5bd1e995),
      trickFx: (def, user, target, result) => this.emitFx({ k: 'tr', id: def.id, u: user.idx, t: target ? target.idx : -1, r: result }),
      throwFx: (kind, from, target) => this.emitFx({ k: 'th', kind, f: from.idx, t: target.idx }),
    })
    for (const c of this.roster) if (c.out && !setup.toys.includes(c.idx)) r.sab.joinGallery(c)
    this.buildTags(r)

    this.input.setMode(level.pointer ?? 'look')
    const me = r.ctx.me
    if (me) this.cam.yaw = me.yaw
    this.cam.snap()
    if (this.role === 'host') {
      this.send({ t: 'pp-round', r: setup, roster: this.rosterRows() })
      this.outEvents = []
    }
    this.pushHud(true)
  }

  private buildTags(r: Round) {
    r.tags = r.toys.map((t) => {
      const el = document.createElement('div')
      el.className = `pp-tag${t.isMe ? ' is-me' : ''}`
      el.style.setProperty('--pp-tint', t.c.tint === '#ffffff' ? '#fde68a' : t.c.tint)
      const mark = document.createElement('span')
      mark.className = 'pp-tag-mark'
      const name = document.createElement('span')
      name.className = 'pp-tag-name'
      name.textContent = t.isMe ? `${t.name} (you)` : t.name
      el.append(mark, name)
      this.tagLayer.appendChild(el)
      return { el, name, mark }
    })
  }

  /* ================= Frame ================= */

  private frame(dt: number, render: boolean) {
    if (this.disposed) return
    if (this.deferred) {
      const run = this.deferred
      this.deferred = null
      run()
    }
    const f = this.input.poll()
    const r = this.round
    if (r) this.localControls(f, dt, r)
    if (r) {
      if (this.role === 'client') this.clientUpdate(dt, r)
      else {
        this.acc += dt
        let steps = 0
        while (this.acc >= STEP && steps < 8) {
          this.hostStep(STEP, r)
          this.acc -= STEP
          steps++
          if (this.round !== r) break
        }
        if (steps === 8) this.acc = 0
      }
    }
    const vr = this.round
    const vdt = this.hitStop > 0 ? dt * 0.12 : dt
    this.hitStop = Math.max(0, this.hitStop - dt)
    if (vr) this.visuals(vdt, dt, vr, render)
    this.puffs.update(vdt)
    this.confetti.update(vdt)
    this.audio.music.update(dt)
    for (const fl of this.feedList) fl.age += dt
    if (this.feedList.length && this.feedList[0].age > 7) this.feedList.shift()
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }
    if (!render) return
    this.renderer.render(this.scene, this.cam.camera)
    if (vr) this.updateTags(vr)
    this.hudT -= dt
    if (this.hudT <= 0 || this.lastHudPhase !== this.phase) {
      this.hudT = 0.1
      this.pushHud(false)
    }
    this.watchPerf(dt)
  }

  /** Drop resolution, then shadows, if frames stay slow. */
  private watchPerf(dt: number) {
    if (this.opts.snap) return
    const p = this.perf
    p.t += dt
    p.frames++
    if (p.t < 2.5) return
    const avg = p.t / p.frames
    p.t = 0
    p.frames = 0
    if (avg > 1 / 38) p.slow++
    else p.slow = 0
    if (p.slow < 2) return
    p.slow = 0
    if (p.step === 0 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1)
      this.resize()
    } else if (p.step <= 1 && this.shadowsOn) {
      this.shadowsOn = false
      this.renderer.shadowMap.enabled = false
      this.sun.castShadow = false
      this.quality = 'low'
    }
    p.step++
  }

  /* ================= Local controls ================= */

  private gallery(r: Round) {
    const me = r.toys.find((t) => t.c.idx === this.meIdx)
    return !me || me.status === 'failed'
  }

  private localControls(f: InputFrame, dt: number, r: Round) {
    const level = r.level
    const free = (level.pointer ?? 'look') === 'free' && this.phase !== 'loft'
    if (!free) {
      this.cam.turn(f.lookX, f.lookY)
      if (f.zoom) this.cam.dist = THREE.MathUtils.clamp(this.cam.dist + f.zoom * 0.7, 3, 12)
    }
    const me = r.toys.find((t) => t.c.idx === this.meIdx) ?? null
    const pad = this.myPad
    const mv = this.cam.toWorld(f.moveX, f.moveY, { x: 0, z: 0 })
    pad.mx = free ? 0 : mv.x
    pad.mz = free ? 0 : mv.z
    pad.yaw = this.cam.yaw
    pad.grab = f.grab
    if (f.jump) this.padFlags.jump = true
    if (f.dive) this.padFlags.dive = true
    if (f.shove) this.padFlags.shove = true
    if (f.act) this.padFlags.act = true

    // Free pointer: the pointer (or a stick-driven needle) on the level's pointer plane.
    if (free && me) {
      if (!this.virt.set) {
        this.virt.set = true
        this.virt.x = me.pos.x
        this.virt.z = me.pos.z
        const home = level.pointerHome?.(r.ctx, r.state, me)
        if (home) {
          this.virt.x = home.x
          this.virt.z = home.z
        }
      }
      if (f.pointer) {
        const hit = this.planeHit(f.pointer.x, f.pointer.y, level.pointerPlaneY ?? 0)
        if (hit) {
          this.virt.x = hit.x
          this.virt.z = hit.z
        }
      } else if (Math.abs(f.moveX) + Math.abs(f.moveY) > 0) {
        const sp = 0.9 * dt
        this.virt.x += mv.x * sp
        this.virt.z += mv.z * sp
      }
      pad.px = this.virt.x
      pad.pz = this.virt.z
      pad.down = f.down || f.jumpHeld
      if (this.testPointer) {
        pad.px = this.virt.x = this.testPointer.x
        pad.pz = this.virt.z = this.testPointer.z
        pad.down = this.testPointer.down
      }
      if (f.click) {
        const hit = this.planeHit(f.click.x, f.click.y, level.pointerPlaneY ?? 0)
        if (hit) {
          const picked = level.pick?.(r.ctx, r.state, hit) ?? r.ctx.nearest(hit, (t) => t.status === 'play' && t !== me && t.pos.distanceToSquared(hit) < 6)
          if (picked && picked !== me) {
            this.pinned = picked.idx
            this.audio.play('tick')
          }
        }
      }
    }

    // Number keys: emotes in the Loft, throwables in the gallery, tricks while playing.
    if (f.slot >= 0) {
      if (this.phase === 'loft') {
        const em = this.emoteKeys[f.slot]
        if (em) this.padFlags.emote = em
      } else if (this.gallery(r)) {
        const kind = r.sab.throwables()[f.slot]
        if (kind) this.throwAt(kind)
      } else {
        const list = this.visibleTricks(r, me)
        const def = list[f.slot]
        if (def) this.useTrick(def.id)
      }
    }
    if (f.cycle) this.cycleTarget(r, me)
    if (f.prev || f.next) {
      if (this.gallery(r) || (me && me.status !== 'play')) this.cycleSpectate(r, f.next ? 1 : -1)
    }
  }

  private planeHit(nx: number, ny: number, y: number) {
    _ndc.set(nx, ny)
    _ray.setFromCamera(_ndc, this.cam.camera)
    _plane.set(_w.set(0, 1, 0), -y)
    return _ray.ray.intersectPlane(_plane, _v) ? _v.clone() : null
  }

  private visibleTricks(r: Round, me: Toy | null): TrickDef<unknown>[] {
    const spice = r.setup.settings.spice
    return (r.level.tricks ?? []).filter((t: TrickDef<unknown>) => (t.minSpice ?? 0) <= spice && !(me && t.hidden?.(r.ctx, r.state, me)))
  }

  /** The rival a trick would hit: picked (Tab / click), under the crosshair, or your grudge. */
  aimTarget(r: Round, me: Toy | null): Toy | null {
    const p = r.toys[this.pinned]
    if (p && p.status === 'play' && p !== me) return p
    const h = r.toys[this.hover]
    if (h && h.status === 'play' && h !== me) return h
    if (me?.grudge && me.grudge.status === 'play') return me.grudge
    return null
  }

  private cycleTarget(r: Round, me: Toy | null) {
    const rivals = r.toys.filter((t) => t !== me && t.status === 'play')
    if (!rivals.length) return
    if (me) rivals.sort((a, b) => a.pos.distanceToSquared(me.pos) - b.pos.distanceToSquared(me.pos))
    const i = rivals.findIndex((t) => t.idx === this.pinned)
    this.pinned = rivals[(i + 1) % rivals.length].idx
    this.audio.play('tick')
  }

  private cycleSpectate(r: Round, dir: number) {
    const alive = r.toys.filter((t) => t.status === 'play')
    if (!alive.length) return
    const i = alive.findIndex((t) => t.idx === this.spec)
    this.spec = alive[(i + dir + alive.length) % alive.length].idx
  }

  /** Use a trick (HUD button or number key). */
  useTrick(id: string, targetIdx?: number) {
    const r = this.round
    if (!r) return
    const me = r.toys.find((t) => t.c.idx === this.meIdx)
    const t = targetIdx ?? this.aimTarget(r, me ?? null)?.idx ?? -1
    this.action(`trick:${id}:${t}`)
  }

  /** Throw something from the peanut gallery at the spectated / picked toy. */
  throwAt(kind: ThrowKind, targetIdx?: number) {
    const r = this.round
    if (!r) return
    const t = targetIdx ?? (this.pinned >= 0 && r.toys[this.pinned]?.status === 'play' ? this.pinned : this.spec)
    this.action(`throw:${kind}:${t}`)
  }

  emote(kind: EmoteKey) {
    this.padFlags.emote = kind
  }

  /** Emotes on the Loft's number keys, in order (the page adds unlocked ones after wave, dance and stomp). */
  emoteKeys: EmoteKey[] = ['wave', 'dance', 'stomp']
  setEmotes(list: EmoteKey[]) {
    this.emoteKeys = list.filter((e) => (EMOTES as readonly string[]).includes(e)).slice(0, 9)
  }

  /** Pick a rival for tricks by roster position in this round (HUD). */
  pickTarget(idx: number) {
    this.pinned = idx
  }

  spectateNext(dir: number) {
    if (this.round) this.cycleSpectate(this.round, dir)
  }

  private action(a: string) {
    if (this.role === 'client') this.pending.push(a)
    else this.myActs.push(a)
  }

  /* ================= Host simulation ================= */

  private toyEvents(r: Round): ToyEvents {
    const fx = this.fxApi
    return {
      onHit: (victim, by, kind, power) => {
        if (kind === 'land') {
          fx.puff({ x: victim.pos.x, y: victim.feet + 0.1, z: victim.pos.z }, 'dust', power > 0 ? 14 : 8)
          if (power > 0) fx.sfx('thud', victim.pos)
          return
        }
        if (by) {
          r.ctx.blame(victim, by)
          if (kind === 'shove') by.c.stats.shoves++
        }
        fx.puff({ x: victim.pos.x, y: victim.pos.y + 0.2, z: victim.pos.z }, 'stuff', kind === 'dive' ? 12 : 7)
        fx.sfx(kind === 'dive' ? 'thud' : 'squeak', victim.pos)
        if (power >= 7.5) {
          fx.hitStop(0.07)
          fx.shake(0.35, victim)
          if (by) fx.shake(0.2, by)
        }
      },
      onJump: (t) => fx.sfx('boop', t.pos),
      onDive: (t) => fx.sfx('whoosh', t.pos),
      onWhiff: () => {},
      onGrab: (t, o) => {
        fx.sfx('squeak', t.pos)
        if (o) r.ctx.blame(o, t)
      },
      onWriggle: (t) => {
        fx.popup(t, 'Wriggled free!', '#a7f3d0')
        fx.sfx('pop', t.pos)
      },
    }
  }

  private hostStep(dt: number, r: Round) {
    this.phaseT += dt
    this.director(r)
    if (this.round !== r) return
    const ctx = r.ctx
    const playing = this.phase === 'play' || this.phase === 'loft'
    if (this.phase === 'countdown') this.clock = this.phaseT - COUNTDOWN
    else if (playing) this.clock += dt

    // Pads: this screen, remote players, bots.
    for (const t of r.toys) {
      if (t.isMe && !t.bot) {
        const p = t.pad
        Object.assign(p, this.myPad)
        p.jump = this.padFlags.jump
        p.dive = this.padFlags.dive
        p.shove = this.padFlags.shove
        p.act = this.padFlags.act
        p.emote = this.padFlags.emote
      } else if (t.c.human && !t.isMe && !t.bot && !this.afk(t)) {
        const rm = this.remote.get(t.c.id)
        if (rm) {
          Object.assign(t.pad, rm.pad)
          for (const a of rm.acts) this.applyAct(t.pad, a)
        }
      } else {
        const p = t.pad
        p.mx = p.mz = 0
        p.grab = false
        p.down = false
        if (playing && t.status === 'play') r.level.bot?.(ctx, r.state, t, dt)
      }
    }
    this.padFlags.jump = this.padFlags.dive = this.padFlags.shove = this.padFlags.act = false
    this.padFlags.emote = ''
    // One-shot actions (tricks and throws).
    const mine = this.myActs
    this.myActs = []
    for (const a of mine) this.applyHostAct(r, this.meIdx, a)
    for (const [id, rm] of this.remote) {
      const c = this.roster.find((x) => x.id === id)
      if (c) for (const a of rm.acts) this.applyHostAct(r, c.idx, a)
      rm.acts = []
    }

    const ev = this.events(r).ev
    const locked = !playing
    for (const t of r.toys) if (t.status !== 'failed' || (t.data.goneAt as number) > this.clock) t.preStep(dt, r.phys, r.toys, ev, locked, r.grabbables)
    if (playing) {
      r.hazards.affect(ctx, r.toys, dt, false)
      if (this.phase === 'play' || r.setup.mode === 'hub') {
        r.level.tick?.(ctx, r.state, dt)
        r.sab.tickBots(dt)
        r.sab.tickGallery(dt)
      }
    }
    // Belt and braces: if anything above replaced the round, this one's world is gone.
    if (this.round !== r) return
    r.hazards.update(ctx, this.clock, dt)
    r.phys.step()
    const fallY = r.level.fallY ?? -8
    for (const t of r.toys) {
      t.postStep(dt, r.phys, ev)
      // Online: a player moves their own toy; trust it while nothing here is pushing them around.
      if (t.c.human && !t.isMe && !t.bot && !this.afk(t) && t.status === 'play' && t.mode !== 'seated') {
        const rp = this.remote.get(t.c.id)?.pos
        if (rp && t.forced <= 0 && !t.grabbedBy && t.stun <= 0 && Math.hypot(rp[0] - t.pos.x, rp[2] - t.pos.z) < 2.5 && Math.abs(rp[1] - t.pos.y) < 2.5) {
          t.body.setTranslation({ x: rp[0], y: rp[1], z: rp[2] }, true)
          t.pos.set(rp[0], rp[1], rp[2])
          t.yaw = rp[3]
        }
      }
      if (t.pos.y < fallY && t.status !== 'failed') {
        if (r.level.onFall) r.level.onFall(ctx, r.state, t)
        else if (r.setup.mode === 'show' && (r.level.type === 'survival' || r.level.type === 'final')) ctx.fail(t, 'fell off')
        else ctx.respawn(t)
        if (t.pos.y < fallY && t.status === 'play') ctx.respawn(t)
      }
      if (t.status === 'failed') {
        if (t.data.goneAt === undefined) t.data.goneAt = this.clock + GONE_AFTER
        if (this.clock > (t.data.goneAt as number) && !r.level.keepFailed && t.body.isEnabled()) {
          t.body.setEnabled(false)
          this.fxApi.puff(t.pos, 'stuff', 14)
          this.fxApi.sfx('pop', t.pos)
        }
      }
      t.anim = t.pickAnim()
      clearOneShots(t.pad)
    }
    for (const rm of this.remote.values()) clearOneShots(rm.pad)

    if (this.phase === 'play' && r.setup.mode !== 'hub') this.checkEnd(r)

    if (this.role === 'host' && this.opts.net) {
      this.snapT -= dt
      if (this.snapT <= 0) {
        this.snapT = 1 / SNAP_HZ
        this.send({ t: 'pp-snap', s: this.buildSnap(r), e: this.outEvents })
        this.outEvents = []
      }
    }
  }

  /**
   * A remote player who has gone quiet for 3 s mid-round (hidden tab, dropped link) has a bot drive their toy
   * until their input comes back. In the Loft they just stand still.
   */
  afk(t: Toy) {
    if (this.phase === 'loft' || !t.c.human || t.isMe) return false
    const rm = this.remote.get(t.c.id)
    return !rm || performance.now() - rm.last > 3000
  }

  private applyAct(p: Pad, a: string) {
    if (a === 'jump') p.jump = true
    else if (a === 'dive') p.dive = true
    else if (a === 'shove') p.shove = true
    else if (a === 'act') p.act = true
    else if (a.startsWith('emote:') && (EMOTES as readonly string[]).includes(a.slice(6))) p.emote = a.slice(6) as Pad['emote']
  }

  private applyHostAct(r: Round, cIdx: number, a: string) {
    const [kind, id, tgt] = a.split(':')
    if (kind === 'trick') {
      const user = r.toys.find((t) => t.c.idx === cIdx)
      if (!user) return
      const res = r.sab.use(user, id, Number(tgt))
      if (res !== true) this.emitFx({ k: 'no', t: res, to: cIdx })
    } else if (kind === 'throw') {
      const c = this.roster[cIdx]
      if (!c) return
      const res = r.sab.throw(c, id as ThrowKind, Number(tgt))
      if (res !== true) this.emitFx({ k: 'no', t: res, to: cIdx })
    }
  }

  /** Phase changes (solo/host). */
  private director(r: Round) {
    const ctx = r.ctx
    if (this.phase === 'intro' && this.phaseT >= INTRO) this.setPhase('countdown')
    else if (this.phase === 'countdown') {
      const n = Math.ceil(COUNTDOWN - this.phaseT)
      const prev = Math.ceil(COUNTDOWN - (this.phaseT - STEP))
      if (n !== prev && n > 0) this.fxApi.sfx('count')
      if (this.phaseT >= COUNTDOWN) {
        this.setPhase('play')
        this.clock = 0
        this.fxApi.say('GO!', '#86efac', 1)
        this.fxApi.sfx('go')
        r.level.start?.(ctx, r.state)
      }
    } else if (this.phase === 'play') {
      if (r.ended) this.endRound(r)
      else if (this.clock >= r.level.duration) {
        this.timeUp(r)
        this.endRound(r)
      }
    } else if (this.phase === 'end' && this.phaseT >= END) this.afterRound(r)
  }

  private setPhase(p: StagePhase) {
    this.phase = p
    this.phaseT = 0
  }

  private checkEnd(r: Round) {
    const ctx = r.ctx
    // Counted without allocating: this runs every step.
    let q = 0, a = 0
    for (const t of r.toys) {
      if (t.status === 'qualified') q++
      else if (t.status === 'play') a++
    }
    if (r.setup.mode === 'quick') {
      if (!a) r.ended = true
      return
    }
    if (q >= r.setup.target) {
      r.ended = true
    } else if (q + a <= r.setup.target && a > 0) {
      // Enough have dropped out: everyone still standing goes through.
      for (const t of ctx.active()) ctx.qualify(t, 'survived')
      r.ended = true
    } else if (!a) r.ended = true
  }

  private timeUp(r: Round) {
    const ctx = r.ctx
    this.fxApi.say("TIME'S UP", '#fde68a', 1.6)
    if (r.level.onTimeUp) {
      r.level.onTimeUp(ctx, r.state)
      return
    }
    const survival = r.level.type === 'survival' || r.level.type === 'final'
    const ranked = r.level.rank ? r.level.rank(ctx, r.state) : ctx.active()
    if (r.setup.mode === 'quick') return
    let room = r.setup.target - ctx.qualifiedCount()
    if (survival && !r.setup.final) {
      for (const t of ranked) if (t.status === 'play') ctx.qualify(t, 'survived')
      return
    }
    for (const t of ranked) {
      if (t.status !== 'play') continue
      if (room > 0) {
        ctx.qualify(t, 'on time')
        room--
      } else ctx.fail(t, 'too slow')
    }
  }

  private endRound(r: Round) {
    if (this.phase === 'end') return
    const ctx = r.ctx
    this.setPhase('end')
    if (r.setup.mode === 'show') {
      // Anyone still playing who didn't make it is out, worst first (by rank).
      const ranked = r.level.rank ? r.level.rank(ctx, r.state) : ctx.active()
      const left = [...ranked.filter((t) => t.status === 'play'), ...ctx.active().filter((t) => !ranked.includes(t))]
      for (let i = left.length - 1; i >= 0; i--) ctx.fail(left[i], 'not through')
      if (r.setup.final && ctx.qualifiedCount() === 0) {
        // Nobody finished the final: the best of the last ones standing takes it.
        const lastOut = r.outOrder[r.outOrder.length - 1]
        const t = r.toys.find((x) => x.c.idx === lastOut)
        if (t) {
          t.status = 'qualified'
          r.outOrder.pop()
        }
      }
      for (const t of r.toys) {
        if (t.status === 'qualified') t.c.stats.roundsQualified++
        else {
          t.c.out = true
          t.c.outRound = r.setup.index
        }
      }
    }
    this.fxApi.say(r.setup.mode === 'quick' ? 'ROUND OVER' : r.setup.final ? 'SHOW OVER' : 'ROUND OVER', '#fde68a', 2)
    this.audio.music.stop()
  }

  private afterRound(r: Round) {
    if (r.setup.mode === 'hub') return
    const plan = this.plan
    const winners = r.toys.filter((t) => t.status === 'qualified').sort((a, b) => a.doneAt - b.doneAt)
    const quick = r.setup.mode === 'quick'
    const last = !plan || this.planIdx >= plan.length - 1 || (!quick && this.roster.filter((c) => !c.out).length <= 1)
    if (!last && plan) {
      this.planIdx++
      if (!r.setup.final && plan[this.planIdx]) {
        this.nextPlannedRound()
        return
      }
    }
    // Results: the order is the winner(s), then everyone by how late they went out.
    let order: number[]
    if (quick) {
      const ranked = r.level.rank ? r.level.rank(r.ctx, r.state) : []
      const rest = r.toys.filter((t) => t.status !== 'qualified')
      rest.sort((a, b) => (ranked.indexOf(a) < 0 ? 99 : ranked.indexOf(a)) - (ranked.indexOf(b) < 0 ? 99 : ranked.indexOf(b)))
      order = [...winners.map((t) => t.c.idx), ...rest.map((t) => t.c.idx)]
    } else {
      const outs = this.roster.filter((c) => c.out).sort((a, b) => b.outRound - a.outRound)
      const champs = this.roster.filter((c) => !c.out)
      // Same round: later out ranks higher.
      const seq = new Map<number, number>()
      r.outOrder.forEach((idx, i) => seq.set(idx, i))
      outs.sort((a, b) => b.outRound - a.outRound || (seq.get(b.idx) ?? 0) - (seq.get(a.idx) ?? 0))
      order = [...champs.sort((a, b) => (winners.findIndex((t) => t.c.idx === a.idx) + 1 || 99) - (winners.findIndex((t) => t.c.idx === b.idx) + 1 || 99)).map((c) => c.idx), ...outs.map((c) => c.idx)]
    }
    order.forEach((idx, i) => {
      if (this.roster[idx]) this.roster[idx].place = i + 1
    })
    const res = awardsFor(this.roster, order, quick, r.level.name)
    this.showResults(res)
    // The champion wears the crown.
    const champ = r.toys.find((t) => t.c.idx === order[0])
    if (champ && !quick) {
      this.crown(champ)
      this.emitFx({ k: 'crown', i: champ.idx })
    }
  }

  private showResults(res: ShowResults) {
    this.results = res
    this.setPhase('results')
    this.send({ t: 'pp-results', r: res })
    this.saveEarnings(res)
  }

  private saveEarnings(res: ShowResults) {
    const win = res.order[0] === this.meIdx && !res.quick
    const awards = res.awards.filter((a) => a.who === this.meIdx).map((a) => a.id)
    if (this.onReward) {
      this.onReward({ buttons: res.buttons[this.meIdx] ?? 0, win, awards })
      return
    }
    const p = this.opts.profile
    p.buttons += res.buttons[this.meIdx] ?? 0
    p.shows++
    if (win) p.wins++
    p.awards ??= {}
    for (const a of awards) p.awards[a] = (p.awards[a] ?? 0) + 1
    this.onEarn?.(p)
  }
  /** The page saves the profile when buttons are earned. */
  onEarn: ((p: Profile) => void) | null = null
  /**
   * Preferred over onEarn: the Show's reward for this screen's player, for the page to merge into its own
   * (current) profile. When set, the engine leaves `opts.profile` alone.
   */
  onReward: ((r: { buttons: number; win: boolean; awards: string[] }) => void) | null = null

  private crown(t: Toy) {
    if (!t.rig || t.data.crowned) return
    t.data.crowned = true
    t.rig.takeOff('hat')
    const src = this.opts.assets.props.crown
    let obj: THREE.Object3D
    if (src) {
      obj = src.clone(true)
      obj.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(obj)
      const s = box.getSize(new THREE.Vector3())
      obj.scale.multiplyScalar(0.42 / Math.max(s.x, s.z))
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(0.42 / Math.max(s.x, s.z))
      obj.position.set(-c.x, -box.min.y * (0.42 / Math.max(s.x, s.z)), -c.z)
      const g = new THREE.Group()
      g.add(obj)
      obj = g
    } else {
      obj = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.18, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#facc15', metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }))
    }
    t.rig.attach('head', obj, { offset: [0, 0.18, 0] })
  }

  /** Hub signals: zones are local to each screen; the toy chest starts a Show (when the host or solo player jumps in). */
  handleSignal(name: string, toy: Toy | null) {
    if (name.startsWith('zone:')) {
      if (toy?.isMe) {
        const z = name.slice(5) || null
        if (z !== this.zone) {
          this.zone = z
          this.onSignal?.(name, toy.c.idx)
        }
      }
      return
    }
    this.onSignal?.(name, toy ? toy.c.idx : -1)
    if (this.role === 'client') return
    // Never swap rounds mid-step (the physics world is in use): run it at the start of the next frame.
    if (name === 'chest' && toy && this.phase === 'loft' && toy.c.idx === this.meIdx) this.deferred = () => this.startShow()
  }
  private deferred: (() => void) | null = null

  /* ================= Effects ================= */

  /** Run an effect here (if it is for this screen) and, on the host, send it to clients. */
  emitFx(e: NetEv) {
    if (this.role === 'host' && this.opts.net) this.outEvents.push(e)
    if (e.to === undefined || e.to === this.meIdx) this.playFx(e)
  }

  private playFx(e: NetEv) {
    const r = this.round
    switch (e.k) {
      case 'p': {
        const kind = (e.c as keyof typeof PUFF_COLORS) ?? 'dust'
        const col = PUFF_COLORS[kind] ?? PUFF_COLORS.dust
        const n = Math.min(40, (e.n as number) ?? 10) * (this.quality === 'low' ? 0.6 : 1)
        this.puffs.burst(_v.set(e.x as number, e.y as number, e.z as number), Math.ceil(n), kind === 'spark' ? 3.5 : 2.4, kind === 'stuff' ? 0.9 : 0.7, kind === 'stuff' ? 0.32 : 0.24, col, { up: kind === 'milk' ? 1.4 : 0.8, jitter: 0.08 })
        break
      }
      case 'c': {
        const p = _v.set(e.x as number, (e.y as number) + 1.2, e.z as number)
        for (const col of CONFETTI) this.confetti.burst(p, this.quality === 'low' ? 6 : 14, 5, 2.2, 0.16, col, { up: 1.6, spread: 0.4 })
        break
      }
      case 'sh':
        this.cam.shake(e.a as number)
        break
      case 's':
        this.audio.play(e.n as string, e.x !== undefined ? { x: e.x as number, y: e.y as number, z: e.z as number } : undefined)
        break
      case 'say':
        this.banner = { id: this.nextId++, text: e.t as string, color: e.c as string, t: e.d as number }
        break
      case 'f':
        this.feedList.push({ id: this.nextId++, text: e.t as string, age: 0 })
        if (this.feedList.length > 6) this.feedList.shift()
        break
      case 'pu': {
        const t = r?.toys[e.i as number]
        if (t) this.popup(t, e.t as string, e.c as string)
        break
      }
      case 'hs':
        this.hitStop = Math.max(this.hitStop, e.d as number)
        break
      case 'lv':
        if (r) r.level.onEvent?.(r.ctx, r.state, e.d)
        break
      case 'no':
        this.banner = { id: this.nextId++, text: e.t as string, color: '#fca5a5', t: 1 }
        this.audio.play('buzz')
        break
      case 'tr': {
        if (!r) break
        const u = r.toys[e.u as number], t = r.toys[e.t as number]
        if (u && t) this.fly(u.pos, t.pos, '#fde68a', 0.35)
        if (e.r === 'reflected' && u) this.popup(u, 'BOUNCED!', '#93c5fd')
        if (e.r === 'blocked' && t) this.popup(t, 'Blocked!', '#93c5fd')
        if (u) this.audio.play(e.r === 'reflected' || e.r === 'blocked' ? 'pop' : 'whoosh', u.pos)
        break
      }
      case 'th': {
        if (!r) break
        const t = r.toys[e.t as number]
        if (!t) break
        const from = _w.set(t.pos.x + (Math.random() - 0.5) * 8, t.pos.y + 12, t.pos.z + (Math.random() - 0.5) * 8)
        const col = e.kind === 'crumb' ? '#c98a3e' : e.kind === 'paper' ? '#f8fafc' : '#fef3c7'
        this.fly(from, t.pos, col, 0.55, e.kind as string)
        this.audio.play('throw', t.pos)
        break
      }
      case 'crown': {
        const t = r?.toys[e.i as number]
        if (t) this.crown(t)
        break
      }
    }
  }

  /** Flair trails: a few particles behind a running toy (local to each screen). */
  private trail(rig: ToyRig, t: Toy, speed: number, dt: number) {
    const tr = rig.trail!
    rig.trailT -= dt * Math.min(1.6, speed / 4) * (this.quality === 'low' ? 0.5 : 1)
    if (rig.trailT > 0) return
    rig.trailT = tr.kind === 'bubbles' ? 0.09 : 0.045
    const x = t.pos.x - Math.sin(t.yaw) * 0.3 + (Math.random() - 0.5) * 0.3
    const z = t.pos.z - Math.cos(t.yaw) * 0.3 + (Math.random() - 0.5) * 0.3
    const y = t.pos.y - FOOT + (tr.kind === 'bubbles' ? 0.4 : 0.15) + Math.random() * 0.4
    if (tr.kind === 'glitter') this.puffs.emit(x, y, z, (Math.random() - 0.5) * 0.6, 0.6 + Math.random(), (Math.random() - 0.5) * 0.6, 0.7, 0.09, _col.setHSL(Math.random(), 0.9, 0.7))
    else if (tr.kind === 'bubbles') this.puffs.emit(x, y, z, (Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3, 1.4, 0.2, tr.color, 0.45)
    else this.puffs.emit(x, y, z, (Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8, 0.8, 0.22, tr.color)
  }

  /** A little thing flying from a to b (tricks, gallery throws). */
  private fly(a: THREE.Vector3Like, b: THREE.Vector3Like, color: string, dur: number, kind = 'spark') {
    let mesh = this.flyPool.find((m) => !m.visible)
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 }))
      this.scene.add(mesh)
      this.flyPool.push(mesh)
    }
    ;(mesh.material as THREE.MeshStandardMaterial).color.set(color)
    ;(mesh.material as THREE.MeshStandardMaterial).emissive.set(kind === 'spark' ? color : '#000000')
    mesh.scale.set(kind === 'feather' ? 2.2 : 1, kind === 'feather' ? 0.25 : 1, kind === 'feather' ? 0.8 : 1)
    mesh.visible = true
    this.flying.push({ mesh, a: new THREE.Vector3(a.x, a.y + 0.8, a.z), b: new THREE.Vector3(b.x, b.y + 0.4, b.z), t: 0, dur })
  }

  private popup(t: Toy, text: string, color: string) {
    const el = document.createElement('div')
    el.className = 'pp-pop'
    el.textContent = text
    el.style.color = color
    const p = this.project(_v.set(t.pos.x, t.pos.y - FOOT + 1.6, t.pos.z))
    if (!p) return
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
    this.popLayer.appendChild(el)
    window.setTimeout(() => el.remove(), 1400)
  }

  private project(p: THREE.Vector3) {
    const v = _w.copy(p).project(this.cam.camera)
    if (v.z > 1) return null
    const w = this.container.clientWidth, h = this.container.clientHeight
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, z: v.z }
  }

  /* ================= Visuals (every screen) ================= */

  private visuals(vdt: number, dt: number, r: Round, render: boolean) {
    const ctx = r.ctx
    const me = r.toys.find((t) => t.c.idx === this.meIdx) ?? null
    // Toys.
    for (const t of r.toys) {
      const rig = t.rig
      if (!rig) continue
      const gone = t.status === 'failed' && !t.body.isEnabled()
      rig.setVisible(!gone)
      if (gone) continue
      // The rig stands at the capsule's feet (on top of the ball in ball mode).
      rig.root.position.set(t.pos.x, t.pos.y - FOOT, t.pos.z)
      let dy = t.yaw - rig.root.rotation.y
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      rig.root.rotation.y += dy * Math.min(1, dt * 16)
      if (t.mode === 'ball') rig.ball.position.set(t.pos.x, t.pos.y - BALL_DROP, t.pos.z)
      const anim: AnimKey = this.role === 'client' && !t.isMe ? t.anim : t.pickAnim()
      const st = this.rigState
      st.anim = anim
      st.speed = Math.hypot(t.vel.x, t.vel.z)
      st.vy = t.vel.y
      st.grounded = t.grounded
      st.ball = t.mode === 'ball'
      st.ballVel = t.vel
      st.ballScale = t.popped > 0 ? 0.62 : 1
      st.stun = t.stun
      rig.lift = t.mode === 'ball' && t.popped > 0 ? -0.2 : 0
      rig.update(vdt, st)
      if (rig.trail && st.speed > 2 && render) this.trail(rig, t, st.speed, dt)
    }
    for (const p of r.props) {
      const tr = p.body.translation(), q = p.body.rotation()
      p.obj.position.set(tr.x, tr.y, tr.z)
      p.obj.quaternion.set(q.x, q.y, q.z, q.w)
    }
    r.level.visual?.(ctx, r.state, vdt)
    // Flying bits.
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]
      f.t += dt
      const k = Math.min(1, f.t / f.dur)
      f.mesh.position.lerpVectors(f.a, f.b, k)
      f.mesh.position.y += Math.sin(k * Math.PI) * 1.5
      f.mesh.rotation.x += dt * 9
      f.mesh.rotation.y += dt * 7
      if (k >= 1) {
        f.mesh.visible = false
        this.flying.splice(i, 1)
        this.puffs.burst(f.b, 6, 2, 0.4, 0.18, PUFF_COLORS.spark)
      }
    }

    // Camera.
    this.updateCamera(dt, r, me)
    this.audio.lx = this.cam.camera.position.x
    this.audio.ly = this.cam.camera.position.y
    this.audio.lz = this.cam.camera.position.z
    // Key light follows the action with a tight shadow frustum.
    const focus = this.cam.focus
    this.sun.position.set(focus.x + 9, focus.y + 22, focus.z + 14)
    this.sun.target.position.copy(focus)
    this.sun.target.updateMatrixWorld()

    // Crosshair target (look mode): the rival nearest the screen centre.
    if (render && (r.level.pointer ?? 'look') === 'look' && me) {
      let best = -1, bd = 0.3
      for (const t of r.toys) {
        if (t === me || t.status !== 'play') continue
        const v = _w.set(t.pos.x, t.pos.y + 0.4, t.pos.z).project(this.cam.camera)
        if (v.z > 1) continue
        const d = Math.hypot(v.x, v.y)
        if (d < bd) {
          bd = d
          best = t.idx
        }
      }
      this.hover = best
    }
  }

  private updateCamera(dt: number, r: Round, me: Toy | null) {
    const ctx = r.ctx
    const level = r.level
    if (this.phase === 'intro') {
      // A slow fly-round of the arena while the intro card is up.
      const o = level.introOrbit ?? { radius: 15, height: 9 }
      const [cx, cy, cz] = o.center ?? [0, 0, 0]
      const a = this.phaseT * 0.25
      _v.set(cx + Math.sin(a) * o.radius, cy + o.height, cz + Math.cos(a) * o.radius)
      this.cam.place(_v, _w.set(cx, cy + 0.5, cz), dt, 3)
      this.cam.applyShake(dt)
      return
    }
    if (level.cameraUpdate && level.cameraUpdate(ctx, r.state, this.cam, dt)) {
      this.cam.applyShake(dt)
      return
    }
    // Who to look at: your toy, or the one you're spectating.
    let focusToy: Toy | null = me && (me.status === 'play' || me.status === 'qualified' || (me.data.goneAt as number) > this.clock) ? me : null
    if (!focusToy) {
      let s = r.toys[this.spec]
      if (!s || s.status !== 'play') {
        this.cycleSpectate(r, 1)
        s = r.toys[this.spec]
      }
      focusToy = s ?? r.toys[0] ?? null
    }
    const preset = level.camera ?? { kind: 'chase' }
    const target = focusToy ? _v.set(focusToy.pos.x, focusToy.pos.y + (focusToy.mode === 'ball' ? 0.2 : 0.55), focusToy.pos.z) : _v.set(0, 1, 0)
    const spectating = !me || focusToy !== me
    if (preset.kind === 'overhead') this.cam.overhead(dt, _w.set(0, 0, 0), target, preset)
    else if (preset.kind === 'fixed') {
      _w.set(...preset.pos)
      this.cam.place(_w, _v.set(...preset.look), dt)
    } else {
      if (spectating) this.cam.pitch = Math.max(this.cam.pitch, 0.55)
      this.cam.chase(dt, target, r.phys, {
        dist: (preset.dist ?? this.cam.dist) * (spectating ? 1.3 : 1),
        height: preset.height,
        heading: focusToy?.yaw,
        moving: !!focusToy && Math.hypot(focusToy.vel.x, focusToy.vel.z) > 1.5,
      })
    }
    this.cam.applyShake(dt)
  }

  private updateTags(r: Round) {
    const me = r.toys.find((t) => t.c.idx === this.meIdx) ?? null
    const aim = this.aimTarget(r, me)
    const w = this.container.clientWidth, h = this.container.clientHeight
    const cam = this.cam.camera
    r.toys.forEach((t, i) => {
      const tag = r.tags[i]
      if (!tag) return
      const gone = t.status === 'failed' && !t.body.isEnabled()
      const v = _w.set(t.pos.x, t.pos.y - FOOT + 1.3 + (t.data.crowned ? 0.35 : 0), t.pos.z).project(cam)
      const dist = cam.position.distanceTo(t.pos)
      if (gone || v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2 || dist > 60) {
        if (tag.el.style.display !== 'none') tag.el.style.display = 'none'
        return
      }
      tag.el.style.display = ''
      const s = THREE.MathUtils.clamp(9 / dist, 0.55, 1.1)
      tag.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`
      const grudge = !!me && me.grudge === t && t !== me
      const cls = `pp-tag${t.isMe ? ' is-me' : ''}${grudge ? ' is-grudge' : ''}${aim === t ? ' is-aim' : ''}${t.status === 'qualified' ? ' is-through' : ''}${t.status === 'failed' ? ' is-out' : ''}${t.bubble ? ' is-bubble' : ''}`
      if (tag.el.className !== cls) tag.el.className = cls
      const mark = grudge ? '✕' : t.status === 'qualified' ? '✓' : ''
      if (tag.mark.textContent !== mark) tag.mark.textContent = mark
    })
  }

  /* ================= HUD ================= */

  private pushHud(force: boolean) {
    this.lastHudPhase = this.phase
    if (!this.onHud) return
    const h = this.hud()
    if (h) this.onHud(h)
    void force
  }

  hud(): Hud | null {
    const r = this.round
    if (!r) return null
    const ctx = r.ctx
    const me = r.toys.find((t) => t.c.idx === this.meIdx) ?? null
    const level = r.level
    const aim = this.aimTarget(r, me)
    const galleryMe = this.gallery(r) && r.setup.mode === 'show'
    const tricks: TrickHud[] = []
    if (me && me.status === 'play' && this.phase !== 'loft') {
      this.visibleTricks(r, me).forEach((def, i) => {
        const tgt = def.target === 'rival' ? aim : null
        const { cost, revenge } = trickPrice(def, me, tgt)
        const cd = me.cooldowns.get(def.id) ?? 0
        let reason = ''
        if (this.phase !== 'play') reason = 'Not yet'
        else if (me.busy > 0) reason = 'Busy'
        else if (cd > 0) reason = 'Cooling down'
        else if (def.once && me.usedOnce.has(def.id)) reason = 'Used'
        else if (me.sprinkles < cost) reason = `Need ${cost}`
        else {
          const c = def.can?.(ctx, r.state, me, tgt)
          if (c !== undefined && c !== true) reason = c
        }
        tricks.push({
          id: def.id, name: def.name, icon: def.icon, cost: def.cost, price: cost, revenge, cd, cooldown: def.cooldown, ready: !reason, reason, desc: def.desc, counter: def.counter, key: i + 1,
        })
      })
    }
    const g = r.sab.gallery.get(this.meIdx)
    const ammo = galleryMe && g
      ? r.sab.throwables().map((k) => ({ kind: k, name: THROW_INFO[k].name, n: g.ammo[k], ready: g.ammo[k] > 0 && g.cd <= 0 && this.phase === 'play', desc: THROW_INFO[k].desc }))
      : []
    const spec = (!me || me.status !== 'play') && r.toys[this.spec] ? r.toys[this.spec].name : null
    let roundEnd: Hud['roundEnd'] = null
    if (this.phase === 'end' && r.setup.mode === 'show') {
      roundEnd = { through: r.toys.filter((t) => t.status === 'qualified').map((t) => t.name), out: r.toys.filter((t) => t.status === 'failed').map((t) => t.name) }
    }
    const tricksInfo = (level.tricks ?? []).filter((t: TrickDef<unknown>) => (t.minSpice ?? 0) <= r.setup.settings.spice).map((t: TrickDef<unknown>) => ({ name: t.name, cost: t.cost, desc: t.desc, counter: t.counter, icon: t.icon }))
    return {
      phase: this.phase,
      phaseLeft: this.phase === 'intro' ? INTRO - this.phaseT : this.phase === 'countdown' ? COUNTDOWN - this.phaseT : this.phase === 'end' ? END - this.phaseT : 0,
      mode: r.setup.mode,
      role: this.role,
      level: level.type === 'hub' ? null : { id: level.id, name: level.name, type: level.type, blurb: level.blurb, howTo: level.howTo, accent: level.accent, tricks: tricksInfo, resource: level.sprinkles?.name ?? 'Sprinkles' },
      round: { index: r.setup.index, total: r.setup.total, final: r.setup.final },
      target: r.setup.target,
      qualified: ctx.qualifiedCount(),
      active: ctx.active().length,
      field: r.toys.length,
      timeLeft: this.phase === 'play' ? ctx.timeLeft : level.duration,
      countdown: this.phase === 'countdown' ? Math.ceil(COUNTDOWN - this.phaseT) : 0,
      me: {
        status: me ? me.status : galleryMe ? 'gallery' : 'none',
        sprinkles: me?.sprinkles ?? 0,
        busy: me?.busy ?? 0,
        grudge: me?.grudge && me.grudge.status === 'play' ? me.grudge.name : null,
        bubble: !!me?.bubble,
        name: this.roster[this.meIdx]?.name ?? this.look.name,
        tint: this.roster[this.meIdx]?.tint ?? this.look.tint,
      },
      spectating: spec,
      tricks,
      ammo,
      aim: aim ? { name: aim.name, grudge: !!me && me.grudge === aim } : null,
      levelHud: level.hud ? level.hud(ctx, r.state, me) : null,
      feed: this.feedList.map((f) => ({ id: f.id, text: f.text })),
      banner: this.banner ? { id: this.banner.id, text: this.banner.text, color: this.banner.color } : null,
      roundEnd,
      results: this.phase === 'results' ? this.results : null,
      roster: this.roster.map((c) => ({ idx: c.idx, name: c.name, tint: c.tint, kind: c.kind, human: c.human, me: c.idx === this.meIdx, out: c.out })),
      online: this.opts.net ? { code: this.opts.net.link.code, role: this.opts.net.role, people: this.roster.filter((c) => c.human).length } : null,
      pointer: (level.pointer ?? 'look') === 'free' && this.phase !== 'loft' ? 'free' : 'look',
      locked: this.input.locked,
      touch: coarse(),
      zone: this.zone,
      quality: this.quality,
    }
  }

  /** The page changed your look (name / toy / tint / outfit). Re-dresses your toy here and on every screen. */
  setLook(look: Look) {
    this.look = look
    if (this.role === 'client') {
      this.send({ t: 'pp-look', look })
      return
    }
    const me = this.roster[this.meIdx]
    if (me) this.applyLook(me, look)
  }

  /** Host: a contestant's look changed. Re-dress their toy in place (the Loft keeps running) and tell clients. */
  private applyLook(c: Contestant, look: Look) {
    c.name = look.name.slice(0, 16) || c.name
    c.tint = look.tint
    if ((this.opts.assets.kinds as string[]).includes(look.kind)) c.kind = look.kind as ToyKind
    c.outfit = cleanOutfit(look.outfit)
    const r = this.round
    const t = r?.toys.find((x) => x.c === c)
    if (r && t) this.restyle(r, t)
    if (this.role === 'host') this.send({ t: 'pp-roster', roster: this.rosterRows(), settings: this.settings })
  }

  /** Swap a toy's rig for one in its contestant's current look (kind, tint, outfit), keeping where it stands. */
  private restyle(r: Round, t: Toy) {
    const old = t.rig
    const c = t.c
    const same = old && old.kind === c.kind && old.color.getHex() === _col.set(c.tint).getHex() && old.root.userData.outfit === outfitKey(c.outfit)
    if (!same) {
      const rig = new ToyRig(this.opts.assets, c.kind, c.tint, this.shadowsOn)
      dressRig(rig, c.outfit, this.opts.assets)
      if (old) {
        rig.root.position.copy(old.root.position)
        rig.root.rotation.y = old.root.rotation.y
        const i = r.rigs.indexOf(old)
        if (i >= 0) r.rigs[i] = rig
        else r.rigs.push(rig)
        old.dispose()
      } else r.rigs.push(rig)
      r.root.add(rig.root, rig.ball)
      t.rig = rig
      if (t.data.crowned) {
        t.data.crowned = false
        this.crown(t)
      }
    }
    const tag = r.tags[t.idx]
    if (tag) {
      tag.name.textContent = t.isMe ? `${t.name} (you)` : t.name
      tag.el.style.setProperty('--pp-tint', t.c.tint === '#ffffff' ? '#fde68a' : t.c.tint)
    }
  }

  setSettings(s: ShowSettings) {
    this.settings = { ...s }
    if (this.role === 'host') this.send({ t: 'pp-roster', roster: this.rosterRows(), settings: this.settings })
  }

  setAutopilot(on: boolean) {
    this.autopilot = on
    const me = this.round?.toys.find((t) => t.c.idx === this.meIdx)
    if (me) me.bot = on || !me.c.human
  }


  /* ================= Online ================= */

  private send(m: PlushMsg, to?: string) {
    this.opts.net?.link.send(m, to)
  }

  private listen(net: NetSession) {
    const link = net.link
    this.unsub.push(
      link.onMessage((raw, from) => {
        if (!isPlushMsg(raw)) return
        const m = raw
        if (this.role === 'host') this.hostMsg(m, from)
        else this.clientMsg(m)
      }),
      link.onPeer((ev, id) => {
        if (this.role === 'client') {
          if (ev === 'leave' && id === 'host') this.onDisconnect?.('The host closed the room.')
          return
        }
        if (ev !== 'leave') return
        this.remote.delete(id)
        const c = this.roster.find((x) => x.id === id)
        if (!c) return
        if (this.phase === 'loft') {
          this.roster = this.roster.filter((x) => x !== c).map((x, i) => ({ ...x, idx: i }))
          this.startHub()
        } else {
          // A bot takes over for a player who left mid-Show.
          c.human = false
          const t = this.round?.toys.find((x) => x.c === c)
          if (t) t.bot = true
          this.fxApi.feed(`${c.name} left · a bot takes over`)
        }
      }),
    )
  }

  private hostMsg(m: PlushMsg, from: string) {
    if (m.t === 'pp-hello') {
      const people = this.roster.filter((c) => c.human).length
      if (this.phase !== 'loft') {
        this.send({ t: 'pp-busy', why: 'A Show is running in that room. Try again when it is back in the Loft.' }, from)
        return
      }
      if (people >= 8) {
        this.send({ t: 'pp-busy', why: 'That room is full.' }, from)
        return
      }
      // Replace one ambient bot with the new player (two "Stitchling"s become "Stitchling" and "Stitchling 2").
      const humans = this.roster.filter((c) => c.human && c.id !== from)
      const c = this.contestant(humans.length, from, m.look, true)
      const taken = new Set(humans.map((h) => h.name))
      for (let n = 2; taken.has(c.name); n++) c.name = `${m.look.name.slice(0, 13) || 'Stitchling'} ${n}`
      this.roster = [...humans, c].map((x, i) => ({ ...x, idx: i }))
      this.meIdx = 0
      this.remote.set(from, { pad: emptyPad(), pos: null, acts: [], last: performance.now() })
      this.buildRosterKeepHumans()
      this.startHub()
      this.send({ t: 'pp-roster', roster: this.rosterRows(), settings: this.settings })
    } else if (m.t === 'pp-look') {
      const c = this.roster.find((x) => x.id === from)
      if (!c || !m.look || typeof m.look.name !== 'string') return
      this.applyLook(c, m.look)
    } else if (m.t === 'pp-in') {
      let rm = this.remote.get(from)
      if (!rm) {
        rm = { pad: emptyPad(), pos: null, acts: [], last: performance.now() }
        this.remote.set(from, rm)
      }
      const p = m.p
      rm.pad.mx = clamp1(p[0])
      rm.pad.mz = clamp1(p[1])
      rm.pad.yaw = p[2]
      rm.pad.grab = (p[3] & 1) > 0
      rm.pad.down = (p[3] & 2) > 0
      rm.pad.px = p[4]
      rm.pad.pz = p[5]
      rm.pos = p.length >= 10 ? [p[6], p[7], p[8], p[9]] : null
      rm.acts.push(...m.a.slice(0, 12))
      rm.last = performance.now()
    }
  }

  /** Keep the people, refill ambient bots for the Loft. */
  private buildRosterKeepHumans() {
    const humans = this.roster.filter((c) => c.human)
    this.roster = humans
    this.buildRosterFrom(humans)
  }

  private buildRosterFrom(humans: Contestant[]) {
    const roster = humans.map((c, i) => ({ ...c, idx: i }))
    const total = Math.min(roster.length + Math.max(0, Math.min(this.settings.size - roster.length, 5)), 12)
    const taken = new Set(roster.map((p) => p.name))
    const rng = makeRng(roster.length * 31 + 7)
    for (let i = roster.length; i < total; i++) {
      const name = botName(i * 7 + rng.int(0, 20), taken)
      taken.add(name)
      roster.push(this.contestant(i, `bot-${i}`, { name, kind: rng.pick(this.opts.assets.kinds.length ? this.opts.assets.kinds : ['sock']), tint: rng.pick(TINTS.slice(1)), outfit: randomOutfit(() => rng.next()) }, false))
    }
    this.roster = roster
  }

  private clientMsg(m: PlushMsg) {
    const link = this.opts.net!.link
    if (m.t === 'pp-round') {
      if (!this.ready) {
        this.pendingRound = m
        return
      }
      this.applyRoster(m.roster)
      this.results = null
      this.snap = null
      this.beginRound(m.r)
    } else if (m.t === 'pp-roster') {
      this.applyRoster(m.roster)
      this.settings = { ...m.settings }
    } else if (m.t === 'pp-snap') {
      this.snap = { s: m.s as Snap, at: performance.now() }
      for (const e of m.e as NetEv[]) if (e.to === undefined || e.to === this.meIdx) this.playFx(e)
    } else if (m.t === 'pp-results') {
      this.results = m.r
      this.phase = 'results'
      this.phaseT = 0
      const r = this.round
      const champ = r?.toys.find((t) => t.c.idx === m.r.order[0])
      if (champ && !m.r.quick) this.crown(champ)
      this.saveEarnings(m.r)
    } else if (m.t === 'pp-busy') {
      this.onDisconnect?.(m.why)
    }
    void link
  }

  private applyRoster(rows: RosterRow[]) {
    const link = this.opts.net!.link
    this.roster = rows.map((row) => ({ ...row, kind: row.kind as ToyKind, outfit: cleanOutfit(row.outfit), place: 0, stats: this.roster.find((c) => c.id === row.id)?.stats ?? freshStats() }))
    const mine = this.roster.find((c) => c.id === link.selfId)
    this.meIdx = mine ? mine.idx : -1
    // Looks changed in the round we're in (someone at the Sewing Table): re-dress those toys in place.
    const r = this.round
    if (!r) return
    for (const t of r.toys) {
      const c = this.roster.find((x) => x.id === t.c.id)
      if (!c) continue
      t.c.name = c.name
      t.c.kind = c.kind
      t.c.tint = c.tint
      t.c.outfit = c.outfit
      this.restyle(r, t)
    }
  }

  /** Say hello to the host (client). */
  hello() {
    this.send({ t: 'pp-hello', look: this.look })
  }

  private buildSnap(r: Round): Snap {
    const tricks = this.visibleTricksAll(r)
    return {
      ph: PHASES.indexOf(this.phase),
      pt: r2(this.phaseT),
      ck: r2(this.clock),
      t: r.toys.map((t) => {
        let flags = 0
        if (t.grounded) flags |= 1
        if (t.mode === 'ball') flags |= 2
        if (t.mode === 'seated') flags |= 4
        if (t.status === 'qualified') flags |= 8
        if (t.status === 'failed') flags |= 16
        if (t.bubble) flags |= 32
        if (t.forced > 0 || t.grabbedBy || t.stun > 0) flags |= 64
        if (!t.body.isEnabled()) flags |= 128
        if (t.frozen) flags |= 256
        let once = 0
        tricks.forEach((d, i) => {
          if (t.usedOnce.has(d.id)) once |= 1 << i
        })
        return [
          r2(t.pos.x), r2(t.pos.y), r2(t.pos.z), r2(t.yaw), r2(t.vel.x), r2(t.vel.y), r2(t.vel.z), ANIMS.indexOf(t.anim), flags, r2(t.stun), t.sprinkles, r2(t.busy),
          t.grudge ? t.grudge.idx : -1, r2(t.popped), once, ...tricks.map((d) => r2(t.cooldowns.get(d.id) ?? 0)),
        ]
      }),
      l: r.level.pack ? r.level.pack(r.ctx, r.state) : null,
      h: r.hazards.pack(),
      p: r.props.map((p) => {
        const tr = p.body.translation(), q = p.body.rotation()
        return [r2(tr.x), r2(tr.y), r2(tr.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]
      }),
      g: [...r.sab.gallery.entries()].map(([idx, g]) => [idx, g.ammo.crumb, g.ammo.paper, g.ammo.feather, r2(g.cd)]),
    }
  }

  private visibleTricksAll(r: Round): TrickDef<unknown>[] {
    return (r.level.tricks ?? []).filter((t: TrickDef<unknown>) => (t.minSpice ?? 0) <= r.setup.settings.spice)
  }

  /** Online client: send controls, apply the latest snapshot, predict our own toy. */
  private clientUpdate(dt: number, r: Round) {
    const me = r.toys.find((t) => t.c.idx === this.meIdx) ?? null
    // Send the pad.
    if (this.padFlags.jump) this.pending.push('jump')
    if (this.padFlags.dive) this.pending.push('dive')
    if (this.padFlags.shove) this.pending.push('shove')
    if (this.padFlags.act) this.pending.push('act')
    if (this.padFlags.emote) this.pending.push(`emote:${this.padFlags.emote}`)
    const local = Object.assign(this.localFlags, this.padFlags)
    this.padFlags.jump = this.padFlags.dive = this.padFlags.shove = this.padFlags.act = false
    this.padFlags.emote = ''
    this.inputT -= dt
    if (this.inputT <= 0 || this.pending.length) {
      this.inputT = 1 / INPUT_HZ
      const p = this.myPad
      const flags = (p.grab ? 1 : 0) | (p.down ? 2 : 0)
      const msg = [r3(p.mx), r3(p.mz), r3(p.yaw), flags, r3(p.px), r3(p.pz)]
      if (me) msg.push(r2(me.pos.x), r2(me.pos.y), r2(me.pos.z), r2(me.yaw))
      this.send({ t: 'pp-in', p: msg, a: this.pending })
      this.pending = []
    }

    // Apply the host's state.
    const S = this.snap
    let predict = false
    if (S) {
      const s = S.s
      const age = Math.min(0.25, (performance.now() - S.at) / 1000)
      const ph = PHASES[s.ph] ?? 'loft'
      if (ph !== this.phase && this.phase !== 'results') {
        if (ph === 'play' && this.phase === 'countdown') this.audio.play('go')
        this.phase = ph
      }
      this.phaseT = s.pt + age
      const playing = ph === 'play' || ph === 'loft'
      this.clock = s.ck + (playing ? age : 0)
      const tricks = this.visibleTricksAll(r)
      s.t.forEach((row, i) => {
        const t = r.toys[i]
        if (!t) return
        const flags = row[8]
        const mode: BodyMode = flags & 2 ? 'ball' : flags & 4 ? 'seated' : 'walk'
        if (mode !== t.mode) {
          t.setMode(r.phys, mode)
          if (!t.isMe) t.setPuppet(true)
        }
        t.status = flags & 16 ? 'failed' : flags & 8 ? 'qualified' : 'play'
        t.bubble = (flags & 32) > 0
        t.frozen = (flags & 256) > 0
        const disabled = (flags & 128) > 0
        if (disabled === t.body.isEnabled()) t.body.setEnabled(!disabled)
        t.anim = ANIMS[row[7]] ?? 'idle'
        t.stun = row[9]
        t.sprinkles = row[10]
        t.busy = row[11]
        t.grudge = row[12] >= 0 ? (r.toys[row[12]] ?? null) : null
        t.popped = row[13]
        tricks.forEach((d, k) => {
          t.cooldowns.set(d.id, row[15 + k] ?? 0)
          if (row[14] & (1 << k)) t.usedOnce.add(d.id)
          else t.usedOnce.delete(d.id)
        })
        const tx = row[0] + row[4] * age, ty = row[1] + Math.max(-2, row[5]) * age * 0.5, tz = row[2] + row[6] * age
        const forced = (flags & 64) > 0
        if (t.isMe && playing && t.status === 'play' && mode !== 'seated' && !forced && Math.hypot(t.pos.x - tx, t.pos.z - tz) < 3.5) {
          predict = true
          return
        }
        if (t.isMe && mode !== 'seated') {
          // The host is pushing us: follow it closely.
          const far = Math.hypot(t.pos.x - tx, t.pos.y - ty, t.pos.z - tz) > 3
          const k = far ? 1 : Math.min(1, dt * 14)
          const nx = t.pos.x + (tx - t.pos.x) * k, ny = t.pos.y + (ty - t.pos.y) * k, nz = t.pos.z + (tz - t.pos.z) * k
          t.body.setTranslation({ x: nx, y: ny, z: nz }, true)
          t.body.setLinvel({ x: row[4], y: row[5], z: row[6] }, true)
          t.pos.set(nx, ny, nz)
          t.vel.set(row[4], row[5], row[6])
          t.yaw = row[3]
          return
        }
        const far = Math.hypot(t.pos.x - tx, t.pos.y - ty, t.pos.z - tz) > 4
        const k = far ? 1 : Math.min(1, dt * 15)
        t.pos.set(t.pos.x + (tx - t.pos.x) * k, t.pos.y + (ty - t.pos.y) * k, t.pos.z + (tz - t.pos.z) * k)
        t.vel.set(row[4], row[5], row[6])
        t.grounded = (flags & 1) > 0
        let dy = row[3] - t.yaw
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        t.yaw += dy * Math.min(1, dt * 12)
        if (t.body.isKinematic()) t.body.setNextKinematicTranslation({ x: t.pos.x, y: t.pos.y, z: t.pos.z })
      })
      if (s.l !== null && r.level.unpack) r.level.unpack(r.ctx, r.state, s.l)
      if (s.h) r.hazards.unpack(s.h)
      s.p.forEach((row, i) => {
        const p = r.props[i]
        if (!p) return
        p.body.setNextKinematicTranslation({ x: row[0], y: row[1], z: row[2] })
        p.body.setNextKinematicRotation({ x: row[3], y: row[4], z: row[5], w: row[6] })
      })
      for (const row of s.g) {
        let g = r.sab.gallery.get(row[0])
        if (!g) {
          r.sab.joinGallery(this.roster[row[0]] ?? ({ idx: row[0] } as Contestant))
          g = r.sab.gallery.get(row[0])!
        }
        g.ammo.crumb = row[1]
        g.ammo.paper = row[2]
        g.ammo.feather = row[3]
        g.cd = row[4]
      }
    }

    // Predict our own toy with the local physics world (fixed steps).
    this.acc += dt
    let steps = 0
    const quiet = this.events(r).quiet
    while (this.acc >= STEP && steps < 8) {
      this.acc -= STEP
      steps++
      if (me && predict && !me.body.isKinematic()) {
        Object.assign(me.pad, this.myPad)
        if (steps === 1) Object.assign(me.pad, local)
        me.preStep(STEP, r.phys, [], quiet, !(this.phase === 'play' || this.phase === 'loft'))
        r.hazards.affect(r.ctx, [me], STEP, true)
      }
      r.hazards.update(r.ctx, this.clock, STEP)
      r.phys.step()
      if (me && predict) me.postStep(STEP, r.phys, quiet)
      if (me) clearOneShots(me.pad)
    }
    if (steps === 8) this.acc = 0
  }

  /* ================= Test hooks ================= */

  /** A JSON-friendly summary for tests. */
  debug() {
    const r = this.round
    return {
      role: this.role,
      code: this.opts.net?.link.code ?? null,
      phase: this.phase,
      clock: r2(this.clock),
      level: r?.level.id ?? null,
      mode: r?.setup.mode ?? null,
      round: r ? { index: r.setup.index, total: r.setup.total, final: r.setup.final, target: r.setup.target } : null,
      meIdx: this.meIdx,
      toys: r
        ? r.toys.map((t) => ({
            idx: t.idx, c: t.c.idx, name: t.name, human: t.c.human, afk: this.afk(t), status: t.status, x: r2(t.pos.x), y: r2(t.pos.y), z: r2(t.pos.z), sprinkles: t.sprinkles, mode: t.mode,
            grudge: t.grudge ? t.grudge.idx : -1, bubble: t.bubble, busy: r2(t.busy), stun: r2(t.stun), note: t.doneNote,
          }))
        : [],
      roster: this.roster.map((c) => ({ idx: c.idx, id: c.id, name: c.name, human: c.human, out: c.out, outRound: c.outRound, place: c.place, stats: { ...c.stats } })),
      gallery: r ? [...r.sab.gallery.entries()].map(([idx, g]) => ({ idx, ...g.ammo, cd: r2(g.cd) })) : [],
      results: this.results,
      plan: this.plan,
      feed: this.feedList.map((f) => f.text),
      quality: this.quality,
    }
  }

  /** The current level's state (tests read level rules through this). */
  levelState() {
    return this.round?.state ?? null
  }

  /** Tests: act as a given toy (index in this round). */
  debugTrick(toyIdx: number, id: string, targetIdx: number) {
    const r = this.round
    if (!r) return 'no round'
    const t = r.toys[toyIdx]
    if (!t) return 'no toy'
    return r.sab.use(t, id, targetIdx)
  }

  debugGive(toyIdx: number, sprinkles: number) {
    const t = this.round?.toys[toyIdx]
    if (t) t.sprinkles = sprinkles
  }

  debugThrow(contestant: number, kind: ThrowKind, targetIdx: number) {
    const r = this.round
    if (!r) return 'no round'
    const c = this.roster[contestant]
    if (!c) return 'no contestant'
    r.sab.joinGallery(c)
    return r.sab.throw(c, kind, targetIdx)
  }

  /** Tests: give any contestant a look (kind, tint, outfit) as if they'd changed it at the Sewing Table (host). */
  debugLook(contestant: number, look: Partial<Look>) {
    const c = this.roster[contestant]
    if (!c || this.role === 'client') return false
    this.applyLook(c, { name: c.name, kind: c.kind, tint: c.tint, outfit: c.outfit, ...look })
    return true
  }

  /** Tests: the toy object (for poking at physics). */
  debugToy(i: number) {
    return this.round?.toys[i] ?? null
  }

  get ctx(): LevelCtx | null {
    return this.round?.ctx ?? null
  }

  /** Spice and throwables for the HUD. */
  static throwKinds = THROW_KINDS
}

interface Snap {
  ph: number
  pt: number
  ck: number
  t: number[][]
  l: unknown
  h: unknown
  p: number[][]
  g: number[][]
}

const coarse = () => {
  try {
    return matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
const clamp1 = (x: number) => Math.max(-1, Math.min(1, Number(x) || 0))

/** Free a level's GPU resources, skipping anything shared with the cached assets. */
function disposeTree(root: THREE.Object3D, assets: PlushAssets) {
  const keepGeo = new Set<THREE.BufferGeometry>()
  const keepMat = new Set<THREE.Material>()
  const keepTex = new Set<THREE.Texture>(Object.values(assets.tex))
  const collect = (o: THREE.Object3D) =>
    o.traverse((x) => {
      const m = x as THREE.Mesh
      if (!m.isMesh) return
      keepGeo.add(m.geometry)
      for (const mt of Array.isArray(m.material) ? m.material : [m.material]) keepMat.add(mt)
    })
  for (const p of Object.values(assets.props)) if (p) collect(p)
  for (const t of Object.values(assets.toys)) if (t) collect(t.scene)
  for (const c of Object.values(assets.cosmetics ?? {})) if (c) collect(c)
  // Anything marked userData.keep (shared cosmetic pieces, cached level materials) survives too.
  root.traverse((x) => {
    const m = x as THREE.Mesh
    if (!m.isMesh && !(x as THREE.Sprite).isSprite && !(x as THREE.Points).isPoints) return
    if (m.geometry && !keepGeo.has(m.geometry) && !m.geometry.userData.keep) m.geometry.dispose()
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mt of mats) {
      if (!mt || keepMat.has(mt) || mt.userData.keep) continue
      const map = (mt as THREE.MeshStandardMaterial).map
      if (map && !keepTex.has(map) && !keepTex.has(map.source as unknown as THREE.Texture)) map.dispose()
      mt.dispose()
    }
  })
}
