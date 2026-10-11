// The holes: a heightfield with surfaces (fairway, rough, sand, green, ice, water or lava), a safe route, a shortcut
// across the lake, checkpoints, briefcase spots, parked carts, trees and the cup. Everything the physics, AI and
// renderer need comes from here. Generation is deterministic: online clients rebuild the same hole from its id.
import * as THREE from 'three'
import { CONFIG } from './config'

export type Surface = 'fairway' | 'rough' | 'sand' | 'green' | 'water' | 'ice'
export type HoleId = 'lakeside' | 'canyon' | 'frost' | 'magma'
export type Terrain = 'meadow' | 'canyon' | 'snow' | 'volcano'

export interface HoleEnv {
  /** Sky: the scattering shader with these settings, or a flat gradient (night). */
  sky: { turbidity: number; rayleigh: number } | { top: string; bottom: string }
  fog: [string, number, number]
  hemi: [string, string, number]
  sun: [string, number]
  sunDir: [number, number, number]
  exposure: number
  sea: { color: string; emissive?: string; opacity: number }
  palette: Record<string, string>
}

export interface HoleDef {
  id: HoleId
  name: string
  biome: string
  blurb: string
  accent: string
  par: number
  route: [number, number][] // safe route, tee to green
  green: [number, number]
  cup: [number, number]
  greenRadius: number
  /** The lake inside the bend (frozen solid on the snow hole). */
  lake: { c: [number, number]; r: [number, number]; ice?: boolean }
  bunkers: { c: [number, number]; r: number }[]
  shortcut: [number, number][]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Kept as land however far from the route (the inside of the bend). */
  inside: [number, number, number, number] | null
  /** Distance from the route where the coast starts. */
  coast: number
  hazard: 'water' | 'lava'
  terrain: Terrain
  /** Jump ramps beside the fairway: `at` metres along the route, `lat` to the right. */
  ramps: { at: number; lat: number; len: number; h: number; w: number }[]
  /** Ice sheets on the fairway (snow hole). */
  icePatches: { c: [number, number]; r: number }[]
  /** Briefcases: [metres along the route, metres right of it], plus fixed spots. */
  cases: [number, number][]
  caseSpots: [number, number][]
  /** Parked carts: [metres along the route, metres right of it]. */
  carts: [number, number][]
  /** Cacti planted on the fairway itself (desert): [along, right]. */
  cacti: [number, number][]
  trees: { count: number; band: [number, number]; kinds: [string, number][] }
  /** Base wind in m/s (gusting); 0 for calm. */
  wind: number
  env: HoleEnv
}

const MEADOW: Record<string, string> = { fairway: '#67c24a', fairway2: '#5db342', rough: '#3f8f35', green: '#7ed957', sand: '#ecd59a', water: '#c8b27a', rock: '#8a8278', cliff: '#7a6f63', ice: '#bfe6f5' }

