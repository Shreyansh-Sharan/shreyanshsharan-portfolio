// Loft high scores, kept in this browser (localStorage). Your own bests feed the challenge unlocks; the board
// keeps the top five per game that this browser has seen, yours and other players' in your online rooms, and
// is pinned to the Loft's notice board. A tiny subscribe API lets the 3D board and the HUD redraw on change.

export const LOFT_GAMES = ['freeze', 'vine', 'bowl', 'claw'] as const
export type LoftGame = (typeof LOFT_GAMES)[number]

export const LOFT_GAME_INFO: Record<LoftGame, { name: string; unit: string; zone: string }> = {
  freeze: { name: 'Freeze Dance', unit: 'in a row', zone: 'Disco Closet' },
  vine: { name: 'Vine Swing', unit: 'm', zone: 'Houseplant Jungle' },
  bowl: { name: 'Bath Bomb Bowling', unit: 'pts', zone: 'Bathtub Beach' },
  claw: { name: 'Button Claw', unit: 'prizes', zone: 'Cardboard Arcade' },
}

export interface BoardEntry {
  name: string
  score: number
  /** Date.now() when it was set. */
  at: number
  /** Set on this browser by its own player. */
  me?: boolean
}

export interface LoftRecords {
  best: Record<LoftGame, number>
  board: Record<LoftGame, BoardEntry[]>
  /** Local date (YYYY-MM-DD) of the last Button Claw prize. */
  clawDay: string
  plays: Record<LoftGame, number>
}

const KEY = 'pp-loft'
let cache: LoftRecords | null = null
let version = 0
const subs = new Set<() => void>()

function fresh(): LoftRecords {
  return {
    best: { freeze: 0, vine: 0, bowl: 0, claw: 0 },
    board: { freeze: [], vine: [], bowl: [], claw: [] },
    clawDay: '',
    plays: { freeze: 0, vine: 0, bowl: 0, claw: 0 },
  }
}

export function loadRecords(): LoftRecords {
  if (cache) return cache
  const f = fresh()
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<LoftRecords>
      cache = { best: { ...f.best, ...(p.best ?? {}) }, board: { ...f.board, ...(p.board ?? {}) }, clawDay: p.clawDay ?? '', plays: { ...f.plays, ...(p.plays ?? {}) } }
      return cache
    }
  } catch {
    // Private mode or a bad save: start fresh.
  }
  cache = f
  return cache
}

function save() {
  version++
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Not remembered in private mode.
  }
  for (const f of subs) f()
}

export function recordsVersion() {
  return version
}

export function onRecords(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

/** A finished game. `me` marks this browser's own player (bests and challenges); everyone goes on the board. */
export function recordScore(game: LoftGame, name: string, score: number, me: boolean, fin = true) {
  const r = loadRecords()
  let best = false
  if (me) {
    if (fin) r.plays[game]++
    if (score > r.best[game]) {
      r.best[game] = score
      best = true
    }
  }
  if (score > 0) {
    const list = r.board[game]
    list.push({ name: name.slice(0, 16), score, at: Date.now(), me: me || undefined })
    list.sort((a, b) => b.score - a.score || a.at - b.at)
    // One line per name: keep each toy's best.
    const seen = new Set<string>()
    r.board[game] = list.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true))).slice(0, 5)
  }
  save()
  return { best }
}

/** Today's date in this browser's time zone. */
export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function clawReady() {
  return loadRecords().clawDay !== today()
}

/** Claim today's claw prize (false if it was already claimed today). */
export function claimClaw() {
  const r = loadRecords()
  if (r.clawDay === today()) return false
  r.clawDay = today()
  r.best.claw++
  save()
  return true
}

/** Tests: reset the daily claw. */
export function resetClaw() {
  loadRecords().clawDay = ''
  save()
}
