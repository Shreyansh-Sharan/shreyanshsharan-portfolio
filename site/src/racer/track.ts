// Track: a closed spline from which the road, walls, checkpoints, pickups, AI line and scenery derive.
// An arena (the Dust Bowl) is a Track with an `arena` layout: physics, respawns and AI use that instead of the road.
import * as THREE from 'three'
import { CONFIG } from './config'
import { normalizeModel, type RacerAssets } from './assets'
import type { ArenaLayout } from './arena'

export type PowerType = 'shunt' | 'barge' | 'bolt' | 'mine' | 'shock' | 'nitro' | 'shield' | 'repair' | 'rail' | 'flak' | 'oil' | 'ram'

export const POWER_COLORS: Record<PowerType, string> = {
  shunt: '#ff3355',
  barge: '#a855f7',
  bolt: '#ff4fd8',
  mine: '#ff9a1f',
  shock: '#5ad7ff',
  nitro: '#3dff8a',
  shield: '#f8fafc',
  repair: '#ffd23f',
  rail: '#4d7cff',
  flak: '#b6ff2e',
  oil: '#19e6c1',
  ram: '#a8b8cc',
}

const HARBOR: [number, number][] = [
  [0, 0], [260, 0], [380, -40], [420, -160], [360, -260], [220, -280], [150, -360], [180, -470], [320, -520],
  [470, -480], [560, -380], [600, -200], [640, 0], [600, 170], [480, 250], [300, 230], [180, 160], [60, 170],
  [-60, 120], [-80, 40],
]

export interface PickupSlot {
  s: number
  lateral: number
  kind: 'any' | 'weapon' | 'support'
}

export class Track {
  readonly name: string
  readonly reversed: boolean
  readonly n: number
  readonly length: number
  readonly px: Float32Array
  readonly pz: Float32Array
  readonly tx: Float32Array
  readonly tz: Float32Array
  readonly curv: Float32Array
  readonly s: Float32Array
  readonly half = CONFIG.track_width / 2
  readonly checkpoints: number[] = []
  readonly pickups: PickupSlot[] = []
  readonly fanRuns: number[] = []
  readonly step: number
  /** Open arena (no road): cars are bounded by the bowl, there are no laps, checkpoints or racing line. */
  readonly arena: ArenaLayout | null

