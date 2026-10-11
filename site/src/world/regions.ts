// The open world: one island, one region per portfolio item. Each region hosts a mission.
export type Biome =
  | 'plaza'
  | 'neon'
  | 'highland'
  | 'ridge'
  | 'campus'
  | 'dunes'
  | 'lab'
  | 'canyon'
  | 'plains'
  | 'speedway'

export type ModelName =
  | 'portal'
  | 'signpost'
  | 'neon-tower'
  | 'ai-core'
  | 'distillery'
  | 'pot-still'
  | 'barrels'
  | 'observatory'
  | 'crane'
  | 'silos'
  | 'tractor'
  | 'warehouse'
  | 'crystals'
  | 'lab'
  | 'flask'
  | 'clock-tower'
  | 'ruins'
  | 'f1-car'
  | 'trophy'
  | 'podium'
  | 'pine'
  | 'palm'
  | 'autumn-tree'
  | 'cactus'
  | 'sheep'

/** Models that exist in /public/world/models. Missing ones are simply skipped until generated. */
export const AVAILABLE_MODELS = new Set<ModelName>([
  'portal', 'signpost', 'neon-tower', 'ai-core', 'distillery', 'pot-still', 'barrels', 'observatory', 'crane',
  'silos', 'tractor', 'warehouse', 'flask', 'clock-tower', 'ruins', 'f1-car', 'trophy', 'podium', 'pine', 'palm', 'cactus',
  'crystals', 'lab', 'autumn-tree', 'sheep',
])

export interface Landmark {
  model: ModelName
  /** Offset from the region centre (x, z) in metres. */
  at: [number, number]
  /** Height of the model in metres. */
  height: number
  /** Yaw in degrees. */
  rot?: number
  /** Ground pad radius flattened under the model. */
  pad?: number
  /** Ambient animation applied to this landmark. */
  anim?: 'float' | 'spin' | 'bob'
}

export interface Scatter {
  model: ModelName | 'rock' | 'bush'
  count: number
  height: [number, number]
  radius: number
}

export interface Region {
  id: string
  /** Portfolio tile this region's mission tells (see data/content.ts). */
  tile: string
  name: string
  mission: string
  biome: Biome
  center: [number, number]
  radius: number
  accent: string
  landmarks: Landmark[]
  scatter: Scatter[]
  /** Where the mission beacon stands, relative to the centre. */
  beacon: [number, number]
  /** Cinematic camera orbit around the centre while browsing. */
  orbit: { radius: number; height: number }
  sparkle?: string
}

const polar = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [Math.round(Math.cos(a) * r), Math.round(-Math.sin(a) * r)]
}

