// Runs a cricket match: toss, innings, overs, every delivery from run-up to dead ball, the fielders, the batters'
// running, the umpires and the reviews. Pure simulation (no three.js): the solo game and an online host run it;
// online guests only display snapshots of it. A port of the original match director with the same rules.
import { cloneBall, crossesZ, hitsStumps, newBall, predict, step, DT, type BallState } from './ball.ts'
import { makeEnv, pitchSurface, type Env } from './conditions.ts'
import { DELIVERIES, deliveriesFor, isSpinStyle, releaseBall, releasePoint, stockKmh, type DeliveryPlan, type DeliveryType } from './delivery.ts'
import { enforce, presetSpots, spotToWorld, type FieldPreset, type FieldSpot } from './fields.ts'
import { BatFrame, beyondRope, Geo, inward, poppingZ, stumpsAt, stumpsZ } from './geo.ts'
import { bowlerCard, cardOf, DISMISSAL_NAMES, emptyOutcome, MatchState, scoreText, type BallOutcome, type Dismissal, type MatchSetup } from './match.ts'
import { emptyShot, naturalFeet, resolveShot, shotSpec, type Footwork, type ShotInput, type ShotResult, type ShotType, type Timing } from './shots.ts'
import { bat01, bowl01, field01, pace01, styleName, surname, validateTeam, type Player, type Team } from './teams.ts'
import { outIfCallsGo, reviewLbw, trackLbw, umpireGivesLbw, umpireHearsEdge, isWide, type LbwTrack, type ReviewOutcome } from './umpiring.ts'
import { clamp, clamp01, lerp, moveTowardsAngle, moveTowardsV, rotateY, Rng, V3, DEG } from './vec.ts'
import * as AI from './ai.ts'
import { C } from './commentary.ts'

export type Phase = 'toss' | 'intro' | 'choosebowler' | 'predelivery' | 'runup' | 'flight' | 'live' | 'dead' | 'review' | 'replay' | 'break' | 'end'
export type Pose =
  | 'hidden' | 'idle' | 'walk' | 'run' | 'stance' | 'shot' | 'slide' | 'batslide' | 'runup' | 'deliver' | 'follow' | 'keeper' | 'keepertake' | 'ready'
  | 'dive' | 'catch' | 'pickup' | 'throw' | 'celebrate' | 'appeal' | 'dejected' | 'umpire' | 'signal' | 'leave' | 'hit' | 'getup'
export type ActorKind = 'striker' | 'nonstriker' | 'bowler' | 'keeper' | 'fielder' | 'umpire'
export type Signal = 'none' | 'out' | 'four' | 'six' | 'wide' | 'noball' | 'bye' | 'legbye' | 'freehit' | 'tv'

export const STRIKER = 0
export const NONSTRIKER = 1
export const FIRST_FIELDER = 2
export const FIELDERS = 11
export const UMP_BOWLER = 13
export const UMP_SQUARE = 14
export const ACTORS = 15

export class Actor {
  index: number
  team = -1
  player = -1
  kind: ActorKind = 'fielder'
  pos = new V3()
  yaw = 0
  vel = new V3()
  pose: Pose = 'idle'
  poseTime = 0
  /** Shot type, bowling style, signal... */
  variant = ''
  feet: Footwork = 'auto'
  loft = false
  aim = 0
  look = new V3()
  hasBall = false
  visible = false
  left = false
  home = new V3()
  maxSpeed = 7.2
  accel = 9
  skill = 0.6
  stamina = 100
  spotName = ''
  constructor(index: number) {
    this.index = index
  }
  setPose(p: Pose, variant = '') {
    if (this.pose === p && this.variant === variant) return
    this.pose = p
    this.variant = variant
    this.poseTime = 0
  }
  get speed() {
    return this.vel.flatLen
  }
  get forward() {
    return new V3(Math.sin(this.yaw * DEG), 0, Math.cos(this.yaw * DEG))
  }
  face(target: V3, dt = -1, rate = 540) {
    const dx = target.x - this.pos.x
    const dz = target.z - this.pos.z
    if (dx * dx + dz * dz < 1e-4) return
    const want = Math.atan2(dx, dz) / DEG
    this.yaw = dt < 0 ? want : moveTowardsAngle(this.yaw, want, rate * dt)
  }
  /** Moves towards a point with acceleration and top speed; true when there. */
  moveTo(target: V3, dt: number, speedScale = 1, arrive = 0.25) {
    const d = new V3(target.x - this.pos.x, 0, target.z - this.pos.z)
    const dist = d.len
    const vmax = this.maxSpeed * speedScale
    if (dist < arrive) {
      this.vel = moveTowardsV(this.vel, new V3(), this.accel * 2 * dt)
      this.pos.addScaledIn(this.vel, dt)
      return this.vel.len < 0.3
    }
    const want = Math.min(vmax, Math.sqrt(2 * this.accel * Math.max(0, dist - arrive * 0.5)))
    this.vel = moveTowardsV(this.vel, d.mul(want / dist), this.accel * dt)
    this.pos.addScaledIn(this.vel, dt)
    if (this.vel.lenSq > 0.5) this.face(this.pos.add(this.vel), dt, 720)
    return false
  }
  /** Time to reach a point (reaction excluded). */
  timeTo(p: V3) {
    const d = new V3(p.x - this.pos.x, 0, p.z - this.pos.z)
    const dist = d.len
    const v0 = Math.max(0, dist > 0.01 ? this.vel.dot(d.mul(1 / dist)) : 0)
    const tAcc = (this.maxSpeed - v0) / this.accel
    const dAcc = v0 * tAcc + 0.5 * this.accel * tAcc * tAcc
    if (dist <= dAcc) return (-v0 + Math.sqrt(v0 * v0 + 2 * this.accel * dist)) / this.accel
    return tAcc + (dist - dAcc) / this.maxSpeed
  }
}

export type Command =
  | { t: 'toss'; side: number; call: 0 | 1 }
  | { t: 'tosschoice'; side: number; bat: boolean }
  | { t: 'bowler'; side: number; player: number }
  | { t: 'delivery'; side: number; type: DeliveryType }
  | { t: 'target'; side: number; off: number; len: number }
  | { t: 'wicketside'; side: number }
  | { t: 'preset'; side: number; preset: FieldPreset }
  | { t: 'runup'; side: number }
  | { t: 'release'; side: number; meter: number }
  | { t: 'shot'; side: number; shot: ShotType; loft: boolean; feet: Footwork; aim: number; timing?: number }
  | { t: 'charge'; side: number }
  | { t: 'run'; side: number }
  | { t: 'back'; side: number }
  | { t: 'review'; side: number }
  | { t: 'continue'; side: number }
  | { t: 'throw'; side: number; end: 'keeper' | 'bowler' }
  | { t: 'skip'; side: number }

export type EvType =
  | 'release' | 'bounce' | 'bathit' | 'edge' | 'beaten' | 'pad' | 'stumps' | 'four' | 'six' | 'wicket' | 'wide' | 'noball' | 'runs' | 'dot' | 'overend'
  | 'inningsend' | 'matchend' | 'appeal' | 'notout' | 'reviewstart' | 'reviewresult' | 'catch' | 'drop' | 'directhit' | 'fielded' | 'throw' | 'signal'
  | 'say' | 'toss' | 'milestone' | 'phase' | 'bowlerchange' | 'banner' | 'prompt' | 'runcomplete' | 'dive' | 'keeper' | 'leave'
export interface GameEvent {
  type: EvType
  i?: number
  j?: number
  f?: number
  p?: [number, number, number]
  text?: string
}

export interface Runner {
  a: Actor
  atEnd: number
  toEnd: number
  running: boolean
  sliding: boolean
  lane: number
}

type Job = 'none' | 'chase' | 'catch' | 'back' | 'cover' | 'hold'
interface Plan {
  job: Job
  target: V3
  at: number
  reaction: number
  dive: boolean
}

export interface ReviewInfo {
  active: boolean
  kind: 'lbw' | 'caught' | 'runout'
  reviewingTeam: number
  originalOut: boolean
  track: LbwTrack | null
  edge: boolean
  outcome: ReviewOutcome
  finalOut: boolean
  time: number
  path: [number, number, number][]
  impactIndex: number
  /** Run out: the end and how far the bat was from the crease (m, + short of it). */
  end: number
  short: number
}

const emptyReview = (): ReviewInfo => ({ active: false, kind: 'lbw', reviewingTeam: 0, originalOut: false, track: null, edge: false, outcome: 'stands', finalOut: false, time: 0, path: [], impactIndex: 0, end: 0, short: 0 })

export interface DirectorOptions {
  sideHuman: [boolean, boolean]
  online?: boolean
  /** Which side this machine's player controls (0 host/solo, 1 guest). */
  localSide?: number
  /** Automatic run calls for a human batter (assist). */
  assistRunning?: boolean
}

const PATH_STEP = 0.04

export class Director {
  state: MatchState
  phase: Phase = 'toss'
  phaseTime = 0
  actors: Actor[] = Array.from({ length: ACTORS }, (_, i) => new Actor(i))
  ball: BallState = newBall()
  ballVisible = false
  env: Env
  rng: Rng
  sideHuman: [boolean, boolean]
  online: boolean
  localSide: number
  assistRunning: boolean
  events: GameEvent[] = []

  // Per-delivery state for the HUD and input
  selectedDelivery: DeliveryType = 'seam'
  marker = new V3()
  around = false
  meterValue = 0
  meterRunning = false
  meterGreen = 0.77
  meterHalfWidth = 0.15
  guard = 0
  charging = false
  preset: FieldPreset = 'normal'
  field: FieldSpot[] = []
  review: ReviewInfo = emptyReview()
  banner = ''
  /** A second, smaller line under the banner (how the batter was out, the shot). */
  bannerSub = ''
  bannerTime = 0
  signal: 'none' | Signal = 'none'
  tossCall = -1
  tossResult = -1
  lastShotNote = ''
  lastTiming: Timing = 'noshot'
  lastTimingError = 0
  lastKmh = 0
  /** Batter confidence ("in" meter) per team and player, 0..1. */
  confidence: number[][] = [[], []]
  /** Ball serial (increments on each release), for clients and replays. */
  ballId = 0
  /** Set while a replay-worthy moment is being committed; the game may start a replay. */
  replayWanted = false
  replayHook: ((kind: 'wicket' | 'six' | 'runout') => boolean) | null = null
  replayDone = false
  version = 0
  /** Test hooks: the next CPU delivery and CPU shot (consumed when used). */
  forceDelivery: { type: DeliveryType; off: number; len: number; error?: number } | null = null
  forceShot: { type: ShotType; aim: number; loft?: boolean; feet?: Footwork; timing?: number } | null = null

  // Delivery internals
  plan: DeliveryPlan = { type: 'seam', style: 'fast', leftArm: false, around: false, target: new V3(), speedKmh: 0, releaseError: NaN, noBall: false }
  frame: BatFrame = BatFrame.for(1, true)
  bowlerActor: Actor | null = null
  keeperActor: Actor | null = null
  private runUpStart = new V3()
  private runUpEnd = new V3()
  runUpDuration = 1
  private released = false
  private crossTimes = [-1, -1, -1, -1]
  private crossPos = [new V3(), new V3(), new V3(), new V3()]
  private crossLate = 0
  private pendingShot: ShotInput | null = null
  private shotResolved = false
  lastShot: ShotResult = emptyShot()
  private batterId = 0
  private strikerRight = true
  private outcome: BallOutcome = emptyOutcome()
  private hitBat = false
  private touchedBody = false
  /** The ball hit the pad (not the body): an LBW was considered. */
  padImpact = false
  private wideCalled = false
  private noBallCalled = false
  private deadQueued = false
  private wicketDecided = false
  private pitchedBeforeBatter = false
  bouncedSinceHit = false
  private deadTimer = 0
  private pitchedAt = new V3()
  private footTarget = 0
  private flightAccum = 0
  private aiShot: ShotInput | null = null
  private aiShotAt = 0
  private aiReadyAt = 0
  private hasLastMarker = false
  private lastMarkerOff = 0
  private lastMarkerLen = 0
  private committed = false
  private pendingNext: { battingTeam: number; superOver: boolean } | null = null

  // Live ball
  runners: Runner[]
  private plans: Plan[] = Array.from({ length: ACTORS }, () => ({ job: 'none' as Job, target: new V3(), at: 0, reaction: 0, dive: false }))
  path: V3[] = []
  private pathBounces: number[] = []
  liveTime = 0
  private planTime = 0
  runsCompleted = 0
  private runCrossed = false
  private humanCallAt = -10
  throwInFlight = false
  private throwTarget: Actor | null = null
  private throwEnd = -1
  private throwDirect = false
  private lastThrower: Actor | null = null
  private collectedAt = 0
  caught = false
  heldBy: Actor | null = null
  private holdSince = 0
  private manualThrowEnd = -1

  // Decisions
  private appeal: 'none' | 'lbw' | 'caughtbehind' = 'none'
  private appealGivenOut = false
  private appealEdgeTruth = false
  private lbw: LbwTrack | null = null
  reviewWindowOpen = false
  private reviewDone = false
  reviewSide = 0
  reviewDeadline = 0
  deliveryTrail: V3[] = []
  private projectedPath: V3[] = []
  /** A close run out goes to the third umpire. */
  private tvRunOut: { end: number; out: boolean; short: number } | null = null

