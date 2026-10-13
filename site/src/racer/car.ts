// A car: arcade handling (a rate-limited wheel drives the yaw straight off a bicycle model, capped by grip; sideways
// slip dies away rather than being clamped, so the car slides a touch through fast corners and always recovers;
// a drift state lets the tail hang out), health, the power-up bay and race progress.
import * as THREE from 'three'
import { CONFIG, kmh } from './config'
import { buildCarMesh, topSpeedKmh, type CarClass, type CarMesh, type CarModel, type Driver } from './cars'
import { newLoc, type PowerType, type Track } from './track'
import { bowlHeight, bowlSlope, type ArenaLayout } from './arena'

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
const BOWL_CAR_R = 1.6 // collision radius against the bowl's rim and obstacles
const STEER_MAX = 0.55 // rad of wheel at a standstill (a 4.2 m turning radius)
const STEER_RATE = 3.6 // rad/s the wheel turns towards the stick
const BRAKE = 32 // m/s²
const REVERSE_ACCEL = 9 // m/s²
const REVERSE_TOP = 12 // m/s
const ROLL = 1.2 // rolling resistance (m/s²)
const qTilt = new THREE.Quaternion()
const tiltAxis = new THREE.Vector3()
const GRAVITY = CONFIG.jump_gravity

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
  yawRate = 0 // rad/s this step (steering plus any spin from a hit)
  wheel = 0 // rad, + = left; follows the stick at STEER_RATE through a range that narrows with speed
  yawKick = 0 // rad/s of spin from a jolt, dying away
  readonly input: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false }
  baseTop: number // m/s
  accel: number // m/s² off the line; the pull fades linearly to nothing at top speed
  latMax: number // m/s² of cornering grip: caps the yaw rate at speed
  gripRate: number // 1/s sideways slip dies away (lower = more slide through fast corners)
  steerFast: number // rad of wheel at top speed: full lock there is just past the grip cap, so the stick maps to lateral g
  drag: number // quadratic drag so lifting off bleeds speed, set so a car on full throttle still reaches its top
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
  ram = 0 // s of Ram armour left
  ramBoost = false // forward Ram (overdrive) rather than the backward brace
  railCharge = 0 // s until a charging Railgun fires
  railBack = false
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

  // Who drives it, and multiplayer bookkeeping.
  controller: 'local' | 'remote' | 'ai' = 'ai'
  remoteId: string | null = null
  human = false
  fans = 0
  fanTargetMet = false
  boltHold: { backward: boolean; t: number; next: number } | null = null
  readonly net = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, t: -1 }

  // Bay.
  bay: (BaySlot | null)[] = [null, null, null]
  active = 0

  // The Dust Bowl, when racing in one (visual ground height and bank tilt).
  arena: ArenaLayout | null = null
  groundY = 0
  // A circuit with hills: the body follows the road's height, pitched to its slope, and flies off crests.
  terrain: Track | null = null
  private vy = 0
  private lastH = 0
  private pitch = 0
  airTime = 0 // s since the wheels last touched (visual)
  maxAir = 0 // longest jump so far (tests)
  private snapY = true

  // Track progress.
  hint = -1
  branch = -1 // on a shortcut (index), or -1 on the main road
  bi = -1 // shortcut sample
  readonly loc = newLoc()
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
  damageDealt = 0 // health segments taken off rivals (Deathmatch score)
  longestDrift = 0
  combat = 0
  chainMult = 1
  lastWreckAt = -99
  // Test counters: automatic resets, time crawling or rolling backwards while racing.
  resets = 0
  slowTime = 0
  reverseTime = 0

  // AI scratch.
  ai = {
    laneOffset: 0, think: 0, avoid: 0, pickupLat: 0, swerve: 0, boltTimer: 0, launchPerfect: false,
    // Shortcuts: the one being taken (-1 none) and the last lap/shortcut decided, so each is rolled once a lap.
    branch: -1, decided: -1, entered: false, shortcuts: 0,
    // Arena: where the bot is heading and its unstick manoeuvre.
    goal: new THREE.Vector3(), goalKind: 'wander' as 'wander' | 'pickup' | 'hunt', target: null as Car | null, stuck: 0, reverse: 0, reverseSteer: 1,
  }

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
    // Stats onto the model: Speed sets the top (by class), Acceleration the pull off the line, Grip the cornering
    // limit and how quickly a slide settles, Stability calms the slide further; Drift is used in step().
    const st = model.stats
    const cls = 'DCBA'.indexOf(opts.cls ?? model.cls)
    this.baseTop = kmh(topSpeedKmh(model, opts.cls ?? model.cls))
    this.accel = 9.5 + st.accel * 1.05
    this.latMax = 19 + st.grip * 1.2 + cls * 1.5
    this.gripRate = 5 + st.grip * 0.35 + st.stability * 0.15
    this.steerFast = Math.atan((1.15 * this.latMax * WHEELBASE) / (this.baseTop * this.baseTop))
    this.drag = Math.max(0, 0.36 * this.accel - ROLL) / (this.baseTop * this.baseTop)
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
    this.ram = Math.max(0, this.ram - dt)
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
    const ramOn = this.ram > 0 && this.ramBoost
    const top = this.top * (nitroOn ? CONFIG.nitro_topspeed_mult : 1) * (this.boost > 0 ? 1.08 : 1) * (ramOn ? CONFIG.ram_topspeed_mult : 1)
    const acc =
      this.accel * (nitroOn ? CONFIG.nitro_accel_mult : 1) * (this.boost > 0 ? 1.6 : 1) * (this.bog > 0 ? 0.35 : 1) * (ramOn ? CONFIG.ram_accel_mult : 1)

    const driftStat = this.model.stats.drift
    const stability = this.model.stats.stability
    const fwd0 = this.forwardSpeed
    const spd = Math.abs(fwd0)

    // Steering: the wheel turns at a fixed rate towards the stick through a range that narrows with speed, so full
    // lock is a tight U-turn at walking pace and, at speed, a small angle that lands just past the grip limit (the
    // stick then reads as lateral g). The yaw rate comes straight off the wheel, capped by what the tyres can hold;
    // there is no separate lag on the yaw, which is what makes the nose feel connected to the stick.
    let range = THREE.MathUtils.lerp(STEER_MAX, this.steerFast, Math.min(1, spd / Math.max(1, this.baseTop)))
    if (this.airBrake > 0) range *= 1.6
    const want = -st * range
    this.wheel += THREE.MathUtils.clamp(want - this.wheel, -STEER_RATE * dt, STEER_RATE * dt)
    let grip = this.latMax
    if (this.drifting) grip *= 1.2 + driftStat * 0.02 // a drift turns tighter than the tyres alone would allow
    if (this.airBrake > 0) grip *= 1.6
    const cap = grip / Math.max(spd, 1)
    this.yawKick *= Math.exp(-dt * 3)
    this.yawRate = THREE.MathUtils.clamp((fwd0 * Math.tan(this.wheel)) / WHEELBASE, -cap, cap) + this.yawKick
    this.yaw += this.yawRate * dt

    // The velocity keeps its world direction, so turning creates sideways slip for the tyres to work off.
    const f = this.forward, r = this.right
    let vf = this.vel.dot(f)
    let vl = this.vel.dot(r)

    // Engine: a strong pull off the line that fades linearly towards top speed. Drag and rolling resistance are
    // always there (lifting off bleeds speed, so corners can be set up on the throttle alone); the throttle makes
    // them up in proportion, so a car on full throttle really reaches its top.
    const drag = ROLL * Math.sign(vf) + this.drag * vf * spd
    if (thr > 0 && vf < top) vf += thr * (acc * Math.max(0.04, 1 - vf / top) + Math.max(0, drag)) * dt
    if (vf > top * 1.02) vf -= (vf - top) * 1.5 * dt // over the top (a boost just ran out): ease back down
    if (Math.abs(drag * dt) > spd && thr === 0) vf = 0
    else vf -= drag * dt
    if (brk > 0) {
      if (vf > 0.5) vf = Math.max(0, vf - BRAKE * brk * dt)
      else vf = Math.max(-REVERSE_TOP, vf - REVERSE_ACCEL * brk * dt)
    }
    if (hb) vf -= Math.sign(vf) * Math.min(spd, 5 * dt)

    // Drift state: the handbrake, or throwing it in hard near top speed, starts one; the tail steps out and the
    // slip stops settling until the car is pointing the way it is going again. A clean exit gives a mini-boost.
    if (!this.drifting && vf > 12) {
      const sharp = Math.abs(st) > 0.85 && vf > (0.95 - driftStat * 0.035) * this.baseTop
      if (hb || sharp) {
        this.drifting = true
        this.driftTime = 0
        this.driftDist = 0
        this.driftClean = true
        // Kick the tail out (less on a stable car).
        vl += -Math.sign(st || this.yawRate || 1) * Math.min(6, vf * 0.12) * (1.3 - stability * 0.04)
      }
    }
    if (this.drifting) {
      this.driftTime += dt
      this.driftDist += Math.abs(vf) * dt
      const slip = Math.abs(Math.atan2(vl, Math.max(1, vf)))
      const hold = 0.1 + driftStat * 0.012
      // Over once the car is pointing the way it is going, or the driver straightens up (the slip then settles
      // at the normal grip rate).
      if (vf < 8 || (!hb && this.driftTime > 0.35 && (slip < hold || Math.abs(st) < 0.25))) {
        if (vf >= 8 && this.driftClean && this.driftTime > 0.6) this.boost = Math.max(this.boost, CONFIG.drift_exit_boost)
        this.longestDrift = Math.max(this.longestDrift, this.driftDist)
        this.drifting = false
      }
    }

    // Tyres. Gripping: sideways slip dies away at the car's grip rate, never clamped, so a hard corner is a small
    // steady slide (which costs a little speed) rather than a wash-out. Drifting: the slip lingers (a high Drift
    // stat holds the slide longer) and the velocity is swung round rather than damped, so the car carries its pace
    // through the slide and only the scrub costs speed.
    if (this.drifting) {
      const speed0 = Math.hypot(vf, vl)
      vl *= Math.exp(-(4.2 - driftStat * 0.22) * dt)
      vf = Math.sign(vf || 1) * Math.sqrt(Math.max(0, speed0 * speed0 - vl * vl)) - Math.abs(vl) * 0.2 * dt
    } else vl *= Math.exp(-this.gripRate * dt)

    this.vel.copy(f).multiplyScalar(vf).addScaledVector(r, vl)
    this.pos.addScaledVector(this.vel, dt)
    this.pos.y = 0

    this.wallImpact = 0
    if (track.arena) this.bowl(track.arena, dt)
    else this.walls(track)
  }

  /** Keep the car between the barriers. Sets the impact speed into the wall (0 if none). */
  private walls(track: Track) {
    const l = track.locate(this.pos.x, this.pos.z, this.hint, HALF_WIDTH, this.loc)
    this.hint = l.i
    this.lateral = l.lateral
    this.branch = l.branch
    this.bi = l.bi
    if (l.over > 0) this.bounce(l.nx, l.nz, l.over)
  }

  /** Dust Bowl: the bank pulls cars back down to the floor; the rim wall and the obstacles stop them. */
  private bowl(a: ArenaLayout, dt: number) {
    this.lateral = 0
    const r = Math.hypot(this.pos.x, this.pos.z)
    if (r > a.floor) {
      const pull = 9.8 * CONFIG.bowl_bank_pull * bowlSlope(a, r) * dt
      this.vel.x -= (this.pos.x / r) * pull
      this.vel.z -= (this.pos.z / r) * pull
    }
    const limit = a.radius - BOWL_CAR_R
    if (r > limit) this.bounce(this.pos.x / r, this.pos.z / r, r - limit)
    for (const o of a.obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z
      const d = Math.hypot(dx, dz)
      const min = o.r + BOWL_CAR_R
      if (d < min && d > 1e-3) this.bounce(-dx / d, -dz / d, min - d)
    }
  }

  /** Push out of a wall whose normal (into the wall) is n, losing speed into it. */
  private bounce(nx: number, nz: number, over: number) {
    this.pos.x -= nx * over
    this.pos.z -= nz * over
    const vn = this.vel.x * nx + this.vel.z * nz
    if (vn > 0) {
      this.vel.x -= nx * vn * 1.35
      this.vel.z -= nz * vn * 1.35
      this.vel.multiplyScalar(1 - Math.min(0.45, vn * 0.025))
      this.wallImpact = Math.max(this.wallImpact, vn)
      if (vn > 3) this.driftClean = false
    }
  }

  wallImpact = 0

  /* ---------- Visuals ---------- */

  syncMesh(dt: number, time: number) {
    const m = this.mesh
    m.root.position.copy(this.pos)
    m.root.rotation.set(0, this.yaw, 0)
    if (this.terrain) this.ride(this.terrain, dt)
    if (this.arena) {
      // Ride up the bank, tilted to its slope.
      const r = Math.hypot(this.pos.x, this.pos.z)
      this.groundY = bowlHeight(this.arena, r)
      m.root.position.y += this.groundY
      if (this.groundY > 0) {
        tiltAxis.set(-this.pos.z / r, 0, this.pos.x / r)
        m.root.quaternion.premultiply(qTilt.setFromAxisAngle(tiltAxis, Math.atan(bowlSlope(this.arena, r))))
      }
    }
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
    m.ram.visible = this.ram > 0 && this.wrecked <= 0
    if (m.ram.visible) m.ram.scale.setScalar(1 + Math.sin(time * 18) * 0.04)
    m.charge.visible = this.railCharge > 0 && this.wrecked <= 0
    if (m.charge.visible) {
      const k = 1 - this.railCharge / CONFIG.rail_charge
      m.charge.position.z = (this.railBack ? -1 : 1) * m.charge.userData.reach
      m.charge.scale.setScalar(0.8 + k * 3.2 + Math.random() * 0.4)
    }
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

  /** Hills (visual only): follow the road up, keep the climb's vertical speed over a crest, fall back under gravity. */
  private ride(t: Track, dt: number) {
    const m = this.mesh
    const h = t.heightOn(this.pos.x, this.pos.z, this.hint, this.branch, this.bi)
    if (this.snapY || Math.abs(this.groundY - h) > 14) {
      this.snapY = false
      this.groundY = this.lastH = h
      this.vy = 0
    }
    const step = Math.max(dt, 1e-3)
    const groundVy = (h - this.lastH) / step
    this.lastH = h
    this.vy -= GRAVITY * dt
    this.groundY += this.vy * dt
    if (this.groundY <= h) {
      this.groundY = h
      this.vy = groundVy
      this.airTime = 0
    } else {
      this.airTime += dt
      this.maxAir = Math.max(this.maxAir, this.airTime)
    }
    m.root.position.y += this.groundY
    // Pitch to the slope under the car; in the air, ease towards the direction of flight.
    const fx = Math.sin(this.yaw) * 1.8, fz = Math.cos(this.yaw) * 1.8
    const slope = (t.heightAt(this.pos.x + fx, this.pos.z + fz) - t.heightAt(this.pos.x - fx, this.pos.z - fz)) / 3.6
    const want = this.airTime > 0.05 ? Math.atan2(this.vy, Math.max(8, this.speed)) * 0.6 : Math.atan(slope)
    this.pitch += (want - this.pitch) * Math.min(1, dt * (this.airTime > 0.05 ? 3 : 12))
    m.root.rotation.order = 'YXZ'
    m.root.rotation.x = -this.pitch
  }

  /** Put the car back on the racing line at `s`. */
  placeAt(track: Track, s: number, lateral: number) {
    const p = track.point(s, lateral)
    this.placeXZ(p.x, p.z, track.heading(s))
    this.hint = track.index(s)
    const n = track.nearest(p.x, p.z, this.hint)
    this.hint = n.i
    this.lateral = lateral
  }

  /** Put the car on shortcut `k` at sample `j` (a reset while on a shortcut). */
  placeOnBranch(track: Track, k: number, j: number, lateral: number) {
    const b = track.branches[k]
    const p = track.branchPoint(b, b.s[j], lateral)
    this.placeXZ(p.x, p.z, Math.atan2(b.tx[j], b.tz[j]))
    this.hint = track.index(b.ms[j])
    this.branch = k
    this.bi = j
    this.lateral = lateral
  }

  /** Put the car at a point (arena spawns). */
  placeXZ(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z)
    this.yaw = yaw
    this.yawRate = 0
    this.wheel = 0
    this.yawKick = 0
    this.hint = 0
    this.branch = -1
    this.bi = -1
    this.snapY = true
    this.lateral = 0
    this.mesh.body.rotation.set(0, 0, 0)
    this.mesh.body.position.set(0, 0, 0)
  }
}
