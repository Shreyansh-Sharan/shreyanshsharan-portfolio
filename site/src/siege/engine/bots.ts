// Bot brains: pick a target (nearest, preferring the weakest), hold the hero's preferred range, strafe, seek cover
// when low, chase last-seen positions, flock to the objective, loot and stay inside the grid in the royale, and
// spend supers when they will land. Paths come from a small A* over the 2 m grid.
import { CELL } from './maps.ts'
import { SUPER } from './heroes.ts'
import type { Fighter, Sim } from './sim.ts'

export type BotMode = 'roam' | 'fight' | 'chase' | 'flee' | 'objective' | 'loot' | 'grid'

export interface BotState {
  target: number
  /** Waypoints in metres, in walking order. */
  path: { x: number; z: number }[]
  pathAt: number
  thinkAt: number
  mode: BotMode
  goalX: number
  goalZ: number
  strafe: number
  strafeAt: number
  seenAt: number
  seenX: number
  seenZ: number
  /** Per-bot personality 0..1 (aggression, timing). */
  jitter: number
}

const THINK = 0.2
const VIEW = 17

export function thinkBot(sim: Sim, f: Fighter, dt: number) {
  const b = f.bot!
  const now = sim.time
  const inp = f.input
  inp.dash = false
  inp.super = false
  const diff = sim.difficulty
  // Targets.
  const target = sim.fighter(b.target)
  if (now >= b.thinkAt) {
    b.thinkAt = now + THINK * (0.7 + b.jitter * 0.6)
    pickTarget(sim, f)
    decide(sim, f)
  }
  const t = target && target.alive && (b.target === target.id) ? target : sim.fighter(b.target)
  const visible = t && t.alive && canSee(sim, f, t)
  // Aim.
  if (t && t.alive && (visible || now - b.seenAt < 1.5)) {
    const dist = Math.hypot(t.x - f.x, t.z - f.z)
    const lead = Math.min(0.6, dist / f.hero.weapon.speed)
    const tx = visible ? t.x + t.vx * lead : b.seenX
    const tz = visible ? t.z + t.vz * lead : b.seenZ
    let a = Math.atan2(tz - f.z, tx - f.x)
    a += Math.sin(now * 3.1 + b.jitter * 20) * (1 - diff) * 0.22
    inp.ax = Math.cos(a)
    inp.az = Math.sin(a)
    inp.aimDist = dist
    const w = f.hero.weapon
    const inRange = dist <= w.range * (w.kind === 'launcher' ? 1 : 1.05)
    inp.fire = !!visible && inRange && (w.kind === 'launcher' ? sim.lineClear(f.x, f.z, t.x, t.z, true) : true) && now > f.spawnShieldUntil - 0.5
    if (w.kind === 'launcher' && visible && dist < 2.5) inp.fire = false
    if (f.cloakUntil && f.hp > f.maxHp * 0.5 && dist > 4) inp.fire = false // Sneak closer first.
  } else {
    inp.fire = false
    if (Math.hypot(inp.mx, inp.mz) > 0.1) {
      inp.ax = inp.mx
      inp.az = inp.mz
    }
  }
  // Move.
  steer(sim, f, dt)
  // Supers and dashes.
  if (f.super >= 1 && t && t.alive) {
    const dist = Math.hypot(t.x - f.x, t.z - f.z)
    switch (f.hero.superKind) {
      case 'bulwark':
        inp.super = !!visible && dist < 9
        break
      case 'sentry':
        inp.super = !!visible && dist < SUPER.sentry.range
        break
      case 'pulse':
        inp.super = !!visible && dist < SUPER.pulse.radius - 0.5
        break
      case 'cloak':
        inp.super = (!!visible && dist < 10) || f.hp < f.maxHp * 0.45
        break
      case 'mines':
        inp.super = (!!visible && dist < 7) || (sim.mode === 'capture' && sim.inZone(f))
        break
      case 'mend': {
        let hurtAllies = f.hp < f.maxHp * 0.7 ? 1 : 0
        for (const o of sim.fighters) if (o !== f && o.alive && o.team === f.team && o.hp < o.maxHp * 0.6 && Math.hypot(o.x - f.x, o.z - f.z) < SUPER.mend.radius) hurtAllies++
        inp.super = hurtAllies > 0 && (!!visible || f.hp < f.maxHp * 0.5)
        break
      }
    }
  } else if (f.super >= 1 && f.hero.superKind === 'mend' && f.hp < f.maxHp * 0.4) inp.super = true
  if (f.dashCd <= 0 && t && t.alive) {
    const dist = Math.hypot(t.x - f.x, t.z - f.z)
    if (b.mode === 'flee') inp.dash = true
    else if (visible && f.hero.prefRange <= 4 && dist > 4.5 && dist < 10) inp.dash = true
    else if (visible && f.hero.prefRange >= 8 && dist < 3.5) inp.dash = true
  }
}

