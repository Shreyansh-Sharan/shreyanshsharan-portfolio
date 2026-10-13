// Progression saved in localStorage: coins and XP from matches, hero levels that unlock perks, cosmetic colours,
// a cosmetic chest from the rewarded ad, three daily jobs, the house customisation (theme, valuables layout,
// trap loadout) and the settings.
import { HERO_IDS, HEROES, heroLevel, type HeroId } from './heroes'
import { THROW_IDS, TRAP_IDS, type ThrowKind, type TrapKind } from './gear'
import type { LayoutId } from './houses'
import { Rng, hashString } from './rng'
import { defaultThrow, defaultTraps } from './sim'

export interface Colour {
  id: string
  name: string
  hex: string
  cost: number
}
export const COLOURS: Colour[] = [
  { id: 'stock', name: 'Stock', hex: '', cost: 0 },
  { id: 'cherry', name: 'Cherry', hex: '#e23c3c', cost: 250 },
  { id: 'lagoon', name: 'Lagoon', hex: '#2fb6c9', cost: 250 },
  { id: 'lime', name: 'Lime', hex: '#8fd14f', cost: 250 },
  { id: 'grape', name: 'Grape', hex: '#8a4fd1', cost: 400 },
  { id: 'tangerine', name: 'Tangerine', hex: '#ff8a2b', cost: 400 },
  { id: 'midnight', name: 'Midnight', hex: '#2a2f55', cost: 600 },
  { id: 'gold', name: 'Gold trim', hex: '#e6c045', cost: 900 },
]

export type HouseTheme = 'lemon' | 'mint' | 'coral' | 'sky' | 'timber' | 'slate'
export const HOUSE_THEMES: Record<HouseTheme, { name: string; siding: string; trim: string; roof: string; door: string }> = {
  lemon: { name: 'Lemon', siding: '#f6e27a', trim: '#ffffff', roof: '#b0623f', door: '#2f7fd6' },
  mint: { name: 'Mint', siding: '#a8e6c3', trim: '#ffffff', roof: '#5f7d8c', door: '#e0533d' },
  coral: { name: 'Coral', siding: '#f4a09a', trim: '#fff4e8', roof: '#8f5a48', door: '#2b9c8a' },
  sky: { name: 'Sky', siding: '#9fd0f5', trim: '#ffffff', roof: '#6c6f91', door: '#f2b53d' },
  timber: { name: 'Timber lodge', siding: '#8a5a37', trim: '#e9d7b9', roof: '#7d5b45', door: '#b7332f' },
  slate: { name: 'Slate lodge', siding: '#5f6a74', trim: '#d9e0e6', roof: '#5e6c7a', door: '#f2b53d' },
}
export const HOUSE_THEME_IDS = Object.keys(HOUSE_THEMES) as HouseTheme[]

export type JobKind = 'win' | 'kos' | 'breaks' | 'traps' | 'ults' | 'matches' | 'hero' | 'robots'
export interface Job {
  id: string
  text: string
  kind: JobKind
  goal: number
  progress: number
  reward: number
  hero?: HeroId
  claimed: boolean
}

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high'
  sensitivity: number
  invertY: boolean
  shake: boolean
  music: boolean
  fov: number
}

export interface House {
  theme: HouseTheme
  layout: LayoutId
  /** Trap loadout per hero (three slots). */
  traps: Partial<Record<HeroId, TrapKind[]>>
  throwKind: Partial<Record<HeroId, ThrowKind>>
}

export interface Profile {
  name: string
  coins: number
  xp: number
  matches: number
  wins: number
  kos: number
  breaks: number
  hero: HeroId
  heroXp: Partial<Record<HeroId, number>>
  colours: Partial<Record<HeroId, string>>
  owned: string[]
  chests: number
  jobs: { date: string; list: Job[] }
  settings: Settings
  house: House
}

const KEY = 'lawn-profile'
export const CHEST_COST = 300

export function defaultProfile(): Profile {
  return {
    name: 'PLAYER',
    coins: 200,
    xp: 0,
    matches: 0,
    wins: 0,
    kos: 0,
    breaks: 0,
    hero: 'dad',
    heroXp: {},
    colours: {},
    owned: [],
    chests: 0,
    jobs: { date: '', list: [] },
    settings: { quality: 'auto', sensitivity: 1, invertY: false, shake: true, music: true, fov: 80 },
    house: { theme: 'lemon', layout: 'classic', traps: {}, throwKind: {} },
  }
}

export function loadProfile(): Profile {
  const d = defaultProfile()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return refreshJobs(d)
    const p = JSON.parse(raw) as Partial<Profile>
    return refreshJobs({ ...d, ...p, settings: { ...d.settings, ...(p.settings ?? {}) }, house: { ...d.house, ...(p.house ?? {}) }, jobs: p.jobs ?? d.jobs })
  } catch {
    return refreshJobs(d)
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private mode: progress lasts for the session only.
  }
}

export function level(xp: number) {
  return 1 + Math.floor(Math.sqrt(xp / 150))
}

export function xpForLevel(l: number) {
  return (l - 1) * (l - 1) * 150
}

export function heroLvl(p: Profile, h: HeroId) {
  return heroLevel(p.heroXp[h] ?? 0)
}

/** Perks unlocked for a hero (0..2). */
export function perksUnlocked(p: Profile, h: HeroId) {
  const l = heroLvl(p, h)
  return HEROES[h].perks.filter((perk) => l >= perk.level).length
}

