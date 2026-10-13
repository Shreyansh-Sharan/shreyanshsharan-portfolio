// The street and the houses: textured ground, road and sidewalks, the unbreakable house shell (roof, trims,
// gables, ceilings, lamps; see shell.ts) and one mesh group per sim piece. Wall panels are lap siding or brick
// outside and wallpaper inside (world-space UVs, so boards and courses line up across panels); windows are cased,
// silled and shuttered double-hung sashes; doors, the garage door and the stairs are the generated kit models;
// the porch, its posts, the balcony railings and the chimney are built to size. Each piece merges into a few
// meshes (one per material) and is keyed by id so chips, barricades, moves and breaks update in place.
import * as THREE from 'three'
import { instance, type LawnAssets } from '../engine/assets'
import { HEAD_H, SILL_H, houseStyle, type HouseStyle } from '../engine/houses'
import { HOUSE_THEMES, type HouseTheme } from '../engine/progress'
import type { MapInfo, MapTheme } from '../engine/maps'
import type { Piece } from '../engine/pieces'
import type { Quality } from '../engine/quality'
import { Kit, worldUV, type FaceMats } from './kit'
import { M, cached, indoorModel, paint } from './housemats'
import type { Mood } from './moods'
import { buildShell } from './shell'
import { cracks, neon, planks, rug } from './textures'

interface PieceView {
  piece: Piece
  group: THREE.Group
  /** Crack overlays (walls). */
  cracks: THREE.Mesh[]
  /** Barricade planks (doors). */
  planks: THREE.Group | null
  colour: string
  night?: THREE.MeshStandardMaterial
}

type Theme = (typeof HOUSE_THEMES)[HouseTheme]

const std = (key: string, opts: THREE.MeshStandardMaterialParameters) => cached(key, () => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts }))

/* ---------- tiling textures (UVs are in metres; each texture repeats every `tile` metres) ---------- */

