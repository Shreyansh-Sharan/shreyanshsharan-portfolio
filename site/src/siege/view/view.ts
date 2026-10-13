// The three.js side: renderer, a top-down follow camera with aim look-ahead and shake, the map, fighter actors,
// instanced projectiles, deployables (sentries, mines, heal zones, Riot Walls, decoys, toxin clouds), loot,
// power-up pads, effects, optional bloom, and a 2D overlay for name tags, health bars, status icons, floating
// damage numbers, counter popups and the minimap. It draws snapshots, so the host view and online clients share
// this code.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { instance, type SiegeAssets } from '../engine/assets'
import { HEROES, type HeroId } from '../engine/heroes'
import { CELL, type MapDef } from '../engine/maps'
import { COUNTER_RULES, POWER, POWERUPS, POWERUP_KINDS, STATUS_INFO, STATUS_KINDS, type PowerUpKind, type StatusKind } from '../engine/powers'
import type { Quality } from '../engine/quality'
import { DEPLOY_KINDS, LOOT_KINDS, PROJ_KINDS, SNAP_F, SNAP_FLAGS, type LootKind, type SimEvent, type Snap } from '../engine/sim'
import { FighterActor, type Relation } from './actors'
import { Fx } from './fx'
import { buildMap, type BuiltMap } from './map'

export interface FighterMeta {
  name: string
  hero: HeroId
  skin: string
  team: number
  human: boolean
}

export const LOOT_INFO: Record<LootKind, { name: string; color: string }> = {
  medkit: { name: 'Medkit', color: '#4ade80' },
  plating: { name: 'Plating +300', color: '#9ca3af' },
  overclock: { name: 'Overclock +15%', color: '#fb923c' },
  servo: { name: 'Servo +10%', color: '#22d3ee' },
  cell: { name: 'Super cell', color: '#f0abfc' },
  shard: { name: '+10 coins', color: '#fde047' },
}

/** Status kinds drawn as chips over the health bar (the most useful few). */
const CHIP_KINDS: StatusKind[] = ['mark', 'revealed', 'scorch', 'toxin', 'slow', 'purged', 'hyper', 'haste', 'amp', 'ricochet', 'magnet', 'revive']

const PROJ_STYLE: Record<string, { sx: number; sy: number; color: string }> = {
  bullet: { sx: 0.6, sy: 0.08, color: '#f0abfc' },
  pellet: { sx: 0.32, sy: 0.07, color: '#fde68a' },
  rail: { sx: 2.4, sy: 0.07, color: '#22d3ee' },
  needle: { sx: 0.55, sy: 0.05, color: '#fbcfe8' },
  turret: { sx: 0.5, sy: 0.08, color: '#facc15' },
  dart: { sx: 1.3, sy: 0.1, color: '#67e8f9' },
}

interface DeployView {
  obj: THREE.Object3D
  kind: string
  team: number
  turretHead?: THREE.Object3D
  lamp?: THREE.Mesh
  hover?: boolean
  /** Decoys are full fighter actors wearing their owner's hero. */
  actor?: FighterActor
  owner?: number
  mats?: THREE.MeshBasicMaterial[]
}

interface PadView {
  group: THREE.Group
  ring: THREE.MeshBasicMaterial
  icon: THREE.Object3D | null
  kind: number
}

