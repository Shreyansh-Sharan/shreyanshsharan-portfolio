// CPU cricketers. Batting: reads the delivery (with errors that grow with pace, movement and lower skill), picks a
// stroke from line, length and the match situation, aims for gaps, times it with difficulty-based error and calls
// the runs. Bowling: picks the bowler, sets the field for the phase of the innings and mixes up deliveries.
import type { Director } from './director.ts'
import { DELIVERIES, deliveriesFor, isSpinStyle, type DeliveryType } from './delivery.ts'
import { naturalFeet, shotSpec, type ShotInput, type ShotType } from './shots.ts'
import { Geo } from './geo.ts'
import { step, DT, cloneBall } from './ball.ts'
import type { FieldPreset } from './fields.ts'
import { bat01, bowl01, canBowl, type Player } from './teams.ts'
import { clamp, clamp01, deltaAngle, invLerp, lerp, Rng, V3 } from './vec.ts'

/* ---------------- batting ---------------- */

/** 0 = blocking it out, 1 = all-out attack. */
export function aggression(d: Director) {
  const st = d.state
  const inn = st.current
  const rules = st.activeRules
  const ballsLeft = st.ballsLeft
  const wkLeft = st.maxWickets(inn.battingTeam) - inn.wickets
  let a: number
  if (inn.target > 0) {
    const rrr = st.requiredRate
    a = invLerp(6, 14, rrr)
    if (ballsLeft < 18) a = Math.max(a, invLerp(4, 9, rrr))
  } else {
    const progress = inn.legalBalls / (rules.overs * 6)
    a = st.isPowerplay ? 0.5 : progress > 0.7 ? 0.8 : 0.38
    if (rules.overs <= 5) a += 0.25
  }
  if (st.inSuperOver) a = 0.95
  a -= clamp01((4 - wkLeft) / 4) * 0.35 * clamp01(ballsLeft / 24)
  const card = inn.batting.find((b) => b.player === inn.striker)
  if (card && card.balls < 4) a -= 0.12
  return clamp01(a)
}

export function wantsToCharge(d: Director, rng: Rng) {
  const bowler = d.fieldingTeam.players[d.state.current.bowler]
  if (!isSpinStyle(bowler.bowl)) return false
  return rng.chance(0.06 + aggression(d) * 0.12)
}

function predictHitsStumps(d: Director) {
  const s = cloneBall(d.ball)
  const f = d.frame
  let prev = s.pos.clone()
  for (let i = 0; i < 1200; i++) {
    step(s, d.env, DT)
    const a = f.offsetFwd(prev)
    const b = f.offsetFwd(s.pos)
    if (a >= 0 && b < 0) {
      const at = prev.lerp(s.pos, a / Math.max(1e-5, a - b))
      return Math.abs(f.offsetOff(at)) < Geo.StumpsHalfWidth + 0.06 && at.y < Geo.StumpHeight + 0.05
    }
    prev = s.pos.clone()
  }
  return false
}

function preferredAim(t: ShotType, u: number) {
  switch (t) {
    case 'drive':
      return u > 0.3 ? 45 : u > 0.05 ? 15 : -15
    case 'cut':
      return 100
    case 'pull':
      return -75
    case 'sweep':
      return -95
    case 'flick':
      return -55
    default:
      return 0
  }
}

/** A direction within [min,max] away from fielders (deep ones for lofts, ring ones for ground shots). */
function findGap(d: Director, min: number, max: number, loft: boolean, preferred: number, rng: Rng) {
  const f = d.frame
  const angles: number[] = []
  for (const a of d.fielders()) {
    if (!a.visible || a.kind === 'keeper' || a.kind === 'bowler') continue
    const dist = a.pos.flatDist(f.origin)
    if (loft ? dist < 40 : dist > 40) continue
    angles.push(f.angleOf(a.pos))
  }
  let best = preferred
  let bestScore = -Infinity
  for (let ang = min; ang <= max; ang += 4) {
    let nearest = 180
    for (const x of angles) nearest = Math.min(nearest, Math.abs(deltaAngle(ang, x)))
    const score = nearest - Math.abs(ang - preferred) * 0.25 + rng.range(0, 4)
    if (score > bestScore) {
      bestScore = score
      best = ang
    }
  }
  return best
}

