// What the console-style home screen shows for each tile: which tab it sits under, its kind (which decides the
// actions), the info cards along the bottom and any progress saved in this browser by the games.
import { profile, skillTree, tiles, trophies, type Activity, type Tile } from './content'
import { GAME_LINKS } from './gameLinks'

export type HomeTab = 'games' | 'career' | 'showcase' | 'profile'

export const HOME_TABS: { id: HomeTab; label: string }[] = [
  { id: 'games', label: 'Games' },
  { id: 'career', label: 'Career' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'profile', label: 'Profile' },
]

const byId = (id: string) => tiles.find((t) => t.id === id)

/** The games, in the order the console shows them (the playable games are the ones with their own site). */
const GAME_ORDER = ['volt-riot', 'arena', 'cricket', 'neon-siege', 'bogey-brawl', 'plush-panic', 'lawn-wars', 'sports-complex']
const SHOWCASE = ['footballiq', 'trophies', 'skill-tree']
const PROFILE = ['profile', 'resume', 'trophies', 'skill-tree']

export function tilesForTab(tab: HomeTab): Tile[] {
  const pick = (ids: string[]) => ids.map(byId).filter((t): t is Tile => !!t)
  switch (tab) {
    case 'games':
      return pick([...GAME_ORDER, ...tiles.filter((t) => GAME_LINKS[t.id] && !GAME_ORDER.includes(t.id)).map((t) => t.id)])
    case 'career':
      return tiles.filter((t) => t.tab === 'career' && t.id !== 'profile')
    case 'showcase':
      return pick(SHOWCASE)
    case 'profile':
      return pick(PROFILE)
  }
}

/** The first tab that lists a tile. */
export function homeTabFor(tileId: string): HomeTab {
  return HOME_TABS.find((t) => tilesForTab(t.id).some((x) => x.id === tileId))?.id ?? 'games'
}

export type TileKind = 'game' | 'career' | 'showcase' | 'profile'

export function tileKind(t: Tile): TileKind {
  if (GAME_LINKS[t.id]) return 'game'
  if (t.action.kind === 'hub') return 'career'
  if (t.tab === 'showcase') return 'showcase'
  return 'profile'
}

/** Short facts for a game's info cards. */
export const GAME_INFO: Record<string, { modes: string; players: string; howTo: string }> = {
  'volt-riot': {
    modes: 'Race · Combat Points series · Deathmatch',
    players: '1 player vs 7 AI rivals',
    howTo: 'WASD or arrows to drive, Space to drift. Shift or J fires a power-up forwards, K backwards; Q cycles the bay.',
  },
  arena: {
    modes: 'Solo vs bots · Online match by invite code',
    players: '1–10 (bots fill the lobby)',
    howTo: 'WASD move, mouse aim, click fire, hold right click to aim. Keys 1–5 switch weapons, R reloads. First to 20 kills wins.',
  },
  cricket: {
    modes: 'T20 · T10 · 5-over Blitz · Super Over · Nets',
    players: '1 vs CPU, or 1v1 online',
    howTo: 'Batting: hold a direction and time the shot as the ring closes. Bowling: place the marker, release in the green.',
  },
  'neon-siege': {
    modes: '3v3 Team Takedown · Core Control · Grid Royale',
    players: '1–6 online, bots fill the squads',
    howTo: 'WASD move, mouse aim, left click fire, E or right click for the hero power, Q super, Space dash.',
  },
  'bogey-brawl': {
    modes: 'Single holes or a four-hole Tour',
    players: '1 vs AI golfers',
    howTo: 'Hold to charge, release to swing. Grab briefcases for items and drive carts over your rivals.',
  },
  'plush-panic': {
    modes: 'Show (knock-out rounds) · Quick Play · the Loft',
    players: 'Up to 16 toys, online by room code',
    howTo: 'WASD to walk, Space jump, Shift dive, E grab, click to shove. Last toy standing wears the crown.',
  },
  'lawn-wars': {
    modes: 'Destruction · Brawl · co-op Robot Invasion',
    players: '4v4, bots fill the families',
    howTo: 'WASD move, mouse look, left click swing (hold for heavy), right click block, E use, Q ultimate.',
  },
  'sports-complex': {
    modes: 'F1 laps · Penalties · Badminton · Table tennis',
    players: '1 player',
    howTo: 'Walk the complex with WASD and press E on a glowing pad to start a venue.',
  },
}

