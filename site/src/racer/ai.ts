// AI rivals: follow the track spline with per-driver offsets, brake for corners, chase preferred pickups,
// avoid hazards, and use power-ups by the rules in the design doc. Personality changes pickup and weapon choices.
// In an arena (the Dust Bowl) there is no racing line: bots wander, detour for pickups while the bay has room,
// then hunt the nearest or most damaged rival, steering round rock and hazards and backing out when stuck.
import * as THREE from 'three'
import { CONFIG } from './config'
import { fire, fireBolt, incomingShunt, lockTarget } from './weapons'
import { arenaBlocked, onFloor, type ArenaLayout, type Obstacle } from './arena'
import type { PowerType } from './track'
import type { Car } from './car'
import type { Game } from './game'

const PREFS: Record<string, PowerType[]> = {
  Brawler: ['barge', 'ram', 'mine', 'shunt', 'flak', 'repair'],
  Sniper: ['rail', 'bolt', 'shunt', 'shield', 'repair'],
  Racer: ['nitro', 'shield', 'repair', 'bolt', 'rail'],
  Trickster: ['oil', 'mine', 'shock', 'shunt', 'flak', 'nitro'],
}

const tmp = new THREE.Vector3()
const aimAt = new THREE.Vector3()

export function aiDrive(game: Game, car: Car, dt: number) {
  if (game.track.arena) return arenaDrive(game, car, dt)
  const track = game.track
  const ai = car.ai
  const speed = Math.max(0, car.forwardSpeed)
  const half = track.half - 2

  // Hazard avoidance: Mines and Shock domes within range ahead.
  let avoid = 0
  const hazards: { s: number; lat: number }[] = []
  for (const p of game.projectiles) if ((p.kind === 'mine' || p.kind === 'oil') && !p.lob) hazards.push(hazardOf(game, p.pos))
  for (const d of game.domes) hazards.push(hazardOf(game, d.pos))
  for (const h of hazards) {
    let ds = h.s - car.s
    if (ds < -track.length / 2) ds += track.length
    if (ds < 0 || ds > CONFIG.ai_avoid_range * (0.6 + car.skill * 0.5)) continue
    const dl = car.lateral + ai.laneOffset - h.lat
    if (Math.abs(dl) < 5.5) avoid += (dl >= 0 ? 1 : -1) * (6 - Math.abs(dl)) * (h.lat > half - 2 ? -1 : 1)
  }
  ai.avoid += (avoid - ai.avoid) * Math.min(1, dt * 4)

  // Swerve when a Shunt is incoming (skilled drivers only).
  const threat = incomingShunt(game, car)
  if (threat && threat.t < 1.2 && car.skill > 0.6 && ai.swerve === 0) ai.swerve = (Math.random() < 0.5 ? -1 : 1) * 5
  ai.swerve *= Math.max(0, 1 - dt * 1.5)
  if (Math.abs(ai.swerve) < 0.2) ai.swerve = 0

  // Steer towards a look-ahead point on the spline.
  const lat = THREE.MathUtils.clamp(ai.laneOffset + ai.pickupLat + ai.avoid + ai.swerve, -half, half)
  const look = 9 + speed * 0.5
  const aim = track.point(car.s + look, lat)
  const want = Math.atan2(aim.x - car.pos.x, aim.z - car.pos.z)
  let err = want - car.yaw
  err = Math.atan2(Math.sin(err), Math.cos(err))
  car.input.steer = THREE.MathUtils.clamp(-err * 2.4, -1, 1)

  // Corner speed from the curvature ahead; skill scales how close to the limit it drives.
  const k = track.curvatureAhead(car.s + 4, 25 + speed * 1.3)
  const latAcc = car.latMax * (0.72 + 0.26 * car.skill)
  const vCorner = Math.sqrt(latAcc / Math.max(k, 1e-4))
  const target = Math.min(car.top * 1.05, vCorner)
  if (speed > target + 1.5) {
    car.input.throttle = 0
    car.input.brake = THREE.MathUtils.clamp((speed - target) / 8, 0.2, 1)
  } else {
    car.input.throttle = 1
    car.input.brake = 0
  }
  car.input.handbrake = false

  // Reverse Nitro as an air brake into hairpins.
  const nitroSlot = car.slotOf('nitro')
  if (nitroSlot >= 0 && speed > target + 14 && car.personality !== 'Brawler' && car.skill > 0.5) {
    car.active = nitroSlot
    fire(game, car, true)
  }

  ai.think -= dt
  ai.boltTimer -= dt
  if (game.phase !== 'race' || ai.think > 0) return
  ai.think = Math.max(0.08, 0.55 - car.skill * 0.45) * (game.armed ? 0.5 : 1) * (0.7 + Math.random() * 0.6)
  pickupLane(game, car)
  chooseWeapon(game, car, threat)
}

