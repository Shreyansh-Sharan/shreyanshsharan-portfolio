// BOGEY BRAWL page: menu (hole picker, Tour, Chaos), the online lobby, the running hole (canvas + HUD) and the
// results table with Tour standings.
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight, ArrowUp, Banana, Bomb, CarFront, Check, Coffee, Copy, Crosshair, Flag, Flame, Footprints, Globe, LogIn, LogOut, Magnet, Megaphone, Orbit, Play,
  Rocket, RotateCcw, Satellite, Shield, Snowflake, Sparkles, Target, Tornado, Trophy, User, Users, Volleyball,
} from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { setInputSuspended } from '../lib/input'
import { play as uiSound } from '../lib/sound'
import { Page } from '../components/Page'
import { CONFIG } from './config'
import { HOLES, holeById } from './course'
import { loadGolfAssets, type GolfAssets } from './assets'
import type { ItemType } from './golfer'
import type { Game, HoleResult, Hud } from './game'
import { hostRoom, isGolfMsg, joinRoom, MAX_GOLFERS, type GolfMsg, type GolfNet, type GolfSetup, type GolfSlot, type Link, type LobbyGolfer } from './net'

const accent = tiles.find((t) => t.id === 'bogey-brawl')?.accent ?? (['#14532d', '#bef264'] as [string, string])

const ITEMS: Record<string, { name: string; color: string; icon: typeof Rocket; help: string }> = {
  rocket: { name: 'Rocket Launcher', color: '#f97316', icon: Rocket, help: 'Homes in on the rival closest to your aim. Big knockback, and it can launch balls too.' },
  pistol: { name: 'Dueling Pistol', color: '#facc15', icon: Crosshair, help: 'Instant hitscan shot at 50 m. Stuns, and cancels a charging swing.' },
  shield: { name: 'Electromagnet', color: '#38bdf8', icon: Magnet, help: `A ${CONFIG.shield_duration} s bubble that blocks rockets, bullets and carts.` },
  landmine: { name: 'Landmine', color: '#ef4444', icon: Bomb, help: `A pack of ${CONFIG.landmine_charges}: drop them behind you on the fairway. They arm after a second, and flip carts.` },
  airhorn: { name: 'Air Horn', color: '#a3e635', icon: Megaphone, help: `Blasts back everyone within ${CONFIG.airhorn_range} m, and their loose balls go flying.` },
  coffee: { name: 'Coffee', color: '#a16207', icon: Coffee, help: `${CONFIG.coffee_duration} s of running at ${Math.round(CONFIG.boost_speed_mult * 100)}% speed.` },
  freeze: { name: 'Freeze Bomb', color: '#bae6fd', icon: Snowflake, help: `Lobbed ${CONFIG.freeze_throw} m ahead: anyone in the blast is frozen for ${CONFIG.freeze_duration} s and balls stop dead.` },
  springboots: { name: 'Spring Boots', color: '#22d3ee', icon: Footprints, help: `A ${CONFIG.springboots_distance} m leap along your aim. Mind the lake.` },
  elephant: { name: 'Elephant Gun', color: '#78716c', icon: Target, help: `A huge blast in a cone at up to ${CONFIG.elephant_range} m. The recoil throws you back too.` },
  laser: { name: 'Orbital Laser', color: '#e879f9', icon: Satellite, help: `A targeting beam locks on to the leader and follows them for ${CONFIG.laser_delay} s, then blasts everything within ${CONFIG.laser_radius} m. Outrun it.` },
  cart: { name: 'Golf Cart', color: '#f8fafc', icon: CarFront, help: 'A cart appears beside you and you hop in. Run rivals over and drive through their balls.' },
  driver: { name: 'Rocket Driver', color: '#fb7185', icon: Flame, help: `Your next full swing goes off at ${CONFIG.rocket_driver_power}% power with a fiery trail.` },
  tornado: { name: 'Tornado', color: '#94a3b8', icon: Tornado, help: `A twister that wanders after golfers for ${CONFIG.tornado_life} s, sucking up people, carts and balls and flinging them.` },
  swap: { name: 'Ball Swap', color: '#c084fc', icon: ArrowLeftRight, help: 'Swap your ball with the one furthest ahead. Only works if someone is ahead of you.' },
  banana: { name: 'Banana Peel', color: '#fde047', icon: Banana, help: `A bunch of ${CONFIG.banana_charges}: drop them behind you. Whoever steps on one slips and spins; carts spin out.` },
  bouncy: { name: 'Bouncy Ball', color: '#f472b6', icon: Volleyball, help: `Your next shot is rubber: it bounces high and skips off water up to ${CONFIG.bouncy_skips} times.` },
  meteor: { name: 'Meteor', color: '#fb923c', icon: Orbit, help: `A meteor strikes near the leader after a ${CONFIG.meteor_delay} s warning: ${CONFIG.meteor_radius} m blast.` },
}

