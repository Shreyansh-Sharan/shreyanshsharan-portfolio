// Small 3D vector for the simulation (no three.js, so the sim also runs in Node for the offline tests).
// Coordinates follow the original simulation: y up, the pitch along z, end 0's stumps at z = -10.06.
// The view mirrors x when drawing (see view/coords.ts) so the left-handed numbers render the right way round.

export class V3 {
  x: number
  y: number
  z: number
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  static zero() {
    return new V3()
  }
  clone() {
    return new V3(this.x, this.y, this.z)
  }
  set(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
  copy(v: V3) {
    this.x = v.x
    this.y = v.y
    this.z = v.z
    return this
  }
  add(v: V3) {
    return new V3(this.x + v.x, this.y + v.y, this.z + v.z)
  }
  sub(v: V3) {
    return new V3(this.x - v.x, this.y - v.y, this.z - v.z)
  }
  mul(k: number) {
    return new V3(this.x * k, this.y * k, this.z * k)
  }
  addIn(v: V3) {
    this.x += v.x
    this.y += v.y
    this.z += v.z
    return this
  }
  addScaledIn(v: V3, k: number) {
    this.x += v.x * k
    this.y += v.y * k
    this.z += v.z * k
    return this
  }
  scaleIn(k: number) {
    this.x *= k
    this.y *= k
    this.z *= k
    return this
  }
  dot(v: V3) {
    return this.x * v.x + this.y * v.y + this.z * v.z
  }
  cross(v: V3) {
    return new V3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x)
  }
  get len() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
  }
  get lenSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z
  }
  get flatLen() {
    return Math.sqrt(this.x * this.x + this.z * this.z)
  }
  norm() {
    const l = this.len
    return l > 1e-9 ? this.mul(1 / l) : new V3()
  }
  flat() {
    return new V3(this.x, 0, this.z)
  }
  lerp(v: V3, t: number) {
    return new V3(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t)
  }
  dist(v: V3) {
    return this.sub(v).len
  }
  flatDist(v: V3) {
    const dx = this.x - v.x
    const dz = this.z - v.z
    return Math.sqrt(dx * dx + dz * dz)
  }
  toArray(round = 0): [number, number, number] {
    if (!round) return [this.x, this.y, this.z]
    const k = 10 ** round
    return [Math.round(this.x * k) / k, Math.round(this.y * k) / k, Math.round(this.z * k) / k]
  }
  static from(a: readonly number[]) {
    return new V3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0)
  }
  toString() {
    return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`
  }
}

export const UP = new V3(0, 1, 0)

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t)
export const lerpU = (a: number, b: number, t: number) => a + (b - a) * t
export const invLerp = (a: number, b: number, v: number) => (a !== b ? clamp01((v - a) / (b - a)) : 0)
export const DEG = Math.PI / 180
export const sign = (v: number) => (v < 0 ? -1 : 1)
/** Shortest signed difference between two angles in degrees. */
export function deltaAngle(a: number, b: number) {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}
export function moveTowards(cur: number, target: number, maxDelta: number) {
  if (Math.abs(target - cur) <= maxDelta) return target
  return cur + Math.sign(target - cur) * maxDelta
}
export function moveTowardsAngle(cur: number, target: number, maxDelta: number) {
  const d = deltaAngle(cur, target)
  if (-maxDelta < d && d < maxDelta) return target
  return moveTowards(cur, cur + d, maxDelta)
}
export function moveTowardsV(cur: V3, target: V3, maxDelta: number) {
  const d = target.sub(cur)
  const l = d.len
  if (l <= maxDelta || l < 1e-9) return target.clone()
  return cur.add(d.mul(maxDelta / l))
}
/** Rotates a vector about the y axis by `deg` degrees (the original's Quaternion.AngleAxis(deg, up) convention). */
export function rotateY(v: V3, deg: number) {
  const a = deg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return new V3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
}

/** Deterministic random source (mulberry32): the host and the tests can reproduce a ball. */
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  get value() {
    return this.next()
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next()
  }
  /** Integer in [a, b). */
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a))
  }
  chance(p: number) {
    return this.next() < p
  }
  gauss() {
    const u1 = 1 - this.next()
    const u2 = this.next()
    return Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2)
  }
  pick<T>(list: readonly T[]) {
    return list[Math.floor(this.next() * list.length)]
  }
  get state() {
    return this.s
  }
  set state(v: number) {
    this.s = v >>> 0
  }
}
