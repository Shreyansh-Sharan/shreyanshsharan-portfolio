// SPORTS COMPLEX engine: one renderer, two scenes (the outdoor complex and the rally hall interior), the walking avatar,
// and the three venue modes (F1 career drive, penalty shootout, rally games). Unlocks are saved as you play.
import * as THREE from 'three'
import { CONFIG, type Sport } from './config'
import { disposeTree, makeAvatar, makeKeeper, type SportsAssets } from './assets'
import { Track } from './track'
import { buildHub, type Hub, type Pad } from './world'
import { Walker } from './player'
import { Drive, type DriveHud, type LapEvent } from './f1'
import { Penalty, type PenaltyHud } from './penalty'
import { Hall, type RallyHud } from './rally'
import { Sfx } from './audio'
import { ACHIEVEMENTS, ROLES, SKILLS, TIER_COLOR, fmtTime, loadProgress, saveProgress, type Progress } from './progress'

export type Mode = 'hub' | 'hall' | 'drive' | 'penalty' | 'rally'

export interface Toast {
  id: number
  kind: 'trophy' | 'skill' | 'role' | 'lap'
  label: string
  title: string
  sub: string
  color: string
}

export interface Hud {
  mode: Mode
  locked: boolean
  prompt: { text: string; color: string } | null
  progress: { roles: number; rolesTotal: number; trophies: number; trophiesTotal: number; skills: number; skillsTotal: number; bestLap: number | null }
  markers: { id: string; label: string; color: string; x: number; y: number; dist: number }[]
  drive: DriveHud | null
  role: { index: number; title: string; tagline: string; org: string; period: string; color: string } | null
  penalty: PenaltyHud | null
  rally: RallyHud | null
  toasts: Toast[]
  hint: string
}

export interface SportsOptions {
  assets: SportsAssets | null
  difficulty: number
  /** Test mode: no live loop, advance with simulate(). */
  snap?: boolean
  /** Esc / back from the hub: return to the menu. */
  onExit?: () => void
}

const LEFT = ['KeyA', 'ArrowLeft']
const RIGHT = ['KeyD', 'ArrowRight']
const UP = ['KeyW', 'ArrowUp']
const DOWN = ['KeyS', 'ArrowDown']

const _target = new THREE.Vector3()
const _camPos = new THREE.Vector3()
const _proj = new THREE.Vector3()
const _sunOff = new THREE.Vector3()

