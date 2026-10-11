// Sky, sun, shadows, water and clouds. Nothing here downloads anything: textures are generated in code.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Cloud, Clouds, Environment as Env, Sky } from '@react-three/drei'
import * as THREE from 'three'
import { WATER_LEVEL } from './regions'

/** Where the camera is looking; the sun's shadow box follows it. Written by the camera rig. */
export const lookTarget = new THREE.Vector3()

export const SUN_DIR = new THREE.Vector3(0.62, 0.3, -0.42).normalize()

export function Lighting({ shadows, live = true }: { shadows: boolean; live?: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const frame = useRef(0)
  useFrame(({ gl }) => {
    const s = sun.current
    if (!s) return
    // The 2048 px soft shadow map is the costliest pass: redraw it every frame only while exploring;
    // during the fly-over a few refreshes a second look the same.
    gl.shadowMap.autoUpdate = live
    if (!live && frame.current++ % 15 === 0) gl.shadowMap.needsUpdate = true
    // Snap to a coarse grid so shadows don't shimmer as the box follows the camera.
    const snap = 2
    const tx = Math.round(lookTarget.x / snap) * snap, tz = Math.round(lookTarget.z / snap) * snap
    target.position.set(tx, lookTarget.y, tz)
    s.position.set(tx + SUN_DIR.x * 160, lookTarget.y + SUN_DIR.y * 160, tz + SUN_DIR.z * 160)
    target.updateMatrixWorld()
  })
  return (
    <>
      <hemisphereLight args={['#bcd7ff', '#5d4b33', 0.55]} />
      <directionalLight
        ref={sun}
        target={target}
        color="#ffe2b8"
        intensity={2.5}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={10}
        shadow-camera-far={400}
      />
      <primitive object={target} />
    </>
  )
}

export function SkyDome() {
  const sunPos = useMemo(() => SUN_DIR.clone().multiplyScalar(1000), [])
  return (
    <>
      <Sky distance={3000} sunPosition={sunPos} turbidity={3.2} rayleigh={2.6} mieCoefficient={0.004} mieDirectionalG={0.82} />
      {/* The same sky, baked once into an environment map for reflections on water and models. */}
      <Env frames={1} resolution={256} environmentIntensity={0.65}>
        <Sky distance={3000} sunPosition={sunPos} turbidity={3.2} rayleigh={2.6} mieCoefficient={0.004} mieDirectionalG={0.82} />
      </Env>
    </>
  )
}

/** Tileable normal map from a sum of integer-frequency waves. */
function waterNormals() {
  const size = 256
  const h = new Float32Array(size * size)
  const waves = [
    [3, 1, 0.5], [1, 4, 0.4], [5, 3, 0.25], [7, -2, 0.18], [-4, 6, 0.15], [11, 5, 0.08], [6, -9, 0.07], [13, -7, 0.05],
  ]
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0
      for (const [kx, ky, a] of waves) v += a * Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + kx * 1.7)
      h[y * size + x] = v
    }
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)]
      const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x]
      const n = new THREE.Vector3(-dx * 2.5, -dy * 2.5, 1).normalize()
      const i = (y * size + x) * 4
      data[i] = (n.x * 0.5 + 0.5) * 255
      data[i + 1] = (n.y * 0.5 + 0.5) * 255
      data[i + 2] = (n.z * 0.5 + 0.5) * 255
      data[i + 3] = 255
    }
  const tex = new THREE.DataTexture(data, size, size)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(200, 200)
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

export function Water() {
  const normals = useMemo(waterNormals, [])
  const detail = useMemo(() => {
    const t = normals.clone()
    t.repeat.set(500, 500)
    t.needsUpdate = true
    return t
  }, [normals])
  useFrame((_, dt) => {
    normals.offset.x += dt * 0.004
    normals.offset.y += dt * 0.0025
    detail.offset.x -= dt * 0.006
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow>
      <planeGeometry args={[7000, 7000, 1, 1]} />
      <meshPhysicalMaterial
        color="#1f7f9e"
        roughness={0.06}
        metalness={0}
        clearcoat={1}
        clearcoatRoughness={0.08}
        clearcoatNormalMap={detail}
        clearcoatNormalScale={new THREE.Vector2(0.35, 0.35)}
        normalMap={normals}
        normalScale={new THREE.Vector2(0.55, 0.55)}
        envMapIntensity={1.25}
        transparent
        opacity={0.86}
      />
    </mesh>
  )
}

/** Soft cloud puff drawn on a canvas, so drei's Cloud doesn't fetch its default texture from a CDN. */
function cloudTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  for (let i = 0; i < 14; i++) {
    const x = 64 + Math.cos(i * 2.4) * 22 * Math.random(), y = 64 + Math.sin(i * 1.7) * 18 * Math.random()
    const r = 26 + Math.random() * 26
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(255,255,255,0.55)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, 128, 128)
  }
  return c.toDataURL()
}

export function SkyClouds({ count = 9 }: { count?: number }) {
  const tex = useMemo(cloudTexture, [])
  const clouds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + i
        const r = 120 + (i % 3) * 90
        return { seed: i + 1, pos: [Math.cos(a) * r, 70 + (i % 4) * 9, Math.sin(a) * r] as [number, number, number] }
      }),
    [count],
  )
  return (
    <Clouds texture={tex} limit={400} material={THREE.MeshLambertMaterial}>
      {clouds.map((c) => (
        <Cloud key={c.seed} seed={c.seed} position={c.pos} bounds={[34, 6, 18]} segments={24} volume={26} growth={6} speed={0.08} opacity={0.85} color="#ffffff" />
      ))}
    </Clouds>
  )
}
