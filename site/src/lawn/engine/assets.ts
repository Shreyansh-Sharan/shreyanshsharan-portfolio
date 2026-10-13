// Model manifest and loader. Every GLB in `public/lawn/models/` is listed here with the size it should be in the
// world; the loader scales it, drops its feet to y=0, centres it and converts materials for the cartoon lighting.
// Pack files (several props in one GLB) are split by node name. Anything that fails to load falls back to a
// procedural stand-in, so the game never stalls on an asset. Sources and licences: public/lawn/CREDITS.md.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

export interface ModelSpec {
  file: string
  /** Target height in metres (0 = keep the file's scale). */
  height?: number
  /** Target footprint (largest horizontal extent) in metres, used instead of height when set. */
  width?: number
  /** Target length along the model's longest axis (held tools), used instead of width/height when set. */
  length?: number
  /** Yaw offset in radians so the piece faces +Z. */
  yaw?: number
  /** Extra rotation around X (models authored Z-up). */
  tiltX?: number
  /** Pull one named node out of a pack (substring match). */
  sub?: string
  /** Skinned, animated model: cloned with its skeleton. */
  animated?: boolean
  /** Tint applied to every material (procedural recolour of CC assets). */
  tint?: string
  /** Emissive tint (neon signs, screens). */
  glow?: string
  glowIntensity?: number
  /** Keep the model's own vertical offset instead of dropping it to the floor. */
  keepY?: boolean
  /** Shadow casting (big static props skip it on low tiers). */
  shadow?: boolean
}

export const MANIFEST: Record<string, ModelSpec> = {
  // Characters (Quaternius CC0): bodies share one skeleton; clips live on the male file.
  'char-m': { file: 'char-m.glb', height: 1.85, animated: true },
  'char-f': { file: 'char-f.glb', height: 1.72, animated: true },
  hair: { file: 'hair.glb' },
  dog: { file: 'dog.glb', height: 0.75, animated: true },
  robot: { file: 'hexapod.glb', width: 1.6, animated: true, yaw: Math.PI / 2 },
  seagull: { file: 'seagull.glb', width: 0.9, animated: true },
  // Held weapons and gadgets.
  rollingpin: { file: 'rollingpin.glb', length: 0.45 },
  golfclub: { file: 'golfclub.glb', length: 1.0 },
  slingshot: { file: 'slingshot.glb', length: 0.34, sub: 'catapult' },
  umbrella: { file: 'umbrella.glb', width: 1.1 },
  blower: { file: 'blower.glb', width: 0.85 },
  tray: { file: 'tray.glb', width: 0.42 },
  bat: { file: 'melee-pack.glb', sub: 'Bat_Melee', length: 0.95 },
  sledge: { file: 'melee-pack.glb', sub: 'Sledge_Melee', length: 0.85 },
  pan: { file: 'melee-pack.glb', sub: 'Frying_Pan', length: 0.42 },
  pipe: { file: 'melee-pack.glb', sub: 'Pipe_Melee', length: 0.6 },
  shovel: { file: 'tools.glb', sub: 'Shovel', length: 1.25 },
  rake: { file: 'tools.glb', sub: 'Fork', length: 1.3 },
  toolrack: { file: 'tools.glb', sub: 'rack', height: 1.5 },
  // Valuables and furniture (Sketchfab CC BY).
  tv: { file: 'tv.glb', width: 1.3, yaw: 0 },
  fridge: { file: 'fridge.glb', height: 1.9, animated: true },
  trophy: { file: 'trophy.glb', height: 0.9, tint: '#ffd766' },
  aquarium: { file: 'aquarium.glb', width: 1.3 },
  clock: { file: 'clock.glb', height: 2.0 },
  piano: { file: 'piano.glb', width: 1.5 },
  mower: { file: 'mower.glb', width: 1.3, yaw: Math.PI / 2 },
  'mower-ride': { file: 'mower-anim.glb', width: 1.4, animated: true },
  bookcase: { file: 'bookcase.glb', height: 2.0 },
  sofa: { file: 'sofa.glb', width: 2.1 },
  toilet: { file: 'toilet.glb', height: 0.8 },
  sink: { file: 'sink.glb', height: 0.9 },
  // Street and garden.
  gnome: { file: 'gnome.glb', height: 0.55 },
  mailbox: { file: 'mailbox.glb', height: 1.2 },
  bbq: { file: 'bbq.glb', height: 1.2 },
  golfcart: { file: 'golfcart.glb', width: 2.4 },
  windmill: { file: 'windmill.glb', height: 9 },
  pole: { file: 'pole.glb', height: 8.5 },
  trampoline: { file: 'trampoline.glb', width: 3.2, animated: true },
  icecream: { file: 'icecream.glb', width: 6.5, yaw: Math.PI / 2 },
  pine: { file: 'pine.glb', height: 7 },
  'pine-snowy': { file: 'pine.glb', height: 8 },
  ladder: { file: 'ladder.glb', height: 3.6 },
  pickup: { file: 'pickup.glb', width: 5.0 },
  'house-small': { file: 'house-small.glb', width: 11 },
  motelsign: { file: 'motelsign.glb', height: 7, glow: '#ff6ad5', glowIntensity: 0.6 },
  shed: { file: 'shed.glb', width: 2.6 },
  bush: { file: 'bush.glb', width: 1.2 },
  beartrap: { file: 'beartrap.glb', width: 0.7, animated: true },
  rccar: { file: 'rccar.glb', width: 0.9 },
  towtruck: { file: 'towtruck.glb', width: 5.6, yaw: 0 },
  bench: { file: 'street-props.glb', sub: 'banco_x_3_smooth', width: 2.2 },
  bin: { file: 'street-props.glb', sub: 'papelera_smooth_Palette', height: 0.8 },
  bikerack: { file: 'street-props.glb', sub: 'aparcabicis_Palette', width: 2.6 },
}

