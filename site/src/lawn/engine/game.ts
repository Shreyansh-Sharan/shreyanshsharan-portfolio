// The match runner: wires input, the simulation (or the host's snapshots online), the view, sound and the HUD.
// Fixed 60 Hz simulation, rendering every frame; online clients interpolate 100 ms behind the host.
import type { LawnAssets } from './assets'
import { LawnAudio } from './audio'
import { TRAPS, THROWABLES, type ThrowKind, type TrapKind } from './gear'
import { HEROES, HERO_IDS, type HeroId } from './heroes'
import type { LayoutId } from './houses'
import { LawnInput, type InputFrame } from './input'
import { MAPS, type MapId, type TimeOfDay } from './maps'
import { moodFor } from '../view/moods'
import { IN, INPUT_HZ, MAX_PEOPLE, SNAP_HZ, isLawnMsg, type LawnMsg, type LobbyPlayer, type Look, type MatchSettings, type NetSession, type PeerResult } from './net'
import type { Piece } from './pieces'
import { applyMatch, perksUnlocked, throwFor, trapsFor, colourHex, type HouseTheme, type Profile, type Reward } from './progress'
import type { Quality } from './quality'
import { Rng } from './rng'
import { MODE_INFO, PF, Sim, emptyInput, type Input, type ModeId, type RosterEntry, type SimEvent, type Snap } from './sim'
import { LawnView } from '../view/view'
import type { ActorMeta } from '../view/actors'

export interface ResultRow {
  id: number
  name: string
  hero: HeroId
  team: number
  kills: number
  deaths: number
  breaks: number
  score: number
  damage: number
  human: boolean
  me: boolean
}

export interface Results {
  winner: number
  win: boolean
  rows: ResultRow[]
  reward: Reward | null
  mode: ModeId
  score: [number, number]
  waves: number
}

export interface TeamMate {
  id: number
  name: string
  hero: HeroId
  hp: number
  maxHp: number
  alive: boolean
  me: boolean
}

export interface Hud {
  phase: 'lobby' | 'prep' | 'play' | 'over'
  time: number
  left: number
  mode: ModeId
  map: MapId
  tod: TimeOfDay
  score: [number, number]
  valuables: [number, number]
  myTeam: number
  me: { id: number; hero: HeroId; hp: number; maxHp: number; stamina: number; ult: number; alive: boolean; respawnIn: number; kills: number; deaths: number; breaks: number; ultName: string; throwKind: ThrowKind; throwAmmo: number; traps: TrapKind[]; trapAmmo: number[]; slot: number; ladders: number; tool: string | null; blind: boolean; wet: boolean; carrying: boolean; charge: number }
  team: TeamMate[]
  feed: { key: number; text: string; at: number; team: number }[]
  hint: string
  touch: boolean
  pad: boolean
  locked: boolean
  wave: number
  waveLeft: number
  chaos: string
  results: Results | null
  role: 'solo' | 'host' | 'client'
  code?: string
  players: LobbyPlayer[]
  settings: MatchSettings
  flash: number
  prepLeft: number
}

export interface GameOptions {
  assets: LawnAssets
  profile: Profile
  quality: Quality
  net?: NetSession
  snap?: boolean
  autopilot?: boolean
  lineup?: HeroId[]
  seed?: number
  time?: TimeOfDay
}

const BOT_NAMES = ['Marnie', 'Doug', 'Priya', 'Carl', 'Bex', 'Olu', 'Tamsin', 'Gus', 'Ines', 'Rory', 'Yuki', 'Hal', 'Nadia', 'Pete', 'Zara', 'Mo']

export class Game {
  readonly view: LawnView
  readonly input: LawnInput
  readonly audio = new LawnAudio()
  sim: Sim | null = null
  /** Client-side mirror of the pieces (never stepped). */
  private mirror: Sim | null = null
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
  private meta = new Map<number, ActorMeta>()
  private feed: Hud['feed'] = []
  private feedSeq = 0
  private hudAt = 0
  private hud: Hud
  private results: Results | null = null
  private settings: MatchSettings = { mode: 'destruction', map: 'culdesac', time: 'day' }
  private players: LobbyPlayer[] = []
  private peerIds = new Map<string, number>()
  private looks = new Map<string, Look>()
  private look_ = { yaw: 0, pitch: 0 }
  private lastInput: Input = emptyInput()
  private snapTimer = 0
  private inputTimer = 0
  private snaps: { s: Snap; e: SimEvent[]; at: number }[] = []
  private pendingEvents: SimEvent[] = []
  private ultReadyShown = false
  private unsub: (() => void)[] = []
  private seedForView = 1
  private lastSnap: Snap | null = null
  private frames = 0
  private knownPieces = new Set<number>()
  private charge = 0
  private trapped = 0
  private layouts: [LayoutId, LayoutId] = ['classic', 'classic']
  private themes: [HouseTheme, HouseTheme] = ['lemon', 'mint']
  private wavesSurvived = 0

