// BOGEY BRAWL page: menu, the running hole (canvas + HUD) and the results table.
import { useEffect, useRef, useState } from 'react'
import { Bomb, Check, Coffee, Copy, Crosshair, Flag, Footprints, Globe, LogIn, LogOut, Magnet, Megaphone, Play, Rocket, RotateCcw, Shield, Snowflake, Target, Trophy, User, Users } from 'lucide-react'
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
import { hostRoom, isGolfMsg, joinRoom, MAX_GOLFERS, type GolfMsg, type GolfNet, type GolfSlot, type Link, type LobbyGolfer } from './net'

const accent = tiles.find((t) => t.id === 'bogey-brawl')?.accent ?? (['#14532d', '#bef264'] as [string, string])

const ITEMS: Record<string, { name: string; color: string; icon: typeof Rocket; help: string }> = {
  rocket: { name: 'Rocket Launcher', color: '#f97316', icon: Rocket, help: 'Homes in on the rival closest to your aim. Big knockback, and it can launch balls too.' },
  pistol: { name: 'Dueling Pistol', color: '#facc15', icon: Crosshair, help: 'Instant hitscan shot at 50 m. Stuns, and cancels a charging swing.' },
  shield: { name: 'Electromagnet', color: '#38bdf8', icon: Magnet, help: `A ${CONFIG.shield_duration} s bubble that blocks rockets and bullets and pushes rivals away.` },
  landmine: { name: 'Landmine', color: '#ef4444', icon: Bomb, help: `A pack of ${CONFIG.landmine_charges}: drop them behind you on the fairway. They arm after a second.` },
  airhorn: { name: 'Air Horn', color: '#a3e635', icon: Megaphone, help: `Blasts back everyone within ${CONFIG.airhorn_range} m, and their loose balls go flying.` },
  coffee: { name: 'Coffee', color: '#a16207', icon: Coffee, help: `${CONFIG.coffee_duration} s of running at ${Math.round(CONFIG.boost_speed_mult * 100)}% speed.` },
  freeze: { name: 'Freeze Bomb', color: '#bae6fd', icon: Snowflake, help: `Lobbed ${CONFIG.freeze_throw} m ahead: anyone in the blast is frozen for ${CONFIG.freeze_duration} s and balls stop dead.` },
  springboots: { name: 'Spring Boots', color: '#22d3ee', icon: Footprints, help: `A ${CONFIG.springboots_distance} m leap along your aim. Mind the lake.` },
  elephant: { name: 'Elephant Gun', color: '#78716c', icon: Target, help: `A huge blast in a cone at up to ${CONFIG.elephant_range} m. The recoil throws you back too.` },
}

type PlayMode = 'solo' | 'host' | 'join'

interface Session {
  link: Link
  players: LobbyGolfer[]
  bots: number
  difficulty: number
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

/** People first, then bots to fill the tee. */
function buildSlots(players: LobbyGolfer[], bots: number): GolfSlot[] {
  const humans: GolfSlot[] = players.slice(0, MAX_GOLFERS).map((p) => ({ kind: 'human', id: p.id, name: p.name }))
  const n = Math.max(0, Math.min(bots, MAX_GOLFERS - humans.length))
  const names = ['Mulligan', 'Birdie', 'Divot']
  return [...humans, ...Array.from({ length: n }, (_, i) => ({ kind: 'ai' as const, id: `ai-${i}`, name: names[i % names.length] }))]
}

const DIFFS = ['Easy', 'Normal', 'Hard'] as const

type Stage = 'menu' | 'lobby' | 'play' | 'results'

export function Golf({ auto, onAccent }: { auto?: boolean; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'bogey-brawl'), [onAccent])
  const [stage, setStage] = useState<Stage>(auto ? 'play' : 'menu')
  const [playMode, setPlayMode] = useState<PlayMode>('solo')
  const [difficulty, setDifficulty] = useState(1)
  const [bots, setBots] = useState(3)
  const [name, setName] = useState(() => stored('bb-name', 'Golfer'))
  const [code, setCode] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [net, setNet] = useState<GolfNet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [assets, setAssets] = useState<GolfAssets | null>(null)
  const [loadPct, setLoadPct] = useState(0)
  const [result, setResult] = useState<HoleResult | null>(null)
  const [run, setRun] = useState(0)
  const stageRef = useRef(stage)
  stageRef.current = stage

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

