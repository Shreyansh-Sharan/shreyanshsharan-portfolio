// The small games dotted around the island: fishing off the harbour pier, sheep herding, a rooftop parkour trial,
// a forest treasure hunt, the photo challenge, a drone delivery race, the distillery target range and the
// flying rings. One module of framework-free state (like combat.ts): Minigames.tsx draws the props, Characters.tsx
// asks it what the player may do, PlayHud.tsx shows the prompts, timers and end cards. Every game can be
// started, stepped and finished from the `?snap` hook (`window.__world.minigame`).
import * as THREE from 'three'
import { REGIONS, WATER_LEVEL } from './regions'
import { heightAt, mulberry32 } from './terrain'
import { blocked, boxCollider, setExtraColliders } from './colliders'
import { neonBlocks } from './layout'
import { MISSIONS } from './missions'
import { confetti, freeze, impact, results } from './combat'
import { creatures, roster } from './creatures'
import { world, type MinigameHud } from './store'
import { play } from '../lib/sound'

export type GameId = 'fishing' | 'herding' | 'parkour' | 'treasure' | 'photo' | 'delivery' | 'range' | 'rings'

export interface GameDef {
  id: GameId
  name: string
  icon: string
  /** Where the start prompt stands. */
  x: number
  z: number
  region: string
  blurb: string
  controls: string
  /** Coins for finishing; a trophy on top when `trophy` is set (or the game's own rule says so). */
  coins: number
  trophy: boolean
  /** Time limit in seconds (0 = none). */
  limit: number
}

const region = (id: string) => REGIONS.find((r) => r.id === id)!
const at = (id: string, dx: number, dz: number): [number, number] => {
  const r = region(id)
  return [r.center[0] + dx, r.center[1] + dz]
}
const walkable = (x: number, z: number, r = 0.8) => heightAt(x, z) > WATER_LEVEL + 0.4 && !blocked(x, z, r)

/** Nudge a spot onto open ground, spiralling outwards. */
function clear(x: number, z: number, r = 0.8): [number, number] {
  for (let i = 0; i < 60; i++) {
    const a = i * 2.4, d = i * 0.7
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d
    if (walkable(px, pz, r) && !MISSIONS.some((m) => Math.hypot(m.x - px, m.z - pz) < 8)) return [px, pz]
  }
  return [x, z]
}

/** The harbour pier: the nearest shoreline to the hub, with a jetty running out over the water. */
function findPier() {
  let best: { x: number; z: number; a: number; d: number } | null = null
  for (let deg = 0; deg < 360; deg += 6) {
    const a = (deg * Math.PI) / 180
    for (let d = 16; d < 90; d += 1.5) {
      const x = Math.cos(a) * d, z = Math.sin(a) * d
      if (heightAt(x, z) < WATER_LEVEL + 0.45) {
        if (!best || d < best.d) best = { x, z, a, d }
        break
      }
    }
  }
  const p = best ?? { x: 0, z: 40, a: Math.PI / 2, d: 40 }
  // The jetty starts a few metres inland and runs 9 m out to sea.
  const sx = Math.cos(p.a) * (p.d - 3), sz = Math.sin(p.a) * (p.d - 3)
  return { x: sx, z: sz, a: p.a, length: 12 }
}

let pierCache: ReturnType<typeof findPier> | null = null
export function pier() {
  pierCache ??= findPier()
  return pierCache
}

