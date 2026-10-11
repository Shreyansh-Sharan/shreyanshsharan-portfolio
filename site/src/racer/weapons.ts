// The twelve power-ups: firing (forward / backward), projectiles, hazards and their counters.
// Only the host (or a solo game) simulates these; clients rebuild the visuals from snapshots.
// On an arena track (the Dust Bowl) shots fly in the open and stop at the rim and the obstacles.
import * as THREE from 'three'
import { CONFIG, kmh } from './config'
import { POWER_COLORS, newLoc, type PowerType } from './track'
import { Trail } from './fx'
import { radialTexture } from './cars'
import { arenaBlocked, onFloor } from './arena'
import type { Car } from './car'
import type { Game } from './game'

export type ProjectileKind = 'shunt' | 'rshunt' | 'bolt' | 'mine' | 'flak' | 'oil'
export const PROJECTILE_KINDS: ProjectileKind[] = ['shunt', 'rshunt', 'bolt', 'mine', 'flak', 'oil']

const KIND_POWER: Record<ProjectileKind, PowerType> = { shunt: 'shunt', rshunt: 'shunt', bolt: 'bolt', mine: 'mine', flak: 'flak', oil: 'oil' }

export interface Projectile {
  id: number
  kind: ProjectileKind
  owner: Car
  pos: THREE.Vector3
  vel: THREE.Vector3
  heading: number
  target: Car | null
  life: number
  hp: number // Bolts needed to destroy it
  weakened: boolean
  hint: number
  age: number
  eventId: number
  lob: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; arc: number } | null
  airburst: boolean // a Flak canister that bursts when its lob ends
  hits: Map<Car, number> | null // Flak: pellets landed per car this volley (shared). Oil: age at each car's last spin.
  mesh: THREE.Object3D
  trail: Trail | null
  dead: boolean
}

export interface Dome {
  id: number
  owner: Car
  pos: THREE.Vector3
  warn: number
  life: number
  hitSet: Set<Car>
  eventId: number
  mesh: THREE.Group
  bolt: THREE.Mesh
  struck: boolean
}

export interface Ring {
  pos: THREE.Vector3
  t: number
  mesh: THREE.Mesh
}

/** A Railgun beam, fading out. */
export interface Beam {
  t: number
  mesh: THREE.Group
}

const tmp = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)
const where = newLoc()
let nextId = 1

const orbGeo = new THREE.IcosahedronGeometry(0.55, 1)
const boltGeo = new THREE.CapsuleGeometry(0.16, 1.4, 3, 6).rotateX(Math.PI / 2)
const mineGeo = new THREE.IcosahedronGeometry(0.55, 0)
const pelletGeo = new THREE.IcosahedronGeometry(0.16, 0)
const canisterGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.8, 8).rotateX(Math.PI / 2)
const globGeo = new THREE.SphereGeometry(0.5, 10, 8)
const slickGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2)
const slickRimGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2)
const slickMat = new THREE.MeshStandardMaterial({ color: '#141a1f', roughness: 0.12, metalness: 0.5, envMapIntensity: 3, polygonOffset: true, polygonOffsetFactor: -2 })

function glowSprite(color: string, size: number, intensity = 1.6) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(color).multiplyScalar(intensity), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
  s.scale.setScalar(size)
  return s
}

function emissive(color: string, k = 2.5) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })
}

