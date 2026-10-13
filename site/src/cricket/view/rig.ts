// One cricketer on screen: one of the rigged bodies (two fielders, the batter in helmet, pads and gloves, the keeper,
// the umpire; one skeleton layout) in painted team kit with name and number decals, a bat, the library clips
// retargeted onto each body's skeleton (idle, walk, run, throw, pick up...) and a procedural layer on top for
// everything cricket-specific (strokes, bowling actions, keeping, catches, dives, umpire signals). The procedural
// layer works in "character space" (the body's own frame: +Z forward, +X its left, y up): limbs are placed with
// two-bone IK and the spine is bent and twisted, so poses are authored as positions (feet, hands, bat grip) rather
// than raw bone angles.
//
// Motion continuity: every change of pose (a clip to a stroke, a stroke to running, one stroke to another) is a
// crossfade at bone level from a snapshot of the last displayed pose, so nothing ever snaps; planted feet are locked
// to the ground in world space and shuffle when the body drifts; the head follows a damped look target. The
// skeleton is posed without recursive matrix updates (parents before children, one final pass).
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { BodyKind, CricketAssets } from '../assets'
import type { KitPaint, Kits, ShirtSpec } from './kit'

export type KitKind = 'batter' | 'fielder' | 'keeper' | 'umpire' | 'bowler'

export interface KitColors {
  shirt: string
  trim: string
  trousers: string
  whites: boolean
}

/** Who is wearing it: what to print on the shirt and which body to use. */
export interface Identity {
  teamName: string
  surname: string
  number: number
  /** 0 or 1: which of the two fielders' bodies. */
  body: number
  skin: number
  /** Left-handed (the body is drawn mirrored). */
  left: boolean
}

/** What the procedural layer asks for this frame (character space, metres and degrees). */
export interface ProcPose {
  weight: number
  /** Only hips and spine, applied on top of the clip (a lean into a turn, a throw's twist). */
  additive?: boolean
  /** Pelvis offset from its rest position. */
  pelvis?: THREE.Vector3
  /** Hip rotation: yaw (about up), pitch (forward), roll. */
  hips?: [number, number, number]
  /** Spine bend forward, twist (positive turns the chest to its left), side bend. */
  spine?: [number, number, number]
  footL?: THREE.Vector3
  footR?: THREE.Vector3
  /** Foot yaw: 0 = toes forward (+Z), positive turns towards +X. */
  toeL?: number
  toeR?: number
  kneeL?: THREE.Vector3
  kneeR?: THREE.Vector3
  handL?: THREE.Vector3
  handR?: THREE.Vector3
  elbowL?: THREE.Vector3
  elbowR?: THREE.Vector3
  /** Wrist flex in degrees about the body's left axis (a bowler's snap, a flick). */
  wristL?: number
  wristR?: number
  /** Where to look (character space). */
  look?: THREE.Vector3
  /** Bat placement: grip point, blade direction (grip to toe), face normal. */
  bat?: { grip: THREE.Vector3; dir: THREE.Vector3; face: THREE.Vector3 }
  /** Whole-body rotation about a pivot (dives, slides): axis, degrees, and an offset. */
  body?: { axis: THREE.Vector3; angle: number; offset: THREE.Vector3 }
  /** Feet on the ground are locked in place in the world (default on; off for dives and slides). */
  noLock?: boolean
}

/** Height of the ankle (foot bone) when the foot is flat on the ground: poses put feet at this y (each body shifts
 *  it by its own ankle height). */
export const ANKLE = 0.126

const BONES = ['_rootJoint', 'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'] as const
type BoneName = (typeof BONES)[number]
const POSED: BoneName[] = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']

const CLIP_NAMES = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  crouch: 'Crouch_Idle_Loop',
  pickup: 'PickUp_Table',
  throw: 'OverhandThrow',
  roll: 'Roll',
  fold: 'Idle_FoldArms_Loop',
  yes: 'Yes',
  dance: 'Dance_Loop',
  jump: 'Jump_Start',
  land: 'Jump_Land',
  hit: 'Hit_Chest',
  getup: 'LayToIdle',
  slide: 'Slide_Loop',
  no: 'Idle_No_Loop',
} as const
export type ClipName = keyof typeof CLIP_NAMES
const ONE_SHOT: ClipName[] = ['pickup', 'throw', 'roll', 'yes', 'jump', 'land', 'hit', 'getup']

