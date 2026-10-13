// Model manifest and loader. Dropping a GLB in `public/siege/models/` and adding a line to MANIFEST is all a new
// piece needs; anything that fails to load falls back to a procedural box of the same footprint, so the game never
// stalls on an asset. Sources and licences: public/siege/CREDITS.md.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export interface ModelSpec {
  file: string
  /** Target height in metres (0 = keep the file's scale). */
  height?: number
  /** Target footprint (largest horizontal extent) in metres, used instead of height when set. */
  width?: number
  /** Yaw offset in radians so the piece faces +X by default. */
  yaw?: number
  /** Lit (true) or keep unlit vertex colours. */
  lit?: boolean
  /** Emissive tint for neon pieces. */
  glow?: string
  /** Emissive strength (default 0.55). */
  glowIntensity?: number
}

export const MANIFEST: Record<string, ModelSpec> = {
  // Heroes (node-animated characters) and their blasters.
  'hero-rook': { file: 'hero-rook.glb', height: 2.1 },
  'hero-wren': { file: 'hero-wren.glb', height: 2.1 },
  'hero-furnace': { file: 'hero-furnace.glb', height: 2.1 },
  'hero-flick': { file: 'hero-flick.glb', height: 2.1 },
  'hero-pike': { file: 'hero-pike.glb', height: 2.1 },
  'hero-salve': { file: 'hero-salve.glb', height: 2.1 },
  'gun-rook': { file: 'gun-rook.glb', width: 0.9 },
  'gun-wren': { file: 'gun-wren.glb', width: 1.25 },
  'gun-furnace': { file: 'gun-furnace.glb', width: 1.0 },
  'gun-flick': { file: 'gun-flick.glb', width: 0.75 },
  'gun-pike': { file: 'gun-pike.glb', width: 1.0 },
  'gun-salve': { file: 'gun-salve.glb', width: 0.7 },
  grenade: { file: 'grenade.glb', height: 0.35 },
  // Cover and props.
  'supply-crate': { file: 'supply-crate.glb', height: 1.5 },
  'ammo-crate': { file: 'ammo-crate.glb', width: 1.7, glow: '#f0abfc', glowIntensity: 0.12 },
  'barrel-stack': { file: 'barrel-stack.glb', width: 1.9 },
  'sandbag-stack': { file: 'sandbag-stack.glb', width: 1.95 },
  'checkpoint-barrier': { file: 'checkpoint-barrier.glb', width: 1.95 },
  'generator-unit': { file: 'generator-unit.glb', width: 1.9 },
  'security-bollard': { file: 'security-bollard.glb', width: 1.95 },
  'service-dumpster': { file: 'service-dumpster.glb', width: 1.9 },
  'transformer-kiosk': { file: 'transformer-kiosk.glb', width: 1.9 },
  'transit-shelter': { file: 'transit-shelter.glb', width: 4.2 },
  'led-streetlight': { file: 'led-streetlight.glb', height: 5.2 },
  'giant-billboard': { file: 'giant-billboard.glb', height: 8 },
  'media-facade': { file: 'media-facade.glb', width: 7.2, glow: '#22d3ee' },
  'neon-shop-sign': { file: 'neon-shop-sign.glb', height: 1.4, glow: '#f0abfc' },
  'neon-storefront': { file: 'neon-storefront.glb', height: 1.3, glow: '#22d3ee' },
  'hotel-neon-blade': { file: 'hotel-neon-blade.glb', height: 6.5, glow: '#f472b6' },
  'corner-shop': { file: 'corner-shop.glb', height: 9 },
  'retail-infill': { file: 'retail-infill.glb', height: 11.7 },
  'metro-headhouse': { file: 'metro-headhouse.glb', height: 3.7 },
  taxi: { file: 'taxi.glb', width: 2.8, yaw: Math.PI / 2 },
  'box-truck': { file: 'box-truck.glb', width: 3.95, yaw: Math.PI / 2 },
}

export interface SiegeAssets {
  /** Normalised prototypes (scaled, centred on the floor). Missing files are absent. */
  models: Map<string, THREE.Object3D>
  clips: Map<string, THREE.AnimationClip[]>
}

const base = `${import.meta.env.BASE_URL}siege/models/`
let pending: Promise<SiegeAssets> | null = null

export function loadSiegeAssets(onProgress?: (done: number, total: number) => void): Promise<SiegeAssets> {
  if (pending) return pending
  const names = Object.keys(MANIFEST)
  const total = names.length
  let done = 0
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const models = new Map<string, THREE.Object3D>()
  const clips = new Map<string, THREE.AnimationClip[]>()
  pending = Promise.all(
    names.map((name) =>
      loader
        .loadAsync(base + MANIFEST[name].file)
        .then((g) => {
          models.set(name, normalise(g.scene, MANIFEST[name]))
          if (g.animations.length) clips.set(name, g.animations)
        })
        .catch(() => {
          // Missing or broken file: the view builds a procedural stand-in.
        })
        .finally(() => onProgress?.(++done, total)),
    ),
  ).then(() => ({ models, clips }))
  return pending
}

/** Scale to the manifest size, drop the feet to y=0, centre on x/z, and give unlit pieces a lit material. */
function normalise(root: THREE.Object3D, spec: ModelSpec) {
  const wrap = new THREE.Group()
  wrap.add(root)
  if (spec.yaw) root.rotation.y = spec.yaw
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  let s = 1
  if (spec.width && Math.max(size.x, size.z) > 0) s = spec.width / Math.max(size.x, size.z)
  else if (spec.height && size.y > 0) s = spec.height / size.y
  root.scale.setScalar(s)
  root.updateMatrixWorld(true)
  box.setFromObject(root)
  const c = box.getCenter(new THREE.Vector3())
  root.position.set(-c.x, -box.min.y, -c.z)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = true
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    const out = mats.map((mat) => {
      const src = mat as THREE.MeshStandardMaterial & { map?: THREE.Texture | null; vertexColors?: boolean }
      const lam = new THREE.MeshLambertMaterial({ map: src.map ?? null, vertexColors: !!src.vertexColors, color: src.color ?? new THREE.Color('#ffffff') })
      if (src.map) {
        src.map.colorSpace = THREE.SRGBColorSpace
        src.map.magFilter = THREE.NearestFilter
      }
      if (spec.glow) {
        // Vertex-coloured neon: brightest vertices glow in the given tint.
        lam.emissive = new THREE.Color(spec.glow)
        lam.emissiveIntensity = spec.glowIntensity ?? 0.55
      }
      lam.name = src.name
      return lam
    })
    m.material = out.length === 1 ? out[0] : out
  })
  wrap.userData.height = size.y * s
  wrap.userData.width = size.x * s
  wrap.userData.depth = size.z * s
  return wrap
}

/** Deep clone that keeps materials shared (callers clone materials when they tint). */
export function instance(assets: SiegeAssets, name: string): THREE.Object3D | null {
  const proto = assets.models.get(name)
  if (!proto) return null
  const c = proto.clone(true)
  c.userData = { ...proto.userData }
  return c
}
