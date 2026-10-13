// Draws the mini-games (minigames.ts): the start markers, the harbour pier, and whatever the game in progress
// needs: rings and pads, the herd and its pen, the bottle shelf, the parcel pads, the dig spot, the fishing line.
// Everything is instanced or a handful of meshes; the photo challenge's species count is done here because it
// needs the camera's frustum.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { heightAt } from './terrain'
import { WATER_LEVEL } from './regions'
import { animals } from './wildlife'
import { creatures } from './creatures'
import { player } from './Characters'
import { game, GAMES, photo, pier, snapResult } from './minigames'

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const eu = new THREE.Euler()
const vp = new THREE.Vector3()
const vs = new THREE.Vector3()
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
const frustum = new THREE.Frustum()
const pv = new THREE.Matrix4()

type V3 = [number, number, number]
interface Part {
  g: THREE.BufferGeometry
  c: string
  p: V3
  r?: V3
  s?: V3 | number
}
function bake(parts: Part[]) {
  const geos = parts.map(({ g, c, p, r = [0, 0, 0], s = 1 }) => {
    const geo = g.index ? g.toNonIndexed() : g.clone()
    geo.deleteAttribute('uv')
    const sc = typeof s === 'number' ? ([s, s, s] as V3) : s
    m4.compose(vp.set(...p), q.setFromEuler(eu.set(...r)), vs.set(...sc))
    geo.applyMatrix4(m4)
    const col = new THREE.Color(c)
    const n = geo.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3)
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    return geo
  })
  return mergeGeometries(geos)!
}
const mirror = (x: number, make: (x: number) => Part): Part[] => [make(-x), make(x)]

const SPH = new THREE.IcosahedronGeometry(1, 1)
const BOX = new THREE.BoxGeometry(1, 1, 1)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8)
const RING = new THREE.TorusGeometry(1, 0.09, 8, 28)
const DISC = new THREE.TorusGeometry(1, 0.06, 6, 32)

const VERT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 })
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false })

function inst(geo: THREE.BufferGeometry, n: number, mat: THREE.Material = VERT) {
  const im = new THREE.InstancedMesh(geo, mat, n)
  im.frustumCulled = false
  im.castShadow = mat === VERT
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  for (let i = 0; i < n; i++) im.setMatrixAt(i, ZERO)
  im.setColorAt(0, new THREE.Color(1, 1, 1))
  im.instanceColor!.setUsage(THREE.DynamicDrawUsage)
  return im
}

const sheepGeo = () =>
  bake([
    { g: SPH, c: '#f3efe6', p: [0, 0.62, 0], s: [0.46, 0.4, 0.58] },
    { g: SPH, c: '#f3efe6', p: [0.2, 0.75, 0.15], s: 0.26 },
    { g: SPH, c: '#f3efe6', p: [-0.2, 0.75, -0.15], s: 0.26 },
    { g: SPH, c: '#2b2420', p: [0, 0.78, 0.6], s: [0.2, 0.2, 0.24] },
    ...mirror(0.12, (x) => ({ g: SPH, c: '#2b2420', p: [x * 1.6, 0.9, 0.52], s: [0.1, 0.05, 0.07] })),
    ...mirror(0.2, (x) => ({ g: CYL, c: '#2b2420', p: [x, 0.18, 0.28], s: [0.06, 0.36, 0.06] })),
    ...mirror(0.2, (x) => ({ g: CYL, c: '#2b2420', p: [x, 0.18, -0.3], s: [0.06, 0.36, 0.06] })),
  ])
const bottleGeo = () =>
  bake([
    { g: CYL, c: '#7fd1c1', p: [0, 0.22, 0], s: [0.1, 0.44, 0.1] },
    { g: CYL, c: '#7fd1c1', p: [0, 0.52, 0], s: [0.05, 0.18, 0.05] },
    { g: CYL, c: '#e0b25c', p: [0, 0.63, 0], s: [0.055, 0.05, 0.055] },
  ])
const barrelGeo = () =>
  bake([
    { g: CYL, c: '#8a5a33', p: [0, 0.5, 0], s: [0.5, 1, 0.5] },
    { g: CYL, c: '#4b4b55', p: [0, 0.2, 0], s: [0.52, 0.06, 0.52] },
    { g: CYL, c: '#4b4b55', p: [0, 0.8, 0], s: [0.52, 0.06, 0.52] },
  ])
const parcelGeo = () =>
  bake([
    { g: BOX, c: '#d8a86a', p: [0, 0.3, 0], s: [0.6, 0.6, 0.6] },
    { g: BOX, c: '#f3f0e6', p: [0, 0.3, 0], s: [0.62, 0.12, 0.62] },
    { g: BOX, c: '#f3f0e6', p: [0, 0.3, 0], s: [0.12, 0.62, 0.62] },
  ])
