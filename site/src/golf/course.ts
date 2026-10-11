// The hole: a heightfield with surfaces (fairway, rough, sand, green, water), a safe route, a shortcut across the lake,
// checkpoints, briefcase spots, trees and the cup. Everything the physics, AI and renderer need comes from here.
import * as THREE from 'three'
import { CONFIG } from './config'

export type Surface = 'fairway' | 'rough' | 'sand' | 'green' | 'water' | 'ice'

export interface HoleDef {
  name: string
  biome: string
  par: number
  route: [number, number][] // safe route, tee to green
  green: [number, number]
  cup: [number, number]
  greenRadius: number
  lake: { c: [number, number]; r: [number, number] }
  bunkers: { c: [number, number]; r: number }[]
  shortcut: [number, number][]
}

// "Lakeside Bend", par 4, in the Greenmeadow biome: a long U around a lake; carrying the lake saves ~37 %.
export const HOLE: HoleDef = {
  name: 'Lakeside Bend',
  biome: 'Greenmeadow',
  par: 4,
  route: [[0, 0], [0, 140], [30, 220], [110, 262], [170, 232], [190, 172]],
  green: [190, 170],
  cup: [192, 166],
  greenRadius: 18,
  lake: { c: [100, 150], r: [60, 56] },
  bunkers: [
    { c: [174, 196], r: 6 },
    { c: [208, 182], r: 5 },
    { c: [-13, 112], r: 7 },
    { c: [52, 236], r: 6 },
  ],
  shortcut: [[0, 140], [190, 170]],
}

