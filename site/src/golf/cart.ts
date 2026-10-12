// Golf carts: arcade driving on the heightfield. Parked around every hole, or summoned with the Golf Cart item.
// The physics here is shared by the host (authoritative) and an online client predicting the cart it drives.
import * as THREE from 'three'
import { CONFIG } from './config'
import { prop, type GolfAssets } from './assets'
import type { Ground } from './ball'
import type { Course } from './course'
import type { Golfer, MoveInput } from './golfer'

/** Half the wheelbase: carts collide as a capsule from -HALF to +HALF along their nose. */
export const CART_HALF = 0.85
export const CART_RADIUS = 0.8

const UP = new THREE.Vector3(0, 1, 0)
const f = new THREE.Vector3()
const r = new THREE.Vector3()
const n = new THREE.Vector3()
const q = new THREE.Quaternion()
const qy = new THREE.Quaternion()
const tmp = new THREE.Vector3()
const SEATS = [new THREE.Vector3(0.34, 0.42, -0.15), new THREE.Vector3(-0.34, 0.42, -0.15)]

export interface CartEvents {
  hit?: number // speed into a tree or wall
  landed?: number // vertical speed on landing
}

export class Cart {
  readonly id: number
  readonly pos = new THREE.Vector3()
  readonly vel = new THREE.Vector3() // horizontal
  vy = 0
  yaw = 0
  grounded = true
  driver: Golfer | null = null
  passenger: Golfer | null = null
  /** Parked carts go back to their spot after sinking; summoned ones (null) vanish. */
  readonly home: { pos: THREE.Vector3; yaw: number } | null
  readonly owner: Golfer | null
  sunk = 0 // > 0: sinking, seconds until it's back at its spot (or gone)
  idle = 0 // seconds without anyone aboard
  spin = 0 // spinning out (Banana Peel)
  hold = 0 // the host is moving this cart itself for a moment (an online driver's own prediction is ignored)
  control: MoveInput | null = null
  readonly mesh = new THREE.Group()
  private readonly body = new THREE.Group()
  private readonly wheels: THREE.Object3D[] = []
  readonly up = new THREE.Vector3(0, 1, 0)
  /** Recent ball hits, so one bump doesn't hit the same ball every frame. */
  readonly hits = new Map<object, number>()

