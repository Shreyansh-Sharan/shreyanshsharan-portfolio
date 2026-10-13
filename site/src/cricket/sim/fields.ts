// Named fielding positions, the captain's presets, and fielding restrictions.
import { BatFrame, beyondRope, Geo } from './geo.ts'
import { deltaAngle, V3 } from './vec.ts'

export interface FieldSpot {
  name: string
  /** Angle around the striker's stumps (0 straight, + off side). */
  angle: number
  dist: number
}

export type FieldPreset = 'attacking' | 'normal' | 'defensive' | 'death' | 'spin' | 'custom'
export const PRESET_NAMES: Record<FieldPreset, string> = { attacking: 'Attacking', normal: 'Balanced', defensive: 'Defensive', death: 'Death overs', spin: 'Spin', custom: 'Custom' }
export const PRESET_ORDER: FieldPreset[] = ['attacking', 'normal', 'defensive', 'death', 'spin']
export const PRESET_BLURB: Record<FieldPreset, string> = {
  attacking: 'Slips, gully and a short leg: catchers in for the edge',
  normal: 'A slip, the ring sealed, two out on the hook and the cut',
  defensive: 'Sweepers on the rope, singles on offer, boundaries saved',
  death: 'Five out, fine and square: yorker and slower-ball field',
  spin: 'Bat-pad close in, a slip, the ring saving one',
  custom: 'Your own field',
}

const P = (name: string, angle: number, dist: number): FieldSpot => ({ name, angle, dist })
export const SPOTS = {
  FirstSlip: P('1st slip', 162, 19),
  SecondSlip: P('2nd slip', 156, 20),
  ThirdSlip: P('3rd slip', 150, 21),
  Gully: P('Gully', 128, 21),
  Point: P('Point', 95, 22),
  BackwardPoint: P('Backward point', 112, 23),
  Cover: P('Cover', 62, 24),
  ExtraCover: P('Extra cover', 42, 25),
  MidOff: P('Mid-off', 16, 24),
  MidOn: P('Mid-on', -16, 24),
  Midwicket: P('Midwicket', -58, 24),
  SquareLeg: P('Square leg', -95, 22),
  ShortFineLeg: P('Short fine leg', -148, 20),
  ShortLeg: P('Short leg', -105, 5.5),
  SillyPoint: P('Silly point', 100, 5.5),
  LegSlip: P('Leg slip', -162, 14),
  FineLeg: P('Fine leg', -155, 60),
  ThirdMan: P('Third man', 148, 60),
  DeepPoint: P('Deep point', 98, 58),
  DeepCover: P('Deep cover', 55, 62),
  LongOff: P('Long-off', 14, 68),
  LongOn: P('Long-on', -14, 68),
  DeepMidwicket: P('Deep midwicket', -55, 62),
  DeepSquareLeg: P('Deep square leg', -98, 58),
  DeepFineLeg: P('Deep fine leg', -140, 60),
  LegGully: P('Leg gully', -128, 13),
  ShortMidwicket: P('Short midwicket', -55, 14),
  ShortCover: P('Short cover', 55, 14),
  CowCorner: P('Cow corner', -38, 66),
  DeepExtraCover: P('Deep extra cover', 36, 66),
  DeepBackwardPoint: P('Deep backward point', 122, 60),
  FlySlip: P('Fly slip', 158, 38),
  LongStop: P('Long leg', -168, 62),
}
const s = SPOTS

export function presetSpots(preset: FieldPreset, spin: boolean): FieldSpot[] {
  switch (preset) {
    case 'attacking':
      return spin ? [s.FirstSlip, s.ShortLeg, s.SillyPoint, s.Point, s.Cover, s.MidOff, s.MidOn, s.Midwicket, s.SquareLeg] : [s.FirstSlip, s.SecondSlip, s.ThirdSlip, s.Gully, s.Point, s.Cover, s.MidOff, s.MidOn, s.FineLeg]
    case 'spin':
      return [s.FirstSlip, s.ShortLeg, s.SillyPoint, s.LegSlip, s.Point, s.Cover, s.MidOff, s.MidOn, s.Midwicket]
    case 'defensive':
      return spin
        ? [s.Point, s.Cover, s.MidOff, s.MidOn, s.Midwicket, s.DeepCover, s.LongOn, s.DeepMidwicket, s.DeepSquareLeg]
        : [s.FirstSlip, s.Point, s.Cover, s.MidOff, s.MidOn, s.Midwicket, s.ThirdMan, s.DeepCover, s.FineLeg]
    case 'death':
      return [s.BackwardPoint, s.ExtraCover, s.Midwicket, s.ShortFineLeg, s.LongOff, s.LongOn, s.DeepMidwicket, s.DeepPoint, s.DeepSquareLeg]
    default:
      return spin ? [s.FirstSlip, s.Point, s.Cover, s.MidOff, s.MidOn, s.Midwicket, s.SquareLeg, s.LongOn, s.DeepCover] : [s.FirstSlip, s.Gully, s.Point, s.Cover, s.MidOff, s.MidOn, s.SquareLeg, s.ThirdMan, s.FineLeg]
  }
}

