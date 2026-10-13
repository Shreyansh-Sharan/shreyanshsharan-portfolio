// The three.js side: renderer, a top-down follow camera with aim look-ahead and shake, the map, fighter actors,
// instanced projectiles, deployables, loot, effects, optional bloom, and a 2D overlay for name tags, health bars
// and floating damage numbers. It draws snapshots, so the host view and online clients share this code.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { instance, type SiegeAssets } from '../engine/assets'
import { HEROES, type HeroId } from '../engine/heroes'
import { CELL, type MapDef } from '../engine/maps'
import type { Quality } from '../engine/quality'
import { DEPLOY_KINDS, LOOT_KINDS, PROJ_KINDS, SNAP_FLAGS, type LootKind, type SimEvent, type Snap } from '../engine/sim'
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
}

const PROJ_STYLE: Record<string, { sx: number; sy: number; color: string }> = {
  bullet: { sx: 0.6, sy: 0.08, color: '#f0abfc' },
  pellet: { sx: 0.32, sy: 0.07, color: '#fde68a' },
  rail: { sx: 2.4, sy: 0.07, color: '#22d3ee' },
  needle: { sx: 0.55, sy: 0.05, color: '#fbcfe8' },
  turret: { sx: 0.5, sy: 0.08, color: '#facc15' },
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
  private deploys = new Map<number, { obj: THREE.Object3D; kind: string; team: number; turretHead?: THREE.Object3D; lamp?: THREE.Mesh; hover?: boolean }>()
  private pickups = new Map<number, THREE.Object3D>()
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
    // Deployables.
    const dSeen = new Set<number>()
    for (const row of snap.d) {
      const [id, kindIdx, x, z, hp, aim, armed, team] = row
      const kind = DEPLOY_KINDS[kindIdx]
      dSeen.add(id)
      let d = this.deploys.get(id)
      if (!d) {
        d = this.makeDeploy(kind, team)
        this.deploys.set(id, d)
        this.scene.add(d.obj)
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
        this.deploys.delete(id)
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

  private makeDeploy(kind: string, team: number) {
    const color = this.br ? '#f0abfc' : team === this.meTeam ? '#22d3ee' : '#fb7185'
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

  private makePickup(kind: LootKind) {
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
    for (const row of snap.f) {
      const [id, x, z, , hp, maxHp, flags, sup, , , shield] = row
      if (!(flags & SNAP_FLAGS.alive)) continue
      const rel = this.relation(id)
      if (rel === 'enemy' && flags & SNAP_FLAGS.cloak) continue
      const m = this.meta.get(id)
      const pos = this.project(x, 2.25, z)
      if (pos.behind) continue
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
      c.fillText(m ? (m.human ? m.name : m.name) : '', pos.x, by - 10)
      c.shadowBlur = 0
      if (flags & SNAP_FLAGS.spawnShield) {
        c.fillStyle = 'rgba(255,255,255,0.7)'
        c.font = '600 9px Inter, system-ui, sans-serif'
        c.fillText('SHIELDED', pos.x, by + 16)
      }
    }
    for (const t of this.fx.texts) {
      const pos = this.project(t.x, t.y, t.z)
      if (pos.behind) continue
      c.globalAlpha = Math.min(1, t.life * 2)
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
      const pos = this.project(x, 1.4, z)
      if (pos.behind) continue
      const info = LOOT_INFO[LOOT_KINDS[kindIdx]]
      c.fillStyle = info.color
      c.fillText(info.name, pos.x, pos.y)
    }
  }

  /** Read the current frame as a PNG data URL (tests). */
  snapshotUrl() {
    return this.renderer.domElement.toDataURL('image/png')
  }

  dispose() {
    this.map?.dispose()
    for (const a of this.actors.values()) a.dispose()
    this.fx.dispose()
    for (const d of this.disposables) d.dispose()
    this.composer?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.overlay.remove()
  }
}

