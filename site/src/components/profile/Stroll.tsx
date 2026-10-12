// The profile's 3D stage: the low-poly avatar strolling down a street that changes with each district. Scrolling
// walks him towards the viewer (the street slides away under him); when a section settles he crosses to the side
// opposite its text, turns to face it and does that section's move.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Sky, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { DISTRICTS, isScrolling, stroll, type Move } from './strollState'
import { Scenery } from './Scenery'

const base = import.meta.env.BASE_URL
const MODEL = `${base}profile/lowpoly.glb`
const SNAP = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('snap')

/** Which clip in the GLB plays each move. */
const CLIP_NAMES: Record<Move, RegExp> = {
  idle: /\|Idle\|/,
  walk: /Casual_Walk/,
  run: /RunFast/,
  jump: /Regular_Jump/,
  spell: /Charged_Spell_Cast/,
  wave: /Big_Wave_Hello/,
  swing: /golf_drive/,
  dance: /All_Night_Dance/,
  flip: /Backflip/,
  cheer: /Victory_Cheer/,
  talk: /Talk_with_Hands_Open/,
}
const ONCE = new Set<Move>(['jump', 'spell', 'wave', 'swing', 'flip', 'cheer'])
const WALK_SPEED = 1.3 // m/s, matches the walk cycle's stride
const CROSS_SPEED = 1.7
/** Seconds between repeats of a section's move. */
const REST = 3.2
const ROAD_LEN = 40
const LAMP_GAP = 5
const LAMP_SPAN = 30

const tmpColor = new THREE.Color()

function findBone(root: THREE.Object3D, name: string) {
  let bone: THREE.Object3D | null = null
  root.traverse((o) => {
    if (!bone && (o as THREE.Bone).isBone && o.name === name) bone = o
  })
  return bone as THREE.Object3D | null
}

/** Ease a colour towards a target at a frame-rate independent rate. */
function towards(c: THREE.Color, hex: string, k: number) {
  c.lerp(tmpColor.set(hex), k)
}

/** How far across the street he stands for the current viewport (0 on narrow screens, where text sits below him). */
function sideOffset(camera: THREE.PerspectiveCamera, aspect: number) {
  if (aspect < 0.95) return 0
  const dist = camera.position.length()
  const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  return Math.min(h * aspect * 0.23, 2.6)
}

function Rig() {
  const { camera, size } = useThree()
  const look = useMemo(() => ({ base: new THREE.Vector3(), at: new THREE.Vector3(), px: 0, py: 0, x: 0, y: 0 }), [])
  useEffect(() => {
    // Phones frame him in the top half (the cards scroll up underneath); wide screens put him beside the text.
    const narrow = size.width / size.height < 0.95
    look.base.set(0, narrow ? 1.5 : 1.4, narrow ? 6.6 : 5.6)
    look.at.set(0, narrow ? 0.15 : 0.98, 0)
    const onMove = (e: PointerEvent) => {
      look.px = (e.clientX / window.innerWidth) * 2 - 1
      look.py = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [size, look])
  // A gentle parallax with the pointer, so the street reads as a real 3D set.
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-3 * Math.min(dt, 0.05))
    look.x += (look.px - look.x) * k
    look.y += (look.py - look.y) * k
    camera.position.set(look.base.x + look.x * 0.45, look.base.y - look.y * 0.18, look.base.z)
    camera.lookAt(look.at)
  })
  return null
}