function enemies(sim: Sim, f: Fighter) {
  return sim.fighters.filter((o) => o !== f && o.alive && (sim.mode === 'br' || o.team !== f.team))
}

function canSee(sim: Sim, f: Fighter, o: Fighter) {
  const d = Math.hypot(o.x - f.x, o.z - f.z)
  if (d > VIEW) return false
  if (o.cloakUntil && d > 2.5) return false
  return sim.lineClear(f.x, f.z, o.x, o.z)
}

function pickTarget(sim: Sim, f: Fighter) {
  const b = f.bot!
  let best: Fighter | null = null
  let bestScore = -1e9
  for (const o of enemies(sim, f)) {
    const d = Math.hypot(o.x - f.x, o.z - f.z)
    const vis = canSee(sim, f, o)
    if (!vis && d > 9) continue
    let s = -d + (1 - o.hp / o.maxHp) * 7 + (vis ? 6 : 0) + (o.id === b.target ? 2.5 : 0)
    if (o.human && sim.mode === 'br') s += 0.5
    if (s > bestScore) {
      bestScore = s
      best = o
    }
  }
  if (!best) {
    // Nobody in sight: remember whoever was closest last time, or drop the target.
    const old = sim.fighter(b.target)
    if (!old || !old.alive || sim.time - b.seenAt > 4) b.target = 0
    return
  }
  b.target = best.id
  if (canSee(sim, f, best)) {
    b.seenAt = sim.time
    b.seenX = best.x
    b.seenZ = best.z
  }
}

