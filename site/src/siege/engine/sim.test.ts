// Offline bot-only matches: every mode on every map, at 60 steps per simulated second. Reports the result, how
// long it took, kills, damage, supers used and whether anything got stuck.
// Run: node src/siege/engine/sim.test.ts [matches-per-mode]
declare const process: { argv: string[]; exitCode?: number }
import { HERO_IDS } from './heroes.ts'
import { ARENA_MAPS } from './maps.ts'
import { Sim, type ModeId, type RosterEntry } from './sim.ts'

const per = Number(process.argv[2] ?? 2)
let failures = 0
const started = Date.now()

function roster(mode: ModeId, seed: number): RosterEntry[] {
  const out: RosterEntry[] = []
  if (mode === 'br') {
    for (let i = 0; i < 17; i++) out.push({ name: `Bot ${i + 1}`, hero: HERO_IDS[(i + seed) % HERO_IDS.length], team: i, human: false })
  } else {
    for (let i = 0; i < 6; i++) out.push({ name: `Bot ${i + 1}`, hero: HERO_IDS[(i + seed) % HERO_IDS.length], team: i < 3 ? 0 : 1, human: false })
  }
  return out
}

for (const mode of ['tdm', 'capture', 'br'] as ModeId[]) {
  const maps = mode === 'br' ? ['sector' as const] : ARENA_MAPS
  for (const map of maps) {
    for (let m = 0; m < per; m++) {
      const seed = 1000 + m * 17 + map.length
      const sim = new Sim({ map, mode, seed, roster: roster(mode, m) })
      const counts = { kills: 0, supers: 0, dashes: 0, crates: 0, pickups: 0, grids: 0 }
      let steps = 0
      const maxSteps = 60 * 420
      const t0 = Date.now()
      let lastEventAt = 0
      let stuck = ''
      while (sim.phase !== 'over' && steps < maxSteps) {
        sim.step(1 / 60)
        steps++
        for (const e of sim.events) {
          if (e.t === 'death') counts.kills++
          if (e.t === 'super') counts.supers++
          if (e.t === 'dash') counts.dashes++
          if (e.t === 'explode' && e.kind === 'crate') counts.crates++
          if (e.t === 'pickup') counts.pickups++
          if (e.t === 'grid') counts.grids++
          if (e.t === 'death' || e.t === 'hit' || e.t === 'score') lastEventAt = sim.time
        }
        if (sim.phase === 'play' && sim.time - lastEventAt > 45 && !stuck) stuck = `no hits for 45 s at t=${sim.time.toFixed(0)}`
      }
      const ms = Date.now() - t0
      const alive = sim.fighters.filter((f) => f.alive).length
      const line =
        `${mode.padEnd(7)} ${map.padEnd(9)} seed ${seed}: ${sim.phase === 'over' ? 'ended' : 'TIMEOUT'} at ${sim.time.toFixed(0)} s, ` +
        (mode === 'br' ? `alive ${alive}, winner #${sim.winner} ${sim.fighter(sim.winner)?.hero.id ?? '-'}, grid stage ${sim.br?.stage}` : `score ${sim.score[0]}-${sim.score[1]}, winner team ${sim.winner}`) +
        `, kills ${counts.kills}, supers ${counts.supers}, dashes ${counts.dashes}, crates ${counts.crates}, loot ${counts.pickups}` +
        ` (${ms} ms real, ${(steps / 60 / (ms / 1000)).toFixed(0)}x realtime)` +
        (stuck ? ` STUCK: ${stuck}` : '')
      console.log(line)
      if (sim.phase !== 'over') failures++
      if (mode === 'br' && alive > 1) failures++
      if (counts.kills === 0) failures++
      if (counts.supers === 0) failures++
      if (mode === 'br' && counts.pickups === 0) failures++
      // Per-hero sanity: nobody has negative hp or sits outside the map.
      for (const f of sim.fighters) {
        if (f.x < 0 || f.z < 0 || f.x > sim.w * 2 || f.z > sim.h * 2) {
          console.log(`  OUT OF MAP: ${f.name} ${f.hero.id} at ${f.x.toFixed(1)},${f.z.toFixed(1)}`)
          failures++
        }
        if (sim.cellAt(f.x, f.z) !== 'floor') {
          console.log(`  IN A WALL: ${f.name} ${f.hero.id} at ${f.x.toFixed(1)},${f.z.toFixed(1)} (${sim.cellAt(f.x, f.z)})`)
          failures++
        }
      }
    }
  }
}

// Hero balance: every hero against every other in a 1v1 box, both bots.
const wins: Record<string, number> = {}
for (const a of HERO_IDS)
  for (const b of HERO_IDS) {
    if (a === b) continue
    for (let s = 0; s < 3; s++) {
      const sim = new Sim({ map: 'kessho', mode: 'tdm', seed: 7 + s, roster: [{ name: 'A', hero: a, team: 0, human: false }, { name: 'B', hero: b, team: 1, human: false }], target: 3, timeLimit: 120 })
      let steps = 0
      while (sim.phase !== 'over' && steps++ < 60 * 160) sim.step(1 / 60)
      const w = sim.winner === 0 ? a : sim.winner === 1 ? b : null
      if (w) wins[w] = (wins[w] ?? 0) + 1
    }
  }
console.log('1v1 wins per hero (of 30):', HERO_IDS.map((h) => `${h} ${wins[h] ?? 0}`).join(', '))

console.log(`${failures} failure(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
process.exitCode = failures ? 1 : 0
