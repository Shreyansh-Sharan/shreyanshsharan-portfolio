// A toy in a round: a Rapier body (capsule, or a ball to ride in ball-mode levels) driven by a Pad, with the
// shared moves — run, jump, dive, grab, shove — plus stuns, tumbles and the sabotage bookkeeping.
import * as THREE from 'three'
import { G, RAPIER, TOY_GROUPS, groups, type Collider, type Phys, type RigidBody } from './physics'
import type { AnimKey, ToyRig } from './rig'
import type { Contestant } from './types'

/** Capsule: segment half-height and radius. The body origin is the capsule centre, 0.5 m above the feet. */
export const HALF = 0.2
export const RADIUS = 0.3
export const FOOT = HALF + RADIUS
export const BALL_R = 0.55
/** Ball mode: the ball's centre below the body origin (the toy stands on top of it). */
export const BALL_DROP = FOOT + BALL_R - 0.15

export const MOVE = {
  runSpeed: 5.6,
  groundAccel: 42,
  airAccel: 12,
  jumpVel: 8.4,
  diveSpeed: 9.5,
  diveUp: 4.2,
  diveCooldown: 1.1,
  shoveRange: 1.45,
  shoveCooldown: 0.55,
  shovePower: 7.5,
  grabRange: 1.25,
  ballAccel: 8.5,
  ballMax: 6,
  ballDash: 7.5,
}

export type BodyMode = 'walk' | 'ball' | 'seated'
export type ToyStatus = 'play' | 'qualified' | 'failed'

/** One toy's controls for a tick: from this screen's input, a remote player's input, or a bot. */
export interface Pad {
  /** Desired move direction in world space (x, z), length 0..1. */
  mx: number
  mz: number
  /** Camera yaw (for "in front" targeting when not moving). */
  yaw: number
  jump: boolean
  dive: boolean
  shove: boolean
  /** Held. */
  grab: boolean
  /** Level action key (R / Y): brush crumbs, wind the key, ... */
  act: boolean
  /** Pointer on the level's pointer plane (free-pointer levels like Cookie Cutter), and whether it is held. */
  px: number
  pz: number
  down: boolean
  emote: '' | 'wave' | 'dance' | 'stomp'
}

export function emptyPad(): Pad {
  return { mx: 0, mz: 0, yaw: 0, jump: false, dive: false, shove: false, grab: false, act: false, px: 0, pz: 0, down: false, emote: '' }
}

export function clearOneShots(p: Pad) {
  p.jump = p.dive = p.shove = p.act = false
  p.emote = ''
}

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

export interface ToyEvents {
  /** A toy was hit by another (shove, dive, grab throw): the engine records grudges and plays effects. */
  onHit(victim: Toy, by: Toy | null, kind: 'shove' | 'dive' | 'throw' | 'land' | 'hazard', power: number): void
  onJump(t: Toy): void
  onDive(t: Toy): void
  onWhiff(t: Toy): void
  /** target is null when an object (not a toy) was picked up. */
  onGrab(t: Toy, target: Toy | null): void
  onWriggle(t: Toy, from: Toy): void
}

export class Toy {
  readonly idx: number
  readonly c: Contestant
  readonly body: RigidBody
  readonly capsule: Collider
  ball: Collider | null = null
  rig: ToyRig | null = null
  /** True on the screen whose player this is. */
  isMe = false
  /** Driven by the bot hook (bots, players who left, or a test autopilot). */
  bot: boolean

  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  yaw = 0
  mode: BodyMode = 'walk'
  status: ToyStatus = 'play'
  /** When this toy qualified or failed (round time), for ordering. */
  doneAt = 0
  doneNote = ''
  pad: Pad = emptyPad()

