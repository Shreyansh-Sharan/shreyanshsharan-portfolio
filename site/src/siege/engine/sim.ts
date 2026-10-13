// The match simulation: a pure, deterministic, top-down arena on a 2 m grid. No three.js, no DOM, so it runs the
// same on the host, in the Node tests and in the `?snap` hook. The view reads snapshots (`buildSnap`) and the
// one-shot `events` list; online clients receive exactly the same two things.
import { DASH, HEROES, SUPER, type Hero, type HeroId } from './heroes.ts'
import { CELL, MAPS, cellKind, type CellKind, type MapDef, type MapId } from './maps.ts'
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
}

export const FIGHTER_R = 0.45

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
}

export type ProjKind = 'bullet' | 'pellet' | 'rail' | 'grenade' | 'flame' | 'needle' | 'turret'

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
}

export type DeployKind = 'turret' | 'mine' | 'heal'

export interface Deployable {
  id: number
  kind: DeployKind
  owner: number
  team: number
  x: number
  z: number
  hp: number
  until: number
  armAt: number
  fireCd: number
  aim: number
}

export interface Crate {
  id: number
  cx: number
  cz: number
  hp: number
  loot: boolean
}

export type LootKind = 'medkit' | 'plating' | 'overclock' | 'servo' | 'cell'

export interface Pickup {
  id: number
  x: number
  z: number
  kind: LootKind
}

export type SimEvent =
  | { t: 'shot'; id: number; x: number; z: number; aim: number; kind: ProjKind }
  | { t: 'hit'; x: number; z: number; dmg: number; target: number; heal?: boolean }
  | { t: 'death'; id: number; x: number; z: number; killer: number }
  | { t: 'explode'; x: number; z: number; r: number; kind: 'grenade' | 'mine' | 'pulse' | 'crate' }
  | { t: 'super'; id: number; hero: HeroId; x: number; z: number }
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
}

/** Snapshot: what the view (and online clients) draw. Numbers only so it serialises cheaply. */
export interface Snap {
  t: number
  /** [id, x, z, aim, hp, maxHp, flags, super, vx, vz, shield] — flags: alive 1, cloak 2, shield 4, superOn 8, dash 16, spawnShield 32, out 64 */
  f: number[][]
  /** [id, kindIdx, x, z, y, vx, vz, ownerId] */
  p: number[][]
  /** [id, kindIdx, x, z, hp, aim, armed] */
  d: number[][]
  /** Crate hp per crate index (0 = gone). */
  c: number[]
  /** [id, x, z, kindIdx] */
  k: number[][]
  s: [number, number]
  /** 0 countdown, 1 play, 2 over */
  ph: number
  cd: number
  w: number
  /** [cx, cz, half, nextCx, nextCz, nextHalf, shrinkAt, stage, alive] */
  br: number[] | null
}

export const PROJ_KINDS: ProjKind[] = ['bullet', 'pellet', 'rail', 'grenade', 'flame', 'needle', 'turret']
export const DEPLOY_KINDS: DeployKind[] = ['turret', 'mine', 'heal']
export const LOOT_KINDS: LootKind[] = ['medkit', 'plating', 'overclock', 'servo', 'cell']