export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.25, 2500)
  readonly track: Track
  readonly hub: Hub
  readonly hall: Hall
  readonly walker: Walker
  readonly drive: Drive
  readonly penalty: Penalty
  readonly sfx = new Sfx()
  mode: Mode = 'hub'
  progress: Progress
  onHud: ((h: Hud) => void) | null = null
  autopilot = false

  private opts: SportsOptions
  private container: HTMLElement
  private raf = 0
  private last = 0
  private time = 0
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private pressedNow = new Set<string>() // swapped with `pressed` each frame (no per-frame allocation)
  private locked = false
  private unlockedAt = -1
  private camYaw = Math.PI
  private camPitch = 0.3
  private camSnap = true
  private nearPad: Pad | null = null
  private toasts: (Toast & { t: number })[] = []
  private toastId = 0
  private roleBanner: { index: number; t: number } | null = null
  private hudT = 0
  private rect = { left: 0, top: 0, width: 1, height: 1 }
  private ro: ResizeObserver
  private mouseDown = false
  private freeCam: { p: THREE.Vector3; l: THREE.Vector3 } | null = null

  constructor(container: HTMLElement, opts: SportsOptions) {
    this.container = container
    this.opts = opts
    this.progress = loadProgress()

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.className = 'racer-canvas sc-canvas'
    container.appendChild(this.renderer.domElement)

    this.track = new Track(ROLES.length)
    const circuit = this.track.build(opts.assets, ROLES)
    this.hub = buildHub(opts.assets, this.track, circuit)
    this.walker = new Walker(makeAvatar(opts.assets))
    this.hub.scene.add(this.walker.rig.root)
    const [sx, sz] = CONFIG.spawn
    this.walker.place(sx, sz, Math.PI)

    this.drive = new Drive(this.hub.car, this.track, ROLES, this.progress.bestLap, this.progress.bestSectors)
    this.drive.onEvent = this.onLapEvent
    this.penalty = new Penalty(this.hub, makeKeeper(opts.assets), this.walker, this.sfx, opts.difficulty)
    this.penalty.onGoal = this.onGoal
    this.penalty.onKickResult = (r) => {
      this.progress.kicks++
      if (r === 'goal') this.progress.goals++
      saveProgress(this.progress)
    }
    this.hall = new Hall(opts.assets, this.walker, this.sfx, opts.difficulty)
    this.hall.onPoint = (won) => {
      if (won) this.unlockSkills(1, 'Point won')
    }
    this.hall.onStreak = (_sport, n) => this.unlockSkills(1, `${n}-shot rally bonus`)
    this.hall.onMatch = (won, sport) => {
      if (!won) return
      this.progress.rallyWins[sport]++
      this.unlockSkills(CONFIG.rally_win_bonus, 'Match won')
    }

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    const el = this.renderer.domElement
    el.addEventListener('mousedown', this.onMouseDown)
    el.addEventListener('contextmenu', this.onContext)
    document.addEventListener('pointerlockchange', this.onLockChange)
  }

  /* ---------- Lifecycle ---------- */

  start() {
    this.last = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = THREE.MathUtils.clamp((now - this.last) / 1000, 0, 0.05)
      this.last = now
      this.frame(dt, true)
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
    const el = this.renderer.domElement
    el.removeEventListener('mousedown', this.onMouseDown)
    el.removeEventListener('contextmenu', this.onContext)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    if (document.pointerLockElement === el) document.exitPointerLock()
    saveProgress(this.progress)
    this.sfx.dispose()
    this.walker.rig.mixer?.stopAllAction()
    // Lights own their shadow-map render targets.
    this.hub.sun.dispose()
    this.hall.sun.dispose()
    disposeTree(this.hub.scene)
    disposeTree(this.hall.scene)
    disposeTree(this.walker.rig.root)
    this.hub.scene.clear()
    this.hall.scene.clear()
    this.renderer.renderLists.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss() // free the GL context now rather than at garbage collection
    el.remove()
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const r = this.container.getBoundingClientRect()
    this.rect = { left: r.left, top: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) }
  }

  /* ---------- Input ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.code
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'Tab'].includes(k)) e.preventDefault()
    this.sfx.ensure()
    if (!this.keys.has(k)) this.pressed.add(k)
    this.keys.add(k)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    if (this.mouseDown && this.mode === 'penalty') this.penalty.release()
    this.mouseDown = false
  }

  private onContext = (e: Event) => e.preventDefault()

  private onMouseDown = (e: MouseEvent) => {
    this.sfx.ensure()
    if (this.mode === 'hub' || this.mode === 'hall') {
      if (!this.locked) this.renderer.domElement.requestPointerLock?.()
      return
    }
    if (e.button !== 0) return
    this.mouseDown = true
    if (this.mode === 'penalty') {
      this.aimAt(e.clientX, e.clientY)
      this.penalty.press()
    } else if (this.mode === 'rally') this.hall.hit()
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0 || !this.mouseDown) return
    this.mouseDown = false
    if (this.mode === 'penalty') this.penalty.release()
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.locked && (this.mode === 'hub' || this.mode === 'hall')) {
      this.camYaw -= e.movementX * CONFIG.mouse_sens
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + e.movementY * CONFIG.mouse_sens * 0.75, CONFIG.cam_min_pitch, CONFIG.cam_max_pitch)
    } else if (this.mode === 'penalty') this.aimAt(e.clientX, e.clientY)
  }

  private aimAt(cx: number, cy: number) {
    const r = this.rect
    this.penalty.pointer(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, this.camera)
  }

  private onLockChange = () => {
    const was = this.locked
    this.locked = document.pointerLockElement === this.renderer.domElement
    if (was && !this.locked) this.unlockedAt = performance.now()
  }

  private axis(neg: string[], pos: string[]) {
    return (pos.some((k) => this.keys.has(k)) ? 1 : 0) - (neg.some((k) => this.keys.has(k)) ? 1 : 0)
  }

  /* ---------- Frame ---------- */

  private frame(dt: number, render: boolean) {
    this.time += dt
    // Keys pressed since the last frame; the other set collects the next frame's presses.
    const pressed = this.pressed
    this.pressed = this.pressedNow
    this.pressedNow = pressed
    this.pressed.clear()
    const esc = pressed.has('Escape')
    const interact = pressed.has('KeyE')

    switch (this.mode) {
      case 'hub':
      case 'hall': {
        const hall = this.mode === 'hall'
        this.walker.update(
          dt,
          {
            x: this.axis(LEFT, RIGHT),
            y: this.axis(DOWN, UP),
            run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
            jump: pressed.has('Space'),
            camYaw: this.camYaw,
          },
          hall ? this.collideHall : this.collideHub,
        )
        this.nearPad = this.findPad(hall ? this.hall.pads : this.hub.pads)
        if (interact && this.nearPad) this.usePad(this.nearPad)
        // Esc while the mouse is already free leaves the complex (not the Esc that just released it).
        else if (esc && !this.locked && performance.now() - this.unlockedAt > 300 && !this.opts.snap) this.opts.onExit?.()
        break
      }
      case 'drive': {
        const input = this.autopilot
          ? this.drive.autopilot()
          : {
              throttle: this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0,
              brake: this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('Space') ? 1 : 0,
              steer: this.axis(LEFT, RIGHT),
            }
        this.drive.update(dt, input)
        this.sfx.engineUpdate(this.drive.speed, input.throttle)
        if (pressed.has('KeyR')) this.drive.recover()
        if (interact || esc) this.exitDrive()
        break
      }
      case 'penalty': {
        if (pressed.has('Space')) {
          // Keyboard shot: a solid, well-struck kick at the current aim.
          if (this.penalty.phase === 'done') this.penalty.press()
          else if (this.penalty.phase === 'aim') this.penalty.shoot(this.penalty.aim.x, this.penalty.aim.y, 0.72)
        }
        this.penalty.update(dt)
        if (interact || esc) this.exitPenalty()
        break
      }
      case 'rally': {
        if (pressed.has('Space')) this.hall.hit()
        if (interact || esc) this.stopRally()
        break
      }
    }
    if (this.mode !== 'penalty') this.penalty.idle(dt)
    if (this.mode === 'hall' || this.mode === 'rally') this.hall.update(dt, this.mode === 'rally' ? this.axis(LEFT, RIGHT) : 0)
    else this.hub.update(dt, this.time)
    if (this.mode !== 'rally' && this.mode !== 'drive') this.walker.animate(dt)
    else if (this.mode === 'rally') this.walker.rig.mixer?.update(dt)

    if (this.roleBanner) {
      this.roleBanner.t -= dt
      if (this.roleBanner.t <= 0) this.roleBanner = null
    }
    for (const t of this.toasts) t.t -= dt
    if (this.toasts.length && this.toasts[0].t <= 0) this.toasts = this.toasts.filter((t) => t.t > 0)

    this.updateCamera(dt)
    if (!render) return
    const scene = this.mode === 'hall' || this.mode === 'rally' ? this.hall.scene : this.hub.scene
    this.renderer.render(scene, this.camera)
    this.hudT += dt
    if (this.hudT >= 1 / 30 || this.opts.snap) {
      this.hudT = 0
      this.emitHud()
    }
  }

  private collideHub = (p: THREE.Vector3) => {
    this.hub.colliders.resolve(p, CONFIG.player_radius)
    this.track.keepInside(p, CONFIG.player_radius)
    const d = Math.hypot(p.x, p.z)
    if (d > CONFIG.hub_bounds) p.multiplyScalar(CONFIG.hub_bounds / d)
  }

  private collideHall = (p: THREE.Vector3) => {
    this.hall.colliders.resolve(p, CONFIG.player_radius)
  }

  private findPad(pads: Pad[]) {
    let best: Pad | null = null
    let bd = CONFIG.interact_radius
    for (const p of pads) {
      const d = Math.hypot(p.x - this.walker.pos.x, p.z - this.walker.pos.z)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  private usePad(p: Pad) {
    switch (p.id) {
      case 'f1':
        return this.enterDrive()
      case 'stadium':
        return this.enterPenalty()
      case 'hall':
        return this.enterHall()
      case 'badminton':
      case 'tabletennis':
        return this.startRally(p.id)
      case 'exit':
        return this.exitHall()
    }
  }

  /* ---------- Mode switches ---------- */

  private freeMouse() {
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
  }

  enterDrive() {
    this.freeMouse()
    this.mode = 'drive'
    this.walker.rig.root.visible = false
    this.drive.toGrid()
    this.sfx.engineStart()
    this.camSnap = true
    this.camera.fov = 62
    this.camera.updateProjectionMatrix()
  }

  exitDrive() {
    this.sfx.engineStop()
    const c = this.hub.carPark
    this.hub.car.position.set(c.x, 0, c.z)
    this.hub.car.rotation.set(0, c.yaw, 0)
    this.hub.car.children[0]?.rotation.set(0, -Math.PI / 2, 0)
    this.walker.rig.root.visible = true
    const [x, z] = CONFIG.f1_pad
    this.walker.place(x + 4.4, z + 1, Math.PI / 2)
    this.camYaw = Math.PI / 2
    this.toHub()
  }

  enterPenalty() {
    this.freeMouse()
    this.mode = 'penalty'
    this.penalty.difficulty = this.opts.difficulty
    this.penalty.enter()
    this.camSnap = true
  }

  exitPenalty() {
    this.penalty.exit()
    const [x, z] = CONFIG.stadium_pad
    this.walker.place(x, z + 4.4, 0)
    this.camYaw = 0
    this.toHub()
  }

  enterHall() {
    this.mode = 'hall'
    this.hall.scene.add(this.walker.rig.root)
    const [x, z] = CONFIG.hall_door_inside
    this.walker.place(x, z, Math.PI)
    this.camYaw = Math.PI
    this.camPitch = 0.3
    this.camSnap = true
    this.sfx.beep(660, 0.1, 'triangle', 0.05)
  }

  exitHall() {
    this.hub.scene.add(this.walker.rig.root)
    const [x, z] = CONFIG.hall_pad
    this.walker.place(x - 4.4, z, -Math.PI / 2)
    this.camYaw = -Math.PI / 2
    this.toHub()
  }

  startRally(sport: Sport) {
    this.freeMouse()
    this.mode = 'rally'
    this.hall.difficulty = this.opts.difficulty
    this.hall.autoplay = this.autopilot
    this.hall.start(sport)
    this.camSnap = true
  }

  stopRally() {
    const sport = this.hall.sport ?? 'badminton'
    this.hall.stop()
    this.mode = 'hall'
    const p = this.hall.pads.find((x) => x.id === sport)
    if (p) this.walker.place(p.x - 3.2, p.z, Math.PI / 2)
    this.camYaw = Math.PI / 2
    this.camSnap = true
    this.saveNow()
  }

  private toHub() {
    this.mode = 'hub'
    this.camPitch = 0.3
    this.camSnap = true
    this.camera.fov = 62
    this.camera.updateProjectionMatrix()
    this.saveNow()
  }

  private saveNow() {
    this.progress.bestStreak = Math.max(this.progress.bestStreak, this.hall.best)
    saveProgress(this.progress)
  }

  /* ---------- Unlocks ---------- */

  private toast(t: Omit<Toast, 'id'>, life = 4.2) {
    this.toasts.push({ ...t, id: ++this.toastId, t: life })
    if (this.toasts.length > 3) this.toasts.shift()
  }

  private onLapEvent = (e: LapEvent) => {
    if (e.kind === 'bump') {
      this.sfx.thud()
      return
    }
    if (e.kind === 'start') this.sfx.beep(880, 0.25, 'square', 0.05)
    if (e.kind === 'lap' && e.time !== undefined) {
      this.progress.laps++
      this.progress.lastLap = e.time
      if (e.best) this.progress.bestLap = e.time
      this.progress.bestSectors = [...this.drive.bestSectors]
      this.toast({ kind: 'lap', label: e.best ? 'Best lap' : `Lap ${this.drive.lap - 1}`, title: fmtTime(e.time), sub: e.best ? 'Saved as your best lap' : `Best ${fmtTime(this.progress.bestLap)}`, color: e.best ? '#c084fc' : '#e2e8f0' })
      saveProgress(this.progress)
    }
    if (e.kind === 'sector') {
      const role = ROLES[e.sector]
      if (!role) return
      this.roleBanner = { index: e.sector, t: CONFIG.role_banner_time }
      this.sfx.beep(740, 0.12, 'triangle', 0.05)
      if (!this.progress.roles.includes(role.id)) {
        this.progress.roles.push(role.id)
        this.toast({ kind: 'role', label: 'Role unlocked', title: role.title, sub: `${role.org} · ${role.period}`, color: role.color })
        this.sfx.unlock()
        saveProgress(this.progress)
      }
    }
  }

  private onGoal = () => {
    const i = this.progress.trophies
    if (i < ACHIEVEMENTS.length) {
      const a = ACHIEVEMENTS[i]
      this.progress.trophies++
      this.toast({ kind: 'trophy', label: `Achievement unlocked · ${a.tier}`, title: a.name, sub: `${a.issuer} · ${a.kind}`, color: TIER_COLOR[a.tier] })
      this.penalty.drawBoard(`TROPHY ${this.progress.trophies}/${ACHIEVEMENTS.length}`)
      window.setTimeout(() => this.sfx.unlock(), 500)
    }
    saveProgress(this.progress)
  }

  private unlockSkills(n: number, why: string) {
    for (let k = 0; k < n; k++) {
      const i = this.progress.skills
      if (i >= SKILLS.length) break
      const s = SKILLS[i]
      this.progress.skills++
      this.toast({ kind: 'skill', label: `Skill unlocked · ${why}`, title: s.skill, sub: s.branch, color: '#7dd3fc' })
    }
    this.sfx.unlock()
    saveProgress(this.progress)
  }

  /* ---------- Camera ---------- */

  private updateCamera(dt: number) {
    const cam = this.camera
    const snap = this.camSnap
    this.camSnap = false
    const sun = this.mode === 'hall' || this.mode === 'rally' ? null : this.hub.sun
    if (this.freeCam) {
      cam.position.copy(this.freeCam.p)
      cam.lookAt(this.freeCam.l)
      _target.copy(this.freeCam.l)
      _target.y = 0
    } else switch (this.mode) {
      case 'drive':
        this.drive.camera(cam, dt, snap)
        _target.set(this.drive.x, 0, this.drive.z)
        break
      case 'penalty':
        this.penalty.camera(cam, dt, snap)
        _target.set(0, 0, this.hub.stadium.spotZ - 5)
        break
      case 'rally':
        this.hall.camera(cam, dt, snap)
        break
      default: {
        const p = this.walker.pos
        _target.set(p.x, p.y + 1.55, p.z)
        let dist = CONFIG.cam_dist
        const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch)
        const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw)
        // Pull in rather than end up inside a building or through a wall.
        const cols = this.mode === 'hall' ? this.hall.colliders : this.hub.colliders
        for (; dist > 1.2; dist -= 0.5) {
          const x = _target.x - fx * cp * dist, z = _target.z - fz * cp * dist
          if (!cols.blocked(x, z, 0.3)) break
        }
        _camPos.set(_target.x - fx * cp * dist, Math.max(0.35, _target.y + sp * dist), _target.z - fz * cp * dist)
        if (this.mode === 'hall') _camPos.y = Math.min(_camPos.y, 9.2)
        const k = snap ? 1 : 1 - Math.exp(-dt * 12)
        cam.position.lerp(_camPos, k)
        cam.lookAt(_target)
        if (Math.abs(cam.fov - 62) > 0.1) {
          cam.fov = 62
          cam.updateProjectionMatrix()
        }
        _target.y = 0
      }
    }
    // The sun's shadow box follows the action.
    if (sun) {
      sun.target.position.copy(_target)
      _sunOff.copy(sun.userData.dir as THREE.Vector3).multiplyScalar(140)
      sun.position.copy(_target).add(_sunOff)
    }
  }

  /* ---------- HUD ---------- */

  private project(x: number, y: number, z: number) {
    _proj.set(x, y, z).project(this.camera)
    if (_proj.z > 1 || Math.abs(_proj.x) > 1.05 || Math.abs(_proj.y) > 1.05) return null
    return { x: (_proj.x * 0.5 + 0.5) * this.rect.width, y: (-_proj.y * 0.5 + 0.5) * this.rect.height }
  }

  private emitHud() {
    if (!this.onHud) return
    const m = this.mode
    const markers: Hud['markers'] = []
    if (m === 'hub' || m === 'hall') {
      for (const p of m === 'hall' ? this.hall.pads : this.hub.pads) {
        const d = Math.hypot(p.x - this.walker.pos.x, p.z - this.walker.pos.z)
        if (d < 8) continue
        const s = this.project(p.x, 3, p.z)
        if (s) markers.push({ id: p.id, label: p.title, color: p.color, x: s.x, y: s.y, dist: Math.round(d) })
      }
    }
    const pr = this.progress
    const role = this.roleBanner ? ROLES[this.roleBanner.index] : null
    let hint = ''
    if (m === 'hub') hint = this.nearPad ? '' : 'WASD move · Shift run · Space jump · walk onto a glowing pad and press E'
    else if (m === 'hall') hint = this.nearPad ? '' : 'Walk to a court and press E to play · the door pad takes you outside'
    else if (m === 'drive') hint = 'W / S throttle and brake · A / D steer · R reset · E or Esc to get out'
    else if (m === 'penalty') hint = 'Aim with the mouse · hold to power, release to shoot · E or Esc to leave'
    else if (m === 'rally') hint = 'A / D move · click or Space to hit when the ring turns green · E or Esc to stop'
    this.onHud({
      mode: m,
      locked: this.locked || !!this.opts.snap,
      prompt: (m === 'hub' || m === 'hall') && this.nearPad ? { text: this.nearPad.prompt, color: this.nearPad.color } : null,
      progress: {
        roles: pr.roles.length,
        rolesTotal: ROLES.length,
        trophies: pr.trophies,
        trophiesTotal: ACHIEVEMENTS.length,
        skills: pr.skills,
        skillsTotal: SKILLS.length,
        bestLap: pr.bestLap,
      },
      markers,
      drive: m === 'drive' ? this.drive.hud() : null,
      role: role && m === 'drive' ? { index: this.roleBanner!.index, title: role.title, tagline: role.tagline, org: role.org, period: role.period, color: role.color } : null,
      penalty: m === 'penalty' ? this.penalty.hud() : null,
      rally: m === 'rally' ? this.hall.hud() : null,
      toasts: this.toasts.map(({ id, kind, label, title, sub, color }) => ({ id, kind, label, title, sub, color })),
      hint,
    })
  }

  /* ---------- Test hooks (?snap) ---------- */

  /** Advance without the live loop, then draw one frame. */
  simulate(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    this.frame(step, true)
    return this.debugState()
  }

  /** Advance without drawing (fast-forward for tests). */
  advance(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.frame(step, false)
    return this.debugState()
  }

  /** Hold keys (KeyboardEvent.code) for a while. */
  hold(codes: string[], seconds: number) {
    for (const c of codes) {
      this.keys.add(c)
      this.pressed.add(c)
    }
    this.advance(seconds)
    for (const c of codes) this.keys.delete(c)
    return this.debugState()
  }

  press(code: string) {
    this.pressed.add(code)
    return this.simulate(0.05)
  }

  teleport(where: 'spawn' | 'f1' | 'stadium' | 'hall' | [number, number], yaw?: number) {
    if (this.mode !== 'hub') {
      if (this.mode === 'drive') this.exitDrive()
      else if (this.mode === 'penalty') this.exitPenalty()
      else if (this.mode === 'rally') {
        this.stopRally()
        this.exitHall()
      } else if (this.mode === 'hall') this.exitHall()
    }
    const at = Array.isArray(where)
      ? where
      : where === 'spawn'
        ? CONFIG.spawn
        : where === 'f1'
          ? CONFIG.f1_pad
          : where === 'stadium'
            ? CONFIG.stadium_pad
            : CONFIG.hall_pad
    this.walker.place(at[0], at[1], yaw ?? this.walker.yaw)
    if (yaw !== undefined) this.camYaw = yaw
    this.camSnap = true
    return this.simulate(0.05)
  }

  /** Inspection camera: look from p at l (no args: back to the game camera). */
  view(p?: [number, number, number], l?: [number, number, number]) {
    this.freeCam = p && l ? { p: new THREE.Vector3(...p), l: new THREE.Vector3(...l) } : null
    this.camSnap = true
    return this.simulate(0)
  }

  /** Move the walker within the current scene (hub or hall) without changing mode. */
  place(x: number, z: number, yaw = this.walker.yaw) {
    this.walker.place(x, z, yaw)
    this.camYaw = yaw
    this.camSnap = true
    return this.simulate(0.05)
  }

  look(yaw: number, pitch = 0.3) {
    this.camYaw = yaw
    this.camPitch = pitch
    this.camSnap = true
    return this.simulate(0.05)
  }

  interact() {
    return this.press('KeyE')
  }

  setAutopilot(on: boolean) {
    this.autopilot = on
    this.hall.autoplay = on
  }

  shoot(x: number, y: number, power: number) {
    if (this.mode !== 'penalty') this.enterPenalty()
    this.penalty.shoot(x, y, power)
    return this.simulate(0.05)
  }

  enter(mode: 'drive' | 'penalty' | 'hall' | 'badminton' | 'tabletennis' | 'hub') {
    if (mode === 'hub') return this.teleport('spawn')
    if (mode === 'drive') this.enterDrive()
    else if (mode === 'penalty') this.enterPenalty()
    else {
      if (this.mode !== 'hall' && this.mode !== 'rally') this.enterHall()
      if (mode !== 'hall') this.startRally(mode)
    }
    return this.simulate(0.05)
  }

  debugState() {
    const w = this.walker.pos
    return {
      mode: this.mode,
      player: { x: +w.x.toFixed(2), y: +w.y.toFixed(2), z: +w.z.toFixed(2), yaw: +this.walker.yaw.toFixed(2), anim: this.walker.rig.current },
      near: this.nearPad?.id ?? null,
      camYaw: +this.camYaw.toFixed(2),
      drive:
        this.mode === 'drive'
          ? {
              x: +this.drive.x.toFixed(1),
              z: +this.drive.z.toFixed(1),
              speed: Math.round(this.drive.speed * 3.6),
              lap: this.drive.lap,
              sector: this.drive.sector,
              splits: this.drive.splits.map((s) => (s === null ? null : +s.toFixed(2))),
              lastLap: this.drive.lastLap,
              bestLap: this.drive.bestLap,
              offTrack: this.drive.offTrack,
            }
          : null,
      role: this.roleBanner ? ROLES[this.roleBanner.index].title : null,
      penalty: this.penalty.debug(),
      rally: this.hall.debug(),
      toasts: this.toasts.map((t) => `${t.label}: ${t.title}`),
      progress: { roles: this.progress.roles.length, trophies: this.progress.trophies, skills: this.progress.skills, bestLap: this.progress.bestLap, laps: this.progress.laps },
      trackLength: Math.round(this.track.length),
    }
  }
}
