// Stadium penalty shootout: aim a reticle in the goal with the mouse, hold to power, release to shoot. The ball
// curves and dips; the keeper reads or guesses a side and dives (procedural: translate, roll and squash on top of
// the idle clip). Five kicks a round, shown on the scoreboard's screen.
import * as THREE from 'three'
import { CONFIG } from './config'
import { playMove, type KeeperRig } from './assets'
import type { Hub } from './world'
import type { Walker } from './player'
import type { Sfx } from './audio'

export type KickResult = 'goal' | 'save' | 'miss'
export type PenaltyPhase = 'aim' | 'charge' | 'runup' | 'flight' | 'result' | 'done'

export interface PenaltyHud {
  phase: PenaltyPhase
  kick: number
  results: KickResult[]
  goals: number
  power: number | null
  sweet: [number, number]
  message: { text: string; color: string; sub?: string } | null
}

const _ray = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _hit = new THREE.Vector3()
const _cam = new THREE.Vector3()
const _look = new THREE.Vector3()

export class Penalty {
  phase: PenaltyPhase = 'aim'
  results: KickResult[] = []
  readonly aim = new THREE.Vector2(1.6, 1.1)
  power = 0
  difficulty: number
  /** Called on every goal; returns the achievement unlocked (for the board), if any. */
  onGoal: (() => void) | null = null
  onKickResult: ((r: KickResult) => void) | null = null

  private hub: Hub
  private keeper: KeeperRig
  private walker: Walker
  private sfx: Sfx
  private reticle: THREE.Group
  private retRing: THREE.Mesh
  private chargeT = 0
  private phaseT = 0
  private message: PenaltyHud['message'] = null
  private plane: THREE.Plane
  // Shot.
  private start = new THREE.Vector3()
  private target = new THREE.Vector3()
  private side = new THREE.Vector3()
  private curve = 0
  private arc = 0
  private tf = 1
  private u = 0
  private shotPower = 0
  private ballPos = new THREE.Vector3()
  private ballVel = new THREE.Vector3()
  private outcome: KickResult | null = null
  private inNet = false
  // Keeper.
  private kTarget = new THREE.Vector2()
  private kReact = 0.25
  private kT = -1 // seconds since the shot (keeper clock), -1 = idle
  private kRecover = 0
  private idleT = 0
  private runFrom = new THREE.Vector3()
  private runTo = new THREE.Vector3()

