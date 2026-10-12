// The PLUSH PANIC level API. A level is one module that exports `defineLevel({...})`; the engine (game.ts)
// owns rendering, physics, toys, input, networking, the Show flow and the shared sabotage system, and calls
// the level's hooks. See ../README.md for a walkthrough and a worked example.
import type * as THREE from 'three'
import type { Phys, Rapier, RigidBody } from './physics'
import type { Rng } from './rng'
import type { PlushAssets, ToyKind } from './assets'
import type { BodyMode, Toy } from './toy'
import type { Hazards } from './hazards'
import type { CamRig } from './camera'

export type { Toy, BodyMode } from './toy'
export type { ToyKind } from './assets'

/** Round types, as in the design: the Show draws rounds by type. `hub` is the Loft. */
export type LevelType = 'race' | 'survival' | 'team' | 'logic' | 'final' | 'hidden' | 'hub'

/**
 * How a round is being played. `quick` = Quick Play (no eliminations: fails retry), `hub` = the Loft, `board` =
 * a turn-based mode that runs as one long round (Toy Box Trail). Duels and table mini-games launched from a
 * board run as `quick` rounds with `ctx.duel` set.
 */
export type PlayMode = 'show' | 'quick' | 'hub' | 'board'

/** Set on a round that runs a level as a timed duel or table mini-game (see LevelCtx.startDuel). */
export interface DuelInfo {
  /** Round length in seconds (replaces the level's own duration). */
  seconds: number
  /** true: the whole table plays (everyone is ranked); false: a 1v1 or 1v1v1 duel (first through wins). */
  party: boolean
  /** Free text the caller passes through to the result (e.g. 'duel' or 'party'). */
  tag: string
}

/** Ask the engine to play a registered level as a timed duel (host only). */
export interface DuelSpec {
  levelId: string
  /** Contestant (roster) indices taking part. */
  toys: number[]
  /** Default: the level's `duel.seconds`, else 30. */
  seconds?: number
  party?: boolean
  tag?: string
}

/** How a duel went: handed to the caller level's `onDuelEnd` when its round resumes. */
export interface DuelResult {
  levelId: string
  levelName: string
  tag: string
  party: boolean
  /** Contestant indices that took part. */
  toys: number[]
  /** Contestant indices, best first: whoever got through first, then the level's rank(), then the rest. */
  order: number[]
  /** order[0]. */
  winner: number
}

/** A level that runs its own game mode (Toy Box Trail) can hand the engine the final results. */
export interface ModeResults {
  /** Contestant indices, winner first. */
  order: number[]
  /** Extra buttons per contestant on top of the placing and award buttons. */
  buttons?: Record<number, number>
  /** Kicker on the results card (default: 'Show results'). */
  title?: string
  /** Rename the winner's award (default 'Top of the Pile'). */
  crown?: { title: string; blurb: string }
}

/** 0 mild, 1 normal, 2 mean. */
export type Spice = 0 | 1 | 2
export const SPICE_NAMES = ['Mild', 'Normal', 'Mean'] as const

/** Peanut-gallery throwables. */
export type ThrowKind = 'crumb' | 'paper' | 'feather'
export const THROW_KINDS: ThrowKind[] = ['crumb', 'paper', 'feather']

/** Icons the HUD knows how to draw for tricks (lucide icons, mapped in the UI). */
export type TrickIcon =
  | 'crumb' | 'slam' | 'milk' | 'paw' | 'crack' | 'swap' | 'bubble' | 'tickle' | 'key' | 'tack' | 'magnet' | 'zap' | 'star'

/** One player in a Show, persistent across rounds (a Toy is their body in one round). */
export interface Contestant {
  /** Index in the roster. */
  idx: number
  /** 'host', a peer id, or 'bot-N'. */
  id: string
  name: string
  kind: ToyKind
  tint: string
  human: boolean
  /** Eliminated from the Show (sits in the peanut gallery). */
  out: boolean
  /** Round they went out in (-1 still in). */
  outRound: number
  /** Final placing in the Show (1 = winner), set at the end. */
  place: number
  stats: ContestantStats
}

