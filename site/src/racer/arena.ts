// Dust Bowl: a circular, banked desert arena for Deathmatch. The layout (obstacles, spawn points, pickups), the
// bowl's collision helpers, and its scenery and lighting. Everything is generated in code from fixed numbers, so
// the host and every client build the same bowl.
import * as THREE from 'three'
import { CONFIG } from './config'
import { normalizeModel, type RacerAssets } from './assets'
import { radialTexture } from './cars'
import { mulberry32 } from './track'

export type ObstacleKind = 'mesa' | 'pillar' | 'wreck' | 'barrels'

export interface Obstacle {
  x: number
  z: number
  r: number // collision radius, m
  kind: ObstacleKind
  yaw: number
}

export interface ArenaSpawn {
  x: number
  z: number
  yaw: number
}

export interface ArenaLayout {
  radius: number // rim wall
  floor: number // flat floor; the bank rises from here to the rim
  obstacles: Obstacle[]
  spawns: ArenaSpawn[]
  pickups: { x: number; z: number }[]
}

const polar = (r: number, deg: number) => {
  const a = THREE.MathUtils.degToRad(deg)
  return { x: Math.cos(a) * r, z: Math.sin(a) * r }
}

/** Central mesa, a ring of rock pillars, an outer ring of wrecks and barrel stacks; spawns around the edge facing in. */
export function dustBowl(): ArenaLayout {
  const obstacles: Obstacle[] = [{ x: 0, z: 0, r: 7, kind: 'mesa', yaw: 0 }]
  for (let k = 0; k < 5; k++) obstacles.push({ ...polar(34, 18 + k * 72), r: 3.2, kind: 'pillar', yaw: k * 1.3 })
  for (let k = 0; k < 6; k++) obstacles.push({ ...polar(55, k * 60), r: k % 2 ? 1.9 : 2.7, kind: k % 2 ? 'barrels' : 'wreck', yaw: k * 2.1 })
  const spawns = Array.from({ length: CONFIG.max_players }, (_, k) => {
    const p = polar(CONFIG.bowl_spawn_radius, 22.5 + (k * 360) / CONFIG.max_players)
    return { ...p, yaw: Math.atan2(-p.x, -p.z) }
  })
  const n = CONFIG.bowl_pickups_per_ring
  const pickups = CONFIG.bowl_pickup_rings.flatMap((r, ring) => Array.from({ length: n }, (_, k) => polar(r, (k * 360) / n + (ring % 2 ? 0 : 30))))
  return { radius: CONFIG.bowl_radius, floor: CONFIG.bowl_floor_radius, obstacles, spawns, pickups }
}

/* ---------- Collision helpers ---------- */

/** Height of the bowl surface at radius r (0 on the floor, rising quadratically up the bank). */
export function bowlHeight(a: ArenaLayout, r: number) {
  if (r <= a.floor) return 0
  const k = Math.min(1, (r - a.floor) / (a.radius - a.floor))
  return CONFIG.bowl_bank_height * k * k
}

/** Slope (rise per metre) of the bank at radius r. */
export function bowlSlope(a: ArenaLayout, r: number) {
  if (r <= a.floor) return 0
  const span = a.radius - a.floor
  return (2 * CONFIG.bowl_bank_height * Math.min(span, r - a.floor)) / (span * span)
}

/** Outside the rim, or inside an obstacle (grown by `pad`). Stops shots and beams. */
export function arenaBlocked(a: ArenaLayout, x: number, z: number, pad = 0) {
  if (x * x + z * z > (a.radius - pad) ** 2) return true
  for (const o of a.obstacles) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + pad) ** 2) return true
  return false
}

/** Move a point onto open floor: inside the bank and clear of every obstacle. */
export function onFloor(a: ArenaLayout, p: THREE.Vector3, margin = 3) {
  const r = Math.hypot(p.x, p.z)
  const max = a.floor - margin
  if (r > max) p.multiplyScalar(max / r)
  for (const o of a.obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z
    const d = Math.hypot(dx, dz) || 1
    const min = o.r + margin
    if (d < min) {
      p.x = o.x + (dx / d) * min
      p.z = o.z + (dz / d) * min
    }
  }
  return p
}

