// Spell visuals that aren't owned by the animals: the pooled particles, the lightning system (branching
// bolts from the sky, fast re-strikes, arcs crackling over the target, sparks and a flash), plus the
// boulder, the car and the pew-pew shots. Everything is built in code; nothing is downloaded.
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { heightAt } from './terrain'
import { drainCast, IMPACT, lastCast, type CastEvent, type SpellId } from './spells'
import { emit, MAX_PARTICLES, pool, SHAPE, skyFlash, stepParticles, type Emit } from './particles'
import type { Animal } from './wildlife'

/* ---------- Helpers ---------- */

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const smooth = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}
const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Centre of the spell's target (or where the spell landed), written into `out`. */
function centreOf(target: Animal | null, at: THREE.Vector3, out: THREE.Vector3, frac = 0.5) {
  if (target) return out.set(target.pos.x, target.pos.y + target.spec.height * target.scale * frac, target.pos.z)
  return out.set(at.x, heightAt(at.x, at.z) + 0.6 * frac * 2, at.z)
}

const opts: Emit = { count: 0, x: 0, y: 0, z: 0, speed: [0, 0], color: new THREE.Color(), size: [0, 0], life: [0, 0] }
function burst(o: Partial<Emit> & Pick<Emit, 'count' | 'x' | 'y' | 'z' | 'color'>) {
  opts.spread = 0
  opts.up = 0.3
  opts.color2 = undefined
  opts.hdr = 1
  opts.gravity = 0
  opts.drag = 0
  opts.shape = SHAPE.glow
  opts.grow = false
  opts.speed = [1, 2]
  opts.size = [0.2, 0.3]
  opts.life = [0.5, 0.8]
  Object.assign(opts, o)
  emit(opts)
}

const C = {
  heart: new THREE.Color('#ff5fa2'),
  petal: new THREE.Color('#ffc2dc'),
  shrink: new THREE.Color('#c084fc'),
  grow: new THREE.Color('#a3e635'),
  gold: new THREE.Color('#ffd23f'),
  ice: new THREE.Color('#bfe9ff'),
  iceDeep: new THREE.Color('#5ec4ff'),
  dust: new THREE.Color('#b9a98f'),
  debris: new THREE.Color('#7c7368'),
  spark: new THREE.Color('#9be7ff'),
  white: new THREE.Color('#ffffff'),
  muzzle: new THREE.Color('#ffcf4a'),
}

/* ---------- Particles ---------- */

const PARTICLE_VERT = `
attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aShape;
uniform float uScale;
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale * projectionMatrix[1][1] / max(0.001, -mv.z), 160.0);
  vColor = aColor; vAlpha = aAlpha; vShape = aShape;
}`

const PARTICLE_FRAG = `
varying vec3 vColor; varying float vAlpha; varying float vShape;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float d = length(p);
  float a;
  if (vShape < 0.5) {
    a = pow(max(0.0, 1.0 - d), 2.0);
  } else if (vShape < 1.5) {
    vec2 q = vec2(p.x * 1.25, p.y * 1.25 + 0.12);
    float h = dot(q, q) - 1.0;
    float f = h * h * h - q.x * q.x * q.y * q.y * q.y;
    a = smoothstep(0.04, -0.04, f);
  } else if (vShape < 2.5) {
    float rays = max(0.0, 1.0 - abs(p.x * p.y) * 16.0 - d * 0.7);
    a = clamp(rays + max(0.0, 1.0 - d * 2.4), 0.0, 1.0);
  } else if (vShape < 3.5) {
    a = smoothstep(1.0, 0.0, d) * 0.55;
  } else {
    a = smoothstep(1.0, 0.8, abs(p.x) * 1.8 + abs(p.y));
  }
  a *= vAlpha;
  if (!(a >= 0.01)) discard; // also drops NaN, which would otherwise smear through the bloom pass
  gl_FragColor = vec4(vColor, a);
}`

const attr = (arr: Float32Array, size: number) => new THREE.BufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage)

