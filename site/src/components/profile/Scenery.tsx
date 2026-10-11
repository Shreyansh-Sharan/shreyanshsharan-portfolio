// The 3D sets either side of the profile street: houses, glass towers, neon blocks, stadium floodlights and seaside
// kiosks, from the same low-poly model family as the open world. When the chapter changes, each piece sinks into the ground and rises again as the new district,
// nearest first, like a stage set changing around him.
import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader, MeshoptDecoder } from 'three-stdlib'
import { DISTRICTS, stroll } from './stroll'

// ---- Models: the same low-poly asset family as the open world (plus a few made for these streets). ----
const base = import.meta.env.BASE_URL
const world = (n: string) => `${base}world/models/${n}.glb`
const sports = (n: string) => `${base}sports/models/${n}.glb`
const street = (n: string) => `${base}profile/models/${n}.glb`

interface Spec {
  url: string
  /** Height in metres. */
  h: number
  /** How often it turns up. */
  w: number
  /** Buildings turn their front to the street; props get a random turn. */
  face?: boolean
}

const SETS: Record<string, Spec[]> = {
  overview: [
    { url: street('house'), h: 6, w: 3, face: true },
    { url: street('townhouse'), h: 7.5, w: 3, face: true },
    { url: world('autumn-tree'), h: 4.5, w: 1.5 },
    { url: world('pine'), h: 5, w: 1 },
  ],
  experience: [
    { url: street('office'), h: 17, w: 3, face: true },
    { url: street('office'), h: 12, w: 2, face: true },
    { url: world('autumn-tree'), h: 4, w: 1 },
  ],
  skills: [
    { url: street('neon-block'), h: 13, w: 3, face: true },
    { url: world('neon-tower'), h: 12, w: 2, face: true },
  ],
  trophies: [
    { url: sports('floodlight'), h: 9, w: 2, face: true },
    { url: world('trophy'), h: 3, w: 1.5 },
    { url: world('podium'), h: 2, w: 1, face: true },
    { url: sports('scoreboard'), h: 5, w: 1, face: true },
  ],
  finale: [
    { url: street('kiosk'), h: 3.6, w: 2.5, face: true },
    { url: world('palm'), h: 6, w: 2.5 },
  ],
}

const LANDMARKS: Record<string, Spec> = {
  overview: { url: world('clock-tower'), h: 16, w: 1 },
  experience: { url: street('office'), h: 30, w: 1 },
  skills: { url: world('neon-tower'), h: 26, w: 1 },
  trophies: { url: world('trophy'), h: 12, w: 1 },
  finale: { url: street('ferris-wheel'), h: 17, w: 1 },
}

const loader = new GLTFLoader()
loader.setMeshoptDecoder(typeof MeshoptDecoder === 'function' ? (MeshoptDecoder as () => unknown)() : MeshoptDecoder)
/** Loaded models, normalised to 1 m tall, centred on x/z and resting on y = 0. */
const models = new Map<string, THREE.Object3D | null>()

function load(url: string) {
  if (models.has(url)) return
  models.set(url, null)
  loader.load(
    url,
    (gltf) => {
      const root = gltf.scene
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const c = box.getCenter(new THREE.Vector3())
      const k = 1 / Math.max(size.y, 1e-3)
      const norm = new THREE.Group()
      root.scale.multiplyScalar(k)
      root.position.set(-c.x * k, -box.min.y * k, -c.z * k)
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          m.castShadow = false
          m.receiveShadow = false
        }
      })
      norm.add(root)
      models.set(url, norm)
    },
    undefined,
    () => models.delete(url),
  )
}

function loadDistrict(i: number) {
  const id = DISTRICTS[i].id
  for (const s of SETS[id]) load(s.url)
  load(LANDMARKS[id].url)
}

function place(spec: Spec, side: number, r: () => number): THREE.Group | null {
  const m = models.get(spec.url)
  if (!m) return null
  const g = new THREE.Group()
  const o = m.clone(true)
  o.scale.setScalar(spec.h * (0.9 + r() * 0.2))
  o.rotation.y = spec.face ? -side * (Math.PI / 2) : r() * Math.PI * 2
  g.add(o)
  return g
}

