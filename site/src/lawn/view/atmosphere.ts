// The sky dome (a gradient sky with a sun disc and glow, drifting cloud banks and stars at night), the image-based
// light baked from it, and the post stack for medium and high quality: ambient occlusion reconstructed from the
// depth buffer, bloom, ACES tone mapping, a lift/gamma/gain colour grade and a vignette (one merged effect pass).
import * as THREE from 'three'
import type { Mood } from './moods'

/* ---------- sky ---------- */

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`

const skyFrag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform float uGlow;
uniform float uDisc;
uniform float uClouds;
uniform vec3 uCloudTint;
uniform float uStars;
uniform float uTime;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  // Horizon haze picks up the sun colour on its side of the sky.
  col += uSun * (pow(s, 10.0) * uGlow * 0.35 + pow(s, 90.0) * uGlow * 0.9) * smoothstep(-0.1, 0.2, h + 0.1);
  col += uSun * smoothstep(0.9993, 0.9997, s) * uDisc;
  if (h > 0.0 && uClouds > 0.0) {
    vec2 p = d.xz / (h + 0.12) * 0.9 + vec2(uTime * 0.004, 0.0);
    float n = fbm(p);
    float c = smoothstep(0.58 - uClouds * 0.18, 0.86, n) * smoothstep(0.0, 0.18, h);
    float lit = 0.75 + 0.35 * pow(s, 4.0);
    vec3 cloud = uCloudTint * lit * (0.85 + 0.25 * fbm(p * 2.5 + 3.0));
    col = mix(col, cloud, c * 0.9);
  }
  if (uStars > 0.0 && h > 0.0) {
    vec2 g = d.xz / (h + 0.3) * 160.0;
    vec2 cell = floor(g);
    float r = h21(cell);
    vec2 sp = vec2(h21(cell + 3.1), h21(cell + 7.7));
    float star = step(0.985, r) * smoothstep(0.12, 0.0, length(fract(g) - sp));
    col += vec3(star) * uStars * 1.6 * smoothstep(0.05, 0.4, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: new THREE.Color() },
      uGlow: { value: 1 },
      uDisc: { value: 20 },
      uClouds: { value: 0.5 },
      uCloudTint: { value: new THREE.Color('#ffffff') },
      uStars: { value: 0 },
      uTime: { value: 0 },
    },
  })
}

export function sunDirection(m: Mood) {
  const az = (m.sunAz * Math.PI) / 180
  const el = (m.sunEl * Math.PI) / 180
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
}

export function applySky(mat: THREE.ShaderMaterial, m: Mood) {
  const u = mat.uniforms
  u.uZenith.value.set(m.sky.zenith)
  u.uHorizon.value.set(m.sky.horizon)
  u.uGround.value.set(m.sky.ground)
  u.uSun.value.set(m.sky.sun)
  u.uGlow.value = m.sky.glow
  u.uDisc.value = m.sky.disc
  u.uClouds.value = m.sky.clouds
  u.uCloudTint.value.set(m.sky.cloudTint)
  u.uStars.value = m.sky.stars
  u.uSunDir.value.copy(sunDirection(m))
}

/** Bake the sky (plus a ground disc in the lawn colour) into a prefiltered environment map. */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, m: Mood, ground: string) {
  const pm = new THREE.PMREMGenerator(renderer)
  const s = new THREE.Scene()
  const mat = skyMaterial()
  applySky(mat, m)
  mat.uniforms.uStars.value = 0
  // Tone mapping must not run while baking: the sky shader includes the chunk, so render with it off.
  const tm = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat)
  s.add(dome)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: ground }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -2
  s.add(floor)
  const env = pm.fromScene(s, 0.02, 0.1, 400).texture
  renderer.toneMapping = tm
  pm.dispose()
  dome.geometry.dispose()
  mat.dispose()
  floor.geometry.dispose()
  ;(floor.material as THREE.Material).dispose()
  return env
}

/* ---------- post ---------- */

export interface PostOptions {
  msaa: number
  ao: boolean
  aoSamples: number
}

export interface Post {
  render(dt: number): void
  setSize(w: number, h: number): void
  setMood(m: Mood): void
  dispose(): void
}

const aoFrag = /* glsl */ `
uniform vec2 uProj;
uniform float uRadius;
uniform float uIntensity;
uniform float uExposure;
uniform float uFade;
vec3 vpos(const in vec2 uv, const in float d) {
  float z = getViewZ(d);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * -z / uProj.x, ndc.y * -z / uProj.y, z);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = inputColor.rgb * uExposure;
  if (uIntensity <= 0.0 || depth >= 0.9999) { outputColor = vec4(col, inputColor.a); return; }
  vec3 P = vpos(uv, depth);
  // The first-person viewmodel lives within a few centimetres of the lens: no occlusion there.
  if (-P.z < 0.35) { outputColor = vec4(col, inputColor.a); return; }
  vec2 tx = texelSize;
  vec3 pr = vpos(uv + vec2(tx.x, 0.0), readDepth(uv + vec2(tx.x, 0.0)));
  vec3 pl = vpos(uv - vec2(tx.x, 0.0), readDepth(uv - vec2(tx.x, 0.0)));
  vec3 pu = vpos(uv + vec2(0.0, tx.y), readDepth(uv + vec2(0.0, tx.y)));
  vec3 pd = vpos(uv - vec2(0.0, tx.y), readDepth(uv - vec2(0.0, tx.y)));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float rUV = min(uRadius * uProj.y * 0.5 / -P.z, 0.12);
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  float r2 = uRadius * uRadius;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(AO_SAMPLES);
    float a = ang + float(i) * 2.3999632;
    vec2 suv = uv + vec2(cos(a) / aspect, sin(a)) * rUV * sqrt(t);
    vec3 V = vpos(suv, readDepth(suv)) - P;
    float vv = dot(V, V);
    float vn = dot(V, N);
    occ += max(0.0, vn - 0.01 * -P.z) / (vv + 0.004 * -P.z) * (1.0 - smoothstep(r2, 2.5 * r2, vv));
  }
  float ao = clamp(1.0 - uIntensity * uRadius * occ / float(AO_SAMPLES), 0.0, 1.0);
  ao = mix(1.0, ao * ao, 1.0 - smoothstep(uFade * 0.6, uFade, -P.z));
  outputColor = vec4(col * ao, inputColor.a);
}`

const gradeFrag = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
  c = c * uGain + uLift * (1.0 - c);
  c = pow(max(c, vec3(0.0)), 1.0 / uGamma);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.2) * uContrast + 0.2;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}`