/** Mesh and trail for a projectile (used by the simulation and by clients rebuilding snapshots). */
export function projectileVisual(game: Game, kind: ProjectileKind, lobbed = false) {
  const mesh = new THREE.Group()
  let trail: Trail | null = null
  if (kind === 'shunt' || kind === 'rshunt') {
    mesh.add(new THREE.Mesh(orbGeo, emissive(POWER_COLORS.shunt, 2.6)), glowSprite(POWER_COLORS.shunt, 4.5))
    trail = new Trail(POWER_COLORS.shunt, 0.9, 30, 2.4, true)
  } else if (kind === 'bolt') {
    mesh.add(new THREE.Mesh(boltGeo, emissive(POWER_COLORS.bolt, 3)), glowSprite(POWER_COLORS.bolt, 2.2))
    trail = new Trail(POWER_COLORS.bolt, 0.35, 14, 2.6, true)
  } else if (kind === 'mine') {
    mesh.add(new THREE.Mesh(mineGeo, emissive(POWER_COLORS.mine, 1.6)), glowSprite(POWER_COLORS.mine, 3.2))
    if (lobbed) trail = new Trail(POWER_COLORS.mine, 0.5, 18, 2.4, true)
  } else if (kind === 'flak') {
    // A pellet, or (lobbed backwards) the airburst canister.
    if (lobbed) {
      mesh.add(new THREE.Mesh(canisterGeo, emissive(POWER_COLORS.flak, 2)), glowSprite(POWER_COLORS.flak, 2.6))
      trail = new Trail(POWER_COLORS.flak, 0.4, 12, 2.4, true)
    } else {
      mesh.add(new THREE.Mesh(pelletGeo, emissive(POWER_COLORS.flak, 3.2)), glowSprite(POWER_COLORS.flak, 1.1, 2))
      trail = new Trail(POWER_COLORS.flak, 0.18, 7, 2.6, true)
    }
  } else {
    // Oil: a glossy black slick with a teal sheen at the edge; a flying glob while lobbed.
    const slick = new THREE.Group()
    const r = CONFIG.oil_radius
    const disc = new THREE.Mesh(slickGeo, slickMat)
    disc.scale.setScalar(r)
    // Teal edge and an oily sheen, drawn over the dark disc.
    const over = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }
    const rim = new THREE.Mesh(slickRimGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(POWER_COLORS.oil).multiplyScalar(1.4), opacity: 0.85, ...over }))
    rim.scale.setScalar(r)
    rim.position.y = 0.02
    const sheen = new THREE.Mesh(slickGeo, new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color('#5a3cff').lerp(new THREE.Color(POWER_COLORS.oil), 0.5).multiplyScalar(0.55), ...over }))
    sheen.scale.setScalar(r * 0.8)
    sheen.position.set(r * 0.15, 0.02, -r * 0.1)
    slick.add(disc, rim, sheen)
    for (let k = 0; k < 3; k++) {
      const blob = new THREE.Mesh(slickGeo, slickMat)
      blob.scale.setScalar(r * (0.25 + k * 0.08))
      blob.position.set(Math.cos(k * 2.2) * r * 0.95, 0.005, Math.sin(k * 2.2) * r * 0.95)
      slick.add(blob)
    }
    const glob = new THREE.Group()
    glob.add(new THREE.Mesh(globGeo, slickMat), glowSprite(POWER_COLORS.oil, 2.2, 1.2))
    mesh.add(slick, glob)
    slick.visible = !lobbed
    glob.visible = lobbed
    if (lobbed) trail = new Trail(POWER_COLORS.oil, 0.4, 14, 1.6, true)
  }
  game.scene.add(mesh)
  if (trail) game.scene.add(trail.mesh)
  return { mesh, trail }
}

export function domeVisual(game: Game, pos: THREE.Vector3) {
  const mesh = new THREE.Group()
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(CONFIG.shock_dome_radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(POWER_COLORS.shock).multiplyScalar(2.2) }, uAlpha: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vP;
        void main(){ float rim = pow(1.0 - abs(vN.z), 2.0); float arcs = step(0.93, fract(sin(floor(vP.y*6.0 + uTime*20.0) * 12.9898 + floor(atan(vP.z, vP.x)*5.0)) * 43758.5));
        gl_FragColor = vec4(uColor, (0.12 + rim*0.6 + arcs*0.8) * uAlpha); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }),
  )
  mesh.add(dome)
  mesh.add(glowSprite(POWER_COLORS.shock, 12, 0.8))
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 80, 6).translate(0, 40, 0), emissive(POWER_COLORS.shock, 4))
  mesh.add(bolt)
  mesh.position.copy(pos)
  mesh.position.y += game.track.heightAt(pos.x, pos.z)
  game.scene.add(mesh)
  return { mesh, bolt }
}

/** Visual state of a dome: the lightning strike while warning, then the crackling dome. */
export function animateDome(game: Game, d: Dome, dt: number) {
  const mat = (d.mesh.children[0] as THREE.Mesh).material as THREE.ShaderMaterial
  mat.uniforms.uTime.value += dt
  if (d.warn > 0) {
    d.bolt.visible = Math.random() < 0.7
    mat.uniforms.uAlpha.value = 0.15
    return
  }
  if (!d.struck) {
    d.struck = true
    d.bolt.visible = false
    game.fx.burst(d.mesh.position.clone().setY(d.mesh.position.y + 1), 40, 18, 0.6, 1.2, new THREE.Color(POWER_COLORS.shock).multiplyScalar(2.2), 1, 0.8)
    if (game.near(d.pos, 150)) game.audio.crackle()
  }
  mat.uniforms.uAlpha.value = Math.min(1, d.life * 2)
  d.mesh.scale.setScalar(1 + Math.sin(mat.uniforms.uTime.value * 30) * 0.02)
  if (Math.random() < dt * 8)
    game.fx.emit(d.mesh.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6)), new THREE.Vector3(0, 2, 0), 0.25, 0.8, new THREE.Color(POWER_COLORS.shock).multiplyScalar(2.5))
}

