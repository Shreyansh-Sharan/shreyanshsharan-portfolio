// The countryside's dressing and small life: surf where the land meets the water, fences round the fields and
// dry-stone walls on the hills, scarecrows in the crops, butterflies by day and fireflies at night over the meadows,
// and pollen drifting on the wind. Everything is instanced or a single shader-driven draw; nothing allocates per
// frame. The low graphics tier gets fewer critters and no pollen.
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { REGIONS, WATER_LEVEL } from './regions'
import { heightAt, isNearPad, isOnRoad, isOnTrail, mulberry32 } from './terrain'
import { boxCollider, setExtraColliders, type Collider } from './colliders'
import { MISSIONS } from './missions'
import { daylight } from './clock'
import { player } from './Characters'
import { registerGroundCheck } from './Models'

const region = (id: string) => REGIONS.find((r) => r.id === id)!

/* ---------- Surf along the shore ---------- */

const FOAM_VERT = `
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING
  vPhase = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.11;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vPhase = 0.0;
  vec4 w = modelMatrix * vec4(position, 1.0);
#endif
  // A gentle swell lifts the foam as each wave rolls in.
  w.y += sin(uTime * 1.1 + vPhase) * 0.05;
  gl_Position = projectionMatrix * viewMatrix * w;
}`
const FOAM_FRAG = `
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
void main() {
  // Bands of foam roll in towards the shore (v = 1) and fade at the ends of each strip.
  float wave = sin(vUv.y * 9.0 - uTime * 1.6 + vPhase) * 0.5 + 0.5;
  float lap = smoothstep(0.35, 1.0, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  float ends = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  float a = (wave * wave * 0.6 + lap * 0.65) * ends * (0.75 + 0.25 * sin(uTime * 0.8 + vPhase * 3.0));
  gl_FragColor = vec4(vec3(0.94, 0.98, 1.0), min(1.0, a * 0.95));
}`

/** Shoreline points every few metres, each with the direction towards land. */
function shoreline() {
  const out: { x: number; z: number; yaw: number }[] = []
  const step = 5
  for (let x = -560; x <= 560; x += step)
    for (let z = -560; z <= 560; z += step) {
      const h = heightAt(x, z)
      if (h < WATER_LEVEL - 0.6 || h > WATER_LEVEL + 0.25) continue
      const gx = heightAt(x + 2, z) - heightAt(x - 2, z), gz = heightAt(x, z + 2) - heightAt(x, z - 2)
      const g = Math.hypot(gx, gz)
      if (g < 0.05) continue
      // The strip lies across the slope, its "v" running up towards the land.
      out.push({ x, z, yaw: Math.atan2(gx, gz) })
    }
  return out
}

function Surf() {
  const time = useMemo(() => ({ value: 0 }), [])
  const mesh = useMemo(() => {
    const pts = shoreline()
    const geo = new THREE.PlaneGeometry(7, 4)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({ vertexShader: FOAM_VERT, fragmentShader: FOAM_FRAG, uniforms: { uTime: time }, transparent: true, depthWrite: false })
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length))
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1)
    pts.forEach((p, i) => {
      // Sit just above the water and step half a strip out to sea.
      const off = 1.2
      v.set(p.x - Math.sin(p.yaw) * off, WATER_LEVEL + 0.04, p.z - Math.cos(p.yaw) * off)
      im.setMatrixAt(i, m.compose(v, q.setFromEuler(e.set(0, p.yaw + Math.PI, 0)), sc.set(1 + ((i * 7) % 5) * 0.08, 1, 1)))
    })
    im.count = pts.length
    im.computeBoundingSphere()
    im.renderOrder = 2
    return im
  }, [time])
  useFrame(({ clock }) => {
    time.value = clock.elapsedTime
  })
  return <primitive object={mesh} />
}

/* ---------- Fences round the fields, dry-stone walls on the hills ---------- */

const WOOD = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 0.9 })
const STONE = new THREE.MeshStandardMaterial({ color: '#9b958a', roughness: 0.95, flatShading: true })

type Segment = { ax: number; az: number; bx: number; bz: number }

