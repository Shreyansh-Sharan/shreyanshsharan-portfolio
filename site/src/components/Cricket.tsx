import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleDot, Copy, Expand, LogOut, Users } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { Page } from './Page'
import { AdSlot } from './AdSlot'
import { GearShelf } from './GearShelf'
import { useGameAds } from '../lib/ads'

const accent = tiles.find((t) => t.id === 'cricket')?.accent ?? (['#14532d', '#86efac'] as [string, string])
const GAME_URL = 'games/cricket/index.html'

type Mode = 'quick' | 'host' | 'join'

const FORMATS = [
  { id: 't20', label: 'T20', blurb: '20 overs a side, powerplay for the first 6. The default.' },
  { id: 't10', label: 'T10', blurb: 'A quick 10-over thrash.' },
  { id: 'odi', label: 'ODI', blurb: '50 overs a side: the long game, ball age and reverse swing.' },
  { id: 'super', label: 'Super Over', blurb: 'One over each, two wickets: the tie-breaker on its own.' },
] as const

// Fictional sides that ship with the game ('mine' uses the team saved in the in-game team builder).
const TEAMS = [
  { id: 'mine', label: 'My team (team builder)' },
  { id: 'northland', label: 'Northland' },
  { id: 'southern-isles', label: 'Southern Isles' },
  { id: 'eastvale', label: 'Eastvale' },
  { id: 'westmark', label: 'Westmark' },
  { id: 'coral-coast', label: 'Coral Coast' },
  { id: 'red-mesa', label: 'Red Mesa' },
  { id: 'highland-union', label: 'Highland Union' },
  { id: 'sunfield', label: 'Sunfield' },
] as const

const PITCHES = [
  { id: 'green', label: 'Green seamer' },
  { id: 'flat', label: 'Flat road' },
  { id: 'dusty', label: 'Dry turner' },
] as const

const TIMES = [
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
] as const

interface CricketMessage {
  source: 'cricket'
  type: 'ready' | 'loaded' | 'progress' | 'started' | 'code' | 'error' | 'left' | 'result' | 'adbreak' | 'rewarded'
  payload?: string
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
    // Private mode: not remembered, that's fine.
  }
}

/** Preloading costs bandwidth: skip it on data-saver connections and small touch screens. */
function shouldPreload() {
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
    if (nav.connection?.saveData) return false
    if (nav.connection?.effectiveType && /(^|-)2g$/.test(nav.connection.effectiveType)) return false
    return !window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches
  } catch {
    return true
  }
}

/**
 * Lobby for the Unity WebGL cricket game. The build preloads in a hidden iframe as soon as the page opens (with a
 * real progress bar from the Unity loader), so pressing Play just reveals it and posts the match settings in.
 */
