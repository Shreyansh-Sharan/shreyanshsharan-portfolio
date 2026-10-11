// 3D emblems for each tile, built from primitives so nothing has to be downloaded.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Edges, RoundedBox, Sparkles } from '@react-three/drei'
import * as THREE from 'three'

export interface EmblemProps {
  a: string
  b: string
}

const v2 = (pts: [number, number][]) => pts.map(([x, y]) => new THREE.Vector2(x, y))

function Glass({ color }: { color: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      transparent
      opacity={0.32}
      roughness={0.05}
      metalness={0.1}
      clearcoat={1}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  )
}

/** Omni Studio: five glowing studio layers that breathe apart. */
export function Layers({ a, b }: EmblemProps) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  useFrame(({ clock }) => {
    const spread = 1 + 0.35 * Math.sin(clock.elapsedTime * 1.2)
    refs.current.forEach((m, i) => {
      if (m) m.position.y = (i - 2) * 0.34 * spread
    })
  })
  return (
    <group rotation={[0.45, 0, 0]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <RoundedBox
          key={i}
          ref={(m: THREE.Mesh | null) => {
            refs.current[i] = m
          }}
          args={[2.1, 0.14, 2.1]}
          radius={0.06}
        >
          <meshStandardMaterial color={a} emissive={b} emissiveIntensity={0.15 + i * 0.22} metalness={0.6} roughness={0.25} />
          <Edges color={b} />
        </RoundedBox>
      ))}
    </group>
  )
}

/** Diageo: a whisky bottle wrapped in spinning CI/CD rings. */
export function Bottle({ b }: EmblemProps) {
  const rings = useRef<THREE.Group>(null)
  const bottle = useMemo(
    () => v2([[0, -1.25], [0.55, -1.25], [0.6, -1.15], [0.6, 0.25], [0.42, 0.6], [0.2, 0.8], [0.18, 1.25], [0.22, 1.3], [0, 1.3]]),
    [],
  )
  useFrame((_, dt) => {
    if (!rings.current) return
    rings.current.children[0].rotation.z += dt * 0.9
    rings.current.children[1].rotation.x += dt * 0.7
  })
  return (
    <group>
      <mesh>
        <latheGeometry args={[bottle, 48]} />
        <Glass color="#ffe8b8" />
      </mesh>
      <mesh position={[0, -0.55, 0]}>
        <cylinderGeometry args={[0.52, 0.52, 1.25, 40]} />
        <meshStandardMaterial color="#b45309" emissive="#f59e0b" emissiveIntensity={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.38, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.2, 24]} />
        <meshStandardMaterial color="#5b3a1e" roughness={0.8} />
      </mesh>
      <group ref={rings}>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[1.25, 0.03, 12, 96]} />
          <meshStandardMaterial color={b} emissive={b} emissiveIntensity={2} />
        </mesh>
        <mesh rotation={[0, Math.PI / 3, Math.PI / 2.2]}>
          <torusGeometry args={[1.4, 0.025, 12, 96]} />
          <meshStandardMaterial color={b} emissive={b} emissiveIntensity={1.4} />
        </mesh>
      </group>
    </group>
  )
}

