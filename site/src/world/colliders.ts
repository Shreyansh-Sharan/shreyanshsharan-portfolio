// Solid footprints for everything you can bump into: landmark buildings, scattered trees/rocks/bushes,
// the neon skyline and the guide. Circles and oriented boxes on the ground plane, bucketed into a
// uniform grid so a query only touches the few props near the player, however many there are.
import { REGIONS, type ModelName } from './regions'
import { GUIDE_SPOT, neonBlocks, scatterLayout, type ScatterName } from './layout'
import { heightAt } from './terrain'

export interface Collider {
  x: number
  z: number
  /** Circle radius, or the bounding radius of a box. */
  r: number
  box: boolean
  /** Box half extents along its local x / z, and its yaw (three.js rotation.y convention). */
  hx: number
  hz: number
  cos: number
  sin: number
  /** World height of the prop's top: anything whose feet are above it (flying, jumping) passes over. */
  top: number
  /** World height of the prop's underside: a wall that starts above head height (a balcony, an arch) is passed under. */
  bottom: number
}

export const circleCollider = (x: number, z: number, r: number, top = Infinity): Collider => ({ x, z, r, box: false, hx: 0, hz: 0, cos: 1, sin: 0, top, bottom: -Infinity })

export function boxCollider(x: number, z: number, hx: number, hz: number, yaw = 0, top = Infinity, bottom = -Infinity): Collider {
  return { x, z, r: Math.hypot(hx, hz), box: true, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), top, bottom }
}

/* ---------- Registry ---------- */

const groups = new Map<string, Collider[]>()
let dirty = true

function setGroup(key: string, list: Collider[]) {
  groups.set(key, list)
  dirty = true
}

/** Footprint radius per metre of height for each scattered model, measured from its geometry once loaded. */
const scatterFactor: Partial<Record<ScatterName, number>> = { rock: 0.55, bush: 0.5 }
const DEFAULT_TREE_FACTOR = 0.08

function buildScatter() {
  const list: Collider[] = []
  for (const [name, matrices] of scatterLayout()) {
    const f = scatterFactor[name] ?? DEFAULT_TREE_FACTOR
    const low = name === 'rock' || name === 'bush'
    for (const m of matrices) {
      const e = m.elements
      // Horizontal scale is the length of the matrix's x column (rocks are stretched sideways).
      const sxz = Math.hypot(e[0], e[1], e[2])
      const sy = Math.hypot(e[4], e[5], e[6])
      list.push(circleCollider(e[12], e[14], Math.max(0.3, f * sxz), e[13] + sy * (low ? 0.85 : 1)))
    }
  }
  setGroup('scatter', list)
}

let seeded = false
function seed() {
  if (seeded) return
  seeded = true
  // Until a landmark's model loads and reports its real footprint, fall back to its flattened pad.
  REGIONS.forEach((r) =>
    r.landmarks.forEach((l, i) => {
      if (l.ghost) return
      const x = r.center[0] + l.at[0], z = r.center[1] + l.at[1]
      // Walkable sets start open (their walls are measured once the mesh is in); other props block their pad.
      groups.set(landmarkKey(r.id, i), l.set || l.stand || l.passage ? [] : [circleCollider(x, z, (l.pad ?? 4) * 0.8, heightAt(x, z) + l.height + (l.anim === 'float' ? 1.2 : 0))])
    }),
  )
  const neon = REGIONS.find((r) => r.id === 'neon')!
  const base = heightAt(neon.center[0], neon.center[1])
  groups.set('neon', neonBlocks().map((b) => boxCollider(b.x, b.z, b.w / 2, b.d / 2, 0, base + b.h)))
  groups.set('guide', [circleCollider(GUIDE_SPOT.x, GUIDE_SPOT.z, 0.45, heightAt(GUIDE_SPOT.x, GUIDE_SPOT.z) + 1.9)])
  buildScatter()
}

export const landmarkKey = (region: string, index: number) => `landmark:${region}:${index}`

/** A landmark model reports its measured footprint (replaces the pad-sized fallback); null makes it walk-through. */
export function setLandmarkCollider(key: string, list: Collider[] | null) {
  seed()
  setGroup(key, list ?? [])
}

/* ---------- Floors of walkable sets ---------- */

interface SetFloor {
  x: number
  z: number
  y: number
  yaw: number
  cell: number
  /** Cell key "gx,gz" (in the set's frame) → floor height above the set's base. */
  floor: Map<string, number>
}
const floors = new Map<string, SetFloor>()

/** A walkable set reports the courtyards, quays and terraces measured from its mesh. */
export function setLandmarkFloor(key: string, f: SetFloor | null) {
  if (f) floors.set(key, f)
  else floors.delete(key)
}

/**
 * The highest set floor under (x, z) that is no higher than `feet` + `tolerance` (so a terrace above your head
 * is not the ground), or -Infinity.
 */
export function floorAt(x: number, z: number, feet = Infinity, tolerance = 1.2): number {
  let best = -Infinity
  for (const f of floors.values()) {
    const dx = x - f.x, dz = z - f.z
    if (dx * dx + dz * dz > 160 * 160) continue
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw)
    const lx = dx * c - dz * s, lz = dx * s + dz * c
    const h = f.floor.get(`${Math.floor(lx / f.cell)},${Math.floor(lz / f.cell)}`)
    if (h === undefined) continue
    const y = f.y + h
    if (y <= feet + tolerance && y > best) best = y
  }
  return best
}

