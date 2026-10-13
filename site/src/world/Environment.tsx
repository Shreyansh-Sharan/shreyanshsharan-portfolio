// Sky, sun, shadows, water and clouds. Nothing here downloads anything: textures are generated in code.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Cloud, Clouds, Environment as Env, Sky } from '@react-three/drei'
import * as THREE from 'three'
import { REGIONS, WATER_LEVEL, type Mood } from './regions'
import { skyFlash } from './particles'
import { daylight } from './clock'
import { heightAt } from './terrain'

/** Where the camera is looking; the sun's shadow box follows it. Written by the camera rig. */
export const lookTarget = new THREE.Vector3()

export const SUN_DIR = new THREE.Vector3(0.62, 0.3, -0.42).normalize()

const DEFAULT_MOOD: Mood = { sun: '#ffe2b8', sky: '#bcd7ff', fog: '#a9c6e0', haze: 1, light: 1 }
const moodCols = new Map<string, THREE.Color>()
const col = (hex: string) => {
  let c = moodCols.get(hex)
  if (!c) {
    c = new THREE.Color(hex)
    moodCols.set(hex, c)
  }
  return c
}
const blended = { sun: new THREE.Color(), sky: new THREE.Color(), fog: new THREE.Color(), haze: 1, light: 1 }

/** The lighting mood at a point: each district's mood fades in across its edge and blends with its neighbours'. */
export function moodAt(x: number, z: number) {
  const m = blended
  m.sun.copy(col(DEFAULT_MOOD.sun))
  m.sky.copy(col(DEFAULT_MOOD.sky))
  m.fog.copy(col(DEFAULT_MOOD.fog))
  m.haze = 1
  m.light = 1
  let total = 0
  for (const r of REGIONS) {
    if (!r.mood) continue
    const d = Math.hypot(x - r.center[0], z - r.center[1])
    const w = THREE.MathUtils.smoothstep(d, r.radius * 1.35, r.radius * 0.7)
    if (w <= 0) continue
    total += w
    const k = w / total
    m.sun.lerp(col(r.mood.sun), k)
    m.sky.lerp(col(r.mood.sky), k)
    m.fog.lerp(col(r.mood.fog), k)
    m.haze = THREE.MathUtils.lerp(m.haze, r.mood.haze, k)
    m.light = THREE.MathUtils.lerp(m.light, r.mood.light, k)
  }
  return m
}

const FOG_NEAR = 220, FOG_FAR = 1300

