// Pitch and outfield behaviour, wear, time of day and the air.
import { clamp01, V3 } from './vec.ts'

export type PitchType = 'green' | 'flat' | 'dusty'
export type TimeOfDay = 'day' | 'dusk' | 'night'

/** How a surface treats the ball when it lands on it. */
export interface Surface {
  /** Vertical coefficient of restitution. */
  restitution: number
  /** Sliding friction during the impact (grip: drives spin turn and pace loss). */
  friction: number
  /** Random spread of the restitution (uneven bounce). */
  bounceJitter: number
  /** Standard deviation (degrees) of the sideways jag a seam-up ball takes. */
  seamDegrees: number
  /** Fraction of horizontal speed kept after the bounce. */
  paceRetention: number
  /** How well the seam bites sideways (drives spin turn). 0 = outfield. */
  spinGrip: number
}

export function pitchSurface(type: PitchType, wear01 = 0): Surface {
  let s: Surface
  switch (type) {
    case 'green': // grass on it: bouncy, quick, seams around, little turn
      s = { restitution: 0.58, friction: 0.16, bounceJitter: 0.03, seamDegrees: 1.6, paceRetention: 0.99, spinGrip: 0.45 }
      break
    case 'dusty': // dry and cracked: low, slow, grips and turns, uneven
      s = { restitution: 0.47, friction: 0.3, bounceJitter: 0.05, seamDegrees: 0.7, paceRetention: 0.96, spinGrip: 1.25 }
      break
    default: // flat road
      s = { restitution: 0.53, friction: 0.18, bounceJitter: 0.015, seamDegrees: 0.5, paceRetention: 0.99, spinGrip: 0.65 }
  }
  const w = clamp01(wear01)
  s.friction += 0.05 * w
  s.spinGrip += 0.4 * w
  s.bounceJitter += 0.03 * w
  s.restitution -= 0.03 * w
  return s
}

/** The mown outfield: soft, absorbs the bounce quickly. */
export const OUTFIELD: Surface = { restitution: 0.38, friction: 0.5, bounceJitter: 0.04, seamDegrees: 0, paceRetention: 0.97, spinGrip: 0 }

/** Everything about the air and the ground that the ball physics needs. */
export interface Env {
  gravity: number
  airDensity: number
  wind: V3
  /** ~0.85 day, 1.05 dusk, 1.2 under lights. */
  swingFactor: number
  pitch: Surface
  outfield: Surface
  rollingFriction: number
  grassDrag: number
}

export function makeEnv(pitch: PitchType, time: TimeOfDay, wind: V3, wear01 = 0): Env {
  return {
    gravity: 9.81,
    airDensity: 1.2,
    wind: new V3(wind.x, 0, wind.z),
    swingFactor: time === 'day' ? 0.85 : time === 'dusk' ? 1.05 : 1.2,
    pitch: pitchSurface(pitch, wear01),
    outfield: OUTFIELD,
    rollingFriction: 0.1,
    grassDrag: 0.16,
  }
}