export class SiegeView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly fx: Fx
  readonly overlay: HTMLCanvasElement
  private octx: CanvasRenderingContext2D
  private composer: { render(dt: number): void; setSize(w: number, h: number): void; dispose(): void } | null = null
  private map: BuiltMap | null = null
  private mapDef: MapDef | null = null
  private sun: THREE.DirectionalLight
  private actors = new Map<number, FighterActor>()
  private deploys = new Map<number, DeployView>()
  private pickups = new Map<number, THREE.Object3D>()
  private pads = new Map<number, PadView>()
  private toxins: THREE.InstancedMesh
  readonly minimap: HTMLCanvasElement
  private mctx: CanvasRenderingContext2D
  private mapLayer: HTMLCanvasElement | null = null
  private minimapAt = 0
  private projMeshes: Record<string, THREE.InstancedMesh> = {}
  private grenades: THREE.InstancedMesh
  private focus = new THREE.Vector3()
  private look = new THREE.Vector3()
  private time = 0
  private meId = 0
  private meTeam = -1
  private br = false
  private disposables: { dispose(): void }[] = []
  private lastSnap: Snap | null = null
  private container: HTMLElement
  private quality: Quality
  private assets: SiegeAssets
  private meta = new Map<number, FighterMeta>()
  /** Aim lookahead in metres (set by the game from the aim direction). */
  aimDx = 0
  aimDz = 0
  /** Camera distance multiplier (royale maps sit a little higher). */
  zoom = 1
  /** Cinematic override for key art and close-ups: look at a point from a yaw/pitch/distance. */
  cine: { x: number; z: number; yaw: number; pitch: number; dist: number; height: number } | null = null
  shakeOn = true

  constructor(container: HTMLElement, assets: SiegeAssets, quality: Quality, opts: { preserve?: boolean } = {}) {
    this.container = container
    this.assets = assets
    this.quality = quality
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias && !quality.bloom, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr))
    this.renderer.shadowMap.enabled = quality.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.className = 'siege-canvas'
    container.appendChild(this.renderer.domElement)
    this.overlay = document.createElement('canvas')
    this.overlay.className = 'siege-overlay'
    container.appendChild(this.overlay)
    this.octx = this.overlay.getContext('2d')!
    this.scene.background = new THREE.Color('#07051a')
    this.scene.fog = new THREE.Fog('#07051a', 60, 110)
    // A neutral room reflection so the characters' metal and glass read (the arena has no reflections of its own).
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.45
    pmrem.dispose()
    this.disposables.push(this.scene.environment)
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 160)
    const hemi = new THREE.HemisphereLight('#8f7fe8', '#1a1030', 1.4)
    this.scene.add(hemi)
    this.sun = new THREE.DirectionalLight('#e6e0ff', 2.2)
    this.sun.position.set(14, 30, 10)
    this.sun.castShadow = quality.shadows
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -34
    sc.right = sc.top = 34
    sc.near = 1
    sc.far = 90
    this.sun.shadow.bias = -0.0008
    this.scene.add(this.sun, this.sun.target)
    this.fx = new Fx(quality.level)
    this.scene.add(this.fx.group)
    // Instanced projectiles per kind.
    const box = new THREE.BoxGeometry(1, 1, 1)
    this.disposables.push(box)
    for (const k of Object.keys(PROJ_STYLE)) {
      const mat = new THREE.MeshBasicMaterial({ color: PROJ_STYLE[k].color })
      const m = new THREE.InstancedMesh(box, mat, 400)
      m.count = 0
      m.frustumCulled = false
      this.scene.add(m)
      this.projMeshes[k] = m
      this.disposables.push(mat)
    }
    const gProto = assets.models.get('grenade')
    let gGeo: THREE.BufferGeometry | null = null
    let gMat: THREE.Material | null = null
    gProto?.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !gGeo) {
        // Quantised positions are widened to floats before the transform is baked in (Int16 would clamp to ±1).
        gGeo = m.geometry.clone()
        const pos = gGeo.attributes.position
        const out = new Float32Array(pos.count * 3)
        for (let i = 0; i < pos.count; i++) {
          out[i * 3] = pos.getX(i)
          out[i * 3 + 1] = pos.getY(i)
          out[i * 3 + 2] = pos.getZ(i)
        }
        gGeo.setAttribute('position', new THREE.BufferAttribute(out, 3))
        gGeo.applyMatrix4(m.matrixWorld)
        gMat = m.material as THREE.Material
      }
    })
    this.grenades = new THREE.InstancedMesh(gGeo ?? new THREE.SphereGeometry(0.2, 10, 8), gMat ?? new THREE.MeshLambertMaterial({ color: '#4d7c0f' }), 80)
    this.grenades.count = 0
    this.grenades.frustumCulled = false
    this.scene.add(this.grenades)
    // Toxin Shell canisters: a lime cylinder with a dark band.
    const canGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.42, 10)
    const canMat = new THREE.MeshStandardMaterial({ color: '#84cc16', emissive: new THREE.Color('#a3e635'), emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.3 })
    this.toxins = new THREE.InstancedMesh(canGeo, canMat, 40)
    this.toxins.count = 0
    this.toxins.frustumCulled = false
    this.scene.add(this.toxins)
    this.disposables.push(canGeo, canMat)
    this.minimap = document.createElement('canvas')
    this.minimap.className = 'sg-minimap'
    container.appendChild(this.minimap)
    this.mctx = this.minimap.getContext('2d')!
    this.resize()
    if (quality.bloom) void this.setupPost()
  }

  private async setupPost() {
    const P = await import('postprocessing')
    const composer = new P.EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 })
    composer.addPass(new P.RenderPass(this.scene, this.camera))
    const bloom = new P.BloomEffect({ intensity: 1.1, luminanceThreshold: 0.55, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.7 })
    composer.addPass(new P.EffectPass(this.camera, bloom, new P.VignetteEffect({ darkness: 0.45, offset: 0.25 })))
    this.composer = composer
    this.resize()
  }

  resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.overlay.width = Math.round(w * dpr)
    this.overlay.height = Math.round(h * dpr)
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // The minimap's CSS box decides its size; keep the backing store sharp.
    const mw = this.minimap.clientWidth || 150
    const mh = this.minimap.clientHeight || 110
    this.minimap.width = Math.round(mw * dpr)
    this.minimap.height = Math.round(mh * dpr)
  }

  /* ---------- Setup ---------- */

  setMap(map: MapDef, chars: string[], seed: number) {
    this.map?.dispose()
    if (this.map) this.scene.remove(this.map.group)
    this.map = buildMap(map, chars, this.assets, seed, this.quality.level)
    this.mapDef = map
    this.scene.add(this.map.group)
    this.br = map.br
    this.zoom = map.br ? 1.12 : 1
    this.focus.set((map.w * CELL) / 2, 0, (map.h * CELL) / 2)
    this.look.copy(this.focus)
    this.placeCamera(true)
    for (const p of this.pads.values()) this.scene.remove(p.group)
    this.pads.clear()
    this.mapLayer = minimapLayer(map, chars)
    this.minimap.style.aspectRatio = `${map.w} / ${map.h}`
    this.resize()
  }

  setRoster(meta: Map<number, FighterMeta>, meId: number, meTeam: number) {
    this.meta = meta
    this.meId = meId
    this.meTeam = meTeam
    for (const [id, a] of this.actors) a.setRelation(this.relation(id))
  }

  relation(id: number): Relation {
    const m = this.meta.get(id)
    if (id === this.meId) return 'me'
    if (!m) return 'enemy'
    return !this.br && m.team === this.meTeam ? 'ally' : 'enemy'
  }

  private actor(id: number) {
    let a = this.actors.get(id)
    if (a) return a
    const m = this.meta.get(id)
    a = new FighterActor(this.assets, m?.hero ?? 'rook', m?.skin ?? 'default', this.relation(id))
    this.actors.set(id, a)
    this.scene.add(a.group)
    return a
  }

  /* ---------- Frame ---------- */

  render(snap: Snap, events: SimEvent[], dt: number) {
    this.time += dt
    this.lastSnap = snap
    const t = this.time
    this.map?.animate(t)
    // Fighters.
    const seen = new Set<number>()
    for (const row of snap.f) {
      const [id, x, z, aim, , , flags, , vx, vz] = row
      seen.add(id)
      const a = this.actor(id)
      const alive = !!(flags & SNAP_FLAGS.alive)
      const cloaked = !!(flags & SNAP_FLAGS.cloak)
      const rel = this.relation(id)
      const cloak = cloaked ? (rel === 'enemy' ? 0.06 : 0.35) : 0
      const far = Math.hypot(x - this.focus.x, z - this.focus.z) > 26 * this.zoom
      a.update(dt, t, x, z, aim, vx, vz, alive, cloak, !!(flags & SNAP_FLAGS.shield), !!(flags & SNAP_FLAGS.superOn), !!(flags & SNAP_FLAGS.dash), !!(flags & SNAP_FLAGS.spawnShield), far)
      const mask = row[SNAP_F.status] ?? 0
      const channel = !!(flags & SNAP_FLAGS.channel)
      const auraColor = a.status(cloaked && rel === 'enemy' ? 0 : mask, channel, t)
      // Particles for the loud statuses: heat shimmer while venting, embers when scorched, bubbles when poisoned.
      if (alive && !far && !(cloaked && rel === 'enemy')) {
        const k = Math.min(1, dt * 30)
        if (channel) for (let i = 0; i < 3; i++) this.fx.puff(x + (Math.random() - 0.5) * 1.6, 0.3, z + (Math.random() - 0.5) * 1.6, Math.random() < 0.5 ? '#ff7a1a' : '#fde68a', 0.7, 0.4, 3)
        if (mask & (1 << STATUS_KINDS.indexOf('scorch')) && Math.random() < k * 0.6) this.fx.puff(x + (Math.random() - 0.5) * 0.8, 0.8 + Math.random(), z + (Math.random() - 0.5) * 0.8, '#fb923c', 0.4, 0.6, 1.5)
        if (mask & (1 << STATUS_KINDS.indexOf('toxin')) && Math.random() < k * 0.6) this.fx.puff(x + (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 1.2, z + (Math.random() - 0.5) * 0.8, '#a3e635', 0.45, 0.7, 0.8)
        else if (auraColor && Math.random() < k * 0.15) this.fx.puff(x + (Math.random() - 0.5) * 1.2, 0.2, z + (Math.random() - 0.5) * 1.2, auraColor, 0.35, 0.6, 1)
      }
    }
    for (const [id, a] of this.actors)
      if (!seen.has(id)) {
        this.scene.remove(a.group)
        a.dispose()
        this.actors.delete(id)
      }
    // Projectiles.
    const counts: Record<string, number> = {}
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    let gCount = 0
    let tCount = 0
    for (const row of snap.p) {
      const kind = PROJ_KINDS[row[1]]
      const x = row[2]
      const z = row[3]
      const y = row[4]
      const vx = row[5]
      const vz = row[6]
      if (kind === 'flame') {
        this.fx.flame(x, y, z, vx, vz)
        continue
      }
      if (kind === 'toxin') {
        if (tCount >= 40) continue
        q.setFromEuler(new THREE.Euler(t * 7, 0, t * 5))
        m4.compose(p.set(x, Math.max(0.2, y), z), q, s.set(1, 1, 1))
        this.toxins.setMatrixAt(tCount++, m4)
        if (Math.random() < 0.5) this.fx.puff(x, Math.max(0.2, y), z, '#bef264', 0.35, 0.4, 0)
        continue
      }
      if (kind === 'grenade') {
        if (gCount >= 80) continue
        q.setFromEuler(new THREE.Euler(t * 6, t * 4, 0))
        m4.compose(p.set(x, Math.max(0.2, y), z), q, s.set(1, 1, 1))
        this.grenades.setMatrixAt(gCount++, m4)
        continue
      }
      const st = PROJ_STYLE[kind]
      const mesh = this.projMeshes[kind]
      if (!st || !mesh) continue
      const i = counts[kind] ?? 0
      if (i >= 400) continue
      counts[kind] = i + 1
      const yaw = Math.atan2(-vz, vx)
      q.setFromEuler(new THREE.Euler(0, yaw, 0))
      m4.compose(p.set(x, y, z), q, s.set(st.sx, st.sy, st.sy))
      mesh.setMatrixAt(i, m4)
    }
    for (const k of Object.keys(this.projMeshes)) {
      const mesh = this.projMeshes[k]
      mesh.count = counts[k] ?? 0
      mesh.instanceMatrix.needsUpdate = true
    }
    this.grenades.count = gCount
    this.grenades.instanceMatrix.needsUpdate = true
    this.toxins.count = tCount
    this.toxins.instanceMatrix.needsUpdate = true
    // Deployables.
    const dSeen = new Set<number>()
    for (const row of snap.d) {
      const [id, kindIdx, x, z, hp, aim, armed, team, owner, dvx, dvz] = row
      const kind = DEPLOY_KINDS[kindIdx]
      dSeen.add(id)
      let d = this.deploys.get(id)
      if (!d) {
        d = this.makeDeploy(kind, team, owner)
        this.deploys.set(id, d)
        this.scene.add(d.obj)
      }
      if (d.actor) {
        // Decoy: a convincing double for enemies, a ghost for its own side.
        const rel = this.relation(owner)
        d.actor.update(dt, t, x, z, aim, dvx, dvz, true, rel === 'enemy' ? 0 : 0.42, false, false, false, false, false)
        if (rel !== 'enemy' && Math.random() < dt * 10) this.fx.puff(x + (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 1.4, z + (Math.random() - 0.5) * 0.8, '#c084fc', 0.4, 0.4, 0.3)
        continue
      }
      if (kind === 'wall') {
        d.obj.position.set(x, 0, z)
        d.obj.rotation.y = Math.atan2(Math.cos(aim), Math.sin(aim))
        const frac = Math.max(0, hp / POWER.wall.hp)
        const flick = frac < 0.35 && Math.sin(t * 40) > 0.3 ? 0.5 : 1
        const up = armed ? 1 : 0.25
        if (d.mats) {
          d.mats[0].opacity = (0.16 + 0.22 * frac) * flick * up
          d.mats[1].opacity = 0.95 * flick * (armed ? 1 : 0.4)
        }
        continue
      }
      if (kind === 'gas') {
        d.obj.position.set(x, 0, z)
        d.obj.rotation.y = t * 0.3
        const r = POWER.toxin.radius
        for (let n = Math.min(4, Math.ceil(dt * 90)); n > 0; n--) {
          const a = Math.random() * Math.PI * 2
          const rr = Math.sqrt(Math.random()) * r
          this.fx.puff(x + Math.cos(a) * rr, 0.2 + Math.random() * 0.9, z + Math.sin(a) * rr, Math.random() < 0.7 ? '#a3e635' : '#65a30d', 2 + Math.random() * 1.5, 1.6, 0.35)
        }
        continue
      }
      d.obj.position.set(x, d.hover ? 0.9 + Math.sin(t * 2.2 + id) * 0.12 : 0, z)
      if (d.turretHead) d.turretHead.rotation.y = Math.atan2(Math.cos(aim), Math.sin(aim))
      if (d.lamp) (d.lamp.material as THREE.MeshBasicMaterial).color.set(armed ? (Math.sin(t * 12) > 0 ? '#ff3366' : '#55001a') : '#333')
      if (kind === 'heal') {
        d.obj.rotation.y = t * 0.8
        d.obj.scale.setScalar(1 + Math.sin(t * 5) * 0.03)
      }
      void hp
    }
    for (const [id, d] of this.deploys)
      if (!dSeen.has(id)) {
        this.scene.remove(d.obj)
        if (d.actor) {
          const p = d.actor.group.position
          this.fx.burst(p.x, 1, p.z, 24, '#c084fc', 4, 0.5, 0.45)
          d.actor.dispose()
        }
        if (d.kind === 'wall') {
          const p = d.obj.position
          this.fx.burst(p.x, 0.9, p.z, 18, '#fdba74', 3, 0.4, 0.4, 4)
        }
        for (const m of d.mats ?? []) m.dispose()
        this.deploys.delete(id)
      }
    // Power-up pads.
    for (const [id, x, z, kindIdx, wait] of snap.pd ?? []) {
      let pv = this.pads.get(id)
      if (!pv) {
        pv = this.makePad(x, z)
        this.pads.set(id, pv)
        this.scene.add(pv.group)
      }
      const ready = wait <= 0
      if (pv.kind !== kindIdx) {
        if (pv.icon) pv.group.remove(pv.icon)
        pv.icon = powerupIcon(POWERUP_KINDS[kindIdx])
        pv.group.add(pv.icon)
        pv.kind = kindIdx
      }
      const color = POWERUPS[POWERUP_KINDS[kindIdx]].color
      pv.ring.color.set(color)
      pv.ring.opacity = ready ? 0.85 + Math.sin(t * 6) * 0.15 : 0.22
      if (pv.icon) {
        pv.icon.visible = ready || wait < 2.5
        pv.icon.position.y = 1.1 + Math.sin(t * 2.5 + id) * 0.15
        pv.icon.rotation.y = t * 1.6
        pv.icon.scale.setScalar(ready ? 1.45 : Math.max(0.05, 1 - wait / 2.5) * 0.8)
      }
      if (ready && Math.random() < dt * 6) this.fx.puff(x + (Math.random() - 0.5) * 1.2, 0.2, z + (Math.random() - 0.5) * 1.2, color, 0.4, 0.8, 1.2)
    }
    // Pickups.
    const kSeen = new Set<number>()
    for (const [id, x, z, kindIdx] of snap.k) {
      kSeen.add(id)
      let o = this.pickups.get(id)
      if (!o) {
        o = this.makePickup(LOOT_KINDS[kindIdx])
        this.pickups.set(id, o)
        this.scene.add(o)
      }
      o.position.set(x, 0.6 + Math.sin(t * 3 + id) * 0.15, z)
      o.rotation.y = t * 2
    }
    for (const [id, o] of this.pickups)
      if (!kSeen.has(id)) {
        this.scene.remove(o)
        this.pickups.delete(id)
      }
    // Crates.
    if (this.map) {
      let i = 0
      for (const [, obj] of this.map.crates) {
        const hp = snap.c[i++] ?? 1
        obj.visible = hp > 0
      }
    }
    // Grid.
    if (snap.br && this.map) this.map.setGrid(snap.br[0], snap.br[1], snap.br[2], snap.br[3], snap.br[4], snap.br[5], true)
    // Events.
    for (const e of events) this.event(e)
    this.fx.update(dt)
    // Camera.
    this.placeCamera(false, dt)
    if (this.composer) this.composer.render(dt)
    else this.renderer.render(this.scene, this.camera)
    this.drawOverlay(snap)
  }

  private event(e: SimEvent) {
    switch (e.t) {
      case 'shot': {
        const m = this.meta.get(e.id)
        const hero = m ? HEROES[m.hero] : null
        const color = hero ? hero.colors[1] : '#facc15'
        const a = this.actors.get(e.id)
        if (a) {
          a.fire()
          const tip = a.gunTip
          this.fx.muzzle(tip.x, tip.z, e.aim, color, e.kind === 'rail' || e.kind === 'grenade', tip.y)
        } else this.fx.muzzle(e.x, e.z, e.aim, color, e.kind === 'rail' || e.kind === 'grenade')
        break
      }
      case 'hit': {
        const rel = e.target > 0 ? this.relation(e.target) : 'enemy'
        if (e.dot) {
          this.fx.text(e.x, e.z, String(e.dmg), rel === 'me' ? '#fb7185' : '#bef264', 0.85)
          break
        }
        if (!e.heal && e.target > 0) this.actors.get(e.target)?.flinch(e.dmg)
        this.fx.hit(e.x, e.z, rel === 'enemy' ? '#fde68a' : '#fb7185')
        this.fx.text(e.x, e.z, String(e.dmg), rel === 'me' ? '#fb7185' : rel === 'ally' ? '#fda4af' : e.dmg >= 300 ? '#fde047' : '#ffffff', e.dmg >= 300 ? 1.35 : 1)
        if (rel === 'me' && this.shakeOn) this.fx.shake = Math.max(this.fx.shake, Math.min(0.5, e.dmg / 600))
        break
      }
      case 'death': {
        const m = this.meta.get(e.id)
        this.fx.death(e.x, e.z, m ? HEROES[m.hero].colors[0] : '#ffffff')
        if (e.id === this.meId && this.shakeOn) this.fx.shake = 0.8
        break
      }
      case 'explode':
        this.fx.explosion(e.x, e.z, e.r, e.kind)
        break
      case 'super': {
        const hero = HEROES[e.hero]
        this.fx.superBurst(e.x, e.z, hero.colors[1])
        this.actors.get(e.id)?.superNow()
        break
      }
      case 'power': {
        const a = this.actors.get(e.id)
        if (e.kind === 'blink') {
          this.fx.blink(e.x, e.z, e.tx, e.tz)
          a?.fire()
        } else if (e.kind === 'dart' || e.kind === 'toxin') a?.fire()
        else {
          a?.superNow()
          if (e.kind === 'wall') {
            this.fx.ring(e.tx, e.tz, 1.8, '#fdba74', 0.35)
            this.fx.burst(e.tx, 1, e.tz, 16, '#fdba74', 3, 0.4, 0.4)
          }
          if (e.kind === 'vent') this.fx.ring(e.x, e.z, 1.2, '#ff7a1a', 0.45)
        }
        break
      }
      case 'counter': {
        const rule = COUNTER_RULES[e.rule]
        const broken = rule.word === 'BROKEN!'
        this.fx.counter(e.x, e.z, rule.color, broken)
        this.fx.banner(e.x, e.z, rule.word, rule.label, rule.color)
        if ((e.target === this.meId || e.by === this.meId) && this.shakeOn) this.fx.shake = Math.max(this.fx.shake, broken ? 0.45 : 0.25)
        break
      }
      case 'powerup': {
        const info = POWERUPS[e.kind]
        this.fx.pickup(e.x, e.z, info.color)
        this.fx.ring(e.x, e.z, 2, info.color, 0.5)
        this.fx.text(e.x, e.z, info.name.toUpperCase(), info.color, 1.2)
        break
      }
      case 'revive': {
        const a = this.actors.get(e.id)
        if (a) {
          const p = a.group.position
          this.fx.ring(p.x, p.z, 2.4, '#f9a8d4', 0.6)
          this.fx.burst(p.x, 0.5, p.z, 30, '#fbcfe8', 3, 0.9, 0.5, -3, 3)
          this.fx.text(p.x, p.z, 'REVIVED', '#f9a8d4', 1.3)
        }
        break
      }
      case 'dash': {
        const a = this.actors.get(e.id)
        const m = this.meta.get(e.id)
        if (a) this.fx.dash(a.group.position.x, a.group.position.z, m ? HEROES[m.hero].colors[1] : '#fff')
        break
      }
      case 'pickup': {
        const a = this.actors.get(e.id)
        if (a) {
          this.fx.pickup(a.group.position.x, a.group.position.z, LOOT_INFO[e.kind].color)
          if (e.id === this.meId) this.fx.text(a.group.position.x, a.group.position.z, LOOT_INFO[e.kind].name, LOOT_INFO[e.kind].color, 1.1)
        }
        break
      }
      default:
        break
    }
  }

  private makeDeploy(kind: string, team: number, owner: number): DeployView {
    const color = this.br ? (owner === this.meId ? '#22d3ee' : '#fb7185') : team === this.meTeam ? '#22d3ee' : '#fb7185'
    if (kind === 'decoy') {
      const m = this.meta.get(owner)
      const actor = new FighterActor(this.assets, m?.hero ?? 'flick', m?.skin ?? 'default', this.relation(owner))
      return { obj: actor.group, kind, team, actor, owner }
    }
    if (kind === 'wall') {
      // Riot Wall: a hex-patterned energy pane with a bright frame and a glowing footprint (it reads from above).
      const g = new THREE.Group()
      const w = POWER.wall.half * 2
      const tint = team === this.meTeam && !this.br ? '#fb923c' : '#fb7185'
      const pane = new THREE.MeshBasicMaterial({ color: tint, map: hexTexture(), transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
      const frame = new THREE.MeshBasicMaterial({ color: team === this.meTeam && !this.br ? '#fdba74' : '#fda4af', transparent: true, opacity: 0.95, depthWrite: false })
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1.8, 0.22), pane)
      slab.position.y = 0.95
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.1, 0.26), frame)
      top.position.y = 1.88
      const foot = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.05, 0.5), frame)
      foot.position.y = 0.03
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.26), frame)
      left.position.set(-w / 2, 0.95, 0)
      const right = left.clone()
      right.position.x = w / 2
      g.add(slab, top, foot, left, right)
      return { obj: g, kind, team, mats: [pane, frame] }
    }
    if (kind === 'gas') {
      const g = new THREE.Group()
      const r = POWER.toxin.radius
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: '#65a30d', transparent: true, opacity: 0.28, depthWrite: false }))
      disc.rotation.x = -Math.PI / 2
      disc.position.y = 0.05
      const rim = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), new THREE.MeshBasicMaterial({ color: '#bef264', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }))
      rim.rotation.x = -Math.PI / 2
      rim.position.y = 0.06
      const mats = [disc.material, rim.material] as THREE.MeshBasicMaterial[]
      g.add(disc, rim)
      return { obj: g, kind, team, mats }
    }
    if (kind === 'turret') {
      // Sentry Pod: the hover drone, bobbing over a team-coloured ring, turning to face its target.
      const drone = instance(this.assets, 'env-drone')
      if (drone) {
        const g = new THREE.Group()
        const head = new THREE.Group()
        head.add(drone)
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }))
        ring.rotation.x = -Math.PI / 2
        ring.position.y = -0.85
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color }))
        lamp.position.set(0, 1.12, 0.05)
        head.add(lamp)
        g.add(head, ring)
        return { obj: g, kind, team, turretHead: head, hover: true }
      }
      const g = new THREE.Group()
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.5, 10), new THREE.MeshStandardMaterial({ color: '#3b3b4f', metalness: 0.6, roughness: 0.4 }))
      base.position.y = 0.25
      const head = new THREE.Group()
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), new THREE.MeshStandardMaterial({ color: '#5b5b78', metalness: 0.5, roughness: 0.4, emissive: new THREE.Color(color), emissiveIntensity: 0.4 }))
      dome.position.y = 0.75
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: '#22222c', metalness: 0.7 }))
      barrel.position.set(0, 0.78, 0.45)
      head.add(dome, barrel)
      g.add(base, head)
      base.castShadow = dome.castShadow = true
      return { obj: g, kind, team, turretHead: head }
    }
    if (kind === 'mine') {
      const g = new THREE.Group()
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 12), new THREE.MeshStandardMaterial({ color: '#2b2b33', metalness: 0.5 }))
      disc.position.y = 0.06
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#333' }))
      lamp.position.y = 0.15
      g.add(disc, lamp)
      return { obj: g, kind, team, lamp }
    }
    const g = new THREE.Group()
    const zone = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.5, 40, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }))
    zone.position.y = 0.25
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false }))
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.04
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.25), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    const cross2 = cross.clone()
    cross2.rotation.y = Math.PI / 2
    cross.position.y = cross2.position.y = 0.3
    g.add(zone, disc, cross, cross2)
    return { obj: g, kind, team }
  }

  private makePad(x: number, z: number): PadView {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 6), new THREE.MeshStandardMaterial({ color: '#1f1b33', metalness: 0.7, roughness: 0.35 }))
    base.position.y = 0.06
    base.receiveShadow = true
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.86, 6), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.rotation.z = Math.PI / 6
    ring.position.y = 0.13
    g.add(base, ring)
    return { group: g, ring: ringMat, icon: null, kind: -1 }
  }

  private makePickup(kind: LootKind) {
    if (kind === 'shard') {
      const g = new THREE.Group()
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 14), new THREE.MeshStandardMaterial({ color: '#fde047', emissive: new THREE.Color('#facc15'), emissiveIntensity: 0.7, metalness: 0.8, roughness: 0.25 }))
      coin.rotation.x = Math.PI / 2
      g.add(coin)
      return g
    }
    const g = new THREE.Group()
    const color = LOOT_INFO[kind].color
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.8, roughness: 0.3 }))
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = -0.55
    g.add(gem, ring)
    return g
  }

  /* ---------- Camera ---------- */

  private placeCamera(snapNow: boolean, dt = 0) {
    const me = this.actors.get(this.meId)
    let tx = this.focus.x
    let tz = this.focus.z
    if (me && me.alive) {
      tx = me.group.position.x + this.aimDx
      tz = me.group.position.z + this.aimDz
    } else if (me) {
      tx = me.group.position.x
      tz = me.group.position.z
    } else if (this.lastSnap) {
      // Spectate: the first living fighter.
      const row = this.lastSnap.f.find((r) => r[6] & SNAP_FLAGS.alive)
      if (row) {
        tx = row[1]
        tz = row[2]
      }
    }
    if (this.mapDef) {
      const pad = 1.5
      tx = Math.min(this.mapDef.w * CELL - pad, Math.max(pad, tx))
      tz = Math.min(this.mapDef.h * CELL - pad, Math.max(pad, tz))
    }
    const k = snapNow ? 1 : 1 - Math.exp(-dt * 6)
    this.focus.x += (tx - this.focus.x) * k
    this.focus.z += (tz - this.focus.z) * k
    if (this.cine) {
      const c = this.cine
      this.camera.position.set(c.x + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist, c.height + Math.sin(c.pitch) * c.dist, c.z + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist)
      this.camera.lookAt(c.x, c.height, c.z)
      this.sun.position.set(c.x + 14, 30, c.z + 10)
      this.sun.target.position.set(c.x, 0, c.z)
      this.sun.target.updateMatrixWorld()
      return
    }
    const h = 29 * this.zoom
    const back = 14 * this.zoom
    const sh = this.shakeOn ? this.fx.shake : 0
    const jx = (Math.random() - 0.5) * sh * 0.8
    const jz = (Math.random() - 0.5) * sh * 0.8
    this.camera.position.set(this.focus.x + jx, h, this.focus.z + back + jz)
    this.camera.lookAt(this.focus.x + jx, 0, this.focus.z + jz)
    this.sun.position.set(this.focus.x + 14, 30, this.focus.z + 10)
    this.sun.target.position.set(this.focus.x, 0, this.focus.z)
    this.sun.target.updateMatrixWorld()
  }

  /** World point on the floor under a normalised device coordinate. */
  pickGround(nx: number, ny: number) {
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1)
    const out = new THREE.Vector3()
    return ray.ray.intersectPlane(plane, out) ? { x: out.x, z: out.z } : null
  }

  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 }
  }

  /* ---------- Overlay ---------- */

  private drawOverlay(snap: Snap) {
    const c = this.octx
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    c.clearRect(0, 0, w, h)
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const rows = new Map<number, number[]>()
    for (const row of snap.f) rows.set(row[0], row)
    // Marked enemies: a red reticle on the floor.
    const markBit = 1 << STATUS_KINDS.indexOf('mark')
    for (const row of snap.f) {
      const [id, x, z, , , , flags] = row
      if (!(flags & SNAP_FLAGS.alive) || !((row[SNAP_F.status] ?? 0) & markBit) || this.relation(id) !== 'enemy') continue
      const pos = this.project(x, 0.9, z)
      if (pos.behind) continue
      drawReticle(c, pos.x, pos.y, 26, this.time)
    }
    for (const row of snap.f) {
      const [id, x, z, , hp, maxHp, flags, sup, , , shield] = row
      if (!(flags & SNAP_FLAGS.alive)) continue
      const rel = this.relation(id)
      if (rel === 'enemy' && flags & SNAP_FLAGS.cloak) continue
      const m = this.meta.get(id)
      this.drawTag(c, x, z, m?.name ?? '', rel, hp, maxHp, sup, shield, flags, row[SNAP_F.status] ?? 0)
    }
    // Enemy decoys wear their owner's tag (that is the trick).
    for (const row of snap.d) {
      if (DEPLOY_KINDS[row[1]] !== 'decoy') continue
      const owner = row[8]
      const rel = this.relation(owner)
      const o = rows.get(owner)
      if (!o) continue
      if (rel === 'enemy') this.drawTag(c, row[2], row[3], this.meta.get(owner)?.name ?? '', rel, o[4], o[5], o[7], 0, SNAP_FLAGS.alive, 0)
      else {
        const pos = this.project(row[2], 2.25, row[3])
        c.font = '700 9px Inter, system-ui, sans-serif'
        c.fillStyle = 'rgba(216,180,254,0.85)'
        c.fillText('DECOY', pos.x, pos.y)
      }
    }
    for (const t of this.fx.texts) {
      const pos = this.project(t.x, t.y, t.z)
      if (pos.behind) continue
      c.globalAlpha = Math.min(1, t.life * 2)
      if (t.banner) {
        // Counter popup: a punchy word with a heavy outline, the rule underneath.
        const pop = (1 + Math.max(0, t.life - 1.15) * 3) * Math.min(1, Math.max(0.6, h / 640))
        c.font = `900 italic ${Math.round(22 * pop)}px Inter, system-ui, sans-serif`
        c.lineWidth = 5
        c.strokeStyle = 'rgba(0,0,0,0.85)'
        c.strokeText(t.text, pos.x, pos.y)
        c.fillStyle = t.color
        c.shadowColor = t.color
        c.shadowBlur = 14
        c.fillText(t.text, pos.x, pos.y)
        c.shadowBlur = 0
        if (t.sub) {
          c.font = '800 11px Inter, system-ui, sans-serif'
          c.lineWidth = 3
          c.strokeText(t.sub.toUpperCase(), pos.x, pos.y + 18)
          c.fillStyle = '#ffffff'
          c.fillText(t.sub.toUpperCase(), pos.x, pos.y + 18)
        }
        continue
      }
      c.font = `800 ${Math.round(15 * t.size)}px Inter, system-ui, sans-serif`
      c.fillStyle = '#000'
      c.fillText(t.text, pos.x + 1, pos.y + 1)
      c.fillStyle = t.color
      c.fillText(t.text, pos.x, pos.y)
    }
    c.globalAlpha = 1
    // Loot names.
    c.font = '600 10px Inter, system-ui, sans-serif'
    for (const [, x, z, kindIdx] of snap.k) {
      if (LOOT_KINDS[kindIdx] === 'shard') continue
      const pos = this.project(x, 1.4, z)
      if (pos.behind) continue
      const info = LOOT_INFO[LOOT_KINDS[kindIdx]]
      c.fillStyle = info.color
      c.fillText(info.name, pos.x, pos.y)
    }
    // Pad labels: the power-up's name when it's up, a countdown while it recharges.
    for (const [, x, z, kindIdx, wait] of snap.pd ?? []) {
      const pos = this.project(x, wait > 0 ? 0.4 : 1.85, z)
      if (pos.behind || pos.x < -40 || pos.y < -40 || pos.x > w + 40 || pos.y > h + 40) continue
      const info = POWERUPS[POWERUP_KINDS[kindIdx]]
      if (wait > 0) {
        c.font = '800 11px Inter, system-ui, sans-serif'
        c.fillStyle = 'rgba(0,0,0,0.6)'
        c.beginPath()
        c.arc(pos.x, pos.y, 13, 0, Math.PI * 2)
        c.fill()
        c.strokeStyle = info.color
        c.lineWidth = 2.5
        c.beginPath()
        const span = Math.min(1, wait / 24)
        c.arc(pos.x, pos.y, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - span))
        c.stroke()
        c.fillStyle = '#fff'
        c.fillText(String(Math.ceil(wait)), pos.x, pos.y + 0.5)
      } else {
        c.font = '800 10px Inter, system-ui, sans-serif'
        c.lineWidth = 3
        c.strokeStyle = 'rgba(0,0,0,0.8)'
        c.strokeText(info.name.toUpperCase(), pos.x, pos.y)
        c.fillStyle = info.color
        c.fillText(info.name.toUpperCase(), pos.x, pos.y)
      }
    }
    this.minimapAt -= 1
    if (this.minimapAt <= 0) {
      this.minimapAt = 3
      this.drawMinimap(snap)
    }
  }

  /** Name, health / shield / super bars and status chips over a fighter (or a decoy pretending to be one). */
  private drawTag(c: CanvasRenderingContext2D, x: number, z: number, name: string, rel: Relation, hp: number, maxHp: number, sup: number, shield: number, flags: number, mask: number) {
    const pos = this.project(x, 2.25, z)
    if (pos.behind) return
    const bw = 54
    const bx = pos.x - bw / 2
    const by = pos.y
    c.font = `700 11px Inter, system-ui, sans-serif`
    c.fillStyle = 'rgba(0,0,0,0.55)'
    c.fillRect(bx - 1, by - 1, bw + 2, 7)
    c.fillStyle = rel === 'me' ? '#4ade80' : rel === 'ally' ? '#22d3ee' : '#fb7185'
    c.fillRect(bx, by, bw * Math.max(0, hp / maxHp), 5)
    if (shield > 0) {
      c.fillStyle = '#e0f2fe'
      c.fillRect(bx, by - 3, bw * Math.min(1, shield / maxHp), 2)
    }
    // Super charge as a thin bar under the health.
    c.fillStyle = sup >= 1 ? '#fde047' : 'rgba(253,224,71,0.45)'
    c.fillRect(bx, by + 6, bw * Math.min(1, sup), 2)
    c.fillStyle = rel === 'me' ? '#ffffff' : rel === 'ally' ? '#bae6fd' : '#fecdd3'
    c.shadowColor = 'rgba(0,0,0,0.9)'
    c.shadowBlur = 4
    c.fillText(name, pos.x, by - 10)
    c.shadowBlur = 0
    if (flags & SNAP_FLAGS.spawnShield) {
      c.fillStyle = 'rgba(255,255,255,0.7)'
      c.font = '600 9px Inter, system-ui, sans-serif'
      c.fillText('SHIELDED', pos.x, by + 16)
    }
    if (flags & SNAP_FLAGS.channel) {
      c.fillStyle = '#fdba74'
      c.font = '900 9px Inter, system-ui, sans-serif'
      c.fillText('VENTING', pos.x, by + 16)
    }
    // Status chips, right of the bars.
    let cx = bx + bw + 8
    for (const k of CHIP_KINDS) {
      if (!(mask & (1 << STATUS_KINDS.indexOf(k)))) continue
      drawChip(c, k, cx, by + 3)
      cx += 13
    }
  }

  private drawMinimap(snap: Snap) {
    const map = this.mapDef
    const cv = this.minimap
    const c = this.mctx
    if (!map || !this.mapLayer) return
    const W = cv.width
    const H = cv.height
    const sx = W / (map.w * CELL)
    const sz = H / (map.h * CELL)
    c.clearRect(0, 0, W, H)
    c.globalAlpha = 0.92
    c.drawImage(this.mapLayer, 0, 0, W, H)
    c.globalAlpha = 1
    const dpr = W / Math.max(1, cv.clientWidth || W)
    // Shrinking grid.
    if (snap.br) {
      const [gx, gz, half, nx, nz, nh] = snap.br
      c.strokeStyle = '#f472b6'
      c.lineWidth = 2 * dpr
      c.strokeRect((gx - half) * sx, (gz - half) * sz, half * 2 * sx, half * 2 * sz)
      c.setLineDash([4 * dpr, 3 * dpr])
      c.strokeStyle = 'rgba(255,255,255,0.7)'
      c.strokeRect((nx - nh) * sx, (nz - nh) * sz, nh * 2 * sx, nh * 2 * sz)
      c.setLineDash([])
    }
    // Gas clouds and walls.
    for (const row of snap.d) {
      const kind = DEPLOY_KINDS[row[1]]
      if (kind === 'gas') {
        c.fillStyle = 'rgba(163,230,53,0.35)'
        c.beginPath()
        c.arc(row[2] * sx, row[3] * sz, POWER.toxin.radius * sx, 0, Math.PI * 2)
        c.fill()
      } else if (kind === 'wall') {
        c.strokeStyle = '#fdba74'
        c.lineWidth = 2 * dpr
        const px = -Math.sin(row[5]) * POWER.wall.half
        const pz = Math.cos(row[5]) * POWER.wall.half
        c.beginPath()
        c.moveTo((row[2] - px) * sx, (row[3] - pz) * sz)
        c.lineTo((row[2] + px) * sx, (row[3] + pz) * sz)
        c.stroke()
      }
    }
    // Pads with their recharge arcs.
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    for (const [, x, z, kindIdx, wait] of snap.pd ?? []) {
      const info = POWERUPS[POWERUP_KINDS[kindIdx]]
      const px = x * sx
      const pz = z * sz
      const r = 4.5 * dpr
      c.fillStyle = wait > 0 ? 'rgba(20,16,40,0.9)' : info.color
      c.beginPath()
      c.moveTo(px, pz - r)
      c.lineTo(px + r, pz)
      c.lineTo(px, pz + r)
      c.lineTo(px - r, pz)
      c.closePath()
      c.fill()
      c.strokeStyle = info.color
      c.lineWidth = 1.5 * dpr
      c.stroke()
      if (wait > 0) {
        c.beginPath()
        c.arc(px, pz, r + 2.5 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - Math.min(1, wait / 24)))
        c.stroke()
        c.font = `800 ${Math.round(8 * dpr)}px Inter, system-ui, sans-serif`
        c.fillStyle = '#fff'
        c.fillText(String(Math.ceil(wait)), px, pz + r + 7 * dpr)
      }
    }
    // Fighters: you, allies, and enemies only while scanned or marked.
    const seenBits = (1 << STATUS_KINDS.indexOf('revealed')) | (1 << STATUS_KINDS.indexOf('mark'))
    for (const row of snap.f) {
      const [id, x, z, aim, , , flags] = row
      if (!(flags & SNAP_FLAGS.alive)) continue
      const rel = this.relation(id)
      if (rel === 'enemy' && !((row[SNAP_F.status] ?? 0) & seenBits)) continue
      const px = x * sx
      const pz = z * sz
      if (rel === 'me') {
        c.fillStyle = '#ffffff'
        c.beginPath()
        c.moveTo(px + Math.cos(aim) * 6 * dpr, pz + Math.sin(aim) * 6 * dpr)
        c.lineTo(px + Math.cos(aim + 2.4) * 4 * dpr, pz + Math.sin(aim + 2.4) * 4 * dpr)
        c.lineTo(px + Math.cos(aim - 2.4) * 4 * dpr, pz + Math.sin(aim - 2.4) * 4 * dpr)
        c.closePath()
        c.fill()
      } else {
        c.fillStyle = rel === 'ally' ? '#22d3ee' : '#fb7185'
        c.beginPath()
        c.arc(px, pz, 3 * dpr, 0, Math.PI * 2)
        c.fill()
      }
    }
  }

  /** Read the current frame as a PNG data URL (tests). */
  snapshotUrl() {
    return this.renderer.domElement.toDataURL('image/png')
  }

  dispose() {
    this.map?.dispose()
    for (const a of this.actors.values()) a.dispose()
    for (const d of this.deploys.values()) d.actor?.dispose()
    this.fx.dispose()
    for (const d of this.disposables) d.dispose()
    this.composer?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.overlay.remove()
    this.minimap.remove()
  }
}

