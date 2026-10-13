// Cricket movement authored as keyframes in character space (+Z the way the body faces, +X its left, y up):
// batting stance, backlift and strokes (forward and back defence, drives, flick, pull, cut, sweep, lofted shots, the
// leave), bowling actions for pace and spin, keeping, fielding (ready, catch, dive, the throw's twist), appeals,
// umpire signals and the lean into turns while running. Strokes are timed to the sim (contact at the shot's lead
// time, release at the end of the delivery stride) and ease through contact rather than slowing into it; idle poses
// breathe and sway; reaches are damped so a target that jumps never makes the body jump.
import * as THREE from 'three'
import { ANKLE, type ProcPose } from './rig'
import type { Pose } from '../sim/director'
import type { BowlStyle } from '../sim/delivery'
import type { Footwork } from '../sim/shots'

type V = [number, number, number]

/** Per-actor memory for damped targets (hands reaching for the ball). */
export interface PoseMem {
  hands: THREE.Vector3
  hasHands: boolean
}

export const newPoseMem = (): PoseMem => ({ hands: new THREE.Vector3(), hasHands: false })

export interface PoseCtx {
  pose: Pose
  t: number
  dt: number
  variant: string
  feet: Footwork
  loft: boolean
  /** Shot direction (degrees, 0 straight, + off side). */
  aim: number
  /** How big the stroke is (0 a dab, 1 a full-blooded loft): sets the backlift. */
  power: number
  /** The ball in character space. */
  ball: THREE.Vector3 | null
  /** Seconds since the ball was released (-1 before). */
  sinceRelease: number
  /** Seconds until the bowler lets go during the run-up (-1 otherwise). */
  toRelease: number
  /** The other end (for batters and keepers: where the bowler is), character space. */
  ahead: THREE.Vector3
  kind: 'striker' | 'nonstriker' | 'bowler' | 'keeper' | 'fielder' | 'umpire'
  style: BowlStyle
  hasBall: boolean
  speed: number
  /** Turn rate on screen (degrees/s, positive turning to the body's left) and forward acceleration (m/s²). */
  yawRate: number
  accel: number
  mem: PoseMem
}

type Ease = 'smooth' | 'in' | 'out' | 'linear'

interface Key {
  t: number
  /** How to arrive at this key from the one before (default smooth). */
  ease?: Ease
  pelvis?: V
  hips?: V
  spine?: V
  footL?: V
  footR?: V
  toeL?: number
  toeR?: number
  handL?: V
  handR?: V
  grip?: V
  dir?: V
  face?: V
  wristR?: number
}

const smooth = (x: number) => x * x * (3 - 2 * x)
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const ease = (x: number, e: Ease = 'smooth') => (e === 'in' ? x * x : e === 'out' ? 1 - (1 - x) * (1 - x) : e === 'linear' ? x : smooth(x))
const lerpV = (a: V, b: V, k: number): V => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const vec = (v: V) => new THREE.Vector3(v[0], v[1], v[2])
const _q = new THREE.Quaternion()
const _r = new THREE.Quaternion()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _sa = new THREE.Vector3()
const _sb = new THREE.Vector3()
const _rb = new THREE.Vector3()
const DEFAULT_CATCH = new THREE.Vector3(0, 1.4, 0.5)

function slerpDir(a: V, b: V, k: number): V {
  const va = _sa.set(a[0], a[1], a[2]).normalize()
  const vb = _sb.set(b[0], b[1], b[2]).normalize()
  _q.setFromUnitVectors(va, vb)
  _r.identity().slerp(_q, k)
  const o = va.applyQuaternion(_r)
  return [o.x, o.y, o.z]
}

const VEC_FIELDS = ['pelvis', 'hips', 'spine', 'footL', 'footR', 'handL', 'handR', 'grip'] as const
const NUM_FIELDS = ['toeL', 'toeR', 'wristR'] as const

/** Interpolates a keyframe list at time t (eased between keys). Missing fields carry over. */
function sample(keys: Key[], t: number): Key {
  // Fill forward so every key has every field.
  const full: Key[] = []
  let prev: Key = { t: 0 }
  for (const k of keys) {
    prev = { ...prev, ...k }
    full.push(prev)
  }
  if (t <= full[0].t) return full[0]
  for (let i = 0; i < full.length - 1; i++) {
    const a = full[i]
    const b = full[i + 1]
    if (t <= b.t) {
      const k = ease((t - a.t) / Math.max(1e-4, b.t - a.t), keys[i + 1].ease)
      const out: Key = { t }
      for (const f of VEC_FIELDS) if (a[f] && b[f]) out[f] = lerpV(a[f]!, b[f]!, k)
      for (const f of NUM_FIELDS) if (a[f] !== undefined && b[f] !== undefined) out[f] = a[f]! + (b[f]! - a[f]!) * k
      for (const f of ['dir', 'face'] as const) if (a[f] && b[f]) out[f] = slerpDir(a[f]!, b[f]!, k)
      return out
    }
  }
  return full[full.length - 1]
}

function toPose(k: Key, extra: Partial<ProcPose> = {}): ProcPose {
  const p: ProcPose = { weight: 1, ...extra }
  if (k.pelvis) p.pelvis = vec(k.pelvis)
  if (k.hips) p.hips = k.hips
  if (k.spine) p.spine = k.spine
  if (k.footL) p.footL = vec(k.footL)
  if (k.footR) p.footR = vec(k.footR)
  if (k.toeL !== undefined) p.toeL = k.toeL
  if (k.toeR !== undefined) p.toeR = k.toeR
  if (k.wristR !== undefined) p.wristR = k.wristR
  if (k.grip && k.dir) {
    const grip = vec(k.grip)
    const dir = vec(k.dir).normalize()
    const face = k.face ? vec(k.face) : new THREE.Vector3(1, 0, 0)
    p.bat = { grip, dir, face }
    // Top hand (left for a right-hander) higher on the handle, bottom hand lower.
    p.handL = grip.clone().addScaledVector(dir, -0.05)
    p.handR = grip.clone().addScaledVector(dir, 0.08)
  }
  if (k.handL) p.handL = vec(k.handL)
  if (k.handR) p.handR = vec(k.handR)
  return p
}

