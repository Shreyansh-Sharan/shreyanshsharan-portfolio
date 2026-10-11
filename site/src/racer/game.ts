// VOLT RIOT engine: scene, race flow, input, scoring (Fan Points and Combat Points), camera, HUD feed and netcode.
// Roles: 'solo' simulates everything; 'host' simulates and streams snapshots; 'client' predicts its own car,
// interpolates the rest from snapshots and sends inputs to the host.
import * as THREE from 'three'
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CONFIG, kmh, toKmh } from './config'
import { CARS, DRIVERS, radialTexture, type CarModel } from './cars'
import { Car } from './car'
import { Track, buildTrackScene, mulberry32, POWER_COLORS, type PowerType } from './track'
import type { RacerAssets } from './assets'
import { Particles, Trail, glyphTexture, fanRunTexture } from './fx'
import { RacerAudio } from './audio'
import { aiDrive } from './ai'
import {
  PROJECTILE_KINDS, animateDome, bargeRing, domeVisual, fire, fireBolt, incomingShunt, lockTarget, projectileVisual,
  removeProjectileVisual, updateRings, updateWeapons, type Dome, type Projectile, type Ring,
} from './weapons'
import type { Link, MatchSetup, Msg, Slot } from './net'

export type Mode = 'race' | 'combat' | 'deathmatch'
export type Phase = 'intro' | 'countdown' | 'race' | 'finished'
export type Weapon = PowerType | 'wall' | 'ram'
type Role = 'solo' | 'host' | 'client'
const PHASES: Phase[] = ['intro', 'countdown', 'race', 'finished']
const STUNS = ['none', 'spin', 'flip'] as const

export interface GameOptions {
  mode: Mode
  carId: string
  difficulty: number // 0 Easy, 1 Normal, 2 Hard
  round: number // Combat Points track index (0-based)
  autopilot?: boolean
  assets?: RacerAssets
  laps?: number
  minutes?: number // Deathmatch time limit
  bots?: number // AI rivals in a solo race
  net?: { link: Link; setup: MatchSetup }
}

export interface Pickup {
  s: number
  lateral: number
  row: number
  type: PowerType
  available: boolean
  timer: number
  pos: THREE.Vector3
  group: THREE.Group
}

interface FanRunIcon {
  s: number
  lap: number
  state: 'waiting' | 'taken' | 'missed'
  group: THREE.Group
}

type FanRunKind = 'drift' | 'shunt' | 'hit' | 'pickups'
const FAN_RUN_LABEL: Record<FanRunKind, string> = {
  drift: 'Drift 100 m',
  shunt: 'Land a Shunt',
  hit: 'Hit a rival with any weapon',
  pickups: 'Hit 3 pickups in a row',
}

interface InputState {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
  look: boolean
  fireHeld: boolean
  fireBackHeld: boolean
  actions: string[]
}

const IDLE: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, look: false, fireHeld: false, fireBackHeld: false, actions: [] }

/** Events shown to one player (popups, banners, hit flashes); sent to remote players by the host. */
type UiEvent = ['pop', string, string] | ['say', string, string, number] | ['hit', string, number] | ['slow', number] | ['sfx', string] | ['shake', number]

export interface HudPopup {
  id: number
  text: string
  color: string
  age: number
}

export interface Hud {
  mode: Mode
  phase: Phase
  countdown: number
  intro: string[]
  place: number
  cars: number
  lap: number
  laps: number
  speed: number
  nitro: number
  boosting: boolean
  health: number
  shield: number
  invuln: boolean
  wrecked: number
  bay: ({ type: PowerType; count: number } | null)[]
  active: number
  reticle: { x: number; y: number; name: string } | null
  incoming: number | null // radians, 0 = ahead
  popups: HudPopup[]
  fans: number
  fanTarget: number
  fanRun: { label: string; progress: number; goal: number; time: number } | null
  killFeed: { id: number; text: string; mine: boolean }[]
  chain: { mult: number; time: number } | null
  combat: { score: number; timeLeft: number; leader: string; leaderScore: number } | null
  banner: { text: string; color: string } | null
  hitFlash: string | null
  hitFlashAmt: number
  lookBack: boolean
  paused: boolean
  online: boolean
}

export interface ResultRow {
  name: string
  car: string
  place: number
  time: number | null
  combat: number
  wrecks: number
  isPlayer: boolean
  human: boolean
  color: string
}

export interface RaceResult {
  mode: Mode
  round: number
  track: string
  rows: ResultRow[]
  place: number
  fans: number
  fanTargetMet: boolean
  fanRunsDone: number
  fanRunsTotal: number
  lights: { position: number; fanTarget: number; fanRuns: number; total: number }
  awards: { title: string; name: string; value: string }[]
  combat: Record<string, number> // driver name -> points this track
  online: boolean
}

const KEYMAP: Record<string, string> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake', ShiftLeft: 'fire', ShiftRight: 'fire', KeyJ: 'fire', KeyK: 'fireBack', Tab: 'cycle', KeyQ: 'cycle',
  KeyX: 'discard', KeyC: 'look', Escape: 'pause', KeyP: 'pause', KeyR: 'reset', KeyM: 'music', Enter: 'skip',
}

const RACE_WEIGHTS: Partial<Record<PowerType, number>> = { shunt: 18, nitro: 18, mine: 16, bolt: 14, barge: 12, shield: 9, shock: 6, repair: 6 }
const SUPPORT_WEIGHTS: Partial<Record<PowerType, number>> = { repair: 1, shield: 1 }
const POWER_TYPES: PowerType[] = ['shunt', 'barge', 'bolt', 'mine', 'shock', 'nitro', 'shield', 'repair']

function pick(weights: Partial<Record<PowerType, number>>, rnd: () => number) {
  const entries = Object.entries(weights) as [PowerType, number][]
  let total = 0
  for (const [, w] of entries) total += w
  let r = rnd() * total
  for (const [t, w] of entries) {
    r -= w
    if (r <= 0) return t
  }
  return entries[0][0]
}

const r2 = (v: number) => Math.round(v * 100) / 100
const TRACK_NAMES = ['Harbor Loop', 'Harbor Loop Reverse', 'Harbor Loop Overdrive']

