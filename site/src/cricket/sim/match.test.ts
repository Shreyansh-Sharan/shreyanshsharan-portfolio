// Offline match test (a port of the original MatchSim harness): runs the real match director CPU v CPU headless at
// 60 steps per simulated second and reports scores, how wickets fell, boundaries, extras and any phase that gets stuck.
// Run: node src/cricket/sim/match.test.ts [t20|t10|blitz|super] [matches]
declare const process: { argv: string[]; exitCode?: number }
import { Director, type EvType, type Phase } from './director.ts'
import { builtInTeams, cloneTeam, surname } from './teams.ts'
import { scoreText, type MatchFormat } from './match.ts'
import type { PitchType, TimeOfDay } from './conditions.ts'

const args = process.argv.slice(2)
const format = (args[0] as MatchFormat) || 't10'
const matches = Number(args[1] ?? 3)
let failures = 0
const totals: Record<string, number> = {}
const started = Date.now()

for (let m = 0; m < matches; m++) {
  const pitch = (['green', 'flat', 'dusty'] as PitchType[])[m % 3]
  const time = (['day', 'dusk', 'night'] as TimeOfDay[])[m % 3]
  const teams = builtInTeams()
  const d = new Director(
    {
      format,
      difficulty: ((m + 1) % 3) as 0 | 1 | 2,
      pitch,
      time,
      superOverOnTie: true,
      seed: 1000 + m * 17,
      teams: [cloneTeam(teams[m % teams.length]), cloneTeam(teams[(m + 3) % teams.length])],
      online: false,
    },
    { sideHuman: [false, false] },
  )
  const counts: Record<string, number> = {}
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
  const dt = 1 / 60
  let last: Phase = d.phase
  let inPhase = 0
  let sim = 0
  let stuck: string | null = null
  try {
    for (let f = 0; f < 60 * 60 * 60 * 3; f++) {
      d.update(dt)
      sim += dt
      for (const e of d.drainEvents()) {
        const map: Partial<Record<EvType, string>> = { four: '4s', six: '6s', wide: 'wides', noball: 'no-balls', drop: 'drops', catch: 'catches', reviewstart: 'reviews', appeal: 'appeals', edge: 'edges', beaten: 'beaten', directhit: 'direct hits', throw: 'throws', release: 'deliveries', dive: 'dives', stumps: 'stumps broken' }
        if (e.type === 'wicket') count('W:' + e.text)
        else if (e.type === 'reviewresult') count('review:' + ['overturned', 'stands', 'umpirescall'][e.i ?? 0])
        else if (e.type === 'bathit') count('timing:' + ['noshot', 'veryearly', 'early', 'perfect', 'late', 'verylate'][e.i ?? 0])
        else if (map[e.type]) count(map[e.type]!)
      }
      if (d.phase !== last) {
        last = d.phase
        inPhase = 0
      } else inPhase += dt
      if (d.phase === 'end') break
      if (inPhase > 60) {
        stuck = `stuck in ${d.phase} for 60 s (live ${d.liveTime.toFixed(1)} s, ball ${d.ball.pos} v ${d.ball.vel} held ${!!d.heldBy}, running ${d.anyRunning})`
        break
      }
    }
    if (d.phase !== 'end' && !stuck) stuck = `did not finish (phase ${d.phase})`
  } catch (e) {
    stuck = 'EXCEPTION ' + ((e as Error).stack ?? e)
  }
  const st = d.state
  console.log(`=== Match ${m + 1}: ${st.setup.teams[0].name} v ${st.setup.teams[1].name} — ${format}, ${pitch} pitch, ${time}, difficulty ${st.setup.difficulty} (${Math.round(sim / 60)} sim min)`)
  for (const inn of st.innings) {
    const team = st.setup.teams[inn.battingTeam]
    const bowl = st.setup.teams[1 - inn.battingTeam]
    const top = inn.batting.filter((c) => c.batted).sort((a, b) => b.runs - a.runs)[0]
    const best = inn.bowling.filter((b) => b.balls > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0]
    console.log(
      `   ${inn.superOver ? 'SO ' : ''}${team.short} ${scoreText(inn)} (${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6} ov, extras ${inn.byes + inn.legByes + inn.wides + inn.noBalls})  top: ${top ? `${surname(team.players[top.player])} ${top.runs}(${top.balls})` : '-'}  best: ${best ? `${surname(bowl.players[best.player])} ${best.wickets}-${best.runs}` : '-'}`,
    )
  }
  console.log(`   Result: ${st.result || '(none)'}`)
  const dist = [0, 0, 0, 0, 0, 0, 0]
  for (const inn of st.innings) for (const b of inn.log) if (b.extra === 'none' || b.extra === 'noball') dist[Math.min(6, b.runs)]++
  console.log(`   runs off the bat per ball: dots ${dist[0]}, 1s ${dist[1]}, 2s ${dist[2]}, 3s ${dist[3]}, 4s ${dist[4]}, 6s ${dist[6]}`)
  console.log('   ' + Object.keys(counts).sort().map((k) => `${k} ${counts[k]}`).join(', '))
  for (const k of Object.keys(counts)) totals[k] = (totals[k] ?? 0) + counts[k]
  if (stuck) {
    failures++
    console.log('   PROBLEM: ' + stuck)
  }
}
console.log(`\n${failures === 0 ? 'All matches completed.' : `${failures} match(es) had problems.`} (${((Date.now() - started) / 1000).toFixed(1)} s)`)
process.exitCode = failures === 0 ? 0 : 1
