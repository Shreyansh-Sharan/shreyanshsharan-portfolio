// Toy Box Trail visuals: playing-card tiles with canvas-painted faces, bottle caps on a hand-mirror pond, a
// popsicle-stick ladder over a book stack, a pink slide, the sock drawer, the cookie jar, signposts, stitched
// thread between tiles, foam dice, mousetraps and turn markers. All primitives and canvas textures (plus a
// few of the attic props), instanced where repeated, so the whole board is a few thousand triangles.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { discMaterial, prop } from '../engine/assets'
import { textSprite } from '../engine/helpers'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import type { LevelCtx } from '../engine/types'
import { FORKS, JAR, jumpPath, POND, slideCurve, slideTop, TILE_INFO, TILES, type TileKind } from './layout'

export const CARD_W = 1.3
export const CARD_L = 1.76
/** Die value on each face of a BoxGeometry, in its face order (+x, -x, +y, -y, +z, -z). Opposites sum to 7. */
export const DIE_FACES = [3, 4, 1, 6, 2, 5]
export const DIE_SIZE = 0.9

export interface BoardView {
  dice: { body: RigidBody; obj: THREE.Group; nums: (THREE.Sprite | null)[]; color: string }[]
  traps: THREE.Group[]
  ring: THREE.Mesh
  marker: THREE.Mesh
  forkArrows: THREE.Group[]
  jarGlow: THREE.Mesh
  top: THREE.Object3D
  /** This screen only: the camera shows the whole board. */
  overview: boolean
  camT: number
}

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra })

/* ---------------- Canvas card faces ---------------- */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return { c, g: c.getContext('2d')! }
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function sewButton(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, crack = false) {
  g.fillStyle = color
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.25)'
  g.lineWidth = r * 0.12
  g.beginPath()
  g.arc(x, y, r * 0.78, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = 'rgba(0,0,0,0.45)'
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.beginPath()
    g.arc(x + dx * r * 0.25, y + dy * r * 0.25, r * 0.11, 0, Math.PI * 2)
    g.fill()
  }
  if (crack) {
    g.strokeStyle = '#fff7ed'
    g.lineWidth = r * 0.1
    g.beginPath()
    g.moveTo(x - r * 0.2, y - r)
    g.lineTo(x + r * 0.1, y - r * 0.3)
    g.lineTo(x - r * 0.15, y + r * 0.1)
    g.lineTo(x + r * 0.2, y + r * 0.95)
    g.stroke()
  }
}

