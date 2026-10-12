// Egg Hunt Heist (team). Painted eggs are hidden in the houseplant jungle. Stand by a pot and hold R to rummage
// through the leaves (everyone sees a plant rustle, so searching gives the spot away); grab what you find (E) and
// carry it home to your team's nest. Carriers waddle slowly and drop the egg when tackled. Some eggs are decoys:
// carry one for a moment and it bursts in a cloud of paint. In the last 20 seconds a golden egg turns up, worth
// three. Most eggs in the nest when time runs out wins.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { avoidWalls, bully, hopObstacles, skill, steerTo, teamRank } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import type { RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { basketMesh, carryTo, fetch, holdChanges, holderOf, instanced, looseBody, mat, paint, park, parked, poss, r2, unpark } from './team-kit'

const HW = 13
const HD = 9.5
const NEST_X = 10.6
const NEST_R = 1.05
const N_PLANTS = 16
const N_EGGS = 10
const N_DECOYS = 2
const N_SPARE = 4
const GOLD_AT = 100
const SEARCH = 1
const POP_AFTER = 1.4

interface Plant {
  x: number
  z: number
  r: number
  h: number
}

interface EggState {
  /** Per plant: what's hidden (-1 nothing, else egg index), search progress 0..1, last rustle time. */
  hidden: number[]
  progress: number[]
  rustle: number[]
  /** Per plant: a decoy planted by this team (-1). Each team sees its own. */
  decoyBy: number[]
  /** Eggs in each nest right now (synced, for the HUD). */
  inNest: [number, number]
  goldPlant: number
  // Host only.
  plants: Plant[]
  eggs: RigidBody[]
  /** 0 painted, 1 decoy, 2 golden. */
  kind: number[]
  heldFor: number[]
  prev: number[]
  wobbleAt: number
  // Visuals.
  vis: { leaves: THREE.InstancedMesh; leafBase: { plant: number; m: THREE.Matrix4 }[]; beam: THREE.Mesh; marks: THREE.Sprite[]; dirty: Set<number>; bars: THREE.Mesh[] }
}

const nestX = (team: number) => (team === 0 ? -NEST_X : NEST_X)
const value = (k: number) => (k === 2 ? 3 : k === 1 ? 0 : 1)

function inNest(team: number, p: { x: number; y: number; z: number }) {
  return Math.hypot(p.x - nestX(team), p.z) < NEST_R - 0.1 && p.y < 1.1
}

function eggTex(rng: LevelCtx['rng'], gold: boolean) {
  const pal = gold ? ['#fbbf24', '#fde68a', '#f59e0b'] : rng.pick([['#f9a8d4', '#a5f3fc', '#fde68a'], ['#c4b5fd', '#fbcfe8', '#ffffff'], ['#86efac', '#fde047', '#f472b6'], ['#93c5fd', '#fca5a5', '#fef9c3']])
  const style = rng.int(0, 3)
  return paint(64, 64, (g, w, h) => {
    g.fillStyle = pal[0]
    g.fillRect(0, 0, w, h)
    g.fillStyle = pal[1]
    if (style === 0) {
      // Zigzag band.
      g.beginPath()
      for (let x = 0; x <= w; x += 8) g.lineTo(x, h / 2 + (x % 16 ? -7 : 7))
      g.lineTo(w, h / 2 + 14)
      g.lineTo(0, h / 2 + 14)
      g.fill()
    } else if (style === 1) for (let i = 0; i < 14; i++) g.fillRect((i * 23) % w, (i * 17) % h, 7, 7)
    else for (let y = 6; y < h; y += 14) g.fillRect(0, y, w, 5)
    g.fillStyle = pal[2]
    for (let i = 0; i < 6; i++) {
      g.beginPath()
      g.arc((i * 29) % w, (i * 41 + 9) % h, 3, 0, Math.PI * 2)
      g.fill()
    }
  })
}

