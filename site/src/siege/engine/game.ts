// The match runner: wires input, the simulation (or the host's snapshots online), the view, sound and the HUD.
// Fixed 60 Hz simulation, rendering every frame; online clients interpolate 100 ms behind the host.
import type { SiegeAssets } from './assets'
import { SiegeAudio } from './audio'
import { HEROES, HERO_IDS, type HeroId } from './heroes'
import { SiegeInput } from './input'
import { ARENA_MAPS, MAPS, type MapId } from './maps'
import { INPUT_HZ, MAX_PEOPLE, SNAP_HZ, isSiegeMsg, type LobbyPlayer, type Look, type MatchSettings, type NetSession, type PeerResult, type SiegeMsg } from './net'
import { applyMatch, gearMods, type Profile, type Reward } from './progress'
import type { Quality } from './quality'
import { Rng } from './rng'
import { COUNTER_RULES, STATUS_KINDS, type StatusKind } from './powers'
import { DEPLOY_KINDS, MODE_INFO, NO_INPUT, SNAP_F, SNAP_FLAGS, Sim, type Input, type ModeId, type RosterEntry, type SimEvent, type Snap } from './sim'
import { SiegeView, type FighterMeta } from '../view/view'

export interface ResultRow {
  id: number
  name: string
  hero: HeroId
  team: number
  kills: number
  deaths: number
  damage: number
  human: boolean
  me: boolean
  placement: number
}

export interface Results {
  winner: number
  win: boolean
  placement: number
  rows: ResultRow[]
  reward: Reward | null
  mode: ModeId
}

export interface Hud {
  phase: 'lobby' | 'countdown' | 'play' | 'over'
  countdown: number
  time: number
  timeLeft: number
  mode: ModeId
  map: MapId
  target: number
  score: [number, number]
  myTeam: number
  me: {
    id: number
    hero: HeroId
    hp: number
    maxHp: number
    super: number
    dashCd: number
    alive: boolean
    respawnIn: number
    kills: number
    deaths: number
    cloak: boolean
    superName: string
    powerCd: number
    shield: number
    coins: number
    /** Active effects with seconds left (buffs and debuffs). */
    statuses: { kind: StatusKind; left: number }[]
  }
  feed: { key: number; text: string; at: number }[]
  /** Counter popups that involve you (yours landing, or landing on you). */
  counters: { key: number; word: string; label: string; color: string; mine: boolean; at: number }[]
  br: { alive: number; stage: number; shrinkIn: number; outside: boolean } | null
  touch: boolean
  pad: boolean
  autoFire: boolean
  results: Results | null
  role: 'solo' | 'host' | 'client'
  code?: string
  players: LobbyPlayer[]
  settings: MatchSettings
}

export interface GameOptions {
  assets: SiegeAssets
  profile: Profile
  quality: Quality
  net?: NetSession
  snap?: boolean
  autopilot?: boolean
  /** Fixed hero lineup for the bots (key art and tests). */
  lineup?: HeroId[]
}

const BOT_NAMES = ['Vex', 'Mira', 'Tolo', 'Kade', 'Juno', 'Rhys', 'Oona', 'Bask', 'Lio', 'Ceres', 'Dax', 'Wyn', 'Pria', 'Hale', 'Nox', 'Suki', 'Brom', 'Ilsa', 'Ryo', 'Tamsin']