export function trapsFor(p: Profile, h: HeroId): TrapKind[] {
  const t = p.house.traps[h]
  return t && t.length === 3 ? t : defaultTraps(h)
}

export function throwFor(p: Profile, h: HeroId): ThrowKind {
  return p.house.throwKind[h] ?? defaultThrow(h)
}

export function ownsColour(p: Profile, id: string) {
  return id === 'stock' || p.owned.includes(id)
}

export function buyColour(p: Profile, id: string): Profile | null {
  const c = COLOURS.find((x) => x.id === id)
  if (!c || ownsColour(p, id) || p.coins < c.cost) return null
  return { ...p, coins: p.coins - c.cost, owned: [...p.owned, id] }
}

export function colourHex(p: Profile, h: HeroId) {
  const id = p.colours[h] ?? 'stock'
  const c = COLOURS.find((x) => x.id === id)
  return c && c.hex ? c.hex : HEROES[h].colors[0]
}

/** Open a cosmetic chest: a random colour you don't own yet (or coins when you own them all). */
export function openChest(p: Profile, rng = new Rng((Date.now() ^ 0x5eed) >>> 0)): { profile: Profile; got: string } {
  const missing = COLOURS.filter((c) => c.hex && !p.owned.includes(c.id))
  if (!missing.length) return { profile: { ...p, coins: p.coins + 150 }, got: '150 coins' }
  const c = rng.pick(missing)
  return { profile: { ...p, owned: [...p.owned, c.id] }, got: c.name }
}

/* ---------- Daily jobs ---------- */

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function refreshJobs(p: Profile): Profile {
  const date = today()
  if (p.jobs.date === date && p.jobs.list.length === 3) return p
  const rng = new Rng(hashString(date + 'lawn'))
  const kinds: JobKind[] = ['win', 'kos', 'breaks', 'traps', 'ults', 'matches', 'hero', 'robots']
  const picks = [...kinds].sort(() => rng.next() - 0.5).slice(0, 3)
  const list: Job[] = picks.map((kind, i) => {
    const hero = HERO_IDS[rng.int(HERO_IDS.length)]
    const spec: Record<JobKind, [string, number, number]> = {
      win: ['Win %n matches', 2, 180],
      kos: ['Knock out %n raiders', 12, 150],
      breaks: ['Break %n valuables', 6, 160],
      traps: ['Catch %n raiders in traps', 4, 140],
      ults: ['Use %n ultimates', 5, 120],
      matches: ['Play %n matches', 3, 100],
      hero: [`Play %n matches as ${HEROES[hero].name}`, 2, 150],
      robots: ['Survive %n robot waves', 8, 170],
    }
    const [text, goal, reward] = spec[kind]
    return { id: `${date}-${i}`, text: text.replace('%n', String(goal)), kind, goal, progress: 0, reward, hero: kind === 'hero' ? hero : undefined, claimed: false }
  })
  return { ...p, jobs: { date, list } }
}

export interface MatchStats {
  mode: 'destruction' | 'brawl' | 'robots'
  hero: HeroId
  win: boolean
  kills: number
  deaths: number
  damage: number
  breaks: number
  trapped: number
  ults: number
  score: number
  waves: number
}

export interface Reward {
  coins: number
  xp: number
  heroXp: number
  jobsDone: string[]
  levelUp: boolean
  heroLevelUp: boolean
}

/** Apply a finished match: coins, XP, hero XP, job progress. */
export function applyMatch(p: Profile, s: MatchStats): { profile: Profile; reward: Reward } {
  let coins = 40 + s.kills * 6 + s.breaks * 12 + Math.round(s.score / 10) + (s.win ? 60 : 20) + s.waves * 8
  let xp = 60 + s.kills * 8 + s.breaks * 15 + (s.win ? 90 : 30) + s.waves * 10
  const heroXp = Math.round(xp * 0.6)
  const before = level(p.xp)
  const heroBefore = heroLvl(p, s.hero)
  const jobsDone: string[] = []
  const jobs = p.jobs.list.map((j) => {
    if (j.claimed) return j
    let add = 0
    if (j.kind === 'win' && s.win) add = 1
    if (j.kind === 'kos') add = s.kills
    if (j.kind === 'breaks') add = s.breaks
    if (j.kind === 'traps') add = s.trapped
    if (j.kind === 'ults') add = s.ults
    if (j.kind === 'matches') add = 1
    if (j.kind === 'hero' && j.hero === s.hero) add = 1
    if (j.kind === 'robots') add = s.waves
    const progress = Math.min(j.goal, j.progress + add)
    const done = progress >= j.goal
    if (done) {
      coins += j.reward
      xp += 40
      jobsDone.push(j.text)
    }
    return { ...j, progress, claimed: done }
  })
  const profile: Profile = {
    ...p,
    coins: p.coins + coins,
    xp: p.xp + xp,
    matches: p.matches + 1,
    wins: p.wins + (s.win ? 1 : 0),
    kos: p.kos + s.kills,
    breaks: p.breaks + s.breaks,
    heroXp: { ...p.heroXp, [s.hero]: (p.heroXp[s.hero] ?? 0) + heroXp },
    jobs: { ...p.jobs, list: jobs },
  }
  return { profile, reward: { coins, xp, heroXp, jobsDone, levelUp: level(profile.xp) > before, heroLevelUp: heroLvl(profile, s.hero) > heroBefore } }
}

export { THROW_IDS, TRAP_IDS }
