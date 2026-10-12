// Pillow Fort Siege (team). Two cushion forts face off across a big bouncy bed, each round its own flag. Pull their
// cushions out of the walls (grab and carry, throw pillows, dive in), use the bed springs to get over the high
// front wall, and rebuild your own walls: a cushion dropped in your fort clicks back into an empty gap. Once a fort
// is down to fewer than half its cushions its flag is exposed: carry it home to win outright. Otherwise the team
// that has knocked out more of the other fort when time runs out wins. Sudden death: the bed bounces on its own.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { prop } from '../engine/assets'
import { avoidWalls, bully, hopObstacles, nearestRival, skill, steerTo, teamRank } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { carryTo, fetch, poss, holdChanges, holderOf, looseBody, mat, park, parked, paint, quiltTex, r2, throwBody, unpark } from './team-kit'

const BED_X = 13
const BED_Z = 8.5
const FORT_X = 8.4
const ZONE = 2.7
const CH = { x: 0.62, y: 0.3, z: 0.31 } // cushion half extents
const SUDDEN = 120
const DROP_AT = [55, 90]
const EXTRA = 4
const LOOSE = 6
/** Seconds to tug a cushion free of a rival wall. */
const TUG = 0.9

interface Slot {
  x: number
  y: number
  z: number
  rotY: number
}

interface FortState {
  /** Cushions standing in each fort (synced). */
  standing: [number, number]
  /** Slots per fort and the cushion size of each fort. */
  size: number
  /** Flag state per team: 0 home (locked), 1 exposed at home, 2 out of the fort (carried or dropped). */
  flag: [number, number]
  /** Seconds a dropped flag has lain untouched. */
  flagIdle: [number, number]
  /** Next sudden-death bounce (synced so every screen squashes the bed together). */
  bounceAt: number
  /** Duvet on a toy until (slowed). */
  duvet: number[]
  /** Seconds each toy has been tugging a cushion out of a rival wall (0 = not tugging). */
  tug: number[]
  // Host only.
  slots: [Slot[], Slot[]]
  cushions: RigidBody[]
  /** Which fort a cushion was built for (its colour). */
  home: number[]
  pillows: RigidBody[]
  flags: [RigidBody, RigidBody]
  prev: number[]
  /** A thrown body: who threw it and until when it hurts. */
  flying: Map<RigidBody, { by: Toy; until: number }>
  drops: number
  // Visuals.
  vis: { mattress: THREE.Mesh; flagGlow: THREE.Mesh[]; duvets: THREE.Mesh[]; bounceT: number; zones: THREE.Mesh[] }
}

const fortX = (team: number) => (team === 0 ? -FORT_X : FORT_X)
/** Towards the middle of the bed from a fort. */
const inward = (team: number) => (team === 0 ? 1 : -1)

function inZone(team: number, p: { x: number; y: number; z: number }) {
  return Math.abs(p.x - fortX(team)) < ZONE && Math.abs(p.z) < ZONE && p.y > -0.3 && p.y < 2.6
}

/** Wall slots: a front wall three wide and two high (plus a cap), and two side walls two long and two high. */
function fortSlots(team: number): Slot[] {
  const fx = fortX(team), d = inward(team)
  const out: Slot[] = []
  const h = CH.y * 2 + 0.01
  for (let row = 0; row < 2; row++) {
    for (const z of [-1.3, 0, 1.3]) out.push({ x: fx + d * 2.05, y: CH.y + row * h + 0.005, z, rotY: Math.PI / 2 })
    for (const side of [-1, 1]) for (const ox of [1.0, -0.35]) out.push({ x: fx + d * ox, y: CH.y + row * h + 0.005, z: side * 2.05, rotY: 0 })
  }
  out.push({ x: fx + d * 2.05, y: CH.y + 2 * h + 0.005, z: -0.65, rotY: Math.PI / 2 })
  out.push({ x: fx + d * 2.05, y: CH.y + 2 * h + 0.005, z: 0.65, rotY: Math.PI / 2 })
  return out
}

function quatY(a: number) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }
}

function flagMesh(color: string) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 6), mat('#facc15'))
  pole.position.y = 0.35
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), mat('#fca5a5'))
  tip.position.y = 1.28
  const cloth = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(1.0, 0.85, 0)]), mat(color, { side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 }))
  cloth.geometry.computeVertexNormals()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.14, 10), mat('#7c4a24'))
  base.position.y = -0.45
  g.add(pole, tip, cloth, base)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