export function Lighting({ shadows, live = true }: { shadows: boolean; live?: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const sky = useRef<THREE.HemisphereLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  const frame = useRef(0)
  useFrame(({ gl, scene }) => {
    const s = sun.current
    if (!s) return
    // Night falls while exploring: the sun dims to moonlight, the sky light cools, fog and background darken.
    const day = daylight()
    // Each district has its own time-of-day feel (the city's violet dusk, the temple's golden hour) layered on
    // the island's day/night cycle, blended by where the camera is looking.
    const mood = moodAt(lookTarget.x, lookTarget.z)
    s.intensity = (0.14 + 2.36 * day) * mood.light
    s.color.setRGB(THREE.MathUtils.lerp(0.55, mood.sun.r, day), THREE.MathUtils.lerp(0.65, mood.sun.g, day), THREE.MathUtils.lerp(0.95, mood.sun.b, day))
    const bg = scene.background as THREE.Color | null
    if (bg && bg.isColor) bg.setRGB(mood.fog.r * 0.94 * day + 0.04, mood.fog.g * 0.96 * day + 0.05, mood.fog.b * day + 0.12)
    scene.environmentIntensity = 0.65 * (0.08 + 0.92 * day)
    const fog = scene.fog as THREE.Fog | null
    if (fog) {
      fog.color.setRGB(mood.fog.r * day + 0.04, mood.fog.g * day + 0.05, mood.fog.b * day + 0.12)
      fog.near = FOG_NEAR / mood.haze
      fog.far = FOG_FAR / mood.haze
    }
    // A lightning strike lights up the whole scene for an instant (no extra light, so no shader recompiles).
    if (sky.current) {
      sky.current.intensity = (0.55 + skyFlash.value * 1.3) * (0.22 + 0.78 * day)
      sky.current.color.copy(mood.sky)
    }
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
      <hemisphereLight ref={sky} args={['#bcd7ff', '#5d4b33', 0.55]} />
      <directionalLight
        ref={sun}
        target={target}
        color="#ffe2b8"
        intensity={2.5}
        castShadow={shadows}
        shadow-mapSize={[1536, 1536]}
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
  const sky = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>>(null)
  // The sky dome is daylight only; at night it hides and the dark background shows through (stars would be nice).
  useFrame(() => {
    if (sky.current) sky.current.visible = daylight() > 0.3
  })
  return (
    <>
      <Sky ref={sky} distance={3000} sunPosition={sunPos} turbidity={3.2} rayleigh={2.6} mieCoefficient={0.004} mieDirectionalG={0.82} />
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

/** How deep the water is across the island (0-12 m), sampled once from the terrain: tints the shallows and edges the shore. */
const DEPTH_SPAN = 1280
const DEPTH_MAX = 12
function depthTexture() {
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size - 0.5) * DEPTH_SPAN, z = ((j + 0.5) / size - 0.5) * DEPTH_SPAN
      const d = Math.min(1, Math.max(0, (WATER_LEVEL - heightAt(x, z)) / DEPTH_MAX))
      const k = (j * size + i) * 4
      data[k] = data[k + 1] = data[k + 2] = Math.round(d * 255)
      data[k + 3] = 255
    }
  const t = new THREE.DataTexture(data, size, size)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.needsUpdate = true
  return t
}

export function Water() {
  const normals = useMemo(waterNormals, [])
  const detail = useMemo(() => {
    const t = normals.clone()
    t.repeat.set(500, 500)
    t.needsUpdate = true
    return t
  }, [normals])
  const uniforms = useMemo(() => ({ uDepth: { value: depthTexture() }, uWaterTime: { value: 0 } }), [])
  // Turquoise over the sand, deep blue offshore, and a broken line of foam where the water meets the land.
  const onBeforeCompile = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;\nuniform sampler2D uDepth;\nuniform float uWaterTime;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float wDepth = texture2D(uDepth, vWaterXZ / ${DEPTH_SPAN.toFixed(1)} + 0.5).r * ${DEPTH_MAX.toFixed(1)};
          float wShallow = 1.0 - smoothstep(0.0, 6.0, wDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.62, vec3(0.30, 0.78, 0.74), wShallow * 0.8);
          diffuseColor.a *= mix(1.0, 0.62, wShallow);
          float wEdge = 1.0 - smoothstep(0.05, 0.75, wDepth);
          float wBreak = sin(vWaterXZ.x * 0.9 + uWaterTime * 1.4) * sin(vWaterXZ.y * 0.8 - uWaterTime * 1.1) * 0.5 + 0.5;
          float wFoam = wEdge * smoothstep(0.25, 0.75, wBreak * 0.6 + wEdge * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), wFoam * 0.85);
          diffuseColor.a = max(diffuseColor.a, wFoam * 0.9);`,
        )
    },
    [uniforms],
  )
  useFrame(({ clock }, dt) => {
    normals.offset.x += dt * 0.004
    normals.offset.y += dt * 0.0025
    detail.offset.x -= dt * 0.006
    uniforms.uWaterTime.value = clock.elapsedTime
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
        onBeforeCompile={onBeforeCompile}
      />
    </mesh>
  )
}

/* ---------- Ground fog ---------- */

const FOG_VERT = `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
const FOG_FRAG = `
uniform float uTime; uniform float uStrength; uniform vec3 uColor; varying vec2 vUv; varying vec3 vWorld;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 p = vWorld.xz * 0.02 + vec2(uTime * 0.012, uTime * 0.007);
  float n = vnoise(p) * 0.6 + vnoise(p * 2.3 + 7.0) * 0.4;
  float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(0.0, 0.25, 1.0 - vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(0.0, 0.25, 1.0 - vUv.y);
  gl_FragColor = vec4(uColor, n * n * edge * uStrength);
}`

/** Low mist that gathers over the harbour, the cove and the plains at night (and a little at dawn). */
export function GroundFog() {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uStrength: { value: 0 }, uColor: { value: new THREE.Color('#c7d4e6') } }), [])
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime
    const day = daylight()
    uniforms.uStrength.value = (1 - day) * 0.55 + 0.06
    if (group.current) group.current.visible = uniforms.uStrength.value > 0.08
  })
  const sheets: [number, number, number, number][] = [
    [0, 330, 2.2, 260],
    [-260, 330, 1.8, 220],
    [340, 90, 2.6, 180],
    [-90, -240, 3.4, 140],
  ]
  return (
    <group ref={group}>
      {sheets.map(([x, z, y, size], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
          <planeGeometry args={[size, size, 1, 1]} />
          <shaderMaterial vertexShader={FOG_VERT} fragmentShader={FOG_FRAG} uniforms={uniforms} transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
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
        const r = 260 + (i % 3) * 140
        return { seed: i + 1, pos: [Math.cos(a) * r, 90 + (i % 4) * 12, Math.sin(a) * r] as [number, number, number] }
      }),
    [count],
  )
  return (
    <Clouds texture={tex} limit={400} material={THREE.MeshLambertMaterial}>
      {clouds.map((c) => (
        <Cloud key={c.seed} seed={c.seed} position={c.pos} bounds={[60, 8, 30]} segments={16} volume={40} growth={8} speed={0.08} opacity={0.85} color="#ffffff" />
      ))}
    </Clouds>
  )
}
