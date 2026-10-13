// A fighter on screen: the hero's skinned character (or a procedural stand-in), its blaster in the right hand,
// team ring, shield bubble and cloak fade. One AnimationMixer per fighter blends idle / run (speed-scaled) with
// one-shot fire, super and death clips; models without a fire or death clip get a procedural recoil and fall.
import * as THREE from 'three'
import { MANIFEST, findClip, instance, type CharSpec, type SiegeAssets } from '../engine/assets'
import { HEROES, type HeroId } from '../engine/heroes'
import { SKINS } from '../engine/progress'

export type Relation = 'me' | 'ally' | 'enemy'

export const RELATION_COLORS: Record<Relation, string> = { me: '#ffffff', ally: '#22d3ee', enemy: '#fb7185' }

/** Bones the fire clip is allowed to drive while the legs keep running. */
const UPPER_BODY = /spine|torso|chest|shoulder|clavicle|arm|hand|gun|weapon|head|neck|aim|clip/i

const WHITE = new THREE.Color('#ffffff')
const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpV2 = new THREE.Vector3()

export class FighterActor {
  readonly group = new THREE.Group()
  readonly body: THREE.Object3D
  private spec: CharSpec | null
  private mixer: THREE.AnimationMixer | null = null
  private idle: THREE.AnimationAction | null = null
  private run: THREE.AnimationAction | null = null
  /** Upper-body halves of idle / run when the model has a fire clip (the fire pose replaces them). */
  private idleUpper: THREE.AnimationAction | null = null
  private runUpper: THREE.AnimationAction | null = null
  private fireAct: THREE.AnimationAction | null = null
  private deathAct: THREE.AnimationAction | null = null
  private superAct: THREE.AnimationAction | null = null
  private running = false
  private hand: THREE.Object3D | null = null
  private spine: THREE.Object3D | null = null
  private muzzleBone: THREE.Object3D | null = null
  private ring: THREE.Mesh
  private ringMat: THREE.MeshBasicMaterial
  private accent: THREE.Mesh
  private accentMat: THREE.MeshBasicMaterial
  private shield: THREE.Mesh
  private shieldMat: THREE.MeshBasicMaterial
  private mats: THREE.Material[] = []
  private gun: THREE.Object3D | null = null
  private gunLen = 0.9
  private gunOffset = new THREE.Vector3(0.05, -0.05, 0.2)
  private gunMats: THREE.MeshLambertMaterial[] = []
  private deadAt = -1
  private fallT = -1
  private recoil = 0
  private fireHold = 0
  private superT = -1
  private acc = 0
  private bob = Math.random() * 10
  private opacity = 1
  alive = true
  readonly heroId: HeroId
  readonly skin: string

