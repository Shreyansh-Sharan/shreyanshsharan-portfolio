// Shared building blocks for levels: the attic around every arena (floorboards, slanted roof, rafters, a round
// window with warm god-rays, string lights), spawn layouts, signs, and a few small utilities.
import * as THREE from 'three'
import { tiledMaterial, type PlushAssets } from './assets'
import type { Phys } from './physics'
import type { Spawn } from './types'

/** A grid of spawn points facing `yaw`, centred on (x, z). */
export function spawnGrid(n: number, o: { x: number; z: number; y?: number; yaw: number; spacing?: number; cols?: number }): Spawn[] {
  const sp = o.spacing ?? 1.6
  const cols = o.cols ?? Math.min(n, 8)
  const rows = Math.ceil(n / cols)
  const out: Spawn[] = []
  const s = Math.sin(o.yaw), c = Math.cos(o.yaw)
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols)
    const lx = (col - (Math.min(cols, n - row * cols) - 1) / 2) * sp
    const lz = -(row - (rows - 1) / 2) * sp
    // Local x is the toy's right (-cos, sin), local z its forward (sin, cos).
    out.push({ x: o.x - c * lx + s * lz, y: o.y ?? 0, z: o.z + s * lx + c * lz, yaw: o.yaw })
  }
  return out
}

/** Spawn points on a circle, facing the middle (or outwards). */
export function spawnRing(n: number, o: { x: number; z: number; y?: number; radius: number; faceIn?: boolean; start?: number }): Spawn[] {
  const out: Spawn[] = []
  for (let i = 0; i < n; i++) {
    const a = (o.start ?? 0) + (i / n) * Math.PI * 2
    const x = o.x + Math.sin(a) * o.radius, z = o.z + Math.cos(a) * o.radius
    const yaw = o.faceIn === false ? a : a + Math.PI
    out.push({ x, y: o.y ?? 0, z, yaw })
  }
  return out
}

/** A flat label sprite (signs, zone names). */
export function textSprite(text: string, opts: { color?: string; bg?: string; size?: number; font?: string } = {}) {
  const c = document.createElement('canvas')
  const fs = 64
  const g = c.getContext('2d')!
  g.font = `800 ${fs}px ${opts.font ?? 'ui-rounded, system-ui, sans-serif'}`
  const w = Math.ceil(g.measureText(text).width) + 48
  c.width = w
  c.height = fs + 40
  const g2 = c.getContext('2d')!
  g2.font = `800 ${fs}px ${opts.font ?? 'ui-rounded, system-ui, sans-serif'}`
  if (opts.bg) {
    g2.fillStyle = opts.bg
    const r = 22
    g2.beginPath()
    g2.roundRect(4, 4, w - 8, c.height - 8, r)
    g2.fill()
    g2.setLineDash([10, 8])
    g2.strokeStyle = 'rgba(255,255,255,0.7)'
    g2.lineWidth = 4
    g2.beginPath()
    g2.roundRect(12, 12, w - 24, c.height - 24, r - 8)
    g2.stroke()
  }
  g2.fillStyle = opts.color ?? '#fff7ed'
  g2.textAlign = 'center'
  g2.textBaseline = 'middle'
  g2.fillText(text, w / 2, c.height / 2 + 4)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }))
  const h = opts.size ?? 1
  s.scale.set((h * w) / c.height, h, 1)
  return s
}

/** Soft vertical gradient texture (for god-rays and glows). */
export function glowTexture(inner = 'rgba(255,214,150,0.55)', outer = 'rgba(255,214,150,0)') {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, inner)
  grad.addColorStop(1, outer)
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface AtticOpts {
  /** Half width (x) and half depth (z) of the floor. */
  hw: number
  hd: number
  /** Ridge height. */
  ridge: number
  /** Height of the short walls under the roof slopes. */
  knee: number
  /** Floor height. */
  y?: number
  /** Add colliders for the floor and walls. */
  solid?: boolean
  /** String lights count (0 for none). */
  lights?: number
  quality: 'low' | 'high'
}

