// The island's wild creatures: five species with their own districts, a roaming Alpha per district, the hits
// they take and deal, the Spark Sphere that captures them, and the pals that then follow, fight and carry
// the player. Framework-free shared state like combat.ts: Creatures.tsx draws it, Characters.tsx attacks
// it and gets hurt by it, PlayHud.tsx shows the HP bar, reticle, roster and bestiary.
//
// The simulation runs at a fixed 30 Hz (stepCreatures accumulates frame time) with distance culling, so the
// cost is the same on a 30 fps laptop and a 144 Hz desktop, and `?snap` can step it deterministically.
import * as THREE from 'three'
import { REGIONS, WATER_LEVEL } from './regions'
import { heightAt, mulberry32 } from './terrain'
import { blocked, resolve } from './colliders'
import { MISSIONS } from './missions'
import { confetti, fight, impact, results, type HitShape } from './combat'
import { emit, SHAPE, type Emit } from './particles'
import { dayClock, isNight, stepClock } from './clock'
import { world } from './store'
import { play } from '../lib/sound'

/* ---------- Species ---------- */

export type SpeciesId = 'thornback' | 'grizzlebear' | 'scrapdrone' | 'snapcrab' | 'gargoyle'
export type AttackKind = 'charge' | 'swipe' | 'zap' | 'nip' | 'dive'

export interface Species {
  id: SpeciesId
  name: string
  blurb: string
  /** Where it lives (for the bestiary). */
  habitat: string
  color: string
  hp: number
  /** Ground / flight speed, m/s. */
  speed: number
  damage: number
  /** Notices the player within this many metres; roams this far from its spawn. */
  aggro: number
  territory: number
  attack: AttackKind
  /** Seconds between attacks, and how close it must be to start one. */
  cooldown: number
  reach: number
  /** Footprint radius and body height at scale 1. */
  radius: number
  height: number
  /** Flies (hover height above ground), or only comes out at night. */
  fly?: number
  night?: boolean
  /** Starts buried, popping out when the player is close. */
  ambush?: boolean
  /** Can be ridden once tamed: a fast run, or flight. */
  ride?: 'run' | 'fly'
  /** How many spawn together. */
  pack: number
  coins: number
  /** Seconds before a defeated one returns. */
  respawn: number
}

export const SPECIES: Record<SpeciesId, Species> = {
  thornback: {
    id: 'thornback', name: 'Thornback', blurb: 'A bristly forest boar. Lowers its head and charges; sidestep, then hit it from behind.',
    habitat: 'Campus Grove and the Ridge woods', color: '#8b5a2b', hp: 36, speed: 5.5, damage: 12, aggro: 16, territory: 22,
    attack: 'charge', cooldown: 1.7, reach: 7, radius: 0.55, height: 1.1, pack: 3, coins: 8, respawn: 70,
  },
  grizzlebear: {
    id: 'grizzlebear', name: 'Grizzlebear', blurb: 'A slow highland bear with a heavy swipe. Keep moving and it never lands one.',
    habitat: 'Highland Distillery', color: '#6b4a32', hp: 90, speed: 3.6, damage: 22, aggro: 14, territory: 18,
    attack: 'swipe', cooldown: 2.1, reach: 2.4, radius: 0.8, height: 1.9, ride: 'run', pack: 1, coins: 14, respawn: 90,
  },
  scrapdrone: {
    id: 'scrapdrone', name: 'Scrapdrone', blurb: 'A hovering security drone from the Neon District. Keeps its distance and zaps.',
    habitat: 'Neon District', color: '#8d9bb0', hp: 24, speed: 6.5, damage: 7, aggro: 20, territory: 24,
    attack: 'zap', cooldown: 2.2, reach: 14, radius: 0.5, height: 0.8, fly: 2.8, ride: 'fly', pack: 3, coins: 10, respawn: 60,
  },
  snapcrab: {
    id: 'snapcrab', name: 'Snapcrab', blurb: 'Buried in the sand until you step close, then a quick nip. Watch for the mounds.',
    habitat: 'The beaches', color: '#e2574c', hp: 30, speed: 5, damage: 9, aggro: 4.5, territory: 10,
    attack: 'nip', cooldown: 1.1, reach: 1.5, radius: 0.5, height: 0.6, ambush: true, pack: 2, coins: 9, respawn: 60,
  },
  gargoyle: {
    id: 'gargoyle', name: 'Gargoyle', blurb: 'Stone wings over the Dunes ruins, only after dark. Circles, then dive-bombs.',
    habitat: 'The Dunes ruins, at night', color: '#5c6472', hp: 48, speed: 9, damage: 15, aggro: 26, territory: 30,
    attack: 'dive', cooldown: 2.6, reach: 20, radius: 0.6, height: 1.3, fly: 9, night: true, ride: 'fly', pack: 2, coins: 16, respawn: 80,
  },
}
export const SPECIES_LIST = Object.values(SPECIES)

/* ---------- Creatures ---------- */

export type State = 'idle' | 'patrol' | 'alert' | 'chase' | 'attack' | 'flee' | 'return' | 'follow' | 'fight' | 'ridden'

export interface Creature {
  id: number
  alive: boolean
  species: SpeciesId
  spec: Species
  alpha: boolean
  /** Size multiplier (alphas are big). */
  size: number
  hp: number
  maxHp: number
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  grounded: boolean
  state: State
  stateT: number
  /** Where it was spawned (its territory's centre), and the spawn point it belongs to. */
  home: { x: number; z: number }
  spawnIdx: number
  /** Current walk target. */
  target: { x: number; z: number }
  pause: number
  /** Attack cooldown, and whether the current attack already connected. */
  cd: number
  hitDone: boolean
  /** Locked charge / dive direction. */
  lunge: THREE.Vector3
  flank: number
  /** 0..1 pop-in. */
  spawn: number
  flash: number
  stun: number
  squash: number
  /** Seconds since death (-1 while alive). */
  dying: number
  /** Seconds the health bar stays up after a hit. */
  hurtT: number
  /** Buried in the sand (snapcrab). */
  buried: boolean
  /** Inside a Spark Sphere (not drawn, not simulated). */
  hidden: boolean
  /** Seconds of zap bolt left to draw, and where it went. */
  zapT: number
  zapTo: THREE.Vector3
  lastSwing: number
  /** Roster index when tamed (-1 while wild). */
  tame: number
  level: number
  /** Animation phase (legs, wings). */
  phase: number
  /** Seen by the player (bestiary). */
  seen: boolean
}

export const MAX_CREATURES = 60

function blank(id: number): Creature {
  return {
    id, alive: false, species: 'thornback', spec: SPECIES.thornback, alpha: false, size: 1, hp: 1, maxHp: 1,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, grounded: true, state: 'idle', stateT: 0,
    home: { x: 0, z: 0 }, spawnIdx: -1, target: { x: 0, z: 0 }, pause: 0, cd: 0, hitDone: false, lunge: new THREE.Vector3(),
    flank: 0, spawn: 1, flash: 0, stun: 0, squash: 0, dying: -1, hurtT: 0, buried: false, hidden: false, zapT: 0,
    zapTo: new THREE.Vector3(), lastSwing: -1, tame: -1, level: 1, phase: 0, seen: false,
  }
}

export const creatures: Creature[] = Array.from({ length: MAX_CREATURES }, (_, id) => blank(id))

/* ---------- Spawn points ---------- */