  grounded = false
  airT = 0
  coyote = 0
  lastVy = 0
  stun = 0
  stunMax = 0
  dive = 0
  diveCd = 0
  flop = 0
  shoveCd = 0
  pushT = 0
  /** Seconds the host owns this toy's position (knocked, grabbed, teleported): online clients stop predicting. */
  forced = 0
  holding: Toy | null = null
  /** A loose object being carried (see LevelCtx.grabbable). */
  holdingProp: RigidBody | null = null
  grabbedBy: Toy | null = null
  escape = 0
  grabT = 0
  grabCd = 0
  emote: '' | 'wave' | 'dance' | 'stomp' = ''
  emoteT = 0
  /** Ball mode: ball popped (thumbtack) for this long; also scales control. */
  popped = 0
  /** Top running speed (the level can change it). */
  runSpeed = MOVE.runSpeed
  frozen = false
  /** Seat/hold position for seated levels. */
  seat: { x: number; y: number; z: number; yaw: number } | null = null
  spawn = { x: 0, y: 1, z: 0, yaw: 0 }
  private dived: Set<Toy> = new Set()

  /* ---------- Sabotage ---------- */
  sprinkles = 0
  /** Seconds left before this toy can act again after a trick (needle lifted, paws busy). */
  busy = 0
  cooldowns = new Map<string, number>()
  usedOnce = new Set<string>()
  /** The last toy that hit this one (shown with a red stitch on this toy's screen); revenge is half price. */
  grudge: Toy | null = null
  /** Bubble Wrap: blocks and reflects the next trick. */
  bubble = false

  /** Per-level scratch space (and bot memory). Not synced: put synced fields in the level state. */
  data: Record<string, unknown> = {}
  /** Animation code chosen by the simulation (and sent to clients). */
  anim: AnimKey = 'idle'
  /** A level can force an animation (a board hops seated toys tile to tile). null: picked from movement. */
  pose: AnimKey | null = null

  constructor(phys: Phys, idx: number, c: Contestant, pos: THREE.Vector3Like, yaw: number, kinematic: boolean) {
    this.idx = idx
    this.c = c
    this.bot = !c.human
    this.yaw = yaw
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(pos.x, pos.y, pos.z)
      .lockRotations()
      .setCcdEnabled(true)
      .setLinearDamping(0)
    this.body = phys.world.createRigidBody(desc)
    this.body.userData = { toy: idx }
    const cd = RAPIER.ColliderDesc.capsule(HALF, RADIUS).setFriction(0).setRestitution(0.15).setDensity(1).setCollisionGroups(TOY_GROUPS)
    cd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
    this.capsule = phys.world.createCollider(cd, this.body)
    this.body.setAdditionalMass(0.6, true)
    this.pos.set(pos.x, pos.y, pos.z)
    this.spawn = { x: pos.x, y: pos.y, z: pos.z, yaw }
  }

  get name() {
    return this.c.name
  }
  get active() {
    return this.status === 'play'
  }
  get feet() {
    return this.pos.y - (this.mode === 'ball' ? BALL_DROP + BALL_R : FOOT)
  }
  /** Facing as a unit vector on the ground. */
  facing(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }
  get canAct() {
    return this.status !== 'failed' && this.stun <= 0 && !this.grabbedBy && this.flop <= 0 && !this.frozen
  }

  setMode(phys: Phys, mode: BodyMode) {
    if (mode === this.mode) return
    if (this.ball) {
      phys.world.removeCollider(this.ball, true)
      this.ball = null
    }
    if (mode === 'ball') {
      const bd = RAPIER.ColliderDesc.ball(BALL_R).setTranslation(0, -BALL_DROP, 0).setFriction(0).setRestitution(0.45).setDensity(0.6).setCollisionGroups(TOY_GROUPS)
      bd.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      // No friction: the controller rolls the ball (rotations stay locked so the toy rides upright).
      bd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      this.ball = phys.world.createCollider(bd, this.body)
      this.body.setTranslation({ x: this.pos.x, y: this.pos.y + BALL_DROP, z: this.pos.z }, true)
      this.pos.y += BALL_DROP
    }
    if (mode === 'seated') this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    else if (this.mode === 'seated') this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    this.mode = mode
  }

