// The location circuits: Concrete River (a storm-drain river channel and downtown streets), Gothic Quarter (an
// old town on a hill above a seafront boulevard) and Pier & Promenade (a seaside promenade, a funfair pier and white
// terraces). Layouts, sky and light, and a shared kit (terrain, road, barriers, instancing helpers) that each
// location's scenery builds on. All of it is generated from fixed numbers, so the host and every client match.
import * as THREE from 'three'
import { HARBOR_CIRCUIT, mulberry32, type CircuitDef, type CircuitId, type Track } from './track'
import { radialTexture } from './cars'
import { normalizeModel, type PropName, type RacerAssets } from './assets'
import type { MapId } from './net'
export { MAP_INFO } from './net'
import type { Mode } from './game'
import { buildRiver } from './river'
import { buildGothic } from './gothic'
import { buildPier } from './pier'

/* ---------- Layouts ---------- */

// [x, z, height, width]. +x east, +z south (the sea, where there is one, lies to the south).
const RIVER: CircuitDef = {
  id: 'river',
  name: 'Concrete River',
  width: 18,
  points: [
    [0, 0, 0, 18], [140, 0, 0, 18], [250, 8, 0, 18], [318, 48, -0.6, 20], [352, 125, -4.5, 24], [372, 220, -7.5, 28],
    [368, 360, -7.5, 28], [398, 500, -7.5, 28], [428, 640, -7.5, 28], [402, 762, -7.5, 28], [300, 842, -7.5, 28],
    [160, 862, -7.5, 28], [40, 852, -6.5, 24], [-60, 818, -2, 20], [-122, 792, 1.9, 18], [-146, 782, 0.2, 18],
    [-232, 750, 0, 16], [-290, 700, 0, 16], [-308, 600, 1, 16], [-296, 500, 4, 16], [-252, 420, 4.5, 16],
    [-268, 330, 2.5, 16], [-238, 240, 0.5, 16], [-190, 140, 0, 16], [-150, 50, 0, 17], [-80, 2, 0, 18],
  ],
  // The spillway: a narrow side channel cutting the inside of the big bend.
  shortcuts: [{ from: 8, to: 11, via: [[358, 702], [262, 792]], width: 12, ai: 0.5 }],
}

const GOTHIC: CircuitDef = {
  id: 'gothic',
  name: 'Gothic Quarter',
  width: 14,
  points: [
    [0, 600, 1, 22], [180, 600, 1, 22], [350, 596, 1, 22], [470, 572, 1.5, 20], [522, 502, 3.5, 16], [512, 404, 7, 14],
    [452, 342, 10, 13], [360, 330, 12, 13], [302, 272, 14, 13], [300, 186, 16, 13], [236, 132, 17, 16], [130, 128, 17, 16],
    [60, 168, 16, 13], [2, 236, 14, 13], [-78, 258, 13, 13], [-140, 318, 11, 13], [-152, 410, 8, 14], [-122, 482, 5, 16],
    [-140, 548, 2.5, 18], [-90, 596, 1, 22],
  ],
  // An arched alley through the block between two hairpins.
  shortcuts: [{ from: 6, to: 9, via: [[402, 268], [342, 216]], width: 11, ai: 0.45 }],
}

const PIER: CircuitDef = {
  id: 'pier',
  name: 'Pier & Promenade',
  width: 16,
  points: [
    [0, 500, 1, 20], [-200, 500, 1, 20], [-380, 505, 1, 20], [-500, 480, 1.5, 18], [-562, 400, 4, 16], [-542, 300, 8, 16],
    [-472, 232, 10, 15], [-362, 212, 11, 15], [-250, 230, 11, 14], [-120, 230, 11, 14], [-30, 200, 12, 15], [60, 150, 13, 15],
    [170, 160, 12, 15], [262, 222, 9, 16], [302, 322, 5, 16], [292, 422, 2, 17], [222, 492, 1, 19], [110, 500, 1, 20],
  ],
  // The lanes: a narrow twisting short cut across the top of the town.
  shortcuts: [{ from: 10, to: 13, via: [[40, 238], [120, 254], [200, 246]], width: 11, ai: 0.5 }],
}

export const CIRCUITS: Record<CircuitId, CircuitDef> = { harbor: HARBOR_CIRCUIT, river: RIVER, gothic: GOTHIC, pier: PIER }
export const CIRCUIT_ORDER: CircuitId[] = ['harbor', 'river', 'gothic', 'pier']

/** The circuit for a race: the chosen one, or (Combat Points) the next in the rotation for this round. */
export function circuitFor(mode: Mode, map: MapId | undefined, round: number): CircuitDef {
  const chosen: CircuitId = map && map !== 'bowl' ? map : 'harbor'
  if (mode !== 'combat') return CIRCUITS[chosen]
  const start = CIRCUIT_ORDER.indexOf(chosen)
  return CIRCUITS[CIRCUIT_ORDER[(start + round) % CIRCUIT_ORDER.length]]
}

/* ---------- Sky and light ---------- */

interface Sky {
  bg: string
  fog: [string, number, number]
  horizon: [number, number, number]
  mid: [number, number, number]
  top: [number, number, number]
  sun: [number, number, number] // direction
  sunGlow: [number, number, number]
  hemi: [string, string, number]
  light: [string, number]
  env: number
  disc: number // sun disc size (0: hidden behind cloud)
  clouds: number // 0..1 overcast streaks
}

