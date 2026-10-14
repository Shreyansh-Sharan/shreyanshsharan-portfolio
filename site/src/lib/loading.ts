// What the loading screen shows in each context (see lib/loader3d.ts): a game's key art, title and gameplay tips;
// the district, room or fast-travel stop being entered in the open world; the island itself at boot. Scenes are
// cached, so a component can pass the same object on every render.
import { profile, tiles } from '../data/content'
import { GAME_INFO, previewCards } from '../data/home'
import { REGIONS, regionForTile, type Region } from '../world/regions'
import { heroSrcSet } from './art'
import type { LoaderScene } from './loader3d'

const ISLAND_ACCENT: [string, string] = ['#fcd34d', '#38bdf8']

/** Tips for anywhere on the island. */
export const ISLAND_TIPS = [
  'Press Ctrl K (⌘K on a Mac) anywhere on the site to step into the open world, and again to step back out.',
  'Every district tells one chapter of the career. Reach its glowing beacon to complete the mission.',
  'Double-tap Space (or press X) to fly; Space and C climb and dive while you are airborne.',
  'Click a beacon on the minimap to fast travel straight to it.',
  'Press R to ride a pal, E to drive a car or board the airship, and P for photo mode.',
  'The arcade on Games Plaza has a cabinet for every game; walk up and press E to play.',
]

/** Which tile's key art best shows each district (the art was made for the tiles, not the districts). */
const DISTRICT_ART: Record<string, string> = {
  hub: 'profile',
  dunes: 'arena',
  neon: 'volt-riot',
  speedway: 'sports-complex',
  ridge: 'trophies',
  canyon: 'qlik-legends',
  highland: 'diageo-devops',
  plains: 'lakehouse-logistics',
  campus: 'nit-academy',
  lab: 'profile',
}

const tileById = (id: string) => tiles.find((t) => t.id === id)

function heroOf(tileId: string): Pick<LoaderScene, 'art' | 'artSet' | 'artAvif' | 'artThumb'> {
  const t = tileById(tileId)
  const hero = t?.hero
  return hero ? { art: hero, artSet: heroSrcSet(hero, 'webp'), artAvif: heroSrcSet(hero, 'avif'), artThumb: t?.thumb } : {}
}

const cache = new Map<string, LoaderScene>()
function cached(key: string, make: () => LoaderScene) {
  let s = cache.get(key)
  if (!s) cache.set(key, (s = make()))
  return s
}

const sentences = (text: string) => text.split(/(?<=\.)\s+/).filter((x) => x.length > 12)

/** The site's own loading screen: the island at night, the portfolio's name over it. */
export function islandScene(): LoaderScene {
  return cached('island', () => ({
    kicker: 'Welcome to the island',
    title: profile.name,
    sub: `${profile.headline}. Loading the open world, starting at Harbour Town.`,
    ...heroOf('profile'),
    tips: ISLAND_TIPS,
    accent: ISLAND_ACCENT,
  }))
}

/** A game: its 4K key art, its title and a rotating gameplay tip from its controls and features. */
export function gameScene(tileId: string): LoaderScene {
  return cached(`game:${tileId}`, () => {
    const t = tileById(tileId)
    const info = GAME_INFO[tileId]
    const tips = [...(info ? sentences(info.howTo) : []), ...(t ? previewCards(t).map((c) => `${c.title}: ${c.detail}`) : [])]
    if (info) tips.push(`Modes: ${info.modes} (${info.players}).`)
    return {
      kicker: 'Now loading · Game',
      title: t?.title ?? 'Game',
      sub: t ? `${t.tagline}. ${sentences(t.blurb)[0] ?? ''}`.trim() : undefined,
      ...heroOf(tileId),
      tips: tips.length ? tips : ISLAND_TIPS,
      accent: t ? [t.accent[1], t.accent[0]] : ISLAND_ACCENT,
    }
  })
}

/** An open-world district being streamed in (also used for fast travel and for entering the world). */
export function districtScene(region: Region, kicker = 'Entering district'): LoaderScene {
  return cached(`district:${region.id}:${kicker}`, () => ({
    kicker,
    title: region.name,
    sub: region.tagline,
    ...heroOf(DISTRICT_ART[region.id] ?? 'profile'),
    tips: [`Mission here: ${region.mission}. Follow the beacon on the minimap.`, ...ISLAND_TIPS],
    accent: [region.accent, '#ffffff'],
  }))
}

/** The district a tile's spot is in. */
export function districtForTile(tileId: string): Region {
  return regionForTile(tileId)
}

/** The district nearest a point on the island (fast travel lands somewhere inside one). */
export function districtAt(x: number, z: number): Region {
  let best = REGIONS[0]
  let bestD = Infinity
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.center[0], z - r.center[1]) / r.radius
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}

const ROOM_INFO: Record<string, { title: string; sub: string; art: string; tips: string[] }> = {
  arcade: {
    title: 'The Castle Arcade',
    sub: 'A cabinet for every game on the island, under the castle on Games Plaza.',
    art: 'volt-riot',
    tips: ['Walk up to a cabinet and press E to play its game.', 'Leave by the glowing door at the back; E opens it.'],
  },
  hall: {
    title: 'The Great Hall',
    sub: 'Inside Khotyn Keep: the banners, the throne and every trophy of the career.',
    art: 'trophies',
    tips: ['Each trophy is a certification or award; press E beside one to read it.', 'Leave by the glowing door; E opens it.'],
  },
}

/** A walk-in room (the arcade hall, the great hall). */
export function roomScene(id: string): LoaderScene {
  return cached(`room:${id}`, () => {
    const r = ROOM_INFO[id]
    if (!r) return islandScene()
    return { kicker: 'Entering', title: r.title, sub: r.sub, ...heroOf(r.art), tips: [...r.tips, ...ISLAND_TIPS], accent: ISLAND_ACCENT }
  })
}