export interface SpawnPoint {
  species: SpeciesId
  x: number
  z: number
  alpha: boolean
  /** Pack id (members flank together). */
  pack: number
  /** Slot of the live creature, or -1; and when it may come back after a death. */
  slot: number
  respawnAt: number
}

const rnd = mulberry32(4242)
const region = (id: string) => REGIONS.find((r) => r.id === id)!
const walkable = (x: number, z: number, r: number) => heightAt(x, z) > WATER_LEVEL + 0.4 && !blocked(x, z, r + 0.3)
const beach = (x: number, z: number) => {
  const h = heightAt(x, z)
  return h > WATER_LEVEL + 0.3 && h < WATER_LEVEL + 1.5 && !blocked(x, z, 0.9)
}

/** The hub beacon: a safe zone around the guide where nothing attacks. */
const HUB = MISSIONS[0]
export const SAFE_RADIUS = 12
const nearBeacon = (x: number, z: number, r: number) => MISSIONS.some((m) => Math.hypot(m.x - x, m.z - z) < r)

function findSpot(cx: number, cz: number, radius: number, ok: (x: number, z: number) => boolean) {
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
    if (ok(x, z) && !nearBeacon(x, z, 14) && Math.hypot(x - HUB.x, z - HUB.z) > SAFE_RADIUS + 8) return [x, z]
  }
  return null
}

let packN = 0
function makeSpawns(): SpawnPoint[] {
  const out: SpawnPoint[] = []
  const add = (species: SpeciesId, x: number, z: number, alpha: boolean, pack: number) => out.push({ species, x, z, alpha, pack, slot: -1, respawnAt: 0 })
  const packAt = (species: SpeciesId, cx: number, cz: number, radius: number, ok = (x: number, z: number) => walkable(x, z, SPECIES[species].radius)) => {
    const spec = SPECIES[species]
    const spot = findSpot(cx, cz, radius, ok)
    if (!spot) return
    const pack = ++packN
    for (let k = 0; k < spec.pack; k++) {
      const a = (k / spec.pack) * Math.PI * 2, r = k === 0 ? 0 : 2.5
      let x = spot[0] + Math.cos(a) * r, z = spot[1] + Math.sin(a) * r
      if (!ok(x, z)) {
        x = spot[0]
        z = spot[1]
      }
      add(species, x, z, false, pack)
    }
  }
  const alphaAt = (species: SpeciesId, cx: number, cz: number, radius: number, ok = (x: number, z: number) => walkable(x, z, SPECIES[species].radius * 1.7)) => {
    const spot = findSpot(cx, cz, radius, ok)
    if (spot) add(species, spot[0], spot[1], true, ++packN)
  }
  // Forest: Thornback packs in the Campus Grove and the Ridge woods.
  const campus = region('campus'), ridge = region('ridge')
  packAt('thornback', campus.center[0], campus.center[1], 30)
  packAt('thornback', campus.center[0], campus.center[1], 30)
  packAt('thornback', ridge.center[0], ridge.center[1], 32)
  alphaAt('thornback', campus.center[0], campus.center[1], 26)
  // Highland: lone Grizzlebears.
  const hl = region('highland')
  for (let i = 0; i < 4; i++) packAt('grizzlebear', hl.center[0], hl.center[1], 36)
  alphaAt('grizzlebear', hl.center[0], hl.center[1], 30)
  // Neon city: Scrapdrone patrols over the streets.
  const neon = region('neon')
  const street = (x: number, z: number) => heightAt(x, z) > WATER_LEVEL + 0.4 && !blocked(x, z, 1.2)
  packAt('scrapdrone', neon.center[0], neon.center[1], 34, street)
  packAt('scrapdrone', neon.center[0], neon.center[1], 34, street)
  alphaAt('scrapdrone', neon.center[0], neon.center[1], 30, street)
  // Coast: Snapcrabs on the beaches of the archipelago, the dunes and the speedway shore.
  for (const id of ['lab', 'dunes', 'speedway', 'plains']) {
    const r = region(id)
    packAt('snapcrab', r.center[0], r.center[1], r.radius + 14, beach)
    packAt('snapcrab', r.center[0], r.center[1], r.radius + 14, beach)
  }
  alphaAt('snapcrab', region('lab').center[0], region('lab').center[1], region('lab').radius + 14, beach)
  // Ruins: Gargoyles over the Dunes, at night.
  const dunes = region('dunes')
  for (let i = 0; i < 3; i++) packAt('gargoyle', dunes.center[0], dunes.center[1], 30)
  alphaAt('gargoyle', dunes.center[0], dunes.center[1], 26)
  return out
}

let spawnList: SpawnPoint[] | null = null
/** Every spawn point (built on first use, once the colliders exist). */
export function spawns(): SpawnPoint[] {
  spawnList ??= makeSpawns()
  return spawnList
}

/* ---------- Particles ---------- */

const C = {
  dust: new THREE.Color('#c9b99c'),
  spark: new THREE.Color('#fff4c2'),
  coin: new THREE.Color('#ffd23f'),
  blood: new THREE.Color('#ff7a59'),
  zap: new THREE.Color('#9be7ff'),
  sphere: new THREE.Color('#7ef5c8'),
  sphere2: new THREE.Color('#ffe066'),
}
const opts: Emit = { count: 0, x: 0, y: 0, z: 0, speed: [0, 0], color: C.dust, size: [0, 0], life: [0, 0] }
function burst(o: Partial<Emit> & Pick<Emit, 'count' | 'x' | 'y' | 'z' | 'color'>) {
  opts.spread = 0
  opts.up = 0.3
  opts.color2 = undefined
  opts.hdr = 1
  opts.gravity = 0
  opts.drag = 0
  opts.shape = SHAPE.glow
  opts.grow = false
  opts.speed = [1, 2]
  opts.size = [0.2, 0.3]
  opts.life = [0.5, 0.8]
  Object.assign(opts, o)
  emit(opts)
}

/* ---------- Persistence: roster, bestiary, trophies ---------- */

export interface Pal {
  id: string
  species: SpeciesId
  name: string
  level: number
  xp: number
  /** Resting after being knocked out: seconds of play until it is back. */
  rest: number
}

export interface Bestiary {
  seen: SpeciesId[]
  caught: SpeciesId[]
  alphas: SpeciesId[]
}

export const roster: { pals: Pal[]; active: string[]; trophies: number } = { pals: [], active: [], trophies: 0 }
export const bestiary: Bestiary = { seen: [], caught: [], alphas: [] }

function load() {
  try {
    const r = JSON.parse(localStorage.getItem('world-pals') ?? 'null')
    if (r && Array.isArray(r.pals)) {
      roster.pals = r.pals.filter((p: Pal) => SPECIES[p.species])
      roster.active = (r.active ?? []).filter((id: string) => roster.pals.some((p) => p.id === id)).slice(0, 3)
      roster.trophies = r.trophies ?? 0
    }
    const b = JSON.parse(localStorage.getItem('world-bestiary') ?? 'null')
    if (b) Object.assign(bestiary, { seen: b.seen ?? [], caught: b.caught ?? [], alphas: b.alphas ?? [] })
  } catch {
    // Nothing saved, or storage is unavailable.
  }
}
load()

function save() {
  try {
    localStorage.setItem('world-pals', JSON.stringify(roster))
    localStorage.setItem('world-bestiary', JSON.stringify(bestiary))
  } catch {
    // Private mode: progress just won't persist.
  }
  world.set({ palsN: world.get().palsN + 1 })
}

