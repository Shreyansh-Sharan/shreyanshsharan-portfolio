// LAWN WARS online play on the shared transport (PeerJS room codes, or BroadcastChannel tabs with `?net=local`).
// The host's browser runs the simulation and streams 20 snapshots a second plus one-shot events; clients send
// their input 30 times a second and draw interpolated snapshots. Bots fill the empty seats.
import type { Link } from '../../racer/net'
import type { HeroId } from './heroes'
import type { LayoutId } from './houses'
import type { MapId, TimeOfDay } from './maps'
import type { ModeId, RosterEntry, SimEvent, Snap } from './sim'
import type { ThrowKind, TrapKind } from './gear'

export { hostRoom, joinRoom, type Link } from '../../racer/net'

export const MAX_PEOPLE = 8
export const SNAP_HZ = 20
export const INPUT_HZ = 30

export interface Look {
  name: string
  hero: HeroId
  colour: string
  perks: number
  throwKind: ThrowKind
  traps: TrapKind[]
  layout: LayoutId
  theme: string
}

export interface LobbyPlayer {
  peer: string
  name: string
  hero: HeroId
  colour: string
  team: number
}

export interface MatchSettings {
  mode: ModeId
  map: MapId
  time: TimeOfDay
}

export interface MatchSetup {
  settings: MatchSettings
  seed: number
  roster: RosterEntry[]
  layouts: [LayoutId, LayoutId]
  themes: [string, string]
}

export interface PeerResult {
  peer: string
  win: boolean
  kills: number
  deaths: number
  damage: number
  score: number
  breaks: number
  ults: number
}

/** Inputs: [mx, mz, yaw, pitch, flags, slot, charge] with flags bits: jump, sprint, crouch, light, heavy, throw, use, ladder, ult, block. */
export type LawnMsg =
  | { t: 'lw-hello'; look: Look }
  | { t: 'lw-look'; look: Look }
  | { t: 'lw-lobby'; players: LobbyPlayer[]; settings: MatchSettings }
  | { t: 'lw-start'; setup: MatchSetup }
  | { t: 'lw-in'; i: number[] }
  | { t: 'lw-snap'; s: Snap; e: SimEvent[] }
  | { t: 'lw-end'; winner: number; results: PeerResult[] }
  | { t: 'lw-back' }
  | { t: 'lw-full' }

export const IN = { jump: 1, sprint: 2, crouch: 4, light: 8, heavy: 16, throw: 32, use: 64, ladder: 128, ult: 256, block: 512 }

export function isLawnMsg(m: unknown): m is LawnMsg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string' && (m as { t: string }).t.startsWith('lw-')
}

export interface NetSession {
  link: Link
  role: 'host' | 'client'
}