export interface LawnAssets {
  models: Map<string, THREE.Object3D>
  clips: Map<string, THREE.AnimationClip[]>
  /** The shared character clips (from char-m). */
  charClips: THREE.AnimationClip[]
}

const base = `${import.meta.env.BASE_URL}lawn/models/`
let pending: Promise<LawnAssets> | null = null

export function loadLawnAssets(onProgress?: (done: number, total: number) => void): Promise<LawnAssets> {
  if (pending) return pending
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const models = new Map<string, THREE.Object3D>()
  const clips = new Map<string, THREE.AnimationClip[]>()
  const files = Array.from(new Set(Object.values(MANIFEST).map((m) => m.file)))
  const total = files.length
  let done = 0
  pending = Promise.all(
    files.map((file) =>
      loader
        .loadAsync(base + file)
        .then((g) => {
          for (const [name, spec] of Object.entries(MANIFEST)) {
            if (spec.file !== file) continue
            try {
              const root = spec.sub ? extract(g.scene, spec.sub) : g.scene
              if (!root) continue
              models.set(name, normalise(root, spec, g.animations))
              if (g.animations.length) clips.set(name, g.animations)
            } catch {
              // A broken piece: the view uses a procedural stand-in.
            }
          }
        })
        .catch(() => {
          // Missing or broken file: the view builds a procedural stand-in.
        })
        .finally(() => onProgress?.(++done, total)),
    ),
  ).then(() => ({ models, clips, charClips: clips.get('char-m') ?? [] }))
  return pending
}

/** Pull a sub-object out of a pack by name, re-parented to a fresh group at the origin. */
function extract(scene: THREE.Object3D, sub: string) {
  let found: THREE.Object3D | null = null
  scene.traverse((o) => {
    if (!found && o.name.includes(sub) && (o as THREE.Mesh).isMesh) found = o
  })
  if (!found) return null
  const f = found as THREE.Mesh
  f.updateWorldMatrix(true, false)
  const m = f.clone()
  m.applyMatrix4(f.matrixWorld)
  m.position.set(0, 0, 0)
  m.rotation.set(0, 0, 0)
  m.scale.set(1, 1, 1)
  m.updateMatrix()
  // Bake the world transform into the geometry so later measuring works on the group.
  const g = m.geometry.clone()
  g.applyMatrix4(f.matrixWorld)
  m.geometry = g
  const group = new THREE.Group()
  group.add(m)
  return group
}

/** Bounds that account for skinning. */
function skinnedBounds(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isMesh) return
    if (m.isSkinnedMesh) m.computeBoundingBox()
    else m.geometry.computeBoundingBox()
    const b = (m.isSkinnedMesh ? m.boundingBox! : m.geometry.boundingBox!).clone().applyMatrix4(m.matrixWorld)
    box.union(b)
  })
  return box
}

