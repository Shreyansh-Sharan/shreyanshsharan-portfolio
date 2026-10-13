// A fighter on screen: the hero's skinned character (or a procedural stand-in), its blaster in the right hand,
// team ring, shadow blob, shield bubble and cloak fade.
//
// Animation is layered on one AnimationMixer per fighter:
//   - lower body (hips, legs; the "locomotion" layer): idle / walk / run cycles blended by speed, with the cycle
//     phase driven from the fighter's ground speed and each clip's measured natural speed so feet don't slide.
//     Direction comes from a procedural twist: the pelvis yaws towards the velocity (up to ±80°) while the spine
//     counter-yaws so the torso keeps facing the aim; moving backwards plays the cycle in reverse. That gives
//     continuous strafe / backpedal / diagonal locomotion from the two cycle clips.
//   - upper body (spine and up; the "aim" layer): a looping aim pose, with fire clips played additively on each
//     shot. The torso therefore always tracks the aim while the legs follow movement.
//   - full-body overrides: death (plays once, holds, then the body sinks and fades) and the hero's super.
//   - procedural extras on top of the mixer: run lean, dash lunge, shot recoil, hit flinch, spawn-in squash.
//   - a status aura under the feet (Heat Vent wind-up, poison, scorch, slow, mark, buffs) and a heat column while
//     venting; these are separate meshes, so the animation layers are untouched.
// Far fighters (off the focus) step the mixer at 10 Hz.
import * as THREE from 'three'
import { MANIFEST, findClip, instance, type CharSpec, type SiegeAssets } from '../engine/assets'
import { HEROES, type HeroId } from '../engine/heroes'
import { STATUS_INFO, STATUS_KINDS } from '../engine/powers'
import { SKINS } from '../engine/progress'

export type Relation = 'me' | 'ally' | 'enemy'

export const RELATION_COLORS: Record<Relation, string> = { me: '#ffffff', ally: '#22d3ee', enemy: '#fb7185' }

/** Fallback upper-body bone filter when a character spec has none. */
const UPPER_DEFAULT = /spine1|spine2|spine_02|spine_03|chest|torso|shoulder|clavicle|arm|hand|gun|weapon|head|neck|clip/i
/** Most the pelvis may twist away from the torso. */
const MAX_TWIST = (85 * Math.PI) / 180
/** Hysteresis band (|angle to aim|) where the forward / backward cycle regime holds its previous choice. */
const BACK_ON = (100 * Math.PI) / 180
const BACK_OFF = (80 * Math.PI) / 180

const WHITE = new THREE.Color('#ffffff')
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpQ2 = new THREE.Quaternion()
const tmpV2 = new THREE.Vector3()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

