// The street and the houses: textured ground, road and sidewalks, then one mesh per sim piece. Plain wall panels
// are boxes with tiling siding outside and wallpaper inside (world-space UVs, so boards line up across panels) plus
// a brick plinth and corner boards; windows, doors, the garage door, the balcony, the stairs, the gable roof and
// the front portico are the generated house-kit models fitted to their panels and tinted per house theme. Pieces
// are keyed by id so chips (crack overlays), barricades, moves and breaks update in place.
import * as THREE from 'three'
import { instance, type LawnAssets } from '../engine/assets'
import { HOUSE_THEMES, type HouseTheme } from '../engine/progress'
import type { MapInfo, MapTheme } from '../engine/maps'
import type { Piece } from '../engine/pieces'
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

const mats = new Map<string, THREE.Material>()
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key)
  if (!m) mats.set(key, (m = make()))
  return m
}
const std = (key: string, opts: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts })) as THREE.MeshStandardMaterial

/* ---------- tiling textures (UVs are in metres; each texture repeats every `tile` metres) ---------- */

const TILE: Record<string, number> = { siding: 1.6, brick: 1.4, shingles: 2.2, oak: 2.2, wallpaper: 1.2, tiles: 2.4, grass: 5, asphalt: 7, sidewalk: 2, snow: 6 }
const texBase = `${import.meta.env.BASE_URL}lawn/textures/`
const texCache = new Map<string, THREE.Texture>()
let texLoader: THREE.TextureLoader | null = null
function tiled(name: keyof typeof TILE | string) {
  let t = texCache.get(name)
  if (!t) {
    texLoader ??= new THREE.TextureLoader()
    t = texLoader.load(`${texBase}${name}.webp`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    const k = 1 / (TILE[name] ?? 2)
    t.repeat.set(k, k)
    texCache.set(name, t)
  }
  return t
}
const surf = (name: string, tint = '#ffffff', extra: THREE.MeshStandardMaterialParameters = {}) => std(`tex-${name}-${tint}`, { map: tiled(name), color: tint, roughness: 0.92, ...extra })

/** World-space planar UVs (metres) for an axis-aligned mesh placed at `at`. */
function worldUV(geo: THREE.BufferGeometry, at: THREE.Vector3) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + at.x
    const y = pos.getY(i) + at.y
    const z = pos.getZ(i) + at.z
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    if (ny > 0.5) {
      uv[i * 2] = x
      uv[i * 2 + 1] = z
    } else if (nx > 0.5) {
      uv[i * 2] = z
      uv[i * 2 + 1] = y
    } else {
      uv[i * 2] = x
      uv[i * 2 + 1] = y
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

/** Copy of a (possibly quantised) mesh geometry with its transform relative to `root` baked in, as plain floats. */
function bakedGeometry(mesh: THREE.Mesh, root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld)
  const src = mesh.geometry
  const g = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.attributes[name] as THREE.BufferAttribute | undefined
    if (!a) continue
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k)
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
  }
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>))
  g.applyMatrix4(m)
  return g
}

export class World {
  readonly group = new THREE.Group()
  readonly views = new Map<number, PieceView>()
  private assets: LawnAssets
  private map: MapInfo
  private theme: MapTheme
  private houseThemes: [HouseTheme, HouseTheme]
  private night: boolean
  private windowMats: THREE.MeshStandardMaterial[] = []
  private box = new THREE.BoxGeometry(1, 1, 1)
  readonly lights: THREE.PointLight[] = []
  shadows: boolean

