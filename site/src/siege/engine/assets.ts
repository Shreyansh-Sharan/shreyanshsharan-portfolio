// Model manifest and loader. Dropping a GLB in `public/siege/models/` and adding a line to MANIFEST is all a new
// piece needs; anything that fails to load falls back to a procedural box of the same footprint, so the game never
// stalls on an asset. Sources and licences: public/siege/CREDITS.md.
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
  /** Yaw offset in radians so the piece faces +X by default. */
  yaw?: number
  /** Lit (true) or keep unlit vertex colours. */
  lit?: boolean
  /** Emissive tint for neon pieces. */
  glow?: string
  /** Emissive strength (default 0.55). */
  glowIntensity?: number
  /** Skinned, animated character: keeps its PBR materials and is cloned with its skeleton. */
  char?: CharSpec
  /** Textured PBR piece: keeps its materials (metalness capped) instead of the flat vertex-colour conversion. */
  pbr?: boolean
  /** Unlit: emissive-only (skybox). */
  unlit?: boolean
}

/**
 * Which clips drive which state, how the skeleton splits into layers, and where the blaster goes. Clip names are
 * matched as substrings; hero files carry the canonical set (idle, walk, run, aim, fire, fire2, death, super) baked
 * by the asset build (locomotion clips carry their natural ground speed in `extras.speed`).
 */
export interface CharSpec {
  clips: { idle: string; run: string; walk?: string; aim?: string; fire?: string; fire2?: string; death?: string; super?: string }
  /** Right-hand bone (first match), where the blaster is held. */
  hand: RegExp
  /** First spine bone: counter-twists against the pelvis and takes recoil / flinch. */
  spine: RegExp
  /** Second spine bone (shares the counter-twist), when the rig has one. */
  spine1?: RegExp
  /** Head bone (flinch snap). */
  head?: RegExp
  /** Locomotion root (pelvis or the joint above it that owns the legs): yaws towards the velocity. */
  root?: RegExp
  /** Bones owned by the upper-body aim layer (everything above the first spine bone, arms, head). */
  upper?: RegExp
  /** The model carries its own weapon: no blaster is attached, the muzzle sits on this bone. */
  ownGun?: RegExp
  /** Blaster offset from the hand in the fighter's frame (right, up, forward), metres. */
  gunOffset?: [number, number, number]
  /** Metalness cap (no reflections in the arena, so full metal would render black). */
  metal?: number
  /** Death clip speed multiplier. */
  deathSpeed?: number
  /** Death clip holds after `hold` seconds while the whole body topples backwards by `angle` radians (clips that stagger but never reach the floor). */
  deathTopple?: [hold: number, angle: number]
  /** Only the first N seconds of the super clip play. */
  superCut?: number
}

/** Canonical clip names every hero file carries (see tools: the hero animation build). */
const CANON_CLIPS = { idle: 'idle', walk: 'walk', run: 'run', aim: 'aim', fire: 'fire', fire2: 'fire2', death: 'death' }
/** The Star Soldier death is a backwards fold at the hips: hold it at 0.2 s and topple the body 55°. */
const FOLD_DEATH: [number, number] = [0.2, 0.96]
/**
 * The heroes share one humanoid rig (original models made for this project, rigged by the asset build): the
 * spine counts down from the chest (Spine → Spine01 → Spine02 → Hips), so Spine02 is the pelvis-side bone that
 * counter-twists against the legs and the aim layer owns Spine01 and everything above it.
 */
const HERO_RIG = {
  hand: /^RightHand$/,
  spine: /^Spine02$/,
  spine1: /^Spine01$/,
  head: /^Head$/,
  root: /^Hips$/,
  upper: /^(Spine01|Spine|neck|Head|head_end|(Left|Right)(Shoulder|Arm|ForeArm|Hand))$/,
}

