// The Higgsfield-generated 3D avatar on the profile page: orbit to look around, click to wave.
// The model is generated without glasses (thin frames reconstruct badly and smear the eyes), so the frames are
// modelled here and attached to the head bone.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'

const URL = `${import.meta.env.BASE_URL}profile/avatar.glb`

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

export default function ProfileAvatar() {
  const [waveKey, setWaveKey] = useState(0)
  return (
    <div className="profile-3d" onClick={() => setWaveKey((k) => k + 1)}>
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 1.35, 3.1], fov: 32 }} gl={{ antialias: true }}>
        <color attach="background" args={['#0d1222']} />
        <hemisphereLight args={['#dbe6ff', '#2a2233', 0.7]} />
        <directionalLight position={[2.5, 4, 3]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2, -2]} intensity={1.1} color="#a5b4fc" />
        <Suspense fallback={null}>
          <Avatar waveKey={waveKey} />
        </Suspense>
        {/* Studio reflections built in code, so nothing is fetched from a CDN. */}
        <Environment resolution={64} environmentIntensity={0.5}>
          <Lightformer form="rect" intensity={3} position={[0, 3, 3]} scale={[4, 2, 1]} />
          <Lightformer form="rect" intensity={1.5} position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[3, 3, 1]} color="#c7d2fe" />
          <Lightformer form="rect" intensity={1.5} position={[4, 1, 0]} rotation-y={-Math.PI / 2} scale={[3, 3, 1]} color="#fbcfe8" />
        </Environment>
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.4} far={2} />
        <OrbitControls
          target={[0, 1.02, 0]}
          enablePan={false}
          minDistance={1.4}
          maxDistance={4.5}
          minPolarAngle={0.5}
          maxPolarAngle={1.75}
          autoRotate={!SNAP}
          autoRotateSpeed={0.6}
        />
      </Canvas>
      <span className="profile-3d-hint">Drag to look around · click to wave</span>
    </div>
  )
}

useGLTF.preload(URL, false, true)