export default defineLevel<FortState>({
  id: 'pillow-fort',
  name: 'Pillow Fort Siege',
  type: 'team',
  blurb: 'Two cushion forts on a bouncy bed. Tear theirs down, keep yours up, steal their flag.',
  howTo: [
    'Grab (E) their cushions and carry them off, or throw pillows at the walls',
    'Drop a cushion in your own fort to plug a gap in the walls',
    'Under half its cushions, a fort’s flag is exposed: carry it home to win',
    'Bed springs launch you over walls. Last 30 s: the whole bed bounces',
  ],
  accent: '#a78bfa',
  players: [2, 16],
  duration: 150,
  teams: { names: ['Feathers', 'Fluff'], colors: ['#f43f5e', '#6366f1'], scoreName: 'cushions down' },
  sprinkles: { start: 2 },
  camera: { kind: 'chase', dist: 7.5 },
  introOrbit: { radius: 17, height: 9 },
  fallY: -2.5,
  sky: { color: '#2b1a12', fogNear: 40, fogFar: 120 },

  tricks: [
    {
      id: 'seam',
      name: 'Split Seam',
      icon: 'crack',
      cost: 3,
      cooldown: 15,
      busy: 1,
      target: 'none',
      desc: "Rip a seam in the other team's fort: three of their cushions burst out of the walls.",
      counter: 'Rebuild fast: drop cushions back in your fort.',
      can: (_c, s, user) => (s.standing[1 - user.team] < 3 ? 'Their walls are down already' : true),
      apply: (ctx, s, user) => {
        const them = 1 - user.team
        const fx = fortX(them)
        const standing = s.cushions.filter((b) => inZone(them, b.translation()))
        ctx.rng.shuffle(standing)
        for (const b of standing.slice(0, 3)) {
          const p = b.translation()
          const dx = p.x - fx, dz = p.z
          const l = Math.hypot(dx, dz) || 1
          b.setLinvel({ x: (dx / l) * 6 + inward(them) * 2, y: 5, z: (dz / l) * 6 }, true)
          b.setAngvel({ x: ctx.rng.range(-4, 4), y: ctx.rng.range(-4, 4), z: ctx.rng.range(-4, 4) }, true)
          ctx.fx.puff(p, 'stuff', 10)
        }
        ctx.fx.say(`${poss(ctx.teams[them].name)} fort splits a seam!`, ctx.teams[user.team].color, 1.5)
        ctx.fx.sfx('crack', { x: fx, y: 1, z: 0 })
        ctx.fx.shake(0.25)
      },
      botUse: (_c, s, user) => (s.standing[1 - user.team] >= 8 ? null : false),
    },
    {
      id: 'duvet',
      name: 'Duvet Drop',
      icon: 'paw',
      cost: 2,
      cooldown: 10,
      busy: 0.6,
      target: 'rival',
      desc: 'Drop the duvet on a rival: they fumble whatever they carry and wade along at half speed for 3 seconds.',
      counter: 'Jump to shake it off sooner, or Bubble Wrap.',
      apply: (ctx, s, _u, target) => {
        if (!target) return
        s.duvet[target.idx] = ctx.time + 3
        target.release(false)
        ctx.fx.popup(target, 'Duvet!', '#c4b5fd')
        ctx.fx.sfx('whoosh', target.pos)
        ctx.fx.puff(target.pos, 'dust', 10)
      },
      botUse: (ctx, s, user) => {
        // Whoever is carrying our flag or one of our cushions.
        const mine = user.team
        for (const t of ctx.rivalsOf(user)) {
          if (t.holdingProp === s.flags[mine]) return t
          if (t.holdingProp && s.cushions.includes(t.holdingProp) && t.pos.distanceTo(user.pos) < 14) return t
        }
        return false
      },
    },
    {
      id: 'burst',
      name: 'Feather Burst',
      icon: 'tickle',
      cost: 1,
      cooldown: 6,
      busy: 0.4,
      target: 'rival',
      desc: 'Pop whatever a rival is carrying: feathers everywhere, they drop it and sneeze.',
      counter: 'Bubble Wrap, or carry it the long way round.',
      can: (_c, _s, _u, target) => (target && !target.holdingProp && !target.holding ? 'They are not carrying anything' : true),
      apply: (ctx, _s, _u, target) => {
        if (!target) return
        target.release(false)
        target.stun = Math.max(target.stun, 0.7)
        ctx.fx.puff(target.pos, 'stuff', 22)
        ctx.fx.popup(target, 'Achoo!', '#fef3c7')
        ctx.fx.sfx('pop', target.pos)
      },
      botUse: (ctx, s, user) => {
        for (const t of ctx.rivalsOf(user)) if (t.holdingProp === s.flags[user.team] || (t.holdingProp && t.pos.distanceTo(user.pos) < 10)) return t
        return false
      },
    },
    bubbleWrap<FortState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 26, hd: 22, ridge: 26, knee: 6, y: -3, lights: ctx.quality === 'low' ? 24 : 48, quality: ctx.quality })
    ctx.phys.box({ x: 0, y: -3.5, z: 0 }, { x: 30, y: 0.5, z: 30 })
    ctx.phys.walls(0, 0, 25, 21, 12)
    // The mattress (the arena floor) and the bed frame round it.
    ctx.phys.box({ x: 0, y: -0.5, z: 0 }, { x: BED_X, y: 0.5, z: BED_Z }, { friction: 0.9 })
    const wood = mat('#8b5a2b', { roughness: 0.6 })
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BED_X * 2 + 0.6, 1.3, BED_Z * 2 + 0.6), wood)
    frame.position.y = -1.75
    frame.receiveShadow = true
    ctx.root.add(frame)
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 1.2, 8), wood)
      leg.position.set(x * BED_X, -2.4, z * BED_Z)
      ctx.root.add(leg)
    }
    // Headboard with a painted heart, and big decorative pillows leaning on it (out of play).
    ctx.phys.box({ x: 0, y: 2, z: -BED_Z - 0.4 }, { x: BED_X + 0.3, y: 2.6, z: 0.35 })
    const hb = new THREE.Mesh(new THREE.BoxGeometry(BED_X * 2 + 0.6, 5.2, 0.7), wood)
    hb.position.set(0, 2, -BED_Z - 0.4)
    hb.castShadow = true
    ctx.root.add(hb)
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(BED_X * 1.6, 3.2),
      new THREE.MeshStandardMaterial({
        map: paint(256, 64, (g, w, h) => {
          g.fillStyle = '#d6a370'
          g.fillRect(0, 0, w, h)
          g.fillStyle = '#b4532a'
          for (let i = 0; i < 9; i++) {
            const x = (i + 0.5) * (w / 9), y = h / 2
            g.beginPath()
            g.moveTo(x, y + 9)
            g.bezierCurveTo(x - 16, y - 4, x - 6, y - 16, x, y - 6)
            g.bezierCurveTo(x + 6, y - 16, x + 16, y - 4, x, y + 9)
            g.fill()
          }
        }),
        roughness: 0.7,
      }),
    )
    panel.position.set(0, 2.4, -BED_Z - 0.04)
    ctx.root.add(panel)
    // The pillow-fort duvet bunched along the foot of the bed.
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, BED_X * 2, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: quiltTex(['#fde68a', '#fca5a5', '#a5b4fc', '#86efac']), roughness: 1 }))
    roll.position.set(0, 0.35, BED_Z + 0.3)
    ctx.root.add(roll)
    ctx.phys.box({ x: 0, y: 0.35, z: BED_Z + 0.3 }, { x: BED_X, y: 0.6, z: 0.6 })
    // Set dressing on the attic floor.
    const chest = prop(ctx.assets, 'chest', 3.2)
    chest.position.set(-6, -3, BED_Z + 5)
    const horse = prop(ctx.assets, 'horse', 3.6)
    horse.position.set(16, -3, 2)
    horse.rotation.y = -1.2
    ctx.root.add(chest, horse)
    // Bed springs near each fort: a launch over the high front wall.
    for (const team of [0, 1]) for (const z of [-3.6, 3.6]) ctx.hazards.bouncyPad({ x: fortX(team) + inward(team) * 4.3, y: 0.02, z, radius: 0.85, power: 13.5, color: team === 0 ? '#fb7185' : '#818cf8' })
  },

  init(ctx) {
    const n = ctx.toys.length
    const st: FortState = {
      standing: [0, 0], size: 0, flag: [0, 0], flagIdle: [0, 0], bounceAt: SUDDEN, duvet: new Array(n).fill(0), tug: new Array(n).fill(0),
      slots: [fortSlots(0), fortSlots(1)], cushions: [], home: [], pillows: [], flags: null as unknown as [RigidBody, RigidBody], prev: [], flying: new Map(), drops: 0,
      vis: null as unknown as FortState['vis'],
    }
    st.size = st.slots[0].length
    // The mattress top: a patchwork quilt.
    const qt = quiltTex(['#e9c46a', '#e76f51', '#8ab17d', '#f4a261', '#6d8fc9', '#d36d8c'], 6)
    qt.repeat.set(3, 2)
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(BED_X * 2, 1, BED_Z * 2), [
      mat('#f5e6d3'), mat('#f5e6d3'), new THREE.MeshStandardMaterial({ map: qt, roughness: 0.95 }), mat('#f5e6d3'), mat('#f5e6d3'), mat('#f5e6d3'),
    ])
    mattress.position.y = -0.5
    mattress.receiveShadow = true
    ctx.root.add(mattress)
    // Team rugs under each fort, so the zone reads.
    const zones: THREE.Mesh[] = []
    for (const team of [0, 1]) {
      const z = new THREE.Mesh(new THREE.PlaneGeometry(ZONE * 2, ZONE * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ctx.teams[team].color, transparent: true, opacity: 0.22, depthWrite: false }))
      z.position.set(fortX(team), 0.02, 0)
      ctx.root.add(z)
      zones.push(z)
      const sign = textSprite(`${poss(ctx.teams[team].name)} Fort`, { bg: ctx.teams[team].color, size: 0.42 })
      sign.position.set(fortX(team) + inward(team) * 2.05, 2.75, 0)
      ctx.root.add(sign)
    }
    // Cushions (grabbable), built into both forts.
    const cushionGeo = new RoundedBoxGeometry(CH.x * 2, CH.y * 2, CH.z * 2, 2, 0.14)
    const teamMats = [0, 1].map((team) => {
      const c = ctx.teams[team].color
      const tex = paint(64, 32, (g, w, h) => {
        g.fillStyle = c
        g.fillRect(0, 0, w, h)
        g.fillStyle = 'rgba(255,255,255,0.35)'
        for (let x = 4; x < w; x += 12) for (let y = 4; y < h; y += 12) g.fillRect(x + ((y / 12) % 2) * 6, y, 4, 4)
        g.strokeStyle = 'rgba(255,255,255,0.6)'
        g.setLineDash([3, 3])
        g.strokeRect(3, 3, w - 6, h - 6)
      })
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
    })
    for (const team of [0, 1]) {
      for (const sl of st.slots[team]) {
        const b = looseBody(ctx, sl, { box: [CH.x, CH.y, CH.z] }, { density: 2.2, friction: 1, restitution: 0.05, damping: 0.6 })
        b.setRotation(quatY(sl.rotY), false)
        const m = new THREE.Mesh(cushionGeo, teamMats[team])
        m.castShadow = true
        m.receiveShadow = true
        ctx.root.add(m)
        ctx.grabbable(b, m)
        st.cushions.push(b)
        st.home.push(team)
      }
    }
    // Loose throwing pillows (and a few more that drop from above later).
    const pillowGeo = new RoundedBoxGeometry(0.9, 0.36, 0.62, 2, 0.15)
    const pillowMat = new THREE.MeshStandardMaterial({ map: quiltTex(['#ffffff', '#fde68a', '#fbcfe8', '#bae6fd'], 2), roughness: 1 })
    for (let i = 0; i < LOOSE + EXTRA; i++) {
      const a = (i / LOOSE) * Math.PI * 2
      const b = looseBody(ctx, { x: Math.sin(a) * 2.6, y: 0.3, z: Math.cos(a) * 3.8 }, { box: [0.45, 0.18, 0.31] }, { density: 0.7, friction: 0.8, restitution: 0.3, damping: 0.4 })
      if (i >= LOOSE) park(b, i)
      const m = new THREE.Mesh(pillowGeo, pillowMat)
      m.castShadow = true
      ctx.root.add(m)
      ctx.grabbable(b, m)
      st.pillows.push(b)
    }
    // Flags (grabbable, but locked until their fort is breached).
    const flags: RigidBody[] = []
    const glow: THREE.Mesh[] = []
    for (const team of [0, 1]) {
      const b = ctx.phys.dynamic({ x: fortX(team), y: 0.55, z: 0 }, { lockRot: true, damping: 0.5 })
      ctx.phys.attach(b, ctx.RAPIER.ColliderDesc.cylinder(0.5, 0.22).setDensity(0.4), { friction: 0.8, groups: PROP_GROUPS })
      const m = flagMesh(ctx.teams[team].color)
      ctx.root.add(m)
      ctx.grabbable(b, m)
      flags.push(b)
      const gm = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4, 16, 1, true), new THREE.MeshBasicMaterial({ color: ctx.teams[team].color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
      gm.visible = false
      ctx.root.add(gm)
      glow.push(gm)
    }
    st.flags = flags as [RigidBody, RigidBody]
    // Duvet lumps over slowed toys (pooled, one per toy).
    const duvetGeo = new THREE.SphereGeometry(0.62, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    const duvetMat = new THREE.MeshStandardMaterial({ map: quiltTex(['#c4b5fd', '#fde68a', '#fbcfe8']), roughness: 1, flatShading: true })
    const duvets = ctx.toys.map(() => {
      const d = new THREE.Mesh(duvetGeo, duvetMat)
      d.visible = false
      ctx.root.add(d)
      return d
    })
    st.prev = new Array(st.cushions.length + st.pillows.length + 2).fill(-1)
    st.vis = { mattress, flagGlow: glow, duvets, bounceT: 0, zones }
    return st
  },

  spawn(ctx, _s, toy, i) {
    const team = toy.team === 1 ? 1 : 0
    let k = 0, n = 0
    ctx.toys.forEach((t, j) => {
      if (t.team !== toy.team) return
      n++
      if (j < i) k++
    })
    const sp = ctx.spawnGrid(n, { x: fortX(team) - inward(team) * 3.6, z: 0, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2, spacing: 1.2, cols: 4 })
    return sp[k]
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    // Who let go of what: thrown things fly harder; cushions dropped in your own fort click into a gap.
    const bodies = [...s.cushions, ...s.pillows, ...s.flags]
    for (const ev of holdChanges(ctx, bodies, s.prev)) {
      const b = bodies[ev.i]
      if (ev.tossed && !s.flags.includes(b)) {
        throwBody(b, ev.by, 12.5, 4.2, ev.by.bot ? (ev.by.data.aim as { x: number; z: number } | undefined) : undefined)
        s.flying.set(b, { by: ev.by, until: t + 0.9 })
        ctx.fx.sfx('throw', ev.by.pos)
      } else if (ev.i < s.cushions.length && inZone(ev.by.team, b.translation())) placeInGap(ctx, s, b, ev.by)
    }
    // Thrown pillows bonk rivals they fly through.
    for (const [b, f] of s.flying) {
      const v = b.linvel()
      if (t > f.until || Math.hypot(v.x, v.y, v.z) < 4.5) {
        s.flying.delete(b)
        continue
      }
      const p = b.translation()
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || toy === f.by || ctx.sameTeam(toy, f.by)) continue
        if (Math.hypot(toy.pos.x - p.x, toy.pos.z - p.z) > 0.9 || Math.abs(toy.pos.y - p.y) > 1) continue
        const l = Math.hypot(v.x, v.z) || 1
        ctx.knock(toy, { x: (v.x / l) * 6, y: 3.5, z: (v.z / l) * 6 }, 0.8, f.by)
        ctx.fx.popup(toy, 'FWUMP!', '#fde68a')
        ctx.fx.puff(p, 'stuff', 12)
        ctx.fx.hitStop(0.05)
        ctx.addSprinkles(f.by, 1)
        s.flying.delete(b)
        break
      }
    }

    // Count the walls and keep score: a point for every cushion missing from the other fort.
    for (const team of [0, 1]) {
      let n = 0
      for (const b of s.cushions) if (inZone(team, b.translation())) n++
      s.standing[team] = n
    }
    ctx.setTeamScore(0, Math.max(0, s.size - s.standing[1]))
    ctx.setTeamScore(1, Math.max(0, s.size - s.standing[0]))

    // Flags: locked while the fort holds, exposed under half, captured when carried into the other fort.
    for (const team of [0, 1]) {
      const fb = s.flags[team]
      const p = fb.translation()
      const holder = holderOf(ctx, fb)
      const home = Math.hypot(p.x - fortX(team), p.z) < 0.6
      const exposed = s.standing[team] < s.size / 2
      if (holder && holder.team !== team && !exposed && home) {
        holder.release(false)
        ctx.fx.popup(holder, 'Knock the walls down first!', '#fca5a5')
      }
      if (holder && holder.team === team && !home) {
        // A defender grabs their own flag: it springs home.
        holder.release(false)
        fb.setTranslation({ x: fortX(team), y: 0.6, z: 0 }, true)
        fb.setLinvel({ x: 0, y: 0, z: 0 }, true)
        ctx.fx.popup(holder, 'Flag saved!', ctx.teams[team].color)
        ctx.fx.sfx('ding', holder.pos)
      }
      if (holder && holder.team !== team && inZone(holder.team, p)) {
        ctx.fx.say(`${ctx.teams[holder.team].name.toUpperCase()} STOLE THE FLAG!`, ctx.teams[holder.team].color, 2.5)
        ctx.addTeamScore(holder.team, 10, 'flag captured', holder)
        ctx.addSprinkles(holder, 2)
        ctx.winTeam(holder.team, `${holder.name} captured the flag`)
        return
      }
      const flagState = home ? (exposed ? 1 : 0) : 2
      if (flagState === 1 && s.flag[team] === 0) {
        ctx.fx.say(`${poss(ctx.teams[team].name).toUpperCase()} FLAG IS EXPOSED!`, ctx.teams[1 - team].color, 2)
        ctx.fx.sfx('zap', { x: fortX(team), y: 1, z: 0 })
      }
      s.flag[team] = flagState
      if (!home && !holder) {
        s.flagIdle[team] += dt
        if (s.flagIdle[team] > 8 || p.y < -2) {
          fb.setTranslation({ x: fortX(team), y: 0.6, z: 0 }, true)
          fb.setLinvel({ x: 0, y: 0, z: 0 }, true)
          ctx.fx.feed(`${poss(ctx.teams[team].name)} flag floated home`)
        }
      } else s.flagIdle[team] = 0
      // Locked flags stay put on their base.
      if (home && !holder && !exposed) {
        fb.setTranslation({ x: fortX(team), y: Math.max(0.55, p.y), z: 0 }, true)
      }
    }

    // Cushions and pillows that fall off the bed come back on it (more ammo in the middle).
    for (const b of [...s.cushions, ...s.pillows]) {
      if (parked(b)) continue
      const p = b.translation()
      if (p.y < -2.2) unpark(b, ctx.rng.range(-3, 3), 2.5, ctx.rng.range(-4, 4))
    }

    // Pillow drops from the ceiling.
    if (s.drops < DROP_AT.length && t >= DROP_AT[s.drops]) {
      s.drops++
      let k = 0
      for (const b of s.pillows) if (parked(b) && k < 2) {
        unpark(b, ctx.rng.range(-2.5, 2.5), 7, ctx.rng.range(-4, 4))
        k++
      }
      ctx.fx.say('PILLOW DROP!', '#fde68a', 1.4)
      ctx.fx.sfx('whoosh')
    }

    // Pulling a cushion out of a rival wall takes a tug: it stays put (and so do you, nearly) for a moment.
    for (const toy of ctx.toys) {
      const held = toy.holdingProp
      const ci = held ? s.cushions.indexOf(held) : -1
      const tugging = ci >= 0 && s.tug[toy.idx] < TUG && inZone(1 - toy.team, held!.translation())
      if (tugging) {
        if (s.tug[toy.idx] === 0) ctx.fx.popup(toy, 'Tugging…', '#fde68a')
        s.tug[toy.idx] += dt
        held!.setLinvel({ x: 0, y: Math.min(0, held!.linvel().y), z: 0 }, true)
        if (s.tug[toy.idx] >= TUG) {
          ctx.fx.puff(held!.translation(), 'stuff', 8)
          ctx.fx.sfx('pop', toy.pos)
        }
      } else if (!held) s.tug[toy.idx] = 0
      // Duvets slow you down; jumping shakes them off.
      const slowed = s.duvet[toy.idx] > t
      toy.runSpeed = slowed ? 2.6 : tugging ? 0.6 : 5.6
      if (slowed && toy.pad.jump) s.duvet[toy.idx] -= 0.5
    }

    // Sudden death: the bed bounces on its own.
    if (t >= SUDDEN && t >= s.bounceAt) {
      if (s.bounceAt === SUDDEN) ctx.fx.say('SUDDEN DEATH: THE BED IS BOUNCING!', '#f472b6', 2.5)
      s.bounceAt = t + 2.4
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || !toy.grounded) continue
        ctx.knock(toy, { x: ctx.rng.range(-1.5, 1.5), y: 9, z: ctx.rng.range(-1.5, 1.5) }, 0)
      }
      for (const b of [...s.cushions, ...s.pillows]) {
        if (parked(b) || holderOf(ctx, b)) continue
        const p = b.translation()
        if (p.y > 1.2) continue
        b.applyImpulse({ x: ctx.rng.range(-0.4, 0.4) * b.mass(), y: 5.5 * b.mass(), z: ctx.rng.range(-0.4, 0.4) * b.mass() }, true)
        b.applyTorqueImpulse({ x: ctx.rng.range(-0.3, 0.3), y: 0, z: ctx.rng.range(-0.3, 0.3) }, true)
      }
      ctx.fx.sfx('boing')
      ctx.fx.shake(0.3)
    }
  },

  onFall(ctx, _s, toy) {
    // Off the bed: back to your own fort.
    ctx.fx.popup(toy, 'Off the bed!', '#fca5a5')
    ctx.respawn(toy, undefined, 1)
  },

  bot(ctx, s, toy) {
    const sk = skill(ctx)
    const team = toy.team === 1 ? 1 : 0
    const them = 1 - team
    const d = toy.data as { role?: string; until?: number; pick?: number; aim?: { x: number; z: number } }
    const pace = sk.pace
    // Everyone drops what they're doing to stop a flag thief.
    const myFlag = s.flags[team]
    const thief = holderOf(ctx, myFlag)
    if (thief && thief.team !== team) {
      chase(ctx, toy, thief, sk)
      return
    }
    // Carrying the enemy flag: run home.
    if (toy.holdingProp === s.flags[them]) {
      carryTo(ctx, toy, fortX(team), 0, pace, 0.2)
      hopObstacles(ctx, toy)
      return
    }
    // Roles: the teammates nearest home defend, the rest attack (re-thought every few seconds).
    if (!d.role || (d.until ?? 0) < ctx.time) {
      const { rank, n } = teamRank(ctx, toy, (t) => Math.abs(t.pos.x - fortX(team)) + t.idx * 0.01)
      const defenders = n >= 2 ? Math.ceil(n / 3) : 0
      d.role = rank < defenders ? 'defend' : 'attack'
      d.until = ctx.time + ctx.rng.range(4, 7)
    }
    // Exposed flag: the nearest attacker goes for it.
    if (s.flag[them] >= 1 && d.role === 'attack' && !holderOf(ctx, s.flags[them])) {
      const fp = s.flags[them].translation()
      fetch(ctx, toy, s.flags[them], pace)
      if (Math.hypot(fp.x - toy.pos.x, fp.z - toy.pos.z) < 3 && toy.grounded && ctx.rng.chance(0.02)) toy.pad.jump = true
      return
    }
    // Holding a cushion or pillow.
    const held = toy.holdingProp
    if (held) {
      const ci = s.cushions.indexOf(held)
      if (ci >= 0 && (s.home[ci] === team || d.role === 'defend' || ctx.rng.chance(0.5) || toy.data.keep)) {
        toy.data.keep = true
        // Plug a gap in our own walls.
        const gap = emptySlot(s, team, toy.pos) ?? { x: fortX(team), z: 0 }
        const left = carryTo(ctx, toy, gap.x, gap.z, pace, 0.4)
        hopObstacles(ctx, toy)
        if (left < 1.3 && inZone(team, held.translation())) {
          toy.pad.grab = false
          toy.data.keep = false
        }
        return
      }
      // Throw it at their front wall from a few metres out.
      const wx = fortX(them) + inward(them) * 2.05
      const wz = 0
      const dist = carryTo(ctx, toy, wx + inward(them) * 3.6, wz, pace, 0.5)
      if (dist < 1.2) {
        d.aim = { x: wx, z: wz }
        toy.data.aim = d.aim
        toy.yaw = Math.atan2(wx - toy.pos.x, wz - toy.pos.z)
        toy.pad.grab = false
        toy.data.keep = false
      }
      return
    }
    if (d.role === 'defend') {
      // Intruders in our fort get tackled; fallen cushions near home get carried back in.
      const intruder = ctx.rivalsOf(toy).find((r) => Math.abs(r.pos.x - fortX(team)) < ZONE + 1.5 && Math.abs(r.pos.z) < ZONE + 1.5)
      if (intruder) {
        chase(ctx, toy, intruder, sk)
        return
      }
      let best: RigidBody | null = null, bd = 9
      for (const b of s.cushions) {
        const p = b.translation()
        if (inZone(team, p) || holderOf(ctx, b) || p.y < -1) continue
        const dd = Math.hypot(p.x - fortX(team), p.z)
        if (dd < bd) {
          bd = dd
          best = b
        }
      }
      if (best) {
        fetch(ctx, toy, best, pace)
        return
      }
      // Stand guard in front of the wall.
      steerTo(toy, fortX(team) + inward(team) * 3.3, Math.sin(ctx.time * 0.5 + toy.idx) * 2, { stop: 0.5, pace: pace * 0.7 })
      const r = nearestRival(ctx, toy, 2.2)
      if (r) bully(toy, r, 1.4)
      return
    }
    // Attack: pull a cushion out of their walls (or grab a loose pillow on the way to throw).
    if (d.pick === undefined || ctx.rng.chance(0.004)) {
      const options: number[] = []
      s.cushions.forEach((b, i) => {
        if (inZone(them, b.translation()) && !holderOf(ctx, b)) options.push(i)
      })
      const near = s.pillows.map((b, i) => [b, i] as const).filter(([b]) => !parked(b) && !holderOf(ctx, b) && Math.hypot(b.translation().x - toy.pos.x, b.translation().z - toy.pos.z) < 5)
      if (near.length && ctx.rng.chance(0.4)) d.pick = 1000 + near[0][1]
      else d.pick = options.length ? options[Math.floor(ctx.rng.next() * options.length)] : undefined
    }
    const target = d.pick === undefined ? null : d.pick >= 1000 ? s.pillows[d.pick - 1000] : s.cushions[d.pick]
    if (!target || holderOf(ctx, target) || (d.pick! < 1000 && !inZone(them, target.translation()))) {
      d.pick = undefined
      // Nothing to grab: charge their wall and dive into it.
      const wx = fortX(them) + inward(them) * 2.6
      const dd = steerTo(toy, wx, Math.sin(toy.idx) * 1.2, { stop: 0.3, pace })
      avoidWalls(ctx, toy)
      if (dd < 2.2 && toy.diveCd <= 0 && ctx.rng.chance(0.05)) toy.pad.dive = true
      return
    }
    fetch(ctx, toy, target, pace)
    // Rivals in the way get shoved.
    const r = nearestRival(ctx, toy, 1.3)
    if (r && ctx.rng.chance(sk.aggression * 0.05)) bully(toy, r, 1.3)
  },

  rank(ctx, s) {
    const lead = s.standing[0] === s.standing[1] ? 0 : s.standing[0] > s.standing[1] ? 0 : 1
    return ctx.active().sort((a, b) => (a.team === lead ? 0 : 1) - (b.team === lead ? 0 : 1))
  },

  pack(_c, s) {
    return [s.standing[0], s.standing[1], s.flag[0], s.flag[1], r2(s.bounceAt), s.duvet.map(r2)]
  },

  unpack(_c, s, d) {
    const a = d as [number, number, number, number, number, number[]]
    s.standing[0] = a[0]
    s.standing[1] = a[1]
    s.flag[0] = a[2]
    s.flag[1] = a[3]
    s.bounceAt = a[4]
    s.duvet = a[5]
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    // Exposed flags glow.
    for (const team of [0, 1]) {
      const g = v.flagGlow[team]
      g.visible = s.flag[team] >= 1
      if (g.visible) {
        const p = s.flags[team].translation()
        g.position.set(p.x, p.y + 1.4, p.z)
        ;(g.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.15 * Math.sin(t * 8)
      }
      ;(v.zones[team].material as THREE.MeshBasicMaterial).opacity = s.flag[team] >= 1 ? 0.22 + 0.15 * Math.sin(t * 6) : 0.2
    }
    // The bed squashes on each sudden-death bounce.
    if (t >= SUDDEN && ctx.phase === 'play') {
      const since = 2.4 - (s.bounceAt - t)
      v.bounceT = since < 0.35 ? Math.sin((since / 0.35) * Math.PI) : 0
      if (since >= 0 && since < dt * 1.5) ctx.fxLocal.puff({ x: 0, y: 0.3, z: 0 }, 'dust', 8)
    } else v.bounceT = 0
    v.mattress.scale.y = 1 + v.bounceT * 0.35
    v.mattress.position.y = -0.5 + v.bounceT * 0.17
    // Duvet lumps.
    for (const toy of ctx.toys) {
      const m = v.duvets[toy.idx]
      if (!m) continue
      m.visible = (s.duvet[toy.idx] ?? 0) > t && toy.status === 'play'
      if (m.visible) {
        m.position.set(toy.pos.x, toy.pos.y + 0.05, toy.pos.z)
        m.rotation.y = toy.yaw
        m.scale.set(1 + Math.sin(t * 9) * 0.05, 1.15, 1)
      }
    }
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const chips = [`Walls: ${ctx.teams[0].name} ${s.standing[0]}/${s.size} · ${ctx.teams[1].name} ${s.standing[1]}/${s.size}`]
    if (t < SUDDEN && ctx.phase === 'play') chips.push(`Sudden death in ${Math.ceil(SUDDEN - t)} s`)
    let status: { text: string; color: string; pulse?: boolean } | undefined
    let prompt: string | undefined
    if (t >= SUDDEN) status = { text: 'THE BED IS BOUNCING', color: '#f472b6', pulse: true }
    if (me && me.status === 'play') {
      const team = me.team === 1 ? 1 : 0
      const them = 1 - team
      if (me.holdingProp === s.flags[them]) prompt = 'You have their flag! Get it into your fort!'
      else if (s.flag[them] === 1) {
        prompt = 'Their flag is exposed: grab it (E) and carry it home!'
        status = { text: 'THEIR FLAG IS EXPOSED', color: ctx.teams[team].color, pulse: true }
      } else if (s.flag[team] >= 1) status = { text: 'DEFEND YOUR FLAG!', color: '#ef4444', pulse: true }
      else if (me.holdingProp) prompt = 'Let go of E to throw · drop cushions in your fort to rebuild'
      else if (s.duvet[me.idx] > t) prompt = 'Under the duvet! Jump to shake it off.'
      else prompt = 'Hold E on a cushion to pull it out of their wall · springs launch you over'
    }
    return { chips, status, prompt }
  },
})

