// The 3D layer behind the UI: ribbon backdrop, a glowing grid floor, drifting particles and the
// selected tile's emblem, which lands on whichever element carries `data-emblem-anchor`.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { RIBBON_FRAG, hexToRgb } from '../lib/ribbons'
import { EMBLEMS } from './emblemMap'

export type SceneMode = 'boot' | 'home' | 'page'

interface SceneProps {
  accent: [string, string]
  emblem: string
  mode: SceneMode
  paused?: boolean
  onReady?: () => void
}

const CAMERA_Z = 8
const FOV = 40

/* ---------- Backdrop: the ribbon shader drawn as a full-screen quad behind everything ---------- */

function Backdrop({ accent }: { accent: [string, string] }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const target = useRef({ a: new THREE.Vector3(...hexToRgb(accent[0])), b: new THREE.Vector3(...hexToRgb(accent[1])) })
  useEffect(() => {
    target.current.a.set(...hexToRgb(accent[0]))
    target.current.b.set(...hexToRgb(accent[1]))
  }, [accent])
  const [uniforms] = useState(() => ({
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 8 },
    uA: { value: new THREE.Vector3(...hexToRgb(accent[0])) },
    uB: { value: new THREE.Vector3(...hexToRgb(accent[1])) },
  }))
  const size = useMemo(() => new THREE.Vector2(), [])
  useFrame(({ gl }, dt) => {
    if (!mat.current) return
    const u = mat.current.uniforms
    const k = 1 - Math.exp(-dt * 3)
    gl.getDrawingBufferSize(size)
    u.uRes.value.copy(size)
    u.uTime.value += dt
    u.uA.value.lerp(target.current.a, k)
    u.uB.value.lerp(target.current.b, k)
  })
  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        vertexShader="void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }"
        fragmentShader={RIBBON_FRAG}
      />
    </mesh>
  )
}

/* ---------- Grid floor that scrolls towards the camera ---------- */

const GRID_FRAG = `
uniform vec3 uColor;
uniform float uTime;
varying vec3 vWorld;
void main() {
  vec2 p = vWorld.xz + vec2(0.0, uTime * 0.6);
  vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float dist = length(vWorld.xz - vec2(0.0, 2.0));
  float fade = smoothstep(16.0, 2.0, dist);
  gl_FragColor = vec4(uColor * (0.25 + line * 1.6), line * fade * 0.55);
}
`
const GRID_VERT = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

function GridFloor({ color, mode }: { color: string; mode: SceneMode }) {
  const ref = useRef<THREE.Mesh>(null)
  const [uniforms] = useState(() => ({ uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } }))
  const target = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 3)
    if (ref.current) {
      const u = (ref.current.material as THREE.ShaderMaterial).uniforms
      u.uTime.value += dt * (mode === 'boot' ? 2.2 : 1)
      u.uColor.value.lerp(target.set(color), k)
      const y = mode === 'page' ? -3.6 : -2.4
      ref.current.position.y += (y - ref.current.position.y) * k
    }
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.4, 0]}>
      <planeGeometry args={[60, 40]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={GRID_VERT}
        fragmentShader={GRID_FRAG}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

/* ---------- Drifting particles ---------- */

// Deterministic pseudo-random in [0, 1) so the field is stable across renders.
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function Particles({ color, count }: { color: string; count: number }) {
  const points = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand(i * 3) - 0.5) * 26
      pos[i * 3 + 1] = rand(i * 3 + 1) * 10 - 3
      pos[i * 3 + 2] = rand(i * 3 + 2) * -14 + 3
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [count])
  const mat = useRef<THREE.PointsMaterial>(null)
  const target = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    if (!points.current) return
    const pos = points.current.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + dt * (0.15 + (i % 7) * 0.04)
      if (y > 7) y = -3
      pos.setY(i, y)
    }
    pos.needsUpdate = true
    points.current.rotation.y += dt * 0.02
    mat.current?.color.lerp(target.set(color), 1 - Math.exp(-dt * 3))
  })
  return (
    <points ref={points} geometry={geo}>
      <pointsMaterial ref={mat} size={0.06} sizeAttenuation transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

/* ---------- Emblem stage: positions the emblem over the DOM anchor and animates swaps ---------- */

interface Slot {
  key: number
  id: string
  born: number
  leaving: number | null
}

function screenToWorld(cx: number, cy: number, w: number, h: number) {
  const visH = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  const visW = visH * (w / h)
  return { x: (cx / w - 0.5) * visW, y: -(cy / h - 0.5) * visH, visH }
}

function EmblemStage({ emblem, mode, accent }: { emblem: string; mode: SceneMode; accent: [string, string] }) {
  const [slots, setSlots] = useState<Slot[]>([{ key: 0, id: emblem, born: 0, leaving: null }])
  const nextKey = useRef(1)
  const clock = useThree((s) => s.clock)
  const stage = useRef<THREE.Group>(null)
  const launch = useRef(0)

  useEffect(() => {
    setSlots((prev) => {
      if (prev.some((s) => s.id === emblem && s.leaving === null)) return prev
      const now = clock.elapsedTime
      const kept = prev.filter((s) => s.leaving === null || now - s.leaving < 0.6)
      return [...kept.map((s) => (s.leaving === null ? { ...s, leaving: now } : s)), { key: nextKey.current++, id: emblem, born: now, leaving: null }]
    })
  }, [emblem, clock])

  useEffect(() => {
    const onLaunch = () => (launch.current = clock.elapsedTime)
    window.addEventListener('emblem-launch', onLaunch)
    return () => window.removeEventListener('emblem-launch', onLaunch)
  }, [clock])

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = clock.elapsedTime
      setSlots((prev) => {
        const next = prev.filter((s) => s.leaving === null || now - s.leaving < 0.6)
        return next.length === prev.length ? prev : next
      })
    }, 700)
    return () => window.clearInterval(id)
  }, [clock])

  const goal = useRef({ x: 2.6, y: 0, s: 1, o: 1 })
  useFrame(({ size }, dt) => {
    // Find where the page wants the emblem; fall back to a mode default.
    const anchor = document.querySelector<HTMLElement>('[data-emblem-anchor]')
    const r = anchor?.getBoundingClientRect()
    if (r && r.width > 0 && r.height > 0) {
      const p = screenToWorld(r.left + r.width / 2, r.top + r.height / 2, size.width, size.height)
      goal.current = { x: p.x, y: p.y, s: Math.min(r.height / size.height, r.width / size.height) * p.visH * 0.32, o: 1 }
    } else if (mode === 'boot') {
      const visH = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))
      goal.current = { x: 0, y: visH * 0.2, s: 0.55, o: 1 }
    } else {
      const visH = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))
      const visW = visH * (size.width / size.height)
      goal.current = { x: visW * 0.36, y: -visH * 0.12, s: 0.75, o: 0.5 }
    }
    const g = stage.current
    if (!g) return
    const k = 1 - Math.exp(-dt * 6)
    // Launch: rush towards the camera for a moment when a game is opened.
    const lt = clock.elapsedTime - launch.current
    const rush = launch.current > 0 && lt < 0.6 ? Math.sin((lt / 0.6) * Math.PI) : 0
    g.position.x += (goal.current.x * (1 - rush) - g.position.x) * k
    g.position.y += (goal.current.y * (1 - rush) - g.position.y) * k
    g.position.z += (rush * 4 + (goal.current.o - 1) * 4 - g.position.z) * (rush > 0 ? 1 : k)
    const s = goal.current.s * (1 + rush * 0.8)
    g.scale.setScalar(g.scale.x + (s - g.scale.x) * k)
  })

  return (
    <group ref={stage} position={[2.6, 0, 0]}>
      {slots.map((s) => (
        <EmblemSlot key={s.key} slot={s} accent={accent} />
      ))}
    </group>
  )
}