/** The car's chosen Shunt target: the rival nearest the centre of view (AI passes its own choice). */
export function lockTarget(game: Game, car: Car, backward = false): Car | null {
  const f = car.forward.multiplyScalar(backward ? -1 : 1)
  const cone = THREE.MathUtils.degToRad(CONFIG.lock_cone_deg)
  let best: Car | null = null
  let bestA = Infinity
  for (const o of game.cars) {
    if (o === car || !o.alive) continue
    tmp.subVectors(o.pos, car.pos)
    const d = tmp.length()
    if (d > CONFIG.lock_range || d < 2) continue
    const a = Math.acos(THREE.MathUtils.clamp(tmp.dot(f) / d, -1, 1))
    if (a < cone && a < bestA) {
      bestA = a
      best = o
    }
  }
  if (best || backward) return best
  if (game.track.arena) {
    // Arena: the nearest rival anywhere in front.
    let bestD: number = CONFIG.lock_range
    for (const o of game.cars) {
      if (o === car || !o.alive) continue
      tmp.subVectors(o.pos, car.pos)
      const d = tmp.length()
      if (tmp.dot(f) > 0 && d < bestD) {
        bestD = d
        best = o
      }
    }
    return best
  }
  // Nothing in view: the car directly ahead in the running order.
  return game.cars.find((o) => o.place === car.place - 1 && o.alive) ?? null
}

/** A point `dist` metres ahead: along the road on a circuit, straight ahead (on open floor) in an arena. */
function aheadPoint(game: Game, car: Car, dist: number) {
  const a = game.track.arena
  if (!a) return game.track.point(car.s + dist, car.lateral)
  return onFloor(a, car.pos.clone().addScaledVector(car.forward, dist).setY(0))
}

/** True where a shot would hit a barrier: off every road (shortcuts included) on a circuit, the rim or an obstacle
 * in an arena. */
function walled(game: Game, p: { pos: THREE.Vector3; hint: number }, pad = 0.6) {
  const a = game.track.arena
  if (a) return arenaBlocked(a, p.pos.x, p.pos.z)
  const off = game.track.offRoad(p.pos.x, p.pos.z, p.hint, pad, where)
  p.hint = where.i
  return off
}

export function fire(game: Game, car: Car, backward: boolean, target?: Car | null) {
  if (!car.alive || game.phase !== 'race') return false
  if (!car.bay[car.active]) car.cycle()
  const slot = car.bay[car.active]
  if (!slot) return false
  const type = slot.type
  if (type === 'rail' && car.railCharge > 0) return false
  car.consume()
  const f = car.forward
  const color = POWER_COLORS[type]
  game.sfx(`fire:${type}`, car.pos)
  switch (type) {
    case 'shunt': {
      const fs = Math.max(0, car.forwardSpeed)
      if (!backward) {
        const tgt = target === undefined ? lockTarget(game, car) : target
        spawnOrb(game, car, 'shunt', car.pos.clone().addScaledVector(f, 3).setY(1), f.clone().multiplyScalar(fs + CONFIG.shunt_speed), tgt)
      } else {
        // Straight back, no homing; behaves like a rolling mine for anyone behind.
        spawnOrb(game, car, 'rshunt', car.pos.clone().addScaledVector(f, -3.2).setY(1), f.clone().multiplyScalar(fs - CONFIG.shunt_speed), null)
      }
      break
    }
    case 'bolt':
      fireBolt(game, car, backward)
      break
    case 'mine': {
      const from = car.pos.clone().setY(1)
      let to: THREE.Vector3
      if (backward) to = car.pos.clone().addScaledVector(f, -3.2)
      else to = aheadPoint(game, car, CONFIG.mine_forward_range + Math.max(0, car.forwardSpeed) * 0.6)
      to.y = 0.55
      const { mesh, trail } = projectileVisual(game, 'mine', !backward)
      const p: Projectile = {
        id: nextId++, kind: 'mine', owner: car, pos: backward ? to.clone() : from.clone(), vel: new THREE.Vector3(), heading: car.yaw, target: null,
        life: CONFIG.mine_lifetime, hp: CONFIG.shunt_bolts_to_destroy, weakened: false, hint: car.hint, age: 0, eventId: nextId++,
        lob: backward ? null : { from, to, t: 0, dur: 0.6, arc: 5 }, airburst: false, hits: null, mesh, trail, dead: false,
      }
      mesh.position.copy(p.pos)
      game.projectiles.push(p)
      break
    }
    case 'barge':
      barge(game, car)
      break
    case 'shock':
      shock(game, car)
      break
    case 'nitro':
      if (!backward) car.nitro += CONFIG.nitro_duration
      else {
        car.airBrake = CONFIG.reverse_nitro_hold
        car.airBrakeResume = Math.max(car.forwardSpeed, kmh(CONFIG.reverse_nitro_speed))
        game.sfx('airbrake', car.pos)
      }
      break
    case 'shield':
      car.shield = CONFIG.shield_duration
      break
    case 'repair':
      car.health = Math.min(CONFIG.max_health, car.health + CONFIG.repair_amount)
      game.burst(car.pos.clone().setY(1), 30, 6, 0.8, 1.2, new THREE.Color(color).multiplyScalar(2), 1, 1.5)
      break
    case 'rail':
      // Charge first (the glow at the nose or tail warns everyone); the beam fires from updateWeapons.
      car.railCharge = CONFIG.rail_charge
      car.railBack = backward
      break
    case 'flak':
      flak(game, car, backward)
      break
    case 'oil':
      oil(game, car, backward)
      break
    case 'ram':
      car.ram = backward ? CONFIG.ram_brace_duration : CONFIG.ram_duration
      car.ramBoost = !backward
      game.burst(car.pos.clone().addScaledVector(f, 2).setY(0.8), 30, 10, 0.5, 0.9, new THREE.Color('#ff7a2f').multiplyScalar(2.2), 1, 0.3)
      break
  }
  game.onFired(car, type)
  return true
}

