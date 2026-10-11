// Deterministic placement shared by the renderer and the collision code: scattered props and the
// neon skyline. Kept free of React so colliders.ts can build from it without import cycles.
import * as THREE from 'three'
import { AVAILABLE_MODELS, REGIONS, type ModelName, type Region, type Scatter } from './regions'
import { flatness, heightAt, isNearPad, mulberry32 } from './terrain'
import { MISSIONS } from './missions'

export type ScatterName = ModelName | 'rock' | 'bush'

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

function scatterTransforms(region: Region, s: Scatter, seed: number) {
  const rnd = mulberry32(seed)
  const out: THREE.Matrix4[] = []
  const q = new THREE.Quaternion()
  const count = Math.round(s.count * DENSITY)
  let tries = 0
  while (out.length < count && tries++ < count * 12) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * s.radius
    const x = region.center[0] + Math.cos(a) * r, z = region.center[1] + Math.sin(a) * r
    const h = heightAt(x, z)
    const minH = s.model === 'palm' ? 0.9 : 1.6
    if (h < minH || isNearPad(x, z, s.model === 'rock' || s.model === 'bush' ? 1.5 : 4)) continue
    if (s.model !== 'rock' && flatness(x, z) < 0.78) continue
    if (region.biome === 'speedway' || region.biome === 'neon') continue
    if (Math.hypot(x, z) < 20 && region.id !== 'hub') continue
    // Keep the ground around mission beacons (and the spawn points next to them) clear.
    if (MISSIONS.some((m) => Math.hypot(x - m.x, z - m.z) < 10)) continue
    const height = THREE.MathUtils.lerp(s.height[0], s.height[1], rnd())
    q.setFromEuler(new THREE.Euler(s.model === 'rock' ? rnd() * 0.6 : 0, rnd() * Math.PI * 2, 0))
    const sx = s.model === 'rock' ? 0.8 + rnd() * 0.8 : 1
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.15, z), q, new THREE.Vector3(height * sx, height, height * sx)))
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
  // The countryside between regions: woods, hedges and boulders so the island never looks bare.
  WILD.forEach((w, i) => {
    const list = byModel.get(w.model) ?? []
    list.push(...wildTransforms(w.model, Math.round(w.count * DENSITY), w.height, 7000 + i * 31))
    byModel.set(w.model, list)
  })
  scatterCache = [...byModel.entries()]
  return scatterCache
}

const WILD: { model: ScatterName; count: number; height: [number, number] }[] = [
  { model: 'pine', count: 110, height: [6, 11] },
  { model: 'autumn-tree', count: 45, height: [5, 8] },
  { model: 'bush', count: 130, height: [0.6, 1.3] },
  { model: 'rock', count: 80, height: [0.8, 2.6] },
]

function wildTransforms(model: ScatterName, count: number, size: [number, number], seed: number) {
  const rnd = mulberry32(seed)
  const out: THREE.Matrix4[] = []
  const q = new THREE.Quaternion()
  let tries = 0
  while (out.length < count && tries++ < count * 20) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * 232
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    // Regions place their own props; keep out of them (and well off the speedway and neon streets).
    if (REGIONS.some((g) => Math.hypot(x - g.center[0], z - g.center[1]) < g.radius * (g.biome === 'speedway' || g.biome === 'neon' ? 1.3 : 0.85))) continue
    const h = heightAt(x, z)
    if (h < 1.8 || isNearPad(x, z, 3)) continue
    if (model !== 'rock' && flatness(x, z) < 0.8) continue
    if (MISSIONS.some((m) => Math.hypot(x - m.x, z - m.z) < 10)) continue
    const height = THREE.MathUtils.lerp(size[0], size[1], rnd())
    q.setFromEuler(new THREE.Euler(model === 'rock' ? rnd() * 0.6 : 0, rnd() * Math.PI * 2, 0))
    const sx = model === 'rock' ? 0.8 + rnd() * 0.8 : 1
    out.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.15, z), q, new THREE.Vector3(height * sx, height, height * sx)))
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

/** The neon skyline's building footprints, generated deterministically for the renderer and the colliders. */
export function neonBlocks(): NeonBlock[] {
  if (neonCache) return neonCache
  const r = REGIONS.find((g) => g.id === 'neon')!
  const rnd = mulberry32(77)
  const out: NeonBlock[] = []
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2,
      d = 14 + rnd() * 30
    const x = r.center[0] + Math.cos(a) * d,
      z = r.center[1] + Math.sin(a) * d
    const near = (bx: number, bz: number) => Math.hypot(x - bx, z - bz)
    if (near(r.center[0] - 14, r.center[1] + 10) < 7 || near(r.center[0] - 6, r.center[1] + 16) < 6) continue
    out.push({ x, z, w: 4 + rnd() * 5, d: 4 + rnd() * 5, h: 8 + rnd() * 26 })
  }
  neonCache = out
  return out
}

/** Where the guide NPC stands in the hub. */
export const GUIDE_SPOT = { x: REGIONS[0].center[0] - 3, z: REGIONS[0].center[1] + 9 }