  constructor(setup: MatchSetup, opts: DirectorOptions) {
    validateTeam(setup.teams[0])
    validateTeam(setup.teams[1])
    this.sideHuman = opts.sideHuman
    this.online = !!opts.online
    this.localSide = opts.localSide ?? 0
    this.assistRunning = opts.assistRunning ?? false
    this.state = new MatchState(setup)
    this.rng = new Rng(setup.seed)
    const ws = this.rng.range(0, 6)
    const wa = this.rng.range(0, Math.PI * 2)
    this.env = makeEnv(setup.pitch, setup.time, new V3(Math.sin(wa) * ws, 0, Math.cos(wa) * ws))
    this.actors[UMP_BOWLER].kind = this.actors[UMP_SQUARE].kind = 'umpire'
    this.runners = [
      { a: this.actors[STRIKER], atEnd: 1, toEnd: 1, running: false, sliding: false, lane: 1.1 },
      { a: this.actors[NONSTRIKER], atEnd: 0, toEnd: 0, running: false, sliding: false, lane: -1.1 },
    ]
    if (setup.nets) {
      // Straight into the nets: no toss, team 0 bats.
      this.state.tossWinner = 0
      this.beginInnings(0, false)
    } else {
      this.setPhase('toss')
      this.raise({ type: 'toss' })
    }
  }

  /* ---------------- accessors ---------------- */

  get inn() {
    return this.state.current
  }
  /** Practice nets: no fielders, no wickets counted, the ball is dead soon after the shot. */
  get nets() {
    return !!this.state.setup.nets
  }
  get battingTeam(): Team {
    return this.state.setup.teams[this.inn.battingTeam]
  }
  get fieldingTeam(): Team {
    return this.state.setup.teams[1 - this.inn.battingTeam]
  }
  /** Team 0 is side 0 (host / you), team 1 side 1. */
  get battingSide() {
    return this.inn ? this.inn.battingTeam : 0
  }
  get fieldingSide() {
    return this.inn ? 1 - this.inn.battingTeam : 1
  }
  get humanBats() {
    return !!this.inn && this.sideHuman[this.battingSide]
  }
  get humanBowls() {
    return !!this.inn && this.sideHuman[this.fieldingSide]
  }
  get localBats() {
    return !!this.inn && this.battingSide === this.localSide && this.sideHuman[this.localSide]
  }
  get localBowls() {
    return !!this.inn && this.fieldingSide === this.localSide && this.sideHuman[this.localSide]
  }
  get striker() {
    return this.actors[STRIKER]
  }
  get nonStriker() {
    return this.actors[NONSTRIKER]
  }
  get difficultyWindow() {
    const d = this.state.setup.difficulty
    return d === 0 ? 1.6 : d === 2 ? 0.8 : 1.15
  }
  get anyRunning() {
    return this.runners[0].running || this.runners[1].running
  }
  get ballReleased() {
    return this.released
  }
  get shotPending() {
    return !!this.pendingShot
  }
  fielders() {
    return this.actors.slice(FIRST_FIELDER, FIRST_FIELDER + FIELDERS)
  }
  fielderFor(player: number) {
    return this.fielders().find((a) => a.player === player) ?? null
  }
  confidenceOf(team: number, player: number) {
    return this.confidence[team][player] ?? 0.35
  }
  get strikerConfidence() {
    return this.inn ? this.confidenceOf(this.inn.battingTeam, this.inn.striker) : 0
  }

  raise(e: GameEvent) {
    this.events.push(e)
  }
  private say(text: string) {
    if (text) this.raise({ type: 'say', text })
  }
  private showBanner(text: string, seconds = 2.2, sub = '') {
    this.banner = text
    this.bannerSub = sub
    this.bannerTime = seconds
    this.raise({ type: 'banner', text, f: seconds })
  }
  setPhase(p: Phase) {
    this.phase = p
    this.phaseTime = 0
    this.version++
    this.raise({ type: 'phase', text: p })
  }
  drainEvents() {
    const e = this.events
    this.events = []
    return e
  }

  /* ---------------- main loop ---------------- */

  update(dtIn: number) {
    const dt = Math.min(dtIn, 0.05)
    if (this.bannerTime > 0) this.bannerTime -= dt
    this.phaseTime += dt
    for (const a of this.actors) a.poseTime += dt
    switch (this.phase) {
      case 'toss':
        this.updateToss()
        break
      case 'intro':
        if (this.phaseTime > 2.2) this.beginOver()
        break
      case 'choosebowler':
        if (!this.humanBowls || this.phaseTime > 30) this.pickBowler(AI.chooseBowler(this, this.rng))
        break
      case 'predelivery':
        this.updatePreDelivery()
        break
      case 'runup':
        this.updateRunUp(dt)
        break
      case 'flight':
        this.updateFlight(dt)
        break
      case 'live':
        this.updateLive(dt)
        break
      case 'dead':
        this.updateDead()
        break
      case 'review':
        this.updateReview()
        break
      case 'replay':
        if (this.replayDone || this.phaseTime > 12) this.afterBall()
        break
      case 'break':
        if (this.phaseTime > (this.humanBats || this.humanBowls ? 40 : 4)) this.continueFromBreak()
        break
      case 'end':
        break
    }
    this.updateIdleActors()
  }

  /* ---------------- toss ---------------- */

  private updateToss() {
    const caller = this.online ? 1 : 0
    if (this.tossCall < 0) {
      if (!this.sideHuman[caller] && this.phaseTime > 0.8) this.tossCall = this.rng.int(0, 2)
      return
    }
    if (this.tossResult < 0) {
      this.tossResult = this.rng.int(0, 2)
      this.state.tossWinner = this.tossResult === this.tossCall ? caller : 1 - caller
      this.raise({ type: 'toss', i: this.state.tossWinner, j: this.tossResult, text: `${this.state.setup.teams[this.state.tossWinner].name} won the toss` })
      this.phaseTime = 0
      this.version++
    }
    if (this.phaseTime < 1.6) return
    if (!this.sideHuman[this.state.tossWinner]) {
      const s = this.state.setup
      const bowl = s.pitch === 'green' || s.time === 'night' || (s.pitch === 'flat' && this.rng.chance(0.5))
      this.chooseToss(!bowl)
    }
  }

  private chooseToss(bat: boolean) {
    const st = this.state
    st.tossWinnerBats = bat
    const first = bat ? st.tossWinner : 1 - st.tossWinner
    this.say(`${st.setup.teams[st.tossWinner].name} win the toss and choose to ${bat ? 'bat' : 'bowl'} first.`)
    this.beginInnings(first, st.setup.format === 'super')
  }

  private beginInnings(battingTeam: number, superOver: boolean) {
    this.state.startInnings(battingTeam, superOver)
    this.setupActorsForInnings()
    this.preset = 'normal'
    this.setPhase('intro')
    const inn = this.inn
    const intro = this.nets ? 'PRACTICE NETS' : superOver ? `SUPER OVER — ${this.battingTeam.name} bat` : inn.target > 0 ? `${this.battingTeam.name} need ${inn.target} to win` : `${this.battingTeam.name} to bat`
    this.showBanner(intro, 2.4)
    this.say(intro + '.')
  }

  private endMatch() {
    this.setPhase('end')
    this.showBanner(this.state.result, 6)
    this.say(this.state.result + '.')
    this.raise({ type: 'matchend', i: this.state.winner, text: this.state.result })
    for (const a of this.actors) {
      if (a.team < 0 || !a.visible) continue
      a.setPose(this.state.winner === a.team ? 'celebrate' : 'dejected')
    }
  }

  /* ---------------- actors ---------------- */

  private setupActorsForInnings() {
    const inn = this.inn
    const fielding = this.fieldingTeam
    for (let i = 0; i < FIELDERS; i++) {
      const a = this.actors[FIRST_FIELDER + i]
      const p = fielding.players[i]
      a.team = 1 - inn.battingTeam
      a.player = i
      a.kind = i === fielding.keeper ? 'keeper' : 'fielder'
      a.visible = true
      a.hasBall = false
      a.skill = field01(p)
      a.maxSpeed = lerp(6.4, 8.2, field01(p))
      a.accel = lerp(7, 10, field01(p))
      a.stamina = 100
      a.left = p.leftArm
      if (a.kind === 'keeper') this.keeperActor = a
    }
    for (const s of [STRIKER, NONSTRIKER]) {
      const a = this.actors[s]
      a.team = inn.battingTeam
      a.visible = true
      a.kind = s === STRIKER ? 'striker' : 'nonstriker'
      a.maxSpeed = 7
      a.accel = 8
    }
    for (const s of [UMP_BOWLER, UMP_SQUARE]) {
      const a = this.actors[s]
      a.visible = true
      a.team = -1
      a.setPose('umpire')
    }
    this.syncBatters()
  }

  private syncBatters() {
    const inn = this.inn
    this.striker.player = inn.striker
    this.nonStriker.player = inn.nonStriker
    this.striker.left = this.battingTeam.players[inn.striker].leftBat
    this.nonStriker.left = this.battingTeam.players[inn.nonStriker].leftBat
  }

  /* ---------------- overs and bowler ---------------- */

  private beginOver() {
    const inn = this.inn
    if (inn.complete) {
      this.endInnings()
      return
    }
    this.syncBatters()
    if (inn.bowler < 0) this.setPhase('choosebowler')
    else this.startDelivery()
  }

  /** Bowlers allowed this over: not the previous over's bowler, under the quota. */
  eligibleBowlers() {
    const list: number[] = []
    const inn = this.inn
    const team = this.fieldingTeam
    const rules = this.state.activeRules
    const nets = this.state.setup.nets
    team.players.forEach((p, i) => {
      if (i === team.keeper || (i === inn.lastOverBowler && !nets)) return
      const card = inn.bowling.find((b) => b.player === i)
      const overs = card ? Math.floor((card.balls + 5) / 6) : 0
      if (overs >= rules.maxOversPerBowler) return
      if (!(p.role === 'bowler' || p.role === 'allrounder' || p.bowling >= 45) && list.length >= 5) return
      if (nets && nets.bowling !== 'mixed' && isSpinStyle(p.bowl) !== (nets.bowling === 'spin')) return
      list.push(i)
    })
    if (list.length === 0) team.players.forEach((_, i) => i !== team.keeper && i !== inn.lastOverBowler && list.push(i))
    return list
  }

  private pickBowler(player: number) {
    const eligible = this.eligibleBowlers()
    if (!eligible.includes(player)) player = eligible[0]
    this.inn.bowler = player
    const p = this.fieldingTeam.players[player]
    bowlerCard(this.inn, player)
    this.selectedDelivery = deliveriesFor(p.bowl)[0]
    this.around = false
    if (!this.humanBowls) this.preset = AI.choosePreset(this, p)
    else if (this.preset === 'spin' && !isSpinStyle(p.bowl)) this.preset = 'normal'
    this.hasLastMarker = false
    this.raise({ type: 'bowlerchange', i: player, text: `${p.name} (${styleName(p)}) to bowl` })
    this.say(`${p.name} comes on to bowl, ${styleName(p).toLowerCase()}.`)
    this.startDelivery()
  }

  /* ---------------- delivery setup ---------------- */

  private startDelivery() {
    const inn = this.inn
    this.syncBatters()
    this.batterId = inn.striker
    const batter = this.battingTeam.players[this.batterId]
    this.strikerRight = !batter.leftBat
    this.frame = BatFrame.for(inn.strikerEnd, this.strikerRight)

    this.outcome = emptyOutcome()
    this.hitBat = this.touchedBody = this.padImpact = this.wideCalled = this.noBallCalled = this.deadQueued = this.wicketDecided = this.pitchedBeforeBatter = false
    this.bouncedSinceHit = false
    this.pendingShot = null
    this.shotResolved = false
    this.aiShot = null
    this.released = false
    this.charging = false
    this.guard = 0
    this.lastShot = emptyShot()
    this.lastShotNote = ''
    this.lastTiming = 'noshot'
    this.signal = 'none'
    this.review = emptyReview()
    this.ballVisible = false
    this.heldBy = null
    this.replayWanted = false
    this.replayDone = false
    this.tvRunOut = null
    this.appeal = 'none'
    this.reviewWindowOpen = this.reviewDone = false
    this.deliveryTrail = []
    this.projectedPath = []
    this.resetLive()
    for (const a of this.actors) a.hasBall = false

    this.applyField()
    this.layoutForDelivery()
    const spec = DELIVERIES[this.selectedDelivery]
    this.marker = this.humanBowls && this.hasLastMarker ? this.frame.local(this.lastMarkerOff, this.lastMarkerLen) : this.frame.local(0.12, spec.defaultLength)

    let overs = 0
    for (const i of this.state.innings) overs += i.legalBalls / 6
    this.env.pitch = pitchSurface(this.state.setup.pitch, clamp01(overs / (this.state.rules.overs * 2 + 1)))
    this.setPhase('predelivery')
    if (inn.freeHit) {
      this.showBanner('FREE HIT', 1.6)
      this.signal = 'freehit'
    }
  }

  applyField() {
    const bowler = this.fieldingTeam.players[this.inn.bowler]
    const spin = isSpinStyle(bowler.bowl)
    const rules = this.state.activeRules
    let maxOut = this.state.isPowerplay ? rules.maxOutsidePowerplay : rules.maxOutside
    if (this.state.inSuperOver) maxOut = 5
    this.field = enforce(presetSpots(this.preset, spin), maxOut)
  }