/** Damps a reach target so the hands glide to it (and never jump when the target does). */
function damp(mem: PoseMem, target: THREE.Vector3, dt: number, rate = 22) {
  if (!mem.hasHands || dt <= 0) {
    mem.hands.copy(target)
    mem.hasHands = true
  } else mem.hands.lerp(target, 1 - Math.exp(-dt * rate))
  return mem.hands
}

/* ---------------- batting ---------------- */
// Batter's character space: +Z faces the off side (side-on), +X points down the pitch at the bowler.

const STANCE: Key = {
  t: 0,
  pelvis: [0.02, -0.07, 0],
  hips: [8, 6, 0],
  spine: [16, 18, 0],
  footL: [0.24, ANKLE, 0.02],
  footR: [-0.2, ANKLE, -0.02],
  toeL: 18,
  toeR: 2,
  grip: [-0.04, 0.73, 0.28],
  dir: [-0.12, -1, 0.02],
  face: [1, 0, 0.1],
}

const BACKLIFT: Key = {
  t: 0,
  pelvis: [0.0, -0.08, 0],
  hips: [6, 6, 0],
  spine: [14, 14, 0],
  footL: [0.27, ANKLE, 0.03],
  footR: [-0.16, ANKLE, 0.02],
  toeL: 20,
  toeR: 4,
  grip: [-0.16, 1.02, 0.2],
  dir: [-0.55, 0.82, -0.12],
  face: [0.2, 0.2, 1],
}

/** The backlift for a stroke of this power: higher and further back for the big shots. */
function backliftFor(power: number): Key {
  const k = clamp01(power)
  return { ...BACKLIFT, t: 0, grip: [-0.16 - 0.1 * k, 1.02 + 0.22 * k, 0.2 - 0.04 * k], dir: slerpDir([-0.55, 0.82, -0.12], [-0.35, 0.95, -0.3], k), spine: [14, 14 + 10 * k, 0], hips: [6, 6 + 4 * k, 0] }
}

const aimDir = (aim: number): V => [Math.cos((aim * Math.PI) / 180), 0, Math.sin((aim * Math.PI) / 180)]

/** The relaxed pose after a stroke: upright, bat down by the front foot, watching the ball. */
function recoverKey(t: number, footL: V, footR: V): Key {
  return { t, ease: 'smooth', pelvis: [0.12, -0.09, 0.02], hips: [10, 6, 0], spine: [14, 16, 0], footL, footR: [footR[0], ANKLE, footR[2]], toeL: 30, toeR: 10, grip: [0.14, 0.78, 0.26], dir: [-0.25, -1, 0.1], face: [1, 0, 0.2] }
}

function driveKeys(aim: number, lead: number, loft: boolean, charge: boolean, power: number): Key[] {
  const a = aimDir(aim)
  const side = Math.sin((aim * Math.PI) / 180)
  const stride: V = charge ? [0.75, ANKLE, 0.08] : [0.64, ANKLE, 0.1 + 0.12 * side]
  const front: Key = {
    t: lead,
    ease: 'in',
    pelvis: [0.26, -0.17, 0.04],
    hips: [22 + aim * 0.15, 10, 0],
    spine: [30, 28 + aim * 0.12, -4],
    footL: stride,
    footR: [-0.2, ANKLE, -0.01],
    toeL: 42,
    toeR: 18,
    grip: [stride[0] - 0.04, 0.62, stride[2] + 0.2],
    dir: [-0.16, -1, 0.02],
    face: a,
  }
  const back = backliftFor(power)
  // The stride goes first (weight forward), then the bat comes down and through.
  const mid: Key = { t: lead * 0.55, ease: 'in', grip: [0.18, 0.95, 0.24], dir: [-0.65, 0.3, -0.05], face: [0.3, 0, 1], pelvis: [0.14, -0.13, 0.02], spine: [24, 22, 0], footL: lerpV(BACKLIFT.footL!, stride, 0.85) }
  const follow1: Key = { t: lead + 0.14, ease: 'out', grip: [stride[0] + 0.05, 0.98 + (loft ? 0.12 : 0), stride[2] + 0.18 + side * 0.08], dir: [0.55 + a[0] * 0.2, 0.55, a[2] * 0.6], face: [0, 1, 0] }
  const finish: Key = {
    t: lead + 0.45,
    pelvis: [0.3, -0.12, 0.04],
    spine: [18, 34 + aim * 0.15, -6],
    grip: loft ? [0.32, 1.62, 0.1] : [0.34, 1.42, 0.16 + side * 0.1],
    dir: loft ? [-0.45, 0.6, -0.45] : [-0.2 + a[0] * 0.15, 0.75, -0.35 - side * 0.3],
    face: [0, 0.4, -1],
    footR: [-0.16, ANKLE + 0.05, 0.02],
    toeR: 40,
  }
  return [back, mid, front, follow1, finish, { ...finish, t: lead + 0.8 }, recoverKey(lead + 1.3, stride, finish.footR!)]
}