export class Game {
  readonly view: SiegeView
  readonly input: SiegeInput
  readonly audio = new SiegeAudio()
  sim: Sim | null = null
  onHud: ((h: Hud) => void) | null = null
  onResult: ((r: Results, profile: Profile) => void) | null = null
  onDisconnect: ((why: string) => void) | null = null
  profile: Profile
  readonly role: 'solo' | 'host' | 'client'
  private opts: GameOptions
  private raf = 0
  private last = 0
  private acc = 0
  private running = false
  private paused = false
  private meId = 0
  private myTeam = 0
  private meta = new Map<number, FighterMeta>()
  private feed: Hud['feed'] = []
  private feedSeq = 0
  private hudAt = 0
  private hud: Hud
  private results: Results | null = null
  private settings: MatchSettings = { mode: 'tdm', map: 'kessho' }
  private players: LobbyPlayer[] = []
  private peerIds = new Map<string, number>()
  private lastInput: Input = { ...NO_INPUT }
  /** Button presses between two client input messages (so a tap between sends is not lost). */
  private latch = { dash: false, super: false, power: false }
  private counterPops: Hud['counters'] = []
  private aim = { x: 1, z: 0 }
  private snapTimer = 0
  private inputTimer = 0
  private snaps: { s: Snap; e: SimEvent[]; at: number }[] = []
  private pendingEvents: SimEvent[] = []
  private superReadyShown = false
  private unsub: (() => void)[] = []
  private seedForView = 1
  private lastSnap: Snap | null = null
  private frames = 0

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts
    this.profile = opts.profile
    this.role = opts.net ? opts.net.role : 'solo'
    this.view = new SiegeView(container, opts.assets, opts.quality, { preserve: !!opts.snap })
    this.view.shakeOn = opts.profile.settings.shake
    this.input = new SiegeInput(container)
    this.input.onGesture = () => this.audio.start()
    this.audio.setMusic(opts.profile.settings.music)
    this.hud = {
      phase: 'lobby',
      countdown: 0,
      time: 0,
      timeLeft: 0,
      mode: 'tdm',
      map: 'kessho',
      target: 20,
      score: [0, 0],
      myTeam: 0,
      me: { id: 0, hero: opts.profile.hero, hp: 0, maxHp: 1, super: 0, dashCd: 0, alive: true, respawnIn: 0, kills: 0, deaths: 0, cloak: false, superName: HEROES[opts.profile.hero].superName, powerCd: 0, shield: 0, coins: 0, statuses: [] },
      feed: [],
      counters: [],
      br: null,
      touch: false,
      pad: false,
      autoFire: opts.profile.settings.autoFire,
      results: null,
      role: this.role,
      code: opts.net?.link.code,
      players: [],
      settings: this.settings,
    }
    if (opts.net) this.attachNet(opts.net)
    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => this.view.resize()

  /* ---------- Lobby & setup ---------- */

  get look(): Look {
    return { name: this.profile.name, hero: this.profile.hero, skin: this.profile.skins[this.profile.hero] ?? 'default', gear: gearMods(this.profile) }
  }

  setProfile(p: Profile) {
    this.profile = p
    this.view.shakeOn = p.settings.shake
    this.audio.setMusic(p.settings.music)
    this.hud.autoFire = p.settings.autoFire
    if (this.role === 'client') this.send({ t: 'sg-look', look: this.look })
    if (this.role === 'host') {
      const me = this.players.find((x) => x.peer === 'host')
      if (me) {
        me.name = p.name
        me.hero = p.hero
        me.skin = this.look.skin
        this.broadcastLobby()
      }
    }
  }

  setSettings(s: Partial<MatchSettings>) {
    this.settings = { ...this.settings, ...s }
    this.hud.settings = this.settings
    if (this.role === 'host') this.broadcastLobby()
    this.emitHud(true)
  }

  /** Solo: me plus bots. */
  startSolo(mode: ModeId, map: MapId) {
    this.settings = { mode, map }
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0
    const look = this.look
    const roster: RosterEntry[] = []
    const rng = new Rng(seed)
    const names = [...BOT_NAMES].sort(() => rng.next() - 0.5)
    if (mode === 'br') {
      roster.push({ name: look.name, hero: look.hero, team: 0, human: true, peer: 'host', gear: look.gear, skin: look.skin })
      for (let i = 0; i < 16; i++) roster.push({ name: names[i], hero: HERO_IDS[rng.int(HERO_IDS.length)], team: i + 1, human: false })
    } else {
      roster.push({ name: look.name, hero: look.hero, team: 0, human: true, peer: 'host', gear: look.gear, skin: look.skin })
      const pool = HERO_IDS.filter((h) => h !== look.hero)
      for (let i = 0; i < 5; i++) {
        const hero = this.opts.lineup?.[i] ?? (i < 2 ? pool[(i * 2 + rng.int(pool.length)) % pool.length] : HERO_IDS[rng.int(HERO_IDS.length)])
        roster.push({ name: names[i], hero, team: i < 2 ? 0 : 1, human: false })
      }
    }
    this.beginMatch({ mode, map }, seed, roster)
  }

  /** Online host: everyone in the lobby plus bots to fill the squads. */
  startOnline() {
    if (this.role !== 'host') return
    const { mode } = this.settings
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0
    const rng = new Rng(seed)
    const names = [...BOT_NAMES].sort(() => rng.next() - 0.5)
    const roster: RosterEntry[] = []
    const humans = this.players
    if (mode === 'br') {
      humans.forEach((p, i) => roster.push({ name: p.name, hero: p.hero, team: i, human: true, peer: p.peer, skin: p.skin, gear: this.gearFor(p.peer) }))
      for (let i = humans.length; i < 17; i++) roster.push({ name: names[i % names.length], hero: HERO_IDS[rng.int(HERO_IDS.length)], team: i, human: false })
    } else {
      const teamCount = [0, 0]
      for (const p of humans) {
        const team = teamCount[0] <= teamCount[1] ? 0 : 1
        if (teamCount[team] >= 3) continue
        teamCount[team]++
        roster.push({ name: p.name, hero: p.hero, team, human: true, peer: p.peer, skin: p.skin, gear: this.gearFor(p.peer) })
      }
      let n = 0
      for (let team = 0; team < 2; team++)
        while (teamCount[team] < 3) {
          roster.push({ name: names[n++], hero: HERO_IDS[rng.int(HERO_IDS.length)], team, human: false })
          teamCount[team]++
        }
    }
    this.send({ t: 'sg-start', setup: { settings: this.settings, seed, roster } })
    this.beginMatch(this.settings, seed, roster)
  }

