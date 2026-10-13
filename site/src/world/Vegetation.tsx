// Ground cover: wind-swayed grass tufts in a ring around the player (re-laid out only after they've moved
// a few metres, from a per-cell cache), and patches of wildflowers across the meadows. All instanced:
// one draw call for the grass and one per flower colour, no allocation per frame.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { REGIONS, WATER_LEVEL, type Biome } from './regions'
import { heightAt, isNearPad, isOnRoad, mulberry32, TRAIL_HALF, trailAt } from './terrain'
import { blocked } from './colliders'
import { DENSITY } from './layout'
import { MISSIONS } from './missions'
import { player } from './Characters'

/* ---------- Where things grow ---------- */

const NO_GRASS = new Set<Biome>(['neon', 'stadium', 'arcade', 'canyon'])
const TINT: Partial<Record<Biome, [number, number, number]>> = {
  temple: [1.15, 1.0, 0.55],
  highland: [0.85, 1.0, 0.85],
  keep: [0.9, 0.95, 0.9],
  plains: [1.1, 1.05, 0.7],
}

/** The biome that dominates a point, or null in the open country between regions. */
function biomeAt(x: number, z: number): { biome: Biome; d: number } | null {
  let best: { biome: Biome; d: number } | null = null
  let bestK = Infinity
  for (const r of REGIONS) {
    const d = Math.hypot(x - r.center[0], z - r.center[1])
    const k = d / r.radius
    if (k < 1.1 && k < bestK) {
      bestK = k
      best = { biome: r.biome, d }
    }
  }
  return best
}

/** Can grass (or a flower) grow here? Returns the biome tint, or null. */
function grassy(x: number, z: number, h: number): [number, number, number] | null {
  if (h < WATER_LEVEL + 1.1) return null
  const b = biomeAt(x, z)
  if (b && NO_GRASS.has(b.biome)) return null
  if (b?.biome === 'harbour' && b.d < 42) return null
  if (b?.biome === 'cove' && h < 3) return null
  if (b?.biome === 'keep' && b.d < 72) return null
  if (isOnRoad(x, z, 1) || trailAt(x, z) < TRAIL_HALF - 0.2) return null
  // Not on steep slopes.
  if (Math.abs(heightAt(x + 1, z) - h) + Math.abs(heightAt(x, z + 1) - h) > 0.8) return null
  return (b && TINT[b.biome]) ?? [1, 1, 1]
}

/* ---------- Geometry ---------- */

function colored(geo: THREE.BufferGeometry, color: (y: number) => THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.deleteAttribute('uv')
  const pos = g.attributes.position
  const arr = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const c = color(pos.getY(i))
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

function tuftGeometry() {
  const base = new THREE.Color('#3d7a2b'), tip = new THREE.Color('#b5dc6e'), c = new THREE.Color()
  const blades: THREE.BufferGeometry[] = []
  for (let i = 0; i < 5; i++) {
    const h = 0.42 + (i % 3) * 0.1
    const g = new THREE.BufferGeometry()
    // A thin, slightly bent blade: a quad tapering to a point.
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.045, 0, 0, 0.045, 0, 0, -0.02, h * 0.55, 0.03, 0.02, h * 0.55, 0.03, 0, h, 0.09], 3))
    g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4])
    g.computeVertexNormals()
    g.rotateY((i / 5) * Math.PI * 2 + i)
    g.translate(Math.cos(i * 2.1) * 0.08, 0, Math.sin(i * 2.1) * 0.08)
    blades.push(colored(g, (y) => c.copy(base).lerp(tip, Math.min(1, y / 0.5))))
  }
  return mergeGeometries(blades)!
}