let defs: GameDef[] | null = null
export function GAMES(): GameDef[] {
  if (defs) return defs
  const p = pier()
  const f = clear(p.x - Math.cos(p.a) * 2, p.z - Math.sin(p.a) * 2)
  const h = clear(...at('highland', -14, -24))
  const n = clear(...at('neon', 4, 24), 1.2)
  const t = clear(...at('campus', 12, 2))
  const ph = clear(...at('ridge', 14, -10))
  const d = clear(...at('speedway', -14, 14))
  const r = clear(...at('highland', -20, 16))
  const fr = clear(...at('highland', 24, -14))
  defs = [
    { id: 'fishing', name: 'Harbour Fishing', icon: '🎣', x: f[0], z: f[1], region: 'hub', blurb: 'Cast from the pier, hook what bites, and reel in three fish. Six species swim here; one of them is rare.', controls: 'Space casts when the bar is in the green · Space again to hook a bite · A / D alternately to reel', coins: 20, trophy: false, limit: 0 },
    { id: 'herding', name: 'Sheep Herding', icon: '🐑', x: h[0], z: h[1], region: 'highland', blurb: 'Eight sheep have wandered off. Walk up behind them (your pals help) and drive all eight into the pen before the clock runs out.', controls: 'Walk towards sheep to push them · pals push too · 90 s', coins: 40, trophy: false, limit: 90 },
    { id: 'parkour', name: 'Rooftop Run', icon: '🏃', x: n[0], z: n[1], region: 'neon', blurb: 'A time trial across the Neon District roofs: through every ring, as fast as you can. No flying, but the trial boots give you a double jump.', controls: 'Space jumps, Space again mid-air for a double jump · Shift runs · flight is off', coins: 45, trophy: false, limit: 0 },
    { id: 'treasure', name: 'Treasure Hunt', icon: '🗺️', x: t[0], z: t[1], region: 'campus', blurb: 'A map scrap marks an X somewhere in the grove. Find the spot and stomp it to dig. Three maps, each vaguer than the last.', controls: 'Read the map · jump and attack in the air to stomp on the X', coins: 30, trophy: false, limit: 0 },
    { id: 'photo', name: 'Photo Challenge', icon: '📷', x: ph[0], z: ph[1], region: 'ridge', blurb: 'Open the camera anywhere with P: time stops and you can orbit freely. Snap five different species (animals or creatures) in frame.', controls: 'P opens the camera · drag to orbit, W / S to zoom · Space or click snaps', coins: 60, trophy: true, limit: 0 },
    { id: 'delivery', name: 'Drone Delivery', icon: '📦', x: d[0], z: d[1], region: 'speedway', blurb: 'Three parcels, three districts. Grab one from the depot, fly it to its pad, come back for the next. The clock runs the whole time.', controls: 'Walk over a parcel to pick it up · double-tap Space to fly · land on the glowing pad', coins: 50, trophy: false, limit: 0 },
    { id: 'range', name: 'Target Range', icon: '🎯', x: r[0], z: r[1], region: 'highland', blurb: 'Ten bottles on the barrels. Zap them all with your spells as fast as you can.', controls: 'F (or right click) zaps the bottle you face', coins: 35, trophy: false, limit: 0 },
    { id: 'rings', name: 'Highland Rings', icon: '💫', x: fr[0], z: fr[1], region: 'highland', blurb: 'Fifteen rings hang over the highlands. Fly through all of them against the clock.', controls: 'Double-tap Space to fly · Space / C for up and down · Shift to boost', coins: 55, trophy: false, limit: 0 },
  ]
  return defs
}
export const gameById = (id: GameId) => GAMES().find((g) => g.id === id)!
export const GAME_PROMPT_DISTANCE = 5

/* ---------- Best times ---------- */

function readBest(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('world-best') ?? '{}')
  } catch {
    return {}
  }
}
export const best: Record<string, number> = readBest()
function saveBest() {
  try {
    localStorage.setItem('world-best', JSON.stringify(best))
  } catch {
    // Private mode: the time just won't persist.
  }
}

/* ---------- Game state ---------- */

export interface Sheep {
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  phase: number
  inPen: boolean
}

export interface Ring {
  x: number
  y: number
  z: number
  /** Facing (yaw) for the ring's orientation. */
  yaw: number
  passed: boolean
}

export interface Game {
  id: GameId
  def: GameDef
  t: number
  over: boolean
  won: boolean
  /** Progress counter and its total (rings passed, bottles down, fish caught...). */
  n: number
  total: number
  // Fishing
  phase: 'cast' | 'wait' | 'bite' | 'reel' | 'landed'
  meter: number
  meterDir: number
  quality: number
  waitT: number
  tension: number
  lastReel: string
  fish: string | null
  catches: string[]
  // Herding
  sheep: Sheep[]
  pen: { x: number; z: number; r: number; gate: number }
  // Rings / parkour / delivery
  rings: Ring[]
  pads: { x: number; y: number; z: number }[]
  jumps: number
  carrying: number
  depot: { x: number; z: number }
  drops: { x: number; z: number; name: string }[]
  // Treasure
  tier: number
  dig: { x: number; z: number }
  shown: { x: number; z: number }
  stompN: number
  dug: boolean
  // Range
  bottles: { x: number; y: number; z: number; down: number }[]
  // Photo
  species: string[]
}

export let game: Game | null = null

/** Photo mode (P): a frozen world and a free camera, also the photo challenge's camera. */
export const photo = {
  active: false,
  yaw: 0,
  pitch: 0.3,
  dist: 8,
  /** Bumped when a snap is requested; the renderer counts what is in frame and fills `inFrame`. */
  snapN: 0,
  seenN: 0,
  inFrame: [] as string[],
  /** Every species photographed so far (persists). */
  album: [] as string[],
}
try {
  photo.album = JSON.parse(localStorage.getItem('world-photo') ?? '[]')
} catch {
  // Nothing saved.
}

const rnd = mulberry32(99)
let attempt = 0

