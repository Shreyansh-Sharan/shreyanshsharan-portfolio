// Canvas-painted textures for the location circuits: road surfaces, ground, facades and signage. All generated at
// load from fixed seeds (nothing is downloaded), so every player sees the same thing.
import * as THREE from 'three'
import { mulberry32 } from './track'

type G = CanvasRenderingContext2D

function canvas(w: number, h: number, draw: (g: G, w: number, h: number) => void, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = opts.aniso ?? 8
  return t
}

/** Per-pixel noise over a base grey, for surfaces (v = 0..255 around `mid`). */
function grain(g: G, w: number, h: number, seed: number, mid: number, amp: number, tint: [number, number, number] = [1, 1, 1]) {
  const img = g.createImageData(w, h)
  const rnd = mulberry32(seed)
  for (let i = 0; i < w * h; i++) {
    const v = mid + (rnd() - 0.5) * amp
    img.data[i * 4] = v * tint[0]
    img.data[i * 4 + 1] = v * tint[1]
    img.data[i * 4 + 2] = v * tint[2]
    img.data[i * 4 + 3] = 255
  }
  g.putImageData(img, 0, 0)
}

function blotches(g: G, w: number, h: number, seed: number, n: number, color: string, rMin: number, rMax: number) {
  const rnd = mulberry32(seed)
  for (let k = 0; k < n; k++) {
    const x = rnd() * w, y = rnd() * h, r = rMin + rnd() * (rMax - rMin)
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, color)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/** Storm-channel concrete: pale slabs, expansion joints, water stains. One repeat = 8 m. */
export function concreteTexture() {
  return canvas(512, 512, (g, w, h) => {
    grain(g, w, h, 31, 196, 26, [1, 0.98, 0.94])
    blotches(g, w, h, 32, 40, 'rgba(120,110,95,0.10)', 20, 90)
    blotches(g, w, h, 33, 30, 'rgba(255,250,240,0.08)', 10, 60)
    g.strokeStyle = 'rgba(70,64,58,0.55)'
    g.lineWidth = 2
    for (const y of [0, h / 2]) {
      g.beginPath()
      g.moveTo(0, y + 1)
      g.lineTo(w, y + 1)
      g.stroke()
    }
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(w / 2, 0)
    g.lineTo(w / 2, h)
    g.stroke()
    // Hairline cracks.
    const rnd = mulberry32(34)
    g.strokeStyle = 'rgba(60,55,50,0.25)'
    g.lineWidth = 1
    for (let k = 0; k < 14; k++) {
      let x = rnd() * w, y = rnd() * h
      g.beginPath()
      g.moveTo(x, y)
      for (let s = 0; s < 6; s++) {
        x += (rnd() - 0.5) * 40
        y += (rnd() - 0.5) * 40
        g.lineTo(x, y)
      }
      g.stroke()
    }
  })
}

/** Cobbles: rounded setts in staggered courses, worn shiny in the middle. One repeat = 4 m. */
export function cobbleTexture() {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#3d3630'
    g.fillRect(0, 0, w, h)
    const rnd = mulberry32(41)
    const rows = 16, cols = 12
    const rh = h / rows, cw = w / cols
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * cw * 0.5
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + off + (rnd() - 0.5) * 3, y = r * rh + (rnd() - 0.5) * 2
        const v = 105 + rnd() * 70
        const warm = rnd() * 18
        g.fillStyle = `rgb(${v + warm},${v + warm * 0.6},${v - 4})`
        g.beginPath()
        g.roundRect(x + 2, y + 2, cw - 4 + (rnd() - 0.5) * 4, rh - 4, 8)
        g.fill()
        // Highlight on top, shade below.
        g.fillStyle = 'rgba(255,240,220,0.12)'
        g.beginPath()
        g.roundRect(x + 5, y + 4, cw - 12, rh * 0.35, 6)
        g.fill()
      }
    }
    blotches(g, w, h, 42, 18, 'rgba(20,16,12,0.18)', 30, 110)
  })
}

