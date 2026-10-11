// Things that move: mission beacons, the neon skyline, vehicles, sheep, birds, smoke and glows.
import { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { REGIONS } from './regions'
import { heightAt, mulberry32 } from './terrain'
import { MISSIONS } from './missions'
import { useModel } from './Models'
import { useWorld } from './store'

const region = (id: string) => REGIONS.find((r) => r.id === id)!

/* ---------- Mission beacons ---------- */

const BEAM_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const BEAM_FRAG = `
uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
void main(){
  float fade = pow(1.0 - vUv.y, 1.6);
  float bands = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 3.0);
  gl_FragColor = vec4(uColor * 1.6, fade * bands * 0.55);
}`

function Beacon({ x, y, z, color, done }: { x: number; y: number; z: number; color: string; done: boolean }) {
  const gem = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const c = done ? '#4ade80' : color
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(c) }, uTime: { value: 0 } }), [c])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    uniforms.uTime.value = t
    if (gem.current) {
      gem.current.rotation.y = t * 1.4
      gem.current.position.y = 3.2 + Math.sin(t * 2) * 0.3
    }
    if (ring.current) {
      const s = 1 + ((t * 0.8) % 1) * 2.2
      ring.current.scale.set(s, s, s)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - ((t * 0.8) % 1))
    }
  })
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 20, 0]}>
        <cylinderGeometry args={[0.9, 0.9, 40, 24, 1, true]} />
        <shaderMaterial
          vertexShader={BEAM_VERT}
          fragmentShader={BEAM_FRAG}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={gem} position={[0, 3.2, 0]} castShadow>
        <octahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={2.2} metalness={0.3} roughness={0.2} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[1.1, 1.35, 48]} />
        <meshBasicMaterial color={c} transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  )
}

export function Beacons() {
  const done = useWorld((s) => s.done)
  return (
    <>
      {MISSIONS.map((m) => (
        <Beacon key={m.tile.id} x={m.x} y={m.y} z={m.z} color={m.accent} done={done.includes(m.tile.id)} />
      ))}
    </>
  )
}

/* ---------- Neon District ---------- */

function windowTexture() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#0b1020'
  g.fillRect(0, 0, 64, 128)
  const colors = ['#67e8f9', '#c084fc', '#f0abfc', '#fde68a', '#38bdf8']
  for (let y = 4; y < 128; y += 8)
    for (let x = 4; x < 64; x += 8)
      if (Math.random() < 0.55) {
        g.fillStyle = colors[Math.floor(Math.random() * colors.length)]
        g.globalAlpha = 0.5 + Math.random() * 0.5
        g.fillRect(x, y, 4, 4)
      }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.magFilter = THREE.NearestFilter
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

const GRID_FRAG = `
uniform float uTime; varying vec3 vWorld;
void main(){
  vec2 p = vWorld.xz / 6.0;
  vec2 g = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-4));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float pulse = 0.6 + 0.4 * sin(uTime * 2.0 - length(vWorld.xz) * 0.08);
  vec3 col = mix(vec3(0.13, 0.83, 0.93), vec3(0.75, 0.52, 0.99), 0.5 + 0.5 * sin(vWorld.x * 0.05));
  gl_FragColor = vec4(col * 2.0 * pulse, line * 0.9);
}`
const GRID_VERT = `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`