/** The nearest empty wall slot in a fort (or null when the walls are whole). */
function emptySlot(s: FortState, team: number, near: { x: number; z: number }) {
  let best: Slot | null = null, bd = Infinity
  for (const sl of s.slots[team]) {
    // Bottom row first: only offer an upper slot when the one below it is filled.
    if (s.cushions.some((b) => {
      const p = b.translation()
      return Math.hypot(p.x - sl.x, p.z - sl.z) < 0.45 && Math.abs(p.y - sl.y) < 0.3
    })) continue
    if (sl.y > CH.y + 0.1) {
      const below = s.cushions.some((b) => {
        const p = b.translation()
        return Math.hypot(p.x - sl.x, p.z - sl.z) < 0.5 && Math.abs(p.y - (sl.y - CH.y * 2)) < 0.3
      })
      if (!below) continue
    }
    const dd = Math.hypot(sl.x - near.x, sl.z - near.z) + sl.y * 2
    if (dd < bd) {
      bd = dd
      best = sl
    }
  }
  return best
}

/** A cushion dropped in its owner's fort clicks into the nearest gap. */
function placeInGap(ctx: LevelCtx, s: FortState, b: RigidBody, by: Toy) {
  const p = b.translation()
  const sl = emptySlot(s, by.team, p)
  if (!sl || Math.hypot(sl.x - p.x, sl.z - p.z) > 3) return
  b.setTranslation({ x: sl.x, y: sl.y + 0.02, z: sl.z }, true)
  b.setRotation(quatY(sl.rotY), true)
  b.setLinvel({ x: 0, y: 0, z: 0 }, true)
  b.setAngvel({ x: 0, y: 0, z: 0 }, true)
  ctx.fx.puff(sl, 'dust', 8)
  ctx.fx.sfx('thud', sl)
  ctx.fx.popup(by, 'Wall patched!', ctx.teams[by.team].color)
  if (ctx.rng.chance(0.5)) ctx.addSprinkles(by, 1)
}

/** Bot: run at a rival and tackle them. */
function chase(ctx: LevelCtx, toy: Toy, target: Toy, sk: ReturnType<typeof skill>) {
  const dd = steerTo(toy, target.pos.x + target.vel.x * 0.3, target.pos.z + target.vel.z * 0.3, { stop: 0.2, pace: sk.pace })
  avoidWalls(ctx, toy)
  if (dd < 2.6 && toy.diveCd <= 0 && ctx.rng.chance(0.08 + sk.aggression * 0.1)) toy.pad.dive = true
  else if (dd < 1.4) bully(toy, target, 1.4)
}
