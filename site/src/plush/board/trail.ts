// TOY BOX TRAIL: the board mode. 2 to 6 toys take turns rolling a big foam die and hopping along a trail of
// playing cards across the attic floor to the cookie jar. Tiles give or take buttons, draw surprise cards,
// open the button shop, start duels, stick you to tape, or send you up a popsicle ladder or down a slide.
// Landing on another toy (or a duel tile) plays a registered level as a 30-second duel (ctx.startDuel), and
// every third table round everyone plays a mini-game for bonus buttons. Bags of tricks (three slots) hold the
// Squeaky Hammer, Mousetrap, Jack-in-the-Box, Bubble Wrap, Double Die and Magnet Spool.
//
// The whole board is one long round (mode 'board'). Its game lives in ctx.session.trail, so it survives the
// duels in between (the engine rebuilds this level after each one and calls onDuelEnd). The host runs the
// rules; clients get the game through pack/unpack and send their choices with game.levelAction().
import * as THREE from 'three'
import { skill } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { RAPIER } from '../engine/physics'
import { FOOT } from '../engine/toy'
import type { AnimKey } from '../engine/rig'
import { defineLevel, type DuelResult, type LevelCtx, type Toy } from '../engine/types'
import { BAG_SLOTS, CARDS, DUEL_STAKE, ITEM_IDS, ITEMS, PARTY_BONUS, PARTY_EVERY, START_BUTTONS, type ItemId } from './items'
import { FORKS, GOAL, jumpPath, START, TILE_INFO, TILES } from './layout'
import { buildBoard, DIE_FACES, dieNumber, type BoardView } from './view'

export type Phase = 'start' | 'pre' | 'roll' | 'move' | 'fork' | 'tile' | 'settle' | 'shop' | 'card' | 'pick' | 'stake' | 'wait' | 'end' | 'over'

/** A move in progress. k: 1 hop, 2 big arc (jack, swap, tailwind), 3 along a path (ladder, slide), 4 dragged. */
export interface Mv {
  k: number
  a: number
  b: number
  t0: number
  d: number
  /** Where it started (world). */
  x: number
  y: number
  z: number
}

export interface Seat {
  /** Contestant (roster) index. */
  c: number
  tile: number
  /** Buttons. */
  b: number
  items: ItemId[]
  /** Bubble Wrap on. */
  bub: boolean
  /** Turns to miss. */
  skip: number
  /** Contestant who last hit this toy (-1 none): revenge on them refunds half the trick's price. */
  grudge: number
  /** Double Die armed for this turn. */
  dbl: boolean
  mv: Mv | null
  /** Shows the knocked-over pose until this board time. */
  hitT: number
}

/** The synced game (also kept in ctx.session.trail on every screen). */
export interface TrailData {
  clock: number
  turn: number
  round: number
  ph: Phase
  /** When this phase began (board clock) and its time limit (0 = none): the turn timer. */
  pt: number
  lim: number
  steps: number
  /** Branch picked at a fork (-1 not yet). */
  fork: number
  /** The last tile checked on arrival (traps, the jar). */
  chk: number
  /** Hops start at this board time (a beat after the dice settle). */
  go: number
  dice: number[]
  dieN: number
  used: boolean
  duelled: boolean
  /** Table round of the last duel: landing on a toy only starts a duel once a round has gone by. */
  lastDuel: number
  traps: [number, number][]
  log: [number, string][]
  logN: number
  card: number
  duel: { party: boolean; toys: number[]; level: string; name: string; sent: boolean } | null
  stake: { w: number; losers: number[] } | null
  winner: number
  players: Seat[]
}

/** Host-only bits (not synced): the shuffled surprise deck and level bag, dice settle timers. */
interface HostData {
  deck: number[]
  bag: string[]
  still: number[]
}

interface State {
  d: TrailData
  h: HostData
  v: BoardView
  ended: boolean
}

const TURN_LIMIT = 15
const CHOICE_LIMIT = 10
const SHOP_LIMIT = 16
const HOP = 0.42

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _q = new THREE.Quaternion()
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]

/* ---------------- Small helpers ---------------- */

export const cur = (d: TrailData) => d.players[d.turn]
const seatOf = (d: TrailData, c: number) => d.players.find((p) => p.c === c) ?? null
const toyOf = (ctx: LevelCtx, c: number) => ctx.toys.find((t) => t.c.idx === c) ?? null
const nameOf = (ctx: LevelCtx, c: number) => toyOf(ctx, c)?.name ?? '?'
const moving = (d: TrailData, p: Seat) => !!p.mv && d.clock < p.mv.t0 + p.mv.d
const anyMoving = (d: TrailData) => d.players.some((p) => moving(d, p))
const statsOf = (ctx: LevelCtx, c: number) => toyOf(ctx, c)?.c.stats ?? null

function setPh(d: TrailData, ph: Phase, lim = 0) {
  d.ph = ph
  d.pt = d.clock
  d.lim = lim
}

function log(d: TrailData, text: string) {
  d.logN++
  d.log.push([d.logN, text])
  if (d.log.length > 7) d.log.shift()
}

function shuffle<T>(ctx: LevelCtx, a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = ctx.rng.int(0, i)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** The toy furthest along (fewest hops to the jar), other than `except`. */
function leader(d: TrailData, except?: Seat) {
  let best: Seat | null = null
  for (const p of d.players) if (p !== except && (!best || TILES[p.tile].dist < TILES[best.tile].dist)) best = p
  return best
}

/** Follow the trail backwards n tiles (stops at the start). */
function backFrom(tile: number, n: number) {
  let t = tile
  for (let i = 0; i < n && t !== START; i++) t = TILES[t].prev
  return t
}

/** Follow the main way forwards n tiles (stops at the jar). */
function aheadFrom(tile: number, n: number) {
  let t = tile
  for (let i = 0; i < n && t !== GOAL; i++) t = TILES[t].next[0]
  return t
}

/** Where a toy stands on its tile (several toys share a tile in a little ring). */
function restPos(d: TrailData, p: Seat, out: THREE.Vector3) {
  const t = TILES[p.tile]
  let n = 0, k = 0
  for (const q of d.players) {
    if (q.tile !== p.tile) continue
    if (q === p) k = n
    n++
  }
  if (n <= 1) return out.set(t.x, t.y, t.z)
  const a = (k / n) * Math.PI * 2 + 0.4
  const r = n > 2 ? 0.5 : 0.4
  return out.set(t.x + Math.sin(a) * r, t.y, t.z + Math.cos(a) * r)
}

/** A toy's feet position and facing right now (host: drives the seat; every screen: picks the pose). */
function posOf(d: TrailData, p: Seat, out: THREE.Vector3): number {
  const end = restPos(d, p, out)
  const mv = p.mv
  if (!mv || d.clock >= mv.t0 + mv.d) return Math.PI + ((p.c * 0.37) % 0.6) - 0.3
  const u = Math.max(0, (d.clock - mv.t0) / mv.d)
  const ex = end.x, ey = end.y, ez = end.z
  let yaw = Math.atan2(ex - mv.x, ez - mv.z)
  if (mv.k === 3) {
    // Along the ladder / slide: a polyline through the path's middle points.
    const pts = jumpPath(mv.a)
    pts[0] = [mv.x, mv.y, mv.z]
    pts[pts.length - 1] = [ex, ey, ez]
    let total = 0
    const lens: number[] = []
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
      lens.push(l)
      total += l
    }
    let s = u * total
    for (let i = 1; i < pts.length; i++) {
      if (s <= lens[i - 1] || i === pts.length - 1) {
        const f = Math.min(1, s / Math.max(1e-4, lens[i - 1]))
        const a = pts[i - 1], b = pts[i]
        out.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)
        yaw = Math.atan2(b[0] - a[0], b[2] - a[2])
        return yaw
      }
      s -= lens[i - 1]
    }
    return yaw
  }
  const e = mv.k === 4 ? 1 - (1 - u) * (1 - u) : u
  out.set(mv.x + (ex - mv.x) * e, mv.y + (ey - mv.y) * e, mv.z + (ez - mv.z) * e)
  out.y += Math.sin(Math.PI * u) * (mv.k === 1 ? 0.75 : mv.k === 2 ? 3.4 : 0.35)
  if (mv.k === 4) yaw += Math.PI
  return yaw
}