/** Is the whole run of a fence or wall clear of roads, paths, pads and mission spots? */
function clearRun(s: Segment) {
  const n = Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / 2)
  for (let i = 0; i <= n; i++) {
    const x = s.ax + ((s.bx - s.ax) * i) / n, z = s.az + ((s.bz - s.az) * i) / n
    if (heightAt(x, z) < WATER_LEVEL + 1.2 || isOnRoad(x, z, 2) || isOnTrail(x, z, 1) || isNearPad(x, z, 1)) return false
    if (MISSIONS.some((m) => Math.hypot(m.x - x, m.z - z) < 8)) return false
  }
  return true
}

function fenceRuns(): Segment[] {
  const r = region('plains')
  const out: Segment[] = []
  const rnd = mulberry32(611)
  // The plains' field grid is 15 m x 11 m cells (see terrain.ts): fence some of the field edges.
  for (let cx = Math.floor((r.center[0] - 80 + 1000) / 15); cx * 15 - 1000 < r.center[0] + 80; cx++)
    for (let cz = Math.floor((r.center[1] - 80 + 1000) / 11); cz * 11 - 1000 < r.center[1] + 80; cz++) {
      const x0 = cx * 15 - 1000, z0 = cz * 11 - 1000
      if (Math.hypot(x0 + 7.5 - r.center[0], z0 + 5.5 - r.center[1]) > 72 || Math.hypot(x0 + 7.5 - r.center[0], z0 + 5.5 - r.center[1]) < 22) continue
      if (rnd() < 0.4) out.push({ ax: x0, az: z0, bx: x0 + 15, bz: z0 })
      if (rnd() < 0.3) out.push({ ax: x0, az: z0, bx: x0, bz: z0 + 11 })
    }
  return out.filter(clearRun)
}

function wallRuns(): Segment[] {
  const out: Segment[] = []
  const rnd = mulberry32(733)
  for (const id of ['highland', 'ridge', 'hub', 'campus']) {
    const r = region(id)
    for (let i = 0, n = 0; i < 80 && n < (id === 'highland' ? 9 : 4); i++) {
      const a = rnd() * Math.PI * 2, d = r.radius * (0.75 + rnd() * 0.5)
      const x = r.center[0] + Math.cos(a) * d, z = r.center[1] + Math.sin(a) * d
      const dir = a + Math.PI / 2 + (rnd() - 0.5) * 0.6, len = 14 + rnd() * 18
      const s = { ax: x, az: z, bx: x + Math.cos(dir) * len, bz: z + Math.sin(dir) * len }
      if (clearRun(s)) {
        out.push(s)
        n++
      }
    }
  }
  return out
}