export class Game {
  readonly opts: GameOptions
  readonly mode: Mode
  readonly role: Role
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.3, 2400)
  readonly composer: EffectComposer
  readonly track: Track
  readonly audio = new RacerAudio()
  readonly fx = new Particles(1800, true)
  readonly smoke = new Particles(900, false)
  cars: Car[] = []
  player!: Car
  pickups: Pickup[] = []
  projectiles: Projectile[] = []
  domes: Dome[] = []
  rings: Ring[] = []
  phase: Phase = 'intro'
  laps: number
  readonly timeLimit: number
  paused = false
  onHud: ((h: Hud) => void) | null = null
  onFinish: ((r: RaceResult) => void) | null = null
  onPause: ((p: boolean) => void) | null = null
  onDisconnect: ((reason: string) => void) | null = null
  minimap: HTMLCanvasElement | null = null

  private link: Link | null = null
  private unsubs: (() => void)[] = []
  private remote = new Map<string, InputState>()
  private fxLog: unknown[] = []
  private uiOut = new Map<string, UiEvent[]>()
  private snapTimer = 0
  private inputTimer = 0
  private lastSent = ''
  private launched = new Set<Car>()
  private firstHumanFinish = -1
  private netProjectiles = new Map<number, Projectile>()
  private netDomes = new Map<number, Dome>()
  private gotSnapshot = false

  private container: HTMLElement
  private raf = 0
  private last = 0
  private time = 0
  private raceTime = 0
  private phaseTime = 0
  private slowmo = 0
  private shakeAmt = 0
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private padPrev: boolean[] = []
  private steerSmooth = 0
  private lookBack = false
  private throttleEdgeAt: number | null = null
  private throttleWasDown = false
  private popups: HudPopup[] = []
  private popupId = 0
  private killFeed: { id: number; text: string; mine: boolean; age: number }[] = []
  private banner: { text: string; color: string; t: number } | null = null
  private hitFlash: { color: string; t: number } | null = null
  private fanIcons: FanRunIcon[] = []
  private fanRun: { kind: FanRunKind; goal: number; progress: number; time: number } | null = null
  private fanRunsDone = 0
  private fanRunsTotal = 0
  private pickupStreak = 0
  private nextRow = 0
  private rows: number[] = []
  private rowHit = new Set<number>()
  private multi = new Map<string, number>()
  private ramCooldown = new Map<string, number>()
  private nearMiss = new Map<number, number>()
  private refuseCooldown = 0
  private finishOrder: Car[] = []
  private resultSent = false
  private nitroTrails = new Map<Car, Trail[]>()
  private introLines: string[] = []
  private mapBounds = { minX: 0, minZ: 0, scale: 1 }
  private ro: ResizeObserver
  private camPos = new THREE.Vector3()
  private camLook = new THREE.Vector3()
  private hidden = () => {
    if (document.hidden && this.phase !== 'finished' && this.role === 'solo') this.setPaused(true)
  }

  constructor(container: HTMLElement, opts: GameOptions) {
    this.container = container
    this.opts = opts
    this.mode = opts.mode
    this.role = opts.net ? (opts.net.link.isHost ? 'host' : 'client') : 'solo'
    this.link = opts.net?.link ?? null
    this.laps = opts.mode === 'deathmatch' ? Infinity : opts.mode === 'combat' ? CONFIG.combat_laps : (opts.laps ?? CONFIG.race_laps)
    this.timeLimit =
      opts.mode === 'deathmatch' ? (opts.minutes ?? CONFIG.deathmatch_minutes) * 60 : opts.mode === 'combat' ? CONFIG.combat_track_time_limit : Infinity

    // Renderer and post-processing: bloom does the neon, tone mapping happens at the end of the chain.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'racer-canvas'
    container.appendChild(this.renderer.domElement)
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 })
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new BloomEffect({ luminanceThreshold: 0.75, luminanceSmoothing: 0.2, intensity: 1.35, mipmapBlur: true, radius: 0.7 }),
        new VignetteEffect({ darkness: 0.5, offset: 0.3 }),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      ),
    )

    // Night sky, fog, moonlight and a dim reflection environment for the paint.
    this.scene.background = new THREE.Color('#0b0820')
    this.scene.fog = new THREE.Fog('#0b0820', 140, 1100)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.35
    pmrem.dispose()
    this.scene.add(new THREE.HemisphereLight('#6b7bff', '#1a0b2a', 0.75))
    const moon = new THREE.DirectionalLight('#c7d2ff', 1.1)
    moon.position.set(-300, 400, 200)
    this.scene.add(moon)
    this.scene.add(skyDome())

    const round = opts.round
    this.track = new Track(opts.mode === 'combat' ? TRACK_NAMES[round % 3] : 'Harbor Loop', opts.mode === 'combat' && round % 3 === 1)
    buildTrackScene(this.track, this.scene, opts.assets)
    this.scene.add(this.fx.points, this.smoke.points)

    this.spawnCars()
    this.spawnPickups()
    if (this.mode === 'race' && this.role === 'solo') this.spawnFanRuns()
    this.prepareMinimap()
    this.introLines = this.makeIntro()
    this.attachNet()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.hidden)
  }

  get armed() {
    return this.mode !== 'race'
  }

  get online() {
    return this.role !== 'solo'
  }

  /* ---------- Setup ---------- */

  private slots(): Slot[] {
    if (this.opts.net) return this.opts.net.setup.slots
    // Solo: the rivals, with the player mid-grid.
    const bots = this.mode === 'race' ? THREE.MathUtils.clamp(this.opts.bots ?? CONFIG.race_cars - 1, 0, DRIVERS.length) : CONFIG.race_cars - 1
    const list: Slot[] = DRIVERS.slice(0, bots).map((d, i) => ({ kind: 'ai', id: `ai-${i}`, name: d.name, carId: d.car, driver: i }))
    list.splice(Math.min(list.length, Math.floor((bots + 1) / 2)), 0, { kind: 'human', id: 'host', name: 'You', carId: this.opts.carId })
    return list
  }

  private spawnCars() {
    const slots = this.slots()
    const localId = this.link?.selfId ?? 'host'
    const local = slots.find((s) => s.kind === 'human' && s.id === localId) ?? slots[0]
    const cls = (CARS.find((c) => c.id === local.carId) ?? CARS[0]).cls
    const skill = this.mode === 'combat' ? CONFIG.ai_combat_skill : CONFIG.ai_skill[this.opts.difficulty] ?? 0.6
    const rnd = mulberry32(42 + this.opts.round)
    slots.forEach((slot, i) => {
      const model: CarModel = CARS.find((c) => c.id === slot.carId) ?? CARS[i % CARS.length]
      const isLocal = slot === local
      const driver = slot.kind === 'ai' ? DRIVERS[slot.driver ?? i % DRIVERS.length] : undefined
      const name = isLocal && !this.online ? 'You' : slot.name
      const car = new Car(i, model, {
        player: isLocal, name, driver, cls, glb: this.opts.assets?.cars.get(model.id),
        skill: THREE.MathUtils.clamp(skill + (rnd() - 0.5) * 0.1, 0.3, 1),
      })
      car.controller = isLocal ? 'local' : slot.kind === 'human' ? 'remote' : 'ai'
      car.remoteId = slot.kind === 'human' && !isLocal ? slot.id : null
      car.human = slot.kind === 'human'
      car.ai.laneOffset = (rnd() - 0.5) * 6
      if (isLocal) this.player = car
      const row = Math.floor(i / 2)
      const s = this.track.length - 8 - row * 10
      car.placeAt(this.track, s, i % 2 === 0 ? -3.6 : 3.6)
      car.s = s
      car.cpPassed = this.track.checkpoints.length
      car.progress = s
      car.safeS = s
      car.net.pos.copy(car.pos)
      car.net.yaw = car.yaw
      this.scene.add(car.mesh.root)
      this.cars.push(car)
      const trails = [new Trail(POWER_COLORS.nitro, 0.35, 26, 2.6, true), new Trail(POWER_COLORS.nitro, 0.35, 26, 2.6, true)]
      for (const t of trails) this.scene.add(t.mesh)
      this.nitroTrails.set(car, trails)
    })
  }

  private spawnPickups() {
    const rnd = mulberry32(7 + this.opts.round * 31)
    let weights: Partial<Record<PowerType, number>> = RACE_WEIGHTS
    if (this.armed) {
      // Weapons only: no Nitro or Repair, Shield rare; the last Combat Points track doubles Shock and Mine.
      const finale = this.mode === 'combat' && this.opts.round >= CONFIG.combat_tracks - 1 ? CONFIG.finale_hazard_mult : 1
      weights = { shunt: 18, mine: 16 * finale, bolt: 14, barge: 12, shock: 6 * finale, shield: 9 * CONFIG.shield_rare_weight }
    }
    const rowS: number[] = []
    for (const slot of this.track.pickups) {
      const type = slot.kind === 'support' && this.mode === 'race' ? pick(SUPPORT_WEIGHTS, rnd) : pick(weights, rnd)
      if (!rowS.includes(slot.s)) rowS.push(slot.s)
      const pos = this.track.point(slot.s, slot.lateral)
      const group = new THREE.Group()
      const glyph = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture(type), color: new THREE.Color(1.6, 1.6, 1.6), depthWrite: false, toneMapped: false }))
      glyph.scale.setScalar(2.1)
      glyph.position.y = 1.4
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(1.25, 18, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(POWER_COLORS[type]).multiplyScalar(1.4), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      )
      orb.position.y = 1.4
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(4.5, 4.5).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(POWER_COLORS[type]).multiplyScalar(1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      )
      pool.position.y = 0.05
      group.add(glyph, orb, pool)
      group.position.copy(pos)
      this.scene.add(group)
      this.pickups.push({ s: slot.s, lateral: slot.lateral, row: rowS.indexOf(slot.s), type, available: true, timer: 0, pos, group })
    }
    this.rows = rowS
  }

  private spawnFanRuns() {
    const tex = fanRunTexture()
    for (let lap = 1; lap <= this.laps; lap++) {
      const s = this.track.fanRuns[(lap - 1) % Math.max(1, this.track.fanRuns.length)] ?? this.track.length * 0.25
      const group = new THREE.Group()
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.8, 1.8, 1.8), depthWrite: false, toneMapped: false }))
      sprite.scale.setScalar(5)
      sprite.position.y = 2.8
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 30, 16, 1, true).translate(0, 15, 0),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23f').multiplyScalar(0.6), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      )
      group.add(sprite, beam)
      group.position.copy(this.track.point(s, 0))
      group.visible = false
      this.scene.add(group)
      this.fanIcons.push({ s, lap, state: 'waiting', group })
    }
  }

  private makeIntro() {
    const rivals = this.cars.filter((c) => !c.isPlayer && c.driver)
    const picks = rivals.sort(() => Math.random() - 0.5).slice(0, 2)
    const humans = this.cars.filter((c) => c.human).length
    const lines = [
      this.mode === 'combat'
        ? `DJ STATIC: Combat Points, round ${this.opts.round + 1} of ${CONFIG.combat_tracks} on ${this.track.name}. Wrecks pay. Position barely does.`
        : this.mode === 'deathmatch'
          ? `DJ STATIC: Deathmatch on ${this.track.name}. ${Math.round(this.timeLimit / 60)} minutes, ${this.cars.length} cars, weapons only. Wreck everything.`
          : `DJ STATIC: Lights up on ${this.track.name}. ${this.laps} laps, ${this.cars.length} cars, one podium.`,
      ...(this.online ? [`${humans} drivers online, ${this.cars.length - humans} AI rivals.`] : []),
      ...picks.map((c) => `${c.driver!.name.toUpperCase()} · ${c.model.name}: ${c.driver!.intro}`),
    ]
    if (this.mode === 'race') lines.push(`Fan demand: earn ${CONFIG.fan_target_goal.toLocaleString()} fans this race.`)
    return lines
  }

  private prepareMinimap() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < this.track.n; i++) {
      minX = Math.min(minX, this.track.px[i])
      maxX = Math.max(maxX, this.track.px[i])
      minZ = Math.min(minZ, this.track.pz[i])
      maxZ = Math.max(maxZ, this.track.pz[i])
    }
    const scale = 1 / Math.max(maxX - minX, maxZ - minZ)
    this.mapBounds = { minX: (minX + maxX) / 2, minZ: (minZ + maxZ) / 2, scale }
  }

  /* ---------- Netcode ---------- */

  private attachNet() {
    const link = this.link
    if (!link) return
    this.unsubs.push(
      link.onMessage((raw, from) => {
        const msg = raw as Msg
        if (this.role === 'host' && msg.t === 'input') {
          const car = this.cars.find((c) => c.remoteId === from && c.controller === 'remote')
          if (!car) return
          const prev = this.remote.get(from)
          const [throttle, brake, steer, hb, look, fh, fbh] = msg.i
          this.remote.set(from, {
            throttle, brake, steer, handbrake: !!hb, look: !!look, fireHeld: !!fh, fireBackHeld: !!fbh,
            actions: [...(prev?.actions ?? []), ...msg.a],
          })
        } else if (this.role === 'client') {
          if (msg.t === 'snap') this.applySnapshot(msg.s as Snapshot)
          else if (msg.t === 'ev') for (const e of msg.e as UiEvent[]) this.applyUi(e)
          else if (msg.t === 'result' && !this.resultSent) {
            this.resultSent = true
            this.onFinish?.(msg.r as RaceResult)
          }
        }
      }),
      link.onPeer((event, id) => {
        if (event !== 'leave') return
        if (this.role === 'client' && id === 'host') this.onDisconnect?.('The host left the race.')
        if (this.role === 'host') {
          const car = this.cars.find((c) => c.remoteId === id)
          if (car && car.controller === 'remote') {
            // An AI driver takes over the car of anyone who drops out.
            car.controller = 'ai'
            car.human = false
            this.remote.delete(id)
            this.feed(`${car.name} left · AI takes over`, null, null)
          }
        }
      }),
    )
  }

  private snapshot(): Snapshot {
    const idx = (c: Car | null) => (c ? this.cars.indexOf(c) : -1)
    const snap: Snapshot = {
      ph: PHASES.indexOf(this.phase),
      pt: r2(this.phaseTime),
      rt: r2(this.raceTime),
      c: this.cars.map((c) => [
        r2(c.pos.x), r2(c.pos.z), r2(c.yaw), r2(c.vel.x), r2(c.vel.z), r2(c.yawRate), r2(c.health), r2(c.shield), r2(c.invuln),
        r2(c.wrecked), r2(c.stun), STUNS.indexOf(c.stunKind), r2(c.stunTotal), r2(c.nitro), r2(c.boost), c.lap, c.place,
        c.finished ? 1 : 0, c.drifting ? 1 : 0, c.combat, c.fans, r2(c.flash), c.flashColor.getHex(), r2(c.s), c.cpPassed,
        r2(c.airBrake), c.active, c.bay.map((b) => (b ? `${POWER_TYPES.indexOf(b.type)}${b.count}` : '')).join(','),
        c.hits, c.wrecksDealt, c.human ? 1 : 0, r2(c.steerKick), r2(c.bog), r2(c.finishTime), c.chainMult, r2(c.lastWreckAt),
      ]),
      p: this.projectiles.map((p) => [
        p.id, PROJECTILE_KINDS.indexOf(p.kind), r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.heading), r2(p.vel.x), r2(p.vel.z),
        idx(p.owner), idx(p.target), p.lob ? 1 : 0,
      ]),
      d: this.domes.map((d) => [d.id, r2(d.pos.x), r2(d.pos.z), r2(d.warn), r2(d.life), idx(d.owner)]),
      k: this.pickups.map((p) => (p.available ? '1' : '0')).join(''),
      fx: this.fxLog,
      t: r2(this.time),
    }
    this.fxLog = []
    return snap
  }

  private applySnapshot(s: Snapshot) {
    const phase = PHASES[s.ph] ?? 'race'
    if (phase !== this.phase) {
      if (phase === 'race' && this.phase === 'countdown') {
        this.audio.countdown(true)
        this.clientLaunch()
      }
      this.phase = phase
    }
    this.phaseTime = s.pt
    this.raceTime = s.rt
    const first = !this.gotSnapshot
    this.gotSnapshot = true
    s.c.forEach((a, i) => {
      const c = this.cars[i]
      if (!c) return
      const n = a as number[]
      const bay = a[27] as string
      const [x, z, yaw, vx, vz, yawRate, health, shield, invuln, wrecked, stun, stunKind, stunTotal, nitro, boost, lap, place,
        finished, drifting, combat, fans, flash, flashColor, sAlong, cp, airBrake, active] = n
      const [hits, wrecks, human, steerKick, bog, finishTime, chainMult, lastWreckAt] = n.slice(28)
      const wasWrecked = c.wrecked > 0
      const parsed = parseBay(bay)
      if (c === this.player) {
        const added = parsed.find((b, k) => b && (b.type !== c.bay[k]?.type || b.count > (c.bay[k]?.count ?? 0)))
        if (added) this.audio.pickup(added.type)
      } else c.yawRate = yawRate
      c.bay = parsed
      c.active = active
      c.net.pos.set(x, 0, z)
      c.net.vel.set(vx, 0, vz)
      c.net.yaw = yaw
      c.net.t = this.time
      if (first || c !== this.player) {
        if (first || c.pos.distanceTo(c.net.pos) > 25) {
          c.pos.copy(c.net.pos)
          c.yaw = yaw
        }
        c.vel.copy(c.net.vel)
      }
      c.health = health
      c.shield = shield
      c.invuln = invuln
      c.wrecked = wrecked
      c.stun = stun
      c.stunKind = STUNS[stunKind] ?? 'none'
      c.stunTotal = stunTotal || 1
      c.nitro = nitro
      c.boost = boost
      c.lap = lap
      c.place = place
      c.finished = !!finished
      c.drifting = !!drifting
      c.combat = combat
      c.fans = fans
      c.flash = flash
      c.flashColor.setHex(flashColor)
      c.s = sAlong
      c.cpPassed = cp
      c.airBrake = airBrake
      c.hits = hits
      c.wrecksDealt = wrecks
      c.human = !!human
      c.steerKick = steerKick
      c.bog = bog
      c.finishTime = finishTime
      c.chainMult = chainMult
      c.lastWreckAt = lastWreckAt - s.t + this.time
      c.progress = c.lap * this.track.length + c.s
      if (!wasWrecked && wrecked > 0) c.wreckVy = 9
    })

    // Projectiles: create, update and retire visuals by id.
    const seen = new Set<number>()
    for (const [id, kind, x, y, z, heading, vx, vz, owner, target, lob] of s.p) {
      seen.add(id)
      let p = this.netProjectiles.get(id)
      if (!p) {
        const k = PROJECTILE_KINDS[kind] ?? 'bolt'
        const { mesh, trail } = projectileVisual(this, k, !!lob)
        p = {
          id, kind: k, owner: this.cars[owner] ?? this.cars[0], pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), heading,
          target: null, life: 99, hp: 1, weakened: false, hint: -1, age: 0, eventId: 0, lob: null, mesh, trail, dead: false,
        }
        this.netProjectiles.set(id, p)
      }
      p.pos.set(x, y, z)
      p.vel.set(vx, 0, vz)
      p.heading = heading
      p.target = target >= 0 ? (this.cars[target] ?? null) : null
      p.lob = lob ? { from: p.pos, to: p.pos, t: 0, dur: 1 } : null
    }
    for (const [id, p] of this.netProjectiles) {
      if (seen.has(id)) continue
      removeProjectileVisual(this, p)
      this.netProjectiles.delete(id)
    }
    this.projectiles = [...this.netProjectiles.values()]

    const domeSeen = new Set<number>()
    for (const [id, x, z, warn, life, owner] of s.d) {
      domeSeen.add(id)
      let d = this.netDomes.get(id)
      if (!d) {
        const pos = new THREE.Vector3(x, 0, z)
        const { mesh, bolt } = domeVisual(this, pos)
        d = { id, owner: this.cars[owner] ?? this.cars[0], pos, warn, life, hitSet: new Set(), eventId: 0, mesh, bolt, struck: false }
        this.netDomes.set(id, d)
      }
      d.warn = warn
      d.life = life
    }
    for (const [id, d] of this.netDomes) {
      if (domeSeen.has(id)) continue
      this.scene.remove(d.mesh)
      this.netDomes.delete(id)
    }
    this.domes = [...this.netDomes.values()]

    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i]
      p.available = s.k[i] === '1'
      p.group.visible = p.available
    }

    for (const e of s.fx as FxEvent[]) this.replayFx(e)
  }

  private replayFx(e: FxEvent) {
    switch (e[0]) {
      case 'b': {
        const [, x, y, z, n, speed, life, size, r, g, b, alpha, up, grow] = e
        this.fx.burst(new THREE.Vector3(x, y, z), n, speed, life, size, new THREE.Color(r, g, b), alpha, up, grow)
        break
      }
      case 's': {
        const [, name, x, z] = e
        if (this.near(new THREE.Vector3(x, 0, z), 120)) this.playSfx(name)
        break
      }
      case 'r':
        bargeRing(this, new THREE.Vector3(e[1], 0, e[2]))
        break
      case 'x':
        this.wreckSmoke(new THREE.Vector3(e[1], e[2], e[3]))
        break
      case 'f': {
        const [, text, a, b] = e
        this.addFeed(text, !!(this.cars[a]?.isPlayer || this.cars[b]?.isPlayer))
        break
      }
    }
  }

  /** Effects: run locally and, on the host, recorded for clients. */
  burst(p: THREE.Vector3, n: number, speed: number, life: number, size: number, color: THREE.Color, alpha = 1, up = 0.4, grow = 0) {
    this.fx.burst(p, n, speed, life, size, color, alpha, up, grow)
    if (this.role === 'host') this.fxLog.push(['b', r2(p.x), r2(p.y), r2(p.z), n, speed, life, size, r2(color.r), r2(color.g), r2(color.b), alpha, up, grow])
  }

  sfx(name: string, pos: THREE.Vector3) {
    if (this.near(pos, 120)) this.playSfx(name)
    if (this.role === 'host') this.fxLog.push(['s', name, r2(pos.x), r2(pos.z)])
  }

  recordRing(pos: THREE.Vector3) {
    if (this.role === 'host') this.fxLog.push(['r', r2(pos.x), r2(pos.z)])
  }

  shakeFor(car: Car, a: number) {
    this.ui(car, ['shake', a])
  }

  private playSfx(name: string) {
    const [k, arg] = name.split(':')
    const a = this.audio
    if (k === 'fire') a.fire(arg as PowerType)
    else if (k === 'pickup') a.pickup(arg as PowerType)
    else if (k === 'airbrake') a.airBrake()
    else if (k === 'crackle') a.crackle()
    else if (k === 'hit') a.hit(false)
    else if (k === 'hitHeavy') a.hit(true)
    else if (k === 'shield') a.shieldBreak()
    else if (k === 'boom') a.explosion()
    else if (k === 'wall') a.wall()
    else if (k === 'refused') a.refused()
    else if (k === 'crowd') a.crowd()
    else if (k === 'fans') a.fans()
  }

  /** Something only this car's driver sees or hears. */
  private ui(car: Car, e: UiEvent) {
    if (car.isPlayer) this.applyUi(e)
    else if (this.role === 'host' && car.controller === 'remote' && car.remoteId) {
      const list = this.uiOut.get(car.remoteId) ?? []
      list.push(e)
      this.uiOut.set(car.remoteId, list)
    }
  }

  private applyUi(e: UiEvent) {
    switch (e[0]) {
      case 'pop':
        this.popup(e[1], e[2])
        break
      case 'say':
        this.banner = { text: e[1], color: e[2], t: e[3] }
        break
      case 'hit':
        this.hitFlash = { color: e[1], t: 0.6 }
        this.shake(e[2] ? 0.7 : 0.25)
        break
      case 'slow':
        if (this.role === 'solo') this.slowmo = Math.max(this.slowmo, e[1])
        break
      case 'sfx':
        this.playSfx(e[1])
        break
      case 'shake':
        this.shake(e[1])
        break
    }
  }

  private flushNet(dt: number) {
    const link = this.link
    if (!link || this.role !== 'host') return
    this.snapTimer -= dt
    if (this.snapTimer <= 0) {
      this.snapTimer = 1 / CONFIG.net_snapshot_hz
      link.send({ t: 'snap', s: this.snapshot() } satisfies Msg)
    }
    for (const [peer, e] of this.uiOut) if (e.length) link.send({ t: 'ev', e } satisfies Msg, peer)
    this.uiOut.clear()
  }

  /* ---------- Lifecycle ---------- */

  start() {
    this.audio.start()
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    for (const u of this.unsubs) u()
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('visibilitychange', this.hidden)
    this.audio.stop()
    this.composer.dispose()
    this.renderer.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
    })
    this.renderer.domElement.remove()
  }

  /** Online games never stop: the pause menu opens over the running race. */
  setPaused(p: boolean) {
    if (this.paused === p) return
    this.paused = p
    if (!this.online) this.audio.setPaused(p)
    this.keys.clear()
    this.onPause?.(p)
  }

  toggleMusic() {
    return this.audio.toggleMusic()
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /* ---------- Input ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    const a = KEYMAP[e.code]
    if (!a) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    if (!this.keys.has(a)) this.pressed.add(a)
    this.keys.add(a)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    const a = KEYMAP[e.code]
    if (a) this.keys.delete(a)
  }

  private onBlur = () => this.keys.clear()

  private readPad() {
    const pads = navigator.getGamepads?.() ?? []
    const gp = Array.from(pads).find((p) => p)
    if (!gp) return null
    const btn = (i: number) => !!gp.buttons[i]?.pressed
    const val = (i: number) => gp.buttons[i]?.value ?? 0
    const edges = [0, 1, 2, 3, 4, 5, 9].map((i) => btn(i))
    const was = this.padPrev
    const edge = (k: number) => edges[k] && !was[k]
    this.padPrev = edges
    const ax = Math.abs(gp.axes[0] ?? 0) > 0.12 ? gp.axes[0] : 0
    return {
      throttle: val(7), brake: val(6), steer: ax, handbrake: btn(0), look: (gp.axes[3] ?? 0) > 0.6,
      fire: edge(2), fireHeld: btn(2), fireBack: edge(1), fireBackHeld: btn(1), discard: edge(3), cycle: edge(4) || edge(5), pause: edge(6),
    }
  }

  /** Keyboard + gamepad into one input state for the local driver. */
  private readLocal(dt: number, pressed: Set<string>, pad: ReturnType<Game['readPad']>): InputState {
    const k = this.keys
    const throttle = Math.max(k.has('up') ? 1 : 0, pad?.throttle ?? 0)
    const brake = Math.max(k.has('down') ? 1 : 0, pad?.brake ?? 0)
    const steer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)
    // Smooth keyboard steering; analogue sticks pass straight through.
    if (pad?.steer) this.steerSmooth = pad.steer
    else {
      const rate = steer === 0 || Math.sign(steer) !== Math.sign(this.steerSmooth) ? 9 : 5
      this.steerSmooth += THREE.MathUtils.clamp(steer - this.steerSmooth, -rate * dt, rate * dt)
    }
    const actions: string[] = []
    if (pressed.has('cycle') || pad?.cycle) actions.push('cycle')
    if (pressed.has('discard') || pad?.discard) actions.push('discard')
    if (pressed.has('reset')) actions.push('reset')
    const fwd = pressed.has('fire') || !!pad?.fire
    const back = pressed.has('fireBack') || !!pad?.fireBack
    if (fwd) actions.push('fire')
    else if (back) actions.push('fireBack')

    // Burnout start: remember when the throttle went down, relative to GO.
    const down = throttle > 0.5
    if (down && !this.throttleWasDown && (this.phase === 'countdown' || (this.phase === 'race' && this.phaseTime < 1))) {
      this.throttleEdgeAt = this.phase === 'countdown' ? this.phaseTime - 3 : this.phaseTime
      if (this.phase === 'race' && this.throttleEdgeAt <= CONFIG.launch_window && !this.launched.has(this.player) && this.player.bog <= 0)
        actions.push('launch:perfect')
    }
    this.throttleWasDown = down
    return {
      throttle, brake, steer: this.steerSmooth, handbrake: k.has('handbrake') || !!pad?.handbrake, look: k.has('look') || !!pad?.look,
      fireHeld: k.has('fire') || !!pad?.fireHeld, fireBackHeld: k.has('fireBack') || !!pad?.fireBackHeld, actions,
    }
  }

  /** Apply one driver's input to their car (host or solo). */
  private drive(car: Car, st: InputState, dt: number) {
    car.input.throttle = st.throttle
    car.input.brake = st.brake
    car.input.steer = st.steer
    car.input.handbrake = st.handbrake
    if (this.phase === 'intro' || this.phase === 'countdown') return
    for (const a of st.actions) {
      if (a === 'cycle') car.cycle()
      else if (a === 'discard') car.discard()
      else if (a === 'reset') this.instantReset(car)
      else if (a === 'launch:perfect') this.perfectLaunch(car)
      else if (a === 'launch:bog') {
        if (!this.launched.has(car)) {
          this.launched.add(car)
          car.bog = 0.7
          this.ui(car, ['say', 'WHEELSPIN', '#f87171', 1])
        }
      } else if (a === 'fire' || a === 'fireBack') {
        const backward = a === 'fireBack'
        if (!car.bay[car.active]) car.cycle()
        const slot = car.bay[car.active]
        if (slot?.type === 'bolt') {
          // Tap fires one bolt; holding fires the rest.
          if (car.alive && this.phase === 'race' && car.consume()) {
            fireBolt(this, car, backward)
            this.sfx('fire:bolt', car.pos)
            this.onFired(car)
            car.boltHold = { backward, t: 0, next: CONFIG.bolt_hold_delay }
          }
        } else fire(this, car, backward)
      }
    }
    if (car.boltHold) {
      const held = car.boltHold.backward ? st.fireBackHeld : st.fireHeld
      const slot = car.bay[car.active]
      if (!held || slot?.type !== 'bolt' || !car.alive) car.boltHold = null
      else {
        car.boltHold.t += dt
        if (car.boltHold.t >= car.boltHold.next) {
          car.boltHold.next += CONFIG.bolt_hold_interval
          if (car.consume()) {
            fireBolt(this, car, car.boltHold.backward)
            this.sfx('fire:bolt', car.pos)
          }
        }
      }
    }
  }

  /* ---------- Frame ---------- */

  /** Test hook (exposed with ?snap): advance the simulation without rendering. */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    this.frame(step, true)
  }

  /** Test hook: a compact snapshot of the race state. */
  debugState() {
    return {
      role: this.role,
      phase: this.phase,
      raceTime: +this.raceTime.toFixed(1),
      fans: this.player.fans,
      projectiles: this.projectiles.length,
      domes: this.domes.length,
      feed: this.killFeed.map((k) => k.text),
      cars: this.cars.map((c) => ({
        name: c.name, ctl: c.controller, place: c.place, lap: c.lap, cp: c.cpPassed, s: Math.round(c.s), kmh: Math.round(toKmh(c.speed)), hp: c.health,
        bay: c.bay.map((b) => (b ? `${b.type}x${b.count}` : '-')).join(','), hits: c.hits, wrecks: c.wrecksDealt, wrecked: c.wrecksTaken,
        combat: c.combat, finished: c.finished, lat: +c.lateral.toFixed(1), x: Math.round(c.pos.x), z: Math.round(c.pos.z),
      })),
    }
  }

  private frame(realDt: number, render = true) {
    const pad = this.readPad()
    const pressed = this.pressed
    this.pressed = new Set()
    if (pressed.has('pause') || pad?.pause) {
      if (this.phase !== 'finished') this.setPaused(!this.paused)
    }
    if (pressed.has('music')) this.audio.toggleMusic()
    if (this.paused && !this.online) {
      if (render) this.composer.render(realDt)
      return
    }
    // While the online pause menu is open, the car coasts.
    if (this.paused) pressed.clear()
    if (this.role === 'client') return this.clientFrame(realDt, pressed, pad, render)

    if (this.slowmo > 0) this.slowmo -= realDt
    const dt = realDt * (this.slowmo > 0 && !this.online ? 0.35 : 1)
    this.time += dt
    this.phaseTime += dt

    if (this.phase === 'intro') {
      const skip = pressed.has('skip') || pressed.has('up') || pressed.has('fire') || !!pad?.fire
      if (skip || this.phaseTime > (this.online ? 4 : 5.5)) this.setPhase('countdown')
    } else if (this.phase === 'countdown') {
      const before = Math.ceil(3 - (this.phaseTime - dt))
      const now = Math.ceil(3 - this.phaseTime)
      if (now !== before && now > 0) this.audio.countdown(false)
      if (this.phaseTime >= 3) {
        this.audio.countdown(true)
        this.setPhase('race')
        this.launch()
      }
    } else if (this.phase === 'race') this.raceTime += dt

    const local = this.paused ? IDLE : this.readLocal(dt, pressed, pad)
    this.lookBack = local.look
    const racing = this.phase === 'race' || this.phase === 'finished'
    for (const c of this.cars) {
      if (c.controller === 'local' && !this.opts.autopilot && !c.finished) this.drive(c, local, dt)
      else if (c.controller === 'remote' && !c.finished) {
        const st = this.remote.get(c.remoteId!) ?? IDLE
        this.drive(c, st, dt)
        if (st !== IDLE) st.actions = []
      } else if (racing) aiDrive(this, c, dt)
      else {
        c.input.throttle = 0
        c.input.brake = 1
      }
    }
    if (racing) {
      // Two physics substeps keep collisions stable at high speed.
      const sub = dt / 2
      for (let k = 0; k < 2; k++) {
        for (const c of this.cars) c.step(sub, this.track)
        this.collideCars()
      }
      for (const c of this.cars) this.afterStep(c, dt)
      this.updatePickups(dt)
      updateWeapons(this, dt)
      this.rubberBand()
      this.rank()
      this.updateFanRuns(dt)
      this.checkEnd()
    }
    this.flushNet(dt)
    this.updateEffects(dt)
    for (const c of this.cars) c.syncMesh(dt, this.time)
    this.animateProps(dt)
    this.updateCamera(realDt)
    this.updateLabels()
    this.audio.update(dt, this.player.speed / Math.max(1, this.player.top), this.player.input.throttle, this.player.nitro > 0, this.phase !== 'intro')
    if (!render) return
    this.composer.render(dt)
    this.drawMinimap()
    this.emitHud()
  }

  /** Client: predict our own car, interpolate everyone else, render what the host says happened. */
  private clientFrame(dt: number, pressed: Set<string>, pad: ReturnType<Game['readPad']>, render: boolean) {
    this.time += dt
    this.phaseTime += dt
    if (this.phase === 'race') this.raceTime += dt
    if (this.phase === 'countdown') {
      const before = Math.ceil(3 - (this.phaseTime - dt))
      const now = Math.ceil(3 - this.phaseTime)
      if (now !== before && now > 0 && now <= 3) this.audio.countdown(false)
    }
    const st = this.paused ? IDLE : this.readLocal(dt, pressed, pad)
    this.lookBack = st.look
    const p = this.player
    p.input.throttle = st.throttle
    p.input.brake = st.brake
    p.input.steer = st.steer
    p.input.handbrake = st.handbrake

    // Send inputs: every action immediately, held state at the configured rate.
    this.inputTimer -= dt
    const held: [number, number, number, number, number, number, number] = [
      r2(st.throttle), r2(st.brake), r2(st.steer), st.handbrake ? 1 : 0, st.look ? 1 : 0, st.fireHeld ? 1 : 0, st.fireBackHeld ? 1 : 0,
    ]
    const key = held.join()
    if (this.link && (st.actions.length || key !== this.lastSent || this.inputTimer <= 0)) {
      this.inputTimer = 1 / CONFIG.net_input_hz
      this.lastSent = key
      this.link.send({ t: 'input', i: held, a: st.actions } satisfies Msg)
    }

    const k = 1 - Math.exp(-dt * 12)
    for (const c of this.cars) {
      const age = Math.min(0.25, Math.max(0, this.time - c.net.t))
      const target = c.net.pos.clone().addScaledVector(c.net.vel, age)
      const predict = c === p && this.phase === 'race' && c.alive && !c.finished
      if (predict) {
        // Prediction: drive locally, then ease towards where the host says we are.
        c.step(dt, this.track)
        const err = target.sub(c.pos)
        if (err.length() > 8) {
          c.pos.add(err)
          c.vel.copy(c.net.vel)
          c.yaw = c.net.yaw
        } else c.pos.addScaledVector(err, Math.min(1, dt * 3))
        let d = c.net.yaw - c.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        if (Math.abs(d) > 0.6) c.yaw += d * Math.min(1, dt * 4)
      } else {
        c.pos.lerp(target, k)
        let d = c.net.yaw - c.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        c.yaw += d * k
        const n = this.track.nearest(c.pos.x, c.pos.z, c.hint)
        c.hint = n.i
        c.lateral = n.lateral
      }
    }
    // Projectiles drift between snapshots; domes and rings animate locally.
    for (const pr of this.projectiles) {
      if (!pr.lob && pr.kind !== 'mine') pr.pos.addScaledVector(pr.vel, dt)
      pr.mesh.position.copy(pr.pos)
      pr.mesh.rotation.y = pr.kind === 'mine' ? pr.mesh.rotation.y + dt * 3 : pr.heading
      if (pr.trail) pr.trail.push(pr.pos)
    }
    for (const d of this.domes) {
      if (d.warn > 0) d.warn -= dt
      else d.life -= dt
      animateDome(this, d, dt)
    }
    updateRings(this, dt)
    this.updateEffects(dt)
    for (const c of this.cars) c.syncMesh(dt, this.time)
    this.animateProps(dt)
    this.updateCamera(dt)
    this.updateLabels()
    this.audio.update(dt, p.speed / Math.max(1, p.top), p.input.throttle, p.nitro > 0, this.phase !== 'intro')
    if (!render) return
    this.composer.render(dt)
    this.drawMinimap()
    this.emitHud()
  }

  private clientLaunch() {
    const t = this.throttleEdgeAt
    if (!this.link || t === null || this.player.input.throttle <= 0.5) return
    const a = Math.abs(t) <= CONFIG.launch_window ? 'launch:perfect' : t < -CONFIG.launch_window ? 'launch:bog' : null
    if (a) this.link.send({ t: 'input', i: [1, 0, 0, 0, 0, 0, 0], a: [a] } satisfies Msg)
  }

  private updateLabels() {
    // Rival tags: hidden when very close to the camera (they would fill the screen) or far away.
    for (const c of this.cars) {
      if (!c.label) continue
      const d = c.pos.distanceTo(this.camera.position)
      c.label.visible = c.alive && d > 11 && d < 220
    }
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.phaseTime = 0
  }

  private launch() {
    for (const c of this.cars) {
      if (c.controller !== 'ai' && !(c.isPlayer && this.opts.autopilot)) continue
      if (Math.random() < c.skill * 0.6) c.boost = CONFIG.launch_boost
    }
    const p = this.player
    if (this.opts.autopilot) return
    const t = this.throttleEdgeAt
    if (t !== null && p.input.throttle > 0.5) {
      if (Math.abs(t) <= CONFIG.launch_window) this.perfectLaunch(p)
      else if (t < -CONFIG.launch_window) {
        this.launched.add(p)
        p.bog = 0.7
        this.say('WHEELSPIN', '#f87171', 1)
      }
    }
  }

  private perfectLaunch(car: Car) {
    if (this.launched.has(car) || this.phaseTime > CONFIG.launch_window + 0.3) return
    this.launched.add(car)
    car.boost = CONFIG.launch_boost
    this.addFans(car, CONFIG.fans_perfect_launch, 'PERFECT LAUNCH')
  }

  /* ---------- Simulation ---------- */

  private afterStep(c: Car, dt: number) {
    // Wall hits: damage above the threshold, instant reset on a head-on hit.
    if (c.alive && c.wallImpact > 0) {
      const sp = c.speed
      if (c.wallImpact > 3) {
        this.ui(c, ['sfx', 'wall'])
        this.shakeFor(c, Math.min(0.5, c.wallImpact * 0.04))
        this.burst(c.pos.clone().setY(0.6), 10, 8, 0.4, 0.4, new THREE.Color(3, 2.2, 1.2))
      }
      const before = sp + c.wallImpact
      if (c.wallImpact > 4 && toKmh(before) > CONFIG.wall_hit_damage_threshold && c.wallCooldown <= 0) {
        c.wallCooldown = 0.6
        c.vel.multiplyScalar(0.8)
        this.damage(c, 1, { weapon: 'wall', effect: 'none' })
      }
      if (c.alive && c.wallImpact > Math.max(25, before * 0.8)) this.instantReset(c)
    }
    // Stuck or off course: reset.
    if (c.alive && this.phase === 'race' && c.speed < 1.5 && (c.input.throttle > 0 || c.controller === 'ai')) {
      c.stuckTime += dt
      if (c.stuckTime > CONFIG.stuck_reset) this.instantReset(c)
    } else c.stuckTime = 0

    // Lap and checkpoint progress.
    const L = this.track.length
    const prev = c.s
    const s = this.track.s[c.hint]
    c.s = s
    if (prev > L * 0.75 && s < L * 0.25) {
      if (c.cpPassed >= this.track.checkpoints.length) {
        c.lap++
        c.cpPassed = 0
        c.safeS = 0
        if (c.lap > this.laps && !c.finished) this.finishCar(c)
        else if (c.lap === this.laps && this.laps > 1) this.ui(c, ['say', 'FINAL LAP', '#fde047', 1.6])
      }
    } else if (prev < L * 0.25 && s > L * 0.75 && c.lap > 0) {
      c.lap--
      c.cpPassed = this.track.checkpoints.length
    }
    const cps = this.track.checkpoints
    if (c.cpPassed < cps.length) {
      const cpS = this.track.s[cps[c.cpPassed]]
      if (s >= cpS && s < cpS + 80) {
        c.cpPassed++
        c.safeS = cpS
      }
    }
    c.progress = c.lap * L + s

    // Drift Fan Points.
    if (c.human && c.drifting && c.speed > 12) {
      c.driftFanAcc += dt
      if (c.isPlayer && this.fanRun?.kind === 'drift') this.fanRun.progress += c.speed * dt
      while (c.driftFanAcc >= 1) {
        c.driftFanAcc -= 1
        this.addFans(c, CONFIG.fans_drift_per_s, 'DRIFT')
      }
    } else c.driftFanAcc = 0

    // Wreck timer and respawn.
    if (c.wrecked > 0) {
      c.wrecked -= dt
      if (c.wrecked <= 0) this.respawn(c)
    }
  }

  private finishCar(c: Car) {
    c.finished = true
    c.finishTime = this.raceTime
    this.finishOrder.push(c)
    if (c.human && this.firstHumanFinish < 0) this.firstHumanFinish = this.raceTime
    if (this.mode === 'combat') c.combat += CONFIG.combat_finish[this.finishOrder.length - 1] ?? 0
    if (c.human) {
      const place = this.finishOrder.length
      if (this.mode === 'race') {
        const fans = CONFIG.fans_finish[place - 1] ?? 0
        if (fans) this.addFans(c, fans, `FINISH P${place}`)
      }
      this.ui(c, ['say', place === 1 ? 'WINNER' : `FINISHED P${place}`, place <= 3 ? '#fde047' : '#e2e8f0', 3])
    }
  }

  private checkEnd() {
    if (this.resultSent) return
    const timeUp = this.raceTime >= this.timeLimit
    let done: boolean
    if (this.mode === 'deathmatch') done = timeUp
    else if (this.role === 'host') {
      const humans = this.cars.filter((c) => c.human)
      done = timeUp || humans.every((c) => c.finished) || (this.firstHumanFinish >= 0 && this.raceTime - this.firstHumanFinish > CONFIG.net_finish_grace)
    } else done = this.player.finished || timeUp
    if (!done) return
    if (this.phase !== 'finished') {
      this.setPhase('finished')
      if (timeUp) for (const c of this.cars) if (c.human) this.ui(c, ['say', 'TIME', '#fde047', 3])
    }
    if (this.phaseTime > 2.2) {
      this.resultSent = true
      if (this.role === 'host' && this.link) {
        for (const c of this.cars) if (c.controller === 'remote' && c.remoteId) this.link.send({ t: 'result', r: this.results(c) } satisfies Msg, c.remoteId)
        this.flushNet(1)
      }
      this.onFinish?.(this.results(this.player))
    }
  }

  private respawn(c: Car) {
    const L = this.track.length
    const s = ((c.safeS % L) + L) % L
    const lat = [0, -4.5, 4.5].find((l) => {
      const p = this.track.point(s, l)
      return !this.cars.some((o) => o !== c && o.alive && o.pos.distanceTo(p) < 5)
    }) ?? 0
    c.placeAt(this.track, s + 2, lat)
    c.s = this.track.s[c.hint]
    c.vel.copy(c.forward).multiplyScalar(kmh(60))
    c.health = CONFIG.max_health
    c.wrecked = 0
    c.invuln = CONFIG.respawn_invuln
    c.stun = 0
    c.stunKind = 'none'
    c.shield = 0
    c.nitro = 0
    c.sinceRespawn = 0
    c.bay = [null, null, null]
    c.active = 0
    c.drawLabel()
  }

  private instantReset(c: Car) {
    if (!c.alive || this.phase === 'intro' || this.phase === 'countdown') return
    const s = this.track.s[c.hint]
    c.placeAt(this.track, s, THREE.MathUtils.clamp(c.lateral * 0.5, -4, 4))
    c.s = s
    c.vel.copy(c.forward).multiplyScalar(kmh(40))
    c.invuln = CONFIG.respawn_invuln
    c.stuckTime = 0
    c.stun = 0
  }

  private collideCars() {
    const cs = this.cars
    const R = 1.08
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3()
    for (let i = 0; i < cs.length; i++) {
      const A = cs[i]
      if (!A.alive) continue
      for (let j = i + 1; j < cs.length; j++) {
        const B = cs[j]
        if (!B.alive) continue
        if (Math.abs(A.pos.x - B.pos.x) > 7 || Math.abs(A.pos.z - B.pos.z) > 7) continue
        const fa = A.forward, fb = B.forward
        let hit = false
        for (const oa of [-1.15, 1.15]) {
          for (const ob of [-1.15, 1.15]) {
            a.copy(A.pos).addScaledVector(fa, oa)
            b.copy(B.pos).addScaledVector(fb, ob)
            n.subVectors(b, a).setY(0)
            const d = n.length()
            if (d >= R * 2 || d < 1e-4) continue
            n.divideScalar(d)
            const pen = R * 2 - d
            A.pos.addScaledVector(n, -pen / 2)
            B.pos.addScaledVector(n, pen / 2)
            const vrel = B.vel.clone().sub(A.vel).dot(n)
            if (vrel < 0) {
              // Heavier-feeling cars (Stability) get pushed less.
              const wa = 11 - A.model.stats.stability, wb = 11 - B.model.stats.stability
              const imp = -(1 + 0.3) * vrel
              A.vel.addScaledVector(n, (-imp * wa) / (wa + wb))
              B.vel.addScaledVector(n, (imp * wb) / (wa + wb))
              if (!hit && -vrel > kmh(CONFIG.ram_damage_threshold)) this.ram(A, B)
              hit = true
            }
          }
        }
        // Near miss for human drivers.
        if (!hit && (A.human || B.human) && this.phase === 'race') {
          for (const [me, other] of [[A, B], [B, A]] as const) {
            if (!me.human) continue
            const gap = me.pos.distanceTo(other.pos) - 2.2
            const rel = me.vel.clone().sub(other.vel).length()
            if (gap > 0 && gap < CONFIG.near_miss_distance && rel > CONFIG.near_miss_speed) {
              const key = me.id * 100 + other.id
              const last = this.nearMiss.get(key) ?? -99
              if (this.time - last > 3) {
                this.nearMiss.set(key, this.time)
                this.addFans(me, CONFIG.fans_near_miss, 'NEAR MISS')
              }
            }
          }
        }
      }
    }
  }

  private ram(A: Car, B: Car) {
    const key = `${Math.min(A.id, B.id)}:${Math.max(A.id, B.id)}`
    if ((this.ramCooldown.get(key) ?? -99) > this.time - 0.6) return
    this.ramCooldown.set(key, this.time)
    A.vel.multiplyScalar(0.85)
    B.vel.multiplyScalar(0.85)
    this.damage(A, 1, { by: B, weapon: 'ram', effect: 'none' })
    this.damage(B, 1, { by: A, weapon: 'ram', effect: 'none' })
    for (const c of [A, B]) {
      this.ui(c, ['sfx', 'hit'])
      this.shakeFor(c, 0.3)
    }
    this.burst(A.pos.clone().lerp(B.pos, 0.5).setY(0.8), 16, 9, 0.4, 0.5, new THREE.Color(3, 2.4, 1.4))
  }

  private updatePickups(dt: number) {
    const respawn = this.mode === 'combat' ? CONFIG.combat_pickup_respawn : this.mode === 'deathmatch' ? CONFIG.deathmatch_pickup_respawn : CONFIG.pickup_respawn
    this.refuseCooldown -= dt
    const r2p = CONFIG.pickup_radius ** 2
    for (const p of this.pickups) {
      if (!p.available) {
        p.timer -= dt
        if (p.timer <= 0) {
          p.available = true
          p.group.visible = true
        }
        continue
      }
      for (const c of this.cars) {
        if (!c.alive) continue
        const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z
        if (dx * dx + dz * dz > r2p) continue
        if (c.isPlayer) this.touchRow(p.row)
        if (c.give(p.type)) {
          p.available = false
          p.timer = respawn
          p.group.visible = false
          if (c.isPlayer) this.audio.pickup(p.type)
          this.burst(p.pos.clone().setY(1.4), 18, 7, 0.45, 0.8, new THREE.Color(POWER_COLORS[p.type]).multiplyScalar(2))
          break
        } else if (c.human && (this.refuseCooldown <= 0 || !c.isPlayer)) {
          if (c.isPlayer) this.refuseCooldown = 1
          this.ui(c, ['sfx', 'refused'])
          this.ui(c, ['say', 'BAY FULL · X TO DISCARD', '#f87171', 1])
        }
      }
    }
    // Fan Run "pickups in a row": passing a row without touching an icon breaks the streak.
    if (this.rows.length) {
      const rowS = this.rows[this.nextRow % this.rows.length]
      let ds = this.player.s - rowS
      if (ds < -this.track.length / 2) ds += this.track.length
      if (ds > 6 && ds < 60) {
        if (!this.rowHit.has(this.nextRow % this.rows.length)) this.pickupStreak = 0
        this.rowHit.delete(this.nextRow % this.rows.length)
        this.nextRow++
      }
    }
  }

  private touchRow(row: number) {
    if (this.rowHit.has(row)) return
    this.rowHit.add(row)
    this.pickupStreak++
    if (this.fanRun?.kind === 'pickups') this.fanRun.progress = Math.max(this.fanRun.progress, this.pickupStreak)
  }

  private rubberBand() {
    // Measured against the rear-most human so nobody online is left behind.
    const humans = this.cars.filter((c) => c.human)
    if (!humans.length) humans.push(this.player)
    const ref = this.player.baseTop * 0.75
    const lead = Math.max(...this.cars.map((c) => c.progress))
    const backHuman = Math.min(...humans.map((c) => c.progress))
    const topHuman = Math.min(...humans.map((c) => c.baseTop))
    for (const c of this.cars) {
      if (c.controller !== 'ai') continue
      const behindLeader = (lead - c.progress) / ref
      const aheadOfPlayer = (c.progress - backHuman) / ref
      c.rubber = 1 + (behindLeader > CONFIG.ai_rubberband_gap ? CONFIG.ai_rubberband_mult : 0) - (aheadOfPlayer > CONFIG.ai_rubberband_gap ? CONFIG.ai_rubberband_mult : 0)
      c.topCap = topHuman * (1 + CONFIG.ai_max_topspeed_over_player)
    }
  }

  /** Rank by lap, then checkpoint, then distance (progress covers all three). Deathmatch ranks by score. */
  private rank() {
    const sorted = [...this.cars].sort((a, b) => {
      if (this.mode === 'deathmatch') return b.combat - a.combat || b.progress - a.progress
      if (a.finished && b.finished) return a.finishTime - b.finishTime
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return b.progress - a.progress
    })
    sorted.forEach((c, i) => (c.place = i + 1))
  }

  combatLeader() {
    let best: Car | null = null
    for (const c of this.cars) if (c.combat > 0 && (!best || c.combat > best.combat)) best = c
    return best
  }

  near(p: THREE.Vector3, r: number) {
    return p.distanceToSquared(this.player.pos) < r * r
  }

  shake(a: number) {
    this.shakeAmt = Math.max(this.shakeAmt, a)
  }

  onFired(car: Car) {
    this.shakeFor(car, 0.08)
  }

  /* ---------- Damage, wrecks and scoring ---------- */

  damage(
    victim: Car,
    amount: number,
    o: { by?: Car | null; weapon: Weapon; effect: 'flip' | 'spin' | 'jolt' | 'kick' | 'push' | 'none'; stun?: number; eventId?: number },
  ) {
    if (!victim.alive || victim.invuln > 0 || this.phase !== 'race') return false
    const by = o.by && o.by !== victim ? o.by : null
    const color = o.weapon === 'wall' ? '#ffffff' : o.weapon === 'ram' ? (by?.model.glow ?? '#ffffff') : POWER_COLORS[o.weapon]
    if (victim.shield > 0 && o.weapon !== 'wall') {
      // The Shield is gone the moment it absorbs one hit.
      victim.shield = 0
      this.burst(victim.pos.clone().setY(1), 40, 10, 0.5, 0.8, new THREE.Color(2.5, 2.5, 2.8))
      this.sfx('shield', victim.pos)
      this.ui(victim, ['say', 'SHIELD BLOCKED', '#e0f2fe', 0.9])
      return false
    }
    victim.health = Math.max(0, victim.health - amount)
    victim.damageTaken += amount
    victim.flash = 1
    victim.flashColor.set(color)
    const stab = 1.15 - victim.model.stats.stability * 0.03
    switch (o.effect) {
      case 'flip':
      case 'spin':
        victim.stun = (o.stun ?? CONFIG.shunt_stun) * stab
        victim.stunTotal = victim.stun
        victim.stunKind = o.effect
        victim.vel.multiplyScalar(0.45)
        victim.drifting = false
        break
      case 'jolt':
        victim.vel.multiplyScalar(0.8)
        victim.yawRate += (Math.random() - 0.5) * 2
        break
      case 'kick':
        victim.steerKick = CONFIG.bolt_steer_kick
        victim.steerKickDir = Math.random() < 0.5 ? -1 : 1
        victim.vel.multiplyScalar(0.96)
        break
      default:
        break
    }
    if (o.weapon !== 'wall' && o.weapon !== 'ram') {
      this.burst(victim.pos.clone().setY(1), 24, 9, 0.5, 0.9, new THREE.Color(color).multiplyScalar(2.2))
      this.sfx(amount >= 3 ? 'hitHeavy' : 'hit', victim.pos)
    }
    this.ui(victim, ['hit', color, amount >= 3 ? 1 : 0])
    if (by && o.weapon !== 'wall') {
      if (o.weapon !== 'ram') {
        by.hits++
        if (o.weapon === 'shunt') by.shuntHits++
      }
      if (victim.health > 0 && o.weapon !== 'ram') {
        by.combat += CONFIG.combat_hit
        this.addFans(by, CONFIG.fans_hit, 'HIT')
        if (victim.place === 1) this.addFans(by, CONFIG.fans_hit_leader, 'LEADER HIT')
        if (by.isPlayer && this.fanRun && (this.fanRun.kind === 'hit' || (this.fanRun.kind === 'shunt' && o.weapon === 'shunt'))) this.fanRun.progress++
      }
    }
    if (victim.health <= 0) this.wreck(victim, by, o.weapon, o.eventId ?? 0)
    return true
  }

  private wreck(victim: Car, by: Car | null, weapon: Weapon, eventId: number) {
    const leaderBefore = this.combatLeader()
    victim.wrecked = CONFIG.respawn_delay
    victim.wrecksTaken++
    victim.bay = [null, null, null]
    victim.drifting = false
    victim.stun = 0
    victim.stunKind = 'none'
    victim.wreckVy = 9
    victim.lastWreckedBy = by
    const at = victim.pos.clone().setY(1)
    this.burst(at, 90, 20, 1.0, 2.2, new THREE.Color(3, 1.3, 0.35), 1, 1.2, 1)
    this.burst(at, 40, 30, 0.5, 1.0, new THREE.Color(3, 2.6, 1.6), 1, 0.6)
    this.wreckSmoke(at)
    if (this.role === 'host') this.fxLog.push(['x', r2(at.x), r2(at.y), r2(at.z)])
    this.sfx('boom', victim.pos)
    this.ui(victim, ['slow', 0.7])
    this.shakeFor(victim, 1)
    const weaponName = weapon === 'wall' ? 'Wall' : weapon === 'ram' ? 'Ram' : weapon[0].toUpperCase() + weapon.slice(1)
    if (by) {
      by.wrecksDealt++
      // Chain: wrecks within the window raise the multiplier.
      by.chainMult = this.time - by.lastWreckAt <= CONFIG.combat_chain_window ? Math.min(CONFIG.combat_chain_max, by.chainMult + CONFIG.combat_chain_step) : 1
      by.lastWreckAt = this.time
      let pts = CONFIG.combat_wreck
      if (leaderBefore && leaderBefore === victim) pts += CONFIG.combat_wreck_leader_bonus
      pts *= by.chainMult
      const key = `${by.id}:${eventId}`
      const count = (this.multi.get(key) ?? 0) + 1
      this.multi.set(key, count)
      if (eventId && count >= 2 && (weapon === 'barge' || weapon === 'shock' || weapon === 'mine')) pts += CONFIG.combat_multi_wreck
      by.combat += Math.round(pts)
      victim.combat = Math.max(0, victim.combat + CONFIG.combat_wrecked_penalty)
      this.addFans(by, CONFIG.fans_wreck, 'WRECK')
      if (victim.place === 1) this.addFans(by, CONFIG.fans_hit_leader, 'LEADER WRECKED')
      if (this.armed) this.ui(by, ['pop', `+${Math.round(pts)} CP${by.chainMult > 1 ? ` ×${by.chainMult}` : ''}`, '#f472b6'])
      this.ui(by, ['slow', 0.35])
      this.feed(`${by.name} wrecked ${victim.name} — ${weaponName}`, by, victim)
    } else {
      // In Deathmatch your own wrecks cost points too.
      if (this.mode === 'deathmatch') victim.combat = Math.max(0, victim.combat + CONFIG.combat_wrecked_penalty)
      this.feed(`${victim.name} wrecked — ${weaponName}`, victim, null)
    }
    this.ui(victim, ['say', 'WRECKED', '#ef4444', CONFIG.respawn_delay])
  }

  private wreckSmoke(at: THREE.Vector3) {
    for (let k = 0; k < 30; k++)
      this.smoke.emit(at, new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6), 2.2, 3, new THREE.Color(0.08, 0.07, 0.09), 0.8, 1.6, 0.8)
  }

  private addFans(car: Car, n: number, label: string) {
    if (n <= 0 || !car.human) return
    car.fans += n
    this.ui(car, ['pop', `+${n} ${label}`, '#fde047'])
    this.ui(car, ['sfx', 'fans'])
    if (this.mode === 'race' && !car.fanTargetMet && car.fans >= CONFIG.fan_target_goal) {
      car.fanTargetMet = true
      car.fans += CONFIG.fans_target
      this.ui(car, ['pop', `+${CONFIG.fans_target} FAN TARGET MET`, '#4ade80'])
      this.ui(car, ['sfx', 'crowd'])
    }
  }

  private popup(text: string, color: string) {
    this.popups.push({ id: this.popupId++, text, color, age: 0 })
    if (this.popups.length > 6) this.popups.shift()
  }

  private feed(text: string, a: Car | null, b: Car | null) {
    this.addFeed(text, !!(a?.isPlayer || b?.isPlayer))
    if (this.role === 'host') this.fxLog.push(['f', text, a ? this.cars.indexOf(a) : -1, b ? this.cars.indexOf(b) : -1])
  }

  private addFeed(text: string, mine: boolean) {
    this.killFeed.push({ id: this.popupId++, text, mine, age: 0 })
    if (this.killFeed.length > 5) this.killFeed.shift()
  }

  private say(text: string, color: string, t: number) {
    this.banner = { text, color, t }
  }

  /* ---------- Fan Runs (solo races) ---------- */

  private updateFanRuns(dt: number) {
    if (this.mode !== 'race' || this.role !== 'solo') return
    const p = this.player
    for (const icon of this.fanIcons) {
      icon.group.visible = icon.state === 'waiting' && p.lap === icon.lap
      if (icon.state !== 'waiting' || p.lap !== icon.lap || !p.alive) continue
      let ds = p.s - icon.s
      if (ds < -this.track.length / 2) ds += this.track.length
      if (Math.abs(ds) < 3 && icon.group.position.distanceTo(p.pos) < 5) {
        icon.state = 'taken'
        this.fanRunsTotal++
        const kinds: FanRunKind[] = ['drift', 'shunt', 'hit', 'pickups']
        const kind = kinds[Math.floor(Math.random() * kinds.length)]
        this.fanRun = { kind, goal: kind === 'drift' ? 100 : kind === 'pickups' ? 3 : 1, progress: 0, time: CONFIG.fan_run_duration }
        this.pickupStreak = 0
        this.say(`FAN RUN · ${FAN_RUN_LABEL[kind].toUpperCase()}`, '#ffd23f', 2)
      } else if (ds > 8 && ds < 200) {
        icon.state = 'missed'
        this.fanRunsTotal++
      }
    }
    if (this.fanRun) {
      this.fanRun.time -= dt
      if (this.fanRun.progress >= this.fanRun.goal) {
        this.fanRunsDone++
        this.addFans(p, CONFIG.fans_fan_run, 'FAN RUN')
        this.audio.crowd()
        this.say('FAN RUN COMPLETE', '#4ade80', 1.6)
        this.fanRun = null
      } else if (this.fanRun.time <= 0) {
        this.say('FAN RUN FAILED', '#f87171', 1.4)
        this.fanRun = null
      }
    }
  }

  /* ---------- Effects, camera, HUD ---------- */

  private updateEffects(dt: number) {
    const smokeCol = new THREE.Color(0.12, 0.12, 0.14)
    const fireCol = new THREE.Color(3, 1.1, 0.25)
    for (const c of this.cars) {
      const f = c.forward
      const frac = c.health / CONFIG.max_health
      const hood = c.pos.clone().addScaledVector(f, 1.3).setY(1.0)
      if (c.alive && frac < CONFIG.smoke_below && Math.random() < dt * 18)
        this.smoke.emit(hood, new THREE.Vector3((Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5).addScaledVector(c.vel, 0.3), 1.2, 1.4, smokeCol, 0.55, 2)
      if ((c.alive && frac < CONFIG.fire_below) || c.wrecked > 0)
        if (Math.random() < dt * 30) this.fx.emit(hood, new THREE.Vector3(Math.random() - 0.5, 3, Math.random() - 0.5).addScaledVector(c.vel, 0.5), 0.45, 1.0, fireCol, 0.9, 0.5)
      if (c.drifting && c.speed > 10 && Math.random() < dt * 40) {
        for (const side of [-0.9, 0.9]) {
          const p = c.pos.clone().addScaledVector(f, -1.4).addScaledVector(c.right, side).setY(0.3)
          this.smoke.emit(p, new THREE.Vector3((Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2), 0.9, 1.6, new THREE.Color(0.5, 0.5, 0.56), 0.35, 2.2, 1.2)
        }
      }
      const trails = this.nitroTrails.get(c)!
      if (c.nitro > 0 && c.alive) {
        trails.forEach((t, i) => t.push(c.pos.clone().addScaledVector(f, -c.model.shape.len / 2 - 0.1).addScaledVector(c.right, i ? 0.55 : -0.55).setY(0.55)))
        if (Math.random() < dt * 40) this.fx.emit(c.pos.clone().addScaledVector(f, -c.model.shape.len / 2).setY(0.5), f.clone().multiplyScalar(-6), 0.25, 0.9, new THREE.Color(POWER_COLORS.nitro).multiplyScalar(2))
      } else trails.forEach((t) => t.fadeOut(0.85))
    }
    this.fx.update(dt)
    this.smoke.update(dt)
    for (const p of this.popups) p.age += dt
    this.popups = this.popups.filter((p) => p.age < 1.6)
    for (const k of this.killFeed) k.age += dt
    this.killFeed = this.killFeed.filter((k) => k.age < 6)
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }
    if (this.hitFlash) {
      this.hitFlash.t -= dt
      if (this.hitFlash.t <= 0) this.hitFlash = null
    }
  }

  private animateProps(dt: number) {
    const t = this.time
    for (const p of this.pickups) {
      if (!p.available) continue
      p.group.children[0].position.y = 1.4 + Math.sin(t * 2.4 + p.s) * 0.2
      p.group.children[1].position.y = p.group.children[0].position.y
    }
    for (const f of this.fanIcons) if (f.group.visible) f.group.rotation.y += dt
  }

  private updateCamera(dt: number) {
    const p = this.player
    const cam = this.camera
    const k = 1 - Math.exp(-dt * 7)
    let wantPos: THREE.Vector3, wantLook: THREE.Vector3
    if (this.phase === 'intro') {
      const a = this.phaseTime * 0.35 + 0.6
      const c = p.pos
      wantPos = new THREE.Vector3(c.x + Math.sin(a) * 26, 9 - this.phaseTime * 0.8, c.z + Math.cos(a) * 26)
      wantLook = c.clone().setY(1)
      cam.position.lerp(wantPos, this.phaseTime < 0.05 ? 1 : k)
      cam.lookAt(wantLook)
      cam.fov = 55
      cam.updateProjectionMatrix()
      this.camPos.copy(cam.position)
      this.camLook.copy(wantLook)
      return
    }
    const f = p.forward
    const sf = Math.min(1.3, p.speed / Math.max(1, p.baseTop))
    if (p.wrecked > 0) {
      // Pull back and up over the wreck.
      wantPos = p.pos.clone().addScaledVector(f, -14).setY(11)
      wantLook = p.pos.clone().setY(1)
    } else if (this.lookBack) {
      wantPos = p.pos.clone().addScaledVector(f, 6.5).setY(2.6)
      wantLook = p.pos.clone().addScaledVector(f, -20).setY(1)
    } else {
      const dist = 7.0 + sf * 1.4
      wantPos = p.pos.clone().addScaledVector(f, -dist).setY(2.55 + sf * 0.3)
      wantLook = p.pos.clone().addScaledVector(f, 6).setY(1.1)
    }
    const snap = this.phaseTime < 0.05 && this.phase === 'countdown'
    this.camPos.lerp(wantPos, snap ? 1 : this.lookBack ? 1 : k)
    this.camLook.lerp(wantLook, snap ? 1 : this.lookBack ? 1 : Math.min(1, k * 1.6))
    cam.position.copy(this.camPos)
    if (this.shakeAmt > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shakeAmt
      cam.position.y += (Math.random() - 0.5) * this.shakeAmt * 0.6
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8)
    }
    cam.lookAt(this.camLook)
    const fov = 62 + sf * 16 + (p.nitro > 0 ? 9 : 0) + (p.boost > 0 ? 4 : 0)
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4)
    cam.updateProjectionMatrix()
  }

  private drawMinimap() {
    const cv = this.minimap
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const W = cv.width, H = cv.height
    const { minX, minZ, scale } = this.mapBounds
    const S = Math.min(W, H) * 0.86
    // Mirror x so the map matches the driver's left/right when heading +z (north up).
    const X = (x: number) => W / 2 - (x - minX) * scale * S
    const Y = (z: number) => H / 2 - (z - minZ) * scale * S
    g.clearRect(0, 0, W, H)
    g.lineJoin = 'round'
    g.beginPath()
    for (let i = 0; i <= this.track.n; i += 3) {
      const j = i % this.track.n
      if (i === 0) g.moveTo(X(this.track.px[j]), Y(this.track.pz[j]))
      else g.lineTo(X(this.track.px[j]), Y(this.track.pz[j]))
    }
    g.closePath()
    g.strokeStyle = 'rgba(15,23,42,0.85)'
    g.lineWidth = 9
    g.stroke()
    g.strokeStyle = 'rgba(34,211,238,0.85)'
    g.lineWidth = 2.5
    g.stroke()
    for (const p of this.projectiles) {
      if (p.kind !== 'mine') continue
      g.fillStyle = POWER_COLORS.mine
      g.fillRect(X(p.pos.x) - 2.5, Y(p.pos.z) - 2.5, 5, 5)
    }
    for (const d of this.domes) {
      g.strokeStyle = POWER_COLORS.shock
      g.lineWidth = 2
      g.beginPath()
      g.arc(X(d.pos.x), Y(d.pos.z), 5, 0, Math.PI * 2)
      g.stroke()
    }
    for (const c of this.cars) {
      if (c.isPlayer) continue
      g.fillStyle = c.alive ? c.model.glow : 'rgba(255,255,255,0.3)'
      g.beginPath()
      g.arc(X(c.pos.x), Y(c.pos.z), c.human ? 5.5 : 4, 0, Math.PI * 2)
      g.fill()
      if (c.human) {
        g.strokeStyle = '#ffffff'
        g.lineWidth = 1.5
        g.stroke()
      }
    }
    const p = this.player
    g.save()
    g.translate(X(p.pos.x), Y(p.pos.z))
    g.rotate(Math.PI - p.yaw)
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#0f172a'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(0, -8)
    g.lineTo(6, 6)
    g.lineTo(-6, 6)
    g.closePath()
    g.stroke()
    g.fill()
    g.restore()
  }

  private emitHud() {
    if (!this.onHud) return
    const p = this.player
    let reticle: Hud['reticle'] = null
    const slot = p.bay[p.active]
    if (slot?.type === 'shunt' && p.alive && this.phase === 'race') {
      const t = lockTarget(this, p)
      if (t) {
        const v = t.pos.clone().setY(1.2).project(this.camera)
        if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
          reticle = { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight, name: t.name }
        }
      }
    }
    let incoming: number | null = null
    const threat = incomingShunt(this, p)
    if (threat && p.alive) {
      if (threat.t < 3) this.audio.lockOn()
      if (threat.t < CONFIG.shunt_warning) {
        const d = threat.p.pos.clone().sub(p.pos)
        incoming = Math.atan2(-d.dot(p.right), d.dot(p.forward))
      }
    }
    const leader = this.combatLeader()
    const chainLeft = CONFIG.combat_chain_window - (this.time - p.lastWreckAt)
    this.onHud({
      mode: this.mode,
      phase: this.phase,
      countdown: this.phase === 'countdown' ? Math.ceil(3 - this.phaseTime) : this.phase === 'race' && this.phaseTime < 0.8 ? 0 : -1,
      intro: this.phase === 'intro' ? this.introLines : [],
      place: p.place,
      cars: this.cars.length,
      lap: THREE.MathUtils.clamp(p.lap, 1, this.laps),
      laps: this.laps,
      speed: Math.round(toKmh(Math.max(0, p.forwardSpeed))),
      nitro: p.nitro,
      boosting: p.boost > 0,
      health: p.health,
      shield: p.shield,
      invuln: p.invuln > 0,
      wrecked: p.wrecked,
      bay: p.bay.map((s) => (s ? { ...s } : null)),
      active: p.active,
      reticle,
      incoming,
      popups: this.popups.map((x) => ({ ...x })),
      fans: p.fans,
      fanTarget: CONFIG.fan_target_goal,
      fanRun: this.fanRun ? { label: FAN_RUN_LABEL[this.fanRun.kind], progress: this.fanRun.progress, goal: this.fanRun.goal, time: this.fanRun.time } : null,
      killFeed: this.killFeed.map(({ id, text, mine }) => ({ id, text, mine })),
      chain: this.armed && p.chainMult > 1 && chainLeft > 0 ? { mult: p.chainMult, time: chainLeft } : null,
      combat: this.armed
        ? { score: p.combat, timeLeft: Math.max(0, this.timeLimit - this.raceTime), leader: leader?.name ?? '—', leaderScore: leader?.combat ?? 0 }
        : null,
      banner: this.banner ? { text: this.banner.text, color: this.banner.color } : null,
      hitFlash: this.hitFlash?.color ?? null,
      hitFlashAmt: this.hitFlash ? this.hitFlash.t / 0.6 : 0,
      lookBack: this.lookBack,
      paused: this.paused,
      online: this.online,
    })
  }

  /* ---------- Results ---------- */

  private results(me: Car): RaceResult {
    this.rank()
    // Combat Points and Deathmatch rank by points; a race ranks by finishing order.
    const order = [...this.cars].sort((a, b) => (this.armed ? b.combat - a.combat || a.place - b.place : a.place - b.place))
    const rows: ResultRow[] = order.map((c, i) => ({
      name: c.name, car: c.model.name, place: i + 1, time: c.finished ? c.finishTime : null, combat: c.combat,
      wrecks: c.wrecksDealt, isPlayer: c === me, human: c.human, color: c.model.glow,
    }))
    const place = order.indexOf(me) + 1
    const position = this.mode !== 'race' ? 0 : place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0
    const fanTarget = me.fanTargetMet && this.mode === 'race' ? 1 : 0
    const solo = this.role === 'solo'
    const fanRuns = solo && this.fanRunsTotal > 0 && this.fanRunsDone === this.fanRunsTotal && this.fanRunsTotal === this.laps ? 1 : 0
    const top = (f: (c: Car) => number, fmt: (v: number) => string, title: string, min = false) => {
      const sorted = [...this.cars].sort((a, b) => (min ? f(a) - f(b) : f(b) - f(a)))
      const c = sorted[0]
      // Nobody earns "most" of something with zero of it.
      if (!min && f(c) <= 0) return { title, name: '—', value: '' }
      return { title, name: c.name, value: fmt(f(c)) }
    }
    for (const c of this.cars) if (c.drifting) c.longestDrift = Math.max(c.longestDrift, c.driftDist)
    return {
      mode: this.mode,
      round: this.opts.round,
      track: this.track.name,
      rows,
      place,
      fans: me.fans,
      fanTargetMet: me.fanTargetMet,
      fanRunsDone: solo ? this.fanRunsDone : 0,
      fanRunsTotal: solo ? Math.max(this.fanRunsTotal, this.mode === 'race' ? this.laps : 0) : 0,
      lights: { position, fanTarget, fanRuns, total: position + fanTarget + fanRuns },
      awards: [
        top((c) => c.shuntHits, (v) => `${v} hits`, 'Most Shunt Hits'),
        top((c) => c.longestDrift, (v) => `${Math.round(v)} m`, 'Longest Drift'),
        top((c) => c.wrecksDealt, (v) => `${v} wrecks`, 'Most Wrecks'),
        top((c) => c.damageTaken, (v) => `${v} damage taken`, 'Cleanest Driver', true),
      ],
      combat: Object.fromEntries(this.cars.map((c) => [c.name, c.combat])),
      online: this.online,
    }
  }
}

