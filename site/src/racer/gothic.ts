// Gothic Quarter: an old town on a hill above the sea in Mediterranean evening light. Tight cobbled streets lined
// with tall shuttered houses, pointed stone arches, a cathedral with tall spires on the plaza at the top (an original
// design), an arched alley short cut, then down to a wide seafront boulevard with palms, the beach and a marina.
import * as THREE from 'three'
import { facadeMat, unitBox, type Kit } from './circuits'
import { cobbleTexture, facadeTexture, pavingTexture, roseTexture, stoneTexture, tarmacTexture } from './paint'
import { archGeometry, lanternPost, merge, tallPalm, tint, vcMat, worldUv } from './props3d'

const SEA_Z = 640 // the shoreline (beach below the boulevard)
const CATHEDRAL = [183, 30] // on the plaza at the top of the hill, facing south

const hill = (z: number) => 1 + 17 * (1 - THREE.MathUtils.smoothstep(z, 140, 560)) + Math.max(0, -z) * 0.06

export function buildGothic(kit: Kit) {
  const t = kit.track
  const rnd = kit.rnd
  const stone = stoneTexture()

  kit.ground({
    base: (_x, z) => (z > 600 ? THREE.MathUtils.lerp(1, -3.2, THREE.MathUtils.smoothstep(z, 615, 705)) : hill(z)),
    color: (x, z, y, d, _h, out) => {
      const n = Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * 0.5 + 0.5
      if (z > 612 && y < 1.2) out.set(y < -0.4 ? '#a58f6c' : '#dcc59c').multiplyScalar(0.95 + n * 0.08)
      else if (z > 555) out.set('#cbbfa9')
      else if (d > 140 && z < -40) out.set('#7f7c56').lerp(new THREE.Color('#6a6a45'), n)
      else out.set('#ab9d88').multiplyScalar(0.92 + n * 0.1)
    },
    detail: pavingTexture(205),
    detailScale: 4,
  })

  // The sea, with a low sun on it.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 3200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#2d5873', roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 }),
  )
  sea.position.set(0, -0.7, SEA_Z + 1650)
  kit.group.add(sea)

  // Road: cobbles in the old town, asphalt with lines on the boulevard.
  kit.road({
    map: cobbleTexture(), scale: 4, color: '#c3b6a4', roughness: 0.7,
    alt: { map: tarmacTexture(), scale: 6, color: '#8d8b8a', below: 2.6, linesOnly: true },
    edgeLine: [0.95, 0.95, 0.92], centre: 'dash', centreColor: [0.95, 0.95, 0.92], kerb: [0.75, 0.15, 0.12], glow: [0.2, 0.13, 0.05],
  })
  kit.gantry('#facc15')

  // Barriers: a stone balustrade on the sea side of the boulevard, stone kerbs elsewhere (the houses are the walls).
  const stoneMat = new THREE.MeshStandardMaterial({ map: stone, color: '#e8dccb', roughness: 0.9 })
  const kerbMat = new THREE.MeshStandardMaterial({ color: '#cfc3b0', roughness: 0.85 })
  kit.barriers((e) => ((e.ay + e.by) / 2 < 2.4 && e.road < 0 && e.nz > 0.5 ? 'stone' : 'kerb'), { stone: stoneMat, kerb: kerbMat })
  // Iron bollards with brass caps in the old town; chevrons only out on the boulevard.
  kit.roadside({ post: '#1d1b1a', reflector: '#c9a45a', step: 8, bollard: true, chevrons: (s) => t.heightAtS(s) < 2.6 })

  houses(kit)
  arches(kit, stone)
  cathedral(kit, stone)

  // Seafront: palms both sides of the boulevard, lanterns all round.
  const palms: number[][] = []
  kit.along(22, 3.5, (x, y, z, yaw, s) => {
    if (t.heightAtS(s) < 2.4) palms.push([x, y, z, yaw + rnd() * 6, 0.9 + rnd() * 0.35])
  }, { clear: 2 })
  if (!kit.propInstances('palm', { height: 10 }, palms)) kit.instances(tallPalm(12), vcMat(0.85), palms.map(([x, y, z, yaw]) => [x, y, z, yaw]))
  const lamps: number[][] = []
  kit.along(32, 1.0, (x, y, z, yaw, s, side) => {
    if (t.heightAtS(s) < 2.4 || (Math.round(s / 32) % 2 ? 1 : -1) === side) lamps.push([x, y, z, yaw])
  }, { clear: 0.5 })
  const [post, lantern] = lanternPost()
  kit.instances(post, vcMat(0.6, 0.4), lamps)
  kit.instances(lantern, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.4, 2.1, 1.6), toneMapped: false }), lamps)

  marina(kit)
  landmarks(kit)
  return null
}

