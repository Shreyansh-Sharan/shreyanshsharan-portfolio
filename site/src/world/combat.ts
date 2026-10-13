// Mission combat: waves of small, cute enemies around a mission beacon, the player's hits on them, and
// the game-feel extras (hit-stop, screen shake, coins). Framework-free shared state like controls.ts;
// Enemies.tsx draws it, Characters.tsx attacks it, PlayHud.tsx shows the counter.
import * as THREE from 'three'
import { WATER_LEVEL } from './regions'
import { heightAt } from './terrain'
import { blocked, resolve } from './colliders'
import { MISSIONS, type Mission } from './missions'
import { emit, SHAPE, type Emit } from './particles'
import { world } from './store'
import { play } from '../lib/sound'

/* ---------- Game feel ---------- */

export const feel = {
  /** Seconds of frozen time left after a hit lands (hit-stop). */
  hitStop: 0,
  /** Camera shake strength, decays over time. */
  shake: 0,
}

/** Time stands still (photo mode). */
export const freeze = { value: false }

/** Delta time for gameplay: zero during hit-stop so a landed blow lands with weight, and while time is frozen. */
export const gameDt = (dt: number) => (feel.hitStop > 0 || freeze.value ? 0 : dt)

export function impact(stop: number, shake: number) {
  feel.hitStop = Math.max(feel.hitStop, stop)
  feel.shake = Math.max(feel.shake, shake)
}

/* ---------- Enemies ---------- */

export type EnemyKind = 'blob' | 'spiky' | 'helmet'

export const ENEMY_COLORS: Record<EnemyKind, THREE.Color> = {
  blob: new THREE.Color('#a855f7'),
  spiky: new THREE.Color('#f43f5e'),
  helmet: new THREE.Color('#22c55e'),
}

export interface Enemy {
  id: number
  alive: boolean
  kind: EnemyKind
  hp: number
  /** Still wearing its helmet (the first hit knocks it off). */
  helmet: boolean
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  grounded: boolean
  /** 0..1 pop-in when spawning. */
  spawn: number
  /** Seconds of white hit flash left. */
  flash: number
  /** Seconds stunned after a hit (no chasing, no bumping). */
  stun: number
  /** Seconds since death (-1 while alive): plays the squash-and-pop. */
  dying: number
  /** Squash on landing / hits, 0..1. */
  squash: number
  hop: number
  /** The attack swing that last hit it, so one swing hits once. */
  lastSwing: number
}

export const MAX_ENEMIES = 12

export const enemies: Enemy[] = Array.from({ length: MAX_ENEMIES }, (_, id) => ({
  id,
  alive: false,
  kind: 'blob',
  hp: 1,
  helmet: false,
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0,
  grounded: true,
  spawn: 1,
  flash: 0,
  stun: 0,
  dying: -1,
  squash: 0,
  hop: 0,
  lastSwing: -1,
}))

/* ---------- The fight (one mission at a time) ---------- */

export interface Fight {
  mission: Mission
  wave: number
  waves: number[]
  /** Enemies of the current wave still to spawn, and the countdown to the next one. */
  queue: number
  spawnIn: number
  /** Pause between waves. */
  breather: number
  left: number
  total: number
}

export let fight: Fight | null = null
/** Bumped each time a mission is won (the HUD and the player's cheer key off it). */
export const results = { wins: 0, coins: 0 }

/** Wave sizes for a mission: quick and easy, one to three waves of five to eight. */
export function wavesFor(index: number) {
  const n = 1 + (index % 3)
  return Array.from({ length: n }, (_, k) => 5 + k + ((index + k) % 3))
}

function publish() {
  const f = fight
  world.set({
    fight: f ? { tile: f.mission.tile.id, name: f.mission.name, wave: f.wave + 1, waves: f.waves.length, left: f.left, total: f.total } : null,
  })
}

export function startFight(mission: Mission) {
  clearEnemies()
  const waves = wavesFor(MISSIONS.indexOf(mission))
  fight = { mission, wave: 0, waves, queue: waves[0], spawnIn: 0.6, breather: 0, left: waves[0], total: waves[0] }
  publish()
  play('boot')
}

export function endFight() {
  fight = null
  clearEnemies()
  publish()
}

function clearEnemies() {
  for (const e of enemies) {
    e.alive = false
    e.dying = -1
  }
}

const KINDS: EnemyKind[] = ['blob', 'blob', 'spiky', 'helmet']