function poseOf(d: TrailData, p: Seat): AnimKey | null {
  const mv = p.mv
  if (mv && d.clock < mv.t0 + mv.d) return mv.k === 4 ? 'knock' : mv.k === 3 ? (TILES[mv.a].kind === 'slide' ? 'dive' : 'run') : 'jump'
  if (d.winner === p.c) return 'cheer'
  if (p.hitT > d.clock) return 'knock'
  if (d.stake && d.stake.w === p.c) return 'cheer'
  if (cur(d) === p && d.ph !== 'over') return d.ph === 'start' ? 'wave' : 'idle'
  return 'sit'
}

/** Start a move of `p` to `tile` (kind k, dur seconds). */
function moveTo(d: TrailData, p: Seat, tile: number, k: number, dur: number) {
  posOf(d, p, _w)
  p.mv = { k, a: p.tile, b: tile, t0: d.clock, d: dur, x: _w.x, y: _w.y, z: _w.z }
  p.tile = tile
}

/* ---------------- Turn flow (host) ---------------- */

function fresh(ctx: LevelCtx): TrailData {
  return {
    clock: 0, turn: 0, round: 1, ph: 'start', pt: 0, lim: 0, steps: 0, fork: -1, chk: -1, go: 0, dice: [0, 0], dieN: 0, used: false, duelled: false, lastDuel: -9,
    traps: [], log: [], logN: 0, card: -1, duel: null, stake: null, winner: -1,
    players: ctx.toys.map((t) => ({ c: t.c.idx, tile: START, b: START_BUTTONS, items: [], bub: false, skip: 0, grudge: -1, dbl: false, mv: null, hitT: 0 })),
  }
}

function startTurn(ctx: LevelCtx, s: State) {
  const d = s.d
  d.used = false
  d.duelled = false
  d.steps = 0
  d.fork = -1
  d.chk = cur(d).tile
  d.card = -1
  d.stake = null
  setPh(d, 'start')
  const p = cur(d)
  const toy = toyOf(ctx, p.c)
  ctx.fx.say(`${nameOf(ctx, p.c)}'s turn`, toy?.c.tint === '#ffffff' ? '#fde68a' : (toy?.c.tint ?? '#fde68a'), 1.3)
  if (toy) ctx.fx.sfx('ding', toy.pos)
}

function nextTurn(ctx: LevelCtx, s: State) {
  const d = s.d
  parkDice(s)
  d.dieN = 0
  d.turn = (d.turn + 1) % d.players.length
  if (d.turn === 0) {
    d.round++
    if ((d.round - 1) % PARTY_EVERY === 0) {
      startDuel(ctx, s, d.players.map((p) => p.c), true)
      return
    }
  }
  startTurn(ctx, s)
}

function parkDice(s: State) {
  s.v.dice.forEach((die, k) => {
    die.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    die.body.setTranslation({ x: k * 2, y: -20, z: 0 }, true)
  })
}

function roll(ctx: LevelCtx, s: State) {
  const d = s.d
  const p = cur(d)
  d.dieN = p.dbl ? 2 : 1
  p.dbl = false
  d.dice = [0, 0]
  s.h.still = [0, 0]
  const toy = toyOf(ctx, p.c)
  const at = toy ? toy.pos : _v.set(TILES[p.tile].x, 1, TILES[p.tile].z)
  for (let k = 0; k < d.dieN; k++) {
    const body = s.v.dice[k].body
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
    body.setTranslation({ x: at.x + (k ? 0.75 : -0.45), y: 2.6 + k * 0.4, z: at.z - 0.4 }, true)
    _q.setFromEuler(new THREE.Euler(ctx.rng.range(0, 6.3), ctx.rng.range(0, 6.3), ctx.rng.range(0, 6.3)))
    body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true)
    body.setLinvel({ x: ctx.rng.range(-1.3, 1.3), y: 3, z: -ctx.rng.range(3.4, 4.8) }, true)
    body.setAngvel({ x: ctx.rng.range(-15, 15), y: ctx.rng.range(-10, 10), z: ctx.rng.range(-15, 15) }, true)
  }
  if (toy) ctx.fx.sfx('throw', toy.pos)
  setPh(d, 'roll')
}

function topFace(body: { rotation(): { x: number; y: number; z: number; w: number } }) {
  const r = body.rotation()
  _q.set(r.x, r.y, r.z, r.w)
  let best = 0, by = -9
  AXES.forEach((a, i) => {
    const y = _v.copy(a).applyQuaternion(_q).y
    if (y > by) {
      by = y
      best = i
    }
  })
  return DIE_FACES[best]
}

function diceTick(ctx: LevelCtx, s: State, dt: number) {
  const d = s.d
  const el = d.clock - d.pt
  for (let k = 0; k < d.dieN; k++) {
    if (d.dice[k]) continue
    const body = s.v.dice[k].body
    const lv = body.linvel(), av = body.angvel(), tr = body.translation()
    const slow = Math.hypot(lv.x, lv.y, lv.z) < 0.15 && Math.hypot(av.x, av.y, av.z) < 0.3 && el > 0.5
    s.h.still[k] = slow ? s.h.still[k] + dt : 0
    if (s.h.still[k] > 0.3 || el > 4 || tr.y < -2) {
      d.dice[k] = tr.y < -2 ? ctx.rng.int(1, 6) : topFace(body)
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
      ctx.fx.sfx('boing', tr)
    }
  }
  for (let k = 0; k < d.dieN; k++) if (!d.dice[k]) return
  const total = d.dice[0] + (d.dieN > 1 ? d.dice[1] : 0)
  const p = cur(d)
  d.steps = total
  d.go = d.clock + 0.6
  d.chk = p.tile
  ctx.fx.say(d.dieN > 1 ? `${d.dice[0]} + ${d.dice[1]} = ${total}!` : `${total}!`, '#fde68a', 1.2)
  log(d, `${nameOf(ctx, p.c)} rolled ${d.dieN > 1 ? `${d.dice[0]} + ${d.dice[1]} = ` : ''}${total}`)
  setPh(d, 'move')
}