function defendKeys(lead: number, back: boolean, power: number): Key[] {
  const bl = backliftFor(power)
  if (back) {
    const k: Key = {
      t: lead,
      ease: 'out',
      pelvis: [-0.06, -0.05, 0.02],
      hips: [16, 4, 0],
      spine: [10, 30, 0],
      footL: [0.12, ANKLE, 0.04],
      footR: [-0.34, ANKLE, 0.06],
      toeL: 30,
      toeR: 10,
      grip: [0.14, 1.0, 0.26],
      dir: [-0.22, -1, 0],
      face: [1, -0.1, 0],
    }
    return [bl, { t: lead * 0.5, ease: 'in', grip: [0.0, 1.1, 0.26], dir: [-0.5, -0.5, 0], face: [1, 0, 0.3], footR: [-0.3, ANKLE, 0.05], pelvis: [-0.04, -0.06, 0.02] }, k, { ...k, t: lead + 0.6 }, recoverKey(lead + 1.1, k.footL!, k.footR!)]
  }
  const k: Key = {
    t: lead,
    ease: 'out',
    pelvis: [0.2, -0.15, 0.03],
    hips: [20, 10, 0],
    spine: [32, 30, -2],
    footL: [0.56, ANKLE, 0.1],
    footR: [-0.2, ANKLE, -0.01],
    toeL: 35,
    toeR: 14,
    grip: [0.46, 0.82, 0.3],
    dir: [-0.34, -1, 0],
    face: [1, -0.15, 0],
  }
  return [bl, { t: lead * 0.6, ease: 'in', grip: [0.15, 0.95, 0.27], dir: [-0.4, -0.6, 0], face: [1, 0, 0.3], footL: [0.5, ANKLE, 0.09], pelvis: [0.16, -0.13, 0.03] }, k, { ...k, t: lead + 0.6 }, recoverKey(lead + 1.1, k.footL!, k.footR!)]
}

function pullKeys(aim: number, lead: number, loft: boolean, power: number): Key[] {
  const a = aimDir(aim)
  // Bat horizontal across the body, toe out in front (towards the bowler), face towards the leg-side target.
  const contactDir: V = [Math.abs(a[2]), -0.18, a[0] * Math.sign(a[2] || 1) * -1]
  const c: Key = {
    t: lead,
    ease: 'in',
    pelvis: [-0.06, -0.06, -0.02],
    hips: [55, 0, 0],
    spine: [10, 45, 8],
    footL: [0.18, ANKLE, -0.18],
    footR: [-0.32, ANKLE, 0.12],
    toeL: 70,
    toeR: 75,
    grip: [0.24, 1.14, 0.08],
    dir: contactDir,
    face: a,
  }
  const finish: Key = { t: lead + 0.4, ease: 'out', grip: [-0.05, 1.32 + (loft ? 0.1 : 0), -0.3], dir: [-0.75, 0.35, -0.55], face: [-0.5, 0, -1], spine: [6, 70, 10], hips: [75, 0, 0] }
  const bl = backliftFor(power)
  return [
    { ...bl, grip: [-0.18, 1.22 + 0.1 * power, 0.24], dir: [-0.4, 0.7, 0.55] },
    { t: lead * 0.6, ease: 'in', grip: [0.0, 1.2, 0.25], dir: [0.15, 0.25, 1], face: [1, 0, -0.3], hips: [30, 0, 0], spine: [12, 30, 4], footR: [-0.3, ANKLE, 0.1], footL: [0.18, ANKLE, -0.12] },
    c,
    finish,
    { ...finish, t: lead + 0.75 },
    recoverKey(lead + 1.25, c.footL!, c.footR!),
  ]
}

function cutKeys(aim: number, lead: number, power: number): Key[] {
  const a = aimDir(aim)
  const c: Key = {
    t: lead,
    ease: 'in',
    pelvis: [-0.04, -0.1, 0.12],
    hips: [-10, 8, 0],
    spine: [22, -6, 10],
    footL: [0.16, ANKLE, 0.02],
    footR: [-0.12, ANKLE, 0.36],
    toeL: 25,
    toeR: 55,
    grip: [0.18, 1.0, 0.42],
    dir: [0.85, -0.42, 0.3],
    face: a,
  }
  const finish: Key = { t: lead + 0.35, ease: 'out', grip: [0.15, 0.95, 0.5], dir: [0.15, -0.65, 0.75], face: [0, -0.5, 1], spine: [26, -16, 12] }
  const bl = backliftFor(power)
  return [
    { ...bl, grip: [-0.08, 1.35 + 0.1 * power, 0.22], dir: [-0.2, 0.95, 0.25] },
    { t: lead * 0.55, ease: 'in', grip: [0.05, 1.25, 0.35], dir: [0.2, 0.6, 0.75], face: [1, 0, 0], footR: [-0.12, ANKLE, 0.3], pelvis: [-0.03, -0.09, 0.1] },
    c,
    finish,
    { ...finish, t: lead + 0.7 },
    recoverKey(lead + 1.2, c.footL!, c.footR!),
  ]
}

function sweepKeys(aim: number, lead: number, power: number): Key[] {
  const a = aimDir(aim)
  const c: Key = {
    t: lead,
    ease: 'in',
    pelvis: [0.06, -0.48, 0.0],
    hips: [20, 25, 0],
    spine: [38, 25, -6],
    footL: [0.62, ANKLE, 0.06],
    footR: [-0.42, 0.12, -0.06],
    toeL: 40,
    toeR: 0,
    grip: [0.36, 0.42, 0.28],
    dir: [0.92, -0.3, 0.25],
    face: a,
  }
  const finish: Key = { t: lead + 0.35, ease: 'out', grip: [0.15, 0.5, -0.1], dir: [-0.3, -0.15, -0.95], face: [-1, 0, 0], spine: [30, 45, -4] }
  const bl = backliftFor(power)
  return [
    bl,
    { t: lead * 0.6, ease: 'in', pelvis: [0.05, -0.38, 0], footL: [0.55, ANKLE, 0.06], footR: [-0.38, 0.14, -0.06], grip: [0.15, 0.7, 0.35], dir: [0.3, 0.3, 0.9], face: [1, 0, -0.2], spine: [32, 15, -4] },
    c,
    finish,
    { ...finish, t: lead + 0.7 },
    { ...recoverKey(lead + 1.3, [0.4, ANKLE, 0.04], [-0.22, ANKLE, -0.02]), pelvis: [0.08, -0.1, 0.02] },
  ]
}

