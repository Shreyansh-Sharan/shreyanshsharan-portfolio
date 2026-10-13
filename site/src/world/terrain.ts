// Procedural island: one height function shared by the terrain mesh, prop placement and the player.
import * as THREE from 'three'
import { ISLAND_RADIUS, REGIONS, ROADS, WATER_LEVEL, type Biome, type Region } from './regions'

/* ---------- Noise ---------- */

const PERM = (() => {
  const p = new Uint8Array(512)
  let s = 1337
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const base = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[base[i], base[j]] = [base[j], base[i]]
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]
  return p
})()

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
function grad(h: number, x: number, y: number) {
  switch (h & 7) {
    case 0: return x + y
    case 1: return -x + y
    case 2: return x - y
    case 3: return -x - y
    case 4: return x
    case 5: return -x
    case 6: return y
    default: return -y
  }
}

/** Perlin noise in roughly [-1, 1]. */
export function noise(x: number, y: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255
  x -= Math.floor(x)
  y -= Math.floor(y)
  const u = fade(x), v = fade(y)
  const a = PERM[X] + Y, b = PERM[X + 1] + Y
  const l1 = THREE.MathUtils.lerp(grad(PERM[a], x, y), grad(PERM[b], x - 1, y), u)
  const l2 = THREE.MathUtils.lerp(grad(PERM[a + 1], x, y - 1), grad(PERM[b + 1], x - 1, y - 1), u)
  return THREE.MathUtils.lerp(l1, l2, v)
}

export function fbm(x: number, y: number, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f)
    f *= 2.03
    amp *= 0.5
  }
  return sum
}

const ridged = (x: number, y: number) => {
  let sum = 0, amp = 0.5, f = 1
  for (let i = 0; i < 4; i++) {
    sum += amp * (1 - Math.abs(noise(x * f, y * f)))
    f *= 2.1
    amp *= 0.5
  }
  return sum
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------- Roads ---------- */

interface Seg { ax: number; az: number; bx: number; bz: number; ah: number; bh: number; len: number }
const SEGS: Seg[] = []

/** Distance to the nearest road centreline and the road's height there (a straight ramp between its points). */
export function roadAt(x: number, z: number): { d: number; h: number } {
  let best = Infinity, h = 0
  for (const s of SEGS) {
    const dx = s.bx - s.ax, dz = s.bz - s.az
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = s.ax + dx * t, pz = s.az + dz * t
    const d = Math.hypot(x - px, z - pz)
    if (d < best) {
      best = d
      h = s.ah + (s.bh - s.ah) * t
    }
  }
  return { d: best, h }
}

export const ROAD_HALF = 4.2

/* ---------- Height ---------- */

const KEEP = REGIONS.find((r) => r.id === 'ridge')!
/** Direction (from the keep's centre) the approach ramp runs down. */
const RAMP_DIR = Math.atan2(-20 - KEEP.center[0], -220 - KEEP.center[1])

function biomeHeight(r: Region, x: number, z: number, d: number, generic: number) {
  switch (r.biome) {
    case 'harbour':
      return 3.4 + noise(x * 0.05, z * 0.05) * 0.4
    case 'arcade':
      return 4.2 + noise(x * 0.08, z * 0.08) * 0.15
    case 'neon':
      return 7.2
    case 'stadium':
      return 3.6
    case 'highland':
      return 4 + (fbm(x * 0.012, z * 0.012) + 0.4) * 15
    case 'keep': {
      // A plateau with a cliff all round, except for the wedge the road climbs.
      const plateau = 42 + ridged(x * 0.02, z * 0.02) * 2.5
      const k = d / r.radius
      const cliff = THREE.MathUtils.lerp(plateau, generic, smoothstep(0.72, 1.0, k))
      const ang = Math.atan2(x - r.center[0], z - r.center[1])
      let da = Math.abs(ang - RAMP_DIR)
      if (da > Math.PI) da = Math.PI * 2 - da
      const ramp = THREE.MathUtils.lerp(plateau, generic, smoothstep(0.55, 1.6, k))
      return THREE.MathUtils.lerp(cliff, ramp, smoothstep(0.34, 0.12, da))
    }
    case 'temple':
      return 4 + 22 * Math.exp(-((d / 62) ** 2)) + fbm(x * 0.03, z * 0.03) * 2.5
    case 'cove':
      return 1.4 + fbm(x * 0.025, z * 0.025) * 8 - 1.2
    case 'canyon': {
      const lx = x - r.center[0], lz = z - r.center[1]
      const base = 9 + (fbm(x * 0.02, z * 0.02) + 0.4) * 22
      const terrace = Math.floor(base / 3.5) * 3.5 + smoothstep(0, 3.5, base % 3.5) * 0.8
      const river = Math.abs(lz - Math.sin(lx * 0.06) * 9 - 18)
      return THREE.MathUtils.lerp(2.2, terrace, smoothstep(4, 10, river))
    }
    case 'plains':
      return 2.8 + fbm(x * 0.02, z * 0.02) * 0.9
  }
}

/** The bays: harbour water south of the town and the cove's inlet. */
const BAYS: [number, number, number][] = [
  [0, 440, 95],
  [-300, 420, 80],
]

function rawHeight(x: number, z: number) {
  const dist = Math.hypot(x, z)
  const coast = smoothstep(ISLAND_RADIUS + 30, ISLAND_RADIUS - 70, dist + fbm(x * 0.004, z * 0.004) * 90)
  const generic = 3 + (fbm(x * 0.006, z * 0.006) + 0.2) * 9 + fbm(x * 0.03, z * 0.03) * 0.8

  let wsum = 0, hsum = 0
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.center[0], z - r.center[1])
    const w = Math.exp(-((d / (r.radius * 1.15)) ** 2) * 1.8)
    if (w < 0.003) continue
    wsum += w
    hsum += w * biomeHeight(r, x, z, d, generic)
  }
  let land = wsum > 0 ? THREE.MathUtils.lerp(generic, hsum / wsum, Math.min(1, wsum * 1.4)) : generic
  for (const [bx, bz, br] of BAYS) land = THREE.MathUtils.lerp(land, -6, smoothstep(br, br * 0.45, Math.hypot(x - bx, z - bz)))
  return THREE.MathUtils.lerp(-8, land, coast)
}