function decide(sim: Sim, f: Fighter) {
  const b = f.bot!
  const now = sim.time
  const t = sim.fighter(b.target)
  const visible = t && t.alive && canSee(sim, f, t)
  const dist = t && t.alive ? Math.hypot(t.x - f.x, t.z - f.z) : 99
  const g = sim.br
  const brave = f.hero.prefRange <= 4 || f.shield > 0 || f.hero.superKind === 'cloak' && f.cloakUntil > 0
  // Royale: never stay outside the grid.
  if (g) {
    const margin = now >= g.shrinkAt - 6 ? 3 : 1.5
    const nextInside = Math.abs(f.x - g.nextCx) <= g.nextHalf - margin && Math.abs(f.z - g.nextCz) <= g.nextHalf - margin
    const inside = sim.insideGrid(f.x, f.z, margin)
    if (!inside || (!nextInside && now >= g.shrinkAt - 8)) {
      const cx = !inside && now < g.shrinkAt - 8 ? g.cx : g.nextCx
      const cz = !inside && now < g.shrinkAt - 8 ? g.cz : g.nextCz
      const half = !inside && now < g.shrinkAt - 8 ? g.half : g.nextHalf
      const ang = b.jitter * Math.PI * 2
      setGoal(sim, f, 'grid', cx + Math.cos(ang) * half * 0.4, cz + Math.sin(ang) * half * 0.4)
      return
    }
  }
  // Low on health with someone close: find cover.
  if (f.hp < f.maxHp * (brave ? 0.18 : 0.32) && t && t.alive && dist < 10 && b.mode !== 'flee') {
    const c = coverPoint(sim, f, t)
    if (c) {
      setGoal(sim, f, 'flee', c.x, c.z)
      return
    }
  }
  if (b.mode === 'flee') {
    // Keep fleeing until healthier or the cover is reached.
    if (f.hp > f.maxHp * 0.45 || Math.hypot(f.x - b.goalX, f.z - b.goalZ) < 1) b.mode = 'roam'
    else return
  }
  if (t && t.alive && visible) {
    b.mode = 'fight'
    b.path.length = 0
    return
  }
  if (t && t.alive && now - b.seenAt < 5) {
    setGoal(sim, f, 'chase', b.seenX, b.seenZ)
    return
  }
  // Loot in the royale.
  if (sim.mode === 'br') {
    let best: { x: number; z: number } | null = null
    let bestD = 16
    for (const p of sim.pickups) {
      const d = Math.hypot(p.x - f.x, p.z - f.z)
      if (d < bestD && sim.insideGrid(p.x, p.z, 1)) {
        bestD = d
        best = p
      }
    }
    if (!best)
      for (const c of sim.crates) {
        if (c.hp <= 0 || !c.loot) continue
        const x = (c.cx + 0.5) * CELL
        const z = (c.cz + 0.5) * CELL
        const d = Math.hypot(x - f.x, z - f.z)
        if (d < bestD && sim.insideGrid(x, z, 1)) {
          bestD = d
          best = { x, z }
        }
      }
    if (best) {
      setGoal(sim, f, 'loot', best.x, best.z)
      return
    }
  }
  // Objective.
  if (sim.mode === 'capture') {
    const o = sim.objective
    const r = sim.map.zone * 0.6
    const ang = b.jitter * Math.PI * 2 + now * 0.2
    if (b.mode !== 'objective' || Math.hypot(f.x - b.goalX, f.z - b.goalZ) < 0.8) setGoal(sim, f, 'objective', o.x + Math.cos(ang) * r, o.z + Math.sin(ang) * r)
    return
  }
  // Roam: toward the enemy side (team modes) or the safe centre (royale), with some wander.
  if (b.mode !== 'roam' || Math.hypot(f.x - b.goalX, f.z - b.goalZ) < 1.2 || now - b.pathAt > 6) {
    let gx: number
    let gz: number
    if (g) {
      const half = g.nextHalf * 0.7
      gx = g.nextCx + sim.rng.range(-half, half)
      gz = g.nextCz + sim.rng.range(-half, half)
    } else {
      const es = enemies(sim, f)
      const e = es.length ? es[sim.rng.int(es.length)] : null
      const cx = (sim.w * CELL) / 2
      const cz = (sim.h * CELL) / 2
      gx = (e ? e.x : cx) + sim.rng.range(-6, 6)
      gz = (e ? e.z : cz) + sim.rng.range(-6, 6)
      if (e && Math.hypot(e.x - f.x, e.z - f.z) > 14) {
        gx = f.x + ((e.x - f.x) * 0.5) + sim.rng.range(-4, 4)
        gz = f.z + ((e.z - f.z) * 0.5) + sim.rng.range(-4, 4)
      }
    }
    setGoal(sim, f, 'roam', gx, gz)
  }
}

function setGoal(sim: Sim, f: Fighter, mode: BotMode, x: number, z: number) {
  const b = f.bot!
  const p = nearestFloor(sim, x, z)
  const changed = mode !== b.mode || Math.hypot(p.x - b.goalX, p.z - b.goalZ) > 1.5
  b.mode = mode
  b.goalX = p.x
  b.goalZ = p.z
  if (changed || sim.time - b.pathAt > 0.8) {
    b.path = findPath(sim, f.x, f.z, p.x, p.z)
    b.pathAt = sim.time
  }
}

