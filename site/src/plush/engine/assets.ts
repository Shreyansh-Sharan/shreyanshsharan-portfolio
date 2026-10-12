// PLUSH PANIC assets: the rigged Stitchlings, attic props and textures. Everything is optional: a missing file
// falls back to a simple procedural stand-in so a level never fails to build.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/** Toys that may exist. The list is probed at load time; only the ones that load are offered. */
export const TOY_KINDS = ['sock', 'bear', 'dino', 'bunny'] as const
export type ToyKind = (typeof TOY_KINDS)[number]

export const TOY_NAMES: Record<ToyKind, string> = { sock: 'Sock', bear: 'Bear', dino: 'Dino', bunny: 'Bunny' }

export const PROPS = ['musicbox', 'ballerina', 'top', 'chest', 'scissors', 'tin', 'crown', 'horse', 'boxes', 'sewing', 'armchair'] as const
export type PropName = (typeof PROPS)[number]

/** Sewing Table cosmetics with real models (public/plush/cosmetics/<name>.glb). The rest are built from primitives. */
export const COSMETICS = ['wizard', 'beanie', 'glasses', 'wings'] as const
export type CosmeticName = (typeof COSMETICS)[number]

export const TEXTURES = ['floor', 'biscuit', 'stool', 'tinlid'] as const
export type TexName = (typeof TEXTURES)[number]

/** Animation clips every toy shares (matched by name, since the files call them `Armature|<Name>|baselayer`). */
export const CLIPS = {
  idle: /Idle/i,
  run: /Run/i,
  jump: /Jump/i,
  push: /Push/i,
  knock: /Knock/i,
  cheer: /Victory|Cheer/i,
  wave: /Wave|Hello/i,
  dance: /Dance/i,
  stomp: /Stomp/i,
} as const
export type ClipName = keyof typeof CLIPS

export interface ToyAsset {
  scene: THREE.Object3D
  clips: Partial<Record<ClipName, THREE.AnimationClip>>
  /** Scale that makes the toy 1 m tall. */
  scale: number
}

export interface PlushAssets {
  toys: Partial<Record<ToyKind, ToyAsset>>
  kinds: ToyKind[]
  props: Partial<Record<PropName, THREE.Object3D>>
  tex: Partial<Record<TexName, THREE.Texture>>
  /** Cosmetic models (may be missing: the wardrobe falls back to primitives). */
  cosmetics: Partial<Record<CosmeticName, THREE.Object3D>>
}

/** Mark a loaded scene's geometries and materials as shared, so round teardown and rig disposal leave them be. */
function keepAll(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.userData.keep = true
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) mt.userData.keep = true
  })
}

const base = `${import.meta.env.BASE_URL}plush/`
let pending: Promise<PlushAssets> | null = null

export function loadPlushAssets(onProgress?: (done: number, total: number) => void): Promise<PlushAssets> {
  if (pending) return pending
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const texLoader = new THREE.TextureLoader()
  const total = TOY_KINDS.length + PROPS.length + TEXTURES.length + COSMETICS.length
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const glb = (path: string) =>
    loader
      .loadAsync(base + path)
      .catch(() => null)
      .finally(tick)
  const tex = (name: string) =>
    texLoader
      .loadAsync(`${base}tex/${name}.webp`)
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 4
        return t
      })
      .catch(() => null)
      .finally(tick)

  pending = Promise.all([
    Promise.all(TOY_KINDS.map((k) => glb(`chars/${k}.glb`))),
    Promise.all(PROPS.map((p) => glb(`models/${p}.glb`))),
    Promise.all(TEXTURES.map(tex)),
    Promise.all(COSMETICS.map((c) => glb(`cosmetics/${c}.glb`))),
  ]).then(([toys, props, texs, cos]) => {
    const out: PlushAssets = { toys: {}, kinds: [], props: {}, tex: {}, cosmetics: {} }
    TOY_KINDS.forEach((k, i) => {
      const g = toys[i]
      if (!g || !g.animations.length) return
      const clips: ToyAsset['clips'] = {}
      for (const [name, re] of Object.entries(CLIPS) as [ClipName, RegExp][]) {
        const c = g.animations.find((a) => re.test(a.name))
        if (c) clips[name] = c
      }
      g.scene.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(g.scene)
      const h = box.max.y - box.min.y
      out.toys[k] = { scene: g.scene, clips, scale: h > 0.01 ? 1 / h : 1 }
      out.kinds.push(k)
    })
    PROPS.forEach((p, i) => {
      if (props[i]) out.props[p] = props[i]!.scene
    })
    COSMETICS.forEach((c, i) => {
      if (cos[i]) out.cosmetics[c] = cos[i]!.scene
    })
    for (const o of [...Object.values(out.props), ...Object.values(out.cosmetics)]) if (o) keepAll(o)
    TEXTURES.forEach((t, i) => {
      if (texs[i]) out.tex[t] = texs[i]!
    })
    return out
  })
  return pending
}

/**
 * A prop scaled so its height (or its largest side, with by = 'max') is `size` metres, centred on x/z and
 * resting on y = 0. Missing props get a plain coloured box so layouts still read.
 */
export function prop(assets: PlushAssets, name: PropName, size: number, by: 'height' | 'max' | 'width' = 'height', shadows = true) {
  const g = new THREE.Group()
  g.name = `prop:${name}`
  const src = assets.props[name]
  if (!src) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color: '#b08060', flatShading: true }))
    m.position.y = size / 2
    g.add(m)
    return g
  }
  const root = src.clone(true)
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const s = box.getSize(new THREE.Vector3())
  const c = box.getCenter(new THREE.Vector3())
  const ref = by === 'height' ? s.y : by === 'width' ? Math.max(s.x, s.z) : Math.max(s.x, s.y, s.z)
  const k = size / Math.max(ref, 1e-4)
  root.scale.multiplyScalar(k)
  root.position.set(-c.x * k, -box.min.y * k, -c.z * k)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = shadows
      m.receiveShadow = shadows
    }
  })
  g.add(root)
  return g
}

/** The world-space size of a prop group built by `prop()`. */
export function propSize(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3())
}

/** A repeating floor material from a tileable texture (cloned so each level can set its own repeat). */
export function tiledMaterial(assets: PlushAssets, name: TexName, repeat: number, fallback = '#b98a5a') {
  const t = assets.tex[name]
  if (!t) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.9 })
  const map = t.clone()
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.repeat.set(repeat, repeat)
  map.needsUpdate = true
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 })
}

/** A round decal-style material (biscuit, stool top, tin lid) with a fallback colour. */
export function discMaterial(assets: PlushAssets, name: TexName, fallback: string) {
  const t = assets.tex[name]
  return new THREE.MeshStandardMaterial({ map: t ?? null, color: t ? '#ffffff' : fallback, roughness: 0.8, metalness: 0 })
}