/** The big picture in the middle of a card (also used on bottle caps). */
function drawIcon(g: CanvasRenderingContext2D, kind: TileKind, cx: number, cy: number, s: number) {
  const col = TILE_INFO[kind].color
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const label = (text: string, y: number, size: number, color = col) => {
    g.fillStyle = color
    g.font = `900 ${size}px ui-rounded, system-ui, sans-serif`
    g.fillText(text, cx, y)
  }
  switch (kind) {
    case 'gain':
      sewButton(g, cx, cy - s * 0.12, s * 0.42, col)
      label('+3', cy + s * 0.55, s * 0.38)
      break
    case 'lose':
      sewButton(g, cx, cy - s * 0.12, s * 0.42, col, true)
      label('−3', cy + s * 0.55, s * 0.38)
      break
    case 'surprise':
      label('?', cy, s * 1.1)
      g.fillStyle = '#facc15'
      for (const [dx, dy, r] of [[-0.45, -0.45, 0.09], [0.48, -0.3, 0.07], [0.42, 0.5, 0.08]]) {
        star(g, cx + dx * s, cy + dy * s, r * s)
      }
      break
    case 'shop': {
      const w = s * 0.95
      for (let i = 0; i < 5; i++) {
        g.fillStyle = i % 2 ? '#fff7ed' : col
        g.fillRect(cx - w / 2 + (i * w) / 5, cy - s * 0.5, w / 5, s * 0.32)
        g.beginPath()
        g.arc(cx - w / 2 + (i * w) / 5 + w / 10, cy - s * 0.18, w / 10, 0, Math.PI)
        g.fill()
      }
      sewButton(g, cx, cy + s * 0.25, s * 0.22, '#facc15')
      label('SHOP', cy + s * 0.68, s * 0.24)
      break
    }
    case 'duel':
      g.strokeStyle = '#94a3b8'
      g.lineWidth = s * 0.07
      for (const d of [-1, 1]) {
        g.beginPath()
        g.moveTo(cx - d * s * 0.42, cy - s * 0.5)
        g.lineTo(cx + d * s * 0.42, cy + s * 0.3)
        g.stroke()
        g.strokeStyle = '#64748b'
        g.lineWidth = s * 0.03
        g.beginPath()
        g.ellipse(cx - d * s * 0.36, cy - s * 0.43, s * 0.03, s * 0.06, d * 0.7, 0, Math.PI * 2)
        g.stroke()
        g.strokeStyle = '#94a3b8'
        g.lineWidth = s * 0.07
      }
      label('VS', cy + s * 0.6, s * 0.34)
      break
    case 'trap':
      g.fillStyle = '#cbd5e1'
      g.beginPath()
      g.arc(cx, cy - s * 0.08, s * 0.42, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#fff7ed'
      g.beginPath()
      g.arc(cx, cy - s * 0.08, s * 0.2, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(203,213,225,0.8)'
      g.fillRect(cx + s * 0.1, cy + s * 0.28, s * 0.45, s * 0.12)
      label('STUCK', cy + s * 0.62, s * 0.24)
      break
    case 'splash':
      g.fillStyle = col
      for (const [dx, dy, r] of [[0, -0.1, 0.32], [-0.38, 0.25, 0.16], [0.38, 0.3, 0.18]]) {
        g.beginPath()
        g.moveTo(cx + dx * s, cy + (dy - r * 1.6) * s)
        g.quadraticCurveTo(cx + (dx + r) * s, cy + dy * s, cx + dx * s, cy + (dy + r) * s)
        g.quadraticCurveTo(cx + (dx - r) * s, cy + dy * s, cx + dx * s, cy + (dy - r * 1.6) * s)
        g.fill()
      }
      break
    case 'ladder':
      g.strokeStyle = '#ca8a04'
      g.lineWidth = s * 0.08
      for (const d of [-1, 1]) {
        g.beginPath()
        g.moveTo(cx + d * s * 0.28, cy - s * 0.6)
        g.lineTo(cx + d * s * 0.28, cy + s * 0.45)
        g.stroke()
      }
      for (let i = 0; i < 5; i++) {
        g.beginPath()
        g.moveTo(cx - s * 0.28, cy - s * 0.45 + i * s * 0.22)
        g.lineTo(cx + s * 0.28, cy - s * 0.45 + i * s * 0.22)
        g.stroke()
      }
      label('UP!', cy + s * 0.68, s * 0.24)
      break
    case 'slide':
      g.strokeStyle = col
      g.lineWidth = s * 0.14
      g.beginPath()
      g.moveTo(cx - s * 0.4, cy - s * 0.5)
      g.bezierCurveTo(cx - s * 0.1, cy - s * 0.1, cx + s * 0.5, cy - s * 0.1, cx + s * 0.4, cy + s * 0.4)
      g.stroke()
      label('WHEE', cy + s * 0.68, s * 0.24)
      break
    case 'fork':
      g.strokeStyle = col
      g.lineWidth = s * 0.09
      g.beginPath()
      g.moveTo(cx, cy + s * 0.55)
      g.lineTo(cx, cy)
      g.lineTo(cx - s * 0.35, cy - s * 0.45)
      g.moveTo(cx, cy)
      g.lineTo(cx + s * 0.35, cy - s * 0.45)
      g.stroke()
      for (const d of [-1, 1]) {
        g.fillStyle = col
        g.beginPath()
        g.moveTo(cx + d * s * 0.48, cy - s * 0.6)
        g.lineTo(cx + d * s * 0.2, cy - s * 0.52)
        g.lineTo(cx + d * s * 0.42, cy - s * 0.32)
        g.fill()
      }
      break
    case 'start':
      label('START', cy - s * 0.1, s * 0.34, '#b45309')
      g.fillStyle = '#b45309'
      g.beginPath()
      g.moveTo(cx - s * 0.2, cy + s * 0.25)
      g.lineTo(cx + s * 0.3, cy + s * 0.25)
      g.lineTo(cx + s * 0.05, cy + s * 0.55)
      g.fill()
      break
    case 'goal':
      g.fillStyle = '#d6a15a'
      g.beginPath()
      g.arc(cx, cy, s * 0.45, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#5b3416'
      for (const [dx, dy] of [[-0.2, -0.15], [0.15, -0.22], [0.05, 0.12], [-0.18, 0.2], [0.24, 0.18]]) {
        g.beginPath()
        g.arc(cx + dx * s, cy + dy * s, s * 0.06, 0, Math.PI * 2)
        g.fill()
      }
      break
  }
  g.restore()
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  g.closePath()
  g.fill()
}

/** A playing card face for a tile kind. */
function cardFace(kind: TileKind) {
  const W = 256, H = 346
  const { c, g } = canvas(W, H)
  const col = TILE_INFO[kind].color
  g.fillStyle = '#fffaf0'
  g.fillRect(0, 0, W, H)
  g.strokeStyle = col
  g.lineWidth = 12
  g.beginPath()
  g.roundRect(12, 12, W - 24, H - 24, 22)
  g.stroke()
  g.setLineDash([9, 7])
  g.lineWidth = 3
  g.strokeStyle = col
  g.globalAlpha = 0.55
  g.beginPath()
  g.roundRect(28, 28, W - 56, H - 56, 14)
  g.stroke()
  g.setLineDash([])
  g.globalAlpha = 1
  // Corner pips, like a real card.
  g.fillStyle = col
  for (const [x, y, rot] of [[44, 50, 0], [W - 44, H - 50, Math.PI]] as const) {
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.beginPath()
    g.arc(0, 0, 11, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  drawIcon(g, kind, W / 2, H / 2, 150)
  return tex(c)
}

/** A bottle-cap top: a printed disc. */
function capFace(kind: TileKind) {
  const S = 256
  const { c, g } = canvas(S, S)
  const col = TILE_INFO[kind].color
  g.fillStyle = '#e2e8f0'
  g.fillRect(0, 0, S, S)
  g.fillStyle = '#fffaf0'
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = col
  g.lineWidth = 10
  g.beginPath()
  g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2)
  g.stroke()
  drawIcon(g, kind, S / 2, S / 2, 130)
  return tex(c)
}

function dieFace(value: number, base: string) {
  const S = 128
  const { c, g } = canvas(S, S)
  g.fillStyle = base
  g.fillRect(0, 0, S, S)
  // A soft foam speckle.
  g.fillStyle = 'rgba(255,255,255,0.08)'
  for (let i = 0; i < 60; i++) g.fillRect((i * 37) % S, (i * 71) % S, 2, 2)
  g.fillStyle = '#fffaf0'
  const P: Record<number, [number, number][]> = {
    1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  }
  for (const [x, y] of P[value]) {
    g.beginPath()
    g.arc(S / 2 + x * 32, S / 2 + y * 32, 12, 0, Math.PI * 2)
    g.fill()
  }
  return tex(c)
}

/* ---------------- Board pieces ---------------- */

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _up = new THREE.Vector3(0, 1, 0)

/** Rotate a card in 90° steps so its picture reads upright from the default (south) camera. */
export function cardYaw(yaw: number) {
  let best = yaw, score = -9
  for (let k = 0; k < 4; k++) {
    const a = yaw + (k * Math.PI) / 2
    // The texture's top edge points along local -z.
    const sc = -Math.cos(a)
    if (sc > score) {
      score = sc
      best = a
    }
  }
  return best
}

function buildCards(ctx: LevelCtx) {
  const paper = mat('#f5ead6', { roughness: 0.9 })
  const geo = new THREE.BoxGeometry(CARD_W, 0.04, CARD_L)
  const byKind = new Map<TileKind, number[]>()
  for (const t of TILES) {
    if (t.cap || t.kind === 'goal') continue
    if (!byKind.has(t.kind)) byKind.set(t.kind, [])
    byKind.get(t.kind)!.push(t.i)
  }
  for (const [kind, list] of byKind) {
    const face = new THREE.MeshStandardMaterial({ map: cardFace(kind), roughness: 0.6 })
    const mesh = new THREE.InstancedMesh(geo, [paper, paper, face, paper, paper, paper], list.length)
    list.forEach((i, k) => {
      const t = TILES[i]
      // A little hand-laid wobble.
      _q.setFromAxisAngle(_up, cardYaw(t.yaw) + Math.sin(i * 2.3) * 0.06)
      _m.compose(_p.set(t.x, 0.025, t.z), _q, _s)
      mesh.setMatrixAt(k, _m)
    })
    mesh.receiveShadow = true
    mesh.castShadow = false
    ctx.root.add(mesh)
  }
  // Bottle caps across the pond.
  const capGeo = new THREE.CylinderGeometry(0.74, 0.78, 0.2, 22, 1)
  // Crimp the rim.
  const pos = capGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const r = Math.hypot(x, z)
    if (r > 0.5) {
      const k = 1 + Math.sin(a * 11) * 0.035
      pos.setXYZ(i, x * k, pos.getY(i), z * k)
    }
  }
  capGeo.computeVertexNormals()
  const rim = mat('#cbd5e1', { metalness: 0.7, roughness: 0.35 })
  for (const t of TILES) {
    if (!t.cap) continue
    const top = new THREE.MeshStandardMaterial({ map: capFace(t.kind), metalness: 0.3, roughness: 0.4 })
    const cap = new THREE.Mesh(capGeo, [rim, top, rim])
    cap.position.set(t.x, 0.1 + 0.02, t.z)
    cap.rotation.y = cardYaw(t.yaw)
    cap.castShadow = cap.receiveShadow = true
    ctx.root.add(cap)
  }
}

/** Red running stitches between linked tiles: the trail at a glance. */
function buildStitches(ctx: LevelCtx) {
  const pts: [number, number, number, number][] = []
  for (const t of TILES)
    for (const n of t.next) {
      const b = TILES[n]
      const dx = b.x - t.x, dz = b.z - t.z
      const d = Math.hypot(dx, dz)
      const inner = d - CARD_L * 0.95
      if (inner <= 0.2) continue
      const k = Math.max(1, Math.round(inner / 0.38))
      for (let j = 0; j < k; j++) {
        const f = (CARD_L * 0.48 + ((j + 0.5) / k) * inner) / d
        pts.push([t.x + dx * f, t.z + dz * f, Math.atan2(dx, dz), t.cap || b.cap ? 1 : 0])
      }
    }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.03, 0.22), mat('#b91c1c', { roughness: 0.9 }), pts.length)
  pts.forEach(([x, z, yaw, onCap], i) => {
    _q.setFromAxisAngle(_up, yaw)
    _m.compose(_p.set(x, onCap ? 0.04 : 0.015, z), _q, _s)
    mesh.setMatrixAt(i, _m)
  })
  ctx.root.add(mesh)
}

function buildPond(ctx: LevelCtx) {
  const g = new THREE.Group()
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e6eef6', metalness: 1, roughness: 0.04, envMapIntensity: 1.4 }))
  glass.scale.set(POND.rx, 1, POND.rz)
  glass.position.y = 0.035
  glass.receiveShadow = true
  const plastic = mat('#f9a8d4', { roughness: 0.4 })
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 56).rotateX(Math.PI / 2), plastic)
  frame.scale.set(POND.rx + 0.08, 1.4, POND.rz + 0.08)
  frame.position.y = 0.06
  // The handle, off the short side.
  const handle = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.14, 3, 2, 0.06), plastic)
  handle.position.set(0, 0.07, -(POND.rz + 1.55))
  const back = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 40), plastic)
  back.scale.set(POND.rx + 0.1, 1, POND.rz + 0.1)
  back.position.y = 0.01
  g.add(back, glass, frame, handle)
  g.position.set(POND.x, 0, POND.z)
  g.rotation.y = POND.rot
  g.traverse((o) => ((o as THREE.Mesh).receiveShadow = true))
  ctx.root.add(g)
  const sign = textSprite('Mirror Pond', { bg: '#be185d', size: 0.5 })
  sign.position.set(POND.x + 1.2, 1.4, POND.z - 1.6)
  ctx.root.add(sign)
}

