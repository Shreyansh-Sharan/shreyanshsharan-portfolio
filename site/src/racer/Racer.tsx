// VOLT RIOT page: menu (mode, difficulty, car), the race with its HUD, results, and the Combat Points series.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Flag, LogOut, Pause, Play, RotateCcw, Star, Swords, Trophy } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { play as uiSound } from '../lib/sound'
import { setInputSuspended } from '../lib/input'
import { Page } from '../components/Page'
import { CONFIG } from './config'
import { CARS, DRIVERS, topSpeedKmh, type CarModel } from './cars'
import { glyphUrl } from './fx'
import { POWER_COLORS, type PowerType } from './track'
import { loadRacerAssets, type RacerAssets } from './assets'
import type { Game, Hud, Mode, RaceResult } from './game'

const accent = tiles.find((t) => t.id === 'volt-riot')?.accent ?? (['#831843', '#f0abfc'] as [string, string])

/* ---------- Career save (localStorage) ---------- */

interface Save {
  fans: number
  lights: Record<string, number> // best Lights per event
  seriesWins: number
}

function readSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem('volt-riot') ?? '') as Save
    return { fans: s.fans ?? 0, lights: s.lights ?? {}, seriesWins: s.seriesWins ?? 0 }
  } catch {
    return { fans: 0, lights: {}, seriesWins: 0 }
  }
}

function writeSave(s: Save) {
  try {
    localStorage.setItem('volt-riot', JSON.stringify(s))
  } catch {
    // Private mode: progress just isn't kept.
  }
}

function fanLevel(fans: number) {
  const base = CONFIG.fan_level_base
  const level = Math.min(CONFIG.fan_level_cap, Math.floor(Math.sqrt(fans / base)) + 1)
  const cur = base * (level - 1) ** 2
  const next = base * level ** 2
  return { level, progress: level >= CONFIG.fan_level_cap ? 1 : (fans - cur) / (next - cur), next }
}

const POWER_NAMES: Record<PowerType, string> = {
  shunt: 'Shunt', barge: 'Barge', bolt: 'Bolt', mine: 'Mine', shock: 'Shock', nitro: 'Nitro', shield: 'Shield', repair: 'Repair',
}

/* ---------- Page ---------- */

type Stage = 'menu' | 'race' | 'results' | 'standings'

