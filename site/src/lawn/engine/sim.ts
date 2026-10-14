// LAWN WARS simulation: pure, deterministic, 60 Hz. Two households on one street, first-person melee with light
// and heavy swings, blocking and parries, thrown junk, traps, ladders, breakable houses with tagged valuables,
// hero ultimates, chaos events and three modes (Destruction, Brawl, Robot Invasion). The host runs it; the view
// and the network only read snapshots and events.
import { Bot, RobotBrain } from './bots.ts'
import { TOOLS, THROWABLES, TRAPS, type ThrowKind, type ToolKind, type TrapKind } from './gear.ts'
import { HEROES, type Hero, type HeroId } from './heroes.ts'
import { BARRICADE_HP, DOOR_HP, FLOOR_H, type HouseInfo, type LayoutId, insideHouse } from './houses.ts'
import { buildWorld, MAPS, type MapId, type TimeOfDay, type WorldSetup } from './maps.ts'
import { Nav } from './nav.ts'
import { boxOf, overlaps, PieceHash, type Box, type Piece } from './pieces.ts'
import { Rng } from './rng.ts'

export type ModeId = 'destruction' | 'brawl' | 'robots'
export const MODE_INFO: Record<ModeId, { name: string; blurb: string; players: number; teams: boolean }> = {
  destruction: { name: 'Destruction', blurb: '4v4. Sixty seconds to trap your house, then eight minutes to wreck theirs. Points for every valuable you break.', players: 8, teams: true },
  brawl: { name: 'Brawl', blurb: '4v4 on the street. Most knockouts in five minutes wins.', players: 8, teams: true },
  robots: { name: 'Robot Invasion', blurb: '1–4 players defend one house against ten waves of garden robots.', players: 4, teams: false },
}

export const GRAVITY = 22
export const STEP = 0.55
export const TINY_STEP = 0.95
export const JUMP_V = 7.2

export interface Input {
  /** Strafe (x) and forward (z), -1..1 in the player's frame. */
  mx: number
  mz: number
  yaw: number
  pitch: number
  jump: boolean
  sprint: boolean
  crouch: boolean
  /** Edge-triggered actions (true for one step). */
  light: boolean
  heavy: boolean
  throw: boolean
  use: boolean
  ladder: boolean
  ult: boolean
  /** Held. */
  block: boolean
  /** Slingshot draw 0..1 at release. */
  charge: number
  /** Selected trap slot (index into the loadout). */
  slot: number
}

export const emptyInput = (): Input => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, jump: false, sprint: false, crouch: false, light: false, heavy: false, throw: false, use: false, ladder: false, ult: false, block: false, charge: 1, slot: 0 })

export interface RosterEntry {
  name: string
  hero: HeroId
  team: number
  human: boolean
  peer?: string
  /** Perk levels unlocked (0..2) and chosen colours. */
  perks?: number
  colour?: string
  throwKind?: ThrowKind
  traps?: TrapKind[]
}

export interface Player {
  id: number
  name: string
  hero: Hero
  team: number
  human: boolean
  peer?: string
  robot: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
  hp: number
  maxHp: number
  stamina: number
  maxStamina: number
  alive: boolean
  respawnAt: number
  spawnShield: number
  onGround: boolean
  onLadder: Piece | null
  crouch: boolean
  sprinting: boolean
  moving: boolean
  /** Melee state. */
  swing: { heavy: boolean; t: number; done: boolean } | null
  blocking: boolean
  blockSince: number
  stagger: number
  stun: number
  root: number
  slip: number
  wet: number
  sticky: number
  fine: number
  blind: number
  burn: number
  pit: number
  glide: boolean
  /** Ultimate charge 0..1 and the active ultimate's end time. */
  ult: number
  ultUntil: number
  ultKind: Hero['ult'] | null
  throwKind: ThrowKind
  throwAmmo: number
  traps: TrapKind[]
  trapAmmo: number[]
  ladders: number
  tool: ToolKind | null
  carrying: Piece | null
  kills: number
  deaths: number
  damage: number
  score: number
  breaks: number
  placedTraps: number
  ultsUsed: number
  lastHitBy: number
  regenAt: number
  input: Input
  bot: Bot | RobotBrain | null
  perks: number
  colour: string
  /** Animation for the view (0 idle, 1 walk, 2 run, 3 jump, 4 light, 5 heavy, 6 hit, 7 ko, 8 throw, 9 climb, 10 block, 11 crouch, 12 ride). */
  anim: number
  animAt: number
  /** Timers for the view. */
  hitAt: number
}

export interface Projectile {
  id: number
  kind: ThrowKind | 'pebble' | 'rccar' | 'towtruck' | 'icecream'
  owner: number
  team: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  life: number
  bounced: boolean
  dmg: number
  pieces: number
}

export interface TrapInst {
  id: number
  kind: TrapKind
  team: number
  owner: number
  x: number
  y: number
  z: number
  armed: boolean
  rearmAt: number
  revealed: boolean
  /** The victim held in it (bear trap / pit). */
  victim: number
  yaw: number
}

export interface Zone {
  id: number
  kind: 'cookies' | 'sticky' | 'wet' | 'alarm' | 'blower'
  team: number
  owner: number
  x: number
  y: number
  z: number
  r: number
  until: number
  yaw: number
  tick: number
}

export interface Chaos {
  kind: 'seagulls' | 'icecream' | 'rain'
  until: number
  tick: number
  x: number
}

export interface SimOptions {
  map: MapId
  mode: ModeId
  seed: number
  roster: RosterEntry[]
  time?: TimeOfDay
  layouts?: [LayoutId, LayoutId]
  themes?: [string, string]
  prepSeconds?: number
  raidSeconds?: number
  difficulty?: number
  brawlTarget?: number
  waves?: number
}

export type HitKind = 'melee' | 'throw' | 'ult' | 'trap' | 'burn' | 'robot'

export type SimEvent =
  | { t: 'prep' }
  | { t: 'start' }
  | { t: 'end'; winner: number }
  | { t: 'hit'; id: number; by: number; x: number; y: number; z: number; dmg: number; kind: HitKind; heavy: boolean; blocked: boolean }
  | { t: 'swing'; id: number; heavy: boolean; hit: boolean }
  | { t: 'parry'; id: number; by: number; x: number; y: number; z: number }
  | { t: 'chip'; id: number; chip: number; x: number; y: number; z: number; hp: number }
  | { t: 'break'; id: number; x: number; y: number; z: number; model: string; by: number; value: number; team: number; house: number }
  | { t: 'throw'; id: number; kind: Projectile['kind']; x: number; y: number; z: number }
  | { t: 'splash'; kind: Projectile['kind']; x: number; y: number; z: number; hit: number }
  | { t: 'trap'; id: number; kind: TrapKind; x: number; y: number; z: number; team: number; yaw: number }
  | { t: 'trip'; id: number; kind: TrapKind; victim: number; x: number; y: number; z: number }
  | { t: 'ladder'; id: number; x: number; y: number; z: number; yaw: number; top: number; team: number }
  | { t: 'barricade'; id: number; level: number; x: number; y: number; z: number }
  | { t: 'ko'; id: number; by: number; x: number; y: number; z: number }
  | { t: 'respawn'; id: number; x: number; y: number; z: number }
  | { t: 'ult'; id: number; kind: Hero['ult']; x: number; y: number; z: number; yaw: number }
  | { t: 'explode'; x: number; y: number; z: number; r: number; kind: string }
  | { t: 'score'; team: number; value: number; total: number; name: string; by: number }
  | { t: 'pickup'; id: number; piece: number }
  | { t: 'drop'; id: number; piece: number; x: number; y: number; z: number; yaw: number }
  | { t: 'tool'; id: number; tool: ToolKind }
  | { t: 'wave'; n: number; count: number }
  | { t: 'chaos'; kind: Chaos['kind']; on: boolean }
  | { t: 'alarm'; x: number; z: number; victim: number; team: number }
  | { t: 'seagull'; victim: number; stole: boolean }
  | { t: 'heal'; id: number; amount: number }
  | { t: 'removed'; id: number }

/** Flags packed into the player snapshot row. */
export const PF = {
  alive: 1,
  ground: 2,
  block: 4,
  crouch: 8,
  sprint: 16,
  ladder: 32,
  stun: 64,
  root: 128,
  wet: 256,
  glide: 512,
  swing: 1024,
  heavy: 2048,
  blind: 4096,
  burn: 8192,
  riding: 16384,
  moving: 32768,
  pit: 65536,
  robot: 131072,
  sticky: 262144,
  fine: 524288,
  shield: 1048576,
  carry: 2097152,
}

export interface Snap {
  t: number
  /** 0 prep, 1 play, 2 over. */
  ph: number
  /** Seconds left in the phase. */
  left: number
  s: [number, number]
  w: number
  /** Players: [id, x, y, z, yaw, pitch, hp, maxHp, flags, anim, ult, stamina, carry, toolIdx, throwAmmo, trapAmmo, ladders]. */
  p: number[][]
  /** Projectiles: [id, kindIdx, x, y, z, yaw]. */
  pr: number[][]
  /** Traps: [id, kindIdx, x, y, z, team, armed, revealed, yaw]. */
  tr: number[][]
  /** Zones: [id, kindIdx, x, y, z, r, team, yaw]. */
  zn: number[][]
  /** Valuables left per house. */
  v: [number, number]
  wave: number
  waveLeft: number
  chaos: number
  chaosX: number
}

export const PROJ_KINDS: Projectile['kind'][] = ['balloon', 'gnome', 'egg', 'paint', 'jar', 'golfball', 'pebble', 'rccar', 'towtruck', 'icecream']
export const TRAP_KINDS: TrapKind[] = ['beartrap', 'rake', 'marbles', 'alarm', 'sprinkler', 'pit']
export const ZONE_KINDS: Zone['kind'][] = ['cookies', 'sticky', 'wet', 'alarm', 'blower']
export const TOOL_KINDS: ToolKind[] = ['rake', 'shovel', 'pan', 'hose', 'bat', 'hammer']
export const CHAOS_KINDS: Chaos['kind'][] = ['seagulls', 'icecream', 'rain']

