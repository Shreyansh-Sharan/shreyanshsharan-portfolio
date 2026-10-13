// Strokes, footwork, timing windows, edges and the bat-on-ball collision (a port of the calibrated original).
import { BatFrame, Geo } from './geo.ts'
import { clamp, clamp01, DEG, lerp, Rng, UP, V3 } from './vec.ts'

export type ShotType = 'auto' | 'defend' | 'leave' | 'drive' | 'cut' | 'pull' | 'sweep' | 'flick'
export type Footwork = 'auto' | 'front' | 'back' | 'charge'
export type Contact = 'none' | 'middle' | 'edge' | 'miss'
export type EdgeKind = 'none' | 'outside' | 'inside' | 'top'
export type Timing = 'noshot' | 'veryearly' | 'early' | 'perfect' | 'late' | 'verylate'

export interface ShotInput {
  type: ShotType
  feet: Footwork
  /** Intended direction, degrees (0 straight back past the bowler, +90 point, -90 square leg). */
  aim: number
  loft: boolean
  played: boolean
  /** Bat arrival minus ball arrival at the contact point, seconds (negative = early). */
  timingError: number
  /** 1 a full stroke, ~0.5 a soft push for a single. 0 = full. */
  power: number
}

export interface ShotSpec {
  type: ShotType
  name: string
  dirMin: number
  dirMax: number
  uMin: number
  uMax: number
  hMin: number
  hMax: number
  lenMin: number
  lenMax: number
  feet: Footwork
  batSpeed: number
  groundElevation: number
  loftElevation: number
  /** Seconds from pressing the shot to the bat reaching the ball. */
  lead: number
}

export interface ContactContext {
  frame: BatFrame
  ballPos: V3
  ballVel: V3
  /** Where it pitched, from the batter's stumps (m), or -1 for a full toss. */
  length: number
  lateMovement: number
  /** Signed movement at the batter (m, + away towards the off side, - in to the pads); optional. */
  movement?: number
  spin: boolean
  batterSkill: number
  batterPower: number
  guard: number
  /** Timing window multiplier (difficulty assist, confidence). */
  window: number
}

export interface ShotResult {
  shot: ShotType
  feet: Footwork
  contact: Contact
  edge: EdgeKind
  timing: Timing
  quality: number
  exitVel: V3
  exitSpin: V3
  direction: number
  playedOn: boolean
  hitWicket: boolean
  /** Beaten on the inside by a ball coming back in (a drive or a push with a gap between bat and pad). */
  gate: boolean
  note: string
}

export const emptyShot = (): ShotResult => ({ shot: 'leave', feet: 'auto', contact: 'none', edge: 'none', timing: 'noshot', quality: 0, exitVel: new V3(), exitSpin: new V3(), direction: 0, playedOn: false, hitWicket: false, gate: false, note: '' })

