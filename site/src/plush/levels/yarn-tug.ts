// Yarn Tug (team). Two teams stand on stacks of books and tug a strand of yarn across the gap between them, with
// the ball of yarn hanging in the middle. Pull on the beat (a ring closes round your feet) for extra strength;
// the front puller pulls hardest but tires fastest, so shuffle along the rope; let go just as the other side
// heaves and they tumble over. Drag their front puller over the edge to win a set: best of three, and the gap
// widens (and the beat quickens) every set. Tricks: untie their knot, butter a rival's paws, tickle the front.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { skill } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { instanced, mat, paint, r2, stripeTex, wickerTex } from './team-kit'

/** Distance from the book edge to the front puller at the start of a set (how far the rope must travel). */
const D0 = 2.3
/** Spacing between pullers on the rope. */
const SP = 0.95
const GAPS = [2.2, 3.4, 4.6]
const BEATS = [0.95, 0.84, 0.74]
const READY = 2.4
const DRAG = 3
/** A set is decided on position after this long; the last few seconds pull harder. */
const SET_MAX = 30
const HEAVE = 22
const HAND_Y = 0.62
const FLOOR_Y = -6
const BOOK_LEN = 15

const PH = { ready: 0, pull: 1, drag: 2, done: 3 } as const

interface TugState {
  /** Rope offset (+x pulls team 0's front towards the gap) and its speed. */
  x: number
  v: number
  set: number
  ph: number
  phT: number
  beat0: number
  gap: number
  wins: [number, number]
  /** Toy indices along the rope per team, front first. */
  order: [number[], number[]]
  stam: number[]
  /** Can't pull until this time (stumble, butter, tickle, a gallery bonk). */
  lock: number[]
  /** Why it's locked: 0 stumble, 1 butter, 2 tickle. */
  lockK: number[]
  lastPull: number[]
  lastQ: number[]
  /** Untied knot: that team's pulls are weak until this time. */
  slip: [number, number]
  /** A team let go (rope slack) at this time. */
  slack: [number, number]
  /** Who went over the edge this set (-1), and which team took the last set. */
  over: number
  lastWin: number
  // Host only.
  hard: [number, number][]
  streak: number[]
  moveCd: number[]
  // Visuals (every screen).
  vis: {
    rope: THREE.Mesh
    ball: THREE.Group
    stacks: [THREE.Group, THREE.Group]
    edges: [THREE.Mesh, THREE.Mesh]
    ring: THREE.Mesh
    target: THREE.Mesh
    gapShown: number
    lastBeat: number
    seenPull: number
  }
}

function period(s: TugState) {
  return BEATS[Math.min(BEATS.length - 1, s.set)]
}

/** Seconds from time t to the nearest beat (0 = right on it). */
function beatError(s: TugState, t: number) {
  const p = period(s)
  const ph = (((t - s.beat0) / p) % 1 + 1) % 1
  return Math.min(ph, 1 - ph) * p
}

/** Where slot j of a team stands (x), given the rope offset. */
function slotX(s: TugState, team: number, j: number, gap = s.gap) {
  const side = team === 0 ? -1 : 1
  return side * (gap / 2 + D0 + j * SP) + s.x
}

function quality(err: number) {
  return err < 0.09 ? 1.6 : err < 0.2 ? 1 : 0.35
}