export function Cricket({ join, onAccent }: { join?: string; onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'cricket'), [onAccent])

  const [mode, setMode] = useState<Mode>(join ? 'join' : 'quick')
  const [format, setFormat] = useState(() => stored('cricket-format', 't20'))
  const [team, setTeam] = useState(() => stored('cricket-team', 'northland'))
  const [opp, setOpp] = useState(() => stored('cricket-opp', 'eastvale'))
  const [skill, setSkill] = useState(1)
  const [pitch, setPitch] = useState('flat')
  const [time, setTime] = useState('night')
  const [manualField, setManualField] = useState(false)
  const [code, setCode] = useState((join ?? '').toUpperCase())
  const [available, setAvailable] = useState<boolean | null>(null)
  const [frameSrc, setFrameSrc] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  // The game asks for ad breaks between innings and matches, and for a rewarded ad (an extra review).
  useGameAds(frame, 'cricket')

  useEffect(() => {
    let cancelled = false
    // Dev servers answer unknown .html paths with the site itself, so look for the Unity loader, not just a 200.
    fetch(GAME_URL, { cache: 'no-store' })
      .then(async (r) => {
        const ok = r.ok && (await r.text()).includes('createUnityInstance')
        if (cancelled) return
        setAvailable(ok)
        if (ok && shouldPreload()) setFrameSrc(`${GAME_URL}?mode=lobby`)
      })
      .catch(() => !cancelled && setAvailable(false))
    return () => {
      cancelled = true
    }
  }, [])

  const stop = useCallback(() => {
    setPlaying(false)
    setInvite(null)
    // Reload the game into a fresh lobby so the next match starts clean (and online sessions are closed).
    setReady(false)
    setProgress(0)
    setFrameSrc(available ? `${GAME_URL}?mode=lobby&t=${Date.now()}` : null)
  }, [available])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!frame.current || ev.source !== frame.current.contentWindow) return
      const msg = ev.data as CricketMessage
      if (!msg || msg.source !== 'cricket') return
      switch (msg.type) {
        case 'progress':
          setProgress(Math.max(0, Math.min(1, Number(msg.payload) || 0)))
          break
        case 'ready':
          setProgress(1)
          break
        case 'loaded':
          setReady(true)
          break
        case 'code':
          setInvite(msg.payload ?? null)
          break
        case 'error':
          setError(msg.payload || 'Something went wrong.')
          break
        case 'started':
          setError(null)
          break
        case 'left':
          stop()
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [stop])

  // Pause the site's 3D scene while the game is on screen so the GPU is all the game's.
  useEffect(() => {
    if (!playing) return
    window.dispatchEvent(new CustomEvent('arena-running', { detail: true }))
    return () => {
      window.dispatchEvent(new CustomEvent('arena-running', { detail: false }))
    }
  }, [playing])

  const canStart = available === true && (mode !== 'join' || code.trim().length >= 4)

  const query = () => {
    const params = new URLSearchParams({
      mode,
      format,
      team: team === 'mine' ? '' : team,
      opp,
      diff: String(skill),
      pitch,
      time,
      field: manualField ? 'manual' : 'auto',
    })
    if (mode === 'join') params.set('code', code.trim().toUpperCase())
    return params.toString()
  }

  const start = () => {
    if (!canStart) return
    store('cricket-format', format)
    store('cricket-team', team)
    store('cricket-opp', opp)
    play('select')
    setError(null)
    const q = query()
    if (!frameSrc) setFrameSrc(`${GAME_URL}?${q}`)
    else frame.current?.contentWindow?.postMessage({ type: 'start', query: q }, '*')
    setPlaying(true)
    window.setTimeout(() => frame.current?.focus(), 50)
  }

  const inviteLink = useMemo(() => {
    if (!invite) return ''
    return `${window.location.origin}${window.location.pathname}#/cricket?join=${encodeURIComponent(invite)}`
  }, [invite])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this invite link', inviteLink)
    }
  }

  const loadingText = !frameSrc ? null : ready ? 'Game ready' : progress < 1 ? `Preloading the game… ${Math.round(progress * 100)}%` : 'Building the stadium…'

  return (
    <>
      {!playing && (
        <Page onBack={() => navigate('#/home/cricket')} className="arena-page">
          <header className="page-header">
            <p className="eyebrow">Games · Unity 6</p>
            <h1 className="page-title">Cricket</h1>
            <p className="page-lead">
              A realistic cricket game in the browser: real ball physics (swing, seam, spin and bounce off green, flat or
              dusty pitches), timing-based batting with footwork, bowling with a landing marker and release meter, AI
              fielders who dive and throw, DRS ball-tracking, and a broadcast-style presentation. Play the CPU or a friend
              online.
            </p>
          </header>

          <div className="arena-grid">
            <section className="arena-panel">
              <div className="seg" role="tablist" aria-label="Mode">
                {(
                  [
                    ['quick', 'Quick match vs CPU'],
                    ['host', 'Host online'],
                    ['join', 'Join with code'],
                  ] as [Mode, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={mode === id}
                    className={`seg-btn ${mode === id ? 'is-active' : ''}`}
                    onClick={() => setMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode !== 'join' && (
                <div className="field">
                  <span>Format</span>
                  <div className="seg seg-sm">
                    {FORMATS.map(({ id, label }) => (
                      <button key={id} className={`seg-btn ${format === id ? 'is-active' : ''}`} onClick={() => setFormat(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="muted small">{FORMATS.find((f) => f.id === format)?.blurb}</span>
                </div>
              )}

              <label className="field">
                <span>Your team</span>
                <select className="cricket-select" value={team} onChange={(e) => setTeam(e.target.value)}>
                  {TEAMS.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              {mode === 'quick' && (
                <>
                  <label className="field">
                    <span>Opponent</span>
                    <select className="cricket-select" value={opp} onChange={(e) => setOpp(e.target.value)}>
                      {TEAMS.filter((t) => t.id !== 'mine' && t.id !== team).map(({ id, label }) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field">
                    <span>Difficulty</span>
                    <div className="seg seg-sm">
                      {['Easy', 'Normal', 'Hard'].map((label, i) => (
                        <button key={label} className={`seg-btn ${skill === i ? 'is-active' : ''}`} onClick={() => setSkill(i)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {mode !== 'join' && (
                <>
                  <div className="field">
                    <span>Pitch</span>
                    <div className="seg seg-sm">
                      {PITCHES.map(({ id, label }) => (
                        <button key={id} className={`seg-btn ${pitch === id ? 'is-active' : ''}`} onClick={() => setPitch(id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span>Time of day</span>
                    <div className="seg seg-sm">
                      {TIMES.map(({ id, label }) => (
                        <button key={id} className={`seg-btn ${time === id ? 'is-active' : ''}`} onClick={() => setTime(id)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {mode === 'quick' && (
                <label className="field cricket-check">
                  <input type="checkbox" checked={manualField} onChange={(e) => setManualField(e.target.checked)} />
                  <span>Manual fielding (catch prompts and aimed throws)</span>
                </label>
              )}

              {mode === 'join' && (
                <label className="field">
                  <span>Invite code</span>
                  <input
                    className="code-input"
                    value={code}
                    maxLength={12}
                    placeholder="ABC123"
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                </label>
              )}

              <button className="btn btn-primary arena-start" disabled={!canStart} onClick={start}>
                <CircleDot size={18} /> {mode === 'quick' ? 'Play' : mode === 'host' ? 'Create match' : 'Join match'}
              </button>
              {loadingText && (
                <div className="cricket-progress" aria-live="polite">
                  <div className="cricket-progress-bar">
                    <div style={{ width: `${Math.round((ready ? 1 : progress) * 100)}%` }} />
                  </div>
                  <span className="muted small">{loadingText}</span>
                </div>
              )}
              {mode === 'host' && (
                <p className="muted small">
                  You'll get a code and an invite link once the match is up. Online play needs the game linked to a Unity Cloud
                  project; if it isn't, the game shows the exact error.
                </p>
              )}
              {available === false && (
                <p className="notice">
                  The game build isn't published yet. Open <code>unity/CricketGame</code> in Unity 6 and run{' '}
                  <strong>Cricket → 2. Build WebGL into Portfolio Site</strong>, then redeploy.
                </p>
              )}
              <p className="muted small mobile-only">Best on a desktop with a mouse and keyboard (gamepads work too).</p>
            </section>

            <section className="arena-panel arena-info">
              <h2 className="section-title">Batting</h2>
              <ul className="keys">
                <li><kbd>Mouse</kbd> aim the shot · <kbd>Click</kbd> play it (stroke picked from aim, feet and ball)</li>
                <li><kbd>Shift</kbd> loft · <kbd>Right click</kbd> defend · <kbd>Space</kbd> leave</li>
                <li><kbd>W</kbd>/<kbd>S</kbd> front / back foot · <kbd>1</kbd>–<kbd>5</kbd> drive, cut, pull, sweep, flick</li>
                <li><kbd>R</kbd> run · <kbd>F</kbd> send back · <kbd>Space</kbd> slide the bat in</li>
              </ul>
              <h2 className="section-title">Bowling</h2>
              <ul className="keys">
                <li><kbd>Mouse</kbd> place the landing marker · <kbd>Q</kbd>/<kbd>E</kbd> delivery</li>
                <li><kbd>Click</kbd> run in, then again in the green to release</li>
                <li><kbd>F</kbd> set the field · <kbd>V</kbd> over / round the wicket</li>
              </ul>
              <h2 className="section-title">Everything else</h2>
              <p className="muted small">
                <kbd>R</kbd> review a decision (DRS) · <kbd>C</kbd> camera · <kbd>Tab</kbd> scorecard, wagon wheel and pitch map ·
                <kbd>H</kbd> all controls · <kbd>Esc</kbd> pause. Gamepad: left stick aims, A/Y/X/B play shots, RB runs. Build
                your own XI (names, kit colours, roles and ratings) in the game's Team builder.
              </p>
            </section>
          </div>
          <AdSlot />
          <GearShelf topic="cricket" />
        </Page>
      )}

      <div className={playing ? 'arena-player' : 'cricket-preload'} aria-hidden={!playing}>
        {playing ? (
          <div className="arena-bar">
            <button className="pill" onClick={stop}>
              <LogOut size={16} /> Exit
            </button>
            {invite && (
              <div className="invite">
                <Users size={16} />
                <span className="muted">Invite code</span>
                <strong>{invite}</strong>
                <button className="pill" onClick={copy}>
                  {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            )}
            {!ready && progress < 1 && <span className="muted small">Loading… {Math.round(progress * 100)}%</span>}
            {error && <span className="arena-error">{error}</span>}
            <button className="icon-btn" aria-label="Full screen" onClick={() => frame.current?.requestFullscreen?.()}>
              <Expand size={16} />
            </button>
          </div>
        ) : null}
        {frameSrc && (
          <iframe
            ref={frame}
            className="arena-frame"
            src={frameSrc}
            title="Cricket"
            tabIndex={playing ? 0 : -1}
            allow="fullscreen; autoplay; clipboard-write; gamepad"
            allowFullScreen
          />
        )}
      </div>
    </>
  )
}
