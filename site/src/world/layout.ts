// Deterministic placement shared by the renderer and the collision code: scattered props and the
// neon skyline. Kept free of React so colliders.ts can build from it without import cycles.
import * as THREE from 'three'
import { AVAILABLE_MODELS, ISLAND_RADIUS, REGIONS, WATER_LEVEL, type ModelName, type Region, type Scatter } from './regions'
import { flatness, heightAt, isNearPad, isOnRoad, isOnTrail, mulberry32 } from './terrain'
import { MISSIONS } from './missions'

export type ScatterName = ModelName | 'rock' | 'bush' | 'mushroom' | 'pebble'

/**
 * Vegetation density: lighter on phones and low-core machines (the same test as WorldCanvas's quality tier),
 * decided once so the renderer and the colliders always agree.
 */
export const DENSITY = (() => {
  try {
    const small = window.innerWidth < 820 || matchMedia('(pointer: coarse)').matches
    return small || (navigator.hardwareConcurrency ?? 4) <= 4 ? 0.6 : 1
  } catch {
    return 1
  }
})()

const BUILT = new Set(['neon', 'stadium', 'arcade'])

/**
 * Where a scattered prop's base goes: the lowest ground under its footprint (centre and eight points at `r`), sunk a
 * little, so a trunk or root flare on a slope never shows a gap underneath.
 */
export function baseHeight(x: number, z: number, r: number, sink: number) {
  let h = heightAt(x, z)
  const d = r * 0.7
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [-d, d], [d, -d], [-d, -d]]) h = Math.min(h, heightAt(x + dx, z + dz))
  return h - sink
}

/** Base footprint half-width (fraction of height) of each scattered model, measured from the meshes (root flares). */
const BASE_FRACTION: Partial<Record<ScatterName, number>> = {
  rock: 0.5, bush: 0.45, fern: 1.3, 'rock-cluster': 0.7, reeds: 0.18, log: 0.4, 'bush-bloom': 0.75, mushroom: 0.3, pebble: 0.4, 'tree-fir': 0.055, 'tree-fir-wide': 0.16, 'tree-oak': 0.23, 'tree-round': 0.1, 'tree-birch': 0.06,
  'tree-poplar': 0.035, pine: 0.1, 'autumn-tree': 0.15, palm: 0.08, cactus: 0.09,
}
const BASE_R = (model: ScatterName) => BASE_FRACTION[model] ?? 0.12

/** Ground too uneven under a footprint of radius r for a prop to stand on without burying one side. */
function tooSteep(x: number, z: number, r: number) {
  let lo = Infinity, hi = -Infinity
  for (const [dx, dz] of [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const h = heightAt(x + dx, z + dz)
    lo = Math.min(lo, h)
    hi = Math.max(hi, h)
  }
  return hi - lo > 0.75
}

/** Keep clear of the walkable sets (towns, the city block, the keep) so trees don't grow through streets. */
function insideSet(x: number, z: number, margin = 4) {
  for (const r of REGIONS)
    for (const l of r.landmarks) {
      if (!(l.set || l.stand || l.lod) || !l.foot) continue
      const cx = r.center[0] + l.at[0], cz = r.center[1] + l.at[1]
      const yaw = ((l.rot ?? 0) * Math.PI) / 180
      const c = Math.cos(yaw), s = Math.sin(yaw)
      const dx = x - cx, dz = z - cz
      const lx = dx * c - dz * s, lz = dx * s + dz * c
      if (Math.abs(lx) < l.foot[0] / 2 + margin && Math.abs(lz) < l.foot[1] / 2 + margin) return true
    }
  return false
}

function scatterTransforms(region: Region, s: Scatter, seed: number) {
  const rnd = mulberry32(seed)
  const out: THREE.Matrix4[] = []
  const q = new THREE.Quaternion()
  const count = Math.round(s.count * DENSITY)
  let tries = 0
  const small = s.model === 'rock' || s.model === 'bush'
  while (out.length < count && tries++ < count * 12) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * s.radius
    const x = region.center[0] + Math.cos(a) * r, z = region.center[1] + Math.sin(a) * r
    const h = heightAt(x, z)
    const minH = s.model === 'palm' ? 0.9 : 1.6
    if (h < minH || isNearPad(x, z, small ? 1.5 : 4) || isOnRoad(x, z, small ? 1 : 3) || isOnTrail(x, z, small ? 0.3 : 2)) continue
    if (s.model !== 'rock' && flatness(x, z) < 0.78) continue
    if (insideSet(x, z, small ? 1 : 5)) continue
    if (region.biome === 'arcade' && Math.hypot(x - region.center[0], z - region.center[1]) < 56) continue
    if (region.biome === 'stadium' && Math.hypot(x - region.center[0], z - region.center[1]) < 86) continue
    // The lantern steps up to the temple stay clear.
    if (region.biome === 'temple' && Math.abs(x - region.center[0]) < 13 && z - region.center[1] > -12 && z - region.center[1] < 62) continue
    // Nothing grows inside the keep's bailey (the courtyard and the trophy hall).
    if (region.biome === 'keep' && Math.abs(x - region.center[0]) < 58 && z - region.center[1] > -56 && z - region.center[1] < 36) continue
    if (region.biome === 'harbour' && Math.hypot(x - region.center[0], z - region.center[1]) < 42 && !small) continue
    // Keep the ground around mission beacons (and the spawn points next to them) clear.
    if (MISSIONS.some((m) => Math.hypot(x - m.x, z - m.z) < 10)) continue
    const height = THREE.MathUtils.lerp(s.height[0], s.height[1], rnd())
    q.setFromEuler(new THREE.Euler(s.model === 'rock' ? rnd() * 0.6 : 0, rnd() * Math.PI * 2, 0))
    const sx = s.model === 'rock' ? 0.8 + rnd() * 0.8 : 1
    if (!small && tooSteep(x, z, BASE_R(s.model) * height * 1.3)) continue
    const y = baseHeight(x, z, BASE_R(s.model) * height * sx, 0.2)
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(height * sx, height, height * sx)))
  }
  return out
}

