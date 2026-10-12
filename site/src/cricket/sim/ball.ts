// Cricket ball flight and ground contact (a port of the calibrated original):
//  - gravity and quadratic air drag (Cd 0.45) relative to the wind,
//  - conventional/reverse swing as a sideways force from the seam,
//  - Magnus force from spin (drift, dip, lift of a back-spun lofted hit),
//  - bounce with restitution and a friction impulse at the contact point (spin turn, pace loss), capped at rolling,
//  - seam deviation off the pitch, rolling resistance and grass drag on the outfield.
import { Geo, onPitch } from './geo.ts'
import type { Env, Surface } from './conditions.ts'
import { clamp, invLerp, lerp, V3 } from './vec.ts'

export interface BallState {
  pos: V3
  vel: V3
  /** Angular velocity (rad/s). */
  spin: V3
  /** Swing force coefficient; applies along swingDir until the ball first lands or is hit. */
  swingCoef: number
  swingDir: V3
  /** Sideways jag (radians) on the first bounce on the pitch, rolled at release. */
  seamKick: number
  /** Restitution jitter for the first bounce, rolled at release. */
  bounceJitter: number
  bounces: number
  rolling: boolean
  stopped: boolean
  pitched: boolean
  firstBounce: V3
  time: number
}

export interface StepResult {
  bounced: boolean
  onPitch: boolean
  bouncePos: V3
  impactSpeed: number
}

export function newBall(pos = new V3()): BallState {
  return { pos, vel: new V3(), spin: new V3(), swingCoef: 0, swingDir: new V3(), seamKick: 0, bounceJitter: 0, bounces: 0, rolling: false, stopped: false, pitched: false, firstBounce: new V3(), time: 0 }
}

export function cloneBall(s: BallState): BallState {
  return { ...s, pos: s.pos.clone(), vel: s.vel.clone(), spin: s.spin.clone(), swingDir: s.swingDir.clone(), firstBounce: s.firstBounce.clone() }
}

export const Cd = 0.45
export const DT = 1 / 500
const R = Geo.BallRadius

export const dragK = (e: Env) => (0.5 * e.airDensity * Cd * Geo.BallArea) / Geo.BallMass
export const sideK = (e: Env) => (0.5 * e.airDensity * Geo.BallArea) / Geo.BallMass

const noResult = (): StepResult => ({ bounced: false, onPitch: false, bouncePos: new V3(), impactSpeed: 0 })

/** Advances the ball by dt (in fixed sub-steps). Reports the first bounce in the interval. */
export function advance(s: BallState, env: Env, dt: number): StepResult {
  let result = noResult()
  if (s.stopped) {
    s.time += dt
    return result
  }
  const n = Math.max(1, Math.ceil(dt / DT - 0.001))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    const r = step(s, env, h)
    if (r.bounced && !result.bounced) result = r
    if (s.stopped) {
      s.time += (n - i - 1) * h
      break
    }
  }
  return result
}

export function step(s: BallState, env: Env, h: number): StepResult {
  const result = noResult()
  s.time += h
  if (s.stopped) return result

  const rx = s.vel.x - env.wind.x
  const ry = s.vel.y - env.wind.y
  const rz = s.vel.z - env.wind.z
  const speed = Math.sqrt(rx * rx + ry * ry + rz * rz)
  const dk = dragK(env) * speed
  let ax = -rx * dk
  let ay = -env.gravity - ry * dk
  let az = -rz * dk

  if (!s.rolling) {
    if (s.swingCoef !== 0) {
      const k = sideK(env) * s.swingCoef * speed * speed
      ax += s.swingDir.x * k
      ay += s.swingDir.y * k
      az += s.swingDir.z * k
    }
    // Magnus: k * (w x v), capped at Cl 0.3.
    const km = (0.25 * env.airDensity * Geo.BallArea * R) / Geo.BallMass
    const w = s.spin
    let mx = (w.y * rz - w.z * ry) * km
    let my = (w.z * rx - w.x * rz) * km
    let mz = (w.x * ry - w.y * rx) * km
    const cap = 0.3 * sideK(env) * speed * speed
    const m = Math.sqrt(mx * mx + my * my + mz * mz)
    if (m > cap && m > 0) {
      const f = cap / m
      mx *= f
      my *= f
      mz *= f
    }
    ax += mx
    ay += my
    az += mz
    s.spin.scaleIn(1 - 0.08 * h)
  } else {
    ay = 0
    const v = Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z)
    if (v > 1e-4) {
      const k = (env.rollingFriction * env.gravity + env.grassDrag * v) / v
      ax -= s.vel.x * k
      az -= s.vel.z * k
    }
  }

  const pvx = s.vel.x
  const pvz = s.vel.z
  s.vel.x += ax * h
  s.vel.y += ay * h
  s.vel.z += az * h
  if (s.rolling) {
    // Friction can stop the ball but never push it backwards.
    const bl = Math.sqrt(s.vel.x * s.vel.x + s.vel.z * s.vel.z)
    if (pvx * s.vel.x + pvz * s.vel.z <= 0 || bl < 0.05) {
      s.vel.set(0, 0, 0)
      s.stopped = true
      return result
    }
    s.vel.y = 0
    s.pos.x += s.vel.x * h
    s.pos.z += s.vel.z * h
    s.pos.y = R
    // Spin consistent with rolling (for the visual): cross(up, vel) / R.
    s.spin.set(s.vel.z / R, 0, -s.vel.x / R)
    return result
  }

  s.pos.x += s.vel.x * h
  s.pos.y += s.vel.y * h
  s.pos.z += s.vel.z * h
  if (s.pos.y <= R && s.vel.y < 0) {
    s.pos.y = R
    const on = onPitch(s.pos)
    result.bounced = true
    result.onPitch = on
    result.bouncePos = new V3(s.pos.x, 0, s.pos.z)
    result.impactSpeed = s.vel.len
    bounce(s, on ? env.pitch : env.outfield, !s.pitched && on)
    if (!s.pitched) s.firstBounce = result.bouncePos.clone()
    s.pitched = true
    s.bounces++
    s.swingCoef = 0
  }
  return result
}

