// Bot brains. A household bot preps (barricades doors, lays traps), then raids (paths to the rival's valuables and
// smashes them, breaking through walls and barricades, leaning a ladder to the balcony when the doors are held),
// defends (hunts raiders in its own house), fights (spacing, light/heavy swings, blocks heavy wind-ups, throws
// junk at range) and fires its ultimate when the moment fits. Garden robots walk at the valuables and smash.
import { THROWABLES, TRAPS } from './gear.ts'
import type { HouseInfo } from './houses.ts'
import type { NavPoint } from './nav.ts'
import { boxOf, type Piece } from './pieces.ts'
import { emptyInput, type Input, type Player, type Sim } from './sim.ts'

type Task = { kind: 'idle' } | { kind: 'barricade'; door: Piece } | { kind: 'trap'; x: number; y: number; z: number; slot: number } | { kind: 'raid'; target: Piece } | { kind: 'defend'; anchor: { x: number; y: number; z: number } } | { kind: 'hunt'; target: Player } | { kind: 'ladder'; house: HouseInfo }

const turnRate = 7

export class Bot {
  private sim: Sim
  private p: Player
  private inp: Input
  private task: Task = { kind: 'idle' }
  private path: NavPoint[] | null = null
  private navVersion = -1
  private goal = { x: 0, y: 0, z: 0 }
  private replanAt = 0
  private stuckAt = 0
  private lastPos = { x: 0, z: 0 }
  private strafe = 1
  private strafeAt = 0
  private throwAt = 0
  private swingAt = 0
  private taskAt = 0
  private wantYaw = 0
  private wantPitch = 0
  private skill: number
  private trapSpots: { x: number; y: number; z: number }[] = []
  private ladderTried = 0

  constructor(sim: Sim, p: Player, difficulty: number) {
    this.sim = sim
    this.p = p
    this.inp = emptyInput()
    p.input = this.inp
    this.skill = Math.min(1, difficulty + ((p.id * 37) % 10) / 40)
    this.wantYaw = p.yaw
    this.inp.yaw = p.yaw
    this.lastPos = { x: p.x, z: p.z }
    this.stuckAt = sim.time
    const home = sim.houses[p.team]
    if (home) {
      const spots = [...home.insideSpots, ...home.doorSteps]
      // Each bot takes different spots so traps spread out.
      this.trapSpots = spots.filter((_, i) => (i + p.id) % 2 === 0).sort(() => sim.rng.next() - 0.5)
    }
  }

  think(dt: number) {
    const p = this.p
    const inp = this.inp
    const sim = this.sim
    inp.light = inp.heavy = inp.throw = inp.use = inp.ladder = inp.ult = inp.jump = false
    inp.block = false
    inp.sprint = false
    inp.crouch = false
    inp.mx = inp.mz = 0
    if (!p.alive) return
    // Turn toward the wanted facing.
    inp.yaw = turnTo(inp.yaw, this.wantYaw, turnRate * dt)
    inp.pitch += (this.wantPitch - inp.pitch) * Math.min(1, 10 * dt)
    if (p.onLadder) {
      inp.mz = 1
      return
    }
    if (sim.time >= this.taskAt) {
      this.taskAt = sim.time + 0.3
      this.pickTask()
    }
    // Threat: a visible enemy close by takes priority over whatever we were doing.
    const enemy = this.nearestEnemy(7)
    if (enemy && sim.phase === 'play' && this.task.kind !== 'ladder') {
      this.fight(enemy, dt)
      return
    }
    switch (this.task.kind) {
      case 'idle':
        break
      case 'barricade':
        this.doBarricade(this.task.door)
        break
      case 'trap':
        this.doTrap(this.task)
        break
      case 'raid':
        this.doRaid(this.task.target)
        break
      case 'defend':
        this.doDefend(this.task.anchor)
        break
      case 'hunt':
        this.doHunt(this.task.target)
        break
      case 'ladder':
        this.doLadder(this.task.house)
        break
    }
    this.maybeUlt()
  }

  /* ---------- task selection ---------- */

