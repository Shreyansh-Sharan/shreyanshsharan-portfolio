// The visual side of a toy: a SkeletonUtils clone of the rigged Stitchling, flat-shaded and hue-shifted to the
// player's tint, with animation blending, squash-and-stretch, a lean, and an attachment API for cosmetics.
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { ClipName, PlushAssets, ToyKind } from './assets'

/** Animation states, in the order they are sent over the network. */
export const ANIMS = ['idle', 'run', 'jump', 'dive', 'push', 'knock', 'cheer', 'wave', 'dance', 'stomp', 'grab', 'sit', 'held'] as const
export type AnimKey = (typeof ANIMS)[number]

const LOOPING: Partial<Record<AnimKey, boolean>> = { idle: true, run: true, cheer: true, wave: true, dance: true, stomp: true, sit: true }
const CLIP_OF: Record<AnimKey, ClipName> = {
  idle: 'idle', run: 'run', jump: 'jump', dive: 'jump', push: 'push', knock: 'knock', cheer: 'cheer',
  wave: 'wave', dance: 'dance', stomp: 'stomp', grab: 'push', sit: 'idle', held: 'knock',
}

/**
 * Where cosmetics go. Each slot is a bone of the shared rig; `attach()` also accepts any bone name.
 * Head: hats and faces. Back: backpacks, wings, wind-up keys. Hands and feet: held items and shoes.
 */
export const SLOTS = {
  head: 'Head',
  face: 'headfront',
  back: 'Spine02',
  chest: 'Spine01',
  hips: 'Hips',
  handR: 'RightHand',
  handL: 'LeftHand',
  footR: 'RightFoot',
  footL: 'LeftFoot',
} as const
export type Slot = keyof typeof SLOTS

/** Per-frame description of what the toy is doing (from the simulation or a snapshot). */
export interface RigState {
  anim: AnimKey
  speed: number
  vy: number
  grounded: boolean
  /** Ball mode: the ball's velocity for rolling, null when walking. */
  ball: boolean
  ballVel: THREE.Vector3
  ballScale: number
  stun: number
}

// Average colour of each kind's texture, so a tint can be turned into a hue shift.
const baseHue = new Map<string, { h: number; s: number }>()

function textureHue(tex: THREE.Texture | null): { h: number; s: number } {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!img || !img.width) return { h: 0, s: 0.5 }
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 24
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, 24, 24)
    const d = g.getImageData(0, 0, 24, 24).data
    // Weight saturated pixels: the cloth colour rather than the eyes and stitches.
    let x = 0, y = 0, w = 0, sat = 0
    const col = new THREE.Color()
    const hsl = { h: 0, s: 0, l: 0 }
    for (let i = 0; i < d.length; i += 4) {
      col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
      col.getHSL(hsl)
      const k = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 1.6)
      if (k <= 0) continue
      x += Math.cos(hsl.h * Math.PI * 2) * k
      y += Math.sin(hsl.h * Math.PI * 2) * k
      sat += hsl.s * k
      w += k
    }
    if (w <= 0) return { h: 0, s: 0.5 }
    return { h: (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, s: sat / w }
  } catch {
    return { h: 0, s: 0.5 }
  }
}