function nearestFloor(sim: Sim, x: number, z: number) {
  const cx0 = Math.min(sim.w - 1, Math.max(0, Math.floor(x / CELL)))
  const cz0 = Math.min(sim.h - 1, Math.max(0, Math.floor(z / CELL)))
  if (sim.walkable(cx0, cz0)) return { x: (cx0 + 0.5) * CELL, z: (cz0 + 0.5) * CELL }
  for (let r = 1; r < 8; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (sim.walkable(cx0 + dx, cz0 + dz)) return { x: (cx0 + dx + 0.5) * CELL, z: (cz0 + dz + 0.5) * CELL }
      }
  return { x, z }
}

function coverPoint(sim: Sim, f: Fighter, from: Fighter) {
  let best: { x: number; z: number } | null = null
  let bestScore = -1e9
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    for (const r of [3.5, 6]) {
      const x = f.x + Math.cos(a) * r
      const z = f.z + Math.sin(a) * r
      if (sim.cellAt(x, z) !== 'floor') continue
      let s = sim.lineClear(from.x, from.z, x, z) ? 0 : 12
      s += Math.hypot(from.x - x, from.z - z) * 0.4
      if (!sim.insideGrid(x, z, 1)) s -= 30
      if (sim.mode === 'capture') s -= Math.hypot(sim.objective.x - x, sim.objective.z - z) * 0.1
      if (s > bestScore) {
        bestScore = s
        best = { x, z }
      }
    }
  }
  return best
}

function steer(sim: Sim, f: Fighter, dt: number) {
  const b = f.bot!
  const inp = f.input
  const now = sim.time
  const t = sim.fighter(b.target)
  if (b.mode === 'fight' && t && t.alive) {
    const dx = t.x - f.x
    const dz = t.z - f.z
    const dist = Math.hypot(dx, dz) || 1
    const nx = dx / dist
    const nz = dz / dist
    const pref = f.hero.prefRange
    let fx = 0
    let fz = 0
    if (dist > pref + 1.2) {
      fx = nx
      fz = nz
    } else if (dist < pref - 1.2 && pref > 4) {
      fx = -nx
      fz = -nz
    }
    if (now > b.strafeAt) {
      b.strafeAt = now + 0.8 + sim.rng.next() * 1.4
      b.strafe = sim.rng.chance(0.5) ? 1 : -1
    }
    const sx = -nz * b.strafe
    const sz = nx * b.strafe
    let mx = fx * 0.8 + sx * 0.75
    let mz = fz * 0.8 + sz * 0.75
    // Don't walk into walls or the void while strafing.
    if (sim.cellAt(f.x + mx * 1.1, f.z + mz * 1.1) !== 'floor') {
      b.strafe = -b.strafe
      mx = fx * 0.8 - sx * 0.75
      mz = fz * 0.8 - sz * 0.75
      if (sim.cellAt(f.x + mx * 1.1, f.z + mz * 1.1) !== 'floor') {
        mx = fx
        mz = fz
        if (sim.cellAt(f.x + mx * 1.1, f.z + mz * 1.1) !== 'floor') {
          mx = 0
          mz = 0
        }
      }
    }
    if (sim.br && !sim.insideGrid(f.x + mx * 1.5, f.z + mz * 1.5, 1)) {
      mx = sim.br.cx - f.x
      mz = sim.br.cz - f.z
    }
    const l = Math.hypot(mx, mz) || 1
    inp.mx = mx / l
    inp.mz = mz / l
    return
  }
  // Follow the path.
  while (b.path.length && Math.hypot(b.path[0].x - f.x, b.path[0].z - f.z) < 0.7) b.path.shift()
  if (!b.path.length) {
    const d = Math.hypot(b.goalX - f.x, b.goalZ - f.z)
    if (d > 0.8 && now - b.pathAt > 0.5) {
      b.path = findPath(sim, f.x, f.z, b.goalX, b.goalZ)
      b.pathAt = now
    }
    if (!b.path.length) {
      if (d > 0.8 && sim.cellAt(f.x + ((b.goalX - f.x) / d) * 0.8, f.z + ((b.goalZ - f.z) / d) * 0.8) === 'floor') {
        inp.mx = (b.goalX - f.x) / d
        inp.mz = (b.goalZ - f.z) / d
      } else {
        inp.mx = 0
        inp.mz = 0
      }
      return
    }
  }
  const wp = b.path[0]
  const dx = wp.x - f.x
  const dz = wp.z - f.z
  const d = Math.hypot(dx, dz) || 1
  inp.mx = dx / d
  inp.mz = dz / d
  void dt
}