  /** Make this body a puppet moved by snapshots (online clients) or a real dynamic body. */
  setPuppet(puppet: boolean) {
    const want = puppet ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic
    if (this.body.bodyType() !== want && this.mode !== 'seated') this.body.setBodyType(want, true)
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw) {
    this.body.setTranslation({ x, y, z }, true)
    if (!this.body.isKinematic()) this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    else this.body.setNextKinematicTranslation({ x, y, z })
    this.pos.set(x, y, z)
    this.vel.set(0, 0, 0)
    this.yaw = yaw
    this.forced = Math.max(this.forced, 0.4)
  }

  /** Add velocity and a stun. Drops whatever it held. */
  knock(dx: number, dy: number, dz: number, stun: number) {
    if (this.status === 'failed' && this.mode !== 'walk') return
    const v = this.body.linvel()
    this.body.setLinvel({ x: v.x + dx, y: Math.max(v.y, 0) + dy, z: v.z + dz }, true)
    this.vel.set(v.x + dx, Math.max(v.y, 0) + dy, v.z + dz)
    if (stun > 0) {
      this.stun = Math.max(this.stun, stun)
      this.stunMax = Math.max(this.stun, this.stunMax)
      this.emote = ''
    }
    this.forced = Math.max(this.forced, 0.35 + stun)
    this.release(false)
    this.dive = 0
  }

  release(toss: boolean) {
    const prop = this.holdingProp
    if (prop) {
      this.holdingProp = null
      this.grabCd = 0.5
      if (toss) {
        const f = this.facing(_v)
        prop.setLinvel({ x: f.x * 7 + this.vel.x * 0.5, y: 4.5, z: f.z * 7 + this.vel.z * 0.5 }, true)
      }
    }
    const t = this.holding
    if (!t) return
    this.holding = null
    t.grabbedBy = null
    t.escape = 0
    this.grabCd = 0.5
    if (toss) {
      const f = this.facing(_v)
      t.body.setLinvel({ x: f.x * 6.5 + this.vel.x * 0.5, y: 4, z: f.z * 6.5 + this.vel.z * 0.5 }, true)
      t.stun = Math.max(t.stun, 0.45)
      t.forced = Math.max(t.forced, 0.8)
    }
  }

  /**
   * One fixed step of movement, before the physics step. `locked` freezes input (intro, countdown, frozen
   * levels). `others` are the toys this one can shove, dive into or grab; `grabbables` are loose objects
   * (dynamic bodies a level registered with ctx.grabbable) it can pick up and throw.
   */
  preStep(dt: number, _phys: Phys, others: readonly Toy[], ev: ToyEvents, locked: boolean, grabbables: readonly RigidBody[] = []) {
    const b = this.body
    if (b.isKinematic()) {
      if (this.mode === 'seated' && this.seat) b.setNextKinematicTranslation({ x: this.seat.x, y: this.seat.y, z: this.seat.z })
      return
    }
    this.stun = Math.max(0, this.stun - dt)
    if (this.stun <= 0) this.stunMax = 0
    this.diveCd = Math.max(0, this.diveCd - dt)
    this.shoveCd = Math.max(0, this.shoveCd - dt)
    this.pushT = Math.max(0, this.pushT - dt)
    this.flop = Math.max(0, this.flop - dt)
    this.forced = Math.max(0, this.forced - dt)
    this.grabCd = Math.max(0, this.grabCd - dt)
    this.popped = Math.max(0, this.popped - dt)
    this.busy = Math.max(0, this.busy - dt)
    if (this.emoteT > 0) {
      this.emoteT -= dt
      if (this.emoteT <= 0) this.emote = ''
    }
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, Math.max(0, v - dt))

    const p = this.pad
    const control = !locked && this.canAct && this.status !== 'failed'
    const mx = control ? p.mx : 0
    const mz = control ? p.mz : 0
    const lv = b.linvel()
    let vx = lv.x, vy = lv.y, vz = lv.z