/** Shader patch: rotate the texture's hue (YIQ) and scale saturation. Cheap, and keeps the knit detail. */
function hueMaterial(src: THREE.MeshStandardMaterial, hue: number, sat: number) {
  const m = src.clone()
  m.flatShading = true
  m.metalness = 0
  m.roughness = 0.88
  m.userData.hue = { value: hue }
  m.userData.sat = { value: sat }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = m.userData.hue
    shader.uniforms.uSat = m.userData.sat
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uHue;\nuniform float uSat;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * diffuseColor.rgb;
          float ch = cos(uHue), sh = sin(uHue);
          yiq.yz = mat2(ch, sh, -sh, ch) * yiq.yz * uSat;
          diffuseColor.rgb = max(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * yiq, 0.0);
        }`,
      )
  }
  m.customProgramCacheKey = () => 'plush-hue'
  m.needsUpdate = true
  return m
}

const ringGeo = new THREE.RingGeometry(0.34, 0.44, 24).rotateX(-Math.PI / 2)
const sashGeo = new THREE.TorusGeometry(0.33, 0.055, 5, 18)
const knotGeo = new THREE.IcosahedronGeometry(0.08, 0)
const ballGeo = new THREE.IcosahedronGeometry(0.55, 2)

/** Stripy beach-ball texture for ball mode (shared). */
let ballTex: THREE.Texture | null = null
function ballTexture() {
  if (ballTex) return ballTex
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 64)
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0.28)'
    g.fillRect((i * 128) / 6, 0, 128 / 6, 64)
  }
  ballTex = new THREE.CanvasTexture(c)
  ballTex.colorSpace = THREE.SRGBColorSpace
  return ballTex
}

export class ToyRig {
  /** At the toy's feet, rotated to its facing. */
  readonly root = new THREE.Group()
  /** Lean, dive pitch, tumble and squash live here, under the root. */
  readonly tilt = new THREE.Group()
  /** The ball for ball-mode levels (world-aligned, so it can roll). */
  readonly ball: THREE.Mesh
  /** A coloured ring under the feet so everyone can find each toy at a glance. */
  readonly ring: THREE.Mesh
  readonly kind: ToyKind
  readonly color: THREE.Color
  private model: THREE.Object3D
  private mixer: THREE.AnimationMixer | null = null
  private actions: Partial<Record<ClipName, THREE.AnimationAction>> = {}
  private current: AnimKey | null = null
  private hips: { bone: THREE.Object3D; rest: THREE.Vector3 } | null = null
  private bones = new Map<string, THREE.Object3D>()
  private materials: THREE.Material[] = []
  private attached: THREE.Object3D[] = []
  private squash = 0
  private squashV = 0
  private lastVy = 0
  private wasGrounded = true
  private roll = 0
  private ballQ = new THREE.Quaternion()
  private tmpQ = new THREE.Quaternion()
  private axis = new THREE.Vector3()
  /** Extra visual lift (e.g. riding a ball). */
  lift = 0

  constructor(assets: PlushAssets, kind: ToyKind, tint: string, shadows: boolean) {
    this.kind = kind
    this.color = new THREE.Color(tint)
    this.root.add(this.tilt)
    const src = assets.toys[kind] ?? assets.toys[assets.kinds[0]]
    if (src) {
      const model = cloneSkinned(src.scene)
      model.scale.multiplyScalar(src.scale)
      const tintHsl = { h: 0, s: 0, l: 0 }
      this.color.getHSL(tintHsl)
      model.traverse((o) => {
        const m = o as THREE.SkinnedMesh
        if (m.isMesh) {
          m.castShadow = shadows
          m.receiveShadow = false
          m.frustumCulled = false
          const mat = m.material as THREE.MeshStandardMaterial
          if (!baseHue.has(kind)) baseHue.set(kind, textureHue(mat.map))
          const b = baseHue.get(kind)!
          // A near-white tint keeps the toy's own colours.
          const keep = tintHsl.s < 0.08
          let dh = keep ? 0 : tintHsl.h - b.h
          dh = ((dh + 1.5) % 1) - 0.5
          const sat = keep ? 1 : THREE.MathUtils.clamp((tintHsl.s / Math.max(0.15, b.s)) * 0.9, 0.55, 1.5)
          const nm = hueMaterial(mat, -dh * Math.PI * 2, sat)
          this.materials.push(nm)
          m.material = nm
        }
        if ((o as THREE.Bone).isBone || o.type === 'Bone') this.bones.set(o.name, o)
      })
      const hips = this.bones.get('Hips')
      if (hips) this.hips = { bone: hips, rest: hips.position.clone() }
      this.mixer = new THREE.AnimationMixer(model)
      for (const [k, clip] of Object.entries(src.clips) as [ClipName, THREE.AnimationClip][]) this.actions[k] = this.mixer.clipAction(clip)
      this.model = model
    } else {
      // Fallback: a soft lump with button eyes.
      const mat = new THREE.MeshStandardMaterial({ color: this.color, flatShading: true, roughness: 0.9 })
      this.materials.push(mat)
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.35, 4, 10), mat)
      body.position.y = 0.5
      body.castShadow = shadows
      const eyeMat = new THREE.MeshStandardMaterial({ color: '#1f1a17' })
      for (const x of [-0.11, 0.11]) {
        const e = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10).rotateX(Math.PI / 2), eyeMat)
        e.position.set(x, 0.72, 0.28)
        body.add(e)
        e.position.y -= 0.5
      }
      const g = new THREE.Group()
      g.add(body)
      this.model = g
      this.bones.set('Head', body)
    }
    this.tilt.add(this.model)

    const ringMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.85, depthWrite: false })
    this.materials.push(ringMat)
    this.ring = new THREE.Mesh(ringGeo, ringMat)
    this.ring.position.y = 0.03
    this.ring.renderOrder = 2
    this.root.add(this.ring)

    const ballMat = new THREE.MeshStandardMaterial({ color: this.color.clone().lerp(new THREE.Color('#ffffff'), 0.25), map: ballTexture(), roughness: 0.35, flatShading: true })
    this.materials.push(ballMat)
    this.ball = new THREE.Mesh(ballGeo, ballMat)
    this.ball.castShadow = shadows
    this.ball.visible = false
    this.play('idle', 0)
  }

  /** The bone for a slot (or a bone name), or the model root if the rig has no such bone. */
  bone(slot: Slot | string): THREE.Object3D {
    const name = (SLOTS as Record<string, string>)[slot] ?? slot
    return this.bones.get(name) ?? this.model
  }

  /**
   * Put a mesh on a bone. `size` is in metres at toy scale: the bone's world scale (the rig sits under a 0.01
   * armature) is cancelled so a 0.3 m hat is 0.3 m whatever the bone. Offsets are in metres along the toy's
   * own axes (x right, y up, z forward). Returns a function that removes it again.
   */
  attach(slot: Slot | string, obj: THREE.Object3D, opts: { offset?: [number, number, number]; rotation?: [number, number, number]; scale?: number } = {}) {
    const b = this.bone(slot)
    this.root.updateMatrixWorld(true)
    const holder = new THREE.Group()
    holder.name = `attach:${slot}`
    // Undo the bone's world rotation and scale so the cosmetic is upright in toy space at bind time.
    const bw = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3()
    b.matrixWorld.decompose(bw, bq, bs)
    const rq = new THREE.Quaternion()
    this.root.getWorldQuaternion(rq)
    holder.quaternion.copy(bq.invert().multiply(rq))
    holder.scale.setScalar((opts.scale ?? 1) / Math.max(1e-6, bs.x))
    const inner = new THREE.Group()
    if (opts.offset) inner.position.set(...opts.offset)
    if (opts.rotation) inner.rotation.set(...opts.rotation)
    inner.add(obj)
    holder.add(inner)
    b.add(holder)
    this.attached.push(holder)
    return () => {
      holder.removeFromParent()
      this.attached = this.attached.filter((h) => h !== holder)
    }
  }

  /** Squash (negative) or stretch (positive) kick, e.g. -0.3 on a hard landing. */
  kick(amount: number) {
    this.squashV += amount * 9
  }

  play(key: AnimKey, fade = 0.15) {
    if (key === this.current) return
    const prevKey = this.current
    this.current = key
    if (!this.mixer) return
    const clipName = CLIP_OF[key]
    const next = this.actions[clipName] ?? this.actions.idle
    if (!next) return
    const prev = prevKey ? this.actions[CLIP_OF[prevKey]] : null
    const clip = next.getClip()
    next.reset()
    next.enabled = true
    next.setEffectiveWeight(1)
    if (LOOPING[key]) next.setLoop(THREE.LoopRepeat, Infinity)
    else {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    }
    next.timeScale = 1
    next.paused = false
    if (key === 'push') next.timeScale = clip.duration / 0.75
    else if (key === 'knock') next.timeScale = 1.5
    else if (key === 'held') {
      next.time = clip.duration * 0.35
      next.paused = true
    } else if (key === 'grab') {
      next.time = clip.duration * 0.45
      next.paused = true
    } else if (key === 'dive') {
      next.time = clip.duration * 0.42
      next.paused = true
    } else if (key === 'jump') next.timeScale = 1.6
    if (prev && prev !== next) {
      next.crossFadeFrom(prev, fade, false)
    } else next.fadeIn(fade)
    next.play()
  }

  /** Advance animation and the procedural wobble. `dt` is render time (slowed during hit-stop). */
  update(dt: number, s: RigState) {
    // Landing / take-off squash.
    if (s.grounded && !this.wasGrounded && this.lastVy < -4) this.kick(-Math.min(0.45, -this.lastVy / 30))
    if (!s.grounded && this.wasGrounded && s.vy > 4) this.kick(0.22)
    this.wasGrounded = s.grounded
    this.lastVy = s.vy
    // Spring back to rest.
    this.squashV += (-140 * this.squash - 11 * this.squashV) * dt
    this.squash = THREE.MathUtils.clamp(this.squash + this.squashV * dt, -0.45, 0.45)
    const sy = 1 + this.squash
    const sxz = 1 - this.squash * 0.5
    this.tilt.scale.set(sxz, sy, sxz)

    // Lean into the run, pitch over on a dive, wobble when dazed.
    let pitch = Math.min(0.22, s.speed * 0.035)
    if (s.anim === 'dive') pitch = 1.2
    if (s.anim === 'held') pitch = -0.3
    this.roll += dt * 9
    const dazed = s.stun > 0 && s.anim !== 'knock' ? Math.sin(this.roll) * 0.12 : 0
    this.tilt.rotation.x = THREE.MathUtils.damp(this.tilt.rotation.x, pitch, 10, dt)
    this.tilt.rotation.z = THREE.MathUtils.damp(this.tilt.rotation.z, dazed, 10, dt)
    this.tilt.position.y = this.lift + (s.anim === 'dive' ? 0.25 : 0)

    this.play(s.anim)
    const run = this.actions.run
    if (run && this.current === 'run') run.timeScale = THREE.MathUtils.clamp(s.speed / 5, 0.6, 1.6)
    this.mixer?.update(dt)
    // The clips drift the hips sideways: cap it (rig units are centimetres) so physics owns where the toy is.
    if (this.hips) {
      const h = this.hips
      const lim = 6
      h.bone.position.x = h.rest.x + THREE.MathUtils.clamp(h.bone.position.x - h.rest.x, -lim, lim)
      h.bone.position.z = h.rest.z + THREE.MathUtils.clamp(h.bone.position.z - h.rest.z, -lim, lim)
      if (this.current === 'jump' || this.current === 'dive') h.bone.position.y = Math.min(h.bone.position.y, h.rest.y)
    }

    // The ball rolls with the toy's velocity (world-aligned).
    this.ball.visible = s.ball
    this.ring.visible = !s.ball
    if (s.ball) {
      const v = s.ballVel
      const sp = Math.hypot(v.x, v.z)
      if (sp > 0.05) {
        this.axis.set(v.z, 0, -v.x).normalize()
        this.tmpQ.setFromAxisAngle(this.axis, (sp / 0.55) * dt)
        this.ballQ.premultiply(this.tmpQ)
      }
      this.ball.quaternion.copy(this.ballQ)
      this.ball.scale.setScalar(s.ballScale)
    }
  }

  /**
   * Team levels: a sash across the chest and the foot ring in the team colour (the toy keeps its own tint).
   * Returns a function that takes the sash off again.
   */
  setTeam(color: string) {
    const c = new THREE.Color(color)
    ;(this.ring.material as THREE.MeshBasicMaterial).color.copy(c)
    this.ring.scale.setScalar(1.25)
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, emissive: c, emissiveIntensity: 0.18, flatShading: true })
    this.materials.push(mat)
    const g = new THREE.Group()
    const sash = new THREE.Mesh(sashGeo, mat)
    sash.rotation.set(Math.PI / 2, 0.55, 0)
    const knot = new THREE.Mesh(knotGeo, mat)
    knot.position.set(0.22, -0.12, 0.2)
    g.add(sash, knot)
    return this.attach('chest', g, { offset: [0, 0.02, 0] })
  }

  setVisible(v: boolean) {
    this.root.visible = v
    if (!v) this.ball.visible = false
  }

  dispose() {
    this.root.removeFromParent()
    this.ball.removeFromParent()
    this.mixer?.stopAllAction()
    for (const m of this.materials) m.dispose()
  }
}
