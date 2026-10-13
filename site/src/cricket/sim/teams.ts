// The fictional sides that ship with the game, the player's own teams (saved in localStorage) and name pools.
// Every team, player name and kit is invented.
import { clamp, Rng } from './vec.ts'
import type { BowlStyle } from './delivery.ts'

export type Role = 'batter' | 'bowler' | 'allrounder' | 'keeper'
export const ROLE_NAMES: Record<Role, string> = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', keeper: 'Keeper' }
export const STYLE_NAMES: Record<BowlStyle, string> = { fast: 'Fast', swing: 'Swing', medium: 'Medium', offspin: 'Off-spin', legspin: 'Leg-spin' }

export interface Player {
  name: string
  role: Role
  leftBat: boolean
  leftArm: boolean
  bowl: BowlStyle
  batting: number // 0-100
  bowling: number
  fielding: number
  pace: number
  /** Skin tone index (0..3). */
  skin: number
}

export interface Team {
  id: string
  name: string
  short: string
  primary: string // shirt trim / coloured kit
  secondary: string // helmet, cap, accents
  trousers: string
  /** 'whites' (whites with coloured trim) or 'coloured' (pyjamas). */
  kit: 'coloured' | 'whites'
  captain: number
  keeper: number
  custom?: boolean
  players: Player[]
}

export const bat01 = (p: Player) => p.batting / 100
export const bowl01 = (p: Player) => p.bowling / 100
export const field01 = (p: Player) => p.fielding / 100
export const pace01 = (p: Player) => p.pace / 100
export const canBowl = (p: Player) => p.role === 'bowler' || p.role === 'allrounder' || p.bowling >= 45
export const surname = (p: Player) => {
  const parts = p.name.split(' ')
  return parts[parts.length - 1]
}
export const initials = (p: Player) => {
  const parts = p.name.split(' ')
  return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : p.name
}

/** Short broadcast label for the bowler card ("RA FAST", "SLA"...). */
export function styleTag(p: Player) {
  const a = p.leftArm ? 'L' : 'R'
  switch (p.bowl) {
    case 'fast':
      return `${a}A FAST`
    case 'swing':
      return `${a}A SWING`
    case 'medium':
      return `${a}A MED`
    case 'offspin':
      return p.leftArm ? 'SLA ORTH' : 'RA OFF-SPIN'
    default:
      return p.leftArm ? 'LA WRIST' : 'RA LEG-SPIN'
  }
}

export function styleName(p: Player) {
  const arm = p.leftArm ? 'Left-arm' : 'Right-arm'
  switch (p.bowl) {
    case 'fast':
      return `${arm} fast`
    case 'swing':
      return `${arm} swing`
    case 'medium':
      return `${arm} medium`
    case 'offspin':
      return p.leftArm ? 'Slow left-arm orthodox' : 'Right-arm off-spin'
    default:
      return p.leftArm ? 'Left-arm wrist spin' : 'Right-arm leg-spin'
  }
}

export function cloneTeam(t: Team): Team {
  return { ...t, players: t.players.map((p) => ({ ...p })) }
}

/** Eleven players, a keeper and at least five who can bowl. */
export function validateTeam(t: Team) {
  while (t.players.length < 11) t.players.push(blankPlayer(`Player ${t.players.length + 1}`))
  t.players.length = 11
  t.keeper = clamp(Math.round(t.keeper), 0, 10)
  t.captain = clamp(Math.round(t.captain), 0, 10)
  t.players.forEach((p, i) => {
    if (p.role === 'keeper' && i !== t.keeper) p.role = 'batter'
    p.batting = clamp(Math.round(p.batting), 1, 99)
    p.bowling = clamp(Math.round(p.bowling), 1, 99)
    p.fielding = clamp(Math.round(p.fielding), 1, 99)
    p.pace = clamp(Math.round(p.pace), 1, 99)
    p.name = (p.name || `Player ${i + 1}`).slice(0, 24)
  })
  t.players[t.keeper].role = 'keeper'
  let bowlers = t.players.filter((p) => canBowl(p) && p.role !== 'keeper').length
  for (let i = 10; i >= 0 && bowlers < 5; i--) {
    const p = t.players[i]
    if (p.role === 'keeper' || canBowl(p)) continue
    p.role = 'allrounder'
    p.bowling = Math.max(p.bowling, 50)
    bowlers++
  }
  t.short = (t.short || t.name || 'XI').toUpperCase().slice(0, 3)
  return t
}