function Fences() {
  const { posts, rails, stones, colliders, checks } = useMemo(() => {
    const fence = fenceRuns()
    const walls = wallRuns()
    const postM: THREE.Matrix4[] = [], railM: THREE.Matrix4[] = [], stoneM: THREE.Matrix4[] = []
    const colliders: Collider[] = []
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3()
    const rnd = mulberry32(97)
    for (const s of fence) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az), yaw = Math.atan2(s.bx - s.ax, s.bz - s.az)
      const n = Math.max(1, Math.round(len / 2.5))
      for (let i = 0; i <= n; i++) {
        const x = s.ax + ((s.bx - s.ax) * i) / n, z = s.az + ((s.bz - s.az) * i) / n
        postM.push(m.compose(v.set(x, heightAt(x, z) - 0.2, z), q.setFromEuler(e.set(0, yaw, (rnd() - 0.5) * 0.06)), sc.set(1, 1, 1)).clone())
        if (i < n) {
          const x2 = s.ax + ((s.bx - s.ax) * (i + 0.5)) / n, z2 = s.az + ((s.bz - s.az) * (i + 0.5)) / n
          const y = heightAt(x2, z2)
          for (const ry of [0.45, 0.85]) railM.push(m.compose(v.set(x2, y + ry, z2), q.setFromEuler(e.set(0, yaw, 0)), sc.set(1, 1, len / n)).clone())
        }
      }
      colliders.push(boxCollider((s.ax + s.bx) / 2, (s.az + s.bz) / 2, 0.15, len / 2, yaw, heightAt((s.ax + s.bx) / 2, (s.az + s.bz) / 2) + 1.05))
    }
    for (const s of walls) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az), yaw = Math.atan2(s.bx - s.ax, s.bz - s.az)
      const n = Math.round(len / 0.7)
      for (let i = 0; i <= n; i++) {
        const x = s.ax + ((s.bx - s.ax) * i) / n, z = s.az + ((s.bz - s.az) * i) / n
        const g = Math.min(heightAt(x, z), heightAt(x + 0.4, z), heightAt(x - 0.4, z), heightAt(x, z + 0.4), heightAt(x, z - 0.4))
        for (let k = 0; k < 2; k++) {
          const s2 = 0.45 + rnd() * 0.25
          stoneM.push(m.compose(v.set(x + (rnd() - 0.5) * 0.2, g - 0.12 + k * 0.42, z + (rnd() - 0.5) * 0.2), q.setFromEuler(e.set(rnd(), rnd() * 6, rnd())), sc.set(s2 * 1.3, s2, s2)).clone())
        }
      }
      colliders.push(boxCollider((s.ax + s.bx) / 2, (s.az + s.bz) / 2, 0.45, len / 2, yaw, heightAt((s.ax + s.bx) / 2, (s.az + s.bz) / 2) + 0.95))
    }
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
      list.forEach((mm, i) => im.setMatrixAt(i, mm))
      im.count = list.length
      im.castShadow = true
      im.receiveShadow = true
      im.computeBoundingSphere()
      return im
    }
    const postGeo = new THREE.BoxGeometry(0.14, 1.3, 0.14)
    postGeo.translate(0, 0.65, 0)
    const railGeo = new THREE.BoxGeometry(0.07, 0.11, 1)
    const stoneGeo = new THREE.DodecahedronGeometry(0.42, 0)
    // Grounding: every post's foot, every bottom stone.
    const checks = () => {
      const bad: { name: string; region: string; float: number; buried: number }[] = []
      for (const p of postM) {
        const x = p.elements[12], y = p.elements[13], z = p.elements[14]
        if (y - heightAt(x, z) > 0.15) bad.push({ name: 'fence-post', region: `fence@${x.toFixed(0)},${z.toFixed(0)}`, float: +(y - heightAt(x, z)).toFixed(2), buried: 0 })
      }
      for (let i = 0; i < stoneM.length; i += 2) {
        const p = stoneM[i]
        const x = p.elements[12], z = p.elements[14]
        const base = p.elements[13] - 0.42 * new THREE.Vector3().setFromMatrixScale(p).y * 0.8
        if (base - heightAt(x, z) > 0.15) bad.push({ name: 'wall-stone', region: `wall@${x.toFixed(0)},${z.toFixed(0)}`, float: +(base - heightAt(x, z)).toFixed(2), buried: 0 })
      }
      return { checked: postM.length + stoneM.length / 2, bad }
    }
    return { posts: make(postGeo, WOOD, postM), rails: make(railGeo, WOOD, railM), stones: make(stoneGeo, STONE, stoneM), colliders, checks }
  }, [])
  useEffect(() => {
    setExtraColliders('fences', colliders)
    registerGroundCheck('fences', checks)
    return () => {
      setExtraColliders('fences', [])
      registerGroundCheck('fences', null)
    }
  }, [colliders, checks])
  return (
    <>
      <primitive object={posts} />
      <primitive object={rails} />
      <primitive object={stones} />
      <Scarecrows />
    </>
  )
}

/* ---------- Scarecrows ---------- */

const SACK = new THREE.MeshStandardMaterial({ color: '#d9c08a', roughness: 1 })
const SHIRT = new THREE.MeshStandardMaterial({ color: '#b5452f', roughness: 0.95 })
const HAT = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.95 })

