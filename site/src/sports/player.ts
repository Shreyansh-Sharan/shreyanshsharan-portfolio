// The walking avatar: camera-relative WASD movement, run, jump, collisions and the idle/walk/run/jump clips.
import * as THREE from 'three'
import { CONFIG } from './config'
import { playMove, type AvatarRig } from './assets'

/** Regular_Jump: crouch, take-off ~0.45 s. Physics owns the height, so the clip plays from take-off. */
const JUMP_FROM = 0.42

export interface WalkInput {
  x: number // strafe, right positive
  y: number // forward
  run: boolean
  jump: boolean
  camYaw: number
}

export class Walker {
  readonly rig: AvatarRig
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3()
  yaw = 0
  vy = 0
  grounded = true
  speed = 0
  /** Set while a mode drives the avatar (penalty run-up, rally footwork): skips the walking animation logic. */
  scripted = false

  constructor(rig: AvatarRig) {
    this.rig = rig
  }

  place(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z)
    this.vel.set(0, 0, 0)
    this.vy = 0
    this.grounded = true
    this.yaw = yaw
    this.sync()
  }

  /** Movement and collisions. `collide` pushes the position out of solid things. */
  update(dt: number, input: WalkInput, collide: (p: THREE.Vector3) => void) {
    const len = Math.min(1, Math.hypot(input.x, input.y))
    const target = len > 0.05 ? (input.run ? CONFIG.run_speed : CONFIG.walk_speed) * len : 0
    let wx = 0, wz = 0
    if (len > 0.05) {
      const fx = Math.sin(input.camYaw), fz = Math.cos(input.camYaw)
      // Screen-right of a camera looking along (fx, fz).
      const rx = -fz, rz = fx
      wx = fx * input.y + rx * input.x
      wz = fz * input.y + rz * input.x
      const l = Math.hypot(wx, wz) || 1
      wx /= l
      wz /= l
      let d = Math.atan2(wx, wz) - this.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.yaw += d * Math.min(1, dt * CONFIG.turn_rate)
    }
    const k = Math.min(1, dt * CONFIG.accel)
    this.vel.x += (wx * target - this.vel.x) * k
    this.vel.z += (wz * target - this.vel.z) * k
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt
    collide(this.pos)
    this.speed = Math.hypot(this.vel.x, this.vel.z)

    if (input.jump && this.grounded) {
      this.vy = CONFIG.jump_speed
      this.grounded = false
    }
    this.vy -= CONFIG.gravity * dt
    this.pos.y += this.vy * dt
    if (this.pos.y <= 0) {
      this.pos.y = 0
      this.vy = 0
      this.grounded = true
    }
    this.sync()
  }

  sync() {
    this.rig.root.position.copy(this.pos)
    this.rig.root.rotation.y = this.yaw
  }

  /** Pick the clip from the motion, then advance the mixer. */
  animate(dt: number) {
    const r = this.rig
    if (!this.scripted) {
      if (!this.grounded) playMove(r, 'jump', { from: JUMP_FROM, speed: 1.1 })
      else if (this.speed > 5.6) playMove(r, 'run', { speed: THREE.MathUtils.clamp(this.speed / 7.5, 0.75, 1.3) })
      else if (this.speed > 0.25) playMove(r, 'walk', { speed: THREE.MathUtils.clamp(this.speed / 1.5, 0.6, 2.1) })
      else playMove(r, 'idle', { speed: 1 })
    }
    r.mixer?.update(dt)
    // Physics owns the jump height: keep the clip's crouch but drop its own hip lift.
    if (r.hips && r.current === 'jump') r.hips.bone.position.y = Math.min(r.hips.bone.position.y, r.hips.restY)
  }
}