/** Terrain or a set's floor, whichever is higher under the feet. */
export function groundAt(x: number, z: number, feet = Infinity) {
  return Math.max(heightAt(x, z), floorAt(x, z, feet))
}

/** A scattered model reports its trunk/base radius as a fraction of its height. */
export function setScatterFactor(name: ModelName, factor: number) {
  seed()
  if (scatterFactor[name] === factor) return
  scatterFactor[name] = factor
  buildScatter()
}

/** Temporary solids (a mini-game's platforms); an empty list removes them. */
export function setExtraColliders(key: string, list: Collider[]) {
  seed()
  setGroup(`extra:${key}`, list)
}

/* ---------- Spatial grid ---------- */

const CELL = 8
const ORIGIN = -720
const N = 180 // 180 * 8 m covers -720..720, the whole island plus margin
let all: Collider[] = []
let cellStart = new Int32Array(N * N + 1)
let cellItems = new Int32Array(0)

const cellOf = (v: number) => Math.min(N - 1, Math.max(0, Math.floor((v - ORIGIN) / CELL)))

function rebuild() {
  seed()
  all = [...groups.values()].flat()
  const counts = new Int32Array(N * N)
  const span = (c: Collider) => [cellOf(c.x - c.r), cellOf(c.x + c.r), cellOf(c.z - c.r), cellOf(c.z + c.r)]
  for (const c of all) {
    const [x0, x1, z0, z1] = span(c)
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) counts[gz * N + gx]++
  }
  cellStart = new Int32Array(N * N + 1)
  for (let i = 0; i < N * N; i++) cellStart[i + 1] = cellStart[i] + counts[i]
  cellItems = new Int32Array(cellStart[N * N])
  const fill = cellStart.slice(0, N * N)
  all.forEach((c, idx) => {
    const [x0, x1, z0, z1] = span(c)
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) cellItems[fill[gz * N + gx]++] = idx
  })
  dirty = false
}

/* ---------- Queries ---------- */

/**
 * Push a circle of `radius` at (p.x, p.z) out of every overlapping collider, along the shortest way
 * out (radially for circles, along the shallower axis for boxes). Mutates `p`; returns true if moved.
 * A few passes settle corners where two props touch, so the mover never ends up stuck inside. Props whose
 * top is below `feet` are ignored, so whatever flies or jumps above them passes over.
 */
export function resolve(p: { x: number; z: number }, radius: number, feet = -Infinity): boolean {
  if (dirty) rebuild()
  let movedAny = false
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    const x0 = cellOf(p.x - radius), x1 = cellOf(p.x + radius)
    const z0 = cellOf(p.z - radius), z1 = cellOf(p.z + radius)
    for (let gz = z0; gz <= z1; gz++)
      for (let gx = x0; gx <= x1; gx++) {
        const cell = gz * N + gx
        for (let k = cellStart[cell], end = cellStart[cell + 1]; k < end; k++) {
          const c = all[cellItems[k]]
          if (c.top > feet && c.bottom < feet + 1.6 && pushOut(c, p, radius)) moved = true
        }
      }
    if (!moved) break
    movedAny = true
  }
  return movedAny
}

function pushOut(c: Collider, p: { x: number; z: number }, radius: number) {
  const dx = p.x - c.x, dz = p.z - c.z
  const reach = c.r + radius
  if (dx * dx + dz * dz >= reach * reach) return false
  if (!c.box) {
    let d = Math.hypot(dx, dz)
    let nx = dx, nz = dz
    if (d < 1e-4) {
      nx = 1
      nz = 0
      d = 1
    }
    p.x = c.x + (nx / d) * reach
    p.z = c.z + (nz / d) * reach
    return true
  }
  // Into the box's frame (inverse of three.js yaw), resolve along the shallower axis, and back out.
  let lx = dx * c.cos - dz * c.sin
  let lz = dx * c.sin + dz * c.cos
  const px = c.hx + radius - Math.abs(lx)
  const pz = c.hz + radius - Math.abs(lz)
  if (px <= 0 || pz <= 0) return false
  if (px < pz) lx = (lx < 0 ? -1 : 1) * (c.hx + radius)
  else lz = (lz < 0 ? -1 : 1) * (c.hz + radius)
  p.x = c.x + lx * c.cos + lz * c.sin
  p.z = c.z - lx * c.sin + lz * c.cos
  return true
}

/**
 * The roof under a point: the highest box collider (a neon block, a platform) whose footprint holds (x, z) and whose
 * top is no higher than `feet` + `tolerance`, or -Infinity. Lets the player land on and walk across roofs.
 */
export function roofAt(x: number, z: number, feet: number, tolerance = 0.6): number {
  if (dirty) rebuild()
  let top = -Infinity
  const cell = cellOf(z) * N + cellOf(x)
  for (let k = cellStart[cell], end = cellStart[cell + 1]; k < end; k++) {
    const c = all[cellItems[k]]
    if (!c.box || c.top === Infinity || c.top > feet + tolerance || c.top <= top) continue
    const dx = x - c.x, dz = z - c.z
    const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos
    if (Math.abs(lx) <= c.hx + 0.2 && Math.abs(lz) <= c.hz + 0.2) top = c.top
  }
  return top
}

const probe = { x: 0, z: 0 }

/** True if a circle at (x, z) would overlap any collider (used to keep wander targets clear). */
export function blocked(x: number, z: number, radius: number, feet = -Infinity) {
  probe.x = x
  probe.z = z
  return resolve(probe, radius, feet)
}

/** For tests (`?snap`): every registered collider. */
export function colliderList(): readonly Collider[] {
  if (dirty) rebuild()
  return all
}