/* ---------- A* on the cell grid (8 neighbours, no corner cutting) ---------- */

export function findPath(sim: Sim, x0: number, z0: number, x1: number, z1: number) {
  const W = sim.w
  const H = sim.h
  const start = cellIndex(sim, x0, z0)
  const goal = cellIndex(sim, x1, z1)
  if (start < 0 || goal < 0) return []
  if (start === goal) return [{ x: x1, z: z1 }]
  const gScore = new Float32Array(W * H).fill(Infinity)
  const from = new Int32Array(W * H).fill(-1)
  const closed = new Uint8Array(W * H)
  const open: number[] = [start]
  const fScore = new Float32Array(W * H).fill(Infinity)
  gScore[start] = 0
  fScore[start] = heuristic(start, goal, W)
  let expanded = 0
  while (open.length) {
    // Smallest f (linear scan is fine for these grid sizes).
    let bi = 0
    for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bi]]) bi = i
    const cur = open[bi]
    open[bi] = open[open.length - 1]
    open.pop()
    if (cur === goal) break
    if (closed[cur]) continue
    closed[cur] = 1
    if (++expanded > 6000) break
    const cx = cur % W
    const cz = (cur - cx) / W
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue
        const nx = cx + dx
        const nz = cz + dz
        if (!sim.walkable(nx, nz)) continue
        if (dx && dz && (!sim.walkable(cx + dx, cz) || !sim.walkable(cx, cz + dz))) continue
        const ni = nz * W + nx
        if (closed[ni]) continue
        let cost = dx && dz ? 1.414 : 1
        // Stay away from the shrinking grid's edge.
        if (sim.br && !sim.insideGrid((nx + 0.5) * CELL, (nz + 0.5) * CELL, 1)) cost += 6
        const g = gScore[cur] + cost
        if (g < gScore[ni]) {
          gScore[ni] = g
          from[ni] = cur
          fScore[ni] = g + heuristic(ni, goal, W)
          open.push(ni)
        }
      }
  }
  if (from[goal] < 0) {
    // Unreachable: walk toward the closest explored cell instead.
    let best = start
    let bestH = Infinity
    for (let i = 0; i < W * H; i++)
      if (closed[i]) {
        const h = heuristic(i, goal, W)
        if (h < bestH) {
          bestH = h
          best = i
        }
      }
    if (best === start) return []
    return unwind(sim, from, best, start)
  }
  const path = unwind(sim, from, goal, start)
  path[path.length - 1] = { x: x1, z: z1 }
  return path
}

function unwind(sim: Sim, from: Int32Array, end: number, start: number) {
  const cells: number[] = []
  let c = end
  while (c !== start && c >= 0) {
    cells.push(c)
    c = from[c]
  }
  cells.reverse()
  return cells.map((i) => ({ x: ((i % sim.w) + 0.5) * CELL, z: (Math.floor(i / sim.w) + 0.5) * CELL }))
}

function heuristic(a: number, b: number, W: number) {
  const ax = a % W
  const az = (a - ax) / W
  const bx = b % W
  const bz = (b - bx) / W
  const dx = Math.abs(ax - bx)
  const dz = Math.abs(az - bz)
  return Math.max(dx, dz) + 0.414 * Math.min(dx, dz)
}

function cellIndex(sim: Sim, x: number, z: number) {
  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  if (cx < 0 || cz < 0 || cx >= sim.w || cz >= sim.h) return -1
  if (sim.walkable(cx, cz)) return cz * sim.w + cx
  // Standing on a non-floor cell (knocked onto something): use the nearest floor.
  const p = nearestFloor(sim, x, z)
  const px = Math.floor(p.x / CELL)
  const pz = Math.floor(p.z / CELL)
  return sim.walkable(px, pz) ? pz * sim.w + px : -1
}