  constructor(id: number, assets: GolfAssets | null, home: { pos: THREE.Vector3; yaw: number } | null, owner: Golfer | null, color = '#f8fafc') {
    this.id = id
    this.home = home
    this.owner = owner
    this.mesh.add(this.body)
    const src = assets?.props.cart
    if (src) {
      // The model's nose points along -Z; turn it round to face +Z (our forward).
      const m = prop(src, 2.5, 'max')
      m.rotation.y = Math.PI
      this.body.add(m)
    } else this.body.add(this.fallback(color))
    if (owner) {
      // A pennant in the summoner's colour.
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5), new THREE.MeshStandardMaterial({ color: '#e5e7eb' }))
      pole.position.set(-0.45, 2.3, -0.9)
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, side: THREE.DoubleSide }))
      flag.position.set(-0.45, 2.75, -0.65)
      flag.rotation.y = Math.PI / 2
      this.body.add(pole, flag)
    }
    if (home) this.reset(home.pos, home.yaw)
  }

  private fallback(color: string) {
    const g = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.5, flatShading: true })
    const dark = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.8 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 2.3), paint)
    base.position.y = 0.45
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.6), dark)
    seat.position.set(0, 0.8, -0.3)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 1.7), paint)
    roof.position.set(0, 1.95, -0.1)
    g.add(base, seat, roof)
    for (const [x, z] of [[-0.5, 0.8], [0.5, 0.8], [-0.5, -0.8], [0.5, -0.8]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), dark)
      post.position.set(x * 1.2, 1.3, z * 0.9)
      g.add(post)
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12).rotateZ(Math.PI / 2), dark)
      w.position.set(x * 1.35, 0.28, z)
      g.add(w)
      this.wheels.push(w)
    }
    g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    return g
  }

  reset(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p)
    this.vel.set(0, 0, 0)
    this.vy = 0
    this.yaw = yaw
    this.grounded = true
    this.sunk = 0
    this.spin = 0
    this.up.set(0, 1, 0)
    this.mesh.visible = true
  }

  get speed() {
    return this.vel.length()
  }

  /** Signed speed along the nose. */
  get forward() {
    return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw)
  }

  riders() {
    const out: Golfer[] = []
    if (this.driver) out.push(this.driver)
    if (this.passenger) out.push(this.passenger)
    return out
  }

  /** Arcade driving: throttle/brake/reverse, steering by speed, a handbrake drift, slopes, ramps and trees. */
  step(dt: number, ground: Ground, course: Course, ev: CartEvents = {}) {
    if (this.sunk > 0) return ev
    const c = this.control
    const throttle = c ? THREE.MathUtils.clamp(c.y, -1, 1) : 0
    const steer = c ? THREE.MathUtils.clamp(c.x, -1, 1) : 0
    const hb = !!c?.brake
    f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    r.set(-f.z, 0, f.x) // right of the nose
    let fwd = this.vel.dot(f)
    let lat = this.vel.dot(r)
    const surf = ground.surface(this.pos.x, this.pos.z)
    const icy = surf === 'ice'
    if (this.grounded) {
      const top = CONFIG.cart_speed * (surf === 'sand' ? 0.55 : surf === 'rough' ? 0.85 : 1)
      const accel = CONFIG.cart_accel * (icy ? 0.45 : 1)
      if (throttle > 0) {
        fwd += (fwd < 0 ? CONFIG.cart_brake : accel) * throttle * dt
        if (fwd > top) fwd = Math.max(top, fwd - 8 * dt)
      } else if (throttle < 0) {
        if (fwd > 0.3) fwd = Math.max(0, fwd + CONFIG.cart_brake * throttle * dt)
        else fwd = Math.max(-CONFIG.cart_reverse_speed, fwd + accel * 0.7 * throttle * dt)
      } else {
        const roll = (surf === 'sand' ? 7 : icy ? 0.4 : 2.5) * dt
        fwd = Math.abs(fwd) <= roll ? 0 : fwd - Math.sign(fwd) * roll
      }
      if (hb) fwd = Math.abs(fwd) <= 7 * dt ? 0 : fwd - Math.sign(fwd) * 7 * dt
      // Slopes: downhill speeds you up, uphill slows you.
      const ahead = ground.y(this.pos.x + f.x * 0.8, this.pos.z + f.z * 0.8) - ground.y(this.pos.x - f.x * 0.8, this.pos.z - f.z * 0.8)
      fwd -= 9.81 * (ahead / 1.6) * 0.6 * dt
      // Lateral grip: tyres bite hard so the cart goes where its nose points instead of sliding
      // sideways; ice and the handbrake let it drift.
      const grip = icy ? 0.7 : hb ? 1.3 : surf === 'sand' ? 5 : CONFIG.cart_grip
      lat *= Math.exp(-grip * dt)
      // Steering keeps real authority even at low speed (a floor), so the nose actually turns;
      // it eases in from a standstill and flips when reversing.
      const dirSign = fwd < -0.2 ? -1 : 1
      const speedScale = THREE.MathUtils.clamp(0.45 + Math.abs(fwd) / 6, 0, 1)
      const turn = (hb ? CONFIG.cart_turn_rate * 1.5 : CONFIG.cart_turn_rate) * speedScale * dirSign
      // Only steer when actually moving, so a parked cart doesn't spin in place.
      if (Math.abs(fwd) > 0.3) this.yaw -= steer * turn * dt
    }
    if (this.spin > 0) {
      this.spin = Math.max(0, this.spin - dt)
      this.yaw += dt * 10
      fwd *= Math.max(0, 1 - dt * 1.2)
    }
    // Re-aim the velocity along the new nose; the handbrake keeps the old momentum (a drift).
    f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    r.set(-f.z, 0, f.x)
    if (this.grounded) {
      tmp.copy(f).multiplyScalar(fwd).addScaledVector(r, lat)
      if (hb || icy) this.vel.lerp(tmp, 1 - Math.exp(-dt * (icy ? 1.2 : 2.5)))
      else this.vel.copy(tmp)
    } else this.vel.multiplyScalar(Math.max(0, 1 - dt * 0.05))

    const ox = this.pos.x, oz = this.pos.z
    const gOld = ground.y(ox, oz)
    this.pos.x += this.vel.x * dt
    this.pos.z += this.vel.z * dt

    // Trees and props block it.
    for (const t of course.trees) {
      const tr = t.r * t.scale + CART_RADIUS + 0.2
      for (const k of [-CART_HALF, CART_HALF]) {
        const cx = this.pos.x + f.x * k, cz = this.pos.z + f.z * k
        const dx = cx - t.x, dz = cz - t.z
        const d2 = dx * dx + dz * dz
        if (d2 >= tr * tr) continue
        const d = Math.sqrt(d2) || 1
        const nx = dx / d, nz = dz / d
        this.pos.x += nx * (tr - d)
        this.pos.z += nz * (tr - d)
        const vn = this.vel.x * nx + this.vel.z * nz
        if (vn < 0) {
          ev.hit = Math.max(ev.hit ?? 0, -vn)
          this.vel.x -= 1.3 * vn * nx
          this.vel.z -= 1.3 * vn * nz
          this.vel.multiplyScalar(0.6)
        }
      }
    }
    // The edge of the world is a wall.
    const b = course.bounds
    const px = THREE.MathUtils.clamp(this.pos.x, b.minX + 3, b.maxX - 3), pz = THREE.MathUtils.clamp(this.pos.z, b.minZ + 3, b.maxZ - 3)
    if (px !== this.pos.x || pz !== this.pos.z) {
      this.pos.x = px
      this.pos.z = pz
      ev.hit = Math.max(ev.hit ?? 0, this.speed)
      this.vel.multiplyScalar(-0.3)
    }
    // Too steep to climb (canyon walls, cliffs): it stalls.
    ground.normal(this.pos.x, this.pos.z, n)
    if (this.grounded && n.y < 0.6 && ground.y(this.pos.x, this.pos.z) > gOld + 0.05) {
      this.pos.x = ox
      this.pos.z = oz
      ev.hit = Math.max(ev.hit ?? 0, this.speed)
      this.vel.multiplyScalar(-0.25)
    }

    // Vertical: hug the ground; leave it when it falls away faster than gravity (ramp lips, crests).
    const gNew = ground.y(this.pos.x, this.pos.z)
    const G = CONFIG.cart_gravity * course.gravity
    if (this.grounded) {
      const rate = dt > 0 ? (gNew - gOld) / dt : 0
      if (rate < this.vy - G * dt - 1.2 && this.vy > 1) {
        this.grounded = false
        this.vy -= G * dt
        this.pos.y += this.vy * dt
      } else {
        this.vy = THREE.MathUtils.clamp(rate, -14, 14)
        this.pos.y = gNew
      }
    } else {
      this.vy -= G * dt
      this.pos.y += this.vy * dt
      if (this.pos.y <= gNew) {
        ev.landed = -this.vy
        this.pos.y = gNew
        this.grounded = true
        this.vy = 0
      }
    }
    if (this.pos.y < gNew) this.pos.y = gNew
    this.updateMesh(dt, ground, fwd)
    return ev
  }

  /** Pose the model: on the ground it leans with the slope, in the air it keeps its last lean. */
  updateMesh(dt: number, ground: Ground, fwd = this.forward) {
    if (this.grounded) {
      ground.normal(this.pos.x, this.pos.z, n)
      this.up.lerp(n, 1 - Math.exp(-dt * 10)).normalize()
    }
    q.setFromUnitVectors(UP, this.up)
    qy.setFromAxisAngle(UP, this.yaw)
    this.mesh.quaternion.copy(q).multiply(qy)
    this.mesh.position.copy(this.pos)
    if (this.sunk > 0) this.mesh.position.y -= Math.min(1.6, (CONFIG.cart_sink_time - this.sunk) * 0.8)
    for (const w of this.wheels) w.rotation.x += (fwd * dt) / 0.28
  }

  /** World position of a seat. */
  seatPos(seat: number, out: THREE.Vector3) {
    this.mesh.updateMatrixWorld()
    return out.copy(SEATS[seat] ?? SEATS[0]).applyMatrix4(this.mesh.matrixWorld)
  }

  /** Closest point on the cart's centre line to (x, z), written into `out` (y = cart height). */
  closest(x: number, z: number, out: THREE.Vector3) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw)
    const t = THREE.MathUtils.clamp((x - this.pos.x) * fx + (z - this.pos.z) * fz, -CART_HALF, CART_HALF)
    return out.set(this.pos.x + fx * t, this.pos.y, this.pos.z + fz * t)
  }
}
