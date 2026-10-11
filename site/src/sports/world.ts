// The outdoor complex: a sunny landscaped hub around a central plaza, with the F1 pit garage to the west, the stadium
// to the north and the rally hall to the east, all inside the circuit. Also the colliders and the glowing entry pads.
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { CONFIG } from './config'
import { fit, instanced, model, trs, yawFromX, type ModelName, type SportsAssets } from './assets'
import { decal, grassTexture, labelTexture, pavingTexture, pitchTexture } from './textures'
import type { Track } from './track'

/* ---------- Colliders ---------- */

interface Circle {
  x: number
  z: number
  r: number
}
interface Box {
  x: number
  z: number
  hw: number
  hd: number
  c: number // cos(yaw)
  s: number // sin(yaw)
}

/** Solid footprints the walker can't pass: circles (posts, trees) and rotated boxes (buildings, stands). */
export class Colliders {
  circles: Circle[] = []
  boxes: Box[] = []

  circle(x: number, z: number, r: number) {
    this.circles.push({ x, z, r })
  }

  /** A box of half-size hw (local x) by hd (local z), turned by yaw like the object it wraps. */
  box(x: number, z: number, hw: number, hd: number, yaw = 0) {
    this.boxes.push({ x, z, hw, hd, c: Math.cos(yaw), s: Math.sin(yaw) })
  }

  /** Push a point (x/z of pos) out of everything. Returns true if anything pushed. */
  resolve(pos: THREE.Vector3, radius: number) {
    let hit = false
    for (const c of this.circles) {
      const dx = pos.x - c.x, dz = pos.z - c.z
      const r = c.r + radius
      const d2 = dx * dx + dz * dz
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-3
        pos.x = c.x + (dx / d) * r
        pos.z = c.z + (dz / d) * r
        hit = true
      }
    }
    for (const b of this.boxes) {
      const dx = pos.x - b.x, dz = pos.z - b.z
      // World → box frame (inverse of the yaw rotation).
      const lx = dx * b.c - dz * b.s
      const lz = dx * b.s + dz * b.c
      const px = b.hw + radius - Math.abs(lx)
      const pz = b.hd + radius - Math.abs(lz)
      if (px <= 0 || pz <= 0) continue
      let nx = lx, nz = lz
      if (px < pz) nx = Math.sign(lx || 1) * (b.hw + radius)
      else nz = Math.sign(lz || 1) * (b.hd + radius)
      pos.x = b.x + nx * b.c + nz * b.s
      pos.z = b.z - nx * b.s + nz * b.c
      hit = true
    }
    return hit
  }

  /** True if the point is inside (or within `pad` of) any collider. Used to keep scenery out of the way. */
  blocked(x: number, z: number, pad: number) {
    for (const c of this.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true
    for (const b of this.boxes) {
      const dx = x - b.x, dz = z - b.z
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c
      if (Math.abs(lx) < b.hw + pad && Math.abs(lz) < b.hd + pad) return true
    }
    return false
  }
}

/* ---------- Entry pads ---------- */

export type PadId = 'f1' | 'stadium' | 'hall' | 'badminton' | 'tabletennis' | 'exit'

export interface Pad {
  id: PadId
  x: number
  z: number
  title: string
  prompt: string
  color: string
  group: THREE.Group
  ring: THREE.Mesh
  beam: THREE.Mesh
}

export function makePad(id: PadId, x: number, z: number, title: string, prompt: string, color: string, labelY = 5.2, labelScale = 1): Pad {
  const group = new THREE.Group()
  const col = new THREE.Color(color)
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }))
  disc.position.y = 0.05
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }))
  ring.position.y = 0.06
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.9, 3.2, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending }),
  )
  beam.position.y = 1.6
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(title, { fg: '#ffffff', w: 1024, h: 200 }), transparent: true, depthWrite: false }))
  label.scale.set(7.5 * labelScale, 1.46 * labelScale, 1)
  label.position.y = labelY
  group.add(disc, ring, beam, label)
  group.position.set(x, 0, z)
  return { id, x, z, title, prompt, color, group, ring, beam }
}