const Y = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)
// Scratch, one set per helper: a helper never writes a vector its caller may have handed it.
const _m1 = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const _e1 = new THREE.Euler()
const _dPos = new THREE.Vector3()
const _dScale = new THREE.Vector3()
const _pq = new THREE.Quaternion()
const _aimDir = new THREE.Vector3()
const _aimCur = new THREE.Vector3()
const _aimQ = new THREE.Quaternion()
const _aimR = new THREE.Quaternion()
const _rotQ = new THREE.Quaternion()
const _ikA = new THREE.Vector3()
const _ikT = new THREE.Vector3()
const _ikV = new THREE.Vector3()
const _ikE = new THREE.Vector3()
const _ikL = new THREE.Vector3()
const _pel = new THREE.Vector3()
const _toe = new THREE.Vector3()
const _knee = new THREE.Vector3()
const _kneeB = new THREE.Vector3()
const _elbow = new THREE.Vector3()
const _hdir = new THREE.Vector3()
const _footAim = new THREE.Vector3()
const _footT = new THREE.Vector3()
const _hipQ = new THREE.Quaternion()
const _spineQ = new THREE.Quaternion()
const _wristQ = new THREE.Quaternion()
const _foreQ = new THREE.Quaternion()
const _hp = new THREE.Vector3()
const _want = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _headQ = new THREE.Quaternion()
const _lookR = new THREE.Quaternion()
const _lookPart = new THREE.Quaternion()
const _tw = new THREE.Vector3()
const _lockOut = new THREE.Vector3()
const _lockTmp = new THREE.Vector3()
const _bx = new THREE.Vector3()
const _by = new THREE.Vector3()
const _bz = new THREE.Vector3()
const _hpos = new THREE.Vector3()
const _hq = new THREE.Quaternion()
const _fingers = new THREE.Vector3()
const _bdir = new THREE.Vector3()
const _oldP = new THREE.Vector3()
const _oldQ = new THREE.Quaternion()
const _fadeQ = new THREE.Quaternion()
const _blendQ = new THREE.Quaternion()
const NEG_X = new THREE.Vector3(-1, 0, 0)
const DEG = Math.PI / 180
const IDENTITY_Q = new THREE.Quaternion()

/** Multipliers over the modelled skin: as modelled, warm, tan, deep. */
const SKIN_TONES = ['#ffffff', '#f2dccb', '#dcb898', '#b48a6c']

/** Ease in and out (smoothstep) for crossfades. */
const easeInOut = (x: number) => x * x * (3 - 2 * x)

/** One foot's ground lock: where it is planted in the world, and a shuffle step in progress. */
interface FootLock {
  on: boolean
  world: THREE.Vector3
  /** The pose's foot position when it was locked (character space); a change means the pose is moving the foot. */
  char: THREE.Vector3
  /** A decaying world offset so releasing the lock never pops. */
  offset: THREE.Vector3
  /** A shuffle: the foot travels from `from` to the new target over stepT seconds. */
  stepping: boolean
  from: THREE.Vector3
  stepT: number
}

const STEP_TIME = 0.16
const STEP_LIFT = 0.07
/** The body may drift this far before a planted foot shuffles after it. */
const STEP_AT = 0.2
const LOCK_REACH = 0.42

export class Cricketer {
  root = new THREE.Group()
  model: THREE.Object3D
  bones = {} as Record<BoneName, THREE.Bone>
  private bindQ = {} as Record<BoneName, THREE.Quaternion>
  private bindPelvisChar = new THREE.Vector3()
  private headFwdLocal = new THREE.Vector3()
  /** The foot bone's rest pitch below horizontal (cos, sin): aimed this way the sole is flat. */
  private footPitch = { c: 0.83, s: 0.56 }
  private len = { upper: 0.285, fore: 0.252, thigh: 0.458, calf: 0.444 }
  mixer: THREE.AnimationMixer
  private actions = {} as Record<ClipName, THREE.AnimationAction>
  private clip: ClipName | null = null
  bat: THREE.Object3D | null = null
  /** Shirt decals, hidden at distance. */
  private detail: THREE.Object3D[] = []
  /** The shirt decals' material and what they print; flipped with the body (a batter of the other hand). */
  private decalMat: THREE.MeshStandardMaterial | null = null
  private decalSpec: ShirtSpec | null = null
  private decalMirror = false
  private kits: Kits | null = null
  /** The full body and its low-detail copy (distant players). */
  private fullMesh: THREE.Object3D | null = null
  private lodMesh: THREE.Object3D | null = null
  /** This body's ankle height above the poses' ANKLE. */
  private ankleDy = 0
  private rootInv = new THREE.Matrix4()
  private clipQ: THREE.Quaternion[] = POSED.map(() => new THREE.Quaternion())
  private clipPelvis = new THREE.Vector3()
  /** The last displayed pose (for crossfades) and the snapshot being faded from. */
  private lastQ: THREE.Quaternion[] = POSED.map(() => new THREE.Quaternion())
  private lastPelvis = new THREE.Vector3()
  private lastBodyQ = new THREE.Quaternion()
  private lastBodyP = new THREE.Vector3()
  private lastBatP = new THREE.Vector3()
  private lastBatQ = new THREE.Quaternion()
  private snapQ: THREE.Quaternion[] = POSED.map(() => new THREE.Quaternion())
  private snapPelvis = new THREE.Vector3()
  private snapBodyQ = new THREE.Quaternion()
  private snapBodyP = new THREE.Vector3()
  private snapBatP = new THREE.Vector3()
  private snapBatQ = new THREE.Quaternion()
  private fadeT = 1
  private fadeDur = 0.2
  private key = ''
  private hasLast = false
  /** Smoothed procedural weight. */
  private wNow = 0
  private lookNow = new THREE.Vector3(0, 0, 1)
  private hasLook = false
  private locks: [FootLock, FootLock] = [newLock(), newLock()]
  kind: KitKind
  private ownMaterials: THREE.Material[] = []

