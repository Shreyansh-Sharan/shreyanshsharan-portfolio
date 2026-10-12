// The shared sabotage system: Sprinkles, costs and cooldowns, half-price revenge on your grudge, Bubble Wrap
// (block and bounce back), the peanut gallery's throwables, bots that sabotage by difficulty and spice, and
// the stats that feed the end-of-Show awards. Runs on the host; clients see the results in snapshots.
import * as THREE from 'three'
import type { Rng } from './rng'
import type { Toy } from './toy'
import type { AnyLevel, Contestant, LevelCtx, ThrowKind, TrickDef } from './types'

/** Peanut-gallery ammo per round. */
export const GALLERY_AMMO: Record<ThrowKind, number> = { crumb: 4, paper: 3, feather: 3 }
export const GALLERY_COOLDOWN = 1.6

export const THROW_INFO: Record<ThrowKind, { name: string; desc: string }> = {
  crumb: { name: 'Crumb', desc: 'A tiny nudge.' },
  paper: { name: 'Paper ball', desc: 'A proper bonk: a short stagger.' },
  feather: { name: 'Feather', desc: 'A tickle: they twitch.' },
}

/** Bubble Wrap: the shared defence every level can include. Blocks the next trick and bounces it back. */
export function bubbleWrap<S>(cost = 2): TrickDef<S> {
  return {
    id: 'bubble',
    name: 'Bubble Wrap',
    icon: 'bubble',
    cost,
    cooldown: 6,
    target: 'self',
    blockable: false,
    desc: 'Blocks the next trick aimed at you and bounces it back to the sender.',
    counter: 'Hit them with something cheap first to pop it.',
    can: (_c, _s, user) => (user.bubble ? 'Already wrapped' : true),
    apply: (ctx, _s, user) => {
      user.bubble = true
      ctx.fx.sfx('pop', user.pos)
      ctx.fx.popup(user, 'Bubble Wrap!', '#93c5fd')
    },
    botUse: (_c, _s, user) => (user.c.stats.betrayed > 0 && !user.bubble ? null : false),
  }
}

/** Price of a trick for this user on this target: half (rounded down) on the toy you hold a grudge against. */
export function trickPrice(def: TrickDef<unknown>, user: Toy, target: Toy | null) {
  const revenge = def.target === 'rival' && !!target && user.grudge === target
  return { cost: revenge ? Math.floor(def.cost / 2) : def.cost, revenge }
}

/** Everything the sabotage system needs from the engine. */
export interface SabotageHost {
  ctx: LevelCtx
  level: AnyLevel
  state: unknown
  toys: readonly Toy[]
  roster: readonly Contestant[]
  rng: Rng
  /** Visual + sound for a trick landing, mirrored to clients. */
  trickFx(def: TrickDef<unknown>, user: Toy, target: Toy | null, result: 'hit' | 'blocked' | 'reflected' | 'self'): void
  throwFx(kind: ThrowKind, from: Contestant, target: Toy): void
}

export interface GalleryState {
  ammo: Record<ThrowKind, number>
  cd: number
  /** Bot think timer. */
  think: number
}

const _v = new THREE.Vector3()

export class Sabotage {
  host: SabotageHost
  readonly gallery = new Map<number, GalleryState>()
  private botThink = new Map<Toy, number>()

  constructor(host: SabotageHost) {
    this.host = host
  }

  tricks(): TrickDef<unknown>[] {
    const spice = this.host.ctx.spice
    return (this.host.level.tricks ?? []).filter((t: TrickDef<unknown>) => (t.minSpice ?? 0) <= spice)
  }

  /** Can `user` use trick `def` on `target` right now? true or a reason. */
  check(def: TrickDef<unknown>, user: Toy, target: Toy | null): true | string {
    const ctx = this.host.ctx
    if (ctx.phase !== 'play' && ctx.mode !== 'hub') return 'Not yet'
    if (user.status === 'failed') return 'You are out'
    if (user.busy > 0) return 'Busy'
    if (!user.canAct && def.target !== 'self') return 'Dazed'
    if ((user.cooldowns.get(def.id) ?? 0) > 0) return 'Cooling down'
    if (def.once && user.usedOnce.has(def.id)) return 'Used this round'
    if (def.hidden?.(ctx, this.host.state, user)) return 'Not available'
    if (def.target === 'rival') {
      if (!target || target === user || target.status !== 'play') return 'Pick a rival'
      if (def.range && target.pos.distanceTo(user.pos) > def.range) return 'Too far'
    }
    const { cost } = trickPrice(def, user, target)
    if (user.sprinkles < cost) return 'Not enough'
    const extra = def.can?.(ctx, this.host.state, user, target)
    if (extra !== undefined && extra !== true) return extra
    return true
  }