export class Sim {
  readonly mode: ModeId
  readonly mapId: MapId
  readonly time_: TimeOfDay
  readonly world: WorldSetup
  readonly houses: HouseInfo[]
  readonly pieces: Piece[]
  readonly byId = new Map<number, Piece>()
  readonly hash = new PieceHash(3)
  readonly nav: Nav
  readonly rng: Rng
  readonly players: Player[] = []
  projectiles: Projectile[] = []
  traps: TrapInst[] = []
  zones: Zone[] = []
  ladders: Piece[] = []
  events: SimEvent[] = []
  time = 0
  phase: 'prep' | 'play' | 'over' = 'prep'
  phaseEnds = 0
  score: [number, number] = [0, 0]
  winner = -1
  wave = 0
  waveNextAt = 0
  waves: number
  chaos: Chaos | null = null
  nextChaosAt = 0
  readonly prepSeconds: number
  readonly raidSeconds: number
  readonly brawlTarget: number
  readonly difficulty: number
  private seq = 1000
  private tmp: Piece[] = []
  private step_ = 0

  constructor(o: SimOptions) {
    this.mode = o.mode
    this.mapId = o.map
    this.time_ = o.time ?? 'day'
    this.rng = new Rng(o.seed)
    this.world = buildWorld(o.map, o.layouts ?? ['classic', 'classic'], o.themes ?? MAPS[o.map].theme.day.houseThemes, o.seed)
    this.houses = this.world.houses
    this.pieces = this.world.pieces
    for (const p of this.pieces) {
      this.byId.set(p.id, p)
      if (p.solid || p.kind === 'door') this.hash.add(p)
    }
    this.difficulty = o.difficulty ?? 0.7
    this.prepSeconds = o.prepSeconds ?? (o.mode === 'destruction' ? 60 : o.mode === 'robots' ? 40 : 0)
    this.raidSeconds = o.raidSeconds ?? (o.mode === 'destruction' ? 480 : o.mode === 'brawl' ? 300 : 900)
    this.brawlTarget = o.brawlTarget ?? 25
    this.waves = o.waves ?? 10
    this.nav = new Nav(this)
    let id = 1
    for (const r of o.roster) this.addPlayer(id++, r)
    if (this.prepSeconds > 0) {
      this.phase = 'prep'
      this.phaseEnds = this.prepSeconds
      this.events.push({ t: 'prep' })
    } else this.beginPlay()
    this.nextChaosAt = this.prepSeconds + 75 + this.rng.range(0, 40)
  }

  /* ---------- roster ---------- */

  private addPlayer(id: number, r: RosterEntry) {
    const hero = HEROES[r.hero]
    const perks = r.perks ?? 0
    let hp = hero.hp
    let stamina = 100
    let throwAmmo = 0
    let trapAmmo = 0
    let ladders = 1
    for (let i = 0; i < perks && i < 2; i++) {
      const m = hero.perks[i].mods
      hp += m.hp ?? 0
      stamina += m.stamina ?? 0
      throwAmmo += m.throwAmmo ?? 0
      trapAmmo += m.trapAmmo ?? 0
      ladders += m.ladders ?? 0
    }
    const throwKind = r.throwKind ?? defaultThrow(hero.id)
    const traps = r.traps?.length ? r.traps.slice(0, 3) : defaultTraps(hero.id)
    const p: Player = {
      id,
      name: r.name,
      hero,
      team: r.team,
      human: r.human,
      peer: r.peer,
      robot: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      hp,
      maxHp: hp,
      stamina,
      maxStamina: stamina,
      alive: true,
      respawnAt: 0,
      spawnShield: 0,
      onGround: true,
      onLadder: null,
      crouch: false,
      sprinting: false,
      moving: false,
      swing: null,
      blocking: false,
      blockSince: -10,
      stagger: 0,
      stun: 0,
      root: 0,
      slip: 0,
      wet: 0,
      sticky: 0,
      fine: 0,
      blind: 0,
      burn: 0,
      pit: 0,
      glide: false,
      ult: 0,
      ultUntil: 0,
      ultKind: null,
      throwKind,
      throwAmmo: THROWABLES[throwKind].ammo + throwAmmo,
      traps,
      trapAmmo: traps.map((t) => TRAPS[t].ammo + (trapAmmo > 0 ? 1 : 0)),
      ladders,
      tool: null,
      carrying: null,
      kills: 0,
      deaths: 0,
      damage: 0,
      score: 0,
      breaks: 0,
      placedTraps: 0,
      ultsUsed: 0,
      lastHitBy: 0,
      regenAt: 0,
      input: emptyInput(),
      bot: null,
      perks,
      colour: r.colour ?? hero.colors[0],
      anim: 0,
      animAt: 0,
      hitAt: -10,
    }
    this.players.push(p)
    this.spawn(p, true)
    if (!r.human) p.bot = new Bot(this, p, this.difficulty)
  }

  /** Turn a seat into a bot or a human (players joining / leaving mid-match). */
  setHuman(id: number, human: boolean, peer?: string, name?: string) {
    const p = this.player(id)
    if (!p) return
    p.human = human
    if (peer !== undefined) p.peer = peer
    if (name) p.name = name
    p.bot = human ? null : new Bot(this, p, this.difficulty)
    if (human) p.input = emptyInput()
  }

  player(id: number) {
    return this.players.find((p) => p.id === id)
  }

  setInput(id: number, input: Input) {
    const p = this.player(id)
    if (p && !p.bot) p.input = input
  }

  private spawn(p: Player, first: boolean) {
    const sp = this.spawnPoint(p)
    p.x = sp.x
    p.y = sp.y
    p.z = sp.z
    p.yaw = sp.yaw
    p.pitch = 0
    p.vx = p.vy = p.vz = 0
    p.hp = p.maxHp
    p.stamina = p.maxStamina
    p.alive = true
    p.swing = null
    p.blocking = false
    p.stagger = p.stun = p.root = p.slip = p.wet = p.sticky = p.fine = p.blind = p.burn = p.pit = 0
    p.onLadder = null
    p.carrying = null
    p.glide = false
    p.ultUntil = 0
    p.ultKind = null
    p.spawnShield = this.time + (first ? 0 : 2.5)
    p.tool = null
    if (!p.bot) p.input = emptyInput()
    p.input.yaw = sp.yaw
    if (!first) this.events.push({ t: 'respawn', id: p.id, x: p.x, y: p.y, z: p.z })
  }

  private spawnPoint(p: Player) {
    if (p.robot) {
      const s = this.rng.pick(this.world.robotSpawns)
      return { x: s.x + this.rng.range(-1.5, 1.5), y: 0, z: s.z + this.rng.range(-1.5, 1.5), yaw: 0 }
    }
    if (this.mode === 'brawl') {
      const list = this.world.brawlSpawns
      const s = list[(p.id + Math.floor(this.time)) % list.length]
      return { x: s.x + this.rng.range(-1, 1), y: 0, z: s.z + this.rng.range(-1, 1), yaw: s.yaw }
    }
    const house = this.houses[p.team] ?? this.houses[0]
    const s = house.spawns[p.id % house.spawns.length]
    return { x: s.x, y: 0, z: s.z, yaw: s.yaw }
  }

  /* ---------- phases ---------- */

  private beginPlay() {
    this.phase = 'play'
    this.phaseEnds = this.time + this.raidSeconds
    this.events.push({ t: 'start' })
    if (this.mode === 'robots') this.startWave(1)
  }

  private startWave(n: number) {
    this.wave = n
    const count = Math.min(11, 2 + n) | 0
    for (let i = 0; i < count; i++) this.addRobot(n)
    this.waveNextAt = this.time + 70
    this.events.push({ t: 'wave', n, count })
  }

  private addRobot(wave: number) {
    const hero = HEROES.dog
    const id = this.seq++
    const p: Player = {
      id,
      name: `Robot ${id - 1000}`,
      hero,
      team: 1,
      human: false,
      robot: true,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      hp: 45 + wave * 7,
      maxHp: 45 + wave * 7,
      stamina: 100,
      maxStamina: 100,
      alive: true,
      respawnAt: 0,
      spawnShield: 0,
      onGround: true,
      onLadder: null,
      crouch: false,
      sprinting: false,
      moving: false,
      swing: null,
      blocking: false,
      blockSince: -10,
      stagger: 0,
      stun: 0,
      root: 0,
      slip: 0,
      wet: 0,
      sticky: 0,
      fine: 0,
      blind: 0,
      burn: 0,
      pit: 0,
      glide: false,
      ult: 0,
      ultUntil: 0,
      ultKind: null,
      throwKind: 'gnome',
      throwAmmo: 0,
      traps: [],
      trapAmmo: [],
      ladders: 0,
      tool: null,
      carrying: null,
      kills: 0,
      deaths: 0,
      damage: 0,
      score: 0,
      breaks: 0,
      placedTraps: 0,
      ultsUsed: 0,
      lastHitBy: 0,
      regenAt: 0,
      input: emptyInput(),
      bot: null,
      perks: 0,
      colour: '#8fa3b8',
      anim: 0,
      animAt: 0,
      hitAt: -10,
    }
    this.players.push(p)
    const sp = this.spawnPoint(p)
    p.x = sp.x
    p.z = sp.z
    p.bot = new RobotBrain(this, p, wave)
  }

  /* ---------- queries ---------- */

  /** Solid pieces overlapping a box. */
  solidsIn(b: Box) {
    const out = this.hash.query(b, this.tmp)
    const res: Piece[] = []
    for (const p of out) if (p.solid && p.alive && overlaps(boxOf(p), b)) res.push(p)
    return res
  }

  /** Highest floor under a point, at or below y + tolerance. */
  floorAt(x: number, z: number, y: number, tol = 0.3) {
    const b: Box = { x0: x - 0.3, y0: -1, z0: z - 0.3, x1: x + 0.3, y1: y + tol, z1: z + 0.3 }
    let best = 0
    for (const p of this.hash.query(b, this.tmp)) {
      if (!p.solid || !p.alive) continue
      const pb = boxOf(p)
      if (pb.x0 < b.x1 && pb.x1 > b.x0 && pb.z0 < b.z1 && pb.z1 > b.z0 && pb.y1 <= y + tol && pb.y1 > best) best = pb.y1
    }
    return best
  }

