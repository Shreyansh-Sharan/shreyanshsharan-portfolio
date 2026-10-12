// Cricket movement authored as keyframes in character space (+Z the way the body faces, +X its left, y up):
// batting stance, backlift and strokes (forward and back defence, drives, flick, pull, cut, sweep, lofted shots, the
// leave), bowling actions for pace and spin, keeping, fielding (ready, catch, dive), appeals and umpire signals.
import * as THREE from 'three'
import type { ProcPose } from './rig'
import type { Pose } from '../sim/director'
import type { BowlStyle } from '../sim/delivery'
import type { Footwork } from '../sim/shots'

type V = [number, number, number]

export interface PoseCtx {
  pose: Pose
  t: number
  variant: string
  feet: Footwork
  loft: boolean
  /** Shot direction (degrees, 0 straight, + off side). */
  aim: number
  /** The ball in character space. */
  ball: THREE.Vector3 | null
  /** Seconds since the ball was released (-1 before). */
  sinceRelease: number
  /** The other end (for batters and keepers: where the bowler is), character space. */
  ahead: THREE.Vector3
  kind: 'striker' | 'nonstriker' | 'bowler' | 'keeper' | 'fielder' | 'umpire'
  style: BowlStyle
  hasBall: boolean
  speed: number
}

interface Key {
  t: number
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
}

const smooth = (x: number) => x * x * (3 - 2 * x)
const lerpV = (a: V, b: V, k: number): V => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const vec = (v: V) => new THREE.Vector3(v[0], v[1], v[2])

function slerpDir(a: V, b: V, k: number): V {
  const va = vec(a).normalize()
  const vb = vec(b).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(va, vb)
  const r = new THREE.Quaternion().slerp(q, k)
  return va.applyQuaternion(r).toArray() as V
}

/** Interpolates a keyframe list at time t (smoothstep between keys). Missing fields carry over. */
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
      const k = smooth((t - a.t) / Math.max(1e-4, b.t - a.t))
      const out: Key = { t }
      for (const f of ['pelvis', 'hips', 'spine', 'footL', 'footR', 'handL', 'handR', 'grip'] as const) if (a[f] && b[f]) out[f] = lerpV(a[f]!, b[f]!, k)
      for (const f of ['toeL', 'toeR'] as const) if (a[f] !== undefined && b[f] !== undefined) out[f] = a[f]! + (b[f]! - a[f]!) * k
      for (const f of ['dir', 'face'] as const) if (a[f] && b[f]) out[f] = slerpDir(a[f]!, b[f]!, k)
      return out
    }
  }
  return full[full.length - 1]
}

const ANKLE = 0.086