export function fireBolt(game: Game, car: Car, backward: boolean, aimError = 0) {
  const f = car.forward
  const dir = f.clone().multiplyScalar(backward ? -1 : 1)
  if (aimError) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), aimError)
  const { mesh, trail } = projectileVisual(game, 'bolt')
  const v = car.vel.clone().add(dir.multiplyScalar(CONFIG.bolt_speed))
  game.projectiles.push({
    id: nextId++, kind: 'bolt', owner: car, pos: car.pos.clone().addScaledVector(f, backward ? -2.8 : 2.8).setY(0.9), vel: v,
    heading: Math.atan2(v.x, v.z), target: null, life: CONFIG.bolt_lifetime, hp: 1, weakened: false, hint: car.hint, age: 0,
    eventId: nextId++, lob: null, airburst: false, hits: null, mesh, trail, dead: false,
  })
}

function spawnOrb(game: Game, car: Car, kind: 'shunt' | 'rshunt', pos: THREE.Vector3, vel: THREE.Vector3, target: Car | null) {
  const { mesh, trail } = projectileVisual(game, kind)
  mesh.position.copy(pos)
  game.projectiles.push({
    id: nextId++, kind, owner: car, pos, vel, heading: Math.atan2(vel.x, vel.z), target, life: CONFIG.shunt_lifetime,
    hp: CONFIG.shunt_bolts_to_destroy, weakened: false, hint: car.hint, age: 0, eventId: nextId++, lob: null, airburst: false, hits: null,
    mesh, trail, dead: false,
  })
}

/** Flak forward: a spread of short-range pellets. Backward: a canister that airbursts just behind. */
function flak(game: Game, car: Car, backward: boolean) {
  const f = car.forward
  const eventId = nextId++
  if (!backward) {
    const volley = new Map<Car, number>()
    const n = CONFIG.flak_pellets
    const spread = THREE.MathUtils.degToRad(CONFIG.flak_spread_deg)
    const muzzle = car.pos.clone().addScaledVector(f, 2.8).setY(0.9)
    for (let k = 0; k < n; k++) {
      const a = (k / (n - 1) - 0.5) * spread + (Math.random() - 0.5) * (spread / n)
      const v = car.vel.clone().add(f.clone().applyAxisAngle(UP, a).multiplyScalar(CONFIG.flak_speed))
      const { mesh, trail } = projectileVisual(game, 'flak')
      game.projectiles.push({
        id: nextId++, kind: 'flak', owner: car, pos: muzzle.clone(), vel: v, heading: Math.atan2(v.x, v.z), target: null, life: CONFIG.flak_lifetime,
        hp: 1, weakened: false, hint: car.hint, age: 0, eventId, lob: null, airburst: false, hits: volley, mesh, trail, dead: false,
      })
    }
    game.burst(muzzle, 16, 14, 0.25, 0.7, new THREE.Color(POWER_COLORS.flak).multiplyScalar(2.4), 1, 0.2)
    game.shakeFor(car, 0.2)
    return
  }
  // The canister keeps the car's speed, so it bursts the same distance behind the car at any speed.
  const dur = CONFIG.flak_airburst_time
  const from = car.pos.clone().addScaledVector(f, -2.5).setY(1)
  const to = car.pos.clone().addScaledVector(car.vel, dur).addScaledVector(f, -CONFIG.flak_airburst_distance).setY(2)
  const { mesh, trail } = projectileVisual(game, 'flak', true)
  mesh.position.copy(from)
  game.projectiles.push({
    id: nextId++, kind: 'flak', owner: car, pos: from.clone(), vel: new THREE.Vector3(), heading: car.yaw, target: null, life: dur + 1,
    hp: 1, weakened: false, hint: car.hint, age: 0, eventId, lob: { from, to, t: 0, dur, arc: 1.5 }, airburst: true, hits: null, mesh, trail, dead: false,
  })
}

function airburst(game: Game, p: Projectile) {
  destroy(game, p)
  game.burst(p.pos.clone(), 60, 16, 0.45, 1.0, new THREE.Color(POWER_COLORS.flak).multiplyScalar(2.4), 1, 0.5)
  game.sfx('hitHeavy', p.pos)
  for (const o of game.cars) {
    if (!o.alive || o === p.owner) continue
    if (Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) > CONFIG.flak_airburst_radius) continue
    game.damage(o, CONFIG.flak_airburst_damage, { by: p.owner, weapon: 'flak', effect: 'kick', eventId: p.eventId })
  }
}

