// BOGEY BRAWL engine: one hole played by everyone at once. Swings, the ball race, melee, items, hazards,
// checkpoints, scoring, the third-person camera and the HUD feed.
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { CONFIG, deg } from './config'
import { Course } from './course'
import { Ground, launch, stepBall, type BallMode } from './ball'
import { Golfer, type ItemType, type MoveInput, type Personality } from './golfer'
import { makeGolfer, prop, type GolfAssets, type PropName } from './assets'
import { aiThink } from './ai'
import { Particles, Trail } from '../racer/fx'
import { isMuted } from '../lib/sound'

export type Phase = 'intro' | 'play' | 'overtime' | 'results'

export const ITEM_INFO: Record<ItemType, { name: string; color: string; enabled: boolean }> = {
  rocket: { name: 'Rocket Launcher', color: '#f97316', enabled: true },
  pistol: { name: 'Dueling Pistol', color: '#facc15', enabled: true },
  shield: { name: 'Electromagnet', color: '#38bdf8', enabled: true },
  landmine: { name: 'Landmine', color: '#ef4444', enabled: false },
  laser: { name: 'Orbital Laser', color: '#e879f9', enabled: false },
  airhorn: { name: 'Air Horn', color: '#a3e635', enabled: false },
  cart: { name: 'Golf Cart', color: '#f8fafc', enabled: false },
  coffee: { name: 'Coffee', color: '#a16207', enabled: false },
  springboots: { name: 'Spring Boots', color: '#22d3ee', enabled: false },
  elephant: { name: 'Elephant Gun', color: '#78716c', enabled: false },
  driver: { name: 'Rocket Driver', color: '#fb7185', enabled: false },
  freeze: { name: 'Freeze Bomb', color: '#bae6fd', enabled: false },
}

const PLAYERS: { name: string; color: string; personality: Personality }[] = [
  { name: 'You', color: '#3b82f6', personality: 'Golfer' },
  { name: 'Mulligan', color: '#ef4444', personality: 'Griefer' },
  { name: 'Birdie', color: '#facc15', personality: 'Golfer' },
  { name: 'Divot', color: '#22c55e', personality: 'Sniper' },
]

export interface GolfOptions {
  difficulty: number
  bots: number // 1–3
  assets: GolfAssets | null
  autopilot?: boolean
}

export interface Hud {
  phase: Phase
  hole: { name: string; biome: string; par: number }
  time: number
  overtime: boolean
  board: { id: number; name: string; color: string; strokes: number; points: number; finished: boolean; place: number; me: boolean }[]
  items: (ItemType | null)[]
  active: number
  power: number | null
  loft: number
  putt: boolean
  canSwing: boolean
  strokes: number
  boost: number
  shield: number
  protect: number
  stun: number
  respawn: number
  lockOn: boolean
  markers: { id: number; x: number; y: number; color: string; dist: number; me: boolean }[]
  feed: { id: number; text: string; mine: boolean }[]
  popups: { id: number; text: string; color: string; x: number; y: number; age: number }[]
  banner: { text: string; color: string } | null
  hint: string
  locked: boolean
}

export interface ResultRow {
  id: number
  name: string
  color: string
  me: boolean
  place: number // finishing place (0 = did not finish)
  strokes: number
  breakdown: { label: string; points: number }[]
  total: number
}

export interface HoleResult {
  rows: ResultRow[]
  highlight: string
  par: number
  name: string
}

interface Rocket {
  owner: Golfer
  target: Golfer | null
  pos: THREE.Vector3
  vel: THREE.Vector3
  life: number
  mesh: THREE.Object3D
  trail: Trail
}

interface Case {
  pos: THREE.Vector3
  ready: boolean
  timer: number
  mesh: THREE.Object3D
  item?: ItemType // a dropped item lying on the ground instead of a briefcase
}

export class Game {
  readonly opts: GolfOptions
  readonly course = new Course()
  readonly ground: Ground
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
  readonly renderer: THREE.WebGLRenderer
  readonly fx = new Particles(1500, true)
  readonly smoke = new Particles(800, false)
  golfers: Golfer[] = []
  me!: Golfer
  cases: Case[] = []
  rockets: Rocket[] = []
  phase: Phase = 'intro'
  time = 0
  phaseTime = 0
  holeTime: number
  onHud: ((h: Hud) => void) | null = null
  onResult: ((r: HoleResult) => void) | null = null

  private container: HTMLElement
  private raf = 0
  private last = 0
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private mouseDown = false
  private mousePressed = false
  private mouseReleased = false
  private rightPressed = false
  private wheel = 0
  private camYaw = 0
  private camPitch = 0.28
  private locked = false
  private finishedCount = 0
  private feedList: { id: number; text: string; mine: boolean; age: number }[] = []
  private popups: { id: number; text: string; color: string; pos: THREE.Vector3; age: number }[] = []
  private nextId = 0
  private banner: { text: string; color: string; t: number } | null = null
  private aimLine: THREE.Points
  private checkpointMeshes: THREE.Group[] = []
  private shieldMeshes = new Map<Golfer, THREE.Mesh>()
  private tracers: { line: THREE.Line; t: number }[] = []
  private sheep: { obj: THREE.Object3D; target: THREE.Vector3; wait: number }[] = []
  private balloons: THREE.Object3D[] = []
  private sun: THREE.DirectionalLight
  private resultSent = false
  private audio: AudioContext | null = null
  private ro: ResizeObserver
  private shake = 0