export const MANIFEST: Record<string, ModelSpec> = {
  // Heroes: original models made for this project, normalised to each hero's height, facing +Z. Clips are
  // retargeted from CC BY sources (see CREDITS.md).
  'char-rook': {
    file: 'char-rook.glb',
    height: 2.1,
    char: { clips: { ...CANON_CLIPS, super: 'super' }, ...HERO_RIG, gunOffset: [0.02, -0.04, 0.24], metal: 0.35, deathTopple: FOLD_DEATH, superCut: 0.5 },
  },
  'char-wren': {
    file: 'char-wren.glb',
    height: 2.2,
    char: { clips: { ...CANON_CLIPS, super: 'super' }, ...HERO_RIG, gunOffset: [0.03, -0.03, 0.3], metal: 0.3, deathTopple: FOLD_DEATH },
  },
  'char-furnace': {
    file: 'char-furnace.glb',
    height: 2.7,
    char: { clips: { ...CANON_CLIPS, run: 'walk', super: 'super' }, ...HERO_RIG, gunOffset: [0.02, 0.0, 0.32], metal: 0.4, deathSpeed: 2.8, superCut: 1.6 },
  },
  'char-flick': {
    file: 'char-flick.glb',
    height: 2.0,
    char: { clips: { ...CANON_CLIPS, super: 'super' }, ...HERO_RIG, gunOffset: [0.03, -0.02, 0.18], metal: 0.35, deathTopple: FOLD_DEATH },
  },
  'char-pike': {
    file: 'char-pike.glb',
    height: 2.05,
    char: { clips: { ...CANON_CLIPS, super: 'super' }, ...HERO_RIG, gunOffset: [0.03, -0.03, 0.24], metal: 0.3, superCut: 1.8, deathTopple: FOLD_DEATH },
  },
  'char-salve': {
    file: 'char-salve.glb',
    height: 1.95,
    char: { clips: { ...CANON_CLIPS, super: 'super' }, ...HERO_RIG, gunOffset: [0.02, -0.03, 0.18], metal: 0.3, deathTopple: FOLD_DEATH },
  },
  // Blasters (original models; barrel along -Z, the fighter turns them to face its aim).
  'gun-rook': { file: 'gun-rook.glb', width: 0.9, pbr: true },
  'gun-wren': { file: 'gun-wren.glb', width: 1.25, pbr: true },
  'gun-furnace': { file: 'gun-furnace.glb', width: 1.0, pbr: true },
  'gun-flick': { file: 'gun-flick.glb', width: 0.75, pbr: true },
  'gun-pike': { file: 'gun-pike.glb', width: 1.0, pbr: true },
  'gun-salve': { file: 'gun-salve.glb', width: 0.7, pbr: true },
  grenade: { file: 'grenade.glb', height: 0.35 },
  // Arena pieces: original models made for this project, except the few CC BY pieces listed in CREDITS.md.
  // `width` is the largest horizontal extent after the yaw. Neon parts carry emissive masks.
  'env-shutter': { file: 'env-shutter.glb', width: 8.2, pbr: true },
  'env-shop-a': { file: 'env-shop-a.glb', width: 6.2, pbr: true },
  'env-building-1': { file: 'env-building-1.glb', height: 14, pbr: true },
  'env-building-2': { file: 'env-building-2.glb', height: 17, pbr: true },
  'env-building-3': { file: 'env-building-3.glb', height: 22, pbr: true },
  'env-building-4': { file: 'env-building-4.glb', height: 15, pbr: true },
  'env-building-5': { file: 'env-building-5.glb', height: 12, pbr: true },
  'env-building-6': { file: 'env-building-6.glb', height: 19, pbr: true },
  'env-hk-alley': { file: 'env-hk-alley.glb', height: 34, pbr: true },
  'env-city': { file: 'env-city.glb', width: 110, pbr: true },
  'env-neon-blade': { file: 'env-neon-blade.glb', height: 3, pbr: true },
  'env-skybox': { file: 'env-skybox.glb', width: 900, unlit: true },
  'env-crate-yellow': { file: 'env-crate-yellow.glb', width: 1.7, pbr: true },
  'env-crate-military': { file: 'env-crate-military.glb', width: 1.8, pbr: true },
  'env-crate-neon': { file: 'env-crate-neon.glb', width: 1.4, pbr: true },
  'env-crate-lp': { file: 'env-crate-lp.glb', width: 1.5, pbr: true },
  'env-case': { file: 'env-case.glb', width: 1.9, pbr: true },
  'env-loot-chest': { file: 'env-loot-chest.glb', width: 1.5, pbr: true },
  'env-terminal': { file: 'env-terminal.glb', height: 2.3, pbr: true },
  'env-rails': { file: 'env-rails.glb', width: 2, pbr: true },
  'env-vent': { file: 'env-vent.glb', width: 2.0, pbr: true },
  'env-vent-tall': { file: 'env-vent-tall.glb', height: 4.5, pbr: true },
  'env-dish': { file: 'env-dish.glb', height: 3.6, pbr: true },
  'env-bridge': { file: 'env-bridge.glb', width: 12, pbr: true },
  'env-turnstiles': { file: 'env-turnstiles.glb', width: 2.2, pbr: true },
  'env-train': { file: 'env-train.glb', width: 8, pbr: true },
  'env-station': { file: 'env-station.glb', width: 36, pbr: true },
  'env-hover-car': { file: 'env-hover-car.glb', width: 3.9, pbr: true },
  'env-car-1': { file: 'env-car-1.glb', width: 3.4, pbr: true },
  'env-car-2': { file: 'env-car-2.glb', width: 3.4, pbr: true },
  // WREN's Sentry Pod: static, the view bobs it and turns it towards its target (eye on +Z).
  'env-drone': { file: 'env-drone.glb', height: 1.1, pbr: true },
  'giant-billboard': { file: 'giant-billboard.glb', height: 8, pbr: true },
  'box-truck': { file: 'box-truck.glb', width: 3.95, yaw: Math.PI / 2, pbr: true },
  'led-streetlight': { file: 'led-streetlight.glb', height: 5.2, pbr: true },
  // Licensed low-poly prop kept from the site owner's library.
  'media-facade': { file: 'media-facade.glb', width: 7.2, glow: '#22d3ee' },
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
          models.set(name, normalise(g.scene, MANIFEST[name], g.animations))
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

/** Bounds that account for skinning (Box3.setFromObject only reads the bind-pose geometry otherwise). */
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

/** Scale to the manifest size, drop the feet to y=0, centre on x/z, and give unlit pieces a lit material. */
function normalise(root: THREE.Object3D, spec: ModelSpec, clips: THREE.AnimationClip[] = []) {
  const wrap = new THREE.Group()
  wrap.add(root)
  if (spec.yaw) root.rotation.y = spec.yaw
  if (spec.char) {
    // Measure in the idle pose so the feet, not the bind pose, define the ground.
    const idle = clips.find((c) => c.name.includes(spec.char!.clips.idle))
    if (idle) {
      const mixer = new THREE.AnimationMixer(root)
      mixer.clipAction(idle).play()
      mixer.update(0)
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
    }
  }
  root.updateMatrixWorld(true)
  const box = spec.char ? skinnedBounds(root) : new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  let s = 1
  if (spec.width && Math.max(size.x, size.z) > 0) s = spec.width / Math.max(size.x, size.z)
  else if (spec.height && size.y > 0) s = spec.height / size.y
  root.scale.setScalar(s)
  root.updateMatrixWorld(true)
  wrap.userData.scale = s
  if (spec.char) box.copy(skinnedBounds(root))
  else box.setFromObject(root)
  const c = box.getCenter(new THREE.Vector3())
  root.position.set(-c.x, -box.min.y, -c.z)
  if (spec.char || spec.pbr || spec.unlit) {
    if (spec.unlit) prepareUnlit(root)
    else preparePbr(root, spec.char ?? { metal: 0.3 }, !spec.char, spec.glow, spec.glowIntensity)
    wrap.userData.height = size.y * s
    wrap.userData.width = size.x * s
    wrap.userData.depth = size.z * s
    return wrap
  }
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

/** Skybox sphere: unlit, inside-out, unaffected by fog. */
function prepareUnlit(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const src = m.material as THREE.MeshStandardMaterial
    const out = new THREE.MeshBasicMaterial({ map: src.map ?? src.emissiveMap ?? null, side: THREE.BackSide, fog: false, depthWrite: false })
    if (out.map) out.map.colorSpace = THREE.SRGBColorSpace
    m.material = out
    m.frustumCulled = false
    m.castShadow = m.receiveShadow = false
    m.renderOrder = -10
  })
}