  private looks = new Map<string, Look>()
  private gearFor(peer: string) {
    return peer === 'host' ? this.look.gear : (this.looks.get(peer)?.gear ?? { hp: 1, speed: 1, dmg: 1, charge: 1 })
  }

  private beginMatch(settings: MatchSettings, seed: number, roster: RosterEntry[]) {
    this.settings = settings
    this.results = null
    this.feed = []
    this.counterPops = []
    this.snaps = []
    this.pendingEvents = []
    this.superReadyShown = false
    const myPeer = this.role === 'client' ? this.opts.net!.link.selfId : 'host'
    if (this.role !== 'client') {
      this.sim = new Sim({ map: settings.map, mode: settings.mode, seed, roster, difficulty: 0.62 + Math.min(0.3, this.profile.wins * 0.01) })
      this.meta.clear()
      this.peerIds.clear()
      for (const f of this.sim.fighters) {
        this.meta.set(f.id, { name: f.name, hero: f.hero.id, skin: f.skin, team: f.team, human: f.human })
        if (f.peer) this.peerIds.set(f.peer, f.id)
      }
      const me = this.sim.fighters.find((f) => f.peer === myPeer)
      this.meId = me?.id ?? 0
      this.myTeam = me?.team ?? 0
      if (me && this.opts.autopilot) this.sim.setHuman(me.id, false, 'host', me.name)
      this.view.setMap(this.sim.map, this.sim.chars, seed)
      this.view.setRoster(this.meta, this.meId, this.myTeam)
      this.hud.target = this.sim.target
    } else {
      // Clients mirror the host's roster: ids are assigned in roster order after the map's crates.
      const sim = new Sim({ map: settings.map, mode: settings.mode, seed, roster })
      this.meta.clear()
      this.peerIds.clear()
      for (const f of sim.fighters) {
        this.meta.set(f.id, { name: f.name, hero: f.hero.id, skin: f.skin, team: f.team, human: f.human })
        if (f.peer) this.peerIds.set(f.peer, f.id)
      }
      const me = sim.fighters.find((f) => f.peer === myPeer)
      this.meId = me?.id ?? 0
      this.myTeam = me?.team ?? 0
      this.view.setMap(sim.map, sim.chars, seed)
      this.view.setRoster(this.meta, this.meId, this.myTeam)
      this.hud.target = sim.target
      this.sim = null
    }
    this.seedForView = seed
    this.hud.mode = settings.mode
    this.hud.map = settings.map
    this.hud.myTeam = this.myTeam
    this.hud.phase = 'countdown'
    this.hud.results = null
    const heroId = this.meta.get(this.meId)?.hero ?? this.profile.hero
    this.hud.me = { ...this.hud.me, id: this.meId, hero: heroId, superName: HEROES[heroId].superName, kills: 0, deaths: 0 }
    this.emitHud(true)
    this.audio.start()
  }

