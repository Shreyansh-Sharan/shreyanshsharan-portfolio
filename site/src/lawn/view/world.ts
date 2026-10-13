// The street and the houses: ground, road and sidewalks, then one mesh per sim piece (wall panels with siding
// and crack overlays, windows, doors with barricade planks, slabs, stairs, roofs, railings, furniture, valuables
// and props from the model manifest or procedural stand-ins). Pieces are keyed by id so chips, barricades, moves
// and breaks update in place.
import * as THREE from 'three'
import { instance, type LawnAssets } from '../engine/assets'
import { HOUSE_THEMES, type HouseTheme } from '../engine/progress'
import type { MapInfo, MapTheme } from '../engine/maps'
import type { Piece } from '../engine/pieces'
import { asphalt, concrete, cracks, grass, neon, planks, rug, shingles, siding, snow, timber } from './textures'

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

const mats = new Map<string, THREE.Material>()
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key)
  if (!m) mats.set(key, (m = make()))
  return m
}
const std = (key: string, opts: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts })) as THREE.MeshStandardMaterial

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

  private buildGround() {
    const { w, h } = this.map
    const snowy = this.theme.snow
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w + 80, h + 80), std(`ground-${snowy}`, { map: snowy ? snow() : grass(this.theme.grass), roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.set(w / 2, 0, h / 2)
    ground.receiveShadow = true
    this.group.add(ground)
    const road = this.map.road
    const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 40, road.z1 - road.z0), std(`road-${snowy}`, { map: asphalt(snowy ? '#8e949c' : this.theme.road), roughness: 1 }))
    roadMesh.rotation.x = -Math.PI / 2
    roadMesh.position.set(w / 2, 0.012, (road.z0 + road.z1) / 2)
    roadMesh.receiveShadow = true
    this.group.add(roadMesh)
    // Cul-de-sac turnaround at the east end.
    const circle = new THREE.Mesh(new THREE.CircleGeometry(9, 40), std(`road-${snowy}`, { map: asphalt(this.theme.road) }))
    circle.rotation.x = -Math.PI / 2
    circle.position.set(w - 6, 0.011, (road.z0 + road.z1) / 2)
    circle.receiveShadow = true
    this.group.add(circle)
    // Centre line.
    if (!snowy) {
      for (let x = 2; x < w - 8; x += 4) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), std('line', { color: '#f2e4a0', roughness: 1 }))
        dash.rotation.x = -Math.PI / 2
        dash.position.set(x, 0.02, (road.z0 + road.z1) / 2)
        this.group.add(dash)
      }
    }
    // Sidewalks and the two front paths.
    for (const z of [road.z0 - 1, road.z1 + 1]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(w + 40, 2), std(`walk-${snowy}`, { map: concrete(snowy ? '#d8dde3' : this.theme.path), roughness: 1 }))
      walk.rotation.x = -Math.PI / 2
      walk.position.set(w / 2, 0.015, z)
      walk.receiveShadow = true
      this.group.add(walk)
    }
    for (const hs of this.map.houses) {
      const z0 = hs.oz + hs.dir * 4.5
      const z1 = hs.dir > 0 ? road.z0 - 2 : road.z1 + 2
      const path = new THREE.Mesh(new THREE.PlaneGeometry(1.4, Math.abs(z1 - z0)), std(`walk-${snowy}`, { map: concrete(this.theme.path) }))
      path.rotation.x = -Math.PI / 2
      path.position.set(hs.ox + hs.dir * 0.75, 0.016, (z0 + z1) / 2)
      this.group.add(path)
      // Driveway to the garage.
      const gx = hs.ox + hs.dir * 8
      const gz0 = hs.oz + hs.dir * 1.5
      const drive = new THREE.Mesh(new THREE.PlaneGeometry(3.4, Math.abs(z1 - gz0)), std(`drive-${snowy}`, { map: concrete(snowy ? '#c9d0d8' : '#b8b2a6') }))
      drive.rotation.x = -Math.PI / 2
      drive.position.set(gx, 0.014, (gz0 + z1) / 2)
      this.group.add(drive)
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

  private build(p: Piece, theme: (typeof HOUSE_THEMES)[HouseTheme], view: PieceView): THREE.Object3D | null {
    const m = p.model
    const lodge = theme.name.includes('lodge')
    const sidingTex = lodge ? timber(theme.siding) : siding(theme.siding)
    const wallMat = std(`wall-${theme.siding}-${lodge}`, { map: sidingTex, roughness: 0.95 })
    const innerMat = std(`inner-${p.house}`, { color: p.house === 0 ? '#f3e9d2' : '#e4ecf0', roughness: 0.95 })
    const trimMat = std(`trim-${theme.trim}`, { color: theme.trim, roughness: 0.8 })
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
    switch (true) {
      case m === 'wall' || m === 'header' || m === 'sill': {
        // Exterior walls: siding outside, paint inside (the inner face is the one toward the house centre).
        const outer = wallMat
        const hs = this.map.houses[p.house]
        const materials = [outer, outer, trimMat, trimMat, outer, outer]
        if (hs && !p.inside) {
          if (p.w >= p.d) materials[hs.oz > p.z ? 4 : 5] = innerMat
          else materials[hs.ox > p.x ? 0 : 1] = innerMat
        }
        const mesh = box(p.w, p.h, p.d, materials)
        view.colour = theme.siding
        if (m === 'sill') {
          const ledge = box(p.w + 0.1, 0.08, p.d + 0.2, trimMat, p.h)
          const g = new THREE.Group()
          g.add(mesh, ledge)
          return g
        }
        return mesh
      }
      case m === 'innerwall': {
        view.colour = '#e8dcc5'
        return box(p.w, p.h, p.d, innerMat)
      }
      case m === 'edge':
        return null
      case m === 'window': {
        const g = new THREE.Group()
        const frame = box(p.w, p.h, p.d + 0.04, trimMat)
        const glassMat = std(`glass-${this.night}-${p.house}`, { color: this.night ? '#ffe7a8' : '#9fd8ff', transparent: true, opacity: this.night ? 0.85 : 0.45, roughness: 0.2, emissive: this.night ? '#ffd27a' : '#000000', emissiveIntensity: this.night ? 0.9 : 0 })
        this.windowMats.push(glassMat)
        const glass = box(p.w - 0.16, p.h - 0.16, p.d + 0.06, glassMat)
        const cross = box(0.05, p.h - 0.16, p.d + 0.08, trimMat)
        const crossH = box(p.w - 0.16, 0.05, p.d + 0.08, trimMat)
        g.add(frame, glass, cross, crossH)
        view.colour = '#c8f2ff'
        return g
      }
      case m === 'door': {
        const g = new THREE.Group()
        const along = Math.abs(Math.sin(p.yaw)) > 0.5
        const doorMat = std(`door-${theme.door}`, { color: theme.door, roughness: 0.7 })
        const panel = box(along ? 0.1 : p.w - 0.1, p.h - 0.05, along ? p.d - 0.1 : 0.1, doorMat)
        const frame = new THREE.Mesh(this.box, trimMat)
        frame.scale.set(along ? p.d + 0.1 : p.w + 0.2, 0.1, along ? 0.12 : p.d + 0.1)
        frame.position.y = p.h + 0.03
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), std('knob', { color: '#e8c35a', metalness: 0.5, roughness: 0.3 }))
        knob.position.set(along ? 0.08 : p.w * 0.35, 1.0, along ? p.d * 0.35 : 0.08)
        g.add(panel, frame, knob)
        if (p.flap) {
          const flap = box(along ? 0.12 : 0.45, 0.4, along ? 0.45 : 0.12, std('flap', { color: '#2a2a2a' }), 0.22)
          g.add(flap)
        }
        // Porch light over the front and back doors at night.
        if (this.night && !p.inside) {
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), std('porch', { color: '#fff1c0', emissive: '#ffd27a', emissiveIntensity: 1.5 }))
          lamp.position.set(along ? -0.4 : 0, p.h + 0.35, along ? 0 : 0.4)
          g.add(lamp)
          const l = new THREE.PointLight('#ffd9a0', 10, 9, 1.5)
          l.position.copy(lamp.position)
          g.add(l)
          this.lights.push(l)
        }
        view.colour = theme.door
        return g
      }
      case m === 'garagedoor': {
        const g = new THREE.Group()
        const door = box(p.w, p.h, p.d, std(`garage-${theme.trim}`, { map: planks('#d9d4c8'), roughness: 0.9 }))
        g.add(door)
        for (let i = 1; i < 4; i++) {
          const seam = box(p.w, 0.03, p.d + 0.02, std('seam', { color: '#8a8378' }), (p.h / 4) * i)
          g.add(seam)
        }
        view.colour = '#d9d4c8'
        return g
      }
      case m === 'floor' || m === 'garagefloor': {
        const mesh = box(p.w, p.h, p.d, std(m === 'floor' ? `floor-${p.house}` : 'garagefloor', m === 'floor' ? { map: planks('#c49a6c') } : { map: concrete('#9a9a92') }))
        mesh.castShadow = false
        return mesh
      }
      case m === 'slab' || m === 'balcony' || m === 'garageroof': {
        const top = m === 'balcony' || m === 'garageroof' ? std('deck', { map: planks('#a87c4f') }) : std(`floor-${p.house}`, { map: planks('#c49a6c') })
        const bottom = std('ceiling', { color: '#f5f1ea' })
        const side = trimMat
        return box(p.w, p.h, p.d, [side, side, top, bottom, side, side])
      }
      case m === 'step':
        return box(p.w, p.h, p.d, std('stair', { map: planks('#b98a55') }))
      case m === 'roof': {
        const roofMat = std(`roof-${theme.roof}`, { map: lodge ? snow() : shingles(theme.roof), roughness: 1 })
        return box(p.w, p.h, p.d, [trimMat, trimMat, roofMat, trimMat, trimMat, trimMat])
      }
      case m === 'attic': {
        // A pitched ridge: a triangular prism along x.
        const shape = new THREE.Shape()
        shape.moveTo(-p.d / 2, 0)
        shape.lineTo(p.d / 2, 0)
        shape.lineTo(0, p.h)
        shape.closePath()
        const geo = new THREE.ExtrudeGeometry(shape, { depth: p.w, bevelEnabled: false })
        geo.rotateY(Math.PI / 2)
        geo.translate(-p.w / 2, 0, 0)
        const mesh = new THREE.Mesh(geo, std(`roof-${theme.roof}`, { map: lodge ? snow() : shingles(theme.roof) }))
        mesh.castShadow = this.shadows
        mesh.receiveShadow = true
        const chimney = box(0.6, 1.4, 0.6, std('chimney', { color: '#8a5a4a' }), 0.5)
        chimney.position.set(p.w * 0.3, 0, 0)
        const g = new THREE.Group()
        g.add(mesh, chimney)
        return g
      }
      case m === 'rail' || m === 'parapet': {
        const g = new THREE.Group()
        const along = p.w > p.d
        const len = along ? p.w : p.d
        const top = box(along ? len : 0.08, 0.08, along ? 0.08 : len, trimMat, p.h)
        g.add(top)
        const n = Math.max(2, Math.round(len / 0.5))
        for (let i = 0; i <= n; i++) {
          const post = box(0.05, p.h, 0.05, trimMat)
          const t = -len / 2 + (len / n) * i
          post.position.set(along ? t : 0, p.h / 2, along ? 0 : t)
          g.add(post)
        }
        if (m === 'parapet') {
          const wall = box(p.w, p.h, p.d, std(`wall-${theme.siding}-${lodge}`, { map: sidingTex }))
          g.add(wall)
        }
        return g
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
        const wood = std('ladder', { color: '#b9814f' })
        for (const s of [-1, 1]) {
          const rail = box(0.06, top, 0.06, wood)
          rail.position.x = s * 0.25
          g.add(rail)
        }
        for (let y = 0.3; y < top; y += 0.35) {
          const rung = box(0.5, 0.04, 0.04, wood, y)
          g.add(rung)
        }
        g.rotation.x = -0.2
        return g
      }
      default:
        return box(p.w, p.h, p.d, std('unknown', { color: '#c99' }))
    }
  }

  private furniture(kind: string, p: Piece, theme: (typeof HOUSE_THEMES)[HouseTheme], view: PieceView): THREE.Object3D | null {
    const wood = std('wood', { map: planks('#8b5e3c') })
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
      case 'sink':
        if (!model('sink')) g.add(box(0.6, 0.85, 0.45, std('porcelain', { color: '#fff' })))
        view.colour = '#ffffff'
        break
      case 'desk':
        g.add(box(p.w, 0.05, p.d, wood, p.h), box(0.5, p.h, p.d - 0.1, wood, p.h / 2, -p.w / 2 + 0.3), box(0.06, p.h, 0.06, wood, p.h / 2, p.w / 2 - 0.1, p.d / 2 - 0.1), box(0.06, p.h, 0.06, wood, p.h / 2, p.w / 2 - 0.1, -p.d / 2 + 0.1))
        g.add(box(0.5, 0.35, 0.03, std('screen', { color: '#223', emissive: '#4ac', emissiveIntensity: 0.4 }), p.h + 0.25, 0.2, -0.1))
        break
      case 'toolrack': {
        if (!model('toolrack')) g.add(box(0.1, p.h, p.d, wood))
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
        const tank = instance(this.assets, 'aquarium')
        g.add(box(1.4, 0.6, 0.6, std('tankstand', { color: '#333' })))
        if (tank) {
          const mh = (tank.userData.height as number) || 0.5
          tank.scale.setScalar(0.5 / mh)
          tank.position.y = 0.6
          g.add(tank)
        }
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
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 8), std('trunk', { color: '#6b4a2b' }))
        trunk.position.y = 1.3
        trunk.castShadow = this.shadows
        g.add(trunk)
        const leaf = std(`leaf-${snowy}`, { color: snowy ? '#e9f1f6' : '#4e9c3a', roughness: 1 })
        for (const [x, y, z, r] of [[0, 3.4, 0, 1.6], [0.9, 2.9, 0.3, 1.1], [-0.8, 3.1, -0.4, 1.2], [0.2, 4.4, -0.2, 1.1]]) {
          const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), leaf)
          ball.position.set(x, y, z)
          ball.castShadow = this.shadows
          g.add(ball)
        }
        view.colour = '#4e9c3a'
        return g
      }
      case 'pole': {
        const pole = fit('pole', () => box(0.3, 8.5, 0.3, std('pole', { color: '#7a6a55' })))
        if (pole) g.add(pole)
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
        const colour = kind === 'sedan' ? '#d9452f' : '#2f6fdd'
        const paint = std(`car-${colour}`, { color: colour, roughness: 0.35, metalness: 0.1 })
        g.add(box(2.0, 0.6, 4.4, paint, 0.65), box(1.7, 0.55, 2.3, paint, 1.2, 0, -0.2))
        g.add(box(1.72, 0.4, 1.9, std('car-glass', { color: '#9fd8ff', roughness: 0.1 }), 1.25, 0, -0.2))
        const wheelMat = std('wheel', { color: '#222' })
        for (const [sx, sz] of [[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12), wheelMat)
          w.rotation.z = Math.PI / 2
          w.position.set(sx * 0.95, 0.34, sz)
          g.add(w)
        }
        g.add(box(0.5, 0.15, 0.1, std('lamp-head', { color: '#fff1c0', emissive: '#ffe9a8', emissiveIntensity: this.night ? 1.2 : 0.2 }), 0.7, -0.6, 2.2), box(0.5, 0.15, 0.1, std('lamp-head', { color: '#fff1c0' }), 0.7, 0.6, 2.2))
        view.colour = colour
        return g
      }
      case 'pickup':
        return add(fit('pickup', () => box(2.2, 1.9, 5.2, std('truck', { color: '#2a5a8a' })), Math.PI / 2))
      case 'snowbank': {
        const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), std('snowbank', { map: snow(), roughness: 1 }))
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
        return add(fit('golfcart', () => box(1.3, 1.6, 2.4, std('cart', { color: '#eee' })), Math.PI / 2))
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
