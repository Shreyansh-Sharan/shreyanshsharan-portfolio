// Cricket lobby: quick match against the CPU, host or join an online 1v1, the team builder, and the match itself
// (an in-site three.js game, loaded on demand).
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleDot, Copy, Globe, LogIn, Users, Wrench } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { Page } from './Page'
import { AdSlot } from './AdSlot'
import { GearShelf } from './GearShelf'
import { FORMATS, type MatchFormat, type MatchSetup } from '../cricket/sim/match'
import { allTeams, cloneTeam, findTeam, type Team } from '../cricket/sim/teams'
import type { PitchType, TimeOfDay } from '../cricket/sim/conditions'
import { savedQuality, saveQuality, detectQuality, type QualityTier } from '../cricket/quality'
import { TeamBuilder } from '../cricket/ui/TeamBuilder'
import type { CricketNet } from '../cricket/net'

const CricketStage = lazy(() => import('../cricket/ui/CricketStage'))

const accent = tiles.find((t) => t.id === 'cricket')?.accent ?? (['#14532d', '#86efac'] as [string, string])

type Mode = 'quick' | 'host' | 'join'
type Stage = 'menu' | 'builder' | 'lobby' | 'play'

const PITCHES: { id: PitchType; label: string }[] = [
  { id: 'green', label: 'Green seamer' },
  { id: 'flat', label: 'Flat road' },
  { id: 'dusty', label: 'Dry turner' },
]
const TIMES: { id: TimeOfDay; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
]

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
    // Private mode: not remembered.
  }
}

interface Play {
  setup: MatchSetup
  sideHuman: [boolean, boolean]
  localSide: number
  net: CricketNet | null
  key: number
}

