// Progression saved in localStorage: coins and XP from matches, gear cards (merge two of a rarity for the next),
// hero skins and three daily quests.
import { HERO_IDS, type HeroId } from './heroes'
import { Rng, hashString } from './rng'
import type { GearMods } from './sim'

export type GearType = 'plating' | 'servo' | 'overclock' | 'capacitor'
export const GEAR_TYPES: GearType[] = ['plating', 'servo', 'overclock', 'capacitor']
export const GEAR_INFO: Record<GearType, { name: string; stat: string; perTier: number; blurb: string }> = {
  plating: { name: 'Plating', stat: 'HP', perTier: 0.06, blurb: 'Extra armour plates.' },
  servo: { name: 'Servo', stat: 'Speed', perTier: 0.04, blurb: 'Faster leg actuators.' },
  overclock: { name: 'Overclock', stat: 'Damage', perTier: 0.05, blurb: 'Hotter blaster coils.' },
  capacitor: { name: 'Capacitor', stat: 'Super charge', perTier: 0.1, blurb: 'Supers fill faster.' },
}
export const TIER_NAMES = ['', 'Common', 'Rare', 'Epic', 'Mythic']
export const TIER_COLORS = ['', '#9ca3af', '#38bdf8', '#c084fc', '#fbbf24']
export const MAX_TIER = 4

export interface GearCard {
  id: string
  type: GearType
  tier: number
}

export interface Skin {
  name: string
  tint: string
  glow: string
  cost: number
}
export const SKINS: Record<string, Skin> = {
  default: { name: 'Stock', tint: '#ffffff', glow: '#f0abfc', cost: 0 },
  acid: { name: 'Acid', tint: '#b8ff9a', glow: '#84cc16', cost: 300 },
  magma: { name: 'Magma', tint: '#ffb089', glow: '#f97316', cost: 300 },
  frost: { name: 'Frost', tint: '#a8e4ff', glow: '#22d3ee', cost: 300 },
  royal: { name: 'Royal', tint: '#d9b8ff', glow: '#a855f7', cost: 500 },
  gold: { name: 'Gilt', tint: '#ffe08a', glow: '#fbbf24', cost: 800 },
}
export const SKIN_IDS = Object.keys(SKINS)

export type QuestKind = 'win' | 'kills' | 'damage' | 'br' | 'supers' | 'matches' | 'hero'
export interface Quest {
  id: string
  text: string
  kind: QuestKind
  goal: number
  progress: number
  reward: number
  hero?: HeroId
  claimed: boolean
}

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high'
  autoFire: boolean
  shake: boolean
  music: boolean
}

export interface Profile {
  name: string
  coins: number
  xp: number
  matches: number
  wins: number
  kills: number
  hero: HeroId
  /** Selected skin per hero. */
  skins: Partial<Record<HeroId, string>>
  /** Owned skins as "hero:skin". */
  owned: string[]
  gear: GearCard[]
  equipped: Partial<Record<GearType, string>>
  quests: { date: string; list: Quest[] }
  settings: Settings
  chests: number
}

const KEY = 'siege-profile'
export const CHEST_COST = 250

export function defaultProfile(): Profile {
  return {
    name: 'PLAYER',
    coins: 300,
    xp: 0,
    matches: 0,
    wins: 0,
    kills: 0,
    hero: 'rook',
    skins: {},
    owned: [],
    gear: [
      { id: 'g1', type: 'plating', tier: 1 },
      { id: 'g2', type: 'plating', tier: 1 },
      { id: 'g3', type: 'overclock', tier: 1 },
    ],
    equipped: {},
    quests: { date: '', list: [] },
    settings: { quality: 'auto', autoFire: true, shake: true, music: true },
    chests: 0,
  }
}

export function loadProfile(): Profile {
  const d = defaultProfile()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return refreshQuests(d)
    const p = JSON.parse(raw) as Partial<Profile>
    return refreshQuests({ ...d, ...p, settings: { ...d.settings, ...(p.settings ?? {}) }, quests: p.quests ?? d.quests })
  } catch {
    return refreshQuests(d)
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
  return 1 + Math.floor(Math.sqrt(xp / 120))
}

export function xpForLevel(l: number) {
  return (l - 1) * (l - 1) * 120
}

/* ---------- Gear ---------- */

export function gearMods(p: Profile): GearMods {
  const m: GearMods = { hp: 1, speed: 1, dmg: 1, charge: 1 }
  for (const t of GEAR_TYPES) {
    const id = p.equipped[t]
    const card = id ? p.gear.find((g) => g.id === id) : null
    if (!card) continue
    const bonus = GEAR_INFO[t].perTier * card.tier
    if (t === 'plating') m.hp += bonus
    if (t === 'servo') m.speed += bonus
    if (t === 'overclock') m.dmg += bonus
    if (t === 'capacitor') m.charge += bonus
  }
  return m
}

