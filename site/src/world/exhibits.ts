// The career as places: each portfolio chapter is told on plaques and exhibit boards in its district, the
// certifications and awards stand in the keep's trophy hall, the skill tree hangs on the harbour signpost and
// the games wait in arcade cabinets on the plaza. Framework-free; Exhibits.tsx draws them, the HUD reads them.
import { profile, skillTree, tiles, trophies, type Tile, type TrophyTier } from '../data/content'
import { HUB_MISSIONS, REGIONS, regionById, type Region } from './regions'
import { heightAt } from './terrain'

export type ExhibitKind = 'plaque' | 'board' | 'trophy' | 'cabinet' | 'sign' | 'diorama'

export interface Exhibit {
  id: string
  kind: ExhibitKind
  x: number
  z: number
  y: number
  /** Facing (three.js rotation.y) of the front face. */
  yaw: number
  title: string
  subtitle?: string
  /** Short text printed on the board. */
  body: string
  /** Full text shown when read (E). */
  lines: string[]
  accent: string
  /** Portfolio tile this belongs to (cabinets open the arcade on it; plaques fast-travel from the arcade). */
  tile?: string
  tier?: TrophyTier
}

const tileById = (id: string) => tiles.find((t) => t.id === id)!

let cache: Exhibit[] | null = null

