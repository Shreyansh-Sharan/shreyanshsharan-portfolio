// AI golfers: same controller and items as the player, driven by a skill value 0–1.
// Shots: sample candidate (direction, power, loft) triples, simulate each with the real ball physics,
// score by distance to the cup plus hazard penalties, then add skill-scaled error.
import * as THREE from 'three'
import { CONFIG, deg } from './config'
import { launch, simulateShot } from './ball'
import type { Golfer, ItemType, MoveInput } from './golfer'
import type { Game } from './game'

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Does the straight line from a to b cross the lake (or other water)? */
function crossesWater(game: Game, ax: number, az: number, bx: number, bz: number) {
  const d = Math.hypot(bx - ax, bz - az)
  for (let t = 0; t <= d; t += 4) {
    const x = ax + ((bx - ax) * t) / d, z = az + ((bz - az) * t) / d
    if (game.ground.y(x, z) < 0.3) return true
  }
  return false
}

/** Where to walk next on the way to `to` without wading through water: follow the safe route when blocked. */
function waypoint(game: Game, from: THREE.Vector3, to: THREE.Vector3) {
  if (!crossesWater(game, from.x, from.z, to.x, to.z)) return to
  const c = game.course
  const sFrom = c.routeNearest(from.x, from.z).s
  const sTo = c.routeNearest(to.x, to.z).s
  const step = sTo > sFrom ? 22 : -22
  return c.routePoint(THREE.MathUtils.clamp(sFrom + step, 0, c.length))
}

export function chooseShot(game: Game, g: Golfer) {
  const c = game.course
  const start = g.ball.pos.clone()
  const cup = c.cup
  const onGreen = game.ground.surface(start.x, start.z) === 'green'
  const err = 1 - g.skill
  // Armed items change the shot: the Rocket Driver doubles the power, the Bouncy Ball bounces.
  const scale = g.driverArmed && !onGreen ? CONFIG.rocket_driver_power / 100 : 1
  const bouncy = g.bouncyArmed
  if (onGreen) {
    // Putt: aim at the cup and search for the power that stops closest to it.
    const dir = Math.atan2(cup.x - start.x, cup.z - start.z)
    let best = { power: 0.3, d: Infinity }
    for (let p = 0.06; p <= 1; p += 0.04) {
      const r = simulateShot(start, launch(dir, p, 0, true), 6, game.ground, c, bouncy)
      const d = r.mode === 'holed' ? 0 : r.pos.distanceTo(cup)
      if (d < best.d) best = { power: p, d }
    }
    return { dir: dir + deg(rand(-1, 1) * 10 * err * 0.3), power: THREE.MathUtils.clamp(best.power * (1 + rand(-1, 1) * 0.2 * err * 0.5), 0.04, 1), loft: 0 }
  }
  // Aim points: the cup, and points ahead on the safe route.
  const sNow = c.routeNearest(start.x, start.z).s
  const aims: THREE.Vector3[] = [cup.clone()]
  for (const d of [70, 120, 170, 220]) if (sNow + d < c.length) aims.push(c.routePoint(sNow + d))
  const shortcutOk = g.skill > 0.7
  let best: { dir: number; power: number; loft: number; score: number } | null = null
  for (let k = 0; k < CONFIG.ai_shot_samples; k++) {
    const aim = aims[k % aims.length]
    const isShortcut = crossesWater(game, start.x, start.z, aim.x, aim.z)
    if (isShortcut && !shortcutOk) continue
    const dir = Math.atan2(aim.x - start.x, aim.z - start.z) + deg(rand(-4, 4))
    // Close in, chip; further out, swing hard.
    const toCup = start.distanceTo(cup)
    const power = toCup < 60 ? rand(0.12, 0.6) : rand(0.4, 1)
    const loft = deg(rand(18, 50))
    const r = simulateShot(start, launch(dir, power, loft, false, scale), CONFIG.ai_sim_seconds, game.ground, c, bouncy)
    // Remaining route length, but never less than the straight line to the cup (so overshooting the green costs).
    let score = Math.max(c.length - c.progress(r.pos.x, r.pos.z), r.pos.distanceTo(cup))
    if (r.mode === 'air') score += 100 // still flying when the sim ran out: unknown landing
    if (r.water) score += 300
    const s = game.ground.surface(r.pos.x, r.pos.z)
    if (s === 'sand') score += 18
    if (s === 'rough') score += 6
    if (r.mode === 'holed') score = -100
    if (!best || score < best.score) best = { dir, power, loft, score }
  }
  if (!best) {
    // Every sampled shot was a shortcut this golfer won't take: lay up along the route.
    const aim = c.routePoint(sNow + 90)
    best = { dir: Math.atan2(aim.x - start.x, aim.z - start.z), power: 0.6, loft: deg(30), score: 0 }
  }
  return {
    dir: best.dir + deg(rand(-1, 1) * 10 * err),
    power: THREE.MathUtils.clamp(best.power * (1 + rand(-1, 1) * 0.2 * err), 0.2, 1),
    loft: best.loft,
  }
}