const SKIES: Record<Exclude<CircuitId, 'harbor'>, Sky> = {
  // Low orange sun over the west end of the channel, smog on the horizon.
  river: {
    bg: '#e79a6c', fog: ['#e3946a', 260, 1500], horizon: [1.0, 0.58, 0.3], mid: [0.9, 0.46, 0.38], top: [0.28, 0.26, 0.5],
    sun: [-0.88, 0.1, 0.46], sunGlow: [1.0, 0.62, 0.3], hemi: ['#ffc8a0', '#5a3c3a', 1.0], light: ['#ffb27a', 1.7], env: 0.55, disc: 220, clouds: 0.25,
  },
  // Mediterranean evening: peach horizon over the sea, lavender sky, deep blue overhead.
  gothic: {
    bg: '#c7a0a0', fog: ['#c79a92', 220, 1300], horizon: [1.0, 0.7, 0.48], mid: [0.66, 0.54, 0.7], top: [0.12, 0.17, 0.42],
    sun: [-0.42, 0.08, 0.9], sunGlow: [1.0, 0.66, 0.42], hemi: ['#ffd9c0', '#4a3a40', 0.95], light: ['#ffc48c', 1.35], env: 0.5, disc: 170, clouds: 0.15,
  },
  // English seaside: grey-blue overcast, soft light, a pale sun through the cloud.
  pier: {
    bg: '#aebccb', fog: ['#a9b6c4', 180, 1200], horizon: [0.78, 0.82, 0.86], mid: [0.62, 0.69, 0.78], top: [0.4, 0.5, 0.64],
    sun: [0.3, 0.45, 0.84], sunGlow: [0.95, 0.93, 0.85], hemi: ['#e6edf5', '#6e716b', 1.3], light: ['#fff2dc', 1.0], env: 0.6, disc: 0, clouds: 0.9,
  },
}

export function circuitEnvironment(scene: THREE.Scene, id: CircuitId) {
  if (id === 'harbor') return
  const k = SKIES[id]
  scene.background = new THREE.Color(k.bg)
  scene.fog = new THREE.Fog(k.fog[0], k.fog[1], k.fog[2])
  scene.environmentIntensity = k.env
  scene.add(new THREE.HemisphereLight(k.hemi[0], k.hemi[1], k.hemi[2]))
  const sunDir = new THREE.Vector3(...k.sun).normalize()
  const sun = new THREE.DirectionalLight(k.light[0], k.light[1])
  sun.position.copy(sunDir).multiplyScalar(600)
  scene.add(sun)
  const v3 = (a: number[]) => `vec3(${a.map((x) => x.toFixed(3)).join(',')})`
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 c = mix(${v3(k.horizon)}, ${v3(k.mid)}, smoothstep(0.0, 0.16, h));
          c = mix(c, ${v3(k.top)}, smoothstep(0.16, 0.75, h));
          vec3 sd = normalize(${v3(k.sun)});
          float s = max(0.0, dot(d, sd));
          c += ${v3(k.sunGlow)} * (pow(s, 8.0) * 0.35 + pow(s, 64.0) * 0.5);
          // Cloud streaks, stretched along the horizon.
          vec2 q = d.xz / max(0.08, d.y + 0.12);
          float cl = noise(q * vec2(0.9, 2.6)) * 0.6 + noise(q * vec2(2.1, 5.3)) * 0.4;
          float amt = smoothstep(0.45, 0.85, cl) * ${k.clouds.toFixed(2)} * smoothstep(0.0, 0.08, h);
          c = mix(c, mix(${v3(k.mid)} * 1.12, ${v3(k.sunGlow)}, 0.25 + pow(s, 3.0) * 0.6), amt);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  )
  sky.renderOrder = -1
  scene.add(sky)
  if (k.disc > 0) {
    const disc = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(...k.sunGlow).multiplyScalar(2.6), fog: false, depthWrite: false, toneMapped: false }),
    )
    disc.position.copy(sunDir).multiplyScalar(1800)
    disc.scale.setScalar(k.disc)
    scene.add(disc)
  }
}

/* ---------- Scene ---------- */

/** Per-frame scenery animation (the ferris wheel, flags, water). */
export interface Scenery {
  update(time: number, dt: number): void
}

export function buildCircuitScene(track: Track, scene: THREE.Scene, assets?: RacerAssets): Scenery {
  const group = new THREE.Group()
  const kit = new Kit(track, group, assets)
  const update = track.id === 'river' ? buildRiver(kit) : track.id === 'gothic' ? buildGothic(kit) : buildPier(kit)
  scene.add(group)
  return { update: update ?? (() => {}) }
}

/* ---------- Kit ---------- */

export interface GroundSpec {
  /** Natural ground height away from the roads. */
  base(x: number, z: number): number
  /** Height near a road: `d` metres from its edge, `h` the road's height, `b` the natural ground there. */
  bank?(d: number, h: number, b: number): number
  /** Vertex colour. */
  color(x: number, z: number, y: number, d: number, h: number, out: THREE.Color): void
  detail: THREE.Texture
  detailScale: number // metres per repeat
  /** Scenery-only channels and verges the ground is carved around (x, z, height), with their half-width. */
  extras?: { pts: [number, number, number][]; half: number }[]
  margin?: number
}

