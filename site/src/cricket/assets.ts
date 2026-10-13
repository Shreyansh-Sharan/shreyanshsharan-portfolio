// The downloaded models (all CC BY, see public/cricket/CREDITS.md) and three small surface textures:
//  - player-1.glb, player-2.glb: numaan.k99's rigged cricketers (Mixamo-style skeleton), kit textures stripped so the
//    game can paint fictional team colours; player-1 carries the movement clips retargeted from the old library;
//  - ball.glb (TakeRefuge3D photoscan), bat.glb (AMBROOOSE), helmet.glb (pradeepaanandhi5420), stumps.glb (Piyush
//    Ashok, straightened into one stump and one bail), stadium.glb (Shayan's Ekana, field removed);
//  - kit-top.webp, kit-bottom.webp: the jersey and trouser shading/trim maps the kit painter tints at runtime;
//  - grass.webp, pitch.webp, concrete.webp: ambientCG Grass005, Ground109 and Concrete034 (CC0).
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface CricketAssets {
  /** Two player bodies (different faces and hair), same skeleton. */
  bodies: THREE.Object3D[]
  clips: Record<string, THREE.AnimationClip>
  ball: THREE.Mesh
  bat: THREE.Object3D
  helmet: THREE.Object3D
  stump: THREE.BufferGeometry
  bail: THREE.BufferGeometry
  stadium: THREE.Object3D
  kitTop: HTMLImageElement
  kitBottom: HTMLImageElement
  grass: THREE.Texture
  pitch: THREE.Texture
  concrete: THREE.Texture
}

const base = `${import.meta.env.BASE_URL}cricket/`
let pending: Promise<CricketAssets> | null = null

/** Collects the geometries of every mesh called `name` into one (the stumps file keeps them as parts). */
function mergeNamed(root: THREE.Object3D, name: string) {
  const parts: THREE.BufferGeometry[] = []
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.name !== name) return
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld)
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    parts.push(g.index ? g.toNonIndexed() : g)
  })
  const merged = parts.length ? mergeGeometries(parts) : null
  return merged ?? new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8)
}

export function loadCricketAssets(onProgress?: (done: number, total: number) => void): Promise<CricketAssets> {
  if (pending) return pending
  const total = 12
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const texLoader = new THREE.TextureLoader()
  const imgLoader = new THREE.ImageLoader()
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
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
  const img = (name: string) => imgLoader.loadAsync(base + name).finally(tick)
  const gltf = (name: string) => gltfLoader.loadAsync(base + name).finally(tick)
  pending = Promise.all([
    gltf('player-1.glb'),
    gltf('player-2.glb'),
    gltf('ball.glb'),
    gltf('bat.glb'),
    gltf('helmet.glb'),
    gltf('stumps.glb'),
    gltf('stadium.glb'),
    img('kit-top.webp'),
    img('kit-bottom.webp'),
    tex('grass.webp'),
    tex('pitch.webp'),
    tex('concrete.webp'),
  ]).then(([p1, p2, ball, bat, helmet, stumps, stadium, kitTop, kitBottom, grass, pitch, concrete]) => {
    const clips: Record<string, THREE.AnimationClip> = {}
    for (const c of p1.animations) clips[c.name] = c
    // The ball as one mesh in metres (the compressed file keeps its vertices quantised behind a node transform).
    let ballMesh: THREE.Mesh | null = null
    ball.scene.updateMatrixWorld(true)
    ball.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !ballMesh) ballMesh = new THREE.Mesh(m.geometry.clone().applyMatrix4(m.matrixWorld), m.material)
    })
    for (const t of [p1, p2, bat, helmet, stadium]) t.scene.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).frustumCulled = true) : null))
    return {
      bodies: [p1.scene, p2.scene],
      clips,
      ball: ballMesh ?? new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8), new THREE.MeshStandardMaterial({ color: '#8b1a1a' })),
      bat: bat.scene,
      helmet: helmet.scene,
      stump: mergeNamed(stumps.scene, 'stump'),
      bail: mergeNamed(stumps.scene, 'bail'),
      stadium: stadium.scene,
      kitTop,
      kitBottom,
      grass,
      pitch,
      concrete,
    }
  })
  pending.catch(() => (pending = null))
  return pending
}