  /** Ray against solid pieces: first hit within `max` metres. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, filter?: (p: Piece) => boolean) {
    const b: Box = { x0: Math.min(ox, ox + dx * max) - 0.1, y0: Math.min(oy, oy + dy * max) - 0.1, z0: Math.min(oz, oz + dz * max) - 0.1, x1: Math.max(ox, ox + dx * max) + 0.1, y1: Math.max(oy, oy + dy * max) + 0.1, z1: Math.max(oz, oz + dz * max) + 0.1 }
    let best: { piece: Piece; t: number; nx: number; ny: number; nz: number } | null = null
    for (const p of this.hash.query(b, this.tmp)) {
      if (!p.alive || (!p.solid && p.kind !== 'door' && p.model !== 'ladder')) continue
      if (filter && !filter(p)) continue
      const hit = rayBox(ox, oy, oz, dx, dy, dz, boxOf(p))
      if (hit && hit.t <= max && (!best || hit.t < best.t)) best = { piece: p, ...hit }
    }
    return best
  }

  lineClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax
    const dy = by - ay
    const dz = bz - az
    const l = Math.hypot(dx, dy, dz) || 1
    return !this.raycast(ax, ay, az, dx / l, dy / l, dz / l, l, (p) => p.kind !== 'window' || p.alive)
  }

  houseAt(x: number, z: number) {
    for (const h of this.houses) if (insideHouse(h, x, z)) return h.team
    return -1
  }

  valuablesLeft(team: number) {
    return this.houses[team].valuables.filter((v) => v.alive).length
  }

  aliveCount(team: number) {
    let n = 0
    for (const p of this.players) if (p.alive && p.team === team) n++
    return n
  }

  /* ---------- step ---------- */

  step(dt: number) {
    this.events = []
    if (this.phase === 'over') return
    this.time += dt
    this.step_++
    if (this.phase === 'prep' && this.time >= this.phaseEnds) this.beginPlay()
    for (const p of this.players) {
      if (p.bot) p.bot.think(dt)
      this.stepPlayer(p, dt)
    }
    this.stepProjectiles(dt)
    this.stepTraps(dt)
    this.stepZones(dt)
    this.stepChaos(dt)
    if (this.phase === 'play') this.checkEnd()
  }

  private checkEnd() {
    const timeUp = this.time >= this.phaseEnds
    if (this.mode === 'destruction') {
      const a = this.valuablesLeft(1) === 0
      const b = this.valuablesLeft(0) === 0
      if (timeUp || a || b) this.finish(this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : a ? 0 : b ? 1 : -1)
    } else if (this.mode === 'brawl') {
      if (timeUp || this.score[0] >= this.brawlTarget || this.score[1] >= this.brawlTarget) this.finish(this.score[0] > this.score[1] ? 0 : this.score[1] > this.score[0] ? 1 : -1)
    } else {
      if (this.valuablesLeft(0) === 0 || timeUp) {
        this.finish(1)
        return
      }
      const robotsAlive = this.players.some((p) => p.robot && p.alive)
      if (!robotsAlive || this.time >= this.waveNextAt) {
        // Clean up the dead robots, then the next wave (or the win).
        for (let i = this.players.length - 1; i >= 0; i--) if (this.players[i].robot && !this.players[i].alive) this.players.splice(i, 1)
        if (this.wave >= this.waves && !robotsAlive) this.finish(0)
        else if (this.wave < this.waves) this.startWave(this.wave + 1)
        else this.waveNextAt = this.time + 70
      }
    }
  }

  private finish(winner: number) {
    this.phase = 'over'
    this.winner = winner
    this.events.push({ t: 'end', winner })
  }

  /* ---------- players ---------- */

  private stepPlayer(p: Player, dt: number) {
    if (!p.alive) {
      if (p.robot) return
      if (this.time >= p.respawnAt) this.spawn(p, false)
      return
    }
    const inp = p.input
    const hero = p.hero
    const tiny = !!hero.tiny
    p.yaw = inp.yaw
    p.pitch = Math.max(-1.45, Math.min(1.45, inp.pitch))
    // Timers.
    const tick = (v: number) => Math.max(0, v - dt)
    p.stagger = tick(p.stagger)
    p.stun = tick(p.stun)
    p.root = tick(p.root)
    p.slip = tick(p.slip)
    p.wet = tick(p.wet)
    p.sticky = tick(p.sticky)
    p.fine = tick(p.fine)
    p.blind = tick(p.blind)
    p.burn = tick(p.burn)
    p.pit = tick(p.pit)
    const riding = p.ultKind === 'mower' && this.time < p.ultUntil
    const zooming = p.ultKind === 'zoomies' && this.time < p.ultUntil
    const disabled = p.stun > 0 || p.slip > 0 || p.pit > 0 || p.stagger > 0
    const held = p.root > 0 || disabled
    p.crouch = inp.crouch && !riding
    // Blocking (held, not while swinging or disabled).
    const wantBlock = inp.block && !p.swing && !disabled && !riding && !p.carrying
    if (wantBlock && !p.blocking) p.blockSince = this.time
    p.blocking = wantBlock
    p.glide = !!hero.umbrella && p.blocking && inp.jump && !p.onGround && p.vy < 0
    // Stamina.
    const wantSprint = inp.sprint && !p.blocking && !p.crouch && p.stamina > 1 && (inp.mz > 0.2 || Math.abs(inp.mx) > 0.2) && !held
    p.sprinting = wantSprint && !riding
    if (p.sprinting) {
      p.stamina = Math.max(0, p.stamina - 16 * dt)
      p.regenAt = this.time + 0.7
    } else if (this.time > p.regenAt) p.stamina = Math.min(p.maxStamina, p.stamina + (hero.sprintBoost ? 22 : 15) * dt)
    // Speed.
    let speed = hero.speed
    if (p.sprinting) speed *= 1.42 * (1 + (hero.sprintBoost ?? 0))
    if (p.crouch) speed *= 0.55
    if (p.blocking) speed *= 0.62
    if (p.carrying) speed *= 0.7
    if (p.wet > 0) speed *= 0.78
    if (p.sticky > 0) speed *= 0.5
    if (p.fine > 0) speed *= 0.65
    if (p.swing) speed *= p.swing.heavy ? 0.45 : 0.8
    if (p.robot) speed = 3.2 + Math.min(1.6, this.wave * 0.12)
    if (held) speed = 0
    // Desired horizontal velocity in the world frame (yaw 0 faces +z).
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    let mx = inp.mx
    let mz = inp.mz
    const ml = Math.hypot(mx, mz)
    if (ml > 1) {
      mx /= ml
      mz /= ml
    }
    // Forward is (sin yaw, cos yaw); the camera looks along it with rotation.y = yaw + PI, so its right-hand side
    // (where D / stick-right should go) is (-cos yaw, sin yaw). The old (cos, -sin) sent D to the left.
    let wx = (sy * mz - cy * mx) * speed
    let wz = (cy * mz + sy * mx) * speed
    if (riding) {
      wx = sy * 11
      wz = cy * 11
    } else if (zooming) {
      wx = sy * 15
      wz = cy * 15
    }
    p.moving = ml > 0.1 && speed > 0
    // Slip keeps sliding; wet floors are slippery (slow to change direction).
    const accel = p.slip > 0 ? 0.6 : p.wet > 0 ? 4 : p.onGround ? 26 : 6
    const k = Math.min(1, accel * dt)
    p.vx += (wx - p.vx) * k
    p.vz += (wz - p.vz) * k
    // Ladder climbing.
    if (p.onLadder) {
      const l = p.onLadder
      if (!l.alive || p.hp <= 0) p.onLadder = null
      else {
        const climb = inp.mz * 2.9 + (inp.jump ? 1.5 : 0)
        p.vy = 0
        p.y += climb * dt
        // Stick to the ladder line.
        const fx = Math.sin(l.yaw)
        const fz = Math.cos(l.yaw)
        p.x += (l.x - fx * 0.55 - p.x) * Math.min(1, 10 * dt)
        p.z += (l.z - fz * 0.55 - p.z) * Math.min(1, 10 * dt)
        p.vx = p.vz = 0
        if (p.y >= (l.top ?? 3) + 0.25) {
          // Over the top: step onto the floor beyond the wall.
          p.x = l.x + fx * 1.2
          p.z = l.z + fz * 1.2
          p.y = (l.top ?? 3) + 0.3
          p.onLadder = null
          p.onGround = false
        } else if (p.y <= 0.05 && inp.mz < -0.2) {
          p.y = 0
          p.onLadder = null
        } else if (inp.jump && inp.mz < -0.2) {
          p.onLadder = null
          p.vy = 2
          p.x -= fx * 0.5
          p.z -= fz * 0.5
        }
        p.anim = 9
        this.updateFlags(p)
        return
      }
    }
    // Jump.
    if (inp.jump && p.onGround && !held && !p.crouch && !riding && p.stamina > 4) {
      p.vy = JUMP_V * (tiny ? 0.92 : 1)
      p.onGround = false
      p.stamina = Math.max(0, p.stamina - 6)
      p.regenAt = this.time + 0.5
    }
    // Gravity (gliding under the umbrella falls slowly).
    p.vy -= GRAVITY * dt * (p.glide ? 0.12 : 1)
    if (p.glide) p.vy = Math.max(p.vy, -1.6)
    this.moveBody(p, dt)
    // Grab a ladder when walking into one.
    if (!p.onLadder && (inp.mz > 0.3 || inp.jump) && !riding) {
      for (const l of this.ladders) {
        if (!l.alive) continue
        const fx = Math.sin(l.yaw)
        const fz = Math.cos(l.yaw)
        const lx = l.x - fx * 0.55
        const lz = l.z - fz * 0.55
        if (Math.hypot(p.x - lx, p.z - lz) < 0.75 && p.y < (l.top ?? 3) - 0.1 && p.y > -0.1) {
          // Must be facing the ladder (within 70°).
          const dot = Math.sin(p.yaw) * fx + Math.cos(p.yaw) * fz
          if (dot > 0.35 || !p.onGround) {
            p.onLadder = l
            p.vy = 0
            break
          }
        }
      }
    }
    // Actions.
    if (!disabled && !riding && !zooming) {
      if (p.swing) this.stepSwing(p, dt)
      else {
        if (inp.light && !p.blocking) this.startSwing(p, false, inp.charge)
        else if (inp.heavy && !p.blocking && p.stamina >= 18) this.startSwing(p, true, 1)
      }
      if (inp.throw && !p.swing && p.throwAmmo > 0 && !p.carrying) this.throwItem(p)
      if (inp.use) this.useAction(p)
      if (inp.ladder && p.ladders > 0 && !p.carrying) this.placeLadder(p)
    } else if (p.swing && p.stagger > 0) p.swing = null
    if (inp.ult && p.ult >= 1 && this.phase === 'play' && !disabled && !p.ultKind) this.useUlt(p)
    if (p.ultKind && this.time < p.ultUntil) this.stepUlt(p, dt)
    else if (p.ultKind && this.time >= p.ultUntil) p.ultKind = null
    // Burning from the cookie tray.
    if (p.burn > 0 && this.step_ % 30 === 0) this.damage(p, 6, p.lastHitBy, 'burn', false)
    // Carried valuable follows.
    if (p.carrying) {
      const c = p.carrying
      c.x = p.x + sy * 0.9
      c.z = p.z + cy * 0.9
      c.y = p.y + 0.4
    }
    // Animation.
    p.anim = !p.alive ? 7 : p.swing ? (p.swing.heavy ? 5 : 4) : p.stun > 0 || p.slip > 0 ? 6 : riding ? 12 : p.blocking ? 10 : !p.onGround ? 3 : p.crouch ? 11 : p.moving ? (p.sprinting ? 2 : 1) : 0
    this.updateFlags(p)
  }