  private pickTask() {
    const sim = this.sim
    const p = this.p
    const home = sim.houses[p.team]
    if (sim.phase === 'prep') {
      if (!home) return
      // Barricade exterior doors first (the front door most of all), then lay traps.
      if (this.task.kind === 'barricade' && this.task.door.alive && this.task.door.level < 2) return
      if (this.task.kind === 'trap') return
      const doors = home.doors.filter((d) => d.alive && d.level < 2 && d.kind !== 'garage')
      const mine = doors.filter((_, i) => i % Math.max(1, sim.players.filter((o) => o.team === p.team && !o.robot).length) === (p.id - 1) % 4)
      const door = mine[0] ?? doors[0]
      if (door && sim.rng.chance(0.8)) {
        this.task = { kind: 'barricade', door }
        return
      }
      const slot = p.trapAmmo.findIndex((a) => a > 0)
      if (slot >= 0 && this.trapSpots.length) {
        const s = this.trapSpots.pop()!
        this.task = { kind: 'trap', x: s.x, y: s.y, z: s.z, slot }
        return
      }
      this.task = { kind: 'defend', anchor: home.stairs.bottom }
      return
    }
    if (sim.phase !== 'play') return
    if (sim.mode === 'brawl') {
      const e = this.nearestEnemy(80)
      this.task = e ? { kind: 'hunt', target: e } : { kind: 'idle' }
      return
    }
    if (sim.mode === 'robots') {
      const robot = this.nearestEnemy(60, false)
      if (robot) this.task = { kind: 'hunt', target: robot }
      else if (home) this.task = { kind: 'defend', anchor: home.insideSpots[(p.id * 3) % home.insideSpots.length] }
      return
    }
    // Destruction: who defends? The lowest id on the team when the house still has valuables and raiders are
    // in it; everyone else raids. A bot already raiding keeps its target while it stands.
    const team = sim.players.filter((o) => o.team === p.team && !o.robot)
    const enemyHouse = sim.houses[1 - p.team]
    const intruders = sim.players.filter((o) => o.alive && o.team !== p.team && sim.houseAt(o.x, o.z) === p.team)
    const defenderId = team.filter((o) => o.alive).sort((a, b) => a.id - b.id)[0]?.id
    const shouldDefend = home && sim.valuablesLeft(p.team) > 0 && (intruders.length > 0 ? p.id === defenderId || (intruders.length >= 2 && team.filter((o) => o.alive)[1]?.id === p.id) : false)
    const nearHome = home ? Math.hypot(p.x - home.ox, p.z - home.oz) < 22 : false
    if (shouldDefend && (nearHome || intruders.length >= 2)) {
      const t = intruders.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]
      this.task = t ? { kind: 'hunt', target: t } : { kind: 'defend', anchor: home.stairs.bottom }
      return
    }
    if (this.task.kind === 'raid' && this.task.target.alive) return
    if (this.task.kind === 'ladder') return
    const targets = enemyHouse.valuables.filter((v) => v.alive)
    if (!targets.length) {
      // Nothing left to break: harass.
      const e = this.nearestEnemy(80)
      this.task = e ? { kind: 'hunt', target: e } : { kind: 'defend', anchor: home.stairs.bottom }
      return
    }
    // Prefer close, valuable targets; spread the team a little by id.
    let best: Piece | null = null
    let bestScore = -1
    for (const v of targets) {
      const d = Math.hypot(v.x - p.x, v.z - p.z) + Math.abs(v.y - p.y) * 1.5
      // Odd ids lean towards the upstairs loot, so the household splits across both floors.
      const s = (v.value / (10 + d)) * (v.floor >= 1 && p.id % 2 === 1 ? 1.5 : 1) + ((v.id + p.id) % 3) * 0.5
      if (s > bestScore) {
        bestScore = s
        best = v
      }
    }
    if (best) {
      // Upstairs targets: a ladder to the balcony skips the barricades (some of the time).
      if (best.floor >= 1 && p.ladders > 0 && this.ladderTried < 2 && sim.rng.chance(0.6) && sim.houseAt(p.x, p.z) !== 1 - p.team) {
        this.task = { kind: 'ladder', house: enemyHouse }
        this.path = null
        return
      }
      this.task = { kind: 'raid', target: best }
      this.path = null
    }
  }

  /* ---------- helpers ---------- */

  private nearestEnemy(range: number, needLos = true) {
    const sim = this.sim
    const p = this.p
    let best: Player | null = null
    let bd = range
    for (const o of sim.players) {
      if (!o.alive || o === p) continue
      if (o.team === p.team && !(sim.mode === 'robots' && o.robot !== p.robot)) continue
      if (sim.mode === 'robots' && !o.robot) continue
      const d = Math.hypot(o.x - p.x, o.z - p.z, (o.y - p.y) * 0.7)
      if (d >= bd) continue
      if (needLos && d > 2.5 && !sim.lineClear(p.x, p.y + p.hero.eye, p.z, o.x, o.y + o.hero.eye, o.z)) continue
      best = o
      bd = d
    }
    return best
  }

  private face(x: number, y: number, z: number) {
    const p = this.p
    const dx = x - p.x
    const dz = z - p.z
    this.wantYaw = Math.atan2(dx, dz)
    const dy = y - (p.y + p.hero.eye)
    this.wantPitch = Math.atan2(dy, Math.hypot(dx, dz) || 0.01)
  }

  private facing(x: number, z: number, tol = 0.35) {
    const p = this.p
    const dx = x - p.x
    const dz = z - p.z
    const d = Math.hypot(dx, dz) || 1
    return (dx / d) * Math.sin(this.inp.yaw) + (dz / d) * Math.cos(this.inp.yaw) > 1 - tol
  }

  /** Move toward a world point along the nav grid. Returns the distance left (or -1 if unreachable). */
  private goTo(x: number, y: number, z: number, sprint = true) {
    const sim = this.sim
    const p = this.p
    const inp = this.inp
    const d = Math.hypot(x - p.x, z - p.z)
    const dy = Math.abs(y - p.y)
    if (d < 0.9 && dy < 1.2) {
      this.path = null
      return d
    }
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z)
    if (moved > 0.4) {
      this.lastPos = { x: p.x, z: p.z }
      this.stuckAt = sim.time
    }
    const stuck = sim.time - this.stuckAt > 2.2
    const goalMoved = Math.hypot(x - this.goal.x, z - this.goal.z) > 1.5 || Math.abs(y - this.goal.y) > 1
    if (!this.path || goalMoved || stuck || sim.time > this.replanAt || this.navVersion !== sim.nav.version) {
      const avoid = sim.traps.filter((t) => t.team !== p.team && (t.revealed || this.skill > 0.85) && t.armed).map((t) => ({ x: t.x, z: t.z, y: t.y }))
      this.path = sim.nav.find(p.x, p.y, p.z, x, y, z, avoid, p.team)
      this.goal = { x, y, z }
      this.replanAt = sim.time + 2.5 + sim.rng.range(0, 1)
      this.navVersion = sim.nav.version
      if (stuck) {
        this.stuckAt = sim.time
        inp.jump = true
        // Smash whatever is right in front of us.
        const r = sim.raycast(p.x, p.y + 0.7, p.z, Math.sin(inp.yaw), 0, Math.cos(inp.yaw), 2.5, (q) => q.alive && q.solid && q.breakable)
        if (r) {
          this.face(r.piece.x, r.piece.y + Math.min(r.piece.h, 0.8), r.piece.z)
          this.swingAt_(r.piece, true)
        }
      }
      if (!this.path) return -1
    }
    // Drop waypoints we have reached.
    while (this.path.length > 1) {
      const wp = this.path[0]
      const wd = Math.hypot(wp.x - p.x, wp.z - p.z)
      if (wd < (wp.link ? 0.55 : 0.75) && Math.abs(wp.y - p.y) < 1.4) this.path.shift()
      else break
    }
    const wp = this.path[0]
    // Something breakable in the way of the next cell: smash it.
    if (wp.breakPiece && wp.breakPiece.alive) {
      const q = wp.breakPiece
      const qd = Math.hypot(q.x - p.x, q.z - p.z)
      if (qd < p.hero.melee.reach + 0.8 && Math.abs(q.y + q.h / 2 - (p.y + 1)) < 2.5) {
        this.face(q.x, q.y + Math.min(q.h, 1.3), q.z)
        if (this.facing(q.x, q.z, 0.2)) this.swingAt_(q, q.kind === 'wall' || q.kind === 'door' || q.kind === 'garage')
        inp.mz = 0.2
        return d
      }
    }
    this.face(wp.x, p.y + p.hero.eye + (wp.y - p.y) * 0.5, wp.z)
    this.wantPitch = wp.link?.kind === 'ladder' ? 0.3 : Math.max(-0.5, Math.min(0.3, (wp.y - p.y) * 0.2))
    inp.mz = 1
    inp.sprint = sprint && d > 4 && !p.blocking
    if (wp.link?.kind === 'drop' && wp.y < p.y - 1) inp.jump = true
    if (wp.y > p.y + 0.5 && !wp.link) inp.jump = p.onGround && sim.time - this.stuckAt > 0.6
    return d
  }

  private swingAt_(q: Piece, heavy: boolean) {
    const sim = this.sim
    const p = this.p
    if (sim.time < this.swingAt || p.swing) return
    void q
    if (heavy && p.stamina > 30 && sim.rng.chance(0.7)) {
      this.inp.heavy = true
      this.swingAt = sim.time + 0.85
    } else {
      this.inp.light = true
      this.swingAt = sim.time + 0.33
    }
  }

  /* ---------- tasks ---------- */

  private doBarricade(door: Piece) {
    const sim = this.sim
    const p = this.p
    if (!door.alive || door.level >= 2) {
      this.task = { kind: 'idle' }
      this.taskAt = 0
      return
    }
    const home = sim.houses[p.team]
    // Stand inside the house, 1.6 m from the door, looking at it.
    const inward = door.kind === 'garage' ? -home.dir : door.z > home.oz === home.dir > 0 ? -home.dir : home.dir
    const sx = door.yaw % Math.PI === 0 ? door.x : door.x + (door.x > home.ox ? -1.6 : 1.6)
    const sz = door.yaw % Math.PI === 0 ? door.z + inward * 1.6 : door.z
    const d = this.goTo(sx, door.y, sz, false)
    if (d >= 0 && d < 1.2) {
      this.face(door.x, door.y + 1.0, door.z)
      if (this.facing(door.x, door.z, 0.15) && sim.time > this.throwAt) {
        this.inp.use = true
        this.throwAt = sim.time + 0.6
      }
    }
  }

  private doTrap(t: { x: number; y: number; z: number; slot: number }) {
    const sim = this.sim
    const p = this.p
    if (p.trapAmmo[t.slot] <= 0) {
      this.task = { kind: 'idle' }
      this.taskAt = 0
      return
    }
    const d = this.goTo(t.x, t.y, t.z, false)
    if (d < 0) {
      this.task = { kind: 'idle' }
      this.taskAt = 0
      return
    }
    if (d < 1.8) {
      this.inp.slot = t.slot
      this.face(t.x, t.y, t.z)
      this.wantPitch = -0.9
      if (Math.abs(this.inp.pitch - this.wantPitch) < 0.2 && sim.time > this.throwAt) {
        const ok = sim.placeTrap(p, t.x, t.y, t.z)
        this.throwAt = sim.time + 0.5
        this.task = { kind: 'idle' }
        this.taskAt = 0
        void ok
      }
    }
  }

  private doRaid(target: Piece) {
    const sim = this.sim
    const p = this.p
    if (!target.alive) {
      this.task = { kind: 'idle' }
      this.taskAt = 0
      return
    }
    const cx = target.x
    const cz = target.z
    const d = Math.hypot(cx - p.x, cz - p.z)
    const reach = p.hero.melee.reach + Math.max(target.w, target.d) / 2
    const sameFloor = Math.abs(target.y - p.y) < 1.5
    if (d < reach - 0.2 && sameFloor) {
      this.face(cx, target.y + target.h * 0.5, cz)
      if (this.facing(cx, cz, 0.25)) this.swingAt_(target, true)
      // Pebbles: the kid shoots from a little further back.
      return
    }
    if (p.hero.melee.ranged && d < 9 && sameFloor && sim.lineClear(p.x, p.y + p.hero.eye, p.z, cx, target.y + target.h / 2, cz)) {
      this.face(cx, target.y + target.h * 0.5, cz)
      if (this.facing(cx, cz, 0.1)) this.swingAt_(target, false)
      return
    }
    const r = this.goTo(cx, target.y, cz)
    if (r < 0) {
      // Unreachable: try a ladder onto the balcony if the target is upstairs, else wait for a wall to fall.
      const house = sim.houses[1 - p.team]
      if (p.ladders > 0 && this.ladderTried < 2 && target.floor >= 1) {
        this.task = { kind: 'ladder', house }
        return
      }
      this.goTo(house.doorSteps[0].x, 0, house.doorSteps[0].z)
    }
  }

  private doLadder(house: HouseInfo) {
    const s = house.ladderSpot
    // A team-mate already leaned one here: use it instead of stacking another.
    if (this.sim.ladders.some((l) => l.alive && Math.hypot(l.x - s.x, l.z - s.z) < 3 && l.y < 1)) {
      this.task = { kind: 'idle' }
      this.ladderTried++
      this.path = null
      return
    }
    const d = this.goTo(s.x, 0, s.z)
    if (d < 0) {
      this.task = { kind: 'idle' }
      this.ladderTried++
      return
    }
    if (d < 0.6) {
      this.wantYaw = s.yaw
      this.wantPitch = 0.2
      if (Math.abs(angleDiff(this.inp.yaw, s.yaw)) < 0.15) {
        this.inp.ladder = true
        this.ladderTried++
        this.task = { kind: 'idle' }
        this.taskAt = 0
        this.path = null
      }
    }
  }

  private doDefend(anchor: { x: number; y: number; z: number }) {
    const sim = this.sim
    const p = this.p
    const d = this.goTo(anchor.x, anchor.y, anchor.z, false)
    if (d >= 0 && d < 1.5) {
      // Look around.
      if (sim.time > this.strafeAt) {
        this.strafeAt = sim.time + 2
        this.wantYaw = p.yaw + sim.rng.range(-1.5, 1.5)
        this.wantPitch = 0
      }
      // Top up barricades while it is quiet.
      const home = sim.houses[p.team]
      if (home && sim.mode !== 'brawl') {
        const door = home.doors.find((q) => q.alive && q.level < 2 && q.kind !== 'garage')
        if (door && sim.rng.chance(0.02)) this.task = { kind: 'barricade', door }
      }
    }
  }

  private doHunt(target: Player) {
    if (!target.alive) {
      this.task = { kind: 'idle' }
      this.taskAt = 0
      return
    }
    const d = this.goTo(target.x, target.y, target.z)
    if (d < 0) this.task = { kind: 'idle' }
  }

  /* ---------- combat ---------- */

  private fight(e: Player, dt: number) {
    void dt
    const sim = this.sim
    const p = this.p
    const inp = this.inp
    const dx = e.x - p.x
    const dz = e.z - p.z
    const d = Math.hypot(dx, dz)
    const reach = p.hero.melee.reach
    const ranged = !!p.hero.melee.ranged && !p.tool
    this.face(e.x, e.y + e.hero.eye * 0.8, e.z)
    const want = ranged ? 6 : p.hero.prefRange
    // Spacing: in, out, and a strafe that flips now and then.
    if (sim.time > this.strafeAt) {
      this.strafeAt = sim.time + sim.rng.range(0.6, 1.6)
      this.strafe = sim.rng.chance(0.5) ? 1 : -1
    }
    if (d > want + 0.4) {
      if (d > 3.5) this.goTo(e.x, e.y, e.z)
      else inp.mz = 1
    } else if (d < want - 0.5) inp.mz = -0.6
    inp.mx = this.strafe * (d < 4 ? 0.6 : 0.2)
    inp.sprint = d > 5
    // Block a heavy wind-up coming our way (better bots parry late).
    if (e.swing?.heavy && !e.swing.done && d < reach + 1 && sim.rng.chance(this.skill * 0.9)) {
      inp.block = e.swing.t > p.hero.melee.heavyUp * 0.45 || this.skill < 0.75
      return
    }
    // Ranged heroes shoot; everyone throws when there is something in the bag at mid range.
    if (ranged && d < 11 && sim.time > this.swingAt && this.facing(e.x, e.z, 0.08)) {
      inp.light = true
      inp.charge = 1
      this.swingAt = sim.time + 0.45
      return
    }
    if (p.throwAmmo > 0 && d > 4 && d < 13 && sim.time > this.throwAt && !p.swing && Math.abs(e.y - p.y) < 3) {
      const t = THROWABLES[p.throwKind]
      // Lob: raise the pitch with distance.
      this.wantPitch = Math.atan2(e.y + 1 - (p.y + p.hero.eye), d) + Math.min(0.5, d / (t.speed * 2.2))
      if (Math.abs(this.inp.pitch - this.wantPitch) < 0.12 && this.facing(e.x, e.z, 0.08)) {
        inp.throw = true
        this.throwAt = sim.time + 1.4 + (1 - this.skill)
      }
      return
    }
    if (d < reach + e.hero.halfWidth && Math.abs(e.y - p.y) < 1.6 && this.facing(e.x, e.z, 0.3) && sim.time > this.swingAt && !p.swing) {
      const heavy = p.stamina > 30 && sim.rng.chance(0.3 + (e.blocking ? 0.3 : 0))
      if (heavy) inp.heavy = true
      else inp.light = true
      this.swingAt = sim.time + (heavy ? 0.9 : 0.36) + (1 - this.skill) * 0.2
    }
  }

  private maybeUlt() {
    const sim = this.sim
    const p = this.p
    if (p.ult < 1 || sim.phase !== 'play' || p.ultKind) return
    const kind = p.hero.ult
    const enemies = sim.players.filter((o) => o.alive && o !== p && (o.team !== p.team || (sim.mode === 'robots' && o.robot)))
    const sy = Math.sin(this.inp.yaw)
    const cy = Math.cos(this.inp.yaw)
    const ahead = (o: Player, range: number, cone: number) => {
      const dx = o.x - p.x
      const dz = o.z - p.z
      const d = Math.hypot(dx, dz)
      return d < range && (dx * sy + dz * cy) / (d || 1) > cone && Math.abs(o.y - p.y) < 2.5
    }
    let go = false
    if (kind === 'cookies') go = enemies.filter((o) => Math.hypot(o.x - p.x, o.z - p.z) < 4).length >= (sim.mode === 'robots' ? 2 : 1) && sim.rng.chance(0.3)
    else if (kind === 'blower') go = enemies.some((o) => ahead(o, 6, 0.7))
    else if (kind === 'rccar') go = enemies.some((o) => ahead(o, 10, 0.8)) || (this.task.kind === 'raid' && ahead(this.task.target as unknown as Player, 8, 0.85) && sim.rng.chance(0.2))
    else if (kind === 'towtruck') {
      const house = sim.houses[1 - p.team]
      go = sim.mode === 'destruction' && Math.hypot(house.ox - p.x, house.oz - p.z) < 16 && Math.hypot(house.ox - p.x, house.oz - p.z) > 6 && this.facing(house.ox, house.oz, 0.3) && sim.valuablesLeft(1 - p.team) > 2
      if (!go) go = enemies.some((o) => ahead(o, 8, 0.85)) && sim.rng.chance(0.2)
    } else if (kind === 'mower') go = enemies.some((o) => ahead(o, 8, 0.8)) || (this.task.kind === 'raid' && sim.rng.chance(0.03) && sim.houseAt(p.x, p.z) === 1 - p.team)
    else if (kind === 'zoomies') go = enemies.some((o) => ahead(o, 9, 0.85))
    if (go) this.inp.ult = true
  }
}