  constructor(assets: SiegeAssets, heroId: HeroId, skin: string, relation: Relation) {
    this.heroId = heroId
    this.skin = skin
    const hero = HEROES[heroId]
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
        if (s.ownGun && !this.muzzleBone && s.ownGun.test(o.name)) this.muzzleBone = o
      })
      if (s.gunOffset) this.gunOffset.fromArray(s.gunOffset)
    }
    if (clips && this.spec) {
      const s = this.spec
      const mixer = (this.mixer = new THREE.AnimationMixer(body))
      const idle = findClip(clips, s.clips.idle)
      const run = findClip(clips, s.clips.run)
      const fire = findClip(clips, s.clips.fire)
      const death = findClip(clips, s.clips.death)
      const sup = findClip(clips, s.clips.super)
      if (fire && idle && run) {
        // Split locomotion so the fire clip can own the upper body while the legs keep going.
        const [idleLo, idleUp] = splitClip(idle)
        const [runLo, runUp] = splitClip(run)
        this.idle = mixer.clipAction(idleLo)
        this.run = mixer.clipAction(runLo)
        this.idleUpper = mixer.clipAction(idleUp)
        this.runUpper = mixer.clipAction(runUp)
        const [, fireUp] = splitClip(fire)
        this.fireAct = mixer.clipAction(fireUp)
        this.fireAct.setLoop(THREE.LoopOnce, 1)
        this.fireAct.clampWhenFinished = true
        this.idleUpper.play()
        this.runUpper.play().setEffectiveWeight(0)
      } else {
        if (idle) this.idle = mixer.clipAction(idle)
        if (run) this.run = mixer.clipAction(run)
      }
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
      this.idle?.play()
      this.run?.play().setEffectiveWeight(0)
      mixer.update(0)
    }
    // Blaster in the right hand (unless the model carries its own weapon).
    if (!this.muzzleBone) {
      const gun = instance(assets, hero.gun)
      if (gun) {
        gun.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.isMesh) return
          const mat = (m.material as THREE.MeshLambertMaterial).clone()
          mat.emissive = new THREE.Color(palette.glow)
          mat.emissiveIntensity = 0.1
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
    // Shield bubble.
    this.shieldMat = new THREE.MeshBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.22, depthWrite: false })
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), this.shieldMat)
    this.shield.position.y = 1.05
    this.shield.visible = false
    this.group.add(this.shield)
  }

  setRelation(r: Relation) {
    this.ringMat.color.set(RELATION_COLORS[r])
  }

  /** A shot left the blaster: play the fire pose or kick the upper body back. */
  fire() {
    this.recoil = 1
    this.fireHold = 0.22
    if (this.fireAct && this.alive) {
      this.fireAct.reset().setEffectiveWeight(1).play()
    }
  }

  /** The hero's super went off. */
  superNow() {
    if (!this.superAct || !this.alive) return
    this.superT = 0
    this.superAct.reset().setEffectiveWeight(1).fadeIn(0.08).play()
    this.idle?.fadeOut(0.1)
    this.run?.fadeOut(0.1)
  }

  private setLoco(running: boolean) {
    if (running === this.running) return
    this.running = running
    const from = running ? this.idle : this.run
    const to = running ? this.run : this.idle
    if (to) to.enabled = true
    if (from && to) {
      to.setEffectiveWeight(1)
      from.setEffectiveWeight(1)
      to.reset().play()
      from.crossFadeTo(to, 0.18, false)
    }
    const fromU = running ? this.idleUpper : this.runUpper
    const toU = running ? this.runUpper : this.idleUpper
    if (fromU && toU) {
      toU.setEffectiveWeight(1).reset().play()
      fromU.setEffectiveWeight(1)
      fromU.crossFadeTo(toU, 0.18, false)
    }
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
      this.group.visible = true
      this.body.rotation.set(0, 0, 0)
      this.body.position.set(0, 0, 0)
      this.body.scale.set(1, 1, 1)
      if (this.mixer) {
        this.deathAct?.stop()
        this.superAct?.stop()
        this.running = true
        this.setLoco(false)
      }
    }
    if (!alive && this.alive) {
      this.alive = false
      this.deadAt = time
      this.recoil = 0
      this.superT = -1
      this.fireAct?.stop()
      if (this.deathAct) {
        this.idle?.fadeOut(0.05)
        this.run?.fadeOut(0.05)
        this.idleUpper?.fadeOut(0.05)
        this.runUpper?.fadeOut(0.05)
        this.superAct?.fadeOut(0.05)
        this.deathAct.reset().setEffectiveWeight(1).play()
      } else this.fallT = 0
    }
    this.acc += dt
    const step = !far || this.acc >= 0.1
    if (!alive) {
      if (this.deadAt >= 0 && time - this.deadAt > 1.7) this.group.visible = false
      if (this.fallT >= 0) {
        // No death clip: topple backwards from the feet and sink a little.
        this.fallT += dt
        const k = Math.min(1, this.fallT / 0.55)
        const e = k * k
        this.body.rotation.x = -e * (Math.PI / 2) * 0.96
        this.body.position.y = Math.min(0.12, this.fallT * 0.2) - Math.max(0, this.fallT - 0.8) * 0.4
      } else if (this.mixer && step) {
        this.mixer.update(this.acc)
      }
      if (step) this.acc = 0
      this.ring.visible = this.accent.visible = false
      this.shield.visible = false
      this.placeGun()
      return
    }
    this.ring.visible = this.accent.visible = true
    if (this.mixer) {
      this.setLoco(speed > 0.5)
      if (this.run && this.running) this.run.timeScale = 0.75 + Math.min(1.5, speed / 5.5)
      if (this.runUpper && this.run) this.runUpper.timeScale = this.run.timeScale
      // Supers play through once, then locomotion fades back.
      if (this.superT >= 0 && this.superAct) {
        this.superT += dt
        const cut = this.spec?.superCut ?? this.superAct.getClip().duration
        if (this.superT >= cut - 0.15 || !this.superAct.isRunning()) {
          this.superAct.fadeOut(0.15)
          ;(this.running ? this.run : this.idle)?.reset().setEffectiveWeight(1).fadeIn(0.15).play()
          this.superT = -1
        }
      }
      // Fire pose hands the upper body back once it has played.
      if (this.fireAct) {
        const upper = this.running ? this.runUpper : this.idleUpper
        if (this.fireAct.isRunning() && this.fireAct.time < this.fireAct.getClip().duration - 0.05) upper?.setEffectiveWeight(0.15)
        else {
          this.fireAct.setEffectiveWeight(0)
          upper?.setEffectiveWeight(1)
        }
      }
      if (step) {
        this.mixer.update(this.acc)
        this.acc = 0
      }
    } else {
      this.bob += dt * (speed > 0.4 ? 10 : 2)
      this.body.position.y = Math.abs(Math.sin(this.bob)) * (speed > 0.4 ? 0.08 : 0.02)
    }
    // Procedural recoil: the upper body pitches back a touch after each shot.
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 7)
      this.fireHold = Math.max(0, this.fireHold - dt)
      if (this.spine && !this.fireAct) {
        this.spine.getWorldQuaternion(tmpQ)
        tmpV.set(1, 0, 0).applyQuaternion(this.group.quaternion).applyQuaternion(tmpQ.invert())
        this.spine.rotateOnAxis(tmpV, -0.16 * this.recoil * this.recoil)
      }
    }
    this.placeGun()
    const op = cloak > 0 ? cloak : 1
    if (op !== this.opacity) {
      this.opacity = op
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
    this.ringMat.opacity = (spawnShield ? 0.5 + Math.sin(time * 14) * 0.3 : 0.85) * op
    this.accentMat.opacity = 0.6 * op
    this.ring.scale.setScalar(spawnShield ? 1.6 : superOn ? 1.25 + Math.sin(time * 8) * 0.1 : 1)
    this.shield.visible = shieldOn
    if (shieldOn) {
      this.shieldMat.opacity = 0.18 + Math.sin(time * 9) * 0.06
      this.shield.scale.setScalar(1 + Math.sin(time * 6) * 0.04)
    }
    const stretch = dashing ? 1.22 : 1
    this.body.scale.set(1 / Math.sqrt(stretch), 1, stretch)
  }

  /** Blaster follows the right hand, always pointing where the fighter faces, and kicks back on recoil. */
  private placeGun() {
    if (!this.gun) return
    if (this.hand) {
      this.group.updateMatrixWorld(true)
      this.hand.getWorldPosition(tmpV)
      this.group.worldToLocal(tmpV)
      // Hand positions come out in the (possibly dash-stretched / fallen) body frame: keep the gun on the hand.
      this.gun.position.set(tmpV.x + this.gunOffset.x, tmpV.y + this.gunOffset.y, tmpV.z + this.gunOffset.z - this.recoil * 0.12)
      if (this.fallT >= 0) {
        this.gun.position.y = Math.max(0.12, this.gun.position.y * (1 - Math.min(1, this.fallT / 0.55)))
        this.gun.rotation.x = Math.min(1, this.fallT / 0.55) * 1.2
      } else this.gun.rotation.x = 0
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

  dispose() {
    this.mixer?.stopAllAction()
    if (this.mixer) this.mixer.uncacheRoot(this.body)
    for (const m of this.mats) m.dispose()
    for (const m of this.gunMats) m.dispose()
    this.ring.geometry.dispose()
    this.ringMat.dispose()
    this.accent.geometry.dispose()
    this.accentMat.dispose()
    this.shield.geometry.dispose()
    this.shieldMat.dispose()
  }
}

/** Split a clip into [lower body, upper body] halves by bone name. Root / hips tracks stay with the legs. */
function splitClip(clip: THREE.AnimationClip): [THREE.AnimationClip, THREE.AnimationClip] {
  const lower: THREE.KeyframeTrack[] = []
  const upper: THREE.KeyframeTrack[] = []
  for (const t of clip.tracks) (UPPER_BODY.test(t.name.split('.')[0]) ? upper : lower).push(t)
  return [new THREE.AnimationClip(clip.name + ':lower', clip.duration, lower), new THREE.AnimationClip(clip.name + ':upper', clip.duration, upper)]
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
