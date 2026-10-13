// Generated 3D assets: a rigged cartoon golfer (run, idle, golf swing) and props. All optional: every
// asset has a procedural fallback so the game still runs if a file fails to load.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Generated for this game.
const OWN = ['briefcase', 'flag', 'tree', 'pine', 'rocket', 'pistol', 'magnet', 'cart', 'clubhouse', 'bench', 'rocks', 'bush', 'windmill', 'balloon'] as const
// Reused from the portfolio's open world.
const WORLD = ['autumn-tree', 'palm', 'sheep', 'tractor', 'signpost', 'barrels', 'trophy', 'podium', 'cactus', 'ruins', 'crystals', 'neon-tower', 'observatory'] as const
export type PropName = (typeof OWN)[number] | (typeof WORLD)[number]

export interface GolfAssets {
  golfer: THREE.Object3D | null
  clips: Partial<Record<'run' | 'idle' | 'swing', THREE.AnimationClip>>
  props: Partial<Record<PropName, THREE.Object3D>>
}

const base = `${import.meta.env.BASE_URL}golf/models/`
const worldBase = `${import.meta.env.BASE_URL}world/models/`
let pending: Promise<GolfAssets> | null = null

export function loadGolfAssets(onProgress?: (done: number, total: number) => void) {
  if (pending) return pending
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const props: PropName[] = [...OWN, ...WORLD]
  const total = props.length + 4
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const get = (name: string) =>
    loader
      .loadAsync(((WORLD as readonly string[]).includes(name) ? worldBase : base) + name + '.glb')
      .catch(() => null)
      .finally(tick)
  // One mesh and three animation-only files, all from the same rig so the clips share its skeleton.
  pending = Promise.all([get('golfer'), get('golfer-run'), get('golfer-idle'), get('golfer-swing'), ...props.map(get)]).then(([g, run, idle, swing, ...ps]) => {
    const out: GolfAssets = { golfer: g?.scene ?? null, clips: {}, props: {} }
    if (run?.animations[0]) out.clips.run = run.animations[0]
    if (idle?.animations[0]) out.clips.idle = idle.animations[0]
    if (swing?.animations[0]) out.clips.swing = swing.animations[0]
    props.forEach((p, i) => {
      if (ps[i]) out.props[p] = ps[i]!.scene
    })
    return out
  })
  return pending
}

/** A prop scaled to `size` metres along its largest axis (or height), centred, resting on y = 0. */
export function prop(src: THREE.Object3D, size: number, by: 'height' | 'max' = 'height') {
  const root = src.clone(true)
  const box = new THREE.Box3().setFromObject(root)
  const s = box.getSize(new THREE.Vector3())
  const c = box.getCenter(new THREE.Vector3())
  const k = size / Math.max(by === 'height' ? s.y : Math.max(s.x, s.y, s.z), 1e-3)
  root.scale.setScalar(k)
  root.position.set(-c.x * k, -box.min.y * k, -c.z * k)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
    }
  })
  const g = new THREE.Group()
  g.add(root)
  return g
}

/** Recolour a texture's white/light-grey cloth (the polo shirt) to a player colour, keeping its shading. */
function tintTexture(tex: THREE.Texture, color: THREE.Color) {
  const img = tex.image as CanvasImageSource & { width: number; height: number }
  if (!img || !img.width) return tex
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height)
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2]
    const max = Math.max(r, gg, b), min = Math.min(r, gg, b)
    // Bright and unsaturated: the shirt. Shade the player colour by the original brightness.
    if (max > 150 && max - min < 28) {
      const l = max / 255
      d[i] = Math.min(255, color.r * 255 * (0.35 + l * 0.75))
      d[i + 1] = Math.min(255, color.g * 255 * (0.35 + l * 0.75))
      d[i + 2] = Math.min(255, color.b * 255 * (0.35 + l * 0.75))
    }
  }
  g.putImageData(data, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.flipY = tex.flipY
  t.wrapS = tex.wrapS
  t.wrapT = tex.wrapT
  return t
}

// Hand-bone-space direction of the shaft, measured from the rig's address pose so the clubhead rests at the ball.
const CLUB_DIR = new THREE.Vector3(0.874, 0.353, 0.334).normalize()
const CLUB_LEN = 0.5

function clubMesh() {
  const g = new THREE.Group()
  const L = CLUB_LEN
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, L, 6), new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.8, roughness: 0.3 }))
  shaft.position.y = L / 2
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 6), new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.8 }))
  grip.position.y = 0.03
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: '#d1d5db', metalness: 0.9, roughness: 0.25 }))
  head.position.set(0.025, L, 0)
  g.add(shaft, grip, head)
  for (const m of g.children) m.castShadow = true
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), CLUB_DIR)
  return g
}

export interface GolferRig {
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
  actions: Partial<Record<'run' | 'idle' | 'swing', THREE.AnimationAction>>
  body: THREE.Object3D // tilts when stunned
  swingPhase?: 'hold' | 'out' | null
  current?: 'run' | 'idle' | 'swing'
}

/** A golfer for one player: the generated rig (shirt in the player's colour, a club in hand) or a chunky fallback. */
export function makeGolfer(assets: GolfAssets | null, color: string): GolferRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const col = new THREE.Color(color)
  if (assets?.golfer) {
    const model = cloneSkinned(assets.golfer)
    // The rigs are in centimetres under a 0.01-scaled armature (kept unflattened); the golfer is ~1.7 m tall.
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (m.isMesh) {
        m.castShadow = true
        m.frustumCulled = false
        const mat = (m.material as THREE.MeshStandardMaterial).clone()
        if (mat.map) mat.map = tintTexture(mat.map, col)
        m.material = mat
      }
    })
    let hand: THREE.Object3D | null = null
    model.traverse((o) => {
      if (!hand && (o as THREE.Bone).isBone && /right.?hand$|hand.?r$|righthand/i.test(o.name)) hand = o
    })
    if (hand) {
      const club = clubMesh()
      const h = hand as THREE.Object3D
      h.updateWorldMatrix(true, false)
      const s = new THREE.Vector3()
      h.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
      club.scale.setScalar(1 / s.x)
      h.add(club)
    }
    body.add(model)
    const mixer = new THREE.AnimationMixer(model)
    const actions: GolferRig['actions'] = {}
    for (const k of ['run', 'idle', 'swing'] as const) {
      const clip = assets.clips[k]
      if (clip) actions[k] = mixer.clipAction(clip)
    }
    return { root, mixer, actions, body }
  }
  // Fallback: a chunky low-poly golfer.
  const skin = new THREE.MeshStandardMaterial({ color: '#f2c9a0', flatShading: true })
  const shirt = new THREE.MeshStandardMaterial({ color: col, flatShading: true })
  const pants = new THREE.MeshStandardMaterial({ color: '#d6c7a1', flatShading: true })
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.6, 7), shirt)
  torso.position.y = 1.0
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), skin)
  head.position.y = 1.5
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.12, 8), shirt)
  cap.position.y = 1.68
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.7, 7), pants)
  legs.position.y = 0.38
  body.add(torso, head, cap, legs)
  body.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return { root, mixer: null, actions: {}, body }
}