/** Popsicle sticks laid along a curve (ladder rails and rungs). */
function buildLadder(ctx: LevelCtx) {
  const from = TILES.findIndex((t) => t.kind === 'ladder')
  if (from < 0) return
  const path = jumpPath(from).map(([x, y, z]) => new THREE.Vector3(x, y, z))
  const curve = new THREE.CatmullRomCurve3(path)
  const N = 22
  const rungs = 16
  const sticks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.035, 0.16), mat('#e9c98b', { roughness: 0.8 }), N * 2 + rungs)
  let k = 0
  const a = new THREE.Vector3(), b = new THREE.Vector3(), side = new THREE.Vector3()
  for (let i = 0; i < N; i++) {
    curve.getPointAt(i / N, a)
    curve.getPointAt((i + 1) / N, b)
    const dir = b.clone().sub(a)
    side.set(dir.z, 0, -dir.x).normalize()
    const len = dir.length()
    for (const sgn of [-1, 1]) {
      const mid = a.clone().add(b).multiplyScalar(0.5).addScaledVector(side, sgn * 0.48)
      mid.y += 0.03
      // Lay the stick along the segment.
      _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize())
      _m.compose(mid, _q, _s.set(len * 1.15, 1, 0.8))
      sticks.setMatrixAt(k++, _m)
    }
  }
  for (let i = 0; i < rungs; i++) {
    curve.getPointAt((i + 0.5) / rungs, a)
    const tng = curve.getTangentAt((i + 0.5) / rungs)
    side.set(tng.z, 0, -tng.x).normalize()
    _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), side)
    _m.compose(a.clone().setY(a.y + 0.05), _q, _s.set(1.05, 1, 1))
    sticks.setMatrixAt(k++, _m)
  }
  _s.set(1, 1, 1)
  sticks.castShadow = true
  ctx.root.add(sticks)
  // A stack of books in the middle, for the ladder to rest on.
  const mid = curve.getPointAt(0.5)
  const books = [['#1d4ed8', 0.55, 0.2], ['#b91c1c', 0.5, -0.15], ['#15803d', 0.45, 0.05]] as const
  let y = 0
  const pages = mat('#f5f0e1', { roughness: 0.95 })
  for (const [color, h, rot] of books) {
    const book = new THREE.Group()
    const cover = new THREE.Mesh(new THREE.BoxGeometry(2.3, h, 1.7), mat(color, { roughness: 0.6 }))
    const block = new THREE.Mesh(new THREE.BoxGeometry(2.2, h * 0.8, 1.62), pages)
    block.position.x = 0.07
    book.add(cover, block)
    book.position.set(mid.x, y + h / 2, mid.z)
    book.rotation.y = rot + 0.3
    book.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true))
    ctx.root.add(book)
    y += h
  }
  const sign = textSprite('Popsicle Ladder', { bg: '#a16207', size: 0.45 })
  sign.position.set(mid.x + 1.6, 2.3, mid.z)
  ctx.root.add(sign)
}