export function Racer({ auto, onAccent }: { auto?: 'race' | 'combat'; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'volt-riot'), [onAccent])
  const [stage, setStage] = useState<Stage>(auto ? 'race' : 'menu')
  const [mode, setMode] = useState<Mode>('race')
  const [difficulty, setDifficulty] = useState(1)
  const [carId, setCarId] = useState(() => {
    try {
      return localStorage.getItem('volt-riot-car') ?? 'mamba'
    } catch {
      return 'mamba'
    }
  })
  const [round, setRound] = useState(0)
  const [series, setSeries] = useState<Record<string, number>>({})
  const [result, setResult] = useState<RaceResult | null>(null)
  const [save, setSave] = useState(readSave)
  const [assets, setAssets] = useState<RacerAssets | null>(null)
  const [loadPct, setLoadPct] = useState(0)
  const [runKey, setRunKey] = useState(0)

  useEffect(() => {
    let alive = true
    loadRacerAssets((d, t) => alive && setLoadPct(d / t)).then((a) => alive && setAssets(a))
    return () => {
      alive = false
    }
  }, [])

  const start = (m: Mode) => {
    uiSound('select')
    try {
      localStorage.setItem('volt-riot-car', carId)
    } catch {
      // ignore
    }
    setMode(m)
    setRound(0)
    setSeries({})
    setResult(null)
    setRunKey((k) => k + 1)
    setStage('race')
  }

  const onFinish = useCallback(
    (r: RaceResult) => {
      setResult(r)
      setSave((prev) => {
        const next: Save = { ...prev, lights: { ...prev.lights } }
        next.fans += r.fans
        if (r.mode === 'race') next.lights['harbor-loop'] = Math.max(next.lights['harbor-loop'] ?? 0, r.lights.total)
        writeSave(next)
        return next
      })
      if (r.mode === 'combat') {
        setSeries((prev) => {
          const next = { ...prev }
          for (const [name, pts] of Object.entries(r.combat)) next[name] = (next[name] ?? 0) + pts
          return next
        })
      }
      setStage('results')
    },
    [],
  )

  const nextRound = () => {
    uiSound('select')
    if (round + 1 >= CONFIG.combat_tracks) {
      // Series over: the winner gets 3 Lights and Fan Points = Combat Points / 2.
      const ranking = Object.entries(series).sort((a, b) => b[1] - a[1])
      const won = ranking[0]?.[0] === 'You'
      const mine = series['You'] ?? 0
      setSave((prev) => {
        const next: Save = { ...prev, lights: { ...prev.lights } }
        if (won) {
          next.lights['combat-series'] = 3
          next.seriesWins++
          next.fans += Math.round(mine / 2)
        }
        writeSave(next)
        return next
      })
      setStage('standings')
      return
    }
    setRound((r) => r + 1)
    setRunKey((k) => k + 1)
    setStage('race')
  }

  if (stage === 'race')
    return (
      <RaceStage
        key={runKey}
        mode={auto ?? mode}
        carId={auto ? 'sable' : carId}
        difficulty={difficulty}
        round={round}
        auto={!!auto}
        assets={assets}
        loadPct={loadPct}
        onFinish={onFinish}
        onQuit={() => setStage('menu')}
        onRestart={() => setRunKey((k) => k + 1)}
      />
    )

  if (stage === 'results' && result)
    return (
      <Results
        r={result}
        save={save}
        series={series}
        onAgain={() => (result.mode === 'race' ? start('race') : nextRound())}
        onMenu={() => setStage('menu')}
      />
    )

  if (stage === 'standings') return <Standings series={series} save={save} onMenu={() => setStage('menu')} onAgain={() => start('combat')} />

  return (
    <Menu
      mode={mode}
      setMode={setMode}
      difficulty={difficulty}
      setDifficulty={setDifficulty}
      carId={carId}
      setCarId={setCarId}
      save={save}
      loadPct={assets ? 1 : loadPct}
      onStart={() => start(mode)}
    />
  )
}

/* ---------- Menu ---------- */

function StatBar({ label, v }: { label: string; v: number }) {
  return (
    <div className="vr-stat">
      <span>{label}</span>
      <div className="vr-stat-bar">
        <i style={{ width: `${v * 10}%` }} />
      </div>
    </div>
  )
}