/* ---------- Snapshot types ---------- */

interface Snapshot {
  ph: number
  pt: number
  rt: number
  c: (number | string)[][]
  p: number[][]
  d: number[][]
  k: string
  fx: unknown[]
  t: number
}

type FxEvent =
  | ['b', number, number, number, number, number, number, number, number, number, number, number, number, number]
  | ['s', string, number, number]
  | ['r', number, number]
  | ['x', number, number, number]
  | ['f', string, number, number]

function parseBay(s: string) {
  return s.split(',').map((x) => (x ? { type: POWER_TYPES[Number(x[0])], count: Number(x.slice(1)) } : null))
}

/* ---------- Sky ---------- */

function skyDome() {
  const g = new THREE.Group()
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(0.32, 0.09, 0.36);
        vec3 mid = vec3(0.07, 0.04, 0.17);
        vec3 top = vec3(0.01, 0.01, 0.04);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, top, smoothstep(0.18, 0.7, h));
        c += vec3(0.9, 0.3, 0.6) * pow(max(0.0, 1.0 - abs(h) * 6.0), 4.0) * 0.25;
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  )
  sky.renderOrder = -1
  g.add(sky)
  const n = 1400
  const pos = new Float32Array(n * 3)
  const rnd = mulberry32(3)
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2
    const y = 0.08 + rnd() * 0.92
    const r = Math.sqrt(1 - y * y)
    pos.set([Math.cos(a) * r * 1800, y * 1800, Math.sin(a) * r * 1800], i * 3)
  }
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#dbe4ff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })))
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(2.2, 2.2, 2.6), fog: false, depthWrite: false, toneMapped: false }))
  moon.position.set(-700, 900, 600)
  moon.scale.setScalar(160)
  g.add(moon)
  return g
}
