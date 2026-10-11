// Models for the complex: the generated venue props, a few props reused from the other games, the rigged goalkeeper
// and the owner's low-poly avatar. Everything is optional: a missing file falls back to a procedural stand-in.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

const SPORTS = ['f1car', 'pit-garage', 'gantry', 'goal', 'ball', 'grandstand', 'floodlight', 'scoreboard', 'keeper', 'sports-hall', 'badminton-net', 'racket', 'pingpong-table'] as const
const WORLD = ['podium', 'trophy', 'f1-car', 'signpost', 'palm', 'pine', 'autumn-tree', 'barrels'] as const
const RACER = ['lamp', 'billboard'] as const
const GOLF = ['bench', 'bush', 'rocks', 'flag', 'cart', 'balloon'] as const
export type ModelName = (typeof SPORTS)[number] | (typeof WORLD)[number] | (typeof RACER)[number] | (typeof GOLF)[number]

export type AvatarMove = 'idle' | 'walk' | 'run' | 'jump' | 'swing' | 'wave' | 'dance' | 'flip' | 'spell'
const AVATAR_CLIPS: Record<AvatarMove, RegExp> = {
  idle: /\|Idle\|/,
  walk: /Casual_Walk/,
  run: /RunFast/,
  jump: /Regular_Jump/,
  swing: /golf_drive/,
  wave: /Big_Wave_Hello/,
  dance: /All_Night_Dance/,
  flip: /Backflip/,
  spell: /Charged_Spell_Cast/,
}

export interface SportsAssets {
  models: Partial<Record<ModelName, THREE.Object3D>>
  keeperIdle: THREE.AnimationClip | null
  avatar: THREE.Object3D | null
  avatarClips: Partial<Record<AvatarMove, THREE.AnimationClip>>
}

const BASE = import.meta.env.BASE_URL
const dirFor = (name: string) =>
  (SPORTS as readonly string[]).includes(name)
    ? 'sports/models/'
    : (WORLD as readonly string[]).includes(name)
      ? 'world/models/'
      : (RACER as readonly string[]).includes(name)
        ? 'racer/models/'
        : 'golf/models/'

let pending: Promise<SportsAssets> | null = null

export function loadSportsAssets(onProgress?: (done: number, total: number) => void) {
  if (pending) return pending
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const names: ModelName[] = [...SPORTS, ...WORLD, ...RACER, ...GOLF]
  const total = names.length + 1
  let done = 0
  const tick = () => onProgress?.(++done, total)
  const get = (url: string) =>
    loader
      .loadAsync(url)
      .catch(() => null)
      .finally(tick)
  pending = Promise.all([get(`${BASE}profile/lowpoly.glb`), ...names.map((n) => get(`${BASE}${dirFor(n)}${n}.glb`))]).then(([avatar, ...gs]) => {
    const out: SportsAssets = { models: {}, keeperIdle: null, avatar: avatar?.scene ?? null, avatarClips: {} }
    names.forEach((n, i) => {
      const g = gs[i]
      if (!g) return
      out.models[n] = g.scene
      if (n === 'keeper') out.keeperIdle = g.animations.find((a) => /Idle/i.test(a.name)) ?? g.animations[0] ?? null
    })
    if (avatar)
      for (const [m, re] of Object.entries(AVATAR_CLIPS) as [AvatarMove, RegExp][]) {
        const c = avatar.animations.find((a) => re.test(a.name))
        if (c) out.avatarClips[m] = c
      }
    return out
  })
  // A failed load is retried next time the page opens.
  pending.catch(() => (pending = null))
  return pending
}

const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _center = new THREE.Vector3()

/**
 * A copy of `src` scaled so its bounding box measures `dims` metres (x, y, z in the model's own frame; null = keep the
 * proportions of the given axes), centred on x/z and resting on y = 0. Geometry and materials are shared.
 */
export function fit(src: THREE.Object3D, dims: [number | null, number | null, number | null], shadows: 'cast' | 'receive' | 'both' | 'none' = 'both') {
  const root = src.clone(true)
  root.updateMatrixWorld(true)
  _box.setFromObject(root)
  _box.getSize(_size)
  _box.getCenter(_center)
  const ks = dims.map((d, i) => (d ? d / Math.max(_size.getComponent(i), 1e-4) : 0))
  const given = ks.filter((k) => k > 0)
  const avg = given.length ? given.reduce((a, b) => a + b, 0) / given.length : 1
  const k = ks.map((x) => x || avg)
  root.scale.set(k[0], k[1], k[2])
  root.position.set(-_center.x * k[0], -_box.min.y * k[1], -_center.z * k[2])
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = shadows === 'cast' || shadows === 'both'
      m.receiveShadow = shadows === 'receive' || shadows === 'both'
    }
  })
  const g = new THREE.Group()
  g.add(root)
  return g
}