  constructor(container: HTMLElement, opts: GameOptions) {
    this.opts = opts
    this.profile = opts.profile
    this.role = opts.net ? opts.net.role : 'solo'
    this.view = new LawnView(container, opts.assets, opts.quality, { preserve: !!opts.snap, fov: opts.profile.settings.fov })
    this.view.shakeOn = opts.profile.settings.shake
    this.input = new LawnInput(container)
    this.input.sensitivity = 0.0022 * opts.profile.settings.sensitivity
    this.input.invertY = opts.profile.settings.invertY
    this.input.onGesture = () => this.audio.start()
    this.audio.setMusic(opts.profile.settings.music)
    const hero = opts.profile.hero
    this.hud = {
      phase: 'lobby',
      time: 0,
      left: 0,
      mode: 'destruction',
      map: 'culdesac',
      tod: 'day',
      score: [0, 0],
      valuables: [8, 8],
      myTeam: 0,
      me: { id: 0, hero, hp: 0, maxHp: 1, stamina: 100, ult: 0, alive: true, respawnIn: 0, kills: 0, deaths: 0, breaks: 0, ultName: HEROES[hero].ultName, throwKind: throwFor(opts.profile, hero), throwAmmo: 0, traps: trapsFor(opts.profile, hero), trapAmmo: [0, 0, 0], slot: 0, ladders: 1, tool: null, blind: false, wet: false, carrying: false, charge: 0 },
      team: [],
      feed: [],
      hint: '',
      touch: false,
      pad: false,
      locked: false,
      wave: 0,
      waveLeft: 0,
      chaos: '',
      results: null,
      role: this.role,
      code: opts.net?.link.code,
      players: [],
      settings: this.settings,
      flash: 0,
      prepLeft: 0,
    }
    if (opts.net) this.attachNet(opts.net)
    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => this.view.resize()

  /* ---------- Lobby & setup ---------- */

  get look(): Look {
    const p = this.profile
    return { name: p.name, hero: p.hero, colour: colourHex(p, p.hero), perks: perksUnlocked(p, p.hero), throwKind: throwFor(p, p.hero), traps: trapsFor(p, p.hero), layout: p.house.layout, theme: p.house.theme }
  }

  setProfile(p: Profile) {
    this.profile = p
    this.view.shakeOn = p.settings.shake
    this.view.setFov(p.settings.fov)
    this.audio.setMusic(p.settings.music)
    this.input.sensitivity = 0.0022 * p.settings.sensitivity
    this.input.invertY = p.settings.invertY
    if (this.role === 'client') this.send({ t: 'lw-look', look: this.look })
    if (this.role === 'host') {
      const me = this.players.find((x) => x.peer === 'host')
      if (me) {
        me.name = p.name
        me.hero = p.hero
        me.colour = this.look.colour
        this.broadcastLobby()
      }
    }
  }

  setSettings(s: Partial<MatchSettings>) {
    this.settings = { ...this.settings, ...s }
    this.hud.settings = this.settings
    if (this.role === 'host') this.broadcastLobby()
    this.emitHud()
  }

  private entry(look: Look, team: number, peer: string): RosterEntry {
    return { name: look.name, hero: look.hero, team, human: true, peer, perks: look.perks, colour: look.colour, throwKind: look.throwKind, traps: look.traps }
  }

  /** Solo: me plus bots. */
  startSolo(mode: ModeId, map: MapId, time: TimeOfDay = 'day') {
    this.settings = { mode, map, time }
    const seed = this.opts.seed ?? (Date.now() ^ (Math.random() * 1e9)) >>> 0
    const look = this.look
    const roster: RosterEntry[] = []
    const rng = new Rng(seed)
    const names = [...BOT_NAMES].sort(() => rng.next() - 0.5)
    roster.push(this.entry(look, 0, 'host'))
    const n = mode === 'robots' ? 3 : 7
    const pool = HERO_IDS.filter((h) => h !== look.hero)
    for (let i = 0; i < n; i++) {
      const team = mode === 'robots' ? 0 : i < 3 ? 0 : 1
      const hero = this.opts.lineup?.[i] ?? (i < 3 ? pool[(i + rng.int(pool.length)) % pool.length] : HERO_IDS[(i + rng.int(HERO_IDS.length)) % HERO_IDS.length])
      roster.push({ name: names[i], hero, team, human: false, perks: rng.int(3) })
    }
    const layouts: [LayoutId, LayoutId] = [look.layout, (['classic', 'bunker', 'spread', 'garage'] as LayoutId[])[rng.int(4)]]
    const mine = themeFor(map, look.theme as HouseTheme)
    const themes: [HouseTheme, HouseTheme] = [mine, MAPS[map].theme.day.houseThemes[1] === mine ? (MAPS[map].theme.day.houseThemes[0] as HouseTheme) : (MAPS[map].theme.day.houseThemes[1] as HouseTheme)]
    this.beginMatch(this.settings, seed, roster, layouts, themes)
  }

  /** Online host: everyone in the lobby plus bots to fill the households. */
  startOnline() {
    if (this.role !== 'host') return
    const { mode } = this.settings
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0
    const rng = new Rng(seed)
    const names = [...BOT_NAMES].sort(() => rng.next() - 0.5)
    const roster: RosterEntry[] = []
    const humans = this.players
    const per = mode === 'robots' ? 4 : 4
    const teamCount = [0, 0]
    for (const p of humans) {
      const team = mode === 'robots' ? 0 : teamCount[0] <= teamCount[1] ? 0 : 1
      if (teamCount[team] >= per) continue
      teamCount[team]++
      roster.push(this.entry(this.lookFor(p.peer), team, p.peer))
    }
    let n = 0
    for (let team = 0; team < (mode === 'robots' ? 1 : 2); team++)
      while (teamCount[team] < per) {
        roster.push({ name: names[n++ % names.length], hero: HERO_IDS[rng.int(HERO_IDS.length)], team, human: false, perks: rng.int(3) })
        teamCount[team]++
      }
    const hostLook = this.look
    const other = humans.map((p) => this.lookFor(p.peer)).find((l) => l !== hostLook && roster.some((r) => r.team === 1 && r.name === l.name))
    const layouts: [LayoutId, LayoutId] = [hostLook.layout, other?.layout ?? (['classic', 'bunker', 'spread', 'garage'] as LayoutId[])[rng.int(4)]]
    const themes: [HouseTheme, HouseTheme] = [themeFor(this.settings.map, hostLook.theme as HouseTheme), themeFor(this.settings.map, (other?.theme as HouseTheme) ?? (MAPS[this.settings.map].theme.day.houseThemes[1] as HouseTheme))]
    this.send({ t: 'lw-start', setup: { settings: this.settings, seed, roster, layouts, themes } })
    this.beginMatch(this.settings, seed, roster, layouts, themes)
  }

  private lookFor(peer: string): Look {
    return peer === 'host' ? this.look : (this.looks.get(peer) ?? { name: 'PLAYER', hero: 'dad', colour: HEROES.dad.colors[0], perks: 0, throwKind: 'golfball', traps: ['sprinkler', 'marbles', 'rake'], layout: 'classic', theme: 'mint' })
  }

  private beginMatch(settings: MatchSettings, seed: number, roster: RosterEntry[], layouts: [LayoutId, LayoutId], themes: [HouseTheme, HouseTheme]) {
    this.settings = settings
    this.results = null
    this.feed = []
    this.snaps = []
    this.pendingEvents = []
    this.ultReadyShown = false
    this.knownPieces.clear()
    this.trapped = 0
    this.wavesSurvived = 0
    this.layouts = layouts
    this.themes = themes
    const myPeer = this.role === 'client' ? this.opts.net!.link.selfId : 'host'
    const sim = new Sim({ map: settings.map, mode: settings.mode, seed, roster, time: settings.time, layouts, themes, difficulty: 0.62 + Math.min(0.3, this.profile.wins * 0.015) })
    this.meta.clear()
    this.peerIds.clear()
    for (const f of sim.players) {
      this.meta.set(f.id, { name: f.name, hero: f.hero.id, team: f.team, colour: f.colour, human: f.human, robot: f.robot })
      if (f.peer) this.peerIds.set(f.peer, f.id)
    }
    const me = sim.players.find((f) => f.peer === myPeer)
    this.meId = me?.id ?? 0
    this.myTeam = me?.team ?? 0
    if (this.role !== 'client') {
      this.sim = sim
      this.mirror = null
      if (me && this.opts.autopilot) sim.setHuman(me.id, false, 'host', me.name)
    } else {
      this.sim = null
      this.mirror = sim
    }
    this.look_ = { yaw: me?.yaw ?? 0, pitch: 0 }
    this.view.look = this.look_
    // The lighting mood: sunny or golden hour by day (from the seed, so both ends agree), night, or the snow presets;
    // ?mood=<id> overrides it for screenshots.
    const moodParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('mood') : null
    this.view.setWorld(settings.map, settings.time, sim.pieces, themes, (x, z, y) => sim.floorAt(x, z, y, 0.6), moodFor(settings.map, settings.time, seed, moodParam))
    for (const p of sim.pieces) this.knownPieces.add(p.id)
    this.view.setRoster(this.meta, this.meId, this.myTeam)
    this.seedForView = seed
    this.hud.mode = settings.mode
    this.hud.map = settings.map
    this.hud.tod = settings.time
    this.hud.myTeam = this.myTeam
    this.hud.phase = sim.phase === 'prep' ? 'prep' : 'play'
    this.hud.results = null
    const heroId = this.meta.get(this.meId)?.hero ?? this.profile.hero
    this.hud.me = { ...this.hud.me, id: this.meId, hero: heroId, ultName: HEROES[heroId].ultName, kills: 0, deaths: 0, breaks: 0 }
    this.audio.setMood(sim.phase === 'prep' ? 'calm' : 'raid')
    this.emitHud()
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
    // Hidden tabs get no animation frames: a timer keeps the host's simulation (and a client's inputs) going.
    document.addEventListener('visibilitychange', this.onVisibility)
    this.onVisibility()
  }

  private hiddenTimer = 0
  private onVisibility = () => {
    if (document.hidden && this.running && !this.hiddenTimer) {
      this.hiddenTimer = window.setInterval(() => {
        const now = performance.now()
        const dt = Math.min(0.1, (now - this.last) / 1000)
        this.last = now
        if (dt > 0.004) this.frame(dt)
      }, 33)
    } else if (!document.hidden && this.hiddenTimer) {
      window.clearInterval(this.hiddenTimer)
      this.hiddenTimer = 0
    }
  }

  pause(p: boolean) {
    this.paused = p
    this.input.enabled = !p
  }

  private frame(dt: number) {
    this.frames++
    if (this.paused) return
    const frameIn = this.input.poll()
    this.hud.touch = frameIn.touch
    this.hud.pad = frameIn.pad
    this.hud.locked = frameIn.locked
    this.applyLook(frameIn)
    if (this.sim) {
      this.acc += dt
      let steps = 0
      const events: SimEvent[] = []
      const inp = this.humanInput(frameIn)
      while (this.acc >= 1 / 60 && steps < 5) {
        this.acc -= 1 / 60
        steps++
        this.stepHost(1 / 60, inp)
        events.push(...this.sim.events)
        // Edge-triggered actions only fire on the first sub-step.
        inp.jump = inp.light = inp.heavy = inp.throw = inp.use = inp.ladder = inp.ult = false
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
          this.send({ t: 'lw-snap', s: snap, e: this.pendingEvents })
          this.pendingEvents = []
        }
      }
    } else if (this.role === 'client') {
      const inp = this.humanInput(frameIn)
      this.inputTimer -= dt
      // Edge actions are sent on the next tick even between ticks.
      const edge = (inp.jump ? IN.jump : 0) | (inp.light ? IN.light : 0) | (inp.heavy ? IN.heavy : 0) | (inp.throw ? IN.throw : 0) | (inp.use ? IN.use : 0) | (inp.ladder ? IN.ladder : 0) | (inp.ult ? IN.ult : 0)
      this.pendingEdge |= edge
      if ((this.inputTimer <= 0 || this.pendingEdge) && this.lastSnap) {
        this.inputTimer = 1 / INPUT_HZ
        const flags = this.pendingEdge | (inp.sprint ? IN.sprint : 0) | (inp.crouch ? IN.crouch : 0) | (inp.block ? IN.block : 0)
        this.send({ t: 'lw-in', i: [r2(inp.mx), r2(inp.mz), r2(inp.yaw), r2(inp.pitch), flags, inp.slot, r2(inp.charge)] })
        this.pendingEdge = 0
      }
      const snap = this.interpolate()
      if (snap) {
        const events = this.pendingEvents
        this.pendingEvents = []
        this.lastSnap = snap
        for (const e of events) this.mirrorEvent(e)
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
  private pendingEdge = 0

  private applyLook(f: InputFrame) {
    this.look_.yaw += f.dyaw
    this.look_.pitch = Math.max(-1.45, Math.min(1.45, this.look_.pitch + f.dpitch))
    this.hud.me.charge = this.charge
  }

  private stepHost(dt: number, inp: Input) {
    const sim = this.sim!
    const me = sim.player(this.meId)
    if (me && me.human) sim.setInput(me.id, { ...inp })
    sim.step(dt)
    // New ladders become pieces in the view.
    for (const l of sim.ladders)
      if (!this.knownPieces.has(l.id)) {
        this.knownPieces.add(l.id)
        this.view.world?.addPiece(l)
      }
    if (sim.phase === 'over' && !this.results) this.finish(sim.winner)
  }

  /** Apply piece events to the client's mirror so its view matches the host. */
  private mirrorEvent(e: SimEvent) {
    const m = this.mirror
    if (!m) return
    if (e.t === 'break') {
      const p = m.byId.get(e.id)
      if (p) {
        p.alive = false
        p.solid = false
      }
    } else if (e.t === 'barricade') {
      const p = m.byId.get(e.id)
      if (p) {
        p.level = e.level
        p.solid = true
      }
    } else if (e.t === 'ladder') {
      if (!this.knownPieces.has(e.id)) {
        const l = m.makeLadder(e.x, e.z, e.yaw, e.top, e.team)
        l.id = e.id
        m.byId.set(e.id, l)
        this.knownPieces.add(e.id)
        this.view.world?.addPiece(l)
      }
    } else if (e.t === 'drop') {
      const p = m.byId.get(e.piece)
      if (p) {
        p.x = e.x
        p.y = e.y
        p.z = e.z
      }
    }
  }

  /** Turn the device input into a sim input. */
  private humanInput(f: InputFrame): Input {
    // Slingshot draw: hold the button to charge.
    if (f.attackHeld) this.charge = Math.min(1, this.charge + 0.03)
    const light = f.light
    const charge = light ? Math.max(0.3, this.charge) : this.charge
    if (light || f.heavy) this.charge = 0
    this.lastInput = {
      mx: f.mx,
      mz: f.mz,
      yaw: this.look_.yaw,
      pitch: this.look_.pitch,
      jump: f.jump,
      sprint: f.sprint,
      crouch: f.crouch,
      light,
      heavy: f.heavy,
      throw: f.throw,
      use: f.use,
      ladder: f.ladder,
      ult: f.ult,
      block: f.block,
      charge,
      slot: f.slot,
    }
    return this.lastInput
  }

  private renderFrame(snap: Snap, events: SimEvent[], dt: number) {
    const row = snap.p.find((r) => r[0] === this.meId)
    const me = this.sim?.player(this.meId)
    if (row) {
      this.audio.lx = row[1]
      this.audio.lz = row[3]
      if (row[10] >= 1 && !this.ultReadyShown) {
        this.ultReadyShown = true
        this.audio.ultReady()
      }
      if (row[10] < 1) this.ultReadyShown = false
    }
    for (const e of events) this.sound(e)
    const f = row ? row[8] : 0
    const hero = HEROES[this.hud.me.hero]
    this.view.render(snap, events, dt, {
      alive: !!(f & PF.alive),
      onGround: !!(f & PF.ground),
      sprinting: !!(f & PF.sprint),
      moving: !!(f & PF.moving),
      blocking: !!(f & PF.block),
      crouch: !!(f & PF.crouch),
      drawing: this.charge,
      eye: hero.eye,
      riding: !!(f & PF.riding),
      ladder: !!(f & PF.ladder),
      glide: !!(f & PF.glide),
      me: row ? { x: row[1], y: row[2], z: row[3] } : null,
    })
    void me
  }

  private sound(e: SimEvent) {
    const a = this.audio
    switch (e.t) {
      case 'swing':
        a.swing(e.heavy)
        break
      case 'hit':
        if (e.blocked) a.block(false)
        else a.thwack(e.heavy, e.x, e.z)
        break
      case 'parry':
        a.block(true)
        break
      case 'chip':
        a.chip(this.view.world?.views.get(e.id)?.piece.model ?? 'wall', e.x, e.z)
        break
      case 'break': {
        a.crash(e.model, e.x, e.z)
        const by = this.meta.get(e.by)
        if (e.value > 0) {
          const name = e.model.slice(9)
          this.pushFeed(`${by?.name ?? 'Someone'} smashed the ${name}${e.value ? ` (+${e.value})` : ''}`, e.team)
          if (e.team === this.myTeam) a.score()
        }
        break
      }
      case 'throw':
        a.throw_()
        break
      case 'splash':
        a.splash(e.kind, e.x, e.z)
        break
      case 'trap':
        if (e.team === this.myTeam) a.place()
        break
      case 'trip': {
        a.trap(e.kind, e.x, e.z)
        const v = this.meta.get(e.victim)
        const own = this.sim?.traps.find((t) => t.id === e.id)
        if (own && own.owner === this.meId) this.trapped++
        if (v) this.pushFeed(`${v.name} ${e.kind === 'beartrap' ? 'stepped in a bear trap' : e.kind === 'rake' ? 'took a rake to the face' : e.kind === 'marbles' ? 'slipped on marbles' : e.kind === 'pit' ? 'fell through the doormat' : e.kind === 'alarm' ? 'rattled the alarm cans' : 'got soaked'}`, v.team)
        break
      }
      case 'ladder':
        a.ladder(e.x, e.z)
        break
      case 'barricade':
        a.barricade(e.x, e.z)
        break
      case 'ko': {
        a.ko(e.id === this.meId, e.x, e.z)
        const v = this.meta.get(e.id)
        const k = this.meta.get(e.by)
        this.pushFeed(k && k !== v ? `${k.name} knocked out ${v?.name ?? '?'}` : `${v?.name ?? '?'} was knocked out`, k?.team ?? -1)
        if (e.id === this.meId) this.hud.me.deaths++
        if (e.by === this.meId && e.id !== this.meId) this.hud.me.kills++
        break
      }
      case 'respawn':
        if (e.id === this.meId) a.respawn()
        break
      case 'ult': {
        a.ult(e.kind, e.x, e.z)
        const m = this.meta.get(e.id)
        if (m) this.pushFeed(`${m.name}: ${HEROES[m.hero].ultName}`, m.team)
        break
      }
      case 'explode':
        a.explode(e.x, e.z)
        break
      case 'start':
        a.whistle(true)
        a.setMood('raid')
        this.hud.phase = 'play'
        this.pushFeed('RAID! Go wreck their house.', -1)
        break
      case 'prep':
        a.setMood('calm')
        break
      case 'wave':
        a.alarm()
        this.pushFeed(`Wave ${e.n}: ${e.count} garden robots`, -1)
        if (e.n > 1) this.wavesSurvived = e.n - 1
        break
      case 'chaos':
        if (e.kind === 'icecream') a.icecream(e.on)
        if (e.kind === 'seagulls' && e.on) a.seagull()
        if (e.on) this.pushFeed(e.kind === 'seagulls' ? 'Seagulls! Watch your snacks.' : e.kind === 'icecream' ? 'Ice-cream truck on the street!' : 'Rainstorm: everything outside is slippery.', -1)
        this.hud.chaos = e.on ? e.kind : ''
        break
      case 'seagull':
        a.seagull()
        if (e.victim === this.meId) this.pushFeed(e.stole ? 'A seagull stole your throwable!' : 'A seagull got you. Gross.', -1)
        break
      case 'alarm':
        if (e.team === this.myTeam) a.alarm()
        break
      case 'tool': {
        const m = this.meta.get(e.id)
        if (e.id === this.meId) this.pushFeed(`Picked up the ${e.tool}`, this.myTeam)
        void m
        break
      }
      default:
        break
    }
  }

  private pushFeed(text: string, team: number) {
    this.feed.unshift({ key: ++this.feedSeq, text, at: performance.now(), team })
    this.feed = this.feed.slice(0, 6)
  }

  /* ---------- Results ---------- */

  private finish(winner: number) {
    const rows: ResultRow[] = []
    const sim = this.sim
    if (sim) {
      for (const f of sim.players) if (!f.robot) rows.push({ id: f.id, name: f.name, hero: f.hero.id, team: f.team, kills: f.kills, deaths: f.deaths, breaks: f.breaks, score: f.score, damage: Math.round(f.damage), human: f.human, me: f.id === this.meId })
      if (this.role === 'host' && this.opts.net) {
        const results: PeerResult[] = []
        for (const f of sim.players) if (f.peer && f.peer !== 'host') results.push({ peer: f.peer, win: winner === f.team, kills: f.kills, deaths: f.deaths, damage: Math.round(f.damage), score: f.score, breaks: f.breaks, ults: f.ultsUsed })
        this.send({ t: 'lw-end', winner, results })
      }
    }
    const me = sim?.player(this.meId)
    const win = winner === this.myTeam
    const waves = sim?.mode === 'robots' ? (win ? sim.waves : Math.max(0, sim.wave - 1)) : 0
    const { profile, reward } = applyMatch(this.profile, { mode: this.settings.mode, hero: this.hud.me.hero, win, kills: me?.kills ?? 0, deaths: me?.deaths ?? 0, damage: Math.round(me?.damage ?? 0), breaks: me?.breaks ?? 0, trapped: this.trapped, ults: me?.ultsUsed ?? 0, score: me?.score ?? 0, waves })
    this.profile = profile
    this.results = { winner, win, rows: sortRows(rows), reward, mode: this.settings.mode, score: [sim?.score[0] ?? 0, sim?.score[1] ?? 0], waves }
    this.hud.results = this.results
    this.hud.phase = 'over'
    this.audio.stinger(win)
    this.input.unlock()
    this.emitHud()
    this.onResult?.(this.results, profile)
  }

  private finishClient(winner: number, results: PeerResult[]) {
    const myPeer = this.opts.net!.link.selfId
    const mine = results.find((r) => r.peer === myPeer)
    const rows: ResultRow[] = []
    for (const [id, m] of this.meta) if (!m.robot) rows.push({ id, name: m.name, hero: m.hero, team: m.team, kills: 0, deaths: 0, breaks: 0, score: 0, damage: 0, human: m.human, me: id === this.meId })
    const win = winner === this.myTeam
    const { profile, reward } = applyMatch(this.profile, { mode: this.settings.mode, hero: this.hud.me.hero, win, kills: mine?.kills ?? 0, deaths: mine?.deaths ?? 0, damage: mine?.damage ?? 0, breaks: mine?.breaks ?? 0, trapped: this.trapped, ults: mine?.ults ?? 0, score: mine?.score ?? 0, waves: this.wavesSurvived })
    this.profile = profile
    const meRow = rows.find((r) => r.me)
    if (meRow && mine) {
      meRow.kills = mine.kills
      meRow.deaths = mine.deaths
      meRow.damage = mine.damage
      meRow.breaks = mine.breaks
      meRow.score = mine.score
    }
    this.results = { winner, win, rows: sortRows(rows), reward, mode: this.settings.mode, score: this.lastSnap?.s ?? [0, 0], waves: this.wavesSurvived }
    this.hud.results = this.results
    this.hud.phase = 'over'
    this.audio.stinger(win)
    this.input.unlock()
    this.emitHud()
    this.onResult?.(this.results, profile)
  }

  backToLobby() {
    this.sim = null
    this.mirror = null
    this.results = null
    this.hud.phase = 'lobby'
    this.hud.results = null
    if (this.role === 'host') this.send({ t: 'lw-back' })
    this.emitHud()
  }

  /* ---------- HUD ---------- */

  private emitHud() {
    const h = this.hud
    const snap = this.lastSnap
    const sim = this.sim ?? this.mirror
    if (snap) {
      h.time = snap.t
      h.score = snap.s
      h.left = snap.left
      h.valuables = snap.v
      h.wave = snap.wave
      h.waveLeft = snap.waveLeft
      if (snap.ph === 1 && h.phase === 'prep') h.phase = 'play'
      if (snap.ph === 0) h.phase = 'prep'
      h.prepLeft = snap.ph === 0 ? snap.left : 0
      const row = snap.p.find((r) => r[0] === this.meId)
      if (row) {
        const me = this.sim?.player(this.meId)
        const f = row[8]
        h.me.hp = row[6]
        h.me.maxHp = row[7]
        h.me.ult = row[10]
        h.me.stamina = row[11]
        h.me.alive = !!(f & PF.alive)
        h.me.respawnIn = row[17]
        h.me.blind = !!(f & PF.blind)
        h.me.wet = !!(f & PF.wet)
        h.me.carrying = !!(f & PF.carry)
        h.me.throwAmmo = row[14]
        h.me.ladders = row[16]
        h.me.slot = this.lastInput.slot
        h.me.tool = row[13] ? ['rake', 'shovel', 'pan', 'hose', 'bat', 'hammer'][row[13] - 1] : null
        if (me) {
          h.me.kills = me.kills
          h.me.deaths = me.deaths
          h.me.breaks = me.breaks
          h.me.trapAmmo = [...me.trapAmmo]
          h.me.traps = me.traps
          h.me.throwKind = me.throwKind
        } else {
          h.me.trapAmmo = [row[15], row[15], row[15]]
        }
      }
      h.team = snap.p
        .filter((r) => this.meta.get(r[0])?.team === this.myTeam && !this.meta.get(r[0])?.robot)
        .map((r) => ({ id: r[0], name: this.meta.get(r[0])!.name, hero: this.meta.get(r[0])!.hero, hp: r[6], maxHp: r[7], alive: !!(r[8] & PF.alive), me: r[0] === this.meId }))
      h.hint = this.hintFor(sim)
    }
    h.flash = this.view.fx.flash
    h.feed = this.feed
    h.players = this.players
    h.settings = this.settings
    h.touch = this.input.isTouchDevice
    this.onHud?.({ ...h, me: { ...h.me }, feed: [...h.feed], players: [...h.players], score: [h.score[0], h.score[1]], team: [...h.team] })
  }

  /** Context hint: what E / F would do right now. */
  private hintFor(sim: Sim | null) {
    const me = sim?.player(this.meId)
    if (!me || !me.alive) return ''
    if (me.carrying) return 'E: put it down here'
    const sy = Math.sin(me.yaw)
    const cy = Math.cos(me.yaw)
    const cp = Math.cos(me.pitch)
    const r = sim!.raycast(me.x, me.y + me.hero.eye, me.z, sy * cp, Math.sin(me.pitch), cy * cp, 3)
    const q = r?.piece
    if (q && q.house === me.team) {
      if ((q.kind === 'door' || q.kind === 'garage') && q.level < 2 && q.alive) return `E: barricade the ${q.kind === 'garage' ? 'garage door' : 'door'} (${q.level}/2)`
      if (q.kind === 'valuable' && sim!.phase === 'prep') return `E: pick up the ${q.name}`
    }
    if (q && q.model === 'furniture:toolrack') return 'E: take a garden tool'
    if (q && q.kind === 'valuable' && q.house !== me.team) return `Smash the ${q.name} (+${q.value})`
    if (q && q.kind === 'wall' && q.breakable && me.ladders > 0 && !q.inside) return 'F: lean a ladder here'
    if (sim!.phase === 'prep') return `E: place ${TRAPS[me.traps[Math.min(me.traps.length - 1, me.input.slot)]]?.name ?? 'trap'} · ${THROWABLES[me.throwKind].name} ready`
    return ''
  }

  /* ---------- Networking ---------- */

  private send(m: LawnMsg, to?: string) {
    this.opts.net?.link.send(m, to)
  }

  private attachNet(net: NetSession) {
    const link = net.link
    if (net.role === 'host') {
      this.players = [{ peer: 'host', name: this.profile.name, hero: this.profile.hero, colour: this.look.colour, team: 0 }]
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
          if (!isLawnMsg(m)) return
          this.hostMsg(m, from)
        }),
      )
    } else {
      this.unsub.push(
        link.onPeer((ev) => {
          if (ev === 'leave') this.onDisconnect?.('The host left the room.')
        }),
        link.onMessage((m) => {
          if (!isLawnMsg(m)) return
          this.clientMsg(m)
        }),
      )
    }
    this.emitHud()
  }

