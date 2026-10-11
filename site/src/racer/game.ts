// VOLT RIOT engine: scene, race flow, input, scoring (Fan Points and Combat Points), camera and HUD feed.
import * as THREE from 'three'
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CONFIG, kmh, toKmh } from './config'
import { CARS, DRIVERS, type CarModel } from './cars'
import { Car } from './car'
import { Track, buildTrackScene, mulberry32, POWER_COLORS, type PowerType } from './track'
import type { RacerAssets } from './assets'
import { Particles, Trail, glyphTexture, fanRunTexture } from './fx'
import { RacerAudio } from './audio'
import { aiDrive } from './ai'
import { fire, fireBolt, incomingShunt, lockTarget, updateWeapons, type Dome, type Projectile, type Ring } from './weapons'
import { radialTexture } from './cars'

export type Mode = 'race' | 'combat'
export type Phase = 'intro' | 'countdown' | 'race' | 'finished'
export type Weapon = PowerType | 'wall' | 'ram'

export interface GameOptions {
  mode: Mode
  carId: string
  difficulty: number // 0 Easy, 1 Normal, 2 Hard
  round: number // Combat Points track index (0-based)
  autopilot?: boolean
  assets?: RacerAssets
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

export interface HudPopup {
  id: number
  text: string
  color: string
  age: number
}

export interface Hud {
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
}

export interface ResultRow {
  name: string
  car: string
  place: number
  time: number | null
  combat: number
  wrecks: number
  isPlayer: boolean
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
}

const KEYMAP: Record<string, string> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake', ShiftLeft: 'fire', ShiftRight: 'fire', KeyJ: 'fire', KeyK: 'fireBack', Tab: 'cycle', KeyQ: 'cycle',
  KeyX: 'discard', KeyC: 'look', Escape: 'pause', KeyP: 'pause', KeyR: 'reset', KeyM: 'music', Enter: 'skip',
}

const RACE_WEIGHTS: Partial<Record<PowerType, number>> = { shunt: 18, nitro: 18, mine: 16, bolt: 14, barge: 12, shield: 9, shock: 6, repair: 6 }
const SUPPORT_WEIGHTS: Partial<Record<PowerType, number>> = { repair: 1, shield: 1 }

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

const TRACK_NAMES = ['Harbor Loop', 'Harbor Loop Reverse', 'Harbor Loop Overdrive']

