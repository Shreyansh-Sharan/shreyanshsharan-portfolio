// The two streets. Each places the two households facing each other across the road, then dresses the lawns with
// props (fences, mailboxes, a caravan, a boat on a trailer, the windmill, power poles, trees, a trampoline) and
// marks the spawn and brawl points. Collisions use the same axis-aligned pieces as the houses.
import { buildHouse, type HouseInfo, type LayoutId } from './houses.ts'
import { makePiece, resetPieceIds, type Piece } from './pieces.ts'
import { Rng } from './rng.ts'

export type MapId = 'culdesac' | 'snowline'
export type TimeOfDay = 'day' | 'night'

export interface MapTheme {
  /** Sky, fog and lighting colours. */
  sky: string
  horizon: string
  sun: string
  fog: string
  ambient: number
  /** Ground tints. */
  grass: string
  road: string
  path: string
  snow: boolean
  /** Default house themes per team. */
  houseThemes: [string, string]
}

export interface MapInfo {
  id: MapId
  name: string
  blurb: string
  /** World size (metres). */
  w: number
  h: number
  theme: Record<TimeOfDay, MapTheme>
  /** Road band (z range) and the sidewalks. */
  road: { z0: number; z1: number }
  /** Team spawn origins and facing. */
  houses: { ox: number; oz: number; dir: number }[]
}

export const MAPS: Record<MapId, MapInfo> = {
  culdesac: {
    id: 'culdesac',
    name: 'Sunny Cul-de-Sac',
    blurb: 'Picket fences, a caravan, a boat on a trailer, and the windmill nobody asked for.',
    w: 72,
    h: 64,
    theme: {
      day: { sky: '#6fb7ff', horizon: '#dff1ff', sun: '#fff2cc', fog: '#cfe7ff', ambient: 0.75, grass: '#6cbf3a', road: '#5b5e66', path: '#c9b98f', snow: false, houseThemes: ['lemon', 'mint'] },
      night: { sky: '#0b1430', horizon: '#2a3a6a', sun: '#8aa5ff', fog: '#101a3a', ambient: 0.28, grass: '#2b5a24', road: '#23262e', path: '#5f5a48', snow: false, houseThemes: ['lemon', 'mint'] },
    },
    road: { z0: 28, z1: 36 },
    // Houses sit a quarter metre off the 0.5 m nav grid so their 1 m doorways centre on a grid cell.
    houses: [
      { ox: 34.25, oz: 15.25, dir: 1 },
      { ox: 34.25, oz: 48.75, dir: -1 },
    ],
  },
  snowline: {
    id: 'snowline',
    name: 'Snowline Motor Lodge',
    blurb: 'A mountain-town street under fresh snow: buried pickup, neon lodge signs, snow banks for cover.',
    w: 72,
    h: 64,
    theme: {
      day: { sky: '#9fc3e8', horizon: '#eef5fb', sun: '#fff7e8', fog: '#dde9f4', ambient: 0.8, grass: '#eaf1f7', road: '#8e949c', path: '#d8dde3', snow: true, houseThemes: ['timber', 'slate'] },
      night: { sky: '#0d1626', horizon: '#243454', sun: '#9ab6ff', fog: '#17223a', ambient: 0.32, grass: '#7f8fa8', road: '#2d3340', path: '#4d586c', snow: true, houseThemes: ['timber', 'slate'] },
    },
    road: { z0: 28, z1: 36 },
    houses: [
      { ox: 34.25, oz: 15.25, dir: 1 },
      { ox: 34.25, oz: 48.75, dir: -1 },
    ],
  },
}
export const MAP_IDS = Object.keys(MAPS) as MapId[]

export interface WorldSetup {
  map: MapInfo
  houses: HouseInfo[]
  pieces: Piece[]
  /** Brawl spawns around the street. */
  brawlSpawns: { x: number; z: number; yaw: number }[]
  /** Where robot waves walk in from. */
  robotSpawns: { x: number; z: number }[]
  /** Tool racks: pick a garden tool. */
  toolRacks: Piece[]
}