  constructor(assets: LawnAssets, map: MapInfo, theme: MapTheme, houseThemes: [HouseTheme, HouseTheme], night: boolean, shadows: boolean) {
    this.assets = assets
    this.map = map
    this.theme = theme
    this.houseThemes = houseThemes
    this.night = night
    this.shadows = shadows
    this.buildGround()
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
    const nightTint = this.night ? '#aab4c8' : '#ffffff'
    this.flat(w + 80, h + 80, w / 2, 0, h / 2, snowy ? surf('snow', this.night ? '#c4cee0' : '#ffffff', { roughness: 1 }) : surf('grass', this.night ? '#8fa0b4' : '#f2fff0', { roughness: 1 }))
    const road = this.map.road
    const roadMat = surf('asphalt', snowy ? (this.night ? '#8a93a3' : '#c3c8cf') : nightTint, { roughness: 0.95 })
    this.flat(w + 40, road.z1 - road.z0, w / 2, 0.012, (road.z0 + road.z1) / 2, roadMat)
    // Cul-de-sac turnaround at the east end.
    this.flat(0, 0, w - 6, 0.011, (road.z0 + road.z1) / 2, roadMat, 9)
    // Centre line.
    if (!snowy) {
      for (let x = 2; x < w - 8; x += 4) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), std('line', { color: '#f2e4a0', roughness: 1 }))
        dash.rotation.x = -Math.PI / 2
        dash.position.set(x, 0.02, (road.z0 + road.z1) / 2)
        this.group.add(dash)
      }
    }
    // Sidewalks with kerbs, the front paths and the driveways.
    const walkMat = surf('sidewalk', snowy ? '#e8eef4' : nightTint, { roughness: 1 })
    for (const z of [road.z0 - 1, road.z1 + 1]) {
      this.flat(w + 40, 2, w / 2, 0.015, z, walkMat)
      const kerb = new THREE.Mesh(this.box, std('kerb', { color: snowy ? '#dfe5ea' : '#b9b5ad', roughness: 0.9 }))
      kerb.scale.set(w + 40, 0.1, 0.16)
      kerb.position.set(w / 2, 0.05, z + (z < road.z0 ? 1 : -1))
      kerb.receiveShadow = true
      this.group.add(kerb)
    }
    for (const hs of this.map.houses) {
      const z0 = hs.oz + hs.dir * 4.5
      const z1 = hs.dir > 0 ? road.z0 - 2 : road.z1 + 2
      this.flat(1.4, Math.abs(z1 - z0), hs.ox + hs.dir * 0.75, 0.016, (z0 + z1) / 2, walkMat)
      // Driveway to the garage.
      const gx = hs.ox + hs.dir * 8
      const gz0 = hs.oz + hs.dir * 1.5
      this.flat(3.4, Math.abs(z1 - gz0), gx, 0.014, (gz0 + z1) / 2, surf('sidewalk', snowy ? '#d9e0e8' : this.night ? '#9aa2b0' : '#e6e0d6', { roughness: 1 }))
    }
    // Warm interior lights so rooms read even in the sun's shadow (and glow at night).
    if (this.shadows || this.night)
      for (const hs of this.map.houses)
        for (const [lx, lz, ly] of [[-3, 0, 2.6], [4, 0, 2.6], [8, -1.5, 2.6], [-3, 0, 5.8], [4, 0, 5.8]]) {
          const l = new THREE.PointLight(this.night ? '#ffd9a0' : '#fff4e0', this.night ? 14 : 9, 9, 1.4)
          l.position.set(hs.ox + hs.dir * lx, ly, hs.oz + hs.dir * lz)
          this.group.add(l)
          this.lights.push(l)
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

  /** Dust a model's upward faces with snow (lodge street). */
  private snowCap(obj: THREE.Object3D) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      const c = src.clone()
      c.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUpN = normalize(mat3(modelMatrix) * objectNormal).y;')
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUpN;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), smoothstep(0.35, 0.7, vUpN));')
      }
      c.customProgramCacheKey = () => 'snowcap'
      m.material = c
    })
  }

  private addStreetLamp(x: number, z: number) {
    const g = new THREE.Group()
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5, 8), std('lamp-pole', { color: '#3a3f4a', roughness: 0.6 }))
    pole.position.y = 2.5
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), std('lamp-pole', { color: '#3a3f4a' }))
    arm.position.set(0.5, 5, 0)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), std('lamp-head', { color: '#f8f1d0', emissive: '#ffe9a8', emissiveIntensity: this.night ? 1.2 : 0 }))
    head.position.set(1.0, 4.95, 0)
    g.add(pole, arm, head)
    g.position.set(x, 0, z)
    this.group.add(g)
    if (this.night) {
      const l = new THREE.PointLight('#ffe2a0', 18, 16, 1.6)
      l.position.set(1.0, 4.7, 0)
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
    const theme = HOUSE_THEMES[(p.house >= 0 ? this.houseThemes[p.house] : 'lemon') as HouseTheme] ?? HOUSE_THEMES.lemon
    const group = new THREE.Group()
    group.position.set(p.x, p.y, p.z)
    const view: PieceView = { piece: p, group, cracks: [], planks: null, colour: theme.siding }
    const built = this.build(p, theme, view)
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
  private sidingMat(theme: Theme) {
    return surf('siding', theme.siding, { roughness: 0.9 })
  }
  private paperMat(house: number) {
    return surf('wallpaper', house === 0 ? '#fff8ee' : '#e6f0ff', { roughness: 0.95 })
  }
  private trimMat(theme: Theme) {
    return std(`trim-${theme.trim}`, { color: theme.trim, roughness: 0.7 })
  }
  private roofMat(theme: Theme) {
    return this.lodge(theme) ? surf('snow', '#ffffff', { roughness: 1 }) : surf('shingles', theme.roof, { roughness: 0.95 })
  }
  private floorMat() {
    return surf('oak', '#ffffff', { roughness: 0.7 })
  }
  /** A tinted copy of a kit material, cached per tint. */
  private kitMat(src: THREE.MeshStandardMaterial, tint: string, extra?: (m: THREE.MeshStandardMaterial) => void) {
    return mat(`kit-${src.uuid}-${tint}-${extra ? 'x' : ''}`, () => {
      const m = src.clone()
      m.color.set(tint)
      extra?.(m)
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

  /**
   * A kit model with only the named parts kept, each tinted. Returns a group in the kit's own metre space
   * (x across the opening, y up from the floor, +z outside).
   */
  private kit(name: string, parts: Record<string, string | null>, night?: boolean) {
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
      if (tint) m.material = this.kitMat(src, tint, night ? (mm) => {
        mm.emissive = new THREE.Color('#ffd27a')
        mm.emissiveIntensity = 0.75
      } : undefined)
      m.castShadow = this.shadows
      m.receiveShadow = true
    })
    return obj
  }

  /** A box in a kit group's space (x0..x1, y0..y1, z0..z1). */
  private kbox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: THREE.Material | THREE.Material[]) {
    const mesh = new THREE.Mesh(this.box, material)
    mesh.scale.set(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), Math.max(0.001, z1 - z0))
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    mesh.castShadow = this.shadows
    mesh.receiveShadow = true
    return mesh
  }

  /** Wallpaper backing and trim jambs around an opening (kit space; the wall is z -0.15..0.15). */
  private openingLining(g: THREE.Group, half: number, hx: number, hy0: number, hy1: number, top: number, theme: Theme, house: number, yOff: number) {
    const paper = this.paperMat(house)
    const trim = this.trimMat(theme)
    const z0 = -0.15
    const z1 = 0.0
    if (hy0 > 0.01) g.add(this.kbox(-half, half, yOff, yOff + hy0, z0, z1, paper))
    if (top > hy1 + 0.01) g.add(this.kbox(-half, half, yOff + hy1, yOff + top, z0, z1, paper))
    if (half > hx + 0.01) {
      g.add(this.kbox(-half, -hx, yOff + hy0, yOff + hy1, z0, z1, paper))
      g.add(this.kbox(hx, half, yOff + hy0, yOff + hy1, z0, z1, paper))
    }
    // Jambs lining the hole through the wall's depth.
    const t = 0.05
    g.add(this.kbox(-hx - t, -hx, yOff + hy0, yOff + hy1, -0.16, 0.16, trim))
    g.add(this.kbox(hx, hx + t, yOff + hy0, yOff + hy1, -0.16, 0.16, trim))
    g.add(this.kbox(-hx - t, hx + t, yOff + hy1, yOff + hy1 + t, -0.16, 0.16, trim))
    if (hy0 > 0.01) g.add(this.kbox(-hx - t, hx + t, yOff + hy0 - t, yOff + hy0, -0.16, 0.18, trim))
  }

  private build(p: Piece, theme: Theme, view: PieceView): THREE.Object3D | null {
    const m = p.model
    const lodge = this.lodge(theme)
    const trimMat = this.trimMat(theme)
    const sidingMat = this.sidingMat(theme)
    const box = (w: number, h: number, d: number, material: THREE.Material | THREE.Material[], y = h / 2) => {
      const mesh = new THREE.Mesh(this.box, material)
      mesh.scale.set(w, h, d)
      mesh.position.y = y
      mesh.castShadow = this.shadows
      mesh.receiveShadow = true
      return mesh
    }
    /** A box with world-space UVs (for tiling textures), bottom at y=0 of the piece. */
    const tbox = (w: number, h: number, d: number, material: THREE.Material | THREE.Material[], x = 0, y = h / 2, z = 0) => {
      const geo = new THREE.BoxGeometry(w, h, d)
      worldUV(geo, new THREE.Vector3(p.x + x, p.y + y, p.z + z))
      const mesh = new THREE.Mesh(geo, material)
      mesh.position.set(x, y, z)
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
    const along = p.w >= p.d
    const len = along ? p.w : p.d
    /** A group turned so a kit part's +Z faces out of this wall. */
    const kitGroup = () => {
      const g = new THREE.Group()
      g.rotation.y = this.kitYaw(p)
      return g
    }
    switch (true) {
      case m === 'wall': {
        // Exterior panel: siding outside, wallpaper inside, trim on the cut edges; a brick plinth and corner boards.
        const materials: THREE.Material[] = [sidingMat, sidingMat, trimMat, trimMat, sidingMat, sidingMat]
        const o = this.outward(p)
        if (along) materials[o > 0 ? 5 : 4] = this.paperMat(p.house)
        else materials[o > 0 ? 1 : 0] = this.paperMat(p.house)
        const g = new THREE.Group()
        g.add(tbox(p.w, p.h, p.d, materials))
        const k = kitGroup()
        if (p.y < 0.5) k.add(this.kbox(-len / 2, len / 2, 0, 0.42, 0.13, 0.19, surf('brick', lodge ? '#c9c2b8' : '#ffffff')))
        else k.add(this.kbox(-len / 2, len / 2, -0.05, 0.12, 0.13, 0.19, trimMat))
        // Corner boards where this panel ends on a corner of the house or the garage.
        const hs = this.map.houses[p.house]
        if (hs) {
          const corners = [[-6, -4.5], [6, -4.5], [-6, 4.5], [6, 4.5], [10, -4.5], [10, 1.5]].map(([x, z]) => [hs.ox + x * hs.dir, hs.oz + z * hs.dir])
          for (const s of [-1, 1]) {
            const ex = along ? p.x + (s * p.w) / 2 : p.x
            const ez = along ? p.z : p.z + (s * p.d) / 2
            if (corners.some(([cx, cz]) => Math.hypot(cx - ex, cz - ez) < 0.4)) {
              // In kit space the end at +-len/2 maps to s depending on the yaw; place a post at both candidate ends only if matched.
              const sx = along ? (o > 0 ? s : -s) : o > 0 ? -s : s
              k.add(this.kbox(sx * len / 2 - 0.08, sx * len / 2 + 0.08, 0, p.h, 0.1, 0.22, trimMat))
            }
          }
        }
        g.add(k)
        view.colour = theme.siding
        return g
      }
      case m === 'sill': {
        // The window wall: the kit frame (siding, trim, shutters) over the whole opening, wallpaper inside.
        const g = kitGroup()
        const sx = len / 2
        const frame = this.kit('kit-window', { siding: theme.siding, trim: theme.trim, shutters: theme.door })
        if (frame) {
          frame.scale.set(sx, 1, 1)
          g.add(frame)
        } else g.add(this.kbox(-sx, sx, 0, p.h, -0.15, 0.15, sidingMat))
        this.openingLining(g, sx, 0.72 * sx, 0.95, 2.15, 3.0, theme, p.house, 0)
        view.colour = theme.siding
        return g
      }
      case m === 'header:window':
        return null
      case m === 'window': {
        // The glass sash: breaks away and leaves the hole in the kit frame.
        const g = kitGroup()
        const glass = this.kit('kit-window', { glass: '#ffffff' }, this.night)
        if (glass) {
          glass.scale.set(len / 2, 1, 1)
          glass.position.y = -0.9
          g.add(glass)
          glass.traverse((o) => {
            const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
            if (mm && (o as THREE.Mesh).visible && !this.windowMats.includes(mm)) this.windowMats.push(mm)
          })
        } else {
          const glassMat = std(`glass-${this.night}`, { color: this.night ? '#ffe7a8' : '#9fd8ff', transparent: true, opacity: 0.5, roughness: 0.2, emissive: this.night ? '#ffd27a' : '#000000', emissiveIntensity: this.night ? 0.9 : 0 })
          g.add(this.kbox(-0.72 * (len / 2), 0.72 * (len / 2), 0.05, 1.25, -0.03, 0.03, glassMat))
        }
        view.colour = '#c8f2ff'
        return g
      }
      case m === 'door': {
        const g = kitGroup()
        const leaf = this.kit('kit-door', { leaf: theme.door })
        if (leaf) {
          leaf.scale.set(len, 1, 1)
          g.add(leaf)
        } else g.add(this.kbox(-len / 2 + 0.03, len / 2 - 0.03, 0, p.h - 0.03, -0.05, 0.05, std(`door-${theme.door}`, { color: theme.door, roughness: 0.7 })))
        if (p.flap) g.add(this.kbox(-0.22, 0.22, 0.04, 0.42, -0.19, 0.19, std('flap', { color: '#2a2a2a' })))
        // Porch light beside the door at night.
        if (this.night && !p.inside) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), std('porch', { color: '#fff1c0', emissive: '#ffd27a', emissiveIntensity: 1.5 }))
          lamp.position.set(0.75 * len, p.h + 0.1, 0.3)
          g.add(lamp)
          const l = new THREE.PointLight('#ffd9a0', 10, 9, 1.5)
          l.position.copy(lamp.position)
          g.add(l)
          this.lights.push(l)
        }
        view.colour = theme.door
        return g
      }
      case m === 'header:door' || m === 'header:frontdoor': {
        const g = kitGroup()
        const frame = this.kit('kit-door', { siding: theme.siding, trim: theme.trim })
        if (frame) {
          frame.scale.set(len, 1, 1)
          frame.position.y = -2.1
          g.add(frame)
        } else g.add(this.kbox(-len / 2, len / 2, 0, p.h, -0.15, 0.15, sidingMat))
        this.openingLining(g, len / 2, 0.47 * len, 0, 2.1, 3.0, theme, p.house, -2.1)
        if (m === 'header:frontdoor') {
          const porch = this.kit('kit-porch', { posts: theme.trim, roof: lodge ? '#ffffff' : theme.roof })
          if (porch) {
            porch.position.set(0, -2.1, 0.17 + 0.8)
            g.add(porch)
          }
        }
        view.colour = theme.siding
        return g
      }
      case m === 'garagedoor': {
        const g = kitGroup()
        const leaf = this.kit('kit-garage', { leaf: lodge ? '#e8dccb' : '#f4f1ea' })
        if (leaf) {
          leaf.scale.set(len / 3, 1, 1)
          g.add(leaf)
        } else g.add(this.kbox(-len / 2, len / 2, 0, p.h, -0.08, 0.08, std('garage', { map: planks('#d9d4c8') })))
        view.colour = '#d9d4c8'
        return g
      }
      case m === 'header:garage': {
        const g = kitGroup()
        const frame = this.kit('kit-garage', { siding: theme.siding, trim: theme.trim })
        if (frame) {
          frame.scale.set(len / 3, 1, 1)
          frame.position.y = -2.5
          g.add(frame)
        } else g.add(this.kbox(-len / 2, len / 2, 0, p.h, -0.15, 0.15, sidingMat))
        this.openingLining(g, len / 2, len / 2, 0, 2.5, 3.0, theme, p.house, -2.5)
        view.colour = theme.siding
        return g
      }
      case m === 'header:gap': {
        // An interior doorway: papered lintel with a painted casing.
        const g = new THREE.Group()
        g.add(tbox(p.w, p.h, p.d, this.paperMat(p.house)))
        g.add(box(along ? p.w + 0.12 : p.w + 0.04, 0.1, along ? p.d + 0.04 : p.d + 0.12, trimMat, 0.05))
        view.colour = '#e8dcc5'
        return g
      }
      case m === 'innerwall': {
        view.colour = '#e8dcc5'
        const g = new THREE.Group()
        g.add(tbox(p.w, p.h, p.d, this.paperMat(p.house)))
        // Skirting boards on both faces.
        g.add(box(along ? p.w : p.w + 0.03, 0.12, along ? p.d + 0.03 : p.d, std('skirting', { color: '#f4efe6', roughness: 0.6 }), 0.06))
        return g
      }
      case m === 'edge':
        return null
      case m === 'floor' || m === 'garagefloor': {
        const g = new THREE.Group()
        const mesh = tbox(p.w, p.h, p.d, m === 'floor' ? this.floorMat() : surf('sidewalk', '#b4b0a8', { roughness: 1 }))
        mesh.castShadow = false
        g.add(mesh)
        if (m === 'floor') {
          // Kitchen tiles in the kitchen (local x 2..6), mirrored with the house.
          const hs = this.map.houses[p.house]
          const dir = hs?.dir ?? 1
          const tile = new THREE.PlaneGeometry(4, 9)
          tile.rotateX(-Math.PI / 2)
          worldUV(tile, new THREE.Vector3(p.x + dir * 4, p.y + p.h + 0.004, p.z))
          const tm = new THREE.Mesh(tile, surf('tiles', '#ffffff', { roughness: 0.4 }))
          tm.position.set(dir * 4, p.h + 0.004, 0)
          tm.receiveShadow = true
          g.add(tm)
        }
        return g
      }
      case m === 'slab' || m === 'garageroof': {
        const top = m === 'garageroof' ? this.roofMat(theme) : this.floorMat()
        const bottom = std('ceiling', { color: '#f5f1ea' })
        return tbox(p.w, p.h, p.d, [trimMat, trimMat, top, bottom, trimMat, trimMat])
      }
      case m === 'balcony': {
        const k = this.kit('kit-balcony', { balcony: '#ffffff' })
        if (!k) return tbox(p.w, p.h, p.d, [trimMat, trimMat, this.floorMat(), trimMat, trimMat, trimMat])
        const g = new THREE.Group()
        const hs = this.map.houses[p.house]
        g.rotation.y = hs && p.z < hs.oz ? Math.PI : 0
        g.add(k)
        return g
      }
      case m === 'rail':
        // The balcony kit carries its own railings.
        return this.assets.models.has('kit-balcony') ? null : this.railing(p, trimMat, sidingMat, false)
      case m === 'step': {
        // The whole flight is one kit model, hung off the bottom step; the other steps are collision only.
        if (p.h > 0.3) return null
        const k = this.kit('kit-stairs', { stairs: '#ffffff' })
        if (!k) return box(p.w, p.h, p.d, std('stair', { map: planks('#b98a55') }))
        const g = new THREE.Group()
        g.rotation.y = p.yaw
        k.position.z = 0.15
        g.add(k)
        return g
      }
      case m === 'roof': {
        // The flat roof deck over the front rooms: decking (or snow), fascia on the edges.
        const top = lodge ? surf('snow', '#ffffff', { roughness: 1 }) : surf('oak', '#a99a8a', { roughness: 0.9 })
        return tbox(p.w, p.h, p.d, [trimMat, trimMat, top, std('ceiling', { color: '#f5f1ea' }), trimMat, trimMat])
      }
      case m === 'attic': {
        // The gable roof kit over the back rooms: tiled shingles on the slopes, painted gables, a brick chimney.
        const g = new THREE.Group()
        g.rotation.y = p.yaw
        const k = instance(this.assets, 'kit-roof')
        if (k) {
          k.updateMatrixWorld(true)
          k.traverse((o) => {
            const mesh = o as THREE.Mesh
            if (!mesh.isMesh) return
            const src = mesh.material as THREE.MeshStandardMaterial
            const geo = bakedGeometry(mesh, k)
            geo.scale(p.w, p.h, p.d)
            let material: THREE.Material
            if (src.name === 'slopes') {
              // Shingle UVs in metres: along the ridge, and down the slope.
              const pos = geo.attributes.position
              const uv = new Float32Array(pos.count * 2)
              for (let i = 0; i < pos.count; i++) {
                uv[i * 2] = pos.getX(i)
                uv[i * 2 + 1] = pos.getY(i) + Math.abs(pos.getZ(i)) * 0.9
              }
              geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
              material = this.roofMat(theme)
            } else material = this.kitMat(src, lodge ? theme.trim : theme.siding)
            const out = new THREE.Mesh(geo, material)
            out.castShadow = this.shadows
            out.receiveShadow = true
            g.add(out)
          })
        } else {
          const shape = new THREE.Shape()
          shape.moveTo(-p.d / 2, 0)
          shape.lineTo(p.d / 2, 0)
          shape.lineTo(0, p.h)
          shape.closePath()
          const geo = new THREE.ExtrudeGeometry(shape, { depth: p.w, bevelEnabled: false })
          geo.rotateY(Math.PI / 2)
          geo.translate(-p.w / 2, 0, 0)
          g.add(new THREE.Mesh(geo, this.roofMat(theme)))
        }
        const brick = surf('brick', '#ffffff')
        const chimney = new THREE.Mesh(this.box, brick)
        chimney.scale.set(0.75, p.h * 0.75 + 0.9, 0.75)
        chimney.position.set(-0.34 * p.w, p.h * 0.45 + (p.h * 0.75 + 0.9) / 2, -0.14 * p.d)
        chimney.castShadow = this.shadows
        const cap = box(0.95, 0.12, 0.95, std('chimney-cap', { color: '#6e6a66' }))
        cap.position.set(chimney.position.x, p.h * 0.45 + p.h * 0.75 + 0.9 + 0.06, chimney.position.z)
        g.add(chimney, cap)
        return g
      }
      case m === 'parapet':
        return this.railing(p, trimMat, sidingMat, true)
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

  /** Posts and a top rail (the roof parapet also gets a low sided wall). */
  private railing(p: Piece, trimMat: THREE.Material, sidingMat: THREE.Material, wall: boolean) {
    const g = new THREE.Group()
    const along = p.w > p.d
    const len = along ? p.w : p.d
    const bx = (w: number, h: number, d: number, material: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(this.box, material)
      mesh.scale.set(w, h, d)
      mesh.position.y = y
      mesh.castShadow = this.shadows
      mesh.receiveShadow = true
      return mesh
    }
    g.add(bx(along ? len : 0.1, 0.08, along ? 0.1 : len, trimMat, p.h))
    const n = Math.max(2, Math.round(len / 0.5))
    for (let i = 0; i <= n; i++) {
      const post = bx(0.05, p.h, 0.05, trimMat, p.h / 2)
      const t = -len / 2 + (len / n) * i
      post.position.set(along ? t : 0, p.h / 2, along ? 0 : t)
      g.add(post)
    }
    if (wall) {
      const geo = new THREE.BoxGeometry(p.w, p.h, p.d)
      worldUV(geo, new THREE.Vector3(p.x, p.y + p.h / 2, p.z))
      const w = new THREE.Mesh(geo, sidingMat)
      w.position.y = p.h / 2
      w.castShadow = this.shadows
      g.add(w)
    }
    return g
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
    return g
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
    return g
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
            if (mm.isMesh) mm.material = mat(`sedan-${colour}`, () => {
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
