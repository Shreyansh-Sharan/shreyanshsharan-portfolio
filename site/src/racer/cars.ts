// The garage: eight original cars across four classes, the rival drivers, and flat-shaded car meshes.
import * as THREE from 'three'
import { CONFIG } from './config'
import { normalizeModel } from './assets'

export type CarClass = 'D' | 'C' | 'B' | 'A'

export interface CarStats {
  speed: number // 1–10 each
  accel: number
  grip: number
  drift: number
  stability: number
}

interface Shape {
  len: number
  width: number
  height: number
  cabLen: number
  cabH: number
  cabOffset: number // + forward
  wheelR: number
  ride: number
  spoiler?: boolean
  box?: boolean // van-like cabin that runs to the back
}

export interface CarModel {
  id: string
  name: string
  archetype: string
  cls: CarClass
  stats: CarStats
  color: string
  glow: string
  unlock: number // Fan Level that unlocks it in the career (not enforced in this build)
  shape: Shape
}

export const CARS: CarModel[] = [
  {
    id: 'wasp', name: 'Wasp Hatch', archetype: 'Hot hatch', cls: 'D', color: '#facc15', glow: '#fde047', unlock: 1,
    stats: { speed: 4, accel: 7, grip: 8, drift: 4, stability: 6 },
    shape: { len: 3.9, width: 1.8, height: 0.62, cabLen: 2.0, cabH: 0.62, cabOffset: -0.3, wheelR: 0.34, ride: 0.32 },
  },
  {
    id: 'tusk', name: 'Tusk 4x4', archetype: 'Pickup', cls: 'D', color: '#f97316', glow: '#fb923c', unlock: 1,
    stats: { speed: 3, accel: 5, grip: 7, drift: 5, stability: 9 },
    shape: { len: 4.6, width: 2.0, height: 0.8, cabLen: 1.7, cabH: 0.7, cabOffset: 0.5, wheelR: 0.46, ride: 0.55 },
  },
  {
    id: 'brute', name: 'Brute V8', archetype: 'Muscle car', cls: 'C', color: '#dc2626', glow: '#f87171', unlock: 5,
    stats: { speed: 6, accel: 7, grip: 4, drift: 9, stability: 6 },
    shape: { len: 4.8, width: 2.0, height: 0.62, cabLen: 1.9, cabH: 0.52, cabOffset: -0.55, wheelR: 0.38, ride: 0.3, spoiler: true },
  },
  {
    id: 'fennec', name: 'Fennec Rally', archetype: 'Rally car', cls: 'C', color: '#2563eb', glow: '#60a5fa', unlock: 5,
    stats: { speed: 5, accel: 8, grip: 7, drift: 7, stability: 5 },
    shape: { len: 4.3, width: 1.85, height: 0.66, cabLen: 2.1, cabH: 0.6, cabOffset: -0.2, wheelR: 0.37, ride: 0.42, spoiler: true },
  },
  {
    id: 'mamba', name: 'Mamba RS', archetype: 'Tuned import', cls: 'B', color: '#16a34a', glow: '#4ade80', unlock: 12,
    stats: { speed: 7, accel: 7, grip: 6, drift: 7, stability: 4 },
    shape: { len: 4.4, width: 1.85, height: 0.55, cabLen: 1.9, cabH: 0.5, cabOffset: -0.25, wheelR: 0.35, ride: 0.26, spoiler: true },
  },
  {
    id: 'kestrel', name: 'Kestrel GT', archetype: 'Sports car', cls: 'B', color: '#e5e7eb', glow: '#a5f3fc', unlock: 12,
    stats: { speed: 7, accel: 6, grip: 8, drift: 5, stability: 5 },
    shape: { len: 4.5, width: 1.95, height: 0.52, cabLen: 1.8, cabH: 0.48, cabOffset: -0.35, wheelR: 0.36, ride: 0.25 },
  },
  {
    id: 'sable', name: 'Sable SC', archetype: 'Supercar', cls: 'A', color: '#7c3aed', glow: '#c4b5fd', unlock: 20,
    stats: { speed: 9, accel: 9, grip: 7, drift: 5, stability: 4 },
    shape: { len: 4.6, width: 2.05, height: 0.46, cabLen: 1.6, cabH: 0.44, cabOffset: 0.15, wheelR: 0.36, ride: 0.22, spoiler: true },
  },
  {
    id: 'halcyon', name: 'Halcyon Courier', archetype: 'Delivery van with a race engine', cls: 'A', color: '#f8fafc', glow: '#f0abfc', unlock: 20,
    stats: { speed: 9, accel: 7, grip: 5, drift: 7, stability: 8 },
    shape: { len: 4.9, width: 2.0, height: 1.0, cabLen: 3.6, cabH: 0.85, cabOffset: -0.6, wheelR: 0.4, ride: 0.35, box: true },
  },
]