function hazardOf(game: Game, p: THREE.Vector3) {
  const n = game.track.nearest(p.x, p.z)
  return { s: game.track.s[n.i], lat: n.lateral }
}

/** Pick a lane offset that drives through a wanted icon in the next pickup row. */
function pickupLane(game: Game, car: Car) {
  const ai = car.ai
  const prefs = PREFS[car.personality] ?? []
  const full = car.bay.every((s) => s)
  let best: { lat: number; score: number } | null = null
  for (const p of game.pickups) {
    if (!p.available) continue
    let ds = p.s - car.s
    if (ds < -game.track.length / 2) ds += game.track.length
    if (ds < 15 || ds > 140) continue
    const canTake = !full || car.bay.some((s) => s && s.type === p.type && s.count < CONFIG.bay_stack_max)
    if (!canTake) continue
    const pref = prefs.indexOf(p.type)
    let score = (pref >= 0 ? 4 - pref : 0.5) - Math.abs(p.lateral - car.lateral) * 0.08
    if (game.mode === 'race' && p.type === 'repair' && car.health < 6) score += 4
    if (!best || score > best.score) best = { lat: p.lateral - car.ai.laneOffset, score }
  }
  ai.pickupLat = best ? best.lat : ai.pickupLat * 0.5
}

/* ---------- Arena (Dust Bowl) ---------- */