function Walker() {
  const gltf = useGLTF(MODEL, false, true)
  const { camera, size } = useThree()
  const group = useRef<THREE.Group>(null)
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf])
  const st = useMemo(
    () => ({
      cur: null as Move | null,
      action: null as THREE.AnimationAction | null,
      finished: false,
      mode: '' as '' | 'cross' | 'forward' | 'pose',
      stage: 'act' as 'act' | 'rest',
      wait: 0,
      override: null as Move | null,
      greeted: false,
      placed: false,
      x: 0,
      rotY: 0,
      ringT: -1,
    }),
    [],
  )
  if (SNAP) (window as unknown as { __stroll: unknown }).__stroll = { st, stroll, mixer }

  const clips = useMemo(() => {
    const out: Partial<Record<Move, THREE.AnimationClip>> = {}
    for (const [m, re] of Object.entries(CLIP_NAMES) as [Move, RegExp][]) {
      const c = gltf.animations.find((a) => re.test(a.name))
      if (c) out[m] = c
    }
    return out
  }, [gltf])

  // Flat-shaded facets, plus the spell orb in his right hand and the shockwave ring.
  const fx = useMemo(() => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.frustumCulled = false
        const mat = m.material as THREE.MeshStandardMaterial
        mat.flatShading = true
        mat.metalness = 0
        mat.roughness = 0.85
        mat.needsUpdate = true
      }
    })
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0),
      new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    const light = new THREE.PointLight('#a78bfa', 0, 3)
    orb.add(light)
    orb.visible = false
    const hand = findBone(gltf.scene, 'RightHand')
    if (hand) {
      gltf.scene.updateMatrixWorld(true)
      const s = hand.getWorldScale(new THREE.Vector3())
      orb.userData.base = 1 / s.x
      orb.position.set(0, 0.1 / s.x, 0)
      hand.add(orb)
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#c4b5fd', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    const hips = findBone(gltf.scene, 'Hips')
    return { orb, light, ring, hips: hips ? { bone: hips, rest: hips.position.clone() } : null }
  }, [gltf])

  useEffect(() => {
    const done = (e: { action: THREE.AnimationAction }) => {
      if (e.action === st.action) st.finished = true
    }
    mixer.addEventListener('finished', done)
    return () => {
      mixer.removeEventListener('finished', done)
      mixer.stopAllAction()
    }
  }, [mixer, st])

  function play(m: Move, again = false) {
    if (st.cur === m && !again) return
    const clip = clips[m] ?? clips.idle
    if (!clip) return
    const next = mixer.clipAction(clip)
    const prev = st.action
    next.reset()
    next.setLoop(ONCE.has(m) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = true
    next.setEffectiveWeight(1).play()
    if (prev && prev !== next) next.crossFadeFrom(prev, 0.3, false)
    st.cur = m
    st.action = next
    st.finished = false
    if (m === 'cheer') stroll.burst++
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = group.current
    if (!g) return
    const d = DISTRICTS[stroll.active]
    const target = d.side * sideOffset(camera as THREE.PerspectiveCamera, size.width / size.height)
    if (!st.placed) {
      st.x = target
      st.placed = true
    }
    const dx = target - st.x
    const mode = Math.abs(dx) > 0.04 ? 'cross' : isScrolling() ? 'forward' : 'pose'
    if (mode !== st.mode) {
      st.mode = mode
      st.stage = 'act'
      st.wait = 0
      if (mode !== 'pose') st.override = null
    }
    if (stroll.request) {
      if (mode === 'pose') {
        st.override = stroll.request
        play(stroll.request, true)
      }
      stroll.request = null
    }

    let face = 0 // towards the viewer
    let tread = 0
    if (mode === 'cross') {
      // Walk sideways across the street to the side opposite the text.
      play('walk')
      face = Math.sign(dx) * (Math.PI / 2)
      st.x += Math.sign(dx) * Math.min(Math.abs(dx), CROSS_SPEED * dt)
    } else if (mode === 'forward') {
      play('walk')
      tread = WALK_SPEED
    } else {
      // Settled: turn three-quarters towards the text and do the section's move.
      face = -d.side * 0.7
      if (st.override) {
        // A requested move plays out, then the section's routine picks up again.
        if (st.finished) st.override = null
      } else if (d.move === 'walk') {
        // The overview keeps him walking; he waves the first time he arrives.
        if (!st.greeted) {
          st.greeted = true
          st.override = 'wave'
          play('wave', true)
        } else {
          play('walk')
          tread = WALK_SPEED * 0.8
          face = -d.side * 0.35
        }
      } else if (!ONCE.has(d.move)) {
        play(d.move)
      } else if (st.stage === 'act') {
        if (st.cur !== d.move) play(d.move, true)
        else if (st.finished) {
          st.stage = 'rest'
          st.wait = REST
          play(d.rest)
        }
      } else {
        st.wait -= dt
        if (st.wait <= 0) {
          st.stage = 'act'
          play(d.move, true)
        }
      }
    }
    stroll.speed = THREE.MathUtils.damp(stroll.speed, tread, 6, dt)
    stroll.x = st.x

    // Shortest-way turn towards the facing.
    let diff = face - st.rotY
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    st.rotY += diff * (1 - Math.exp(-9 * dt))
    g.position.x = st.x
    g.rotation.y = st.rotY

    mixer.update(dt)
    // Keep him on his spot: the clips' sideways hip drift is capped (vertical motion is untouched).
    if (fx.hips) {
      const h = fx.hips
      const lim = 8 // cm, the rig's units
      h.bone.position.x = h.rest.x + THREE.MathUtils.clamp(h.bone.position.x - h.rest.x, -lim, lim)
      h.bone.position.z = h.rest.z + THREE.MathUtils.clamp(h.bone.position.z - h.rest.z, -lim, lim)
    }

    // Spell: the orb charges in his hand, then a shockwave rolls across the street.
    const a = st.action
    if (st.cur === 'spell' && a && a.isRunning()) {
      const p = a.time / a.getClip().duration
      const charge = THREE.MathUtils.smoothstep(p, 0.08, 0.55)
      fx.orb.visible = p > 0.05 && p < 0.72
      fx.orb.scale.setScalar((fx.orb.userData.base ?? 1) * (0.3 + charge * 1.4 + Math.sin(p * 60) * 0.05))
      fx.orb.rotation.y += dt * 6
      fx.light.intensity = charge * 8
      if (p >= 0.62 && st.ringT < 0) st.ringT = 0
    } else {
      fx.orb.visible = false
      fx.light.intensity = 0
    }
    fx.ring.position.x = st.x
    if (st.ringT >= 0) {
      st.ringT += dt
      const r = st.ringT / 0.9
      fx.ring.scale.setScalar(0.2 + r * 3)
      ;(fx.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - r))
      if (r >= 1) st.ringT = -1
    }
  })

  return (
    <>
      <group ref={group}>
        <primitive object={gltf.scene} />
      </group>
      <primitive object={fx.ring} />
    </>
  )
}