function blankGame(def: GameDef): Game {
  return {
    id: def.id, def, t: 0, over: false, won: false, n: 0, total: 0,
    phase: 'cast', meter: 0, meterDir: 1, quality: 0, waitT: 0, tension: 0, lastReel: '', fish: null, catches: [],
    sheep: [], pen: { x: 0, z: 0, r: 5, gate: 0 }, rings: [], pads: [], jumps: 0, carrying: -1, depot: { x: 0, z: 0 }, drops: [],
    tier: 0, dig: { x: 0, z: 0 }, shown: { x: 0, z: 0 }, stompN: 0, dug: false, bottles: [], species: [],
  }
}

/* ---------- Start ---------- */

export function startMinigame(id: GameId, p: { pos: THREE.Vector3; stomp: { n: number } }) {
  if (game && !game.over) return false
  const def = gameById(id)
  const g = blankGame(def)
  attempt++
  switch (id) {
    case 'fishing':
      g.total = 3
      g.phase = 'cast'
      break
    case 'herding':
      setupHerding(g, def)
      break
    case 'parkour':
      setupParkour(g, def)
      break
    case 'treasure':
      setupTreasure(g, def)
      g.stompN = p.stomp.n
      break
    case 'photo':
      g.total = 5
      g.species = [...photo.album]
      g.n = g.species.length
      if (!photo.active) togglePhoto()
      break
    case 'delivery':
      setupDelivery(g, def)
      break
    case 'range':
      setupRange(g, def)
      break
    case 'rings':
      setupRings(g, def)
      break
  }
  game = g
  play('boot')
  publish()
  return true
}

function setupHerding(g: Game, def: GameDef) {
  g.total = 8
  // The pen 22 m from the start on open ground, its gate facing the sheep.
  const a = rnd() * Math.PI * 2
  let px = def.x + Math.cos(a) * 22, pz = def.z + Math.sin(a) * 22
  ;[px, pz] = clear(px, pz, 6)
  g.pen = { x: px, z: pz, r: 5, gate: Math.atan2(def.x - px, def.z - pz) }
  for (let i = 0; i < 8; i++) {
    const sa = (i / 8) * Math.PI * 2, sr = 3 + rnd() * 4
    let x = def.x + Math.cos(sa) * sr, z = def.z + Math.sin(sa) * sr
    ;[x, z] = clear(x, z, 0.7)
    g.sheep.push({ pos: new THREE.Vector3(x, heightAt(x, z), z), vel: new THREE.Vector3(), yaw: rnd() * 6, phase: rnd() * 6, inPen: false })
  }
}

function setupParkour(g: Game, def: GameDef) {
  const r = region('neon')
  const base = heightAt(r.center[0], r.center[1])
  const blocks = neonBlocks().map((b) => ({ ...b, top: base + b.h }))
  const used = new Set<number>()
  let cx = def.x, cz = def.z, cy = heightAt(def.x, def.z)
  const rings: Ring[] = []
  const pads: { x: number; y: number; z: number }[] = []
  for (let step = 0; step < 7; step++) {
    // The next roof: close by and not too much of a climb.
    let bestI = -1
    let bestS = Infinity
    blocks.forEach((b, i) => {
      if (used.has(i)) return
      const d = Math.hypot(b.x - cx, b.z - cz)
      if (d < 8 || d > 30) return
      const dh = b.top - cy
      if (dh > 2.5 * Math.max(1, d / 5) || dh < -12) return
      const score = d + Math.abs(dh) * 2 + rnd() * 6
      if (score < bestS) {
        bestS = score
        bestI = i
      }
    })
    if (bestI < 0) break
    used.add(bestI)
    const b = blocks[bestI]
    // Stepping stones between here and the roof, rising no more than ~2 m each.
    const d = Math.hypot(b.x - cx, b.z - cz)
    const steps = Math.max(1, Math.ceil(d / 5.5))
    for (let k = 1; k < steps; k++) {
      const f = k / steps
      pads.push({ x: THREE.MathUtils.lerp(cx, b.x, f), y: THREE.MathUtils.lerp(cy, b.top, f), z: THREE.MathUtils.lerp(cz, b.z, f) })
    }
    rings.push({ x: b.x, y: b.top + 1.2, z: b.z, yaw: Math.atan2(b.x - cx, b.z - cz), passed: false })
    cx = b.x
    cz = b.z
    cy = b.top
  }
  // The last ring back on the ground, next to the start.
  rings.push({ x: def.x + 3, y: heightAt(def.x + 3, def.z) + 1.2, z: def.z, yaw: 0, passed: false })
  const d = Math.hypot(def.x + 3 - cx, def.z - cz)
  const steps = Math.max(1, Math.ceil(d / 5.5))
  for (let k = 1; k < steps; k++) {
    const f = k / steps
    pads.push({ x: THREE.MathUtils.lerp(cx, def.x + 3, f), y: THREE.MathUtils.lerp(cy, heightAt(def.x + 3, def.z), f), z: THREE.MathUtils.lerp(cz, def.z, f) })
  }
  g.rings = rings
  g.pads = pads.filter((p) => p.y > heightAt(p.x, p.z) + 0.6)
  g.total = rings.length
  setExtraColliders('parkour', g.pads.map((p) => boxCollider(p.x, p.z, 1.4, 1.4, 0, p.y)))
}