  constructor(container: HTMLElement, opts: GolfOptions) {
    this.container = container
    this.opts = opts
    this.ground = new Ground(this.course)
    this.holeTime = this.course.hole.par <= 3 ? CONFIG.hole_time_par3 : this.course.hole.par === 4 ? CONFIG.hole_time_par4 : CONFIG.hole_time_par5

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.9
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'golf-canvas'
    container.appendChild(this.renderer.domElement)

    this.buildWorld()
    this.spawnGolfers()

    const pts = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(90 * 3), 3))
    this.aimLine = new THREE.Points(pts, new THREE.PointsMaterial({ color: '#ffffff', size: 0.28, transparent: true, opacity: 0.9, depthWrite: false }))
    this.aimLine.frustumCulled = false
    this.aimLine.visible = false
    this.scene.add(this.aimLine)
    this.scene.add(this.fx.points, this.smoke.points)

    this.sun = this.scene.getObjectByName('sun') as THREE.DirectionalLight
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    const el = this.renderer.domElement
    el.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    document.addEventListener('pointerlockchange', this.onLockChange)
    this.camYaw = Math.atan2(this.course.hole.route[1][0], this.course.hole.route[1][1])
    this.say(`${this.course.hole.name} · Par ${this.course.hole.par}`, '#fde047', 3)
  }

  /* ---------- World ---------- */

  private buildWorld() {
    const s = this.scene
    const a = this.opts.assets
    s.background = new THREE.Color('#9fd4ff')
    s.fog = new THREE.Fog('#bfe3ff', 260, 900)
    const sky = new Sky()
    sky.scale.setScalar(4000)
    const u = sky.material.uniforms
    u.turbidity.value = 2.2
    u.rayleigh.value = 1.4
    u.mieCoefficient.value = 0.004
    u.mieDirectionalG.value = 0.8
    const sunDir = new THREE.Vector3(0.45, 0.62, -0.35).normalize()
    u.sunPosition.value.copy(sunDir).multiplyScalar(1000)
    s.add(sky)
    s.add(new THREE.HemisphereLight('#dff1ff', '#5b7a3a', 1.1))
    const sun = new THREE.DirectionalLight('#fff4dd', 2.4)
    sun.name = 'sun'
    sun.position.copy(sunDir).multiplyScalar(120)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const sc = sun.shadow.camera
    sc.left = sc.bottom = -70
    sc.right = sc.top = 70
    sc.near = 10
    sc.far = 400
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.04
    s.add(sun, sun.target)

    s.add(this.course.buildMesh())
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#2b9fd6', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }),
    )
    water.position.y = 0.02
    s.add(water)

    // Tee mat and markers.
    const tee = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 5), new THREE.MeshStandardMaterial({ color: '#4ade80', roughness: 0.9 }))
    tee.position.set(0, this.course.tee.y + 0.04, 0)
    tee.receiveShadow = true
    s.add(tee)
    for (const x of [-4, 4]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshStandardMaterial({ color: '#f8fafc' }))
      m.position.set(x, this.course.tee.y + 0.25, 1.5)
      s.add(m)
    }

    // Cup and flag.
    const cup = this.course.cup
    const hole = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.cup_radius, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b0f0a' }))
    hole.position.set(cup.x, this.ground.y(cup.x, cup.z) + 0.03, cup.z)
    s.add(hole)
    s.add(a?.props.flag ? place(prop(a.props.flag, 3.2), cup.x + 0.05, this.ground.y(cup.x, cup.z), cup.z) : fallbackFlag(cup, this.ground))

    // Trees: instanced per model.
    const groups = new Map<string, THREE.Matrix4[]>()
    for (const t of this.course.trees) {
      const list = groups.get(t.kind) ?? []
      list.push(new THREE.Matrix4().compose(new THREE.Vector3(t.x, this.ground.y(t.x, t.z) - 0.1, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0)), new THREE.Vector3(t.scale, t.scale, t.scale)))
      groups.set(t.kind, list)
    }
    const treeModel: Record<string, PropName> = { tree: 'tree', pine: 'pine', autumn: 'autumn-tree', palm: 'palm' }
    const treeHeight: Record<string, number> = { tree: 7, pine: 9, autumn: 7.5, palm: 8 }
    for (const [kind, mats] of groups) {
      const src = a?.props[treeModel[kind]]
      s.add(src ? instanced(prop(src, treeHeight[kind]), mats) : fallbackTrees(mats, kind))
    }

    // Briefcases.
    for (const p of this.course.briefcases) {
      const mesh = new THREE.Group()
      mesh.add(a?.props.briefcase ? prop(a.props.briefcase, 1.1) : new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 0.4), new THREE.MeshStandardMaterial({ color: '#7c3aed' })))
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#a855f7', transparent: true, opacity: 0.55, depthWrite: false }))
      glow.position.y = -0.55
      mesh.add(glow)
      mesh.position.set(p.x, p.y + 0.8, p.z)
      s.add(mesh)
      this.cases.push({ pos: p.clone(), ready: true, timer: 0, mesh })
    }

    // Checkpoints: floating rings, red until you pass them.
    for (const c of this.course.checkpoints) {
      const g = new THREE.Group()
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 28), new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#7f1d1d' }))
      ring.position.y = 3.2
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#e5e7eb' }))
      pole.position.y = 1.6
      g.add(ring, pole)
      g.position.copy(c)
      s.add(g)
      this.checkpointMeshes.push(g)
    }

    // Scenery: clubhouse, benches, cart, windmill, rocks, bushes, sheep, tractor, signpost, balloons.
    const addProp = (name: PropName, size: number, x: number, z: number, yaw = 0, collide = 0, h = 5) => {
      const src = a?.props[name]
      if (!src) return null
      const obj = place(prop(src, size), x, this.ground.y(x, z) - 0.05, z)
      obj.rotation.y = yaw
      s.add(obj)
      if (collide) this.course.trees.push({ x, z, r: collide, kind: 'prop', scale: 1, yaw, h })
      return obj
    }
    addProp('clubhouse', 11, -28, -26, 0.5, 9, 12)
    addProp('tractor', 2.6, -12, -36, 1.4, 2)
    addProp('barrels', 1.3, -18, -15, 0, 1)
    addProp('signpost', 2.6, -6, 3, Math.PI / 2, 0.4)
    addProp('cart', 1.9, 7, -4, -0.3, 1.4, 2)
    addProp('bench', 1.0, -7, -6, 0.2, 0.9, 1.2)
    addProp('bench', 1.0, this.course.hole.green[0] + 22, this.course.hole.green[1] + 6, -1.6, 0.9, 1.2)
    addProp('podium', 1.8, -16, -42, 0.5, 2.2)
    addProp('trophy', 1.2, -16, -42.2 + 0, 0.5)
    addProp('windmill', 16, -58, 205, 0.8, 4, 16)
    addProp('windmill', 13, 255, 60, -0.6, 3.5, 14)
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0, placed = 0; k < 400 && placed < 26; k++) {
      const x = -60 + rnd() * 320, z = -40 + rnd() * 360
      const d = this.course.routeNearest(x, z).dist
      if (d < 16 || this.ground.y(x, z) < 1 || this.course.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 5)) continue
      const rock = rnd() < 0.45
      if (addProp(rock ? 'rocks' : 'bush', rock ? 1.6 + rnd() * 1.4 : 1.1 + rnd() * 0.5, x, z, rnd() * 6, rock ? 1.4 : 0)) placed++
    }
    // A flock in the rough on the far side of the lake.
    for (let k = 0; k < 7; k++) {
      const x = 120 + rnd() * 30, z = 60 + rnd() * 30
      const obj = addProp('sheep', 1.1, x, z, rnd() * 6)
      if (obj) this.sheep.push({ obj, target: new THREE.Vector3(x, 0, z), wait: rnd() * 5 })
    }
    for (let k = 0; k < 3; k++) {
      const src = a?.props.balloon
      if (!src) break
      const b = prop(src, 14)
      b.position.set(-80 + k * 160, 70 + k * 18, 120 + k * 60)
      s.add(b)
      this.balloons.push(b)
    }
  }

  private spawnGolfers() {
    const skill = CONFIG.ai_skill[this.opts.difficulty] ?? 0.55
    const count = 1 + Math.max(1, Math.min(3, this.opts.bots))
    for (let i = 0; i < count; i++) {
      const p = PLAYERS[i]
      const human = i === 0
      const rig = makeGolfer(this.opts.assets, p.color)
      const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: p.color, emissiveIntensity: 0.25 }))
      ballMesh.castShadow = true
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.7 }))
      marker.position.y = 1.2
      ballMesh.add(marker)
      const tee = this.course.tee.clone()
      const g = new Golfer(i, p.name, p.color, human, human ? 1 : THREE.MathUtils.clamp(skill + (Math.random() - 0.5) * 0.1, 0.2, 0.95), p.personality, rig, ballMesh, tee)
      // Balls in a row on the tee, golfers behind them.
      const x = (i - (count - 1) / 2) * 2
      g.ball.pos.set(x, this.ground.y(x, 0.5) + CONFIG.ball_radius, 0.5)
      g.pos.set(x, this.ground.y(x, -1.2), -1.2)
      g.yaw = 0
      this.scene.add(rig.root, ballMesh)
      this.golfers.push(g)
      if (human) this.me = g
    }
    for (const g of this.golfers) {
      const bubble = new THREE.Mesh(
        new THREE.SphereGeometry(CONFIG.shield_block_radius, 20, 14),
        new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      bubble.position.y = 0.95
      bubble.visible = false
      g.rig.root.add(bubble)
      this.shieldMeshes.set(g, bubble)
    }
  }

  /* ---------- Lifecycle ---------- */

  start() {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    void this.audio?.close()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** Test hook (?snap): advance without the live loop. */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    this.frame(step, true)
  }

  debugState() {
    return {
      phase: this.phase,
      time: +this.time.toFixed(1),
      golfers: this.golfers.map((g) => ({
        name: g.name, strokes: g.strokes, ball: g.ball.mode, bx: +g.ball.pos.x.toFixed(1), bz: +g.ball.pos.z.toFixed(1), x: +g.pos.x.toFixed(1), z: +g.pos.z.toFixed(1),
        finished: g.finished, place: g.finishPlace, items: g.inventory.join(','), ko: g.knockouts, stun: +g.stun.toFixed(1), cp: g.passed.size,
      })),
      rockets: this.rockets.length,
      feed: this.feedList.map((f) => f.text),
    }
  }

  /* ---------- Input ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.code
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) e.preventDefault()
    if (e.metaKey || e.ctrlKey) return
    if (!this.keys.has(k)) this.pressed.add(k)
    this.keys.add(k)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    this.mouseDown = false
  }

  private onMouseDown = (e: MouseEvent) => {
    this.ensureAudio()
    if (!this.locked) {
      this.renderer.domElement.requestPointerLock?.()
      return
    }
    if (e.button === 0) {
      this.mouseDown = true
      this.mousePressed = true
    } else if (e.button === 2) this.rightPressed = true
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 && this.mouseDown) {
      this.mouseDown = false
      this.mouseReleased = true
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return
    this.camYaw -= e.movementX * 0.0032
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * 0.0024, -0.15, 1.1)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.wheel += Math.sign(e.deltaY)
  }

  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement
  }

  /* ---------- Frame ---------- */

  private frame(dt: number, render = true) {
    this.time += dt
    this.phaseTime += dt
    const pressed = this.pressed
    this.pressed = new Set()

    if (this.phase === 'intro' && this.phaseTime > 3) this.setPhase('play')
    if (this.phase === 'play' && this.phaseTime >= this.holeTime) {
      if (this.golfers.some((g) => !g.finished)) {
        this.setPhase('overtime')
        this.say('OVERTIME', '#f87171', 2)
        this.beep(220, 0.4)
      } else this.endHole()
    }
    if (this.phase === 'overtime' && this.phaseTime >= CONFIG.overtime) {
      for (const g of this.golfers) if (!g.finished) g.timedOut = true
      this.endHole()
    }
    if ((this.phase === 'play' || this.phase === 'overtime') && this.golfers.every((g) => g.finished)) this.endHole()

    const playing = this.phase === 'play' || this.phase === 'overtime'
    // Human input.
    let move: MoveInput | null = null
    if (playing && !this.opts.autopilot) move = this.humanInput(pressed)
    // Wheel adjusts loft.
    if (this.wheel !== 0) {
      this.me.loft = THREE.MathUtils.clamp(this.me.loft - this.wheel * deg(4), deg(CONFIG.loft_min), deg(CONFIG.loft_max))
      this.wheel = 0
    }

    for (const g of this.golfers) {
      const m = g === this.me && !this.opts.autopilot ? move : playing ? aiThink(this, g, dt) : null
      g.update(dt, m, this.ground, this.course, this.golfers)
      if (g.charging > 0) g.charging += dt
      this.afterMove(g, dt)
    }
    // Balls.
    for (const g of this.golfers) {
      const ev = stepBall(g.ball, dt, this.ground, this.course)
      if (ev.holed) this.holed(g)
      if (ev.water) {
        this.splash(g.ball.pos)
        this.startRespawn(g)
      }
      if (ev.bounced && this.near(g.ball.pos, 60)) this.beep(140, 0.05, 'triangle', 0.05)
      // Players nudge loose balls they run into.
      if (g.ball.mode === 'rest') {
        for (const o of this.golfers) {
          if (o.respawn > 0) continue
          const dx = g.ball.pos.x - o.pos.x, dz = g.ball.pos.z - o.pos.z
          const d = Math.hypot(dx, dz)
          const sp = o.vel.length()
          if (d < 0.55 && sp > 4 && o.charging <= 0) {
            g.ball.vel.set((dx / d) * sp * 0.5, 0, (dz / d) * sp * 0.5)
            g.ball.mode = 'rolling'
          }
        }
      }
      g.ballMesh.position.copy(g.ball.pos)
      g.ballMesh.visible = g.ball.mode !== 'holed'
    }
    this.updateRockets(dt)
    this.updateCases(dt)
    this.updateEffects(dt)
    this.updateCamera(dt)
    if (!render) return
    this.renderer.render(this.scene, this.camera)
    this.emitHud()
  }

  private setPhase(p: Phase) {
    this.phase = p
    this.phaseTime = 0
  }

  private humanInput(pressed: Set<string>): MoveInput | null {
    const g = this.me
    const k = this.keys
    // Item slots, drop, use.
    if (pressed.has('Digit1')) g.active = 0
    if (pressed.has('Digit2')) g.active = 1
    if (pressed.has('Digit3')) g.active = 2
    if (pressed.has('KeyQ')) g.active = (g.active + 1) % 3
    if (pressed.has('KeyF')) this.drop(g)
    if (this.rightPressed) {
      this.rightPressed = false
      if (g.canAct && g.charging <= 0) this.useItem(g)
    }
    // Swing: hold to charge at your ball, release to hit; anywhere else it's a club attack.
    if (this.mousePressed) {
      this.mousePressed = false
      if (g.canAct && g.cooldown <= 0) {
        if (this.canSwing(g)) this.startCharge(g, this.camYaw)
        else this.melee(g)
      }
    }
    if (g.charging > 0) this.faceShot(g, this.camYaw)
    if (this.mouseReleased) {
      this.mouseReleased = false
      if (g.charging > 0) this.release(g, this.camYaw, g.loft)
    }
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    return {
      x, y, yaw: this.camYaw, jump: pressed.has('Space'),
      dive: pressed.has('ShiftLeft') || pressed.has('ShiftRight') || pressed.has('ControlLeft'),
      creep: k.has('KeyC') || k.has('AltLeft'),
    }
  }

  /* ---------- Swing ---------- */

  canSwing(g: Golfer) {
    return g.ball.mode === 'rest' && g.ball.pos.distanceTo(g.pos) < CONFIG.swing_reach && g.canAct
  }

  isPutt(g: Golfer) {
    return this.ground.surface(g.ball.pos.x, g.ball.pos.z) === 'green'
  }

  /** Stand beside the ball, side-on to the target (the swing clip addresses the ball facing across the line). */
  faceShot(g: Golfer, dir: number) {
    const fx = Math.sin(dir), fz = Math.cos(dir)
    // The golfer's left points at the target; the ball sits in front of their feet.
    g.yaw = dir - Math.PI / 2
    const sx = Math.sin(g.yaw), sz = Math.cos(g.yaw)
    g.pos.x = g.ball.pos.x - sx * 0.62 + fx * 0.03
    g.pos.z = g.ball.pos.z - sz * 0.62 + fz * 0.03
    g.vel.set(0, 0, 0)
  }

  startCharge(g: Golfer, dir: number) {
    if (!this.canSwing(g) || g.cooldown > 0) return
    this.faceShot(g, dir)
    g.charging = 0.0001
  }

  power(g: Golfer) {
    return Math.min(1, g.charging / CONFIG.swing_charge_time)
  }

  release(g: Golfer, dir: number, loft: number) {
    const power = Math.max(0.03, this.power(g))
    g.charging = 0
    g.swing = 0.5
    g.cooldown = CONFIG.swing_cooldown
    if (g.ball.mode !== 'rest' || g.ball.pos.distanceTo(g.pos) > CONFIG.swing_reach + 0.5) return
    const putt = this.isPutt(g)
    g.ball.vel.copy(launch(dir, power, loft, putt))
    g.ball.mode = putt ? 'rolling' : 'air'
    g.strokes++
    this.thwack(putt ? 0.4 : power)
  }

  /** A club swing with no ball nearby is a melee attack. */
  melee(g: Golfer) {
    if (!g.canAct || g.swing > 0 || g.cooldown > 0) return
    g.swing = 0.5
    g.cooldown = CONFIG.swing_cooldown
    const f = new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw))
    for (const o of this.golfers) {
      if (o === g) continue
      const d = o.pos.clone().sub(g.pos).setY(0)
      const dist = d.length()
      if (dist > CONFIG.melee_range || dist < 0.01) continue
      if (d.normalize().dot(f) < 0.25) continue
      if (this.knock(o, g, 'Club', CONFIG.melee_stun, 3, d, false)) {
        g.boost = Math.max(g.boost, CONFIG.melee_boost)
        this.whack()
      }
    }
  }

  /* ---------- Items ---------- */

  useItem(g: Golfer, target?: Golfer) {
    const it = g.inventory[g.active]
    if (!it || !ITEM_INFO[it].enabled) return false
    g.take()
    if (it === 'rocket') {
      const tgt = target ?? this.nearestRival(g, CONFIG.rocket_lock_range)
      const f = new THREE.Vector3(Math.sin(this.aimYaw(g)), 0.15, Math.cos(this.aimYaw(g))).normalize()
      const mesh = new THREE.Group()
      const src = this.opts.assets?.props.rocket
      mesh.add(src ? prop(src, 1.2, 'max') : new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f97316' })))
      const trail = new Trail('#ffb347', 0.4, 26, 1.6, true)
      this.scene.add(mesh, trail.mesh)
      this.rockets.push({ owner: g, target: tgt, pos: g.pos.clone().setY(g.pos.y + 1.4).addScaledVector(f, 1), vel: f.multiplyScalar(CONFIG.rocket_speed), life: CONFIG.rocket_lifetime, mesh, trail })
      this.beep(320, 0.25, 'sawtooth', 0.08)
    } else if (it === 'pistol') {
      // Hitscan along the aim (the camera for the player, the target for bots).
      const from = g.pos.clone().setY(g.pos.y + 1.4)
      let dir: THREE.Vector3
      if (target) dir = target.pos.clone().setY(target.pos.y + 1).sub(from).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.12 * (1 - g.skill))
      else {
        dir = new THREE.Vector3()
        this.camera.getWorldDirection(dir)
      }
      g.yaw = Math.atan2(dir.x, dir.z)
      let hit: Golfer | null = null
      let best: number = CONFIG.pistol_range
      for (const o of this.golfers) {
        if (o === g || o.respawn > 0 || o.finished) continue
        const to = o.pos.clone().setY(o.pos.y + 1).sub(from)
        const along = to.dot(dir)
        if (along < 0 || along > best) continue
        const off = to.clone().addScaledVector(dir, -along).length()
        if (off < 0.7) {
          best = along
          hit = o
        }
      }
      const end = from.clone().addScaledVector(dir, hit ? best : CONFIG.pistol_range)
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, end]), new THREE.LineBasicMaterial({ color: '#fde047', transparent: true }))
      this.scene.add(line)
      this.tracers.push({ line, t: 0.15 })
      this.fx.burst(from.clone().addScaledVector(dir, 0.6), 10, 5, 0.2, 0.5, new THREE.Color(3, 2.6, 1))
      this.bang()
      if (hit) this.knock(hit, g, 'Dueling Pistol', CONFIG.pistol_stun, 2, dir.clone().setY(0), true)
    } else if (it === 'shield') {
      g.shield = CONFIG.shield_duration
      this.beep(660, 0.3, 'sine', 0.06)
    }
    return true
  }

  selectAndUse(g: Golfer, item: ItemType, target?: Golfer) {
    const i = g.inventory.indexOf(item)
    if (i < 0) return false
    g.active = i
    return this.useItem(g, target)
  }

  private aimYaw(g: Golfer) {
    return g === this.me && !this.opts.autopilot ? this.camYaw : g.yaw
  }

  private drop(g: Golfer) {
    const it = g.take()
    if (!it) return
    const mesh = new THREE.Group()
    const src = this.opts.assets?.props[it === 'rocket' ? 'rocket' : it === 'pistol' ? 'pistol' : 'magnet']
    mesh.add(src ? prop(src, 0.9, 'max') : new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: ITEM_INFO[it].color })))
    const p = g.pos.clone().add(new THREE.Vector3(Math.sin(g.yaw), 0, Math.cos(g.yaw)).multiplyScalar(-1.5))
    p.y = this.ground.y(p.x, p.z)
    mesh.position.set(p.x, p.y + 0.6, p.z)
    this.scene.add(mesh)
    this.cases.push({ pos: p, ready: true, timer: 0, mesh, item: it })
  }

  nearestRival(g: Golfer, range: number) {
    let best: Golfer | null = null
    let bd = range
    for (const o of this.golfers) {
      if (o === g || o.finished || o.respawn > 0) continue
      const d = o.pos.distanceTo(g.pos)
      if (d < bd) {
        bd = d
        best = o
      }
    }
    return best
  }

  /** The rival furthest along the hole (homing items and AI target them). */
  leaderExcept(g: Golfer) {
    let best: Golfer | null = null
    let bp = -Infinity
    for (const o of this.golfers) {
      if (o === g || o.finished || o.respawn > 0) continue
      const p = this.course.progress(o.ball.pos.x, o.ball.pos.z)
      if (p > bp) {
        bp = p
        best = o
      }
    }
    return best
  }

  rocketOn(g: Golfer) {
    let best: { eta: number } | null = null
    for (const r of this.rockets) {
      if (r.target !== g) continue
      const eta = r.pos.distanceTo(g.pos) / CONFIG.rocket_speed
      if (!best || eta < best.eta) best = { eta }
    }
    return best
  }

  /**
   * Stun with knockback. Returns false if the hit was blocked (Shield, post-hit protection, dive i-frames).
   * Scoring: +10 knockout for the attacker; the Shield owner gets +5 per block.
   */
  knock(victim: Golfer, by: Golfer | null, weapon: string, stun: number, kbMetres: number, dir: THREE.Vector3, projectile: boolean) {
    if (victim.respawn > 0 || victim.finished) return false
    if (victim.shield > 0) {
      victim.shieldBlocks++
      this.popup(victim, `+${CONFIG.points_shield_block} BLOCK`, '#7dd3fc')
      this.fx.burst(victim.pos.clone().setY(victim.pos.y + 1), 30, 7, 0.4, 0.6, new THREE.Color(1.2, 2.4, 3))
      return false
    }
    if (victim.protect > 0) return false
    if (projectile && victim.dive > CONFIG.dive_duration - CONFIG.dive_iframes) return false
    victim.stun = stun
    victim.stunTotal = stun
    victim.charging = 0
    victim.ai.plan = null
    // Repeated hits within the window raise the post-hit protection level.
    victim.protectLevel = this.time - victim.lastKnockedAt < CONFIG.protection_window ? Math.min(CONFIG.protection_levels, victim.protectLevel + 1) : 1
    victim.lastKnockedAt = this.time
    victim.protect = stun + CONFIG.protection_duration[victim.protectLevel - 1]
    const d = dir.clone().setY(0)
    if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5)
    d.normalize()
    const kb = (kbMetres * CONFIG.knockback_multiplier) / 100
    victim.kb.copy(d).multiplyScalar((kb / CONFIG.stun_knockback_time) * 0.75)
    victim.vy = Math.max(victim.vy, 3)
    if (by) {
      by.knockouts++
      by.victims.add(victim.id)
      victim.knockedBy = { by, at: this.time }
      this.popup(by, `+${CONFIG.points_knockout} KO`, '#fde047')
      this.feed(`${by.name} knocked out ${victim.name} — ${weapon}`, by === this.me || victim === this.me)
    }
    if (victim === this.me) this.shake = Math.max(this.shake, 0.5)
    this.groan()
    return true
  }

  /* ---------- Simulation pieces ---------- */

  private afterMove(g: Golfer, dt: number) {
    // Checkpoints: pass within the radius to turn them green and move your respawn point.
    this.course.checkpoints.forEach((c, i) => {
      if (g.passed.has(i)) return
      if (Math.hypot(c.x - g.pos.x, c.z - g.pos.z) < CONFIG.checkpoint_radius) {
        g.passed.add(i)
        g.checkpoint = c.clone()
        if (g === this.me) this.beep(880, 0.12, 'triangle', 0.06)
      }
    })
    // Water or off the edge.
    if (g.respawn <= 0 && !g.finished && g.inHazard(this.ground)) {
      this.splash(g.pos)
      if (g.knockedBy && this.time - g.knockedBy.at < 4) {
        const by = g.knockedBy.by
        by.waterKnocks++
        this.popup(by, `+${CONFIG.points_water_knock} SPLASH`, '#38bdf8')
        this.feed(`${by.name} knocked ${g.name} into the water`, by === this.me || g === this.me)
      }
      this.startRespawn(g)
    }
    if (g.respawn > 0) {
      g.respawn -= dt
      if (g.respawn <= 0) this.finishRespawn(g)
    }
    // Briefcases and dropped items.
    for (const c of this.cases) {
      if (!c.ready || g.respawn > 0 || g.finished) continue
      if (Math.hypot(c.pos.x - g.pos.x, c.pos.z - g.pos.z) > 1.6) continue
      const item = c.item ?? this.rollItem()
      if (!g.give(item)) {
        if (g === this.me && this.phaseTime % 1 < dt) this.say('Inventory full · F to drop', '#f87171', 1)
        continue
      }
      if (c.item) {
        this.scene.remove(c.mesh)
        c.ready = false
        c.timer = Infinity
      } else {
        c.ready = false
        c.timer = CONFIG.briefcase_respawn
        c.mesh.visible = false
      }
      if (g === this.me) {
        this.say(ITEM_INFO[item].name, ITEM_INFO[item].color, 1.4)
        this.beep(988, 0.15, 'triangle', 0.08)
      }
    }
  }

  private rollItem(): ItemType {
    const items = CONFIG.enabled_items as ItemType[]
    let total = 0
    for (const it of items) total += CONFIG.item_weights[it] ?? 1
    let r = Math.random() * total
    for (const it of items) {
      r -= CONFIG.item_weights[it] ?? 1
      if (r <= 0) return it
    }
    return items[0]
  }

  private startRespawn(g: Golfer) {
    if (g.respawn > 0 || g.finished) return
    g.respawn = CONFIG.respawn_delay
    g.charging = 0
    g.ai.plan = null
    if (g.ball.mode !== 'holed') g.ball.mode = 'water'
    g.rig.root.visible = false
  }

  /** Back to the last green checkpoint with the ball, +1 stroke. */
  private finishRespawn(g: Golfer) {
    const c = g.checkpoint
    g.pos.set(c.x, this.ground.y(c.x, c.z), c.z)
    g.vel.set(0, 0, 0)
    g.kb.set(0, 0, 0)
    g.vy = 0
    g.stun = 0
    g.rig.root.visible = true
    const ahead = this.course.routePoint(this.course.routeNearest(c.x, c.z).s + 2)
    const bx = ahead.x, bz = ahead.z
    g.ball.pos.set(bx, this.ground.y(bx, bz) + CONFIG.ball_radius, bz)
    g.ball.vel.set(0, 0, 0)
    g.ball.mode = 'rest'
    g.strokes += CONFIG.respawn_penalty_strokes
    g.protect = Math.max(g.protect, 1.5)
    if (g === this.me) this.say(`+${CONFIG.respawn_penalty_strokes} stroke`, '#f87171', 1.2)
  }

  private holed(g: Golfer) {
    if (g.finished) return
    g.finished = true
    g.finishPlace = ++this.finishedCount
    g.charging = 0
    const pts = [CONFIG.points_first, CONFIG.points_second, CONFIG.points_third, CONFIG.points_fourth][g.finishPlace - 1] ?? CONFIG.points_fifth_plus
    this.popup(g, `+${pts} ${ordinal(g.finishPlace)}`, '#4ade80')
    const label = g.strokes === 1 ? 'HOLE IN ONE!' : g.finishPlace === 1 ? `${g.name.toUpperCase()} WINS THE HOLE` : `${g.name} holed out`
    this.say(g === this.me && g.finishPlace === 1 ? 'FIRST IN THE HOLE!' : label, g.color, 2.5)
    this.feed(`${g.name} holed out ${ordinal(g.finishPlace)} in ${g.strokes} strokes`, g === this.me)
    this.cupDrop()
    this.fx.burst(this.course.cup.clone().setY(this.course.cup.y + 0.6), 70, 9, 1.0, 0.9, new THREE.Color(g.color).multiplyScalar(2), 1, 1.5)
  }

  private endHole() {
    if (this.phase === 'results') return
    this.setPhase('results')
    const res = this.results()
    if (!this.resultSent) {
      this.resultSent = true
      this.onResult?.(res)
    }
  }

  /** Hole points: position, strokes against par, knockouts, domination, splashes, blocks, overtime penalty. */
  results(): HoleResult {
    const par = this.course.hole.par
    const rows: ResultRow[] = this.golfers.map((g) => {
      const b: { label: string; points: number }[] = []
      if (g.finished) {
        const pos = [CONFIG.points_first, CONFIG.points_second, CONFIG.points_third, CONFIG.points_fourth][g.finishPlace - 1] ?? CONFIG.points_fifth_plus
        b.push({ label: `${ordinal(g.finishPlace)} in the hole`, points: pos })
        if (g.strokes === 1) b.push({ label: 'Hole in one', points: CONFIG.points_hole_in_one })
        else if (g.strokes < par) b.push({ label: 'Under par', points: CONFIG.points_under_par })
        else if (g.strokes === par) b.push({ label: 'At par', points: CONFIG.points_at_par })
      }
      if (g.knockouts) b.push({ label: `${g.knockouts} knockout${g.knockouts > 1 ? 's' : ''}`, points: g.knockouts * CONFIG.points_knockout })
      if (g.victims.size >= CONFIG.points_domination_count) b.push({ label: 'Domination', points: CONFIG.points_domination })
      if (g.waterKnocks) b.push({ label: 'Splashed a rival', points: g.waterKnocks * CONFIG.points_water_knock })
      if (g.shieldBlocks) b.push({ label: 'Shield blocks', points: g.shieldBlocks * CONFIG.points_shield_block })
      if (g.timedOut) b.push({ label: 'Timed out in overtime', points: CONFIG.overtime_timeout_penalty })
      const total = b.reduce((a, x) => a + x.points, 0)
      g.points = total
      return { id: g.id, name: g.name, color: g.color, me: g === this.me, place: g.finishPlace, strokes: g.strokes, breakdown: b, total }
    })
    rows.sort((a, b) => b.total - a.total || a.strokes - b.strokes)
    const bully = [...this.golfers].sort((a, b) => b.knockouts - a.knockouts)[0]
    const highlight =
      bully && bully.knockouts >= 2
        ? `${bully.name} knocked out ${bully.knockouts} players`
        : this.golfers.find((g) => g.finishPlace === 1)
          ? `${this.golfers.find((g) => g.finishPlace === 1)!.name} was first in the hole`
          : 'Nobody made it to the cup'
    return { rows, highlight, par, name: this.course.hole.name }
  }

  private updateRockets(dt: number) {
    const turn = deg(CONFIG.rocket_turn_rate) * dt
    for (const r of this.rockets) {
      r.life -= dt
      const t = r.target && !r.target.finished && r.target.respawn <= 0 ? r.target : null
      if (t) {
        const want = t.pos.clone().setY(t.pos.y + 1).sub(r.pos).normalize()
        const cur = r.vel.clone().normalize()
        const angle = cur.angleTo(want)
        if (angle > 1e-3) {
          const axis = new THREE.Vector3().crossVectors(cur, want).normalize()
          if (axis.lengthSq() > 0) cur.applyAxisAngle(axis, Math.min(angle, turn))
        }
        r.vel.copy(cur.multiplyScalar(CONFIG.rocket_speed))
        if (t === this.me && Math.floor(this.time * 6) !== Math.floor((this.time - dt) * 6)) this.beep(1200, 0.05, 'square', 0.05)
      }
      r.pos.addScaledVector(r.vel, dt)
      r.mesh.position.copy(r.pos)
      r.mesh.lookAt(r.pos.clone().add(r.vel))
      r.trail.push(r.pos)
      if (Math.random() < dt * 40) this.smoke.emit(r.pos.clone(), new THREE.Vector3((Math.random() - 0.5), 1, (Math.random() - 0.5)), 1.0, 0.9, new THREE.Color(0.85, 0.85, 0.85), 0.5, 2)
      // Impact: a rival, the ground, or timeout.
      let boom = r.life <= 0 || r.pos.y < this.ground.y(r.pos.x, r.pos.z) + 0.2
      for (const o of this.golfers) {
        if (o === r.owner || o.respawn > 0 || o.finished) continue
        const reach = o.shield > 0 ? CONFIG.shield_block_radius : 1.1
        if (o.pos.clone().setY(o.pos.y + 1).distanceTo(r.pos) < reach) boom = true
      }
      if (boom) {
        r.life = -1
        this.explode(r.pos, r.owner)
      }
    }
    for (const r of this.rockets) {
      if (r.life > 0) continue
      this.scene.remove(r.mesh, r.trail.mesh)
    }
    this.rockets = this.rockets.filter((r) => r.life > 0)
  }

  private explode(at: THREE.Vector3, owner: Golfer) {
    this.fx.burst(at, 70, 14, 0.7, 2, new THREE.Color(3, 1.6, 0.4), 1, 1)
    for (let k = 0; k < 20; k++) this.smoke.emit(at.clone(), new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6), 1.8, 2.4, new THREE.Color(0.3, 0.3, 0.32), 0.7, 1.6)
    this.boom()
    if (this.near(at, 30)) this.shake = Math.max(this.shake, 0.6)
    for (const o of this.golfers) {
      if (o === owner) continue
      const d = o.pos.clone().setY(o.pos.y + 1).distanceTo(at)
      if (d < 2.6) this.knock(o, owner, 'Rocket Launcher', CONFIG.rocket_stun, CONFIG.rocket_knockback, o.pos.clone().sub(at), true)
    }
    // Blasts knock balls too.
    for (const o of this.golfers) {
      const b = o.ball
      if (b.mode === 'holed' || b.mode === 'water') continue
      const d = b.pos.distanceTo(at)
      if (d < 4) {
        const push = b.pos.clone().sub(at).setY(0).normalize().multiplyScalar((4 - d) * 3)
        b.vel.add(push).setY(2)
        b.mode = 'air'
      }
    }
  }

  private updateCases(dt: number) {
    for (const c of this.cases) {
      if (!c.ready) {
        c.timer -= dt
        if (c.timer <= 0 && !c.item) {
          c.ready = true
          c.mesh.visible = true
        }
        continue
      }
      c.mesh.rotation.y += dt * 1.2
      c.mesh.position.y = c.pos.y + 0.8 + Math.sin(this.time * 2 + c.pos.x) * 0.15
    }
  }

  private updateEffects(dt: number) {
    for (const g of this.golfers) {
      const rig = g.rig
      rig.root.position.copy(g.pos)
      rig.root.rotation.y = g.yaw
      // Ragdoll-ish stun: topple over, then get back up.
      const down = g.stun > 0 ? Math.min(1, (g.stunTotal - g.stun) / 0.25, g.stun / 0.35) : 0
      rig.body.rotation.x += (down * -1.35 - rig.body.rotation.x) * Math.min(1, dt * 14)
      rig.body.position.y = down * 0.25
      this.shieldMeshes.get(g)!.visible = g.shield > 0
      // Blink while protected.
      rig.root.visible = g.respawn <= 0 && (g.protect <= 0 || g.stun > 0 || Math.floor(this.time * 10) % 2 === 0)
      if (rig.mixer) {
        const a = rig.actions
        const moving = g.vel.length() > 0.6 && g.stun <= 0
        const want = g.charging > 0 || g.swing > 0 ? 'swing' : moving ? 'run' : 'idle'
        // Crossfade only on a change of state (a paused swing is still the current clip).
        if (want !== rig.current && a[want]) {
          const next = a[want]!
          const prev = rig.current ? a[rig.current] : undefined
          next.reset().setEffectiveWeight(1).play()
          if (prev) next.crossFadeFrom(prev, 0.15, false)
          rig.current = want
        }
        if (a.run) a.run.timeScale = g.vel.length() / CONFIG.run_speed * 1.1
        if (a.swing) {
          // golf_drive clip: address 0–0.3 s, top of the backswing ~1.0 s, impact ~1.2 s, follow-through to ~1.6 s.
          // Charging holds the backswing (deeper with power); releasing snaps to just before impact and plays through.
          if (g.charging > 0) {
            a.swing.paused = true
            a.swing.time = 0.3 + 0.65 * this.power(g)
            rig.swingPhase = 'hold'
          } else if (g.swing > 0) {
            if (rig.swingPhase !== 'out') {
              a.swing.paused = false
              a.swing.time = rig.swingPhase === 'hold' ? 1.12 : 0.92 // a melee swipe starts from the top
              a.swing.timeScale = 1.4
              rig.swingPhase = 'out'
            }
          } else rig.swingPhase = null
        }
        rig.mixer.update(dt)
      }
      if (g.boost > 0 && Math.random() < dt * 20) this.fx.emit(g.pos.clone().setY(g.pos.y + 0.2), new THREE.Vector3(0, 1, 0), 0.4, 0.4, new THREE.Color(2.5, 2.2, 0.6), 0.6)
    }
    // Checkpoint colours from the player's progress.
    this.checkpointMeshes.forEach((m, i) => {
      const ring = m.children[0] as THREE.Mesh
      const mat = ring.material as THREE.MeshStandardMaterial
      const done = this.me.passed.has(i)
      mat.color.set(done ? '#22c55e' : '#ef4444')
      mat.emissive.set(done ? '#14532d' : '#7f1d1d')
      ring.rotation.y += dt * 0.8
    })
    for (const tr of this.tracers) {
      tr.t -= dt
      ;(tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.t / 0.15)
      if (tr.t <= 0) this.scene.remove(tr.line)
    }
    this.tracers = this.tracers.filter((t) => t.t > 0)
    // Sheep wander; balloons drift.
    for (const s of this.sheep) {
      s.wait -= dt
      if (s.wait <= 0) {
        s.target.set(120 + Math.random() * 30, 0, 60 + Math.random() * 30)
        s.wait = 4 + Math.random() * 6
      }
      const d = s.target.clone().sub(s.obj.position).setY(0)
      if (d.length() > 0.5) {
        d.normalize()
        s.obj.position.addScaledVector(d, dt * 0.6)
        s.obj.rotation.y = Math.atan2(d.x, d.z)
        s.obj.position.y = this.ground.y(s.obj.position.x, s.obj.position.z)
      }
    }
    for (const [i, b] of this.balloons.entries()) {
      b.position.x += dt * (1.2 + i * 0.3)
      b.position.y += Math.sin(this.time * 0.3 + i) * dt * 0.4
      if (b.position.x > 360) b.position.x = -160
    }
    this.fx.update(dt)
    this.smoke.update(dt)
    for (const f of this.feedList) f.age += dt
    this.feedList = this.feedList.filter((f) => f.age < 6)
    for (const p of this.popups) p.age += dt
    this.popups = this.popups.filter((p) => p.age < 1.6)
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }
  }

  private updateCamera(dt: number) {
    const cam = this.camera
    const g = this.me
    const k = 1 - Math.exp(-dt * 8)
    let pos: THREE.Vector3, look: THREE.Vector3
    if (this.phase === 'intro') {
      // Fly from the green back to the tee.
      const t = Math.min(1, this.phaseTime / 3)
      const e = t * t * (3 - 2 * t)
      const green = this.course.cup
      pos = new THREE.Vector3().lerpVectors(new THREE.Vector3(green.x - 30, 60, green.z - 40), new THREE.Vector3(0, 9, -14), e)
      look = new THREE.Vector3().lerpVectors(green, new THREE.Vector3(0, 3, 20), e)
      cam.position.copy(pos)
      cam.lookAt(look)
      this.aimLine.visible = false
      return
    }
    if (g.finished || this.phase === 'results') {
      // Spectator: a wide view of the green.
      const c = this.course.cup
      pos = new THREE.Vector3(c.x - Math.sin(this.time * 0.1) * 45, 28, c.z - Math.cos(this.time * 0.1) * 45)
      look = c.clone()
    } else if (g.charging > 0 || (this.canSwing(g) && !this.opts.autopilot)) {
      // Behind the ball looking down the aim line.
      const yaw = this.camYaw
      const b = g.ball.pos
      pos = new THREE.Vector3(b.x - Math.sin(yaw) * 5.2, b.y + 2.4 + this.camPitch * 2, b.z - Math.cos(yaw) * 5.2)
      look = new THREE.Vector3(b.x + Math.sin(yaw) * 12, b.y + 0.8, b.z + Math.cos(yaw) * 12)
    } else {
      const yaw = this.camYaw
      const dist = 6.5
      const h = 1.6 + Math.sin(this.camPitch) * dist
      pos = new THREE.Vector3(g.pos.x - Math.sin(yaw) * Math.cos(this.camPitch) * dist, g.pos.y + h, g.pos.z - Math.cos(yaw) * Math.cos(this.camPitch) * dist)
      look = new THREE.Vector3(g.pos.x + Math.sin(yaw) * 4, g.pos.y + 1.4, g.pos.z + Math.cos(yaw) * 4)
    }
    pos.y = Math.max(pos.y, this.ground.y(pos.x, pos.z) + 0.6)
    cam.position.lerp(pos, k)
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake
      cam.position.y += (Math.random() - 0.5) * this.shake
      this.shake = Math.max(0, this.shake - dt * 2)
    }
    cam.lookAt(look)
    // The sun's shadow box follows the player.
    this.sun.target.position.set(g.pos.x, g.pos.y, g.pos.z)
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(0.45, 0.62, -0.35).multiplyScalar(140))
    this.updateAimLine()
  }

  /** Dotted preview of the shot (loft arc and roll) at the current charge. */
  private updateAimLine() {
    const g = this.me
    const show = !g.finished && (g.charging > 0 || this.canSwing(g)) && !this.opts.autopilot
    this.aimLine.visible = show
    if (!show) return
    const power = g.charging > 0 ? Math.max(0.15, this.power(g)) : 0.5
    const putt = this.isPutt(g)
    const b = { pos: g.ball.pos.clone(), vel: launch(this.camYaw, power, g.loft, putt), mode: (putt ? 'rolling' : 'air') as BallMode }
    const arr = (this.aimLine.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array
    let n = 0
    for (let i = 0; i < 90 && n < 90; i++) {
      for (let s = 0; s < 2; s++) stepBall(b, 1 / 30, this.ground, this.course)
      arr.set([b.pos.x, b.pos.y + 0.05, b.pos.z], n * 3)
      n++
      if (b.mode === 'rest' || b.mode === 'water' || b.mode === 'holed') break
    }
    for (let i = n; i < 90; i++) arr.set([b.pos.x, b.pos.y, b.pos.z], i * 3)
    this.aimLine.geometry.attributes.position.needsUpdate = true
  }

  /* ---------- HUD ---------- */

  private feed(text: string, mine: boolean) {
    this.feedList.push({ id: this.nextId++, text, mine, age: 0 })
    if (this.feedList.length > 5) this.feedList.shift()
  }

  private popup(g: Golfer, text: string, color: string) {
    this.popups.push({ id: this.nextId++, text, color, pos: g.pos.clone().setY(g.pos.y + 2.3), age: 0 })
  }

  private say(text: string, color: string, t: number) {
    this.banner = { text, color, t }
  }

  private near(p: THREE.Vector3, r: number) {
    return p.distanceTo(this.me.pos) < r
  }

  private project(p: THREE.Vector3) {
    const v = p.clone().project(this.camera)
    if (v.z > 1) return null
    return { x: (v.x * 0.5 + 0.5) * this.container.clientWidth, y: (-v.y * 0.5 + 0.5) * this.container.clientHeight }
  }

  private emitHud() {
    if (!this.onHud) return
    const g = this.me
    const ranked = [...this.golfers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      return this.course.progress(b.ball.pos.x, b.ball.pos.z) - this.course.progress(a.ball.pos.x, a.ball.pos.z)
    })
    const markers: Hud['markers'] = []
    for (const o of this.golfers) {
      if (o.ball.mode === 'holed') continue
      const s = this.project(o.ball.pos.clone().setY(o.ball.pos.y + 2.6))
      if (s) markers.push({ id: o.id, x: s.x, y: s.y, color: o.color, dist: Math.round(o.ball.pos.distanceTo(this.course.cup)), me: o === g })
    }
    const popups: Hud['popups'] = []
    for (const p of this.popups) {
      const s = this.project(p.pos)
      if (s) popups.push({ id: p.id, text: p.text, color: p.color, x: s.x, y: s.y - p.age * 40, age: p.age })
    }
    const timeLeft = this.phase === 'overtime' ? CONFIG.overtime - this.phaseTime : this.phase === 'play' ? this.holeTime - this.phaseTime : this.holeTime
    const canSwing = this.canSwing(g)
    this.onHud({
      phase: this.phase,
      hole: { name: this.course.hole.name, biome: this.course.hole.biome, par: this.course.hole.par },
      time: Math.max(0, timeLeft),
      overtime: this.phase === 'overtime',
      board: ranked.map((o, i) => ({ id: o.id, name: o.name, color: o.color, strokes: o.strokes, points: o.knockouts * CONFIG.points_knockout, finished: o.finished, place: i + 1, me: o === g })),
      items: [...g.inventory],
      active: g.active,
      power: g.charging > 0 ? this.power(g) : null,
      loft: Math.round((g.loft * 180) / Math.PI),
      putt: this.isPutt(g),
      canSwing,
      strokes: g.strokes,
      boost: g.boost,
      shield: g.shield,
      protect: g.stun > 0 ? 0 : g.protect,
      stun: g.stun,
      respawn: g.respawn,
      lockOn: !!this.rocketOn(g),
      markers,
      feed: this.feedList.map(({ id, text, mine }) => ({ id, text, mine })),
      popups,
      banner: this.banner ? { text: this.banner.text, color: this.banner.color } : null,
      hint: g.finished
        ? 'You holed out. Watch the others race the clock.'
        : canSwing
          ? this.isPutt(g)
            ? 'Hold left click to putt · release to hit'
            : 'Hold left click to charge · scroll for loft · release to swing'
          : 'Run to your ball · left click near a rival to swing your club',
      locked: this.locked || !!this.opts.autopilot,
    })
  }

  /* ---------- Audio ---------- */

  private ensureAudio() {
    if (this.audio) return
    try {
      this.audio = new AudioContext()
    } catch {
      this.audio = null
    }
  }

  private beep(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08) {
    const a = this.audio
    if (!a || isMuted()) return
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, a.currentTime)
    g.gain.setValueAtTime(gain, a.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur)
    o.connect(g).connect(a.destination)
    o.start()
    o.stop(a.currentTime + dur + 0.02)
  }

  private noise(dur: number, gain: number, freq: number) {
    const a = this.audio
    if (!a || isMuted()) return
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
    const src = a.createBufferSource()
    src.buffer = buf
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = freq
    const g = a.createGain()
    g.gain.value = gain
    src.connect(f).connect(g).connect(a.destination)
    src.start()
  }

  private thwack(power: number) {
    this.noise(0.08, 0.35 + power * 0.3, 3500)
    this.beep(180 + power * 120, 0.12, 'triangle', 0.12)
  }

  private whack() {
    this.noise(0.12, 0.5, 1800)
  }

  private bang() {
    this.noise(0.18, 0.6, 2500)
  }

  private boom() {
    this.noise(0.9, 0.7, 600)
    this.beep(60, 0.5, 'sine', 0.3)
  }

  private groan() {
    this.beep(160, 0.35, 'sawtooth', 0.04)
  }

  private splash(at: THREE.Vector3) {
    this.fx.burst(at.clone().setY(0.3), 40, 6, 0.8, 0.8, new THREE.Color(1.6, 2.2, 2.6), 0.9, 2)
    if (this.near(at, 60)) this.noise(0.4, 0.3, 1200)
  }

  private cupDrop() {
    this.beep(523, 0.12, 'triangle', 0.1)
    window.setTimeout(() => this.beep(784, 0.25, 'triangle', 0.1), 110)
  }
}