  constructor(hub: Hub, keeper: KeeperRig, walker: Walker, sfx: Sfx, difficulty: number) {
    this.hub = hub
    this.keeper = keeper
    this.walker = walker
    this.sfx = sfx
    this.difficulty = difficulty
    keeper.root.position.copy(hub.stadium.keeperSpot)
    hub.scene.add(keeper.root)
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hub.stadium.goalZ)
    // Reticle: a ring and a dot on the goal plane.
    this.reticle = new THREE.Group()
    this.retRing = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.32, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false }))
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }))
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.03), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthTest: false }))
    const cross2 = cross.clone()
    cross2.rotation.z = Math.PI / 2
    this.reticle.add(this.retRing, dot, cross, cross2)
    this.reticle.renderOrder = 10
    this.reticle.traverse((o) => (o.renderOrder = 10))
    this.reticle.visible = false
    hub.scene.add(this.reticle)
    this.drawBoard()
  }

  get goals() {
    return this.results.filter((r) => r === 'goal').length
  }

  get spot() {
    return this.hub.stadium.spotZ
  }

  enter() {
    if (this.phase === 'done') this.newRound()
    this.setupKick()
    this.sfx.crowdStart()
    this.sfx.whistle()
  }

  /** Leaving mid-kick abandons that kick (results so far are kept for when you come back). */
  exit() {
    this.reticle.visible = false
    this.walker.scripted = false
    this.sfx.crowdStop()
    if (this.phase !== 'done') this.phase = 'aim'
    this.kT = -1
    this.inNet = false
    this.ballPos.set(0, CONFIG.ball_radius, this.spot)
    this.hub.stadium.ball.position.copy(this.ballPos)
  }

  /** Outside penalty mode: the keeper just idles on his line. */
  idle(dt: number) {
    this.idleT += dt
    this.updateKeeper(dt)
  }

  newRound() {
    this.results = []
    this.phase = 'aim'
    this.message = null
    this.drawBoard()
  }

  private setupKick() {
    const s = this.hub.stadium
    this.phase = 'aim'
    this.phaseT = 0
    this.power = 0
    this.chargeT = 0
    this.outcome = null
    this.inNet = false
    this.kT = -1
    this.ballPos.set(0, CONFIG.ball_radius, s.spotZ)
    s.ball.position.copy(this.ballPos)
    s.ball.rotation.set(0, 0, 0)
    this.walker.scripted = true
    this.walker.place(-0.9, s.spotZ + 2.5, Math.atan2(0.9, -2.5))
    playMove(this.walker.rig, 'idle')
    this.reticle.visible = true
  }

  /** Mouse over the canvas (normalised device coords): aim where the cursor meets the goal plane. */
  pointer(ndcX: number, ndcY: number, camera: THREE.Camera) {
    if (this.phase !== 'aim' && this.phase !== 'charge') return
    _ndc.set(ndcX, ndcY)
    _ray.setFromCamera(_ndc, camera)
    if (!_ray.ray.intersectPlane(this.plane, _hit)) return
    this.aim.set(THREE.MathUtils.clamp(_hit.x, -6, 6), THREE.MathUtils.clamp(_hit.y, 0.1, 4.2))
  }

  press() {
    if (this.phase === 'done') {
      this.newRound()
      this.setupKick()
      this.sfx.whistle()
      return
    }
    if (this.phase !== 'aim') return
    this.phase = 'charge'
    this.chargeT = 0
  }

  release() {
    if (this.phase !== 'charge') return
    this.shoot(this.aim.x, this.aim.y, this.power)
  }

  /** Start the run-up for a kick at (x, y) on the goal plane with power 0..1. Also the test hook. */
  shoot(x: number, y: number, power: number) {
    if (this.phase === 'done') this.newRound()
    if (this.phase !== 'aim' && this.phase !== 'charge') this.setupKick()
    this.aim.set(x, y)
    this.shotPower = THREE.MathUtils.clamp(power, 0, 1)
    this.power = this.shotPower
    this.phase = 'runup'
    this.phaseT = 0
    this.runFrom.copy(this.walker.pos)
    this.runTo.set(-0.32, 0, this.spot + 0.55)
    playMove(this.walker.rig, 'run', { speed: 1.3 })
  }

  private launch() {
    const s = this.hub.stadium
    const p = this.shotPower
    const [lo, hi] = CONFIG.power_sweet
    this.start.copy(this.ballPos)
    // Aim error: a little spread always, more when weak; overcooked shots balloon over the bar.
    const spread = CONFIG.shot_spread * (1 + Math.max(0, lo - p) * 2)
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.8
    let tx = this.aim.x + g() * spread
    let ty = this.aim.y + g() * spread * 0.7
    if (p > hi) ty += (p - hi) * CONFIG.shot_over_bar
    if (p < 0.2) ty = Math.min(ty, 0.3) // a toe-poke rolls along the ground
    tx = THREE.MathUtils.clamp(tx, -9, 9)
    ty = Math.max(CONFIG.ball_radius, ty)
    this.target.set(tx, ty, s.goalZ)
    const speed = THREE.MathUtils.lerp(CONFIG.shot_speed_min, CONFIG.shot_speed_max, Math.pow(p, 0.85))
    this.tf = this.start.distanceTo(this.target) / speed
    // Corners bend outwards and come back; slower shots loop higher (the dip).
    this.side.set(1, 0, 0)
    this.curve = THREE.MathUtils.clamp(tx / (CONFIG.goal_width / 2), -1, 1) * CONFIG.shot_curve_max * (0.35 + 0.65 * p) + (Math.random() - 0.5) * 0.4
    this.arc = THREE.MathUtils.lerp(1.3, 0.25, p)
    this.u = 0
    this.phase = 'flight'
    this.phaseT = 0
    this.sfx.kick(p)
    this.keeperDecide(tx, ty, p)
  }

  private keeperDecide(tx: number, ty: number, p: number) {
    const d = this.difficulty
    const read = CONFIG.keeper_read[d] + (1 - p) * 0.25
    const rx = CONFIG.keeper_reach_x, ry = CONFIG.keeper_reach_y
    if (Math.random() < read) {
      this.kTarget.set(THREE.MathUtils.clamp(tx + (Math.random() - 0.5) * 0.6, -rx, rx), THREE.MathUtils.clamp(ty + (Math.random() - 0.5) * 0.4, 0.3, ry))
    } else {
      const r = Math.random()
      const side = Math.random() < 0.5 ? -1 : 1
      if (r < 0.2) this.kTarget.set(0, 1.4)
      else this.kTarget.set(side * (1.6 + Math.random() * (rx - 1.6)), 0.4 + Math.random() * (ry - 0.6))
    }
    this.kReact = CONFIG.keeper_react[d] * (0.85 + Math.random() * 0.3)
    this.kT = 0
  }

  /** How far through the dive the keeper is (0 = set, 1 = full stretch). */
  private diveE(t: number) {
    if (t < this.kReact) return 0
    const x = Math.min(1, (t - this.kReact) / CONFIG.keeper_dive_time)
    return 1 - (1 - x) * (1 - x)
  }

  /** Is the ball at (bx, by) on the goal line within the keeper's reach at keeper time t? */
  private saves(bx: number, by: number, t: number) {
    const e = this.diveE(t)
    const kx = this.kTarget.x, ky = this.kTarget.y
    // A segment from the hips to the gloves.
    const ax = kx * 0.5 * e, ay = 0.3 + Math.max(0, ky - 1.2) * 0.5 * e
    const hx = kx * e, hy = e > 0 ? 1.3 + (ky - 1.3) * e + 0.9 * (1 - e) : 2.25
    const dx = hx - ax, dy = hy - ay
    const l2 = dx * dx + dy * dy || 1
    const k = THREE.MathUtils.clamp(((bx - ax) * dx + (by - ay) * dy) / l2, 0, 1)
    const px = ax + dx * k - bx, py = ay + dy * k - by
    return Math.hypot(px, py) < CONFIG.keeper_save_radius + CONFIG.ball_radius
  }

  update(dt: number) {
    this.phaseT += dt
    const s = this.hub.stadium
    const ball = s.ball
    switch (this.phase) {
      case 'charge': {
        this.chargeT += dt
        const x = (this.chargeT / CONFIG.power_fill_time) % 2
        this.power = x > 1 ? 2 - x : x
        break
      }
      case 'runup': {
        const k = Math.min(1, this.phaseT / 0.42)
        this.walker.pos.lerpVectors(this.runFrom, this.runTo, k)
        this.walker.yaw = Math.atan2(this.ballPos.x - this.walker.pos.x, this.ballPos.z - this.walker.pos.z)
        this.walker.sync()
        if (k >= 1) {
          playMove(this.walker.rig, 'idle', { fade: 0.35 })
          this.launch()
        }
        break
      }
      case 'flight': {
        this.kT += dt
        this.u += dt / this.tf
        const u = Math.min(1, this.u)
        const sn = Math.sin(Math.PI * u)
        this.ballPos.lerpVectors(this.start, this.target, u)
        this.ballPos.addScaledVector(this.side, this.curve * sn)
        this.ballPos.y = Math.max(CONFIG.ball_radius, this.ballPos.y + this.arc * sn)
        if (this.u >= 1) {
          // Velocity at the line: the straight-line part minus the curve and arc unwinding.
          const tf = this.tf
          this.ballVel.subVectors(this.target, this.start).divideScalar(tf)
          this.ballVel.addScaledVector(this.side, (-this.curve * Math.PI) / tf)
          this.ballVel.y += (-this.arc * Math.PI) / tf
          this.resolveShot()
        }
        break
      }
      case 'result': {
        this.kT += dt
        this.ballPhysics(dt)
        if (this.phaseT > CONFIG.result_time) {
          if (this.results.length >= CONFIG.kicks_per_round) {
            this.phase = 'done'
            this.phaseT = 0
            const g = this.goals
            this.message = {
              text: `${g} / ${CONFIG.kicks_per_round}`,
              color: g >= 4 ? '#4ade80' : g >= 2 ? '#fde047' : '#f87171',
              sub: 'Round over · click for another round · E to leave',
            }
            this.reticle.visible = false
            this.drawBoard()
            if (g >= 3) this.sfx.cheer(1.2)
          } else this.setupKick()
        }
        break
      }
      case 'done':
        this.ballPhysics(dt)
        break
    }
    if (this.phase === 'flight' || this.phase === 'result' || this.phase === 'done') {
      ball.position.copy(this.ballPos)
      ball.rotation.x -= dt * 22
      ball.rotation.y += dt * this.curve * 3
    }
    this.updateKeeper(dt)
    // Reticle follows the aim and warms up with power.
    if (this.reticle.visible) {
      this.reticle.position.set(this.aim.x, this.aim.y, s.goalZ + 0.05)
      const m = this.retRing.material as THREE.MeshBasicMaterial
      if (this.phase === 'charge') {
        const over = this.power > CONFIG.power_sweet[1]
        m.color.setRGB(1, over ? 0.25 : 1 - this.power * 0.6, over ? 0.2 : 1 - this.power)
        const sc = 1 + this.power * 0.4
        this.retRing.scale.set(sc, sc, 1)
      } else {
        m.color.set('#ffffff')
        this.retRing.scale.set(1, 1, 1)
      }
    }
  }

  private resolveShot() {
    const bx = this.ballPos.x, by = this.ballPos.y
    const hw = CONFIG.goal_width / 2, h = CONFIG.goal_height
    const r = CONFIG.ball_radius
    const inside = Math.abs(bx) < hw - r && by < h - r
    const woodwork = !inside && ((Math.abs(Math.abs(bx) - hw) < r + 0.07 && by < h + r) || (Math.abs(by - h) < r + 0.07 && Math.abs(bx) < hw + r))
    let result: KickResult
    let text: string, color: string
    if ((inside || woodwork) && this.saves(bx, by, this.kT)) {
      result = 'save'
      text = 'SAVED!'
      color = '#f87171'
      // Parried away from the keeper's glove.
      this.ballVel.set(this.ballVel.x * 0.25 + Math.sign(bx || 1) * 2.5, 3.5, Math.abs(this.ballVel.z) * 0.3)
      this.sfx.thud()
      this.sfx.groan()
    } else if (inside) {
      result = 'goal'
      text = 'GOAL!'
      color = '#4ade80'
      this.inNet = true
      this.sfx.cheer(1)
    } else if (woodwork) {
      result = 'miss'
      text = Math.abs(by - h) < r + 0.07 ? 'OFF THE BAR!' : 'OFF THE POST!'
      color = '#fb923c'
      this.ballVel.set(this.ballVel.x * 0.4, Math.abs(this.ballVel.y) * 0.4 + 1, Math.abs(this.ballVel.z) * 0.5)
      this.sfx.beep(1800, 0.4, 'triangle', 0.08)
      this.sfx.groan()
    } else {
      result = 'miss'
      text = by > h ? 'OVER THE BAR' : 'WIDE'
      color = '#fb923c'
      this.sfx.groan()
    }
    this.results.push(result)
    this.outcome = result
    this.message = { text, color }
    this.phase = 'result'
    this.phaseT = 0
    this.kRecover = 0
    this.onKickResult?.(result)
    if (result === 'goal') this.onGoal?.()
    this.drawBoard()
  }

  private ballPhysics(dt: number) {
    const p = this.ballPos, v = this.ballVel
    const r = CONFIG.ball_radius
    v.y -= 9.81 * dt
    v.multiplyScalar(Math.max(0, 1 - dt * 0.25))
    p.addScaledVector(v, dt)
    const goalZ = this.hub.stadium.goalZ
    if (this.inNet && p.z < goalZ - 1.7) {
      // The net swallows it.
      p.z = goalZ - 1.7
      v.z = Math.abs(v.z) * 0.08
      v.x *= 0.3
      v.y = Math.min(v.y, 0)
    }
    if (this.inNet) {
      p.x = THREE.MathUtils.clamp(p.x, -CONFIG.goal_width / 2 + r, CONFIG.goal_width / 2 - r)
      p.y = Math.min(p.y, CONFIG.goal_height - r)
    }
    if (p.y < r) {
      p.y = r
      if (v.y < 0) v.y = -v.y * 0.45
      v.x *= 0.92
      v.z *= 0.92
    }
  }

  private updateKeeper(dt: number) {
    const k = this.keeper
    k.mixer?.update(dt)
    const b = k.body
    if (this.phase === 'flight' || (this.phase === 'result' && this.phaseT < 0.9)) {
      const e = this.diveE(this.kT)
      const kx = this.kTarget.x, ky = this.kTarget.y
      const sideDive = Math.abs(kx) > 0.7
      b.position.x = kx * 0.55 * e
      b.position.y = Math.max(0, ky - 1.2) * 0.45 * e + Math.sin(Math.PI * e) * (sideDive ? 0.35 : 0.15)
      b.rotation.z = sideDive ? -Math.sign(kx) * Math.min(1.45, (Math.abs(kx) / 2.4) * 1.45) * e : 0
      // Squash on take-off, stretch at full extension.
      const sq = this.kT > this.kReact - 0.12 && this.kT < this.kReact ? 0.9 : 1 + 0.06 * e
      b.scale.set(2 - sq, sq, 1)
    } else {
      // Back to the line.
      this.kRecover = Math.min(1, this.kRecover + dt * 2.2)
      const f = Math.min(1, dt * 6)
      b.position.x += -b.position.x * f
      b.position.y += -b.position.y * f
      b.rotation.z += -b.rotation.z * f
      b.scale.x += (1 - b.scale.x) * f
      b.scale.y += (1 - b.scale.y) * f
      // Shuffle side to side while waiting.
      if (this.phase === 'aim' || this.phase === 'charge') b.position.x += Math.sin((this.phaseT + this.idleT) * 1.7) * 0.3 * f
    }
  }

  camera(cam: THREE.PerspectiveCamera, dt: number, snap = false) {
    const s = this.hub.stadium
    const flight = this.phase === 'flight' || this.phase === 'result'
    _cam.set(flight ? this.ballPos.x * 0.15 : 0.35, 1.95, s.spotZ + (flight ? 4.6 : 5.4))
    _look.set(flight ? this.ballPos.x * 0.3 : 0, 1.3, s.goalZ)
    const k = snap ? 1 : 1 - Math.exp(-dt * 4)
    cam.position.lerp(_cam, k)
    cam.lookAt(_look)
    if (Math.abs(cam.fov - 55) > 0.1) {
      cam.fov = 55
      cam.updateProjectionMatrix()
    }
  }

  hud(): PenaltyHud {
    return {
      phase: this.phase,
      kick: Math.min(CONFIG.kicks_per_round, this.results.length + 1),
      results: [...this.results],
      goals: this.goals,
      power: this.phase === 'charge' || this.phase === 'runup' ? this.power : null,
      sweet: CONFIG.power_sweet,
      message: this.phase === 'result' || this.phase === 'done' ? this.message : null,
    }
  }

  debug() {
    return { phase: this.phase, results: [...this.results], goals: this.goals, kTarget: [+this.kTarget.x.toFixed(2), +this.kTarget.y.toFixed(2)], outcome: this.outcome }
  }

  /** The scoreboard screen: score, the five kicks and the latest call. */
  drawBoard(extra?: string) {
    const c = this.hub.stadium.boardCanvas
    const g = c.getContext('2d')!
    const W = c.width, H = c.height
    g.fillStyle = '#05070d'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#0f172a'
    g.fillRect(16, 16, W - 32, H - 32)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = '#fde047'
    g.font = '900 54px ui-sans-serif, system-ui, sans-serif'
    g.fillText('PENALTY SHOOTOUT', W / 2, 70)
    const saves = this.results.length - this.goals
    g.fillStyle = '#f8fafc'
    g.font = '900 132px ui-sans-serif, system-ui, sans-serif'
    g.fillText(`${this.goals}  –  ${saves}`, W / 2, 200)
    g.font = '700 38px ui-sans-serif, system-ui, sans-serif'
    g.fillStyle = '#94a3b8'
    g.fillText('YOU', W / 2 - 250, 200)
    g.fillText('KEEPER', W / 2 + 270, 200)
    for (let i = 0; i < CONFIG.kicks_per_round; i++) {
      const r = this.results[i]
      g.beginPath()
      g.arc(W / 2 + (i - 2) * 92, 315, 30, 0, Math.PI * 2)
      g.fillStyle = r === 'goal' ? '#22c55e' : r ? '#ef4444' : '#334155'
      g.fill()
    }
    const last = this.message?.text ?? 'STEP UP'
    g.fillStyle = this.message?.color ?? '#e2e8f0'
    g.font = '900 italic 64px ui-sans-serif, system-ui, sans-serif'
    g.fillText(extra ?? last, W / 2, 420)
    const tex = (this.hub.stadium.board.material as THREE.MeshBasicMaterial).map
    if (tex) tex.needsUpdate = true
  }
}