type PlayMode = 'solo' | 'host' | 'join'

/** A hole id, or 'tour' for every hole in order. */
type HolePick = string

interface Session {
  link: Link
  players: LobbyGolfer[]
  bots: number
  difficulty: number
  hole: HolePick
  chaos: boolean
}

interface TourState {
  holes: string[]
  idx: number
  /** Points per golfer id, hole by hole. */
  rows: Record<number, { name: string; color: string; me: boolean; points: number[] }>
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
const TOUR = HOLES.map((h) => h.id)
const holeTime = (par: number) => (par <= 3 ? CONFIG.hole_time_par3 : par === 4 ? CONFIG.hole_time_par4 : CONFIG.hole_time_par5)

/** Add one hole's points to the Tour table. */
function addToTour(t: TourState, r: HoleResult): TourState {
  const rows = { ...t.rows }
  for (const row of r.rows) {
    const prev = rows[row.id] ?? { name: row.name, color: row.color, me: row.me, points: [] }
    const points = [...prev.points]
    points[t.idx] = row.total
    rows[row.id] = { ...prev, name: row.name, me: row.me, points }
  }
  return { ...t, rows }
}

type Stage = 'menu' | 'lobby' | 'play' | 'results'

export function Golf({ auto, onAccent }: { auto?: boolean; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'bogey-brawl'), [onAccent])
  const q = new URLSearchParams(window.location.search)
  const [stage, setStage] = useState<Stage>(auto ? 'play' : 'menu')
  const [playMode, setPlayMode] = useState<PlayMode>('solo')
  const [difficulty, setDifficulty] = useState(1)
  const [bots, setBots] = useState(3)
  const [name, setName] = useState(() => stored('bb-name', 'Golfer'))
  const [pick, setPick] = useState<HolePick>(() => (auto && q.has('tour') ? 'tour' : auto && q.get('hole') ? q.get('hole')! : stored('bb-hole', 'lakeside')))
  const [chaos, setChaos] = useState(() => (auto && q.has('chaos') ? q.get('chaos') !== '0' : stored('bb-chaos', '1') === '1'))
  const [code, setCode] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [net, setNet] = useState<GolfNet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [assets, setAssets] = useState<GolfAssets | null>(null)
  const [loadPct, setLoadPct] = useState(0)
  const [result, setResult] = useState<HoleResult | null>(null)
  const [run, setRun] = useState(0)
  // The hole being played (and the Tour, if this is one).
  const [hole, setHole] = useState<string>(() => (pick === 'tour' ? TOUR[0] : holeById(pick).id))
  const [tour, setTour] = useState<TourState | null>(() => (pick === 'tour' ? { holes: TOUR, idx: 0, rows: {} } : null))
  const stageRef = useRef(stage)
  stageRef.current = stage
  const sessionRef = useRef(session)
  sessionRef.current = session

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

