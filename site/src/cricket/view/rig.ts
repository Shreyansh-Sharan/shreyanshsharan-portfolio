// One cricketer on screen: the shared CC0 body with team-kit materials, pads, gloves, helmet or cap, a bat, the
// library clips (idle, walk, run, throw, pick up...) and a procedural layer on top for everything cricket-specific
// (strokes, bowling actions, keeping, catches, dives, umpire signals). The procedural layer works in "character
// space" (the body's own frame: +Z forward, +X its left, y up): limbs are placed with two-bone IK and the spine is
// bent and twisted, so poses are authored as positions (feet, hands, bat grip) rather than raw bone angles.
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { CricketAssets } from '../assets'
import { KitGeometry, makeBat } from './props'

export type KitKind = 'batter' | 'fielder' | 'keeper' | 'umpire' | 'bowler'

export interface KitColors {
  shirt: string
  trim: string
  trousers: string
  whites: boolean
}

/** What the procedural layer asks for this frame (character space, metres and degrees). */
export interface ProcPose {
  weight: number
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
  /** Where to look (character space). */
  look?: THREE.Vector3
  /** Bat placement: grip point, blade direction (grip to toe), face normal. */
  bat?: { grip: THREE.Vector3; dir: THREE.Vector3; face: THREE.Vector3 }
  /** Whole-body rotation about a pivot (dives, slides): axis, degrees, and an offset. */
  body?: { axis: THREE.Vector3; angle: number; offset: THREE.Vector3 }
}

const BONES = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'] as const
type BoneName = (typeof BONES)[number]
const POSED: BoneName[] = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r']

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
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _m1 = new THREE.Matrix4()
const _m2 = new THREE.Matrix4()
const DEG = Math.PI / 180

const SKIN_TONES = ['#ffe0c8', '#e9b894', '#b98463', '#7a5038']

let sharedGeo: Record<string, THREE.BufferGeometry> | null = null
function kitGeo() {
  if (!sharedGeo)
    sharedGeo = {
      padL: KitGeometry.pad(1),
      padR: KitGeometry.pad(-1),
      glove: KitGeometry.glove(),
      kglove: KitGeometry.keeperGlove(),
      helmet: KitGeometry.helmet(),
      grille: KitGeometry.grille(),
      cap: KitGeometry.cap(),
      hat: KitGeometry.hat(),
    }
  return sharedGeo
}