/** Road centrelines, for the ground shader. */
export const RSEGS: readonly { ax: number; az: number; bx: number; bz: number }[] = SEGS

// Road vertices sit on the base terrain; the road is then a straight ramp between them.
for (const line of ROADS)
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1]
    SEGS.push({ ax, az, bx, bz, ah: Math.max(rawHeight(ax, az), WATER_LEVEL + 1.2), bh: Math.max(rawHeight(bx, bz), WATER_LEVEL + 1.2), len: Math.hypot(bx - ax, bz - az) })
  }

function roadHeight(x: number, z: number) {
  let h = rawHeight(x, z)
  const road = roadAt(x, z)
  if (road.d < ROAD_HALF + 9) h = THREE.MathUtils.lerp(h, road.h, smoothstep(ROAD_HALF + 9, ROAD_HALF + 1, road.d))
  return h
}

/** Flat pads under landmarks and beacons so buildings sit level. */
interface Pad { x: number; z: number; r: number; h: number }
const PADS: Pad[] = []
for (const r of REGIONS) {
  for (const l of r.landmarks) {
    if (l.ghost && !l.pad) continue
    const x = r.center[0] + l.at[0], z = r.center[1] + l.at[1]
    // The pad covers the whole footprint (its corners too), so the building's base sits on level ground.
    const reach = Math.max(l.pad ?? 4, l.foot && !l.ghost ? Math.hypot(l.foot[0], l.foot[1]) / 2 + 0.5 : 0)
    // A pad inside a neighbour's pad (a still beside the distillery) takes the level that neighbour already set, so
    // clustered props share one flat yard instead of tilting it.
    PADS.push({ x, z, r: reach, h: Math.max(heightAt(x, z), WATER_LEVEL + 1.6) })
  }
  const bx = r.center[0] + r.beacon[0], bz = r.center[1] + r.beacon[1]
  PADS.push({ x: bx, z: bz, r: 3, h: Math.max(roadHeight(bx, bz), WATER_LEVEL + 1.4) })
}

export function heightAt(x: number, z: number) {
  let h = roadHeight(x, z)
  for (const p of PADS) {
    const dx = x - p.x, dz = z - p.z
    const reach = p.r + 8
    if (dx * dx + dz * dz > reach * reach) continue
    const d = Math.sqrt(dx * dx + dz * dz)
    h = THREE.MathUtils.lerp(h, p.h, smoothstep(p.r + 8, p.r, d))
  }
  return h
}

/* ---------- Colour ---------- */

