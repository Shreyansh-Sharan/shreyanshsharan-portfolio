// Each biome's scenery: props (some of them solid), animals, balloons, the volcano, neon and the weather.
// Placement is seeded so every screen in an online game builds the same course.
import * as THREE from 'three'
import { prop, type GolfAssets, type PropName } from './assets'
import type { Ground } from './ball'
import type { Course } from './course'
import { Particles } from '../racer/fx'

export interface Scenery {
  update(dt: number, time: number, focus: THREE.Vector3, wind: THREE.Vector3): void
}

interface Ctx {
  scene: THREE.Scene
  assets: GolfAssets | null
  course: Course
  ground: Ground
}

const tmpV = new THREE.Vector3()
const tmpW = new THREE.Vector3()
const tmpC = new THREE.Color()

export function decorate({ scene, assets, course, ground }: Ctx): Scenery {
  const hole = course.hole
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const clear = (x: number, z: number, r: number) =>
    !course.trees.some((t) => Math.hypot(t.x - x, t.z - z) < r) &&
    !course.cartSpots.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < r + 2) &&
    !course.briefcases.some((b) => Math.hypot(b.x - x, b.z - z) < r + 2) &&
    !course.ramps.some((p) => Math.hypot(p.x - x, p.z - z) < p.len + r)
  const addProp = (name: PropName, size: number, x: number, z: number, yaw = 0, collide = 0, h = 5) => {
    const src = assets?.props[name]
    if (!src) return null
    const obj = prop(src, size)
    obj.position.set(x, ground.y(x, z) - 0.05, z)
    obj.rotation.y = yaw
    scene.add(obj)
    if (collide) course.trees.push({ x, z, r: collide, kind: 'prop', scale: 1, yaw, h })
    return obj
  }
  const solid = (obj: THREE.Object3D, x: number, z: number, r: number, h: number) => {
    obj.position.set(x, ground.y(x, z) - 0.05, z)
    scene.add(obj)
    course.trees.push({ x, z, r, kind: 'prop', scale: 1, yaw: 0, h })
    return obj
  }
  /** Scatter `n` props `pick()` in the rough `d0`–`d1` m from the route. */
  const scatter = (n: number, d0: number, d1: number, pick: (x: number, z: number) => boolean) => {
    const b = course.bounds
    for (let k = 0, placed = 0; k < n * 20 && placed < n; k++) {
      const x = b.minX + 30 + rnd() * (b.maxX - b.minX - 60), z = b.minZ + 30 + rnd() * (b.maxZ - b.minZ - 60)
      const d = course.routeNearest(x, z).dist
      if (d < d0 || d > d1 || ground.y(x, z) < 1 || !clear(x, z, 5)) continue
      if (pick(x, z)) placed++
    }
  }

  const sheep: { obj: THREE.Object3D; target: THREE.Vector3; home: THREE.Vector3; wait: number }[] = []
  const balloons: THREE.Object3D[] = []
  const weeds: { obj: THREE.Object3D; vel: THREE.Vector3 }[] = []
  const neon: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[] = []
  let volcano: THREE.Vector3 | null = null
  const additive = new Particles(500, true)
  const soft = new Particles(700, false)
  scene.add(additive.points, soft.points)

  const balloon = (k: number, x: number, y: number, z: number) => {
    const src = assets?.props.balloon
    if (!src) return
    const b = prop(src, 14)
    b.position.set(x, y, z)
    b.rotation.y = k
    scene.add(b)
    balloons.push(b)
  }

  if (hole.terrain === 'meadow') {
    addProp('clubhouse', 11, -28, -26, 0.5, 9, 12)
    addProp('tractor', 2.6, -12, -36, 1.4, 2)
    addProp('barrels', 1.3, -18, -15, 0, 1)
    addProp('signpost', 2.6, -6, 3, Math.PI / 2, 0.4)
    addProp('bench', 1.0, -7, -6, 0.2, 0.9, 1.2)
    addProp('bench', 1.0, hole.green[0] + 22, hole.green[1] + 6, -1.6, 0.9, 1.2)
    addProp('podium', 1.8, -16, -42, 0.5, 2.2)
    addProp('trophy', 1.2, -16, -42.2, 0.5)
    addProp('windmill', 16, -58, 205, 0.8, 4, 16)
    addProp('windmill', 13, 255, 60, -0.6, 3.5, 14)
    for (let k = 0, placed = 0; k < 400 && placed < 26; k++) {
      const x = -60 + rnd() * 320, z = -40 + rnd() * 360
      const d = course.routeNearest(x, z).dist
      if (d < 16 || ground.y(x, z) < 1 || !clear(x, z, 5)) continue
      const rock = rnd() < 0.45
      if (addProp(rock ? 'rocks' : 'bush', rock ? 1.6 + rnd() * 1.4 : 1.1 + rnd() * 0.5, x, z, rnd() * 6, rock ? 1.4 : 0)) placed++
    }
    // A flock in the rough on the far side of the lake.
    for (let k = 0; k < 7; k++) {
      const x = 120 + rnd() * 30, z = 60 + rnd() * 30
      const obj = addProp('sheep', 1.1, x, z, rnd() * 6)
      if (obj) sheep.push({ obj, target: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(135, 0, 75), wait: rnd() * 5 })
    }
    for (let k = 0; k < 3; k++) balloon(0, -80 + k * 160, 70 + k * 18, 120 + k * 60)
  } else if (hole.terrain === 'canyon') {
    addProp('clubhouse', 10, -26, -24, 0.6, 8.5, 12)
    addProp('signpost', 2.6, -6, 3, Math.PI / 2, 0.4)
    addProp('barrels', 1.3, -15, -12, 0, 1)
    addProp('barrels', 1.3, -12, -16, 1, 1)
    addProp('bench', 1.0, -7, -6, 0.2, 0.9, 1.2)
    addProp('bench', 1.0, hole.green[0] + 20, hole.green[1] - 8, -1.6, 0.9, 1.2)
    // Ruins up on the mesas, a windmill pump at the oasis.
    for (const [d, lat, size] of [[150, -48, 16], [300, 52, 18], [420, -46, 14]] as const) {
      const p = course.routePoint(d, lat)
      addProp('ruins', size, p.x, p.z, rnd() * 6, size * 0.35, size)
    }
    addProp('windmill', 12, hole.lake.c[0] + 30, hole.lake.c[1] + 36, 2.2, 3, 12)
    scatter(12, 16, 46, (x, z) => !!addProp('rocks', 1.8 + rnd() * 2.6, x, z, rnd() * 6, 1.6))
    scatter(10, 18, 40, (x, z) => !!addProp('cactus', 2 + rnd() * 2, x, z, rnd() * 6, 0))
    // Tumbleweeds roll with the breeze.
    const weedMat = new THREE.MeshStandardMaterial({ color: '#a47a45', wireframe: true })
    for (let k = 0; k < 8; k++) {
      const obj = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 + rnd() * 0.3, 1), weedMat)
      const p = course.routePoint(rnd() * course.length, (rnd() - 0.5) * 30)
      obj.position.set(p.x, ground.y(p.x, p.z) + 0.6, p.z)
      scene.add(obj)
      weeds.push({ obj, vel: new THREE.Vector3(2 + rnd() * 2, 0, 1 + rnd()) })
    }
    balloon(1, 60, 80, 160)
    balloon(2, 180, 95, 300)
  } else if (hole.terrain === 'snow') {
    addProp('clubhouse', 11, -28, -26, 0.5, 9, 12)
    addProp('signpost', 2.6, -6, 3, Math.PI / 2, 0.4)
    addProp('bench', 1.0, -7, -6, 0.2, 0.9, 1.2)
    addProp('bench', 1.0, hole.green[0] + 20, hole.green[1] + 6, -1.6, 0.9, 1.2)
    const obs = course.routePoint(205, -40)
    addProp('observatory', 14, obs.x, obs.z, 0.8, 6, 12)
    // Ice crystals around the frozen lake.
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rnd() * 0.3
      const x = hole.lake.c[0] + Math.cos(a) * hole.lake.r[0] * 1.15, z = hole.lake.c[1] + Math.sin(a) * hole.lake.r[1] * 1.15
      if (course.routeNearest(x, z).dist < 13 || !clear(x, z, 4)) continue
      const obj = addProp('crystals', 2.2 + rnd() * 1.6, x, z, rnd() * 6, 1.2, 3)
      obj?.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone()
          mat.color.set('#bfe9ff')
          mat.emissive = new THREE.Color('#38bdf8')
          mat.emissiveIntensity = 0.35
          m.material = mat
        }
      })
    }
    // Snowmen beside the fairway (solid).
    scatter(9, 13, 22, (x, z) => !!solid(snowman(rnd), x, z, 0.8, 2.4))
    scatter(8, 16, 46, (x, z) => !!addProp('rocks', 1.6 + rnd() * 1.8, x, z, rnd() * 6, 1.4))
    balloon(1, -120, 85, 180)
  } else {
    // Volcanic night: neon towers on the shore, neon posts down the fairway, the volcano across the lava.
    addProp('clubhouse', 10, -26, -22, 0.5, 8.5, 12)
    addProp('signpost', 2.6, -6, 3, Math.PI / 2, 0.4)
    addProp('bench', 1.0, -7, -6, 0.2, 0.9, 1.2)
    for (const [d, lat] of [[20, -26], [90, 27], [150, -24], [190, 22]] as const) {
      const p = course.routePoint(d, lat)
      if (ground.y(p.x, p.z) > 1) addProp('neon-tower', 13, p.x, p.z, rnd() * 6, 2, 13)
    }
    const colors = ['#f472b6', '#22d3ee', '#a3e635', '#c084fc']
    for (let d = 10, i = 0; d < course.length - 10; d += 22, i++) {
      for (const side of [-1, 1]) {
        const p = course.routePoint(d, side * 13)
        if (ground.y(p.x, p.z) < 1 || !clear(p.x, p.z, 2)) continue
        const mat = new THREE.MeshBasicMaterial({ color: colors[(i + (side > 0 ? 1 : 0)) % colors.length] })
        neon.push({ mat, base: mat.color.clone() })
        const post = new THREE.Group()
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#1f1b2e' }))
        pole.position.y = 1.3
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.4, 8), mat)
        tube.position.y = 2.2
        post.add(pole, tube)
        solid(post, p.x, p.z, 0.25, 2.8)
      }
    }
    scatter(8, 16, 36, (x, z) => !!addProp('rocks', 1.5 + rnd() * 1.6, x, z, rnd() * 6, 1.3))
    // The volcano, out in the lava sea.
    volcano = new THREE.Vector3(hole.bounds.maxX + 80, 0, hole.bounds.maxZ + 60)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(16, 95, 75, 24, 4, true), new THREE.MeshStandardMaterial({ color: '#2a1d1a', flatShading: true, roughness: 1 }))
    const cp = cone.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < cp.count; i++) {
      const k = 1 + (Math.sin(i * 12.9898) * 0.5) * 0.12
      cp.setX(i, cp.getX(i) * k)
      cp.setZ(i, cp.getZ(i) * k)
    }
    cone.geometry.computeVertexNormals()
    cone.position.set(volcano.x, 37.5 - 6, volcano.z)
    const crater = new THREE.Mesh(new THREE.CircleGeometry(16, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff6a1a' }))
    crater.position.set(volcano.x, 68, volcano.z)
    const glow = new THREE.PointLight('#ff5a1f', 2.5, 0, 0)
    glow.position.set(volcano.x, 90, volcano.z)
    scene.add(cone, crater, glow)
    // Lava light from below.
    const under = new THREE.PointLight('#ff6a2a', 1.6, 160, 1.2)
    under.position.set(hole.lake.c[0], 6, hole.lake.c[1])
    scene.add(under)
  }

  const b = course.bounds
  return {
    update(dt, time, focus, wind) {
      for (const s of sheep) {
        s.wait -= dt
        if (s.wait <= 0) {
          s.target.set(s.home.x - 15 + Math.random() * 30, 0, s.home.z - 15 + Math.random() * 30)
          s.wait = 4 + Math.random() * 6
        }
        tmpV.copy(s.target).sub(s.obj.position).setY(0)
        if (tmpV.length() > 0.5) {
          tmpV.normalize()
          s.obj.position.addScaledVector(tmpV, dt * 0.6)
          s.obj.rotation.y = Math.atan2(tmpV.x, tmpV.z)
          s.obj.position.y = ground.y(s.obj.position.x, s.obj.position.z)
        }
      }
      for (const [i, bl] of balloons.entries()) {
        bl.position.x += dt * (1.2 + i * 0.3)
        bl.position.y += Math.sin(time * 0.3 + i) * dt * 0.4
        if (bl.position.x > b.maxX + 60) bl.position.x = b.minX - 50
      }
      for (const w of weeds) {
        const o = w.obj
        o.position.x += (w.vel.x + wind.x * 0.4) * dt
        o.position.z += (w.vel.z + wind.z * 0.4) * dt
        const gy = ground.y(o.position.x, o.position.z)
        o.position.y = gy + 0.6 + Math.abs(Math.sin(time * 3 + w.vel.x)) * 0.6
        o.rotation.z -= dt * 3
        o.rotation.x += dt * 2
        if (o.position.x > b.maxX - 10 || o.position.z > b.maxZ - 10 || gy > 12) {
          const p = course.routePoint(Math.random() * course.length, (Math.random() - 0.5) * 30)
          o.position.set(p.x - 20, 0, p.z - 10)
        }
      }
      for (let i = 0; i < neon.length; i++) neon[i].mat.color.copy(neon[i].base).multiplyScalar((0.75 + 0.25 * Math.sin(time * 3 + i * 1.7)) * 1.6)
      // Weather around the camera.
      const t = hole.terrain
      if (t === 'snow') {
        for (let k = 0; k < 6; k++) {
          tmpV.set(focus.x + (Math.random() - 0.5) * 60, focus.y + 14 + Math.random() * 8, focus.z + (Math.random() - 0.5) * 60)
          soft.emit(tmpV, tmpW.set(wind.x * 0.8, -2.2, wind.z * 0.8), 7, 0.18, tmpC.set(1, 1, 1), 0.9, 0, 0)
        }
      } else if (t === 'canyon') {
        if (Math.random() < dt * 6) {
          tmpV.set(focus.x + (Math.random() - 0.5) * 50, focus.y + 0.5, focus.z + (Math.random() - 0.5) * 50)
          soft.emit(tmpV, tmpW.set(2 + wind.x, 0.4, 1 + wind.z), 3, 1.6, tmpC.set(0.85, 0.7, 0.5), 0.25, 2, 0.1)
        }
      } else if (t === 'volcano') {
        for (let k = 0; k < 2; k++) {
          tmpV.set(focus.x + (Math.random() - 0.5) * 70, focus.y - 1 + Math.random() * 3, focus.z + (Math.random() - 0.5) * 70)
          additive.emit(tmpV, tmpW.set((Math.random() - 0.5) * 0.5, 1.2 + Math.random(), (Math.random() - 0.5) * 0.5), 4, 0.16, tmpC.set(3, 1.1, 0.3), 1, 0, 0)
        }
        if (volcano && Math.random() < dt * 8) {
          tmpV.set(volcano.x + (Math.random() - 0.5) * 12, 72, volcano.z + (Math.random() - 0.5) * 12)
          soft.emit(tmpV, tmpW.set((Math.random() - 0.5) * 2, 5 + Math.random() * 3, (Math.random() - 0.5) * 2), 9, 14, tmpC.set(0.18, 0.12, 0.14), 0.7, 2.5, 0.05)
        }
      }
      additive.update(dt)
      soft.update(dt)
    },
  }
}

/** A chunky snowman: three balls, coal eyes, a carrot nose. */
function snowman(rnd: () => number) {
  const g = new THREE.Group()
  const snow = new THREE.MeshStandardMaterial({ color: '#f8fbff', roughness: 0.8, flatShading: true })
  const coal = new THREE.MeshStandardMaterial({ color: '#111827' })
  let y = 0
  for (const r of [0.75, 0.55, 0.38]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), snow)
    m.position.y = y + r * 0.9
    y += r * 1.7
    m.castShadow = true
    g.add(m)
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f97316' }))
  nose.position.set(0, y - 0.32, 0.42)
  g.add(nose)
  for (const x of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), coal)
    eye.position.set(x, y - 0.2, 0.32)
    g.add(eye)
  }
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.35, 10), coal)
  hat.position.y = y + 0.05
  g.add(hat)
  g.rotation.y = rnd() * Math.PI * 2
  return g
}