  constructor(assets: CricketAssets, kits: Kits, kind: KitKind, colors: KitColors, who: Identity) {
    this.kind = kind
    const bodyKind: BodyKind = kind === 'batter' ? 'batter' : kind === 'keeper' ? 'keeper' : kind === 'umpire' ? 'umpire' : who.body % 2 ? 'fielderB' : 'fielderA'
    const body = assets.bodies[bodyKind]
    this.model = cloneSkinned(body.scene)
    this.root.add(this.model)
    this.model.traverse((o) => {
      const b = o as THREE.Bone
      if ((BONES as readonly string[]).includes(o.name)) this.bones[o.name as BoneName] = b
      const m = o as THREE.SkinnedMesh
      if (m.isSkinnedMesh) {
        m.castShadow = true
        m.receiveShadow = false
        m.frustumCulled = false
      }
    })
    for (const n of BONES) this.bindQ[n] = this.bones[n].quaternion.clone()
    this.model.updateMatrixWorld(true)
    this.root.updateMatrixWorld(true)
    this.rootInv.copy(this.root.matrixWorld).invert()
    this.bindPelvisChar.copy(this.charPosOf(this.bones.Hips, new THREE.Vector3()))
    // The head's forward (+Z of the character at bind) in the head bone's local space.
    this.headFwdLocal.set(0, 0, 1).applyQuaternion(this.charQuatOf(this.bones.Head, _headQ).invert())
    this.len.upper = this.bones.LeftForeArm.position.length()
    this.len.fore = this.bones.LeftHand.position.length()
    this.len.thigh = this.bones.LeftLeg.position.length()
    this.len.calf = this.bones.LeftFoot.position.length()
    const footDir = new THREE.Vector3(0, 1, 0).applyQuaternion(this.charQuatOf(this.bones.LeftFoot, _headQ))
    this.footPitch = { c: Math.hypot(footDir.x, footDir.z), s: -footDir.y }
    this.ankleDy = this.charPosOf(this.bones.LeftFoot, new THREE.Vector3()).y - ANKLE

    this.applyKit(assets, bodyKind, kits, kind, colors, who)

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const [k, name] of Object.entries(CLIP_NAMES) as [ClipName, string][]) {
      const c = body.clips[name]
      if (!c) continue
      const a = this.mixer.clipAction(c)
      if (ONE_SHOT.includes(k)) {
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = true
      }
      this.actions[k] = a
    }
    this.playClip('idle', 0)
  }

  private applyKit(assets: CricketAssets, bodyKind: BodyKind, kits: Kits, kind: KitKind, c: KitColors, who: Identity) {
    const body = assets.bodies[bodyKind]
    const umpire = kind === 'umpire'
    const paint: KitPaint = {
      shirt: c.whites ? '#f3f1ea' : c.shirt,
      trim: c.whites ? c.shirt : c.trim,
      trousers: c.whites ? '#eeebe2' : c.trousers,
      // The batter's helmet shell, everyone else's cap.
      headwear: kind === 'batter' ? (c.whites ? '#1e293b' : c.trim === '#f8fafc' ? c.shirt : c.trousers) : c.whites ? c.shirt : c.trousers,
      pads: c.whites || kind === 'keeper' ? '#f5f5f0' : c.shirt,
      gloves: kind === 'keeper' ? '#e5e7eb' : c.whites ? '#f5f5f0' : c.trim,
      skin: SKIN_TONES[who.skin % SKIN_TONES.length],
    }
    // The full body and its low-detail copy share one kit material.
    let mat: THREE.Material | null = null
    let found: THREE.SkinnedMesh | null = null
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isSkinnedMesh) return
      if (!mat) {
        mat = kits.bodyMaterial(body, m.material as THREE.MeshStandardMaterial, paint)
        this.ownMaterials.push(mat)
      }
      m.material = mat
      if (m.name === 'BodyLOD') {
        this.lodMesh = m
        m.visible = false
      } else if (!found) {
        found = m
        this.fullMesh = m
      }
    })
    const mesh = found as THREE.SkinnedMesh | null
    if (mesh && !umpire) {
      const geo = kits.decalGeometry(body, mesh)
      if (geo) {
        const ink = c.whites ? c.shirt : c.trim
        this.decalSpec = { chest: who.teamName, back: who.surname, number: String(who.number), ink, mirror: who.left }
        this.decalMirror = who.left
        this.kits = kits
        const tex = kits.decal(this.decalSpec)
        const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
        this.ownMaterials.push(mat)
        this.decalMat = mat
        const decal = new THREE.SkinnedMesh(geo, mat)
        decal.frustumCulled = false
        decal.castShadow = false
        decal.renderOrder = 1
        mesh.parent!.add(decal)
        decal.bind(mesh.skeleton, mesh.bindMatrix)
        this.detail.push(decal)
      }
    }
    if (kind === 'batter') {
      this.bat = assets.bat.clone()
      this.bat.traverse((o) => ((o as THREE.Mesh).castShadow = true))
      this.root.add(this.bat)
    }
  }

  /** Distant players: the low-detail body (`low`), and no shirt decals (`noDecals`). */
  setLod(low: boolean, noDecals = low) {
    if (this.lodMesh && this.fullMesh && this.lodMesh.visible !== low) {
      this.lodMesh.visible = low
      this.fullMesh.visible = !low
    }
    for (const o of this.detail) o.visible = !noDecals
  }

  playClip(name: ClipName, fade = 0.2, timeScale = 1) {
    const a = this.actions[name]
    if (!a) return
    a.timeScale = timeScale
    if (this.clip === name) return
    const prev = this.clip ? this.actions[this.clip] : null
    a.reset()
    a.enabled = true
    a.setEffectiveWeight(1)
    a.play()
    if (prev && fade > 0) prev.crossFadeTo(a, fade, false)
    else if (prev) prev.stop()
    this.clip = name
  }

  get clipName() {
    return this.clip
  }

  /** Seconds into the current one-shot clip. */
  clipTime() {
    return this.clip ? this.actions[this.clip].time : 0
  }

  /* ---------------- character-space helpers ---------------- */

  /** Recomputes a bone's world matrix from its (current) parent: the posing walks parents before children. */
  private refresh(b: THREE.Object3D) {
    b.updateMatrix()
    b.matrixWorld.multiplyMatrices(b.parent!.matrixWorld, b.matrix)
  }
  private charMatrix(o: THREE.Object3D, out: THREE.Matrix4) {
    return out.multiplyMatrices(this.rootInv, o.matrixWorld)
  }
  /** Character-space position and orientation of a bone, refreshing it from its parent first. */
  private charPos(o: THREE.Object3D, out: THREE.Vector3) {
    this.refresh(o)
    return out.setFromMatrixPosition(this.charMatrix(o, _m1))
  }
  private charQuat(o: THREE.Object3D, out: THREE.Quaternion) {
    this.refresh(o)
    this.charMatrix(o, _m1)
    _m1.decompose(_dPos, out, _dScale)
    return out
  }
  /** As above but from the matrices as they are (setup, after a full update). */
  private charPosOf(o: THREE.Object3D, out: THREE.Vector3) {
    return out.setFromMatrixPosition(this.charMatrix(o, _m1))
  }
  private charQuatOf(o: THREE.Object3D, out: THREE.Quaternion) {
    this.charMatrix(o, _m1)
    _m1.decompose(_dPos, out, _dScale)
    return out
  }
  /** Sets a bone's character-space orientation (its parent is current). */
  private setCharQuat(b: THREE.Object3D, q: THREE.Quaternion) {
    this.charMatrix(b.parent!, _m1)
    _m1.decompose(_dPos, _pq, _dScale)
    b.quaternion.copy(_pq.invert().multiply(q))
    this.refresh(b)
  }
  /** Rotates a bone so its length axis (+Y) points along dir (character space), with the least twist. */
  private aimBone(b: THREE.Object3D, dir: THREE.Vector3) {
    _aimDir.copy(dir).normalize()
    const q = this.charQuat(b, _aimQ)
    const cur = _aimCur.copy(Y).applyQuaternion(q)
    const r = _aimR.setFromUnitVectors(cur, _aimDir)
    this.setCharQuat(b, r.multiply(q))
  }
  /** Applies an extra character-space rotation to a bone (`r` must not be one of the aim/rotate scratch quaternions). */
  private rotateBone(b: THREE.Object3D, r: THREE.Quaternion) {
    const q = this.charQuat(b, _rotQ)
    this.setCharQuat(b, q.premultiply(r))
  }

  /** Two-bone IK: upper -> lower -> end reaches `target`, bending towards `pole` (a direction). */
  private ik(upper: THREE.Bone, lower: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, lenA: number, lenB: number) {
    const a = this.charPos(upper, _ikA)
    const toT = _ikT.copy(target).sub(a)
    let d = toT.length()
    d = THREE.MathUtils.clamp(d, Math.abs(lenA - lenB) + 0.01, (lenA + lenB) * 0.9995)
    const u = toT.normalize()
    const cosA = THREE.MathUtils.clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1)
    const sinA = Math.sqrt(1 - cosA * cosA)
    const v = _ikV.copy(pole).addScaledVector(u, -pole.dot(u))
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1).addScaledVector(u, -u.z)
    v.normalize()
    // elbow = a + u * lenA cosA + v * lenA sinA; end = a + u * d
    const elbowDir = _ikE.copy(u).multiplyScalar(lenA * cosA).addScaledVector(v, lenA * sinA)
    const lowerDir = _ikL.copy(u).multiplyScalar(d).sub(elbowDir)
    this.aimBone(upper, elbowDir)
    this.aimBone(lower, lowerDir)
  }

  /* ---------------- per frame ---------------- */

  /** Sets the world transform for this frame (call before toChar and update). */
  prepare(pos: THREE.Vector3, yaw: number, mirror: boolean) {
    this.root.position.copy(pos)
    this.root.rotation.set(0, yaw, 0)
    this.root.scale.set(mirror ? -1 : 1, 1, 1)
    if (this.decalMat && this.decalSpec && this.kits && mirror !== this.decalMirror) {
      // The decals are pre-mirrored so they read right on a mirrored body.
      this.decalMirror = mirror
      this.decalSpec.mirror = mirror
      this.decalMat.map = this.kits.decal(this.decalSpec)
    }
    this.model.position.set(0, 0, 0)
    this.model.quaternion.identity()
    this.root.updateMatrix()
    this.root.matrixWorld.copy(this.root.matrix)
    this.rootInv.copy(this.root.matrixWorld).invert()
  }

  /**
   * Advances the clips, then applies the procedural pose on top (after prepare()). `key` names the motion state
   * (pose and variant): when it changes, the body crossfades from where it was over `fade` seconds.
   */
  update(dt: number, pose: ProcPose | null, key = '', fade = 0.2) {
    if (key !== this.key) {
      if (this.hasLast) {
        for (let i = 0; i < POSED.length; i++) this.snapQ[i].copy(this.lastQ[i])
        this.snapPelvis.copy(this.lastPelvis)
        this.snapBodyQ.copy(this.lastBodyQ)
        this.snapBodyP.copy(this.lastBodyP)
        this.snapBatP.copy(this.lastBatP)
        this.snapBatQ.copy(this.lastBatQ)
        this.fadeT = 0
        this.fadeDur = Math.max(0.01, fade)
      }
      this.key = key
    }
    // The mixer only writes a bone whose clip value changed (not on a frame without time passing, nor once a
    // one-shot clip has finished), so put the pure clip pose back before it runs, then remember the new one.
    if (this.hasLast) {
      for (let i = 0; i < POSED.length; i++) this.bones[POSED[i]].quaternion.copy(this.clipQ[i])
      this.bones.Hips.position.copy(this.clipPelvis)
    }
    this.mixer.update(dt)
    for (let i = 0; i < POSED.length; i++) this.clipQ[i].copy(this.bones[POSED[i]].quaternion)
    this.clipPelvis.copy(this.bones.Hips.position)
    this.model.updateMatrixWorld(true)

    const additive = !!pose?.additive
    const target = pose && !additive ? pose.weight : 0
    // Smooth blending in and out of procedural poses (the crossfade below covers the pose change itself).
    const rate = dt > 0 ? Math.min(1, dt * 14) : this.hasLast ? 0 : 1
    this.wNow += (target - this.wNow) * rate
    if (Math.abs(this.wNow - target) < 0.01) this.wNow = target
    const w = this.wNow
    if (pose && additive) this.applyAdditive(pose, dt)
    else if (pose && w > 0.001) this.applyPose(pose, w, dt)
    else {
      this.releaseLocks()
      this.hasLook = false
    }

    // Crossfade from the snapshot of the last displayed pose.
    if (this.fadeT < 1) {
      if (dt > 0) this.fadeT = Math.min(1, this.fadeT + dt / this.fadeDur)
      const k = easeInOut(this.fadeT)
      if (k < 0.999) {
        for (let i = 0; i < POSED.length; i++) {
          const b = this.bones[POSED[i]]
          b.quaternion.copy(_fadeQ.slerpQuaternions(this.snapQ[i], b.quaternion, k))
        }
        this.bones.Hips.position.lerpVectors(this.snapPelvis, this.bones.Hips.position, k)
        this.model.quaternion.copy(_fadeQ.slerpQuaternions(this.snapBodyQ, this.model.quaternion, k))
        this.model.position.lerpVectors(this.snapBodyP, this.model.position, k)
      }
    }
    this.model.updateMatrixWorld(true)
    this.rootInv.copy(this.root.matrixWorld).invert()

    // The bat.
    if (this.bat) {
      if (pose && !additive && pose.bat && w > 0.001) {
        this.placeBat(pose.bat.grip, pose.bat.dir, pose.bat.face)
        if (w < 0.999) this.placeBatInHand(1 - w)
      } else this.placeBatInHand()
      if (this.fadeT < 1) {
        const k = easeInOut(this.fadeT)
        this.bat.position.lerpVectors(this.snapBatP, this.bat.position, k)
        this.bat.quaternion.copy(_fadeQ.slerpQuaternions(this.snapBatQ, this.bat.quaternion, k))
      }
      this.lastBatP.copy(this.bat.position)
      this.lastBatQ.copy(this.bat.quaternion)
    }
    // Remember what was shown.
    for (let i = 0; i < POSED.length; i++) this.lastQ[i].copy(this.bones[POSED[i]].quaternion)
    this.lastPelvis.copy(this.bones.Hips.position)
    this.lastBodyQ.copy(this.model.quaternion)
    this.lastBodyP.copy(this.model.position)
    this.hasLast = true
  }

  /** A lean or twist on top of the clip. */
  private applyAdditive(pose: ProcPose, dt: number) {
    const B = this.bones
    this.refresh(B._rootJoint)
    this.refresh(B.Hips)
    if (pose.hips) {
      const [yw, pt, rl] = pose.hips
      _hipQ.setFromEuler(_e1.set(pt * DEG, yw * DEG, rl * DEG, 'YXZ'))
      this.rotateBone(B.Hips, _hipQ)
    }
    if (pose.spine) {
      const [bend, twist, side] = pose.spine
      _spineQ.setFromEuler(_e1.set((bend / 3) * DEG, (twist / 3) * DEG, (side / 3) * DEG, 'YXZ'))
      this.rotateBone(B.Spine, _spineQ)
      this.rotateBone(B.Spine1, _spineQ)
      this.rotateBone(B.Spine2, _spineQ)
    }
    if (pose.look) {
      this.refresh(B.Neck)
      this.lookAt(pose.look, dt)
    } else this.hasLook = false
    this.releaseLocks()
  }

  private applyPose(pose: ProcPose, w: number, dt: number) {
    const B = this.bones

    // Whole-body rotation (dives).
    if (pose.body) {
      this.model.quaternion.setFromAxisAngle(pose.body.axis, pose.body.angle * DEG)
      this.model.position.copy(pose.body.offset)
      this.model.updateMatrixWorld(true)
      // Pose in the rotated body's frame so the whole figure tips over.
      this.rootInv.copy(this.model.matrixWorld).invert()
    }

    // Start from the bind pose for the bones we drive.
    for (const n of POSED) B[n].quaternion.copy(this.bindQ[n])
    this.refresh(B._rootJoint)
    // Pelvis position.
    const pel = _pel.copy(this.bindPelvisChar)
    if (pose.pelvis) pel.add(pose.pelvis)
    _m2.copy(this.charMatrix(B._rootJoint, _m2)).invert()
    B.Hips.position.copy(pel.applyMatrix4(_m2))
    this.refresh(B.Hips)
    if (pose.hips) {
      const [yw, pt, rl] = pose.hips
      _hipQ.setFromEuler(_e1.set(pt * DEG, yw * DEG, rl * DEG, 'YXZ'))
      this.rotateBone(B.Hips, _hipQ)
    }
    if (pose.spine) {
      const [bend, twist, side] = pose.spine
      _spineQ.setFromEuler(_e1.set((bend / 3) * DEG, (twist / 3) * DEG, (side / 3) * DEG, 'YXZ'))
      this.rotateBone(B.Spine, _spineQ)
      this.rotateBone(B.Spine1, _spineQ)
      this.rotateBone(B.Spine2, _spineQ)
    } else {
      this.refresh(B.Spine)
      this.refresh(B.Spine1)
      this.refresh(B.Spine2)
    }
    this.refresh(B.LeftShoulder)
    this.refresh(B.RightShoulder)
    this.refresh(B.Neck)
    // Legs.
    const lock = !pose.noLock && !pose.body
    for (let s = 0; s < 2; s++) {
      const L = s === 0
      const foot = L ? pose.footL : pose.footR
      const thigh = L ? B.LeftUpLeg : B.RightUpLeg
      const calf = L ? B.LeftLeg : B.RightLeg
      const fb = L ? B.LeftFoot : B.RightFoot
      const toe = ((L ? pose.toeL : pose.toeR) ?? 0) * DEG
      const toeDir = _toe.set(Math.sin(toe), 0, Math.cos(toe))
      if (foot) {
        const at = this.lockedFoot(s as 0 | 1, _footT.copy(foot).setY(foot.y + this.ankleDy), lock && foot.y < ANKLE + 0.035, dt)
        const knee = (L ? pose.kneeL : pose.kneeR) ?? _knee.copy(toeDir).add(_kneeB.set(L ? 0.15 : -0.15, 0.1, 0))
        this.ik(thigh, calf, at, knee, this.len.thigh, this.len.calf)
      } else {
        this.locks[s].on = false
        // Keep the leg below the (moved) pelvis, straight down.
        this.aimBone(thigh, _knee.set(0, -1, 0.02))
        this.aimBone(calf, _knee.set(0, -1, -0.02))
      }
      this.aimBone(fb, _footAim.copy(toeDir).multiplyScalar(this.footPitch.c).add(_kneeB.set(0, -this.footPitch.s, 0)))
    }
    // Arms.
    for (let s = 0; s < 2; s++) {
      const L = s === 0
      const hand = L ? pose.handL : pose.handR
      const up = L ? B.LeftArm : B.RightArm
      const lo = L ? B.LeftForeArm : B.RightForeArm
      const hb = L ? B.LeftHand : B.RightHand
      if (hand) {
        const elbow = (L ? pose.elbowL : pose.elbowR) ?? _elbow.set(L ? 0.4 : -0.4, -1, -0.35)
        this.ik(up, lo, hand, elbow, this.len.upper, this.len.fore)
        // Hand continues the forearm, flexed at the wrist if asked.
        const fore = this.charQuat(lo, _foreQ)
        const dir = _hdir.set(0, 1, 0).applyQuaternion(fore)
        const wrist = L ? pose.wristL : pose.wristR
        if (wrist) dir.applyQuaternion(_wristQ.setFromAxisAngle(X, wrist * DEG))
        this.aimBone(hb, dir)
      } else {
        // Relaxed arm by the side.
        this.aimBone(up, _hdir.set(L ? 0.18 : -0.18, -1, 0.05))
        this.aimBone(lo, _hdir.set(L ? 0.05 : -0.05, -1, 0.25))
        this.refresh(hb)
      }
    }
    // Head.
    if (pose.look) this.lookAt(pose.look, dt)
    else this.hasLook = false
    // Blend with the clip.
    if (w < 0.999) {
      for (let i = 0; i < POSED.length; i++) {
        const b = B[POSED[i]]
        b.quaternion.copy(_blendQ.slerpQuaternions(this.clipQ[i], b.quaternion, w))
      }
      B.Hips.position.lerpVectors(this.clipPelvis, B.Hips.position, w)
    }
  }

  /** Turns the neck and head towards a (damped) target in character space. */
  private lookAt(target: THREE.Vector3, dt: number) {
    const B = this.bones
    const hp = this.charPos(B.Head, _hp)
    const want = _want.copy(target).sub(hp).normalize()
    if (!this.hasLook) {
      this.lookNow.copy(want)
      this.hasLook = true
    } else if (dt > 0) {
      // Fast enough to track a ball, slow enough to hide a target that jumps.
      this.lookNow.lerp(want, 1 - Math.exp(-dt * 16)).normalize()
    }
    const hq = this.charQuat(B.Head, _headQ)
    const fwd = _fwd.copy(this.headFwdLocal).applyQuaternion(hq)
    const r = _lookR.setFromUnitVectors(fwd, this.lookNow)
    // Limit the turn.
    const ang = 2 * Math.acos(THREE.MathUtils.clamp(r.w, -1, 1))
    if (ang > 1.3) r.slerp(IDENTITY_Q, 1 - 1.3 / ang)
    this.rotateBone(B.Neck, _lookPart.copy(IDENTITY_Q).slerp(r, 0.4))
    this.rotateBone(B.Head, _lookPart.copy(IDENTITY_Q).slerp(r, 0.6))
  }

  /* ---------------- foot locking ---------------- */

  /**
   * The IK target for a foot: the pose's position, or where the foot was planted in the world. A planted foot stays
   * put while the body drifts a little (the sim shuffling a batter or keeper), shuffles after it beyond a step's
   * worth, and follows the pose as soon as the pose itself moves the foot (a stride), with no pop on release.
   */
  private lockedFoot(side: 0 | 1, target: THREE.Vector3, planted: boolean, dt: number): THREE.Vector3 {
    const lock = this.locks[side]
    const other = this.locks[1 - side]
    const out = _lockOut
    const targetWorld = _tw.copy(target).applyMatrix4(this.root.matrixWorld)
    if (dt <= 0) {
      // A render without time passing: show the state as it is.
      if (lock.stepping) {
        const k = Math.min(1, lock.stepT / STEP_TIME)
        out.lerpVectors(lock.from, targetWorld, easeInOut(k))
        out.y += Math.sin(k * Math.PI) * STEP_LIFT
        return out.applyMatrix4(this.rootInv)
      }
      if (lock.on && planted) return out.copy(lock.world).applyMatrix4(this.rootInv)
      if (lock.offset.lengthSq() > 1e-6) return out.copy(targetWorld).add(lock.offset).applyMatrix4(this.rootInv)
      return out.copy(target)
    }
    if (!planted) {
      if (lock.on || lock.stepping) this.unlock(lock, targetWorld)
      return this.withOffset(lock, target, dt, out)
    }
    if (lock.stepping) {
      lock.stepT += dt
      const k = Math.min(1, lock.stepT / STEP_TIME)
      const e = easeInOut(k)
      out.lerpVectors(lock.from, targetWorld, e)
      out.y += Math.sin(k * Math.PI) * STEP_LIFT
      if (k >= 1) {
        lock.stepping = false
        lock.on = true
        lock.world.copy(targetWorld)
        lock.char.copy(target)
      }
      return out.applyMatrix4(this.rootInv)
    }
    if (!lock.on) {
      // The pose is moving the foot: follow it; plant once it settles.
      if (lock.char.distanceToSquared(target) < 0.0004) {
        lock.on = true
        lock.world.copy(targetWorld)
      }
      lock.char.copy(target)
      return this.withOffset(lock, target, dt, out)
    }
    // Locked: the pose moved the foot -> release; the body drifted too far -> shuffle; else hold the ground.
    if (lock.char.distanceToSquared(target) > 0.0004) {
      this.unlock(lock, targetWorld)
      lock.char.copy(target)
      return this.withOffset(lock, target, dt, out)
    }
    const drift = lock.world.distanceTo(targetWorld)
    if (drift > LOCK_REACH) {
      // Too far to keep: let it slide (decaying) rather than stretch the leg.
      this.unlock(lock, targetWorld)
      return this.withOffset(lock, target, dt, out)
    }
    if (drift > STEP_AT && !other.stepping) {
      lock.stepping = true
      lock.on = false
      lock.stepT = 0
      lock.from.copy(lock.world)
      return out.copy(lock.world).applyMatrix4(this.rootInv)
    }
    return out.copy(lock.world).applyMatrix4(this.rootInv)
  }

  private unlock(lock: FootLock, targetWorld: THREE.Vector3) {
    if (lock.stepping) {
      const k = Math.min(1, lock.stepT / STEP_TIME)
      _lockTmp.lerpVectors(lock.from, targetWorld, easeInOut(k))
      lock.offset.copy(_lockTmp).sub(targetWorld)
    } else if (lock.on) lock.offset.copy(lock.world).sub(targetWorld)
    lock.on = false
    lock.stepping = false
  }

  /** The pose's target plus the decaying release offset (world space), in character space. */
  private withOffset(lock: FootLock, target: THREE.Vector3, dt: number, out: THREE.Vector3) {
    if (lock.offset.lengthSq() < 1e-6) return out.copy(target)
    lock.offset.multiplyScalar(Math.exp(-dt * 14))
    if (lock.offset.lengthSq() < 1e-6) lock.offset.set(0, 0, 0)
    return out.copy(target).applyMatrix4(this.root.matrixWorld).add(lock.offset).applyMatrix4(this.rootInv)
  }

  private releaseLocks() {
    for (const l of this.locks) {
      l.on = false
      l.stepping = false
      l.offset.set(0, 0, 0)
    }
  }

  /* ---------------- the bat ---------------- */

  /** Bat at a grip point with the blade along dir and the face towards `face` (character space). */
  private placeBat(grip: THREE.Vector3, dir: THREE.Vector3, face: THREE.Vector3) {
    if (!this.bat) return
    const yAxis = _by.copy(dir).normalize().negate()
    const zAxis = _bz.copy(face).addScaledVector(yAxis, -face.dot(yAxis))
    if (zAxis.lengthSq() < 1e-6) zAxis.set(1, 0, 0)
    zAxis.normalize()
    const xAxis = _bx.crossVectors(yAxis, zAxis)
    _m1.makeBasis(xAxis, yAxis, zAxis)
    this.bat.quaternion.setFromRotationMatrix(_m1)
    this.bat.position.copy(grip)
  }

  /** The bat carried in the bottom (right) hand when not batting: hanging from the hand, toe forward and down. */
  private placeBatInHand(blend = 1) {
    if (!this.bat || blend <= 0) return
    const hm = this.charMatrix(this.bones.RightHand, _m2)
    const p = _hpos.setFromMatrixPosition(hm)
    hm.decompose(_dPos, _hq, _dScale)
    const fingers = _fingers.set(0, 1, 0).applyQuaternion(_hq)
    const grip = p.addScaledVector(fingers, 0.06)
    const dir = _bdir.set(0, -0.6, 0.55).addScaledVector(fingers, 0.35).normalize()
    if (blend >= 0.999) this.placeBat(grip, dir, NEG_X)
    else {
      const oldPos = _oldP.copy(this.bat.position)
      const oldQ = _oldQ.copy(this.bat.quaternion)
      this.placeBat(grip, dir, NEG_X)
      this.bat.position.lerpVectors(oldPos, this.bat.position, blend)
      this.bat.quaternion.copy(_fadeQ.slerpQuaternions(oldQ, this.bat.quaternion, blend))
    }
  }

  /** World position of the bat's sweet spot (for effects). */
  batSweetSpot(out = new THREE.Vector3()) {
    if (!this.bat) return out.copy(this.root.position)
    return out.set(0, -0.5, 0.03).applyMatrix4(this.bat.matrixWorld)
  }

  /** World position of a hand. */
  handWorld(side: 'l' | 'r', out = new THREE.Vector3()) {
    return out.setFromMatrixPosition((side === 'l' ? this.bones.LeftHand : this.bones.RightHand).matrixWorld)
  }

  /** Converts a world point into this body's character space. */
  toChar(world: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(world).applyMatrix4(this.rootInv)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.root.removeFromParent()
    for (const m of this.ownMaterials) m.dispose()
  }
}

function newLock(): FootLock {
  return { on: false, world: new THREE.Vector3(), char: new THREE.Vector3(), offset: new THREE.Vector3(), stepping: false, from: new THREE.Vector3(), stepT: 0 }
}
