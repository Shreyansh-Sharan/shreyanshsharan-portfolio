// Scorecard overlay: batting and bowling cards, fall of wickets, a wagon wheel and the worm (runs by over).
import { useMemo, useState } from 'react'
import type { MatchState, Innings } from '../sim/match'
import { extrasOf, oversText, scoreText } from '../sim/match'

type Tab = 'card' | 'wagon' | 'worm'

export function Scorecard({ state, onClose, initialInnings }: { state: MatchState; onClose?: () => void; initialInnings?: number }) {
  const [tab, setTab] = useState<Tab>('card')
  const [which, setWhich] = useState(initialInnings ?? Math.max(0, state.innings.length - 1))
  const inn = state.innings[which]
  if (!inn) return null
  const bat = state.setup.teams[inn.battingTeam]
  const bowl = state.setup.teams[1 - inn.battingTeam]
  return (
    <div className="ck-card" role="dialog" aria-label="Scorecard">
      <div className="ck-card-head">
        <div className="ck-tabs">
          {state.innings.map((i, k) => (
            <button key={k} className={`ck-tab ${k === which ? 'is-on' : ''}`} onClick={() => setWhich(k)}>
              {i.superOver ? 'SO ' : ''}
              {state.setup.teams[i.battingTeam].short} {scoreText(i)}
            </button>
          ))}
        </div>
        <div className="ck-tabs">
          {(['card', 'wagon', 'worm'] as Tab[]).map((t) => (
            <button key={t} className={`ck-tab ${tab === t ? 'is-on' : ''}`} onClick={() => setTab(t)}>
              {t === 'card' ? 'Scorecard' : t === 'wagon' ? 'Wagon wheel' : 'Run rate'}
            </button>
          ))}
          {onClose && (
            <button className="ck-tab" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
      </div>
      {tab === 'card' && (
        <div className="ck-card-body">
          <table className="ck-table">
            <thead>
              <tr>
                <th>{bat.name}</th>
                <th />
                <th>R</th>
                <th>B</th>
                <th>4s</th>
                <th>6s</th>
                <th>SR</th>
              </tr>
            </thead>
            <tbody>
              {inn.batting
                .filter((c) => c.batted)
                .map((c) => (
                  <tr key={c.player} className={!c.out ? 'is-in' : ''}>
                    <td>
                      {bat.players[c.player].name}
                      {c.player === bat.captain ? ' (c)' : ''}
                      {c.player === bat.keeper ? ' †' : ''}
                    </td>
                    <td className="muted ck-how">{state.dismissalText(inn, c)}</td>
                    <td>
                      <strong>{c.runs}</strong>
                    </td>
                    <td>{c.balls}</td>
                    <td>{c.fours}</td>
                    <td>{c.sixes}</td>
                    <td>{c.balls ? ((c.runs * 100) / c.balls).toFixed(0) : '-'}</td>
                  </tr>
                ))}
              <tr>
                <td>Extras</td>
                <td className="muted ck-how">
                  b {inn.byes}, lb {inn.legByes}, w {inn.wides}, nb {inn.noBalls}
                </td>
                <td>{extrasOf(inn)}</td>
                <td colSpan={4} />
              </tr>
              <tr className="ck-total">
                <td>Total</td>
                <td className="muted ck-how">{oversText(inn.legalBalls)} overs</td>
                <td colSpan={5}>
                  <strong>{scoreText(inn)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          {inn.fow.length > 0 && (
            <p className="ck-fow">
              <span className="muted">Fall of wickets: </span>
              {inn.fow.map((f) => `${f.runs}-${f.wicket} (${bat.players[f.player].name.split(' ').pop()}, ${f.overs})`).join(' · ')}
            </p>
          )}
          <table className="ck-table">
            <thead>
              <tr>
                <th>{bowl.name}</th>
                <th>O</th>
                <th>M</th>
                <th>R</th>
                <th>W</th>
                <th>Econ</th>
                <th>Dots</th>
              </tr>
            </thead>
            <tbody>
              {inn.bowling
                .filter((b) => b.balls > 0 || b.runs > 0)
                .map((b) => (
                  <tr key={b.player}>
                    <td>{bowl.players[b.player].name}</td>
                    <td>{oversText(b.balls)}</td>
                    <td>{b.maidens}</td>
                    <td>{b.runs}</td>
                    <td>
                      <strong>{b.wickets}</strong>
                    </td>
                    <td>{b.balls ? ((b.runs * 6) / b.balls).toFixed(2) : '-'}</td>
                    <td>{b.dots}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'wagon' && <WagonWheel inn={inn} />}
      {tab === 'worm' && <Worm state={state} />}
    </div>
  )
}

/** Where every scoring shot went, drawn from the striker's end (off side to the right for a right-hander). */
export function WagonWheel({ inn }: { inn: Innings }) {
  const lines = useMemo(
    () =>
      inn.log
        .filter((b) => b.runs > 0 && (b.extra === 'none' || b.extra === 'noball'))
        .map((b, i) => {
          // Put the striker's stumps at the centre, and rotate so straight is up; mirror for left-handers.
          const zs = b.strikerEnd === 0 ? -10.06 : 10.06
          const dz = (b.end[2] - zs) * (b.strikerEnd === 0 ? 1 : -1)
          let dx = b.end[0] * (b.strikerEnd === 0 ? 1 : -1)
          if (b.leftHand) dx = -dx
          const r = Math.min(1, Math.hypot(dx, dz) / 75)
          const a = Math.atan2(dx, dz)
          return { key: i, x: Math.sin(a) * r * 100, y: -Math.cos(a) * r * 100, runs: b.runs }
        }),
    [inn],
  )
  const color = (r: number) => (r >= 6 ? '#e879f9' : r >= 4 ? '#facc15' : r >= 2 ? '#38bdf8' : '#e2e8f0')
  return (
    <div className="ck-card-body ck-wagon">
      <svg viewBox="-110 -110 220 220" width="320" height="320" aria-label="Wagon wheel">
        <ellipse cx="0" cy="0" rx="100" ry="100" fill="#14532d" stroke="#f8fafc" strokeOpacity="0.6" />
        <circle cx="0" cy="0" r="40" fill="none" stroke="#f8fafc" strokeOpacity="0.25" strokeDasharray="3 3" />
        <rect x="-3" y="-15" width="6" height="30" fill="#d6c08a" />
        {lines.map((l) => (
          <line key={l.key} x1="0" y1="0" x2={l.x} y2={l.y} stroke={color(l.runs)} strokeWidth={l.runs >= 4 ? 1.6 : 1} strokeOpacity="0.9" />
        ))}
        <text x="0" y="-102" textAnchor="middle" fontSize="8" fill="#cbd5e1">
          straight
        </text>
        <text x="96" y="3" textAnchor="end" fontSize="8" fill="#cbd5e1">
          off
        </text>
        <text x="-96" y="3" fontSize="8" fill="#cbd5e1">
          leg
        </text>
      </svg>
      <ul className="ck-legend">
        <li style={{ color: '#e2e8f0' }}>1s</li>
        <li style={{ color: '#38bdf8' }}>2s & 3s</li>
        <li style={{ color: '#facc15' }}>4s</li>
        <li style={{ color: '#e879f9' }}>6s</li>
      </ul>
    </div>
  )
}

/** Runs per over (bars) and the cumulative worm for each innings, wickets marked. */
export function Worm({ state }: { state: MatchState }) {
  const series = state.innings
    .filter((i) => !i.superOver)
    .map((inn) => {
      const overs: number[] = []
      const wk: number[] = []
      for (const b of inn.log) {
        overs[b.over] = (overs[b.over] ?? 0) + b.runs + b.extras
        if (b.wicket) wk.push(b.over)
      }
      return { inn, overs: Array.from({ length: Math.max(overs.length, 1) }, (_, i) => overs[i] ?? 0), wk, color: state.setup.teams[inn.battingTeam].primary }
    })
  const maxOvers = state.rules.overs
  const maxTotal = Math.max(20, ...series.map((s) => s.overs.reduce((a, b) => a + b, 0)))
  const W = 360
  const H = 200
  const x = (o: number) => 30 + (o / maxOvers) * (W - 40)
  const y = (r: number) => H - 20 - (r / maxTotal) * (H - 40)
  return (
    <div className="ck-card-body">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="220" aria-label="Run rate worm">
        <line x1="30" y1={H - 20} x2={W - 10} y2={H - 20} stroke="#64748b" />
        <line x1="30" y1="10" x2="30" y2={H - 20} stroke="#64748b" />
        {series.map((s, k) => {
          let acc = 0
          const pts = [`${x(0)},${y(0)}`, ...s.overs.map((r, i) => `${x(i + 1)},${y((acc += r))}`)]
          return (
            <g key={k}>
              {s.overs.map((r, i) => (
                <rect key={i} x={x(i) + 2 + k * 5} y={H - 20 - (r / 30) * 60} width={4} height={(r / 30) * 60} fill={s.color} opacity="0.45" />
              ))}
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2.2" />
              {s.wk.map((o, i) => {
                const cum = s.overs.slice(0, o + 1).reduce((a, b) => a + b, 0)
                return <circle key={i} cx={x(o + 1)} cy={y(cum)} r="3" fill="#f8fafc" stroke={s.color} />
              })}
            </g>
          )
        })}
        {Array.from({ length: maxOvers + 1 }, (_, i) => i)
          .filter((i) => i % Math.max(1, Math.round(maxOvers / 10)) === 0)
          .map((i) => (
            <text key={i} x={x(i)} y={H - 6} fontSize="9" fill="#94a3b8" textAnchor="middle">
              {i}
            </text>
          ))}
      </svg>
      <ul className="ck-legend">
        {series.map((s, k) => (
          <li key={k} style={{ color: s.color }}>
            {state.setup.teams[s.inn.battingTeam].name}: {scoreText(s.inn)} · partnership now {s.inn.partnershipRuns}
          </li>
        ))}
      </ul>
    </div>
  )
}