  private updateFlags(p: Player) {
    void p
  }

  /** Axis-separated movement with step-up, against the piece hash. */
  private moveBody(p: Player, dt: number) {
    const hw = p.hero.halfWidth * (p.robot ? 1.1 : 1)
    const h = p.crouch ? Math.min(p.hero.height, 1.0) : p.hero.height
    const stepH = p.hero.tiny ? TINY_STEP : STEP
    const tinyCrawl = p.hero.dogflap && (p.hero.id === 'dog' || p.crouch)
    // Dog flaps let tiny heroes crawl through; a household walks through its own (barricaded) doors.
    const passable = (q: Piece) => (q.flap && tinyCrawl) || q.kind === 'ground' || ((q.kind === 'door' || q.kind === 'garage') && q.house === p.team && !p.robot)
    let slid = false
    const tryAxis = (dx: number, dz: number): boolean => {
      const nx = p.x + dx
      const nz = p.z + dz
      const b: Box = { x0: nx - hw, y0: p.y + 0.02, z0: nz - hw, x1: nx + hw, y1: p.y + h, z1: nz + hw }
      let stepTop = -1
      let blocked = false
      let blocker: Box | null = null
      for (const q of this.hash.query(b, this.tmp)) {
        if (!q.solid || !q.alive || passable(q)) continue
        const qb = boxOf(q)
        if (!overlaps(qb, b)) continue
        if (qb.y1 <= p.y + stepH && qb.y1 > p.y) {
          stepTop = Math.max(stepTop, qb.y1)
          continue
        }
        blocked = true
        blocker = qb
        break
      }
      if (blocked && blocker && !slid) {
        // Clipping a corner: slide sideways out of the overlap and try again.
        if (dz) {
          const ox = Math.min(b.x1 - blocker.x0, blocker.x1 - b.x0)
          if (ox < 0.3) {
            const dir = p.x < (blocker.x0 + blocker.x1) / 2 ? -1 : 1
            slid = true
            if (tryAxis(dir * (ox + 0.02), 0)) return tryAxis(dx, dz)
            return false
          }
        } else if (dx) {
          const oz = Math.min(b.z1 - blocker.z0, blocker.z1 - b.z0)
          if (oz < 0.3) {
            const dir = p.z < (blocker.z0 + blocker.z1) / 2 ? -1 : 1
            slid = true
            if (tryAxis(0, dir * (oz + 0.02))) return tryAxis(dx, dz)
            return false
          }
        }
      }
      if (!blocked && stepTop > 0) {
        // Head room at the stepped-up height?
        const b2: Box = { x0: nx - hw, y0: stepTop + 0.02, z0: nz - hw, x1: nx + hw, y1: stepTop + h, z1: nz + hw }
        for (const q of this.hash.query(b2, this.tmp)) {
          if (!q.solid || !q.alive || passable(q)) continue
          if (overlaps(boxOf(q), b2)) {
            blocked = true
            break
          }
        }
        if (!blocked) {
          p.y = stepTop
          p.vy = Math.max(0, p.vy)
          p.onGround = true
        }
      }
      if (!blocked) {
        p.x = nx
        p.z = nz
      } else {
        if (dx) p.vx = 0
        if (dz) p.vz = 0
      }
      return !blocked
    }
    tryAxis(p.vx * dt, 0)
    slid = false
    tryAxis(0, p.vz * dt)
    // Y.
    const oldY = p.y
    p.y += p.vy * dt
    const b: Box = { x0: p.x - hw + 0.02, y0: p.y, z0: p.z - hw + 0.02, x1: p.x + hw - 0.02, y1: p.y + h, z1: p.z + hw - 0.02 }
    let ground = p.y <= 0
    if (p.y < 0) p.y = 0
    for (const q of this.hash.query(b, this.tmp)) {
      if (!q.solid || !q.alive || passable(q)) continue
      const qb = boxOf(q)
      if (!overlaps(qb, b)) continue
      if (qb.y1 <= oldY + 0.05 && p.vy <= 0) {
        if (qb.y1 > p.y) p.y = qb.y1
        ground = true
      } else if (qb.y0 >= oldY + h - 0.05 && p.vy > 0) {
        p.y = qb.y0 - h
        p.vy = 0
      }
    }
    if (ground) {
      if (p.vy < -9 && !p.glide && !p.hero.umbrella) this.damage(p, Math.min(30, (-p.vy - 9) * 4), 0, 'melee', false)
      p.vy = 0
      p.onGround = true
    } else p.onGround = false
  }

  /* ---------- melee ---------- */

  private meleeStats(p: Player) {
    const m = p.hero.melee
    if (p.tool) {
      const t = TOOLS[p.tool]
      return { light: t.light, lightPieces: t.lightPieces, heavy: t.heavy, heavyPieces: t.heavyPieces, reach: t.reach, arc: 0.9, knock: t.knock, lightUp: 0.1, lightDown: 0.2, heavyUp: t.heavyUp, heavyDown: 0.45, ranged: undefined }
    }
    return m
  }

  private startSwing(p: Player, heavy: boolean, charge: number) {
    const m = this.meleeStats(p)
    if (m.ranged && !p.tool) {
      // Slingshot: a pebble whose power follows the draw.
      const c = Math.max(0.3, Math.min(1, charge))
      this.spawnProjectile(p, 'pebble', m.ranged.speed * (0.55 + 0.45 * c), m.ranged.gravity, m.ranged.dmg * c, m.ranged.pieces * c)
      p.swing = { heavy: false, t: 0, done: true }
      this.events.push({ t: 'swing', id: p.id, heavy: false, hit: true })
      return
    }
    p.swing = { heavy, t: 0, done: false }
    if (heavy) {
      p.stamina -= 18
      p.regenAt = this.time + 0.8
    }
  }

  private stepSwing(p: Player, dt: number) {
    const s = p.swing!
    const m = this.meleeStats(p)
    s.t += dt
    const up = s.heavy ? m.heavyUp : m.lightUp
    const down = s.heavy ? m.heavyDown : m.lightDown
    if (!s.done && s.t >= up) {
      s.done = true
      const hit = this.resolveSwing(p, s.heavy)
      this.events.push({ t: 'swing', id: p.id, heavy: s.heavy, hit })
    }
    if (s.t >= up + down) p.swing = null
  }