  /** Places everyone for the next ball. */
  private layoutForDelivery() {
    const inn = this.inn
    const f = this.frame
    const bp = this.fieldingTeam.players[inn.bowler]
    const spin = isSpinStyle(bp.bowl)
    const bowlEnd = 1 - inn.strikerEnd
    const travel = new V3(0, 0, inward(bowlEnd))
    const bowlerRight = new V3(travel.z, 0, -travel.x)

    const s = this.striker
    s.pos = f.local(-0.42 + this.guard, Geo.CreaseDepth - 0.1)
    s.face(s.pos.add(f.off))
    s.vel = new V3()
    s.setPose('stance')

    const armSide = (bp.leftArm ? 1 : -1) * (this.around ? -1 : 1)
    const ns = this.nonStriker
    ns.pos = stumpsAt(bowlEnd).add(travel.mul(Geo.CreaseDepth - 0.3)).sub(bowlerRight.mul(armSide * 1.6))
    ns.face(stumpsAt(inn.strikerEnd))
    ns.vel = new V3()
    ns.setPose('idle')

    const back = spin ? 0.9 : bp.bowl === 'fast' ? 17 : 12
    const k = this.fielderFor(this.fieldingTeam.keeper)!
    this.keeperActor = k
    k.kind = 'keeper'
    k.pos = f.origin.sub(f.fwd.mul(back)).add(f.off.mul(0.3))
    k.home = k.pos.clone()
    k.face(stumpsAt(bowlEnd))
    k.setPose('keeper')
    k.vel = new V3()

    const b = this.fielderFor(inn.bowler)!
    this.bowlerActor = b
    b.kind = 'bowler'
    const runLen = spin ? 6.5 : bp.bowl === 'fast' ? 17 : 12
    const rel = releasePoint(bowlEnd, bp.leftArm, this.around, spin)
    this.runUpEnd = new V3(rel.x, 0, stumpsZ(bowlEnd) + inward(bowlEnd) * 0.6).sub(bowlerRight.mul(armSide * 0.25))
    this.runUpStart = this.runUpEnd.sub(travel.mul(runLen)).add(bowlerRight.mul(armSide * (spin ? 0.6 : 1.2)))
    b.pos = this.runUpStart.clone()
    b.home = this.runUpStart.clone()
    b.face(this.runUpEnd)
    b.vel = new V3()
    b.setPose('idle')
    b.left = bp.leftArm

    const ump = this.actors[UMP_BOWLER]
    ump.pos = stumpsAt(bowlEnd).sub(travel.mul(1.6)).add(bowlerRight.mul(armSide * 0.5))
    ump.face(stumpsAt(inn.strikerEnd))
    ump.home = ump.pos.clone()
    ump.setPose('umpire')
    const leg = this.actors[UMP_SQUARE]
    leg.pos = f.polar(-90, 21).add(f.fwd.mul(Geo.CreaseDepth))
    leg.face(f.origin.add(f.fwd.mul(Geo.CreaseDepth)))
    leg.home = leg.pos.clone()
    leg.setPose('umpire')

    let n = 0
    for (const a of this.fielders()) {
      // In the nets only the bowler and the keeper are out there.
      a.visible = !this.nets || a === b || a === k
      a.hasBall = false
      if (a === b || a === k) continue
      a.kind = 'fielder'
      const spot = this.field[Math.min(n, this.field.length - 1)]
      a.spotName = spot.name
      a.home = spotToWorld(spot, f)
      a.pos = a.home.clone()
      a.vel = new V3()
      a.face(f.origin)
      a.setPose('idle')
      n++
    }
    b.spotName = 'Bowler'
    k.spotName = 'Wicketkeeper'
  }

  /* ---------------- pre-delivery and run-up ---------------- */

  private updatePreDelivery() {
    if (this.phaseTime < 0.03 && this.aiReadyAt !== this.ballId + 1) {
      this.aiReadyAt = this.ballId + 1
      if (!this.humanBowls) {
        const c = AI.chooseDelivery(this, this.rng)
        const fd = this.forceDelivery
        if (fd) {
          c.type = fd.type
          c.target = this.frame.local(fd.off, fd.len)
          c.around = false
        }
        this.selectedDelivery = c.type
        this.marker = c.target
        if (c.around !== this.around) {
          this.around = c.around
          this.layoutForDelivery()
        }
      }
    }
    if (!this.humanBowls) {
      const wait = this.humanBats ? 1.3 : 0.7
      if (this.phaseTime > wait) this.beginRunUp()
    } else if (!this.sideHuman[this.battingSide] && this.phaseTime > 90) this.beginRunUp()
  }

  private beginRunUp() {
    const bowler = this.fieldingTeam.players[this.inn.bowler]
    const spin = isSpinStyle(bowler.bowl)
    const dist = this.runUpStart.dist(this.runUpEnd)
    const avg = spin ? 3.2 : bowler.bowl === 'fast' ? 6.2 : 5.2
    this.runUpDuration = dist / avg + (spin ? 0.25 : 0.35)
    this.meterValue = 0
    this.meterRunning = this.humanBowls
    const fatigue = 1 - this.bowlerActor!.stamina / 100
    const d = this.state.setup.difficulty
    const diff = d === 0 ? 1.35 : d === 2 ? 0.75 : 1
    this.meterHalfWidth = 0.15 * diff * lerp(1, 0.65, fatigue) * lerp(0.85, 1.1, bowl01(bowler))
    this.plan = { type: this.selectedDelivery, style: bowler.bowl, leftArm: bowler.leftArm, around: this.around, target: new V3(this.marker.x, 0, this.marker.z), speedKmh: 0, releaseError: NaN, noBall: false }
    this.bowlerActor!.setPose('runup', bowler.bowl)
    this.setPhase('runup')
    if (!this.humanBats) this.charging = AI.wantsToCharge(this, this.rng)
  }

  readonly meterDuration = 1.1

  private updateRunUp(dt: number) {
    const bowler = this.fieldingTeam.players[this.inn.bowler]
    const spin = isSpinStyle(bowler.bowl)
    const b = this.bowlerActor!
    const t = clamp01(this.phaseTime / this.runUpDuration)
    const s = t * 0.65 + t * t * 0.35
    const prev = b.pos.clone()
    b.pos = this.runUpStart.lerp(this.runUpEnd, s)
    b.vel = b.pos.sub(prev).mul(1 / Math.max(dt, 1e-4))
    b.face(this.runUpEnd.add(this.runUpEnd.sub(this.runUpStart)))
    const stride = spin ? 0.5 : 0.6
    if (this.phaseTime > this.runUpDuration - stride && b.pose === 'runup') b.setPose('deliver', bowler.bowl)

    const f = this.frame
    for (const a of this.fielders()) {
      if (a === b || a === this.keeperActor || !a.visible) continue
      const dir = f.origin.sub(a.home).flat().norm()
      const walk = a.home.flatDist(f.origin) > 15 ? 2.5 : 0.8
      a.pos = a.home.add(dir.mul(walk * clamp01(this.phaseTime / this.runUpDuration)))
      a.setPose('ready')
    }
    const meterStart = this.runUpDuration - this.meterDuration
    if (this.meterRunning && this.phaseTime >= meterStart) this.meterValue = clamp01((this.phaseTime - meterStart) / this.meterDuration)
    if (this.charging && this.phaseTime > this.runUpDuration - 0.45) {
      this.striker.moveTo(f.local(-0.3 + this.guard, Geo.CreaseDepth + 1.9), dt, 0.8, 0.1)
      this.striker.face(this.striker.pos.add(f.off))
      this.striker.setPose('stance', 'charge')
    }
    if (this.phaseTime >= this.runUpDuration) this.release()
  }

  private pressRelease(meter: number) {
    if (this.phase !== 'runup' || !this.meterRunning || !Number.isNaN(this.plan.releaseError)) return
    let m = meter
    if (this.phaseTime < this.runUpDuration - this.meterDuration) m = 0
    this.plan.releaseError = (m - this.meterGreen) / this.meterHalfWidth
    this.meterRunning = false
  }

  private release() {
    const inn = this.inn
    const bowler = this.fieldingTeam.players[inn.bowler]
    const spec = DELIVERIES[this.plan.type]
    if (Number.isNaN(this.plan.releaseError)) this.plan.releaseError = this.humanBowls ? 1.3 : AI.releaseError(this, bowler, this.rng)
    if (this.forceDelivery) {
      this.plan.releaseError = this.forceDelivery.error ?? 0
      this.forceDelivery = null
    }
    this.meterRunning = false
    this.hasLastMarker = true
    this.lastMarkerOff = this.frame.offsetOff(this.plan.target)
    this.lastMarkerLen = this.frame.offsetFwd(this.plan.target)
    this.plan.noBall = this.plan.releaseError > 1.15
    if (!this.humanBowls && this.rng.chance(0.012)) this.plan.noBall = true

    const b = this.bowlerActor!
    const fatigue = 1 - b.stamina / 100
    let kmh = stockKmh(bowler.bowl, pace01(bowler)) * spec.speedFactor * lerp(1, 0.94, fatigue)
    kmh *= 1 + this.rng.gauss() * 0.012
    this.plan.speedKmh = kmh
    this.lastKmh = kmh
    b.stamina = Math.max(0, b.stamina - (spec.spin ? 0.7 : bowler.bowl === 'fast' ? 1.8 : 1.2))
    const ballAge = inn.legalBalls / 6
    const skill = bowl01(bowler) * lerp(1, 0.85, fatigue)
    const r = releaseBall(this.plan, 1 - inn.strikerEnd, this.frame.off, ballAge, skill, this.env, this.rng)
    this.ball = r.ball
    this.ballVisible = true
    this.released = true
    this.ballId++
    this.flightAccum = 0
    b.setPose('follow', bowler.bowl)
    this.predictForBatter()
    this.setPhase('flight')
    this.raise({ type: 'release', i: this.ballId, f: kmh, text: this.plan.type })
    this.say(C.release(surname(bowler), kmh, spec.spin, this.rng))
    if (this.plan.noBall) {
      this.noBallCalled = true
      this.raise({ type: 'noball', text: 'No ball! Overstepped.' })
    }
    if (!this.humanBats) AI.decideShot(this, this.rng)
  }

  /* ---------------- prediction for timing ---------------- */

  contactPlaneFwd(feet: Footwork) {
    const fwd = feet === 'front' ? 0.62 : feet === 'charge' ? 1.9 + 0.6 : 0.05
    return Geo.CreaseDepth + fwd
  }

  /** Online guest: predict the delivery it was sent (for timing its own shots). */
  mirrorPredict() {
    this.released = true
    this.predictForBatter()
  }

  private predictForBatter() {
    const s = cloneBall(this.ball)
    const f = this.frame
    let prev = s.pos.clone()
    this.crossTimes = [-1, -1, -1, -1]
    const planes = [0, this.contactPlaneFwd('front'), this.contactPlaneFwd('back'), this.contactPlaneFwd('charge')]
    let bounced = false
    let preBounceVel = new V3()
    for (let i = 0; i < 1500; i++) {
      const vb = s.vel.clone()
      step(s, this.env, DT)
      if (!bounced && s.bounces > 0) {
        bounced = true
        this.pitchedAt = s.firstBounce.clone()
        preBounceVel = vb
      }
      const dPrev = f.offsetFwd(prev)
      const dNow = f.offsetFwd(s.pos)
      for (let k = 1; k <= 3; k++) {
        const plane = planes[k]
        if (this.crossTimes[k] < 0 && dPrev >= plane && dNow < plane) {
          const t = (dPrev - plane) / Math.max(1e-5, dPrev - dNow)
          this.crossTimes[k] = s.time - DT * (1 - t)
          this.crossPos[k] = prev.lerp(s.pos, t)
        }
      }
      prev = s.pos.clone()
      if (dNow < -0.5) break
    }
    this.pitchedBeforeBatter = bounced && f.offsetFwd(this.pitchedAt) > Geo.CreaseDepth - 0.4
    const np = this.naturalPlane()
    this.crossTimes[0] = this.crossTimes[np]
    this.crossPos[0] = this.crossPos[np]
    this.crossLate = 0
    if (this.pitchedBeforeBatter && this.crossTimes[0] > 0) {
      const flat = preBounceVel.flat()
      const along = flat.norm().dot(f.fwd)
      if (Math.abs(along) > 0.1) {
        const toPlane = f.offsetFwd(this.crossPos[0]) - f.offsetFwd(this.pitchedAt)
        const straight = this.pitchedAt.add(flat.norm().mul(toPlane / along))
        this.crossLate = Math.abs(f.offsetOff(this.crossPos[0]) - f.offsetOff(straight))
      }
    }
  }

  private naturalPlane() {
    return naturalFeet(this.pitchedLength(), DELIVERIES[this.plan.type].spin) === 'front' ? 1 : 2
  }

  pitchedLength() {
    return this.pitchedBeforeBatter ? this.frame.offsetFwd(this.pitchedAt) : -1
  }
  get pitched() {
    return this.pitchedBeforeBatter ? this.pitchedAt : null
  }

  crossTime(feet: Footwork) {
    let k = feet === 'front' ? 1 : feet === 'back' ? 2 : feet === 'charge' ? 3 : 0
    if (this.charging) k = 3
    return this.crossTimes[k]
  }
  crossPoint(feet: Footwork) {
    let k = feet === 'front' ? 1 : feet === 'back' ? 2 : feet === 'charge' ? 3 : 0
    if (this.charging) k = 3
    return this.crossPos[k]
  }

  /* ---------------- batting input ---------------- */

  private setShot(input: ShotInput) {
    if (this.pendingShot || this.shotResolved || (this.phase !== 'flight' && this.phase !== 'runup')) return
    if (input.feet === 'auto' && this.charging) input.feet = 'charge'
    this.pendingShot = input
    const st = this.striker
    st.aim = input.aim
    st.loft = input.loft
    const feet = input.feet === 'auto' ? naturalFeet(this.pitchedLength(), DELIVERIES[this.plan.type].spin) : input.feet
    st.feet = feet
    // The stroke the batter will play, for the animation (the sim picks the same one at contact).
    let shown: ShotType = input.type
    if (shown === 'auto' && this.released) {
      const at = this.crossPoint(feet)
      shown = chooseForAnim(input.aim, feet, this.frame.offsetOff(at) - this.guard, at.y, this.pitchedLength(), DELIVERIES[this.plan.type].spin)
    }
    if (input.type === 'leave') st.setPose('leave')
    else st.setPose('shot', shown === 'auto' ? 'drive' : shown)
    this.footTarget = feet === 'front' ? 0.55 : feet === 'back' ? -0.2 : 0
  }

  queueAiShot(input: ShotInput, at: number) {
    this.aiShot = input
    this.aiShotAt = at
  }

