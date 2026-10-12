// Freeze Dance (Disco Closet): dance on the light-up floor while the music plays, stop dead when it cuts out.
// Clean stops build a combo; anyone still moving after the freeze gets booped off the floor. The tempo creeps
// up, and 20 in a row unlocks the Disco Fever emote. Anyone on the floor plays (bots join in too).
import * as THREE from 'three'
import type { Toy } from '../../engine/types'
import { steerTo } from '../../engine/bots'
import { ctex, keepMat } from './kit'
import { DISCO } from './layout'
import { scoreEvent, type LoftActivity } from './station'

/** Phases: 0 nobody dancing, 1 music, 2 freeze. */
export interface FreezeState {
  ph: number
  /** Loft clock when this phase began. */
  t0: number
  bpm: number
  /** Beats of music this time. */
  beats: number
  /** Combo per toy index (only toys with one). */
  combo: Map<number, number>
  /** Host: seconds each toy spent moving during this music phase, and who was booped this freeze. */
  moved: Map<number, number>
  booped: Set<number>
  /** Visuals. */
  tiles: THREE.InstancedMesh | null
  lastBeat: number
  /** Beat pulse 0..1 for the lights (every screen). */
  pulse: number
}

const F = DISCO.floor
const HALF = (F.n * F.tile) / 2
const FREEZE_LEN = 2.2
const GRACE = 0.45
const UNLOCK = 20

export function onFloor(t: Toy) {
  return t.status === 'play' && Math.abs(t.pos.x - F.x) < HALF && Math.abs(t.pos.z - F.z) < HALF && t.feet < 0.8
}

const PALETTE = ['#f472b6', '#facc15', '#22d3ee', '#a3e635', '#c084fc', '#fb923c']
const _c = new THREE.Color()