/** Tall shuttered houses tight along the old-town streets and the alley; apartment blocks behind the boulevard. */
function houses(kit: Kit) {
  const t = kit.track
  const rnd = kit.rnd
  const rows: number[][][] = [[], [], []]
  const place = (x: number, y: number, z: number, yaw: number, off: number, w: number, d: number, h: number, kind: number) => {
    const cx = x - Math.sin(yaw) * (off + d / 2), cz = z - Math.cos(yaw) * (off + d / 2)
    // Keep the cathedral's side of the plaza open.
    if (Math.hypot(cx - CATHEDRAL[0], cz - CATHEDRAL[1]) < 78 && cz < CATHEDRAL[1] + 70) return
    if (!kit.fits(cx, cz, yaw, w, d, 0.9)) return
    rows[kind].push([cx, y - 4, cz, yaw, w, h + 4, d])
  }
  kit.along(12.5, 0, (x, y, z, yaw, s) => {
    if (t.heightAtS(s) < 2.6) return
    place(x, y, z, yaw, 2.2, 12 + rnd() * 2, 14, 15 + rnd() * 9, rnd() < 0.5 ? 0 : 1)
  }, { clear: -1 })
  kit.alongBranches(12.5, 0, (x, y, z, yaw) => place(x, y, z, yaw, 1.6, 12 + rnd() * 2, 13, 16 + rnd() * 8, rnd() < 0.5 ? 0 : 1), -1)
  // Boulevard: bigger blocks set back on the landward side only.
  kit.along(30, 0, (x, y, z, yaw, s) => {
    if (t.heightAtS(s) >= 2.6 || Math.cos(yaw) < 0.3) return
    place(x, y, z, yaw, 13, 26 + rnd() * 6, 22, 20 + rnd() * 10, 2)
  }, { clear: -1 })
  const roofs = '#8a5a44'
  const mats = [
    facadeMat(facadeTexture('ochre', 11), { tileW: 16, tileH: 14, roof: roofs, glow: 0.7 }),
    facadeMat(facadeTexture('stucco', 12), { tileW: 16, tileH: 14, roof: roofs, glow: 0.7 }),
    facadeMat(facadeTexture('stucco', 13), { tileW: 16, tileH: 14, roof: '#9a8f80', glow: 0.6 }),
  ]
  rows.forEach((list, k) => kit.instances(unitBox(), mats[k], list))
  // Terracotta roof ridges and chimneys on the old houses.
  const tops = [...rows[0], ...rows[1]]
  const ridge = merge([tint(new THREE.CylinderGeometry(0, 0.5, 1, 4, 1).rotateY(Math.PI / 4).scale(1.42, 1, 1.42).translate(0, 0.5, 0), '#a5583c')])
  kit.instances(ridge, vcMat(0.9), tops.map(([x, y, z, yaw, w, h, d]) => [x, y + h, z, yaw, w, 2.6, d]))
}

/** Pointed stone arches over the old-town streets and the alley, and an enclosed bridge between houses over the alley. */
function arches(kit: Kit, stone: THREE.Texture) {
  const t = kit.track
  const parts: THREE.BufferGeometry[] = []
  const put = (x: number, y: number, z: number, yaw: number, span: number) => {
    const g = archGeometry(span, 6.5, 1.5, 3.2, true)
    g.rotateY(yaw)
    g.translate(x, y, z)
    parts.push(g)
  }
  let last = -1e9
  for (let s = 0; s < t.length; s += 10) {
    const i = t.index(s)
    if (t.py[i] < 4 || t.curv[i] > 0.008 || s - last < 150) continue
    last = s
    const p = t.point(s)
    put(p.x, t.py[i] - 0.2, p.z, Math.atan2(t.tx[i], t.tz[i]), t.hw[i] * 2 + 1.6)
  }
  for (const b of t.branches) {
    for (const f of [0.35, 0.7]) {
      const k = Math.round(f * (b.n - 1))
      put(b.px[k], b.h[k] - 0.2, b.pz[k], Math.atan2(b.tx[k], b.tz[k]), b.half * 2 + 1.4)
    }
    // An enclosed gothic bridge between the houses, high over the alley.
    const k = Math.round(0.52 * (b.n - 1))
    const g = new THREE.BoxGeometry(b.half * 2 + 6, 6, 4.5).translate(0, 12, 0)
    const base = new THREE.BoxGeometry(b.half * 2 + 6, 0.8, 5.2).translate(0, 8.6, 0)
    for (const q of [g, base]) {
      q.rotateY(Math.atan2(b.tx[k], b.tz[k]))
      q.translate(b.px[k], b.h[k], b.pz[k])
      parts.push(q.toNonIndexed())
    }
  }
  if (!parts.length) return
  const geo = merge(parts.map((p) => (p.deleteAttribute('uv'), p.index ? p.toNonIndexed() : p)))
  kit.group.add(new THREE.Mesh(worldUv(geo, 3), new THREE.MeshStandardMaterial({ map: stone, color: '#f0e2cc', roughness: 0.9 })))
}