/** Worn tarmac: dark aggregate with patch repairs. One repeat = 6 m. */
export function tarmacTexture() {
  return canvas(512, 512, (g, w, h) => {
    grain(g, w, h, 51, 78, 46, [1, 1, 1.03])
    const rnd = mulberry32(52)
    for (let k = 0; k < 2600; k++) {
      const v = 60 + rnd() * 120
      g.fillStyle = `rgba(${v},${v},${v + 4},0.55)`
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2)
    }
    blotches(g, w, h, 53, 12, 'rgba(20,20,24,0.25)', 40, 120)
    g.fillStyle = 'rgba(30,30,34,0.35)'
    g.fillRect(w * 0.15, h * 0.55, w * 0.3, h * 0.18)
  })
}

/** Pebbles for the beach: rounded grey, white and tan stones. One repeat = 5 m. */
export function pebbleTexture() {
  return canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#6f6a62'
    g.fillRect(0, 0, w, h)
    const rnd = mulberry32(61)
    const tones = ['#9a948a', '#b7b1a6', '#857e74', '#cfc8bc', '#6c675f', '#a39581', '#e0dbd0', '#7d8288']
    for (let k = 0; k < 2400; k++) {
      const x = rnd() * w, y = rnd() * h, r = 3 + rnd() * 9
      g.fillStyle = tones[Math.floor(rnd() * tones.length)]
      g.beginPath()
      g.ellipse(x, y, r, r * (0.6 + rnd() * 0.35), rnd() * Math.PI, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(255,255,255,0.12)'
      g.beginPath()
      g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.3, 0, 0, Math.PI * 2)
      g.fill()
    }
  })
}

/** Near-white ground detail (grass, sand, paving), tinted by vertex colour. One repeat = 7 m. */
export function groundDetailTexture() {
  return canvas(256, 256, (g, w, h) => {
    grain(g, w, h, 71, 220, 50)
    blotches(g, w, h, 72, 30, 'rgba(120,120,120,0.10)', 10, 50)
  })
}

/** Paving slabs for plazas and pavements. One repeat = 4 m. */
export function pavingTexture(tone = 200) {
  return canvas(256, 256, (g, w, h) => {
    grain(g, w, h, 81, tone, 22, [1, 0.98, 0.95])
    g.strokeStyle = 'rgba(60,55,50,0.45)'
    g.lineWidth = 2
    for (let k = 0; k <= 4; k++) {
      g.beginPath()
      g.moveTo(0, (k * h) / 4)
      g.lineTo(w, (k * h) / 4)
      g.stroke()
      for (let c = 0; c < 4; c++) {
        const x = ((c + (k % 2) * 0.5) * w) / 4
        g.beginPath()
        g.moveTo(x, (k * h) / 4)
        g.lineTo(x, ((k + 1) * h) / 4)
        g.stroke()
      }
    }
  })
}

