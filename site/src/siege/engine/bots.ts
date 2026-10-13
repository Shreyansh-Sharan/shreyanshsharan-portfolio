// Bot brains: pick a target (nearest, preferring the weakest), hold the hero's preferred range, strafe, seek cover
// when low, chase last-seen positions, flock to the objective, loot and stay inside the grid in the royale, and
// spend supers when they will land. Powers are played into the counter web: walls against snipers, scan darts on
// cloakers and decoys, heat vents on shields and gadgets, blinks out of slows, toxin on channels and charges,
// purges when poisoned or marked. Bots also contest the power-up pads, sweep up coin shards, step out of enemy gas
// and can be fooled by decoys like anyone else. Paths come from a small A* over the 2 m grid.
import { CELL } from './maps.ts'
import { SUPER } from './heroes.ts'
import { POWER } from './powers.ts'
import type { Deployable, Fighter, Sim } from './sim.ts'

export type BotMode = 'roam' | 'fight' | 'chase' | 'flee' | 'objective' | 'loot' | 'grid' | 'pad'

export interface BotState {
  target: number
  /** Enemy decoy currently drawing this bot's fire (0 = none). */
  decoy: number
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
  /** Next time the bot weighs its power. */
  powerAt: number
}

/** What the bot is fighting: a fighter, or the decoy it thinks is one. */
interface Foe {
  x: number
  z: number
  vx: number
  vz: number
  f: Fighter
  decoy: Deployable | null
}

const THINK = 0.2
const VIEW = 17

export function thinkBot(sim: Sim, f: Fighter, _dt: number) {
  const b = f.bot!
  const now = sim.time
  const inp = f.input
  inp.dash = false
  inp.super = false
  inp.power = false
  const diff = sim.difficulty
  if (now >= b.thinkAt) {
    b.thinkAt = now + THINK * (0.7 + b.jitter * 0.6)
    pickTarget(sim, f)
    decide(sim, f)
  }
  const t = sim.fighter(b.target)
  const foe = foeOf(sim, f)
  const visible = !!foe && (foe.decoy ? canSeePoint(sim, f, foe.x, foe.z) : canSee(sim, f, foe.f))
  // Aim.
  if (foe && (visible || now - b.seenAt < 1.5)) {
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z)
    const lead = Math.min(0.6, dist / f.hero.weapon.speed)
    const tx = visible ? foe.x + foe.vx * lead : b.seenX
    const tz = visible ? foe.z + foe.vz * lead : b.seenZ
    let a = Math.atan2(tz - f.z, tx - f.x)
    a += Math.sin(now * 3.1 + b.jitter * 20) * (1 - diff) * 0.22
    inp.ax = Math.cos(a)
    inp.az = Math.sin(a)
    inp.aimDist = dist
    const w = f.hero.weapon
    const lob = w.kind === 'launcher'
    const inRange = dist <= w.range * (lob ? 1 : 1.05)
    inp.fire = visible && inRange && (lob ? sim.lineClear(f.x, f.z, foe.x, foe.z, true) : !sim.wallBlocks(f, foe.x, foe.z)) && now > f.spawnShieldUntil - 0.5
    if (lob && visible && dist < 2.5) inp.fire = false
    if (w.kind === 'flame' && sim.hasStatus(f, 'toxin')) inp.fire = false
    if (f.cloakUntil && f.hp > f.maxHp * 0.5 && dist > 4) inp.fire = false // Sneak closer first.
  } else {
    inp.fire = false
    if (Math.hypot(inp.mx, inp.mz) > 0.1) {
      inp.ax = inp.mx
      inp.az = inp.mz
    }
  }
  // Move.
  steer(sim, f, foe)
  // Supers and dashes.
  if (f.super >= 1 && t && t.alive && !foe?.decoy) {
    const dist = Math.hypot(t.x - f.x, t.z - f.z)
    switch (f.hero.superKind) {
      case 'bulwark':
        inp.super = visible && dist < 9 && !sim.hasStatus(f, 'toxin')
        break
      case 'sentry':
        inp.super = visible && dist < SUPER.sentry.range
        break
      case 'pulse':
        inp.super = visible && dist < SUPER.pulse.radius - 0.5
        break
      case 'cloak':
        inp.super = !sim.hasStatus(f, 'revealed') && ((visible && dist < 10) || f.hp < f.maxHp * 0.45)
        break
      case 'mines':
        inp.super = (visible && dist < 7) || (sim.mode === 'capture' && sim.inZone(f))
        break
      case 'mend': {
        let hurtAllies = f.hp < f.maxHp * 0.7 ? 1 : 0
        for (const o of sim.fighters) if (o !== f && o.alive && o.team === f.team && o.hp < o.maxHp * 0.6 && Math.hypot(o.x - f.x, o.z - f.z) < SUPER.mend.radius) hurtAllies++
        inp.super = hurtAllies > 0 && (visible || f.hp < f.maxHp * 0.5) && !sim.hasStatus(f, 'scorch')
        break
      }
    }
  } else if (f.super >= 1 && f.hero.superKind === 'mend' && f.hp < f.maxHp * 0.4 && !sim.hasStatus(f, 'scorch')) inp.super = true
  if (f.dashCd <= 0 && foe && !sim.hasStatus(f, 'toxin')) {
    const dist = Math.hypot(foe.x - f.x, foe.z - f.z)
    if (b.mode === 'flee') inp.dash = true
    else if (visible && f.hero.prefRange <= 4 && dist > 4.5 && dist < 10) inp.dash = true
    else if (visible && f.hero.prefRange >= 8 && dist < 3.5) inp.dash = true
  }
  if (now >= b.powerAt && f.powerCd <= 0 && !f.channelUntil) {
    b.powerAt = now + 0.12 + (1 - diff) * 0.25 * b.jitter
    botPower(sim, f, foe, visible)
  }
}