let cardSeq = 0
function newId() {
  return `c${Date.now().toString(36)}${(cardSeq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

/** Merge two cards of the same type and tier into one of the next tier. Returns the new profile or null. */
export function mergeCards(p: Profile, a: string, b: string): Profile | null {
  const ca = p.gear.find((g) => g.id === a)
  const cb = p.gear.find((g) => g.id === b)
  if (!ca || !cb || ca === cb || ca.type !== cb.type || ca.tier !== cb.tier || ca.tier >= MAX_TIER) return null
  const merged: GearCard = { id: newId(), type: ca.type, tier: ca.tier + 1 }
  const gear = p.gear.filter((g) => g !== ca && g !== cb).concat(merged)
  const equipped = { ...p.equipped }
  if (equipped[ca.type] === a || equipped[ca.type] === b) equipped[ca.type] = merged.id
  return { ...p, gear, equipped }
}

/** A chest gives one card: mostly common, sometimes better. */
export function openChest(p: Profile, free = false): { profile: Profile; card: GearCard } | null {
  if (!free && p.coins < CHEST_COST) return null
  const rng = new Rng(hashString(`${Date.now()}:${p.chests}:${p.gear.length}`))
  const r = rng.next()
  const tier = r < 0.62 ? 1 : r < 0.9 ? 2 : r < 0.985 ? 3 : 4
  const card: GearCard = { id: newId(), type: rng.pick(GEAR_TYPES), tier }
  return { profile: { ...p, coins: free ? p.coins : p.coins - CHEST_COST, gear: [...p.gear, card], chests: p.chests + 1 }, card }
}

export function equip(p: Profile, id: string): Profile {
  const card = p.gear.find((g) => g.id === id)
  if (!card) return p
  const equipped = { ...p.equipped }
  equipped[card.type] = equipped[card.type] === id ? undefined : id
  return { ...p, equipped }
}

/* ---------- Skins ---------- */

export function ownsSkin(p: Profile, hero: HeroId, skin: string) {
  return skin === 'default' || p.owned.includes(`${hero}:${skin}`)
}

export function buySkin(p: Profile, hero: HeroId, skin: string): Profile | null {
  const s = SKINS[skin]
  if (!s || ownsSkin(p, hero, skin) || p.coins < s.cost) return null
  return { ...p, coins: p.coins - s.cost, owned: [...p.owned, `${hero}:${skin}`], skins: { ...p.skins, [hero]: skin } }
}

export function selectSkin(p: Profile, hero: HeroId, skin: string): Profile {
  if (!ownsSkin(p, hero, skin)) return p
  return { ...p, skins: { ...p.skins, [hero]: skin } }
}

/* ---------- Daily quests ---------- */

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

const QUEST_POOL: Omit<Quest, 'id' | 'progress' | 'claimed' | 'hero'>[] = [
  { text: 'Win a match', kind: 'win', goal: 1, reward: 120 },
  { text: 'Take down 12 fighters', kind: 'kills', goal: 12, reward: 100 },
  { text: 'Deal 15,000 damage', kind: 'damage', goal: 15000, reward: 110 },
  { text: 'Play 2 Grid Royale matches', kind: 'br', goal: 2, reward: 90 },
  { text: 'Use 6 supers', kind: 'supers', goal: 6, reward: 80 },
  { text: 'Play 3 matches', kind: 'matches', goal: 3, reward: 90 },
]

export function refreshQuests(p: Profile): Profile {
  const date = today()
  if (p.quests.date === date && p.quests.list.length === 3) return p
  const rng = new Rng(hashString(date + p.name))
  const pool = [...QUEST_POOL]
  const list: Quest[] = []
  for (let i = 0; i < 2; i++) {
    const q = pool.splice(rng.int(pool.length), 1)[0]
    list.push({ ...q, id: `${date}-${i}`, progress: 0, claimed: false })
  }
  const hero = rng.pick(HERO_IDS)
  list.push({ id: `${date}-h`, text: `Win a match as ${hero.toUpperCase()}`, kind: 'hero', goal: 1, reward: 150, progress: 0, claimed: false, hero })
  return { ...p, quests: { date, list } }
}

export interface MatchResult {
  mode: 'tdm' | 'capture' | 'br'
  hero: HeroId
  win: boolean
  kills: number
  deaths: number
  damage: number
  supers: number
  placement: number
}

export interface Reward {
  coins: number
  xp: number
  questsDone: string[]
}

/** Apply a finished match: coins, XP and quest progress. */
export function applyMatch(p: Profile, r: MatchResult): { profile: Profile; reward: Reward } {
  let coins = 25 + r.kills * 6
  let xp = 40 + r.kills * 10 + Math.round(r.damage / 400)
  if (r.mode === 'br') {
    const placeBonus = r.placement === 1 ? 120 : r.placement <= 3 ? 60 : r.placement <= 8 ? 25 : 0
    coins += placeBonus
    xp += placeBonus
  } else if (r.win) {
    coins += 60
    xp += 60
  }
  const questsDone: string[] = []
  const list = p.quests.list.map((q) => {
    if (q.claimed) return q
    let add = 0
    if (q.kind === 'win' && r.win) add = 1
    if (q.kind === 'kills') add = r.kills
    if (q.kind === 'damage') add = r.damage
    if (q.kind === 'br' && r.mode === 'br') add = 1
    if (q.kind === 'supers') add = r.supers
    if (q.kind === 'matches') add = 1
    if (q.kind === 'hero' && r.win && q.hero === r.hero) add = 1
    const progress = Math.min(q.goal, q.progress + add)
    if (progress >= q.goal && q.progress < q.goal) {
      questsDone.push(q.text)
      coins += q.reward
    }
    return { ...q, progress, claimed: progress >= q.goal }
  })
  return {
    profile: { ...p, coins: p.coins + coins, xp: p.xp + xp, matches: p.matches + 1, wins: p.wins + (r.win ? 1 : 0), kills: p.kills + r.kills, quests: { ...p.quests, list } },
    reward: { coins, xp, questsDone },
  }
}
