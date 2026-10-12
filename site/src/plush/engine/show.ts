// The Show: plan rounds from the level registry by type, decide how many go through each round, and hand out
// the end-of-Show awards and buttons. Pure logic (no three.js), shared by the engine and the page.
import type { Rng } from './rng'
import type { AnyLevel, Contestant, LevelType, Spice } from './types'
import type { Outfit } from '../wardrobe/catalog'

export interface ShowSettings {
  /** Toys in a Show, people first; bots fill the rest. */
  size: number
  /** Bot skill: 0 easy, 1 normal, 2 hard. */
  difficulty: number
  spice: Spice
  /** Rounds including the final (3 to 5). */
  rounds: number
  /** Toy Box Trail: toys at the table (2 to 6, people first). */
  boardSize?: number
}

export const DEFAULT_SETTINGS: ShowSettings = { size: 8, difficulty: 1, spice: 1, rounds: 3, boardSize: 4 }
export const MAX_SHOW = 16
/** People per online room (peer-to-peer holds about this many comfortably). */
export const MAX_PEOPLE = 8

export interface RoundPlan {
  levelId: string
  final: boolean
  /** Chosen by hand (tests: forceRound), so the engine never swaps it for a better-fitting final. */
  forced?: boolean
}

/** Round slots by Show length: the field shrinks race → survival → team/logic → survival → crown final. */
const SLOTS: Record<number, LevelType[][]> = {
  2: [['race', 'survival'], ['final']],
  3: [['race', 'survival'], ['team', 'logic'], ['final']],
  4: [['race'], ['survival'], ['team', 'logic'], ['final']],
  5: [['race'], ['survival'], ['team', 'logic'], ['survival'], ['final']],
}

const playable = (l: AnyLevel, n: number) => l.type !== 'hub' && l.type !== 'hidden' && n >= l.players[0] - 0 && n <= l.players[1]

const fitsCount = (l: AnyLevel, n: number) => n >= l.players[0] && n <= l.players[1]

/**
 * The crown round for `field` toys: a real final (type 'final') that fits the field, else a survival level that
 * can crown a winner (canBeFinal), else any final, else anything playable. `avoid` skips levels already played.
 */
export function pickFinal(levels: readonly AnyLevel[], field: number, rng: Rng, avoid: ReadonlySet<string> = new Set()): AnyLevel {
  const fresh = (l: AnyLevel) => !avoid.has(l.id) && l.type !== 'hub' && l.type !== 'hidden'
  const tiers = [
    levels.filter((l) => fresh(l) && l.type === 'final' && fitsCount(l, field)),
    levels.filter((l) => fresh(l) && !!l.canBeFinal && fitsCount(l, field)),
    levels.filter((l) => fresh(l) && (l.type === 'final' || !!l.canBeFinal) && field <= l.players[1]),
    levels.filter((l) => fresh(l) && fitsCount(l, field)),
    levels.filter((l) => l.type !== 'hub' && l.type !== 'hidden'),
  ]
  for (const t of tiers) if (t.length) return rng.pick(t)
  return levels[0]
}

/** How many toys should reach the final of a Show of `size` toys over `rounds` rounds (if nobody drops early). */
export function expectedFinalField(size: number, rounds: number) {
  const n = Math.max(2, Math.min(5, rounds))
  let field = size
  for (let i = 0; i < n - 1; i++) field = roundTarget(field, n - i, false, size)
  return Math.max(2, field)
}

/**
 * Pick a level per round. The final is reserved first: a real final (type 'final') that fits the expected final
 * field when one exists, else a crown-capable survival level. The engine re-checks the final against the toys
 * actually left when it gets there (see `pickFinal`).
 */
export function planShow(levels: readonly AnyLevel[], size: number, rounds: number, rng: Rng): RoundPlan[] {
  const slots = SLOTS[Math.max(2, Math.min(5, rounds))]
  const used = new Set<string>()
  const pool = levels.filter((l) => playable(l, Math.min(size, l.players[1])))
  const final = pickFinal(pool.length ? pool : levels, expectedFinalField(size, rounds), rng)
  used.add(final.id)
  const plan: RoundPlan[] = []
  for (let i = 0; i < slots.length - 1; i++) {
    const want = slots[i]
    const fits = pool.filter((l) => want.includes(l.type) && !used.has(l.id))
    const any = pool.filter((l) => l.type !== 'final' && !used.has(l.id))
    const pick = fits.length ? rng.pick(fits) : any.length ? rng.pick(any) : rng.pick(pool.filter((l) => l.type !== 'final'))
    used.add(pick.id)
    plan.push({ levelId: pick.id, final: false })
  }
  plan.push({ levelId: final.id, final: true })
  return plan
}

/**
 * How many go through a round. The field shrinks evenly towards the final (which crowns one), and at least
 * two always reach the final.
 */
export function roundTarget(field: number, roundsLeft: number, final: boolean, showSize: number) {
  if (final) return 1
  // About a third of the Show reaches the final (2 to 6 toys). roundsLeft counts this round and the final.
  const finalField = Math.max(2, Math.min(6, Math.round(showSize / 3)))
  const keep = Math.pow(Math.min(1, finalField / Math.max(2, field)), 1 / Math.max(1, roundsLeft - 1))
  return Math.max(2, Math.min(field - 1, Math.round(field * keep)))
}

/**
 * Two balanced random teams for a team round: people are spread across both sides first, then bots fill in so
 * the sizes differ by at most one. Returns the team of each toy, in order.
 */
