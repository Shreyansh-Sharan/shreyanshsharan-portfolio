// Sock Hoops (team). Basketball on wash day with one rolled-up sock and two laundry baskets pegged to the washing
// line. Grab the sock (E) and let go to throw: facing the basket you attack, it's a shot; facing a teammate, a pass.
// Jump at the basket while holding it for a clothes-peg slam dunk, worth double. Dives block: dive into the carrier
// or through a pass. Splash the sock in the wash tub and it's wet: heavy, slow and short. After a minute the
// baskets start sliding along the line. Most points when time runs out wins.
import * as THREE from 'three'
import { avoidWalls, bully, nearestMate, skill, steerTo, teamRank } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import type { RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { basketMesh, fetch, holdChanges, holderOf, looseBody, mat, paint, poss, r2, stripeTex } from './team-kit'

const HW = 12
const HD = 8.5
/** The court inside the room (lines and the bots' idea of the sides). */
const CW = 10.5
const CD = 6.5
const LINE_Y = 3.9
const RIM = 2.05
const BASKET_R = 0.62
const HOOP_X = 7.6
const MOVE_AT = 60
const FAST_AT = 95
const TUB = { x: 2.5, z: -7, r: 1.2 }
const LONG = 6.5

interface HoopState {
  /** Where each team's basket is along the line right now (synced). The basket a team ATTACKS is the other one. */
  hoopX: [number, number]
  wet: number
  /** Basket pegged shut until this time, per basket. */
  pegged: [number, number]
  /** A score just happened: the sock sits in that basket until `resetAt`. */
  scoredIn: number
  resetAt: number
  lastPts: number
  /** Lint on a toy's feet until (slowed). */
  lint: number[]
  // Host only.
  sock: RigidBody
  prev: number[]
  /** The last throw: who, from how far, and whether it was a shot. */
  shot: { by: number; dist: number; at: number } | null
  /** The team that threw the sock now in flight (-1 when nobody's throw is live: it can be blocked once). */
  flightTeam: number
  holdT: number
  /** Shots, passes, dunks, blocks (for tuning and tests). */
  tally: [number, number, number, number]
  // Visuals.
  vis: { baskets: THREE.Group[]; sockMat: THREE.MeshStandardMaterial; pegs: THREE.Group[]; laundry: THREE.Mesh[]; ring: THREE.Mesh }
}

/** Team `team` scores in the other team's basket. */
const attack = (team: number) => 1 - team
const homeX = (team: number) => (team === 0 ? -HOOP_X : HOOP_X)

function hoopAt(ctx: LevelCtx, team: number) {
  const t = Math.max(0, ctx.time)
  if (t < MOVE_AT) return homeX(team)
  const k = Math.min(1, (t - MOVE_AT) / 4)
  const w = t < FAST_AT ? 0.55 : 0.95
  return homeX(team) + Math.sin((t - MOVE_AT) * w + team * Math.PI) * 2.2 * k
}

function peg(color = '#d6a46c') {
  const g = new THREE.Group()
  const m = mat(color)
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.12), m)
    leg.position.set(s * 0.05, 0, 0)
    leg.rotation.z = s * 0.08
    g.add(leg)
  }
  const spring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 4, 10), mat('#9ca3af', { metalness: 0.7, roughness: 0.3 }))
  spring.position.y = 0.05
  g.add(spring)
  return g
}

function tileTex() {
  return paint(128, 128, (g, w) => {
    const s = w / 4
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#d7ebe6' : '#9ccfc4'
        g.fillRect(x * s, y * s, s, s)
      }
    g.strokeStyle = 'rgba(255,255,255,0.8)'
    g.lineWidth = 2
    for (let i = 0; i <= 4; i++) {
      g.beginPath()
      g.moveTo(i * s, 0)
      g.lineTo(i * s, w)
      g.moveTo(0, i * s)
      g.lineTo(w, i * s)
      g.stroke()
    }
  })
}