function fadeTexture() {
  // Opaque near the viewer, fading out towards the horizon so the street melts into the backdrop.
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#000')
  grad.addColorStop(0.45, '#000')
  grad.addColorStop(0.75, '#fff')
  grad.addColorStop(1, '#fff')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 4, 256)
  const t = new THREE.CanvasTexture(c)
  return t
}

function markingsTexture() {
  // One 8 m tile: two centre dashes and the edge lines.
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(124, 20, 8, 80)
  ctx.fillRect(124, 148, 8, 80)
  ctx.fillRect(10, 0, 5, 256)
  ctx.fillRect(241, 0, 5, 256)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1, ROAD_LEN / 8)
  t.anisotropy = 4
  return t
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.3)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/** The street: road, pavements, lamp posts and a glow under his feet, all tinted per district. */
function Street() {
  const { scene } = useThree()
  const parts = useMemo(() => {
    const fade = fadeTexture()
    const marks = markingsTexture()
    const road = new THREE.MeshStandardMaterial({ color: DISTRICTS[0].road, alphaMap: fade, transparent: true, roughness: 0.95, depthWrite: false })
    const walk = new THREE.MeshStandardMaterial({ color: DISTRICTS[0].walk, alphaMap: fade, transparent: true, roughness: 0.9, depthWrite: false })
    const line = new THREE.MeshBasicMaterial({ color: DISTRICTS[0].line, map: marks, alphaMap: fade, transparent: true, depthWrite: false })
    const pole = new THREE.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.6, flatShading: true })
    const head = new THREE.MeshBasicMaterial({ color: DISTRICTS[0].lamp })
    const glow = new THREE.MeshBasicMaterial({ map: glowTexture(), color: DISTRICTS[0].lamp, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6)
    const armGeo = new THREE.BoxGeometry(0.6, 0.06, 0.06)
    const headGeo = new THREE.IcosahedronGeometry(0.16, 0)
    const lamps: THREE.Group[] = []
    for (let i = 0; i < (LAMP_SPAN / LAMP_GAP) * 2; i++) {
      const side = i % 2 ? 1 : -1
      const lamp = new THREE.Group()
      const p = new THREE.Mesh(poleGeo, pole)
      p.position.y = 1.6
      p.castShadow = false
      const arm = new THREE.Mesh(armGeo, pole)
      arm.position.set(-side * 0.28, 3.15, 0)
      const h = new THREE.Mesh(headGeo, head)
      h.position.set(-side * 0.55, 3.05, 0)
      lamp.add(p, arm, h)
      lamp.position.set(side * 3.7, 0, 3 - Math.floor(i / 2) * LAMP_GAP - (side > 0 ? LAMP_GAP / 2 : 0))
      lamps.push(lamp)
    }
    return { road, walk, line, head, glow, marks, lamps }
  }, [])
  const glowRef = useRef<THREE.Mesh>(null)

  useEffect(() => {
    scene.fog = new THREE.Fog(DISTRICTS[0].fog, 16, 75)
    return () => {
      scene.fog = null
    }
  }, [scene])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const d = DISTRICTS[stroll.active]
    const k = 1 - Math.exp(-2.5 * dt)
    towards(parts.road.color, d.road, k)
    towards(parts.walk.color, d.walk, k)
    towards(parts.line.color, d.line, k)
    towards(parts.head.color, d.lamp, k)
    towards(parts.glow.color, d.lamp, k)
    if (scene.fog) towards((scene.fog as THREE.Fog).color, d.fog, k)
    // The street slides away from the viewer while he walks towards them.
    const step = stroll.speed * dt
    parts.marks.offset.y -= step / 8
    for (const l of parts.lamps) {
      l.position.z -= step
      if (l.position.z < 3 - LAMP_SPAN) l.position.z += LAMP_SPAN
      // Lamps rise out of the haze at the far end instead of popping in.
      const far = THREE.MathUtils.smoothstep(l.position.z, 3 - LAMP_SPAN, 3 - LAMP_SPAN + 6)
      l.scale.setScalar(Math.max(0.001, far))
    }
    if (glowRef.current) glowRef.current.position.x = stroll.x
  })

  const roadZ = 3 - ROAD_LEN / 2
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, roadZ]} material={parts.walk} renderOrder={0}>
        <planeGeometry args={[12, ROAD_LEN]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, roadZ]} material={parts.road} renderOrder={1} receiveShadow>
        <planeGeometry args={[6, ROAD_LEN]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, roadZ]} material={parts.line} renderOrder={2}>
        <planeGeometry args={[6, ROAD_LEN]} />
      </mesh>
      <mesh ref={glowRef} rotation-x={-Math.PI / 2} position={[0, 0.015, 0]} material={parts.glow} renderOrder={3}>
        <planeGeometry args={[2.2, 2.2]} />
      </mesh>
      {parts.lamps.map((l, i) => (
        <primitive key={i} object={l} />
      ))}
    </group>
  )
}

