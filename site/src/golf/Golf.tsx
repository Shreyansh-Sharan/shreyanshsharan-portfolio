// BOGEY BRAWL page: menu, the running hole (canvas + HUD) and the results table.
import { useEffect, useRef, useState } from 'react'
import { Crosshair, Flag, LogOut, Magnet, Play, Rocket, RotateCcw, Shield, Trophy } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { setInputSuspended } from '../lib/input'
import { play as uiSound } from '../lib/sound'
import { Page } from '../components/Page'
import { CONFIG } from './config'
import { HOLE } from './course'
import { loadGolfAssets, type GolfAssets } from './assets'
import type { ItemType } from './golfer'
import type { Game, HoleResult, Hud } from './game'

const accent = tiles.find((t) => t.id === 'bogey-brawl')?.accent ?? (['#14532d', '#bef264'] as [string, string])

const ITEMS: Record<string, { name: string; color: string; icon: typeof Rocket; help: string }> = {
  rocket: { name: 'Rocket Launcher', color: '#f97316', icon: Rocket, help: 'Homes in on the rival closest to your aim. Big knockback, and it can launch balls too.' },
  pistol: { name: 'Dueling Pistol', color: '#facc15', icon: Crosshair, help: 'Instant hitscan shot at 50 m. Stuns, and cancels a charging swing.' },
  shield: { name: 'Electromagnet', color: '#38bdf8', icon: Magnet, help: `A ${CONFIG.shield_duration} s bubble that blocks rockets and bullets and pushes rivals away.` },
}

const DIFFS = ['Easy', 'Normal', 'Hard'] as const

type Stage = 'menu' | 'play' | 'results'