    if (this.mode === 'ball') {
      const k = this.popped > 0 ? 0.25 : 1
      vx += mx * MOVE.ballAccel * k * dt
      vz += mz * MOVE.ballAccel * k * dt
      const sp = Math.hypot(vx, vz)
      const max = MOVE.ballMax * (this.popped > 0 ? 0.5 : 1)
      if (sp > max && this.stun <= 0) {
        vx *= max / sp
        vz *= max / sp
      }
      if (Math.hypot(mx, mz) < 0.05 && this.grounded) {
        // Rolling resistance when nobody steers (also while dazed), so a hit ball slows instead of gliding off.
        const d = Math.max(0, 1 - 1.5 * dt)
        vx *= d
        vz *= d
      }
      if (control && p.jump && this.grounded) {
        vy = 6.5
        ev.onJump(this)
      }
      if (control && p.dive && this.diveCd <= 0) {
        const f = Math.hypot(mx, mz) > 0.2 ? _v.set(mx, 0, mz).normalize() : this.facing(_v)
        vx = f.x * MOVE.ballDash * (this.popped > 0 ? 0.5 : 1)
        vz = f.z * MOVE.ballDash * (this.popped > 0 ? 0.5 : 1)
        this.diveCd = 2.2
        this.dive = 0.5
        this.dived.clear()
        ev.onDive(this)
      }
      this.dive = Math.max(0, this.dive - dt)
    } else {
      const speed = this.runSpeed * (this.holding ? 0.6 : this.holdingProp ? 0.8 : 1) * (this.grabbedBy ? 0.2 : 1)
      if (this.dive > 0) {
        // Committed: no steering mid-dive, a little drag.
        this.dive -= dt
        if (this.grounded && this.airT === 0 && this.dive < 0.75) {
          this.dive = 0
          this.flop = 0.45
          this.kickLand(ev)
        }
      } else if (this.flop > 0) {
        // Belly slide.
        const d = Math.max(0, 1 - 7 * dt)
        vx *= d
        vz *= d
      } else {
        const accel = (this.grounded ? MOVE.groundAccel : MOVE.airAccel) * (this.stun > 0 ? 0.15 : 1)
        const tx = mx * speed, tz = mz * speed
        const dx = tx - vx, dz = tz - vz
        const dl = Math.hypot(dx, dz)
        const step = accel * dt
        if (dl > 1e-4) {
          const k = Math.min(1, step / dl)
          vx += dx * k
          vz += dz * k
        }
      }
      if (control && p.jump && (this.grounded || this.coyote > 0) && this.dive <= 0) {
        vy = MOVE.jumpVel
        this.coyote = 0
        this.grounded = false
        this.emote = ''
        ev.onJump(this)
      }
      if (control && p.dive && this.diveCd <= 0 && this.dive <= 0) {
        const f = Math.hypot(mx, mz) > 0.2 ? _v.set(mx, 0, mz).normalize() : this.facing(_v)
        vx = f.x * MOVE.diveSpeed
        vz = f.z * MOVE.diveSpeed
        vy = Math.max(vy, this.grounded ? MOVE.diveUp : 2.5)
        this.yaw = Math.atan2(f.x, f.z)
        this.dive = 0.95
        this.diveCd = MOVE.diveCooldown
        this.emote = ''
        this.dived.clear()
        this.release(true)
        ev.onDive(this)
      }
    }

    // Face the way we move.
    const msp = Math.hypot(mx, mz)
    if (msp > 0.15 && this.dive <= 0 && this.stun <= 0) {
      const want = Math.atan2(mx, mz)
      let d = want - this.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.yaw += d * Math.min(1, dt * 14)
    }
    if (msp > 0.15) this.emote = ''
    if (control && p.emote) {
      this.emote = p.emote
      this.emoteT = p.emote === 'dance' ? 8 : p.emote === 'wave' ? 3.2 : 1.4
    }