export class Game {
  readonly opts: GameOptions
  readonly mode: Mode
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
  paused = false
  onHud: ((h: Hud) => void) | null = null
  onFinish: ((r: RaceResult) => void) | null = null
  onPause: ((p: boolean) => void) | null = null
  minimap: HTMLCanvasElement | null = null

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
  private boltHold: { backward: boolean; t: number; next: number } | null = null
  private throttleEdgeAt: number | null = null
  private throttleWasDown = false
  private fans = 0
  private fanTargetMet = false
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
    if (document.hidden && this.phase !== 'finished') this.setPaused(true)
  }

  constructor(container: HTMLElement, opts: GameOptions) {
    this.container = container
    this.opts = opts
    this.mode = opts.mode
    this.laps = opts.mode === 'combat' ? CONFIG.combat_laps : CONFIG.race_laps

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
    if (this.mode === 'race') this.spawnFanRuns()
    this.prepareMinimap()
    this.introLines = this.makeIntro()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.hidden)
  }

  /* ---------- Setup ---------- */

  private spawnCars() {
    const playerModel = CARS.find((c) => c.id === this.opts.carId) ?? CARS[0]
    const cls = playerModel.cls
    const skill = this.mode === 'combat' ? CONFIG.ai_combat_skill : CONFIG.ai_skill[this.opts.difficulty] ?? 0.6
    const rnd = mulberry32(42 + this.opts.round)
    const drivers = DRIVERS.slice(0, CONFIG.race_cars - 1)
    // Player starts mid-grid.
    const order: (number | 'player')[] = drivers.map((_, i) => i)
    order.splice(Math.min(order.length, 4), 0, 'player')
    order.forEach((who, slot) => {
      let car: Car
      if (who === 'player') {
        car = new Car(slot, playerModel, { player: true, name: 'You', cls, glb: this.opts.assets?.cars.get(playerModel.id) })
        this.player = car
      } else {
        const d = drivers[who]
        const m: CarModel = CARS.find((c) => c.id === d.car) ?? CARS[who % CARS.length]
        car = new Car(slot, m, { name: d.name, driver: d, skill: THREE.MathUtils.clamp(skill + (rnd() - 0.5) * 0.1, 0.3, 1), cls, glb: this.opts.assets?.cars.get(m.id) })
        car.ai.laneOffset = (rnd() - 0.5) * 6
      }
      const row = Math.floor(slot / 2)
      const s = this.track.length - 8 - row * 10
      car.placeAt(this.track, s, slot % 2 === 0 ? -3.6 : 3.6)
      car.s = s
      car.cpPassed = this.track.checkpoints.length
      car.progress = s
      car.safeS = s
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
    if (this.mode === 'combat') {
      // Weapons only: no Nitro or Repair, Shield rare; the last track doubles Shock and Mine.
      const finale = this.opts.round >= CONFIG.combat_tracks - 1 ? CONFIG.finale_hazard_mult : 1
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
    const lines = [
      this.mode === 'combat'
        ? `DJ STATIC: Combat Points, round ${this.opts.round + 1} of ${CONFIG.combat_tracks} on ${this.track.name}. Wrecks pay. Position barely does.`
        : `DJ STATIC: Lights up on ${this.track.name}. ${this.laps} laps, ${this.cars.length} cars, one podium.`,
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

  setPaused(p: boolean) {
    if (this.paused === p) return
    this.paused = p
    this.audio.setPaused(p)
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

  /* ---------- Frame ---------- */

  /** Test hook (exposed with ?snap): advance the simulation without rendering. */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    this.frame(step, true)
  }

  /** Test hook: a compact snapshot of the race state. */
  debugState() {
    return {
      phase: this.phase,
      raceTime: +this.raceTime.toFixed(1),
      fans: this.fans,
      projectiles: this.projectiles.length,
      domes: this.domes.length,
      feed: this.killFeed.map((k) => k.text),
      cars: this.cars.map((c) => ({
        name: c.name, place: c.place, lap: c.lap, cp: c.cpPassed, s: Math.round(c.s), kmh: Math.round(toKmh(c.speed)), hp: c.health,
        bay: c.bay.map((b) => (b ? `${b.type}x${b.count}` : '-')).join(','), hits: c.hits, wrecks: c.wrecksDealt, wrecked: c.wrecksTaken,
        combat: c.combat, finished: c.finished, lat: +c.lateral.toFixed(1),
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
    if (this.paused) {
      if (render) this.composer.render(realDt)
      return
    }
    if (this.slowmo > 0) this.slowmo -= realDt
    const dt = realDt * (this.slowmo > 0 ? 0.35 : 1)
    this.time += dt
    this.phaseTime += dt

    if (this.phase === 'intro') {
      if (pressed.has('skip') || pressed.has('up') || pressed.has('fire') || this.phaseTime > 5.5 || pad?.fire) this.setPhase('countdown')
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

    this.playerInput(dt, pressed, pad)
    const racing = this.phase === 'race' || this.phase === 'finished'
    for (const c of this.cars) {
      if (!c.isPlayer || this.opts.autopilot || c.finished) {
        if (racing) aiDrive(this, c, dt)
        else {
          c.input.throttle = 0
          c.input.brake = 1
        }
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
    this.updateEffects(dt)
    for (const c of this.cars) c.syncMesh(dt, this.time)
    this.animateProps(dt)
    this.updateCamera(realDt)
    // Rival tags: hidden when very close to the camera (they would fill the screen) or far away.
    for (const c of this.cars) {
      if (!c.label) continue
      const d = c.pos.distanceTo(this.camera.position)
      c.label.visible = c.alive && d > 11 && d < 220
    }
    this.audio.update(dt, this.player.speed / Math.max(1, this.player.top), this.player.input.throttle, this.player.nitro > 0, this.phase !== 'intro')
    if (!render) return
    this.composer.render(dt)
    this.drawMinimap()
    this.emitHud(dt)
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.phaseTime = 0
  }

  private playerInput(dt: number, pressed: Set<string>, pad: ReturnType<Game['readPad']>) {
    const p = this.player
    const k = this.keys
    if (this.opts.autopilot || p.finished) {
      this.lookBack = false
      return
    }
    const throttle = Math.max(k.has('up') ? 1 : 0, pad?.throttle ?? 0)
    const brake = Math.max(k.has('down') ? 1 : 0, pad?.brake ?? 0)
    let steer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)
    // Smooth keyboard steering; analogue sticks pass straight through.
    if (pad?.steer) this.steerSmooth = pad.steer
    else {
      const rate = steer === 0 || Math.sign(steer) !== Math.sign(this.steerSmooth) ? 9 : 5
      this.steerSmooth += THREE.MathUtils.clamp(steer - this.steerSmooth, -rate * dt, rate * dt)
    }
    steer = this.steerSmooth
    p.input.throttle = throttle
    p.input.brake = brake
    p.input.steer = steer
    p.input.handbrake = k.has('handbrake') || !!pad?.handbrake
    this.lookBack = k.has('look') || !!pad?.look

    // Burnout start: remember when the throttle went down.
    const down = throttle > 0.5
    if (down && !this.throttleWasDown && (this.phase === 'countdown' || (this.phase === 'race' && this.phaseTime < 1))) {
      this.throttleEdgeAt = this.phase === 'countdown' ? this.phaseTime - 3 : this.phaseTime
      if (this.phase === 'race') this.lateLaunch()
    }
    this.throttleWasDown = down

    if (this.phase === 'intro' || this.phase === 'countdown') return
    if (pressed.has('cycle') || pad?.cycle) p.cycle()
    if (pressed.has('discard') || pad?.discard) p.discard()
    if (pressed.has('reset')) this.instantReset(p)
    const fwd = pressed.has('fire') || !!pad?.fire
    const back = pressed.has('fireBack') || !!pad?.fireBack
    if (fwd || back) {
      if (!p.bay[p.active]) p.cycle()
      const slot = p.bay[p.active]
      if (slot?.type === 'bolt') {
        // Tap fires one bolt; holding fires the rest.
        if (p.consume()) {
          fireBolt(this, p, back && !fwd)
          this.audio.fire('bolt')
          this.onFired(p, 'bolt', back && !fwd)
          this.boltHold = { backward: back && !fwd, t: 0, next: CONFIG.bolt_hold_delay }
        }
      } else fire(this, p, back && !fwd)
    }
    if (this.boltHold) {
      const held = this.boltHold.backward ? k.has('fireBack') || !!pad?.fireBackHeld : k.has('fire') || !!pad?.fireHeld
      const slot = p.bay[p.active]
      if (!held || slot?.type !== 'bolt') this.boltHold = null
      else {
        this.boltHold.t += dt
        if (this.boltHold.t >= this.boltHold.next) {
          this.boltHold.next += CONFIG.bolt_hold_interval
          if (p.consume()) {
            fireBolt(this, p, this.boltHold.backward)
            this.audio.fire('bolt')
          }
        }
      }
    }
  }

  private launch() {
    for (const c of this.cars) {
      if (c.isPlayer && !this.opts.autopilot) continue
      if (Math.random() < c.skill * 0.6) c.boost = CONFIG.launch_boost
    }
    const p = this.player
    if (this.opts.autopilot) return
    const t = this.throttleEdgeAt
    if (t !== null && p.input.throttle > 0.5) {
      if (Math.abs(t) <= CONFIG.launch_window) this.perfectLaunch()
      else if (t < -CONFIG.launch_window) {
        p.bog = 0.7
        this.say('WHEELSPIN', '#f87171', 1)
      }
    }
  }

  private lateLaunch() {
    const t = this.throttleEdgeAt
    if (t !== null && t <= CONFIG.launch_window && this.player.boost <= 0 && this.player.bog <= 0 && this.phaseTime < CONFIG.launch_window + 0.05) this.perfectLaunch()
  }

  private perfectLaunch() {
    this.player.boost = CONFIG.launch_boost
    this.addFans(CONFIG.fans_perfect_launch, 'PERFECT LAUNCH')
  }

  /* ---------- Simulation ---------- */

  private afterStep(c: Car, dt: number) {
    // Wall hits: damage above the threshold, instant reset on a head-on hit.
    if (c.alive && c.wallImpact > 0) {
      const sp = c.speed
      if (c.wallImpact > 3 && c.isPlayer) {
        this.audio.wall()
        this.shake(Math.min(0.5, c.wallImpact * 0.04))
      }
      if (c.wallImpact > 3) this.fx.burst(c.pos.clone().setY(0.6), 10, 8, 0.4, 0.4, new THREE.Color(3, 2.2, 1.2))
      const before = sp + c.wallImpact
      if (c.wallImpact > 4 && toKmh(before) > CONFIG.wall_hit_damage_threshold && c.wallCooldown <= 0) {
        c.wallCooldown = 0.6
        c.vel.multiplyScalar(0.8)
        this.damage(c, 1, { weapon: 'wall', effect: 'none' })
      }
      if (c.alive && c.wallImpact > Math.max(25, before * 0.8)) this.instantReset(c)
    }
    // Stuck or off course: reset.
    if (c.alive && this.phase === 'race' && c.speed < 1.5 && (c.input.throttle > 0 || !c.isPlayer)) {
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
        else if (c.isPlayer && c.lap === this.laps && this.laps > 1) this.say('FINAL LAP', '#fde047', 1.6)
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

    // Drift Fan Points (player).
    if (c.isPlayer && c.drifting && c.speed > 12) {
      c.driftFanAcc += dt
      if (this.fanRun?.kind === 'drift') this.fanRun.progress += c.speed * dt
      while (c.driftFanAcc >= 1) {
        c.driftFanAcc -= 1
        this.addFans(CONFIG.fans_drift_per_s, 'DRIFT')
      }
    } else if (c.isPlayer) c.driftFanAcc = 0

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
    if (this.mode === 'combat') {
      const bonus = CONFIG.combat_finish[this.finishOrder.length - 1] ?? 0
      c.combat += bonus
    }
    if (c.isPlayer) {
      const place = c.place
      if (this.mode === 'race') {
        const fans = CONFIG.fans_finish[place - 1] ?? 0
        if (fans) this.addFans(fans, `FINISH P${place}`)
      }
      this.say(place === 1 ? 'WINNER' : `FINISHED P${place}`, place <= 3 ? '#fde047' : '#e2e8f0', 3)
    }
  }

  private checkEnd() {
    if (this.resultSent) return
    const timeUp = this.mode === 'combat' && this.raceTime >= CONFIG.combat_track_time_limit
    if (this.player.finished || timeUp) {
      if (this.phase !== 'finished') {
        this.setPhase('finished')
        if (timeUp) this.say('TIME', '#fde047', 3)
      }
      if (this.phaseTime > 2.2) {
        this.resultSent = true
        this.onFinish?.(this.results())
      }
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
              const j = (-(1 + 0.3) * vrel) / 1
              A.vel.addScaledVector(n, (-j * wa) / (wa + wb))
              B.vel.addScaledVector(n, (j * wb) / (wa + wb))
              if (!hit && -vrel > kmh(CONFIG.ram_damage_threshold)) this.ram(A, B)
              hit = true
            }
          }
        }
        // Near miss / draft for the player.
        if (!hit && (A.isPlayer || B.isPlayer)) {
          const other = A.isPlayer ? B : A
          const me = A.isPlayer ? A : B
          const gap = me.pos.distanceTo(other.pos) - 2.2
          const rel = me.vel.clone().sub(other.vel).length()
          if (gap > 0 && gap < CONFIG.near_miss_distance && rel > CONFIG.near_miss_speed && this.phase === 'race') {
            const last = this.nearMiss.get(other.id) ?? -99
            if (this.time - last > 3) {
              this.nearMiss.set(other.id, this.time)
              this.addFans(CONFIG.fans_near_miss, 'NEAR MISS')
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
    if (A.isPlayer || B.isPlayer) {
      this.audio.hit(false)
      this.shake(0.3)
    }
    this.fx.burst(A.pos.clone().lerp(B.pos, 0.5).setY(0.8), 16, 9, 0.4, 0.5, new THREE.Color(3, 2.4, 1.4))
  }

  private updatePickups(dt: number) {
    const respawn = this.mode === 'combat' ? CONFIG.combat_pickup_respawn : CONFIG.pickup_respawn
    this.refuseCooldown -= dt
    const r2 = CONFIG.pickup_radius ** 2
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
        if (dx * dx + dz * dz > r2) continue
        if (c.isPlayer) this.touchRow(p.row)
        if (c.give(p.type)) {
          p.available = false
          p.timer = respawn
          p.group.visible = false
          if (c.isPlayer) this.audio.pickup(p.type)
          this.fx.burst(p.pos.clone().setY(1.4), 18, 7, 0.45, 0.8, new THREE.Color(POWER_COLORS[p.type]).multiplyScalar(2))
          break
        } else if (c.isPlayer && this.refuseCooldown <= 0) {
          this.refuseCooldown = 1
          this.audio.refused()
          this.say('BAY FULL · X TO DISCARD', '#f87171', 1)
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
    const ref = this.player.baseTop * 0.75
    const lead = Math.max(...this.cars.map((c) => c.progress))
    for (const c of this.cars) {
      if (c.isPlayer && !this.opts.autopilot) continue
      const behindLeader = (lead - c.progress) / ref
      const aheadOfPlayer = (c.progress - this.player.progress) / ref
      c.rubber = 1 + (behindLeader > CONFIG.ai_rubberband_gap ? CONFIG.ai_rubberband_mult : 0) - (aheadOfPlayer > CONFIG.ai_rubberband_gap ? CONFIG.ai_rubberband_mult : 0)
      c.topCap = this.player.baseTop * (1 + CONFIG.ai_max_topspeed_over_player)
    }
  }

  /** Rank by lap, then checkpoint, then distance along the track (progress covers all three). */
  private rank() {
    const sorted = [...this.cars].sort((a, b) => {
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

  onFired(car: Car, _type: PowerType, _backward: boolean) {
    void _type
    void _backward
    if (car.isPlayer) this.shake(0.08)
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
      this.fx.burst(victim.pos.clone().setY(1), 40, 10, 0.5, 0.8, new THREE.Color(2.5, 2.5, 2.8))
      if (victim.isPlayer || this.near(victim.pos, 80)) this.audio.shieldBreak()
      if (victim.isPlayer) this.say('SHIELD BLOCKED', '#e0f2fe', 0.9)
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
      this.fx.burst(victim.pos.clone().setY(1), 24, 9, 0.5, 0.9, new THREE.Color(color).multiplyScalar(2.2))
      if (victim.isPlayer || by?.isPlayer || this.near(victim.pos, 90)) this.audio.hit(amount >= 3)
    }
    if (victim.isPlayer) {
      this.hitFlash = { color, t: 0.6 }
      this.shake(amount >= 3 ? 0.7 : 0.25)
    }
    if (by && o.weapon !== 'wall') {
      if (o.weapon !== 'ram') {
        by.hits++
        if (o.weapon === 'shunt') by.shuntHits++
      }
      if (victim.health > 0 && o.weapon !== 'ram') {
        by.combat += CONFIG.combat_hit
        if (by.isPlayer) {
          this.addFans(CONFIG.fans_hit, 'HIT')
          if (victim.place === 1) this.addFans(CONFIG.fans_hit_leader, 'LEADER HIT')
          if (this.fanRun && (this.fanRun.kind === 'hit' || (this.fanRun.kind === 'shunt' && o.weapon === 'shunt'))) this.fanRun.progress++
        }
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
    this.fx.burst(at, 90, 20, 1.0, 2.2, new THREE.Color(3, 1.3, 0.35), 1, 1.2, 1)
    this.fx.burst(at, 40, 30, 0.5, 1.0, new THREE.Color(3, 2.6, 1.6), 1, 0.6)
    for (let k = 0; k < 30; k++) this.smoke.emit(at, new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6), 2.2, 3, new THREE.Color(0.08, 0.07, 0.09), 0.8, 1.6, 0.8)
    if (victim.isPlayer || by?.isPlayer || this.near(victim.pos, 120)) this.audio.explosion()
    if (victim.isPlayer) {
      this.slowmo = 0.7
      this.shake(1)
      this.wreckCam.copy(this.camera.position)
    }
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
      if (by.isPlayer) {
        this.addFans(CONFIG.fans_wreck, 'WRECK')
        if (victim.place === 1) this.addFans(CONFIG.fans_hit_leader, 'LEADER WRECKED')
        if (this.mode === 'combat') this.popup(`+${Math.round(pts)} CP${by.chainMult > 1 ? ` ×${by.chainMult}` : ''}`, '#f472b6')
        this.slowmo = Math.max(this.slowmo, 0.35)
      }
      this.feed(`${by.name} wrecked ${victim.name} — ${weaponName}`, by.isPlayer || victim.isPlayer)
    } else this.feed(`${victim.name} wrecked — ${weaponName}`, victim.isPlayer)
    if (victim.isPlayer) this.say('WRECKED', '#ef4444', CONFIG.respawn_delay)
  }

  private wreckCam = new THREE.Vector3()

  private addFans(n: number, label: string) {
    if (n <= 0) return
    this.fans += n
    this.popup(`+${n} ${label}`, '#fde047')
    this.audio.fans()
    if (this.mode === 'race' && !this.fanTargetMet && this.fans >= CONFIG.fan_target_goal) {
      this.fanTargetMet = true
      this.fans += CONFIG.fans_target
      this.popup(`+${CONFIG.fans_target} FAN TARGET MET`, '#4ade80')
      this.audio.crowd()
    }
  }

  private popup(text: string, color: string) {
    this.popups.push({ id: this.popupId++, text, color, age: 0 })
    if (this.popups.length > 6) this.popups.shift()
  }

  private feed(text: string, mine: boolean) {
    this.killFeed.push({ id: this.popupId++, text, mine, age: 0 })
    if (this.killFeed.length > 5) this.killFeed.shift()
  }

  private say(text: string, color: string, t: number) {
    this.banner = { text, color, t }
  }

  /* ---------- Fan Runs ---------- */

  private updateFanRuns(dt: number) {
    if (this.mode !== 'race') return
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
        this.addFans(CONFIG.fans_fan_run, 'FAN RUN')
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
        if (Math.random() < dt * 30) this.fx.emit(hood, new THREE.Vector3((Math.random() - 0.5), 3, (Math.random() - 0.5)).addScaledVector(c.vel, 0.5), 0.45, 1.0, fireCol, 0.9, 0.5)
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
      g.arc(X(c.pos.x), Y(c.pos.z), 4, 0, Math.PI * 2)
      g.fill()
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

  private emitHud(dt: number) {
    void dt
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
      fans: this.fans,
      fanTarget: CONFIG.fan_target_goal,
      fanRun: this.fanRun ? { label: FAN_RUN_LABEL[this.fanRun.kind], progress: this.fanRun.progress, goal: this.fanRun.goal, time: this.fanRun.time } : null,
      killFeed: this.killFeed.map(({ id, text, mine }) => ({ id, text, mine })),
      chain: this.mode === 'combat' && p.chainMult > 1 && chainLeft > 0 ? { mult: p.chainMult, time: chainLeft } : null,
      combat:
        this.mode === 'combat'
          ? { score: p.combat, timeLeft: Math.max(0, CONFIG.combat_track_time_limit - this.raceTime), leader: leader?.name ?? '—', leaderScore: leader?.combat ?? 0 }
          : null,
      banner: this.banner ? { text: this.banner.text, color: this.banner.color } : null,
      hitFlash: this.hitFlash?.color ?? null,
      hitFlashAmt: this.hitFlash ? this.hitFlash.t / 0.6 : 0,
      lookBack: this.lookBack,
      paused: this.paused,
    })
  }

  /* ---------- Results ---------- */

  private results(): RaceResult {
    this.rank()
    // Combat Points ranks by points; a race ranks by finishing order.
    const order = [...this.cars].sort((a, b) => (this.mode === 'combat' ? b.combat - a.combat || a.place - b.place : a.place - b.place))
    const rows: ResultRow[] = order.map((c, i) => ({
      name: c.name, car: c.model.name, place: i + 1, time: c.finished ? c.finishTime : null, combat: c.combat,
      wrecks: c.wrecksDealt, isPlayer: c.isPlayer, color: c.model.glow,
    }))
    const p = this.player
    const place = order.indexOf(p) + 1
    const position = place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0
    const fanTarget = this.fanTargetMet ? 1 : 0
    const fanRuns = this.fanRunsTotal > 0 && this.fanRunsDone === this.fanRunsTotal && this.fanRunsTotal === this.laps ? 1 : 0
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
      fans: this.fans,
      fanTargetMet: this.fanTargetMet,
      fanRunsDone: this.fanRunsDone,
      fanRunsTotal: Math.max(this.fanRunsTotal, this.mode === 'race' ? this.laps : 0),
      lights: { position, fanTarget, fanRuns, total: position + fanTarget + fanRuns },
      awards: [
        top((c) => c.shuntHits, (v) => `${v} hits`, 'Most Shunt Hits'),
        top((c) => c.longestDrift, (v) => `${Math.round(v)} m`, 'Longest Drift'),
        top((c) => c.wrecksDealt, (v) => `${v} wrecks`, 'Most Wrecks'),
        top((c) => c.damageTaken, (v) => `${v} damage taken`, 'Cleanest Driver', true),
      ],
      combat: Object.fromEntries(this.cars.map((c) => [c.name, c.combat])),
    }
  }
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