export const CLASS_TOPSPEED: Record<CarClass, number> = {
  D: CONFIG.classD_topspeed,
  C: CONFIG.classC_topspeed,
  B: CONFIG.classB_topspeed,
  A: CONFIG.classA_topspeed,
}

/** Top speed in km/h: the class sets the band, the Speed stat moves it a little. */
export function topSpeedKmh(model: CarModel, cls: CarClass = model.cls) {
  return CLASS_TOPSPEED[cls] + (model.stats.speed - 5) * 3
}

export type Personality = 'Brawler' | 'Sniper' | 'Racer' | 'Trickster'

export interface Driver {
  name: string
  personality: Personality
  car: string
  intro: string
}

// Rivals, introduced by the presenter, DJ Static.
export const DRIVERS: Driver[] = [
  { name: 'Nova', personality: 'Racer', car: 'kestrel', intro: 'Nova never fights fair. Nova never fights at all, and just leaves.' },
  { name: 'Rook', personality: 'Brawler', car: 'tusk', intro: 'Rook drives a truck like a battering ram. Keep a Shield handy.' },
  { name: 'Jinx', personality: 'Trickster', car: 'fennec', intro: 'Jinx lays Mines where you least want them. Watch the corners.' },
  { name: 'Talon', personality: 'Sniper', car: 'mamba', intro: 'Talon lands Shunts from three cars back. Do not sit still.' },
  { name: 'Vega', personality: 'Racer', car: 'sable', intro: 'Vega is all Nitro and no manners.' },
  { name: 'Bishop', personality: 'Brawler', car: 'brute', intro: 'Bishop is a Barge with a steering wheel.' },
  { name: 'Kaito', personality: 'Sniper', car: 'halcyon', intro: 'Kaito brought a van. Kaito is also undefeated.' },
]

/* ---------- Meshes ---------- */

function taperedBox(w: number, h: number, l: number, topW: number, topL: number, shiftZ = 0) {
  const g = new THREE.BoxGeometry(w, h, l)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * topW)
      p.setZ(i, p.getZ(i) * topL + shiftZ)
    }
  }
  g.computeVertexNormals()
  return g.toNonIndexed()
}

const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2)
const wheelMat = new THREE.MeshStandardMaterial({ color: '#0d0d12', roughness: 0.8, flatShading: true })
const glassMat = new THREE.MeshStandardMaterial({ color: '#0a1020', roughness: 0.15, metalness: 0.8, flatShading: true })
const trimMat = new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.6, metalness: 0.4, flatShading: true })

export interface CarMesh {
  root: THREE.Group
  body: THREE.Group // tilts and spins
  wheels: THREE.Mesh[]
  brake: THREE.MeshBasicMaterial
  bodyMat: THREE.MeshStandardMaterial
  paint: THREE.MeshStandardMaterial[] // materials that flash on impact
  glow: THREE.Mesh
  shield: THREE.Mesh
}

let glowTex: THREE.Texture | null = null
export function radialTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