  /** Timing error if the shot were played now: bat arrival minus ball arrival at the chosen plane. */
  timingErrorNow(type: ShotType, feetIn: Footwork) {
    const lead = shotSpec(type === 'auto' ? 'drive' : type === 'leave' ? 'defend' : type).lead
    let feet = feetIn
    if (feet === 'auto') feet = naturalFeet(this.pitchedLength(), DELIVERIES[this.plan.type].spin)
    let tCross = this.crossTime(feet)
    if (tCross < 0) tCross = this.crossTime('auto')
    if (!this.released) return -0.5
    return this.ball.time + lead - tCross
  }

  /* ---------------- the delivery in flight ---------------- */

  private updateFlight(dt: number) {
    if (this.aiShot && this.ball.time >= this.aiShotAt) {
      const s = this.aiShot
      this.aiShot = null
      if (s.type === 'leave') this.striker.setPose('leave')
      else this.setShot(s)
    }
    const f = this.frame
    if (this.pendingShot && !this.shotResolved && Math.abs(this.footTarget) > 0.01) {
      let target = f.local(-0.42 + this.guard, Geo.CreaseDepth - 0.1 + this.footTarget)
      if (this.charging) target = f.local(-0.3 + this.guard, Geo.CreaseDepth + 1.9)
      this.striker.pos = moveTowardsV(this.striker.pos, target, 3.5 * dt)
    } else if (this.charging) {
      this.striker.moveTo(f.local(-0.3 + this.guard, Geo.CreaseDepth + 1.9), dt, 0.8, 0.1)
      this.striker.face(this.striker.pos.add(f.off))
    }
    this.flightAccum += dt
    while (this.flightAccum >= DT && this.phase === 'flight') {
      this.flightAccum -= DT
      const prev = this.ball.pos.clone()
      const r = step(this.ball, this.env, DT)
      if (r.bounced && this.ball.bounces === 1) this.raise({ type: 'bounce', p: r.bouncePos.toArray(2), f: r.impactSpeed })
      this.checkPlanes(prev, this.ball.pos)
    }
    if (this.phase === 'flight') this.deliveryTrail.push(this.ball.pos.clone())
    if (this.phase === 'flight' && (this.ball.stopped || this.ball.time > 4)) this.startLive()
    this.keeperTrack(dt)
    this.nonStrikerBackingUp(dt)
  }

  private nonStrikerBackingUp(dt: number) {
    const be = 1 - this.inn.strikerEnd
    const target = stumpsAt(be).add(new V3(0, 0, inward(be) * (Geo.CreaseDepth + 1.2)))
    target.x = this.nonStriker.pos.x
    this.nonStriker.moveTo(target, dt, 0.35, 0.2)
    this.nonStriker.face(stumpsAt(this.inn.strikerEnd))
    if (this.nonStriker.speed > 0.4) this.nonStriker.setPose('walk')
  }

  private keeperTrack(dt: number) {
    const k = this.keeperActor
    if (!k) return
    const f = this.frame
    const kf = f.offsetFwd(k.home)
    let line = f.offsetOff(this.ball.pos)
    if (f.offsetFwd(this.ball.pos) > kf + 0.5) {
      const p = this.predictAtPlane(this.ball, kf, 2)
      line = f.offsetOff(p)
      k.look = p
    }
    const want = k.home.add(f.off.mul(clamp(line - f.offsetOff(k.home), -1.2, 1.2)))
    k.pos = moveTowardsV(k.pos, want, 3 * dt)
  }

  private predictAtPlane(s0: BallState, planeFwd: number, maxTime: number) {
    const s = cloneBall(s0)
    const f = this.frame
    let prev = s.pos.clone()
    for (let i = 0; i < maxTime / DT; i++) {
      step(s, this.env, DT)
      const a = f.offsetFwd(prev)
      const b = f.offsetFwd(s.pos)
      if (a >= planeFwd && b < planeFwd) return prev.lerp(s.pos, (a - planeFwd) / Math.max(1e-5, a - b))
      prev = s.pos.clone()
      if (s.stopped) break
    }
    return s.pos
  }

  /** The ball against the batter's contact plane, the popping crease, the stumps and the keeper. */
  private checkPlanes(prev: V3, now: V3) {
    const f = this.frame
    const a = f.offsetFwd(prev)
    const b = f.offsetFwd(now)
    if (!this.shotResolved) {
      const ps = this.pendingShot
      const feet: Footwork = ps ? (ps.feet === 'auto' ? (this.charging ? 'charge' : naturalFeet(this.pitchedLength(), DELIVERIES[this.plan.type].spin)) : ps.feet) : 'auto'
      const plane = this.contactPlaneFwd(feet === 'auto' ? (this.naturalPlane() === 1 ? 'front' : 'back') : feet)
      if (a >= plane && b < plane) {
        this.resolveAtBat(prev.lerp(now, (a - plane) / Math.max(1e-5, a - b)))
        if (this.hitBat) return
      }
    }
    const crease = Geo.CreaseDepth
    if (a >= crease && b < crease && !this.hitBat) this.judgeAtCrease(prev.lerp(now, (a - crease) / Math.max(1e-5, a - b)))
    if (a >= 0 && b < 0 && !this.hitBat) {
      const at = prev.lerp(now, a / Math.max(1e-5, a - b))
      if (hitsStumps(at)) {
        this.breakStumps(this.inn.strikerEnd, at)
        this.ball.vel.scaleIn(0.35)
        this.ball.vel.z *= -0.3
        if (!this.wicketDecided) {
          this.wicketDecided = true
          this.wicket('bowled', true, -1)
        }
        this.queueDead(1.2)
        this.setPhase('live')
        return
      }
    }
    if (this.keeperActor && !this.hitBat) {
      const k = f.offsetFwd(this.keeperActor.pos) + 0.3
      if (a >= k && b < k) this.keeperGather(now)
    }
    if (b < -25) this.startLive()
  }

  private resolveAtBat(at: V3) {
    this.shotResolved = true
    const inn = this.inn
    const batter = this.battingTeam.players[this.batterId]
    const spin = DELIVERIES[this.plan.type].spin
    const conf = this.confidenceOf(inn.battingTeam, this.batterId)
    const ctx = {
      frame: this.frame,
      ballPos: at,
      ballVel: this.ball.vel.clone(),
      length: this.pitchedBeforeBatter ? this.frame.offsetFwd(this.pitchedAt) : -1,
      lateMovement: this.crossLate * (spin ? 0.35 : 1),
      spin,
      batterSkill: bat01(batter),
      batterPower: clamp01(bat01(batter) * 0.6 + (batter.role === 'batter' ? 0.3 : 0.1)),
      guard: this.guard,
      // Humans get the difficulty's window, widened when the batter is "in".
      window: (this.humanBats ? this.difficultyWindow : 1) * lerp(0.88, 1.18, conf),
    }
    const input: ShotInput = this.pendingShot ?? { type: 'leave', feet: 'auto', aim: 0, loft: false, played: false, timingError: 0, power: 0 }
    if (!this.pendingShot && this.striker.pose === 'stance') this.striker.setPose('leave')
    const r = resolveShot(input, ctx, this.rng)
    this.lastShot = r
    this.outcome.shot = r.shot
    this.lastShotNote = r.note
    this.lastTiming = r.timing
    this.lastTimingError = input.timingError
    if (r.shot !== 'leave') {
      this.striker.feet = r.feet
      if (this.striker.pose === 'shot' && this.striker.variant !== r.shot && this.striker.poseTime < 0.12) this.striker.variant = r.shot
    }
    this.bumpConfidence(r)

    if (r.hitWicket) {
      this.breakStumps(inn.strikerEnd, stumpsAt(inn.strikerEnd).add(new V3(0, 0.5, 0)))
      this.wicketDecided = true
      this.wicket('hitwicket', true, -1)
      this.say("Oh no! He's trodden on his stumps! Hit wicket.")
    }
    if (r.contact === 'middle' || r.contact === 'edge') {
      this.hitBat = true
      const b = this.ball
      b.pos = at.clone()
      b.vel = r.exitVel.clone()
      b.spin = r.exitSpin.clone()
      b.swingCoef = 0
      b.bounces = 0
      b.pitched = false
      b.rolling = false
      b.stopped = false
      this.bouncedSinceHit = false
      this.raise({ type: r.contact === 'edge' ? 'edge' : 'bathit', f: r.quality, i: ['noshot', 'veryearly', 'early', 'perfect', 'late', 'verylate'].indexOf(r.timing), text: r.note, p: at.toArray(2), j: r.exitVel.len })
      if (r.playedOn) {
        this.breakStumps(inn.strikerEnd, stumpsAt(inn.strikerEnd).add(new V3(0, 0.3, 0)))
        if (!this.wicketDecided) {
          this.wicketDecided = true
          this.wicket('bowled', true, -1)
        }
        this.say('Dragged on! The inside edge crashes into the stumps.')
        this.queueDead(1.2)
        this.setPhase('live')
        return
      }
      this.startLive()
      return
    }
    if (r.contact === 'miss') this.raise({ type: 'beaten', text: r.note })
    else this.raise({ type: 'leave' })

    const f = this.frame
    const u = f.offsetOff(at) - this.guard
    let legMin = -0.62
    let legMax = -0.1
    if (r.feet === 'front') {
      legMin = -0.42
      legMax = 0.12
    }
    if (r.shot === 'leave' || !input.played) {
      // Shouldering arms: the front pad is in line with middle stump.
      legMin = -0.6
      legMax = 0.04
    }
    if (u > legMin && u < legMax && at.y < 1.55) {
      this.touchedBody = true
      const pad = at.y < 0.85
      this.padImpact = pad
      this.raise({ type: 'pad', p: at.toArray(2), i: pad ? 1 : 0 })
      const vin = this.ball.vel.clone()
      const b = this.ball
      b.pos = at.clone()
      b.vel = new V3(this.rng.range(-1.5, 1.5), this.rng.range(0, 1.5), 0).add(f.fwd.mul(this.rng.range(0.5, 2.5)))
      b.spin = new V3()
      b.swingCoef = 0
      this.striker.setPose('hit')
      if (pad && !this.wicketDecided) this.considerLbw(at, vin, input.played && r.shot !== 'leave')
      else if (!pad) this.say("Into the body. He'll feel that.")
      this.startLive()
    }
  }

  private bumpConfidence(r: ShotResult) {
    const team = this.inn.battingTeam
    const c = this.confidenceOf(team, this.batterId)
    let d = 0.02
    if (r.contact === 'middle') d += r.timing === 'perfect' ? 0.07 : 0.03
    if (r.contact === 'miss') d -= 0.09
    if (r.contact === 'edge') d -= 0.05
    this.confidence[team][this.batterId] = clamp(c + d, 0, 1)
  }

  private judgeAtCrease(at: V3) {
    const inn = this.inn
    if (!this.pitchedBeforeBatter && at.y > 1.0 && !this.noBallCalled) {
      this.noBallCalled = true
      this.raise({ type: 'noball', text: 'No ball! Above the waist.' })
    }
    if (this.pitchedBeforeBatter && this.frame.offsetFwd(this.pitchedAt) > 8 && at.y > 1.3) {
      inn.bouncersThisOver++
      if (inn.bouncersThisOver > this.state.activeRules.bouncersPerOver && !this.noBallCalled) {
        this.noBallCalled = true
        this.raise({ type: 'noball', text: "No ball! That's one bouncer too many this over." })
      }
    }
    if (!this.noBallCalled && !this.touchedBody && isWide(this.frame, at, this.guard, this.touchedBody)) this.wideCalled = true
  }

  private keeperGather(at: V3) {
    const k = this.keeperActor
    if (!k || this.heldBy) return
    const f = this.frame
    const lateral = Math.abs(f.offsetOff(at) - f.offsetOff(k.pos))
    const upToStumps = k.home.flatDist(f.origin) < 3
    const reach = upToStumps ? 1.0 : 1.7
    if (lateral < reach && at.y < 2.3 && this.rng.chance(lerp(0.93, 0.997, k.skill) - lateral * 0.04)) {
      this.giveBall(k, at)
      k.setPose('keepertake')
      k.look = at.clone()
      this.raise({ type: 'keeper', i: k.index })
      if (upToStumps && !this.hitBat && this.strikerOutOfGround() && !this.noBallCalled) {
        this.breakStumps(this.inn.strikerEnd, stumpsAt(this.inn.strikerEnd).add(new V3(0, 0.6, 0)))
        if (!this.wicketDecided) {
          this.wicketDecided = true
          this.wicket('stumped', true, k.player)
          this.say('Stumped! Lightning-quick hands from the keeper.')
          this.tvRunOut = { end: this.inn.strikerEnd, out: true, short: 0.3 + this.rng.range(0, 0.6) }
        }
        this.queueDead(1.2)
        this.setPhase('live')
        return
      }
      this.queueDead(0.9)
      this.setPhase('live')
    } else {
      k.setPose('dive')
      this.raise({ type: 'dive', i: k.index })
      this.startLive()
    }
  }

  private strikerOutOfGround() {
    const fwd = this.frame.offsetFwd(this.striker.pos)
    if (this.charging) return fwd > Geo.CreaseDepth - 0.2
    const lunged = this.lastShot.feet === 'front' && this.lastShot.contact === 'miss'
    return lunged && this.rng.chance(0.12)
  }

  private startLive() {
    if (this.phase === 'live') return
    this.setPhase('live')
    this.beginLive()
  }

  breakStumps(end: number, at: V3) {
    this.raise({ type: 'stumps', i: end, p: at.toArray(2), f: this.ball.vel.len })
  }

  private wicket(how: Dismissal, striker: boolean, fielder: number) {
    this.outcome.wicket = true
    this.outcome.how = how
    this.outcome.strikerOut = striker
    this.outcome.fielder = fielder
  }

  private queueDead(delay: number) {
    if (this.deadQueued) return
    this.deadQueued = true
    this.deadTimer = delay
  }

  /* ---------------- dead ball, commit, next ball ---------------- */