const S = (o: ShotSpec) => o
export const SHOTS: Record<Exclude<ShotType, 'auto'>, ShotSpec> = {
  defend: S({ type: 'defend', name: 'Defence', dirMin: -70, dirMax: 70, uMin: -0.38, uMax: 0.5, hMin: 0, hMax: 1.5, lenMin: 0, lenMax: 20, feet: 'auto', batSpeed: 2.5, groundElevation: -10, loftElevation: -6, lead: 0.14 }),
  leave: S({ type: 'leave', name: 'Leave', dirMin: 0, dirMax: 0, uMin: 0, uMax: 0, hMin: 0, hMax: 0, lenMin: 0, lenMax: 0, feet: 'auto', batSpeed: 0, groundElevation: 0, loftElevation: 0, lead: 0 }),
  drive: S({ type: 'drive', name: 'Drive', dirMin: -50, dirMax: 85, uMin: -0.3, uMax: 0.75, hMin: 0, hMax: 0.85, lenMin: 1.6, lenMax: 5.8, feet: 'front', batSpeed: 17.5, groundElevation: 3, loftElevation: 29, lead: 0.2 }),
  cut: S({ type: 'cut', name: 'Cut', dirMin: 60, dirMax: 150, uMin: 0.2, uMax: 1.25, hMin: 0.2, hMax: 1.35, lenMin: 6.5, lenMax: 14, feet: 'back', batSpeed: 18, groundElevation: 2, loftElevation: 24, lead: 0.18 }),
  pull: S({ type: 'pull', name: 'Pull', dirMin: -155, dirMax: -20, uMin: -0.55, uMax: 0.5, hMin: 0.55, hMax: 2.1, lenMin: 7, lenMax: 14, feet: 'back', batSpeed: 20, groundElevation: 4, loftElevation: 26, lead: 0.2 }),
  sweep: S({ type: 'sweep', name: 'Sweep', dirMin: -170, dirMax: -40, uMin: -0.55, uMax: 0.7, hMin: 0, hMax: 0.75, lenMin: 1.5, lenMax: 5.5, feet: 'front', batSpeed: 15.5, groundElevation: 2, loftElevation: 27, lead: 0.22 }),
  flick: S({ type: 'flick', name: 'Flick', dirMin: -115, dirMax: 5, uMin: -0.75, uMax: 0.2, hMin: 0, hMax: 0.95, lenMin: 0, lenMax: 9, feet: 'auto', batSpeed: 16, groundElevation: 3, loftElevation: 27, lead: 0.17 }),
}
export const shotSpec = (t: ShotType) => SHOTS[t === 'auto' ? 'drive' : t]

/** Base windows (s) for perfect / good / poor timing. */
export const PERFECT = 0.022
export const GOOD = 0.055
export const POOR = 0.1

export function classifyTiming(err: number, window: number): Timing {
  const a = Math.abs(err)
  if (a <= PERFECT * window) return 'perfect'
  if (a <= POOR * window) return err < 0 ? 'early' : 'late'
  return err < 0 ? 'veryearly' : 'verylate'
}

/** Natural footwork for a ball pitching at this length (m from the stumps). */
export function naturalFeet(length: number, spin: boolean): Footwork {
  if (length < 0) return 'front'
  return length < (spin ? 5.6 : 6.4) ? 'front' : 'back'
}

/** The stroke a batter plays for this aim, footwork and ball (the main shot buttons pick direction and feet). */
export function chooseShot(aim: number, feet: Footwork, u: number, h: number, length: number, spin: boolean): ShotType {
  const back = feet === 'back' || (feet === 'auto' && naturalFeet(length, spin) === 'back')
  if (h > 1.05 && aim < 30) return 'pull'
  if (aim >= 60 && (back || u > 0.45)) return 'cut'
  if (aim <= -25) {
    // A front-foot stroke square or behind on the leg side to a spinner is a sweep.
    if (spin && feet === 'front' && aim <= -60 && h < 0.75) return 'sweep'
    if (back && h > 0.5) return 'pull'
    return 'flick'
  }
  if (back && h > 0.9) return aim > 20 ? 'cut' : 'pull'
  return 'drive'
}

const outsideRange = (v: number, min: number, max: number) => (v < min ? min - v : v > max ? v - max : 0)

export function launch(f: BatFrame, dirDeg: number, elevationDeg: number, speed: number) {
  const e = elevationDeg * DEG
  return f.direction(dirDeg).mul(Math.cos(e)).add(UP.mul(Math.sin(e))).mul(speed)
}