const postGeo = () =>
  bake([
    { g: CYL, c: '#8a6a44', p: [0, 0.55, 0], s: [0.07, 1.1, 0.07] },
    { g: BOX, c: '#a88659', p: [0, 0.85, 0], s: [0.06, 0.08, 1.7] },
    { g: BOX, c: '#a88659', p: [0, 0.45, 0], s: [0.06, 0.08, 1.7] },
  ])
const markerGeo = () =>
  bake([
    { g: SPH, c: '#ffffff', p: [0, 1.6, 0], s: [0.22, 0.34, 0.22] },
    { g: CYL, c: '#ffffff', p: [0, 0.6, 0], s: [0.04, 1.2, 0.04] },
  ])

const NEXT = new THREE.Color(2.2, 1.8, 0.6)
const PASSED = new THREE.Color(0.2, 0.5, 0.3)
const AHEAD = new THREE.Color(0.5, 0.9, 1.4)
const PAD = new THREE.Color(0.6, 1.6, 2.2)
const tmp = new THREE.Color()

export function Minigames() {
  const defs = useMemo(() => GAMES(), [])
  const pr = useMemo(() => pier(), [])
  const m = useMemo(() => {
    const out = {
      markers: inst(markerGeo(), 8),
      discs: inst(DISC, 8, GLOW),
      rings: inst(RING, 16, GLOW),
      pads: inst(BOX, 48),
      sheep: inst(sheepGeo(), 8),
      posts: inst(postGeo(), 20),
      bottles: inst(bottleGeo(), 10),
      barrels: inst(barrelGeo(), 5),
      parcels: inst(parcelGeo(), 4),
      drops: inst(DISC, 3, GLOW),
    }
    // The start markers never move: placed once.
    defs.forEach((d, i) => {
      const y = heightAt(d.x, d.z)
      out.markers.setMatrixAt(i, m4.compose(vp.set(d.x, y, d.z), q.identity(), vs.set(1, 1, 1)))
      out.discs.setMatrixAt(i, m4.compose(vp.set(d.x, y + 0.08, d.z), q.setFromEuler(eu.set(Math.PI / 2, 0, 0)), vs.set(2.2, 2.2, 1)))
      tmp.set(d.id === 'photo' ? '#f9a8d4' : d.id === 'rings' || d.id === 'delivery' ? '#7dd3fc' : d.id === 'fishing' ? '#5eead4' : '#fde68a')
      out.markers.setColorAt(i, tmp)
      out.discs.setColorAt(i, tmp.clone().multiplyScalar(1.6))
    })
    out.markers.instanceMatrix.needsUpdate = out.discs.instanceMatrix.needsUpdate = true
    out.markers.instanceColor!.needsUpdate = out.discs.instanceColor!.needsUpdate = true
    return out
  }, [defs])
  const lineRef = useRef<THREE.Line>(null)
  const bobber = useRef<THREE.Mesh>(null)
  const chest = useRef<THREE.Mesh>(null)
  const dirt = useRef<THREE.Mesh>(null)
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    return g
  }, [])
  const lineObj = useMemo(() => new THREE.Line(line, new THREE.LineBasicMaterial({ color: '#f8fafc' })), [line])

  useFrame(({ camera, clock }) => {
    const time = clock.elapsedTime
    const g = game
    // Markers bob; the active one's marker hides.
    defs.forEach((d, i) => {
      const y = heightAt(d.x, d.z) + Math.sin(time * 2 + i) * 0.1
      const on = g && !g.over && g.id === d.id
      m.markers.setMatrixAt(i, on ? ZERO : m4.compose(vp.set(d.x, y, d.z), q.setFromEuler(eu.set(0, time * 0.8, 0)), vs.set(1, 1, 1)))
    })
    m.markers.instanceMatrix.needsUpdate = true

    // ---- Photo snaps: count the species inside the camera frustum, close enough to matter. ----
    if (photo.snapN !== photo.seenN) {
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const seen = new Set<string>()
      for (const c of creatures) {
        if (!c.alive || c.hidden || c.buried) continue
        if (c.pos.distanceTo(camera.position) > 45) continue
        vp.set(c.pos.x, c.pos.y + c.spec.height * c.size * 0.5, c.pos.z)
        if (frustum.containsPoint(vp)) seen.add(c.spec.name)
      }
      for (const a of animals()) {
        if (a.pos.distanceTo(camera.position) > 45) continue
        vp.set(a.pos.x, a.pos.y + a.spec.height * 0.5, a.pos.z)
        if (frustum.containsPoint(vp)) seen.add(a.spec.name)
      }
      snapResult([...seen])
    }

    // ---- Everything a running game needs. ----
    let rings = 0, pads = 0, sheep = 0, posts = 0, bottles = 0, barrels = 0, parcels = 0, drops = 0
    let showLine = false, showChest = false, showDirt = false
    if (g) {
      if (g.id === 'parkour' || g.id === 'rings') {
        g.rings.forEach((r, i) => {
          if (i >= 16) return
          const next = i === g.n
          const sc = (g.id === 'parkour' ? 1.6 : 2.6) * (next ? 1 + Math.sin(time * 6) * 0.06 : 1)
          m.rings.setMatrixAt(rings, m4.compose(vp.set(r.x, r.y, r.z), q.setFromEuler(eu.set(0, r.yaw, 0)), vs.set(sc, sc, sc)))
          m.rings.setColorAt(rings, r.passed ? PASSED : next ? NEXT : AHEAD)
          rings++
        })
        g.pads.forEach((p) => {
          if (pads >= 48) return
          m.pads.setMatrixAt(pads, m4.compose(vp.set(p.x, p.y - 0.2, p.z), q.identity(), vs.set(2.8, 0.4, 2.8)))
          m.pads.setColorAt(pads, PAD)
          pads++
        })
      } else if (g.id === 'herding') {
        g.sheep.forEach((s) => {
          const bob = Math.abs(Math.sin(s.phase)) * 0.05
          m.sheep.setMatrixAt(sheep, m4.compose(vp.set(s.pos.x, s.pos.y + bob, s.pos.z), q.setFromEuler(eu.set(0, s.yaw, Math.sin(s.phase) * 0.05)), vs.set(1.1, 1.1, 1.1)))
          m.sheep.setColorAt(sheep, s.inPen ? tmp.setRGB(0.8, 1.1, 0.8) : tmp.setRGB(1, 1, 1))
          sheep++
        })
        // Fence posts around the pen, leaving the gate open.
        const n = 20
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          let ga = a - g.pen.gate
          ga = Math.atan2(Math.sin(ga), Math.cos(ga))
          if (Math.abs(ga) < 0.45) continue
          const x = g.pen.x + Math.sin(a) * g.pen.r, z = g.pen.z + Math.cos(a) * g.pen.r
          m.posts.setMatrixAt(posts++, m4.compose(vp.set(x, heightAt(x, z), z), q.setFromEuler(eu.set(0, a + Math.PI / 2, 0)), vs.set(1, 1, 1)))
        }
      } else if (g.id === 'range') {
        g.bottles.forEach((b, i) => {
          if (i % 2 === 0 && barrels < 5) m.barrels.setMatrixAt(barrels++, m4.compose(vp.set(b.x + 0.45, heightAt(b.x, b.z), b.z), q.identity(), vs.set(1, 1, 1)))
          const k = b.down >= 0 ? Math.min(1, b.down * 2.5) : 0
          const y = b.y - 0.63 - k * 1.2
          m.bottles.setMatrixAt(bottles, m4.compose(vp.set(b.x, y, b.z), q.setFromEuler(eu.set(k * 1.5, 0, k * 0.4)), vs.set(1 - k * 0.5, 1 - k * 0.5, 1 - k * 0.5)))
          bottles++
        })
      } else if (g.id === 'delivery') {
        for (let i = g.n + (g.carrying >= 0 ? 1 : 0); i < g.total; i++) {
          const k = i - g.n
          m.parcels.setMatrixAt(parcels++, m4.compose(vp.set(g.depot.x + (k - 1) * 0.9, heightAt(g.depot.x, g.depot.z), g.depot.z), q.identity(), vs.set(1, 1, 1)))
        }
        if (g.carrying >= 0) m.parcels.setMatrixAt(parcels++, m4.compose(vp.set(player.pos.x, player.pos.y + 2.1 + Math.sin(time * 3) * 0.05, player.pos.z), q.setFromEuler(eu.set(0, player.yaw, 0)), vs.set(0.8, 0.8, 0.8)))
        g.drops.forEach((d, i) => {
          const on = i === g.carrying
          m.drops.setMatrixAt(drops, m4.compose(vp.set(d.x, heightAt(d.x, d.z) + 0.15, d.z), q.setFromEuler(eu.set(Math.PI / 2, 0, 0)), vs.set(3.5, 3.5, 1)))
          m.drops.setColorAt(drops, on ? NEXT : i < g.n ? PASSED : AHEAD)
          drops++
        })
      } else if (g.id === 'treasure') {
        showDirt = !g.dug
        showChest = g.dug
        const y = heightAt(g.dig.x, g.dig.z)
        if (dirt.current) dirt.current.position.set(g.dig.x, y + 0.04, g.dig.z)
        if (chest.current) chest.current.position.set(g.dig.x, y + 0.35, g.dig.z)
      } else if (g.id === 'fishing' && !g.over) {
        showLine = true
        const bx = pr.x + Math.cos(pr.a) * (pr.length + 4), bz = pr.z + Math.sin(pr.a) * (pr.length + 4)
        const dip = g.phase === 'bite' ? -0.35 : g.phase === 'reel' ? Math.sin(time * 18) * 0.15 : 0
        const by = WATER_LEVEL + 0.1 + Math.sin(time * 2.2) * 0.06 + dip
        if (bobber.current) {
          bobber.current.visible = g.phase !== 'cast' && g.phase !== 'landed'
          bobber.current.position.set(bx, by, bz)
        }
        const pos = line.attributes.position as THREE.BufferAttribute
        const hx = player.pos.x + Math.sin(player.yaw) * 0.5, hz = player.pos.z + Math.cos(player.yaw) * 0.5
        pos.setXYZ(0, hx, player.pos.y + 1.3, hz)
        if (g.phase === 'cast' || g.phase === 'landed') pos.setXYZ(1, hx + Math.sin(player.yaw) * 1.2, player.pos.y + 0.4, hz + Math.cos(player.yaw) * 1.2)
        else pos.setXYZ(1, bx, by, bz)
        pos.needsUpdate = true
      }
    }
    if (lineRef.current) lineRef.current.visible = showLine
    if (bobber.current && !showLine) bobber.current.visible = false
    if (chest.current) chest.current.visible = showChest
    if (dirt.current) dirt.current.visible = showDirt
    const fill = (im: THREE.InstancedMesh, n: number, colors = true) => {
      for (let k = n; k < im.count; k++) im.setMatrixAt(k, ZERO)
      im.visible = n > 0
      im.instanceMatrix.needsUpdate = true
      if (colors) im.instanceColor!.needsUpdate = true
    }
    fill(m.rings, rings)
    fill(m.pads, pads)
    fill(m.sheep, sheep)
    fill(m.posts, posts, false)
    fill(m.bottles, bottles, false)
    fill(m.barrels, barrels, false)
    fill(m.parcels, parcels, false)
    fill(m.drops, drops)
  })

  // The pier: planks on posts, running from the shore out over the water.
  const pierGroup = useMemo(() => {
    const grp = new THREE.Group()
    const y0 = Math.max(heightAt(pr.x, pr.z), WATER_LEVEL + 0.5)
    const planks = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, pr.length), new THREE.MeshStandardMaterial({ color: '#9c7a4f', roughness: 0.9, flatShading: true }))
    planks.position.set(0, y0 + 0.3, pr.length / 2)
    planks.castShadow = planks.receiveShadow = true
    grp.add(planks)
    const postMat = new THREE.MeshStandardMaterial({ color: '#6b4e2e', roughness: 0.9 })
    for (let k = 0; k <= 3; k++)
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.4, 6), postMat)
        post.position.set(sx * 1.05, y0 - 0.6, (k / 3) * (pr.length - 0.6) + 0.3)
        grp.add(post)
      }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, pr.length), postMat)
    rail.position.set(-1.1, y0 + 1.2, pr.length / 2)
    grp.add(rail)
    grp.position.set(pr.x, 0, pr.z)
    grp.rotation.y = Math.atan2(Math.cos(pr.a), Math.sin(pr.a))
    return grp
  }, [pr])

  return (
    <>
      <primitive object={pierGroup} />
      <primitive object={m.markers} />
      <primitive object={m.discs} />
      <primitive object={m.rings} />
      <primitive object={m.pads} />
      <primitive object={m.sheep} />
      <primitive object={m.posts} />
      <primitive object={m.bottles} />
      <primitive object={m.barrels} />
      <primitive object={m.parcels} />
      <primitive object={m.drops} />
      <primitive object={lineObj} ref={lineRef} visible={false} />
      <mesh ref={bobber} visible={false}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <meshStandardMaterial color="#f43f5e" />
      </mesh>
      <mesh ref={dirt} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.4, 18]} />
        <meshStandardMaterial color="#6b4f2e" roughness={1} />
      </mesh>
      <mesh ref={chest} visible={false} castShadow>
        <boxGeometry args={[1.1, 0.7, 0.7]} />
        <meshStandardMaterial color="#b8862b" emissive="#fbbf24" emissiveIntensity={0.3} roughness={0.5} />
      </mesh>
    </>
  )
}
