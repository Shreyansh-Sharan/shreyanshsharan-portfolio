// Bot helpers for level `bot()` hooks: steering, obstacle hops, edge caution and skill by difficulty.
import type { Toy } from './toy'
import type { LevelCtx } from './types'

/** Skill numbers by difficulty (0 easy, 1 normal, 2 hard). */
export function skill(ctx: LevelCtx) {
  const d = Math.max(0, Math.min(2, ctx.difficulty))
  return {
    /** Seconds to react to a cue. */
    reaction: [0.55, 0.35, 0.2][d],
    /** 0..1 how precise they are (tracing, aiming). */
    accuracy: [0.72, 0.86, 0.95][d],
    /** Fraction of top speed they usually run at. */
    pace: [0.8, 0.9, 1][d],
    /** Chance per second of a silly mistake. */
    blunder: [0.12, 0.06, 0.025][d],
    aggression: [0.3, 0.55, 0.8][d] * (0.6 + ctx.spice * 0.3),
  }
}

/** Point the bot's stick at (x, z). Stops inside `stop` metres. Returns the distance. */
export function steerTo(toy: Toy, x: number, z: number, opts: { stop?: number; pace?: number } = {}) {
  const dx = x - toy.pos.x, dz = z - toy.pos.z
  const d = Math.hypot(dx, dz)
  const stop = opts.stop ?? 0.3
  if (d < stop) {
    toy.pad.mx = toy.pad.mz = 0
    return d
  }
  const k = (opts.pace ?? 1) * Math.min(1, (d - stop) / 0.6 + 0.3)
  toy.pad.mx = (dx / d) * k
  toy.pad.mz = (dz / d) * k
  return d
}

/** Hop over low obstacles: jump when something is right in front at shin height. */
export function hopObstacles(ctx: LevelCtx, toy: Toy) {
  if (!toy.grounded) return
  const sp = Math.hypot(toy.pad.mx, toy.pad.mz)
  if (sp < 0.3) return
  const dir = { x: toy.pad.mx / sp, y: 0, z: toy.pad.mz / sp }
  const low = ctx.phys.cast({ x: toy.pos.x, y: toy.feet + 0.25, z: toy.pos.z }, dir, 0.9)
  if (low >= 0) {
    const high = ctx.phys.cast({ x: toy.pos.x, y: toy.feet + 1.3, z: toy.pos.z }, dir, 1.0)
    if (high < 0) toy.pad.jump = true
  }
}

/** Steer around a blocking wall by sliding along it (cheap whisker avoidance). */
export function avoidWalls(ctx: LevelCtx, toy: Toy) {
  const sp = Math.hypot(toy.pad.mx, toy.pad.mz)
  if (sp < 0.2) return
  const fx = toy.pad.mx / sp, fz = toy.pad.mz / sp
  const ahead = ctx.phys.cast({ x: toy.pos.x, y: toy.feet + 0.5, z: toy.pos.z }, { x: fx, y: 0, z: fz }, 1.4)
  if (ahead < 0) return
  // Try left and right whiskers; go the clearer way.
  const lx = fx * 0.7 - fz * 0.7, lz = fz * 0.7 + fx * 0.7
  const rx = fx * 0.7 + fz * 0.7, rz = fz * 0.7 - fx * 0.7
  const l = ctx.phys.cast({ x: toy.pos.x, y: toy.feet + 0.5, z: toy.pos.z }, { x: lx, y: 0, z: lz }, 2)
  const r = ctx.phys.cast({ x: toy.pos.x, y: toy.feet + 0.5, z: toy.pos.z }, { x: rx, y: 0, z: rz }, 2)
  const goLeft = l < 0 || (r >= 0 && l > r) || (l < 0 && r < 0 && toy.idx % 2 === 0)
  toy.pad.mx = (goLeft ? -fz : fz) * sp
  toy.pad.mz = (goLeft ? fx : -fx) * sp
}

/** Keep away from the rim of a round arena: blend the stick back towards the centre near the edge. */
export function keepInside(toy: Toy, cx: number, cz: number, radius: number, margin = 1.5) {
  const dx = toy.pos.x - cx, dz = toy.pos.z - cz
  const r = Math.hypot(dx, dz)
  if (r < radius - margin || r < 1e-3) return
  const k = Math.min(1, (r - (radius - margin)) / margin)
  toy.pad.mx = toy.pad.mx * (1 - k) - (dx / r) * k
  toy.pad.mz = toy.pad.mz * (1 - k) - (dz / r) * k
}

/** The nearest active rival within `range`, or null. */
export function nearestRival(ctx: LevelCtx, toy: Toy, range = Infinity) {
  let best: Toy | null = null
  let bd = range
  for (const t of ctx.toys) {
    if (t === toy || t.status !== 'play') continue
    const d = t.pos.distanceTo(toy.pos)
    if (d < bd) {
      bd = d
      best = t
    }
  }
  return best
}

/** Face (and shove) a rival that's close in front. */
export function bully(toy: Toy, target: Toy, range = 1.3) {
  const dx = target.pos.x - toy.pos.x, dz = target.pos.z - toy.pos.z
  const d = Math.hypot(dx, dz)
  if (d < range && d > 0.01) {
    toy.pad.mx = dx / d
    toy.pad.mz = dz / d
    const f = toy.facing()
    if ((dx * f.x + dz * f.z) / d > 0.6) toy.pad.shove = true
  }
}