function note(list: SpeciesId[], id: SpeciesId) {
  if (list.includes(id)) return false
  list.push(id)
  save()
  return true
}

/** XP needed to go from `level` to the next. */
export const xpToNext = (level: number) => 40 + level * 35

/* ---------- The player, as the creatures see them ---------- */

export interface Hero {
  pos: THREE.Vector3
  knock: THREE.Vector2
  yaw: number
  camYaw: number
  flying: boolean
  hp: number
  maxHp: number
  /** Seconds of invulnerability left after a hit, and of red hit flash. */
  invuln: number
  hurt: number
  /** Seconds since the last hit (regen starts after a few). */
  calm: number
  /** Knocked out: seconds left of the overlay (0 = up and about). */
  ko: number
  /** Where to wake up: the last beacon stood next to. */
  beacon: { x: number; z: number }
}

export const HERO_HP = 100

/** Nothing attacks while the mission dialog is open, during a mission fight, in the hub, or in photo mode. */
export function peaceful(p: Hero) {
  const s = world.get()
  return s.open !== null || s.photo || !!fight || p.ko > 0 || Math.hypot(p.pos.x - HUB.x, p.pos.z - HUB.z) < SAFE_RADIUS
}

/** Hurt the player (the HUD flashes, the camera shakes, they get shoved along (nx, nz)). */
export function hurtHero(p: Hero, amount: number, nx: number, nz: number, knock: number) {
  if (p.invuln > 0 || p.ko > 0 || peaceful(p)) return false
  p.hp = Math.max(0, p.hp - amount)
  p.invuln = 0.8
  p.hurt = 0.5
  p.calm = 0
  p.knock.set(nx * knock, nz * knock)
  impact(0.04, Math.min(0.7, 0.3 + amount * 0.015))
  burst({ count: 8, x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z, color: C.blood, color2: C.spark, shape: SHAPE.star, hdr: 1.8, up: 0.5, speed: [2, 4], size: [0.14, 0.24], life: [0.2, 0.4] })
  play('move')
  if (p.hp <= 0) {
    p.ko = 2.6
    world.set({ ko: world.get().ko + 1 })
    dismount()
  }
  return true
}

/** The knock-out timeline: after a moment, wake up at the last beacon with full health (coins are kept). */
function stepHero(p: Hero, h: number) {
  p.invuln = Math.max(0, p.invuln - h)
  p.hurt = Math.max(0, p.hurt - h)
  p.calm += h
  if (p.ko > 0) {
    const was = p.ko
    p.ko -= h
    if (was > 1.3 && p.ko <= 1.3) {
      world.set({ teleport: { x: p.beacon.x + 3, z: p.beacon.z + 3, n: (world.get().teleport?.n ?? 0) + 1 } })
      p.hp = p.maxHp
      p.invuln = 3
    }
    if (p.ko <= 0) p.ko = 0
    return
  }
  // Regen once out of combat for a few seconds.
  if (p.calm > 5 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 6 * h)
}

/* ---------- Spawning ---------- */

function freeSlot() {
  return creatures.find((c) => !c.alive && c.dying < 0 && c.tame < 0) ?? null
}

/** Put a creature of `species` at (x, z); used by the spawn table and the `?snap` hooks. */
export function spawnCreature(species: SpeciesId, x: number, z: number, alpha = false, spawnIdx = -1): Creature | null {
  const c = freeSlot()
  if (!c) return null
  const spec = SPECIES[species]
  const ground = heightAt(x, z)
  c.alive = true
  c.species = species
  c.spec = spec
  c.alpha = alpha
  c.size = alpha ? 1.7 : 1
  c.maxHp = c.hp = Math.round(spec.hp * (alpha ? 4 : 1))
  c.pos.set(x, spec.fly ? ground + spec.fly : ground, z)
  c.vel.set(0, 0, 0)
  c.yaw = rnd() * Math.PI * 2
  c.grounded = !spec.fly
  c.state = 'idle'
  c.stateT = 0
  c.home.x = x
  c.home.z = z
  c.spawnIdx = spawnIdx
  c.target.x = x
  c.target.z = z
  c.pause = 1 + rnd() * 2
  c.cd = 0
  c.hitDone = false
  c.flank = 0
  c.spawn = 0
  c.flash = c.stun = c.squash = 0
  c.dying = -1
  c.hurtT = 0
  c.buried = !!spec.ambush
  c.hidden = false
  c.zapT = 0
  c.lastSwing = -1
  c.tame = -1
  c.level = 1
  c.phase = rnd() * 6
  c.seen = false
  if (spawnIdx >= 0) spawns()[spawnIdx].slot = c.id
  return c
}

function despawn(c: Creature) {
  if (c.spawnIdx >= 0) {
    const sp = spawns()[c.spawnIdx]
    if (sp.slot === c.id) sp.slot = -1
  }
  c.alive = false
  c.dying = -1
  c.hidden = false
  c.tame = -1
}

/** Creatures appear around the player and leave again far away; the night-only ones only after dark. */
function manageSpawns(p: Hero) {
  const list = spawns()
  const night = isNight()
  for (let i = 0; i < list.length; i++) {
    const sp = list[i]
    const spec = SPECIES[sp.species]
    const d = Math.hypot(sp.x - p.pos.x, sp.z - p.pos.z)
    if (sp.slot >= 0) {
      const c = creatures[sp.slot]
      if (!c.alive || c.spawnIdx !== i) {
        sp.slot = -1
        continue
      }
      const away = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z)
      if (away > 150 || (spec.night && !night && c.state !== 'flee')) despawn(c)
      continue
    }
    if (d > 120 || dayClock.now < sp.respawnAt || (spec.night && !night)) continue
    const c = spawnCreature(sp.species, sp.x, sp.z, sp.alpha, i)
    if (!c) return
    c.flank = sp.pack % 2 ? 0.9 : -0.9
    if (spec.pack > 1) c.flank = ((i % spec.pack) - (spec.pack - 1) / 2) * 1.1
  }
}

/* ---------- Damage to creatures ---------- */

/** Hurt one creature, knocking it along (nx, nz). `by` is the pal that did it (XP), or null for the player. */
export function damageCreature(c: Creature, amount: number, nx: number, nz: number, knock: number, lift: number, by: Creature | null = null) {
  if (!c.alive || c.hidden) return
  c.flash = 0.12
  c.stun = Math.max(c.stun, c.alpha ? 0.25 : 0.4)
  c.squash = 1
  c.hurtT = 4
  c.hitDone = true
  if (c.state === 'attack') c.state = 'chase'
  c.vel.x += nx * knock * (c.alpha ? 0.4 : 1)
  c.vel.z += nz * knock * (c.alpha ? 0.4 : 1)
  if (!c.spec.fly) {
    c.vel.y = Math.max(c.vel.y, lift * (c.alpha ? 0.4 : 0.8))
    c.grounded = false
  }
  c.buried = false
  burst({ count: 9, x: c.pos.x, y: c.pos.y + c.spec.height * c.size * 0.6, z: c.pos.z, color: C.spark, color2: C.coin, shape: SHAPE.star, hdr: 2.4, up: 0.4, speed: [2, 5], size: [0.16, 0.26], life: [0.15, 0.3] })
  c.hp -= amount
  if (c.hp <= 0) {
    c.hp = 0
    if (c.tame >= 0) downPal(c)
    else killCreature(c, by)
    return
  }
  // Wild ones turn on whoever hit them, and run when badly hurt.
  if (c.tame < 0) {
    if (c.hp < c.maxHp * 0.25 && !c.alpha) {
      c.state = 'flee'
      c.stateT = 0
    } else if (c.state === 'idle' || c.state === 'patrol' || c.state === 'return') {
      c.state = 'alert'
      c.stateT = 0
    }
  }
  play('move')
}