/**
 * The attic: floorboards, two roof slopes rising from knee walls on ±x to a ridge along z, gable walls on ±z
 * with a round window (and god-rays) in the +z one, rafters and string lights. Everything is cheap: one
 * material per surface and instanced beams and bulbs.
 */
export function buildAttic(root: THREE.Object3D, assets: PlushAssets, phys: Phys | null, o: AtticOpts) {
  const y = o.y ?? 0
  const group = new THREE.Group()
  group.name = 'attic'
  root.add(group)

  const floorMat = tiledMaterial(assets, 'floor', Math.max(o.hw, o.hd) / 3.5)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(o.hw * 2, o.hd * 2).rotateX(-Math.PI / 2), floorMat)
  floor.position.y = y
  floor.receiveShadow = true
  group.add(floor)

  const wood = tiledMaterial(assets, 'floor', 3, '#8a5a35')
  wood.color.set('#b7835a')
  const darkWood = tiledMaterial(assets, 'floor', 4, '#5b3a22')
  darkWood.color.set('#7a5236')
  ;(darkWood.map as THREE.Texture | null)?.repeat.set(6, 6)

  // Roof slopes: quads from the knee walls up to the ridge.
  const slopeLen = Math.hypot(o.hw, o.ridge - o.knee)
  darkWood.side = THREE.DoubleSide
  for (const side of [-1, 1]) {
    const g = new THREE.BufferGeometry()
    const xs = side * o.hw
    g.setAttribute('position', new THREE.Float32BufferAttribute([xs, o.knee, -o.hd, xs, o.knee, o.hd, 0, o.ridge, o.hd, 0, o.ridge, -o.hd], 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, (o.hd * 2) / 8, 0, (o.hd * 2) / 8, slopeLen / 8, 0, slopeLen / 8], 2))
    g.setIndex(side > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])
    g.computeVertexNormals()
    const slope = new THREE.Mesh(g, darkWood)
    slope.position.y = y
    group.add(slope)
    // Knee wall.
    const knee = new THREE.Mesh(new THREE.PlaneGeometry(o.hd * 2, o.knee), wood)
    knee.position.set(side * o.hw, y + o.knee / 2, 0)
    knee.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
    group.add(knee)
  }

  // Gable walls (pentagons) with a round window in +z.
  const gable = new THREE.Shape()
  gable.moveTo(-o.hw, 0)
  gable.lineTo(o.hw, 0)
  gable.lineTo(o.hw, o.knee)
  gable.lineTo(0, o.ridge)
  gable.lineTo(-o.hw, o.knee)
  gable.closePath()
  const winY = Math.min(o.ridge * 0.55, o.knee + (o.ridge - o.knee) * 0.45)
  const winR = Math.min(o.hw * 0.22, (o.ridge - o.knee) * 0.32)
  const holed = gable.clone()
  const hole = new THREE.Path()
  hole.absarc(0, winY, winR, 0, Math.PI * 2, true)
  holed.holes.push(hole)
  const back = new THREE.Mesh(new THREE.ShapeGeometry(gable), wood)
  back.position.set(0, y, -o.hd)
  group.add(back)
  const front = new THREE.Mesh(new THREE.ShapeGeometry(holed, 32), wood)
  front.position.set(0, y, o.hd)
  front.rotation.y = Math.PI
  group.add(front)

  // The window: a warm sky disc, a cross frame, and god-rays falling into the room.
  const sky = new THREE.Mesh(new THREE.CircleGeometry(winR, 40), new THREE.MeshBasicMaterial({ color: '#ffe3a8', toneMapped: false }))
  sky.position.set(0, y + winY, o.hd + 0.05)
  sky.rotation.y = Math.PI
  group.add(sky)
  const frameMat = new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.8 })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(winR, winR * 0.08, 8, 40), frameMat)
  ring.position.copy(sky.position).setZ(o.hd - 0.02)
  group.add(ring)
  for (const r of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(winR * 2, winR * 0.07, winR * 0.07), frameMat)
    bar.position.copy(ring.position)
    bar.rotation.z = r
    group.add(bar)
  }
  const rays = new THREE.Mesh(
    new THREE.CylinderGeometry(winR * 0.95, winR * 2.6, o.hd * 1.5, 24, 1, true),
    new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, opacity: 0.55 }),
  )
  rays.geometry.translate(0, -o.hd * 0.75, 0)
  rays.position.copy(sky.position)
  // Tip the beam so it falls into the room (-z) and down towards the floor.
  rays.rotation.x = Math.PI / 2 - 0.55
  rays.renderOrder = 3
  group.add(rays)

  // Rafters along the slopes and a ridge beam (instanced).
  const step = 4
  const count = Math.floor((o.hd * 2) / step) + 1
  const beam = new THREE.BoxGeometry(0.5, 0.7, slopeLen)
  const rafters = new THREE.InstancedMesh(beam, frameMat, count * 2)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3()
  const from = new THREE.Vector3(), to = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  let k = 0
  for (let i = 0; i < count; i++) {
    const z = -o.hd + i * step
    for (const side of [-1, 1]) {
      from.set(side * o.hw, y + o.knee - 0.35, z)
      to.set(0, y + o.ridge - 0.35, z)
      p.lerpVectors(from, to, 0.5)
      q.setFromRotationMatrix(m.lookAt(from, to, up))
      rafters.setMatrixAt(k++, m.compose(p, q, s))
    }
  }
  rafters.instanceMatrix.needsUpdate = true
  group.add(rafters)
  const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, o.hd * 2), frameMat)
  ridgeBeam.position.set(0, y + o.ridge - 0.6, 0)
  group.add(ridgeBeam)
  // A tie beam or two across the room.
  for (const z of [-o.hd * 0.5, o.hd * 0.5]) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 1.2, 0.5, 0.5), frameMat)
    tie.position.set(0, y + o.knee + (o.ridge - o.knee) * 0.55, z)
    group.add(tie)
  }

  // String lights: little warm bulbs on sagging wires between the tie beams and the walls.
  const nLights = o.lights ?? 0
  if (nLights > 0) {
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), nLights)
    const wirePts: THREE.Vector3[] = []
    const colors = ['#ffd27a', '#ff9f6b', '#fff1c1', '#ffb4c8']
    const col = new THREE.Color()
    const strands = 4
    const per = Math.ceil(nLights / strands)
    let n = 0
    for (let st = 0; st < strands; st++) {
      const z0 = -o.hd * 0.7 + (st / (strands - 1)) * o.hd * 1.4
      const a = new THREE.Vector3(-o.hw * 0.85, y + o.knee + 1.2, z0)
      const b = new THREE.Vector3(o.hw * 0.85, y + o.knee + 1.2, z0 + (st % 2 ? 4 : -4))
      for (let i = 0; i < per && n < nLights; i++) {
        const t = (i + 0.5) / per
        p.lerpVectors(a, b, t)
        p.y += (o.ridge - o.knee) * 0.25 - Math.sin(t * Math.PI) * 2.2
        bulbs.setMatrixAt(n, m.makeTranslation(p.x, p.y, p.z))
        bulbs.setColorAt(n, col.set(colors[n % colors.length]))
        if (i % 2 === 0) wirePts.push(p.clone())
        n++
      }
    }
    bulbs.count = n
    bulbs.instanceMatrix.needsUpdate = true
    group.add(bulbs)
  }

  if (phys && o.solid !== false) {
    phys.box({ x: 0, y: y - 0.5, z: 0 }, { x: o.hw + 2, y: 0.5, z: o.hd + 2 }, { friction: 0.8 })
    phys.walls(0, 0, o.hw, o.hd, Math.max(o.knee + 4, 10))
  }
  return { group, floor, window: sky.position.clone(), winR }
}

/** Ease 0..1. */
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

/** Format seconds as m:ss. */
export const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`