/** A stack of books lying flat (covers as thin plates round a cream page block, instanced). The top book is in the team colour. */
function bookStack(team: number, rng: LevelCtx['rng'], teamColor: string) {
  const g = new THREE.Group()
  type It = { pos: [number, number, number]; scale: [number, number, number]; color: string; rot: [number, number, number] }
  const covers: It[] = []
  const pages: It[] = []
  const cols = ['#9f1239', '#1e3a8a', '#166534', '#a16207', '#6d28d9', '#0f766e', '#9a3412', '#334155']
  const side = team === 0 ? -1 : 1
  let y = FLOOR_Y
  for (let i = 0; i < 8 && y < -0.01; i++) {
    const top = y + 1.25 >= -0.01
    const th = top ? -y : rng.range(0.85, 1.2)
    const w = 4.3 - i * 0.1 + rng.range(-0.15, 0.15)
    const len = BOOK_LEN + rng.range(-0.8, 0.4)
    const cx = side * (len / 2 + rng.range(-0.3, 0.02))
    const cz = rng.range(-0.18, 0.18)
    const rot: [number, number, number] = [0, top ? 0 : rng.range(-0.035, 0.035), 0]
    const color = top ? teamColor : rng.pick(cols)
    const c = th * 0.13
    // Bottom and top boards, and the spine along the back.
    covers.push({ pos: [cx, y + c / 2, cz], scale: [len, c, w], color, rot })
    covers.push({ pos: [cx, y + th - c / 2, cz], scale: [len, c, w], color, rot })
    covers.push({ pos: [cx, y + th / 2, cz - w / 2 + c / 2], scale: [len, th, c], color, rot })
    pages.push({ pos: [cx, y + th / 2, cz + 0.05], scale: [len - 0.2, th - 2 * c + 0.01, w - 0.22], color: rng.pick(['#d9c7a2', '#cfbb93', '#e0d0ae']), rot })
    y += th
  }
  const box = new THREE.BoxGeometry(1, 1, 1)
  g.add(instanced(box, mat('#ffffff', { roughness: 0.7 }), covers, true))
  g.add(instanced(box, mat('#ffffff', { roughness: 0.95 }), pages))
  return g
}

function yarnBall(r: number, colors: string[]) {
  const tex = stripeTex(colors, 10)
  tex.repeat.set(1, 3)
  const g = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }))
  ball.castShadow = true
  // Loose wraps across the ball.
  const wrapM = mat(colors[0], { roughness: 1 })
  for (let i = 0; i < 3; i++) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, r * 0.06, 4, 24), wrapM)
    w.rotation.set(i * 1.1, i * 0.7, i * 0.4)
    g.add(w)
  }
  g.add(ball)
  return g
}