function moveTick(ctx: LevelCtx, s: State) {
  const d = s.d
  const p = cur(d)
  if (d.clock < d.go || moving(d, p)) return
  if (d.chk !== p.tile) {
    d.chk = p.tile
    if (arrive(ctx, s, p)) return
  }
  if (d.steps <= 0) {
    setPh(d, 'tile')
    return
  }
  const t = TILES[p.tile]
  if (!t.next.length) {
    setPh(d, 'tile')
    return
  }
  let n = t.next[0]
  if (t.next.length > 1) {
    if (d.fork < 0) {
      setPh(d, 'fork', CHOICE_LIMIT)
      return
    }
    n = t.next[d.fork]
    d.fork = -1
  }
  moveTo(d, p, n, 1, HOP)
  d.steps--
  const toy = toyOf(ctx, p.c)
  if (toy) ctx.fx.sfx('boop', toy.pos)
}

/** Arriving on a tile mid-move: the jar wins, a rival's mousetrap snaps. True if the move stopped. */
function arrive(ctx: LevelCtx, s: State, p: Seat) {
  const d = s.d
  if (p.tile === GOAL) {
    win(ctx, s, p)
    return true
  }
  const i = d.traps.findIndex(([tile, owner]) => tile === p.tile && owner !== p.c)
  if (i < 0) return false
  const owner = seatOf(d, d.traps[i][1])
  d.traps.splice(i, 1)
  const toy = toyOf(ctx, p.c)
  if (!owner) return false
  if (p.bub) {
    p.bub = false
    const back = backFrom(owner.tile, 3)
    moveTo(d, owner, back, 4, 0.9)
    owner.hitT = d.clock + 1.2
    owner.grudge = p.c
    bump(ctx, p.c, owner.c, 'Mousetrap')
    log(d, `${nameOf(ctx, p.c)}'s Bubble Wrap bounced ${nameOf(ctx, owner.c)}'s Mousetrap back! ${nameOf(ctx, owner.c)} goes back 3`)
    if (toy) ctx.fx.popup(toy, 'BOUNCED!', '#93c5fd')
    return false
  }
  const take = Math.min(4, p.b)
  p.b -= take
  owner.b += take
  p.hitT = d.clock + 1.4
  p.grudge = owner.c
  d.steps = 0
  bump(ctx, owner.c, p.c, 'Mousetrap')
  log(d, `SNAP! ${nameOf(ctx, p.c)} stepped in ${nameOf(ctx, owner.c)}'s Mousetrap (-${take})`)
  if (toy) {
    ctx.fx.popup(toy, `SNAP! -${take}`, '#fca5a5')
    ctx.fx.sfx('snip', toy.pos)
    ctx.fx.puff(toy.pos, 'stuff', 12)
    ctx.fx.shake(0.3, toy)
  }
  setPh(d, 'end')
  return true
}

/** Stats for a trick that landed (the engine's awards read these). */
function bump(ctx: LevelCtx, by: number, victim: number, _what: string) {
  const a = statsOf(ctx, by), b = statsOf(ctx, victim)
  if (a) a.menace++
  if (b) b.betrayed++
}

function win(ctx: LevelCtx, s: State, p: Seat) {
  const d = s.d
  d.winner = p.c
  d.steps = 0
  parkDice(s)
  d.dieN = 0
  const toy = toyOf(ctx, p.c)
  ctx.fx.say(`${nameOf(ctx, p.c)} reached the Cookie Jar!`, '#fde68a', 4)
  log(d, `${nameOf(ctx, p.c)} reached the Cookie Jar and wins!`)
  if (toy) {
    ctx.fx.confetti(toy.pos)
    ctx.fx.sfx('cheer', toy.pos)
  }
  setPh(d, 'over')
}

function give(ctx: LevelCtx, p: Seat, n: number, why = '') {
  const before = p.b
  p.b = Math.max(0, Math.min(999, p.b + n))
  const got = p.b - before
  const toy = toyOf(ctx, p.c)
  if (toy && got) {
    ctx.fx.popup(toy, `${got > 0 ? '+' : ''}${got} buttons${why ? ` ${why}` : ''}`, got > 0 ? '#93c5fd' : '#fca5a5')
    ctx.fx.sfx(got > 0 ? 'coin' : 'buzz', toy.pos)
  }
  return got
}

function resolveTile(ctx: LevelCtx, s: State) {
  const d = s.d
  const p = cur(d)
  const t = TILES[p.tile]
  const who = nameOf(ctx, p.c)
  const toy = toyOf(ctx, p.c)
  switch (t.kind) {
    case 'gain':
      give(ctx, p, 3)
      log(d, `${who} found 3 buttons`)
      break
    case 'lose': {
      const got = give(ctx, p, -3)
      log(d, `${who} dropped ${-got} buttons through a hole in the pocket`)
      break
    }
    case 'surprise': {
      if (!s.h.deck.length) s.h.deck = shuffle(ctx, CARDS.map((_, i) => i))
      d.card = s.h.deck.pop()!
      ctx.fx.sfx('whoosh', toy?.pos)
      setPh(d, 'card')
      return
    }
    case 'shop':
      if (p.items.length < BAG_SLOTS && ITEM_IDS.some((id) => ITEMS[id].price <= p.b)) {
        setPh(d, 'shop', SHOP_LIMIT)
        return
      }
      log(d, `${who} went window shopping`)
      break
    case 'duel': {
      if (d.players.length > 1 && d.lastDuel !== d.round) {
        setPh(d, 'pick', CHOICE_LIMIT)
        return
      }
      give(ctx, p, 2)
      log(d, `The duelling ring is busy this round: ${who} gets 2 buttons instead`)
      break
    }
    case 'trap':
      p.skip = 1
      p.hitT = d.clock + 1.2
      if (toy) ctx.fx.popup(toy, 'Stuck to the tape!', '#cbd5e1')
      log(d, `${who} is stuck to the sticky tape and will miss a turn`)
      break
    case 'splash':
      moveTo(d, p, t.to ?? START, 4, 1)
      p.hitT = d.clock + 1.4
      if (toy) {
        ctx.fx.puff(toy.pos, 'milk', 16)
        ctx.fx.sfx('splash', toy.pos)
      }
      log(d, `${who} slipped on a bottle cap: splash! Back to the bank`)
      break
    case 'ladder':
      moveTo(d, p, t.to ?? p.tile, 3, 2.1)
      log(d, `${who} climbed the popsicle ladder!`)
      ctx.fx.say('UP THE LADDER!', '#fde047', 1.4)
      break
    case 'slide':
      moveTo(d, p, t.to ?? p.tile, 3, 2.4)
      if (toy) ctx.fx.sfx('whoosh', toy.pos)
      log(d, `${who} went down the slide. Wheee!`)
      ctx.fx.say('WHEEE!', '#f472b6', 1.4)
      break
  }
  setPh(d, 'settle')
}

