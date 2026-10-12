// Shared hazards for levels: a rotating bar, a pusher, falling pieces, a shrinking floor, a conveyor and a bouncy
// pad. Motion is a pure function of the round clock, so every screen animates them identically; effects on toys
// run on the host (and on a client's own toy where prediction needs them). Stateful hazards sync themselves.
import * as THREE from 'three'
import { RAPIER, WORLD_GROUPS, type Collider } from './physics'
import { FOOT, type Toy } from './toy'
import type { LevelCtx } from './types'

export interface Hazard {
  /** Move visuals/colliders for round time t. Every screen, every step. */
  update(ctx: LevelCtx, t: number, dt: number): void
  /** Act on a toy. Host for every toy; clients for their own toy when `predict` is set. */
  affect?(ctx: LevelCtx, toy: Toy, dt: number): void
  /** Run affect() for the client's own toy too (smooth on conveyors and pads). */
  predict?: boolean
  pack?(): unknown
  unpack?(d: unknown): void
}

const _v = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()

function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra })
}

/** Closest distance from p to segment ab (on the ground plane). */
function segDist2D(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x, abz = b.z - a.z
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / Math.max(1e-6, abx * abx + abz * abz), 0, 1)
  const x = a.x + abx * t, z = a.z + abz * t
  return Math.hypot(p.x - x, p.z - z)
}

export class Hazards {
  readonly list: Hazard[] = []
  private ctx: () => LevelCtx
  constructor(ctx: () => LevelCtx) {
    this.ctx = ctx
  }

  add<T extends Hazard>(h: T): T {
    this.list.push(h)
    return h
  }

