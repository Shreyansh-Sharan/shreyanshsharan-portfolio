// Effects: a pooled particle cloud (sparks, smoke, flame, muzzle flashes, death bursts), expanding shock rings,
// a reusable flash light, floating damage numbers (drawn by the overlay) and camera shake.
import * as THREE from 'three'
import { glowTexture } from './textures'

const MAX = 2400

export interface FloatText {
  x: number
  z: number
  y: number
  text: string
  color: string
  life: number
  vy: number
  size: number
  /** Second line under the main text (counter popups). */
  sub?: string
  /** Big banner style (counter popups). */
  banner?: boolean
}

export class Fx {
  readonly group = new THREE.Group()
  readonly texts: FloatText[] = []
  shake = 0
  private pos = new Float32Array(MAX * 3)
  private col = new Float32Array(MAX * 3)
  private size = new Float32Array(MAX)
  private vel = new Float32Array(MAX * 3)
  private life = new Float32Array(MAX)
  private maxLife = new Float32Array(MAX)
  private grav = new Float32Array(MAX)
  private baseSize = new Float32Array(MAX)
  private head = 0
  private points: THREE.Points
  private geo: THREE.BufferGeometry
  private mat: THREE.PointsMaterial
  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; r: number }[] = []
  private ringGeo = new THREE.RingGeometry(0.8, 1, 40)
  readonly flash: THREE.PointLight
  private flashLife = 0
  private budget: number

  constructor(quality: number) {
    this.budget = quality >= 2 ? 1 : quality === 1 ? 0.6 : 0.3
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    this.mat = new THREE.PointsMaterial({ size: 0.5, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })
    // Per-particle size through the `size` attribute.
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('uniform float size;', 'uniform float size; attribute float size2;').replace('gl_PointSize = size;', 'gl_PointSize = size * size2;')
    }
    this.geo.setAttribute('size2', new THREE.BufferAttribute(this.size, 1))
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.group.add(this.points)
    this.flash = new THREE.PointLight('#ffffff', 0, 14, 1.5)
    this.flash.position.y = 2
    this.group.add(this.flash)
    this.life.fill(0)
  }

  /** Emit one particle. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color | number | string, life: number, size: number, grav = 0) {
    const i = this.head
    this.head = (this.head + 1) % MAX
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.vel[i * 3] = vx
    this.vel[i * 3 + 1] = vy
    this.vel[i * 3 + 2] = vz
    const c = color instanceof THREE.Color ? color : new THREE.Color(color)
    this.col[i * 3] = c.r
    this.col[i * 3 + 1] = c.g
    this.col[i * 3 + 2] = c.b
    this.life[i] = life
    this.maxLife[i] = life
    this.baseSize[i] = size
    this.size[i] = size
    this.grav[i] = grav
  }

  burst(x: number, y: number, z: number, n: number, color: string, speed: number, life: number, size: number, grav = 0, up = 0) {
    const count = Math.max(2, Math.round(n * this.budget))
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const e = (Math.random() - 0.3) * Math.PI * 0.6
      const s = speed * (0.4 + Math.random() * 0.8)
      this.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s, color, life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), grav)
    }
  }

  ring(x: number, z: number, r: number, color: string, life = 0.45) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(this.ringGeo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.12, z)
    mesh.scale.setScalar(0.1)
    this.group.add(mesh)
    this.rings.push({ mesh, mat, life, max: life, r })
  }

  light(x: number, z: number, color: string, intensity: number) {
    this.flash.position.set(x, 1.8, z)
    this.flash.color.set(color)
    this.flash.intensity = intensity
    this.flashLife = 1
  }

  text(x: number, z: number, text: string, color: string, size = 1) {
    if (this.texts.length > 60) this.texts.shift()
    this.texts.push({ x: x + (Math.random() - 0.5) * 0.6, z, y: 1.9, text, color, life: 1, vy: 1.6, size })
  }

  /** A big two-line popup (BROKEN! / COUNTERED! over the rule's label). */
  banner(x: number, z: number, word: string, sub: string, color: string) {
    if (this.texts.length > 60) this.texts.shift()
    // Stack on top of a fresh banner nearby instead of printing over it.
    let y = 2.6
    for (const t of this.texts) if (t.banner && t.life > 0.9 && Math.hypot(t.x - x, t.z - z) < 3) y = Math.max(y, t.y + 0.9)
    this.texts.push({ x, z, y, text: word, sub, color, life: 1.35, vy: 1.1, size: 1.5, banner: true })
  }

  /* ---------- Presets ---------- */

  muzzle(x: number, z: number, aim: number, color: string, big = false, y = 1.3) {
    const dx = Math.cos(aim)
    const dz = Math.sin(aim)
    this.emit(x, y, z, dx * 2, 0, dz * 2, '#ffffff', 0.06, big ? 1.4 : 0.9)
    this.burst(x + dx * 0.2, y, z + dz * 0.2, big ? 8 : 4, color, 5, 0.18, 0.35)
    if (big) this.light(x, z, color, 8)
  }

  flame(x: number, y: number, z: number, vx: number, vz: number) {
    if (Math.random() > this.budget * 0.9) return
    this.emit(x, y + (Math.random() - 0.5) * 0.2, z, vx * 0.5 + (Math.random() - 0.5) * 2, 1.2 + Math.random(), vz * 0.5 + (Math.random() - 0.5) * 2, Math.random() < 0.5 ? '#ff7a1a' : '#ffd166', 0.32, 1.1, -2)
  }

  hit(x: number, z: number, color: string) {
    this.burst(x, 1, z, 7, color, 4, 0.3, 0.35, 8)
  }

  explosion(x: number, z: number, r: number, kind: 'grenade' | 'mine' | 'pulse' | 'crate' | 'vent' | 'reveal' | 'purge' | 'toxin') {
    if (kind === 'vent') {
      // Heat Vent: a white-hot core, an orange shock ring and embers thrown wide.
      this.ring(x, z, r, '#fb923c', 0.55)
      this.ring(x, z, r * 0.6, '#fde68a', 0.35)
      this.burst(x, 0.6, z, 46, '#ff7a1a', 9, 0.6, 0.7, 3, 2)
      this.burst(x, 0.9, z, 20, '#fff7d6', 5, 0.3, 0.9)
      this.light(x, z, '#ff8a3d', 18)
      this.shake = Math.max(this.shake, 0.45)
      return
    }
    if (kind === 'reveal') {
      // Scan pulse: two thin cyan rings and a scatter of data motes.
      this.ring(x, z, r, '#22d3ee', 0.7)
      this.ring(x, z, r * 0.55, '#a5f3fc', 0.5)
      this.burst(x, 1.2, z, 22, '#67e8f9', 4, 0.6, 0.35, -1, 1)
      this.light(x, z, '#22d3ee', 9)
      return
    }
    if (kind === 'purge') {
      this.ring(x, z, r, '#f9a8d4', 0.6)
      this.ring(x, z, r * 0.5, '#ffffff', 0.4)
      this.burst(x, 0.5, z, 34, '#fbcfe8', 3.5, 0.9, 0.45, -3, 3)
      this.light(x, z, '#f472b6', 10)
      return
    }
    if (kind === 'toxin') {
      this.ring(x, z, r, '#a3e635', 0.5)
      this.burst(x, 0.4, z, 30, '#bef264', 5, 0.7, 0.8, 2, 1.5)
      this.burst(x, 0.6, z, 14, '#4d7c0f', 2.5, 1.2, 1.3, -0.5, 1)
      this.light(x, z, '#a3e635', 10)
      this.shake = Math.max(this.shake, 0.25)
      return
    }
    if (kind === 'pulse') {
      this.ring(x, z, r, '#fb923c', 0.5)
      this.burst(x, 0.8, z, 30, '#fb923c', 7, 0.5, 0.5)
      this.light(x, z, '#fb923c', 14)
      this.shake = Math.max(this.shake, 0.5)
      return
    }
    if (kind === 'crate') {
      this.burst(x, 0.6, z, 22, '#c9a062', 5, 0.7, 0.4, 9)
      this.burst(x, 0.6, z, 10, '#f0abfc', 3, 0.5, 0.6)
      return
    }
    this.ring(x, z, r, kind === 'mine' ? '#d9f99d' : '#fde68a', 0.4)
    this.burst(x, 0.5, z, 40, '#ffb347', 8, 0.5, 0.7, 6, 2)
    this.burst(x, 0.5, z, 24, '#ff4d1a', 5, 0.7, 0.9, 4, 3)
    this.burst(x, 0.9, z, 16, '#555555', 2.5, 1.4, 1.4, -1, 2)
    this.light(x, z, '#ffb347', 16)
    this.shake = Math.max(this.shake, 0.6)
  }

  death(x: number, z: number, color: string) {
    this.burst(x, 1, z, 48, color, 7, 0.9, 0.5, 9, 2)
    this.burst(x, 1, z, 20, '#ffffff', 4, 0.4, 0.6)
    this.ring(x, z, 1.6, color, 0.5)
    this.light(x, z, color, 10)
  }

  superBurst(x: number, z: number, color: string) {
    this.ring(x, z, 2.4, color, 0.6)
    this.burst(x, 0.3, z, 36, color, 3, 0.9, 0.5, -2, 4)
    this.light(x, z, color, 12)
  }

  /** A counter landed: glassy shards for BROKEN!, a bright deflect star for COUNTERED!. */
  counter(x: number, z: number, color: string, broken: boolean) {
    if (broken) {
      this.burst(x, 1.2, z, 34, '#ffffff', 7, 0.55, 0.45, 10, 3)
      this.burst(x, 1.2, z, 26, color, 6, 0.7, 0.55, 8, 2)
      this.ring(x, z, 2.2, color, 0.45)
      this.ring(x, z, 1.1, '#ffffff', 0.3)
      this.shake = Math.max(this.shake, 0.3)
    } else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        this.emit(x, 1.3, z, Math.cos(a) * 6, 0.5, Math.sin(a) * 6, i % 2 ? color : '#ffffff', 0.35, 0.9)
      }
      this.ring(x, z, 1.8, color, 0.4)
    }
    this.light(x, z, color, 12)
  }

  /** Blink: a streak of violet motes from where the runner was to where it lands. */
  blink(x0: number, z0: number, x1: number, z1: number) {
    const n = Math.max(6, Math.round(Math.hypot(x1 - x0, z1 - z0) * 4 * this.budget))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      this.emit(x0 + (x1 - x0) * t, 0.6 + Math.random() * 1.1, z0 + (z1 - z0) * t, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6, i % 3 ? '#c084fc' : '#f0abfc', 0.5 + t * 0.3, 0.6)
    }
    this.ring(x1, z1, 1.3, '#c084fc', 0.35)
    this.burst(x0, 1, z0, 12, '#e9d5ff', 2, 0.4, 0.5)
  }

  /** A slow drifting puff (toxin clouds, scorch embers, status motes). */
  puff(x: number, y: number, z: number, color: string, size: number, life: number, rise = 0.4) {
    if (Math.random() > this.budget) return
    this.emit(x, y, z, (Math.random() - 0.5) * 0.5, rise, (Math.random() - 0.5) * 0.5, color, life, size)
  }

  dash(x: number, z: number, color: string) {
    this.burst(x, 0.5, z, 10, color, 1.5, 0.35, 0.5)
  }

  pickup(x: number, z: number, color: string) {
    this.burst(x, 0.6, z, 26, color, 2, 0.8, 0.5, -4, 3)
    this.ring(x, z, 1.2, color, 0.5)
  }

  /* ---------- Frame ---------- */

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.size[i] = 0
        this.pos[i * 3 + 1] = -100
        continue
      }
      this.vel[i * 3 + 1] += this.grav[i] * dt
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      if (this.pos[i * 3 + 1] < 0.05 && this.vel[i * 3 + 1] < 0) {
        this.pos[i * 3 + 1] = 0.05
        this.vel[i * 3 + 1] *= -0.3
        this.vel[i * 3] *= 0.6
        this.vel[i * 3 + 2] *= 0.6
      }
      const k = this.life[i] / this.maxLife[i]
      this.size[i] = this.baseSize[i] * (0.3 + 0.7 * k)
    }
    ;(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.attributes.size2 as THREE.BufferAttribute).needsUpdate = true
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life -= dt
      const k = 1 - r.life / r.max
      r.mesh.scale.setScalar(0.1 + r.r * (1 - (1 - k) * (1 - k)))
      r.mat.opacity = 0.9 * (1 - k)
      if (r.life <= 0) {
        this.group.remove(r.mesh)
        r.mat.dispose()
        this.rings.splice(i, 1)
      }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt * 7
      this.flash.intensity *= Math.exp(-9 * dt)
      if (this.flashLife <= 0) this.flash.intensity = 0
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]
      t.life -= dt * 1.1
      t.y += t.vy * dt
      t.vy *= Math.exp(-3 * dt)
      if (t.life <= 0) this.texts.splice(i, 1)
    }
    this.shake *= Math.exp(-6 * dt)
    if (this.shake < 0.01) this.shake = 0
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
    this.mat.map?.dispose()
    this.ringGeo.dispose()
    for (const r of this.rings) r.mat.dispose()
  }
}
