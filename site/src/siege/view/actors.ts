// A fighter on screen: the hero's blocky character (or a procedural stand-in), its blaster, team ring, shield
// bubble and cloak fade, driven by the node animation clips in the pack.
import * as THREE from 'three'
import { instance, type SiegeAssets } from '../engine/assets'
import { HEROES, type HeroId } from '../engine/heroes'
import { SKINS } from '../engine/progress'

export type Relation = 'me' | 'ally' | 'enemy'

export const RELATION_COLORS: Record<Relation, string> = { me: '#ffffff', ally: '#22d3ee', enemy: '#fb7185' }

export class FighterActor {
  readonly group = new THREE.Group()
  readonly body: THREE.Object3D
  private mixer: THREE.AnimationMixer | null = null
  private actions: Record<string, THREE.AnimationAction> = {}
  private current = ''
  private armRight: THREE.Object3D | null = null
  private ring: THREE.Mesh
  private ringMat: THREE.MeshBasicMaterial
  private shield: THREE.Mesh
  private shieldMat: THREE.MeshBasicMaterial
  private mats: THREE.MeshLambertMaterial[] = []
  private gun: THREE.Object3D | null = null
  private gunMats: THREE.MeshLambertMaterial[] = []
  private deadAt = -1
  private bob = Math.random() * 10
  alive = true
  readonly heroId: HeroId
  readonly skin: string

  constructor(assets: SiegeAssets, heroId: HeroId, skin: string, relation: Relation) {
    this.heroId = heroId
    this.skin = skin
    const hero = HEROES[heroId]
    const palette = SKINS[skin] ?? SKINS.default
    const tint = new THREE.Color(palette.tint)
    let body = instance(assets, hero.model)
    const clips = assets.clips.get(hero.model)
    if (!body) {
      body = proceduralBody(hero.colors[0])
    }
    this.body = body
    this.group.add(body)
    body.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = (m.material as THREE.MeshLambertMaterial).clone()
      mat.color.copy(tint)
      mat.transparent = true
      m.material = mat
      this.mats.push(mat)
      m.castShadow = true
    })
    this.armRight = body.getObjectByName('arm-right') ?? null
    if (clips) {
      this.mixer = new THREE.AnimationMixer(body)
      for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c)
      this.play('idle')
    }
    // Blaster held in front at hip height.
    const gun = instance(assets, hero.gun)
    if (gun) {
      gun.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const mat = (m.material as THREE.MeshLambertMaterial).clone()
        mat.emissive = new THREE.Color(palette.glow)
        mat.emissiveIntensity = 0.1
        mat.transparent = true
        m.material = mat
        this.gunMats.push(mat)
      })
      gun.position.set(0.34, 1.32, 0.62)
      gun.rotation.y = Math.PI
      this.group.add(gun)
      this.gun = gun
    }
    // Team ring.
    const ringGeo = new THREE.RingGeometry(0.5, 0.64, 32)
    this.ringMat = new THREE.MeshBasicMaterial({ color: RELATION_COLORS[relation], transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
    this.ring = new THREE.Mesh(ringGeo, this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.03
    this.group.add(this.ring)
    // Shield bubble.
    const shGeo = new THREE.SphereGeometry(1.05, 20, 14)
    this.shieldMat = new THREE.MeshBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.22, depthWrite: false, wireframe: false })
    this.shield = new THREE.Mesh(shGeo, this.shieldMat)
    this.shield.position.y = 0.95
    this.shield.visible = false
    this.group.add(this.shield)
  }

  setRelation(r: Relation) {
    this.ringMat.color.set(RELATION_COLORS[r])
  }

  private play(name: string, fade = 0.15) {
    if (this.current === name) return
    const next = this.actions[name]
    if (!next) return
    const prev = this.actions[this.current]
    next.reset()
    next.enabled = true
    if (name === 'die') {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    }
    next.play()
    if (prev) prev.crossFadeTo(next, fade, false)
    this.current = name
  }

  /**
   * Update from a snapshot row. `visible` handles cloak: 0 hidden, 0..1 ghosted. `shieldHp` > 0 shows the bubble.
   */
  update(dt: number, time: number, x: number, z: number, aim: number, vx: number, vz: number, alive: boolean, cloak: number, shieldOn: boolean, superOn: boolean, dashing: boolean, spawnShield: boolean) {
    this.group.position.x = x
    this.group.position.z = z
    this.group.rotation.y = Math.atan2(Math.cos(aim), Math.sin(aim))
    const speed = Math.hypot(vx, vz)
    if (alive && !this.alive) {
      this.alive = true
      this.deadAt = -1
      this.group.visible = true
      this.play('idle', 0)
    }
    if (!alive && this.alive) {
      this.alive = false
      this.deadAt = time
      this.play('die', 0.05)
    }
    if (!alive) {
      if (this.deadAt >= 0 && time - this.deadAt > 1.6) this.group.visible = false
      this.mixer?.update(dt)
      this.ring.visible = false
      this.shield.visible = false
      return
    }
    this.ring.visible = true
    if (this.mixer) {
      this.play(speed > 0.4 ? 'sprint' : 'idle')
      const a = this.actions[this.current]
      if (a && this.current === 'sprint') a.timeScale = 0.9 + Math.min(1.6, speed / 5)
      this.mixer.update(dt)
      // Hold the blaster out in front.
      if (this.armRight) this.armRight.rotation.set(-Math.PI / 2, 0, 0)
    } else {
      this.bob += dt * (speed > 0.4 ? 10 : 2)
      this.body.position.y = Math.abs(Math.sin(this.bob)) * (speed > 0.4 ? 0.08 : 0.02)
    }
    const op = cloak > 0 ? cloak : 1
    for (const m of this.mats) m.opacity = op
    for (const m of this.gunMats) m.opacity = op
    this.ringMat.opacity = (spawnShield ? 0.5 + Math.sin(time * 14) * 0.3 : 0.85) * op
    this.ring.scale.setScalar(spawnShield ? 1.6 : superOn ? 1.25 + Math.sin(time * 8) * 0.1 : 1)
    this.shield.visible = shieldOn
    if (shieldOn) {
      this.shieldMat.opacity = 0.18 + Math.sin(time * 9) * 0.06
      this.shield.scale.setScalar(1 + Math.sin(time * 6) * 0.04)
    }
    const stretch = dashing ? 1.25 : 1
    this.body.scale.set(1 / Math.sqrt(stretch), 1, stretch)
  }

  get gunTip() {
    return new THREE.Vector3(0.34, 1.32, 1.1).applyMatrix4(this.group.matrixWorld)
  }

  dispose() {
    this.mixer?.stopAllAction()
    for (const m of this.mats) m.dispose()
    for (const m of this.gunMats) m.dispose()
    this.ring.geometry.dispose()
    this.ringMat.dispose()
    this.shield.geometry.dispose()
    this.shieldMat.dispose()
    void this.gun
  }
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
