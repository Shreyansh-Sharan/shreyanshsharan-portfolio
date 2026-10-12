// Named fielding positions, the captain's presets, and fielding restrictions.
import { BatFrame, beyondRope, Geo } from './geo.ts'
import { deltaAngle, V3 } from './vec.ts'

export interface FieldSpot {
  name: string
  /** Angle around the striker's stumps (0 straight, + off side). */
  angle: number
  dist: number
}

export type FieldPreset = 'attacking' | 'normal' | 'defensive' | 'death' | 'spin'
export const PRESET_NAMES: Record<FieldPreset, string> = { attacking: 'Attacking', normal: 'Normal', defensive: 'Defensive', death: 'Death', spin: 'Spin attack' }
export const PRESET_ORDER: FieldPreset[] = ['attacking', 'normal', 'defensive', 'death']

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

export function nameOf(p: V3, f: BatFrame) {
  const a = f.angleOf(p)
  const d = p.flatDist(f.origin)
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
