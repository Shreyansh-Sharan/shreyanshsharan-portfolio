// The rally hall: an indoor arena you walk into (badminton court, table tennis table, bleachers, lights) and the
// timing-based rally game for each sport. The shuttle or ball comes over with varying speed and placement; move with
// A/D and hit (click or Space) inside the window to send it back. First to 7 wins.
import * as THREE from 'three'
import { CONFIG, type Sport } from './config'
import { fit, makeKeeper, model, playMove, racketMesh, trs, instanced, type KeeperRig, type SportsAssets } from './assets'
import { badmintonCourtTexture, labelTexture, wallTexture, woodFloorTexture } from './textures'
import { Colliders, animatePad, makePad, type Pad } from './world'
import type { Walker } from './player'
import type { Sfx } from './audio'

export type RallyPhase = 'serve' | 'incoming' | 'outgoing' | 'point' | 'over'

export interface RallyHud {
  sport: Sport
  phase: RallyPhase
  me: number
  opp: number
  target: number
  streak: number
  best: number
  server: 'me' | 'opp'
  message: { text: string; color: string; sub?: string } | null
  timing: number | null // -1..1 (0 = perfect) while the shot is in the hitting zone
}

/** A flight as up to three parabolic legs. */
interface Leg {
  a: THREE.Vector3
  b: THREE.Vector3
  dur: number
  h: number // extra height at mid-leg
  bounceAtEnd?: boolean
}

const HALL_W = 40, HALL_D = 30, HALL_H = 10
export const COURT = { badminton: new THREE.Vector3(0, 0, -7), tabletennis: new THREE.Vector3(0, 0, 7.5) }

const _p = new THREE.Vector3()
const _cam = new THREE.Vector3()
const _look = new THREE.Vector3()

export class Hall {
  readonly scene = new THREE.Scene()
  readonly colliders = new Colliders()
  readonly pads: Pad[] = []
  readonly sun: THREE.DirectionalLight
  readonly opp: KeeperRig
  difficulty: number
  autoplay = false
  onPoint: ((won: boolean, sport: Sport) => void) | null = null
  onStreak: ((sport: Sport, n: number) => void) | null = null
  onMatch: ((won: boolean, sport: Sport) => void) | null = null

  // Rally state.
  sport: Sport | null = null
  phase: RallyPhase = 'serve'
  me = 0
  oppScore = 0
  streak = 0
  best = 0
  server: 'me' | 'opp' = 'opp'
  private walker: Walker
  private sfx: Sfx
  private phaseT = 0
  private legs: Leg[] = []
  private legI = 0
  private legT = 0
  private flightT = 0
  private idealT = 0 // flight time of the ideal hit (incoming)
  private swung = false
  private returning = false // outgoing: will the opponent get it back?
  private oppTargetZ = 0
  private oppZ = 0
  private playerZ = 0
  private playerX = 0
  private bonusGiven = false
  private message: RallyHud['message'] = null
  private swingT = 0
  private oppSwingT = 0
  private aimZ = 0 // the incoming shot's lateral position at the hitting point
  private shuttle: THREE.Group
  private ball: THREE.Mesh
  private ring: THREE.Mesh
  private rackets: Record<Sport, THREE.Object3D>
  private oppRackets: Record<Sport, THREE.Object3D>
  private hitQueued = false
  private msgT = 0
  private shownMsg: RallyHud['message'] = null