/** The slide: a tower of blocks with a pink plastic chute curling down to the row below. */
function buildSlide(ctx: LevelCtx) {
  const [tx, ty, tz] = slideTop()
  const blockCols = ['#f97316', '#22c55e', '#3b82f6']
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(1.25, 1.2, 1.25, 1, 0.06), mat(blockCols[i]))
    b.position.set(tx + 0.15, 0.6 + i * 1.2, tz + 0.05)
    b.rotation.y = i * 0.2
    b.castShadow = b.receiveShadow = true
    ctx.root.add(b)
  }
  const step = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.0, 0.9, 1, 0.06), mat(blockCols[2]))
  step.position.set(tx + 0.25, 0.5, tz + 1.05)
  step.castShadow = true
  ctx.root.add(step)
  const slideFrom = TILES.findIndex((t) => t.kind === 'slide')
  const to = TILES[TILES[slideFrom].to ?? 0]
  const pts = [new THREE.Vector3(tx, ty, tz), ...slideCurve().map(([x, y, z]) => new THREE.Vector3(x, y, z)), new THREE.Vector3(to.x, 0.05, to.z + 0.4)]
  const curve = new THREE.CatmullRomCurve3(pts)
  const S = 48, M = 9, R = 0.5
  const verts: number[] = []
  const idx: number[] = []
  const p = new THREE.Vector3(), tg = new THREE.Vector3(), lat = new THREE.Vector3(), upv = new THREE.Vector3()
  for (let i = 0; i <= S; i++) {
    const u = i / S
    curve.getPointAt(u, p)
    curve.getTangentAt(u, tg)
    lat.set(tg.z, 0, -tg.x).normalize()
    upv.crossVectors(tg, lat).normalize()
    if (upv.y < 0) upv.negate()
    for (let j = 0; j <= M; j++) {
      const a = -1.9 + (3.8 * j) / M
      verts.push(p.x + lat.x * Math.sin(a) * R + upv.x * R * (1 - Math.cos(a)), p.y - 0.04 + lat.y * Math.sin(a) * R + upv.y * R * (1 - Math.cos(a)), p.z + lat.z * Math.sin(a) * R + upv.z * R * (1 - Math.cos(a)))
      if (i < S && j < M) {
        const q = i * (M + 1) + j
        idx.push(q, q + M + 1, q + 1, q + 1, q + M + 1, q + M + 2)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const chute = new THREE.Mesh(geo, mat('#f472b6', { roughness: 0.35, side: THREE.DoubleSide }))
  chute.castShadow = true
  chute.receiveShadow = true
  ctx.root.add(chute)
  // Two little posts hold it up.
  for (const u of [0.35, 0.65]) {
    curve.getPointAt(u, p)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, p.y, 6), mat('#9d174d'))
    post.position.set(p.x, p.y / 2, p.z)
    ctx.root.add(post)
  }
  const sign = textSprite('Slide', { bg: '#be185d', size: 0.45 })
  sign.position.set(tx, ty + 1.9, tz)
  ctx.root.add(sign)
}