/** After the tile: a toy already there means a duel; otherwise the turn ends. */
function afterTile(ctx: LevelCtx, s: State) {
  const d = s.d
  const p = cur(d)
  if (p.tile === GOAL) {
    win(ctx, s, p)
    return
  }
  if (!d.duelled && p.tile !== START) {
    const others = d.players.filter((q) => q !== p && q.tile === p.tile).slice(0, 2)
    if (others.length && d.round - d.lastDuel >= 2) {
      startDuel(ctx, s, [p.c, ...others.map((o) => o.c)], false)
      return
    }
    if (others.length) {
      // Duelled recently: a cheeky bump instead (one button off each toy you land on).
      for (const o of others) give(ctx, p, -give(ctx, o, -1))
      log(d, `${nameOf(ctx, p.c)} bumped into ${others.map((o) => nameOf(ctx, o.c)).join(' and ')} and pinched a button`)
    }
  }
  setPh(d, 'end')
}

function applyCard(ctx: LevelCtx, s: State) {
  const d = s.d
  const p = cur(d)
  const card = CARDS[d.card]
  const who = nameOf(ctx, p.c)
  const toy = toyOf(ctx, p.c)
  log(d, `${who} drew ${card.title}`)
  setPh(d, 'settle')
  switch (card.id) {
    case 'penny':
      give(ctx, p, 6)
      break
    case 'lint':
      for (const q of d.players) give(ctx, q, -2)
      break
    case 'nap':
      p.skip = 1
      break
    case 'wind':
      moveTo(d, p, aheadFrom(p.tile, 3), 2, 1.1)
      break
    case 'sneeze':
      moveTo(d, p, backFrom(p.tile, 2), 4, 0.9)
      p.hitT = d.clock + 1.1
      break
    case 'party':
      for (const q of d.players) if (q !== p) give(ctx, p, -give(ctx, q, -2))
      break
    case 'gift':
      if (p.items.length < BAG_SLOTS) {
        const id = ctx.rng.pick(ITEM_IDS)
        p.items.push(id)
        if (toy) ctx.fx.popup(toy, ITEMS[id].name, '#fde68a')
      } else give(ctx, p, 3)
      break
    case 'wrap':
      p.bub = true
      break
    case 'pillow': {
      let best: Seat | null = null
      for (const q of d.players) if (q !== p && (!best || Math.abs(TILES[q.tile].dist - TILES[p.tile].dist) < Math.abs(TILES[best.tile].dist - TILES[p.tile].dist))) best = q
      if (best) {
        startDuel(ctx, s, [p.c, best.c], false)
        return
      }
      break
    }
    case 'tidy':
      d.traps.length = 0
      break
    case 'share': {
      const l = leader(d, p)
      if (l && TILES[l.tile].dist < TILES[p.tile].dist) give(ctx, p, -give(ctx, l, -3))
      else log(d, `Nobody is ahead of ${who}, so nothing happens`)
      break
    }
    case 'chairs': {
      const others = d.players.filter((q) => q !== p)
      if (others.length) swap(ctx, s, p, ctx.rng.pick(others))
      break
    }
    case 'pocket': {
      const l = leader(d, p)
      if (l && l.items.length && p.items.length < BAG_SLOTS) {
        const k = ctx.rng.int(0, l.items.length - 1)
        const [id] = l.items.splice(k, 1)
        p.items.push(id)
        log(d, `${who} pinched ${nameOf(ctx, l.c)}'s ${ITEMS[id].name}`)
      } else log(d, 'Nothing to pinch!')
      break
    }
    case 'rain':
      for (const q of d.players) give(ctx, q, 3)
      break
  }
}

function swap(ctx: LevelCtx, s: State, a: Seat, b: Seat) {
  const d = s.d
  const ta = a.tile, tb = b.tile
  moveTo(d, a, tb, 2, 1.1)
  moveTo(d, b, ta, 2, 1.1)
  log(d, `${nameOf(ctx, a.c)} and ${nameOf(ctx, b.c)} swapped places`)
}

/* ---------------- Duels and table mini-games ---------------- */

function pickLevel(ctx: LevelCtx, s: State, n: number) {
  const ok = ctx.duelLevels(n)
  if (!ok.length) return null
  let i = s.h.bag.findIndex((id) => ok.some((l) => l.id === id))
  if (i < 0) {
    s.h.bag = shuffle(ctx, ok.map((l) => l.id))
    i = 0
  }
  const id = s.h.bag.splice(i, 1)[0]
  return ok.find((l) => l.id === id) ?? ok[0]
}

function startDuel(ctx: LevelCtx, s: State, toys: number[], party: boolean) {
  const d = s.d
  const lv = pickLevel(ctx, s, toys.length)
  if (!party) {
    d.duelled = true
    d.lastDuel = d.round
  }
  if (!lv) {
    // Nothing fits (no levels registered): a coin toss.
    finishDuel(ctx, s, { levelId: '', levelName: 'a coin toss', tag: party ? 'party' : 'duel', party, toys, order: shuffle(ctx, [...toys]), winner: -1 })
    return
  }
  d.duel = { party, toys, level: lv.id, name: lv.name, sent: false }
  parkDice(s)
  d.dieN = 0
  const names = toys.map((c) => nameOf(ctx, c))
  ctx.fx.say(party ? `MINI-GAME: ${lv.name}!` : `DUEL! ${names.join(' vs ')}`, '#fb923c', 2.6)
  ctx.fx.sfx('slam')
  log(d, party ? `Everyone plays ${lv.name} for bonus buttons!` : `Duel! ${names.join(' vs ')} in ${lv.name}`)
  setPh(d, 'wait')
}

function launchDuel(ctx: LevelCtx, s: State) {
  const d = s.d
  const du = d.duel
  if (!du || du.sent) return
  du.sent = true
  const ok = ctx.startDuel({ levelId: du.level, toys: du.toys, party: du.party, seconds: du.party ? 35 : 30, tag: du.party ? 'party' : 'duel' })
  if (!ok) finishDuel(ctx, s, { levelId: du.level, levelName: du.name, tag: 'duel', party: du.party, toys: du.toys, order: shuffle(ctx, [...du.toys]), winner: -1 })
}

function finishDuel(ctx: LevelCtx, s: State, res: DuelResult) {
  const d = s.d
  d.duel = null
  const order = res.order.filter((c) => seatOf(d, c))
  if (!order.length) {
    setPh(d, 'end')
    return
  }
  if (res.party) {
    const bits = order.map((c, i) => {
      const got = give(ctx, seatOf(d, c)!, PARTY_BONUS[i] ?? 1)
      return `${nameOf(ctx, c)} +${got}`
    })
    log(d, `${nameOf(ctx, order[0])} won ${res.levelName}! ${bits.join(', ')}`)
    ctx.fx.say(`${nameOf(ctx, order[0])} wins the mini-game!`, '#fde68a', 2)
    startTurn(ctx, s)
    return
  }
  const w = seatOf(d, order[0])!
  const losers = order.slice(1).map((c) => seatOf(d, c)!).filter(Boolean)
  for (const l of losers) l.grudge = w.c
  log(d, `${nameOf(ctx, w.c)} won the duel in ${res.levelName}`)
  d.stake = { w: w.c, losers: losers.map((l) => l.c) }
  setPh(d, 'stake', CHOICE_LIMIT)
}