const TREASURE_RADIUS = [14, 26, 40]
export function treasureTier() {
  try {
    return Math.min(2, Number(localStorage.getItem('world-treasure-tier') ?? 0) || 0)
  } catch {
    return 0
  }
}

function setupTreasure(g: Game, def: GameDef) {
  g.tier = treasureTier()
  g.total = 1
  const r = region('campus')
  const seed = mulberry32(500 + attempt * 7 + g.tier)
  let x = def.x, z = def.z
  for (let i = 0; i < 40; i++) {
    const a = seed() * Math.PI * 2, d = 8 + seed() * (TREASURE_RADIUS[g.tier] - 8)
    x = r.center[0] + Math.cos(a) * d
    z = r.center[1] + Math.sin(a) * d
    if (walkable(x, z, 1.2) && Math.hypot(x - def.x, z - def.z) > 10) break
  }
  g.dig = { x, z }
  // The map's X drifts with the tier: exact, a few metres off, or a wide circle.
  const jitter = g.tier === 0 ? 0 : g.tier === 1 ? 4 : 0
  g.shown = { x: x + (seed() - 0.5) * 2 * jitter, z: z + (seed() - 0.5) * 2 * jitter }
}

function setupDelivery(g: Game, def: GameDef) {
  g.total = 3
  g.depot = { x: def.x, z: def.z }
  g.carrying = -1
  const pad = (id: string, dx: number, dz: number, name: string) => {
    const [x, z] = clear(...at(id, dx, dz), 2.5)
    return { x, z, name }
  }
  g.drops = [pad('neon', 10, 18, 'Neon District'), pad('highland', 14, 18, 'Highland Distillery'), pad('hub', 14, 14, 'Basecamp')]
  g.n = 0
}

function setupRange(g: Game, def: GameDef) {
  g.total = 10
  // A shelf of bottles 9 m ahead of the firing spot, facing the player.
  const a = Math.atan2(region('highland').center[0] - def.x, region('highland').center[1] - def.z)
  const cx = def.x + Math.sin(a) * 9, cz = def.z + Math.cos(a) * 9
  const rx = Math.cos(a), rz = -Math.sin(a)
  for (let i = 0; i < 10; i++) {
    const k = (i - 4.5) * 0.9
    const x = cx + rx * k, z = cz + rz * k
    g.bottles.push({ x, y: heightAt(x, z) + 1.0 + (i % 2) * 0.5, z, down: -1 })
  }
}

function setupRings(g: Game, def: GameDef) {
  g.total = 15
  const r = region('highland')
  // A wide loop over the highland, rising and falling, starting ahead of the launch spot.
  const a0 = Math.atan2(def.x - r.center[0], def.z - r.center[1])
  for (let i = 0; i < 15; i++) {
    const a = a0 + (i / 15) * Math.PI * 2
    const rad = 26 + Math.sin(i * 1.7) * 10
    const x = r.center[0] + Math.sin(a) * rad, z = r.center[1] + Math.cos(a) * rad
    const y = heightAt(x, z) + 10 + (i % 3) * 7 + Math.sin(i * 0.9) * 4
    const nx = r.center[0] + Math.sin(a + 0.42) * rad, nz = r.center[1] + Math.cos(a + 0.42) * rad
    g.rings.push({ x, y, z, yaw: Math.atan2(nx - x, nz - z), passed: false })
  }
}

/* ---------- Finish ---------- */

export function finishMinigame(won: boolean, note = '') {
  const g = game
  if (!g || g.over) return
  g.over = true
  g.won = won
  let coins = 0
  let trophy = false
  let bestT: number | null = best[g.id] ?? null
  if (won) {
    coins = g.def.coins
    trophy = g.def.trophy || (g.id === 'treasure' && g.tier === 2) || (g.id === 'fishing' && g.catches.includes('Prism Koi'))
    if (g.id === 'fishing') coins += g.catches.reduce((s, f) => s + (FISH.find((x) => x.name === f)?.coins ?? 0), 0)
    if (g.id === 'treasure') coins = [30, 60, 120][g.tier]
    results.coins += coins
    if (trophy) roster.trophies++
    if (g.def.limit === 0 || g.id === 'herding') {
      if (bestT === null || g.t < bestT) {
        best[g.id] = g.t
        bestT = g.t
        saveBest()
      }
    }
    if (g.id === 'treasure') {
      try {
        localStorage.setItem('world-treasure-tier', String(Math.min(2, g.tier + 1)))
      } catch {
        // Fine.
      }
    }
    world.complete(`game:${g.id}`)
    play('boot')
  } else play('back')
  g.n = Math.min(g.n, g.total)
  if (g.id === 'parkour') setExtraColliders('parkour', [])
  if (g.id === 'photo' && photo.active) togglePhoto()
  freeze.value = false
  publish({ won, time: g.t, coins, trophy, best: bestT, note })
}