  /** Hit players in the arc and the first breakable piece along the look ray. */
  private resolveSwing(p: Player, heavy: boolean) {
    const m = this.meleeStats(p)
    const reach = m.reach
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    const cp = Math.cos(p.pitch)
    const dx = sy * cp
    const dy = Math.sin(p.pitch)
    const dz = cy * cp
    const ex = p.x
    const ey = p.y + p.hero.eye
    const ez = p.z
    let hit = false
    const dmgPlayers = (heavy ? m.heavy : m.light) * (p.robot ? 1 : 1)
    let dmgPieces = heavy ? m.heavyPieces : m.lightPieces
    if (heavy && p.perks >= 2 && p.hero.id === 'nana') dmgPieces *= 1.25
    const hose = p.tool === 'hose'
    for (const o of this.players) {
      if (o === p || !o.alive || (o.team === p.team && !(this.mode === 'robots' && o.robot !== p.robot))) continue
      if (o.robot === p.robot && this.mode === 'robots') continue
      const ox = o.x - p.x
      const oz = o.z - p.z
      const d = Math.hypot(ox, oz)
      if (d > reach + o.hero.halfWidth) continue
      const dot = (ox * sy + oz * cy) / (d || 1)
      if (dot < Math.cos(m.arc)) continue
      // Vertical reach: the target's body must overlap the swing height band.
      if (o.y + o.hero.height < p.y + 0.2 || o.y > p.y + p.hero.height + 0.3) continue
      // Blocked by a wall between them?
      if (!this.lineClear(ex, ey, ez, o.x, o.y + o.hero.eye, o.z)) continue
      hit = true
      const kb = (heavy ? m.knock : m.knock * 0.3) * (hose ? 1.6 : 1)
      this.hitPlayer(o, p, dmgPlayers, heavy, kb, 'melee')
      if (p.hero.fineOnHit && o.alive) o.fine = Math.max(o.fine, 3 + (p.perks >= 1 ? 1 : 0))
      if (hose) o.wet = Math.max(o.wet, 3)
    }
    if (!hose) {
      const r = this.raycast(ex, ey, ez, dx, dy, dz, reach + 0.6, (q) => q.breakable && q.alive && (q.solid || q.kind === 'door' || q.model === 'ladder'))
      if (r && r.piece.breakable && !(r.piece.kind === 'door' && r.piece.level === 0)) {
        hit = true
        this.damagePiece(r.piece, dmgPieces, p, ex + dx * r.t, ey + dy * r.t, ez + dz * r.t)
      } else if (!hit) {
        // The ray missed: a swing is wide, so take the nearest breakable thing inside the swing volume.
        const cx = p.x + sy * reach * 0.55
        const cz = p.z + cy * reach * 0.55
        const b: Box = { x0: cx - reach * 0.5, y0: p.y - 0.2, z0: cz - reach * 0.5, x1: cx + reach * 0.5, y1: p.y + p.hero.height + 0.4, z1: cz + reach * 0.5 }
        let best: Piece | null = null
        let bd = 1e9
        for (const q of this.hash.query(b, this.tmp)) {
          if (!q.alive || !q.breakable || !(q.solid || q.kind === 'door' || q.model === 'ladder') || (q.kind === 'door' && q.level === 0)) continue
          if (!overlaps(boxOf(q), b)) continue
          const qx = q.x - p.x
          const qz = q.z - p.z
          const d = Math.hypot(qx, qz)
          if ((qx * sy + qz * cy) / (d || 1) < Math.cos(m.arc + 0.3)) continue
          if (d < bd) {
            bd = d
            best = q
          }
        }
        if (best) {
          hit = true
          this.damagePiece(best, dmgPieces, p, best.x, Math.min(best.y + best.h, ey), best.z)
        }
      }
    }
    return hit
  }

  /** Apply a hit from `by` to `o`, honouring blocks and parries. */
  private hitPlayer(o: Player, by: Player, dmg: number, heavy: boolean, knock: number, kind: 'melee' | 'throw' | 'ult' | 'robot') {
    const dirx = o.x - by.x
    const dirz = o.z - by.z
    const d = Math.hypot(dirx, dirz) || 1
    let blocked = false
    if (o.blocking && kind !== 'ult') {
      const facing = (-dirx * Math.sin(o.yaw) - dirz * Math.cos(o.yaw)) / d
      if (facing > 0.25) {
        blocked = true
        if (this.time - o.blockSince < 0.22 && heavy) {
          // Parry: the attacker is staggered and nothing lands.
          by.stagger = Math.max(by.stagger, 0.9)
          by.swing = null
          this.events.push({ t: 'parry', id: o.id, by: by.id, x: o.x, y: o.y + 1, z: o.z })
          return
        }
        dmg *= o.hero.shieldPassive ? 0.15 : 0.4
        knock *= 0.3
        o.stamina = Math.max(0, o.stamina - (heavy ? 12 : 5))
      }
    }
    const res = o.hero.id === 'gramps' ? 0.5 : 1
    o.vx += (dirx / d) * knock * res
    o.vz += (dirz / d) * knock * res
    if (knock > 5) o.vy = Math.max(o.vy, 2.2 * res)
    this.damage(o, dmg, by.id, kind, heavy, blocked)
  }

  damage(o: Player, dmg: number, byId: number, kind: HitKind, heavy: boolean, blocked = false) {
    if (!o.alive || this.time < o.spawnShield) return
    if (this.phase === 'prep') return
    const by = this.player(byId)
    o.hp -= dmg
    o.hitAt = this.time
    o.regenAt = this.time + 1.5
    if (by && by !== o) {
      by.damage += dmg
      o.lastHitBy = by.id
      this.chargeUlt(by, dmg)
    }
    this.events.push({ t: 'hit', id: o.id, by: byId, x: o.x, y: o.y + o.hero.eye * 0.7, z: o.z, dmg, kind, heavy, blocked })
    if (o.hp <= 0) this.knockOut(o, byId)
  }

  private chargeUlt(p: Player, amount: number) {
    if (p.robot) return
    const rate = 1 + (p.perks >= 1 && p.hero.id === 'dog' ? 0.15 : 0)
    p.ult = Math.min(1, p.ult + (amount / p.hero.ultCharge) * rate)
  }

  private knockOut(o: Player, byId: number) {
    o.alive = false
    o.deaths++
    o.swing = null
    o.blocking = false
    o.onLadder = null
    o.ultKind = null
    if (o.carrying) {
      const c = o.carrying
      o.carrying = null
      this.dropPiece(o, c)
    }
    const by = this.player(byId)
    if (by && by !== o) {
      by.kills++
      if (this.mode === 'brawl' && by.team !== o.team) this.score[by.team]++
    }
    o.respawnAt = this.time + (o.robot ? 1e9 : this.mode === 'brawl' ? 5 : 7 - (o.hero.id === 'gramps' && o.perks >= 1 ? 2 : 0))
    this.events.push({ t: 'ko', id: o.id, by: byId, x: o.x, y: o.y, z: o.z })
  }

  /* ---------- pieces ---------- */

  damagePiece(q: Piece, dmg: number, by: Player | null, hx: number, hy: number, hz: number) {
    if (!q.alive || !q.breakable) return
    // During prep nothing breaks; in Destruction only raiders score, defenders can still clear furniture.
    if (this.phase !== 'play') return
    q.hp -= dmg
    if (by && !by.robot) this.chargeUlt(by, dmg * 0.5)
    if (by) by.damage += dmg * 0.25
    if (q.hp <= 0) {
      this.breakPiece(q, by, hx, hy, hz)
      return
    }
    const chip = q.hp / q.maxHp < 0.33 ? 3 : q.hp / q.maxHp < 0.66 ? 2 : 1
    if (chip !== q.chip) q.chip = chip
    this.events.push({ t: 'chip', id: q.id, chip, x: hx, y: hy, z: hz, hp: q.hp })
  }

  breakPiece(q: Piece, by: Player | null, hx = q.x, hy = q.y + q.h / 2, hz = q.z) {
    if (!q.alive) return
    q.alive = false
    q.hp = 0
    this.hash.remove(q)
    q.solid = false
    if (q.kind === 'door' || q.kind === 'garage') q.level = 0
    this.nav.pieceChanged(q)
    const team = by ? by.team : -1
    this.events.push({ t: 'break', id: q.id, x: hx, y: hy, z: hz, model: q.model, by: by?.id ?? 0, value: q.value, team, house: q.house })
    if (q.kind === 'valuable' && by) {
      by.breaks++
      const scoring = this.mode === 'destruction' ? q.house !== by.team && !by.robot : false
      if (scoring) {
        this.score[by.team] += q.value
        by.score += q.value
        this.events.push({ t: 'score', team: by.team, value: q.value, total: this.score[by.team], name: q.name, by: by.id })
      }
    }
    if (q.model === 'ladder') this.ladders = this.ladders.filter((l) => l !== q)
  }

  /* ---------- throwables ---------- */

  private throwItem(p: Player) {
    const t = THROWABLES[p.throwKind]
    p.throwAmmo--
    const dogMul = p.hero.id === 'dog' ? 0.8 : 1
    this.spawnProjectile(p, t.kind, t.speed * dogMul, t.gravity, t.dmg, t.pieces)
    p.swing = { heavy: false, t: 0, done: true }
  }

  private spawnProjectile(p: Player, kind: Projectile['kind'], speed: number, gravity: number, dmg: number, pieces: number) {
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    const cp = Math.cos(p.pitch)
    const sp = Math.sin(p.pitch)
    const pr: Projectile = {
      id: this.seq++,
      kind,
      owner: p.id,
      team: p.team,
      x: p.x + sy * 0.6,
      y: p.y + p.hero.eye - 0.1,
      z: p.z + cy * 0.6,
      vx: sy * cp * speed + p.vx * 0.5,
      vy: sp * speed + (kind === 'pebble' ? 0 : 1.5),
      vz: cy * cp * speed + p.vz * 0.5,
      yaw: p.yaw,
      life: 5,
      bounced: false,
      dmg,
      pieces,
    }
    ;(pr as Projectile & { g: number }).g = gravity
    this.projectiles.push(pr)
    this.events.push({ t: 'throw', id: p.id, kind, x: pr.x, y: pr.y, z: pr.z })
  }