/** Gold and silver confetti when he cheers at the trophy plaza. */
function Confetti() {
  const N = 180
  const mesh = useRef<THREE.InstancedMesh>(null)
  const sim = useMemo(() => {
    const p = new Float32Array(N * 3)
    const v = new Float32Array(N * 3)
    const r = new Float32Array(N * 3)
    return { p, v, r, burst: stroll.burst, life: 0 }
  }, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    const m = mesh.current
    if (!m) return
    const palette = ['#ffd257', '#fff4c2', '#c9d6ff', '#ff7ab6', '#7cf1ff']
    for (let i = 0; i < N; i++) m.setColorAt(i, new THREE.Color(palette[i % palette.length]))
    m.instanceColor!.needsUpdate = true
    m.count = 0
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const m = mesh.current
    if (!m) return
    const { p, v, r } = sim
    if (stroll.burst !== sim.burst) {
      sim.burst = stroll.burst
      sim.life = 4
      for (let i = 0; i < N; i++) {
        p[i * 3] = stroll.x + (Math.random() - 0.5) * 0.6
        p[i * 3 + 1] = 1.9
        p[i * 3 + 2] = (Math.random() - 0.5) * 0.6
        const a = Math.random() * Math.PI * 2
        const s = 1 + Math.random() * 2.2
        v[i * 3] = Math.cos(a) * s
        v[i * 3 + 1] = 3 + Math.random() * 3
        v[i * 3 + 2] = Math.sin(a) * s
        r[i * 3] = Math.random() * 6
        r[i * 3 + 1] = Math.random() * 6
        r[i * 3 + 2] = Math.random() * 6
      }
    }
    if (sim.life <= 0) {
      m.count = 0
      return
    }
    sim.life -= dt
    m.count = N
    for (let i = 0; i < N; i++) {
      v[i * 3 + 1] -= 6 * dt
      // Paper flutters: heavy drag once it's falling.
      const drag = v[i * 3 + 1] < 0 ? 3.5 : 0.6
      v[i * 3] *= Math.exp(-drag * dt)
      v[i * 3 + 1] = Math.max(v[i * 3 + 1], -1.2)
      v[i * 3 + 2] *= Math.exp(-drag * dt)
      p[i * 3] += v[i * 3] * dt
      p[i * 3 + 1] = Math.max(0.02, p[i * 3 + 1] + v[i * 3 + 1] * dt)
      p[i * 3 + 2] += v[i * 3 + 2] * dt
      dummy.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
      dummy.rotation.set(r[i * 3] + sim.life * 4, r[i * 3 + 1] + sim.life * 3, r[i * 3 + 2])
      dummy.scale.setScalar(Math.min(1, sim.life))
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
      <planeGeometry args={[0.07, 0.11]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  )
}

/** Lights that follow him and take on the district's colour; a rim light keeps him readable against busy scenes. */
function Lights() {
  const key = useRef<THREE.DirectionalLight>(null)
  const rim = useRef<THREE.DirectionalLight>(null)
  const target = useMemo(() => new THREE.Object3D(), [])
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const d = DISTRICTS[stroll.active]
    const k = 1 - Math.exp(-2.5 * dt)
    target.position.set(stroll.x, 0.9, 0)
    target.updateMatrixWorld()
    if (key.current) {
      key.current.position.set(stroll.x + 2.2, 4.5, 3.5)
      towards(key.current.color, d.key, k)
    }
    if (rim.current) {
      rim.current.position.set(stroll.x - 1, 3, -4)
      towards(rim.current.color, d.lamp, k)
    }
  })
  return (
    <>
      <primitive object={target} />
      {/* Same treatment as the open world: the sky baked into an environment map lights him softly from all round. */}
      <Environment frames={1} resolution={128} environmentIntensity={0.8}>
        <Sky distance={3000} sunPosition={[400, 300, 600]} turbidity={3.2} rayleigh={2.6} mieCoefficient={0.004} mieDirectionalG={0.82} />
      </Environment>
      <hemisphereLight args={['#e7ecff', '#3a3340', 0.45]} />
      <directionalLight
        ref={key}
        target={target}
        intensity={1.7}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-2.5}
        shadow-camera-right={2.5}
        shadow-camera-top={2.5}
        shadow-camera-bottom={-2.5}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
        shadow-bias={-0.0005}
      />
      <directionalLight ref={rim} target={target} intensity={1.6} />
    </>
  )
}

export default function Stroll() {
  return (
    <div className="stroll-stage" aria-hidden="true">
      <Canvas shadows dpr={[1, 1.25]} camera={{ position: [0, 1.4, 5.6], fov: 35 }} gl={{ antialias: true, alpha: true }}>
        <Rig />
        <Lights />
        <Street />
        <Scenery />
        <Suspense fallback={null}>
          <Walker />
        </Suspense>
        <Confetti />
      </Canvas>
    </div>
  )
}

useGLTF.preload(MODEL, false, true)
