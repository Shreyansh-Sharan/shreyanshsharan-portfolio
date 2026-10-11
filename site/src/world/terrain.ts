// Procedural island: one height function shared by the terrain mesh, prop placement and the player.
import * as THREE from 'three'
import { ISLAND_RADIUS, REGIONS, WATER_LEVEL, type Biome, type Region } from './regions'

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

/* ---------- Height ---------- */

function biomeHeight(r: Region, x: number, z: number, d: number) {
  switch (r.biome) {
    case 'plaza':
      return 3 + noise(x * 0.08, z * 0.08) * 0.3
    case 'neon':
      return 2.2
    case 'highland':
      return 4 + (fbm(x * 0.018, z * 0.018) + 0.4) * 13
    case 'ridge':
      return 6 + 32 * Math.exp(-((d / 30) ** 2)) + ridged(x * 0.016, z * 0.016) * 12
    case 'campus':
      return 3.4 + fbm(x * 0.025, z * 0.025) * 3
    case 'dunes': {
      const w = Math.sin(x * 0.085 + fbm(x * 0.02, z * 0.02) * 4) * 0.5 + 0.5
      return 2.6 + w * w * 5 + fbm(x * 0.04, z * 0.04) * 1.2
    }
    case 'lab':
      return 1.2 + fbm(x * 0.03, z * 0.03) * 10 - 1.5
    case 'canyon': {
      const lx = x - r.center[0], lz = z - r.center[1]
      const base = 9 + (fbm(x * 0.02, z * 0.02) + 0.4) * 22
      const terrace = Math.floor(base / 3.5) * 3.5 + smoothstep(0, 3.5, base % 3.5) * 0.8
      const river = Math.abs(lz - Math.sin(lx * 0.06) * 9 - 18)
      return THREE.MathUtils.lerp(2.2, terrace, smoothstep(4, 10, river))
    }
    case 'plains':
      return 2.4 + fbm(x * 0.02, z * 0.02) * 0.9
    case 'speedway':
      return 2.4
  }
}

function rawHeight(x: number, z: number) {
  const dist = Math.hypot(x, z)
  const coast = smoothstep(ISLAND_RADIUS + 18, ISLAND_RADIUS - 46, dist + fbm(x * 0.006, z * 0.006) * 46)
  const generic = 2.6 + (fbm(x * 0.012, z * 0.012) + 0.2) * 7 + fbm(x * 0.06, z * 0.06) * 0.7

  let wsum = 0, hsum = 0
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.center[0], z - r.center[1])
    const w = Math.exp(-((d / (r.radius * 1.15)) ** 2) * 1.8)
    if (w < 0.003) continue
    wsum += w
    hsum += w * biomeHeight(r, x, z, d)
  }
  const land = wsum > 0 ? THREE.MathUtils.lerp(generic, hsum / wsum, Math.min(1, wsum * 1.4)) : generic
  return THREE.MathUtils.lerp(-8, land, coast)
}

/** Flat pads under landmarks and beacons so buildings sit level. */
interface Pad { x: number; z: number; r: number; h: number }
const PADS: Pad[] = []
for (const r of REGIONS) {
  for (const l of r.landmarks) {
    const x = r.center[0] + l.at[0], z = r.center[1] + l.at[1]
    PADS.push({ x, z, r: l.pad ?? 4, h: Math.max(rawHeight(x, z), WATER_LEVEL + 1.6) })
  }
  const bx = r.center[0] + r.beacon[0], bz = r.center[1] + r.beacon[1]
  PADS.push({ x: bx, z: bz, r: 3, h: Math.max(rawHeight(bx, bz), WATER_LEVEL + 1.4) })
}

export function heightAt(x: number, z: number) {
  let h = rawHeight(x, z)
  for (const p of PADS) {
    const d = Math.hypot(x - p.x, z - p.z)
    if (d < p.r + 6) h = THREE.MathUtils.lerp(h, p.h, smoothstep(p.r + 6, p.r, d))
  }
  return h
}

/* ---------- Colour ---------- */