export interface ContestantStats {
  /** Sabotage hits landed on rivals (tricks that weren't blocked, plus gallery hits). */
  menace: number
  /** Times sabotaged. */
  betrayed: number
  /** Grudges paid back (a trick on whoever last hit you). */
  revenge: number
  /** Tricks used at all (Saint = won with zero). */
  tricks: number
  shoves: number
  throws: number
  roundsQualified: number
}

export function freshStats(): ContestantStats {
  return { menace: 0, betrayed: 0, revenge: 0, tricks: 0, shoves: 0, throws: 0, roundsQualified: 0 }
}

/** A spawn point: feet position and facing. */
export interface Spawn {
  x: number
  y: number
  z: number
  yaw: number
}

/** Camera presets. Levels with special views (Cookie Cutter) implement `camera()` instead. */
export type CameraPreset =
  | { kind: 'chase'; dist?: number; height?: number; pitch?: number }
  | { kind: 'overhead'; height: number; back: number; follow?: number }
  | { kind: 'fixed'; pos: [number, number, number]; look: [number, number, number] }

/** Level-specific HUD pieces, drawn by the shared HUD. */
export interface LevelHud {
  /** Meters, e.g. Cookie Cutter's crack meter. value is 0..1. */
  bars?: { label: string; value: number; color: string; danger?: boolean }[]
  /** A big status pill, e.g. "MUSIC" / "FREEZE!". */
  status?: { text: string; color: string; pulse?: boolean }
  /** A hint line near the bottom, e.g. "Brush the crumb: R or two quick swipes". */
  prompt?: string
  /** Small chips under the timer, e.g. "Table shrinks in 8 s". */
  chips?: string[]
  /** Anything else for a level-specific HUD panel (Toy Box Trail's board panel reads this). */
  extra?: unknown
}

/**
 * A dirty trick. The engine checks the wallet, cooldown, once-per-round and `can`, charges the cost (half
 * price on the toy you hold a grudge against), applies Bubble Wrap (blocks and bounces the trick back), records
 * grudges and stats, ties the user up for `busy` seconds, then calls `apply` on the host.
 */
export interface TrickDef<S = unknown> {
  id: string
  name: string
  icon: TrickIcon
  /** Sprinkles (or whatever the level calls its resource). */
  cost: number
  /** Seconds before this toy can use it again. */
  cooldown: number
  /** Seconds the user is tied up afterwards (needle lifted, paws busy). The engine sets toy.busy. */
  busy?: number
  /** 'rival' needs a target toy, 'self' acts on the user, 'none' is global. */
  target: 'rival' | 'self' | 'none'
  /** For 'rival': max distance in metres (default: anywhere in the arena). */
  range?: number
  /** Only from this spice level up (0 mild, 1 normal, 2 mean). */
  minSpice?: Spice
  /** Once per round. */
  once?: boolean
  /** Bubble Wrap can block it (default true for 'rival'). */
  blockable?: boolean
  /** What it does to them. */
  desc: string
  /** How they fight back (shown on the intro card and in the trick tooltip). */
  counter: string
  /** Hide the button entirely for this toy right now (e.g. the music key only for whoever holds it). */
  hidden?: (ctx: LevelCtx, state: S, user: Toy) => boolean
  /** Extra rule: return true, or a short reason why not ("Only when you're behind"). */
  can?: (ctx: LevelCtx, state: S, user: Toy, target: Toy | null) => true | string
  /** The effect (host only). `target` is null for 'self'/'none'. */
  apply: (ctx: LevelCtx, state: S, user: Toy, target: Toy | null) => void
  /** Bot heuristic: return the target to use it on (null for self/none tricks), or false to hold off. */
  botUse?: (ctx: LevelCtx, state: S, user: Toy) => Toy | null | false
}

