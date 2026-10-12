// Button Claw (Cardboard Arcade): steer the claw over the capsules for fifteen seconds, drop it, and hope it
// holds on all the way to the chute. A capsule wins a random Sewing Table cosmetic once a day (decided on the
// winner's own screen, which knows what they own); after that it's practice. Others can watch and queue.
import * as THREE from 'three'
import type { LevelCtx, Toy } from '../../engine/types'
import { FOOT } from '../../engine/toy'
import { Batch, G, keepMat, T } from './kit'
import { ARCADE } from './layout'
import { claim, nearPrompt, station, stationTick, type LoftActivity, type Station } from './station'

const K = ARCADE.claw
const IN = K.size / 2 - 0.35
const TOP = 2.35
const BIN = 0.32
const CHUTE = { x: IN - 0.05, z: -IN + 0.05 }
const MOVE_T = 15

/** ph: 0 idle, 1 steering, 2 dropping, 3 closing, 4 lifting, 5 carrying, 6 releasing, 7 result pause. */
export interface ClawState extends Station {
  ph: number
  t: number
  /** Claw position in machine space (x across, z depth; origin at the bin centre) and height above the bin. */
  x: number
  z: number
  y: number
  open: number
  /** Capsule held (-1 none). */
  held: number
  /** Capsules: x, z (machine space), colour index; a won capsule respawns after a moment. */
  caps: number[][]
  /** Visuals. */
  group: THREE.Group | null
  head: THREE.Group | null
  cable: THREE.Mesh | null
  prongs: THREE.Mesh[]
  capMesh: THREE.InstancedMesh | null
}

const COLS = ['#f472b6', '#22d3ee', '#facc15', '#a3e635', '#c084fc', '#fb923c']
const _m = new THREE.Matrix4()
const _c = new THREE.Color()
const _v = new THREE.Vector3()
const _look = new THREE.Vector3()

