// SPORTS COMPLEX page: the menu (venues, controls, what you've unlocked) and the running complex (canvas + HUD).
import { useEffect, useRef, useState } from 'react'
import { Award, CarFront, Check, Goal, Lock, LogOut, MousePointer2, Network, Play, RotateCcw, Trophy } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { setInputSuspended } from '../lib/input'
import { play as uiSound } from '../lib/sound'
import { Page } from '../components/Page'
import { CONFIG } from './config'
import { loadSportsAssets, type SportsAssets } from './assets'
import { ACHIEVEMENTS, ROLES, SKILLS, TIER_COLOR, fmtTime, loadProgress, resetProgress, type Progress } from './progress'
import type { Game, Hud } from './game'
import { AdSlot } from '../components/AdSlot'
import { GearShelf } from '../components/GearShelf'
import { adBreak } from '../lib/ads'

const accent = tiles.find((t) => t.id === 'sports-complex')?.accent ?? (['#991b1b', '#f97316'] as [string, string])
const DIFFS = ['Easy', 'Normal', 'Hard'] as const

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

export function Sports({ auto, onAccent }: { auto?: boolean; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'sports-complex'), [onAccent])
  const [stage, setStage] = useState<'menu' | 'play'>(auto ? 'play' : 'menu')
  const [difficulty, setDifficulty] = useState(() => Math.min(2, Math.max(0, Number(stored('sc-difficulty', '1')) || 0)))
  const [assets, setAssets] = useState<SportsAssets | null>(null)
  const [loadPct, setLoadPct] = useState(0)
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [run, setRun] = useState(0)

  useEffect(() => {
    let alive = true
    loadSportsAssets((d, t) => alive && setLoadPct(d / t)).then((a) => {
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
      <SportsStage
        key={run}
        assets={assets}
        loadPct={loadPct}
        difficulty={difficulty}
        onQuit={() => {
          setProgress(loadProgress())
          setStage('menu')
        }}
      />
    )

  const branches = new Map<string, { skill: string; open: boolean }[]>()
  SKILLS.forEach((s, i) => {
    const list = branches.get(s.branch) ?? []
    list.push({ skill: s.skill, open: i < progress.skills })
    branches.set(s.branch, list)
  })

  return (
    <Page onBack={() => navigate('#/home/sports-complex')} className="racer-page sc-page">
      <header className="page-header">
        <p className="eyebrow">Games · 3D sports world</p>
        <h1 className="page-title sc-title">SPORTS COMPLEX</h1>
        <p className="page-lead">
          Walk a sunny complex as the low-poly me. Drive the F1 circuit through the career one sector per role, take penalties in the stadium for
          achievements, and win badminton and table tennis rallies in the hall to unlock skills.
        </p>
      </header>

      <div className="vr-grid">
        <section className="arena-panel">
          <ul className="sc-venues">
            <li style={{ borderColor: '#ef4444' }}>
              <CarFront size={20} color="#ef4444" />
              <div>
                <strong>F1 circuit · career drive</strong>
                <span className="muted small">
                  {ROLES.length} sectors, one per role. Lap and sector times; best lap {fmtTime(progress.bestLap)}.
                </span>
              </div>
            </li>
            <li style={{ borderColor: '#22c55e' }}>
              <Goal size={20} color="#22c55e" />
              <div>
                <strong>Stadium · penalty shootout</strong>
                <span className="muted small">
                  {CONFIG.kicks_per_round} kicks a round against the keeper. Every goal unlocks the next achievement.
                </span>
              </div>
            </li>
            <li style={{ borderColor: '#38bdf8' }}>
              <Network size={20} color="#38bdf8" />
              <div>
                <strong>Rally hall · badminton and table tennis</strong>
                <span className="muted small">First to {CONFIG.rally_target}. Points, long rallies and wins unlock skills.</span>
              </div>
            </li>
          </ul>
          <div className="field">
            <span>Difficulty (keeper and rally opponent)</span>
            <div className="seg seg-sm">
              {DIFFS.map((d, i) => (
                <button
                  key={d}
                  className={`seg-btn ${difficulty === i ? 'is-active' : ''}`}
                  onClick={() => {
                    setDifficulty(i)
                    store('sc-difficulty', String(i))
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn-primary arena-start"
            onClick={() => {
              uiSound('select')
              setRun((r) => r + 1)
              setStage('play')
            }}
          >
            <Play size={18} /> Enter
          </button>
          {loadPct < 1 ? (
            <div className="sc-load" aria-label="Loading">
              <i style={{ width: `${Math.round(loadPct * 100)}%` }} />
              <span className="muted small">Loading venues and props: {Math.round(loadPct * 100)}%</span>
            </div>
          ) : (
            <p className="muted small">Venues loaded. Progress is saved in this browser.</p>
          )}
          <p className="muted small mobile-only">Needs a mouse and keyboard.</p>
          <h2 className="section-title">Controls</h2>
          <ul className="keys">
            <li>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> walk · mouse to look · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump
            </li>
            <li>
              <kbd>E</kbd> use a glowing pad (enter a venue, get in the car, start a game) · <kbd>E</kbd>/<kbd>Esc</kbd> leave it
            </li>
            <li>
              Car: <kbd>W</kbd>/<kbd>S</kbd> throttle and brake · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>R</kbd> back on track
            </li>
            <li>
              Penalties: aim with the mouse · hold <kbd>LMB</kbd> for power, release to shoot
            </li>
            <li>
              Rallies: <kbd>A</kbd>/<kbd>D</kbd> move · <kbd>LMB</kbd> or <kbd>Space</kbd> hit as the ring turns green
            </li>
            <li>
              <kbd>Esc</kbd> frees the mouse; again to leave the complex
            </li>
          </ul>
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">
            <CarFront size={16} /> Roles reached · {progress.roles.length}/{ROLES.length}
          </h2>
          <ul className="sc-unlocks">
            {ROLES.map((r, i) => {
              const open = progress.roles.includes(r.id)
              return (
                <li key={r.id} className={open ? 'is-open' : ''}>
                  <span className="sc-sec" style={{ background: open ? r.color : undefined }}>
                    S{i + 1}
                  </span>
                  <span>
                    {open ? r.title : 'Locked sector'}
                    <span className="muted small"> {open ? `· ${r.org} · ${r.period}` : ''}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <h2 className="section-title">
            <Trophy size={16} /> Achievements · {progress.trophies}/{ACHIEVEMENTS.length}
          </h2>
          <ul className="sc-unlocks">
            {ACHIEVEMENTS.map((a, i) => {
              const open = i < progress.trophies
              return (
                <li key={a.name} className={open ? 'is-open' : ''}>
                  {open ? <Award size={15} color={TIER_COLOR[a.tier]} /> : <Lock size={14} className="muted" />}
                  <span>
                    {open ? a.name : `Locked ${a.tier} ${a.kind.toLowerCase()}`}
                    {open && <span className="muted small"> · {a.issuer}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          <h2 className="section-title">
            <Network size={16} /> Skills · {progress.skills}/{SKILLS.length}
          </h2>
          <div className="sc-branches">
            {[...branches].map(([b, list]) => (
              <div key={b}>
                <strong className="small">
                  {b} <span className="muted">{list.filter((s) => s.open).length}/{list.length}</span>
                </strong>
                <div className="sc-chips">
                  {list.map((s) => (
                    <span key={s.skill} className={`sc-chip ${s.open ? 'is-open' : ''}`}>
                      {s.open ? <Check size={11} /> : null}
                      {s.open ? s.skill : '???'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="muted small">
            Laps {progress.laps} · Penalties {progress.goals}/{progress.kicks} · Rally wins {progress.rallyWins.badminton + progress.rallyWins.tabletennis} · Best rally{' '}
            {progress.bestStreak}
          </p>
          <button
            className="btn sc-reset"
            onClick={() => {
              resetProgress()
              setProgress(loadProgress())
            }}
          >
            <RotateCcw size={14} /> Reset progress
          </button>
        </section>
      </div>
      <AdSlot />
      <GearShelf topic="sports" />
    </Page>
  )
}

function SportsStage(p: { assets: SportsAssets | null; loadPct: number; difficulty: number; onQuit: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const ready = !!p.assets
  const quit = useRef(p.onQuit)
  quit.current = p.onQuit

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
      const snap = q.has('snap')
      game = new Game(host.current, { assets: p.assets, difficulty: p.difficulty, snap, onExit: () => quit.current() })
      game.onHud = setHud
      // Tests: `?snap` exposes the game with no live loop (advance it with simulate()).
      if (snap) {
        ;(window as unknown as { __sports: Game }).__sports = game
        game.simulate(0)
      } else game.start()
    })
    return () => {
      cancelled = true
      game?.dispose()
    }
    // The stage is keyed per run, so its options are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div className="racer-stage sc-stage">
      <div ref={host} className="racer-host" />
      {!ready && (
        <div className="vr-loading sc-loading">
          <span>SPORTS COMPLEX</span>
          <span className="small">Loading venues… {Math.round(p.loadPct * 100)}%</span>
        </div>
      )}
      {hud && <SportsHud hud={hud} />}
      {hud && !hud.locked && (hud.mode === 'hub' || hud.mode === 'hall') && (
        <div className="bb-overlay sc-overlay">
          <h2>SPORTS COMPLEX</h2>
          <p>
            <MousePointer2 size={16} /> Click to look around. Esc frees the mouse; Esc again leaves.
          </p>
          <button className="btn" onClick={() => adBreak('sports-exit', { done: p.onQuit })}>
            <LogOut size={16} /> Back to menu
          </button>
        </div>
      )}
    </div>
  )
}

function SportsHud({ hud }: { hud: Hud }) {
  const pr = hud.progress
  return (
    <div className="vr-hud sc-hud">
      <div className="sc-progress">
        <span>
          <CarFront size={14} /> Roles {pr.roles}/{pr.rolesTotal}
        </span>
        <span>
          <Trophy size={14} /> Achievements {pr.trophies}/{pr.trophiesTotal}
        </span>
        <span>
          <Network size={14} /> Skills {pr.skills}/{pr.skillsTotal}
        </span>
        {pr.bestLap !== null && <span>Best lap {fmtTime(pr.bestLap)}</span>}
      </div>

      {(hud.mode === 'hub' || hud.mode === 'hall') && (
        <ul className="sc-legend">
          {hud.mode === 'hub' ? (
            <>
              <li>
                <i style={{ background: '#ef4444' }} /> F1 circuit <span className="muted">west</span>
              </li>
              <li>
                <i style={{ background: '#22c55e' }} /> Stadium <span className="muted">north</span>
              </li>
              <li>
                <i style={{ background: '#38bdf8' }} /> Rally hall <span className="muted">east</span>
              </li>
            </>
          ) : (
            <>
              <li>
                <i style={{ background: '#22c55e' }} /> Badminton court
              </li>
              <li>
                <i style={{ background: '#f97316' }} /> Table tennis
              </li>
              <li>
                <i style={{ background: '#38bdf8' }} /> Exit
              </li>
            </>
          )}
          <li className="muted small">WASD · Shift · Space · E</li>
        </ul>
      )}

      {hud.markers.map((m) => (
        <div key={m.id} className="sc-marker" style={{ left: m.x, top: m.y, borderColor: m.color }}>
          <b style={{ color: m.color }}>{m.label}</b> {m.dist} m
        </div>
      ))}

      {hud.prompt && (
        <div className="sc-prompt" style={{ borderColor: hud.prompt.color }}>
          <kbd>E</kbd> {hud.prompt.text}
        </div>
      )}

      {hud.drive && <DriveHudView hud={hud} />}
      {hud.penalty && <PenaltyHudView hud={hud} />}
      {hud.rally && <RallyHudView hud={hud} />}

      <ul className="sc-toasts">
        {hud.toasts.map((t) => (
          <li key={t.id} className={`sc-toast sc-toast-${t.kind}`} style={{ borderColor: t.color }}>
            <span className="sc-toast-label" style={{ color: t.color }}>
              {t.kind === 'trophy' ? <Trophy size={13} /> : t.kind === 'skill' ? <Network size={13} /> : t.kind === 'role' ? <CarFront size={13} /> : null} {t.label}
            </span>
            <strong>{t.title}</strong>
            <span className="muted small">{t.sub}</span>
          </li>
        ))}
      </ul>

      {hud.hint && <div className="sc-hint">{hud.hint}</div>}
    </div>
  )
}

function DriveHudView({ hud }: { hud: Hud }) {
  const d = hud.drive!
  return (
    <>
      <div className="sc-lap">
        <span className="muted small">{d.started ? `LAP ${d.lap}` : 'CROSS THE LINE TO START'}</span>
        <strong>{fmtTime(d.lapTime)}</strong>
        <span className="muted small">
          Last {fmtTime(d.lastLap)} · Best {fmtTime(d.bestLap)}
        </span>
      </div>
      <ol className="sc-splits">
        {ROLES.map((r, i) => {
          const t = d.splits[i]
          const best = d.bestSectors[i]
          const purple = t !== null && best !== null && t <= best + 1e-6
          return (
            <li key={r.id} className={d.sector === i ? 'is-now' : ''}>
              <i style={{ background: r.color }} />
              <span>
                S{i + 1} {r.title}
              </span>
              <b className={purple ? 'is-best' : ''}>{t === null ? (d.sector === i && d.started ? '…' : '–') : t.toFixed(2)}</b>
            </li>
          )
        })}
      </ol>
      <div className="sc-speedo">
        <strong>{d.speed}</strong>
        <span>km/h · gear {d.gear === 0 ? 'N' : d.gear}</span>
        {d.offTrack && <em>OFF TRACK</em>}
      </div>
      {hud.role && (
        <div className="sc-role" style={{ borderColor: hud.role.color }}>
          <span className="sc-role-sec" style={{ color: hud.role.color }}>
            SECTOR {hud.role.index + 1} / {ROLES.length}
          </span>
          <strong>{hud.role.title}</strong>
          <span className="sc-role-tag">{hud.role.tagline}</span>
          <span className="muted small">
            {hud.role.org} · {hud.role.period}
          </span>
        </div>
      )}
    </>
  )
}

function PenaltyHudView({ hud }: { hud: Hud }) {
  const p = hud.penalty!
  return (
    <>
      <div className="sc-kicks">
        <span className="muted small">
          KICK {p.kick} / {CONFIG.kicks_per_round}
        </span>
        <div>
          {Array.from({ length: CONFIG.kicks_per_round }, (_, i) => (
            <i key={i} className={p.results[i] ? `is-${p.results[i]}` : ''} />
          ))}
        </div>
        <strong>{p.goals} scored</strong>
      </div>
      {p.power !== null && (
        <div className="sc-power">
          <i className="sc-power-sweet" style={{ bottom: `${p.sweet[0] * 100}%`, height: `${(p.sweet[1] - p.sweet[0]) * 100}%` }} />
          <i className="sc-power-fill" style={{ height: `${p.power * 100}%`, background: p.power > p.sweet[1] ? '#ef4444' : p.power >= p.sweet[0] ? '#4ade80' : '#facc15' }} />
          <span>POWER</span>
        </div>
      )}
      {p.message && (
        <div className="vr-banner sc-banner" style={{ color: p.message.color }}>
          {p.message.text}
          {p.message.sub && <span>{p.message.sub}</span>}
        </div>
      )}
    </>
  )
}

function RallyHudView({ hud }: { hud: Hud }) {
  const r = hud.rally!
  return (
    <>
      <div className="sc-rally">
        <span className="muted small">{r.sport === 'badminton' ? 'BADMINTON' : 'TABLE TENNIS'} · first to {r.target}</span>
        <div className="sc-rally-score">
          <span className={r.server === 'me' ? 'is-serve' : ''}>YOU</span>
          <strong>
            {r.me} – {r.opp}
          </strong>
          <span className={r.server === 'opp' ? 'is-serve' : ''}>KAI</span>
        </div>
        <span className="muted small">
          Rally {r.streak} · best {r.best}
        </span>
      </div>
      <div className={`sc-timing ${r.timing === null ? 'is-idle' : ''}`}>
        <i className="sc-timing-zone" />
        {r.timing !== null && <i className="sc-timing-dot" style={{ left: `${50 + r.timing * 50}%` }} />}
        <span>TIMING</span>
      </div>
      {r.message && (
        <div className="vr-banner sc-banner" style={{ color: r.message.color }}>
          {r.message.text}
          {r.message.sub && <span>{r.message.sub}</span>}
        </div>
      )}
    </>
  )
}
