// The low-poly avatar on the profile page: a Higgsfield model (low-poly image of the photo and intro clip → Tripo
// mesh → Meshy rig) rendered flat-shaded, with a move set of Meshy animations all on the same skeleton.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const base = import.meta.env.BASE_URL
const MODEL = `${base}profile/lowpoly.glb`
const SNAP = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('snap')

export type Move = 'idle' | 'walk' | 'run' | 'jump' | 'spell' | 'wave' | 'swing' | 'dance' | 'flip'
/** Which clip in the GLB plays each move (Meshy animation names). */
const CLIP_NAMES: Record<Move, RegExp> = {
  idle: /\|Idle\|/,
  walk: /Casual_Walk/,
  run: /RunFast/,
  jump: /Regular_Jump/,
  spell: /Charged_Spell_Cast/,
  wave: /Big_Wave_Hello/,
  swing: /golf_drive/,
  dance: /All_Night_Dance/,
  flip: /Backflip/,
}
/** One-shot moves return to idle when they finish. */
const ONCE = new Set<Move>(['jump', 'spell', 'wave', 'swing', 'flip'])
const GROUND_SPEED: Partial<Record<Move, number>> = { walk: 1.3, run: 4.2 }

function findBone(root: THREE.Object3D, name: string) {
  let bone: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!bone && (o as THREE.Bone).isBone && o.name === name) bone = o
  })
  return bone as THREE.Object3D | null
}

function Avatar({ move, nonce, onDone }: { move: Move; nonce: number; onDone: () => void }) {
  const gltf = useGLTF(MODEL, false, true)
  const group = useRef<THREE.Group>(null)
  const grid = useRef<THREE.GridHelper>(null)
  const state = useMemo(
    () => ({
      current: null as THREE.AnimationAction | null,
      spell: null as THREE.AnimationAction | null,
      ringT: -1,
    }),
    [],
  )
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf])
  // Test hook (?snap).
  if (SNAP) (window as unknown as { __lp: unknown }).__lp = { mixer, scene: gltf.scene, state }

  // Flat shading for the faceted low-poly look; the hand that holds the spell orb.
  const fx = useMemo(() => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.frustumCulled = false
        const mat = m.material as THREE.MeshStandardMaterial
        mat.flatShading = true
        mat.metalness = 0
        mat.roughness = 0.85
        mat.needsUpdate = true
      }
    })
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    const light = new THREE.PointLight('#a78bfa', 0, 2.5)
    orb.add(light)
    orb.visible = false
    const hand = findBone(gltf.scene, 'RightHand')
    if (hand) {
      gltf.scene.updateMatrixWorld(true)
      const s = hand.getWorldScale(new THREE.Vector3())
      orb.userData.base = 1 / s.x
      orb.position.set(0, 0.1 / s.x, 0) // a little past the palm, along the bone
      hand.add(orb)
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#c4b5fd', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    return { orb, light, ring }
  }, [gltf])

  // The move set: every clip in the GLB, matched by its Meshy animation name.
  const clips = useMemo(() => {
    const out: Partial<Record<Move, THREE.AnimationClip>> = {}
    for (const [m, re] of Object.entries(CLIP_NAMES) as [Move, RegExp][]) {
      const c = gltf.animations.find((a) => re.test(a.name))
      if (c) out[m] = c
    }
    return out
  }, [gltf])

  // The parent passes a fresh callback each render; keep the latest without re-binding the mixer.
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  useEffect(() => {
    const done = (e: { action: THREE.AnimationAction }) => {
      if (e.action === state.current) doneRef.current()
    }
    mixer.addEventListener('finished', done)
    return () => {
      mixer.removeEventListener('finished', done)
      mixer.stopAllAction()
    }
  }, [mixer, state])

  function play(m: Move) {
    const clip = clips[m] ?? clips.idle
    if (!clip) return
    const next = mixer.clipAction(clip)
    next.reset()
    next.setLoop(ONCE.has(m) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = true
    next.setEffectiveWeight(1).play()
    if (state.current && state.current !== next) next.crossFadeFrom(state.current, 0.25, false)
    state.current = next
    state.spell = m === 'spell' ? next : null
  }

  useEffect(() => {
    play(move)
    // Replay on every request, even for the same move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move, nonce, clips])

  // Moves that should stay on the spot: keep only a little of the hips' sideways drift.
  const hips = useMemo(() => {
    const h = findBone(gltf.scene, 'Hips')
    return h ? { bone: h, rest: h.position.clone() } : null
  }, [gltf])

  useFrame((_, dt) => {
    mixer.update(dt)
    if (hips && (move === 'dance' || move === 'walk' || move === 'run')) {
      const lim = 8 // cm, in the rig's armature units
      hips.bone.position.x = hips.rest.x + THREE.MathUtils.clamp(hips.bone.position.x - hips.rest.x, -lim, lim)
      hips.bone.position.z = hips.rest.z + THREE.MathUtils.clamp(hips.bone.position.z - hips.rest.z, -lim, lim)
    }
    // Spell: the orb charges in the hand, then a shockwave rolls out across the floor.
    const sp = state.spell
    if (sp && sp.isRunning()) {
      const p = sp.time / sp.getClip().duration
      const charge = THREE.MathUtils.smoothstep(p, 0.08, 0.55)
      fx.orb.visible = p > 0.05 && p < 0.72
      fx.orb.scale.setScalar((fx.orb.userData.base ?? 1) * (0.3 + charge * 1.4 + Math.sin(p * 60) * 0.05))
      fx.orb.rotation.y += dt * 6
      fx.light.intensity = charge * 6
      if (p >= 0.62 && state.ringT < 0) state.ringT = 0
    } else {
      fx.orb.visible = false
      fx.light.intensity = 0
    }
    if (state.ringT >= 0) {
      state.ringT += dt
      const r = state.ringT / 0.8
      fx.ring.scale.setScalar(0.2 + r * 2.4)
      ;(fx.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - r))
      if (r >= 1) state.ringT = -1
    }
    // Walk and run in place over a moving floor grid.
    const speed = GROUND_SPEED[move] ?? 0
    if (grid.current && speed) grid.current.position.z = (grid.current.position.z - speed * dt) % 0.5
  })

  return (
    <>
      <group ref={group}>
        <primitive object={gltf.scene} />
      </group>
      <primitive object={fx.ring} />
      <gridHelper ref={grid} args={[6, 12, '#3b4466', '#262c44']} position={[0, 0.001, 0]} />
    </>
  )
}

export default function LowPolyAvatar({ move, nonce, onDone }: { move: Move; nonce: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="profile-3d" ref={ref}>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [1.2, 1.4, 3.6], fov: 32 }} gl={{ antialias: true }}>
        <color attach="background" args={['#0d1222']} />
        <fog attach="fog" args={['#0d1222', 4.5, 9]} />
        <hemisphereLight args={['#e0e7ff', '#2a2233', 1.1]} />
        <directionalLight position={[2.5, 4, 3]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2, -2]} intensity={1.2} color="#a5b4fc" />
        <Suspense fallback={null}>
          <Avatar move={move} nonce={nonce} onDone={onDone} />
        </Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.4} far={2} />
        <OrbitControls target={[0, 0.95, 0]} enablePan={false} minDistance={1.6} maxDistance={6} minPolarAngle={0.4} maxPolarAngle={1.7} autoRotate={!SNAP} autoRotateSpeed={0.5} />
      </Canvas>
    </div>
  )
}

useGLTF.preload(MODEL, false, true)
