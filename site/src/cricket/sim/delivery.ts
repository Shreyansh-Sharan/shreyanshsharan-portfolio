// Delivery types and the solver that releases the ball so it lands on the bowler's marker.
import { inward, stumpsAt } from './geo.ts'
import type { Env } from './conditions.ts'
import { DEG, clamp, lerp, Rng, V3 } from './vec.ts'
import { newBall, step, swingCoefficient, DT, type BallState } from './ball.ts'

export type BowlStyle = 'fast' | 'swing' | 'medium' | 'offspin' | 'legspin'
export type DeliveryType =
  | 'seam' | 'inswing' | 'outswing' | 'offcutter' | 'legcutter' | 'bouncer' | 'yorker' | 'slower'
  | 'offbreak' | 'doosra' | 'armball' | 'legbreak' | 'googly' | 'topspinner' | 'slider'

export interface DeliverySpec {
  type: DeliveryType
  name: string
  short: string
  speedFactor: number
  /** Default landing distance from the batter's stumps (m). */
  defaultLength: number
  /** +1 swings away from the batter (to the off side), -1 into him. */
  swing: number
  seam: number
  revs: number
  /** Turn direction in the bowler's frame: +1 turns to the bowler's right (a right-armer's off-break). */
  brk: number
  sideSpin: number
  topSpin: number
  spin: boolean
  /** One line for the HUD: what the ball does. */
  blurb: string
}

const D = (o: Omit<DeliverySpec, 'swing' | 'brk' | 'sideSpin' | 'spin' | 'blurb'> & Partial<DeliverySpec>): DeliverySpec => ({ swing: 0, brk: 0, sideSpin: 0, spin: false, blurb: '', ...o })

export const DELIVERIES: Record<DeliveryType, DeliverySpec> = {
  seam: D({ type: 'seam', name: 'Seam up', short: 'SEAM', speedFactor: 1, defaultLength: 6.5, seam: 1.3, revs: 18, topSpin: -1, blurb: 'Upright seam: nips either way off the pitch' }),
  inswing: D({ type: 'inswing', name: 'Inswinger', short: 'IN', speedFactor: 0.98, defaultLength: 5.5, swing: -1, seam: 0.9, revs: 16, topSpin: -1, blurb: 'Curves in to the batter through the air' }),
  outswing: D({ type: 'outswing', name: 'Outswinger', short: 'OUT', speedFactor: 0.98, defaultLength: 5.5, swing: 1, seam: 0.9, revs: 16, topSpin: -1, blurb: 'Curves away towards the slips' }),
  offcutter: D({ type: 'offcutter', name: 'Off-cutter', short: 'OFFC', speedFactor: 0.9, defaultLength: 6.2, seam: 0.5, revs: 11, brk: 1, sideSpin: 0.8, topSpin: -0.4, blurb: 'Fingers down the side: cuts back off the pitch' }),
  legcutter: D({ type: 'legcutter', name: 'Leg-cutter', short: 'LEGC', speedFactor: 0.9, defaultLength: 6.2, seam: 0.5, revs: 11, brk: -1, sideSpin: 0.8, topSpin: -0.4, blurb: 'Cuts away off the seam, like a fast leg-break' }),
  bouncer: D({ type: 'bouncer', name: 'Bouncer', short: 'BNCR', speedFactor: 1.03, defaultLength: 12, seam: 0.8, revs: 20, topSpin: -1, blurb: 'Dug in short at the body: one an over' }),
  yorker: D({ type: 'yorker', name: 'Yorker', short: 'YRKR', speedFactor: 1.01, defaultLength: 1.6, seam: 0.6, revs: 16, topSpin: -1, blurb: 'Full and fast at the base of the stumps' }),
  slower: D({ type: 'slower', name: 'Slower ball', short: 'SLOW', speedFactor: 0.78, defaultLength: 6, seam: 1, revs: 9, topSpin: 0.6, blurb: 'Back of the hand: 30 km/h off, dips late' }),
  offbreak: D({ type: 'offbreak', name: 'Off-break', short: 'OFF', speedFactor: 1, defaultLength: 4.6, revs: 25, brk: 1, sideSpin: 0.8, topSpin: 0.45, spin: true, seam: 0.3, blurb: 'Finger spin: drifts, then turns back in' }),
  doosra: D({ type: 'doosra', name: 'Doosra', short: 'DOOS', speedFactor: 0.98, defaultLength: 4.8, revs: 24, brk: -1, sideSpin: 0.7, topSpin: 0.55, spin: true, seam: 0.3, blurb: "The off-spinner's other one: turns away" }),
  armball: D({ type: 'armball', name: 'Arm ball', short: 'ARM', speedFactor: 1.08, defaultLength: 5, revs: 20, swing: -0.35, sideSpin: 0.1, topSpin: -0.9, spin: true, seam: 0.5, blurb: 'Quicker, skids on with the arm: no turn' }),
  legbreak: D({ type: 'legbreak', name: 'Leg-break', short: 'LEG', speedFactor: 1, defaultLength: 4.8, revs: 28, brk: -1, sideSpin: 0.85, topSpin: 0.4, spin: true, seam: 0.3, blurb: 'Wrist spin: loops, dips and rips away' }),
  googly: D({ type: 'googly', name: 'Googly', short: 'GOOG', speedFactor: 0.97, defaultLength: 4.6, revs: 26, brk: 1, sideSpin: 0.7, topSpin: 0.65, spin: true, seam: 0.3, blurb: 'Out of the back of the hand: turns back in' }),
  topspinner: D({ type: 'topspinner', name: 'Top-spinner', short: 'TOP', speedFactor: 1.02, defaultLength: 5.2, revs: 24, brk: 0, sideSpin: 0.05, topSpin: 0.95, spin: true, seam: 0.3, blurb: 'Over-spin: dips hard and kicks up' }),
  slider: D({ type: 'slider', name: 'Slider', short: 'SLDR', speedFactor: 1.06, defaultLength: 5.2, revs: 20, brk: 0, sideSpin: 0.15, topSpin: -1, spin: true, seam: 0.4, blurb: 'Back-spun and flat: skids on low' }),
}

