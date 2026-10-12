// Dress a toy in its outfit: fabric pattern and stitch colour on the cloth, then a mesh per slot hung from the
// rig's bones (rig.attach). Four pieces are real models (wizard hat, propeller beanie, pipe-cleaner glasses,
// paper wings) plus the Show crown; everything else is built here from three.js primitives and small canvas
// textures. Pieces are merged into one vertex-coloured mesh where possible (a draw call per cosmetic), and
// geometries, materials and textures are cached and marked `userData.keep` so they outlive rounds.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CosmeticName, PlushAssets } from '../engine/assets'
import { FABRICS, type FabricName, type RigState, type ToyRig } from '../engine/rig'
import { ITEM, outfitKey, type Outfit, type WSlot } from './catalog'
import { fitFor, type Fit } from './fit'

/* ---------- Shared materials and textures ---------- */

const mats = new Map<string, THREE.Material>()
function keepMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = mats.get(key) as T | undefined
  if (!m) {
    m = make()
    m.userData.keep = true
    mats.set(key, m)
  }
  return m
}
const vcol = () => keepMat('vcol', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, flatShading: true }))
const vmetal = () => keepMat('vmetal', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85, flatShading: true }))
const vgloss = () => keepMat('vgloss', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.05 }))
const vglow = () => keepMat('vglow', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: '#ffffff', emissiveIntensity: 0.35, flatShading: true }))

const texs = new Map<string, THREE.Texture>()
function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  let t = texs.get(key)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(...repeat)
  }
  texs.set(key, t)
  return t
}
function texMat(key: string, map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) {
  return keepMat(`tex:${key}`, () => new THREE.MeshStandardMaterial({ map, roughness: 0.75, flatShading: true, ...extra }))
}

/* ---------- Geometry helpers ---------- */

type Part = { g: THREE.BufferGeometry; c: THREE.ColorRepresentation; m?: THREE.Matrix4 }
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _col = new THREE.Color()

/** A transform matrix from position, rotation (euler) and scale. */
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz))
}

/** Merge primitives into one geometry with a colour per part (a single draw call). */
function merge(parts: Part[]) {
  const anyFlat = parts.some((p) => !p.g.index)
  const list = parts.map((p) => {
    let g = p.g.clone()
    if (p.m) g.applyMatrix4(p.m)
    if (anyFlat && g.index) g = g.toNonIndexed()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    const n = g.attributes.position.count
    const col = new Float32Array(n * 3)
    _col.set(p.c)
    for (let i = 0; i < n; i++) col.set([_col.r, _col.g, _col.b], i * 3)
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.clearGroups()
    return g
  })
  const out = mergeGeometries(list, false)!
  out.userData.keep = true
  for (const g of list) g.dispose()
  return out
}

const geos = new Map<string, THREE.BufferGeometry>()
function cachedGeo(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key)
  if (!g) {
    g = make()
    g.userData.keep = true
    geos.set(key, g)
  }
  return g
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadows = true) {
  const o = new THREE.Mesh(g, m)
  o.castShadow = shadows
  return o
}

function starShape(r: number, inner = 0.45, n = 5) {
  const s = new THREE.Shape()
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + Math.PI / 2
    const rr = i % 2 ? r * inner : r
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  return s
}

function heartShape(r: number) {
  const s = new THREE.Shape()
  s.moveTo(0, -r)
  s.bezierCurveTo(r * 1.4, -r * 0.1, r * 0.9, r * 1.05, 0, r * 0.45)
  s.bezierCurveTo(-r * 0.9, r * 1.05, -r * 1.4, -r * 0.1, 0, -r)
  return s
}

/** A bottle cap's crimped skirt: a short cylinder whose rim zig-zags. */
function crimped(r: number, h: number, teeth = 21) {
  const g = new THREE.CylinderGeometry(r, r * 1.04, h, teeth * 2, 1)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * teeth * 2) % 2 ? 1.07 : 1
    if (Math.hypot(x, z) > r * 0.5) {
      pos.setX(i, x * k)
      pos.setZ(i, z * k)
    }
  }
  g.computeVertexNormals()
  return g
}

/* ---------- Colours ---------- */

const THREAD: Record<string, string> = {
  'col-cream': '#fff3dc', 'col-cherry': '#ef4444', 'col-sky': '#38bdf8', 'col-mint': '#34d399', 'col-lemon': '#fde047', 'col-plum': '#a855f7', 'col-ink': '#1e293b',
  'col-rainbow': '#f472b6', 'col-gold': '#f5b82e',
}

/** The accent for a piece: the stitch colour, or the piece's own colour when the thread is plain cream. */
function accent(o: Outfit, own: string) {
  const id = o.colour ?? 'col-cream'
  return id === 'col-cream' ? own : (THREAD[id] ?? own)
}

/* ---------- Model cosmetics ---------- */

interface Prepared {
  obj: THREE.Object3D
  /** Size of the prepared model (after its turn): x width, y height, z depth. */
  size: THREE.Vector3
  /** Beanie: the propeller split off so it can spin. */
  prop?: THREE.Object3D
}
const prepared = new Map<string, Prepared>()

/**
 * A model cosmetic, turned to face the toy's +z, centred on x/z and standing on y = 0, in unit size (its
 * largest side 1). Cached; callers clone.
 */
function model(assets: PlushAssets, name: CosmeticName | 'crown'): Prepared | null {
  const hit = prepared.get(name)
  if (hit) return hit
  const src = name === 'crown' ? assets.props.crown : assets.cosmetics[name]
  if (!src) return null
  const root = src.clone(true)
  // Glasses were made facing +x and the wings span z: turn both to the toy's frame.
  if (name === 'glasses') root.rotation.y = -Math.PI / 2
  if (name === 'wings') root.rotation.y = Math.PI / 2
  const g = new THREE.Group()
  g.add(root)
  g.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(g)
  const size = box.getSize(new THREE.Vector3())
  const k = 1 / Math.max(size.x, size.y, size.z)
  const c = box.getCenter(new THREE.Vector3())
  root.position.set(-c.x * k, -box.min.y * k, -c.z * k)
  root.scale.multiplyScalar(k)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.castShadow = true
  })
  const out: Prepared = { obj: g, size: size.multiplyScalar(k) }
  if (name === 'beanie') out.prop = splitPropeller(g)
  prepared.set(name, out)
  return out
}