const C = (hex: string) => new THREE.Color(hex)
const PAL = {
  grassA: C('#5d9a3c'), grassB: C('#86b44f'), rock: C('#8d867c'), rockDark: C('#6f6a62'), sand: C('#e6cf98'), seabed: C('#8a7a5a'),
  stone: C('#b9b0a0'), stoneDark: C('#a39a8a'), asphalt: C('#222737'), asphaltB: C('#2c3246'), road: C('#2f3138'), roadLine: C('#e4c35a'), kerb: C('#9c968a'),
  heather: C('#8b6aa6'), hlA: C('#4c8a39'), hlB: C('#76a64a'), snow: C('#f1f4f8'), moss: C('#4f7f3a'), sandDark: C('#c9ad78'),
  autumnA: C('#9aa04a'), autumnB: C('#c08a3d'), plaza: C('#6b6878'), plazaB: C('#7d7890'), lush: C('#3fae5c'), concrete: C('#a8a7a3'), concreteB: C('#8f8e8a'),
  canyon: [C('#9b3f27'), C('#c45f30'), C('#dd8b4f'), C('#ebb47e')], river: C('#5f8f7c'), keepGrass: C('#5f8e45'), keepRock: C('#7a7570'),
  fields: [C('#d9c35a'), C('#8db24d'), C('#a07a4a'), C('#c7d26a'), C('#b8a04e')], pitch: C('#3f9a3c'),
}

const BUILT = new Set<Biome>(['neon', 'stadium', 'arcade'])
const tmp = new THREE.Color()
function biomeColor(b: Biome, r: Region, x: number, z: number, h: number, flat: number, out: THREE.Color) {
  const v = fbm(x * 0.05, z * 0.05) * 0.5 + 0.5
  const steep = 1 - smoothstep(0.62, 0.86, flat)
  const d = Math.hypot(x - r.center[0], z - r.center[1])
  switch (b) {
    case 'harbour': {
      if (d < 32) return out.copy(((Math.floor(x / 2.5) + Math.floor(z / 2.5)) & 1) ? PAL.stone : PAL.stoneDark)
      return out.copy(PAL.grassA).lerp(PAL.grassB, v)
    }
    case 'arcade': {
      if (d < 56) {
        const ring = Math.floor(d / 6) & 1
        return out.copy(ring ? PAL.plaza : PAL.plazaB).lerp(PAL.stone, 0.12)
      }
      return out.copy(PAL.grassA).lerp(PAL.grassB, v)
    }
    case 'neon':
      return out.copy(PAL.asphalt).lerp(PAL.asphaltB, v)
    case 'stadium': {
      if (d < 84) return out.copy(((Math.floor(x / 4) + Math.floor(z / 4)) & 1) ? PAL.concrete : PAL.concreteB)
      return out.copy(PAL.grassA).lerp(PAL.grassB, v * 0.6 + 0.3)
    }
    case 'highland':
      out.copy(PAL.hlA).lerp(PAL.hlB, v)
      if (v > 0.66) out.lerp(PAL.heather, smoothstep(0.66, 0.78, v))
      return out.lerp(PAL.rock, steep)
    case 'keep':
      out.copy(PAL.keepGrass).lerp(PAL.keepRock, smoothstep(0.9, 0.5, flat))
      if (d < 70) out.lerp(PAL.stoneDark, 0.55)
      return out.lerp(PAL.rockDark, steep * 0.9)
    case 'temple':
      out.copy(PAL.moss).lerp(PAL.autumnB, v * 0.5)
      if (Math.abs(x - r.center[0]) < 7 && z > r.center[1] - 10) return out.copy(PAL.sandDark)
      return out.lerp(PAL.rock, steep)
    case 'cove':
      return out.copy(PAL.sand).lerp(PAL.lush, smoothstep(2.2, 3.6, h) * (0.7 + v * 0.3))
    case 'canyon': {
      const lx = x - r.center[0], lz = z - r.center[1]
      if (Math.abs(lz - Math.sin(lx * 0.06) * 9 - 18) < 6) return out.copy(PAL.river)
      const band = PAL.canyon[Math.abs(Math.floor(h / 3.5)) % 4]
      return out.copy(band).multiplyScalar(0.85 + v * 0.3)
    }
    case 'plains': {
      const cx = Math.floor((x + 1000) / 15), cz = Math.floor((z + 1000) / 11)
      const field = PAL.fields[(cx * 7 + cz * 13 + ((cx * cz) & 3)) % PAL.fields.length]
      const stripe = Math.sin((x + z * 0.3) * 1.4) > 0.55 ? 0.86 : 1
      return out.copy(field).multiplyScalar(stripe * (0.92 + v * 0.16))
    }
  }
}