export default defineLevel<HoopState>({
  id: 'sock-hoops',
  name: 'Sock Hoops',
  type: 'team',
  blurb: 'Basketball on wash day: one rolled-up sock, two laundry baskets on the line.',
  howTo: [
    'Grab the sock (E). Let go facing their basket to shoot, facing a teammate to pass',
    'Jump at their basket holding the sock: clothes-peg slam dunk, double points',
    'Dive into the carrier or through a pass to block it',
    'Wet socks (the wash tub) are heavy and short. The baskets start to slide after a minute',
  ],
  accent: '#38bdf8',
  players: [2, 12],
  duration: 120,
  teams: { names: ['Odd Socks', 'Pairs'], colors: ['#a855f7', '#f97316'], scoreName: 'points' },
  sprinkles: { start: 1 },
  camera: { kind: 'chase', dist: 8 },
  introOrbit: { radius: 14, height: 7 },
  sky: { color: '#1f2a2e', fogNear: 40, fogFar: 110 },

  tricks: [
    {
      id: 'soak',
      name: 'Soak It',
      icon: 'milk',
      cost: 2,
      cooldown: 10,
      busy: 0.6,
      target: 'rival',
      desc: 'Splash the sock a rival is carrying: it turns wet, heavy and slow for 10 seconds.',
      counter: 'Pass it quickly, or Bubble Wrap.',
      can: (_c, s, _u, target) => (target && target.holdingProp !== s.sock ? 'Only on whoever has the sock' : true),
      apply: (ctx, s, _u, target) => {
        s.wet = ctx.time + 10
        if (target) ctx.fx.popup(target, 'Soaked!', '#38bdf8')
        ctx.fx.puff(s.sock.translation(), 'milk', 14)
        ctx.fx.sfx('splash', s.sock.translation())
      },
      botUse: (ctx, s, user) => {
        const h = holderOf(ctx, s.sock)
        return h && h.team !== user.team && s.wet < ctx.time ? h : false
      },
    },
    {
      id: 'peg',
      name: 'Peg It Shut',
      icon: 'tack',
      cost: 3,
      cooldown: 20,
      busy: 1,
      target: 'none',
      desc: 'Clamp a giant clothes peg over your own basket: nothing goes in for 6 seconds.',
      counter: 'Keep the ball moving and shoot when the peg pops off.',
      can: (ctx, s, user) => (s.pegged[user.team] > ctx.time ? 'Already pegged' : true),
      apply: (ctx, s, user) => {
        s.pegged[user.team] = ctx.time + 6
        ctx.fx.say(`${poss(ctx.teams[user.team].name).toUpperCase()} BASKET IS PEGGED SHUT!`, ctx.teams[user.team].color, 1.5)
        ctx.fx.sfx('snip', { x: s.hoopX[user.team], y: RIM, z: 0 })
      },
      botUse: (ctx, s, user) => {
        const h = holderOf(ctx, s.sock)
        return h && h.team !== user.team && Math.abs(h.pos.x - s.hoopX[user.team]) < 5 ? null : false
      },
    },
    {
      id: 'lint',
      name: 'Lint Trap',
      icon: 'paw',
      cost: 1,
      cooldown: 7,
      busy: 0.4,
      target: 'rival',
      desc: 'Tangle a rival’s feet in tumble-dryer lint: they shuffle at a crawl for 2.5 seconds.',
      counter: 'Bubble Wrap. Jumping shakes it off sooner.',
      apply: (ctx, s, _u, target) => {
        if (!target) return
        s.lint[target.idx] = ctx.time + 2.5
        ctx.fx.popup(target, 'Lint!', '#d1d5db')
        ctx.fx.puff(target.pos, 'dust', 12)
      },
      botUse: (ctx, s, user) => {
        const h = holderOf(ctx, s.sock)
        if (h && h.team !== user.team) return h
        return false
      },
    },
    bubbleWrap<HoopState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: HW, hd: HD, ridge: 13, knee: 4.5, lights: ctx.quality === 'low' ? 18 : 36, quality: ctx.quality })
    const tiles = tileTex()
    tiles.repeat.set(HW / 2, HD / 2)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HD * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.6 }))
    floor.position.y = 0.01
    floor.receiveShadow = true
    ctx.root.add(floor)
    // Court markings: centre line, centre circle and the long-shot arcs (painted with chalk).
    const chalk = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false })
    const centre = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.05, 40).rotateX(-Math.PI / 2), chalk)
    centre.position.y = 0.02
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, CD * 2).rotateX(-Math.PI / 2), chalk)
    line.position.y = 0.02
    ctx.root.add(centre, line)
    for (const team of [0, 1]) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(LONG - 0.07, LONG + 0.07, 40, 1, team === 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), chalk)
      arc.position.set(homeX(team), 0.02, 0)
      ctx.root.add(arc)
    }
    // The washing line: two T-posts and the line between them.
    const wood = mat('#8b5a2b')
    for (const x of [-HW + 0.4, HW - 0.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, LINE_Y + 0.4, 8), wood)
      post.position.set(x, (LINE_Y + 0.4) / 2, 0)
      post.castShadow = true
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.4), wood)
      bar.position.set(x, LINE_Y + 0.25, 0)
      ctx.root.add(post, bar)
      ctx.phys.cylinder({ x, y: LINE_Y / 2, z: 0 }, LINE_Y / 2, 0.2)
    }
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, HW * 2 - 0.8, 6).rotateZ(Math.PI / 2), mat('#f5f5f4'))
    rope.position.y = LINE_Y
    ctx.root.add(rope)
    // The wash tub (splash the sock in it and it's wet) and a washing machine by the wall.
    const tubM = mat('#94a3b8', { metalness: 0.6, roughness: 0.35 })
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(TUB.r, TUB.r * 0.85, 0.7, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }))
    tub.position.set(TUB.x, 0.35, TUB.z)
    const water = new THREE.Mesh(new THREE.CircleGeometry(TUB.r * 0.95, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 }))
    water.position.set(TUB.x, 0.55, TUB.z)
    const lip = new THREE.Mesh(new THREE.TorusGeometry(TUB.r, 0.06, 6, 24).rotateX(Math.PI / 2), tubM)
    lip.position.set(TUB.x, 0.7, TUB.z)
    ctx.root.add(tub, water, lip)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      ctx.phys.box({ x: TUB.x + Math.sin(a) * TUB.r, y: 0.35, z: TUB.z + Math.cos(a) * TUB.r }, { x: 0.06, y: 0.35, z: 0.4 }, { rotY: a })
    }
    const wm = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.2), mat('#f8fafc', { roughness: 0.4 }))
    body.position.y = 1.3
    const door = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.1, 24).rotateX(Math.PI / 2), mat('#64748b', { metalness: 0.5, roughness: 0.3 }))
    door.position.set(0, 1.25, 1.12)
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.58, 24), new THREE.MeshStandardMaterial({ map: stripeTex(['#bae6fd', '#f9a8d4', '#bae6fd', '#fde68a'], 8), roughness: 0.1 }))
    glass.position.set(0, 1.25, 1.18)
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10).rotateX(Math.PI / 2), mat('#f97316'))
    knob.position.set(0.7, 2.25, 1.12)
    wm.add(body, door, glass, knob)
    wm.position.set(-5, 0, -HD + 1.2)
    ctx.root.add(wm)
    ctx.phys.box({ x: -5, y: 1.3, z: -HD + 1.2 }, { x: 1.2, y: 1.3, z: 1.1 })
  },

  init(ctx) {
    const n = ctx.toys.length
    // The sock: a rolled-up striped ball with its cuff.
    const sockMat = new THREE.MeshStandardMaterial({ map: stripeTex(['#f8fafc', '#ef4444', '#f8fafc', '#3b82f6'], 8), roughness: 0.95 })
    const sockG = new THREE.Group()
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 2), sockMat)
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.08, 6, 14), sockMat)
    cuff.position.y = 0.2
    cuff.rotation.x = Math.PI / 2
    sockG.add(ball, cuff)
    sockG.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    ctx.root.add(sockG)
    const sock = looseBody(ctx, { x: 0, y: 4, z: 0 }, { ball: 0.3 }, { density: 0.35, restitution: 0.5, friction: 0.6, damping: 0.25 })
    ctx.grabbable(sock, sockG)
    // Baskets hanging off the line by two pegs, plus a big peg for "Peg It Shut".
    const baskets: THREE.Group[] = []
    const pegs: THREE.Group[] = []
    for (const team of [0, 1]) {
      const g = new THREE.Group()
      const b = basketMesh(BASKET_R, 0.62, ctx.teams[team].color)
      b.position.y = RIM - 0.62
      g.add(b)
      for (const s of [-1, 1]) {
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, LINE_Y - RIM, 4), mat('#e7e5e4'))
        str.position.set(s * BASKET_R * 0.9, (LINE_Y + RIM) / 2, 0)
        const p = peg()
        p.position.set(s * BASKET_R * 0.9, LINE_Y, 0)
        g.add(str, p)
      }
      ctx.root.add(g)
      baskets.push(g)
      const big = peg('#facc15')
      big.scale.setScalar(3)
      big.rotation.x = Math.PI / 2
      big.visible = false
      ctx.root.add(big)
      pegs.push(big)
    }
    // Laundry hanging along the line (decoration that sways).
    const laundry: THREE.Mesh[] = []
    const shirtCols = [['#fca5a5', '#ffffff'], ['#a5f3fc', '#ffffff'], ['#fde68a', '#fb923c'], ['#c4b5fd', '#ffffff']]
    for (let i = 0; i < 6; i++) {
      const x = -4.2 + i * 1.7
      if (Math.abs(x) < 0.4) continue
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.0), new THREE.MeshStandardMaterial({ map: stripeTex(shirtCols[i % shirtCols.length], 6, i % 2 === 0), side: THREE.DoubleSide, roughness: 1 }))
      m.geometry.translate(0, -0.5, 0)
      m.position.set(x, LINE_Y, 0)
      ctx.root.add(m)
      laundry.push(m)
      const p = peg()
      p.scale.setScalar(0.7)
      p.position.set(x, LINE_Y, 0.03)
      ctx.root.add(p)
    }
    // A ring under the sock so it's easy to find.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0.6, depthWrite: false }))
    ctx.root.add(ring)
    return {
      hoopX: [homeX(0), homeX(1)], wet: 0, pegged: [0, 0], scoredIn: -1, resetAt: 0, lastPts: 0, lint: new Array(n).fill(0),
      sock, prev: [-1], shot: null, flightTeam: -1, holdT: 0, tally: [0, 0, 0, 0],
      vis: { baskets, sockMat, pegs, laundry, ring },
    }
  },

  spawn(ctx, _s, toy, i) {
    const team = toy.team === 1 ? 1 : 0
    let k = 0, n = 0
    ctx.toys.forEach((t, j) => {
      if (t.team !== toy.team) return
      n++
      if (j < i) k++
    })
    return ctx.spawnGrid(n, { x: team === 0 ? -3.2 : 3.2, z: 0, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2, spacing: 1.5, cols: 3 })[k]
  },

  start(ctx, s) {
    s.sock.setTranslation({ x: 0, y: 4, z: 0 }, true)
    s.sock.setLinvel({ x: 0, y: 2, z: 0 }, true)
    ctx.fx.say('TIP-OFF!', '#fde68a', 1)
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    s.hoopX = [hoopAt(ctx, 0), hoopAt(ctx, 1)]
    if (t >= MOVE_AT && t - dt < MOVE_AT) ctx.fx.say('THE BASKETS ARE MOVING!', '#38bdf8', 2)
    if (t >= FAST_AT && t - dt < FAST_AT) ctx.fx.say('SPIN CYCLE: FASTER!', '#38bdf8', 1.6)
    const sock = s.sock
    // After a score the sock sits in the basket, then drops back in at the centre.
    if (s.scoredIn >= 0) {
      sock.setTranslation({ x: s.hoopX[s.scoredIn], y: RIM - 0.25, z: 0 }, true)
      sock.setLinvel({ x: 0, y: 0, z: 0 }, true)
      for (const toy of ctx.toys) if (toy.holdingProp === sock) toy.release(false)
      if (t >= s.resetAt) {
        s.scoredIn = -1
        sock.setTranslation({ x: 0, y: 4.2, z: ctx.rng.range(-1, 1) }, true)
        sock.setLinvel({ x: 0, y: 1, z: 0 }, true)
        ctx.fx.puff({ x: 0, y: 4, z: 0 }, 'spark', 10)
      }
      return
    }
    const holder = holderOf(ctx, sock)
    s.holdT = holder ? s.holdT + dt : 0
    // Wet: carriers trudge.
    for (const toy of ctx.toys) {
      let speed = 5.6
      if (toy === holder) speed = s.wet > t ? 3.6 : 5
      if (s.lint[toy.idx] > t) {
        speed = 1.6
        if (toy.pad.jump) s.lint[toy.idx] -= 0.4
      }
      toy.runSpeed = speed
    }
    // Slam dunk: in the air at their basket with the sock.
    if (holder) {
      const bx = s.hoopX[attack(holder.team)]
      if (!holder.grounded && holder.pos.y > 1.25 && Math.hypot(holder.pos.x - bx, holder.pos.z) < 1.35) {
        if (s.pegged[attack(holder.team)] > t) {
          holder.release(false)
          ctx.fx.popup(holder, 'Pegged shut!', '#facc15')
        } else {
          s.tally[2]++
          score(ctx, s, holder.team, 2, holder, 'SLAM DUNK!')
          ctx.fx.hitStop(0.12)
          ctx.fx.shake(0.5)
          return
        }
      }
    }
    // Throws: a shot at their basket, a pass to a teammate, or a plain toss.
    for (const ev of holdChanges(ctx, [sock], s.prev)) {
      if (!ev.tossed) continue
      const by = ev.by
      s.flightTeam = by.team
      const p = sock.translation()
      const bx = s.hoopX[attack(by.team)]
      const dx = bx - p.x, dz = -p.z
      const d = Math.hypot(dx, dz)
      const fx = Math.sin(by.yaw), fz = Math.cos(by.yaw)
      const facingHoop = (dx * fx + dz * fz) / Math.max(0.01, d) > 0.35
      const wet = s.wet > t
      let mate: Toy | null = null, best = -Infinity
      for (const m of ctx.teammatesOf(by)) {
        const mx = m.pos.x - p.x, mz = m.pos.z - p.z
        const md = Math.hypot(mx, mz)
        const c = (mx * fx + mz * fz) / Math.max(0.01, md)
        if (md < 13 && c > 0.55 && c - md * 0.02 > best) {
          best = c - md * 0.02
          mate = m
        }
      }
      if (facingHoop && d < 11 && (!mate || d < 7.5)) {
        // A shot. Accuracy drops with distance, a defender in your face, and a wet sock.
        const sk = skill(ctx)
        const pressure = ctx.rivalsOf(by).some((r) => r.pos.distanceTo(by.pos) < 1.6) ? 0.35 : 0
        const err = (by.bot ? (1 - sk.accuracy) * 0.55 : 0.04) * d + pressure + (wet ? 0.3 : 0) + 0.05
        const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(0, err)
        const tx = bx + Math.cos(a) * r, tz = Math.sin(a) * r
        const T = 0.55 + d * 0.05
        const short = wet && d > 5 ? 0.78 : 1
        sock.setLinvel({ x: ((tx - p.x) / T) * short, y: (RIM + 0.15 - p.y + 12 * T * T) / T, z: ((tz - p.z) / T) * short }, true)
        s.shot = { by: by.idx, dist: d, at: t }
        s.tally[0]++
        ctx.fx.sfx('throw', p)
      } else if (mate) {
        // A pass, led to where they're running.
        const lx = mate.pos.x + mate.vel.x * 0.35 - p.x, lz = mate.pos.z + mate.vel.z * 0.35 - p.z
        const ld = Math.hypot(lx, lz)
        const T = Math.max(0.35, ld / (wet ? 7 : 11))
        sock.setLinvel({ x: lx / T, y: (mate.pos.y + 0.4 - p.y + 12 * T * T) / T, z: lz / T }, true)
        s.shot = null
        s.tally[1]++
        ctx.fx.sfx('whoosh', p)
      }
    }
    // Did it go in?
    const p = sock.translation()
    const v = sock.linvel()
    if (!holder && v.y < 0) {
      for (const hoop of [0, 1]) {
        const hx = s.hoopX[hoop]
        if (Math.hypot(p.x - hx, p.z) > BASKET_R - 0.05 || p.y > RIM + 0.05 || p.y < RIM - 0.45) continue
        if (s.pegged[hoop] > t) {
          sock.setLinvel({ x: v.x * 0.4 + (p.x - hx) * 3, y: 4, z: v.z * 0.4 + p.z * 3 }, true)
          ctx.fx.sfx('thud', p)
          ctx.fx.popup(ctx.toys[s.shot?.by ?? 0], 'Pegged!', '#facc15')
          break
        }
        // Whoever attacks this basket scores (an own goal counts for them too).
        const team = 1 - hoop
        const shooter = s.shot ? ctx.toys[s.shot.by] : null
        const long = !!s.shot && s.shot.dist >= LONG && shooter?.team === team
        score(ctx, s, team, long ? 2 : 1, shooter && shooter.team === team ? shooter : null, long ? 'LONG SHOT!' : 'SCORE!')
        return
      }
    }
    // Splash: the wash tub soaks the sock.
    if (!holder && Math.hypot(p.x - TUB.x, p.z - TUB.z) < TUB.r - 0.2 && p.y < 0.75) {
      if (s.wet < t + 8) {
        ctx.fx.puff(p, 'milk', 16)
        ctx.fx.sfx('splash', p)
      }
      s.wet = t + 10
      sock.setLinvel({ x: (Math.sign(p.x - TUB.x) || 1) * 2, y: 7, z: 3 }, true)
    }
    // Dives block passes and shots in flight.
    if (holder || Math.hypot(v.x, v.z) < 3) s.flightTeam = -1
    if (!holder && s.flightTeam >= 0) {
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || toy.dive <= 0 || toy.team === s.flightTeam) continue
        if (toy.pos.distanceTo(p) > 1.05) continue
        sock.setLinvel({ x: -v.x * 0.25 + toy.vel.x * 0.4, y: 3, z: -v.z * 0.25 + toy.vel.z * 0.4 }, true)
        ctx.fx.popup(toy, 'BLOCKED!', ctx.teams[toy.team]?.color ?? '#fff')
        s.tally[3]++
        ctx.fx.sfx('slam', p)
        s.shot = null
        s.flightTeam = -1
        if (ctx.rng.chance(0.5)) ctx.addSprinkles(toy, 1)
        break
      }
    }
    // Out of the court (over a wall): back to the middle.
    if (p.y < -2 || Math.abs(p.x) > HW + 0.5 || Math.abs(p.z) > HD + 0.5) {
      sock.setTranslation({ x: 0, y: 4, z: 0 }, true)
      sock.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }
  },

  bot(ctx, s, toy) {
    const sk = skill(ctx)
    const t = ctx.time
    const team = toy.team === 1 ? 1 : 0
    const pace = sk.pace
    const sock = s.sock
    const sp = sock.translation()
    const holder = holderOf(ctx, sock)
    const hx = s.hoopX[attack(team)]
    const ownX = s.hoopX[team]
    const dir = hx > ownX ? 1 : -1
    if (s.scoredIn >= 0) {
      steerTo(toy, dir * -2, (toy.idx % 3) * 2 - 2, { pace: pace * 0.6 })
      return
    }
    // I have it.
    if (holder === toy) {
      toy.pad.grab = true
      const d = Math.hypot(hx - toy.pos.x, toy.pos.z)
      const press = ctx.rivalsOf(toy).filter((r) => r.pos.distanceTo(toy.pos) < 1.8).length
      const wet = s.wet > t
      // Drive at the basket; jump for the dunk when close.
      steerTo(toy, hx - dir * 0.2, 0, { stop: 0.1, pace })
      avoidWalls(ctx, toy)
      if (d < 2.1 && toy.grounded && s.pegged[attack(team)] < t) {
        toy.pad.jump = true
        return
      }
      const open = (m: Toy) => !ctx.rivalsOf(toy).some((r) => r.pos.distanceTo(m.pos) < 1.8)
      const mates = ctx.teammatesOf(toy).filter((m) => open(m) && Math.abs(hx - m.pos.x) < Math.abs(hx - toy.pos.x) - 1)
      const shootRange = wet ? 4.5 : 4 + sk.accuracy * 3.5
      const tooLong = s.holdT > 3.5 + (1 - sk.aggression)
      if ((press && mates.length && ctx.rng.chance(0.08)) || (tooLong && mates.length && d > shootRange)) {
        const m = mates[0]
        aimBot(toy, m.pos.x, m.pos.z)
      } else if ((d < shootRange && d > 2.6 && (!press || ctx.rng.chance(0.06)) && ctx.rng.chance(0.12)) || (tooLong && d < 9)) {
        aimBot(toy, hx, 0)
      }
      return
    }
    // Loose sock: the nearest two of each team go for it.
    if (!holder) {
      const { rank } = teamRank(ctx, toy, (o) => Math.hypot(o.pos.x - sp.x, o.pos.z - sp.z))
      if (rank < 2 && sp.y < 2.6) {
        fetch(ctx, toy, sock, pace)
        if (Math.hypot(sp.x - toy.pos.x, sp.z - toy.pos.z) < 1.2 && sp.y > 1.1 && toy.grounded) toy.pad.jump = true
        return
      }
      steerTo(toy, sp.x * 0.5 - dir * 1.5, ((toy.idx % 3) - 1) * 3, { pace: pace * 0.8 })
      avoidWalls(ctx, toy)
      return
    }
    if (holder.team === team) {
      // Get open ahead of the carrier, spread across the court.
      const { rank } = teamRank(ctx, toy, (o) => o.idx)
      const lane = ((rank % 3) - 1) * 3.2
      const ax = THREE.MathUtils.clamp(holder.pos.x + dir * 3.2, -CW + 1, CW - 1)
      steerTo(toy, ax, lane, { stop: 0.6, pace })
      avoidWalls(ctx, toy)
      return
    }
    // Defence: the nearest chases and dives at the carrier, the next guards the basket, the rest mark.
    const { rank } = teamRank(ctx, toy, (o) => o.pos.distanceTo(holder.pos))
    if (rank === 0) {
      const dd = steerTo(toy, holder.pos.x + holder.vel.x * 0.3, holder.pos.z + holder.vel.z * 0.3, { stop: 0.2, pace })
      if (dd < 2.6 && toy.diveCd <= 0 && ctx.rng.chance(0.06 + sk.aggression * 0.08)) toy.pad.dive = true
      else if (dd < 1.4) bully(toy, holder, 1.4)
      return
    }
    if (rank === 1) {
      // Stand between the carrier and our basket.
      steerTo(toy, (holder.pos.x + ownX) / 2, holder.pos.z * 0.5, { stop: 0.4, pace })
      if (!holder.grounded && Math.hypot(holder.pos.x - toy.pos.x, holder.pos.z - toy.pos.z) < 1.6 && toy.grounded) toy.pad.jump = true
      return
    }
    const mark = nearestMate(ctx, holder, 20) ?? holder
    steerTo(toy, (mark.pos.x + ownX) / 2 * 0.3 + mark.pos.x * 0.7, mark.pos.z, { stop: 0.8, pace })
    avoidWalls(ctx, toy)
  },

  canThrow: (_c, s) => s.scoredIn < 0,

  onThrow(ctx, s, kind, target) {
    // A paper ball makes the carrier fumble the sock.
    if (kind === 'paper' && target.holdingProp === s.sock) {
      target.release(false)
      ctx.fx.popup(target, 'Fumble!', '#fca5a5')
      return false
    }
    return false
  },

  rank(ctx) {
    const lead = (ctx.teams[0]?.score ?? 0) >= (ctx.teams[1]?.score ?? 0) ? 0 : 1
    return ctx.active().sort((a, b) => (a.team === lead ? 0 : 1) - (b.team === lead ? 0 : 1))
  },

  pack(_c, s) {
    return [r2(s.hoopX[0]), r2(s.hoopX[1]), r2(s.wet), r2(s.pegged[0]), r2(s.pegged[1]), s.scoredIn, r2(s.resetAt), s.lastPts, s.lint.map(r2)]
  },

  unpack(_c, s, d) {
    const a = d as (number | number[])[]
    s.hoopX = [a[0] as number, a[1] as number]
    s.wet = a[2] as number
    s.pegged = [a[3] as number, a[4] as number]
    s.scoredIn = a[5] as number
    s.resetAt = a[6] as number
    s.lastPts = a[7] as number
    s.lint = a[8] as number[]
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    for (const team of [0, 1]) {
      const g = v.baskets[team]
      const x = ctx.isHost ? s.hoopX[team] : THREE.MathUtils.damp(g.position.x, s.hoopX[team], 12, dt)
      g.position.set(x, 0, 0)
      // A little swing when a score lands.
      g.rotation.z = s.scoredIn === team ? Math.sin((s.resetAt - t) * 14) * 0.08 : THREE.MathUtils.damp(g.rotation.z, 0, 6, dt)
      const pg = v.pegs[team]
      pg.visible = s.pegged[team] > t
      if (pg.visible) pg.position.set(x, RIM + 0.15, 0)
    }
    // Wet sock: darker and dripping.
    const wet = s.wet > t
    v.sockMat.color.set(wet ? '#7dd3fc' : '#ffffff')
    if (wet && Math.floor(t * 4) !== Math.floor((t - dt) * 4)) ctx.fxLocal.puff(s.sock.translation(), 'milk', 2)
    for (let i = 0; i < v.laundry.length; i++) v.laundry[i].rotation.x = Math.sin(t * 1.3 + i * 1.7) * 0.18
    const sp = s.sock.translation()
    v.ring.position.set(sp.x, 0.03, sp.z)
    v.ring.visible = sp.y > 0.9 && s.scoredIn < 0
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const chips: string[] = []
    if (t < MOVE_AT && ctx.phase === 'play') chips.push(`Baskets start moving in ${Math.ceil(MOVE_AT - t)} s`)
    if (s.wet > t) chips.push('Wet sock: heavy and short')
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (me && me.status === 'play') {
      const h = holderOf(ctx, s.sock)
      if (h === me) prompt = 'Let go of E facing their basket to shoot, or a teammate to pass · jump at the basket to DUNK'
      else if (h && h.team === me.team) prompt = 'Get open: run ahead towards their basket for a pass'
      else if (h) prompt = `${h.name} has the sock: dive (Shift) to block!`
      else prompt = 'Grab the sock (E)!'
      if (s.lint[me.idx] > t) prompt = 'Lint on your feet! Jump to shake it off.'
      if (s.pegged[me.team] > t) status = { text: 'YOUR BASKET IS PEGGED', color: '#facc15' }
      else if (s.pegged[attack(me.team)] > t) status = { text: 'THEIR BASKET IS PEGGED SHUT', color: '#facc15', pulse: true }
    }
    return { chips, prompt, status }
  },
})

