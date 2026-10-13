// The running match: the three.js canvas plus the broadcast HUD (scorebug, batting and bowling controls, toss,
// bowler choice, DRS, innings break, result), the scorecard overlay and the pause menu.
import { useEffect, useRef, useState } from 'react'
import '../cricket.css'
import { loadCricketAssets } from '../assets'
import { Game, type HudState } from '../game'
import type { MatchSetup } from '../sim/match'
import type { Command, GameEvent } from '../sim/director'
import { PRESET_NAMES } from '../sim/fields'
import { resolveQuality, saveQuality, savedQuality, type QualityTier } from '../quality'
import { Scorecard } from './Scorecard'
import { setInputSuspended } from '../../lib/input'
import { adBreak, rewardedAd } from '../../lib/ads'
import type { CricketNet } from '../net'
import { attachNet } from '../net'

export interface StageProps {
  setup: MatchSetup
  sideHuman: [boolean, boolean]
  localSide: number
  net?: CricketNet | null
  onExit: () => void
  onRematch?: () => void
}

const DIR_LABELS: Record<string, string> = {
  '0,0': 'Natural',
  '0,1': 'Straight',
  '-1,1': 'Off drive',
  '1,1': 'On drive',
  '-1,0': 'Square (off)',
  '1,0': 'Square (leg)',
  '-1,-1': 'Late cut',
  '1,-1': 'Fine leg',
  '0,-1': 'Behind',
}

type HowToMode = 'bat' | 'bowl'
const HOWTO_KEY: Record<HowToMode, string> = { bat: 'cricket-howto-bat', bowl: 'cricket-howto-bowl' }

function howToSeen(mode: HowToMode) {
  try {
    return localStorage.getItem(HOWTO_KEY[mode]) === 'off'
  } catch {
    return false
  }
}

function rememberHowTo(mode: HowToMode, off: boolean) {
  try {
    if (off) localStorage.setItem(HOWTO_KEY[mode], 'off')
    else localStorage.removeItem(HOWTO_KEY[mode])
  } catch {
    // Not remembered.
  }
}

