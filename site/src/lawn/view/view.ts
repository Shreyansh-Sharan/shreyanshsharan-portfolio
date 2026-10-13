// The renderer: a lighting mood per street and time of day (sky dome, image-based light baked from it, a key sun
// whose shadow box follows the camera, hemisphere fill, fog, exposure and the post grade), the world (street +
// houses), characters, the first-person arms, projectiles, traps, zones, ladders, weather, chaos props (seagulls,
// the ice-cream truck), particles and the first-person camera with bob, shake, hit-stop, KO tumble and a cinematic
// override.
import * as THREE from 'three'
import { findClip, instance, type LawnAssets } from '../engine/assets'
import { THROWABLES } from '../engine/gear'
import type { HeroId, UltKind } from '../engine/heroes'
import type { ToolKind } from '../engine/gear'
import { MAPS, type MapId, type TimeOfDay } from '../engine/maps'
import type { Piece } from '../engine/pieces'
import type { Quality } from '../engine/quality'
import { CHAOS_KINDS, PF, PROJ_KINDS, TOOL_KINDS, TRAP_KINDS, ZONE_KINDS, type SimEvent, type Snap } from '../engine/sim'
import type { HouseTheme } from '../engine/progress'
import { Actor, FirstPerson, teamColour, type ActorMeta } from './actors'
import { Fx } from './fx'
import { applySky, bakeEnvironment, makePost, skyMaterial, sunDirection, type Post } from './atmosphere'
import { indoorAmbient } from './housemats'
import { MOODS, moodFor, type Mood } from './moods'
import { dot } from './textures'
import { World } from './world'

export interface ViewOptions {
  preserve?: boolean
  fov: number
}

export interface CameraState {
  yaw: number
  pitch: number
}