let particleRes: { geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial } | null = null

/** The particle pool's GPU side, created once and shared for the session. */
function particleGpu() {
  if (particleRes) return particleRes
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', attr(pool.pos, 3))
  geo.setAttribute('aColor', attr(pool.col, 3))
  geo.setAttribute('aSize', attr(pool.size, 1))
  geo.setAttribute('aAlpha', attr(pool.alpha, 1))
  geo.setAttribute('aShape', attr(pool.shape, 1))
  geo.setDrawRange(0, MAX_PARTICLES)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
  })
  particleRes = { geo, mat }
  return particleRes
}

function Particles() {
  const ref = useRef<THREE.Points>(null)
  const last = useRef(0)
  const { geo, mat } = particleGpu()

  useFrame(({ gl }, dt) => {
    const alive = stepParticles(Math.min(dt, 0.05))
    const pts = ref.current
    if (!pts) return
    const { geo, mat } = particleGpu()
    // Upload only while something is (or just was) alive.
    if (alive || last.current) {
      for (const name of PARTICLE_ATTRS) (geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true
    }
    last.current = alive
    pts.visible = alive > 0
    const u = mat.uniforms.uScale
    u.value = gl.domElement.height * 0.5
  })
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />
}

/* ---------- Lightning ---------- */

const MAX_SEG = 900
const MAIN_N = 32
const BRANCH_N = 8
const MAX_BRANCH = 6
const ARC_N = 8
const MAX_ARCS = 6
const HAND_N = 16
/** Re-strike times after the cast (seconds). */
const STRIKES = [0, 0.11, 0.25, 0.47]
const CRACKLE = 1.35
const LIFE = 1.6
const ZAP_LIFE = 0.28

interface Bolt {
  on: boolean
  t: number
  target: Animal | null
  at: THREE.Vector3
  hand: THREE.Vector3
  k: number
  age: number
  arcT: number
  handT: number
  main: Float32Array
  branches: Float32Array
  nb: number
  arcs: Float32Array
  handPts: Float32Array
  ground: THREE.Vector3
  /** A short ranged zap from the hands (no sky strike). */
  zap: boolean
}

const makeBolt = (): Bolt => ({
  on: false,
  t: 0,
  target: null,
  at: new THREE.Vector3(),
  hand: new THREE.Vector3(),
  k: 0,
  age: 9,
  arcT: 9,
  handT: 9,
  main: new Float32Array((MAIN_N + 1) * 3),
  branches: new Float32Array(MAX_BRANCH * (BRANCH_N + 1) * 3),
  nb: 0,
  arcs: new Float32Array(MAX_ARCS * (ARC_N + 1) * 3),
  handPts: new Float32Array((HAND_N + 1) * 3),
  ground: new THREE.Vector3(),
  zap: false,
})

const bolts: Bolt[] = [makeBolt(), makeBolt(), makeBolt()]

function triggerLightning(cast: CastEvent) {
  const b = bolts.find((x) => !x.on) ?? bolts.reduce((o, x) => (x.t > o.t ? x : o))
  b.on = true
  b.t = 0
  b.k = 0
  b.age = 9
  b.arcT = 9
  b.handT = 9
  b.target = cast.target
  b.at.copy(cast.at)
  b.hand.set(cast.from.x, cast.from.y + 1.45, cast.from.z)
  b.zap = cast.spell.id === 'zap'
  if (b.zap) b.k = STRIKES.length
}

/** Midpoint displacement: a jagged path of `n` segments (n a power of two) from a to b, into `out` at point `off`. */
function zigzag(out: Float32Array, off: number, n: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, jag: number) {
  const o = off * 3
  out[o] = ax
  out[o + 1] = ay
  out[o + 2] = az
  out[o + n * 3] = bx
  out[o + n * 3 + 1] = by
  out[o + n * 3 + 2] = bz
  for (let step = n; step > 1; step >>= 1) {
    const half = step >> 1
    for (let i = half; i < n; i += step) {
      const a = o + (i - half) * 3, c = o + (i + half) * 3, m = o + i * 3
      const len = Math.hypot(out[c] - out[a], out[c + 1] - out[a + 1], out[c + 2] - out[a + 2])
      const j = len * jag
      out[m] = (out[a] + out[c]) / 2 + (Math.random() - 0.5) * 2 * j
      out[m + 1] = (out[a + 1] + out[c + 1]) / 2 + (Math.random() - 0.5) * j
      out[m + 2] = (out[a + 2] + out[c + 2]) / 2 + (Math.random() - 0.5) * 2 * j
    }
  }
}

const LIGHTNING_VERT = `
attribute vec3 aDir; attribute float aSide; attribute float aWidth; attribute float aBright;
varying float vSide; varying float vBright;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 d = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
  vec3 side = cross(d, mv.xyz);
  float l = length(side);
  side = l > 1e-6 ? side / l : vec3(1.0, 0.0, 0.0);
  mv.xyz += side * aSide * aWidth;
  vSide = aSide;
  // Fade out right next to the camera so a bolt passing close by never whites out the frame.
  vBright = aBright * smoothstep(1.5, 6.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`

const LIGHTNING_FRAG = `
uniform vec3 uGlow;
varying float vSide; varying float vBright;
void main(){
  float d = abs(vSide);
  float core = smoothstep(0.36, 0.0, d);
  float glow = pow(max(0.0, 1.0 - d), 2.2);
  vec3 col = uGlow * glow * 2.2 + vec3(0.85, 0.95, 1.0) * core * 3.2;
  gl_FragColor = vec4(col * vBright, 1.0);
}`

const GLOW_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const GLOW_FRAG = `
uniform vec3 uColor; uniform float uI; varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.5);
  gl_FragColor = vec4(uColor * a * uI, 1.0);
}`

interface RibbonBuffer {
  pos: Float32Array
  dir: Float32Array
  side: Float32Array
  width: Float32Array
  bright: Float32Array
  n: number
}

/** Append one camera-facing ribbon segment (4 vertices) from a to b. */
function seg(buf: RibbonBuffer, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, bright: number) {
  if (buf.n >= MAX_SEG) return
  const v = buf.n++ * 4
  const dx = bx - ax, dy = by - ay, dz = bz - az
  for (let k = 0; k < 4; k++) {
    const end = k >> 1
    const i3 = (v + k) * 3
    buf.pos[i3] = end ? bx : ax
    buf.pos[i3 + 1] = end ? by : ay
    buf.pos[i3 + 2] = end ? bz : az
    buf.dir[i3] = dx
    buf.dir[i3 + 1] = dy
    buf.dir[i3 + 2] = dz
    buf.side[v + k] = k & 1 ? 1 : -1
    buf.width[v + k] = width
    buf.bright[v + k] = bright
  }
}

/** Append a polyline of `n` segments starting at point `off` of `pts`, offset by (ox, oy, oz), tapering towards its end. */
function path(buf: RibbonBuffer, pts: Float32Array, off: number, n: number, width: number, bright: number, taper: number, ox = 0, oy = 0, oz = 0) {
  for (let k = 0; k < n; k++) {
    const a = (off + k) * 3, c = a + 3
    const w = width * (1 - taper * (k / n))
    seg(buf, pts[a] + ox, pts[a + 1] + oy, pts[a + 2] + oz, pts[c] + ox, pts[c + 1] + oy, pts[c + 2] + oz, w, bright)
  }
}

const RIBBON_ATTRS = ['position', 'aDir', 'aSide', 'aWidth', 'aBright']
const PARTICLE_ATTRS = ['position', 'aColor', 'aSize', 'aAlpha', 'aShape']

let lightningRes: { geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial; buf: RibbonBuffer; glowMat: THREE.ShaderMaterial } | null = null

/** One dynamic ribbon buffer for every bolt, fork and arc (a single draw call), plus the ground glow. */
function lightningGpu() {
  if (lightningRes) return lightningRes
  const geo = new THREE.BufferGeometry()
  const v = MAX_SEG * 4
  const buf: RibbonBuffer = {
    pos: new Float32Array(v * 3),
    dir: new Float32Array(v * 3),
    side: new Float32Array(v),
    width: new Float32Array(v),
    bright: new Float32Array(v),
    n: 0,
  }
  geo.setAttribute('position', attr(buf.pos, 3))
  geo.setAttribute('aDir', attr(buf.dir, 3))
  geo.setAttribute('aSide', attr(buf.side, 1))
  geo.setAttribute('aWidth', attr(buf.width, 1))
  geo.setAttribute('aBright', attr(buf.bright, 1))
  const idx = new Uint16Array(MAX_SEG * 6)
  for (let i = 0; i < MAX_SEG; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6)
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  geo.setDrawRange(0, 0)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: new THREE.Color(0.18, 0.42, 1.6) } },
    vertexShader: LIGHTNING_VERT,
    fragmentShader: LIGHTNING_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.45, 0.75, 1.0) }, uI: { value: 0 } },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  lightningRes = { geo, mat, buf, glowMat }
  return lightningRes
}

