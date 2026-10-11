// What the complex unlocks, straight from the portfolio content: career roles (one circuit sector each, oldest first),
// achievements (one per penalty goal) and skills (from rally points). Progress is saved in the browser.
import { skillTree, tiles, trophies, type TrophyTier } from '../data/content'

export interface Role {
  id: string
  title: string
  tagline: string
  org: string
  period: string
  color: string
  deep: string
}

/** Career tiles are listed newest first; the lap drives through them in order, so oldest first. */
export const ROLES: Role[] = tiles
  .filter((t) => t.tab === 'career')
  .reverse()
  .map((t) => ({ id: t.id, title: t.title, tagline: t.tagline, org: t.org, period: t.period, color: t.accent[1], deep: t.accent[0] }))

export interface Achievement {
  name: string
  issuer: string
  tier: TrophyTier
  kind: string
}

export const ACHIEVEMENTS: Achievement[] = trophies.map((t) => ({ name: t.name, issuer: t.issuer, tier: t.tier, kind: t.kind }))

export const TIER_COLOR: Record<TrophyTier, string> = { platinum: '#c9d6ff', gold: '#f5c542', silver: '#c3cad5', bronze: '#d08a52' }

export interface SkillItem {
  branch: string
  skill: string
}

/** Skills unlock branch by branch, in the skill tree's order. */
export const SKILLS: SkillItem[] = skillTree.flatMap((b) => b.skills.map((s) => ({ branch: b.branch, skill: s })))

export interface Progress {
  roles: string[] // role ids reached on the circuit
  bestLap: number | null
  lastLap: number | null
  bestSectors: (number | null)[]
  laps: number
  trophies: number // achievements unlocked (in order)
  kicks: number
  goals: number
  skills: number // skills unlocked (in order)
  rallyWins: { badminton: number; tabletennis: number }
  bestStreak: number
}

const KEY = 'sc-progress'

export function blankProgress(): Progress {
  return {
    roles: [],
    bestLap: null,
    lastLap: null,
    bestSectors: ROLES.map(() => null),
    laps: 0,
    trophies: 0,
    kicks: 0,
    goals: 0,
    skills: 0,
    rallyWins: { badminton: 0, tabletennis: 0 },
    bestStreak: 0,
  }
}

export function loadProgress(): Progress {
  const base = blankProgress()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const p = JSON.parse(raw) as Partial<Progress>
    return {
      ...base,
      ...p,
      roles: Array.isArray(p.roles) ? p.roles.filter((r) => ROLES.some((x) => x.id === r)) : [],
      bestSectors: ROLES.map((_, i) => (Array.isArray(p.bestSectors) && typeof p.bestSectors[i] === 'number' ? p.bestSectors[i] : null)),
      trophies: Math.min(ACHIEVEMENTS.length, Math.max(0, Number(p.trophies) || 0)),
      skills: Math.min(SKILLS.length, Math.max(0, Number(p.skills) || 0)),
      rallyWins: { ...base.rallyWins, ...(p.rallyWins ?? {}) },
    }
  } catch {
    return base
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // Private mode: progress lasts for this visit only.
  }
}

export function resetProgress() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored.
  }
}

export const fmtTime = (s: number | null) => {
  if (s === null || !isFinite(s)) return '–:––.–––'
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(3).padStart(6, '0')}`
}