  /** Resolve "nearest in front" when no target was picked. */
  autoTarget(def: TrickDef<unknown>, user: Toy): Toy | null {
    if (def.target !== 'rival') return null
    if (user.grudge && user.grudge.status === 'play') return user.grudge
    let best: Toy | null = null
    let score = -Infinity
    const f = user.facing(_v)
    for (const t of this.host.toys) {
      if (t === user || t.status !== 'play') continue
      const dx = t.pos.x - user.pos.x, dz = t.pos.z - user.pos.z
      const d = Math.hypot(dx, dz) || 1
      if (def.range && d > def.range) continue
      const s = (dx * f.x + dz * f.z) / d - d * 0.05
      if (s > score) {
        score = s
        best = t
      }
    }
    return best
  }

  /** Use a trick (host). Returns true if it went off. */
  use(user: Toy, id: string, targetIdx: number): true | string {
    const def = this.tricks().find((t) => t.id === id)
    if (!def) return 'No such trick'
    let target: Toy | null = def.target === 'rival' ? (this.host.toys[targetIdx] ?? null) : null
    if (def.target === 'rival' && (!target || target === user || target.status !== 'play')) target = this.autoTarget(def, user)
    const ok = this.check(def, user, target)
    if (ok !== true) return ok
    const { cost, revenge } = trickPrice(def, user, target)
    user.sprinkles -= cost
    user.cooldowns.set(def.id, def.cooldown * (this.host.ctx.spice === 2 ? 0.8 : 1))
    if (def.once) user.usedOnce.add(def.id)
    user.busy = Math.max(user.busy, def.busy ?? 0)
    user.c.stats.tricks++
    const ctx = this.host.ctx
    const state = this.host.state
    if (def.target === 'rival' && target) {
      if (revenge) {
        user.c.stats.revenge++
        user.grudge = null
        ctx.fx.popup(user, 'Revenge!', '#f87171')
      }
      if (target.bubble && def.blockable !== false) {
        target.bubble = false
        // Bounced: it hits the sender instead (unless they are wrapped too).
        if (user.bubble) {
          user.bubble = false
          this.host.trickFx(def, user, target, 'blocked')
          ctx.fx.feed(`${target.name}'s Bubble Wrap blocked ${user.name}'s ${def.name}`)
          return true
        }
        this.host.trickFx(def, target, user, 'reflected')
        def.apply(ctx, state, target, user)
        user.grudge = target
        target.c.stats.menace++
        user.c.stats.betrayed++
        ctx.fx.feed(`${user.name}'s ${def.name} bounced off ${target.name}'s Bubble Wrap!`)
        return true
      }
      def.apply(ctx, state, user, target)
      target.grudge = user
      user.c.stats.menace++
      target.c.stats.betrayed++
      this.host.trickFx(def, user, target, 'hit')
      ctx.fx.feed(`${user.name} → ${def.name} → ${target.name}${revenge ? ' (revenge)' : ''}`)
    } else {
      def.apply(ctx, state, user, null)
      this.host.trickFx(def, user, null, 'self')
      if (def.target === 'none') ctx.fx.feed(`${user.name} used ${def.name}`)
    }
    return true
  }

  /** Bots sabotage at a rate set by difficulty and spice. */
  tickBots(dt: number) {
    const ctx = this.host.ctx
    if (ctx.phase !== 'play') return
    const tricks = this.tricks()
    if (!tricks.length) return
    const rate = [0.06, 0.15, 0.32][ctx.spice] * (0.65 + ctx.difficulty * 0.3)
    for (const b of this.host.toys) {
      if (!b.bot || b.status !== 'play') continue
      let t = (this.botThink.get(b) ?? this.host.rng.range(0.5, 2)) - dt
      if (t > 0) {
        this.botThink.set(b, t)
        continue
      }
      t = this.host.rng.range(0.8, 1.6)
      this.botThink.set(b, t)
      if (!this.host.rng.chance(rate * t * 1.5)) continue
      const options: { def: TrickDef<unknown>; target: Toy | null }[] = []
      for (const def of tricks) {
        let target: Toy | null = null
        if (def.botUse) {
          const r = def.botUse(ctx, this.host.state, b)
          if (r === false) continue
          target = r
        } else if (def.target === 'rival') target = this.defaultTarget(b)
        if (this.check(def, b, target) !== true) continue
        options.push({ def, target })
      }
      if (!options.length) continue
      const pick = this.host.rng.pick(options)
      this.use(b, pick.def.id, pick.target ? pick.target.idx : -1)
    }
  }