function flickKeys(aim: number, lead: number, back: boolean, power: number): Key[] {
  const a = aimDir(aim)
  const stride: V = back ? [0.1, ANKLE, 0.02] : [0.55, ANKLE, 0.02]
  const c: Key = {
    t: lead,
    ease: 'in',
    pelvis: back ? [-0.04, -0.06, 0] : [0.22, -0.14, 0.02],
    hips: [30, 8, 0],
    spine: [26, 38, -4],
    footL: stride,
    footR: back ? [-0.32, ANKLE, 0.06] : [-0.2, ANKLE, -0.01],
    toeL: 45,
    toeR: 25,
    grip: [stride[0] + 0.02, back ? 0.9 : 0.66, 0.22],
    dir: [-0.05, -1, -0.12],
    face: a,
  }
  const finish: Key = { t: lead + 0.35, ease: 'out', grip: [0.3, 1.25, -0.12], dir: [0.3, 0.6, -0.75], face: [0, 0.3, -1], spine: [16, 50, -4] }
  return [backliftFor(power), { t: lead * 0.55, ease: 'in', grip: [0.15, 0.92, 0.26], dir: [-0.6, 0.2, 0.0], face: [0.4, 0, 1], footL: lerpV(BACKLIFT.footL!, stride, 0.85), pelvis: lerpV([0, -0.08, 0], c.pelvis!, 0.7) }, c, finish, { ...finish, t: lead + 0.7 }, recoverKey(lead + 1.2, stride, c.footR!)]
}

const LEAVE: Key = {
  t: 0.25,
  pelvis: [-0.02, -0.05, -0.04],
  hips: [4, 2, 0],
  spine: [8, 10, 0],
  footL: [0.3, ANKLE, 0.02],
  footR: [-0.2, ANKLE, -0.06],
  toeL: 22,
  toeR: 0,
  grip: [-0.02, 1.42, 0.12],
  dir: [0.15, 0.9, -0.3],
  face: [0, 0, 1],
}

function batterPose(c: PoseCtx): ProcPose | null {
  const look = c.ball && c.sinceRelease >= 0 ? c.ball : _a.copy(c.ahead).setY(1.6)
  const lead = { drive: 0.2, cut: 0.18, pull: 0.2, sweep: 0.22, flick: 0.17, defend: 0.14 }[c.variant] ?? 0.2
  switch (c.pose) {
    case 'stance': {
      if (c.variant === 'charge' && c.sinceRelease < 0) {
        // Dancing down the track: open up, bat raised.
        const k = sample([{ ...STANCE, t: 0 }, { ...BACKLIFT, t: 0.25, footL: [0.4, ANKLE, 0.05], footR: [0.0, ANKLE, 0.0], pelvis: [0.15, -0.1, 0.02] }], c.t)
        return toPose(k, { look })
      }
      // The trigger: a small lift as the bowler gathers, the full backlift as the ball is released.
      const pre = c.toRelease >= 0 ? clamp01(1 - c.toRelease / 0.35) * 0.4 : 0
      const lift = c.sinceRelease >= 0 ? 0.4 + 0.6 * smooth(Math.min(1, c.sinceRelease / 0.22)) : pre
      const k = sample([{ ...STANCE, t: 0 }, { ...BACKLIFT, t: 1, ease: 'in' }], lift)
      // Breathing and a little sway while waiting, a tap of the bat.
      const idle = 1 - lift
      const sway = Math.sin(c.t * 1.1) * 0.012 * idle
      const breathe = Math.sin(c.t * 2.2) * idle
      const tap = Math.max(0, Math.sin(c.t * 3.2)) * 0.035 * idle
      if (k.pelvis) k.pelvis = [k.pelvis[0] + sway, k.pelvis[1] + breathe * 0.004, k.pelvis[2] + Math.sin(c.t * 0.7) * 0.006 * idle]
      if (k.spine) k.spine = [k.spine[0] + breathe * 1.2, k.spine[1], k.spine[2] + sway * 30]
      if (k.grip) k.grip = [k.grip[0] + sway * 0.6, k.grip[1] + tap + breathe * 0.004, k.grip[2]]
      return toPose(k, { look })
    }
    case 'shot': {
      const back = c.feet === 'back'
      let keys: Key[]
      switch (c.variant) {
        case 'defend':
          keys = defendKeys(lead, back, c.power)
          break
        case 'pull':
          keys = pullKeys(c.aim, lead, c.loft, c.power)
          break
        case 'cut':
          keys = cutKeys(c.aim, lead, c.power)
          break
        case 'sweep':
          keys = sweepKeys(c.aim, lead, c.power)
          break
        case 'flick':
          keys = flickKeys(c.aim, lead, back, c.power)
          break
        default:
          keys = back ? flickKeys(Math.max(-20, Math.min(40, c.aim)), lead, true, c.power).map((k, i) => (i === 2 ? { ...k, dir: [-0.12, -1, 0.05] as V, face: aimDir(c.aim) } : k)) : driveKeys(c.aim, lead, c.loft, c.feet === 'charge', c.power)
      }
      return toPose(sample(keys, c.t), { look })
    }
    case 'leave':
      return toPose(sample([{ ...BACKLIFT, t: 0 }, LEAVE, { ...LEAVE, t: 0.9 }, recoverKey(1.5, LEAVE.footL!, LEAVE.footR!)], c.t), { look })
    case 'batslide': {
      // Stretching the bat into the crease: lunge forward, bat along the ground, then straighten up again.
      const k = smooth(Math.min(1, c.t / 0.2)) * (1 - smooth(clamp01((c.t - 0.55) / 0.35)))
      return {
        weight: 1,
        noLock: true,
        pelvis: new THREE.Vector3(0, -0.32 * k, 0.15 * k),
        spine: [45 * k, 0, 0],
        footL: new THREE.Vector3(0.12, ANKLE, 0.55 * k),
        footR: new THREE.Vector3(-0.12, ANKLE + 0.05 * k, -0.45 * k),
        handR: new THREE.Vector3(-0.08, 0.55 - 0.2 * k, 0.75 + 0.15 * k),
        handL: new THREE.Vector3(0.2, 0.9, 0.3),
        bat: { grip: new THREE.Vector3(-0.08, 0.5 - 0.2 * k, 0.8 + 0.15 * k), dir: new THREE.Vector3(0, -0.3, 1), face: new THREE.Vector3(0, 1, 0) },
        look: _a.set(0, 1.0, 3),
      }
    }
    default:
      return null
  }
}

