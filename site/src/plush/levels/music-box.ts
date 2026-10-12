// Music Box Freeze (survival). A giant wind-up music box plays an original waltz while the ballerina on top
// spins. Move only while it plays: when the tune winds down she turns to look, and any toy still moving after a
// short grace is out. Reach the box before time runs out. The tune speeds up and the pauses get shorter.
// Dirty tricks: tickle a frozen toy so it twitches (she may catch you too), and whoever grabs the wind-up key
// can stop the music early, once.
import * as THREE from 'three'
import { prop, propSize } from '../engine/assets'
import { avoidWalls, bully, hopObstacles, nearestRival, skill, steerTo } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'

const START_Z = -34
const FINISH_Z = 26
const BOX_Z = 32
const HALF_W = 8.5
const KEY = { x: 6.6, z: -1 }
const GRACE = 0.35
const MOVE_LIMIT = 1.0

/** 0 music, 1 winding down (the tell), 2 the ballerina is looking. */
type Ph = 0 | 1 | 2

interface MBState {
  ph: Ph
  /** Round time the phase began, and how long it lasts. */
  pt: number
  dur: number
  tempo: number
  verse: number
  /** Toy holding the wind-up key (-1 nobody), and whether it has been used. */
  key: number
  keyUsed: number
  /** Toy the ballerina ignores this look (whoever stopped the music). */
  immune: number
  /** Sprinkle pickups still on the floor (bitmask). */
  pick: number
  // Host only.
  pickBack: number[]
  pickups: { x: number; z: number }[]
  // Visuals (every screen).
  vis: {
    ballerina: THREE.Object3D | null
    cone: THREE.Mesh | null
    keyMesh: THREE.Object3D | null
    stars: THREE.Object3D[]
    spin: number
    lastPh: number
    zaps: { line: THREE.Line; t: number }[]
  }
}

function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra })
}

function keyMesh() {
  const g = new THREE.Group()
  const gold = mat('#fbbf24', { metalness: 0.85, roughness: 0.3, emissive: '#7c4a03', emissiveIntensity: 0.4 })
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.13, 8, 18), gold)
  bow.position.y = 0.55
  const bow2 = bow.clone()
  bow2.rotation.y = Math.PI / 2
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), gold)
  shaft.position.y = -0.3
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.12), gold)
  tooth.position.set(0.17, -0.7, 0)
  g.add(bow, bow2, shaft, tooth)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

function starMesh() {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const r = i % 2 ? 0.16 : 0.38
    if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r)
    else s.lineTo(Math.sin(a) * r, Math.cos(a) * r)
  }
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false })
  geo.center()
  return new THREE.Mesh(geo, mat('#f9a8d4', { emissive: '#db2777', emissiveIntensity: 0.5, roughness: 0.4 }))
}

function phaseLengths(verse: number, rng: LevelCtx['rng']) {
  const k = Math.min(1, verse / 7)
  return {
    play: rng.range(THREE.MathUtils.lerp(3.2, 1.8, k), THREE.MathUtils.lerp(6.5, 4, k)),
    wind: THREE.MathUtils.lerp(0.75, 0.45, k),
    look: rng.range(THREE.MathUtils.lerp(2.4, 1.6, k), THREE.MathUtils.lerp(3.8, 3, k)),
  }
}

function setPh(ctx: LevelCtx, st: MBState, ph: Ph, dur: number) {
  st.ph = ph
  st.pt = ctx.time
  st.dur = dur
}

/**
 * Is this toy moving enough to be seen? Uses a smoothed speed (updated every tick in tick()), so a single
 * physics jostle against a wall or a neighbour doesn't count, but a real step or a twitch does.
 */
function moving(t: Toy) {
  return ((t.data.seen as number) ?? 0) > MOVE_LIMIT || (!t.grounded && Math.abs(t.vel.y) > 2.6)
}