function Scarecrow({ x, z, yaw }: { x: number; z: number; yaw: number }) {
  const y = Math.min(heightAt(x, z), heightAt(x + 0.3, z), heightAt(x, z + 0.3)) - 0.2
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 1.2, 0]} material={WOOD} castShadow>
        <boxGeometry args={[0.12, 2.4, 0.12]} />
      </mesh>
      <mesh position={[0, 1.75, 0]} material={WOOD} castShadow>
        <boxGeometry args={[1.8, 0.1, 0.1]} />
      </mesh>
      <mesh position={[0, 1.55, 0]} material={SHIRT} castShadow>
        <boxGeometry args={[0.7, 0.8, 0.32]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.62, 1.75, 0]} material={SHIRT} castShadow>
          <boxGeometry args={[0.55, 0.22, 0.24]} />
        </mesh>
      ))}
      <mesh position={[0, 2.2, 0]} material={SACK} castShadow>
        <sphereGeometry args={[0.24, 10, 8]} />
      </mesh>
      <mesh position={[0, 2.42, 0]} material={HAT} castShadow>
        <cylinderGeometry args={[0.36, 0.4, 0.05, 12]} />
      </mesh>
      <mesh position={[0, 2.55, 0]} material={HAT} castShadow>
        <cylinderGeometry args={[0.15, 0.2, 0.26, 10]} />
      </mesh>
    </group>
  )
}

function Scarecrows() {
  const r = region('plains')
  const spots = useMemo(() => {
    const out: { x: number; z: number; yaw: number }[] = []
    for (const [dx, dz, yaw] of [[34, -26, 0.4], [-40, 30, 2.2], [52, 34, -1]] as [number, number, number][]) {
      const x = r.center[0] + dx, z = r.center[1] + dz
      if (!isOnRoad(x, z, 3) && !isNearPad(x, z, 2) && !isOnTrail(x, z, 1)) out.push({ x, z, yaw })
    }
    return out
  }, [r])
  return (
    <>
      {spots.map((s, i) => (
        <Scarecrow key={i} {...s} />
      ))}
    </>
  )
}

/* ---------- Butterflies by day, fireflies at night ---------- */

const MEADOW_BIOMES = new Set(['harbour', 'highland', 'keep', 'temple', 'cove', 'plains', 'arcade'])

function meadowAt(x: number, z: number) {
  const h = heightAt(x, z)
  if (h < WATER_LEVEL + 1.2 || isOnRoad(x, z, 1)) return false
  let best: { biome: string; k: number } | null = null
  for (const r of REGIONS) {
    const k = Math.hypot(x - r.center[0], z - r.center[1]) / r.radius
    if (k < 1.2 && (!best || k < best.k)) best = { biome: r.biome, k }
  }
  return !best || MEADOW_BIOMES.has(best.biome)
}