function EmblemSlot({ slot, accent }: { slot: Slot; accent: [string, string] }) {
  const ref = useRef<THREE.Group>(null)
  const Emblem = EMBLEMS[slot.id] ?? EMBLEMS.boot
  const pointer = useThree((s) => s.pointer)
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime
    let s: number
    if (slot.leaving !== null) {
      const p = Math.min(1, (t - slot.leaving) / 0.45)
      s = 1 - p * p
      g.rotation.y += 0.25
    } else {
      const p = Math.min(1, (t - slot.born) / 0.7)
      // back-out easing for a little overshoot
      const c = 1.7
      s = 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
      g.rotation.y = t * 0.35 + (1 - p) * -2.5 + pointer.x * 0.35
      g.rotation.x = -pointer.y * 0.2
    }
    g.position.y = Math.sin(t * 1.3 + slot.key) * 0.12
    g.scale.setScalar(Math.max(0.0001, s))
    g.visible = s > 0.002
  })
  return (
    <group ref={ref} scale={0.0001}>
      <Emblem a={accent[0]} b={accent[1]} />
    </group>
  )
}

/* ---------- Camera rig: mouse parallax and mode moves ---------- */

function CameraRig({ mode }: { mode: SceneMode }) {
  const intro = useRef(0)
  useFrame(({ camera, pointer, clock }, dt) => {
    intro.current = Math.min(1, intro.current + dt / 1.8)
    const e = 1 - Math.pow(1 - intro.current, 3)
    const k = 1 - Math.exp(-dt * 2.5)
    const baseZ = mode === 'page' ? CAMERA_Z - 0.4 : CAMERA_Z
    const z = baseZ + (1 - e) * 10
    camera.position.x += (pointer.x * 0.6 - camera.position.x) * k
    camera.position.y += (pointer.y * 0.35 + (1 - e) * 2 - camera.position.y) * k
    camera.position.z += (z - camera.position.z) * k
    camera.lookAt(0, Math.sin(clock.elapsedTime * 0.2) * 0.05, 0)
  })
  return null
}

function Ready({ onReady }: { onReady?: () => void }) {
  const done = useRef(false)
  useFrame(() => {
    if (!done.current) {
      done.current = true
      onReady?.()
    }
  })
  return null
}

export default function Scene3D({ accent, emblem, mode, paused = false, onReady }: SceneProps) {
  const small = typeof window !== 'undefined' && window.innerWidth < 720
  return (
    <Canvas
      className="scene3d"
      dpr={[1, small ? 1.5 : 1.75]}
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance', alpha: false }}
      camera={{ position: [0, 2, CAMERA_Z + 10], fov: FOV, near: 0.1, far: 80 }}
      onCreated={({ gl }) => gl.setClearColor('#05060f')}
      aria-hidden="true"
    >
      <fog attach="fog" args={['#05060f', 12, 30]} />
      <Backdrop accent={accent} />
      <GridFloor color={accent[1]} mode={mode} />
      <Particles color={accent[1]} count={small ? 260 : 600} />

      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <pointLight position={[3, 1, 3]} intensity={18} distance={12} color={accent[1]} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 4, 6]} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.5} color={accent[1]} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} />
        <Lightformer form="ring" intensity={2} color={accent[0]} position={[6, 2, -4]} scale={4} />
      </Environment>

      <EmblemStage emblem={emblem} mode={mode} accent={accent} />
      <CameraRig mode={mode} />
      <Ready onReady={onReady} />

      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={small ? 0.7 : 1.1} luminanceThreshold={0.55} luminanceSmoothing={0.2} />
        <Vignette offset={0.25} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  )
}