let scatterCache: [ScatterName, THREE.Matrix4[]][] | null = null

/** Every scattered prop on the island, grouped by model (one instanced mesh per model). */
export function scatterLayout(): [ScatterName, THREE.Matrix4[]][] {
  if (scatterCache) return scatterCache
  const byModel = new Map<ScatterName, THREE.Matrix4[]>()
  REGIONS.forEach((r, ri) =>
    r.scatter.forEach((s, si) => {
      if (s.model !== 'rock' && s.model !== 'bush' && !AVAILABLE_MODELS.has(s.model)) return
      const list = byModel.get(s.model) ?? []
      list.push(...scatterTransforms(r, s, 1000 + ri * 97 + si * 13))
      byModel.set(s.model, list)
    }),
  )
  // The countryside between districts: woods, hedges and boulders so the island never looks bare.
  WILD.forEach((w, i) => {
    const list = byModel.get(w.model) ?? []
    list.push(...wildTransforms(w.model, Math.round(w.count * DENSITY), w.height, 7000 + i * 31))
    byModel.set(w.model, list)
  })
  for (const [name, list] of foliage(byModel)) byModel.set(name, [...(byModel.get(name) ?? []), ...list])
  scatterCache = [...byModel.entries()]
  return scatterCache
}

/** Somewhere open to put a small prop: dry land, off roads, paths, pads, beacons and buildings. */
function openGround(x: number, z: number, r: number, minH = 1.4) {
  const h = heightAt(x, z)
  if (h < minH || isNearPad(x, z, r) || isOnRoad(x, z, r) || isOnTrail(x, z, 0.2)) return false
  if (MISSIONS.some((m) => Math.hypot(x - m.x, z - m.z) < 8)) return false
  if (insideSet(x, z, 2)) return false
  return !REGIONS.some((g) => BUILT.has(g.biome) && Math.hypot(x - g.center[0], z - g.center[1]) < g.radius * 1.15)
}

const FOREST = new Set<ScatterName>(['tree-fir', 'tree-fir-wide', 'pine', 'tree-oak', 'autumn-tree', 'tree-birch'])

/**
 * Undergrowth and the rest of the countryside's small life, placed from the trees outwards: ferns, toadstools and
 * pebbles under the woods, fallen logs between trees, boulder piles on the hillsides, reeds along the shore and
 * flowering shrubs at the edges of towns and paths.
 */
