// The match simulation: a pure, deterministic, top-down arena on a 2 m grid. No three.js, no DOM, so it runs the
// same on the host, in the Node tests and in the `?snap` hook. The view reads snapshots (`buildSnap`) and the
// one-shot `events` list; online clients receive exactly the same two things.
//
// On top of guns, supers and the dash every hero has a signature power, and powers counter each other through the
// tag rules in powers.ts: heat melts shields and gadgets, reveals strip cloaks and decoys, knockback breaks
// channels and charges, cleanses remove poison, slows and marks, scorch blocks healing, walls stop direct fire.
// Each counter that lands emits a `counter` event for the popup, VFX and sound.
import { DASH, HEROES, SUPER, type Hero, type HeroId } from './heroes.ts'
import { CELL, MAPS, cellKind, type CellKind, type MapDef, type MapId } from './maps.ts'
import {
  CLEANSABLE,
  POWER,
  POWERS,
  POWERUP,
  POWERUPS,
  POWERUP_KINDS,
  STATUS_INFO,
  STATUS_KINDS,
  padKind,
  statusHas,
  type CounterId,
  type PowerKind,
  type PowerUpKind,
  type StatusKind,
} from './powers.ts'
import { Rng } from './rng.ts'
import { thinkBot, type BotState } from './bots.ts'

export type ModeId = 'tdm' | 'capture' | 'br'

export const MODE_INFO: Record<ModeId, { name: string; blurb: string; team: boolean }> = {
  tdm: { name: 'Team Takedown', blurb: '3v3. First squad to 20 takedowns wins.', team: true },
  capture: { name: 'Core Control', blurb: '3v3. Hold the centre core to score. First to 60.', team: true },
  br: { name: 'Grid Royale', blurb: 'Solo. 17 fighters, one shrinking grid, loot crates. Last one standing.', team: false },
}

export interface GearMods {
  hp: number
  speed: number
  dmg: number
  charge: number
}
export const NO_GEAR: GearMods = { hp: 1, speed: 1, dmg: 1, charge: 1 }

export interface RosterEntry {
  name: string
  hero: HeroId
  team: number
  human: boolean
  /** Peer id for online humans ('host' for the host). */
  peer?: string
  gear?: GearMods
  skin?: string
}

export interface Input {
  mx: number
  mz: number
  ax: number
  az: number
  /** Metres to the aim point (grenade lob distance). */
  aimDist: number
  fire: boolean
  dash: boolean
  super: boolean
  power: boolean
}

export const NO_INPUT: Input = { mx: 0, mz: 0, ax: 1, az: 0, aimDist: 6, fire: false, dash: false, super: false, power: false }

export const FIGHTER_R = 0.45

export interface Status {
  kind: StatusKind
  until: number
  /** Fighter that applied it (damage credit for poison and scorch). */
  src: number
  /** Damage per second, speed multiplier or damage-taken multiplier, by kind. */
  mag: number
}

export interface Fighter {
  id: number
  name: string
  hero: Hero
  team: number
  human: boolean
  peer?: string
  skin: string
  gear: GearMods
  x: number
  z: number
  vx: number
  vz: number
  aim: number
  hp: number
  maxHp: number
  alive: boolean
  /** Eliminated for good (battle royale). */
  out: boolean
  respawnAt: number
  speed: number
  dmgMul: number
  super: number
  superUntil: number
  shield: number
  shieldUntil: number
  cloakUntil: number
  dashUntil: number
  dashCd: number
  dashDx: number
  dashDz: number
  fireCd: number
  burst: number
  burstAt: number
  lastHurtAt: number
  lastHitBy: number
  spawnShieldUntil: number
  knockX: number
  knockZ: number
  kills: number
  deaths: number
  damage: number
  healing: number
  supersUsed: number
  placement: number
  input: Input
  bot: BotState | null
  rammed: Set<number>
  /** Pickups applied this match (battle royale). */
  loot: number
  /** Signature power cooldown left (s). */
  powerCd: number
  /** Heat Vent wind-up end (0 = not channelling). */
  channelUntil: number
  statuses: Status[]
  powersUsed: number
  /** Counter rules this fighter landed on someone. */
  counters: number
  /** Coins from shards collected this match. */
  coins: number
  /** Poison / scorch damage waiting to be shown as one number. */
  dotAcc: number
  dotAt: number
  /** Rate limit for repeated heal-blocked / immune popups. */
  noticeAt: number
  /** Riot Wall carried until (Rook). */
  wallUntil: number
}

export type ProjKind = 'bullet' | 'pellet' | 'rail' | 'grenade' | 'flame' | 'needle' | 'turret' | 'dart' | 'toxin'

export interface Projectile {
  id: number
  kind: ProjKind
  owner: number
  team: number
  x: number
  z: number
  y: number
  vx: number
  vz: number
  vy: number
  ttl: number
  dmg: number
  splash: number
  /** Ricochet Rounds: wall bounces left. */
  bounces: number
}

export type DeployKind = 'turret' | 'mine' | 'heal' | 'wall' | 'decoy' | 'gas'

export interface Deployable {
  id: number
  kind: DeployKind
  owner: number
  team: number
  x: number
  z: number
  hp: number
  maxHp: number
  until: number
  armAt: number
  fireCd: number
  /** Facing (turrets, walls: the wall's normal, decoys). */
  aim: number
  vx: number
  vz: number
  /** Decoy already drew fire / wall already blocked something (their popups fire once). */
  lured: boolean
}

export interface Crate {
  id: number
  cx: number
  cz: number
  hp: number
  loot: boolean
}

export type LootKind = 'medkit' | 'plating' | 'overclock' | 'servo' | 'cell' | 'shard'

export interface Pickup {
  id: number
  x: number
  z: number
  kind: LootKind
  /** Shards fade after a while; crate loot stays. */
  until: number
}

export interface Pad {
  id: number
  x: number
  z: number
  slot: number
  centre: boolean
  spawns: number
  kind: PowerUpKind
  readyAt: number
}

export type ExplodeKind = 'grenade' | 'mine' | 'pulse' | 'crate' | 'vent' | 'reveal' | 'purge' | 'toxin'

export type SimEvent =
  | { t: 'shot'; id: number; x: number; z: number; aim: number; kind: ProjKind }
  | { t: 'hit'; x: number; z: number; dmg: number; target: number; heal?: boolean; dot?: boolean }
  | { t: 'death'; id: number; x: number; z: number; killer: number }
  | { t: 'explode'; x: number; z: number; r: number; kind: ExplodeKind }
  | { t: 'super'; id: number; hero: HeroId; x: number; z: number }
  | { t: 'power'; id: number; kind: PowerKind; x: number; z: number; aim: number; tx: number; tz: number }
  | { t: 'counter'; rule: CounterId; x: number; z: number; by: number; target: number }
  | { t: 'powerup'; id: number; kind: PowerUpKind; x: number; z: number }
  | { t: 'revive'; id: number }
  | { t: 'dash'; id: number }
  | { t: 'respawn'; id: number }
  | { t: 'pickup'; id: number; kind: LootKind }
  | { t: 'score'; team: number; score: number }
  | { t: 'grid'; stage: number }
  | { t: 'start' }
  | { t: 'end'; winner: number }

export interface BrGrid {
  cx: number
  cz: number
  half: number
  nextCx: number
  nextCz: number
  nextHalf: number
  /** Match time the next shrink starts / ends. */
  shrinkAt: number
  shrinkEnd: number
  fromCx: number
  fromCz: number
  fromHalf: number
  stage: number
  dps: number
}

export interface SimOptions {
  map: MapId
  mode: ModeId
  seed: number
  roster: RosterEntry[]
  /** Kills (Takedown) or points (Core Control) to win. */
  target?: number
  /** Seconds. */
  timeLimit?: number
  /** Bot skill 0..1. */
  difficulty?: number
  /** Turn the power-up pads off (balance tests of the bare kits). */
  noPads?: boolean
}

/** Snapshot: what the view (and online clients) draw. Numbers only so it serialises cheaply. */
export interface Snap {
  t: number
  /**
   * [id, x, z, aim, hp, maxHp, flags, super, vx, vz, shield, statusMask, powerCd, dashCd, coins] — flags: alive 1,
   * cloak 2, shield 4, superOn 8, dash 16, spawnShield 32, out 64, channel 128; statusMask: bit i = STATUS_KINDS[i].
   */
  f: number[][]
  /** [id, kindIdx, x, z, y, vx, vz, ownerId] */
  p: number[][]
  /** [id, kindIdx, x, z, hp, aim, armed, team, owner, vx, vz] */
  d: number[][]
  /** Crate hp per crate index (0 = gone). */
  c: number[]
  /** [id, x, z, kindIdx] */
  k: number[][]
  /** Power-up pads: [id, x, z, kindIdx, secondsUntilReady (0 = ready)] */
  pd: number[][]
  /** Status timers, flat triples: fighterId, statusIdx, secondsLeft. */
  bt: number[]
  s: [number, number]
  /** 0 countdown, 1 play, 2 over */
  ph: number
  cd: number
  w: number
  /** [cx, cz, half, nextCx, nextCz, nextHalf, shrinkAt, stage, alive] */
  br: number[] | null
}

export const PROJ_KINDS: ProjKind[] = ['bullet', 'pellet', 'rail', 'grenade', 'flame', 'needle', 'turret', 'dart', 'toxin']
export const DEPLOY_KINDS: DeployKind[] = ['turret', 'mine', 'heal', 'wall', 'decoy', 'gas']
export const LOOT_KINDS: LootKind[] = ['medkit', 'plating', 'overclock', 'servo', 'cell', 'shard']
const CRATE_LOOT: LootKind[] = ['medkit', 'plating', 'overclock', 'servo', 'cell']

const GRAVITY = 18
const REGEN_DELAY = 5
const REGEN_RATE = 0.07
const RESPAWN = 3.5
const TEAM_SPAWN_SHIELD = 2
const BR_FIRST_SHRINK = 22
const BR_SHRINK_TIME = 10
const BR_HOLD = 14
const SHARD_LIFE = 20