export default defineLevel<MBState>({
  id: 'music-box',
  name: 'Music Box Freeze',
  type: 'survival',
  blurb: 'Move while the music plays. Freeze when it stops, or the ballerina spots you.',
  howTo: [
    'Run for the music box while the tune plays',
    'When it winds down, FREEZE: the ballerina turns and catches anyone moving',
    'Tickle a frozen rival so they twitch (she may catch you too)',
    'Grab the wind-up key to stop the music early, once',
  ],
  accent: '#f472b6',
  players: [2, 16],
  duration: 100,
  canBeFinal: true,
  camera: { kind: 'chase', dist: 7 },
  // Plush toddle: slower than usual so the walk to the box spans several verses.
  runSpeed: 3.6,
  sprinkles: { start: 1 },
  sky: { color: '#2b1a10', fogNear: 50, fogFar: 140 },

  tricks: [
    {
      id: 'tickle',
      name: 'Tickle',
      icon: 'tickle',
      cost: 1,
      cooldown: 4,
      busy: 0.4,
      target: 'rival',
      range: 2.2,
      desc: 'Tickle a frozen toy next to you so it twitches while the ballerina is looking.',
      counter: 'Keep your distance when the music winds down. There is a 40% chance she spots the tickler too.',
      can: (_c, s) => (s.ph === 2 ? true : 'Only while she looks'),
      apply: (ctx, s, user, target) => {
        if (!target) return
        const a = ctx.rng.range(0, Math.PI * 2)
        ctx.knock(target, { x: Math.cos(a) * 2.4, y: 1.2, z: Math.sin(a) * 2.4 }, 0, user)
        ctx.fx.puff(target.pos, 'spark', 10)
        ctx.fx.popup(target, 'Hee hee!', '#f9a8d4')
        ctx.fx.sfx('squeak', target.pos)
        if (ctx.rng.chance(0.4) && s.immune !== user.idx) {
          const b = ctx.rng.range(0, Math.PI * 2)
          ctx.knock(user, { x: Math.cos(b) * 1.8, y: 0.8, z: Math.sin(b) * 1.8 }, 0)
          ctx.fx.popup(user, 'Oops!', '#fca5a5')
        }
      },
      botUse: (ctx, s, user) => {
        if (s.ph !== 2 || ctx.time - s.pt < GRACE) return false
        const r = nearestRival(ctx, user, 2.1)
        return r && r.idx !== s.immune ? r : false
      },
    },
    {
      id: 'stop',
      name: 'Stop the Music',
      icon: 'key',
      cost: 0,
      cooldown: 1,
      once: true,
      target: 'none',
      desc: 'Whoever holds the wind-up key can stop the tune early, once. She looks straight away and ignores you.',
      counter: 'Watch who has the key and slow down near them.',
      hidden: (_c, s, user) => s.key !== user.idx || s.keyUsed === 1,
      can: (_c, s) => (s.ph === 0 ? true : 'Only while the music plays'),
      apply: (ctx, s, user) => {
        s.keyUsed = 1
        s.immune = user.idx
        setPh(ctx, s, 1, 0.22)
        ctx.fx.say(`${user.name} STOPPED THE MUSIC!`, '#fbbf24', 1.6)
        ctx.fx.sfx('wind')
      },
      botUse: (ctx, s, user) => {
        if (s.ph !== 0 || ctx.time - s.pt < 1) return false
        // Use it when plenty of rivals are on the move.
        const movers = ctx.toys.filter((t) => t !== user && t.status === 'play' && Math.hypot(t.vel.x, t.vel.z) > 3).length
        return movers >= 2 ? null : false
      },
    },
    bubbleWrap<MBState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 22, hd: 42, ridge: 22, knee: 5, lights: ctx.quality === 'low' ? 30 : 60, quality: ctx.quality })
    // Floor and walls of the course.
    ctx.phys.box({ x: 0, y: -0.5, z: 0 }, { x: 22, y: 0.5, z: 42 }, { friction: 0.8 })
    ctx.phys.box({ x: 0, y: 4, z: START_Z - 3 }, { x: HALF_W + 1, y: 4, z: 0.5 })
    ctx.phys.box({ x: 0, y: 4, z: BOX_Z + 4 }, { x: HALF_W + 1, y: 4, z: 0.5 })
    // Book walls down both sides.
    const bookColors = ['#7f1d1d', '#1e3a8a', '#065f46', '#78350f', '#581c87', '#9a3412', '#334155']
    const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat('#ffffff'), 170)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    const col = new THREE.Color()
    let n = 0
    for (const side of [-1, 1]) {
      let z = START_Z - 2.5
      while (z < BOX_Z + 3.5 && n < 170) {
        const w = ctx.rng.range(0.7, 1.4), h = ctx.rng.range(3, 5.5)
        p.set(side * (HALF_W + 0.9), h / 2, z + w / 2)
        s.set(1.6, h, w * 0.95)
        q.identity()
        books.setMatrixAt(n, m.compose(p, q, s))
        books.setColorAt(n, col.set(ctx.rng.pick(bookColors)))
        n++
        z += w
      }
      ctx.phys.box({ x: side * (HALF_W + 0.9), y: 3, z: (START_Z + BOX_Z) / 2 }, { x: 0.8, y: 3, z: (BOX_Z - START_Z) / 2 + 3 })
    }
    books.count = n
    books.castShadow = true
    books.receiveShadow = true
    ctx.root.add(books)

    // Start and finish lines.
    const line = (z: number, color: string) => {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color }))
      l.position.set(0, 0.02, z)
      ctx.root.add(l)
    }
    line(START_Z + 1.5, '#fef3c7')
    line(FINISH_Z, '#f472b6')
    const finish = textSprite('Reach the music box!', { bg: '#be185d', size: 0.9 })
    finish.position.set(0, 5, FINISH_Z)
    ctx.root.add(finish)

    // Alphabet blocks to dodge round (and hide behind from shoves).
    const placed: { x: number; z: number }[] = []
    const blockCols = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316']
    for (let i = 0; i < 40 && placed.length < 14; i++) {
      const x = ctx.rng.range(-HALF_W + 1.5, HALF_W - 1.5), z = ctx.rng.range(START_Z + 6, FINISH_Z - 5)
      if (placed.some((o) => Math.hypot(o.x - x, o.z - z) < 3.2) || Math.hypot(x - KEY.x, z - KEY.z) < 3) continue
      placed.push({ x, z })
      const sz = ctx.rng.range(1.1, 1.7)
      const b = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), mat(ctx.rng.pick(blockCols)))
      b.position.set(x, sz / 2, z)
      b.rotation.y = ctx.rng.range(-0.4, 0.4)
      b.castShadow = b.receiveShadow = true
      ctx.root.add(b)
      ctx.phys.box({ x, y: sz / 2, z }, { x: sz / 2, y: sz / 2, z: sz / 2 }, { rotY: b.rotation.y })
      const letter = textSprite(String.fromCharCode(65 + ctx.rng.int(0, 26)), { color: '#ffffff', size: sz * 0.5 })
      letter.position.set(x, sz + 0.3, z)
      ctx.root.add(letter)
    }

    // The music box and the ballerina.
    const box = prop(ctx.assets, 'musicbox', 7, 'width')
    box.position.set(0, 0, BOX_Z + 1.5)
    box.rotation.y = Math.PI
    ctx.root.add(box)
    const bs = propSize(box)
    ctx.phys.box({ x: 0, y: bs.y / 2, z: BOX_Z + 1.5 }, { x: bs.x / 2, y: bs.y / 2, z: bs.z / 2 })
    // Key pedestal.
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 12), mat('#78350f'))
    ped.position.set(KEY.x, 0.3, KEY.z)
    ped.receiveShadow = true
    ctx.root.add(ped)
    ctx.phys.cylinder({ x: KEY.x, y: 0.3, z: KEY.z }, 0.3, 1)
  },

  init(ctx) {
    const st: MBState = {
      ph: 0, pt: 0, dur: 99, tempo: 132, verse: 0, key: -1, keyUsed: 0, immune: -1, pick: 0, pickBack: [], pickups: [],
      vis: { ballerina: null, cone: null, keyMesh: null, stars: [], spin: 0, lastPh: -1, zaps: [] },
    }
    // Ballerina on top of the box (separately, so she can turn round).
    const bs = (() => {
      const box = ctx.root.getObjectByName('prop:musicbox')
      return box ? propSize(box) : new THREE.Vector3(7, 5, 5)
    })()
    const ball = prop(ctx.assets, 'ballerina', 3.6)
    ball.position.set(0, bs.y * 0.62, BOX_Z + 1.5)
    ctx.root.add(ball)
    st.vis.ballerina = ball
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(9, 26, 32, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -13),
      new THREE.MeshBasicMaterial({ color: '#fb7185', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
    )
    cone.position.set(0, bs.y * 0.62 + 2.8, BOX_Z + 1)
    cone.rotation.x = 0.16
    ctx.root.add(cone)
    st.vis.cone = cone
    const key = keyMesh()
    key.position.set(KEY.x, 1.6, KEY.z)
    ctx.root.add(key)
    st.vis.keyMesh = key
    // Sprinkle pickups.
    for (let i = 0; i < 10; i++) {
      const x = ctx.rng.range(-HALF_W + 1, HALF_W - 1), z = ctx.rng.range(START_Z + 5, FINISH_Z - 3)
      st.pickups.push({ x, z })
      st.pickBack.push(0)
      st.pick |= 1 << i
      const s = starMesh()
      s.position.set(x, 0.7, z)
      ctx.root.add(s)
      st.vis.stars.push(s)
    }
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnGrid(n, { x: 0, z: START_Z + 0.5, yaw: 0, spacing: 1.7, cols: 8 })[i]
  },

  start(ctx, st) {
    setPh(ctx, st, 0, phaseLengths(0, ctx.rng).play)
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    const el = t - st.pt
    for (const toy of ctx.toys) {
      const sp = Math.hypot(toy.vel.x, toy.vel.z)
      const prev = (toy.data.seen as number) ?? 0
      toy.data.seen = prev + (sp - prev) * Math.min(1, dt / 0.08)
    }
    // The cycle: music → wind down (the tell) → she looks → music, faster.
    if (el >= st.dur) {
      const len = phaseLengths(st.verse, ctx.rng)
      if (st.ph === 0) setPh(ctx, st, 1, len.wind)
      else if (st.ph === 1) {
        setPh(ctx, st, 2, len.look)
        ctx.fx.sfx('ding')
      } else {
        st.verse++
        st.tempo = Math.min(220, 132 + st.verse * 12)
        st.immune = -1
        setPh(ctx, st, 0, phaseLengths(st.verse, ctx.rng).play)
      }
    }
    // Caught moving.
    if (st.ph === 2 && t - st.pt > GRACE) {
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || toy.idx === st.immune || !moving(toy)) continue
        ctx.emit({ z: toy.idx })
        ctx.fx.sfx('zap', toy.pos)
        ctx.fx.shake(0.4, toy)
        ctx.knock(toy, { x: 0, y: 4, z: -3 }, 1.2)
        ctx.fail(toy, 'caught moving')
      }
    }
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      // At the box.
      if (toy.pos.z > FINISH_Z) {
        ctx.qualify(toy, `#${ctx.qualifiedCount() + 1}`)
        toy.frozen = true
        continue
      }
      // The key.
      if (st.key < 0 && Math.hypot(toy.pos.x - KEY.x, toy.pos.z - KEY.z) < 2.1) {
        st.key = toy.idx
        ctx.fx.sfx('ding', toy.pos)
        ctx.fx.say(`${toy.name} has the wind-up key!`, '#fbbf24', 1.6)
        ctx.fx.popup(toy, 'Wind-up key!', '#fbbf24')
      }
      // Sprinkles.
      st.pickups.forEach((p, i) => {
        if (!(st.pick & (1 << i)) || Math.hypot(toy.pos.x - p.x, toy.pos.z - p.z) > 1) return
        st.pick &= ~(1 << i)
        st.pickBack[i] = t + 14
        ctx.addSprinkles(toy, 1)
        ctx.fx.sfx('coin', toy.pos)
      })
    }
    st.pickups.forEach((_p, i) => {
      if (!(st.pick & (1 << i)) && t > st.pickBack[i]) st.pick |= 1 << i
    })
    // The key holder was knocked out: the key goes back on its stand.
    if (st.key >= 0 && ctx.toys[st.key]?.status === 'failed' && !st.keyUsed) st.key = -1
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { lane?: number; stopAt?: number; seenPh?: number; ptSeen?: number; late?: number }
    if (d.lane === undefined) d.lane = ctx.rng.range(-HALF_W + 1.5, HALF_W - 1.5)
    // Notice the tell after a reaction delay (sometimes late).
    if (st.ph === 1 && d.ptSeen !== st.pt) {
      d.ptSeen = st.pt
      d.late = ctx.rng.chance(sk.blunder * 4) ? ctx.rng.range(0.3, 0.7) : 0
      d.stopAt = st.pt + sk.reaction * ctx.rng.range(0.6, 1.4) + (d.late ?? 0)
    }
    // Frozen: leave the stick at rest (the engine zeroes it every tick).
    if (st.ph === 1 && ctx.time >= (d.stopAt ?? 0)) return
    if (st.ph === 2 && toy.idx !== st.immune && ctx.time >= (d.stopAt ?? 0)) return
    // Go for the key, a sprinkle, or the box.
    let gx = d.lane, gz = FINISH_Z + 3
    if (st.key < 0 && Math.abs(toy.pos.z - KEY.z) < 9 && sk.aggression > 0.4 && toy.idx % 3 === 0) {
      gx = KEY.x - 1.6
      gz = KEY.z
    } else {
      st.pickups.forEach((p, i) => {
        if (st.pick & (1 << i) && Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z) < 3 && p.z > toy.pos.z - 0.5) {
          gx = p.x
          gz = p.z
        }
      })
    }
    steerTo(toy, gx, gz, { pace: sk.pace, stop: 0 })
    avoidWalls(ctx, toy)
    hopObstacles(ctx, toy)
    // A cheeky shove if someone is right in front while the music plays.
    const r = nearestRival(ctx, toy, 1.4)
    if (r && st.ph === 0 && ctx.rng.chance(sk.aggression * 1.5 * dt)) bully(toy, r)
  },

  rank(ctx) {
    return ctx.active().sort((a, b) => b.pos.z - a.pos.z)
  },

  onTimeUp(ctx) {
    if (ctx.mode === 'quick') return
    const ranked = ctx.active().sort((a, b) => b.pos.z - a.pos.z)
    if (ctx.qualifiedCount() === 0 && ranked[0]) ctx.qualify(ranked[0], 'closest')
    for (const t of ctx.active()) ctx.fail(t, 'out of time')
  },

  retry(ctx, _st, toy) {
    // Quick Play: back ten metres instead of out.
    ctx.respawn(toy, { x: toy.pos.x, y: 0, z: Math.max(START_Z + 0.5, toy.pos.z - 10), yaw: 0 }, 1.2)
  },

  canThrow(_c, st) {
    return st.ph === 0
  },

  pack(_c, st) {
    return [st.ph, Math.round(st.pt * 100) / 100, Math.round(st.dur * 100) / 100, st.tempo, st.verse, st.key, st.keyUsed, st.immune, st.pick]
  },

  unpack(_c, st, d) {
    const a = d as number[]
    st.ph = a[0] as Ph
    st.pt = a[1]
    st.dur = a[2]
    st.tempo = a[3]
    st.verse = a[4]
    st.key = a[5]
    st.keyUsed = a[6]
    st.immune = a[7]
    st.pick = a[8]
  },

  onEvent(ctx, st, data) {
    const e = data as { z?: number }
    if (e.z === undefined) return
    // A zap from the ballerina to whoever she caught.
    const toy = ctx.toys[e.z]
    const b = st.vis.ballerina
    if (!toy || !b) return
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(b.position.x, b.position.y + 2.6, b.position.z), toy.pos.clone()])
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#fb7185', transparent: true, toneMapped: false }))
    ctx.root.add(line)
    st.vis.zaps.push({ line, t: 0.5 })
    ctx.fxLocal.puff(toy.pos, 'spark', 14)
  },

  visual(ctx, st, dt) {
    const v = st.vis
    // Music on every screen, driven by the synced phase.
    if (v.lastPh !== st.ph && ctx.phase === 'play') {
      if (st.ph === 0) ctx.music.start(st.tempo)
      else if (st.ph === 1) ctx.music.windDown(Math.max(0.2, st.dur))
      else ctx.music.stop()
      v.lastPh = st.ph
    }
    if (ctx.phase !== 'play' && v.lastPh !== -1) {
      ctx.music.stop()
      v.lastPh = -1
    }
    const b = v.ballerina
    if (b) {
      if (st.ph === 0) {
        v.spin += dt * (st.tempo / 22)
        b.rotation.y = v.spin
      } else if (st.ph === 1) {
        v.spin += dt * 2.5
        b.rotation.y = v.spin
      } else {
        // Turn to face the toys (towards -z).
        const want = Math.PI
        let d = want - b.rotation.y
        d = Math.atan2(Math.sin(d), Math.cos(d))
        b.rotation.y += d * Math.min(1, dt * 12)
        v.spin = b.rotation.y
      }
    }
    if (v.cone) {
      const want = st.ph === 2 && ctx.phase === 'play' ? 0.13 + Math.sin(ctx.time * 12) * 0.03 : 0
      const m = v.cone.material as THREE.MeshBasicMaterial
      m.opacity += (want - m.opacity) * Math.min(1, dt * 10)
      v.cone.visible = m.opacity > 0.005
    }
    if (v.keyMesh) {
      const holder = st.key >= 0 ? ctx.toys[st.key] : null
      v.keyMesh.visible = !st.keyUsed
      if (holder) v.keyMesh.position.set(holder.pos.x, holder.pos.y + 1.4, holder.pos.z)
      else v.keyMesh.position.set(KEY.x, 1.6 + Math.sin(ctx.time * 2) * 0.15, KEY.z)
      v.keyMesh.rotation.y += dt * (st.ph === 0 && holder ? 6 : 1.5)
      v.keyMesh.scale.setScalar(holder ? 0.6 : 1)
    }
    v.stars.forEach((s, i) => {
      s.visible = (st.pick & (1 << i)) > 0
      s.rotation.y += dt * 2
      s.position.y = 0.7 + Math.sin(ctx.time * 3 + i) * 0.12
    })
    for (let i = v.zaps.length - 1; i >= 0; i--) {
      const z = v.zaps[i]
      z.t -= dt
      ;(z.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, z.t * 2)
      if (z.t <= 0) {
        z.line.removeFromParent()
        z.line.geometry.dispose()
        ;(z.line.material as THREE.Material).dispose()
        v.zaps.splice(i, 1)
      }
    }
  },

  hud(ctx, st, me) {
    const status =
      ctx.phase !== 'play'
        ? null
        : st.ph === 0
          ? { text: 'MOVE!', color: '#4ade80' }
          : st.ph === 1
            ? { text: 'WINDING DOWN…', color: '#fbbf24', pulse: true }
            : { text: 'FREEZE!', color: '#f87171', pulse: true }
    const chips = [`Verse ${st.verse + 1}`]
    if (st.key >= 0 && !st.keyUsed) chips.push(`Key: ${ctx.toys[st.key]?.name ?? '?'}`)
    let prompt: string | undefined
    if (me && me.status === 'play') {
      if (st.key === me.idx && !st.keyUsed) prompt = 'You hold the wind-up key: use Stop the Music to make her look early (she ignores you).'
      else if (st.ph === 2) prompt = 'Stay still! Tickle a frozen rival next to you if you dare.'
      else if (st.key < 0) prompt = 'The golden wind-up key is on the right. Grab it to stop the music once.'
    } else if (me?.status === 'qualified') prompt = 'You made it! Cheer the others on.'
    const prog = me ? THREE.MathUtils.clamp((me.pos.z - START_Z) / (FINISH_Z - START_Z), 0, 1) : 0
    return { status: status ?? undefined, chips, prompt, bars: me ? [{ label: 'To the box', value: prog, color: '#f472b6' }] : [] }
  },

  dispose(ctx) {
    ctx.music.stop()
  },
})