/**
 * The beanie is one mesh: lift the propeller off (triangles in the top slice of the model) into its own mesh
 * so it can spin about its own axis.
 */
function splitPropeller(g: THREE.Group): THREE.Object3D | undefined {
  let src: THREE.Mesh | null = null
  g.traverse((o) => {
    if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh
  })
  if (!src) return undefined
  const m = src as THREE.Mesh
  g.updateMatrixWorld(true)
  const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
  geo.applyMatrix4(m.matrixWorld)
  const pos = geo.attributes.position
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute)
  const cut = box.max.y - (box.max.y - box.min.y) * 0.13
  const keepTri: number[] = [], propTri: number[] = []
  for (let t = 0; t < pos.count; t += 3) {
    const y = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3
    ;(y > cut ? propTri : keepTri).push(t)
  }
  const pick = (tris: number[]) => {
    const out = new THREE.BufferGeometry()
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name] as THREE.BufferAttribute
      const arr = new Float32Array(tris.length * 3 * a.itemSize)
      let o = 0
      for (const t of tris)
        for (let v = 0; v < 3; v++)
          for (let c = 0; c < a.itemSize; c++) arr[o++] = a.getComponent(t + v, c)
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize))
    }
    out.userData.keep = true
    return out
  }
  const base = pick(keepTri)
  const prop = pick(propTri)
  // Centre the propeller on its own spin axis.
  const pb = new THREE.Box3().setFromBufferAttribute(prop.attributes.position as THREE.BufferAttribute)
  const pc = pb.getCenter(new THREE.Vector3())
  prop.translate(-pc.x, 0, -pc.z)
  const mat = m.material as THREE.Material
  const baseMesh = new THREE.Mesh(base, mat)
  const propMesh = new THREE.Mesh(prop, mat)
  baseMesh.castShadow = propMesh.castShadow = true
  propMesh.position.set(pc.x, 0, pc.z)
  propMesh.name = 'propeller'
  // Replace the original mesh with the two halves (in world-baked coordinates).
  const holder = new THREE.Group()
  holder.add(baseMesh, propMesh)
  const parent = g
  parent.clear()
  parent.add(holder)
  geo.dispose()
  return propMesh
}

function cloneModel(assets: PlushAssets, name: CosmeticName | 'crown') {
  const p = model(assets, name)
  if (!p) return null
  const obj = p.obj.clone(true)
  let prop: THREE.Object3D | undefined
  if (p.prop) obj.traverse((o) => o.name === 'propeller' && (prop = o))
  return { obj, size: p.size, prop }
}

/* ---------- Placing ---------- */

type BoneName = keyof Fit['bones']
const SLOT_OF: Record<BoneName, string> = { Head: 'head', Spine02: 'back', RightHand: 'handR', LeftHand: 'handL', RightFoot: 'footR', LeftFoot: 'footL' }

/** Hang `obj` (built in toy space around the origin) at toy-space point `at` on a bone. */
function put(rig: ToyRig, fit: Fit, bone: BoneName, obj: THREE.Object3D, at: THREE.Vector3Like, rot: [number, number, number] = [0, 0, 0]) {
  const b = fit.bones[bone]
  return rig.attach(SLOT_OF[bone], obj, { offset: [at.x - b.x, at.y - b.y, at.z - b.z], rotation: rot })
}

/* ---------- Builders, one per item ---------- */

type Ctx = { rig: ToyRig; fit: Fit; o: Outfit; assets: PlushAssets }