  private goDead() {
    const o = this.outcome
    o.pitched = this.pitchedBeforeBatter ? this.pitchedAt.clone() : new V3()
    o.kmh = this.lastKmh
    o.delivery = this.plan.type
    o.strikerEnd = this.inn.strikerEnd
    o.leftHand = !this.strikerRight
    if (o.end.lenSq === 0) o.end = this.ball.pos.flat()
    if (this.noBallCalled) o.extra = 'noball'
    else if (this.wideCalled && !this.hitBat) o.extra = 'wide'
    let ran = this.runsCompleted
    // Nets: with no fielders, a shot that isn't run is worth what it would have fetched in a match.
    if (this.nets && this.hitBat && ran === 0 && !o.four && !o.six) {
      const dist = this.ball.pos.flatDist(this.frame.origin)
      ran = dist > 48 ? 3 : dist > 26 ? 2 : dist > 9 ? 1 : 0
    }
    o.runsRun = ran
    if (!o.four && !o.six) {
      if (this.hitBat) o.runsBat = ran
      else if (o.extra === 'wide' || o.extra === 'noball') o.extraRuns = ran
      else if (ran > 0) {
        o.extra = this.touchedBody ? 'legbye' : 'bye'
        o.extraRuns = ran
      }
    } else if (!this.hitBat) {
      const b = o.four ? 4 : 0
      o.four = false
      if (o.extra === 'wide' || o.extra === 'noball') o.extraRuns = b
      else {
        o.extra = this.touchedBody ? 'legbye' : 'bye'
        o.extraRuns = b
      }
    }
    this.setPhase('dead')
    this.committed = false
    this.chooseSignal()
    for (const a of this.actors) if (a.team >= 0 && a.visible && a.pose !== 'celebrate' && a.pose !== 'dejected' && a.pose !== 'appeal') a.vel = new V3()
  }

  private chooseSignal() {
    const o = this.outcome
    let s: Signal = 'none'
    if (o.wicket && !(this.inn.freeHit && o.how !== 'runout')) s = 'out'
    else if (o.six) s = 'six'
    else if (o.four) s = 'four'
    else if (o.extra === 'wide') s = 'wide'
    else if (o.extra === 'noball') s = 'noball'
    else if (o.extra === 'bye') s = 'bye'
    else if (o.extra === 'legbye') s = 'legbye'
    this.signal = s
    if (s !== 'none') {
      this.actors[UMP_BOWLER].setPose('signal', s)
      this.raise({ type: 'signal', text: s })
    }
  }

  private updateDead() {
    if (!this.committed && this.phaseTime > 0.4) {
      if (this.offerReview()) return
      this.commit()
    }
    const o = this.outcome
    const wait = o.wicket || o.six || o.four ? 2.4 : 1.3
    if (this.committed && this.phaseTime > wait) this.afterBall()
  }

  private commit() {
    this.committed = true
    this.version++
    const inn = this.inn
    const freeHit = inn.freeHit
    const bowlerName = surname(this.fieldingTeam.players[inn.bowler])
    const batterName = surname(this.battingTeam.players[this.batterId])
    const runsBefore = cardOf(inn, this.batterId)?.runs ?? 0
    const o = this.outcome
    // In the nets a wicket is shown but never counted.
    const netsOut = this.nets && o.wicket && !(freeHit && o.how !== 'runout')
    if (netsOut) o.wicket = false
    const outPlayer = o.strikerOut ? this.batterId : inn.nonStriker
    const rec = this.state.apply(o)
    const shotLine = this.lastShotNote ? `${this.lastShotNote}${this.lastKmh > 0 ? ` · ${Math.round(this.lastKmh)} km/h` : ''}` : ''
    if (rec.wicket || netsOut) {
      const fielderName = o.fielder >= 0 ? surname(this.fieldingTeam.players[o.fielder]) : bowlerName
      const text = C.wicket(o, this.lastShot.contact === 'edge', batterName, bowlerName, fielderName, this.rng)
      const how = o.how === 'runout' ? 'RUN OUT!' : o.how === 'hitwicket' ? 'HIT WICKET!' : `${DISMISSAL_NAMES[o.how].toUpperCase()}!`
      const card = cardOf(inn, outPlayer)
      const sub = netsOut ? 'Nets: it does not count. Next ball.' : `OUT · ${surname(this.battingTeam.players[outPlayer])} ${card ? this.state.dismissalText(inn, card) : ''}`
      this.showBanner(how, 2.6, sub)
      this.raise({ type: 'wicket', i: ['none', 'bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket'].indexOf(o.how), j: o.strikerOut ? this.batterId : -1, text: o.how })
      this.say(text)
      this.celebrate()
      this.replayWanted = !this.nets
    } else if (o.wicket && freeHit) this.say("He'd have been out, but it's a free hit!")
    if (o.six) {
      this.showBanner('SIX!', 2.2, shotLine)
      this.raise({ type: 'six' })
      this.say(C.six(batterName, this.rng))
      this.replayWanted = true
    } else if (o.four) {
      this.showBanner('FOUR!', 2, shotLine)
      this.raise({ type: 'four' })
      this.say(C.four(batterName, this.lastShot, this.rng))
    } else if (!rec.wicket && !netsOut) {
      const runs = o.runsBat + o.extraRuns
      if (o.extra === 'wide') {
        this.showBanner('WIDE', 1.4, runs > 0 ? `${runs + 1} runs` : '1 run')
        this.raise({ type: 'wide' })
        this.say(C.wide(this.rng, this.frame.offsetOff(this.ball.pos) < 0))
      } else if (o.extra === 'noball') {
        this.showBanner('NO BALL', 1.6, runs > 0 ? `${runs + 1} runs · free hit next` : 'Free hit next ball')
        this.say(runs > 0 ? C.runs(runs, o.extra, batterName, this.rng) : 'No-ball called. Free hit coming up!')
      } else if (runs === 0) {
        this.showBanner('DOT BALL', 1.2, this.lastShot.contact === 'miss' ? `${this.lastShotNote || 'Beaten'} · ${Math.round(this.lastKmh)} km/h` : shotLine)
        this.raise({ type: 'dot' })
        this.say(C.dot(this.lastShot, batterName, this.rng))
      } else {
        const extra = o.extra === 'bye' ? ' · BYES' : o.extra === 'legbye' ? ' · LEG BYES' : ''
        this.showBanner(`${runs} RUN${runs === 1 ? '' : 'S'}${extra}`, 1.4, shotLine)
        this.raise({ type: 'runs', i: runs })
        this.say(C.runs(runs, o.extra, batterName, this.rng))
      }
    }
    const runsAfter = cardOf(inn, this.batterId)?.runs ?? 0
    if (runsBefore < 50 && runsAfter >= 50) {
      this.say(`Fifty for ${batterName}! Raises the bat to the dressing room.`)
      this.raise({ type: 'milestone', i: 50, j: this.batterId })
    }
    if (runsBefore < 100 && runsAfter >= 100) {
      this.say(`A hundred for ${batterName}! What an innings!`)
      this.raise({ type: 'milestone', i: 100, j: this.batterId })
    }
    if (o.four || o.six) this.confidence[inn.battingTeam][this.batterId] = clamp(this.confidenceOf(inn.battingTeam, this.batterId) + 0.06, 0, 1)
  }

  private celebrate() {
    for (const a of this.actors) {
      if (!a.visible || a.team < 0) continue
      if (a.team === 1 - this.inn.battingTeam) a.setPose(this.rng.chance(0.5) ? 'celebrate' : 'appeal')
    }
    this.striker.setPose('dejected')
  }

  private afterBall() {
    const inn = this.inn
    if (this.phase !== 'replay' && this.replayWanted && this.replayHook) {
      const kind = this.outcome.six ? 'six' : this.outcome.how === 'runout' ? 'runout' : 'wicket'
      this.replayWanted = false
      if (this.replayHook(kind)) {
        this.replayDone = false
        this.setPhase('replay')
        return
      }
    }
    this.ballVisible = false
    if (inn.complete) {
      this.endInnings()
      return
    }
    if (inn.bowler < 0) {
      this.raise({ type: 'overend', i: Math.floor(inn.legalBalls / 6) })
      this.say(C.endOfOver(this.state))
      this.recoverBowlers()
      this.syncBatters()
      this.setPhase('choosebowler')
      return
    }
    this.startDelivery()
  }

  private recoverBowlers() {
    for (const a of this.fielders()) if (a.player !== this.inn.lastOverBowler) a.stamina = Math.min(100, a.stamina + 8)
  }

  private endInnings() {
    const inn = this.inn
    this.raise({ type: 'inningsend', i: inn.battingTeam, text: `${this.battingTeam.name} ${scoreText(inn)} (${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6} ov)` })
    this.say(`That's the end of the innings: ${this.battingTeam.name} ${scoreText(inn)}.`)
    this.pendingNext = null
    if (inn.target > 0) {
      const next = this.state.nextInnings()
      if (!next) {
        this.endMatch()
        return
      }
      this.showBanner("It's a tie! SUPER OVER", 3)
      this.say("Scores level! We're going to a super over!")
      this.pendingNext = next
    }
    this.setPhase('break')
  }

  private continueFromBreak() {
    if (this.phase !== 'break') return
    if (this.pendingNext) {
      const n = this.pendingNext
      this.pendingNext = null
      this.beginInnings(n.battingTeam, n.superOver)
      return
    }
    const inn = this.inn
    this.beginInnings(1 - inn.battingTeam, inn.superOver)
  }

  /* ---------------- commands ---------------- */

  submit(c: Command) {
    const inn = this.inn
    const batSide = !!inn && c.side === this.battingSide
    const bowlSide = !!inn && c.side === this.fieldingSide
    switch (c.t) {
      case 'toss':
        if (this.phase === 'toss' && this.tossCall < 0 && c.side === (this.online ? 1 : 0)) {
          this.tossCall = c.call
          this.version++
        }
        break
      case 'tosschoice':
        if (this.phase === 'toss' && this.tossResult >= 0 && this.state.tossWinner === c.side && this.state.innings.length === 0) this.chooseToss(c.bat)
        break
      case 'bowler':
        if (this.phase === 'choosebowler' && bowlSide) this.pickBowler(c.player)
        break
      case 'delivery':
        if (this.phase === 'predelivery' && bowlSide) {
          const types = deliveriesFor(this.fieldingTeam.players[inn.bowler].bowl)
          if (types.includes(c.type)) {
            const f = this.frame
            const lengthDefault = Math.abs(f.offsetFwd(this.marker) - DELIVERIES[this.selectedDelivery].defaultLength) < 0.3
            this.selectedDelivery = c.type
            if (lengthDefault || c.type === 'yorker' || c.type === 'bouncer') this.marker = f.local(f.offsetOff(this.marker), DELIVERIES[c.type].defaultLength)
          }
        }
        break
      case 'target':
        if ((this.phase === 'predelivery' || (this.phase === 'runup' && !this.released)) && bowlSide) {
          const off = clamp(c.off, -1.6, 1.6)
          const len = clamp(c.len, -0.3, 14)
          this.marker = this.frame.local(off, len)
          if (this.phase === 'runup') this.plan.target = this.marker.clone()
        }
        break
      case 'wicketside':
        if (this.phase === 'predelivery' && bowlSide) {
          this.around = !this.around
          this.layoutForDelivery()
        }
        break
      case 'preset':
        if ((this.phase === 'predelivery' || this.phase === 'choosebowler') && bowlSide && inn.bowler >= 0) {
          this.preset = c.preset
          this.applyField()
          this.layoutForDelivery()
        }
        break
      case 'runup':
        if (this.phase === 'predelivery' && bowlSide) this.beginRunUp()
        break
      case 'release':
        if (bowlSide) this.pressRelease(c.side === this.localSide || !this.online ? this.meterValue : c.meter)
        break
      case 'charge':
        if ((this.phase === 'predelivery' || this.phase === 'runup') && batSide && !this.released && isSpinStyle(this.fieldingTeam.players[inn.bowler].bowl)) this.charging = true
        break
      case 'shot':
        if (batSide && (this.phase === 'flight' || this.phase === 'runup')) {
          const input: ShotInput = { type: c.shot, feet: c.feet, loft: c.loft, aim: c.aim, played: true, timingError: 0, power: 0 }
          input.timingError = c.side === this.localSide || !this.online || c.timing === undefined ? this.timingErrorNow(c.shot, c.feet) : c.timing
          this.setShot(input)
        }
        break
      case 'run':
        if (batSide) {
          this.humanCallAt = this.liveTime
          this.callRun()
        }
        break
      case 'back':
        if (batSide) {
          this.humanCallAt = this.liveTime
          this.callBack()
        }
        break
      case 'review':
        if (this.phase === 'dead' || this.phase === 'review') this.requestReview(c.side)
        break
      case 'continue':
        if (this.phase === 'break') this.continueFromBreak()
        else if (this.phase === 'replay') this.replayDone = true
        break
      case 'skip':
        if (this.phase === 'replay') this.replayDone = true
        break
      case 'throw':
        if (bowlSide && this.phase === 'live') this.manualThrowEnd = c.end === 'keeper' ? inn.strikerEnd : 1 - inn.strikerEnd
        break
    }
  }

  private updateIdleActors() {
    const ump = this.actors[UMP_BOWLER]
    if (ump.pose === 'signal' && ump.poseTime > 2.4) ump.setPose('umpire')
    if (this.phase === 'predelivery' && this.striker.pose !== 'stance') this.striker.setPose('stance')
  }

  /* ---------------- live ball: fielding and running ---------------- */

  private resetLive() {
    this.liveTime = 0
    this.runsCompleted = 0
    this.runCrossed = false
    this.throwInFlight = false
    this.throwTarget = null
    this.throwEnd = -1
    this.lastThrower = null
    this.caught = false
    this.heldBy = null
    this.manualThrowEnd = -1
    this.humanCallAt = -10
    this.holdSince = 0
    for (const p of this.plans) {
      p.job = 'none'
      p.dive = false
    }
    for (const r of this.runners) {
      r.running = false
      r.sliding = false
    }
  }