/* ---------------- bowling ---------------- */
// Bowler's character space: +Z is the direction of the run, +X his left. A right-armer bowls with his right (-X) arm.

function paceKeys(): Key[] {
  return [
    { t: 0, pelvis: [0, 0.1, 0], hips: [0, -4, 0], spine: [-4, 0, 0], footL: [0.12, 0.42, 0.22], footR: [-0.1, 0.2, -0.28], toeL: 0, toeR: 0, handL: [0.08, 1.38, 0.3], handR: [-0.06, 1.34, 0.3], wristR: 0 },
    { t: 0.22, pelvis: [0, 0.02, 0.05], hips: [-55, -6, 0], spine: [-12, -30, 4], footL: [0.06, 0.34, 0.45], footR: [-0.04, ANKLE, -0.05], toeR: -80, toeL: -20, handL: [0.16, 2.02, 0.5], handR: [-0.28, 1.05, -0.4], wristR: 15 },
    { t: 0.42, ease: 'in', pelvis: [0, -0.1, 0.32], hips: [-30, 8, 0], spine: [6, -24, 2], footL: [0.06, ANKLE, 0.92], footR: [-0.06, 0.16, 0.02], toeL: 0, toeR: -60, handL: [0.3, 1.5, 0.8], handR: [-0.36, 1.82, -0.42], wristR: 20 },
    { t: 0.6, ease: 'in', pelvis: [0, -0.12, 0.45], hips: [0, 18, 0], spine: [26, 10, 0], footL: [0.06, ANKLE, 0.95], footR: [-0.1, 0.24, 0.12], toeL: 0, toeR: -20, handL: [0.28, 0.98, 0.18], handR: [-0.16, 2.25, 0.62], wristR: -30 },
  ]
}

function spinKeys(): Key[] {
  return [
    { t: 0, pelvis: [0, 0.04, 0], spine: [-2, 0, 0], footL: [0.1, 0.3, 0.18], footR: [-0.1, ANKLE, -0.2], handL: [0.1, 1.35, 0.3], handR: [-0.05, 1.32, 0.3], wristR: 0 },
    { t: 0.2, pelvis: [0, -0.02, 0.05], hips: [-50, 0, 0], spine: [-6, -25, 0], footL: [0.05, 0.25, 0.4], footR: [-0.04, ANKLE, -0.05], toeR: -80, toeL: -15, handL: [0.18, 1.85, 0.5], handR: [-0.3, 1.15, -0.3], wristR: 25 },
    { t: 0.36, ease: 'in', pelvis: [0, -0.07, 0.25], hips: [-25, 6, 0], spine: [6, -18, 0], footL: [0.08, ANKLE, 0.72], footR: [-0.06, 0.12, 0.0], toeL: 0, toeR: -60, handL: [0.3, 1.45, 0.7], handR: [-0.35, 1.7, -0.25], wristR: 35 },
    { t: 0.5, ease: 'in', pelvis: [0, -0.1, 0.35], hips: [0, 14, 0], spine: [20, 12, 0], footL: [0.08, ANKLE, 0.75], footR: [-0.08, 0.2, 0.1], toeR: -20, handL: [0.26, 1.0, 0.2], handR: [-0.22, 2.1, 0.45], wristR: -45 },
  ]
}

function followKeys(spin: boolean): Key[] {
  const rel = (spin ? spinKeys() : paceKeys()).at(-1)!
  return [
    { ...rel, t: 0 },
    { t: spin ? 0.2 : 0.25, ease: 'out', pelvis: [0, -0.2, 0.6], hips: [10, 20, 0], spine: [spin ? 30 : 45, 25, 0], footL: [0.06, ANKLE, 0.95], footR: [-0.05, 0.32, 0.65], toeR: 0, handR: [0.25, 0.78, 0.55], handL: [0.3, 0.95, -0.1], wristR: 0 },
    { t: 0.6, pelvis: [0, -0.08, 0.6], hips: [0, 6, 0], spine: [15, 10, 0], footL: [0.1, ANKLE, 1.0], footR: [-0.1, ANKLE, 1.25], handR: [-0.2, 0.9, 0.4], handL: [0.25, 0.95, 0.2] },
  ]
}