/** Rough-cut stone blocks (walls, arches, the cathedral). One repeat = 3 m. */
export function stoneTexture(base: [number, number, number] = [196, 170, 132]) {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = `rgb(${base[0] * 0.6},${base[1] * 0.6},${base[2] * 0.6})`
    g.fillRect(0, 0, w, h)
    const rnd = mulberry32(91)
    const rows = 6
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 40
      while (x < w) {
        const bw = 36 + rnd() * 40
        const k = 0.82 + rnd() * 0.3
        g.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`
        g.fillRect(x + 1.5, (r * h) / rows + 1.5, bw - 3, h / rows - 3)
        x += bw
      }
    }
    blotches(g, w, h, 92, 14, 'rgba(40,30,20,0.18)', 10, 50)
  })
}

/** Chain-link fence (alpha): diamond mesh. One repeat = 1.2 m square. */
export function chainLinkTexture() {
  return canvas(
    128,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h)
      g.strokeStyle = 'rgba(190,196,200,0.95)'
      g.lineWidth = 2.2
      for (let k = -4; k <= 8; k++) {
        g.beginPath()
        g.moveTo((k * w) / 4, 0)
        g.lineTo((k * w) / 4 + h, h)
        g.stroke()
        g.beginPath()
        g.moveTo((k * w) / 4, 0)
        g.lineTo((k * w) / 4 - h, h)
        g.stroke()
      }
    },
    { aniso: 4 },
  )
}

/** Window grid facade, world-mapped by the facade shader. `style` sets the look; `night` lights more windows. */
export function facadeTexture(style: 'tower' | 'stucco' | 'ochre' | 'regency' | 'brick' | 'glass', seed = 1) {
  const W = 512, H = 512
  return canvas(W, H, (g) => {
    const rnd = mulberry32(seed * 101 + style.length)
    switch (style) {
      case 'tower': {
        // Downtown glass and steel at sunset: warm reflections, some lit floors.
        const grd = g.createLinearGradient(0, 0, 0, H)
        grd.addColorStop(0, '#3a3f52')
        grd.addColorStop(1, '#2a2c38')
        g.fillStyle = grd
        g.fillRect(0, 0, W, H)
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 8; x++) {
            const lit = rnd() < 0.18
            const sun = rnd() < 0.35
            g.fillStyle = lit ? `rgba(255,${200 + rnd() * 40},${140 + rnd() * 50},0.95)` : sun ? `rgba(255,${150 + rnd() * 50},${90 + rnd() * 40},0.55)` : `rgba(${70 + rnd() * 30},${80 + rnd() * 30},${110 + rnd() * 30},0.9)`
            g.fillRect(x * 64 + 4, y * 32 + 5, 56, 22)
          }
        g.fillStyle = 'rgba(20,20,26,0.9)'
        for (let x = 0; x <= 8; x++) g.fillRect(x * 64 - 2, 0, 4, H)
        break
      }
      case 'glass': {
        g.fillStyle = '#5d6e86'
        g.fillRect(0, 0, W, H)
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 16; x++) {
            const v = 120 + rnd() * 70
            g.fillStyle = rnd() < 0.08 ? '#ffd9a0' : `rgb(${v * 0.85},${v * 0.92},${v * 1.1})`
            g.fillRect(x * 32 + 1, y * 16 + 1, 30, 14)
          }
        break
      }
      case 'stucco':
      case 'ochre': {
        // Old-town stone and render: tall shuttered windows, iron balconies, a lit window here and there.
        const base = style === 'ochre' ? ['#c9a37a', '#d8b48a', '#bf946a', '#e0c49c'] : ['#d9c6a8', '#cdb593', '#e2d3b8', '#c4a982']
        for (let x = 0; x < 4; x++) {
          g.fillStyle = base[Math.floor(rnd() * base.length)]
          g.fillRect(x * 128, 0, 128, H)
        }
        blotches(g, W, H, seed + 7, 26, 'rgba(90,70,50,0.12)', 20, 90)
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const wx = x * 128 + 40, wy = y * 128 + 22
            const lit = rnd() < 0.28
            g.fillStyle = lit ? '#ffcf86' : '#2c2622'
            g.fillRect(wx, wy, 48, 76)
            g.fillStyle = rnd() < 0.5 ? '#3f6b5a' : '#6b4a32'
            g.fillRect(wx - 14, wy, 12, 76)
            g.fillRect(wx + 50, wy, 12, 76)
            g.fillStyle = '#e8dcc6'
            g.fillRect(wx - 4, wy - 8, 56, 6)
            if (y > 0) {
              g.fillStyle = 'rgba(30,26,24,0.95)'
              g.fillRect(wx - 10, wy + 64, 68, 4)
              for (let b = 0; b < 9; b++) g.fillRect(wx - 10 + b * 8.5, wy + 66, 2, 16)
              g.fillRect(wx - 12, wy + 82, 72, 5)
            }
          }
        break
      }
      case 'regency': {
        // White stucco terraces: tall sash windows, cornices, black balconies on the first floor.
        g.fillStyle = '#f1ede4'
        g.fillRect(0, 0, W, H)
        blotches(g, W, H, seed + 3, 16, 'rgba(160,150,135,0.10)', 20, 80)
        for (let y = 0; y < 4; y++) {
          g.fillStyle = '#ffffff'
          g.fillRect(0, y * 128 + 2, W, 7)
          g.fillStyle = 'rgba(120,110,95,0.35)'
          g.fillRect(0, y * 128 + 9, W, 2)
          for (let x = 0; x < 4; x++) {
            const wx = x * 128 + 34, wy = y * 128 + 30
            const lit = rnd() < 0.16
            g.fillStyle = '#e9e3d6'
            g.fillRect(wx - 6, wy - 6, 72, 92)
            g.fillStyle = lit ? '#ffe2a8' : '#3b4048'
            g.fillRect(wx, wy, 60, 80)
            g.fillStyle = '#f7f4ee'
            g.fillRect(wx + 28, wy, 4, 80)
            g.fillRect(wx, wy + 38, 60, 4)
            if (y === 2) {
              g.fillStyle = '#16181c'
              g.fillRect(wx - 10, wy + 70, 80, 4)
              for (let b = 0; b < 11; b++) g.fillRect(wx - 10 + b * 8, wy + 72, 2, 18)
            }
          }
        }
        break
      }
      case 'brick': {
        g.fillStyle = '#8a4a36'
        g.fillRect(0, 0, W, H)
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < 17; x++) {
            const v = 0.8 + rnd() * 0.35
            g.fillStyle = `rgb(${150 * v},${78 * v},${58 * v})`
            g.fillRect(x * 32 - ((y % 2) * 16) + 1, y * 8 + 1, 30, 6)
          }
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const lit = rnd() < 0.2
            g.fillStyle = '#efe6d6'
            g.fillRect(x * 128 + 36, y * 128 + 26, 56, 80)
            g.fillStyle = lit ? '#ffd79a' : '#2f3238'
            g.fillRect(x * 128 + 40, y * 128 + 30, 48, 72)
          }
        break
      }
    }
  })
}

/** A sign panel (text on a coloured board with a border). */
export function signTexture(lines: string[], bg: string, fg: string, w = 512, h = 256, border = true) {
  return canvas(
    w,
    h,
    (g) => {
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
      if (border) {
        g.strokeStyle = fg
        g.lineWidth = 8
        g.strokeRect(14, 14, w - 28, h - 28)
      }
      g.fillStyle = fg
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      const size = Math.min(h / (lines.length + 0.6), (w * 1.6) / Math.max(...lines.map((l) => l.length)))
      g.font = `700 ${size}px system-ui, sans-serif`
      lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05))
    },
    { repeat: false },
  )
}

/** Diagonal candy stripes (the helter-skelter, beach huts, awnings). */
export function stripeTexture(a: string, b: string, n = 8, diagonal = true) {
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = a
    g.fillRect(0, 0, w, h)
    g.fillStyle = b
    for (let k = -n; k < n * 2; k++) {
      g.beginPath()
      const x = (k * w) / n
      if (diagonal) {
        g.moveTo(x, 0)
        g.lineTo(x + w / n / 2, 0)
        g.lineTo(x + w / n / 2 + h, h)
        g.lineTo(x + h, h)
      } else {
        g.moveTo(x, 0)
        g.lineTo(x + w / n / 2, 0)
        g.lineTo(x + w / n / 2, h)
        g.lineTo(x, h)
      }
      g.fill()
    }
  })
}

/** A rose window: radial tracery in coloured glass (emissive at dusk). */
export function roseTexture() {
  return canvas(
    256,
    256,
    (g, w) => {
      const c = w / 2
      g.clearRect(0, 0, w, w)
      const cols = ['#c03a2b', '#2d5fb3', '#e0a43a', '#3f8f5a', '#8a3fb0']
      for (let r = 6; r > 0; r--) {
        g.fillStyle = cols[r % cols.length]
        g.beginPath()
        g.arc(c, c, (r / 6) * c * 0.95, 0, Math.PI * 2)
        g.fill()
      }
      g.strokeStyle = '#2a2420'
      g.lineWidth = 5
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2
        g.beginPath()
        g.moveTo(c, c)
        g.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95)
        g.stroke()
      }
      for (const r of [0.3, 0.62, 0.95]) {
        g.beginPath()
        g.arc(c, c, r * c, 0, Math.PI * 2)
        g.stroke()
      }
    },
    { repeat: false },
  )
}
