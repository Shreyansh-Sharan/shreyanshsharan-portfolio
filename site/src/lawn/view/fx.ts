// Particles, fracture chunks, decals, floating numbers, impact rings and screen shake. One pooled Points cloud
// for sparks / splinters / glass / water / paint / dust / feathers, one InstancedMesh for tumbling chunks, a pool
// of decal planes for paint splats, and sprites for damage numbers and KO stars.
import * as THREE from 'three'
import { dot, label, splat, star } from './textures'

interface Particle {
  life: number
  max: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
  g: number
  drag: number
  r: number
  gg: number
  b: number
  grow: number
}

interface Chunk {
  life: number
  max: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  rx: number
  ry: number
  rz: number
  wx: number
  wy: number
  wz: number
  sx: number
  sy: number
  sz: number
  colour: THREE.Color
  floor: number
}

export class Fx {
  readonly group = new THREE.Group()
  private points: THREE.Points
  private pos: Float32Array
  private col: Float32Array
  private sz: Float32Array
  private parts: Particle[] = []
  private cap: number
  private chunks: THREE.InstancedMesh
  private chunkList: Chunk[] = []
  private chunkCap: number
  private decals: { mesh: THREE.Mesh; life: number }[] = []
  private texts: { sprite: THREE.Sprite; life: number; vy: number }[] = []
  private rings: { mesh: THREE.Mesh; life: number; max: number; colour: THREE.Color }[] = []
  private stars: { group: THREE.Group; life: number; follow: () => THREE.Vector3 | null }[] = []
  private ringGeo = new THREE.RingGeometry(0.4, 0.55, 32)
  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpE = new THREE.Euler()
  private tmpS = new THREE.Vector3()
  private tmpP = new THREE.Vector3()
  shake = 0
  flash = 0
  private floorAt: (x: number, z: number, y: number) => number

