// Procedural props for the location circuits. Each returns one merged, vertex-coloured geometry (so a whole row of
// them is a single instanced draw) or adds a merged mesh to a group.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Give a geometry a flat vertex colour (and drop attributes others in a merge won't have). */
export function tint(geo: THREE.BufferGeometry, color: string | THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const c = new THREE.Color(color)
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(col, i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.deleteAttribute('uv')
  return g
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false)
  if (!g) throw new Error('merge failed')
  g.computeVertexNormals()
  return g
}

export const vcMat = (rough = 0.8, metal = 0.05, emissive?: string, intensity = 0) =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, emissive: emissive ?? '#000000', emissiveIntensity: intensity })

/** A tall, skinny fan palm (the boulevard kind): ringed trunk with a slight lean and a crown of drooping fronds. */
export function tallPalm(height = 20) {
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.22, 0.38, height, 7, 6).translate(0, height / 2, 0)
  // Lean: shear x by height.
  const p = trunk.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + (p.getY(i) / height) ** 2 * 1.2)
  parts.push(tint(trunk, '#7a6450'))
  const top = new THREE.Vector3(1.2, height, 0)
  parts.push(tint(new THREE.SphereGeometry(0.75, 7, 5).translate(top.x, top.y, top.z), '#5c4a34'))
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2
    const droop = 0.35 + (k % 3) * 0.18
    // A frond: a long thin leaf bent down in three segments.
    let x = top.x, y = top.y, z = top.z
    for (let s = 0; s < 3; s++) {
      const len = 2.1
      const pitch = droop + s * 0.42
      const dx = Math.cos(a) * Math.cos(pitch) * len, dz = Math.sin(a) * Math.cos(pitch) * len, dy = -Math.sin(pitch) * len + (s === 0 ? 1.1 : 0)
      const leaf = new THREE.BoxGeometry(len * 1.05, 0.06, 0.95 - s * 0.25)
      leaf.rotateZ(-Math.atan2(dy, Math.hypot(dx, dz)))
      leaf.rotateY(-a)
      leaf.translate(x + dx / 2, y + dy / 2, z + dz / 2)
      parts.push(tint(leaf, s === 2 ? '#56702e' : '#3f5f27'))
      x += dx
      y += dy
      z += dz
    }
  }
  return merge(parts)
}

/** A semicircular (or pointed) stone arch over a road of width `span`: two piers, the arch ring and a parapet. */
export function archGeometry(span: number, rise: number, pier = 1.6, depth = 2.4, pointed = false, ribOnly = false) {
  const parts: THREE.BufferGeometry[] = []
  const h = rise
  if (!ribOnly) for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(pier, h, depth).translate(s * (span / 2 + pier / 2), h / 2, 0))
  // Arch ring: voussoir blocks around a half circle (or two arcs meeting at a point).
  const r = span / 2 + pier / 2
  const n = 14
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI, a1 = ((k + 1) / n) * Math.PI, am = (a0 + a1) / 2
    const pointedLift = pointed ? Math.sin(am) ** 3 * r * 0.35 : 0
    const cx = Math.cos(am) * r, cy = h + Math.sin(am) * r * (pointed ? 1.1 : 0.85) + pointedLift
    const blk = new THREE.BoxGeometry(pier, (Math.PI * r) / n + 0.15, depth)
    blk.rotateZ(am - Math.PI / 2 + Math.PI / 2)
    blk.translate(cx, cy, 0)
    parts.push(blk)
  }
  if (ribOnly) {
    const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!
    g.computeVertexNormals()
    return g
  }
  // Spandrels and the parapet on top.
  const topY = h + r * (pointed ? 1.45 : 0.85) + pier * 0.6
  parts.push(new THREE.BoxGeometry(span + pier * 2, pier * 0.9, depth).translate(0, topY, 0))
  for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(r * 0.55, topY - h, depth * 0.96).translate(s * (span / 2 + pier * 0.2), h + (topY - h) / 2, 0))
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!
  g.computeVertexNormals()
  // World-ish UVs from position (stone texture tiles by metres).
  const pos = g.attributes.position as THREE.BufferAttribute
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) uv.set([(pos.getX(i) + pos.getZ(i)) / 3, pos.getY(i) / 3], i * 2)
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** Lattice electricity pylon. */
export function pylonGeometry(height = 38) {
  const parts: THREE.BufferGeometry[] = []
  const leg = (x: number, z: number) => {
    const g = new THREE.CylinderGeometry(0.18, 0.25, height, 4).translate(0, height / 2, 0)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const k = 1 - (p.getY(i) / height) * 0.82
      p.setX(i, p.getX(i) + x * k)
      p.setZ(i, p.getZ(i) + z * k)
    }
    return g
  }
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) parts.push(leg(x, z))
  for (let y = 4; y < height; y += 5) {
    const w = 6 * (1 - (y / height) * 0.82) + 0.4
    for (const r of [0, Math.PI / 2]) parts.push(new THREE.BoxGeometry(w, 0.15, 0.15).rotateY(r).translate(0, y, r ? 0 : 0))
    parts.push(new THREE.BoxGeometry(w * 1.3, 0.12, 0.12).rotateZ(0.7).translate(0, y + 2.4, w / 2))
    parts.push(new THREE.BoxGeometry(w * 1.3, 0.12, 0.12).rotateZ(-0.7).translate(0, y + 2.4, -w / 2))
  }
  for (const [y, w] of [[height * 0.72, 16], [height * 0.86, 12], [height - 1, 8]]) parts.push(new THREE.BoxGeometry(w, 0.5, 0.6).translate(0, y, 0))
  return merge(parts.map((p) => tint(p, '#8a8f96')))
}