/** Garden robots: walk at the nearest valuable in the defended house and smash; bite whoever gets close. */
export class RobotBrain {
  private sim: Sim
  private p: Player
  private inp: Input
  private path: NavPoint[] | null = null
  private replanAt = 0
  private target: Piece | null = null
  private swingAt = 0
  private stuckAt = 0
  private lastPos = { x: 0, z: 0 }
  private wantYaw = 0
  private navVersion = -1

  constructor(sim: Sim, p: Player, wave: number) {
    this.sim = sim
    this.p = p
    this.inp = emptyInput()
    p.input = this.inp
    void wave
  }

  think(dt: number) {
    const sim = this.sim
    const p = this.p
    const inp = this.inp
    inp.light = inp.heavy = inp.jump = false
    inp.mx = inp.mz = 0
    if (!p.alive) return
    if (sim.phase !== 'play') return
    inp.yaw = turnTo(inp.yaw, this.wantYaw, 6 * dt)
    // Defender nearby: bite.
    let victim: Player | null = null
    for (const o of sim.players) if (o.alive && !o.robot && Math.hypot(o.x - p.x, o.z - p.z) < 2.6 && Math.abs(o.y - p.y) < 1.5) victim = o
    if (victim) {
      this.wantYaw = Math.atan2(victim.x - p.x, victim.z - p.z)
      inp.pitch = 0
      inp.mz = Math.hypot(victim.x - p.x, victim.z - p.z) > 1.3 ? 1 : 0
      if (sim.time > this.swingAt) {
        inp.light = true
        this.swingAt = sim.time + 0.95
      }
      return
    }
    if (!this.target || !this.target.alive) {
      const vs = sim.houses[0].valuables.filter((v) => v.alive)
      let best: Piece | null = null
      let bd = 1e9
      for (const v of vs) {
        const d = Math.hypot(v.x - p.x, v.z - p.z) + ((v.id * 7 + p.id * 13) % 5)
        if (d < bd) {
          bd = d
          best = v
        }
      }
      this.target = best
      this.path = null
      if (!best) return
    }
    const t = this.target!
    const d = Math.hypot(t.x - p.x, t.z - p.z)
    if (d < 1.9 + Math.max(t.w, t.d) / 2 && Math.abs(t.y - p.y) < 1.5) {
      this.wantYaw = Math.atan2(t.x - p.x, t.z - p.z)
      inp.pitch = Math.atan2(t.y + t.h / 2 - (p.y + p.hero.eye), d)
      if (sim.time > this.swingAt && Math.abs(angleDiff(inp.yaw, this.wantYaw)) < 0.3) {
        inp.light = true
        this.swingAt = sim.time + 0.8
      }
      return
    }
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z)
    if (moved > 0.4) {
      this.lastPos = { x: p.x, z: p.z }
      this.stuckAt = sim.time
    }
    const stuck = sim.time - this.stuckAt > 2.5
    if (!this.path || sim.time > this.replanAt || stuck || this.navVersion !== sim.nav.version) {
      this.path = sim.nav.find(p.x, p.y, p.z, t.x, t.y, t.z)
      this.replanAt = sim.time + 3
      this.navVersion = sim.nav.version
      if (stuck) {
        this.stuckAt = sim.time
        inp.jump = true
      }
      if (!this.path) {
        // Smash straight toward it.
        this.wantYaw = Math.atan2(t.x - p.x, t.z - p.z)
        inp.mz = 1
        const r = sim.raycast(p.x, p.y + 0.8, p.z, Math.sin(inp.yaw), 0, Math.cos(inp.yaw), 2, (q) => q.alive && q.solid && q.breakable)
        if (r && sim.time > this.swingAt) {
          inp.light = true
          this.swingAt = sim.time + 0.8
        }
        return
      }
    }
    while (this.path.length > 1) {
      const wp = this.path[0]
      if (Math.hypot(wp.x - p.x, wp.z - p.z) < 0.7 && Math.abs(wp.y - p.y) < 1.4) this.path.shift()
      else break
    }
    const wp = this.path[0]
    if (wp.breakPiece?.alive) {
      const q = wp.breakPiece
      if (Math.hypot(q.x - p.x, q.z - p.z) < 2.2) {
        this.wantYaw = Math.atan2(q.x - p.x, q.z - p.z)
        inp.pitch = 0
        inp.mz = 0.2
        if (sim.time > this.swingAt && Math.abs(angleDiff(inp.yaw, this.wantYaw)) < 0.3) {
          inp.light = true
          this.swingAt = sim.time + 0.8
        }
        return
      }
    }
    this.wantYaw = Math.atan2(wp.x - p.x, wp.z - p.z)
    inp.pitch = 0
    inp.mz = 1
    if (wp.y > p.y + 0.5) inp.jump = p.onGround
  }
}

function angleDiff(a: number, b: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function turnTo(cur: number, want: number, max: number) {
  const d = angleDiff(cur, want)
  if (Math.abs(d) <= max) return want
  return cur + Math.sign(d) * max
}

export { boxOf, TRAPS }