let shadowTex: THREE.Texture | null = null
function shadowTexture() {
  if (shadowTex) return shadowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(0.6, 'rgba(0,0,0,0.3)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  shadowTex = new THREE.CanvasTexture(c)
  return shadowTex
}

/** Rotate a bone's local quaternion so its world orientation turns by `rot` (given in the body frame). */
function preRotate(bone: THREE.Object3D, parentWorld: THREE.Quaternion, rot: THREE.Quaternion) {
  // L' = P⁻¹ · R · P · L
  tmpQ2.copy(parentWorld).invert().multiply(rot).multiply(parentWorld)
  bone.quaternion.premultiply(tmpQ2)
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

interface Cycle {
  fwd: THREE.AnimationAction
  back: THREE.AnimationAction
  /** Metres the fighter travels in one cycle of the clip at the clip's natural rate. */
  dist: number
  duration: number
}

export class FighterActor {
  readonly group = new THREE.Group()
  readonly body: THREE.Object3D
  private spec: CharSpec | null
  private mixer: THREE.AnimationMixer | null = null
  private idleLo: THREE.AnimationAction | null = null
  private walk: Cycle | null = null
  private run: Cycle | null = null
  private aimUp: THREE.AnimationAction | null = null
  private fireUp: THREE.AnimationAction | null = null
  private fire2Up: THREE.AnimationAction | null = null
  private deathAct: THREE.AnimationAction | null = null
  private superAct: THREE.AnimationAction | null = null
  private lowerActs: THREE.AnimationAction[] = []
  private hand: THREE.Object3D | null = null
  private spine: THREE.Object3D | null = null
  private spine1: THREE.Object3D | null = null
  private head: THREE.Object3D | null = null
  private root: THREE.Object3D | null = null
  private muzzleBone: THREE.Object3D | null = null
  /** Mixer output of the procedurally edited bones, restored before each mixer step so edits never accumulate. */
  private base = new Map<THREE.Object3D, THREE.Quaternion>()
  private ring: THREE.Mesh
  private ringMat: THREE.MeshBasicMaterial
  private accent: THREE.Mesh
  private accentMat: THREE.MeshBasicMaterial
  private shadow: THREE.Mesh
  private shadowMat: THREE.MeshBasicMaterial
  private shield: THREE.Mesh
  private shieldMat: THREE.MeshBasicMaterial
  private aura: THREE.Mesh
  private auraMat: THREE.MeshBasicMaterial
  private heat: THREE.Mesh
  private heatMat: THREE.MeshBasicMaterial
  private mats: THREE.Material[] = []
  private gun: THREE.Object3D | null = null
  private gunLen = 0.9
  private gunOffset = new THREE.Vector3(0.05, -0.05, 0.2)
  private gunMats: THREE.MeshLambertMaterial[] = []
  private heroSpeed: number
  private fastGun: boolean
  // Locomotion state.
  private phase = Math.random()
  private twist = 0
  private backK = 0
  private backRegime = false
  private lean = 0
  private leanDir = new THREE.Vector2(0, 1)
  private idleW = 1
  /** 0..1 weight of the full-body super clip over the layered locomotion / aim actions. */
  private overrideK = 0
  // Timers.
  private deadAt = -1
  private fallT = -1
  private recoil = 0
  private flinchK = 0
  private flinchYaw = 0
  private superT = -1
  private spawnT = -1
  private acc = 0
  private bob = Math.random() * 10
  private opacity = 1
  private fade = 1
  alive = true
  readonly heroId: HeroId
  readonly skin: string

  constructor(assets: SiegeAssets, heroId: HeroId, skin: string, relation: Relation) {
    this.heroId = heroId
    this.skin = skin
    const hero = HEROES[heroId]
    this.heroSpeed = hero.speed
    this.fastGun = hero.weapon.cooldown < 0.3
    const palette = SKINS[skin] ?? SKINS.default
    const tint = new THREE.Color(palette.tint)
    const glow = new THREE.Color(palette.glow)
    this.spec = MANIFEST[hero.model]?.char ?? null
    let body = instance(assets, hero.model)
    const clips = assets.clips.get(hero.model)
    if (!body) {
      body = proceduralBody(hero.colors[0])
      this.spec = null
    }
    this.body = body
    this.group.add(body)
    // Per-fighter materials: a mild palette tint and glow, textures kept.
    const seen = new Map<THREE.Material, THREE.Material>()
    body.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = Array.isArray(m.material) ? m.material : [m.material]
      const out = src.map((mat) => {
        let c = seen.get(mat)
        if (!c) {
          c = mat.clone()
          if (c.transparent) c.userData.alwaysTransparent = true
          const std = c as THREE.MeshStandardMaterial
          if (std.color) std.color.copy(WHITE).lerp(tint, 0.55)
          if (std.emissive && skin !== 'default' && !std.emissiveMap) {
            std.emissive.copy(glow)
            std.emissiveIntensity = 0.16
          }
          seen.set(mat, c)
          this.mats.push(c)
        }
        return c
      })
      m.material = out.length === 1 ? out[0] : out
      m.castShadow = true
    })
    if (this.spec) {
      const s = this.spec
      body.traverse((o) => {
        if (!(o as THREE.Bone).isBone) return
        if (!this.hand && s.hand.test(o.name)) this.hand = o
        if (!this.spine && s.spine.test(o.name)) this.spine = o
        if (!this.spine1 && s.spine1?.test(o.name)) this.spine1 = o
        if (!this.head && s.head?.test(o.name)) this.head = o
        if (!this.root && s.root?.test(o.name)) this.root = o
        if (s.ownGun && !this.muzzleBone && s.ownGun.test(o.name)) this.muzzleBone = o
      })
      if (s.gunOffset) this.gunOffset.fromArray(s.gunOffset)
    }
    if (clips && this.spec) this.setupClips(clips, this.spec)
    // Blaster in the right hand (unless the model carries its own weapon).
    if (!this.muzzleBone) {
      const gun = instance(assets, hero.gun)
      if (gun) {
        gun.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const mat = (m.material as THREE.MeshLambertMaterial).clone()
          // Neon parts (emissive mask) glow steadily; the rest only flashes in the skin's glow on a shot.
          mat.userData.glowBase = mat.emissiveMap ? 0.9 : 0
          if (!mat.emissiveMap) mat.emissive = new THREE.Color(palette.glow)
          mat.emissiveIntensity = mat.userData.glowBase as number
          m.material = mat
          this.gunMats.push(mat)
        })
        this.gunLen = (gun.userData.depth as number) || (gun.userData.width as number) || 0.9
        gun.rotation.y = Math.PI
        gun.position.set(0.34, 1.32, 0.62)
        this.group.add(gun)
        this.gun = gun
      }
    }
    // Team ring and a thin palette accent ring inside it.
    this.ringMat = new THREE.MeshBasicMaterial({ color: RELATION_COLORS[relation], transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 32), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.03
    this.accentMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })
    this.accent = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 32), this.accentMat)
    this.accent.rotation.x = -Math.PI / 2
    this.accent.position.y = 0.03
    this.group.add(this.ring, this.accent)
    // Soft shadow blob so the feet read against the floor from above.
    const w = Math.max(0.9, ((body.userData.width as number) || 1) * 0.9)
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 1, depthWrite: false, color: '#000000' })
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, w * 1.6), this.shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.02
    this.shadow.renderOrder = -1
    this.group.add(this.shadow)
    // Shield bubble.
    this.shieldMat = new THREE.MeshBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.22, depthWrite: false })
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), this.shieldMat)
    this.shield.position.y = 1.05
    this.shield.visible = false
    this.group.add(this.shield)
    // Status aura (a second ring outside the team ring) and the Heat Vent column.
    this.auraMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    this.aura = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.9, 36), this.auraMat)
    this.aura.rotation.x = -Math.PI / 2
    this.aura.position.y = 0.04
    this.aura.visible = false
    this.heatMat = new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    this.heat = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 2.4, 24, 1, true), this.heatMat)
    this.heat.position.y = 1.2
    this.heat.visible = false
    this.group.add(this.aura, this.heat)
  }

  /**
   * Status effects from the snapshot mask: the most pressing one colours the aura (debuffs first), and a Heat Vent
   * wind-up lights the column. Returns the aura colour (or null) so the view can add matching particles.
   */
  status(mask: number, channel: boolean, time: number) {
    if (!this.alive) {
      this.aura.visible = this.heat.visible = false
      return null
    }
    this.heat.visible = channel
    if (channel) {
      this.heatMat.opacity = 0.35 + Math.sin(time * 40) * 0.12
      this.heat.scale.set(1 + Math.sin(time * 30) * 0.05, 1, 1 + Math.sin(time * 30) * 0.05)
    }
    let pick = -1
    for (const debuff of [true, false])
      for (let i = 0; i < STATUS_KINDS.length && pick < 0; i++) if (mask & (1 << i) && STATUS_INFO[STATUS_KINDS[i]].debuff === debuff && STATUS_KINDS[i] !== 'revive') pick = i
    if (channel) {
      this.aura.visible = true
      this.auraMat.color.set('#ff7a1a')
      this.auraMat.opacity = 0.9
      this.aura.scale.setScalar(1.2 + Math.sin(time * 25) * 0.15)
      return '#ff7a1a'
    }
    if (pick < 0) {
      this.aura.visible = false
      return null
    }
    const info = STATUS_INFO[STATUS_KINDS[pick]]
    this.aura.visible = true
    this.auraMat.color.set(info.color)
    this.auraMat.opacity = (info.debuff ? 0.75 : 0.5) * this.opacity
    this.aura.scale.setScalar(1 + Math.sin(time * (info.debuff ? 9 : 4)) * 0.08)
    return info.color
  }

  private setupClips(clips: THREE.AnimationClip[], s: CharSpec) {
    const mixer = (this.mixer = new THREE.AnimationMixer(this.body))
    const upper = s.upper ?? UPPER_DEFAULT
    const scale = (this.body.userData.scale as number) || 1
    const idle = findClip(clips, s.clips.idle)
    const walk = findClip(clips, s.clips.walk)
    const run = findClip(clips, s.clips.run) ?? walk
    const aim = findClip(clips, s.clips.aim) ?? idle
    const fire = findClip(clips, s.clips.fire)
    const fire2 = findClip(clips, s.clips.fire2)
    const death = findClip(clips, s.clips.death)
    const sup = findClip(clips, s.clips.super)
    const lower = (c: THREE.AnimationClip, name: string) => {
      const a = mixer.clipAction(splitClip(c, upper, name)[0])
      a.play().setEffectiveWeight(0)
      this.lowerActs.push(a)
      return a
    }
    const cycle = (c: THREE.AnimationClip, name: string): Cycle => {
      const speed = ((c.userData as { speed?: number }).speed ?? 0) * scale
      const fwd = lower(c, name)
      const back = lower(c, name + ':back')
      // Phase is driven by hand.
      fwd.timeScale = back.timeScale = 0
      return { fwd, back, dist: Math.max(0.3, (speed || 1.2 / c.duration) * c.duration), duration: c.duration }
    }
    if (idle) this.idleLo = lower(idle, 'idle')
    if (walk) this.walk = cycle(walk, 'walk')
    if (run) this.run = cycle(run, 'run')
    if (this.idleLo) this.idleLo.setEffectiveWeight(1)
    if (aim) {
      const up = splitClip(aim, upper, 'aim')[1]
      if (up.tracks.length) {
        this.aimUp = mixer.clipAction(up)
        this.aimUp.play()
      }
    }
    const additive = (c: THREE.AnimationClip, name: string) => {
      const up = splitClip(c, upper, name)[1].clone()
      if (!up.tracks.length) return null
      const add = THREE.AnimationUtils.makeClipAdditive(up)
      const a = mixer.clipAction(add)
      a.blendMode = THREE.AdditiveAnimationBlendMode
      a.setLoop(THREE.LoopOnce, 1)
      return a
    }
    if (fire) this.fireUp = additive(fire, 'fire')
    if (fire2) this.fire2Up = additive(fire2, 'fire2')
    if (death) {
      this.deathAct = mixer.clipAction(death)
      this.deathAct.setLoop(THREE.LoopOnce, 1)
      this.deathAct.clampWhenFinished = true
      this.deathAct.timeScale = s.deathSpeed ?? 1
    }
    if (sup && sup !== run && sup !== idle) {
      this.superAct = mixer.clipAction(sup)
      this.superAct.setLoop(THREE.LoopOnce, 1)
    }
    mixer.update(0)
    for (const b of [this.root, this.spine, this.spine1, this.head]) if (b) this.base.set(b, b.quaternion.clone())
  }

  setRelation(r: Relation) {
    this.ringMat.color.set(RELATION_COLORS[r])
  }

  /** A shot left the blaster: additive fire clip on the aim layer plus a procedural kick. */
  fire() {
    this.recoil = 1
    if (!this.alive) return
    const act = (this.fastGun && this.fire2Up) || this.fireUp
    if (act) {
      act.reset().setEffectiveWeight(this.fastGun ? 1.2 : 1.7).play()
      act.timeScale = this.fastGun ? 1.6 : 1.1
    }
  }

  /** Took damage: a short flinch on the spine and head. */
  flinch(dmg: number) {
    if (!this.alive) return
    this.flinchK = Math.min(1, 0.55 + dmg / 400)
    this.flinchYaw = (Math.random() - 0.5) * 0.5
  }

  /** The hero's super went off: the full-body super clip takes over the layers for its duration. */
  superNow() {
    if (!this.superAct || !this.alive) return
    this.superT = 0
    this.superAct.reset().setEffectiveWeight(this.overrideK).play()
  }

  /**
   * Update from a snapshot row. `cloak` 0 = visible, 0..1 = ghosted. `far` fighters animate at 10 Hz.
   */
  update(dt: number, time: number, x: number, z: number, aim: number, vx: number, vz: number, alive: boolean, cloak: number, shieldOn: boolean, superOn: boolean, dashing: boolean, spawnShield: boolean, far = false) {
    this.group.position.x = x
    this.group.position.z = z
    this.group.rotation.y = Math.atan2(Math.cos(aim), Math.sin(aim))
    const speed = Math.hypot(vx, vz)
    if (alive && !this.alive) {
      this.alive = true
      this.deadAt = -1
      this.fallT = -1
      this.spawnT = 0
      this.fade = 1
      this.group.visible = true
      this.body.rotation.set(0, 0, 0)
      this.body.position.set(0, 0, 0)
      this.body.scale.set(1, 1, 1)
      this.twist = 0
      this.backK = 0
      this.backRegime = false
      this.lean = 0
      this.overrideK = 0
      if (this.mixer) {
        this.deathAct?.stop()
        if (this.deathAct) this.deathAct.timeScale = this.spec?.deathSpeed ?? 1
        this.superAct?.stop()
        this.superT = -1
        for (const a of this.lowerActs) {
          a.enabled = true
          a.stopFading()
        }
        if (this.aimUp) {
          this.aimUp.enabled = true
          this.aimUp.stopFading()
          this.aimUp.setEffectiveWeight(1)
        }
      }
    }
    if (!alive && this.alive) {
      this.alive = false
      this.deadAt = time
      this.recoil = 0
      this.flinchK = 0
      this.superT = -1
      this.spawnT = -1
      this.fireUp?.stop()
      this.fire2Up?.stop()
      if (this.deathAct) {
        for (const a of this.lowerActs) a.fadeOut(0.06)
        this.aimUp?.fadeOut(0.06)
        this.superAct?.fadeOut(0.05)
        this.deathAct.reset().setEffectiveWeight(1).play()
      } else this.fallT = 0
    }
    this.acc += dt
    const step = !far || this.acc >= 0.1
    if (!alive) {
      const dead = this.deadAt >= 0 ? time - this.deadAt : 0
      if (dead > 1.7) this.group.visible = false
      if (this.fallT >= 0) {
        // No death clip: topple backwards from the feet and sink a little.
        this.fallT += dt
        const k = Math.min(1, this.fallT / 0.55)
        const e = k * k
        this.body.rotation.x = -e * (Math.PI / 2) * 0.96
        this.body.position.y = Math.min(0.12, this.fallT * 0.2) - Math.max(0, this.fallT - 0.8) * 0.4
      } else if (this.mixer && step) {
        const topple = this.spec?.deathTopple
        if (topple && this.deathAct && dead >= topple[0]) this.deathAct.timeScale = 0
        this.restoreBase()
        this.mixer.update(this.acc)
        this.captureBase()
        if (topple) {
          // The clip staggers back; the whole body then topples about the feet (accelerating) and lies down.
          const k = Math.min(1, Math.max(0, (dead - 0.1) / 0.5))
          this.body.rotation.x = -k * k * topple[1]
        }
        // Sink into the floor once the body has landed.
        const sink = Math.max(0, dead - 1.05)
        this.body.position.y = -sink * 0.9
      }
      if (step) this.acc = 0
      this.ring.visible = this.accent.visible = false
      this.shield.visible = false
      this.setFade(Math.max(0, 1 - Math.max(0, dead - 1.0) / 0.6))
      this.shadowMat.opacity = this.fade * 0.8
      this.placeGun()
      return
    }
    this.ring.visible = this.accent.visible = true
    if (this.mixer) {
      // Supers play through once (hand-blended over the layers), then locomotion fades back.
      if (this.superT >= 0 && this.superAct) {
        this.superT += dt
        const cut = this.spec?.superCut ?? this.superAct.getClip().duration
        if (this.superT >= cut - 0.15 || !this.superAct.isRunning()) this.superT = -1
      }
      const overTarget = this.superT >= 0 ? 1 : 0
      const wasOver = this.overrideK
      this.overrideK += Math.max(-dt / 0.18, Math.min(dt / 0.1, overTarget - this.overrideK))
      if (this.superAct) {
        this.superAct.setEffectiveWeight(this.overrideK)
        if (wasOver > 0 && this.overrideK <= 0) this.superAct.stop()
      }
      this.locomotion(dt, speed, aim, vx, vz, dashing)
      if (step) {
        this.restoreBase()
        this.mixer.update(this.acc)
        this.acc = 0
      }
      this.procedural(dt, step)
    } else {
      this.bob += dt * (speed > 0.4 ? 10 : 2)
      this.body.position.y = Math.abs(Math.sin(this.bob)) * (speed > 0.4 ? 0.08 : 0.02)
      this.recoil = Math.max(0, this.recoil - dt * 7)
      this.flinchK = Math.max(0, this.flinchK - dt * 4)
    }
    // Spawn-in: squash up from the floor.
    if (this.spawnT >= 0) {
      this.spawnT += dt
      const k = Math.min(1, this.spawnT / 0.45)
      const sy = Math.min(1.12, 0.35 + (1 - 0.35) * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.12)
      this.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy))
      if (k >= 1) {
        this.spawnT = -1
        this.body.scale.set(1, 1, 1)
      }
    } else {
      const stretch = dashing ? 1.18 : 1
      this.body.scale.set(1 / Math.sqrt(stretch), 1, stretch)
    }
    this.placeGun()
    const op = cloak > 0 ? cloak : 1
    this.setFade(op)
    for (const m of this.gunMats) m.emissiveIntensity = (m.userData.glowBase as number) + this.recoil * this.recoil * 1.8
    this.ringMat.opacity = (spawnShield ? 0.5 + Math.sin(time * 14) * 0.3 : 0.85) * op
    this.accentMat.opacity = 0.6 * op
    this.shadowMat.opacity = 0.85 * op
    this.ring.scale.setScalar(spawnShield ? 1.6 : superOn ? 1.25 + Math.sin(time * 8) * 0.1 : 1)
    this.shield.visible = shieldOn
    if (shieldOn) {
      this.shieldMat.opacity = 0.18 + Math.sin(time * 9) * 0.06
      this.shield.scale.setScalar(1 + Math.sin(time * 6) * 0.04)
    }
  }

  /** Blend weights and cycle phase of the lower body from the velocity in the aim frame. */
  private locomotion(dt: number, speed: number, aim: number, vx: number, vz: number, dashing: boolean) {
    const moving = speed > 0.25
    // Angle from the aim to the velocity: 0 = forward, positive = towards the fighter's right.
    const ang = moving ? wrapAngle(Math.atan2(vz, vx) - aim) : 0
    const a = Math.abs(ang)
    if (moving && !dashing) {
      if (!this.backRegime && a > BACK_ON) this.backRegime = true
      else if (this.backRegime && a < BACK_OFF) this.backRegime = false
    } else if (dashing) this.backRegime = a > Math.PI / 2
    let targetTwist = 0
    if (moving) {
      const rel = this.backRegime ? wrapAngle(ang + Math.PI) : ang
      const lim = dashing ? Math.PI / 2 : MAX_TWIST
      targetTwist = Math.max(-lim, Math.min(lim, rel))
    }
    // Twist: critically damped follow with a rate cap so a 90° switch takes ~0.15 s.
    const k = 1 - Math.exp(-dt * 16)
    const d = (targetTwist - this.twist) * k
    const cap = dt * 11
    this.twist += Math.max(-cap, Math.min(cap, d))
    const backTarget = this.backRegime ? 1 : 0
    this.backK += Math.max(-dt / 0.18, Math.min(dt / 0.18, backTarget - this.backK))
    // Speed blend: idle → walk → run.
    const idleW = 1 - smoothstep(0.2, 1.1, speed)
    const runK = this.walk && this.run ? smoothstep(this.heroSpeed * 0.4, this.heroSpeed * 0.78, speed) : 1
    const walkW = (1 - idleW) * (1 - runK)
    const runW = (1 - idleW) * runK
    this.idleW = idleW
    const layer = 1 - this.overrideK
    this.idleLo?.setEffectiveWeight(idleW * layer)
    this.aimUp?.setEffectiveWeight(layer)
    const setCycle = (c: Cycle | null, w: number) => {
      if (!c) return
      c.fwd.setEffectiveWeight(w * layer * (1 - this.backK))
      c.back.setEffectiveWeight(w * layer * this.backK)
      c.fwd.time = this.phase * c.duration
      c.back.time = (1 - this.phase) * c.duration
    }
    // Shared phase so walk and run stay in step; the rate matches the ground speed. A dash holds the widest stride.
    const dist = (this.run ? runK * this.run.dist : 0) + (this.walk ? (1 - runK) * this.walk.dist : 0) || 1.5
    if (dashing) {
      const to = this.phase > 0.5 ? 1 : 0
      this.phase += (to - this.phase) * Math.min(1, dt * 12)
      if (this.phase > 0.999) this.phase = 0
    } else if (moving) this.phase = (this.phase + (dt * speed) / dist) % 1
    else this.phase = (this.phase + dt * 0.25) % 1
    setCycle(this.walk, this.walk && this.run ? walkW : walkW + runW)
    setCycle(this.run, runW)
    // Lean into the movement: a run leans ~7°, a dash lunges 24°.
    const leanTarget = dashing ? 0.42 : runW * 0.12 + walkW * 0.04
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-dt * 10))
    if (moving) this.leanDir.set(Math.cos(ang), Math.sin(ang))
  }

  /**
   * The mixer only writes a bone when its blended value changed since the last update, so the edited bones are put
   * back to the mixer's last output before each update and that output is remembered again afterwards.
   */
  private restoreBase() {
    for (const [b, q] of this.base) b.quaternion.copy(q)
  }

  private captureBase() {
    for (const [b, q] of this.base) q.copy(b.quaternion)
  }

  /** Post-mixer bone edits: pelvis twist / spine counter-twist, lean, recoil, flinch. */
  private procedural(dt: number, stepped: boolean) {
    this.recoil = Math.max(0, this.recoil - dt * 7)
    this.flinchK = Math.max(0, this.flinchK - dt * 4.5)
    // Fresh mixer output this frame: remember it; otherwise start again from the remembered output.
    if (stepped) this.captureBase()
    else this.restoreBase()
    const twist = this.twist
    const flinch = this.flinchK * this.flinchK
    this.group.updateMatrixWorld(true)
    if (this.root) {
      const parent = this.root.parent
      parent?.getWorldQuaternion(tmpQ)
      tmpQ.premultiply(tmpQ2.copy(this.group.quaternion).invert())
      // Pelvis yaw towards the velocity, then lean along it.
      if (Math.abs(twist) > 1e-4) preRotate(this.root, tmpQ, new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -twist))
      if (this.lean > 1e-3) {
        // Velocity in the body frame is (-sin a, 0, cos a); lean about up × that.
        const axis = tmpV.set(this.leanDir.x, 0, this.leanDir.y).normalize()
        preRotate(this.root, tmpQ, new THREE.Quaternion().setFromAxisAngle(axis, this.lean))
      }
      this.root.updateMatrixWorld(true)
    }
    // Torso counter-twist (split over two spine bones when available) plus recoil and flinch pitch.
    const spineA = this.spine
    const spineB = this.spine1
    const share = spineB ? 0.5 : 1
    const pitchAll = -0.2 * this.recoil * this.recoil + -0.55 * flinch
    // A hit also knocks the whole body back a few centimetres.
    this.body.position.z = -0.12 * flinch
    const applySpine = (bone: THREE.Object3D | null, yaw: number, pitch: number) => {
      if (!bone) return
      bone.parent?.getWorldQuaternion(tmpQ)
      tmpQ.premultiply(tmpQ2.copy(this.group.quaternion).invert())
      if (Math.abs(yaw) > 1e-4) preRotate(bone, tmpQ, new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw))
      if (Math.abs(pitch) > 1e-4) preRotate(bone, tmpQ, new THREE.Quaternion().setFromAxisAngle(tmpV.set(1, 0, 0), pitch))
      if (bone !== this.head) bone.updateMatrixWorld(true)
    }
    applySpine(spineA, twist * share + this.flinchYaw * flinch * 0.5, pitchAll * share)
    applySpine(spineB, twist * share + this.flinchYaw * flinch * 0.5, pitchAll * share)
    if (this.head) applySpine(this.head, 0, -0.6 * flinch + 0.08 * this.recoil)
  }

  private setFade(op: number) {
    if (op === this.opacity) return
    this.opacity = op
    this.fade = op
    for (const m of this.mats) {
      m.opacity = op
      m.transparent = op < 1 || (m as THREE.MeshStandardMaterial).userData.alwaysTransparent === true
      m.depthWrite = op >= 0.99 || !m.transparent
    }
    for (const m of this.gunMats) {
      m.opacity = op
      m.transparent = op < 1
    }
  }

  /** Blaster follows the right hand, always pointing where the fighter faces, and kicks back on recoil. */
  private placeGun() {
    if (!this.gun) return
    if (this.hand) {
      this.group.updateMatrixWorld(true)
      this.hand.getWorldPosition(tmpV)
      this.group.worldToLocal(tmpV)
      // Hand positions come out in the (possibly dash-stretched / fallen) body frame: keep the gun on the hand.
      this.gun.position.set(tmpV.x + this.gunOffset.x, tmpV.y + this.gunOffset.y, tmpV.z + this.gunOffset.z - this.recoil * this.recoil * 0.28)
      if (this.fallT >= 0) {
        this.gun.position.y = Math.max(0.12, this.gun.position.y * (1 - Math.min(1, this.fallT / 0.55)))
        this.gun.rotation.x = Math.min(1, this.fallT / 0.55) * 1.2
      } else this.gun.rotation.x = -this.recoil * this.recoil * 0.25
    } else {
      this.gun.position.set(0.34, 1.32, 0.62 - this.recoil * 0.12)
    }
  }

  /** World position of the muzzle. */
  get gunTip() {
    if (this.muzzleBone) {
      this.muzzleBone.getWorldPosition(tmpV2)
      tmpV.set(0, 0, 0.7).applyQuaternion(this.group.quaternion)
      return tmpV2.add(tmpV)
    }
    if (this.gun) return tmpV2.copy(this.gun.position).add(tmpV.set(0, 0, this.gunLen * 0.5)).applyMatrix4(this.group.matrixWorld)
    return tmpV2.set(0.34, 1.32, 1.1).applyMatrix4(this.group.matrixWorld)
  }

  /** Debug: current locomotion state. */
  get debug() {
    return { phase: this.phase, twist: this.twist, backK: this.backK, idleW: this.idleW, lean: this.lean, runDist: this.run?.dist, walkDist: this.walk?.dist }
  }

  dispose() {
    this.mixer?.stopAllAction()
    if (this.mixer) this.mixer.uncacheRoot(this.body)
    for (const m of this.mats) m.dispose()
    for (const m of this.gunMats) m.dispose()
    this.ring.geometry.dispose()
    this.ringMat.dispose()
    this.accent.geometry.dispose()
    this.accentMat.dispose()
    this.shadow.geometry.dispose()
    this.shadowMat.dispose()
    this.shield.geometry.dispose()
    this.shieldMat.dispose()
    this.aura.geometry.dispose()
    this.auraMat.dispose()
    this.heat.geometry.dispose()
    this.heatMat.dispose()
  }
}

/** Split a clip into [lower body, upper body] halves by bone name. Root / hips tracks stay with the legs. */
function splitClip(clip: THREE.AnimationClip, upper: RegExp, name: string): [THREE.AnimationClip, THREE.AnimationClip] {
  const lower: THREE.KeyframeTrack[] = []
  const up: THREE.KeyframeTrack[] = []
  for (const t of clip.tracks) (upper.test(t.name.split('.')[0]) ? up : lower).push(t)
  return [new THREE.AnimationClip(name + ':lower', clip.duration, lower), new THREE.AnimationClip(name + ':upper', clip.duration, up)]
}

/** Stand-in when a character file is missing: a capsule body, a head and a visor. */
function proceduralBody(color: string) {
  const g = new THREE.Group()
  const mat = new THREE.MeshLambertMaterial({ color })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.6, 4, 10), mat)
  body.position.y = 0.75
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), new THREE.MeshLambertMaterial({ color: '#e8d2b8' }))
  head.position.y = 1.45
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#22d3ee' }))
  visor.position.set(0, 1.5, 0.2)
  g.add(body, head, visor)
  return g
}
