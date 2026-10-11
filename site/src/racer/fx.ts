// Visual effects: GPU point particles, emissive ribbon trails and the power-up glyphs (used on track and in the HUD).
import * as THREE from 'three'
import { POWER_COLORS, type PowerType } from './track'

/* ---------- Particles ---------- */

const P_VERT = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (420.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`
const P_FRAG = `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`

export class Particles {
  readonly points: THREE.Points
  private max: number
  private pos: Float32Array
  private vel: Float32Array
  private col: Float32Array
  private base: Float32Array // r g b a at birth
  private size: Float32Array
  private size0: Float32Array
  private life: Float32Array
  private life0: Float32Array
  private grow: Float32Array
  private drag: Float32Array
  private next = 0

  constructor(max: number, additive: boolean) {
    this.max = max
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.col = new Float32Array(max * 4)
    this.base = new Float32Array(max * 4)
    this.size = new Float32Array(max)
    this.size0 = new Float32Array(max)
    this.life = new Float32Array(max)
    this.life0 = new Float32Array(max)
    this.grow = new Float32Array(max)
    this.drag = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const m = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    })
    this.points = new THREE.Points(g, m)
    this.points.frustumCulled = false
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: THREE.Color, alpha = 1, grow = 0, drag = 0.5) {
    const i = this.next
    this.next = (this.next + 1) % this.max
    this.pos.set([p.x, p.y, p.z], i * 3)
    this.vel.set([v.x, v.y, v.z], i * 3)
    this.base.set([color.r, color.g, color.b, alpha], i * 4)
    this.size0[i] = size
    this.life[i] = life
    this.life0[i] = life
    this.grow[i] = grow
    this.drag[i] = drag
  }

  burst(p: THREE.Vector3, n: number, speed: number, life: number, size: number, color: THREE.Color, alpha = 1, up = 0.4, grow = 0) {
    const v = new THREE.Vector3()
    for (let k = 0; k < n; k++) {
      v.set(Math.random() - 0.5, Math.random() * up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7))
      this.emit(p, v, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, alpha, grow)
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0
        this.size[i] = 0
        continue
      }
      this.life[i] -= dt
      const t = Math.max(0, this.life[i] / this.life0[i])
      const d = Math.max(0, 1 - this.drag[i] * dt)
      for (let k = 0; k < 3; k++) {
        this.vel[i * 3 + k] *= d
        this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt
      }
      this.col[i * 4] = this.base[i * 4]
      this.col[i * 4 + 1] = this.base[i * 4 + 1]
      this.col[i * 4 + 2] = this.base[i * 4 + 2]
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * t
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - t))
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.aColor.needsUpdate = true
    g.attributes.aSize.needsUpdate = true
  }
}

/* ---------- Ribbon trails ---------- */

/** A flat, fading, additive ribbon that follows a point: power-up trails and Nitro streaks. */
export class Trail {
  readonly mesh: THREE.Mesh
  private pts: THREE.Vector3[] = []
  private len: number
  private width: number
  private geo: THREE.BufferGeometry
  private posArr: Float32Array
  private alphaArr: Float32Array
  private vertical: boolean

  constructor(color: string, width: number, len = 24, intensity = 2.2, vertical = false) {
    this.len = len
    this.width = width
    this.vertical = vertical
    this.posArr = new Float32Array(len * 2 * 3)
    this.alphaArr = new Float32Array(len * 2)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage))
    const idx: number[] = []
    for (let i = 0; i < len - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    this.geo.setIndex(idx)
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.mesh = new THREE.Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
  }

  reset() {
    this.pts.length = 0
    this.alphaArr.fill(0)
    this.geo.attributes.aAlpha.needsUpdate = true
  }

  push(p: THREE.Vector3, fade = 1) {
    const last = this.pts[0]
    if (last && last.distanceToSquared(p) < 0.04) {
      last.copy(p)
    } else {
      this.pts.unshift(p.clone())
      if (this.pts.length > this.len) this.pts.pop()
    }
    const n = this.pts.length
    const side = new THREE.Vector3()
    for (let i = 0; i < this.len; i++) {
      if (i >= n || n < 2) {
        this.alphaArr[i * 2] = this.alphaArr[i * 2 + 1] = 0
        continue
      }
      const a = this.pts[i], b = this.pts[Math.min(n - 1, i + 1)], c = this.pts[Math.max(0, i - 1)]
      const t = 1 - i / (n - 1)
      const w = this.width * (0.25 + 0.75 * t)
      if (this.vertical) side.set(0, w / 2, 0)
      else {
        side.set(-(c.z - b.z), 0, c.x - b.x)
        const l = side.length() || 1
        side.multiplyScalar(w / 2 / l)
      }
      this.posArr.set([a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z], i * 6)
      this.alphaArr[i * 2] = this.alphaArr[i * 2 + 1] = t * t * fade
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true
  }

  fadeOut(k: number) {
    for (let i = 0; i < this.alphaArr.length; i++) this.alphaArr[i] *= k
    this.geo.attributes.aAlpha.needsUpdate = true
  }
}

/* ---------- Power-up glyphs ---------- */

const glyphCache = new Map<PowerType, HTMLCanvasElement>()

/** A 128 px glyph for each power-up, drawn in code so it works offline and matches between track and HUD. */
export function glyphCanvas(type: PowerType) {
  const cached = glyphCache.get(type)
  if (cached) return cached
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const col = POWER_COLORS[type]
  g.translate(64, 64)
  // Disc.
  const grd = g.createRadialGradient(0, 0, 10, 0, 0, 60)
  grd.addColorStop(0, col)
  grd.addColorStop(0.75, col)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.globalAlpha = 0.35
  g.fillStyle = grd
  g.beginPath()
  g.arc(0, 0, 60, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha = 1
  g.lineWidth = 6
  g.strokeStyle = col
  g.beginPath()
  g.arc(0, 0, 52, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#ffffff'
  g.lineWidth = 8
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.shadowColor = col
  g.shadowBlur = 12
  g.beginPath()
  switch (type) {
    case 'shunt': // homing orb with a chevron
      g.arc(-4, 0, 16, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.moveTo(14, -24)
      g.lineTo(34, 0)
      g.lineTo(14, 24)
      g.stroke()
      break
    case 'barge': // shockwave rings
      g.arc(0, 0, 10, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.arc(0, 0, 24, 0, Math.PI * 2)
      g.stroke()
      g.beginPath()
      g.lineWidth = 5
      g.arc(0, 0, 37, 0, Math.PI * 2)
      g.stroke()
      break
    case 'bolt': // three darts
      for (const y of [-18, 0, 18]) {
        g.beginPath()
        g.moveTo(-26, y)
        g.lineTo(22, y)
        g.stroke()
        g.beginPath()
        g.moveTo(30, y)
        g.lineTo(18, y - 7)
        g.lineTo(18, y + 7)
        g.closePath()
        g.fill()
      }
      break
    case 'mine': // spiked ball
      g.arc(0, 0, 17, 0, Math.PI * 2)
      g.fill()
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        g.beginPath()
        g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18)
        g.lineTo(Math.cos(a) * 32, Math.sin(a) * 32)
        g.stroke()
      }
      break
    case 'shock': // lightning bolt over a dome
      g.moveTo(6, -38)
      g.lineTo(-14, 2)
      g.lineTo(2, 2)
      g.lineTo(-8, 36)
      g.lineTo(18, -8)
      g.lineTo(2, -8)
      g.closePath()
      g.fill()
      break
    case 'nitro': // flame
      g.moveTo(0, -36)
      g.bezierCurveTo(26, -8, 24, 22, 0, 34)
      g.bezierCurveTo(-24, 22, -26, -8, 0, -36)
      g.fill()
      g.fillStyle = POWER_COLORS.nitro
      g.beginPath()
      g.moveTo(0, -8)
      g.bezierCurveTo(12, 6, 10, 22, 0, 26)
      g.bezierCurveTo(-10, 22, -12, 6, 0, -8)
      g.fill()
      break
    case 'shield':
      g.moveTo(0, -34)
      g.lineTo(28, -22)
      g.bezierCurveTo(28, 10, 16, 26, 0, 36)
      g.bezierCurveTo(-16, 26, -28, 10, -28, -22)
      g.closePath()
      g.fill()
      break
    case 'repair': // cross
      g.fillRect(-9, -30, 18, 60)
      g.fillRect(-30, -9, 60, 18)
      break
    case 'rail': // two rails with a beam between them
      g.lineWidth = 6
      for (const y of [-16, 16]) {
        g.beginPath()
        g.moveTo(-32, y)
        g.lineTo(26, y)
        g.stroke()
      }
      g.fillRect(-36, -4, 74, 8)
      g.beginPath()
      g.moveTo(38, 0)
      g.lineTo(28, -10)
      g.lineTo(28, 10)
      g.closePath()
      g.fill()
      break
    case 'flak': // a spread of pellets from a muzzle
      g.fillRect(-34, -8, 16, 16)
      for (let k = 0; k < 5; k++) {
        const a = ((k - 2) / 2) * 0.55
        for (const r of [8, 26]) {
          g.beginPath()
          g.arc(-14 + Math.cos(a) * (r + 12), Math.sin(a) * (r + 12), r > 10 ? 5 : 3.5, 0, Math.PI * 2)
          g.fill()
        }
      }
      break
    case 'oil': // a drop over a puddle
      g.moveTo(0, -36)
      g.bezierCurveTo(20, -8, 18, 14, 0, 16)
      g.bezierCurveTo(-18, 14, -20, -8, 0, -36)
      g.fill()
      g.beginPath()
      g.ellipse(0, 28, 30, 7, 0, 0, Math.PI * 2)
      g.fill()
      break
    case 'ram': // an armoured plough wedge
      g.moveTo(34, 0)
      g.lineTo(-6, -32)
      g.lineTo(-30, -32)
      g.lineTo(-30, 32)
      g.lineTo(-6, 32)
      g.closePath()
      g.fill()
      g.strokeStyle = col
      g.lineWidth = 5
      g.beginPath()
      g.moveTo(-18, -20)
      g.lineTo(-18, 20)
      g.stroke()
      break
  }
  glyphCache.set(type, c)
  return c
}

const urlCache = new Map<PowerType, string>()
export function glyphUrl(type: PowerType) {
  let u = urlCache.get(type)
  if (!u) {
    u = glyphCanvas(type).toDataURL()
    urlCache.set(type, u)
  }
  return u
}

const texCache = new Map<PowerType, THREE.Texture>()
export function glyphTexture(type: PowerType) {
  let t = texCache.get(type)
  if (!t) {
    t = new THREE.CanvasTexture(glyphCanvas(type))
    t.colorSpace = THREE.SRGBColorSpace
    texCache.set(type, t)
  }
  return t
}

/** Fan Run icon: a gold star ring. */
export function fanRunTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.translate(64, 64)
  g.strokeStyle = '#ffd23f'
  g.lineWidth = 7
  g.shadowColor = '#ffd23f'
  g.shadowBlur = 16
  g.beginPath()
  g.arc(0, 0, 54, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#fff4c2'
  g.beginPath()
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 38 : 16
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  g.closePath()
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/* ---------- Speed lines ---------- */

/**
 * Screen-space speed streaks: thin radial lines rushing out from the centre, only round the edges of the view.
 * A fullscreen quad drawn last in the main pass (no extra post-processing). `uAmt` 0 hides it.
 */
export function speedLines() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uAspect: { value: 1 }, uColor: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uAmt; uniform float uAspect; uniform vec3 uColor;
      float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float r = length(p);
        float u = atan(p.y, p.x) / 6.2831853 + 0.5;
        float k = 180.0;
        float bin = floor(u * k);
        float h = hash(bin), h2 = hash(bin + 31.7);
        float live = step(0.42, h);
        float line = pow(1.0 - abs(fract(u * k) - 0.5) * 2.0, 3.0);
        float head = fract(h2 * 9.0 + uTime * (1.4 + h * 2.2));
        float rr = r * 1.15;
        float seg = smoothstep(head - 0.3 - h * 0.2, head, rr) * (1.0 - smoothstep(head, head + 0.015, rr));
        float edge = smoothstep(0.22, 0.62, r);
        float a = seg * line * live * edge * uAmt;
        gl_FragColor = vec4(uColor * a * 1.4, a);
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 1000
  mesh.visible = false
  return { mesh, uniforms: mat.uniforms as { uTime: { value: number }; uAmt: { value: number }; uAspect: { value: number }; uColor: { value: THREE.Color } } }
}