function foliage(byModel: Map<ScatterName, THREE.Matrix4[]>) {
  const rnd = mulberry32(9157)
  const out = new Map<ScatterName, THREE.Matrix4[]>()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const put = (name: ScatterName, x: number, z: number, height: number, sink = 0.08, tilt = 0) => {
    const r = BASE_R(name) * height
    if (tooSteep(x, z, Math.min(r, 3))) return false
    const list = out.get(name) ?? []
    q.setFromEuler(e.set(tilt * (rnd() - 0.5), rnd() * Math.PI * 2, tilt * (rnd() - 0.5)))
    list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, baseHeight(x, z, r, sink), z), q, new THREE.Vector3(height, height, height)))
    out.set(name, list)
    return true
  }
  const trees: THREE.Matrix4[] = []
  for (const [name, list] of byModel) if (FOREST.has(name)) trees.push(...list)
  const D = DENSITY
  // Under the trees.
  for (const t of trees) {
    const tx = t.elements[12], tz = t.elements[14]
    const k = rnd()
    const a = rnd() * Math.PI * 2, d = 2.2 + rnd() * 3.5
    const x = tx + Math.cos(a) * d, z = tz + Math.sin(a) * d
    if (!openGround(x, z, 0.8)) continue
    if (k < 0.45 * D) put('fern', x, z, 0.55 + rnd() * 0.35)
    else if (k < 0.62 * D) put('mushroom', x, z, 0.8 + rnd() * 0.6, 0.02)
    else if (k < 0.75 * D) put('pebble', x, z, 0.8 + rnd() * 0.8, 0.03)
  }
  // Fallen logs between trees in the woods (a few).
  let logs = 0
  for (let i = 0; i < trees.length && logs < 46 * D; i++) {
    if (rnd() > 0.12) continue
    const t = trees[Math.floor(rnd() * trees.length)]
    const a = rnd() * Math.PI * 2
    const x = t.elements[12] + Math.cos(a) * 6, z = t.elements[14] + Math.sin(a) * 6
    if (!openGround(x, z, 3) || flatness(x, z) < 0.9) continue
    if (put('log', x, z, 0.7 + rnd() * 0.3, 0.12)) logs++
  }
  // Boulder piles on the open hillsides.
  for (let i = 0, n = 0; i < 2000 && n < 120 * D; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (ISLAND_RADIUS - 40)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!openGround(x, z, 3, 2.5)) continue
    if (put('rock-cluster', x, z, 1.2 + rnd() * 1.8, 0.35)) n++
  }
  // Reeds where the land meets the water.
  for (let i = 0, n = 0; i < 9000 && n < 260 * D; i++) {
    const a = rnd() * Math.PI * 2, r = 60 + Math.sqrt(rnd()) * (ISLAND_RADIUS + 10)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const h = heightAt(x, z)
    if (h < WATER_LEVEL + 0.15 || h > WATER_LEVEL + 0.9) continue
    if (isNearPad(x, z, 2) || isOnRoad(x, z, 1) || insideSet(x, z, 2)) continue
    // The harbour quay and the cove beach stay clear.
    if (Math.hypot(x, z - 330) < 70 || Math.hypot(x + 260, z - 330) < 40) continue
    if (put('reeds', x, z, 1.4 + rnd() * 0.9, 0.1)) {
      n++
      // Reeds grow in beds.
      for (let j = 0; j < 3; j++) {
        const x2 = x + (rnd() - 0.5) * 4, z2 = z + (rnd() - 0.5) * 4
        const h2 = heightAt(x2, z2)
        if (h2 > WATER_LEVEL + 0.1 && h2 < WATER_LEVEL + 1 && put('reeds', x2, z2, 1.2 + rnd() * 0.8, 0.1)) n++
      }
    }
  }
  // Flowering shrubs at the edges of the towns, the village, the temple garden and along the footpaths.
  const edges: [number, number, number][] = [[0, 330, 46], [-66 + 70, 48 - 330, 26], [290, 290, 40], [340, 90, 50], [-260, 330, 50], [0, 150, 64]]
  for (const [cx, cz, rad] of edges)
    for (let i = 0, n = 0; i < 300 && n < 16 * D; i++) {
      const a = rnd() * Math.PI * 2, d = rad * (0.8 + rnd() * 0.5)
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d
      if (!openGround(x, z, 1.5)) continue
      if (put('bush-bloom', x, z, 0.9 + rnd() * 0.6, 0.1)) n++
    }
  return out
}

const WILD: { model: ScatterName; count: number; height: [number, number] }[] = [
  { model: 'pine', count: 280, height: [6, 11] },
  { model: 'tree-fir', count: 170, height: [12, 19] },
  { model: 'tree-fir-wide', count: 70, height: [10, 15] },
  { model: 'tree-oak', count: 160, height: [7, 11] },
  { model: 'tree-round', count: 100, height: [6, 9] },
  { model: 'tree-birch', count: 110, height: [6, 9] },
  { model: 'tree-poplar', count: 40, height: [9, 13] },
  { model: 'autumn-tree', count: 100, height: [5, 8] },
  { model: 'bush', count: 320, height: [0.6, 1.3] },
  { model: 'rock', count: 220, height: [0.8, 2.6] },
]