/** The loser a swap would trade places with (the one furthest ahead, if ahead of the winner). */
function swapTarget(d: TrailData) {
  if (!d.stake) return null
  const w = seatOf(d, d.stake.w)
  if (!w) return null
  let best: Seat | null = null
  for (const c of d.stake.losers) {
    const l = seatOf(d, c)
    if (l && TILES[l.tile].dist < TILES[w.tile].dist && (!best || TILES[l.tile].dist < TILES[best.tile].dist)) best = l
  }
  return best
}

function settleStake(ctx: LevelCtx, s: State, choice: 'buttons' | 'swap') {
  const d = s.d
  if (!d.stake) return
  const w = seatOf(d, d.stake.w)!
  const target = choice === 'swap' ? swapTarget(d) : null
  if (target) swap(ctx, s, w, target)
  else {
    let total = 0
    for (const c of d.stake.losers) {
      const l = seatOf(d, c)
      if (l) total += -give(ctx, l, -DUEL_STAKE)
    }
    give(ctx, w, total)
    log(d, `${nameOf(ctx, w.c)} takes ${total} buttons`)
  }
  d.stake = null
  setPh(d, 'end')
}

/* ---------------- Items ---------------- */

/** Where a Mousetrap may go: your own tile, or two tiles ahead of each rival. */
export function trapSpots(d: TrailData, p: Seat) {
  const out: { tile: number; label: string }[] = []
  const ok = (t: number) => t !== START && t !== GOAL && !d.traps.some(([x]) => x === t) && !out.some((o) => o.tile === t)
  if (ok(p.tile)) out.push({ tile: p.tile, label: 'Right here' })
  for (const q of d.players) {
    if (q === p) continue
    const t = aheadFrom(q.tile, 2)
    if (ok(t)) out.push({ tile: t, label: `In front of #${q.c}` })
  }
  return out
}

/** Can `p` use the item in `slot` (with `arg`) right now? true or a short reason. */
export function itemCheck(d: TrailData, p: Seat, slot: number, arg: number): true | string {
  const id = p.items[slot]
  if (!id) return 'Empty slot'
  if (d.ph !== 'pre' || cur(d) !== p) return 'Not now'
  if (d.used) return 'One trick per turn'
  const def = ITEMS[id]
  if (def.aim === 'rival') {
    const v = seatOf(d, arg)
    if (!v || v === p) return 'Pick a rival'
  }
  if (id === 'magnet') {
    const l = leader(d, p)
    if (!l || TILES[l.tile].dist >= TILES[p.tile].dist) return 'Nobody is ahead of you'
  }
  if (id === 'trap' && !trapSpots(d, p).some((o) => o.tile === arg)) return 'Pick a tile'
  if (id === 'bubble' && p.bub) return 'Already wrapped'
  if (id === 'double' && p.dbl) return 'Already armed'
  if (id === 'jack' && d.players.length < 2) return 'Nobody to jump to'
  return true
}

function applyItem(ctx: LevelCtx, s: State, p: Seat, slot: number, arg: number): true | string {
  const d = s.d
  const ok = itemCheck(d, p, slot, arg)
  if (ok !== true) return ok
  const id = p.items[slot]
  const def = ITEMS[id]
  p.items.splice(slot, 1)
  d.used = true
  const st = statsOf(ctx, p.c)
  if (st) st.tricks++
  const who = nameOf(ctx, p.c)
  const toy = toyOf(ctx, p.c)
  if (toy) ctx.fx.popup(toy, def.name, '#fde68a')
  if (id === 'hammer' || id === 'magnet') {
    const victim = id === 'hammer' ? seatOf(d, arg)! : leader(d, p)!
    attack(ctx, s, p, victim, id)
  } else if (id === 'trap') {
    d.traps.push([arg, p.c])
    log(d, `${who} set a Mousetrap on a ${TILE_INFO[TILES[arg].kind].name.toLowerCase()} tile`)
    if (toy) ctx.fx.sfx('tick', toy.pos)
  } else if (id === 'jack') {
    const others = d.players.filter((q) => q !== p)
    const to = ctx.rng.pick(others)
    moveTo(d, p, to.tile, 2, 1.2)
    log(d, `Boing! ${who}'s Jack-in-the-Box popped them over to ${nameOf(ctx, to.c)}`)
    if (toy) {
      ctx.fx.sfx('boing', toy.pos)
      ctx.fx.puff(toy.pos, 'spark', 14)
    }
  } else if (id === 'bubble') {
    p.bub = true
    log(d, `${who} wrapped up in Bubble Wrap`)
    if (toy) ctx.fx.sfx('pop', toy.pos)
  } else if (id === 'double') {
    p.dbl = true
    log(d, `${who} will roll two dice`)
  }
  return true
}

/** A trick aimed at a rival: grudges, half-price revenge (a refund), and Bubble Wrap bouncing it back. */
function attack(ctx: LevelCtx, s: State, user: Seat, victim: Seat, id: 'hammer' | 'magnet') {
  const d = s.d
  const def = ITEMS[id]
  const u = nameOf(ctx, user.c), v = nameOf(ctx, victim.c)
  const ut = toyOf(ctx, user.c), vt = toyOf(ctx, victim.c)
  if (user.grudge === victim.c) {
    const refund = Math.floor(def.price / 2)
    user.b += refund
    user.grudge = -1
    const st = statsOf(ctx, user.c)
    if (st) st.revenge++
    if (ut) ctx.fx.popup(ut, `Revenge! +${refund} back`, '#f87171')
  }
  if (victim.bub) {
    victim.bub = false
    moveTo(d, user, backFrom(user.tile, 3), 4, 0.9)
    user.hitT = d.clock + 1.2
    user.grudge = victim.c
    bump(ctx, victim.c, user.c, def.name)
    log(d, `${v}'s Bubble Wrap bounced ${u}'s ${def.name} back! ${u} goes back 3`)
    if (vt) ctx.fx.popup(vt, 'BOUNCED!', '#93c5fd')
    if (ut) ctx.fx.sfx('pop', ut.pos)
    return
  }
  if (id === 'hammer') {
    moveTo(d, victim, backFrom(victim.tile, 3), 4, 0.9)
    log(d, `${u} hammered ${v} back 3 tiles!`)
    if (vt) {
      ctx.fx.sfx('squeak', vt.pos)
      ctx.fx.puff(vt.pos, 'stuff', 12)
      ctx.fx.shake(0.35, vt)
    }
  } else {
    moveTo(d, victim, user.tile, 4, 1.1)
    log(d, `${u} reeled ${v} back with the Magnet Spool!`)
    if (vt) ctx.fx.sfx('zap', vt.pos)
  }
  victim.hitT = d.clock + 1.3
  victim.grudge = user.c
  bump(ctx, user.c, victim.c, def.name)
}

/* ---------------- Choices: players, bots and the turn timer ---------------- */