  // Close the room when leaving the page.
  const linkRef = useRef<Link | null>(null)
  linkRef.current = session?.link ?? null
  useEffect(() => () => linkRef.current?.close(), [])

  // Lobby traffic (the running hole has its own listener inside the game).
  useEffect(() => {
    if (!session) return
    const { link } = session
    const offMsg = link.onMessage((m, from) => {
      if (!isGolfMsg(m)) return
      if (link.isHost) {
        if (m.t === 'g-hello') {
          setSession((s) => {
            if (!s) return s
            if (stageRef.current !== 'lobby' || s.players.length >= MAX_GOLFERS) {
              link.send({ t: 'g-full' } satisfies GolfMsg, from)
              return s
            }
            const players = [...s.players.filter((p) => p.id !== from), { id: from, name: m.name.slice(0, 16) || 'Golfer' }]
            const next = { ...s, players }
            link.send({ t: 'g-lobby', players, bots: s.bots, difficulty: s.difficulty } satisfies GolfMsg)
            return next
          })
        }
      } else if (m.t === 'g-lobby') setSession((s) => (s ? { ...s, players: m.players, bots: m.bots, difficulty: m.difficulty } : s))
      else if (m.t === 'g-start') {
        setNet({ link, role: 'client', slots: m.setup.slots })
        setRun((r) => r + 1)
        setStage('play')
      } else if (m.t === 'g-lobbyback') setStage('lobby')
      else if (m.t === 'g-full') {
        setError('That room is full or already playing.')
        leave()
      }
    })
    const offPeer = link.onPeer((ev, id) => {
      if (link.isHost && ev === 'leave') {
        setSession((s) => {
          if (!s) return s
          const players = s.players.filter((p) => p.id !== id)
          link.send({ t: 'g-lobby', players, bots: s.bots, difficulty: s.difficulty } satisfies GolfMsg)
          return { ...s, players }
        })
      }
      if (!link.isHost && ev === 'leave' && id === 'host') {
        setError('The host closed the room.')
        leave()
      }
    })
    if (!link.isHost) link.send({ t: 'g-hello', name: stored('bb-name', 'Golfer') || 'Golfer' } satisfies GolfMsg)
    return () => {
      offMsg()
      offPeer()
    }
    // Re-subscribe only when the room changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.link])

  // Host: keep everyone's lobby view in step with the settings.
  useEffect(() => {
    if (session?.link.isHost) session.link.send({ t: 'g-lobby', players: session.players, bots: session.bots, difficulty: session.difficulty } satisfies GolfMsg)
  }, [session?.bots, session?.difficulty, session?.link, session?.players])

  function leave() {
    session?.link.close()
    setSession(null)
    setNet(null)
    setStage('menu')
  }

  async function openRoom() {
    setError(null)
    setBusy(true)
    store('bb-name', name)
    try {
      if (playMode === 'host') {
        const link = await hostRoom()
        setSession({ link, players: [{ id: 'host', name: name || 'Host' }], bots: Math.min(bots, MAX_GOLFERS - 1), difficulty })
      } else {
        const link = await joinRoom(code)
        // Say hello once the lobby listener is attached (below), so the host's reply isn't missed.
        setSession({ link, players: [], bots: 0, difficulty: 1 })
      }
      setStage('lobby')
    } catch (e) {
      setError((e as Error).message || 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  function startOnline() {
    if (!session) return
    const slots = buildSlots(session.players, session.bots)
    session.link.send({ t: 'g-start', setup: { slots, difficulty: session.difficulty } } satisfies GolfMsg)
    setNet({ link: session.link, role: 'host', slots })
    setDifficulty(session.difficulty)
    setRun((r) => r + 1)
    setStage('play')
  }

  if (stage === 'play')
    return (
      <GolfStage
        key={run}
        assets={assets}
        loadPct={loadPct}
        difficulty={net ? (session?.difficulty ?? difficulty) : difficulty}
        bots={bots}
        net={net}
        onResult={(r) => {
          setResult(r)
          setStage('results')
        }}
        onQuit={() => (net ? leave() : setStage('menu'))}
        onDisconnect={(why) => {
          setError(why)
          leave()
        }}
      />
    )

  if (stage === 'results' && result)
    return (
      <Results
        result={result}
        online={net ? (net.role === 'host' ? 'host' : 'client') : null}
        onAgain={() => {
          if (net && session) {
            session.link.send({ t: 'g-lobbyback' } satisfies GolfMsg)
            setStage('lobby')
            return
          }
          setRun((r) => r + 1)
          setStage('play')
        }}
        onMenu={() => (net ? leave() : setStage('menu'))}
      />
    )

  if (stage === 'lobby' && session)
    return (
      <Lobby
        session={session}
        onBots={(n) => setSession((s) => (s ? { ...s, bots: n } : s))}
        onDifficulty={(d) => setSession((s) => (s ? { ...s, difficulty: d } : s))}
        onStart={startOnline}
        onLeave={leave}
        canStart={!!assets}
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
          <div className="seg" role="tablist" aria-label="Play">
            {(
              [
                ['solo', 'Solo', <User key="u" size={16} />],
                ['host', 'Host online', <Globe key="g" size={16} />],
                ['join', 'Join', <LogIn key="l" size={16} />],
              ] as const
            ).map(([id, label, icon]) => (
              <button key={id} role="tab" aria-selected={playMode === id} className={`seg-btn ${playMode === id ? 'is-active' : ''}`} onClick={() => setPlayMode(id)}>
                {icon} {label}
              </button>
            ))}
          </div>
          {playMode !== 'join' && (
            <>
              <div className="field">
                <span>{playMode === 'solo' ? 'Rivals' : 'Bots to fill the tee'}</span>
                <div className="seg seg-sm">
                  {(playMode === 'solo' ? [1, 2, 3] : [0, 1, 2, 3]).map((n) => (
                    <button key={n} className={`seg-btn ${bots === n ? 'is-active' : ''}`} onClick={() => setBots(n)}>
                      {n} bot{n === 1 ? '' : 's'}
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
            </>
          )}
          {playMode !== 'solo' && (
            <label className="field">
              <span>Your name</span>
              <input value={name} maxLength={16} placeholder="Golfer" onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {playMode === 'join' && (
            <label className="field">
              <span>Room code</span>
              <input className="code-input" value={code} maxLength={8} placeholder="ABC123" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
          )}
          <p className="muted small">
            Scoring: {CONFIG.points_first} / {CONFIG.points_second} / {CONFIG.points_third} / {CONFIG.points_fourth} points by finishing order, +
            {CONFIG.points_under_par} under par, +{CONFIG.points_knockout} per knockout. Still out when overtime ends: {CONFIG.overtime_timeout_penalty}.
          </p>
          <button
            className="btn btn-primary arena-start"
            disabled={busy || (playMode === 'join' && code.trim().length < 4)}
            onClick={() => {
              uiSound('select')
              if (playMode === 'solo') {
                setNet(null)
                setRun((r) => r + 1)
                setStage('play')
              } else void openRoom()
            }}
          >
            {playMode === 'solo' ? <Play size={18} /> : playMode === 'host' ? <Globe size={18} /> : <LogIn size={18} />}{' '}
            {playMode === 'solo' ? 'Tee off' : playMode === 'host' ? (busy ? 'Creating…' : 'Create room') : busy ? 'Joining…' : 'Join room'}
          </button>
          {error && <p className="notice">{error}</p>}
          {playMode !== 'solo' && (
            <p className="muted small">
              Up to {MAX_GOLFERS} golfers. Online play is peer-to-peer: the host's browser runs the hole and friends join with the code. Some strict office or
              mobile networks block peer-to-peer connections.
            </p>
          )}
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
          <p className="muted small">Grab them from briefcases dotted along the hole. Three slots; Landmines come in packs of {CONFIG.landmine_charges}.</p>
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

function GolfStage(p: {
  assets: GolfAssets | null
  loadPct: number
  difficulty: number
  bots: number
  net: GolfNet | null
  onResult: (r: HoleResult) => void
  onQuit: () => void
  onDisconnect: (why: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const ready = !!p.assets
  const { onResult, onDisconnect } = p

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
      game = new Game(host.current, { difficulty: p.difficulty, bots: p.bots, assets: p.assets, autopilot: q.has('autopilot'), net: p.net ?? undefined })
      game.onHud = setHud
      game.onResult = (r) => window.setTimeout(() => onResult(r), 2500)
      game.onDisconnect = onDisconnect
      // Tests: `?snap` exposes the game with no live loop (advance it with simulate()); `?net=local` exposes it live.
      if (q.get('net') === 'local') (window as unknown as { __golf: Game }).__golf = game
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
            <span>
              {r.name}
              {r.me && <span className="muted"> (you)</span>}
            </span>
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

function Results({ result, online, onAgain, onMenu }: { result: HoleResult; online: 'host' | 'client' | null; onAgain: () => void; onMenu: () => void }) {
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
                  {r.me && <span className="muted small"> (you)</span>}
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
          {online !== 'client' ? (
            <button className="btn btn-primary" onClick={onAgain}>
              <RotateCcw size={16} /> {online === 'host' ? 'Back to the lobby' : 'Play again'}
            </button>
          ) : (
            <span className="muted small">Waiting for the host to start another round…</span>
          )}
          <button className="btn" onClick={onMenu}>
            {online ? 'Leave' : 'Menu'}
          </button>
        </div>
      </section>
    </Page>
  )
}

function Lobby(p: { session: Session; onBots: (n: number) => void; onDifficulty: (d: number) => void; onStart: () => void; onLeave: () => void; canStart: boolean }) {
  const { session } = p
  const host = session.link.isHost
  const [copied, setCopied] = useState(false)
  const slots = buildSlots(session.players, session.bots)
  return (
    <Page onBack={p.onLeave} backLabel="Leave" className="racer-page golf-page">
      <header className="page-header">
        <p className="eyebrow">BOGEY BRAWL · Online</p>
        <h1 className="page-title bb-title">{host ? 'Your room' : 'Lobby'}</h1>
        <p className="page-lead">{host ? 'Share the code. Everyone tees off together when you start.' : 'Waiting for the host to start the hole…'}</p>
      </header>
      <div className="vr-grid">
        <section className="arena-panel">
          <div className="bb-code">
            <span className="muted small">Room code</span>
            <strong data-testid="room-code">{session.link.code}</strong>
            <button
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(session.link.code).then(() => setCopied(true))
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <h2 className="section-title">
            <Users size={16} /> On the tee ({slots.length}/{MAX_GOLFERS})
          </h2>
          <ul className="bb-lobby">
            {slots.map((s) => (
              <li key={s.id}>
                {s.kind === 'human' ? <User size={14} /> : <span className="bb-bot">BOT</span>} {s.name}
                {s.id === 'host' && <span className="muted small"> · host</span>}
                {s.id === session.link.selfId && <span className="muted small"> · you</span>}
              </li>
            ))}
          </ul>
          {host ? (
            <>
              <div className="field">
                <span>Bots to fill the tee</span>
                <div className="seg seg-sm">
                  {[0, 1, 2, 3].map((n) => (
                    <button key={n} className={`seg-btn ${session.bots === n ? 'is-active' : ''}`} onClick={() => p.onBots(n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Bot difficulty</span>
                <div className="seg seg-sm">
                  {DIFFS.map((d, i) => (
                    <button key={d} className={`seg-btn ${session.difficulty === i ? 'is-active' : ''}`} onClick={() => p.onDifficulty(i)}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary arena-start" disabled={!p.canStart || slots.length < 2} onClick={p.onStart}>
                <Play size={18} /> Start the hole
              </button>
              {slots.length < 2 && <p className="muted small">Add a bot or wait for a friend to join.</p>}
            </>
          ) : (
            <p className="muted small">The host picks bots and difficulty.</p>
          )}
          <button className="btn" onClick={p.onLeave}>
            <LogOut size={16} /> Leave
          </button>
        </section>
        <section className="arena-panel arena-info">
          <h2 className="section-title">How online works</h2>
          <p className="muted small">
            The host's browser runs the hole and streams it to everyone at 20 updates a second; your own golfer moves instantly on your screen. If someone
            leaves, a bot takes over their golfer. If the host leaves, the round ends.
          </p>
        </section>
      </div>
    </Page>
  )
}