export const HOLES: HoleDef[] = [
  // "Lakeside Bend", par 4, in the Greenmeadow biome: a long U around a lake; carrying the lake saves ~37 %.
  {
    id: 'lakeside',
    name: 'Lakeside Bend',
    biome: 'Greenmeadow',
    blurb: 'A long U around a lake. Carry the water to save a third of the hole.',
    accent: '#bef264',
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
    bounds: { minX: -110, maxX: 300, minZ: -90, maxZ: 360 },
    inside: [-20, 222, 70, 290],
    coast: 52,
    hazard: 'water',
    terrain: 'meadow',
    ramps: [{ at: 182, lat: 14, len: 9, h: 1.8, w: 7 }],
    icePatches: [],
    cases: [[60, 8], [150, -10], [235, 10], [305, -8], [375, 8], [110, -12], [200, 13], [270, -13]],
    caseSpots: [[24, 152], [175, 179], [201, 155]],
    carts: [[2, 9], [96, -14], [228, 16], [330, 15]],
    cacti: [],
    trees: { count: 110, band: [20, 62], kinds: [['tree', 0.45], ['pine', 0.33], ['autumn', 0.22]] },
    wind: 0,
    env: {
      sky: { turbidity: 2.2, rayleigh: 1.4 },
      fog: ['#bfe3ff', 260, 900],
      hemi: ['#dff1ff', '#5b7a3a', 1.1],
      sun: ['#fff4dd', 2.4],
      sunDir: [0.45, 0.62, -0.35],
      exposure: 0.9,
      sea: { color: '#2b9fd6', opacity: 0.85 },
      palette: MEADOW,
    },
  },
  // "Rattlesnake Canyon", par 5, desert: a staircase through red-rock walls, cactus on the fairway, an oasis to carry
  // and jump ramps for the carts.
  {
    id: 'canyon',
    name: 'Rattlesnake Canyon',
    biome: 'Sunscorch Desert',
    blurb: 'A long par 5 between red-rock walls. Cactus on the fairway, an oasis to carry, ramps to jump.',
    accent: '#fb923c',
    par: 5,
    route: [[0, 0], [10, 120], [70, 200], [70, 300], [140, 370], [212, 372]],
    green: [212, 370],
    cup: [215, 366],
    greenRadius: 17,
    lake: { c: [140, 270], r: [34, 42] },
    bunkers: [
      { c: [-14, 90], r: 7 },
      { c: [86, 180], r: 6 },
      { c: [52, 262], r: 7 },
      { c: [196, 390], r: 6 },
      { c: [232, 352], r: 5 },
    ],
    shortcut: [[70, 220], [212, 370]],
    bounds: { minX: -100, maxX: 320, minZ: -80, maxZ: 470 },
    inside: null,
    coast: 1000,
    hazard: 'water',
    terrain: 'canyon',
    ramps: [
      { at: 62, lat: -12, len: 10, h: 2.4, w: 7 },
      { at: 214, lat: 13, len: 10, h: 2.6, w: 7 },
      { at: 330, lat: -12, len: 11, h: 3, w: 8 },
      { at: 420, lat: 12, len: 9, h: 2.2, w: 7 },
    ],
    icePatches: [],
    cases: [[45, 9], [95, -10], [140, 10], [185, -9], [235, -11], [275, 9], [320, 10], [365, -9], [410, -10], [455, 9]],
    caseSpots: [[100, 250], [200, 352]],
    carts: [[2, 9], [120, 15], [260, -16], [385, 16]],
    cacti: [[92, -3], [160, 5], [228, -5], [292, 4], [348, -3], [430, 5]],
    trees: { count: 90, band: [14, 30], kinds: [['cactus', 1]] },
    wind: 0,
    env: {
      sky: { turbidity: 6, rayleigh: 0.8 },
      fog: ['#f3d2a2', 240, 820],
      hemi: ['#fff1d6', '#a0643a', 1.15],
      sun: ['#ffe2b0', 2.7],
      sunDir: [-0.35, 0.7, -0.45],
      exposure: 0.92,
      sea: { color: '#26b3b8', opacity: 0.88 },
      palette: { fairway: '#9cc24f', fairway2: '#90b646', rough: '#d8b47a', green: '#7ed36a', sand: '#f2dca4', water: '#b89b6a', rock: '#c0683a', cliff: '#9c4b2a', ice: '#bfe6f5' },
    },
  },
  // "Frostbite Fjord", par 4, snow: a dogleg left around a frozen lake you can skate across; gusting wind.
  {
    id: 'frost',
    name: 'Frostbite Fjord',
    biome: 'Glacier Coast',
    blurb: 'A dogleg around a frozen lake. Balls and golfers skate on the ice, and the wind gusts.',
    accent: '#7dd3fc',
    par: 4,
    route: [[0, 0], [0, 100], [-50, 180], [-42, 262], [32, 300]],
    green: [34, 298],
    cup: [37, 294],
    greenRadius: 17,
    lake: { c: [8, 205], r: [26, 40], ice: true },
    bunkers: [
      { c: [14, 86], r: 6 },
      { c: [-66, 200], r: 6 },
      { c: [18, 318], r: 5 },
      { c: [50, 286], r: 5 },
    ],
    shortcut: [[0, 100], [34, 298]],
    bounds: { minX: -170, maxX: 150, minZ: -90, maxZ: 400 },
    inside: [-30, 45, 150, 270],
    coast: 50,
    hazard: 'water',
    terrain: 'snow',
    ramps: [{ at: 145, lat: 13, len: 9, h: 2, w: 7 }],
    icePatches: [{ c: [-2, 60], r: 7 }, { c: [-30, 160], r: 6 }, { c: [-30, 268], r: 6 }],
    cases: [[50, 9], [90, -10], [130, 10], [175, -10], [215, 11], [255, -10], [300, 10], [330, -9]],
    caseSpots: [[8, 160], [-6, 250], [20, 304]],
    carts: [[2, 9], [110, 14], [235, -15], [325, 14]],
    cacti: [],
    trees: { count: 110, band: [20, 58], kinds: [['pine', 1]] },
    wind: CONFIG.wind_max,
    env: {
      sky: { turbidity: 1.2, rayleigh: 2.2 },
      fog: ['#e3eef8', 180, 700],
      hemi: ['#eef6ff', '#9fb3c8', 1.25],
      sun: ['#fff6ea', 2.1],
      sunDir: [0.55, 0.38, -0.5],
      exposure: 0.82,
      sea: { color: '#2c5f80', opacity: 0.92 },
      palette: { fairway: '#e3edf5', fairway2: '#d6e3ee', rough: '#f6f9fc', green: '#98d9c4', sand: '#b8b2a8', water: '#7d8c99', rock: '#7d8a99', cliff: '#5f6b7a', ice: '#a8dcf0' },
    },
  },
  // "Magma Isle", par 3 at night: a short island hole around a lava lake, lit by neon and the volcano.
  {
    id: 'magma',
    name: 'Magma Isle',
    biome: 'Volcanic Night',
    blurb: 'A short island hole at night. Lava instead of water, neon instead of daylight.',
    accent: '#f472b6',
    par: 3,
    route: [[0, 0], [0, 70], [40, 130], [95, 150]],
    green: [95, 150],
    cup: [98, 147],
    greenRadius: 15,
    lake: { c: [56, 70], r: [24, 28] },
    bunkers: [
      { c: [-12, 52], r: 5 },
      { c: [80, 166], r: 5 },
      { c: [112, 136], r: 4 },
    ],
    shortcut: [[0, 20], [95, 150]],
    bounds: { minX: -80, maxX: 180, minZ: -70, maxZ: 220 },
    inside: [10, 90, 40, 120],
    coast: 40,
    hazard: 'lava',
    terrain: 'volcano',
    ramps: [{ at: 96, lat: -12, len: 8, h: 1.8, w: 6 }],
    icePatches: [],
    cases: [[30, 8], [55, -9], [85, 9], [115, -9], [150, 9], [180, -8]],
    caseSpots: [[30, 60], [82, 138], [104, 160], [36, 98]],
    carts: [[2, 9], [80, 13], [160, -13]],
    cacti: [],
    trees: { count: 60, band: [16, 40], kinds: [['palm', 0.55], ['crystal', 0.45]] },
    wind: 0,
    env: {
      sky: { top: '#0b0420', bottom: '#5b1a3a' },
      fog: ['#2a0f2a', 120, 520],
      hemi: ['#7c5cff', '#ff5a1f', 0.75],
      sun: ['#9db4ff', 1.1],
      sunDir: [0.3, 0.75, 0.4],
      exposure: 1.15,
      sea: { color: '#ff5a14', emissive: '#ff3d00', opacity: 1 },
      palette: { fairway: '#3c9a52', fairway2: '#348b48', rough: '#3a3336', green: '#59d17a', sand: '#6a625e', water: '#2a1a14', rock: '#4a3a34', cliff: '#3a1f18', ice: '#bfe6f5' },
    },
  },
]

