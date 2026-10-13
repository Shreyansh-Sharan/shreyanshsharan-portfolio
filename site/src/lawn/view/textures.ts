// Procedural canvas textures: barricade planks, rugs, crack overlays, splats, particles, labels, neon signs and the
// sky strip. (The houses and the street use the tiling textures in public/lawn/textures.) Drawn once and cached.
import * as THREE from 'three'

const cache = new Map<string, THREE.Texture>()

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = 1, srgb = true) {
  const hit = cache.get(key)
  if (hit) return hit
  const { c, g } = canvas(w, h)
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.magFilter = THREE.LinearFilter
  cache.set(key, t)
  return t
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex)
  c.r = Math.min(1, c.r * k)
  c.g = Math.min(1, c.g * k)
  c.b = Math.min(1, c.b * k)
  return '#' + c.getHexString()
}

let seed = 1
function rnd() {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

export function planks(hex = '#b98a55') {
  return tex(`planks-${hex}`, 256, 256, (g, w, h) => {
    seed = 9
    g.fillStyle = hex
    g.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 42) {
      g.fillStyle = shade(hex, 0.85 + rnd() * 0.25)
      g.fillRect(x, 0, 40, h)
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(x + 40, 0, 2, h)
      for (let i = 0; i < 12; i++) {
        g.fillStyle = `rgba(60,30,0,${0.06 + rnd() * 0.1})`
        g.fillRect(x + 4 + rnd() * 30, rnd() * h, 2, 10 + rnd() * 40)
      }
    }
  })
}

export function rug(hex = '#b23b3b', hex2 = '#f0d9a8') {
  return tex(`rug-${hex}`, 256, 256, (g, w, h) => {
    g.fillStyle = hex
    g.fillRect(0, 0, w, h)
    g.strokeStyle = hex2
    g.lineWidth = 8
    g.strokeRect(14, 14, w - 28, h - 28)
    g.lineWidth = 3
    g.strokeRect(34, 34, w - 68, h - 68)
    g.fillStyle = hex2
    for (let i = 0; i < 4; i++) {
      g.beginPath()
      g.moveTo(w / 2, h / 2 - 50)
      g.lineTo(w / 2 + 50, h / 2)
      g.lineTo(w / 2, h / 2 + 50)
      g.lineTo(w / 2 - 50, h / 2)
      g.closePath()
      g.stroke()
    }
  }, 1)
}

/** Crack overlay for chipped walls: 3 levels of damage (alpha texture). */
export function cracks(level: number) {
  return tex(`cracks-${level}`, 256, 256, (g, w, h) => {
    seed = 41 + level
    g.clearRect(0, 0, w, h)
    g.strokeStyle = 'rgba(30,20,10,0.85)'
    g.lineCap = 'round'
    const n = level * 5
    for (let i = 0; i < n; i++) {
      let x = w * (0.3 + rnd() * 0.4)
      let y = h * (0.3 + rnd() * 0.4)
      g.lineWidth = 2 + rnd() * 2
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (rnd() - 0.5) * 70
        y += (rnd() - 0.5) * 70
        g.lineTo(x, y)
      }
      g.stroke()
    }
    if (level >= 2) {
      g.fillStyle = 'rgba(20,12,6,0.55)'
      for (let i = 0; i < level * 4; i++) {
        g.beginPath()
        g.arc(rnd() * w, rnd() * h, 6 + rnd() * 16, 0, Math.PI * 2)
        g.fill()
      }
    }
  }, 1)
}

/** A paint / egg / water splat sprite. */
export function splat(hex: string) {
  return tex(`splat-${hex}`, 128, 128, (g, w, h) => {
    seed = 53
    g.clearRect(0, 0, w, h)
    g.fillStyle = hex
    g.beginPath()
    g.arc(w / 2, h / 2, 34, 0, Math.PI * 2)
    g.fill()
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2
      const r = 28 + rnd() * 30
      g.beginPath()
      g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 4 + rnd() * 10, 0, Math.PI * 2)
      g.fill()
    }
  }, 1)
}

/** Soft round particle sprite. */
export function dot() {
  return tex('dot', 64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.5, 'rgba(255,255,255,0.6)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, w, h)
  }, 1, false)
}

/** Star sprite for the KO halo. */
export function star() {
  return tex('star', 64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h)
    g.fillStyle = '#ffe24a'
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 30
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2
      g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r)
    }
    g.closePath()
    g.fill()
    g.strokeStyle = '#8a5a00'
    g.lineWidth = 3
    g.stroke()
  }, 1)
}

/** Text sprite texture (damage numbers, labels). */
export function label(text: string, colour: string, size = 48, outline = '#2a1a0a') {
  const key = `label-${text}-${colour}-${size}`
  const hit = cache.get(key)
  if (hit) return hit
  const { c, g } = canvas(256, 96)
  g.font = `900 ${size}px Inter, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 8
  g.strokeStyle = outline
  g.strokeText(text, 128, 48)
  g.fillStyle = colour
  g.fillText(text, 128, 48)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  cache.set(key, t)
  return t
}

/** Neon sign text texture. */
export function neon(text: string, colour: string, w = 512, h = 128) {
  return tex(`neon-${text}-${colour}`, w, h, (g, ww, hh) => {
    g.fillStyle = '#1a1420'
    g.fillRect(0, 0, ww, hh)
    g.font = `900 ${hh * 0.6}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.shadowColor = colour
    g.shadowBlur = 24
    g.fillStyle = colour
    g.fillText(text, ww / 2, hh / 2)
    g.shadowBlur = 0
    g.fillStyle = '#ffffff'
    g.font = `800 ${hh * 0.55}px Inter, system-ui, sans-serif`
    g.fillText(text, ww / 2, hh / 2)
  }, 1)
}

/** Sky gradient as an equirect-like strip. */
export function skyStrip(top: string, horizon: string) {
  return tex(`sky-${top}-${horizon}`, 4, 256, (g, w, h) => {
    const r = g.createLinearGradient(0, 0, 0, h)
    r.addColorStop(0, top)
    r.addColorStop(0.55, horizon)
    r.addColorStop(1, horizon)
    g.fillStyle = r
    g.fillRect(0, 0, w, h)
  }, 1)
}
