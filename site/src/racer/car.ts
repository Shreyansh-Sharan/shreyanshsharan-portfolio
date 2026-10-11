// A car: arcade handling (kinematic with lateral slip and a drift state), health, the power-up bay and race progress.
import * as THREE from 'three'
import { CONFIG, kmh } from './config'
import { buildCarMesh, topSpeedKmh, type CarClass, type CarMesh, type CarModel, type Driver } from './cars'
import type { PowerType, Track } from './track'

export interface BaySlot {
  type: PowerType
  count: number
}

export interface CarInput {
  throttle: number // 0..1
  brake: number // 0..1
  steer: number // -1 (left) .. 1 (right)
  handbrake: boolean
}

export type StunKind = 'spin' | 'flip' | 'none'

const WHEELBASE = 2.6
const HALF_WIDTH = 1.0

export class Car {
  readonly id: number
  readonly isPlayer: boolean
  readonly name: string
  readonly model: CarModel
  readonly driver?: Driver
  skill: number
  readonly mesh: CarMesh
  readonly label: THREE.Sprite | null
  private labelCtx: CanvasRenderingContext2D | null = null
  private labelTex: THREE.CanvasTexture | null = null
  private labelHealth = -1

  // Physics.
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  yaw = 0
  yawRate = 0
  readonly input: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false }
  baseTop: number // m/s
  accel: number // m/s²
  latMax: number // m/s²
  gripRate: number // 1/s
  rubber = 1
  topCap = Infinity

  // State.
  health: number = CONFIG.max_health
  shield = 0
  invuln = 0
  stun = 0
  stunKind: StunKind = 'none'
  stunTotal = 0
  steerKick = 0
  steerKickDir = 1
  nitro = 0
  boost = 0
  bog = 0
  airBrake = 0
  airBrakeResume = 0
  drifting = false
  driftTime = 0
  driftDist = 0
  driftClean = true
  driftFanAcc = 0
  wrecked = 0
  flash = 0
  flashColor = new THREE.Color()
  wallCooldown = 0
  stuckTime = 0
  sinceRespawn = 99
  lastWreckedBy: Car | null = null

  // Bay.
  bay: (BaySlot | null)[] = [null, null, null]
  active = 0

  // Track progress.
  hint = -1
  s = 0
  lateral = 0
  lap = 0
  cpPassed = 0
  safeS = 0
  progress = 0
  place = 1
  finished = false
  finishTime = 0

  // Stats for awards and scoring.
  hits = 0
  shuntHits = 0
  wrecksDealt = 0
  wrecksTaken = 0
  damageTaken = 0
  longestDrift = 0
  combat = 0
  chainMult = 1
  lastWreckAt = -99

  // AI scratch.
  ai = { laneOffset: 0, think: 0, avoid: 0, pickupLat: 0, swerve: 0, boltTimer: 0, launchPerfect: false }

  constructor(
    id: number,
    model: CarModel,
    opts: { player?: boolean; name: string; driver?: Driver; skill?: number; cls?: CarClass; glb?: THREE.Object3D | null },
  ) {
    this.id = id
    this.isPlayer = !!opts.player
    this.name = opts.name
    this.model = model
    this.driver = opts.driver
    this.skill = opts.skill ?? 0.6
    this.mesh = buildCarMesh(model, opts.glb)
    this.baseTop = kmh(topSpeedKmh(model, opts.cls ?? model.cls))
    this.accel = 5 + model.stats.accel * 0.75
    this.latMax = 13 + model.stats.grip * 1.1
    this.gripRate = 7 + model.stats.grip * 0.5
    if (!this.isPlayer) {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 64
      this.labelCtx = c.getContext('2d')
      this.labelTex = new THREE.CanvasTexture(c)
      this.labelTex.colorSpace = THREE.SRGBColorSpace
      this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, depthWrite: false, transparent: true, toneMapped: false }))
      this.label.scale.set(4.4, 1.1, 1)
      this.label.position.y = 2.9
      this.label.renderOrder = 10
      this.mesh.root.add(this.label)
      this.drawLabel()
    } else this.label = null
  }

  get personality() {
    return this.driver?.personality ?? 'Racer'
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  get right() {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
  }

  get speed() {
    return this.vel.length()
  }

  get forwardSpeed() {
    return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)
  }

  get top() {
    return Math.min(this.baseTop * this.rubber, this.topCap)
  }

  get alive() {
    return this.wrecked <= 0
  }

  /** Small name + health bar above rival cars. */
  drawLabel() {
    const g = this.labelCtx
    if (!g || !this.labelTex) return
    const h = Math.max(0, Math.ceil(this.health))
    if (h === this.labelHealth) return
    this.labelHealth = h
    g.clearRect(0, 0, 256, 64)
    g.font = '700 22px system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillStyle = '#ffffff'
    g.shadowColor = '#000'
    g.shadowBlur = 6
    g.fillText(this.name.toUpperCase(), 128, 22)
    g.shadowBlur = 0
    const frac = h / CONFIG.max_health
    const col = frac > CONFIG.smoke_below ? '#4ade80' : frac > CONFIG.fire_below ? '#facc15' : '#ef4444'
    for (let i = 0; i < CONFIG.max_health; i++) {
      g.fillStyle = i < h ? col : 'rgba(255,255,255,0.18)'
      g.fillRect(38 + i * 18, 34, 15, 12)
    }
    this.labelTex.needsUpdate = true
  }

  /* ---------- Bay ---------- */

  /** Add a pickup. Same type stacks; a full bay refuses it. */
  give(type: PowerType) {
    for (const slot of this.bay) {
      if (slot && slot.type === type && slot.count < CONFIG.bay_stack_max) {
        slot.count++
        return true
      }
    }
    const free = this.bay.findIndex((s) => !s)
    if (free < 0) return false
    this.bay[free] = { type, count: 1 }
    if (!this.bay[this.active]) this.active = free
    return true
  }

  cycle() {
    for (let k = 1; k <= 3; k++) {
      const i = (this.active + k) % 3
      if (this.bay[i]) {
        this.active = i
        return true
      }
    }
    return false
  }

  discard() {
    if (!this.bay[this.active]) return false
    this.bay[this.active] = null
    this.cycle()
    return true
  }

  /** Take one from a slot (the active one by default). */
  consume(i = this.active) {
    const slot = this.bay[i]
    if (!slot) return null
    slot.count--
    if (slot.count <= 0) {
      this.bay[i] = null
      if (i === this.active) this.cycle()
    }
    return slot.type
  }

  slotOf(type: PowerType) {
    return this.bay.findIndex((s) => s?.type === type)
  }

  /* ---------- Physics ---------- */

  step(dt: number, track: Track) {
    this.sinceRespawn += dt
    this.invuln = Math.max(0, this.invuln - dt)
    this.shield = Math.max(0, this.shield - dt)
    this.steerKick = Math.max(0, this.steerKick - dt)
    this.nitro = Math.max(0, this.nitro - dt)
    this.boost = Math.max(0, this.boost - dt)
    this.bog = Math.max(0, this.bog - dt)
    this.flash = Math.max(0, this.flash - dt * 2.5)
    this.wallCooldown = Math.max(0, this.wallCooldown - dt)
    if (this.stun > 0) {
      this.stun = Math.max(0, this.stun - dt)
      if (this.stun === 0) this.stunKind = 'none'
    }

    if (this.wrecked > 0) {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 1.8))
      this.pos.addScaledVector(this.vel, dt)
      return
    }

    const inp = this.input
    let thr = inp.throttle, brk = inp.brake, st = inp.steer
    let hb = inp.handbrake
    if (this.stun > 0) {
      thr = 0
      brk = 0.3
      st = 0
      hb = false
    }
    if (this.steerKick > 0) st = THREE.MathUtils.clamp(st + this.steerKickDir * 0.9, -1, 1)

    // Reverse Nitro: drop to a crawl for a moment, then return to (most of) the previous speed.
    if (this.airBrake > 0) {
      this.airBrake -= dt
      const f = this.forward
      const sp = kmh(CONFIG.reverse_nitro_speed)
      this.vel.copy(f).multiplyScalar(sp)
      if (this.airBrake <= 0) this.vel.copy(this.forward).multiplyScalar(this.airBrakeResume * 0.9)
    }

    const nitroOn = this.nitro > 0
    const top = this.top * (nitroOn ? CONFIG.nitro_topspeed_mult : 1) * (this.boost > 0 ? 1.08 : 1)
    const acc = this.accel * (nitroOn ? CONFIG.nitro_accel_mult : 1) * (this.boost > 0 ? 1.6 : 1) * (this.bog > 0 ? 0.35 : 1)

    // Rotate first; the velocity keeps its world direction, so turning creates slip that grip then removes.
    const fwd0 = this.forwardSpeed
    const spd = Math.abs(fwd0)
    const steerAngle = 0.6 * (1 - 0.55 * Math.min(1, spd / Math.max(1, this.baseTop)))
    let targetYaw = (-st * spd * Math.tan(steerAngle)) / WHEELBASE * Math.sign(fwd0 || 1)
    const yawCap = (this.drifting ? this.latMax * 1.55 : this.latMax) / Math.max(spd, 6)
    targetYaw = THREE.MathUtils.clamp(targetYaw, -Math.min(2.6, yawCap * 1.0), Math.min(2.6, yawCap * 1.0))
    if (this.drifting) targetYaw *= 1.25
    if (this.airBrake > 0) targetYaw *= 1.6
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, dt * (this.drifting ? 6 : 10))
    this.yaw += this.yawRate * dt

    const f = this.forward, r = this.right
    let vf = this.vel.dot(f)
    let vl = this.vel.dot(r)

    // Engine, brakes, drag.
    if (thr > 0) {
      if (vf < top) vf += acc * thr * Math.max(0.05, 1 - (vf / top) ** 2) * dt
      else vf -= (vf - top) * 1.2 * dt
    } else vf -= vf * 0.18 * dt
    if (vf > top * 1.02 && !nitroOn) vf -= (vf - top) * 1.5 * dt
    if (brk > 0) {
      if (vf > 0.5) vf = Math.max(0, vf - 30 * brk * dt)
      else vf = Math.max(-12, vf - 9 * brk * dt)
    }
    if (hb) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 5 * dt)

    // Drift state: handbrake or a sharp turn at speed starts it; grip drops; a clean exit gives a mini-boost.
    const driftStat = this.model.stats.drift
    if (!this.drifting && vf > 12) {
      const sharp = Math.abs(st) > 0.85 && vf > (0.95 - driftStat * 0.035) * this.baseTop
      if (hb || sharp) {
        this.drifting = true
        this.driftTime = 0
        this.driftDist = 0
        this.driftClean = true
        // Kick the tail out.
        vl += -Math.sign(st || this.yawRate || 1) * Math.min(6, vf * 0.12)
      }
    }
    if (this.drifting) {
      this.driftTime += dt
      this.driftDist += Math.abs(vf) * dt
      const slip = Math.abs(Math.atan2(vl, Math.max(1, vf)))
      const hold = 0.1 + driftStat * 0.012
      if (vf < 8 || (!hb && slip < hold && this.driftTime > 0.35)) {
        if (vf >= 8 && this.driftClean && this.driftTime > 0.6) this.boost = Math.max(this.boost, CONFIG.drift_exit_boost)
        this.longestDrift = Math.max(this.longestDrift, this.driftDist)
        this.drifting = false
      }
    }

    // Tyres: lateral friction capped by grip (lower while drifting).
    const gripMul = this.drifting ? CONFIG.drift_grip_mult * (1.25 - driftStat * 0.05) : 1
    const cap = this.latMax * (this.drifting ? 0.85 : 1)
    const want = vl * (1 - Math.exp(-this.gripRate * gripMul * 2.5 * dt))
    const maxDelta = cap * dt
    vl -= THREE.MathUtils.clamp(want, -maxDelta, maxDelta)
    if (this.drifting) vf -= Math.abs(vl) * 0.12 * dt

    this.vel.copy(f).multiplyScalar(vf).addScaledVector(r, vl)
    this.pos.addScaledVector(this.vel, dt)
    this.pos.y = 0

    this.walls(track)
  }

  /** Keep the car between the barriers. Returns the impact speed into the wall (0 if none). */
  private walls(track: Track) {
    const n = track.nearest(this.pos.x, this.pos.z, this.hint)
    this.hint = n.i
    this.lateral = n.lateral
    const limit = track.half - HALF_WIDTH
    this.wallImpact = 0
    if (Math.abs(n.lateral) <= limit) return
    const sign = Math.sign(n.lateral)
    const nx = -track.tz[n.i] * sign, nz = track.tx[n.i] * sign
    const over = Math.abs(n.lateral) - limit
    this.pos.x -= nx * over
    this.pos.z -= nz * over
    const vn = this.vel.x * nx + this.vel.z * nz
    if (vn > 0) {
      this.vel.x -= nx * vn * 1.35
      this.vel.z -= nz * vn * 1.35
      this.vel.multiplyScalar(1 - Math.min(0.45, vn * 0.025))
      this.wallImpact = vn
      if (vn > 3) this.driftClean = false
    }
  }

  wallImpact = 0

  /* ---------- Visuals ---------- */

  syncMesh(dt: number, time: number) {
    const m = this.mesh
    m.root.position.copy(this.pos)
    m.root.rotation.y = this.yaw
    const body = m.body
    // Lean into corners, nose dip under braking.
    const lean = THREE.MathUtils.clamp(this.yawRate * this.speed * 0.004, -0.09, 0.09)
    body.rotation.z += (lean - body.rotation.z) * Math.min(1, dt * 8)
    const pitch = this.input.brake > 0 && this.forwardSpeed > 2 ? 0.035 : this.input.throttle > 0 ? -0.015 : 0
    body.rotation.x += (pitch - body.rotation.x) * Math.min(1, dt * 6)
    // Stun animations: spin-out or a flip.
    if (this.stun > 0 && this.stunKind !== 'none') {
      const k = 1 - this.stun / this.stunTotal
      const ease = 1 - (1 - k) ** 2
      if (this.stunKind === 'spin') {
        body.rotation.y = ease * Math.PI * 4
        body.position.y = 0
      } else {
        body.rotation.y = 0
        body.rotation.z = ease * Math.PI * 2
        body.position.y = Math.sin(k * Math.PI) * 2.6
      }
    } else if (this.drifting) {
      const slip = Math.atan2(this.vel.dot(this.right), Math.max(1, this.forwardSpeed))
      body.rotation.y += (-slip * 0.25 - body.rotation.y) * Math.min(1, dt * 6)
      body.position.y = 0
    } else {
      body.rotation.y *= Math.max(0, 1 - dt * 8)
      body.position.y = 0
    }
    if (this.wrecked > 0) {
      body.position.y = Math.max(0, body.position.y + this.wreckVy * dt)
      this.wreckVy -= 18 * dt
      body.rotation.x += dt * 3
      body.rotation.z += dt * 2
    }
    const spin = this.forwardSpeed * dt / 0.36
    for (const w of m.wheels) w.rotation.x += spin
    m.brake.color.setRGB(1, 0.1, 0.24).multiplyScalar(this.input.brake > 0 ? 4 : 1.4)
    m.shield.visible = this.shield > 0
    if (m.shield.visible) m.shield.rotation.y = time * 2
    // Blink while invulnerable.
    m.root.visible = this.invuln > 0 && this.wrecked <= 0 ? Math.floor(time * 14) % 2 === 0 : true
    // Flash the attacker's colour on impact; char when wrecked.
    for (const mat of m.paint) {
      if (this.wrecked > 0) mat.emissive.setRGB(0.25 + Math.random() * 0.2, 0.07, 0)
      else if (this.flash > 0) mat.emissive.copy(this.flashColor).multiplyScalar(this.flash * 1.5)
      else mat.emissive.setRGB(0, 0, 0)
    }
    if (this.label) this.drawLabel()
  }

  wreckVy = 0

  /** Put the car back on the racing line at `s`. */
  placeAt(track: Track, s: number, lateral: number) {
    const p = track.point(s, lateral)
    this.pos.set(p.x, 0, p.z)
    this.yaw = track.heading(s)
    this.yawRate = 0
    this.hint = track.index(s)
    const n = track.nearest(p.x, p.z, this.hint)
    this.hint = n.i
    this.lateral = lateral
    this.mesh.body.rotation.set(0, 0, 0)
    this.mesh.body.position.set(0, 0, 0)
  }
}
