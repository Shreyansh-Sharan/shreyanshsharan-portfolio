// Offline bot-only matches: every mode on both streets at 60 steps per simulated second. Reports how each match
// ended, scores, knockouts, valuables broken, traps placed and tripped, ladders, ultimates, and anything stuck.
// Run: node src/lawn/engine/sim.test.ts [matches-per-mode]
declare const process: { argv: string[]; exitCode?: number }
import { HERO_IDS } from './heroes.ts'
import { MAP_IDS } from './maps.ts'
import { Sim, type ModeId, type RosterEntry } from './sim.ts'

const per = Number(process.argv[2] ?? 1)
let failures = 0
const started = Date.now()

function roster(mode: ModeId, seed: number): RosterEntry[] {
  const out: RosterEntry[] = []
  const n = mode === 'robots' ? 4 : 8
  for (let i = 0; i < n; i++) out.push({ name: `Bot ${i + 1}`, hero: HERO_IDS[(i + seed) % HERO_IDS.length], team: mode === 'robots' ? 0 : i < 4 ? 0 : 1, human: false, perks: i % 3 })
  return out
}

for (const mode of ['destruction', 'brawl', 'robots'] as ModeId[]) {
  for (const map of MAP_IDS) {
    for (let m = 0; m < per; m++) {
      const seed = 2000 + m * 31 + map.length
      const sim = new Sim({ map, mode, seed, roster: roster(mode, m), prepSeconds: mode === 'brawl' ? 0 : 30, raidSeconds: mode === 'destruction' ? 420 : mode === 'brawl' ? 240 : 600, waves: 6 })
      const c = { ko: 0, breaks: 0, valuables: 0, traps: 0, trips: 0, ladders: 0, ults: 0, throws: 0, barricades: 0, parries: 0, chaos: 0, waves: 0 }
      let steps = 0
      const maxSteps = 60 * 700
      const t0 = Date.now()
      let lastEventAt = 0
      let stuck = ''
      while (sim.phase !== 'over' && steps < maxSteps) {
        sim.step(1 / 60)
        steps++
        for (const e of sim.events) {
          if (e.t === 'ko') c.ko++
          if (e.t === 'break') {
            c.breaks++
            if (e.model.startsWith('valuable')) c.valuables++
          }
          if (e.t === 'trap') c.traps++
          if (e.t === 'trip') c.trips++
          if (e.t === 'ladder') c.ladders++
          if (e.t === 'ult') c.ults++
          if (e.t === 'throw') c.throws++
          if (e.t === 'barricade') c.barricades++
          if (e.t === 'parry') c.parries++
          if (e.t === 'chaos' && e.on) c.chaos++
          if (e.t === 'wave') c.waves++
          if (e.t === 'ko' || e.t === 'hit' || e.t === 'break') lastEventAt = sim.time
        }
        if (sim.phase === 'play' && sim.time - lastEventAt > 60 && !stuck) stuck = `no hits for 60 s at t=${sim.time.toFixed(0)}`
      }
      const ms = Date.now() - t0
      const line =
        `${mode.padEnd(12)} ${map.padEnd(9)} seed ${seed}: ${sim.phase === 'over' ? 'ended' : 'TIMEOUT'} at ${sim.time.toFixed(0)} s, ` +
        `score ${sim.score[0]}-${sim.score[1]}, winner ${sim.winner}, valuables left ${sim.valuablesLeft(0)}/${sim.valuablesLeft(1)}, ` +
        `KOs ${c.ko}, breaks ${c.breaks} (${c.valuables} valuables), traps ${c.traps}/${c.trips} tripped, barricades ${c.barricades}, ladders ${c.ladders}, ` +
        `ults ${c.ults}, throws ${c.throws}, parries ${c.parries}, chaos ${c.chaos}, waves ${c.waves} (${ms} ms, ${(steps / 60 / (ms / 1000)).toFixed(0)}x realtime)` +
        (stuck ? ` STUCK: ${stuck}` : '')
      console.log(line)
      if (sim.phase !== 'over') failures++
      if (c.ko === 0) failures++
      if (mode === 'destruction' && c.valuables === 0) failures++
      if (mode === 'destruction' && c.traps === 0) failures++
      if (mode === 'destruction' && c.barricades === 0) failures++
      if (c.ults === 0) failures++
      if (mode === 'robots' && c.waves === 0) failures++
      for (const f of sim.players) {
        if (f.x < 0 || f.z < 0 || f.x > sim.world.map.w || f.z > sim.world.map.h || f.y < -0.5 || f.y > 12) {
          console.log(`  OUT OF MAP: ${f.name} ${f.hero.id} at ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)}`)
          failures++
        }
      }
    }
  }
}

// 1v1 melee balance: every hero against every other on the street, bots only.
const wins: Record<string, number> = {}
for (const a of HERO_IDS)
  for (const b of HERO_IDS) {
    if (a === b) continue
    for (let s = 0; s < 2; s++) {
      const sim = new Sim({ map: 'culdesac', mode: 'brawl', seed: 11 + s, roster: [{ name: 'A', hero: a, team: 0, human: false }, { name: 'B', hero: b, team: 1, human: false }], brawlTarget: 3, raidSeconds: 150 })
      let steps = 0
      while (sim.phase !== 'over' && steps++ < 60 * 170) sim.step(1 / 60)
      const w = sim.winner === 0 ? a : sim.winner === 1 ? b : null
      if (w) wins[w] = (wins[w] ?? 0) + 1
    }
  }
console.log('1v1 wins per hero (of 20):', HERO_IDS.map((h) => `${h} ${wins[h] ?? 0}`).join(', '))

console.log(`${failures} failure(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
process.exitCode = failures ? 1 : 0