function Menu(p: {
  mode: Mode
  setMode: (m: Mode) => void
  difficulty: number
  setDifficulty: (d: number) => void
  carId: string
  setCarId: (id: string) => void
  save: Save
  loadPct: number
  onStart: () => void
}) {
  const car = CARS.find((c) => c.id === p.carId) ?? CARS[0]
  const lvl = fanLevel(p.save.fans)
  const lights = Object.values(p.save.lights).reduce((a, b) => a + b, 0)
  return (
    <Page onBack={() => navigate('#/home/volt-riot')} className="racer-page">
      <header className="page-header">
        <p className="eyebrow">Extras · Combat racer</p>
        <h1 className="page-title vr-title">VOLT RIOT</h1>
        <p className="page-lead">
          Neon street racing with weapons. Eight power-ups, three bay slots, ten segments of health. Drive well, fight
          dirty, win fans.
        </p>
      </header>

      <div className="vr-profile">
        <div>
          <span className="muted small">Fan Level</span>
          <strong>{lvl.level}</strong>
        </div>
        <div className="vr-level">
          <i style={{ width: `${lvl.progress * 100}%` }} />
        </div>
        <div>
          <span className="muted small">Fans</span>
          <strong>{p.save.fans.toLocaleString()}</strong>
        </div>
        <div>
          <span className="muted small">Lights</span>
          <strong>
            <Star size={14} /> {lights}
          </strong>
        </div>
      </div>

      <div className="vr-grid">
        <section className="arena-panel">
          <div className="seg" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={p.mode === 'race'} className={`seg-btn ${p.mode === 'race' ? 'is-active' : ''}`} onClick={() => p.setMode('race')}>
              <Flag size={15} /> Race
            </button>
            <button role="tab" aria-selected={p.mode === 'combat'} className={`seg-btn ${p.mode === 'combat' ? 'is-active' : ''}`} onClick={() => p.setMode('combat')}>
              <Swords size={15} /> Combat Points
            </button>
          </div>
          <p className="muted small">
            {p.mode === 'race'
              ? `${CONFIG.race_laps} laps on Harbor Loop with ${CONFIG.race_cars} cars. Finish on the podium, meet the fan demand and complete every Fan Run for up to 5 Lights.`
              : `A ${CONFIG.combat_tracks}-track series of ${CONFIG.combat_laps} laps each: forward, reverse, then a finale with double Shock and Mines. Weapons-only pickups. Wrecks score, position barely does.`}
          </p>
          {p.mode === 'race' && (
            <div className="field">
              <span>Rivals</span>
              <div className="seg seg-sm">
                {['Easy', 'Normal', 'Hard'].map((label, i) => (
                  <button key={label} className={`seg-btn ${p.difficulty === i ? 'is-active' : ''}`} onClick={() => p.setDifficulty(i)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="vr-cars" role="listbox" aria-label="Car">
            {CARS.map((c) => (
              <button key={c.id} role="option" aria-selected={c.id === p.carId} className={`vr-car ${c.id === p.carId ? 'is-active' : ''}`} onClick={() => p.setCarId(c.id)} style={{ ['--car' as string]: c.glow }}>
                <span className="vr-class">{c.cls}</span>
                <strong>{c.name}</strong>
                <span className="muted small">{c.archetype}</span>
              </button>
            ))}
          </div>
          <CarCard car={car} />
          <button className="btn btn-primary arena-start" onClick={p.onStart}>
            <Play size={18} /> {p.mode === 'race' ? 'Start race' : 'Start series'}
          </button>
          {p.loadPct < 1 && <p className="muted small">Loading cars and track: {Math.round(p.loadPct * 100)}%</p>}
          <p className="muted small mobile-only">Best with a keyboard or a gamepad.</p>
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">Power-ups</h2>
          <ul className="vr-powers">
            {(Object.keys(POWER_NAMES) as PowerType[]).map((t) => (
              <li key={t}>
                <img src={glyphUrl(t)} alt="" width={28} height={28} />
                <strong style={{ color: POWER_COLORS[t] }}>{POWER_NAMES[t]}</strong>
                <span className="muted small">{POWER_HELP[t]}</span>
              </li>
            ))}
          </ul>
          <h2 className="section-title">Controls</h2>
          <ul className="keys">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows: drive</li>
            <li><kbd>Space</kbd> Handbrake drift</li>
            <li><kbd>Shift</kbd> / <kbd>J</kbd> Fire forward (hold for all Bolts)</li>
            <li><kbd>K</kbd> Fire backward</li>
            <li><kbd>Tab</kbd> / <kbd>Q</kbd> Cycle · <kbd>X</kbd> Discard</li>
            <li><kbd>C</kbd> Look back · <kbd>R</kbd> Reset · <kbd>M</kbd> Music · <kbd>Esc</kbd> Pause</li>
          </ul>
          <p className="muted small">Gamepad: RT/LT drive, A drift, X fire, B fire back, LB/RB cycle, Y discard. Hit the throttle right on GO for a launch boost.</p>
          <h2 className="section-title">Rivals</h2>
          <ul className="vr-rivals">
            {DRIVERS.map((d) => (
              <li key={d.name}>
                <strong>{d.name}</strong> <span className="muted small">{d.personality} · {CARS.find((c) => c.id === d.car)?.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Page>
  )
}

const POWER_HELP: Record<PowerType, string> = {
  shunt: 'Homing orb, locks the car in your sights. Back: rolls straight behind.',
  barge: 'Shockwave that shoves nearby cars and destroys incoming fire.',
  bolt: 'Three fast shots. Two Bolts destroy a Shunt or Mine.',
  mine: 'Lobbed ahead or dropped behind. Heavy damage.',
  shock: 'Three lightning domes ahead of the leader.',
  nitro: 'Boost. Back: air brake for hairpins.',
  shield: 'Blocks the next hit for 5 s.',
  repair: `Restores ${CONFIG.repair_amount} health segments.`,
}

function CarCard({ car }: { car: CarModel }) {
  return (
    <div className="vr-carcard" style={{ ['--car' as string]: car.glow }}>
      <div className="vr-carcard-head">
        <strong>{car.name}</strong>
        <span className="muted small">
          Class {car.cls} · {topSpeedKmh(car)} km/h · career unlock at Fan Level {car.unlock}
        </span>
      </div>
      <StatBar label="Speed" v={car.stats.speed} />
      <StatBar label="Acceleration" v={car.stats.accel} />
      <StatBar label="Grip" v={car.stats.grip} />
      <StatBar label="Drift" v={car.stats.drift} />
      <StatBar label="Stability" v={car.stats.stability} />
    </div>
  )
}

/* ---------- Race ---------- */

function RaceStage(p: {
  mode: Mode
  carId: string
  difficulty: number
  round: number
  auto: boolean
  assets: RacerAssets | null
  loadPct: number
  onFinish: (r: RaceResult) => void
  onQuit: () => void
  onRestart: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const [paused, setPaused] = useState(false)
  const { onFinish } = p
  const ready = !!p.assets

  // The site's world pauses and menu input is off while racing.
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
    import('./game').then(({ Game }) => {
      if (cancelled || !host.current) return
      game = new Game(host.current, { mode: p.mode, carId: p.carId, difficulty: p.difficulty, round: p.round, autopilot: p.auto, assets: p.assets ?? undefined })
      gameRef.current = game
      game.minimap = map.current
      game.onHud = setHud
      game.onPause = setPaused
      game.onFinish = onFinish
      // ?snap (tests): no live loop; the test advances the game with simulate().
      if (new URLSearchParams(window.location.search).has('snap')) {
        ;(window as unknown as { __racer: Game }).__racer = game
        game.simulate(0)
      } else game.start()
    })
    return () => {
      cancelled = true
      game?.dispose()
      gameRef.current = null
    }
    // The stage is keyed by run, so options are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div className="racer-stage">
      <div ref={host} className="racer-host" />
      {!ready && <div className="vr-loading">Loading cars and track… {Math.round(p.loadPct * 100)}%</div>}
      {hud && <RaceHud hud={hud} mode={p.mode} round={p.round} />}
      <canvas ref={map} className="vr-minimap" width={360} height={360} />
      {paused && (
        <div className="vr-pause">
          <h2>Paused</h2>
          <button className="btn btn-primary" onClick={() => gameRef.current?.setPaused(false)}>
            <Play size={16} /> Resume
          </button>
          <button className="btn" onClick={p.onRestart}>
            <RotateCcw size={16} /> Restart
          </button>
          <button className="btn" onClick={p.onQuit}>
            <LogOut size={16} /> Quit to menu
          </button>
        </div>
      )}
      <button className="pill vr-pausebtn" aria-label="Pause" onClick={() => gameRef.current?.setPaused(true)}>
        <Pause size={16} />
      </button>
    </div>
  )
}

function RaceHud({ hud, mode, round }: { hud: Hud; mode: Mode; round: number }) {
  const hp = Math.ceil(hud.health)
  const frac = hud.health / CONFIG.max_health
  const hpClass = frac <= CONFIG.fire_below ? 'is-critical' : frac <= CONFIG.smoke_below ? 'is-low' : ''
  return (
    <div className="vr-hud">
      {hud.hitFlash && <div className="vr-edge" style={{ boxShadow: `inset 0 0 120px 30px ${hud.hitFlash}`, opacity: hud.hitFlashAmt }} />}

      <div className="vr-tl">
        <div className="vr-pos">
          {hud.place}
          <span>/{hud.cars}</span>
        </div>
        <div className="vr-lap">
          LAP {hud.lap}/{hud.laps}
        </div>
        {hud.combat && (
          <div className="vr-combat">
            <strong>{hud.combat.score} CP</strong>
            <span>
              Track {round + 1}/{CONFIG.combat_tracks} · {Math.floor(hud.combat.timeLeft / 60)}:{String(Math.floor(hud.combat.timeLeft % 60)).padStart(2, '0')}
            </span>
            <span className="muted">
              Leader: {hud.combat.leader} {hud.combat.leaderScore}
            </span>
          </div>
        )}
      </div>

      {mode === 'race' && (
        <div className="vr-fans">
          <Trophy size={14} /> {hud.fans.toLocaleString()} <span className="muted">/ {hud.fanTarget.toLocaleString()} fans</span>
        </div>
      )}

      {hud.fanRun && (
        <div className="vr-fanrun">
          <strong>FAN RUN</strong> {hud.fanRun.label}
          <div className="vr-fanrun-bar">
            <i style={{ width: `${Math.min(1, hud.fanRun.progress / hud.fanRun.goal) * 100}%` }} />
          </div>
          <span>{hud.fanRun.time.toFixed(1)} s</span>
        </div>
      )}

      {hud.phase === 'intro' && (
        <div className="vr-intro">
          {hud.intro.map((l, i) => (
            <p key={i} style={{ animationDelay: `${i * 0.6}s` }}>
              {l}
            </p>
          ))}
          <span className="muted small">Press Enter to skip</span>
        </div>
      )}
      {hud.countdown >= 0 && hud.phase !== 'intro' && (
        <div className="vr-count" key={hud.countdown}>
          {hud.countdown === 0 ? 'GO' : hud.countdown}
        </div>
      )}
      {hud.phase === 'countdown' && <div className="vr-hint">Hit the throttle right on GO for a perfect launch</div>}

      {hud.banner && (
        <div className="vr-banner" style={{ color: hud.banner.color }}>
          {hud.banner.text}
          {hud.wrecked > 0 && <span>Respawn in {Math.ceil(hud.wrecked)}</span>}
        </div>
      )}

      <div className="vr-popups">
        {hud.popups.map((pp) => (
          <div key={pp.id} style={{ color: pp.color, transform: `translateY(${-pp.age * 40}px)`, opacity: 1 - pp.age / 1.6 }}>
            {pp.text}
          </div>
        ))}
      </div>

      {hud.reticle && (
        <div className="vr-reticle" style={{ left: hud.reticle.x, top: hud.reticle.y }}>
          <span>{hud.reticle.name}</span>
        </div>
      )}
      {hud.incoming !== null && (
        <div className="vr-incoming" style={{ transform: `translate(-50%, -50%) rotate(${hud.incoming}rad)` }}>
          <ArrowUp size={44} />
          <span>SHUNT</span>
        </div>
      )}
      {hud.lookBack && <div className="vr-lookback">LOOKING BACK</div>}

      <div className="vr-bottom">
        <div className="vr-health">
          <span className="vr-label">
            HEALTH {hud.shield > 0 && <em>SHIELD {hud.shield.toFixed(1)}</em>}
            {hud.invuln && <em>INVULNERABLE</em>}
          </span>
          <div className={`vr-segs ${hpClass}`}>
            {Array.from({ length: CONFIG.max_health }, (_, i) => (
              <i key={i} className={i < hp ? 'on' : ''} />
            ))}
          </div>
        </div>

        <div className="vr-center">
          {(hud.killFeed.length > 0 || hud.chain) && (
            <div className="vr-feed">
              {hud.chain && (
                <div className="vr-chain">
                  CHAIN ×{hud.chain.mult.toFixed(1)} <i style={{ width: `${(hud.chain.time / CONFIG.combat_chain_window) * 100}%` }} />
                </div>
              )}
              {hud.killFeed.map((k) => (
                <div key={k.id} className={k.mine ? 'is-mine' : ''}>
                  {k.text}
                </div>
              ))}
            </div>
          )}
          <div className="vr-bay">
            {hud.bay.map((s, i) => (
              <div key={i} className={`vr-slot ${i === hud.active ? 'is-active' : ''}`} style={s ? { ['--pc' as string]: POWER_COLORS[s.type] } : undefined}>
                {s ? (
                  <>
                    <img src={glyphUrl(s.type)} alt={POWER_NAMES[s.type]} />
                    {s.count > 1 && <b>×{s.count}</b>}
                    <span>{POWER_NAMES[s.type]}</span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="vr-speed">
          <strong>{hud.speed}</strong>
          <span>km/h</span>
          <div className={`vr-nitro ${hud.nitro > 0 ? 'on' : ''} ${hud.boosting ? 'boost' : ''}`}>
            <i style={{ width: `${Math.min(1, hud.nitro / CONFIG.nitro_duration) * 100}%` }} />
            <span>{hud.nitro > 0 ? `NITRO ${hud.nitro.toFixed(1)}` : hud.boosting ? 'BOOST' : 'NITRO'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Results ---------- */

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

function Results({ r, save, series, onAgain, onMenu }: { r: RaceResult; save: Save; series: Record<string, number>; onAgain: () => void; onMenu: () => void }) {
  const lvl = fanLevel(save.fans)
  const last = r.mode === 'combat' && r.round + 1 >= CONFIG.combat_tracks
  return (
    <Page onBack={onMenu} backLabel="Menu" className="racer-page">
      <header className="page-header">
        <p className="eyebrow">{r.mode === 'race' ? 'Race result' : `Combat Points · track ${r.round + 1} of ${CONFIG.combat_tracks}`}</p>
        <h1 className="page-title vr-title">
          {r.mode === 'combat' ? `#${r.place} in Combat Points` : r.place === 1 ? 'Winner' : `P${r.place}`} · {r.track}
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
                <th>{r.mode === 'race' ? 'Time' : 'Track CP'}</th>
                {r.mode === 'combat' && <th>Series</th>}
                <th>Wrecks</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.name} className={row.isPlayer ? 'is-player' : ''}>
                  <td>{row.place}</td>
                  <td>
                    <span className="dot" style={{ background: row.color }} /> {row.name}
                  </td>
                  <td>{row.car}</td>
                  <td>{r.mode === 'race' ? fmtTime(row.time) : row.combat}</td>
                  {r.mode === 'combat' && <td>{series[row.name] ?? 0}</td>}
                  <td>{row.wrecks}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="vr-actions">
            <button className="btn btn-primary" onClick={onAgain}>
              {r.mode === 'race' ? <RotateCcw size={16} /> : <Play size={16} />} {r.mode === 'race' ? 'Race again' : last ? 'Series standings' : 'Next track'}
            </button>
            <button className="btn" onClick={onMenu}>
              Menu
            </button>
          </div>
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

function Standings({ series, save, onMenu, onAgain }: { series: Record<string, number>; save: Save; onMenu: () => void; onAgain: () => void }) {
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
