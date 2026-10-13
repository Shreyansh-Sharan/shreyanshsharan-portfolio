// The cricket game in the browser: renderer, stadium, players, ball, the match director, input, cameras (broadcast
// view behind the bowler's arm, ball-following, replays, ball tracking), sound and the feed for the React HUD.
import * as THREE from 'three'
import type { CricketAssets } from './assets'
import { CricketAudio } from './audio'
import { QUALITY, type QualitySettings, type QualityTier } from './quality'
import { ACTORS, Director, FIRST_FIELDER, NONSTRIKER, STRIKER, UMP_BOWLER, UMP_SQUARE, type Actor, type Command, type GameEvent, type Phase, type Pose, type ReplayKind } from './sim/director'
import { DELIVERIES, deliveriesFor, isSpinStyle, type DeliveryType } from './sim/delivery'
import { PRESET_ORDER, type FieldPreset } from './sim/fields'
import { Geo, inward, stumpsZ } from './sim/geo'
import { ballSymbol, oversText, runRate, scoreText, type MatchSetup } from './sim/match'
import { PERFECT, shotSpec, type Footwork, type ShotType, type Timing } from './sim/shots'
import { bat01, hashString, styleName, styleTag, surname, type Player, type Team } from './sim/teams'
import { V3 } from './sim/vec'
import { toView, yawToView } from './view/coords'
import { fadeFor, newPoseMem, procPose, type PoseCtx, type PoseMem } from './view/poses'
import { makeBall, makeMarker, Wicket } from './view/props'
import { Cricketer, type ClipName, type Identity, type KitKind } from './view/rig'
import { Kits } from './view/kit'
import { Stadium } from './view/stadium'
import { Hawkeye } from './view/hawkeye'
import { Guides, lengthWords, type ShotColour } from './view/guides'
import type { Post } from './view/post'
import { Profile } from './profile'

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
  chooseBowler: { options: { player: number; name: string; style: string; tag: string; type: string; pace: number; skill: number; figures: string; overs: string }[] } | null
  inningsBreak: { summary: string; next: string } | null
  matchEnd: { result: string; winner: number } | null
  /** The replay on screen: the shot's caption, slow motion, whose it is, and the tracking readout on a freeze. */
  replay: { label: string; slow: boolean; owner: string; index: number; count: number; kind: string; track: { pitching: string; impact: string; wickets: string; time: number } | null } | null
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
  card: { bowler: string; kmh: number; kmhTenths: number; type: string; spin: boolean; words: string; late: boolean; age: number } | null
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
  hero: boolean
  milestone: { title: string; name: string; line: string; kind: string; age: number } | null
  runCall: { text: string; who: number; age: number } | null
  bowlerCard: { name: string; tag: string; pace: number; skill: number; stamina: number; figures: string; type: string } | null
  pip: { x: number; y: number; w: number; h: number; label: string } | null
  restrictions: { powerplay: boolean; maxOutside: number; outside: number } | null
  canReplay: boolean
  replayPref: ReplayPref
  canEditField: boolean
  fieldVersion: number
  rrr: string
}

interface FrameRec {
  actors: Float32Array
  poses: string[]
  ball: [number, number, number, number]
}

/** Per-actor display state: damped reach targets, measured speed and turn rate, the last pose (for fade times). */
interface ActorView {
  mem: PoseMem
  prevPos: THREE.Vector3
  hasPrev: boolean
  speed: number
  prevYaw: number
  /** The yaw shown (the sim may snap; this turns at a limited rate). */
  yawShown: number
  yawRate: number
  accel: number
  lastPose: Pose
  lastVariant: string
  key: string
  fade: number
}

const newView = (): ActorView => ({ mem: newPoseMem(), prevPos: new THREE.Vector3(), hasPrev: false, speed: 0, prevYaw: 0, yawShown: 0, yawRate: 0, accel: 0, lastPose: 'hidden', lastVariant: '', key: '', fade: 0.2 })
/** Fastest a body is shown turning (degrees per second): a half turn takes a fifth of a second. */
const TURN_RATE = 900

const ACTOR_FIELDS = 12
/** Replay recording length (frames at 60 Hz). */
const MAX_REC = 1500
const _pp = new THREE.Vector3()
const _ballView = new THREE.Vector3()
const _ballChar = new THREE.Vector3()
const _aheadView = new THREE.Vector3()
const _aheadChar = new THREE.Vector3()
const _camPos = new THREE.Vector3()
const _camLook = new THREE.Vector3()
const _focus = new THREE.Vector3()
const _flat = new THREE.Vector3()
const _away = new THREE.Vector3()
const _bpos = new THREE.Vector3()
const _sphere = new THREE.Sphere(new THREE.Vector3(), 3)
const POSES: Pose[] = ['hidden', 'idle', 'walk', 'run', 'stance', 'shot', 'slide', 'batslide', 'runup', 'deliver', 'follow', 'keeper', 'keepertake', 'ready', 'dive', 'catch', 'pickup', 'throw', 'celebrate', 'appeal', 'dejected', 'umpire', 'signal', 'leave', 'hit', 'getup']

const v3 = (a: number[] | V3) => toView(a as V3)
const FEET: Footwork[] = ['auto', 'front', 'back', 'charge']
/** The release meter's arc: needle angles (degrees clockwise from straight up) at empty and full. A "C" on the left. */
export const METER_ARC = { from: 205, to: 335 }

export type ReplayPref = 'all' | 'key' | 'off'
const REPLAY_KEY = 'cricket-replays'
function savedReplays(): ReplayPref {
  try {
    const v = localStorage.getItem(REPLAY_KEY)
    return v === 'key' || v === 'off' ? v : 'all'
  } catch {
    return 'all'
  }
}

/** A soft round dot for point sprites. */
function dotTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(16, 16, 2, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 32, 32)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const _rb = new THREE.Vector3()
const _rl = new THREE.Vector3()
/** Points in the replay's ball trail. */
const TRAIL_MAX = 420

/** Frame indices of the key moments in a recording (-1 = did not happen). */
interface Marks {
  release: number
  bounce: number
  hit: number
  pad: number
  stumps: number
  stumpsEnd: number
  stumpsAt: THREE.Vector3
  stumpsSpeed: number
  catch: number
  catcher: number
  strikerEnd: number
  /** Which side of the view (x sign) the striker's off side is on. */
  offX: number
  how: string
  kind: string
}
const newMarks = (): Marks => ({ release: -1, bounce: -1, hit: -1, pad: -1, stumps: -1, stumpsEnd: 0, stumpsAt: new THREE.Vector3(), stumpsSpeed: 20, catch: -1, catcher: -1, strikerEnd: 1, offX: 1, how: '', kind: '' })
function resetMarks(m: Marks) {
  m.release = m.bounce = m.hit = m.pad = m.stumps = m.catch = m.catcher = -1
  m.stumpsEnd = 0
  m.stumpsSpeed = 20
  m.how = m.kind = ''
}

type ShotCam = 'broadcast' | 'side' | 'stump' | 'behind' | 'catch' | 'crease' | 'follow' | 'track' | 'wide'
interface ReplayShot {
  cam: ShotCam
  from: number
  to: number
  speed: number
  label: string
  /** Seconds to stay on the last frame. */
  hold?: number
}
interface ReplayPlan {
  kind: ReplayKind
  shots: ReplayShot[]
  owner: 'director' | 'tv' | 'instant'
  frames: FrameRec[]
  count: number
  marks: Marks
}

