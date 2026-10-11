// Ball physics: flight with drag, surface-dependent bounce, rolling with slope and friction, trees, the cup.
// Pure functions over a small state object so the AI can simulate candidate shots with the exact same code.
import * as THREE from 'three'
import { CONFIG } from './config'
import type { Course } from './course'

export type BallMode = 'rest' | 'rolling' | 'air' | 'water' | 'holed'

export interface BallState {
  pos: THREE.Vector3
  vel: THREE.Vector3
  mode: BallMode
}

const n = new THREE.Vector3()
const tmp = new THREE.Vector3()

/** Fast height lookup: a 1 m grid sampled once, bilinear in between. */
export class Ground {
  private readonly course: Course
  private readonly grid: Float32Array
  private readonly w: number
  private readonly h: number
  private readonly x0: number
  private readonly z0: number

  constructor(course: Course) {
    this.course = course
    const b = course.bounds
    this.x0 = b.minX
    this.z0 = b.minZ
    this.w = Math.ceil(b.maxX - b.minX) + 1
    this.h = Math.ceil(b.maxZ - b.minZ) + 1
    this.grid = new Float32Array(this.w * this.h)
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) this.grid[j * this.w + i] = course.heightAt(this.x0 + i, this.z0 + j)
  }

  y(x: number, z: number) {
    const fx = THREE.MathUtils.clamp(x - this.x0, 0, this.w - 1.001), fz = THREE.MathUtils.clamp(z - this.z0, 0, this.h - 1.001)
    const i = Math.floor(fx), j = Math.floor(fz)
    const u = fx - i, v = fz - j
    const g = this.grid, w = this.w
    const a = g[j * w + i], b = g[j * w + i + 1], c = g[(j + 1) * w + i], d = g[(j + 1) * w + i + 1]
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }

  normal(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.5
    return out.set(this.y(x - e, z) - this.y(x + e, z), 2 * e, this.y(x, z - e) - this.y(x, z + e)).normalize()
  }

  surface(x: number, z: number) {
    return this.course.surfaceAt(x, z)
  }

  inBounds(x: number, z: number) {
    const b = this.course.bounds
    return x > b.minX + 2 && x < b.maxX - 2 && z > b.minZ + 2 && z < b.maxZ - 2
  }
}

/** Launch velocity for a swing. Loft is in radians; power 0..1. */
export function launch(dir: number, power: number, loft: number, putt: boolean, powerScale = 1) {
  const speed = power * (putt ? CONFIG.putt_max_speed : CONFIG.max_ball_speed * (CONFIG.swing_power_setting / 100)) * powerScale
  const l = putt ? 0 : loft
  return new THREE.Vector3(Math.sin(dir) * Math.cos(l) * speed, Math.sin(l) * speed, Math.cos(dir) * Math.cos(l) * speed)
}

export interface StepEvents {
  bounced?: boolean
  holed?: boolean
  water?: boolean
  hitTree?: boolean
}

