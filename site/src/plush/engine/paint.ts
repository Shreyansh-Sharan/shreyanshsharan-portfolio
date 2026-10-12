// Canvas-painted textures for levels built from primitives: a canvas → texture helper, rounded boxes, crayon
// scribbles, wobbly blob shapes and a toy-like material. Painting is deterministic (seeded), so every screen
// draws the same thing.
import * as THREE from 'three'
import { makeRng, type Rng } from './rng'

/** Paint a canvas and wrap it as a texture (sRGB, mipmapped, optionally repeating). */
export function canvasTex(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  o: { repeat?: [number, number]; aniso?: number } = {},
) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = o.aniso ?? 4
  if (o.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...o.repeat)
  }
  return t
}

/** A rounded rectangle path (fill or stroke it after). */
export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

/**
 * Crayon scribble over a box: zig-zag waxy strokes with gaps and a lighter sheen, the way a child colours in.
 * `density` 1 is a solid fill; 0.5 leaves paper showing.
 */
export function scribble(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, o: { density?: number; seed?: number; width?: number; angle?: number } = {}) {
  const rng = makeRng(o.seed ?? 7)
  const density = o.density ?? 0.9
  const lw = o.width ?? Math.max(3, Math.min(w, h) * 0.06)
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.translate(x + w / 2, y + h / 2)
  g.rotate(o.angle ?? -0.5)
  const span = Math.hypot(w, h) * 0.6
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = color
    g.globalAlpha = pass === 0 ? 0.85 : 0.35
    g.lineWidth = lw * (pass === 0 ? 1 : 0.6)
    g.beginPath()
    const step = lw * (pass === 0 ? 0.9 : 1.7) / density
    let up = true
    for (let yy = -span; yy < span; yy += step) {
      const x0 = -span + rng.range(-lw, lw)
      const x1 = span + rng.range(-lw, lw)
      if (up) {
        g.moveTo(x0, yy + rng.range(-1, 1))
        g.lineTo(x1, yy + step * 0.5 + rng.range(-2, 2))
      } else g.lineTo(x0, yy + rng.range(-2, 2))
      up = !up
    }
    g.stroke()
    g.rotate(0.35)
  }
  g.restore()
  g.globalAlpha = 1
}

/** A wobbly closed blob (like a hand-drawn patch) as a THREE.Shape, centred on (cx, cy). */
export function blobShape(rng: Rng, cx: number, cy: number, rx: number, ry: number, n = 28, wob = 0.08) {
  const s = new THREE.Shape()
  const ph = rng.range(0, Math.PI * 2)
  const k1 = rng.range(0.5, 1) * wob, k2 = rng.range(0.3, 0.8) * wob
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    // A rounded-square superellipse with a hand-drawn wobble.
    const c = Math.cos(a), sn = Math.sin(a)
    const sq = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(sn), 4), 0.25)
    const r = 1 + Math.sin(a * 3 + ph) * k1 + Math.sin(a * 5 + ph * 2) * k2
    const x = cx + c * rx * sq * 0.92 * r, y = cy + sn * ry * sq * 0.92 * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  return s
}

/** A soft, slightly glossy plastic/painted-wood material for toys built from primitives. */
export function toyMat(color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...extra })
}

/** Hex colour → rgba() with alpha. */
export function rgba(hex: string, a: number) {
  const n = parseInt(hex.replace('#', ''), 16) || 0
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