/** The open sock drawer the short way through the second fork runs along. */
function buildDrawer(ctx: LevelCtx) {
  const wood = mat('#8b5a33', { roughness: 0.7 })
  const x0 = 5.0, x1 = 11.4, z0 = 8.45, z1 = 10.7
  const walls: [number, number, number, number, number][] = [
    [(x0 + x1) / 2, z1, x1 - x0, 0.6, 0.14],
    [(x0 + x1) / 2, z0, x1 - x0, 0.35, 0.14],
    [x0, (z0 + z1) / 2, 0.14, 0.6, z1 - z0],
    [x1, (z0 + z1) / 2, 0.14, 0.6, z1 - z0],
  ]
  for (const [x, z, w, h, d] of walls) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood)
    m.position.set(x, h / 2, z)
    m.castShadow = m.receiveShadow = true
    ctx.root.add(m)
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat('#fbbf24', { metalness: 0.6, roughness: 0.3 }))
  knob.position.set((x0 + x1) / 2, 0.22, z0 - 0.12)
  ctx.root.add(knob)
  // Rolled-up socks in the corners.
  const sockCols = ['#f472b6', '#60a5fa', '#a3e635', '#fbbf24']
  ;[[x0 + 0.6, z1 - 0.5], [x1 - 0.6, z1 - 0.45], [x0 + 0.55, z0 + 0.5], [(x0 + x1) / 2 + 0.6, z1 - 0.45]].forEach(([x, z], i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat(sockCols[i], { roughness: 1 }))
    s.scale.set(1.25, 0.8, 1)
    s.position.set(x, 0.26, z)
    s.castShadow = true
    ctx.root.add(s)
  })
  const sign = textSprite('Sock Drawer', { bg: '#7c3aed', size: 0.45 })
  sign.position.set((x0 + x1) / 2, 1.5, z1)
  ctx.root.add(sign)
}