function spawnOne(f: Fight) {
  const e = enemies.find((x) => !x.alive && x.dying < 0)
  if (!e) return false
  const cx = f.mission.x, cz = f.mission.z
  let x = cx, z = cz
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 7
    x = cx + Math.cos(a) * r
    z = cz + Math.sin(a) * r
    if (heightAt(x, z) > WATER_LEVEL + 0.4 && !blocked(x, z, 0.5)) break
  }
  e.alive = true
  e.kind = f.wave === 0 && f.queue > 3 ? 'blob' : KINDS[Math.floor(Math.random() * KINDS.length)]
  e.hp = e.kind === 'helmet' ? 2 : 1
  e.helmet = e.kind === 'helmet'
  e.pos.set(x, heightAt(x, z), z)
  e.vel.set(0, 5, 0)
  e.grounded = false
  e.spawn = 0
  e.flash = 0
  e.stun = 0.5
  e.dying = -1
  e.squash = 0
  e.hop = Math.random() * 6
  e.lastSwing = -1
  e.yaw = Math.random() * Math.PI * 2
  burst({ count: 10, x, y: e.pos.y + 0.2, z, color: C.dust, shape: SHAPE.smoke, up: 0.4, speed: [1, 2.5], size: [0.35, 0.55], life: [0.4, 0.7], drag: 3, grow: true })
  return true
}

/* ---------- Particles ---------- */

const C = {
  dust: new THREE.Color('#c9b99c'),
  coin: new THREE.Color('#ffd23f'),
  spark: new THREE.Color('#fff4c2'),
  confetti: [new THREE.Color('#ff5fa2'), new THREE.Color('#38bdf8'), new THREE.Color('#facc15'), new THREE.Color('#4ade80'), new THREE.Color('#c084fc')],
}
const opts: Emit = { count: 0, x: 0, y: 0, z: 0, speed: [0, 0], color: C.dust, size: [0, 0], life: [0, 0] }
function burst(o: Partial<Emit> & Pick<Emit, 'count' | 'x' | 'y' | 'z' | 'color'>) {
  opts.spread = 0
  opts.up = 0.3
  opts.color2 = undefined
  opts.hdr = 1
  opts.gravity = 0
  opts.drag = 0
  opts.shape = SHAPE.glow
  opts.grow = false
  opts.speed = [1, 2]
  opts.size = [0.2, 0.3]
  opts.life = [0.5, 0.8]
  Object.assign(opts, o)
  emit(opts)
}

/** Confetti and coins: the pop of a defeated enemy, or (bigger) a won mission. */
export function confetti(x: number, y: number, z: number, scale = 1) {
  for (let i = 0; i < C.confetti.length; i++)
    burst({ count: Math.round(6 * scale), x, y, z, color: C.confetti[i], shape: SHAPE.shard, hdr: 1.3, up: 0.75, speed: [3 * scale, 6 * scale], size: [0.14, 0.24], life: [0.8, 1.4], gravity: 9, drag: 1.2, spread: 0.2 * scale })
  burst({ count: Math.round(8 * scale), x, y, z, color: C.coin, shape: SHAPE.star, hdr: 2, up: 0.9, speed: [3, 6 * scale], size: [0.28, 0.4], life: [0.7, 1.1], gravity: 12, drag: 0.5 })
}

/* ---------- Hits ---------- */

let swing = 0
/** A new id for an attack swing (each enemy is hit at most once per swing). */
export const newSwing = () => ++swing

export interface HitShape {
  x: number
  y: number
  z: number
  /** Facing (yaw) and half-angle of the hit cone; Math.PI hits all around. */
  yaw: number
  arc: number
  range: number
  damage: number
  knock: number
  lift: number
  swing: number
}

/** Apply a melee/area hit; returns how many enemies it connected with. */
export function hitEnemies(h: HitShape): number {
  let n = 0
  for (const e of enemies) {
    if (!e.alive || e.lastSwing === h.swing || e.spawn < 0.6) continue
    const dx = e.pos.x - h.x, dz = e.pos.z - h.z
    const d = Math.hypot(dx, dz)
    if (d > h.range + 0.45 || Math.abs(e.pos.y - h.y) > 2.2) continue
    if (h.arc < Math.PI && d > 0.3) {
      let a = Math.atan2(dx, dz) - h.yaw
      a = Math.atan2(Math.sin(a), Math.cos(a))
      if (Math.abs(a) > h.arc) continue
    }
    e.lastSwing = h.swing
    damage(e, h.damage, d > 1e-3 ? dx / d : Math.sin(h.yaw), d > 1e-3 ? dz / d : Math.cos(h.yaw), h.knock, h.lift)
    n++
  }
  if (n) impact(n > 1 ? 0.09 : 0.06, Math.min(0.6, 0.22 + n * 0.08))
  return n
}

/** Damage one enemy, knocking it away along (nx, nz). */
export function damage(e: Enemy, amount: number, nx: number, nz: number, knock: number, lift: number) {
  e.flash = 0.12
  e.stun = 0.55
  e.squash = 1
  e.vel.set(nx * knock, lift, nz * knock)
  e.grounded = false
  burst({ count: 9, x: e.pos.x, y: e.pos.y + 0.5, z: e.pos.z, color: C.spark, color2: C.coin, shape: SHAPE.star, hdr: 2.4, up: 0.4, speed: [2, 5], size: [0.16, 0.26], life: [0.15, 0.3] })
  if (e.helmet) {
    // The helmet flies off; one more hit finishes it.
    e.helmet = false
    e.hp -= 1
    play('move')
    return
  }
  e.hp -= amount
  if (e.hp <= 0) {
    e.alive = false
    e.dying = 0
    impact(0.08, 0.4)
    play('select')
  } else play('move')
}