function killCreature(c: Creature, by: Creature | null) {
  c.alive = false
  c.dying = 0
  c.state = 'idle'
  impact(0.08, c.alpha ? 0.7 : 0.4)
  play('select')
  const coins = c.spec.coins * (c.alpha ? 4 : 1)
  results.coins += coins
  const trophy = c.alpha || rnd() < 0.15
  if (trophy) roster.trophies++
  if (c.alpha) note(bestiary.alphas, c.species)
  if (c.spawnIdx >= 0) spawns()[c.spawnIdx].respawnAt = dayClock.now + c.spec.respawn
  world.notify(`${c.alpha ? 'Alpha ' : ''}${c.spec.name} defeated · +${coins} coins${trophy ? ' · 🏆 trophy' : ''}`)
  // XP for the pals in the fight.
  for (const pal of creatures) {
    if (!pal.alive || pal.tame < 0) continue
    if (Math.hypot(pal.pos.x - c.pos.x, pal.pos.z - c.pos.z) < 18) grantXp(pal, (pal === by ? 24 : 12) * (c.alpha ? 3 : 1))
  }
  if (trophy) save()
}

/** The confetti pop a moment into the death squash (the renderer plays the squash). */
function stepDying(c: Creature, h: number) {
  const was = c.dying
  c.dying += h
  if (was <= 0.16 && c.dying > 0.16) confetti(c.pos.x, c.pos.y + c.spec.height * c.size * 0.5, c.pos.z, c.alpha ? 2 : 1)
  if (c.dying > 0.3) {
    c.dying = -1
    if (c.spawnIdx >= 0 && spawns()[c.spawnIdx].slot === c.id) spawns()[c.spawnIdx].slot = -1
  }
}

/** Apply a melee / area hit to the creatures (the same shape the mission enemies take). Damage is in tens. */
export function hitCreatures(h: HitShape): number {
  let n = 0
  for (const c of creatures) {
    if (!c.alive || c.hidden || c.tame >= 0 || c.lastSwing === h.swing || c.spawn < 0.6) continue
    const dx = c.pos.x - h.x, dz = c.pos.z - h.z
    const d = Math.hypot(dx, dz)
    const r = c.spec.radius * c.size
    if (d > h.range + r || Math.abs(c.pos.y - h.y) > 2.6 + (c.spec.fly ?? 0)) continue
    if (h.arc < Math.PI && d > 0.3) {
      let a = Math.atan2(dx, dz) - h.yaw
      a = Math.atan2(Math.sin(a), Math.cos(a))
      if (Math.abs(a) > h.arc) continue
    }
    c.lastSwing = h.swing
    damageCreature(c, h.damage * 12, d > 1e-3 ? dx / d : Math.sin(h.yaw), d > 1e-3 ? dz / d : Math.cos(h.yaw), h.knock, h.lift)
    n++
  }
  if (n) impact(n > 1 ? 0.09 : 0.06, Math.min(0.6, 0.22 + n * 0.08))
  return n
}