function Lightning() {
  const glowRef = useRef<THREE.Mesh>(null)
  const { geo, mat, glowMat } = lightningGpu()

  useFrame((_, rawDt) => {
    const { geo, buf, glowMat } = lightningGpu()
    const dt = Math.min(rawDt, 0.05)
    skyFlash.value = Math.max(0, skyFlash.value - dt * 5)
    buf.n = 0
    let glowI = 0
    const glow = glowRef.current

    for (const b of bolts) {
      if (!b.on) continue
      b.t += dt
      if (b.t > (b.zap ? ZAP_LIFE : LIFE)) {
        b.on = false
        continue
      }
      if (b.zap) {
        // Ranged zap: a thick crackling arc from the hands to the enemy, re-jagged every few frames.
        b.handT += dt
        if (b.handT > 0.035) {
          b.handT = 0
          zigzag(b.handPts, 0, HAND_N, b.hand.x, b.hand.y, b.hand.z, b.at.x, b.at.y, b.at.z, 0.1)
          burst({ count: 4, x: b.at.x, y: b.at.y, z: b.at.z, color: C.spark, color2: C.white, hdr: 3, speed: [2, 5], size: [0.08, 0.14], life: [0.15, 0.3], gravity: 9 })
        }
        path(buf, b.handPts, 0, HAND_N, 0.16, 1 - b.t / ZAP_LIFE, 0.3)
        continue
      }
      const tgt = b.target
      const centre = centreOf(tgt, b.at, tmpA)
      const top = tgt ? tmpB.set(tgt.pos.x, tgt.pos.y + tgt.spec.height * tgt.scale * 0.85, tgt.pos.z) : tmpB.set(b.at.x, heightAt(b.at.x, b.at.z), b.at.z)

      // A new strike: fresh jagged path from high in the sky, with forks.
      if (b.k < STRIKES.length && b.t >= STRIKES[b.k]) {
        b.k++
        b.age = 0
        const sx = top.x + rand(-4, 4), sz = top.z + rand(-4, 4)
        zigzag(b.main, 0, MAIN_N, sx, top.y + 42, sz, top.x, top.y, top.z, 0.17)
        b.nb = 3 + Math.floor(Math.random() * (MAX_BRANCH - 2))
        for (let i = 0; i < b.nb; i++) {
          const s = 2 + Math.floor(Math.random() * (MAIN_N * 0.7))
          const p = s * 3
          let dx = b.main[p + 3] - b.main[p], dy = b.main[p + 4] - b.main[p + 1], dz = b.main[p + 5] - b.main[p + 2]
          const l = Math.hypot(dx, dy, dz) || 1
          dx = dx / l + rand(-1, 1)
          dy = dy / l
          dz = dz / l + rand(-1, 1)
          const len = rand(3, 9) * (1 - s / MAIN_N) + 1.5
          const l2 = Math.hypot(dx, dy, dz) || 1
          zigzag(b.branches, i * (BRANCH_N + 1), BRANCH_N, b.main[p], b.main[p + 1], b.main[p + 2], b.main[p] + (dx / l2) * len, b.main[p + 1] + (dy / l2) * len, b.main[p + 2] + (dz / l2) * len, 0.25)
        }
        b.ground.set(top.x, heightAt(top.x, top.z), top.z)
        skyFlash.value = 1
        burst({ count: 26, x: top.x, y: top.y, z: top.z, color: C.spark, color2: C.white, hdr: 3, up: 0.35, speed: [4, 9], size: [0.08, 0.16], life: [0.25, 0.55], gravity: 14, drag: 0.6 })
        if (b.k === 1) burst({ count: 10, x: b.ground.x, y: b.ground.y + 0.2, z: b.ground.z, color: C.dust, shape: SHAPE.smoke, up: 0.1, speed: [2, 4], size: [0.5, 0.8], life: [0.6, 1], drag: 3, grow: true })
      }
      b.age += dt

      // Main bolt and forks: blinding on the strike, flickering as it decays.
      const env = Math.exp(-b.age * 15) * (0.75 + Math.random() * 0.4)
      if (env > 0.04) {
        path(buf, b.main, 0, MAIN_N, 0.5, env, 0.35)
        for (let i = 0; i < b.nb; i++) path(buf, b.branches, i * (BRANCH_N + 1), BRANCH_N, 0.22, env * 0.6, 0.7)
      }
      glowI = Math.max(glowI, env * 2.2 + (b.t < CRACKLE ? 0.25 : 0))

      // A thin arc from the caster's hands to the target in the first instant.
      if (b.t < 0.32) {
        b.handT += dt
        if (b.handT > 0.04) {
          b.handT = 0
          zigzag(b.handPts, 0, HAND_N, b.hand.x, b.hand.y, b.hand.z, centre.x, centre.y, centre.z, 0.12)
        }
        path(buf, b.handPts, 0, HAND_N, 0.09, 0.9 * (0.6 + Math.random() * 0.5), 0)
      }

      // Electricity crawling over the target (and along the ground) for a second or so.
      if (b.t < CRACKLE) {
        b.arcT += dt
        const r = tgt ? tgt.spec.radius * tgt.scale * 1.25 : 0.8
        const h = tgt ? tgt.spec.height * tgt.scale * 0.6 : 0.6
        if (b.arcT > 0.045) {
          b.arcT = 0
          for (let i = 0; i < MAX_ARCS; i++) {
            const a1 = Math.random() * Math.PI * 2, a2 = a1 + rand(1, 2.6)
            const y1 = rand(-1, 1), y2 = rand(-1, 1)
            if (i < MAX_ARCS - 2)
              zigzag(b.arcs, i * (ARC_N + 1), ARC_N, Math.cos(a1) * r, y1 * h, Math.sin(a1) * r, Math.cos(a2) * r, y2 * h, Math.sin(a2) * r, 0.3)
            else {
              // Ground arcs: from the body down to a point on the ground nearby.
              const gr = r + rand(0.6, 1.6)
              zigzag(b.arcs, i * (ARC_N + 1), ARC_N, Math.cos(a1) * r * 0.5, -h * 0.4, Math.sin(a1) * r * 0.5, Math.cos(a1) * gr, -centre.y + heightAt(centre.x + Math.cos(a1) * gr, centre.z + Math.sin(a1) * gr) + 0.05, Math.sin(a1) * gr, 0.28)
            }
          }
        }
        const fade = 1 - smooth((b.t - CRACKLE + 0.35) / 0.35)
        for (let i = 0; i < MAX_ARCS; i++) path(buf, b.arcs, i * (ARC_N + 1), ARC_N, 0.07, (0.5 + Math.random() * 0.7) * fade, 0.3, centre.x, centre.y, centre.z)
      }
      if (glow) glow.position.set(b.ground.x, b.ground.y + 0.06, b.ground.z)
    }

    geo.setDrawRange(0, buf.n * 6)
    if (buf.n) for (const name of RIBBON_ATTRS) (geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true
    glowMat.uniforms.uI.value = glowI
    if (glow) glow.visible = glowI > 0.02
  })

  return (
    <>
      <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />
      <mesh ref={glowRef} rotation={[-Math.PI / 2, 0, 0]} scale={7} visible={false} material={glowMat} renderOrder={4}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </>
  )
}

/* ---------- Boulder, car and shots ---------- */

interface ActiveFx {
  id: number
  spell: SpellId
  start: number
  dur: number
  from: THREE.Vector3
  at: THREE.Vector3
  dir: THREE.Vector3
  target: Animal | null
}

const FX_DUR: Partial<Record<SpellId, number>> = { rockDrop: 2.6, carRun: 1.8, gunShot: 0.8 }

/** A boulder (with its shadow growing underneath) falls on the target, flattens it and rolls off. */
function RockDrop({ fx }: { fx: ActiveFx }) {
  const rock = useRef<THREE.Mesh>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const landed = useRef(false)
  useFrame(({ clock }, dt) => {
    const r = rock.current, sh = shadow.current
    if (!r || !sh) return
    const t = clock.elapsedTime - fx.start
    const imp = IMPACT.rockDrop ?? 1.1
    const base = centreOf(fx.target, fx.at, tmpA, 0)
    const ground = base.y
    const rest = ground + (fx.target ? fx.target.spec.height * fx.target.scale * 0.25 : 0) + 0.75
    let y: number
    let ox = 0, oz = 0
    if (t < imp) {
      const k = t / imp
      y = THREE.MathUtils.lerp(ground + 24, rest, k * k)
    } else {
      const s = t - imp
      y = rest + Math.abs(Math.sin(s * 8)) * Math.exp(-s * 5) * 0.7
      // Once the flattened animal pops back up, the rock rolls off to the side.
      const roll = smooth((s - 0.85) / 0.6)
      ox = fx.dir.z * roll * 2.2
      oz = -fx.dir.x * roll * 2.2
      y = THREE.MathUtils.lerp(y, heightAt(base.x + ox, base.z + oz) + 0.7, roll)
      if (!landed.current) {
        landed.current = true
        burst({ count: 22, x: base.x, y: ground + 0.2, z: base.z, color: C.dust, shape: SHAPE.smoke, up: 0.1, speed: [2.5, 5], size: [0.5, 0.9], life: [0.6, 1], drag: 3, grow: true, spread: 0.6 })
        burst({ count: 12, x: base.x, y: ground + 0.6, z: base.z, color: C.debris, shape: SHAPE.shard, up: 0.6, speed: [3, 6], size: [0.15, 0.25], life: [0.5, 0.8], gravity: 16 })
      }
    }
    r.position.set(base.x + ox, y, base.z + oz)
    r.rotation.x += dt * (t < imp ? 3 : 1.5)
    r.rotation.z += dt * 2
    r.scale.setScalar(1 - smooth((t - (fx.dur - 0.35)) / 0.35))
    // The falling rock's shadow grows as it closes in.
    const k = THREE.MathUtils.clamp(t / imp, 0, 1)
    sh.visible = t < imp
    sh.position.set(base.x, ground + 0.05, base.z)
    sh.scale.setScalar(0.4 + k * 1.1)
    ;(sh.material as THREE.MeshBasicMaterial).opacity = 0.15 + k * 0.35
  })
  return (
    <>
      <mesh ref={rock} castShadow>
        <dodecahedronGeometry args={[0.85, 0]} />
        <meshStandardMaterial color="#7c7368" roughness={1} flatShading />
      </mesh>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.2} depthWrite={false} />
      </mesh>
    </>
  )
}

