// Formats, scoring, extras, dismissals, scorecards, innings and super overs.
import type { DeliveryType } from './delivery.ts'
import type { ShotType } from './shots.ts'
import type { PitchType, TimeOfDay } from './conditions.ts'
import { surname, type Team } from './teams.ts'
import { V3 } from './vec.ts'

export type MatchFormat = 't20' | 't10' | 'blitz' | 'super'
export type ExtraType = 'none' | 'wide' | 'noball' | 'bye' | 'legbye'
export type Dismissal = 'none' | 'bowled' | 'caught' | 'lbw' | 'runout' | 'stumped' | 'hitwicket'
export type Difficulty = 0 | 1 | 2

export const DISMISSAL_NAMES: Record<Dismissal, string> = { none: '', bowled: 'Bowled', caught: 'Caught', lbw: 'LBW', runout: 'Run out', stumped: 'Stumped', hitwicket: 'Hit wicket' }

export interface FormatRules {
  format: MatchFormat
  overs: number
  maxOversPerBowler: number
  powerplayOvers: number
  maxOutsidePowerplay: number
  maxOutside: number
  reviews: number
  bouncersPerOver: number
  maxWickets: number
}

export const FORMATS: Record<MatchFormat, { label: string; blurb: string }> = {
  t20: { label: 'T20', blurb: '20 overs a side, powerplay for the first 6. The default.' },
  t10: { label: 'T10', blurb: 'A quick 10-over thrash: about 25 minutes.' },
  blitz: { label: '5-over Blitz', blurb: 'Five overs each. Swing from ball one.' },
  super: { label: 'Super Over', blurb: 'One over each, two wickets: the tie-breaker on its own.' },
}

export function rulesFor(f: MatchFormat): FormatRules {
  switch (f) {
    case 't10':
      return { format: f, overs: 10, maxOversPerBowler: 2, powerplayOvers: 3, maxOutsidePowerplay: 2, maxOutside: 5, reviews: 1, bouncersPerOver: 1, maxWickets: 10 }
    case 'blitz':
      return { format: f, overs: 5, maxOversPerBowler: 1, powerplayOvers: 2, maxOutsidePowerplay: 2, maxOutside: 5, reviews: 1, bouncersPerOver: 1, maxWickets: 10 }
    case 'super':
      return superOverRules()
    default:
      return { format: 't20', overs: 20, maxOversPerBowler: 4, powerplayOvers: 6, maxOutsidePowerplay: 2, maxOutside: 5, reviews: 2, bouncersPerOver: 1, maxWickets: 10 }
  }
}
export const superOverRules = (): FormatRules => ({ format: 'super', overs: 1, maxOversPerBowler: 1, powerplayOvers: 0, maxOutsidePowerplay: 5, maxOutside: 5, reviews: 1, bouncersPerOver: 1, maxWickets: 2 })

export interface BatterCard {
  player: number
  runs: number
  balls: number
  fours: number
  sixes: number
  batted: boolean
  out: boolean
  how: Dismissal
  bowler: number
  fielder: number
}

export interface BowlerCard {
  player: number
  balls: number
  runs: number
  wickets: number
  maidens: number
  wides: number
  noBalls: number
  dots: number
  overRuns: number
}

export interface BallRecord {
  over: number
  ball: number
  bowler: number
  striker: number
  runs: number
  extras: number
  extra: ExtraType
  wicket: boolean
  how: Dismissal
  four: boolean
  six: boolean
  pitched: [number, number, number]
  end: [number, number, number]
  kmh: number
  delivery: DeliveryType
  shot: ShotType
  strikerEnd: number
  leftHand: boolean
  /** Innings total after this ball (for the worm). */
  total: number
}

export const ballSymbol = (b: BallRecord) =>
  b.wicket
    ? 'W'
    : b.extra === 'wide'
      ? b.extras > 1
        ? `${b.extras}wd`
        : 'wd'
      : b.extra === 'noball'
        ? b.runs > 0
          ? `${b.runs}nb`
          : 'nb'
        : b.extra === 'bye'
          ? `${b.extras}b`
          : b.extra === 'legbye'
            ? `${b.extras}lb`
            : b.runs === 0
              ? '•'
              : String(b.runs)

export interface FallOfWicket {
  runs: number
  wicket: number
  player: number
  overs: string
}

