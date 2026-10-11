// F1 career drive: arcade car physics on the circuit, a chase camera, and a lap split into one sector per career role.
// Entering a sector shows that role's card; lap and sector times are kept, the best lap saved.
import * as THREE from 'three'
import { CONFIG } from './config'
import type { Track } from './track'
import type { Role } from './progress'

export interface DriveInput {
  throttle: number // 0..1
  brake: number // 0..1
  steer: number // -1 (left) .. 1 (right)
}

export interface LapEvent {
  kind: 'sector' | 'lap' | 'start' | 'bump'
  sector: number
  time?: number
  best?: boolean
}

export interface DriveHud {
  speed: number // km/h
  gear: number
  lap: number
  lapTime: number | null
  sector: number
  splits: (number | null)[]
  bestSectors: (number | null)[]
  lastLap: number | null
  bestLap: number | null
  offTrack: boolean
  started: boolean
}

const _v = new THREE.Vector3()
const _look = new THREE.Vector3()

export class Drive {
  readonly car: THREE.Group
  readonly track: Track
  readonly roles: Role[]
  x = 0
  z = 0
  yaw = 0
  vx = 0
  vz = 0
  steer = 0
  idx = 0
  throttle = 0
  offTrack = false
  // Lap state.
  clock = 0
  started = false
  lap = 0
  lapStart = 0
  sector = -1
  sectorStart = 0
  splits: (number | null)[]
  bestSectors: (number | null)[]
  lastLap: number | null = null
  bestLap: number | null = null
  lapValid = true
  onEvent: ((e: LapEvent) => void) | null = null
  private bump = 0

  constructor(car: THREE.Group, track: Track, roles: Role[], bestLap: number | null, bestSectors: (number | null)[]) {
    this.car = car
    this.track = track
    this.roles = roles
    this.splits = roles.map(() => null)
    this.bestSectors = [...bestSectors]
    this.bestLap = bestLap
  }

  get speed() {
    return Math.hypot(this.vx, this.vz)
  }

  /** Line the car up on the grid just behind the start line. */
  toGrid() {
    const t = this.track
    const i = t.indexAt(t.length - 26)
    this.x = t.px[i] - t.tz[i] * 3
    this.z = t.pz[i] + t.tx[i] * 3
    this.yaw = t.heading(i)
    this.vx = this.vz = this.steer = 0
    this.idx = i
    this.started = false
    this.lap = 0
    this.sector = this.sectorOf(t.arc(i, this.x, this.z))
    this.splits = this.roles.map(() => null)
    this.lapValid = true
    this.sync()
  }

  /** Back onto the centreline facing the right way (R key, or after a spin into the scenery). */
  recover() {
    const t = this.track
    const i = t.nearest(this.x, this.z, this.idx)
    this.x = t.px[i]
    this.z = t.pz[i]
    this.yaw = t.heading(i)
    this.vx = this.vz = 0
    this.idx = i
    this.sync()
  }

  sectorOf(s: number) {
    return Math.min(this.roles.length - 1, Math.floor((s / this.track.length) * this.roles.length))
  }

  update(dt: number, input: DriveInput) {
    this.clock += dt
    const t = this.track
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw)
    // Split velocity into forward and sideways parts.
    let vf = this.vx * fx + this.vz * fz
    let vs = this.vx * fz - this.vz * fx

    this.idx = t.nearest(this.x, this.z, this.idx)
    const off = t.offset(this.idx, this.x, this.z)
    this.offTrack = Math.abs(off) > CONFIG.track_half_width + 0.4
    const grass = this.offTrack

    // Throttle, brakes, drag.
    this.throttle = input.throttle
    const maxV = grass ? CONFIG.grass_max_speed : CONFIG.car_max_speed
    if (input.throttle > 0) vf += CONFIG.car_accel * input.throttle * Math.max(0, 1 - vf / maxV) * dt
    if (input.brake > 0) {
      if (vf > 0.5) vf -= CONFIG.car_brake * input.brake * dt
      else vf = Math.max(-CONFIG.car_reverse_speed, vf - CONFIG.car_accel * 0.4 * input.brake * dt)
    }
    const drag = CONFIG.car_drag * vf * Math.abs(vf) + Math.sign(vf) * CONFIG.car_roll + (grass ? vf * CONFIG.grass_drag : 0)
    if (Math.abs(drag * dt) > Math.abs(vf) && input.throttle === 0) vf = 0
    else vf -= drag * dt
    if (grass && vf > maxV) vf += (maxV - vf) * Math.min(1, dt * 1.5)