/**
 * The cathedral on the plaza at the top of the hill: a nave with a steep roof and side aisles, flying buttresses
 * with pinnacles, two front towers with open spires, a tall spire over the crossing and a rose window. Floodlit.
 */
function cathedral(kit: Kit, stone: THREE.Texture) {
  const [cx, cz] = CATHEDRAL
  const y0 = kit.heightAt(cx, cz + 40) - 0.5
  const parts: THREE.BufferGeometry[] = []
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => parts.push(new THREE.BoxGeometry(w, h, d).translate(cx + x, y0 + y, cz + z).toNonIndexed())
  const cone = (r: number, h: number, x: number, y: number, z: number, sides = 8) => parts.push(new THREE.ConeGeometry(r, h, sides).translate(cx + x, y0 + y + h / 2, cz + z).toNonIndexed())
  // Nave, aisles, apse.
  box(28, 30, 80, 0, 15, 0)
  for (const s of [-1, 1]) box(10, 17, 70, s * 19, 8.5, 2)
  parts.push(new THREE.CylinderGeometry(14, 14, 30, 12, 1, false, Math.PI / 2, Math.PI).translate(cx, y0 + 15, cz - 40).toNonIndexed())
  // Steep roof: a prism.
  const roof = new THREE.CylinderGeometry(0.01, 15.5, 16, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 5.2).translate(cx, y0 + 38, cz)
  parts.push(roof.toNonIndexed())
  // Flying buttresses and pinnacles along both sides.
  for (let z = -30; z <= 34; z += 10) {
    for (const s of [-1, 1]) {
      box(2.2, 24, 3, s * 27, 12, z)
      const fly = new THREE.BoxGeometry(12, 1.2, 1.6).rotateZ(s * -0.55).translate(cx + s * 20, y0 + 25, cz + z)
      parts.push(fly.toNonIndexed())
      cone(1.3, 7, s * 27, 24, z, 4)
    }
  }
  // Front towers with spires and corner pinnacles.
  for (const s of [-1, 1]) {
    box(12, 50, 12, s * 16, 25, 42)
    box(9, 8, 9, s * 16, 54, 42)
    cone(6.2, 40, s * 16, 58, 42)
    for (const a of [-1, 1]) for (const b of [-1, 1]) cone(0.9, 9, s * 16 + a * 5.2, 50, 42 + b * 5.2, 4)
  }
  // Crossing: an octagonal drum and the tallest spire.
  parts.push(new THREE.CylinderGeometry(7, 7, 14, 8).translate(cx, y0 + 45, cz - 12).toNonIndexed())
  cone(6.5, 58, 0, 52, -12)
  // Front gable.
  parts.push(new THREE.CylinderGeometry(0.01, 15, 14, 3, 1).rotateZ(0).scale(1, 1, 0.12).translate(cx, y0 + 37, cz + 40).toNonIndexed())
  const geo = merge(parts.map((p) => (p.deleteAttribute('uv'), p)))
  const mat = new THREE.MeshStandardMaterial({ map: stone, color: '#f2dfc2', roughness: 0.85, emissive: '#5a3c1e', emissiveIntensity: 0.35 })
  kit.group.add(new THREE.Mesh(worldUv(geo, 3), mat))
  // Rose window, portal and lancet windows.
  const rose = new THREE.Mesh(new THREE.CircleGeometry(6.5, 32), new THREE.MeshBasicMaterial({ map: roseTexture(), transparent: true, color: new THREE.Color(1.5, 1.4, 1.3), toneMapped: false }))
  rose.position.set(cx, y0 + 26, cz + 40.1)
  kit.group.add(rose)
  const dark = new THREE.MeshStandardMaterial({ color: '#2b1e18', roughness: 1 })
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(7, 12), dark)
  portal.position.set(cx, y0 + 6, cz + 40.1)
  kit.group.add(portal)
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color('#6d5bd0').multiplyScalar(0.9), toneMapped: false })
  const lancets: number[][] = []
  for (let z = -25; z <= 30; z += 10) for (const s of [-1, 1]) lancets.push([cx + s * 24.1, y0 + 9, cz + z + 5, s * Math.PI / 2, 2.2, 8, 1])
  kit.instances(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), glass, lancets)
  // Floodlight on the facade.
  const flood = new THREE.SpotLight('#ffd6a0', 6000, 140, 0.6, 0.6, 2)
  flood.position.set(cx, y0 + 4, cz + 95)
  flood.target.position.set(cx, y0 + 40, cz + 30)
  kit.group.add(flood, flood.target)
}