  constructor(cap: number, chunkCap: number, floorAt: (x: number, z: number, y: number) => number) {
    this.cap = cap
    this.chunkCap = chunkCap
    this.floorAt = floorAt
    this.pos = new Float32Array(cap * 3)
    this.col = new Float32Array(cap * 3)
    this.sz = new Float32Array(cap)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(this.sz, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dot() } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vColor; void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor; void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.05) discard; gl_FragColor = vec4(vColor, t.a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.group.add(this.points)
    const box = new THREE.BoxGeometry(1, 1, 1)
    this.chunks = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), chunkCap)
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.chunks.count = 0
    this.chunks.castShadow = true
    this.chunks.frustumCulled = false
    this.group.add(this.chunks)
  }

  /* ---------- particles ---------- */

  private emit(n: number, x: number, y: number, z: number, opts: { speed: number; up: number; size: number; life: number; g: number; drag: number; colour: THREE.Color | string; spread?: number; grow?: number; dir?: THREE.Vector3; vary?: number }) {
    const c = opts.colour instanceof THREE.Color ? opts.colour : new THREE.Color(opts.colour)
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.cap) this.parts.shift()
      const a = Math.random() * Math.PI * 2
      const b = (Math.random() - 0.5) * (opts.spread ?? 1)
      const s = opts.speed * (0.4 + Math.random() * 0.8)
      let vx = Math.cos(a) * Math.cos(b) * s
      let vy = Math.sin(b) * s + opts.up * (0.5 + Math.random())
      let vz = Math.sin(a) * Math.cos(b) * s
      if (opts.dir) {
        vx += opts.dir.x * opts.speed
        vy += opts.dir.y * opts.speed
        vz += opts.dir.z * opts.speed
      }
      const k = 1 - (opts.vary ?? 0.25) * Math.random()
      this.parts.push({ life: opts.life * (0.6 + Math.random() * 0.6), max: opts.life, x, y, z, vx, vy, vz, size: opts.size * (0.7 + Math.random() * 0.6), g: opts.g, drag: opts.drag, r: c.r * k, gg: c.g * k, b: c.b * k, grow: opts.grow ?? 0 })
    }
  }

  sparks(x: number, y: number, z: number, n = 16) {
    this.emit(n, x, y, z, { speed: 5, up: 3, size: 0.09, life: 0.45, g: 14, drag: 0.5, colour: '#ffb347', vary: 0.5 })
    this.emit(Math.ceil(n / 3), x, y, z, { speed: 3, up: 2, size: 0.12, life: 0.35, g: 10, drag: 0.5, colour: '#ffffff' })
    this.emit(4, x, y, z, { speed: 0.8, up: 0.8, size: 0.5, life: 0.9, g: -0.5, drag: 1.5, colour: '#9a9a9a', grow: 0.6 })
  }

  splinters(x: number, y: number, z: number, colour: string, n = 14) {
    this.emit(n, x, y, z, { speed: 3.5, up: 2.5, size: 0.14, life: 1.1, g: 16, drag: 0.4, colour, vary: 0.4 })
    this.emit(6, x, y, z, { speed: 0.7, up: 0.6, size: 0.6, life: 1.1, g: -0.3, drag: 1.5, colour: '#b9a98f', grow: 0.7 })
  }

  glass(x: number, y: number, z: number, n = 24) {
    this.emit(n, x, y, z, { speed: 3, up: 2, size: 0.12, life: 1.0, g: 16, drag: 0.3, colour: '#c8f2ff', vary: 0.3 })
  }

  water(x: number, y: number, z: number, n = 30) {
    this.emit(n, x, y, z, { speed: 4, up: 3.5, size: 0.16, life: 0.8, g: 14, drag: 0.6, colour: '#6fc6ff' })
  }

  paint(x: number, y: number, z: number, colour: string, n = 26) {
    this.emit(n, x, y, z, { speed: 3.5, up: 2.5, size: 0.18, life: 0.9, g: 13, drag: 0.6, colour })
  }

  feathers(x: number, y: number, z: number) {
    this.emit(10, x, y, z, { speed: 1.2, up: 0.8, size: 0.2, life: 2.2, g: 1.2, drag: 2.5, colour: '#ffffff' })
  }

  dust(x: number, y: number, z: number, colour = '#c9b89a', n = 10) {
    this.emit(n, x, y, z, { speed: 1.2, up: 1.0, size: 0.8, life: 1.3, g: -0.4, drag: 2, colour, grow: 0.8 })
  }

  smoke(x: number, y: number, z: number, n = 20) {
    this.emit(n, x, y, z, { speed: 2, up: 3, size: 1.2, life: 1.8, g: -1.5, drag: 1.5, colour: '#444444', grow: 1.2 })
    this.emit(14, x, y, z, { speed: 6, up: 5, size: 0.3, life: 0.6, g: 6, drag: 0.6, colour: '#ffcc55' })
  }

  fire(x: number, y: number, z: number, n = 4) {
    this.emit(n, x, y, z, { speed: 0.6, up: 2.2, size: 0.5, life: 0.7, g: -2, drag: 1, colour: '#ff8a2b', grow: -0.3 })
  }

  snowPuff(x: number, y: number, z: number) {
    this.emit(12, x, y, z, { speed: 1.5, up: 1.5, size: 0.4, life: 0.9, g: 4, drag: 1.5, colour: '#ffffff', grow: 0.4 })
  }

  wind(x: number, y: number, z: number, dir: THREE.Vector3) {
    this.emit(3, x, y, z, { speed: 9, up: 0, size: 0.35, life: 0.5, g: 0, drag: 0.2, colour: '#e8f4ff', dir, spread: 0.6, grow: 0.5 })
    this.emit(2, x, y, z, { speed: 7, up: 0.5, size: 0.2, life: 0.7, g: 2, drag: 0.4, colour: '#8fd14f', dir, spread: 0.8 })
  }

  /* ---------- chunks ---------- */

  /** Break a box into tumbling chunks. */
  fracture(x: number, y: number, z: number, w: number, h: number, d: number, colour: string, n: number, hx = x, hy = y + h / 2, hz = z) {
    const c = new THREE.Color(colour)
    const nx = Math.max(1, Math.round(Math.cbrt(n) * (w / Math.cbrt(w * h * d))))
    const ny = Math.max(1, Math.round(n / nx / 2))
    const nz = Math.max(1, Math.round(n / nx / ny))
    const floor = this.floorAt(x, z, y + 0.1)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++)
        for (let k = 0; k < nz; k++) {
          if (this.chunkList.length >= this.chunkCap) this.chunkList.shift()
          const sx = (w / nx) * (0.6 + Math.random() * 0.5)
          const sy = (h / ny) * (0.6 + Math.random() * 0.5)
          const sz = (d / nz) * (0.6 + Math.random() * 0.5)
          const cx = x - w / 2 + (i + 0.5) * (w / nx)
          const cy = y + (j + 0.5) * (h / ny)
          const cz = z - d / 2 + (k + 0.5) * (d / nz)
          const dx = cx - hx
          const dy = cy - hy
          const dz = cz - hz
          const l = Math.hypot(dx, dy, dz) || 1
          const push = 2.5 + Math.random() * 3
          this.chunkList.push({ life: 2.2 + Math.random(), max: 2.5, x: cx, y: cy, z: cz, vx: (dx / l) * push + (Math.random() - 0.5) * 2, vy: (dy / l) * push + 2 + Math.random() * 2.5, vz: (dz / l) * push + (Math.random() - 0.5) * 2, rx: Math.random() * 3, ry: Math.random() * 3, rz: Math.random() * 3, wx: (Math.random() - 0.5) * 8, wy: (Math.random() - 0.5) * 8, wz: (Math.random() - 0.5) * 8, sx, sy, sz, colour: c.clone().multiplyScalar(0.8 + Math.random() * 0.35), floor })
        }
  }

  /* ---------- decals, numbers, rings, stars ---------- */

  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, colour: string, size = 1.2) {
    if (this.decals.length > 48) {
      const d = this.decals.shift()!
      this.group.remove(d.mesh)
      d.mesh.geometry.dispose()
      ;(d.mesh.material as THREE.Material).dispose()
    }
    const mat = new THREE.MeshBasicMaterial({ map: splat(colour), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat)
    mesh.position.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02)
    const n = new THREE.Vector3(nx, ny, nz)
    if (n.lengthSq() < 0.1) n.set(0, 1, 0)
    mesh.lookAt(mesh.position.clone().add(n))
    mesh.rotateZ(Math.random() * Math.PI * 2)
    mesh.renderOrder = 2
    this.group.add(mesh)
    this.decals.push({ mesh, life: 40 })
  }

  number(x: number, y: number, z: number, text: string, colour = '#ffe24a', scale = 1) {
    const mat = new THREE.SpriteMaterial({ map: label(text, colour), transparent: true, depthTest: false })
    const sp = new THREE.Sprite(mat)
    sp.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3)
    sp.scale.set(1.3 * scale, 0.5 * scale, 1)
    sp.renderOrder = 10
    this.group.add(sp)
    this.texts.push({ sprite: sp, life: 0.9, vy: 1.4 })
  }

  ring(x: number, y: number, z: number, colour: string, max = 3, life = 0.45) {
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    const mesh = new THREE.Mesh(this.ringGeo, mat)
    mesh.position.set(x, y + 0.05, z)
    mesh.rotation.x = -Math.PI / 2
    this.group.add(mesh)
    this.rings.push({ mesh, life, max: life, colour: new THREE.Color(colour) })
    ;(mesh as unknown as { maxR: number }).maxR = max
  }

  koStars(follow: () => THREE.Vector3 | null, life = 5) {
    const g = new THREE.Group()
    const mat = new THREE.SpriteMaterial({ map: star(), transparent: true, depthTest: false })
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(mat)
      s.scale.set(0.3, 0.3, 1)
      g.add(s)
    }
    g.renderOrder = 10
    this.group.add(g)
    this.stars.push({ group: g, life, follow })
  }

  /* ---------- update ---------- */

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 2.2)
    this.flash = Math.max(0, this.flash - dt * 3)
    // Particles.
    let n = 0
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.life -= dt
      if (p.life <= 0) {
        this.parts.splice(i, 1)
        continue
      }
      p.vy -= p.g * dt
      const k = Math.max(0, 1 - p.drag * dt)
      p.vx *= k
      p.vy *= k
      p.vz *= k
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.02 && p.g > 0) {
        p.y = 0.02
        p.vy = -p.vy * 0.3
        p.vx *= 0.6
        p.vz *= 0.6
      }
      p.size += p.grow * dt
      const fade = Math.min(1, p.life / Math.max(0.05, p.max * 0.4))
      this.pos[n * 3] = p.x
      this.pos[n * 3 + 1] = p.y
      this.pos[n * 3 + 2] = p.z
      this.col[n * 3] = p.r * fade
      this.col[n * 3 + 1] = p.gg * fade
      this.col[n * 3 + 2] = p.b * fade
      this.sz[n] = Math.max(0.01, p.size)
      n++
    }
    const geo = this.points.geometry
    geo.setDrawRange(0, n)
    ;(geo.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(geo.attributes.color as THREE.BufferAttribute).needsUpdate = true
    ;(geo.attributes.size as THREE.BufferAttribute).needsUpdate = true
    // Chunks.
    let ci = 0
    for (let i = this.chunkList.length - 1; i >= 0; i--) {
      const c = this.chunkList[i]
      c.life -= dt
      if (c.life <= 0) {
        this.chunkList.splice(i, 1)
        continue
      }
      c.vy -= 18 * dt
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.z += c.vz * dt
      const floor = c.floor
      if (c.y - c.sy / 2 < floor) {
        c.y = floor + c.sy / 2
        c.vy = -c.vy * 0.25
        c.vx *= 0.7
        c.vz *= 0.7
        c.wx *= 0.5
        c.wz *= 0.5
      }
      c.rx += c.wx * dt
      c.ry += c.wy * dt
      c.rz += c.wz * dt
      const shrink = Math.min(1, c.life / 0.5)
      this.tmpQ.setFromEuler(this.tmpE.set(c.rx, c.ry, c.rz))
      this.tmpS.set(c.sx * shrink, c.sy * shrink, c.sz * shrink)
      this.tmpM.compose(this.tmpP.set(c.x, c.y, c.z), this.tmpQ, this.tmpS)
      this.chunks.setMatrixAt(ci, this.tmpM)
      this.chunks.setColorAt(ci, c.colour)
      ci++
    }
    this.chunks.count = ci
    this.chunks.instanceMatrix.needsUpdate = true
    if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true
    // Decals fade late.
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]
      d.life -= dt
      if (d.life < 3) (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, d.life / 3)
      if (d.life <= 0) {
        this.group.remove(d.mesh)
        d.mesh.geometry.dispose()
        ;(d.mesh.material as THREE.Material).dispose()
        this.decals.splice(i, 1)
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]
      t.life -= dt
      t.sprite.position.y += t.vy * dt
      t.vy *= 0.92
      ;(t.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, t.life / 0.3)
      if (t.life <= 0) {
        this.group.remove(t.sprite)
        ;(t.sprite.material as THREE.Material).dispose()
        this.texts.splice(i, 1)
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.life -= dt
      const k = 1 - r.life / r.max
      const maxR = (r.mesh as unknown as { maxR: number }).maxR
      r.mesh.scale.setScalar(0.3 + k * maxR)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k
      if (r.life <= 0) {
        this.group.remove(r.mesh)
        ;(r.mesh.material as THREE.Material).dispose()
        this.rings.splice(i, 1)
      }
    }
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i]
      s.life -= dt
      const p = s.follow()
      if (!p || s.life <= 0) {
        this.group.remove(s.group)
        this.stars.splice(i, 1)
        continue
      }
      s.group.position.copy(p)
      const t = performance.now() / 1000
      s.group.children.forEach((c, j) => {
        const a = t * 3 + (j / 4) * Math.PI * 2
        c.position.set(Math.cos(a) * 0.35, Math.sin(t * 6 + j) * 0.05, Math.sin(a) * 0.35)
      })
    }
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
    this.chunks.dispose()
  }
}