/** Architect Mode: a wireframe blueprint tower. */
export function Tower({ a, b }: EmblemProps) {
  const tiers: [number, number, number][] = [
    [1.7, 0.7, -1.0],
    [1.25, 0.9, -0.2],
    [0.85, 1.1, 0.8],
  ]
  return (
    <group position={[0, -0.2, 0]}>
      {tiers.map(([w, h, y]) => (
        <mesh key={y} position={[0, y, 0]}>
          <boxGeometry args={[w, h, w]} />
          <meshStandardMaterial color={a} transparent opacity={0.28} emissive={a} emissiveIntensity={0.3} />
          <Edges color={b} />
        </mesh>
      ))}
      <mesh position={[0, 1.75, 0]}>
        <coneGeometry args={[0.3, 0.8, 4]} />
        <meshStandardMaterial color={b} emissive={b} emissiveIntensity={1.5} wireframe />
      </mesh>
      <mesh position={[0, -1.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.3, 1.36, 64]} />
        <meshBasicMaterial color={b} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** Lakehouse Logistics: Bronze, Silver and Gold crates (the medallion layers). */
export function Crates() {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const crates = useMemo(() => {
    const out: { p: [number, number, number]; c: string }[] = []
    ;[-0.62, 0, 0.62].forEach((x) => out.push({ p: [x, -0.8, 0], c: '#b0703c' }))
    ;[-0.31, 0.31].forEach((x) => out.push({ p: [x, -0.18, 0], c: '#c8ced8' }))
    out.push({ p: [0, 0.46, 0], c: '#f5c542' })
    return out
  }, [])
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (m) m.position.y = crates[i].p[1] + Math.sin(clock.elapsedTime * 2 + i) * 0.05 + (i === 5 ? 0.1 : 0)
    })
  })
  return (
    <group rotation={[0.2, 0.5, 0]}>
      {crates.map((c, i) => (
        <RoundedBox
          key={i}
          ref={(m: THREE.Mesh | null) => {
            refs.current[i] = m
          }}
          args={[0.56, 0.56, 0.56]}
          radius={0.05}
          position={c.p}
        >
          <meshStandardMaterial color={c.c} metalness={0.8} roughness={0.3} emissive={c.c} emissiveIntensity={i === 5 ? 0.6 : 0.12} />
        </RoundedBox>
      ))}
      <mesh position={[0, -1.15, 0]}>
        <boxGeometry args={[2.3, 0.08, 1]} />
        <meshStandardMaterial color="#1f2937" metalness={0.4} roughness={0.6} />
      </mesh>
    </group>
  )
}

/** Qlik Legends: a growing 3D bar chart. */
const BAR_HEIGHTS = [0.8, 1.4, 1.0, 1.9, 2.5]

export function Bars({ a, b }: EmblemProps) {
  const heights = BAR_HEIGHTS
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const colors = useMemo(() => BAR_HEIGHTS.map((_, i) => new THREE.Color(a).lerp(new THREE.Color(b), i / 4)), [a, b])
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return
      const h = heights[i] * (0.75 + 0.25 * Math.sin(clock.elapsedTime * 1.4 + i * 0.7))
      m.scale.y = h
      m.position.y = -1.2 + h / 2
    })
  })
  return (
    <group rotation={[0.25, -0.5, 0]}>
      {heights.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m
          }}
          position={[(i - 2) * 0.48, 0, 0]}
        >
          <boxGeometry args={[0.36, 1, 0.36]} />
          <meshStandardMaterial color={colors[i]} emissive={colors[i]} emissiveIntensity={0.55} metalness={0.3} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0, -1.25, 0]}>
        <boxGeometry args={[2.6, 0.06, 0.8]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
    </group>
  )
}

/** Wipro: a lab flask with rising bubbles. */
export function Flask({ b }: EmblemProps) {
  const profile = useMemo(() => v2([[0, -1.1], [0.95, -1.1], [1.0, -1.0], [0.32, 0.45], [0.32, 1.1], [0.4, 1.16], [0, 1.16]]), [])
  const bubbles = useRef<(THREE.Mesh | null)[]>([])
  useFrame(({ clock }) => {
    bubbles.current.forEach((m, i) => {
      if (!m) return
      const t = (clock.elapsedTime * 0.45 + i / 6) % 1
      m.position.set(Math.sin(i * 2.3) * 0.25 * (1 - t), -0.9 + t * 1.9, Math.cos(i * 1.7) * 0.2 * (1 - t))
      m.scale.setScalar(0.5 + t * 0.6)
    })
  })
  return (
    <group>
      <mesh>
        <latheGeometry args={[profile, 48]} />
        <Glass color="#dbeafe" />
      </mesh>
      <mesh position={[0, -0.72, 0]}>
        <coneGeometry args={[0.82, 0.76, 48, 1, true]} />
        <meshStandardMaterial color={b} emissive={b} emissiveIntensity={0.9} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            bubbles.current[i] = m
          }}
        >
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshStandardMaterial color="#ffffff" emissive={b} emissiveIntensity={1.5} />
        </mesh>
      ))}
    </group>
  )
}