/** Oil Slick: dropped behind, or flung ahead like a lobbed Mine. Spins out whoever drives through it. */
function oil(game: Game, car: Car, backward: boolean) {
  const f = car.forward
  const from = car.pos.clone().setY(1)
  const to = backward ? car.pos.clone().addScaledVector(f, -4) : aheadPoint(game, car, CONFIG.oil_forward_range + Math.max(0, car.forwardSpeed) * 0.5)
  if (game.track.arena) onFloor(game.track.arena, to, CONFIG.oil_radius)
  to.y = 0.05
  const { mesh, trail } = projectileVisual(game, 'oil', !backward)
  const p: Projectile = {
    id: nextId++, kind: 'oil', owner: car, pos: backward ? to.clone() : from.clone(), vel: new THREE.Vector3(), heading: car.yaw, target: null,
    life: CONFIG.oil_lifetime, hp: CONFIG.oil_spins, weakened: false, hint: car.hint, age: 0, eventId: nextId++,
    lob: backward ? null : { from, to, t: 0, dur: 0.6, arc: 5 }, airburst: false, hits: new Map(), mesh, trail, dead: false,
  }
  mesh.position.copy(p.pos)
  game.projectiles.push(p)
}

function slick(game: Game, p: Projectile) {
  const r2 = CONFIG.oil_radius ** 2
  for (const c of game.cars) {
    if (!c.alive || c.stun > 0) continue
    if (c === p.owner && p.age < CONFIG.oil_arm_time) continue
    if ((c.pos.x - p.pos.x) ** 2 + (c.pos.z - p.pos.z) ** 2 > r2) continue
    const last = p.hits!.get(c)
    if (last !== undefined && p.age - last < CONFIG.oil_rehit) continue
    p.hits!.set(c, p.age)
    if (game.damage(c, CONFIG.oil_damage, { by: p.owner === c ? null : p.owner, weapon: 'oil', effect: 'spin', stun: CONFIG.oil_stun, eventId: p.eventId })) {
      game.burst(c.pos.clone().setY(0.4), 14, 6, 0.6, 0.9, new THREE.Color(POWER_COLORS.oil).multiplyScalar(1.6), 0.8, 0.3)
      if (--p.hp <= 0) destroy(game, p)
    }
  }
}

/** Railgun: an instant beam that pierces every car on the line until a wall or obstacle stops it. */
function railShot(game: Game, car: Car) {
  const dir = car.forward.multiplyScalar(car.railBack ? -1 : 1)
  const range = car.railBack ? CONFIG.rail_back_range : CONFIG.rail_range
  const from = car.pos.clone().addScaledVector(dir, 2.6).setY(0.9)
  const probe = { pos: from.clone(), hint: car.hint }
  let len = 0
  for (; len < range; len += 1.5) {
    probe.pos.copy(from).addScaledVector(dir, len)
    if (walled(game, probe, 1.2)) break
  }
  const to = from.clone().addScaledVector(dir, len)
  const eventId = nextId++
  const w2 = CONFIG.rail_width ** 2
  for (const c of game.cars) {
    if (c === car || !c.alive) continue
    tmp.subVectors(c.pos, from).setY(0)
    const t = tmp.dot(dir)
    if (t < -1 || t > len + 1) continue
    if (tmp.addScaledVector(dir, -t).lengthSq() > w2) continue
    game.damage(c, CONFIG.rail_damage, { by: car, weapon: 'rail', effect: 'jolt', eventId })
  }
  // The beam also vaporises Shunts, Mines and Bolts it crosses.
  for (const p of game.projectiles) {
    if (p.dead || p.owner === car || p.kind === 'oil' || p.kind === 'flak') continue
    tmp.subVectors(p.pos, from).setY(0)
    const t = tmp.dot(dir)
    if (t >= 0 && t <= len && tmp.addScaledVector(dir, -t).lengthSq() < 2.25) destroy(game, p)
  }
  // Drawn at the height of the road under each end.
  from.y += game.track.heightAt(from.x, from.z)
  to.y += game.track.heightAt(to.x, to.z)
  railBeam(game, from, to)
  game.recordBeam(from, to)
  game.sfx('railshot', car.pos)
  game.shakeFor(car, 0.3)
}

/** The beam: a white-hot core in a blue glow, with sparks where it stops. Clients replay it from the fx log. */
export function railBeam(game: Game, from: THREE.Vector3, to: THREE.Vector3) {
  const len = Math.max(0.1, from.distanceTo(to))
  const group = new THREE.Group()
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, len, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.2, 4), transparent: true, toneMapped: false }))
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, len, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(POWER_COLORS.rail).multiplyScalar(1.8), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
  group.add(core, glow)
  group.position.copy(from).lerp(to, 0.5)
  group.quaternion.setFromUnitVectors(UP, tmp.subVectors(to, from).normalize())
  game.scene.add(group)
  game.beams.push({ t: 0, mesh: group })
  game.fx.burst(to, 30, 12, 0.4, 0.8, new THREE.Color(POWER_COLORS.rail).multiplyScalar(2.6), 1, 0.6)
}

