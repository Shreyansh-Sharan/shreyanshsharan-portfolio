// Real dimensions of the ground and the ball (metres, kilograms). The pitch runs along z with its centre at the
// origin: end 0's stumps at z = -10.06, end 1's at z = +10.06.
import { DEG, V3 } from './vec.ts'

export const Geo = {
  PitchLength: 20.12, // stumps to stumps (22 yards)
  HalfPitch: 10.06,
  PitchWidth: 3.05,
  CreaseDepth: 1.22, // popping crease in front of the stumps
  ReturnCreaseHalf: 1.32,
  StumpHeight: 0.711,
  StumpsHalfWidth: 0.1143,
  StumpRadius: 0.0175,
  BailHeight: 0.013,
  BallRadius: 0.036,
  BallMass: 0.16,
  BallArea: Math.PI * 0.036 * 0.036,
  BoundarySquare: 63, // rope distance from the centre of the pitch, square (x)
  BoundaryStraight: 68, // ... and down the ground (z)
  InnerCircle: 27.43,
  WideLineOff: 0.9,
  WideLineLeg: 0.2,
} as const

export const stumpsZ = (end: number) => (end === 0 ? -Geo.HalfPitch : Geo.HalfPitch)
/** Unit direction (z) from this end's stumps towards the other end. */
export const inward = (end: number) => (end === 0 ? 1 : -1)
export const poppingZ = (end: number) => stumpsZ(end) + inward(end) * Geo.CreaseDepth
export const stumpsAt = (end: number) => new V3(0, 0, stumpsZ(end))

/** Whether a ground point is on the prepared pitch. */
export const onPitch = (p: V3) => Math.abs(p.x) < Geo.PitchWidth * 0.5 && Math.abs(p.z) < Geo.HalfPitch + Geo.CreaseDepth + 0.6

/** How far past the rope a point is (positive outside). The boundary is an ellipse. */
export function beyondRope(p: V3, inset = 0) {
  const a = Geo.BoundarySquare - inset
  const b = Geo.BoundaryStraight - inset
  const k = Math.sqrt((p.x * p.x) / (a * a) + (p.z * p.z) / (b * b))
  const t = Math.abs(p.z) / (Math.abs(p.x) + Math.abs(p.z) + 0.001)
  return (k - 1) * (a + (b - a) * t)
}

export const ropePoint = (angle: number, inset = 0) => new V3(Math.sin(angle) * (Geo.BoundarySquare - inset), 0, Math.cos(angle) * (Geo.BoundaryStraight - inset))

export function insideCircle(p: V3) {
  const dz = Math.max(0, Math.abs(p.z) - Geo.HalfPitch)
  return p.x * p.x + dz * dz <= Geo.InnerCircle * Geo.InnerCircle
}

/**
 * A frame centred on a set of stumps, looking down the pitch, with `off` pointing to the batter's off side.
 * Angles: 0 straight down the ground, +90 square on the off side (point), 180 the keeper, -90 square leg.
 */
export class BatFrame {
  origin: V3
  fwd: V3
  off: V3
  constructor(origin: V3, fwd: V3, off: V3) {
    this.origin = origin
    this.fwd = fwd
    this.off = off
  }
  static for(strikerEnd: number, rightHanded: boolean) {
    const fwd = new V3(0, 0, inward(strikerEnd))
    const right = new V3(fwd.z, 0, -fwd.x)
    return new BatFrame(stumpsAt(strikerEnd), fwd, rightHanded ? right : right.mul(-1))
  }
  polar(angleDeg: number, dist: number) {
    const a = angleDeg * DEG
    return this.origin.add(this.fwd.mul(Math.cos(a)).add(this.off.mul(Math.sin(a))).mul(dist))
  }
  local(off: number, fwd: number, up = 0) {
    return new V3(this.origin.x + this.off.x * off + this.fwd.x * fwd, up, this.origin.z + this.off.z * off + this.fwd.z * fwd)
  }
  angleOf(p: V3) {
    const d = p.sub(this.origin)
    return Math.atan2(d.dot(this.off), d.dot(this.fwd)) / DEG
  }
  direction(angleDeg: number) {
    const a = angleDeg * DEG
    return this.fwd.mul(Math.cos(a)).add(this.off.mul(Math.sin(a)))
  }
  offsetOff(p: V3) {
    return (p.x - this.origin.x) * this.off.x + (p.z - this.origin.z) * this.off.z
  }
  offsetFwd(p: V3) {
    return (p.x - this.origin.x) * this.fwd.x + (p.z - this.origin.z) * this.fwd.z
  }
}