export function Golf({ auto, onAccent }: { auto?: boolean; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'bogey-brawl'), [onAccent])
  const [stage, setStage] = useState<Stage>(auto ? 'play' : 'menu')
  const [difficulty, setDifficulty] = useState(1)
  const [bots, setBots] = useState(3)
  const [assets, setAssets] = useState<GolfAssets | null>(null)
  const [loadPct, setLoadPct] = useState(0)
  const [result, setResult] = useState<HoleResult | null>(null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    let alive = true
    loadGolfAssets((d, t) => alive && setLoadPct(d / t)).then((a) => {
      if (!alive) return
      setAssets(a)
      setLoadPct(1)
    })
    return () => {
      alive = false
    }
  }, [])

  if (stage === 'play')
    return (
      <GolfStage
        key={run}
        assets={assets}
        loadPct={loadPct}
        difficulty={difficulty}
        bots={bots}
        onResult={(r) => {
          setResult(r)
          setStage('results')
        }}
        onQuit={() => setStage('menu')}
      />
    )

  if (stage === 'results' && result)
    return (
      <Results
        result={result}
        onAgain={() => {
          setRun((r) => r + 1)
          setStage('play')
        }}
        onMenu={() => setStage('menu')}
      />
    )

  return (
    <Page onBack={() => navigate('#/home/bogey-brawl')} className="racer-page golf-page">
      <header className="page-header">
        <p className="eyebrow">Extras · Battle golf</p>
        <h1 className="page-title bb-title">BOGEY BRAWL</h1>
        <p className="page-lead">
          Everyone plays the hole at once. First ball in the cup wins the most points, and in between you can club, shoot and rocket your rivals off
          the fairway.
        </p>
      </header>

      <div className="vr-grid">
        <section className="arena-panel">
          <div className="bb-hole">
            <Flag size={18} />
            <div>
              <strong>{HOLE.name}</strong>
              <span className="muted small">
                {HOLE.biome} · Par {HOLE.par} · {Math.round(CONFIG.hole_time_par4 / 60)} min + {CONFIG.overtime} s overtime
              </span>
            </div>
          </div>
          <div className="field">
            <span>Rivals</span>
            <div className="seg seg-sm">
              {[1, 2, 3].map((n) => (
                <button key={n} className={`seg-btn ${bots === n ? 'is-active' : ''}`} onClick={() => setBots(n)}>
                  {n} bot{n > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Difficulty</span>
            <div className="seg seg-sm">
              {DIFFS.map((d, i) => (
                <button key={d} className={`seg-btn ${difficulty === i ? 'is-active' : ''}`} onClick={() => setDifficulty(i)}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            Scoring: {CONFIG.points_first} / {CONFIG.points_second} / {CONFIG.points_third} / {CONFIG.points_fourth} points by finishing order, +
            {CONFIG.points_under_par} under par, +{CONFIG.points_knockout} per knockout. Still out when overtime ends: {CONFIG.overtime_timeout_penalty}.
          </p>
          <button
            className="btn btn-primary arena-start"
            onClick={() => {
              uiSound('select')
              setRun((r) => r + 1)
              setStage('play')
            }}
          >
            <Play size={18} /> Tee off
          </button>
          {loadPct < 1 && <p className="muted small">Loading golfers and course: {Math.round(loadPct * 100)}%</p>}
          <p className="muted small mobile-only">Needs a mouse and keyboard.</p>
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">Items</h2>
          <ul className="vr-powers">
            {Object.entries(ITEMS).map(([id, it]) => (
              <li key={id}>
                <it.icon size={24} color={it.color} />
                <strong style={{ color: it.color }}>{it.name}</strong>
                <span className="muted small">{it.help}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Grab them from briefcases dotted along the hole. Three slots.</p>
          <h2 className="section-title">Controls</h2>
          <ul className="keys">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> run · mouse to look</li>
            <li><kbd>LMB</kbd> hold to charge, release to swing (near a rival: club them)</li>
            <li><kbd>Wheel</kbd> loft · <kbd>RMB</kbd> use item</li>
            <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> / <kbd>Q</kbd> pick slot · <kbd>F</kbd> drop</li>
            <li><kbd>Space</kbd> jump · <kbd>Shift</kbd> dive · <kbd>C</kbd> creep</li>
            <li><kbd>Esc</kbd> release the mouse</li>
          </ul>
        </section>
      </div>
    </Page>
  )
}

function GolfStage(p: { assets: GolfAssets | null; loadPct: number; difficulty: number; bots: number; onResult: (r: HoleResult) => void; onQuit: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const ready = !!p.assets
  const { onResult } = p

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('arena-running', { detail: true }))
    setInputSuspended(true)
    return () => {
      window.dispatchEvent(new CustomEvent('arena-running', { detail: false }))
      setInputSuspended(false)
    }
  }, [])

  useEffect(() => {
    if (!ready || !host.current) return
    let game: Game | null = null
    let cancelled = false
    const q = new URLSearchParams(window.location.search)
    import('./game').then(({ Game }) => {
      if (cancelled || !host.current) return
      game = new Game(host.current, { difficulty: p.difficulty, bots: p.bots, assets: p.assets, autopilot: q.has('autopilot') })
      game.onHud = setHud
      game.onResult = (r) => window.setTimeout(() => onResult(r), 2500)
      // ?snap (tests): no live loop; the test advances the game with simulate().
      if (q.has('snap')) {
        ;(window as unknown as { __golf: Game }).__golf = game
        game.simulate(0)
      } else game.start()
    })
    return () => {
      cancelled = true
      game?.dispose()
    }
    // The stage is keyed by run, so options are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div className="racer-stage golf-stage">
      <div ref={host} className="racer-host" />
      {!ready && <div className="vr-loading bb-loading">Loading golfers and course… {Math.round(p.loadPct * 100)}%</div>}
      {hud && <GolfHud hud={hud} />}
      {hud && !hud.locked && hud.phase !== 'results' && (
        <div className="bb-overlay">
          <h2>BOGEY BRAWL</h2>
          <p>Click to play. The hole keeps going while the mouse is free.</p>
          <button className="btn" onClick={p.onQuit}>
            <LogOut size={16} /> Quit to menu
          </button>
        </div>
      )}
    </div>
  )
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function ItemIcon({ type, size = 22 }: { type: ItemType; size?: number }) {
  const it = ITEMS[type]
  if (!it) return <Shield size={size} />
  return <it.icon size={size} color={it.color} />
}

function GolfHud({ hud }: { hud: Hud }) {
  return (
    <div className="vr-hud bb-hud">
      <div className="bb-top">
        <span className="bb-holename">
          {hud.hole.name} · Par {hud.hole.par}
        </span>
        <strong className={hud.overtime ? 'bb-ot' : hud.time < 20 ? 'bb-low' : ''}>
          {hud.overtime ? 'OVERTIME ' : ''}
          {fmt(hud.time)}
        </strong>
        <span className="muted">Strokes {hud.strokes}</span>
      </div>

      <ol className="bb-board">
        {hud.board.map((r) => (
          <li key={r.id} className={r.me ? 'is-me' : ''}>
            <i style={{ background: r.color }} />
            <span>{r.name}</span>
            <span className="muted">{r.finished ? `#${r.place} in` : `${r.strokes} st`}</span>
            {r.points > 0 && <b>+{r.points}</b>}
          </li>
        ))}
      </ol>

      {hud.markers.map((m) => (
        <div key={m.id} className={`bb-marker ${m.me ? 'is-me' : ''}`} style={{ left: m.x, top: m.y, borderColor: m.color }}>
          <span style={{ background: m.color }} />
          {m.me && <em>{m.dist} m</em>}
        </div>
      ))}

      <div className="vr-popups bb-popups">
        {hud.popups.map((pp) => (
          <div key={pp.id} style={{ position: 'absolute', left: pp.x, top: pp.y, color: pp.color, opacity: 1 - pp.age / 1.6 }}>
            {pp.text}
          </div>
        ))}
      </div>

      {hud.banner && (
        <div className="vr-banner" style={{ color: hud.banner.color }}>
          {hud.banner.text}
        </div>
      )}
      {hud.lockOn && <div className="bb-lock">ROCKET LOCKED ON · Shield or dive!</div>}
      {hud.stun > 0 && <div className="bb-status bb-stun">STUNNED {hud.stun.toFixed(1)}</div>}
      {hud.respawn > 0 && <div className="bb-status">Back to the last checkpoint in {Math.ceil(hud.respawn)}</div>}

      <ul className="bb-feed">
        {hud.feed.map((f) => (
          <li key={f.id} className={f.mine ? 'is-mine' : ''}>
            {f.text}
          </li>
        ))}
      </ul>

      <div className="bb-left">
        {hud.power !== null && (
          <div className="bb-power">
            <i style={{ height: `${hud.power * 100}%` }} />
          </div>
        )}
        <div className="bb-stats">
          <span>{hud.putt ? 'PUTT' : `Loft ${hud.loft}°`}</span>
          {hud.boost > 0 && <span className="bb-boost">Boost {hud.boost.toFixed(1)}</span>}
          {hud.shield > 0 && <span className="bb-shield">Shield {hud.shield.toFixed(1)}</span>}
          {hud.protect > 0 && <span className="muted">Protected {hud.protect.toFixed(1)}</span>}
        </div>
      </div>

      <div className="bb-slots">
        {hud.items.map((it, i) => (
          <div key={i} className={`bb-slot ${hud.active === i ? 'is-active' : ''}`}>
            <span className="bb-key">{i + 1}</span>
            {it ? <ItemIcon type={it} /> : null}
            {it && hud.active === i && <em>{ITEMS[it]?.name ?? it}</em>}
          </div>
        ))}
      </div>

      <div className="bb-hint">{hud.hint}</div>
      <div className="bb-cross" />
    </div>
  )
}

function Results({ result, onAgain, onMenu }: { result: HoleResult; onAgain: () => void; onMenu: () => void }) {
  const rows = [...result.rows].sort((a, b) => b.total - a.total)
  const me = rows.find((r) => r.me)
  return (
    <Page onBack={onMenu} backLabel="Menu" className="racer-page golf-page">
      <header className="page-header">
        <p className="eyebrow">
          {result.name} · Par {result.par}
        </p>
        <h1 className="page-title bb-title">{me && rows[0] === me ? 'You win the hole' : `${rows[0]?.name} wins the hole`}</h1>
        <p className="page-lead">{result.highlight}</p>
      </header>
      <section className="arena-panel">
        <table className="bb-results">
          <thead>
            <tr>
              <th>#</th>
              <th>Golfer</th>
              <th>Strokes</th>
              <th>Breakdown</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.me ? 'is-me' : ''}>
                <td>{i === 0 ? <Trophy size={16} color="#facc15" /> : i + 1}</td>
                <td>
                  <i className="bb-dot" style={{ background: r.color }} /> {r.name}
                </td>
                <td>{r.place ? `${r.strokes} (${r.strokes - result.par >= 0 ? '+' : ''}${r.strokes - result.par})` : 'DNF'}</td>
                <td className="muted small">{r.breakdown.map((b) => `${b.label} ${b.points >= 0 ? '+' : ''}${b.points}`).join(' · ') || '—'}</td>
                <td>
                  <strong>{r.total}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bb-actions">
          <button className="btn btn-primary" onClick={onAgain}>
            <RotateCcw size={16} /> Play again
          </button>
          <button className="btn" onClick={onMenu}>
            Menu
          </button>
        </div>
      </section>
    </Page>
  )
}