    // Shove: a short-range push in front.
    if (control && p.shove && this.shoveCd <= 0 && !this.holding) {
      this.shoveCd = MOVE.shoveCooldown
      this.pushT = 0.5
      this.emote = ''
      const f = this.facing(_v)
      let hit = false
      const range = this.mode === 'ball' ? MOVE.shoveRange + 0.6 : MOVE.shoveRange
      for (const o of others) {
        if (o === this || o.status === 'failed' || o.mode === 'seated') continue
        _w.subVectors(o.pos, this.pos)
        _w.y = 0
        const d = _w.length()
        if (d > range || d < 1e-3) continue
        if (_w.dot(f) / d < 0.35) continue
        _w.divideScalar(d)
        const pow = MOVE.shovePower * (o.mode === 'ball' ? 0.7 : 1) * (o.dive > 0 ? 0.5 : 1)
        o.knock(_w.x * pow, o.mode === 'ball' ? 1.5 : 3.2, _w.z * pow, o.mode === 'ball' ? 0.15 : 0.55)
        ev.onHit(o, this, 'shove', pow)
        hit = true
      }
      // Recoil.
      vx -= f.x * (hit ? 1.5 : 0)
      vz -= f.z * (hit ? 1.5 : 0)
      if (!hit) ev.onWhiff(this)
    }

    // Dive into someone: they tumble.
    if (this.dive > 0) {
      for (const o of others) {
        if (o === this || o.status === 'failed' || o.mode === 'seated' || this.dived.has(o)) continue
        const d = o.pos.distanceTo(this.pos)
        if (d > (this.mode === 'ball' ? 1.5 : 0.95)) continue
        this.dived.add(o)
        _w.subVectors(o.pos, this.pos).setY(0).normalize()
        const pow = this.mode === 'ball' ? 3.5 : 7.5
        o.knock(_w.x * pow, 3, _w.z * pow, this.mode === 'ball' ? 0.25 : 1.1)
        ev.onHit(o, this, 'dive', pow)
        if (this.mode !== 'ball') {
          vx *= 0.3
          vz *= 0.3
        }
      }
    }

    // Grab: hold the toy (or loose object) in front while the key is held.
    if (control && p.grab && !this.holding && !this.holdingProp && this.grabCd <= 0 && this.mode === 'walk') {
      const f = this.facing(_v)
      let best: Toy | null = null
      let bestD = MOVE.grabRange
      for (const o of others) {
        if (o === this || o.status === 'failed' || o.mode !== 'walk' || o.grabbedBy || o.holding === this) continue
        _w.subVectors(o.pos, this.pos)
        _w.y = 0
        const d = _w.length()
        if (d < bestD && _w.dot(f) / Math.max(d, 1e-3) > 0.2) {
          best = o
          bestD = d
        }
      }
      if (best) {
        this.holding = best
        best.grabbedBy = this
        best.escape = 0
        best.emote = ''
        this.grabT = 0
        ev.onGrab(this, best)
      } else {
        // No toy in reach: a loose object?
        let prop: RigidBody | null = null
        let pd = MOVE.grabRange + 0.3
        for (const g of grabbables) {
          const gp = g.translation()
          _w.set(gp.x - this.pos.x, 0, gp.z - this.pos.z)
          const d = _w.length()
          if (d < pd && Math.abs(gp.y - this.pos.y) < 1.4 && _w.dot(f) / Math.max(d, 1e-3) > 0.2 && !others.some((o) => o.holdingProp === g)) {
            prop = g
            pd = d
          }
        }
        if (prop) {
          this.holdingProp = prop
          this.grabT = 0
          ev.onGrab(this, null)
        } else this.grabCd = 0.4
      }
    }
    if (this.holdingProp) {
      const g = this.holdingProp
      this.grabT += dt
      if (!p.grab || !control) this.release(this.grabT > 0.15 && control)
      else {
        const f = this.facing(_v)
        const gp = g.translation()
        g.setLinvel({ x: (this.pos.x + f.x * 0.85 - gp.x) * 12 + vx * 0.6, y: (this.pos.y + 0.45 - gp.y) * 10, z: (this.pos.z + f.z * 0.85 - gp.z) * 12 + vz * 0.6 }, true)
      }
    }
    if (this.holding) {
      const t = this.holding
      this.grabT += dt
      if (!p.grab || !control || t.status === 'failed' || this.grabT > 3.2) this.release(this.grabT > 0.15 && control)
      else {
        const f = this.facing(_v)
        const hx = this.pos.x + f.x * 0.8, hz = this.pos.z + f.z * 0.8, hy = this.pos.y + 0.3
        const tv = t.body.linvel()
        t.body.setLinvel({ x: (hx - t.pos.x) * 12 + vx * 0.5, y: Math.max(tv.y, (hy - t.pos.y) * 10), z: (hz - t.pos.z) * 12 + vz * 0.5 }, true)
        t.forced = Math.max(t.forced, 0.3)
      }
    }
    if (this.grabbedBy) {
      // Wriggle free by mashing directions and jump.
      const pp = this.pad
      this.escape += (Math.hypot(pp.mx, pp.mz) > 0.5 ? 0.55 : 0) * dt + (pp.jump ? 0.28 : 0) + (pp.dive ? 0.2 : 0)
      if (this.escape >= 1) {
        const g = this.grabbedBy
        g.release(false)
        g.stun = Math.max(g.stun, 0.4)
        ev.onWriggle(this, g)
      }
    }