export interface RoadStyle {
  map: THREE.Texture
  scale: number // metres per texture repeat
  color: string
  roughness: number
  edgeLine: [number, number, number] | null // painted line inside each edge
  doubleEdge?: boolean // two lines (no waiting, UK style)
  centre: 'dash' | 'wide-dash' | 'none' // 'wide-dash': only where the road is wider than 17 m
  centreColor: [number, number, number]
  kerb: [number, number, number] | null // rumble strips on the edges of bends
  glow: [number, number, number] // faint emissive edge line (readability at speed)
  channel?: boolean // a wet low-flow channel down the middle (the river bed)
  /** A second surface where the road runs below `below` metres (the river bed, the seafront boulevard). */
  alt?: { map: THREE.Texture; scale: number; color: string; below: number; linesOnly?: boolean }
}

export type BarrierKind = 'none' | 'concrete' | 'stone' | 'railing' | 'armco' | 'kerb'

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpV = new THREE.Vector3()
const tmpS = new THREE.Vector3()
const tmpE = new THREE.Euler()

/** Shared building blocks for the location scenery. */
export class Kit {
  readonly track: Track
  readonly group: THREE.Group
  readonly assets?: RacerAssets
  readonly rnd: () => number
  /** Ground field: edge distance to the nearest road (or scenery corridor) and that road's height. */
  private gx0 = 0
  private gz0 = 0
  private gres = 5
  private gnx = 0
  private gnz = 0
  private gd = new Float32Array(0)
  private gh = new Float32Array(0)
  private groundSpec: GroundSpec | null = null

  constructor(track: Track, group: THREE.Group, assets?: RacerAssets) {
    this.track = track
    this.group = group
    this.assets = assets
    this.rnd = mulberry32(track.id.length * 977 + 13)
  }

  prop(name: PropName) {
    return this.assets?.props.get(name) ?? null
  }

  /* ----- Ground ----- */

