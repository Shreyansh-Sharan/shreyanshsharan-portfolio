// Canvas-painted textures: floors per theme, holo-ads with the site's fictional brands, neon sign faces and the
// loot / objective decals. Nothing is downloaded.
import * as THREE from 'three'
import type { Theme } from '../engine/maps'

export const BRANDS = ['ORBIT COLA', 'ZENITH MOBILE', 'LUMEN ENERGY', 'HALCYON TYRES', 'NORTHWIND AIR', 'KETTLE & CRUMB', 'PINEWOOD BANK', 'SKYLARK TRAVEL', 'IRONLEAF', 'GRAINFIELD']
export const SIGN_WORDS = ['NOODLE', 'OPEN', 'RAMEN', 'BAR', 'ARCADE', 'KARAOKE', 'HOTEL', 'PAWN', 'CLINIC', 'CYBER']

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function tex(c: HTMLCanvasElement, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  return t
}

/** One 4 m × 4 m tile of floor for a theme. */
export function floorTexture(theme: Theme): THREE.Texture {
  const S = 512
  const c = canvas(S, S)
  const x = c.getContext('2d')!
  const noise = (n: number, a: number) => {
    for (let i = 0; i < n; i++) {
      x.fillStyle = `rgba(255,255,255,${(Math.random() * a).toFixed(3)})`
      x.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3)
    }
  }
  if (theme === 'street' || theme === 'district') {
    x.fillStyle = theme === 'street' ? '#2a2347' : '#262040'
    x.fillRect(0, 0, S, S)
    noise(1600, 0.09)
    // Kerb-side lane edge and a dashed centre line every tile.
    x.strokeStyle = 'rgba(240,171,252,0.35)'
    x.lineWidth = 3
    x.setLineDash([40, 28])
    x.beginPath()
    x.moveTo(0, S / 2)
    x.lineTo(S, S / 2)
    x.stroke()
    x.setLineDash([])
    x.strokeStyle = 'rgba(255,255,255,0.05)'
    x.lineWidth = 2
    x.strokeRect(1, 1, S - 2, S - 2)
    // A few cracks.
    x.strokeStyle = 'rgba(0,0,0,0.35)'
    for (let i = 0; i < 6; i++) {
      x.beginPath()
      let px = Math.random() * S
      let py = Math.random() * S
      x.moveTo(px, py)
      for (let k = 0; k < 5; k++) {
        px += (Math.random() - 0.5) * 60
        py += (Math.random() - 0.5) * 60
        x.lineTo(px, py)
      }
      x.stroke()
    }
  } else if (theme === 'roof') {
    x.fillStyle = '#2c3a52'
    x.fillRect(0, 0, S, S)
    noise(1200, 0.07)
    x.strokeStyle = 'rgba(0,0,0,0.45)'
    x.lineWidth = 4
    for (let i = 0; i <= 2; i++) {
      x.beginPath()
      x.moveTo((i * S) / 2, 0)
      x.lineTo((i * S) / 2, S)
      x.moveTo(0, (i * S) / 2)
      x.lineTo(S, (i * S) / 2)
      x.stroke()
    }
    x.fillStyle = 'rgba(34,211,238,0.08)'
    x.fillRect(0, 0, S, 10)
  } else {
    // Subway: glossy tiles with grout.
    x.fillStyle = '#34343f'
    x.fillRect(0, 0, S, S)
    const n = 8
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = 58 + Math.random() * 16
        x.fillStyle = `rgb(${v},${v + 2},${v + 8})`
        x.fillRect(i * (S / n) + 2, j * (S / n) + 2, S / n - 4, S / n - 4)
      }
    noise(500, 0.05)
  }
  return tex(c, 1)
}

/** The safety stripe / platform-edge strip along trenches. */
export function stripeTexture(color = '#facc15') {
  const c = canvas(256, 32)
  const x = c.getContext('2d')!
  x.fillStyle = '#111'
  x.fillRect(0, 0, 256, 32)
  x.fillStyle = color
  for (let i = 0; i < 8; i++) {
    x.beginPath()
    x.moveTo(i * 32, 0)
    x.lineTo(i * 32 + 16, 0)
    x.lineTo(i * 32 + 32, 32)
    x.lineTo(i * 32 + 16, 32)
    x.closePath()
    x.fill()
  }
  return tex(c, 1)
}

