// The player's own effects: speed lines streaming past the camera in flight, a swoosh arc for each melee
// swing (a full ring for the 360 spin), and the shockwave of a ground stomp. Each is one persistent mesh.
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { player } from './Characters'

/* ---------- Speed lines ---------- */

const LINES = 70

let lineRes: { geo: THREE.BufferGeometry; mat: THREE.LineBasicMaterial; seeds: number[][] } | null = null
function lines() {
  if (lineRes) return lineRes
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINES * 6), 3).setUsage(THREE.DynamicDrawUsage))
  // Each line: an angle and radius around the view axis, and a depth phase.
  const seeds = Array.from({ length: LINES }, () => [Math.random() * Math.PI * 2, 1.6 + Math.random() * 4.5, Math.random()])
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  lineRes = { geo, mat, seeds }
  return lineRes
}

function SpeedLines() {
  const { camera } = useThree()
  const ref = useRef<THREE.LineSegments>(null)
  const { geo, mat } = lines()
  const phase = useRef(0)

  useFrame((_, dt) => {
    const l = ref.current
    if (!l) return
    const { geo, seeds } = lines()
    const k = player.fly
    l.visible = k > 0.25
    if (!l.visible) return
    // Lines live in the camera's frame and rush towards it.
    l.position.copy(camera.position)
    l.quaternion.copy(camera.quaternion)
    phase.current += Math.min(dt, 0.05) * (0.8 + k * 2.2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const len = 1.5 + k * 5
    for (let i = 0; i < LINES; i++) {
      const [a, r, p] = seeds[i]
      const z = -((p + phase.current) % 1) * 30 - 1.5
      const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.7
      const o = i * 6
      arr[o] = arr[o + 3] = x
      arr[o + 1] = arr[o + 4] = y
      arr[o + 2] = z
      arr[o + 5] = z - len
    }
    pos.needsUpdate = true
    ;(l.material as THREE.LineBasicMaterial).opacity = (k - 0.25) * 0.55
  })
  return <lineSegments ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={7} />
}

/* ---------- Swoosh and shockwave ---------- */

const ARC_VERT = `varying vec2 vPos; void main(){ vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const ARC_FRAG = `
uniform float uLen; uniform float uI; uniform vec3 uColor; varying vec2 vPos;
void main(){
  float a = atan(vPos.y, vPos.x);
  if (a < 0.0) a += 6.2831853;
  float k = clamp(a / uLen, 0.0, 1.0);
  float r = length(vPos);
  float edge = smoothstep(0.75, 1.15, r) * smoothstep(1.75, 1.35, r);
  // Bright at the leading edge, fading along the tail.
  float a2 = pow(k, 1.6) * edge * uI;
  gl_FragColor = vec4(uColor * a2, 1.0);
}`

const ARCS: Record<string, number> = { punch: 1.3, kick: 2.8, spin: Math.PI * 2, dash: 1.1 }

let swooshCache: { mat: THREE.ShaderMaterial; geos: Record<string, THREE.BufferGeometry> } | null = null
function swooshRes() {
  if (swooshCache) return swooshCache
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLen: { value: 1 }, uI: { value: 0 }, uColor: { value: new THREE.Color(1.4, 1.7, 2.2) } },
    vertexShader: ARC_VERT,
    fragmentShader: ARC_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const geos: Record<string, THREE.BufferGeometry> = {}
  for (const [k, len] of Object.entries(ARCS)) geos[k] = new THREE.RingGeometry(0.7, 1.8, 40, 1, 0, len)
  swooshCache = { mat, geos }
  return swooshCache
}

function Swoosh() {
  const ref = useRef<THREE.Mesh>(null)
  const st = useRef({ n: player.swoosh.n, t: 9, len: 1 })
  const { mat } = swooshRes()

  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    const { mat, geos } = swooshRes()
    const s = st.current
    if (player.swoosh.n !== s.n) {
      s.n = player.swoosh.n
      s.t = 0
      const move = player.swoosh.move
      m.geometry = geos[move] ?? geos.punch
      s.len = ARCS[move] ?? 1.3
      mat.uniforms.uLen.value = s.len
    }
    s.t += Math.min(dt, 0.05)
    const life = 0.28
    m.visible = s.t < life
    if (!m.visible) return
    // Lie flat around the waist, sweeping round in the direction of the swing.
    m.position.set(player.pos.x, player.pos.y + 1.0, player.pos.z)
    m.rotation.set(-Math.PI / 2, 0, player.yaw - Math.PI / 2 - s.len / 2 + (s.t / life) * 1.2)
    m.scale.setScalar(0.85 + (s.t / life) * 0.35)
    mat.uniforms.uI.value = (1 - s.t / life) * 1.6
  })
  return <mesh ref={ref} material={mat} visible={false} frustumCulled={false} renderOrder={6} />
}

const SHOCK_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide })

function Shockwave() {
  const ref = useRef<THREE.Mesh>(null)
  const st = useRef({ n: player.stomp.n, t: 9 })
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    const s = st.current
    if (player.stomp.n !== s.n) {
      s.n = player.stomp.n
      s.t = 0
      m.position.set(player.pos.x, player.pos.y + 0.12, player.pos.z)
    }
    s.t += Math.min(dt, 0.05)
    const life = 0.45
    m.visible = s.t < life
    if (!m.visible) return
    const k = s.t / life
    m.scale.setScalar(0.6 + k * 4.4)
    SHOCK_MAT.opacity = (1 - k) * 0.9
  })
  return (
    <mesh ref={ref} material={SHOCK_MAT} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={6}>
      <ringGeometry args={[0.82, 1, 48]} />
    </mesh>
  )
}

export function PlayerFx() {
  return (
    <>
      <SpeedLines />
      <Swoosh />
      <Shockwave />
    </>
  )
}