/** Every exhibit on the island (built on first use). */
export function exhibits(): Exhibit[] {
  if (cache) return cache
  const out: Exhibit[] = []
  const at = (r: Region, dx: number, dz: number): [number, number, number] => {
    const x = r.center[0] + dx, z = r.center[1] + dz
    return [x, heightAt(x, z), z]
  }
  const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z)

  for (const r of REGIONS) {
    const tile = tileById(r.tile)
    if (!tile || r.id === 'hub') continue
    // The chapter plaque stands beside the beacon, out of the road, with the activity boards fanned behind it.
    const bx = r.center[0] + r.beacon[0], bz = r.center[1] + r.beacon[1]
    const len = Math.hypot(r.beacon[0], r.beacon[1]) || 1
    const ax = r.beacon[0] / len, az = r.beacon[1] / len
    const px = az, pz = -ax
    const cx = bx + px * 9 + ax * 2, cz = bz + pz * 9 + az * 2
    const y = heightAt(cx, cz)
    out.push({
      id: `plaque:${tile.id}`, kind: 'plaque', x: cx, z: cz, y, yaw: facing(cx, cz, bx, bz), title: tile.title, subtitle: `${tile.org} · ${tile.period}`,
      body: tile.blurb, lines: [tile.tagline, '', tile.blurb, '', ...tile.stats.map((s) => `${s.value} — ${s.label}`)], accent: tile.accent[1], tile: tile.id,
    })
    const acts = tile.activities.slice(0, 4)
    acts.forEach((a, i) => {
      const spread = acts.length > 1 ? (i / (acts.length - 1) - 0.5) * 1.5 : 0
      const base = Math.atan2(px, pz)
      const ang = base + spread
      const ex = bx + Math.sin(ang) * 17, ez = bz + Math.cos(ang) * 17
      out.push({
        id: `board:${tile.id}:${i}`, kind: 'board', x: ex, z: ez, y: heightAt(ex, ez), yaw: facing(ex, ez, bx, bz), title: a.title, subtitle: tile.title, body: a.detail,
        lines: [a.detail], accent: tile.accent[1], tile: tile.id,
      })
    })
  }

  // The profile: a welcome plaque by the harbour beacon and the career timeline along the quay.
  const hub = REGIONS[0]
  const prof = tileById('profile')
  {
    const [x, y, z] = at(hub, -10, 22)
    out.push({
      id: 'plaque:profile', kind: 'plaque', x, y, z, yaw: facing(x, z, hub.center[0] + hub.beacon[0], hub.center[1] + hub.beacon[1]), title: profile.name, subtitle: profile.headline,
      body: profile.summary, lines: [profile.summary, '', `Hobbies: ${profile.hobbies.join(', ')}`], accent: prof?.accent[1] ?? '#94a3b8', tile: 'profile',
    })
  }
  const career = tiles.filter((t) => t.tab === 'career' && t.id !== 'profile').sort((a, b) => a.period.localeCompare(b.period))
  career.forEach((t, i) => {
    const [x, y, z] = at(hub, 52, -22 + i * 7)
    out.push({
      id: `timeline:${t.id}`, kind: 'board', x, y, z, yaw: -Math.PI / 2, title: `${t.period}`, subtitle: t.title, body: t.org, lines: [t.org, '', t.blurb], accent: t.accent[1], tile: t.id,
    })
  })

  // The skills signpost (the harbour's signpost landmark, with a board per branch).
  const skills = HUB_MISSIONS.find((m) => m.tile === 'skill-tree')!
  skillTree.forEach((b, i) => {
    const [x, y, z] = at(hub, skills.at[0] + 3, skills.at[1] - 2)
    out.push({
      id: `sign:${i}`, kind: 'sign', x, y: y + 1.6 + i * 0.55, z, yaw: -0.5 + (i % 2) * Math.PI, title: b.branch, body: b.skills.slice(0, 4).join(' · '), lines: b.skills, accent: ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb7185', '#a3e635'][i % 7],
      tile: 'skill-tree',
    })
  })

  // The trophy hall inside the keep: two rows of pedestals in the courtyard.
  const keep = regionById('ridge')
  trophies.forEach((t, i) => {
    const row = Math.floor(i / 9), col = i % 9
    const [x, y, z] = at(keep, (col - 4) * 4.6, -2 + row * 6)
    out.push({ id: `trophy:${i}`, kind: 'trophy', x, y, z, yaw: Math.PI, title: t.name, subtitle: `${t.kind} · ${t.issuer}`, body: t.issuer, lines: [`${t.kind} · ${t.issuer}`, `Tier: ${t.tier}`], accent: TIER_COLOR[t.tier], tier: t.tier, tile: 'trophies' })
  })
  {
    const [x, y, z] = at(keep, 0, -9)
    out.push({
      id: 'diorama', kind: 'diorama', x, y, z, yaw: Math.PI, title: 'Khotyn Fortress', subtitle: 'Photogrammetry scan · scale model',
      body: 'A 3D scan of the real fortress, decimated from two million faces to fit the island.', lines: ['A 3D scan of the real fortress on the Dniester, reduced from 1.95 million faces to 89 thousand and coloured per vertex so it could travel to this courtyard.', 'Model: Khotyn Fortress by LZCreation (Sketchfab, CC BY 4.0).'],
      accent: '#fb7185', tile: 'architect-mode',
    })
  }

  // Arcade cabinets in front of the castle arcade, one per game.
  const plaza = regionById('dunes')
  const games = GAME_IDS.map((id) => tiles.find((t) => t.id === id)).filter((t): t is Tile => !!t)
  games.forEach((t, i) => {
    const [x, y, z] = at(plaza, (i - (games.length - 1) / 2) * 3, -6)
    out.push({ id: `cabinet:${t.id}`, kind: 'cabinet', x, y, z, yaw: 0, title: t.title, subtitle: t.genre, body: t.tagline, lines: [t.tagline, '', t.blurb], accent: t.accent[1], tile: t.id })
  })

  cache = out
  return out
}

/** The games, in arcade order. */
export const GAME_IDS = ['arena', 'cricket', 'volt-riot', 'bogey-brawl', 'plush-panic', 'neon-siege', 'sports-complex', 'footballiq']

export const TIER_COLOR: Record<TrophyTier, string> = { platinum: '#e2e8f0', gold: '#fbbf24', silver: '#cbd5e1', bronze: '#d97706' }

/** The arcade door: the castle's front step on the plaza. */
export function arcadeDoor() {
  const r = regionById('dunes')
  return { x: r.center[0], z: r.center[1] - 16, r: 6 }
}

/** The sports complex gate: the arena's front entrance at the stadium. */
export function stadiumGate() {
  const r = regionById('speedway')
  return { x: r.center[0], z: r.center[1] - 8, r: 6 }
}

export const tileFor = (id: string): Tile | undefined => tiles.find((t) => t.id === id)