  private stepProjectiles(dt: number) {
    const keep: Projectile[] = []
    for (const pr of this.projectiles) {
      pr.life -= dt
      if (pr.life <= 0) {
        if (pr.kind === 'rccar') this.explode(pr.x, pr.y, pr.z, 4.2, 48, 150, pr.owner, 'rccar')
        continue
      }
      if (pr.kind === 'towtruck' || pr.kind === 'rccar') {
        this.stepVehicle(pr, dt)
        if (pr.life > 0) keep.push(pr)
        continue
      }
      if (pr.kind === 'icecream') {
        // Ice-cream cones left by the truck: a pickup that heals.
        let taken = false
        for (const o of this.players)
          if (o.alive && !o.robot && Math.hypot(o.x - pr.x, o.z - pr.z) < 0.9 && Math.abs(o.y - pr.y) < 1.5) {
            o.hp = Math.min(o.maxHp, o.hp + 35)
            this.events.push({ t: 'heal', id: o.id, amount: 35 })
            taken = true
            break
          }
        if (!taken) keep.push(pr)
        continue
      }
      const g = (pr as Projectile & { g: number }).g ?? 12
      pr.vy -= g * dt
      const nx = pr.x + pr.vx * dt
      const ny = pr.y + pr.vy * dt
      const nz = pr.z + pr.vz * dt
      const owner = this.player(pr.owner)
      // Players.
      let hitPlayer: Player | null = null
      for (const o of this.players) {
        if (!o.alive || o.id === pr.owner) continue
        if (o.team === pr.team && !(this.mode === 'robots' && o.robot)) continue
        if (Math.hypot(o.x - nx, o.z - nz) < o.hero.halfWidth + 0.35 && ny > o.y - 0.2 && ny < o.y + o.hero.height + 0.3) {
          hitPlayer = o
          break
        }
      }
      if (hitPlayer) {
        if (owner) this.hitPlayer(hitPlayer, owner, pr.dmg, pr.kind === 'gnome', pr.kind === 'gnome' ? 6 : 3, 'throw')
        this.applySplash(pr, nx, ny, nz, hitPlayer.id)
        continue
      }
      // Pieces and the ground.
      const dx = nx - pr.x
      const dy = ny - pr.y
      const dz = nz - pr.z
      const l = Math.hypot(dx, dy, dz) || 1e-6
      const r = this.raycast(pr.x, pr.y, pr.z, dx / l, dy / l, dz / l, l + 0.15, (q) => q.solid && q.alive)
      if (r || ny <= 0.05) {
        const hx = r ? pr.x + (dx / l) * r.t : nx
        const hy = r ? pr.y + (dy / l) * r.t : 0
        const hz = r ? pr.z + (dz / l) * r.t : nz
        if (THROWABLES[pr.kind as ThrowKind]?.bounce && !pr.bounced) {
          pr.bounced = true
          if (r) {
            if (r.nx) pr.vx = -pr.vx * 0.6
            if (r.ny) pr.vy = -pr.vy * 0.6
            if (r.nz) pr.vz = -pr.vz * 0.6
          } else pr.vy = -pr.vy * 0.6
          pr.x = hx + (r?.nx ?? 0) * 0.05
          pr.y = Math.max(0.05, hy + (r?.ny ?? 0) * 0.05)
          pr.z = hz + (r?.nz ?? 0) * 0.05
          keep.push(pr)
          continue
        }
        if (r && r.piece.breakable) this.damagePiece(r.piece, pr.pieces, owner ?? null, hx, hy, hz)
        this.applySplash(pr, hx, hy, hz, 0)
        continue
      }
      pr.x = nx
      pr.y = ny
      pr.z = nz
      keep.push(pr)
    }
    this.projectiles = keep
  }

  private applySplash(pr: Projectile, x: number, y: number, z: number, hit: number) {
    const t = THROWABLES[pr.kind as ThrowKind]
    this.events.push({ t: 'splash', kind: pr.kind, x, y, z, hit })
    if (!t) return
    if (t.splash > 0) {
      for (const o of this.players) {
        if (!o.alive || o.id === pr.owner) continue
        if (o.team === pr.team && !o.robot) continue
        if (Math.hypot(o.x - x, o.z - z) > t.splash || Math.abs(o.y - y) > 2) continue
        if (t.effect === 'wet') o.wet = Math.max(o.wet, t.effectTime)
        if (t.effect === 'blind') o.blind = Math.max(o.blind, t.effectTime)
        if (t.effect === 'sticky') o.sticky = Math.max(o.sticky, t.effectTime)
        if (o.id !== hit) this.damage(o, Math.round(t.dmg * 0.5), pr.owner, 'throw', false)
      }
    }
    if (t.effect === 'sticky') this.zones.push({ id: this.seq++, kind: 'sticky', team: pr.team, owner: pr.owner, x, y: this.floorAt(x, z, y + 0.5, 0.6), z, r: t.splash, until: this.time + 7, yaw: 0, tick: 0 })
    if (t.effect === 'wet') this.zones.push({ id: this.seq++, kind: 'wet', team: pr.team, owner: pr.owner, x, y: this.floorAt(x, z, y + 0.5, 0.6), z, r: t.splash * 0.8, until: this.time + 5, yaw: 0, tick: 0 })
  }

  /** The tow truck and the RC car drive straight ahead, breaking what they touch. */
  private stepVehicle(pr: Projectile, dt: number) {
    const owner = this.player(pr.owner)
    const sp = pr.kind === 'towtruck' ? 10 : 8.5
    pr.vx = Math.sin(pr.yaw) * sp
    pr.vz = Math.cos(pr.yaw) * sp
    pr.x += pr.vx * dt
    pr.z += pr.vz * dt
    pr.y = this.floorAt(pr.x, pr.z, pr.y + 0.6, 0.7)
    const hw = pr.kind === 'towtruck' ? 1.3 : 0.45
    const h = pr.kind === 'towtruck' ? 2.6 : 0.5
    const b: Box = { x0: pr.x - hw, y0: pr.y + 0.05, z0: pr.z - hw, x1: pr.x + hw, y1: pr.y + h, z1: pr.z + hw }
    for (const q of this.solidsIn(b)) {
      if (q.breakable) {
        if (pr.kind === 'towtruck') this.breakPiece(q, owner ?? null)
        else {
          this.explode(pr.x, pr.y, pr.z, 4.2, 48, 150, pr.owner, 'rccar')
          pr.life = 0
          return
        }
      } else if (q.kind !== 'ground' && q.model !== 'rug' && !(q.model.startsWith('prop:') && q.h < 1.2 && pr.kind === 'towtruck')) {
        if (pr.kind === 'rccar') {
          this.explode(pr.x, pr.y, pr.z, 4.2, 48, 150, pr.owner, 'rccar')
          pr.life = 0
          return
        }
        pr.life = 0
        return
      }
    }
    for (const o of this.players) {
      if (!o.alive || o.id === pr.owner) continue
      if (Math.hypot(o.x - pr.x, o.z - pr.z) < hw + o.hero.halfWidth && Math.abs(o.y - pr.y) < 2) {
        if (pr.kind === 'towtruck') {
          if (owner) this.hitPlayer(o, owner, 38, true, 14, 'ult')
          else this.damage(o, 38, 0, 'ult', true)
        } else {
          this.explode(pr.x, pr.y, pr.z, 4.2, 48, 150, pr.owner, 'rccar')
          pr.life = 0
          return
        }
      }
    }
    if (pr.x < 1 || pr.x > this.world.map.w - 1 || pr.z < 1 || pr.z > this.world.map.h - 1) pr.life = 0
  }

  explode(x: number, y: number, z: number, r: number, dmg: number, pieces: number, byId: number, kind: string) {
    this.events.push({ t: 'explode', x, y, z, r, kind })
    const by = this.player(byId)
    for (const o of this.players) {
      if (!o.alive) continue
      const d = Math.hypot(o.x - x, o.y - y, o.z - z)
      if (d > r) continue
      const k = 1 - d / r
      if (o.id !== byId) {
        const dx = (o.x - x) / (d || 1)
        const dz = (o.z - z) / (d || 1)
        o.vx += dx * 10 * k
        o.vz += dz * 10 * k
        o.vy = Math.max(o.vy, 4 * k)
      }
      this.damage(o, Math.round(dmg * (0.4 + 0.6 * k)) * (o.id === byId ? 0.3 : 1), byId, 'ult', true)
    }
    const b: Box = { x0: x - r, y0: y - r, z0: z - r, x1: x + r, y1: y + r, z1: z + r }
    for (const q of this.hash.query(b, this.tmp).slice()) {
      if (!q.alive || !q.breakable) continue
      const d = Math.hypot(q.x - x, q.y + q.h / 2 - y, q.z - z)
      if (d < r) this.damagePiece(q, pieces * (1 - d / r / 2), by ?? null, q.x, q.y + q.h / 2, q.z)
    }
  }

  /* ---------- traps, ladders, interactions ---------- */

  /** Where the player is looking on a floor within 3.5 m (for placing things). */
  private lookPoint(p: Player, max = 3.5) {
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    const cp = Math.cos(p.pitch)
    const dx = sy * cp
    const dy = Math.sin(p.pitch)
    const dz = cy * cp
    const ey = p.y + p.hero.eye
    const r = this.raycast(p.x, ey, p.z, dx, dy, dz, max)
    let t = max
    if (r) t = r.t
    // Intersect the ground plane / the floor the player stands on.
    if (dy < -0.05) t = Math.min(t, (ey - p.y) / -dy)
    const x = p.x + dx * t
    const z = p.z + dz * t
    const y = this.floorAt(x, z, p.y + 0.6, 0.7)
    return { x, y, z, piece: r?.piece ?? null, t }
  }

  private useAction(p: Player) {
    const look = this.lookPoint(p, 3)
    const q = look.piece
    // Drop what we carry.
    if (p.carrying) {
      const c = p.carrying
      if (this.houseAt(look.x, look.z) !== p.team) return
      p.carrying = null
      c.x = look.x
      c.z = look.z
      c.y = look.y
      c.yaw = p.yaw
      this.dropPiece(p, c)
      return
    }
    if (q && q.house === p.team && this.time < 1e9) {
      // Barricade an exterior door of our own house.
      if ((q.kind === 'door' || q.kind === 'garage') && q.alive && q.level < 2 && (this.phase === 'prep' || this.mode !== 'brawl')) {
        q.level++
        q.hp = (q.kind === 'garage' ? q.maxHp : DOOR_HP) + q.level * BARRICADE_HP
        q.maxHp = q.hp
        q.chip = 0
        q.solid = true
        this.nav.pieceChanged(q)
        this.events.push({ t: 'barricade', id: q.id, level: q.level, x: q.x, y: q.y, z: q.z })
        return
      }
      // Pick up a valuable to move it (prep only).
      if (q.kind === 'valuable' && this.phase === 'prep' && q.alive && !p.robot) {
        this.hash.remove(q)
        q.solid = false
        p.carrying = q
        this.nav.pieceChanged(q)
        this.events.push({ t: 'pickup', id: p.id, piece: q.id })
        return
      }
    }
    // Tool rack: cycle the garden tool.
    if (q && q.model === 'furniture:toolrack' && !p.robot) {
      const idx = p.tool ? (TOOL_KINDS.indexOf(p.tool) + 1) % TOOL_KINDS.length : 0
      p.tool = TOOL_KINDS[idx]
      this.events.push({ t: 'tool', id: p.id, tool: p.tool })
      return
    }
    // Otherwise place the selected trap.
    this.placeTrap(p, look.x, look.y, look.z)
  }