export function closeMinigame() {
  if (game && !game.over) finishMinigame(false, 'Abandoned')
  if (game?.id === 'parkour') setExtraColliders('parkour', [])
  game = null
  world.set({ minigame: null })
}

/* ---------- The HUD snapshot ---------- */

let publishT = 0
function publish(result: MinigameHud['result'] = null) {
  const g = game
  if (!g) {
    world.set({ minigame: null })
    return
  }
  let progress = `${g.n}/${g.total}`
  let hint = ''
  let meter: number | null = null
  switch (g.id) {
    case 'fishing':
      progress = `${g.n}/${g.total} fish`
      if (g.phase === 'cast') {
        hint = 'Space when the bar is in the middle'
        meter = g.meter
      } else if (g.phase === 'wait') hint = 'Waiting for a bite…'
      else if (g.phase === 'bite') hint = 'BITE! Space to hook it'
      else if (g.phase === 'reel') {
        hint = `Reel: A and D alternately · ${g.fish}`
        meter = g.tension / 100
      } else hint = `Landed a ${g.fish}!`
      break
    case 'herding':
      progress = `${g.n}/${g.total} in the pen`
      hint = `${Math.max(0, Math.ceil(g.def.limit - g.t))} s left`
      break
    case 'parkour':
      progress = `${g.n}/${g.total} rings`
      hint = 'No flying · double jump on'
      break
    case 'treasure': {
      const d = Math.hypot(game!.dig.x - lastPos.x, game!.dig.z - lastPos.z)
      progress = ['Map I', 'Map II', 'Map III'][g.tier]
      hint = g.dug ? 'Dug up!' : d < 3 ? 'Right here: stomp!' : d < 8 ? 'Very warm' : d < 16 ? 'Warm' : d < 30 ? 'Cold' : 'Freezing'
      break
    }
    case 'photo':
      progress = `${g.n}/${g.total} species`
      hint = photo.active ? 'Space / click to snap' : 'P opens the camera'
      break
    case 'delivery':
      progress = `${g.n}/${g.total} delivered`
      hint = g.carrying >= 0 ? `Deliver to ${g.drops[g.carrying].name}` : 'Pick up a parcel at the depot'
      break
    case 'range':
      progress = `${g.n}/${g.total} bottles`
      hint = 'F zaps the bottle you face'
      break
    case 'rings':
      progress = `${g.n}/${g.total} rings`
      hint = 'Fly through the glowing ring'
      break
  }
  world.set({ minigame: { id: g.id, name: g.def.name, t: g.t, progress, hint, meter, result } })
}

/* ---------- Step ---------- */

export interface Runner {
  pos: THREE.Vector3
  flying: boolean
  vy: number
  stomp: { n: number }
}

const lastPos = new THREE.Vector3()
const v2 = new THREE.Vector2()

/** Advance the game in progress with the player's clock. */
export function stepMinigames(dt: number, p: Runner) {
  lastPos.copy(p.pos)
  const g = game
  if (!g || g.over) return
  g.t += dt
  if (g.def.limit > 0 && g.t >= g.def.limit) {
    finishMinigame(false, 'Out of time')
    return
  }
  switch (g.id) {
    case 'fishing':
      stepFishing(g, dt, p)
      break
    case 'herding':
      stepHerding(g, dt, p)
      break
    case 'parkour':
    case 'rings':
      stepRings(g, p)
      break
    case 'treasure':
      if (!g.dug && p.stomp.n !== g.stompN) {
        g.stompN = p.stomp.n
        if (Math.hypot(p.pos.x - g.dig.x, p.pos.z - g.dig.z) < 3) {
          g.dug = true
          g.n = 1
          confetti(g.dig.x, heightAt(g.dig.x, g.dig.z) + 1, g.dig.z, 1.6)
          impact(0.06, 0.5)
          finishMinigame(true, 'The chest was right there')
        } else world.notify(Math.hypot(p.pos.x - g.dig.x, p.pos.z - g.dig.z) < 8 ? 'Nothing here… but close' : 'Nothing here')
      }
      break
    case 'photo':
      if (g.n >= g.total) finishMinigame(true, 'Album complete')
      break
    case 'delivery':
      stepDelivery(g, p)
      break
    case 'range':
      for (const b of g.bottles) if (b.down >= 0) b.down += dt
      break
  }
  publishT += dt
  if (publishT > 0.1 && game && !game.over) {
    publishT = 0
    publish()
  }
}