export default defineLevel<TugState>({
  id: 'yarn-tug',
  name: 'Yarn Tug',
  type: 'team',
  blurb: 'Two teams, one strand of yarn, a gap between the book stacks. Drag them over the edge.',
  howTo: [
    'Pull on the beat: Space (or R / click) as the ring closes on your feet',
    'Front pullers pull hardest but tire fastest: move along the rope with ← →',
    'Shift lets go: time it as they heave and they all fall over',
    'Best of three sets. The gap widens every set',
  ],
  accent: '#e11d48',
  players: [2, 16],
  duration: 120,
  bodyMode: 'seated',
  teams: { names: ['Purl', 'Knit'], colors: ['#e11d48', '#0ea5e9'], scoreName: 'sets' },
  sprinkles: { start: 1, name: 'Sprinkles' },
  introOrbit: { radius: 16, height: 6, center: [0, -1, 0] },
  sky: { color: '#2a1810', fogNear: 40, fogFar: 120 },
  fallY: -50,

  tricks: [
    {
      id: 'knot',
      name: 'Untie the Knot',
      icon: 'swap',
      cost: 3,
      cooldown: 18,
      busy: 1.5,
      target: 'none',
      desc: "Loosen the other team's knot: for 3 seconds their pulls slip and count for less than half.",
      counter: 'It re-ties itself after 3 seconds. Rest and save stamina for it.',
      can: (ctx, s, user) => (s.ph !== PH.pull ? 'Wait for the pull' : s.slip[1 - user.team] > ctx.time ? 'Already loose' : true),
      apply: (ctx, s, user) => {
        const them = 1 - user.team
        s.slip[them] = ctx.time + 3
        ctx.fx.say(`${ctx.teams[them].name}'s knot slips!`, ctx.teams[user.team].color, 1.4)
        ctx.fx.sfx('snip')
        ctx.fx.puff({ x: s.x, y: HAND_Y, z: 0 }, 'spark', 10)
      },
      botUse: (_c, s, user) => (s.ph === PH.pull && Math.abs(s.x) > 0.6 && Math.sign(s.x) === (user.team === 0 ? 1 : -1) ? null : false),
    },
    {
      id: 'butter',
      name: 'Butter Paws',
      icon: 'milk',
      cost: 2,
      cooldown: 9,
      busy: 0.6,
      target: 'rival',
      desc: "Butter a rival's paws: their grip slides off the yarn and they can't pull for 2.5 seconds.",
      counter: 'Bubble Wrap, or keep your best pullers away from the front.',
      can: (_c, s) => (s.ph !== PH.pull ? 'Wait for the pull' : true),
      apply: (ctx, s, _u, target) => {
        if (!target) return
        s.lock[target.idx] = ctx.time + 2.5
        s.lockK[target.idx] = 1
        ctx.fx.popup(target, 'Buttery paws!', '#fde68a')
        ctx.fx.sfx('squeak', target.pos)
      },
      botUse: (ctx, s, user) => {
        // The rival with the most stamina left is the one worth stopping.
        const them = s.order[1 - user.team].map((i) => ctx.toys[i]).filter((t) => t && t.status === 'play' && s.lock[t.idx] < ctx.time)
        them.sort((a, b) => s.stam[b.idx] - s.stam[a.idx])
        return them[0] ?? false
      },
    },
    {
      id: 'tickle',
      name: 'Feather Tickle',
      icon: 'tickle',
      cost: 1,
      cooldown: 6,
      busy: 0.4,
      target: 'rival',
      desc: 'Tickle a rival with a feather: they giggle and miss the next beat or two.',
      counter: 'Bubble Wrap. Giggles pass quickly.',
      can: (_c, s) => (s.ph !== PH.pull ? 'Wait for the pull' : true),
      apply: (ctx, s, _u, target) => {
        if (!target) return
        s.lock[target.idx] = Math.max(s.lock[target.idx], ctx.time + 1.3)
        s.lockK[target.idx] = 2
        ctx.fx.popup(target, 'Hee hee!', '#fef3c7')
        ctx.fx.sfx('squeak', target.pos)
      },
      botUse: (ctx, s, user) => {
        const front = ctx.toys[s.order[1 - user.team][0]]
        return front && front.status === 'play' && s.lock[front.idx] < ctx.time ? front : false
      },
    },
    bubbleWrap<TugState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 26, hd: 22, ridge: 26, knee: 6, y: FLOOR_Y, lights: ctx.quality === 'low' ? 24 : 48, quality: ctx.quality })
    ctx.phys.box({ x: 0, y: FLOOR_Y - 0.5, z: 0 }, { x: 30, y: 0.5, z: 30 })
    // A rag rug and a basket of yarn in the gap: a soft landing for whoever goes over.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(5, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: stripeTex(['#7c2d12', '#c2410c', '#fbbf24', '#a16207'], 12), roughness: 1 }))
    rug.position.set(0, FLOOR_Y + 0.02, 0)
    rug.receiveShadow = true
    ctx.root.add(rug)
    const bk = new THREE.Group()
    const tex = wickerTex()
    tex.repeat.set(8, 2)
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.8, 1.6, 22, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }))
    wall.position.y = 0.8
    bk.add(wall)
    const balls: { pos: [number, number, number]; scale: [number, number, number]; color: string }[] = []
    const yc = ['#f472b6', '#38bdf8', '#facc15', '#a3e635', '#fb923c', '#c084fc']
    for (let i = 0; i < 11; i++) {
      const a = i * 2.4, r = (i % 4) * 0.5
      balls.push({ pos: [Math.sin(a) * r, 1.1 + (i % 3) * 0.25, Math.cos(a) * r], scale: [0.55, 0.55, 0.55], color: yc[i % yc.length] })
    }
    bk.add(instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ map: stripeTex(['#ffffff', '#d4d4d4'], 10), roughness: 1 }), balls))
    bk.position.set(0, FLOOR_Y, 0)
    ctx.root.add(bk)
    // Set dressing on the attic floor.
    const sew = prop(ctx.assets, 'sewing', 5)
    sew.position.set(-7, FLOOR_Y, -11)
    sew.rotation.y = 0.5
    const chair = prop(ctx.assets, 'armchair', 6)
    chair.position.set(9, FLOOR_Y, -12)
    chair.rotation.y = -0.4
    ctx.root.add(sew, chair)
  },

  init(ctx) {
    const n = ctx.toys.length
    const order: [number[], number[]] = [[], []]
    ctx.toys.forEach((t) => order[t.team === 1 ? 1 : 0].push(t.idx))
    const st: TugState = {
      x: 0, v: 0, set: 0, ph: PH.ready, phT: 0, beat0: READY, gap: GAPS[0], wins: [0, 0], order,
      stam: new Array(n).fill(1), lock: new Array(n).fill(0), lockK: new Array(n).fill(0), lastPull: new Array(n).fill(-9), lastQ: new Array(n).fill(0),
      slip: [0, 0], slack: [-9, -9], over: -1, lastWin: -1,
      hard: [], streak: new Array(n).fill(0), moveCd: new Array(n).fill(0),
      vis: null as unknown as TugState['vis'],
    }
    // The strand: a thin twisted tube across both stacks (moves as one piece with the rope offset).
    const ropeTex = paint(64, 16, (g, w, h) => {
      g.fillStyle = '#f9a8d4'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#be185d'
      g.lineWidth = 3
      for (let x = -16; x < w + 16; x += 8) {
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x + 8, h)
        g.stroke()
      }
    })
    ropeTex.repeat.set(60, 1)
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8, 1).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: ropeTex, roughness: 1 }))
    rope.castShadow = true
    ctx.root.add(rope)
    const ball = yarnBall(0.62, ['#f472b6', '#be185d', '#fbcfe8'])
    const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.06, 5, 12), mat('#facc15'))
    ribbon.position.y = 0.66
    ball.add(ribbon)
    ctx.root.add(ball)
    const stacks: [THREE.Group, THREE.Group] = [bookStack(0, ctx.rng, ctx.teams[0].color), bookStack(1, ctx.rng, ctx.teams[1].color)]
    ctx.root.add(...stacks)
    // Red edges that glow when someone is about to go over.
    const edges = [0, 1].map((): THREE.Mesh => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 4.2), new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.2, toneMapped: false }))
      ctx.root.add(e)
      return e
    }) as unknown as [THREE.Mesh, THREE.Mesh]
    // The timing ring round your own feet and the target it closes on.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }))
    const target = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }))
    ring.renderOrder = target.renderOrder = 3
    ctx.root.add(ring, target)
    st.vis = { rope, ball, stacks, edges, ring, target, gapShown: GAPS[0], lastBeat: -1, seenPull: -9 }
    return st
  },

  spawn(_ctx, s, toy) {
    const team = toy.team === 1 ? 1 : 0
    const j = s.order[team].indexOf(toy.idx)
    return { x: slotX(s, team, Math.max(0, j)), y: 0, z: (j % 2 ? 0.28 : -0.28), yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2 }
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const toys = ctx.toys
    const n = [s.order[0].length, s.order[1].length]
    const avg = (n[0] + n[1]) / 2

    // Phases: ready → pull → drag → (next set | done).
    if (s.ph === PH.ready && t - s.phT >= READY) {
      s.ph = PH.pull
      s.phT = t
      s.beat0 = t
      ctx.fx.say('PULL!', '#fde68a', 1)
      ctx.fx.sfx('go')
    }
    if (s.ph === PH.pull) {
      const el = t - s.phT
      if (el > SET_MAX) {
        // Out of time for this set: whoever has the rope on their side takes it.
        const winner = s.x < 0 ? 0 : s.x > 0 ? 1 : ctx.rng.int(0, 2)
        endSet(ctx, s, winner, -1)
      }
    }
    if (s.ph === PH.drag && t - s.phT >= DRAG) {
      if (s.wins[0] >= 2 || s.wins[1] >= 2 || s.set >= 2) {
        s.ph = PH.done
        const w = s.wins[0] === s.wins[1] ? (s.x <= 0 ? 0 : 1) : s.wins[0] > s.wins[1] ? 0 : 1
        ctx.winTeam(w, `${s.wins[w]}-${s.wins[1 - w]} in sets`)
        return
      }
      s.set++
      s.gap = GAPS[Math.min(GAPS.length - 1, s.set)]
      s.x = s.v = 0
      s.ph = PH.ready
      s.phT = t
      s.over = -1
      for (let i = 0; i < s.stam.length; i++) s.stam[i] = Math.max(s.stam[i], 0.75)
      ctx.fx.say(`SET ${s.set + 1}: THE GAP WIDENS`, '#fde68a', 2)
      ctx.fx.sfx('whoosh')
    }

    // Pulls.
    const heave = s.ph === PH.pull && t - s.phT > HEAVE ? 1.5 : 1
    for (let team = 0; team < 2; team++) {
      const list = s.order[team]
      for (let j = 0; j < list.length; j++) {
        const toy = toys[list[j]]
        if (!toy || toy.status !== 'play') continue
        const i = toy.idx
        const p = toy.pad
        const front = j === 0
        // Rest: stamina comes back.
        s.stam[i] = Math.min(1, s.stam[i] + dt * (front ? 0.11 : 0.17))
        s.moveCd[i] = Math.max(0, s.moveCd[i] - dt)
        if (s.ph !== PH.pull) continue
        // Move along the rope: stick towards the gap = forward.
        const fwd = team === 0 ? p.mx : -p.mx
        if (Math.abs(fwd) > 0.6 && s.moveCd[i] <= 0) {
          const k = j + (fwd > 0 ? -1 : 1)
          if (k >= 0 && k < list.length) {
            list[j] = list[k]
            list[k] = i
            s.moveCd[i] = 0.7
            s.moveCd[list[j]] = Math.max(s.moveCd[list[j]], 0.3)
          }
        }
        const wantPull = p.jump || p.act || p.shove
        if (p.dive && t - s.slack[team] > 1.5) letGo(ctx, s, team, toy)
        if (!wantPull || t - s.lastPull[i] < 0.28) continue
        if (s.lock[i] > t || t - s.slack[team] < 0.5) continue
        const err = beatError(s, t)
        const q = quality(err)
        const posK = front ? 1.35 : j === 1 ? 1.1 : 1
        const tired = 0.3 + 0.7 * s.stam[i]
        const slip = s.slip[team] > t ? 0.4 : 1
        const imp = 0.36 * q * posK * tired * slip * heave * (avg / Math.max(1, list.length))
        s.v += team === 0 ? -imp : imp
        s.stam[i] = Math.max(0, s.stam[i] - 0.085 * (front ? 1.9 : j === 1 ? 1.3 : 1) * (q < 1 ? 1.4 : 1))
        s.lastPull[i] = t
        s.lastQ[i] = q
        s.hard.push([t, team])
        if (q > 1) {
          s.streak[i]++
          if (s.streak[i] >= 4) {
            s.streak[i] = 0
            ctx.addSprinkles(toy, 1, 'rhythm')
          }
        } else s.streak[i] = 0
      }
    }
    while (s.hard.length && s.hard[0][0] < t - 0.6) s.hard.shift()

    if (s.ph === PH.pull) {
      s.v *= Math.exp(-1.7 * dt)
      s.x += s.v * dt
      // Over the edge: team 0's front reaches the gap when x ≥ D0 (team 1's when x ≤ -D0).
      if (s.x >= D0) endSet(ctx, s, 1, s.order[0][0] ?? -1)
      else if (s.x <= -D0) endSet(ctx, s, 0, s.order[1][0] ?? -1)
    }

    // Seats follow the rope.
    for (let team = 0; team < 2; team++) {
      s.order[team].forEach((i, j) => {
        const toy = toys[i]
        if (!toy) return
        let x = slotX(s, team, j)
        let y = 0
        const z = j % 2 ? 0.28 : -0.28
        if (s.over === i) {
          // Tumbling into the yarn basket.
          const k = Math.min(1, (t - s.phT) / 0.9)
          x = (team === 0 ? -1 : 1) * (s.gap / 2 - 0.3 - k * 0.9)
          y = Math.max(FLOOR_Y + 1.2, -k * k * 7.5)
        }
        toy.seat = { x, y: y + 0.5, z, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2 }
        toy.yaw = toy.seat.yaw
      })
    }
  },

  bot(ctx, s, toy) {
    const sk = skill(ctx)
    const t = ctx.time
    const d = toy.data as { next?: number; beat?: number; rest?: boolean }
    if (s.ph !== PH.pull) {
      d.next = undefined
      return
    }
    const team = toy.team === 1 ? 1 : 0
    const list = s.order[team]
    const j = list.indexOf(toy.idx)
    // Swap back from the front when tired; step up when fresh and the front is spent.
    if (j === 0 && s.stam[toy.idx] < 0.3 && list.length > 1) toy.pad.mx = team === 0 ? -1 : 1
    else if (j === 1 && s.stam[toy.idx] > 0.85 && s.stam[list[0]] < 0.3) toy.pad.mx = team === 0 ? 1 : -1
    // Pull near each beat, with a timing wobble by skill (easier bots are sloppier). Rest when spent.
    const p = period(s)
    const k = Math.floor((t - s.beat0) / p)
    if (d.beat !== k) {
      d.beat = k
      const sigma = [0.15, 0.09, 0.05][Math.max(0, Math.min(2, ctx.difficulty))]
      const rest = s.stam[toy.idx] < 0.18 && ctx.rng.chance(0.6)
      d.next = rest ? undefined : s.beat0 + (k + 1) * p + (ctx.rng.next() + ctx.rng.next() - 1) * sigma * 1.7
    }
    if (d.next !== undefined && t >= d.next) {
      toy.pad.jump = true
      d.next = undefined
    }
    // Let go when the other side is heaving hard (better bots read it better).
    const them = 1 - team
    let theirs = 0
    for (const h of s.hard) if (h[1] === them && h[0] > t - 0.35) theirs++
    const winning = team === 0 ? s.x < -0.3 : s.x > 0.3
    if (!winning && theirs >= Math.max(2, s.order[them].length * 0.6) && j === 0 && ctx.rng.chance(sk.accuracy * 0.03)) toy.pad.dive = true
  },

  rank(ctx, s) {
    // The team ahead first.
    const lead = s.wins[0] !== s.wins[1] ? (s.wins[0] > s.wins[1] ? 0 : 1) : s.x <= 0 ? 0 : 1
    return ctx.active().sort((a, b) => (a.team === lead ? 0 : 1) - (b.team === lead ? 0 : 1) || s.stam[b.idx] - s.stam[a.idx])
  },

  onTimeUp(ctx, s) {
    const w = s.wins[0] !== s.wins[1] ? (s.wins[0] > s.wins[1] ? 0 : 1) : s.x <= 0 ? 0 : 1
    ctx.winTeam(w, s.wins[0] === s.wins[1] ? 'rope on their side' : 'more sets')
  },

  canThrow: (_c, s) => s.ph === PH.pull,

  onThrow(ctx, s, kind, target) {
    // Gallery bonks make a puller fumble the yarn.
    const secs = kind === 'crumb' ? 0.6 : kind === 'paper' ? 1.1 : 0.9
    s.lock[target.idx] = Math.max(s.lock[target.idx], ctx.time + secs)
    s.lockK[target.idx] = kind === 'feather' ? 2 : 0
    ctx.fx.popup(target, kind === 'feather' ? 'Tickle!' : 'Bonk!', '#fde68a')
    return true
  },

  pack(_c, s) {
    return [
      r2(s.x), r2(s.v), s.set, s.ph, r2(s.phT), r2(s.beat0), s.gap, s.wins[0], s.wins[1], s.over * 10 + 10 + s.lastWin + 1, r2(s.slip[0]), r2(s.slip[1]), r2(s.slack[0]), r2(s.slack[1]),
      s.order[0], s.order[1], s.stam.map((v) => Math.round(v * 100)), s.lock.map(r2), s.lockK, s.lastPull.map(r2), s.lastQ.map((q) => (q > 1 ? 2 : q < 1 ? 0 : 1)),
    ]
  },

  unpack(_c, s, d) {
    const a = d as (number | number[])[]
    ;[s.x, s.v, s.set, s.ph, s.phT, s.beat0, s.gap] = a.slice(0, 7) as number[]
    s.wins[0] = a[7] as number
    s.wins[1] = a[8] as number
    const ow = a[9] as number
    s.over = Math.floor(ow / 10) - 1
    s.lastWin = (ow % 10) - 1
    s.slip[0] = a[10] as number
    s.slip[1] = a[11] as number
    s.slack[0] = a[12] as number
    s.slack[1] = a[13] as number
    s.order[0] = a[14] as number[]
    s.order[1] = a[15] as number[]
    s.stam = (a[16] as number[]).map((v) => v / 100)
    s.lock = a[17] as number[]
    s.lockK = a[18] as number[]
    s.lastPull = a[19] as number[]
    s.lastQ = (a[20] as number[]).map((q) => (q === 2 ? 1.6 : q === 0 ? 0.35 : 1))
  },

  visual(ctx, s, dt) {
    const v = s.vis
    const t = ctx.time
    v.gapShown = THREE.MathUtils.damp(v.gapShown, s.gap, 3, dt)
    // Stacks slide apart as the gap widens.
    v.stacks[0].position.x = -v.gapShown / 2
    v.stacks[1].position.x = v.gapShown / 2
    // Rope: from the back of team 0 to the back of team 1, moving with the offset.
    const nMax = Math.max(s.order[0].length, s.order[1].length, 1)
    const half = v.gapShown / 2 + D0 + (nMax - 1) * SP + 1.2
    const sag = t - Math.max(s.slack[0], s.slack[1]) < 0.5 ? 0.25 : 0
    v.rope.scale.set(half * 2, 1, 1)
    v.rope.position.set(s.x, HAND_Y - sag, 0)
    v.ball.position.set(s.x, HAND_Y - 0.75 - sag, 0)
    v.ball.rotation.z = -s.x * 1.4
    v.ball.rotation.y += dt * s.v * 0.5
    // Edges glow as a front puller gets close.
    for (let team = 0; team < 2; team++) {
      const e = v.edges[team]
      e.position.set((team === 0 ? -1 : 1) * v.gapShown / 2, 0.03, 0)
      const danger = team === 0 ? s.x / D0 : -s.x / D0
      const m = e.material as THREE.MeshBasicMaterial
      m.opacity = 0.15 + Math.max(0, danger) * (0.5 + 0.35 * Math.sin(t * 16))
    }
    // Animation: hold the rope, yank on a pull, stumble, tumble, cheer.
    for (const toy of ctx.toys) {
      const i = toy.idx
      let a: Toy['animOverride'] = 'grab'
      if (s.over === i || (s.lock[i] > t && s.lockK[i] === 0)) a = 'knock'
      else if (s.lock[i] > t && s.lockK[i] === 2) a = 'dance'
      else if (s.ph === PH.drag || s.ph === PH.done) a = s.over >= 0 && ctx.toys[s.over]?.team === toy.team ? 'knock' : 'cheer'
      else if (t - s.lastPull[i] < 0.3) a = 'push'
      else if (s.ph === PH.ready) a = 'idle'
      toy.animOverride = a
    }
    // Your timing ring: closes on your feet at every beat.
    const me = ctx.me
    const show = !!me && me.status === 'play' && s.ph === PH.pull
    v.ring.visible = v.target.visible = show
    if (me && show) {
      const p = period(s)
      const ph = (((t - s.beat0) / p) % 1 + 1) % 1
      const k = 1 - ph
      v.ring.scale.setScalar(0.5 + k * 1.6)
      v.ring.position.set(me.pos.x, me.pos.y - 0.47, me.pos.z)
      v.target.position.copy(v.ring.position)
      const rm = v.ring.material as THREE.MeshBasicMaterial
      rm.opacity = 0.35 + 0.6 * (1 - k)
      rm.color.set(beatError(s, t) < 0.09 ? '#86efac' : '#fde68a')
      const beatN = Math.floor((t - s.beat0) / p)
      if (beatN !== v.lastBeat) {
        v.lastBeat = beatN
        ctx.fxLocal.sfx('tick')
      }
      // Feedback for your own pull (from the synced pull time).
      if (s.lastPull[me.idx] !== v.seenPull && s.lastPull[me.idx] > t - 0.5) {
        v.seenPull = s.lastPull[me.idx]
        const q = s.lastQ[me.idx]
        ctx.fxLocal.popup(me, q > 1 ? 'PERFECT!' : q < 1 ? 'sloppy' : 'good', q > 1 ? '#86efac' : q < 1 ? '#fca5a5' : '#fde68a')
        if (q > 1) ctx.fxLocal.shake(0.08)
      }
    }
  },

  cameraUpdate(ctx, s, cam, dt) {
    if (ctx.phase === 'intro') return false
    // A side-on view of the whole rope, leaning towards your end.
    const nMax = Math.max(s.order[0].length, s.order[1].length, 1)
    const span = s.gap + 2 * (D0 + (nMax - 1) * SP) + 2
    const me = ctx.me
    const fx = s.x * 0.5 + (me ? (me.pos.x - s.x * 0.5) * 0.25 : 0)
    const back = 3.5 + span * 0.36 * (cam.camera.aspect < 1 ? 1.8 : 1)
    cam.yaw = Math.PI
    cam.place(new THREE.Vector3(fx, 2.6 + back * 0.62, back * 0.92), new THREE.Vector3(fx, -0.2, -0.6), dt, 4)
    return true
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const chips = [`Set ${s.set + 1} of 3 · gap ${s.gap.toFixed(1)} m`]
    if (s.ph === PH.pull && t - s.phT > HEAVE) chips.push('HEAVE: pulls count extra!')
    const bars = []
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (me && me.status === 'play') {
      const team = me.team === 1 ? 1 : 0
      const j = s.order[team].indexOf(me.idx)
      bars.push({ label: 'Stamina', value: s.stam[me.idx] ?? 0, color: s.stam[me.idx] < 0.25 ? '#f87171' : '#86efac', danger: s.stam[me.idx] < 0.25 })
      const danger = team === 0 ? s.x / D0 : -s.x / D0
      bars.push({ label: 'Edge', value: Math.max(0, Math.min(1, 0.5 + danger / 2)), color: danger > 0.5 ? '#ef4444' : '#fbbf24', danger: danger > 0.6 })
      if (s.ph === PH.ready) prompt = 'Grab the yarn! Pull on the beat when the ring closes.'
      else if (s.ph === PH.pull) {
        if (s.lock[me.idx] > t) prompt = s.lockK[me.idx] === 1 ? 'Buttery paws! Wait for your grip…' : s.lockK[me.idx] === 2 ? 'Giggling! Hold on…' : 'Whoa! Back on your feet…'
        else if (s.slip[team] > t) prompt = 'Your knot slipped! Pulls are weak for a moment.'
        else if (j === 0 && s.stam[me.idx] < 0.3) prompt = 'You are spent at the front: ← → to swap back along the rope.'
        else prompt = `Space on the beat to PULL · Shift to let go · ← → move along the rope (you are #${j + 1})`
      }
      if (s.ph === PH.pull && danger > 0.6) status = { text: 'NEAR THE EDGE!', color: '#ef4444', pulse: true }
    }
    const lw = ctx.teams[s.lastWin]
    if (s.ph === PH.drag && lw) status = { text: `${lw.name.toUpperCase()} TAKE THE SET`, color: lw.color }
    return { chips, bars, prompt, status }
  },
})