  private dropPiece(p: Player, c: Piece) {
    c.y = this.floorAt(c.x, c.z, c.y + 0.6, 0.7)
    c.solid = true
    this.hash.add(c)
    this.nav.pieceChanged(c)
    this.events.push({ t: 'drop', id: p.id, piece: c.id, x: c.x, y: c.y, z: c.z, yaw: c.yaw })
  }

  placeTrap(p: Player, x: number, y: number, z: number) {
    const slot = Math.max(0, Math.min(p.traps.length - 1, p.input.slot))
    const kind = p.traps[slot]
    if (!kind || p.trapAmmo[slot] <= 0) return false
    const t = TRAPS[kind]
    const house = this.houseAt(x, z)
    if (this.mode !== 'brawl') {
      // Traps go in and around your own house (sprinklers anywhere on your side of the street).
      const nearHome = house === p.team || Math.abs(z - this.houses[p.team].oz) < 16
      if (!nearHome) return false
      if (!t.outdoor && house !== p.team) return false
    }
    // Not on top of another trap.
    for (const o of this.traps) if (Math.hypot(o.x - x, o.z - z) < 1.0 && Math.abs(o.y - y) < 1) return false
    p.trapAmmo[slot]--
    p.placedTraps++
    const tr: TrapInst = { id: this.seq++, kind, team: p.team, owner: p.id, x, y, z, armed: true, rearmAt: 0, revealed: false, victim: 0, yaw: p.yaw }
    this.traps.push(tr)
    this.events.push({ t: 'trap', id: tr.id, kind, x, y, z, team: p.team, yaw: p.yaw })
    return true
  }

  private stepTraps(dt: number) {
    void dt
    for (const tr of this.traps) {
      const t = TRAPS[tr.kind]
      if (!tr.armed) {
        if (t.rearm > 0 && this.time >= tr.rearmAt) {
          tr.armed = true
          tr.victim = 0
        }
        continue
      }
      // The dog sniffs traps out for its team.
      if (!tr.revealed)
        for (const o of this.players) if (o.alive && o.hero.sniff && o.team !== tr.team && Math.hypot(o.x - tr.x, o.z - tr.z) < 10) tr.revealed = true
      if (this.phase !== 'play') continue
      for (const o of this.players) {
        if (!o.alive || o.team === tr.team && !o.robot) continue
        if (this.mode === 'robots' && !o.robot) continue
        if (Math.hypot(o.x - tr.x, o.z - tr.z) > t.radius + o.hero.halfWidth * 0.5 || Math.abs(o.y - tr.y) > 0.6) continue
        if (tr.kind === 'sprinkler') {
          o.wet = Math.max(o.wet, t.hold)
          continue
        }
        tr.armed = false
        tr.rearmAt = this.time + t.rearm
        tr.victim = o.id
        this.events.push({ t: 'trip', id: tr.id, kind: tr.kind, victim: o.id, x: tr.x, y: tr.y, z: tr.z })
        if (t.dmg > 0) this.damage(o, t.dmg, tr.owner, 'trap', false)
        if (t.effect === 'root') o.root = t.hold
        if (t.effect === 'stun') o.stun = t.hold
        if (t.effect === 'slip') {
          o.slip = t.hold
          o.vx *= 1.6
          o.vz *= 1.6
        }
        if (t.effect === 'pit') o.pit = t.hold
        if (t.effect === 'alarm') this.events.push({ t: 'alarm', x: tr.x, z: tr.z, victim: o.id, team: tr.team })
        break
      }
    }
    // Single-use traps that fired are gone.
    this.traps = this.traps.filter((tr) => tr.armed || TRAPS[tr.kind].rearm > 0)
  }

  private placeLadder(p: Player) {
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    const wallish = (q: Piece) => q.alive && q.solid && (q.kind === 'wall' || q.kind === 'window' || q.kind === 'rail' || q.kind === 'garage' || q.kind === 'door')
    // Eye-height ray first; when that panel has already been smashed open, lean on the storey above instead
    // (upper wall, balcony slab edge or parapet).
    const r =
      this.raycast(p.x, p.y + p.hero.eye, p.z, sy, 0, cy, 4.0, wallish) ??
      this.raycast(p.x, p.y + 3.6, p.z, sy, 0, cy, 4.0, (q) => wallish(q) || (q.alive && q.solid && (q.kind === 'slab' || q.kind === 'roof')))
    if (!r) return false
    const q = r.piece
    // Which way does the wall face? Use the hit normal.
    const nx = r.nx
    const nz = r.nz
    if (!nx && !nz) return false
    const yaw = Math.atan2(-nx, -nz) // ladder faces into the wall
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    const wx = p.x + sy * r.t
    const wz = p.z + cy * r.t
    // Find the floor beyond the wall above us: the lowest slab (the upper floor, the balcony), else the roof. The
    // pitched roofs are stacks of steps, so their surface there is the highest step top.
    const beyondX = wx + fx * 1.0
    const beyondZ = wz + fz * 1.0
    const floorBeyond = (minY: number) => {
      let slab = 0
      let roof = 0
      const b: Box = { x0: beyondX - 0.6, y0: minY, z0: beyondZ - 0.6, x1: beyondX + 0.6, y1: 14, z1: beyondZ + 0.6 }
      for (const s of this.hash.query(b, this.tmp)) {
        if (!s.alive || !s.solid || (s.kind !== 'slab' && s.kind !== 'roof')) continue
        const sb = boxOf(s)
        if (!(sb.x0 < b.x1 && sb.x1 > b.x0 && sb.z0 < b.z1 && sb.z1 > b.z0 && sb.y1 > minY)) continue
        if (s.kind === 'slab') {
          if (slab === 0 || sb.y1 < slab) slab = sb.y1
        } else roof = Math.max(roof, sb.y1)
      }
      return slab || roof
    }
    // No floor beyond: maybe we are leaning on a balcony railing from outside (floor is under the rail).
    let top = floorBeyond(p.y + 1.5) || floorBeyond(p.y + 0.5)
    if (!top) return false
    // Railings or a parapet on the landing raise the climb.
    const rb: Box = { x0: beyondX - 0.8, y0: top, z0: beyondZ - 0.8, x1: beyondX + 0.8, y1: top + 1.2, z1: beyondZ + 0.8 }
    for (const s of this.hash.query(rb, this.tmp)) if (s.alive && s.solid && s.kind === 'rail' && overlaps(boxOf(s), rb)) top = Math.max(top, boxOf(s).y1)
    void q
    p.ladders--
    const ladder = this.makeLadder(wx - fx * 0.2, wz - fz * 0.2, yaw, top, p.team)
    this.events.push({ t: 'ladder', id: ladder.id, x: ladder.x, y: ladder.y, z: ladder.z, yaw, top, team: p.team })
    return true
  }

  makeLadder(x: number, z: number, yaw: number, top: number, team: number) {
    const ladder: Piece = {
      id: this.seq++,
      kind: 'prop',
      model: 'ladder',
      house: team,
      x,
      y: this.floorAt(x, z, 0.6, 0.7),
      z,
      w: 0.6,
      d: 0.6,
      h: top + 0.5,
      yaw,
      hp: 60,
      maxHp: 60,
      breakable: true,
      solid: false,
      alive: true,
      value: 0,
      name: 'ladder',
      chip: 0,
      level: 0,
      inside: false,
      floor: 0,
      top,
    }
    this.pieces.push(ladder)
    this.byId.set(ladder.id, ladder)
    this.ladders.push(ladder)
    this.hash.add(ladder)
    this.nav.ladderAdded(ladder)
    return ladder
  }

  /* ---------- ultimates ---------- */

  private useUlt(p: Player) {
    p.ult = 0
    p.ultsUsed++
    const kind = p.hero.ult
    p.ultKind = kind
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    this.events.push({ t: 'ult', id: p.id, kind, x: p.x, y: p.y, z: p.z, yaw: p.yaw })
    switch (kind) {
      case 'cookies':
        p.ultUntil = this.time + 0.6
        this.zones.push({ id: this.seq++, kind: 'cookies', team: p.team, owner: p.id, x: p.x + sy * 1.2, y: p.y, z: p.z + cy * 1.2, r: 3.6, until: this.time + 5, yaw: p.yaw, tick: 0 })
        break
      case 'blower':
        p.ultUntil = this.time + 1.6
        break
      case 'rccar': {
        p.ultUntil = this.time + 0.5
        const pr: Projectile = { id: this.seq++, kind: 'rccar', owner: p.id, team: p.team, x: p.x + sy * 1.0, y: p.y, z: p.z + cy * 1.0, vx: 0, vy: 0, vz: 0, yaw: p.yaw, life: 4.2, bounced: false, dmg: 0, pieces: 0 }
        this.projectiles.push(pr)
        break
      }
      case 'towtruck': {
        p.ultUntil = this.time + 0.8
        const pr: Projectile = { id: this.seq++, kind: 'towtruck', owner: p.id, team: p.team, x: p.x - sy * 7, y: 0, z: p.z - cy * 7, vx: 0, vy: 0, vz: 0, yaw: p.yaw, life: 4.5, bounced: false, dmg: 0, pieces: 0 }
        this.projectiles.push(pr)
        break
      }
      case 'mower':
        p.ultUntil = this.time + 3.2
        break
      case 'zoomies':
        p.ultUntil = this.time + 1.1
        break
    }
  }