/** Boats in the marina off the west end of the boulevard. */
function marina(kit: Kit) {
  const rnd = kit.rnd
  const hulls: number[][] = []
  const masts: number[][] = []
  for (let k = 0; k < 26; k++) {
    const x = -420 + (k % 13) * 16 + rnd() * 4, z = 712 + Math.floor(k / 13) * 30 + rnd() * 4
    hulls.push([x, -0.7, z, Math.PI / 2 + (rnd() - 0.5) * 0.1, 3.6, 1.6, 11])
    masts.push([x, 0.6, z, 0, 0.18, 12 + rnd() * 6, 0.18])
  }
  kit.instances(new THREE.CylinderGeometry(0.5, 0.35, 1, 8).scale(1, 1, 1).translate(0, 0.5, 0).rotateX(0), new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.4 }), hulls)
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ color: '#d8d8d8', metalness: 0.6, roughness: 0.3 }), masts)
  // The breakwater.
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ color: '#8f857a', roughness: 1 }), [[-330, -2, 790, 0, 260, 3.4, 8]])
}

/** A sail-shaped glass hotel at the end of the beach and a wooded hill with a temple and a mast to the north. */
function landmarks(kit: Kit) {
  const sail = new THREE.Mesh(
    new THREE.CylinderGeometry(60, 60, 100, 24, 1, true, -0.55, 1.1).translate(0, 50, 0),
    facadeMat(facadeTexture('glass', 21), { tileW: 14, tileH: 12, roof: '#334', glow: 0.5, rough: 0.2, metal: 0.6 }),
  )
  ;(sail.material as THREE.Material).side = THREE.DoubleSide
  sail.position.set(640, -3, 640)
  sail.rotation.y = -0.6
  kit.group.add(sail)
  // The hill.
  const g = new THREE.IcosahedronGeometry(1, 4)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const j = 1 + Math.sin(x * 5 + z * 3) * 0.05 + Math.sin(z * 7) * 0.04
    p.setXYZ(i, x * 560 * j, Math.max(0, y) * 210 * j - 6, z * 380 * j)
  }
  g.computeVertexNormals()
  const hillMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#5f6a44', roughness: 1, flatShading: true }))
  hillMesh.position.set(80, 20, -1050)
  kit.group.add(hillMesh)
  const top = 20 + 210 - 6
  const temple = merge([
    tint(new THREE.BoxGeometry(26, 18, 40).translate(0, 9, 0), '#efe6d6'),
    tint(new THREE.CylinderGeometry(8, 8, 10, 12).translate(0, 23, -6), '#efe6d6'),
    tint(new THREE.SphereGeometry(8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 28, -6), '#c9c1b0'),
    tint(new THREE.CylinderGeometry(0.4, 1.4, 26, 6).translate(0, 44, -6), '#efe6d6'),
    tint(new THREE.CylinderGeometry(0.6, 2.4, 70, 4).translate(60, 35, 30), '#d9d9d9'),
  ])
  const tm = new THREE.Mesh(temple, vcMat(0.8, 0, '#3a2a1a', 0.4))
  tm.position.set(80, top, -1050)
  kit.group.add(tm)
}