export function NeonDistrict() {
  const r = region('neon')
  const tex = useMemo(windowTexture, [])
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
  const rings = useRef<THREE.Group>(null)
  const blocks = useMemo(() => {
    const rnd = mulberry32(77)
    const out: { x: number; z: number; w: number; d: number; h: number }[] = []
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, d = 14 + rnd() * 30
      const x = r.center[0] + Math.cos(a) * d, z = r.center[1] + Math.sin(a) * d
      const near = (bx: number, bz: number) => Math.hypot(x - bx, z - bz)
      if (near(r.center[0] - 14, r.center[1] + 10) < 7 || near(r.center[0] - 6, r.center[1] + 16) < 6) continue
      out.push({ x, z, w: 4 + rnd() * 5, d: 4 + rnd() * 5, h: 8 + rnd() * 26 })
    }
    return out
  }, [r])
  const materials = useMemo(
    () =>
      blocks.map((b) => {
        const t = tex.clone()
        t.repeat.set(Math.max(1, Math.round(b.w / 3)), Math.max(1, Math.round(b.h / 6)))
        t.needsUpdate = true
        return new THREE.MeshStandardMaterial({ color: '#1b2133', map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.5 })
      }),
    [blocks, tex],
  )
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime
    if (rings.current) rings.current.rotation.y = clock.elapsedTime * 0.3
  })
  const base = heightAt(r.center[0], r.center[1])
  return (
    <group>
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, base + b.h / 2, b.z]} material={materials[i]} castShadow receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[r.center[0], base + 0.06, r.center[1]]}>
        <circleGeometry args={[r.radius, 64]} />
        <shaderMaterial vertexShader={GRID_VERT} fragmentShader={GRID_FRAG} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <group ref={rings} position={[r.center[0], base, r.center[1]]}>
        {[12, 20, 28].map((y, i) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2 + (i - 1) * 0.15, 0, 0]}>
            <torusGeometry args={[7 - i, 0.12, 8, 64]} />
            <meshBasicMaterial color={i % 2 ? '#c084fc' : '#22d3ee'} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <pointLight position={[r.center[0], base + 20, r.center[1]]} color="#a78bfa" intensity={600} distance={70} />
    </group>
  )
}

/* ---------- Vehicles and animals ---------- */

function RaceCar() {
  const r = region('speedway')
  const car = useModel('f1-car', 1.1)
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const a = clock.elapsedTime * 0.9
    const x = r.center[0] + Math.cos(a) * 34, z = r.center[1] + Math.sin(a) * 19
    g.position.set(x, heightAt(x, z) + 0.02, z)
    const dx = -Math.sin(a) * 34, dz = Math.cos(a) * 19
    g.rotation.y = Math.atan2(dx, dz) - Math.PI / 2
  })
  return (
    <group ref={ref} scale={4}>
      <primitive object={car} />
    </group>
  )
}

function Tractor() {
  const r = region('plains')
  const tractor = useModel('tractor', 3.2)
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime * 0.12
    const x = r.center[0] + 22 + Math.sin(t) * 14, z = r.center[1] + 14 + Math.sin(t * 2) * 6
    const nx = r.center[0] + 22 + Math.sin(t + 0.01) * 14, nz = r.center[1] + 14 + Math.sin((t + 0.01) * 2) * 6
    g.position.set(x, heightAt(x, z), z)
    g.rotation.y = Math.atan2(nx - x, nz - z) - Math.PI / 2
  })
  return (
    <group ref={ref}>
      <primitive object={tractor} />
    </group>
  )
}

function Sheep({ seed }: { seed: number }) {
  const r = region('highland')
  const sheep = useModel('sheep', 1.1)
  const ref = useRef<THREE.Group>(null)
  const path = useMemo(() => {
    const rnd = mulberry32(seed)
    // Pasture on the far side of the distillery, away from the mission beacon.
    return { cx: r.center[0] - 26 + rnd() * 14, cz: r.center[1] - 22 + rnd() * 12, rad: 2 + rnd() * 4, speed: 0.05 + rnd() * 0.08, phase: rnd() * 6 }
  }, [seed, r])
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime * path.speed + path.phase
    const x = path.cx + Math.cos(t) * path.rad, z = path.cz + Math.sin(t) * path.rad
    g.position.set(x, heightAt(x, z) + Math.abs(Math.sin(clock.elapsedTime * 6 + seed)) * 0.06, z)
    g.rotation.y = -t - Math.PI
  })
  return (
    <group ref={ref}>
      <primitive object={sheep} />
    </group>
  )
}

/* ---------- Birds ---------- */