/** Effects every screen sees. Calls on the host are mirrored to clients through the snapshot event list. */
export interface FxApi {
  /** Dust (kind 'dust'), stuffing ('stuff'), sparkles ('spark') or a coloured puff. */
  puff(pos: THREE.Vector3Like, kind?: 'dust' | 'stuff' | 'spark' | 'crumbs' | 'milk', n?: number): void
  confetti(pos: THREE.Vector3Like): void
  /** Camera shake; with `toy`, only on that toy's screen. */
  shake(amount: number, toy?: Toy): void
  /** Short procedural sound: 'boop', 'squeak', 'pop', 'crunch', 'cheer', 'whoosh', 'thud', 'ding', 'buzz', 'zap', 'tick', 'snip', 'slam', 'splash', 'crack', 'wind', 'boing'. */
  sfx(name: string, pos?: THREE.Vector3Like, toy?: Toy): void
  /** Big centre banner; with `toy`, only on that toy's screen. */
  say(text: string, color?: string, seconds?: number, toy?: Toy): void
  /** A line in the feed (sabotage log). */
  feed(text: string): void
  /** Floating text over a toy. */
  popup(toy: Toy, text: string, color?: string): void
  /** Freeze-frame for a heartbeat on big hits (visual only). */
  hitStop(seconds?: number): void
}

/** What a level sees. Implemented by the engine; the same object is passed to every hook. */
export interface LevelCtx {
  readonly THREE: typeof THREE
  readonly RAPIER: Rapier
  /** Add level visuals under this group (it is cleared between rounds). */
  readonly root: THREE.Group
  readonly scene: THREE.Scene
  readonly phys: Phys
  readonly assets: PlushAssets
  /** Seeded: identical on every screen while building; on the host it keeps going during play. */
  readonly rng: Rng
  readonly seed: number
  readonly mode: PlayMode
  /** 'solo' and 'host' run the rules; 'client' only draws (tick() never runs there). */
  readonly role: 'solo' | 'host' | 'client'
  readonly isHost: boolean
  /** 0 easy, 1 normal, 2 hard (bots). */
  readonly difficulty: number
  readonly spice: Spice
  /** Shadows and particle budgets are lower on 'low'. */
  readonly quality: 'low' | 'high'
  /** Every toy in this round (failed ones included; check toy.status). */
  readonly toys: readonly Toy[]
  /** This screen's toy, or null when spectating. */
  readonly me: Toy | null
  /** How many toys go through this round (1 in a final). */
  readonly target: number
  readonly round: { index: number; total: number; final: boolean }
  /** Seconds since play began (synced on clients). Negative during the countdown. */
  readonly time: number
  /** Seconds left on the round timer. */
  readonly timeLeft: number
  readonly phase: 'intro' | 'countdown' | 'play' | 'end'
  /** This screen's free pointer on the pointer plane (free-pointer levels), for drawing without network delay. */
  readonly pointer: { x: number; z: number; down: boolean }
  /** Effects for everyone: on the host they are mirrored to clients. Use from tick(), tricks and other host code. */
  readonly fx: FxApi
  /** Effects for this screen only. Use from visual() and onEvent(), which already run on every screen. */
  readonly fxLocal: FxApi
  readonly hazards: Hazards
  readonly cam: CamRig
  /**
   * The procedural wind-up music box (an original waltz). Local to each screen: drive it from synced level
   * state in visual(), so every screen hears the same thing. It stops between rounds.
   */
  readonly music: { start(tempo: number): void; windDown(seconds: number): void; stop(): void; readonly playing: boolean }
  /** Set when this round is a timed duel or table mini-game launched by another level (null otherwise). */
  readonly duel: DuelInfo | null
  /**
   * Scratch space that survives from round to round until the player goes back to the Loft or starts something
   * new. A board keeps its game here while a duel runs. Each screen has its own (clients refill it via unpack).
   */
  readonly session: Record<string, unknown>

  /* ----- Results (host) ----- */
  /** This toy is through (race finish, shape cut out). */
  qualify(toy: Toy, note?: string): void
  /** This toy is out. In Quick Play this calls the level's `retry()` instead (default: back to spawn). */
  fail(toy: Toy, reason: string): void
  /** End the round now (the engine sorts out who is through: see LevelDef.rank). */
  end(): void
  /** Toys still playing: not qualified, not failed. */
  active(): Toy[]
  qualifiedCount(): number