const LOOK_DOWN_PITCH = new THREE.Vector3(0, 1.4, 20)
const ELBOW_BOWL_R = new THREE.Vector3(-0.5, 0, -1)
const ELBOW_BOWL_L = new THREE.Vector3(0.6, -0.5, 0.4)
const ELBOW_FOLLOW_R = new THREE.Vector3(-0.3, -0.5, 1)

function bowlerPose(c: PoseCtx): ProcPose | null {
  const spin = c.style === 'offspin' || c.style === 'legspin'
  if (c.pose === 'deliver') {
    const keys = spin ? spinKeys() : paceKeys()
    // The feet are in the air through the gather: no ground lock until the front foot lands.
    return toPose(sample(keys, c.t), { look: LOOK_DOWN_PITCH, elbowR: ELBOW_BOWL_R, elbowL: ELBOW_BOWL_L })
  }
  if (c.pose === 'follow') {
    if (c.t > 0.85) return null
    const p = toPose(sample(followKeys(spin), c.t), { elbowR: ELBOW_FOLLOW_R, look: c.ball ?? LOOK_DOWN_PITCH })
    p.weight = c.t < 0.6 ? 1 : 1 - (c.t - 0.6) / 0.25
    return p
  }
  return null
}

/* ---------------- fielding and keeping ---------------- */

const CHEST = new THREE.Vector3(0, 1.3, 0.1)

function reachFor(ball: THREE.Vector3, maxReach = 0.85): THREE.Vector3 {
  // Hands go towards the ball, limited to what the arms can reach from the chest.
  const d = _rb.copy(ball).sub(CHEST)
  if (d.length() > maxReach) d.setLength(maxReach)
  return d.add(CHEST)
}

function keeperPose(c: PoseCtx): ProcPose | null {
  if (c.pose === 'keeper' || c.pose === 'keepertake') {
    // Crouched, settling lower as the bowler gathers; rises as the ball is bowled and takes it in front of the chest.
    const rise = c.sinceRelease < 0 ? 0 : smooth(Math.min(1, c.sinceRelease / 0.3))
    const settle = c.toRelease >= 0 ? clamp01(1 - c.toRelease / 0.6) : 0
    const take = c.pose === 'keepertake' ? 1 : 0
    const ball = c.ball && (take || c.sinceRelease >= 0) ? c.ball : null
    const idle = (1 - rise) * (1 - take)
    const bob = Math.sin(c.t * 1.3) * 0.012 * idle
    let hands: THREE.Vector3 = _a.set(0, 0.42 + rise * 0.25 - settle * 0.06, 0.5)
    if (ball && ball.z > -0.5) hands = reachFor(_b.copy(ball).setZ(Math.max(0.35, Math.min(0.7, ball.z))), 0.95)
    if (take) {
      // Glove snap: meet the ball, then bring it into the body.
      const pull = smooth(clamp01((c.t - 0.1) / 0.25))
      hands = _a.copy(hands).lerp(_b.set(0, 1.08, 0.32), pull)
    }
    const h = damp(c.mem, hands, c.dt, take ? 30 : 20)
    const lift = ball ? Math.max(0, ball.y - 1.0) * 0.4 : 0
    const pel = new THREE.Vector3(0, -0.4 + rise * 0.18 - settle * 0.05 + lift + bob + take * 0.12 * smooth(clamp01((c.t - 0.1) / 0.3)), -0.16 + rise * 0.06)
    return {
      weight: 1,
      pelvis: pel,
      spine: [40 - rise * 14 + settle * 3 - take * 10 * smooth(clamp01((c.t - 0.1) / 0.3)), 0, 0],
      footL: new THREE.Vector3(0.22, ANKLE + 0.03, 0.04),
      footR: new THREE.Vector3(-0.22, ANKLE + 0.03, 0.04),
      toeL: 14,
      toeR: -14,
      kneeL: new THREE.Vector3(0.6, 0.2, 1),
      kneeR: new THREE.Vector3(-0.6, 0.2, 1),
      handL: h.clone().add(new THREE.Vector3(0.07, 0, 0)),
      handR: h.clone().add(new THREE.Vector3(-0.07, 0, 0)),
      elbowL: new THREE.Vector3(1, -0.6, 0),
      elbowR: new THREE.Vector3(-1, -0.6, 0),
      look: c.ball ?? _b.copy(c.ahead).setY(1.2),
    }
  }
  return null
}

/** Leaning into turns and acceleration while moving (on top of the run clips). */
function leanPose(c: PoseCtx): ProcPose | null {
  if (c.speed < 1) return null
  const sp = Math.min(1, c.speed / 6)
  const roll = Math.max(-10, Math.min(10, -c.yawRate * 0.05 * sp))
  const pitch = Math.max(-8, Math.min(12, c.accel * 1.6)) + sp * 3
  if (Math.abs(roll) < 0.2 && Math.abs(pitch) < 0.2) return null
  return { weight: 1, additive: true, hips: [0, pitch * 0.5, roll * 0.6], spine: [pitch * 0.5, 0, roll * 0.4] }
}