/* ---------- Builders ---------- */

let hexTex: THREE.Texture | null = null
/** A hexagon lattice for the Riot Wall's energy pane. */
function hexTexture() {
  if (hexTex) return hexTex
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 74
  const g = cv.getContext('2d')!
  g.fillStyle = 'rgba(255,255,255,0.25)'
  g.fillRect(0, 0, 128, 74)
  g.strokeStyle = 'rgba(255,255,255,1)'
  g.lineWidth = 2
  const r = 12
  for (let row = -1; row < 5; row++)
    for (let col = -1; col < 7; col++) {
      const x = col * r * 1.5 * 1.15
      const y = row * r * 1.732 + (col % 2 ? (r * 1.732) / 2 : 0)
      g.beginPath()
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const px = x + Math.cos(a) * r
        const py = y + Math.sin(a) * r
        if (i) g.lineTo(px, py)
        else g.moveTo(px, py)
      }
      g.stroke()
    }
  hexTex = new THREE.CanvasTexture(cv)
  hexTex.wrapS = hexTex.wrapT = THREE.RepeatWrapping
  hexTex.repeat.set(2.5, 2.5)
  return hexTex
}

const iconCache = new Map<PowerUpKind, THREE.Object3D>()
/** A small procedural model for each power-up, floating over its pad. */
function powerupIcon(kind: PowerUpKind): THREE.Object3D {
  const cached = iconCache.get(kind)
  if (cached) return cached.clone()
  const color = POWERUPS[kind].color
  const glow = (c: string, e = 0.9) => new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: e, roughness: 0.3, metalness: 0.4 })
  const g = new THREE.Group()
  const mat = glow(color)
  switch (kind) {
    case 'hyper': {
      // Overclock: three stacked chevrons.
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.22, 4), mat)
        c.position.y = -0.2 + i * 0.2
        g.add(c)
      }
      break
    }
    case 'overshield': {
      const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 6), mat)
      hex.rotation.x = Math.PI / 2
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 6), glow('#ffffff', 1.2))
      core.rotation.x = Math.PI / 2
      g.add(hex, core)
      break
    }
    case 'haste': {
      // Speed Boots: a boot (shaft and sole) with a wing.
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.2), mat)
      shaft.position.y = 0.08
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.42), mat)
      sole.position.set(0, -0.12, 0.1)
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.38, 3), glow('#ffffff', 1))
      wing.rotation.z = Math.PI / 2.4
      wing.position.set(0.18, 0.16, -0.04)
      g.add(shaft, sole, wing)
      break
    }
    case 'amp': {
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), mat)
      const spikes = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), glow('#fecdd3', 0.6))
      ;(spikes.material as THREE.MeshStandardMaterial).wireframe = true
      g.add(core, spikes)
      break
    }
    case 'reset': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 24, Math.PI * 1.6), mat)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 8), mat)
      tip.position.set(0.26, 0.05, 0)
      tip.rotation.z = -0.3
      g.add(ring, tip)
      break
    }
    case 'ricochet': {
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat)
        seg.position.set(-0.16 + i * 0.16, (i % 2 ? 0.08 : -0.08), 0)
        seg.rotation.z = i % 2 ? -0.7 : 0.7
        g.add(seg)
      }
      break
    }
    case 'magnet': {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 8, 20, Math.PI), glow('#ef4444', 0.6))
      arc.rotation.z = Math.PI
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), glow('#e5e7eb', 0.5))
      l.position.set(-0.22, 0.06, 0)
      const r = l.clone()
      r.position.x = 0.22
      g.add(arc, l, r)
      break
    }
    case 'phase': {
      // Phase Cloak: a ghost.
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.8, transparent: true, opacity: 0.75 }))
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 14, 1, true), head.material)
      body.position.y = -0.15
      g.add(head, body)
      break
    }
    case 'medkit':
    case 'revive': {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.18), glow(kind === 'medkit' ? '#f8fafc' : color, 0.5))
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.2), glow(kind === 'medkit' ? '#22c55e' : '#ffffff', 1.1))
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.2), a.material)
      g.add(box, a, b)
      break
    }
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }))
  g.add(halo)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  iconCache.set(kind, g)
  return g.clone()
}