/** Who has to decide something right now (-1 nobody). */
export function decider(d: TrailData) {
  if (d.ph === 'stake') return d.stake?.w ?? -1
  if (d.ph === 'pre' || d.ph === 'fork' || d.ph === 'shop' || d.ph === 'pick') return cur(d).c
  return -1
}

function act(ctx: LevelCtx, s: State, c: number, action: string): true | string {
  const d = s.d
  if (decider(d) !== c) return 'Not your turn'
  const p = seatOf(d, c)
  if (!p) return 'Not playing'
  const [kind, a, b] = action.split(':')
  void b
  switch (kind) {
    case 'roll':
      if (d.ph !== 'pre') return 'Not now'
      roll(ctx, s)
      return true
    case 'item':
      return applyItem(ctx, s, p, Number(a), Number(b ?? -1))
    case 'fork': {
      const k = Number(a)
      if (d.ph !== 'fork' || !(k >= 0 && k < TILES[p.tile].next.length)) return 'Pick a way'
      d.fork = k
      d.go = d.clock
      setPh(d, 'move')
      return true
    }
    case 'buy': {
      const id = a as ItemId
      const def = ITEMS[id]
      if (d.ph !== 'shop' || !def) return 'Not now'
      if (p.items.length >= BAG_SLOTS) return 'Bag is full'
      if (p.b < def.price) return 'Not enough buttons'
      p.b -= def.price
      p.items.push(id)
      log(d, `${nameOf(ctx, c)} bought a ${def.name}`)
      const toy = toyOf(ctx, c)
      if (toy) ctx.fx.sfx('coin', toy.pos)
      if (p.items.length >= BAG_SLOTS || !ITEM_IDS.some((x) => ITEMS[x].price <= p.b)) setPh(d, 'settle')
      return true
    }
    case 'done':
      if (d.ph !== 'shop') return 'Not now'
      setPh(d, 'settle')
      return true
    case 'pick': {
      const v = seatOf(d, Number(a))
      if (d.ph !== 'pick' || !v || v === p) return 'Pick a rival'
      startDuel(ctx, s, [p.c, v.c], false)
      return true
    }
    case 'stake':
      if (d.ph !== 'stake') return 'Not now'
      settleStake(ctx, s, a === 'swap' ? 'swap' : 'buttons')
      return true
  }
  return 'Unknown'
}

/** A bot's (or a timed-out player's) choice, sensible by difficulty. */
function auto(ctx: LevelCtx, s: State, c: number, timedOut: boolean) {
  const d = s.d
  const p = seatOf(d, c)
  if (!p) return
  const sk = skill(ctx)
  const smart = timedOut ? 0.5 : sk.accuracy
  const mine = TILES[p.tile].dist
  const lead = leader(d, p)
  switch (d.ph) {
    case 'pre': {
      if (!timedOut && !d.used && p.items.length && ctx.rng.chance([0.45, 0.7, 0.9][Math.max(0, Math.min(2, ctx.difficulty))])) {
        const plan = botItem(ctx, d, p, smart)
        if (plan && applyItem(ctx, s, p, plan.slot, plan.arg) === true) return
      }
      act(ctx, s, c, 'roll')
      return
    }
    case 'fork': {
      const t = TILES[p.tile]
      let k = 0
      // Short way usually; the long way when short of buttons (it has a shop) or by mistake.
      const dists = t.next.map((n) => TILES[n].dist)
      k = dists.indexOf(Math.min(...dists))
      if (!ctx.rng.chance(smart) || (p.b >= 10 && p.items.length < 2 && ctx.rng.chance(0.3))) k = ctx.rng.int(0, t.next.length - 1)
      act(ctx, s, c, `fork:${k}`)
      return
    }
    case 'shop': {
      if (timedOut) {
        act(ctx, s, c, 'done')
        return
      }
      const want: Record<ItemId, number> = { hammer: 3, trap: 2, magnet: lead && TILES[lead.tile].dist < mine - 3 ? 3 : 1, bubble: 2, double: mine > 10 ? 3 : 1, jack: lead && TILES[lead.tile].dist < mine - 5 ? 2 : 1 }
      const opts = ITEM_IDS.filter((id) => p.items.length < BAG_SLOTS && p.b >= ITEMS[id].price && !p.items.includes(id))
      // Keep a button or two back, and stop after two buys sometimes.
      if (opts.length && (p.items.length < 2 || ctx.rng.chance(0.5))) {
        let total = 0
        for (const id of opts) total += want[id]
        let r = ctx.rng.range(0, total)
        for (const id of opts) {
          r -= want[id]
          if (r <= 0) {
            act(ctx, s, c, `buy:${id}`)
            return
          }
        }
      }
      act(ctx, s, c, 'done')
      return
    }
    case 'pick': {
      const rivals = d.players.filter((q) => q !== p)
      const g = rivals.find((q) => q.c === p.grudge)
      const v = ctx.rng.chance(smart) ? (g ?? lead ?? rivals[0]) : ctx.rng.pick(rivals)
      act(ctx, s, c, `pick:${v.c}`)
      return
    }
    case 'stake': {
      const t = swapTarget(d)
      act(ctx, s, c, t && mine - TILES[t.tile].dist >= 4 ? 'stake:swap' : 'stake:buttons')
      return
    }
  }
}

/** Which item a bot would use now, and on what. */
function botItem(ctx: LevelCtx, d: TrailData, p: Seat, smart: number): { slot: number; arg: number } | null {
  const mine = TILES[p.tile].dist
  const lead = leader(d, p)
  const leadGap = lead ? mine - TILES[lead.tile].dist : 0
  const order = p.items.map((id, slot) => ({ id, slot }))
  for (const { id, slot } of order) {
    let arg = -1
    if (id === 'hammer') {
      const rivals = d.players.filter((q) => q !== p)
      const g = rivals.find((q) => q.c === p.grudge)
      const t = ctx.rng.chance(smart) ? (g && TILES[g.tile].dist <= mine + 2 ? g : lead) : ctx.rng.pick(rivals)
      if (!t) continue
      arg = t.c
    } else if (id === 'magnet') {
      if (leadGap < 4) continue
    } else if (id === 'trap') {
      // In front of whoever leads (or anyone, for a sloppy bot).
      const spots = trapSpots(d, p)
      const target = lead && leadGap > 0 ? lead : d.players.find((q) => q !== p && TILES[q.tile].dist < mine + 3)
      const lab = target ? `In front of #${target.c}` : ''
      const spot = (ctx.rng.chance(smart) && spots.find((o) => o.label === lab)) || spots[spots.length - 1]
      if (!spot) continue
      arg = spot.tile
    } else if (id === 'jack') {
      if (leadGap < 4 && ctx.rng.chance(smart)) continue
    } else if (id === 'double') {
      if (mine < 4) continue
    } else if (id === 'bubble') {
      if (p.bub) continue
    }
    if (itemCheck(d, p, slot, arg) === true) return { slot, arg }
  }
  return null
}

/* ---------------- Per-tick placement (seats, poses, tags) ---------------- */