function toPose(k: Key, extra: Partial<ProcPose> = {}): ProcPose {
  const p: ProcPose = { weight: 1, ...extra }
  if (k.pelvis) p.pelvis = vec(k.pelvis)
  if (k.hips) p.hips = k.hips
  if (k.spine) p.spine = k.spine
  if (k.footL) p.footL = vec(k.footL)
  if (k.footR) p.footR = vec(k.footR)
  if (k.toeL !== undefined) p.toeL = k.toeL
  if (k.toeR !== undefined) p.toeR = k.toeR
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

const aimDir = (aim: number): V => [Math.cos((aim * Math.PI) / 180), 0, Math.sin((aim * Math.PI) / 180)]

function driveKeys(aim: number, lead: number, loft: boolean, charge: boolean): Key[] {
  const a = aimDir(aim)
  const side = Math.sin((aim * Math.PI) / 180)
  const stride: V = charge ? [0.75, ANKLE, 0.08] : [0.64, ANKLE, 0.1 + 0.12 * side]
  const front: Key = {
    t: lead,
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
  const mid: Key = { t: lead * 0.55, grip: [0.18, 0.95, 0.24], dir: [-0.65, 0.3, -0.05], face: [0.3, 0, 1], pelvis: [0.14, -0.13, 0.02], spine: [24, 22, 0], footL: lerpV(BACKLIFT.footL!, stride, 0.7) }
  const follow1: Key = { t: lead + 0.14, grip: [stride[0] + 0.05, 0.98 + (loft ? 0.12 : 0), stride[2] + 0.18 + side * 0.08], dir: [0.55 + a[0] * 0.2, 0.55, a[2] * 0.6], face: [0, 1, 0] }
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
  return [{ ...BACKLIFT, t: 0 }, mid, front, follow1, finish, { ...finish, t: lead + 1.2 }]
}

function defendKeys(lead: number, back: boolean): Key[] {
  if (back) {
    const k: Key = {
      t: lead,
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
    return [{ ...BACKLIFT, t: 0 }, k, { ...k, t: lead + 0.8 }]
  }
  const k: Key = {
    t: lead,
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
  return [{ ...BACKLIFT, t: 0 }, { t: lead * 0.6, grip: [0.15, 0.95, 0.27], dir: [-0.4, -0.6, 0], face: [1, 0, 0.3] }, k, { ...k, t: lead + 0.8 }]
}

function pullKeys(aim: number, lead: number, loft: boolean): Key[] {
  const a = aimDir(aim)
  const contactDir: V = [-a[2], -0.18, a[0]].map((x) => -x) as V
  // Toe out in front (towards the bowler/off), face towards the leg-side target.
  if (contactDir[0] < 0) (contactDir[0] = -contactDir[0]), (contactDir[2] = -contactDir[2])
  const c: Key = {
    t: lead,
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
  const finish: Key = { t: lead + 0.4, grip: [-0.05, 1.32 + (loft ? 0.1 : 0), -0.3], dir: [-0.75, 0.35, -0.55], face: [-0.5, 0, -1], spine: [6, 70, 10], hips: [75, 0, 0] }
  return [{ ...BACKLIFT, t: 0, grip: [-0.18, 1.22, 0.24], dir: [-0.4, 0.7, 0.55] }, { t: lead * 0.6, grip: [0.0, 1.2, 0.25], dir: [0.15, 0.25, 1], face: [1, 0, -0.3], hips: [30, 0, 0], spine: [12, 30, 4] }, c, finish, { ...finish, t: lead + 1.1 }]
}

function cutKeys(aim: number, lead: number): Key[] {
  const a = aimDir(aim)
  const c: Key = {
    t: lead,
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
  const finish: Key = { t: lead + 0.35, grip: [0.15, 0.95, 0.5], dir: [0.15, -0.65, 0.75], face: [0, -0.5, 1], spine: [26, -16, 12] }
  return [{ ...BACKLIFT, t: 0, grip: [-0.08, 1.35, 0.22], dir: [-0.2, 0.95, 0.25] }, { t: lead * 0.55, grip: [0.05, 1.25, 0.35], dir: [0.2, 0.6, 0.75], face: [1, 0, 0] }, c, finish, { ...finish, t: lead + 1.0 }]
}

function sweepKeys(aim: number, lead: number): Key[] {
  const a = aimDir(aim)
  const c: Key = {
    t: lead,
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
  const finish: Key = { t: lead + 0.35, grip: [0.15, 0.5, -0.1], dir: [-0.3, -0.15, -0.95], face: [-1, 0, 0], spine: [30, 45, -4] }
  return [{ ...BACKLIFT, t: 0 }, { t: lead * 0.6, pelvis: [0.05, -0.38, 0], footL: [0.55, ANKLE, 0.06], footR: [-0.38, 0.14, -0.06], grip: [0.15, 0.7, 0.35], dir: [0.3, 0.3, 0.9], face: [1, 0, -0.2], spine: [32, 15, -4] }, c, finish, { ...finish, t: lead + 1.0 }]
}

function flickKeys(aim: number, lead: number, back: boolean): Key[] {
  const a = aimDir(aim)
  const stride: V = back ? [0.1, ANKLE, 0.02] : [0.55, ANKLE, 0.02]
  const c: Key = {
    t: lead,
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
  const finish: Key = { t: lead + 0.35, grip: [0.3, 1.25, -0.12], dir: [0.3, 0.6, -0.75], face: [0, 0.3, -1], spine: [16, 50, -4] }
  return [{ ...BACKLIFT, t: 0 }, { t: lead * 0.55, grip: [0.15, 0.92, 0.26], dir: [-0.6, 0.2, 0.0], face: [0.4, 0, 1] }, c, finish, { ...finish, t: lead + 1.0 }]
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
  const look = c.ball && c.sinceRelease >= 0 ? c.ball.clone() : c.ahead.clone().setY(1.6)
  const lead = { drive: 0.2, cut: 0.18, pull: 0.2, sweep: 0.22, flick: 0.17, defend: 0.14 }[c.variant] ?? 0.2
  switch (c.pose) {
    case 'stance': {
      if (c.variant === 'charge' && c.sinceRelease < 0) {
        // Dancing down the track: open up, bat raised.
        const k = sample([{ ...STANCE, t: 0 }, { ...BACKLIFT, t: 0.25, footL: [0.4, ANKLE, 0.05], footR: [0.0, ANKLE, 0.0], pelvis: [0.15, -0.1, 0.02] }], c.t)
        return toPose(k, { look })
      }
      // Trigger: lift the bat as the ball is released.
      const lift = c.sinceRelease < 0 ? 0 : smooth(Math.min(1, c.sinceRelease / 0.25))
      const tap = c.sinceRelease < 0 ? Math.max(0, Math.sin(c.t * 3.2)) * 0.035 : 0
      const k = sample([{ ...STANCE, t: 0 }, { ...BACKLIFT, t: 1 }], lift)
      if (k.grip && tap) k.grip = [k.grip[0], k.grip[1] + tap, k.grip[2]]
      return toPose(k, { look })
    }
    case 'shot': {
      const back = c.feet === 'back'
      let keys: Key[]
      switch (c.variant) {
        case 'defend':
          keys = defendKeys(lead, back)
          break
        case 'pull':
          keys = pullKeys(c.aim, lead, c.loft)
          break
        case 'cut':
          keys = cutKeys(c.aim, lead)
          break
        case 'sweep':
          keys = sweepKeys(c.aim, lead)
          break
        case 'flick':
          keys = flickKeys(c.aim, lead, back)
          break
        default:
          keys = back ? flickKeys(Math.max(-20, Math.min(40, c.aim)), lead, true).map((k, i) => (i === 2 ? { ...k, dir: [-0.12, -1, 0.05] as V, face: aimDir(c.aim) } : k)) : driveKeys(c.aim, lead, c.loft, c.feet === 'charge')
      }
      return toPose(sample(keys, c.t), { look })
    }
    case 'leave':
      return toPose(sample([{ ...BACKLIFT, t: 0 }, LEAVE, { ...LEAVE, t: 2 }], c.t), { look })
    case 'batslide': {
      // Stretching the bat into the crease: lunge forward, bat along the ground.
      const k = Math.min(1, c.t / 0.2)
      return {
        weight: 1,
        pelvis: new THREE.Vector3(0, -0.32 * k, 0.15 * k),
        spine: [45 * k, 0, 0],
        footL: new THREE.Vector3(0.12, ANKLE, 0.55 * k),
        footR: new THREE.Vector3(-0.12, ANKLE + 0.05, -0.45 * k),
        handR: new THREE.Vector3(-0.08, 0.55 - 0.2 * k, 0.75 + 0.15 * k),
        handL: new THREE.Vector3(0.2, 0.9, 0.3),
        bat: { grip: new THREE.Vector3(-0.08, 0.5 - 0.2 * k, 0.8 + 0.15 * k), dir: new THREE.Vector3(0, -0.3, 1), face: new THREE.Vector3(0, 1, 0) },
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
    { t: 0, pelvis: [0, 0.1, 0], hips: [0, -4, 0], spine: [-4, 0, 0], footL: [0.12, 0.42, 0.22], footR: [-0.1, 0.2, -0.28], toeL: 0, toeR: 0, handL: [0.08, 1.38, 0.3], handR: [-0.06, 1.34, 0.3] },
    { t: 0.22, pelvis: [0, 0.02, 0.05], hips: [-55, -6, 0], spine: [-12, -30, 4], footL: [0.06, 0.34, 0.45], footR: [-0.04, ANKLE, -0.05], toeR: -80, toeL: -20, handL: [0.16, 2.02, 0.5], handR: [-0.28, 1.05, -0.4] },
    { t: 0.42, pelvis: [0, -0.1, 0.32], hips: [-30, 8, 0], spine: [6, -24, 2], footL: [0.06, ANKLE, 0.92], footR: [-0.06, 0.16, 0.02], toeL: 0, toeR: -60, handL: [0.3, 1.5, 0.8], handR: [-0.36, 1.82, -0.42] },
    { t: 0.6, pelvis: [0, -0.12, 0.45], hips: [0, 18, 0], spine: [26, 10, 0], footL: [0.06, ANKLE, 0.95], footR: [-0.1, 0.24, 0.12], toeL: 0, toeR: -20, handL: [0.28, 0.98, 0.18], handR: [-0.16, 2.25, 0.62] },
  ]
}

function spinKeys(): Key[] {
  return [
    { t: 0, pelvis: [0, 0.04, 0], spine: [-2, 0, 0], footL: [0.1, 0.3, 0.18], footR: [-0.1, ANKLE, -0.2], handL: [0.1, 1.35, 0.3], handR: [-0.05, 1.32, 0.3] },
    { t: 0.2, pelvis: [0, -0.02, 0.05], hips: [-50, 0, 0], spine: [-6, -25, 0], footL: [0.05, 0.25, 0.4], footR: [-0.04, ANKLE, -0.05], toeR: -80, toeL: -15, handL: [0.18, 1.85, 0.5], handR: [-0.3, 1.15, -0.3] },
    { t: 0.36, pelvis: [0, -0.07, 0.25], hips: [-25, 6, 0], spine: [6, -18, 0], footL: [0.08, ANKLE, 0.72], footR: [-0.06, 0.12, 0.0], toeL: 0, toeR: -60, handL: [0.3, 1.45, 0.7], handR: [-0.35, 1.7, -0.25] },
    { t: 0.5, pelvis: [0, -0.1, 0.35], hips: [0, 14, 0], spine: [20, 12, 0], footL: [0.08, ANKLE, 0.75], footR: [-0.08, 0.2, 0.1], toeR: -20, handL: [0.26, 1.0, 0.2], handR: [-0.22, 2.1, 0.45] },
  ]
}

function followKeys(spin: boolean): Key[] {
  const rel = (spin ? spinKeys() : paceKeys()).at(-1)!
  return [
    { ...rel, t: 0 },
    { t: spin ? 0.2 : 0.25, pelvis: [0, -0.2, 0.6], hips: [10, 20, 0], spine: [spin ? 30 : 45, 25, 0], footL: [0.06, ANKLE, 0.95], footR: [-0.05, 0.32, 0.65], toeR: 0, handR: [0.25, 0.78, 0.55], handL: [0.3, 0.95, -0.1] },
    { t: 0.6, pelvis: [0, -0.08, 0.6], hips: [0, 6, 0], spine: [15, 10, 0], footL: [0.1, ANKLE, 1.0], footR: [-0.1, ANKLE, 1.25], handR: [-0.2, 0.9, 0.4], handL: [0.25, 0.95, 0.2] },
  ]
}

function bowlerPose(c: PoseCtx): ProcPose | null {
  const spin = c.style === 'offspin' || c.style === 'legspin'
  if (c.pose === 'deliver') {
    const keys = spin ? spinKeys() : paceKeys()
    return toPose(sample(keys, c.t), { look: new THREE.Vector3(0, 1.4, 20), elbowR: new THREE.Vector3(-0.5, 0, -1), elbowL: new THREE.Vector3(0.6, -0.5, 0.4) })
  }
  if (c.pose === 'follow') {
    if (c.t > 0.85) return null
    const p = toPose(sample(followKeys(spin), c.t), { elbowR: new THREE.Vector3(-0.3, -0.5, 1) })
    p.weight = c.t < 0.6 ? 1 : 1 - (c.t - 0.6) / 0.25
    return p
  }
  return null
}

/* ---------------- fielding and keeping ---------------- */

function reachFor(ball: THREE.Vector3, maxReach = 0.85): THREE.Vector3 {
  // Hands go towards the ball, limited to what the arms can reach from the chest.
  const chest = new THREE.Vector3(0, 1.3, 0.1)
  const d = ball.clone().sub(chest)
  if (d.length() > maxReach) d.setLength(maxReach)
  return chest.add(d)
}

function keeperPose(c: PoseCtx): ProcPose | null {
  if (c.pose === 'keeper' || c.pose === 'keepertake') {
    // Crouched; rises as the ball is bowled and takes it in front of the chest.
    const rise = c.sinceRelease < 0 ? 0 : smooth(Math.min(1, c.sinceRelease / 0.3))
    const take = c.pose === 'keepertake' ? 1 : 0
    const ball = c.ball && (take || c.sinceRelease >= 0) ? c.ball : null
    let hands = new THREE.Vector3(0, 0.42 + rise * 0.25, 0.5)
    if (ball && ball.z > -0.5) hands = reachFor(ball.clone().setZ(Math.max(0.35, Math.min(0.7, ball.z))), 0.95)
    const pel = new THREE.Vector3(0, -0.4 + rise * 0.18 + (ball ? Math.max(0, ball.y - 1.0) * 0.4 : 0), -0.16 + rise * 0.06)
    return {
      weight: 1,
      pelvis: pel,
      spine: [40 - rise * 14, 0, 0],
      footL: new THREE.Vector3(0.22, ANKLE + 0.03, 0.04),
      footR: new THREE.Vector3(-0.22, ANKLE + 0.03, 0.04),
      toeL: 14,
      toeR: -14,
      kneeL: new THREE.Vector3(0.6, 0.2, 1),
      kneeR: new THREE.Vector3(-0.6, 0.2, 1),
      handL: hands.clone().add(new THREE.Vector3(0.07, 0, 0)),
      handR: hands.clone().add(new THREE.Vector3(-0.07, 0, 0)),
      elbowL: new THREE.Vector3(1, -0.6, 0),
      elbowR: new THREE.Vector3(-1, -0.6, 0),
      look: c.ball ?? c.ahead.clone().setY(1.2),
    }
  }
  return null
}

function fielderPose(c: PoseCtx): ProcPose | null {
  switch (c.pose) {
    case 'ready': {
      if (c.speed > 0.6) return null
      return {
        weight: 1,
        pelvis: new THREE.Vector3(0, -0.13, -0.02),
        spine: [24, 0, 0],
        footL: new THREE.Vector3(0.24, ANKLE, 0.04),
        footR: new THREE.Vector3(-0.24, ANKLE, 0.04),
        toeL: 12,
        toeR: -12,
        handL: new THREE.Vector3(0.2, 0.68, 0.32),
        handR: new THREE.Vector3(-0.2, 0.68, 0.32),
        elbowL: new THREE.Vector3(1, -0.4, -0.2),
        elbowR: new THREE.Vector3(-1, -0.4, -0.2),
        look: c.ball ?? c.ahead,
      }
    }
    case 'catch': {
      const ball = c.ball ?? new THREE.Vector3(0, 1.4, 0.5)
      const hands = c.hasBall && c.t > 0.35 ? new THREE.Vector3(0, 1.75 + Math.min(0.4, (c.t - 0.35) * 2), 0.2) : reachFor(ball)
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
        look: new THREE.Vector3(0, 3, 4),
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
      return {
        weight: 1,
        pelvis: new THREE.Vector3(0, 0.02, 0),
        spine: [-10 * k, 0, 0],
        footL: new THREE.Vector3(0.18, ANKLE, 0.08),
        footR: new THREE.Vector3(-0.18, ANKLE, -0.05),
        handL: new THREE.Vector3(0.3, 1.4 + 0.75 * k, 0.25),
        handR: new THREE.Vector3(-0.3, 1.4 + 0.75 * k, 0.25),
        elbowL: new THREE.Vector3(1, 0, -0.2),
        elbowR: new THREE.Vector3(-1, 0, -0.2),
        look: c.ahead.clone().setY(2.2),
      }
    }
    default:
      return null
  }
}

/* ---------------- umpires ---------------- */

function umpirePose(c: PoseCtx): ProcPose | null {
  const base = { footL: new THREE.Vector3(0.16, ANKLE, 0), footR: new THREE.Vector3(-0.16, ANKLE, 0) }
  if (c.pose === 'umpire') {
    if (c.sinceRelease >= 0 && c.sinceRelease < 2.5) {
      // Bending to watch the delivery.
      return { weight: 1, ...base, pelvis: new THREE.Vector3(0, -0.06, 0), spine: [22, 0, 0], handL: new THREE.Vector3(0.12, 0.85, 0.28), handR: new THREE.Vector3(-0.12, 0.85, 0.28), look: c.ball ?? c.ahead }
    }
    return null
  }
  if (c.pose !== 'signal') return null
  const k = smooth(Math.min(1, c.t / 0.3))
  const rest = new THREE.Vector3(0, 0.95, 0.15)
  const L = (v: V) => rest.clone().add(new THREE.Vector3(0.18, 0, 0)).lerp(vec(v), k)
  const R = (v: V) => rest.clone().add(new THREE.Vector3(-0.18, 0, 0)).lerp(vec(v), k)
  const look = c.ahead.clone().setY(1.6)
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
      return batterPose(c)
    case 'nonstriker':
      return c.pose === 'batslide' ? batterPose(c) : null
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
