// BOGEY BRAWL online play. Same transport as VOLT RIOT (PeerJS rooms, or BroadcastChannel tabs with `?net=local`):
// the host's browser runs the hole and streams snapshots; the other players send their input.
import type { Link } from '../racer/net'

export { hostRoom, joinRoom, type Link } from '../racer/net'

/** Golfers on a hole, people first; bots fill the rest. */
export const MAX_GOLFERS = 4

export interface GolfSlot {
  kind: 'human' | 'ai'
  id: string // peer id for people ('host' for the host), 'ai-N' for bots
  name: string
}

export interface GolfNet {
  link: Link
  role: 'host' | 'client'
  slots: GolfSlot[]
  setup?: GolfSetup
}

export interface LobbyGolfer {
  id: string
  name: string
}

/** A Tour plays every hole in order, points carried over. */
export interface GolfTour {
  holes: string[]
  idx: number
}

export interface GolfSetup {
  slots: GolfSlot[]
  difficulty: number
  /** Hole id: every screen builds the same hole from it. */
  hole: string
  chaos: boolean
  tour: GolfTour | null
}

/**
 * Messages. Input `p`: [moveX, moveY, aimYaw, loft, creep, x, y, z, yaw] (the last four are the client's own
 * predicted position, trusted while the host isn't moving that golfer itself), plus one-shot actions `a`.
 */
export type GolfMsg =
  | { t: 'g-hello'; name: string }
  | { t: 'g-lobby'; players: LobbyGolfer[]; bots: number; difficulty: number; hole: string; chaos: boolean; tour: boolean }
  | { t: 'g-start'; setup: GolfSetup }
  | { t: 'g-in'; p: number[]; a: string[] }
  | { t: 'g-snap'; s: unknown; e: unknown[] }
  | { t: 'g-result'; r: unknown }
  | { t: 'g-full' }
  | { t: 'g-lobbyback' }

export function isGolfMsg(m: unknown): m is GolfMsg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string' && (m as { t: string }).t.startsWith('g-')
}