/** Yaw that turns a model whose front is +X to face along (dx, dz). */
export const yawFromX = (dx: number, dz: number) => Math.atan2(-dz, dx)
/** Yaw that turns a model whose front is +Z to face along (dx, dz). */
export const yawFromZ = (dx: number, dz: number) => Math.atan2(dx, dz)

/** Many copies of one model as instanced meshes (one draw call per sub-mesh). */
export function instanced(model: THREE.Object3D, matrices: THREE.Matrix4[], shadows = true) {
  const group = new THREE.Group()
  if (!matrices.length) return group
  model.updateMatrixWorld(true)
  const tmp = new THREE.Matrix4()
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length)
    matrices.forEach((mat, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mat, m.matrixWorld)))
    im.castShadow = shadows
    im.receiveShadow = shadows
    im.computeBoundingSphere()
    group.add(im)
  })
  return group
}

export const trs = (x: number, y: number, z: number, yaw = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s))

/* ---------- The player's avatar ---------- */

export interface AvatarRig {
  root: THREE.Group // positioned and yawed by the game
  body: THREE.Group // procedural offsets (lean, swing twist)
  mixer: THREE.AnimationMixer | null
  actions: Partial<Record<AvatarMove, THREE.AnimationAction>>
  current: AvatarMove | null
  hand: THREE.Object3D | null // right hand bone (rackets go here)
  handScale: number
  hips: { bone: THREE.Object3D; restY: number } | null
}

function findBone(root: THREE.Object3D, re: RegExp) {
  let bone: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!bone && (o as THREE.Bone).isBone && re.test(o.name)) bone = o
  })
  return bone as THREE.Object3D | null
}

/** The owner's low-poly avatar (~1.75 m), flat-shaded, with its full move set; or a chunky stand-in. */
export function makeAvatar(assets: SportsAssets | null): AvatarRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  // Soft contact shadow so the player reads as grounded even outside the shadow map.
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }))
  blob.position.y = 0.03
  root.add(blob)
  if (assets?.avatar) {
    const model = cloneSkinned(assets.avatar)
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
        m.frustumCulled = false
        const mat = (m.material as THREE.MeshStandardMaterial).clone()
        mat.flatShading = true
        mat.metalness = 0
        mat.roughness = 0.85
        m.material = mat
      }
    })
    body.add(model)
    const mixer = new THREE.AnimationMixer(model)
    const actions: AvatarRig['actions'] = {}
    for (const [k, clip] of Object.entries(assets.avatarClips) as [AvatarMove, THREE.AnimationClip][]) actions[k] = mixer.clipAction(clip)
    const hand = findBone(model, /^RightHand$/) ?? findBone(model, /right.?hand/i)
    let handScale = 1
    if (hand) {
      model.updateMatrixWorld(true)
      handScale = 1 / hand.getWorldScale(new THREE.Vector3()).x
    }
    const hb = findBone(model, /^Hips$/)
    return { root, body, mixer, actions, current: null, hand, handScale, hips: hb ? { bone: hb, restY: hb.position.y } : null }
  }
  const skin = new THREE.MeshStandardMaterial({ color: '#c68e64', flatShading: true })
  const shirt = new THREE.MeshStandardMaterial({ color: '#1f2937', flatShading: true })
  const jeans = new THREE.MeshStandardMaterial({ color: '#93a8c4', flatShading: true })
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 7), shirt)
  torso.position.y = 1.15
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), skin)
  head.position.y = 1.6
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.84, 7), jeans)
  legs.position.y = 0.42
  body.add(torso, head, legs)
  body.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  const hand = new THREE.Group()
  hand.position.set(-0.35, 1.0, 0.1)
  body.add(hand)
  return { root, body, mixer: null, actions: {}, current: null, hand, handScale: 1, hips: null }
}

const ONCE = new Set<AvatarMove>(['jump', 'swing', 'wave', 'flip', 'spell'])

