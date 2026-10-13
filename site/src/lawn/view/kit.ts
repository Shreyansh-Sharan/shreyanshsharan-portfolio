// Geometry helpers for the house builders: world-space planar UVs (metres, so tiling surfaces line up across
// panels), and a Kit that collects boxes and shapes per material in a local frame and merges them into one mesh
// per material (a wall panel with its trims, shutters and casings is a handful of draw calls, not dozens).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** World-space planar UVs (metres) for a mesh whose vertices are offset by `at` from world space. */
export function worldUV(geo: THREE.BufferGeometry, at: THREE.Vector3) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + at.x
    const y = pos.getY(i) + at.y
    const z = pos.getZ(i) + at.z
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    const nz = Math.abs(nor.getZ(i))
    if (ny > nx && ny > nz) {
      uv[i * 2] = x
      uv[i * 2 + 1] = z
    } else if (nx > nz) {
      uv[i * 2] = z
      uv[i * 2 + 1] = y
    } else {
      uv[i * 2] = x
      uv[i * 2 + 1] = y
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

/** Non-indexed copy of part of an indexed geometry (one face group of a box). */
function subGeometry(g: THREE.BufferGeometry, start: number, count: number) {
  const out = new THREE.BufferGeometry()
  const index = g.index!
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined
    if (!a) continue
    const arr = new Float32Array(count * a.itemSize)
    for (let i = 0; i < count; i++) {
      const v = index.getX(start + i)
      for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(v, k)
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
  }
  return out
}

/** A flat polygon (counter-clockwise seen from its front) as a triangle fan with a flat normal. */
export function polygon(points: THREE.Vector3[], uvs?: [number, number][]) {
  const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(points[1], points[0]), new THREE.Vector3().subVectors(points[2], points[0])).normalize()
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  for (let i = 1; i < points.length - 1; i++)
    for (const k of [0, i, i + 1]) {
      const p = points[k]
      pos.push(p.x, p.y, p.z)
      nor.push(n.x, n.y, n.z)
      const t = uvs?.[k] ?? [0, 0]
      uv.push(t[0], t[1])
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  return g
}

/** Materials in box face order: +x, -x, +y, -y, +z, -z (null leaves the face out). */
export type FaceMats = (THREE.Material | null)[]

export class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>()
  private extra: THREE.Object3D[] = []
  /** Kit space to the group the kit is built into. */
  readonly m: THREE.Matrix4
  /** World position of that group (for world UVs). */
  readonly origin: THREE.Vector3
  readonly shadows: boolean

  constructor(m: THREE.Matrix4, origin: THREE.Vector3, shadows: boolean) {
    this.m = m
    this.origin = origin
    this.shadows = shadows
  }

  static at(yaw: number, origin: THREE.Vector3, shadows: boolean) {
    return new Kit(new THREE.Matrix4().makeRotationY(yaw), origin, shadows)
  }

  /** An axis-aligned box in kit space. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material | FaceMats) {
    const g = new THREE.BoxGeometry(Math.max(0.002, x1 - x0), Math.max(0.002, y1 - y0), Math.max(0.002, z1 - z0))
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    this.geo(g, mat)
  }

  /** A box turned about its own centre (kit space), e.g. a sloped rafter or a hip cap. */
  orientedBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, q: THREE.Quaternion, mat: THREE.Material) {
    const g = new THREE.BoxGeometry(sx, sy, sz)
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1)))
    this.geo(g, mat)
  }

  /** Any geometry in kit space; `keepUV` keeps its own UVs instead of world planar ones. */
  geo(g: THREE.BufferGeometry, mat: THREE.Material | FaceMats, keepUV = false) {
    g.applyMatrix4(this.m)
    if (!keepUV || !g.attributes.uv) worldUV(g, this.origin)
    if (Array.isArray(mat)) {
      for (const grp of g.groups) {
        const fm = mat[grp.materialIndex ?? 0]
        if (fm) this.push(fm, subGeometry(g, grp.start, grp.count))
      }
      return
    }
    this.push(mat, g.index ? g.toNonIndexed() : g)
  }

  /** A ready-made object (kit models) placed in kit space. */
  add(o: THREE.Object3D) {
    o.applyMatrix4(this.m)
    this.extra.push(o)
  }

  private push(mat: THREE.Material, g: THREE.BufferGeometry) {
    if (g.attributes.uv === undefined) worldUV(g, this.origin)
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    let list = this.parts.get(mat)
    if (!list) this.parts.set(mat, (list = []))
    list.push(g)
  }

  /** Merge into one mesh per material. */
  build(into = new THREE.Group()) {
    for (const [mat, list] of this.parts) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list, false)
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, mat)
      const glassy = (mat as THREE.MeshStandardMaterial).transparent
      mesh.castShadow = this.shadows && !glassy && !mat.userData.noShadow
      mesh.receiveShadow = !mat.userData.noReceive
      into.add(mesh)
    }
    for (const o of this.extra) into.add(o)
    this.parts.clear()
    this.extra = []
    return into
  }
}