export const HOLE = HOLES[0]

export function holeById(id: string | null | undefined) {
  return HOLES.find((h) => h.id === id) ?? HOLES[0]
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

interface Ramp {
  x: number
  z: number
  fx: number
  fz: number
  len: number
  h: number
  w: number
}

/* ---------- Course ---------- */

export class Course {
  readonly hole: HoleDef
  readonly segs: { ax: number; az: number; bx: number; bz: number; s0: number; len: number }[] = []
  readonly length: number
  readonly cup: THREE.Vector3
  readonly checkpoints: THREE.Vector3[] = []
  readonly briefcases: THREE.Vector3[] = []
  readonly cartSpots: { pos: THREE.Vector3; yaw: number }[] = []
  /** Round obstacles for the ball and players: trees plus props (clubhouse, windmill, benches, rocks). */
  readonly trees: { x: number; z: number; r: number; kind: string; scale: number; yaw: number; h?: number }[] = []
  readonly ramps: Ramp[] = []
  readonly tee: THREE.Vector3
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Live conditions the host changes (synced to clients): wind on the ball in flight, and a gravity multiplier. */
  readonly wind = new THREE.Vector3()
  gravity = 1

  constructor(hole: HoleDef = HOLE) {
    this.hole = hole
    this.bounds = hole.bounds
    let s = 0
    for (let i = 0; i < hole.route.length - 1; i++) {
      const [ax, az] = hole.route[i], [bx, bz] = hole.route[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      this.segs.push({ ax, az, bx, bz, s0: s, len })
      s += len
    }
    this.length = s
    for (const r of hole.ramps) {
      const a = this.routePoint(r.at, r.lat), b = this.routePoint(r.at + 1, r.lat)
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1
      this.ramps.push({ x: a.x, z: a.z, fx: (b.x - a.x) / d, fz: (b.z - a.z) / d, len: r.len, h: r.h, w: r.w })
    }
    this.tee = new THREE.Vector3(0, this.heightAt(0, 0), 0)
    this.cup = new THREE.Vector3(hole.cup[0], this.heightAt(hole.cup[0], hole.cup[1]), hole.cup[1])

    // Checkpoints every ~80 m on the safe route (the shortcut has none).
    for (let d = 80; d < this.length - 40; d += 80) {
      const p = this.routePoint(d)
      this.checkpoints.push(new THREE.Vector3(p.x, this.heightAt(p.x, p.z), p.z))
    }
    // Briefcases: along the route, plus fixed spots (the shortcut, by the green).
    for (const [d, lat] of hole.cases) {
      const p = this.routePoint(d, lat)
      this.briefcases.push(new THREE.Vector3(p.x, this.heightAt(p.x, p.z), p.z))
    }
    for (const [x, z] of hole.caseSpots) this.briefcases.push(new THREE.Vector3(x, this.heightAt(x, z), z))
    // Parked carts, nose along the route.
    for (const [d, lat] of hole.carts) {
      const p = this.routePoint(d, lat), q = this.routePoint(d + 2, lat)
      this.cartSpots.push({ pos: new THREE.Vector3(p.x, this.heightAt(p.x, p.z), p.z), yaw: Math.atan2(q.x - p.x, q.z - p.z) })
    }

    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    // Desert: cactus on the fairway itself.
    for (const [d, lat] of hole.cacti) {
      const p = this.routePoint(d, lat)
      this.trees.push({ x: p.x, z: p.z, r: 0.45, kind: 'cactus', scale: 0.9 + rnd() * 0.3, yaw: rnd() * Math.PI * 2, h: 4 })
    }
    // Trees in the rough, clear of the route, lake, green, pickups and carts.
    const [b0, b1] = hole.trees.band
    const total = hole.trees.kinds.reduce((a, k) => a + k[1], 0)
    for (let k = 0; k < 1200 && this.trees.length < hole.trees.count + hole.cacti.length; k++) {
      const x = this.bounds.minX + rnd() * (this.bounds.maxX - this.bounds.minX)
      const z = this.bounds.minZ + rnd() * (this.bounds.maxZ - this.bounds.minZ)
      const d = this.routeNearest(x, z).dist
      if (d < b0 || d > b1) continue
      if (this.heightAt(x, z) < 1.2 || this.landMask(x, z) < 0.95) continue
      if (Math.hypot(x - hole.green[0], z - hole.green[1]) < hole.greenRadius + 12) continue
      if (this.briefcases.some((b) => Math.hypot(b.x - x, b.z - z) < 8)) continue
      if (this.cartSpots.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 8)) continue
      if (this.ramps.some((r) => Math.hypot(r.x - x, r.z - z) < r.len + 8)) continue
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 7)) continue
      // Palms by the lake, the rest picked by the hole's mix.
      let kind = hole.trees.kinds[0][0]
      let r = rnd() * total
      for (const [kk, w] of hole.trees.kinds) {
        r -= w
        if (r <= 0) {
          kind = kk
          break
        }
      }
      if (hole.terrain === 'meadow' && this.lakeE(x, z) < 1.7) kind = 'palm'
      if (hole.terrain === 'canyon' && this.lakeE(x, z) < 1.9) kind = 'palm'
      const scale = 0.8 + rnd() * 0.6
      this.trees.push({ x, z, r: kind === 'cactus' ? 0.45 : kind === 'crystal' ? 1.1 : 0.7, kind, scale, yaw: rnd() * Math.PI * 2, h: kind === 'cactus' ? 4 : undefined })
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
  landMask(x: number, z: number, d = this.routeNearest(x, z).dist) {
    const h = this.hole
    if (h.coast >= 1000) return 1
    const i = h.inside
    const inside = i && x > i[0] && x < i[1] && z > i[2] && z < i[3] ? 1 : 0
    const n = (fbm(x / 30, z / 30) - 0.5) * 16
    return Math.max(1 - smooth(h.coast + n, h.coast + 10 + n, d), inside)
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
    const e = this.lakeE(x, z)
    // Desert: red-rock canyon walls either side (opening onto the oasis).
    if (h.terrain === 'canyon') {
      const open = smooth(1.4, 2.4, e)
      y += smooth(24, 40, dist) * (11 + fbm(x / 25, z / 25) * 14) * open
    }
    // Snow: rolling drifts beyond the fairway.
    if (h.terrain === 'snow') y += smooth(16, 40, dist) * fbm(x / 18, z / 18) * 5
    // Green: a shallow bowl so balls gather near the cup, with a raised lip.
    const g = Math.hypot(x - h.green[0], z - h.green[1])
    const gy = 3.3
    if (g < h.greenRadius + 8) {
      const bowl = gy - 0.9 * (1 - (Math.min(g, h.greenRadius) / h.greenRadius) ** 2) + smooth(h.greenRadius - 2, h.greenRadius + 3, g) * 0.6
      y = THREE.MathUtils.lerp(bowl, y, smooth(h.greenRadius + 2, h.greenRadius + 8, g))
    }
    // Lake with sloping banks below the water line (a flat sheet of ice when frozen).
    if (e < 1.35) y = THREE.MathUtils.lerp(h.lake.ice ? 2.1 : -2.6, y, smooth(h.lake.ice ? 0.92 : 0.86, 1.35, e))
    // Bunkers dip slightly.
    for (const b of h.bunkers) {
      const d = Math.hypot(x - b.c[0], z - b.c[1])
      if (d < b.r + 1.5) y -= 0.55 * (1 - smooth(b.r - 1.5, b.r + 1.5, d))
    }
    // Ramps: a slope up along the route that ends in a sharp drop (carts and fast balls take off).
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z
      const u = dx * r.fx + dz * r.fz
      if (u < -1 || u > r.len + 1.4) continue
      const v = Math.abs(-dx * r.fz + dz * r.fx)
      if (v > r.w / 2 + 1.2) continue
      const side = 1 - smooth(r.w / 2 - 0.4, r.w / 2 + 1.2, v)
      const up = u <= r.len ? Math.max(0, u / r.len) ** 1.2 : 1 - smooth(r.len, r.len + 1.4, u)
      y += r.h * up * side
    }
    // Coastline cliffs into the sea.
    const m = this.landMask(x, z, dist)
    return THREE.MathUtils.lerp(-14, y, m)
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.4
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return out.set(-hx, 2 * e, -hz).normalize()
  }

  surfaceAt(x: number, z: number, y = this.heightAt(x, z)): Surface {
    const h = this.hole
    if (y < 0.05) return 'water'
    if (Math.hypot(x - h.green[0], z - h.green[1]) < h.greenRadius) return 'green'
    if (h.lake.ice && this.lakeE(x, z) < 1) return 'ice'
    for (const p of h.icePatches) if (Math.hypot(x - p.c[0], z - p.c[1]) < p.r) return 'ice'
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
    const palette = this.hole.env.palette
    const snow = this.hole.terrain === 'snow'
    for (let t = 0; t < p.count; t += 3) {
      const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3
      const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3
      const cy = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3
      const slope = 1 - n.getY(t)
      const s = this.surfaceAt(cx, cz, cy)
      let key: string = s
      if (s === 'fairway') key = Math.floor(this.routeNearest(cx, cz).s / 9) % 2 ? 'fairway' : 'fairway2' // mowing stripes
      if (cy < 0.05) key = 'water'
      if (slope > 0.45 && !(snow && slope < 0.6 && cy > 1)) key = cy < 1 ? 'cliff' : 'rock'
      c.set(palette[key] ?? palette.rough)
      // Desert walls: horizontal strata.
      if ((key === 'rock' || key === 'cliff') && this.hole.terrain === 'canyon') c.multiplyScalar(0.86 + (Math.floor(cy / 2.2) % 3) * 0.08)
      // A touch of noise keeps the flat shading lively.
      const k = 0.93 + hash(Math.floor(cx), Math.floor(cz)) * 0.1
      for (let v = 0; v < 3; v++) {
        colors[(t + v) * 3] = c.r * k
        colors[(t + v) * 3 + 1] = c.g * k
        colors[(t + v) * 3 + 2] = c.b * k
      }
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: snow ? 0.75 : 0.92 }))
    mesh.receiveShadow = true
    return mesh
  }
}