function arenaDrive(game: Game, car: Car, dt: number) {
  const a = game.track.arena!
  const ai = car.ai
  const inp = car.input
  const speed = car.forwardSpeed
  inp.handbrake = false

  // Stuck against the rim or a rock: reverse out with the wheel turned, then carry on.
  if (ai.reverse > 0) {
    ai.reverse -= dt
    inp.throttle = 0
    inp.brake = 1
    inp.steer = ai.reverseSteer
    return
  }
  if (game.phase === 'race' && car.alive && car.stun <= 0 && inp.throttle > 0.5 && Math.abs(speed) < 2.5 && car.sinceRespawn > 1) {
    ai.stuck += dt
    if (ai.stuck > CONFIG.ai_arena_stuck_time) {
      ai.stuck = 0
      ai.reverse = CONFIG.ai_arena_unstuck * (0.8 + Math.random() * 0.4)
      ai.reverseSteer = Math.random() < 0.5 ? -1 : 1
      return
    }
  } else ai.stuck = 0

  ai.think -= dt
  if (ai.think <= 0 && game.phase === 'race') {
    ai.think = Math.max(0.1, 0.45 - car.skill * 0.35) * (0.7 + Math.random() * 0.6)
    arenaGoal(game, car)
    chooseWeapon(game, car, incomingShunt(game, car))
  }

  // Where to aim: the goal, or (hunting) where the target will be.
  const goal = aimAt.copy(ai.goal)
  const t = ai.goalKind === 'hunt' ? ai.target : null
  let dist = goal.distanceTo(car.pos)
  if (t && t.alive) {
    dist = t.pos.distanceTo(car.pos)
    goal.copy(t.pos).addScaledVector(t.vel, Math.min(1.2, dist / 60))
    // Snipers circle at a distance rather than ramming.
    if (car.personality === 'Sniper' && dist < 22) goal.addScaledVector(t.right, 14)
    onFloor(a, goal, 2)
  }
  const f = car.forward, r = car.right
  detour(a, car, goal)
  let want = Math.atan2(goal.x - car.pos.x, goal.z - car.pos.z)

  // Near the bank, don't point at the rim: turn towards the centre in proportion to how hard we're heading out.
  const rad = Math.hypot(car.pos.x, car.pos.z)
  const edge = THREE.MathUtils.clamp((rad - (a.floor - 16)) / 18, 0, 1)
  if (edge > 0 && rad > 1) {
    const out = (f.x * car.pos.x + f.z * car.pos.z) / rad
    if (out > -0.2) want = blendAngle(want, Math.atan2(-car.pos.x, -car.pos.z), edge * (0.4 + Math.max(0, out) * 0.6))
  }
  let err = want - car.yaw
  err = Math.atan2(Math.sin(err), Math.cos(err))

  // Feelers: steer round rock, wrecks, Mines, Oil and Shock domes in the path.
  const look = 10 + Math.max(0, speed) * 0.7
  let avoid = 0
  let danger = 0 // rock close ahead, too close to steer round at this speed
  const feel = (x: number, z: number, radius: number, solid = false) => {
    const dx = x - car.pos.x, dz = z - car.pos.z
    const ahead = dx * f.x + dz * f.z
    if (ahead < -1 || ahead > look + radius) return
    const lat = dx * r.x + dz * r.z
    const clear = radius + 2.8
    if (Math.abs(lat) >= clear) return
    // Leave it on the side it's already on; dead ahead, pass on the side nearer the goal.
    const side = Math.abs(lat) < 0.5 ? (err >= 0 ? 1 : -1) : lat > 0 ? 1 : -1
    avoid += side * ((clear - Math.abs(lat)) / clear) * (1 - Math.max(0, ahead) / (look + radius)) * 2.2
    if (solid && ahead > 0 && ahead < Math.max(0, speed) * 0.8 + 4) danger = Math.max(danger, (clear - Math.abs(lat)) / clear)
  }
  for (const o of a.obstacles) feel(o.x, o.z, o.r, true)
  for (const p of game.projectiles) {
    if (p.lob || p.owner === car) continue
    if (p.kind === 'mine') feel(p.pos.x, p.pos.z, 1.8)
    else if (p.kind === 'oil') feel(p.pos.x, p.pos.z, CONFIG.oil_radius)
  }
  for (const d of game.domes) feel(d.pos.x, d.pos.z, CONFIG.shock_dome_radius)

  inp.steer = THREE.MathUtils.clamp(-err * 2.4 + avoid, -1, 1)
  // Throttle: brake into sharp turns, flick the handbrake to swing round, ease off when circling.
  const sharp = Math.abs(err)
  inp.throttle = 1
  inp.brake = 0
  if (sharp > 1.1 && speed > 16) {
    inp.throttle = 0.3
    inp.brake = THREE.MathUtils.clamp((speed - 16) / 20, 0.2, 0.8)
    inp.handbrake = sharp > 1.6 && car.skill > 0.45
  }
  if (danger > 0.25 && speed > 10) {
    inp.throttle = 0
    inp.brake = THREE.MathUtils.clamp(danger, 0.3, 1)
  }
  if (ai.goalKind === 'wander' && dist < 10) ai.think = 0
  if (car.personality === 'Sniper' && t && dist < 14) inp.throttle = 0.6
}

/** If the straight line to `goal` clips an obstacle, aim beside the nearest one instead, on the side that needs
 * the smaller turn. Mutates `goal`. */