function buildModel(district: number, side: number, r: () => number): THREE.Group | null {
  const set = SETS[DISTRICTS[district].id]
  let t = r() * set.reduce((a, s) => a + s.w, 0)
  let spec = set[0]
  for (const s of set) {
    t -= s.w
    if (t <= 0) {
      spec = s
      break
    }
  }
  return place(spec, side, r)
}

function landmarkModel(district: number): THREE.Group | null {
  return place(LANDMARKS[DISTRICTS[district].id], 0, () => 0.5)
}

const SLOTS = 9 // per side
const GAP = 4.6
const SPAN = SLOTS * GAP
const NEAR_Z = -0.5

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

function easeOutBack(t: number) {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

interface Slot {
  holder: THREE.Group
  piece: THREE.Group | null
  side: number
  seed: number
  district: number
  /** Seconds until this slot swaps to the current district (stagger, nearest first). */
  delay: number
  t: number
}

export function Scenery() {
  const root = useMemo(() => new THREE.Group(), [])
  const state = useMemo(() => {
    const slots: Slot[] = []
    for (let i = 0; i < SLOTS * 2; i++) {
      const side = i % 2 ? 1 : -1
      const k = Math.floor(i / 2)
      const holder = new THREE.Group()
      holder.position.set(side * (7 + (k % 3) * 0.7), 0, NEAR_Z - k * GAP - (side > 0 ? GAP / 2 : 0))
      root.add(holder)
      slots.push({ holder, piece: null, side, seed: 1000 + i * 77, district: -1, delay: 0, t: 1 })
    }
    const mark = new THREE.Group()
    mark.position.set(0, 0, -SPAN)
    root.add(mark)
    return { slots, mark, markDistrict: -1, markT: 1, shown: -1 }
  }, [root])

  useEffect(() => {
    // The opening district first, then the rest in the background.
    loadDistrict(0)
    const id = window.setTimeout(() => DISTRICTS.forEach((_, i) => loadDistrict(i)), 1500)
    return () => {
      window.clearTimeout(id)
      root.clear()
    }
  }, [root])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const want = stroll.active
    if (want !== state.shown) {
      // Chapter changed: queue every slot to swap, nearest first.
      state.shown = want
      for (const s of state.slots) s.delay = Math.max(0, (NEAR_Z - s.holder.position.z) / SPAN) * 0.9
    }
    const step = stroll.speed * dt
    for (const s of state.slots) {
      // Slide away with the street; pieces that leave the far end come back in at the near end.
      s.holder.position.z -= step
      if (s.holder.position.z < NEAR_Z - SPAN) {
        s.holder.position.z += SPAN
        s.seed += 31
        s.district = -1 // rebuild with a fresh seed
      }
      if (s.district !== want) {
        if (s.delay > 0) s.delay -= dt
        else {
          // Sink, swap, rise.
          s.t -= dt * 3
          if (s.t <= 0 || !s.piece) {
            if (s.piece) s.holder.remove(s.piece)
            // Not loaded yet: stay down and try again next frame.
            s.piece = buildModel(want, s.side, rng(s.seed))
            if (s.piece) {
              s.holder.add(s.piece)
              s.district = want
            }
            s.t = 0
          }
        }
      } else if (s.t < 1) s.t = Math.min(1, s.t + dt * 2.4)
      // Sinking eases in; rising overshoots a touch and settles (ease-out-back).
      const y = s.district === want ? easeOutBack(s.t) : s.t * s.t
      // Far pieces rise out of the haze instead of popping.
      const far = Math.max(0.001, THREE.MathUtils.smoothstep(s.holder.position.z, NEAR_Z - SPAN, NEAR_Z - SPAN + 6))
      s.holder.scale.set(far, Math.max(0.001, y * far), far)
    }
    // The landmark at the end of the street.
    if (state.markDistrict !== want) {
      state.markT -= dt * 2
      if (state.markT <= 0) {
        state.mark.clear()
        const lm = landmarkModel(want)
        if (lm) {
          state.mark.add(lm)
          state.markDistrict = want
        }
        state.markT = 0
      }
    } else if (state.markT < 1) state.markT = Math.min(1, state.markT + dt * 1.5)
    state.mark.scale.setScalar(Math.max(0.001, state.markT))
    state.mark.traverse((o) => {
      if (o.userData.spin) o.rotation.z += dt * 0.25
    })
  })

  return <primitive object={root} />
}