  hello() {
    this.send({ t: 'lw-hello', look: this.look })
  }

  private broadcastLobby() {
    this.hud.players = this.players
    this.send({ t: 'lw-lobby', players: this.players, settings: this.settings })
    this.emitHud()
  }

  private hostMsg(m: LawnMsg, from: string) {
    if (m.t === 'lw-hello' || m.t === 'lw-look') {
      if (m.t === 'lw-hello' && !this.players.some((p) => p.peer === from)) {
        if (this.players.length >= MAX_PEOPLE) {
          this.send({ t: 'lw-full' }, from)
          return
        }
        this.players.push({ peer: from, name: m.look.name, hero: m.look.hero, colour: m.look.colour, team: this.players.length % 2 })
      }
      const p = this.players.find((x) => x.peer === from)
      if (p) {
        p.name = m.look.name
        p.hero = m.look.hero
        p.colour = m.look.colour
      }
      this.looks.set(from, m.look)
      this.broadcastLobby()
      if (this.sim && m.t === 'lw-hello') this.send({ t: 'lw-start', setup: { settings: this.settings, seed: this.seedForView, roster: this.sim.players.filter((f) => !f.robot).map((f) => ({ name: f.name, hero: f.hero.id, team: f.team, human: f.human, peer: f.peer, perks: f.perks, colour: f.colour, throwKind: f.throwKind, traps: f.traps })), layouts: this.layouts, themes: this.themes } }, from)
    } else if (m.t === 'lw-in' && this.sim) {
      const id = this.peerIds.get(from)
      if (!id) return
      const [mx, mz, yaw, pitch, flags, slot, charge] = m.i
      this.sim.setInput(id, { mx, mz, yaw, pitch, jump: !!(flags & IN.jump), sprint: !!(flags & IN.sprint), crouch: !!(flags & IN.crouch), light: !!(flags & IN.light), heavy: !!(flags & IN.heavy), throw: !!(flags & IN.throw), use: !!(flags & IN.use), ladder: !!(flags & IN.ladder), ult: !!(flags & IN.ult), block: !!(flags & IN.block), charge, slot })
      // Edge actions must only fire once: clear them after one step.
      const p = this.sim.player(id)
      if (p) window.setTimeout(() => {
        if (p.input.jump || p.input.light || p.input.heavy || p.input.throw || p.input.use || p.input.ladder || p.input.ult) p.input = { ...p.input, jump: false, light: false, heavy: false, throw: false, use: false, ladder: false, ult: false }
      }, 25)
    }
  }