export const buttonClaw: LoftActivity<ClawState> = {
  id: 'claw',

  build() {},

  init(ctx) {
    const group = new THREE.Group()
    group.position.set(K.x, 1.7, K.z)
    ctx.root.add(group)
    // Gantry rails along the top of the glass.
    const b = new Batch()
    for (const sx of [-1, 1]) b.add(G.box, '#9ca3af', T(sx * (IN + 0.2), TOP + 0.55, 0, 0, 0, 0, 0.08, 0.08, IN * 2 + 0.5), 'metal')
    // The chute: a little bin in the front corner.
    b.add(G.box, '#ef4444', T(CHUTE.x, 0.25, CHUTE.z, 0, 0, 0, 0.6, 0.5, 0.6), 'gloss')
    // The prize bed (cotton-wool snow under the capsules).
    b.add(G.cyl24, '#f5f5f4', T(-0.15, 0.05, 0.15, 0, 0, 0, K.size - 0.9, 0.1, K.size - 0.9))
    b.flush(group, { key: 'clawrig', shadows: false })
    const head = new THREE.Group()
    const metal = keepMat('l:claw', () => new THREE.MeshStandardMaterial({ color: '#d1d5db', metalness: 0.85, roughness: 0.3, flatShading: true }))
    const hub = new THREE.Mesh(G.cyl, metal)
    hub.scale.set(0.22, 0.16, 0.22)
    head.add(hub)
    const prongs: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const piv = new THREE.Group()
      piv.rotation.y = (i / 3) * Math.PI * 2
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.05).translate(0, -0.18, 0), metal)
      p.position.z = 0.09
      piv.add(p)
      head.add(piv)
      prongs.push(p)
    }
    group.add(head)
    const cable = new THREE.Mesh(G.cyl6, metal)
    group.add(cable)
    const capMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.2, 12, 8),
      keepMat('l:capsule', () => new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05 })),
      12,
    )
    capMesh.castShadow = true
    group.add(capMesh)
    // Capsules scattered on the prize bed (same on every screen: ctx.rng while building).
    const caps: number[][] = []
    for (let i = 0; i < 12; i++) {
      const x = ctx.rng.range(-IN + 0.15, IN - 0.35), z = ctx.rng.range(-IN + 0.45, IN - 0.1)
      caps.push([x, z, i % COLS.length])
    }
    return { ...station(), ph: 0, t: 0, x: 0, z: 0, y: TOP, open: 1, held: -1, caps, group, head, cable, prongs, capMesh }
  },

  tick(ctx, s, dt) {
    const join = stationTick(ctx, s, ARCADE.pad, 1.4, 'Button Claw')
    if (join) start(ctx, s, join)
    const toy = s.player >= 0 ? ctx.toys[s.player] : null
    if (!toy) {
      s.player = -1
      s.ph = 0
      return
    }
    s.t += dt
    const press = toy.pad.jump || toy.pad.act
    switch (s.ph) {
      case 1: {
        // Machine space: +x is world +x, +z is world +z (the machine faces -z, you stand on its -z side).
        s.x = THREE.MathUtils.clamp(s.x + toy.pad.mx * dt * 1.1, -IN, IN)
        s.z = THREE.MathUtils.clamp(s.z + toy.pad.mz * dt * 1.1, -IN, IN)
        toy.teleport(ARCADE.pad.x + s.x * 0.3, FOOT + 0.05, ARCADE.pad.z, 0)
        if ((press && s.t > 0.4) || s.t > MOVE_T) next(s, 2)
        else if (toy.pad.dive) finish(ctx, s, toy)
        break
      }
      case 2:
        s.y = Math.max(BIN + 0.32, s.y - dt * 1.6)
        if (s.y <= BIN + 0.32) next(s, 3)
        break
      case 3:
        s.open = Math.max(0, 1 - s.t / 0.5)
        if (s.t > 0.55) {
          // Grip: centred capsules hold well, glancing ones sometimes.
          let best = -1, bd = 0.32
          s.caps.forEach((c, i) => {
            const d = Math.hypot(c[0] - s.x, c[1] - s.z)
            if (c[2] >= 0 && d < bd) {
              bd = d
              best = i
            }
          })
          if (best >= 0 && ctx.rng.chance(bd < 0.14 ? 0.9 : 0.5)) s.held = best
          next(s, 4)
        }
        break
      case 4:
        s.y = Math.min(TOP, s.y + dt * 1.3)
        if (s.y >= TOP) next(s, 5)
        break
      case 5: {
        const dx = CHUTE.x - s.x, dz = CHUTE.z - s.z
        const l = Math.hypot(dx, dz)
        const step = Math.min(l, dt * 0.9)
        if (l > 0.01) {
          s.x += (dx / l) * step
          s.z += (dz / l) * step
        }
        // The claw's grip is famously weak: a held capsule may slip on the way.
        if (s.held >= 0 && ctx.rng.chance(dt * 0.18)) {
          const c = s.caps[s.held]
          c[0] = THREE.MathUtils.clamp(s.x, -IN + 0.1, IN - 0.4)
          c[1] = THREE.MathUtils.clamp(s.z, -IN + 0.45, IN - 0.1)
          s.held = -1
          ctx.fx.popup(toy, 'It slipped!', '#fca5a5')
          ctx.fx.sfx('pop', toy.pos)
        }
        if (l < 0.02) next(s, 6)
        break
      }
      case 6:
        s.open = Math.min(1, s.t / 0.4)
        if (s.t > 0.6) {
          if (s.held >= 0) {
            const c = s.caps[s.held]
            c[2] = -1 - c[2]
            ctx.fx.confetti({ x: K.x + CHUTE.x, y: 1.6, z: K.z + CHUTE.z })
            ctx.fx.sfx('cheer', toy.pos)
            ctx.fx.feed(`${toy.name} won a capsule from the Button Claw!`)
            // The winner's screen decides the prize (it knows what they own and whether today's is claimed).
            ctx.emit({ k: 'clawwin', seed: ctx.rng.int(1, 1e9) }, toy)
          } else {
            ctx.fx.popup(toy, 'So close!', '#fde68a')
            ctx.fx.sfx('buzz', toy.pos)
          }
          s.held = -1
          next(s, 7)
        }
        break
      case 7:
        if (s.t > 1.6) finish(ctx, s, toy)
        break
    }
  },

  visual(ctx, s, dt) {
    const p = s.player >= 0 ? ctx.toys[s.player] : null
    void p
    if (!s.head || !s.cable || !s.capMesh) return
    const t = ctx.time
    // Idle claw drifts in a lazy attract-mode loop.
    if (s.ph === 0) {
      s.x = Math.sin(t * 0.3) * IN * 0.6
      s.z = Math.cos(t * 0.23) * IN * 0.6
      s.y = TOP
      s.open = 1
    }
    s.head.position.set(s.x, s.y + 0.35, s.z)
    s.cable.scale.set(0.02, TOP + 0.55 - (s.y + 0.35), 0.02)
    s.cable.position.set(s.x, (TOP + 0.55 + s.y + 0.35) / 2, s.z)
    s.prongs.forEach((pr) => {
      pr.rotation.x = 0.15 + s.open * 0.55
    })
    let n = 0
    s.caps.forEach((c, i) => {
      if (c[2] < 0) return
      const held = s.held === i
      const x = held ? s.x : c[0], z = held ? s.z : c[1], y = held ? s.y + 0.02 : 0.27 + (i % 3) * 0.05
      _m.makeRotationZ(i * 0.9).setPosition(x, y, z)
      s.capMesh!.setMatrixAt(n, _m)
      s.capMesh!.setColorAt(n, _c.set(COLS[c[2] % COLS.length]))
      n++
    })
    s.capMesh.count = n
    s.capMesh.instanceMatrix.needsUpdate = true
    if (s.capMesh.instanceColor) s.capMesh.instanceColor.needsUpdate = true
    void dt
  },

  onEvent(ctx, _s, d) {
    if (d.k !== 'clawwin') return
    // On the winner's screen: tell the page, which picks the prize and saves it.
    ctx.signal(`loft-claw:${Number(d.seed) || 1}`, ctx.me)
  },

  pack: (s) => [s.player, s.ph, Math.round(s.t * 100) / 100, r2(s.x), r2(s.z), r2(s.y), r2(s.open), s.held, s.queue.length, ...s.queue, ...s.caps.flatMap((c) => [r2(c[0]), r2(c[1]), c[2]])],

  unpack(_ctx, s, d) {
    const a = d as number[]
    ;[s.player, s.ph, s.t, s.x, s.z, s.y, s.open, s.held] = a
    const q = a[8]
    s.queue = a.slice(9, 9 + q)
    const c = a.slice(9 + q)
    for (let i = 0; i * 3 + 2 < c.length; i++) s.caps[i] = [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]
  },

  hud(ctx, s, me) {
    if (s.player === me.idx) {
      const left = Math.max(0, MOVE_T - s.t)
      return {
        status: { text: s.ph === 1 ? 'BUTTON CLAW' : s.ph <= 4 ? 'GRAB…' : s.held >= 0 ? 'HOLD ON…' : 'Button Claw', color: '#f0abfc', pulse: s.ph === 5 },
        prompt: s.ph === 1 ? 'WASD to move the claw · Space to drop · Shift to leave' : s.held >= 0 ? 'Got one! Heading for the chute…' : 'Fingers crossed…',
        chips: s.ph === 1 ? [`${Math.ceil(left)} s`] : [],
        bars: s.ph === 1 ? [{ label: 'Time', value: left / MOVE_T, color: '#f0abfc', danger: left < 4 }] : [],
      }
    }
    if (Math.hypot(me.pos.x - ARCADE.pad.x, me.pos.z - ARCADE.pad.z) > 3) return null
    return nearPrompt(ctx, s, me, 'Button Claw', s.held >= 0 ? 'holding one!' : 'steering')
  },

  camera(_ctx, s, cam, me, dt) {
    if (s.player !== me.idx || s.ph === 0) return false
    cam.yaw = 0
    cam.place(_v.set(K.x + s.x * 0.3, 3.6, K.z - K.size / 2 - 2.6), _look.set(K.x + s.x * 0.5, 2.1, K.z + s.z * 0.4), dt, 6)
    return true
  },
}

function next(s: ClawState, ph: number) {
  s.ph = ph
  s.t = 0
}

function start(ctx: LevelCtx, s: ClawState, toy: Toy) {
  s.player = toy.idx
  s.held = -1
  s.x = 0
  s.z = 0
  s.y = 2.35
  s.open = 1
  // Respawn any capsules won earlier.
  s.caps.forEach((c) => {
    if (c[2] < 0) c[2] = -1 - c[2]
  })
  next(s, 1)
  claim(toy, 'claw')
  toy.release(false)
  toy.frozen = true
  ctx.fx.say('BUTTON CLAW', '#f0abfc', 1.4, toy)
}

function finish(ctx: LevelCtx, s: ClawState, toy: Toy) {
  claim(toy, null)
  toy.frozen = false
  ctx.respawn(toy, { x: ARCADE.pad.x, y: 0, z: ARCADE.pad.z - 0.4, yaw: 0 }, 0.1)
  s.player = -1
  s.ph = 0
  s.held = -1
}

const r2 = (x: number) => Math.round(x * 100) / 100