export function assignTeams(humans: readonly boolean[], rng: Rng): number[] {
  const n = humans.length
  const out = new Array<number>(n).fill(0)
  const order = rng.shuffle([...Array(n).keys()])
  const people = order.filter((i) => humans[i])
  const bots = order.filter((i) => !humans[i])
  const first = rng.int(0, 2)
  const size = [0, 0]
  for (const i of [...people, ...bots]) {
    // The smaller side takes the next toy; ties alternate from a random first side.
    const t = size[0] === size[1] ? (size[0] + size[1] + first) % 2 : size[0] < size[1] ? 0 : 1
    out[i] = t
    size[t]++
  }
  return out
}

export const TEAM_DEFAULTS = { names: ['Buttons', 'Bobbins'] as [string, string], colors: ['#ef4444', '#3b82f6'] as [string, string] }

export interface Award {
  id: 'menace' | 'betrayed' | 'revenge' | 'saint' | 'crown'
  title: string
  blurb: string
  who: number
  buttons: number
}

export interface ShowResults {
  /** Contestant indices in finishing order (winner first). */
  order: number[]
  awards: Award[]
  /** Buttons earned per contestant index. */
  buttons: Record<number, number>
  rows: { idx: number; name: string; tint: string; kind: string; human: boolean; place: number; outRound: number; stats: Contestant['stats'] }[]
  quick: boolean
  levelName: string
  /** Kicker on the results card for game modes (e.g. 'Toy Box Trail'). */
  title?: string
}

/** End-of-Show awards and buttons (soft currency). */
export function awardsFor(roster: readonly Contestant[], order: number[], quick: boolean, levelName = ''): ShowResults {
  const awards: Award[] = []
  const top = (f: (c: Contestant) => number) => {
    let best: Contestant | null = null
    for (const c of roster) if (f(c) > 0 && (!best || f(c) > f(best))) best = c
    return best
  }
  const winner = roster[order[0]]
  if (winner && !quick) awards.push({ id: 'crown', title: 'Top of the Pile', blurb: 'Won the Show', who: winner.idx, buttons: 40 })
  const menace = top((c) => c.stats.menace)
  if (menace) awards.push({ id: 'menace', title: 'Biggest Menace', blurb: `${menace.stats.menace} sabotage hits`, who: menace.idx, buttons: 15 })
  const betrayed = top((c) => c.stats.betrayed)
  if (betrayed) awards.push({ id: 'betrayed', title: 'Most Betrayed', blurb: `Sabotaged ${betrayed.stats.betrayed} times`, who: betrayed.idx, buttons: 15 })
  const revenge = top((c) => c.stats.revenge)
  if (revenge) awards.push({ id: 'revenge', title: 'Revenge Served', blurb: `${revenge.stats.revenge} grudges paid back`, who: revenge.idx, buttons: 15 })
  if (winner && winner.stats.tricks === 0) awards.push({ id: 'saint', title: 'Saint', blurb: 'Won without sabotaging anyone', who: winner.idx, buttons: 25 })
  const buttons: Record<number, number> = {}
  order.forEach((idx, place) => {
    const c = roster[idx]
    buttons[idx] = (place === 0 ? 30 : place === 1 ? 18 : place === 2 ? 12 : 6) + (c?.stats.roundsQualified ?? 0) * 5
  })
  for (const a of awards) buttons[a.who] = (buttons[a.who] ?? 0) + a.buttons
  const rows = order.map((idx, place) => {
    const c = roster[idx]
    return { idx, name: c.name, tint: c.tint, kind: c.kind, human: c.human, place: place + 1, outRound: c.outRound, stats: { ...c.stats } }
  })
  return { order, awards, buttons, rows, quick, levelName }
}

/* ---------- Saved profile (this browser) ---------- */

export interface Profile {
  name: string
  kind: string
  tint: string
  buttons: number
  shows: number
  wins: number
  settings: ShowSettings
  /** Sewing Table: what you wear, and the items you own (free ones are always owned). */
  outfit?: Outfit
  owned?: string[]
  /** End-of-Show awards won, by award id (the Loft notice board shows Biggest Menace). */
  awards?: Record<string, number>
}

/** A change to the saved profile: fields to merge, or a function of the current profile (buying, rewards). */
export type ProfilePatch = Partial<Profile> | ((prev: Profile) => Partial<Profile>)

const KEY = 'pp-profile'

export const TINTS = ['#ffffff', '#f87171', '#fb923c', '#facc15', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#9ca3af', '#7c5c3b']

export function loadProfile(): Profile {
  const fallback: Profile = { name: 'Stitchling', kind: 'sock', tint: '#ffffff', buttons: 0, shows: 0, wins: 0, settings: { ...DEFAULT_SETTINGS } }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as Partial<Profile>
    return { ...fallback, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } }
  } catch {
    return fallback
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private mode: progress just isn't remembered.
  }
}

const BOT_NAMES = [
  'Button', 'Pip', 'Mittens', 'Noodle', 'Biscuit', 'Fuzz', 'Patches', 'Bobbin', 'Thimble', 'Waffle', 'Pudding', 'Velcro', 'Scrap', 'Ruffle', 'Tuft', 'Lint',
  'Pompom', 'Doodle', 'Snuggs', 'Toffee',
]

export function botName(i: number, taken: Set<string>) {
  for (let k = 0; k < BOT_NAMES.length; k++) {
    const n = BOT_NAMES[(i + k) % BOT_NAMES.length]
    if (!taken.has(n)) return n
  }
  return `Bot ${i + 1}`
}