export default defineLevel<EggState>({
  id: 'egg-hunt',
  name: 'Egg Hunt Heist',
  type: 'team',
  blurb: 'Painted eggs hide in the houseplant jungle. Find them, carry them home, mind the decoys.',
  howTo: [
    'Stand by a pot and hold R to search it. Everyone sees a plant rustle',
    'Grab an egg (E) and carry it to your nest. Carriers are slow: tackle them!',
    'Decoy eggs burst in a cloud of paint if you carry them too long',
    'Last 20 seconds: a golden egg worth three appears in the jungle',
  ],
  accent: '#ec4899',
  players: [2, 16],
  duration: 120,
  teams: { names: ['Speckles', 'Bluebells'], colors: ['#ec4899', '#3b82f6'], scoreName: 'eggs' },
  sprinkles: { start: 1 },
  camera: { kind: 'chase', dist: 7.5 },
  introOrbit: { radius: 16, height: 9 },
  sky: { color: '#1d2414', fogNear: 40, fogFar: 110 },

  tricks: [
    {
      id: 'decoy',
      name: 'Plant a Decoy',
      icon: 'star',
      cost: 2,
      cooldown: 12,
      busy: 1,
      target: 'none',
      desc: 'Hide a decoy egg in the nearest empty plant. Whoever finds it gets a faceful of paint.',
      counter: 'Watch who was rummaging there before you.',
      can: (_c, s, user) => (nearestPlant(s, user, (i) => s.hidden[i] < 0 && s.progress[i] >= 1) < 0 ? 'No empty plant nearby' : spareDecoy(s) < 0 ? 'Out of decoys' : true),
      apply: (ctx, s, user) => {
        const p = nearestPlant(s, user, (i) => s.hidden[i] < 0 && s.progress[i] >= 1)
        const e = spareDecoy(s)
        if (p < 0 || e < 0) return
        s.hidden[p] = e
        s.kind[e] = 1
        s.progress[p] = 0
        s.decoyBy[p] = user.team
        s.rustle[p] = ctx.time
        ctx.fx.popup(user, 'Decoy planted…', ctx.teams[user.team].color)
      },
      botUse: (ctx, s, user) => (nearestPlant(s, user, (i) => s.hidden[i] < 0 && s.progress[i] >= 1, 5) >= 0 && spareDecoy(s) >= 0 && ctx.rng.chance(0.5) ? null : false),
    },
    {
      id: 'butter',
      name: 'Butterfingers',
      icon: 'crumb',
      cost: 1,
      cooldown: 6,
      busy: 0.4,
      target: 'rival',
      desc: 'Butter a rival’s paws: they drop the egg they are carrying.',
      counter: 'Bubble Wrap, or keep a teammate close to pick it up.',
      can: (_c, s, _u, target) => (target && !(target.holdingProp && s.eggs.includes(target.holdingProp)) ? 'They are not carrying an egg' : true),
      apply: (ctx, _s, _u, target) => {
        if (!target) return
        target.release(false)
        target.stun = Math.max(target.stun, 0.5)
        ctx.fx.popup(target, 'Butterfingers!', '#fde68a')
        ctx.fx.sfx('squeak', target.pos)
      },
      botUse: (ctx, s, user) => {
        for (const t of ctx.rivalsOf(user)) if (t.holdingProp && s.eggs.includes(t.holdingProp)) return t
        return false
      },
    },
    {
      id: 'shake',
      name: 'Nest Shake',
      icon: 'slam',
      cost: 3,
      cooldown: 18,
      busy: 1,
      target: 'none',
      desc: "Jolt the other team's nest: two of their eggs bounce out onto the floor.",
      counter: 'Leave someone home to pop them back in.',
      can: (_c, s, user) => (s.inNest[1 - user.team] < 1 ? 'Their nest is empty' : true),
      apply: (ctx, s, user) => {
        const them = 1 - user.team
        let k = 0
        for (const b of s.eggs) {
          if (k >= 2 || !inNest(them, b.translation()) || holderOf(ctx, b)) continue
          const a = ctx.rng.range(0, Math.PI * 2)
          b.setLinvel({ x: Math.cos(a) * 4 + (them === 0 ? 3 : -3), y: 6, z: Math.sin(a) * 4 }, true)
          k++
        }
        ctx.fx.say(`${poss(ctx.teams[them].name).toUpperCase()} NEST IS SHAKING!`, ctx.teams[user.team].color, 1.4)
        ctx.fx.sfx('boing', { x: nestX(them), y: 0.5, z: 0 })
        ctx.fx.shake(0.2)
      },
      botUse: (_c, s, user) => (s.inNest[1 - user.team] >= 3 ? null : false),
    },
    bubbleWrap<EggState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: HW, hd: HD, ridge: 16, knee: 4.5, lights: ctx.quality === 'low' ? 20 : 40, quality: ctx.quality })
    // A mossy rug under the jungle.
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(9, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: paint(128, 128, (g, w, h) => {
          g.fillStyle = '#4d7c3a'
          g.fillRect(0, 0, w, h)
          for (let i = 0; i < 300; i++) {
            g.fillStyle = i % 3 ? '#5f9447' : '#3f6b2f'
            g.fillRect((i * 37) % w, (i * 61) % h, 3, 3)
          }
        }, 4),
        roughness: 1,
      }),
    )
    rug.scale.set(1.25, 1, 0.95)
    rug.position.y = 0.01
    rug.receiveShadow = true
    ctx.root.add(rug)
    // Set dressing: the music box on a crate and a stack of boxes by the walls.
    const boxes = prop(ctx.assets, 'boxes', 2.6)
    boxes.position.set(-4, 0, -HD + 1.2)
    ctx.root.add(boxes)
    ctx.phys.box({ x: -4, y: 1.2, z: -HD + 1.2 }, { x: 1.4, y: 1.2, z: 1 })
    const tin = prop(ctx.assets, 'tin', 1.2)
    tin.position.set(5, 0, HD - 1.2)
    ctx.root.add(tin)
    ctx.phys.cylinder({ x: 5, y: 0.6, z: HD - 1.2 }, 0.6, 1)
  },

  init(ctx) {
    // Plants: placed with the round seed (identical on every screen) on one half, then mirrored through the
    // middle so neither team's half is richer. Clear of the nests and spawns.
    const plants: Plant[] = []
    for (let tries = 0; plants.length < N_PLANTS && tries < 400; tries++) {
      const x = ctx.rng.range(-8.4, -0.9), z = ctx.rng.range(-HD + 1.6, HD - 1.6)
      const r = ctx.rng.range(0.55, 0.85)
      const clash = (px: number, pz: number) => plants.some((p) => Math.hypot(p.x - px, p.z - pz) < p.r + r + 1.5)
      if (clash(x, z) || clash(-x, -z) || Math.abs(x) < r + 0.8) continue
      const h = ctx.rng.range(0.7, 1.1)
      plants.push({ x, z, r, h }, { x: -x, z: -z, r, h })
    }
    const pots: { pos: [number, number, number]; scale: [number, number, number]; color: string }[] = []
    const leafBase: { plant: number; m: THREE.Matrix4 }[] = []
    const o = new THREE.Object3D()
    const leafCols = ['#2f7d32', '#3f9142', '#256b2a', '#4aa04f', '#1f5f2a']
    plants.forEach((p, i) => {
      ctx.phys.cylinder({ x: p.x, y: p.h / 2, z: p.z }, p.h / 2, p.r)
      pots.push({ pos: [p.x, p.h / 2, p.z], scale: [p.r, p.h, p.r], color: ctx.rng.pick(['#c2410c', '#b45309', '#9a3412', '#d97706']) })
      // Leaves: a fan of big flat leaves (monstera) or many thin fronds (fern).
      const fern = i % 3 === 0
      const count = fern ? 12 : 8
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + ctx.rng.range(-0.2, 0.2)
        const tilt = fern ? ctx.rng.range(0.6, 1.1) : ctx.rng.range(0.35, 0.8)
        const len = fern ? ctx.rng.range(1, 1.4) : ctx.rng.range(0.8, 1.15)
        o.position.set(p.x + Math.sin(a) * len * 0.45 * Math.sin(tilt), p.h + 0.15 + Math.cos(tilt) * len * 0.45 + (k % 2) * 0.25, p.z + Math.cos(a) * len * 0.45 * Math.sin(tilt))
        o.rotation.set(0, a, 0)
        o.rotateX(tilt)
        o.scale.set(fern ? 0.16 : 0.42, len * 0.5, 0.05)
        o.updateMatrix()
        leafBase.push({ plant: i, m: o.matrix.clone() })
      }
    })
    const potMesh = instanced(new THREE.CylinderGeometry(1, 0.78, 1, 14), mat('#ffffff', { roughness: 0.9 }), pots, true)
    ctx.root.add(potMesh)
    const soil = instanced(new THREE.CircleGeometry(0.92, 14).rotateX(-Math.PI / 2), mat('#3b2615'), plants.map((p) => ({ pos: [p.x, p.h + 0.01, p.z] as [number, number, number], scale: [p.r, 1, p.r] as [number, number, number] })))
    ctx.root.add(soil)
    const leafGeo = new THREE.SphereGeometry(1, 7, 5)
    leafGeo.translate(0, 0.9, 0)
    const leaves = new THREE.InstancedMesh(leafGeo, mat('#ffffff', { roughness: 0.7, side: THREE.DoubleSide }), leafBase.length)
    const col = new THREE.Color()
    leafBase.forEach((l, i) => {
      leaves.setMatrixAt(i, l.m)
      leaves.setColorAt(i, col.set(leafCols[(i * 7) % leafCols.length]))
    })
    leaves.castShadow = true
    leaves.instanceMatrix.needsUpdate = true
    ctx.root.add(leaves)
    // Nests: a woven nest of straw at each end.
    for (const team of [0, 1]) {
      const nest = basketMesh(NEST_R, 0.42, ctx.teams[team].color)
      nest.position.set(nestX(team), 0, 0)
      ctx.root.add(nest)
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        ctx.phys.box({ x: nestX(team) + Math.sin(a) * NEST_R, y: 0.21, z: Math.cos(a) * NEST_R }, { x: 0.06, y: 0.21, z: 0.34 }, { rotY: a })
      }
    }
    // Eggs: a pool of bodies (painted, decoys, spares for planted decoys, and the golden one), parked until found.
    const total = N_EGGS + N_DECOYS + N_SPARE + 1
    const geo = new THREE.SphereGeometry(0.26, 12, 9)
    geo.scale(1, 1.28, 1)
    const eggs: RigidBody[] = []
    const kind: number[] = []
    for (let i = 0; i < total; i++) {
      const gold = i === total - 1
      const b = looseBody(ctx, { x: 0, y: -60, z: 0 }, { ball: 0.27 }, { density: 0.6, restitution: 0.2, friction: 0.8, damping: 0.6 })
      park(b, i)
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: eggTex(ctx.rng, gold), roughness: gold ? 0.25 : 0.55, metalness: gold ? 0.6 : 0, emissive: gold ? '#92400e' : '#000000', emissiveIntensity: gold ? 0.4 : 0 }))
      m.castShadow = true
      ctx.root.add(m)
      ctx.grabbable(b, m)
      eggs.push(b)
      kind.push(gold ? 2 : i >= N_EGGS && i < N_EGGS + N_DECOYS ? 1 : 0)
    }
    // Hide the eggs and decoys in random plants.
    const hidden = new Array(plants.length).fill(-1)
    const order = ctx.rng.shuffle([...plants.keys()])
    for (let i = 0; i < N_EGGS + N_DECOYS && i < order.length; i++) hidden[order[i]] = i
    // A golden beam (last 20 s) and the "your decoy" marks.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 9, 14, 1, true), new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
    beam.visible = false
    ctx.root.add(beam)
    const markTex = paint(64, 64, (g) => {
      g.fillStyle = '#ffffff'
      g.font = '900 44px ui-rounded, system-ui, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('✕', 32, 34)
    })
    const marks = plants.map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex, transparent: true, depthWrite: false }))
      sp.scale.setScalar(0.5)
      sp.visible = false
      ctx.root.add(sp)
      return sp
    })
    // Search bars over plants being searched.
    const bars = plants.map(() => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12), new THREE.MeshBasicMaterial({ color: '#fde68a', depthWrite: false, toneMapped: false }))
      b.visible = false
      ctx.root.add(b)
      return b
    })
    return {
      hidden, progress: new Array(plants.length).fill(0), rustle: new Array(plants.length).fill(-9), decoyBy: new Array(plants.length).fill(-1), inNest: [0, 0], goldPlant: -1,
      plants, eggs, kind, heldFor: new Array(total).fill(0), prev: new Array(total).fill(-1), wobbleAt: 4,
      vis: { leaves, leafBase, beam, marks, dirty: new Set(), bars },
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
    return ctx.spawnGrid(n, { x: team === 0 ? -NEST_X + 1.8 : NEST_X - 1.8, z: 0, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2, spacing: 1.2, cols: 4 })[k]
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    // Searching: hold R by a pot.
    const searching = new Set<number>()
    for (const toy of ctx.toys) {
      if (toy.status !== 'play' || !toy.canAct) continue
      const want = toy.pad.act || (toy.data.searching as boolean | undefined)
      if (!want) continue
      const pi = nearestPlant(s, toy, () => true, 0.95)
      if (pi < 0 || s.progress[pi] >= 1) continue
      searching.add(pi)
      toy.data.searchPlant = pi
      if (s.progress[pi] === 0 || t - s.rustle[pi] > 0.3) {
        s.rustle[pi] = t
        ctx.fx.sfx('wind', { x: s.plants[pi].x, y: 1, z: s.plants[pi].z })
      }
      s.progress[pi] = Math.min(1, s.progress[pi] + dt / SEARCH)
      if (s.progress[pi] >= 1) reveal(ctx, s, pi, toy)
    }
    // Plants that hide something wobble now and then: a giveaway for sharp eyes.
    if (t >= s.wobbleAt) {
      s.wobbleAt = t + ctx.rng.range(2.5, 4.5)
      const full = s.hidden.map((e, i) => (e >= 0 && s.progress[i] < 1 ? i : -1)).filter((i) => i >= 0)
      if (full.length) s.rustle[ctx.rng.pick(full)] = t
    }
    // Carrying: slow, and decoys pop after a moment.
    const carriers = new Map<RigidBody, Toy>()
    for (const toy of ctx.toys) if (toy.holdingProp && toy.status === 'play') carriers.set(toy.holdingProp, toy)
    for (const toy of ctx.toys) toy.runSpeed = toy.holdingProp && s.eggs.includes(toy.holdingProp) ? 3.5 : 5.6
    s.eggs.forEach((b, i) => {
      const c = carriers.get(b)
      s.heldFor[i] = c ? s.heldFor[i] + dt : 0
      if (c && s.kind[i] === 1 && s.heldFor[i] > POP_AFTER) {
        c.release(false)
        ctx.knock(c, { x: 0, y: 3, z: 0 }, 1.3)
        ctx.fx.puff(b.translation(), 'milk', 22)
        ctx.fx.puff(b.translation(), 'spark', 12)
        ctx.fx.popup(c, 'SPLAT! A decoy!', '#f472b6')
        ctx.fx.sfx('pop', c.pos)
        ctx.fx.shake(0.4, c)
        park(b, i)
        // The team that planted it gets the credit.
        const planted = s.decoyBy.indexOf(-2 - i)
        if (planted >= 0) s.decoyBy[planted] = -1
      }
    })
    // Let go near your nest: the egg rolls in (a small assist), like dropping it in.
    for (const ev of holdChanges(ctx, s.eggs, s.prev)) {
      const b = s.eggs[ev.i]
      const p = b.translation()
      const nx = nestX(ev.by.team)
      const d = Math.hypot(p.x - nx, p.z)
      if (d < 3 && d > 0.3) {
        const T = 0.35 + d * 0.06
        b.setLinvel({ x: (nx - p.x) / T, y: (0.7 - p.y + 12 * T * T) / T, z: -p.z / T }, true)
      }
    }
    // Score: eggs in each nest right now.
    const sc = [0, 0]
    const nn: [number, number] = [0, 0]
    s.eggs.forEach((b, i) => {
      if (parked(b) || carriers.has(b)) return
      const p = b.translation()
      for (const team of [0, 1]) if (inNest(team, p)) {
        sc[team] += value(s.kind[i])
        if (s.kind[i] !== 1) nn[team]++
      }
      // A decoy delivered to a nest pops there (no points).
      if (s.kind[i] === 1 && (inNest(0, p) || inNest(1, p))) {
        ctx.fx.puff(p, 'milk', 16)
        ctx.fx.sfx('pop', p)
        park(b, i)
      }
      if (p.y < -3) unpark(b, ctx.rng.range(-3, 3), 2, ctx.rng.range(-3, 3))
    })
    if (nn[0] > s.inNest[0] || nn[1] > s.inNest[1]) {
      const team = nn[0] > s.inNest[0] ? 0 : 1
      ctx.fx.sfx('ding', { x: nestX(team), y: 0.6, z: 0 })
      ctx.fx.confetti({ x: nestX(team), y: 0.4, z: 0 })
    }
    s.inNest = nn
    ctx.setTeamScore(0, sc[0])
    ctx.setTeamScore(1, sc[1])
    // The golden egg turns up for the last 20 seconds.
    if (t >= GOLD_AT && s.goldPlant < 0) {
      const options = s.plants.map((_, i) => i).filter((i) => s.hidden[i] < 0)
      const pi = options.length ? ctx.rng.pick(options) : ctx.rng.int(0, s.plants.length)
      const gi = s.eggs.length - 1
      s.hidden[pi] = gi
      s.progress[pi] = 0
      s.decoyBy[pi] = -1
      s.goldPlant = pi
      s.rustle[pi] = t
      ctx.fx.say('A GOLDEN EGG IS HIDING IN THE JUNGLE!', '#fde047', 2.4)
      ctx.fx.sfx('zap')
    }
  },

  bot(ctx, s, toy) {
    const sk = skill(ctx)
    const t = ctx.time
    const team = toy.team === 1 ? 1 : 0
    const them = 1 - team
    const pace = sk.pace
    const d = toy.data as { plant?: number; egg?: number; job?: string; until?: number; searching?: boolean }
    d.searching = false
    // Carrying an egg: home.
    const held = toy.holdingProp
    if (held && s.eggs.includes(held)) {
      const left = carryTo(ctx, toy, nestX(team) + (team === 0 ? 1.4 : -1.4), 0, pace, 0.3)
      hopObstacles(ctx, toy)
      if (left < 1.6) toy.pad.grab = false
      return
    }
    if (held) toy.pad.grab = false
    // A rival carrying an egg close by: tackle them (the nearest of us).
    const carrier = ctx.rivalsOf(toy).find((r) => r.holdingProp && s.eggs.includes(r.holdingProp) && r.pos.distanceTo(toy.pos) < 9)
    if (carrier) {
      const { rank } = teamRank(ctx, toy, (o) => o.pos.distanceTo(carrier.pos))
      if (rank === 0) {
        const dd = steerTo(toy, carrier.pos.x + carrier.vel.x * 0.3, carrier.pos.z + carrier.vel.z * 0.3, { stop: 0.2, pace })
        avoidWalls(ctx, toy)
        if (dd < 2.6 && toy.diveCd <= 0 && ctx.rng.chance(0.08 + sk.aggression * 0.08)) toy.pad.dive = true
        else if (dd < 1.4) bully(toy, carrier, 1.4)
        return
      }
    }
    // A raider at our nest: the nearest of us sees them off.
    const raider = ctx.rivalsOf(toy).find((r) => Math.hypot(r.pos.x - nestX(team), r.pos.z) < 3.2)
    if (raider && raider.pos.distanceTo(toy.pos) < 12) {
      const { rank } = teamRank(ctx, toy, (o) => o.pos.distanceTo(raider.pos))
      if (rank === 0) {
        const dd = steerTo(toy, raider.pos.x, raider.pos.z, { stop: 0.2, pace })
        if (dd < 2.4 && toy.diveCd <= 0 && ctx.rng.chance(0.1)) toy.pad.dive = true
        else if (dd < 1.4) bully(toy, raider, 1.4)
        return
      }
    }
    // A loose egg we can see: go and get it (not one of our own decoys, not one already in our nest).
    if (d.egg === undefined || !validEgg(ctx, s, d.egg, team)) {
      d.egg = undefined
      let best = -1, bd = 14
      s.eggs.forEach((b, i) => {
        if (!validEgg(ctx, s, i, team)) return
        const p = b.translation()
        const dd = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z) - value(s.kind[i]) * 3 + (inNest(them, p) ? 4 : 0)
        const taken = ctx.teammatesOf(toy).some((m) => (m.data as { egg?: number }).egg === i)
        if (!taken && dd < bd) {
          bd = dd
          best = i
        }
      })
      if (best >= 0) d.egg = best
    }
    if (d.egg !== undefined) {
      fetch(ctx, toy, s.eggs[d.egg], pace)
      return
    }
    // Search a plant: prefer ones that just rustled on their own (a giveaway) and the golden one.
    if (d.plant === undefined || s.progress[d.plant] >= 1 || s.decoyBy[d.plant] === team) {
      let best = -1, bs = -Infinity
      s.plants.forEach((p, i) => {
        if (s.progress[i] >= 1 || s.decoyBy[i] === team) return
        const taken = ctx.teammatesOf(toy).some((m) => (m.data as { plant?: number }).plant === i)
        const dd = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z)
        const hint = t - s.rustle[i] < 3 && sk.accuracy > ctx.rng.next() ? 6 : 0
        const score = -dd + hint + (i === s.goldPlant ? 20 : 0) - (taken ? 8 : 0)
        if (score > bs) {
          bs = score
          best = i
        }
      })
      d.plant = best >= 0 ? best : undefined
    }
    if (d.plant !== undefined) {
      const p = s.plants[d.plant]
      const dx = toy.pos.x - p.x, dz = toy.pos.z - p.z
      const l = Math.hypot(dx, dz) || 1
      const dd = steerTo(toy, p.x + (dx / l) * (p.r + 0.45), p.z + (dz / l) * (p.r + 0.45), { stop: 0.25, pace })
      // Near the pot, walk straight in (whisker steering would just circle it).
      if (l > p.r + 2.5) avoidWalls(ctx, toy)
      if (dd < 0.7 || l < p.r + 0.9) {
        d.searching = true
        toy.pad.mx = toy.pad.mz = 0
      }
      return
    }
    // Nothing left to find: raid their nest.
    steerTo(toy, nestX(them), 0, { stop: 0.8, pace })
    avoidWalls(ctx, toy)
  },

  canThrow: (ctx, s, kind, target) => kind !== 'paper' || !!target.holdingProp || ctx.time > 0 || s.inNest.length > 0,

  onThrow(ctx, s, kind, target) {
    // A paper ball makes an egg carrier drop it.
    if (kind === 'paper' && target.holdingProp && s.eggs.includes(target.holdingProp)) {
      target.release(false)
      ctx.fx.popup(target, 'Dropped it!', '#fca5a5')
    }
    return false
  },

  rank(ctx) {
    const lead = (ctx.teams[0]?.score ?? 0) >= (ctx.teams[1]?.score ?? 0) ? 0 : 1
    return ctx.active().sort((a, b) => (a.team === lead ? 0 : 1) - (b.team === lead ? 0 : 1))
  },

  pack(_c, s) {
    return [s.hidden.map((h) => (h >= 0 ? 1 : 0)), s.progress.map((p) => Math.round(p * 20)), s.rustle.map(r2), s.decoyBy, s.inNest[0], s.inNest[1], s.goldPlant]
  },

  unpack(_c, s, d) {
    const a = d as [number[], number[], number[], number[], number, number, number]
    s.hidden = a[0].map((h) => (h ? 1 : -1))
    s.progress = a[1].map((p) => p / 20)
    s.rustle = a[2]
    s.decoyBy = a[3]
    s.inNest = [a[4], a[5]]
    s.goldPlant = a[6]
  },

  visual(ctx, s) {
    const t = ctx.time
    const v = s.vis
    // Rustle: shake the leaves of plants being searched (or wobbling), then settle them back.
    const m = new THREE.Matrix4()
    const r = new THREE.Matrix4()
    let changed = false
    const active = new Set<number>()
    s.rustle.forEach((rt, i) => {
      if (t - rt < 0.45) active.add(i)
    })
    v.leafBase.forEach((l, i) => {
      if (active.has(l.plant)) {
        const k = 1 - (t - s.rustle[l.plant]) / 0.45
        r.makeRotationY(Math.sin(t * 40 + i) * 0.18 * k)
        const p = s.plants[l.plant]
        m.makeTranslation(p.x, 0, p.z).multiply(r).multiply(new THREE.Matrix4().makeTranslation(-p.x, 0, -p.z)).multiply(l.m)
        v.leaves.setMatrixAt(i, m)
        v.dirty.add(l.plant)
        changed = true
      } else if (v.dirty.has(l.plant)) {
        v.leaves.setMatrixAt(i, l.m)
        changed = true
      }
    })
    for (const p of [...v.dirty]) if (!active.has(p)) v.dirty.delete(p)
    if (changed) v.leaves.instanceMatrix.needsUpdate = true
    // Your team's planted decoys get a little cross; search bars over plants in progress.
    const me = ctx.me
    s.plants.forEach((p, i) => {
      const mk = v.marks[i]
      mk.visible = !!me && s.decoyBy[i] === me.team && s.progress[i] < 1
      if (mk.visible) mk.position.set(p.x, p.h + 1.8, p.z)
      const bar = v.bars[i]
      bar.visible = s.progress[i] > 0 && s.progress[i] < 1
      if (bar.visible) {
        bar.position.set(p.x, p.h + 1.5, p.z)
        bar.scale.x = Math.max(0.05, s.progress[i])
        bar.quaternion.copy(ctx.cam.camera.quaternion)
      }
    })
    // The golden egg's plant glows until it's found.
    v.beam.visible = s.goldPlant >= 0 && s.progress[s.goldPlant] < 1
    if (v.beam.visible) {
      const p = s.plants[s.goldPlant]
      v.beam.position.set(p.x, 4.5, p.z)
      ;(v.beam.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.12 * Math.sin(t * 6)
    }
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const left = s.hidden.filter((h, i) => h >= 0 && s.progress[i] < 1).length
    const chips = [`${s.plants.length - s.progress.filter((p) => p >= 1).length} plants unsearched`]
    if (t < GOLD_AT && ctx.phase === 'play') chips.push(`Golden egg in ${Math.ceil(GOLD_AT - t)} s`)
    void left
    let prompt: string | undefined
    let status: { text: string; color: string; pulse?: boolean } | undefined
    if (s.goldPlant >= 0 && s.progress[s.goldPlant] < 1) status = { text: 'GOLDEN EGG!', color: '#fde047', pulse: true }
    if (me && me.status === 'play') {
      const holding = me.holdingProp && s.eggs.includes(me.holdingProp)
      const near = nearestPlant(s, me, (i) => s.progress[i] < 1, 0.95)
      if (holding) prompt = 'Carry it home to your nest (let go of E there). Mind the tacklers!'
      else if (near >= 0) prompt = 'Hold R to search this plant'
      else prompt = 'Find a plant to search (hold R by a pot) · grab loose eggs with E'
    }
    return { chips, prompt, status }
  },
})