  /* ----- Toys (host) ----- */
  addSprinkles(toy: Toy, n: number, why?: string): void
  /** Push a toy (velocity change) and stun it. `by` gets the blame (grudge). */
  knock(toy: Toy, impulse: THREE.Vector3Like, stun: number, by?: Toy | null): void
  /** Put a toy back at a spawn point (its own by default) with a short stun. */
  respawn(toy: Toy, at?: Spawn, stun?: number): void
  setBodyMode(toy: Toy, mode: BodyMode): void
  /** Record that `by` hit `victim` (for grudges and awards) without pushing anyone. */
  blame(victim: Toy, by: Toy): void

  /* ----- Sync ----- */
  /** Send a level event to every screen (or one toy's screen): arrives in onEvent(). */
  emit(data: unknown, to?: Toy): void
  /** A dynamic body whose transform is streamed to clients and copied onto `obj` every frame. */
  syncProp(body: RigidBody, obj: THREE.Object3D): void
  /** Like syncProp, and toys can pick it up with Grab (E) and throw it by letting go. */
  grabbable(body: RigidBody, obj: THREE.Object3D): void
  /** Hub only: tell the page something happened (e.g. 'chest' when a toy jumps in the toy chest). */
  signal(name: string, toy: Toy | null): void
  /**
   * Host: pause this level and play another registered level as a timed duel (or a whole-table mini-game).
   * The swap happens at the start of the next frame. When the duel ends the engine rebuilds this level (its
   * state comes back from `ctx.session`, skipping the intro) and calls `onDuelEnd`. Returns false if the
   * level is unknown or a duel is already pending.
   */
  startDuel(spec: DuelSpec): boolean
  /** Levels that can be played as a duel / mini-game by `n` toys (registered, not hub/hidden, `duel` not false). */
  duelLevels(n: number): { id: string; name: string; type: LevelType }[]

  /* ----- Helpers ----- */
  spawnGrid(n: number, opts: { x: number; z: number; y?: number; yaw: number; spacing?: number; cols?: number }): Spawn[]
  spawnRing(n: number, opts: { x: number; z: number; y?: number; radius: number; faceIn?: boolean }): Spawn[]
  /** The toy nearest `pos` (optionally only those passing `filter`). */
  nearest(pos: THREE.Vector3Like, filter?: (t: Toy) => boolean): Toy | null
  /** Who is winning right now (LevelDef.rank, or qualified first). */
  leader(except?: Toy): Toy | null
}

/** Everything a level module declares. Only id/name/type/build/init are required. */
export interface LevelDef<S = unknown> {
  id: string
  name: string
  type: LevelType
  /** One line for the menu and the intro card. */
  blurb: string
  /** Two to four short lines for the intro card. */
  howTo: string[]
  /** Accent colour for cards and banners. */
  accent: string
  /** Fewest and most toys it works with. */
  players: [number, number]
  /** Round timer in seconds. */
  duration: number
  /** A survival level that can also crown a winner (used when no 'final' level fits). */
  canBeFinal?: boolean
  /** How toys move here (default 'walk'). */
  bodyMode?: BodyMode
  /** Top running speed in m/s for this level (default 5.6). */
  runSpeed?: number
  /** 'look' (default): pointer lock + mouse-look. 'free': the pointer stays visible (tracing, clicking plates). */
  pointer?: 'look' | 'free'
  /** Height of the plane the free pointer is projected onto. */
  pointerPlaneY?: number
  camera?: CameraPreset
  /** The slow fly-round during the intro card (default: radius 15, height 9 round the origin). */
  introOrbit?: { radius: number; height: number; center?: [number, number, number] }
  /** Sabotage resource: what each toy starts with. */
  sprinkles?: { start: number; name?: string }
  tricks?: TrickDef<S>[]
  /** Which gallery throwables work here (default all). */
  throwables?: ThrowKind[]
  /** Below this height a toy has fallen (default -8). */
  fallY?: number
  /** Keep eliminated toys in the scene (e.g. slumped at their plate) instead of poofing them away. */
  keepFailed?: boolean
  /** Background colour / fog for the level (defaults to the attic's warm haze). */
  sky?: { color: string; fogNear: number; fogFar: number }
  /** As a board duel / mini-game: false opts out; `seconds` sets its length (default 30). */
  duel?: false | { seconds?: number }

