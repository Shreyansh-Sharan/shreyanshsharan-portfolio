// The few downloaded files: one shared cricketer (meshopt + WebP) and three small surface textures. Everything else
// (stadium, crowd, kit, bat, pads, stumps) is built in code. All CC0 (public domain):
//  - cricketer.glb: Quaternius "Universal Base Characters" body with clips from the "Universal Animation Library" 1 and 2
//    (quaternius.com), converted from unity/CricketGame/Assets/Cricket/Models/Cricketer.glb;
//  - grass.webp, pitch.webp, concrete.webp: ambientCG Grass005, Ground109 and Concrete034 (ambientcg.com).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export interface CricketAssets {
  body: THREE.Object3D
  clips: Record<string, THREE.AnimationClip>
  grass: THREE.Texture
  pitch: THREE.Texture
  concrete: THREE.Texture
}

const base = `${import.meta.env.BASE_URL}cricket/`
let pending: Promise<CricketAssets> | null = null

export function loadCricketAssets(onProgress?: (done: number, total: number) => void): Promise<CricketAssets> {
  if (pending) return pending
  const total = 4
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const texLoader = new THREE.TextureLoader()
  const tex = (name: string) =>
    texLoader
      .loadAsync(base + name)
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.anisotropy = 4
        return t
      })
      .finally(tick)
  const gltf = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(base + 'cricketer.glb')
    .finally(tick)
  pending = Promise.all([gltf, tex('grass.webp'), tex('pitch.webp'), tex('concrete.webp')]).then(([g, grass, pitch, concrete]) => {
    const clips: Record<string, THREE.AnimationClip> = {}
    for (const c of g.animations) clips[c.name] = c
    return { body: g.scene, clips, grass, pitch, concrete }
  })
  pending.catch(() => (pending = null))
  return pending
}