/** The nearest wild creature within `range` of a point (for auto-aim and the zap). */
export function nearestWild(x: number, z: number, range: number): Creature | null {
  let best: Creature | null = null
  let bestD = range
  for (const c of creatures) {
    if (!c.alive || c.hidden || c.tame >= 0 || c.buried) continue
    const d = Math.hypot(c.pos.x - x, c.pos.z - z)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** The creature the player is aiming at: the nearest wild one in front of the camera. */
export function aimedCreature(p: Hero, range = 20): Creature | null {
  let best: Creature | null = null
  let bestScore = Infinity
  const fx = -Math.sin(p.camYaw), fz = -Math.cos(p.camYaw)
  for (const c of creatures) {
    if (!c.alive || c.hidden || c.tame >= 0 || c.buried) continue
    const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z
    const d = Math.hypot(dx, dz)
    if (d > range || d < 0.1) continue
    const cos = (dx * fx + dz * fz) / d
    if (cos < 0.75) continue
    const score = d * (2 - cos)
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/* ---------- Spark Sphere (capture) ---------- */

export interface Sphere {
  active: boolean
  phase: 'fly' | 'wobble' | 'open'
  t: number
  from: THREE.Vector3
  pos: THREE.Vector3
  target: Creature | null
  /** Capture chance rolled at the throw, and whether it succeeds. */
  chance: number
  success: boolean
  wobbles: number
  cooldown: number
}

export const sphere: Sphere = { active: false, phase: 'fly', t: 0, from: new THREE.Vector3(), pos: new THREE.Vector3(), target: null, chance: 0, success: false, wobbles: 0, cooldown: 0 }

/** Capture chance for a creature, 0..1: the weaker it is, the better (alphas resist). */
export function captureChance(c: Creature) {
  const hurt = 1 - c.hp / c.maxHp
  const base = 0.12 + hurt * 0.78
  return Math.min(0.95, Math.max(0.05, base * (c.alpha ? 0.45 : 1)))
}

/** Test hook: force the next throw to succeed / fail (null = roll the dice). */
export const captureOverride: { force: boolean | null } = { force: null }

/** Throw a Spark Sphere at `c` (the aimed creature). Returns false if one is already in the air. */
export function throwSphere(p: Hero, c: Creature | null) {
  if (sphere.active || sphere.cooldown > 0 || !c || !c.alive || c.hidden) return false
  sphere.active = true
  sphere.phase = 'fly'
  sphere.t = 0
  sphere.from.set(p.pos.x, p.pos.y + 1.4, p.pos.z)
  sphere.pos.copy(sphere.from)
  sphere.target = c
  sphere.chance = captureChance(c)
  sphere.success = captureOverride.force ?? rnd() < sphere.chance
  sphere.wobbles = 0
  play('select')
  return true
}

const FLIGHT = 0.7
const WOBBLE = 0.55

function stepSphere(h: number) {
  sphere.cooldown = Math.max(0, sphere.cooldown - h)
  if (!sphere.active) return
  const c = sphere.target
  sphere.t += h
  if (!c || !c.alive) {
    sphere.active = false
    return
  }
  if (sphere.phase === 'fly') {
    const k = Math.min(1, sphere.t / FLIGHT)
    const ty = c.pos.y + c.spec.height * c.size * 0.5
    sphere.pos.set(THREE.MathUtils.lerp(sphere.from.x, c.pos.x, k), THREE.MathUtils.lerp(sphere.from.y, ty, k) + Math.sin(k * Math.PI) * 2.2, THREE.MathUtils.lerp(sphere.from.z, c.pos.z, k))
    if (k >= 1) {
      // Caught in the sphere: it drops to the ground and wobbles three times.
      sphere.phase = 'wobble'
      sphere.t = 0
      c.hidden = true
      c.vel.set(0, 0, 0)
      burst({ count: 18, x: sphere.pos.x, y: sphere.pos.y, z: sphere.pos.z, color: C.sphere, color2: C.sphere2, hdr: 2, up: 0.4, speed: [2, 5], size: [0.2, 0.34], life: [0.3, 0.6] })
      play('move')
    }
    return
  }
  if (sphere.phase === 'wobble') {
    const ground = heightAt(c.pos.x, c.pos.z)
    sphere.pos.set(c.pos.x, Math.max(ground + 0.35, sphere.pos.y - 6 * h), c.pos.z)
    const w = Math.floor(sphere.t / WOBBLE)
    if (w > sphere.wobbles) {
      sphere.wobbles = w
      play('move')
    }
    if (sphere.t >= WOBBLE * 3 + 0.3) {
      sphere.phase = 'open'
      sphere.t = 0
      if (sphere.success) capture(c)
      else {
        c.hidden = false
        c.state = 'alert'
        c.stateT = 0
        c.stun = 0.3
        burst({ count: 14, x: sphere.pos.x, y: sphere.pos.y, z: sphere.pos.z, color: C.spark, shape: SHAPE.smoke, up: 0.4, speed: [1, 3], size: [0.3, 0.5], life: [0.3, 0.6], drag: 3, grow: true })
        world.notify(`${c.spec.name} broke free!`)
      }
    }
    return
  }
  if (sphere.t > 0.4) {
    sphere.active = false
    sphere.cooldown = 0.6
  }
}

const NAMES: Record<SpeciesId, string[]> = {
  thornback: ['Bristle', 'Tusker', 'Rumble', 'Acorn'],
  grizzlebear: ['Barley', 'Mossback', 'Tumble', 'Oakley'],
  scrapdrone: ['Blip', 'Volt', 'Pixel', 'Static'],
  snapcrab: ['Pinch', 'Scuttle', 'Coral', 'Snippy'],
  gargoyle: ['Flint', 'Vesper', 'Rook', 'Dusk'],
}

function capture(c: Creature) {
  const names = NAMES[c.species]
  const pal: Pal = { id: `${c.species}-${Date.now().toString(36)}`, species: c.species, name: `${names[roster.pals.length % names.length]}${c.alpha ? ' ★' : ''}`, level: c.alpha ? 5 : 1, xp: 0, rest: 0 }
  roster.pals.push(pal)
  note(bestiary.caught, c.species)
  if (c.spawnIdx >= 0) spawns()[c.spawnIdx].respawnAt = dayClock.now + c.spec.respawn * 2
  confetti(sphere.pos.x, sphere.pos.y + 0.5, sphere.pos.z, 1.4)
  impact(0, 0.3)
  play('boot')
  despawn(c)
  if (roster.active.length < 3) {
    roster.active.push(pal.id)
    world.notify(`${pal.name} the ${c.spec.name} joined your party!`)
  } else world.notify(`${pal.name} the ${c.spec.name} was sent to the Palbox`)
  save()
}

/* ---------- Pals ---------- */

/** The creature slot of an active pal, or null while it is resting / not spawned. */
export function palCreature(id: string): Creature | null {
  const idx = roster.pals.findIndex((p) => p.id === id)
  return idx < 0 ? null : (creatures.find((c) => c.alive && c.tame === idx) ?? null)
}

function grantXp(c: Creature, xp: number) {
  const pal = roster.pals[c.tame]
  if (!pal) return
  pal.xp += xp
  let up = false
  while (pal.xp >= xpToNext(pal.level)) {
    pal.xp -= xpToNext(pal.level)
    pal.level++
    up = true
  }
  if (up) {
    c.level = pal.level
    c.maxHp = palHp(pal)
    c.hp = c.maxHp
    world.notify(`${pal.name} reached level ${pal.level}!`)
    confetti(c.pos.x, c.pos.y + 1, c.pos.z, 1)
    play('boot')
  }
  save()
}

const palHp = (pal: Pal) => Math.round(SPECIES[pal.species].hp * (1.4 + pal.level * 0.2))
const palDamage = (c: Creature) => Math.round(c.spec.damage * 0.9 + c.level * 3)

/** Keep the active pals spawned next to the player; send resting ones away. */
function managePals(p: Hero, h: number) {
  for (let i = 0; i < roster.pals.length; i++) {
    const pal = roster.pals[i]
    const live = creatures.find((c) => c.alive && c.tame === i) ?? null
    const wanted = roster.active.includes(pal.id)
    if (pal.rest > 0) {
      pal.rest = Math.max(0, pal.rest - h)
      if (pal.rest === 0) world.notify(`${pal.name} is rested and back by your side`)
      continue
    }
    if (live && !wanted) {
      if (ride.pal === live) dismount()
      despawn(live)
      continue
    }
    if (!live && wanted) {
      const a = p.camYaw + (i - 1) * 0.7
      const x = p.pos.x + Math.sin(a) * 2.5, z = p.pos.z + Math.cos(a) * 2.5
      const c = spawnCreature(pal.species, x, z)
      if (!c) continue
      c.tame = i
      c.level = pal.level
      c.maxHp = c.hp = palHp(pal)
      c.state = 'follow'
      c.buried = false
      c.yaw = p.yaw
      c.spawnIdx = -1
    }
  }
}

function downPal(c: Creature) {
  const pal = roster.pals[c.tame]
  if (pal) {
    pal.rest = 45
    world.notify(`${pal.name} is knocked out and resting (45 s)`)
  }
  if (ride.pal === c) dismount()
  burst({ count: 16, x: c.pos.x, y: c.pos.y + 0.6, z: c.pos.z, color: C.dust, shape: SHAPE.smoke, up: 0.4, speed: [1, 3], size: [0.4, 0.6], life: [0.4, 0.7], drag: 3, grow: true })
  despawn(c)
  save()
}

/** Swap which pals follow (the Palbox at the harbour beacon; at most three). */
export function setActive(id: string, on: boolean) {
  const has = roster.active.includes(id)
  if (on && !has && roster.active.length < 3) roster.active.push(id)
  if (!on && has) roster.active = roster.active.filter((x) => x !== id)
  save()
}

export function renamePal(id: string, name: string) {
  const pal = roster.pals.find((p) => p.id === id)
  if (!pal) return
  pal.name = name.slice(0, 16) || pal.name
  save()
}

/** The Palbox is usable next to the hub (harbour) beacon. */
export const nearPalbox = (p: Hero) => Math.hypot(p.pos.x - HUB.x, p.pos.z - HUB.z) < 9

/* ---------- Riding ---------- */

export const ride: { pal: Creature | null } = { pal: null }

/** Mount the nearest rideable pal (R), or get off. */
export function toggleRide(p: Hero) {
  if (ride.pal) {
    dismount()
    return true
  }
  let best: Creature | null = null
  let bestD = 4
  for (const c of creatures) {
    if (!c.alive || c.tame < 0 || !c.spec.ride) continue
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  if (!best) return false
  ride.pal = best
  best.state = 'ridden'
  best.stateT = 0
  play('select')
  return true
}

export function dismount() {
  const c = ride.pal
  if (!c) return
  ride.pal = null
  if (c.alive) {
    c.state = 'follow'
    c.pos.x += Math.sin(c.yaw + Math.PI / 2) * 1.5
    c.pos.z += Math.cos(c.yaw + Math.PI / 2) * 1.5
  }
}

/** Speeds while mounted: Grizzlebear sprints, the flyers fly. */
export const MOUNT = {
  run: { walk: 9, run: 15 },
  fly: { walk: 8, run: 12, fly: 26, boost: 36 },
}

/** Saddle height: how high the rider sits above the ground. */
export const saddleHeight = (c: Creature) => c.spec.height * c.size * (c.spec.fly ? 0.9 : 0.95)

/* ---------- Simulation ---------- */

const TICK = 1 / 30
let acc = 0
let tickN = 0

/** Advance the creature world by a frame's worth of time (fixed 30 Hz inside). */
export function stepCreatures(dt: number, p: Hero) {
  acc += dt
  let n = 0
  while (acc >= TICK && n < 4) {
    acc -= TICK
    tick(p)
    n++
  }
  if (acc >= TICK) acc = 0
}

/** Test hook: advance the simulation by `seconds` in fixed ticks. */
export function simulate(seconds: number, p: Hero) {
  const n = Math.round(seconds / TICK)
  for (let i = 0; i < n; i++) tick(p)
}

/** Fraction of a tick elapsed since the last one (the renderer uses it to smooth motion). */
export const tickBlend = () => acc / TICK

const dirTo = new THREE.Vector2()

function tick(p: Hero) {
  const h = TICK
  tickN++
  stepClock(h)
  stepHero(p, h)
  stepSphere(h)
  if (tickN % 30 === 0) manageSpawns(p)
  managePals(p, h)
  const quiet = peaceful(p)
  for (const c of creatures) {
    if (c.dying >= 0) {
      stepDying(c, h)
      continue
    }
    if (!c.alive || c.hidden) continue
    const d = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z)
    // Far creatures idle at a lower rate.
    if (d > 70 && tickN % 3 !== 0) continue
    if (!c.seen && d < 32 && !c.buried) {
      c.seen = true
      if (note(bestiary.seen, c.species)) world.notify(`New species spotted: ${c.spec.name}`)
    }
    stepCreature(c, h, p, d, quiet)
  }
  separate(p)
}

/** Keep creatures off each other (packs otherwise pile up on the same spot). */
function separate(p: Hero) {
  const n = creatures.length
  for (let i = 0; i < n; i++) {
    const a = creatures[i]
    if (!a.alive || a.hidden || a.state === 'ridden') continue
    if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) > 50) continue
    for (let j = i + 1; j < n; j++) {
      const b = creatures[j]
      if (!b.alive || b.hidden || b.state === 'ridden') continue
      if (!!a.spec.fly !== !!b.spec.fly) continue
      const r = a.spec.radius * a.size + b.spec.radius * b.size
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z
      const d2 = dx * dx + dz * dz
      if (d2 >= r * r) continue
      const d = Math.sqrt(d2) || 0.01
      const push = (r - d) * 0.5
      const nx = d > 0.01 ? dx / d : 1, nz = d > 0.01 ? dz / d : 0
      a.pos.x -= nx * push
      a.pos.z -= nz * push
      b.pos.x += nx * push
      b.pos.z += nz * push
    }
  }
}

function stepCreature(c: Creature, h: number, p: Hero, d: number, quiet: boolean) {
  const spec = c.spec
  c.spawn = Math.min(1, c.spawn + h * 3)
  c.flash = Math.max(0, c.flash - h)
  c.stun = Math.max(0, c.stun - h)
  c.squash = Math.max(0, c.squash - h * 4)
  c.hurtT = Math.max(0, c.hurtT - h)
  c.zapT = Math.max(0, c.zapT - h)
  c.cd = Math.max(0, c.cd - h)
  c.stateT += h
  const speed = Math.hypot(c.vel.x, c.vel.z)
  c.phase += h * (c.spec.fly ? 14 : 2 + speed * 1.6)

  if (c.state === 'ridden') {
    // Under the rider: the player's physics owns the position.
    c.pos.copy(p.pos)
    c.yaw = p.yaw
    c.vel.set(0, 0, 0)
    c.grounded = true
    return
  }

  if (c.tame >= 0) stepPal(c, h, p, d)
  else stepWild(c, h, p, d, quiet)

  // ---- Integrate: slide along props, no swimming (flyers skim the water). ----
  if (c.stun > 0 && !spec.fly) {
    c.vel.x *= Math.exp(-h * 4)
    c.vel.z *= Math.exp(-h * 4)
  }
  const nx = c.pos.x + c.vel.x * h, nz = c.pos.z + c.vel.z * h
  if (spec.fly || heightAt(nx, nz) > WATER_LEVEL + 0.2) {
    c.pos.x = nx
    c.pos.z = nz
    resolve(c.pos, spec.radius * c.size, c.pos.y)
  } else {
    c.vel.x = c.vel.z = 0
  }
  const ground = Math.max(heightAt(c.pos.x, c.pos.z), WATER_LEVEL)
  if (spec.fly) {
    // Hover: ease towards the wanted height (dives set vel.y directly).
    const want = ground + spec.fly * (c.tame >= 0 ? 0.5 : 1) + Math.sin(c.phase * 0.35) * 0.3
    if (c.state !== 'attack') c.vel.y += (want - c.pos.y) * 3 * h - c.vel.y * 2 * h
    c.pos.y += c.vel.y * h
    if (c.pos.y < ground + 0.6) {
      c.pos.y = ground + 0.6
      c.vel.y = Math.max(0, c.vel.y)
    }
    c.grounded = false
    return
  }
  c.vel.y -= 22 * h
  c.pos.y += c.vel.y * h
  if (c.pos.y <= ground) {
    if (!c.grounded && c.vel.y < -3) c.squash = Math.max(c.squash, 0.5)
    c.pos.y = ground
    c.vel.y = 0
    c.grounded = true
  } else if (c.pos.y - ground < 0.5 && c.vel.y <= 0 && c.grounded) {
    c.pos.y = ground
    c.vel.y = 0
  } else c.grounded = false
}

/** Walk / fly towards (x, z) at `speed`, turning to face it; returns the distance left. */
function moveTo(c: Creature, x: number, z: number, speed: number, h: number, turn = 8) {
  const dx = x - c.pos.x, dz = z - c.pos.z
  const d = Math.hypot(dx, dz)
  if (d < 0.2) {
    c.vel.x *= 0.5
    c.vel.z *= 0.5
    return d
  }
  const k = Math.min(1, h * 6)
  c.vel.x += ((dx / d) * speed - c.vel.x) * k
  c.vel.z += ((dz / d) * speed - c.vel.z) * k
  c.yaw = turnTo(c.yaw, Math.atan2(dx, dz), h * turn)
  return d
}

function stop(c: Creature, h: number) {
  const k = Math.exp(-h * 8)
  c.vel.x *= k
  c.vel.z *= k
}

function turnTo(from: number, to: number, k: number) {
  let dd = to - from
  dd = Math.atan2(Math.sin(dd), Math.cos(dd))
  return from + dd * Math.min(1, k)
}

function pickTarget(c: Creature) {
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2, r = 3 + rnd() * c.spec.territory * 0.6
    const x = c.home.x + Math.cos(a) * r, z = c.home.z + Math.sin(a) * r
    if (c.spec.fly ? heightAt(x, z) > WATER_LEVEL - 2 : walkable(x, z, c.spec.radius * c.size)) {
      c.target.x = x
      c.target.z = z
      return
    }
  }
  c.target.x = c.home.x
  c.target.z = c.home.z
}

/** Whoever the creature is after: the player, or a pal that is in its face. */
function pickVictim(c: Creature, p: Hero): { x: number; y: number; z: number; pal: Creature | null } {
  let best: Creature | null = null
  let bestD = 3
  for (const pal of creatures) {
    if (!pal.alive || pal.tame < 0 || pal.state === 'ridden') continue
    const d = Math.hypot(pal.pos.x - c.pos.x, pal.pos.z - c.pos.z)
    if (d < bestD) {
      bestD = d
      best = pal
    }
  }
  const dp = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z)
  if (best && bestD < dp) return { x: best.pos.x, y: best.pos.y, z: best.pos.z, pal: best }
  return { x: p.pos.x, y: p.pos.y, z: p.pos.z, pal: null }
}