export function animatePad(p: Pad, t: number, active: boolean) {
  const k = 1 + Math.sin(t * 3 + p.x) * 0.06
  p.ring.scale.set(k, 1, k)
  ;(p.beam.material as THREE.MeshBasicMaterial).opacity = (active ? 0.3 : 0.14) + Math.sin(t * 2.2 + p.z) * 0.04
}

/* ---------- Hub ---------- */

export interface Hub {
  scene: THREE.Scene
  sun: THREE.DirectionalLight
  colliders: Colliders
  pads: Pad[]
  /** Penalty props. */
  stadium: {
    goalZ: number
    spotZ: number
    ball: THREE.Group
    keeperSpot: THREE.Vector3
    board: THREE.Mesh // canvas screen on the scoreboard
    boardCanvas: HTMLCanvasElement
  }
  /** The parked car (the driveable one is the same object, moved onto the circuit). */
  car: THREE.Group
  carPark: { x: number; z: number; yaw: number }
  update: (dt: number, t: number) => void
}

let seed = 1234
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

export function buildHub(assets: SportsAssets | null, track: Track, circuit: THREE.Object3D): Hub {
  seed = 1234
  const scene = new THREE.Scene()
  const colliders = new Colliders()
  const animated: ((dt: number, t: number) => void)[] = []

  /* Sky and light. */
  scene.background = new THREE.Color('#9fd4ff')
  scene.fog = new THREE.Fog('#cfe8ff', 220, 620)
  const sky = new Sky()
  sky.scale.setScalar(3000)
  const u = sky.material.uniforms
  u.turbidity.value = 2.4
  u.rayleigh.value = 1.3
  u.mieCoefficient.value = 0.004
  u.mieDirectionalG.value = 0.8
  const sunDir = new THREE.Vector3(0.5, 0.75, 0.32).normalize()
  u.sunPosition.value.copy(sunDir).multiplyScalar(1000)
  scene.add(sky)
  scene.add(new THREE.HemisphereLight('#e3f2ff', '#56743a', 1.15))
  const sun = new THREE.DirectionalLight('#fff3dc', 2.5)
  sun.position.copy(sunDir).multiplyScalar(120)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const sc = sun.shadow.camera
  sc.left = sc.bottom = -60
  sc.right = sc.top = 60
  sc.near = 10
  sc.far = 360
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.05
  scene.add(sun, sun.target)
  sun.userData.dir = sunDir

  /* Ground, plaza and paths. */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grassTexture(220), roughness: 1 }))
  ground.receiveShadow = true
  scene.add(ground)
  scene.add(circuit)

  const paveMat = (rx: number, ry: number, layer = 1) => decal(new THREE.MeshStandardMaterial({ map: pavingTexture([rx, ry]), roughness: 0.95 }), layer)
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.plaza_radius, 64).rotateX(-Math.PI / 2), paveMat(9, 9, 2))
  plaza.position.y = 0.03
  plaza.receiveShadow = true
  scene.add(plaza)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.plaza_radius, 0.28, 6, 64).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cbbfa8', roughness: 0.9 }))
  rim.position.y = 0.05
  rim.receiveShadow = true
  scene.add(rim)
  const path = (x1: number, z1: number, x2: number, z2: number, w: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), paveMat(w / 4, len / 4))
    m.position.set((x1 + x2) / 2, 0.025, (z1 + z2) / 2)
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1)
    m.receiveShadow = true
    scene.add(m)
  }
  const [spx, spz] = CONFIG.stadium_pad
  const [hpx, hpz] = CONFIG.hall_pad
  const [fpx, fpz] = CONFIG.f1_pad
  path(0, -CONFIG.plaza_radius + 1, 0, spz - 4, 6)
  path(CONFIG.plaza_radius - 1, 0, hpx + 4, hpz, 6)
  path(-CONFIG.plaza_radius + 1, 0, -64, 0, 6)
  path(0, CONFIG.plaza_radius - 1, 0, 44, 6)
  path(fpx, fpz, fpx, 0, 4)
  // Apron in front of the garage.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(14, 22).rotateX(-Math.PI / 2), decal(new THREE.MeshStandardMaterial({ color: '#8b9099', roughness: 0.9 }), 2))
  apron.position.set(-63, 0.028, 0)
  apron.receiveShadow = true
  scene.add(apron)

  const add = (name: ModelName, dims: [number | null, number | null, number | null], x: number, z: number, yaw = 0, y = 0) => {
    const o = fit(model(assets, name), dims)
    o.position.set(x, y, z)
    o.rotation.y = yaw
    scene.add(o)
    return o
  }

  /* Centre piece: podium and trophy on a round plinth, flags around the plaza. */
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.7, 0.7, 32), new THREE.MeshStandardMaterial({ color: '#e7dcc6', roughness: 0.85 }))
  plinth.position.y = 0.35
  plinth.castShadow = plinth.receiveShadow = true
  scene.add(plinth)
  add('podium', [null, null, 5], 0, 0, yawFromX(0, 1), 0.7)
  const trophy = add('trophy', [null, 1.3, null], 0, 0.1, 0, 0.7 + 2.05)
  animated.push((_dt, t) => (trophy.rotation.y = t * 0.6))
  colliders.circle(0, 0, 3.7)

  // Eight flags between the four paths (never on a path's axis).
  const flagColors = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#38bdf8', '#a855f7', '#ec4899']
  const flags: THREE.Mesh[] = []
  flagColors.forEach((c, i) => {
    const a = (i / flagColors.length) * Math.PI * 2 + Math.PI / 8
    const x = Math.cos(a) * (CONFIG.plaza_radius - 1.4), z = Math.sin(a) * (CONFIG.plaza_radius - 1.4)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 8, 8), new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.6, roughness: 0.35 }))
    pole.position.set(x, 4, z)
    pole.castShadow = true
    scene.add(pole)
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3, 8, 1).translate(1.1, 0, 0), new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 }))
    flag.position.set(x, 7.2, z)
    flag.castShadow = true
    scene.add(flag)
    flags.push(flag)
    colliders.circle(x, z, 0.2)
  })
  animated.push((_dt, t) => {
    flags.forEach((f, i) => {
      f.rotation.y = -0.6 + Math.sin(t * 1.3 + i) * 0.25
      f.rotation.x = Math.sin(t * 2.1 + i * 2) * 0.05
    })
  })

  /* Stadium (north): half pitch, goal, three stands, four floodlights, the scoreboard. */
  const goalZ = CONFIG.goal_line_z
  const pitchZ = goalZ + CONFIG.pitch_half_l - 1.5
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.pitch_half_w * 2, CONFIG.pitch_half_l * 2).rotateX(-Math.PI / 2),
    decal(new THREE.MeshStandardMaterial({ map: pitchTexture(CONFIG.pitch_half_w, CONFIG.pitch_half_l), roughness: 0.95 }), 1),
  )
  pitch.position.set(0, 0.035, pitchZ)
  pitch.receiveShadow = true
  scene.add(pitch)
  const goalDepth = 2.3
  add('goal', [goalDepth, CONFIG.goal_height + 0.12, CONFIG.goal_width + 0.3], 0, goalZ - goalDepth / 2, yawFromX(0, 1))
  colliders.box(0, goalZ - goalDepth / 2, CONFIG.goal_width / 2 + 0.2, goalDepth / 2)
  const standLen = 46, standDepth = 14, standH = 12
  const sideX = CONFIG.pitch_half_w + 3 + standDepth / 2
  for (const side of [1, -1]) {
    // Seats face -Z in the model; turn them to face the pitch.
    add('grandstand', [standLen, standH, standDepth], side * sideX, pitchZ - 2, side > 0 ? Math.PI / 2 : -Math.PI / 2)
    colliders.box(side * sideX, pitchZ - 2, standDepth / 2, standLen / 2)
  }
  const northZ = goalZ - goalDepth - 3 - standDepth / 2
  add('grandstand', [36, standH - 2, standDepth], 0, northZ, Math.PI)
  colliders.box(0, northZ, 18, standDepth / 2)
  const floodM: THREE.Matrix4[] = []
  for (const [x, z] of [
    [-(sideX + 9), goalZ - 6],
    [sideX + 9, goalZ - 6],
    [-(sideX + 9), pitchZ + CONFIG.pitch_half_l + 2],
    [sideX + 9, pitchZ + CONFIG.pitch_half_l + 2],
  ]) {
    floodM.push(trs(x, 0, z, yawFromX(-x, pitchZ - z)))
    colliders.circle(x, z, 1.4)
  }
  scene.add(instanced(fit(model(assets, 'floodlight'), [null, 26, null]), floodM))
  // Scoreboard in the corner between the west and north stands, turned to the penalty spot.
  const spotZ = goalZ + CONFIG.penalty_dist
  const sbX = -24, sbZ = goalZ - 9, sbW = 10
  const sbYaw = yawFromX(0 - sbX, spotZ - sbZ)
  const sb = add('scoreboard', [null, null, sbW], sbX, sbZ, sbYaw)
  colliders.box(sbX, sbZ, 0.8, sbW / 2, sbYaw)
  const boardCanvas = document.createElement('canvas')
  boardCanvas.width = 1024
  boardCanvas.height = 512
  const boardTex = new THREE.CanvasTexture(boardCanvas)
  boardTex.colorSpace = THREE.SRGBColorSpace
  const sbH = sbW * 0.788
  const board = new THREE.Mesh(new THREE.PlaneGeometry(sbW * 0.93, sbH * 0.6), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }))
  // Screen: front face (+X), upper part of the board.
  board.position.set(sbW * 0.154 * 0.5 + 0.06, sbH * (0.5 + 0.17), 0)
  board.rotation.y = Math.PI / 2
  sb.add(board)
  // Pitch-side boards along both touchlines.
  const adTex = labelTexture('SPORTS COMPLEX  ·  SCORE TO UNLOCK  ·  SPORTS COMPLEX', { bg: '#0b1220', fg: '#fde047', w: 2048, h: 128 })
  for (const side of [1, -1]) {
    const ad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, CONFIG.pitch_half_l * 1.6), [
      new THREE.MeshBasicMaterial({ map: adTex, toneMapped: false }),
      new THREE.MeshBasicMaterial({ map: adTex, toneMapped: false }),
      new THREE.MeshStandardMaterial({ color: '#0b1220' }),
      new THREE.MeshStandardMaterial({ color: '#0b1220' }),
      new THREE.MeshStandardMaterial({ color: '#0b1220' }),
      new THREE.MeshStandardMaterial({ color: '#0b1220' }),
    ])
    ad.position.set(side * (CONFIG.pitch_half_w + 0.6), 0.45, pitchZ - 2)
    ad.castShadow = true
    scene.add(ad)
    colliders.box(side * (CONFIG.pitch_half_w + 0.6), pitchZ - 2, 0.15, CONFIG.pitch_half_l * 0.8)
  }
  const ball = fit(model(assets, 'ball'), [null, CONFIG.ball_radius * 2, null])
  ball.children[0].position.y -= CONFIG.ball_radius // centre the ball on its group origin
  ball.position.set(0, CONFIG.ball_radius, spotZ)
  scene.add(ball)
  add('cart', [null, 2, null], 9, spz + 3, yawFromX(-1, 0.3))
  colliders.box(9, spz + 3, 1.4, 0.9, yawFromX(-1, 0.3))

  /* F1 (west): pit garage, the car out front, barrels and a show car on a turntable. */
  const [gx, gz] = CONFIG.garage_center
  add('pit-garage', [null, null, 16], gx, gz, 0)
  colliders.box(gx, gz, 5.9, 8.1)
  const carPark = { x: -62, z: 3, yaw: Math.PI / 2 }
  const car = new THREE.Group()
  const carModel = fit(model(assets, 'f1car'), [CONFIG.car_length, 1.45, 2.5])
  carModel.rotation.order = 'ZYX' // roll (z) about the car's forward axis, after the turn below
  carModel.rotation.y = -Math.PI / 2 // nose +X → +Z (the game's forward)
  car.add(carModel)
  car.position.set(carPark.x, 0, carPark.z)
  car.rotation.y = carPark.yaw
  scene.add(car)
  colliders.box(carPark.x, carPark.z, 1.25, 2.6, carPark.yaw)
  add('barrels', [null, 1.4, null], gx + 6.5, gz - 9.5, 0.4)
  add('barrels', [null, 1.4, null], gx + 7.5, gz + 9.6, -0.8)
  colliders.circle(gx + 6.5, gz - 9.5, 1.1)
  colliders.circle(gx + 7.5, gz + 9.6, 1.1)
  const turn = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.5, 40), new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.5, roughness: 0.4 }))
  disc.position.y = 0.25
  disc.receiveShadow = true
  turn.add(disc)
  const show = fit(model(assets, 'f1-car'), [5, null, null])
  show.position.y = 0.5
  turn.add(show)
  turn.position.set(-34, 0, -12)
  scene.add(turn)
  colliders.circle(-34, -12, 3.8)
  animated.push((_dt, t) => (show.rotation.y = t * 0.35))

  /* Rally hall (east). */
  const [hx, hz] = CONFIG.hall_center
  const [hw, hh, hd] = CONFIG.hall_size
  add('sports-hall', [hw, hh, hd], hx, hz, Math.PI) // entrance (+X) turned to face the plaza
  colliders.box(hx, hz, hw / 2, hd / 2)

  /* Paths: lamps and benches; signposts at the plaza exits. */
  const lampM: THREE.Matrix4[] = []
  const benchSpots: [number, number, number][] = []
  for (let z = -24; z > spz + 2; z -= 12) {
    lampM.push(trs(4.6, 0, z, 0), trs(-4.6, 0, z - 6, Math.PI))
    colliders.circle(4.6, z, 0.3)
    colliders.circle(-4.6, z - 6, 0.3)
    benchSpots.push([5.4, z - 6, -Math.PI / 2])
  }
  for (let x = 24; x < hpx - 2; x += 12) {
    lampM.push(trs(x, 0, 4.6, -Math.PI / 2), trs(x + 6, 0, -4.6, Math.PI / 2))
    colliders.circle(x, 4.6, 0.3)
    colliders.circle(x + 6, -4.6, 0.3)
    benchSpots.push([x + 6, 5.4, Math.PI])
  }
  for (let x = -24; x > -46; x -= 12) {
    lampM.push(trs(x, 0, 4.6, -Math.PI / 2), trs(x - 6, 0, -4.6, Math.PI / 2))
    colliders.circle(x, 4.6, 0.3)
    colliders.circle(x - 6, -4.6, 0.3)
    benchSpots.push([x - 6, 5.4, Math.PI])
  }
  for (let z = 24; z < 44; z += 12) {
    lampM.push(trs(4.6, 0, z, 0), trs(-4.6, 0, z + 6, Math.PI))
    colliders.circle(4.6, z, 0.3)
    colliders.circle(-4.6, z + 6, 0.3)
  }
  scene.add(instanced(fit(model(assets, 'lamp'), [null, 6.2, null]), lampM))
  const benchM = benchSpots.map(([x, z, yaw]) => {
    // Bench front is +Z: face the path.
    colliders.box(x, z, 0.95, 0.4, yaw)
    return trs(x, 0, z, yaw)
  })
  scene.add(instanced(fit(model(assets, 'bench'), [1.9, null, null]), benchM))
  for (const [x, z, yaw] of [
    [6.5, -CONFIG.plaza_radius - 3, 0.3],
    [CONFIG.plaza_radius + 3, -6.5, 1.2],
    [-CONFIG.plaza_radius - 3, 6.5, -2],
  ]) {
    add('signpost', [null, 2.8, null], x, z, yaw)
    colliders.circle(x, z, 0.4)
  }

  /* Pads and their labels. */
  const pads: Pad[] = [
    makePad('stadium', spx, spz, 'STADIUM', 'Take penalties in the stadium', '#22c55e'),
    makePad('hall', hpx, hpz, 'RALLY HALL', 'Enter the rally hall', '#38bdf8'),
    makePad('f1', fpx, fpz, 'F1 CIRCUIT', 'Drive the career lap', '#ef4444'),
  ]
  for (const p of pads) scene.add(p.group)

  /* Trees, bushes and rocks: scattered in the open, clear of paths, venues, pads and the circuit. */
  const clear = (x: number, z: number, pad: number) => {
    if (Math.hypot(x, z) < CONFIG.plaza_radius + 6) return false
    if (Math.abs(x) < 7 && z < 50 && z > spz - 6) return false // north/south paths
    if (Math.abs(z) < 7 && x > -70 && x < hpx + 6) return false // east/west paths
    if (Math.abs(x) < sideX + 14 && z < pitchZ + CONFIG.pitch_half_l + 8 && z > northZ - 12) return false // stadium
    if (x > hx - hw / 2 - 12 && x < hx + hw / 2 + 6 && Math.abs(z - hz) < hd / 2 + 6) return false // hall
    if (x < gx + 18 && x > gx - 10 && Math.abs(z - gz) < 16) return false // garage and apron
    if (pads.some((p) => Math.hypot(p.x - x, p.z - z) < 6)) return false
    if (colliders.blocked(x, z, pad)) return false
    const i = track.nearest(x, z)
    return track.offset(i, x, z) * track.inner > CONFIG.track_half_width + CONFIG.track_runoff + 4
  }
  const treeKinds: [ModelName, number][] = [
    ['palm', 8],
    ['pine', 9],
    ['autumn-tree', 7.5],
  ]
  const treeMats: THREE.Matrix4[][] = treeKinds.map(() => [])
  // Palms ring the plaza.
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.31
    const x = Math.cos(a) * (CONFIG.plaza_radius + 4.5), z = Math.sin(a) * (CONFIG.plaza_radius + 4.5)
    if (Math.abs(x) < 6 || Math.abs(z) < 6) continue
    treeMats[0].push(trs(x, 0, z, rnd() * 6, 0.9 + rnd() * 0.25))
    colliders.circle(x, z, 0.5)
  }
  for (let k = 0, placed = 0; k < 2000 && placed < 120; k++) {
    const x = -140 + rnd() * 320, z = -190 + rnd() * 320
    if (!clear(x, z, 3)) continue
    const kind = rnd() < 0.55 ? 1 : 2
    treeMats[kind].push(trs(x, 0, z, rnd() * 6, 0.8 + rnd() * 0.45))
    colliders.circle(x, z, 0.7)
    placed++
  }
  treeKinds.forEach(([name, h], i) => scene.add(instanced(fit(model(assets, name), [null, h, null]), treeMats[i])))
  const bushM: THREE.Matrix4[] = []
  const rockM: THREE.Matrix4[] = []
  for (let k = 0, placed = 0; k < 1500 && placed < 70; k++) {
    const x = -130 + rnd() * 300, z = -180 + rnd() * 300
    if (!clear(x, z, 1.5)) continue
    if (rnd() < 0.6) bushM.push(trs(x, 0, z, rnd() * 6, 0.8 + rnd() * 0.6))
    else {
      rockM.push(trs(x, 0, z, rnd() * 6, 0.7 + rnd() * 0.8))
      colliders.circle(x, z, 0.8)
    }
    placed++
  }
  // Bushes line the plaza's paths too.
  for (const [x, z] of [
    [7.5, -24],
    [-7.5, -30],
    [7.5, -42],
    [24, 7.5],
    [36, -7.5],
    [-28, 7.5],
    [-40, -7.5],
    [7.5, 30],
    [-7.5, 36],
  ]) bushM.push(trs(x, 0, z, rnd() * 6, 0.9))
  scene.add(instanced(fit(model(assets, 'bush'), [null, 1.3, null]), bushM))
  scene.add(instanced(fit(model(assets, 'rocks'), [null, 1.4, null]), rockM))

  /* Balloons drifting over the complex. */
  const balloons: THREE.Object3D[] = []
  for (let k = 0; k < 2; k++) {
    const b = fit(model(assets, 'balloon'), [null, 14, null], 'cast')
    b.position.set(-60 + k * 150, 62 + k * 14, -40 + k * 30)
    scene.add(b)
    balloons.push(b)
  }
  animated.push((dt, t) => {
    balloons.forEach((b, i) => {
      b.position.x += dt * (0.8 + i * 0.4)
      if (b.position.x > 220) b.position.x = -220
      b.position.y += Math.sin(t * 0.4 + i) * dt * 0.3
    })
  })

  return {
    scene,
    sun,
    colliders,
    pads,
    stadium: { goalZ, spotZ, ball, keeperSpot: new THREE.Vector3(0, 0, goalZ + 0.35), board, boardCanvas },
    car,
    carPark,
    update: (dt, t) => {
      for (const f of animated) f(dt, t)
      for (const p of pads) animatePad(p, t, false)
    },
  }
}