/** Textured pieces keep their PBR materials: cap the metalness (no reflections here), shadows on. */
function preparePbr(root: THREE.Object3D, spec: Pick<CharSpec, 'metal'>, prop: boolean, glow?: string, glowIntensity = 0.55) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.castShadow = true
    m.receiveShadow = prop
    m.frustumCulled = prop
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    m.material = mats.map((mat) => {
      const src = mat as THREE.MeshStandardMaterial & { isMeshBasicMaterial?: boolean }
      let out: THREE.MeshStandardMaterial
      if (src.isMeshBasicMaterial) {
        // Unlit (KHR_materials_unlit) exports get a lit material so they sit in the arena lighting.
        out = new THREE.MeshStandardMaterial({ map: src.map, color: src.color, roughness: 0.75, metalness: 0 })
        out.name = src.name
      } else {
        out = src
        out.metalness = Math.min(out.metalness, spec.metal ?? 0.35)
        out.roughness = Math.max(out.roughness, 0.45)
        if (out.emissiveMap && out.emissive.getHex() === 0xffffff) out.emissiveIntensity = prop ? 1 : 0.6
      }
      if (!prop) out.side = THREE.FrontSide
      if (glow && !out.emissiveMap) {
        out.emissive = new THREE.Color(glow)
        out.emissiveIntensity = glowIntensity
      }
      if (out.map) out.map.colorSpace = THREE.SRGBColorSpace
      return out
    }) as unknown as THREE.Material
    if ((m.material as unknown as THREE.Material[]).length === 1) m.material = (m.material as unknown as THREE.Material[])[0]
  })
}

/** Deep clone that keeps materials shared (callers clone materials when they tint). Skinned characters clone their skeleton. */
export function instance(assets: SiegeAssets, name: string): THREE.Object3D | null {
  const proto = assets.models.get(name)
  if (!proto) return null
  const c = MANIFEST[name]?.char ? cloneSkeleton(proto) : proto.clone(true)
  c.userData = { ...proto.userData }
  return c
}

/** Find a clip by substring of its name. */
export function findClip(clips: THREE.AnimationClip[] | undefined, part: string | undefined) {
  if (!clips || !part) return null
  return clips.find((c) => c.name === part) ?? clips.find((c) => c.name.includes(part)) ?? null
}