const GRAVITY = 18
const REGEN_DELAY = 5
const REGEN_RATE = 0.07
const RESPAWN = 3.5
const TEAM_SPAWN_SHIELD = 2
const BR_FIRST_SHRINK = 22
const BR_SHRINK_TIME = 10
const BR_HOLD = 14

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
      // Extra crates from the seed so no two matches are quite alike.
      for (let n = 0; n < 14; n++) {
        const cx = 2 + this.rng.int(this.w - 4)
        const cz = 2 + this.rng.int(this.h - 4)
        const i = cz * this.w + cx
        if (this.cells[i] !== 'floor' || this.chars[i] !== '.') continue
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
  }

  /* ---------- Setup ---------- */

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
      input: { mx: 0, mz: 0, ax: 1, az: 0, aimDist: 6, fire: false, dash: false, super: false },
      bot: r.human ? null : { target: 0, path: [], pathAt: -9, thinkAt: 0, mode: 'roam', goalX: 0, goalZ: 0, strafe: 1, strafeAt: 0, seenAt: -9, seenX: 0, seenZ: 0, jitter: this.rng.next() },
      rammed: new Set(),
      loot: 0,
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
    f.bot = human ? null : { target: 0, path: [], pathAt: -9, thinkAt: 0, mode: 'roam', goalX: 0, goalZ: 0, strafe: 1, strafeAt: 0, seenAt: -9, seenX: 0, seenZ: 0, jitter: this.rng.next() }
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
    this.stepPickups()
    if (this.mode === 'capture') this.stepZone(dt)
    if (this.br) this.stepGrid(dt)
    this.checkEnd()
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
    if (f.shieldUntil && now > f.shieldUntil) {
      f.shield = 0
      f.shieldUntil = 0
    }
    if (f.superUntil && now > f.superUntil) {
      f.superUntil = 0
      f.rammed.clear()
    }
    if (f.cloakUntil && now > f.cloakUntil) f.cloakUntil = 0
    // Out-of-combat regen.
    if (now - f.lastHurtAt > REGEN_DELAY && f.hp < f.maxHp) {
      const heal = Math.min(f.maxHp - f.hp, f.maxHp * REGEN_RATE * dt)
      f.hp += heal
    }
    // Super charges slowly on its own too.
    f.super = Math.min(1, f.super + 0.012 * dt * f.gear.charge)
    // Dash.
    if (inp.dash && f.dashCd <= 0 && !f.dashUntil) {
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
    // Super.
    if (inp.super && f.super >= 1) this.useSuper(f)
    // Movement.
    let speed = f.speed
    if (f.hero.superKind === 'bulwark' && f.superUntil) speed *= SUPER.bulwark.speedMul
    if (f.hero.superKind === 'cloak' && f.cloakUntil) speed *= SUPER.cloak.speedMul
    if (f.hero.weapon.kind === 'flame' && inp.fire) speed *= 0.9
    let vx: number
    let vz: number
    if (f.dashUntil) {
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
          this.hurt(o, SUPER.bulwark.ramDmg * f.dmgMul, f)
          const d = Math.hypot(o.x - f.x, o.z - f.z) || 1
          o.knockX += ((o.x - f.x) / d) * SUPER.bulwark.knock
          o.knockZ += ((o.z - f.z) / d) * SUPER.bulwark.knock
        }
      }
    }
    // Weapon.
    if (f.burst > 0 && now >= f.burstAt) {
      f.burst--
      f.burstAt = now + f.hero.weapon.burstGap
      this.spawnShot(f, 'needle')
    }
    if (inp.fire && f.fireCd <= 0 && !f.dashUntil) this.fire(f)
    // Grid damage.
    if (this.br && !this.insideGrid(f.x, f.z)) this.hurt(f, this.br.dps * dt, null, true)
  }

  /** Move a fighter with axis-separated collision against the grid. */
  private moveCircle(f: Fighter, dx: number, dz: number) {
    const r = FIGHTER_R
    const tryAxis = (nx: number, nz: number) => {
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
        if (this.blocksWalk(this.cellAt(nx + ox, nz + oz))) return false
      return true
    }
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

  private fire(f: Fighter) {
    const w = f.hero.weapon
    f.fireCd = w.cooldown
    if (f.cloakUntil) f.cloakUntil = 0
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
        f.burstAt = this.time + w.burstGap
        break
    }
  }

  private spawnShot(f: Fighter, kind: ProjKind, event = true) {
    const w = f.hero.weapon
    const spread = kind === 'needle' || kind === 'rail' ? w.spread : w.spread * (this.rng.next() * 2 - 1) * (kind === 'pellet' ? 1 : 1)
    const a = f.aim + (kind === 'pellet' ? (this.rng.next() * 2 - 1) * w.spread : spread)
    const muzzle = 0.7
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
      dmg: w.dmg * f.dmgMul,
      splash: w.splash,
    }
    if (kind === 'flame') {
      p.ttl *= 0.8 + this.rng.next() * 0.4
      p.dmg = w.dmg * f.dmgMul
    }
    if (kind === 'grenade') {
      const d = Math.min(w.range, Math.max(3, f.input.aimDist))
      const T = d / w.speed
      p.vy = (GRAVITY * T) / 2
      p.ttl = T
    }
    this.projectiles.push(p)
    if (event) this.events.push({ t: 'shot', id: f.id, x: p.x, z: p.z, aim: a, kind })
  }

  private useSuper(f: Fighter) {
    const now = this.time
    f.super = 0
    f.supersUsed++
    this.events.push({ t: 'super', id: f.id, hero: f.hero.id, x: f.x, z: f.z })
    switch (f.hero.superKind) {
      case 'bulwark':
        f.superUntil = now + SUPER.bulwark.duration
        f.shield = SUPER.bulwark.shield
        f.shieldUntil = now + SUPER.bulwark.duration
        f.rammed.clear()
        break
      case 'sentry':
        this.deployables.push({ id: this.nextId++, kind: 'turret', owner: f.id, team: f.team, x: f.x + Math.cos(f.aim) * 0.9, z: f.z + Math.sin(f.aim) * 0.9, hp: SUPER.sentry.hp, until: now + SUPER.sentry.duration, armAt: now + 0.4, fireCd: 0.5, aim: f.aim })
        break
      case 'pulse':
        this.events.push({ t: 'explode', x: f.x, z: f.z, r: SUPER.pulse.radius, kind: 'pulse' })
        for (const o of this.fighters) {
          if (o === f || !o.alive || o.team === f.team) continue
          const d = Math.hypot(o.x - f.x, o.z - f.z)
          if (d > SUPER.pulse.radius) continue
          this.hurt(o, SUPER.pulse.dmg * f.dmgMul, f)
          const n = d || 1
          o.knockX += ((o.x - f.x) / n) * SUPER.pulse.knock
          o.knockZ += ((o.z - f.z) / n) * SUPER.pulse.knock
        }
        f.shield = SUPER.pulse.shield
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
          this.deployables.push({ id: this.nextId++, kind: 'mine', owner: f.id, team: f.team, x, z, hp: 1, until: now + SUPER.mines.life, armAt: now + SUPER.mines.arm, fireCd: 0, aim: 0 })
        }
        break
      case 'mend':
        this.deployables.push({ id: this.nextId++, kind: 'heal', owner: f.id, team: f.team, x: f.x, z: f.z, hp: 1, until: now + SUPER.mend.duration, armAt: now, fireCd: 0, aim: 0 })
        break
    }
  }

  /** Apply damage. `attacker` null = environment. Returns the damage that landed. */
  hurt(target: Fighter, dmg: number, attacker: Fighter | null, silent = false) {
    if (!target.alive || dmg <= 0) return 0
    if (this.time < target.spawnShieldUntil) return 0
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

  heal(target: Fighter, amount: number, healer: Fighter | null) {
    if (!target.alive) return
    const h = Math.min(amount, target.maxHp - target.hp)
    if (h <= 0) return
    target.hp += h
    if (healer) healer.healing += h
  }

  private kill(f: Fighter, attacker: Fighter | null) {
    f.alive = false
    f.hp = 0
    f.deaths++
    f.shield = 0
    f.shieldUntil = 0
    f.cloakUntil = 0
    f.superUntil = 0
    f.dashUntil = 0
    f.burst = 0
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
    if (this.mode === 'br') {
      f.out = true
      f.placement = this.placementsLeft--
    } else f.respawnAt = this.time + RESPAWN
    // Deployables die with their owner (except mines, which stay as a parting gift).
    this.deployables = this.deployables.filter((d) => d.owner !== f.id || d.kind === 'mine')
  }

  private respawn(f: Fighter) {
    f.alive = true
    f.hp = f.maxHp
    f.super = Math.min(f.super, 0.5)
    f.knockX = f.knockZ = 0
    f.fireCd = 0
    f.dashCd = 0
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
      const grenade = p.kind === 'grenade'
      const x0 = p.x
      const z0 = p.z
      const x1 = p.x + p.vx * dt
      const z1 = p.z + p.vz * dt
      if (grenade) {
        p.y += p.vy * dt
        p.vy -= GRAVITY * dt
      }
      // Grid.
      let hitWall = false
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.4))
      for (let i = 1; i <= steps && !hitWall; i++) {
        const t = i / steps
        const k = this.cellAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)
        if (this.blocksShot(k, grenade)) {
          hitWall = true
          p.x = x0 + (x1 - x0) * ((i - 1) / steps)
          p.z = z0 + (z1 - z0) * ((i - 1) / steps)
          if (k === 'crate' && !grenade) this.damageCrate(p.x + (x1 - x0) * 0.2 / steps, p.z + (z1 - z0) * 0.2 / steps, p.dmg, p.owner)
        }
      }
      if (!hitWall) {
        p.x = x1
        p.z = z1
      }
      // Fighters.
      let hitF: Fighter | null = null
      if (!grenade || p.y < 1.4) {
        let bestT = 2
        for (const f of this.fighters) {
          if (!f.alive || f.id === p.owner || (f.team === p.team && this.mode !== 'br')) continue
          const t = segCircle(x0, z0, p.x, p.z, f.x, f.z, FIGHTER_R + 0.1)
          if (t >= 0 && t < bestT) {
            bestT = t
            hitF = f
          }
        }
        if (hitF) {
          p.x = x0 + (p.x - x0) * bestT
          p.z = z0 + (p.z - z0) * bestT
        }
      }
      // Deployables (turrets) can be shot.
      let hitD: Deployable | null = null
      if (!hitF && !grenade)
        for (const d of this.deployables) {
          if (d.kind !== 'turret' || d.team === p.team) continue
          if (segCircle(x0, z0, p.x, p.z, d.x, d.z, 0.6) >= 0) hitD = d
        }
      const owner = this.fighter(p.owner) ?? null
      if (grenade) {
        if (hitWall || hitF || p.ttl <= 0 || p.y <= 0) {
          this.explode(p.x, p.z, p.splash, p.dmg, owner, 'grenade')
          continue
        }
        keep.push(p)
        continue
      }
      if (hitF) {
        this.hurt(hitF, p.dmg, owner)
        continue
      }
      if (hitD) {
        hitD.hp -= p.dmg
        this.events.push({ t: 'hit', x: hitD.x, z: hitD.z, dmg: Math.round(p.dmg), target: -hitD.id })
        continue
      }
      if (hitWall || p.ttl <= 0) continue
      keep.push(p)
    }
    this.projectiles = keep
  }

  private explode(x: number, z: number, r: number, dmg: number, owner: Fighter | null, kind: 'grenade' | 'mine') {
    this.events.push({ t: 'explode', x, z, r, kind })
    for (const f of this.fighters) {
      if (!f.alive) continue
      if (owner && f.team === owner.team && this.mode !== 'br' && f !== owner) continue
      const d = Math.hypot(f.x - x, f.z - z)
      if (d > r + FIGHTER_R) continue
      const fall = 1 - Math.max(0, d - 0.6) / (r + FIGHTER_R)
      const amount = dmg * (f === owner ? 0.35 : 1) * (0.45 + 0.55 * fall)
      this.hurt(f, amount, owner && owner !== f ? owner : null)
      const n = d || 1
      f.knockX += ((f.x - x) / n) * 3 * fall
      f.knockZ += ((f.z - z) / n) * 3 * fall
    }
    for (const d of this.deployables) if (d.kind === 'turret' && Math.hypot(d.x - x, d.z - z) < r + 0.6) d.hp -= dmg
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
      const kind = this.rng.pick(LOOT_KINDS)
      this.pickups.push({ id: this.nextId++, x: mx, z: mz, kind })
    }
    void by
  }

  /* ---------- Deployables ---------- */

  private stepDeployables(dt: number) {
    const keep: Deployable[] = []
    for (const d of this.deployables) {
      const owner = this.fighter(d.owner) ?? null
      if (this.time > d.until || d.hp <= 0) {
        if (d.kind === 'turret' && d.hp <= 0) this.events.push({ t: 'explode', x: d.x, z: d.z, r: 1, kind: 'crate' })
        continue
      }
      if (d.kind === 'turret') {
        d.fireCd -= dt
        let best: Fighter | null = null
        let bestD = SUPER.sentry.range
        for (const f of this.fighters) {
          if (!f.alive || f.team === d.team || f.cloakUntil) continue
          const dist = Math.hypot(f.x - d.x, f.z - d.z)
          if (dist < bestD && this.lineClear(d.x, d.z, f.x, f.z)) {
            bestD = dist
            best = f
          }
        }
        if (best) {
          const lead = bestD / SUPER.sentry.speed
          d.aim = Math.atan2(best.z + best.vz * lead - d.z, best.x + best.vx * lead - d.x)
          if (d.fireCd <= 0 && this.time >= d.armAt) {
            d.fireCd = SUPER.sentry.cooldown
            this.projectiles.push({ id: this.nextId++, kind: 'turret', owner: d.owner, team: d.team, x: d.x + Math.cos(d.aim) * 0.7, z: d.z + Math.sin(d.aim) * 0.7, y: 1, vx: Math.cos(d.aim) * SUPER.sentry.speed, vz: Math.sin(d.aim) * SUPER.sentry.speed, vy: 0, ttl: SUPER.sentry.range / SUPER.sentry.speed, dmg: SUPER.sentry.dmg * (owner?.dmgMul ?? 1), splash: 0 })
            this.events.push({ t: 'shot', id: -d.id, x: d.x, z: d.z, aim: d.aim, kind: 'turret' })
          }
        }
      } else if (d.kind === 'mine') {
        if (this.time >= d.armAt)
          for (const f of this.fighters) {
            if (!f.alive || (f.team === d.team && this.mode !== 'br') || f.id === d.owner) continue
            if (Math.hypot(f.x - d.x, f.z - d.z) < 1.1) {
              this.explode(d.x, d.z, SUPER.mines.radius, SUPER.mines.dmg * (owner?.dmgMul ?? 1), owner, 'mine')
              d.hp = 0
              break
            }
          }
        if (d.hp <= 0) continue
      } else if (d.kind === 'heal') {
        for (const f of this.fighters) {
          if (!f.alive || (f.team !== d.team && this.mode !== 'br') || (this.mode === 'br' && f.id !== d.owner)) continue
          if (Math.hypot(f.x - d.x, f.z - d.z) < SUPER.mend.radius) this.heal(f, SUPER.mend.hps * dt, owner)
        }
      }
      keep.push(d)
    }
    this.deployables = keep
  }

  /* ---------- Pickups (battle royale loot) ---------- */

  private stepPickups() {
    if (!this.pickups.length) return
    const keep: Pickup[] = []
    for (const p of this.pickups) {
      let taken = false
      for (const f of this.fighters) {
        if (!f.alive || Math.hypot(f.x - p.x, f.z - p.z) > FIGHTER_R + 0.5) continue
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
    f.loot++
    switch (kind) {
      case 'medkit':
        this.heal(f, f.maxHp * 0.6, null)
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
    return {
      t: now,
      f: this.fighters.map((f) => [
        f.id,
        round(f.x),
        round(f.z),
        round(f.aim),
        Math.round(f.hp),
        f.maxHp,
        (f.alive ? 1 : 0) | (f.cloakUntil ? 2 : 0) | (f.shield > 0 ? 4 : 0) | (f.superUntil ? 8 : 0) | (f.dashUntil ? 16 : 0) | (now < f.spawnShieldUntil ? 32 : 0) | (f.out ? 64 : 0),
        round(f.super),
        round(f.vx),
        round(f.vz),
        Math.round(f.shield),
      ]),
      p: this.projectiles.map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), round(p.x), round(p.z), round(p.y), round(p.vx), round(p.vz), p.owner]),
      d: this.deployables.map((d) => [d.id, DEPLOY_KINDS.indexOf(d.kind), round(d.x), round(d.z), Math.round(d.hp), round(d.aim), now >= d.armAt ? 1 : 0, d.team]),
      c: this.crates.map((c) => Math.max(0, Math.round(c.hp))),
      k: this.pickups.map((k) => [k.id, round(k.x), round(k.z), LOOT_KINDS.indexOf(k.kind)]),
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

export const SNAP_FLAGS = { alive: 1, cloak: 2, shield: 4, superOn: 8, dash: 16, spawnShield: 32, out: 64 }