/** Recolours the shirt/trousers with a trim pattern keyed on the bind-pose position (collar, cuffs, side stripes). */
function kitMaterial(base: string, trim: string, part: 'shirt' | 'trousers', whites: boolean) {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: whites ? 0.75 : 0.62, metalness: 0 })
  const uTrim = { value: new THREE.Color(trim) }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTrim = uTrim
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;')
    const pattern =
      part === 'shirt'
        ? whites
          ? 'float t = step(1.49, vBind.y) + step(0.44, abs(vBind.x)) * step(abs(vBind.x), 0.47);'
          : 'float t = step(1.49, vBind.y) + step(0.42, abs(vBind.x)) + step(0.16, abs(vBind.x)) * step(abs(vBind.x), 0.3) * step(1.3, vBind.y) * step(vBind.y, 1.36) + smoothstep(0.155, 0.175, abs(vBind.x)) * step(abs(vBind.x), 0.25) * step(1.0, vBind.y) * step(vBind.y, 1.3);'
        : 'float t = step(0.17, abs(vBind.x)) * step(abs(vBind.x), 0.2) * step(0.15, vBind.y) * step(vBind.y, 0.8);'
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;\nuniform vec3 uTrim;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${pattern}\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTrim, clamp(t, 0.0, 1.0));`)
  }
  m.customProgramCacheKey = () => `kit-${part}-${whites ? 1 : 0}`
  return m
}

export class Cricketer {
  root = new THREE.Group()
  model: THREE.Object3D
  bones = {} as Record<BoneName, THREE.Bone>
  private bindQ = {} as Record<BoneName, THREE.Quaternion>
  private bindPelvisChar = new THREE.Vector3()
  private headFwdLocal = new THREE.Vector3()
  private len = { upper: 0.251, fore: 0.243, thigh: 0.429, calf: 0.459 }
  mixer: THREE.AnimationMixer
  private actions = {} as Record<ClipName, THREE.AnimationAction>
  private clip: ClipName | null = null
  bat: THREE.Group | null = null
  private lod0: THREE.Object3D[] = []
  private lod1: THREE.Object3D[] = []
  private rootInv = new THREE.Matrix4()
  private clipQ: THREE.Quaternion[] = POSED.map(() => new THREE.Quaternion())
  private clipPelvis = new THREE.Vector3()
  /** Smoothed procedural weight. */
  private wNow = 0
  kind: KitKind

  constructor(assets: CricketAssets, kind: KitKind, colors: KitColors, skin: number) {
    this.kind = kind
    this.model = cloneSkinned(assets.body)
    this.root.add(this.model)
    this.model.traverse((o) => {
      const b = o as THREE.Bone
      if ((BONES as readonly string[]).includes(o.name)) this.bones[o.name as BoneName] = b
      const m = o as THREE.SkinnedMesh
      if (m.isSkinnedMesh) {
        m.castShadow = true
        m.receiveShadow = false
        m.frustumCulled = false
        if (o.name.startsWith('Body_LOD1')) this.lod1.push(o)
        else this.lod0.push(o)
      }
    })
    for (const o of this.lod1) o.visible = false
    for (const n of BONES) this.bindQ[n] = this.bones[n].quaternion.clone()
    this.model.updateMatrixWorld(true)
    this.bindPelvisChar.setFromMatrixPosition(this.bones.pelvis.matrixWorld)
    // The head's forward (+Z of the character at bind) in the head bone's local space.
    this.headFwdLocal.set(0, 0, 1).applyQuaternion(this.bones.Head.getWorldQuaternion(_q1).invert())
    this.len.upper = this.bones.lowerarm_l.position.length()
    this.len.fore = this.bones.hand_l.position.length()
    this.len.thigh = this.bones.calf_l.position.length()
    this.len.calf = this.bones.foot_l.position.length()

    this.applyKit(kind, colors, skin)

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const [k, name] of Object.entries(CLIP_NAMES) as [ClipName, string][]) {
      const c = assets.clips[name]
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

  private applyKit(kind: KitKind, c: KitColors, skin: number) {
    const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.7, color: SKIN_TONES[skin % SKIN_TONES.length] })
    const umpire = kind === 'umpire'
    const shirt = umpire ? kitMaterial('#f1f1ee', '#1f2937', 'shirt', true) : kitMaterial(c.whites ? '#f3f1ea' : c.shirt, c.whites ? c.shirt : c.trim, 'shirt', c.whites)
    const trousers = umpire ? new THREE.MeshStandardMaterial({ color: '#202634', roughness: 0.8 }) : kitMaterial(c.whites ? '#eeebe2' : c.trousers, c.whites ? '#d6d3cb' : c.trim, 'trousers', c.whites)
    const shoes = new THREE.MeshStandardMaterial({ color: umpire ? '#111827' : '#f4f4f5', roughness: 0.6 })
    this.model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const name = (m.material as THREE.Material).name
      if (name === 'Cricketer_Skin') {
        const src = m.material as THREE.MeshStandardMaterial
        skinMat.map = src.map
        m.material = skinMat
      } else if (name === 'Cricketer_Shirt') m.material = shirt
      else if (name === 'Cricketer_Trousers') m.material = trousers
      else if (name === 'Cricketer_Shoes') m.material = shoes
    })
    const geo = kitGeo()
    const padMat = new THREE.MeshStandardMaterial({ color: c.whites || kind === 'keeper' ? '#f5f5f0' : c.shirt, roughness: 0.6 })
    const gloveMat = new THREE.MeshStandardMaterial({ color: kind === 'keeper' ? '#e5e7eb' : c.whites ? '#f5f5f0' : c.trim, roughness: 0.6 })
    const helmetMat = new THREE.MeshStandardMaterial({ color: c.whites ? '#1e293b' : c.trim === '#f8fafc' ? c.shirt : c.trousers, roughness: 0.35, metalness: 0.2 })
    const grilleMat = new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.8, roughness: 0.3 })
    const capMat = new THREE.MeshStandardMaterial({ color: c.whites ? c.shirt : c.trousers, roughness: 0.7 })
    const attach = (bone: THREE.Bone, g: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3, rot?: THREE.Euler) => {
      const mesh = new THREE.Mesh(g, mat)
      mesh.castShadow = true
      mesh.position.copy(at)
      if (rot) mesh.rotation.copy(rot)
      this.model.add(mesh)
      mesh.updateMatrixWorld(true)
      bone.attach(mesh)
      return mesh
    }
    const B = this.bones
    if (kind === 'batter' || kind === 'keeper') {
      // Pads on the shins (bind pose: legs straight, ankles at y 0.086).
      attach(B.calf_l, geo.padL, padMat, new THREE.Vector3(0.014, 0.02, -0.06))
      attach(B.calf_r, geo.padR, padMat, new THREE.Vector3(-0.014, 0.02, -0.06))
    }
    if (kind === 'batter') {
      attach(B.hand_l, geo.glove, gloveMat, new THREE.Vector3(0.74, 1.45, -0.06))
      attach(B.hand_r, geo.glove, gloveMat, new THREE.Vector3(-0.74, 1.45, -0.06))
      attach(B.Head, geo.helmet, helmetMat, new THREE.Vector3(0, 1.69, 0.0))
      attach(B.Head, geo.grille, grilleMat, new THREE.Vector3(0, 1.69, 0.0))
      this.bat = makeBat(c.whites ? '#7f1d1d' : c.trim)
      this.root.add(this.bat)
    } else if (kind === 'keeper') {
      attach(B.hand_l, geo.kglove, gloveMat, new THREE.Vector3(0.76, 1.445, -0.06))
      attach(B.hand_r, geo.kglove, gloveMat, new THREE.Vector3(-0.76, 1.445, -0.06))
      attach(B.Head, geo.cap, capMat, new THREE.Vector3(0, 1.735, -0.01))
    } else if (kind === 'umpire') {
      attach(B.Head, geo.hat, new THREE.MeshStandardMaterial({ color: '#f5f5f0', roughness: 0.8 }), new THREE.Vector3(0, 1.76, -0.01))
    } else {
      attach(B.Head, geo.cap, capMat, new THREE.Vector3(0, 1.735, -0.01))
    }
  }

  /** Use the low-detail body (distant fielders). */
  setLod(low: boolean) {
    for (const o of this.lod0) if (o.name.startsWith('Body')) o.visible = !low
    for (const o of this.lod1) o.visible = low
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

  private charMatrix(o: THREE.Object3D, out: THREE.Matrix4) {
    return out.multiplyMatrices(this.rootInv, o.matrixWorld)
  }
  private charPos(o: THREE.Object3D, out: THREE.Vector3) {
    return out.setFromMatrixPosition(this.charMatrix(o, _m1))
  }
  private charQuat(o: THREE.Object3D, out: THREE.Quaternion) {
    this.charMatrix(o, _m1)
    _m1.decompose(_v3, out, _v2)
    return out
  }
  /** Sets a bone's character-space orientation. */
  private setCharQuat(b: THREE.Object3D, q: THREE.Quaternion) {
    const pq = this.charQuat(b.parent!, _q2)
    b.quaternion.copy(pq.invert().multiply(q))
    b.updateMatrixWorld(true)
  }
  /** Rotates a bone so its length axis (+Y) points along dir (character space), with the least twist. */
  private aimBone(b: THREE.Object3D, dir: THREE.Vector3) {
    const q = this.charQuat(b, new THREE.Quaternion())
    const cur = _v1.copy(Y).applyQuaternion(q)
    const r = _q1.setFromUnitVectors(cur, _v2.copy(dir).normalize())
    this.setCharQuat(b, r.multiply(q))
  }
  /** Applies an extra character-space rotation to a bone. */
  private rotateBone(b: THREE.Object3D, r: THREE.Quaternion) {
    const q = this.charQuat(b, new THREE.Quaternion())
    this.setCharQuat(b, q.premultiply(r))
  }

  /** Two-bone IK: upper -> lower -> end reaches `target`, bending towards `pole` (a direction). */
  private ik(upper: THREE.Bone, lower: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, lenA: number, lenB: number) {
    const a = this.charPos(upper, new THREE.Vector3())
    const toT = target.clone().sub(a)
    let d = toT.length()
    d = THREE.MathUtils.clamp(d, Math.abs(lenA - lenB) + 0.01, (lenA + lenB) * 0.9995)
    const u = toT.normalize()
    const cosA = THREE.MathUtils.clamp((lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d), -1, 1)
    const sinA = Math.sqrt(1 - cosA * cosA)
    const v = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u)))
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1).sub(u.clone().multiplyScalar(u.z))
    v.normalize()
    const elbow = a.clone().addScaledVector(u, lenA * cosA).addScaledVector(v, lenA * sinA)
    const end = a.clone().addScaledVector(u, d)
    this.aimBone(upper, elbow.clone().sub(a))
    this.aimBone(lower, end.sub(elbow))
  }

  /* ---------------- per frame ---------------- */

  /**
   * Advances the clips, then applies the procedural pose on top (after prepare()).
   */
  /** Sets the world transform for this frame (call before toChar and update). */
  prepare(pos: THREE.Vector3, yaw: number, mirror: boolean) {
    this.root.position.copy(pos)
    this.root.rotation.set(0, yaw, 0)
    this.root.scale.set(mirror ? -1 : 1, 1, 1)
    this.model.position.set(0, 0, 0)
    this.model.quaternion.identity()
    this.root.updateMatrixWorld(true)
    this.rootInv.copy(this.root.matrixWorld).invert()
  }

  update(dt: number, pose: ProcPose | null) {
    this.mixer.update(dt)
    this.model.updateMatrixWorld(true)

    const target = pose ? pose.weight : 0
    // Smooth blending in and out of procedural poses.
    const rate = dt > 0 ? Math.min(1, dt * 10) : 1
    this.wNow += (target - this.wNow) * rate
    if (Math.abs(this.wNow - target) < 0.01) this.wNow = target
    const w = this.wNow
    if (!pose || w <= 0.001) {
      this.placeBatInHand()
      return
    }
    // Remember the clip's pose to blend with.
    POSED.forEach((n, i) => this.clipQ[i].copy(this.bones[n].quaternion))
    this.clipPelvis.copy(this.bones.pelvis.position)

    // Whole-body rotation (dives).
    if (pose.body) {
      this.model.quaternion.setFromAxisAngle(pose.body.axis, pose.body.angle * DEG)
      this.model.position.copy(pose.body.offset)
      this.root.updateMatrixWorld(true)
      // Pose in the rotated body's frame so the whole figure tips over.
      this.rootInv.copy(this.model.matrixWorld).invert()
    }

    // Start from the bind pose for the bones we drive.
    for (const n of POSED) this.bones[n].quaternion.copy(this.bindQ[n])
    const B = this.bones
    // Pelvis position.
    const pel = this.bindPelvisChar.clone()
    if (pose.pelvis) pel.add(pose.pelvis)
    _m2.copy(this.charMatrix(B.root, _m2)).invert()
    B.pelvis.position.copy(pel.applyMatrix4(_m2))
    this.model.updateMatrixWorld(true)
    if (pose.hips) {
      const [yw, pt, rl] = pose.hips
      _q1.setFromEuler(new THREE.Euler(pt * DEG, yw * DEG, rl * DEG, 'YXZ'))
      this.rotateBone(B.pelvis, _q1.clone())
      // Keep the legs' rest direction (the hips' twist mostly shows in the torso).
    }
    if (pose.spine) {
      const [bend, twist, side] = pose.spine
      const r = new THREE.Quaternion().setFromEuler(new THREE.Euler((bend / 3) * DEG, (twist / 3) * DEG, (side / 3) * DEG, 'YXZ'))
      this.rotateBone(B.spine_01, r)
      this.rotateBone(B.spine_02, r)
      this.rotateBone(B.spine_03, r)
    }
    // Legs.
    for (const s of ['L', 'R'] as const) {
      const foot = s === 'L' ? pose.footL : pose.footR
      const thigh = s === 'L' ? B.thigh_l : B.thigh_r
      const calf = s === 'L' ? B.calf_l : B.calf_r
      const fb = s === 'L' ? B.foot_l : B.foot_r
      const toe = ((s === 'L' ? pose.toeL : pose.toeR) ?? 0) * DEG
      const toeDir = new THREE.Vector3(Math.sin(toe), 0, Math.cos(toe))
      if (foot) {
        const knee = (s === 'L' ? pose.kneeL : pose.kneeR) ?? toeDir.clone().add(new THREE.Vector3(s === 'L' ? 0.15 : -0.15, 0.1, 0))
        this.ik(thigh, calf, foot, knee, this.len.thigh, this.len.calf)
      } else {
        // Keep the leg below the (moved) pelvis, straight down.
        this.aimBone(thigh, new THREE.Vector3(0, -1, 0.02))
        this.aimBone(calf, new THREE.Vector3(0, -1, -0.02))
      }
      this.aimBone(fb, toeDir.multiplyScalar(0.894).add(new THREE.Vector3(0, -0.448, 0)))
    }
    // Arms.
    for (const s of ['L', 'R'] as const) {
      const hand = s === 'L' ? pose.handL : pose.handR
      const up = s === 'L' ? B.upperarm_l : B.upperarm_r
      const lo = s === 'L' ? B.lowerarm_l : B.lowerarm_r
      const hb = s === 'L' ? B.hand_l : B.hand_r
      if (hand) {
        const elbow = (s === 'L' ? pose.elbowL : pose.elbowR) ?? new THREE.Vector3(s === 'L' ? 0.4 : -0.4, -1, -0.35)
        this.ik(up, lo, hand, elbow, this.len.upper, this.len.fore)
        // Hand continues the forearm, bent a little.
        const fore = this.charQuat(lo, new THREE.Quaternion())
        this.aimBone(hb, new THREE.Vector3(0, 1, 0).applyQuaternion(fore))
      } else {
        // Relaxed arm by the side.
        this.aimBone(up, new THREE.Vector3(s === 'L' ? 0.18 : -0.18, -1, 0.05))
        this.aimBone(lo, new THREE.Vector3(s === 'L' ? 0.05 : -0.05, -1, 0.25))
      }
    }
    // Head.
    if (pose.look) {
      const hp = this.charPos(B.Head, new THREE.Vector3())
      const want = pose.look.clone().sub(hp).normalize()
      const hq = this.charQuat(B.Head, new THREE.Quaternion())
      const fwd = this.headFwdLocal.clone().applyQuaternion(hq)
      const r = new THREE.Quaternion().setFromUnitVectors(fwd, want)
      // Limit the turn.
      const ang = 2 * Math.acos(THREE.MathUtils.clamp(r.w, -1, 1))
      if (ang > 1.3) r.slerp(new THREE.Quaternion(), 1 - 1.3 / ang)
      const half = new THREE.Quaternion().slerp(r, 0.4)
      this.rotateBone(B.neck_01, half)
      this.rotateBone(B.Head, new THREE.Quaternion().slerp(r, 0.6))
    }
    // Blend with the clip.
    if (w < 0.999) {
      POSED.forEach((n, i) => this.bones[n].quaternion.slerpQuaternions(this.clipQ[i], this.bones[n].quaternion.clone(), w))
      B.pelvis.position.lerpVectors(this.clipPelvis, B.pelvis.position.clone(), w)
      this.model.updateMatrixWorld(true)
    }
    if (pose.bat && this.bat) {
      this.placeBat(pose.bat.grip, pose.bat.dir, pose.bat.face)
      if (w < 0.999) this.placeBatInHand(1 - w)
    } else this.placeBatInHand()
  }

  /** Bat at a grip point with the blade along dir and the face towards `face` (character space). */
  private placeBat(grip: THREE.Vector3, dir: THREE.Vector3, face: THREE.Vector3) {
    if (!this.bat) return
    const yAxis = dir.clone().normalize().negate()
    const zAxis = face.clone().sub(yAxis.clone().multiplyScalar(face.dot(yAxis)))
    if (zAxis.lengthSq() < 1e-6) zAxis.set(1, 0, 0)
    zAxis.normalize()
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis)
    _m1.makeBasis(xAxis, yAxis, zAxis)
    this.bat.quaternion.setFromRotationMatrix(_m1)
    this.bat.position.copy(grip)
  }

  /** The bat carried in the bottom (right) hand when not batting. */
  private placeBatInHand(blend = 1) {
    if (!this.bat || blend <= 0) return
    const hm = this.charMatrix(this.bones.hand_r, _m2)
    const p = new THREE.Vector3().setFromMatrixPosition(hm)
    const q = new THREE.Quaternion()
    hm.decompose(_v3, q, _v2)
    const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
    const grip = p.clone().addScaledVector(fingers, 0.06)
    const dir = palm.clone().multiplyScalar(0.55).addScaledVector(fingers, 0.35).add(new THREE.Vector3(0, -0.6, 0)).normalize()
    if (blend >= 0.999) this.placeBat(grip, dir, new THREE.Vector3(0, 0, 1))
    else {
      const oldPos = this.bat.position.clone()
      const oldQ = this.bat.quaternion.clone()
      this.placeBat(grip, dir, new THREE.Vector3(0, 0, 1))
      this.bat.position.lerpVectors(oldPos, this.bat.position.clone(), blend)
      this.bat.quaternion.slerpQuaternions(oldQ, this.bat.quaternion.clone(), blend)
    }
  }

  /** World position of the bat's sweet spot (for effects). */
  batSweetSpot(out = new THREE.Vector3()) {
    if (!this.bat) return out.copy(this.root.position)
    return out.set(0, -0.5, 0.03).applyMatrix4(this.bat.matrixWorld)
  }

  /** World position of a hand. */
  handWorld(side: 'l' | 'r', out = new THREE.Vector3()) {
    return out.setFromMatrixPosition((side === 'l' ? this.bones.hand_l : this.bones.hand_r).matrixWorld)
  }

  /** Converts a world point into this body's character space. */
  toChar(world: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(world).applyMatrix4(this.rootInv)
  }

  dispose() {
    this.mixer.stopAllAction()
    this.root.removeFromParent()
  }
}