/* ---------- Fishing ---------- */

export const FISH = [
  { name: 'Harbour Sprat', weight: 30, coins: 5, minQ: 0 },
  { name: 'Tide Perch', weight: 24, coins: 7, minQ: 0 },
  { name: 'Copper Bream', weight: 18, coins: 9, minQ: 0.3 },
  { name: 'Lantern Eel', weight: 12, coins: 12, minQ: 0.5 },
  { name: 'Striped Marlin', weight: 8, coins: 18, minQ: 0.7 },
  { name: 'Prism Koi', weight: 5, coins: 40, minQ: 0.85 },
]

function pickFish(q: number) {
  const pool = FISH.filter((f) => q >= f.minQ)
  const total = pool.reduce((s, f) => s + f.weight * (f.minQ > 0 ? 1 + q : 1), 0)
  let r = rnd() * total
  for (const f of pool) {
    r -= f.weight * (f.minQ > 0 ? 1 + q : 1)
    if (r <= 0) return f.name
  }
  return pool[0].name
}

function stepFishing(g: Game, dt: number, p: Runner) {
  if (g.phase === 'cast') {
    g.meter += g.meterDir * dt * 1.4
    if (g.meter > 1) {
      g.meter = 1
      g.meterDir = -1
    } else if (g.meter < 0) {
      g.meter = 0
      g.meterDir = 1
    }
  } else if (g.phase === 'wait') {
    g.waitT -= dt
    if (g.waitT <= 0) {
      g.phase = 'bite'
      g.waitT = 1.3
      play('select')
      const pr = pier()
      const bx = pr.x + Math.cos(pr.a) * (pr.length + 4), bz = pr.z + Math.sin(pr.a) * (pr.length + 4)
      confetti(bx, WATER_LEVEL + 0.3, bz, 0.4)
      publish()
    }
  } else if (g.phase === 'bite') {
    g.waitT -= dt
    if (g.waitT <= 0) {
      g.phase = 'cast'
      world.notify('It got away…')
      publish()
    }
  } else if (g.phase === 'reel') {
    g.tension -= dt * 11
    g.waitT += dt
    if (g.tension <= 0) {
      g.tension = 0
      if (g.waitT > 6) {
        g.phase = 'cast'
        world.notify(`The ${g.fish} slipped the line`)
        publish()
      }
    } else g.waitT = 0
    if (g.tension >= 100) {
      g.phase = 'landed'
      g.waitT = 1.4
      g.n++
      g.catches.push(g.fish!)
      world.notify(`Caught a ${g.fish}!${g.fish === 'Prism Koi' ? ' ✨ Rare!' : ''}`)
      confetti(p.pos.x, p.pos.y + 1.5, p.pos.z, 1)
      play('boot')
      publish()
    }
  } else if (g.phase === 'landed') {
    g.waitT -= dt
    if (g.waitT <= 0) {
      if (g.n >= g.total) finishMinigame(true, `Best catch: ${g.catches.reduce((a, b) => ((FISH.find((f) => f.name === a)?.coins ?? 0) >= (FISH.find((f) => f.name === b)?.coins ?? 0) ? a : b))}`)
      else {
        g.phase = 'cast'
        publish()
      }
    }
  }
}

/** Key presses the games consume (the HUD forwards them while a game runs). Returns true when used. */
export function pressKey(code: string): boolean {
  const g = game
  if (!g || g.over) return false
  if (g.id !== 'fishing') return false
  if (code === 'Space' || code === 'KeyJ' || code === 'Enter') {
    if (g.phase === 'cast') {
      g.quality = 1 - Math.abs(g.meter - 0.5) * 2
      g.phase = 'wait'
      g.waitT = 1.2 + (1 - g.quality) * 3 + rnd()
      g.fish = pickFish(g.quality)
      play('move')
      publish()
      return true
    }
    if (g.phase === 'bite') {
      g.phase = 'reel'
      g.tension = 20
      g.waitT = 0
      g.lastReel = ''
      play('select')
      publish()
      return true
    }
    return true
  }
  if (g.phase === 'reel') {
    const side = code === 'KeyA' || code === 'ArrowLeft' ? 'L' : code === 'KeyD' || code === 'ArrowRight' ? 'R' : ''
    if (!side) return false
    if (side !== g.lastReel) {
      g.lastReel = side
      g.tension = Math.min(100, g.tension + 9)
      g.waitT = 0
    }
    return true
  }
  return false
}