  /** A bar sweeping round a pivot: knocks toys it touches along its direction of travel. */
  rotatingBar(o: { x: number; y: number; z: number; length: number; speed: number; thick?: number; phase?: number; color?: string; twoSided?: boolean }) {
    const ctx = this.ctx()
    const thick = o.thick ?? 0.35
    const half = o.twoSided === false ? o.length / 2 : o.length
    const body = ctx.phys.kinematic({ x: o.x, y: o.y, z: o.z })
    const off = o.twoSided === false ? half : 0
    ctx.phys.attach(body, RAPIER.ColliderDesc.cuboid(half, thick, thick).setTranslation(off, 0, 0), { friction: 0.2 })
    const g = new THREE.Group()
    g.position.set(o.x, o.y, o.z)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2, thick * 2, thick * 2), mat(o.color ?? '#e05252'))
    bar.position.x = off
    bar.castShadow = true
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, o.y * 2 + 0.2, 10), mat('#8b6b4a'))
    hub.position.y = -o.y / 2
    g.add(bar, hub)
    ctx.root.add(g)
    const hitT = new Map<Toy, number>()
    const q = { x: 0, y: 0, z: 0, w: 1 }
    return this.add({
      angle: 0,
      update(_c, t) {
        this.angle = (o.phase ?? 0) + t * o.speed
        q.y = Math.sin(-this.angle / 2)
        q.w = Math.cos(-this.angle / 2)
        body.setNextKinematicRotation(q)
        g.rotation.y = -this.angle
      },
      affect(c, toy) {
        if (!toy.active || Math.abs(toy.feet + FOOT - o.y) > thick + 0.7) return
        // The bar's local x axis in the world.
        const dx = Math.cos(-this.angle), dz = -Math.sin(-this.angle)
        _a.set(o.x + dx * (off - half), 0, o.z + dz * (off - half))
        _b.set(o.x + dx * (off + half), 0, o.z + dz * (off + half))
        const d = segDist2D(toy.pos, _a, _b)
        if (d > thick + 0.45 || (hitT.get(toy) ?? -9) > c.time - 0.6) return
        hitT.set(toy, c.time)
        // Tangential push, scaled by how far out the toy is.
        const rx = toy.pos.x - o.x, rz = toy.pos.z - o.z
        const r = Math.hypot(rx, rz)
        const sgn = Math.sign(o.speed)
        _v.set(-rz * sgn, 0, rx * sgn).normalize()
        const pow = 5 + Math.abs(o.speed) * r * 0.9
        c.knock(toy, { x: _v.x * pow, y: 4, z: _v.z * pow }, 0.7)
        c.fx.sfx('thud', toy.pos)
      },
    } as Hazard & { angle: number })
  }

  /** A block sliding between two points (a piston), shoving toys in its way. */
  pusher(o: { from: [number, number, number]; to: [number, number, number]; size: [number, number, number]; period: number; phase?: number; color?: string }) {
    const ctx = this.ctx()
    const body = ctx.phys.kinematic({ x: o.from[0], y: o.from[1], z: o.from[2] })
    ctx.phys.attach(body, RAPIER.ColliderDesc.cuboid(o.size[0] / 2, o.size[1] / 2, o.size[2] / 2), { friction: 0.3 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...o.size), mat(o.color ?? '#f59e0b'))
    mesh.castShadow = true
    mesh.receiveShadow = true
    ctx.root.add(mesh)
    const a = new THREE.Vector3(...o.from), b = new THREE.Vector3(...o.to)
    const dir = b.clone().sub(a).normalize()
    const pos = new THREE.Vector3()
    let prev = 0
    let vel = 0
    return this.add({
      update(_c, t, dt) {
        // Fast out, slow back.
        const ph = (((t + (o.phase ?? 0)) / o.period) % 1 + 1) % 1
        const k = ph < 0.25 ? THREE.MathUtils.smootherstep(ph / 0.25, 0, 1) : 1 - THREE.MathUtils.smoothstep((ph - 0.45) / 0.55, 0, 1)
        pos.lerpVectors(a, b, k)
        vel = dt > 0 ? (k - prev) / dt : 0
        prev = k
        body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z })
        mesh.position.copy(pos)
      },
      affect(c, toy) {
        if (!toy.active || vel <= 0.5) return
        _v.subVectors(toy.pos, pos)
        const along = _v.dot(dir)
        const halfAlong = (Math.abs(dir.x) * o.size[0] + Math.abs(dir.z) * o.size[2]) / 2
        const halfLat = (Math.abs(dir.z) * o.size[0] + Math.abs(dir.x) * o.size[2]) / 2
        if (along < 0 || along > halfAlong + 0.55 || Math.abs(toy.pos.y - pos.y) > o.size[1] / 2 + 0.6) return
        _v.addScaledVector(dir, -along)
        if (_v.length() > halfLat + 0.3) return
        const pow = 7 + vel * a.distanceTo(b) * 0.4
        c.knock(toy, { x: dir.x * pow, y: 3, z: dir.z * pow }, 0.5)
      },
    })
  }

  /**
   * A grid of floor pieces that shake when stood on, fall after `delay` and come back after `respawn`
   * seconds (0 = never). Synced to clients.
   */
  fallingTiles(o: { x: number; y: number; z: number; cols: number; rows: number; size: number; gap?: number; delay?: number; respawn?: number; colors?: string[] }) {
    const ctx = this.ctx()
    const gap = o.gap ?? 0.08
    const n = o.cols * o.rows
    const fallT = new Float32Array(n).fill(-1) // < 0: solid; ≥ 0: seconds since triggered
    const colliders: Collider[] = []
    const geo = new THREE.BoxGeometry(o.size - gap, 0.4, o.size - gap)
    const colors = o.colors ?? ['#f4a259', '#5b8e7d', '#bc4b51', '#8cb369']
    const meshes: THREE.Mesh[] = []
    const home: THREE.Vector3[] = []
    for (let i = 0; i < n; i++) {
      const cx = i % o.cols, cz = Math.floor(i / o.cols)
      const x = o.x + (cx - (o.cols - 1) / 2) * o.size, z = o.z + (cz - (o.rows - 1) / 2) * o.size
      colliders.push(ctx.phys.box({ x, y: o.y - 0.2, z }, { x: (o.size - gap) / 2, y: 0.2, z: (o.size - gap) / 2 }))
      const m = new THREE.Mesh(geo, mat(colors[(cx + cz) % colors.length]))
      m.position.set(x, o.y - 0.2, z)
      m.receiveShadow = true
      ctx.root.add(m)
      meshes.push(m)
      home.push(m.position.clone())
    }
    const delay = o.delay ?? 0.8
    return this.add({
      update(_c, _t, dt) {
        for (let i = 0; i < n; i++) {
          const f = fallT[i]
          const m = meshes[i]
          if (f < 0) {
            m.position.copy(home[i])
            continue
          }
          fallT[i] = f + dt
          if (f < delay) m.position.set(home[i].x + Math.sin(f * 60) * 0.04, home[i].y, home[i].z)
          else {
            colliders[i].setEnabled(false)
            m.position.y = home[i].y - (f - delay) * (f - delay) * 9
            m.visible = m.position.y > home[i].y - 30
          }
          if (o.respawn && f > delay + o.respawn) {
            fallT[i] = -1
            colliders[i].setEnabled(true)
            m.visible = true
          }
        }
      },
      affect(_c, toy) {
        if (!toy.grounded || toy.mode !== 'walk') return
        const cx = Math.round((toy.pos.x - o.x) / o.size + (o.cols - 1) / 2)
        const cz = Math.round((toy.pos.z - o.z) / o.size + (o.rows - 1) / 2)
        if (cx < 0 || cz < 0 || cx >= o.cols || cz >= o.rows || Math.abs(toy.feet - o.y) > 0.3) return
        const i = cz * o.cols + cx
        if (fallT[i] < 0) fallT[i] = 0
      },
      pack() {
        return Array.from(fallT, (v) => Math.round(v * 10) / 10)
      },
      unpack(d: unknown) {
        const a = d as number[]
        for (let i = 0; i < n && i < a.length; i++) {
          if (a[i] < 0 && fallT[i] >= 0) {
            colliders[i].setEnabled(true)
            meshes[i].visible = true
          }
          if (Math.abs(a[i] - fallT[i]) > 0.25 || a[i] < 0) fallT[i] = a[i]
        }
      },
    })
  }

  /**
   * A round floor (cylinder) whose radius can be shrunk over time. Pass your own visual (e.g. a textured
   * stool top); it is scaled on x/z with the radius. Synced to clients.
   */
  shrinkingDisc(o: { x: number; y: number; z: number; radius: number; thick?: number; visual?: THREE.Object3D }) {
    const ctx = this.ctx()
    const thick = o.thick ?? 1
    const col = ctx.phys.cylinder({ x: o.x, y: o.y - thick / 2, z: o.z }, thick / 2, o.radius, { friction: 0.8 })
    let visual = o.visual
    if (!visual) {
      visual = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, thick, 48), mat('#c08552'))
      visual.position.set(o.x, o.y - thick / 2, o.z)
      visual.receiveShadow = true
      ctx.root.add(visual)
    }
    const v = visual
    const state = { radius: o.radius, from: o.radius, to: o.radius, t0: 0, dur: 0 }
    return this.add({
      state,
      /** Shrink to `to` over `seconds`, starting at round time `at`. */
      shrink(to: number, at: number, seconds: number) {
        state.from = state.radius
        state.to = to
        state.t0 = at
        state.dur = seconds
      },
      update(_c, t) {
        if (state.dur > 0) {
          const k = THREE.MathUtils.clamp((t - state.t0) / state.dur, 0, 1)
          state.radius = THREE.MathUtils.lerp(state.from, state.to, k)
        }
        const s = state.radius / o.radius
        v.scale.set(s, 1, s)
        col.setRadius(Math.max(0.2, state.radius))
      },
      pack() {
        return [Math.round(state.radius * 100) / 100, state.from, state.to, state.t0, state.dur]
      },
      unpack(d: unknown) {
        const a = d as number[]
        ;[state.radius, state.from, state.to, state.t0, state.dur] = a
      },
    } as Hazard & { state: typeof state; shrink(to: number, at: number, seconds: number): void })
  }

  /** A belt that carries toys standing on it. Direction can flip with `setDir`. */
  conveyor(o: { x: number; y: number; z: number; width: number; length: number; rotY?: number; speed: number }) {
    const ctx = this.ctx()
    ctx.phys.box({ x: o.x, y: o.y - 0.15, z: o.z }, { x: o.width / 2, y: 0.15, z: o.length / 2 }, { rotY: o.rotY, friction: 0.6, groups: WORLD_GROUPS })
    const tex = stripes()
    tex.repeat.set(1, o.length / 1.2)
    const m = new THREE.Mesh(new THREE.BoxGeometry(o.width, 0.3, o.length), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
    m.position.set(o.x, o.y - 0.15, o.z)
    m.rotation.y = o.rotY ?? 0
    m.receiveShadow = true
    ctx.root.add(m)
    const dir = new THREE.Vector3(Math.sin(o.rotY ?? 0), 0, Math.cos(o.rotY ?? 0))
    let sign = 1
    return this.add({
      predict: true,
      setDir(s: number) {
        sign = s
      },
      update(_c, t) {
        tex.offset.y = -t * o.speed * sign / 1.2
      },
      affect(_c, toy, dt) {
        if (!toy.grounded || Math.abs(toy.feet - o.y) > 0.3) return
        _v.subVectors(toy.pos, m.position)
        const along = _v.dot(dir)
        const side = Math.abs(_v.x * dir.z - _v.z * dir.x)
        if (Math.abs(along) > o.length / 2 || side > o.width / 2) return
        const p = toy.body.translation()
        toy.body.setTranslation({ x: p.x + dir.x * o.speed * sign * dt, y: p.y, z: p.z + dir.z * o.speed * sign * dt }, true)
      },
    } as Hazard & { setDir(s: number): void })
  }

  /** A springy pad that launches toys that land on it. */
  bouncyPad(o: { x: number; y: number; z: number; radius: number; power: number; color?: string }) {
    const ctx = this.ctx()
    ctx.phys.cylinder({ x: o.x, y: o.y - 0.1, z: o.z }, 0.1, o.radius, { restitution: 0.2 })
    const m = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius * 1.05, 0.2, 24), mat(o.color ?? '#ec4899', { emissive: o.color ?? '#ec4899', emissiveIntensity: 0.25 }))
    m.position.set(o.x, o.y - 0.1, o.z)
    ctx.root.add(m)
    let squash = 0
    return this.add({
      predict: true,
      update(_c, _t, dt) {
        squash = Math.max(0, squash - dt * 4)
        m.scale.y = 1 - squash * 0.6
      },
      affect(c, toy) {
        if (!toy.grounded || Math.hypot(toy.pos.x - o.x, toy.pos.z - o.z) > o.radius || Math.abs(toy.feet - o.y) > 0.3) return
        const v = toy.body.linvel()
        toy.body.setLinvel({ x: v.x, y: o.power, z: v.z }, true)
        toy.grounded = false
        squash = 1
        if (c.isHost) c.fx.sfx('boing', toy.pos)
      },
    })
  }

  update(ctx: LevelCtx, t: number, dt: number) {
    for (const h of this.list) h.update(ctx, t, dt)
  }

  affect(ctx: LevelCtx, toys: readonly Toy[], dt: number, onlyPredict: boolean) {
    for (const h of this.list) {
      if (!h.affect || (onlyPredict && !h.predict)) continue
      for (const t of toys) h.affect(ctx, t, dt)
    }
  }

  pack() {
    if (!this.list.some((h) => h.pack)) return null
    return this.list.map((h) => (h.pack ? h.pack() : 0))
  }

  unpack(d: unknown) {
    if (!Array.isArray(d)) return
    this.list.forEach((h, i) => h.unpack?.(d[i]))
  }
}

function stripes() {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#4b5563'
  g.fillRect(0, 0, 32, 64)
  g.fillStyle = '#9ca3af'
  g.beginPath()
  g.moveTo(4, 40)
  g.lineTo(16, 24)
  g.lineTo(28, 40)
  g.lineTo(22, 40)
  g.lineTo(16, 32)
  g.lineTo(10, 40)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