export const freezeDance: LoftActivity<FreezeState> = {
  id: 'freeze',

  build() {},

  init(ctx) {
    // Board-game tiles: a white-rimmed square with a printed symbol, lit by an instance colour.
    const tex = ctex('tile', 64, 64, (g, w, h) => {
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#d4d4d8'
      g.fillRect(4, 4, w - 8, h - 8)
      g.fillStyle = '#ffffff'
      g.fillRect(8, 8, w - 16, h - 16)
      g.fillStyle = 'rgba(0,0,0,0.18)'
      g.font = 'bold 30px sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('★', w / 2, h / 2 + 2)
    })
    const mat = keepMat('l:tile', () => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(F.tile * 0.96, 0.1, F.tile * 0.96), mat, F.n * F.n)
    const m = new THREE.Matrix4()
    for (let i = 0; i < F.n * F.n; i++) {
      const cx = i % F.n, cz = Math.floor(i / F.n)
      tiles.setMatrixAt(i, m.makeTranslation(F.x - HALF + (cx + 0.5) * F.tile, 0.05, F.z - HALF + (cz + 0.5) * F.tile))
      tiles.setColorAt(i, _c.set(PALETTE[(cx + cz) % PALETTE.length]))
    }
    tiles.receiveShadow = true
    ctx.root.add(tiles)
    ctx.phys.box({ x: F.x, y: 0.05, z: F.z }, { x: HALF, y: 0.05, z: HALF }, { friction: 0.8 })
    return { ph: 0, t0: 0, bpm: 108, beats: 8, combo: new Map(), moved: new Map(), booped: new Set(), tiles, lastBeat: -1, pulse: 0 }
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const dancers = ctx.toys.filter(onFloor)
    // Anyone who leaves the floor ends their streak.
    for (const [idx, n] of s.combo) {
      const toy = ctx.toys[idx]
      if (toy && onFloor(toy)) continue
      s.combo.delete(idx)
      if (toy && n > 0) scoreEvent(ctx, 'freeze', toy, n, true)
    }
    if (s.ph === 0) {
      if (dancers.length) {
        s.ph = 1
        s.t0 = t
        s.bpm = 108
        s.beats = 8
        s.moved.clear()
      }
      return
    }
    if (!dancers.length && t - s.t0 > 3) {
      s.ph = 0
      return
    }
    if (s.ph === 1) {
      for (const d of dancers) if (Math.hypot(d.vel.x, d.vel.z) > 1.2 || !d.grounded) s.moved.set(d.idx, (s.moved.get(d.idx) ?? 0) + dt)
      if (t - s.t0 >= (s.beats * 60) / s.bpm) {
        s.ph = 2
        s.t0 = t
        s.booped.clear()
        ctx.fx.say('FREEZE!', '#f87171', 1)
      }
      return
    }
    // Freeze: after a short grace, anyone still moving is booped off the floor.
    const ft = t - s.t0
    if (ft > GRACE && ft < FREEZE_LEN - 0.3) {
      for (const d of dancers) {
        if (s.booped.has(d.idx)) continue
        if (Math.hypot(d.vel.x, d.vel.z) > 1.0 || (!d.grounded && d.vel.y > 1)) {
          s.booped.add(d.idx)
          const ox = d.pos.x - F.x, oz = d.pos.z - F.z
          const l = Math.max(0.3, Math.hypot(ox, oz))
          ctx.knock(d, { x: (ox / l) * 9, y: 7, z: (oz / l) * 9 }, 0.7)
          ctx.fx.popup(d, 'Booped!', '#f87171')
          ctx.fx.sfx('boing', d.pos)
          const n = s.combo.get(d.idx) ?? 0
          s.combo.delete(d.idx)
          if (n > 0) scoreEvent(ctx, 'freeze', d, n, true)
        }
      }
    }
    if (ft >= FREEZE_LEN) {
      for (const d of dancers) {
        if (s.booped.has(d.idx)) continue
        const music = (s.beats * 60) / s.bpm
        if ((s.moved.get(d.idx) ?? 0) < music * 0.3) {
          ctx.fx.popup(d, 'Dance first!', '#fde68a')
          continue
        }
        const n = (s.combo.get(d.idx) ?? 0) + 1
        s.combo.set(d.idx, n)
        ctx.fx.popup(d, n >= 3 ? `Clean stop! ×${n}` : 'Clean stop!', '#86efac')
        if (n % 5 === 0) ctx.fx.puff(d.pos, 'spark', 14)
        if (d.c.human) scoreEvent(ctx, 'freeze', d, n, false)
        if (n === UNLOCK && d.c.human) ctx.fx.say('DISCO FEVER!', '#f0abfc', 2.5, d)
      }
      s.ph = 1
      s.t0 = t
      s.bpm = Math.min(168, s.bpm + 4)
      s.beats = 4 + 2 * ctx.rng.int(1, 4)
      s.moved.clear()
    }
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    s.pulse = Math.max(0, s.pulse - dt * 3.5)
    const beat = s.ph === 1 ? Math.floor(((t - s.t0) * s.bpm) / 60) : -1
    const tiles = s.tiles
    if (!tiles) return
    const key = s.ph === 2 ? -2 - Math.floor(t * 4) : s.ph === 0 ? -100 - Math.floor(t * 1.5) : beat
    if (key !== s.lastBeat) {
      if (s.ph === 1 && beat !== s.lastBeat) s.pulse = 1
      s.lastBeat = key
      for (let i = 0; i < F.n * F.n; i++) {
        const cx = i % F.n, cz = Math.floor(i / F.n)
        if (s.ph === 2) _c.set((Math.floor(t * 4) + cx + cz) % 2 ? '#ef4444' : '#7f1d1d')
        else if (s.ph === 0) _c.set(PALETTE[(cx + cz + Math.floor(t * 1.5)) % PALETTE.length]).multiplyScalar(0.55)
        else _c.set(PALETTE[(cx * 3 + cz * 5 + beat) % PALETTE.length]).multiplyScalar((cx + cz + beat) % 3 === 0 ? 1.25 : 0.8)
        tiles.setColorAt(i, _c)
      }
      if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true
    }
  },

  pack: (s) => {
    const out = [s.ph, Math.round(s.t0 * 100) / 100, s.bpm, s.beats]
    for (const [i, n] of s.combo) out.push(i, n)
    return out
  },

  unpack(_ctx, s, d) {
    const a = d as number[]
    s.ph = a[0]
    s.t0 = a[1]
    s.bpm = a[2]
    s.beats = a[3]
    s.combo.clear()
    for (let i = 4; i + 1 < a.length; i += 2) s.combo.set(a[i], a[i + 1])
  },

  hud(_ctx, s, me) {
    const on = onFloor(me)
    const near = Math.hypot(me.pos.x - F.x, me.pos.z - F.z) < HALF + 3
    if (!on && !near) return null
    const n = s.combo.get(me.idx) ?? 0
    if (!on) return { status: { text: 'Freeze Dance', color: '#f0abfc' }, prompt: 'Step onto the light-up floor to dance', chips: [] }
    const status = s.ph === 2 ? { text: 'FREEZE!', color: '#f87171', pulse: true } : { text: 'DANCE!', color: '#86efac' }
    return {
      status,
      prompt: s.ph === 2 ? 'Stop dead! Anyone moving gets booped' : 'Keep moving while the music plays, stop dead when it cuts',
      chips: [`Combo ×${n}`, `${s.bpm} bpm`],
      bars: [{ label: `Disco Fever ${Math.min(n, UNLOCK)}/${UNLOCK}`, value: Math.min(1, n / UNLOCK), color: '#f0abfc' }],
    }
  },

  bot(ctx, s, toy) {
    const d = toy.data as { fd?: number; fdGoal?: [number, number]; fdReact?: number; fdUntil?: number }
    if (!d.fd) return false
    if (ctx.time > (d.fdUntil ?? 0)) {
      d.fd = 0
      return false
    }
    if (!onFloor(toy)) {
      steerTo(toy, F.x + (d.fdGoal?.[0] ?? 0), F.z + (d.fdGoal?.[1] ?? 0), { pace: 0.6 })
      d.fdGoal ??= [ctx.rng.range(-HALF + 0.6, HALF - 0.6), ctx.rng.range(-HALF + 0.6, HALF - 0.6)]
      return true
    }
    if (s.ph === 2) {
      // React to the freeze after a moment; sometimes too slowly.
      d.fdReact ??= ctx.time + ctx.rng.range(0.1, ctx.difficulty >= 2 ? 0.35 : 0.75)
      if (ctx.time < d.fdReact) steerTo(toy, F.x + (d.fdGoal?.[0] ?? 0), F.z + (d.fdGoal?.[1] ?? 0), { pace: 0.5 })
      return true
    }
    d.fdReact = undefined
    if (!d.fdGoal || Math.hypot(toy.pos.x - F.x - d.fdGoal[0], toy.pos.z - F.z - d.fdGoal[1]) < 0.6) d.fdGoal = [ctx.rng.range(-HALF + 0.6, HALF - 0.6), ctx.rng.range(-HALF + 0.6, HALF - 0.6)]
    steerTo(toy, F.x + d.fdGoal[0], F.z + d.fdGoal[1], { pace: 0.55 })
    if (ctx.rng.chance(0.004)) toy.pad.jump = true
    return true
  },
}
