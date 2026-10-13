// NEON SIEGE online play on the shared transport (PeerJS room codes, or BroadcastChannel tabs with `?net=local`).
// The host's browser runs the simulation and streams 20 snapshots a second plus one-shot events; clients send
// their input 30 times a second and draw interpolated snapshots. Bots fill the empty slots.
import type { Link } from '../../racer/net'
import type { HeroId } from './heroes'
import type { MapId } from './maps'
import type { GearMods, ModeId, RosterEntry, SimEvent, Snap } from './sim'

export { hostRoom, joinRoom, type Link } from '../../racer/net'

export const MAX_PEOPLE = 6
export const SNAP_HZ = 20
export const INPUT_HZ = 30

export interface Look {
  name: string
  hero: HeroId
  skin: string
  gear: GearMods
}

export interface LobbyPlayer {
  peer: string
  name: string
  hero: HeroId
  skin: string
  team: number
}

export interface MatchSettings {
  mode: ModeId
  map: MapId
}

export interface MatchSetup {
  settings: MatchSettings
  seed: number
  roster: RosterEntry[]
}

export interface PeerResult {
  peer: string
  win: boolean
  kills: number
  deaths: number
  damage: number
  supers: number
  placement: number
}

/** Inputs: [mx, mz, ax, az, aimDist, flags] with flags = fire | dash << 1 | super << 2. */
export type SiegeMsg =
  | { t: 'sg-hello'; look: Look }
  | { t: 'sg-look'; look: Look }
  | { t: 'sg-lobby'; players: LobbyPlayer[]; settings: MatchSettings }
  | { t: 'sg-start'; setup: MatchSetup }
  | { t: 'sg-in'; i: number[] }
  | { t: 'sg-snap'; s: Snap; e: SimEvent[] }
  | { t: 'sg-end'; winner: number; results: PeerResult[] }
  | { t: 'sg-back' }
  | { t: 'sg-full' }

export function isSiegeMsg(m: unknown): m is SiegeMsg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string' && (m as { t: string }).t.startsWith('sg-')
}

export interface NetSession {
  link: Link
  role: 'host' | 'client'
}