export const deliveriesFor = (style: BowlStyle): DeliveryType[] =>
  style === 'offspin'
    ? ['offbreak', 'doosra', 'armball', 'topspinner']
    : style === 'legspin'
      ? ['legbreak', 'googly', 'topspinner', 'slider']
      : style === 'swing'
        ? ['outswing', 'inswing', 'seam', 'offcutter', 'legcutter', 'yorker', 'bouncer', 'slower']
        : ['seam', 'outswing', 'inswing', 'offcutter', 'legcutter', 'yorker', 'bouncer', 'slower']

/** Run-up by bowler type: length (m), average speed (m/s), the gather-to-release time of the delivery stride (s)
 *  and how far back the keeper stands (m). */
export function runUpFor(style: BowlStyle) {
  switch (style) {
    case 'fast':
      return { len: 18, speed: 6.4, stride: 0.78, keeper: 17 }
    case 'swing':
      return { len: 14.5, speed: 5.7, stride: 0.74, keeper: 14.5 }
    case 'medium':
      return { len: 12, speed: 5.2, stride: 0.72, keeper: 12 }
    default:
      return { len: 6.2, speed: 3.1, stride: 0.6, keeper: 0.9 }
  }
}

export const isSpinStyle = (s: BowlStyle) => s === 'offspin' || s === 'legspin'

/** Stock release speed (km/h) for a bowler of this style and pace rating (0..1). */
export function stockKmh(style: BowlStyle, pace01: number) {
  switch (style) {
    case 'fast':
      return lerp(136, 150, pace01)
    case 'swing':
      return lerp(124, 138, pace01)
    case 'medium':
      return lerp(120, 134, pace01)
    case 'offspin':
      return lerp(78, 90, pace01)
    default:
      return lerp(74, 88, pace01)
  }
}

export interface DeliveryPlan {
  type: DeliveryType
  style: BowlStyle
  leftArm: boolean
  around: boolean
  /** Aimed landing point (y = 0) before release error. */
  target: V3
  speedKmh: number
  /** Release meter: 0 perfect, +-1 at the edges of the green, beyond 1 overstepped / lost it. NaN = not pressed. */
  releaseError: number
  noBall: boolean
}