export function colorAt(x: number, z: number, h: number, flat: number, out: THREE.Color) {
  const v = fbm(x * 0.04, z * 0.04) * 0.5 + 0.5
  out.copy(PAL.grassA).lerp(PAL.grassB, v).lerp(PAL.rock, 1 - smoothstep(0.62, 0.86, flat))
  let wsum = 0
  const acc = new THREE.Color(0, 0, 0)
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.center[0], z - r.center[1])
    // Built districts have hard edges (a street does not fade into a meadow); the countryside blends softly.
    const w = BUILT.has(r.biome) && d < r.radius * 1.05 ? 2 : Math.exp(-((d / (r.radius * 1.1)) ** 2) * 2.2)
    if (w < 0.01) continue
    biomeColor(r.biome, r, x, z, h, flat, tmp)
    acc.r += tmp.r * w
    acc.g += tmp.g * w
    acc.b += tmp.b * w
    wsum += w
  }
  if (wsum > 0) out.lerp(acc.multiplyScalar(1 / wsum), Math.min(1, wsum * 1.6))
  // Roads (tarmac, centre line, kerb) are drawn per pixel by the ground shader: their edges are finer than the vertices.
  // Beaches and sea bed.
  if (h < WATER_LEVEL + 1.3) out.lerp(PAL.sand, smoothstep(WATER_LEVEL + 1.3, WATER_LEVEL + 0.4, h))
  if (h < WATER_LEVEL - 0.5) out.lerp(PAL.seabed, smoothstep(-0.5, -4, h))
  return out
}

/* ---------- Footpaths ---------- */

/** Dirt footpaths across the countryside between districts (painted only: the ground keeps its shape). */
export const TRAILS: [number, number][][] = [
  [[20, 150], [90, 128], [170, 118], [250, 104], [316, 92]],
  [[290, -128], [240, -190], [190, -250], [130, -300], [96, -322]],
  [[272, 262], [210, 226], [140, 205], [70, 176], [24, 158]],
  [[-250, 300], [-282, 250], [-300, 205], [-306, 170]],
  [[-110, -236], [-160, -214], [-210, -194], [-236, -182]],
  [[300, -110], [330, -60], [352, 10], [350, 60]],
]
export const TSEGS: { ax: number; az: number; bx: number; bz: number; len: number }[] = []
for (const line of TRAILS)
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1]
    TSEGS.push({ ax, az, bx, bz, len: Math.hypot(bx - ax, bz - az) })
  }

/** Distance to the nearest footpath's (gently wandering) centreline. */
export function trailAt(x: number, z: number) {
  let best = Infinity
  for (const s of TSEGS) {
    const dx = s.bx - s.ax, dz = s.bz - s.az
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t))
    if (d < best) best = d
  }
  // The path meanders a metre or so either side of the straight line (the ground shader uses the same formula).
  return Math.abs(best + trailWobble(x, z))
}

export function trailWobble(x: number, z: number) {
  return Math.sin(x * 0.05) * Math.sin(z * 0.043) * 1.4
}

export const TRAIL_HALF = 1.4

/* ---------- Surfaces (the ground shader's splat weights) ---------- */

/**
 * How much of each ground texture shows at a point: dirt (paths, farm tracks, bare patches), rock (steep slopes,
 * canyon terraces), sand (beaches, sea bed, road grit), paving (town squares, plazas, courtyards) and, separately,
 * how dry the grass is (fields, autumn hills). Lush grass fills whatever is left.
 */
