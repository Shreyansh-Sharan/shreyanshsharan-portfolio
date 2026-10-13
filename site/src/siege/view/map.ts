// Builds the three.js scene for a map: the floor, wall blocks clad in shuttered shop fronts, cover and props from
// the downloaded models (procedural stand-ins if a file is missing), neon signs and holo-ads, a per-theme skyline
// of buildings outside the walls, the skybox and the battle-royale grid. The ASCII layout stays authoritative:
// every piece snaps to its cell.
import * as THREE from 'three'
import { instance, type SiegeAssets } from '../engine/assets'
import { CELL, cellKind, type MapDef } from '../engine/maps'
import { Rng } from '../engine/rng'
import { BRANDS, decalTexture, floorTexture, holoTexture, signTexture, SIGN_WORDS, stripeTexture } from './textures'

export interface BuiltMap {
  group: THREE.Group
  /** Cell index → crate object, so the view can hide destroyed ones. */
  crates: Map<number, THREE.Object3D>
  /** Called every frame with the time for spinning holograms and pulsing neon. */
  animate: (t: number) => void
  /** Battle-royale grid: current square and the next one. */
  setGrid: (cx: number, cz: number, half: number, ncx: number, ncz: number, nhalf: number, show: boolean) => void
  dispose: () => void
}

const WALL_H = 3.2

/** A mesh's geometry in its root's space. Quantised (Int16) positions are widened to floats first, since baking a
 * world transform into a normalised integer attribute would clamp every coordinate to ±1. */
function bakeGeometry(m: THREE.Mesh) {
  const geo = m.geometry.clone()
  const pos = geo.attributes.position
  const out = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i)
    out[i * 3 + 1] = pos.getY(i)
    out[i * 3 + 2] = pos.getZ(i)
  }
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3))
  if (geo.attributes.normal) {
    const n = geo.attributes.normal
    const no = new Float32Array(n.count * 3)
    for (let i = 0; i < n.count; i++) {
      no[i * 3] = n.getX(i)
      no[i * 3 + 1] = n.getY(i)
      no[i * 3 + 2] = n.getZ(i)
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(no, 3))
  }
  geo.applyMatrix4(m.matrixWorld)
  return geo
}
const DIRS: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
]