export function releasePoint(bowlingEnd: number, leftArm: boolean, around: boolean, spin: boolean) {
  const travel = new V3(0, 0, inward(bowlingEnd))
  const bowlerRight = new V3(travel.z, 0, -travel.x)
  const side = (leftArm ? 1 : -1) * (around ? -1 : 1)
  let wide = spin ? 0.32 : 0.42
  if (around) wide += 0.35
  const p = stumpsAt(bowlingEnd)
    .add(travel.mul(spin ? 0.75 : 0.95))
    .add(bowlerRight.mul(side * wide))
  p.y = spin ? 2.05 : 2.2
  return p
}

/** Seam bowlers who swing it: how much more they get out of the ball than a stock quick. */
export const swingSkill = (style: BowlStyle) => (style === 'swing' ? 1.45 : style === 'medium' ? 1.1 : 1)

/** Whether this release swings late (a perfect release from a skilled seam bowler) rather than from the hand. */
export const swingsLate = (plan: DeliveryPlan, skill01: number) => !DELIVERIES[plan.type].spin && Math.abs(plan.releaseError) < (plan.style === 'swing' ? 0.45 : 0.3) && skill01 > (plan.style === 'swing' ? 0.35 : 0.6)

/**
 * Builds the released ball; the rng rolls the seam jag and bounce jitter now so predictions are exact.
 * The release meter matters: in the green the ball goes where it was aimed (a perfect one swings late), early in the
 * red it is loose (short, wide), late in the red it is a no-ball.
 */
export function releaseBall(plan: DeliveryPlan, bowlingEnd: number, batterOff: V3, ballAgeOvers: number, skill01: number, env: Env, rng: Rng): { ball: BallState; aimed: V3; late: boolean } {
  const spec = DELIVERIES[plan.type]
  const release = releasePoint(bowlingEnd, plan.leftArm, plan.around, spec.spin)
  const travel = new V3(0, 0, inward(bowlingEnd))
  const bowlerRight = new V3(travel.z, 0, -travel.x)
  const topAxis = new V3(travel.z, 0, -travel.x)
  const speed = plan.speedKmh / 3.6
  const s = newBall(release)
  // Better bowlers put more revolutions on it (more drift, dip and turn).
  const w = spec.revs * 2 * Math.PI * lerp(0.82, 1.15, skill01)
  if (spec.spin) {
    const breakSign = spec.brk * (plan.leftArm ? -1 : 1)
    const side = travel.mul(-breakSign * spec.sideSpin * w)
    const top = topAxis.mul(spec.topSpin * w)
    const vertical = new V3(0, -breakSign * 0.2 * w, 0)
    s.spin = side.add(top).add(vertical)
    if (spec.brk === 0) s.spin = topAxis.mul(spec.topSpin * w).add(travel.mul(spec.sideSpin * w * (plan.leftArm ? -1 : 1)))
  } else {
    s.spin = topAxis.mul(spec.topSpin * w)
    // Cutters: the fingers drag down the side of the ball, so it grips and deviates off the pitch like slow spin.
    if (spec.brk !== 0) s.spin = s.spin.add(travel.mul(-spec.brk * (plan.leftArm ? -1 : 1) * spec.sideSpin * w))
  }

  let coef = 0
  const late = swingsLate(plan, skill01)
  if (!spec.spin) {
    coef = swingCoefficient(speed, ballAgeOvers, env.swingFactor, skill01) * swingSkill(plan.style)
    if (spec.swing === 0) coef *= rng.range(-0.35, 0.35) * (spec.brk !== 0 ? 0.4 : 1)
    else coef *= spec.swing
    if (plan.type === 'bouncer' || plan.type === 'yorker') coef *= 0.5
    // A loose release loses the seam position: less swing.
    coef *= lerp(1, 0.45, clamp((Math.abs(plan.releaseError) - 0.5) / 1.2, 0, 1))
  } else if (spec.swing !== 0) coef = 0.08 * spec.swing * env.swingFactor
  s.swingCoef = Math.abs(coef)
  s.swingDir = coef >= 0 ? batterOff.clone() : batterOff.mul(-1)
  s.swingLate = late && s.swingCoef > 0.02 ? 1 : 0

  s.seamKick = rng.gauss() * env.pitch.seamDegrees * spec.seam * DEG * (spec.spin ? 0.5 : 1) * (plan.style === 'medium' ? 1.25 : 1)
  // A cutter grips: a deliberate jag towards the bowler's right (off-cutter from a right-armer) or left, more on a
  // dry or worn surface.
  if (!spec.spin && spec.brk !== 0) s.seamKick += spec.brk * (plan.leftArm ? -1 : 1) * 1.0 * DEG * clamp(env.pitch.spinGrip / 0.65, 0.7, 1.6) * lerp(0.75, 1.15, skill01)
  s.bounceJitter = rng.gauss() * env.pitch.bounceJitter

  const err = clamp(plan.releaseError, -2, 2)
  const spread = lerp(1.4, 0.6, skill01)
  let target = plan.target.clone()
  target = target.add(travel.mul(err * 0.9 * spread + rng.gauss() * 0.25 * spread))
  // Early in the red the arm drags across: the line strays (a wide or a loose one on the pads).
  const stray = plan.releaseError < -1 ? (-plan.releaseError - 1) * 0.55 : 0
  target = target.add(bowlerRight.mul((Math.abs(err) * 0.25 * spread + stray) * (rng.value < 0.5 ? -1 : 1) + rng.gauss() * 0.1 * spread))
  target.y = 0
  s.vel = solveLaunch(s, target, speed, env)
  return { ball: s, aimed: target, late: s.swingLate > 0 }
}

