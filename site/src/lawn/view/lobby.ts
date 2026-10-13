// The lobby's live previews: one small shared WebGL canvas that moves between the "Your house" turntable and the
// hero sheet. The house is built by the same code as a match (buildHouse + the World piece views, so the kit, the
// tiling siding/brick/shingle textures, the furniture and the valuables all match), set on a little lawn diorama
// with glowing markers over the valuables and an optional cutaway. The hero is the match's Actor playing its idle
// with an occasional swing or dance. It renders only while attached, on screen and in a visible tab, and frees its
// GPU resources on dispose.
import * as THREE from 'three'
import { instance, type LawnAssets } from '../engine/assets'
import { HEROES, type HeroId } from '../engine/heroes'
import { buildHouse, type LayoutId } from '../engine/houses'
import { MAPS, type MapInfo } from '../engine/maps'
import type { Piece } from '../engine/pieces'
import type { HouseTheme } from '../engine/progress'
import type { Quality } from '../engine/quality'
import { Actor } from './actors'
import { World, texturesSettled } from './world'

export type LobbyMode = 'house' | 'hero'
export interface HouseSpec {
  theme: HouseTheme
  layout: LayoutId
  cutaway: boolean
}
export interface HeroSpec {
  hero: HeroId
  colour: string
}

/** Pieces that make up the outside shell of a floor (hidden in the cutaway). */
const SHELL = new Set(['wall', 'sill', 'window', 'door', 'header:window', 'header:door', 'header:frontdoor', 'garagedoor', 'header:garage'])
const ROOF = new Set(['roof', 'attic', 'parapet', 'garageroof'])
/** The house's footprint centre (main block x -6..6 plus the garage to x 10; balcony to z 6.5). */
const CX = 2
const CZ = 0.6
const GROUND = '#ff8a2b'
const UPSTAIRS = '#ffd93b'
/** Marker size as a fraction of the view height. */
const MARK = 0.058

const HERO_EMOTES = ['Sword_Attack', 'Dance_Loop', 'Punch_Cross']
const DOG_EMOTES = ['Jump', 'Idle_2', 'Eating']

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.22, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  // A dark ring keeps the dot readable over pale siding and snow.
  g.strokeStyle = 'rgba(42,26,10,0.85)'
  g.lineWidth = 2.5
  g.beginPath()
  g.arc(32, 32, 9.5, 0, Math.PI * 2)
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function blobTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

interface Marker {
  sprite: THREE.Sprite
  base: number
  phase: number
}

export class LobbyStage {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private assets: LawnAssets
  private quality: Quality
  /** Geometries and materials owned by the loaded models (shared with every instance; never disposed here). */
  private shared = new Set<unknown>()
  private owned: { dispose(): void }[] = []
  private host: HTMLElement | null = null
  private mode: LobbyMode = 'house'
  private onReady: (() => void) | null = null
  private raf = 0
  private last = 0
  private time = 0
  private visible = true
  private disposed = false
  private io: IntersectionObserver | null = null
  private ro: ResizeObserver | null = null
  private frozen: number | null = null

  // Pointer drag.
  private dragging = false
  private dragX = 0
  private spin = 0
  private idle = 10

  // House.
  private houseScene = new THREE.Scene()
  private houseCam = new THREE.PerspectiveCamera(30, 4 / 3, 0.5, 200)
  private pivot = new THREE.Group()
  private world: World | null = null
  private markers: Marker[] = []
  private markerGroup = new THREE.Group()
  private glow: THREE.CanvasTexture
  private houseKey = ''
  private cutaway = false
  private houseReady = false
  private houseYaw = -0.55
  private shell: { group: THREE.Object3D; nx: number; nz: number; floor: number }[] = []
  private roof: THREE.Object3D[] = []