export function updateBeams(game: Game, dt: number) {
  for (const b of game.beams) {
    b.t += dt
    const k = Math.max(0, 1 - b.t / CONFIG.rail_beam_fade)
    for (const m of b.mesh.children as THREE.Mesh[]) {
      const mat = m.material as THREE.MeshBasicMaterial
      mat.opacity = (mat.blending === THREE.AdditiveBlending ? 0.4 : 1) * k
    }
    b.mesh.scale.x = b.mesh.scale.z = 1 + b.t * 3
  }
  game.beams = game.beams.filter((b) => {
    if (b.t < CONFIG.rail_beam_fade) return true
    game.scene.remove(b.mesh)
    for (const m of b.mesh.children as THREE.Mesh[]) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
    return false
  })
}

/** Place and spin a projectile's mesh (host and clients); `ground` is the road height under it. */
export function animateProjectile(p: Projectile, dt: number, ground = 0) {
  p.mesh.position.copy(p.pos)
  p.mesh.position.y += ground
  p.mesh.rotation.y = p.kind === 'mine' ? p.mesh.rotation.y + dt * 3 : p.heading
  if (p.kind === 'oil') {
    p.mesh.children[0].visible = !p.lob
    p.mesh.children[1].visible = !!p.lob
  }
  if (p.trail) p.trail.push(p.mesh.position)
}

export function bargeRing(game: Game, pos: THREE.Vector3) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(POWER_COLORS.barge).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  )
  ring.position.copy(pos).setY(0.6 + game.track.heightAt(pos.x, pos.z))
  game.scene.add(ring)
  game.rings.push({ pos: ring.position, t: 0, mesh: ring })
}

function barge(game: Game, car: Car) {
  const eventId = nextId++
  for (const o of game.cars) {
    // Ram armour shrugs off a Barge.
    if (o === car || !o.alive || o.ram > 0) continue
    const d = o.pos.distanceTo(car.pos)
    if (d > CONFIG.barge_radius) continue
    tmp.subVectors(o.pos, car.pos).setY(0).normalize()
    if (game.damage(o, CONFIG.barge_damage, { by: car, weapon: 'barge', effect: 'push', eventId })) {
      // Shove ~barge_push_force metres off line over the next half second.
      o.vel.addScaledVector(tmp, CONFIG.barge_push_force * 4.5)
    }
  }
  // Also destroys any Shunt, Bolt or Mine about to hit.
  for (const p of game.projectiles) {
    if (p.owner !== car && !p.dead && p.pos.distanceTo(car.pos) < CONFIG.barge_radius) destroy(game, p)
  }
  bargeRing(game, car.pos)
  game.recordRing(car.pos)
  game.burst(car.pos.clone().setY(0.8), 60, 26, 0.5, 1.4, new THREE.Color(POWER_COLORS.barge).multiplyScalar(2), 1, 0.15)
  game.shakeFor(car, 0.35)
}

function shock(game: Game, car: Car) {
  const arena = game.track.arena
  const leader = (arena ? game.cars.find((c) => c.place === 1 && c.alive) : null) ?? game.cars.find((c) => c.place === 1) ?? car
  const eventId = nextId++
  const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5)
  for (let k = 0; k < CONFIG.shock_domes; k++) {
    let pos: THREE.Vector3
    if (arena) {
      // In the open the domes land across the leader's path, closer in.
      pos = leader.pos.clone().addScaledVector(leader.forward, 16 + k * 14).addScaledVector(leader.right, lanes[k % 3] * 7).setY(0)
      onFloor(arena, pos, CONFIG.shock_dome_radius)
    } else {
      const s = leader.s + CONFIG.shock_first_offset + k * CONFIG.shock_spacing
      const lat = lanes[k % 3] * (game.track.halfAt(s) - 3.5) * 0.85 + (Math.random() - 0.5) * 2
      pos = game.track.point(s, lat)
    }
    const { mesh, bolt } = domeVisual(game, pos)
    game.domes.push({ id: nextId++, owner: car, pos, warn: CONFIG.shock_warning + k * 0.12, life: CONFIG.shock_lifetime, hitSet: new Set(), eventId, mesh, bolt, struck: false })
  }
  game.sfx('crackle', car.pos)
}

export function destroy(game: Game, p: Projectile) {
  if (p.dead) return
  p.dead = true
  if (p.kind === 'oil') return
  const small = p.kind === 'bolt' || (p.kind === 'flak' && !p.airburst)
  game.burst(p.pos, small ? 8 : 26, small ? 6 : 12, 0.45, small ? 0.5 : 1.1, new THREE.Color(POWER_COLORS[KIND_POWER[p.kind]]).multiplyScalar(2))
}