/** Cross-fade the avatar to a move. One-shot moves hold their last frame until something else plays. */
export function playMove(rig: AvatarRig, move: AvatarMove, opts: { from?: number; speed?: number; fade?: number; restart?: boolean } = {}) {
  const next = rig.actions[move] ?? (move === 'run' ? rig.actions.walk : undefined)
  if (opts.speed !== undefined && next) next.timeScale = opts.speed
  if (rig.current === move && !opts.restart) return
  if (!next) {
    rig.current = move
    return
  }
  const once = ONCE.has(move)
  next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
  next.clampWhenFinished = once
  if (opts.from) next.time = opts.from
  next.setEffectiveWeight(1).fadeIn(opts.fade ?? 0.2).play()
  const prev = rig.current ? rig.actions[rig.current] : undefined
  if (prev && prev !== next) prev.fadeOut(opts.fade ?? 0.2)
  rig.current = move
}

/* ---------- The goalkeeper (also the rally opponent) ---------- */

export interface KeeperRig {
  root: THREE.Group // placed by the game
  body: THREE.Group // procedural dive: translate / roll / squash
  mixer: THREE.AnimationMixer | null
  hand: THREE.Object3D | null
  handScale: number
}

/** The rigged keeper (kept as authored: centimetre armature under a 0.01 scale) playing its idle loop. */
export function makeKeeper(assets: SportsAssets | null): KeeperRig {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const src = assets?.models.keeper
  if (src) {
    const model = cloneSkinned(src)
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.frustumCulled = false
      }
    })
    body.add(model)
    const mixer = new THREE.AnimationMixer(model)
    if (assets.keeperIdle) mixer.clipAction(assets.keeperIdle).play()
    const hand = findBone(model, /^RightHand$/) ?? findBone(model, /right.?hand/i)
    let handScale = 1
    if (hand) {
      model.updateMatrixWorld(true)
      handScale = 1 / hand.getWorldScale(new THREE.Vector3()).x
    }
    return { root, body, mixer, hand, handScale }
  }
  const kit = new THREE.MeshStandardMaterial({ color: '#4ade80', flatShading: true })
  const skin = new THREE.MeshStandardMaterial({ color: '#f2c9a0', flatShading: true })
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.7, 7), kit)
  torso.position.y = 1.15
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), skin)
  head.position.y = 1.68
  const arms = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.16), kit)
  arms.position.y = 1.5
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.85, 7), new THREE.MeshStandardMaterial({ color: '#111827', flatShading: true }))
  legs.position.y = 0.43
  body.add(torso, head, arms, legs)
  body.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  const hand = new THREE.Group()
  hand.position.set(-0.7, 1.5, 0)
  body.add(hand)
  return { root, body, mixer: null, hand, handScale: 1 }
}

/* ---------- Procedural bits ---------- */

/** A badminton racket or a table tennis bat, built along +Y from the grip so it can sit in a hand bone. */
export function racketMesh(kind: 'badminton' | 'tabletennis', color = '#ef4444') {
  const g = new THREE.Group()
  const frame = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 })
  if (kind === 'badminton') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6), new THREE.MeshStandardMaterial({ color: '#d1d5db', metalness: 0.6, roughness: 0.3 }))
    shaft.position.y = 0.3
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8), new THREE.MeshStandardMaterial({ color: '#facc15' }))
    grip.position.y = 0.04
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.009, 6, 24), frame)
    head.scale.set(1, 1.3, 1)
    head.position.y = 0.6
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.105, 20), new THREE.MeshBasicMaterial({ color: '#f8fafc', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }))
    strings.scale.set(1, 1.3, 1)
    strings.position.y = 0.6
    g.add(shaft, grip, head, strings)
  } else {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.024), new THREE.MeshStandardMaterial({ color: '#b45309' }))
    handle.position.y = 0.04
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.012, 20).rotateX(Math.PI / 2), frame)
    blade.scale.set(1, 1.12, 1)
    blade.position.y = 0.16
    g.add(handle, blade)
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

