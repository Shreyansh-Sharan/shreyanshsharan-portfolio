// The open world: one island, one district per portfolio chapter. Each district hosts a mission and is built from
// real (CC BY) architecture that streams in as you approach; see public/world/CREDITS.md for every model used.
export type Biome =
  | 'harbour'
  | 'neon'
  | 'highland'
  | 'keep'
  | 'temple'
  | 'arcade'
  | 'cove'
  | 'canyon'
  | 'plains'
  | 'stadium'

export type ModelName =
  // Generated props from the first version of the island.
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
  // Downloaded architecture (decimated and recompressed by scripts/build-world.mjs).
  | 'khotyn-fortress'
  | 'fishing-town'
  | 'old-house'
  | 'tavern'
  | 'medieval-village'
  | 'fortress-gate'
  | 'fortress-tower'
  | 'fortress-wall'
  | 'fortress-pillar'
  | 'fortress-portal'
  | 'fantastic-castle'
  | 'city-block'
  | 'brooklyn-row'
  | 'cyber-block'
  | 'scifi-buildings'
  | 'neon-sign'
  | 'metal-bridge'
  | 'hover-car'
  | 'lp-train'
  | 'flying-robot'
  | 'icon-arena'
  | 'stadium-seats'
  | 'temple'
  | 'toro'
  | 'shipwreck'
  | 'airship'
  | 'hobbit-house'
  | 'cabin'
  | 'tree-oak'
  | 'tree-birch'
  | 'tree-round'
  | 'tree-poplar'
  | 'tree-fir'
  | 'tree-fir-wide'
  | 'tree-card'
  | 'car'
  // Low-poly city props from the site owner's licensed asset library.
  | 'taxi'
  | 'box-truck'
  | 'led-streetlight'
  | 'neon-shop-sign'
  | 'hotel-neon-blade'
  | 'giant-billboard'
  | 'media-facade'
  | 'transit-shelter'
  | 'corner-shop'
  | 'metro-headhouse'
  | 'retail-infill'
  | 'neon-storefront'
  | 'security-bollard'
  | 'service-dumpster'
  | 'generator-unit'
  | 'barrel-stack'
  | 'supply-crate'