export function buildCarMesh(model: CarModel, glb?: THREE.Object3D | null): CarMesh {
  const s = model.shape
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const bodyMat = new THREE.MeshStandardMaterial({ color: model.color, roughness: 0.35, metalness: 0.45, flatShading: true, emissive: '#000000' })
  const paint: THREE.MeshStandardMaterial[] = [bodyMat]
  const brake = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a3c').multiplyScalar(1.4), toneMapped: false })
  const wheels: THREE.Mesh[] = []

  if (glb) {
    // Generated, textured PBR model: per-car material clones so impact flashes stay on this car.
    const { object, size } = normalizeModel(glb, { length: s.len, frontAxis: model.id === 'halcyon' ? 'z' : 'x' })
    paint.length = 0
    object.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const mat = (m.material as THREE.MeshStandardMaterial).clone()
      mat.envMapIntensity = 1.4
      m.material = mat
      paint.push(mat)
    })
    body.add(object)
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color('#e8f6ff').multiplyScalar(3), toneMapped: false })
    for (const x of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.22, 0.06, 0.04), head)
      hl.position.set(x * size.x * 0.3, size.y * 0.42, size.z / 2 - 0.12)
      body.add(hl)
      const tl = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.24, 0.07, 0.04), brake)
      tl.position.set(x * size.x * 0.3, size.y * 0.5, -size.z / 2 + 0.1)
      body.add(tl)
    }
    return finishCar(model, root, body, wheels, brake, bodyMat, paint, size.x, size.z)
  }

  // Lower body, slightly narrower at the top so the flat shading catches light.
  const lower = new THREE.Mesh(taperedBox(s.width, s.height, s.len, 0.94, 0.96), bodyMat)
  lower.position.y = s.ride + s.height / 2
  body.add(lower)
  // Cabin.
  const cab = new THREE.Mesh(taperedBox(s.width * 0.86, s.cabH, s.cabLen, s.box ? 0.96 : 0.82, s.box ? 0.95 : 0.6, s.box ? 0 : -s.cabLen * 0.06), glassMat)
  cab.position.set(0, s.ride + s.height + s.cabH / 2, s.cabOffset)
  body.add(cab)
  if (s.box) {
    const roof = new THREE.Mesh(taperedBox(s.width * 0.88, 0.06, s.cabLen * 0.96, 1, 1), bodyMat)
    roof.position.set(0, s.ride + s.height + s.cabH + 0.03, s.cabOffset)
    body.add(roof)
  }
  // Bumpers / splitter.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(s.width * 1.02, 0.12, 0.35), trimMat)
  splitter.position.set(0, s.ride + 0.05, s.len / 2 - 0.1)
  body.add(splitter)
  if (s.spoiler) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(s.width * 0.95, 0.07, 0.42), trimMat)
    wing.position.set(0, s.ride + s.height + 0.38, -s.len / 2 + 0.25)
    body.add(wing)
    for (const x of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.36, 0.12), trimMat)
      strut.position.set(x * s.width * 0.5, s.ride + s.height + 0.2, -s.len / 2 + 0.28)
      body.add(strut)
    }
  }
  // Lights.
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff7e0').multiplyScalar(3), toneMapped: false })
  for (const x of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.05), head)
    hl.position.set(x * s.width * 0.32, s.ride + s.height * 0.72, s.len / 2 + 0.01)
    body.add(hl)
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.05), brake)
    tl.position.set(x * s.width * 0.32, s.ride + s.height * 0.75, -s.len / 2 - 0.01)
    body.add(tl)
  }
  // Neon side stripe in the car's glow colour.
  const stripeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(model.glow).multiplyScalar(1.6), toneMapped: false })
  for (const x of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, s.len * 0.8), stripeMat)
    st.position.set(x * (s.width / 2 + 0.005), s.ride + s.height * 0.35, 0)
    body.add(st)
  }
  // Wheels.
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat)
    w.scale.set(0.3, s.wheelR, s.wheelR)
    w.position.set(x * (s.width / 2 - 0.08), s.wheelR, z * (s.len / 2 - 0.85))
    root.add(w)
    wheels.push(w)
  }
  return finishCar(model, root, body, wheels, brake, bodyMat, paint, s.width, s.len)
}

function finishCar(
  model: CarModel,
  root: THREE.Group,
  body: THREE.Group,
  wheels: THREE.Mesh[],
  brake: THREE.MeshBasicMaterial,
  bodyMat: THREE.MeshStandardMaterial,
  paint: THREE.MeshStandardMaterial[],
  width: number,
  len: number,
): CarMesh {
  const s = { width, len }
  // Underglow and headlight pool.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(s.width * 2.6, s.len * 1.6),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(model.glow).multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
  glow.rotation.x = -Math.PI / 2
  glow.position.y = 0.05
  root.add(glow)
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 14),
    new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color('#ffe8b0').multiplyScalar(0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.set(0, 0.04, s.len / 2 + 6)
  root.add(pool)
  // Shield bubble, hidden until used.
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#e0f2fe').multiplyScalar(1.2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  )
  shield.scale.set(s.width * 0.85, 1.4, s.len * 0.62)
  shield.position.y = 0.9
  shield.visible = false
  root.add(shield)
  return { root, body, wheels, brake, bodyMat, paint, glow, shield }
}