function wildTransforms(model: ScatterName, count: number, size: [number, number], seed: number) {
  const rnd = mulberry32(seed)
  const out: THREE.Matrix4[] = []
  const q = new THREE.Quaternion()
  let tries = 0
  const small = model === 'rock' || model === 'bush'
  // Trees grow in groves: most new trees seed near one already placed, the rest start new groves.
  const grove = !small
  while (out.length < count && tries++ < count * 20) {
    let x: number, z: number
    if (grove && out.length > 2 && rnd() < 0.72) {
      const o = out[Math.floor(rnd() * out.length)]
      const a = rnd() * Math.PI * 2, d = 4 + rnd() * 12
      x = o.elements[12] + Math.cos(a) * d
      z = o.elements[14] + Math.sin(a) * d
      if (out.some((m) => Math.hypot(m.elements[12] - x, m.elements[14] - z) < 3.2)) continue
    } else {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * (ISLAND_RADIUS - 30)
      x = Math.cos(a) * r
      z = Math.sin(a) * r
    }
    if (isOnTrail(x, z, small ? 0.3 : 2)) continue
    // Districts place their own props; keep out of them (and well off the streets and plazas).
    if (REGIONS.some((g) => Math.hypot(x - g.center[0], z - g.center[1]) < g.radius * (BUILT.has(g.biome) ? 1.25 : 0.85))) continue
    const h = heightAt(x, z)
    if (h < 1.8 || isNearPad(x, z, 3) || isOnRoad(x, z, small ? 1 : 3)) continue
    if (model !== 'rock' && flatness(x, z) < 0.8) continue
    if (MISSIONS.some((m) => Math.hypot(x - m.x, z - m.z) < 10)) continue
    const height = THREE.MathUtils.lerp(size[0], size[1], rnd())
    q.setFromEuler(new THREE.Euler(model === 'rock' ? rnd() * 0.6 : 0, rnd() * Math.PI * 2, 0))
    const sx = model === 'rock' ? 0.8 + rnd() * 0.8 : 1
    if (!small && tooSteep(x, z, BASE_R(model) * height * 1.3)) continue
    const y = baseHeight(x, z, BASE_R(model) * height * sx, 0.2)
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(height * sx, height, height * sx)))
  }
  return out
}

export interface NeonBlock {
  x: number
  z: number
  w: number
  d: number
  h: number
}

let neonCache: NeonBlock[] | null = null

/**
 * The neon skyline: procedural towers ringing the real city block (which fills the centre of the district),
 * generated deterministically for the renderer and the colliders.
 */
export function neonBlocks(): NeonBlock[] {
  if (neonCache) return neonCache
  const r = REGIONS.find((g) => g.id === 'neon')!
  const rnd = mulberry32(77)
  const out: NeonBlock[] = []
  // The explorer spawns a few metres beyond the beacon (see spawnPlayer) with the camera behind them: keep that
  // whole corridor clear of towers, or the camera starts inside a block and the screen is black.
  const bx = r.center[0] + r.beacon[0], bz = r.center[1] + r.beacon[1]
  const len = Math.hypot(r.beacon[0], r.beacon[1]) || 1
  const ax = r.beacon[0] / len, az = r.beacon[1] / len
  const corridor: [number, number][] = [
    [bx, bz],
    [bx + ax * 5, bz + az * 5],
    [bx + ax * 13, bz + az * 13],
  ]
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2,
      d = 98 + rnd() * 24
    const x = r.center[0] + Math.cos(a) * d,
      z = r.center[1] + Math.sin(a) * d
    const near = (px: number, pz: number) => Math.hypot(x - px, z - pz)
    if (corridor.some(([cx, cz]) => near(cx, cz) < 12)) continue
    if (isOnRoad(x, z, 8)) continue
    if (r.landmarks.some((l) => near(r.center[0] + l.at[0], r.center[1] + l.at[1]) < (l.foot ? Math.max(l.foot[0], l.foot[1]) / 2 + 6 : 10))) continue
    if (out.some((b) => Math.hypot(b.x - x, b.z - z) < 11)) continue
    out.push({ x, z, w: 5 + rnd() * 6, d: 5 + rnd() * 6, h: 10 + rnd() * 30 })
  }
  neonCache = out
  return out
}

/** Where the guide NPC stands in the harbour. */
export const GUIDE_SPOT = { x: REGIONS[0].center[0] - 3, z: REGIONS[0].center[1] + 16 }