/** Land a hit on whatever is within `reach` of the creature's front: the player, and pals. */
function landHit(c: Creature, p: Hero, reach: number, arc: number, knock: number) {
  const dmg = Math.round(c.spec.damage * (c.alpha ? 1.6 : 1))
  const inFront = (x: number, z: number) => {
    const dx = x - c.pos.x, dz = z - c.pos.z
    const d = Math.hypot(dx, dz)
    if (d > reach) return null
    let a = Math.atan2(dx, dz) - c.yaw
    a = Math.atan2(Math.sin(a), Math.cos(a))
    return Math.abs(a) <= arc || d < 1 ? { nx: d > 1e-3 ? dx / d : 0, nz: d > 1e-3 ? dz / d : 1 } : null
  }
  let hit = false
  if (Math.abs(p.pos.y - c.pos.y) < 2.6 + (c.spec.fly ? 4 : 0)) {
    const n = inFront(p.pos.x, p.pos.z)
    if (n && hurtHero(p, dmg, n.nx, n.nz, knock)) hit = true
  }
  for (const pal of creatures) {
    if (!pal.alive || pal.tame < 0 || pal.state === 'ridden' || pal.hidden) continue
    const n = inFront(pal.pos.x, pal.pos.z)
    if (n) {
      damageCreature(pal, dmg, n.nx, n.nz, knock * 0.6, 3, c)
      hit = true
    }
  }
  return hit
}