export function surfaceAt(x: number, z: number, h: number, flat: number, out: { a: [number, number, number, number]; dry: number }) {
  let dirt = 0, rock = 1 - smoothstep(0.6, 0.84, flat), sand = 0, paved = 0, dry = 0
  const v = fbm(x * 0.03, z * 0.03) * 0.5 + 0.5
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.center[0], z - r.center[1])
    if (d > r.radius * 1.4) continue
    const inner = smoothstep(r.radius * 1.4, r.radius * 0.9, d)
    switch (r.biome) {
      case 'harbour':
        if (d < 34) paved = Math.max(paved, smoothstep(34, 28, d))
        break
      case 'arcade':
        if (d < 58) paved = Math.max(paved, smoothstep(58, 52, d))
        break
      case 'stadium':
        if (d < 86) paved = Math.max(paved, smoothstep(86, 80, d) * 0.6)
        break
      case 'neon':
        if (d < r.radius * 1.05) paved = Math.max(paved, 0.55)
        break
      case 'keep':
        if (d < 72) paved = Math.max(paved, smoothstep(72, 64, d))
        dry = Math.max(dry, 0.25 * inner)
        break
      case 'canyon':
        rock = Math.max(rock, 0.55 * inner)
        dry = Math.max(dry, 0.8 * inner)
        break
      case 'plains': {
        // Fields: ripe ones dry, ploughed ones bare earth.
        const cx = Math.floor((x + 1000) / 15), cz = Math.floor((z + 1000) / 11)
        const k = (cx * 7 + cz * 13 + ((cx * cz) & 3)) % 5
        if (k === 2) dirt = Math.max(dirt, 0.85 * inner)
        else if (k !== 1) dry = Math.max(dry, 0.75 * inner)
        break
      }
      case 'temple':
        dry = Math.max(dry, 0.45 * inner)
        if (Math.abs(x - r.center[0]) < 7 && z > r.center[1] - 10) dirt = Math.max(dirt, 0.9 * inner)
        break
      case 'highland':
        // Bare earth under the thickest woods.
        if (v < 0.32) dirt = Math.max(dirt, smoothstep(0.32, 0.18, v) * 0.6 * inner)
        break
      case 'cove':
        sand = Math.max(sand, smoothstep(3.6, 2.2, h))
        break
    }
  }
  // Roads and footpaths are drawn per pixel by the shader; paving stops short of the tarmac.
  if (roadAt(x, z).d < ROAD_HALF + 1.2) paved = Math.min(paved, 0.1)
  // Beaches and the sea bed.
  if (h < WATER_LEVEL + 1.4) sand = Math.max(sand, smoothstep(WATER_LEVEL + 1.4, WATER_LEVEL + 0.5, h))
  // Scree breaks up big lush fields a little.
  if (v > 0.8) dirt = Math.max(dirt, (v - 0.8) * 1.2)
  // Normalise so the weights never exceed 1 (lush grass is the remainder).
  const sum = dirt + rock + sand + paved
  const k = sum > 1 ? 1 / sum : 1
  out.a[0] = dirt * k
  out.a[1] = rock * k
  out.a[2] = sand * k
  out.a[3] = paved * k
  out.dry = Math.min(1, dry)
  return out
}

/* ---------- Mesh ---------- */

export function buildTerrain(size: number, segments: number) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
  geo.computeVertexNormals()
  const nrm = geo.attributes.normal as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    colorAt(pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i), c)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // Splat weights for the ground shader.
  const surfA = new Float32Array(pos.count * 4)
  const surfB = new Float32Array(pos.count)
  const sf = { a: [0, 0, 0, 0] as [number, number, number, number], dry: 0 }
  for (let i = 0; i < pos.count; i++) {
    surfaceAt(pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i), sf)
    surfA.set(sf.a, i * 4)
    surfB[i] = sf.dry
  }
  geo.setAttribute('surfA', new THREE.BufferAttribute(surfA, 4))
  geo.setAttribute('surfB', new THREE.BufferAttribute(surfB, 1))
  // Which triangles can hold road (the shader only runs its per-pixel road test there).
  const reach = ROAD_HALF + 1.5 + (size / segments) * 1.5
  const surfR = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) surfR[i] = roadAt(pos.getX(i), pos.getZ(i)).d < reach ? 1 : 0
  geo.setAttribute('surfR', new THREE.BufferAttribute(surfR, 1))
  return geo
}

/** Slope check used when scattering props. */
export function flatness(x: number, z: number) {
  const e = 1.2
  const dx = heightAt(x + e, z) - heightAt(x - e, z)
  const dz = heightAt(x, z + e) - heightAt(x, z - e)
  return new THREE.Vector3(-dx, 2 * e, -dz).normalize().y
}

export function isNearPad(x: number, z: number, margin = 2) {
  return PADS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + margin)
}

/** True on or next to a road (nothing grows there). */
/** On a footpath (or within `margin` of its edge). */
export function isOnTrail(x: number, z: number, margin = 0.5) {
  return trailAt(x, z) < TRAIL_HALF + margin
}

export function isOnRoad(x: number, z: number, margin = 2) {
  return roadAt(x, z).d < ROAD_HALF + margin
}