function hat(c: Ctx, id: string) {
  const { fit, rig } = c
  const h = fit.head
  const W = Math.max(h.topW, h.w * 0.8)
  const at = (sink: number, z = 0) => ({ x: h.x, y: h.top - sink, z: h.z + z })
  switch (id) {
    case 'hat-party': {
      const col = accent(c.o, '#f472b6')
      const tex = canvasTex(`party:${col}`, 64, 64, (g, w, hh) => {
        g.fillStyle = '#fff7e6'
        g.fillRect(0, 0, w, hh)
        g.fillStyle = col
        for (let i = -4; i < 8; i++) {
          g.beginPath()
          g.moveTo(i * 12, 0)
          g.lineTo(i * 12 + 6, 0)
          g.lineTo(i * 12 + 6 + 32, hh)
          g.lineTo(i * 12 + 32, hh)
          g.fill()
        }
        g.fillStyle = '#facc15'
        for (let i = 0; i < 10; i++) g.fillRect((i * 37) % w, (i * 23) % hh, 3, 3)
      })
      const r = W * 0.27, ht = W * 0.75
      const g = new THREE.Group()
      const cone = mesh(cachedGeo('party-cone', () => new THREE.ConeGeometry(1, 1, 14, 1, true).translate(0, 0.5, 0)), texMat(`party:${col}`, tex, { side: THREE.DoubleSide }))
      cone.scale.set(r, ht, r)
      const pom = mesh(cachedGeo('pom', () => new THREE.IcosahedronGeometry(1, 1)), keepMat('pom', () => new THREE.MeshStandardMaterial({ color: '#fff7e6', roughness: 1, flatShading: true })))
      pom.scale.setScalar(W * 0.075)
      pom.position.y = ht
      const band = mesh(cachedGeo('band', () => new THREE.TorusGeometry(1, 0.08, 6, 18).rotateX(Math.PI / 2)), keepMat(`plain:${col}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })))
      band.scale.setScalar(r)
      band.position.y = 0.02
      g.add(cone, pom, band)
      return put(rig, fit, 'Head', g, at(W * 0.06, -h.d * 0.02), [0.12, 0, 0.22])
    }
    case 'hat-acorn': {
      const tex = canvasTex('acorn', 64, 64, (g, w, hh) => {
        g.fillStyle = '#8a5a2b'
        g.fillRect(0, 0, w, hh)
        g.strokeStyle = '#5b3a1b'
        g.lineWidth = 3
        for (let i = -8; i < 16; i++) {
          g.beginPath()
          g.moveTo(i * 8, 0)
          g.lineTo(i * 8 + hh, hh)
          g.stroke()
          g.beginPath()
          g.moveTo(i * 8 + hh, 0)
          g.lineTo(i * 8, hh)
          g.stroke()
        }
      }, [3, 2])
      const r = W * 0.43
      const g = new THREE.Group()
      const cap = mesh(cachedGeo('acorn-cap', () => new THREE.SphereGeometry(1, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2)), texMat('acorn', tex))
      cap.scale.set(r, r * 0.62, r)
      const stem = mesh(cachedGeo('acorn-stem', () => merge([{ g: new THREE.CylinderGeometry(0.1, 0.16, 0.5, 6), c: '#5b3a1b', m: M(0.06, 0.25, 0, 0, 0, -0.35) }])), vcol())
      stem.scale.setScalar(r * 0.55)
      stem.position.y = r * 0.58
      g.add(cap, stem)
      return put(rig, fit, 'Head', g, at(r * 0.22), [0, 0, 0.1])
    }
    case 'hat-thimble': {
      const tex = canvasTex('thimble', 64, 64, (g, w, hh) => {
        g.fillStyle = '#d6d9de'
        g.fillRect(0, 0, w, hh)
        g.fillStyle = '#9aa0a8'
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          g.beginPath()
          g.arc(x * 8 + 4 + (y % 2) * 4, y * 8 + 4, 2.2, 0, Math.PI * 2)
          g.fill()
        }
      }, [4, 2])
      const r = W * 0.3, ht = W * 0.45
      const g = new THREE.Group()
      const body = mesh(cachedGeo('thimble', () => new THREE.CylinderGeometry(0.86, 1, 1, 18, 1).translate(0, 0.5, 0)), texMat('thimble', tex, { metalness: 0.75, roughness: 0.35 }))
      body.scale.set(r, ht, r)
      const rim = mesh(cachedGeo('band', () => new THREE.TorusGeometry(1, 0.08, 6, 18).rotateX(Math.PI / 2)), keepMat('silver', () => new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.9, roughness: 0.25 })))
      rim.scale.setScalar(r * 1.02)
      g.add(body, rim)
      return put(rig, fit, 'Head', g, at(ht * 0.12), [0, 0, -0.12])
    }
    case 'hat-bottlecap': {
      const col = accent(c.o, '#dc2626')
      const top = canvasTex(`captop:${col}`, 64, 64, (g, w, hh) => {
        g.fillStyle = col
        g.fillRect(0, 0, w, hh)
        g.fillStyle = '#fff7e6'
        g.beginPath()
        g.arc(w / 2, hh / 2, 22, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = col
        g.font = 'bold 26px sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText('★', w / 2, hh / 2 + 1)
      })
      const r = W * 0.36, ht = W * 0.16
      const metal = keepMat(`capmetal:${col}`, () => new THREE.MeshStandardMaterial({ color: col, metalness: 0.7, roughness: 0.3, flatShading: true }))
      const cap = mesh(cachedGeo('crimp', () => crimped(1, 1)), [metal, texMat(`captop:${col}`, top, { metalness: 0.5, roughness: 0.35 }), metal] as unknown as THREE.Material)
      cap.scale.set(r, ht, r)
      cap.position.y = ht / 2
      const g = new THREE.Group()
      g.add(cap)
      return put(rig, fit, 'Head', g, at(ht * 0.25), [0.08, 0, -0.18])
    }
    case 'hat-flowers': {
      const geo = cachedGeo('flowers', () => {
        const parts: Part[] = [{ g: new THREE.TorusGeometry(1, 0.07, 5, 24).rotateX(Math.PI / 2), c: '#4d7c0f' }]
        const cols = ['#f9a8d4', '#fde047', '#c4b5fd', '#fdba74', '#f9a8d4', '#86efac', '#fde047']
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2
          const x = Math.cos(a), z = Math.sin(a)
          for (let p = 0; p < 5; p++) {
            const b = (p / 5) * Math.PI * 2
            parts.push({ g: new THREE.IcosahedronGeometry(0.12, 0), c: cols[i], m: M(x + Math.cos(b) * 0.13 * -Math.sin(a), 0.1 + Math.sin(b) * 0.13, z + Math.cos(b) * 0.13 * Math.cos(a), 0, 0, 0, 1, 1, 0.5) })
          }
          parts.push({ g: new THREE.IcosahedronGeometry(0.08, 0), c: '#f59e0b', m: M(x * 1.04, 0.1, z * 1.04) })
          parts.push({ g: new THREE.SphereGeometry(0.1, 4, 3), c: '#65a30d', m: M(Math.cos(a + 0.4) * 1.02, 0.02, Math.sin(a + 0.4) * 1.02, 0, 0, 0, 1.4, 0.4, 0.8) })
        }
        return merge(parts)
      })
      const m = mesh(geo, vcol())
      m.scale.set(W * 0.4, W * 0.4, h.d * 0.4)
      return put(rig, fit, 'Head', m, at(W * 0.08), [0.1, 0, 0])
    }
    case 'hat-beanie':
    case 'hat-wizard':
    case 'hat-crown': {
      const name = id === 'hat-beanie' ? 'beanie' : id === 'hat-wizard' ? 'wizard' : 'crown'
      const m = cloneModel(c.assets, name)
      if (!m) return hat(c, id === 'hat-crown' ? 'hat-bottlecap' : 'hat-party')
      // Width of the model's base relative to the head, and how far it sinks over the dome.
      const base = name === 'beanie' ? 0.9 : name === 'wizard' ? 1.12 : 0.66
      const sink = name === 'beanie' ? 0.3 : name === 'wizard' ? 0.1 : 0.08
      const k = (W * base) / Math.max(m.size.x, m.size.z)
      m.obj.scale.setScalar(k)
      const g = new THREE.Group()
      g.add(m.obj)
      if (m.prop) {
        const p = m.prop
        rig.animators.push((dt, s) => {
          p.rotation.y += dt * (6 + Math.min(14, s.speed * 2.5))
        })
      }
      return put(rig, fit, 'Head', g, at(m.size.y * k * sink, name === 'beanie' ? -h.d * 0.03 : 0), [name === 'wizard' ? -0.08 : 0, 0, name === 'crown' ? 0.06 : 0])
    }
  }
  return null
}

function eyes(c: Ctx, id: string) {
  const { fit, rig } = c
  const h = fit.head
  const W = h.w
  const g = new THREE.Group()
  const spots = [-1, 1].map((sx) => {
    const x = h.x + sx * h.eyeDX
    return new THREE.Vector3(x, h.eyeY, fit.faceZ(x, h.eyeY) + 0.004)
  })
  const centre = new THREE.Vector3(h.x, h.eyeY, Math.max(spots[0].z, spots[1].z))
  const local = (p: THREE.Vector3) => p.clone().sub(centre)
  const r = W * 0.085
  switch (id) {
    case 'eye-googly': {
      const white = cachedGeo('googly-w', () => merge([{ g: new THREE.SphereGeometry(1, 14, 8), c: '#ffffff', m: M(0, 0, 0, 0, 0, 0, 1, 1, 0.45) }]))
      const pupilG = cachedGeo('googly-p', () => merge([{ g: new THREE.SphereGeometry(0.5, 10, 6), c: '#111111', m: M(0, 0, 0, 0, 0, 0, 1, 1, 0.4) }]))
      const pupils: THREE.Mesh[] = []
      spots.forEach((p, i) => {
        const e = mesh(white, vgloss(), false)
        e.position.copy(local(p))
        e.rotation.y = (i ? 1 : -1) * 0.3
        e.scale.setScalar(r * 1.15)
        const pu = mesh(pupilG, vgloss(), false)
        pu.position.set(0, -0.25, 0.42)
        e.add(pu)
        pupils.push(pu)
        g.add(e)
      })
      let t = Math.random() * 10
      let lag = 0
      rig.animators.push((dt, s: RigState) => {
        t += dt
        lag += (s.vy * 0.04 - lag) * Math.min(1, dt * 6)
        pupils.forEach((pu, i) => {
          pu.position.x = Math.sin(t * (7 + i) + i) * 0.22 * Math.min(1, s.speed / 3 + 0.25)
          pu.position.y = -0.25 + THREE.MathUtils.clamp(lag, -0.35, 0.35) + Math.cos(t * 5 + i) * 0.06
        })
      })
      break
    }
    case 'eye-sleepy': {
      const lid = cachedGeo('lid', () =>
        merge([
          { g: new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), c: '#c7a98a', m: M(0, 0, 0, Math.PI / 2 - 0.25, 0, 0, 1, 1, 0.5) },
          { g: new THREE.BoxGeometry(2.1, 0.12, 0.2), c: '#3f2a1d', m: M(0, -0.08, 0.38, -0.25) },
        ]),
      )
      spots.forEach((p, i) => {
        const e = mesh(lid, vcol(), false)
        e.position.copy(local(p))
        e.rotation.y = (i ? 1 : -1) * 0.3
        e.scale.setScalar(r * 1.25)
        g.add(e)
      })
      break
    }
    case 'eye-star':
    case 'eye-heart': {
      const star = id === 'eye-star'
      const geo = cachedGeo(id, () => merge([{ g: new THREE.ExtrudeGeometry(star ? starShape(1) : heartShape(0.9), { depth: 0.25, bevelEnabled: false }), c: star ? '#facc15' : '#f43f5e' }]))
      const parts: THREE.Mesh[] = []
      spots.forEach((p, i) => {
        const e = mesh(geo, vglow(), false)
        e.position.copy(local(p))
        e.rotation.y = (i ? 1 : -1) * 0.3
        e.scale.setScalar(r * 1.3)
        g.add(e)
        parts.push(e)
      })
      let t = 0
      rig.animators.push((dt) => {
        t += dt
        const k = r * 1.3 * (1 + (star ? Math.sin(t * 3) * 0.06 : Math.max(0, Math.sin(t * 7)) * 0.18))
        for (const e of parts) {
          e.scale.setScalar(k)
          if (star) e.rotation.z += dt * 0.8
        }
      })
      break
    }
    case 'eye-monocle': {
      const p = spots[1]
      const geo = cachedGeo('monocle', () => {
        const chain = new THREE.CatmullRomCurve3([new THREE.Vector3(1, -0.3, 0), new THREE.Vector3(1.8, -1.6, -0.6), new THREE.Vector3(2.1, -3, -1.4)])
        return merge([
          { g: new THREE.TorusGeometry(1, 0.13, 6, 20), c: '#d4a017' },
          { g: new THREE.TubeGeometry(chain, 10, 0.05, 4), c: '#d4a017' },
        ])
      })
      const mono = mesh(geo, vmetal(), false)
      mono.position.copy(local(p))
      mono.rotation.y = 0.3
      mono.scale.setScalar(r * 1.35)
      const glass = mesh(cachedGeo('mono-glass', () => new THREE.CircleGeometry(1, 16)), keepMat('glass', () => new THREE.MeshStandardMaterial({ color: '#dbeafe', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 })), false)
      mono.add(glass)
      g.add(mono)
      break
    }
    default:
      return null
  }
  return put(rig, fit, 'Head', g, centre)
}

function mouth(c: Ctx, id: string) {
  const { fit, rig } = c
  const h = fit.head
  const W = h.w
  const at = new THREE.Vector3(h.x, h.mouthY, fit.faceZ(h.x, h.mouthY) + 0.004)
  let obj: THREE.Object3D
  switch (id) {
    case 'mouth-grin': {
      const geo = cachedGeo('grin', () => {
        const curve = new THREE.CatmullRomCurve3([-1, -0.6, -0.2, 0.2, 0.6, 1].map((x) => new THREE.Vector3(x, -0.55 * (1 - x * x) + 0.15, 0.05 - Math.abs(x) * 0.25)))
        const parts: Part[] = [{ g: new THREE.TubeGeometry(curve, 20, 0.05, 4), c: '#3f1d12' }]
        for (const x of [-0.7, -0.35, 0, 0.35, 0.7]) parts.push({ g: new THREE.BoxGeometry(0.05, 0.32, 0.06), c: '#3f1d12', m: M(x, -0.55 * (1 - x * x) + 0.15, 0.06 - Math.abs(x) * 0.25) })
        return merge(parts)
      })
      obj = mesh(geo, vcol(), false)
      obj.scale.setScalar(W * 0.24)
      break
    }
    case 'mouth-fangs': {
      const geo = cachedGeo('fangs', () => merge([-1, 1].map((sx) => ({ g: new THREE.ConeGeometry(0.35, 1, 6), c: '#fafaf9', m: M(sx * 0.7, -0.5, 0, Math.PI, 0, 0) }))))
      obj = mesh(geo, vgloss(), false)
      obj.scale.setScalar(W * 0.07)
      break
    }
    case 'mouth-tongue': {
      const geo = cachedGeo('tongue', () =>
        merge([
          { g: new THREE.SphereGeometry(1, 12, 8), c: '#fb7185', m: M(0, -0.9, 0.2, -0.3, 0, 0, 0.75, 1.1, 0.35) },
          { g: new THREE.BoxGeometry(0.06, 1, 0.1), c: '#e11d48', m: M(0, -0.9, 0.55, -0.3) },
        ]),
      )
      obj = mesh(geo, vgloss(), false)
      obj.scale.setScalar(W * 0.075)
      let t = Math.random() * 6
      rig.animators.push((dt) => {
        t += dt
        obj.rotation.z = Math.sin(t * 3) * 0.15
      })
      break
    }
    case 'mouth-whistle': {
      const col = accent(c.o, '#facc15')
      const cord = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.2, 0, -0.1), new THREE.Vector3(-0.9, -0.8, -0.2), new THREE.Vector3(-0.4, -2.2, 0.3), new THREE.Vector3(0.6, -2.4, 0.5)])
      const geo = cachedGeo(`whistle:${col}`, () =>
        merge([
          { g: new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12), c: col, m: M(0.55, 0, 0.35, 0, 0, Math.PI / 2) },
          { g: new THREE.BoxGeometry(0.7, 0.32, 0.5), c: col, m: M(0, 0, 0.1) },
          { g: new THREE.TorusGeometry(0.16, 0.05, 4, 8), c: '#ef4444', m: M(1.1, 0, 0.35, 0, Math.PI / 2, 0) },
          { g: new THREE.TubeGeometry(cord, 10, 0.05, 4), c: '#ef4444' },
        ]),
      )
      obj = mesh(geo, vgloss(), false)
      obj.scale.setScalar(W * 0.09)
      break
    }
    default:
      return null
  }
  return put(rig, fit, 'Head', obj, at)
}

function face(c: Ctx, id: string) {
  const { fit, rig } = c
  const h = fit.head
  const W = h.w
  switch (id) {
    case 'face-moustache': {
      const geo = cachedGeo('moustache', () => {
        const parts: Part[] = []
        for (const sx of [-1, 1]) {
          parts.push({ g: new THREE.SphereGeometry(0.5, 10, 6), c: '#3b2416', m: M(sx * 0.45, 0, 0, 0, 0, sx * -0.35, 1.1, 0.45, 0.45) })
          parts.push({ g: new THREE.TorusGeometry(0.22, 0.09, 5, 10, Math.PI * 1.3), c: '#3b2416', m: M(sx * 0.98, 0.12, 0, 0, sx > 0 ? 0 : Math.PI, -0.6) })
        }
        return merge(parts)
      })
      const m = mesh(geo, vcol(), false)
      m.scale.setScalar(W * 0.24)
      const y = h.mouthY + (h.eyeY - h.mouthY) * 0.38
      return put(rig, fit, 'Head', m, { x: h.x, y, z: fit.faceZ(h.x, y) + 0.01 })
    }
    case 'face-nose': {
      const geo = cachedGeo('eraser', () =>
        merge([
          { g: new THREE.BoxGeometry(1, 0.62, 0.8, 1, 1, 1), c: '#f9a8d4', m: M(0, 0, 0, 0, 0, 0.1) },
          { g: new THREE.BoxGeometry(0.4, 0.66, 0.84), c: '#93c5fd', m: M(-0.32, 0.03, 0, 0, 0, 0.1) },
        ]),
      )
      const m = mesh(geo, vcol(), false)
      m.scale.setScalar(W * 0.13)
      const y = (h.eyeY + h.mouthY) / 2
      return put(rig, fit, 'Head', m, { x: h.x, y, z: fit.faceZ(h.x, y) + W * 0.03 })
    }
    case 'face-bandage': {
      const tex = canvasTex('plaster', 64, 32, (g, w, hh) => {
        g.fillStyle = '#f2c99c'
        g.fillRect(0, 0, w, hh)
        g.fillStyle = '#fbe3c6'
        g.fillRect(w * 0.32, 4, w * 0.36, hh - 8)
        g.fillStyle = '#d9a777'
        for (let i = 0; i < 12; i++) g.fillRect(4 + (i % 6) * 4 + (i < 6 ? 0 : w - 28), 8 + Math.floor(i / 6) * 10, 2, 2)
      })
      const g = new THREE.Group()
      const geo = cachedGeo('plaster-box', () => new THREE.BoxGeometry(1, 0.32, 0.04))
      for (const rz of [0.7, -0.7]) {
        const m = mesh(geo, texMat('plaster', tex), false)
        m.rotation.z = rz
        g.add(m)
      }
      g.scale.setScalar(W * 0.24)
      const x = h.x - h.eyeDX * 1.25, y = h.eyeY - W * 0.13
      return put(rig, fit, 'Head', g, { x, y, z: fit.faceZ(x, y) + 0.005 }, [0, -0.35, 0])
    }
    case 'face-patch': {
      const black = keepMat('patch', () => new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.9, flatShading: true }))
      const g = new THREE.Group()
      const x = h.x + h.eyeDX
      const pz = fit.faceZ(x, h.eyeY)
      const patch = mesh(cachedGeo('patch', () => new THREE.CylinderGeometry(1, 1, 0.15, 14).rotateX(Math.PI / 2)), black, false)
      patch.scale.setScalar(W * 0.11)
      patch.position.set(x - h.x, 0, pz - h.z + 0.01)
      patch.rotation.y = 0.3
      const strap = mesh(cachedGeo('strap', () => new THREE.TorusGeometry(1, 0.02, 4, 32).rotateX(Math.PI / 2)), black, false)
      strap.scale.set(h.w * 0.52, 1, h.d * 0.52)
      strap.rotation.z = -0.25
      g.add(patch, strap)
      return put(rig, fit, 'Head', g, { x: h.x, y: h.eyeY, z: h.z })
    }
    case 'face-glasses': {
      const m = cloneModel(c.assets, 'glasses')
      if (!m) return null
      const k = (W * 0.86) / m.size.x
      m.obj.scale.setScalar(k)
      const g = new THREE.Group()
      // Lenses at the front of the model (+z after its turn): set them on the face, temples running back.
      m.obj.position.set(0, -m.size.y * k * 0.5, -m.size.z * k * 0.5)
      g.add(m.obj)
      return put(rig, fit, 'Head', g, { x: h.x, y: h.eyeY, z: h.front + 0.02 })
    }
  }
  return null
}

function back(c: Ctx, id: string) {
  const { fit, rig } = c
  const b = fit.body
  const h = fit.head
  switch (id) {
    case 'back-cape': {
      const col = accent(c.o, '#dc2626')
      // A curved sheet hanging from just under the chin to near the floor, behind the back.
      const topY = Math.max(b.shoulderY, h.bottom) + 0.06
      const len = Math.max(0.3, topY - 0.16)
      const r = Math.max(b.w, h.w) * 0.5 + 0.04
      const g = new THREE.Group()
      const cape = mesh(
        cachedGeo('cape', () => new THREE.CylinderGeometry(0.85, 1.2, 1, 12, 4, true, Math.PI * 0.77, Math.PI * 0.46).translate(0, -0.5, 0)),
        keepMat(`cape:${col}`, () => new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, side: THREE.DoubleSide, flatShading: true })),
      )
      cape.scale.set(r, len, r)
      const clasp = mesh(cachedGeo('clasp', () => new THREE.IcosahedronGeometry(1, 0)), keepMat('gold', () => new THREE.MeshStandardMaterial({ color: '#f5b82e', metalness: 0.85, roughness: 0.3 })))
      clasp.scale.setScalar(0.035)
      clasp.position.set(0, -0.02, r * 0.95)
      g.add(cape, clasp)
      // The cape swings back as the toy runs.
      rig.animators.push((dt, s) => {
        g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -Math.min(0.75, s.speed * 0.11) - (s.grounded ? 0 : 0.2), 6, dt)
      })
      return put(rig, fit, 'Spine02', g, { x: h.x, y: topY, z: fit.backZ(topY - 0.15) + r * 0.82 })
    }
    case 'back-matchbox': {
      const col = accent(c.o, '#fbbf24')
      const label = canvasTex(`matchbox:${col}`, 128, 96, (g, w, hh) => {
        g.fillStyle = col
        g.fillRect(0, 0, w, hh)
        g.fillStyle = '#1e3a8a'
        g.fillRect(6, 6, w - 12, hh - 12)
        g.fillStyle = '#fff7e6'
        g.font = 'bold 18px sans-serif'
        g.textAlign = 'center'
        g.fillText('SNUG', w / 2, 30)
        g.fillText('MATCHES', w / 2, 52)
        g.fillStyle = '#f97316'
        g.beginPath()
        g.ellipse(w / 2, 74, 6, 11, 0, 0, Math.PI * 2)
        g.fill()
      })
      const side = keepMat('matchside', () => new THREE.MeshStandardMaterial({ color: '#7c4a21', roughness: 1, flatShading: true }))
      const face = texMat(`matchbox:${col}`, label)
      const box = mesh(cachedGeo('matchbox', () => new THREE.BoxGeometry(1, 0.75, 0.38)), [side, side, face, face, face, face] as unknown as THREE.Material)
      const s = Math.max(b.w, 0.4) * 0.55
      box.scale.setScalar(s)
      const straps = mesh(cachedGeo('straps', () => merge([-1, 1].map((sx) => ({ g: new THREE.TorusGeometry(0.42, 0.05, 4, 12, Math.PI), c: '#7c4a21', m: M(sx * 0.3, 0.2, 0.3, 0, Math.PI / 2, 0) })))), vcol())
      straps.scale.setScalar(s)
      const g = new THREE.Group()
      g.add(box, straps)
      const y = (b.backY + Math.max(b.shoulderY, h.bottom)) / 2 + 0.04
      return put(rig, fit, 'Spine02', g, { x: h.x, y, z: fit.backZ(y) - s * 0.17 }, [0.08, 0, 0])
    }
    case 'back-key': {
      const metal = c.o.colour === 'col-gold' ? '#f5b82e' : '#c0c6cf'
      const geo = cachedGeo(`key:${metal}`, () =>
        merge([
          { g: new THREE.CylinderGeometry(0.09, 0.09, 1, 8), c: metal, m: M(0, 0, -0.5, Math.PI / 2) },
          { g: new THREE.TorusGeometry(0.42, 0.11, 6, 14), c: metal, m: M(0.5, 0, -1.05, 0, 0, 0, 1, 1, 0.6) },
          { g: new THREE.TorusGeometry(0.42, 0.11, 6, 14), c: metal, m: M(-0.5, 0, -1.05, 0, 0, 0, 1, 1, 0.6) },
          { g: new THREE.CylinderGeometry(0.16, 0.16, 0.18, 10), c: metal, m: M(0, 0, -1.05, Math.PI / 2) },
        ]),
      )
      const k = mesh(geo, vmetal())
      k.scale.setScalar(0.17)
      const g = new THREE.Group()
      g.add(k)
      rig.animators.push((dt, s) => {
        k.rotation.z -= dt * (1.6 + Math.min(6, s.speed))
      })
      const y = (b.backY + Math.max(b.shoulderY, h.bottom)) / 2 + 0.03
      return put(rig, fit, 'Spine02', g, { x: h.x, y, z: fit.backZ(y) + 0.02 })
    }
    case 'back-wings': {
      const m = cloneModel(c.assets, 'wings')
      if (!m) return null
      const k = (Math.max(b.w, h.w) * 1.7) / m.size.x
      m.obj.scale.setScalar(k)
      m.obj.position.y = -m.size.y * k * 0.5
      const g = new THREE.Group()
      g.add(m.obj)
      let t = Math.random() * 6
      rig.animators.push((dt, s) => {
        t += dt * (s.grounded ? 2.2 : 9)
        g.rotation.x = -0.18 + Math.sin(t) * (s.grounded ? 0.05 : 0.18)
        g.scale.x = 1 + Math.sin(t) * (s.grounded ? 0.03 : 0.12)
      })
      return put(rig, fit, 'Spine02', g, { x: h.x, y: b.backY + 0.12, z: b.backZ - 0.03 })
    }
  }
  return null
}

function hand(c: Ctx, id: string) {
  const { fit, rig } = c
  const R = fit.hands.R
  const out = new THREE.Vector3(R.x, R.y, R.z)
  switch (id) {
    case 'hand-lolly': {
      const tex = canvasTex('lolly', 64, 64, (g, w, hh) => {
        const cols = ['#f472b6', '#fff7e6', '#60a5fa', '#fff7e6']
        for (let i = 0; i < 16; i++) {
          g.fillStyle = cols[i % 4]
          g.beginPath()
          g.moveTo(w / 2, hh / 2)
          g.arc(w / 2, hh / 2, w / 2, (i / 16) * Math.PI * 2 + i * 0.12, ((i + 1) / 16) * Math.PI * 2 + i * 0.12 + 0.2)
          g.fill()
        }
      })
      const g = new THREE.Group()
      const stick = mesh(cachedGeo('stick', () => merge([{ g: new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5).translate(0, 0.21, 0), c: '#fafaf9' }])), vcol())
      const disc = mesh(cachedGeo('lolly-disc', () => new THREE.CylinderGeometry(0.11, 0.11, 0.04, 20).rotateX(Math.PI / 2)), texMat('lolly', tex, { roughness: 0.3 }))
      disc.position.y = 0.42
      g.add(stick, disc)
      return put(rig, fit, 'RightHand', g, out.setY(R.y - 0.05), [0, 0, 0])
    }
    case 'hand-pencil': {
      const geo = cachedGeo('pencil', () =>
        merge([
          { g: new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), c: '#facc15', m: M(0, 0.25, 0) },
          { g: new THREE.ConeGeometry(0.03, 0.09, 6), c: '#f1c38e', m: M(0, 0.545, 0) },
          { g: new THREE.ConeGeometry(0.011, 0.033, 6), c: '#334155', m: M(0, 0.575, 0) },
          { g: new THREE.CylinderGeometry(0.032, 0.032, 0.04, 8), c: '#9ca3af', m: M(0, -0.02, 0) },
          { g: new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), c: '#f9a8d4', m: M(0, -0.07, 0) },
          { g: new THREE.BoxGeometry(0.16, 0.025, 0.04), c: '#9ca3af', m: M(0, 0.06, 0) },
        ]),
      )
      const m = mesh(geo, vcol())
      return put(rig, fit, 'RightHand', m, out, [1.25, 0, 0])
    }
    case 'hand-brush': {
      const col = accent(c.o, '#3b82f6')
      const geo = cachedGeo(`brush:${col}`, () =>
        merge([
          { g: new THREE.CylinderGeometry(0.018, 0.024, 0.36, 6), c: '#b45309', m: M(0, 0.12, 0) },
          { g: new THREE.CylinderGeometry(0.026, 0.022, 0.06, 8), c: '#cbd5e1', m: M(0, 0.33, 0) },
          { g: new THREE.ConeGeometry(0.03, 0.1, 8), c: '#f5deb3', m: M(0, 0.41, 0) },
          { g: new THREE.ConeGeometry(0.02, 0.05, 8), c: col, m: M(0, 0.45, 0) },
        ]),
      )
      const m = mesh(geo, vcol())
      return put(rig, fit, 'RightHand', m, out, [0.5, 0, -0.3])
    }
    case 'hand-balloon': {
      const col = accent(c.o, '#ef4444')
      const g = new THREE.Group()
      const string = mesh(cachedGeo('balloon-string', () => merge([{ g: new THREE.CylinderGeometry(0.004, 0.004, 0.9, 3).translate(0, 0.45, 0), c: '#f8fafc' }])), vcol(), false)
      const ball = mesh(
        cachedGeo(`balloon:${col}`, () =>
          merge([
            { g: new THREE.SphereGeometry(0.17, 14, 10), c: col, m: M(0, 1.08, 0, 0, 0, 0, 1, 1.18, 1) },
            { g: new THREE.ConeGeometry(0.03, 0.05, 6), c: col, m: M(0, 0.89, 0, Math.PI) },
          ]),
        ),
        vgloss(),
      )
      g.add(string, ball)
      // Keep the balloon floating upright whatever the arm does, with a lazy sway.
      const q = new THREE.Quaternion()
      let t = Math.random() * 6
      rig.animators.push((dt) => {
        t += dt
        const p = g.parent
        if (!p) return
        p.getWorldQuaternion(q).invert()
        g.quaternion.copy(q).multiply(_q.setFromEuler(_e.set(Math.sin(t * 1.3) * 0.12, 0, Math.sin(t * 1.7) * 0.12)))
        const ws = p.getWorldScale(_s)
        g.scale.setScalar(1 / Math.max(1e-4, ws.x))
      })
      return put(rig, fit, 'RightHand', g, out)
    }
  }
  return null
}

function feet(c: Ctx, id: string) {
  const { fit, rig } = c
  const f = fit.feet
  const offs: (() => void)[] = []
  for (const side of ['R', 'L'] as const) {
    const p = f[side]
    const bone = side === 'R' ? 'RightFoot' : 'LeftFoot'
    const at = { x: p.x, y: 0, z: p.z }
    let obj: THREE.Object3D | null = null
    if (id === 'feet-caps') {
      const col = accent(c.o, '#16a34a')
      const metal = keepMat(`capmetal:${col}`, () => new THREE.MeshStandardMaterial({ color: col, metalness: 0.7, roughness: 0.3, flatShading: true }))
      const m = mesh(cachedGeo('crimp', () => crimped(1, 1)), metal)
      m.scale.set(Math.max(f.len, f.wid) * 0.62, 0.07, Math.max(f.len, f.wid) * 0.62)
      m.position.y = 0.035
      obj = m
    } else if (id === 'feet-socks') {
      const col = accent(c.o, '#f87171')
      const tex = canvasTex(`sock:${col}`, 32, 64, (g, w, hh) => {
        g.fillStyle = '#fff7e6'
        g.fillRect(0, 0, w, hh)
        g.fillStyle = col
        for (let i = 0; i < 4; i++) g.fillRect(0, i * 16, w, 8)
      })
      const m = mesh(cachedGeo('sockboot', () => new THREE.CylinderGeometry(1, 1.05, 1, 12, 1, true).translate(0, 0.5, 0)), texMat(`sock:${col}`, tex, { side: THREE.DoubleSide, roughness: 1 }))
      const r = Math.max(f.len, f.wid) * 0.52
      m.scale.set(r, 0.2, r)
      obj = m
    } else if (id === 'feet-skates') {
      const col = accent(c.o, '#f472b6')
      const geo = cachedGeo(`skate:${col}`, () => {
        const parts: Part[] = [{ g: new THREE.BoxGeometry(1, 0.12, 1.5), c: col, m: M(0, 0.24, 0) }]
        return merge(parts)
      })
      const wheelGeo = cachedGeo('spool', () =>
        merge([
          { g: new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), c: '#b45309', m: M(-0.12, 0, 0, 0, 0, Math.PI / 2) },
          { g: new THREE.CylinderGeometry(0.2, 0.2, 0.06, 10), c: '#b45309', m: M(0.12, 0, 0, 0, 0, Math.PI / 2) },
          { g: new THREE.CylinderGeometry(0.14, 0.14, 0.2, 10), c: '#60a5fa', m: M(0, 0, 0, 0, 0, Math.PI / 2) },
        ]),
      )
      const g = new THREE.Group()
      const s = Math.max(f.len, f.wid) * 0.62
      const plate = mesh(geo, vcol())
      plate.scale.setScalar(s)
      g.add(plate)
      const wheels: THREE.Mesh[] = []
      for (const wz of [-0.5, 0.5]) {
        const w = mesh(wheelGeo, vcol())
        w.scale.setScalar(s)
        w.position.set(0, 0.2 * s, wz * s)
        g.add(w)
        wheels.push(w)
      }
      g.position.y = -0.04
      rig.animators.push((dt, st) => {
        for (const w of wheels) w.rotation.x += dt * st.speed * 6
      })
      obj = g
    }
    if (obj) offs.push(put(rig, fit, bone, obj, at))
  }
  return offs.length ? () => offs.forEach((o) => o()) : null
}

/* ---------- Dressing ---------- */

const TRAILS: Record<string, { kind: 'glitter' | 'bubbles' | 'stuffing'; color: string }> = {
  'flair-glitter': { kind: 'glitter', color: '#facc15' },
  'flair-bubbles': { kind: 'bubbles', color: '#bae6fd' },
  'flair-stuffing': { kind: 'stuffing', color: '#f8fafc' },
}

const FABRIC_OF: Record<string, FabricName> = {
  'fab-stripes': 'stripes', 'fab-polka': 'polka', 'fab-tartan': 'tartan', 'fab-glitter': 'glitter', 'fab-corduroy': 'corduroy', 'fab-denim': 'denim', 'fab-velvet': 'velvet',
  'fab-felt': 'felt',
}

/** Put an outfit on a freshly built rig. Unknown or missing items are skipped; a failed piece never throws. */
export function dressRig(rig: ToyRig, outfit: Outfit | undefined, assets: PlushAssets) {
  const o = outfit ?? {}
  rig.root.userData.outfit = outfitKey(o)
  const has = Object.keys(o).length > 0
  if (!has) return
  rig.settle()
  const fit = fitFor(rig)
  const ctx: Ctx = { rig, fit, o, assets }
  // Cloth: pattern and stitch colour.
  const thread = THREAD[o.colour ?? 'col-cream'] ?? THREAD['col-cream']
  const fab = FABRIC_OF[o.fabric ?? '']
  if (fab) rig.setFabric(FABRICS[fab], fab === 'denim' && !o.colour ? '#3b5ba5' : fab === 'velvet' && !o.colour ? '#a855f7' : thread)
  if (o.colour === 'col-rainbow') {
    const c = new THREE.Color()
    rig.animators.push(() => {
      rig.setFabricColor(c.setHSL((performance.now() / 4000) % 1, 0.85, 0.6))
    })
  }
  const builders: Partial<Record<WSlot, (c: Ctx, id: string) => (() => void) | null>> = { hat, eyes, mouth, face, back, hand, feet }
  for (const [slot, build] of Object.entries(builders) as [WSlot, (c: Ctx, id: string) => (() => void) | null][]) {
    const id = o[slot]
    if (!id || !ITEM.has(id)) continue
    try {
      const off = build(ctx, id)
      if (off) rig.cosmetics.set(slot, off)
    } catch (e) {
      console.warn('plush: could not fit', id, e)
    }
  }
  const trail = TRAILS[o.flair ?? '']
  if (trail) rig.trail = { kind: trail.kind, color: new THREE.Color(trail.kind === 'stuffing' || o.colour === undefined ? trail.color : (THREAD[o.colour] ?? trail.color)) }
}

/** Debug: a toy's fit numbers (for tests and the docs). */
export function fitInfo(rig: ToyRig) {
  const f = fitFor(rig)
  const r = (x: number) => Math.round(x * 1000) / 1000
  return { head: Object.fromEntries(Object.entries(f.head).map(([k, v]) => [k, r(v)])), body: Object.fromEntries(Object.entries(f.body).map(([k, v]) => [k, r(v)])), feet: { len: r(f.feet.len), wid: r(f.feet.wid) } }
}
