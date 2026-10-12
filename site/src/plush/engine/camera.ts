// Camera rig: a chase camera with mouse/stick look and collision against level geometry, an overhead preset,
// fixed shots, and free placement for levels with their own view. Shake is layered on top.
import * as THREE from 'three'
import type { Phys } from './physics'

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

export class CamRig {
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.08, 400)
  /** Heading the camera looks along (forward = sin(yaw), cos(yaw)). */
  yaw = 0
  /** Up-down angle for the chase camera (0 level, positive looks down). */
  pitch = 0.38
  /** Chase distance; the mouse wheel zooms between 3 and 11 m. */
  dist = 6.2
  /** Seconds since the player last turned the camera by hand (drives gentle auto-follow). */
  idle = 99
  readonly focus = new THREE.Vector3()
  readonly look = new THREE.Vector3()
  private shakeAmt = 0
  private shakeT = 0
  private snapNext = true

  /** Jump straight to the next placement instead of easing. */
  snap() {
    this.snapNext = true
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.2, Math.max(this.shakeAmt, amount))
  }

  turn(dx: number, dy: number) {
    this.yaw -= dx
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.1, 1.25)
    if (Math.abs(dx) + Math.abs(dy) > 1e-4) this.idle = 0
  }

  /** Chase a point (the toy's chest), pulling in when a wall is in the way. */
  chase(dt: number, target: THREE.Vector3, phys: Phys | null, opts: { dist?: number; height?: number; follow?: number; heading?: number; moving?: boolean } = {}) {
    this.idle += dt
    // Auto-follow: ease behind the toy while it runs and nobody is steering the camera.
    if (opts.heading !== undefined && opts.moving && this.idle > 1.6) {
      let d = opts.heading - this.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.yaw += d * Math.min(1, dt * (opts.follow ?? 0.9))
    }
    const dist = opts.dist ?? this.dist
    const k = this.snapNext ? 1 : 1 - Math.exp(-14 * dt)
    this.focus.lerp(target, k)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
    _v.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp)
    let d = dist
    if (phys) {
      const hit = phys.cast(this.focus, _v, dist + 0.3)
      if (hit >= 0) d = Math.max(0.8, hit - 0.35)
    }
    _w.copy(this.focus).addScaledVector(_v, d)
    _w.y += opts.height ?? 0.5
    this.place(_w, this.focus, dt)
  }

  /** Look down on an area from above and behind, drifting towards the player. */
  overhead(dt: number, center: THREE.Vector3, target: THREE.Vector3 | null, opts: { height: number; back: number; follow?: number }) {
    _v.copy(center)
    if (target) _v.lerp(target, opts.follow ?? 0.35)
    _w.set(_v.x, _v.y + opts.height, _v.z - opts.back)
    this.yaw = 0
    this.place(_w, _v, dt)
  }

  /** Put the camera somewhere, easing unless snapping. */
  place(pos: THREE.Vector3, look: THREE.Vector3, dt: number, ease = 10) {
    const k = this.snapNext ? 1 : 1 - Math.exp(-ease * dt)
    this.snapNext = false
    this.camera.position.lerp(pos, k)
    this.look.lerp(look, k)
    this.camera.lookAt(this.look)
  }

  /** Apply shake after placement (call once per rendered frame). */
  applyShake(dt: number) {
    if (this.shakeAmt <= 0.001) return
    this.shakeT += dt * 38
    const a = this.shakeAmt * 0.12
    this.camera.position.x += Math.sin(this.shakeT * 1.3) * a
    this.camera.position.y += Math.sin(this.shakeT * 1.7 + 1) * a
    this.camera.rotation.z += Math.sin(this.shakeT * 0.9) * a * 0.3
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2)
  }

  /** Camera-relative stick (x right, y forward) to a world move direction. */
  toWorld(x: number, y: number, out: { x: number; z: number }) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw)
    out.x = s * y - c * x
    out.z = c * y + s * x
    return out
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }
}
