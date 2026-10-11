// A player on the course: movement (run, jump, dive, creep), the state table (stunned, boosted, shielded, protected,
// respawning, finished), the 3-slot inventory and their own ball.
import * as THREE from 'three'
import { CONFIG, deg } from './config'
import type { BallState } from './ball'
import type { Ground } from './ball'
import type { Course } from './course'
import type { GolferRig } from './assets'

export type ItemType = 'rocket' | 'pistol' | 'landmine' | 'laser' | 'airhorn' | 'cart' | 'coffee' | 'springboots' | 'elephant' | 'shield' | 'driver' | 'freeze'

export interface MoveInput {
  x: number // strafe -1..1
  y: number // forward -1..1
  yaw: number // heading the input is relative to
  jump: boolean
  dive: boolean
  creep: boolean
}

export type Personality = 'Golfer' | 'Griefer' | 'Sniper' | 'Rammer'

export class Golfer {
  readonly id: number
  readonly name: string
  readonly color: string
  /** Controlled by a person (this browser or a remote player); false for bots, and for a player who left. */
  human: boolean
  /** Online: the peer id of the person controlling this golfer ('host' for the host), null for bots. */
  remoteId: string | null = null
  /** Where a person is aiming (their camera yaw); bots aim along `yaw`. */
  aim = 0
  readonly skill: number
  readonly personality: Personality
  readonly rig: GolferRig

  // Body.
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3() // horizontal run velocity
  readonly kb = new THREE.Vector3() // knockback velocity
  vy = 0
  air = 0 // height above ground
  yaw = 0
  grounded = true

  // State timers (seconds remaining).
  stun = 0
  stunTotal = 1
  boost = 0
  shield = 0
  protect = 0
  protectLevel = 0
  lastKnockedAt = -99
  dive = 0
  diveCooldown = 0
  creeping = false
  charging = 0 // seconds held, 0 = not charging
  swing = 0 // swing animation / melee window
  cooldown = 0
  respawn = 0
  frozen = 0 // Freeze Bomb: stuck in ice (also stunned)
  leap = 0 // Spring Boots: seconds of flight left
  readonly leapVel = new THREE.Vector3()
  finished = false
  finishPlace = 0
  knockedBy: { by: Golfer; at: number } | null = null

  // Golf.
  ball: BallState
  ballMesh: THREE.Mesh
  strokes = 0
  checkpoint: THREE.Vector3
  passed = new Set<number>()
  loft = deg(28)

  // Items.
  inventory: (ItemType | null)[] = [null, null, null]
  active = 0
  mineCharges = 0 // landmines left in the pack in hand

  // Hole stats for scoring.
  knockouts = 0
  victims = new Set<number>()
  waterKnocks = 0
  shieldBlocks = 0
  timedOut = false
  points = 0

  // AI scratch.
  ai = { plan: null as null | { dir: number; power: number; loft: number }, think: 0, target: null as THREE.Vector3 | null, aimT: 0, itemT: 0, meleeT: 0 }