function buildJar(ctx: LevelCtx) {
  const g = new THREE.Group()
  // The goal plate: a lace doily.
  const { c, g: d } = canvas(256, 256)
  d.fillStyle = '#fffaf0'
  d.beginPath()
  d.arc(128, 128, 126, 0, Math.PI * 2)
  d.fill()
  d.strokeStyle = '#e7d8bd'
  d.lineWidth = 4
  for (let r = 30; r < 126; r += 18) {
    d.beginPath()
    d.arc(128, 128, r, 0, Math.PI * 2)
    d.stroke()
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    d.beginPath()
    d.arc(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112, 9, 0, Math.PI * 2)
    d.stroke()
  }
  drawIcon(d, 'goal', 128, 128, 120)
  const doily = new THREE.Mesh(new THREE.CircleGeometry(1.25, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.9, transparent: true }))
  doily.position.set(0, 0.03, 0)
  doily.receiveShadow = true
  g.add(doily)
  // The jar: a glass lathe, biscuits inside, a tin lid.
  const prof = [[0, 0], [1.05, 0], [1.18, 0.12], [1.22, 1.6], [1.1, 2.05], [0.85, 2.25], [0.85, 2.5], [0.92, 2.55]].map(([x, y]) => new THREE.Vector2(x, y))
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), new THREE.MeshStandardMaterial({ color: '#dbeafe', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }))
  const jar = new THREE.Group()
  jar.add(glass)
  const biscuit = discMaterial(ctx.assets, 'biscuit', '#d6a15a')
  const edge = mat('#c08a4a')
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.16, 18), [edge, biscuit, biscuit])
    b.position.set(Math.sin(i * 2.1) * 0.32, 0.12 + i * 0.22, Math.cos(i * 2.1) * 0.3)
    b.rotation.set(Math.sin(i) * 0.35, i, Math.cos(i * 1.3) * 0.3)
    jar.add(b)
  }
  const lidTop = discMaterial(ctx.assets, 'tinlid', '#c0c7d0')
  const lidSide = mat('#9aa3ad', { metalness: 0.8, roughness: 0.3 })
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.26, 28), [lidSide, lidTop, lidSide])
  lid.position.y = 2.66
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), lidSide)
  knob.position.y = 2.86
  jar.add(lid, knob)
  jar.position.set(0, 0, 1.9)
  jar.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  glass.castShadow = false
  g.add(jar)
  // Spilled biscuits by the plate.
  for (const [x, z, r] of [[-1.5, 0.6, 0.4], [1.6, 0.9, 1.4], [1.3, -0.9, 2.6]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16), [edge, biscuit, biscuit])
    b.position.set(x, 0.06, z)
    b.rotation.y = r
    g.add(b)
  }
  g.position.set(JAR.x, 0, JAR.z)
  ctx.root.add(g)
  const sign = textSprite('Cookie Jar', { bg: '#b45309', size: 0.7 })
  sign.position.set(JAR.x, 4.1, JAR.z + 1.9)
  ctx.root.add(sign)
  const start = TILES[0]
  const ss = textSprite('Start', { bg: '#15803d', size: 0.55 })
  ss.position.set(start.x - 0.2, 2.1, start.z)
  ctx.root.add(ss)
  // A soft glow under the jar.
  const glow = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.75, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false }))
  glow.position.set(JAR.x, 0.04, JAR.z)
  ctx.root.add(glow)
  return glow
}