/** Advance one ball by dt. Returns notable events. */
export function stepBall(b: BallState, dt: number, ground: Ground, course: Course): StepEvents {
  const ev: StepEvents = {}
  if (b.mode === 'rest' || b.mode === 'holed' || b.mode === 'water') return ev
  const r = CONFIG.ball_radius
  const p = b.pos, v = b.vel
  if (b.mode === 'air') {
    v.y -= CONFIG.gravity * dt
    const sp = v.length()
    v.multiplyScalar(Math.max(0, 1 - CONFIG.air_drag * sp * dt))
    p.addScaledVector(v, dt)
  } else {
    // Rolling: follow the ground, slope accelerates, friction decelerates.
    ground.normal(p.x, p.z, n)
    const s = ground.surface(p.x, p.z)
    // Gravity along the slope.
    tmp.set(0, -CONFIG.gravity, 0).addScaledVector(n, CONFIG.gravity * n.y)
    v.addScaledVector(tmp, dt * 0.72) // rolling ball: 5/7 of g
    // Keep velocity in the tangent plane.
    v.addScaledVector(n, -v.dot(n))
    const sp = v.length()
    const fr = course.friction(s) * dt
    if (sp <= fr) {
      v.set(0, 0, 0)
      if (tmp.length() * 0.72 < course.friction(s)) b.mode = 'rest'
    } else v.multiplyScalar((sp - fr) / sp)
    if (sp < CONFIG.rest_speed && tmp.length() * 0.72 < course.friction(s) * 1.5) {
      v.set(0, 0, 0)
      b.mode = 'rest'
    }
    p.addScaledVector(v, dt)
    p.y = ground.y(p.x, p.z) + r
  }

  // Trees (trunks) reflect the ball.
  for (const t of course.trees) {
    const dx = p.x - t.x, dz = p.z - t.z
    const rr = t.r * t.scale + r
    if (dx * dx + dz * dz < rr * rr && p.y < ground.y(t.x, t.z) + (t.h ?? 5) * t.scale) {
      const d = Math.hypot(dx, dz) || 1
      const nx = dx / d, nz = dz / d
      const vn = v.x * nx + v.z * nz
      if (vn < 0) {
        v.x -= (1 + CONFIG.wall_restitution) * vn * nx
        v.z -= (1 + CONFIG.wall_restitution) * vn * nz
        ev.hitTree = true
      }
      p.x = t.x + nx * rr
      p.z = t.z + nz * rr
    }
  }

  const gy = ground.y(p.x, p.z)
  // Water or off the map.
  if (gy < 0.05 && p.y < 0.2) {
    b.mode = 'water'
    v.set(0, 0, 0)
    ev.water = true
    return ev
  }
  if (!ground.inBounds(p.x, p.z) || p.y < -10) {
    b.mode = 'water'
    ev.water = true
    return ev
  }

  // Landing / bouncing.
  if (b.mode === 'air' && p.y - r <= gy) {
    p.y = gy + r
    ground.normal(p.x, p.z, n)
    const s = ground.surface(p.x, p.z)
    const vn = v.dot(n)
    if (vn < 0) {
      const e = CONFIG.bounce[s] ?? 0.3
      v.addScaledVector(n, -(1 + e) * vn)
      // Tangential loss on impact (sand grabs the ball).
      const keep = s === 'sand' ? 0.35 : s === 'rough' ? 0.7 : 0.82
      tmp.copy(n).multiplyScalar(v.dot(n))
      v.sub(tmp).multiplyScalar(keep).add(tmp)
      ev.bounced = true
      if (Math.abs(vn) * e < 1.6) b.mode = 'rolling'
    }
  }

  // The cup: captured when slow enough, otherwise it lips out.
  const cx = p.x - course.cup.x, cz = p.z - course.cup.z
  const dc = Math.hypot(cx, cz)
  if (dc < CONFIG.cup_radius && p.y - r <= gy + 0.3) {
    const hs = Math.hypot(v.x, v.z)
    if (hs < CONFIG.cup_capture_speed) {
      b.mode = 'holed'
      v.set(0, 0, 0)
      p.set(course.cup.x, gy - 0.1, course.cup.z)
      ev.holed = true
    } else if (dc > 0.01) {
      // Lip-out: deflect a little and lose speed.
      v.x += (cx / dc) * hs * 0.25
      v.z += (cz / dc) * hs * 0.25
      v.multiplyScalar(0.8)
    }
  }
  return ev
}

/** Simulate a shot without touching the scene (AI shot selection). Returns where the ball ends up. */
export function simulateShot(start: THREE.Vector3, vel: THREE.Vector3, seconds: number, ground: Ground, course: Course) {
  const b: BallState = { pos: start.clone(), vel: vel.clone(), mode: 'air' }
  const dt = 1 / 30
  let t = 0
  let water = false
  for (; t < seconds; t += dt) {
    const ev = stepBall(b, dt, ground, course)
    if (ev.water) {
      water = true
      break
    }
    if (b.mode === 'rest' || b.mode === 'holed') break
  }
  return { pos: b.pos, mode: b.mode, water, time: t }
}