  constructor(id: number, name: string, color: string, human: boolean, skill: number, personality: Personality, rig: GolferRig, ballMesh: THREE.Mesh, tee: THREE.Vector3) {
    this.id = id
    this.name = name
    this.color = color
    this.human = human
    this.skill = skill
    this.personality = personality
    this.rig = rig
    this.ballMesh = ballMesh
    this.checkpoint = tee.clone()
    this.ball = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), mode: 'rest' }
  }

  get canAct() {
    return this.stun <= 0 && this.respawn <= 0 && !this.finished
  }

  get shielded() {
    return this.shield > 0
  }

  get immune() {
    return this.shield > 0 || this.protect > 0 || this.dive > CONFIG.dive_duration - CONFIG.dive_iframes || this.respawn > 0 || this.finished
  }

  get speed() {
    const base = this.creeping ? CONFIG.creep_speed : CONFIG.run_speed
    return base * (this.boost > 0 ? CONFIG.boost_speed_mult : 1)
  }

  give(item: ItemType) {
    const free = this.inventory.findIndex((s) => !s)
    if (free < 0) return false
    this.inventory[free] = item
    if (!this.inventory[this.active]) this.active = free
    return true
  }

  take() {
    const it = this.inventory[this.active]
    if (!it) return null
    this.inventory[this.active] = null
    const next = this.inventory.findIndex((s) => s)
    if (next >= 0) this.active = next
    return it
  }

  /** Movement and the physical states. `move` is ignored while stunned, charging or respawning. */
  update(dt: number, move: MoveInput | null, ground: Ground, course: Course, others: Golfer[]) {
    for (const k of ['stun', 'boost', 'shield', 'protect', 'dive', 'diveCooldown', 'swing', 'cooldown', 'frozen'] as const) this[k] = Math.max(0, this[k] - dt)

    const canMove = this.canAct && this.charging <= 0
    if (move && canMove) {
      this.creeping = move.creep
      if (move.dive && this.dive <= 0 && this.diveCooldown <= 0 && this.grounded) {
        this.dive = CONFIG.dive_duration
        this.diveCooldown = CONFIG.dive_duration + 0.4
      }
      if (move.jump && this.grounded && this.dive <= 0) {
        this.vy = Math.sqrt(2 * CONFIG.jump_gravity * CONFIG.jump_height)
        this.grounded = false
      }
      const len = Math.min(1, Math.hypot(move.x, move.y))
      if (this.dive > 0) {
        this.vel.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(CONFIG.dive_speed)
      } else if (len > 0.05) {
        const fx = Math.sin(move.yaw), fz = Math.cos(move.yaw)
        const rx = -fz, rz = fx // right of the heading
        const dx = fx * move.y + rx * move.x, dz = fz * move.y + rz * move.x
        const dl = Math.hypot(dx, dz) || 1
        const want = new THREE.Vector3(dx / dl, 0, dz / dl).multiplyScalar(this.speed * len)
        this.vel.lerp(want, Math.min(1, dt * 12))
        const targetYaw = Math.atan2(dx, dz)
        let d = targetYaw - this.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        this.yaw += d * Math.min(1, dt * 14)
      } else this.vel.multiplyScalar(Math.max(0, 1 - dt * 14))
    } else if (this.dive <= 0) this.vel.multiplyScalar(Math.max(0, 1 - dt * 10))

    // Knockback decays over a short time.
    this.kb.multiplyScalar(Math.max(0, 1 - dt / CONFIG.stun_knockback_time * 1.4))
    const step = this.vel.clone().add(this.kb).multiplyScalar(dt)
    // Spring Boots: a long arcing leap that ignores steering until you land.
    if (this.leap > 0) {
      this.leap -= dt
      step.copy(this.leapVel).multiplyScalar(dt)
    }
    this.pos.x += step.x
    this.pos.z += step.z

    // Trees and other players push back.
    for (const t of course.trees) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z
      const r = t.r * t.scale + CONFIG.player_radius
      const d2 = dx * dx + dz * dz
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1
        this.pos.x = t.x + (dx / d) * r
        this.pos.z = t.z + (dz / d) * r
      }
    }
    for (const o of others) {
      if (o === this || o.respawn > 0) continue
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z
      const r = CONFIG.player_radius * 2
      const d2 = dx * dx + dz * dz
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        this.pos.x += (dx / d) * (r - d) * 0.5
        this.pos.z += (dz / d) * (r - d) * 0.5
      }
    }

    // Vertical: jumping and falling off ledges.
    const gy = ground.y(this.pos.x, this.pos.z)
    this.vy -= CONFIG.jump_gravity * dt
    this.pos.y += this.vy * dt
    if (this.pos.y <= gy) {
      this.pos.y = gy
      this.vy = 0
      this.grounded = true
    } else if (this.pos.y > gy + 0.3) this.grounded = false
    this.air = this.pos.y - gy
  }

  /** In water or off the map: the respawn timer starts. */
  inHazard(ground: Ground) {
    const gy = ground.y(this.pos.x, this.pos.z)
    return (gy < 0.05 && this.pos.y < 0.4) || !ground.inBounds(this.pos.x, this.pos.z) || this.pos.y < -6
  }
}