/** Models that exist in /public/world/models. Missing ones are simply skipped. */
export const AVAILABLE_MODELS = new Set<ModelName>([
  'portal', 'signpost', 'neon-tower', 'ai-core', 'distillery', 'pot-still', 'barrels', 'observatory', 'crane',
  'silos', 'tractor', 'warehouse', 'flask', 'clock-tower', 'ruins', 'f1-car', 'trophy', 'podium', 'pine', 'palm', 'cactus',
  'crystals', 'lab', 'autumn-tree', 'sheep',
  'khotyn-fortress', 'fishing-town', 'old-house', 'tavern', 'medieval-village', 'fortress-gate', 'fortress-tower', 'fortress-wall', 'fortress-pillar', 'fortress-portal', 'fantastic-castle',
  'city-block', 'brooklyn-row', 'cyber-block', 'scifi-buildings', 'neon-sign', 'metal-bridge', 'hover-car', 'lp-train', 'flying-robot',
  'icon-arena', 'stadium-seats', 'temple', 'toro', 'shipwreck', 'airship', 'hobbit-house', 'cabin',
  'tree-oak', 'tree-birch', 'tree-round', 'tree-poplar', 'tree-fir', 'tree-fir-wide', 'tree-card', 'car',
  'taxi', 'box-truck', 'led-streetlight', 'neon-shop-sign', 'hotel-neon-blade', 'giant-billboard', 'media-facade', 'transit-shelter',
  'corner-shop', 'metro-headhouse', 'retail-infill', 'neon-storefront', 'security-bollard', 'service-dumpster', 'generator-unit', 'barrel-stack', 'supply-crate',
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
  /**
   * A walkable set (a town, a city block, a fortress): solid walls are measured from the mesh in 2 m cells so
   * you can walk its streets, instead of one footprint around the whole thing.
   */
  set?: boolean
  /** Footprint (w, d) of the far-away placeholder box drawn before the model streams in. */
  foot?: [number, number]
  /** Lift above the ground, metres (a ship's hull sits in the water). */
  lift?: number
  /** Nothing solid at all (the airship dock, a hovering drone). */
  ghost?: boolean
}

export interface Scatter {
  model: ModelName | 'rock' | 'bush'
  count: number
  height: [number, number]
  radius: number
}

/** Lighting mood that takes over as you walk into a district (blended by distance). */
export interface Mood {
  /** Sun tint, sky/ambient tint and fog tint as hex. */
  sun: string
  sky: string
  fog: string
  /** Fog thickness relative to the island's default (1 = unchanged). */
  haze: number
  /** Sun strength relative to the default (1 = unchanged). */
  light: number
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
  /** Distance (metres from the camera) at which this district's architecture streams in. */
  stream: number
  mood?: Mood
  /** One line for the district sign. */
  tagline: string
}

/**
 * A walled bailey from the desert-fortress modules: 12 m wall pieces around a w x d rectangle (centred on cx, cz
 * in region space), towers on the corners and the gate frame in the middle of the south side.
 */
function bailey(cx: number, cz: number, w: number, d: number): Landmark[] {
  const out: Landmark[] = []
  const wall = (x: number, z: number, rot: number) => out.push({ model: 'fortress-wall', at: [x, z], height: 11, rot, pad: 7, set: true, foot: [12, 2.5] })
  const nx = Math.round(w / 12), nz = Math.round(d / 12)
  for (let i = 0; i < nx; i++) {
    const x = cx - w / 2 + (i + 0.5) * (w / nx)
    wall(x, cz - d / 2, 0)
    // The south side leaves the middle open for the gate.
    if (Math.abs(x - cx) > 14) wall(x, cz + d / 2, 180)
  }
  for (let i = 0; i < nz; i++) {
    const z = cz - d / 2 + (i + 0.5) * (d / nz)
    wall(cx - w / 2, z, 90)
    wall(cx + w / 2, z, -90)
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) out.push({ model: 'fortress-tower', at: [cx + (sx * w) / 2, cz + (sz * d) / 2], height: 20, pad: 5, set: true, foot: [6, 6] })
  out.push({ model: 'fortress-gate', at: [cx, cz + d / 2], height: 12, rot: 180, pad: 12, set: true, foot: [21, 17] })
  out.push({ model: 'fortress-pillar', at: [cx - 15, cz + d / 2], height: 13, pad: 3, set: true, foot: [4, 4] })
  out.push({ model: 'fortress-pillar', at: [cx + 15, cz + d / 2], height: 13, pad: 3, set: true, foot: [4, 4] })
  return out
}

export const REGIONS: Region[] = [
  {
    id: 'hub',
    tile: 'profile',
    name: 'Harbour Town',
    tagline: 'Where every visit starts: the pier, the Palbox and the guide.',
    mission: 'Meet the guide',
    biome: 'harbour',
    center: [0, 330],
    radius: 90,
    accent: '#94a3b8',
    landmarks: [
      { model: 'fishing-town', at: [-26, -8], height: 22, rot: 15, pad: 36, set: true, foot: [60, 40], lift: -14 },
      { model: 'old-house', at: [34, 10], height: 8, rot: -110, pad: 6, foot: [10, 8] },
      { model: 'tavern', at: [26, -24], height: 7.5, rot: 30, pad: 7, foot: [10, 12] },
      { model: 'old-house', at: [-58, 22], height: 7.5, rot: 70, pad: 6, foot: [10, 8] },
      { model: 'portal', at: [0, -40], height: 9, pad: 7 },
      { model: 'signpost', at: [14, 2], height: 3.2, rot: -30, pad: 3 },
      { model: 'trophy', at: [-8, 6], height: 3.4, pad: 3, anim: 'spin' },
    ],
    scatter: [
      { model: 'tree-oak', count: 20, height: [7, 10], radius: 80 },
      { model: 'tree-round', count: 16, height: [6, 9], radius: 84 },
      { model: 'palm', count: 14, height: [5, 8], radius: 90 },
      { model: 'rock', count: 26, height: [0.6, 1.6], radius: 86 },
      { model: 'bush', count: 36, height: [0.6, 1.2], radius: 80 },
    ],
    beacon: [0, 12],
    orbit: { radius: 70, height: 26 },
    sparkle: '#cbd5e1',
    stream: 220,
    mood: { sun: '#ffe9c4', sky: '#bcd7ff', fog: '#b8d0e6', haze: 1, light: 1 },
  },
  {
    id: 'dunes',
    tile: 'arena',
    name: 'Games Plaza',
    tagline: 'The arcade: every game on the island, one tile each.',
    mission: 'Enter Dunes Arena',
    biome: 'arcade',
    center: [0, 150],
    radius: 70,
    accent: '#fb923c',
    landmarks: [
      { model: 'fantastic-castle', at: [0, -30], height: 26, rot: 180, pad: 20, set: true, foot: [34, 24] },
      { model: 'neon-storefront', at: [-30, 10], height: 7, rot: 90, pad: 5, foot: [8, 6] },
      { model: 'media-facade', at: [30, 10], height: 9, rot: -90, pad: 5, foot: [8, 6] },
      { model: 'giant-billboard', at: [-24, -34], height: 14, rot: 150, pad: 4 },
      { model: 'giant-billboard', at: [26, -34], height: 14, rot: 210, pad: 4 },
      { model: 'transit-shelter', at: [-18, 40], height: 3.4, rot: 0, pad: 4 },
      { model: 'led-streetlight', at: [-14, 22], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [14, 22], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [-14, -2], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [14, -2], height: 7, pad: 1 },
      { model: 'portal', at: [0, 48], height: 8, rot: 180, pad: 5 },
    ],
    scatter: [{ model: 'tree-poplar', count: 18, height: [9, 13], radius: 68 }],
    beacon: [0, 14],
    orbit: { radius: 70, height: 28 },
    sparkle: '#fed7aa',
    stream: 140,
    mood: { sun: '#ffd9a8', sky: '#d9c4ff', fog: '#c8b8e0', haze: 1, light: 0.95 },
  },
  {
    id: 'neon',
    tile: 'omni-studio',
    name: 'Neon City',
    tagline: 'Rooftop runs and street time-trials under the signs.',
    mission: 'Boot up Omni Studio',
    biome: 'neon',
    center: [-310, 120],
    radius: 120,
    accent: '#a78bfa',
    landmarks: [
      { model: 'city-block', at: [0, -20], height: 44, rot: 0, pad: 90, set: true, foot: [172, 169] },
      { model: 'brooklyn-row', at: [-78, 70], height: 14, rot: 90, pad: 10, set: true, foot: [60, 18] },
      { model: 'cyber-block', at: [62, 84], height: 15, rot: 0, pad: 24, set: true, foot: [44, 42] },
      { model: 'scifi-buildings', at: [-30, 92], height: 20, rot: 180, pad: 16, set: true, foot: [62, 26] },
      { model: 'neon-tower', at: [100, -60], height: 40, pad: 9 },
      { model: 'ai-core', at: [10, 78], height: 7, pad: 5, anim: 'float' },
      { model: 'neon-sign', at: [-8, 70], height: 7, rot: 0, pad: 2 },
      { model: 'neon-sign', at: [22, 70], height: 7, rot: 180, pad: 2 },
      { model: 'hotel-neon-blade', at: [-56, 62], height: 12, rot: 90, pad: 4 },
      { model: 'neon-shop-sign', at: [40, 90], height: 5, rot: -90, pad: 2 },
      { model: 'corner-shop', at: [-62, 100], height: 9, rot: 0, pad: 7, foot: [12, 10] },
      { model: 'retail-infill', at: [-96, 100], height: 9, rot: 0, pad: 7, foot: [12, 10] },
      { model: 'metro-headhouse', at: [0, 104], height: 5, rot: 0, pad: 5 },
      { model: 'taxi', at: [-20, 104], height: 1.5, rot: 80, pad: 2 },
      { model: 'box-truck', at: [36, 104], height: 3, rot: -100, pad: 3 },
      { model: 'hover-car', at: [-44, 80], height: 1.6, rot: 20, lift: 0.6 },
      { model: 'led-streetlight', at: [-30, 110], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [30, 110], height: 7, pad: 1 },
      { model: 'security-bollard', at: [-8, 112], height: 1, pad: 1 },
      { model: 'service-dumpster', at: [50, 100], height: 1.6, rot: 30, pad: 2 },
      { model: 'flying-robot', at: [0, 60], height: 1.2, lift: 6, ghost: true, anim: 'float' },
      { model: 'lp-train', at: [-100, 20], height: 3.6, rot: 0, pad: 4 },
      { model: 'metal-bridge', at: [-100, 44], height: 3.5, rot: 0, pad: 4 },
    ],
    scatter: [],
    beacon: [-6, 76],
    orbit: { radius: 150, height: 60 },
    sparkle: '#22d3ee',
    stream: 260,
    mood: { sun: '#ffb8d6', sky: '#8e7bff', fog: '#8f7fc2', haze: 1.35, light: 0.7 },
  },
  {
    id: 'speedway',
    tile: 'sports-complex',
    name: 'Stadium',
    tagline: 'The sports complex gate: walk in to play on the pitch.',
    mission: 'Take the podium',
    biome: 'stadium',
    center: [-250, -170],
    radius: 95,
    accent: '#f97316',
    landmarks: [
      { model: 'icon-arena', at: [0, -34], height: 30, rot: 0, pad: 70, set: true, foot: [120, 120] },
      { model: 'stadium-seats', at: [-70, 50], height: 16, rot: 90, pad: 8, set: true, foot: [51, 12] },
      { model: 'podium', at: [30, 60], height: 4, rot: 90, pad: 5 },
      { model: 'metro-headhouse', at: [-26, 62], height: 5, rot: 180, pad: 5 },
      { model: 'transit-shelter', at: [26, 70], height: 3.4, rot: 180, pad: 4 },
      { model: 'led-streetlight', at: [-12, 48], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [12, 48], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [-12, 72], height: 7, pad: 1 },
      { model: 'led-streetlight', at: [12, 72], height: 7, pad: 1 },
      { model: 'security-bollard', at: [-7, 40], height: 1, pad: 1 },
      { model: 'security-bollard', at: [7, 40], height: 1, pad: 1 },
      { model: 'box-truck', at: [44, 44], height: 3, rot: 40, pad: 3 },
    ],
    scatter: [{ model: 'tree-poplar', count: 14, height: [9, 12], radius: 90 }],
    beacon: [0, 80],
    orbit: { radius: 130, height: 50 },
    stream: 230,
    mood: { sun: '#fff1d6', sky: '#cfe3ff', fog: '#bfd3ea', haze: 0.9, light: 1.05 },
  },
  {
    id: 'ridge',
    tile: 'architect-mode',
    name: 'Khotyn Keep',
    tagline: 'The fortress on the cliff: career halls, banners and the trophy hall.',
    mission: 'Win the pitch',
    biome: 'keep',
    center: [70, -330],
    radius: 130,
    accent: '#fb7185',
    landmarks: [
      ...bailey(0, -10, 96, 72),
      { model: 'khotyn-fortress', at: [0, -14], height: 14, rot: 0, pad: 36, set: true, foot: [57, 42], lift: 1.0 },
      { model: 'medieval-village', at: [-64, 46], height: 8, rot: 120, pad: 26, set: true, foot: [52, 21] },
      { model: 'fortress-portal', at: [66, 48], height: 17, rot: 200, pad: 5, set: true, foot: [6, 4] },
      { model: 'observatory', at: [-70, -56], height: 11, rot: 160, pad: 10 },
      { model: 'crane', at: [82, 10], height: 22, rot: 30, pad: 5 },
      { model: 'cabin', at: [-96, -40], height: 6, rot: 80, pad: 5, foot: [8, 8] },
    ],
    scatter: [
      { model: 'tree-fir', count: 40, height: [12, 18], radius: 128 },
      { model: 'tree-fir-wide', count: 22, height: [10, 15], radius: 120 },
      { model: 'rock', count: 50, height: [1, 3.5], radius: 126 },
      { model: 'bush', count: 30, height: [0.6, 1.1], radius: 110 },
    ],
    beacon: [0, 40],
    orbit: { radius: 150, height: 60 },
    stream: 260,
    mood: { sun: '#ffd3a8', sky: '#b9c8e8', fog: '#a7b6cc', haze: 1.1, light: 0.95 },
  },
  {
    id: 'canyon',
    tile: 'qlik-legends',
    name: 'Crystal Canyon',
    tagline: 'Terraces of light below the keep.',
    mission: 'Light up 150 dashboards',
    biome: 'canyon',
    center: [-90, -240],
    radius: 60,
    accent: '#2dd4bf',
    landmarks: [
      { model: 'crystals', at: [0, 0], height: 9, pad: 7 },
      { model: 'crystals', at: [-14, -9], height: 6, rot: 120, pad: 5 },
      { model: 'crystals', at: [12, -12], height: 5, rot: 240, pad: 4 },
    ],
    scatter: [
      { model: 'rock', count: 40, height: [1, 3.5], radius: 58 },
      { model: 'cactus', count: 10, height: [2, 4], radius: 50 },
    ],
    beacon: [4, 14],
    orbit: { radius: 60, height: 24 },
    sparkle: '#5eead4',
    stream: 150,
    mood: { sun: '#ffe6c4', sky: '#9fe0d6', fog: '#9fc9c4', haze: 1, light: 1 },
  },
  {
    id: 'highland',
    tile: 'diageo-devops',
    name: 'Forest & Highlands',
    tagline: 'The distillery, the cabin and the round door in the hill.',
    mission: 'Ship the DevOps framework',
    biome: 'highland',
    center: [300, -140],
    radius: 140,
    accent: '#fbbf24',
    landmarks: [
      { model: 'distillery', at: [0, 0], height: 13, rot: 200, pad: 11 },
      { model: 'pot-still', at: [11, 8], height: 6, pad: 4 },
      { model: 'pot-still', at: [15, 2], height: 5, rot: 40, pad: 4 },
      { model: 'barrels', at: [-11, 7], height: 4, rot: 20, pad: 4 },
      { model: 'hobbit-house', at: [-70, 40], height: 7, rot: 200, pad: 10, foot: [12, 11] },
      { model: 'cabin', at: [60, -70], height: 6, rot: -30, pad: 5, foot: [8, 8] },
      { model: 'old-house', at: [-40, -60], height: 7.5, rot: 140, pad: 6, foot: [10, 8] },
      { model: 'barrel-stack', at: [-16, 14], height: 1.6, rot: 10, pad: 2 },
    ],
    scatter: [
      { model: 'tree-fir', count: 90, height: [12, 20], radius: 138 },
      { model: 'tree-fir-wide', count: 50, height: [10, 16], radius: 130 },
      { model: 'tree-birch', count: 40, height: [7, 10], radius: 120 },
      { model: 'pine', count: 60, height: [6, 11], radius: 136 },
      { model: 'rock', count: 50, height: [0.8, 2.4], radius: 130 },
      { model: 'bush', count: 70, height: [0.6, 1.2], radius: 120 },
    ],
    beacon: [3, 16],
    orbit: { radius: 120, height: 44 },
    sparkle: '#fde68a',
    stream: 240,
    mood: { sun: '#ffe2b8', sky: '#bcd7ff', fog: '#b4c9d8', haze: 1.15, light: 1 },
  },
  {
    id: 'plains',
    tile: 'lakehouse-logistics',
    name: 'Harvest Plains',
    tagline: 'Silos, fields and the warehouse road.',
    mission: 'Rebalance the inventory',
    biome: 'plains',
    center: [340, 90],
    radius: 80,
    accent: '#a3e635',
    landmarks: [
      { model: 'silos', at: [0, 0], height: 15, rot: 200, pad: 9 },
      { model: 'warehouse', at: [-22, -8], height: 8, rot: 15, pad: 12 },
      { model: 'box-truck', at: [-30, 10], height: 3, rot: 120, pad: 3 },
      { model: 'supply-crate', at: [-12, 12], height: 1.2, rot: 20, pad: 1 },
    ],
    scatter: [
      { model: 'bush', count: 50, height: [0.6, 1.2], radius: 78 },
      { model: 'tree-round', count: 16, height: [6, 9], radius: 78 },
      { model: 'autumn-tree', count: 10, height: [5, 7], radius: 70 },
      { model: 'rock', count: 10, height: [0.6, 1.4], radius: 70 },
    ],
    beacon: [6, 14],
    orbit: { radius: 80, height: 30 },
    stream: 170,
    mood: { sun: '#fff0c8', sky: '#cfe3ff', fog: '#c6d6e0', haze: 0.95, light: 1.05 },
  },
  {
    id: 'campus',
    tile: 'nit-academy',
    name: 'Temple Hill',
    tagline: 'Lantern steps up to the temple; the photo challenge starts here.',
    mission: 'Graduate from NIT Jalandhar',
    biome: 'temple',
    center: [290, 290],
    radius: 90,
    accent: '#a5b4fc',
    landmarks: [
      { model: 'temple', at: [0, -24], height: 24, rot: 180, pad: 30, set: true, foot: [28, 34] },
      { model: 'clock-tower', at: [50, 20], height: 20, rot: 20, pad: 7 },
      { model: 'toro', at: [-8, 10], height: 3, pad: 1.5 },
      { model: 'toro', at: [8, 10], height: 3, pad: 1.5 },
      { model: 'toro', at: [-8, 24], height: 3, pad: 1.5 },
      { model: 'toro', at: [8, 24], height: 3, pad: 1.5 },
      { model: 'toro', at: [-8, 38], height: 3, pad: 1.5 },
      { model: 'toro', at: [8, 38], height: 3, pad: 1.5 },
    ],
    scatter: [
      { model: 'autumn-tree', count: 44, height: [5, 8], radius: 88 },
      { model: 'tree-round', count: 20, height: [6, 9], radius: 86 },
      { model: 'bush', count: 40, height: [0.6, 1.1], radius: 80 },
      { model: 'rock', count: 14, height: [0.6, 1.4], radius: 84 },
    ],
    beacon: [0, 52],
    orbit: { radius: 90, height: 40 },
    sparkle: '#fdba74',
    stream: 200,
    mood: { sun: '#ffc98a', sky: '#f3c4a8', fog: '#d9b9a8', haze: 1.05, light: 0.9 },
  },
  {
    id: 'lab',
    tile: 'wipro-origins',
    name: 'Shipwreck Cove',
    tagline: 'A wreck on the rocks, crabs on the sand.',
    mission: 'Automate the pharma lab',
    biome: 'cove',
    center: [-260, 330],
    radius: 90,
    accent: '#38bdf8',
    landmarks: [
      { model: 'shipwreck', at: [-40, 40], height: 36, rot: 30, lift: -6, foot: [140, 140], ghost: true },
      { model: 'lab', at: [20, -30], height: 12, rot: 150, pad: 11 },
      { model: 'flask', at: [34, -20], height: 6, pad: 4, anim: 'bob' },
      { model: 'old-house', at: [40, 20], height: 7.5, rot: -60, pad: 6, foot: [10, 8] },
    ],
    scatter: [
      { model: 'palm', count: 40, height: [5, 9], radius: 88 },
      { model: 'bush', count: 20, height: [0.6, 1.1], radius: 70 },
      { model: 'rock', count: 24, height: [0.6, 2.4], radius: 88 },
    ],
    beacon: [10, 2],
    orbit: { radius: 90, height: 36 },
    sparkle: '#7dd3fc',
    stream: 160,
    mood: { sun: '#ffe9c4', sky: '#bfe3ff', fog: '#b0cfe0', haze: 1.2, light: 1 },
  },
]

/** Extra missions that are not regions of their own (placed in the hub unless a region is given). */
export const HUB_MISSIONS: { tile: string; name: string; at: [number, number]; region?: string }[] = [
  { tile: 'trophies', name: 'Visit the trophy hall', at: [24, 20], region: 'ridge' },
  { tile: 'skill-tree', name: 'Read the signpost of skills', at: [16, 6] },
  { tile: 'volt-riot', name: 'Start the VOLT RIOT', at: [-24, 84], region: 'speedway' },
]

/** Which region a portfolio tile (or page) lives in. */
export function regionForTile(tile: string): Region {
  const extra = HUB_MISSIONS.find((m) => m.tile === tile)?.region
  return REGIONS.find((r) => r.tile === tile || r.id === extra) ?? REGIONS[0]
}

export const regionById = (id: string) => REGIONS.find((r) => r.id === id)!

export const ISLAND_RADIUS = 520
export const WATER_LEVEL = 0

/**
 * The road network: polylines of world points, driven on by the car and painted onto the terrain. Every district
 * hangs off the plaza; the coast road loops east.
 */
export const ROADS: [number, number][][] = [
  // Harbour → plaza → Neon City
  [[0, 300], [0, 215], [-60, 170], [-170, 150], [-240, 130]],
  // Plaza → stadium
  [[-60, 170], [-120, 60], [-190, -40], [-240, -80]],
  // Plaza → canyon → up the ramp to the keep gate
  [[0, 215], [0, 100], [-20, 0], [-60, -120], [-40, -170], [-10, -215], [25, -250], [55, -280], [70, -298]],
  // Plaza → highlands
  [[0, 100], [80, 40], [170, -20], [260, -60]],
  // Highlands → plains → temple → harbour (the coast road)
  [[260, -60], [320, 10], [340, 60], [330, 160], [300, 230], [230, 300], [120, 330], [60, 330]],
  // Harbour → cove
  [[-40, 330], [-120, 350], [-190, 340]],
  // Neon City → stadium
  [[-240, 130], [-300, 20], [-280, -70]],
]

/** Where the airship stops: one mooring per district, in flight order. */
export const AIRSHIP_STOPS: { region: string; at: [number, number] }[] = [
  { region: 'hub', at: [66, 294] },
  { region: 'dunes', at: [60, 150] },
  { region: 'neon', at: [-220, 60] },
  { region: 'speedway', at: [-250, -60] },
  { region: 'ridge', at: [40, -200] },
  { region: 'highland', at: [240, -120] },
  { region: 'campus', at: [240, 240] },
  { region: 'lab', at: [-200, 300] },
]
