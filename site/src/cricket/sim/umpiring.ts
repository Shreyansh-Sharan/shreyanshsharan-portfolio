// Ball tracking for LBW (pitching, impact, wickets), the on-field umpire's call, reviews and wides.
import { BatFrame, Geo } from './geo.ts'
import { clamp01, Rng, V3 } from './vec.ts'

export type Zone = 'inline' | 'umpirescall' | 'outside' | 'outsideoff' | 'outsideleg' | 'hitting' | 'missing' | 'na'
export type ReviewOutcome = 'overturned' | 'stands' | 'umpirescall'

export interface LbwTrack {
  fullToss: boolean
  pitched: V3
  impact: V3
  atStumps: V3
  pitching: Zone
  impactZone: Zone
  impactOffSide: boolean
  wickets: Zone
  shotOffered: boolean
}

const R = Geo.BallRadius

export function outIfCallsGo(t: LbwTrack, callsOut: boolean) {
  if (t.pitching === 'outsideleg') return false
  const impactOk = t.impactZone === 'inline' || (t.impactZone === 'umpirescall' && callsOut) || ((t.impactZone === 'outside' || t.impactZone === 'umpirescall') && t.impactOffSide && !t.shotOffered)
  const wicketsOk = t.wickets === 'hitting' || (t.wickets === 'umpirescall' && callsOut)
  return impactOk && wicketsOk
}

export function trackLbw(f: BatFrame, pitchedBeforeImpact: boolean, pitched: V3, impact: V3, atStumps: V3, shotOffered: boolean): LbwTrack {
  const half = Geo.StumpsHalfWidth
  let pitching: Zone = 'na'
  if (pitchedBeforeImpact) {
    const pu = f.offsetOff(pitched)
    pitching = pu < -(half + R) ? 'outsideleg' : pu > half + R ? 'outsideoff' : 'inline'
  }
  const iu = f.offsetOff(impact)
  const ia = Math.abs(iu)
  const su = Math.abs(f.offsetOff(atStumps))
  const top = Geo.StumpHeight + Geo.BailHeight
  const centreIn = su <= half && atStumps.y <= top
  const touches = su <= half + R && atStumps.y <= top + R
  return {
    fullToss: !pitchedBeforeImpact,
    pitched,
    impact,
    atStumps,
    shotOffered,
    pitching,
    impactOffSide: iu > 0,
    impactZone: ia <= half ? 'inline' : ia <= half + R ? 'umpirescall' : 'outside',
    wickets: centreIn ? 'hitting' : touches ? 'umpirescall' : 'missing',
  }
}

/** The on-field umpire judges the same things with human error, and gives the benefit of the doubt. */
export function umpireGivesLbw(t: LbwTrack, f: BatFrame, rng: Rng, accuracy = 1) {
  const noise = 1.4 - clamp01(accuracy) * 0.6
  const half = Geo.StumpsHalfWidth
  const pu = t.fullToss ? 0 : f.offsetOff(t.pitched) + rng.gauss() * 0.035 * noise
  if (!t.fullToss && pu < -(half + R)) return false
  const iu = f.offsetOff(t.impact) + rng.gauss() * 0.03 * noise
  const impactIn = Math.abs(iu) <= half + R * 0.5
  if (!impactIn && (iu < 0 || t.shotOffered)) return false
  const su = f.offsetOff(t.atStumps) + rng.gauss() * 0.05 * noise
  const sy = t.atStumps.y + rng.gauss() * 0.07 * noise
  return Math.abs(su) <= half + R * 0.3 && sy <= Geo.StumpHeight + 0.01
}

export function umpireHearsEdge(edged: boolean, closeness01: number, rng: Rng) {
  if (edged) return rng.chance(0.9)
  return rng.chance(0.04 * closeness01)
}

export function reviewLbw(t: LbwTrack, givenOut: boolean): ReviewOutcome {
  if (givenOut) {
    if (outIfCallsGo(t, false)) return 'stands'
    if (outIfCallsGo(t, true)) return 'umpirescall'
    return 'overturned'
  }
  if (outIfCallsGo(t, false)) return 'overturned'
  if (outIfCallsGo(t, true)) return 'umpirescall'
  return 'stands'
}

export const ZONE_TEXT: Record<Zone, string> = {
  inline: 'IN LINE',
  umpirescall: "UMPIRE'S CALL",
  outside: 'OUTSIDE',
  outsideoff: 'OUTSIDE OFF',
  outsideleg: 'OUTSIDE LEG',
  hitting: 'HITTING',
  missing: 'MISSING',
  na: '—',
}

/** Wide (limited-overs guide): outside the guide on the off side, past leg stump, or over head height. */
export function isWide(f: BatFrame, atCrease: V3, guard: number, touched: boolean) {
  if (touched) return false
  const u = f.offsetOff(atCrease)
  const offLine = Geo.WideLineOff + Math.max(0, guard)
  const legLine = -(Geo.StumpsHalfWidth + Geo.WideLineLeg) + Math.min(0, guard)
  return u > offLine || u < legLine || atCrease.y > 2.1
}