export class LawnView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly fx: Fx
  readonly assets: LawnAssets
  readonly quality: Quality
  world: World | null = null
  private container: HTMLElement
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private sunDir = new THREE.Vector3(0, 1, 0)
  private env: THREE.Texture | null = null
  private post: Post | null = null
  /** Resolves once the post stack (medium and high quality) is ready. */
  readonly ready: Promise<void>
  mood: Mood = MOODS.sunny
  private actors = new Map<number, Actor>()
  private meta = new Map<number, ActorMeta>()
  private meId = 0
  private myTeam = 0
  private fp: FirstPerson | null = null
  private projectiles = new Map<number, THREE.Object3D>()
  private traps = new Map<number, THREE.Object3D>()
  private zones = new Map<number, { obj: THREE.Object3D; kind: string }>()
  private weather: THREE.Points | null = null
  private weatherVel: Float32Array | null = null
  private seagulls: THREE.Object3D[] = []
  private seagullMixers: THREE.AnimationMixer[] = []
  private truck: THREE.Object3D | null = null
  private mowerRide: THREE.Object3D | null = null
  private snowy = false
  private time = 0
  private koTilt = 0
  private landDip = 0
  private lastGround = true
  private lastY = 0
  private fovBase: number
  private fovK = 0
  private blowerUntil = 0
  private blowerYaw = 0
  private blowerPos = new THREE.Vector3()
  private rain = false
  cine: { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number } | null = null
  shakeOn = true
  /** The local player's look (set by the game each frame). */
  look: CameraState = { yaw: 0, pitch: 0 }
  mapId: MapId = 'culdesac'
  lastDt = 1 / 60

  constructor(container: HTMLElement, assets: LawnAssets, quality: Quality, opts: ViewOptions) {
    this.container = container
    this.assets = assets
    this.quality = quality
    this.fovBase = opts.fov
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias && !quality.post, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve, stencil: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.dpr))
    this.renderer.shadowMap.enabled = quality.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.domElement.className = 'lawn-canvas'
    container.appendChild(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(opts.fov, 1, 0.05, 400)
    this.scene.add(this.camera)
    this.sun = new THREE.DirectionalLight('#fff2cc', 3)
    this.sun.castShadow = quality.shadows
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 220
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.025
    this.sun.shadow.radius = quality.shadowRadius
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -quality.shadowExtent
    sc.right = sc.top = quality.shadowExtent
    sc.updateProjectionMatrix()
    this.scene.add(this.sun, this.sun.target)
    this.hemi = new THREE.HemisphereLight('#e6f2ff', '#b8a98a', 0.4)
    this.scene.add(this.hemi)
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMaterial())
    this.sky.renderOrder = -10
    this.sky.frustumCulled = false
    this.scene.add(this.sky)
    this.fx = new Fx(quality.particles, quality.chunks * 14, (x, z, y) => this.floorAt(x, z, y))
    this.scene.add(this.fx.group)
    this.ready = quality.post
      ? makePost(this.renderer, this.scene, this.camera, this.mood, { msaa: quality.msaa, ao: quality.aoSamples > 0, aoSamples: Math.max(4, quality.aoSamples) })
          .then((post) => {
            this.post = post
            post.setMood(this.mood)
            this.resize()
          })
          .catch(() => {
            // No post stack: plain tone-mapped rendering.
          })
      : Promise.resolve()
    this.resize()
  }

  private floorAt(x: number, z: number, y: number) {
    void x
    void z
    void y
    return 0
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.post?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /* ---------- world ---------- */

  setWorld(mapId: MapId, time: TimeOfDay, pieces: Piece[], houseThemes: [HouseTheme, HouseTheme], floorAt: (x: number, z: number, y: number) => number, mood?: Mood) {
    this.mapId = mapId
    const map = MAPS[mapId]
    const theme = map.theme[time]
    const m = mood ?? moodFor(mapId, time, 0)
    this.mood = m
    this.snowy = theme.snow
    ;(this.fx as unknown as { floorAt: typeof floorAt }).floorAt = floorAt
    if (this.world) {
      this.scene.remove(this.world.group)
      this.world.dispose()
    }
    this.world = new World(this.assets, map, theme, houseThemes, m, this.quality)
    this.world.addPieces(pieces)
    this.scene.add(this.world.group)
    this.applyMood(m)
    this.setWeather(this.snowy ? 'snow' : 'none')
    for (const a of this.actors.values()) a.dispose()
    this.actors.clear()
    for (const p of this.projectiles.values()) this.scene.remove(p)
    this.projectiles.clear()
    for (const t of this.traps.values()) this.scene.remove(t)
    this.traps.clear()
    for (const z of this.zones.values()) this.scene.remove(z.obj)
    this.zones.clear()
  }

  /** Sky, image-based light, sun, fill, fog, exposure and grade for a mood. */
  private applyMood(m: Mood) {
    applySky(this.sky.material, m)
    this.env?.dispose()
    this.env = bakeEnvironment(this.renderer, m, m.snow ? '#dfe7ef' : '#6c7858')
    this.scene.environment = this.env
    this.scene.environmentIntensity = m.envIntensity
    this.scene.fog = new THREE.Fog(m.fog, m.fogNear, m.fogFar)
    this.scene.background = new THREE.Color(m.fog)
    this.sunDir.copy(sunDirection(m))
    this.sun.color.set(m.sunColour)
    this.sun.intensity = m.sunIntensity
    this.hemi.color.set(m.hemiSky)
    this.hemi.groundColor.set(m.hemiGround)
    this.hemi.intensity = m.hemiIntensity
    // Without interior lamps (low quality by day) rooms take more of the sky light so they never go murky.
    indoorAmbient.value = this.quality.lamps > 0 ? m.indoor : Math.max(m.indoor, 0.9)
    this.renderer.toneMappingExposure = this.post ? 1 : m.exposure
    this.post?.setMood(m)
    this.placeSun()
  }

  /** Keep the sun's shadow box centred a little ahead of the camera, snapped to shadow texels so edges do not crawl. */
  private placeSun() {
    const cam = this.camera
    const ext = this.quality.shadowExtent
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1)
    fwd.normalize()
    const map = MAPS[this.mapId]
    const focus = new THREE.Vector3(cam.position.x + fwd.x * ext * 0.45, 0, cam.position.z + fwd.z * ext * 0.45)
    focus.x = Math.max(-10, Math.min(map.w + 10, focus.x))
    focus.z = Math.max(-10, Math.min(map.h + 10, focus.z))
    const d = this.sunDir
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize()
    const up = new THREE.Vector3().crossVectors(d, right)
    const texel = (2 * ext) / this.quality.shadowMapSize
    const r = Math.round(focus.dot(right) / texel) * texel
    const u = Math.round(focus.dot(up) / texel) * texel
    const along = focus.dot(d)
    focus.copy(right).multiplyScalar(r).addScaledVector(up, u).addScaledVector(d, along)
    this.sun.target.position.copy(focus)
    this.sun.position.copy(focus).addScaledVector(d, 110)
    this.sun.target.updateMatrixWorld()
  }

  setRoster(meta: Map<number, ActorMeta>, meId: number, myTeam: number) {
    this.meta = meta
    this.meId = meId
    this.myTeam = myTeam
    if (this.fp) {
      this.camera.remove(this.fp.group)
      this.fp.dispose()
    }
    const me = meta.get(meId)
    this.fp = me ? new FirstPerson(this.assets, me.hero, me.colour, me.team) : null
    if (this.fp) this.camera.add(this.fp.group)
  }

  setFov(f: number) {
    this.fovBase = f
  }

  /* ---------- weather ---------- */

  setWeather(kind: 'none' | 'snow' | 'rain') {
    if (this.weather) {
      this.scene.remove(this.weather)
      this.weather.geometry.dispose()
      ;(this.weather.material as THREE.Material).dispose()
      this.weather = null
    }
    this.rain = kind === 'rain'
    if (kind === 'none') return
    const n = this.quality.weather
    const pos = new Float32Array(n * 3)
    const vel = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40
      pos[i * 3 + 1] = Math.random() * 20
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40
      vel[i] = kind === 'snow' ? 0.8 + Math.random() * 1.2 : 9 + Math.random() * 4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({ color: kind === 'snow' ? '#ffffff' : '#bcd8ff', size: kind === 'snow' ? 0.14 : 0.06, map: dot(), alphaTest: 0.2, transparent: true, opacity: kind === 'snow' ? 0.95 : 0.6, depthWrite: false, sizeAttenuation: true })
    this.weather = new THREE.Points(geo, mat)
    this.weather.frustumCulled = false
    this.weatherVel = vel
    this.scene.add(this.weather)
  }

  private updateWeather(dt: number) {
    if (!this.weather || !this.weatherVel) return
    const pos = this.weather.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const cx = this.camera.position.x
    const cz = this.camera.position.z
    const n = this.weatherVel.length
    const drift = this.snowy ? Math.sin(this.time * 0.5) * 0.4 : 0.2
    const houses = MAPS[this.mapId].houses
    for (let i = 0; i < n; i++) {
      arr[i * 3 + 1] -= this.weatherVel[i] * dt
      arr[i * 3] += drift * dt
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 18 + Math.random() * 4
        arr[i * 3] = cx + (Math.random() - 0.5) * 40
        arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 40
      }
      if (Math.abs(arr[i * 3] - cx) > 22) arr[i * 3] = cx + (Math.random() - 0.5) * 40
      if (Math.abs(arr[i * 3 + 2] - cz) > 22) arr[i * 3 + 2] = cz + (Math.random() - 0.5) * 40
      // No snow or rain indoors: flakes that drift under a roof start again up in the sky.
      if (arr[i * 3 + 1] < 9.8)
        for (const h of houses) {
          const lx = (arr[i * 3] - h.ox) * h.dir
          const lz = (arr[i * 3 + 2] - h.oz) * h.dir
          if (lx > -6.6 && lx < 10.6 && lz > -5.2 && lz < 5.2 && (lx < 6.2 || arr[i * 3 + 1] < 4.8)) {
            arr[i * 3 + 1] = 18 + Math.random() * 4
            break
          }
        }
    }
    pos.needsUpdate = true
  }

  /* ---------- per-frame ---------- */

  render(snap: Snap, events: SimEvent[], dt: number, hud: { alive: boolean; onGround: boolean; sprinting: boolean; moving: boolean; blocking: boolean; crouch: boolean; drawing: number; eye: number; riding: boolean; ladder: boolean; glide: boolean; me: { x: number; y: number; z: number } | null }) {
    this.time += dt
    this.lastDt = dt
    for (const e of events) this.event(e, snap)
    this.syncPlayers(snap, dt)
    this.syncProjectiles(snap)
    this.syncTraps(snap)
    this.syncZones(snap, dt)
    this.syncChaos(snap, dt)
    this.fx.update(dt)
    this.fp?.update(dt, hud.moving, hud.sprinting, hud.blocking, hud.drawing, hud.ladder)
    if (this.fp) this.fp.group.visible = hud.alive && !this.cine && !hud.riding
    this.updateWeather(dt)
    if (this.blowerUntil > this.time) {
      const dir = new THREE.Vector3(Math.sin(this.blowerYaw), 0.1, Math.cos(this.blowerYaw))
      for (let i = 0; i < 2; i++) this.fx.wind(this.blowerPos.x + dir.x * (1 + Math.random() * 2), this.blowerPos.y + 1 + Math.random(), this.blowerPos.z + dir.z * (1 + Math.random() * 2), dir)
    }
    this.placeCamera(hud, dt)
    this.placeSun()
    this.sky.position.copy(this.camera.position)
    this.sky.material.uniforms.uTime.value = this.time
    if (this.post) this.post.render(dt)
    else this.renderer.render(this.scene, this.camera)
  }

  private placeCamera(hud: Parameters<LawnView['render']>[3], dt: number) {
    const cam = this.camera
    if (this.cine) {
      cam.position.set(this.cine.x, this.cine.y, this.cine.z)
      cam.rotation.set(0, 0, 0, 'YXZ')
      cam.rotation.y = this.cine.yaw + Math.PI
      cam.rotation.x = this.cine.pitch
      cam.fov = this.cine.fov ?? this.fovBase
      cam.updateProjectionMatrix()
      return
    }
    const me = hud.me
    if (!me) return
    // Landing dip and KO tumble.
    if (hud.onGround && !this.lastGround) this.landDip = Math.min(0.25, Math.max(0.05, (this.lastY - me.y) * 0.08))
    this.lastGround = hud.onGround
    if (!hud.onGround && me.y > this.lastY) this.lastY = me.y
    if (hud.onGround) this.lastY = me.y
    this.landDip = Math.max(0, this.landDip - dt * 1.2)
    this.koTilt += ((hud.alive ? 0 : 1) - this.koTilt) * Math.min(1, 4 * dt)
    const eye = hud.alive ? hud.eye * (hud.crouch ? 0.6 : 1) : 0.35
    const bob = hud.moving && hud.onGround && hud.alive ? Math.sin(this.time * (hud.sprinting ? 13 : 9)) * (hud.sprinting ? 0.045 : 0.025) : 0
    const shake = this.shakeOn ? this.fx.shake : 0
    const sx = (Math.random() - 0.5) * shake * 0.12
    const sy = (Math.random() - 0.5) * shake * 0.12
    cam.position.set(me.x + sx, me.y + eye + bob - this.landDip + sy, me.z)
    cam.rotation.set(0, 0, 0, 'YXZ')
    cam.rotation.y = this.look.yaw + Math.PI
    cam.rotation.x = this.look.pitch - this.koTilt * 0.5 + (Math.random() - 0.5) * shake * 0.03
    cam.rotation.z = this.koTilt * 0.6 + Math.sin(this.time * 9) * (hud.moving && hud.alive ? 0.006 : 0) + (hud.glide ? Math.sin(this.time * 2) * 0.05 : 0)
    const targetFov = this.fovBase + (hud.sprinting ? 6 : 0) + (hud.riding ? 10 : 0) + this.fovK
    cam.fov += (targetFov - cam.fov) * Math.min(1, 8 * dt)
    cam.updateProjectionMatrix()
    this.fovK = Math.max(0, this.fovK - dt * 30)
  }

  /* ---------- players ---------- */

  private syncPlayers(snap: Snap, dt: number) {
    const seen = new Set<number>()
    for (const r of snap.p) {
      const id = r[0]
      seen.add(id)
      let meta = this.meta.get(id)
      if (!meta) {
        if (!(r[8] & PF.robot)) continue
        meta = { name: 'Robot', hero: 'dog', team: 1, colour: '#8fa3b8', human: false, robot: true }
        this.meta.set(id, meta)
      }
      let a = this.actors.get(id)
      if (!a) {
        a = new Actor(this.assets, meta, this.myTeam)
        this.actors.set(id, a)
        this.scene.add(a.group)
      }
      const f = r[8]
      const alive = !!(f & PF.alive)
      const tool = r[13] ? TOOL_KINDS[r[13] - 1] : null
      a.update(dt, { x: r[1], y: r[2], z: r[3], yaw: r[4], pitch: r[5], hp: r[6], maxHp: r[7], anim: r[9], moving: !!(f & PF.moving), alive, blocking: !!(f & PF.block), stunned: !!(f & PF.stun), onLadder: !!(f & PF.ladder), riding: !!(f & PF.riding), tool }, id === this.meId, !!this.cine)
      a.group.visible = id !== this.meId || !alive || !!this.cine
      // Status particles.
      if (alive) {
        if (f & PF.burn && Math.random() < 0.5) this.fx.fire(r[1] + (Math.random() - 0.5) * 0.4, r[2] + 0.6 + Math.random(), r[3] + (Math.random() - 0.5) * 0.4, 1)
        if (f & PF.wet && Math.random() < 0.2) this.fx.water(r[1], r[2] + 0.8, r[3], 1)
        if (f & PF.riding && this.mowerRide) {
          this.mowerRide.position.set(r[1] + Math.sin(r[4]) * 0.5, r[2], r[3] + Math.cos(r[4]) * 0.5)
          this.mowerRide.rotation.y = r[4]
          if (Math.random() < 0.6) this.fx.dust(r[1] - Math.sin(r[4]), r[2] + 0.2, r[3] - Math.cos(r[4]), '#6fb14a', 2)
        }
      }
      if (id === this.meId && this.fp) this.fp.setTool(tool)
    }
    for (const [id, a] of this.actors)
      if (!seen.has(id)) {
        a.dispose()
        this.actors.delete(id)
      }
    const anyRiding = snap.p.some((r) => r[8] & PF.riding)
    if (!anyRiding && this.mowerRide) {
      this.scene.remove(this.mowerRide)
      this.mowerRide = null
    }
  }

  /* ---------- projectiles ---------- */

  private makeProjectile(kind: string): THREE.Object3D {
    const sphere = (r: number, colour: string) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.6 }))
    switch (kind) {
      case 'balloon': {
        const m = sphere(0.16, ['#ff5a5a', '#5ab1ff', '#7fe07f', '#ffd23b'][Math.floor(Math.random() * 4)])
        m.scale.set(1, 1.2, 1)
        return m
      }
      case 'gnome':
        return instance(this.assets, 'gnome') ?? sphere(0.2, '#d33')
      case 'egg': {
        const m = sphere(0.09, '#fff6e0')
        m.scale.set(1, 1.3, 1)
        return m
      }
      case 'paint': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 10), new THREE.MeshStandardMaterial({ color: '#d9d9d9', metalness: 0.4, roughness: 0.4 }))
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), new THREE.MeshStandardMaterial({ color: '#e0533d' }))
        lid.position.y = 0.12
        m.add(lid)
        return m
      }
      case 'jar': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.26, 10), new THREE.MeshStandardMaterial({ color: '#f2c57c', roughness: 0.5 }))
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 10), new THREE.MeshStandardMaterial({ color: '#8b5a2b' }))
        lid.position.y = 0.15
        m.add(lid)
        return m
      }
      case 'golfball':
        return sphere(0.06, '#ffffff')
      case 'pebble':
        return sphere(0.05, '#8a8a8a')
      case 'rccar': {
        const c = instance(this.assets, 'rccar') ?? sphere(0.3, '#e0533d')
        return c
      }
      case 'towtruck': {
        const t = instance(this.assets, 'towtruck')
        if (t) return t
        const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 5.5), new THREE.MeshStandardMaterial({ color: '#f2b53d' }))
        m.position.y = 1.2
        return m
      }
      case 'icecream': {
        const g = new THREE.Group()
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 8), new THREE.MeshStandardMaterial({ color: '#d9a35a' }))
        cone.rotation.x = Math.PI
        cone.position.y = 0.15
        const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffb6d9' }))
        scoop.position.y = 0.36
        g.add(cone, scoop)
        return g
      }
      default:
        return sphere(0.1, '#ccc')
    }
  }

  private syncProjectiles(snap: Snap) {
    const seen = new Set<number>()
    for (const r of snap.pr) {
      const id = r[0]
      seen.add(id)
      const kind = PROJ_KINDS[r[1]]
      let o = this.projectiles.get(id)
      if (!o) {
        o = this.makeProjectile(kind)
        o.traverse((c) => {
          c.castShadow = this.quality.shadows
        })
        this.projectiles.set(id, o)
        this.scene.add(o)
      }
      o.position.set(r[2], r[3], r[4])
      if (kind === 'towtruck' || kind === 'rccar') {
        o.rotation.y = r[5]
        if (kind === 'towtruck' && Math.random() < 0.8) this.fx.dust(r[2] - Math.sin(r[5]) * 2.5, r[3] + 0.3, r[4] - Math.cos(r[5]) * 2.5, '#8a8a8a', 2)
        if (kind === 'rccar' && Math.random() < 0.6) this.fx.sparks(r[2], r[3] + 0.2, r[4], 1)
      } else if (kind === 'icecream') o.rotation.y = this.time
      else {
        o.rotation.x += 0.2
        o.rotation.z += 0.13
      }
    }
    for (const [id, o] of this.projectiles)
      if (!seen.has(id)) {
        this.scene.remove(o)
        this.projectiles.delete(id)
      }
  }

  /* ---------- traps and zones ---------- */

  private makeTrap(kind: string, yaw: number) {
    const g = new THREE.Group()
    g.rotation.y = yaw
    const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })
    switch (kind) {
      case 'beartrap': {
        const t = instance(this.assets, 'beartrap')
        if (t) g.add(t)
        else {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 20), mat('#555'))
          ring.rotation.x = Math.PI / 2
          ring.position.y = 0.04
          g.add(ring)
        }
        break
      }
      case 'rake': {
        const r = instance(this.assets, 'rake')
        if (r) {
          r.rotation.x = -Math.PI / 2 + 0.08
          r.position.y = 0.03
          g.add(r)
        } else {
          const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), mat('#b98a55'))
          handle.rotation.x = Math.PI / 2
          handle.position.set(0, 0.03, -0.3)
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.08), mat('#444'))
          head.position.set(0, 0.03, 0.4)
          g.add(handle, head)
        }
        break
      }
      case 'marbles': {
        for (let i = 0; i < 14; i++) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshStandardMaterial({ color: ['#4af', '#f66', '#6f6', '#fd4'][i % 4], roughness: 0.2 }))
          const a = Math.random() * Math.PI * 2
          const r = Math.random() * 0.6
          m.position.set(Math.cos(a) * r, 0.035, Math.sin(a) * r)
          g.add(m)
        }
        break
      }
      case 'alarm': {
        for (let i = 0; i < 5; i++) {
          const can = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), new THREE.MeshStandardMaterial({ color: '#c9c9c9', metalness: 0.5, roughness: 0.3 }))
          can.position.set(-0.5 + i * 0.25, 0.3 + (i % 2) * 0.05, 0)
          g.add(can)
        }
        const string = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.01, 0.01), mat('#eee'))
        string.position.y = 0.38
        g.add(string)
        break
      }
      case 'sprinkler': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8), mat('#2a7f3f'))
        base.position.y = 0.15
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), mat('#ddd'))
        head.position.y = 0.32
        g.add(base, head)
        break
      }
      case 'pit': {
        const matp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.6), new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 1 }))
        matp.position.y = 0.015
        const txt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.032, 0.12), mat('#f4e6c8'))
        txt.position.y = 0.016
        g.add(matp, txt)
        break
      }
    }
    return g
  }

  private syncTraps(snap: Snap) {
    const seen = new Set<number>()
    for (const r of snap.tr) {
      const id = r[0]
      seen.add(id)
      const team = r[5]
      const revealed = !!r[7]
      const visible = team === this.myTeam || revealed || this.cine !== null
      let o = this.traps.get(id)
      if (!o) {
        o = this.makeTrap(TRAP_KINDS[r[1]], r[8])
        o.position.set(r[2], r[3], r[4])
        this.traps.set(id, o)
        this.scene.add(o)
        if (team !== this.myTeam && revealed) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 24), new THREE.MeshBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.8, depthWrite: false }))
          ring.rotation.x = -Math.PI / 2
          ring.position.y = 0.03
          o.add(ring)
        }
      }
      o.visible = visible
      const armed = !!r[6]
      o.scale.setScalar(armed ? 1 : 0.85)
      // Sprinkler spray while armed.
      if (TRAP_KINDS[r[1]] === 'sprinkler' && armed && Math.random() < 0.5 && visible) this.fx.water(r[2], r[3] + 0.35, r[4], 2)
    }
    for (const [id, o] of this.traps)
      if (!seen.has(id)) {
        this.scene.remove(o)
        this.traps.delete(id)
      }
  }

  private syncZones(snap: Snap, dt: number) {
    void dt
    const seen = new Set<number>()
    for (const r of snap.zn) {
      const id = r[0]
      seen.add(id)
      const kind = ZONE_KINDS[r[1]]
      let z = this.zones.get(id)
      if (!z) {
        let obj: THREE.Object3D
        if (kind === 'cookies') {
          const g = new THREE.Group()
          const tray = instance(this.assets, 'tray')
          if (tray) g.add(tray)
          for (let i = 0; i < 10; i++) {
            const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), new THREE.MeshStandardMaterial({ color: '#b5651d', roughness: 0.9, emissive: '#ff5a1a', emissiveIntensity: 0.6 }))
            const a = (i / 10) * Math.PI * 2
            c.position.set(Math.cos(a) * 0.3 * (1 + (i % 3)), 0.06, Math.sin(a) * 0.3 * (1 + (i % 3)))
            g.add(c)
          }
          const disc = new THREE.Mesh(new THREE.CircleGeometry(r[5], 32), new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.18, depthWrite: false }))
          disc.rotation.x = -Math.PI / 2
          disc.position.y = 0.02
          g.add(disc)
          obj = g
        } else {
          const disc = new THREE.Mesh(new THREE.CircleGeometry(r[5], 24), new THREE.MeshBasicMaterial({ color: kind === 'sticky' ? '#8a5a2b' : '#4aa3ff', transparent: true, opacity: kind === 'sticky' ? 0.7 : 0.35, depthWrite: false }))
          disc.rotation.x = -Math.PI / 2
          disc.position.y = 0.02
          obj = disc
        }
        obj.position.set(r[2], r[3], r[4])
        this.scene.add(obj)
        z = { obj, kind }
        this.zones.set(id, z)
      }
      if (kind === 'cookies' && Math.random() < 0.7) this.fx.fire(r[2] + (Math.random() - 0.5) * r[5] * 1.4, r[3] + 0.1, r[4] + (Math.random() - 0.5) * r[5] * 1.4, 1)
    }
    for (const [id, z] of this.zones)
      if (!seen.has(id)) {
        this.scene.remove(z.obj)
        this.zones.delete(id)
      }
  }

  /* ---------- chaos ---------- */

  private syncChaos(snap: Snap, dt: number) {
    const kind = snap.chaos ? CHAOS_KINDS[snap.chaos - 1] : null
    if (kind === 'seagulls') {
      if (!this.seagulls.length) {
        for (let i = 0; i < 6; i++) {
          const s = instance(this.assets, 'seagull')
          const obj = s ?? new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 5), new THREE.MeshStandardMaterial({ color: '#fff' }))
          this.scene.add(obj)
          this.seagulls.push(obj)
          const clips = this.assets.clips.get('seagull')
          if (s && clips?.length) {
            const mixer = new THREE.AnimationMixer(s)
            mixer.clipAction(clips[0]).play()
            this.seagullMixers.push(mixer)
          }
        }
      }
      const cx = MAPS[this.mapId].w / 2
      const cz = MAPS[this.mapId].h / 2
      this.seagulls.forEach((s, i) => {
        const a = this.time * 0.9 + (i / 6) * Math.PI * 2
        const r = 14 + i * 2
        s.position.set(cx + Math.cos(a) * r, 7 + Math.sin(this.time * 2 + i) * 1.5, cz + Math.sin(a) * r)
        s.rotation.y = -a - Math.PI / 2
      })
      for (const m of this.seagullMixers) m.update(dt)
    } else if (this.seagulls.length) {
      for (const s of this.seagulls) this.scene.remove(s)
      this.seagulls = []
      this.seagullMixers = []
    }
    if (kind === 'icecream') {
      if (!this.truck) {
        this.truck = instance(this.assets, 'icecream') ?? new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#ffe3f0' }))
        this.scene.add(this.truck)
      }
      this.truck.position.set(snap.chaosX, 0, 32)
      this.truck.rotation.y = Math.PI / 2
    } else if (this.truck) {
      this.scene.remove(this.truck)
      this.truck = null
    }
    if (kind === 'rain' && !this.rain && !this.snowy) this.setWeather('rain')
    if (kind !== 'rain' && this.rain) this.setWeather(this.snowy ? 'snow' : 'none')
  }

  /* ---------- events ---------- */

  private event(e: SimEvent, snap: Snap) {
    const fx = this.fx
    const w = this.world
    switch (e.t) {
      case 'chip': {
        const colour = w?.colourOf(e.id) ?? '#b9a98f'
        const v = w?.views.get(e.id)
        if (v?.piece.model === 'window') fx.glass(e.x, e.y, e.z, 8)
        else {
          fx.sparks(e.x, e.y, e.z, 10)
          fx.splinters(e.x, e.y, e.z, colour, 5)
        }
        w?.setChip(e.id, e.chip)
        if (Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z) < 4) fx.shake = Math.max(fx.shake, 0.25)
        break
      }
      case 'break': {
        const v = w?.remove(e.id)
        if (v) {
          const p = v.piece
          const chunks = this.quality.chunks
          if (p.model === 'window') fx.glass(e.x, e.y, e.z, 30)
          else fx.fracture(p.x, p.y, p.z, Math.min(p.w, 4), Math.min(p.h, 4), Math.min(p.d, 4), v.colour, chunks, e.x, e.y, e.z)
          fx.dust(e.x, e.y, e.z, '#c9b89a', 10)
          fx.sparks(e.x, e.y, e.z, 12)
          if (e.value > 0) {
            fx.number(e.x, e.y + 0.8, e.z, `+${e.value}`, e.team === this.myTeam ? '#ffe24a' : '#ff6a6a', 1.6)
            fx.ring(e.x, p.y, e.z, e.team === this.myTeam ? '#ffe24a' : '#ff6a6a', 4, 0.6)
          }
          if (Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z) < 6) fx.shake = Math.max(fx.shake, 0.6)
        }
        break
      }
      case 'hit': {
        const mine = e.id === this.meId
        if (e.blocked) fx.sparks(e.x, e.y, e.z, 6)
        else {
          fx.number(e.x, e.y + 0.5, e.z, String(Math.round(e.dmg)), mine ? '#ff6a6a' : '#fff1a8', mine ? 1.2 : 1)
          fx.sparks(e.x, e.y, e.z, 5)
          if (e.heavy) fx.ring(e.x, e.y - 0.8, e.z, '#ffffff', 1.5, 0.3)
        }
        if (mine) {
          fx.shake = Math.max(fx.shake, e.heavy ? 0.7 : 0.35)
          fx.flash = Math.max(fx.flash, e.heavy ? 0.8 : 0.4)
        } else if (e.by === this.meId) this.fp?.hit()
        break
      }
      case 'parry':
        fx.ring(e.x, e.y - 0.5, e.z, '#8fd8ff', 2.5, 0.4)
        fx.sparks(e.x, e.y, e.z, 20)
        break
      case 'swing':
        if (e.id === this.meId) this.fp?.startSwing(e.heavy)
        break
      case 'throw':
        if (e.id === this.meId) this.fp?.startThrow()
        break
      case 'splash': {
        const t = THROWABLES[e.kind as keyof typeof THROWABLES]
        const colour = e.kind === 'paint' ? ['#e0533d', '#2f6fdd', '#8fd14f', '#f2b53d'][Math.floor(Math.random() * 4)] : e.kind === 'egg' ? '#ffe9a8' : e.kind === 'jar' ? '#c98a4b' : '#5ab1ff'
        if (e.kind === 'balloon') fx.water(e.x, e.y, e.z, 30)
        else if (e.kind === 'paint' || e.kind === 'egg' || e.kind === 'jar') fx.paint(e.x, e.y, e.z, colour, 24)
        else if (e.kind === 'gnome') {
          fx.splinters(e.x, e.y, e.z, '#d33', 12)
          fx.dust(e.x, e.y, e.z)
        } else fx.sparks(e.x, e.y, e.z, 4)
        if (t && t.splash > 0 && e.kind !== 'balloon') {
          const n = this.surfaceNormal(e.x, e.y, e.z)
          fx.decal(e.x, e.y, e.z, n.x, n.y, n.z, colour, 0.8 + t.splash * 0.4)
        }
        if (e.kind === 'balloon') fx.decal(e.x, Math.max(0.01, e.y), e.z, 0, 1, 0, '#4a9fe0', 1.4)
        break
      }
      case 'trap':
        if (e.team === this.myTeam) fx.ring(e.x, e.y, e.z, '#ffe24a', 1.5, 0.4)
        break
      case 'trip': {
        fx.ring(e.x, e.y, e.z, '#ff5a4a', 2.5, 0.5)
        if (e.kind === 'marbles' || e.kind === 'rake') {
          const a = this.actors.get(e.victim)
          if (a) fx.koStars(() => (a.alive ? a.headPos() : null), 1.6)
        }
        if (e.kind === 'pit') fx.dust(e.x, e.y, e.z, '#9a8a6a', 14)
        break
      }
      case 'ladder':
        fx.dust(e.x, e.y, e.z, '#c9b89a', 6)
        break
      case 'barricade':
        w?.setBarricade(e.id, e.level)
        fx.splinters(e.x, e.y + 1, e.z, '#c9a36b', 8)
        break
      case 'ko': {
        const a = this.actors.get(e.id)
        if (a) fx.koStars(() => a.headPos())
        fx.ring(e.x, e.y, e.z, '#ffffff', 2, 0.5)
        if (e.id === this.meId) {
          fx.shake = Math.max(fx.shake, 1)
          fx.flash = Math.max(fx.flash, 1)
        }
        break
      }
      case 'respawn':
        if (e.id === this.meId) this.koTilt = 0
        fx.ring(e.x, e.y, e.z, teamColour(this.meta.get(e.id)?.team ?? 0), 2.5, 0.6)
        break
      case 'ult':
        this.ultFx(e.kind, e.x, e.y, e.z, e.yaw, e.id)
        break
      case 'explode':
        fx.smoke(e.x, e.y + 0.3, e.z, 24)
        fx.ring(e.x, e.y, e.z, '#ffb347', e.r * 1.5, 0.5)
        fx.shake = Math.max(fx.shake, Math.hypot(e.x - this.camera.position.x, e.z - this.camera.position.z) < 10 ? 1 : 0.4)
        break
      case 'score':
        break
      case 'pickup':
        w?.setCarried(e.piece, true)
        break
      case 'drop':
        w?.setCarried(e.piece, false)
        w?.move(e.piece, e.x, e.y, e.z, e.yaw)
        break
      case 'seagull': {
        const a = this.actors.get(e.victim)
        const p = a ? a.headPos() : null
        if (p) fx.feathers(p.x, p.y, p.z)
        if (e.victim === this.meId && !e.stole) fx.flash = Math.max(fx.flash, 0.6)
        break
      }
      case 'alarm':
        fx.ring(e.x, 0.05, e.z, '#ff5a4a', 6, 1.2)
        break
      case 'heal': {
        const a = this.actors.get(e.id)
        if (a) fx.number(a.x, a.y + 1.6, a.z, `+${e.amount}`, '#8fe38f')
        break
      }
      default:
        break
    }
    void snap
  }

  private ultFx(kind: UltKind, x: number, y: number, z: number, yaw: number, id: number) {
    const fx = this.fx
    switch (kind) {
      case 'cookies':
        fx.smoke(x, y + 0.5, z, 10)
        fx.ring(x, y, z, '#ff7a1a', 3.6, 0.6)
        break
      case 'blower':
        this.actors.get(id)?.flash('blower', 1.6)
        if (id === this.meId) this.fp?.flash('blower', 1.6)
        this.blowerUntil = this.time + 1.6
        this.blowerYaw = yaw
        this.blowerPos.set(x, y, z)
        break
      case 'rccar':
        fx.sparks(x, y + 0.3, z, 6)
        break
      case 'towtruck':
        fx.shake = Math.max(fx.shake, 0.5)
        break
      case 'mower': {
        this.mowerRide = instance(this.assets, 'mower-ride') ?? instance(this.assets, 'mower')
        if (this.mowerRide) this.scene.add(this.mowerRide)
        fx.smoke(x, y + 0.3, z, 8)
        if (id === this.meId) this.fovK = 12
        break
      }
      case 'zoomies':
        fx.ring(x, y, z, '#ffe24a', 3, 0.4)
        fx.dust(x, y + 0.2, z, '#c9b89a', 12)
        if (id === this.meId) this.fovK = 14
        break
    }
  }

  private surfaceNormal(x: number, y: number, z: number) {
    // Nearest axis-aligned face of whatever piece is at the point: approximate from the camera direction.
    const dx = this.camera.position.x - x
    const dz = this.camera.position.z - z
    if (y < 0.15) return new THREE.Vector3(0, 1, 0)
    return Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz))
  }

  /* ---------- test hooks ---------- */

  snapshotUrl() {
    return this.renderer.domElement.toDataURL('image/png')
  }

  actorOf(id: number) {
    return this.actors.get(id)
  }

  heroOf(id: number): HeroId | undefined {
    return this.meta.get(id)?.hero
  }

  dispose() {
    for (const a of this.actors.values()) a.dispose()
    this.fp?.dispose()
    this.fx.dispose()
    this.world?.dispose()
    this.post?.dispose()
    this.env?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

export { findClip }
export type { ToolKind }
