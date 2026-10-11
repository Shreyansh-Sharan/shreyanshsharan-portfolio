// One pooled particle system for every spell: sparks, hearts, petals, ice shards, dust, smoke and
// dizzy stars. Fixed-size typed arrays (no per-frame allocation) drawn as a single Points call by
// <Particles /> in SpellFx.tsx. Anything can emit, including the animals' reactions.
import * as THREE from 'three'

export const MAX_PARTICLES = 640

/** Lightning flash, 0..1: set by a strike, decays each frame; the sky light brightens with it (Environment.tsx). */
export const skyFlash = { value: 0 }

/** Sprite shapes drawn by the particle shader. */
export const SHAPE = { glow: 0, heart: 1, star: 2, smoke: 3, shard: 4 } as const

export const pool = {
  pos: new Float32Array(MAX_PARTICLES * 3),
  vel: new Float32Array(MAX_PARTICLES * 3),
  col: new Float32Array(MAX_PARTICLES * 3),
  /** World-space size (metres) at birth, and the size drawn this frame. */
  base: new Float32Array(MAX_PARTICLES),
  size: new Float32Array(MAX_PARTICLES),
  alpha: new Float32Array(MAX_PARTICLES),
  shape: new Float32Array(MAX_PARTICLES),
  life: new Float32Array(MAX_PARTICLES),
  max: new Float32Array(MAX_PARTICLES),
  grav: new Float32Array(MAX_PARTICLES),
  drag: new Float32Array(MAX_PARTICLES),
  /** 1 = grows as it fades (smoke, dust), 0 = shrinks (sparks). */
  grow: new Float32Array(MAX_PARTICLES),
  next: 0,
  alive: 0,
}

export interface Emit {
  count: number
  x: number
  y: number
  z: number
  /** Random offset radius around the origin. */
  spread?: number
  speed: [number, number]
  /** 0 = directions all around, 1 = straight up. */
  up?: number
  color: THREE.Color
  /** Optional second colour; each particle picks a random mix of the two. */
  color2?: THREE.Color
  /** Brightness multiplier (values above 1 bloom). */
  hdr?: number
  size: [number, number]
  life: [number, number]
  gravity?: number
  drag?: number
  shape?: number
  grow?: boolean
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export function emit(o: Emit) {
  const p = pool
  const hdr = o.hdr ?? 1
  for (let n = 0; n < o.count; n++) {
    const i = p.next
    p.next = (p.next + 1) % MAX_PARTICLES
    const i3 = i * 3
    const s = o.spread ?? 0
    p.pos[i3] = o.x + rand(-s, s)
    p.pos[i3 + 1] = o.y + rand(-s, s) * 0.5
    p.pos[i3 + 2] = o.z + rand(-s, s)
    // Random direction, biased upward by `up`.
    const th = Math.random() * Math.PI * 2
    const up = o.up ?? 0.3
    const vy = THREE.MathUtils.lerp(Math.random() * 2 - 1, 1, up)
    const h = Math.sqrt(Math.max(0, 1 - vy * vy))
    const sp = rand(o.speed[0], o.speed[1])
    p.vel[i3] = Math.cos(th) * h * sp
    p.vel[i3 + 1] = vy * sp
    p.vel[i3 + 2] = Math.sin(th) * h * sp
    const m = o.color2 ? Math.random() : 0
    const c2 = o.color2 ?? o.color
    p.col[i3] = THREE.MathUtils.lerp(o.color.r, c2.r, m) * hdr
    p.col[i3 + 1] = THREE.MathUtils.lerp(o.color.g, c2.g, m) * hdr
    p.col[i3 + 2] = THREE.MathUtils.lerp(o.color.b, c2.b, m) * hdr
    p.base[i] = rand(o.size[0], o.size[1])
    p.life[i] = p.max[i] = rand(o.life[0], o.life[1])
    p.grav[i] = o.gravity ?? 0
    p.drag[i] = o.drag ?? 0
    p.shape[i] = o.shape ?? SHAPE.glow
    p.grow[i] = o.grow ? 1 : 0
  }
}

/** Advance every live particle; returns how many are alive. */
export function stepParticles(dt: number) {
  const p = pool
  let alive = 0
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (p.life[i] <= 0) {
      p.size[i] = 0
      p.alpha[i] = 0
      continue
    }
    alive++
    p.life[i] -= dt
    const i3 = i * 3
    const k = Math.max(0, 1 - p.drag[i] * dt)
    p.vel[i3] *= k
    p.vel[i3 + 1] = p.vel[i3 + 1] * k - p.grav[i] * dt
    p.vel[i3 + 2] *= k
    p.pos[i3] += p.vel[i3] * dt
    p.pos[i3 + 1] += p.vel[i3 + 1] * dt
    p.pos[i3 + 2] += p.vel[i3 + 2] * dt
    const f = Math.max(0, p.life[i] / p.max[i]) // 1 at birth -> 0 at death
    p.size[i] = p.base[i] * (p.grow[i] ? 1 + (1 - f) * 1.6 : 0.35 + 0.65 * f)
    // Quick fade-in, long fade-out.
    p.alpha[i] = Math.min(1, (1 - f) * 12) * Math.min(1, f * 2.2)
  }
  p.alive = alive
  return alive
}