/** A holo-ad face: brand name, slogan bars, scanlines. */
export function holoTexture(brand: string, color: string) {
  const c = canvas(256, 512)
  const x = c.getContext('2d')!
  x.fillStyle = '#06040f'
  x.fillRect(0, 0, 256, 512)
  const g = x.createLinearGradient(0, 0, 0, 512)
  g.addColorStop(0, color)
  g.addColorStop(1, '#0b0820')
  x.fillStyle = g
  x.globalAlpha = 0.45
  x.fillRect(0, 0, 256, 512)
  x.globalAlpha = 1
  x.fillStyle = color
  x.fillRect(16, 16, 224, 6)
  x.fillRect(16, 490, 224, 6)
  x.font = 'bold 44px Inter, Arial, sans-serif'
  x.textAlign = 'center'
  x.fillStyle = '#ffffff'
  const words = brand.split(' ')
  words.forEach((w, i) => x.fillText(w, 128, 110 + i * 52))
  x.fillStyle = color
  for (let i = 0; i < 4; i++) x.fillRect(40, 260 + i * 40, 60 + Math.random() * 120, 14)
  x.font = 'bold 22px Inter, Arial, sans-serif'
  x.fillStyle = 'rgba(255,255,255,0.85)'
  x.fillText('NOW IN SECTOR 7', 128, 460)
  x.fillStyle = 'rgba(0,0,0,0.25)'
  for (let y = 0; y < 512; y += 4) x.fillRect(0, y, 256, 2)
  const t = tex(c, 1)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** A horizontal neon sign plate. */
export function signTexture(word: string, color: string) {
  const c = canvas(512, 128)
  const x = c.getContext('2d')!
  x.fillStyle = '#0a0612'
  x.fillRect(0, 0, 512, 128)
  x.strokeStyle = color
  x.lineWidth = 6
  x.strokeRect(10, 10, 492, 108)
  x.font = 'bold 72px Inter, Arial, sans-serif'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.shadowColor = color
  x.shadowBlur = 24
  x.fillStyle = '#ffffff'
  x.fillText(word, 256, 68)
  x.fillStyle = color
  x.globalAlpha = 0.6
  x.fillText(word, 256, 68)
  const t = tex(c, 1)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** Helipad "H" / core ring / spawn decals. */
export function decalTexture(kind: 'H' | 'core' | 'spawn', color: string) {
  const c = canvas(256, 256)
  const x = c.getContext('2d')!
  x.clearRect(0, 0, 256, 256)
  x.strokeStyle = color
  x.fillStyle = color
  x.lineWidth = 10
  if (kind === 'H') {
    x.beginPath()
    x.arc(128, 128, 110, 0, Math.PI * 2)
    x.stroke()
    x.font = 'bold 150px Inter, Arial, sans-serif'
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.fillText('H', 128, 134)
  } else if (kind === 'core') {
    x.beginPath()
    x.arc(128, 128, 112, 0, Math.PI * 2)
    x.stroke()
    x.lineWidth = 4
    x.beginPath()
    x.arc(128, 128, 80, 0, Math.PI * 2)
    x.stroke()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      x.beginPath()
      x.moveTo(128 + Math.cos(a) * 90, 128 + Math.sin(a) * 90)
      x.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118)
      x.stroke()
    }
  } else {
    x.lineWidth = 6
    x.strokeRect(24, 24, 208, 208)
    x.beginPath()
    x.moveTo(24, 24)
    x.lineTo(232, 232)
    x.moveTo(232, 24)
    x.lineTo(24, 232)
    x.stroke()
  }
  const t = tex(c, 1)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** A soft round particle. */
export function glowTexture() {
  const c = canvas(64, 64)
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Distant skyline silhouette with lit windows (a ring around rooftops and the royale map). */
export function skylineTexture(color: string) {
  const c = canvas(2048, 256)
  const x = c.getContext('2d')!
  x.clearRect(0, 0, 2048, 256)
  let px = 0
  while (px < 2048) {
    const w = 40 + Math.random() * 90
    const h = 60 + Math.random() * 180
    x.fillStyle = '#0a0714'
    x.fillRect(px, 256 - h, w, h)
    x.fillStyle = color
    x.globalAlpha = 0.9
    for (let wy = 256 - h + 8; wy < 250; wy += 12)
      for (let wx = px + 6; wx < px + w - 6; wx += 10) if (Math.random() < 0.35) x.fillRect(wx, wy, 4, 6)
    x.globalAlpha = 1
    if (Math.random() < 0.3) {
      x.fillStyle = '#f472b6'
      x.fillRect(px + 4, 256 - h - 6, w - 8, 4)
    }
    px += w + 4 + Math.random() * 10
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  return t
}