function launchVec(yaw: number, pitch: number, speed: number) {
  const c = Math.cos(pitch)
  return new V3(Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c).mul(speed)
}

function landing(s0: BallState, from: V3, yaw: number, pitch: number, speed: number, env: Env): { at: V3; landed: boolean } {
  const s: BallState = { ...s0, pos: from.clone(), vel: launchVec(yaw, pitch, speed), spin: s0.spin.clone(), swingDir: s0.swingDir.clone(), bounces: 0, pitched: false, time: 0, rolling: false, stopped: false, firstBounce: new V3() }
  for (let i = 0; i < 2000; i++) {
    const r = step(s, env, DT)
    if (r.bounced) return { at: r.bouncePos, landed: true }
  }
  return { at: s.pos, landed: false }
}

/** Finds the launch velocity of the given speed that lands the ball at target (first bounce). */
export function solveLaunch(s: BallState, target: V3, speed: number, env: Env) {
  const from = s.pos.clone()
  const flat = new V3(target.x - from.x, 0, target.z - from.z)
  let yaw = Math.atan2(flat.x, flat.z)
  let pitch = -Math.atan2(from.y, flat.len) * 0.6
  const dPitch = 0.004
  let bestScore = Infinity
  let bestYaw = yaw
  let bestPitch = pitch
  let lastErr = 0
  let lastPitch = 0
  let havePrev = false
  const aimDir = flat.norm()
  for (let iter = 0; iter < 12; iter++) {
    const { at: land, landed } = landing(s, from, yaw, pitch, speed, env)
    const dl = new V3(land.x - from.x, 0, land.z - from.z)
    let rangeErr = flat.sub(dl).dot(aimDir)
    const lineErr = aimDir.cross(target.sub(land)).y
    if (!landed) rangeErr = -5
    // The step size quantises the landing point, so the secant can stall and kick away: keep the best seen.
    const score = Math.abs(rangeErr) + Math.abs(lineErr)
    if (score < bestScore) {
      bestScore = score
      bestYaw = yaw
      bestPitch = pitch
    }
    yaw += lineErr / Math.max(1, dl.len)
    if (havePrev && Math.abs(rangeErr - lastErr) > 1e-4) {
      const slope = (rangeErr - lastErr) / (pitch - lastPitch)
      const next = pitch - rangeErr / slope
      lastErr = rangeErr
      lastPitch = pitch
      pitch = clamp(next, -1.2, 1.2)
    } else {
      lastErr = rangeErr
      lastPitch = pitch
      havePrev = true
      pitch += rangeErr > 0 ? dPitch : -dPitch
    }
    if (Math.abs(rangeErr) < 0.01 && Math.abs(lineErr) < 0.01) break
  }
  return launchVec(bestYaw, bestPitch, speed)
}