  constructor(name: string, reversed = false, arena: ArenaLayout | null = null) {
    this.name = name
    this.reversed = reversed
    this.arena = arena
    // An arena keeps a small circular centreline so anything that asks for `s` still gets a sane answer.
    const ring: [number, number][] = Array.from({ length: 24 }, (_, k) => [Math.cos((k / 24) * Math.PI * 2) * 40, Math.sin((k / 24) * Math.PI * 2) * 40])
    const pts = (arena ? ring : reversed ? [...HARBOR].reverse() : HARBOR).map(([x, z]) => new THREE.Vector3(x, 0, z))
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5)
    const approx = curve.getLength()
    this.n = Math.round(approx / 2)
    const sp = curve.getSpacedPoints(this.n)
    this.px = new Float32Array(this.n)
    this.pz = new Float32Array(this.n)
    this.tx = new Float32Array(this.n)
    this.tz = new Float32Array(this.n)
    this.curv = new Float32Array(this.n)
    this.s = new Float32Array(this.n)
    for (let i = 0; i < this.n; i++) {
      this.px[i] = sp[i].x
      this.pz[i] = sp[i].z
    }
    let acc = 0
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n
      const dx = this.px[j] - this.px[i], dz = this.pz[j] - this.pz[i]
      const len = Math.hypot(dx, dz)
      this.tx[i] = dx / len
      this.tz[i] = dz / len
      this.s[i] = acc
      acc += len
    }
    this.length = acc
    this.step = acc / this.n
    for (let i = 0; i < this.n; i++) {
      const p = (i - 3 + this.n) % this.n, q = (i + 3) % this.n
      const a0 = Math.atan2(this.tz[p], this.tx[p]), a1 = Math.atan2(this.tz[q], this.tx[q])
      let d = a1 - a0
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.curv[i] = Math.abs(d) / (6 * this.step) // rad per metre
    }
    if (arena) return

    for (let s = 150; s < this.length - 20; s += 150) this.checkpoints.push(this.index(s))

    // Pickup rows every ~320 m, 3–5 icons across the road; support rows after the twistiest section.
    const twistiest = this.twistiestRegion()
    let row = 0
    for (let s = 140; s < this.length - 80; s += 300 + ((row * 37) % 60)) {
      const width = 3 + (row % 3)
      const kind: PickupSlot['kind'] = Math.abs(s - twistiest) < 260 && s > twistiest ? 'support' : 'any'
      for (let k = 0; k < width; k++) this.pickups.push({ s, lateral: (k - (width - 1) / 2) * 3.4, kind })
      row++
    }
    // Fan Runs on the two longest straights.
    this.fanRuns.push(...this.longStraights(2))
  }

  index(s: number) {
    const w = ((s % this.length) + this.length) % this.length
    return Math.min(this.n - 1, Math.floor(w / this.step))
  }

  /** Closest centreline sample, searching near `hint` (or everywhere when hint < 0). */
  nearest(x: number, z: number, hint = -1) {
    let best = 0, bestD = Infinity
    const scan = (i: number) => {
      const dx = x - this.px[i], dz = z - this.pz[i]
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (hint < 0) for (let i = 0; i < this.n; i++) scan(i)
    else for (let k = -40; k <= 40; k++) scan((hint + k + this.n) % this.n)
    const dx = x - this.px[best], dz = z - this.pz[best]
    // Right-hand normal of the tangent (x, z) is (-z, x).
    const lateral = dx * -this.tz[best] + dz * this.tx[best]
    const along = dx * this.tx[best] + dz * this.tz[best]
    return { i: best, lateral, s: this.s[best] + along }
  }

  point(s: number, lateral = 0, out = new THREE.Vector3()) {
    const i = this.index(s)
    const f = (((s % this.length) + this.length) % this.length - this.s[i]) / this.step
    const j = (i + 1) % this.n
    const x = this.px[i] + (this.px[j] - this.px[i]) * f, z = this.pz[i] + (this.pz[j] - this.pz[i]) * f
    return out.set(x + -this.tz[i] * lateral, 0, z + this.tx[i] * lateral)
  }

  heading(s: number) {
    const i = this.index(s)
    return Math.atan2(this.tx[i], this.tz[i])
  }

  /** Max curvature over [s, s + span] — used by AI to brake for corners. */
  curvatureAhead(s: number, span: number) {
    let m = 0
    for (let d = 0; d < span; d += this.step * 2) m = Math.max(m, this.curv[this.index(s + d)])
    return m
  }

  private twistiestRegion() {
    let best = 0, bestV = -1
    for (let s = 0; s < this.length; s += 20) {
      let v = 0
      for (let d = 0; d < 200; d += 10) v += this.curv[this.index(s + d)]
      if (v > bestV) {
        bestV = v
        best = s + 200
      }
    }
    return best % this.length
  }

  private longStraights(count: number) {
    const runs: { s: number; len: number }[] = []
    let start = -1
    for (let i = 0; i <= this.n; i++) {
      const straight = i < this.n && this.curv[i] < 0.004
      if (straight && start < 0) start = i
      if (!straight && start >= 0) {
        runs.push({ s: this.s[start] + 20, len: (i - start) * this.step })
        start = -1
      }
    }
    return runs
      .sort((a, b) => b.len - a.len)
      .slice(0, count)
      .map((r) => r.s)
  }
}

/* ---------- Visuals ---------- */

function windowTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#080a14'
  g.fillRect(0, 0, 64, 128)
  const colors = ['#5eead4', '#f472b6', '#fde68a', '#93c5fd', '#c084fc']
  for (let y = 4; y < 128; y += 8)
    for (let x = 4; x < 64; x += 8)
      if (Math.random() < 0.45) {
        g.fillStyle = colors[Math.floor(Math.random() * colors.length)]
        g.globalAlpha = 0.35 + Math.random() * 0.65
        g.fillRect(x, y, 4, 4)
      }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Road: textured wet asphalt (PBR, so it picks up reflections), with lane dashes and neon edges added in the shader. */