  private clientMsg(m: LawnMsg) {
    if (m.t === 'lw-lobby') {
      this.players = m.players
      this.settings = m.settings
      this.hud.settings = m.settings
      this.hud.players = m.players
      this.emitHud()
    } else if (m.t === 'lw-start') {
      this.beginMatch(m.setup.settings, m.setup.seed, m.setup.roster, m.setup.layouts, m.setup.themes as [HouseTheme, HouseTheme])
    } else if (m.t === 'lw-snap') {
      this.snaps.push({ s: m.s, e: m.e, at: performance.now() })
      if (this.snaps.length > 12) this.snaps.shift()
      this.pendingEvents.push(...m.e)
    } else if (m.t === 'lw-end') {
      this.finishClient(m.winner, m.results)
    } else if (m.t === 'lw-back') {
      this.backToLobby()
    } else if (m.t === 'lw-full') {
      this.onDisconnect?.('That room is full.')
    }
  }

  private interpolate(): Snap | null {
    const n = this.snaps.length
    if (!n) return null
    if (n === 1) return this.snaps[0].s
    const target = performance.now() - (1000 / SNAP_HZ) * 2
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
    for (const r of a.s.p) byId.set(r[0], r)
    const p = b.s.p.map((r) => {
      const q = byId.get(r[0])
      if (!q) return r
      const out = [...r]
      out[1] = lerp(q[1], r[1])
      out[2] = lerp(q[2], r[2])
      out[3] = lerp(q[3], r[3])
      out[4] = lerpAngle(q[4], r[4], k)
      out[5] = lerp(q[5], r[5])
      return out
    })
    const pById = new Map<number, number[]>()
    for (const r of a.s.pr) pById.set(r[0], r)
    const pr = b.s.pr.map((r) => {
      const q = pById.get(r[0])
      if (!q) return r
      const out = [...r]
      out[2] = lerp(q[2], r[2])
      out[3] = lerp(q[3], r[3])
      out[4] = lerp(q[4], r[4])
      return out
    })
    return { ...b.s, p, pr }
  }