/** NIT Jalandhar: a graduation cap. */
export function Cap({ a }: EmblemProps) {
  const tassel = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (tassel.current) tassel.current.rotation.z = Math.sin(clock.elapsedTime * 2) * 0.25
  })
  return (
    <group rotation={[0.35, 0.6, 0]}>
      <mesh position={[0, 0.25, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[2.1, 0.08, 2.1]} />
        <meshStandardMaterial color="#111827" metalness={0.3} roughness={0.5} />
        <Edges color={a} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.72, 0.8, 0.7, 40]} />
        <meshStandardMaterial color="#1f2937" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#f5c542" metalness={1} roughness={0.2} />
      </mesh>
      <group ref={tassel} position={[0, 0.32, 0]}>
        <mesh position={[0.55, -0.02, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 1.1, 8]} />
          <meshStandardMaterial color="#f5c542" emissive="#f5c542" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[1.1, -0.4, 0]}>
          <cylinderGeometry args={[0.06, 0.1, 0.5, 12]} />
          <meshStandardMaterial color="#f5c542" emissive="#f5c542" emissiveIntensity={0.8} />
        </mesh>
      </group>
    </group>
  )
}

/** Trophies: a gold cup with sparkles. */
export function Cup() {
  const profile = useMemo(
    () => v2([[0, -1.3], [0.72, -1.3], [0.72, -1.15], [0.24, -1.05], [0.12, -0.6], [0.12, -0.3], [0.32, -0.18], [0.72, 0.35], [0.86, 1.05], [0.8, 1.08], [0.66, 0.4], [0, 0.1]]),
    [],
  )
  const gold = <meshStandardMaterial color="#f5c542" metalness={1} roughness={0.22} emissive="#a16207" emissiveIntensity={0.25} side={THREE.DoubleSide} />
  return (
    <group>
      <mesh>
        <latheGeometry args={[profile, 64]} />
        {gold}
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.88, 0.45, 0]} rotation={[0, 0, s * -Math.PI / 2]}>
          <torusGeometry args={[0.3, 0.06, 12, 32, Math.PI]} />
          {gold}
        </mesh>
      ))}
      <Sparkles count={40} scale={[3, 3, 3]} size={4} speed={0.6} color="#fde68a" />
    </group>
  )
}

/** Skill Tree: a pulsing node graph. */
export function Graph({ a, b }: EmblemProps) {
  const nodes = useMemo<[number, number, number][]>(
    () => [
      [0, -1.2, 0],
      [-0.9, -0.3, 0.3],
      [0.9, -0.3, -0.3],
      [0, -0.2, 0.8],
      [-1.2, 0.7, -0.2],
      [-0.4, 0.8, 0.5],
      [0.5, 0.9, 0.4],
      [1.2, 0.6, -0.5],
      [0, 1.5, 0],
    ],
    [],
  )
  const links = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [3, 5], [3, 6], [2, 7], [2, 6], [5, 8], [6, 8]]
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(links.flatMap(([i, j]) => [...nodes[i], ...nodes[j]]), 3))
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes])
  const refs = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (m) m.emissiveIntensity = 0.4 + 1.6 * Math.max(0, Math.sin(clock.elapsedTime * 2 - nodes[i][1] * 1.5))
    })
  })
  return (
    <group>
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color={b} transparent opacity={0.6} />
      </lineSegments>
      {nodes.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[i === 0 || i === 8 ? 0.18 : 0.13, 20, 20]} />
          <meshStandardMaterial
            ref={(m) => {
              refs.current[i] = m
            }}
            color={a}
            emissive={b}
          />
        </mesh>
      ))}
    </group>
  )
}

/** Player Profile: an avatar bust with a halo. */
export function Avatar({ b }: EmblemProps) {
  return (
    <group position={[0, -0.1, 0]}>
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.5, 40, 40]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.75, 0]}>
        <capsuleGeometry args={[0.62, 0.5, 8, 32]} />
        <meshStandardMaterial color="#334155" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.035, 12, 64]} />
        <meshStandardMaterial color={b} emissive={b} emissiveIntensity={2} />
      </mesh>
    </group>
  )
}

/** Resume: a fanned stack of pages and a download arrow. */
export function Pages({ b }: EmblemProps) {
  const arrow = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (arrow.current) arrow.current.position.y = -0.2 + Math.sin(clock.elapsedTime * 3) * 0.15
  })
  return (
    <group rotation={[0.1, -0.4, 0]}>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[i * 0.12 - 0.12, i * 0.05, -i * 0.15]} rotation={[0, 0, (i - 1) * 0.1]}>
          <mesh>
            <boxGeometry args={[1.5, 2, 0.03]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.6} />
          </mesh>
          {i === 0 &&
            [0.6, 0.35, 0.1, -0.15, -0.4].map((y) => (
              <mesh key={y} position={[-0.1, y, 0.02]}>
                <boxGeometry args={[y === 0.6 ? 0.8 : 1.05, 0.07, 0.01]} />
                <meshBasicMaterial color="#64748b" />
              </mesh>
            ))}
        </group>
      ))}
      <group ref={arrow} position={[0.95, -0.2, 0.4]}>
        <mesh>
          <cylinderGeometry args={[0.08, 0.08, 0.5, 16]} />
          <meshStandardMaterial color={b} emissive={b} emissiveIntensity={1.4} />
        </mesh>
        <mesh position={[0, -0.38, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.2, 0.3, 16]} />
          <meshStandardMaterial color={b} emissive={b} emissiveIntensity={1.4} />
        </mesh>
      </group>
    </group>
  )
}

function checkerTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f8fafc'
    g.fillRect(x * 8, y * 8, 8, 8)
  }
  const t = new THREE.CanvasTexture(c)
  t.magFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Sports Complex: a waving chequered flag and a racing tyre. */
export function Flag({ b }: EmblemProps) {
  const cloth = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => new THREE.PlaneGeometry(1.8, 1.2, 24, 12), [])
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo])
  const tex = useMemo(() => checkerTexture(), [])
  useFrame(({ clock }) => {
    const g = cloth.current?.geometry
    if (!g) return
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3]
      const k = (x + 0.9) / 1.8
      pos.setZ(i, Math.sin(x * 3 - clock.elapsedTime * 4) * 0.18 * k)
      pos.setY(i, base[i * 3 + 1] + Math.sin(x * 2 - clock.elapsedTime * 3) * 0.05 * k)
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
  })
  return (
    <group position={[-0.2, 0, 0]}>
      <mesh position={[-1.0, -0.2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 2.8, 12]} />
        <meshStandardMaterial color="#cbd5e1" metalness={1} roughness={0.2} />
      </mesh>
      <mesh ref={cloth} geometry={geo} position={[-0.08, 0.55, 0]}>
        <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.7} />
      </mesh>
      <mesh position={[0.9, -1.0, 0.3]} rotation={[0, 0.6, 0]}>
        <torusGeometry args={[0.42, 0.2, 20, 48]} />
        <meshStandardMaterial color="#111" roughness={0.9} />
      </mesh>
      <mesh position={[0.9, -1.0, 0.3]} rotation={[0, 0.6, 0]}>
        <torusGeometry args={[0.42, 0.205, 4, 48]} />
        <meshStandardMaterial color={b} emissive={b} emissiveIntensity={1.2} wireframe />
      </mesh>
    </group>
  )
}

/** Arena: a spinning crosshair with orbiting rounds. */
export function Crosshair({ b }: EmblemProps) {
  const spin = useRef<THREE.Group>(null)
  const orbit = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.z -= dt * 0.6
    if (orbit.current) orbit.current.rotation.y += dt * 1.6
  })
  return (
    <group>
      <group ref={spin}>
        <mesh>
          <torusGeometry args={[1.2, 0.05, 12, 96]} />
          <meshStandardMaterial color={b} emissive={b} emissiveIntensity={2} />
        </mesh>
        <mesh>
          <torusGeometry args={[0.7, 0.03, 12, 64]} />
          <meshStandardMaterial color="#fff" emissive={b} emissiveIntensity={1} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 2]} position={[Math.cos((i * Math.PI) / 2) * 1.2, Math.sin((i * Math.PI) / 2) * 1.2, 0]}>
            <boxGeometry args={[0.5, 0.08, 0.08]} />
            <meshStandardMaterial color="#fff" emissive={b} emissiveIntensity={1.5} />
          </mesh>
        ))}
      </group>
      <mesh>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={3} />
      </mesh>
      <group ref={orbit} rotation={[0.6, 0, 0.3]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos((i * 2 * Math.PI) / 3) * 1.6, 0, Math.sin((i * 2 * Math.PI) / 3) * 1.6]}>
            <capsuleGeometry args={[0.06, 0.22, 4, 12]} />
            <meshStandardMaterial color="#fbbf24" metalness={1} roughness={0.3} emissive="#f59e0b" emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

/** Boot screen: an interlocking knot. */
export function Knot({ a, b }: EmblemProps) {
  return (
    <group>
      <mesh>
        <torusKnotGeometry args={[0.9, 0.28, 200, 24, 2, 3]} />
        <meshStandardMaterial color={a} emissive={b} emissiveIntensity={0.45} metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}