    // Steering: the wheel angle narrows with speed; yaw rate is capped by grip.
    const spd = Math.abs(vf)
    const maxSteer = THREE.MathUtils.lerp(CONFIG.car_steer, CONFIG.car_steer_fast, Math.min(1, spd / CONFIG.car_max_speed))
    const want = -input.steer * maxSteer
    this.steer += THREE.MathUtils.clamp(want - this.steer, -CONFIG.car_steer_rate * dt, CONFIG.car_steer_rate * dt)
    let yawRate = (vf * Math.tan(this.steer)) / CONFIG.car_wheelbase
    const grip = grass ? CONFIG.car_grip_grass : CONFIG.car_grip
    const cap = grip / Math.max(spd, 1)
    yawRate = THREE.MathUtils.clamp(yawRate, -cap, cap)
    this.yaw += yawRate * dt
    // Sideways slip dies away (less on grass), so the car slides a little through fast corners.
    vs *= Math.exp(-(grass ? CONFIG.car_slip_grass : CONFIG.car_slip) * dt)

    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw)
    this.vx = nfx * vf + nfz * vs
    this.vz = nfz * vf - nfx * vs
    this.x += this.vx * dt
    this.z += this.vz * dt

    // Barriers: keep the car inside and scrub speed.
    this.idx = t.nearest(this.x, this.z, this.idx)
    const off2 = t.offset(this.idx, this.x, this.z)
    const lim = CONFIG.track_half_width + CONFIG.track_runoff - 1.3
    if (Math.abs(off2) > lim) {
      const push = Math.abs(off2) - lim
      const nx = -t.tz[this.idx] * Math.sign(off2), nz = t.tx[this.idx] * Math.sign(off2)
      this.x -= nx * push
      this.z -= nz * push
      // Remove the velocity into the wall and lose some speed.
      const into = this.vx * nx + this.vz * nz
      if (into > 0) {
        this.vx -= nx * into * 1.3
        this.vz -= nz * into * 1.3
      }
      this.vx *= CONFIG.barrier_speed_keep + (1 - CONFIG.barrier_speed_keep) * Math.exp(-dt * 4)
      this.vz *= CONFIG.barrier_speed_keep + (1 - CONFIG.barrier_speed_keep) * Math.exp(-dt * 4)
      if (into > 6 && this.bump <= 0) {
        this.bump = 0.4
        this.onEvent?.({ kind: 'bump', sector: -1 })
      }
    }
    this.bump = Math.max(0, this.bump - dt)
    this.sync()
    this.timing()
  }

  private timing() {
    const t = this.track
    const s = t.arc(this.idx, this.x, this.z)
    const sec = this.sectorOf(s)
    if (sec === this.sector) return
    const n = this.roles.length
    const prev = this.sector
    this.sector = sec
    if (sec === (prev + 1) % n) {
      // Forward through a gate.
      const now = this.clock
      if (this.started && prev >= 0) {
        const split = now - this.sectorStart
        this.splits[prev] = split
        const best = this.bestSectors[prev] === null || split < (this.bestSectors[prev] as number)
        if (best && this.lapValid) this.bestSectors[prev] = split
      }
      this.sectorStart = now
      if (sec === 0) {
        if (this.started && this.lapValid && this.splits.every((x) => x !== null)) {
          const lapTime = now - this.lapStart
          this.lastLap = lapTime
          const best = this.bestLap === null || lapTime < this.bestLap
          if (best) this.bestLap = lapTime
          this.onEvent?.({ kind: 'lap', sector: 0, time: lapTime, best })
        } else if (!this.started) this.onEvent?.({ kind: 'start', sector: 0 })
        this.started = true
        this.lap++
        this.lapStart = now
        this.lapValid = true
        this.splits = this.roles.map(() => null)
      }
      this.onEvent?.({ kind: 'sector', sector: sec })
    } else {
      // Backwards or a skipped gate (a spin): this lap no longer counts.
      this.lapValid = false
    }
  }

  sync() {
    this.car.position.set(this.x, 0, this.z)
    this.car.rotation.y = this.yaw
    // A touch of body roll and pitch.
    const m = this.car.children[0]
    if (m) {
      m.rotation.z = THREE.MathUtils.clamp(this.steer * this.speed * 0.004, -0.05, 0.05)
    }
  }

  /** Simple pure-pursuit driver for tests and the attract mode: follows the centreline, brakes for corners. */
  autopilot(): DriveInput {
    const t = this.track
    const spd = this.speed
    const look = t.indexAt(t.s[this.idx] + 10 + spd * 0.45)
    const dx = t.px[look] - this.x, dz = t.pz[look] - this.z
    let d = Math.atan2(dx, dz) - this.yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    // Fastest speed from which every corner ahead can still be braked for.
    let target = CONFIG.car_max_speed
    for (let a = 0; a < 140; a += 4) {
      const k = Math.abs(t.curv[t.indexAt(t.s[this.idx] + a)])
      const vc = Math.sqrt((CONFIG.car_grip * 0.8) / Math.max(k, 1e-4))
      target = Math.min(target, Math.sqrt(vc * vc + 2 * CONFIG.car_brake * 0.7 * a))
    }
    return { throttle: spd < target ? 1 : 0, brake: spd > target + 3 ? 1 : 0, steer: THREE.MathUtils.clamp(-d * 3, -1, 1) }
  }

  camera(cam: THREE.PerspectiveCamera, dt: number, snap = false) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw)
    const back = CONFIG.chase_dist + this.speed * 0.03
    _v.set(this.x - fx * back, CONFIG.chase_height + this.speed * 0.008, this.z - fz * back)
    const k = snap ? 1 : 1 - Math.exp(-dt * 6)
    cam.position.lerp(_v, k)
    _look.set(this.x + fx * 6, 1.2, this.z + fz * 6)
    cam.lookAt(_look)
    const fov = 62 + Math.min(14, this.speed * 0.17)
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3)
      cam.updateProjectionMatrix()
    }
  }

  hud(): DriveHud {
    const spd = this.speed
    return {
      speed: Math.round(spd * 3.6),
      gear: spd < 1 ? 0 : Math.min(8, 1 + Math.floor(spd / 12)),
      lap: this.lap,
      lapTime: this.started ? this.clock - this.lapStart : null,
      sector: this.sector,
      splits: [...this.splits],
      bestSectors: [...this.bestSectors],
      lastLap: this.lastLap,
      bestLap: this.bestLap,
      offTrack: this.offTrack,
      started: this.started,
    }
  }
}
