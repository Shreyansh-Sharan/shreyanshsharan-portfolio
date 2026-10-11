// The Higgsfield-generated 3D avatar on the profile page: orbit to look around, click to wave.
// The model is generated without glasses (thin frames reconstruct badly and smear the eyes), so the frames are
// modelled here and attached to the head bone.
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, Stage, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const URL = `${import.meta.env.BASE_URL}profile/avatar.glb`
const GAME_URL = `${import.meta.env.BASE_URL}profile/game-character.glb`

/** Glasses in model space at the bind pose, in metres (measured on the generated model: eye line ~1.655 m). */
const GLASSES = { center: [0, 1.655, 0.126] as const, width: 0.146, lensW: 0.053, lensH: 0.036, rim: 0.0045, temple: 0.12 }
/** The generated head looks slightly upwards; level it (radians about the head's own x axis). */
const SNAP = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('snap')
const HEAD_PITCH = SNAP && new URLSearchParams(window.location.search).has('pitch') ? Number(new URLSearchParams(window.location.search).get('pitch')) : 0.2

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -h / 2)
  s.lineTo(w / 2 - r, -h / 2)
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  s.lineTo(w / 2, h / 2 - r)
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  s.lineTo(-w / 2 + r, h / 2)
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  s.lineTo(-w / 2, -h / 2 + r)
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  return s
}

/** Thin rounded-rectangle frames like the real ones: matte black acetate, clear lenses, temples to the ears. */
function glassesMesh() {
  const g = new THREE.Group()
  const frame = new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.4, metalness: 0.1 })
  const lens = new THREE.MeshPhysicalMaterial({ color: '#dfe8f5', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.08, depthWrite: false })
  const { width, lensW, lensH, rim, temple } = GLASSES
  for (const side of [-1, 1]) {
    const cx = side * (width / 2 - lensW / 2 - rim)
    const outer = roundedRect(lensW + rim * 2, lensH + rim * 2, 0.011)
    outer.holes.push(roundedRect(lensW, lensH, 0.008))
    const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.0035, bevelEnabled: false, curveSegments: 6 }), frame)
    ring.position.set(cx, 0, -0.0035)
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(lensW, lensH, 0.008), 6), lens)
    glass.position.set(cx, 0, -0.002)
    // Temple arm from the outer corner back towards the ear.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.0045, temple), frame)
    arm.position.set(side * (width / 2 - 0.001), lensH / 2 - 0.004, -temple / 2 - 0.003)
    arm.rotation.y = side * -0.06
    g.add(ring, glass, arm)
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(width - (lensW + rim * 2) * 2 + 0.004, 0.004, 0.0035), frame)
  bridge.position.set(0, lensH / 2 - 0.006, -0.002)
  g.add(bridge)
  return g
}

function findHead(root: THREE.Object3D) {
  let head: THREE.Bone | null = null
  root.traverse((o) => {
    const b = o as THREE.Bone
    if (b.isBone && !head && /head$/i.test(b.name.replace(/[^a-z]/gi, ''))) head = b
  })
  return head as THREE.Bone | null
}

function Avatar({ waveKey }: { waveKey: number }) {
  const gltf = useGLTF(URL, false, true)
  const group = useRef<THREE.Group>(null)
  const { actions, names } = useAnimations(gltf.animations, group)

  const head = useMemo(() => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.frustumCulled = false
        const mat = m.material as THREE.MeshStandardMaterial
        mat.envMapIntensity = 0.8
      }
    })
    const head = findHead(gltf.scene)
    if (head && !head.getObjectByName('glasses')) {
      // Place the frames in model space at the bind pose, then parent them to the head so they follow it.
      gltf.scene.updateMatrixWorld(true)
      const g = glassesMesh()
      g.name = 'glasses'
      const p = new THREE.Vector3(...GLASSES.center)
      const q = new THREE.Quaternion()
      const sc = new THREE.Vector3()
      head.matrixWorld.decompose(new THREE.Vector3(), q, sc)
      g.position.copy(head.worldToLocal(p))
      g.quaternion.copy(q.invert())
      g.scale.setScalar(1 / sc.x)
      head.add(g)
    }
    return head
  }, [gltf])

  // Runs after the animation mixer each frame: level the head. When the wave has finished the mixer stops writing
  // the bone, so correct from the last animated pose rather than stacking rotations.
  const fix = useMemo(() => ({ base: new THREE.Quaternion(), last: new THREE.Quaternion(), ready: false, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), HEAD_PITCH) }), [])
  useFrame(() => {
    if (!head) return
    if (!fix.ready || !head.quaternion.equals(fix.last)) fix.base.copy(head.quaternion)
    head.quaternion.copy(fix.base).multiply(fix.q)
    fix.last.copy(head.quaternion)
    fix.ready = true
  })

  // Wave on load and whenever the visitor clicks the avatar.
  useEffect(() => {
    const a = actions[names[0]]
    if (!a) return
    a.reset().setLoop(THREE.LoopOnce, 1)
    a.clampWhenFinished = false
    a.play()
  }, [actions, names, waveKey])

  return (
    <group ref={group}>
      <primitive object={gltf.scene} />
    </group>
  )
}

