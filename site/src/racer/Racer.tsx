// VOLT RIOT page: menu and game settings, the online lobby, the race, results and the Combat Points series.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Crown, Flag, Globe, LogIn, Play, Skull, Star, Swords, User, Users } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { play as uiSound } from '../lib/sound'
import { Page } from '../components/Page'
import { CONFIG } from './config'
import { CARS, DRIVERS, topSpeedKmh, type CarModel } from './cars'
import { glyphUrl } from './fx'
import { POWER_COLORS, type PowerType } from './track'
import { loadRacerAssets, type RacerAssets } from './assets'
import { fanLevel, readSave, writeSave, POWER_NAMES, type Save } from './save'
import { RaceStage } from './RaceStage'
import { Results, Standings } from './Results'
import { hostRoom, joinRoom, type Link, type LobbyPlayer, type MatchSettings, type MatchSetup, type Msg, type Slot } from './net'
import type { Mode, RaceResult } from './game'

const accent = tiles.find((t) => t.id === 'volt-riot')?.accent ?? (['#831843', '#f0abfc'] as [string, string])

type Stage = 'menu' | 'lobby' | 'race' | 'results' | 'standings'
type PlayMode = 'solo' | 'host' | 'join'

interface Session {
  link: Link
  players: LobbyPlayer[]
  settings: MatchSettings
}

function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode: just not remembered.
  }
}

const DEFAULT_SETTINGS: MatchSettings = { mode: 'race', laps: CONFIG.race_laps, minutes: CONFIG.deathmatch_minutes, bots: 5, difficulty: 1 }

/** Grid for an online match: humans first, AI drivers fill the rest. */
function buildSetup(players: LobbyPlayer[], settings: MatchSettings): MatchSetup {
  const humans: Slot[] = players.slice(0, CONFIG.max_players).map((p) => ({ kind: 'human', id: p.id, name: p.name, carId: p.carId }))
  const bots = Math.max(0, Math.min(settings.bots, CONFIG.max_players - humans.length))
  const ai: Slot[] = DRIVERS.slice(0, bots).map((d, i) => ({ kind: 'ai', id: `ai-${i}`, name: d.name, carId: d.car, driver: i }))
  return { settings, slots: [...humans, ...ai], seed: Math.floor(Math.random() * 1e9) }
}