export function Cricket({ join, auto, onAccent }: { join?: string; auto?: boolean; onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'cricket'), [onAccent])
  const q = new URLSearchParams(window.location.search)
  const [stage, setStage] = useState<Stage>('menu')
  const [mode, setMode] = useState<Mode>(join ? 'join' : 'quick')
  const [format, setFormat] = useState<MatchFormat>(() => (q.get('format') as MatchFormat) || (stored('cricket-format', 't20') as MatchFormat))
  const [teams, setTeams] = useState<Team[]>(allTeams)
  const [team, setTeam] = useState(() => stored('cricket-team', 'northland'))
  const [opp, setOpp] = useState(() => stored('cricket-opp', 'eastvale'))
  const [skill, setSkill] = useState(() => Number(stored('cricket-diff', '1')))
  const [pitch, setPitch] = useState<PitchType>(() => (q.get('pitch') as PitchType) || (stored('cricket-pitch', 'flat') as PitchType))
  const [time, setTime] = useState<TimeOfDay>(() => (q.get('time') as TimeOfDay) || (stored('cricket-time', 'night') as TimeOfDay))
  const [quality, setQuality] = useState<QualityTier | 'auto'>(savedQuality)
  const [code, setCode] = useState((join ?? '').toUpperCase())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [net, setNet] = useState<CricketNet | null>(null)
  const [guestTeam, setGuestTeam] = useState<Team | null>(null)
  const [copied, setCopied] = useState(false)
  const [playing, setPlaying] = useState<Play | null>(null)
  const netRef = useRef<CricketNet | null>(null)
  netRef.current = net

  const teamOf = (id: string) => findTeam(id) ?? cloneTeam(teams[0])

  const makeSetup = (a: Team, b: Team): MatchSetup => ({
    format,
    difficulty: skill as 0 | 1 | 2,
    pitch,
    time,
    superOverOnTie: true,
    seed: Number(q.get('seed')) || Math.floor(Math.random() * 1e9),
    teams: [a, b],
    online: false,
  })

  const remember = () => {
    store('cricket-format', format)
    store('cricket-team', team)
    store('cricket-opp', opp)
    store('cricket-diff', String(skill))
    store('cricket-pitch', pitch)
    store('cricket-time', time)
  }

  const startQuick = () => {
    remember()
    play('select')
    const a = teamOf(team)
    let b = teamOf(opp)
    if (b.id === a.id) b = cloneTeam(teams.find((t) => t.id !== a.id) ?? teams[1])
    setPlaying({ setup: makeSetup(a, b), sideHuman: [true, false], localSide: 0, net: null, key: Date.now() })
    setStage('play')
  }

  // `#/cricket?auto` starts a quick match straight away (tests and links).
  useEffect(() => {
    if (auto) startQuick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  // Close the room when leaving the page.
  useEffect(() => () => netRef.current?.link.close(), [])

  async function openRoom() {
    setError(null)
    setBusy(true)
    remember()
    try {
      const mod = await import('../cricket/net')
      if (mode === 'host') {
        const link = await mod.hostRoom()
        const n: CricketNet = { link, role: 'host' }
        setNet(n)
        link.onMessage((m) => {
          if (!mod.isCricketMsg(m)) return
          if (m.t === 'c-hello') setGuestTeam(m.team)
        })
        link.onPeer((ev) => ev === 'leave' && setGuestTeam(null))
      } else {
        const link = await mod.joinRoom(code)
        const n: CricketNet = { link, role: 'client' }
        setNet(n)
        link.onMessage((m) => {
          if (!mod.isCricketMsg(m)) return
          if (m.t === 'c-start') {
            setPlaying({ setup: m.setup, sideHuman: [true, true], localSide: 1, net: n, key: Date.now() })
            setStage('play')
          }
        })
        link.onPeer((ev, id) => {
          if (ev === 'leave' && id === 'host') {
            setError('The host closed the room.')
            setStage('menu')
            setNet(null)
          }
        })
        link.send({ t: 'c-hello', team: teamOf(team) })
      }
      setStage('lobby')
    } catch (e) {
      setError((e as Error).message || 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  const startOnline = () => {
    if (!net || !guestTeam) return
    const mine = teamOf(team)
    let theirs = cloneTeam(guestTeam)
    // Same side picked twice: the guest plays in another side's colours so the two XIs can be told apart.
    if (theirs.id === mine.id) {
      const other = teams.find((t) => t.id !== mine.id && !t.custom) ?? teams[1]
      theirs = { ...theirs, id: theirs.id + '-b', name: `${theirs.name} B`, short: `${theirs.short.slice(0, 2)}B`, primary: other.primary, secondary: other.secondary, trousers: other.trousers }
    }
    const setup = { ...makeSetup(mine, theirs), online: true }
    net.link.send({ t: 'c-start', setup })
    setPlaying({ setup, sideHuman: [true, true], localSide: 0, net, key: Date.now() })
    setStage('play')
  }

  const leaveRoom = () => {
    net?.link.close()
    setNet(null)
    setGuestTeam(null)
    setStage('menu')
  }

  const inviteLink = useMemo(() => (net?.role === 'host' ? `${window.location.origin}${window.location.pathname}#/cricket?join=${encodeURIComponent(net.link.code)}` : ''), [net])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this invite link', inviteLink)
    }
  }

  if (stage === 'play' && playing)
    return (
      <Suspense fallback={<div className="racer-stage ck-stage"><div className="vr-loading">Loading the game…</div></div>}>
        <CricketStage
          key={playing.key}
          setup={playing.setup}
          sideHuman={playing.sideHuman}
          localSide={playing.localSide}
          net={playing.net}
          onExit={() => {
            if (playing.net) leaveRoom()
            setPlaying(null)
            setStage('menu')
          }}
          onRematch={playing.net ? undefined : () => setPlaying({ ...playing, setup: { ...playing.setup, seed: Math.floor(Math.random() * 1e9) }, key: Date.now() })}
        />
      </Suspense>
    )

  return (
    <Page onBack={() => navigate('#/home/cricket')} className="arena-page">
      <header className="page-header">
        <p className="eyebrow">Games · three.js</p>
        <h1 className="page-title">Cricket</h1>
        <p className="page-lead">
          Broadcast-style cricket in the browser. Hold a direction and time your shot off the front or back foot, set a field, place your marker and hit the
          green on the run-up meter. Real ball physics (swing, seam, spin and bounce off green, flat or dusty pitches), diving fielders, run outs, DRS
          ball-tracking and replays of every wicket and six. Play the CPU or a friend online.
        </p>
      </header>

      {stage === 'builder' ? (
        <TeamBuilder
          onDone={(id) => {
            setTeams(allTeams())
            if (id) setTeam(id)
            setStage('menu')
          }}
        />
      ) : stage === 'lobby' && net ? (
        <div className="arena-grid">
          <section className="arena-panel">
            {net.role === 'host' ? (
              <>
                <h2 className="section-title">
                  <Users size={16} /> Your room
                </h2>
                <div className="invite">
                  <span className="muted">Invite code</span>
                  <strong className="ck-code">{net.link.code}</strong>
                  <button className="pill" onClick={copy}>
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
                <p>
                  {teamOf(team).name} (you) v {guestTeam ? `${guestTeam.name} (friend)` : '… waiting for your friend to join'}
                </p>
                <p className="muted small">
                  {FORMATS[format].label} · {PITCHES.find((x) => x.id === pitch)?.label} · {TIMES.find((x) => x.id === time)?.label}
                </p>
                <button className="btn btn-primary arena-start" disabled={!guestTeam} onClick={startOnline}>
                  <CircleDot size={18} /> Start the match
                </button>
              </>
            ) : (
              <>
                <h2 className="section-title">Joined room {net.link.code}</h2>
                <p className="muted">Waiting for the host to start the match…</p>
              </>
            )}
            <button className="btn" onClick={leaveRoom}>
              Leave
            </button>
            {error && <p className="notice">{error}</p>}
          </section>
          <Controls />
        </div>
      ) : (
        <div className="arena-grid">
          <section className="arena-panel">
            <div className="seg" role="tablist" aria-label="Mode">
              {(
                [
                  ['quick', 'Play vs CPU', <CircleDot key="q" size={16} />],
                  ['host', 'Host online', <Globe key="h" size={16} />],
                  ['join', 'Join with code', <LogIn key="j" size={16} />],
                ] as const
              ).map(([id, label, icon]) => (
                <button key={id} role="tab" aria-selected={mode === id} className={`seg-btn ${mode === id ? 'is-active' : ''}`} onClick={() => setMode(id)}>
                  {icon} {label}
                </button>
              ))}
            </div>

            {mode !== 'join' && (
              <div className="field">
                <span>Format</span>
                <div className="seg seg-sm">
                  {(Object.keys(FORMATS) as MatchFormat[]).map((id) => (
                    <button key={id} className={`seg-btn ${format === id ? 'is-active' : ''}`} onClick={() => setFormat(id)}>
                      {FORMATS[id].label}
                    </button>
                  ))}
                </div>
                <span className="muted small">{FORMATS[format].blurb}</span>
              </div>
            )}

            <label className="field">
              <span>Your team</span>
              <select className="cricket-select" value={team} onChange={(e) => setTeam(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.custom ? ' (yours)' : ''}
                  </option>
                ))}
              </select>
            </label>

            {mode === 'quick' && (
              <>
                <label className="field">
                  <span>Opponent</span>
                  <select className="cricket-select" value={opp} onChange={(e) => setOpp(e.target.value)}>
                    {teams
                      .filter((t) => t.id !== team)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
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

            <div className="field">
              <span>Graphics</span>
              <div className="seg seg-sm">
                {(['auto', 'low', 'medium', 'high'] as const).map((id) => (
                  <button
                    key={id}
                    className={`seg-btn ${quality === id ? 'is-active' : ''}`}
                    onClick={() => {
                      setQuality(id)
                      saveQuality(id)
                    }}
                  >
                    {id === 'auto' ? `Auto (${detectQuality()})` : id[0].toUpperCase() + id.slice(1)}
                  </button>
                ))}
              </div>
              <span className="muted small">Low: no shadows, small crowd, 1x resolution. High: soft shadows, a full house and sharper rendering.</span>
            </div>

            {mode === 'join' && (
              <label className="field">
                <span>Invite code</span>
                <input className="code-input" value={code} maxLength={8} placeholder="ABC123" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              </label>
            )}

            <button
              className="btn btn-primary arena-start"
              disabled={busy || (mode === 'join' && code.trim().length < 4)}
              onClick={() => (mode === 'quick' ? startQuick() : void openRoom())}
            >
              <CircleDot size={18} /> {mode === 'quick' ? 'Play' : mode === 'host' ? (busy ? 'Creating…' : 'Create match') : busy ? 'Joining…' : 'Join match'}
            </button>
            <button className="btn" onClick={() => setStage('builder')}>
              <Wrench size={16} /> Team builder
            </button>
            {mode !== 'quick' && (
              <p className="muted small">Online play is peer-to-peer: the host's browser runs the match and your friend joins with the code. Some strict networks block it.</p>
            )}
            {error && <p className="notice">{error}</p>}
            <p className="muted small mobile-only">Best on a desktop with a keyboard.</p>
          </section>
          <Controls />
        </div>
      )}
      <AdSlot />
      <GearShelf topic="cricket" />
    </Page>
  )
}

function Controls() {
  return (
    <section className="arena-panel arena-info">
      <h2 className="section-title">Batting</h2>
      <ul className="keys">
        <li>
          Hold a direction: <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> or arrows (8 ways, none = natural shot)
        </li>
        <li>
          Time the shot: <kbd>J</kbd> defend · <kbd>K</kbd> along the ground · <kbd>L</kbd> lofted
        </li>
        <li>
          Hold <kbd>Shift</kbd> front foot · <kbd>Space</kbd> back foot · <kbd>T</kbd> charge the spinner
        </li>
        <li>
          <kbd>R</kbd> run · <kbd>F</kbd> stay / back to the crease
        </li>
      </ul>
      <h2 className="section-title">Bowling</h2>
      <ul className="keys">
        <li>
          <kbd>1</kbd>–<kbd>6</kbd> delivery: seam, swing, bouncer, yorker, slower ball; off-break, leg-break, googly, arm ball, top-spinner
        </li>
        <li>
          <kbd>WASD</kbd> place the pitch marker · <kbd>Space</kbd> run in, <kbd>Space</kbd> again in the green
        </li>
        <li>
          <kbd>F</kbd> field: attacking, normal, defensive, death · <kbd>V</kbd> over/round the wicket
        </li>
      </ul>
      <h2 className="section-title">Everything else</h2>
      <p className="muted small">
        <kbd>Y</kbd> review (DRS) · hold <kbd>Tab</kbd> scorecard, wagon wheel and run-rate graph · <kbd>C</kbd> camera · <kbd>Esc</kbd> pause. Build your own XI
        (names, kit colours, roles and ratings) in the team builder.
      </p>
    </section>
  )
}