/** Feature cards for tiles that have no activity list of their own (games, the profile pages). */
export function previewCards(tile: Tile): Activity[] {
  switch (tile.id) {
    case 'trophies':
      return trophies.slice(0, 4).map((t) => ({ title: t.name, detail: `${t.issuer} · ${t.kind}` }))
    case 'skill-tree':
      return skillTree.slice(0, 4).map((b) => ({ title: b.branch, detail: b.skills.slice(0, 4).join(' · ') }))
    case 'profile':
      return [
        { title: 'Role', detail: profile.headline },
        { title: 'Experience', detail: '8+ years · 30+ enterprise clients across Pharma, CPG/FMCG, Financial Services, Agriculture and Construction' },
        { title: 'Hobbies', detail: profile.hobbies.join(' · ') },
        { title: 'Education', detail: 'B.Tech, NIT Jalandhar' },
        { title: 'Based in', detail: profile.location },
      ]
    case 'resume':
      return [
        { title: 'Format', detail: 'Two-page PDF, or Quick View as a plain page.' },
        { title: 'Contact', detail: `${profile.email} · LinkedIn` },
      ]
    case 'arena':
      return [
        { title: 'Powers', detail: 'Dash, double jump, overshield and a wall-piercing scan; health, shield, Overdrive and Haste pickups.' },
        { title: 'Weapons', detail: 'Pistol, SMG, assault rifle, bolt-action sniper and shotgun. Keys 1–5 or the wheel; hold right click to aim, scope in twice.' },
        { title: 'Maps', detail: 'Sandstorm (long doors, catwalk), Villa (curved lane, church square), Bazaar (sniper window, market), plus Dunes, Harbor Night and Frost Outpost.' },
      ]
    case 'cricket':
      return [
        { title: 'Formats', detail: 'T20 (default), T10, a 5-over Blitz and the Super Over, with a toss, powerplays, DRS reviews, a full scorecard, wagon wheel and run-rate graph.' },
        { title: 'Batting', detail: 'Hold one of eight directions, pick front or back foot and time the shot: defend, drive, cut, pull, sweep and flick, lofted or along the ground.' },
        { title: 'Bowling', detail: 'Pace, swing or spin: place the landing marker, choose the delivery and release in the green. Set your own field.' },
        { title: 'Physics', detail: 'Drag, swing, seam and Magnus spin, bounce and grip that change with the pitch, wind and ball age.' },
      ]
    case 'volt-riot':
      return [
        { title: 'Power-ups', detail: 'Shunt, Barge, Bolt, Mine, Shock, Nitro, Shield, Repair, Railgun, Flak, Oil Slick and Ram, each with a forward and backward mode.' },
        { title: 'Circuits', detail: 'Harbor Loop, Concrete River (storm channel and downtown), Gothic Quarter (cobbled old town and seafront) and Pier & Promenade, with hills, jumps and short cuts.' },
        { title: 'Progression', detail: 'Fan Points, Fan Runs and up to 5 Lights per event, saved in your browser.' },
        { title: 'Assets', detail: 'Eight custom 3D cars, street lamps, billboards, towers, cranes and hand-made textures.' },
      ]
    case 'bogey-brawl':
      return [
        { title: 'Holes', detail: 'Lakeside Bend (par 4), Rattlesnake Canyon (par 5, ramps and cactus), Frostbite Fjord (par 4, ice and wind) and Magma Isle (par 3, lava at night), or all four as a Tour.' },
        { title: 'Chaos', detail: 'Drive golf carts over rivals and their balls, and grab 17 items from briefcases: Orbital Laser, Tornado, Ball Swap, Banana Peel, Meteor and more. Random chaos events every 30 s.' },
        { title: 'Scoring', detail: 'First to hole out scores 100, plus par bonuses and knockouts. Unfinished at the end of overtime costs 50.' },
      ]
    case 'plush-panic':
      return [
        { title: 'The Show', detail: 'Up to 16 toys (bots fill the gaps) play rounds that shrink the field, ending in a crown final. Knocked-out toys heckle from the peanut gallery.' },
        { title: 'Levels', detail: 'Cookie Cutter (trace a biscuit without cracking it), Music Box Freeze (move only while the tune plays) and Spinning Top Sumo (ride a ball off a shrinking stool).' },
        { title: 'Sabotage', detail: 'Crumb Flick, Table Slam, Milk Splash, Plate Swap, thumbtacks, magnets and Bubble Wrap. Grudges make revenge half price; awards for the Biggest Menace.' },
      ]
    case 'neon-siege':
      return [
        { title: 'Heroes', detail: 'Rook (scattergun, Bulwark Dash), Wren (rail rifle, Sentry Pod), Furnace (flamethrower, Armour Pulse), Flick (SMG, Ghost Cloak), Pike (grenades, Minefield) and Salve (needler, Mend Zone).' },
        { title: 'Maps', detail: 'Kessho Row (neon street block), Helipad Seven (rooftops), Underpass Nine (subway) and the Sector Grid royale map, all built from a small kit of props with destructible crates.' },
        { title: 'Online', detail: 'Host a room and share the code; the host runs the match, friends join peer to peer and bots fill the squads.' },
      ]
    case 'lawn-wars':
      return [
        { title: 'The raid', detail: 'Sixty seconds to barricade doors and lay traps, then eight minutes to raid the rival house and break its tagged valuables.' },
        { title: 'Heroes', detail: 'Six original heroes with ultimates, ladders to the balcony and garden tools and thrown junk as weapons.' },
        { title: 'Streets', detail: 'A sunny cul-de-sac and a snowy motor lodge, by day or night.' },
      ]
    case 'sports-complex':
      return [
        { title: 'F1 circuit', detail: 'Drive through the career, one sector per role.' },
        { title: 'Stadium', detail: 'Score penalties to unlock achievements.' },
        { title: 'Rally hall', detail: 'Win badminton and table tennis points to unlock skills.' },
        { title: 'Hub', detail: 'Walk the landscaped complex as the low-poly avatar. Unlocks are saved in your browser.' },
      ]
    default:
      return tile.activities.slice(0, 4)
  }
}

