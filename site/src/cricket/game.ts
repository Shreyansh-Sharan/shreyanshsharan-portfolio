// The cricket game in the browser: renderer, stadium, players, ball, the match director, input, cameras (broadcast
// view behind the bowler's arm, ball-following, replays, ball tracking), sound and the feed for the React HUD.
import * as THREE from 'three'
import type { CricketAssets } from './assets'
import { CricketAudio } from './audio'
import { QUALITY, type QualitySettings, type QualityTier } from './quality'
import { ACTORS, Director, FIRST_FIELDER, NONSTRIKER, STRIKER, UMP_BOWLER, UMP_SQUARE, type Actor, type Command, type GameEvent, type Phase, type Pose } from './sim/director'
import { DELIVERIES, deliveriesFor, isSpinStyle, type DeliveryType } from './sim/delivery'
import { PRESET_ORDER, type FieldPreset } from './sim/fields'
import { Geo, inward, stumpsZ } from './sim/geo'
import { ballSymbol, oversText, runRate, scoreText, type MatchSetup } from './sim/match'
import { PERFECT, shotSpec, type Footwork, type ShotType, type Timing } from './sim/shots'
import { bat01, styleName, surname, type Team } from './sim/teams'
import { V3 } from './sim/vec'
import { toView, yawToView } from './view/coords'
import { procPose, type PoseCtx } from './view/poses'
import { makeBall, makeMarker, Wicket } from './view/props'
import { Cricketer, type ClipName, type KitKind } from './view/rig'
import { Stadium } from './view/stadium'
import { Hawkeye } from './view/hawkeye'
import { Guides, lengthWords, type ShotColour } from './view/guides'
import type { Post } from './view/post'

export interface GameOptions {
  setup: MatchSetup
  sideHuman: [boolean, boolean]
  localSide: number
  quality: QualityTier
  assets: CricketAssets
  /** The CPU plays for the human side too (tests, attract mode). */
  autopilot?: boolean
  /** Test hook: no live loop; advance with simulate(). */
  snap?: boolean
  /** Online: this browser only displays the host's match (a guest). */
  mirror?: boolean
  online?: boolean
}

export interface HudBatter {
  name: string
  runs: number
  balls: number
  onStrike: boolean
  left: boolean
}

export interface HudState {
  phase: Phase
  batting: { name: string; short: string; color: string }
  fielding: { name: string; short: string; color: string }
  score: string
  overs: string
  maxOvers: number
  runRate: string
  target: number
  need: string
  powerplay: boolean
  superOver: boolean
  freeHit: boolean
  batters: HudBatter[]
  bowler: { name: string; figures: string; style: string; stamina: number } | null
  thisOver: string[]
  partnership: string
  lastKmh: number
  timing: string
  shotNote: string
  confidence: number
  localBats: boolean
  localBowls: boolean
  meter: { value: number; green: number; half: number; running: boolean } | null
  delivery: { selected: DeliveryType; options: { type: DeliveryType; name: string; key: string }[]; around: boolean } | null
  preset: FieldPreset
  aim: { x: number; y: number; feet: Footwork }
  review: { active: boolean; kind: string; time: number; duration: number; pitching: string; impact: string; wickets: string; outcome: string; finalOut: boolean; edge: boolean; reviewing: string } | null
  reviewPrompt: { seconds: number; side: number; canAd: boolean; reviewsLeft: number } | null
  toss: { stage: 'call' | 'choose' | 'wait'; winner: string; result: string; youWon: boolean } | null
  chooseBowler: { options: { player: number; name: string; style: string; figures: string; overs: string }[] } | null
  inningsBreak: { summary: string; next: string } | null
  matchEnd: { result: string; winner: number } | null
  replay: boolean
  banner: string
  bannerSub: string
  bannerTime: number
  camera: string
  paused: boolean
  live: boolean
  running: boolean
  quality: QualityTier
  reviewsLeft: number
  /** The delivery just bowled (shown as a card for a few seconds after release). */
  card: { bowler: string; kmh: number; type: string; spin: boolean; words: string; age: number } | null
  /** Timing of the last six shots (newest last). */
  timings: Timing[]
  nets: boolean
  difficulty: number
  /** The bowler's marker in words ("Good length, outside off"). */
  markerWords: string
  /** The batter's held aim in degrees (null when none) and the last shot type pressed. */
  aimDeg: number | null
  shotKind: ShotColour
  /** Seconds until the bat should meet the ball (negative once it has passed), -1 when no ball is in flight. */
  toContact: number
}

interface FrameRec {
  actors: Float32Array
  poses: string[]
  ball: [number, number, number, number]
}

const ACTOR_FIELDS = 12
const POSES: Pose[] = ['hidden', 'idle', 'walk', 'run', 'stance', 'shot', 'slide', 'batslide', 'runup', 'deliver', 'follow', 'keeper', 'keepertake', 'ready', 'dive', 'catch', 'pickup', 'throw', 'celebrate', 'appeal', 'dejected', 'umpire', 'signal', 'leave', 'hit', 'getup']

const v3 = (a: number[] | V3) => toView(a as V3)

type CamMode = 'broadcast' | 'batter' | 'follow' | 'orbit' | 'replay' | 'hawk' | 'high'
type UserCam = 'batter' | 'broadcast' | 'high'
const BAT_CAMS: UserCam[] = ['batter', 'broadcast', 'high']
const FIELD_CAMS: UserCam[] = ['broadcast', 'high']
const TIMING_NAMES: Timing[] = ['noshot', 'veryearly', 'early', 'perfect', 'late', 'verylate']
/** Seconds before contact at which to press the shot (the stroke's lead time). */
const SHOT_LEAD = shotSpec('drive').lead

export class Game {
  container: HTMLElement
  opts: GameOptions
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(24, 1, 0.1, 900)
  quality: QualitySettings
  director: Director
  stadium: Stadium
  audio = new CricketAudio()
  hawk: Hawkeye
  private people: (Cricketer | null)[] = new Array(ACTORS).fill(null)
  private kitTeam = -1
  private ball: THREE.Mesh
  private ballShadow: THREE.Mesh
  private trail: THREE.Line
  private trailPts: THREE.Vector3[] = []
  private wickets: Wicket[]
  private marker: THREE.Group
  private guides = new Guides()
  private zonesFor = ''
  private ghostPts: THREE.Vector3[] = []
  private timingFlash = 0
  private shotKind: ShotColour = 'none'
  private card: HudState['card'] = null
  private timings: Timing[] = []
  private camMode: CamMode = 'orbit'
  private camPos = new THREE.Vector3(0, 30, -90)
  private camLook = new THREE.Vector3(0, 0, 0)
  private camFov = 30
  /** The player's camera choice while batting and while bowling or watching (C cycles the relevant one). */
  private batCam: UserCam = 'batter'
  private fieldCam: UserCam = 'broadcast'
  private raf = 0
  private last = 0
  private time = 0
  private paused = false
  /** Frozen behind an overlay (the how-to-play card): like paused, but without the pause menu. */
  private hold = false
  private ro: ResizeObserver
  private keys = new Set<string>()
  private hudT = 0
  private recording: FrameRec[] = []
  private replayFrames: FrameRec[] = []
  private replayT = 0
  private replayKind: 'wicket' | 'six' | 'runout' = 'wicket'
  private replaying = false
  private sinceRelease = -1
  private lastBallId = 0
  private feed: { text: string; t: number }[] = []
  private followSince = 0
  private shake = 0
  private pendingCommands: Command[] = []
  private post: Post | null = null
  private postToken = 0
  onHud?: (h: HudState) => void
  onEvent?: (e: GameEvent) => void
  onCommentary?: (lines: string[]) => void
  onEnd?: (d: Director) => void
  onInningsBreak?: () => void
  /** Online guest: send commands to the host instead of the local director. */
  sendCommand?: (c: Command) => void