/** Signposts at the forks, and the arrows that bob over the choices. */
function buildForks(ctx: LevelCtx): THREE.Group[] {
  const stick = mat('#e9c98b')
  const out: THREE.Group[] = []
  for (const f of FORKS) {
    const t = TILES[f.tile]
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.9, 0.06), stick)
    const px = t.x + Math.cos(t.yaw) * 1.05, pz = t.z - Math.sin(t.yaw) * 1.05
    post.position.set(px, 0.95, pz)
    post.castShadow = true
    ctx.root.add(post)
    t.next.forEach((n, k) => {
      const b = TILES[n]
      const board = new THREE.Group()
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.05), mat(k ? '#16a34a' : '#0ea5e9'))
      plank.position.x = 0.45
      board.add(plank)
      board.position.set(px, 1.6 - k * 0.32, pz)
      board.rotation.y = Math.atan2(b.x - px, b.z - pz) - Math.PI / 2
      ctx.root.add(board)
      // The bobbing choice arrow (shown while this fork is being decided).
      const arrow = new THREE.Group()
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: k ? '#4ade80' : '#38bdf8', toneMapped: false }))
      const num = textSprite(String(k + 1), { bg: k ? '#15803d' : '#0369a1', size: 0.55 })
      num.position.y = 0.75
      arrow.add(cone, num)
      arrow.position.set(b.x, 1.6, b.z)
      arrow.visible = false
      arrow.userData = { fork: f.tile, k }
      ctx.root.add(arrow)
      out.push(arrow)
    })
  }
  return out
}