export const isOutside = (spot: FieldSpot) => spot.dist > Geo.InnerCircle + 2
/** Behind square on the leg side (the law allows two). */
export const behindSquareLeg = (spot: FieldSpot) => spot.angle < -97
export const onLegSide = (spot: FieldSpot) => spot.angle < 0

export interface FieldCheck {
  outside: number
  maxOutside: number
  behindSquareLeg: number
  legSide: number
  ok: boolean
  problems: string[]
}

/** Fielding restrictions for a field (nine fielders, the keeper and bowler excluded). */
export function checkField(spots: FieldSpot[], maxOutside: number): FieldCheck {
  const outside = spots.filter(isOutside).length
  const bsl = spots.filter(behindSquareLeg).length
  const leg = spots.filter(onLegSide).length
  const problems: string[] = []
  if (outside > maxOutside) problems.push(`${outside} outside the circle (max ${maxOutside})`)
  if (bsl > 2) problems.push(`${bsl} behind square on the leg side (max 2)`)
  if (leg > 5) problems.push(`${leg} on the leg side (max 5)`)
  return { outside, maxOutside, behindSquareLeg: bsl, legSide: leg, ok: problems.length === 0, problems }
}

/** At most `maxOutside` outside the 30-yard circle; extra deep fielders come in to the ring. */
export function enforce(spots: FieldSpot[], maxOutside: number): FieldSpot[] {
  const result = spots.map((x) => ({ ...x }))
  const deep: number[] = []
  result.forEach((x, i) => isOutside(x) && deep.push(i))
  deep.sort((a, b) => Math.abs(Math.abs(result[b].angle) - 90) - Math.abs(Math.abs(result[a].angle) - 90))
  for (let k = maxOutside; k < deep.length; k++) {
    const x = result[deep[k]]
    x.name = x.name.replace('Deep ', '').replace('Long-', 'Mid-')
    x.dist = Geo.InnerCircle - 3
  }
  // At most two behind square on the leg side: the rest come round to square leg.
  let bsl = 0
  for (const x of result) {
    if (!behindSquareLeg(x)) continue
    if (++bsl > 2) {
      x.angle = -86
      x.name = x.dist > Geo.InnerCircle ? 'Deep square leg' : 'Square leg'
    }
  }
  // At most five on the leg side: the extras cross to the mirror spot on the off side.
  let leg = 0
  for (const x of result) {
    if (!onLegSide(x)) continue
    if (++leg > 5) {
      x.angle = -x.angle
      x.name = 'Fielder'
    }
  }
  return result
}

/** A spot as a world position for this striker, kept inside the rope. */
export function spotToWorld(spot: FieldSpot, f: BatFrame) {
  let p = f.polar(spot.angle, spot.dist)
  const beyond = beyondRope(p, 4)
  if (beyond > 0) p = p.sub(p.sub(f.origin).norm().mul(beyond))
  p.y = 0
  return p
}

/** The nearest named position to a spot (angle, distance). */
export function spotName(a: number, d: number) {
  let best = 'Fielder'
  let bestScore = Infinity
  for (const x of Object.values(SPOTS)) {
    const score = Math.abs(deltaAngle(a, x.angle)) * 0.6 + Math.abs(d - x.dist) * 1.2
    if (score < bestScore) {
      bestScore = score
      best = x.name
    }
  }
  return best
}

export function nameOf(p: V3, f: BatFrame) {
  return spotName(f.angleOf(p), p.flatDist(f.origin))
}

/** A custom field from (angle, distance) pairs: nine spots, inside the rope, named. */
export function customSpots(list: readonly (readonly [number, number])[]): FieldSpot[] {
  const out: FieldSpot[] = []
  for (let i = 0; i < 9; i++) {
    const v = list[i] ?? [0, 24]
    let a = Number(v[0]) || 0
    a = ((((a + 180) % 360) + 360) % 360) - 180
    const d = Math.max(9, Math.min(75, Number(v[1]) || 24))
    out.push({ name: spotName(a, d), angle: Math.round(a * 10) / 10, dist: Math.round(d * 10) / 10 })
  }
  return out
}