function flowerGeometry(petal: string) {
  const parts: THREE.BufferGeometry[] = []
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.34, 4)
  stem.translate(0, 0.17, 0)
  parts.push(colored(stem, () => new THREE.Color('#3f8f3a')))
  const leaf = new THREE.SphereGeometry(1, 5, 3)
  leaf.scale(0.06, 0.012, 0.025)
  leaf.translate(0.05, 0.1, 0)
  parts.push(colored(leaf, () => new THREE.Color('#4caf50')))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const p = new THREE.SphereGeometry(1, 5, 3)
    p.scale(0.055, 0.016, 0.035)
    p.rotateY(-a)
    p.translate(Math.cos(a) * 0.05, 0.35, Math.sin(a) * 0.05)
    parts.push(colored(p, () => new THREE.Color(petal)))
  }
  const centre = new THREE.SphereGeometry(0.03, 5, 4)
  centre.translate(0, 0.36, 0)
  parts.push(colored(centre, () => new THREE.Color('#ffd23f')))
  return mergeGeometries(parts)!
}

/* ---------- Grass around the player ---------- */

/**
 * Two rings of tufts follow the player: a dense one close by and a sparser, larger-celled one out to ~80 m whose tufts
 * shrink away towards its edge (so the grass fades out instead of ending in a line). Path verges grow taller and
 * thicker. Re-laid out only after the player has moved a few metres, from per-cell caches; no allocation per frame.
 */
const RINGS = [
  { cell: 0.9, inner: 0, outer: 30, p: 0.8 },
  { cell: 2.1, inner: 28, outer: 80, p: 0.85 },
]
const GRASS_N = Math.round(7000 * DENSITY)
/** Per-ring, per-cell cache: [x, y, z, scale, yaw, r, g, b] or null where nothing grows. */
const caches = RINGS.map(() => new Map<number, Float32Array | null>())

function cellData(ring: number, ix: number, iz: number) {
  const cache = caches[ring]
  const key = (ix + 4096) * 8192 + (iz + 4096)
  let d = cache.get(key)
  if (d !== undefined) return d
  // Deterministic jitter per cell, so tufts don't swim as the ring moves.
  const rnd = mulberry32(key * 3 + ring)
  const cell = RINGS[ring].cell
  d = null
  const x = (ix + rnd()) * cell, z = (iz + rnd()) * cell
  // Verges: thicker and taller along the edges of footpaths and roads.
  const t = trailAt(x, z)
  const verge = t > TRAIL_HALF - 0.2 && t < TRAIL_HALF + 2.6 ? 1 : isOnRoad(x, z, 3) ? 0.6 : 0
  if (rnd() < RINGS[ring].p + verge * 0.2) {
    const h = heightAt(x, z)
    const tint = grassy(x, z, h)
    if (tint && !blocked(x, z, 0.15)) {
      const v = 0.82 + rnd() * 0.36
      // A little hue drift per tuft: some yellower, some bluer.
      const warm = (rnd() - 0.5) * 0.12
      d = new Float32Array([x, h - 0.03, z, (0.7 + rnd() * 0.7) * (1 + verge * 0.35) * (ring ? 1.25 : 1), rnd() * Math.PI * 2, tint[0] * v * (1 + warm), tint[1] * v, tint[2] * v * (1 - warm)])
    }
  }
  if (cache.size > 60000) cache.clear()
  cache.set(key, d)
  return d
}

const gm = new THREE.Matrix4()
const gq = new THREE.Quaternion()
const ge = new THREE.Euler()
const gp = new THREE.Vector3()
const gs = new THREE.Vector3()
const gc = new THREE.Color()