/** The player stands still at the pier while fishing, and in photo mode. */
export const playerLocked = () => (game !== null && !game.over && game.id === 'fishing') || photo.active

/* ---------- Herding ---------- */

const flock = new THREE.Vector3()

function stepHerding(g: Game, dt: number, p: Runner) {
  flock.set(0, 0, 0)
  for (const s of g.sheep) flock.add(s.pos)
  flock.divideScalar(g.sheep.length)
  let inside = 0
  for (const s of g.sheep) {
    v2.set(0, 0)
    // Pushed away from the player and from the pals.
    const push = (x: number, z: number, r: number, k: number) => {
      const dx = s.pos.x - x, dz = s.pos.z - z
      const d = Math.hypot(dx, dz)
      if (d < r && d > 1e-3) {
        v2.x += (dx / d) * (1 - d / r) * k
        v2.y += (dz / d) * (1 - d / r) * k
      }
    }
    push(p.pos.x, p.pos.z, p.flying ? 3 : 7, 6)
    for (const c of creatures) if (c.alive && c.tame >= 0 && c.state !== 'ridden') push(c.pos.x, c.pos.z, 6, 5)
    // Loosely together, not on top of each other.
    const toFlock = Math.hypot(flock.x - s.pos.x, flock.z - s.pos.z)
    if (toFlock > 5) {
      v2.x += ((flock.x - s.pos.x) / toFlock) * 0.8
      v2.y += ((flock.z - s.pos.z) / toFlock) * 0.8
    }
    for (const o of g.sheep) if (o !== s) push(o.pos.x, o.pos.z, 1.3, 1.5)
    // Inside the pen they settle; the fence keeps them in once they are.
    const pd = Math.hypot(s.pos.x - g.pen.x, s.pos.z - g.pen.z)
    s.inPen = pd < g.pen.r - 0.6
    if (s.inPen) {
      inside++
      v2.multiplyScalar(0.3)
    }
    if (v2.length() > 4.2) v2.setLength(4.2)
    s.vel.x += (v2.x - s.vel.x) * Math.min(1, dt * 4)
    s.vel.z += (v2.y - s.vel.z) * Math.min(1, dt * 4)
    let nx = s.pos.x + s.vel.x * dt, nz = s.pos.z + s.vel.z * dt
    // The fence: a ring with a gate; crossing it is only possible through the gate.
    const nd = Math.hypot(nx - g.pen.x, nz - g.pen.z)
    const crossing = (pd < g.pen.r) !== (nd < g.pen.r)
    if (crossing) {
      let ga = Math.atan2(nx - g.pen.x, nz - g.pen.z) - g.pen.gate
      ga = Math.atan2(Math.sin(ga), Math.cos(ga))
      if (Math.abs(ga) > 0.5) {
        nx = s.pos.x
        nz = s.pos.z
        s.vel.multiplyScalar(-0.3)
      }
    }
    if (heightAt(nx, nz) > WATER_LEVEL + 0.4 && !blocked(nx, nz, 0.5)) {
      s.pos.x = nx
      s.pos.z = nz
    } else s.vel.set(0, 0, 0)
    s.pos.y = heightAt(s.pos.x, s.pos.z)
    const sp = Math.hypot(s.vel.x, s.vel.z)
    if (sp > 0.3) s.yaw = Math.atan2(s.vel.x, s.vel.z)
    s.phase += dt * (2 + sp * 3)
  }
  if (inside !== g.n) {
    g.n = inside
    if (inside > 0) play('move')
    publish()
  }
  if (inside >= g.total) finishMinigame(true, `All ${g.total} penned`)
}

/* ---------- Rings (flight course and parkour) ---------- */

function stepRings(g: Game, p: Runner) {
  const next = g.rings[g.n]
  if (!next) return
  const dy = p.pos.y + 0.9 - next.y
  const d = Math.hypot(p.pos.x - next.x, p.pos.z - next.z)
  const reach = g.id === 'parkour' ? 2.2 : 3.2
  if (d < reach && Math.abs(dy) < reach) {
    next.passed = true
    g.n++
    confetti(next.x, next.y, next.z, 0.5)
    play('select')
    publish()
    if (g.n >= g.total) finishMinigame(true, g.id === 'parkour' ? 'Rooftops cleared' : 'Every ring')
  }
}

/* ---------- Delivery ---------- */