/** Driving a cart: towards the ball (round the lake), or, for a Griefer, into a rival. */
function aiDrive(game: Game, g: Golfer, dt: number): MoveInput | null {
  const cart = g.cart!
  const ai = g.ai
  if (cart.driver !== g) {
    // A bot never rides shotgun for long.
    game.toggleCart(g)
    return null
  }
  const toBall = g.ball.pos.distanceTo(cart.pos)
  ai.driveT += dt
  // Griefers go hunting: the nearest rival on foot, for a few seconds at a time.
  const grace = game.phase === 'play' && game.phaseTime < CONFIG.ai_melee_grace
  if (g.personality === 'Griefer' && !grace) {
    ai.chaseT -= dt
    if (!ai.chase && ai.chaseT <= -4) {
      const prey = game.golfers.find((o) => o !== g && o.canAct && !o.cart && o.pos.distanceTo(cart.pos) < 45 && o.protect <= 0)
      if (prey) {
        ai.chase = prey
        ai.chaseT = CONFIG.ai_chase_time
      }
    }
    if (ai.chase && (ai.chaseT <= 0 || !ai.chase.canAct || ai.chase.cart || ai.chase.protect > 0)) {
      ai.chase = null
      ai.chaseT = 0
    }
  }
  const chasing = ai.chase
  // Close enough to the ball: hop out and play.
  if (!chasing && (toBall < CONFIG.ai_cart_exit || g.ball.mode === 'holed' || ai.driveT > 45)) {
    game.toggleCart(g)
    ai.driveT = 0
    return null
  }
  const target = chasing ? chasing.pos : g.ball.pos
  const wp = waypoint(game, cart.pos, target)
  const want = Math.atan2(wp.x - cart.pos.x, wp.z - cart.pos.z)
  let diff = want - cart.yaw
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  // Steering right (+x) turns the nose clockwise (yaw down).
  let steer = THREE.MathUtils.clamp(-diff * 2.2, -1, 1)
  const dist = wp.distanceTo(cart.pos)
  let throttle = Math.abs(diff) > 1.7 ? 0.35 : chasing ? 1 : dist < 14 ? 0.55 : 1
  // Water dead ahead: brake and turn.
  const ax = cart.pos.x + Math.sin(cart.yaw) * 9, az = cart.pos.z + Math.cos(cart.yaw) * 9
  if (game.ground.y(ax, az) < 0.4 && cart.speed > 3) {
    throttle = -0.6
    steer = steer || 1
  }
  // Stuck on a tree or a wall: back up, turning the other way.
  if (ai.reverse > 0) {
    ai.reverse -= dt
    return { x: -steer, y: -1, yaw: cart.yaw, jump: false, dive: false, creep: false }
  }
  if (throttle > 0 && cart.speed < 1.2) ai.stuck += dt
  else ai.stuck = Math.max(0, ai.stuck - dt * 2)
  if (ai.stuck > 1.2) {
    ai.stuck = 0
    ai.reverse = 0.9 + Math.random() * 0.6
    ai.avoid++
    if (ai.avoid > 5) {
      // Hopeless: walk instead.
      ai.avoid = 0
      game.toggleCart(g)
      ai.cartT = 12
      return null
    }
  }
  if (chasing && chasing.pos.distanceTo(cart.pos) < 12 && Math.random() < dt * 1.5) game.honk(g)
  return { x: steer, y: throttle, yaw: cart.yaw, jump: false, dive: false, creep: false, brake: Math.abs(diff) > 1.2 && cart.speed > 9 }
}