export function resolveShot(input0: ShotInput, c: ContactContext, rng: Rng): ShotResult {
  const input = { ...input0 }
  const r = emptyShot()
  r.shot = input.type
  r.feet = input.feet
  const f = c.frame
  const u = f.offsetOff(c.ballPos) - c.guard
  const h = c.ballPos.y
  const vin = c.ballVel.len

  if (!input.played || input.type === 'leave') {
    r.contact = 'none'
    r.timing = 'noshot'
    r.shot = 'leave'
    r.note = input.played ? 'Left alone' : 'No shot'
    return r
  }
  if (input.type === 'auto') input.type = chooseShot(input.aim, input.feet, u, h, c.length, c.spin)
  r.shot = input.type
  const spec = shotSpec(input.type)
  const feet: Footwork = input.feet === 'auto' ? (spec.feet === 'auto' ? naturalFeet(c.length, c.spin) : spec.feet) : input.feet
  r.feet = feet
  r.timing = classifyTiming(input.timingError, c.window)

  const du = outsideRange(u, spec.uMin, spec.uMax)
  const dh = outsideRange(h, spec.hMin, spec.hMax)
  const zoneMiss = Math.sqrt(du * du + dh * dh)
  const zoneQ = clamp01(1 - zoneMiss / 0.35)

  let lengthQ = 1
  if (c.length >= 0) lengthQ = clamp01(1 - outsideRange(c.length, spec.lenMin, spec.lenMax) * 0.12)
  if (feet === 'front' && c.length > 8) lengthQ *= 0.65
  if (feet === 'back' && c.length >= 0 && c.length < 3.5) lengthQ *= 0.7
  if (input.type === 'sweep' && !c.spin && vin > 30) lengthQ *= 0.6

  const err = input.timingError
  const window = Math.max(0.3, c.window)
  const a = Math.abs(err)
  let timingQ: number
  if (a <= PERFECT * window) timingQ = 1
  else if (a <= GOOD * window) timingQ = lerp(1, 0.75, (a - PERFECT * window) / ((GOOD - PERFECT) * window))
  else if (a <= POOR * window) timingQ = lerp(0.75, 0.35, (a - GOOD * window) / ((POOR - GOOD) * window))
  else timingQ = 0

  const skill = lerp(0.82, 1, c.batterSkill)
  const late = Math.max(0, c.lateMovement - 0.04)
  // Shot selection against the movement: driving at the one going away finds the edge, playing straight at the
  // one coming back leaves the gate open, and a cross-bat shot to a full straight ball is a big risk.
  const move = c.movement ?? 0
  const away = Math.max(0, move - 0.03)
  const into = Math.max(0, -move - 0.03)
  const straightBat = input.type === 'drive' || input.type === 'defend'
  const crossBat = input.type === 'pull' || input.type === 'cut' || input.type === 'sweep'
  const fullStraight = c.length >= 0 && c.length < 5 && Math.abs(f.offsetOff(c.ballPos)) < Geo.StumpsHalfWidth + 0.15
  let selection = 0
  if (straightBat && u > -0.15) selection += away * 1.4
  if (input.type === 'drive') selection += into * 1.1
  if (input.type === 'cut' && u < 0.15) selection += 0.25 // cutting a ball too close to the body
  if (crossBat && fullStraight && !(input.type === 'sweep' && c.spin)) selection += 0.22
  if (input.type === 'flick' && u > 0.35) selection += 0.18 // working it across the line from outside off

  let pMiss = timingQ <= 0 ? 0.85 : clamp01(zoneMiss > 0.45 ? 0.9 : (1 - zoneQ) * 0.55 + late * 1.0 + selection * 0.45 - c.batterSkill * 0.05)
  if (input.type === 'defend') pMiss *= 0.6
  if (rng.chance(pMiss)) {
    r.contact = 'miss'
    r.gate = straightBat && into > 0.02
    r.note = timingQ <= 0 ? (err < 0 ? 'Through the shot far too early' : 'Beaten for pace') : r.gate ? 'Beaten through the gate' : away > 0.02 ? 'Beaten outside off by the movement' : late > 0.05 ? 'Beaten by the movement' : crossBat && fullStraight ? 'Played across the line' : 'Played and missed'
    return r
  }

  let pEdge = clamp(0.03 + 0.55 * (1 - zoneQ) + 0.28 * (1 - timingQ) + late * 1.6 + (1 - lengthQ) * 0.3 + selection * 0.8 - 0.04 * c.batterSkill, 0, 0.88)
  if (input.type === 'defend') pEdge *= 0.7
  if (rng.chance(pEdge)) {
    r.contact = 'edge'
    const topEdge = (input.type === 'pull' || input.type === 'sweep') && rng.chance(0.55)
    const centre = (spec.uMin + spec.uMax) * 0.5
    if (topEdge) {
      r.edge = 'top'
      const dir = rng.range(-175, -95)
      const el = rng.range(48, 78)
      const speed = rng.range(14, 24)
      r.direction = dir
      r.exitVel = launch(f, dir, el, speed)
      r.exitSpin = UP.cross(r.exitVel.norm()).mul(rng.range(-60, 60))
      r.note = 'Top edge!'
    } else if (move > 0.05 || (move > -0.05 && u > centre - 0.05)) {
      r.edge = 'outside'
      const thin = rng.chance(0.55)
      const dir = thin ? rng.range(150, 176) : rng.range(105, 150)
      const el = thin ? rng.range(1, 12) : rng.range(-6, 18)
      const speed = vin * (thin ? rng.range(0.6, 0.8) : rng.range(0.35, 0.6)) + (input.type === 'defend' ? -4 : 2)
      r.direction = dir
      r.exitVel = launch(f, dir, el, Math.max(4, speed))
      r.note = thin ? 'Outside edge' : 'Thick outside edge'
    } else {
      r.edge = 'inside'
      const lineOnStumps = Math.abs(f.offsetOff(c.ballPos)) < Geo.StumpsHalfWidth + 0.1
      if (lineOnStumps && rng.chance(0.35)) {
        r.playedOn = true
        r.direction = rng.range(170, 190)
        r.exitVel = launch(f, r.direction, rng.range(-10, 2), vin * 0.35)
        r.note = 'Dragged on!'
      } else {
        const dir = rng.range(-178, -135)
        r.direction = dir
        r.exitVel = launch(f, dir, rng.range(-8, 25), vin * rng.range(0.3, 0.55))
        r.note = 'Inside edge'
      }
    }
    return r
  }

  // Middled (to a degree).
  const q = clamp01(timingQ * lerp(0.55, 1, zoneQ) * lengthQ * skill)
  r.contact = 'middle'
  r.quality = q
  const aim = clamp(input.aim, spec.dirMin, spec.dirMax)
  // Early closes the face (leg side), late opens it (off side / behind square).
  const skew = clamp(err * 320, -40, 40)
  const direction = aim + skew + rng.gauss() * (4 + (1 - q) * 12)
  r.direction = direction

  const power = input.power > 0 ? clamp(input.power, 0.3, 1) : 1
  const batSpeed = spec.batSpeed * lerp(0.3, 1, q) * lerp(0.9, 1.12, c.batterPower) * (input.loft ? 1.35 : 1) * power
  const qA = 0.25
  let speedOut = qA * vin * lerp(0.6, 1, q) * lerp(0.5, 1, power) + (1 + qA) * batSpeed
  let elevation: number
  if (input.type === 'defend') {
    speedOut = Math.min(speedOut, rng.range(2.5, 6.5))
    elevation = rng.range(-14, -3)
  } else if (input.loft) {
    elevation = spec.loftElevation + rng.gauss() * (1 - q) * 12 + (err > 0 ? 6 : 0) * (1 - q)
  } else {
    elevation = spec.groundElevation + (1 - q) * rng.range(-2, 14) + rng.gauss() * 1.5
    if (input.type === 'pull' && h > 1.35) elevation += 9
  }
  r.exitVel = launch(f, direction, elevation, speedOut)
  const horizontal = r.exitVel.flat().norm()
  const topAxis = new V3(horizontal.z, 0, -horizontal.x)
  r.exitSpin = input.loft || elevation > 12 ? topAxis.mul(-(rng.range(18, 32) * 2 * Math.PI)) : topAxis.mul(rng.range(4, 12) * 2 * Math.PI)

  if (feet === 'back' && (input.type === 'pull' || input.type === 'cut') && q < 0.45 && rng.chance(0.02)) r.hitWicket = true

  r.note = r.timing === 'perfect' ? (q > 0.85 ? 'Perfectly timed' : 'Well timed') : r.timing === 'early' ? 'A touch early' : r.timing === 'late' ? 'A touch late' : 'Mistimed'
  return r
}