export function buildWorld(mapId: MapId, layouts: [LayoutId, LayoutId], themes: [string, string], seed: number): WorldSetup {
  resetPieceIds()
  const map = MAPS[mapId]
  const rng = new Rng(seed ^ 0x51a7)
  const pieces: Piece[] = []
  const houses = map.houses.map((h, i) => buildHouse(i, h.ox, h.oz, h.dir, { layout: layouts[i], theme: themes[i] }))
  for (const h of houses) pieces.push(...h.pieces)
  const prop = (model: string, x: number, z: number, w: number, d: number, h: number, yaw = 0, hp = 0, solid = true) => {
    const p = makePiece({ kind: 'prop', model: `prop:${model}`, x, y: 0, z, w, d, h, yaw, hp, breakable: hp > 0, solid })
    pieces.push(p)
    return p
  }
  const snow = map.theme.day.snow

  // Picket fences along both lawns, with a gap for the path to the front door.
  for (const h of houses) {
    const zf = h.oz + h.dir * 12 // fence line 12 m in front of the house centre (the lawn edge by the sidewalk)
    for (let x = 18; x < 50; x += 2) {
      if (Math.abs(x + 1 - h.ox) < 1.2) continue
      prop(snow ? 'snowfence' : 'fence', x + 1, zf, 2, 0.2, 1.0, 0, 30)
    }
    // Side fences.
    for (let k = 0; k < 8; k++) {
      prop(snow ? 'snowfence' : 'fence', 18, h.oz + h.dir * (k * 2 - 1), 0.2, 2, 1.0, Math.PI / 2, 30)
      prop(snow ? 'snowfence' : 'fence', 50, h.oz + h.dir * (k * 2 - 1), 0.2, 2, 1.0, Math.PI / 2, 30)
    }
    prop('mailbox', h.ox + h.dir * 2.4, zf + h.dir * 0.6, 0.4, 0.4, 1.2, h.dir > 0 ? 0 : Math.PI)
    prop('hedge', h.ox - h.dir * 5, h.oz + h.dir * 9.9, 3, 1, 1.1)
    prop('bbq', h.ox - h.dir * 10.6, h.oz - h.dir * 3, 0.9, 0.7, 1.2, 0, 40)
    prop('shed', h.ox + h.dir * 14.4, h.oz - h.dir * 4, 2.4, 2.4, 2.4, 0)
    prop('gnome', h.ox - h.dir * 3, h.oz + h.dir * 10.6, 0.4, 0.4, 0.6, 0, 0, false)
    prop('gnome', h.ox + h.dir * 4.5, h.oz + h.dir * 9.6, 0.4, 0.4, 0.6, 0, 0, false)
    prop('tree', h.ox - h.dir * 12.5, h.oz + h.dir * 8.5, 1.0, 1.0, 6, 0)
    prop('tree', h.ox + h.dir * 14.2, h.oz + h.dir * 8, 1.0, 1.0, 6, 0)
  }
  // Street furniture: power poles with lines, parked cars, the cul-de-sac turnaround.
  for (const x of [10, 26, 42, 58]) prop('pole', x, 27.3, 0.35, 0.35, 8.5)
  prop('sedan', 14, 30.2, 2.0, 4.4, 1.5, 0)
  prop('sedan2', 54, 33.8, 2.0, 4.4, 1.5, Math.PI)
  if (snow) {
    prop('pickup', 24, 30.4, 2.2, 5.2, 1.9, 0.1)
    prop('snowbank', 8, 26, 4, 2, 1.1, 0)
    prop('snowbank', 62, 38, 4, 2, 1.1, 0)
    prop('snowbank', 36, 25.6, 3, 1.6, 0.9, 0)
    prop('snowbank', 32, 38.4, 3, 1.6, 0.9, 0)
    prop('snowbank', 46, 30, 2.6, 1.6, 0.9, 0.3)
    prop('motelsign', 66, 44, 1.2, 1.2, 7, 0)
    prop('dinersign', 6, 20, 1.2, 1.2, 6, 0)
    for (let i = 0; i < 10; i++) prop('pine', 4 + rng.range(0, 3), 6 + i * 5.5 + rng.range(-1, 1), 1.2, 1.2, 7)
    for (let i = 0; i < 10; i++) prop('pine', 66 + rng.range(0, 3), 6 + i * 5.5 + rng.range(-1, 1), 1.2, 1.2, 7)
    for (let i = 0; i < 6; i++) prop('pine', 10 + i * 9 + rng.range(-1, 1), 2 + rng.range(0, 2), 1.2, 1.2, 7)
    for (let i = 0; i < 6; i++) prop('pine', 10 + i * 9 + rng.range(-1, 1), 61 + rng.range(0, 2), 1.2, 1.2, 7)
  } else {
    prop('caravan', 12, 20, 2.4, 5.2, 2.6, 0.15)
    prop('boat', 56, 44, 2.4, 6.0, 2.4, -0.1)
    prop('windmill', 8, 50, 1.4, 1.4, 9)
    prop('trampoline', 56, 12, 3.2, 3.2, 0.9)
    prop('shed', 60, 56, 2.6, 2.6, 2.5)
    for (let i = 0; i < 5; i++) prop('tree', 3 + rng.range(0, 2), 8 + i * 11, 1.0, 1.0, 6)
    for (let i = 0; i < 5; i++) prop('tree', 68 + rng.range(0, 2), 8 + i * 11, 1.0, 1.0, 6)
    for (let i = 0; i < 4; i++) prop('tree', 10 + i * 14, 2.5, 1.0, 1.0, 6)
    for (let i = 0; i < 4; i++) prop('tree', 10 + i * 14, 61.5, 1.0, 1.0, 6)
    prop('hedge', 48, 27, 3, 1, 1.1)
    prop('hedge', 20, 37, 3, 1, 1.1)
  }
  // Map edge: an unbreakable ring keeps everyone in.
  const W = map.w
  const H = map.h
  pieces.push(makePiece({ kind: 'wall', model: 'edge', x: W / 2, y: 0, z: -0.5, w: W + 2, d: 1, h: 6, hp: 0, breakable: false }))
  pieces.push(makePiece({ kind: 'wall', model: 'edge', x: W / 2, y: 0, z: H + 0.5, w: W + 2, d: 1, h: 6, hp: 0, breakable: false }))
  pieces.push(makePiece({ kind: 'wall', model: 'edge', x: -0.5, y: 0, z: H / 2, w: 1, d: H + 2, h: 6, hp: 0, breakable: false }))
  pieces.push(makePiece({ kind: 'wall', model: 'edge', x: W + 0.5, y: 0, z: H / 2, w: 1, d: H + 2, h: 6, hp: 0, breakable: false }))

  const toolRacks = pieces.filter((p) => p.model === 'furniture:toolrack')
  for (const r of toolRacks) r.breakable = false

  return {
    map,
    houses,
    pieces,
    brawlSpawns: [
      { x: 20, z: 30, yaw: Math.PI / 2 },
      { x: 48, z: 34, yaw: -Math.PI / 2 },
      { x: 34, z: 25, yaw: 0 },
      { x: 34, z: 39, yaw: Math.PI },
      { x: 12, z: 34, yaw: Math.PI / 2 },
      { x: 56, z: 30, yaw: -Math.PI / 2 },
      { x: 26, z: 38, yaw: Math.PI },
      { x: 42, z: 26, yaw: 0 },
    ],
    robotSpawns: [
      { x: 4, z: 32 },
      { x: 68, z: 32 },
      { x: 34, z: 60 },
      { x: 14, z: 56 },
      { x: 56, z: 58 },
    ],
    toolRacks,
  }
}