  defaultTarget(b: Toy): Toy | null {
    if (b.grudge && b.grudge.status === 'play') return b.grudge
    const lead = this.host.ctx.leader(b)
    if (lead && this.host.rng.chance(0.6)) return lead
    const rivals = this.host.toys.filter((t) => t !== b && t.status === 'play')
    return rivals.length ? this.host.rng.pick(rivals) : null
  }

  /* ---------- Peanut gallery ---------- */

  /** Everyone already out of the Show (and anyone failed this round) gets a handful of throwables. */
  joinGallery(c: Contestant) {
    if (!this.gallery.has(c.idx)) this.gallery.set(c.idx, { ammo: { ...GALLERY_AMMO }, cd: 0, think: this.host.rng.range(2, 6) })
  }

  throwables(): ThrowKind[] {
    return this.host.level.throwables ?? ['crumb', 'paper', 'feather']
  }

  throwCheck(c: Contestant, kind: ThrowKind, target: Toy | null): true | string {
    const g = this.gallery.get(c.idx)
    if (!g) return 'Not in the gallery'
    if (this.host.ctx.phase !== 'play') return 'Not yet'
    if (!this.throwables().includes(kind)) return 'Not here'
    if (g.ammo[kind] <= 0) return 'Out of those'
    if (g.cd > 0) return 'Reloading'
    if (!target || target.status !== 'play') return 'Pick a toy'
    if (this.host.level.canThrow && !this.host.level.canThrow(this.host.ctx, this.host.state, kind, target)) return 'Not now'
    return true
  }

  throw(c: Contestant, kind: ThrowKind, targetIdx: number): true | string {
    let target: Toy | null = this.host.toys[targetIdx] ?? null
    if (!target || target.status !== 'play') {
      const alive = this.host.toys.filter((t) => t.status === 'play')
      target = alive.length ? this.host.rng.pick(alive) : null
    }
    const ok = this.throwCheck(c, kind, target)
    if (ok !== true || !target) return ok
    const g = this.gallery.get(c.idx)!
    g.ammo[kind]--
    g.cd = GALLERY_COOLDOWN
    c.stats.throws++
    c.stats.menace++
    target.c.stats.betrayed++
    this.host.throwFx(kind, c, target)
    const ctx = this.host.ctx
    const handled = this.host.level.onThrow?.(ctx, this.host.state, kind, target, c)
    if (!handled) {
      const a = this.host.rng.range(0, Math.PI * 2)
      if (kind === 'crumb') ctx.knock(target, { x: Math.cos(a) * 1.8, y: 1, z: Math.sin(a) * 1.8 }, 0)
      else if (kind === 'paper') ctx.knock(target, { x: Math.cos(a) * 3.5, y: 2, z: Math.sin(a) * 3.5 }, 0.3)
      else ctx.knock(target, { x: Math.cos(a) * 0.8, y: 2.5, z: Math.sin(a) * 0.8 }, 0.15)
    }
    ctx.fx.feed(`${c.name} threw a ${THROW_INFO[kind].name.toLowerCase()} at ${target.name}`)
    return true
  }

  tickGallery(dt: number) {
    const ctx = this.host.ctx
    for (const [idx, g] of this.gallery) {
      g.cd = Math.max(0, g.cd - dt)
      const c = this.host.roster[idx]
      if (!c || c.human || ctx.phase !== 'play') continue
      g.think -= dt
      if (g.think > 0) continue
      g.think = this.host.rng.range(7, 14) / (0.6 + ctx.spice * 0.4)
      const kinds = this.throwables().filter((k) => g.ammo[k] > 0)
      if (!kinds.length) continue
      const alive = this.host.toys.filter((t) => t.status === 'play')
      if (!alive.length) continue
      // Gallery bots go after the leader or whoever knocked them out.
      const target = this.host.rng.chance(0.5) ? (ctx.leader() ?? this.host.rng.pick(alive)) : this.host.rng.pick(alive)
      this.throw(c, this.host.rng.pick(kinds), target.idx)
    }
  }
}