/** The edit for a replay: 2-4 shots from broadcast angles, slow motion around the moment that mattered. */
function planShots(kind: ReplayKind, m: Marks, n: number, owner: ReplayPlan['owner']): ReplayShot[] {
  const last = n - 1
  const rel = m.release >= 0 ? m.release : 0
  const S = (cam: ShotCam, from: number, to: number, speed: number, label: string, hold = 0): ReplayShot => {
    const f = Math.max(0, Math.min(last, Math.round(from)))
    return { cam, from: f, to: Math.max(f, Math.min(last, Math.round(to))), speed, label, hold }
  }
  if (owner === 'tv') return m.stumps >= 0 ? [S('crease', m.stumps - 55, m.stumps + 20, 0.22, 'THIRD UMPIRE · SIDE-ON', 0.8)] : []
  const hit = m.hit >= 0 ? m.hit : -1
  switch (kind) {
    case 'runout':
      if (m.stumps < 0) return []
      return [S('wide', m.stumps - 150, m.stumps + 20, 1, 'REPLAY'), S('crease', m.stumps - 45, m.stumps + 25, 0.3, 'SIDE-ON · SLOW MOTION', 0.4)]
    case 'six':
      if (hit < 0) return []
      return [S('broadcast', rel - 20, hit + 40, 1, 'REPLAY'), S('behind', hit - 30, hit + 45, 0.35, 'BEHIND THE BAT · SLOW MOTION'), S('follow', hit, hit + 190, 1, 'THE CARRY')]
    case 'four':
      if (hit < 0) return []
      return [S('broadcast', rel - 15, hit + 35, 1, 'REPLAY'), S('behind', hit - 25, hit + 40, 0.4, 'BEHIND THE BAT · SLOW MOTION')]
    case 'wicket': {
      if (m.how === 'caught' && m.catch >= 0)
        return [S('broadcast', rel - 20, (hit >= 0 ? hit : m.catch) + 40, 1, 'REPLAY'), S('side', (hit >= 0 ? hit : m.catch) - 35, (hit >= 0 ? hit : m.catch) + 30, 0.35, 'SIDE-ON · SLOW MOTION'), S('catch', m.catch - 70, m.catch + 40, 0.45, 'THE CATCH')]
      if (m.how === 'lbw' && m.pad >= 0)
        return [S('broadcast', rel - 20, m.pad + 40, 1, 'REPLAY'), S('side', m.pad - 40, m.pad + 30, 0.3, 'SIDE-ON · SLOW MOTION'), S('track', m.pad, m.pad, 1, 'BALL TRACKING', 5.4)]
      if (m.how === 'bowled' && m.stumps >= 0)
        return [S('broadcast', rel - 20, m.stumps + 40, 1, 'REPLAY'), S('stump', rel + 8, m.stumps + 25, 0.3, 'STUMP CAM · SLOW MOTION'), S('side', m.stumps - 45, m.stumps + 40, 0.35, 'SIDE-ON · SLOW MOTION'), S('track', m.stumps, m.stumps, 1, 'BALL TRACKING', 3.4)]
      if (m.how === 'stumped' && m.stumps >= 0) return [S('broadcast', rel - 20, m.stumps + 30, 1, 'REPLAY'), S('crease', m.stumps - 40, m.stumps + 25, 0.3, 'SIDE-ON · SLOW MOTION')]
      const key = m.stumps >= 0 ? m.stumps : hit >= 0 ? hit : last - 40
      return [S('broadcast', rel - 20, key + 40, 1, 'REPLAY'), S('side', key - 40, key + 30, 0.35, 'SIDE-ON · SLOW MOTION')]
    }
    default: {
      if (m.catch >= 0) return [S('side', (hit >= 0 ? hit : m.catch) - 30, (hit >= 0 ? hit : m.catch) + 30, 0.35, 'SIDE-ON · SLOW MOTION'), S('catch', m.catch - 60, m.catch + 40, 0.45, 'PUT DOWN')]
      if (m.pad >= 0) return [S('side', m.pad - 40, m.pad + 30, 0.3, 'SIDE-ON · SLOW MOTION'), S('track', m.pad, m.pad, 1, 'BALL TRACKING', 5.4)]
      const key = hit >= 0 ? hit : rel + 40
      return [S('broadcast', rel - 20, key + 40, 1, 'REPLAY'), S('stump', rel + 8, key + 20, 0.32, 'STUMP CAM · SLOW MOTION')]
    }
  }
}