export interface Progress {
  /** Headline figure, e.g. "3 wins". */
  value: string
  /** What it counts, e.g. "from 10 matches". */
  detail: string
  /** 0..100 when there is a meaningful bar to draw. */
  pct: number | null
}

function readJson<T>(key: string): Partial<T> | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<T> | null
  } catch {
    return null
  }
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

/** Progress the games saved in this browser (read straight from storage, so the games' code is not loaded). */
export function readProgress(tileId: string): Progress | null {
  const winRate = (wins: number, played: number, unit: string): Progress | null =>
    played > 0 ? { value: plural(wins, 'win'), detail: `from ${plural(played, unit)}`, pct: Math.round((wins / played) * 100) } : null
  switch (tileId) {
    case 'volt-riot': {
      const s = readJson<{ fans: number; lights: Record<string, number>; seriesWins: number }>('volt-riot')
      if (!s) return null
      const lights = Object.values(s.lights ?? {}).reduce((a, b) => a + n(b), 0)
      if (!lights && !n(s.fans)) return null
      return { value: plural(lights, 'Light'), detail: `${n(s.fans).toLocaleString()} fans · ${plural(n(s.seriesWins), 'series win')}`, pct: null }
    }
    case 'neon-siege': {
      const p = readJson<{ wins: number; matches: number }>('siege-profile')
      return p ? winRate(n(p.wins), n(p.matches), 'match') : null
    }
    case 'lawn-wars': {
      const p = readJson<{ wins: number; matches: number }>('lawn-profile')
      return p ? winRate(n(p.wins), n(p.matches), 'match') : null
    }
    case 'plush-panic': {
      const p = readJson<{ wins: number; shows: number }>('pp-profile')
      return p && n(p.shows) > 0 ? { value: plural(n(p.wins), 'crown'), detail: `from ${plural(n(p.shows), 'Show')}`, pct: Math.round((n(p.wins) / n(p.shows)) * 100) } : null
    }
    case 'sports-complex': {
      const p = readJson<{ roles: string[]; trophies: number; skills: number }>('sc-progress')
      if (!p) return null
      const roles = Array.isArray(p.roles) ? p.roles.length : 0
      if (!roles && !n(p.trophies) && !n(p.skills)) return null
      return { value: `${roles} roles`, detail: `${plural(n(p.trophies), 'achievement')} · ${plural(n(p.skills), 'skill')} unlocked`, pct: null }
    }
    default:
      return null
  }
}

/** Open-world missions completed in this browser (tile ids). */
export function missionsDone(): string[] {
  const d = readJson<string[]>('world-missions')
  return Array.isArray(d) ? (d as string[]) : []
}