  constructor(assets: SportsAssets | null, walker: Walker, sfx: Sfx, difficulty: number) {
    this.walker = walker
    this.sfx = sfx
    this.difficulty = difficulty
    const s = this.scene
    s.background = new THREE.Color('#1e293b')
    s.fog = new THREE.Fog('#1e293b', 40, 90)

    /* Light: a soft fill and one shadow-casting key from the roof lights. */
    s.add(new THREE.HemisphereLight('#f8fafc', '#7c5a3a', 1.35))
    s.add(new THREE.AmbientLight('#ffffff', 0.25))
    this.sun = new THREE.DirectionalLight('#fffaf0', 1.7)
    this.sun.position.set(6, 18, 4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -22
    sc.right = sc.top = 22
    sc.near = 2
    sc.far = 40
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.03
    s.add(this.sun, this.sun.target)

    /* Shell: wood floor, panelled walls, ceiling with light strips. */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: woodFloorTexture([5, 4]), roughness: 0.55 }))
    floor.receiveShadow = true
    s.add(floor)
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture([8, 1]), roughness: 0.9 })
    const wallMatShort = new THREE.MeshStandardMaterial({ map: wallTexture([6, 1]), roughness: 0.9 })
    for (const [x, z, w, rot, mat] of [
      [0, -HALL_D / 2, HALL_W, 0, wallMat],
      [0, HALL_D / 2, HALL_W, Math.PI, wallMat],
      [-HALL_W / 2, 0, HALL_D, Math.PI / 2, wallMatShort],
      [HALL_W / 2, 0, HALL_D, -Math.PI / 2, wallMatShort],
    ] as [number, number, number, number, THREE.Material][]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, HALL_H), mat)
      wall.position.set(x, HALL_H / 2, z)
      wall.rotation.y = rot
      wall.receiveShadow = true
      s.add(wall)
    }
    this.colliders.box(0, -HALL_D / 2 - 0.5, HALL_W / 2, 0.5)
    this.colliders.box(0, HALL_D / 2 + 0.5, HALL_W / 2, 0.5)
    this.colliders.box(-HALL_W / 2 - 0.5, 0, 0.5, HALL_D / 2)
    this.colliders.box(HALL_W / 2 + 0.5, 0, 0.5, HALL_D / 2)
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_D).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cbd5e1', emissive: '#334155', roughness: 1 }))
    ceil.position.y = HALL_H
    s.add(ceil)
    const stripM: THREE.Matrix4[] = []
    for (let x = -15; x <= 15; x += 6) for (const z of [-9, 0, 9]) stripM.push(trs(x, HALL_H - 0.15, z))
    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 0.12, 0.7), new THREE.MeshBasicMaterial({ color: '#fffdf2' }), stripM.length)
    stripM.forEach((m, i) => strip.setMatrixAt(i, m))
    s.add(strip)
    // Door frame on the south wall.
    const door = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.4), new THREE.MeshStandardMaterial({ color: '#0f172a', emissive: '#7dd3fc', emissiveIntensity: 0.25 }))
    door.position.set(0, 1.7, HALL_D / 2 - 0.02)
    door.rotation.y = Math.PI
    s.add(door)

    /* Banners. */
    const banner = (text: string, sub: string, x: number, z: number, rot: number, w = 12) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 5), new THREE.MeshBasicMaterial({ map: labelTexture(text, { bg: '#0f172a', sub, border: '#38bdf8', w: 1024, h: 205 }), toneMapped: false }))
      m.position.set(x, 7, z)
      m.rotation.y = rot
      s.add(m)
    }
    banner('RALLY HALL', 'Win points to unlock skills', 0, -HALL_D / 2 + 0.05, 0, 14)
    banner('BADMINTON', 'First to 7', -HALL_W / 2 + 0.05, -7, Math.PI / 2, 9)
    banner('TABLE TENNIS', 'First to 7', -HALL_W / 2 + 0.05, 7.5, Math.PI / 2, 9)
    banner('SKILL TREE', 'Data · DevOps · GenAI · ML · BI', HALL_W / 2 - 0.05, 0, -Math.PI / 2, 12)

    /* Badminton court and net. */
    const cb = COURT.badminton
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(17, 9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0f5132', roughness: 0.8 }))
    surround.position.set(cb.x, 0.01, cb.z)
    surround.receiveShadow = true
    s.add(surround)
    const court = new THREE.Mesh(new THREE.PlaneGeometry(13.4, 6.1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: badmintonCourtTexture(), roughness: 0.7 }))
    court.position.set(cb.x, 0.02, cb.z)
    court.receiveShadow = true
    s.add(court)
    const net = fit(model(assets, 'badminton-net'), [0.3, 1.58, 6.5])
    net.position.copy(cb)
    s.add(net)
    this.colliders.box(cb.x, cb.z, 0.25, 3.3)

    /* Table tennis. */
    const ct = COURT.tabletennis
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(10, 5.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7f1d1d', roughness: 0.85 }))
    mat.position.set(ct.x, 0.012, ct.z)
    mat.receiveShadow = true
    s.add(mat)
    const table = fit(model(assets, 'pingpong-table'), [2.74, 0.89, 1.525])
    table.position.copy(ct)
    s.add(table)
    this.colliders.box(ct.x, ct.z, 1.45, 0.85)

    /* Bleachers on the north wall, benches, a racket display. */
    const stepMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.8 })
    const seatMat = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.7 })
    for (let k = 0; k < 4; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5 * (k + 1), 1.1), stepMat)
      step.position.set(0, 0.25 * (k + 1), -HALL_D / 2 + 0.55 + (3 - k) * 1.1)
      step.receiveShadow = step.castShadow = true
      s.add(step)
      const seat = new THREE.Mesh(new THREE.BoxGeometry(25, 0.08, 0.5), seatMat)
      seat.position.set(0, 0.5 * (k + 1) + 0.04, step.position.z + 0.2)
      s.add(seat)
    }
    this.colliders.box(0, -HALL_D / 2 + 2.2, 13, 2.2)
    const benchM = [trs(-15, 0, 13.6, Math.PI), trs(15, 0, 13.6, Math.PI), trs(18.6, 0, -7, -Math.PI / 2), trs(18.6, 0, 7.5, -Math.PI / 2)]
    s.add(instanced(fit(model(assets, 'bench'), [1.9, null, null]), benchM))
    this.colliders.box(-15, 13.6, 0.95, 0.4)
    this.colliders.box(15, 13.6, 0.95, 0.4)
    this.colliders.box(18.6, -7, 0.4, 0.95)
    this.colliders.box(18.6, 7.5, 0.4, 0.95)
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.6 }))
    stand.position.set(7, 0.45, 13.6)
    stand.castShadow = true
    s.add(stand)
    const display = fit(model(assets, 'racket'), [1.1, null, null])
    display.position.set(7, 0.9, 13.6)
    display.rotation.y = 0.4
    s.add(display)
    this.colliders.box(7, 13.6, 0.9, 0.55)

    /* Pads. */
    const pb = makePad('badminton', cb.x - CONFIG.badminton.hit_x - 3.4, cb.z, 'BADMINTON', 'Play badminton', '#22c55e', 3.4, 0.5)
    const pt = makePad('tabletennis', ct.x - CONFIG.tabletennis.hit_x - 2.2, ct.z, 'TABLE TENNIS', 'Play table tennis', '#f97316', 3.4, 0.5)
    const pe = makePad('exit', 0, HALL_D / 2 - 2, 'EXIT', 'Back outside', '#38bdf8', 3.4, 0.5)
    for (const p of [pb, pt, pe]) {
      p.group.scale.setScalar(0.75)
      s.add(p.group)
      this.pads.push(p)
    }

    /* The opponent: the keeper, racket in hand. */
    this.opp = makeKeeper(assets)
    this.opp.root.visible = false
    s.add(this.opp.root)
    this.rackets = { badminton: racketMesh('badminton', '#ef4444'), tabletennis: racketMesh('tabletennis', '#dc2626') }
    this.oppRackets = { badminton: racketMesh('badminton', '#22c55e'), tabletennis: racketMesh('tabletennis', '#111827') }
    for (const sp of ['badminton', 'tabletennis'] as Sport[]) {
      const r = this.rackets[sp]
      r.visible = false
      const hand = walker.rig.hand
      if (hand) {
        r.scale.setScalar(walker.rig.handScale)
        hand.add(r)
      }
      const o = this.oppRackets[sp]
      o.visible = false
      if (this.opp.hand) {
        o.scale.setScalar(this.opp.handScale)
        this.opp.hand.add(o)
      }
    }

    /* Shuttle and ball. */
    this.shuttle = new THREE.Group()
    const cork = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: '#f8fafc' }))
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.09, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.06), new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.92 }))
    this.shuttle.add(cork, skirt)
    this.shuttle.scale.setScalar(2.2)
    this.shuttle.visible = false
    s.add(this.shuttle)
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), new THREE.MeshStandardMaterial({ color: '#fb923c', emissive: '#7c2d12', emissiveIntensity: 0.3 }))
    this.ball.scale.setScalar(2.3)
    this.ball.visible = false
    s.add(this.ball)
    for (const m of [cork, skirt, this.ball]) m.castShadow = true
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }))
    this.ring.visible = false
    s.add(this.ring)
  }

  private get cfg() {
    return this.sport === 'tabletennis' ? CONFIG.tabletennis : CONFIG.badminton
  }

  private get origin() {
    return COURT[this.sport ?? 'badminton']
  }

  /* ---------- Match flow ---------- */

  start(sport: Sport) {
    this.sport = sport
    this.me = 0
    this.oppScore = 0
    this.streak = 0
    this.server = 'opp'
    this.message = { text: sport === 'badminton' ? 'BADMINTON' : 'TABLE TENNIS', color: '#fde047', sub: `First to ${CONFIG.rally_target} · A/D to move · click or Space to hit` }
    const c = this.cfg
    this.playerZ = 0
    this.playerX = -c.hit_x - 0.15
    this.oppZ = 0
    this.walker.scripted = true
    this.walker.place(this.origin.x + this.playerX, this.origin.z, Math.PI / 2)
    playMove(this.walker.rig, 'idle')
    this.opp.root.visible = true
    this.opp.root.position.set(this.origin.x + c.hit_x + 0.15, 0, this.origin.z)
    this.opp.root.rotation.y = -Math.PI / 2
    for (const sp of ['badminton', 'tabletennis'] as Sport[]) {
      this.rackets[sp].visible = sp === sport
      this.oppRackets[sp].visible = sp === sport
    }
    for (const p of this.pads) p.group.visible = false
    this.toPhase('serve')
  }

  stop() {
    for (const p of this.pads) p.group.visible = true
    this.sport = null
    this.walker.scripted = false
    this.walker.rig.body.rotation.set(0, 0, 0)
    this.opp.root.visible = false
    this.shuttle.visible = this.ball.visible = this.ring.visible = false
    for (const sp of ['badminton', 'tabletennis'] as Sport[]) {
      this.rackets[sp].visible = false
      this.oppRackets[sp].visible = false
    }
  }

  private toPhase(p: RallyPhase) {
    this.phase = p
    this.phaseT = 0
  }

  private get projectile() {
    return this.sport === 'tabletennis' ? this.ball : this.shuttle
  }

  /** Lateral jitter for a shot: wider as the rally goes on. */
  private place(scale = 1) {
    const c = this.cfg
    return THREE.MathUtils.clamp((Math.random() * 2 - 1) * c.lateral * scale, -c.lateral, c.lateral)
  }

  /** The opponent sends one over (a serve or a return). Speed and placement vary and tighten with the rally. */
  private incoming(fromZ: number, serve: boolean) {
    const c = this.cfg
    const tt = this.sport === 'tabletennis'
    const press = Math.min(1, this.streak / 10)
    const [f0, f1] = c.flight
    let dur = THREE.MathUtils.lerp(f1, f0, Math.random() * 0.6 + press * 0.4) * (serve ? 1.15 : 1)
    let apex = THREE.MathUtils.lerp(c.apex[0], c.apex[1], Math.random())
    // Now and then a hard, flat one.
    if (!serve && Math.random() < 0.15 + press * 0.2) {
      dur *= 0.72
      apex *= 0.45
    }
    const z = this.place(serve ? 0.5 : 0.7 + press * 0.3)
    const depth = (Math.random() - 0.5) * (tt ? 0.25 : 0.9)
    const a = new THREE.Vector3(c.hit_x, c.hit_y + (tt ? 0 : 0.4), fromZ)
    const p = new THREE.Vector3(-c.hit_x - depth, c.hit_y + (Math.random() - 0.5) * 0.2, z)
    this.legs = []
    if (tt) {
      const b = new THREE.Vector3(-0.35 - Math.random() * 0.8, CONFIG.tabletennis.table_y + 0.03, z * 0.85)
      this.legs.push({ a, b, dur: dur * 0.58, h: apex, bounceAtEnd: true })
      this.legs.push({ a: b, b: p, dur: dur * 0.42, h: 0.14 })
      this.idealT = dur
      this.legs.push({ a: p, b: new THREE.Vector3(p.x - 1.4, 0.03, p.z * 1.2), dur: 0.38, h: 0.05, bounceAtEnd: true })
    } else {
      this.legs.push({ a, b: p, dur, h: apex })
      this.idealT = dur
      this.legs.push({ a: p, b: new THREE.Vector3(p.x - 0.9, 0.04, p.z), dur: 0.32, h: 0 })
    }
    this.aimZ = z
    this.legI = 0
    this.legT = 0
    this.flightT = 0
    this.swung = false
    this.oppSwingT = 0.3
    this.sfx.hit(this.sport!, 0.5)
    this.toPhase('incoming')
  }

  /** The player's return from the current shuttle position. quality 0..1 (1 = perfect timing). */
  private outgoing(quality: number, steer: number) {
    const c = this.cfg
    const tt = this.sport === 'tabletennis'
    const from = this.projectile.position.clone().sub(this.origin)
    const smash = quality > 0.78
    // Aim: steer with A/D at contact, otherwise away from the opponent; smashes go wide.
    let z = steer !== 0 ? steer * c.lateral * (0.6 + Math.random() * 0.4) : this.oppZ > 0 ? -c.lateral * (0.35 + Math.random() * 0.6) : c.lateral * (0.35 + Math.random() * 0.6)
    if (smash) z = Math.sign(z || 1) * c.lateral * (0.85 + Math.random() * 0.15)
    const [f0, f1] = c.flight
    const dur = smash ? f0 * 0.62 : THREE.MathUtils.lerp(f1, f0, quality * 0.7)
    const apex = smash ? c.apex[0] * (tt ? 0.5 : 0.25) : THREE.MathUtils.lerp(c.apex[1], c.apex[0], quality)
    const q = new THREE.Vector3(c.hit_x, c.hit_y, z)
    this.legs = []
    if (tt) {
      const b = new THREE.Vector3(0.35 + Math.random() * 0.8, CONFIG.tabletennis.table_y + 0.03, z * 0.85)
      this.legs.push({ a: from, b, dur: dur * 0.58, h: apex, bounceAtEnd: true })
      this.legs.push({ a: b, b: q, dur: dur * 0.42, h: 0.14 })
    } else this.legs.push({ a: from, b: q, dur, h: apex })
    // Can the opponent get there? Lateral distance vs their speed, then a chance of a fluff.
    const speed = CONFIG.rally_opp_speed[this.difficulty] * (tt ? 0.5 : 1)
    const need = Math.max(0, Math.abs(z - this.oppZ) - c.reach)
    const reach = need <= speed * Math.max(0, dur - 0.18)
    const err = CONFIG.rally_opp_error[this.difficulty] + (smash ? CONFIG.rally_smash_error : 0) + Math.min(0.15, this.streak * 0.01)
    this.returning = reach && Math.random() > err
    this.oppTargetZ = z
    if (!this.returning) {
      // Past the opponent and down.
      const end = this.legs[this.legs.length - 1].b
      this.legs.push({ a: end, b: new THREE.Vector3(end.x + (tt ? 1.2 : 0.8), 0.03, end.z * 1.1), dur: tt ? 0.35 : 0.3, h: 0.05, bounceAtEnd: true })
    }
    this.legI = 0
    this.legT = 0
    this.flightT = 0
    this.streak++
    if (this.streak > this.best) this.best = this.streak
    if (!this.bonusGiven && this.streak >= CONFIG.rally_streak_bonus) {
      this.bonusGiven = true
      this.onStreak?.(this.sport!, this.streak)
    }
    this.sfx.hit(this.sport!, quality)
    this.message = smash ? { text: 'SMASH!', color: '#f472b6' } : quality > 0.5 ? { text: 'GREAT', color: '#4ade80' } : { text: 'GOOD', color: '#a3e635' }
    this.toPhase('outgoing')
  }

  private pointTo(winner: 'me' | 'opp', text: string) {
    if (winner === 'me') this.me++
    else this.oppScore++
    this.server = winner
    this.message = { text, color: winner === 'me' ? '#4ade80' : '#f87171', sub: `${this.me} – ${this.oppScore}` }
    this.sfx.point(winner === 'me')
    this.onPoint?.(winner === 'me', this.sport!)
    this.streak = 0
    this.bonusGiven = false
    const target = CONFIG.rally_target
    if (this.me >= target || this.oppScore >= target) {
      const won = this.me > this.oppScore
      this.message = {
        text: won ? 'MATCH WON!' : 'MATCH LOST',
        color: won ? '#fde047' : '#f87171',
        sub: `${this.me} – ${this.oppScore} · click to play again · E to leave`,
      }
      this.onMatch?.(won, this.sport!)
      if (won) this.sfx.unlock()
      this.toPhase('over')
    } else this.toPhase('point')
  }

  /** Player swing (click / Space). */
  hit() {
    this.hitQueued = true
  }

  /* ---------- Frame ---------- */

  /** `move` is the held A/D axis (-1 left .. 1 right); it also steers the return at contact. */
  update(dt: number, move: number) {
    // Pads pulse while walking around.
    const t = performance.now() / 1000
    for (const p of this.pads) animatePad(p, t, false)
    this.opp.mixer?.update(dt)
    if (!this.sport) return
    const c = this.cfg
    const o = this.origin
    this.phaseT += dt
    const hitPressed = this.hitQueued
    this.hitQueued = false
    const steerHeld = move
    // Calls fade after a moment (the match result stays up).
    if (this.message !== this.shownMsg) {
      this.shownMsg = this.message
      this.msgT = 0
    }
    this.msgT += dt
    if (this.message && this.phase !== 'over' && this.msgT > 1.4) this.message = null

    // Autoplay (tests / attract): step to the shot and swing on time.
    let doHit = hitPressed
    if (this.autoplay && this.phase === 'incoming') {
      const d = this.aimZ - this.playerZ
      move = Math.abs(d) > 0.05 ? Math.sign(d) : 0
      if (!this.swung && this.flightT >= this.idealT - 0.02) doHit = true
    }

    // Footwork.
    const lim = c.half_width + 0.5
    this.playerZ = THREE.MathUtils.clamp(this.playerZ + move * c.move_speed * dt, -lim, lim)
    const w = this.walker
    w.pos.set(o.x + this.playerX, 0, o.z + this.playerZ)
    w.yaw = Math.PI / 2 - move * 0.5
    w.sync()
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt)
      const k = 1 - this.swingT / 0.32
      w.rig.body.rotation.y = k < 0.35 ? -0.7 * (k / 0.35) : -0.7 + 1.6 * Math.min(1, (k - 0.35) / 0.4)
    } else w.rig.body.rotation.y *= Math.max(0, 1 - dt * 8)
    playMove(w.rig, Math.abs(move) > 0.1 ? 'walk' : 'idle', { speed: Math.abs(move) > 0.1 ? 1.6 : 1 })

    // Opponent drifts towards where the shot is going.
    const oppSpeed = CONFIG.rally_opp_speed[this.difficulty] * (this.sport === 'tabletennis' ? 0.5 : 1)
    const goal = this.phase === 'outgoing' ? this.oppTargetZ : 0
    const dz = goal - this.oppZ
    this.oppZ += THREE.MathUtils.clamp(dz, -oppSpeed * dt, oppSpeed * dt)
    this.opp.root.position.set(o.x + c.hit_x + 0.15, 0, o.z + this.oppZ)
    if (this.oppSwingT > 0) {
      this.oppSwingT = Math.max(0, this.oppSwingT - dt)
      this.opp.body.rotation.y = Math.sin((1 - this.oppSwingT / 0.3) * Math.PI) * 0.8
    } else this.opp.body.rotation.y *= Math.max(0, 1 - dt * 8)

    if (doHit && this.swingT <= 0 && (this.phase === 'incoming' || this.phase === 'serve' || this.phase === 'point')) this.swingT = 0.32

    switch (this.phase) {
      case 'serve':
      case 'point': {
        this.projectile.visible = false
        this.ring.visible = false
        if (this.phaseT > (this.phase === 'serve' ? 1.4 : 1.6)) {
          this.message = null
          if (this.server === 'opp') this.incoming(this.oppZ, true)
          else {
            // Player serves: a gentle shot from your racket.
            const prj = this.projectile
            prj.visible = true
            prj.position.set(o.x + this.playerX + 0.4, c.hit_y, o.z + this.playerZ)
            this.swingT = 0.32
            this.streak = -1 // the serve doesn't count as a return
            this.outgoing(0.35, 0)
          }
        }
        break
      }
      case 'incoming': {
        this.fly(dt)
        // Timing ring at the ideal contact point, closing in.
        const ideal = this.legs[this.sport === 'tabletennis' ? 1 : 0].b
        const left = this.idealT - this.flightT
        this.ring.visible = !this.swung && left > -c.window
        if (this.ring.visible) {
          this.ring.position.set(o.x + ideal.x, ideal.y, o.z + ideal.z)
          this.ring.rotation.y = -Math.PI / 2
          const sc = 1 + Math.max(0, left) * 2.2
          this.ring.scale.set(sc, sc, 1)
          ;(this.ring.material as THREE.MeshBasicMaterial).color.set(Math.abs(left) <= c.window ? '#4ade80' : '#ffffff')
        }
        if (doHit && !this.swung) {
          this.swung = true
          const off = Math.abs(this.flightT - this.idealT)
          const lat = Math.abs(this.playerZ - this.aimZ)
          if (off <= c.window && lat <= c.reach) {
            this.ring.visible = false
            this.outgoing(1 - off / c.window, this.autoplay ? 0 : Math.sign(steerHeld))
            break
          }
          this.message = { text: lat > c.reach ? 'TOO FAR' : this.flightT < this.idealT ? 'TOO EARLY' : 'TOO LATE', color: '#fb923c' }
        }
        if (this.legI >= this.legs.length) this.pointTo('opp', this.swung ? 'MISSED' : 'NOT RETURNED')
        break
      }
      case 'outgoing': {
        this.ring.visible = false
        this.fly(dt)
        if (this.returning && this.legI >= this.legs.length) {
          this.oppSwingT = 0.3
          this.incoming(this.oppZ, false)
        } else if (!this.returning && this.legI >= this.legs.length) this.pointTo('me', 'POINT!')
        break
      }
      case 'over':
        this.projectile.visible = false
        this.ring.visible = false
        if ((doHit || (this.autoplay && this.phaseT > 2)) && this.phaseT > 0.8) this.start(this.sport)
        break
    }
  }

  /** Advance along the legs and place the shuttle/ball. */
  private fly(dt: number) {
    const prj = this.projectile
    prj.visible = true
    this.flightT += dt
    this.legT += dt
    while (this.legI < this.legs.length && this.legT >= this.legs[this.legI].dur) {
      const leg = this.legs[this.legI]
      this.legT -= leg.dur
      this.legI++
      if (leg.bounceAtEnd) this.sfx.bounce()
    }
    if (this.legI >= this.legs.length) return
    const leg = this.legs[this.legI]
    const u = this.legT / leg.dur
    _p.lerpVectors(leg.a, leg.b, u)
    _p.y += 4 * leg.h * u * (1 - u)
    const prevX = prj.position.x, prevY = prj.position.y, prevZ = prj.position.z
    prj.position.set(this.origin.x + _p.x, _p.y, this.origin.z + _p.z)
    if (this.sport === 'badminton') {
      // Cork first along the direction of travel.
      const vx = prj.position.x - prevX, vy = prj.position.y - prevY, vz = prj.position.z - prevZ
      if (vx * vx + vy * vy + vz * vz > 1e-8) prj.lookAt(prj.position.x + vx, prj.position.y + vy, prj.position.z + vz)
    }
  }

  camera(cam: THREE.PerspectiveCamera, dt: number, snap = false) {
    const o = this.origin
    const tt = this.sport === 'tabletennis'
    _cam.set(o.x - (tt ? 5.3 : 11.5), tt ? 3.3 : 4.6, o.z + (tt ? 0.9 : 0) + this.playerZ * 0.35)
    _look.set(o.x + (tt ? 0.5 : 2.5), tt ? 0.6 : 1.2, o.z + this.playerZ * 0.15)
    const k = snap ? 1 : 1 - Math.exp(-dt * 5)
    cam.position.lerp(_cam, k)
    cam.lookAt(_look)
    const fov = tt ? 50 : 55
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  }

  hud(): RallyHud {
    const c = this.cfg
    let timing: number | null = null
    if (this.phase === 'incoming' && !this.swung) {
      const left = this.flightT - this.idealT
      if (Math.abs(left) < c.window * 4) timing = THREE.MathUtils.clamp(left / (c.window * 4), -1, 1)
    }
    return {
      sport: this.sport ?? 'badminton',
      phase: this.phase,
      me: this.me,
      opp: this.oppScore,
      target: CONFIG.rally_target,
      streak: Math.max(0, this.streak),
      best: this.best,
      server: this.server,
      message: this.message,
      timing,
    }
  }

  debug() {
    return { sport: this.sport, phase: this.phase, me: this.me, opp: this.oppScore, streak: this.streak, best: this.best }
  }
}