  private beginLive() {
    const inn = this.inn
    this.liveTime = 0
    this.runners[0].atEnd = this.runners[0].toEnd = inn.strikerEnd
    this.runners[1].atEnd = this.runners[1].toEnd = 1 - inn.strikerEnd
    this.runners[0].lane = this.strikerRight ? 1.1 : -1.1
    this.runners[1].lane = -this.runners[0].lane
    this.planFielding()
  }

  private planFielding() {
    this.planTime = this.liveTime
    predict(this.ball, this.env, 9, PATH_STEP, this.path, this.pathBounces)
    let firstBounce = this.pathBounces.length > 0 ? this.pathBounces[0] : this.path.length
    if (this.bouncedSinceHit || !this.hitBat) firstBounce = 0
    let best: Actor | null = null
    let bestT = Infinity
    let bestIdx = -1
    let bestCatch = false
    let bestDive = false
    for (let i = FIRST_FIELDER; i < FIRST_FIELDER + FIELDERS; i++) {
      const a = this.actors[i]
      if (!a.visible) continue
      const p = this.plans[i]
      p.job = 'none'
      p.dive = false
      p.reaction = a.pos.dist(this.ball.pos) < 25 ? 0.16 : 0.3
      if (a === this.bowlerActor && a.pose === 'follow' && this.liveTime < 0.2) p.reaction += 0.15
      const r = this.intercept(a, p.reaction, firstBounce)
      if (r) {
        const t = r.index * PATH_STEP
        if (t < bestT) {
          bestT = t
          best = a
          bestIdx = r.index
          bestCatch = r.catchable
          bestDive = r.dive
        }
      }
    }
    if (!best) {
      let end = this.path[this.path.length - 1].clone()
      if (beyondRope(end) > -1) end = end.sub(end.norm().mul(2))
      for (const a of this.nearestFielders(end, 2)) {
        const p = this.plans[a.index]
        p.job = 'chase'
        p.target = end
        p.at = this.planTime + this.path.length * PATH_STEP
      }
    } else {
      const p = this.plans[best.index]
      p.job = bestCatch ? 'catch' : 'chase'
      p.target = this.path[bestIdx].clone()
      p.at = this.planTime + bestIdx * PATH_STEP
      p.dive = bestDive
      const second = this.nearestFielders(this.path[bestIdx], 3).find((a) => a !== best && a !== this.keeperActor && a !== this.bowlerActor)
      if (second) {
        const bp = this.plans[second.index]
        bp.job = 'back'
        const dir = this.path[bestIdx].sub(this.frame.origin).flat().norm()
        bp.target = this.path[bestIdx].add(dir.mul(10))
        if (beyondRope(bp.target, 3) > 0) bp.target = this.path[bestIdx].add(second.pos.sub(this.path[bestIdx]).norm().mul(6))
      }
    }
    const inn = this.inn
    if (this.keeperActor && this.plans[this.keeperActor.index].job === 'none') {
      this.plans[this.keeperActor.index].job = 'cover'
      this.plans[this.keeperActor.index].target = stumpsAt(inn.strikerEnd).sub(this.frame.fwd.mul(0.6))
    }
    if (this.bowlerActor && this.plans[this.bowlerActor.index].job === 'none') {
      this.plans[this.bowlerActor.index].job = 'cover'
      this.plans[this.bowlerActor.index].target = stumpsAt(1 - inn.strikerEnd).add(this.frame.fwd.mul(0.6))
    }
  }

  private nearestFielders(p: V3, n: number) {
    return this.fielders()
      .filter((a) => a.visible)
      .sort((a, b) => a.pos.sub(p).lenSq - b.pos.sub(p).lenSq)
      .slice(0, n)
  }

  /** Earliest point on the predicted path this fielder can reach in time (a catch before the first bounce, or a stop). */
  private intercept(a: Actor, reaction: number, firstBounce: number): { index: number; catchable: boolean; dive: boolean } | null {
    let diveAt: { index: number; catchable: boolean; dive: boolean } | null = null
    for (let i = 1; i < this.path.length; i++) {
      const p = this.path[i]
      if (beyondRope(p, 0.8) > 0) return diveAt
      const t = i * PATH_STEP
      // A dive is the last resort: if he can get there on his feet a little later, he runs instead.
      if (diveAt && t > diveAt.index * PATH_STEP + 0.5) return diveAt
      const air = i < firstBounce
      const h = p.y
      const catchHeight = air && h > 0.15 && h < 2.6
      const groundHeight = h < 0.9
      if (!catchHeight && !groundHeight) continue
      const flat = p.flat()
      const dist = a.pos.flatDist(flat)
      const reach = 0.7
      let tRun = reaction + a.timeTo(flat.add(a.pos.sub(flat).flat().norm().mul(reach)))
      if (dist < reach) tRun = reaction * 0.5
      if (tRun <= t) return { index: i, catchable: catchHeight, dive: false }
      // A full-length dive buys a couple of metres, but only for a ball that's close and still quick.
      const speed = this.path[i].dist(this.path[i - 1]) / PATH_STEP
      if (!diveAt && speed > 7 && dist > reach && dist < 6 && tRun - 1.5 / a.maxSpeed - 0.12 <= t && t < 1.3 && (catchHeight || h < 0.6)) diveAt = { index: i, catchable: catchHeight, dive: true }
    }
    return diveAt
  }

  private updateLive(dt: number) {
    this.liveTime += dt
    if (this.deadQueued) {
      this.moveFieldersIdle(dt)
      this.updateRunners(dt)
      if (!this.heldBy) this.stepBall(dt)
      else this.followHolder()
      this.deadTimer -= dt
      if (this.deadTimer <= 0) this.goDead()
      return
    }
    if (!this.heldBy) this.stepBall(dt)
    else this.followHolder()
    if (this.phase !== 'live') return
    this.updateFielders(dt)
    this.updateRunners(dt)
    if (!this.humanBats || (this.assistRunning && this.liveTime - this.humanCallAt > 1.2)) AI.runningCalls(this)
    // Nets: nobody chases a ball into the outfield; the next one comes as soon as the shot is done.
    if (this.nets && !this.anyRunning && !this.heldBy && this.liveTime > (this.hitBat ? 2.4 : 1.2)) this.queueDead(0.2)
    if (this.heldBy && !this.anyRunning && !this.throwInFlight) {
      this.holdSince += dt
      const nearStumps = Math.min(this.heldBy.pos.dist(stumpsAt(0)), this.heldBy.pos.dist(stumpsAt(1)))
      if (this.holdSince > (nearStumps < 8 ? 0.6 : 1.6)) this.queueDead(0.1)
    } else this.holdSince = 0
    if (this.liveTime > 25) this.queueDead(0.1)
  }

  private stepBall(dt: number) {
    const steps = Math.max(1, Math.ceil(dt / DT))
    const h = dt / steps
    const b = this.ball
    for (let i = 0; i < steps; i++) {
      const prev = b.pos.clone()
      const r = step(b, this.env, h)
      if (r.bounced) {
        if (!this.bouncedSinceHit && this.hitBat) this.raise({ type: 'bounce', p: r.bouncePos.toArray(2), f: r.impactSpeed })
        this.bouncedSinceHit = true
      }
      for (let end = 0; end < 2; end++) {
        const at = crossesZ(prev, b.pos, stumpsZ(end))
        if (at && hitsStumps(at) && Math.abs(b.vel.z) > 3) {
          if (this.throwInFlight || (this.hitBat && end === 1 - this.inn.strikerEnd && this.rng.chance(0.35))) {
            this.breakStumps(end, at)
            b.vel.scaleIn(0.3)
            const direct = this.throwInFlight && this.throwDirect
            if (direct) this.raise({ type: 'directhit', i: end })
            this.runOutCheck(end, this.throwInFlight ? this.lastThrower : this.bowlerActor, direct || this.throwInFlight)
            this.throwInFlight = false
          }
        }
      }
      if (beyondRope(b.pos) >= 0 && !this.deadQueued) {
        this.boundary()
        return
      }
      if (this.deadQueued) return
    }
    if (this.throwInFlight && (b.rolling || b.bounces >= 2 || b.vel.len < 5)) {
      this.throwInFlight = false
      this.planFielding()
    }
    if (this.throwInFlight && this.throwTarget) {
      const hands = this.throwTarget.pos.add(new V3(0, 1, 0))
      if (b.pos.dist(hands) < 1.6) {
        this.throwInFlight = false
        const tt = this.throwTarget
        this.giveBall(tt, b.pos.clone())
        tt.setPose('catch')
        const end = this.throwEnd
        if (end >= 0 && tt.pos.dist(stumpsAt(end)) < 2.5 && this.runnerAtRisk(end)) {
          this.breakStumps(end, stumpsAt(end).add(new V3(0, 0.5, 0)))
          this.runOutCheck(end, tt, false)
        }
      }
    }
  }

  private followHolder() {
    const h = this.heldBy!
    this.ball.pos = h.pos.add(new V3(0, 1.1, 0)).add(h.forward.mul(0.3))
    this.ball.vel = new V3()
    this.ball.stopped = false
  }

  private giveBall(a: Actor, at: V3) {
    if (this.heldBy) this.heldBy.hasBall = false
    this.heldBy = a
    a.hasBall = true
    const b = this.ball
    b.pos = at.clone()
    b.vel = new V3()
    b.spin = new V3()
    b.rolling = false
    b.stopped = false
    this.collectedAt = this.liveTime
    this.outcome.end = at.flat()
  }

  private dropBall(vel: V3) {
    if (this.heldBy) this.heldBy.hasBall = false
    this.heldBy = null
    this.ball.vel = vel
    this.ball.stopped = false
    this.ball.rolling = false
    this.bouncedSinceHit = true
  }

  private boundary() {
    const six = this.hitBat && !this.bouncedSinceHit && !this.throwInFlight && !this.lastThrower
    const o = this.outcome
    o.end = this.ball.pos.flat()
    if (six) {
      o.six = true
      o.runsBat = 6
    } else {
      o.four = true
      o.runsBat = 4 + (this.lastThrower ? this.runsCompleted + (this.runners[0].running && this.runCrossed ? 1 : 0) : 0)
      if (this.lastThrower) this.say("Overthrows! And they've run away to the boundary!")
    }
    if (!this.hitBat) o.runsBat = 0
    this.ball.vel.scaleIn(0.2)
    for (const r of this.runners) r.running = false
    this.queueDead(1.0)
  }

  private updateFielders(dt: number) {
    for (let i = FIRST_FIELDER; i < FIRST_FIELDER + FIELDERS; i++) {
      const a = this.actors[i]
      if (!a.visible) continue
      const p = this.plans[i]
      if (a === this.heldBy) {
        this.updateHolder(a, dt)
        continue
      }
      if (this.liveTime < p.reaction) {
        a.face(this.ball.pos, dt)
        continue
      }
      // Let a throw or a pick-up finish before running on.
      if ((a.pose === 'throw' && a.poseTime < 0.55) || (a.pose === 'catch' && a.poseTime < 0.4 && !a.hasBall)) {
        a.vel = moveTowardsV(a.vel, new V3(), 14 * dt)
        a.pos.addScaledIn(a.vel, dt)
        continue
      }
      switch (p.job) {
        case 'chase':
        case 'catch':
          this.chase(a, p, dt)
          this.tryField(a)
          break
        case 'back':
        case 'cover':
          a.moveTo(p.target, dt, p.job === 'cover' ? 0.9 : 0.8, 0.3)
          if (a.speed < 0.3) {
            a.face(this.ball.pos, dt)
            if (a.pose !== 'catch' || a.poseTime > 0.6) a.setPose(a.kind === 'keeper' ? 'keeper' : 'ready')
          } else if (a.pose !== 'dive' || a.poseTime > 1) a.setPose('run')
          this.tryField(a)
          break
        default: {
          const toward = a.home.add(this.ball.pos.sub(a.home).flat().norm().mul(Math.min(6, this.liveTime * 2)))
          a.moveTo(toward, dt, 0.35, 0.5)
          a.face(this.ball.pos, dt)
          if (a.pose !== 'dive' || a.poseTime > 1.2) a.setPose(a.speed > 0.5 ? 'walk' : 'ready')
        }
      }
      a.look = this.ball.pos.clone()
    }
    if (this.liveTime - this.planTime > 1 && !this.heldBy && !this.throwInFlight) this.planFielding()
  }

  private chase(a: Actor, p: Plan, dt: number) {
    let target = p.target.clone()
    const distBall = a.pos.flatDist(this.ball.pos)
    if (distBall < 3 || this.ball.stopped || (this.ball.rolling && this.ball.vel.len < 4)) target = this.ball.pos.clone()
    target.y = 0
    const nearRope = beyondRope(target, 6) > 0
    if (a.pose === 'dive' || a.pose === 'slide' || a.pose === 'getup') {
      if (a.pose !== 'getup' && a.poseTime > 1.1) a.setPose('getup')
      if (a.pose === 'getup' && a.poseTime > 0.8) a.setPose('run')
      else {
        a.vel.scaleIn(0.9)
        a.pos.addScaledIn(a.vel, dt)
        return
      }
    }
    a.moveTo(target, dt, 1, 0.2)
    const tLeft = p.at - this.liveTime
    if (p.dive && tLeft < 0.35 && distBall < 2.6 && distBall > 0.8) {
      this.raise({ type: 'dive', i: a.index })
      a.setPose('dive')
      a.face(this.ball.pos)
      a.vel = this.ball.pos.sub(a.pos).flat().norm().mul(5)
    } else if (nearRope && distBall < 3.5 && a.speed > 5 && this.ball.rolling) a.setPose('slide')
    else a.setPose(a.speed > 0.5 ? 'run' : 'ready')
  }