/** The static layer of the minimap: floor, cover, walls and the void. */
function minimapLayer(map: MapDef, chars: string[]) {
  const cv = document.createElement('canvas')
  const px = 4
  cv.width = map.w * px
  cv.height = map.h * px
  const g = cv.getContext('2d')!
  g.fillStyle = '#120c26'
  g.fillRect(0, 0, cv.width, cv.height)
  for (let cz = 0; cz < map.h; cz++)
    for (let cx = 0; cx < map.w; cx++) {
      const ch = chars[cz * map.w + cx]
      let col = ''
      if ('#nhkU'.includes(ch)) col = '#5b4d8a'
      else if ('=Tds'.includes(ch)) col = '#3a3160'
      else if ('xb$'.includes(ch)) col = '#4a3b2a'
      else if (ch === '~') col = '#05030c'
      else if (ch === '*') col = '#3b1d5c'
      if (!col) continue
      g.fillStyle = col
      g.fillRect(cx * px, cz * px, px, px)
    }
  return cv
}

/** Floor reticle around a marked enemy. */
function drawReticle(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  c.save()
  c.translate(x, y)
  c.rotate(t * 1.4)
  c.strokeStyle = '#f43f5e'
  c.lineWidth = 2.5
  c.shadowColor = '#f43f5e'
  c.shadowBlur = 8
  for (let i = 0; i < 4; i++) {
    c.beginPath()
    c.arc(0, 0, r, (i * Math.PI) / 2 + 0.25, (i * Math.PI) / 2 + Math.PI / 2 - 0.25)
    c.stroke()
  }
  c.restore()
}