function stepWild(c: Creature, h: number, p: Hero, d: number, quiet: boolean) {
  const spec = c.spec
  const fromHome = Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z)
  const canAggro = !quiet && d < spec.aggro && c.stun <= 0 && Math.abs(p.pos.y - c.pos.y) < (spec.fly ? 40 : 12)
  const tooFar = fromHome > spec.territory * 1.8 || d > spec.aggro * 2.2
  if (c.stun > 0 && c.state !== 'flee') {
    stop(c, h)
    return
  }
  switch (c.state) {
    case 'idle':
      stop(c, h)
      c.pause -= h
      if (spec.ambush && !c.buried && c.stateT > 4) c.buried = true
      if (canAggro) {
        c.state = 'alert'
        c.stateT = 0
        c.buried = false
      } else if (c.pause <= 0 && !spec.ambush) {
        pickTarget(c)
        c.state = 'patrol'
        c.stateT = 0
      }
      break
    case 'patrol': {
      const left = moveTo(c, c.target.x, c.target.z, spec.speed * 0.45, h, 4)
      if (left < 1 || c.stateT > 12) {
        c.state = 'idle'
        c.stateT = 0
        c.pause = 1.5 + rnd() * 3
      }
      if (canAggro) {
        c.state = 'alert'
        c.stateT = 0
      }
      break
    }
    case 'alert':
      // A beat of noticing (face the player), then the chase.
      stop(c, h)
      c.yaw = turnTo(c.yaw, Math.atan2(p.pos.x - c.pos.x, p.pos.z - c.pos.z), h * 10)
      if (c.stateT > (spec.ambush ? 0.25 : 0.5)) {
        c.state = 'chase'
        c.stateT = 0
      }
      break
    case 'chase': {
      if (quiet || tooFar) {
        c.state = 'return'
        c.stateT = 0
        break
      }
      const v = pickVictim(c, p)
      const vd = Math.hypot(v.x - c.pos.x, v.z - c.pos.z)
      if (spec.attack === 'zap') {
        // Keep a shooting distance, strafing around the target.
        dirTo.set(c.pos.x - v.x, c.pos.z - v.z).normalize()
        const keep = 7
        const sx = -dirTo.y * c.flank, sz = dirTo.x * c.flank
        moveTo(c, v.x + dirTo.x * keep + sx * 3, v.z + dirTo.y * keep + sz * 3, spec.speed, h)
        c.yaw = turnTo(c.yaw, Math.atan2(v.x - c.pos.x, v.z - c.pos.z), h * 8)
        if (vd < spec.reach && c.cd <= 0) {
          c.state = 'attack'
          c.stateT = 0
          c.hitDone = false
        }
        break
      }
      // Packs flank: each member heads for its own spot around the target.
      dirTo.set(v.x - c.pos.x, v.z - c.pos.z).normalize()
      const a = Math.atan2(dirTo.x, dirTo.y) + c.flank * Math.min(1, vd / 6)
      const standOff = spec.attack === 'charge' ? 5 : spec.reach * 0.7
      const tx = v.x - Math.sin(a) * Math.min(standOff, vd * 0.9), tz = v.z - Math.cos(a) * Math.min(standOff, vd * 0.9)
      moveTo(c, tx, tz, spec.speed, h)
      if (vd < spec.reach && c.cd <= 0 && (spec.attack !== 'charge' || vd > 2.5 || c.stateT > 1.5)) {
        c.state = 'attack'
        c.stateT = 0
        c.hitDone = false
        c.lunge.set(v.x - c.pos.x, v.y - c.pos.y, v.z - c.pos.z)
        c.yaw = Math.atan2(c.lunge.x, c.lunge.z)
      }
      break
    }
    case 'attack':
      stepAttack(c, h, p)
      break
    case 'flee': {
      dirTo.set(c.pos.x - p.pos.x, c.pos.z - p.pos.z)
      if (dirTo.lengthSq() < 1e-4) dirTo.set(1, 0)
      dirTo.normalize()
      moveTo(c, c.pos.x + dirTo.x * 8, c.pos.z + dirTo.y * 8, spec.speed * 1.25, h)
      if (c.stateT > 5 || d > spec.aggro * 2.5) {
        c.state = 'return'
        c.stateT = 0
      }
      break
    }
    case 'return': {
      const left = moveTo(c, c.home.x, c.home.z, spec.speed * 0.7, h)
      if (left < 2 || c.stateT > 20) {
        c.state = 'idle'
        c.stateT = 0
        c.pause = 2
        // Hurt ones recover at home.
        if (c.hp < c.maxHp * 0.5) c.hp = Math.round(c.maxHp * 0.5)
      }
      if (canAggro && c.stateT > 2 && c.hp > c.maxHp * 0.25) {
        c.state = 'alert'
        c.stateT = 0
      }
      break
    }
    default:
      c.state = 'idle'
  }
}