/** A little red car speeds across the line of sight, straight through the target, kicking up dust. */
function CarRun({ fx }: { fx: ActiveFx }) {
  const ref = useRef<THREE.Group>(null)
  const dust = useRef(0)
  useFrame(({ clock }, dt) => {
    const g = ref.current
    if (!g) return
    const t = clock.elapsedTime - fx.start
    const d = (t / fx.dur - 0.5) * 28
    const x = fx.at.x + fx.dir.x * d, z = fx.at.z + fx.dir.z * d
    g.position.set(x, heightAt(x, z) + 0.05, z)
    g.rotation.y = Math.atan2(fx.dir.x, fx.dir.z)
    g.rotation.z = Math.sin(t * 30) * 0.02
    dust.current += dt
    if (dust.current > 0.04) {
      dust.current = 0
      burst({ count: 1, x: x - fx.dir.x * 1.2, y: heightAt(x, z) + 0.2, z: z - fx.dir.z * 1.2, color: C.dust, shape: SHAPE.smoke, up: 0.6, speed: [0.3, 0.8], size: [0.4, 0.6], life: [0.5, 0.8], grow: true, drag: 1 })
    }
  })
  return (
    <group ref={ref}>
      <mesh castShadow position={[0, 0.45, 0]}>
        <boxGeometry args={[1, 0.5, 2]} />
        <meshStandardMaterial color="#e23b3b" roughness={0.45} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.85, -0.15]}>
        <boxGeometry args={[0.86, 0.4, 1.05]} />
        <meshStandardMaterial color="#9fd7ff" roughness={0.15} metalness={0.2} />
      </mesh>
      {[-0.45, 0.45].map((x) =>
        [-0.65, 0.65].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.24, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.24, 0.24, 0.16, 10]} />
            <meshStandardMaterial color="#1d1f26" roughness={0.9} />
          </mesh>
        )),
      )}
      {[-0.3, 0.3].map((x) => (
        <mesh key={x} position={[x, 0.5, 1.01]}>
          <boxGeometry args={[0.2, 0.1, 0.02]} />
          <meshBasicMaterial color={[3, 2.8, 2]} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

const SHOTS = [0, 0.15, 0.3]
const SHOT_TIME = 0.16

/** Three glowing shots from the caster's hands; each hit throws sparks. */
function GunShot({ fx }: { fx: ActiveFx }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const fired = useRef(0)
  const hits = useRef(0)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime - fx.start
    const hand = tmpB.set(fx.from.x + fx.dir.x * 0.5, fx.from.y + 1.25, fx.from.z + fx.dir.z * 0.5)
    const target = centreOf(fx.target, fx.at, tmpA)
    for (let i = 0; i < SHOTS.length; i++) {
      const m = refs.current[i]
      if (!m) continue
      const k = (t - SHOTS[i]) / SHOT_TIME
      m.visible = k >= 0 && k < 1
      if (m.visible) {
        m.position.lerpVectors(hand, target, k)
        m.lookAt(target)
      }
    }
    if (fired.current < SHOTS.length && t >= SHOTS[fired.current]) {
      fired.current++
      burst({ count: 8, x: hand.x, y: hand.y, z: hand.z, color: C.muzzle, hdr: 2.5, up: 0.2, speed: [1, 3], size: [0.12, 0.2], life: [0.08, 0.16] })
    }
    if (hits.current < SHOTS.length && t >= SHOTS[hits.current] + SHOT_TIME) {
      hits.current++
      burst({ count: 12, x: target.x, y: target.y, z: target.z, color: C.muzzle, color2: C.white, hdr: 2.6, up: 0.3, speed: [2, 5], size: [0.07, 0.12], life: [0.15, 0.35], gravity: 10 })
    }
  })
  return (
    <>
      {SHOTS.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          visible={false}
          rotation={[0, 0, 0]}
        >
          <capsuleGeometry args={[0.06, 0.5, 4, 8]} />
          <meshBasicMaterial color={[3, 2.4, 0.8]} toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}

/* ---------- Cast arrival bursts ---------- */

/** The moment a spell arrives: a burst matching it, at the target (or where it landed). */
function arrival(cast: CastEvent) {
  const p = centreOf(cast.target, cast.at, tmpA)
  const { x, y, z } = p
  // A little sparkle from the caster's hands for every cast.
  burst({ count: 10, x: cast.from.x, y: cast.from.y + 1.4, z: cast.from.z, color: C.gold, color2: C.white, hdr: 2, shape: SHAPE.star, up: 0.5, speed: [1, 2.5], size: [0.15, 0.25], life: [0.3, 0.5] })
  switch (cast.spell.id) {
    case 'bloom':
      burst({ count: 10, x, y, z, color: C.heart, shape: SHAPE.heart, up: 0.8, speed: [2, 3.5], size: [0.3, 0.45], life: [1, 1.5], gravity: -0.4, drag: 1.6, spread: 0.3 })
      burst({ count: 26, x, y, z, color: C.petal, color2: C.heart, up: 0.4, speed: [2, 5], size: [0.12, 0.22], life: [0.9, 1.4], gravity: 3, drag: 1.2, spread: 0.3 })
      break
    case 'shrink':
      burst({ count: 24, x, y, z, color: C.shrink, color2: C.white, hdr: 1.8, shape: SHAPE.star, up: 0.2, speed: [3, 5], size: [0.15, 0.25], life: [0.4, 0.6], drag: 5, spread: 1.2 })
      break
    case 'grow':
      burst({ count: 24, x, y, z, color: C.grow, color2: C.gold, hdr: 1.8, shape: SHAPE.star, up: 0.7, speed: [3, 6], size: [0.2, 0.32], life: [0.5, 0.9], drag: 2 })
      break
    case 'freeze':
      burst({ count: 30, x, y, z, color: C.ice, color2: C.iceDeep, hdr: 1.4, shape: SHAPE.smoke, up: 0.2, speed: [1.5, 3], size: [0.4, 0.7], life: [0.6, 1], drag: 2.5, grow: true, spread: 0.4 })
      burst({ count: 16, x, y, z, color: C.white, color2: C.ice, hdr: 2, shape: SHAPE.star, up: 0.5, speed: [2, 4], size: [0.15, 0.25], life: [0.4, 0.7], drag: 2 })
      break
    case 'bounce':
      burst({ count: 18, x, y: y - 0.3, z, color: C.gold, color2: C.white, hdr: 2, shape: SHAPE.star, up: 0.9, speed: [3, 6], size: [0.18, 0.28], life: [0.4, 0.7], gravity: 6 })
      break
  }
}

export function SpellFx() {
  const [fx, setFx] = useState<ActiveFx[]>([])
  const lastSeen = useRef(lastCast()?.n ?? 0)
  const idc = useRef(0)

  useFrame(({ clock }) => {
    const now = clock.elapsedTime
    const cast = drainCast(lastSeen.current)
    if (cast) {
      lastSeen.current = cast.n
      const id = cast.spell.id
      arrival(cast)
      if (id === 'lightning' || id === 'zap') triggerLightning(cast)
      const dur = FX_DUR[id]
      if (dur) {
        idc.current += 1
        const f: ActiveFx = { id: idc.current, spell: id, start: now, dur, from: cast.from.clone(), at: cast.at.clone(), dir: cast.dir.clone(), target: cast.target }
        setFx((list) => [...list, f])
      }
    }
    // Drop finished effects (state only changes when one ends, not every frame).
    for (const f of fx)
      if (now - f.start > f.dur) {
        setFx((list) => list.filter((g) => now - g.start <= g.dur))
        break
      }
  })

  return (
    <>
      <Particles />
      <Lightning />
      {fx.map((f) =>
        f.spell === 'rockDrop' ? <RockDrop key={f.id} fx={f} /> : f.spell === 'carRun' ? <CarRun key={f.id} fx={f} /> : <GunShot key={f.id} fx={f} />,
      )}
    </>
  )
}