/** Stand-ins when a model file fails to load: rough boxes and cylinders of about the right size, front +X. */
export function fallback(name: ModelName): THREE.Object3D {
  const g = new THREE.Group()
  const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8 })
  const box = (w: number, h: number, d: number, c: string, x = 0, y = h / 2, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c))
    m.position.set(x, y, z)
    m.castShadow = m.receiveShadow = true
    g.add(m)
    return m
  }
  switch (name) {
    case 'f1car':
    case 'f1-car':
      box(5, 0.5, 1.2, '#dc2626', 0, 0.45)
      box(0.6, 0.1, 2, '#dc2626', 2.4, 0.2)
      box(0.6, 0.5, 1.8, '#111827', -2.3, 0.8)
      for (const [x, z] of [[1.6, 0.85], [1.6, -0.85], [-1.6, 0.9], [-1.6, -0.9]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.4, 12).rotateX(Math.PI / 2), mat('#111'))
        w.position.set(x, 0.38, z)
        g.add(w)
      }
      break
    case 'pit-garage':
      box(10, 7, 16, '#e5e7eb')
      box(0.2, 5, 12, '#1d4ed8', 5.05, 2.5)
      break
    case 'gantry':
      box(1, 12, 1, '#374151', 0, 6, -8)
      box(1, 12, 1, '#374151', 0, 6, 8)
      box(1.2, 1.4, 17, '#111827', 0, 12)
      break
    case 'goal':
      box(0.15, 2.44, 0.15, '#fff', 0, 1.22, -3.66)
      box(0.15, 2.44, 0.15, '#fff', 0, 1.22, 3.66)
      box(0.15, 0.15, 7.5, '#fff', 0, 2.44)
      box(2, 2.4, 7.3, '#e5e7eb', -1.1, 1.2).material = new THREE.MeshStandardMaterial({ color: '#fff', transparent: true, opacity: 0.25 })
      break
    case 'ball': {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat('#f8fafc'))
      m.position.y = 0.5
      g.add(m)
      break
    }
    case 'grandstand':
      box(40, 4, 20, '#64748b', 0, 2)
      box(40, 4, 13, '#3b82f6', 0, 6, 3.5)
      box(40, 4, 6, '#ef4444', 0, 10, 7)
      break
    case 'floodlight':
      box(0.8, 22, 0.8, '#4b5563', 0, 11)
      box(1, 3, 5, '#e5e7eb', 0.5, 22)
      break
    case 'scoreboard':
      box(0.6, 5, 10, '#111827', 0, 5)
      box(0.4, 3, 0.4, '#4b5563', 0, 1.5, -3)
      box(0.4, 3, 0.4, '#4b5563', 0, 1.5, 3)
      break
    case 'sports-hall':
      box(40, 12, 32, '#cbd5e1')
      box(0.3, 5, 8, '#1e3a8a', 20.1, 2.5)
      break
    case 'badminton-net':
      box(0.05, 1.55, 0.05, '#4b5563', 0, 0.78, -3.05)
      box(0.05, 1.55, 0.05, '#4b5563', 0, 0.78, 3.05)
      box(0.02, 0.76, 6.1, '#1e3a8a', 0, 1.17)
      break
    case 'pingpong-table':
      box(2.74, 0.05, 1.525, '#2563eb', 0, 0.74)
      box(0.1, 0.72, 1.3, '#1f2937', 0, 0.36)
      box(0.02, 0.15, 1.7, '#f8fafc', 0, 0.84)
      break
    case 'palm':
    case 'pine':
    case 'autumn-tree': {
      box(0.5, 3, 0.5, '#7c4a21', 0, 1.5)
      const c = new THREE.Mesh(name === 'pine' ? new THREE.ConeGeometry(2, 5, 7) : new THREE.IcosahedronGeometry(2.2, 0), mat(name === 'autumn-tree' ? '#d97706' : '#2f7d32'))
      c.position.y = 4.8
      c.castShadow = true
      g.add(c)
      break
    }
    case 'lamp':
      box(0.2, 6, 0.2, '#111827', 0, 3)
      box(1.4, 0.2, 0.3, '#111827', -0.6, 6)
      break
    case 'bench':
      box(1.8, 0.1, 0.5, '#65a30d', 0, 0.45)
      box(1.8, 0.5, 0.08, '#65a30d', 0, 0.8, -0.22)
      break
    case 'bush':
    case 'rocks': {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), mat(name === 'bush' ? '#4d7c0f' : '#9ca3af'))
      m.position.y = 0.5
      g.add(m)
      break
    }
    default:
      box(1, 1, 1, '#9ca3af')
  }
  return g
}

/** The model if it loaded, otherwise a stand-in. */
export function model(assets: SportsAssets | null, name: ModelName) {
  return assets?.models[name] ?? fallback(name)
}

/** Free GPU memory for everything under `root` (geometries, materials and their textures). */
export function disposeTree(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>()
  const geos = new Set<THREE.BufferGeometry>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) geos.add(m.geometry)
    const mm = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mm)) mm.forEach((x) => mats.add(x))
    else if (mm) mats.add(mm)
  })
  for (const g of geos) g.dispose()
  for (const m of mats) {
    for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose()
    m.dispose()
  }
}