/** The spawn point furthest from every live car. */
export function freeSpawn(a: ArenaLayout, others: THREE.Vector3[]) {
  let best = a.spawns[0], bestD = -1
  for (const s of a.spawns) {
    let d = Infinity
    for (const o of others) d = Math.min(d, (o.x - s.x) ** 2 + (o.z - s.z) ** 2)
    if (d > bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

/* ---------- Visuals ---------- */

/** Fine sand: grain, wind ripples and pebbles, near-white so the bowl's vertex colours do the tinting. */
function sandTexture() {
  const S = 512
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const img = g.createImageData(S, S)
  const rnd = mulberry32(11)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const ripple = Math.sin(x * 0.11 + Math.sin(y * 0.031) * 3 + Math.sin(y * 0.007) * 6) * 9
      const v = 214 + rnd() * 34 + ripple
      const i = (y * S + x) * 4
      img.data[i] = v
      img.data[i + 1] = v * 0.97
      img.data[i + 2] = v * 0.92
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  for (let k = 0; k < 900; k++) {
    g.fillStyle = `rgba(${90 + rnd() * 60},${70 + rnd() * 40},${50 + rnd() * 30},${0.25 + rnd() * 0.5})`
    g.beginPath()
    g.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.8, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

/** Tyre marks, skid arcs and oil stains churned into the floor (a transparent decal over the whole floor). */
function scarTexture(a: ArenaLayout) {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const m = S / (a.floor * 2) // pixels per metre
  const rnd = mulberry32(23)
  g.translate(S / 2, S / 2)
  g.lineCap = 'round'
  // Donuts and sweeping arcs: pairs of parallel tyre lines.
  for (let k = 0; k < 70; k++) {
    const cx = (rnd() - 0.5) * a.floor * 1.5 * m, cz = (rnd() - 0.5) * a.floor * 1.5 * m
    const r = (6 + rnd() * 30) * m
    const a0 = rnd() * Math.PI * 2, span = 0.6 + rnd() * 3.5
    g.strokeStyle = `rgba(70,45,25,${0.08 + rnd() * 0.12})`
    g.lineWidth = 0.35 * m
    for (const off of [-0.8, 0.8]) {
      g.beginPath()
      g.arc(cx, cz, r + off * m, a0, a0 + span)
      g.stroke()
    }
  }
  // Oil stains.
  for (let k = 0; k < 26; k++) {
    const x = (rnd() - 0.5) * a.floor * 1.6 * m, z = (rnd() - 0.5) * a.floor * 1.6 * m
    const grd = g.createRadialGradient(x, z, 0, x, z, (1.5 + rnd() * 3) * m)
    grd.addColorStop(0, 'rgba(25,18,12,0.45)')
    grd.addColorStop(1, 'rgba(25,18,12,0)')
    g.fillStyle = grd
    g.fillRect(x - 6 * m, z - 6 * m, 12 * m, 12 * m)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Paint a vertex colour per vertex, and give the geometry world-space uvs (metres / 7) for the sand detail. */
function paint(geo: THREE.BufferGeometry, color: (x: number, y: number, z: number, r: number) => THREE.Color, wallUv = false) {
  const p = geo.attributes.position as THREE.BufferAttribute
  const col = new Float32Array(p.count * 3)
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    const r = Math.hypot(x, z)
    color(x, y, z, r).toArray(col, i * 3)
    if (wallUv) uv.set([(Math.atan2(z, x) * r) / 7, y / 3], i * 2)
    else uv.set([x / 7, z / 7], i * 2)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

const lathe = (pts: [number, number][], segments = 128) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments)

/** Low-frequency variation so the floor isn't one flat colour. */
const wobble = (x: number, z: number) => Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2) * 0.5 + Math.sin(z * 0.06 - x * 0.02) * 0.5

/** A lumpy, flat-shaded sandstone rock, banded by height. */
function rockGeometry(seed: number, radius: number, height: number) {
  const rnd = mulberry32(seed)
  const g = new THREE.IcosahedronGeometry(1, 2)
  const p = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const jitter = new Map<string, number>()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    // Same jitter for shared corners so the rock stays closed.
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    let j = jitter.get(key)
    if (j === undefined) {
      j = 0.82 + rnd() * 0.32
      jitter.set(key, j)
    }
    // Flatter top and a wide footing.
    const y = v.y < 0 ? v.y * 0.4 : v.y
    p.setXYZ(i, v.x * j * radius * (1.1 - Math.max(0, y) * 0.25), (y + 0.4) * height * 0.72 * j, v.z * j * radius * (1.1 - Math.max(0, y) * 0.25))
  }
  const geo = g.toNonIndexed()
  geo.computeVertexNormals()
  const bands = [new THREE.Color('#a4552e'), new THREE.Color('#c98a55'), new THREE.Color('#b8693b'), new THREE.Color('#d9a66d')]
  const pos = geo.attributes.position as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const b = bands[Math.abs(Math.floor(pos.getY(i) / 1.6 + Math.sin(pos.getX(i) * 0.4) * 0.4)) % bands.length]
    b.toArray(col, i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })

/** Warm late-afternoon sky, haze, sun and fill light for the bowl (replaces the city's night setup). */
export function arenaEnvironment(scene: THREE.Scene) {
  scene.background = new THREE.Color('#e3b583')
  scene.fog = new THREE.Fog('#dcae7c', 150, 950)
  scene.add(new THREE.HemisphereLight('#ffe3bd', '#7a4b2a', 1.05))
  const sun = new THREE.DirectionalLight('#ffd49c', 1.55)
  sun.position.set(320, 260, -180)
  scene.add(sun)
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vDir; void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(0.95, 0.70, 0.48);
        vec3 mid = vec3(0.86, 0.62, 0.50);
        vec3 top = vec3(0.30, 0.45, 0.68);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.12, h));
        c = mix(c, top, smoothstep(0.12, 0.65, h));
        vec3 sunDir = normalize(vec3(0.72, 0.42, -0.4));
        c += vec3(1.0, 0.72, 0.4) * pow(max(0.0, dot(normalize(vDir), sunDir)), 24.0) * 0.6;
        gl_FragColor = vec4(c, 1.0);
      }`,
    }),
  )
  sky.renderOrder = -1
  scene.add(sky)
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(2.4, 1.9, 1.3), fog: false, depthWrite: false, toneMapped: false }))
  disc.position.set(0.72, 0.42, -0.4).normalize().multiplyScalar(1800)
  disc.scale.setScalar(150)
  scene.add(disc)
}

export function buildArenaScene(a: ArenaLayout, scene: THREE.Scene, assets?: RacerAssets) {
  const group = new THREE.Group()
  const R = a.radius, F = a.floor
  const B = CONFIG.bowl_bank_height, H = CONFIG.bowl_rim_height
  const sand = sandTexture()
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: sand, roughness: 0.96, metalness: 0, side: THREE.DoubleSide })
  const tmp = new THREE.Color()
  const floorA = new THREE.Color('#d9b27a'), floorB = new THREE.Color('#b88b58'), bankC = new THREE.Color('#c98d5c')
  const wallC = new THREE.Color('#9a5e3a'), topC = new THREE.Color('#e2c597'), plainC = new THREE.Color('#e0b783')

  // Floor: sand with darker, churned patches and a packed ring where the fighting happens.
  const floorPts: [number, number][] = []
  for (let k = 0; k <= 24; k++) floorPts.push([(k / 24) * F, 0])
  group.add(
    new THREE.Mesh(
      paint(lathe(floorPts), (x, _y, z, r) => {
        const ring = Math.exp(-(((r - 42) / 16) ** 2)) * 0.35
        return tmp.copy(floorA).lerp(floorB, THREE.MathUtils.clamp(ring + wobble(x, z) * 0.22 + 0.15, 0, 1))
      }),
      mat,
    ),
  )
  const scars = new THREE.Mesh(
    new THREE.CircleGeometry(F, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: scarTexture(a), transparent: true, depthWrite: false, roughness: 1 }),
  )
  scars.position.y = 0.03
  group.add(scars)

  // Bank, rim wall, rim top, the outside slope and the desert beyond.
  const bank: [number, number][] = []
  for (let k = 0; k <= 12; k++) bank.push([F + ((R - F) * k) / 12, (B * k * k) / 144])
  group.add(new THREE.Mesh(paint(lathe(bank), (x, y, z) => tmp.copy(bankC).lerp(floorA, 0.35 - y / B * 0.3 + wobble(x, z) * 0.1)), mat))
  group.add(
    new THREE.Mesh(
      paint(lathe([[R, B - 0.05], [R, B + H]]), (_x, y) => tmp.copy(wallC).multiplyScalar(0.75 + ((y - B) / H) * 0.35), true),
      mat,
    ),
  )
  group.add(new THREE.Mesh(paint(lathe([[R, B + H], [R + 6, B + H]]), () => tmp.copy(topC)), mat))
  const outer: [number, number][] = [[R + 6, B + H], [R + 18, B + H - 1.2], [R + 45, B * 0.7], [R + 110, 0.4], [R + 260, 0], [1900, 0]]
  const ground = (x: number, z: number) => {
    const r = Math.hypot(x, z)
    for (let k = 1; k < outer.length; k++) {
      const [r0, y0] = outer[k - 1], [r1, y1] = outer[k]
      if (r <= r1) return THREE.MathUtils.lerp(y0, y1, THREE.MathUtils.clamp((r - r0) / (r1 - r0), 0, 1))
    }
    return 0
  }
  group.add(new THREE.Mesh(paint(lathe(outer, 96), (x, _y, z) => tmp.copy(plainC).lerp(bankC, 0.25 + wobble(x * 0.4, z * 0.4) * 0.2)), mat))

  // Neon rim strip so the boundary reads at speed, and floodlight masts around the top.
  const strip = new THREE.Mesh(
    new THREE.TorusGeometry(R + 0.25, 0.14, 6, 192).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a3d').multiplyScalar(2.4), toneMapped: false }),
  )
  strip.position.y = B + H + 0.05
  group.add(strip)
  const lower = strip.clone()
  lower.position.y = B + 0.6
  lower.scale.setScalar((R - 0.05) / (R + 0.25))
  group.add(lower)
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3b2f2a', roughness: 0.6, metalness: 0.5 })
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1c9').multiplyScalar(3), toneMapped: false })
  for (let k = 0; k < 8; k++) {
    const p = polar(R + 3, k * 45)
    const mast = new THREE.Group()
    mast.position.set(p.x, B + H, p.z)
    mast.rotation.y = Math.atan2(-p.x, -p.z)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 16, 8).translate(0, 8, 0), poleMat)
    const head = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.4, 0.5), lampMat)
    head.position.set(0, 16, 0.4)
    head.rotation.x = 0.5
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(1.6, 1.3, 0.9), depthWrite: false, toneMapped: false }))
    glow.position.set(0, 16, 0.9)
    glow.scale.setScalar(9)
    mast.add(pole, head, glow)
    group.add(mast)
  }

  // Obstacles.
  const props = assets?.props
  for (const [i, o] of a.obstacles.entries()) {
    if (o.kind === 'mesa') {
      const base = new THREE.Mesh(rockGeometry(101, o.r * 1.05, 7), rockMat)
      const top = new THREE.Mesh(rockGeometry(102, o.r * 0.7, 6), rockMat)
      top.position.y = 4.6
      top.rotation.y = 0.8
      const crown = new THREE.Mesh(rockGeometry(103, o.r * 0.38, 4), rockMat)
      crown.position.set(1.2, 8.6, -0.8)
      const g = new THREE.Group()
      g.add(base, top, crown)
      g.position.set(o.x, 0, o.z)
      group.add(g)
    } else if (o.kind === 'pillar') {
      const h = 9 + (i % 3) * 2.2
      const g = new THREE.Group()
      const col = new THREE.Mesh(rockGeometry(200 + i, o.r, h), rockMat)
      const cap = new THREE.Mesh(rockGeometry(300 + i, o.r * 1.25, 3), rockMat)
      cap.position.y = h * 0.95
      g.add(col, cap)
      g.position.set(o.x, 0, o.z)
      g.rotation.y = o.yaw
      group.add(g)
    } else if (o.kind === 'wreck') {
      const src = props?.get('tractor')
      let wreck: THREE.Object3D
      if (src) {
        wreck = normalizeModel(src, { length: o.r * 2.3, frontAxis: 'auto' }).object
        wreck.traverse((m) => {
          const mesh = m as THREE.Mesh
          if (!mesh.isMesh) return
          const mm = (mesh.material as THREE.MeshStandardMaterial).clone()
          mm.color.multiply(new THREE.Color('#a87650'))
          mm.roughness = 0.9
          mesh.material = mm
        })
      } else {
        wreck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, o.r * 2), new THREE.MeshStandardMaterial({ color: '#6b3b22', roughness: 0.9, metalness: 0.4 }))
        wreck.position.y = 0.7
      }
      const g = new THREE.Group()
      g.add(wreck)
      g.position.set(o.x, -0.15, o.z)
      g.rotation.set(0.06, o.yaw, 0.12)
      group.add(g)
      // Half-buried tyres beside it.
      for (let t = 0; t < 3; t++) {
        const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 6, 12), new THREE.MeshStandardMaterial({ color: '#1c1714', roughness: 0.9 }))
        tyre.position.set(o.x + Math.cos(o.yaw + t * 2) * (o.r + 0.6), 0.15, o.z + Math.sin(o.yaw + t * 2) * (o.r + 0.6))
        tyre.rotation.x = Math.PI / 2 - 0.3
        group.add(tyre)
      }
    } else {
      const src = props?.get('barrels')
      const g = new THREE.Group()
      if (src) {
        const b = normalizeModel(src, { height: 1.8, frontAxis: 'z' }).object
        g.add(b)
      } else {
        const drum = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10)
        const colors = ['#b91c1c', '#c2410c', '#475569']
        for (let k = 0; k < 5; k++) {
          const m = new THREE.Mesh(drum, new THREE.MeshStandardMaterial({ color: colors[k % 3], roughness: 0.6, metalness: 0.5 }))
          m.position.set(Math.cos(k * 1.3) * 0.9, 0.55 + (k === 4 ? 1.1 : 0), Math.sin(k * 1.3) * 0.9)
          g.add(m)
        }
      }
      g.position.set(o.x, 0, o.z)
      g.rotation.y = o.yaw
      group.add(g)
    }
  }

  // Outside the bowl: cacti, ruins, scattered boulders and distant mesas on the horizon.
  const rnd = mulberry32(5)
  const cactus = props?.get('cactus')
  if (cactus) {
    const model = normalizeModel(cactus, { height: 4.5, frontAxis: 'z' }).object
    for (let k = 0; k < 34; k++) {
      const p = polar(R + 24 + rnd() * 200, rnd() * 360)
      const c = model.clone()
      c.position.set(p.x, ground(p.x, p.z) - 0.2, p.z)
      c.rotation.y = rnd() * Math.PI * 2
      c.scale.setScalar(0.7 + rnd() * 0.8)
      group.add(c)
    }
  }
  const ruins = props?.get('ruins')
  if (ruins) {
    const model = normalizeModel(ruins, { height: 9, frontAxis: 'z' }).object
    for (let k = 0; k < 4; k++) {
      const p = polar(R + 70 + k * 18, 40 + k * 95)
      const r = model.clone()
      r.position.set(p.x, ground(p.x, p.z) - 0.3, p.z)
      r.rotation.y = rnd() * Math.PI * 2
      group.add(r)
    }
  }
  for (let k = 0; k < 30; k++) {
    const p = polar(R + 30 + rnd() * 260, rnd() * 360)
    const rock = new THREE.Mesh(rockGeometry(400 + k, 2 + rnd() * 5, 2 + rnd() * 6), rockMat)
    rock.position.set(p.x, ground(p.x, p.z) - 0.3, p.z)
    rock.rotation.y = rnd() * 6
    group.add(rock)
  }
  for (let k = 0; k < 12; k++) {
    const p = polar(650 + rnd() * 450, k * 30 + rnd() * 20)
    const mesa = new THREE.Mesh(rockGeometry(500 + k, 50 + rnd() * 70, 40 + rnd() * 70), rockMat)
    mesa.position.set(p.x, -2, p.z)
    group.add(mesa)
  }

  // A sign over the rim.
  group.add(arenaSign('DUST BOWL', polar(R + 8, 270), B + H + 11))

  scene.add(group)
  return group
}

function arenaSign(text: string, at: { x: number; z: number }, y: number) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  g.font = '900 150px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = '#ff7a2f'
  g.shadowBlur = 40
  g.fillStyle = '#ffe2c4'
  g.fillText(text, 512, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(44, 11), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.8, 1.8, 1.8) }))
  sign.position.set(at.x, y, at.z)
  sign.rotation.y = Math.atan2(-at.x, -at.z)
  return sign
}