export interface Innings {
  battingTeam: number
  runs: number
  wickets: number
  legalBalls: number
  byes: number
  legByes: number
  wides: number
  noBalls: number
  target: number
  striker: number
  nonStriker: number
  bowler: number
  lastOverBowler: number
  nextBatter: number
  strikerEnd: number
  batReviews: number
  bowlReviews: number
  freeHit: boolean
  bouncersThisOver: number
  partnershipRuns: number
  partnershipBalls: number
  complete: boolean
  superOver: boolean
  batting: BatterCard[]
  bowling: BowlerCard[]
  log: BallRecord[]
  fow: FallOfWicket[]
}

export const extrasOf = (i: Innings) => i.byes + i.legByes + i.wides + i.noBalls
export const oversText = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`
export const runRate = (i: Innings) => (i.legalBalls > 0 ? (i.runs * 6) / i.legalBalls : 0)
export const bowlingEnd = (i: Innings) => 1 - i.strikerEnd
export const cardOf = (i: Innings, player: number) => i.batting.find((b) => b.player === player)
export function bowlerCard(i: Innings, player: number) {
  let c = i.bowling.find((b) => b.player === player)
  if (!c) {
    c = { player, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0, dots: 0, overRuns: 0 }
    i.bowling.push(c)
  }
  return c
}
export const scoreText = (i: Innings) => (i.wickets >= 10 ? `${i.runs}` : `${i.runs}/${i.wickets}`)

/** What happened on one ball. */
export interface BallOutcome {
  runsBat: number
  runsRun: number
  extra: ExtraType
  extraRuns: number
  four: boolean
  six: boolean
  wicket: boolean
  how: Dismissal
  strikerOut: boolean
  fielder: number
  pitched: V3
  end: V3
  kmh: number
  delivery: DeliveryType
  shot: ShotType
  strikerEnd: number
  leftHand: boolean
}

export const emptyOutcome = (): BallOutcome => ({ runsBat: 0, runsRun: 0, extra: 'none', extraRuns: 0, four: false, six: false, wicket: false, how: 'none', strikerOut: true, fielder: -1, pitched: new V3(), end: new V3(), kmh: 0, delivery: 'seam', shot: 'leave', strikerEnd: 1, leftHand: false })

export interface MatchSetup {
  format: MatchFormat
  difficulty: Difficulty
  pitch: PitchType
  time: TimeOfDay
  superOverOnTie: boolean
  seed: number
  teams: [Team, Team]
  online: boolean
}

export class MatchState {
  setup: MatchSetup
  rules: FormatRules
  innings: Innings[] = []
  tossWinner = -1
  tossWinnerBats = true
  finished = false
  winner = -1
  result = ''
  superOvers = 0

  constructor(setup: MatchSetup) {
    this.setup = setup
    this.rules = rulesFor(setup.format)
  }

  get current(): Innings {
    return this.innings[this.innings.length - 1]
  }
  get batting() {
    return this.setup.teams[this.current.battingTeam]
  }
  get fielding() {
    return this.setup.teams[1 - this.current.battingTeam]
  }
  get inSuperOver() {
    return !!this.current?.superOver
  }
  get activeRules() {
    return this.inSuperOver ? superOverRules() : this.rules
  }

  startInnings(battingTeam: number, superOver = false) {
    const rules = superOver ? superOverRules() : this.rules
    const team = this.setup.teams[battingTeam]
    const order = team.players.map((_, i) => i)
    if (superOver) order.sort((a, b) => team.players[b].batting - team.players[a].batting)
    const inn: Innings = {
      battingTeam,
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      byes: 0,
      legByes: 0,
      wides: 0,
      noBalls: 0,
      target: -1,
      striker: order[0],
      nonStriker: order[1],
      bowler: -1,
      lastOverBowler: -1,
      nextBatter: 2,
      strikerEnd: 1,
      batReviews: rules.reviews,
      bowlReviews: rules.reviews,
      freeHit: false,
      bouncersThisOver: 0,
      partnershipRuns: 0,
      partnershipBalls: 0,
      complete: false,
      superOver,
      batting: order.map((p) => ({ player: p, runs: 0, balls: 0, fours: 0, sixes: 0, batted: false, out: false, how: 'none', bowler: -1, fielder: -1 })),
      bowling: [],
      log: [],
      fow: [],
    }
    inn.batting[0].batted = inn.batting[1].batted = true
    if (this.innings.length > 0) {
      const prev = this.current
      if (prev.superOver === superOver && prev.target < 0) inn.target = prev.runs + 1
    }
    this.innings.push(inn)
    return inn
  }

  maxWickets(team: number) {
    return Math.min(this.activeRules.maxWickets, this.setup.teams[team].players.length - 1)
  }

  /** Records one ball: strike, bowler figures, extras, wickets and partnership. */
  apply(o: BallOutcome) {
    const inn = this.current
    const bowler = bowlerCard(inn, inn.bowler)
    const striker = cardOf(inn, inn.striker)!
    const legal = o.extra !== 'wide' && o.extra !== 'noball'
    const freeHit = inn.freeHit
    const penalty = o.extra === 'wide' || o.extra === 'noball' ? 1 : 0
    const total = o.runsBat + o.extraRuns + penalty
    inn.runs += total
    inn.partnershipRuns += total
    switch (o.extra) {
      case 'wide':
        inn.wides += 1 + o.extraRuns
        bowler.wides++
        break
      case 'noball':
        inn.noBalls += 1
        inn.byes += o.extraRuns
        bowler.noBalls++
        break
      case 'bye':
        inn.byes += o.extraRuns
        break
      case 'legbye':
        inn.legByes += o.extraRuns
        break
    }
    const conceded = o.runsBat + (o.extra === 'wide' ? 1 + o.extraRuns : 0) + (o.extra === 'noball' ? 1 : 0)
    bowler.runs += conceded
    bowler.overRuns += conceded
    if (o.extra !== 'wide') {
      striker.balls++
      striker.runs += o.runsBat
      if (o.four) striker.fours++
      if (o.six) striker.sixes++
      inn.partnershipBalls++
    }
    if (legal) {
      inn.legalBalls++
      bowler.balls++
      if (total === 0) bowler.dots++
    }
    const rec: BallRecord = {
      over: Math.floor((inn.legalBalls - (legal ? 1 : 0)) / 6),
      ball: legal ? ((inn.legalBalls - 1) % 6) + 1 : inn.legalBalls % 6,
      bowler: inn.bowler,
      striker: inn.striker,
      runs: o.runsBat,
      extras: o.extraRuns + penalty,
      extra: o.extra,
      wicket: false,
      how: 'none',
      four: o.four,
      six: o.six,
      pitched: o.pitched.toArray(2),
      end: o.end.toArray(1),
      kmh: Math.round(o.kmh),
      delivery: o.delivery,
      shot: o.shot,
      strikerEnd: o.strikerEnd,
      leftHand: o.leftHand,
      total: inn.runs,
    }
    let wicket = o.wicket && (!freeHit || o.how === 'runout')
    if (o.wicket && o.extra === 'wide' && o.how !== 'stumped' && o.how !== 'runout' && o.how !== 'hitwicket') wicket = false
    if (o.wicket && o.extra === 'noball' && o.how !== 'runout') wicket = false
    let outPlayer = -1
    if (wicket) {
      rec.wicket = true
      rec.how = o.how
      outPlayer = o.strikerOut ? inn.striker : inn.nonStriker
      const card = cardOf(inn, outPlayer)!
      card.out = true
      card.how = o.how
      card.bowler = o.how === 'runout' ? -1 : inn.bowler
      card.fielder = o.fielder
      if (o.how !== 'runout') bowler.wickets++
      inn.wickets++
      inn.fow.push({ runs: inn.runs, wicket: inn.wickets, player: outPlayer, overs: oversText(inn.legalBalls) })
      inn.partnershipRuns = inn.partnershipBalls = 0
    }
    inn.log.push(rec)

    let ran = o.four || o.six ? 0 : o.extra === 'wide' || o.extra === 'bye' || o.extra === 'legbye' ? o.extraRuns : o.runsRun
    if (o.extra === 'noball' && !(o.four || o.six)) ran = Math.max(o.runsRun, o.extraRuns)
    if (ran % 2 === 1) swap(inn)

    if (wicket) {
      const allOut = inn.wickets >= this.maxWickets(inn.battingTeam)
      if (!allOut && inn.nextBatter < inn.batting.length) {
        const next = inn.batting[inn.nextBatter++]
        next.batted = true
        if (inn.striker === outPlayer) inn.striker = next.player
        else inn.nonStriker = next.player
        // After a catch the new batter is on strike.
        if (o.how === 'caught' && inn.striker !== next.player) swap(inn)
      }
    }
    inn.freeHit = o.extra === 'noball'
    if (legal && inn.legalBalls % 6 === 0) this.endOver(inn)
    this.checkComplete()
    return rec
  }

  private endOver(inn: Innings) {
    const bowler = bowlerCard(inn, inn.bowler)
    if (bowler.overRuns === 0 && bowler.balls % 6 === 0) bowler.maidens++
    bowler.overRuns = 0
    inn.lastOverBowler = inn.bowler
    inn.bowler = -1
    inn.bouncersThisOver = 0
    swap(inn)
    inn.strikerEnd = 1 - inn.strikerEnd
  }

  checkComplete() {
    const inn = this.current
    if (inn.wickets >= this.maxWickets(inn.battingTeam) || inn.legalBalls >= this.activeRules.overs * 6 || (inn.target > 0 && inn.runs >= inn.target)) inn.complete = true
  }

  get ballsLeft() {
    return this.activeRules.overs * 6 - this.current.legalBalls
  }
  get runsNeeded() {
    return this.current.target > 0 ? this.current.target - this.current.runs : 0
  }
  get requiredRate() {
    return this.current.target > 0 && this.ballsLeft > 0 ? (this.runsNeeded * 6) / this.ballsLeft : 0
  }
  get isPowerplay() {
    return !this.inSuperOver && Math.floor(this.current.legalBalls / 6) < this.rules.powerplayOvers
  }

  /** After an innings: what comes next. Returns null when the match is over. */
  nextInnings(): { battingTeam: number; superOver: boolean } | null {
    const inn = this.current
    let battingTeam = 1 - inn.battingTeam
    let superOver = inn.superOver
    if (inn.target <= 0) return { battingTeam, superOver }
    const a = inn.battingTeam
    const b = 1 - a
    const names = this.setup.teams.map((t) => t.name)
    if (inn.runs >= inn.target) {
      const wk = this.maxWickets(a) - inn.wickets
      const bl = this.ballsLeft
      this.finish(a, inn.superOver ? `${names[a]} win the Super Over` : `${names[a]} won by ${wk} wicket${wk === 1 ? '' : 's'} (${bl} ball${bl === 1 ? '' : 's'} left)`)
      return null
    }
    if (inn.runs === inn.target - 1) {
      if (this.setup.superOverOnTie && this.superOvers < 3) {
        this.superOvers++
        battingTeam = inn.battingTeam
        superOver = true
        return { battingTeam, superOver }
      }
      this.finish(-1, 'Match tied')
      return null
    }
    const margin = inn.target - 1 - inn.runs
    this.finish(b, inn.superOver ? `${names[b]} win the Super Over` : `${names[b]} won by ${margin} run${margin === 1 ? '' : 's'}`)
    return null
  }

  private finish(winner: number, text: string) {
    this.finished = true
    this.winner = winner
    this.result = text
  }

  dismissalText(inn: Innings, c: BatterCard) {
    if (!c.batted) return ''
    if (!c.out) return 'not out'
    const bowl = this.setup.teams[1 - inn.battingTeam]
    const B = (i: number) => (i >= 0 && i < bowl.players.length ? surname(bowl.players[i]) : '?')
    switch (c.how) {
      case 'bowled':
        return `b ${B(c.bowler)}`
      case 'caught':
        return c.fielder === c.bowler ? `c & b ${B(c.bowler)}` : `c ${c.fielder === bowl.keeper ? '†' : ''}${B(c.fielder)} b ${B(c.bowler)}`
      case 'lbw':
        return `lbw b ${B(c.bowler)}`
      case 'stumped':
        return `st †${B(c.fielder)} b ${B(c.bowler)}`
      case 'hitwicket':
        return `hit wicket b ${B(c.bowler)}`
      case 'runout':
        return `run out (${B(c.fielder)})`
      default:
        return 'out'
    }
  }

  /** Symbols for the balls of the current (or just finished) over. */
  thisOver(): string[] {
    const inn = this.current
    if (!inn) return []
    let over = Math.floor(inn.legalBalls / 6)
    if (inn.legalBalls > 0 && inn.legalBalls % 6 === 0 && inn.bowler < 0) over--
    return inn.log.filter((b) => b.over === over).map(ballSymbol)
  }
}

function swap(inn: Innings) {
  const t = inn.striker
  inn.striker = inn.nonStriker
  inn.nonStriker = t
}