function bounce(s: BallState, surf: Surface, firstOnPitch: boolean) {
  const vy = s.vel.y
  let e = clamp(surf.restitution + (firstOnPitch ? s.bounceJitter : 0), 0.05, 0.9)
  if (surf.spinGrip === 0) e *= clamp(0.55 + Math.abs(vy) * 0.12, 0, 1)
  const newVy = -vy * e

  let vhx = s.vel.x
  let vhz = s.vel.z
  // Contact point (0,-R,0): slip = vh + w x contact = vh + (w.z*R ... ) -> (w x (0,-R,0)) = (R*w.z, 0, -R*w.x)
  const w = s.spin
  const slipX = vhx + R * w.z
  const slipZ = vhz - R * w.x
  const limit = surf.friction * (1 + e) * Math.abs(vy)
  let dvx = 0
  let dvz = 0
  const vhLen = Math.sqrt(vhx * vhx + vhz * vhz)
  if (surf.spinGrip > 0 && vhLen > 1e-3) {
    // Along the line of travel (pace) Coulomb friction; across it (spin turn) the seam's grip.
    const ax = vhx / vhLen
    const az = vhz / vhLen
    const cx = az
    const cz = -ax
    const sAlong = slipX * ax + slipZ * az
    const sAcross = slipX * cx + slipZ * cz
    const dAlong = Math.min(limit, Math.abs(sAlong) * (2 / 7)) * -Math.sign(sAlong)
    const dAcross = Math.min(limit * 1.5, Math.abs(sAcross) * (2 / 7) * surf.spinGrip) * -Math.sign(sAcross)
    dvx = ax * dAlong + cx * dAcross
    dvz = az * dAlong + cz * dAcross
  } else {
    const slipMag = Math.sqrt(slipX * slipX + slipZ * slipZ)
    if (slipMag > 1e-4) {
      const dv = Math.min(limit, slipMag * (2 / 7))
      dvx = (-slipX / slipMag) * dv
      dvz = (-slipZ / slipMag) * dv
    }
  }
  vhx += dvx
  vhz += dvz
  // Spin change: cross(contact, dv) / (0.4 R^2), contact = (0,-R,0): (-R*dvz, 0, R*dvx)
  const k = 1 / (0.4 * R * R)
  s.spin.x += -R * dvz * k
  s.spin.z += R * dvx * k
  vhx *= surf.paceRetention
  vhz *= surf.paceRetention
  if (firstOnPitch && s.seamKick !== 0) {
    const c = Math.cos(s.seamKick)
    const sn = Math.sin(s.seamKick)
    const nx = vhx * c + vhz * sn
    const nz = -vhx * sn + vhz * c
    vhx = nx
    vhz = nz
  }
  s.vel.set(vhx, newVy, vhz)
  if (newVy < 0.7 && surf.spinGrip === 0) {
    s.vel.y = 0
    s.rolling = true
  } else if (newVy < 0.35) {
    s.vel.y = 0
    s.rolling = true
  }
}

/**
 * Swing coefficient for a seam-up delivery. Conventional swing peaks around 110-125 km/h with a newish ball and fades
 * at express pace; an old ball bowled very fast reverses (negative).
 */
export function swingCoefficient(speedMs: number, ballAgeOvers: number, swingFactor: number, skill01: number) {
  const newness = clamp(1 - ballAgeOvers / 30, 0.2, 1)
  const shape = speedMs < 32 ? lerp(0.45, 1, invLerp(20, 32, speedMs)) : lerp(1, 0.25, invLerp(32, 41, speedMs))
  const conventional = 0.25 * shape * newness * swingFactor * lerp(0.7, 1.1, skill01)
  let reverse = 0
  if (ballAgeOvers > 25 && speedMs > 35) reverse = -0.2 * invLerp(35, 41, speedMs) * invLerp(25, 40, ballAgeOvers) * swingFactor
  return conventional + reverse
}

/** Crossing of the plane z = planeZ between two positions. */
export function crossesZ(a: V3, b: V3, planeZ: number): V3 | null {
  const da = a.z - planeZ
  const db = b.z - planeZ
  if (da === 0 && db === 0) return null
  if (da * db > 0) return null
  return a.lerp(b, da / (da - db))
}

/** Whether a ball centre at this point (in the plane of the stumps) hits the wicket. */
export function hitsStumps(p: V3) {
  return Math.abs(p.x) <= Geo.StumpsHalfWidth + R && p.y <= Geo.StumpHeight + Geo.BailHeight + R * 0.6 && p.y > -0.01
}

/** Positions every `interval` seconds for up to `seconds`, stopping when the ball stops. */
export function predict(s0: BallState, env: Env, seconds: number, interval: number, into: V3[], bouncesAt?: number[]) {
  const s = cloneBall(s0)
  into.length = 0
  if (bouncesAt) bouncesAt.length = 0
  into.push(s.pos.clone())
  let t = 0
  while (t < seconds && !s.stopped) {
    const before = s.bounces
    advance(s, env, interval)
    t += interval
    into.push(s.pos.clone())
    if (bouncesAt && s.bounces !== before) bouncesAt.push(into.length - 1)
  }
}
