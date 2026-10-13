// The car and the airship: shared state (framework-free) read by the player, the camera and the HUD.
import * as THREE from 'three'
import { AIRSHIP_STOPS, REGIONS, regionById } from './regions'
import { heightAt, roadAt, ROAD_HALF } from './terrain'
import { resolve } from './colliders'
import { controls, moveAxes } from './controls'
import { world } from './store'

/* ---------- The car ---------- */

const HUB = REGIONS[0]
export const CAR_HOME = { x: HUB.center[0] + 22, z: HUB.center[1] + 24, yaw: 2.4 }

export const car = {
  pos: new THREE.Vector3(CAR_HOME.x, heightAt(CAR_HOME.x, CAR_HOME.z), CAR_HOME.z),
  yaw: CAR_HOME.yaw,
  /** Forward speed, m/s (negative in reverse). */
  speed: 0,
  /** Steering wheel angle, radians (+ = left). */
  wheel: 0,
  pitch: 0,
  roll: 0,
  driving: false,
  /** Slip from a handbrake turn, decays. */
  drift: 0,
  /** Bumps for the dust puffs: bumped this frame. */
  bumped: false,
  /** Asked to get out from code that has no player handle: the player steps out on the next frame. */
  eject: false,
}

const WHEELBASE = 2.6
const STEER_MAX = 0.55
const STEER_RATE = 3.2
const ACCEL = 11
const BRAKE = 24
const TOP_ROAD = 30
const TOP_OFFROAD = 15
const REVERSE_TOP = 8
const ROLL = 1.6
const probe = { x: 0, z: 0 }

/** One step of the car's arcade handling (only while driving; a parked car just sits). */
export function stepCar(dt: number) {
  const c = car
  if (!c.driving) return
  const modal = world.get().open !== null || world.get().panel !== 'none'
  const axes = modal ? { x: 0, y: 0, run: false } : moveAxes()
  const hand = !modal && (controls.keys.has('Space') || controls.run)
  const road = roadAt(c.pos.x, c.pos.z)
  const onRoad = road.d < ROAD_HALF + 1.5
  const top = onRoad ? TOP_ROAD : TOP_OFFROAD
  // The wheel follows the stick, with less lock at speed.
  const lock = STEER_MAX * (1 - 0.6 * Math.min(1, Math.abs(c.speed) / TOP_ROAD))
  const want = -axes.x * lock
  c.wheel += THREE.MathUtils.clamp(want - c.wheel, -STEER_RATE * dt, STEER_RATE * dt)
  // Throttle, brake and reverse.
  if (axes.y > 0.05) c.speed += (c.speed < 0 ? BRAKE : ACCEL * (1 - Math.max(0, c.speed) / top)) * axes.y * dt
  else if (axes.y < -0.05) c.speed -= (c.speed > 0 ? BRAKE : ACCEL * 0.5) * -axes.y * dt
  if (hand) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 18 * dt)
  c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), ROLL * dt + (onRoad ? 0 : 2.5 * dt))
  c.speed = THREE.MathUtils.clamp(c.speed, -REVERSE_TOP, top + 2)
  // Bicycle model: the yaw rate comes straight off the wheel; a handbrake turn hangs the tail out.
  const grip = hand && Math.abs(c.speed) > 6 ? 1.8 : 1
  c.drift = THREE.MathUtils.lerp(c.drift, hand && Math.abs(c.speed) > 6 ? 1 : 0, Math.min(1, dt * 4))
  c.yaw += (c.speed / WHEELBASE) * Math.tan(c.wheel) * grip * dt
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw)
  const nx = c.pos.x + fx * c.speed * dt, nz = c.pos.z + fz * c.speed * dt
  c.bumped = false
  if (heightAt(nx, nz) > 0.6 && Math.hypot(nx, nz) < 560) {
    c.pos.x = nx
    c.pos.z = nz
  } else {
    c.speed *= -0.3
    c.bumped = true
  }
  probe.x = c.pos.x
  probe.z = c.pos.z
  if (resolve(probe, 1.4, c.pos.y + 0.3)) {
    c.pos.x = probe.x
    c.pos.z = probe.z
    c.speed *= -0.25
    c.bumped = Math.abs(c.speed) > 2
  }
  c.pos.y = heightAt(c.pos.x, c.pos.z)
  // Sit on the slope: pitch from the drop along the heading, roll from across it.
  const ahead = heightAt(c.pos.x + fx * 1.5, c.pos.z + fz * 1.5) - heightAt(c.pos.x - fx * 1.5, c.pos.z - fz * 1.5)
  const across = heightAt(c.pos.x + fz * 1, c.pos.z - fx * 1) - heightAt(c.pos.x - fz * 1, c.pos.z + fx * 1)
  c.pitch = THREE.MathUtils.lerp(c.pitch, Math.atan2(-ahead, 3), Math.min(1, dt * 8))
  c.roll = THREE.MathUtils.lerp(c.roll, Math.atan2(across, 2) + c.wheel * Math.min(1, Math.abs(c.speed) / 20) * 0.08, Math.min(1, dt * 8))
}

