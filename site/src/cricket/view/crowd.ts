// An instanced crowd: thousands of simple spectators (torso, head, arms) animated in the vertex shader. They bob
// when idle, jump and throw their arms up on boundaries and wickets, and run a Mexican wave round the ground.
// Seats come from the stadium (sampled on the venue model's terraces).
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

function personGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const tag = (g0: THREE.BufferGeometry, part: number) => {
    const g = g0.index ? g0.toNonIndexed() : g0
    const n = g.getAttribute('position').count
    g.setAttribute('part', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1))
    g.deleteAttribute('uv')
    return g
  }
  const torso = new THREE.BoxGeometry(0.42, 0.62, 0.26)
  torso.translate(0, 0.31, 0)
  parts.push(tag(torso, 0))
  const head = new THREE.IcosahedronGeometry(0.12, 0)
  head.translate(0, 0.76, 0)
  parts.push(tag(head, 1))
  for (const side of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.1, 0.5, 0.1)
    arm.translate(side * 0.27, 0.32, 0.02)
    parts.push(tag(arm, side < 0 ? 2 : 3))
  }
  return mergeGeometries(parts)!
}

export class Crowd {
  mesh: THREE.InstancedMesh
  private uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uWave: { value: -10 }, uWaveOn: { value: 0 } }
  private excite = 0
  private exciteTarget = 0
  private exciteHold = 0
  private waveT = -1

  constructor(seats: Float32Array, colors: [string, string], night: boolean) {
    const n = seats.length / 4
    const geo = personGeometry()
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: night ? '#2a3044' : '#000000' })
    const u = this.uniforms
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u)
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float part;
          attribute float aPhase;
          uniform float uTime; uniform float uExcite; uniform float uWave; uniform float uWaveOn;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ang = atan(ip.x, ip.z);
          float dw = abs(mod(ang - uWave + 3.14159, 6.28318) - 3.14159);
          float wave = uWaveOn * exp(-dw * dw / 0.018);
          float jump = uExcite * max(0.0, sin(uTime * (7.0 + aPhase * 3.0) + aPhase * 6.28)) * 0.28;
          float idle = sin(uTime * 1.3 + aPhase * 6.28) * 0.015;
          float raise = clamp(max(uExcite * (0.6 + 0.4 * sin(uTime * 5.0 + aPhase * 9.0)), wave), 0.0, 1.0);
          if (part > 1.5) {
            float s = part > 2.5 ? 1.0 : -1.0;
            vec3 pivot = vec3(s * 0.27, 0.55, 0.0);
            vec3 q = transformed - pivot;
            float a = s * raise * 2.6;
            float c = cos(a), sn = sin(a);
            q = vec3(q.x * c - q.y * sn, q.x * sn + q.y * c, q.z);
            transformed = pivot + q;
          }
          transformed.y += jump + idle + wave * 0.32;`,
        )
        .replace(
          '#include <color_vertex>',
          `#include <color_vertex>
          if (part > 0.5 && part < 1.5) { float t = fract(aPhase * 7.31); vColor.rgb = mix(vec3(0.95, 0.76, 0.6), vec3(0.42, 0.28, 0.2), t); }`,
        )
    }
    const mesh = new THREE.InstancedMesh(geo, mat, n)
    const phase = new Float32Array(n)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    const pal = [new THREE.Color(colors[0]), new THREE.Color(colors[1]), new THREE.Color('#f8fafc'), new THREE.Color('#1f2937'), new THREE.Color('#facc15'), new THREE.Color('#38bdf8'), new THREE.Color('#ef4444')]
    const col = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const x = seats[i * 4]
      const y = seats[i * 4 + 1]
      const z = seats[i * 4 + 2]
      const a = seats[i * 4 + 3]
      phase[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1
      if (phase[i] < 0) phase[i] += 1
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a)
      const s = 0.9 + phase[i] * 0.25
      sc.set(s, s, s)
      m.compose(new THREE.Vector3(x, y, z), q, sc)
      mesh.setMatrixAt(i, m)
      // Home fans in one half, visitors in the other, neutrals everywhere.
      const k = phase[i]
      const side = x > 0 ? 0 : 1
      col.copy(k < 0.45 ? pal[side] : k < 0.55 ? pal[1 - side] : pal[2 + Math.floor(((k - 0.55) / 0.45) * 5) % 5])
      mesh.setColorAt(i, col)
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1))
    mesh.frustumCulled = false
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.mesh = mesh
  }

  /** A burst of excitement (0..1) that lasts `hold` seconds. */
  cheer(level: number, hold = 3) {
    this.exciteTarget = Math.max(this.exciteTarget, level)
    this.exciteHold = Math.max(this.exciteHold, hold)
  }

  /** Starts a Mexican wave round the ground. */
  wave() {
    if (this.waveT < 0) this.waveT = 0
  }

  get waving() {
    return this.waveT >= 0
  }

  update(dt: number) {
    this.uniforms.uTime.value += dt
    if (this.exciteHold > 0) this.exciteHold -= dt
    else this.exciteTarget = 0
    this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 4)
    this.uniforms.uExcite.value = this.excite
    if (this.waveT >= 0) {
      this.waveT += dt
      this.uniforms.uWave.value = -Math.PI + this.waveT * 0.9
      this.uniforms.uWaveOn.value = Math.min(1, this.waveT * 2) * Math.min(1, Math.max(0, (14 - this.waveT) / 2))
      if (this.waveT > 14) {
        this.waveT = -1
        this.uniforms.uWaveOn.value = 0
      }
    }
  }
}

/** Seat positions on a plain elliptical ring of tiers (the fallback venue): [x, y, z, facing angle]. */
export function ringSeats(count: number, seed: number, rx: number, rz: number, depth: number, y0: number, rise: number): Float32Array {
  const out = new Float32Array(count * 4)
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const rows = 14
  let i = 0
  let guard = 0
  while (i < count && guard++ < count * 20) {
    const a = rnd() * Math.PI * 2
    if (Math.abs(Math.sin(a)) < 0.18) continue
    const r = Math.floor(rnd() * rows)
    const d = ((r + 0.55) / rows) * depth
    const y = y0 + ((r + 1) / rows) * rise
    const x = Math.sin(a) * (rx + d)
    const z = Math.cos(a) * (rz + d)
    out[i * 4] = x
    out[i * 4 + 1] = y
    out[i * 4 + 2] = z
    out[i * 4 + 3] = Math.atan2(-x, -z)
    i++
  }
  return out.subarray(0, i * 4)
}