function fielderPose(c: PoseCtx): ProcPose | null {
  switch (c.pose) {
    case 'ready': {
      if (c.speed > 0.6) return null
      // Bouncing on the toes, hands loose; lower as the ball is about to be bowled.
      const settle = c.toRelease >= 0 ? clamp01(1 - c.toRelease / 0.8) : c.sinceRelease >= 0 && c.sinceRelease < 1.5 ? 1 : 0
      const bob = Math.sin(c.t * 1.6) * 0.01 + Math.sin(c.t * 3.1) * 0.004
      const h = damp(c.mem, _a.set(0, 0.68 - settle * 0.08 + bob * 0.5, 0.32 + settle * 0.04), c.dt, 12)
      return {
        weight: 1,
        pelvis: new THREE.Vector3(0, -0.13 - settle * 0.06 + bob, -0.02),
        spine: [24 + settle * 6 + bob * 40, 0, 0],
        footL: new THREE.Vector3(0.24, ANKLE, 0.04),
        footR: new THREE.Vector3(-0.24, ANKLE, 0.04),
        toeL: 12,
        toeR: -12,
        handL: h.clone().add(new THREE.Vector3(0.2, 0, 0)),
        handR: h.clone().add(new THREE.Vector3(-0.2, 0, 0)),
        elbowL: new THREE.Vector3(1, -0.4, -0.2),
        elbowR: new THREE.Vector3(-1, -0.4, -0.2),
        look: c.ball ?? c.ahead,
      }
    }
    case 'catch': {
      const ball = c.ball ?? DEFAULT_CATCH
      const target = c.hasBall && c.t > 0.35 ? _a.set(0, 1.75 + Math.min(0.4, (c.t - 0.35) * 2), 0.2) : reachFor(ball)
      const hands = damp(c.mem, target, c.dt, 26)
      const low = Math.max(0, 0.9 - hands.y)
      return {
        weight: 1,
        pelvis: new THREE.Vector3(0, -0.08 - low * 0.5, 0),
        spine: [10 + low * 40, 0, 0],
        footL: new THREE.Vector3(0.2, ANKLE, 0.1),
        footR: new THREE.Vector3(-0.2, ANKLE, -0.05),
        handL: hands.clone().add(new THREE.Vector3(0.06, 0, 0)),
        handR: hands.clone().add(new THREE.Vector3(-0.06, 0, 0)),
        elbowL: new THREE.Vector3(1, -1, 0),
        elbowR: new THREE.Vector3(-1, -1, 0),
        look: ball,
      }
    }
    case 'dive': {
      const k = smooth(Math.min(1, c.t / 0.32))
      const angle = 78 * k
      return {
        weight: 1,
        body: { axis: new THREE.Vector3(1, 0, 0), angle, offset: new THREE.Vector3(0, 0.12 * k, 0.3 * k) },
        pelvis: new THREE.Vector3(0, 0, 0),
        spine: [-6 * k, 0, 0],
        footL: new THREE.Vector3(0.14, ANKLE + 0.05 * k, -0.1 * k),
        footR: new THREE.Vector3(-0.14, ANKLE + 0.12 * k, -0.2 * k),
        handL: new THREE.Vector3(0.18, 1.85 + 0.25 * k, 0.25),
        handR: new THREE.Vector3(-0.18, 1.85 + 0.25 * k, 0.25),
        look: _b.set(0, 3, 4),
      }
    }
    case 'getup': {
      const k = 1 - smooth(Math.min(1, c.t / 0.7))
      if (k <= 0.01) return null
      return {
        weight: 1,
        body: { axis: new THREE.Vector3(1, 0, 0), angle: 78 * k, offset: new THREE.Vector3(0, 0.12 * k, 0.3 * k) },
        pelvis: new THREE.Vector3(0, -0.2 * (1 - k), 0),
        spine: [20 * (1 - k), 0, 0],
        footL: new THREE.Vector3(0.14, ANKLE, 0.1 * (1 - k)),
        footR: new THREE.Vector3(-0.14, ANKLE + 0.05 * k, -0.2 * k),
        handL: new THREE.Vector3(0.25, 1.0 + 0.9 * k, 0.4),
        handR: new THREE.Vector3(-0.25, 1.0 + 0.9 * k, 0.4),
      }
    }
    case 'appeal': {
      const k = smooth(Math.min(1, c.t / 0.25))
      // Arms up, then a couple of bounces on the spot.
      const bounce = c.t > 0.25 ? Math.max(0, Math.sin((c.t - 0.25) * 9)) * 0.05 * Math.exp(-(c.t - 0.25) * 0.8) : 0
      return {
        weight: 1,
        pelvis: new THREE.Vector3(0, 0.02 + bounce * 0.6, 0),
        spine: [-10 * k, 0, 0],
        footL: new THREE.Vector3(0.18, ANKLE, 0.08),
        footR: new THREE.Vector3(-0.18, ANKLE, -0.05),
        handL: new THREE.Vector3(0.3, 1.4 + 0.75 * k + bounce, 0.25),
        handR: new THREE.Vector3(-0.3, 1.4 + 0.75 * k + bounce, 0.25),
        elbowL: new THREE.Vector3(1, 0, -0.2),
        elbowR: new THREE.Vector3(-1, 0, -0.2),
        look: _b.copy(c.ahead).setY(2.2),
      }
    }
    case 'throw': {
      // The clip throws; the trunk winds up and comes through with it.
      const wind = -32 * smooth(clamp01(c.t / 0.18))
      const through = 55 * smooth(clamp01((c.t - 0.18) / 0.2))
      const settle = 1 - smooth(clamp01((c.t - 0.45) / 0.3))
      const twist = (wind + through) * settle
      if (Math.abs(twist) < 0.5) return null
      return { weight: 1, additive: true, hips: [twist * 0.35, 0, 0], spine: [through * 0.12 * settle, twist * 0.5, -through * 0.08 * settle] }
    }
    case 'run':
    case 'walk':
    case 'runup':
      return leanPose(c)
    default:
      return null
  }
}

/* ---------------- umpires ---------------- */