export function removeProjectileVisual(game: Game, p: Projectile) {
  game.scene.remove(p.mesh)
  if (p.trail) game.scene.remove(p.trail.mesh)
}

/** Advance projectiles, domes and rings; resolve every hit and counter. */
export function updateWeapons(game: Game, dt: number) {
  const track = game.track
  const turn = THREE.MathUtils.degToRad(CONFIG.shunt_turn_rate)
  // Railguns finishing their charge.
  for (const c of game.cars) {
    if (c.railCharge <= 0) continue
    if (!c.alive) {
      c.railCharge = 0
      continue
    }
    c.railCharge -= dt
    if (c.railCharge <= 0) {
      c.railCharge = 0
      railShot(game, c)
    }
  }
  for (const p of game.projectiles) {
    if (p.dead) continue
    p.age += dt
    p.life -= dt
    if (p.life <= 0) {
      destroy(game, p)
      continue
    }
    if (p.kind === 'shunt' && track.arena) {
      // In the open: turn towards the target at the Shunt's rate. Rock and the rim stop it.
      const tgt = p.target && p.target.alive ? p.target : null
      if (tgt) {
        const want = Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z)
        let d = want - p.heading
        d = Math.atan2(Math.sin(d), Math.cos(d))
        p.heading += THREE.MathUtils.clamp(d, -turn * dt, turn * dt)
      }
      const speed = Math.max(CONFIG.shunt_speed, p.vel.length() - dt * 4)
      p.vel.set(Math.sin(p.heading) * speed, 0, Math.cos(p.heading) * speed)
    } else if (p.kind === 'shunt') {
      // Ride the track towards the target; home in directly at close range.
      const n = track.nearest(p.pos.x, p.pos.z, p.hint)
      p.hint = n.i
      const tgt = p.target && p.target.alive ? p.target : null
      let aim: THREE.Vector3
      if (tgt && tgt.pos.distanceTo(p.pos) < CONFIG.shunt_home_distance + 10) aim = tmp.copy(tgt.pos)
      else aim = track.point(n.s + 18, tgt ? THREE.MathUtils.lerp(n.lateral, tgt.lateral, 0.6) : n.lateral * 0.9, tmp)
      const want = Math.atan2(aim.x - p.pos.x, aim.z - p.pos.z)
      let d = want - p.heading
      d = Math.atan2(Math.sin(d), Math.cos(d))
      p.heading += THREE.MathUtils.clamp(d, -turn * dt, turn * dt)
      const sp = p.vel.length()
      // Never slower than its base speed; keeps any extra speed it was launched with.
      const speed = Math.max(CONFIG.shunt_speed, sp - dt * 4)
      p.vel.set(Math.sin(p.heading) * speed, 0, Math.cos(p.heading) * speed)
      if (Math.abs(n.lateral) > track.hw[n.i] - 0.4 && track.offRoad(p.pos.x, p.pos.z, p.hint, -0.4, where) && where.branch < 0) {
        // Hug the wall rather than leaving the road.
        const sign = Math.sign(n.lateral)
        p.pos.x += track.tz[n.i] * sign * 0.3
        p.pos.z -= track.tx[n.i] * sign * 0.3
      }
    }
    if (p.lob) {
      p.lob.t += dt
      const k = Math.min(1, p.lob.t / p.lob.dur)
      p.pos.lerpVectors(p.lob.from, p.lob.to, k)
      p.pos.y = THREE.MathUtils.lerp(p.lob.from.y, p.lob.to.y, k) + Math.sin(k * Math.PI) * p.lob.arc
      if (k >= 1) {
        p.lob = null
        if (p.airburst) {
          airburst(game, p)
          continue
        }
      }
    } else if (p.kind !== 'mine' && p.kind !== 'oil') p.pos.addScaledVector(p.vel, dt)
    if (p.kind === 'rshunt') p.vel.multiplyScalar(Math.max(0, 1 - dt * 0.4))
    animateProjectile(p, dt, track.heightAt(p.pos.x, p.pos.z))

    // Walls stop straight-line shots (and, in an arena, homing Shunts).
    if ((p.kind === 'bolt' || p.kind === 'rshunt' || p.kind === 'flak' || (p.kind === 'shunt' && track.arena)) && !p.lob && walled(game, p)) {
      destroy(game, p)
      continue
    }
    if (p.lob) continue
    if (p.kind === 'oil') {
      slick(game, p)
      continue
    }

    // Hits on cars.
    for (const c of game.cars) {
      if (!c.alive || p.dead) continue
      if (c === p.owner && (p.kind !== 'mine' || p.age < CONFIG.mine_arm_time) && p.kind !== 'rshunt') continue
      if (c === p.owner && p.kind === 'rshunt' && p.age < 1.2) continue
      const r = p.kind === 'mine' ? CONFIG.mine_trigger_radius : p.kind === 'bolt' || p.kind === 'flak' ? 1.7 : 2.0
      const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z
      if (dx * dx + dz * dz > r * r) continue
      hitCar(game, p, c)
    }
  }

  // Counters between projectiles: Bolts chip Shunts and Mines; a backward Shunt or Mine stops an incoming Shunt.
  const ps = game.projectiles
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i]
    if (a.dead || a.lob) continue
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j]
      if (b.dead || b.lob || a.owner === b.owner) continue
      if (a.kind === 'oil' || a.kind === 'flak' || b.kind === 'oil' || b.kind === 'flak') continue
      const r = a.kind === 'bolt' || b.kind === 'bolt' ? 1.6 : 2.2
      if (a.pos.distanceToSquared(b.pos) > r * r) continue
      const bolt = a.kind === 'bolt' ? a : b.kind === 'bolt' ? b : null
      const other = bolt === a ? b : a
      if (bolt && other.kind !== 'bolt') {
        destroy(game, bolt)
        other.hp--
        if (other.hp <= 0) destroy(game, other)
        else if (other.kind === 'shunt' || other.kind === 'rshunt') other.weakened = true
      } else if (!bolt && (a.kind === 'shunt' || b.kind === 'shunt')) {
        destroy(game, a)
        destroy(game, b)
      }
    }
  }
  for (const p of ps) if (p.dead) removeProjectileVisual(game, p)
  game.projectiles = ps.filter((p) => !p.dead)

  // Shock domes.
  for (const d of game.domes) {
    if (d.warn > 0) d.warn -= dt
    else d.life -= dt
    animateDome(game, d, dt)
    if (d.warn > 0) continue
    for (const c of game.cars) {
      if (!c.alive || c === d.owner || d.hitSet.has(c)) continue
      if (c.pos.distanceTo(d.pos) < CONFIG.shock_dome_radius + 1.0) {
        d.hitSet.add(c)
        game.damage(c, CONFIG.shock_damage, { by: d.owner, weapon: 'shock', effect: 'spin', stun: CONFIG.mine_stun, eventId: d.eventId })
      }
    }
  }
  game.domes = game.domes.filter((d) => {
    if (d.life > 0) return true
    game.scene.remove(d.mesh)
    return false
  })
  updateRings(game, dt)
  updateBeams(game, dt)
}