/** Decides the CPU batter's shot as the ball is released and queues it for the right moment. */
export function decideShot(d: Director, rng: Rng) {
  const inn = d.state.current
  const batter = d.battingTeam.players[inn.striker]
  const skill = bat01(batter)
  const agg = aggression(d)
  const diff = d.state.setup.difficulty
  const f = d.frame
  const spin = DELIVERIES[d.plan.type].spin
  const length = d.pitchedLength()
  const noise = lerp(0.18, 0.06, skill) * (diff === 0 ? 1.3 : diff === 2 ? 0.75 : 1)
  let natural = naturalFeet(length, spin)
  if (d.charging) natural = 'charge'
  const at = d.crossPoint(natural)
  let u = f.offsetOff(at) - d.guard + rng.gauss() * noise
  const h = at.y + rng.gauss() * noise
  const perceivedLen = length < 0 ? -1 : length + rng.gauss() * noise * 4
  if ((d.plan.type === 'googly' || d.plan.type === 'armball') && rng.chance(0.45 - skill * 0.3)) u -= 0.18 * (d.plan.type === 'googly' ? -1 : 1)

  const onStumps = predictHitsStumps(d)
  const input: ShotInput = { type: 'auto', feet: natural, aim: 0, loft: false, played: true, timingError: 0, power: 0 }
  const wide = u > 0.75
  const short = perceivedLen > 7.5
  const full = (perceivedLen >= 0 && perceivedLen < 4.8) || perceivedLen < 0

  if (wide && !onStumps && agg < 0.65 && rng.chance(0.75)) input.type = 'leave'
  else if (onStumps && !full && !short && agg < 0.45 + skill * 0.1 && rng.chance(0.7)) {
    input.type = 'defend'
    input.aim = rng.range(-20, 20)
  } else if (h > 1.6 && agg < 0.5) input.type = 'leave'
  else {
    if (short && h > 0.8) input.type = u > 0.35 ? 'cut' : 'pull'
    else if (short && u > 0.35) input.type = 'cut'
    else if (u < -0.15) input.type = 'flick'
    else if (spin && full && agg > 0.5 && rng.chance(0.3)) input.type = 'sweep'
    else input.type = 'drive'
    input.loft = agg > 0.4 && rng.chance((agg - 0.3) * 0.85)
    if (!input.loft && rng.chance(lerp(0.55, 0.1, agg))) input.power = rng.range(0.4, 0.65)
    const spec = shotSpec(input.type)
    input.aim = findGap(d, spec.dirMin, spec.dirMax, input.loft, preferredAim(input.type, u), rng)
    if (input.type === 'sweep' || input.type === 'drive') input.feet = 'front'
    if (input.type === 'cut' || input.type === 'pull') input.feet = 'back'
    if (d.charging) input.feet = 'charge'
  }
  if (input.feet !== 'charge' && rng.chance(0.08 * (1.2 - skill))) input.feet = input.feet === 'front' ? 'back' : 'front'

  let sigma = (diff === 0 ? 0.055 : diff === 2 ? 0.03 : 0.042) * (1.35 - 0.55 * skill)
  const pace = d.plan.speedKmh / 3.6
  sigma *= Math.sqrt(Math.max(0.6, pace / 30))
  input.timingError = input.type === 'leave' ? 0 : rng.gauss() * sigma
  const lead = shotSpec(input.type === 'leave' ? 'defend' : input.type).lead
  let tCross = d.crossTime(input.feet)
  if (tCross < 0) tCross = d.crossTime('auto')
  d.queueAiShot(input, Math.max(0.05, tCross - lead + input.timingError))
}

/** Calls for (or refuses) runs while the ball is in play. */
export function runningCalls(d: Director) {
  if (d.phase !== 'live' || d.caught) return
  if (d.striker.pose === 'shot' && d.striker.poseTime < 0.45) return
  const agg = aggression(d)
  if (d.boundaryLikely()) {
    if (!d.anyRunning && d.liveTime > 0.5) d.callRun()
    return
  }
  if (d.isAirCatchChance()) return
  const tBall = d.estimatedReturnTime()
  if (!d.anyRunning) {
    if (d.liveTime < 0.45) return
    const startOfFirst = d.runners[0].atEnd === d.state.current.strikerEnd
    const tRun = d.runTimeEstimate()
    const threshold = lerp(0.6, 0.05, agg) + (startOfFirst ? 0 : 0.35) + (d.heldBy ? 0.3 : 0)
    if (tBall - tRun > threshold) d.callRun()
  } else {
    for (let k = 0; k < 2; k++) {
      const t = d.runnerTimeToGround(k)
      if (t < 0) continue
      if (d.heldBy && tBall < t - 0.4 && d.runnerProgress(k) < 0.35) {
        d.callBack()
        return
      }
      if (t < 0.5 && tBall < t + 0.6) d.slideBat()
    }
  }
}

/* ---------------- bowling ---------------- */

const progressOf = (d: Director) => d.state.current.legalBalls / Math.max(6, d.state.activeRules.overs * 6)
const isDeath = (d: Director) => progressOf(d) >= 0.7 || d.state.inSuperOver