function umpirePose(c: PoseCtx): ProcPose | null {
  const base = { footL: new THREE.Vector3(0.16, ANKLE, 0), footR: new THREE.Vector3(-0.16, ANKLE, 0) }
  if (c.pose === 'umpire') {
    if (c.sinceRelease >= 0 && c.sinceRelease < 2.5) {
      // Bending to watch the delivery, straightening up again as the ball goes dead.
      const k = 1 - smooth(clamp01((c.sinceRelease - 1.8) / 0.7))
      return { weight: 1, ...base, pelvis: new THREE.Vector3(0, -0.06 * k, 0), spine: [22 * k, 0, 0], handL: new THREE.Vector3(0.12, 0.85 + 0.1 * (1 - k), 0.28 - 0.08 * (1 - k)), handR: new THREE.Vector3(-0.12, 0.85 + 0.1 * (1 - k), 0.28 - 0.08 * (1 - k)), look: c.ball ?? c.ahead }
    }
    if (c.toRelease >= 0 && c.toRelease < 1.2) {
      // Settling into the crouch as the bowler comes in.
      const k = smooth(1 - c.toRelease / 1.2)
      return { weight: 1, ...base, pelvis: new THREE.Vector3(0, -0.06 * k, 0), spine: [22 * k, 0, 0], handL: new THREE.Vector3(0.12, 0.95 - 0.1 * k, 0.2 + 0.08 * k), handR: new THREE.Vector3(-0.12, 0.95 - 0.1 * k, 0.2 + 0.08 * k), look: c.ahead }
    }
    return null
  }
  if (c.pose !== 'signal') return null
  const k = smooth(Math.min(1, c.t / 0.3))
  // A firm signal that settles a touch once it is up.
  const settle = c.t > 0.3 ? 1 - 0.04 * smooth(clamp01((c.t - 0.3) / 0.4)) : 1
  const rest = new THREE.Vector3(0, 0.95, 0.15)
  const L = (v: V) => rest.clone().add(new THREE.Vector3(0.18, 0, 0)).lerp(vec(v), k * settle)
  const R = (v: V) => rest.clone().add(new THREE.Vector3(-0.18, 0, 0)).lerp(vec(v), k * settle)
  const look = _b.copy(c.ahead).setY(1.6)
  switch (c.variant) {
    case 'out':
      return { weight: 1, ...base, handR: R([-0.12, 2.28, 0.32]), handL: L([0.2, 0.9, 0.05]), elbowR: new THREE.Vector3(-1, 0, 0), look }
    case 'six':
      return { weight: 1, ...base, handR: R([-0.18, 2.3, 0.1]), handL: L([0.18, 2.3, 0.1]), look }
    case 'four': {
      const s = Math.sin(c.t * 7)
      return { weight: 1, ...base, handR: R([-0.35 + s * 0.55, 1.28, 0.5]), handL: L([0.2, 0.9, 0.05]), elbowR: new THREE.Vector3(0, -1, 0), look }
    }
    case 'wide':
      return { weight: 1, ...base, handR: R([-0.88, 1.45, 0.05]), handL: L([0.88, 1.45, 0.05]), look }
    case 'noball':
      return { weight: 1, ...base, handR: R([-0.88, 1.45, 0.1]), handL: L([0.2, 0.9, 0.05]), look }
    case 'bye':
      return { weight: 1, ...base, handR: R([-0.1, 2.25, 0.2]), handL: L([0.2, 0.9, 0.05]), look }
    case 'legbye':
      return { weight: 1, footR: base.footR, footL: new THREE.Vector3(0.14, 0.42 * k + ANKLE, 0.28 * k), handR: R([0.05, 0.62, 0.36]), handL: L([0.25, 0.95, 0.05]), look }
    case 'freehit': {
      const a = c.t * 6
      return { weight: 1, ...base, handR: R([-0.15 + Math.cos(a) * 0.2, 2.1 + Math.sin(a) * 0.15, 0.2]), handL: L([0.2, 0.9, 0.05]), look }
    }
    case 'tv': {
      // Drawing a TV screen in the air.
      const p = (c.t * 0.9) % 1
      const corners: V[] = [[0.35, 1.65, 0.35], [-0.35, 1.65, 0.35], [-0.35, 1.25, 0.35], [0.35, 1.25, 0.35], [0.35, 1.65, 0.35]]
      const i = Math.floor(p * 4)
      const f = p * 4 - i
      const pt = lerpV(corners[i], corners[i + 1], f)
      return { weight: 1, ...base, handR: R(pt), handL: L([-pt[0], pt[1], pt[2]]), look }
    }
    default:
      return null
  }
}

/** The procedural pose for this frame, or null to show the plain clip. */
export function procPose(c: PoseCtx): ProcPose | null {
  switch (c.kind) {
    case 'striker':
      return batterPose(c) ?? (c.pose === 'run' ? leanPose(c) : null)
    case 'nonstriker':
      return c.pose === 'batslide' ? batterPose(c) : c.pose === 'run' || c.pose === 'walk' ? leanPose(c) : null
    case 'bowler':
      return bowlerPose(c) ?? fielderPose(c)
    case 'keeper':
      return keeperPose(c) ?? fielderPose(c)
    case 'umpire':
      return umpirePose(c)
    default:
      return fielderPose(c)
  }
}

/** How long the crossfade into a new motion state should take (seconds). */
export function fadeFor(pose: Pose, from: Pose): number {
  switch (pose) {
    case 'shot':
      return from === 'stance' ? 0.1 : 0.14
    case 'deliver':
      return 0.16
    case 'follow':
      return 0.12
    case 'keepertake':
    case 'catch':
      return 0.1
    case 'dive':
    case 'slide':
    case 'batslide':
      return 0.14
    case 'stance':
    case 'keeper':
    case 'ready':
    case 'idle':
    case 'umpire':
      return 0.3
    case 'run':
    case 'walk':
    case 'runup':
      return 0.22
    default:
      return 0.2
  }
}
