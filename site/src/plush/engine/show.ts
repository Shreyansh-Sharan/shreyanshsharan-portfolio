// The Show: plan rounds from the level registry by type, decide how many go through each round, and hand out
// the end-of-Show awards and buttons. Pure logic (no three.js), shared by the engine and the page.
import type { Rng } from './rng'
import type { AnyLevel, Contestant, LevelType, Spice } from './types'

export interface ShowSettings {
  /** Toys in a Show, people first; bots fill the rest. */
  size: number
  /** Bot skill: 0 easy, 1 normal, 2 hard. */
  difficulty: number
  spice: Spice
  /** Rounds including the final (3 to 5). */
  rounds: number
}

export const DEFAULT_SETTINGS: ShowSettings = { size: 8, difficulty: 1, spice: 1, rounds: 3 }
export const MAX_SHOW = 16
/** People per online room (peer-to-peer holds about this many comfortably). */
export const MAX_PEOPLE = 8

export interface RoundPlan {
  levelId: string
  final: boolean
}

/** Round slots by Show length: the field shrinks race → survival → team/logic → survival → crown final. */
const SLOTS: Record<number, LevelType[][]> = {
  2: [['race', 'survival'], ['final']],
  3: [['race', 'survival'], ['team', 'logic'], ['final']],
  4: [['race'], ['survival'], ['team', 'logic'], ['final']],
  5: [['race'], ['survival'], ['team', 'logic'], ['survival'], ['final']],
}

const playable = (l: AnyLevel, n: number) => l.type !== 'hub' && l.type !== 'hidden' && n >= l.players[0] - 0 && n <= l.players[1]

/** Pick a level per round. The final is reserved first so a crown-capable level is always left for it. */
export function planShow(levels: readonly AnyLevel[], size: number, rounds: number, rng: Rng): RoundPlan[] {
  const slots = SLOTS[Math.max(2, Math.min(5, rounds))]
  const used = new Set<string>()
  const pool = levels.filter((l) => playable(l, Math.min(size, l.players[1])))
  const finals = pool.filter((l) => l.type === 'final' || l.canBeFinal)
  const final = finals.length ? rng.pick(finals) : rng.pick(pool)
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
}

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