export class Sim {
  readonly opts: SimOptions
  readonly map: MapDef
  readonly mode: ModeId
  readonly w: number
  readonly h: number
  /** Cell kinds; crates flip to floor when destroyed. */
  readonly cells: CellKind[]
  readonly chars: string[]
  readonly rng: Rng
  readonly fighters: Fighter[] = []
  projectiles: Projectile[] = []
  deployables: Deployable[] = []
  readonly crates: Crate[] = []
  pickups: Pickup[] = []
  readonly pads: Pad[] = []
  events: SimEvent[] = []
  time = 0
  phase: 'countdown' | 'play' | 'over' = 'countdown'
  countdown = 3
  score: [number, number] = [0, 0]
  winner = -1
  readonly target: number
  readonly timeLimit: number
  readonly difficulty: number
  br: BrGrid | null = null
  objective = { x: 0, z: 0 }
  private spawnsA: { x: number; z: number }[] = []
  private spawnsB: { x: number; z: number }[] = []
  private spawnsSolo: { x: number; z: number }[] = []
  private nextId = 1
  private zoneTick = 0
  private placementsLeft = 0

  constructor(opts: SimOptions) {
    this.opts = opts
    this.map = MAPS[opts.map]
    this.mode = opts.mode
    this.w = this.map.w
    this.h = this.map.h
    this.rng = new Rng(opts.seed)
    this.target = opts.target ?? (opts.mode === 'capture' ? 60 : 20)
    this.timeLimit = opts.timeLimit ?? (opts.mode === 'br' ? 320 : 180)
    this.difficulty = opts.difficulty ?? 0.65
    this.cells = new Array(this.w * this.h)
    this.chars = new Array(this.w * this.h)
    for (let cz = 0; cz < this.h; cz++)
      for (let cx = 0; cx < this.w; cx++) {
        const ch = this.map.rows[cz]?.[cx] ?? '#'
        const i = cz * this.w + cx
        this.chars[i] = ch
        this.cells[i] = cellKind(ch)
        const p = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL }
        if (ch === 'A') this.spawnsA.push(p)
        if (ch === 'B') this.spawnsB.push(p)
        if (ch === 'S') this.spawnsSolo.push(p)
        if (ch === '*') this.objective = p
        if (this.cells[i] === 'crate') this.crates.push({ id: this.nextId++, cx, cz, hp: ch === '$' ? 220 : 320, loot: ch === '$' })
      }
    if (this.mode === 'br') {
      // Extra crates from the seed so no two matches are quite alike (never on a power-up pad).
      for (let n = 0; n < 14; n++) {
        const cx = 2 + this.rng.int(this.w - 4)
        const cz = 2 + this.rng.int(this.h - 4)
        const i = cz * this.w + cx
        if (this.cells[i] !== 'floor' || this.chars[i] !== '.') continue
        if (this.map.pads.some((p) => Math.floor(p.x / CELL) === cx && Math.floor(p.z / CELL) === cz)) continue
        this.cells[i] = 'crate'
        this.chars[i] = 'x'
        this.crates.push({ id: this.nextId++, cx, cz, hp: 320, loot: n < 6 })
      }
      const half = (this.w * CELL) / 2
      this.br = { cx: half, cz: half, half, nextCx: half, nextCz: half, nextHalf: half, shrinkAt: BR_FIRST_SHRINK, shrinkEnd: BR_FIRST_SHRINK + BR_SHRINK_TIME, fromCx: half, fromCz: half, fromHalf: half, stage: 0, dps: 40 }
      this.planShrink()
    }
    const soloOrder = [...this.spawnsSolo]
    for (const r of opts.roster) {
      const f = this.addFighter(r)
      if (this.mode === 'br') {
        const s = soloOrder.length ? soloOrder.splice(this.rng.int(soloOrder.length), 1)[0] : this.randomFloor()
        f.x = s.x
        f.z = s.z
      } else this.placeAtTeamSpawn(f)
    }
    this.placementsLeft = this.fighters.length
    if (!opts.noPads)
      for (const spot of this.map.pads) {
        if (this.cellAt(spot.x, spot.z) !== 'floor') continue
        this.pads.push({ id: this.nextId++, x: spot.x, z: spot.z, slot: spot.slot, centre: spot.centre, spawns: 0, kind: padKind(spot.slot, 0, this.mode === 'br', spot.centre), readyAt: spot.centre ? POWERUP.centreFirst : POWERUP.firstSpawn })
      }
  }

  /* ---------- Setup ---------- */

  private newBot(): BotState {
    return { target: 0, decoy: 0, path: [], pathAt: -9, thinkAt: 0, mode: 'roam', goalX: 0, goalZ: 0, strafe: 1, strafeAt: 0, seenAt: -9, seenX: 0, seenZ: 0, jitter: this.rng.next(), powerAt: 0 }
  }

  private addFighter(r: RosterEntry) {
    const hero = HEROES[r.hero]
    const gear = r.gear ?? NO_GEAR
    const maxHp = Math.round(hero.hp * gear.hp)
    const f: Fighter = {
      id: this.nextId++,
      name: r.name,
      hero,
      team: r.team,
      human: r.human,
      peer: r.peer,
      skin: r.skin ?? 'default',
      gear,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      aim: 0,
      hp: maxHp,
      maxHp,
      alive: true,
      out: false,
      respawnAt: 0,
      speed: hero.speed * gear.speed,
      dmgMul: gear.dmg,
      super: 0,
      superUntil: 0,
      shield: 0,
      shieldUntil: 0,
      cloakUntil: 0,
      dashUntil: 0,
      dashCd: 0,
      dashDx: 0,
      dashDz: 0,
      fireCd: 0,
      burst: 0,
      burstAt: 0,
      lastHurtAt: -99,
      lastHitBy: 0,
      spawnShieldUntil: 0,
      knockX: 0,
      knockZ: 0,
      kills: 0,
      deaths: 0,
      damage: 0,
      healing: 0,
      supersUsed: 0,
      placement: 0,
      input: { ...NO_INPUT },
      bot: r.human ? null : this.newBot(),
      rammed: new Set(),
      loot: 0,
      powerCd: 2,
      channelUntil: 0,
      statuses: [],
      powersUsed: 0,
      counters: 0,
      coins: 0,
      dotAcc: 0,
      dotAt: 0,
      noticeAt: -9,
      wallUntil: 0,
    }
    this.fighters.push(f)
    return f
  }

  private randomFloor() {
    for (let n = 0; n < 200; n++) {
      const cx = this.rng.int(this.w)
      const cz = this.rng.int(this.h)
      if (this.cells[cz * this.w + cx] === 'floor') return { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL }
    }
    return { x: (this.w * CELL) / 2, z: (this.h * CELL) / 2 }
  }

  /** Team spawn farthest from living enemies. */
  private placeAtTeamSpawn(f: Fighter) {
    const spawns = f.team === 0 ? this.spawnsA : this.spawnsB
    let best = spawns[0] ?? this.randomFloor()
    let bestScore = -1
    for (const s of spawns) {
      let d = 1e9
      for (const o of this.fighters) if (o !== f && o.alive && o.team !== f.team) d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z))
      for (const o of this.fighters) if (o !== f && o.alive && o.team === f.team && Math.hypot(o.x - s.x, o.z - s.z) < 1) d -= 50
      d += this.rng.next()
      if (d > bestScore) {
        bestScore = d
        best = s
      }
    }
    f.x = best.x
    f.z = best.z
  }

  /* ---------- Grid helpers ---------- */

  cellAt(x: number, z: number): CellKind {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return 'wall'
    return this.cells[cz * this.w + cx]
  }

  /** Does this cell stop a walker? */
  blocksWalk(k: CellKind) {
    return k !== 'floor'
  }

  blocksShot(k: CellKind, grenade: boolean) {
    if (k === 'wall' || k === 'crate') return true
    return k === 'low' && !grenade
  }

  /** Straight line of fire between two points (ignores fighters). */
  lineClear(x0: number, z0: number, x1: number, z1: number, grenade = false) {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz)
    const steps = Math.max(1, Math.ceil(len / 0.5))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      if (this.blocksShot(this.cellAt(x0 + dx * t, z0 + dz * t), grenade)) return false
    }
    return true
  }

  walkable(cx: number, cz: number) {
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return false
    return this.cells[cz * this.w + cx] === 'floor'
  }

  insideGrid(x: number, z: number, margin = 0) {
    if (!this.br) return true
    return Math.abs(x - this.br.cx) <= this.br.half - margin && Math.abs(z - this.br.cz) <= this.br.half - margin
  }

  /** Whether `o` is a foe of `f` (everyone in the royale). */
  isEnemy(f: { id: number; team: number }, o: { id: number; team: number }) {
    return f.id !== o.id && (this.mode === 'br' || f.team !== o.team)
  }

  private foeDeploy(f: Fighter, d: Deployable) {
    return d.owner !== f.id && (this.mode === 'br' || d.team !== f.team)
  }

  /** Endpoints of a Riot Wall. */
  wallEnds(d: Deployable) {
    const px = -Math.sin(d.aim) * POWER.wall.half
    const pz = Math.cos(d.aim) * POWER.wall.half
    return { ax: d.x - px, az: d.z - pz, bx: d.x + px, bz: d.z + pz }
  }

  /** First enemy Riot Wall (for `team`/`owner`) crossing the segment, as the 0..1 parameter along it, or -1. */
  wallHit(x0: number, z0: number, x1: number, z1: number, owner: { id: number; team: number }) {
    let best = -1
    let wall: Deployable | null = null
    for (const d of this.deployables) {
      if (d.kind !== 'wall' || d.hp <= 0 || this.time < d.armAt || d.owner === owner.id || (this.mode !== 'br' && d.team === owner.team)) continue
      const e = this.wallEnds(d)
      const t = segSeg(x0, z0, x1, z1, e.ax, e.az, e.bx, e.bz)
      if (t >= 0 && (best < 0 || t < best)) {
        best = t
        wall = d
      }
    }
    return { t: best, wall }
  }

  /** Would an enemy Riot Wall stop a direct shot from f to (x, z)? */
  wallBlocks(f: Fighter, x: number, z: number) {
    return this.wallHit(f.x, f.z, x, z, f).t >= 0
  }

  hasStatus(f: Fighter, kind: StatusKind) {
    for (const s of f.statuses) if (s.kind === kind && s.until > this.time) return s
    return null
  }

  /** Any cleansable debuff on the fighter. */
  debuffed(f: Fighter) {
    return f.statuses.some((s) => s.until > this.time && !STATUS_INFO[s.kind].sticky && STATUS_INFO[s.kind].tags.some((t) => CLEANSABLE.includes(t)))
  }

  /** Live decoy belonging to a fighter. */
  decoyOf(id: number) {
    return this.deployables.find((d) => d.kind === 'decoy' && d.owner === id && d.hp > 0) ?? null
  }

  /* ---------- Public API ---------- */

  setInput(id: number, input: Input) {
    const f = this.fighters.find((x) => x.id === id)
    if (f && f.human) f.input = input
  }

  fighter(id: number) {
    return this.fighters.find((f) => f.id === id)
  }

  humans() {
    return this.fighters.filter((f) => f.human)
  }

  aliveCount() {
    return this.fighters.filter((f) => f.alive).length
  }

  /** Replace a human with a bot (they left) or a bot with a human (they joined). */
  setHuman(id: number, human: boolean, peer?: string, name?: string) {
    const f = this.fighter(id)
    if (!f) return
    f.human = human
    f.peer = peer
    if (name) f.name = name
    f.bot = human ? null : this.newBot()
  }

  /** Advance the match by dt seconds (call with a fixed 1/60 for determinism). */
  step(dt: number) {
    this.events.length = 0
    if (this.phase === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.phase = 'play'
        this.events.push({ t: 'start' })
      }
      // Fighters can turn but not move during the countdown.
      for (const f of this.fighters) if (f.alive) this.faceInput(f)
      return
    }
    if (this.phase === 'over') {
      this.time += dt
      return
    }
    this.time += dt
    for (const f of this.fighters) if (f.bot && f.alive) thinkBot(this, f, dt)
    for (const f of this.fighters) this.stepFighter(f, dt)
    this.separate()
    this.stepProjectiles(dt)
    this.stepDeployables(dt)
    this.stepPickups(dt)
    this.stepPads()
    if (this.mode === 'capture') this.stepZone(dt)
    if (this.br) this.stepGrid(dt)
    this.checkEnd()
  }

  /* ---------- Status effects ---------- */

  /** Apply or refresh a status. Immunity (Purge Pulse) keeps cleansable debuffs off. Returns whether it landed. */
  addStatus(f: Fighter, kind: StatusKind, until: number, src: number, mag: number) {
    const info = STATUS_INFO[kind]
    if (info.debuff && !info.sticky && info.tags.some((t) => CLEANSABLE.includes(t))) {
      const imm = this.hasStatus(f, 'purged')
      if (imm) {
        if (this.time - f.noticeAt > 1.5) {
          f.noticeAt = this.time
          this.counter('cleanse', f.x, f.z, imm.src, src)
        }
        return false
      }
    }
    const s = f.statuses.find((x) => x.kind === kind)
    if (s) {
      s.until = Math.max(s.until, until)
      s.mag = Math.max(s.mag, mag)
      s.src = src
    } else f.statuses.push({ kind, until, src, mag })
    return true
  }

  private removeStatus(f: Fighter, kind: StatusKind) {
    f.statuses = f.statuses.filter((s) => s.kind !== kind)
  }

  private counter(rule: CounterId, x: number, z: number, by: number, target: number) {
    this.events.push({ t: 'counter', rule, x, z, by, target })
    const f = this.fighter(by)
    if (f) f.counters++
  }

  /* ---------- Fighters ---------- */

  private faceInput(f: Fighter) {
    const { ax, az } = f.input
    if (ax || az) f.aim = Math.atan2(az, ax)
  }

  private stepFighter(f: Fighter, dt: number) {
    if (!f.alive) {
      if (!f.out && this.mode !== 'br' && this.time >= f.respawnAt) this.respawn(f)
      return
    }
    const now = this.time
    const inp = f.input
    this.faceInput(f)
    // Timers.
    f.fireCd = Math.max(0, f.fireCd - dt)
    f.dashCd = Math.max(0, f.dashCd - dt)
    f.powerCd = Math.max(0, f.powerCd - dt)
    if (f.shieldUntil && now > f.shieldUntil) {
      f.shield = 0
      f.shieldUntil = 0
    }
    if (f.superUntil && now > f.superUntil) {
      f.superUntil = 0
      f.rammed.clear()
    }
    if (f.cloakUntil && now > f.cloakUntil) f.cloakUntil = 0
    if (f.statuses.length) {
      f.statuses = f.statuses.filter((s) => s.until > now)
      // A revealed fighter cannot hide.
      if (f.cloakUntil && this.hasStatus(f, 'revealed')) f.cloakUntil = 0
      // Poison and scorch.
      for (const s of f.statuses) {
        if (!statusHas(s.kind, 'dot')) continue
        const src = this.fighter(s.src) ?? null
        const dmg = s.mag * dt
        f.dotAcc += dmg
        this.hurt(f, dmg, src && src !== f ? src : null, true)
        if (!f.alive) return
      }
      if (f.dotAcc > 0 && now >= f.dotAt) {
        this.events.push({ t: 'hit', x: f.x, z: f.z, dmg: Math.round(f.dotAcc), target: f.id, dot: true })
        f.dotAcc = 0
        f.dotAt = now + 0.5
      }
    }
    // Out-of-combat regen (not while scorched).
    if (now - f.lastHurtAt > REGEN_DELAY && f.hp < f.maxHp && !this.hasStatus(f, 'scorch')) {
      const heal = Math.min(f.maxHp - f.hp, f.maxHp * REGEN_RATE * dt)
      f.hp += heal
    }
    // Super charges slowly on its own too.
    f.super = Math.min(1, f.super + 0.012 * dt * f.gear.charge)
    // Heat Vent wind-up.
    if (f.channelUntil && now >= f.channelUntil) {
      f.channelUntil = 0
      this.ventBlast(f)
    }
    // Gas chokes dashes, charges and channels (the flamethrower, Heat Vent, Bulwark Dash).
    const choked = f.statuses.length > 0 && f.statuses.some((s) => s.until > now && statusHas(s.kind, 'choke'))
    // Dash.
    if (inp.dash && f.dashCd <= 0 && !f.dashUntil && choked) this.choke(f)
    else if (inp.dash && f.dashCd <= 0 && !f.dashUntil) {
      const l = Math.hypot(inp.mx, inp.mz)
      const dx = l > 0.1 ? inp.mx / l : Math.cos(f.aim)
      const dz = l > 0.1 ? inp.mz / l : Math.sin(f.aim)
      f.dashDx = dx
      f.dashDz = dz
      f.dashUntil = now + DASH.duration
      f.dashCd = DASH.cooldown
      this.events.push({ t: 'dash', id: f.id })
    }
    if (f.dashUntil && now > f.dashUntil) f.dashUntil = 0
    // Super and power.
    if (inp.super && f.super >= 1 && !f.channelUntil) {
      if (choked && f.hero.superKind === 'bulwark') this.choke(f)
      else this.useSuper(f)
    }
    if (inp.power && f.powerCd <= 0 && !f.channelUntil) {
      if (choked && f.hero.power === 'vent') this.choke(f)
      else this.usePower(f)
    }
    // Movement.
    let speed = f.speed
    if (f.hero.superKind === 'bulwark' && f.superUntil) speed *= SUPER.bulwark.speedMul
    if (f.hero.superKind === 'cloak' && f.cloakUntil) speed *= SUPER.cloak.speedMul
    if (f.hero.weapon.kind === 'flame' && inp.fire) speed *= 0.9
    if (f.wallUntil > now) speed *= POWER.wall.speedMul
    if (this.hasStatus(f, 'haste')) speed *= POWERUP.hasteMul
    const slow = this.hasStatus(f, 'slow')
    if (slow) speed *= slow.mag
    let vx: number
    let vz: number
    if (f.channelUntil) {
      // Heat Vent boosters: a straight lunge along the aim.
      vx = Math.cos(f.aim) * POWER.vent.lunge
      vz = Math.sin(f.aim) * POWER.vent.lunge
    } else if (f.dashUntil) {
      vx = f.dashDx * f.speed * DASH.speedMul
      vz = f.dashDz * f.speed * DASH.speedMul
    } else {
      const l = Math.hypot(inp.mx, inp.mz)
      const s = l > 1 ? 1 / l : 1
      vx = inp.mx * s * speed
      vz = inp.mz * s * speed
    }
    vx += f.knockX
    vz += f.knockZ
    f.knockX *= Math.exp(-9 * dt)
    f.knockZ *= Math.exp(-9 * dt)
    if (Math.abs(f.knockX) < 0.05) f.knockX = 0
    if (Math.abs(f.knockZ) < 0.05) f.knockZ = 0
    f.vx = vx
    f.vz = vz
    this.moveCircle(f, vx * dt, vz * dt)
    // Bulwark ram.
    if (f.hero.superKind === 'bulwark' && f.superUntil) {
      for (const o of this.fighters) {
        if (o === f || !o.alive || o.team === f.team || f.rammed.has(o.id)) continue
        if (Math.hypot(o.x - f.x, o.z - f.z) < SUPER.bulwark.ramRadius + FIGHTER_R) {
          f.rammed.add(o.id)
          this.hurt(o, SUPER.bulwark.ramDmg * this.dmgOut(f), f)
          const d = Math.hypot(o.x - f.x, o.z - f.z) || 1
          o.knockX += ((o.x - f.x) / d) * SUPER.bulwark.knock
          o.knockZ += ((o.z - f.z) / d) * SUPER.bulwark.knock
          this.interrupt(o, f)
        }
      }
    }
    // Weapon.
    if (f.burst > 0 && now >= f.burstAt) {
      f.burst--
      f.burstAt = now + f.hero.weapon.burstGap
      this.spawnShot(f, 'needle')
    }
    if (inp.fire && f.fireCd <= 0 && !f.dashUntil && !f.channelUntil) {
      if (choked && f.hero.weapon.kind === 'flame') this.choke(f)
      else this.fire(f)
    }
    // Grid damage.
    if (this.br && !this.insideGrid(f.x, f.z)) this.hurt(f, this.br.dps * dt, null, true)
  }

  /** Outgoing damage multiplier (gear, loot, Damage Amp). */
  dmgOut(f: Fighter) {
    return f.dmgMul * (this.hasStatus(f, 'amp') ? POWERUP.ampMul : 1)
  }

  /** Move a fighter with axis-separated collision against the grid. */
  private moveCircle(f: Fighter, dx: number, dz: number) {
    const r = FIGHTER_R
    const tryAxis = (nx: number, nz: number) => this.fits(nx, nz, r)
    if (tryAxis(f.x + dx, f.z)) f.x += dx
    else {
      // Slide to the cell edge.
      const sign = Math.sign(dx)
      for (let i = 0; i < 4; i++) {
        const step = (dx / 5) * (4 - i)
        if (tryAxis(f.x + step, f.z)) {
          f.x += step
          break
        }
      }
      if (sign) f.knockX = 0
    }
    if (tryAxis(f.x, f.z + dz)) f.z += dz
    else {
      for (let i = 0; i < 4; i++) {
        const step = (dz / 5) * (4 - i)
        if (tryAxis(f.x, f.z + step)) {
          f.z += step
          break
        }
      }
      f.knockZ = 0
    }
    const lim = this.w * CELL
    f.x = Math.min(lim - r, Math.max(r, f.x))
    f.z = Math.min(this.h * CELL - r, Math.max(r, f.z))
  }

  /** Whether a circle of radius r fits at (x, z) without touching a blocking cell. */
  fits(x: number, z: number, r = FIGHTER_R) {
    for (const [ox, oz] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
      [r * 0.72, r * 0.72],
      [-r * 0.72, r * 0.72],
      [r * 0.72, -r * 0.72],
      [-r * 0.72, -r * 0.72],
    ])
      if (this.blocksWalk(this.cellAt(x + ox, z + oz))) return false
    return true
  }

  /** Fighters push each other apart. */
  private separate() {
    const live = this.fighters.filter((f) => f.alive)
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]
        const b = live[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        const min = FIGHTER_R * 2
        if (d >= min || d === 0) continue
        const push = (min - d) / 2
        const nx = dx / d
        const nz = dz / d
        if (this.cellAt(a.x - nx * push, a.z - nz * push) === 'floor') {
          a.x -= nx * push
          a.z -= nz * push
        }
        if (this.cellAt(b.x + nx * push, b.z + nz * push) === 'floor') {
          b.x += nx * push
          b.z += nz * push
        }
      }
  }

  private uncloak(f: Fighter) {
    if (f.cloakUntil) f.cloakUntil = 0
    if (f.statuses.length) this.removeStatus(f, 'phased')
  }

  private fire(f: Fighter) {
    const w = f.hero.weapon
    f.fireCd = w.cooldown * (this.hasStatus(f, 'hyper') ? POWERUP.hyperMul : 1)
    this.uncloak(f)
    // Firing dips the Riot Wall for a moment (the shield arm swings away to shoot).
    if (f.wallUntil) for (const d of this.deployables) if (d.kind === 'wall' && d.owner === f.id) d.armAt = this.time + POWER.wall.lowerOnFire
    switch (w.kind) {
      case 'scatter':
        for (let i = 0; i < w.count; i++) this.spawnShot(f, 'pellet', i === 0)
        break
      case 'rifle':
        this.spawnShot(f, 'rail')
        break
      case 'flame':
        this.spawnShot(f, 'flame')
        break
      case 'smg':
        this.spawnShot(f, 'bullet')
        break
      case 'launcher':
        this.spawnShot(f, 'grenade')
        break
      case 'needler':
        this.spawnShot(f, 'needle')
        f.burst = w.count - 1
        f.burstAt = this.time + w.burstGap * (this.hasStatus(f, 'hyper') ? POWERUP.hyperMul : 1)
        break
    }
  }

  private spawnShot(f: Fighter, kind: ProjKind, event = true) {
    const w = f.hero.weapon
    const spread = kind === 'needle' || kind === 'rail' ? w.spread : w.spread * (this.rng.next() * 2 - 1)
    const a = f.aim + (kind === 'pellet' ? (this.rng.next() * 2 - 1) * w.spread : spread)
    const muzzle = 0.7
    const lob = kind === 'grenade'
    const p: Projectile = {
      id: this.nextId++,
      kind,
      owner: f.id,
      team: f.team,
      x: f.x + Math.cos(a) * muzzle,
      z: f.z + Math.sin(a) * muzzle,
      y: 1.3,
      vx: Math.cos(a) * w.speed,
      vz: Math.sin(a) * w.speed,
      vy: 0,
      ttl: w.range / w.speed,
      dmg: w.dmg * this.dmgOut(f),
      splash: w.splash,
      bounces: !lob && kind !== 'flame' && this.hasStatus(f, 'ricochet') ? 1 : 0,
    }
    if (kind === 'flame') p.ttl *= 0.8 + this.rng.next() * 0.4
    if (lob) this.lob(p, f, w.range, w.speed)
    this.projectiles.push(p)
    if (event) this.events.push({ t: 'shot', id: f.id, x: p.x, z: p.z, aim: a, kind })
  }

  /** Arc a lobbed projectile onto the aim point. */
  private lob(p: Projectile, f: Fighter, range: number, speed: number) {
    const d = Math.min(range, Math.max(3, f.input.aimDist))
    const T = d / speed
    p.vy = (GRAVITY * T) / 2
    p.ttl = T
  }

  /* ---------- Signature powers ---------- */

  private usePower(f: Fighter) {
    const now = this.time
    const k = f.hero.power
    f.powerCd = POWERS[k].cooldown / Math.sqrt(f.gear.charge)
    f.powersUsed++
    let tx = f.x
    let tz = f.z
    const ca = Math.cos(f.aim)
    const sa = Math.sin(f.aim)
    switch (k) {
      case 'wall': {
        // One wall per Rook: the old one folds away.
        this.deployables = this.deployables.filter((d) => !(d.kind === 'wall' && d.owner === f.id))
        tx = f.x + ca * POWER.wall.dist
        tz = f.z + sa * POWER.wall.dist
        this.deployables.push(this.deploy('wall', f, tx, tz, POWER.wall.hp, now + POWER.wall.life, f.aim))
        f.wallUntil = now + POWER.wall.life
        break
      }
      case 'dart': {
        this.uncloak(f)
        const p: Projectile = { id: this.nextId++, kind: 'dart', owner: f.id, team: f.team, x: f.x + ca * 0.7, z: f.z + sa * 0.7, y: 1.3, vx: ca * POWER.dart.speed, vz: sa * POWER.dart.speed, vy: 0, ttl: POWER.dart.range / POWER.dart.speed, dmg: POWER.dart.dmg * this.dmgOut(f), splash: 0, bounces: 0 }
        this.projectiles.push(p)
        this.events.push({ t: 'shot', id: f.id, x: p.x, z: p.z, aim: f.aim, kind: 'dart' })
        break
      }
      case 'vent':
        f.channelUntil = now + POWER.vent.windup
        f.burst = 0
        break
      case 'blink': {
        const l = Math.hypot(f.input.mx, f.input.mz)
        const dx = l > 0.2 ? f.input.mx / l : ca
        const dz = l > 0.2 ? f.input.mz / l : sa
        const fromX = f.x
        const fromZ = f.z
        // Furthest open spot along the line (it can hop over low cover and gaps, not through walls).
        for (let s = POWER.blink.dist; s >= 0.5; s -= 0.25) {
          const x = f.x + dx * s
          const z = f.z + dz * s
          if (this.fits(x, z) && this.lineClear(f.x, f.z, x, z, true)) {
            tx = x
            tz = z
            break
          }
        }
        f.x = tx
        f.z = tz
        f.knockX = f.knockZ = 0
        const decoy = this.deploy('decoy', f, fromX, fromZ, POWER.blink.decoyHp, now + POWER.blink.decoyLife, f.aim)
        this.deployables = this.deployables.filter((d) => !(d.kind === 'decoy' && d.owner === f.id))
        this.deployables.push(decoy)
        if (f.statuses.some((s) => s.kind === 'slow' || s.kind === 'toxin')) {
          f.statuses = f.statuses.filter((s) => s.kind !== 'slow' && s.kind !== 'toxin')
          this.counter('slip', f.x, f.z, f.id, f.id)
        }
        this.events.push({ t: 'power', id: f.id, kind: k, x: fromX, z: fromZ, aim: f.aim, tx, tz })
        return
      }
      case 'toxin': {
        this.uncloak(f)
        const p: Projectile = { id: this.nextId++, kind: 'toxin', owner: f.id, team: f.team, x: f.x + ca * 0.7, z: f.z + sa * 0.7, y: 1.3, vx: ca * POWER.toxin.speed, vz: sa * POWER.toxin.speed, vy: 0, ttl: 1, dmg: POWER.toxin.dmg * this.dmgOut(f), splash: POWER.toxin.radius, bounces: 0 }
        this.lob(p, f, POWER.toxin.range, POWER.toxin.speed)
        tx = f.x + ca * p.ttl * POWER.toxin.speed
        tz = f.z + sa * p.ttl * POWER.toxin.speed
        this.projectiles.push(p)
        this.events.push({ t: 'shot', id: f.id, x: p.x, z: p.z, aim: f.aim, kind: 'toxin' })
        break
      }
      case 'purge':
        this.purge(f)
        break
    }
    this.events.push({ t: 'power', id: f.id, kind: k, x: f.x, z: f.z, aim: f.aim, tx, tz })
  }

  private deploy(kind: DeployKind, f: Fighter, x: number, z: number, hp: number, until: number, aim = 0, armAt = this.time): Deployable {
    return { id: this.nextId++, kind, owner: f.id, team: f.team, x, z, hp, maxHp: hp, until, armAt, fireCd: 0, aim, vx: 0, vz: 0, lured: false }
  }

  /** Heat Vent goes off: melt shields and gadgets, scorch everyone in the blast. */
  private ventBlast(f: Fighter) {
    const r = POWER.vent.radius
    const out = this.dmgOut(f)
    this.events.push({ t: 'explode', x: f.x, z: f.z, r, kind: 'vent' })
    for (const o of this.fighters) {
      if (!o.alive || !this.isEnemy(f, o)) continue
      const d = Math.hypot(o.x - f.x, o.z - f.z)
      if (d > r + FIGHTER_R) continue
      if (o.shield > 0) {
        o.shield = 0
        o.shieldUntil = 0
        this.removeStatus(o, 'overshield')
        this.counter('melt', o.x, o.z, f.id, o.id)
      }
      this.hurt(o, POWER.vent.dmg * out, f)
      if (o.alive) this.addStatus(o, 'scorch', this.time + POWER.vent.scorch, f.id, POWER.vent.scorchDps * out)
    }
    for (const d of this.deployables) {
      if (d.hp <= 0 || d.kind === 'gas' || !this.foeDeploy(f, d)) continue
      const dist = d.kind === 'wall' ? segPointDist(this.wallEnds(d), f.x, f.z) : Math.hypot(d.x - f.x, d.z - f.z)
      if (dist > r + 0.6) continue
      d.hp = 0
      this.counter('scrap', d.x, d.z, f.id, -d.id)
    }
  }

  /** Purge Pulse: cleanse, heal and protect the medic and allies nearby. */
  private purge(f: Fighter) {
    const now = this.time
    this.events.push({ t: 'explode', x: f.x, z: f.z, r: POWER.purge.radius, kind: 'purge' })
    for (const o of this.fighters) {
      if (!o.alive) continue
      if (o !== f && (this.mode === 'br' || o.team !== f.team)) continue
      if (Math.hypot(o.x - f.x, o.z - f.z) > POWER.purge.radius) continue
      const before = o.statuses.length
      const marks = o.statuses.filter((s) => s.kind === 'mark' && s.until > now)
      o.statuses = o.statuses.filter((s) => STATUS_INFO[s.kind].sticky || !STATUS_INFO[s.kind].debuff || !STATUS_INFO[s.kind].tags.some((t) => CLEANSABLE.includes(t)))
      // Cleansed marks bounce back onto whoever applied them.
      for (const m of marks) {
        const src = this.fighter(m.src)
        if (!src || !src.alive || !this.isEnemy(f, src) || this.hasStatus(src, 'mark')) continue
        if (this.addStatus(src, 'mark', now + POWER.purge.reflect, f.id, POWER.dart.markMul)) this.counter('reflect', src.x, src.z, f.id, src.id)
      }
      if (o.statuses.length < before) {
        this.counter('cleanse', o.x, o.z, f.id, o.id)
        o.noticeAt = now
      }
      this.heal(o, POWER.purge.heal, f, true)
      // Scorch also keeps the barrier and the immunity off.
      if (this.hasStatus(o, 'scorch')) continue
      this.addStatus(o, 'purged', now + POWER.purge.immune, f.id, 0)
      o.shield = Math.max(o.shield, POWER.purge.shield)
      o.shieldUntil = Math.max(o.shieldUntil, now + POWER.purge.immune)
    }
  }

  /** Scan Dart lands: reveal, strip cloaks, expose decoys, mark. */
  private scanPulse(x: number, z: number, owner: Fighter | null) {
    if (!owner) return
    const now = this.time
    const r = POWER.dart.radius
    this.events.push({ t: 'explode', x, z, r, kind: 'reveal' })
    for (const o of this.fighters) {
      if (!o.alive || !this.isEnemy(owner, o)) continue
      if (Math.hypot(o.x - x, o.z - z) > r) continue
      const wasCloaked = o.cloakUntil > now
      if (!this.addStatus(o, 'revealed', now + POWER.dart.reveal, owner.id, 0)) continue
      if (wasCloaked) {
        this.uncloak(o)
        if (o.hero.superKind === 'cloak') o.superUntil = 0
        this.counter('uncloak', o.x, o.z, owner.id, o.id)
      }
      this.addStatus(o, 'mark', now + POWER.dart.mark, owner.id, POWER.dart.markMul)
    }
    for (const d of this.deployables) {
      if (d.kind !== 'decoy' || d.hp <= 0 || !this.foeDeploy(owner, d)) continue
      if (Math.hypot(d.x - x, d.z - z) > r) continue
      d.hp = 0
      this.counter('expose', d.x, d.z, owner.id, -d.id)
    }
  }

  /** A channel or charge tried in the gas sputters out. */
  private choke(f: Fighter) {
    if (this.time - f.noticeAt < 0.8) return
    f.noticeAt = this.time
    const gas = f.statuses.find((s) => statusHas(s.kind, 'choke'))
    this.counter('choke', f.x, f.z, gas?.src ?? 0, f.id)
  }

  /** Knockback breaks channels (Heat Vent) and charges (Bulwark Dash). */
  private interrupt(o: Fighter, by: Fighter | null) {
    let did = false
    if (o.channelUntil) {
      o.channelUntil = 0
      did = true
    }
    if (o.hero.superKind === 'bulwark' && o.superUntil > this.time) {
      o.superUntil = 0
      o.shield = 0
      o.shieldUntil = 0
      o.rammed.clear()
      did = true
    }
    if (did) this.counter('interrupt', o.x, o.z, by?.id ?? 0, o.id)
  }

  private useSuper(f: Fighter) {
    const now = this.time
    f.super = 0
    f.supersUsed++
    this.events.push({ t: 'super', id: f.id, hero: f.hero.id, x: f.x, z: f.z })
    switch (f.hero.superKind) {
      case 'bulwark':
        f.superUntil = now + SUPER.bulwark.duration
        f.shield = Math.max(f.shield, SUPER.bulwark.shield)
        f.shieldUntil = now + SUPER.bulwark.duration
        f.rammed.clear()
        break
      case 'sentry':
        this.deployables.push(this.deploy('turret', f, f.x + Math.cos(f.aim) * 0.9, f.z + Math.sin(f.aim) * 0.9, SUPER.sentry.hp, now + SUPER.sentry.duration, f.aim, now + 0.4))
        break
      case 'pulse':
        this.events.push({ t: 'explode', x: f.x, z: f.z, r: SUPER.pulse.radius, kind: 'pulse' })
        for (const o of this.fighters) {
          if (!o.alive || !this.isEnemy(f, o)) continue
          const d = Math.hypot(o.x - f.x, o.z - f.z)
          if (d > SUPER.pulse.radius) continue
          this.hurt(o, SUPER.pulse.dmg * this.dmgOut(f), f)
          const n = d || 1
          o.knockX += ((o.x - f.x) / n) * SUPER.pulse.knock
          o.knockZ += ((o.z - f.z) / n) * SUPER.pulse.knock
          this.interrupt(o, f)
        }
        f.shield = Math.max(f.shield, SUPER.pulse.shield)
        f.shieldUntil = now + SUPER.pulse.shieldTime
        f.superUntil = now + SUPER.pulse.shieldTime
        break
      case 'cloak':
        f.cloakUntil = now + SUPER.cloak.duration
        f.superUntil = now + SUPER.cloak.duration
        break
      case 'mines':
        for (let i = 0; i < SUPER.mines.count; i++) {
          const a = (i / SUPER.mines.count) * Math.PI * 2 + f.aim
          let x = f.x + Math.cos(a) * SUPER.mines.ring
          let z = f.z + Math.sin(a) * SUPER.mines.ring
          if (this.cellAt(x, z) !== 'floor') {
            x = f.x + Math.cos(a) * 0.8
            z = f.z + Math.sin(a) * 0.8
          }
          if (this.cellAt(x, z) !== 'floor') continue
          this.deployables.push(this.deploy('mine', f, x, z, 1, now + SUPER.mines.life, 0, now + SUPER.mines.arm))
        }
        break
      case 'mend':
        this.deployables.push(this.deploy('heal', f, f.x, f.z, 1, now + SUPER.mend.duration))
        break
    }
  }

  /** Apply damage. `attacker` null = environment. Returns the damage that landed. */
  hurt(target: Fighter, dmg: number, attacker: Fighter | null, silent = false) {
    if (!target.alive || dmg <= 0) return 0
    if (this.time < target.spawnShieldUntil) return 0
    if (attacker && target.statuses.length) {
      const mark = this.hasStatus(target, 'mark')
      if (mark) dmg *= mark.mag
    }
    let left = dmg
    if (target.shield > 0) {
      const used = Math.min(target.shield, left)
      target.shield -= used
      left -= used
    }
    target.hp -= left
    target.lastHurtAt = this.time
    if (attacker) {
      target.lastHitBy = attacker.id
      attacker.damage += dmg
      attacker.super = Math.min(1, attacker.super + (dmg / attacker.hero.chargeDmg) * attacker.gear.charge)
      if (!silent) this.events.push({ t: 'hit', x: target.x, z: target.z, dmg: Math.round(dmg), target: target.id })
    }
    if (target.hp <= 0) this.kill(target, attacker)
    return dmg
  }

  /** Heal a fighter. Scorch blocks it (and says so for the big heals). */
  heal(target: Fighter, amount: number, healer: Fighter | null, loud = false) {
    if (!target.alive) return
    const scorch = target.statuses.length ? this.hasStatus(target, 'scorch') : null
    if (scorch) {
      if ((loud || this.time - target.noticeAt > 1.5) && amount > 0) {
        target.noticeAt = this.time
        this.counter('healblock', target.x, target.z, scorch.src, target.id)
      }
      return
    }
    const h = Math.min(amount, target.maxHp - target.hp)
    if (h <= 0) return
    target.hp += h
    if (healer) healer.healing += h
  }

  private kill(f: Fighter, attacker: Fighter | null) {
    // Revive Token (battle royale): back up once instead.
    if (this.mode === 'br' && this.hasStatus(f, 'revive')) {
      f.statuses = f.statuses.filter((s) => !STATUS_INFO[s.kind].debuff && s.kind !== 'revive')
      f.hp = Math.round(f.maxHp * 0.45)
      f.spawnShieldUntil = this.time + 1.5
      f.channelUntil = 0
      this.events.push({ t: 'revive', id: f.id })
      return
    }
    f.alive = false
    f.hp = 0
    f.deaths++
    f.shield = 0
    f.shieldUntil = 0
    f.cloakUntil = 0
    f.superUntil = 0
    f.dashUntil = 0
    f.channelUntil = 0
    f.wallUntil = 0
    f.burst = 0
    f.statuses = []
    f.dotAcc = 0
    let killer = attacker
    if ((!killer || killer === f) && f.lastHitBy) killer = this.fighter(f.lastHitBy) ?? null
    if (killer && killer !== f && killer.team !== f.team) {
      killer.kills++
      killer.super = Math.min(1, killer.super + 0.15)
      if (this.mode === 'tdm') {
        this.score[killer.team]++
        this.events.push({ t: 'score', team: killer.team, score: this.score[killer.team] })
      }
    }
    this.events.push({ t: 'death', id: f.id, x: f.x, z: f.z, killer: killer && killer !== f ? killer.id : 0 })
    // A coin shard drops where they fell.
    if (this.cellAt(f.x, f.z) === 'floor') this.pickups.push({ id: this.nextId++, x: f.x, z: f.z, kind: 'shard', until: this.time + SHARD_LIFE })
    if (this.mode === 'br') {
      f.out = true
      f.placement = this.placementsLeft--
    } else f.respawnAt = this.time + RESPAWN
    // Deployables die with their owner (except mines and gas, which stay as a parting gift).
    this.deployables = this.deployables.filter((d) => d.owner !== f.id || d.kind === 'mine' || d.kind === 'gas')
  }

  private respawn(f: Fighter) {
    f.alive = true
    f.hp = f.maxHp
    f.super = Math.min(f.super, 0.5)
    f.knockX = f.knockZ = 0
    f.fireCd = 0
    f.dashCd = 0
    f.powerCd = Math.min(f.powerCd, 2)
    f.statuses = []
    f.lastHurtAt = -99
    f.lastHitBy = 0
    f.spawnShieldUntil = this.time + TEAM_SPAWN_SHIELD
    this.placeAtTeamSpawn(f)
    this.events.push({ t: 'respawn', id: f.id })
  }

  /* ---------- Projectiles ---------- */

  private stepProjectiles(dt: number) {
    const keep: Projectile[] = []
    for (const p of this.projectiles) {
      p.ttl -= dt
      const lobbed = p.kind === 'grenade' || p.kind === 'toxin'
      if (p.kind === 'needle') this.home(p, dt)
      const x0 = p.x
      const z0 = p.z
      let x1 = p.x + p.vx * dt
      let z1 = p.z + p.vz * dt
      if (lobbed) {
        p.y += p.vy * dt
        p.vy -= GRAVITY * dt
      }
      // Grid (Ricochet Rounds bounce once off walls).
      let hitWall = false
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.4))
      for (let i = 1; i <= steps && !hitWall; i++) {
        const t = i / steps
        const k = this.cellAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)
        if (this.blocksShot(k, lobbed)) {
          const sx = x0 + (x1 - x0) * ((i - 1) / steps)
          const sz = z0 + (z1 - z0) * ((i - 1) / steps)
          if (k === 'crate' && !lobbed) this.damageCrate(sx + ((x1 - x0) * 0.2) / steps, sz + ((z1 - z0) * 0.2) / steps, p.dmg, p.owner)
          if (p.bounces > 0) {
            p.bounces--
            const ax = x0 + (x1 - x0) * t
            const az = z0 + (z1 - z0) * t
            const bx = this.blocksShot(this.cellAt(ax, sz), false)
            const bz = this.blocksShot(this.cellAt(sx, az), false)
            if (bx || !bz) p.vx = -p.vx
            if (bz || !bx) p.vz = -p.vz
            x1 = sx
            z1 = sz
            break
          }
          hitWall = true
          x1 = sx
          z1 = sz
        }
      }
      p.x = x1
      p.z = z1
      const owner = this.fighter(p.owner) ?? null
      const shooter = owner ?? { id: p.owner, team: p.team }
      // Riot Walls stop direct fire.
      let wallT = -1
      let wall: Deployable | null = null
      if (!lobbed) {
        const w = this.wallHit(x0, z0, p.x, p.z, shooter)
        wallT = w.t
        wall = w.wall
      }
      // Fighters.
      let hitF: Fighter | null = null
      let bestT = 2
      if (!lobbed || p.y < 1.4) {
        for (const f of this.fighters) {
          if (!f.alive || f.id === p.owner || (f.team === p.team && this.mode !== 'br')) continue
          const t = segCircle(x0, z0, p.x, p.z, f.x, f.z, FIGHTER_R + 0.1)
          if (t >= 0 && t < bestT) {
            bestT = t
            hitF = f
          }
        }
      }
      // Decoys and turrets can be shot.
      let hitD: Deployable | null = null
      if (!lobbed)
        for (const d of this.deployables) {
          if ((d.kind !== 'turret' && d.kind !== 'decoy') || d.hp <= 0 || d.owner === p.owner || (d.team === p.team && this.mode !== 'br')) continue
          const t = segCircle(x0, z0, p.x, p.z, d.x, d.z, d.kind === 'decoy' ? FIGHTER_R + 0.1 : 0.6)
          if (t >= 0 && t < bestT) {
            bestT = t
            hitD = d
            hitF = null
          }
        }
      if (wall && wallT >= 0 && wallT < bestT) {
        p.x = x0 + (p.x - x0) * wallT
        p.z = z0 + (p.z - z0) * wallT
        wall.hp -= p.dmg
        // Big shots always announce the block; anything else only the first time this wall stops it.
        if (p.kind === 'rail' || p.kind === 'dart' || !wall.lured) this.counter('block', p.x, p.z, wall.owner, p.owner)
        wall.lured = true
        continue
      }
      if (hitF || hitD) {
        p.x = x0 + (p.x - x0) * bestT
        p.z = z0 + (p.z - z0) * bestT
      }
      if (lobbed) {
        if (hitWall || hitF || p.ttl <= 0 || p.y <= 0) {
          if (p.kind === 'toxin') this.toxinBurst(p.x, p.z, p.dmg, owner)
          else this.explode(p.x, p.z, p.splash, p.dmg, owner, 'grenade')
          continue
        }
        keep.push(p)
        continue
      }
      if (hitF) {
        this.hurt(hitF, p.dmg, owner)
        if (p.kind === 'dart') {
          // Concussive tip: a shove that breaks channels and charges.
          const l = Math.hypot(p.vx, p.vz) || 1
          hitF.knockX += (p.vx / l) * POWER.dart.knock
          hitF.knockZ += (p.vz / l) * POWER.dart.knock
          if (hitF.alive) this.interrupt(hitF, owner)
          this.scanPulse(p.x, p.z, owner)
        }
        continue
      }
      if (hitD) {
        hitD.hp -= p.dmg
        this.events.push({ t: 'hit', x: hitD.x, z: hitD.z, dmg: Math.round(p.dmg), target: -hitD.id })
        if (hitD.kind === 'decoy' && !hitD.lured) {
          hitD.lured = true
          this.counter('lure', hitD.x, hitD.z, hitD.owner, p.owner)
        }
        if (p.kind === 'dart') this.scanPulse(p.x, p.z, owner)
        continue
      }
      if (hitWall || p.ttl <= 0) {
        if (p.kind === 'dart') this.scanPulse(p.x, p.z, owner)
        continue
      }
      keep.push(p)
    }
    this.projectiles = keep
  }

  /** SALVE's needles lock on to signatures: a decoy ahead pulls them off course (the lure counter). */
  private home(p: Projectile, dt: number) {
    const sp = Math.hypot(p.vx, p.vz) || 1
    const dx = p.vx / sp
    const dz = p.vz / sp
    let tx = 0
    let tz = 0
    let best = 1e9
    for (const d of this.deployables) {
      if (d.kind !== 'decoy' || d.hp <= 0 || d.owner === p.owner || (d.team === p.team && this.mode !== 'br')) continue
      const ox = d.x - p.x
      const oz = d.z - p.z
      const dist = Math.hypot(ox, oz)
      if (dist > 9 || (ox * dx + oz * dz) / (dist || 1) < 0.2) continue
      if (dist < best) {
        best = dist
        tx = d.x
        tz = d.z
      }
    }
    if (best >= 1e9) return
    const want = Math.atan2(tz - p.z, tx - p.x)
    const cur = Math.atan2(p.vz, p.vx)
    let da = want - cur
    while (da > Math.PI) da -= Math.PI * 2
    while (da < -Math.PI) da += Math.PI * 2
    const turn = Math.max(-10 * dt, Math.min(10 * dt, da))
    p.vx = Math.cos(cur + turn) * sp
    p.vz = Math.sin(cur + turn) * sp
  }

  private toxinBurst(x: number, z: number, dmg: number, owner: Fighter | null) {
    this.explode(x, z, 1.8, dmg, owner, 'toxin', POWER.toxin.knock)
    if (!owner) return
    const gas = this.deploy('gas', owner, x, z, 1, this.time + POWER.toxin.life)
    this.deployables.push(gas)
  }

  private explode(x: number, z: number, r: number, dmg: number, owner: Fighter | null, kind: 'grenade' | 'mine' | 'toxin', knock = 3) {
    this.events.push({ t: 'explode', x, z, r: kind === 'toxin' ? POWER.toxin.radius : r, kind })
    for (const f of this.fighters) {
      if (!f.alive) continue
      if (owner && f.team === owner.team && this.mode !== 'br' && f !== owner) continue
      const d = Math.hypot(f.x - x, f.z - z)
      if (d > r + FIGHTER_R) continue
      const fall = 1 - Math.max(0, d - 0.6) / (r + FIGHTER_R)
      const amount = dmg * (f === owner ? 0.35 : 1) * (0.45 + 0.55 * fall)
      this.hurt(f, amount, owner && owner !== f ? owner : null)
      const n = d || 1
      f.knockX += ((f.x - x) / n) * knock * fall
      f.knockZ += ((f.z - z) / n) * knock * fall
      if (f !== owner && knock * fall >= 1.5 && f.alive) this.interrupt(f, owner)
    }
    for (const d of this.deployables)
      if ((d.kind === 'turret' || d.kind === 'decoy' || d.kind === 'wall') && (!owner || this.foeDeploy(owner, d)) && Math.hypot(d.x - x, d.z - z) < r + 0.6) d.hp -= dmg
    for (const c of this.crates) {
      if (c.hp <= 0) continue
      const cxm = (c.cx + 0.5) * CELL
      const czm = (c.cz + 0.5) * CELL
      if (Math.hypot(cxm - x, czm - z) < r + 1.2) this.damageCrate(cxm, czm, dmg, owner?.id ?? 0)
    }
  }

  private damageCrate(x: number, z: number, dmg: number, by: number) {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    const c = this.crates.find((c) => c.cx === cx && c.cz === cz && c.hp > 0)
    if (!c) return
    c.hp -= dmg
    if (c.hp > 0) return
    c.hp = 0
    this.cells[cz * this.w + cx] = 'floor'
    const mx = (cx + 0.5) * CELL
    const mz = (cz + 0.5) * CELL
    this.events.push({ t: 'explode', x: mx, z: mz, r: 1.2, kind: 'crate' })
    if (c.loot) {
      const kind = this.rng.pick(CRATE_LOOT)
      this.pickups.push({ id: this.nextId++, x: mx, z: mz, kind, until: Infinity })
    }
    void by
  }

  /* ---------- Deployables ---------- */

  private stepDeployables(dt: number) {
    const keep: Deployable[] = []
    const now = this.time
    for (const d of this.deployables) {
      const owner = this.fighter(d.owner) ?? null
      if (now > d.until || d.hp <= 0) {
        if ((d.kind === 'turret' || d.kind === 'wall') && d.hp <= 0) this.events.push({ t: 'explode', x: d.x, z: d.z, r: 1, kind: 'crate' })
        if (d.kind === 'wall' && owner) owner.wallUntil = 0
        continue
      }
      if (d.kind === 'turret') {
        d.fireCd -= dt
        // Decoys pull the sentry's fire first.
        let bx = 0
        let bz = 0
        let bvx = 0
        let bvz = 0
        let bestD = SUPER.sentry.range
        let found = false
        for (const o of this.deployables) {
          if (o.kind !== 'decoy' || o.hp <= 0 || o.team === d.team) continue
          const dist = Math.hypot(o.x - d.x, o.z - d.z) - 3
          if (dist < bestD && this.lineClear(d.x, d.z, o.x, o.z)) {
            bestD = dist
            bx = o.x
            bz = o.z
            bvx = o.vx
            bvz = o.vz
            found = true
          }
        }
        for (const f of this.fighters) {
          if (!f.alive || f.team === d.team || f.cloakUntil) continue
          const dist = Math.hypot(f.x - d.x, f.z - d.z)
          if (dist < bestD && this.lineClear(d.x, d.z, f.x, f.z)) {
            bestD = dist
            bx = f.x
            bz = f.z
            bvx = f.vx
            bvz = f.vz
            found = true
          }
        }
        if (found) {
          const lead = Math.max(0, bestD) / SUPER.sentry.speed
          d.aim = Math.atan2(bz + bvz * lead - d.z, bx + bvx * lead - d.x)
          if (d.fireCd <= 0 && now >= d.armAt) {
            d.fireCd = SUPER.sentry.cooldown
            this.projectiles.push({ id: this.nextId++, kind: 'turret', owner: d.owner, team: d.team, x: d.x + Math.cos(d.aim) * 0.7, z: d.z + Math.sin(d.aim) * 0.7, y: 1, vx: Math.cos(d.aim) * SUPER.sentry.speed, vz: Math.sin(d.aim) * SUPER.sentry.speed, vy: 0, ttl: SUPER.sentry.range / SUPER.sentry.speed, dmg: SUPER.sentry.dmg * (owner?.dmgMul ?? 1), splash: 0, bounces: 0 })
            this.events.push({ t: 'shot', id: -d.id, x: d.x, z: d.z, aim: d.aim, kind: 'turret' })
          }
        }
      } else if (d.kind === 'mine') {
        if (now >= d.armAt) {
          let trip = false
          for (const f of this.fighters) {
            if (!f.alive || (f.team === d.team && this.mode !== 'br') || f.id === d.owner) continue
            if (Math.hypot(f.x - d.x, f.z - d.z) < 1.1) trip = true
          }
          for (const o of this.deployables) if (o.kind === 'decoy' && o.hp > 0 && o.owner !== d.owner && (o.team !== d.team || this.mode === 'br') && Math.hypot(o.x - d.x, o.z - d.z) < 1.1) trip = true
          if (trip) {
            this.explode(d.x, d.z, SUPER.mines.radius, SUPER.mines.dmg * (owner?.dmgMul ?? 1), owner, 'mine')
            d.hp = 0
          }
        }
        if (d.hp <= 0) continue
      } else if (d.kind === 'heal') {
        for (const f of this.fighters) {
          if (!f.alive || (f.team !== d.team && this.mode !== 'br') || (this.mode === 'br' && f.id !== d.owner)) continue
          if (Math.hypot(f.x - d.x, f.z - d.z) < SUPER.mend.radius) this.heal(f, SUPER.mend.hps * dt, owner)
        }
      } else if (d.kind === 'gas') {
        const mul = owner ? owner.dmgMul : 1
        for (const f of this.fighters) {
          if (!f.alive || (owner ? !this.isEnemy(owner, f) : f.team === d.team)) continue
          if (Math.hypot(f.x - d.x, f.z - d.z) > POWER.toxin.radius) continue
          const fresh = !this.hasStatus(f, 'toxin')
          if (this.addStatus(f, 'toxin', now + 0.6, d.owner, POWER.toxin.dps * mul)) {
            this.addStatus(f, 'slow', now + 0.6, d.owner, POWER.toxin.slow)
            // Gas shuts down channel and charge kits (flamethrower, Heat Vent, Bulwark Dash): say so.
            if (fresh && (f.hero.weapon.kind === 'flame' || f.hero.power === 'vent' || f.hero.superKind === 'bulwark') && now - f.noticeAt > 1.5) {
              f.noticeAt = now
              this.counter('choke', f.x, f.z, d.owner, f.id)
            }
            if (f.channelUntil || (f.hero.superKind === 'bulwark' && f.superUntil > now)) this.interrupt(f, owner)
          }
        }
      } else if (d.kind === 'decoy') {
        this.stepDecoy(d, dt)
      } else if (d.kind === 'wall' && owner && owner.alive) {
        // Carried on the forearm shield, out in front along the aim.
        const nx = owner.x + Math.cos(owner.aim) * POWER.wall.dist
        const nz = owner.z + Math.sin(owner.aim) * POWER.wall.dist
        d.vx = (nx - d.x) / dt
        d.vz = (nz - d.z) / dt
        d.x = nx
        d.z = nz
        d.aim = owner.aim
      }
      keep.push(d)
    }
    this.deployables = keep
  }

  /** The hologram runs at the nearest enemy and circles at SMG range. */
  private stepDecoy(d: Deployable, dt: number) {
    let best: Fighter | null = null
    let bestD = 18
    for (const f of this.fighters) {
      if (!f.alive || !this.isEnemy({ id: d.owner, team: d.team }, f)) continue
      const dist = Math.hypot(f.x - d.x, f.z - d.z)
      if (dist < bestD) {
        bestD = dist
        best = f
      }
    }
    let vx = Math.cos(d.aim) * POWER.blink.decoySpeed
    let vz = Math.sin(d.aim) * POWER.blink.decoySpeed
    if (best) {
      const nx = (best.x - d.x) / (bestD || 1)
      const nz = (best.z - d.z) / (bestD || 1)
      d.aim = Math.atan2(nz, nx)
      const fwd = bestD > 5 ? 1 : bestD < 3 ? -0.4 : 0
      vx = (nx * fwd - nz * 0.7) * POWER.blink.decoySpeed
      vz = (nz * fwd + nx * 0.7) * POWER.blink.decoySpeed
    }
    const nx = d.x + vx * dt
    const nz = d.z + vz * dt
    if (this.fits(nx, d.z)) d.x = nx
    if (this.fits(d.x, nz)) d.z = nz
    d.vx = vx
    d.vz = vz
  }

  /* ---------- Pickups (loot and coin shards) ---------- */

  private stepPickups(dt: number) {
    if (!this.pickups.length) return
    const keep: Pickup[] = []
    const now = this.time
    for (const p of this.pickups) {
      if (now > p.until) continue
      let taken = false
      for (const f of this.fighters) {
        if (!f.alive) continue
        const d = Math.hypot(f.x - p.x, f.z - p.z)
        if (d > FIGHTER_R + 0.5) {
          // Magnet: drag it in.
          if (d < POWERUP.magnetRange && f.statuses.length && this.hasStatus(f, 'magnet')) {
            const step = Math.min(d, POWERUP.magnetPull * dt)
            p.x += ((f.x - p.x) / d) * step
            p.z += ((f.z - p.z) / d) * step
          }
          continue
        }
        this.applyLoot(f, p.kind)
        this.events.push({ t: 'pickup', id: f.id, kind: p.kind })
        taken = true
        break
      }
      if (!taken) keep.push(p)
    }
    this.pickups = keep
  }

  private applyLoot(f: Fighter, kind: LootKind) {
    if (kind === 'shard') {
      f.coins += POWERUP.shardCoins
      return
    }
    f.loot++
    switch (kind) {
      case 'medkit':
        this.heal(f, f.maxHp * 0.6, null, true)
        break
      case 'plating':
        f.maxHp += 300
        f.hp += 300
        break
      case 'overclock':
        f.dmgMul *= 1.15
        break
      case 'servo':
        f.speed *= 1.1
        break
      case 'cell':
        f.super = Math.min(1, f.super + 0.5)
        break
    }
  }

  /* ---------- Power-up pads ---------- */

  private stepPads() {
    const now = this.time
    for (const p of this.pads) {
      if (now < p.readyAt) continue
      for (const f of this.fighters) {
        if (!f.alive || Math.hypot(f.x - p.x, f.z - p.z) > FIGHTER_R + 0.6) continue
        this.applyPowerUp(f, p.kind)
        this.events.push({ t: 'powerup', id: f.id, kind: p.kind, x: p.x, z: p.z })
        p.spawns++
        p.kind = padKind(p.slot, p.spawns, this.mode === 'br', p.centre)
        p.readyAt = now + (p.centre ? POWERUP.centreRespawn : POWERUP.respawn)
        break
      }
    }
  }

  private applyPowerUp(f: Fighter, kind: PowerUpKind) {
    const now = this.time
    const def = POWERUPS[kind]
    switch (kind) {
      case 'hyper':
      case 'haste':
      case 'amp':
      case 'ricochet':
      case 'magnet':
        this.addStatus(f, kind, now + def.dur, f.id, 1)
        break
      case 'overshield':
        f.shield = Math.max(f.shield, POWERUP.overshield)
        f.shieldUntil = Math.max(f.shieldUntil, now + def.dur)
        this.addStatus(f, 'overshield', now + def.dur, f.id, 1)
        break
      case 'phase':
        if (this.hasStatus(f, 'revealed')) break
        f.cloakUntil = Math.max(f.cloakUntil, now + def.dur)
        this.addStatus(f, 'phased', now + def.dur, f.id, 1)
        break
      case 'reset':
        f.powerCd = 0
        f.dashCd = 0
        f.super = Math.min(1, f.super + 0.25)
        break
      case 'medkit':
        this.heal(f, f.maxHp * 0.5, null, true)
        break
      case 'revive':
        this.addStatus(f, 'revive', Infinity, f.id, 1)
        break
    }
  }

  /* ---------- Modes ---------- */

  private stepZone(dt: number) {
    this.zoneTick += dt
    if (this.zoneTick < 1) return
    this.zoneTick -= 1
    let a = 0
    let b = 0
    for (const f of this.fighters) {
      if (!f.alive) continue
      if (Math.hypot(f.x - this.objective.x, f.z - this.objective.z) > this.map.zone) continue
      if (f.team === 0) a++
      else b++
    }
    if (a && !b) {
      this.score[0]++
      this.events.push({ t: 'score', team: 0, score: this.score[0] })
    } else if (b && !a) {
      this.score[1]++
      this.events.push({ t: 'score', team: 1, score: this.score[1] })
    }
  }

  /** Whether a fighter is inside the Core Control zone. */
  inZone(f: Fighter) {
    return this.mode === 'capture' && Math.hypot(f.x - this.objective.x, f.z - this.objective.z) <= this.map.zone
  }

  private planShrink() {
    const g = this.br!
    const nextHalf = Math.max(4, g.half * 0.6)
    const slack = g.half - nextHalf
    g.nextHalf = nextHalf
    g.nextCx = g.cx + this.rng.range(-slack, slack) * 0.8
    g.nextCz = g.cz + this.rng.range(-slack, slack) * 0.8
    g.fromCx = g.cx
    g.fromCz = g.cz
    g.fromHalf = g.half
  }

  private stepGrid(_dt: number) {
    const g = this.br!
    if (this.time >= g.shrinkAt) {
      const t = Math.min(1, (this.time - g.shrinkAt) / BR_SHRINK_TIME)
      const e = t * t * (3 - 2 * t)
      g.cx = g.fromCx + (g.nextCx - g.fromCx) * e
      g.cz = g.fromCz + (g.nextCz - g.fromCz) * e
      g.half = g.fromHalf + (g.nextHalf - g.fromHalf) * e
      if (t >= 1) {
        g.stage++
        g.dps = 40 + g.stage * 45
        this.events.push({ t: 'grid', stage: g.stage })
        g.shrinkAt = this.time + BR_HOLD
        g.shrinkEnd = g.shrinkAt + BR_SHRINK_TIME
        this.planShrink()
      }
    }
  }

  private checkEnd() {
    if (this.mode === 'br') {
      const alive = this.fighters.filter((f) => f.alive)
      if (alive.length <= 1 || this.time >= this.timeLimit) {
        let w = alive[0]
        if (alive.length > 1) w = alive.reduce((a, b) => (b.hp / b.maxHp > a.hp / a.maxHp ? b : a))
        if (w) w.placement = 1
        for (const f of alive) if (f !== w) f.placement = 2
        this.finish(w ? w.id : 0)
      }
      return
    }
    const [a, b] = this.score
    if (a >= this.target || b >= this.target || this.time >= this.timeLimit) {
      if (a === b && this.time >= this.timeLimit) {
        // Overtime: next point wins, up to 30 s.
        if (this.time < this.timeLimit + 30) return
        this.finish(-1)
      } else this.finish(a > b ? 0 : 1)
    }
  }

  private finish(winner: number) {
    this.phase = 'over'
    this.winner = winner
    this.events.push({ t: 'end', winner })
  }

  /* ---------- Snapshot ---------- */

  buildSnap(): Snap {
    const now = this.time
    const bt: number[] = []
    return {
      t: now,
      f: this.fighters.map((f) => {
        let mask = 0
        for (const s of f.statuses) {
          if (s.until <= now) continue
          const i = STATUS_KINDS.indexOf(s.kind)
          mask |= 1 << i
          bt.push(f.id, i, round(Math.min(99, s.until - now)))
        }
        return [
          f.id,
          round(f.x),
          round(f.z),
          round(f.aim),
          Math.round(f.hp),
          f.maxHp,
          (f.alive ? 1 : 0) | (f.cloakUntil ? 2 : 0) | (f.shield > 0 ? 4 : 0) | (f.superUntil ? 8 : 0) | (f.dashUntil ? 16 : 0) | (now < f.spawnShieldUntil ? 32 : 0) | (f.out ? 64 : 0) | (f.channelUntil ? 128 : 0),
          round(f.super),
          round(f.vx),
          round(f.vz),
          Math.round(f.shield),
          mask,
          round(f.powerCd),
          round(f.dashCd),
          f.coins,
        ]
      }),
      p: this.projectiles.map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), round(p.x), round(p.z), round(p.y), round(p.vx), round(p.vz), p.owner]),
      d: this.deployables.map((d) => [d.id, DEPLOY_KINDS.indexOf(d.kind), round(d.x), round(d.z), Math.round(d.hp), round(d.aim), now >= d.armAt ? 1 : 0, d.team, d.owner, round(d.vx), round(d.vz)]),
      c: this.crates.map((c) => Math.max(0, Math.round(c.hp))),
      k: this.pickups.map((k) => [k.id, round(k.x), round(k.z), LOOT_KINDS.indexOf(k.kind)]),
      pd: this.pads.map((p) => [p.id, round(p.x), round(p.z), POWERUP_KINDS.indexOf(p.kind), round(Math.max(0, p.readyAt - now))]),
      bt,
      s: [this.score[0], this.score[1]],
      ph: this.phase === 'countdown' ? 0 : this.phase === 'play' ? 1 : 2,
      cd: round(this.countdown),
      w: this.winner,
      br: this.br ? [round(this.br.cx), round(this.br.cz), round(this.br.half), round(this.br.nextCx), round(this.br.nextCz), round(this.br.nextHalf), round(this.br.shrinkAt), this.br.stage, this.aliveCount()] : null,
    }
  }
}

