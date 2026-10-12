// The visual side of a toy: a SkeletonUtils clone of the rigged Stitchling, flat-shaded and hue-shifted to the
// player's tint, with animation blending, squash-and-stretch, a lean, and an attachment API for cosmetics.
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { ClipName, PlushAssets, ToyKind } from './assets'

/** Animation states, in the order they are sent over the network. */
export const ANIMS = ['idle', 'run', 'jump', 'dive', 'push', 'knock', 'cheer', 'wave', 'dance', 'stomp', 'grab', 'sit', 'held', 'spin', 'flip', 'boogie', 'hang'] as const
export type AnimKey = (typeof ANIMS)[number]

/** Emotes a toy can do (Loft keys 1-6). The last three are unlockable extras with a procedural flourish. */
export const EMOTES = ['wave', 'dance', 'stomp', 'spin', 'flip', 'boogie'] as const
export type EmoteKey = (typeof EMOTES)[number]

const LOOPING: Partial<Record<AnimKey, boolean>> = { idle: true, run: true, cheer: true, wave: true, dance: true, stomp: true, sit: true, boogie: true, hang: true }
const CLIP_OF: Record<AnimKey, ClipName> = {
  idle: 'idle', run: 'run', jump: 'jump', dive: 'jump', push: 'push', knock: 'knock', cheer: 'cheer',
  wave: 'wave', dance: 'dance', stomp: 'stomp', grab: 'push', sit: 'idle', held: 'knock',
  spin: 'cheer', flip: 'jump', boogie: 'dance', hang: 'cheer',
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

/**
 * Fabric patterns drawn over the toy's own texture (the Sewing Table's Fabric slot). 0 is none. The pattern is
 * projected from the mesh's bind-pose position, so it sticks to the cloth while the toy moves.
 */
export const FABRICS = { none: 0, stripes: 1, polka: 2, tartan: 3, glitter: 4, corduroy: 5, denim: 6, velvet: 7, felt: 8 } as const
export type FabricName = keyof typeof FABRICS

/** Shared clock for twinkly patterns. */
const patTime = { value: 0 }

const PATTERN_GLSL = `
        if (uPat > 0.5) {
          vec3 an = abs(normalize(vPN));
          vec2 puv = an.x > an.z ? vPP.zy : vPP.xy;
          int pk = int(uPat + 0.5);
          vec3 pc0 = diffuseColor.rgb;
          float lum = dot(pc0, vec3(0.299, 0.587, 0.114));
          vec3 pc = uPatCol * (0.5 + 0.75 * lum);
          vec3 c = pc0;
          if (pk == 1) {
            c = mix(c, pc, step(0.5, fract(vPP.y * 7.0)) * 0.82);
          } else if (pk == 2) {
            vec2 g = fract(puv * 8.0) - 0.5;
            c = mix(c, pc, smoothstep(0.25, 0.19, length(g)) * 0.88);
          } else if (pk == 3) {
            float a = step(0.68, fract(puv.x * 4.0)), b = step(0.68, fract(puv.y * 4.0));
            float t1 = step(0.93, fract(puv.x * 12.0 + 0.3)), t2 = step(0.93, fract(puv.y * 12.0 + 0.3));
            c = mix(c, pc, (a + b) * 0.38);
            c = mix(c, c * 0.5, a * b * 0.55);
            c = mix(c, vec3(1.0, 0.96, 0.85) * (0.55 + lum), max(t1, t2) * 0.45);
          } else if (pk == 4) {
            float h = pHash(floor(vPP * 90.0));
            float tw = 0.5 + 0.5 * sin(uPatT * 5.0 + h * 40.0);
            float sp = step(0.86, h);
            c = mix(c, pc, 0.22) + sp * pc * 0.7 * tw;
            patGlow = sp * tw * 0.9;
          } else if (pk == 5) {
            c = mix(c, pc, 0.32) * (0.8 + 0.2 * (0.5 + 0.5 * sin(puv.x * 150.0)));
          } else if (pk == 6) {
            float tw = step(0.5, fract((puv.x + puv.y) * 55.0));
            c = mix(c, pc, 0.55) * (0.84 + 0.16 * tw);
          } else if (pk == 7) {
            c = mix(c, pc, 0.45) * 0.82;
            patGlow = -1.0;
          } else if (pk == 8) {
            c = mix(c, pc, 0.35) * (0.9 + 0.1 * pHash(floor(vPP * 240.0)));
          }
          diffuseColor.rgb = c;
        }`

/** Shader patch: rotate the texture's hue (YIQ) and scale saturation, plus an optional fabric pattern. */
function hueMaterial(src: THREE.MeshStandardMaterial, hue: number, sat: number, box: THREE.Box3 | null) {
  const m = src.clone()
  m.flatShading = true
  m.metalness = 0
  m.roughness = 0.88
  m.userData.hue = { value: hue }
  m.userData.sat = { value: sat }
  m.userData.pat = { value: 0 }
  m.userData.patCol = { value: new THREE.Color('#fff7e6') }
  const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1)
  m.userData.patC = { value: box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3() }
  m.userData.patS = { value: Math.max(1e-4, size.y) }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = m.userData.hue
    shader.uniforms.uSat = m.userData.sat
    shader.uniforms.uPat = m.userData.pat
    shader.uniforms.uPatCol = m.userData.patCol
    shader.uniforms.uPatC = m.userData.patC
    shader.uniforms.uPatS = m.userData.patS
    shader.uniforms.uPatT = patTime
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec3 uPatC;\nuniform float uPatS;\nvarying vec3 vPP;\nvarying vec3 vPN;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPP = (position - uPatC) / uPatS;\n  vPN = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uHue;
uniform float uSat;
uniform float uPat;
uniform vec3 uPatCol;
uniform float uPatT;
varying vec3 vPP;
varying vec3 vPN;
float pHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  float patGlow = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * diffuseColor.rgb;
          float ch = cos(uHue), sh = sin(uHue);
          yiq.yz = mat2(ch, sh, -sh, ch) * yiq.yz * uSat;
          diffuseColor.rgb = max(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * yiq, 0.0);
        }${PATTERN_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (patGlow > 0.0) totalEmissiveRadiance += uPatCol * patGlow;
        if (patGlow < 0.0) totalEmissiveRadiance += uPatCol * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5) * 0.5;`,
      )
  }
  m.customProgramCacheKey = () => 'plush-hue-fabric'
  m.needsUpdate = true
  return m
}

const ringGeo = new THREE.RingGeometry(0.34, 0.44, 24).rotateX(-Math.PI / 2)
const sashGeo = new THREE.TorusGeometry(0.27, 0.05, 5, 18)
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
  /** The skinned model (for measuring cosmetics fits). */
  readonly model: THREE.Object3D
  /** Between the tilt and the model: procedural emote moves (spin, flip, boogie) pivot here, at the toy's middle. */
  readonly emoteG = new THREE.Group()
  /**
   * Per-frame hooks for animated cosmetics (a spinning propeller, a turning wind-up key, a bobbing balloon).
   * Called at the end of update() with the render dt and the rig state.
   */
  readonly animators: ((dt: number, s: RigState) => void)[] = []
  /** Cosmetics by slot (set by the wardrobe), so one can be taken off again (the crown replaces a hat). */
  readonly cosmetics = new Map<string, () => void>()
  /** Flair trail drawn behind the toy while it runs (particles, local to each screen). */
  trail: { kind: 'glitter' | 'bubbles' | 'stuffing'; color: THREE.Color } | null = null
  /** Engine scratch for the trail emitter. */
  trailT = 0
  private animT = 0
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
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
          const nm = hueMaterial(mat, -dh * Math.PI * 2, sat, m.geometry.boundingBox)
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
    // Pivot procedural emotes about the toy's middle: tilt > emoteG (at 0.5 m) > inner (back down) > model.
    const inner = new THREE.Group()
    this.emoteG.position.y = 0.5
    inner.position.y = -0.5
    inner.add(this.model)
    this.emoteG.add(inner)
    this.tilt.add(this.emoteG)

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

  /** Pose the rig on the first frame of its idle (cosmetics are fitted and attached in this pose). */
  settle() {
    const idle = this.actions.idle
    if (this.mixer && idle) {
      // Full weight straight away (a zero-length fade would leave the bind pose for this one update).
      this.mixer.stopAllAction()
      idle.reset()
      idle.setLoop(THREE.LoopRepeat, Infinity)
      idle.setEffectiveWeight(1)
      idle.play()
      this.current = 'idle'
      this.mixer.update(0)
    }
    this.root.updateMatrixWorld(true)
  }

  /** Fabric pattern over the toy's cloth (see FABRICS) in a stitch colour. */
  setFabric(pattern: FabricName | number, color: THREE.ColorRepresentation) {
    const id = typeof pattern === 'number' ? pattern : (FABRICS[pattern] ?? 0)
    for (const m of this.materials) {
      const u = m.userData
      if (!u.pat) continue
      u.pat.value = id
      ;(u.patCol.value as THREE.Color).set(color)
    }
  }

  /** The stitch colour currently used by the fabric pattern (animators recolour it, e.g. rainbow thread). */
  setFabricColor(color: THREE.Color) {
    for (const m of this.materials) if (m.userData.patCol) (m.userData.patCol.value as THREE.Color).copy(color)
  }

  /** Take off the cosmetic in a slot (if any). */
  takeOff(slot: string) {
    this.cosmetics.get(slot)?.()
    this.cosmetics.delete(slot)
  }

  /** Squash (negative) or stretch (positive) kick, e.g. -0.3 on a hard landing. */
  kick(amount: number) {
    this.squashV += amount * 9
  }

  play(key: AnimKey, fade = 0.15) {
    if (key === this.current) return
    const prevKey = this.current
    this.current = key
    this.animT = 0
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
    this.animT += dt
    this.emoteMove()
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
    patTime.value = performance.now() / 1000
    for (const a of this.animators) a(dt, s)
  }

  /** The unlockable emotes' flourish on top of their clip: a double spin, a backflip, a bouncy boogie. */
  private emoteMove() {
    const e = this.emoteG
    const t = this.animT
    const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
    if (this.current === 'spin') {
      e.rotation.set(0, ease(Math.min(1, t / 1.3)) * Math.PI * 4, 0)
      e.position.y = 0.5 + Math.sin(Math.min(1, t / 1.3) * Math.PI) * 0.15
    } else if (this.current === 'flip') {
      const k = Math.min(1, t / 0.9)
      e.rotation.set(-ease(k) * Math.PI * 2, 0, 0)
      e.position.y = 0.5 + Math.sin(k * Math.PI) * 0.75
    } else if (this.current === 'boogie') {
      e.rotation.set(0, Math.sin(t * 4.2) * 0.5, Math.sin(t * 8.4) * 0.16)
      e.position.y = 0.5 + Math.abs(Math.sin(t * 8.4)) * 0.12
    } else if (e.position.y !== 0.5 || e.rotation.x !== 0 || e.rotation.y !== 0 || e.rotation.z !== 0) {
      e.rotation.set(0, 0, 0)
      e.position.y = 0.5
    }
  }

  /**
   * Team levels: a sash across the chest and the foot ring in the team colour (the toy keeps its own tint).
   * Returns a function that takes the sash off again.
   */
  setTeam(color: string) {
    const c = new THREE.Color(color)
    ;(this.ring.material as THREE.MeshBasicMaterial).color.copy(c)
    this.ring.scale.setScalar(1.12)
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, emissive: c, emissiveIntensity: 0.18, flatShading: true })
    this.materials.push(mat)
    const g = new THREE.Group()
    const sash = new THREE.Mesh(sashGeo, mat)
    sash.rotation.set(Math.PI / 2, 0.55, 0)
    const knot = new THREE.Mesh(knotGeo, mat)
    knot.position.set(0.17, -0.1, 0.17)
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
    // Cosmetics: free what this rig made for itself (shared pieces are marked userData.keep).
    for (const h of this.attached)
      h.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        if (!m.geometry.userData.keep) m.geometry.dispose()
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!mt.userData.keep) mt.dispose()
      })
    this.animators.length = 0
  }
}