export default function CricketStage(p: StageProps) {
  const host = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [loadPct, setLoadPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showCard, setShowCard] = useState(false)
  const [pop, setPop] = useState<{ text: string; kind: string; id: number } | null>(null)
  const [quality, setQualityState] = useState<QualityTier | 'auto'>(savedQuality())
  const [version, setVersion] = useState(0)
  const [howTo, setHowTo] = useState<HowToMode | null>(null)
  const howToShown = useRef<Record<HowToMode, boolean>>({ bat: false, bowl: false })
  const popId = useRef(0)

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('arena-running', { detail: true }))
    setInputSuspended(true)
    return () => {
      window.dispatchEvent(new CustomEvent('arena-running', { detail: false }))
      setInputSuspended(false)
    }
  }, [])

  useEffect(() => {
    let game: Game | null = null
    let cancelled = false
    let detachNet: (() => void) | null = null
    const q = new URLSearchParams(window.location.search)
    loadCricketAssets((d, t) => !cancelled && setLoadPct(d / t))
      .then((assets) => {
        if (cancelled || !host.current) return
        const mirror = !!p.net && p.net.role === 'client'
        game = new Game(host.current, {
          setup: p.setup,
          sideHuman: p.sideHuman,
          localSide: p.localSide,
          quality: resolveQuality(),
          assets,
          autopilot: q.has('autopilot'),
          snap: q.has('snap'),
          mirror,
          online: !!p.net,
        })
        gameRef.current = game
        game.onHud = setHud
        game.onCommentary = setLines
        game.onEvent = (e: GameEvent) => {
          const show = (text: string, kind: string) => setPop({ text, kind, id: ++popId.current })
          if (e.type === 'bathit' || e.type === 'edge') {
            const d = game!.director
            if (d.localBats || d.localBowls) show(d.timingText || d.lastShotNote, e.type)
          }
          if (e.type === 'beaten') show(e.text ?? 'Beaten', 'beaten')
          if (e.type === 'noball' && e.text) show(e.text, 'extra')
          if (e.type === 'appeal') show('HOWZAT!', 'appeal')
          if (e.type === 'notout') show(e.text ?? 'Not out', 'extra')
          if (e.type === 'drop') show('DROPPED!', 'beaten')
          if (e.type === 'directhit') show('DIRECT HIT!', 'appeal')
          if (e.type === 'reviewresult') show(e.text ?? '', 'extra')
          if (e.type === 'phase' || e.type === 'wicket' || e.type === 'inningsend') setVersion((v) => v + 1)
        }
        if (p.net) detachNet = attachNet(game, p.net)
        ;(window as unknown as { __cricket: Game }).__cricket = game
        if (q.has('snap')) game.simulate(0)
        else game.start()
      })
      .catch((e) => !cancelled && setError(String((e as Error)?.message ?? e)))
    return () => {
      cancelled = true
      detachNet?.()
      game?.dispose()
      gameRef.current = null
    }
    // The stage is keyed per match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hold Tab for the scorecard.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault()
        setShowCard(true)
      }
    }
    const up = (e: KeyboardEvent) => e.key === 'Tab' && setShowCard(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    if (!pop) return
    const id = window.setTimeout(() => setPop(null), 1800)
    return () => window.clearTimeout(id)
  }, [pop])

  // The one-screen "how to play" before the first ball of a human innings (batting and bowling versions).
  const phase = hud?.phase
  const localBats = !!hud?.localBats
  const localBowls = !!hud?.localBowls
  useEffect(() => {
    const game = gameRef.current
    if (!game || howTo || phase !== 'predelivery') return
    const q = new URLSearchParams(window.location.search)
    if ((q.has('snap') || q.has('autopilot')) && !q.has('howto')) return
    const mode: HowToMode | null = localBats ? 'bat' : localBowls ? 'bowl' : null
    if (!mode || howToShown.current[mode] || howToSeen(mode)) return
    howToShown.current[mode] = true
    game.setHold(true)
    setHowTo(mode)
  }, [phase, localBats, localBowls, howTo])

  const closeHowTo = (off: boolean) => {
    if (howTo) rememberHowTo(howTo, off)
    setHowTo(null)
    gameRef.current?.setHold(false)
  }

  const g = gameRef.current
  const side = p.localSide
  const send = (c: Command) => g?.submit(c)
  const h = hud

  const continueBreak = () => {
    // A natural break: offer an interstitial, then carry on.
    g?.setPaused(true)
    adBreak('cricket-innings', { done: () => {
      g?.setPaused(false)
      send({ t: 'continue', side })
    } })
  }

  const leave = (then: () => void) => {
    adBreak('cricket-match-end', { done: then })
  }

  const watchAdForReview = () => {
    g?.setPaused(true)
    rewardedAd('cricket-review', {
      granted: (ok) => {
        g?.setPaused(false)
        if (ok) g?.grantReview()
      },
    })
  }

  const setQuality = (qq: QualityTier | 'auto') => {
    setQualityState(qq)
    saveQuality(qq)
    g?.setQuality(resolveQuality(qq))
  }

  return (
    <div className="racer-stage ck-stage">
      <div ref={host} className="racer-host" />
      {!h && !error && <div className="vr-loading ck-loading">Building the stadium… {Math.round(loadPct * 100)}%</div>}
      {error && <div className="vr-loading ck-loading">Couldn't load the game: {error}</div>}
      {h && (
        <>
          <Scorebug h={h} />
          <div className="ck-topbar">
            <button className="pill" onClick={() => g?.setPaused(!h.paused)}>
              {h.paused ? 'Resume' : 'Pause'}
            </button>
            <button className="pill" onClick={() => setShowCard((s) => !s)}>
              Scorecard
            </button>
            <button className="pill" onClick={() => g?.toggleCamera()}>
              Camera: {h.camera === 'batter' ? 'Batter' : h.camera === 'broadcast' ? 'Broadcast' : 'High'}
            </button>
            <QualityToggle value={quality} actual={h.quality} onChange={setQuality} />
          </div>
          <Commentary lines={lines} />
          {h.card && <DeliveryCard card={h.card} />}
          {h.banner && <Banner text={h.banner} sub={h.bannerSub} />}
          {pop && (
            <div key={pop.id} className={`ck-pop ck-pop-${pop.kind}`}>
              {pop.text}
            </div>
          )}
          {h.localBats && (h.phase === 'predelivery' || h.phase === 'runup' || h.phase === 'flight' || h.phase === 'live' || h.phase === 'dead') && <BattingHud h={h} game={g} />}
          {h.localBowls && (h.phase === 'predelivery' || h.phase === 'runup' || h.phase === 'live') && <BowlingHud h={h} game={g} />}
          {howTo && <HowTo mode={howTo} onClose={closeHowTo} />}
          {h.toss && <TossPanel h={h} send={send} side={side} />}
          {h.chooseBowler && (
            <div className="ck-panel ck-center">
              <h3>Choose your bowler</h3>
              <ul className="ck-list">
                {h.chooseBowler.options.map((o, i) => (
                  <li key={o.player}>
                    <button onClick={() => send({ t: 'bowler', side, player: o.player })}>
                      <kbd>{i + 1}</kbd> <strong>{o.name}</strong> <span className="muted">{o.style}</span>
                      <span className="ck-right">
                        {o.overs} ov · {o.figures}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="muted small">Bowlers can't bowl two overs in a row and have a quota. Enter picks the first.</p>
            </div>
          )}
          {h.reviewPrompt && (
            <div className="ck-panel ck-review-prompt">
              <strong>{h.reviewPrompt.reviewsLeft > 0 ? 'Review the decision?' : 'No reviews left'}</strong>
              <span className="muted">{Math.ceil(h.reviewPrompt.seconds)} s</span>
              {h.reviewPrompt.reviewsLeft > 0 ? (
                <button className="btn btn-primary" onClick={() => send({ t: 'review', side })}>
                  <kbd>Y</kbd> Review ({h.reviewPrompt.reviewsLeft} left)
                </button>
              ) : h.reviewPrompt.canAd ? (
                <button className="btn" onClick={watchAdForReview}>
                  Watch an ad for an extra review
                </button>
              ) : null}
            </div>
          )}
          {h.review && <DrsPanel h={h} />}
          {h.replay && (
            <div className="ck-replay-tag">
              REPLAY <span className="muted small">Space to skip</span>
            </div>
          )}
          {h.inningsBreak && (
            <div className="ck-panel ck-center ck-break">
              <h3>Innings break</h3>
              <p className="ck-big">{h.inningsBreak.summary}</p>
              <p>{h.inningsBreak.next}</p>
              {g && <Scorecard key={version} state={g.director.state} />}
              <button className="btn btn-primary" onClick={continueBreak}>
                Continue <kbd>Enter</kbd>
              </button>
            </div>
          )}
          {h.matchEnd && g && (
            <div className="ck-panel ck-center ck-break">
              <h3>{h.matchEnd.winner === side ? 'You won!' : h.matchEnd.winner < 0 ? 'Match tied' : 'Match over'}</h3>
              <p className="ck-big">{h.matchEnd.result}</p>
              <Scorecard key={version} state={g.director.state} />
              <div className="ck-row">
                {p.onRematch && (
                  <button className="btn btn-primary" onClick={() => leave(p.onRematch!)}>
                    Play again
                  </button>
                )}
                <button className="btn" onClick={() => leave(p.onExit)}>
                  Back to the menu
                </button>
              </div>
            </div>
          )}
          {showCard && g && !h.matchEnd && !h.inningsBreak && (
            <div className="ck-overlay">
              <Scorecard key={version} state={g.director.state} onClose={() => setShowCard(false)} />
            </div>
          )}
          {h.paused && !howTo && (
            <div className="ck-overlay">
              <div className="ck-panel ck-center">
                <h3>Paused</h3>
                <div className="ck-row">
                  <button className="btn btn-primary" onClick={() => g?.setPaused(false)}>
                    Resume
                  </button>
                  <button className="btn" onClick={p.onExit}>
                    Quit match
                  </button>
                </div>
                <Help />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Scorebug({ h }: { h: HudState }) {
  return (
    <div className="ck-bug" style={{ ['--ck-team' as string]: h.batting.color }}>
      <div className="ck-bug-main">
        <span className="ck-bug-team">{h.batting.short}</span>
        <span className="ck-bug-score">{h.score}</span>
        <span className="ck-bug-overs">
          {h.overs}
          {!h.nets && <small>/{h.maxOvers}</small>}
        </span>
        {h.nets && <span className="ck-chip">NETS</span>}
        {h.powerplay && <span className="ck-chip">P</span>}
        {h.superOver && <span className="ck-chip ck-chip-hot">SUPER OVER</span>}
        {h.freeHit && <span className="ck-chip ck-chip-hot">FREE HIT</span>}
        <span className="ck-bug-rr">RR {h.runRate}</span>
      </div>
      <div className="ck-bug-row">
        {h.batters.map((b) => (
          <span key={b.name} className={`ck-bug-bat ${b.onStrike ? 'is-on' : ''}`}>
            {b.onStrike ? '▸ ' : ''}
            {b.name} <strong>{b.runs}</strong>
            <small>({b.balls})</small>
          </span>
        ))}
        {h.bowler && (
          <span className="ck-bug-bowl" style={{ ['--ck-team' as string]: h.fielding.color }}>
            {h.bowler.name} <strong>{h.bowler.figures}</strong>
          </span>
        )}
      </div>
      <div className="ck-bug-row ck-bug-sub">
        <span className="ck-over">
          {h.thisOver.map((s, i) => (
            <span key={i} className={`ck-ball ck-ball-${s === 'W' ? 'w' : s === '4' ? 'four' : s === '6' ? 'six' : s === '•' ? 'dot' : 'run'}`}>
              {s}
            </span>
          ))}
        </span>
        {h.need ? <span className="ck-need">{h.need}</span> : <span className="muted">P'ship {h.partnership}</span>}
        {h.lastKmh > 0 && <span className="muted">{h.lastKmh} km/h</span>}
      </div>
    </div>
  )
}

function Banner({ text, sub }: { text: string; sub: string }) {
  const kind = /SIX/.test(text)
    ? 'six'
    : /FOUR/.test(text)
      ? 'four'
      : /NOT OUT/.test(text)
        ? 'info'
        : /OUT|BOWLED|CAUGHT|LBW|STUMPED|HIT WICKET/.test(text)
          ? 'out'
          : /DOT BALL|RUNS?\b|WIDE|NO BALL/.test(text)
            ? 'result'
            : 'info'
  return (
    <div key={text} className={`ck-banner ck-banner-${kind}`}>
      <span className="ck-banner-text">{text}</span>
      {sub && <span className="ck-banner-sub">{sub}</span>}
    </div>
  )
}

/** What was just bowled: name, speed, type and where it will land, shown for a few seconds after release. */
function DeliveryCard({ card }: { card: NonNullable<HudState['card']> }) {
  return (
    <div className={`ck-card-delivery ${card.age > 2.6 ? 'is-fading' : ''}`}>
      <span className="ck-card-bowler">{card.bowler}</span>
      <span className="ck-card-kmh">
        {card.kmh}
        <small> km/h</small>
      </span>
      <span className={`ck-card-type ${card.spin ? 'is-spin' : ''}`}>{card.type}</span>
      <span className="ck-card-words">{card.words}</span>
    </div>
  )
}

const TIMING_LABEL: Record<string, string> = { noshot: 'Miss', veryearly: 'V.early', early: 'Early', perfect: 'Perfect', late: 'Late', verylate: 'V.late' }

/** The last six balls' timing, newest on the right. */
function TimingStrip({ timings }: { timings: string[] }) {
  const cells = [...timings]
  while (cells.length < 6) cells.unshift('')
  return (
    <div className="ck-strip" aria-label="Timing of the last six balls">
      <span className="ck-strip-label">Last 6</span>
      {cells.map((t, i) => (
        <span key={i} className={`ck-strip-cell ${t ? `is-${t}` : ''}`} title={t ? TIMING_LABEL[t] : 'No ball yet'}>
          {t ? TIMING_LABEL[t] : '·'}
        </span>
      ))}
    </div>
  )
}

/** One-screen guide, shown before the first ball of a human innings. Any key dismisses it. */
function HowTo({ mode, onClose }: { mode: HowToMode; onClose: (off: boolean) => void }) {
  const [off, setOff] = useState(false)
  const offRef = useRef(false)
  useEffect(() => {
    offRef.current = off
  }, [off])
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose(offRef.current)
    }
    window.addEventListener('keydown', down, { capture: true })
    return () => window.removeEventListener('keydown', down, { capture: true })
  }, [onClose])
  return (
    <div className="ck-overlay ck-howto-wrap">
      <div className="ck-panel ck-howto" role="dialog" aria-label="How to play">
        <p className="ck-howto-eyebrow">How to play</p>
        <h3>{mode === 'bat' ? "You're batting" : "You're bowling"}</h3>
        {mode === 'bat' ? (
          <ol className="ck-howto-steps">
            <li>
              <span className="ck-howto-pip ck-howto-pip-marker" />
              <div>
                <strong>Watch the marker.</strong> The cyan ring on the pitch is where the ball will land, with its length written under it.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-aim" />
              <div>
                <strong>Hold a direction</strong> with <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> or the arrows: the wedge on the ground shows where the shot will go. No direction plays the natural shot.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-ring" />
              <div>
                <strong>Press as the ring closes.</strong> The yellow ring shrinks onto the white one as the ball arrives: press <kbd>J</kbd> defend,{' '}
                <kbd>K</kbd> along the ground or <kbd>L</kbd> lofted when it turns green.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip" />
              <div>
                Hold <kbd>Shift</kbd> for the front foot, <kbd>Space</kbd> for the back foot. Then <kbd>R</kbd> runs and <kbd>F</kbd> sends him back.
              </div>
            </li>
          </ol>
        ) : (
          <ol className="ck-howto-steps">
            <li>
              <span className="ck-howto-pip ck-howto-pip-marker" />
              <div>
                <strong>Pick a delivery</strong> with <kbd>1</kbd>–<kbd>6</kbd> (or <kbd>Q</kbd>/<kbd>E</kbd>). Its name shows big on the right.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-aim" />
              <div>
                <strong>Place the yellow marker</strong> with <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd>. The bands on the pitch are the lengths: yorker, full, good, short.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-ring" />
              <div>
                <strong>Run in and release.</strong> <kbd>Space</kbd> starts the run-up; press <kbd>Space</kbd> again when the needle is in the green. Too
                late and it is a no-ball.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip" />
              <div>
                <kbd>F</kbd> changes the field, <kbd>V</kbd> goes round the wicket. While they run, <kbd>J</kbd> throws to the keeper and <kbd>L</kbd> to
                the bowler.
              </div>
            </li>
          </ol>
        )}
        <label className="ck-howto-check">
          <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> Don't show this again
        </label>
        <button className="btn btn-primary" onClick={() => onClose(off)}>
          Got it — press any key
        </button>
      </div>
    </div>
  )
}

function Commentary({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <div className="ck-comm" aria-live="polite">
      <p className="ck-comm-now">{lines[0]}</p>
      {lines.slice(1, 3).map((l, i) => (
        <p key={i} className="ck-comm-old">
          {l}
        </p>
      ))}
    </div>
  )
}

function QualityToggle({ value, actual, onChange }: { value: QualityTier | 'auto'; actual: QualityTier; onChange: (q: QualityTier | 'auto') => void }) {
  return (
    <div className="ck-quality" role="radiogroup" aria-label="Graphics quality">
      {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
        <button key={q} role="radio" aria-checked={value === q} className={`ck-qbtn ${value === q ? 'is-on' : ''}`} onClick={() => onChange(q)}>
          {q === 'auto' ? `Auto (${actual})` : q[0].toUpperCase() + q.slice(1)}
        </button>
      ))}
    </div>
  )
}

/** The 8-way direction compass, footwork and timing feedback, the confidence meter and running controls. */
function BattingHud({ h, game }: { h: HudState; game: Game | null }) {
  const { x, y, feet } = h.aim
  // Direction names are from the batter's point of view: on screen the off side flips for a left-hander, so the
  // sim's aim angle decides the word.
  const deg = h.aimDeg
  const label = deg === null ? '' : deg === 0 ? 'Straight' : deg > 0 ? (deg < 60 ? 'Off drive' : deg < 120 ? 'Square (off)' : 'Late cut') : deg > -60 ? 'On drive' : deg > -120 ? 'Square (leg)' : 'Fine leg'
  const hint = h.phase === 'flight' || h.phase === 'runup' ? (h.toContact > 0.6 || h.toContact < 0 ? 'Wait for the ring…' : h.toContact > 0.12 ? 'Get ready' : 'PLAY NOW') : h.phase === 'predelivery' ? 'Hold a direction, then time the shot' : ''
  return (
    <div className="ck-bat">
      <div className="ck-compass" aria-label="Shot direction">
        {[-1, 0, 1].map((yy) =>
          [-1, 0, 1].map((xx) => (
            <span key={`${xx},${yy}`} className={`ck-cell ${x === xx && y === -yy ? 'is-on' : ''} ${xx === 0 && yy === 0 ? 'ck-cell-mid' : ''}`} />
          )),
        )}
        <span className="ck-compass-label">{label || DIR_LABELS[`${x},${y}`] || 'Natural'}</span>
      </div>
      <div className="ck-bat-info">
        <div className="ck-feet">
          Feet: <strong>{feet === 'auto' ? 'Auto' : feet === 'front' ? 'Front foot' : 'Back foot'}</strong>
        </div>
        <div className="ck-confidence" title="Confidence: the batter's timing window widens when he's in">
          <span>In</span>
          <div className="ck-meter-bar">
            <div style={{ width: `${Math.round(h.confidence * 100)}%` }} />
          </div>
        </div>
        {h.timing ? <div className={`ck-timing ck-timing-${h.timing.split(' ')[0].toLowerCase()}`}>{h.timing}</div> : hint && <div className={`ck-timing-hint ${hint === 'PLAY NOW' ? 'is-now' : ''}`}>{hint}</div>}
        {(h.nets || h.timings.length > 0) && <TimingStrip timings={h.timings} />}
      </div>
      <div className="ck-keys">
        {h.live ? (
          <>
            <button onClick={() => game?.press('run')}>
              <kbd>R</kbd> Run
            </button>
            <button onClick={() => game?.press('back')}>
              <kbd>F</kbd> {h.running ? 'Back!' : 'Stay'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => game?.press('defend')}>
              <kbd>J</kbd> Defend
            </button>
            <button onClick={() => game?.press('ground')}>
              <kbd>K</kbd> Attack
            </button>
            <button onClick={() => game?.press('loft')}>
              <kbd>L</kbd> Lofted
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function BowlingHud({ h, game }: { h: HudState; game: Game | null }) {
  const m = h.meter
  const selected = h.delivery?.options.find((o) => o.type === h.delivery!.selected)
  // The needle moves every frame straight on the DOM (the HUD itself renders at 10 Hz).
  const wrapRef = useRef<HTMLDivElement>(null)
  const needleRef = useRef<HTMLDivElement>(null)
  const meterShown = !!m
  useEffect(() => {
    if (!game || !meterShown) return
    game.attachMeter(wrapRef.current, needleRef.current)
    return () => game.attachMeter(null, null)
  }, [game, meterShown])
  return (
    <div className="ck-bowl">
      {selected && (h.phase === 'predelivery' || h.phase === 'runup') && (
        <div key={selected.type} className="ck-dl-big">
          <span className="ck-dl-big-name">{selected.name}</span>
          <span className="ck-dl-big-words">{h.markerWords}</span>
        </div>
      )}
      {h.delivery && (
        <div className="ck-deliveries">
          {h.delivery.options.map((o) => (
            <button key={o.type} className={`ck-dl ${o.type === h.delivery!.selected ? 'is-on' : ''}`} onClick={() => game?.submit({ t: 'delivery', side: game.opts.localSide, type: o.type })}>
              <kbd>{o.key}</kbd> {o.name}
            </button>
          ))}
        </div>
      )}
      <div className="ck-bowl-row">
        <button className="pill" onClick={() => game?.press('preset')}>
          <kbd>F</kbd> Field: {PRESET_NAMES[h.preset]}
        </button>
        {h.delivery && (
          <button className="pill" onClick={() => game?.submit({ t: 'wicketside', side: game.opts.localSide })}>
            <kbd>V</kbd> {h.delivery.around ? 'Round the wicket' : 'Over the wicket'}
          </button>
        )}
        {h.bowler && (
          <span className="ck-stamina" title="Stamina">
            Stamina
            <span className="ck-meter-bar">
              <span style={{ width: `${Math.round(h.bowler.stamina)}%` }} />
            </span>
          </span>
        )}
      </div>
      {m && (
        <div ref={wrapRef} className={`ck-power-wrap ${m.running ? 'is-running' : ''}`} data-green={m.running && Math.abs(m.value - m.green) <= m.half ? '1' : '0'}>
          <div className="ck-power-title">
            {m.running ? (
              <>
                <strong>RELEASE</strong> — press <kbd>Space</kbd> in the green
              </>
            ) : h.phase === 'runup' ? (
              'Released'
            ) : (
              <>
                Run-up meter · <kbd>Space</kbd> to run in
              </>
            )}
          </div>
          <div className="ck-power" aria-label="Release meter">
            <div className="ck-power-zone" style={{ left: `${(m.green - m.half) * 100}%`, width: `${m.half * 200}%` }} />
            <div className="ck-power-over" style={{ left: `${(m.green + m.half * 1.15) * 100}%` }} />
            <div ref={needleRef} className="ck-power-needle" style={{ left: `${m.value * 100}%` }} />
            <span className="ck-power-tag ck-power-tag-early">early = short &amp; slow</span>
            <span className="ck-power-tag ck-power-tag-green" style={{ left: `${m.green * 100}%` }}>
              GREEN
            </span>
            <span className="ck-power-tag ck-power-tag-late">no ball</span>
          </div>
        </div>
      )}
      <p className="ck-hint">
        {h.phase === 'predelivery' ? (
          <>
            <kbd>WASD</kbd>/<kbd>Arrows</kbd> move the yellow marker over a length band · <kbd>1</kbd>–<kbd>6</kbd> delivery · <kbd>Space</kbd> run in
          </>
        ) : h.phase === 'runup' ? (
          <>
            Wait for the needle, then <kbd>Space</kbd> in the green · late = no-ball, early = loose
          </>
        ) : (
          <>
            <kbd>J</kbd> throw to the keeper · <kbd>L</kbd> to the bowler
          </>
        )}
      </p>
    </div>
  )
}

function TossPanel({ h, send, side }: { h: HudState; send: (c: Command) => void; side: number }) {
  const t = h.toss!
  return (
    <div className="ck-panel ck-center">
      <h3>The toss</h3>
      {t.stage === 'call' && (
        <>
          <p>Call it in the air!</p>
          <div className="ck-row">
            <button className="btn btn-primary" onClick={() => send({ t: 'toss', side, call: 0 })}>
              <kbd>H</kbd> Heads
            </button>
            <button className="btn btn-primary" onClick={() => send({ t: 'toss', side, call: 1 })}>
              <kbd>T</kbd> Tails
            </button>
          </div>
        </>
      )}
      {t.stage === 'choose' && (
        <>
          <p>
            It's {t.result}. <strong>You won the toss.</strong>
          </p>
          <div className="ck-row">
            <button className="btn btn-primary" onClick={() => send({ t: 'tosschoice', side, bat: true })}>
              <kbd>B</kbd> Bat first
            </button>
            <button className="btn btn-primary" onClick={() => send({ t: 'tosschoice', side, bat: false })}>
              <kbd>W</kbd> Bowl first
            </button>
          </div>
        </>
      )}
      {t.stage === 'wait' && <p className="muted">{t.result ? `${t.result}. ${t.winner} won the toss…` : 'The coin is in the air…'}</p>}
    </div>
  )
}

function DrsPanel({ h }: { h: HudState }) {
  const r = h.review!
  const step = (at: number, label: string, value: string) => (
    <div className={`ck-drs-row ${r.time >= at ? 'is-on' : ''}`}>
      <span>{label}</span>
      <strong className={`ck-zone ck-zone-${value.toLowerCase().replace(/[^a-z]/g, '')}`}>{r.time >= at ? value : '…'}</strong>
    </div>
  )
  return (
    <div className="ck-drs">
      <div className="ck-drs-head">
        <span className="ck-chip ck-chip-hot">DRS</span> {r.kind === 'runout' ? 'Third umpire · run out' : `${r.reviewing} review`}
      </div>
      {r.kind === 'lbw' && (
        <>
          {step(0.8, 'Pitching', r.pitching)}
          {step(2.0, 'Impact', r.impact)}
          {step(4.0, 'Wickets', r.wickets)}
        </>
      )}
      {r.kind === 'caught' && (
        <div className="ck-edge">
          <span>Edge detection</span>
          <svg viewBox="0 0 200 50" width="220" height="56" aria-hidden="true">
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              points={Array.from({ length: 100 }, (_, i) => {
                const t = i / 99
                const spike = r.edge && Math.abs(t - 0.55) < 0.03 && r.time > 1.5 ? 20 * Math.sin(i * 2.3) : 0
                return `${i * 2},${25 + Math.sin(i * 1.7) * 1.5 + spike}`
              }).join(' ')}
            />
          </svg>
          {r.time > 2.5 && <strong>{r.edge ? 'SPIKE: EDGE' : 'NO EDGE'}</strong>}
        </div>
      )}
      {r.kind === 'runout' && r.time > 3 && <div className="ck-drs-row is-on">Checking the bat at the crease…</div>}
      {r.time > r.duration - 1.2 && <div className={`ck-verdict ${r.finalOut ? 'is-out' : 'is-notout'}`}>{r.finalOut ? 'OUT' : 'NOT OUT'}</div>}
    </div>
  )
}

export function Help() {
  return (
    <div className="ck-help">
      <div>
        <h4>Batting</h4>
        <p>
          The cyan ring on the pitch is where the ball will land. Hold a direction with <kbd>WASD</kbd> or the arrows (8 ways; none plays the natural shot)
          and the wedge on the ground shows where the shot goes. Press as the timing ring closes and turns green: <kbd>J</kbd> defend, <kbd>K</kbd> along
          the ground, <kbd>L</kbd> lofted (also <kbd>Z</kbd>/<kbd>X</kbd>/<kbd>C</kbd>). Hold <kbd>Shift</kbd> for the front foot or <kbd>Space</kbd> for the
          back foot. <kbd>T</kbd> charges a spinner. Run with <kbd>R</kbd>, stay or turn back with <kbd>F</kbd>.
        </p>
      </div>
      <div>
        <h4>Bowling</h4>
        <p>
          Pick the delivery with <kbd>1</kbd>–<kbd>6</kbd> (or <kbd>Q</kbd>/<kbd>E</kbd>), move the pitch marker with <kbd>WASD</kbd>, <kbd>Space</kbd> to run in, then{' '}
          <kbd>Space</kbd> again when the needle is in the green. Too late and you overstep. <kbd>F</kbd> field preset, <kbd>V</kbd> over/round the wicket. While
          fielding, <kbd>J</kbd>/<kbd>L</kbd> throw to the keeper's or bowler's end.
        </p>
      </div>
      <div>
        <h4>Everything else</h4>
        <p>
          <kbd>Y</kbd> review (DRS) · hold <kbd>Tab</kbd> scorecard · <kbd>C</kbd> camera · <kbd>Space</kbd> skip a replay · <kbd>Esc</kbd> pause.
        </p>
      </div>
    </div>
  )
}