    b.setLinvel({ x: vx, y: vy, z: vz }, true)
  }

  private kickLand(ev: ToyEvents) {
    ev.onHit(this, null, 'land', 0)
  }

  /** After the physics step: read back position and velocity, ground contact. */
  postStep(dt: number, phys: Phys, ev: ToyEvents) {
    const t = this.body.translation()
    const v = this.body.linvel()
    this.pos.set(t.x, t.y, t.z)
    this.vel.set(v.x, v.y, v.z)
    if (this.body.isKinematic()) return
    const filter = groups(0xffff, G.WORLD | G.PROP | G.TOY)
    let g: number
    if (this.mode === 'ball') {
      _v.set(t.x, t.y - BALL_DROP, t.z)
      g = phys.cast(_v, { x: 0, y: -1, z: 0 }, BALL_R + 0.12, filter, this.body)
    } else g = phys.cast(this.pos, { x: 0, y: -1, z: 0 }, FOOT + 0.12, filter, this.body)
    const wasGrounded = this.grounded
    this.grounded = g >= 0 && v.y < 3
    if (this.grounded) {
      this.coyote = 0.12
      if (!wasGrounded && this.lastVy < -15 && this.mode === 'walk' && this.dive <= 0) {
        // A long fall: a comic flop.
        this.stun = Math.max(this.stun, 0.6)
        ev.onHit(this, null, 'land', -this.lastVy)
      }
      this.airT = 0
    } else {
      this.coyote = Math.max(0, this.coyote - dt)
      this.airT += dt
    }
    this.lastVy = v.y
  }

  /** What the rig should play (computed where the simulation runs, sent to clients for other toys). */
  pickAnim(): AnimKey {
    if (this.pose) return this.pose
    if (this.grabbedBy) return 'held'
    if (this.stun > 0.25 || this.flop > 0) return this.dive > 0 || this.flop > 0 ? 'dive' : 'knock'
    if (this.dive > 0 && this.mode === 'walk') return 'dive'
    if (this.holding) return 'grab'
    if (this.pushT > 0) return 'push'
    if (this.mode === 'seated') return this.status === 'qualified' ? 'cheer' : 'sit'
    if (!this.grounded && this.airT > 0.12 && this.mode === 'walk') return 'jump'
    const sp = Math.hypot(this.vel.x, this.vel.z)
    if (this.mode === 'walk' && sp > 0.7) return 'run'
    if (this.status === 'qualified') return 'cheer'
    if (this.emote) return this.emote
    return 'idle'
  }
}
