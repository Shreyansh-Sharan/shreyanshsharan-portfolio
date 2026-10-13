// Procedural building surfaces drawn once into canvases: lap siding, asphalt shingles, brick, beadboard and the
// soft contact-shadow gradients. Each comes with a matching normal map built from the same height field, so boards,
// tabs and mortar catch the light. Textures are white-ish so materials tint them per house theme; UVs are metres
// and `repeat` maps one tile to its real size.
import * as THREE from 'three'

export interface Surface {
  map: THREE.Texture
  normalMap: THREE.Texture
  /** Tile size in metres (u, v). */
  tile: [number, number]
}

const cache = new Map<string, Surface>()

/** Deterministic value noise in [0, 1). */
function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function smoothNoise(x: number, y: number, period: number, s = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const w = (a: number) => ((a % period) + period) % period
  const a = hash(w(xi), w(yi), s)
  const b = hash(w(xi + 1), w(yi), s)
  const c = hash(w(xi), w(yi + 1), s)
  const d = hash(w(xi + 1), w(yi + 1), s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * Build a surface from per-pixel height (0..1) and albedo (0..1 grey or rgb) functions on a w x h canvas.
 * `strength` scales the normal map slope.
 */
function bake(key: string, w: number, h: number, tile: [number, number], fn: (x: number, y: number) => { h: number; c: [number, number, number] }, strength: number): Surface {
  const hit = cache.get(key)
  if (hit) return hit
  const heights = new Float32Array(w * h)
  const colour = document.createElement('canvas')
  colour.width = w
  colour.height = h
  const cx = colour.getContext('2d')!
  const img = cx.createImageData(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = fn(x, y)
      heights[y * w + x] = r.h
      const i = (y * w + x) * 4
      img.data[i] = Math.max(0, Math.min(255, r.c[0] * 255))
      img.data[i + 1] = Math.max(0, Math.min(255, r.c[1] * 255))
      img.data[i + 2] = Math.max(0, Math.min(255, r.c[2] * 255))
      img.data[i + 3] = 255
    }
  cx.putImageData(img, 0, 0)
  const normal = document.createElement('canvas')
  normal.width = w
  normal.height = h
  const nx = normal.getContext('2d')!
  const nimg = nx.createImageData(w, h)
  const at = (x: number, y: number) => heights[((y + h) % h) * w + ((x + w) % w)]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Canvas y runs down while texture v runs up: flip the y slope.
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength
      const l = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      nimg.data[i] = ((-dx / l) * 0.5 + 0.5) * 255
      nimg.data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255
      nimg.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255
      nimg.data[i + 3] = 255
    }
  nx.putImageData(nimg, 0, 0)
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    t.repeat.set(1 / tile[0], 1 / tile[1])
    t.generateMipmaps = true
    return t
  }
  const s: Surface = { map: mk(colour, true), normalMap: mk(normal, false), tile }
  cache.set(key, s)
  return s
}

/** Lap siding: 8 boards of 16 cm per 1.28 m tile, each board thicker at its bottom edge with a shadow line under it. */
export function sidingSurface() {
  const W = 256
  const H = 512
  const board = H / 8
  return bake('siding', W, H, [0.64, 1.28], (x, y) => {
    // y=0 is the top of the canvas (top of the tile); v grows upward in the texture, so boards overlap downward.
    const k = y % board
    const t = k / board // 0 at a board's top, 1 at its bottom edge
    const grain = smoothNoise(x / 40, y / 3, W / 40, 1) * 0.5 + smoothNoise(x / 9, y / 1.5, W / 9, 2) * 0.5
    let hgt = 0.15 + t * 0.85
    let c = 0.93 + grain * 0.06
    if (t > 0.92) {
      // The drip edge: the bottom lip in shadow.
      hgt = 1.0 - (t - 0.92) * 10
      c *= 0.62
    } else if (t < 0.08) c *= 0.82
    c *= 0.97 + hash(Math.floor(y / board), 7) * 0.05
    return { h: hgt, c: [c, c, c] }
  }, 7)
}

