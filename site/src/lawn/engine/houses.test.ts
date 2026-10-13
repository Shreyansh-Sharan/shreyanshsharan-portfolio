// House walkthrough tests: for every house on both streets (both facings) and every hero, a scripted player walks
// in through the front door, climbs the stairs to the upper floor and comes back down; leans a ladder from the
// balcony and climbs onto the roof; walks every doorway on both floors; and a bot raider reaches an upstairs
// valuable through the nav graph. Run: node src/lawn/engine/houses.test.ts
declare const process: { argv: string[]; exitCode?: number }
import { HERO_IDS, type HeroId } from './heroes.ts'
import { FLOOR_H, ROOF_Y } from './houses.ts'
import { MAP_IDS, type MapId } from './maps.ts'
import { Sim, emptyInput, type Player } from './sim.ts'

let failures = 0
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) failures++
  if (!ok || process.argv.includes('-v')) console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`)
}

function makeSim(map: MapId, hero: HeroId, team: number) {
  const sim = new Sim({ map, mode: 'destruction', seed: 7, roster: [{ name: 'Walker', hero, team, human: true }, { name: 'Other', hero: 'dad', team: 1 - team, human: true }], prepSeconds: 600, raidSeconds: 600 })
  return sim
}

/** Drive a player through local-frame waypoints of a house; returns the furthest index reached. */
function walk(sim: Sim, p: Player, team: number, route: { x: number; z: number; y?: number }[], seconds: number) {
  const h = sim.houses[team]
  const W = (lx: number) => h.ox + lx * h.dir
  const Z = (lz: number) => h.oz + lz * h.dir
  let i = 0
  let stuck = 0
  let lastD = 1e9
  for (let t = 0; t < seconds && i < route.length; t += 1 / 60) {
    const wp = route[i]
    const tx = W(wp.x)
    const tz = Z(wp.z)
    const dx = tx - p.x
    const dz = tz - p.z
    const d = Math.hypot(dx, dz)
    const yOk = wp.y === undefined || Math.abs(p.y - wp.y) < 0.35
    if (d < 0.35 && yOk) {
      i++
      lastD = 1e9
      stuck = 0
      continue
    }
    const inp = emptyInput()
    inp.yaw = Math.atan2(dx, dz)
    inp.mz = Math.min(1, d * 2 + 0.25)
    sim.setInput(p.id, inp)
    sim.step(1 / 60)
    if (d > lastD - 0.002) stuck++
    else stuck = 0
    lastD = Math.min(lastD, d)
    if (stuck > 240) break
  }
  sim.setInput(p.id, emptyInput())
  return i
}

/** Local waypoints: in at the front door, through the hall to the stair foot, up the flight onto the landing. */
const UP = [
  { x: 0, z: 7.0 },
  { x: 0, z: 5.4 },
  { x: 0, z: 4.1 },
  { x: 0.6, z: 4.0 },
  { x: 0.6, z: 2.0 },
  { x: 0.6, z: 0.2 },
  { x: 0.6, z: -0.9, y: FLOOR_H },
]
const DOWN = [
  { x: 0.6, z: -0.5, y: FLOOR_H },
  { x: 0.6, z: 1.5 },
  { x: 0.6, z: 3.6 },
  { x: 0.6, z: 4.1, y: 0 },
  { x: -0.4, z: 4.1, y: 0 },
]
/** Every room through its doorway, ground floor then upstairs (starting from the hall / the landing). */
const GROUND_ROOMS = [
  { name: 'living room', route: [{ x: -0.5, z: 3.0 }, { x: -0.5, z: 2.0 }, { x: -2.2, z: 2.0 }, { x: -3.0, z: 2.4 }, { x: -4.6, z: 1.9 }] },
  { name: 'dining room (through the opening)', route: [{ x: -2.2, z: 1.9 }, { x: -2.0, z: 0.0 }, { x: -2.0, z: -1.6 }, { x: -2.6, z: -2.5 }] },
  { name: 'back hall from the dining room', route: [{ x: -2.4, z: -3.0 }, { x: -0.5, z: -3.0 }, { x: -0.5, z: -1.0 }] },
  { name: 'WC', route: [{ x: -0.5, z: -1.0 }, { x: 0.65, z: -1.0 }] },
  { name: 'kitchen', route: [{ x: -0.5, z: -1.0 }, { x: -0.5, z: -3.0 }, { x: 0.6, z: -3.0 }, { x: 2.0, z: -3.0 }, { x: 4.6, z: -3.0 }, { x: 4.6, z: -0.8 }] },
  { name: 'garage', route: [{ x: 5.0, z: -0.5 }, { x: 7.0, z: -0.5 }, { x: 9.2, z: -0.5 }] },
  { name: 'kitchen front door to the hall', route: [{ x: 7.0, z: -0.5 }, { x: 5.0, z: -0.5 }, { x: 2.2, z: 0.4 }, { x: 2.2, z: 3.0 }, { x: 2.0, z: 4.0 }, { x: 0.4, z: 4.0 }, { x: -0.5, z: 4.0 }] },
]
const UPPER_ROOMS = [
  { name: 'front bedroom', route: [{ x: -0.5, z: -0.9 }, { x: -0.5, z: 2.0 }, { x: -2.0, z: 2.0 }, { x: -3.4, z: 2.6 }] },
  { name: 'back bedroom', route: [{ x: -2.0, z: 2.0 }, { x: -0.5, z: 2.0 }, { x: -0.5, z: -2.5 }, { x: -2.0, z: -2.5 }, { x: -3.2, z: -2.4 }] },
  { name: 'bathroom', route: [{ x: -2.0, z: -2.5 }, { x: -0.5, z: -2.5 }, { x: -0.5, z: -3.0 }, { x: 0.6, z: -3.0 }, { x: 2.0, z: -3.0 }, { x: 3.6, z: -2.0 }] },
  { name: 'study (through the bathroom)', route: [{ x: 2.5, z: -2.0 }, { x: 2.5, z: -0.5 }, { x: 2.6, z: 0.2 }, { x: 3.6, z: 2.0 }] },
  { name: 'landing from the study', route: [{ x: 2.2, z: 2.6 }, { x: 2.0, z: 4.0 }, { x: 0.6, z: 4.0 }, { x: -0.5, z: 4.0 }] },
  { name: 'balcony', route: [{ x: 0, z: 4.0 }, { x: 0, z: 5.6 }] },
]

const started = Date.now()
for (const map of MAP_IDS)
  for (const team of [0, 1])
    for (const hero of HERO_IDS) {
      const tag = `${map} house ${team} (dir ${team ? -1 : 1}) ${hero}`
      const sim = makeSim(map, hero, team)
      const p = sim.players[0]
      const h = sim.houses[team]
      p.x = h.ox
      p.z = h.oz + 8 * h.dir
      p.y = 0
      const up = walk(sim, p, team, UP, 25)
      check(`${tag}: front door to the upper floor`, up === UP.length && Math.abs(p.y - FLOOR_H) < 0.1, `reached ${up}/${UP.length} at y ${p.y.toFixed(2)} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
      if (up !== UP.length) continue
      // Upstairs rooms (the dog and the kid too: nothing may block a doorway).
      for (const r of UPPER_ROOMS) {
        const n = walk(sim, p, team, r.route, 20)
        check(`${tag}: upstairs ${r.name}`, n === r.route.length && p.y > FLOOR_H - 0.1, `reached ${n}/${r.route.length} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`)
      }
      walk(sim, p, team, [{ x: 0, z: 4.0 }, { x: -0.5, z: 3.6 }, { x: -0.5, z: -0.9 }], 15)
      const down = walk(sim, p, team, DOWN, 25)
      check(`${tag}: back down the stairs`, down === DOWN.length && p.y < 0.2, `reached ${down}/${DOWN.length} at y ${p.y.toFixed(2)}`)
      for (const r of GROUND_ROOMS) {
        const n = walk(sim, p, team, r.route, 20)
        check(`${tag}: ground floor ${r.name}`, n === r.route.length && p.y < (hero === 'dog' || hero === 'kid' ? 1 : 0.3), `reached ${n}/${r.route.length} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`)
      }
    }