function endSet(ctx: LevelCtx, s: TugState, winner: number, over: number) {
  s.wins[winner]++
  s.lastWin = winner
  s.ph = PH.drag
  s.phT = ctx.time
  s.over = over
  s.v = 0
  ctx.setTeamScore(0, s.wins[0])
  ctx.setTeamScore(1, s.wins[1])
  const team = ctx.teams[winner]
  ctx.fx.say(`SET TO ${team.name.toUpperCase()}!`, team.color, 2)
  ctx.fx.sfx(over >= 0 ? 'splash' : 'ding')
  ctx.fx.shake(0.4)
  const loser = ctx.toys[over]
  if (loser) {
    ctx.fx.popup(loser, 'Over the edge!', '#fca5a5')
    ctx.fx.feed(`${loser.name} was dragged over the edge`)
    ctx.fx.puff({ x: (loser.team === 0 ? -1 : 1) * s.gap * 0.4, y: -1, z: 0 }, 'stuff', 16)
  }
  for (const t of ctx.teamToys(winner)) ctx.fx.confetti(t.pos)
}

/** Let go of the rope. If the other team is heaving right now they all fall over; if not, you just lose ground. */
function letGo(ctx: LevelCtx, s: TugState, team: number, by: Toy) {
  const t = ctx.time
  const them = 1 - team
  s.slack[team] = t
  let theirs = 0
  for (const h of s.hard) if (h[1] === them && h[0] > t - 0.45) theirs++
  const need = Math.max(1, Math.ceil(s.order[them].length * 0.5))
  if (theirs >= need) {
    // They yank on nothing and tumble backwards: the rope jumps their way, then they're on the floor.
    s.v += them === 0 ? -0.6 : 0.6
    for (const i of s.order[them]) {
      s.lock[i] = Math.max(s.lock[i], t + 1.6)
      s.lockK[i] = 0
    }
    ctx.fx.say('THEY TUMBLED!', ctx.teams[team].color, 1.4)
    ctx.fx.sfx('thud')
    ctx.fx.shake(0.35)
    ctx.fx.feed(`${by.name} let go at just the right moment`)
    ctx.addSprinkles(by, 1, 'slack')
    for (const i of s.order[them]) {
      const v = ctx.toys[i]
      if (v) ctx.blame(v, by)
    }
  } else {
    // Mistimed: the rope just slides away from you.
    s.v += team === 0 ? 1.1 : -1.1
    ctx.fx.popup(by, 'Oops, slack!', '#fca5a5')
    ctx.fx.sfx('whoosh')
  }
}