function normalise(root: THREE.Object3D, spec: ModelSpec, clips: THREE.AnimationClip[] = []) {
  const wrap = new THREE.Group()
  wrap.add(root)
  if (spec.tiltX) root.rotation.x = spec.tiltX
  if (spec.yaw) root.rotation.y = spec.yaw
  if (spec.animated && clips.length) {
    const idle = clips.find((c) => /idle/i.test(c.name)) ?? clips[0]
    const mixer = new THREE.AnimationMixer(root)
    mixer.clipAction(idle).play()
    mixer.update(0)
    mixer.stopAllAction()
    mixer.uncacheRoot(root)
  }
  root.updateMatrixWorld(true)
  const box = spec.animated ? skinnedBounds(root) : new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  let s = 1
  if (spec.length) {
    // Held tools: turn the longest axis to +Y so the hand can hold them the same way.
    if (size.z > size.y && size.z >= size.x) root.rotation.x = -Math.PI / 2
    else if (size.x > size.y && size.x > size.z) root.rotation.z = Math.PI / 2
    root.updateMatrixWorld(true)
    box.setFromObject(root)
    box.getSize(size)
  }
  if (spec.length && Math.max(size.x, size.y, size.z) > 0) s = spec.length / Math.max(size.x, size.y, size.z)
  else if (spec.width && Math.max(size.x, size.z) > 0) s = spec.width / Math.max(size.x, size.z)
  else if (spec.height && size.y > 0) s = spec.height / size.y
  root.scale.setScalar(s)
  root.updateMatrixWorld(true)
  if (spec.animated) box.copy(skinnedBounds(root))
  else box.setFromObject(root)
  const c = box.getCenter(new THREE.Vector3())
  root.position.set(-c.x, spec.keepY ? 0 : -box.min.y, -c.z)
  prepare(root, spec)
  wrap.userData.height = size.y * s
  wrap.userData.width = size.x * s
  wrap.userData.depth = size.z * s
  return wrap
}

/** Materials: cap metalness (no reflections in a cartoon street), sRGB maps, shadows, tints and glows. */
function prepare(root: THREE.Object3D, spec: ModelSpec) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = spec.shadow !== false
    m.receiveShadow = true
    m.frustumCulled = !spec.animated
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    const out = mats.map((mat) => {
      const src = mat as THREE.MeshStandardMaterial & { isMeshBasicMaterial?: boolean }
      let o2: THREE.MeshStandardMaterial
      if (src.isMeshBasicMaterial || !(src as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        o2 = new THREE.MeshStandardMaterial({ map: src.map, color: src.color ?? new THREE.Color('#ffffff'), roughness: 0.8, metalness: 0 })
        o2.name = src.name
      } else {
        o2 = src
        // No environment map in the street: metal would render black, and blended exports lose their depth.
        o2.metalness = 0
        o2.metalnessMap = null
        o2.roughness = Math.max(o2.roughness, 0.5)
        if (o2.transparent && !/glass|window|water/i.test(o2.name)) {
          o2.transparent = false
          o2.opacity = 1
          o2.depthWrite = true
          if (o2.map) o2.alphaTest = 0.4
        }
      }
      if (spec.tint) o2.color.multiply(new THREE.Color(spec.tint))
      if (spec.glow) {
        o2.emissive = new THREE.Color(spec.glow)
        o2.emissiveIntensity = spec.glowIntensity ?? 0.5
      }
      if (o2.map) o2.map.colorSpace = THREE.SRGBColorSpace
      o2.side = THREE.FrontSide
      return o2
    })
    m.material = out.length === 1 ? out[0] : out
  })
}

/** Deep clone keeping materials shared (callers clone materials when they tint). Animated models clone their skeleton. */
export function instance(assets: LawnAssets, name: string): THREE.Object3D | null {
  const proto = assets.models.get(name)
  if (!proto) return null
  const c = MANIFEST[name]?.animated ? cloneSkeleton(proto) : proto.clone(true)
  c.userData = { ...proto.userData }
  return c
}

export function findClip(clips: THREE.AnimationClip[] | undefined, part: string | undefined) {
  if (!clips || !part) return null
  return clips.find((c) => c.name === part) ?? clips.find((c) => c.name.toLowerCase().includes(part.toLowerCase())) ?? null
}
