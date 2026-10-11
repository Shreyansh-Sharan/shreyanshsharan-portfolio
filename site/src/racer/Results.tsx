// Results, Lights and the Combat Points series standings.
import { Play, RotateCcw, Star, Swords, Users } from 'lucide-react'
import { Page } from '../components/Page'
import { CONFIG } from './config'
import { fanLevel, type Save } from './save'
import type { RaceResult } from './game'

function Lights({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <div className="vr-lights" aria-label={`${n} of ${max} Lights`}>
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} size={22} className={i < n ? 'on' : ''} />
      ))}
    </div>
  )
}

function fmtTime(t: number | null) {
  if (t === null) return 'DNF'
  const m = Math.floor(t / 60)
  return `${m}:${(t % 60).toFixed(2).padStart(5, '0')}`
}

export function Results({
  r,
  save,
  series,
  onAgain,
  againLabel,
  onMenu,
  menuLabel = 'Menu',
  note,
}: {
  r: RaceResult
  save: Save
  series: Record<string, number>
  onAgain?: () => void
  againLabel?: string
  onMenu: () => void
  menuLabel?: string
  note?: string
}) {
  const lvl = fanLevel(save.fans)
  const last = r.mode === 'combat' && r.round + 1 >= CONFIG.combat_tracks
  const label = againLabel ?? (r.mode === 'combat' ? (last ? 'Series standings' : 'Next track') : r.mode === 'deathmatch' ? 'Play again' : 'Race again')
  const eyebrow =
    (r.online ? 'Online · ' : '') +
    (r.mode === 'race' ? 'Race result' : r.mode === 'deathmatch' ? 'Deathmatch result' : `Combat Points · track ${r.round + 1} of ${CONFIG.combat_tracks}`)
  return (
    <Page onBack={onMenu} backLabel={menuLabel} className="racer-page">
      <header className="page-header">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="page-title vr-title">
          {r.mode !== 'race' ? `#${r.place} on points` : r.place === 1 ? 'Winner' : `P${r.place}`} · {r.track}
        </h1>
      </header>
      <div className="vr-grid">
        <section className="arena-panel">
          <table className="vr-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Driver</th>
                <th>Car</th>
                <th>{r.mode === 'race' ? 'Time' : r.mode === 'deathmatch' ? 'Score' : 'Track CP'}</th>
                {r.mode === 'combat' && <th>Series</th>}
                <th>Wrecks</th>
                {r.mode === 'deathmatch' && <th>Damage</th>}
                {r.mode === 'deathmatch' && <th>Wrecked</th>}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.name} className={row.isPlayer ? 'is-player' : ''}>
                  <td>{row.place}</td>
                  <td>
                    <span className="dot" style={{ background: row.color }} /> {row.name}
                    {row.human && r.online && <Users size={12} className="vr-human" aria-label="Online player" />}
                  </td>
                  <td>{row.car}</td>
                  <td>{r.mode === 'race' ? fmtTime(row.time) : row.combat}</td>
                  {r.mode === 'combat' && <td>{series[row.name] ?? 0}</td>}
                  <td>{row.wrecks}</td>
                  {r.mode === 'deathmatch' && <td>{row.damage}</td>}
                  {r.mode === 'deathmatch' && <td>{row.wrecked}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="vr-actions">
            {onAgain && (
              <button className="btn btn-primary" onClick={onAgain}>
                {r.mode === 'combat' ? <Play size={16} /> : <RotateCcw size={16} />} {label}
              </button>
            )}
            <button className="btn" onClick={onMenu}>
              {menuLabel}
            </button>
          </div>
          {note && <p className="muted small">{note}</p>}
        </section>
        <section className="arena-panel arena-info">
          {r.mode === 'race' && (
            <>
              <h2 className="section-title">Lights</h2>
              <Lights n={r.lights.total} />
              <ul className="vr-lightlist">
                <li className={r.lights.position ? 'on' : ''}>Podium: {r.lights.position} of 3 (3rd = 1, 2nd = 2, 1st = 3)</li>
                <li className={r.lights.fanTarget ? 'on' : ''}>Fan Target: {CONFIG.fan_target_goal.toLocaleString()} fans {r.fanTargetMet ? '✓' : '✗'}</li>
                <li className={r.lights.fanRuns ? 'on' : ''}>
                  Fan Runs: {r.fanRunsDone}/{r.fanRunsTotal} completed
                </li>
              </ul>
            </>
          )}
          <h2 className="section-title">Fan Points</h2>
          <p>
            <strong>+{r.fans.toLocaleString()}</strong> this race · {save.fans.toLocaleString()} total
          </p>
          <div className="vr-levelrow">
            <span>Fan Level {lvl.level}</span>
            <div className="vr-level">
              <i style={{ width: `${lvl.progress * 100}%` }} />
            </div>
          </div>
          <h2 className="section-title">Awards</h2>
          <ul className="vr-awards">
            {r.awards.map((a) => (
              <li key={a.title}>
                <strong>{a.title}</strong> {a.name} <span className="muted small">{a.value}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Page>
  )
}

export function Standings({ series, save, onMenu, onAgain }: { series: Record<string, number>; save: Save; onMenu: () => void; onAgain: () => void }) {
  const ranking = Object.entries(series).sort((a, b) => b[1] - a[1])
  const won = ranking[0]?.[0] === 'You'
  const mine = series['You'] ?? 0
  return (
    <Page onBack={onMenu} backLabel="Menu" className="racer-page">
      <header className="page-header">
        <p className="eyebrow">Combat Points · series complete</p>
        <h1 className="page-title vr-title">{won ? 'Series won' : `Series: P${ranking.findIndex(([n]) => n === 'You') + 1}`}</h1>
        <p className="page-lead">
          {won ? `3 Lights and ${Math.round(mine / 2).toLocaleString()} Fan Points (Combat Points ÷ 2).` : 'Win the series for 3 Lights and Fan Points equal to half your Combat Points.'}
        </p>
      </header>
      <section className="arena-panel">
        {won && <Lights n={3} max={3} />}
        <table className="vr-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Driver</th>
              <th>Combat Points</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map(([name, pts], i) => (
              <tr key={name} className={name === 'You' ? 'is-player' : ''}>
                <td>{i + 1}</td>
                <td>{name}</td>
                <td>{pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Total fans: {save.fans.toLocaleString()} · Series wins: {save.seriesWins}</p>
        <div className="vr-actions">
          <button className="btn btn-primary" onClick={onAgain}>
            <Swords size={16} /> New series
          </button>
          <button className="btn" onClick={onMenu}>
            Menu
          </button>
        </div>
      </section>
    </Page>
  )
}