// Roof access: from the balcony, lean a ladder on the upper wall and climb onto the roof.
for (const map of MAP_IDS)
  for (const team of [0, 1]) {
    const sim = makeSim(map, 'dad', team)
    const p = sim.players[0]
    const h = sim.houses[team]
    p.x = h.ox + 1.2 * h.dir
    p.z = h.oz + 5.3 * h.dir
    p.y = FLOOR_H
    for (let i = 0; i < 10; i++) sim.step(1 / 60)
    const inp = emptyInput()
    inp.yaw = h.dir > 0 ? Math.PI : 0
    inp.ladder = true
    sim.setInput(p.id, inp)
    sim.step(1 / 60)
    const ladder = sim.ladders[sim.ladders.length - 1]
    check(`${map} house ${team}: a ladder from the balcony reaches the roof`, !!ladder && (ladder.top ?? 0) > ROOF_Y, ladder ? `top ${(ladder.top ?? 0).toFixed(2)}` : 'no ladder')
    const climb = emptyInput()
    climb.yaw = inp.yaw
    climb.mz = 1
    for (let t = 0; t < 8 && (p.onLadder || t < 0.5); t += 1 / 60) {
      sim.setInput(p.id, climb)
      sim.step(1 / 60)
    }
    for (let t = 0; t < 1; t += 1 / 60) {
      sim.setInput(p.id, emptyInput())
      sim.step(1 / 60)
    }
    check(`${map} house ${team}: climbs onto the roof and stands on it`, p.y > ROOF_Y && p.onGround && !p.onLadder, `y ${p.y.toFixed(2)} ground ${p.onGround}`)
    // Walk up the roof slope to the ridge.
    const y0 = p.y
    const up = emptyInput()
    up.yaw = inp.yaw
    up.mz = 1
    let top = y0
    for (let t = 0; t < 1.2; t += 1 / 60) {
      sim.setInput(p.id, up)
      sim.step(1 / 60)
      top = Math.max(top, p.y)
    }
    check(`${map} house ${team}: walks up the roof slope`, top > y0 + 1.2, `y ${y0.toFixed(2)} -> ${top.toFixed(2)}`)
  }

