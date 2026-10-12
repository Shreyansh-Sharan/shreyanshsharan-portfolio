// The Loft: a cosy attic at toy scale where everyone waits between Shows. Floorboards, a slanted roof with
// rafters, a round window pouring warm god-rays and dust motes, string lights, and props: the toy chest in the
// middle (jump in to start a Show), a rocking horse, boxes, an armchair and the Sewing Table (dress-up spot,
// with a tape-measure podium and a mirror). Four themed corners each hide a game, playable online with a
// queue, and a notice board on the back wall keeps your stats and the Loft records:
//   Disco Closet       Freeze Dance       (levels/loft/freeze.ts)
//   Houseplant Jungle  Vine Swing         (levels/loft/vine.ts)
//   Bathtub Beach      Bath Bomb Bowling  (levels/loft/bowling.ts)
//   Cardboard Arcade   Button Claw        (levels/loft/claw.ts)
// The corners' decor is in levels/loft/zones.ts, the light and the board in atmos.ts, sound in ambience.ts.
import * as THREE from 'three'
import { prop, propSize } from '../engine/assets'
import { avoidWalls, hopObstacles, steerTo } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { PROP_GROUPS } from '../engine/physics'
import { defineLevel, type LevelCtx, type LevelHud, type Toy } from '../engine/types'
import { LoftAmbience } from './loft/ambience'
import { buildAtmos, type Atmos } from './loft/atmos'
import { bathBowling, type BowlState } from './loft/bowling'
import { buttonClaw, type ClawState } from './loft/claw'
import { freezeDance, onFloor, type FreezeState } from './loft/freeze'
import { SEW } from './loft/layout'
import { recordScore, type LoftGame } from './loft/records'
import type { LoftActivity } from './loft/station'
import { loftUi } from './loft/ui'
import { vineSwing, type VineState } from './loft/vine'
import { buildArcade, buildBeach, buildDisco, buildJungle, type Decor } from './loft/zones'

/** Corners and spots toys wander between. Exported so other agents can hang hidden games off them. */
export const LOFT_ZONES = {
  disco: { name: 'Disco Closet', x: -12, z: -10.8, r: 5.2 },
  jungle: { name: 'Houseplant Jungle', x: 12, z: -11.6, r: 5.6 },
  beach: { name: 'Bathtub Beach', x: 12.2, z: 12.6, r: 5.6 },
  arcade: { name: 'Cardboard Arcade', x: -12.5, z: 12, r: 5.2 },
  sewing: { name: 'Sewing Table', x: SEW.podium.x, z: SEW.podium.z, r: 1.1 },
  chest: { name: 'Toy Chest', x: 0, z: 0, r: 4.5 },
} as const
export type LoftZone = keyof typeof LOFT_ZONES

const HW = 18
const HD = 18
const RIDGE = 20
const KNEE = 4
// The toy chest: footprint and wall height of its box (the lid stands open behind it).
const CHEST = { x: 0, z: 0, hw: 1.7, hd: 1.25, wall: 1.45 }

interface LoftState {
  horse: THREE.Object3D | null
  topSpin: THREE.Object3D | null
  /** Toy that already triggered the chest (debounce). */
  fired: Set<Toy>
  t: number
  decor: Decor[]
  atmos: Atmos | null
  amb: LoftAmbience | null
  fd: FreezeState
  vs: VineState
  bw: BowlState
  cl: ClawState
  /** Podium turn (visual). */
  spin: number
}

/** The hidden games, in the order their state is packed. */
const ACTS: [LoftActivity<never>, keyof Pick<LoftState, 'fd' | 'vs' | 'bw' | 'cl'>][] = [
  [freezeDance as unknown as LoftActivity<never>, 'fd'],
  [vineSwing as unknown as LoftActivity<never>, 'vs'],
  [bathBowling as unknown as LoftActivity<never>, 'bw'],
  [buttonClaw as unknown as LoftActivity<never>, 'cl'],
]
const stateOf = (s: LoftState, k: (typeof ACTS)[number][1]) => s[k] as never