/** One AI tick: returns movement for the controller, and triggers swings and items through the game. */
export function aiThink(game: Game, g: Golfer, dt: number): MoveInput | null {
  if (!g.canAct || game.phase === 'intro' || game.phase === 'results') return null
  const ai = g.ai
  ai.itemT -= dt
  ai.meleeT -= dt
  ai.cartT -= dt
  const rivals = game.golfers.filter((o) => o !== g && o.canAct)
  const near = (r: number) => rivals.filter((o) => o.pos.distanceTo(g.pos) < r)

  // Defence: Shield (or a dive) when a rocket is locked on.
  const threat = game.rocketOn(g)
  if (threat && threat.eta < 1.4) {
    if (g.skill > 0.6 && g.inventory.includes('shield')) {
      game.selectAndUse(g, 'shield')
      return null
    }
    if (threat.eta < 0.5 && Math.random() < g.skill) return { x: 0, y: 1, yaw: g.yaw + Math.PI / 2, jump: false, dive: true, creep: false }
  }

  // Items, by the doc's rules.
  if (ai.itemT <= 0 && g.charging <= 0) {
    ai.itemT = 0.5 + Math.random() * 0.8
    const leader = game.leaderExcept(g)
    if (g.inventory.includes('rocket') && leader && leader.pos.distanceTo(g.pos) < CONFIG.ai_rocket_range && (g.personality !== 'Golfer' || Math.random() < 0.5)) {
      game.selectAndUse(g, 'rocket')
    } else if (g.inventory.includes('pistol')) {
      const target = rivals.find((o) => o.charging > 0 && o.pos.distanceTo(g.pos) < CONFIG.ai_pistol_range)
      if (target) game.selectAndUse(g, 'pistol', target)
    }
    const putting = g.ball.mode === 'rest' && game.ground.surface(g.ball.pos.x, g.ball.pos.z) === 'green'
    if (g.inventory.includes('shield') && putting && near(8).length > 0 && g.pos.distanceTo(g.ball.pos) < 4) game.selectAndUse(g, 'shield')
    const has = (it: ItemType) => g.inventory.includes(it)
    const toBallNow = g.ball.pos.distanceTo(g.pos)
    // Close-range blasts on whoever is next to us.
    const close = rivals.find((o) => o.pos.distanceTo(g.pos) < CONFIG.elephant_range * 0.8)
    if (has('elephant') && close) game.selectAndUse(g, 'elephant', close)
    else if (has('airhorn') && near(CONFIG.airhorn_range * 0.6).length > 0) game.selectAndUse(g, 'airhorn')
    else if (has('freeze')) {
      // Lob it onto someone lining up a shot, or anyone at about throwing distance.
      const t = rivals.find((o) => Math.abs(o.pos.distanceTo(g.pos) - CONFIG.freeze_throw) < CONFIG.freeze_radius && (o.charging > 0 || Math.random() < 0.3))
      if (t) game.selectAndUse(g, 'freeze', t)
    } else if (has('landmine') && (near(14).length > 0 || Math.random() < 0.05)) game.selectAndUse(g, 'landmine')
    // The new chaos: lasers and meteors on the leader, twisters and peels near rivals, swaps from behind.
    const ballAtRest = g.ball.mode === 'rest' && game.ground.surface(g.ball.pos.x, g.ball.pos.z) !== 'green'
    const toCup = g.ball.pos.distanceTo(game.course.cup)
    if (has('laser') && leader && (leader.pos.distanceTo(g.pos) > 12 || Math.random() < 0.3)) game.selectAndUse(g, 'laser', leader)
    else if (has('meteor') && leader && leader.pos.distanceTo(g.pos) > CONFIG.meteor_radius + 4) game.selectAndUse(g, 'meteor', leader)
    else if (has('tornado')) {
      const t = rivals.find((o) => o.pos.distanceTo(g.pos) < 22)
      if (t) game.selectAndUse(g, 'tornado', t)
    } else if (has('swap') && game.swapTarget(g)) {
      const o = game.swapTarget(g)!
      if (game.course.progress(o.ball.pos.x, o.ball.pos.z) - game.course.progress(g.ball.pos.x, g.ball.pos.z) > 40) game.selectAndUse(g, 'swap')
    } else if (has('banana') && (near(16).length > 0 || Math.random() < 0.06)) game.selectAndUse(g, 'banana')
    if (has('driver') && !g.driverArmed && ballAtRest && toCup > 160) game.selectAndUse(g, 'driver')
    if (has('bouncy') && !g.bouncyArmed && ballAtRest && toCup > 70 && Math.random() < 0.4) game.selectAndUse(g, 'bouncy')
    if (has('cart') && !g.cart && toBallNow > CONFIG.ai_cart_distance) game.selectAndUse(g, 'cart')
    // Getting around: coffee for a long walk, boots for a long safe leap towards the ball.
    if (has('coffee') && toBallNow > 35 && g.boost <= 0 && !g.cart) game.selectAndUse(g, 'coffee')
    if (has('springboots') && toBallNow > CONFIG.springboots_distance + 10 && g.canAct && !g.cart) {
      const yaw = Math.atan2(g.ball.pos.x - g.pos.x, g.ball.pos.z - g.pos.z)
      const lx = g.pos.x + Math.sin(yaw) * CONFIG.springboots_distance, lz = g.pos.z + Math.cos(yaw) * CONFIG.springboots_distance
      if (game.ground.y(lx, lz) > 0.4 && game.ground.inBounds(lx, lz)) {
        g.yaw = yaw
        game.selectAndUse(g, 'springboots')
      }
    }
  }

  if (g.cart) return aiDrive(game, g, dt)
  const toBall = g.ball.pos.distanceTo(g.pos)
  const aboutToPutt = toBall < CONFIG.swing_reach + 1 && game.ground.surface(g.ball.pos.x, g.ball.pos.z) === 'green'
  // Melee anyone in reach (unless lining up a putt).
  const victim = near(CONFIG.melee_range).find(() => true)
  const teeGrace = game.phase === 'play' && game.phaseTime < CONFIG.ai_melee_grace
  if (victim && !teeGrace && !aboutToPutt && ai.meleeT <= 0 && g.charging <= 0 && g.swing <= 0) {
    ai.meleeT = 1.2 + Math.random()
    g.yaw = Math.atan2(victim.pos.x - g.pos.x, victim.pos.z - g.pos.z)
    game.melee(g)
    return null
  }

  // At the ball: plan, charge and release.
  if (g.ball.mode === 'rest' && toBall < CONFIG.swing_reach) {
    if (!ai.plan) {
      ai.think -= dt
      if (ai.think > 0) return null
      ai.plan = chooseShot(game, g)
      ai.aimT = 0.4 + (1 - g.skill) * 0.8
    }
    if (ai.aimT > 0) {
      ai.aimT -= dt
      game.faceShot(g, ai.plan.dir)
      return null
    }
    if (g.charging <= 0) game.startCharge(g, ai.plan.dir)
    else if (g.charging >= ai.plan.power * CONFIG.swing_charge_time) {
      game.release(g, ai.plan.dir, ai.plan.loft)
      ai.plan = null
      ai.think = 0.3
    }
    return null
  }
  if (g.charging > 0) return null
  ai.plan = null

  // A long way from the ball: borrow a parked cart (Griefers always fancy one).
  if (ai.cartId < 0 && ai.cartT <= 0 && toBall > CONFIG.ai_cart_distance) {
    ai.cartT = 4
    if (g.personality === 'Griefer' || Math.random() < 0.55) {
      const c = game.cartNear(g.pos, CONFIG.ai_cart_search, true)
      // Only if the cart is roughly on the way.
      if (c && c.pos.distanceTo(g.ball.pos) < toBall + 10) ai.cartId = c.id
    }
  }
  if (ai.cartId >= 0) {
    const c = game.cartById(ai.cartId)
    if (!c || c.driver || c.sunk > 0 || toBall < 30) ai.cartId = -1
    else {
      const d = c.pos.distanceTo(g.pos)
      if (d < CONFIG.cart_enter_range - 0.4) {
        ai.cartId = -1
        game.toggleCart(g)
        ai.driveT = 0
        return null
      }
      const yaw = Math.atan2(c.pos.x - g.pos.x, c.pos.z - g.pos.z)
      return { x: 0, y: 1, yaw: yaw + avoidTrees(game, g, yaw), jump: false, dive: false, creep: false }
    }
  }

  // Walk to the ball, detouring for a briefcase near the path.
  let target = g.ball.pos.clone()
  if (g.inventory.some((s) => !s)) {
    for (const b of game.cases) {
      if (!b.ready) continue
      const dPath = distToSegment(b.pos, g.pos, target)
      if (dPath < CONFIG.ai_briefcase_detour && b.pos.distanceTo(g.pos) < target.distanceTo(g.pos) + 10) {
        target = b.pos.clone()
        break
      }
    }
  }
  const wp = waypoint(game, g.pos, target)
  const yaw = Math.atan2(wp.x - g.pos.x, wp.z - g.pos.z)
  // Dive for a briefcase a rival is also going for.
  const contested = game.cases.some((b) => b.ready && b.pos.distanceTo(g.pos) < 6 && rivals.some((o) => o.pos.distanceTo(b.pos) < 5))
  const dist = wp.distanceTo(g.pos)
  if (dist < 0.6) return null
  return { x: 0, y: dist < 1.5 ? 0.5 : 1, yaw: dist > 3 ? yaw + avoidTrees(game, g, yaw) : yaw, jump: false, dive: contested && Math.random() < 0.05, creep: false }
}

/** Sidestep a trunk (or a cactus) straight ahead: the angle to add to the heading. */
function avoidTrees(game: Game, g: Golfer, yaw: number) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  for (const t of game.course.trees) {
    const dx = t.x - g.pos.x, dz = t.z - g.pos.z
    const along = dx * fx + dz * fz
    if (along < 0 || along > 4) continue
    const side = dx * -fz + dz * fx // > 0: the trunk is to the right
    const r = t.r * t.scale + CONFIG.player_radius + 0.3
    if (Math.abs(side) < r) return side > 0 ? 0.9 : -0.9
  }
  return 0
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x, abz = b.z - a.z
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1)
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t))
}