/** The plant nearest a toy whose pot it is standing at (within `reach` of the pot's edge), or -1. */
function nearestPlant(s: EggState, toy: Toy, ok: (i: number) => boolean, reach = 99) {
  let best = -1, bd = Infinity
  s.plants.forEach((p, i) => {
    if (!ok(i)) return
    const d = Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z) - p.r
    if (d < reach && d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

function spareDecoy(s: EggState) {
  for (let i = N_EGGS + N_DECOYS; i < N_EGGS + N_DECOYS + N_SPARE; i++) if (parked(s.eggs[i]) && !s.hidden.includes(i)) return i
  return -1
}

/** An egg a bot of `team` should go for: out in the open (or in the rival nest), not held, not its own decoy. */
function validEgg(ctx: LevelCtx, s: EggState, i: number, team: number) {
  const b = s.eggs[i]
  if (!b || parked(b) || holderOf(ctx, b)) return false
  const p = b.translation()
  if (inNest(team, p)) return false
  // Bots of the planting team know their decoy (it was found by someone and is lying about).
  if (s.kind[i] === 1 && (b.userData as { by?: number } | undefined)?.by === team) return false
  return true
}

/** A plant searched to the bottom: out pops whatever it hid. */
function reveal(ctx: LevelCtx, s: EggState, pi: number, by: Toy) {
  const p = s.plants[pi]
  const e = s.hidden[pi]
  s.hidden[pi] = -1
  if (e < 0) {
    ctx.fx.popup(by, 'Nothing here…', '#d1d5db')
    return
  }
  const b = s.eggs[e]
  b.userData = { by: s.decoyBy[pi] }
  s.decoyBy[pi] = -1
  if (pi === s.goldPlant) s.goldPlant = -2
  unpark(b, p.x + (by.pos.x - p.x) * 0.4, p.h + 0.9, p.z + (by.pos.z - p.z) * 0.4, 3)
  ctx.fx.puff({ x: p.x, y: p.h + 0.8, z: p.z }, 'spark', 14)
  ctx.fx.sfx('pop', { x: p.x, y: 1, z: p.z })
  ctx.fx.popup(by, s.kind[e] === 2 ? 'THE GOLDEN EGG!' : 'Found an egg!', s.kind[e] === 2 ? '#fde047' : '#f9a8d4')
  ctx.addSprinkles(by, 1)
  if (s.kind[e] === 2) ctx.fx.say(`${by.name} found the golden egg!`, '#fde047', 1.8)
}