  // Hero.
  private heroScene = new THREE.Scene()
  private heroCam = new THREE.PerspectiveCamera(26, 3 / 4, 0.1, 50)
  private actor: Actor | null = null
  private heroKey = ''
  private heroReady = false
  private heroYaw = 0
  private heroDrag = 0
  private emoteAt = 2.5
  private emoteIdx = 0
  private rim: THREE.DirectionalLight
  private row = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 1, maxHp: 1, anim: 0, moving: false, alive: true, blocking: false, stunned: false, onLadder: false, riding: false, tool: null }

  constructor(assets: LawnAssets, quality: Quality) {
    this.assets = assets
    this.quality = quality
    for (const m of assets.models.values())
      m.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        this.shared.add(mesh.geometry)
        for (const mm of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.shared.add(mm)
      })
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.shadowMap.enabled = quality.shadows
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.canvas = this.renderer.domElement
    this.canvas.className = 'lw-3dcanvas'
    this.canvas.addEventListener('pointerdown', this.onDown)
    this.canvas.addEventListener('pointermove', this.onMove)
    this.canvas.addEventListener('pointerup', this.onUp)
    this.canvas.addEventListener('pointercancel', this.onUp)
    document.addEventListener('visibilitychange', this.kick)
    this.glow = glowTexture()
    this.owned.push(this.glow)
    this.buildHouseStage()
    this.rim = this.buildHeroStage()
  }

  /* ---------- lifecycle ---------- */

  /** Show the canvas inside `host`, rendering `mode`. `onReady` fires after the first frame with content. */
  attach(host: HTMLElement, mode: LobbyMode, onReady: () => void) {
    if (this.disposed) return
    if (this.host && this.host !== host) this.detach(this.host)
    this.host = host
    this.mode = mode
    this.onReady = onReady
    this.idle = 10
    host.appendChild(this.canvas)
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.io = new IntersectionObserver((e) => {
      this.visible = e.some((x) => x.isIntersecting)
      this.kick()
    })
    this.io.observe(host)
    this.resize()
    this.kick()
  }

  detach(host: HTMLElement) {
    if (this.host !== host) return
    this.ro?.disconnect()
    this.io?.disconnect()
    this.ro = this.io = null
    this.canvas.remove()
    this.host = null
    this.onReady = null
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  dispose() {
    if (this.disposed) return
    if (this.host) this.detach(this.host)
    this.disposed = true
    document.removeEventListener('visibilitychange', this.kick)
    this.clearWorld()
    this.clearActor()
    for (const o of this.owned) o.dispose()
    this.owned = []
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }

  private resize() {
    if (!this.host) return
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h, false)
    for (const cam of [this.houseCam, this.heroCam]) {
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    }
    this.placeHouseCamera()
    this.placeHeroCamera()
  }

  private running() {
    return !!this.host && this.visible && !document.hidden && !this.disposed
  }

  private kick = () => {
    if (this.raf || !this.running()) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  private loop = (now: number) => {
    this.raf = 0
    if (!this.running()) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.frame(dt)
  }

  private frame(dt: number) {
    this.time += dt
    this.idle += dt
    const ready = this.mode === 'house' ? this.houseReady : this.heroReady
    if (!ready) return
    if (this.mode === 'house') this.tickHouse(dt)
    else this.tickHero(dt)
    this.renderer.render(this.mode === 'house' ? this.houseScene : this.heroScene, this.mode === 'house' ? this.houseCam : this.heroCam)
    if (this.onReady) {
      const cb = this.onReady
      this.onReady = null
      cb()
    }
  }

  /* ---------- pointer ---------- */

  private onDown = (e: PointerEvent) => {
    this.dragging = true
    this.dragX = e.clientX
    this.spin = 0
    this.canvas.setPointerCapture?.(e.pointerId)
  }
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return
    const dx = e.clientX - this.dragX
    this.dragX = e.clientX
    const k = 6 / Math.max(200, this.canvas.clientWidth)
    if (this.mode === 'house') this.houseYaw += dx * k
    else this.heroDrag += dx * k
    this.spin = (dx * k) / (1 / 60)
    this.idle = 0
  }
  private onUp = (e: PointerEvent) => {
    this.dragging = false
    this.idle = 0
    this.canvas.releasePointerCapture?.(e.pointerId)
  }

  /* ---------- the house ---------- */

  private buildHouseStage() {
    const s = this.houseScene
    const hemi = new THREE.HemisphereLight('#eef6ff', '#b9a98a', 1.25)
    const sun = new THREE.DirectionalLight('#fff2d6', 2.1)
    sun.position.set(14, 22, 16)
    sun.castShadow = this.quality.shadows
    sun.shadow.mapSize.set(1024, 1024)
    const sc = sun.shadow.camera
    sc.left = sc.bottom = -15
    sc.right = sc.top = 15
    sc.near = 5
    sc.far = 70
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.03
    sun.shadow.radius = 4
    const fill = new THREE.DirectionalLight('#cfe2ff', 0.55)
    fill.position.set(-16, 10, -8)
    s.add(hemi, sun, sun.target, fill)
    // Warm room lights so the cutaway reads.
    for (const [x, y, z] of [[-3, 2.5, 0], [4, 2.5, 0], [0, 5.7, 0]]) {
      const l = new THREE.PointLight('#fff1dc', 7, 9, 1.4)
      l.position.set(x - CX, y, z - CZ)
      this.pivot.add(l)
    }
    s.add(this.pivot)
    // The diorama: a round lawn on a soil plinth, with the front path, the driveway, a mailbox, gnomes and a hedge.
    const loader = new THREE.TextureLoader()
    const tex = (name: string, rep: number) => {
      const t = loader.load(`${import.meta.env.BASE_URL}lawn/textures/${name}.webp`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.colorSpace = THREE.SRGBColorSpace
      t.repeat.set(rep, rep)
      t.anisotropy = 4
      this.owned.push(t)
      return t
    }
    const R = 13.5
    const grass = new THREE.MeshStandardMaterial({ map: tex('grass', (2 * R) / 5), color: '#eaffdf', roughness: 1 })
    const soil = new THREE.MeshStandardMaterial({ color: '#6e4a2c', roughness: 1 })
    const plinthGeo = new THREE.CylinderGeometry(R, R - 0.3, 0.6, 64)
    const plinth = new THREE.Mesh(plinthGeo, [soil, grass, soil])
    plinth.position.y = -0.3
    plinth.receiveShadow = true
    const walkTex = tex('sidewalk', 1)
    const walk = (w: number, d: number, x: number, z: number, tint: string) => {
      const geo = new THREE.PlaneGeometry(w, d)
      geo.rotateX(-Math.PI / 2)
      // UVs in metres (the sidewalk texture tiles every 2 m).
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 2, (uv.getY(i) * d) / 2)
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: walkTex, color: tint, roughness: 1 }))
      m.position.set(x - CX, 0.012, z - CZ)
      m.receiveShadow = true
      this.owned.push(geo, m.material as THREE.Material)
      return m
    }
    const pathLen = Math.sqrt(R * R - 1.6) - 4.5 + CZ - 0.3
    const driveZ0 = 1.5
    const driveLen = Math.sqrt(R * R - 60) - driveZ0 + CZ - 0.2
    this.pivot.add(plinth, walk(1.4, pathLen, 0.75, 4.5 + pathLen / 2, '#ffffff'), walk(3.4, driveLen, 8, driveZ0 + driveLen / 2, '#e6e0d6'))
    this.owned.push(plinthGeo, grass, soil)
    const prop = (name: string, x: number, z: number, yaw = 0, scale = 1) => {
      const o = instance(this.assets, name)
      if (!o) return
      o.position.set(x - CX, 0, z - CZ)
      o.rotation.y = yaw
      o.scale.multiplyScalar(scale)
      o.traverse((c) => {
        c.castShadow = this.quality.shadows
        c.receiveShadow = true
      })
      this.pivot.add(o)
    }
    prop('mailbox', 2.4, 10.6)
    prop('gnome', -3, 8.6, 0.4)
    prop('gnome', 4.6, 7.8, -0.5)
    for (let i = 0; i < 3; i++) prop('bush', -6.4 + i, 7.2)
    prop('bush', 11.2, -3.5, 0.6, 1.2)
    prop('bush', -8.2, -2.5, 1.2, 1.1)
    this.markerGroup.renderOrder = 20
    this.pivot.add(this.markerGroup)
  }

  setHouse(spec: HouseSpec) {
    const key = `${spec.theme}|${spec.layout}`
    if (key !== this.houseKey) {
      this.houseKey = key
      this.buildWorld(spec)
    }
    if (spec.cutaway !== this.cutaway) {
      this.cutaway = spec.cutaway
      this.applyCutaway()
    }
  }

  private buildWorld(spec: HouseSpec) {
    const first = !this.world
    const map: MapInfo = { ...MAPS.culdesac, houses: [{ ox: 0, oz: 0, dir: 1 }] }
    const info = buildHouse(0, 0, 0, 1, { layout: spec.layout, theme: spec.theme })
    const world = new World(this.assets, map, { ...MAPS.culdesac.theme.day, snow: false }, [spec.theme, spec.theme], false, this.quality.shadows, false)
    world.addPieces(info.pieces)
    world.group.position.set(-CX, 0, -CZ)
    // Swap in the same frame so changing paint or layout never flashes an empty lawn.
    this.clearWorld()
    this.world = world
    this.pivot.add(world.group)
    this.classify(info.pieces)
    this.placeMarkers(info.valuables)
    this.applyCutaway()
    if (first) {
      texturesSettled()
        .then(() => (this.disposed ? undefined : this.renderer.compileAsync(this.houseScene, this.houseCam)))
        .catch(() => undefined)
        .then(() => {
          this.houseReady = true
          this.kick()
        })
    } else this.kick()
  }

  /** Sort the drawn pieces into the roof and the outside shell (with each panel's outward normal). */
  private classify(pieces: Piece[]) {
    this.shell = []
    this.roof = []
    const views = this.world!.views
    for (const p of pieces) {
      const v = views.get(p.id)
      if (!v) continue
      if (ROOF.has(p.model)) {
        this.roof.push(v.group)
        continue
      }
      if (!SHELL.has(p.model) || p.inside) continue
      const garage = p.x > 6.05
      const cx = garage ? 8 : 0
      const cz = garage ? -1.5 : 0
      const along = p.w >= p.d
      const nx = along ? 0 : Math.sign(p.x - cx)
      const nz = along ? Math.sign(p.z - cz) : 0
      this.shell.push({ group: v.group, nx, nz, floor: p.y > 1 ? 1 : 0 })
    }
  }

  private placeMarkers(valuables: Piece[]) {
    for (const m of this.markers) {
      this.markerGroup.remove(m.sprite)
      m.sprite.material.dispose()
    }
    this.markers = valuables.map((p, i) => {
      const upstairs = p.y > 1
      // Fixed on-screen size (not shrinking with the diorama's distance), drawn over the walls.
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: upstairs ? UPSTAIRS : GROUND, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }))
      const base = p.y + Math.min(p.h, 2.2) + 0.45
      sprite.position.set(p.x - CX, base, p.z - CZ)
      sprite.scale.setScalar(MARK)
      sprite.renderOrder = 20
      this.markerGroup.add(sprite)
      return { sprite, base, phase: i * 0.9 }
    })
  }

  private applyCutaway() {
    for (const r of this.roof) r.visible = !this.cutaway
    for (const s of this.shell) s.group.visible = !this.cutaway || s.floor === 0
  }

  private placeHouseCamera() {
    const cam = this.houseCam
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    // Fit the ~28 m wide diorama and the ~10 m tall house in either orientation.
    const d = Math.max(15.4 / (t * cam.aspect), 10.4 / t)
    const el = 0.5
    cam.position.set(0, 1.9 + Math.sin(el) * d, Math.cos(el) * d)
    cam.lookAt(0, 1.6, 0)
  }

  private tickHouse(dt: number) {
    if (this.frozen !== null) this.houseYaw = this.frozen
    else if (!this.dragging) {
      if (this.idle < 2.5) {
        this.houseYaw += this.spin * dt
        this.spin *= Math.exp(-dt * 4)
      } else this.houseYaw += dt * 0.22 * Math.min(1, (this.idle - 2.5) / 1.5)
    }
    this.pivot.rotation.y = this.houseYaw
    // In the cutaway the ground-floor walls facing the camera drop away too, dollhouse style.
    if (this.cutaway) {
      const s = Math.sin(this.houseYaw)
      const c = Math.cos(this.houseYaw)
      for (const w of this.shell) if (w.floor === 0) w.group.visible = -w.nx * s + w.nz * c < 0.3
    }
    for (const m of this.markers) {
      const k = Math.sin(this.time * 3 + m.phase)
      m.sprite.position.y = m.base + k * 0.12
      m.sprite.scale.setScalar(MARK * (1 + k * 0.1))
    }
  }

  private clearWorld() {
    if (!this.world) return
    this.pivot.remove(this.world.group)
    this.world.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && !this.shared.has(mesh.geometry)) mesh.geometry.dispose()
    })
    this.world.dispose()
    this.world = null
  }

  /* ---------- the hero ---------- */

  private buildHeroStage() {
    const s = this.heroScene
    s.add(new THREE.HemisphereLight('#ffffff', '#8a7a66', 1.3))
    const key = new THREE.DirectionalLight('#fff4e2', 2.4)
    key.position.set(2.5, 4, 4)
    const rim = new THREE.DirectionalLight('#ffd93b', 2.2)
    rim.position.set(-3, 3, -4)
    s.add(key, rim)
    const blob = blobTexture()
    const geo = new THREE.PlaneGeometry(1.6, 1.6)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false })
    const shadow = new THREE.Mesh(geo, mat)
    shadow.position.y = 0.005
    s.add(shadow)
    this.owned.push(blob, geo, mat)
    return rim
  }

  setHero(spec: HeroSpec) {
    const key = `${spec.hero}|${spec.colour}`
    if (key === this.heroKey) return
    this.heroKey = key
    const hero = HEROES[spec.hero]
    const actor = new Actor(this.assets, { name: '', hero: spec.hero, team: 0, colour: spec.colour, human: true, robot: false })
    actor.update(0, this.row, true, true)
    this.clearActor()
    this.actor = actor
    this.heroScene.add(actor.group)
    this.rim.color.set(hero.colors[1])
    this.emoteAt = this.time + 1.8
    this.placeHeroCamera()
    if (!this.heroReady) {
      this.renderer
        .compileAsync(this.heroScene, this.heroCam)
        .catch(() => undefined)
        .then(() => {
          this.heroReady = true
          this.kick()
        })
    } else this.kick()
  }

  private placeHeroCamera() {
    const id = this.actor?.meta.hero
    const h = id ? HEROES[id].height : 1.7
    const dog = id === 'dog'
    const cam = this.heroCam
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    // Frame the whole body (the dog is long rather than tall) with room for a swing.
    const half = dog ? 0.55 : h * 0.57 + 0.08
    const d = Math.max(half / t, (dog ? 0.7 : h * 0.42) / (t * cam.aspect))
    const lookY = dog ? 0.4 : h * 0.5
    cam.position.set(0, lookY + d * 0.12, d)
    cam.lookAt(0, lookY, 0)
  }

  private tickHero(dt: number) {
    const a = this.actor
    if (!a) return
    if (!this.dragging && this.idle > 2.5) this.heroDrag *= Math.exp(-dt * 1.5)
    else if (!this.dragging) {
      this.heroDrag += this.spin * dt
      this.spin *= Math.exp(-dt * 4)
    }
    this.heroYaw = this.frozen ?? this.heroDrag + Math.sin(this.time * 0.5) * 0.35
    this.row.yaw = this.heroYaw
    if (this.time > this.emoteAt && this.frozen === null) {
      const list = a.meta.hero === 'dog' ? DOG_EMOTES : HERO_EMOTES
      const name = list[this.emoteIdx++ % list.length]
      a.emote(name, name === 'Sword_Attack' ? 1.2 : 1)
      this.emoteAt = this.time + 5 + Math.random() * 2
    }
    a.update(dt, this.row, true, true)
  }

  private clearActor() {
    if (!this.actor) return
    const g = this.actor.group
    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!this.shared.has(m)) m.dispose()
    })
    this.actor.dispose()
    this.actor = null
  }

  /* ---------- tooling (pre-rendered fallbacks, screenshots) ---------- */

  /** Hold the turntable at a fixed angle (null resumes the rotation). */
  freeze(yaw: number | null) {
    this.frozen = yaw
  }

  /** Render now and return the frame as an image (transparent background). */
  snapshot(type = 'image/webp', q = 0.82) {
    this.frame(0)
    return this.canvas.toDataURL(type, q)
  }
}
