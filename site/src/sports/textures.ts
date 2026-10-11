// Procedural canvas textures: grass, paving, asphalt, kerbs, the pitch markings, the hall floor and text banners.
import * as THREE from 'three'

/** Flat ground overlays (road, paths, pitch) draw on top of the ground without z-fighting at distance. */
export function decal<M extends THREE.Material>(m: M, layer = 1): M {
  m.polygonOffset = true
  m.polygonOffsetFactor = -layer
  m.polygonOffsetUnits = -layer * 2
  return m
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

function tex(c: HTMLCanvasElement, repeat?: [number, number], aniso = 4) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
  }
  return t
}

let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: [number, number]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)]
    const s = size[0] + rnd() * (size[1] - size[0])
    g.fillRect(rnd() * w, rnd() * h, s, s)
  }
}

export function grassTexture(repeat: number) {
  const { c, g } = canvas(256, 256)
  g.fillStyle = '#5f9e3a'
  g.fillRect(0, 0, 256, 256)
  speckle(g, 256, 256, 2600, ['#6aab42', '#548f33', '#73b54a', '#4f8a2f', '#7cbd52'], [1, 3])
  return tex(c, [repeat, repeat])
}

export function pavingTexture(repeat: [number, number], tint = '#d9cbb3') {
  const { c, g } = canvas(256, 256)
  g.fillStyle = tint
  g.fillRect(0, 0, 256, 256)
  const n = 4
  const s = 256 / n
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = 0.92 + rnd() * 0.12
      g.fillStyle = `rgba(${Math.round(120 * k)},${Math.round(100 * k)},${Math.round(80 * k)},0.12)`
      g.fillRect(x * s + 2, y * s + 2, s - 4, s - 4)
    }
  g.strokeStyle = 'rgba(90,75,60,0.45)'
  g.lineWidth = 3
  for (let i = 0; i <= n; i++) {
    g.beginPath()
    g.moveTo(i * s, 0)
    g.lineTo(i * s, 256)
    g.moveTo(0, i * s)
    g.lineTo(256, i * s)
    g.stroke()
  }
  speckle(g, 256, 256, 500, ['rgba(0,0,0,0.06)', 'rgba(255,255,255,0.08)'], [1, 2])
  return tex(c, repeat)
}

export function asphaltTexture(repeat: [number, number]) {
  const { c, g } = canvas(256, 256)
  g.fillStyle = '#3b3f46'
  g.fillRect(0, 0, 256, 256)
  speckle(g, 256, 256, 4000, ['#454a52', '#33363c', '#4d525a', '#2f3237'], [1, 2])
  // Painted edge lines (u spans the road's width once).
  g.fillStyle = '#e5e7eb'
  g.fillRect(4, 0, 6, 256)
  g.fillRect(246, 0, 6, 256)
  return tex(c, repeat, 8)
}

/** Red and white kerb stripes along the u axis. */
export function kerbTexture() {
  const { c, g } = canvas(64, 16)
  g.fillStyle = '#f8fafc'
  g.fillRect(0, 0, 64, 16)
  g.fillStyle = '#dc2626'
  g.fillRect(0, 0, 32, 16)
  const t = tex(c)
  t.wrapS = THREE.RepeatWrapping
  return t
}

/** Mown stripes and the markings of a half pitch, goal at the top (v = 1 at the goal line). */
export function pitchTexture(halfW: number, halfL: number) {
  const px = 12 // pixels per metre
  const W = Math.round(halfW * 2 * px), H = Math.round(halfL * 2 * px)
  const { c, g } = canvas(W, H)
  const stripes = 10
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#4f9a35' : '#5aa83d'
    g.fillRect(0, (i * H) / stripes, W, H / stripes + 1)
  }
  g.strokeStyle = 'rgba(255,255,255,0.92)'
  g.lineWidth = 0.12 * px
  const m = 1.5 * px // margin to the lines
  const X = (x: number) => W / 2 + x * px
  const Y = (d: number) => m + d * px // d metres from the goal line
  g.strokeRect(m, m, W - 2 * m, H - m * 2)
  // Six-yard box, penalty box, spot and arc.
  g.strokeRect(X(-9.16), Y(0), 18.32 * px, 5.5 * px)
  g.strokeRect(X(-20.16), Y(0), 40.32 * px, 16.5 * px)
  g.fillStyle = '#fff'
  g.beginPath()
  g.arc(X(0), Y(11), 0.13 * px, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.arc(X(0), Y(11), 9.15 * px, 0.2 * Math.PI, 0.8 * Math.PI)
  g.stroke()
  // Halfway line and the centre circle's half at the bottom edge.
  g.beginPath()
  g.arc(X(0), H - m, 9.15 * px, Math.PI, 2 * Math.PI)
  g.stroke()
  const t = tex(c, undefined, 8)
  return t
}

