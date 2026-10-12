// PLUSH PANIC online play. Same transport as VOLT RIOT and BOGEY BRAWL (PeerJS room codes, or BroadcastChannel
// tabs with `?net=local`). The host's browser runs every round and streams ~20 snapshots a second plus one-shot
// effect events; clients send their pad ~30 times a second plus one-shot actions, and predict their own toy.
import type { Link } from '../../racer/net'
import type { ShowResults, ShowSettings } from './show'
import type { Contestant, DuelInfo, PlayMode } from './types'

export { hostRoom, joinRoom, type Link } from '../../racer/net'

export interface Look {
  name: string
  kind: string
  tint: string
}

/** What a client needs to build a round exactly like the host. */
export interface RoundSetup {
  levelId: string
  seed: number
  mode: PlayMode
  /** Roster indices of the toys in this round (everyone else is in the gallery). */
  toys: number[]
  target: number
  index: number
  total: number
  final: boolean
  /** Contestant index → spawn order is the order of `toys`. */
  settings: ShowSettings
  /** A timed duel / table mini-game (see LevelCtx.startDuel). */
  duel?: DuelInfo
  /** Round length override in seconds (duels). */
  duration?: number
  /** Start straight in play (a board resuming after a duel). */
  skipIntro?: boolean
}

export type RosterRow = Pick<Contestant, 'idx' | 'id' | 'name' | 'kind' | 'tint' | 'human' | 'out' | 'outRound'>

/**
 * Messages. Pad `p`: [mx, mz, yaw, flags, px, pz, x, y, z, toyYaw] where flags = grab | down<<1, and x/y/z/toyYaw is
 * the client's predicted position (trusted while the host isn't pushing that toy around). Actions `a`:
 * 'jump' 'dive' 'shove' 'act' 'emote:<k>' 'trick:<id>:<targetIdx>' 'throw:<kind>:<targetIdx>'.
 */
export type PlushMsg =
  | { t: 'pp-hello'; look: Look }
  | { t: 'pp-look'; look: Look }
  | { t: 'pp-roster'; roster: RosterRow[]; settings: ShowSettings }
  | { t: 'pp-round'; r: RoundSetup; roster: RosterRow[] }
  | { t: 'pp-in'; p: number[]; a: string[] }
  | { t: 'pp-snap'; s: unknown; e: unknown[] }
  | { t: 'pp-results'; r: ShowResults }
  | { t: 'pp-busy'; why: string }

export function isPlushMsg(m: unknown): m is PlushMsg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string' && (m as { t: string }).t.startsWith('pp-')
}

export interface NetSession {
  link: Link
  role: 'host' | 'client'
}
