// Building blocks for the Loft's corners: a batcher that merges primitives into one vertex-coloured mesh per
// material (a handful of draw calls per zone however many pieces), cached canvas textures and materials that
// survive Loft rebuilds (marked userData.keep), and small transform helpers. Warm, flat-shaded, toy-like.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

/** A transform from position, euler rotation and scale. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz))
}

/* ---------- Cached materials and textures ---------- */

const mats = new Map<string, THREE.Material>()
export function keepMat<M extends THREE.Material>(key: string, make: () => M): M {
  let m = mats.get(key) as M | undefined
  if (!m) {
    m = make()
    m.userData.keep = true
    mats.set(key, m)
  }
  return m
}

/** The shared vertex-colour materials the batcher uses. */
export const MAT = {
  matte: () => keepMat('l:matte', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true })),
  gloss: () => keepMat('l:gloss', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, flatShading: true })),
  metal: () => keepMat('l:metal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8, flatShading: true })),
  glow: () => keepMat('l:glow', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })),
}
export type MatKind = keyof typeof MAT

const texs = new Map<string, THREE.CanvasTexture>()
/** A canvas texture drawn once and kept for the session. */
export function ctex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  let t = texs.get(key)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...repeat)
  }
  texs.set(key, t)
  return t
}

/** A textured, flat-shaded material, kept for the session. */
export function tmat(key: string, map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) {
  return keepMat(`l:tex:${key}`, () => new THREE.MeshStandardMaterial({ map, roughness: 0.8, flatShading: true, ...extra }))
}

/* ---------- Batching ---------- */

interface Piece {
  g: THREE.BufferGeometry
  color: THREE.ColorRepresentation
  m: THREE.Matrix4
}

/**
 * Collect primitives (with a colour and a transform) and emit one merged mesh per material kind. Geometry is
 * cloned, so shared source geometries are fine. `flush` may be keyed to reuse the merged geometry across Loft
 * rebuilds (the layout is fixed).
 */
export class Batch {
  private parts = new Map<string, Piece[]>()
  private custom = new Map<string, THREE.Material>()

  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4, kind: MatKind = 'matte') {
    let list = this.parts.get(kind)
    if (!list) this.parts.set(kind, (list = []))
    list.push({ g, color, m })
    return this
  }

  /** A piece with its own material (textured): batched with others sharing the same material. */
  addMat(g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, key: string) {
    this.custom.set(`c:${key}`, mat)
    let list = this.parts.get(`c:${key}`)
    if (!list) this.parts.set(`c:${key}`, (list = []))
    list.push({ g, color: '#ffffff', m })
    return this
  }

  get size() {
    let n = 0
    for (const l of this.parts.values()) n += l.length
    return n
  }

  flush(parent: THREE.Object3D, opts: { shadows?: boolean; receive?: boolean; key?: string } = {}) {
    const out: THREE.Mesh[] = []
    for (const [kind, list] of this.parts) {
      const ck = opts.key ? `${opts.key}:${kind}` : ''
      let geo = ck ? merged.get(ck) : undefined
      if (!geo) {
        geo = mergePieces(list, kind.startsWith('c:') ? null : 1)
        if (ck) {
          geo.userData.keep = true
          merged.set(ck, geo)
        }
      }
      const mat = kind.startsWith('c:') ? this.custom.get(kind)! : MAT[kind as MatKind]()
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = opts.shadows ?? true
      mesh.receiveShadow = opts.receive ?? true
      parent.add(mesh)
      out.push(mesh)
    }
    this.parts.clear()
    return out
  }
}

const merged = new Map<string, THREE.BufferGeometry>()

function mergePieces(list: Piece[], colors: 1 | null) {
  const anyFlat = list.some((p) => !p.g.index)
  const geos = list.map((p) => {
    let g = p.g.clone()
    g.applyMatrix4(p.m)
    if (anyFlat && g.index) g = g.toNonIndexed()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (colors) {
      const n = g.attributes.position.count
      const col = new Float32Array(n * 3)
      _c.set(p.color)
      for (let i = 0; i < n; i++) {
        col[i * 3] = _c.r
        col[i * 3 + 1] = _c.g
        col[i * 3 + 2] = _c.b
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    }
    g.clearGroups()
    return g
  })
  const out = mergeGeometries(geos, false)!
  for (const g of geos) g.dispose()
  return out
}

/* ---------- Shared primitive geometries (sources for batching, never rendered directly) ---------- */

export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cyl24: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: new THREE.ConeGeometry(0.5, 1, 10),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  ico: new THREE.IcosahedronGeometry(0.5, 1),
  torus: new THREE.TorusGeometry(0.5, 0.1, 6, 18),
  plane: new THREE.PlaneGeometry(1, 1),
}

/** A soft round glow sprite texture (bulbs, light pools). */
export function glowTex() {
  return ctex('glow', 64, 64, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    grad.addColorStop(0, 'rgba(255,240,210,1)')
    grad.addColorStop(0.35, 'rgba(255,214,150,0.45)')
    grad.addColorStop(1, 'rgba(255,200,140,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
  })
}

/** Rounded rectangle path on a 2D canvas. */
export function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}