export function blankPlayer(name: string): Player {
  return { name, role: 'batter', leftBat: false, leftArm: false, bowl: 'medium', batting: 60, bowling: 40, fielding: 60, pace: 50, skin: 0 }
}

export function teamStrength(t: Team) {
  return t.players.reduce((s, p) => s + Math.max(p.batting, p.bowling) * 0.7 + p.fielding * 0.3, 0) / Math.max(1, t.players.length)
}

const FIRST = [
  'Arlo', 'Bastien', 'Callum', 'Devan', 'Eshan', 'Faisal', 'Gideon', 'Halden', 'Idris', 'Jory', 'Kiano', 'Lorcan', 'Marek', 'Nilesh', 'Orrin', 'Pavel',
  'Quentin', 'Rafferty', 'Soren', 'Tavish', 'Ulric', 'Varun', 'Wynn', 'Yannick', 'Zeb', 'Anselm', 'Brodie', 'Cyrus', 'Dario', 'Emrys', 'Fintan', 'Garrick',
  'Hamish', 'Ivo', 'Jasper', 'Kofi', 'Lennox', 'Malik', 'Nevan', 'Oskar', 'Pranav', 'Rohan', 'Sami', 'Teodor', 'Uday', 'Vasco', 'Wilder', 'Xander',
]
const LAST = [
  'Ashcombe', 'Brightwell', 'Caldmore', 'Dunmere', 'Ellacott', 'Fairholm', 'Galbraith', 'Hartigan', 'Inchley', 'Jessop-Vane', 'Kilbride', 'Larchmont',
  'Morrow', 'Northcote', 'Okonkwo-Reid', 'Pellham', 'Quarrie', 'Ravenhill', 'Sallow', 'Thornbury', 'Underhay', 'Varga', 'Whitmore', 'Yardley', 'Zielke',
  'Abernethy', 'Blackmoor', 'Cresswell', 'Draycott', 'Esterby', 'Fenwick', 'Greaves-Lal', 'Holloway', 'Iyengar-Ross', 'Joubertin', 'Kestrell', 'Lindqvist',
  'Mahadeo', 'Nightingale', 'Oduya', 'Prabhakaran-Lee', 'Rathbone', 'Sandhurst', 'Tremayne', 'Uppal-Grant', 'Vellacott',
]

export const randomName = (rng: Rng) => `${rng.pick(FIRST)} ${rng.pick(LAST)}`

export function hashString(s: string) {
  let h = 23
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h >>> 0
}

interface Side {
  id: string
  name: string
  short: string
  primary: string
  secondary: string
  trousers: string
  strength: number
}

const SIDES: Side[] = [
  { id: 'northland', name: 'Northland', short: 'NTH', primary: '#1d4ed8', secondary: '#facc15', trousers: '#1e3a8a', strength: 78 },
  { id: 'southern-isles', name: 'Southern Isles', short: 'SIS', primary: '#047857', secondary: '#fde047', trousers: '#064e3b', strength: 76 },
  { id: 'eastvale', name: 'Eastvale', short: 'EVL', primary: '#b91c1c', secondary: '#f8fafc', trousers: '#7f1d1d', strength: 74 },
  { id: 'westmark', name: 'Westmark', short: 'WMK', primary: '#7c3aed', secondary: '#f59e0b', trousers: '#4c1d95', strength: 72 },
  { id: 'coral-coast', name: 'Coral Coast', short: 'CRL', primary: '#f97316', secondary: '#0ea5e9', trousers: '#0c4a6e', strength: 70 },
  { id: 'red-mesa', name: 'Red Mesa', short: 'RMS', primary: '#9f1239', secondary: '#fbbf24', trousers: '#1f2937', strength: 68 },
  { id: 'highland-union', name: 'Highland Union', short: 'HLU', primary: '#0f766e', secondary: '#f472b6', trousers: '#134e4a', strength: 66 },
  { id: 'sunfield', name: 'Sunfield', short: 'SFD', primary: '#ca8a04', secondary: '#1e3a8a', trousers: '#1e293b', strength: 64 },
]