  /** Takes a catch, stops the ball or misfields when it reaches the fielder's hands. */
  private tryField(a: Actor) {
    if (this.heldBy || (this.throwInFlight && a !== this.throwTarget)) return
    const diving = a.pose === 'dive'
    const flat = new V3(this.ball.pos.x - a.pos.x, 0, this.ball.pos.z - a.pos.z)
    const horiz = flat.len
    const h = this.ball.pos.y
    const reach = diving ? 1.7 : a.kind === 'keeper' ? 1.1 : 0.95
    const airCatch = this.hitBat && !this.bouncedSinceHit && h > 0.12 && h < (diving ? 1.3 : 2.8)
    if (airCatch && horiz < reach + 0.35) {
      this.attemptCatch(a, horiz > reach)
      return
    }
    if (h < 1.3 && horiz < reach) {
      const speed = this.ball.vel.len
      const fumble = clamp01((speed - 16) * 0.02) * (1 - a.skill * 0.6) + (diving ? 0.1 : 0.015)
      if (this.rng.chance(fumble)) {
        this.dropBall(this.ball.vel.mul(0.3).add(new V3(0, 1, 0)).sub(flat.norm().mul(1.5)))
        this.raise({ type: 'fielded', i: a.index, j: 1 })
        this.planFielding()
        return
      }
      this.giveBall(a, this.ball.pos.clone())
      a.setPose(diving || a.pose === 'slide' ? 'getup' : 'pickup')
      this.raise({ type: 'fielded', i: a.index })
    }
  }

  private attemptCatch(a: Actor, stretching: boolean) {
    if (this.caught) return
    const v = this.ball.vel.len
    const h = this.ball.pos.y
    const keeper = a.kind === 'keeper'
    let chance = keeper ? 0.95 : lerp(0.86, 0.97, a.skill)
    chance -= Math.max(0, v - 18) * 0.009
    if (h < 0.4) chance -= 0.12
    if (h > 2.2) chance -= 0.08
    if (a.pose === 'dive' || stretching) chance -= 0.22
    if (this.state.setup.time === 'night' && this.ball.vel.y < -12) chance -= 0.04
    if (this.humanBats) {
      const d = this.state.setup.difficulty
      chance *= d === 0 ? 0.85 : d === 2 ? 1.02 : 0.95
    }
    a.setPose(a.pose === 'dive' ? 'dive' : 'catch')
    a.look = this.ball.pos.clone()
    if (this.rng.chance(chance)) {
      this.caught = true
      this.giveBall(a, this.ball.pos.clone())
      if (!this.wicketDecided) {
        const ls = this.lastShot
        const thinEdge = ls.contact === 'edge' && ls.edge === 'outside' && ls.direction > 145
        if (thinEdge && !umpireHearsEdge(true, 1, this.rng)) this.appealNotOut(false)
        else if (this.noBallCalled) this.say("Caught! But it's a no-ball.")
        else {
          this.wicketDecided = true
          this.wicket('caught', true, a.player)
          this.runsCompleted = 0
          for (const r of this.runners) r.running = false
          // A thin edge to the keeper or slips is given; the batter may review it.
          if (thinEdge || ls.contact === 'edge') {
            this.appeal = 'caughtbehind'
            this.appealGivenOut = true
            this.appealEdgeTruth = true
          }
        }
      }
      this.raise({ type: 'catch', i: a.index })
      this.queueDead(1.2)
    } else {
      this.raise({ type: 'drop', i: a.index, text: 'Dropped!' })
      this.say(C.drop(surname(this.fieldingTeam.players[a.player]), this.rng))
      this.dropBall(this.ball.vel.mul(0.25).add(new V3(this.rng.range(-2, 2), 2, this.rng.range(-2, 2))))
      if (a.pose !== 'dive') a.setPose('getup')
      this.planFielding()
    }
  }

  private updateHolder(a: Actor, dt: number) {
    a.vel = moveTowardsV(a.vel, new V3(), 12 * dt)
    a.pos.addScaledIn(a.vel, dt)
    if (this.deadQueued) return
    if ((a.pose === 'pickup' || a.pose === 'getup' || a.pose === 'catch' || a.pose === 'dive') && this.liveTime - this.collectedAt < 0.35) return
    const { end: bestEnd, margin } = this.bestEndToThrow(a)
    let end = bestEnd
    const stumps = stumpsAt(end)
    const dist = a.pos.dist(stumps)
    if (dist < 3.5) {
      if (this.runnerAtRisk(end)) {
        this.breakStumps(end, stumps.add(new V3(0, 0.5, 0)))
        this.runOutCheck(end, a, false)
      }
      return
    }
    const manual = this.manualThrowEnd >= 0
    if (manual) end = this.manualThrowEnd
    else if (!this.anyRunning && a.kind === 'keeper' && dist < 25) return
    else if (!this.anyRunning && this.liveTime - this.collectedAt < 0.6) return
    if (a.pose === 'throw' && a.poseTime < 0.4) return
    this.throwBall(a, end, manual ? margin > -0.3 && margin < 0.6 : this.shouldGoForDirectHit(a, end, margin))
  }

  private bestEndToThrow(thrower: Actor) {
    let margin = Infinity
    let bestEnd = this.inn.strikerEnd
    for (let end = 0; end < 2; end++) {
      const r = this.runnerAtRisk(end)
      if (!r) continue
      const tBat = this.timeToGround(r, end)
      const tThrow = thrower.pos.dist(stumpsAt(end)) / this.throwSpeed(thrower) + 0.45
      const m = tBat - tThrow
      if (m > -0.6 && (margin === Infinity || m > margin)) {
        margin = m
        bestEnd = end
      }
    }
    if (margin === Infinity) {
      const dk = thrower.pos.dist(stumpsAt(this.inn.strikerEnd))
      const db = thrower.pos.dist(stumpsAt(1 - this.inn.strikerEnd))
      bestEnd = db < dk * 0.6 ? 1 - this.inn.strikerEnd : this.inn.strikerEnd
    }
    return { end: bestEnd, margin }
  }

  private throwSpeed(a: Actor) {
    return lerp(23, 31, a.skill)
  }

  private shouldGoForDirectHit(a: Actor, end: number, margin: number) {
    if (margin === Infinity) return false
    const receiver = end === this.inn.strikerEnd ? this.keeperActor : this.bowlerActor
    const there = !!receiver && receiver.pos.dist(stumpsAt(end)) < 2.5
    const dist = a.pos.dist(stumpsAt(end))
    return dist < 30 && (!there || (margin > -0.2 && margin < 0.5))
  }