function score(ctx: LevelCtx, s: HoopState, team: number, pts: number, by: Toy | null, label: string) {
  const hoop = attack(team)
  s.scoredIn = hoop
  s.resetAt = ctx.time + 1.6
  s.lastPts = pts
  s.shot = null
  for (const toy of ctx.toys) if (toy.holdingProp === s.sock) toy.release(false)
  ctx.addTeamScore(team, pts, label === 'SCORE!' ? 'basket' : label.toLowerCase().replace('!', ''), by)
  ctx.fx.say(`${label} +${pts}`, ctx.teams[team].color, 1.4)
  ctx.fx.sfx(pts > 1 ? 'slam' : 'ding', { x: s.hoopX[hoop], y: RIM, z: 0 })
  ctx.fx.confetti({ x: s.hoopX[hoop], y: RIM, z: 0 })
  if (by) ctx.addSprinkles(by, 1)
}

/** Bot: face (x, z) and let go of the sock (a throw that way). */
function aimBot(toy: Toy, x: number, z: number) {
  toy.yaw = Math.atan2(x - toy.pos.x, z - toy.pos.z)
  toy.pad.mx = Math.sin(toy.yaw) * 0.3
  toy.pad.mz = Math.cos(toy.yaw) * 0.3
  toy.pad.grab = false
}
