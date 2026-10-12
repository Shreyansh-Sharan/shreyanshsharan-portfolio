// Toy Box Trail: the board. A fixed, hand-laid trail of playing cards across the attic floor, with two forks
// (across a hand-mirror pond on bottle caps, and through the sock drawer), a popsicle-stick ladder shortcut, a
// slide that sends you back, and the cookie jar at the end. Pure data (no three.js): the engine, the visuals
// and the HUD mini-map all read it.

export type TileKind = 'start' | 'goal' | 'gain' | 'lose' | 'surprise' | 'shop' | 'duel' | 'trap' | 'splash' | 'ladder' | 'slide' | 'fork'

export interface Tile {
  i: number
  x: number
  z: number
  /** Feet height of a toy standing here (bottle caps are a little taller than cards). */
  y: number
  /** Facing along the trail (yaw 0 = +z). */
  yaw: number
  kind: TileKind
  /** Tiles you can step to next (two at a fork). */
  next: number[]
  /** The tile behind (for "go back N tiles"). */
  prev: number
  /** Ladder / slide / splash: where it takes you. */
  to?: number
  /** Hops to the cookie jar along the shortest way (ladders not counted). */
  dist: number
  /** A bottle cap on the mirror pond rather than a card. */
  cap?: boolean
}

export interface Fork {
  tile: number
  /** One label per entry of tiles[tile].next. */
  labels: string[]
}

export const TILE_INFO: Record<TileKind, { name: string; color: string; desc: string }> = {
  start: { name: 'Start', color: '#f8fafc', desc: 'Everyone starts here.' },
  goal: { name: 'Cookie Jar', color: '#fbbf24', desc: 'First toy here wins.' },
  gain: { name: 'Button Stash', color: '#3b82f6', desc: '+3 buttons.' },
  lose: { name: 'Hole in the Pocket', color: '#ef4444', desc: '-3 buttons.' },
  surprise: { name: 'Surprise Card', color: '#a855f7', desc: 'Draw a card from the surprise deck.' },
  shop: { name: 'Button Shop', color: '#22c55e', desc: 'Buy tricks for your bag (three slots).' },
  duel: { name: 'Duel', color: '#f97316', desc: 'Pick a rival for a 30-second mini-game.' },
  trap: { name: 'Sticky Tape', color: '#64748b', desc: 'Stuck: miss your next turn.' },
  splash: { name: 'Slippery Cap', color: '#38bdf8', desc: 'Splash! Back to the bank.' },
  ladder: { name: 'Popsicle Ladder', color: '#eab308', desc: 'Climb the ladder: a big shortcut.' },
  slide: { name: 'Slide', color: '#ec4899', desc: 'Whee! Slide back down the trail.' },
  fork: { name: 'Signpost', color: '#a16207', desc: 'Pick a way.' },
}

/** The trail, in order. [x, z, kind]. Branches follow their fork; `link` lists the extra edges. */
const PTS: [number, number, TileKind][] = [
  // Row 1, west to east along the far wall (0 = start).
  [-12, -10.2, 'start'], [-10, -9.8, 'gain'], [-8, -10.2, 'surprise'], [-6, -9.9, 'lose'], [-4, -10.3, 'gain'], [-2, -9.9, 'duel'],
  [0, -10.2, 'shop'], [2, -9.8, 'gain'], [4, -10.2, 'trap'], [6, -9.9, 'surprise'], [8, -10.2, 'gain'], [10, -9.8, 'lose'],
  // The corner, up to the first fork (13).
  [11.8, -8.6, 'gain'], [12.6, -6.6, 'fork'],
  // 14-16: across the mirror pond on bottle caps.
  [10.5, -4.9, 'gain'], [8.6, -3.4, 'splash'], [6.6, -2.2, 'surprise'],
  // 17-21: round the pond.
  [13.1, -4.4, 'gain'], [12.6, -2.2, 'shop'], [11.1, -0.5, 'surprise'], [9.1, 0.4, 'gain'], [7.0, 0.4, 'lose'],
  // 22: where they meet; row 2 runs west (27 = the ladder foot).
  [4.7, -1.1, 'gain'], [2.6, -1.4, 'lose'], [0.6, -1.0, 'surprise'], [-1.4, -1.3, 'gain'], [-3.4, -0.9, 'duel'], [-5.4, -1.2, 'ladder'],
  [-7.4, -0.9, 'gain'], [-9.4, -1.2, 'surprise'], [-11.4, -0.4, 'lose'], [-12.6, 1.4, 'gain'], [-12.3, 3.5, 'shop'],
  // Row 3 runs east (36 = the ladder top), up to the second fork (45).
  [-10.6, 4.8, 'gain'], [-8.6, 5.1, 'surprise'], [-6.6, 4.8, 'lose'], [-4.6, 5.1, 'gain'], [-2.6, 4.8, 'duel'], [-0.6, 5.1, 'gain'],
  [1.4, 4.8, 'surprise'], [3.4, 5.1, 'gain'], [5.4, 4.8, 'lose'], [7.4, 5.1, 'surprise'], [9.4, 4.8, 'trap'], [11.4, 6.3, 'gain'],
  [12.2, 8.4, 'fork'],
  // 46-48: through the sock drawer (short, a duel, the slide and sticky tape).
  [10.2, 9.3, 'duel'], [8.2, 9.5, 'slide'], [6.2, 9.8, 'trap'],
  // 49-52: along the skirting board (long, a shop).
  [12.4, 10.6, 'gain'], [10.7, 12.0, 'shop'], [8.6, 12.5, 'gain'], [6.5, 12.1, 'surprise'],
  // 53-56: the last stretch to the cookie jar.
  [4.4, 10.7, 'lose'], [2.4, 10.6, 'surprise'], [0.4, 10.4, 'gain'], [-2.4, 10.3, 'goal'],
]