  constructor(container: HTMLElement, opts: GameOptions) {
    this.container = container
    this.opts = opts
    this.quality = QUALITY[opts.quality]
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.snap })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.dpr))
    this.renderer.shadowMap.enabled = this.quality.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = opts.setup.time === 'night' ? 1.05 : opts.setup.time === 'dusk' ? 1.18 : 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'cricket-canvas'
    container.appendChild(this.renderer.domElement)

    const sideHuman: [boolean, boolean] = opts.autopilot ? [false, false] : opts.sideHuman
    this.director = new Director(opts.setup, { sideHuman, online: opts.online, localSide: opts.localSide, assistRunning: false })
    this.director.replayHook = (kind) => this.startReplay(kind)

    const colors: [string, string] = [opts.setup.teams[0].primary, opts.setup.teams[1].primary]
    this.stadium = new Stadium(opts.assets, { pitch: opts.setup.pitch, time: opts.setup.time, quality: this.quality, colors })
    this.scene.add(this.stadium.group)
    this.scene.fog = new THREE.Fog(opts.setup.time === 'night' ? '#0a1020' : opts.setup.time === 'dusk' ? '#e9b38a' : '#cfe3f2', 160, 520)

    this.ball = makeBall()
    this.ball.visible = false
    this.scene.add(this.ball)
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }))
    this.ballShadow.rotation.x = -Math.PI / 2
    this.ballShadow.visible = false
    this.scene.add(this.ballShadow)
    const tg = new THREE.BufferGeometry().setFromPoints(new Array(40).fill(0).map(() => new THREE.Vector3()))
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }))
    this.trail.frustumCulled = false
    this.trail.visible = false
    this.scene.add(this.trail)
    this.wickets = [new Wicket(0), new Wicket(1)]
    for (const w of this.wickets) this.scene.add(w.group)
    this.marker = makeMarker()
    this.marker.visible = false
    this.scene.add(this.marker)
    this.scene.add(this.guides.group)
    this.hawk = new Hawkeye()
    this.scene.add(this.hawk.group)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.setupPost()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer)
  }

  /* ---------------- lifecycle ---------------- */

  start() {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.frame(dt, true)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointer)
    this.audio.close()
    this.postToken++
    this.post?.dispose()
    this.guides.dispose()
    this.stadium.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /** Post-processing (ambient occlusion, bloom) on the high tier only. */
  private setupPost() {
    const token = ++this.postToken
    this.post?.dispose()
    this.post = null
    if (!this.quality.post) return
    void import('./view/post')
      .then((m) => m.makePost(this.renderer, this.scene, this.camera, this.opts.setup.time === 'night'))
      .then((p) => {
        if (token !== this.postToken) return p.dispose()
        this.post = p
        this.resize()
      })
      .catch(() => (this.post = null))
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.post?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** Test hook (?snap): advance the match without the live loop, then render once. */
  simulate(seconds: number, step = 1 / 60, render = true) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    this.frame(0, render)
  }

  /** Test hook: run until an event of this type happens (plus `after` seconds), or give up after `max` seconds. */
  simulateUntil(type: string, after = 0, max = 120, step = 1 / 60): GameEvent | null {
    let seen = -1
    let ev: GameEvent | null = null
    let t = 0
    const off = this.onEvent
    this.onEvent = (e) => {
      off?.(e)
      if (seen < 0 && (e.type === type || e.text === type)) {
        seen = t
        ev = e
      }
    }
    while (t < max) {
      this.frame(step, false)
      t += step
      if (seen >= 0 && t - seen >= after) break
    }
    this.onEvent = off
    this.frame(0, true)
    return ev
  }

  setPaused(p: boolean) {
    this.paused = p
    this.pushHud()
  }

  /** Freezes the match behind an overlay (no pause menu, keys ignored). */
  setHold(h: boolean) {
    this.hold = h
    this.keys.clear()
    this.pushHud()
  }

  get isHeld() {
    return this.hold
  }

  setQuality(q: QualityTier) {
    // Resolution and shadows change live; the crowd and stadium detail apply to the next match.
    this.quality = QUALITY[q]
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.dpr))
    this.renderer.shadowMap.enabled = this.quality.shadows
    this.stadium.sun.castShadow = this.quality.shadows
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => (x.needsUpdate = true))
    })
    this.resize()
    this.setupPost()
  }

  submit(c: Command) {
    if (this.opts.mirror) this.sendCommand?.(c)
    else this.director.submit(c)
    this.audio.start()
  }

  /* ---------------- frame ---------------- */

  private frame(dt: number, render: boolean) {
    const d = this.director
    const frozen = this.paused || this.hold
    if (!frozen) {
      this.time += dt
      this.handleHeldInput(dt)
      if (!this.opts.mirror) d.update(dt)
      for (const c of this.pendingCommands.splice(0)) this.submit(c)
      for (const e of d.drainEvents()) this.handleEvent(e)
      this.trackRelease(dt)
      if (this.replaying) this.replayT += dt
      else this.record()
      this.stadium.update(dt)
      this.audio.update(dt)
      for (const w of this.wickets) w.update(dt)
      this.timingFlash = Math.max(0, this.timingFlash - dt * 2.5)
    }
    this.syncKits()
    if (this.replaying) this.applyReplayFrame(dt)
    else this.updatePeople(frozen ? 0 : dt)
    this.updateMarker()
    this.updateCamera(frozen ? 0 : dt)
    this.updateBall()
    this.updateGuides()
    this.hawk.update(d, frozen ? 0 : dt)
    this.hudT -= dt
    if (this.hudT <= 0 || dt === 0) {
      this.hudT = 0.1
      this.pushHud()
    }
    if (render) {
      if (this.post) this.post.render(dt)
      else this.renderer.render(this.scene, this.camera)
    }
  }

  private trackRelease(dt: number) {
    const d = this.director
    if (d.ballId !== this.lastBallId) {
      this.lastBallId = d.ballId
      this.sinceRelease = 0
      this.trailPts = []
      this.ghostPts = []
      this.followSince = 0
    } else if (this.sinceRelease >= 0) this.sinceRelease += dt
    if (d.phase === 'predelivery' || d.phase === 'runup') {
      this.sinceRelease = -1
      for (const w of this.wickets) if (w.broken && d.phase === 'predelivery') w.reset()
    }
  }

  /* ---------------- players ---------------- */

  /** Rebuilds the bodies with the right kits at the start of each innings. */
  private syncKits() {
    const d = this.director
    const inn = d.state.current
    if (!inn) return
    if (this.kitTeam === inn.battingTeam && this.people[STRIKER]) return
    this.kitTeam = inn.battingTeam
    for (const p of this.people) p?.dispose()
    const bat = d.state.setup.teams[inn.battingTeam]
    const field = d.state.setup.teams[1 - inn.battingTeam]
    const kit = (t: Team) => ({ shirt: t.primary, trim: t.secondary, trousers: t.trousers, whites: t.kit === 'whites' })
    for (let i = 0; i < ACTORS; i++) {
      const a = d.actors[i]
      let kind: KitKind = 'fielder'
      let team = field
      let skin = 0
      if (i === STRIKER || i === NONSTRIKER) {
        kind = 'batter'
        team = bat
        skin = bat.players[a.player]?.skin ?? 0
      } else if (i === UMP_BOWLER || i === UMP_SQUARE) {
        kind = 'umpire'
        skin = i
      } else {
        kind = a.player === field.keeper ? 'keeper' : 'fielder'
        skin = field.players[a.player]?.skin ?? 0
      }
      const c = new Cricketer(this.opts.assets, kind, kit(team), skin)
      this.scene.add(c.root)
      this.people[i] = c
    }
  }

  private poseCtx(a: Actor, c: Cricketer, ballView: THREE.Vector3 | null): PoseCtx {
    const d = this.director
    const inn = d.state.current
    let kind: PoseCtx['kind'] = a.kind
    if (a.index === STRIKER) kind = 'striker'
    else if (a.index === NONSTRIKER) kind = 'nonstriker'
    // "Ahead": for the striker and keeper the bowler's end; for others the striker's end.
    const strikerEnd = inn ? inn.strikerEnd : 1
    const aheadSim = a.index === STRIKER || a.kind === 'keeper' ? new V3(0, 1.5, stumpsZ(1 - strikerEnd)) : new V3(0, 1.0, stumpsZ(strikerEnd))
    const ahead = c.toChar(v3(aheadSim))
    const bowler = d.bowler
    return {
      pose: a.pose,
      t: a.poseTime,
      variant: a.variant,
      feet: a.feet,
      loft: a.loft,
      aim: a.aim,
      ball: ballView ? c.toChar(ballView) : null,
      sinceRelease: d.phase === 'flight' || d.phase === 'live' ? this.sinceRelease : -1,
      ahead,
      kind,
      style: bowler?.bowl ?? 'fast',
      hasBall: a.hasBall,
      speed: a.speed,
    }
  }

  private clipFor(a: Actor): { clip: ClipName; scale: number } {
    const sp = a.speed
    switch (a.pose) {
      case 'run':
        return sp > 5 ? { clip: 'sprint', scale: Math.max(0.7, sp / 7.5) } : sp > 2 ? { clip: 'jog', scale: Math.max(0.7, sp / 3.5) } : { clip: 'walk', scale: 1 }
      case 'runup':
        return sp > 4.5 ? { clip: 'sprint', scale: Math.max(0.75, sp / 7.5) } : { clip: 'jog', scale: Math.max(0.6, sp / 3.5) }
      case 'walk':
        return { clip: 'walk', scale: 1 }
      case 'pickup':
        return { clip: 'pickup', scale: 1.6 }
      case 'throw':
        return { clip: 'throw', scale: 1.5 }
      case 'celebrate':
        return { clip: a.index % 3 === 0 ? 'dance' : a.index % 3 === 1 ? 'yes' : 'jump', scale: 1 }
      case 'dejected':
        return { clip: 'no', scale: 1 }
      case 'umpire':
        return { clip: 'fold', scale: 1 }
      case 'hit':
        return { clip: 'hit', scale: 1 }
      case 'slide':
        return { clip: 'slide', scale: 1 }
      case 'follow':
        return { clip: 'jog', scale: 1 }
      default:
        return { clip: sp > 0.6 ? (sp > 4 ? 'sprint' : 'jog') : 'idle', scale: sp > 0.6 ? Math.max(0.7, sp / 4) : 1 }
    }
  }

  private updatePeople(dt: number) {
    const d = this.director
    const ballView = d.ballVisible ? v3(d.ball.pos) : null
    const camPos = this.camera.position
    for (let i = 0; i < ACTORS; i++) {
      const a = d.actors[i]
      const c = this.people[i]
      if (!c) continue
      c.root.visible = a.visible && a.pose !== 'hidden'
      if (!c.root.visible) continue
      this.placePerson(c, a.pos, a.yaw, a.left, a, ballView, dt, camPos)
    }
  }

  private placePerson(c: Cricketer, pos: V3 | THREE.Vector3, yaw: number, left: boolean, a: Actor, ballView: THREE.Vector3 | null, dt: number, camPos: THREE.Vector3) {
    const p = pos instanceof V3 ? v3(pos) : pos
    p.y = 0
    const { clip, scale } = this.clipFor(a)
    c.playClip(clip, 0.2, scale)
    // Mirror left-handers (batting or bowling). Umpires never.
    const mirror = a.kind !== 'umpire' && left
    c.prepare(p, yawToView(yaw), mirror)
    const pose = procPose(this.poseCtx(a, c, ballView))
    c.update(dt, pose)
    if (this.quality.lodDistance >= 0 && a.kind !== 'striker' && a.index > NONSTRIKER) c.setLod(this.quality.lodDistance === 0 || p.distanceTo(camPos) > this.quality.lodDistance)
  }

  /* ---------------- ball, marker ---------------- */

  private updateBall() {
    const d = this.director
    let vis = d.ballVisible && d.phase !== 'review'
    let pos: THREE.Vector3
    if (this.replaying) {
      const f = this.replayFrame()
      vis = !!f && f.ball[3] > 0.5
      pos = f ? new THREE.Vector3(-f.ball[0], f.ball[1], f.ball[2]) : new THREE.Vector3()
    } else pos = v3(d.ball.pos)
    this.ball.visible = vis
    this.ballShadow.visible = vis && pos.y < 30
    if (!vis) {
      this.trail.visible = false
      this.guides.setGlow(null, 0)
      this.guides.setGhosts([], 1)
      return
    }
    this.ball.position.copy(pos)
    this.ball.rotation.x += 0.4
    // Keep the ball readable at broadcast distance (it is tiny on screen otherwise).
    const camDist = this.camera.position.distanceTo(pos)
    const scale = THREE.MathUtils.clamp(camDist / 10, 1.15, 2.6)
    this.ball.scale.setScalar(scale)
    this.ballShadow.position.set(pos.x, 0.012, pos.z)
    const s = (1 + Math.min(3, pos.y * 0.15)) * Math.max(1, scale * 0.8)
    this.ballShadow.scale.setScalar(s)
    ;(this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.1, 0.5 / s)
    const flight = d.phase === 'flight' || d.phase === 'runup'
    const live = d.phase === 'live' || d.phase === 'dead'
    // A glow and a few fading ghosts behind the ball while it is in the air, so its line is easy to read.
    const moving = (flight || (live && !d.heldBy)) && !this.replaying
    this.guides.setGlow(moving && !d.heldBy ? pos : null, 0.16 * scale + Math.min(0.3, camDist * 0.008))
    if (moving) {
      if (!this.ghostPts.length || this.ghostPts[0].distanceToSquared(pos) > 0.08) {
        this.ghostPts.unshift(pos.clone())
        if (this.ghostPts.length > 6) this.ghostPts.pop()
      }
    } else this.ghostPts = []
    this.guides.setGhosts(this.replaying ? [] : this.ghostPts, scale)
    // A faint tracer behind the ball once it's hit, so it's easy to follow.
    if (live && !d.heldBy && !this.replaying) {
      this.trailPts.push(pos.clone())
      if (this.trailPts.length > 40) this.trailPts.shift()
    } else if (!live) this.trailPts = []
    this.trail.visible = this.trailPts.length > 2
    if (this.trail.visible) {
      const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < 40; i++) {
        const q = this.trailPts[Math.max(0, this.trailPts.length - 40 + i)] ?? pos
        attr.setXYZ(i, q.x, q.y, q.z)
      }
      attr.needsUpdate = true
    }
  }

  private updateMarker() {
    const d = this.director
    const show = !this.opts.autopilot && d.localBowls && (d.phase === 'predelivery' || (d.phase === 'runup' && !d.ballReleased))
    this.marker.visible = show
    this.guides.setZonesVisible(show)
    if (show) {
      this.marker.position.copy(v3(d.marker)).setY(0.02)
      const s = 1 + Math.sin(this.time * 6) * 0.08
      this.marker.scale.setScalar(s)
      // The length bands in front of the striker's stumps, labelled on the batter's off side (screen-left from
      // behind a right-arm bowler, clear of the bowling controls on the right).
      const inn = d.state.current
      const key = `${inn.strikerEnd}:${d.frame.off.x}`
      if (this.zonesFor !== key) {
        this.zonesFor = key
        const dirZ = inward(inn.strikerEnd)
        this.guides.buildZones(stumpsZ(inn.strikerEnd), dirZ, Math.sign(toView(d.frame.off).x || 1))
      }
    }
  }

  /** The batter's guides: the landing marker, the timing ring and the aim wedge. */
  private updateGuides() {
    const d = this.director
    const g = this.guides
    const inn = d.state.current
    const bats = !this.opts.autopilot && d.localBats && !!inn && !this.replaying
    const inFlight = d.phase === 'flight' || d.phase === 'runup'
    const released = d.ballReleased && d.phase === 'flight'
    // Landing marker from the moment of release: Easy keeps it, Normal fades it as the ball travels, Hard flashes it.
    const pitched = bats && released && d.pitched ? v3(d.pitched) : null
    if (pitched) {
      const diff = d.nets ? 0 : d.state.setup.difficulty
      const t = this.sinceRelease
      const landed = d.ball.bounces > 0
      let a = 1
      if (diff === 1) a = landed ? 0.35 : Math.max(0.35, 1 - t * 0.8)
      else if (diff === 2) a = Math.max(0, 1 - t * 2.2)
      g.setPitch(pitched, a, landed ? 1 : 1 + Math.sin(this.time * 9) * 0.06)
      g.setPitchLabel(diff === 0 || d.nets ? lengthWords(d.pitchedLength(), d.frame.offsetOff(d.pitched!)).length : null)
    } else g.setPitch(null, 0)
    // Timing ring on the ground at the striker's contact point.
    const tCross = released ? d.crossTime('auto') : -1
    if (bats && released && tCross > 0) {
      const toContact = tCross - d.ball.time - SHOT_LEAD
      const windowS = PERFECT * d.difficultyWindow * 1.1
      const at = v3(d.crossPoint('auto'))
      // Fully open at release, closed on the inner ring at the moment to press.
      const closing = THREE.MathUtils.clamp(toContact / Math.max(0.15, tCross - SHOT_LEAD), 0, 1)
      // Once the shot is pressed the ring stops judging: it just closes on the contact point.
      const judging = !d.shotPending
      g.setTiming(at, closing, judging && Math.abs(toContact) <= windowS, judging && toContact < -windowS, this.timingFlash)
    } else if (bats && this.timingFlash > 0 && (d.phase === 'live' || d.phase === 'flight')) {
      g.setTiming(v3(d.crossPoint('auto')), 0, false, false, this.timingFlash)
    } else g.setTiming(null, 0, false, false, 0)
    // Aim wedge while a direction is held (or a shot has been pressed) before the ball arrives.
    const aim = bats && (inFlight || d.phase === 'predelivery') ? this.aimFromKeys() : null
    const showAim = aim !== null || (bats && inFlight && d.shotPending)
    if (showAim && inn) {
      const deg = aim ?? d.striker.aim
      const dir = toView(d.frame.direction(deg))
      const kind: ShotColour = d.shotPending ? this.shotKind : 'none'
      const len = kind === 'defend' ? 2.2 : kind === 'loft' ? 9 : kind === 'ground' ? 6 : 5
      g.setAim(v3(d.striker.pos), Math.atan2(dir.x, dir.z), kind, len)
    } else g.setAim(null, 0, 'none', 1)
  }

  /* ---------------- cameras ---------------- */

  /** Test hook: a fixed camera (view coordinates), or null to go back to the game's cameras. */
  debugView: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null

  /** Test hook: frame an actor from an angle (degrees around it, 0 = in front), distance and height. */
  frameActor(index: number, angle = 0, dist = 4, height = 1.4, fov = 35) {
    const a = this.director.actors[index]
    const p = toView(a.pos)
    const yaw = yawToView(a.yaw) + (angle * Math.PI) / 180
    const pos = p.clone().add(new THREE.Vector3(Math.sin(yaw) * dist, height, Math.cos(yaw) * dist))
    this.debugView = { pos, look: p.clone().setY(1.0), fov }
    this.frame(0, true)
  }

  private updateCamera(dt: number) {
    if (this.debugView) {
      this.camera.position.copy(this.debugView.pos)
      this.camera.lookAt(this.debugView.look)
      this.camera.fov = this.debugView.fov
      this.camera.updateProjectionMatrix()
      return
    }
    const d = this.director
    const inn = d.state.current
    let mode: CamMode = 'orbit'
    const userCam = this.userCam
    if (this.replaying) mode = 'replay'
    else if (d.phase === 'review' && d.review.kind === 'lbw') mode = 'hawk'
    else if (d.phase === 'review' && d.review.kind === 'runout') mode = 'hawk'
    else if (inn && (d.phase === 'predelivery' || d.phase === 'runup' || d.phase === 'flight')) mode = userCam
    else if (inn && (d.phase === 'live' || d.phase === 'dead')) mode = d.liveTime < (userCam === 'batter' ? 0.35 : 0.12) && d.phase === 'live' && !d.heldBy ? userCam : 'follow'
    if (mode !== this.camMode) {
      if (mode === 'follow') this.followSince = 0
      this.camMode = mode
    }
    this.followSince += dt
    const pos = new THREE.Vector3()
    const look = new THREE.Vector3()
    let fov = 24
    let snap = dt === 0
    const se = inn ? inn.strikerEnd : 1
    const be = 1 - se
    const dirZ = inward(be) // from the bowler's end towards the striker
    switch (mode) {
      case 'broadcast': {
        // Behind the bowler's arm, looking down the pitch at the batter (telephoto, like the TV camera), shifted
        // to the side away from the umpire so he doesn't hide the batter.
        const ump = d.actors[UMP_BOWLER]
        const side = -Math.sign(toView(ump.pos).x || 1)
        pos.set(side * 1.1, 6.6, stumpsZ(be) - dirZ * 27)
        look.set(side * 0.25, 0.85, stumpsZ(se) - dirZ * 2.4)
        fov = 13.5
        if (d.phase === 'predelivery' && d.phaseTime < 0.05) snap = true
        break
      }
      case 'batter': {
        // Over the striker's shoulder, looking down the pitch at the bowler running in. Off side of the batter so
        // his body never hides the ball; mirrored for a left-hander.
        const offSide = Math.sign(toView(d.frame.off).x || 1)
        pos.set(offSide * 1.9, 4.2, stumpsZ(se) + dirZ * 7.5)
        look.set(offSide * 0.1, 0.7, stumpsZ(se) - dirZ * 8)
        fov = 32
        if (d.phase === 'predelivery' && d.phaseTime < 0.05) snap = true
        break
      }
      case 'high': {
        pos.set(0, 16, stumpsZ(be) - dirZ * 34)
        look.set(0, 0.6, stumpsZ(se) - dirZ * 4)
        fov = 26
        break
      }
      case 'follow': {
        const b = this.ballFocus()
        const centre = new THREE.Vector3(0, 0, 0)
        const flat = new THREE.Vector3(b.x, 0, b.z)
        const dist = flat.length()
        const away = dist > 0.5 ? flat.clone().normalize() : new THREE.Vector3(0, 0, -dirZ)
        // From behind the pitch, fairly low, looking out at the ball so the field and the stands are in shot.
        pos.copy(centre).addScaledVector(away, dist * 0.3 - 20).setY(5.5 + dist * 0.07 + Math.max(0, b.y) * 0.3)
        look.copy(b).setY(Math.max(0.4, b.y * 0.8))
        fov = 32 + Math.min(14, dist * 0.12)
        break
      }
      case 'replay':
        this.replayCamera(pos, look)
        fov = this.replayIndex().pass === 1 && this.replayKind === 'wicket' ? 11 : 30
        snap = true
        break
      case 'hawk': {
        const t = d.review.time
        if (d.review.kind === 'runout') {
          const z = poppingView(d.review.end)
          pos.set(-11, 1.6, z + 0.2)
          look.set(0, 0.5, z)
          fov = 18
        } else if (t < 4) {
          pos.set(0, 6.5, stumpsZ(be) - dirZ * 9)
          look.set(0, 0.4, stumpsZ(se) - dirZ * 4)
          fov = 30
        } else {
          pos.set(-7.5, 1.4, stumpsZ(se) - dirZ * 4)
          look.set(0, 0.5, stumpsZ(se) - dirZ * 1)
          fov = 34
        }
        snap = d.phaseTime < 0.05 || Math.abs(t - 4) < 0.05
        break
      }
      default: {
        const a = this.time * 0.05
        pos.set(Math.sin(a) * 70, 26, Math.cos(a) * 82)
        look.set(0, 2, 0)
        fov = 38
        snap = snap || this.camMode !== 'orbit'
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * (mode === 'follow' ? 3.2 : 5))
    this.camPos.lerp(pos, k)
    this.camLook.lerp(look, mode === 'follow' ? 1 - Math.exp(-dt * 6) : k)
    this.camFov += (fov - this.camFov) * k
    this.camera.position.copy(this.camPos)
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake
      this.shake = Math.max(0, this.shake - dt * 0.4)
    }
    this.camera.lookAt(this.camLook)
    if (Math.abs(this.camera.fov - this.camFov) > 0.01) {
      this.camera.fov = this.camFov
      this.camera.updateProjectionMatrix()
    }
  }

  /** What the follow camera frames: the ball, or the fielder holding it. */
  private ballFocus() {
    const d = this.director
    if (d.heldBy) return v3(d.heldBy.pos).setY(1)
    return v3(d.ball.pos)
  }

  /** The camera the player chose for what he is doing now (batting gets the over-the-shoulder view by default). */
  private get userCam(): UserCam {
    const d = this.director
    return !this.opts.autopilot && d.localBats ? this.batCam : this.fieldCam
  }

  toggleCamera() {
    const d = this.director
    if (!this.opts.autopilot && d.localBats) this.batCam = BAT_CAMS[(BAT_CAMS.indexOf(this.batCam) + 1) % BAT_CAMS.length]
    else this.fieldCam = FIELD_CAMS[(FIELD_CAMS.indexOf(this.fieldCam) + 1) % FIELD_CAMS.length]
    this.pushHud()
  }

  /* ---------------- replays ---------------- */

  /** Frame indices of the key moments in the current recording (release, contact, stumps, catch). */
  private marks: { release?: number; hit?: number; stumps?: number; catch?: number; catcher?: number; stumpsEnd?: number; stumpsAt?: THREE.Vector3; stumpsSpeed?: number } = {}
  private replayWin = { start: 0, end: 0, key: 0, slowFrom: 0, slowTo: 0 }
  private replayBroke = -1

  private record() {
    const d = this.director
    if (d.phase === 'predelivery') {
      this.recording.length = 0
      this.marks = {}
      return
    }
    if (d.phase !== 'runup' && d.phase !== 'flight' && d.phase !== 'live' && d.phase !== 'dead') return
    if (this.recording.length > 1500) return
    const arr = new Float32Array(ACTORS * ACTOR_FIELDS)
    const poses: string[] = []
    d.actors.forEach((a, i) => {
      const o = i * ACTOR_FIELDS
      arr[o] = a.pos.x
      arr[o + 1] = a.pos.z
      arr[o + 2] = a.yaw
      arr[o + 3] = POSES.indexOf(a.pose)
      arr[o + 4] = a.poseTime
      arr[o + 5] = a.aim
      arr[o + 6] = a.loft ? 1 : 0
      arr[o + 7] = ['auto', 'front', 'back', 'charge'].indexOf(a.feet)
      arr[o + 8] = a.hasBall ? 1 : 0
      arr[o + 9] = a.visible ? 1 : 0
      arr[o + 10] = a.left ? 1 : 0
      arr[o + 11] = a.speed
      poses.push(a.variant)
    })
    this.recording.push({ actors: arr, poses, ball: [d.ball.pos.x, d.ball.pos.y, d.ball.pos.z, d.ballVisible ? 1 : 0] })
  }

  private mark(e: GameEvent) {
    if (this.replaying) return
    const n = this.recording.length
    const m = this.marks
    if (e.type === 'release') m.release = n
    else if ((e.type === 'bathit' || e.type === 'edge' || e.type === 'pad') && m.hit === undefined) m.hit = n
    else if (e.type === 'stumps' && m.stumps === undefined) {
      m.stumps = n
      m.stumpsEnd = e.i ?? 0
      m.stumpsAt = e.p ? v3(e.p) : new THREE.Vector3(0, 0.5, stumpsZ(e.i ?? 0))
      m.stumpsSpeed = e.f ?? 20
    } else if (e.type === 'catch' && m.catch === undefined) {
      m.catch = n
      m.catcher = e.i
    }
  }

  private startReplay(kind: 'wicket' | 'six' | 'runout') {
    if (this.opts.online || this.recording.length < 20) return false
    const n = this.recording.length
    const m = this.marks
    const key = Math.min(n - 1, kind === 'runout' ? (m.stumps ?? n - 1) : (m.stumps ?? m.catch ?? m.hit ?? n - 1))
    const start = kind === 'runout' ? Math.max(0, key - 150) : Math.max(0, (m.release ?? 0) - 25)
    const end = kind === 'six' ? n : Math.min(n, key + 90)
    this.replayWin = { start, end, key, slowFrom: Math.max(start, (kind === 'six' ? (m.hit ?? key) : key) - 45), slowTo: Math.min(n, (kind === 'six' ? (m.hit ?? key) : key) + 55) }
    this.replayFrames = this.recording.slice()
    this.replayKind = kind
    this.replayT = 0
    this.replaying = true
    this.replayBroke = -1
    for (const w of this.wickets) w.reset()
    return true
  }

  /** Real-time first pass, then slow motion (0.4x) around the key moment. */
  private get replayPass1() {
    return (this.replayWin.end - this.replayWin.start) / 60
  }

  get replayDuration() {
    return this.replayPass1 + (this.replayWin.slowTo - this.replayWin.slowFrom) / 60 / 0.4 + 0.3
  }

  private replayIndex() {
    const w = this.replayWin
    const t = this.replayT
    if (t < this.replayPass1) return { idx: Math.floor(w.start + t * 60), pass: 1 }
    return { idx: Math.floor(w.slowFrom + (t - this.replayPass1) * 60 * 0.4), pass: 2 }
  }

  private replayFrame(): FrameRec | null {
    if (!this.replayFrames.length) return null
    const { idx } = this.replayIndex()
    return this.replayFrames[Math.min(this.replayFrames.length - 1, Math.max(0, idx))]
  }

  private applyReplayFrame(dt: number) {
    const f = this.replayFrame()
    if (!f) return
    const d = this.director
    const { idx, pass } = this.replayIndex()
    const ballView = f.ball[3] > 0.5 ? new THREE.Vector3(-f.ball[0], f.ball[1], f.ball[2]) : null
    for (let i = 0; i < ACTORS; i++) {
      const c = this.people[i]
      if (!c) continue
      const o = i * ACTOR_FIELDS
      const fake = Object.create(d.actors[i]) as Actor
      fake.pose = POSES[f.actors[o + 3]] ?? 'idle'
      fake.poseTime = f.actors[o + 4]
      fake.aim = f.actors[o + 5]
      fake.loft = f.actors[o + 6] > 0.5
      fake.feet = (['auto', 'front', 'back', 'charge'] as Footwork[])[f.actors[o + 7]] ?? 'auto'
      fake.hasBall = f.actors[o + 8] > 0.5
      fake.variant = f.poses[i]
      fake.vel = new V3(f.actors[o + 11], 0, 0)
      c.root.visible = f.actors[o + 9] > 0.5 && fake.pose !== 'hidden'
      if (!c.root.visible) continue
      this.placePerson(c, new V3(f.actors[o], 0, f.actors[o + 1]), f.actors[o + 2], f.actors[o + 10] > 0.5, fake, ballView, pass === 2 ? dt * 0.4 : dt, this.camera.position)
    }
    // The stumps go down again at the right moment of each pass.
    const m = this.marks
    if (m.stumps !== undefined && m.stumpsAt && idx >= m.stumps && this.replayBroke !== pass) {
      this.replayBroke = pass
      this.wickets[m.stumpsEnd ?? 0].reset()
      this.wickets[m.stumpsEnd ?? 0].break(m.stumpsAt, m.stumpsSpeed ?? 20, -inward(m.stumpsEnd ?? 0))
      this.audio.stumps()
    } else if (m.stumps !== undefined && idx < m.stumps && this.replayBroke === pass - 1 && pass === 2 && this.wickets[m.stumpsEnd ?? 0].broken) this.wickets[m.stumpsEnd ?? 0].reset()
    if (this.replayT > this.replayDuration) {
      this.replaying = false
      this.director.replayDone = true
    }
  }

  private replayCamera(pos: THREE.Vector3, look: THREE.Vector3) {
    const d = this.director
    const inn = d.state.current
    const se = inn ? inn.strikerEnd : 1
    const f = this.replayFrame()
    const ball = f ? new THREE.Vector3(-f.ball[0], f.ball[1], f.ball[2]) : new THREE.Vector3()
    const sz = stumpsZ(se)
    const toBowler = inward(se)
    const { pass } = this.replayIndex()
    const m = this.marks
    if (this.replayKind === 'runout' && m.stumpsEnd !== undefined) {
      // Side-on to the crease where the stumps were broken, close in for the slow motion.
      const z = stumpsZ(m.stumpsEnd) + inward(m.stumpsEnd) * Geo.CreaseDepth
      pos.set(pass === 1 ? -14 : -6, pass === 1 ? 3 : 1.2, z)
      look.set(0, 0.6, z)
      return
    }
    if (this.replayKind === 'six') {
      if (pass === 1) {
        pos.set(-24, 5 + Math.max(0, ball.y) * 0.4, sz + toBowler * 6)
        look.copy(ball.y > 0.05 ? ball : new THREE.Vector3(0, 1, sz))
      } else {
        // Behind the batter, watching it fly.
        pos.set(0.3, 2.4, sz - toBowler * 7)
        look.copy(ball.y > 0.05 ? ball : new THREE.Vector3(0, 1.2, sz + toBowler * 10))
      }
      return
    }
    if (pass === 1) {
      // The main camera, tighter on the batter.
      pos.set(0.9, 5.5, stumpsZ(1 - se) - toBowler * 22)
      look.set(0.2, 0.9, sz - toBowler * 1.5)
      return
    }
    if (m.catch !== undefined && m.catcher !== undefined && m.stumps === undefined) {
      // The catch, close up.
      const o = m.catcher * ACTOR_FIELDS
      const cf = this.replayFrames[Math.min(this.replayFrames.length - 1, m.catch)]
      const cp = new THREE.Vector3(-cf.actors[o], 1.2, cf.actors[o + 1])
      const away = cp.clone().setY(0).normalize()
      pos.copy(cp).addScaledVector(away, 5).setY(1.8)
      look.copy(cp)
      return
    }
    // Side-on to the striker's crease (square leg's view), low.
    pos.set(-8.5, 1.3, sz + toBowler * 0.9)
    look.set(0, 0.6, sz + toBowler * 0.6)
  }

  get isReplaying() {
    return this.replaying
  }

  skipReplay() {
    if (!this.replaying) return
    this.replaying = false
    this.director.replayDone = true
  }

  /* ---------------- events ---------------- */

  private handleEvent(e: GameEvent) {
    const d = this.director
    this.mark(e)
    this.onEvent?.(e)
    switch (e.type) {
      case 'bathit':
        this.audio.bat(e.f ?? 0.5)
        if ((e.f ?? 0) > 0.85) this.stadium.crowd.cheer(0.3, 1)
        this.noteTiming(TIMING_NAMES[e.i ?? 0] ?? 'noshot')
        break
      case 'edge':
        this.audio.bat(0.2, true)
        this.noteTiming(TIMING_NAMES[e.i ?? 0] ?? 'noshot')
        break
      case 'beaten':
        this.audio.ooh()
        this.stadium.crowd.cheer(0.15, 1)
        this.noteTiming('noshot')
        break
      case 'leave':
        if (d.localBats) this.noteTiming('noshot')
        break
      case 'pad':
        this.audio.pad()
        break
      case 'bounce':
        this.audio.bounce(e.f ?? 10)
        break
      case 'stumps': {
        const w = this.wickets[e.i ?? 0]
        if (!this.replaying) {
          const at = e.p ? v3(e.p) : new THREE.Vector3(0, 0.5, stumpsZ(e.i ?? 0))
          w.break(at, e.f ?? 20, -inward(e.i ?? 0))
        }
        this.audio.stumps()
        this.shake = 0.12
        break
      }
      case 'four':
        this.audio.roar(0.6)
        this.stadium.crowd.cheer(0.7, 3)
        break
      case 'six':
        this.audio.roar(1)
        this.stadium.crowd.cheer(1, 4)
        if (Math.random() < 0.4) this.stadium.crowd.wave()
        break
      case 'wicket':
        this.audio.roar(0.9)
        this.stadium.crowd.cheer(0.9, 3.5)
        break
      case 'appeal':
        this.audio.appeal()
        break
      case 'catch':
        this.audio.catchSlap()
        break
      case 'keeper':
        this.audio.keeper()
        break
      case 'drop':
        this.audio.ooh()
        break
      case 'release': {
        this.audio.release()
        const bp = d.bowler
        if (bp) {
          const spin = isSpinStyle(bp.bowl)
          const words = d.pitched ? lengthWords(d.pitchedLength(), d.frame.offsetOff(d.pitched)).text : 'Full toss'
          this.card = { bowler: surname(bp), kmh: Math.round(e.f ?? d.lastKmh), type: DELIVERIES[(e.text as DeliveryType) ?? d.selectedDelivery]?.name ?? e.text ?? '', spin, words, age: 0 }
        }
        break
      }
      case 'runcomplete':
        this.audio.click()
        break
      case 'milestone':
        this.audio.applause(4)
        this.stadium.crowd.cheer(0.6, 4)
        break
      case 'say':
        if (e.text) {
          this.feed.unshift({ text: e.text, t: this.time })
          this.feed.length = Math.min(this.feed.length, 6)
          this.onCommentary?.(this.feed.map((f) => f.text))
        }
        break
      case 'overend':
        if (d.state.current.legalBalls % 18 === 0 && Math.random() < 0.5) this.stadium.crowd.wave()
        break
      case 'inningsend':
        this.audio.applause(3)
        this.onInningsBreak?.()
        break
      case 'matchend':
        this.audio.roar(1)
        this.stadium.crowd.cheer(1, 6)
        this.onEnd?.(d)
        break
      case 'phase':
        if (e.text === 'review') this.hawk.begin(d)
        if (e.text === 'predelivery') {
          this.hawk.clear()
          this.shotKind = 'none'
          this.card = null
        }
        break
    }
    if (e.type === 'release' || e.type === 'wicket' || e.type === 'four' || e.type === 'six' || e.type === 'overend') this.updateScreen()
  }

  /** Remembers how the local batter timed the last six balls (for the practice strip). */
  private noteTiming(t: Timing) {
    if (!this.director.localBats || this.opts.autopilot) return
    this.timings.push(t)
    if (this.timings.length > 6) this.timings.shift()
    this.timingFlash = 1
  }

  private updateScreen() {
    const d = this.director
    const inn = d.state.current
    if (!inn) return
    const team = d.state.setup.teams[inn.battingTeam]
    this.stadium.setScreen([`${team.short} ${scoreText(inn)}`, `${oversText(inn.legalBalls)} overs`, inn.target > 0 ? `Need ${d.state.runsNeeded} from ${d.state.ballsLeft}` : `Run rate ${runRate(inn).toFixed(2)}`])
  }

  /* ---------------- input ---------------- */

  private onBlur = () => this.keys.clear()

  private onPointer = () => {
    this.audio.start()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault()
    if (this.hold) return
    this.audio.start()
    if (e.repeat) {
      this.keys.add(k)
      return
    }
    this.keys.add(k)
    this.keyAction(k, e.shiftKey)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    this.keys.delete(k)
    if (k === 'Shift') this.keys.delete('Shift')
  }

  /** Held direction (screen space): x right, y up. */
  private heldDir() {
    const K = this.keys
    let x = 0
    let y = 0
    if (K.has('ArrowLeft') || K.has('a')) x -= 1
    if (K.has('ArrowRight') || K.has('d')) x += 1
    if (K.has('ArrowUp') || K.has('w')) y += 1
    if (K.has('ArrowDown') || K.has('s')) y -= 1
    return { x, y }
  }

  /** Shot direction (degrees) from the held keys, relative to the batter (Cricket 07 style, 8 directions). */
  aimFromKeys(): number | null {
    const { x, y } = this.heldDir()
    if (x === 0 && y === 0) return null
    const d = this.director
    // Which way is the off side on screen? (Right-handers' off side is screen-left from behind the bowler.)
    const offView = toView(d.frame.off)
    const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const offSign = offView.dot(camRight) >= 0 ? 1 : -1
    const lat = x * offSign // + off side
    if (y > 0 && lat === 0) return 0
    if (y > 0 && lat > 0) return 35
    if (y > 0 && lat < 0) return -30
    if (y === 0 && lat > 0) return 85
    if (y === 0 && lat < 0) return -70
    if (y < 0 && lat > 0) return 135
    if (y < 0 && lat < 0) return -115
    return -155
  }

  private naturalAim() {
    const d = this.director
    const at = d.crossPoint('auto')
    const u = d.frame.offsetOff(at)
    return u > 0.3 ? 40 : u > 0.05 ? 12 : -20
  }

  private footwork(): Footwork {
    if (this.keys.has('Shift')) return 'front'
    if (this.keys.has(' ')) return 'back'
    return 'auto'
  }

  private keyAction(k: string, _shift: boolean) {
    const d = this.director
    const side = this.opts.localSide
    const c = (cmd: Command) => this.submit(cmd)
    if (k === 'Escape' || k === 'p') {
      this.setPaused(!this.paused)
      return
    }
    if (this.paused) return
    if (k === 'c' && !(d.localBats && (d.phase === 'flight' || d.phase === 'runup'))) {
      this.toggleCamera()
      return
    }
    if (this.replaying && (k === ' ' || k === 'Enter')) {
      this.skipReplay()
      return
    }
    if (d.phase === 'break' && (k === ' ' || k === 'Enter')) {
      c({ t: 'continue', side })
      return
    }
    if (k === 'y' && d.reviewWindowOpen) {
      c({ t: 'review', side })
      return
    }
    if (d.phase === 'toss') {
      if (k === 'h') c({ t: 'toss', side, call: 0 })
      if (k === 't') c({ t: 'toss', side, call: 1 })
      if (k === 'b') c({ t: 'tosschoice', side, bat: true })
      if (k === 'w') c({ t: 'tosschoice', side, bat: false })
      return
    }
    if (d.phase === 'choosebowler' && d.localBowls) {
      const opts = d.eligibleBowlers()
      const n = parseInt(k, 10)
      if (!Number.isNaN(n) && n >= 1 && n <= opts.length) c({ t: 'bowler', side, player: opts[n - 1] })
      if (k === 'Enter' || k === ' ') c({ t: 'bowler', side, player: opts[0] })
      return
    }
    if (this.opts.autopilot) return
    // Batting.
    if (d.localBats) {
      if ((d.phase === 'flight' || d.phase === 'runup') && ['j', 'k', 'l', 'z', 'x', 'c'].includes(k)) {
        const defend = k === 'j' || k === 'z'
        const loft = k === 'l' || k === 'c'
        const aim = this.aimFromKeys() ?? (defend ? 0 : this.naturalAim())
        const shot: ShotType = defend ? 'defend' : 'auto'
        const feet = this.footwork()
        // Online guests time the shot against their own copy of the delivery (what they can see).
        const timing = this.opts.mirror ? d.timingErrorNow(shot, feet) : undefined
        if (!d.shotPending) this.shotKind = defend ? 'defend' : loft ? 'loft' : 'ground'
        c({ t: 'shot', side, shot, loft, feet, aim, timing })
        return
      }
      if (k === 't' && (d.phase === 'predelivery' || d.phase === 'runup')) c({ t: 'charge', side })
      if (d.phase === 'live') {
        if (k === 'r' || k === 'Enter') c({ t: 'run', side })
        if (k === 'f' || k === 'Backspace') c({ t: 'back', side })
      }
      return
    }
    // Bowling and fielding.
    if (d.localBowls) {
      if (d.phase === 'predelivery') {
        const types = d.bowler ? deliveriesFor(d.bowler.bowl) : []
        const n = parseInt(k, 10)
        if (!Number.isNaN(n) && n >= 1 && n <= types.length) c({ t: 'delivery', side, type: types[n - 1] })
        if (k === 'q' || k === 'e') {
          const i = types.indexOf(d.selectedDelivery)
          c({ t: 'delivery', side, type: types[(i + (k === 'e' ? 1 : types.length - 1)) % types.length] })
        }
        if (k === 'v') c({ t: 'wicketside', side })
        if (k === 'f') this.cyclePreset()
        if (k === ' ' || k === 'k' || k === 'Enter') c({ t: 'runup', side })
        return
      }
      if (d.phase === 'runup' && (k === ' ' || k === 'k' || k === 'Enter')) {
        c({ t: 'release', side, meter: d.meterValue })
        return
      }
      if (d.phase === 'live') {
        if (k === 'j') c({ t: 'throw', side, end: 'keeper' })
        if (k === 'l') c({ t: 'throw', side, end: 'bowler' })
      }
    }
  }

  cyclePreset() {
    const d = this.director
    const i = PRESET_ORDER.indexOf(d.preset)
    this.submit({ t: 'preset', side: this.opts.localSide, preset: PRESET_ORDER[(i + 1) % PRESET_ORDER.length] })
  }

  /** Continuous input: moving the bowling marker, the slide assist. */
  private handleHeldInput(dt: number) {
    const d = this.director
    if (this.opts.autopilot || this.paused) return
    if (d.localBowls && (d.phase === 'predelivery' || (d.phase === 'runup' && !d.ballReleased))) {
      const { x, y } = this.heldDir()
      if (x || y) {
        const f = d.frame
        const offView = toView(f.off)
        const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
        const offSign = offView.dot(camRight) >= 0 ? 1 : -1
        const off = f.offsetOff(d.marker) + x * offSign * 0.9 * dt
        const len = f.offsetFwd(d.marker) + y * 3.2 * dt
        this.submit({ t: 'target', side: this.opts.localSide, off, len })
      }
    }
    // Slide the bat in automatically when a close run is on.
    if (d.localBats && d.phase === 'live' && d.anyRunning) {
      for (let k = 0; k < 2; k++) {
        const t = d.runnerTimeToGround(k)
        if (t >= 0 && t < 0.45 && (d.throwInFlight || d.heldBy)) d.slideBat()
      }
    }
  }

  /** Clicks on the HUD's touch buttons. */
  press(action: 'defend' | 'ground' | 'loft' | 'run' | 'back' | 'bowl' | 'review' | 'continue' | 'camera' | 'preset') {
    const map: Record<string, string> = { defend: 'j', ground: 'k', loft: 'l', run: 'r', back: 'f', bowl: ' ', review: 'y', continue: 'Enter', camera: 'c', preset: 'f' }
    if (action === 'preset') this.cyclePreset()
    else this.keyAction(map[action], false)
  }

  /* ---------------- HUD ---------------- */

  private pushHud() {
    if (!this.onHud) return
    this.onHud(this.hudState())
  }

  hudState(): HudState {
    const d = this.director
    const st = d.state
    const inn = st.current
    const teams = st.setup.teams
    const bt = inn ? teams[inn.battingTeam] : teams[0]
    const ft = inn ? teams[1 - inn.battingTeam] : teams[1]
    const batters: HudBatter[] = []
    if (inn) {
      for (const p of [inn.striker, inn.nonStriker]) {
        const c = inn.batting.find((b) => b.player === p)
        batters.push({ name: surname(bt.players[p]), runs: c?.runs ?? 0, balls: c?.balls ?? 0, onStrike: p === inn.striker, left: bt.players[p].leftBat })
      }
    }
    const bp = d.bowler
    const bc = inn && inn.bowler >= 0 ? inn.bowling.find((b) => b.player === inn.bowler) : null
    const bowlerActor = inn && inn.bowler >= 0 ? d.fielderFor(inn.bowler) : null
    const localSide = this.opts.localSide
    const review = d.review
    const track = review.track
    const tossStage = d.phase !== 'toss' ? null : d.tossResult < 0 ? (d.sideHuman[d.online ? 1 : 0] && (d.online ? 1 : 0) === localSide ? 'call' : 'wait') : d.sideHuman[st.tossWinner] && st.tossWinner === localSide ? 'choose' : 'wait'
    const lastInn = st.innings[st.innings.length - 1]
    return {
      phase: d.phase,
      batting: { name: bt.name, short: bt.short, color: bt.primary },
      fielding: { name: ft.name, short: ft.short, color: ft.primary },
      score: inn ? scoreText(inn) : '0/0',
      overs: inn ? oversText(inn.legalBalls) : '0.0',
      maxOvers: st.activeRules.overs,
      runRate: inn ? runRate(inn).toFixed(2) : '0.00',
      target: inn?.target ?? -1,
      need: inn && inn.target > 0 && st.runsNeeded > 0 && !inn.complete ? `Need ${Math.max(0, st.runsNeeded)} from ${st.ballsLeft} ball${st.ballsLeft === 1 ? '' : 's'} · RRR ${st.requiredRate.toFixed(2)}` : '',
      powerplay: !!inn && st.isPowerplay,
      superOver: !!inn?.superOver,
      freeHit: !!inn?.freeHit,
      batters,
      bowler: bp && bc ? { name: surname(bp), figures: `${bc.wickets}-${bc.runs} (${oversText(bc.balls)})`, style: styleName(bp), stamina: bowlerActor?.stamina ?? 100 } : null,
      thisOver: inn ? st.thisOver() : [],
      partnership: inn ? `${inn.partnershipRuns} (${inn.partnershipBalls})` : '',
      lastKmh: Math.round(d.lastKmh),
      timing: d.timingText,
      shotNote: d.lastShotNote,
      confidence: d.strikerConfidence,
      localBats: !this.opts.autopilot && d.localBats,
      localBowls: !this.opts.autopilot && d.localBowls,
      meter: d.localBowls && (d.phase === 'runup' || d.phase === 'predelivery') ? { value: d.meterValue, green: d.meterGreen, half: d.meterHalfWidth, running: d.meterRunning } : null,
      delivery:
        d.localBowls && bp && (d.phase === 'predelivery' || d.phase === 'runup')
          ? { selected: d.selectedDelivery, around: d.around, options: deliveriesFor(bp.bowl).map((t, i) => ({ type: t, name: DELIVERIES[t].name, key: String(i + 1) })) }
          : null,
      preset: d.preset,
      aim: { ...this.heldDir(), feet: this.footwork() },
      review:
        d.phase === 'review'
          ? {
              active: true,
              kind: review.kind,
              time: review.time,
              duration: d.reviewDuration,
              pitching: track ? zoneText(track.pitching) : '',
              impact: track ? zoneText(track.impactZone) : '',
              wickets: track ? zoneText(track.wickets) : '',
              outcome: review.outcome,
              finalOut: review.finalOut,
              edge: review.edge,
              reviewing: teams[review.reviewingTeam].name,
            }
          : null,
      reviewPrompt: d.reviewWindowOpen && d.reviewSide === localSide && d.sideHuman[localSide] ? { seconds: d.reviewCountdown, side: d.reviewSide, canAd: d.rewardedReviewOffer, reviewsLeft: d.reviewsLeft(localSide) } : null,
      toss: tossStage
        ? { stage: tossStage, winner: st.tossWinner >= 0 ? teams[st.tossWinner].name : '', result: d.tossResult < 0 ? '' : d.tossResult === 0 ? 'Heads' : 'Tails', youWon: st.tossWinner === localSide }
        : null,
      chooseBowler:
        d.phase === 'choosebowler' && d.localBowls
          ? {
              options: d.eligibleBowlers().map((p) => {
                const pl = ft.players[p]
                const card = inn.bowling.find((b) => b.player === p)
                return { player: p, name: pl.name, style: styleName(pl), figures: card ? `${card.wickets}-${card.runs}` : '—', overs: card ? oversText(card.balls) : '0' }
              }),
            }
          : null,
      inningsBreak:
        d.phase === 'break' && lastInn
          ? { summary: `${teams[lastInn.battingTeam].name} ${scoreText(lastInn)} (${oversText(lastInn.legalBalls)} ov)`, next: st.result ? st.result : `${teams[1 - lastInn.battingTeam].name} need ${lastInn.runs + 1} to win` }
          : null,
      matchEnd: d.phase === 'end' ? { result: st.result, winner: st.winner } : null,
      replay: this.replaying,
      banner: d.bannerTime > 0 ? d.banner : '',
      bannerSub: d.bannerTime > 0 ? d.bannerSub : '',
      bannerTime: d.bannerTime,
      camera: this.userCam,
      paused: this.paused,
      live: d.phase === 'live',
      running: d.anyRunning,
      quality: this.quality.tier,
      reviewsLeft: inn ? d.reviewsLeft(localSide) : 0,
      card: this.card && this.sinceRelease >= 0 && this.sinceRelease < 3.2 && (d.phase === 'flight' || d.phase === 'live') ? { ...this.card, age: this.sinceRelease } : null,
      timings: this.timings,
      nets: d.nets,
      difficulty: st.setup.difficulty,
      markerWords: d.localBowls && (d.phase === 'predelivery' || d.phase === 'runup') ? lengthWords(d.frame.offsetFwd(d.marker), d.frame.offsetOff(d.marker)).text : '',
      aimDeg: d.localBats ? this.aimFromKeys() : null,
      shotKind: this.shotKind,
      toContact: d.localBats && d.ballReleased && d.phase === 'flight' && d.crossTime('auto') > 0 ? d.crossTime('auto') - d.ball.time - SHOT_LEAD : -1,
    }
  }

  /** Debug summary for tests. */
  debugState() {
    const d = this.director
    const inn = d.state.current
    return {
      phase: d.phase,
      innings: d.state.innings.length,
      score: inn ? scoreText(inn) : '',
      overs: inn ? oversText(inn.legalBalls) : '',
      result: d.state.result,
      finished: d.state.finished,
      actors: d.actors.map((a) => ({ k: a.kind, pose: a.pose, x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2), v: a.visible })),
      ball: d.ball.pos.toArray(2),
      thisOver: d.state.thisOver(),
      lastBalls: inn ? inn.log.slice(-6).map(ballSymbol) : [],
      batters: inn ? [inn.striker, inn.nonStriker].map((p) => bat01(d.battingTeam.players[p])) : [],
      replaying: this.replaying,
    }
  }

  /** Grants an extra review (after a rewarded ad). */
  grantReview() {
    this.director.grantExtraReview(this.opts.localSide)
    this.submit({ t: 'review', side: this.opts.localSide })
  }

  isSpinBowler() {
    const b = this.director.bowler
    return !!b && isSpinStyle(b.bowl)
  }
}

function zoneText(z: string) {
  const map: Record<string, string> = { inline: 'IN LINE', umpirescall: "UMPIRE'S CALL", outside: 'OUTSIDE', outsideoff: 'OUTSIDE OFF', outsideleg: 'OUTSIDE LEG', hitting: 'HITTING', missing: 'MISSING', na: 'FULL TOSS' }
  return map[z] ?? z
}

function poppingView(end: number) {
  return stumpsZ(end) + inward(end) * Geo.CreaseDepth
}

export { STRIKER, FIRST_FIELDER }
