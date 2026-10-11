// Loads the Higgsfield-generated cars, track props and textures. Anything that fails falls back to procedural meshes.
// The Dust Bowl borrows a few small props from the open world (public/world/models).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { CARS } from './cars'

export type PropName = 'lamp' | 'billboard' | 'tower' | 'crane' | 'gantry' | 'barrels' | 'cactus' | 'ruins' | 'tractor'
export type TextureName = 'asphalt' | 'facade' | 'metal' | 'concrete'

export interface RacerAssets {
  cars: Map<string, THREE.Object3D>
  props: Map<PropName, THREE.Object3D>
  textures: Partial<Record<TextureName, THREE.Texture>>
}

const base = `${import.meta.env.BASE_URL}racer/`
const worldBase = `${import.meta.env.BASE_URL}world/models/`
const WORLD_PROPS: PropName[] = ['barrels', 'cactus', 'ruins', 'tractor']
let pending: Promise<RacerAssets> | null = null

export function loadRacerAssets(onProgress?: (done: number, total: number) => void): Promise<RacerAssets> {
  if (pending) return pending
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const texLoader = new THREE.TextureLoader()
  const props: PropName[] = ['lamp', 'billboard', 'tower', 'crane', 'gantry', ...WORLD_PROPS]
  const textures: TextureName[] = ['asphalt', 'facade', 'metal', 'concrete']
  const total = CARS.length + props.length + textures.length
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const glb = (name: string) =>
    loader
      .loadAsync(WORLD_PROPS.includes(name as PropName) ? `${worldBase}${name}.glb` : `${base}models/${name}.glb`)
      .then((g) => g.scene as THREE.Object3D)
      .catch(() => null)
      .finally(tick)
  const tex = (name: TextureName) =>
    texLoader
      .loadAsync(`${base}textures/${name}.webp`)
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.anisotropy = 8
        return t
      })
      .catch(() => null)
      .finally(tick)
  pending = Promise.all([Promise.all(CARS.map((c) => glb(c.id))), Promise.all(props.map(glb)), Promise.all(textures.map(tex))]).then(
    ([carScenes, propScenes, texs]) => {
      const out: RacerAssets = { cars: new Map(), props: new Map(), textures: {} }
      CARS.forEach((c, i) => carScenes[i] && out.cars.set(c.id, carScenes[i]!))
      props.forEach((p, i) => propScenes[i] && out.props.set(p, propScenes[i]!))
      textures.forEach((t, i) => {
        if (texs[i]) out.textures[t] = texs[i]!
      })
      return out
    },
  )
  return pending
}

/**
 * Normalise a generated model: long axis along +z (front forward), `length` metres long (or `height` tall),
 * centred on x/z and resting on y = 0. The generated cars face +x; the van faces +z.
 */
export function normalizeModel(src: THREE.Object3D, opts: { length?: number; height?: number; frontAxis?: 'x' | 'z' | 'auto' }) {
  const root = src.clone(true)
  const inner = new THREE.Group()
  inner.add(root)
  const box0 = new THREE.Box3().setFromObject(root)
  const size0 = box0.getSize(new THREE.Vector3())
  const axis = opts.frontAxis === 'auto' || !opts.frontAxis ? (size0.x > size0.z ? 'x' : 'z') : opts.frontAxis
  if (axis === 'x') inner.rotation.y = -Math.PI / 2
  inner.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(inner)
  const size = box.getSize(new THREE.Vector3())
  const s = opts.length ? opts.length / Math.max(size.z, 1e-3) : (opts.height ?? 1) / Math.max(size.y, 1e-3)
  const wrap = new THREE.Group()
  wrap.add(inner)
  inner.scale.multiplyScalar(s)
  const c = box.getCenter(new THREE.Vector3())
  inner.position.set(-c.x * s, -box.min.y * s, -c.z * s)
  return { object: wrap, size: size.multiplyScalar(s) }
}
