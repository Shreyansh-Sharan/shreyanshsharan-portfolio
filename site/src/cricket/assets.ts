// The cricket models (original models made for this project, see public/cricket/CREDITS.md) and three small surface
// textures:
//  - player-*.glb: five rigged bodies (two fielders, a batter in helmet, pads and gloves, a keeper, the umpire),
//    each with the movement clips retargeted onto its skeleton; the kit is a neutral grey that the game paints in
//    team colours through each body's kit mask (player-*-kit.webp: which texels are shirt, trim, trousers, cap or
//    helmet, pads, gloves or skin; the reference tones are in the material's extras);
//  - bat, ball, stumps (one stump and one bail), and the venue: a grandstand section, the pavilion, sight screens,
//    the scoreboard, boundary boards, floodlight towers and a pitch roller;
//  - turf.webp (+ its normal map), pitch-soil.webp, pitch-worn.webp: original seamless ground textures made for this
//    project (the outfield's mown ryegrass, the rolled pitch, the scuffed footholds).
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

export type BodyKind = 'fielderA' | 'fielderB' | 'batter' | 'keeper' | 'umpire'

export interface CricketBody {
  scene: THREE.Object3D
  /** The movement clips, by name, retargeted onto this body. */
  clips: Record<string, THREE.AnimationClip>
  /** Kit classes per texel (class id * 32 in red), sampled nearest. */
  mask: THREE.Texture
  /** Each class's reference luminance (linear): the tone a team colour is painted at. */
  refs: number[]
}

export interface CricketAssets {
  bodies: Record<BodyKind, CricketBody>
  ball: THREE.Mesh
  bat: THREE.Object3D
  stump: THREE.Mesh
  bail: THREE.Mesh
  stand: THREE.Mesh
  /** A lighter stand for the low graphics tier. */
  standLow: THREE.Mesh
  /** Crowd seats on one stand section (x, y, z in its own space). */
  standSeats: Float32Array
  pavilion: THREE.Object3D
  sightScreen: THREE.Object3D
  scoreboard: THREE.Object3D
  /** The scoreboard's screen: [x0, y0, x1, y1, z] in its own space. */
  scoreboardFace: number[]
  adBoard: THREE.Mesh
  adBoardFace: number[]
  floodlight: THREE.Object3D
  roller: THREE.Object3D
  turf: THREE.Texture
  turfNormal: THREE.Texture
  soil: THREE.Texture
  worn: THREE.Texture
}

const base = `${import.meta.env.BASE_URL}cricket/`
let pending: Promise<CricketAssets> | null = null

const BODY_FILES: Record<BodyKind, string> = {
  fielderA: 'player-fielder-a',
  fielderB: 'player-fielder-b',
  batter: 'player-batter',
  keeper: 'player-keeper',
  umpire: 'player-umpire',
}

/** The first mesh of a file baked to one mesh in the file's space (the compressed files keep their vertices
 *  quantised behind a node transform). */
function firstMesh(root: THREE.Object3D, name?: string) {
  let out: THREE.Mesh | null = null
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (out || !m.isMesh || (name && m.name !== name && m.parent?.name !== name)) return
    const g = m.geometry.clone()
    // Dequantise first: baking metres into normalised integer attributes would clamp them.
    for (const k of ['position', 'normal'] as const) {
      const a = g.getAttribute(k)
      if (a && !(a.array instanceof Float32Array)) {
        const f = new Float32Array(a.count * a.itemSize)
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c)
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize))
      }
    }
    g.applyMatrix4(m.matrixWorld)
    out = new THREE.Mesh(g, m.material)
    out.userData = { ...m.userData, ...(m.parent?.userData ?? {}) }
  })
  return out ?? new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial())
}

/** The extras a file keeps on its mesh node (seats, panel faces). */
function extras(root: THREE.Object3D, key: string): number[] {
  let v: number[] | null = null
  root.traverse((o) => {
    if (!v && Array.isArray(o.userData[key])) v = o.userData[key] as number[]
  })
  return v ?? []
}

export function loadCricketAssets(onProgress?: (done: number, total: number) => void): Promise<CricketAssets> {
  if (pending) return pending
  const bodyKinds = Object.keys(BODY_FILES) as BodyKind[]
  const total = bodyKinds.length * 2 + 14
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const texLoader = new THREE.TextureLoader()
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const tex = (name: string, linear = false) =>
    texLoader
      .loadAsync(base + name)
      .then((t) => {
        t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.anisotropy = 4
        return t
      })
      .finally(tick)
  const mask = (name: string) =>
    texLoader
      .loadAsync(base + name)
      .then((t) => {
        // Class ids: never blended between texels, never mipmapped, never colour-converted.
        t.colorSpace = THREE.NoColorSpace
        t.magFilter = THREE.NearestFilter
        t.minFilter = THREE.NearestFilter
        t.generateMipmaps = false
        t.flipY = false
        return t
      })
      .finally(tick)
  const gltf = (name: string): Promise<GLTF> => gltfLoader.loadAsync(base + name).finally(tick)
  const bodies = Promise.all(
    bodyKinds.map((k) =>
      Promise.all([gltf(`${BODY_FILES[k]}.glb`), mask(`${BODY_FILES[k]}-kit.webp`)]).then(([g, m]): [BodyKind, CricketBody] => {
        const clips: Record<string, THREE.AnimationClip> = {}
        for (const c of g.animations) clips[c.name] = c
        let refs: number[] = []
        g.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (mesh.isMesh) refs = ((mesh.material as THREE.Material).userData.kitRefs as number[]) ?? refs
        })
        return [k, { scene: g.scene, clips, mask: m, refs }]
      }),
    ),
  )
  pending = Promise.all([
    bodies,
    gltf('ball.glb'),
    gltf('bat.glb'),
    gltf('stumps.glb'),
    gltf('stand.glb'),
    gltf('pavilion.glb'),
    gltf('sightscreen.glb'),
    gltf('scoreboard.glb'),
    gltf('adboard.glb'),
    gltf('floodlight.glb'),
    gltf('roller.glb'),
    tex('turf.webp'),
    tex('turf-normal.webp', true),
    tex('pitch-soil.webp'),
    tex('pitch-worn.webp'),
  ]).then(([bodyList, ball, bat, stumps, stand, pavilion, sight, score, board, flood, roller, turf, turfNormal, soil, worn]) => {
    for (const t of [bat, pavilion, sight, score, flood, roller]) t.scene.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).frustumCulled = true) : null))
    return {
      bodies: Object.fromEntries(bodyList) as Record<BodyKind, CricketBody>,
      ball: firstMesh(ball.scene),
      bat: bat.scene,
      stump: firstMesh(stumps.scene, 'stump'),
      bail: firstMesh(stumps.scene, 'bail'),
      stand: firstMesh(stand.scene, 'stand'),
      standLow: firstMesh(stand.scene, 'standLOD'),
      standSeats: new Float32Array(extras(stand.scene, 'seats')),
      pavilion: pavilion.scene,
      sightScreen: sight.scene,
      scoreboard: score.scene,
      scoreboardFace: extras(score.scene, 'face'),
      adBoard: firstMesh(board.scene),
      adBoardFace: extras(board.scene, 'face'),
      floodlight: flood.scene,
      roller: roller.scene,
      turf,
      turfNormal,
      soil,
      worn,
    }
  })
  pending.catch(() => (pending = null))
  return pending
}