/** Victorian seafront lamp: fluted post, scrolled cross-arm and two lanterns. Returns [post, lanterns]. */
export function victorianLamp(postColor: string) {
  const post = merge([
    tint(new THREE.CylinderGeometry(0.32, 0.42, 0.9, 10).translate(0, 0.45, 0), postColor),
    tint(new THREE.CylinderGeometry(0.1, 0.16, 5.2, 8).translate(0, 3.3, 0), postColor),
    tint(new THREE.TorusGeometry(0.22, 0.05, 6, 10).translate(0, 4.6, 0), postColor),
    tint(new THREE.BoxGeometry(2.0, 0.09, 0.09).translate(0, 5.6, 0), postColor),
    tint(new THREE.SphereGeometry(0.16, 8, 6).translate(0, 6.0, 0), postColor),
    tint(new THREE.ConeGeometry(0.28, 0.35, 6).translate(-0.95, 6.15, 0), postColor),
    tint(new THREE.ConeGeometry(0.28, 0.35, 6).translate(0.95, 6.15, 0), postColor),
  ])
  const lanterns = merge([
    tint(new THREE.CylinderGeometry(0.2, 0.14, 0.5, 6).translate(-0.95, 5.75, 0), '#ffe6b0'),
    tint(new THREE.CylinderGeometry(0.2, 0.14, 0.5, 6).translate(0.95, 5.75, 0), '#ffe6b0'),
  ])
  return [post, lanterns]
}

/** Old-town lantern on a black post. Returns [post, lantern]. */
export function lanternPost(height = 4.6) {
  const post = merge([
    tint(new THREE.CylinderGeometry(0.09, 0.16, height, 6).translate(0, height / 2, 0), '#1b1a1a'),
    tint(new THREE.ConeGeometry(0.34, 0.4, 4).rotateY(Math.PI / 4).translate(0, height + 0.95, 0), '#1b1a1a'),
  ])
  const lantern = tint(new THREE.CylinderGeometry(0.26, 0.18, 0.7, 4).rotateY(Math.PI / 4).translate(0, height + 0.4, 0), '#ffd28a')
  return [post, merge([lantern])]
}

/** A chain-link fence (posts and a see-through mesh) along a polyline of [x, y, z] points. */
export function fence(pts: [number, number, number][], height: number, mesh: THREE.Texture, postColor = '#8f959b') {
  const g = new THREE.Group()
  const pos: number[] = [], uv: number[] = []
  let u = 0
  const posts: THREE.Matrix4[] = []
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay, az] = pts[k], [bx, by, bz] = pts[k + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const u1 = u + len / 1.2
    pos.push(ax, ay, az, bx, by, bz, ax, ay + height, az, bx, by, bz, bx, by + height, bz, ax, ay + height, az)
    uv.push(u, 0, u1, 0, u, height / 1.2, u1, 0, u1, height / 1.2, u, height / 1.2)
    u = u1
    posts.push(new THREE.Matrix4().makeTranslation(ax, ay, az))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: mesh, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6, color: '#d9dde2' }))
  g.add(m)
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, height + 0.2, 5).translate(0, (height + 0.2) / 2, 0), new THREE.MeshStandardMaterial({ color: postColor, metalness: 0.6, roughness: 0.5 }), posts.length)
  posts.forEach((mm, i) => pm.setMatrixAt(i, mm))
  g.add(pm)
  return g
}

/** World-space uvs (metres / scale) for a merged geometry, for tiling textures over boxes. */
export function worldUv(g: THREE.BufferGeometry, scale: number) {
  const pos = g.attributes.position as THREE.BufferAttribute
  const nrm = g.attributes.normal as THREE.BufferAttribute
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i))
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    if (ny > 0.7) uv.set([x / scale, z / scale], i * 2)
    else if (nx > 0.5) uv.set([z / scale, y / scale], i * 2)
    else uv.set([x / scale, y / scale], i * 2)
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** A cobra-head street light: tapered pole, long arm over the road, a lamp head. Returns [pole, lamp]. Faces +z. */
export function streetLight(height = 9) {
  const pole = merge([
    tint(new THREE.CylinderGeometry(0.12, 0.2, height, 7).translate(0, height / 2, 0), '#8a8d90'),
    tint(new THREE.BoxGeometry(0.12, 0.12, 3.2).rotateX(-0.12).translate(0, height + 0.1, 1.55), '#8a8d90'),
    tint(new THREE.BoxGeometry(0.5, 0.22, 1.1).translate(0, height + 0.25, 3.2), '#7b7e82'),
  ])
  const lamp = merge([tint(new THREE.BoxGeometry(0.4, 0.06, 0.9).translate(0, height + 0.12, 3.2), '#fff1d0')])
  return [pole, lamp]
}