export function woodFloorTexture(repeat: [number, number]) {
  const { c, g } = canvas(512, 512)
  const planks = 8
  for (let i = 0; i < planks; i++) {
    const y = (i * 512) / planks
    const off = rnd() * 512
    for (let x = -512; x < 512; x += 170) {
      const k = 0.9 + rnd() * 0.2
      g.fillStyle = `rgb(${Math.round(196 * k)},${Math.round(146 * k)},${Math.round(92 * k)})`
      g.fillRect(x + off, y, 168, 512 / planks - 2)
    }
    g.fillStyle = 'rgba(80,50,20,0.5)'
    g.fillRect(0, y + 512 / planks - 2, 512, 2)
  }
  speckle(g, 512, 512, 1500, ['rgba(110,70,30,0.12)', 'rgba(255,230,190,0.1)'], [1, 4])
  return tex(c, repeat, 8)
}

/** A badminton court: green surface with white lines (court length along u). */
export function badmintonCourtTexture() {
  const px = 40
  const L = 13.4, Wd = 6.1
  const { c, g } = canvas(Math.round(L * px), Math.round(Wd * px))
  g.fillStyle = '#16794a'
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = '#f8fafc'
  g.lineWidth = 0.04 * px * 1.6
  const U = (u: number) => u * px
  const V = (v: number) => v * px
  g.strokeRect(U(0.02), V(0.02), U(L - 0.04), V(Wd - 0.04))
  // Singles sidelines, short service lines, long service lines (doubles), centre lines.
  g.beginPath()
  for (const v of [0.46, Wd - 0.46]) {
    g.moveTo(U(0), V(v))
    g.lineTo(U(L), V(v))
  }
  for (const u of [L / 2 - 1.98, L / 2 + 1.98, 0.76, L - 0.76]) {
    g.moveTo(U(u), V(0))
    g.lineTo(U(u), V(Wd))
  }
  g.moveTo(U(0), V(Wd / 2))
  g.lineTo(U(L / 2 - 1.98), V(Wd / 2))
  g.moveTo(U(L / 2 + 1.98), V(Wd / 2))
  g.lineTo(U(L), V(Wd / 2))
  g.stroke()
  return tex(c, undefined, 8)
}

/** A panelled wall for the hall interior. */
export function wallTexture(repeat: [number, number]) {
  const { c, g } = canvas(256, 256)
  g.fillStyle = '#e2e8f0'
  g.fillRect(0, 0, 256, 256)
  g.fillStyle = '#1e3a8a'
  g.fillRect(0, 190, 256, 66)
  g.fillStyle = '#f97316'
  g.fillRect(0, 180, 256, 10)
  g.strokeStyle = 'rgba(100,116,139,0.35)'
  g.lineWidth = 2
  for (let x = 0; x <= 256; x += 64) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, 180)
    g.stroke()
  }
  return tex(c, repeat)
}

export interface LabelOpts {
  w?: number
  h?: number
  bg?: string
  fg?: string
  sub?: string
  subColor?: string
  border?: string
  font?: number
}

/** A text banner (title plus optional subtitle) as a texture. */
export function labelTexture(text: string, o: LabelOpts = {}) {
  const w = o.w ?? 1024, h = o.h ?? 256
  const { c, g } = canvas(w, h)
  if (o.bg) {
    g.fillStyle = o.bg
    g.fillRect(0, 0, w, h)
  }
  if (o.border) {
    g.strokeStyle = o.border
    g.lineWidth = h * 0.06
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth)
  }
  g.fillStyle = o.fg ?? '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = o.font ?? (o.sub ? h * 0.42 : h * 0.55)
  g.font = `900 italic ${size}px ui-sans-serif, system-ui, sans-serif`
  while (g.measureText(text).width > w * 0.92 && size > 10) {
    size -= 2
    g.font = `900 italic ${size}px ui-sans-serif, system-ui, sans-serif`
  }
  g.fillText(text, w / 2, o.sub ? h * 0.38 : h / 2)
  if (o.sub) {
    let s2 = h * 0.2
    g.font = `700 ${s2}px ui-sans-serif, system-ui, sans-serif`
    while (g.measureText(o.sub).width > w * 0.92 && s2 > 8) {
      s2 -= 1
      g.font = `700 ${s2}px ui-sans-serif, system-ui, sans-serif`
    }
    g.fillStyle = o.subColor ?? 'rgba(255,255,255,0.85)'
    g.fillText(o.sub, w / 2, h * 0.76)
  }
  return tex(c, undefined, 8)
}