function stepDelivery(g: Game, p: Runner) {
  if (g.carrying < 0) {
    if (g.n < g.total && Math.hypot(p.pos.x - g.depot.x, p.pos.z - g.depot.z) < 3 && !p.flying) {
      g.carrying = g.n
      play('select')
      world.notify(`Parcel for ${g.drops[g.n].name} picked up`)
      publish()
    }
    return
  }
  const drop = g.drops[g.carrying]
  if (Math.hypot(p.pos.x - drop.x, p.pos.z - drop.z) < 4 && p.pos.y - heightAt(drop.x, drop.z) < 2.5) {
    confetti(drop.x, heightAt(drop.x, drop.z) + 1, drop.z, 0.8)
    g.n++
    g.carrying = -1
    play('boot')
    world.notify(`Delivered to ${drop.name}!`)
    publish()
    if (g.n >= g.total) finishMinigame(true, 'All parcels delivered')
  }
}

/* ---------- Target range ---------- */

/** The nearest standing bottle within `range` of a point in front of the player (for the zap). */
export function bottleTarget(x: number, z: number, yaw: number, range = 26): { x: number; y: number; z: number; i: number } | null {
  const g = game
  if (!g || g.over || g.id !== 'range') return null
  let best = -1
  let bestD = range
  g.bottles.forEach((b, i) => {
    if (b.down >= 0) return
    const dx = b.x - x, dz = b.z - z
    const d = Math.hypot(dx, dz)
    let a = Math.atan2(dx, dz) - yaw
    a = Math.atan2(Math.sin(a), Math.cos(a))
    if (d < bestD && Math.abs(a) < 0.9) {
      bestD = d
      best = i
    }
  })
  return best < 0 ? null : { ...g.bottles[best], i: best }
}

export function knockBottle(i: number) {
  const g = game
  if (!g || g.over || g.id !== 'range') return
  const b = g.bottles[i]
  if (!b || b.down >= 0) return
  b.down = 0
  g.n++
  confetti(b.x, b.y, b.z, 0.5)
  play('select')
  publish()
  if (g.n >= g.total) finishMinigame(true, 'All bottles down')
}

/* ---------- Photo mode ---------- */

export function togglePhoto(camYaw = photo.yaw, camPitch = photo.pitch) {
  photo.active = !photo.active
  if (photo.active) {
    photo.yaw = camYaw
    photo.pitch = camPitch
    photo.dist = 8
  }
  freeze.value = photo.active
  world.set({ photo: photo.active })
  play(photo.active ? 'select' : 'back')
}

/** A snap: the renderer fills `inFrame` on the next frame; the album and the challenge count the new ones. */
export function requestSnap() {
  if (!photo.active) return
  photo.snapN++
  play('move')
}

/** Called by the renderer once it has counted what was in frame. */
export function snapResult(species: string[]) {
  photo.seenN = photo.snapN
  photo.inFrame = species
  const fresh = species.filter((s) => !photo.album.includes(s))
  if (fresh.length) {
    photo.album.push(...fresh)
    try {
      localStorage.setItem('world-photo', JSON.stringify(photo.album))
    } catch {
      // Fine.
    }
  }
  const g = game
  if (g && !g.over && g.id === 'photo') {
    for (const s of fresh) if (!g.species.includes(s)) g.species.push(s)
    g.n = Math.min(g.total, g.species.length)
    publish()
  }
  world.notify(species.length ? `📷 ${species.join(', ')}${fresh.length ? ` · ${fresh.length} new` : ''}` : '📷 Nothing in frame')
}

/* ---------- Hooks for the player ---------- */

/** Flight is off during the rooftop trial. */
export const flightAllowed = () => !(game && !game.over && game.id === 'parkour')
/** The rooftop trial's boots: a higher jump and one more in the air. */
export const parkourBoots = () => !!(game && !game.over && game.id === 'parkour')

/** Snapshot for the test hook. */
export function gameState() {
  const g = game
  if (!g) return null
  return { id: g.id, t: g.t, n: g.n, total: g.total, over: g.over, won: g.won, phase: g.phase, tier: g.tier, dig: g.dig, carrying: g.carrying, rings: g.rings.map((r) => [r.x, r.y, r.z]), pads: g.pads, bottles: g.bottles, sheep: g.sheep.map((s) => [s.pos.x, s.pos.z, s.inPen]), pen: g.pen, depot: g.depot, drops: g.drops, catches: g.catches }
}

/** Test hook: run the current game to its winning end (every ring passed, every bottle down...). */
export function completeMinigame() {
  const g = game
  if (!g || g.over) return false
  g.n = g.total
  for (const r of g.rings) r.passed = true
  for (const b of g.bottles) b.down = 0
  for (const s of g.sheep) s.inPen = true
  g.dug = true
  if (g.id === 'fishing' && g.catches.length < g.total) while (g.catches.length < g.total) g.catches.push(FISH[g.catches.length].name)
  finishMinigame(true, 'Simulated')
  return true
}