/** A balanced XI: openers, middle order, a keeper, all-rounders, quicks, a medium pacer and spinners. */
export function generateTeam(side: Side): Team {
  const rng = new Rng(hashString(side.id))
  const used = new Set<string>()
  const roles: Role[] = ['batter', 'batter', 'batter', 'batter', 'keeper', 'allrounder', 'allrounder', 'bowler', 'bowler', 'bowler', 'bowler']
  const styles: BowlStyle[] = ['medium', 'offspin', 'medium', 'legspin', 'medium', 'swing', 'offspin', 'fast', 'swing', 'legspin', 'fast']
  const st = side.strength
  const players: Player[] = []
  for (let i = 0; i < 11; i++) {
    let n: string
    do n = randomName(rng)
    while (used.has(n))
    used.add(n)
    const role = roles[i]
    const bat = role === 'batter' ? st + rng.int(-4, 12) : role === 'keeper' ? st + rng.int(-8, 6) : role === 'allrounder' ? st + rng.int(-10, 4) : st - 35 + rng.int(-8, 10) - i * 2
    const bowl = role === 'bowler' ? st + rng.int(-2, 12) : role === 'allrounder' ? st + rng.int(-8, 4) : rng.int(10, 35)
    players.push({
      name: n,
      role,
      leftBat: rng.chance(0.28),
      leftArm: rng.chance(0.22),
      bowl: styles[i],
      batting: clamp(bat, 15, 99),
      bowling: clamp(bowl, 5, 99),
      fielding: clamp(st + rng.int(-15, 12), 30, 99),
      pace: rng.int(30, 95),
      skin: rng.int(0, 4),
    })
  }
  return validateTeam({ id: side.id, name: side.name, short: side.short, primary: side.primary, secondary: side.secondary, trousers: side.trousers, kit: 'coloured', captain: rng.int(0, 4), keeper: 4, players })
}

let builtIn: Team[] | null = null
export function builtInTeams(): Team[] {
  if (!builtIn) builtIn = SIDES.map(generateTeam)
  return builtIn
}

const KEY = 'cricket-teams-v1'

export function customTeams(): Team[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (!raw) return []
    const list = JSON.parse(raw) as Team[]
    if (!Array.isArray(list)) return []
    return list.map((t) => validateTeam({ ...t, custom: true, kit: t.kit === 'whites' ? 'whites' : 'coloured', players: (t.players ?? []).map((p) => ({ ...blankPlayer(p.name), ...p })) }))
  } catch {
    return []
  }
}

export function allTeams(): Team[] {
  return [...customTeams(), ...builtInTeams()]
}

export function findTeam(id: string): Team | null {
  const t = allTeams().find((x) => x.id.toLowerCase() === id.toLowerCase())
  return t ? cloneTeam(t) : null
}

export function saveTeam(team: Team) {
  validateTeam(team)
  if (!team.id.startsWith('my-')) team.id = 'my-' + Math.random().toString(36).slice(2, 10)
  team.custom = true
  const list = customTeams().filter((t) => t.id !== team.id)
  list.unshift(cloneTeam(team))
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Storage blocked: the team lasts for this visit only.
  }
  return team
}

export function deleteTeam(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(customTeams().filter((t) => t.id !== id)))
  } catch {
    // ignore
  }
}

/** A fresh custom side to start the team builder from. */
export function newCustomTeam(): Team {
  const base = cloneTeam(builtInTeams()[0])
  const rng = new Rng((Date.now() & 0xffff) + 7)
  base.players.forEach((p) => (p.name = randomName(rng)))
  return { ...base, id: 'my-new', name: 'My XI', short: 'MYX', primary: '#0ea5e9', secondary: '#f8fafc', trousers: '#0c4a6e', kit: 'coloured', custom: true }
}