// Bots: a raider bot reaches an upstairs valuable of the enemy house through the nav graph (doors open in prep).
for (const map of MAP_IDS)
  for (const team of [0, 1]) {
    const sim = new Sim({ map, mode: 'destruction', seed: 3, roster: [{ name: 'Raider', hero: 'dad', team: 1 - team, human: false }, { name: 'Home', hero: 'dad', team, human: true }], prepSeconds: 600, raidSeconds: 600 })
    const bot = sim.players[0]
    const h = sim.houses[team]
    const target = h.valuables.find((v) => v.floor >= 1)!
    const path = sim.nav.find(h.ox, 0, h.oz + 8 * h.dir, target.x, target.y, target.z, [], 1 - team)
    const usesStairs = !!path && path.some((pt) => pt.link?.kind === 'stairs')
    check(`${map} house ${team}: nav path to the upstairs ${target.name} takes the stairs`, usesStairs, path ? `${path.length} points` : 'no path')
    // Follow that path with the bot's own body (deterministic walk, no combat).
    bot.bot = null
    bot.human = true
    bot.x = h.ox
    bot.z = h.oz + 8 * h.dir
    bot.y = 0
    let k = 0
    for (let t = 0; t < 40 && path && k < path.length; t += 1 / 60) {
      const wp = path[k]
      const d = Math.hypot(wp.x - bot.x, wp.z - bot.z)
      if (d < 0.3 && Math.abs(bot.y - wp.y) < 0.6) {
        k++
        continue
      }
      const inp = emptyInput()
      inp.yaw = Math.atan2(wp.x - bot.x, wp.z - bot.z)
      inp.mz = 1
      sim.setInput(bot.id, inp)
      sim.step(1 / 60)
    }
    const near = Math.hypot(bot.x - target.x, bot.z - target.z) < 1.6
    if (k < (path?.length ?? 0) - 1 && path && !near) console.log('  stuck near', JSON.stringify(path.slice(Math.max(0, k - 1), k + 2).map((q) => [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2)])), 'at', bot.x.toFixed(2), bot.y.toFixed(2), bot.z.toFixed(2))
    check(`${map} house ${team}: the raider walks the nav path upstairs to the ${target.name}`, !!path && (k >= path.length - 1 || near) && bot.y > FLOOR_H - 0.2, `reached ${k}/${path?.length ?? 0} at y ${bot.y.toFixed(2)}`)
  }

console.log(`${failures} failure(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
process.exitCode = failures ? 1 : 0
