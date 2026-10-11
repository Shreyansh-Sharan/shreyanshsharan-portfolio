// AI rivals: follow the track spline with per-driver offsets, brake for corners, chase preferred pickups,
// avoid hazards, and use power-ups by the rules in the design doc. Personality changes pickup and weapon choices.
import * as THREE from 'three'
import { CONFIG } from './config'
import { fire, fireBolt, incomingShunt, lockTarget } from './weapons'
import type { PowerType } from './track'
import type { Car } from './car'
import type { Game } from './game'

const PREFS: Record<string, PowerType[]> = {
  Brawler: ['barge', 'mine', 'shunt', 'repair'],
  Sniper: ['bolt', 'shunt', 'shield', 'repair'],
  Racer: ['nitro', 'shield', 'repair', 'bolt'],
  Trickster: ['mine', 'shock', 'shunt', 'nitro'],
}

export function aiDrive(game: Game, car: Car, dt: number) {
  const track = game.track
  const ai = car.ai
  const speed = Math.max(0, car.forwardSpeed)
  const half = track.half - 2

  // Hazard avoidance: Mines and Shock domes within range ahead.
  let avoid = 0
  const hazards: { s: number; lat: number }[] = []
  for (const p of game.projectiles) if (p.kind === 'mine' && !p.lob) hazards.push(hazardOf(game, p.pos))
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

function carsNear(game: Game, car: Car, r: number) {
  return game.cars.filter((o) => o !== car && o.alive && o.pos.distanceTo(car.pos) < r)
}

/** Distance along the track from `a` forward to `b` (negative if b is behind). */
function along(a: Car, b: Car) {
  return b.progress - a.progress
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

  // Defence first: Shield or Barge against an imminent Shunt (skill > 0.8), Bolts at a Shunt from behind.
  if (threat && threat.t < 0.9) {
    if (car.skill > 0.8 && (trigger('shield') || trigger('barge'))) return
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
    .filter((o) => o !== car && o.alive && along(car, o) > 3)
    .sort((a, b) => along(car, a) - along(car, b))
  const behind = game.cars.filter((o) => o !== car && o.alive && along(car, o) < -3 && along(car, o) > -CONFIG.ai_mine_range)
  let shuntTarget = ahead.find((o) => along(car, o) < CONFIG.ai_shunt_range) ?? null
  if (combat) {
    // Prioritise the points leader when it's in range; otherwise anything in view.
    const leader = game.combatLeader()
    if (leader && leader !== car && along(car, leader) > 0 && along(car, leader) < CONFIG.lock_range) shuntTarget = leader
    shuntTarget ??= lockTarget(game, car)
  }

  if (shuntTarget && (pers === 'Sniper' || combat || Math.random() < 0.7) && trigger('shunt', false, shuntTarget)) return
  if (behind.length && trigger('mine', true)) return
  if (pers === 'Trickster' && ahead.length && along(car, ahead[0]) < 40 && trigger('mine')) return
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
        game.onFired(car)
      }
      return
    }
  }
  if (car.place !== 1 && trigger('shock')) return
  const straight = game.track.curvatureAhead(car.s, 160) < 0.006
  if ((straight && car.forwardSpeed > car.top * 0.55) || car.sinceRespawn < 2) {
    if (pers !== 'Racer' || straight) if (trigger('nitro')) return
  }
  // Brawlers ram: steer into a car alongside.
  if (pers === 'Brawler') {
    const side = game.cars.find((o) => o !== car && o.alive && o.pos.distanceTo(car.pos) < 6)
    if (side) car.ai.laneOffset = THREE.MathUtils.clamp(side.lateral, -game.track.half + 2, game.track.half - 2)
  }
}