function stepAttack(c: Creature, h: number, p: Hero) {
  const spec = c.spec
  const t = c.stateT
  const done = () => {
    c.state = 'chase'
    c.stateT = 0
    c.cd = spec.cooldown
  }
  switch (spec.attack) {
    case 'charge': {
      // Wind up (paw the ground), then a straight dash; it connects once.
      if (t < 0.55) {
        stop(c, h)
        c.yaw = turnTo(c.yaw, Math.atan2(p.pos.x - c.pos.x, p.pos.z - c.pos.z), h * 6)
        if (tickN % 4 === 0) burst({ count: 2, x: c.pos.x, y: c.pos.y + 0.1, z: c.pos.z, color: C.dust, shape: SHAPE.smoke, up: 0.3, speed: [1, 2], size: [0.3, 0.45], life: [0.3, 0.5], drag: 3, grow: true })
        if (t + h >= 0.55) {
          c.lunge.set(Math.sin(c.yaw), 0, Math.cos(c.yaw))
          c.hitDone = false
        }
      } else if (t < 1.25) {
        c.vel.x = c.lunge.x * 14
        c.vel.z = c.lunge.z * 14
        if (!c.hitDone && landHit(c, p, 1.6 * c.size, 1.2, 9)) c.hitDone = true
      } else done()
      break
    }
    case 'swipe': {
      stop(c, h)
      if (t < 0.5) c.yaw = turnTo(c.yaw, Math.atan2(p.pos.x - c.pos.x, p.pos.z - c.pos.z), h * 5)
      if (t >= 0.5 && !c.hitDone) {
        c.hitDone = true
        landHit(c, p, 2.9 * c.size, 1.1, 12)
        impact(0, 0.25)
        burst({ count: 10, x: c.pos.x + Math.sin(c.yaw) * 1.5, y: c.pos.y + 0.3, z: c.pos.z + Math.cos(c.yaw) * 1.5, color: C.dust, shape: SHAPE.smoke, up: 0.3, speed: [1, 3], size: [0.3, 0.5], life: [0.3, 0.5], drag: 3, grow: true })
      }
      if (t > 1.0) done()
      break
    }
    case 'zap': {
      stop(c, h)
      const v = pickVictim(c, p)
      c.yaw = turnTo(c.yaw, Math.atan2(v.x - c.pos.x, v.z - c.pos.z), h * 10)
      if (t >= 0.35 && !c.hitDone) {
        c.hitDone = true
        c.zapT = 0.18
        c.zapTo.set(v.x, v.y + 1, v.z)
        landHit(c, p, spec.reach + 1, 0.6, 5)
        burst({ count: 6, x: v.x, y: v.y + 1, z: v.z, color: C.zap, hdr: 2.2, up: 0.4, speed: [2, 4], size: [0.14, 0.22], life: [0.15, 0.3] })
      }
      if (t > 0.6) done()
      break
    }
    case 'nip': {
      if (t < 0.18) stop(c, h)
      else if (t < 0.32) {
        c.vel.x = Math.sin(c.yaw) * 9
        c.vel.z = Math.cos(c.yaw) * 9
        if (!c.hitDone && landHit(c, p, 1.5 * c.size, 1.0, 6)) c.hitDone = true
      } else {
        // Scuttle sideways after the nip.
        c.vel.x = Math.sin(c.yaw + Math.PI / 2) * 5 * c.flank
        c.vel.z = Math.cos(c.yaw + Math.PI / 2) * 5 * c.flank
        if (t > 0.9) done()
      }
      break
    }
    case 'dive': {
      // Swoop along an arc through the victim's head height, climbing back out the other side.
      const dur = 1.3
      if (t === h) {
        c.lunge.set(p.pos.x, p.pos.y + 1.2, p.pos.z)
      }
      const k = Math.min(1, t / dur)
      const sx = c.pos.x, sz = c.pos.z
      const tx = c.lunge.x, tz = c.lunge.z
      const dx = tx - sx, dz = tz - sz
      const dist = Math.hypot(dx, dz) || 1
      const sp = spec.speed * 2.2
      c.vel.x = (dx / dist) * sp
      c.vel.z = (dz / dist) * sp
      // Height: down to the target by the middle of the dive, up again after.
      const wantY = k < 0.5 ? THREE.MathUtils.lerp(c.pos.y, c.lunge.y, Math.min(1, h * 6)) : c.pos.y + 14 * h
      c.vel.y = (wantY - c.pos.y) / h
      c.yaw = Math.atan2(c.vel.x, c.vel.z)
      if (!c.hitDone && k > 0.25 && landHit(c, p, 2.2 * c.size, 1.4, 8)) c.hitDone = true
      if (k >= 1) done()
      break
    }
  }
}

/** A tamed creature: follows, and fights whatever wild thing comes near its player. */
function stepPal(c: Creature, h: number, p: Hero, d: number) {
  const spec = c.spec
  if (c.stun > 0) {
    stop(c, h)
    return
  }
  // Too far behind (fast travel, a long flight): catch up by teleporting in.
  if (d > 45) {
    c.pos.set(p.pos.x + 2, spec.fly ? p.pos.y + 2 : heightAt(p.pos.x + 2, p.pos.z), p.pos.z)
    c.vel.set(0, 0, 0)
  }
  // Anything hostile near the player?
  let foe: Creature | null = null
  let foeD = 16
  if (!p.flying) {
    for (const w of creatures) {
      if (!w.alive || w.hidden || w.tame >= 0 || w.buried || w.spawn < 0.6) continue
      if (w.state === 'idle' || w.state === 'patrol' || w.state === 'return') continue
      const dd = Math.hypot(w.pos.x - p.pos.x, w.pos.z - p.pos.z)
      if (dd < foeD) {
        foeD = dd
        foe = w
      }
    }
  }
  if (foe) {
    c.state = 'fight'
    const fd = Math.hypot(foe.pos.x - c.pos.x, foe.pos.z - c.pos.z)
    const reach = spec.attack === 'zap' ? 9 : (spec.radius + foe.spec.radius * foe.size + 0.6)
    if (fd > reach) moveTo(c, foe.pos.x, foe.pos.z, spec.speed * 1.2, h)
    else {
      stop(c, h)
      c.yaw = turnTo(c.yaw, Math.atan2(foe.pos.x - c.pos.x, foe.pos.z - c.pos.z), h * 10)
      if (c.cd <= 0) {
        c.cd = 1.0
        const nx = (foe.pos.x - c.pos.x) / (fd || 1), nz = (foe.pos.z - c.pos.z) / (fd || 1)
        damageCreature(foe, palDamage(c), nx, nz, 4, 2.5, c)
        if (spec.attack === 'zap' || spec.attack === 'dive') {
          c.zapT = 0.15
          c.zapTo.set(foe.pos.x, foe.pos.y + foe.spec.height * foe.size * 0.5, foe.pos.z)
        } else c.squash = 0.6
      }
    }
    return
  }
  // Follow in a loose formation behind the player.
  c.state = 'follow'
  const slot = c.tame % 3
  const a = p.yaw + Math.PI + (slot - 1) * 0.8
  const fx = p.pos.x + Math.sin(a) * 2.6, fz = p.pos.z + Math.cos(a) * 2.6
  const fd = Math.hypot(fx - c.pos.x, fz - c.pos.z)
  if (fd > 1.2) {
    const sp = fd > 8 ? Math.max(spec.speed * 2, 12) : spec.speed
    moveTo(c, fx, fz, sp, h)
  } else {
    stop(c, h)
    if (d > 2) c.yaw = turnTo(c.yaw, p.yaw, h * 3)
  }
}

/* ---------- Helpers for the player ---------- */

/** Creatures are solid: push a circle at (pos.x, pos.z) out of the ones around it (not the one being ridden). */
export function pushOutOfCreatures(pos: THREE.Vector3, radius: number) {
  for (const c of creatures) {
    if (!c.alive || c.hidden || c.buried || c === ride.pal) continue
    if (pos.y - c.pos.y > c.spec.height * c.size * 0.7) continue
    const r = c.spec.radius * c.size + radius
    const dx = pos.x - c.pos.x, dz = pos.z - c.pos.z
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r || d2 < 1e-6) continue
    const d = Math.sqrt(d2)
    pos.x = c.pos.x + (dx / d) * r
    pos.z = c.pos.z + (dz / d) * r
  }
}

/** Forget every live creature (leaving explore mode); the roster and bestiary stay. */
export function clearCreatures() {
  dismount()
  for (const c of creatures) despawn(c)
  sphere.active = false
}