function round(v: number) {
  return Math.round(v * 100) / 100
}

/** Parametric hit (0..1) of segment a→b against a circle, or -1. */
export function segCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, r: number) {
  const dx = bx - ax
  const dz = bz - az
  const fx = ax - cx
  const fz = az - cz
  const a = dx * dx + dz * dz
  if (a < 1e-9) return Math.hypot(fx, fz) <= r ? 0 : -1
  const b = 2 * (fx * dx + fz * dz)
  const c = fx * fx + fz * fz - r * r
  let disc = b * b - 4 * a * c
  if (disc < 0) return -1
  disc = Math.sqrt(disc)
  const t1 = (-b - disc) / (2 * a)
  if (t1 >= 0 && t1 <= 1) return t1
  const t2 = (-b + disc) / (2 * a)
  if (t2 >= 0 && t2 <= 1) return 0
  return -1
}

/** Parameter (0..1) along p0→p1 where it crosses segment a→b, or -1. */
export function segSeg(x0: number, z0: number, x1: number, z1: number, ax: number, az: number, bx: number, bz: number) {
  const rx = x1 - x0
  const rz = z1 - z0
  const sx = bx - ax
  const sz = bz - az
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return -1
  const qx = ax - x0
  const qz = az - z0
  const t = (qx * sz - qz * sx) / den
  const u = (qx * rz - qz * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1
}

/** Distance from a point to a segment. */
export function segPointDist(e: { ax: number; az: number; bx: number; bz: number }, x: number, z: number) {
  const dx = e.bx - e.ax
  const dz = e.bz - e.az
  const l2 = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((x - e.ax) * dx + (z - e.az) * dz) / l2))
  return Math.hypot(e.ax + dx * t - x, e.az + dz * t - z)
}

export const SNAP_FLAGS = { alive: 1, cloak: 2, shield: 4, superOn: 8, dash: 16, spawnShield: 32, out: 64, channel: 128 }

/** Snapshot fighter row indices past the original eleven. */
export const SNAP_F = { status: 11, powerCd: 12, dashCd: 13, coins: 14 }