/** Straight-on edges are i → i+1 except where a branch ends or a fork splits. */
const BREAKS = new Set([13, 16, 21, 45, 48, 52])
const LINKS: [number, number][] = [
  [13, 14], [13, 17], [16, 22], [21, 22], [45, 46], [45, 49], [48, 53], [52, 53],
]
/** The tile behind a merge (for going back). */
const PREV_OVERRIDE: Record<number, number> = { 17: 13, 22: 16, 49: 45, 53: 48 }
const JUMPS: Record<number, number> = { 27: 36, 47: 40, 15: 13 }
const CAPS = new Set([14, 15, 16])

export const FORKS: Fork[] = [
  { tile: 13, labels: ['Across the mirror pond (short, slippery)', 'Round the pond (long, with a shop)'] },
  { tile: 45, labels: ['Through the sock drawer (short, risky)', 'Along the skirting board (long, with a shop)'] },
]

function build(): Tile[] {
  const tiles: Tile[] = PTS.map(([x, z, kind], i) => ({ i, x, z, y: CAPS.has(i) ? 0.22 : 0.05, yaw: 0, kind, next: [], prev: i - 1, dist: 0, cap: CAPS.has(i) || undefined }))
  for (let i = 0; i < tiles.length - 1; i++) if (!BREAKS.has(i)) tiles[i].next.push(i + 1)
  for (const [a, b] of LINKS) if (!tiles[a].next.includes(b)) tiles[a].next.push(b)
  for (const t of tiles) {
    t.prev = PREV_OVERRIDE[t.i] ?? Math.max(0, t.i - 1)
    if (JUMPS[t.i] !== undefined) t.to = JUMPS[t.i]
    const n = tiles[t.next[0] ?? t.i]
    const p = tiles[t.prev]
    const dx = n !== t ? n.x - t.x : t.x - p.x, dz = n !== t ? n.z - t.z : t.z - p.z
    t.yaw = Math.atan2(dx, dz)
  }
  // Hops to the goal, walking the graph backwards from the jar.
  const goal = tiles.length - 1
  for (const t of tiles) t.dist = 999
  tiles[goal].dist = 0
  for (let changed = true; changed; ) {
    changed = false
    for (const t of tiles)
      for (const n of t.next)
        if (tiles[n].dist + 1 < t.dist) {
          t.dist = tiles[n].dist + 1
          changed = true
        }
  }
  return tiles
}

export const TILES: Tile[] = build()
export const START = 0
export const GOAL = TILES.length - 1
/** Board extents (for the mini-map and the overview camera). */
export const BOUNDS = { minX: -14, maxX: 14, minZ: -12, maxZ: 14 }
/** Scenery spots that must stay clear of the trail. */
export const POND = { x: 8.6, z: -3.4, rx: 3.3, rz: 2.2, rot: 0.62 }
export const JAR = { x: -2.4, z: 10.3 }

/** The path a toy takes for a ladder or a slide: a few points it moves through, feet heights included. */
export function jumpPath(from: number): [number, number, number][] {
  const a = TILES[from], b = TILES[a.to ?? from]
  if (a.kind === 'ladder') {
    // Over the book stack in the middle.
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2
    return [[a.x, a.y, a.z], [a.x + (mx - a.x) * 0.45, 1.25, a.z + (mz - a.z) * 0.45], [mx, 1.75, mz], [b.x + (mx - b.x) * 0.45, 1.25, b.z + (mz - b.z) * 0.45], [b.x, b.y, b.z]]
  }
  if (a.kind === 'slide') {
    // Up the steps, then down the curling chute.
    const top = slideTop()
    return [[a.x, a.y, a.z], [top[0], top[1], top[2]], ...slideCurve(), [b.x, b.y, b.z]]
  }
  return [[a.x, a.y, a.z], [b.x, b.y, b.z]]
}

/** Slide geometry: the top of the platform and points down the chute (shared by the visuals). */
export function slideTop(): [number, number, number] {
  return [8.0, 2.5, 7.9]
}
export function slideCurve(): [number, number, number][] {
  return [
    [7.3, 2.3, 7.4], [6.2, 1.8, 7.3], [5.1, 1.2, 7.6], [4.1, 0.7, 7.1], [3.6, 0.35, 6.2],
  ]
}