/** The bot's current foe: the decoy it is fooled by, or its target fighter. */
function foeOf(sim: Sim, f: Fighter): Foe | null {
  const b = f.bot!
  const t = sim.fighter(b.target)
  if (!t || !t.alive) return null
  if (b.decoy) {
    const d = sim.deployables.find((x) => x.id === b.decoy && x.hp > 0)
    if (d) return { x: d.x, z: d.z, vx: d.vx, vz: d.vz, f: t, decoy: d }
    b.decoy = 0
  }
  return { x: t.x, z: t.z, vx: t.vx, vz: t.vz, f: t, decoy: null }
}

/** Signature powers, played into the counter web. */
function botPower(sim: Sim, f: Fighter, foe: Foe | null, visible: boolean) {
  const inp = f.input
  const b = f.bot!
  const now = sim.time
  const dist = foe ? Math.hypot(foe.x - f.x, foe.z - f.z) : 99
  const t = foe?.f ?? null
  const aimAt = (x: number, z: number) => {
    const l = Math.hypot(x - f.x, z - f.z) || 1
    inp.ax = (x - f.x) / l
    inp.az = (z - f.z) / l
    inp.aimDist = l
  }
  switch (f.hero.power) {
    case 'wall': {
      // Raise the wall against direct fire at range; brawl through everything else.
      if (!t || !visible || sim.wallBlocks(t, f.x, f.z)) break
      const direct = t.hero.weapon.kind !== 'launcher'
      const vented = t.hero.power === 'vent' && dist < POWER.vent.radius + 2
      if (direct && !vented && dist > 3 && dist < 18 && (t.hero.prefRange >= 6 || f.hp < f.maxHp * 0.65 || t.hero.power === 'dart')) {
        aimAt(foe!.x, foe!.z)
        inp.power = true
      }
      break
    }
    case 'dart': {
      // Strip cloaks at the last place they were seen, expose decoys, mark whatever is in sight.
      for (const o of sim.fighters) {
        if (!o.alive || !sim.isEnemy(f, o) || !o.cloakUntil) continue
        if (o.id === b.target && now - b.seenAt < 2.5 && Math.hypot(b.seenX - f.x, b.seenZ - f.z) < 16) {
          aimAt(b.seenX, b.seenZ)
          inp.power = true
          return
        }
      }
      for (const d of sim.deployables)
        if (d.kind === 'decoy' && d.hp > 0 && sim.isEnemy(f, { id: d.owner, team: d.team }) && Math.hypot(d.x - f.x, d.z - f.z) < 16 && sim.lineClear(f.x, f.z, d.x, d.z)) {
          aimAt(d.x, d.z)
          inp.power = true
          return
        }
      if (t && visible && dist < 20 && !sim.wallBlocks(f, foe!.x, foe!.z)) {
        // Hold it for a lunging or charging brawler (the impact breaks channels), unless it's far off.
        const brawler = t.hero.power === 'vent' || t.hero.superKind === 'bulwark'
        const committed = t.channelUntil > 0 || (t.hero.superKind === 'bulwark' && t.superUntil > now)
        if (brawler && !committed && dist < 9 && f.hp > f.maxHp * 0.35) break
        aimAt(foe!.x + foe!.vx * (dist / POWER.dart.speed), foe!.z + foe!.vz * (dist / POWER.dart.speed))
        inp.power = true
      }
      break
    }
    case 'vent': {
      // Lunge in to melt shields, walls and gadgets; scorch anyone close (healers first).
      const r = POWER.vent.radius + POWER.vent.lunge * POWER.vent.windup * 0.8
      let n = 0
      let juicy = false
      for (const o of sim.fighters) {
        if (!o.alive || !sim.isEnemy(f, o)) continue
        const d = Math.hypot(o.x - f.x, o.z - f.z)
        if (d > r - 0.4) continue
        n++
        if (o.shield > 0 || o.hero.power === 'purge' || d < r - 1.4) juicy = true
        if (o.id !== foe?.f.id && d > POWER.vent.radius) n--
      }
      for (const d of sim.deployables) {
        if (d.kind === 'gas' || d.kind === 'decoy' || d.hp <= 0 || !sim.isEnemy(f, { id: d.owner, team: d.team })) continue
        if (Math.hypot(d.x - f.x, d.z - f.z) < r) juicy = true
      }
      if (juicy && (n > 0 || dist > 2) && !sim.hasStatus(f, 'toxin')) inp.power = true
      break
    }
    case 'blink': {
      const slowed = !!sim.hasStatus(f, 'slow')
      let dx = 0
      let dz = 0
      if (slowed || (t && visible && f.hp < f.maxHp * 0.45 && dist < 9)) {
        // Slip out: away from the threat, a little sideways so the decoy takes the heat.
        const ax = foe ? f.x - foe.x : -inp.mx
        const az = foe ? f.z - foe.z : -inp.mz
        const l = Math.hypot(ax, az) || 1
        dx = ax / l - (az / l) * 0.6 * b.strafe
        dz = az / l + (ax / l) * 0.6 * b.strafe
      } else if (t && visible && !foe!.decoy && dist > 8 && dist < 15 && f.hp > f.maxHp * 0.6) {
        // Engage on a diagonal so the hologram and the real runner split up.
        const ux = (foe!.x - f.x) / dist
        const uz = (foe!.z - f.z) / dist
        dx = ux * 0.7 - uz * 0.7 * b.strafe
        dz = uz * 0.7 + ux * 0.7 * b.strafe
      } else if (t && visible && !foe!.decoy && dist < 10 && f.hp < f.maxHp * 0.8 && (t.hero.weapon.kind === 'needler' || t.hero.weapon.kind === 'launcher' || t.hero.weapon.kind === 'rifle')) {
        // Dodge sideways and leave the hologram in the line of fire.
        dx = -(foe!.z - f.z) * b.strafe
        dz = (foe!.x - f.x) * b.strafe
      }
      if (dx || dz) {
        const l = Math.hypot(dx, dz)
        inp.mx = dx / l
        inp.mz = dz / l
        inp.power = true
      }
      break
    }
    case 'toxin': {
      if (!t || !visible || foe!.decoy) break
      const channel = t.channelUntil > 0 || (t.hero.superKind === 'bulwark' && t.superUntil > now)
      if (dist <= POWER.toxin.range && (channel || dist > 2.5) && sim.lineClear(f.x, f.z, t.x, t.z, true) && !sim.hasStatus(t, 'purged')) {
        const lead = dist / POWER.toxin.speed
        let x = t.x + t.vx * lead * 0.6
        let z = t.z + t.vz * lead * 0.6
        // Against a brawler closing in, lay the gas across its path so it has to wade through.
        if (!channel && t.hero.prefRange <= 4 && dist > 4) {
          const k = Math.min(2.2, dist - 3.5) / dist
          x = t.x + (f.x - t.x) * k
          z = t.z + (f.z - t.z) * k
        }
        aimAt(x, z)
        inp.power = true
      }
      break
    }
    case 'purge': {
      let need = sim.debuffed(f) || (f.hp < f.maxHp * 0.5 && !!t && visible && dist < 9)
      if (!need)
        for (const o of sim.fighters) {
          if (o === f || !o.alive || o.team !== f.team || sim.mode === 'br') continue
          if (Math.hypot(o.x - f.x, o.z - f.z) > POWER.purge.radius - 0.5) continue
          if (sim.debuffed(o) || o.hp < o.maxHp * 0.45) need = true
        }
      if (need) inp.power = true
      break
    }
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

function canSeePoint(sim: Sim, f: Fighter, x: number, z: number) {
  return Math.hypot(x - f.x, z - f.z) <= VIEW && sim.lineClear(f.x, f.z, x, z)
}

function pickTarget(sim: Sim, f: Fighter) {
  const b = f.bot!
  let best: Fighter | null = null
  let bestScore = -1e9
  let decoy: Deployable | null = null
  // Decoys look exactly like their owner (fresh and closer, so they tend to win the bot's attention).
  for (const d of sim.deployables) {
    if (d.kind !== 'decoy' || d.hp <= 0 || !sim.isEnemy(f, { id: d.owner, team: d.team })) continue
    const owner = sim.fighter(d.owner)
    if (!owner || !owner.alive || !canSeePoint(sim, f, d.x, d.z)) continue
    const s = -Math.hypot(d.x - f.x, d.z - f.z) + (1 - owner.hp / owner.maxHp) * 7 + 9 + (owner.id === b.target ? 2.5 : 0)
    if (s > bestScore) {
      bestScore = s
      best = owner
      decoy = d
    }
  }
  for (const o of enemies(sim, f)) {
    const d = Math.hypot(o.x - f.x, o.z - f.z)
    const vis = canSee(sim, f, o)
    if (!vis && d > 9) continue
    let s = -d + (1 - o.hp / o.maxHp) * 7 + (vis ? 6 : 0) + (o.id === b.target ? 2.5 : 0)
    if (o.human && sim.mode === 'br') s += 0.5
    if (s > bestScore) {
      bestScore = s
      best = o
      decoy = null
    }
  }
  b.decoy = decoy ? decoy.id : 0
  if (decoy) {
    b.target = decoy.owner
    b.seenAt = sim.time
    b.seenX = decoy.x
    b.seenZ = decoy.z
    return
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
  const foe = foeOf(sim, f)
  const t = foe?.f ?? null
  const visible = !!foe && (foe.decoy ? canSeePoint(sim, f, foe.x, foe.z) : canSee(sim, f, foe.f))
  const dist = foe ? Math.hypot(foe.x - f.x, foe.z - f.z) : 99
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
  // A power-up a few steps away is worth breaking off for (contest it), a medkit when hurt more so.
  const pad = nearPad(sim, f, visible ? 5 + b.jitter * 2 : sim.br ? 20 : 15, f.hp < f.maxHp * 0.6)
  if (pad && (!visible || Math.hypot(pad.x - f.x, pad.z - f.z) < dist)) {
    setGoal(sim, f, 'pad', pad.x, pad.z)
    return
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
  // Coin shards close by.
  for (const p of sim.pickups) {
    if (p.kind !== 'shard' || Math.hypot(p.x - f.x, p.z - f.z) > 8 || !sim.insideGrid(p.x, p.z, 1)) continue
    setGoal(sim, f, 'loot', p.x, p.z)
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

/** A ready (or nearly ready) power-up pad within reach that no ally is closer to. */
function nearPad(sim: Sim, f: Fighter, range: number, hurt: boolean) {
  let best: { x: number; z: number } | null = null
  let bestD = range
  for (const p of sim.pads) {
    const wait = p.readyAt - sim.time
    const d = Math.hypot(p.x - f.x, p.z - f.z)
    if (wait > Math.min(2.5, d / f.speed) || !sim.insideGrid(p.x, p.z, 1)) continue
    const score = d - (hurt && p.kind === 'medkit' ? 8 : 0) - (p.kind === 'revive' ? 6 : 0)
    if (score >= bestD) continue
    if (sim.mode !== 'br' && sim.fighters.some((o) => o !== f && o.alive && o.team === f.team && Math.hypot(p.x - o.x, p.z - o.z) < d - 1)) continue
    bestD = score
    best = p
  }
  return best
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
  // An open spot is its own goal (pickups and pads sit off the cell centres).
  if (sim.walkable(cx0, cz0)) return sim.fits(x, z) ? { x, z } : { x: (cx0 + 0.5) * CELL, z: (cz0 + 0.5) * CELL }
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

function steer(sim: Sim, f: Fighter, foe: Foe | null) {
  const inp = f.input
  steerMain(sim, f, foe)
  // Step out of enemy gas.
  for (const d of sim.deployables) {
    if (d.kind !== 'gas' || !sim.isEnemy(f, { id: d.owner, team: d.team })) continue
    const dx = f.x - d.x
    const dz = f.z - d.z
    const l = Math.hypot(dx, dz)
    if (l > POWER.toxin.radius + 0.6) continue
    const k = 1.6
    let mx = inp.mx + (dx / (l || 1)) * k
    let mz = inp.mz + (dz / (l || 1)) * k
    if (sim.cellAt(f.x + mx * 0.8, f.z + mz * 0.8) !== 'floor') {
      mx = inp.mx
      mz = inp.mz
    }
    const m = Math.hypot(mx, mz) || 1
    inp.mx = mx / m
    inp.mz = mz / m
  }
}

function steerMain(sim: Sim, f: Fighter, foe: Foe | null) {
  const b = f.bot!
  const inp = f.input
  const now = sim.time
  if (b.mode === 'fight' && foe) {
    const dx = foe.x - f.x
    const dz = foe.z - f.z
    const dist = Math.hypot(dx, dz) || 1
    const nx = dx / dist
    const nz = dz / dist
    // An enemy Riot Wall in the way: brawlers walk through it (it only stops bullets); shooters flank it.
    const walled = f.hero.weapon.kind !== 'launcher' && sim.wallBlocks(f, foe.x, foe.z)
    const pref = walled && f.hero.prefRange <= 4 ? 1.5 : f.hero.prefRange
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
    const side = walled && f.hero.prefRange > 4 ? 1.4 : 0.75
    let mx = fx * 0.8 + sx * side
    let mz = fz * 0.8 + sz * side
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