  private throwBall(a: Actor, end: number, direct: boolean) {
    let receiver = end === this.inn.strikerEnd ? this.keeperActor : this.bowlerActor
    if (receiver === a) receiver = this.nearestFielders(stumpsAt(end), 2).find((x) => x !== a) ?? null
    const stumps = stumpsAt(end)
    const target = direct || !receiver ? stumps.add(new V3(0, 0.4, 0)) : receiver.pos.add(new V3(0, 1, 0))
    const speed = this.throwSpeed(a)
    const from = a.pos.add(new V3(0, 1.8, 0))
    const flat = target.sub(from)
    const h = flat.y
    flat.y = 0
    const d = flat.len
    const g = this.env.gravity
    const v2 = speed * speed
    const disc = v2 * v2 - g * (g * d * d + 2 * h * v2)
    let ang = disc > 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * d)) : 40 * DEG
    ang *= 1.08
    ang += d * 0.0012
    const yawErr = this.rng.gauss() * (direct ? lerp(2.2, 0.9, a.skill) * (0.4 + d / 30) : 1.2)
    const dir = rotateY(flat.mul(1 / Math.max(0.01, d)), yawErr)
    if (this.heldBy) this.heldBy.hasBall = false
    this.heldBy = null
    const b = this.ball
    b.pos = from
    b.vel = dir.mul(Math.cos(ang)).add(new V3(0, Math.sin(ang), 0)).mul(speed)
    b.spin = new V3()
    b.rolling = b.stopped = false
    b.swingCoef = 0
    b.bounces = 0
    this.bouncedSinceHit = true
    this.throwInFlight = true
    this.throwTarget = receiver
    this.throwEnd = end
    this.throwDirect = direct
    this.lastThrower = a
    this.manualThrowEnd = -1
    a.setPose('throw')
    a.face(target)
    a.aim = Math.atan2(dir.x, dir.z) / DEG
    this.raise({ type: 'throw', i: a.index, j: end, f: direct ? 1 : 0 })
    if (receiver) {
      this.plans[receiver.index].job = 'cover'
      this.plans[receiver.index].target = stumps.add(this.frame.origin.sub(stumps).norm().mul(-0.4))
    }
    const backup = this.nearestFielders(stumps, 4).find((x) => x !== a && x !== receiver)
    if (backup) {
      this.plans[backup.index].job = 'back'
      this.plans[backup.index].target = stumps.add(stumps.sub(a.pos).flat().norm().mul(12))
    }
  }

  private moveFieldersIdle(dt: number) {
    for (const a of this.fielders()) {
      if (!a.visible || a.pose === 'celebrate' || a.pose === 'appeal') continue
      if (a.pose === 'dive' && a.poseTime > 1) a.setPose('getup')
      a.vel = moveTowardsV(a.vel, new V3(), 10 * dt)
      a.pos.addScaledIn(a.vel, dt)
      if (a.speed < 0.3 && a.pose === 'run') a.setPose('idle')
    }
  }

  private updateRunners(dt: number) {
    for (let k = 0; k < 2; k++) {
      const r = this.runners[k]
      const a = r.a
      if (k === 0 && a.pose === 'shot' && a.poseTime < 0.5) {
        if (r.running) a.pos.addScaledIn(a.vel, dt)
        continue
      }
      if (!r.running) {
        if (a.pose === 'run' || a.pose === 'walk') a.setPose('idle')
        a.vel = moveTowardsV(a.vel, new V3(), 9 * dt)
        a.pos.addScaledIn(a.vel, dt)
        if (r.sliding && a.pose === 'batslide' && a.poseTime > 0.9) {
          r.sliding = false
          a.setPose('idle')
        }
        continue
      }
      const crease = poppingZ(r.toEnd)
      const inw = inward(r.toEnd)
      a.moveTo(new V3(r.lane, 0, crease - inw * 3), dt, r.sliding ? 0.7 : 1, 0.3)
      if (!r.sliding) a.setPose('run', 'bat')
      if (this.grounded(r, r.toEnd)) {
        const crossedRun = r.toEnd !== r.atEnd
        r.atEnd = r.toEnd
        r.running = false
        const o = this.runners[1 - k]
        if (crossedRun && !o.running && o.atEnd !== r.atEnd && this.runCrossed) {
          this.runsCompleted++
          this.runCrossed = false
          this.raise({ type: 'runcomplete', i: this.runsCompleted })
        }
      }
    }
    const r0 = this.runners[0]
    const r1 = this.runners[1]
    if (r0.running && r1.running && r0.toEnd !== r0.atEnd) {
      const dir0 = inward(r0.atEnd)
      if ((r0.a.pos.z - r1.a.pos.z) * dir0 > 0) this.runCrossed = true
    }
  }

  private grounded(r: Runner, end: number) {
    const reach = r.sliding ? 1.1 : 0.35
    return (r.a.pos.z - poppingZ(end)) * -inward(end) + reach >= 0
  }

  /** How far short of his ground a runner is (m, positive = short). */
  private shortOf(r: Runner, end: number) {
    const reach = r.sliding ? 1.1 : 0.35
    return -((r.a.pos.z - poppingZ(end)) * -inward(end) + reach)
  }

  private timeToGround(r: Runner, end: number) {
    const dist = Math.abs(r.a.pos.z - poppingZ(end)) - 0.35
    const v = Math.max(0.5, r.a.vel.dot(new V3(0, 0, Math.sign(poppingZ(end) - r.a.pos.z))))
    return dist <= 0 ? 0 : dist / lerp(v, r.a.maxSpeed, 0.5)
  }

  private runnerAtRisk(end: number) {
    let best: Runner | null = null
    let bestD = Infinity
    for (const r of this.runners) {
      const heading = r.running && r.toEnd === end
      const leaving = r.running && r.atEnd === end && r.toEnd !== end
      if (!heading && !leaving) continue
      const d = Math.abs(r.a.pos.z - poppingZ(end))
      if (d < bestD) {
        bestD = d
        best = r
      }
    }
    if (!best) return null
    return this.grounded(best, end) ? null : best
  }

  /** The runner nearest to this end's crease (made it or not), for close calls. */
  private nearestRunner(end: number) {
    return [...this.runners].sort((a, b) => Math.abs(a.a.pos.z - poppingZ(end)) - Math.abs(b.a.pos.z - poppingZ(end)))[0]
  }

  private runOutCheck(end: number, fielder: Actor | null, direct: boolean) {
    if (this.wicketDecided) return
    const r = this.runnerAtRisk(end)
    if (!r) {
      // Made it, but close: the fielders appeal and the third umpire has a look.
      const n = this.nearestRunner(end)
      const short = this.shortOf(n, end)
      if (short > -0.5 && (n.running || n.a.speed > 2)) this.tvRunOut = { end, out: false, short }
      return
    }
    this.wicketDecided = true
    const short = this.shortOf(r, end)
    this.wicket('runout', r.a === this.striker, fielder ? fielder.player : -1)
    this.say(direct ? "Direct hit! He's short of his ground — run out!" : "The bails are off and he's short of his ground — run out!")
    for (const x of this.runners) x.running = false
    if (short < 0.9) this.tvRunOut = { end, out: true, short }
    this.queueDead(1.2)
  }

  callRun() {
    if (this.phase !== 'live' || this.deadQueued || this.caught) return
    if (this.anyRunning) return
    if (this.runners[0].a.pose === 'batslide' && this.runners[0].a.poseTime < 0.5) return
    for (const r of this.runners) {
      r.toEnd = 1 - r.atEnd
      r.running = true
      r.sliding = false
    }
    this.runCrossed = false
  }

  callBack() {
    if (this.phase !== 'live') return
    for (const r of this.runners) {
      if (!r.running || r.toEnd === r.atEnd) continue
      r.toEnd = r.atEnd
    }
    this.runCrossed = false
  }

  slideBat() {
    if (this.phase !== 'live') return
    for (const r of this.runners) {
      if (!r.running || r.sliding) continue
      if (Math.abs(r.a.pos.z - poppingZ(r.toEnd)) < 3) {
        r.sliding = true
        r.a.setPose('batslide')
      }
    }
  }

  runTimeEstimate() {
    let t = 0
    for (const r of this.runners) {
      const to = r.running ? r.toEnd : 1 - r.atEnd
      const target = new V3(r.lane, 0, poppingZ(to) + inward(to) * 0.35)
      const turn = r.a.speed < 1 && Math.abs(r.a.pos.z - poppingZ(r.atEnd)) > 1 ? 0.45 : 0.2
      t = Math.max(t, r.a.timeTo(target) + turn)
    }
    return t
  }

  runnerTimeToGround(k: number) {
    const r = this.runners[k]
    return r.running ? this.timeToGround(r, r.toEnd) : -1
  }

  runnerProgress(k: number) {
    const r = this.runners[k]
    if (!r.running || r.toEnd === r.atEnd) return 0
    const from = poppingZ(r.atEnd)
    const to = poppingZ(r.toEnd)
    return clamp01((r.a.pos.z - from) / (to - from))
  }

  estimatedReturnTime() {
    let collect = 0
    let who = this.heldBy
    let at = this.heldBy ? this.heldBy.pos : this.ball.pos
    if (this.throwInFlight && this.throwTarget) return this.ball.pos.dist(this.throwTarget.pos) / Math.max(8, this.ball.vel.len) + 0.35
    if (!who) {
      let best = Infinity
      for (let i = FIRST_FIELDER; i < FIRST_FIELDER + FIELDERS; i++) {
        const p = this.plans[i]
        if (p.job !== 'chase' && p.job !== 'catch') continue
        const t = Math.max(0, p.at - this.liveTime)
        if (t < best) {
          best = t
          who = this.actors[i]
          at = p.target
        }
      }
      if (!who) {
        const near = this.nearestFielders(this.ball.pos, 1)
        if (near.length === 0) return 6
        who = near[0]
        best = 0.3 + who.timeTo(this.ball.pos)
      }
      collect = best + 0.35
    }
    const d = Math.min(at.dist(stumpsAt(0)), at.dist(stumpsAt(1)))
    if (d < 8) return collect + 0.25 + d / 6
    return collect + 0.6 + d / this.throwSpeed(who) + 0.35
  }

  boundaryLikely() {
    if (this.heldBy || this.path.length === 0) return false
    for (const p of this.plans) if ((p.job === 'chase' || p.job === 'catch') && beyondRope(p.target, 6) < 0) return false
    return beyondRope(this.path[this.path.length - 1], 0.5) >= 0
  }

  isAirCatchChance() {
    if (!this.hitBat || this.bouncedSinceHit) return false
    return this.plans.some((p) => p.job === 'catch')
  }

  /** Where the CPU fielders plan to take the ball (for the HUD's catch marker). */
  catchTarget(): V3 | null {
    if (!this.hitBat || this.bouncedSinceHit || this.phase !== 'live') return null
    const p = this.plans.find((x) => x.job === 'catch')
    return p ? p.target : null
  }

  /* ---------------- appeals, LBW and DRS ---------------- */

  private considerLbw(impact: V3, vin: V3, shotOffered: boolean) {
    const s = cloneBall(this.ball)
    s.pos = impact.clone()
    s.vel = vin.clone()
    s.swingCoef = 0
    let prev = s.pos.clone()
    let atStumps = impact.clone()
    const projected = [impact.clone()]
    const f = this.frame
    for (let i = 0; i < 800; i++) {
      step(s, this.env, DT)
      if (i % 6 === 0) projected.push(s.pos.clone())
      const a = f.offsetFwd(prev)
      const b = f.offsetFwd(s.pos)
      if (a >= 0 && b < 0) {
        atStumps = prev.lerp(s.pos, a / Math.max(1e-5, a - b))
        projected.push(atStumps)
        break
      }
      prev = s.pos.clone()
    }
    this.lbw = trackLbw(f, this.pitchedBeforeBatter, this.pitchedBeforeBatter ? this.pitchedAt : impact, impact, atStumps, shotOffered)
    this.projectedPath = projected
    const su = Math.abs(f.offsetOff(atStumps))
    const looksClose = this.lbw.pitching !== 'outsideleg' && su < 0.45 && atStumps.y < 1.1
    if (!looksClose) return
    this.appeal = 'lbw'
    this.raise({ type: 'appeal', i: 0, text: 'Howzat!' })
    this.bowlerActor?.setPose('appeal')
    this.keeperActor?.setPose('appeal')
    const given = umpireGivesLbw(this.lbw, f, this.rng, 0.85)
    this.appealGivenOut = given
    if (given && !this.noBallCalled) {
      this.wicketDecided = true
      this.wicket('lbw', true, -1)
      this.queueDead(1.4)
    } else {
      this.raise({ type: 'notout', text: 'Not out' })
      this.queueDead(1.6)
    }
  }

  private appealNotOut(isLbw: boolean) {
    this.appeal = isLbw ? 'lbw' : 'caughtbehind'
    this.appealGivenOut = false
    this.appealEdgeTruth = true
    this.raise({ type: 'appeal', i: 1, text: 'Howzat!' })
    this.raise({ type: 'notout', text: "Not out — the umpire didn't hear an edge" })
    this.caught = true
  }

  reviewsLeft(side: number) {
    if (!this.inn) return 0
    return side === this.battingSide ? this.inn.batReviews : this.inn.bowlReviews
  }
  canReview(side: number) {
    return this.phase === 'dead' && this.reviewWindowOpen && this.reviewSide === side && this.reviewsLeft(side) > 0
  }
  get reviewCountdown() {
    return this.reviewWindowOpen ? Math.max(0, this.reviewDeadline - this.phaseTime) : 0
  }
  /** The local player has no reviews left but could watch an ad for one. */
  get rewardedReviewOffer() {
    return this.reviewWindowOpen && this.reviewsLeft(this.reviewSide) === 0 && this.reviewSide === this.localSide && !this.online
  }
  grantExtraReview(side: number) {
    if (!this.inn) return
    if (side === this.battingSide) this.inn.batReviews++
    else this.inn.bowlReviews++
    this.version++
  }

  /** Before committing a decision, gives the wronged side a chance to review; true while waiting. */
  private offerReview() {
    // Close run outs and stumpings go to the third umpire automatically.
    if (this.tvRunOut && !this.reviewDone) {
      this.reviewDone = true
      this.startTvRunOut()
      return true
    }
    if (this.reviewDone || this.appeal === 'none') return false
    const side = this.appealGivenOut ? this.battingSide : this.fieldingSide
    if (this.reviewsLeft(side) <= 0 && !(this.sideHuman[side] && side === this.localSide && !this.online)) {
      this.reviewDone = true
      return false
    }
    if (!this.reviewWindowOpen) {
      this.reviewWindowOpen = true
      this.reviewSide = side
      this.reviewDeadline = this.phaseTime + (this.sideHuman[side] ? 10 : 1.2)
      this.version++
      if (!this.sideHuman[side]) {
        const truthOut = this.appeal === 'lbw' ? outIfCallsGo(this.lbw!, this.appealGivenOut) : this.appealEdgeTruth
        const wrong = truthOut !== this.appealGivenOut
        const d = this.state.setup.difficulty
        const sense = d === 2 ? 0.85 : d === 0 ? 0.6 : 0.75
        const go = this.rng.chance(wrong ? sense : 1 - sense) && this.reviewsLeft(side) > 0
        this.reviewWindowOpen = false
        if (go) {
          this.startReview(side)
          return true
        }
        this.reviewDone = true
        return false
      }
      this.raise({ type: 'prompt', i: side, text: this.appealGivenOut ? 'Review the decision?' : 'Not out. Review?' })
    }
    if (this.phaseTime >= this.reviewDeadline) {
      this.reviewWindowOpen = false
      this.reviewDone = true
      this.version++
      return false
    }
    return true
  }

  private requestReview(side: number) {
    if (!this.reviewWindowOpen || side !== this.reviewSide || this.reviewsLeft(side) <= 0) return
    this.reviewWindowOpen = false
    this.startReview(side)
  }

  private startReview(side: number) {
    const r = emptyReview()
    r.active = true
    r.kind = this.appeal === 'lbw' ? 'lbw' : 'caught'
    r.reviewingTeam = side === this.battingSide ? this.inn.battingTeam : 1 - this.inn.battingTeam
    r.originalOut = this.appealGivenOut
    r.track = this.lbw
    r.edge = this.appealEdgeTruth
    const pts = this.deliveryTrail.filter((_, i) => i % 2 === 0).map((p) => p.toArray(3))
    r.impactIndex = pts.length
    r.path = [...pts, ...this.projectedPath.map((p) => p.toArray(3))]
    r.outcome = r.kind === 'lbw' && this.lbw ? reviewLbw(this.lbw, this.appealGivenOut) : this.appealEdgeTruth === this.appealGivenOut ? 'stands' : 'overturned'
    r.finalOut = r.outcome === 'overturned' ? !this.appealGivenOut : this.appealGivenOut
    this.review = r
    this.raise({ type: 'reviewstart', i: side, j: r.kind === 'lbw' ? 1 : 0 })
    this.say(`${side === this.battingSide ? this.battingTeam.name : this.fieldingTeam.name} have gone upstairs. Let's see what the technology says.`)
    this.setPhase('review')
    this.signal = 'tv'
  }

  private startTvRunOut() {
    const t = this.tvRunOut!
    const r = emptyReview()
    r.active = true
    r.kind = 'runout'
    r.reviewingTeam = 1 - this.inn.battingTeam
    r.originalOut = false
    r.finalOut = t.out
    r.outcome = t.out ? 'overturned' : 'stands'
    r.end = t.end
    r.short = t.short
    this.review = r
    this.raise({ type: 'reviewstart', i: this.fieldingSide, j: 2 })
    this.say(this.outcome.how === 'stumped' ? 'The umpire wants a look at the stumping. Over to the third umpire.' : "Tight! The square-leg umpire draws a box in the air: it's going upstairs.")
    this.setPhase('review')
    this.signal = 'tv'
  }

  get reviewDuration() {
    return this.review.kind === 'lbw' ? 7 : this.review.kind === 'runout' ? 5.5 : 4.5
  }

  private updateReview() {
    const r = this.review
    r.time = this.phaseTime
    if (this.phaseTime < this.reviewDuration) return
    if (r.kind !== 'runout') {
      const side = r.reviewingTeam === this.inn.battingTeam ? this.battingSide : this.fieldingSide
      if (r.outcome === 'stands') {
        if (side === this.battingSide) this.inn.batReviews--
        else this.inn.bowlReviews--
      }
    }
    if (r.finalOut && !this.outcome.wicket) {
      this.wicketDecided = true
      this.wicket(r.kind === 'lbw' ? 'lbw' : 'caught', true, r.kind === 'lbw' ? -1 : (this.keeperActor?.player ?? -1))
      this.outcome.runsBat = 0
      this.runsCompleted = 0
    } else if (!r.finalOut && this.outcome.wicket) {
      this.outcome.wicket = false
      this.outcome.how = 'none'
      this.wicketDecided = false
    }
    const verdict =
      r.kind === 'runout'
        ? r.finalOut
          ? 'OUT — the bat was short of the crease.'
          : 'NOT OUT — he made his ground.'
        : r.outcome === 'overturned'
          ? 'Decision overturned'
          : r.outcome === 'umpirescall'
            ? "Umpire's call — the decision stands"
            : 'The decision stands'
    this.raise({ type: 'reviewresult', i: ['overturned', 'stands', 'umpirescall'].indexOf(r.outcome), j: r.finalOut ? 1 : 0, text: verdict })
    this.showBanner(r.finalOut ? 'OUT' : 'NOT OUT', 2.2)
    this.say(verdict + (r.outcome === 'umpirescall' ? ', and the review is retained.' : ''))
    r.active = false
    this.reviewDone = true
    this.setPhase('dead')
    this.committed = false
    this.chooseSignal()
  }

  /* ---------------- helpers for the HUD ---------------- */

  get batter(): Player {
    return this.battingTeam.players[this.inn.striker]
  }
  get bowler(): Player | null {
    return this.inn && this.inn.bowler >= 0 ? this.fieldingTeam.players[this.inn.bowler] : null
  }
  get liveOutcome() {
    return this.outcome
  }
  /** Timing feedback text for the last shot (early/perfect/late with ms). */
  get timingText() {
    const t = this.lastTiming
    if (t === 'noshot') return ''
    const ms = Math.round(this.lastTimingError * 1000)
    return `${t === 'veryearly' ? 'VERY EARLY' : t === 'verylate' ? 'VERY LATE' : t.toUpperCase()} ${ms > 0 ? '+' : ''}${ms} ms`
  }
}

/** The stroke the batter shapes to play (matches chooseShot without the rng). */
function chooseForAnim(aim: number, feet: Footwork, u: number, h: number, length: number, spin: boolean): ShotType {
  const back = feet === 'back' || (feet === 'auto' && naturalFeet(length, spin) === 'back')
  if (h > 1.05 && aim < 30) return 'pull'
  if (aim >= 60 && (back || u > 0.45)) return 'cut'
  if (aim <= -25) {
    if (spin && feet === 'front' && aim <= -60 && h < 0.75) return 'sweep'
    if (back && h > 0.5) return 'pull'
    return 'flick'
  }
  if (back && h > 0.9) return aim > 20 ? 'cut' : 'pull'
  return 'drive'
}