let grassRes: { mesh: THREE.InstancedMesh; time: { value: number } } | null = null
function grassMesh() {
  if (grassRes) return grassRes
  const time = { value: 0 }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  // Wind: sway each tuft by its height, phase-shifted by where it stands; gusts roll across the field.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
  float gust = 0.6 + 0.4 * sin(uTime * 0.7 + instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.03);
#else
  float ph = 0.0;
  float gust = 1.0;
#endif
  float bend = position.y * position.y * 2.0 * gust;
  transformed.x += sin(uTime * 1.9 + ph) * 0.16 * bend;
  transformed.z += cos(uTime * 1.4 + ph * 1.3) * 0.1 * bend;`,
    )
  }
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, GRASS_N)
  mesh.count = 0
  mesh.frustumCulled = false
  mesh.receiveShadow = true
  mesh.setColorAt(0, gc.set(1, 1, 1))
  grassRes = { mesh, time }
  return grassRes
}

function Grass() {
  const last = useRef({ x: 1e9, z: 1e9 })
  const { mesh } = grassMesh()
  useFrame(({ clock }) => {
    const { mesh, time } = grassMesh()
    time.value = clock.elapsedTime
    // High in the air the grass can't be seen: skip it.
    const high = player.pos.y - player.ground > 25
    mesh.visible = !high
    if (high) return
    const L = last.current
    if (Math.hypot(player.pos.x - L.x, player.pos.z - L.z) < 3) return
    L.x = player.pos.x
    L.z = player.pos.z
    let n = 0
    for (let ring = 0; ring < RINGS.length; ring++) {
      const R = RINGS[ring]
      const cx = Math.round(L.x / R.cell), cz = Math.round(L.z / R.cell)
      const span = Math.ceil(R.outer / R.cell), hole = R.inner / R.cell
      for (let dz = -span; dz <= span && n < GRASS_N; dz++)
        for (let dx = -span; dx <= span && n < GRASS_N; dx++) {
          const r2 = dx * dx + dz * dz
          if (r2 > span * span || r2 < hole * hole) continue
          const d = cellData(ring, cx + dx, cz + dz)
          if (!d) continue
          // Shrink away towards the outer edge of the far ring.
          const dist = Math.sqrt(r2) * R.cell
          const fade = ring ? Math.min(1, Math.max(0, (R.outer - dist) / (R.outer * 0.3))) : 1
          if (fade <= 0.05) continue
          ge.set(0, d[4], 0)
          gm.compose(gp.set(d[0], d[1], d[2]), gq.setFromEuler(ge), gs.set(d[3] * fade, d[3] * fade * (0.8 + (d[4] % 0.4)), d[3] * fade))
          mesh.setMatrixAt(n, gm)
          mesh.setColorAt(n, gc.setRGB(d[5], d[6], d[7]))
          n++
        }
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })
  return <primitive object={mesh} />
}

/* ---------- Wildflower patches ---------- */

const PETALS = ['#ff7eb6', '#ffd23f', '#b9a2ff', '#ffffff']
const MEADOWS = new Set(['hub', 'highland', 'ridge', 'campus', 'lab', 'plains'])

function flowerLayout() {
  const rnd = mulberry32(4242)
  const out: THREE.Matrix4[][] = PETALS.map(() => [])
  const patches = Math.round(150 * DENSITY)
  const meadows = REGIONS.filter((r) => MEADOWS.has(r.id))
  let tries = 0
  for (let p = 0; p < patches && tries++ < patches * 10; ) {
    const r = meadows[Math.floor(rnd() * meadows.length)]
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r.radius
    const px = r.center[0] + Math.cos(a) * d, pz = r.center[1] + Math.sin(a) * d
    if (isNearPad(px, pz, 1) || MISSIONS.some((m) => Math.hypot(px - m.x, pz - m.z) < 4)) continue
    if (!grassy(px, pz, heightAt(px, pz))) continue
    p++
    const variant = Math.floor(rnd() * PETALS.length)
    const n = 4 + Math.floor(rnd() * 7)
    for (let i = 0; i < n; i++) {
      const x = px + (rnd() - 0.5) * 3, z = pz + (rnd() - 0.5) * 3
      const h = heightAt(x, z)
      if (h < WATER_LEVEL + 1.1 || blocked(x, z, 0.1)) continue
      const s = 0.8 + rnd() * 0.7
      // Mostly one colour per patch, with the odd stray.
      const v = rnd() < 0.8 ? variant : Math.floor(rnd() * PETALS.length)
      out[v].push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, (rnd() - 0.5) * 0.3)), new THREE.Vector3(s, s, s)))
    }
  }
  return out
}

function Flowers() {
  const meshes = useMemo(() => {
    const layout = flowerLayout()
    return PETALS.map((petal, i) => {
      const im = new THREE.InstancedMesh(flowerGeometry(petal), new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, layout[i].length))
      layout[i].forEach((m, k) => im.setMatrixAt(k, m))
      im.count = layout[i].length
      im.computeBoundingSphere()
      return im
    })
  }, [])
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </>
  )
}

export function Vegetation({ grass }: { grass: boolean }) {
  return (
    <>
      <Flowers />
      {grass && <Grass />}
    </>
  )
}