/* ---------- Noise ---------- */

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, y: number) {
  let v = 0, a = 0.5, f = 1
  for (let i = 0; i < 4; i++) {
    v += a * noise(x * f, y * f)
    f *= 2
    a *= 0.5
  }
  return v
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* ---------- Course ---------- */

export class Course {
  readonly hole: HoleDef
  readonly segs: { ax: number; az: number; bx: number; bz: number; s0: number; len: number }[] = []
  readonly length: number
  readonly cup: THREE.Vector3
  readonly checkpoints: THREE.Vector3[] = []
  readonly briefcases: THREE.Vector3[] = []
  /** Round obstacles for the ball and players: trees plus props (clubhouse, windmill, benches, rocks). */
  readonly trees: { x: number; z: number; r: number; kind: string; scale: number; yaw: number; h?: number }[] = []
  readonly tee: THREE.Vector3
  readonly bounds = { minX: -110, maxX: 300, minZ: -90, maxZ: 360 }

  constructor(hole: HoleDef = HOLE) {
    this.hole = hole
    let s = 0
    for (let i = 0; i < hole.route.length - 1; i++) {
      const [ax, az] = hole.route[i], [bx, bz] = hole.route[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      this.segs.push({ ax, az, bx, bz, s0: s, len })
      s += len
    }
    this.length = s
    this.tee = new THREE.Vector3(0, this.heightAt(0, 0), 0)
    this.cup = new THREE.Vector3(hole.cup[0], this.heightAt(hole.cup[0], hole.cup[1]), hole.cup[1])

    // Checkpoints every ~80 m on the safe route (the shortcut has none).
    for (let d = 80; d < this.length - 40; d += 80) {
      const p = this.routePoint(d)
      this.checkpoints.push(new THREE.Vector3(p.x, this.heightAt(p.x, p.z), p.z))
    }
    // Briefcases: along the route, at the shortcut entrance and two by the green.
    const spots: [number, number][] = [[60, 8], [150, -10], [235, 10], [305, -8], [375, 8]]
    for (const [d, lat] of spots) {
      const p = this.routePoint(d, lat)
      this.briefcases.push(new THREE.Vector3(p.x, this.heightAt(p.x, p.z), p.z))
    }
    for (const [x, z] of [[24, 152], [hole.green[0] - 15, hole.green[1] + 9], [hole.green[0] + 11, hole.green[1] - 15]] as [number, number][]) {
      this.briefcases.push(new THREE.Vector3(x, this.heightAt(x, z), z))
    }

    // Trees in the rough, clear of the route, lake, green and pickups.
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < 900 && this.trees.length < 110; k++) {
      const x = this.bounds.minX + rnd() * (this.bounds.maxX - this.bounds.minX)
      const z = this.bounds.minZ + rnd() * (this.bounds.maxZ - this.bounds.minZ)
      const d = this.routeNearest(x, z).dist
      if (d < 20 || d > 62) continue
      if (this.heightAt(x, z) < 1.2 || this.landMask(x, z) < 0.95) continue
      if (Math.hypot(x - hole.green[0], z - hole.green[1]) < hole.greenRadius + 12) continue
      if (this.briefcases.some((b) => Math.hypot(b.x - x, b.z - z) < 8)) continue
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue
      // Palms by the lake, the rest a mix of round, pine and autumn trees.
      const kind = this.lakeE(x, z) < 1.7 ? 'palm' : rnd() < 0.45 ? 'tree' : rnd() < 0.6 ? 'pine' : 'autumn'
      this.trees.push({ x, z, r: 0.7, kind, scale: 0.8 + rnd() * 0.6, yaw: rnd() * Math.PI * 2 })
    }
  }

  /** Point on the safe route `d` metres from the tee, offset `lat` metres to the right. */
  routePoint(d: number, lat = 0) {
    d = Math.max(0, Math.min(this.length, d))
    const seg = this.segs.find((s) => d <= s.s0 + s.len) ?? this.segs[this.segs.length - 1]
    const t = (d - seg.s0) / seg.len
    const dx = (seg.bx - seg.ax) / seg.len, dz = (seg.bz - seg.az) / seg.len
    return new THREE.Vector3(seg.ax + (seg.bx - seg.ax) * t - dz * lat, 0, seg.az + (seg.bz - seg.az) * t + dx * lat)
  }

  /** Distance from the route and how far along it the nearest point is. */
  routeNearest(x: number, z: number) {
    let best = Infinity, bestS = 0
    for (const sg of this.segs) {
      const dx = sg.bx - sg.ax, dz = sg.bz - sg.az
      const t = Math.max(0, Math.min(1, ((x - sg.ax) * dx + (z - sg.az) * dz) / (sg.len * sg.len)))
      const px = sg.ax + dx * t, pz = sg.az + dz * t
      const d = Math.hypot(x - px, z - pz)
      if (d < best) {
        best = d
        bestS = sg.s0 + t * sg.len
      }
    }
    return { dist: best, s: bestS }
  }

  /** 1 on the island, 0 out at sea; the coast is a cliff. */
  landMask(x: number, z: number) {
    const d = this.routeNearest(x, z).dist
    const inside = x > -20 && x < 222 && z > 70 && z < 290 ? 1 : 0
    const n = (fbm(x / 30, z / 30) - 0.5) * 16
    return Math.max(1 - smooth(52 + n, 62 + n, d), inside)
  }

  lakeE(x: number, z: number) {
    const { c, r } = this.hole.lake
    return Math.hypot((x - c[0]) / r[0], (z - c[1]) / r[1])
  }

  heightAt(x: number, z: number) {
    const h = this.hole
    const { dist, s } = this.routeNearest(x, z)
    let y = 3.2 + (fbm(x / 70, z / 70) - 0.5) * 6
    // Fairway: a smooth profile along the route.
    const profile = 3.4 + Math.sin(s / 85) * 1.2
    y = THREE.MathUtils.lerp(profile, y, smooth(10, 34, dist))
    // Green: a shallow bowl so balls gather near the cup, with a raised lip.
    const g = Math.hypot(x - h.green[0], z - h.green[1])
    const gy = 3.3
    if (g < h.greenRadius + 8) {
      const bowl = gy - 0.9 * (1 - (Math.min(g, h.greenRadius) / h.greenRadius) ** 2) + smooth(h.greenRadius - 2, h.greenRadius + 3, g) * 0.6
      y = THREE.MathUtils.lerp(bowl, y, smooth(h.greenRadius + 2, h.greenRadius + 8, g))
    }
    // Lake with sloping banks below the water line.
    const e = this.lakeE(x, z)
    if (e < 1.35) y = THREE.MathUtils.lerp(-2.6, y, smooth(0.86, 1.35, e))
    // Bunkers dip slightly.
    for (const b of h.bunkers) {
      const d = Math.hypot(x - b.c[0], z - b.c[1])
      if (d < b.r + 1.5) y -= 0.55 * (1 - smooth(b.r - 1.5, b.r + 1.5, d))
    }
    // Coastline cliffs into the sea.
    const m = this.landMask(x, z)
    return THREE.MathUtils.lerp(-14, y, m)
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.4
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return out.set(-hx, 2 * e, -hz).normalize()
  }

  surfaceAt(x: number, z: number): Surface {
    const h = this.hole
    if (this.heightAt(x, z) < 0.05) return 'water'
    if (Math.hypot(x - h.green[0], z - h.green[1]) < h.greenRadius) return 'green'
    for (const b of h.bunkers) if (Math.hypot(x - b.c[0], z - b.c[1]) < b.r) return 'sand'
    if (this.routeNearest(x, z).dist < 12 || Math.hypot(x, z) < 7) return 'fairway'
    return 'rough'
  }

  friction(s: Surface) {
    return s === 'green' ? CONFIG.friction_green : s === 'fairway' ? CONFIG.friction_fairway : s === 'sand' ? CONFIG.friction_sand : s === 'ice' ? CONFIG.friction_ice : CONFIG.friction_rough
  }

  /** Progress towards the cup along the hole (used for ranking and homing items). */
  progress(x: number, z: number) {
    const dCup = Math.hypot(x - this.cup.x, z - this.cup.z)
    const { s } = this.routeNearest(x, z)
    // Near the green, straight-line distance to the cup is what matters.
    return Math.max(this.length - dCup, s - 8)
  }

  /* ---------- Mesh ---------- */

  buildMesh() {
    const { minX, maxX, minZ, maxZ } = this.bounds
    const cell = 1.6
    const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell)
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, nx, nz).rotateX(-Math.PI / 2)
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)))
    const flat = geo.toNonIndexed()
    flat.computeVertexNormals()
    const p = flat.attributes.position as THREE.BufferAttribute
    const n = flat.attributes.normal as THREE.BufferAttribute
    const colors = new Float32Array(p.count * 3)
    const c = new THREE.Color()
    const palette: Record<string, string> = { fairway: '#67c24a', fairway2: '#5db342', rough: '#3f8f35', green: '#7ed957', sand: '#ecd59a', water: '#c8b27a', rock: '#8a8278', cliff: '#7a6f63' }
    for (let t = 0; t < p.count; t += 3) {
      const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3
      const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3
      const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3
      const slope = 1 - n.getY(t)
      const s = this.surfaceAt(cx, cz)
      let key: string = s
      if (s === 'fairway') key = Math.floor(this.routeNearest(cx, cz).s / 9) % 2 ? 'fairway' : 'fairway2' // mowing stripes
      if (cy < 0.05) key = 'water'
      if (slope > 0.45) key = cy < 1 ? 'cliff' : 'rock'
      c.set(palette[key] ?? palette.rough)
      // A touch of noise keeps the flat shading lively.
      const k = 0.93 + hash(Math.floor(cx), Math.floor(cz)) * 0.1
      for (let v = 0; v < 3; v++) colors.set([c.r * k, c.g * k, c.b * k], (t + v) * 3)
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 }))
    mesh.receiveShadow = true
    return mesh
  }
}