function Birds({ center, count = 9, height = 38, radius = 30 }: { center: [number, number]; count?: number; height?: number; radius?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.4, -1, 0, -0.2, 0, 0, -0.1, 0, 0, 0.4, 0, 0, -0.1, 1, 0, -0.2], 3))
    g.computeVertexNormals()
    return g
  }, [])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => [Math.sin(i * 2.3) * 4, Math.cos(i * 1.7) * 2, i * 0.4]), [count])
  useFrame(({ clock }) => {
    const im = ref.current
    if (!im) return
    const t = clock.elapsedTime
    offsets.forEach(([ox, oy, phase], i) => {
      const a = t * 0.18 + phase * 0.12
      const x = center[0] + Math.cos(a) * radius + ox, z = center[1] + Math.sin(a) * radius + ox * 0.5
      const flap = Math.sin(t * 9 + phase * 5) * 0.6
      m.compose(
        new THREE.Vector3(x, height + oy + Math.sin(t + phase) * 1.5, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, flap * 0.2)),
        new THREE.Vector3(1.1, 1 + flap, 1.1),
      )
      im.setMatrixAt(i, m)
    })
    im.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[geo, undefined, count]} frustumCulled={false}>
      <meshStandardMaterial color="#2b2b2b" side={THREE.DoubleSide} />
    </instancedMesh>
  )
}

/* ---------- Smoke ---------- */

function Smoke({ x, z, y }: { x: number; z: number; y: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = 10
  const m = useMemo(() => new THREE.Matrix4(), [])
  useFrame(({ clock }) => {
    const im = ref.current
    if (!im) return
    for (let i = 0; i < count; i++) {
      const t = (clock.elapsedTime * 0.25 + i / count) % 1
      const s = 0.6 + t * 3
      m.compose(new THREE.Vector3(x + t * 3, y + t * 10, z + Math.sin(i) * t), new THREE.Quaternion(), new THREE.Vector3(s, s, s))
      im.setMatrixAt(i, m)
    }
    im.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#e5e7eb" transparent opacity={0.35} depthWrite={false} roughness={1} />
    </instancedMesh>
  )
}

/* ---------- Region glows ---------- */

function Glows() {
  const lights = useRef<THREE.PointLight[]>([])
  const canyon = region('canyon')
  useFrame(({ clock }) => {
    lights.current.forEach((l, i) => l && (l.intensity = 140 + Math.sin(clock.elapsedTime * 1.6 + i) * 70))
  })
  return (
    <>
      {canyon.landmarks.map((l, i) => {
        const x = canyon.center[0] + l.at[0], z = canyon.center[1] + l.at[1]
        return (
          <pointLight
            key={i}
            ref={(el) => {
              if (el) lights.current[i] = el
            }}
            position={[x, heightAt(x, z) + l.height * 0.6, z]}
            color="#2dd4bf"
            distance={26}
          />
        )
      })}
      {REGIONS.filter((r) => r.sparkle).map((r) => (
        <Sparkles
          key={r.id}
          position={[r.center[0], heightAt(r.center[0], r.center[1]) + 6, r.center[1]]}
          scale={[r.radius * 1.4, 12, r.radius * 1.4]}
          count={60}
          size={6}
          speed={0.4}
          color={r.sparkle}
          opacity={0.8}
        />
      ))}
    </>
  )
}

export function Ambient() {
  const highland = region('highland')
  const dist = highland.landmarks[0]
  const dx = highland.center[0] + dist.at[0], dz = highland.center[1] + dist.at[1]
  return (
    <>
      <Beacons />
      <NeonDistrict />
      <Glows />
      <Smoke x={dx + 2} z={dz - 2} y={heightAt(dx, dz) + dist.height + 1} />
      <Birds center={highland.center} />
      <Birds center={[0, 0]} count={7} height={34} radius={40} />
      <Birds center={region('lab').center} count={6} height={26} radius={22} />
      <Suspense fallback={null}>
        <RaceCar />
      </Suspense>
      <Suspense fallback={null}>
        <Tractor />
      </Suspense>
      {[1, 2, 3, 4, 5, 6].map((s) => (
        <Suspense key={s} fallback={null}>
          <Sheep seed={s * 31} />
        </Suspense>
      ))}
    </>
  )
}