export function Racer({ auto, join, onAccent }: { auto?: 'race' | 'combat'; join?: string; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'volt-riot'), [onAccent])
  const [stage, setStage] = useState<Stage>(auto ? 'race' : 'menu')
  const [playMode, setPlayMode] = useState<PlayMode>(join ? 'join' : 'solo')
  const [mode, setMode] = useState<Mode>(auto ?? 'race')
  const [settings, setSettings] = useState<MatchSettings>(DEFAULT_SETTINGS)
  const [carId, setCarId] = useState(() => stored('volt-riot-car', 'mamba'))
  const [name, setName] = useState(() => stored('volt-riot-name', ''))
  const [code, setCode] = useState((join ?? '').toUpperCase())
  const [round, setRound] = useState(0)
  const [series, setSeries] = useState<Record<string, number>>({})
  const [result, setResult] = useState<RaceResult | null>(null)
  const [save, setSave] = useState(readSave)
  const [assets, setAssets] = useState<RacerAssets | null>(null)
  const [loadPct, setLoadPct] = useState(0)
  const [runKey, setRunKey] = useState(0)
  const [session, setSession] = useState<Session | null>(null)
  const [setup, setSetup] = useState<MatchSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unsubs = useRef<(() => void)[]>([])
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    let alive = true
    loadRacerAssets((d, t) => alive && setLoadPct(d / t)).then((a) => alive && setAssets(a))
    return () => {
      alive = false
    }
  }, [])

  const leave = useCallback(() => {
    for (const u of unsubs.current) u()
    unsubs.current = []
    sessionRef.current?.link.close()
    sessionRef.current = null
    setSession(null)
    setSetup(null)
  }, [])

  // Close the connection when leaving the page.
  useEffect(() => leave, [leave])

  const displayName = () => (name.trim() || 'Driver').slice(0, 16)

  /* ---------- Solo ---------- */

  const startSolo = (m: Mode) => {
    uiSound('select')
    store('volt-riot-car', carId)
    setMode(m)
    setRound(0)
    setSeries({})
    setResult(null)
    setSetup(null)
    setRunKey((k) => k + 1)
    setStage('race')
  }

  /* ---------- Online ---------- */

  const broadcastLobby = (s: Session) => s.link.send({ t: 'lobby', players: s.players, settings: s.settings } satisfies Msg)

  const createRoom = async () => {
    setBusy(true)
    setError(null)
    store('volt-riot-name', name)
    store('volt-riot-car', carId)
    try {
      const link = await hostRoom()
      const s: Session = {
        link,
        players: [{ id: 'host', name: displayName(), carId }],
        settings: { ...settings, mode: mode === 'deathmatch' ? 'deathmatch' : 'race' },
      }
      sessionRef.current = s
      setSession(s)
      unsubs.current.push(
        link.onMessage((raw, from) => {
          const msg = raw as Msg
          if (msg.t !== 'hello') return
          const cur = sessionRef.current
          if (!cur) return
          const exists = cur.players.some((p) => p.id === from)
          if (!exists && cur.players.length >= CONFIG.max_players) {
            link.send({ t: 'full' } satisfies Msg, from)
            return
          }
          const player = { id: from, name: (msg.name || 'Driver').slice(0, 16), carId: CARS.some((c) => c.id === msg.carId) ? msg.carId : 'mamba' }
          const next = { ...cur, players: exists ? cur.players.map((p) => (p.id === from ? player : p)) : [...cur.players, player] }
          sessionRef.current = next
          setSession(next)
          broadcastLobby(next)
        }),
        link.onPeer((event, id) => {
          const cur = sessionRef.current
          if (!cur) return
          if (event === 'join') return broadcastLobby(cur)
          const next = { ...cur, players: cur.players.filter((p) => p.id !== id) }
          sessionRef.current = next
          setSession(next)
          broadcastLobby(next)
        }),
      )
      setStage('lobby')
    } catch (e) {
      setError((e as Error).message || 'Could not create a room.')
    } finally {
      setBusy(false)
    }
  }

  const joinGame = async () => {
    if (code.trim().length < 4) return
    setBusy(true)
    setError(null)
    store('volt-riot-name', name)
    store('volt-riot-car', carId)
    try {
      const link = await joinRoom(code)
      const s: Session = { link, players: [], settings }
      sessionRef.current = s
      setSession(s)
      unsubs.current.push(
        link.onMessage((raw) => {
          const msg = raw as Msg
          if (msg.t === 'lobby') {
            const cur = sessionRef.current
            if (!cur) return
            const next = { ...cur, players: msg.players, settings: msg.settings }
            sessionRef.current = next
            setSession(next)
          } else if (msg.t === 'start') {
            setSetup(msg.setup)
            setResult(null)
            setRunKey((k) => k + 1)
            setStage('race')
          } else if (msg.t === 'lobbyback') setStage('lobby')
          else if (msg.t === 'full') {
            setError('That room is full.')
            leave()
            setStage('menu')
          }
        }),
        link.onPeer((event, id) => {
          if (event === 'leave' && id === 'host') {
            setError('The host closed the room.')
            leave()
            setStage('menu')
          }
        }),
      )
      link.send({ t: 'hello', name: displayName(), carId } satisfies Msg)
      setStage('lobby')
    } catch (e) {
      setError((e as Error).message || 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  const updateSettings = (next: MatchSettings) => {
    const cur = sessionRef.current
    if (!cur || !cur.link.isHost) return
    const s = { ...cur, settings: next }
    sessionRef.current = s
    setSession(s)
    broadcastLobby(s)
  }

  const changeCar = (id: string) => {
    setCarId(id)
    store('volt-riot-car', id)
    const cur = sessionRef.current
    if (!cur) return
    if (cur.link.isHost) {
      const next = { ...cur, players: cur.players.map((p) => (p.id === 'host' ? { ...p, carId: id } : p)) }
      sessionRef.current = next
      setSession(next)
      broadcastLobby(next)
    } else cur.link.send({ t: 'hello', name: displayName(), carId: id } satisfies Msg)
  }

  const startOnline = () => {
    const s = sessionRef.current
    if (!s || !s.link.isHost) return
    uiSound('select')
    const st = buildSetup(s.players, s.settings)
    s.link.send({ t: 'start', setup: st } satisfies Msg)
    setSetup(st)
    setResult(null)
    setRunKey((k) => k + 1)
    setStage('race')
  }

  const backToLobby = () => {
    const s = sessionRef.current
    if (s?.link.isHost) s.link.send({ t: 'lobbyback' } satisfies Msg)
    setStage('lobby')
  }

  const quitOnline = () => {
    leave()
    setStage('menu')
  }

  /* ---------- Results ---------- */

  const onFinish = useCallback((r: RaceResult) => {
    setResult(r)
    setSave((prev) => {
      const next: Save = { ...prev, lights: { ...prev.lights } }
      next.fans += r.fans
      if (r.mode === 'race' && !r.online) next.lights['harbor-loop'] = Math.max(next.lights['harbor-loop'] ?? 0, r.lights.total)
      writeSave(next)
      return next
    })
    if (r.mode === 'combat') {
      setSeries((prev) => {
        const next = { ...prev }
        for (const [n, pts] of Object.entries(r.combat)) next[n] = (next[n] ?? 0) + pts
        return next
      })
    }
    setStage('results')
  }, [])

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

  /* ---------- Screens ---------- */

  if (stage === 'race') {
    const online = !!(setup && session)
    const s = setup?.settings
    return (
      <RaceStage
        key={runKey}
        options={
          online && s
            ? { mode: s.mode, carId, difficulty: s.difficulty, round: 0, laps: s.laps, minutes: s.minutes, net: { link: session!.link, setup: setup! } }
            : {
                mode: auto ?? mode,
                carId: auto ? 'sable' : carId,
                difficulty: settings.difficulty,
                round,
                autopilot: !!auto,
                laps: settings.laps,
                minutes: settings.minutes,
                bots: auto ? undefined : settings.bots,
              }
        }
        assets={assets}
        loadPct={loadPct}
        onFinish={onFinish}
        onQuit={online ? quitOnline : () => setStage('menu')}
        onRestart={online ? undefined : () => setRunKey((k) => k + 1)}
        onDisconnect={(reason) => {
          setError(reason)
          quitOnline()
        }}
      />
    )
  }

  if (stage === 'results' && result) {
    if (result.online) {
      const host = !!session?.link.isHost
      return (
        <Results
          r={result}
          save={save}
          series={series}
          onAgain={session && host ? backToLobby : undefined}
          againLabel="Back to lobby"
          onMenu={quitOnline}
          menuLabel="Leave"
          note={session && !host ? 'Waiting for the host to start the next match.' : session ? undefined : 'The room has closed.'}
        />
      )
    }
    return (
      <Results
        r={result}
        save={save}
        series={series}
        onAgain={() => (result.mode === 'combat' ? nextRound() : startSolo(result.mode))}
        onMenu={() => setStage('menu')}
      />
    )
  }

  if (stage === 'standings') return <Standings series={series} save={save} onMenu={() => setStage('menu')} onAgain={() => startSolo('combat')} />

  if (stage === 'lobby' && session)
    return (
      <Lobby
        session={session}
        carId={carId}
        setCarId={changeCar}
        onSettings={updateSettings}
        onStart={startOnline}
        onLeave={quitOnline}
        loadPct={assets ? 1 : loadPct}
      />
    )

  return (
    <Menu
      playMode={playMode}
      setPlayMode={setPlayMode}
      mode={mode}
      setMode={setMode}
      settings={settings}
      setSettings={setSettings}
      carId={carId}
      setCarId={setCarId}
      name={name}
      setName={setName}
      code={code}
      setCode={setCode}
      save={save}
      busy={busy}
      error={error}
      loadPct={assets ? 1 : loadPct}
      onStart={() => {
        setError(null)
        if (playMode === 'solo') startSolo(mode)
        else if (playMode === 'host') void createRoom()
        else void joinGame()
      }}
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

function Seg<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="seg seg-sm">
      {options.map(([v, label]) => (
        <button key={String(v)} disabled={disabled} className={`seg-btn ${value === v ? 'is-active' : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** Game settings: laps or time limit, AI rivals and difficulty. */
function SettingsPanel({
  mode,
  settings,
  onChange,
  readOnly,
  online,
}: {
  mode: Mode
  settings: MatchSettings
  onChange: (s: MatchSettings) => void
  readOnly?: boolean
  online?: boolean
}) {
  if (mode === 'combat')
    return (
      <p className="muted small">
        A {CONFIG.combat_tracks}-track series of {CONFIG.combat_laps} laps each: forward, reverse, then a finale with double Shock and Mines. Weapons-only
        pickups. Wrecks score, position barely does. Solo only.
      </p>
    )
  const maxBots = online ? CONFIG.max_players - 1 : DRIVERS.length
  const bots = Math.min(settings.bots, maxBots)
  return (
    <div className="vr-settings">
      {mode === 'race' ? (
        <div className="field">
          <span>Laps</span>
          <Seg value={settings.laps} options={CONFIG.race_laps_options.map((n) => [n, String(n)] as [number, string])} onChange={(laps) => onChange({ ...settings, laps })} disabled={readOnly} />
        </div>
      ) : (
        <div className="field">
          <span>Time limit</span>
          <Seg
            value={settings.minutes}
            options={CONFIG.deathmatch_minutes_options.map((n) => [n, `${n} min`] as [number, string])}
            onChange={(minutes) => onChange({ ...settings, minutes })}
            disabled={readOnly}
          />
        </div>
      )}
      <label className="field">
        <span>
          AI rivals <strong>{bots}</strong>
          {online && <em className="muted small"> · fill empty grid slots, up to {CONFIG.max_players} cars</em>}
        </span>
        <input type="range" min={0} max={maxBots} value={bots} disabled={readOnly} onChange={(e) => onChange({ ...settings, bots: Number(e.target.value) })} />
      </label>
      <div className="field">
        <span>AI difficulty</span>
        <Seg
          value={settings.difficulty}
          options={[[0, 'Easy'], [1, 'Normal'], [2, 'Hard']]}
          onChange={(difficulty) => onChange({ ...settings, difficulty })}
          disabled={readOnly}
        />
      </div>
    </div>
  )
}

function CarPicker({ carId, setCarId }: { carId: string; setCarId: (id: string) => void }) {
  const car = CARS.find((c) => c.id === carId) ?? CARS[0]
  return (
    <>
      <div className="vr-cars" role="listbox" aria-label="Car">
        {CARS.map((c) => (
          <button
            key={c.id}
            role="option"
            aria-selected={c.id === carId}
            className={`vr-car ${c.id === carId ? 'is-active' : ''}`}
            onClick={() => setCarId(c.id)}
            style={{ ['--car' as string]: c.glow }}
          >
            <span className="vr-class">{c.cls}</span>
            <strong>{c.name}</strong>
            <span className="muted small">{c.archetype}</span>
          </button>
        ))}
      </div>
      <CarCard car={car} />
    </>
  )
}

function Menu(p: {
  playMode: PlayMode
  setPlayMode: (m: PlayMode) => void
  mode: Mode
  setMode: (m: Mode) => void
  settings: MatchSettings
  setSettings: (s: MatchSettings) => void
  carId: string
  setCarId: (id: string) => void
  name: string
  setName: (n: string) => void
  code: string
  setCode: (c: string) => void
  save: Save
  busy: boolean
  error: string | null
  loadPct: number
  onStart: () => void
}) {
  const lvl = fanLevel(p.save.fans)
  const lights = Object.values(p.save.lights).reduce((a, b) => a + b, 0)
  const online = p.playMode !== 'solo'
  const mode: Mode = online && p.mode === 'combat' ? 'race' : p.mode
  const canStart = !p.busy && (p.playMode !== 'join' || p.code.trim().length >= 4)
  const tabs: [PlayMode, string, ReactNode][] = [
    ['solo', 'Solo', <User key="u" size={15} />],
    ['host', 'Host online', <Globe key="g" size={15} />],
    ['join', 'Join', <LogIn key="l" size={15} />],
  ]
  const startLabel = p.busy
    ? 'Connecting…'
    : p.playMode === 'solo'
      ? mode === 'combat'
        ? 'Start series'
        : mode === 'deathmatch'
          ? 'Start deathmatch'
          : 'Start race'
      : p.playMode === 'host'
        ? 'Create room'
        : 'Join room'
  return (
    <Page onBack={() => navigate('#/home/volt-riot')} className="racer-page">
      <header className="page-header">
        <p className="eyebrow">Extras · Combat racer</p>
        <h1 className="page-title vr-title">VOLT RIOT</h1>
        <p className="page-lead">
          Neon street racing with weapons. Eight power-ups, three bay slots, ten segments of health. Race or fight solo against AI, or online with
          friends.
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
          <div className="seg" role="tablist" aria-label="Play">
            {tabs.map(([id, label, icon]) => (
              <button key={id} role="tab" aria-selected={p.playMode === id} className={`seg-btn ${p.playMode === id ? 'is-active' : ''}`} onClick={() => p.setPlayMode(id)}>
                {icon} {label}
              </button>
            ))}
          </div>

          {p.playMode !== 'join' && (
            <>
              <div className="field">
                <span>Mode</span>
                <div className="seg seg-sm">
                  <button className={`seg-btn ${mode === 'race' ? 'is-active' : ''}`} onClick={() => p.setMode('race')}>
                    <Flag size={14} /> Race
                  </button>
                  <button className={`seg-btn ${mode === 'deathmatch' ? 'is-active' : ''}`} onClick={() => p.setMode('deathmatch')}>
                    <Skull size={14} /> Deathmatch
                  </button>
                  {!online && (
                    <button className={`seg-btn ${mode === 'combat' ? 'is-active' : ''}`} onClick={() => p.setMode('combat')}>
                      <Swords size={14} /> Combat Points
                    </button>
                  )}
                </div>
              </div>
              {mode !== 'combat' && (
                <p className="muted small">
                  {mode === 'race'
                    ? 'First across the line after the set laps. Finish on the podium, meet the fan demand and complete every Fan Run (solo) for up to 5 Lights.'
                    : 'Weapons-only pickups that respawn fast. Wreck the most cars before time runs out: Combat Points scoring, and your own wrecks cost points.'}
                </p>
              )}
              <SettingsPanel mode={mode} settings={p.settings} onChange={p.setSettings} online={online} />
            </>
          )}

          {online && (
            <label className="field">
              <span>Driver name</span>
              <input value={p.name} maxLength={16} placeholder="Driver" onChange={(e) => p.setName(e.target.value)} />
            </label>
          )}
          {p.playMode === 'join' && (
            <label className="field">
              <span>Room code</span>
              <input className="code-input" value={p.code} maxLength={8} placeholder="ABC123" onChange={(e) => p.setCode(e.target.value.toUpperCase())} />
            </label>
          )}

          <CarPicker carId={p.carId} setCarId={p.setCarId} />
          <button className="btn btn-primary arena-start" disabled={!canStart} onClick={p.onStart}>
            {p.playMode === 'solo' ? <Play size={18} /> : p.playMode === 'host' ? <Globe size={18} /> : <LogIn size={18} />} {startLabel}
          </button>
          {p.error && <p className="notice">{p.error}</p>}
          {online && (
            <p className="muted small">
              Online play is peer-to-peer: the host's browser runs the race and up to {CONFIG.max_players - 1} friends join with a code. A free public
              server only introduces the browsers to each other. Some strict office or mobile networks block peer-to-peer connections.
            </p>
          )}
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
            <li><kbd>C</kbd> Look back · <kbd>R</kbd> Reset · <kbd>M</kbd> Music · <kbd>Esc</kbd> Menu</li>
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

/* ---------- Lobby ---------- */

function Lobby({
  session,
  carId,
  setCarId,
  onSettings,
  onStart,
  onLeave,
  loadPct,
}: {
  session: Session
  carId: string
  setCarId: (id: string) => void
  onSettings: (s: MatchSettings) => void
  onStart: () => void
  onLeave: () => void
  loadPct: number
}) {
  const host = session.link.isHost
  const [copied, setCopied] = useState(false)
  const invite = `${window.location.origin}${window.location.pathname}${window.location.search}#/racer?join=${session.link.code}`
  const s = session.settings
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this invite link', invite)
    }
  }
  const bots = Math.max(0, Math.min(s.bots, CONFIG.max_players - session.players.length))
  return (
    <Page onBack={onLeave} backLabel="Leave" className="racer-page">
      <header className="page-header">
        <p className="eyebrow">VOLT RIOT · Online lobby</p>
        <h1 className="page-title vr-title">{s.mode === 'deathmatch' ? 'Deathmatch' : 'Race'} room</h1>
        <p className="page-lead">
          {s.mode === 'deathmatch' ? `${s.minutes} minutes, weapons only` : `${s.laps} lap${s.laps > 1 ? 's' : ''}`} · {session.players.length} driver
          {session.players.length === 1 ? '' : 's'} + {bots} AI
        </p>
      </header>
      <div className="vr-grid">
        <section className="arena-panel">
          <div className="vr-code">
            <span className="muted small">Room code</span>
            <strong>{session.link.code}</strong>
            <button className="pill" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy invite link'}
            </button>
          </div>
          <h2 className="section-title">
            <Users size={14} /> Drivers
          </h2>
          <ul className="vr-lobby">
            {session.players.map((pl) => {
              const car = CARS.find((c) => c.id === pl.carId)
              return (
                <li key={pl.id} style={{ ['--car' as string]: car?.glow ?? '#fff' }}>
                  {pl.id === 'host' && <Crown size={14} className="vr-crown" aria-label="Host" />}
                  <strong>{pl.name}</strong>
                  <span className="muted small">{car?.name}</span>
                  {pl.id === session.link.selfId && <em className="muted small">you</em>}
                </li>
              )
            })}
            {Array.from({ length: bots }, (_, i) => (
              <li key={`ai-${i}`} className="is-ai">
                <strong>{DRIVERS[i].name}</strong>
                <span className="muted small">AI · {CARS.find((c) => c.id === DRIVERS[i].car)?.name}</span>
              </li>
            ))}
          </ul>
          <h2 className="section-title">Game settings</h2>
          <div className="field">
            <span>Mode</span>
            <Seg
              value={s.mode}
              options={[
                ['race', 'Race'],
                ['deathmatch', 'Deathmatch'],
              ]}
              onChange={(mode) => onSettings({ ...s, mode })}
              disabled={!host}
            />
          </div>
          <SettingsPanel mode={s.mode} settings={s} onChange={onSettings} readOnly={!host} online />
          {host ? (
            <button className="btn btn-primary arena-start" disabled={loadPct < 1} onClick={onStart}>
              <Play size={18} /> {loadPct < 1 ? `Loading ${Math.round(loadPct * 100)}%` : 'Start match'}
            </button>
          ) : (
            <p className="notice">Waiting for the host to start…</p>
          )}
          <p className="muted small">Anyone can join until the host starts. Players who drop out are taken over by an AI driver.</p>
        </section>
        <section className="arena-panel arena-info">
          <h2 className="section-title">Your car</h2>
          <CarPicker carId={carId} setCarId={setCarId} />
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