export function enterCar() {
  car.driving = true
  car.speed = 0
  world.notify('Driving: W / S throttle and brake · A / D steer · Space handbrake · E to get out')
}

export function exitCar(player?: { pos: THREE.Vector3; yaw: number }) {
  car.driving = false
  car.speed = 0
  if (!player) {
    car.eject = true
    return
  }
  // Step out on the left.
  const lx = Math.cos(car.yaw), lz = -Math.sin(car.yaw)
  player.pos.set(car.pos.x + lx * 2.2, heightAt(car.pos.x + lx * 2.2, car.pos.z + lz * 2.2), car.pos.z + lz * 2.2)
  player.yaw = car.yaw
}

/* ---------- The airship ---------- */

export const MOOR_HEIGHT = 11
const CRUISE = 70
const SHIP_SPEED = 42

export const ship = {
  pos: new THREE.Vector3(),
  yaw: 0,
  /** Index into AIRSHIP_STOPS of the mooring it hangs over (or left). */
  stop: 0,
  to: 0,
  aboard: false,
  flying: false,
  /** 0..1 along the current hop. */
  t: 0,
  length: 1,
  from: new THREE.Vector3(),
  dest: new THREE.Vector3(),
  bob: 0,
}

export function stopAt(i: number) {
  const s = AIRSHIP_STOPS[i]
  return { x: s.at[0], z: s.at[1], y: Math.max(heightAt(s.at[0], s.at[1]), 0) + MOOR_HEIGHT, region: regionById(s.region) }
}

{
  const s0 = stopAt(0)
  ship.pos.set(s0.x, s0.y, s0.z)
  ship.yaw = Math.PI * 0.5
}

/** Deck height above the ship's anchor point (where the player stands). */
export const DECK = 4.6

export function board() {
  ship.aboard = true
  world.set({ panel: 'airship' })
}

export function disembark(player: { pos: THREE.Vector3; yaw: number }) {
  ship.aboard = false
  const s = stopAt(ship.stop)
  const x = s.x + 4, z = s.z + 2
  player.pos.set(x, heightAt(x, z), z)
}

/** Cast off for another district. */
export function sail(to: number) {
  if (to === ship.stop || ship.flying) return
  const a = stopAt(ship.stop), b = stopAt(to)
  ship.from.set(a.x, a.y, a.z)
  ship.dest.set(b.x, b.y, b.z)
  ship.to = to
  ship.t = 0
  ship.length = Math.hypot(b.x - a.x, b.z - a.z)
  ship.flying = true
  world.set({ panel: 'none' })
  world.notify(`Casting off for ${b.region.name}`)
}

const ease = (t: number) => t * t * (3 - 2 * t)

export function stepShip(dt: number) {
  const s = ship
  s.bob += dt
  if (!s.flying) {
    const m = stopAt(s.stop)
    s.pos.set(m.x, m.y + Math.sin(s.bob * 0.7) * 0.4, m.z)
    return
  }
  s.t = Math.min(1, s.t + (SHIP_SPEED * dt) / Math.max(1, s.length))
  const k = ease(s.t)
  s.pos.x = THREE.MathUtils.lerp(s.from.x, s.dest.x, k)
  s.pos.z = THREE.MathUtils.lerp(s.from.z, s.dest.z, k)
  // Climb to cruising height, then settle onto the far mooring.
  const lift = Math.sin(Math.min(1, s.t) * Math.PI)
  s.pos.y = THREE.MathUtils.lerp(s.from.y, s.dest.y, k) + lift * Math.max(0, CRUISE - Math.max(s.from.y, s.dest.y))
  const want = Math.atan2(s.dest.x - s.from.x, s.dest.z - s.from.z)
  let d = want - s.yaw
  d = Math.atan2(Math.sin(d), Math.cos(d))
  s.yaw += d * Math.min(1, dt * 1.2)
  if (s.t >= 1) {
    s.flying = false
    s.stop = s.to
    world.notify(`Moored over ${stopAt(s.stop).region.name} · E to climb down`)
  }
}

/** True while the player is bound to a vehicle (the car or the airship). */
export const inTransit = () => car.driving || ship.aboard