function Critters({ count }: { count: number }) {
  const state = useMemo(
    () => Array.from({ length: count }, (_, i) => ({ x: 0, z: 0, y: 0, ok: false, phase: i * 1.37, hue: i % 4 })),
    [count],
  )
  const fly = useMemo(() => {
    // A butterfly: two wing quads hinged on the body (the flap is a scale on x).
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, -0.16, 0, 0.12, -0.14, 0, -0.08, 0, 0, 0.08, -0.14, 0, -0.08, 0, 0, -0.06, 0, 0, 0.08, 0, 0, -0.06, 0.14, 0, -0.08, 0, 0, 0.08, 0.14, 0, -0.08, 0.16, 0, 0.12], 3))
    g.computeVertexNormals()
    return g
  }, [])
  const butterflyMesh = useMemo(() => {
    const im = new THREE.InstancedMesh(fly, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), count)
    im.frustumCulled = false
    const colours = ['#ffb347', '#ffffff', '#8fd3ff', '#ff7eb6'].map((c) => new THREE.Color(c))
    for (let i = 0; i < count; i++) im.setColorAt(i, colours[i % colours.length])
    return im
  }, [fly, count])
  const fireflyMesh = useMemo(() => {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: '#e9ff8a', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), count)
    im.frustumCulled = false
    return im
  }, [count])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const e = useMemo(() => new THREE.Euler(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const sc = useMemo(() => new THREE.Vector3(), [])
  const rnd = useMemo(() => mulberry32(41), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const day = daylight()
    butterflyMesh.visible = day > 0.4
    fireflyMesh.visible = day < 0.5
    const px = player.pos.x, pz = player.pos.z
    for (let i = 0; i < count; i++) {
      const c = state[i]
      // Re-seed critters that fell behind (or never found a meadow) somewhere near the player.
      if (!c.ok || Math.hypot(c.x - px, c.z - pz) > 34) {
        const a = rnd() * Math.PI * 2, d = 6 + rnd() * 26
        c.x = px + Math.cos(a) * d
        c.z = pz + Math.sin(a) * d
        c.ok = meadowAt(c.x, c.z)
        c.y = heightAt(c.x, c.z)
      }
      const ph = c.phase
      const wx = c.x + Math.sin(t * 0.35 + ph) * 2.2, wz = c.z + Math.cos(t * 0.29 + ph * 1.3) * 2.2
      if (!c.ok) {
        m.makeScale(0, 0, 0)
        butterflyMesh.setMatrixAt(i, m)
        fireflyMesh.setMatrixAt(i, m)
        continue
      }
      const flap = 0.25 + Math.abs(Math.sin(t * 14 + ph * 7))
      m.compose(v.set(wx, c.y + 0.8 + Math.sin(t * 1.7 + ph) * 0.4, wz), q.setFromEuler(e.set(0, t * 0.35 + ph, 0)), sc.set(flap, 1, 1))
      butterflyMesh.setMatrixAt(i, m)
      const glow = Math.max(0, Math.sin(t * 2.1 + ph * 3)) * (1 - day)
      m.compose(v.set(wx, c.y + 0.6 + Math.sin(t * 0.9 + ph) * 0.9 + 0.8, wz), q.identity(), sc.setScalar(0.4 + glow * 1.4))
      fireflyMesh.setMatrixAt(i, m)
    }
    butterflyMesh.instanceMatrix.needsUpdate = true
    fireflyMesh.instanceMatrix.needsUpdate = true
  })
  return (
    <>
      <primitive object={butterflyMesh} />
      <primitive object={fireflyMesh} />
    </>
  )
}

/* ---------- Pollen and leaves on the wind ---------- */

const MOTE_VERT = `
uniform float uTime;
uniform vec3 uCam;
attribute float aSeed;
varying float vSeed;
void main() {
  vSeed = aSeed;
  // Drift with the wind and wrap inside a 60 m box around the camera.
  vec3 p = position + vec3(uTime * 0.9, sin(uTime * 0.6 + aSeed * 6.0) * 0.6, uTime * 0.35);
  vec3 box = vec3(60.0, 16.0, 60.0);
  p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (aSeed > 0.85 ? 90.0 : 45.0) / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const MOTE_FRAG = `
uniform float uDay;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(c));
  // Mostly pale pollen; a few drifting leaves.
  vec3 col = vSeed > 0.85 ? vec3(0.85, 0.55, 0.2) : vec3(1.0, 0.97, 0.75);
  gl_FragColor = vec4(col, a * 0.65 * uDay);
}`

function Motes() {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uDay: { value: 1 } }), [])
  const points = useMemo(() => {
    const n = 420
    const rnd = mulberry32(5)
    const pos = new Float32Array(n * 3), seed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      pos.set([rnd() * 60, rnd() * 16 - 2, rnd() * 60], i * 3)
      seed[i] = rnd()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    const p = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms, transparent: true, depthWrite: false }))
    p.frustumCulled = false
    return p
  }, [uniforms])
  useFrame(({ clock, camera }) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uCam.value.set(camera.position.x, player.pos.y + 4, camera.position.z)
    // Over the city and high in the air there is nothing drifting about.
    const r = region('neon')
    const inCity = Math.hypot(camera.position.x - r.center[0], camera.position.z - r.center[1]) < r.radius
    uniforms.uDay.value = inCity || camera.position.y - player.ground > 40 ? 0 : 0.35 + 0.65 * daylight()
  })
  return <primitive object={points} />
}

export function Countryside({ light, playing }: { light: boolean; playing: boolean }) {
  return (
    <>
      <Surf />
      <Fences />
      {playing && <Critters count={light ? 14 : 36} />}
      {playing && !light && <Motes />}
    </>
  )
}