export function buildMap(map: MapDef, chars: string[], assets: SiegeAssets, seed: number, quality: number): BuiltMap {
  const g = new THREE.Group()
  const rng = new Rng(seed ^ 0x51e6e)
  const W = map.w
  const H = map.h
  const wm = W * CELL
  const hm = H * CELL
  const neon = new THREE.Color(map.colors[0])
  const disposables: { dispose(): void }[] = []
  const animated: ((t: number) => void)[] = []
  const crates = new Map<number, THREE.Object3D>()
  const at = (cx: number, cz: number) => chars[cz * W + cx] ?? '#'
  const kindAt = (cx: number, cz: number) => (cx < 0 || cz < 0 || cx >= W || cz >= H ? 'wall' : cellKind(at(cx, cz)))
  const theme = map.theme

  /* ---------- Floor ---------- */
  const floorTex = floorTexture(theme)
  floorTex.repeat.set(W / 2, H / 2)
  disposables.push(floorTex)
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: new THREE.Color(map.colors[1]).lerp(new THREE.Color('#ffffff'), 0.65), roughness: 0.85, metalness: 0.1 })
  const gridUniform = { value: new THREE.Vector4(0, 0, 1e5, 0) }
  floorMat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrid = gridUniform
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uGrid;\nvarying vec3 vWorldPos;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (uGrid.w > 0.5) {
          float dx = abs(vWorldPos.x - uGrid.x) - uGrid.z;
          float dz = abs(vWorldPos.z - uGrid.y) - uGrid.z;
          float outside = max(dx, dz);
          if (outside > 0.0) {
            float edge = smoothstep(0.0, 0.6, outside);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.55, 0.25, 0.45) + vec3(0.08, 0.0, 0.05), 0.75 * edge);
            float scan = step(0.92, fract((vWorldPos.x + vWorldPos.z) * 0.5));
            gl_FragColor.rgb += vec3(0.9, 0.2, 0.6) * scan * 0.25 * edge;
          }
        }`,
      )
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(wm, hm), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(wm / 2, 0, hm / 2)
  floor.receiveShadow = true
  g.add(floor)
  disposables.push(floorMat, floor.geometry)

  /* ---------- Props ---------- */
  const placeProp = (name: string, x: number, z: number, yaw: number, fallback: [number, number, number], color: string, glow?: string) => {
    let o = instance(assets, name)
    if (!o) {
      const geo = new THREE.BoxGeometry(fallback[0], fallback[1], fallback[2])
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, emissive: glow ? new THREE.Color(glow) : undefined, emissiveIntensity: glow ? 0.5 : 0 })
      const m = new THREE.Mesh(geo, mat)
      m.position.y = fallback[1] / 2
      m.castShadow = quality > 0
      m.receiveShadow = true
      o = new THREE.Group().add(m)
      disposables.push(geo, mat)
    }
    o.position.set(x, 0, z)
    o.rotation.y = yaw
    g.add(o)
    return o
  }

  /* ---------- Cells ---------- */
  const wallCells: [number, number, string][] = []
  const voidCells: [number, number][] = []
  for (let cz = 0; cz < H; cz++)
    for (let cx = 0; cx < W; cx++) {
      const ch = at(cx, cz)
      const k = cellKind(ch)
      if (k === 'void') voidCells.push([cx, cz])
      if (k === 'wall' && (ch === '#' || ch === 'n' || ch === 'h')) wallCells.push([cx, cz, ch])
    }

  // Wall cores: instanced blocks with a neon trim along the top edges that face open cells. The visible faces are
  // clad with shuttered shop fronts (instanced), so the core mostly shows as the roof.
  const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL)
  const wallMat = new THREE.MeshStandardMaterial({ color: theme === 'subway' ? '#4a4a58' : theme === 'roof' ? '#34405a' : '#2e2550', roughness: 0.8, metalness: 0.2 })
  const capGeo = new THREE.BoxGeometry(CELL + 0.06, 0.07, 0.14)
  const capMat = new THREE.MeshBasicMaterial({ color: neon })
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, Math.max(1, wallCells.length))
  walls.castShadow = quality > 0
  walls.receiveShadow = true
  const m4 = new THREE.Matrix4()
  const capList: THREE.Matrix4[] = []
  const faces: { cx: number; cz: number; dx: number; dz: number; h: number }[] = []
  wallCells.forEach(([cx, cz], i) => {
    const edge = cx === 0 || cz === 0 || cx === W - 1 || cz === H - 1
    const h = edge ? WALL_H * 0.7 : WALL_H
    m4.makeScale(1, h / WALL_H, 1).setPosition((cx + 0.5) * CELL, h / 2, (cz + 0.5) * CELL)
    walls.setMatrixAt(i, m4)
    for (const [dx, dz] of DIRS) {
      const nk = kindAt(cx + dx, cz + dz)
      if (nk === 'wall') continue
      const m = new THREE.Matrix4().makeRotationY(dx ? Math.PI / 2 : 0)
      m.setPosition((cx + 0.5) * CELL + dx * (CELL / 2 - 0.07), h + 0.03, (cz + 0.5) * CELL + dz * (CELL / 2 - 0.07))
      capList.push(m)
      if (nk !== 'void') faces.push({ cx, cz, dx, dz, h })
    }
  })
  walls.count = wallCells.length
  const caps = new THREE.InstancedMesh(capGeo, capMat, Math.max(1, capList.length))
  capList.forEach((m, i) => caps.setMatrixAt(i, m))
  caps.count = capList.length
  g.add(walls, caps)
  disposables.push(wallGeo, wallMat, capGeo, capMat)

  // Cladding: group faces into runs (same facing, consecutive cells), fill each run with 2-cell shutters.
  const shutterProto = assets.models.get('env-shutter')
  if (shutterProto && theme !== 'roof') {
    let geo: THREE.BufferGeometry | null = null
    let mat: THREE.Material | null = null
    shutterProto.updateMatrixWorld(true)
    shutterProto.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !geo) {
        geo = bakeGeometry(m)
        mat = m.material as THREE.Material
      }
    })
    if (geo && mat) {
      const sg = geo as THREE.BufferGeometry
      sg.computeBoundingBox()
      const bb = sg.boundingBox!
      const pw = bb.max.x - bb.min.x // shutter width (faces +z)
      const ph = bb.max.y - bb.min.y
      const pd = bb.max.z - bb.min.z
      const runs: { x: number; z: number; dx: number; dz: number; n: number; h: number }[] = []
      const seen = new Set<string>()
      const key = (f: { cx: number; cz: number; dx: number; dz: number }) => `${f.cx},${f.cz},${f.dx},${f.dz}`
      const faceSet = new Map(faces.map((f) => [key(f), f]))
      for (const f of faces) {
        if (seen.has(key(f))) continue
        // Walk along the wall (perpendicular to the face normal) while the same face continues.
        const ax = f.dz ? 1 : 0
        const az = f.dx ? 1 : 0
        let n = 0
        let cx = f.cx
        let cz = f.cz
        while (true) {
          const k = `${cx},${cz},${f.dx},${f.dz}`
          const q = faceSet.get(k)
          if (!q || seen.has(k) || q.h !== f.h) break
          seen.add(k)
          n++
          cx += ax
          cz += az
        }
        runs.push({ x: f.cx, z: f.cz, dx: f.dx, dz: f.dz, n, h: f.h })
      }
      const mats: THREE.Matrix4[] = []
      const sMat = (mat as THREE.MeshStandardMaterial).clone()
      // The shutter texture is painted dark: lift it so the fronts read under the arena lights.
      sMat.metalness = 0
      sMat.roughness = 0.85
      sMat.emissive = new THREE.Color(theme === 'subway' ? '#2a2c38' : theme === 'district' ? '#2a1e44' : '#241a40')
      sMat.emissiveIntensity = 1
      sMat.color.set(theme === 'subway' ? '#c8ccda' : '#e4d8ff')
      for (const r of runs) {
        const len = r.n * CELL
        const pieces = Math.max(1, Math.round(len / 4))
        const pieceLen = len / pieces
        const sy = r.h / ph
        for (let i = 0; i < pieces; i++) {
          const along = (i + 0.5) * pieceLen
          const ax = r.dz ? 1 : 0
          const az = r.dx ? 1 : 0
          // Sunk into the wall block so the front sits flush with the collision face.
          const x = r.x * CELL + ax * along + (r.dx ? (r.dx > 0 ? CELL : 0) + r.dx * (-pd * sy * 0.5 + 0.04) : CELL / 2)
          const z = r.z * CELL + az * along + (r.dz ? (r.dz > 0 ? CELL : 0) + r.dz * (-pd * sy * 0.5 + 0.04) : CELL / 2)
          const yaw = r.dz > 0 ? 0 : r.dz < 0 ? Math.PI : r.dx > 0 ? Math.PI / 2 : -Math.PI / 2
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(pieceLen / pw, sy, sy))
          mats.push(m)
        }
      }
      const inst = new THREE.InstancedMesh(sg, sMat, Math.max(1, mats.length))
      mats.forEach((m, i) => inst.setMatrixAt(i, m))
      inst.count = mats.length
      inst.castShadow = quality > 0
      inst.receiveShadow = true
      g.add(inst)
      disposables.push(sg, sMat)
    }
  }

  // Voids: rooftop drops, the subway trench, a sunken plaza.
  if (voidCells.length) {
    const depth = 0
    const vGeo = new THREE.PlaneGeometry(CELL, CELL)
    const vMat = new THREE.MeshStandardMaterial({ color: theme === 'roof' ? '#020108' : theme === 'subway' ? '#101016' : '#071424', roughness: 1 })
    const voids = new THREE.InstancedMesh(vGeo, vMat, voidCells.length)
    voidCells.forEach(([cx, cz], i) => {
      m4.makeRotationX(-Math.PI / 2).setPosition((cx + 0.5) * CELL, depth + 0.02, (cz + 0.5) * CELL)
      voids.setMatrixAt(i, m4)
    })
    g.add(voids)
    disposables.push(vGeo, vMat)
    // Edge rims where floor meets void.
    const rimGeo = new THREE.BoxGeometry(CELL, 0.12, 0.12)
    const rimMat = new THREE.MeshBasicMaterial({ color: theme === 'subway' ? '#facc15' : neon })
    const rims: THREE.Matrix4[] = []
    for (const [cx, cz] of voidCells)
      for (const [dx, dz] of DIRS) {
        if (kindAt(cx + dx, cz + dz) !== 'floor') continue
        const m = new THREE.Matrix4()
        const x = (cx + 0.5) * CELL + dx * (CELL / 2)
        const z = (cz + 0.5) * CELL + dz * (CELL / 2)
        m.makeRotationY(dx ? Math.PI / 2 : 0).setPosition(x, 0.06, z)
        rims.push(m)
        // Rooftop railings along the drops.
        if (theme === 'roof' && rng.chance(0.85)) {
          const rail = placeProp('env-rails', x - dx * 0.25, z - dz * 0.25, dx ? 0 : Math.PI / 2, [2, 1.1, 0.1], '#8d8d99')
          rail.scale.y = 0.55
        }
      }
    if (rims.length) {
      const rim = new THREE.InstancedMesh(rimGeo, rimMat, rims.length)
      rims.forEach((m, i) => rim.setMatrixAt(i, m))
      g.add(rim)
    }
    disposables.push(rimGeo, rimMat)
    if (theme === 'subway') {
      // Rails along the trench and a warning stripe along the platform edges.
      const railGeo = new THREE.BoxGeometry(CELL, 0.08, 0.1)
      const railMat = new THREE.MeshStandardMaterial({ color: '#8d8d99', metalness: 0.8, roughness: 0.3 })
      const rails = new THREE.InstancedMesh(railGeo, railMat, voidCells.length * 2)
      voidCells.forEach(([cx, cz], i) => {
        m4.makeTranslation((cx + 0.5) * CELL, depth + 0.06, (cz + 0.5) * CELL - 0.45)
        rails.setMatrixAt(i * 2, m4)
        m4.makeTranslation((cx + 0.5) * CELL, depth + 0.06, (cz + 0.5) * CELL + 0.45)
        rails.setMatrixAt(i * 2 + 1, m4)
      })
      g.add(rails)
      const stripe = stripeTexture()
      stripe.repeat.set(2, 1)
      const sGeo = new THREE.PlaneGeometry(CELL, 0.4)
      const sMat = new THREE.MeshBasicMaterial({ map: stripe })
      const stripes = new THREE.InstancedMesh(sGeo, sMat, rims.length)
      rims.forEach((m, i) => {
        const p = new THREE.Vector3().setFromMatrixPosition(m)
        const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromRotationMatrix(m))
        const n = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, e.y))
        n.setPosition(p.x, 0.015, p.z)
        stripes.setMatrixAt(i, n)
      })
      g.add(stripes)
      disposables.push(railGeo, railMat, sGeo, sMat, stripe)
      // Parked carriages in the trench between the crossings: runs of 4+ void cells along the trench's middle row.
      const voidSet = new Set(voidCells.map(([cx, cz]) => cz * W + cx))
      const trenchRows = [...new Set(voidCells.map(([, cz]) => cz))].sort((a, b) => a - b)
      const mid = trenchRows[Math.floor(trenchRows.length / 2)]
      if (mid !== undefined) {
        let start = -1
        for (let cx = 0; cx <= W; cx++) {
          const isVoid = cx < W && voidSet.has(mid * W + cx)
          if (isVoid && start < 0) start = cx
          if (!isVoid && start >= 0) {
            const n = cx - start
            if (n >= 4) {
              const x = ((start + cx) / 2) * CELL
              const t = placeProp('env-train', x, (mid + 0.5) * CELL - (trenchRows.length % 2 === 0 ? CELL / 2 : 0), Math.PI / 2, [8, 2, 1.2], '#d9741b')
              t.scale.setScalar(Math.min(1, (n * CELL - 0.6) / 8))
            }
            start = -1
          }
        }
      }
    }
  }

  const openFace = (cx: number, cz: number) => {
    // Direction (dx, dz) of a neighbouring floor cell, preferring south (towards the camera).
    for (const [dx, dz] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ])
      if (kindAt(cx + dx, cz + dz) === 'floor') return [dx, dz]
    return [0, 1]
  }
  const alongX = (cx: number, cz: number) => kindAt(cx + 1, cz) === 'low' || kindAt(cx - 1, cz) === 'low'

  const used = new Set<number>()
  for (let cz = 0; cz < H; cz++)
    for (let cx = 0; cx < W; cx++) {
      const i = cz * W + cx
      if (used.has(i)) continue
      const ch = at(cx, cz)
      const x = (cx + 0.5) * CELL
      const z = (cz + 0.5) * CELL
      const jitter = () => (rng.next() - 0.5) * 0.3
      switch (ch) {
        case 'x': {
          const kind = theme === 'roof' ? 'env-crate-military' : rng.chance(0.3) ? 'env-crate-neon' : rng.chance(0.5) ? 'env-crate-yellow' : 'env-crate-military'
          crates.set(i, placeProp(kind, x + jitter(), z + jitter(), rng.int(4) * (Math.PI / 2) + jitter(), [1.5, 1.5, 1.5], '#6b5a3a'))
          break
        }
        case 'b':
          crates.set(i, placeProp('env-crate-lp', x, z, rng.int(4) * (Math.PI / 2), [1.5, 1.6, 1.3], '#4a5a3a'))
          break
        case '$': {
          const o = placeProp('env-loot-chest', x, z, rng.int(4) * (Math.PI / 2), [1.6, 0.8, 1], '#5a4a2a', map.colors[0])
          crates.set(i, o)
          // A beacon so loot reads from far away.
          const beamGeo = new THREE.CylinderGeometry(0.08, 0.3, 4, 8, 1, true)
          const beamMat = new THREE.MeshBasicMaterial({ color: neon, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
          const beam = new THREE.Mesh(beamGeo, beamMat)
          beam.position.y = 2.4
          o.add(beam)
          disposables.push(beamGeo, beamMat)
          animated.push((t) => {
            beam.rotation.y = t
            beamMat.opacity = 0.25 + Math.sin(t * 3) * 0.1
          })
          break
        }
        case '=':
          placeProp('env-rails', x, z, alongX(cx, cz) ? 0 : Math.PI / 2, [2, 1, 0.5], '#8a2b2b').scale.y = 0.5
          break
        case 's':
          placeProp('env-case', x, z, alongX(cx, cz) ? Math.PI / 2 : 0, [2, 0.6, 0.6], '#8a7a4a')
          break
        case 'd':
          placeProp(theme === 'subway' ? 'env-turnstiles' : 'env-case', x, z, alongX(cx, cz) ? Math.PI / 2 : 0, [1.9, 1.1, 1.2], '#2d5a3a')
          break
        case 'T': {
          // Cars sit along a run of two cells.
          const vertical = at(cx, cz + 1) === 'T'
          const horizontal = at(cx + 1, cz) === 'T'
          if (vertical) used.add(i + W)
          if (horizontal) used.add(i + 1)
          const px = horizontal ? x + CELL / 2 : x
          const pz = vertical ? z + CELL / 2 : z
          const kind = rng.chance(0.4) ? 'env-hover-car' : rng.chance(0.5) ? 'env-car-1' : 'env-car-2'
          placeProp(kind, px, pz, (vertical ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0), [2.8, 1.2, 1.4], '#d9a21b')
          break
        }
        case 'U': {
          const vertical = at(cx, cz + 1) === 'U'
          const horizontal = at(cx + 1, cz) === 'U'
          if (vertical) used.add(i + W)
          if (horizontal) used.add(i + 1)
          const px = horizontal ? x + CELL / 2 : x
          const pz = vertical ? z + CELL / 2 : z
          placeProp('box-truck', px, pz, vertical ? Math.PI / 2 : 0, [3.9, 2.2, 1.8], '#cfd3dc')
          break
        }
        case 'k':
          if (theme === 'roof') placeProp(rng.chance(0.5) ? 'env-vent' : 'env-vent-tall', x, z, rng.int(4) * (Math.PI / 2), [1.9, 2.2, 1.6], '#56607a')
          else {
            const [dx, dz] = openFace(cx, cz)
            placeProp('env-terminal', x, z, Math.atan2(dx, dz), [1.9, 2.2, 1.6], '#56607a')
          }
          break
        case 'l':
          placeProp('led-streetlight', x, z, Math.PI, [0.2, 5, 0.2], '#777')
          break
        case 'n': {
          const [dx, dz] = openFace(cx, cz)
          const word = SIGN_WORDS[rng.int(SIGN_WORDS.length)]
          const color = rng.chance(0.5) ? map.colors[0] : '#22d3ee'
          const blade = instance(assets, 'env-neon-blade')
          if (blade && rng.chance(0.55)) {
            // Vertical blade sign hung off the open face, reading along the street.
            blade.position.set(x + dx * (CELL / 2 + 0.55), 1.3, z + dz * (CELL / 2 + 0.55))
            blade.rotation.y = Math.atan2(dx, dz) + Math.PI
            g.add(blade)
          } else {
            const t = signTexture(word, color)
            const geo = new THREE.PlaneGeometry(1.8, 0.45)
            const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true })
            const plate = new THREE.Mesh(geo, mat)
            plate.position.set(x + dx * (CELL / 2 + 0.03), 2.3, z + dz * (CELL / 2 + 0.03))
            plate.rotation.y = Math.atan2(dx, dz)
            g.add(plate)
            disposables.push(t, geo, mat)
            animated.push((tm) => {
              mat.opacity = 0.75 + Math.sin(tm * 7 + cx) * 0.1 + (Math.sin(tm * 23 + cz) > 0.95 ? -0.5 : 0)
            })
          }
          break
        }
        case 'h': {
          // Holo-ad pillar: a thin column with a rotating brand hologram above it.
          const brand = BRANDS[(cx * 7 + cz * 3) % BRANDS.length]
          const color = ['#f0abfc', '#22d3ee', '#facc15', '#4ade80'][rng.int(4)]
          const t = holoTexture(brand, color)
          const geo = new THREE.PlaneGeometry(1.6, 3.2)
          const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.85, depthWrite: false })
          const holo = new THREE.Group()
          const front = new THREE.Mesh(geo, mat)
          const back = new THREE.Mesh(geo, mat)
          back.rotation.y = Math.PI
          holo.add(front, back)
          holo.position.set(x, WALL_H + 1.9, z)
          g.add(holo)
          disposables.push(t, geo, mat)
          animated.push((tm) => {
            holo.rotation.y = tm * 0.6 + cx
            mat.opacity = 0.7 + Math.sin(tm * 9) * 0.1
          })
          break
        }
      }
    }

  /* ---------- Decals ---------- */
  const decal = (kind: 'H' | 'core' | 'spawn', x: number, z: number, size: number, color: string) => {
    const t = decalTexture(kind, color)
    const geo = new THREE.PlaneGeometry(size, size)
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, depthWrite: false })
    const m = new THREE.Mesh(geo, mat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.02, z)
    g.add(m)
    disposables.push(t, geo, mat)
    return m
  }
  const centroid = (chsel: string, filter: (cz: number) => boolean) => {
    let sx = 0
    let sz = 0
    let n = 0
    for (let cz = 0; cz < H; cz++)
      for (let cx = 0; cx < W; cx++)
        if (at(cx, cz) === chsel && filter(cz)) {
          sx += (cx + 0.5) * CELL
          sz += (cz + 0.5) * CELL
          n++
        }
    return n ? { x: sx / n, z: sz / n } : null
  }
  if (theme === 'roof')
    for (const team of ['A', 'B'])
      for (const half of [(cz: number) => cz < H / 2, (cz: number) => cz >= H / 2]) {
        const c = centroid(team, half)
        if (c) decal('H', c.x + (team === 'A' ? 3 : -3), c.z, 7, '#9fb3c8')
      }
  if (!map.br)
    for (const team of ['A', 'B']) {
      const c = centroid(team, () => true)
      if (c) decal('spawn', c.x, c.z, 2.2, team === 'A' ? '#22d3ee' : '#f97316')
    }
  let core: THREE.Mesh | null = null
  for (let cz = 0; cz < H; cz++)
    for (let cx = 0; cx < W; cx++)
      if (at(cx, cz) === '*' && !core) {
        core = decal('core', (cx + 0.5) * CELL + (at(cx + 1, cz) === '*' ? CELL / 2 : 0), (cz + 0.5) * CELL, map.zone * 2.1, map.colors[0])
        const ringGeo = new THREE.TorusGeometry(map.zone, 0.06, 6, 48)
        const ringMat = new THREE.MeshBasicMaterial({ color: neon })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.x = -Math.PI / 2
        ring.position.copy(core.position).setY(0.08)
        g.add(ring)
        disposables.push(ringGeo, ringMat)
        const c = core
        animated.push((t) => {
          c.rotation.z = t * 0.3
          ring.position.y = 0.08 + Math.sin(t * 2) * 0.04
        })
      }

  /* ---------- Beyond the walls ---------- */
  // Skybox: the alley panorama sphere around the map centre.
  const sky = instance(assets, 'env-skybox')
  if (sky) {
    sky.position.set(wm / 2, -200, hm / 2)
    g.add(sky)
  }
  if (theme === 'roof') {
    // Lower roofs around the pads, the city far below, dish and vents on the pads.
    const lowGeo = new THREE.BoxGeometry(wm + 40, 2, hm + 40)
    const lowMat = new THREE.MeshStandardMaterial({ color: '#07060f', roughness: 1 })
    const low = new THREE.Mesh(lowGeo, lowMat)
    low.position.set(wm / 2, -16, hm / 2)
    g.add(low)
    disposables.push(lowGeo, lowMat)
    for (const [x, z, yaw] of [
      [wm / 2, -60, 0],
      [wm / 2, hm + 60, Math.PI],
      [-60, hm / 2, Math.PI / 2],
      [wm + 60, hm / 2, -Math.PI / 2],
    ] as [number, number, number][])
      placeProp('env-city', x, z, yaw, [100, 20, 100], '#0b0816').position.y = -38
    const kinds = ['env-building-1', 'env-building-2', 'env-building-3', 'env-building-4', 'env-building-5', 'env-building-6']
    for (let i = 0; i < 14; i++) {
      const side = i % 4
      const x = side === 0 ? -14 - rng.next() * 10 : side === 1 ? wm + 14 + rng.next() * 10 : rng.range(-6, wm + 6)
      const z = side === 2 ? -16 - rng.next() * 10 : side === 3 ? hm + 16 + rng.next() * 10 : rng.range(-6, hm + 6)
      const o = placeProp(kinds[rng.int(kinds.length)], x, z, rng.next() * Math.PI * 2, [7, 12, 7], '#1b1630')
      o.position.y = -30 + rng.next() * 8
      o.scale.setScalar(1.6 + rng.next() * 1.2)
    }
    placeProp('env-dish', 4, 4, 0.6, [2, 3.6, 2], '#8a8a95')
    placeProp('env-dish', wm - 4, hm - 4, 0.6 + Math.PI, [2, 3.6, 2], '#8a8a95')
    placeProp('env-vent-tall', wm - 4, 4, 0, [1, 4.5, 1], '#56607a')
    placeProp('env-vent-tall', 4, hm - 4, 0, [1, 4.5, 1], '#56607a')
    // Truss bridges under the walkway edges, seen through the drop.
    for (const [x, z, yaw] of [
      [wm / 2, hm / 2 - 5.5, 0],
      [wm / 2, hm / 2 + 5.5, 0],
    ] as [number, number, number][])
      placeProp('env-bridge', x, z, yaw, [12, 3.5, 2.4], '#334').position.y = -3.3
  } else {
    // Ground outside the arena walls.
    const outGeo = new THREE.PlaneGeometry(wm + 90, hm + 90)
    const outMat = new THREE.MeshStandardMaterial({ color: theme === 'subway' ? '#101016' : '#0b0816', roughness: 1 })
    const out = new THREE.Mesh(outGeo, outMat)
    out.rotation.x = -Math.PI / 2
    out.position.set(wm / 2, -0.05, hm / 2)
    out.receiveShadow = true
    g.add(out)
    disposables.push(outGeo, outMat)
  }
  if (theme === 'street' || theme === 'district') {
    // Shop fronts pressed against the outside of the perimeter, facing in, with a ring of towers behind them and
    // the city skyline in the distance.
    const shopStep = 6.6
    for (let x = 3; x < wm - 2; x += shopStep) {
      placeProp('env-shop-a', x + 1, -1.2, 0, [6, 4.5, 1.4], '#2a2040')
      placeProp('env-shop-a', x + 3, hm + 1.2, Math.PI, [6, 4.5, 1.4], '#2a2040').scale.setScalar(0.75)
    }
    for (let z = 3; z < hm - 2; z += shopStep) {
      placeProp('env-shop-a', -1.2, z + 2, Math.PI / 2, [6, 4.5, 1.4], '#2a2040')
      placeProp('env-shop-a', wm + 1.2, z + 1, -Math.PI / 2, [6, 4.5, 1.4], '#2a2040')
    }
    const kinds = ['env-building-1', 'env-building-2', 'env-building-3', 'env-building-4', 'env-building-5', 'env-building-6']
    const step = 7.5
    const ring: [number, number, number][] = []
    // The south row sits further back and lower so it never rises between the camera and a fighter at the wall.
    for (let x = 0; x < wm + 1; x += step) ring.push([x + 1, -8 - rng.next() * 3, 0], [x + 4, hm + 13 + rng.next() * 3, Math.PI])
    for (let z = 2; z < hm - 1; z += step) ring.push([-8 - rng.next() * 3, z + 3, Math.PI / 2], [wm + 8 + rng.next() * 3, z + 1, -Math.PI / 2])
    ring.forEach(([x, z, yaw], i) => {
      const name = kinds[(i + rng.int(3)) % kinds.length]
      const o = placeProp(name, x, z, yaw + rng.next() * 0.3, [7, 9 + rng.next() * 4, 7], '#1b1630')
      o.scale.setScalar((z > hm ? 0.55 : 0.85) + rng.next() * 0.35)
    })
    if (theme === 'street') placeProp('env-hk-alley', wm / 2, -17, 0, [12, 34, 12], '#1b1630')
    for (const [x, z, yaw] of [
      [wm / 2, -75, 0],
      [-70, hm / 2, Math.PI / 2],
      [wm + 70, hm / 2, -Math.PI / 2],
      [wm / 2, hm + 80, Math.PI],
    ] as [number, number, number][])
      placeProp('env-city', x, z, yaw, [100, 20, 100], '#0b0816').position.y = -4
    // Big screens and billboards on the long sides.
    for (const [x, z, yaw] of [
      [wm * 0.3, -3.2, 0],
      [wm * 0.7, hm + 7, Math.PI],
    ] as [number, number, number][]) {
      const o = placeProp('media-facade', x, z, yaw, [7, 5, 0.6], '#0b0f2a', '#22d3ee')
      o.position.y = z > hm ? 0.5 : 5.2
    }
    for (const [x, z, yaw] of [
      [-3, hm * 0.3, Math.PI / 2],
      [wm + 3, hm * 0.7, -Math.PI / 2],
    ] as [number, number, number][])
      placeProp('giant-billboard', x, z, yaw, [6, 8, 1], '#111', '#f0abfc').position.y = 4.5
    // Holo-ads over the walls: a few floating brand panels.
    for (let i = 0; i < (map.br ? 8 : 4); i++) {
      const brand = BRANDS[(i * 3 + seed) % BRANDS.length]
      const color = ['#f0abfc', '#22d3ee', '#facc15'][i % 3]
      const t = holoTexture(brand, color)
      const geo = new THREE.PlaneGeometry(2.4, 4.8)
      const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.8, depthWrite: false })
      const holo = new THREE.Group()
      const back = new THREE.Mesh(geo, mat)
      back.rotation.y = Math.PI
      holo.add(new THREE.Mesh(geo, mat), back)
      const side = i % 4
      holo.position.set(side === 0 ? -1.5 : side === 1 ? wm + 1.5 : rng.range(6, wm - 6), 6 + rng.next() * 2, side === 2 ? -1.5 : side === 3 ? hm + 1.5 : rng.range(6, hm - 6))
      g.add(holo)
      disposables.push(t, geo, mat)
      animated.push((tm) => (holo.rotation.y = tm * 0.4 + i))
    }
  }
  if (theme === 'subway') {
    // The station concourse beyond the north wall, turnstile banks at the platform ends, lamps outside.
    const st = placeProp('env-station', wm / 2, -12, 0, [36, 9, 46], '#8a8a95')
    st.position.y = -0.1
    placeProp('env-station', wm / 2, hm + 24, Math.PI, [36, 9, 46], '#8a8a95').scale.setScalar(0.8)
    for (let x = 6; x < wm; x += 12) placeProp('led-streetlight', x, -2.2, 0, [0.2, 5, 0.2], '#777')
    for (let x = 6; x < wm; x += 12) placeProp('env-terminal', x + 4, hm + 2.5, Math.PI, [1.9, 2.2, 1.6], '#56607a')
    for (const [x, z, yaw] of [
      [-70, hm / 2, Math.PI / 2],
      [wm + 70, hm / 2, -Math.PI / 2],
    ] as [number, number, number][])
      placeProp('env-city', x, z, yaw, [100, 20, 100], '#0b0816').position.y = -4
  }

  /* ---------- Battle-royale grid ---------- */
  const edgeGeo = new THREE.BoxGeometry(1, 2.2, 0.08)
  const edgeMat = new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
  const nextMat = new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })
  const gridGroup = new THREE.Group()
  const edges: THREE.Mesh[] = []
  const nextEdges: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const e = new THREE.Mesh(edgeGeo, edgeMat)
    const n = new THREE.Mesh(edgeGeo, nextMat)
    edges.push(e)
    nextEdges.push(n)
    gridGroup.add(e, n)
  }
  gridGroup.visible = false
  g.add(gridGroup)
  disposables.push(edgeGeo, edgeMat, nextMat)
  const layout = (list: THREE.Mesh[], cx: number, cz: number, half: number, h: number) => {
    const s = half * 2
    list[0].position.set(cx, h / 2, cz - half)
    list[0].rotation.y = 0
    list[0].scale.set(s, h / 2.2, 1)
    list[1].position.set(cx, h / 2, cz + half)
    list[1].rotation.y = 0
    list[1].scale.set(s, h / 2.2, 1)
    list[2].position.set(cx - half, h / 2, cz)
    list[2].rotation.y = Math.PI / 2
    list[2].scale.set(s, h / 2.2, 1)
    list[3].position.set(cx + half, h / 2, cz)
    list[3].rotation.y = Math.PI / 2
    list[3].scale.set(s, h / 2.2, 1)
  }
  animated.push((t) => {
    edgeMat.opacity = 0.45 + Math.sin(t * 4) * 0.12
  })

  return {
    group: g,
    crates,
    animate: (t) => {
      for (const a of animated) a(t)
    },
    setGrid: (cx, cz, half, ncx, ncz, nhalf, show) => {
      gridGroup.visible = show
      gridUniform.value.set(cx, cz, half, show ? 1 : 0)
      if (!show) return
      layout(edges, cx, cz, half, 2.4)
      layout(nextEdges, ncx, ncz, nhalf, 1.2)
    },
    dispose: () => {
      for (const d of disposables) d.dispose()
    },
  }
}
