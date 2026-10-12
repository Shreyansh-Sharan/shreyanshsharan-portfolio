// Shared plumbing for the Loft's hidden games: a station (one player at a time with a queue), score events, and
// the little interface each game implements so loft.ts can run them. Host code decides; every screen draws.
import type { LevelCtx, LevelHud, Toy } from '../../engine/types'
import type { CamRig } from '../../engine/camera'
import type { LoftGame } from './records'

export interface Station {
  /** Toy index playing, or -1. */
  player: number
  /** Toy indices waiting, in order. */
  queue: number[]
}

export function station(): Station {
  return { player: -1, queue: [] }
}

/**
 * Host: R (Act) on a station's pad joins it, or queues if it's busy; wandering off leaves the queue. Returns the
 * toy that should start now (or null).
 */
export function stationTick(ctx: LevelCtx, st: Station, pad: { x: number; z: number }, r: number, name: string): Toy | null {
  for (const t of ctx.toys) {
    if (!t.c.human || t.idx === st.player) continue
    const near = Math.hypot(t.pos.x - pad.x, t.pos.z - pad.z) < r
    const qi = st.queue.indexOf(t.idx)
    if (qi >= 0 && Math.hypot(t.pos.x - pad.x, t.pos.z - pad.z) > r + 4) {
      st.queue.splice(qi, 1)
      ctx.fx.popup(t, `Left the ${name} queue`, '#fca5a5')
      continue
    }
    if (!near || !t.pad.act || qi >= 0 || busyElsewhere(t)) continue
    if (st.player < 0) return t
    st.queue.push(t.idx)
    ctx.fx.popup(t, `In line for ${name}: #${st.queue.length}`, '#93c5fd')
    ctx.fx.sfx('tick', t.pos, t)
  }
  if (st.player < 0 && st.queue.length) {
    const t = ctx.toys[st.queue.shift()!]
    if (t && Math.hypot(t.pos.x - pad.x, t.pos.z - pad.z) < r + 4 && !busyElsewhere(t)) return t
  }
  return null
}

/** A toy already busy in another Loft game (frozen at a machine, or swinging). */
export function busyElsewhere(t: Toy) {
  return !!t.data.loftGame
}

/** Mark a toy as playing a Loft game (or free it). */
export function claim(t: Toy, game: LoftGame | null) {
  if (game) t.data.loftGame = game
  else delete t.data.loftGame
}

/** Host: a game finished (or a combo was set). Every screen records it; the player's own screen also tells the page. */
export function scoreEvent(ctx: LevelCtx, game: LoftGame, toy: Toy, score: number, fin: boolean) {
  if (!toy.c.human) return
  ctx.emit({ k: 'score', g: game, i: toy.idx, v: score, fin: fin ? 1 : 0 })
}

/** What the Loft runs for each hidden game. */
export interface LoftActivity<S> {
  id: LoftGame
  /** Every screen: colliders and visuals (same layout everywhere). */
  build(ctx: LevelCtx): void
  init(ctx: LevelCtx): S
  /** Host, 60 Hz. */
  tick(ctx: LevelCtx, s: S, dt: number): void
  /** Every screen, every frame. */
  visual(ctx: LevelCtx, s: S, dt: number): void
  pack(s: S): unknown
  unpack(ctx: LevelCtx, s: S, d: unknown): void
  /** HUD bits for this screen's toy (null when it isn't near or playing). */
  hud(ctx: LevelCtx, s: S, me: Toy): LevelHud | null
  /** Place the camera for this screen's player (return true if it did). */
  camera?(ctx: LevelCtx, s: S, cam: CamRig, me: Toy, dt: number): boolean
  /** Level events (ctx.emit) for this game. */
  onEvent?(ctx: LevelCtx, s: S, d: Record<string, unknown>): void
  /** Host: drive a bot that is near or in this game; return true if it did. */
  bot?(ctx: LevelCtx, s: S, toy: Toy, dt: number): boolean
  dispose?(ctx: LevelCtx, s: S): void
}

/** The HUD line for someone standing near a station who isn't playing. */
export function nearPrompt(ctx: LevelCtx, st: Station, me: Toy, title: string, score: string): LevelHud {
  const qi = st.queue.indexOf(me.idx)
  const p = st.player >= 0 ? ctx.toys[st.player] : null
  if (qi >= 0) return { status: { text: title, color: '#93c5fd' }, prompt: `You're #${qi + 1} in line${p ? ` · ${p.name} is playing (${score})` : ''}`, chips: [] }
  if (p) return { status: { text: title, color: '#fde68a' }, prompt: `${p.name} is playing (${score}) · R (Act) to queue`, chips: [] }
  return { status: { text: title, color: '#86efac' }, prompt: 'R (Act) to play', chips: [] }
}