function detour(a: ArenaLayout, car: Car, goal: THREE.Vector3) {
  const dx = goal.x - car.pos.x, dz = goal.z - car.pos.z
  const len = Math.hypot(dx, dz)
  if (len < 2) return
  const ux = dx / len, uz = dz / len
  let hit: Obstacle | null = null
  let hitT = Infinity, hitLat = 0
  for (const o of a.obstacles) {
    const ox = o.x - car.pos.x, oz = o.z - car.pos.z
    const t = ox * ux + oz * uz
    if (t < 0 || t > len + o.r) continue
    const lat = ox * -uz + oz * ux // signed distance of the obstacle off the line (+ = to the right of it)
    if (Math.abs(lat) < o.r + 2.6 && t < hitT) {
      hitT = t
      hit = o
      hitLat = lat
    }
  }
  if (!hit) return
  // Waypoints either side of the obstacle, perpendicular to the line.
  const reach = hit.r + 6
  const f = car.forward
  let side = hitLat >= 0 ? -1 : 1
  if (Math.abs(hitLat) < 1) {
    // Dead centre: pass on whichever side the car's nose already favours.
    side = f.x * -uz + f.z * ux >= 0 ? 1 : -1
  }
  goal.set(hit.x + -uz * reach * side, 0, hit.z + ux * reach * side)
  onFloor(a, goal, 2)
}

/** The shorter way round from angle a towards b, by fraction k. */
function blendAngle(a: number, b: number, k: number) {
  let d = b - a
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return a + d * THREE.MathUtils.clamp(k, 0, 1)
}

/** Pick the next goal: a wanted pickup if the bay has room and one is close, else a rival to hunt, else wander. */
function arenaGoal(game: Game, car: Car) {
  const a = game.track.arena!
  const ai = car.ai
  const prefs = PREFS[car.personality] ?? []
  const f = car.forward
  const empty = car.bay.every((s) => !s)
  const hasRoom = car.bay.some((s) => !s)

  // Pickups: nearest, nudged by preference and by how far we'd have to turn.
  let pick: THREE.Vector3 | null = null
  let pickScore = Infinity
  if (hasRoom) {
    const range = CONFIG.ai_arena_pickup_range * (empty ? 2.5 : 1)
    for (const p of game.pickups) {
      if (!p.available) continue
      const d = p.pos.distanceTo(car.pos)
      if (d > range) continue
      const facing = ((p.pos.x - car.pos.x) * f.x + (p.pos.z - car.pos.z) * f.z) / Math.max(1, d)
      const pref = prefs.indexOf(p.type)
      const score = d + (1 - facing) * 14 - (pref >= 0 ? 18 - pref * 3 : 0)
      if (score < pickScore) {
        pickScore = score
        pick = p.pos
      }
    }
  }

  // Rivals: close, damaged, and the points leader rank higher; spawn-protected cars lower.
  let prey: Car | null = null
  let preyScore = Infinity
  const leader = game.combatLeader()
  for (const o of game.cars) {
    if (o === car || !o.alive) continue
    const d = o.pos.distanceTo(car.pos)
    const hurt = 1 - o.health / CONFIG.max_health
    let score = d - hurt * (car.personality === 'Brawler' ? 25 : 45) - (o === leader ? 20 : 0) + (o.invuln > 0 ? 60 : 0)
    if (o === ai.target) score -= 12 // stick with the current target unless something much better turns up
    if (score < preyScore) {
      preyScore = score
      prey = o
    }
  }

  if (pick && (empty || !prey || pickScore < preyScore * 0.8)) {
    ai.goalKind = 'pickup'
    ai.goal.copy(pick)
    ai.target = null
  } else if (prey && !empty) {
    ai.goalKind = 'hunt'
    ai.target = prey
    ai.goal.copy(prey.pos)
  } else if (prey && !pick) {
    // Nothing in the bay and nothing to pick up: ram whoever's closest.
    ai.goalKind = 'hunt'
    ai.target = prey
    ai.goal.copy(prey.pos)
  } else if (ai.goalKind !== 'wander' || ai.goal.distanceTo(car.pos) < 10) {
    ai.goalKind = 'wander'
    ai.target = null
    const ang = Math.random() * Math.PI * 2, rr = 15 + Math.random() * (a.floor - 25)
    onFloor(a, ai.goal.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr))
  }
}

/* ---------- Weapons ---------- */

function carsNear(game: Game, car: Car, r: number) {
  return game.cars.filter((o) => o !== car && o.alive && o.pos.distanceTo(car.pos) < r)
}

/** Distance along the track from `a` forward to `b` (negative if b is behind). In an arena: straight-line along a's
 * nose, and 0 (neither ahead nor behind) for anything well off to the side. */