  /** Build colliders and visuals. Runs on every screen with the same seed, so it must only use ctx.rng. */
  build(ctx: LevelCtx): void
  /** Initial level state. Runs on every screen (clients overwrite it from snapshots via unpack). */
  init(ctx: LevelCtx): S
  /** Where toy i of n starts. Default: a grid at the origin. */
  spawn?(ctx: LevelCtx, state: S, toy: Toy, i: number, n: number): Spawn
  /** After the toys exist (set body modes, seats). Every screen. */
  setup?(ctx: LevelCtx, state: S): void
  /** When the countdown ends and play begins. Host only. */
  start?(ctx: LevelCtx, state: S): void
  /** The rules: fixed 60 Hz on the host while playing. */
  tick?(ctx: LevelCtx, state: S, dt: number): void
  /** Animate visuals from the state, every rendered frame on every screen. */
  visual?(ctx: LevelCtx, state: S, dt: number): void
  /** Drive a bot: write toy.pad (move, jump, dive, shove, grab, act, pointer). Host only. */
  bot?(ctx: LevelCtx, state: S, toy: Toy, dt: number): void
  /** Active toys, best first: decides the leader, timeouts and Quick Play placings. */
  rank?(ctx: LevelCtx, state: S): Toy[]
  /** Time ran out. Default: survival-type levels put every active toy through; others go by rank. */
  onTimeUp?(ctx: LevelCtx, state: S): void
  /** A toy fell below fallY. Default: fail() in survival levels, respawn elsewhere. */
  onFall?(ctx: LevelCtx, state: S, toy: Toy): void
  /** Quick Play: what happens instead of elimination (default: respawn at spawn). */
  retry?(ctx: LevelCtx, state: S, toy: Toy, reason: string): void
  /** Compact state for clients (~20 Hz). Keep it small: numbers and short arrays. */
  pack?(ctx: LevelCtx, state: S): unknown
  unpack?(ctx: LevelCtx, state: S, data: unknown): void
  /** Level events from ctx.emit(), on every screen (host included). */
  onEvent?(ctx: LevelCtx, state: S, data: unknown): void
  hud?(ctx: LevelCtx, state: S, me: Toy | null): LevelHud | null
  /** Free-pointer levels: where a keyboard/stick-driven pointer starts for this toy. */
  pointerHome?(ctx: LevelCtx, state: S, me: Toy): { x: number; z: number }
  /** Free-pointer levels: which rival a click at `point` (on the pointer plane) picks. Default: nearest toy. */
  pick?(ctx: LevelCtx, state: S, point: THREE.Vector3): Toy | null
  /** Place the camera yourself; return true if you did (else the preset runs). */
  cameraUpdate?(ctx: LevelCtx, state: S, cam: CamRig, dt: number): boolean
  /** Can the gallery throw `kind` at `target` right now? */
  canThrow?(ctx: LevelCtx, state: S, kind: ThrowKind, target: Toy): boolean
  /** A gallery throw landed. Return true if handled; otherwise the engine's default nudge applies. Host only. */
  onThrow?(ctx: LevelCtx, state: S, kind: ThrowKind, target: Toy, from: Contestant): boolean
  /** Host: the duel this level started with ctx.startDuel() is over (runs right after the level is rebuilt). */
  onDuelEnd?(ctx: LevelCtx, state: S, result: DuelResult): void
  /**
   * Host: a player sent a level action (from `game.levelAction(text)` on their screen: buttons in a level's own
   * HUD panel). `toy` is their toy in this round (null if they have none).
   */
  onAction?(ctx: LevelCtx, state: S, toy: Toy | null, action: string, contestant: number): void
  /** Host: when the round ends, show these results instead of the Show/Quick Play results (game modes). */
  results?(ctx: LevelCtx, state: S): ModeResults
  /** Free anything not under ctx.root (audio nodes, DOM). Every screen. */
  dispose?(ctx: LevelCtx, state: S): void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLevel = LevelDef<any>

/** Identity helper that keeps the state type checked inside the level module. */
export function defineLevel<S>(def: LevelDef<S>): AnyLevel {
  return def as AnyLevel
}