/**
 * A free rigged "game character" (the Khronos Fox, CC-BY 4.0 by tomkranis / Asobo Studio).
 * Normalised to a comfortable size, rested on the ground, with its built-in animations cycling.
 */
function GameCharacter() {
  const gltf = useGLTF(GAME_URL, false, true)
  const group = useRef<THREE.Group>(null)
  const model = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
        m.frustumCulled = false
      }
    })
    // Turn it to a three-quarter view so it reads as a character, not a silhouette.
    // <Stage> centres, grounds and frames it, so no manual scaling here.
    const wrap = new THREE.Group()
    wrap.add(root)
    wrap.rotation.y = Math.PI * 0.75
    return wrap
  }, [gltf])
  const { actions, names } = useAnimations(gltf.animations, group)
  const [clip, setClip] = useState(0)

  useEffect(() => {
    const name = names[clip % names.length]
    const a = name ? actions[name] : undefined
    a?.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play()
    return () => {
      a?.fadeOut(0.3)
    }
  }, [actions, names, clip])

  return (
    <group ref={group} onClick={() => setClip((c) => c + 1)}>
      <primitive object={model} />
    </group>
  )
}

function Studio({ children, target, autoRotate = true }: { children: ReactNode; target: [number, number, number]; autoRotate?: boolean }) {
  return (
    <>
      {/* Accent-tinted key + rim lighting with a soft hemisphere fill. */}
      <hemisphereLight args={['#dbe6ff', '#211b2e', 0.75]} />
      <directionalLight position={[2.5, 4, 3]} intensity={2.3} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-3, 2.4, -2]} intensity={1.3} color="#a5b4fc" />
      <spotLight position={[0, 3.4, 2.4]} angle={0.6} penumbra={0.9} intensity={1.4} color="#fbcfe8" />
      {/* Studio reflections built in code, so nothing is fetched from a CDN. */}
      <Environment resolution={64} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={3} position={[0, 3, 3]} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[3, 3, 1]} color="#c7d2fe" />
        <Lightformer form="rect" intensity={1.6} position={[4, 1, 0]} rotation-y={-Math.PI / 2} scale={[3, 3, 1]} color="#fbcfe8" />
      </Environment>
      <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={4.5} blur={2.6} far={2.2} />
      {children}
      <OrbitControls
        target={target}
        enablePan={false}
        minDistance={1.4}
        maxDistance={6}
        minPolarAngle={0.4}
        maxPolarAngle={1.75}
        autoRotate={autoRotate && !SNAP}
        autoRotateSpeed={0.6}
      />
    </>
  )
}

export default function ProfileAvatar({ variant = 'me' }: { variant?: 'me' | 'game' }) {
  const [waveKey, setWaveKey] = useState(0)
  const isGame = variant === 'game'
  return (
    <div className="profile-3d" onClick={() => !isGame && setWaveKey((k) => k + 1)}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={isGame ? { position: [0.4, 1.4, 4.6], fov: 38 } : { position: [0, 1.35, 3.1], fov: 32 }}
        gl={{ antialias: true }}
      >
        {/* A subtle accent gradient backdrop instead of a flat void. */}
        <color attach="background" args={[isGame ? '#101827' : '#0d1222']} />
        {!isGame && <fog attach="fog" args={['#0d1222', 6, 12]} />}
        <Suspense fallback={null}>
          {isGame ? (
            <>
              {/* Stage auto-centres, grounds, frames and lights the model. */}
              <Stage intensity={0.6} environment={null} preset="rembrandt" shadows={{ type: 'contact', opacity: 0.5, blur: 2.6 }} adjustCamera={1.1}>
                <GameCharacter />
              </Stage>
              <OrbitControls makeDefault enablePan={false} minPolarAngle={0.3} maxPolarAngle={1.75} autoRotate={!SNAP} autoRotateSpeed={0.7} />
            </>
          ) : (
            <Studio target={[0, 1.02, 0]}>
              <Avatar waveKey={waveKey} />
            </Studio>
          )}
        </Suspense>
      </Canvas>
      <span className="profile-3d-hint">
        {isGame ? 'Drag to orbit · click to change pose' : 'Drag to look around · click to wave'}
      </span>
    </div>
  )
}

useGLTF.preload(URL, false, true)
useGLTF.preload(GAME_URL, false, true)
