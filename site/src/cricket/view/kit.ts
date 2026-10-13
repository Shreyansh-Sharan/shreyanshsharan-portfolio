// Team kits painted at runtime. The shipped jersey and trouser maps carry no colour: R is the garment's shading
// (128 = the base tone), G is the trim mask (collar, cuffs, hem, side stripes). A kit is the two team colours
// through those maps, plus the team name on the chest and the player's name and number on the back, all
// fictional. Textures are cached per team and player.
import * as THREE from 'three'
import type { CricketAssets } from '../assets'

export interface ShirtSpec {
  primary: string
  trim: string
  /** Chest text (the team name). */
  chest: string
  /** Back of the shirt: a surname above the number (either may be empty). */
  back: string
  number: string
  /** Text colour (defaults to the trim). */
  ink?: string
  /** For left-handers: the body is mirrored on screen, so the decals are pre-mirrored to read right. */
  mirror?: boolean
}

/** Where the painted-over decals sit on the 1024 px jersey map. The chest island is stored flipped vertically, the
 *  back island rotated by 180 degrees, so each gets its own flip. */
const CHEST = { x: 295, y: 660, w: 270, h: 95 }
const NUMBER = { x: 828, y: 655, w: 250, h: 250 }
/** Above the number, just under the collar (the island's top edge is at y ~900). */
const BACK_NAME = { x: 828, y: 842, w: 300, h: 58 }

export class Kits {
  private cache = new Map<string, THREE.CanvasTexture>()
  private size: number
  private assets: CricketAssets

  constructor(assets: CricketAssets, size = 512) {
    this.assets = assets
    this.size = size
  }

  /** The tinted map (no decals) as a canvas. */
  private tint(src: HTMLImageElement, primary: string, trim: string) {
    const S = this.size
    const c = document.createElement('canvas')
    c.width = c.height = S
    const x = c.getContext('2d', { willReadFrequently: true })!
    x.drawImage(src, 0, 0, S, S)
    const img = x.getImageData(0, 0, S, S)
    const d = img.data
    const [pr, pg, pb] = rgb(primary)
    const [tr, tg, tb] = rgb(trim)
    for (let i = 0; i < d.length; i += 4) {
      const shade = d[i] / 128
      const m = d[i + 1] / 255
      d[i] = Math.min(255, (pr + (tr - pr) * m) * shade)
      d[i + 1] = Math.min(255, (pg + (tg - pg) * m) * shade)
      d[i + 2] = Math.min(255, (pb + (tb - pb) * m) * shade)
      d[i + 3] = 255
    }
    x.putImageData(img, 0, 0)
    return c
  }

  /** Text on the map: `box` in 1024 px map units, flipped (`sx` horizontally) to match the stored orientation. */
  private label(x: CanvasRenderingContext2D, text: string, box: { x: number; y: number; w: number; h: number }, color: string, outline: string, sx: number) {
    if (!text) return
    const k = this.size / 1024
    x.save()
    x.translate(box.x * k, box.y * k)
    x.scale(sx, -1)
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    let size = box.h * k
    x.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`
    const w = x.measureText(text).width
    if (w > box.w * k) {
      size *= (box.w * k) / w
      x.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`
    }
    x.lineJoin = 'round'
    x.lineWidth = Math.max(1.5, size * 0.09)
    x.strokeStyle = outline
    x.strokeText(text, 0, 0)
    x.fillStyle = color
    x.fillText(text, 0, 0)
    x.restore()
  }

  private texture(c: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.flipY = false
    tex.anisotropy = 4
    return tex
  }

  shirt(s: ShirtSpec) {
    const key = `shirt|${s.primary}|${s.trim}|${s.chest}|${s.back}|${s.number}|${s.ink ?? ''}|${s.mirror ? 'm' : ''}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const c = this.tint(this.assets.kitTop, s.primary, s.trim)
    const x = c.getContext('2d')!
    const ink = s.ink ?? s.trim
    const outline = luminance(ink) > 0.5 ? 'rgba(10,12,20,0.85)' : 'rgba(255,255,255,0.85)'
    const m = s.mirror ? -1 : 1
    this.label(x, s.chest.toUpperCase(), CHEST, ink, outline, m)
    this.label(x, s.number, NUMBER, ink, outline, -m)
    // The strip under the collar is mapped the other way round from the number panel.
    this.label(x, s.back.toUpperCase(), BACK_NAME, ink, outline, m)
    const tex = this.texture(c)
    this.cache.set(key, tex)
    return tex
  }

  trousers(primary: string, trim: string) {
    const key = `trousers|${primary}|${trim}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const tex = this.texture(this.tint(this.assets.kitBottom, primary, trim))
    this.cache.set(key, tex)
    return tex
  }

  dispose() {
    for (const t of this.cache.values()) t.dispose()
    this.cache.clear()
  }
}

/** sRGB bytes of a '#rrggbb' colour (canvas space, not three's linear colours). */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