function along(game: Game, a: Car, b: Car) {
  if (!game.track.arena) return b.progress - a.progress
  tmp.subVectors(b.pos, a.pos)
  const fwd = tmp.dot(a.forward)
  return Math.abs(tmp.dot(a.right)) < Math.abs(fwd) * 0.6 + 4 ? fwd : 0
}

/** `o` within `range` in a cone (cos > cosMin) ahead (dir 1) or behind (dir -1). */
function inCone(car: Car, o: Car, dir: number, range: number, cosMin: number) {
  tmp.subVectors(o.pos, car.pos).setY(0)
  const d = tmp.length()
  return d < range && d > 1 && (tmp.dot(car.forward) * dir) / d > cosMin
}

/** Will `o` be on the Railgun's line when the charge finishes? Rock in between blocks it in an arena. */
function railLine(game: Game, car: Car, o: Car, dir: number, range: number) {
  const k = CONFIG.rail_charge
  tmp.copy(o.pos).addScaledVector(o.vel, k).sub(car.pos).addScaledVector(car.vel, -k).setY(0)
  const f = car.forward.multiplyScalar(dir)
  const t = tmp.dot(f)
  if (t < 4 || t > range) return false
  if (tmp.addScaledVector(f, -t).length() > CONFIG.rail_width * 0.8) return false
  const a = game.track.arena
  if (a) for (let d = 4; d < t; d += 3) if (arenaBlocked(a, car.pos.x + f.x * d, car.pos.z + f.z * d)) return false
  return true
}

/** No rock within `dist` metres straight ahead (arena Nitro check). */
function clearAhead(game: Game, car: Car, dist: number) {
  const a = game.track.arena!
  const f = car.forward
  for (let d = 4; d < dist; d += 4) if (arenaBlocked(a, car.pos.x + f.x * d, car.pos.z + f.z * d, 2)) return false
  return true
}