  private stepUlt(p: Player, dt: number) {
    const sy = Math.sin(p.yaw)
    const cy = Math.cos(p.yaw)
    if (p.ultKind === 'blower') {
      for (const o of this.players) {
        if (!o.alive || o === p || (o.team === p.team && !o.robot)) continue
        const dx = o.x - p.x
        const dz = o.z - p.z
        const d = Math.hypot(dx, dz)
        if (d > 7.5 || Math.abs(o.y - p.y) > 2.5) continue
        if ((dx * sy + dz * cy) / (d || 1) < 0.6) continue
        if (!this.lineClear(p.x, p.y + 1, p.z, o.x, o.y + 1, o.z)) continue
        const k = (1 - d / 8) * 36 * dt
        o.vx += sy * k
        o.vz += cy * k
        o.vy = Math.max(o.vy, 1.5)
        if (this.step_ % 12 === 0) this.damage(o, 4, p.id, 'ult', false)
      }
      for (const pr of this.projectiles) {
        const dx = pr.x - p.x
        const dz = pr.z - p.z
        const d = Math.hypot(dx, dz)
        if (d < 7 && (dx * sy + dz * cy) / (d || 1) > 0.6) {
          pr.vx += sy * 30 * dt
          pr.vz += cy * 30 * dt
        }
      }
    } else if (p.ultKind === 'mower' || p.ultKind === 'zoomies') {
      const mower = p.ultKind === 'mower'
      const hw = mower ? 0.9 : 0.5
      const b: Box = { x0: p.x + sy * 0.8 - hw, y0: p.y + 0.1, z0: p.z + cy * 0.8 - hw, x1: p.x + sy * 0.8 + hw, y1: p.y + 1.4, z1: p.z + cy * 0.8 + hw }
      if (mower) for (const q of this.solidsIn(b)) if (q.breakable) this.damagePiece(q, 260 * dt * 4, p, q.x, q.y + q.h / 2, q.z)
      for (const o of this.players) {
        if (!o.alive || o === p || (o.team === p.team && !o.robot)) continue
        if (Math.hypot(o.x - (p.x + sy * 0.8), o.z - (p.z + cy * 0.8)) < hw + o.hero.halfWidth && Math.abs(o.y - p.y) < 1.5 && this.time - o.hitAt > 0.5) {
          if (mower) this.hitPlayer(o, p, 32, true, 12, 'ult')
          else {
            this.hitPlayer(o, p, 14, true, 8, 'ult')
            o.stun = Math.max(o.stun, 1.8)
          }
        }
      }
    }
  }

  private stepZones(dt: number) {
    void dt
    const keep: Zone[] = []
    for (const z of this.zones) {
      if (this.time > z.until) continue
      keep.push(z)
      z.tick += dt
      for (const o of this.players) {
        if (!o.alive) continue
        if (Math.hypot(o.x - z.x, o.z - z.z) > z.r || Math.abs(o.y - z.y) > 1.2) continue
        if (z.kind === 'cookies') {
          if (o.team === z.team && !o.robot) continue
          o.burn = Math.max(o.burn, 1)
          if (this.step_ % 20 === 0) this.damage(o, 7, z.owner, 'burn', false)
        } else if (z.kind === 'sticky') {
          if (o.team !== z.team || o.robot) o.sticky = Math.max(o.sticky, 0.4)
        } else if (z.kind === 'wet') o.wet = Math.max(o.wet, 0.6)
      }
    }
    this.zones = keep
  }

  /* ---------- chaos events ---------- */

  private stepChaos(dt: number) {
    if (this.phase !== 'play' || this.mode === 'robots') return
    if (!this.chaos) {
      if (this.time >= this.nextChaosAt) {
        const kind = CHAOS_KINDS[this.rng.int(3)]
        this.chaos = { kind, until: this.time + (kind === 'seagulls' ? 10 : kind === 'icecream' ? 10 : 30), tick: 0, x: -6 }
        this.events.push({ t: 'chaos', kind, on: true })
      }
      return
    }
    const c = this.chaos
    c.tick += dt
    if (c.kind === 'seagulls') {
      if (c.tick > 1.6) {
        c.tick = 0
        const outside = this.players.filter((o) => o.alive && !o.robot && this.houseAt(o.x, o.z) < 0)
        if (outside.length) {
          const v = this.rng.pick(outside)
          const stole = v.throwAmmo > 0 && this.rng.chance(0.6)
          if (stole) v.throwAmmo--
          else v.blind = Math.max(v.blind, 1.5)
          this.events.push({ t: 'seagull', victim: v.id, stole })
        }
      }
    } else if (c.kind === 'icecream') {
      c.x += 8.5 * dt
      const z = 32
      for (const o of this.players)
        if (o.alive && Math.abs(o.x - c.x) < 2.6 && Math.abs(o.z - z) < 1.6 && o.y < 2 && this.time - o.hitAt > 0.6) {
          o.vx += 9
          o.vy = Math.max(o.vy, 5)
          this.damage(o, 18, 0, 'ult', true)
        }
      if (c.tick > 2.2) {
        c.tick = 0
        this.projectiles.push({ id: this.seq++, kind: 'icecream', owner: 0, team: -1, x: c.x, y: 0, z: z + (this.rng.chance(0.5) ? 2.6 : -2.6), vx: 0, vy: 0, vz: 0, yaw: 0, life: 40, bounced: false, dmg: 0, pieces: 0 })
      }
    } else if (c.kind === 'rain') {
      if (this.step_ % 10 === 0) for (const o of this.players) if (o.alive && this.houseAt(o.x, o.z) < 0) o.wet = Math.max(o.wet, 0.5)
    }
    if (this.time >= c.until) {
      this.events.push({ t: 'chaos', kind: c.kind, on: false })
      this.chaos = null
      this.nextChaosAt = this.time + 70 + this.rng.range(0, 50)
    }
  }

  /* ---------- snapshot ---------- */

  buildSnap(): Snap {
    const p: number[][] = []
    for (const o of this.players) {
      let f = 0
      if (o.alive) f |= PF.alive
      if (o.onGround) f |= PF.ground
      if (o.blocking) f |= PF.block
      if (o.crouch) f |= PF.crouch
      if (o.sprinting) f |= PF.sprint
      if (o.onLadder) f |= PF.ladder
      if (o.stun > 0 || o.slip > 0) f |= PF.stun
      if (o.root > 0) f |= PF.root
      if (o.wet > 0) f |= PF.wet
      if (o.glide) f |= PF.glide
      if (o.swing) f |= PF.swing
      if (o.swing?.heavy) f |= PF.heavy
      if (o.blind > 0) f |= PF.blind
      if (o.burn > 0) f |= PF.burn
      if (o.ultKind === 'mower' && this.time < o.ultUntil) f |= PF.riding
      if (o.moving) f |= PF.moving
      if (o.pit > 0) f |= PF.pit
      if (o.robot) f |= PF.robot
      if (o.sticky > 0) f |= PF.sticky
      if (o.fine > 0) f |= PF.fine
      if (this.time < o.spawnShield) f |= PF.shield
      if (o.carrying) f |= PF.carry
      p.push([o.id, r3(o.x), r3(o.y), r3(o.z), r3(o.yaw), r3(o.pitch), Math.round(o.hp), o.maxHp, f, o.anim, r3(o.ult), Math.round(o.stamina), o.carrying?.id ?? 0, o.tool ? TOOL_KINDS.indexOf(o.tool) + 1 : 0, o.throwAmmo, o.trapAmmo[Math.min(o.trapAmmo.length - 1, Math.max(0, o.input.slot))] ?? 0, o.ladders, o.alive ? 0 : Math.max(0, r3(o.respawnAt - this.time))])
    }
    return {
      t: r3(this.time),
      ph: this.phase === 'prep' ? 0 : this.phase === 'play' ? 1 : 2,
      left: Math.max(0, r3(this.phaseEnds - this.time)),
      s: [this.score[0], this.score[1]],
      w: this.winner,
      p,
      pr: this.projectiles.map((q) => [q.id, PROJ_KINDS.indexOf(q.kind), r3(q.x), r3(q.y), r3(q.z), r3(q.yaw)]),
      tr: this.traps.map((t) => [t.id, TRAP_KINDS.indexOf(t.kind), r3(t.x), r3(t.y), r3(t.z), t.team, t.armed ? 1 : 0, t.revealed ? 1 : 0, r3(t.yaw)]),
      zn: this.zones.map((z) => [z.id, ZONE_KINDS.indexOf(z.kind), r3(z.x), r3(z.y), r3(z.z), r3(z.r), z.team, r3(z.yaw)]),
      v: [this.valuablesLeft(0), this.valuablesLeft(1)],
      wave: this.wave,
      waveLeft: this.players.filter((q) => q.robot && q.alive).length,
      chaos: this.chaos ? CHAOS_KINDS.indexOf(this.chaos.kind) + 1 : 0,
      chaosX: r3(this.chaos?.x ?? 0),
    }
  }
}

function r3(v: number) {
  return Math.round(v * 1000) / 1000
}

/** Slab ray/box intersection; returns the entry distance and the face normal. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box) {
  let tmin = 0
  let tmax = 1e9
  let nx = 0
  let ny = 0
  let nz = 0
  const axes: [number, number, number, number][] = [
    [ox, dx, b.x0, b.x1],
    [oy, dy, b.y0, b.y1],
    [oz, dz, b.z0, b.z1],
  ]
  for (let i = 0; i < 3; i++) {
    const [o, d, lo, hi] = axes[i]
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null
      continue
    }
    let t1 = (lo - o) / d
    let t2 = (hi - o) / d
    let sign = -1
    if (t1 > t2) {
      const t = t1
      t1 = t2
      t2 = t
      sign = 1
    }
    if (t1 > tmin) {
      tmin = t1
      nx = i === 0 ? sign : 0
      ny = i === 1 ? sign : 0
      nz = i === 2 ? sign : 0
    }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  if (tmin === 0 && nx === 0 && ny === 0 && nz === 0) return { t: 0, nx: -dx, ny: -dy, nz: -dz }
  return { t: tmin, nx, ny, nz }
}

export function defaultThrow(h: HeroId): ThrowKind {
  return h === 'nana' ? 'jar' : h === 'dad' ? 'golfball' : h === 'kid' ? 'egg' : h === 'hoa' ? 'paint' : h === 'gramps' ? 'gnome' : 'balloon'
}

export function defaultTraps(h: HeroId): TrapKind[] {
  return h === 'nana' ? ['beartrap', 'rake', 'alarm'] : h === 'dad' ? ['sprinkler', 'marbles', 'rake'] : h === 'kid' ? ['marbles', 'alarm', 'pit'] : h === 'hoa' ? ['beartrap', 'alarm', 'pit'] : h === 'gramps' ? ['beartrap', 'rake', 'sprinkler'] : ['rake', 'marbles', 'alarm']
}

export { FLOOR_H }
