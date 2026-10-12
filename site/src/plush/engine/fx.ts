// Particles for the juice: dust, stuffing puffs, crumbs, milk drops, sparkles and confetti. One fixed-size pool per
// look, GPU points, no allocations per frame.
import * as THREE from 'three'

const VERT = `
attribute float aSize;
attribute vec4 aColor;
attribute float aSpin;
varying vec4 vColor;
varying float vSpin;
void main() {
  vColor = aColor;
  vSpin = aSpin;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

const FRAG_ROUND = `
varying vec4 vColor;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.32, d);
  if (a < 0.02) discard;
  // A soft highlight so puffs read as round fluff.
  float hl = smoothstep(0.35, 0.0, length(c + vec2(0.12, 0.12))) * 0.25;
  gl_FragColor = vec4(vColor.rgb + hl, vColor.a * a);
}`

const FRAG_SQUARE = `
varying vec4 vColor;
varying float vSpin;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vSpin), k = cos(vSpin);
  vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
  // A thin spinning paper rectangle.
  if (abs(r.x) > 0.42 || abs(r.y) > 0.42 * (0.25 + 0.75 * abs(sin(vSpin * 1.7)))) discard;
  gl_FragColor = vColor;
}`

export class Particles {
  readonly points: THREE.Points
  private max: number
  private pos: Float32Array
  private vel: Float32Array
  private col: Float32Array
  private base: Float32Array
  private size: Float32Array
  private size0: Float32Array
  private spin: Float32Array
  private spinV: Float32Array
  private life: Float32Array
  private life0: Float32Array
  private grav: number
  private next = 0
  private live = 0

  constructor(max: number, opts: { square?: boolean; gravity?: number } = {}) {
    this.max = max
    this.grav = opts.gravity ?? 0
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.col = new Float32Array(max * 4)
    this.base = new Float32Array(max * 4)
    this.size = new Float32Array(max)
    this.size0 = new Float32Array(max)
    this.spin = new Float32Array(max)
    this.spinV = new Float32Array(max)
    this.life = new Float32Array(max)
    this.life0 = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: opts.square ? FRAG_SQUARE : FRAG_ROUND,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    this.points = new THREE.Points(g, m)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  emit(px: number, py: number, pz: number, vx: number, vy: number, vz: number, life: number, size: number, color: THREE.Color, alpha = 1) {
    const i = this.next
    this.next = (this.next + 1) % this.max
    const i3 = i * 3, i4 = i * 4
    this.pos[i3] = px
    this.pos[i3 + 1] = py
    this.pos[i3 + 2] = pz
    this.vel[i3] = vx
    this.vel[i3 + 1] = vy
    this.vel[i3 + 2] = vz
    this.base[i4] = color.r
    this.base[i4 + 1] = color.g
    this.base[i4 + 2] = color.b
    this.base[i4 + 3] = alpha
    this.size0[i] = size
    this.life[i] = life
    this.life0[i] = life
    this.spin[i] = Math.random() * 6.28
    this.spinV[i] = (Math.random() - 0.5) * 14
    this.live = this.max
  }

  /** A burst of n particles. `up` biases them upward; `spread` is the start radius. */
  burst(p: THREE.Vector3Like, n: number, speed: number, life: number, size: number, color: THREE.Color, opts: { up?: number; spread?: number; alpha?: number; jitter?: number } = {}) {
    const up = opts.up ?? 0.6
    const spread = opts.spread ?? 0.15
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random()
      const vx = Math.cos(a) * r, vz = Math.sin(a) * r, vy = up * (0.4 + Math.random() * 0.8)
      const s = speed * (0.4 + Math.random() * 0.8)
      const j = opts.jitter ?? 0
      _c.copy(color)
      if (j) _c.offsetHSL((Math.random() - 0.5) * j, 0, (Math.random() - 0.5) * j)
      this.emit(p.x + vx * spread, p.y + Math.random() * spread, p.z + vz * spread, vx * s, vy * s, vz * s, life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), _c, opts.alpha ?? 1)
    }
  }

  update(dt: number) {
    if (this.live <= 0) return
    let alive = 0
    const g = this.grav * dt
    for (let i = 0; i < this.max; i++) {
      const i3 = i * 3, i4 = i * 4
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) {
          this.size[i] = 0
          this.col[i4 + 3] = 0
        }
        continue
      }
      alive++
      this.life[i] -= dt
      const t = Math.max(0, this.life[i] / this.life0[i])
      const drag = Math.max(0, 1 - 1.6 * dt)
      this.vel[i3] *= drag
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag + g
      this.vel[i3 + 2] *= drag
      this.pos[i3] += this.vel[i3] * dt
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt
      this.spin[i] += this.spinV[i] * dt
      this.col[i4] = this.base[i4]
      this.col[i4 + 1] = this.base[i4 + 1]
      this.col[i4 + 2] = this.base[i4 + 2]
      this.col[i4 + 3] = this.base[i4 + 3] * Math.min(1, t * 2.5)
      this.size[i] = this.size0[i] * (0.6 + 0.4 * Math.min(1, t * 3))
    }
    this.live = alive
    const geo = this.points.geometry
    geo.attributes.position.needsUpdate = true
    geo.attributes.aColor.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true
    geo.attributes.aSpin.needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

const _c = new THREE.Color()

export const PUFF_COLORS = {
  dust: new THREE.Color('#d8c3a5'),
  stuff: new THREE.Color('#fffaf0'),
  spark: new THREE.Color('#ffe08a'),
  crumbs: new THREE.Color('#c98a3e'),
  milk: new THREE.Color('#f8fbff'),
}

export const CONFETTI = ['#f472b6', '#facc15', '#34d399', '#60a5fa', '#f97316', '#a78bfa'].map((c) => new THREE.Color(c))