/** A small round status icon drawn with canvas paths (no font glyphs needed). */
function drawChip(c: CanvasRenderingContext2D, kind: StatusKind, x: number, y: number) {
  const info = STATUS_INFO[kind]
  c.save()
  c.translate(x, y)
  c.fillStyle = 'rgba(0,0,0,0.65)'
  c.beginPath()
  c.arc(0, 0, 6, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = info.color
  c.fillStyle = info.color
  c.lineWidth = 1.6
  c.beginPath()
  c.arc(0, 0, 6, 0, Math.PI * 2)
  c.stroke()
  c.beginPath()
  switch (kind) {
    case 'mark':
      c.arc(0, 0, 2.6, 0, Math.PI * 2)
      c.moveTo(-4.5, 0)
      c.lineTo(4.5, 0)
      c.moveTo(0, -4.5)
      c.lineTo(0, 4.5)
      c.stroke()
      break
    case 'revealed':
      c.ellipse(0, 0, 4, 2.4, 0, 0, Math.PI * 2)
      c.stroke()
      c.beginPath()
      c.arc(0, 0, 1.2, 0, Math.PI * 2)
      c.fill()
      break
    case 'scorch':
      c.moveTo(0, -4)
      c.quadraticCurveTo(3.5, 0, 0, 4)
      c.quadraticCurveTo(-3.5, 0, 0, -4)
      c.fill()
      break
    case 'toxin':
      c.arc(-1.5, 1, 1.6, 0, Math.PI * 2)
      c.arc(1.8, -1.4, 1.2, 0, Math.PI * 2)
      c.fill()
      break
    case 'slow':
      c.moveTo(-3, -2)
      c.lineTo(0, 1)
      c.lineTo(3, -2)
      c.moveTo(-3, 1)
      c.lineTo(0, 4)
      c.lineTo(3, 1)
      c.stroke()
      break
    case 'purged':
      c.moveTo(-3, 0)
      c.lineTo(3, 0)
      c.moveTo(0, -3)
      c.lineTo(0, 3)
      c.stroke()
      break
    default:
      c.moveTo(0, -3.5)
      c.lineTo(3, 0)
      c.lineTo(0, 3.5)
      c.lineTo(-3, 0)
      c.closePath()
      c.fill()
  }
  c.restore()
}