type CamMode = 'broadcast' | 'batter' | 'follow' | 'orbit' | 'replay' | 'hawk' | 'high' | 'hero'
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
  profile = new Profile()
  private people: (Cricketer | null)[] = new Array(ACTORS).fill(null)
  private views: ActorView[] = new Array(ACTORS).fill(null).map(newView)
  /** Stand-ins for the actors during replays (the recorded frame's values over the live actor). */
  private fakes: Actor[] = []
  private frameNo = 0
  private frustum = new THREE.Frustum()
  private frustumM = new THREE.Matrix4()
  private lastHudJson = ''
  /** The HUD's meter elements, moved every frame while the meter runs (no React render for the needle). */
  private meterWrap: HTMLElement | null = null
  private meterNeedle: HTMLElement | null = null
  kits: Kits
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
  private recCount = 0
  private replaying = false
  private replayTrail: THREE.Points
  private replayTrailPos = new Float32Array(TRAIL_MAX * 3)
  private flightTrail: THREE.Points
  private flightTrailPos = new Float32Array(TRAIL_MAX * 3)
  private flightTrailN = 0
  /** Automatic replays: everything, only wickets and sixes, or none. */
  replayPref: ReplayPref = 'all'
  private heroLight: THREE.SpotLight | null = null
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
    // The shadow map is redrawn on alternate frames on the medium tier (see frame()).
    this.renderer.shadowMap.autoUpdate = false
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

    this.kits = new Kits(this.quality.tier === 'low' ? 256 : 512)
    this.prewarmKits()
    this.ball = makeBall(opts.assets)
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
    this.wickets = [new Wicket(0, opts.assets), new Wicket(1, opts.assets)]
    for (const w of this.wickets) this.scene.add(w.group)
    this.marker = makeMarker()
    this.marker.visible = false
    this.scene.add(this.marker)
    this.scene.add(this.guides.group)
    this.hawk = new Hawkeye()
    this.scene.add(this.hawk.group)
    // The replay's dotted ball trail.
    const trailGeo = new THREE.BufferGeometry()
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.replayTrailPos, 3))
    trailGeo.setDrawRange(0, 0)
    this.replayTrail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ color: '#ffd34d', size: 7, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false, alphaTest: 0.05 }))
    this.replayTrail.frustumCulled = false
    this.replayTrail.visible = false
    this.replayTrail.renderOrder = 6
    this.scene.add(this.replayTrail)
    // The delivery's path through the air while it is bowled, so swing, drift and dip read on screen.
    const flightGeo = new THREE.BufferGeometry()
    flightGeo.setAttribute('position', new THREE.BufferAttribute(this.flightTrailPos, 3))
    flightGeo.setDrawRange(0, 0)
    this.flightTrail = new THREE.Points(flightGeo, new THREE.PointsMaterial({ color: '#a5f3fc', size: 5, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 0.75, depthWrite: false, alphaTest: 0.05 }))
    this.flightTrail.frustumCulled = false
    this.flightTrail.visible = false
    this.flightTrail.renderOrder = 6
    this.scene.add(this.flightTrail)
    // A key light for the celebration close-ups (always in the scene so it never forces a shader rebuild; dark
    // until a hero shot). Not on the low tier.
    if (this.quality.tier !== 'low') {
      this.heroLight = new THREE.SpotLight('#fff1d6', 0, 22, 0.42, 0.6, 1.2)
      this.scene.add(this.heroLight, this.heroLight.target)
    }
    this.replayPref = savedReplays()

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.setupPost()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer)
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
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
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.audio.close()
    this.profile.dispose()
    this.postToken++
    this.post?.dispose()
    this.guides.dispose()
    for (const p of this.people) p?.dispose()
    this.kits.dispose()
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
    const P = this.profile
    P.frameStart()
    const tFrame = P.now()
    let t = tFrame
    const frozen = this.paused || this.hold
    if (!frozen) {
      this.time += dt
      this.handleHeldInput(dt)
      if (!this.opts.mirror && !this.replayHeld) d.update(dt)
      if (this.meterNeedle && d.localBowls && d.meterRunning) this.moveMeter(d.meterValue, Math.abs(d.meterValue - d.meterGreen) <= d.meterHalfWidth)
      t = P.add('director', t)
      for (const c of this.pendingCommands.splice(0)) this.submit(c)
      for (const e of d.drainEvents()) this.handleEvent(e)
      t = P.add('events', t)
      this.trackRelease(dt)
      if (this.replaying) this.advanceReplay(dt)
      else this.record()
      t = P.add('record', t)
      this.stadium.update(dt)
      t = P.add('stadium', t)
      this.audio.update(dt)
      for (const w of this.wickets) w.update(dt)
      this.timingFlash = Math.max(0, this.timingFlash - dt * 2.5)
      t = P.add('audio+wickets', t)
    }
    this.syncKits()
    t = P.add('kits', t)
    if (this.replaying) this.applyReplayFrame(dt)
    else this.updatePeople(frozen ? 0 : dt)
    t = P.add('people', t)
    this.updateMarker()
    this.updateCamera(frozen ? 0 : dt)
    this.updateBall()
    this.updateGuides()
    this.hawk.update(d, frozen ? 0 : dt)
    this.updatePip()
    this.radarT -= dt
    if (this.radarT <= 0 || dt === 0) {
      this.radarT = 1 / 30
      this.updateRadar()
    }
    this.updateHeroLight(frozen ? 0 : dt)
    t = P.add('camera+ball+guides', t)
    this.hudT -= dt
    if (this.hudT <= 0 || dt === 0) {
      this.hudT = 0.1
      this.pushHud()
    }
    t = P.add('hud', t)
    if (render) {
      this.frameNo++
      // Shadows every frame on high (and in tests), every other frame otherwise: a 16 ms lag nobody can see.
      this.renderer.shadowMap.needsUpdate = this.quality.tier === 'high' || !!this.opts.snap || dt === 0 || (this.frameNo & 1) === 0 || !this.stadium.sun.shadow.map
      if (this.post) this.post.render(dt)
      else this.renderer.render(this.scene, this.camera)
      this.renderPip()
      t = P.add('render', t)
    }
    P.add('frame', tFrame)
    P.frameEnd()
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
      if (!this.replaying) for (const w of this.wickets) if (w.broken && d.phase === 'predelivery') w.reset()
    }
  }

  /* ---------------- players ---------------- */

  /** Paints and uploads every shirt decal the match can need (both squads, both handednesses) before the first
   *  frame (the kit colours themselves are shader uniforms). */
  private prewarmKits() {
    const teams = this.opts.setup.teams
    for (const t of teams) {
      t.players.forEach((p, i) => {
        for (const left of new Set([p.leftBat, p.leftArm])) this.kits.decal(this.shirtSpec(t, p, i + 1, left))
      })
    }
    this.kits.upload(this.renderer)
  }

  private shirtSpec(t: Team, p: Player | null, number: number, left: boolean) {
    const whites = t.kit === 'whites'
    return { chest: t.name, back: p ? surname(p) : '', number: String(number), ink: whites ? t.primary : t.secondary, mirror: left }
  }

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
      let player: Player | null = null
      if (i === STRIKER || i === NONSTRIKER) {
        kind = 'batter'
        team = bat
        player = bat.players[a.player] ?? null
      } else if (i === UMP_BOWLER || i === UMP_SQUARE) {
        kind = 'umpire'
      } else {
        kind = a.player === field.keeper ? 'keeper' : 'fielder'
        player = field.players[a.player] ?? null
      }
      const number = kind === 'umpire' ? i : Math.max(0, a.player) + 1
      const who: Identity = {
        teamName: kind === 'umpire' ? '' : team.name,
        surname: player ? surname(player) : '',
        number,
        body: (hashString(team.id) + number) % 2,
        skin: kind === 'umpire' ? i % 4 : (player?.skin ?? 0),
        left: kind !== 'umpire' && a.left,
      }
      const c = new Cricketer(this.opts.assets, this.kits, kind, kit(team), who)
      this.scene.add(c.root)
      this.people[i] = c
      this.views[i] = newView()
    }
    this.fakes = []
  }

  private poseCtx(a: Actor, c: Cricketer, ballView: THREE.Vector3 | null, view: ActorView, dt: number): PoseCtx {
    const d = this.director
    const inn = d.state.current
    let kind: PoseCtx['kind'] = a.kind
    if (a.index === STRIKER) kind = 'striker'
    else if (a.index === NONSTRIKER) kind = 'nonstriker'
    // "Ahead": for the striker and keeper the bowler's end; for others the striker's end.
    const strikerEnd = inn ? inn.strikerEnd : 1
    const nearEnd = a.index === STRIKER || a.kind === 'keeper'
    _aheadView.set(0, nearEnd ? 1.5 : 1.0, stumpsZ(nearEnd ? 1 - strikerEnd : strikerEnd))
    const ahead = c.toChar(_aheadView, _aheadChar)
    const bowler = d.bowler
    const live = d.phase === 'flight' || d.phase === 'live'
    return {
      pose: a.pose,
      t: a.poseTime,
      dt,
      variant: a.variant,
      feet: a.feet,
      loft: a.loft,
      aim: a.aim,
      power: a.loft ? 1 : a.variant === 'defend' ? 0.25 : 0.65,
      ball: ballView ? c.toChar(ballView, _ballChar) : null,
      sinceRelease: live ? this.sinceRelease : -1,
      toRelease: d.phase === 'runup' && !d.ballReleased ? Math.max(0, d.runUpDuration - d.phaseTime) : -1,
      ahead,
      kind,
      style: bowler?.bowl ?? 'fast',
      hasBall: a.hasBall,
      speed: view.speed,
      yawRate: view.yawRate,
      accel: view.accel,
      mem: view.mem,
    }
  }

  private clipFor(a: Actor, sp: number): { clip: ClipName; scale: number } {
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
        return sp > 0.6 ? { clip: 'jog', scale: Math.max(0.7, sp / 3.5) } : { clip: 'idle', scale: 1 }
      default:
        return { clip: sp > 0.6 ? (sp > 4 ? 'sprint' : 'jog') : 'idle', scale: sp > 0.6 ? Math.max(0.7, sp / 4) : 1 }
    }
  }

  private updatePeople(dt: number) {
    const d = this.director
    const ballView = d.ballVisible ? toView(d.ball.pos, _ballView) : null
    const camPos = this.camera.position
    // Fielders the camera can't see are neither posed nor drawn (the four at the crease always are).
    const cull = dt > 0 && !this.debugView
    if (cull) {
      this.camera.updateMatrixWorld()
      this.frustum.setFromProjectionMatrix(this.frustumM.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse))
    }
    for (let i = 0; i < ACTORS; i++) {
      const a = d.actors[i]
      const c = this.people[i]
      if (!c) continue
      c.root.visible = a.visible && a.pose !== 'hidden'
      if (!c.root.visible) continue
      if (cull && i > NONSTRIKER && a.kind !== 'bowler' && a.kind !== 'keeper') {
        toView(a.pos, _sphere.center).y += 1
        if (!this.frustum.intersectsSphere(_sphere)) {
          c.root.visible = false
          continue
        }
      }
      this.placePerson(c, a.pos, a.yaw, a.left, a, ballView, dt, camPos, this.views[i])
    }
  }

  private placePerson(c: Cricketer, pos: V3 | THREE.Vector3, yaw: number, left: boolean, a: Actor, ballView: THREE.Vector3 | null, dt: number, camPos: THREE.Vector3, view: ActorView) {
    const p = pos instanceof V3 ? toView(pos, _pp) : pos
    p.y = 0
    // Mirror left-handers (batting or bowling). Umpires never.
    const mirror = a.kind !== 'umpire' && left
    const yawSim = yawToView(yaw)
    // Measured motion for the clips and the lean: the sim moves some actors without setting a velocity.
    if (dt > 0) {
      if (view.hasPrev) {
        const ds = Math.hypot(p.x - view.prevPos.x, p.z - view.prevPos.z) / dt
        if (ds > 14) view.hasPrev = false // a teleport (new ball, new innings)
        else {
          const k = 1 - Math.exp(-dt * 12)
          const spNew = Math.max(a.speed, ds)
          view.accel += ((spNew - view.speed) / dt - view.accel) * k
          view.speed += (spNew - view.speed) * k
          // Turn towards the sim's heading at a limited rate (it can snap a batter round in one step).
          let dy = yawSim - view.yawShown
          if (dy > Math.PI) dy -= 2 * Math.PI
          else if (dy < -Math.PI) dy += 2 * Math.PI
          const maxTurn = ((TURN_RATE * Math.PI) / 180) * dt
          const turn = THREE.MathUtils.clamp(dy, -maxTurn, maxTurn)
          view.yawShown += turn
          view.yawRate += ((((turn / dt) * 180) / Math.PI) * (mirror ? -1 : 1) - view.yawRate) * k
        }
      }
      if (!view.hasPrev) {
        view.hasPrev = true
        view.speed = a.speed
        view.accel = 0
        view.yawRate = 0
        view.yawShown = yawSim
      }
      view.prevPos.copy(p)
      view.prevYaw = yawSim
    } else {
      view.speed = a.speed
      if (!view.hasPrev) view.yawShown = yawSim
    }
    const { clip, scale } = this.clipFor(a, view.speed)
    c.playClip(clip, 0.2, scale)
    c.prepare(p, view.yawShown, mirror)
    if (a.pose !== view.lastPose || a.variant !== view.lastVariant) {
      view.fade = fadeFor(a.pose, view.lastPose)
      view.lastPose = a.pose
      view.lastVariant = a.variant
      view.key = a.pose + '|' + a.variant
    }
    const pose = procPose(this.poseCtx(a, c, ballView, view, dt))
    c.update(dt, pose, view.key, view.fade)
    // Distant fielders: the low-detail body; shirt decals (names and numbers) only where they can be read.
    if (a.kind !== 'striker' && a.index > NONSTRIKER) {
      const dist = p.distanceTo(camPos)
      c.setLod(this.quality.lodDistance === 0 || dist > this.quality.lodDistance, dist > Math.max(30, this.quality.lodDistance))
    }
  }

  /* ---------------- ball, marker ---------------- */

  /** Fills the delivery's dotted path from the sim's record of it (every other step, release to now). */
  private updateFlightTrail() {
    const d = this.director
    const show = !this.replaying && d.ballReleased && (d.phase === 'flight' || d.phase === 'live' || d.phase === 'dead') && d.deliveryTrail.length > 2
    if (!show) {
      this.flightTrail.visible = false
      this.flightTrailN = 0
      return
    }
    const list = d.deliveryTrail
    const pos = this.flightTrailPos
    let n = this.flightTrailN
    // Points only get added: continue from where we were.
    for (let i = n; i < list.length && n < TRAIL_MAX; i++) {
      const p = list[i]
      pos[n * 3] = -p.x
      pos[n * 3 + 1] = p.y
      pos[n * 3 + 2] = p.z
      n++
    }
    if (n !== this.flightTrailN) {
      this.flightTrailN = n
      const g = this.flightTrail.geometry
      ;(g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      g.setDrawRange(0, n)
    }
    this.flightTrail.visible = n > 2
    // Fade once the ball is past the batter.
    ;(this.flightTrail.material as THREE.PointsMaterial).opacity = d.phase === 'flight' ? 0.8 : Math.max(0, 0.8 - d.phaseTime * 0.6)
  }

  private updateBall() {
    const d = this.director
    this.updateFlightTrail()
    let vis = d.ballVisible && d.phase !== 'review'
    let pos: THREE.Vector3
    if (this.replaying) {
      const f = this.replayFrame()
      vis = !!f && f.ball[3] > 0.5
      pos = f ? _bpos.set(-f.ball[0], f.ball[1], f.ball[2]) : _bpos.set(0, 0, 0)
    } else pos = toView(d.ball.pos, _bpos)
    // Before release the ball is in the bowler's hand.
    const bi = d.bowlerActor ? d.bowlerActor.index : -1
    const inHand = !vis && !this.replaying && bi >= 0 && !d.ballReleased && (d.phase === 'runup' || d.phase === 'predelivery') && !!this.people[bi]?.root.visible
    if (inHand) {
      this.people[bi]!.handWorld('r', _bpos)
      this.ball.visible = true
      this.ball.position.copy(_bpos)
      this.ball.scale.setScalar(1.15)
      this.ballShadow.visible = false
      this.trail.visible = false
      this.guides.setGlow(null, 0)
      this.guides.setGhosts([], 1)
      return
    }
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
    else if (this.heroActive()) mode = 'hero'
    else if (d.phase === 'review' && d.review.kind === 'lbw') mode = 'hawk'
    else if (d.phase === 'review' && d.review.kind === 'runout') mode = 'hawk'
    else if (inn && (d.phase === 'predelivery' || d.phase === 'runup' || d.phase === 'flight')) mode = userCam
    else if (inn && (d.phase === 'live' || d.phase === 'dead')) mode = d.liveTime < (userCam === 'batter' ? 0.35 : 0.12) && d.phase === 'live' && !d.heldBy ? userCam : 'follow'
    if (mode !== this.camMode) {
      this.followSince = 0
      this.camMode = mode
    }
    this.followSince += dt
    const pos = _camPos.set(0, 0, 0)
    const look = _camLook.set(0, 0, 0)
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
        const flat = _flat.set(b.x, 0, b.z)
        const dist = flat.length()
        const away = dist > 0.5 ? _away.copy(flat).normalize() : _away.set(0, 0, -dirZ)
        // From behind the pitch, fairly low, looking out at the ball so the field and the stands are in shot.
        pos.set(0, 0, 0).addScaledVector(away, dist * 0.3 - 20).setY(5.5 + dist * 0.07 + Math.max(0, b.y) * 0.3)
        look.copy(b).setY(Math.max(0.4, b.y * 0.8))
        fov = 32 + Math.min(14, dist * 0.12)
        break
      }
      case 'replay':
        fov = this.replayCamera(pos, look)
        snap = true
        break
      case 'hero':
        fov = this.heroCamera(pos, look)
        snap = this.followSince < 0.05
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
    if (d.heldBy) return toView(d.heldBy.pos, _focus).setY(1)
    return toView(d.ball.pos, _focus)
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
  // Every ball is recorded (actors and ball, 60 Hz, reusing the frame objects). The last ball's recording is kept
  // until the next release for the instant replay. A replay is a short edit of 2-4 "shots" from broadcast angles:
  // behind the bowler in real time, side-on and stump cam in slow motion, the catch close up, the carry of a six, and
  // a ball-tracking freeze for bowled and LBW.

  private marks: Marks = newMarks()
  private prevRec: FrameRec[] = []
  private prevCount = 0
  private prevMarks: Marks = newMarks()
  private plan: ReplayPlan | null = null
  private shotIdx = 0
  private shotT = 0
  private replayIdx = 0
  private replayBroke = -1
  private replayHeld = false

  private record() {
    const d = this.director
    if (d.phase === 'predelivery') {
      if (this.recCount > 20) {
        // Keep the last ball for the instant replay (swap the buffers: no copying, no allocation).
        const r = this.prevRec
        this.prevRec = this.recording
        this.recording = r
        this.prevCount = this.recCount
        const m = this.prevMarks
        this.prevMarks = this.marks
        this.marks = m
      }
      this.recCount = 0
      resetMarks(this.marks)
      return
    }
    if (d.phase !== 'runup' && d.phase !== 'flight' && d.phase !== 'live' && d.phase !== 'dead') return
    if (this.recCount >= MAX_REC) return
    // Frames are reused ball after ball: nothing is allocated once the buffer has filled once.
    let rec = this.recording[this.recCount]
    if (!rec) {
      rec = { actors: new Float32Array(ACTORS * ACTOR_FIELDS), poses: new Array(ACTORS).fill(''), ball: [0, 0, 0, 0] }
      this.recording[this.recCount] = rec
    }
    this.recCount++
    const arr = rec.actors
    const poses = rec.poses
    for (let i = 0; i < ACTORS; i++) {
      const a = d.actors[i]
      const o = i * ACTOR_FIELDS
      arr[o] = a.pos.x
      arr[o + 1] = a.pos.z
      arr[o + 2] = a.yaw
      arr[o + 3] = POSES.indexOf(a.pose)
      arr[o + 4] = a.poseTime
      arr[o + 5] = a.aim
      arr[o + 6] = a.loft ? 1 : 0
      arr[o + 7] = FEET.indexOf(a.feet)
      arr[o + 8] = a.hasBall ? 1 : 0
      arr[o + 9] = a.visible ? 1 : 0
      arr[o + 10] = a.left ? 1 : 0
      arr[o + 11] = a.speed
      poses[i] = a.variant
    }
    rec.ball[0] = d.ball.pos.x
    rec.ball[1] = d.ball.pos.y
    rec.ball[2] = d.ball.pos.z
    rec.ball[3] = d.ballVisible ? 1 : 0
  }

  private mark(e: GameEvent) {
    if (this.replaying) return
    const n = this.recCount
    const m = this.marks
    if (e.type === 'release') {
      m.release = n
      m.strikerEnd = this.director.state.current?.strikerEnd ?? 1
      m.offX = Math.sign(toView(this.director.frame.off, _rl).x || 1)
    } else if (e.type === 'bounce' && m.bounce < 0 && m.hit < 0) m.bounce = n
    else if ((e.type === 'bathit' || e.type === 'edge' || e.type === 'pad') && m.hit < 0) {
      m.hit = n
      if (e.type === 'pad') m.pad = n
    } else if (e.type === 'stumps' && m.stumps < 0) {
      m.stumps = n
      m.stumpsEnd = e.i ?? 0
      if (e.p) m.stumpsAt.set(-e.p[0], e.p[1], e.p[2])
      else m.stumpsAt.set(0, 0.5, stumpsZ(e.i ?? 0))
      m.stumpsSpeed = e.f ?? 20
    } else if (e.type === 'catch' && m.catch < 0) {
      m.catch = n
      m.catcher = e.i ?? -1
    } else if (e.type === 'drop' && m.catch < 0) {
      m.catch = n
      m.catcher = e.i ?? -1
    } else if (e.type === 'wicket') m.how = e.text ?? ''
    else if (e.type === 'six') m.kind = 'six'
    else if (e.type === 'four') m.kind = 'four'
  }

  /** The director asks for a replay after a wicket, a boundary or a close call. */
  private startReplay(kind: ReplayKind) {
    if (this.opts.online || this.recCount < 20 || this.replayPref === 'off') return false
    if (this.replayPref === 'key' && (kind === 'four' || kind === 'close')) return false
    return this.beginPlan(kind, this.recording, this.recCount, this.marks, 'director')
  }

  /** The instant replay button: the ball just bowled (or the last one, before the next run-up). */
  get canInstantReplay() {
    const d = this.director
    if (this.opts.online || this.replaying || this.paused || this.hold) return false
    if (d.phase === 'predelivery') return this.prevCount > 20 && this.prevMarks.release >= 0
    return d.phase === 'dead' && this.recCount > 20 && this.marks.release >= 0
  }

  instantReplay() {
    if (!this.canInstantReplay) return
    const d = this.director
    const pre = d.phase === 'predelivery'
    const frames = pre ? this.prevRec : this.recording
    const count = pre ? this.prevCount : this.recCount
    const m = pre ? this.prevMarks : this.marks
    const kind: ReplayKind = m.how ? (m.how === 'runout' ? 'runout' : 'wicket') : m.kind === 'six' ? 'six' : m.kind === 'four' ? 'four' : 'close'
    if (this.beginPlan(kind, frames, count, m, 'instant')) {
      this.replayHeld = true
      this.audio.whoosh()
      this.pushHud()
    }
  }

  /** The third umpire's look at a run out: the crease side-on, frame by frame. */
  private startTvReplay() {
    if (this.opts.online || this.recCount < 20 || this.marks.stumps < 0) return
    this.beginPlan('runout', this.recording, this.recCount, this.marks, 'tv')
  }

  private beginPlan(kind: ReplayKind, frames: FrameRec[], count: number, m: Marks, owner: ReplayPlan['owner']) {
    const shots = planShots(kind, m, count, owner)
    if (!shots.length) return false
    this.plan = { kind, shots, owner, frames, count, marks: m }
    this.shotIdx = 0
    this.shotT = 0
    this.replayIdx = shots[0].from
    this.replaying = true
    this.replayBroke = -1
    for (const w of this.wickets) w.reset()
    this.hawk.clear()
    this.onShotStart()
    return true
  }

  private endReplay() {
    const plan = this.plan
    this.replaying = false
    this.plan = null
    this.hawk.clear()
    this.replayTrail.visible = false
    for (const w of this.wickets) w.reset()
    // Put back what the live match shows (broken stumps of the wicket just taken).
    const m = this.marks
    if (this.director.phase !== 'predelivery' && m.stumps >= 0) this.wickets[m.stumpsEnd].break(m.stumpsAt, 4, -inward(m.stumpsEnd))
    if (!plan) return
    if (plan.owner === 'director') this.director.replayDone = true
    if (plan.owner === 'instant') this.replayHeld = false
    for (const v of this.views) v.hasPrev = false
    this.pushHud()
  }

  get isReplaying() {
    return this.replaying
  }

  setReplayPref(p: ReplayPref) {
    this.replayPref = p
    try {
      localStorage.setItem(REPLAY_KEY, p)
    } catch {
      // Not remembered.
    }
    this.pushHud()
  }

  skipReplay() {
    if (!this.replaying || this.plan?.owner === 'tv') return
    this.endReplay()
  }

  private get shot(): ReplayShot | null {
    return this.plan ? (this.plan.shots[this.shotIdx] ?? null) : null
  }

  /** Advances the edit: frame index within the shot, holds, the next shot, the end. */
  private advanceReplay(dt: number) {
    const plan = this.plan
    const sh = this.shot
    if (!plan || !sh) return
    this.shotT += dt
    const run = ((sh.to - sh.from) / 60) / sh.speed
    this.replayIdx = Math.min(sh.to, sh.from + this.shotT * 60 * sh.speed)
    if (this.shotT >= run + (sh.hold ?? 0)) {
      this.shotIdx++
      this.shotT = 0
      if (this.shotIdx >= plan.shots.length) {
        // The third umpire's view holds on the last frame until the decision is in.
        if (plan.owner === 'tv') {
          this.shotIdx = plan.shots.length - 1
          this.shotT = run + (sh.hold ?? 0)
          return
        }
        this.endReplay()
        return
      }
      this.replayIdx = plan.shots[this.shotIdx].from
      this.onShotStart()
    }
  }

  /** A new shot of the edit: stumps put back if it starts before they went, the tracking graphic for a freeze. */
  private onShotStart() {
    const plan = this.plan
    const sh = this.shot
    if (!plan || !sh) return
    const m = plan.marks
    this.replayBroke = -1
    if (m.stumps >= 0) this.wickets[m.stumpsEnd].reset()
    for (const v of this.views) v.hasPrev = false
    this.hawk.clear()
    if (sh.cam === 'track') this.buildTrack(plan)
    this.audio.whoosh()
  }

  private replayFrame(): FrameRec | null {
    const plan = this.plan
    if (!plan || !plan.count) return null
    return plan.frames[Math.min(plan.count - 1, Math.max(0, Math.floor(this.replayIdx)))]
  }

  private applyReplayFrame(dt: number) {
    const f = this.replayFrame()
    const plan = this.plan
    const sh = this.shot
    if (!f || !plan || !sh) return
    const d = this.director
    const idx = Math.floor(this.replayIdx)
    const frozen = sh.cam === 'track' || this.replayIdx >= sh.to
    const adt = frozen ? 0 : dt * sh.speed
    const ballView = f.ball[3] > 0.5 ? _ballView.set(-f.ball[0], f.ball[1], f.ball[2]) : null
    for (let i = 0; i < ACTORS; i++) {
      const c = this.people[i]
      if (!c) continue
      const o = i * ACTOR_FIELDS
      let fake = this.fakes[i]
      if (!fake) {
        fake = Object.create(d.actors[i]) as Actor
        fake.vel = new V3()
        this.fakes[i] = fake
      }
      fake.pose = POSES[f.actors[o + 3]] ?? 'idle'
      fake.poseTime = f.actors[o + 4]
      fake.aim = f.actors[o + 5]
      fake.loft = f.actors[o + 6] > 0.5
      fake.feet = FEET[f.actors[o + 7]] ?? 'auto'
      fake.hasBall = f.actors[o + 8] > 0.5
      fake.variant = f.poses[i]
      fake.vel.x = f.actors[o + 11]
      // The bowler's-end umpire would stand in front of the ball-tracking camera.
      c.root.visible = f.actors[o + 9] > 0.5 && fake.pose !== 'hidden' && !(sh.cam === 'track' && i === UMP_BOWLER)
      if (!c.root.visible) continue
      this.placePerson(c, _pp.set(-f.actors[o], 0, f.actors[o + 1]), f.actors[o + 2], f.actors[o + 10] > 0.5, fake, ballView, adt, this.camera.position, this.views[i])
    }
    // The stumps go down again at the right moment of each shot.
    const m = plan.marks
    if (m.stumps >= 0 && idx >= m.stumps && this.replayBroke !== this.shotIdx) {
      this.replayBroke = this.shotIdx
      this.wickets[m.stumpsEnd].reset()
      this.wickets[m.stumpsEnd].break(m.stumpsAt, m.stumpsSpeed * (sh.speed < 1 ? 0.6 : 1), -inward(m.stumpsEnd))
      this.audio.stumps()
    }
    if (sh.cam === 'track') {
      this.replayTrail.visible = false
      this.hawk.tick(this.shotT)
    } else this.updateReplayTrail(plan, idx)
  }

  /** The dotted trail of the ball from the release to the frame shown. */
  private updateReplayTrail(plan: ReplayPlan, idx: number) {
    const m = plan.marks
    const from = m.release >= 0 ? m.release : 0
    const pos = this.replayTrailPos
    let n = 0
    for (let i = from; i <= idx && n < TRAIL_MAX; i += 1) {
      const f = plan.frames[i]
      if (!f || f.ball[3] < 0.5) continue
      pos[n * 3] = -f.ball[0]
      pos[n * 3 + 1] = f.ball[1]
      pos[n * 3 + 2] = f.ball[2]
      n++
    }
    const g = this.replayTrail.geometry
    ;(g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    g.setDrawRange(0, n)
    this.replayTrail.visible = n > 2
  }

  /** The ball-tracking freeze: the path to the pitching point and on to the stumps, coloured by the verdict. */
  private buildTrack(plan: ReplayPlan) {
    const m = plan.marks
    const d = this.director
    const pts: THREE.Vector3[] = []
    const end = m.pad >= 0 ? m.pad : m.stumps >= 0 ? m.stumps : m.hit >= 0 ? m.hit : plan.count - 1
    for (let i = Math.max(0, m.release); i <= end; i += 2) {
      const f = plan.frames[i]
      if (f && f.ball[3] > 0.5) pts.push(new THREE.Vector3(-f.ball[0], f.ball[1], f.ball[2]))
    }
    if (pts.length < 3) return
    const impactIndex = pts.length - 1
    const t = m.pad >= 0 ? d.lbwTrack : null
    if (t && m.pad >= 0) for (const p of d.lbwProjection) pts.push(toView(p))
    const pitched = m.bounce >= 0 ? plan.frames[m.bounce] : null
    this.hawk.showPath(pts, impactIndex, {
      pitched: pitched ? new THREE.Vector3(-pitched.ball[0], 0, pitched.ball[2]) : null,
      strikerZ: stumpsZ(m.strikerEnd),
      pitching: t ? t.pitching : 'inline',
      impact: t ? t.impactZone : null,
      wickets: t ? t.wickets : m.stumps >= 0 ? 'hitting' : 'missing',
    })
  }

  /** Where the replay camera is for this shot (view coordinates). */
  private replayCamera(pos: THREE.Vector3, look: THREE.Vector3): number {
    const plan = this.plan
    const sh = this.shot
    const f = this.replayFrame()
    if (!plan || !sh || !f) return 30
    const m = plan.marks
    const se = m.strikerEnd
    const sz = stumpsZ(se)
    const toBowler = inward(se)
    const ball = _rb.set(-f.ball[0], f.ball[1], f.ball[2])
    const k = Math.min(1, this.shotT / Math.max(0.5, (sh.to - sh.from) / 60 / sh.speed))
    switch (sh.cam) {
      case 'broadcast':
        // Behind the bowler's arm, telephoto on the striker (the main TV camera).
        pos.set(0.9, 5.5, stumpsZ(1 - se) + toBowler * 22)
        look.set(0.2, 0.9, sz + toBowler * 1.5)
        return 12
      case 'stump':
        // Low at the striker's stumps, looking up the pitch at the bowler: the ball comes straight at you.
        pos.set(0, 0.42, sz + toBowler * 0.1)
        look.set(0, 1.05, sz + toBowler * 12)
        return 36
      case 'side': {
        // Square of the wicket on the off side (in front of the batter), low, easing in a touch.
        const dist = 9 - 2 * k
        pos.set(m.offX * dist, 1.25, sz + toBowler * 1.4)
        look.set(0, 0.75, sz + toBowler * 0.9)
        return 30
      }
      case 'behind': {
        pos.set(0.4, 1.9, sz - toBowler * (6.5 - k))
        if (ball.y > 0.05) look.copy(ball)
        else look.set(0, 1.2, sz + toBowler * 10)
        return 38
      }
      case 'follow': {
        // High behind the striker, the ball sailing away towards the stands.
        pos.set(0, 9 + Math.max(0, ball.y) * 0.25, sz - toBowler * 14)
        look.copy(ball.y > 0.05 ? ball : _rl.set(0, 2, 0))
        return 40
      }
      case 'catch': {
        const ci = Math.min(plan.count - 1, Math.max(0, m.catch))
        const cf = plan.frames[ci]
        const o = Math.max(0, m.catcher) * ACTOR_FIELDS
        const cp = _rl.set(-cf.actors[o], 1.2, cf.actors[o + 1])
        const away = _away.set(cp.x, 0, cp.z).normalize()
        pos.copy(cp).addScaledVector(away, 5.5 - 1.5 * k).setY(1.6)
        look.copy(cp)
        return 34
      }
      case 'crease': {
        const z = stumpsZ(m.stumpsEnd) + inward(m.stumpsEnd) * Geo.CreaseDepth
        pos.set(-5.5 + k, 1.0, z)
        look.set(0, 0.45, z)
        return 26
      }
      case 'wide': {
        pos.set(-26, 12, (sz + stumpsZ(1 - se)) / 2 + toBowler * 4)
        look.copy(ball.y > 0 ? ball : _rl.set(0, 0.5, 0)).setY(0.6)
        return 34
      }
      case 'track':
        // Behind the bowler's stumps, raised, looking down the pitch at the striker's end.
        pos.set(0, 5.2, stumpsZ(1 - se) + toBowler * 9)
        look.set(0, 0.45, sz + toBowler * 0.6)
        return 15
      default:
        return 30
    }
  }

  /** What the HUD shows over a replay. */
  private replayHud(): HudState['replay'] {
    const plan = this.plan
    const sh = this.shot
    if (!this.replaying || !plan || !sh) return null
    const d = this.director
    const t = sh.cam === 'track' && plan.marks.pad >= 0 ? d.lbwTrack : null
    const track =
      sh.cam === 'track'
        ? t
          ? { pitching: zoneText(t.pitching), impact: zoneText(t.impactZone), wickets: zoneText(t.wickets), time: Math.round(this.shotT * 10) / 10 }
          : { pitching: plan.marks.bounce >= 0 ? 'PITCHED' : 'FULL TOSS', impact: '', wickets: plan.marks.stumps >= 0 ? 'HITTING' : 'MISSING', time: Math.round(this.shotT * 10) / 10 }
        : null
    return { label: sh.label, slow: sh.speed < 0.9, owner: plan.owner, index: this.shotIdx, count: plan.shots.length, kind: plan.kind, track }
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
        this.audio.sting('four')
        this.stadium.crowd.cheer(0.7, 3)
        break
      case 'six':
        this.audio.roar(1)
        this.audio.sting('six')
        this.stadium.crowd.cheer(1, 4)
        if (Math.random() < 0.4) this.stadium.crowd.wave()
        if (!d.nets) this.hero = { actor: STRIKER, kind: 'six' }
        break
      case 'wicket': {
        this.audio.roar(0.9)
        this.audio.sting('wicket')
        this.stadium.crowd.cheer(0.9, 3.5)
        const how = e.text ?? ''
        const b = d.bowlerActor
        if (!d.nets && b) {
          // The bowler's moment; a run out is the fielder's.
          let actor = b.index
          if (how === 'runout') {
            const f = d.liveOutcome.fielder
            const fa = f >= 0 ? d.fielderFor(f) : null
            if (fa) actor = fa.index
          }
          this.hero = { actor, kind: 'wicket' }
        }
        break
      }
      case 'milestone': {
        this.audio.sting('milestone')
        this.audio.applause(4)
        this.stadium.crowd.cheer(0.6, 4)
        const bowler = e.text === 'bowler'
        const team = d.state.setup.teams[bowler ? 1 - d.state.current.battingTeam : d.state.current.battingTeam]
        const p = team.players[e.j ?? 0]
        const inn = d.state.current
        if (bowler) {
          const c = inn.bowling.find((x) => x.player === e.j)
          this.milestone = { title: e.i === 5 ? 'FIVE-WICKET HAUL' : 'THREE WICKETS', name: p ? p.name : '', line: c ? `${c.wickets}-${c.runs} (${oversText(c.balls)})` : '', kind: 'bowl', t: this.time }
        } else {
          const c = inn.batting.find((x) => x.player === e.j)
          this.milestone = { title: e.i === 100 ? 'HUNDRED' : 'FIFTY', name: p ? p.name : '', line: c ? `${c.runs} off ${c.balls} balls · ${c.fours}x4 ${c.sixes}x6` : '', kind: 'bat', t: this.time }
          const who = d.actors.findIndex((a, i) => i <= NONSTRIKER && a.player === e.j)
          if (who >= 0) this.hero = { actor: who, kind: 'milestone' }
        }
        break
      }
      case 'maiden':
        this.audio.sting('maiden')
        this.milestone = { title: 'MAIDEN OVER', name: d.fieldingTeam.players[e.i ?? 0]?.name ?? '', line: 'Six balls, no runs', kind: 'bowl', t: this.time }
        break
      case 'hattrick':
        this.audio.sting(e.i === 3 ? 'milestone' : 'maiden')
        this.milestone = { title: e.i === 3 ? 'HAT-TRICK!' : 'ON A HAT-TRICK', name: d.fieldingTeam.players[e.j ?? 0]?.name ?? '', line: e.i === 3 ? 'Three wickets in three balls' : 'Two in two: next ball for the hat-trick', kind: 'bowl', t: this.time }
        break
      case 'call':
        this.audio.call(e.text ?? '')
        this.runCall = { text: (e.text ?? '').toUpperCase(), who: e.i ?? 0, t: this.time }
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
          const spec = DELIVERIES[(e.text as DeliveryType) ?? d.selectedDelivery]
          const kmh = e.f ?? d.lastKmh
          this.card = { bowler: surname(bp), kmh: Math.round(kmh), kmhTenths: Math.round(kmh * 10) / 10, type: spec?.name ?? e.text ?? '', spin, words, late: d.lateSwing && !!spec && spec.swing !== 0, age: 0 }
        }
        break
      }
      case 'runcomplete':
        this.audio.click()
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
      case 'reviewstart':
        if (e.j === 2) this.startTvReplay()
        this.audio.drs()
        break
      case 'phase':
        if (e.text !== 'review' && this.plan?.owner === 'tv') this.endReplay()
        if (e.text === 'review' && d.review.kind === 'lbw') this.hawk.begin(d)
        if (e.text === 'predelivery') {
          this.hero = null
          this.runCall = null
          this.hawk.clear()
          this.shotKind = 'none'
          this.card = null
          this.updateScreen()
        }
        break
    }
    // (Not at release: a texture upload there would hitch the delivery.)
    if (e.type === 'wicket' || e.type === 'four' || e.type === 'six' || e.type === 'overend') this.updateScreen()
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

  private pointerDown = false
  private onPointer = (e: PointerEvent) => {
    this.audio.start()
    this.pointerDown = true
    this.markerFromPointer(e)
  }
  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerDown) this.markerFromPointer(e)
  }
  private onPointerUp = () => {
    this.pointerDown = false
  }
  private _ray = new THREE.Raycaster()
  private _ndc = new THREE.Vector2()
  private _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  /** Bowling: tap or drag on the pitch to put the landing marker there. */
  private markerFromPointer(e: PointerEvent) {
    const d = this.director
    if (this.opts.autopilot || this.paused || this.hold || !d.localBowls || !(d.phase === 'predelivery' || (d.phase === 'runup' && !d.ballReleased))) return
    const r = this.renderer.domElement.getBoundingClientRect()
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this._ray.setFromCamera(this._ndc, this.camera)
    const hit = this._ray.ray.intersectPlane(this._plane, _rl)
    if (!hit) return
    const sim = new V3(-hit.x, 0, hit.z)
    const f = d.frame
    const off = f.offsetOff(sim)
    const len = f.offsetFwd(sim)
    if (Math.abs(off) > 2.2 || len < -1 || len > 15) return
    this.submit({ t: 'target', side: this.opts.localSide, off, len })
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

  /** The touch direction pad (screen space, -1..1 each) and footwork buttons. */
  private touchDir = { x: 0, y: 0 }
  private touchFeet: Footwork = 'auto'
  setTouchDir(x: number, y: number) {
    this.touchDir.x = x
    this.touchDir.y = y
  }
  setTouchFeet(f: Footwork) {
    this.touchFeet = f
  }

  /** Held direction (screen space): x right, y up. */
  private heldDir() {
    const K = this.keys
    let x = this.touchDir.x
    let y = this.touchDir.y
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
    if (this.touchFeet !== 'auto') return this.touchFeet
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
    if (this.replaying && (k === ' ' || k === 'Enter' || k === 'Escape')) {
      this.skipReplay()
      return
    }
    if (k === 'i' && this.canInstantReplay) {
      this.instantReplay()
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
      if ((d.phase === 'flight' || d.phase === 'runup') && ['j', 'k', 'l', 'z', 'x', 'c', 'h'].includes(k)) {
        const defend = k === 'j' || k === 'z'
        const leave = k === 'h'
        const loft = k === 'l' || k === 'c'
        const aim = this.aimFromKeys() ?? (defend || leave ? 0 : this.naturalAim())
        const shot: ShotType = leave ? 'leave' : defend ? 'defend' : 'auto'
        const feet = this.footwork()
        // Online guests time the shot against their own copy of the delivery (what they can see).
        const timing = this.opts.mirror ? d.timingErrorNow(shot, feet) : undefined
        if (!d.shotPending) this.shotKind = leave ? 'none' : defend ? 'defend' : loft ? 'loft' : 'ground'
        c({ t: 'shot', side, shot, loft, feet, aim, timing })
        return
      }
      if (k === 't' && (d.phase === 'predelivery' || d.phase === 'runup')) c({ t: 'charge', side })
      if (d.phase === 'live') {
        if (k === 'r' || k === 'Enter') c({ t: 'run', side })
        if (k === 'f' || k === 'Backspace') c({ t: 'back', side })
        if (k === 'g') c({ t: 'wait', side })
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
  press(action: 'defend' | 'ground' | 'loft' | 'leave' | 'run' | 'back' | 'wait' | 'bowl' | 'review' | 'continue' | 'camera' | 'preset' | 'replay' | 'skip') {
    if (action === 'replay') return this.instantReplay()
    if (action === 'skip') return this.skipReplay()
    const map: Record<string, string> = { defend: 'j', ground: 'k', loft: 'l', leave: 'h', run: 'r', back: 'f', wait: 'g', bowl: ' ', review: 'y', continue: 'Enter', camera: 'c', preset: 'f' }
    if (action === 'preset') this.cyclePreset()
    else this.keyAction(map[action], false)
  }

  /* ---------------- HUD ---------------- */

  /** The HUD hands over its meter elements while the release meter is on screen (null to let go). */
  attachMeter(wrap: HTMLElement | null, needle: HTMLElement | null) {
    this.meterWrap = wrap
    this.meterNeedle = needle
  }

  private meterWasGreen = false
  private moveMeter(value: number, inGreen: boolean) {
    // The needle sweeps the arc (see METER_ARC): a rotation about the arc's centre.
    if (this.meterNeedle) this.meterNeedle.style.transform = `rotate(${METER_ARC.from + value * (METER_ARC.to - METER_ARC.from)}deg)`
    if (this.meterWrap) this.meterWrap.dataset.green = inGreen ? '1' : '0'
    if (inGreen && !this.meterWasGreen) this.audio.tick()
    this.meterWasGreen = inGreen
  }

  /* ---------------- radar, picture-in-picture, hero shots ---------------- */

  private radar: SVGGElement | null = null
  private radarDots: SVGCircleElement[] = []
  private radarBall: SVGCircleElement | null = null
  private radarT = 0
  private radarKey = ''

  /** The HUD hands over the radar's group element; the dots are made here and moved at 30 Hz. */
  attachRadar(g: SVGGElement | null) {
    this.radar = g
    this.radarDots = []
    this.radarBall = null
    this.radarKey = ''
    if (!g) return
    while (g.firstChild) g.removeChild(g.firstChild)
    const NS = 'http://www.w3.org/2000/svg'
    for (let i = 0; i < ACTORS; i++) {
      const c = document.createElementNS(NS, 'circle')
      c.setAttribute('r', i <= NONSTRIKER ? '3.2' : '2.8')
      g.appendChild(c)
      this.radarDots.push(c)
    }
    const b = document.createElementNS(NS, 'circle')
    b.setAttribute('r', '2.2')
    b.setAttribute('class', 'ck-radar-ball')
    g.appendChild(b)
    this.radarBall = b
    this.updateRadar()
  }

  private updateRadar() {
    const g = this.radar
    if (!g) return
    const d = this.director
    const inn = d.state.current
    if (!inn) return
    // Oriented like the broadcast camera: the striker's end at the top. Radar units are metres (rope ~65).
    const dz = inward(1 - inn.strikerEnd)
    const teams = d.state.setup.teams
    const key = `${inn.battingTeam}`
    const recolour = key !== this.radarKey
    this.radarKey = key
    for (let i = 0; i < ACTORS; i++) {
      const a = d.actors[i]
      const c = this.radarDots[i]
      if (!c) continue
      const vis = a.visible && a.pose !== 'hidden' && !(d.nets && a.kind === 'fielder')
      c.style.display = vis ? '' : 'none'
      if (!vis) continue
      c.setAttribute('cx', (a.pos.x * dz).toFixed(1))
      c.setAttribute('cy', (-a.pos.z * dz).toFixed(1))
      if (recolour) {
        const team = a.kind === 'umpire' ? -1 : i <= NONSTRIKER ? inn.battingTeam : 1 - inn.battingTeam
        c.setAttribute('fill', team < 0 ? '#cbd5e1' : teams[team].primary)
        c.setAttribute('stroke', i <= NONSTRIKER ? '#ffffff' : a.kind === 'keeper' ? '#fde047' : 'rgba(0,0,0,0.55)')
      }
    }
    if (this.radarBall) {
      const show = d.ballVisible && !this.replaying
      this.radarBall.style.display = show ? '' : 'none'
      if (show) {
        this.radarBall.setAttribute('cx', (d.ball.pos.x * dz).toFixed(1))
        this.radarBall.setAttribute('cy', (-d.ball.pos.z * dz).toFixed(1))
      }
    }
  }

  private pipCam = new THREE.PerspectiveCamera(22, 1.6, 0.1, 160)
  private pip = { on: false, x: 12, y: 12, w: 0, h: 0, label: '' }

  /** Picture-in-picture of the batter, front-on (medium and high tiers) while the ball is being bowled. */
  private updatePip() {
    const d = this.director
    const inn = d.state.current
    const phaseOk = d.phase === 'predelivery' || d.phase === 'runup' || (d.phase === 'flight' && this.sinceRelease < 1.2)
    const on = this.quality.tier !== 'low' && !this.replaying && !this.debugView && !!inn && (d.localBowls || d.localBats || !!this.opts.autopilot) && phaseOk && this.container.clientWidth >= 560 && this.container.clientHeight >= 500
    this.pip.on = on
    if (!on || !inn) return
    const W = this.container.clientWidth
    const H = this.container.clientHeight
    const w = Math.round(Math.min(300, Math.max(160, W * 0.2)))
    this.pip.w = w
    this.pip.h = Math.round(w * 0.62)
    this.pip.x = 12
    this.pip.y = H < 480 ? 8 : 12
    this.pip.label = d.localBats ? 'YOUR STANCE' : 'BATTER CAM'
    const s = toView(d.striker.pos, _pp)
    const toBowler = inward(inn.strikerEnd)
    const offX = Math.sign(toView(d.frame.off).x || 1)
    this.pipCam.position.set(s.x + offX * 0.7, 1.45, s.z + toBowler * 7.5)
    this.pipCam.lookAt(s.x + offX * 0.15, 1.0, s.z)
    this.pipCam.aspect = w / this.pip.h
    this.pipCam.updateProjectionMatrix()
  }

  private renderPip() {
    if (!this.pip.on) return
    const r = this.renderer
    const H = this.container.clientHeight
    const p = this.pip
    const tone = r.toneMapping
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.shadowMap.needsUpdate = false
    const guides = this.guides.group.visible
    this.guides.group.visible = false
    this.marker.visible = false
    r.setScissorTest(true)
    r.setScissor(p.x, H - p.y - p.h, p.w, p.h)
    r.setViewport(p.x, H - p.y - p.h, p.w, p.h)
    r.render(this.scene, this.pipCam)
    r.setScissorTest(false)
    r.setViewport(0, 0, this.container.clientWidth, H)
    r.toneMapping = tone
    this.guides.group.visible = guides
  }

  /** The celebration close-up after a wicket, a six or a milestone (low angle, a slow push-in, a key light). */
  private hero: { actor: number; kind: string } | null = null
  private milestone: { title: string; name: string; line: string; kind: string; t: number } | null = null
  private runCall: { text: string; who: number; t: number } | null = null
  private heroK = 0

  private heroActive() {
    const d = this.director
    return !!this.hero && !this.replaying && d.phase === 'dead' && d.phaseTime > 0.7 && !d.reviewWindowOpen
  }

  /** Which side the hero camera works from (chosen once per shot so nobody stands in the way). */
  private heroSide = 0
  private heroFor = -1

  private heroCamera(pos: THREE.Vector3, look: THREE.Vector3) {
    const d = this.director
    const h = this.hero!
    const a = d.actors[h.actor]
    const p = toView(a.pos, _rb)
    const yaw = yawToView(a.yaw)
    const t = Math.max(0, d.phaseTime - 0.7)
    const k = 1 - Math.exp(-t * 0.9)
    const dist = 4.6 - 1.7 * k
    if (this.heroFor !== d.ballId * 100 + h.actor) {
      this.heroFor = d.ballId * 100 + h.actor
      this.heroSide = this.clearHeroAngle(h.actor, p, yaw)
    }
    const ang = yaw + this.heroSide + (0.12 - 0.1 * k) * (this.heroSide >= 0 ? 1 : -1)
    pos.set(p.x + Math.sin(ang) * dist, 0.55 + 0.1 * k, p.z + Math.cos(ang) * dist)
    look.set(p.x, 1.42, p.z)
    return 30
  }

  /** The first angle (around the front of the subject) with a clear line to him: nobody within 0.8 m of it. */
  private clearHeroAngle(index: number, p: THREE.Vector3, yaw: number) {
    const d = this.director
    const tries = [0, 0.6, -0.6, 1.1, -1.1, 1.6, -1.6]
    let best = 0
    let bestClear = -1
    for (const off of tries) {
      const ang = yaw + off
      const cx = p.x + Math.sin(ang) * 4.2
      const cz = p.z + Math.cos(ang) * 4.2
      let clear = Infinity
      for (const o of d.actors) {
        if (o.index === index || !o.visible) continue
        const q = toView(o.pos, _rl)
        // Distance from the actor to the camera-subject segment (on the ground).
        const sx = p.x - cx
        const sz = p.z - cz
        const u = Math.max(0, Math.min(1, ((q.x - cx) * sx + (q.z - cz) * sz) / (sx * sx + sz * sz)))
        const dx = cx + sx * u - q.x
        const dz = cz + sz * u - q.z
        clear = Math.min(clear, Math.hypot(dx, dz))
      }
      if (clear > 0.9) return off
      if (clear > bestClear) {
        bestClear = clear
        best = off
      }
    }
    return best
  }

  private updateHeroLight(dt: number) {
    const L = this.heroLight
    const on = this.heroActive()
    this.heroK += ((on ? 1 : 0) - this.heroK) * Math.min(1, dt * 4 || 1)
    const base = this.opts.setup.time === 'night' ? 1.05 : this.opts.setup.time === 'dusk' ? 1.18 : 1.0
    this.renderer.toneMappingExposure = base * (1 - 0.18 * this.heroK)
    if (!L) return
    L.intensity = 60 * this.heroK
    if (this.hero && this.heroK > 0.01) {
      const a = this.director.actors[this.hero.actor]
      const p = toView(a.pos, _rb)
      const yaw = yawToView(a.yaw)
      L.position.set(p.x - Math.sin(yaw) * 2.5 + 1.2, 6.5, p.z - Math.cos(yaw) * 2.5)
      L.target.position.set(p.x, 1.2, p.z)
      L.target.updateMatrixWorld()
    }
  }

  private pushHud() {
    if (!this.onHud) return
    const h = this.hudState()
    // Only a change reaches React (most frames nothing on the HUD moves).
    const json = JSON.stringify(h)
    if (json === this.lastHudJson) return
    this.lastHudJson = json
    this.onHud(h)
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
      meter: d.localBowls && (d.phase === 'runup' || d.phase === 'predelivery') ? { value: Math.round(d.meterValue * 100) / 100, green: d.meterGreen, half: d.meterHalfWidth, running: d.meterRunning } : null,
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
                return { player: p, name: pl.name, style: styleName(pl), tag: styleTag(pl), type: pl.bowl, pace: pl.pace, skill: pl.bowling, figures: card ? `${card.wickets}-${card.runs}` : '—', overs: card ? oversText(card.balls) : '0' }
              }),
            }
          : null,
      inningsBreak:
        d.phase === 'break' && lastInn
          ? { summary: `${teams[lastInn.battingTeam].name} ${scoreText(lastInn)} (${oversText(lastInn.legalBalls)} ov)`, next: st.result ? st.result : `${teams[1 - lastInn.battingTeam].name} need ${lastInn.runs + 1} to win` }
          : null,
      matchEnd: d.phase === 'end' ? { result: st.result, winner: st.winner } : null,
      replay: this.replayHud(),
      banner: d.bannerTime > 0 ? d.banner : '',
      bannerSub: d.bannerTime > 0 ? d.bannerSub : '',
      bannerTime: Math.round(d.bannerTime * 20) / 20,
      camera: this.userCam,
      paused: this.paused,
      live: d.phase === 'live',
      running: d.anyRunning,
      quality: this.quality.tier,
      reviewsLeft: inn ? d.reviewsLeft(localSide) : 0,
      card: this.card && this.sinceRelease >= 0 && this.sinceRelease < 3.2 && (d.phase === 'flight' || d.phase === 'live') ? { ...this.card, age: Math.round(this.sinceRelease * 10) / 10 } : null,
      timings: this.timings,
      nets: d.nets,
      difficulty: st.setup.difficulty,
      markerWords: d.localBowls && (d.phase === 'predelivery' || d.phase === 'runup') ? lengthWords(d.frame.offsetFwd(d.marker), d.frame.offsetOff(d.marker)).text : '',
      aimDeg: d.localBats ? this.aimFromKeys() : null,
      shotKind: this.shotKind,
      hero: this.heroActive(),
      milestone: this.milestone && this.time - this.milestone.t < 4.2 ? { title: this.milestone.title, name: this.milestone.name, line: this.milestone.line, kind: this.milestone.kind, age: Math.round((this.time - this.milestone.t) * 10) / 10 } : null,
      runCall: this.runCall && this.time - this.runCall.t < 1.3 ? { text: this.runCall.text, who: this.runCall.who, age: Math.round((this.time - this.runCall.t) * 10) / 10 } : null,
      bowlerCard:
        bp && bc
          ? { name: bp.name, tag: styleTag(bp), pace: bp.pace, skill: bp.bowling, stamina: Math.round(bowlerActor?.stamina ?? 100), figures: `${bc.wickets}-${bc.runs} (${oversText(bc.balls)})`, type: DELIVERIES[d.selectedDelivery]?.name ?? '' }
          : null,
      pip: this.pip.on ? { x: this.pip.x, y: this.pip.y, w: this.pip.w, h: this.pip.h, label: this.pip.label } : null,
      restrictions: inn && !d.nets ? { powerplay: st.isPowerplay, maxOutside: d.maxOutside, outside: d.field.filter((f) => f.dist > Geo.InnerCircle + 2).length } : null,
      canReplay: this.canInstantReplay,
      replayPref: this.replayPref,
      canEditField: !this.opts.autopilot && d.localBowls && !d.nets && (d.phase === 'predelivery' || d.phase === 'choosebowler') && inn.bowler >= 0,
      fieldVersion: d.fieldVersion,
      rrr: inn && inn.target > 0 ? st.requiredRate.toFixed(2) : '',
      toContact: d.localBats && d.ballReleased && d.phase === 'flight' && d.crossTime('auto') > 0 ? Math.round((d.crossTime('auto') - d.ball.time - SHOT_LEAD) * 100) / 100 : -1,
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