function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...extra })
}

function placeProp(ctx: LevelCtx, obj: THREE.Object3D, x: number, z: number, rotY = 0) {
  obj.position.set(x, 0, z)
  obj.rotation.y = rotY
  ctx.root.add(obj)
  return obj
}

/** A box collider matching a placed prop's bounds (optionally shrunk). */
function solid(ctx: LevelCtx, obj: THREE.Object3D, shrink = 0.85, maxH = 99) {
  obj.updateMatrixWorld(true)
  const b = new THREE.Box3().setFromObject(obj)
  const s = b.getSize(new THREE.Vector3())
  const c = b.getCenter(new THREE.Vector3())
  const h = Math.min(s.y, maxH)
  ctx.phys.box({ x: c.x, y: h / 2, z: c.z }, { x: (s.x * shrink) / 2, y: h / 2, z: (s.z * shrink) / 2 })
}

const onPodium = (t: Toy) => Math.hypot(t.pos.x - SEW.podium.x, t.pos.z - SEW.podium.z) < SEW.podium.r - 0.1 && t.feet > SEW.podium.h - 0.15 && t.feet < SEW.podium.h + 0.4
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

export default defineLevel<LoftState>({
  id: 'loft',
  name: 'The Loft',
  type: 'hub',
  blurb: 'A cosy attic where the toys wait between Shows.',
  howTo: ['Walk with WASD, look with the mouse', 'Jump into the toy chest to start a Show', 'Stand on the tape measure to dress up', 'Find the games hidden in the four corners'],
  accent: '#f59e0b',
  players: [1, 16],
  duration: 99999,
  camera: { kind: 'chase' },

  build(ctx) {
    // The attic shell; the Loft draws its own string lights (with wires and a twinkle).
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: HW, hd: HD, ridge: RIDGE, knee: KNEE, lights: 0, quality: ctx.quality })

    // The toy chest in the middle, with alphabet-block steps up to its rim.
    const chest = prop(ctx.assets, 'chest', 3.4, 'width')
    placeProp(ctx, chest, CHEST.x, CHEST.z + 0.2)
    const cw = CHEST.hw, cd = CHEST.hd, wall = CHEST.wall, t = 0.18
    ctx.phys.box({ x: CHEST.x, y: wall / 2, z: CHEST.z - cd }, { x: cw, y: wall / 2, z: t })
    ctx.phys.box({ x: CHEST.x, y: wall / 2, z: CHEST.z + cd }, { x: cw, y: wall / 2, z: t })
    ctx.phys.box({ x: CHEST.x - cw, y: wall / 2, z: CHEST.z }, { x: t, y: wall / 2, z: cd })
    ctx.phys.box({ x: CHEST.x + cw, y: wall / 2, z: CHEST.z }, { x: t, y: wall / 2, z: cd })
    ctx.phys.box({ x: CHEST.x, y: 0.2, z: CHEST.z }, { x: cw, y: 0.2, z: cd })
    // The open lid behind the chest.
    ctx.phys.box({ x: CHEST.x, y: 2.3, z: CHEST.z - cd - 0.4 }, { x: cw, y: 1.1, z: 0.2 })
    const blockColors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308']
    const steps: [number, number, number][] = [[-0.5, 3.0, 0.7], [0.6, 2.6, 0.7], [0.0, 1.9, 1.4]]
    steps.forEach(([x, z, h], i) => {
      const blk = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 1.1), mat(blockColors[i % blockColors.length]))
      blk.position.set(CHEST.x + x, h / 2, CHEST.z + z)
      blk.castShadow = blk.receiveShadow = true
      ctx.root.add(blk)
      ctx.phys.box({ x: CHEST.x + x, y: h / 2, z: CHEST.z + z }, { x: 0.55, y: h / 2, z: 0.55 })
      const letter = textSprite('ABC'[i], { color: '#ffffff', size: 0.6 })
      letter.position.set(CHEST.x + x, h + 0.35, CHEST.z + z)
      ctx.root.add(letter)
    })
    const chestSign = textSprite('Jump in to play!', { bg: '#1d4ed8', size: 0.7 })
    chestSign.position.set(CHEST.x, 4.4, CHEST.z)
    ctx.root.add(chestSign)

    const horse = prop(ctx.assets, 'horse', 3.6)
    placeProp(ctx, horse, -7.4, 5.4, 0.5)
    solid(ctx, horse, 0.6, 2.2)
    const boxes = prop(ctx.assets, 'boxes', 5.5)
    placeProp(ctx, boxes, 14.2, -2.6, -0.3)
    solid(ctx, boxes, 0.9)
    const chair = prop(ctx.assets, 'armchair', 6.5)
    placeProp(ctx, chair, -12.6, -1.4, 1.2)
    solid(ctx, chair, 0.8, 2.6)
    const sewing = prop(ctx.assets, 'sewing', 3, 'width')
    placeProp(ctx, sewing, 8, 3)
    const ss = propSize(sewing)
    ctx.phys.cylinder({ x: 8, y: ss.y / 2, z: 3 }, ss.y / 2, Math.min(ss.x, ss.z) * 0.42)
    const sewSign = textSprite('Sewing Table', { bg: '#7c2d12', size: 0.6 })
    sewSign.position.set(8, ss.y + 1.3, 3)
    ctx.root.add(sewSign)
    const tin = prop(ctx.assets, 'tin', 2.6, 'width')
    placeProp(ctx, tin, 4.5, -9)
    solid(ctx, tin, 0.85)
    const top = prop(ctx.assets, 'top', 1.8)
    placeProp(ctx, top, -4, -8)

    // Loose toys to pick up (E) and throw: alphabet blocks and a beach ball.
    const looseCols = ['#f97316', '#22c55e', '#3b82f6', '#e11d48']
    const loose: [number, number][] = [[8.6, -0.8], [2.5, -7.8], [-7.6, -4.2], [-4.4, 8.2], [3.2, 8.8]]
    for (let i = 0; i < 5; i++) {
      const [x, z] = loose[i]
      const ball = i === 4
      const body = ctx.phys.dynamic({ x, y: 1 + i * 0.1, z }, { damping: 0.4 })
      ctx.phys.attach(body, ball ? ctx.RAPIER.ColliderDesc.ball(0.45).setDensity(0.3) : ctx.RAPIER.ColliderDesc.cuboid(0.35, 0.35, 0.35).setDensity(0.4), { friction: 0.7, restitution: ball ? 0.75 : 0.2, groups: PROP_GROUPS })
      const mesh = ball
        ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 2), mat('#f43f5e', { roughness: 0.35 }))
        : new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(looseCols[i % looseCols.length]))
      mesh.castShadow = true
      ctx.root.add(mesh)
      ctx.grabbable(body, mesh)
    }

    // A rug under the chest.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(6.5, 40).rotateX(-Math.PI / 2), mat('#9f1239', { roughness: 1 }))
    rug.position.y = 0.01
    rug.receiveShadow = true
    ctx.root.add(rug)
    const rugRing = new THREE.Mesh(new THREE.RingGeometry(5.6, 5.9, 48).rotateX(-Math.PI / 2), mat('#fde68a', { roughness: 1 }))
    rugRing.position.y = 0.02
    ctx.root.add(rugRing)

    for (const [a] of ACTS) a.build(ctx)
  },

  init(ctx) {
    const st = {
      horse: null, topSpin: null, fired: new Set<Toy>(), t: 0, spin: 0,
      decor: [buildDisco(ctx), buildJungle(ctx), buildBeach(ctx), buildArcade(ctx)],
      atmos: buildAtmos(ctx, { hw: HW, hd: HD, ridge: RIDGE, knee: KNEE }),
      amb: new LoftAmbience(ctx),
    } as Partial<LoftState> as LoftState
    for (const [a, k] of ACTS) (st as unknown as Record<string, unknown>)[k] = a.init(ctx)
    ctx.root.traverse((o) => {
      if (o.name === 'prop:horse') {
        st.horse = o
        // Rock about the horse's own axis, after its turn.
        o.rotation.order = 'YXZ'
      }
      if (o.name === 'prop:top') st.topSpin = o
    })
    return st
  },

  spawn(ctx, _s, toy, i, n) {
    // People near the chest, bots spread round the room.
    if (toy.c.human) return ctx.spawnRing(Math.max(1, n), { x: 0, z: 0, radius: 5, faceIn: true })[i]
    const spots = Object.values(LOFT_ZONES).filter((z) => z.r >= 5)
    const z = spots[i % spots.length]
    return { x: z.x * 0.7 + (i % 3) - 1, y: 0, z: z.z * 0.7 + ((i * 7) % 3) - 1, yaw: i }
  },

  tick(ctx, st, dt) {
    st.t += dt
    // Toy chest: you jump in, the Show starts. Anyone else is bounced back out.
    for (const toy of ctx.toys) {
      const inside = Math.abs(toy.pos.x - CHEST.x) < CHEST.hw - 0.2 && Math.abs(toy.pos.z - CHEST.z) < CHEST.hd - 0.2 && toy.feet < CHEST.wall - 0.1
      if (!inside) {
        st.fired.delete(toy)
        continue
      }
      if (st.fired.has(toy)) continue
      st.fired.add(toy)
      ctx.fx.confetti(toy.pos)
      ctx.fx.sfx('boing', toy.pos)
      if (toy === ctx.me) ctx.signal('chest', toy)
      else {
        ctx.knock(toy, { x: 0, y: 9, z: 4 }, 0.3)
        if (toy.c.human) ctx.fx.popup(toy, 'Ready! The host starts the Show', '#93c5fd')
      }
    }
    for (const [a, k] of ACTS) a.tick(ctx, stateOf(st, k), dt)
  },

  bot(ctx, st, toy, dt) {
    // Dancing bots follow Freeze Dance; the rest wander the corners, stop to emote, and sometimes dance.
    if (freezeDance.bot!(ctx, st.fd, toy, dt)) return
    const d = toy.data as { goal?: [number, number]; wait?: number; fd?: number; fdUntil?: number }
    if (d.wait && d.wait > st.t) return
    if (!d.goal || Math.hypot(toy.pos.x - d.goal[0], toy.pos.z - d.goal[1]) < 1.2) {
      if (d.goal) {
        d.wait = st.t + ctx.rng.range(2, 7)
        toy.pad.emote = ctx.rng.pick(['wave', 'dance', 'stomp', 'dance', 'spin'] as const)
      }
      if (ctx.rng.chance(0.3)) {
        d.fd = 1
        d.fdUntil = ctx.time + ctx.rng.range(18, 40)
        d.goal = undefined
        return
      }
      const spots = Object.values(LOFT_ZONES).filter((z) => z !== LOFT_ZONES.chest && z !== LOFT_ZONES.sewing)
      const z = ctx.rng.pick(spots)
      d.goal = [z.x + ctx.rng.range(-2.5, 2.5), z.z + ctx.rng.range(-2.5, 2.5)]
      return
    }
    steerTo(toy, d.goal[0], d.goal[1], { pace: 0.55 })
    // Never into the chest.
    const cx = toy.pos.x - CHEST.x, cz = toy.pos.z - CHEST.z
    if (Math.hypot(cx, cz) < 3.4) {
      toy.pad.mx += cx * 0.4
      toy.pad.mz += cz * 0.4
    }
    avoidWalls(ctx, toy)
    hopObstacles(ctx, toy)
  },

  visual(ctx, st, dt) {
    st.t += ctx.isHost ? 0 : dt
    const t = ctx.time
    if (st.horse) st.horse.rotation.x = Math.sin(t * 1.6) * 0.12
    if (st.topSpin) st.topSpin.rotation.y += dt * 9
    for (const [a, k] of ACTS) a.visual(ctx, stateOf(st, k), dt)
    // Freeze Dance drives the disco groove (it cuts out on the freeze) and the lights pulse with it.
    const amb = st.amb
    if (amb) {
      amb.bpm = st.fd.ph === 0 ? 112 : st.fd.bpm
      if (amb.on && st.fd.ph === 2) amb.scratch()
      amb.on = st.fd.ph !== 2
      amb.update(dt)
    }
    const beat = Math.max(amb?.pulse ?? 0, st.fd.pulse)
    for (const d of st.decor) d.update(t, dt, beat)
    st.atmos?.update(t, dt)
    // The tape-measure podium turns whoever stands on it, for a look from every side.
    st.spin += dt * 0.9
    for (const toy of ctx.toys) {
      if (!toy.rig || !onPodium(toy) || Math.hypot(toy.vel.x, toy.vel.z) > 0.6) continue
      toy.rig.root.rotation.y = toy.yaw + st.spin
    }
    // Which corner am I in? The page shows a prompt (and the podium opens the wardrobe).
    const me = ctx.me
    if (me) {
      let zone = ''
      for (const [id, z] of Object.entries(LOFT_ZONES)) if (Math.hypot(me.pos.x - z.x, me.pos.z - z.z) < z.r) zone = id
      ctx.signal(`zone:${zone}`, me)
    }
  },

  pack: (_ctx, st) => ACTS.map(([a, k]) => a.pack(stateOf(st, k))),

  unpack(ctx, st, d) {
    const arr = d as unknown[]
    ACTS.forEach(([a, k], i) => {
      if (arr[i] !== undefined) a.unpack(ctx, stateOf(st, k), arr[i])
    })
  },

  onEvent(ctx, st, data) {
    const d = data as Record<string, unknown>
    if (d.k === 'score') {
      const toy = ctx.toys[Number(d.i)]
      if (!toy) return
      const mine = toy === ctx.me
      recordScore(d.g as LoftGame, toy.name, Number(d.v) || 0, mine, d.fin === 1)
      if (mine) ctx.signal(`loft-score:${d.g}:${Number(d.v) || 0}:${d.fin === 1 ? 1 : 0}`, toy)
      return
    }
    for (const [a, k] of ACTS) a.onEvent?.(ctx, stateOf(st, k), d)
  },

  hud(ctx, st, me): LevelHud | null {
    if (!me) return null
    // A game you're playing first, then whatever you're standing near.
    for (const [a, k] of ACTS) {
      const s = stateOf(st, k) as { player?: number }
      if (s.player === me.idx) return a.hud(ctx, stateOf(st, k), me)
    }
    if (onFloor(me)) return freezeDance.hud(ctx, st.fd, me)
    for (const [a, k] of ACTS) {
      const h = a.hud(ctx, stateOf(st, k), me)
      if (h) return h
    }
    return null
  },

  cameraUpdate(ctx, st, cam, dt) {
    const me = ctx.me
    if (!me) return false
    for (const [a, k] of ACTS) if (a.camera?.(ctx, stateOf(st, k), cam, me, dt)) return true
    if (!loftUi.wardrobe) return false
    // Wardrobe preview: frame your toy from the front (it turns on the podium).
    const on = onPodium(me)
    const face = on ? Math.atan2(7 - SEW.podium.x, 9 - SEW.podium.z) : me.yaw
    _v.set(me.pos.x + Math.sin(face) * 2.9, me.pos.y + 0.75, me.pos.z + Math.cos(face) * 2.9)
    // Shift the view so the toy sits left of the drawer.
    _v.x += Math.cos(face) * 0.9
    _v.z -= Math.sin(face) * 0.9
    cam.place(_v, _w.set(me.pos.x + Math.cos(face) * 0.75, me.pos.y + 0.25, me.pos.z - Math.sin(face) * 0.75), dt, 5)
    cam.yaw = face + Math.PI
    return true
  },

  dispose(ctx, st) {
    st.amb?.dispose()
    st.atmos?.dispose()
    for (const [a, k] of ACTS) a.dispose?.(ctx, stateOf(st, k))
  },
})
