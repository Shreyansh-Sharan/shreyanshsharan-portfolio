// The light of the match: one look per time of day (a bright sunny afternoon, golden hour, a floodlit night) with
// the sun, the sky fill, haze, exposure and a colour grade; the sky dome (scattering gradient, sun disc, drifting
// fair-weather clouds, stars at night) and an environment map baked from the same sky, a grass-green ground and a
// ring of stands, so every material gets matching ambient light and reflections. The grade runs inside the
// renderer's tone mapping on every tier (free), and as the post chain's last effect on the high tier.
import * as THREE from 'three'
import type { TimeOfDay } from '../sim/conditions'

export interface Look {
  sunDir: THREE.Vector3
  sunColor: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  envIntensity: number
  exposure: number
  fog: string
  fogDensity: number
  /** Sky: zenith, horizon, below the horizon. */
  zenith: string
  horizon: string
  ground: string
  /** Cloud cover 0..1 and the clouds' lit and shaded colours. */
  clouds: number
  cloudLit: string
  cloudShade: string
  stars: number
  /** Grade: white balance (multiplies the scene before tone mapping), saturation, contrast, a lift in the shadows. */
  balance: [number, number, number]
  saturation: number
  contrast: number
  lift: [number, number, number]
  /** The lift on the stands' surfaces (floodlight spill at night). */
  standGlow: string
  bloom: { intensity: number; threshold: number }
}

const dir = (azimuthDeg: number, elevationDeg: number) => {
  const a = THREE.MathUtils.degToRad(azimuthDeg)
  const e = THREE.MathUtils.degToRad(elevationDeg)
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
}

export const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    // Mid-afternoon: high and to one side, so shadows fall across the pitch, short and crisp.
    sunDir: dir(-58, 50),
    sunColor: '#fff3e2',
    sunIntensity: 3.1,
    hemiSky: '#cfe2ff',
    hemiGround: '#55703a',
    hemiIntensity: 0.32,
    envIntensity: 0.85,
    exposure: 0.92,
    fog: '#c9dcee',
    fogDensity: 0.0021,
    zenith: '#2f6fc9',
    horizon: '#bcd6ee',
    ground: '#a9bfcf',
    clouds: 0.42,
    cloudLit: '#ffffff',
    cloudShade: '#aab8c9',
    stars: 0,
    balance: [1.02, 1.0, 0.97],
    saturation: 1.06,
    contrast: 1.06,
    lift: [0.004, 0.005, 0.008],
    standGlow: '#000000',
    bloom: { intensity: 0.3, threshold: 2.8 },
  },
  dusk: {
    // Golden hour: the sun low over the square-leg stand, its long shadow reaching in over the rope, a peach sky.
    sunDir: dir(-70, 19),
    sunColor: '#ffb469',
    sunIntensity: 3.3,
    hemiSky: '#ffd6b0',
    hemiGround: '#4a4026',
    hemiIntensity: 0.5,
    envIntensity: 1.0,
    exposure: 1.08,
    fog: '#e8b993',
    fogDensity: 0.002,
    zenith: '#3b5590',
    horizon: '#f5b383',
    ground: '#d59b74',
    clouds: 0.5,
    cloudLit: '#ffc890',
    cloudShade: '#7a6a80',
    stars: 0,
    balance: [1.05, 0.99, 0.92],
    saturation: 1.08,
    contrast: 1.07,
    lift: [0.01, 0.006, 0.008],
    standGlow: '#160d06',
    bloom: { intensity: 0.45, threshold: 2.2 },
  },
  night: {
    // Floodlit: the key light high over the ground from the towers, a cool sky.
    sunDir: dir(-53, 64),
    sunColor: '#f4f7ff',
    sunIntensity: 2.3,
    hemiSky: '#8fa3c8',
    hemiGround: '#22331d',
    hemiIntensity: 0.55,
    envIntensity: 0.55,
    exposure: 1.05,
    fog: '#0a1020',
    fogDensity: 0.0022,
    zenith: '#050a1a',
    horizon: '#1d2c52',
    ground: '#2a3a5c',
    clouds: 0.25,
    cloudLit: '#3a4566',
    cloudShade: '#121a30',
    stars: 1,
    balance: [0.98, 1.0, 1.04],
    saturation: 1.04,
    contrast: 1.05,
    lift: [0.006, 0.008, 0.016],
    standGlow: '#2c3650',
    bloom: { intensity: 0.8, threshold: 1.25 },
  },
}

const f = (n: number) => n.toFixed(4)
const v3 = (c: [number, number, number]) => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`

/** The grade as GLSL: `cricketGrade(linear HDR colour, exposure)` → display-linear colour. */
export function gradeGlsl(look: Look) {
  return /* glsl */ `
vec3 cricketAcesFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 cricketGrade(vec3 color, float exposure) {
  const mat3 ACESIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= ${v3(look.balance)} * exposure / 0.6;
  color = ACESIn * color;
  color = cricketAcesFit(color);
  color = ACESOut * color;
  color = clamp(color, 0.0, 1.0);
  // Saturation and contrast in (roughly) display space, a touch of colour in the shadows.
  vec3 d = sqrt(color);
  float l = dot(d, vec3(0.2126, 0.7152, 0.0722));
  d = mix(vec3(l), d, ${f(look.saturation)});
  d = (d - 0.5) * ${f(look.contrast)} + 0.5;
  d += ${v3(look.lift)} * (1.0 - d);
  d = clamp(d, 0.0, 1.0);
  return d * d;
}`
}

let chunkBase: string | null = null
/** Installs the grade as three's custom tone mapping (programs are per renderer, so each match compiles its own). */
export function installGrade(look: Look) {
  chunkBase ??= THREE.ShaderChunk.tonemapping_pars_fragment
  THREE.ShaderChunk.tonemapping_pars_fragment = chunkBase.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', `${gradeGlsl(look)}\nvec3 CustomToneMapping( vec3 color ) { return cricketGrade(color, toneMappingExposure); }`)
}

const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`