/** The nearest live enemy within `range` of a point, or null (the spell zaps it during a mission). */
export function nearestEnemy(x: number, z: number, range: number): Enemy | null {
  let best: Enemy | null = null
  let bestD = range
  for (const e of enemies) {
    if (!e.alive) continue
    const d = Math.hypot(e.pos.x - x, e.pos.z - z)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/* ---------- Simulation ---------- */

/** Where the player is and how to shove them, supplied by the player each frame. */
export interface Target {
  pos: THREE.Vector3
  knock: THREE.Vector2
}

/** Advance the fight and every enemy. `dt` is already hit-stop aware. */
export function stepCombat(dt: number, rawDt: number, p: Target) {
  feel.hitStop = Math.max(0, feel.hitStop - rawDt)
  const f = fight
  for (const e of enemies) {
    if (e.dying >= 0) {
      e.dying += rawDt
      if (e.dying > 0.16 && e.dying - rawDt <= 0.16) {
        confetti(e.pos.x, e.pos.y + 0.5, e.pos.z)
        results.coins += 5
      }
      if (e.dying > 0.3) e.dying = -1
      continue
    }
    if (!e.alive) continue
    stepEnemy(e, dt, p)
  }
  if (!f) return

  // Bail out if the player wanders off.
  if (Math.hypot(p.pos.x - f.mission.x, p.pos.z - f.mission.z) > 75) {
    endFight()
    return
  }
  // Spawning the current wave, one pop at a time.
  if (f.queue > 0) {
    f.spawnIn -= dt
    if (f.spawnIn <= 0 && spawnOne(f)) {
      f.queue--
      f.spawnIn = 0.18
    }
  }
  const alive = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0)
  const left = f.queue + alive
  if (left !== f.left) {
    f.left = left
    publish()
  }
  if (left > 0) return
  if (f.wave + 1 < f.waves.length) {
    // Next wave after a short breather.
    f.breather += dt
    if (f.breather > 1.4) {
      f.wave++
      f.breather = 0
      f.queue = f.waves[f.wave]
      f.total = f.left = f.queue
      f.spawnIn = 0
      publish()
      play('boot')
    }
    return
  }
  // Mission won.
  const m = f.mission
  fight = null
  world.complete(m.tile.id)
  results.wins++
  results.coins += 25
  confetti(p.pos.x, p.pos.y + 2.2, p.pos.z, 2.2)
  impact(0, 0.35)
  world.set({ fight: null, cheer: { n: results.wins, name: m.name } })
  play('boot')
}

const v2 = new THREE.Vector2()

function stepEnemy(e: Enemy, dt: number, p: Target) {
  e.spawn = Math.min(1, e.spawn + dt * 3)
  e.flash = Math.max(0, e.flash - dt)
  e.stun = Math.max(0, e.stun - dt)
  e.squash = Math.max(0, e.squash - dt * 4)

  // Chase the player in little hops once spawned and not stunned.
  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z
  const d = Math.hypot(dx, dz)
  if (e.grounded && e.stun <= 0) {
    e.hop += dt
    const speed = e.kind === 'spiky' ? 3.2 : 2.4
    if (d > 0.9) {
      e.vel.x = (dx / d) * speed
      e.vel.z = (dz / d) * speed
      e.yaw = Math.atan2(dx, dz)
    } else e.vel.x = e.vel.z = 0
    if (e.hop > (e.kind === 'spiky' ? 0.45 : 0.6)) {
      e.hop = 0
      e.vel.y = 3.6
      e.grounded = false
    }
  }
  // Bumping into the player shoves them back (no damage: it's meant to be easy).
  if (d < 0.85 && e.stun <= 0 && Math.abs(p.pos.y - e.pos.y) < 1.2) {
    v2.set(dx, dz).normalize()
    p.knock.set(v2.x * 7, v2.y * 7)
    e.vel.set(-v2.x * 4, 3, -v2.y * 4)
    e.grounded = false
    e.stun = 0.6
    e.squash = 1
    impact(0.03, 0.2)
  }

  // Integrate; slide along props; no swimming.
  const nx = e.pos.x + e.vel.x * dt, nz = e.pos.z + e.vel.z * dt
  if (heightAt(nx, nz) > WATER_LEVEL + 0.2) {
    e.pos.x = nx
    e.pos.z = nz
    resolve(e.pos, 0.45, e.pos.y)
  }
  e.vel.y -= 22 * dt
  e.pos.y += e.vel.y * dt
  const ground = heightAt(e.pos.x, e.pos.z)
  if (e.pos.y <= ground) {
    if (!e.grounded && e.vel.y < -3) e.squash = Math.max(e.squash, 0.6)
    e.pos.y = ground
    e.vel.y = 0
    e.grounded = true
    if (e.stun > 0) {
      e.vel.x *= 0.5
      e.vel.z *= 0.5
    }
  }
}