  /** Build the distance field and the terrain mesh around the circuit. */
  ground(spec: GroundSpec) {
    this.groundSpec = spec
    const t = this.track
    const margin = spec.margin ?? 420
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < t.n; i++) {
      x0 = Math.min(x0, t.px[i])
      x1 = Math.max(x1, t.px[i])
      z0 = Math.min(z0, t.pz[i])
      z1 = Math.max(z1, t.pz[i])
    }
    const res = this.gres
    x0 -= margin
    z0 -= margin
    const nx = Math.ceil((x1 + margin - x0) / res) + 1, nz = Math.ceil((z1 + margin - z0) / res) + 1
    const d = new Float32Array(nx * nz).fill(1e6)
    const h = new Float32Array(nx * nz)
    const R = 130
    const splat = (x: number, z: number, y: number, half: number) => {
      const ci = Math.round((x - x0) / res), cj = Math.round((z - z0) / res), cr = Math.ceil((half + R) / res)
      for (let j = Math.max(0, cj - cr); j <= Math.min(nz - 1, cj + cr); j++) {
        const dz = z0 + j * res - z
        for (let i = Math.max(0, ci - cr); i <= Math.min(nx - 1, ci + cr); i++) {
          const dx = x0 + i * res - x
          const e = Math.sqrt(dx * dx + dz * dz) - half
          const k = j * nx + i
          if (e < d[k]) {
            d[k] = e
            h[k] = y
          }
        }
      }
    }
    for (let i = 0; i < t.n; i += 1) splat(t.px[i], t.pz[i], t.py[i], t.hw[i])
    for (const b of t.branches) for (let k = 0; k < b.n; k++) splat(b.px[k], b.pz[k], b.h[k], b.half)
    for (const ex of spec.extras ?? []) {
      // Densify each scenery corridor to ~3 m steps.
      for (let k = 0; k < ex.pts.length - 1; k++) {
        const [ax, az, ay] = ex.pts[k], [bx, bz, by] = ex.pts[k + 1]
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 3)
        for (let s = 0; s <= steps; s++) splat(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps, ay + ((by - ay) * s) / steps, ex.half)
      }
    }
    Object.assign(this, { gx0: x0, gz0: z0, gnx: nx, gnz: nz, gd: d, gh: h })

    // Terrain mesh: one vertex per field cell.
    const pos = new Float32Array(nx * nz * 3)
    const col = new Float32Array(nx * nz * 3)
    const uv = new Float32Array(nx * nz * 2)
    const c = new THREE.Color()
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        const x = x0 + i * res, z = z0 + j * res
        const y = this.groundY(x, z, d[k], h[k])
        pos.set([x, y, z], k * 3)
        spec.color(x, z, y, d[k], h[k], c)
        c.toArray(col, k * 3)
        uv.set([x / spec.detailScale, z / spec.detailScale], k * 2)
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6)
    let p = 0
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, cc = a + nx, dd = cc + 1
        idx.set([a, cc, b, b, cc, dd], p)
        p += 6
      }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: spec.detail, roughness: 0.95, metalness: 0 }))
    this.group.add(mesh)
    // Beyond the field: a flat skirt (four strips round it, so it never covers a low road) at the far edge's level.
    const X1 = x0 + (nx - 1) * res, Z1 = z0 + (nz - 1) * res, F = 3000
    const y = Math.min(spec.base(x0, z0), spec.base(X1, Z1), spec.base(x0, Z1), spec.base(X1, z0)) - 0.3
    const skirtMat = new THREE.MeshStandardMaterial({ color: this.farColor(), roughness: 1 })
    for (const [ax, az, bx, bz] of [[x0 - F, z0 - F, X1 + F, z0], [x0 - F, Z1, X1 + F, Z1 + F], [x0 - F, z0, x0, Z1], [X1, z0, X1 + F, Z1]]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(bx - ax, bz - az).rotateX(-Math.PI / 2), skirtMat)
      strip.position.set((ax + bx) / 2, y, (az + bz) / 2)
      this.group.add(strip)
    }
  }

  private farColor() {
    const c = new THREE.Color()
    this.groundSpec!.color(this.gx0, this.gz0, 0, 1e6, 0, c)
    return c
  }

  private groundY(x: number, z: number, d: number, h: number) {
    const s = this.groundSpec!
    const b = s.base(x, z)
    if (d >= 1e5) return b
    if (s.bank) return s.bank(d, h, b)
    if (d < 2.5) return h - 0.15
    const k = THREE.MathUtils.smoothstep(d, 2.5, 30)
    return THREE.MathUtils.lerp(h - 0.15, b, k)
  }

  /** Edge distance to the nearest road (or scenery corridor) at (x, z). */
  clearance(x: number, z: number) {
    const gx = (x - this.gx0) / this.gres, gz = (z - this.gz0) / this.gres
    if (gx < 0 || gz < 0 || gx >= this.gnx - 1 || gz >= this.gnz - 1) return 1e6
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const k = j * this.gnx + i, d = this.gd
    const a = d[k] + (d[k + 1] - d[k]) * fx
    const b = d[k + this.gnx] + (d[k + this.gnx + 1] - d[k + this.gnx]) * fx
    return a + (b - a) * fz
  }

  /** Does a w × d footprint at (x, z), turned by yaw (local x along w), stay `margin` metres clear of every road? */
  fits(x: number, z: number, yaw: number, w: number, d: number, margin: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const lx = (a * w) / 2, lz = (b * d) / 2
        if (this.clearance(x + lx * c + lz * s, z - lx * s + lz * c) < margin) return false
      }
    return true
  }

  /** Ground height at (x, z) (bilinear over the terrain). */
  heightAt(x: number, z: number) {
    if (!this.groundSpec) return 0
    const gx = THREE.MathUtils.clamp((x - this.gx0) / this.gres, 0, this.gnx - 1.001), gz = THREE.MathUtils.clamp((z - this.gz0) / this.gres, 0, this.gnz - 1.001)
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const y = (ii: number, jj: number) => {
      const k = jj * this.gnx + ii
      return this.groundY(this.gx0 + ii * this.gres, this.gz0 + jj * this.gres, this.gd[k], this.gh[k])
    }
    const a = y(i, j) + (y(i + 1, j) - y(i, j)) * fx
    const b = y(i, j + 1) + (y(i + 1, j + 1) - y(i, j + 1)) * fx
    return a + (b - a) * fz
  }

  /* ----- Road ----- */

  roadMaterial(style: RoadStyle, under = false) {
    const map = style.map
    const mat = new THREE.MeshStandardMaterial({ color: style.color, map, roughness: style.roughness, metalness: 0.05, envMapIntensity: 0.5 })
    if (under) {
      mat.polygonOffset = true
      mat.polygonOffsetFactor = 2
      mat.polygonOffsetUnits = 2
    }
    const v = (a: [number, number, number] | null) => new THREE.Vector3(...(a ?? [0, 0, 0]))
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uEdge = { value: v(style.edgeLine) }
      sh.uniforms.uCentre = { value: v(style.centreColor) }
      sh.uniforms.uKerb = { value: v(style.kerb) }
      sh.uniforms.uGlow = { value: v(style.glow) }
      sh.uniforms.uAltMap = { value: style.alt?.map ?? null }
      sh.uniforms.uAltColor = { value: new THREE.Color(style.alt?.color ?? '#ffffff') }
      sh.uniforms.uAltBelow = { value: style.alt?.below ?? -1e4 }
      sh.uniforms.uAltScale = { value: style.alt ? style.scale / style.alt.scale : 1 }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;\nvarying float vRoadY;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;\nvRoadY = position.y;')
      const defs = [
        style.alt ? '#define ALT' : '', style.alt?.linesOnly ? '#define LINES_ALT' : '',
        style.edgeLine ? '#define EDGE' : '', style.doubleEdge ? '#define DOUBLE_EDGE' : '', style.centre !== 'none' ? '#define CENTRE' : '',
        style.centre === 'wide-dash' ? '#define WIDE_ONLY' : '', style.kerb ? '#define KERB' : '', style.channel ? '#define CHANNEL' : '',
      ].join('\n')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${defs}\nuniform vec3 uEdge; uniform vec3 uCentre; uniform vec3 uKerb; uniform vec3 uGlow; varying vec4 vRoad; varying float vRoadY;
          uniform sampler2D uAltMap; uniform vec3 uAltColor; uniform float uAltBelow; uniform float uAltScale;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float altK = 0.0;
          #ifdef ALT
            altK = 1.0 - smoothstep(uAltBelow - 0.6, uAltBelow + 0.6, vRoadY);
            vec4 altTex = texture2D(uAltMap, vMapUv * uAltScale);
            diffuseColor.rgb = mix(diffuseColor.rgb, uAltColor * altTex.rgb, altK);
          #endif
          float lineK = 1.0;
          #ifdef LINES_ALT
            lineK = altK;
          #endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          #ifdef CHANNEL
            roughnessFactor = mix(roughnessFactor, 0.12, (1.0 - smoothstep(1.2, 1.9, abs(vRoad.x))) * altK);
          #endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float across = vRoad.x; float along = vRoad.y; float rhw = vRoad.z; float bend = vRoad.w;
          float edgeD = rhw - abs(across);
          float aa = fwidth(across) * 1.2 + 0.01;
          #ifdef CHANNEL
            float wet = (1.0 - smoothstep(1.2, 1.9, abs(across))) * altK;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.2), wet * 0.85);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.48, 0.44), (1.0 - smoothstep(0.0, 0.25, abs(abs(across) - 2.0))) * 0.6 * altK);
          #endif
          #ifdef EDGE
            float e1 = 1.0 - smoothstep(0.0, aa, abs(edgeD - 0.55) - 0.09);
            #ifdef DOUBLE_EDGE
              e1 = max(e1, 1.0 - smoothstep(0.0, aa, abs(edgeD - 0.85) - 0.09));
            #endif
            diffuseColor.rgb = mix(diffuseColor.rgb, uEdge, e1 * 0.9 * lineK);
          #endif
          #ifdef CENTRE
            float dash = step(0.45, fract(along / 9.0)) * (1.0 - smoothstep(0.0, aa, abs(across) - 0.11));
            #ifdef WIDE_ONLY
              dash *= step(8.6, rhw);
            #endif
            diffuseColor.rgb = mix(diffuseColor.rgb, uCentre, dash * 0.85 * lineK);
          #endif
          #ifdef KERB
            float kerb = (1.0 - step(0.95, edgeD)) * smoothstep(0.35, 0.6, bend) * lineK;
            float stripe = step(0.5, fract(along / 2.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(uKerb, vec3(0.92), stripe), kerb);
          #endif
          totalEmissiveRadiance += uGlow * (1.0 - smoothstep(0.0, 0.18, edgeD));
          if (along < 6.0 && along >= 0.0) {
            float chk = mod(floor((across + rhw) / 1.5) + floor(along / 1.5), 2.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(chk * 0.95 + 0.03), 0.9);
          }`,
        )
    }
    return mat
  }

  /** The road ribbon: the main road, then each shortcut drawn just under it where they overlap. */
  road(style: RoadStyle) {
    const t = this.track
    const ribbon = (n: number, closed: boolean, px: ArrayLike<number>, pz: ArrayLike<number>, tx: ArrayLike<number>, tz: ArrayLike<number>, py: ArrayLike<number>, half: (i: number) => number, along: (i: number) => number, curv: ArrayLike<number>) => {
      const m = closed ? n + 1 : n
      const pos = new Float32Array(m * 2 * 3), uv = new Float32Array(m * 2 * 2), road = new Float32Array(m * 2 * 4)
      const idx: number[] = []
      for (let k = 0; k < m; k++) {
        const i = k % n
        const nx = -tz[i], nz = tx[i]
        const hw = half(i)
        const a = closed && k === n ? t.length : along(i)
        // Bends get kerbs: smoothed curvature around this sample.
        let bend = 0
        for (let q = -6; q <= 6; q += 2) bend = Math.max(bend, curv[closed ? (i + q + n) % n : THREE.MathUtils.clamp(i + q, 0, n - 1)])
        bend = THREE.MathUtils.clamp((bend - 0.006) / 0.012, 0, 1)
        for (let side = 0; side < 2; side++) {
          const o = side === 0 ? -hw : hw
          const v = k * 2 + side
          pos.set([px[i] + nx * o, py[i] + 0.03, pz[i] + nz * o], v * 3)
          uv.set([(o + hw) / style.scale, a / style.scale], v * 2)
          road.set([o, a, hw, bend], v * 4)
        }
        if (k < m - 1) {
          const A = k * 2
          idx.push(A, A + 1, A + 2, A + 1, A + 3, A + 2)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 4))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      return geo
    }
    this.group.add(new THREE.Mesh(ribbon(t.n, true, t.px, t.pz, t.tx, t.tz, t.py, (i) => t.hw[i], (i) => t.s[i], t.curv), this.roadMaterial(style)))
    const under = this.roadMaterial(style, true)
    for (const b of t.branches)
      this.group.add(new THREE.Mesh(ribbon(b.n, false, b.px, b.pz, b.tx, b.tz, b.h, () => b.half, (k) => 1000 + b.s[k], b.curv), under))
  }

  /** Is (x, z) inside a road other than `self` (-1 main, k shortcut)? Used to open barriers at the junctions. */
  private insideOther(x: number, z: number, self: number) {
    const t = this.track
    if (self !== -1) {
      const n = t.nearest(x, z)
      if (Math.abs(n.lateral) < t.hw[n.i] + 0.8) return true
    }
    for (let k = 0; k < t.branches.length; k++) {
      if (k === self) continue
      const b = t.branches[k]
      let best = 0, bd = Infinity
      for (let j = 0; j < b.n; j++) {
        const dd = (x - b.px[j]) ** 2 + (z - b.pz[j]) ** 2
        if (dd < bd) {
          bd = dd
          best = j
        }
      }
      if (best === 0 || best === b.n - 1) continue
      const lat = (x - b.px[best]) * -b.tz[best] + (z - b.pz[best]) * b.tx[best]
      if (Math.abs(lat) < b.half + 0.8) return true
    }
    return false
  }

  /**
   * Walk both edges of every road. `fn` gets each 2 m edge segment (start, end, heights, outward normal, which road,
   * side and distance along) unless it falls inside another road (the mouth of a shortcut).
   */
  edges(fn: (e: Edge) => void, offset = 0.5) {
    const t = this.track
    const e: Edge = { ax: 0, az: 0, ay: 0, bx: 0, bz: 0, by: 0, nx: 0, nz: 0, road: -1, side: 1, s: 0, i: 0 }
    const walk = (road: number, n: number, closed: boolean, px: ArrayLike<number>, pz: ArrayLike<number>, tx: ArrayLike<number>, tz: ArrayLike<number>, py: ArrayLike<number>, half: (i: number) => number, sAt: (i: number) => number) => {
      const last = closed ? n : n - 1
      for (const side of [-1, 1]) {
        for (let i = 0; i < last; i++) {
          const j = (i + 1) % n
          const oa = side * (half(i) + offset), ob = side * (half(j) + offset)
          e.ax = px[i] - tz[i] * oa
          e.az = pz[i] + tx[i] * oa
          e.bx = px[j] - tz[j] * ob
          e.bz = pz[j] + tx[j] * ob
          e.ay = py[i]
          e.by = py[j]
          e.nx = -tz[i] * side
          e.nz = tx[i] * side
          e.road = road
          e.side = side
          e.s = sAt(i)
          e.i = i
          if (this.insideOther((e.ax + e.bx) / 2, (e.az + e.bz) / 2, road)) continue
          fn(e)
        }
      }
    }
    walk(-1, t.n, true, t.px, t.pz, t.tx, t.tz, t.py, (i) => t.hw[i], (i) => t.s[i])
    t.branches.forEach((b, k) => walk(k, b.n, false, b.px, b.pz, b.tx, b.tz, b.h, () => b.half, (j) => b.ms[j]))
  }

  /**
   * Barriers along every edge. `kind` picks the style per segment ('none' leaves a gap). Concrete and stone are
   * solid walls; railings are posts and rails; armco a steel beam on posts; kerbs a low stone edge.
   */
  barriers(kind: (e: Edge) => BarrierKind, mats: Partial<Record<BarrierKind, THREE.Material>>) {
    const walls: Record<string, number[]> = {}
    const posts: THREE.Matrix4[] = []
    const rails: number[] = []
    const add = (k: string, ...v: number[]) => (walls[k] ??= []).push(...v)
    const quad = (k: string, e: Edge, y0: number, y1: number, inset: number, uvLen: number) => {
      const ax = e.ax - e.nx * inset, az = e.az - e.nz * inset, bx = e.bx - e.nx * inset, bz = e.bz - e.nz * inset
      const u0 = e.s / uvLen, u1 = u0 + 2 / uvLen
      add(k, ax, e.ay + y0, az, bx, e.by + y0, bz, ax, e.ay + y1, az, u0, y0 / uvLen, u1, y0 / uvLen, u0, y1 / uvLen)
      add(k, bx, e.by + y0, bz, bx, e.by + y1, bz, ax, e.ay + y1, az, u1, y0 / uvLen, u1, y1 / uvLen, u0, y1 / uvLen)
    }
    const top = (k: string, e: Edge, y: number, i0: number, i1: number) => {
      const ax0 = e.ax - e.nx * i0, az0 = e.az - e.nz * i0, bx0 = e.bx - e.nx * i0, bz0 = e.bz - e.nz * i0
      const ax1 = e.ax - e.nx * i1, az1 = e.az - e.nz * i1, bx1 = e.bx - e.nx * i1, bz1 = e.bz - e.nz * i1
      add(k, ax0, e.ay + y, az0, bx0, e.by + y, bz0, ax1, e.ay + y, az1, 0, 0, 1, 0, 0, 1)
      add(k, bx0, e.by + y, bz0, bx1, e.by + y, bz1, ax1, e.ay + y, az1, 1, 0, 1, 1, 0, 1)
    }
    this.edges((e) => {
      const k = kind(e)
      if (k === 'none') return
      if (k === 'concrete') {
        quad('concrete', e, 0, 1.1, 0, 3)
        quad('concrete', e, 0, 1.1, -0.5, 3)
        top('concrete', e, 1.1, 0, -0.5)
      } else if (k === 'stone') {
        quad('stone', e, -0.4, 1.0, 0, 3)
        quad('stone', e, -0.4, 1.0, -0.7, 3)
        top('stoneTop', e, 1.0, 0.05, -0.75)
      } else if (k === 'kerb') {
        quad('stone', e, -0.2, 0.35, 0.1, 3)
        top('stoneTop', e, 0.35, 0.1, -0.5)
      } else if (k === 'railing' || k === 'armco') {
        if (Math.round(e.s / 2) % (k === 'railing' ? 1 : 2) === 0) {
          tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(e.nx, e.nz))
          posts.push(new THREE.Matrix4().compose(tmpV.set(e.ax, e.ay, e.az), tmpQ, tmpS.set(1, k === 'railing' ? 1 : 0.8, 1)))
        }
        const ys = k === 'railing' ? [1.02, 0.55, 0.12] : [0.62]
        for (const y of ys) rails.push(e.ax, e.ay + y, e.az, e.bx, e.by + y, e.bz, k === 'railing' ? 0.06 : 0.32)
      }
    })
    for (const [k, v] of Object.entries(walls)) {
      const geo = new THREE.BufferGeometry()
      const n = v.length / 15
      const pos = new Float32Array(n * 9), uv = new Float32Array(n * 6)
      for (let q = 0; q < n; q++) {
        pos.set(v.slice(q * 15, q * 15 + 9), q * 9)
        uv.set(v.slice(q * 15 + 9, q * 15 + 15), q * 6)
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      geo.computeVertexNormals()
      const mat = (k === 'stoneTop' ? mats.kerb ?? mats.stone : mats[k as BarrierKind]) ?? new THREE.MeshStandardMaterial({ color: '#9a9a9a' })
      ;(mat as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      this.group.add(new THREE.Mesh(geo, mat))
    }
    if (posts.length) {
      const railMat = mats.railing ?? mats.armco ?? new THREE.MeshStandardMaterial({ color: '#888' })
      const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0), railMat, posts.length)
      posts.forEach((m, i) => post.setMatrixAt(i, m))
      this.group.add(post)
      // Rails: thin flat strips, two triangles per segment and a top face.
      const n = rails.length / 7
      const pos = new Float32Array(n * 18)
      for (let q = 0; q < n; q++) {
        const [ax, ay, az, bx, by, bz, h] = rails.slice(q * 7, q * 7 + 7)
        pos.set([ax, ay - h / 2, az, bx, by - h / 2, bz, ax, ay + h / 2, az, bx, by - h / 2, bz, bx, by + h / 2, bz, ax, ay + h / 2, az], q * 18)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.computeVertexNormals()
      const rm = (railMat as THREE.MeshStandardMaterial).clone()
      rm.side = THREE.DoubleSide
      this.group.add(new THREE.Mesh(geo, rm))
    }
  }

  /**
   * Things to whip past: delineator posts (or bollards) every few metres along both edges, and red-and-white chevron
   * boards round the outside of tight bends. `where` can leave a stretch out.
   */
  roadside(o: { post: string; reflector: string; step?: number; bollard?: boolean; chevrons?: (s: number) => boolean; where?: (s: number) => boolean }) {
    const t = this.track
    const step = Math.max(2, Math.round((o.step ?? 10) / 2))
    const posts: number[][] = []
    const boards: number[][] = []
    this.edges((e) => {
      if (o.where && !o.where(e.s)) return
      const n = Math.round(e.s / 2)
      if (n % step === 0) posts.push([e.ax, e.ay, e.az, Math.atan2(e.nx, e.nz)])
      if (e.road !== -1 || n % 4 !== 0 || t.curv[e.i] < 0.014 || (o.chevrons && !o.chevrons(e.s))) return
      // The outside of the bend: the side it turns away from.
      const j = (e.i + 6) % t.n
      const towardPlus = t.tx[e.i] * t.tz[j] - t.tz[e.i] * t.tx[j] > 0
      if (e.side !== (towardPlus ? -1 : 1)) return
      boards.push([e.ax + e.nx * 0.4, e.ay + 0.25, e.az + e.nz * 0.4, Math.atan2(-t.tx[e.i], -t.tz[e.i]), towardPlus ? 1 : -1])
    }, 0.3)
    const postGeo = o.bollard ? new THREE.CylinderGeometry(0.13, 0.16, 0.9, 8).translate(0, 0.45, 0) : new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0)
    this.instances(postGeo, new THREE.MeshStandardMaterial({ color: o.post, roughness: 0.6, metalness: o.bollard ? 0.5 : 0.1 }), posts)
    const capGeo = o.bollard ? new THREE.SphereGeometry(0.15, 8, 6).translate(0, 0.92, 0) : new THREE.BoxGeometry(0.14, 0.2, 0.14).translate(0, 0.95, 0)
    this.instances(capGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(o.reflector).multiplyScalar(o.bollard ? 1 : 1.8), toneMapped: o.bollard === true }), posts)
    if (!boards.length) return
    const tex = chevronTexture()
    const board = new THREE.PlaneGeometry(1.7, 1.0).translate(0, 1.35, 0)
    this.instances(board, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 }), boards.map(([x, y, z, yaw, sx]) => [x, y, z, yaw, sx, 1, 1]))
    this.instances(new THREE.BoxGeometry(0.1, 1.85, 0.1).translate(0, 0.92, -0.06), new THREE.MeshStandardMaterial({ color: '#555a60' }), boards.map(([x, y, z, yaw]) => [x, y, z, yaw]))
  }

  /** Start gantry over the line. */
  gantry(color: string) {
    const t = this.track
    const p0 = t.point(0), h0 = t.heading(0), y0 = t.py[0]
    const W = t.hw[0] * 2
    const model = this.prop('gantry')
    if (model) {
      const { object } = normalizeModel(model, { length: W + 5, frontAxis: 'z' })
      object.position.set(p0.x, y0, p0.z)
      object.rotation.y = h0 + Math.PI / 2
      this.group.add(object)
      return
    }
    const g = new THREE.Group()
    g.position.set(p0.x, y0, p0.z)
    g.rotation.y = h0 + Math.PI / 2
    const postMat = new THREE.MeshStandardMaterial({ color: '#2b2f3a', metalness: 0.6, roughness: 0.4 })
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), postMat)
      post.position.set(s * (W / 2 + 1.2), 4.5, 0)
      g.add(post)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 3.2, 1.6, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), toneMapped: false }))
    beam.position.y = 9
    g.add(beam)
    this.group.add(g)
  }

  /* ----- Placement ----- */

  /**
   * Evenly spaced spots along the main road (both sides, or one), `off` metres outside the edge, at the road's
   * height, yaw facing the road. Spots too close to another part of the circuit are skipped.
   */
  along(step: number, off: number, fn: (x: number, y: number, z: number, yaw: number, s: number, side: number) => void, opts: { sides?: number[]; from?: number; to?: number; clear?: number } = {}) {
    const t = this.track
    const from = opts.from ?? 0, to = opts.to ?? t.length
    for (let s = from; s < to; s += step) {
      const i = t.index(s)
      for (const side of opts.sides ?? [-1, 1]) {
        const p = t.point(s, side * (t.hw[i] + off), tmpV)
        if (this.clearance(p.x, p.z) < (opts.clear ?? off - 1)) continue
        fn(p.x, t.heightAtS(s), p.z, Math.atan2(side * t.tz[i], -side * t.tx[i]), s, side)
      }
    }
  }

  /** Same along each shortcut. */
  alongBranches(step: number, off: number, fn: (x: number, y: number, z: number, yaw: number, s: number, side: number) => void, clear = off - 1) {
    for (const b of this.track.branches) {
      for (let u = 30; u < b.length - 30; u += step) {
        const k = Math.min(b.n - 1, Math.round((u / b.length) * (b.n - 1)))
        for (const side of [-1, 1]) {
          const x = b.px[k] - b.tz[k] * side * (b.half + off), z = b.pz[k] + b.tx[k] * side * (b.half + off)
          if (this.clearance(x, z) < clear) continue
          fn(x, b.h[k], z, Math.atan2(side * b.tz[k], -side * b.tx[k]), u, side)
        }
      }
    }
  }

  /** An instanced mesh from a list of [x, y, z, yaw, sx, sy, sz] (and optional colours). */
  instances(geo: THREE.BufferGeometry, mat: THREE.Material, list: number[][], colors?: THREE.Color[]) {
    if (!list.length) return null
    const im = new THREE.InstancedMesh(geo, mat, list.length)
    list.forEach(([x, y, z, yaw, sx = 1, sy = 1, sz = 1], i) => {
      tmpQ.setFromEuler(tmpE.set(0, yaw, 0))
      im.setMatrixAt(i, tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz)))
      if (colors) im.setColorAt(i, colors[i])
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    this.group.add(im)
    return im
  }

  /** Instanced copies of a GLB prop: [x, y, z, yaw, scale]. */
  propInstances(name: PropName, size: { height?: number; length?: number }, list: number[][]) {
    const src = this.prop(name)
    if (!src || !list.length) return false
    const model = normalizeModel(src, { ...size, frontAxis: 'z' }).object
    model.updateMatrixWorld(true)
    const mats = list.map(([x, y, z, yaw, s = 1]) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(s, s, s)))
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const im = new THREE.InstancedMesh(m.geometry, m.material, mats.length)
      mats.forEach((mat, i) => im.setMatrixAt(i, tmpM.multiplyMatrices(mat, m.matrixWorld)))
      im.instanceMatrix.needsUpdate = true
      im.computeBoundingSphere()
      this.group.add(im)
    })
    return true
  }

  /** A canvas sign on a plane. */
  sign(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, yaw: number, glow = 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: new THREE.Color(glow, glow, glow), toneMapped: glow <= 1 }))
    m.position.set(x, y, z)
    m.rotation.y = yaw
    this.group.add(m)
    return m
  }
}

export interface Edge {
  ax: number
  az: number
  ay: number
  bx: number
  bz: number
  by: number
  nx: number // outward normal
  nz: number
  road: number // -1 main, k shortcut
  side: number
  s: number // main-road distance
  i: number // sample index
}

/** World-mapped facade material (windows keep their size on any box) with a flat roof colour. Instancing aware. */
export function facadeMat(tex: THREE.Texture, opts: { tileW: number; tileH: number; roof: string; glow?: number; rough?: number; metal?: number; tint?: string }) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.tint ?? '#ffffff', map: tex, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0.05,
  })
  const roof = new THREE.Color(opts.roof)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRoof = { value: roof }
    sh.uniforms.uGlowK = { value: opts.glow ?? 0 }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFac; varying float vRoof;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        mat4 fm = modelMatrix;
        #ifdef USE_INSTANCING
          fm = modelMatrix * instanceMatrix;
        #endif
        vec4 fw = fm * vec4(position, 1.0);
        vec3 fn = normalize(mat3(fm) * normal);
        vRoof = step(0.5, fn.y);
        vFac = vec2(dot(fw.xz, vec2(-fn.z, fn.x)) / ${opts.tileW.toFixed(1)}, fw.y / ${opts.tileH.toFixed(1)});`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRoof; uniform float uGlowK; varying vec2 vFac; varying float vRoof;')
      .replace('#include <map_fragment>', 'vec4 fTex = texture2D(map, vFac); diffuseColor.rgb *= mix(fTex.rgb, uRoof, vRoof);')
      .replace(
        '#include <emissivemap_fragment>',
        'float lit = smoothstep(0.75, 0.95, max(fTex.r, fTex.g) - fTex.b * 0.35); totalEmissiveRadiance += fTex.rgb * lit * (1.0 - vRoof) * uGlowK;',
      )
  }
  return mat
}

/** Red and white chevrons pointing right (flip the board for a left-hander). */
function chevronTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 150
  const g = c.getContext('2d')!
  g.fillStyle = '#c8102e'
  g.fillRect(0, 0, 256, 150)
  g.fillStyle = '#ffffff'
  for (const x of [30, 110, 190]) {
    g.beginPath()
    g.moveTo(x - 30, 18)
    g.lineTo(x + 2, 18)
    g.lineTo(x + 46, 75)
    g.lineTo(x + 2, 132)
    g.lineTo(x - 30, 132)
    g.lineTo(x + 14, 75)
    g.closePath()
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Unit box resting on y = 0 (scale it per instance). */
export const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