const TILE: Record<string, number> = { oak: 2.2, wallpaper: 1.2, tiles: 2.4, grass: 5, asphalt: 7, sidewalk: 2, snow: 6 }
const texBase = `${import.meta.env.BASE_URL}lawn/textures/`
const texCache = new Map<string, THREE.Texture>()
let texLoader: THREE.TextureLoader | null = null
function tiled(name: string, srgb = true) {
  const key = `${name}-${srgb}`
  let t = texCache.get(key)
  if (!t) {
    texLoader ??= new THREE.TextureLoader()
    t = texLoader.load(`${texBase}${name}.webp`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    const k = 1 / (TILE[name] ?? 2)
    t.repeat.set(k, k)
    texCache.set(key, t)
  }
  return t
}
/** A tiling ground or interior surface, bump-mapped from its own luminance. */
const surf = (name: string, tint = '#ffffff', extra: THREE.MeshStandardMaterialParameters = {}, bump = 0) =>
  std(`tex-${name}-${tint}-${bump}`, { map: tiled(name), color: paint(tint, 0.95), roughness: 0.92, ...(bump ? { bumpMap: tiled(name, false), bumpScale: bump } : {}), ...extra })
/** Ground cover with a second, much larger sample of its texture multiplied in, so the tiling never reads. */
const ground = (name: string, tint: string, rough: number, bump: number, contrast: number) =>
  cached(`ground-${name}-${tint}`, () => {
    const m = new THREE.MeshStandardMaterial({ map: tiled(name), color: paint(tint, 0.95), roughness: rough, bumpMap: tiled(name, false), bumpScale: bump })
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 macroA = texture2D(map, vMapUv * 0.113 + vec2(0.31, 0.17)).rgb;
        vec3 macroB = texture2D(map, vMapUv * 0.031 + vec2(0.63, 0.41)).rgb;
        float macroL = dot(macroA, vec3(0.33)) * 0.5 + dot(macroB, vec3(0.33)) * 0.5;
        diffuseColor.rgb *= 1.0 + (macroL - 0.45) * ${contrast.toFixed(2)};`,
      )
    }
    m.customProgramCacheKey = () => `ground-${contrast}`
    return m
  })

export class World {
  readonly group = new THREE.Group()
  readonly views = new Map<number, PieceView>()
  private assets: LawnAssets
  private map: MapInfo
  private theme: MapTheme
  private houseThemes: [HouseTheme, HouseTheme]
  private mood: Mood
  private quality: Quality
  private night: boolean
  private box = new THREE.BoxGeometry(1, 1, 1)
  readonly lights: THREE.PointLight[] = []
  shadows: boolean

  constructor(assets: LawnAssets, map: MapInfo, theme: MapTheme, houseThemes: [HouseTheme, HouseTheme], mood: Mood, quality: Quality) {
    this.assets = assets
    this.map = map
    this.theme = theme
    this.houseThemes = houseThemes
    this.mood = mood
    this.quality = quality
    this.night = mood.night
    this.shadows = quality.shadows
    this.buildGround()
    this.buildShells()
  }

  /* ---------- ground ---------- */

  /** A flat textured strip lying on the ground (UVs in metres). */
  private flat(w: number, d: number, x: number, y: number, z: number, material: THREE.Material, round = 0) {
    const geo = round ? new THREE.CircleGeometry(round, 40) : new THREE.PlaneGeometry(w, d)
    geo.rotateX(-Math.PI / 2)
    worldUV(geo, new THREE.Vector3(x, y, z))
    const m = new THREE.Mesh(geo, material)
    m.position.set(x, y, z)
    m.receiveShadow = true
    this.group.add(m)
    return m
  }

  private buildGround() {
    const { w, h } = this.map
    const snowy = this.theme.snow
    this.flat(w + 80, h + 80, w / 2, 0, h / 2, snowy ? ground('snow', '#f1f5fa', 0.95, 1.5, 0.6) : ground('grass', '#dcebc8', 0.97, 2, 1.4))
    const road = this.map.road
    const roadMat = ground('asphalt', snowy ? '#c9ced6' : '#e8e8ea', 0.86, 0.6, 0.8)
    this.flat(w + 40, road.z1 - road.z0, w / 2, 0.012, (road.z0 + road.z1) / 2, roadMat)
    // Cul-de-sac turnaround at the east end.
    this.flat(0, 0, w - 6, 0.011, (road.z0 + road.z1) / 2, roadMat, 9)
    // Centre line.
    if (!snowy) {
      for (let x = 2; x < w - 8; x += 4) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), std('line', { color: paint('#f2e4a0', 0.8), roughness: 0.8 }))
        dash.rotation.x = -Math.PI / 2
        dash.position.set(x, 0.02, (road.z0 + road.z1) / 2)
        dash.receiveShadow = true
        this.group.add(dash)
      }
    }
    // Sidewalks with kerbs, the front paths and the driveways.
    const walkMat = surf('sidewalk', snowy ? '#e8eef4' : '#f2efe8', { roughness: 0.95 }, 1)
    for (const z of [road.z0 - 1, road.z1 + 1]) {
      this.flat(w + 40, 2, w / 2, 0.015, z, walkMat)
      const kerb = new THREE.Mesh(this.box, std('kerb', { color: paint(snowy ? '#dfe5ea' : '#c4c0b8', 0.75), roughness: 0.9 }))
      kerb.scale.set(w + 40, 0.1, 0.16)
      kerb.position.set(w / 2, 0.05, z + (z < road.z0 ? 1 : -1))
      kerb.receiveShadow = true
      kerb.castShadow = this.shadows
      this.group.add(kerb)
    }
    for (const hs of this.map.houses) {
      // Front path from the porch steps to the sidewalk, on the door's axis.
      const z0 = hs.oz + hs.dir * 7.2
      const z1 = hs.dir > 0 ? road.z0 - 2 : road.z1 + 2
      this.flat(1.4, Math.abs(z1 - z0), hs.ox, 0.016, (z0 + z1) / 2, walkMat)
      // Driveway to the garage.
      const gx = hs.ox + hs.dir * 8.15
      const gz0 = hs.oz + hs.dir * 1.65
      this.flat(3.6, Math.abs(z1 - gz0), gx, 0.014, (gz0 + z1) / 2, surf('sidewalk', snowy ? '#d9e0e8' : '#e3ddd2', { roughness: 0.95 }, 1))
    }
    // Street lamps and distant neighbour houses for depth.
    for (const x of [6, 34, 62]) this.addStreetLamp(x, road.z0 - 1.6)
    const neighbour = instance(this.assets, 'house-small')
    if (neighbour) {
      if (snowy) this.snowCap(neighbour)
      for (const [x, z, yaw] of [
        [8, 8, Math.PI / 2],
        [62, 8, -Math.PI / 2],
        [8, 56, Math.PI / 2],
        [62, 56, -Math.PI / 2],
      ]) {
        const n = neighbour.clone()
        n.position.set(x, 0, z)
        n.rotation.y = yaw
        this.group.add(n)
      }
    }
  }

  /** The unbreakable parts of each house: roof, trims, ceilings and lamps. */
  private buildShells() {
    this.map.houses.forEach((hs, i) => {
      const id = this.houseThemes[i]
      const theme = HOUSE_THEMES[id] ?? HOUSE_THEMES.lemon
      const night = this.mood.night
      const lamps = this.quality.lamps > 0 ? this.quality.lamps : night ? 2 : 0
      const shell = buildShell({ style: houseStyle(id), theme, snow: this.theme.snow, shadows: this.shadows, ox: hs.ox, oz: hs.oz, dir: hs.dir, lamps, lampScale: this.mood.lamps, outdoorLamps: this.mood.street })
      this.group.add(shell.group)
      this.lights.push(...shell.lights)
    })
  }

  /** Dust a model's upward faces with snow (lodge street). */
  private snowCap(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      const c = src.clone()
      c.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUpN = normalize(mat3(modelMatrix) * objectNormal).y;')
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.87), smoothstep(0.35, 0.7, vUpN));')
      }
      c.customProgramCacheKey = () => 'snowcap'
      m.material = c
    })
  }

  private addStreetLamp(x: number, z: number) {
    const g = new THREE.Group()
    const iron = M.metal('#2f343c')
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5, 10), iron)
    pole.position.y = 2.5
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.5, 10), iron)
    base.position.y = 0.25
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.07), iron)
    arm.position.set(0.5, 4.95, 0)
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.22, 12), iron)
    head.position.set(1.0, 4.88, 0)
    const lit = this.mood.street
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 12), lit ? M.bulb('#ffd796', 4) : std('lamp-lens', { color: '#f2ecd6', roughness: 0.3 }))
    lens.position.set(1.0, 4.76, 0)
    for (const m of [pole, base, arm, head]) {
      m.castShadow = this.shadows
      m.receiveShadow = true
    }
    g.add(pole, base, arm, head, lens)
    g.position.set(x, 0, z)
    this.group.add(g)
    if (lit) {
      const l = new THREE.PointLight('#ffd08a', 40, 18, 1.8)
      l.position.set(1.0, 4.55, 0)
      g.add(l)
      this.lights.push(l)
    }
  }

  /* ---------- pieces ---------- */

  addPieces(pieces: Piece[]) {
    for (const p of pieces) this.addPiece(p)
  }

  addPiece(p: Piece) {
    if (this.views.has(p.id) || !p.alive) return
    const themeId = (p.house >= 0 ? this.houseThemes[p.house] : 'lemon') as HouseTheme
    const theme = HOUSE_THEMES[themeId] ?? HOUSE_THEMES.lemon
    const group = new THREE.Group()
    group.position.set(p.x, p.y, p.z)
    const view: PieceView = { piece: p, group, cracks: [], planks: null, colour: theme.siding }
    const built = this.build(p, theme, houseStyle(themeId), view)
    if (built) group.add(built)
    this.group.add(group)
    this.views.set(p.id, view)
    if (p.kind === 'wall' && p.breakable) this.setChip(p.id, p.chip)
    if ((p.kind === 'door' || p.kind === 'garage') && p.level > 0) this.setBarricade(p.id, p.level)
  }

  /* ---------- house materials ---------- */

  private lodge(theme: Theme) {
    return theme.name.includes('lodge')
  }
  private paperMat(house: number) {
    return M.paper(house === 0 ? '#fff6ea' : '#eef3ff', tiled('wallpaper'))
  }
  /** The outside face of a wall piece: brick on the ground storey of brick houses, painted siding elsewhere. */
  private extMat(p: Piece, theme: Theme, style: HouseStyle) {
    if (style.brick && p.y < 1) return M.brick(this.lodge(theme) ? '#d9cfc2' : '#ffffff')
    return M.siding(theme.siding)
  }
  private floorMat() {
    return M.floor(tiled('oak'), '#ffffff', 0.5)
  }
  /** A tinted copy of a kit material, cached per tint. */
  private kitMat(src: THREE.MeshStandardMaterial, tint: string) {
    return cached(`kit-${src.uuid}-${tint}`, () => {
      const m = src.clone()
      m.color.copy(paint(tint, 0.78))
      m.roughness = 0.5
      return m
    }) as THREE.MeshStandardMaterial
  }

  /** Is the exterior face of this wall piece on its +z (along x) / +x (along z) side? */
  private outward(p: Piece) {
    const hs = this.map.houses[p.house]
    const along = p.w >= p.d
    if (!hs) return 1
    // The garage block sits beside the house: measure from the centre of whichever block the piece belongs to.
    const lx = (p.x - hs.ox) * hs.dir
    const cx = lx > 6.05 ? hs.ox + hs.dir * 8 : hs.ox
    const cz = lx > 6.05 ? hs.oz - hs.dir * 1.5 : hs.oz
    return along ? (p.z >= cz ? 1 : -1) : p.x >= cx ? 1 : -1
  }

  /** Yaw that turns a kit part's +Z (its outside) to face out of this wall. */
  private kitYaw(p: Piece) {
    const along = p.w >= p.d
    const o = this.outward(p)
    return along ? (o > 0 ? 0 : Math.PI) : o > 0 ? Math.PI / 2 : -Math.PI / 2
  }
  /** Yaw of the household's local frame (front = +z). */
  private houseYaw(p: Piece) {
    const hs = this.map.houses[p.house]
    return hs && hs.dir < 0 ? Math.PI : 0
  }

  /** A kit model with only the named parts kept, each tinted. */
  private kit(name: string, parts: Record<string, string | null>) {
    const obj = instance(this.assets, name)
    if (!obj) return null
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      // Parts are named nodes (their materials may be shared after compression), so match the node name first.
      const key = Object.keys(parts).find((k) => m.name === k) ?? Object.keys(parts).find((k) => src.name === k)
      if (!key) {
        m.visible = false
        return
      }
      const tint = parts[key]
      if (tint) m.material = this.kitMat(src, tint)
      m.castShadow = this.shadows
      m.receiveShadow = true
    })
    return obj
  }

  private build(p: Piece, theme: Theme, style: HouseStyle, view: PieceView): THREE.Object3D | null {
    const m = p.model
    const lodge = this.lodge(theme)
    const trim = M.trim(theme.trim)
    const itrim = M.indoorTrim('#f4efe6')
    const along = p.w >= p.d
    const len = along ? p.w : p.d
    const hw = len / 2
    const origin = new THREE.Vector3(p.x, p.y, p.z)
    /** A kit turned so +z faces out of this wall. */
    const wallKit = () => Kit.at(this.kitYaw(p), origin, this.shadows)
    const box = (w: number, h: number, d: number, material: THREE.Material | THREE.Material[], y = h / 2) => {
      const mesh = new THREE.Mesh(this.box, material)
      mesh.scale.set(w, h, d)
      mesh.position.y = y
      mesh.castShadow = this.shadows
      mesh.receiveShadow = true
      return mesh
    }
    const fit = (name: string, fallback: () => THREE.Object3D | null, yaw = 0) => {
      const obj = instance(this.assets, name)
      if (!obj) return fallback()
      const mh = obj.userData.height as number
      if (mh && p.h) {
        const s = Math.min(1.6, Math.max(0.5, p.h / mh))
        obj.scale.setScalar(s)
      }
      obj.rotation.y = yaw
      return obj
    }
    const ext = () => this.extMat(p, theme, style)
    const paper = () => this.paperMat(p.house)
    /** Wall faces: ends and top/bottom in trim, siding or brick outside, wallpaper inside. */
    const wallFaces = (): FaceMats => [trim, trim, trim, trim, ext(), paper()]
    switch (true) {
      case m === 'wall': {
        const k = wallKit()
        k.box(-hw, hw, 0, p.h, -0.15, 0.15, wallFaces())
        k.box(-hw, hw, 0, 0.12, -0.17, -0.15, M.skirting())
        view.colour = style.brick && p.y < 1 ? '#b5523b' : theme.siding
        return k.build()
      }
      case m === 'sill': {
        // The wall under a window, with the exterior sill, apron, casings, shutters and the interior stool.
        const k = wallKit()
        k.box(-hw, hw, 0, SILL_H, -0.15, 0.15, wallFaces())
        k.box(-hw, hw, 0, 0.12, -0.17, -0.15, M.skirting())
        this.windowSurround(k, len, theme, style, p.y < 1)
        view.colour = style.brick && p.y < 1 ? '#b5523b' : theme.siding
        return k.build()
      }
      case m === 'header:window': {
        const k = wallKit()
        k.box(-hw, hw, 0, p.h, -0.15, 0.15, wallFaces())
        view.colour = theme.siding
        return k.build()
      }
      case m === 'window': {
        // The glass sashes: they break away and leave the cased opening.
        const k = wallKit()
        this.sashes(k, len, p.h, theme)
        view.colour = '#c8f2ff'
        return k.build()
      }
      case m === 'door': {
        const k = wallKit()
        const leaf = this.kit('kit-door', { leaf: theme.door })
        if (leaf) {
          leaf.scale.set(len, (HEAD_H - 0.02) / 2.08, 1)
          k.add(leaf)
        } else k.box(-hw + 0.03, hw - 0.03, 0, p.h - 0.03, -0.05, 0.05, M.accent(theme.door))
        if (p.flap) k.box(-0.22, 0.22, 0.04, 0.42, -0.19, 0.19, std('flap', { color: '#2a2a2a', roughness: 0.6 }))
        view.colour = theme.door
        return k.build()
      }
      case m === 'header:door' || m === 'header:frontdoor': {
        const k = wallKit()
        k.box(-hw, hw, 0, p.h, -0.15, 0.15, wallFaces())
        this.doorSurround(k, len, -HEAD_H, theme, m === 'header:frontdoor')
        view.colour = theme.siding
        return k.build()
      }
      case m === 'garagedoor': {
        const k = wallKit()
        const leaf = this.kit('kit-garage', { leaf: lodge ? '#e8dccb' : '#f4f1ea' })
        if (leaf) {
          leaf.scale.set(len / 3, 1, 1)
          k.add(leaf)
        } else k.box(-hw, hw, 0, p.h, -0.08, 0.08, std('garage', { map: planks('#d9d4c8') }))
        view.colour = '#d9d4c8'
        return k.build()
      }
      case m === 'header:garage': {
        const k = wallKit()
        k.box(-hw, hw, 0, p.h, -0.15, 0.15, wallFaces())
        this.doorSurround(k, len, -2.5, theme, false)
        view.colour = theme.siding
        return k.build()
      }
      case m === 'header:gap': {
        // An interior doorway: papered lintel with painted casings on both faces.
        const k = Kit.at(along ? 0 : Math.PI / 2, origin, this.shadows)
        k.box(-hw, hw, 0, p.h, -0.15, 0.15, [itrim, itrim, itrim, itrim, paper(), paper()])
        for (const s of [-1, 1]) {
          k.box(-hw - 0.08, hw + 0.08, -0.02, 0.08, s > 0 ? 0.15 : -0.17, s > 0 ? 0.17 : -0.15, itrim)
          for (const e of [-1, 1]) k.box(e > 0 ? hw : -hw - 0.08, e > 0 ? hw + 0.08 : -hw, -2.1, 0, s > 0 ? 0.15 : -0.17, s > 0 ? 0.17 : -0.15, itrim)
        }
        k.box(-hw, -hw + 0.03, -2.1, 0, -0.15, 0.15, itrim)
        k.box(hw - 0.03, hw, -2.1, 0, -0.15, 0.15, itrim)
        view.colour = '#e8dcc5'
        return k.build()
      }
      case m === 'innerwall': {
        view.colour = '#e8dcc5'
        const k = Kit.at(along ? 0 : Math.PI / 2, origin, this.shadows)
        k.box(-hw, hw, 0, p.h, -0.15, 0.15, [itrim, itrim, itrim, itrim, paper(), paper()])
        k.box(-hw, hw, 0, 0.12, -0.17, 0.17, M.skirting())
        return k.build()
      }
      case m === 'edge' || m === 'roofstep':
        return null
      case m === 'floor' || m === 'garagefloor': {
        const k = new Kit(new THREE.Matrix4(), origin, false)
        if (m === 'floor') {
          k.box(-p.w / 2, p.w / 2, 0, p.h, -p.d / 2, p.d / 2, this.floorMat())
          // Kitchen tiles (local x 1.4..5.85), mirrored with the house.
          const dir = this.map.houses[p.house]?.dir ?? 1
          const t = new THREE.PlaneGeometry(4.45, 8.7)
          t.rotateX(-Math.PI / 2)
          t.translate(dir * 3.625, p.h + 0.004, 0)
          k.geo(t, M.floor(tiled('tiles'), '#ffffff', 0.3))
        } else k.box(-p.w / 2, p.w / 2, 0, p.h, -p.d / 2, p.d / 2, M.floor(tiled('sidewalk'), '#bdb8b0', 0.85))
        return k.build()
      }
      case m === 'slab': {
        const k = new Kit(new THREE.Matrix4(), origin, this.shadows)
        k.box(-p.w / 2, p.w / 2, 0, p.h, -p.d / 2, p.d / 2, [itrim, itrim, this.floorMat(), M.ceiling(), itrim, itrim])
        return k.build()
      }
      case m === 'porch': {
        const k = Kit.at(this.houseYaw(p), origin, this.shadows)
        const w = p.w / 2
        const d = p.d / 2
        const deck = std(`porchdeck-${lodge}`, { map: tiled('oak'), color: paint(lodge ? '#8f8a84' : '#9fa4a8', 0.62), roughness: 0.7 })
        k.box(-w, w, p.h - 0.04, p.h, -d, d, deck)
        k.box(-w, w, 0, p.h - 0.04, d - 0.04, d, trim)
        for (const s of [-1, 1]) k.box(s > 0 ? w - 0.04 : -w, s > 0 ? w : -w + 0.04, 0, p.h - 0.04, -d, d, trim)
        // Two shallow steps down to the path.
        k.box(-0.95, 0.95, 0, 0.09, d, d + 0.34, M.concrete('#c9c3b9'))
        view.colour = '#b7aa9a'
        return k.build()
      }
      case m === 'porchpost': {
        const k = new Kit(new THREE.Matrix4(), origin, this.shadows)
        const h = p.h
        if (style.columns === 'round') {
          const shaft = new THREE.CylinderGeometry(0.085, 0.1, h - 0.36, 16)
          shaft.translate(0, (h - 0.36) / 2 + 0.2, 0)
          k.geo(shaft, trim)
          k.box(-0.13, 0.13, 0, 0.2, -0.13, 0.13, trim)
          k.box(-0.14, 0.14, h - 0.16, h, -0.14, 0.14, trim)
          k.box(-0.11, 0.11, h - 0.2, h - 0.16, -0.11, 0.11, trim)
        } else {
          const shaft = new THREE.CylinderGeometry(0.075, 0.11, h - 0.75, 4)
          shaft.rotateY(Math.PI / 4)
          shaft.translate(0, (h - 0.75) / 2 + 0.6, 0)
          k.geo(shaft, trim)
          k.box(-0.15, 0.15, 0, 0.6, -0.15, 0.15, style.brick ? M.brick() : trim)
          k.box(-0.17, 0.17, 0.56, 0.62, -0.17, 0.17, trim)
          k.box(-0.12, 0.12, h - 0.15, h, -0.12, 0.12, trim)
        }
        view.colour = theme.trim
        return k.build()
      }
      case m === 'balcony': {
        // The porch roof: beams and fascia, a beadboard ceiling below and decking on top.
        const k = Kit.at(this.houseYaw(p), origin, this.shadows)
        const w = p.w / 2
        const d = p.d / 2
        k.box(-w, w, p.h - 0.04, p.h, -d, d, std(`balcony-deck`, { map: tiled('oak'), color: paint('#a7a39c', 0.6), roughness: 0.7 }))
        k.box(-w, w, -0.3, p.h - 0.04, d - 0.08, d, trim)
        for (const s of [-1, 1]) k.box(s > 0 ? w - 0.08 : -w, s > 0 ? w : -w + 0.08, -0.3, p.h - 0.04, -d, d, trim)
        k.box(-w + 0.08, w - 0.08, -0.31, -0.29, -d, d - 0.08, M.beadboard(theme.trim))
        k.box(-w - 0.02, w + 0.02, p.h - 0.06, p.h - 0.03, d - 0.02, d + 0.04, trim)
        view.colour = theme.trim
        return k.build()
      }
      case m === 'rail':
        return this.railing(p, trim)
      case m === 'step': {
        // The whole flight is one kit model, hung off the bottom step; the other steps are collision only.
        if (p.h > 0.3) return null
        const k = this.kit('kit-stairs', { stairs: '#ffffff' })
        if (!k) return box(p.w, p.h, p.d, std('stair', { map: planks('#b98a55') }))
        const g = new THREE.Group()
        g.rotation.y = p.yaw
        k.position.z = 0.15
        g.add(indoorModel(k))
        return g
      }
      case m === 'chimney': {
        const k = Kit.at(this.houseYaw(p), origin, this.shadows)
        const brick = M.brick(lodge ? '#d6cdc0' : '#ffffff')
        const w = p.w / 2
        const d = p.d / 2
        const shoulder = 6.7
        k.box(-w, w, 0, shoulder, -d, d, brick)
        // Sloped shoulder, then the narrower stack with a cap and two flue pots.
        k.box(-w + 0.06, w - 0.02, shoulder, shoulder + 0.25, -d + 0.15, d - 0.15, brick)
        const sx = 0.26
        const sz = 0.45
        k.box(-sx, sx, shoulder + 0.25, p.h - 0.12, -sz, sz, brick)
        k.box(-sx - 0.06, sx + 0.06, p.h - 0.12, p.h - 0.02, -sz - 0.06, sz + 0.06, M.concrete('#9d978e'))
        for (const z of [-0.18, 0.18]) {
          const pot = new THREE.CylinderGeometry(0.08, 0.1, 0.32, 10)
          pot.translate(0, p.h + 0.14, z)
          k.geo(pot, std('flue', { color: paint('#a8573a', 0.6), roughness: 0.8 }))
        }
        view.colour = '#b5523b'
        return k.build()
      }
      case m.startsWith('furniture:'):
        return this.furniture(m.slice(10), p, theme, view)
      case m.startsWith('valuable:'):
        return this.valuable(m.slice(9), p, view)
      case m.startsWith('prop:'):
        return this.prop(m.slice(5), p, view, fit)
      case m === 'ladder': {
        const obj = instance(this.assets, 'ladder')
        const top = (p.top ?? 3.2) + 0.5
        if (obj) {
          const mh = (obj.userData.height as number) || 3.6
          obj.scale.set(1, top / mh, 1)
          obj.position.z = -0.1
          obj.rotation.x = -0.2
          obj.rotation.y = 0
          return obj
        }
        const g = new THREE.Group()
        const alu = std('ladder', { color: '#c9ccd2', roughness: 0.4 })
        for (const s of [-1, 1]) {
          const rail = box(0.06, top, 0.06, alu)
          rail.position.x = s * 0.25
          g.add(rail)
        }
        for (let y = 0.3; y < top; y += 0.35) g.add(box(0.5, 0.04, 0.04, alu, y))
        g.rotation.x = -0.2
        return g
      }
      default:
        return box(p.w, p.h, p.d, std('unknown', { color: '#c99' }))
    }
  }

  /** Window casing, sill, apron, through-wall jambs, interior stool and casing, and shutters on single windows. */
  private windowSurround(k: Kit, w: number, theme: Theme, style: HouseStyle, ground: boolean) {
    const trim = M.trim(theme.trim)
    const itrim = M.indoorTrim('#f4efe6')
    const hw = w / 2
    const cw = 0.1
    const S = SILL_H
    const H = HEAD_H
    // Exterior sill and apron.
    k.box(-hw - 0.1, hw + 0.1, S - 0.05, S + 0.01, 0.12, 0.25, trim)
    k.box(-hw + 0.03, hw - 0.03, S - 0.19, S - 0.05, 0.15, 0.175, trim)
    // Casing and the head with its drip cap.
    k.box(-hw - cw, -hw, S, H + cw, 0.15, 0.18, trim)
    k.box(hw, hw + cw, S, H + cw, 0.15, 0.18, trim)
    k.box(-hw - cw - 0.03, hw + cw + 0.03, H + cw, H + cw + 0.09, 0.15, 0.2, trim)
    k.box(-hw - cw - 0.05, hw + cw + 0.05, H + cw + 0.09, H + cw + 0.12, 0.15, 0.22, trim)
    // Jambs lining the opening through the wall.
    k.box(-hw, -hw + 0.04, S, H, -0.15, 0.15, trim)
    k.box(hw - 0.04, hw, S, H, -0.15, 0.15, trim)
    k.box(-hw, hw, H - 0.04, H, -0.15, 0.15, trim)
    k.box(-hw, hw, S, S + 0.02, -0.15, 0.15, trim)
    // Interior stool, apron and casing.
    k.box(-hw - 0.07, hw + 0.07, S - 0.03, S + 0.01, -0.23, -0.12, itrim)
    k.box(-hw - 0.02, hw + 0.02, S - 0.15, S - 0.03, -0.17, -0.15, itrim)
    k.box(-hw - 0.08, -hw, S, H + 0.08, -0.17, -0.15, itrim)
    k.box(hw, hw + 0.08, S, H + 0.08, -0.17, -0.15, itrim)
    k.box(-hw - 0.08, hw + 0.08, H, H + 0.08, -0.17, -0.15, itrim)
    // Louvred shutters beside single windows.
    if (w <= 1.2 && !(style.brick && ground)) {
      const sw = Math.min(0.46, w * 0.46)
      const acc = M.accent(theme.door)
      for (const s of [-1, 1]) {
        const x0 = s * (hw + cw + 0.02)
        const x1 = s * (hw + cw + 0.02 + sw)
        const a = Math.min(x0, x1)
        const b = Math.max(x0, x1)
        const z0 = 0.15
        k.box(a, a + 0.06, S, H, z0, z0 + 0.04, acc)
        k.box(b - 0.06, b, S, H, z0, z0 + 0.04, acc)
        for (const y of [S, (S + H) / 2 - 0.035, H - 0.07]) k.box(a + 0.06, b - 0.06, y, y + 0.07, z0, z0 + 0.04, acc)
        for (let y = S + 0.09; y < H - 0.08; y += 0.075) {
          if (Math.abs(y - (S + H) / 2) < 0.06) continue
          k.box(a + 0.06, b - 0.06, y, y + 0.035, z0 + 0.005, z0 + 0.03, acc)
        }
        k.box(a + 0.06, b - 0.06, S + 0.07, H - 0.07, z0, z0 + 0.008, M.concrete('#3a3530'))
      }
    }
  }

  /** Double-hung sashes (two side by side in a wide window) with muntins and glass. Kit y=0 is the sill. */
  private sashes(k: Kit, w: number, h: number, theme: Theme) {
    const trim = M.trim(theme.trim)
    const glass = M.glass(this.mood.windows)
    const units = w > 1.3 ? 2 : 1
    const mull = 0.1
    const clear = w - 0.08
    const uw = (clear - (units - 1) * mull) / units
    if (units === 2) k.box(-mull / 2, mull / 2, 0, h, -0.06, 0.15, trim)
    for (let u = 0; u < units; u++) {
      const cx = -clear / 2 + uw / 2 + u * (uw + mull)
      const sash = (y0: number, y1: number, z0: number, z1: number) => {
        const a = cx - uw / 2
        const b = cx + uw / 2
        const f = 0.055
        k.box(a, a + f, y0, y1, z0, z1, trim)
        k.box(b - f, b, y0, y1, z0, z1, trim)
        k.box(a + f, b - f, y0, y0 + 0.065, z0, z1, trim)
        k.box(a + f, b - f, y1 - f, y1, z0, z1, trim)
        const zm = (z0 + z1) / 2
        k.box(cx - 0.012, cx + 0.012, y0 + 0.065, y1 - f, zm - 0.012, zm + 0.016, trim)
        k.box(a + f, b - f, (y0 + 0.065 + y1 - f) / 2 - 0.012, (y0 + 0.065 + y1 - f) / 2 + 0.012, zm - 0.012, zm + 0.016, trim)
        k.box(a + f, b - f, y0 + 0.065, y1 - f, zm - 0.003, zm + 0.003, glass)
      }
      sash(0.02, h / 2 + 0.03, 0.0, 0.05)
      sash(h / 2 - 0.03, h - 0.04, 0.055, 0.105)
    }
  }

  /** Casing and jambs around a door or garage opening, from a header piece (kit y=0 is the head). */
  private doorSurround(k: Kit, w: number, bottom: number, theme: Theme, front: boolean) {
    const trim = M.trim(theme.trim)
    const itrim = M.indoorTrim('#f4efe6')
    const hw = w / 2
    const cw = w > 2 ? 0.12 : 0.11
    k.box(-hw - cw, -hw, bottom, cw, 0.15, 0.185, trim)
    k.box(hw, hw + cw, bottom, cw, 0.15, 0.185, trim)
    k.box(-hw - cw - 0.03, hw + cw + 0.03, cw, cw + 0.09, 0.15, 0.2, trim)
    k.box(-hw - cw - 0.05, hw + cw + 0.05, cw + 0.09, cw + 0.12, 0.15, 0.22, trim)
    if (front) {
      // A cornice over the front door.
      k.box(-hw - 0.3, hw + 0.3, cw + 0.12, cw + 0.24, 0.15, 0.32, trim)
      k.box(-hw - 0.34, hw + 0.34, cw + 0.24, cw + 0.28, 0.15, 0.35, trim)
    }
    k.box(-hw, -hw + 0.04, bottom, 0, -0.15, 0.15, trim)
    k.box(hw - 0.04, hw, bottom, 0, -0.15, 0.15, trim)
    k.box(-hw, hw, -0.04, 0, -0.15, 0.15, trim)
    if (w < 2) {
      k.box(-hw - 0.08, -hw, bottom, 0.08, -0.17, -0.15, itrim)
      k.box(hw, hw + 0.08, bottom, 0.08, -0.17, -0.15, itrim)
      k.box(-hw - 0.08, hw + 0.08, 0, 0.08, -0.17, -0.15, itrim)
    }
  }

  /** Balusters between a bottom and a top rail, with newel posts at the ends. */
  private railing(p: Piece, trim: THREE.Material) {
    const along = p.w > p.d
    const len = along ? p.w : p.d
    const k = Kit.at(along ? 0 : Math.PI / 2, new THREE.Vector3(p.x, p.y, p.z), this.shadows)
    const h = p.h
    k.box(-len / 2, len / 2, h - 0.08, h, -0.05, 0.05, trim)
    k.box(-len / 2, len / 2, 0.08, 0.15, -0.04, 0.04, trim)
    const n = Math.max(2, Math.round(len / 0.13))
    for (let i = 1; i < n; i++) {
      const t = -len / 2 + (len / n) * i
      k.box(t - 0.02, t + 0.02, 0.15, h - 0.08, -0.02, 0.02, trim)
    }
    for (const s of [-1, 1]) {
      k.box(s * len / 2 - 0.06, s * len / 2 + 0.06, 0, h + 0.06, -0.06, 0.06, trim)
      k.box(s * len / 2 - 0.08, s * len / 2 + 0.08, h + 0.06, h + 0.1, -0.08, 0.08, trim)
    }
    return k.build()
  }

  private furniture(kind: string, p: Piece, theme: Theme, view: PieceView): THREE.Object3D | null {
    const wood = surf('oak', '#9a6a44', { roughness: 0.75 })
    const fabric = std(`fabric-${p.house}`, { color: p.house === 0 ? '#5a8bd6' : '#d66a5a', roughness: 1 })
    const box = (w: number, h: number, d: number, material: THREE.Material, y = h / 2, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(this.box, material)
      mesh.scale.set(w, h, d)
      mesh.position.set(x, y, z)
      mesh.castShadow = this.shadows
      mesh.receiveShadow = true
      return mesh
    }
    const g = new THREE.Group()
    g.rotation.y = p.yaw
    view.colour = '#8b5e3c'
    const model = (name: string) => {
      const obj = instance(this.assets, name)
      if (!obj) return false
      const mh = (obj.userData.height as number) || p.h
      obj.scale.setScalar(Math.min(1.5, Math.max(0.6, p.h / mh)))
      g.add(obj)
      return true
    }
    switch (kind) {
      case 'sofa':
        if (!model('sofa')) {
          g.add(box(p.w, 0.45, p.d, fabric), box(p.w, 0.5, 0.25, fabric, 0.65, 0, -p.d / 2 + 0.12), box(0.2, 0.3, p.d, fabric, 0.55, -p.w / 2 + 0.1), box(0.2, 0.3, p.d, fabric, 0.55, p.w / 2 - 0.1))
        }
        view.colour = '#5a8bd6'
        break
      case 'coffeetable':
        g.add(box(p.w, 0.05, p.d, wood, 0.42))
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.06, 0.4, 0.06, wood, 0.2, (x * p.w) / 2 - x * 0.05, (z * p.d) / 2 - z * 0.05))
        break
      case 'rug': {
        const r = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), std(`rug-${p.house}`, { map: rug(p.house === 0 ? '#b23b3b' : '#2f6b8a') }))
        r.rotation.x = -Math.PI / 2
        r.position.y = 0.015
        r.receiveShadow = true
        g.add(r)
        break
      }
      case 'counter': {
        g.add(box(p.w, p.h, p.d, std('cabinet', { color: '#f1f1ef', roughness: 0.8 })))
        g.add(box(p.w + 0.05, 0.05, p.d + 0.05, std('worktop', { color: '#444a52', roughness: 0.5 }), p.h))
        // Tiled splashback against the wall.
        g.add(box(p.w, 0.6, 0.03, surf('tiles', '#e8f0ff', { roughness: 0.4 }), p.h + 0.33, 0, -p.d / 2 + 0.015))
        // Hob and sink details.
        g.add(box(0.6, 0.02, 0.5, std('hob', { color: '#222' }), p.h + 0.04, -p.w * 0.25))
        g.add(box(0.5, 0.02, 0.4, std('sinkb', { color: '#aab' }), p.h + 0.04, p.w * 0.25))
        for (let i = 0; i < 4; i++) g.add(box(0.4, 0.05, 0.02, std('handle', { color: '#888' }), p.h * 0.5, -p.w / 2 + 0.45 + i * 0.9, p.d / 2 + 0.01))
        view.colour = '#f1f1ef'
        break
      }
      case 'table':
        g.add(box(p.w, 0.06, p.d, wood, p.h))
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.07, p.h, 0.07, wood, p.h / 2, (x * p.w) / 2 - x * 0.08, (z * p.d) / 2 - z * 0.08))
        break
      case 'chair':
        g.add(box(0.45, 0.05, 0.45, wood, 0.45), box(0.45, 0.45, 0.05, wood, 0.68, 0, -0.2))
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.05, 0.45, 0.05, wood, 0.22, x * 0.19, z * 0.19))
        break
      case 'bed': {
        const bed = instance(this.assets, 'bed')
        if (bed) {
          g.add(bed)
          view.colour = '#f4d35e'
          break
        }
        g.add(box(p.w, 0.25, p.d, wood, 0.3))
        g.add(box(p.w - 0.1, 0.25, p.d - 0.1, std(`duvet-${p.house}`, { color: p.house === 0 ? '#f4d35e' : '#8ecae6', roughness: 1 }), 0.55))
        g.add(box(p.w * 0.4, 0.14, 0.4, std('pillow', { color: '#ffffff' }), 0.74, 0, -p.d / 2 + 0.35))
        g.add(box(p.w, 0.8, 0.08, wood, 0.6, 0, -p.d / 2 + 0.04))
        view.colour = '#f4d35e'
        break
      }
      case 'wardrobe':
        g.add(box(p.w, p.h, p.d, wood))
        g.add(box(0.03, p.h - 0.1, 0.02, std('handle', { color: '#ddd' }), p.h / 2, 0, p.d / 2 + 0.02))
        break
      case 'toilet':
        if (!model('toilet')) g.add(box(0.4, 0.4, 0.6, std('porcelain', { color: '#fff' })), box(0.4, 0.5, 0.2, std('porcelain', { color: '#fff' }), 0.6, 0, -0.2))
        view.colour = '#ffffff'
        break
      case 'sink': {
        // The vanity carries its mirror, so it stands taller than its collision box.
        const s = instance(this.assets, 'sink')
        if (s) g.add(s)
        else g.add(box(0.6, 0.85, 0.45, std('porcelain', { color: '#fff' })))
        view.colour = '#ffffff'
        break
      }
      case 'desk':
        g.add(box(p.w, 0.05, p.d, wood, p.h), box(0.5, p.h, p.d - 0.1, wood, p.h / 2, -p.w / 2 + 0.3), box(0.06, p.h, 0.06, wood, p.h / 2, p.w / 2 - 0.1, p.d / 2 - 0.1), box(0.06, p.h, 0.06, wood, p.h / 2, p.w / 2 - 0.1, -p.d / 2 + 0.1))
        g.add(box(0.5, 0.35, 0.03, std('screen', { color: '#223', emissive: '#4ac', emissiveIntensity: 0.4 }), p.h + 0.25, 0.2, -0.1))
        break
      case 'toolrack': {
        g.add(box(0.06, p.h, p.d, std('pegboard', { color: '#c9a77a', roughness: 0.9 }), p.h / 2 + 0.2))
        // Hang the tools that can be picked up.
        const names = ['rake', 'shovel', 'bat', 'sledge', 'pan']
        names.forEach((n, i) => {
          const t = instance(this.assets, n)
          if (!t) return
          t.scale.setScalar(0.9)
          t.position.set(0.12, 0.2, -p.d / 2 + 0.25 + i * 0.3)
          t.rotation.z = 0.1
          g.add(t)
        })
        break
      }
      default:
        g.add(box(p.w, p.h, p.d, wood))
    }
    void theme
    return indoorModel(g)
  }

  private valuable(kind: string, p: Piece, view: PieceView): THREE.Object3D | null {
    const g = new THREE.Group()
    g.rotation.y = p.yaw
    const box = (w: number, h: number, d: number, material: THREE.Material, y = h / 2, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(this.box, material)
      mesh.scale.set(w, h, d)
      mesh.position.set(x, y, z)
      mesh.castShadow = this.shadows
      mesh.receiveShadow = true
      return mesh
    }
    const model = (name: string, h = p.h) => {
      const obj = instance(this.assets, name)
      if (!obj) return null
      const mh = (obj.userData.height as number) || h
      obj.scale.setScalar(Math.min(2, Math.max(0.4, h / mh)))
      g.add(obj)
      return obj
    }
    const colours: Record<string, string> = { tv: '#2a2a30', fridge: '#e8ecef', trophy: '#e6c045', aquarium: '#7fd0ff', clock: '#6b3f22', piano: '#1a1a1e', console: '#333', mower: '#d33', vase: '#3f74c9', bookcase: '#8b5e3c' }
    view.colour = colours[kind] ?? '#aaa'
    switch (kind) {
      case 'tv':
        if (!model('tv')) {
          g.add(box(0.5, 0.12, 0.3, std('tvstand', { color: '#222' })))
          g.add(box(1.3, 0.75, 0.08, std('tv', { color: '#111' }), 0.55))
          g.add(box(1.2, 0.65, 0.02, std('screen', { color: '#2b5b8a', emissive: '#3a8fd6', emissiveIntensity: 0.5 }), 0.55, 0, 0.05))
        }
        break
      case 'fridge':
        if (!model('fridge')) g.add(box(0.9, 1.9, 0.8, std('fridge', { color: '#e8ecef', roughness: 0.4 })))
        break
      case 'trophy': {
        // Glass case with the trophy inside.
        g.add(box(1.2, 0.5, 0.5, std('case-base', { color: '#4a2f1d' })))
        g.add(box(1.2, 1.3, 0.5, std('case-glass', { color: '#cfefff', transparent: true, opacity: 0.35, roughness: 0.1 }), 1.15))
        g.add(box(1.2, 0.06, 0.5, std('case-base', { color: '#4a2f1d' }), 1.8))
        const t = instance(this.assets, 'trophy')
        if (t) {
          t.scale.setScalar(0.75)
          t.position.y = 0.5
          g.add(t)
        }
        break
      }
      case 'aquarium': {
        // The model is the tank on its cabinet.
        const tank = instance(this.assets, 'aquarium')
        if (tank) {
          g.add(tank)
          break
        }
        g.add(box(1.4, 0.6, 0.6, std('tankstand', { color: '#333' })))
        g.add(box(1.4, 0.5, 0.6, std('water', { color: '#5fc3ff', transparent: true, opacity: 0.45, roughness: 0.1 }), 0.86))
        g.add(box(1.42, 0.52, 0.62, std('tankglass', { color: '#d8f4ff', transparent: true, opacity: 0.2, roughness: 0.05 }), 0.86))
        for (let i = 0; i < 3; i++) {
          const fish = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(`fish-${i}`, { color: ['#ff8a2b', '#ffd23b', '#ff4a6a'][i] }))
          fish.scale.set(1.6, 1, 0.7)
          fish.position.set(-0.4 + i * 0.4, 0.78 + (i % 2) * 0.15, (i - 1) * 0.12)
          g.add(fish)
        }
        break
      }
      case 'clock':
        if (!model('clock')) g.add(box(0.6, 2.0, 0.4, std('clockwood', { color: '#6b3f22' })))
        break
      case 'piano':
        if (!model('piano')) g.add(box(1.5, 1.1, 0.7, std('piano', { color: '#1a1a1e', roughness: 0.3 })))
        break
      case 'mower':
        if (!model('mower')) g.add(box(0.8, 0.5, 1.2, std('mower', { color: '#d33' })))
        break
      case 'console':
        g.add(box(0.6, 0.5, 0.5, std('cabinet-dark', { color: '#2a2a2e' })))
        g.add(box(0.4, 0.08, 0.3, std('console', { color: '#eee', emissive: '#4af', emissiveIntensity: 0.6 }), 0.54))
        break
      case 'vase': {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.7, 12), std('vase', { color: '#3f74c9', roughness: 0.3 }))
        v.position.y = 0.35
        g.add(v)
        g.add(box(0.4, 0.5, 0.4, std('plinth', { color: '#ddd' }), 0.25))
        v.position.y = 0.85
        break
      }
      case 'bookcase':
        if (!model('bookcase')) g.add(box(1.2, 2.0, 0.4, std('wood', { map: planks('#8b5e3c') })))
        break
      default:
        g.add(box(p.w, p.h, p.d, std('unknown', { color: '#c99' })))
    }
    return indoorModel(g)
  }

  private prop(kind: string, p: Piece, view: PieceView, fit: (name: string, fallback: () => THREE.Object3D | null, yaw?: number) => THREE.Object3D | null): THREE.Object3D | null {
    const box = (w: number, h: number, d: number, material: THREE.Material, y = h / 2, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(this.box, material)
      mesh.scale.set(w, h, d)
      mesh.position.set(x, y, z)
      mesh.castShadow = this.shadows
      mesh.receiveShadow = true
      return mesh
    }
    const g = new THREE.Group()
    g.rotation.y = p.yaw
    const add = (o: THREE.Object3D | null) => {
      if (o) g.add(o)
      return g
    }
    const snowy = this.theme.snow
    view.colour = '#b9a98f'
    switch (kind) {
      case 'fence':
      case 'snowfence': {
        const f = instance(this.assets, 'fence')
        if (f) {
          f.rotation.y = p.w > p.d ? 0 : Math.PI / 2
          const mw = (f.userData.width as number) || 2
          f.scale.setScalar(Math.max(p.w, p.d) / mw)
          g.add(f)
        } else {
          const white = std('picket', { color: '#f4f4f0' })
          const along = p.w > p.d
          const len = along ? p.w : p.d
          for (let i = 0; i < 7; i++) {
            const t = -len / 2 + (len / 7) * (i + 0.5)
            g.add(box(0.1, 1.0, 0.03, white, 0.5, along ? t : 0, along ? 0 : t))
          }
          g.add(box(along ? len : 0.03, 0.08, along ? 0.03 : len, white, 0.35), box(along ? len : 0.03, 0.08, along ? 0.03 : len, white, 0.75))
        }
        if (kind === 'snowfence') g.add(box(p.w, 0.08, p.d + 0.1, std('snowcap', { color: '#fff' }), 1.0))
        view.colour = '#f4f4f0'
        return g
      }
      case 'mailbox':
        return add(fit('mailbox', () => box(0.3, 0.25, 0.5, std('mailbox', { color: '#333' }), 1.0)))
      case 'hedge': {
        const b = instance(this.assets, 'bush')
        if (b) {
          for (let i = 0; i < Math.max(1, Math.round(p.w)); i++) {
            const c = b.clone()
            c.position.set(-p.w / 2 + 0.5 + i, 0, 0)
            c.scale.setScalar(1.0)
            g.add(c)
          }
        } else g.add(box(p.w, p.h, p.d, std('hedge', { color: '#3f8f3a' })))
        view.colour = '#3f8f3a'
        return g
      }
      case 'bbq':
        return add(fit('bbq', () => box(0.9, 1.0, 0.6, std('bbq', { color: '#222' }))))
      case 'shed':
        return add(fit('shed', () => box(p.w, p.h, p.d, std('shedwall', { map: planks('#9a6b3f') }))))
      case 'gnome':
        return add(fit('gnome', () => box(0.3, 0.6, 0.3, std('gnome', { color: '#d33' }))))
      case 'tree': {
        // A trunk crowned with clumps of the generated hedge foliage (snow-dusted on the lodge street).
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 3.0, 9), std('trunk', { color: '#6b4a2b', roughness: 0.95 }))
        trunk.position.y = 1.5
        trunk.castShadow = this.shadows
        g.add(trunk)
        const bush = instance(this.assets, 'bush')
        const clumps: [number, number, number, number][] = [[0, 3.3, 0, 2.6], [0.9, 2.8, 0.3, 1.8], [-0.85, 3.0, -0.4, 1.9], [0.2, 4.2, -0.2, 1.9], [-0.3, 2.7, 0.8, 1.6]]
        if (bush) {
          if (snowy) this.snowCap(bush)
          for (const [x, y, z, r] of clumps) {
            const c = bush.clone()
            c.scale.setScalar(r / 1.2)
            c.position.set(x, y - r * 0.45, z)
            c.rotation.y = x * 2.1 + z
            g.add(c)
          }
        } else {
          const leaf = std(`leaf-${snowy}`, { color: snowy ? '#e9f1f6' : '#4e9c3a', roughness: 1 })
          for (const [x, y, z, r] of clumps) {
            const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 10, 8), leaf)
            ball.position.set(x, y, z)
            ball.castShadow = this.shadows
            g.add(ball)
          }
        }
        view.colour = '#4e9c3a'
        return g
      }
      case 'pole': {
        // A tarred timber pole with insulators.
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 8.5, 10), std('pole', { color: '#6e5a44', roughness: 0.95 }))
        pole.position.y = 4.25
        pole.castShadow = this.shadows
        g.add(pole)
        for (const off of [-0.8, 0, 0.8]) g.add(box(0.07, 0.16, 0.07, std('insulator', { color: '#5f8c6a', roughness: 0.4 }), 7.95, off, 0))
        // Crossbar and wires strung along the street.
        const bar = box(2.0, 0.12, 0.12, std('pole', { color: '#7a6a55' }), 7.8)
        g.add(bar)
        const wireMat = new THREE.LineBasicMaterial({ color: '#222' })
        for (const off of [-0.8, 0, 0.8]) {
          const pts: THREE.Vector3[] = []
          for (let i = 0; i <= 10; i++) {
            const t = i / 10
            pts.push(new THREE.Vector3(off + (16 * (t - 0.5)), 7.75 - Math.sin(t * Math.PI) * 0.6, 0))
          }
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat))
        }
        return g
      }
      case 'sedan':
      case 'sedan2': {
        const colour = kind === 'sedan' ? '#e2553f' : '#3f7fe0'
        const car = instance(this.assets, 'sedan')
        if (car) {
          // The white car takes the paint colour; glass, chrome and tyres stay dark or bright enough to read.
          car.traverse((o) => {
            const mm = o as THREE.Mesh
            if (mm.isMesh) mm.material = cached(`sedan-${colour}`, () => {
              const c = (mm.material as THREE.MeshStandardMaterial).clone()
              c.color.set(colour).lerp(new THREE.Color('#ffffff'), 0.25)
              return c
            })
          })
          g.add(car)
          view.colour = colour
          return g
        }
        const paint = std(`car-${colour}`, { color: colour, roughness: 0.35, metalness: 0.1 })
        g.add(box(2.0, 0.6, 4.4, paint, 0.65), box(1.7, 0.55, 2.3, paint, 1.2, 0, -0.2))
        view.colour = colour
        return g
      }
      case 'pickup':
        return add(fit('pickup', () => box(2.2, 1.9, 5.2, std('truck', { color: '#2a5a8a' }))))
      case 'snowbank': {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), surf('snow', '#ffffff', { roughness: 1 }))
        s.scale.set(p.w / 2, p.h, p.d / 2)
        s.castShadow = this.shadows
        s.receiveShadow = true
        g.add(s)
        view.colour = '#ffffff'
        return g
      }
      case 'motelsign':
        return add(fit('motelsign', () => this.neonSign('SNOWLINE LODGE', '#ff6ad5', p.h)))
      case 'dinersign':
        return add(this.neonSign('PINE PEAK DINER', '#5ee0ff', p.h))
      case 'pine':
        return add(fit(snowy ? 'pine-snowy' : 'pine', () => {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 8), std('pine', { color: snowy ? '#dfe9f0' : '#2f6b3a' }))
          cone.position.y = 3.5
          return cone
        }))
      case 'caravan': {
        const body = box(2.3, 1.8, 4.6, std('caravan', { color: '#f2efe6', roughness: 0.6 }), 1.4)
        const stripe = box(2.32, 0.3, 4.62, std('caravan-stripe', { color: '#e0533d' }), 1.0)
        const win = box(2.34, 0.5, 1.2, std('caravan-win', { color: '#8fd0ff', roughness: 0.2 }), 1.8, 0, 0.6)
        const wheelMat = std('wheel', { color: '#222' })
        for (const s of [-1, 1]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.25, 12), wheelMat)
          w.rotation.z = Math.PI / 2
          w.position.set(s * 1.1, 0.4, 0.3)
          g.add(w)
        }
        const hitch = box(0.1, 0.1, 1.0, std('hitch', { color: '#555' }), 0.5, 0, 2.6)
        g.add(body, stripe, win, hitch)
        view.colour = '#f2efe6'
        return g
      }
      case 'boat': {
        // Trailer and a small motorboat on top.
        const trailer = box(2.0, 0.12, 5.0, std('hitch', { color: '#555' }), 0.5)
        const wheelMat = std('wheel', { color: '#222' })
        for (const s of [-1, 1]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12), wheelMat)
          w.rotation.z = Math.PI / 2
          w.position.set(s * 1.05, 0.35, -0.4)
          g.add(w)
        }
        const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.6, 5.6, 10, 1, false, 0, Math.PI), std('hull', { color: '#2b74c9', roughness: 0.4 }))
        hull.rotation.z = Math.PI / 2
        hull.rotation.y = Math.PI / 2
        hull.rotation.x = Math.PI
        hull.position.y = 1.5
        hull.scale.set(1, 1, 0.9)
        const deck = box(1.8, 0.1, 5.2, std('deck', { map: planks('#a87c4f') }), 1.5)
        const screen = box(1.6, 0.6, 0.06, std('caravan-win', { color: '#8fd0ff' }), 1.9, 0, 1.2)
        const motor = box(0.4, 0.8, 0.5, std('motor', { color: '#222' }), 1.4, 0, -2.8)
        g.add(trailer, hull, deck, screen, motor)
        view.colour = '#2b74c9'
        return g
      }
      case 'windmill':
        return add(fit('windmill', () => {
          const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 8, 8), std('tower', { color: '#9a9a9a' }))
          tower.position.y = 4
          return tower
        }))
      case 'trampoline':
        return add(fit('trampoline', () => box(3.2, 0.9, 3.2, std('tramp', { color: '#222' }))))
      case 'golfcart':
        return add(fit('golfcart', () => box(1.3, 1.6, 2.4, std('cart', { color: '#eee' }))))
      default:
        return add(box(p.w, p.h, p.d, std('unknown', { color: '#c99' })))
    }
  }

  private neonSign(text: string, colour: string, h: number) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, h - 1.6, 8), std('signpole', { color: '#444' }))
    pole.position.y = (h - 1.6) / 2
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.4, 0.2), std(`neon-${text}`, { map: neon(text, colour), emissive: colour, emissiveMap: neon(text, colour), emissiveIntensity: this.night ? 1.4 : 0.5 }))
    board.position.y = h - 0.8
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 4), std(`neon-arrow-${colour}`, { color: colour, emissive: colour, emissiveIntensity: this.night ? 1.2 : 0.4 }))
    arrow.rotation.z = Math.PI / 2
    arrow.position.set(-2.6, h - 0.8, 0)
    g.add(pole, board, arrow)
    if (this.night) {
      const l = new THREE.PointLight(colour, 20, 14, 1.5)
      l.position.set(0, h - 0.8, 1)
      g.add(l)
      this.lights.push(l)
    }
    return g
  }

  /* ---------- updates ---------- */

  setChip(id: number, chip: number) {
    const v = this.views.get(id)
    if (!v) return
    for (const c of v.cracks) v.group.remove(c)
    v.cracks = []
    if (chip <= 0) return
    const p = v.piece
    const along = p.w >= p.d
    const tex = cracks(chip)
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    for (const s of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(along ? p.w : p.d, p.h), m)
      plane.position.set(along ? 0 : (s * p.w) / 2 + s * 0.005, p.h / 2, along ? (s * p.d) / 2 + s * 0.005 : 0)
      plane.rotation.y = along ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2
      plane.renderOrder = 1
      v.group.add(plane)
      v.cracks.push(plane)
    }
  }

  setBarricade(id: number, level: number) {
    const v = this.views.get(id)
    if (!v) return
    if (v.planks) v.group.remove(v.planks)
    v.planks = null
    if (level <= 0) return
    const p = v.piece
    const g = new THREE.Group()
    const along = Math.abs(Math.sin(p.yaw)) < 0.5
    const wood = std('plank', { map: planks('#c9a36b') })
    const n = level * 2
    for (let i = 0; i < n; i++) {
      const plank = new THREE.Mesh(this.box, wood)
      plank.scale.set(along ? p.w + 0.3 : 0.08, 0.22, along ? 0.08 : p.d + 0.3)
      plank.position.set(along ? 0 : (p.d / 2 + 0.06) * (i % 2 ? 1 : -1), 0.4 + i * (1.4 / n), along ? (p.d / 2 + 0.06) * (i % 2 ? 1 : -1) : 0)
      plank.rotation[along ? 'z' : 'x'] = (i % 2 ? 1 : -1) * 0.2
      plank.castShadow = this.shadows
      g.add(plank)
    }
    v.group.add(g)
    v.planks = g
  }

  move(id: number, x: number, y: number, z: number, yaw: number) {
    const v = this.views.get(id)
    if (!v) return
    v.group.position.set(x, y, z)
    v.group.children.forEach((c) => (c.rotation.y = yaw))
    v.piece.x = x
    v.piece.y = y
    v.piece.z = z
  }

  setCarried(id: number, carried: boolean) {
    const v = this.views.get(id)
    if (v) v.group.visible = !carried
  }

  /** Remove a broken piece; returns its colour for the chunks. */
  remove(id: number) {
    const v = this.views.get(id)
    if (!v) return null
    this.group.remove(v.group)
    this.views.delete(id)
    return v
  }

  colourOf(id: number) {
    return this.views.get(id)?.colour ?? '#b9a98f'
  }

  dispose() {
    this.group.clear()
  }
}