function chooseWeapon(game: Game, car: Car, threat: ReturnType<typeof incomingShunt>) {
  const combat = game.armed
  const pers = car.personality
  const slot = (t: PowerType) => car.slotOf(t)
  const trigger = (t: PowerType, backward = false, target?: Car | null) => {
    const i = slot(t)
    if (i < 0) return false
    car.active = i
    return fire(game, car, backward, target)
  }

  // Defence first: Shield or Barge against an imminent Shunt (skill > 0.8), Bolts at a Shunt from behind,
  // or brace with Ram armour to halve the hit.
  if (threat && threat.t < 0.9) {
    if (car.skill > 0.8 && (trigger('shield') || trigger('barge'))) return
    if (car.skill > 0.6 && car.ram <= 0 && trigger('ram', true)) return
    if (car.skill > 0.6 && slot('bolt') >= 0) {
      const behind = threat.p.pos.clone().sub(car.pos).dot(car.forward) < 0
      car.active = slot('bolt')
      fire(game, car, behind)
      return
    }
    if (car.skill > 0.6 && slot('mine') >= 0 && threat.p.pos.clone().sub(car.pos).dot(car.forward) < 0 && trigger('mine', true)) return
  }
  // Heal and protect.
  if (!combat && car.health < CONFIG.max_health * 0.3 && trigger('repair')) return
  if (car.health < CONFIG.max_health * 0.4 && car.shield <= 0 && trigger('shield')) return

  // Targets.
  const ahead = game.cars
    .filter((o) => o !== car && o.alive && along(game, car, o) > 3)
    .sort((a, b) => along(game, car, a) - along(game, car, b))
  const behind = game.cars.filter((o) => o !== car && o.alive && along(game, car, o) < -3 && along(game, car, o) > -CONFIG.ai_mine_range)
  let shuntTarget = ahead.find((o) => along(game, car, o) < CONFIG.ai_shunt_range) ?? null
  if (combat) {
    // Prioritise the points leader when it's in range; otherwise anything in view.
    const leader = game.combatLeader()
    if (leader && leader !== car && along(game, car, leader) > 0 && along(game, car, leader) < CONFIG.lock_range) shuntTarget = leader
    shuntTarget ??= lockTarget(game, car)
  }

  if (shuntTarget && (pers === 'Sniper' || combat || Math.random() < 0.7) && trigger('shunt', false, shuntTarget)) return
  if (behind.length && trigger('mine', true)) return
  if (pers === 'Trickster' && ahead.length && along(game, car, ahead[0]) < 40 && trigger('mine')) return
  const nearCount = carsNear(game, car, CONFIG.barge_radius).length
  if ((nearCount >= 2 || ((pers === 'Brawler' || combat) && nearCount >= 1)) && trigger('barge')) return
  if (slot('bolt') >= 0) {
    const f = car.forward
    const inLine = (o: Car, dir: number) => {
      const d = o.pos.clone().sub(car.pos)
      const dist = d.length()
      return dist < 70 && (d.dot(f) * dir) / dist > 0.985
    }
    const fwd = game.cars.find((o) => o !== car && o.alive && inLine(o, 1))
    const back = game.cars.find((o) => o !== car && o.alive && inLine(o, -1) && o.pos.distanceTo(car.pos) < 25)
    if (fwd || back) {
      car.active = slot('bolt')
      // Skill scales accuracy.
      const err = (Math.random() - 0.5) * (1 - car.skill) * 0.12
      const c = car.consume()
      if (c) {
        fireBolt(game, car, !fwd, err)
        game.sfx('fire:bolt', car.pos)
        game.onFired(car, 'bolt')
      }
      return
    }
  }
  const rivals = game.cars.filter((o) => o !== car && o.alive)
  // Railgun: anything that will be on the line when the charge completes, nose or tail.
  if (slot('rail') >= 0 && car.railCharge <= 0) {
    const reach = CONFIG.rail_range * (0.4 + car.skill * 0.6)
    if (rivals.some((o) => railLine(game, car, o, 1, reach)) && trigger('rail')) return
    if (rivals.some((o) => railLine(game, car, o, -1, CONFIG.rail_back_range)) && trigger('rail', true)) return
  }
  // Flak: a rival close in front; the airburst for a tailgater.
  if (slot('flak') >= 0) {
    if (rivals.some((o) => inCone(car, o, 1, 30, 0.93)) && trigger('flak')) return
    if (rivals.some((o) => inCone(car, o, -1, 16, 0.75)) && trigger('flak', true)) return
  }
  // Oil Slick: drop it on a chaser; Tricksters (and anyone in a fight) fling it ahead into traffic.
  if (slot('oil') >= 0) {
    if (rivals.some((o) => inCone(car, o, -1, 32, 0.8)) && trigger('oil', true)) return
    if ((pers === 'Trickster' || combat) && rivals.some((o) => inCone(car, o, 1, 50, 0.9) && o.pos.distanceTo(car.pos) > 18) && trigger('oil')) return
  }
  // Ram: armour up and charge a rival ahead; brace when hurt with cars close by.
  if (slot('ram') >= 0 && car.ram <= 0) {
    const reach = pers === 'Brawler' ? 45 : 28
    if (car.forwardSpeed > 8 && rivals.some((o) => inCone(car, o, 1, reach, 0.9)) && trigger('ram')) return
    if (car.health < CONFIG.max_health * 0.4 && carsNear(game, car, 12).length && trigger('ram', true)) return
  }
  if (car.place !== 1 && trigger('shock')) return
  const straight = game.track.arena ? clearAhead(game, car, 45) && car.ai.goal.distanceTo(car.pos) > 40 : game.track.curvatureAhead(car.s, 160) < 0.006
  if ((straight && car.forwardSpeed > car.top * 0.55) || car.sinceRespawn < 2) {
    if (pers !== 'Racer' || straight) if (trigger('nitro')) return
  }
  // Brawlers ram: steer into a car alongside.
  if (pers === 'Brawler' && !game.track.arena) {
    const side = game.cars.find((o) => o !== car && o.alive && o.pos.distanceTo(car.pos) < 6)
    if (side) car.ai.laneOffset = THREE.MathUtils.clamp(side.lateral, -game.track.half + 2, game.track.half - 2)
  }
}
