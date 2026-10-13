// Balance checks.
//  side:   the same two squads play from both spawn sides, and random squads play each other.
//  matrix: every hero against every other in 1v1 bot duels (first to 3) on all three arenas, from both sides,
//          printed as a win-rate matrix. Each hero's overall rate must sit within 35-65%, and every counter in the
//          web (MATCHUPS in powers.ts) must favour the counter.
// Run: node src/siege/engine/balance.test.ts [side|matrix|all] [seeds per map, default 6]
declare const process: { argv: string[]; exitCode?: number }
import { HERO_IDS, HEROES, type HeroId } from './heroes.ts'
import { ARENA_MAPS, type MapId } from './maps.ts'
import { MATCHUPS } from './powers.ts'
import { Rng } from './rng.ts'
import { Sim, type RosterEntry } from './sim.ts'

const which = process.argv[2] ?? 'all'
const seeds = Number(process.argv[3] ?? 6)
let failures = 0

function play(map: MapId, seed: number, a: HeroId[], b: HeroId[]) {
  const roster: RosterEntry[] = []
  a.forEach((h, i) => roster.push({ name: `A${i}`, hero: h, team: 0, human: false }))
  b.forEach((h, i) => roster.push({ name: `B${i}`, hero: h, team: 1, human: false }))
  const sim = new Sim({ map, mode: 'tdm', seed, roster })
  let steps = 0
  while (sim.phase !== 'over' && steps++ < 60 * 400) sim.step(1 / 60)
  return sim.winner
}

if (which === 'side' || which === 'all') {
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
  if (Math.abs(sideA - sideB) > n * 0.4) failures++
}

/** One 1v1: 1 if `a` wins, 0 if `b` wins, 0.5 for a draw. */
function duel(a: HeroId, b: HeroId, map: MapId, seed: number, aFirst: boolean) {
  const ra: RosterEntry = { name: 'A', hero: a, team: aFirst ? 0 : 1, human: false }
  const rb: RosterEntry = { name: 'B', hero: b, team: aFirst ? 1 : 0, human: false }
  const sim = new Sim({ map, mode: 'tdm', seed, roster: aFirst ? [ra, rb] : [rb, ra], target: 3, timeLimit: 120 })
  let steps = 0
  while (sim.phase !== 'over' && steps++ < 60 * 160) sim.step(1 / 60)
  if (sim.winner === ra.team) return 1
  if (sim.winner === rb.team) return 0
  return 0.5
}

if (which === 'matrix' || which === 'all') {
  const t0 = Date.now()
  const rate: Record<string, number> = {}
  const games: Record<string, number> = {}
  const total: Record<string, { w: number; n: number }> = {}
  for (const h of HERO_IDS) total[h] = { w: 0, n: 0 }
  for (let i = 0; i < HERO_IDS.length; i++)
    for (let j = i + 1; j < HERO_IDS.length; j++) {
      const a = HERO_IDS[i]
      const b = HERO_IDS[j]
      let w = 0
      let n = 0
      for (const map of ARENA_MAPS)
        for (let s = 0; s < seeds; s++)
          for (const aFirst of [true, false]) {
            w += duel(a, b, map, 31 + s * 7 + i * 101 + j * 13, aFirst)
            n++
          }
      rate[`${a}>${b}`] = w / n
      rate[`${b}>${a}`] = 1 - w / n
      games[`${a}>${b}`] = games[`${b}>${a}`] = n
      total[a].w += w
      total[a].n += n
      total[b].w += n - w
      total[b].n += n
    }
  const counters = new Set<string>()
  for (const h of HERO_IDS) for (const m of MATCHUPS[h]) counters.add(`${h}>${m.beats}`)
  const pct = (v: number) => `${Math.round(v * 100)}`.padStart(3)
  console.log(`\n1v1 win rate of the row hero against the column hero (${games[`${HERO_IDS[0]}>${HERO_IDS[1]}`]} duels per pair; * = row counters column):`)
  console.log('         ' + HERO_IDS.map((h) => HEROES[h].name.padStart(8)).join(''))
  for (const a of HERO_IDS) {
    let line = HEROES[a].name.padEnd(9)
    for (const b of HERO_IDS) line += a === b ? '       -' : `   ${pct(rate[`${a}>${b}`])}%${counters.has(`${a}>${b}`) ? '*' : ' '}`
    line += `   overall ${pct(total[a].w / total[a].n)}%`
    console.log(line)
  }
  console.log('\nCounter edges:')
  for (const key of counters) {
    const [a, b] = key.split('>') as HeroId[]
    const r = rate[key]
    const ok = r > 0.5
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${HEROES[a].name.padEnd(8)} beats ${HEROES[b].name.padEnd(8)} ${pct(r)}%`)
    if (!ok) failures++
  }
  for (const h of HERO_IDS) {
    const r = total[h].w / total[h].n
    if (r < 0.35 || r > 0.65) {
      console.log(`  FAIL ${HEROES[h].name} overall ${pct(r)}% is outside 35-65%`)
      failures++
    }
  }
  console.log(`matrix: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

console.log(`${failures} failure(s)`)
process.exitCode = failures ? 1 : 0