const C = (hex: string) => new THREE.Color(hex)
const PAL = {
  grassA: C('#5d9a3c'), grassB: C('#86b44f'), rock: C('#8d867c'), rockDark: C('#6f6a62'), sand: C('#e6cf98'), seabed: C('#8a7a5a'),
  stone: C('#d3cab8'), stoneDark: C('#bdb39f'), asphalt: C('#222737'), asphaltB: C('#2c3246'),
  heather: C('#8b6aa6'), hlA: C('#4c8a39'), hlB: C('#76a64a'), snow: C('#f1f4f8'),
  autumnA: C('#9aa04a'), autumnB: C('#c08a3d'), duneA: C('#ecc88e'), duneB: C('#d4a465'), lush: C('#3fae5c'),
  canyon: [C('#9b3f27'), C('#c45f30'), C('#dd8b4f'), C('#ebb47e')], river: C('#5f8f7c'),
  fields: [C('#d9c35a'), C('#8db24d'), C('#a07a4a'), C('#c7d26a'), C('#b8a04e')], track: C('#2b2e35'), curbR: C('#e04b3b'), curbW: C('#f4f4f4'),
}

const tmp = new THREE.Color()
function biomeColor(b: Biome, r: Region, x: number, z: number, h: number, flat: number, out: THREE.Color) {
  const v = fbm(x * 0.05, z * 0.05) * 0.5 + 0.5
  const steep = 1 - smoothstep(0.62, 0.86, flat)
  switch (b) {
    case 'plaza': {
      const d = Math.hypot(x - r.center[0], z - r.center[1])
      if (d < 17) return out.copy(((Math.floor(x / 2.5) + Math.floor(z / 2.5)) & 1) ? PAL.stone : PAL.stoneDark)
      return out.copy(PAL.grassA).lerp(PAL.grassB, v)
    }
    case 'neon':
      return out.copy(PAL.asphalt).lerp(PAL.asphaltB, v)
    case 'highland':
      out.copy(PAL.hlA).lerp(PAL.hlB, v)
      if (v > 0.66) out.lerp(PAL.heather, smoothstep(0.66, 0.78, v))
      return out.lerp(PAL.rock, steep)
    case 'ridge':
      out.copy(PAL.hlA).lerp(PAL.rock, smoothstep(12, 18, h))
      out.lerp(PAL.snow, smoothstep(27, 32, h))
      return out.lerp(PAL.rockDark, steep * 0.8)
    case 'campus':
      return out.copy(PAL.autumnA).lerp(PAL.autumnB, v)
    case 'dunes':
      return out.copy(PAL.duneA).lerp(PAL.duneB, Math.min(1, v * 0.7 + steep * 0.6))
    case 'lab':
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
    case 'speedway': {
      const dx = x - r.center[0], dz = z - r.center[1]
      const q = Math.sqrt((dx / 34) ** 2 + (dz / 19) ** 2)
      const edge = Math.abs(q - 1) * 24
      if (edge < 3.4) return out.copy(PAL.track)
      if (edge < 4.2) return out.copy((Math.floor(Math.atan2(dz, dx) * 12) & 1) ? PAL.curbR : PAL.curbW)
      return out.copy(PAL.grassA).lerp(PAL.grassB, v * 0.6 + 0.3)
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
    const w = Math.exp(-((d / (r.radius * 1.1)) ** 2) * 2.2)
    if (w < 0.01) continue
    biomeColor(r.biome, r, x, z, h, flat, tmp)
    acc.r += tmp.r * w
    acc.g += tmp.g * w
    acc.b += tmp.b * w
    wsum += w
  }
  if (wsum > 0) out.lerp(acc.multiplyScalar(1 / wsum), Math.min(1, wsum * 1.6))
  // Beaches and sea bed.
  if (h < WATER_LEVEL + 1.3) out.lerp(PAL.sand, smoothstep(WATER_LEVEL + 1.3, WATER_LEVEL + 0.4, h))
  if (h < WATER_LEVEL - 0.5) out.lerp(PAL.seabed, smoothstep(-0.5, -4, h))
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