/* ---------- Helpers ---------- */

function ordinal(n: number) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`
}

function place(obj: THREE.Object3D, x: number, y: number, z: number) {
  obj.position.set(x, y, z)
  return obj
}

function instanced(model: THREE.Object3D, matrices: THREE.Matrix4[]) {
  const group = new THREE.Group()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length)
    const tmp = new THREE.Matrix4()
    matrices.forEach((mat, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mat, m.matrixWorld)))
    im.castShadow = true
    im.receiveShadow = true
    im.computeBoundingSphere()
    group.add(im)
  })
  return group
}

function fallbackTrees(matrices: THREE.Matrix4[], kind: string) {
  const g = new THREE.Group()
  const canopy = new THREE.InstancedMesh(
    kind === 'pine' ? new THREE.ConeGeometry(2.2, 6, 7).translate(0, 5, 0) : new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5, 0),
    new THREE.MeshStandardMaterial({ color: kind === 'autumn' ? '#d97706' : '#2f7d32', flatShading: true }),
    matrices.length,
  )
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: '#7c4a21', flatShading: true }), matrices.length)
  matrices.forEach((m, i) => {
    canopy.setMatrixAt(i, m)
    trunk.setMatrixAt(i, m)
  })
  canopy.castShadow = trunk.castShadow = true
  g.add(canopy, trunk)
  return g
}

function fallbackFlag(cup: THREE.Vector3, ground: Ground) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), new THREE.MeshStandardMaterial({ color: '#f8fafc' }))
  pole.position.y = 1.5
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshStandardMaterial({ color: '#ef4444', side: THREE.DoubleSide }))
  flag.position.set(0.5, 2.6, 0)
  g.add(pole, flag)
  g.position.set(cup.x, ground.y(cup.x, cup.z), cup.z)
  return g
}