  /* ---------- Test hooks (?snap) ---------- */

  /** Advance the match without the live loop, then render once. */
  simulate(seconds: number) {
    if (!this.sim) return
    const steps = Math.max(1, Math.round(seconds * 60))
    const events: SimEvent[] = []
    for (let i = 0; i < steps; i++) {
      const frameIn = this.input.poll()
      this.applyLook(frameIn)
      const inp = this.humanInput(frameIn)
      this.stepHost(1 / 60, inp)
      if (i >= steps - 6) events.push(...this.sim.events)
      else for (const e of this.sim.events) this.sound(e)
    }
    const snap = this.sim.buildSnap()
    this.lastSnap = snap
    this.renderFrame(snap, events, 1 / 60)
    this.emitHud()
  }

  renderOnce() {
    const snap = this.lastSnap ?? this.sim?.buildSnap()
    if (snap) this.renderFrame(snap, [], 1 / 60)
  }

  /** Point the local look (tests and the key art). */
  setLook(yaw: number, pitch: number) {
    this.look_.yaw = yaw
    this.look_.pitch = pitch
  }

  state() {
    const sim = this.sim
    const me = sim?.player(this.meId)
    return {
      role: this.role,
      phase: this.hud.phase,
      simPhase: sim?.phase,
      time: sim?.time ?? this.lastSnap?.t ?? 0,
      score: sim?.score ?? this.lastSnap?.s,
      winner: sim?.winner ?? this.lastSnap?.w,
      valuables: this.hud.valuables,
      me: me ? { id: me.id, x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, hp: me.hp, alive: me.alive, kills: me.kills, ult: me.ult, stamina: me.stamina, onGround: me.onGround, onLadder: !!me.onLadder, ladders: me.ladders, throwAmmo: me.throwAmmo, trapAmmo: me.trapAmmo, score: me.score, breaks: me.breaks, swing: me.swing, blocking: me.blocking, carrying: me.carrying?.id ?? 0, tool: me.tool, ultKind: me.ultKind, placedTraps: me.placedTraps } : null,
      meId: this.meId,
      players: sim?.players.map((f) => ({ id: f.id, name: f.name, hero: f.hero.id, team: f.team, x: f.x, y: f.y, z: f.z, hp: f.hp, alive: f.alive, kills: f.kills, human: f.human, robot: f.robot })),
      projectiles: sim?.projectiles.length ?? this.lastSnap?.pr.length,
      traps: sim?.traps.length ?? this.lastSnap?.tr.length,
      ladders: sim?.ladders.length,
      pieces: sim ? sim.pieces.filter((p) => p.alive).length : undefined,
      brokenValuables: sim ? sim.houses.map((h) => h.valuables.filter((v) => !v.alive).length) : undefined,
      frames: this.frames,
      snaps: this.snaps.length,
      players_: this.players,
      results: this.results,
      modes: Object.keys(MODE_INFO),
      wave: sim?.wave,
      houses: sim?.houses.map((h) => ({ ox: h.ox, oz: h.oz, dir: h.dir, doors: h.doors.map((d) => ({ id: d.id, x: d.x, z: d.z, level: d.level, alive: d.alive })), valuables: h.valuables.map((v) => ({ id: v.id, x: v.x, y: v.y, z: v.z, alive: v.alive, name: v.name })), ladderSpot: h.ladderSpot, balcony: h.balcony })),
    }
  }

  /** Expose pieces for tests. */
  pieces(): Piece[] {
    return (this.sim ?? this.mirror)?.pieces ?? []
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this.raf)
    if (this.hiddenTimer) window.clearInterval(this.hiddenTimer)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('resize', this.onResize)
    for (const u of this.unsub) u()
    this.input.dispose()
    this.audio.dispose()
    this.view.dispose()
  }
}

/** Lodge themes on the snowy street, suburban paint on the cul-de-sac. */
function themeFor(map: MapId, theme: HouseTheme): HouseTheme {
  const snowy = MAPS[map].theme.day.snow
  const lodge = theme === 'timber' || theme === 'slate'
  if (snowy && !lodge) return theme === 'mint' || theme === 'sky' ? 'slate' : 'timber'
  if (!snowy && lodge) return theme === 'slate' ? 'sky' : 'lemon'
  return theme
}

function r2(v: number) {
  return Math.round(v * 100) / 100
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

function sortRows(rows: ResultRow[]) {
  return [...rows].sort((a, b) => a.team - b.team || b.score - a.score || b.kills - a.kills)
}