function skyFrag(octaves: number) {
  return /* glsl */ `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 groundCol; uniform vec3 sunDir; uniform vec3 sunCol;
uniform float clouds; uniform vec3 cloudLit; uniform vec3 cloudShade; uniform float stars; uniform float uTime; uniform float sunDisc;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < ${octaves}; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 c = mix(horizon, zenith, pow(up, 0.55));
  c = mix(c, groundCol, smoothstep(0.0, -0.08, y));
  float mu = max(dot(d, sunDir), 0.0);
  // Forward scattering round the sun and a bright, soft-edged disc.
  c += sunCol * (pow(mu, 8.0) * 0.18 + pow(mu, 64.0) * 0.35);
  c += sunCol * smoothstep(0.9994, 0.99975, mu) * sunDisc;
  // Fair-weather clouds on a flat layer overhead, fading into the haze at the horizon.
  if (clouds > 0.0 && y > 0.0) {
    vec2 uv = d.xz / (y + 0.09) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float cov = smoothstep(1.0 - clouds, 1.0 - clouds + 0.28, n);
    ${octaves > 3 ? 'float thick = smoothstep(1.0 - clouds, 1.0, fbm(uv * 1.9 + 4.0));' : 'float thick = smoothstep(1.0 - clouds, 1.0, n);'}
    float lit = clamp(0.55 + 0.45 * dot(normalize(vec3(d.x, 0.35, d.z)), sunDir) - thick * 0.35, 0.0, 1.0);
    vec3 cc = mix(cloudShade, cloudLit, lit) + sunCol * pow(mu, 12.0) * 0.25 * (1.0 - thick);
    float fade = smoothstep(0.0, 0.22, y);
    c = mix(c, cc, cov * fade * 0.95);
  }
  if (stars > 0.0 && y > 0.15) { vec3 q = floor(d * 260.0); float s = step(0.9975, fract(sin(dot(q, vec3(12.9898,78.233,45.164))) * 43758.5453)); c += vec3(s) * 0.7 * smoothstep(0.15, 0.5, y); }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
}

/** The sky dome (drawn first, behind everything, never fogged). */
export function makeSky(look: Look, tier: string) {
  const uniforms = {
    zenith: { value: new THREE.Color(look.zenith) },
    horizon: { value: new THREE.Color(look.horizon) },
    groundCol: { value: new THREE.Color(look.ground) },
    sunDir: { value: look.sunDir.clone().normalize() },
    sunCol: { value: new THREE.Color(look.sunColor).multiplyScalar(look.stars ? 0 : 1) },
    clouds: { value: look.clouds },
    cloudLit: { value: new THREE.Color(look.cloudLit) },
    cloudShade: { value: new THREE.Color(look.cloudShade) },
    stars: { value: look.stars },
    uTime: { value: 0 },
    sunDisc: { value: look.stars ? 0 : 6 },
  }
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms, vertexShader: SKY_VERT, fragmentShader: skyFrag(tier === 'low' ? 2 : tier === 'medium' ? 3 : 5) })
  const m = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), mat)
  m.renderOrder = -10
  m.frustumCulled = false
  m.name = 'sky'
  return { mesh: m, uniforms }
}

/**
 * The environment: the sky, a band of grandstands round the horizon (lit concrete, seats, a dark roof line), the
 * grass below, and at night the floodlight banks, filtered into a PMREM map.
 */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, look: Look, night: boolean) {
  const pm = new THREE.PMREMGenerator(renderer)
  const s = new THREE.Scene()
  const sky = makeSky(look, 'high')
  sky.uniforms.sunDisc.value = 0
  sky.mesh.material.depthTest = false
  s.add(sky.mesh)
  const band = (y0: number, y1: number, color: THREE.ColorRepresentation, r = 300) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, 48, 1, true)
    g.translate(0, (y0 + y1) / 2, 0)
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }))
    s.add(m)
  }
  const sun = new THREE.Color(look.sunColor)
  const lit = (c: string, k: number) => new THREE.Color(c).multiply(night ? new THREE.Color('#9aa6c0') : sun).multiplyScalar(k)
  band(0, 30, lit('#7d8590', night ? 0.25 : 0.55))
  band(30, 55, lit('#5b6270', night ? 0.15 : 0.35))
  band(55, 62, lit('#2a2e36', night ? 0.1 : 0.4))
  const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 32), new THREE.MeshBasicMaterial({ color: lit('#4f7a35', night ? 0.35 : 0.45), side: THREE.DoubleSide }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -1
  s.add(ground)
  if (night) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (0.25 + i * 0.5)
      const b = new THREE.Mesh(new THREE.SphereGeometry(14, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4d8').multiplyScalar(14) }))
      b.position.set(Math.sin(a) * 250, 120, Math.cos(a) * 250)
      s.add(b)
    }
  }
  const tex = pm.fromScene(s, 0.02, 1, 1000).texture
  pm.dispose()
  s.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
    }
  })
  return tex
}