export function updateRings(game: Game, dt: number) {
  for (const r of game.rings) {
    r.t += dt
    const k = r.t / 0.4
    r.mesh.scale.setScalar(1 + k * CONFIG.barge_radius)
    ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k)
  }
  game.rings = game.rings.filter((r) => {
    if (r.t < 0.4) return true
    game.scene.remove(r.mesh)
    return false
  })
}

function hitCar(game: Game, p: Projectile, c: Car) {
  if (p.kind === 'mine') {
    // Blast catches everything nearby (multi-wreck possible).
    destroy(game, p)
    game.burst(p.pos.clone().setY(0.8), 50, 14, 0.7, 1.6, new THREE.Color(POWER_COLORS.mine).multiplyScalar(2.2), 1, 1)
    for (const o of game.cars) {
      if (!o.alive || o.pos.distanceTo(p.pos) > CONFIG.mine_blast_radius) continue
      game.damage(o, CONFIG.mine_damage, { by: p.owner === o ? null : p.owner, weapon: 'mine', effect: 'spin', stun: CONFIG.mine_stun, eventId: p.eventId })
    }
    return
  }
  destroy(game, p)
  if (p.kind === 'flak') {
    // Each car takes at most flak_max_hits pellets from one volley.
    const n = p.hits?.get(c) ?? 0
    if (n >= CONFIG.flak_max_hits) return
    p.hits?.set(c, n + 1)
    game.damage(c, CONFIG.flak_damage, { by: p.owner, weapon: 'flak', effect: 'kick', eventId: p.eventId })
  } else if (p.kind === 'bolt') {
    game.damage(c, CONFIG.bolt_damage, { by: p.owner, weapon: 'bolt', effect: 'kick', eventId: p.eventId })
  } else if (p.weakened) {
    game.damage(c, CONFIG.shunt_weakened_damage, { by: p.owner, weapon: 'shunt', effect: 'jolt', eventId: p.eventId })
  } else {
    game.damage(c, CONFIG.shunt_damage, { by: p.owner === c ? null : p.owner, weapon: 'shunt', effect: Math.random() < 0.5 ? 'flip' : 'spin', stun: CONFIG.shunt_stun, eventId: p.eventId })
  }
}

/** Seconds until an incoming Shunt reaches `car`, or null. */
export function incomingShunt(game: Game, car: Car) {
  let best: Projectile | null = null
  let bestT = Infinity
  for (const p of game.projectiles) {
    if (p.kind !== 'shunt' || p.target !== car || p.dead) continue
    const d = p.pos.distanceTo(car.pos)
    const closing = Math.max(5, p.vel.length() - Math.max(0, car.forwardSpeed))
    const t = d / closing
    if (t < bestT) {
      bestT = t
      best = p
    }
  }
  return best ? { p: best, t: bestT } : null
}
