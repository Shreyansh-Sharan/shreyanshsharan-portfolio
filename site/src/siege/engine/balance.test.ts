// Side and squad balance: the same two squads play from both spawn sides, and random squads play each other.
// Run: node src/siege/engine/balance.test.ts
declare const process: { argv: string[]; exitCode?: number }
import { HERO_IDS, type HeroId } from './heroes.ts'
import { ARENA_MAPS } from './maps.ts'
import { Rng } from './rng.ts'
import { Sim, type RosterEntry } from './sim.ts'

function play(map: (typeof ARENA_MAPS)[number], seed: number, a: HeroId[], b: HeroId[]) {
  const roster: RosterEntry[] = []
  a.forEach((h, i) => roster.push({ name: `A${i}`, hero: h, team: 0, human: false }))
  b.forEach((h, i) => roster.push({ name: `B${i}`, hero: h, team: 1, human: false }))
  const sim = new Sim({ map, mode: 'tdm', seed, roster })
  let steps = 0
  while (sim.phase !== 'over' && steps++ < 60 * 400) sim.step(1 / 60)
  return sim.winner
}

const rng = new Rng(99)
let sideA = 0
let sideB = 0
let n = 0
for (let m = 0; m < 12; m++) {
  const map = ARENA_MAPS[m % ARENA_MAPS.length]
  const squadA = [0, 1, 2].map(() => HERO_IDS[rng.int(HERO_IDS.length)])
  const squadB = [0, 1, 2].map(() => HERO_IDS[rng.int(HERO_IDS.length)])
  const w1 = play(map, 500 + m, squadA, squadB)
  const w2 = play(map, 500 + m, squadB, squadA)
  if (w1 === 0) sideA++
  if (w1 === 1) sideB++
  if (w2 === 0) sideA++
  if (w2 === 1) sideB++
  n += 2
  console.log(`${map.padEnd(9)} ${squadA.join('/')} vs ${squadB.join('/')}: winner side ${w1}, swapped sides winner ${w2}`)
}
console.log(`side A won ${sideA}/${n}, side B won ${sideB}/${n}`)
process.exitCode = Math.abs(sideA - sideB) > n * 0.4 ? 1 : 0