  /* ---------- Loop ---------- */

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const tick = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - this.last) / 1000)
      this.last = now
      this.frame(dt)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause(p: boolean) {
    this.paused = p
  }

  private frame(dt: number) {
    this.frames++
    if (this.paused) return
    const frameIn = this.input.poll()
    this.hud.touch = frameIn.touch
    this.hud.pad = frameIn.pad
    if (this.sim) {
      this.acc += dt
      let steps = 0
      const events: SimEvent[] = []
      while (this.acc >= 1 / 60 && steps < 5) {
        this.acc -= 1 / 60
        steps++
        this.stepHost(1 / 60, frameIn)
        events.push(...this.sim.events)
      }
      if (steps === 5) this.acc = 0
      const snap = this.sim.buildSnap()
      this.lastSnap = snap
      this.renderFrame(snap, events, dt)
      if (this.role === 'host' && this.opts.net) {
        this.pendingEvents.push(...events)
        this.snapTimer -= dt
        if (this.snapTimer <= 0) {
          this.snapTimer = 1 / SNAP_HZ
          this.send({ t: 'sg-snap', s: snap, e: this.pendingEvents })
          this.pendingEvents = []
        }
      }
    } else if (this.role === 'client') {
      this.inputTimer -= dt
      this.latch.dash ||= frameIn.dash
      this.latch.super ||= frameIn.super
      this.latch.power ||= frameIn.power
      if (this.inputTimer <= 0 && this.lastSnap) {
        this.inputTimer = 1 / INPUT_HZ
        const inp = this.humanInput({ ...frameIn, ...this.latch }, this.lastSnap)
        this.latch = { dash: false, super: false, power: false }
        this.send({ t: 'sg-in', i: [inp.mx, inp.mz, inp.ax, inp.az, inp.aimDist, (inp.fire ? 1 : 0) | (inp.dash ? 2 : 0) | (inp.super ? 4 : 0) | (inp.power ? 8 : 0)] })
      }
      const snap = this.interpolate()
      if (snap) {
        const events = this.pendingEvents
        this.pendingEvents = []
        this.lastSnap = snap
        this.renderFrame(snap, events, dt)
      }
    }
    this.audio.update(dt)
    this.hudAt -= dt
    if (this.hudAt <= 0) {
      this.hudAt = 0.1
      this.emitHud()
    }
  }

  private stepHost(dt: number, frameIn: ReturnType<SiegeInput['poll']>) {
    const sim = this.sim!
    const me = sim.fighter(this.meId)
    if (me && me.human) {
      const inp = this.humanInput(frameIn, null)
      sim.setInput(me.id, inp)
    }
    sim.step(dt)
    if (sim.phase === 'over' && !this.results) this.finish(sim.winner)
  }

  /** Turn the device input into a sim input: mouse aim on the floor, stick aim, auto-fire. */
  private humanInput(f: ReturnType<SiegeInput['poll']>, snap: Snap | null): Input {
    const sim = this.sim
    let mx = 0
    let mz = 0
    let aimDist = 6
    let hp = 0
    let alive = true
    if (sim) {
      const me = sim.fighter(this.meId)
      if (me) {
        mx = me.x
        mz = me.z
        hp = me.hp
        alive = me.alive
      }
    } else if (snap) {
      const row = snap.f.find((r) => r[0] === this.meId)
      if (row) {
        mx = row[1]
        mz = row[2]
        hp = row[4]
        alive = !!(row[6] & SNAP_FLAGS.alive)
      }
    }
    void hp
    if (f.aimDir) {
      const l = Math.hypot(f.aimDir.x, f.aimDir.z) || 1
      this.aim = { x: f.aimDir.x / l, z: f.aimDir.z / l }
      aimDist = 4 + Math.min(1, l) * 8
    } else if (f.pointer && !f.touch) {
      const p = this.view.pickGround(f.pointer.x, f.pointer.y)
      if (p) {
        const dx = p.x - mx
        const dz = p.z - mz
        const l = Math.hypot(dx, dz)
        if (l > 0.3) this.aim = { x: dx / l, z: dz / l }
        aimDist = l
      }
    }
    let fire = f.fire
    let ax = this.aim.x
    let az = this.aim.z
    // Auto-fire: sticks and touch snap to the nearest enemy when the aim stick is idle; the mouse only fires
    // when an enemy sits inside a cone in front of the cursor.
    if (this.profile.settings.autoFire && alive && !f.aiming) {
      const hero = HEROES[this.meta.get(this.meId)?.hero ?? 'rook']
      const range = hero.weapon.range * 1.05
      let best: { x: number; z: number; d: number } | null = null
      const consider = (x: number, z: number, cloaked: boolean) => {
        const d = Math.hypot(x - mx, z - mz)
        if (d > range || (cloaked && d > 2.5)) return
        if (sim && !sim.lineClear(mx, mz, x, z, hero.weapon.kind === 'launcher')) return
        if (!best || d < best.d) best = { x, z, d }
      }
      if (sim) for (const o of sim.fighters) if (o.alive && o.id !== this.meId && (sim.mode === 'br' || o.team !== this.myTeam)) consider(o.x, o.z, o.cloakUntil > 0)
      if (!sim && snap) for (const r of snap.f) if (r[0] !== this.meId && r[6] & SNAP_FLAGS.alive && (this.settings.mode === 'br' || this.meta.get(r[0])?.team !== this.myTeam)) consider(r[1], r[2], !!(r[6] & SNAP_FLAGS.cloak))
      // Decoys look like the real thing, so auto-aim falls for them too.
      if (sim) for (const d of sim.deployables) if (d.kind === 'decoy' && d.hp > 0 && d.owner !== this.meId && (sim.mode === 'br' || d.team !== this.myTeam)) consider(d.x, d.z, false)
      if (!sim && snap) for (const r of snap.d) if (DEPLOY_KINDS[r[1]] === 'decoy' && r[8] !== this.meId && (this.settings.mode === 'br' || this.meta.get(r[8])?.team !== this.myTeam)) consider(r[2], r[3], false)
      const b = best as { x: number; z: number; d: number } | null
      if (b) {
        const tx = (b.x - mx) / (b.d || 1)
        const tz = (b.z - mz) / (b.d || 1)
        const usingMouse = !f.touch && !f.pad
        const cos = tx * ax + tz * az
        if (!usingMouse || cos > 0.5) {
          if (!usingMouse || !f.fire) {
            ax = tx
            az = tz
            aimDist = b.d
          }
          fire = true
        }
      }
    }
    const l = Math.hypot(ax, az) || 1
    this.view.aimDx = (ax / l) * 2.5
    this.view.aimDz = (az / l) * 2.5
    this.lastInput = { mx: f.mx, mz: f.mz, ax: ax / l, az: az / l, aimDist, fire, dash: f.dash, super: f.super, power: f.power }
    return this.lastInput
  }

  private renderFrame(snap: Snap, events: SimEvent[], dt: number) {
    const me = snap.f.find((r) => r[0] === this.meId)
    if (me) {
      this.audio.lx = me[1]
      this.audio.lz = me[2]
      if (me[7] >= 1 && !this.superReadyShown) {
        this.superReadyShown = true
        this.audio.superReady()
      }
      if (me[7] < 1) this.superReadyShown = false
    }
    for (const e of events) this.sound(e)
    this.view.render(snap, events, dt)
    // Countdown beeps.
    if (snap.ph === 0) {
      const c = Math.ceil(snap.cd)
      if (c !== this.hud.countdown) {
        this.hud.countdown = c
        this.audio.countdown(false)
      }
    }
  }

  private sound(e: SimEvent) {
    switch (e.t) {
      case 'shot':
        this.audio.shot(e.kind, e.x, e.z)
        break
      case 'hit':
        if (e.target === this.meId) this.audio.hit(true)
        else if (this.sim ? this.sim.fighter(e.target)?.lastHitBy === this.meId : true) this.audio.hit(false, e.x, e.z)
        break
      case 'explode':
        if (e.kind === 'reveal') this.audio.scan(e.x, e.z)
        else if (e.kind !== 'purge') this.audio.explosion(e.kind !== 'crate' && e.kind !== 'toxin', e.x, e.z)
        break
      case 'death': {
        this.audio.death(e.x, e.z)
        const v = this.meta.get(e.id)
        const k = this.meta.get(e.killer)
        const text = k ? `${k.name} took down ${v?.name ?? '?'}` : `${v?.name ?? '?'} was eliminated`
        this.feed.unshift({ key: ++this.feedSeq, text, at: performance.now() })
        this.feed = this.feed.slice(0, 5)
        if (e.id === this.meId) this.hud.me.deaths++
        if (e.killer === this.meId) this.hud.me.kills++
        break
      }
      case 'super': {
        const m = this.meta.get(e.id)
        this.audio.superUse(m?.hero ?? 'rook', e.x, e.z)
        break
      }
      case 'power':
        this.audio.power(e.kind, e.x, e.z)
        break
      case 'counter': {
        const rule = COUNTER_RULES[e.rule]
        this.audio.counter(rule.word === 'BROKEN!', e.x, e.z)
        const mine = e.by === this.meId
        if (mine || e.target === this.meId) {
          const other = this.meta.get(mine ? e.target : e.by)?.name
          const label = mine ? (other && e.target !== this.meId ? `${rule.label} · ${other}` : rule.label) : other ? `${other} · ${rule.label}` : rule.label
          this.counterPops.unshift({ key: ++this.feedSeq, word: rule.word, label, color: rule.color, mine, at: performance.now() })
          this.counterPops = this.counterPops.slice(0, 2)
        }
        break
      }
      case 'powerup':
        if (e.id === this.meId) this.audio.powerup()
        break
      case 'revive':
        if (e.id === this.meId) this.audio.powerup()
        break
      case 'dash':
        if (e.id === this.meId) this.audio.dash()
        break
      case 'pickup':
        if (e.id === this.meId) this.audio.pickup()
        break
      case 'grid':
        this.audio.grid()
        break
      case 'start':
        this.audio.countdown(true)
        this.hud.phase = 'play'
        break
      case 'end':
        break
      case 'score':
      case 'respawn':
        break
    }
  }

  /* ---------- Results ---------- */

  private finish(winner: number) {
    const rows: ResultRow[] = []
    const sim = this.sim
    if (sim) {
      for (const f of sim.fighters) rows.push({ id: f.id, name: f.name, hero: f.hero.id, team: f.team, kills: f.kills, deaths: f.deaths, damage: Math.round(f.damage), human: f.human || f.id === this.meId, me: f.id === this.meId, placement: f.placement })
      if (this.role === 'host' && this.opts.net) {
        const results: PeerResult[] = []
        for (const f of sim.fighters)
          if (f.peer && f.peer !== 'host') results.push({ peer: f.peer, win: sim.mode === 'br' ? winner === f.id : winner === f.team, kills: f.kills, deaths: f.deaths, damage: Math.round(f.damage), supers: f.supersUsed, placement: f.placement, coins: f.coins })
        this.send({ t: 'sg-end', winner, results })
      }
    }
    const me = sim?.fighter(this.meId)
    const win = sim ? (sim.mode === 'br' ? winner === this.meId : winner === this.myTeam) : false
    const placement = me?.placement ?? 0
    const { profile, reward } = applyMatch(this.profile, { mode: this.settings.mode, hero: this.hud.me.hero, win, kills: me?.kills ?? 0, deaths: me?.deaths ?? 0, damage: Math.round(me?.damage ?? 0), supers: me?.supersUsed ?? 0, placement, coins: me?.coins ?? 0 })
    this.profile = profile
    this.results = { winner, win, placement, rows: sortRows(rows, this.settings.mode), reward, mode: this.settings.mode }
    this.hud.results = this.results
    this.hud.phase = 'over'
    this.audio.stinger(win)
    this.emitHud(true)
    this.onResult?.(this.results, profile)
  }

  private finishClient(winner: number, results: PeerResult[]) {
    const myPeer = this.opts.net!.link.selfId
    const mine = results.find((r) => r.peer === myPeer)
    const rows: ResultRow[] = []
    for (const [id, m] of this.meta) {
      const r = this.lastSnap?.f.find((x) => x[0] === id)
      rows.push({ id, name: m.name, hero: m.hero, team: m.team, kills: 0, deaths: 0, damage: 0, human: m.human, me: id === this.meId, placement: 0 })
      void r
    }
    const win = mine?.win ?? false
    const { profile, reward } = applyMatch(this.profile, { mode: this.settings.mode, hero: this.hud.me.hero, win, kills: mine?.kills ?? 0, deaths: mine?.deaths ?? 0, damage: mine?.damage ?? 0, supers: mine?.supers ?? 0, placement: mine?.placement ?? 0, coins: mine?.coins ?? 0 })
    this.profile = profile
    const meRow = rows.find((r) => r.me)
    if (meRow && mine) {
      meRow.kills = mine.kills
      meRow.deaths = mine.deaths
      meRow.damage = mine.damage
      meRow.placement = mine.placement
    }
    this.results = { winner, win, placement: mine?.placement ?? 0, rows: sortRows(rows, this.settings.mode), reward, mode: this.settings.mode }
    this.hud.results = this.results
    this.hud.phase = 'over'
    this.audio.stinger(win)
    this.emitHud(true)
    this.onResult?.(this.results, profile)
  }

  /** Back to the lobby (online) or menu (solo). */
  backToLobby() {
    this.sim = null
    this.results = null
    this.hud.phase = 'lobby'
    this.hud.results = null
    if (this.role === 'host') this.send({ t: 'sg-back' })
    this.emitHud(true)
  }

  /* ---------- HUD ---------- */

  private emitHud(force = false) {
    const h = this.hud
    const snap = this.lastSnap
    if (snap) {
      h.time = snap.t
      h.score = snap.s
      h.countdown = Math.ceil(snap.cd)
      if (snap.ph === 1 && h.phase === 'countdown') h.phase = 'play'
      const limit = this.sim?.timeLimit ?? (this.settings.mode === 'br' ? 320 : 180)
      h.timeLeft = Math.max(0, limit - snap.t)
      const row = snap.f.find((r) => r[0] === this.meId)
      if (row) {
        const me = this.sim?.fighter(this.meId)
        h.me.hp = row[4]
        h.me.maxHp = row[5]
        h.me.super = row[7]
        h.me.alive = !!(row[6] & SNAP_FLAGS.alive)
        h.me.cloak = !!(row[6] & SNAP_FLAGS.cloak)
        h.me.dashCd = row[SNAP_F.dashCd] ?? (me ? me.dashCd : 0)
        h.me.powerCd = row[SNAP_F.powerCd] ?? 0
        h.me.shield = row[10] ?? 0
        h.me.coins = row[SNAP_F.coins] ?? 0
        const st: Hud['me']['statuses'] = []
        const bt = snap.bt ?? []
        for (let i = 0; i + 2 < bt.length; i += 3) if (bt[i] === this.meId) st.push({ kind: STATUS_KINDS[bt[i + 1]], left: bt[i + 2] })
        h.me.statuses = st
        h.me.respawnIn = me && !me.alive && !me.out ? Math.max(0, me.respawnAt - snap.t) : h.me.alive ? 0 : 3
        if (me) {
          h.me.kills = me.kills
          h.me.deaths = me.deaths
        }
      }
      if (snap.br) {
        const [cx, cz, half, , , , shrinkAt, stage, alive] = snap.br
        const outside = row ? Math.abs(row[1] - cx) > half || Math.abs(row[2] - cz) > half : false
        h.br = { alive, stage, shrinkIn: Math.max(0, shrinkAt - snap.t), outside }
      } else h.br = null
    }
    h.feed = this.feed
    const nowMs = performance.now()
    this.counterPops = this.counterPops.filter((c) => nowMs - c.at < 1600)
    h.counters = this.counterPops
    h.players = this.players
    h.settings = this.settings
    h.touch = this.input.isTouchDevice
    void force
    this.onHud?.({ ...h, me: { ...h.me, statuses: [...h.me.statuses] }, feed: [...h.feed], counters: [...h.counters], players: [...h.players], score: [h.score[0], h.score[1]] })
  }

  /* ---------- Networking ---------- */

  private send(m: SiegeMsg, to?: string) {
    this.opts.net?.link.send(m, to)
  }

  private attachNet(net: NetSession) {
    const link = net.link
    if (net.role === 'host') {
      this.players = [{ peer: 'host', name: this.profile.name, hero: this.profile.hero, skin: this.look.skin, team: 0 }]
      this.hud.players = this.players
      this.unsub.push(
        link.onPeer((ev, id) => {
          if (ev === 'leave') {
            this.players = this.players.filter((p) => p.peer !== id)
            this.looks.delete(id)
            const fid = this.peerIds.get(id)
            if (fid && this.sim) this.sim.setHuman(fid, false)
            this.broadcastLobby()
          }
        }),
        link.onMessage((m, from) => {
          if (!isSiegeMsg(m)) return
          this.hostMsg(m, from)
        }),
      )
    } else {
      this.unsub.push(
        link.onPeer((ev) => {
          if (ev === 'leave') this.onDisconnect?.('The host left the room.')
        }),
        link.onMessage((m) => {
          if (!isSiegeMsg(m)) return
          this.clientMsg(m)
        }),
      )
    }
    this.emitHud(true)
  }

  /** Client: introduce ourselves. */
  hello() {
    this.send({ t: 'sg-hello', look: this.look })
  }

  private broadcastLobby() {
    this.hud.players = this.players
    this.send({ t: 'sg-lobby', players: this.players, settings: this.settings })
    this.emitHud(true)
  }

  private hostMsg(m: SiegeMsg, from: string) {
    if (m.t === 'sg-hello' || m.t === 'sg-look') {
      if (m.t === 'sg-hello' && !this.players.some((p) => p.peer === from)) {
        if (this.players.length >= MAX_PEOPLE) {
          this.send({ t: 'sg-full' }, from)
          return
        }
        this.players.push({ peer: from, name: m.look.name, hero: m.look.hero, skin: m.look.skin, team: this.players.length % 2 })
      }
      const p = this.players.find((x) => x.peer === from)
      if (p) {
        p.name = m.look.name
        p.hero = m.look.hero
        p.skin = m.look.skin
      }
      this.looks.set(from, m.look)
      this.broadcastLobby()
      // Joining mid-match: take over a bot slot (same hero not guaranteed; they spectate until the next match).
      if (this.sim && m.t === 'sg-hello') this.send({ t: 'sg-start', setup: { settings: this.settings, seed: this.seedForView, roster: this.sim.fighters.map((f) => ({ name: f.name, hero: f.hero.id, team: f.team, human: f.human, peer: f.peer, skin: f.skin })) } }, from)
    } else if (m.t === 'sg-in' && this.sim) {
      const id = this.peerIds.get(from)
      if (!id) return
      const [mx, mz, ax, az, aimDist, flags] = m.i
      this.sim.setInput(id, { mx, mz, ax, az, aimDist, fire: !!(flags & 1), dash: !!(flags & 2), super: !!(flags & 4), power: !!(flags & 8) })
    }
  }

  private clientMsg(m: SiegeMsg) {
    if (m.t === 'sg-lobby') {
      this.players = m.players
      this.settings = m.settings
      this.hud.settings = m.settings
      this.hud.players = m.players
      this.emitHud(true)
    } else if (m.t === 'sg-start') {
      this.beginMatch(m.setup.settings, m.setup.seed, m.setup.roster)
    } else if (m.t === 'sg-snap') {
      this.snaps.push({ s: m.s, e: m.e, at: performance.now() })
      if (this.snaps.length > 12) this.snaps.shift()
      this.pendingEvents.push(...m.e)
    } else if (m.t === 'sg-end') {
      this.finishClient(m.winner, m.results)
    } else if (m.t === 'sg-back') {
      this.backToLobby()
    } else if (m.t === 'sg-full') {
      this.onDisconnect?.('That room is full.')
    }
  }

  /** Client: blend the two snapshots around (now - 100 ms). */
  private interpolate(): Snap | null {
    const n = this.snaps.length
    if (!n) return null
    if (n === 1) return this.snaps[0].s
    const target = performance.now() - 1000 / SNAP_HZ * 2
    let a = this.snaps[n - 2]
    let b = this.snaps[n - 1]
    for (let i = 0; i < n - 1; i++)
      if (this.snaps[i].at <= target && this.snaps[i + 1].at >= target) {
        a = this.snaps[i]
        b = this.snaps[i + 1]
        break
      }
    const span = Math.max(1, b.at - a.at)
    const k = Math.min(1, Math.max(0, (target - a.at) / span))
    const lerp = (x: number, y: number) => x + (y - x) * k
    const byId = new Map<number, number[]>()
    for (const r of a.s.f) byId.set(r[0], r)
    const f = b.s.f.map((r) => {
      const p = byId.get(r[0])
      if (!p) return r
      const out = [...r]
      out[1] = lerp(p[1], r[1])
      out[2] = lerp(p[2], r[2])
      out[3] = lerpAngle(p[3], r[3], k)
      return out
    })
    const pById = new Map<number, number[]>()
    for (const r of a.s.p) pById.set(r[0], r)
    const p = b.s.p.map((r) => {
      const q = pById.get(r[0])
      if (!q) return r
      const out = [...r]
      out[2] = lerp(q[2], r[2])
      out[3] = lerp(q[3], r[3])
      out[4] = lerp(q[4], r[4])
      return out
    })
    return { ...b.s, f, p }
  }

  /* ---------- Test hooks (?snap) ---------- */

  /** Advance the match without the live loop, then render once. */
  simulate(seconds: number) {
    if (!this.sim) return
    const steps = Math.max(1, Math.round(seconds * 60))
    const events: SimEvent[] = []
    for (let i = 0; i < steps; i++) {
      const frameIn = this.input.poll()
      this.stepHost(1 / 60, frameIn)
      for (const e of this.sim.events) this.sound(e)
      if (i >= steps - 6) events.push(...this.sim.events)
    }
    const snap = this.sim.buildSnap()
    this.lastSnap = snap
    this.view.render(snap, events, 1 / 60)
    this.emitHud(true)
  }

  /** Render one frame of whatever is current (no simulation). */
  renderOnce() {
    const snap = this.lastSnap ?? this.sim?.buildSnap()
    if (snap) this.view.render(snap, [], 1 / 60)
  }

  state() {
    const sim = this.sim
    const me = sim?.fighter(this.meId)
    return {
      role: this.role,
      phase: this.hud.phase,
      time: sim?.time ?? this.lastSnap?.t ?? 0,
      score: sim?.score ?? this.lastSnap?.s,
      winner: sim?.winner ?? this.lastSnap?.w,
      alive: sim?.aliveCount() ?? this.lastSnap?.f.filter((r) => r[6] & SNAP_FLAGS.alive).length,
      me: me ? { id: me.id, x: me.x, z: me.z, hp: me.hp, alive: me.alive, kills: me.kills, super: me.super, aim: me.aim, dashCd: me.dashCd, supersUsed: me.supersUsed, damage: me.damage, powerCd: me.powerCd, powersUsed: me.powersUsed, counters: me.counters, coins: me.coins, statuses: me.statuses.map((s) => s.kind) } : null,
      meId: this.meId,
      fighters: sim?.fighters.map((f) => ({ id: f.id, name: f.name, hero: f.hero.id, team: f.team, x: f.x, z: f.z, hp: f.hp, alive: f.alive, kills: f.kills, human: f.human, powersUsed: f.powersUsed, counters: f.counters })),
      pads: sim?.pads.map((p) => ({ id: p.id, x: p.x, z: p.z, kind: p.kind, wait: Math.max(0, p.readyAt - sim.time) })) ?? this.lastSnap?.pd.length,
      projectiles: sim?.projectiles.length ?? this.lastSnap?.p.length,
      br: sim?.br ? { ...sim.br } : null,
      frames: this.frames,
      snaps: this.snaps.length,
      players: this.players,
      results: this.results,
      modes: Object.keys(MODE_INFO),
      maps: ARENA_MAPS,
    }
  }

  /** Expose the map name for the HUD. */
  mapName(id: MapId) {
    return MAPS[id].name
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    for (const u of this.unsub) u()
    this.input.dispose()
    this.audio.dispose()
    this.view.dispose()
  }
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

function sortRows(rows: ResultRow[], mode: ModeId) {
  return [...rows].sort((a, b) => (mode === 'br' ? (a.placement || 99) - (b.placement || 99) : a.team - b.team || b.kills - a.kills))
}