/** The post stack (pmndrs postprocessing, loaded on demand). */
export async function makePost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, mood: Mood, opts: PostOptions): Promise<Post> {
  const P = await import('postprocessing')
  const composer = new P.EffectComposer(renderer, { multisampling: opts.msaa, frameBufferType: THREE.HalfFloatType })
  composer.addPass(new P.RenderPass(scene, camera))
  const ao = new P.Effect('LawnAO', aoFrag, {
    attributes: P.EffectAttribute.DEPTH,
    defines: new Map([['AO_SAMPLES', String(opts.aoSamples)]]),
    uniforms: new Map<string, THREE.Uniform>([
      ['uProj', new THREE.Uniform(new THREE.Vector2(1, 1))],
      ['uRadius', new THREE.Uniform(0.9)],
      ['uIntensity', new THREE.Uniform(opts.ao ? 1 : 0)],
      ['uExposure', new THREE.Uniform(1)],
      ['uFade', new THREE.Uniform(70)],
    ]),
  })
  const bloom = new P.BloomEffect({ intensity: mood.bloom.intensity, luminanceThreshold: mood.bloom.threshold, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 })
  const tone = new P.ToneMappingEffect({ mode: P.ToneMappingMode.ACES_FILMIC })
  const grade = new P.Effect('LawnGrade', gradeFrag, {
    uniforms: new Map<string, THREE.Uniform>([
      ['uLift', new THREE.Uniform(new THREE.Vector3())],
      ['uGamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['uSat', new THREE.Uniform(1)],
      ['uContrast', new THREE.Uniform(1)],
    ]),
  })
  const vignette = new P.VignetteEffect({ darkness: mood.grade.vignette, offset: 0.32 })
  composer.addPass(new P.EffectPass(camera, ao, bloom, tone, grade, vignette))
  const prevTone = renderer.toneMapping
  const prevExposure = renderer.toneMappingExposure
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  const u = (e: InstanceType<typeof P.Effect>, k: string) => e.uniforms.get(k)!
  const setMood = (m: Mood) => {
    u(ao, 'uIntensity').value = opts.ao ? m.ao : 0
    u(ao, 'uExposure').value = m.exposure
    bloom.intensity = m.bloom.intensity
    bloom.luminanceMaterial.threshold = m.bloom.threshold
    u(grade, 'uLift').value.set(...m.grade.lift)
    u(grade, 'uGamma').value.set(...m.grade.gamma)
    u(grade, 'uGain').value.set(...m.grade.gain)
    u(grade, 'uSat').value = m.grade.saturation
    u(grade, 'uContrast').value = m.grade.contrast
    vignette.darkness = m.grade.vignette
  }
  setMood(mood)
  return {
    render: (dt) => {
      u(ao, 'uProj').value.set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5])
      composer.render(dt)
    },
    setSize: (w, h) => composer.setSize(w, h, false),
    setMood,
    dispose: () => {
      renderer.toneMapping = prevTone
      renderer.toneMappingExposure = prevExposure
      composer.dispose()
    },
  }
}