function roadMaterial(track: Track, asphalt?: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({
    color: asphalt ? '#454a56' : '#15171f',
    map: asphalt ?? null,
    roughnessMap: asphalt ?? null,
    roughness: asphalt ? 0.55 : 0.8,
    metalness: 0.1,
    envMapIntensity: 0.45,
  })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLength = { value: track.length }
    sh.uniforms.uEdgeA = { value: new THREE.Color('#22d3ee') }
    sh.uniforms.uEdgeB = { value: new THREE.Color('#f0abfc') }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad;\nvarying vec2 vRoad;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLength; uniform vec3 uEdgeA; uniform vec3 uEdgeB; varying vec2 vRoad;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float across = vRoad.x; float along = vRoad.y;
        float dash = step(0.5, fract(along / 9.0)) * (1.0 - smoothstep(0.004, 0.007, abs(across - 0.5)));
        float lane = (1.0 - smoothstep(0.002, 0.004, abs(across - 0.06))) + (1.0 - smoothstep(0.002, 0.004, abs(across - 0.94)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.85, 0.75), clamp(dash * 0.8 + lane * 0.7, 0.0, 1.0));
        float edge = 1.0 - smoothstep(0.0, 0.022, min(across, 1.0 - across));
        totalEmissiveRadiance += mix(uEdgeA, uEdgeB, step(0.5, across)) * edge * 3.2;
        totalEmissiveRadiance += vec3(0.9, 0.9, 0.8) * clamp(dash + lane, 0.0, 1.0) * 0.25;
        if (along < 6.0) {
          float chk = mod(floor(across * 12.0) + floor(along / 1.5), 2.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(chk), 0.85);
        }`,
      )
  }
  return mat
}

/** Box buildings with a facade texture mapped in world space, so windows keep their size on any building. */
function facadeMaterial(facade?: THREE.Texture) {
  const tex = facade ?? windowTexture()
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.35, metalness: 0.55 })
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFac; varying float vRoof;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        mat4 fm = modelMatrix;
        #ifdef USE_INSTANCING
          fm = modelMatrix * instanceMatrix;
        #endif
        vec4 fw = fm * vec4(position, 1.0);
        vec3 fn = normalize(mat3(fm) * normal);
        vRoof = step(0.5, fn.y);
        vFac = vec2(dot(fw.xz, vec2(-fn.z, fn.x)) / 26.0, fw.y / 38.0);`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFac; varying float vRoof;')
      .replace('#include <map_fragment>', 'vec4 fTex = texture2D(map, vFac); diffuseColor *= mix(fTex, vec4(0.05, 0.05, 0.07, 1.0), vRoof);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= mix(fTex.rgb * fTex.rgb * 1.6, vec3(0.0), vRoof);')
  }
  return mat
}

/** Instanced copies of every mesh in a (normalised) model. */
function instanced(model: THREE.Object3D, matrices: THREE.Matrix4[]) {
  const group = new THREE.Group()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !matrices.length) return
    const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length)
    const local = m.matrixWorld
    const tmp = new THREE.Matrix4()
    matrices.forEach((mat, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mat, local)))
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
    group.add(im)
  })
  return group
}

function poolTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export function buildTrackScene(track: Track, scene: THREE.Scene, assets?: RacerAssets) {
  const group = new THREE.Group()
  const W = CONFIG.track_width
  const tex = assets?.textures ?? {}
  const props = assets?.props

  // Road ribbon: uv in metres for the asphalt texture, aRoad = (across 0..1, metres along) for markings.
  const n = track.n
  const pos = new Float32Array((n + 1) * 2 * 3)
  const uv = new Float32Array((n + 1) * 2 * 2)
  const road = new Float32Array((n + 1) * 2 * 2)
  const idx: number[] = []
  for (let k = 0; k <= n; k++) {
    const i = k % n
    const nx = -track.tz[i], nz = track.tx[i]
    const along = k === n ? track.length : track.s[i]
    for (let side = 0; side < 2; side++) {
      const o = side === 0 ? -W / 2 : W / 2
      const v = k * 2 + side
      pos.set([track.px[i] + nx * o, 0.02, track.pz[i] + nz * o], v * 3)
      uv.set([(side * W) / 6, along / 6], v * 2)
      road.set([side, along], v * 2)
    }
    if (k < n) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3
      idx.push(a, b, c, b, d, c)
    }
  }
  const roadGeo = new THREE.BufferGeometry()
  roadGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  roadGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  roadGeo.setAttribute('aRoad', new THREE.BufferAttribute(road, 2))
  roadGeo.setIndex(idx)
  roadGeo.computeVertexNormals()
  group.add(new THREE.Mesh(roadGeo, roadMaterial(track, tex.asphalt)))

  // Barriers: hazard-striped metal panels with an emissive top strip.
  const wallH = 1.1
  const wallPos: number[] = []
  const wallUv: number[] = []
  const stripPos: number[] = []
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < n; k++) {
      const i = k, j = (k + 1) % n
      const o = side * (W / 2 + 0.6)
      const ax = track.px[i] - track.tz[i] * o, az = track.pz[i] + track.tx[i] * o
      const bx = track.px[j] - track.tz[j] * o, bz = track.pz[j] + track.tx[j] * o
      const u0 = track.s[i] / 2.2, u1 = u0 + track.step / 2.2
      wallPos.push(ax, 0, az, bx, 0, bz, ax, wallH, az, bx, 0, bz, bx, wallH, bz, ax, wallH, az)
      wallUv.push(u0, 0, u1, 0, u0, 0.5, u1, 0, u1, 0.5, u0, 0.5)
      stripPos.push(ax, wallH, az, bx, wallH, bz, ax, wallH + 0.12, az, bx, wallH, bz, bx, wallH + 0.12, bz, ax, wallH + 0.12, az)
    }
  }
  const wallGeo = new THREE.BufferGeometry()
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3))
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUv, 2))
  wallGeo.computeVertexNormals()
  group.add(new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: tex.metal ? '#c8ccd6' : '#1a1d2b', map: tex.metal ?? null, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide })))
  const stripGeo = new THREE.BufferGeometry()
  stripGeo.setAttribute('position', new THREE.Float32BufferAttribute(stripPos, 3))
  group.add(new THREE.Mesh(stripGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3df2').multiplyScalar(2.2), side: THREE.DoubleSide, toneMapped: false })))

  // Ground (harbour concrete) and water.
  if (tex.concrete) {
    const c = tex.concrete.clone()
    c.repeat.set(160, 160)
    c.needsUpdate = true
    tex.concrete = c
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: tex.concrete ? '#6b6f7a' : '#0d0f18', map: tex.concrete ?? null, roughness: 0.9 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  group.add(ground)
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 600),
    new THREE.MeshStandardMaterial({ color: '#06243a', roughness: 0.08, metalness: 0.8, emissive: '#031522', emissiveIntensity: 0.6 }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.set(300, 0.01, 620)
  group.add(water)

  // Start gantry: the generated arch, or a simple neon beam.
  const p0 = track.point(0), h0 = track.heading(0)
  const gantryModel = props?.get('gantry')
  if (gantryModel) {
    const { object } = normalizeModel(gantryModel, { length: W + 5, frontAxis: 'z' })
    object.position.copy(p0)
    object.rotation.y = h0 + Math.PI / 2
    group.add(object)
  } else {
    const gantry = new THREE.Group()
    gantry.position.copy(p0)
    gantry.rotation.y = h0 + Math.PI / 2
    const postMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.6, roughness: 0.3 })
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), postMat)
      post.position.set(s * (W / 2 + 1.2), 4.5, 0)
      gantry.add(post)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 3.2, 1.6, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#22d3ee').multiplyScalar(1.8), toneMapped: false }))
    beam.position.y = 9
    gantry.add(beam)
    group.add(gantry)
  }

  // Scenery: buildings, generated towers, container stacks, cranes, billboards and lamps, kept clear of the road.
  const rnd = mulberry32(track.reversed ? 9 : 7)
  const buildings: THREE.Matrix4[] = []
  const towers: THREE.Matrix4[] = []
  const containers: THREE.Matrix4[] = []
  const containerColors: THREE.Color[] = []
  const cranes: THREE.Matrix4[] = []
  const palette = ['#b91c1c', '#1d4ed8', '#047857', '#c2410c', '#6d28d9', '#0e7490']
  const clear = (x: number, z: number, margin: number) => distToTrack(track, x, z) > W / 2 + margin
  const q = new THREE.Quaternion()
  for (let k = 0; k < 560; k++) {
    const i = Math.floor(rnd() * n)
    const side = rnd() < 0.5 ? -1 : 1
    const off = side * (W / 2 + 12 + rnd() * 80)
    const x = track.px[i] - track.tz[i] * off, z = track.pz[i] + track.tx[i] * off
    if (!clear(x, z, 10)) continue
    const yaw = Math.atan2(track.tx[i], track.tz[i])
    q.setFromEuler(new THREE.Euler(0, yaw, 0))
    if (z > 300) {
      if (rnd() < 0.06 && clear(x, z, 30)) {
        cranes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1)))
        continue
      }
      // Docks side: container stacks.
      const stack = 1 + Math.floor(rnd() * 3)
      for (let h = 0; h < stack; h++) {
        containers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 1.3 + h * 2.6, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + (rnd() < 0.5 ? 0 : Math.PI / 2), 0)), new THREE.Vector3(2.5, 2.6, 12)))
        containerColors.push(new THREE.Color(palette[Math.floor(rnd() * palette.length)]))
      }
    } else if (props?.get('tower') && rnd() < 0.3 && clear(x, z, 22)) {
      const s = 0.8 + rnd() * 0.7
      towers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s)))
    } else {
      const h = 14 + rnd() * 70
      const w = 12 + rnd() * 20
      buildings.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(w, h, w * (0.6 + rnd() * 0.6))))
    }
  }
  const bMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), facadeMaterial(tex.facade), buildings.length)
  buildings.forEach((m, i) => bMesh.setMatrixAt(i, m))
  group.add(bMesh)
  const towerModel = props?.get('tower')
  if (towerModel && towers.length) group.add(instanced(normalizeModel(towerModel, { height: 95 }).object, towers))
  const craneModel = props?.get('crane')
  if (craneModel && cranes.length) group.add(instanced(normalizeModel(craneModel, { height: 42 }).object, cranes))
  const cMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.5, map: tex.metal ?? null }), containers.length)
  containers.forEach((m, i) => {
    cMesh.setMatrixAt(i, m)
    cMesh.setColorAt(i, containerColors[i])
  })
  group.add(cMesh)

  // Street lamps on both sides with warm light pools on the asphalt.
  const lamps: THREE.Matrix4[] = []
  const bulbs: THREE.Matrix4[] = []
  const pools: THREE.Matrix4[] = []
  const lampModel = props?.get('lamp')
  for (let s = 0; s < track.length; s += 42) {
    for (const side of [-1, 1]) {
      const i = track.index(s)
      const p = track.point(s, side * (W / 2 + 2.0))
      // The generated lamp's arm points along its +x: turn it to reach over the road.
      const yaw = Math.atan2(side * track.tx[i], side * track.tz[i])
      lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, lampModel ? yaw : 0, 0)), new THREE.Vector3(1, 1, 1)))
      const head = track.point(s, side * (W / 2 - 0.4))
      bulbs.push(new THREE.Matrix4().makeTranslation(head.x, 7.7, head.z))
      pools.push(new THREE.Matrix4().compose(new THREE.Vector3(head.x, 0.05, head.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(12, 12, 1)))
    }
  }
  if (lampModel) group.add(instanced(normalizeModel(lampModel, { height: 8.2, frontAxis: 'z' }).object, lamps))
  else group.add(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 7.6, 6).translate(0, 3.8, 0), new THREE.MeshStandardMaterial({ color: '#2b3245' }), lamps.length))
  const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff4ff').multiplyScalar(2.6), toneMapped: false }), bulbs.length)
  bulbs.forEach((m, i) => bulb.setMatrixAt(i, m))
  group.add(bulb)
  const pool = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color('#9fe8ff').multiplyScalar(0.14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    pools.length,
  )
  pools.forEach((m, i) => pool.setMatrixAt(i, m))
  group.add(pool)

  // Holographic billboards facing the road.
  const bbModel = props?.get('billboard')
  if (bbModel) {
    const bb: THREE.Matrix4[] = []
    for (let s = 120; s < track.length; s += 260) {
      const side = (Math.floor(s / 260) % 2) * 2 - 1
      const i = track.index(s)
      const p = track.point(s, side * (W / 2 + 9))
      const yaw = Math.atan2(side * track.tx[i], side * track.tz[i])
      bb.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)))
    }
    group.add(instanced(normalizeModel(bbModel, { height: 16, frontAxis: 'z' }).object, bb))
  }

  // Big neon sign.
  group.add(neonSign('VOLT RIOT', track.point(track.length * 0.5, W / 2 + 26), track.heading(track.length * 0.5) + Math.PI / 2))

  scene.add(group)
  return group
}

function distToTrack(track: Track, x: number, z: number) {
  let best = Infinity
  for (let i = 0; i < track.n; i += 2) best = Math.min(best, (x - track.px[i]) ** 2 + (z - track.pz[i]) ** 2)
  return Math.sqrt(best)
}

function neonSign(text: string, at: THREE.Vector3, yaw: number) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  g.font = '900 150px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = '#ff3df2'
  g.shadowBlur = 40
  g.fillStyle = '#ffd6fb'
  g.fillText(text, 512, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(48, 12), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(2, 2, 2) }))
  sign.position.set(at.x, 22, at.z)
  sign.rotation.y = yaw
  return sign
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
