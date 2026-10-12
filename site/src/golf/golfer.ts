// A player on the course: movement (run, jump, dive, creep), the state table (stunned, boosted, shielded, protected,
// respawning, finished), the 3-slot inventory and their own ball.
import * as THREE from 'three'
import { CONFIG, deg } from './config'
import type { BallState } from './ball'
import type { Ground } from './ball'
import type { Course } from './course'
import type { GolferRig } from './assets'
import type { Cart } from './cart'

export type ItemType =
  | 'rocket' | 'pistol' | 'landmine' | 'laser' | 'airhorn' | 'cart' | 'coffee' | 'springboots' | 'elephant' | 'shield' | 'driver' | 'freeze'
  | 'tornado' | 'swap' | 'banana' | 'bouncy' | 'meteor'

export interface MoveInput {
  x: number // strafe -1..1
  y: number // forward -1..1
  yaw: number // heading the input is relative to
  jump: boolean
  dive: boolean
  creep: boolean
  /** Driving: the handbrake is held. */
  brake?: boolean
}

const want = new THREE.Vector3()
const stepV = new THREE.Vector3()

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
  spin = 0 // Banana Peel: spinning on your back
  /** Riding a golf cart (seat 0 drives, seat 1 is the passenger). */
  cart: Cart | null = null
  seat = 0
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
  peelCharges = 0 // banana peels left in the bunch
  driverArmed = false // Rocket Driver: the next full swing goes off at double power
  bouncyArmed = false // Bouncy Ball: the next shot is rubber
  ballFire = 0 // seconds of fire trail left on the ball

  // Hole stats for scoring.
  knockouts = 0
  victims = new Set<number>()
  waterKnocks = 0
  shieldBlocks = 0
  timedOut = false
  points = 0

  // AI scratch.
  ai = {
    plan: null as null | { dir: number; power: number; loft: number },
    think: 0,
    target: null as THREE.Vector3 | null,
    aimT: 0,
    itemT: 0,
    meleeT: 0,
    cartId: -1, // the parked cart this bot is walking to
    cartT: 0, // seconds until it next considers a cart
    stuck: 0,
    reverse: 0,
    driveT: 0,
    chase: null as Golfer | null,
    chaseT: 0,
    avoid: 0,
  }

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
    for (const k of ['stun', 'boost', 'shield', 'protect', 'dive', 'diveCooldown', 'swing', 'cooldown', 'frozen', 'spin'] as const) this[k] = Math.max(0, this[k] - dt)
    // In a cart: the cart carries you (the game seats you every frame).
    if (this.cart) {
      this.vel.set(0, 0, 0)
      this.kb.set(0, 0, 0)
      this.vy = 0
      this.leap = 0
      this.grounded = true
      this.air = 0
      return
    }
    // Ice: hard to start, hard to stop.
    const icy = this.grounded && ground.surface(this.pos.x, this.pos.z) === 'ice'

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
        want.set(dx / dl, 0, dz / dl).multiplyScalar(this.speed * len)
        this.vel.lerp(want, Math.min(1, dt * (icy ? 1.6 : 12)))
        const targetYaw = Math.atan2(dx, dz)
        let d = targetYaw - this.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        this.yaw += d * Math.min(1, dt * 14)
      } else this.vel.multiplyScalar(Math.max(0, 1 - dt * (icy ? 0.6 : 14)))
    } else if (this.dive <= 0) this.vel.multiplyScalar(Math.max(0, 1 - dt * (icy ? 0.6 : 10)))
    // Slipped on a banana: spin on the spot while you slide.
    if (this.spin > 0) this.yaw += dt * 14

    // Knockback decays over a short time.
    this.kb.multiplyScalar(Math.max(0, 1 - (dt / CONFIG.stun_knockback_time) * (icy ? 0.5 : 1.4)))
    const step = stepV.copy(this.vel).add(this.kb).multiplyScalar(dt)
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
    const myMove = this.vel.x * this.vel.x + this.vel.z * this.vel.z
    const mx = this.vel.x,
      mz = this.vel.z
    const ml = Math.hypot(mx, mz) || 1
    for (const o of others) {
      if (o === this || o.respawn > 0 || o.cart) continue
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z
      const r = CONFIG.player_radius * 2
      const d2 = dx * dx + dz * dz
      if (d2 < r * r && d2 > 1e-6) {
        const d = Math.sqrt(d2)
        this.pos.x += (dx / d) * (r - d) * 0.5
        this.pos.z += (dz / d) * (r - d) * 0.5
        // Sabotage: run into a rival to stagger them — a brief shock plus a shove the way you're moving.
        // Only when you're actually moving into them, and don't re-trigger while they're already stunned.
        if (myMove > 1.2 && o.stun <= 0 && !o.immune) {
          o.stun = CONFIG.body_check_stun
          o.stunTotal = CONFIG.body_check_stun
          o.kb.set((-dx / d) * CONFIG.body_check_shove, 0, (-dz / d) * CONFIG.body_check_shove)
          o.vel.multiplyScalar(0.3)
        }
      }
      // Sabotage: walk into a rival's resting ball to nudge it a little off its line (no power-up needed).
      const b = o.ball
      if (b.mode === 'rest') {
        const bx = this.pos.x - b.pos.x, bz = this.pos.z - b.pos.z
        const br = CONFIG.player_radius + CONFIG.ball_radius + 0.15
        const bd2 = bx * bx + bz * bz
        if (bd2 < br * br && myMove > 0.5) {
          // A gentle nudge — enough to throw their line off, not to send it across the hole.
          const sp = Math.min(CONFIG.ball_nudge_max, 1.4 + Math.sqrt(myMove) * 0.6)
          b.vel.set((mx / ml) * sp, 0, (mz / ml) * sp)
          b.mode = 'rolling'
        }
      }
    }

    // Vertical: jumping and falling off ledges.
    const gy = ground.y(this.pos.x, this.pos.z)
    this.vy -= CONFIG.jump_gravity * course.gravity * dt
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