  const lobbyMsg = (s: Session): GolfMsg => ({ t: 'g-lobby', players: s.players, bots: s.bots, difficulty: s.difficulty, hole: s.hole, chaos: s.chaos, tour: s.hole === 'tour' })

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
            link.send(lobbyMsg(next))
            return next
          })
        }
      } else if (m.t === 'g-lobby') setSession((s) => (s ? { ...s, players: m.players, bots: m.bots, difficulty: m.difficulty, hole: m.tour ? 'tour' : m.hole, chaos: m.chaos } : s))
      else if (m.t === 'g-start') {
        const setup = m.setup
        setNet({ link, role: 'client', slots: setup.slots, setup })
        setHole(holeById(setup.hole).id)
        setTour((t) => (setup.tour ? { holes: setup.tour.holes, idx: setup.tour.idx, rows: setup.tour.idx === 0 || !t ? {} : t.rows } : null))
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
          const next = { ...s, players: s.players.filter((p) => p.id !== id) }
          link.send(lobbyMsg(next))
          return next
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
    if (session?.link.isHost) session.link.send(lobbyMsg(session))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.bots, session?.difficulty, session?.link, session?.players, session?.hole, session?.chaos])

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
        setSession({ link, players: [{ id: 'host', name: name || 'Host' }], bots: Math.min(bots, MAX_GOLFERS - 1), difficulty, hole: pick, chaos })
      } else {
        const link = await joinRoom(code)
        // Say hello once the lobby listener is attached (below), so the host's reply isn't missed.
        setSession({ link, players: [], bots: 0, difficulty: 1, hole: 'lakeside', chaos: true })
      }
      setStage('lobby')
    } catch (e) {
      setError((e as Error).message || 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  /** Host: start a hole (the first of a Tour, or the next one). */
  function startOnline(idx = 0) {
    const s = sessionRef.current
    if (!s) return
    const slots = buildSlots(s.players, s.bots)
    const isTour = s.hole === 'tour'
    const setup: GolfSetup = { slots, difficulty: s.difficulty, hole: isTour ? TOUR[idx] : holeById(s.hole).id, chaos: s.chaos, tour: isTour ? { holes: TOUR, idx } : null }
    s.link.send({ t: 'g-start', setup } satisfies GolfMsg)
    setNet({ link: s.link, role: 'host', slots, setup })
    setDifficulty(s.difficulty)
    setHole(setup.hole)
    setTour((t) => (isTour ? { holes: TOUR, idx, rows: idx === 0 || !t ? {} : t.rows } : null))
    setRun((r) => r + 1)
    setStage('play')
  }

  function startSolo() {
    store('bb-hole', pick)
    store('bb-chaos', chaos ? '1' : '0')
    setNet(null)
    if (pick === 'tour') {
      setTour({ holes: TOUR, idx: 0, rows: {} })
      setHole(TOUR[0])
    } else {
      setTour(null)
      setHole(holeById(pick).id)
    }
    setRun((r) => r + 1)
    setStage('play')
  }

  const tourNext = tour && tour.idx < tour.holes.length - 1
  if (stage === 'play')
    return (
      <GolfStage
        key={run}
        assets={assets}
        loadPct={loadPct}
        difficulty={net ? (session?.difficulty ?? difficulty) : difficulty}
        bots={bots}
        net={net}
        hole={hole}
        chaos={net?.setup ? net.setup.chaos : chaos}
        onResult={(r) => {
          setResult(r)
          setTour((t) => (t ? addToTour(t, r) : t))
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
        tour={tour}
        online={net ? (net.role === 'host' ? 'host' : 'client') : null}
        onAgain={() => {
          if (net && session) {
            if (tourNext) {
              startOnline(tour.idx + 1)
              return
            }
            session.link.send({ t: 'g-lobbyback' } satisfies GolfMsg)
            setStage('lobby')
            return
          }
          if (tourNext) {
            setTour({ ...tour, idx: tour.idx + 1 })
            setHole(tour.holes[tour.idx + 1])
          } else if (tour) {
            setTour({ holes: TOUR, idx: 0, rows: {} })
            setHole(TOUR[0])
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
        onHole={(h) => setSession((s) => (s ? { ...s, hole: h } : s))}
        onChaos={(c) => setSession((s) => (s ? { ...s, chaos: c } : s))}
        onStart={() => startOnline(0)}
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
          Everyone plays the hole at once. First ball in the cup wins the most points, and in between you can club, shoot, rocket and run over your rivals with
          a golf cart.
        </p>
      </header>

      <div className="vr-grid">
        <section className="arena-panel">
          {playMode !== 'join' && <HolePicker pick={pick} onPick={setPick} />}
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
              <ChaosToggle chaos={chaos} onChaos={setChaos} />
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
              if (playMode === 'solo') startSolo()
              else {
                store('bb-hole', pick)
                store('bb-chaos', chaos ? '1' : '0')
                void openRoom()
              }
            }}
          >
            {playMode === 'solo' ? <Play size={18} /> : playMode === 'host' ? <Globe size={18} /> : <LogIn size={18} />}{' '}
            {playMode === 'solo' ? (pick === 'tour' ? 'Start the Tour' : 'Tee off') : playMode === 'host' ? (busy ? 'Creating…' : 'Create room') : busy ? 'Joining…' : 'Join room'}
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
          <p className="muted small">
            Grab them from briefcases dotted along the hole. Three slots; Landmines come in packs of {CONFIG.landmine_charges}, Banana Peels in bunches of{' '}
            {CONFIG.banana_charges}.
          </p>
          <h2 className="section-title">Golf carts</h2>
          <p className="muted small">
            Carts are parked along every hole. Hop in with <kbd>E</kbd>, drive over to your ball, and run over anyone in the way: a hit at speed knocks them out
            (+{CONFIG.points_knockout}) and drives straight through their ball. Water sinks carts. You can't swing from the seat.
          </p>
          <h2 className="section-title">Controls</h2>
          <ul className="keys">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> run · mouse to look</li>
            <li><kbd>LMB</kbd> hold to charge, release to swing (near a rival: club them)</li>
            <li><kbd>Wheel</kbd> loft · <kbd>RMB</kbd> use item</li>
            <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> / <kbd>Q</kbd> pick slot · <kbd>F</kbd> drop</li>
            <li><kbd>Space</kbd> jump · <kbd>Shift</kbd> dive · <kbd>C</kbd> creep</li>
            <li><kbd>E</kbd> get in/out of a cart · in a cart: <kbd>W</kbd>/<kbd>S</kbd> drive, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Space</kbd> handbrake, <kbd>H</kbd> horn</li>
            <li><kbd>Esc</kbd> release the mouse</li>
          </ul>
        </section>
      </div>
    </Page>
  )
}

function HolePicker({ pick, onPick, readOnly }: { pick: HolePick; onPick?: (h: HolePick) => void; readOnly?: boolean }) {
  return (
    <div className="bb-holes" role="radiogroup" aria-label="Hole">
      {HOLES.map((h) => (
        <button
          key={h.id}
          role="radio"
          aria-checked={pick === h.id}
          disabled={readOnly && pick !== h.id}
          className={`bb-holecard ${pick === h.id ? 'is-active' : ''}`}
          style={{ ['--bb-hole' as string]: h.accent }}
          onClick={() => !readOnly && onPick?.(h.id)}
        >
          <Flag size={16} color={h.accent} />
          <strong>{h.name}</strong>
          <span className="muted small">
            {h.biome} · Par {h.par} · {Math.round(holeTime(h.par) / 60)} min
          </span>
          <span className="small bb-holeblurb">{h.blurb}</span>
        </button>
      ))}
      <button
        role="radio"
        aria-checked={pick === 'tour'}
        disabled={readOnly && pick !== 'tour'}
        className={`bb-holecard bb-tourcard ${pick === 'tour' ? 'is-active' : ''}`}
        onClick={() => !readOnly && onPick?.('tour')}
      >
        <Trophy size={16} color="#facc15" />
        <strong>The Tour</strong>
        <span className="muted small">All {HOLES.length} holes · par {HOLES.reduce((a, h) => a + h.par, 0)}</span>
        <span className="small bb-holeblurb">Every hole in a row. Points carry over to a final standings table.</span>
      </button>
    </div>
  )
}

function ChaosToggle({ chaos, onChaos, readOnly }: { chaos: boolean; onChaos?: (c: boolean) => void; readOnly?: boolean }) {
  return (
    <div className="field">
      <span>
        <Sparkles size={14} /> Chaos events
      </span>
      <div className="seg seg-sm">
        {([true, false] as const).map((v) => (
          <button key={String(v)} disabled={readOnly && chaos !== v} className={`seg-btn ${chaos === v ? 'is-active' : ''}`} onClick={() => !readOnly && onChaos?.(v)}>
            {v ? 'On' : 'Off'}
          </button>
        ))}
      </div>
      <span className="muted small">Every ~{CONFIG.chaos_interval} s: a meteor shower, a wind gust, low gravity, briefcase rain or a loose twister.</span>
    </div>
  )
}

function GolfStage(p: {
  assets: GolfAssets | null
  loadPct: number
  difficulty: number
  bots: number
  net: GolfNet | null
  hole: string
  chaos: boolean
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
      game = new Game(host.current, {
        difficulty: p.difficulty,
        bots: p.bots,
        assets: p.assets,
        autopilot: q.has('autopilot'),
        net: p.net ?? undefined,
        hole: p.net?.setup?.hole ?? p.hole,
        chaos: p.chaos,
      })
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

      {(hud.wind || hud.chaos) && (
        <div className="bb-conditions">
          {hud.wind && (
            <span className="bb-wind" title="Wind">
              <ArrowUp size={16} style={{ transform: `rotate(${(-hud.wind.angle * 180) / Math.PI}deg)` }} /> {hud.wind.speed} m/s
            </span>
          )}
          {hud.chaos && (
            <span className="bb-chaos" style={{ color: hud.chaos.color, borderColor: hud.chaos.color }}>
              <Sparkles size={14} /> {hud.chaos.name} {Math.ceil(hud.chaos.t)}
            </span>
          )}
        </div>
      )}

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
      {hud.prompt && hud.stun <= 0 && hud.respawn <= 0 && <div className="bb-prompt">{hud.prompt}</div>}

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
          {hud.driving ? <span className="bb-speed">{hud.cartSpeed} km/h</span> : <span>{hud.putt ? 'PUTT' : `Loft ${hud.loft}°`}</span>}
          {hud.armed.map((a) => (
            <span key={a} className="bb-armed">
              {a}
            </span>
          ))}
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

function Results(p: { result: HoleResult; tour: TourState | null; online: 'host' | 'client' | null; onAgain: () => void; onMenu: () => void }) {
  const { result, tour, online } = p
  const rows = [...result.rows].sort((a, b) => b.total - a.total)
  const me = rows.find((r) => r.me)
  const last = tour ? tour.idx >= tour.holes.length - 1 : true
  const standings = tour
    ? Object.entries(tour.rows)
        .map(([id, r]) => ({ id: +id, ...r, total: r.points.reduce((a, x) => a + (x ?? 0), 0) }))
        .sort((a, b) => b.total - a.total)
    : []
  const champ = standings[0]
  const finalTour = tour && last
  return (
    <Page onBack={p.onMenu} backLabel="Menu" className="racer-page golf-page">
      <header className="page-header">
        <p className="eyebrow">
          {tour ? `The Tour · hole ${tour.idx + 1} of ${tour.holes.length} · ` : ''}
          {result.name} · Par {result.par}
        </p>
        <h1 className="page-title bb-title">
          {finalTour && champ ? (champ.me ? 'You win the Tour' : `${champ.name} wins the Tour`) : me && rows[0] === me ? 'You win the hole' : `${rows[0]?.name} wins the hole`}
        </h1>
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
        {tour && (
          <>
            <h2 className="section-title bb-tourtitle">
              <Trophy size={16} color="#facc15" /> {finalTour ? 'Final standings' : 'Tour standings'}
            </h2>
            <table className="bb-results bb-standings" data-testid="tour-standings">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Golfer</th>
                  {tour.holes.map((h, i) => (
                    <th key={h} title={holeById(h).name} className={i === tour.idx ? 'is-now' : ''}>
                      H{i + 1}
                    </th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r, i) => (
                  <tr key={r.id} className={r.me ? 'is-me' : ''}>
                    <td>{i === 0 ? <Trophy size={16} color="#facc15" /> : i + 1}</td>
                    <td>
                      <i className="bb-dot" style={{ background: r.color }} /> {r.name}
                      {r.me && <span className="muted small"> (you)</span>}
                    </td>
                    {tour.holes.map((h, k) => (
                      <td key={h} className="muted small">
                        {r.points[k] ?? '—'}
                      </td>
                    ))}
                    <td>
                      <strong>{r.total}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="bb-actions">
          {online !== 'client' ? (
            <button className="btn btn-primary" onClick={p.onAgain}>
              <RotateCcw size={16} />{' '}
              {tour && !last
                ? `Next hole: ${holeById(tour.holes[tour.idx + 1]).name}`
                : online === 'host'
                  ? 'Back to the lobby'
                  : tour
                    ? 'Play the Tour again'
                    : 'Play again'}
            </button>
          ) : (
            <span className="muted small">{tour && !last ? 'Waiting for the host to start the next hole…' : 'Waiting for the host to start another round…'}</span>
          )}
          <button className="btn" onClick={p.onMenu}>
            {online ? 'Leave' : 'Menu'}
          </button>
        </div>
      </section>
    </Page>
  )
}

function Lobby(p: {
  session: Session
  onBots: (n: number) => void
  onDifficulty: (d: number) => void
  onHole: (h: HolePick) => void
  onChaos: (c: boolean) => void
  onStart: () => void
  onLeave: () => void
  canStart: boolean
}) {
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
              <ChaosToggle chaos={session.chaos} onChaos={p.onChaos} />
              <button className="btn btn-primary arena-start" disabled={!p.canStart || slots.length < 2} onClick={p.onStart}>
                <Play size={18} /> {session.hole === 'tour' ? 'Start the Tour' : 'Start the hole'}
              </button>
              {slots.length < 2 && <p className="muted small">Add a bot or wait for a friend to join.</p>}
            </>
          ) : (
            <>
              <ChaosToggle chaos={session.chaos} readOnly />
              <p className="muted small">The host picks the hole, bots and difficulty.</p>
            </>
          )}
          <button className="btn" onClick={p.onLeave}>
            <LogOut size={16} /> Leave
          </button>
        </section>
        <section className="arena-panel arena-info">
          <h2 className="section-title">{host ? 'Pick the hole' : 'The hole'}</h2>
          <HolePicker pick={session.hole} onPick={p.onHole} readOnly={!host} />
          <h2 className="section-title">How online works</h2>
          <p className="muted small">
            The host's browser runs the hole and streams it to everyone at 20 updates a second; your own golfer (and the cart you drive) moves instantly on your
            screen. If someone leaves, a bot takes over their golfer. If the host leaves, the round ends.
          </p>
        </section>
      </div>
    </Page>
  )
}