export function chooseBowler(d: Director, rng: Rng) {
  const eligible = d.eligibleBowlers()
  const team = d.fieldingTeam
  const inn = d.state.current
  let best = eligible[0]
  let bestScore = -Infinity
  const death = isDeath(d)
  const powerplay = d.state.isPowerplay
  let twoAgo = -1
  const over = Math.floor(inn.legalBalls / 6) - 2
  const rec = inn.log.find((b) => b.over === over)
  if (rec) twoAgo = rec.bowler
  for (const i of eligible) {
    const p = team.players[i]
    const spin = isSpinStyle(p.bowl)
    let score = p.bowling
    if (!canBowl(p)) score -= 40
    if ((powerplay || death) && !spin) score += 12
    if (!powerplay && !death && spin) score += 10
    if (d.state.setup.pitch === 'dusty' && spin) score += 10
    if (d.state.setup.pitch === 'green' && !spin) score += 8
    if (i === twoAgo) score += 6
    const fielder = d.fielderFor(i)
    if (fielder) score -= (100 - fielder.stamina) * 0.3
    const card = inn.bowling.find((b) => b.player === i)
    if (card && card.balls >= 6) score -= ((card.runs * 6) / card.balls - 7.5) * 2 - card.wickets * 3
    score += rng.range(0, 5)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

export function choosePreset(d: Director, bowler: Player): FieldPreset {
  const spin = isSpinStyle(bowler.bowl)
  const st = d.state
  if (isDeath(d)) return 'death'
  if (st.isPowerplay) return spin ? 'normal' : 'attacking'
  if (st.current.target > 0) {
    const rrr = st.requiredRate
    if (rrr > 10) return spin ? 'spin' : 'attacking'
    if (rrr < 6) return 'defensive'
  }
  return spin && st.setup.pitch === 'dusty' ? 'spin' : 'normal'
}

export function chooseDelivery(d: Director, rng: Rng): { type: DeliveryType; target: V3; around: boolean } {
  const bowler = d.fieldingTeam.players[d.state.current.bowler]
  const types = deliveriesFor(bowler.bowl)
  const f = d.frame
  const death = isDeath(d)
  const ballAge = d.state.current.legalBalls / 6
  const weights = types.map((t): number => {
    switch (t) {
      case 'seam':
        return 3
      case 'outswing':
        return ballAge < 10 ? 2.5 : 1
      case 'inswing':
        return ballAge < 10 ? 1.8 : 0.8
      case 'bouncer':
        return d.state.current.bouncersThisOver < d.state.activeRules.bouncersPerOver ? (death ? 1.2 : 0.8) : 0
      case 'yorker':
        return death ? 3.5 : 0.5
      case 'slower':
        return death ? 2.2 : 0.6
      case 'offbreak':
      case 'legbreak':
        return 4
      case 'armball':
        return 1
      case 'googly':
        return 1.4
      case 'topspinner':
        return 0.8
      default:
        return 1
    }
  })
  let pickW = rng.range(0, weights.reduce((a, b) => a + b, 0))
  let type = types[0]
  for (let i = 0; i < types.length; i++) {
    pickW -= weights[i]
    if (pickW <= 0) {
      type = types[i]
      break
    }
  }
  const spec = DELIVERIES[type]
  const diff = d.state.setup.difficulty
  const diffNoise = diff === 0 ? 1.4 : diff === 2 ? 0.7 : 1
  const length = spec.defaultLength + rng.gauss() * 0.5 * diffNoise
  let line: number
  switch (type) {
    case 'yorker':
      line = rng.chance(death ? 0.3 : 0.1) ? 0.7 : 0.02
      break
    case 'bouncer':
      line = -0.1
      break
    case 'outswing':
      line = 0.22
      break
    case 'inswing':
      line = 0.05
      break
    case 'legbreak':
      line = 0.05
      break
    case 'offbreak':
      line = 0.32
      break
    default:
      line = 0.15
  }
  line += rng.gauss() * 0.08 * diffNoise
  const around = isSpinStyle(bowler.bowl) && rng.chance(0.08)
  return { type, target: f.local(line, length), around }
}

export function releaseError(d: Director, bowler: Player, rng: Rng) {
  const diff = d.state.setup.difficulty
  let sigma = diff === 0 ? 0.75 : diff === 2 ? 0.32 : 0.5
  sigma *= 1.3 - 0.6 * bowl01(bowler)
  const fielder = d.fielderFor(d.state.current.bowler)
  if (fielder) sigma *= lerp(1.25, 1, fielder.stamina / 100)
  return clamp(rng.gauss() * sigma, -1.1, 1.1)
}