function trapMesh() {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.55), mat('#c8a26b'))
  base.position.y = 0.06
  const wire = mat('#e5e7eb', { metalness: 0.9, roughness: 0.25 })
  const bar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 4, 12, Math.PI).rotateY(Math.PI / 2), wire)
  bar.position.set(0, 0.1, 0)
  bar.rotation.x = -0.25
  const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8).rotateZ(Math.PI / 2), wire)
  spring.position.set(0, 0.12, 0.05)
  const cheese = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 3, 1), mat('#facc15'))
  cheese.position.set(0.28, 0.16, 0)
  g.add(base, bar, spring, cheese)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  g.visible = false
  return g
}

function buildScenery(ctx: LevelCtx) {
  const high = ctx.quality === 'high'
  const place = (name: Parameters<typeof prop>[1], size: number, x: number, z: number, rot: number, by: 'height' | 'max' | 'width' = 'height') => {
    const o = prop(ctx.assets, name, size, by, high)
    o.position.set(x, 0, z)
    o.rotation.y = rot
    ctx.root.add(o)
    return o
  }
  const top = place('top', 1.7, -6.5, -6, 0.3)
  place('scissors', 2.6, 0.5, -6.2, 1.1, 'max')
  place('boxes', 5, 15.2, 13.2, -0.4)
  if (high) {
    place('horse', 3.4, -8.6, 9.6, 0.6)
    place('armchair', 6.2, -14.2, 12.4, 2.3)
  }
  return top
}

/** Everything static, plus the dice bodies (every screen builds them in the same order). */
export function buildBoard(ctx: LevelCtx): BoardView {
  buildCards(ctx)
  buildStitches(ctx)
  buildPond(ctx)
  buildLadder(ctx)
  buildSlide(ctx)
  buildDrawer(ctx)
  const jarGlow = buildJar(ctx)
  const forkArrows = buildForks(ctx)
  const top = buildScenery(ctx)

  // Foam dice.
  const dice: BoardView['dice'] = []
  const colors = ['#ef4444', '#2563eb']
  colors.forEach((base, k) => {
    const mats = DIE_FACES.map((v) => new THREE.MeshStandardMaterial({ map: dieFace(v, base), roughness: 0.95 }))
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 2, 0.16), mats)
    mesh.castShadow = true
    const obj = new THREE.Group()
    obj.add(mesh)
    obj.visible = false
    ctx.root.add(obj)
    const body = ctx.phys.dynamic({ x: k * 2, y: -20, z: 0 }, { damping: 0.25 })
    body.setAngularDamping(0.6)
    ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2).setDensity(0.22), { friction: 0.9, restitution: 0.35, groups: PROP_GROUPS })
    // Parked (kinematic) until the host throws it.
    body.setBodyType(ctx.RAPIER.RigidBodyType.KinematicPositionBased, true)
    ctx.syncProp(body, obj)
    dice.push({ body, obj, nums: [null, null, null, null, null, null, null], color: base })
  })

  const traps: THREE.Group[] = []
  for (let i = 0; i < 8; i++) {
    const t = trapMesh()
    ctx.root.add(t)
    traps.push(t)
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.12, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }))
  ring.position.y = 0.06
  ctx.root.add(ring)
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: '#fde047', toneMapped: false }))
  marker.scale.set(1, 1.5, 1)
  ctx.root.add(marker)
  return { dice, traps, ring, marker, forkArrows, jarGlow, top, overview: false, camT: 0 }
}

/** A number sprite over a settled die (cached per die and value). */
export function dieNumber(v: BoardView, k: number, value: number) {
  const d = v.dice[k]
  let s = d.nums[value]
  if (!s) {
    s = textSprite(String(value), { bg: d.color, size: 0.7 })
    s.visible = false
    d.obj.parent?.add(s)
    d.nums[value] = s
  }
  return s
}