export const REGIONS: Region[] = [
  {
    id: 'hub',
    tile: 'profile',
    name: 'Basecamp',
    mission: 'Meet the guide',
    biome: 'plaza',
    center: [0, 0],
    radius: 34,
    accent: '#94a3b8',
    landmarks: [
      { model: 'portal', at: [0, -14], height: 9, pad: 7 },
      { model: 'signpost', at: [9, 4], height: 3.2, rot: -30, pad: 3 },
      { model: 'trophy', at: [-10, 3], height: 3.4, pad: 3, anim: 'spin' },
    ],
    scatter: [
      { model: 'pine', count: 44, height: [5, 9], radius: 34 },
      { model: 'rock', count: 30, height: [0.6, 1.6], radius: 30 },
      { model: 'bush', count: 30, height: [0.6, 1.2], radius: 32 },
    ],
    beacon: [0, 6],
    orbit: { radius: 30, height: 12 },
    sparkle: '#cbd5e1',
  },
  {
    id: 'neon',
    tile: 'omni-studio',
    name: 'Neon District',
    mission: 'Boot up Omni Studio',
    biome: 'neon',
    center: polar(30, 150),
    radius: 46,
    accent: '#a78bfa',
    landmarks: [
      { model: 'neon-tower', at: [0, 0], height: 34, pad: 9 },
      { model: 'ai-core', at: [-14, 10], height: 7, pad: 5, anim: 'float' },
    ],
    scatter: [],
    beacon: [-6, 16],
    orbit: { radius: 46, height: 18 },
    sparkle: '#22d3ee',
  },
  {
    id: 'highland',
    tile: 'diageo-devops',
    name: 'Highland Distillery',
    mission: 'Ship the DevOps framework',
    biome: 'highland',
    center: polar(75, 150),
    radius: 48,
    accent: '#fbbf24',
    landmarks: [
      { model: 'distillery', at: [0, 0], height: 13, rot: 200, pad: 11 },
      { model: 'pot-still', at: [11, 8], height: 6, pad: 4 },
      { model: 'pot-still', at: [15, 2], height: 5, rot: 40, pad: 4 },
      { model: 'barrels', at: [-11, 7], height: 4, rot: 20, pad: 4 },
    ],
    scatter: [
      { model: 'pine', count: 70, height: [6, 11], radius: 48 },
      { model: 'rock', count: 30, height: [0.8, 2.4], radius: 46 },
      { model: 'bush', count: 60, height: [0.6, 1.2], radius: 44 },
    ],
    beacon: [3, 13],
    orbit: { radius: 36, height: 14 },
    sparkle: '#fde68a',
  },
  {
    id: 'ridge',
    tile: 'architect-mode',
    name: "Architect's Ridge",
    mission: 'Win the pitch',
    biome: 'ridge',
    center: polar(120, 155),
    radius: 50,
    accent: '#fb7185',
    landmarks: [
      { model: 'observatory', at: [0, 0], height: 11, rot: 160, pad: 10 },
      { model: 'crane', at: [16, 14], height: 22, rot: 30, pad: 5 },
    ],
    scatter: [
      { model: 'pine', count: 60, height: [6, 10], radius: 50 },
      { model: 'bush', count: 26, height: [0.6, 1.1], radius: 46 },
      { model: 'rock', count: 44, height: [1, 3.5], radius: 48 },
    ],
    beacon: [-4, 12],
    orbit: { radius: 40, height: 16 },
  },
  {
    id: 'campus',
    tile: 'nit-academy',
    name: 'Campus Grove',
    mission: 'Graduate from NIT Jalandhar',
    biome: 'campus',
    center: polar(162, 150),
    radius: 40,
    accent: '#a5b4fc',
    landmarks: [{ model: 'clock-tower', at: [0, 0], height: 22, rot: 20, pad: 7 }],
    scatter: [
      { model: 'autumn-tree', count: 54, height: [5, 8], radius: 40 },
      { model: 'bush', count: 50, height: [0.6, 1.1], radius: 38 },
      { model: 'rock', count: 12, height: [0.6, 1.4], radius: 38 },
    ],
    beacon: [5, 10],
    orbit: { radius: 32, height: 12 },
    sparkle: '#fdba74',
  },
  {
    id: 'dunes',
    tile: 'arena',
    name: 'The Dunes',
    mission: 'Enter Dunes Arena',
    biome: 'dunes',
    center: polar(202, 155),
    radius: 50,
    accent: '#fb923c',
    landmarks: [
      { model: 'ruins', at: [0, 0], height: 10, rot: 160, pad: 8 },
      { model: 'portal', at: [-12, 10], height: 8, rot: 60, pad: 5 },
    ],
    scatter: [
      { model: 'cactus', count: 44, height: [2.5, 5], radius: 50 },
      { model: 'rock', count: 28, height: [0.8, 2.2], radius: 48 },
    ],
    beacon: [-8, 14],
    orbit: { radius: 38, height: 13 },
    sparkle: '#fed7aa',
  },
  {
    id: 'lab',
    tile: 'wipro-origins',
    name: 'Lab Archipelago',
    mission: 'Automate the pharma lab',
    biome: 'lab',
    center: polar(243, 172),
    radius: 46,
    accent: '#38bdf8',
    landmarks: [
      { model: 'lab', at: [0, 0], height: 12, rot: 150, pad: 11 },
      { model: 'flask', at: [13, 8], height: 6, pad: 4, anim: 'bob' },
    ],
    scatter: [
      { model: 'palm', count: 56, height: [5, 9], radius: 46 },
      { model: 'bush', count: 24, height: [0.6, 1.1], radius: 42 },
      { model: 'rock', count: 10, height: [0.6, 1.6], radius: 42 },
    ],
    beacon: [5, 13],
    orbit: { radius: 36, height: 13 },
    sparkle: '#7dd3fc',
  },
  {
    id: 'canyon',
    tile: 'qlik-legends',
    name: 'Crystal Canyon',
    mission: 'Light up 150 dashboards',
    biome: 'canyon',
    center: polar(287, 150),
    radius: 50,
    accent: '#2dd4bf',
    landmarks: [
      { model: 'crystals', at: [0, 0], height: 9, pad: 7 },
      { model: 'crystals', at: [-14, -9], height: 6, rot: 120, pad: 5 },
      { model: 'crystals', at: [12, -12], height: 5, rot: 240, pad: 4 },
    ],
    scatter: [
      { model: 'rock', count: 46, height: [1, 3.5], radius: 50 },
      { model: 'cactus', count: 12, height: [2, 4], radius: 46 },
    ],
    beacon: [4, 11],
    orbit: { radius: 36, height: 14 },
    sparkle: '#5eead4',
  },
  {
    id: 'plains',
    tile: 'lakehouse-logistics',
    name: 'Harvest Plains',
    mission: 'Rebalance the inventory',
    biome: 'plains',
    center: polar(330, 152),
    radius: 50,
    accent: '#a3e635',
    landmarks: [
      { model: 'silos', at: [0, 0], height: 15, rot: 200, pad: 9 },
      { model: 'warehouse', at: [-18, -6], height: 8, rot: 15, pad: 12 },
    ],
    scatter: [
      { model: 'bush', count: 60, height: [0.6, 1.2], radius: 50 },
      { model: 'autumn-tree', count: 14, height: [5, 7], radius: 50 },
      { model: 'rock', count: 10, height: [0.6, 1.4], radius: 48 },
    ],
    beacon: [6, 12],
    orbit: { radius: 40, height: 15 },
  },
  {
    id: 'speedway',
    tile: 'sports-complex',
    name: 'Speedway',
    mission: 'Take the podium',
    biome: 'speedway',
    center: [192, 0],
    radius: 44,
    accent: '#f97316',
    landmarks: [{ model: 'podium', at: [0, 0], height: 4, rot: 90, pad: 5 }],
    scatter: [],
    beacon: [0, 8],
    orbit: { radius: 46, height: 16 },
  },
]

/** Extra missions that are not regions of their own (placed in the hub unless a region is given). */
export const HUB_MISSIONS: { tile: string; name: string; at: [number, number]; region?: string }[] = [
  { tile: 'trophies', name: 'Visit the trophy hall', at: [-10, 7] },
  { tile: 'skill-tree', name: 'Read the signpost of skills', at: [9, 8] },
  { tile: 'volt-riot', name: 'Start the VOLT RIOT', at: [-14, 4], region: 'speedway' },
]

/** Which region a portfolio tile (or page) lives in. */
export function regionForTile(tile: string): Region {
  const extra = HUB_MISSIONS.find((m) => m.tile === tile)?.region
  return REGIONS.find((r) => r.tile === tile || r.id === extra) ?? REGIONS[0]
}

export const ISLAND_RADIUS = 250
export const WATER_LEVEL = 0