/** Asphalt shingles: 16 cm courses of 32 cm tabs, staggered half a tab, with speckled granules. */
export function shingleSurface() {
  const W = 512
  const H = 512
  const course = H / 8
  const tab = W / 4
  return bake('shingles', W, H, [1.28, 1.28], (x, y) => {
    const row = Math.floor(y / course)
    const k = (y % course) / course
    const off = row % 2 ? tab / 2 : 0
    const tx = (x + off) % tab
    const tabId = Math.floor((x + off) / tab)
    const jitter = (hash(tabId, row, 3) - 0.5) * 0.12
    const gap = tx < 3 || tx > tab - 3
    const granule = hash(x, y, 9)
    const tone = 0.78 + hash(tabId, row, 5) * 0.18
    let hgt = 0.25 + k * 0.6
    let c = tone * (0.86 + granule * 0.22)
    if (k > 0.86 + jitter * 0.3) {
      hgt = 1 - (k - 0.86) * 4
      c *= 0.55
    }
    if (gap && k < 0.86) {
      hgt *= 0.4
      c *= 0.5
    }
    return { h: hgt, c: [c, c, c] }
  }, 5)
}

/** Running-bond brick: 21.5 x 6.5 cm bricks, 1 cm mortar, five bricks by sixteen courses a tile. */
export function brickSurface() {
  const W = 512
  const H = 512
  const course = H / 16
  const bw = W / 5
  return bake('brick', W, H, [1.125, 1.2], (x, y) => {
    const row = Math.floor(y / course)
    const off = row % 2 ? bw / 2 : 0
    const bx = (x + off) % bw
    const by = y % course
    const id = Math.floor((x + off) / bw)
    const mortar = bx < 4 || by < 4
    if (mortar) {
      const m = 0.82 + hash(x, y, 4) * 0.08
      return { h: 0.1, c: [m, m * 0.98, m * 0.94] }
    }
    const tone = hash(id, row, 11)
    const spec = hash(x, y, 12) * 0.12
    const r = 0.7 + tone * 0.22 - spec
    const g = 0.36 + tone * 0.1 - spec * 0.7
    const b = 0.27 + tone * 0.06 - spec * 0.5
    const edge = Math.min(bx - 4, bw - bx, by - 4, course - by)
    return { h: 0.6 + Math.min(1, edge / 4) * 0.4, c: [r, g, b] }
  }, 4)
}

/** Painted beadboard for porch ceilings and soffits: 10 cm boards. */
export function beadboardSurface() {
  const W = 256
  const H = 64
  const bw = W / 8
  return bake('beadboard', W, H, [0.8, 0.2], (x) => {
    const k = (x % bw) / bw
    const groove = k < 0.06
    const c = groove ? 0.72 : 0.95
    return { h: groove ? 0.2 : 0.9, c: [c, c, c] }
  }, 3)
}

/** Plain painted trim with a faint brush grain (keeps trim from reading as flat plastic). */
export function trimSurface() {
  const W = 128
  const H = 128
  return bake('trim', W, H, [0.5, 0.5], (x, y) => {
    const g = smoothNoise(x / 32, y / 2, 4, 21) * 0.6 + smoothNoise(x / 6, y / 1, W / 6, 22) * 0.4
    const c = 0.95 + g * 0.05
    return { h: g * 0.4, c: [c, c, c] }
  }, 1.2)
}

/** A soft radial falloff (white centre, transparent edge) used for contact shadows and lamp pools. */
let blobTex: THREE.Texture | null = null
export function blob() {
  if (blobTex) return blobTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 128, 128)
  blobTex = new THREE.CanvasTexture(c)
  return blobTex
}

/** A linear falloff across v (opaque at v=0, clear at v=1), for the shadow skirt around foundations. */
let rampTex: THREE.Texture | null = null
export function ramp() {
  if (rampTex) return rampTex
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 64
  const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 64, 0, 0)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 4, 64)
  rampTex = new THREE.CanvasTexture(c)
  return rampTex
}

/** Small white bathroom tiles with grey grout (a 0.6 m repeat). */
let tileTex: THREE.Texture | null = null
export function smallTiles() {
  if (tileTex) return tileTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')!
  x.fillStyle = '#b9bec4'
  x.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const v = 236 + ((i * 7 + j * 3) % 5) * 3
      x.fillStyle = `rgb(${v},${v},${v + 2})`
      x.fillRect(i * 32 + 2, j * 32 + 2, 28, 28)
    }
  tileTex = new THREE.CanvasTexture(c)
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping
  tileTex.colorSpace = THREE.SRGBColorSpace
  tileTex.repeat.set(1 / 0.6, 1 / 0.6)
  tileTex.anisotropy = 4
  return tileTex
}