function placeToys(ctx: LevelCtx, s: State, host: boolean) {
  const d = s.d
  for (const p of d.players) {
    const toy = toyOf(ctx, p.c)
    if (!toy) continue
    if (host) {
      const yaw = posOf(d, p, _v)
      toy.seat = { x: _v.x, y: _v.y + FOOT, z: _v.z, yaw }
      toy.yaw = yaw
      toy.grudge = p.grudge >= 0 ? toyOf(ctx, p.grudge) : null
      toy.bubble = p.bub
    }
    toy.pose = poseOf(d, p)
  }
}

/* ---------------- HUD data ---------------- */

export interface TrailHud {
  phase: Phase
  round: number
  partyIn: number
  turn: { c: number; name: string; tint: string }
  myTurn: boolean
  deciding: boolean
  me: number
  timer: number | null
  dice: number[]
  steps: number
  players: { c: number; name: string; tint: string; kind: string; human: boolean; bot: boolean; me: boolean; b: number; items: ItemId[]; tile: number; dist: number; bub: boolean; skip: number; grudge: string | null; active: boolean; dbl: boolean }[]
  card: { title: string; text: string } | null
  duel: { party: boolean; names: string[]; level: string } | null
  stake: { winner: string; swapWith: string | null; amount: number } | null
  fork: string[] | null
  trapSpots: { tile: number; label: string }[]
  items: { slot: number; id: ItemId; name: string; aim: string; desc: string; ok: true | string; leader: string | null }[]
  rivals: { c: number; name: string; grudge: boolean }[]
  used: boolean
  log: [number, string][]
  traps: [number, number][]
  winner: string | null
  goal: number
}

function trailHud(ctx: LevelCtx, s: State, me: Toy | null): TrailHud {
  const d = s.d
  const p = cur(d)
  const myC = me ? me.c.idx : -1
  const mySeat = seatOf(d, myC)
  const tint = (c: number) => {
    const t = toyOf(ctx, c)?.c.tint ?? '#fde68a'
    return t === '#ffffff' ? '#fde68a' : t
  }
  const lead = mySeat ? leader(d, mySeat) : null
  const spots = mySeat ? trapSpots(d, mySeat).map((o) => ({ tile: o.tile, label: o.label.replace(/#(\d+)/, (_m, c) => nameOf(ctx, Number(c))) })) : []
  const w = d.stake ? seatOf(d, d.stake.w) : null
  const sw = swapTarget(d)
  return {
    phase: d.ph,
    round: d.round,
    partyIn: PARTY_EVERY - ((d.round - 1) % PARTY_EVERY),
    turn: { c: p.c, name: nameOf(ctx, p.c), tint: tint(p.c) },
    myTurn: p.c === myC,
    deciding: decider(d) === myC && myC >= 0,
    me: myC,
    timer: d.lim ? Math.max(0, d.lim - (d.clock - d.pt)) : null,
    dice: d.dieN ? d.dice.slice(0, d.dieN) : [],
    steps: d.steps,
    players: d.players.map((q) => {
      const t = toyOf(ctx, q.c)
      return {
        c: q.c, name: nameOf(ctx, q.c), tint: tint(q.c), kind: t?.c.kind ?? 'sock', human: !!t?.c.human, bot: !!t && (!t.c.human || t.bot), me: q.c === myC, b: q.b, items: q.items, tile: q.tile,
        dist: TILES[q.tile].dist, bub: q.bub, skip: q.skip, grudge: q.grudge >= 0 ? nameOf(ctx, q.grudge) : null, active: q === p, dbl: q.dbl,
      }
    }),
    card: d.ph === 'card' && d.card >= 0 ? { title: CARDS[d.card].title, text: CARDS[d.card].text } : null,
    duel: d.duel ? { party: d.duel.party, names: d.duel.toys.map((c) => nameOf(ctx, c)), level: d.duel.name } : null,
    stake: d.stake && w ? { winner: nameOf(ctx, w.c), swapWith: sw ? nameOf(ctx, sw.c) : null, amount: DUEL_STAKE } : null,
    fork: d.ph === 'fork' ? (FORKS.find((f) => f.tile === p.tile)?.labels ?? TILES[p.tile].next.map((_, i) => `Way ${i + 1}`)) : null,
    trapSpots: spots,
    items: mySeat
      ? mySeat.items.map((id, slot) => ({
          slot, id, name: ITEMS[id].name, aim: ITEMS[id].aim, desc: ITEMS[id].desc, ok: itemCheck(d, mySeat, slot, ITEMS[id].aim === 'tile' ? (spots[0]?.tile ?? -1) : ITEMS[id].aim === 'rival' ? (d.players.find((q) => q !== mySeat)?.c ?? -1) : -1),
          leader: lead ? nameOf(ctx, lead.c) : null,
        }))
      : [],
    rivals: d.players.filter((q) => q.c !== myC).map((q) => ({ c: q.c, name: nameOf(ctx, q.c), grudge: !!mySeat && mySeat.grudge === q.c })),
    used: d.used,
    log: d.log,
    traps: d.traps,
    winner: d.winner >= 0 ? nameOf(ctx, d.winner) : null,
    goal: GOAL,
  }
}

/** This screen's camera: the active toy and the dice, or the whole board. */
export function setOverview(state: unknown, on: boolean) {
  const s = state as State | null
  if (s?.v) s.v.overview = on
}

/* ---------------- The level ---------------- */

export default defineLevel<State>({
  id: 'toy-box-trail',
  name: 'Toy Box Trail',
  type: 'hidden',
  blurb: 'A board game across the attic floor: roll the foam die, hop the cards, and be first to the cookie jar.',
  howTo: [
    'Roll the big foam die (Space) and hop along the cards',
    'Shops sell tricks: hammer, mousetrap, jack-in-the-box and more',
    'Land on a toy (or a duel tile) for a 30-second duel',
    'Every third round the whole table plays a mini-game',
  ],
  accent: '#f59e0b',
  players: [2, 6],
  duration: 1e9,
  bodyMode: 'seated',
  pointer: 'free',
  duel: false,
  introOrbit: { radius: 12, height: 13, center: [0, 0, 1] },

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 17, hd: 15, ridge: 20, knee: 5, lights: ctx.quality === 'low' ? 40 : 70, quality: ctx.quality })
  },

  init(ctx) {
    const sess = ctx.session as { trail?: TrailData; trailHost?: HostData }
    // Rebuilt after a duel: the game carries on from the session.
    const d = sess.trail && sess.trail.players.length === ctx.toys.length ? sess.trail : (sess.trail = fresh(ctx))
    const h = sess.trailHost ?? (sess.trailHost = { deck: [], bag: [], still: [0, 0] })
    return { d, h, v: buildBoard(ctx), ended: false }
  },

  spawn(_ctx, s, toy) {
    const p = seatOf(s.d, toy.c.idx)
    if (!p) return { x: 0, y: 0, z: 0, yaw: Math.PI }
    const yaw = posOf(s.d, p, _v)
    return { x: _v.x, y: _v.y, z: _v.z, yaw }
  },

  setup(ctx, s) {
    placeToys(ctx, s, ctx.isHost)
  },

  start(ctx, s) {
    if (s.d.ph === 'start' && s.d.clock === 0) {
      log(s.d, 'Welcome to Toy Box Trail! First toy to the cookie jar wins.')
      startTurn(ctx, s)
    }
  },

  tick(ctx, s, dt) {
    const d = s.d
    d.clock += dt
    const el = d.clock - d.pt
    const p = cur(d)
    switch (d.ph) {
      case 'start':
        if (el > 1.1) {
          if (p.skip > 0) {
            p.skip--
            log(d, `${nameOf(ctx, p.c)} is stuck and misses this turn`)
            setPh(d, 'end')
          } else setPh(d, 'pre', TURN_LIMIT)
        }
        break
      case 'roll':
        diceTick(ctx, s, dt)
        break
      case 'move':
        moveTick(ctx, s)
        break
      case 'tile':
        if (el > 0.45 && !moving(d, p)) resolveTile(ctx, s)
        break
      case 'settle':
        if (el > 0.55 && !anyMoving(d)) afterTile(ctx, s)
        break
      case 'card':
        if (el > 2.7) applyCard(ctx, s)
        break
      case 'wait':
        if (el > 2.8) launchDuel(ctx, s)
        break
      case 'end':
        if (el > 0.6 && !anyMoving(d)) nextTurn(ctx, s)
        break
      case 'over':
        if (el > 5 && !s.ended) {
          s.ended = true
          ctx.end()
        }
        break
    }
    // The turn timer: a player who doesn't decide in time gets a sensible default.
    if (d.lim && d.clock - d.pt > d.lim) {
      const c = decider(d)
      if (c >= 0) auto(ctx, s, c, true)
    }
    placeToys(ctx, s, true)
  },

  bot(ctx, s, toy) {
    const d = s.d
    if (decider(d) !== toy.c.idx) return
    // A moment to "think" so people can follow what the bot does.
    const think = d.ph === 'pre' ? 0.9 : 0.8
    if (d.clock - d.pt < think) return
    // One decision per think window (buying in the shop takes several).
    const memo = toy.data as { at?: number }
    if (memo.at !== undefined && d.clock - memo.at < 0.7) return
    memo.at = d.clock
    auto(ctx, s, toy.c.idx, false)
  },

  onAction(ctx, s, _toy, action, contestant) {
    const res = act(ctx, s, contestant, action)
    if (res !== true) {
      const t = toyOf(ctx, contestant)
      if (t) ctx.fx.say(res, '#fca5a5', 1, t)
    }
  },

  onDuelEnd(ctx, s, res) {
    finishDuel(ctx, s, res)
  },

  results(ctx, s) {
    const d = s.d
    const rest = d.players.filter((p) => p.c !== d.winner).sort((a, b) => TILES[a.tile].dist - TILES[b.tile].dist || b.b - a.b)
    const order = [...(d.winner >= 0 ? [d.winner] : []), ...rest.map((p) => p.c)]
    const buttons: Record<number, number> = {}
    for (const p of d.players) buttons[p.c] = Math.floor(p.b / 2)
    void ctx
    return { order, buttons, title: 'Toy Box Trail', crown: { title: 'Cookie Champion', blurb: 'First to the cookie jar' } }
  },

  pack(_ctx, s) {
    return s.d
  },

  unpack(_ctx, s, data) {
    Object.assign(s.d, data as TrailData)
  },

  visual(ctx, s, dt) {
    const d = s.d
    const v = s.v
    if (!ctx.isHost) placeToys(ctx, s, false)
    // Dice and their numbers.
    v.dice.forEach((die, k) => {
      const on = k < d.dieN
      die.obj.visible = on
      for (const n of die.nums) if (n) n.visible = false
      if (on && d.dice[k] > 0) {
        const sp = dieNumber(v, k, d.dice[k])
        sp.visible = true
        sp.position.copy(die.obj.position)
        sp.position.y += 1.05
      }
    })
    // Mousetraps.
    v.traps.forEach((m, i) => {
      const tr = d.traps[i]
      m.visible = !!tr
      if (tr) {
        const t = TILES[tr[0]]
        m.position.set(t.x + 0.32, t.y, t.z - 0.42)
        m.rotation.y = t.yaw
      }
    })
    // Whose turn: a ring under them and a bobbing gem overhead.
    const p = cur(d)
    const toy = toyOf(ctx, p.c)
    const show = d.ph !== 'over' && d.ph !== 'wait' && !!toy
    v.ring.visible = v.marker.visible = show
    const time = d.clock
    if (show && toy) {
      v.ring.position.set(toy.pos.x, toy.pos.y - FOOT + 0.06, toy.pos.z)
      const k = 1 + Math.sin(time * 4) * 0.06
      v.ring.scale.set(k, 1, k)
      v.marker.position.set(toy.pos.x, toy.pos.y - FOOT + 1.75 + Math.sin(time * 3) * 0.1, toy.pos.z)
      v.marker.rotation.y += dt * 2.5
      ;(v.ring.material as THREE.MeshBasicMaterial).color.set(toy.c.tint === '#ffffff' ? '#fde68a' : toy.c.tint)
    }
    for (const a of v.forkArrows) {
      a.visible = d.ph === 'fork' && p.tile === a.userData.fork
      if (a.visible) a.position.y = 1.7 + Math.sin(time * 4 + (a.userData.k as number)) * 0.15
    }
    ;(v.jarGlow.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(time * 2) * 0.2
    v.top.rotation.y += dt * 6
  },

  cameraUpdate(ctx, s, cam, dt) {
    const d = s.d
    const v = s.v
    if (v.overview) {
      _v.set(0, 17, -13.5)
      _w.set(0, 0, 1.2)
      cam.place(_v, _w, dt, 3)
      cam.focus.copy(_w)
      return true
    }
    let n = 0
    _w.set(0, 0, 0)
    const add = (x: number, z: number, wgt = 1) => {
      _w.x += x * wgt
      _w.z += z * wgt
      n += wgt
    }
    if (d.ph === 'wait' && d.duel) {
      for (const c of d.duel.toys) {
        const t = toyOf(ctx, c)
        if (t) add(t.pos.x, t.pos.z)
      }
    } else {
      const c = d.ph === 'over' ? d.winner : d.ph === 'stake' && d.stake ? d.stake.w : cur(d).c
      const t = toyOf(ctx, c)
      if (t) add(t.pos.x, t.pos.z, 2)
      if (d.dieN && (d.ph === 'roll' || d.ph === 'move')) for (let k = 0; k < d.dieN; k++) add(v.dice[k].obj.position.x, v.dice[k].obj.position.z)
    }
    if (n) _w.multiplyScalar(1 / n)
    _w.y = 0.7
    const near = d.ph === 'over' ? 0.7 : 1
    _v.set(_w.x * 0.85, 1 + 6.2 * near, _w.z - 6.6 * near)
    cam.place(_v, _w, dt, 2.6)
    cam.focus.copy(_w)
    return true
  },

  hud(ctx, s, me) {
    return { extra: trailHud(ctx, s, me) }
  },
})
