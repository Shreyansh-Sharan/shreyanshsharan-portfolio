// The running match: the three.js canvas plus the broadcast HUD (scorebug, batting and bowling controls, toss,
// bowler choice, DRS, innings break, result), the scorecard overlay and the pause menu.
import { useEffect, useRef, useState } from 'react'
import '../cricket.css'
import { loadCricketAssets } from '../assets'
import { Game, type HudState } from '../game'
import type { MatchSetup } from '../sim/match'
import type { Command, GameEvent } from '../sim/director'
import { PRESET_NAMES } from '../sim/fields'
import { BowlerCard, BowlMeter, ContextStrip, DeliveryPicker, FeetToggle, Milestone, PipFrame, Radar, ReplayOverlay, RunCall, Scorebug, ShotPad, SpeedGun } from './Hud'
import { FieldEditor } from './FieldEditor'
import '../hud.css'
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

/** Touch-first devices get the big thumb controls. */
function isTouch() {
  try {
    return matchMedia('(pointer: coarse)').matches || new URLSearchParams(window.location.search).has('touch')
  } catch {
    return false
  }
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
  const [editField, setEditField] = useState(false)
  const [touch] = useState(isTouch)
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

  // G opens the field editor before a ball you are bowling.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      if (!g || e.repeat) return
      if (e.key.toLowerCase() === 'g' && !editField && g.hudState().canEditField) {
        e.preventDefault()
        setEditField(true)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [editField])

  // The game is frozen while the field editor is open.
  useEffect(() => {
    const g = gameRef.current
    if (!g) return
    g.setHold(editField)
    if (!editField) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setEditField(false)
    window.addEventListener('keydown', esc, { capture: true })
    return () => window.removeEventListener('keydown', esc, { capture: true })
  }, [editField])

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

  const bowlPhase = h && (h.phase === 'predelivery' || h.phase === 'runup')
  const showBat = h && h.localBats && !h.replay && (h.phase === 'predelivery' || h.phase === 'runup' || h.phase === 'flight' || h.phase === 'live' || h.phase === 'dead')
  const showBowl = h && h.localBowls && !h.replay && (h.phase === 'predelivery' || h.phase === 'runup' || h.phase === 'live')
  const inPlay = h && (h.phase === 'predelivery' || h.phase === 'runup' || h.phase === 'flight' || h.phase === 'live' || h.phase === 'dead' || h.phase === 'replay' || h.phase === 'review')
  return (
    <div className={`racer-stage ck-stage ${touch ? 'is-touch' : ''} ${h?.hero ? 'is-hero' : ''} ${h?.replay ? 'is-replay' : ''}`}>
      <div ref={host} className="racer-host" />
      {!h && !error && (
        <div className="ck-loadscreen">
          <img src={`${import.meta.env.BASE_URL}cricket/menu-loft.webp`} alt="" />
          <div className="ck-loadbar">
            <span>Building the stadium… {Math.round(loadPct * 100)}%</span>
            <i style={{ width: `${Math.round(loadPct * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <div className="vr-loading ck-loading">Couldn't load the game: {error}</div>}
      {h && (
        <>
          <div className="ck-letterbox" aria-hidden="true" />
          {h.pip && <PipFrame pip={h.pip} />}
          {!h.replay && <Scorebug h={h} />}
          {!h.replay && inPlay && <ContextStrip h={h} />}
          {inPlay && !h.hero && !h.replay && <Radar game={g} />}
          <div className="ck-topbar">
            <button className="ck-ibtn" onClick={() => g?.setPaused(!h.paused)} title="Pause (Esc)">
              {h.paused ? '▶' : '❚❚'}
            </button>
            <button className="ck-ibtn" onClick={() => setShowCard((s) => !s)} title="Scorecard (hold Tab)">
              Card
            </button>
            <button className="ck-ibtn" onClick={() => g?.toggleCamera()} title="Camera (C)">
              {h.camera === 'batter' ? 'Bat cam' : h.camera === 'broadcast' ? 'TV cam' : 'High cam'}
            </button>
            <button className="ck-ibtn" disabled={!h.canReplay} onClick={() => g?.press('replay')} title="Instant replay (I)">
              ⟲ Replay
            </button>
            {h.canEditField && (
              <button className="ck-ibtn ck-ibtn-hot" onClick={() => setEditField(true)} title="Set the field (G)">
                Field
              </button>
            )}
          </div>
          {!h.hero && !h.replay && <Commentary lines={lines} />}
          {h.card && !h.replay && <SpeedGun card={h.card} />}
          {h.bowlerCard && bowlPhase && !h.replay && <BowlerCard c={h.bowlerCard} team={h.fielding.color} bowling={h.localBowls} />}
          {h.banner && !h.replay && <Banner text={h.banner} sub={h.bannerSub} />}
          {h.milestone && <Milestone m={h.milestone} />}
          {h.runCall && !h.replay && <RunCall c={h.runCall} />}
          {pop && !h.replay && (
            <div key={pop.id} className={`ck-pop ck-pop-${pop.kind}`}>
              {pop.text}
            </div>
          )}
          {showBat && <BattingHud h={h} game={g} touch={touch} />}
          {showBowl && <BowlingHud h={h} game={g} touch={touch} onField={() => setEditField(true)} />}
          {h.replay && <ReplayOverlay r={h.replay} onSkip={() => g?.press('skip')} />}
          {howTo && <HowTo mode={howTo} onClose={closeHowTo} />}
          {editField && g && <FieldEditor game={g} onClose={() => setEditField(false)} />}
          {h.toss && <TossPanel h={h} send={send} side={side} />}
          {h.chooseBowler && <ChooseBowler h={h} send={send} side={side} />}
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
          {h.review && !h.replay && <DrsPanel h={h} />}
          {h.review && h.replay && h.review.time > h.review.duration - 1.2 && <div className={`ck-tv-verdict ${h.review.finalOut ? 'is-out' : 'is-notout'}`}>{h.review.finalOut ? 'OUT' : 'NOT OUT'}</div>}
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
                <div className="ck-pause-opts">
                  <span>Graphics</span>
                  <QualityToggle value={quality} actual={h.quality} onChange={setQuality} />
                  <span>Replays</span>
                  <div className="ck-quality" role="radiogroup" aria-label="Automatic replays">
                    {(
                      [
                        ['all', 'All'],
                        ['key', 'Wickets & sixes'],
                        ['off', 'Off'],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} role="radio" aria-checked={h.replayPref === id} className={`ck-qbtn ${h.replayPref === id ? 'is-on' : ''}`} onClick={() => g?.setReplayPref(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
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
                <strong>Read the ball.</strong> The cyan ring is where it will pitch. Watch it swing in the air and turn or seam off the pitch: the card up top names
                the delivery after it is bowled.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-aim" />
              <div>
                <strong>Pick a direction</strong> with <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> (8 ways, or the pad). <kbd>Shift</kbd> front foot, <kbd>Space</kbd> back foot: drive, cut, pull, hook, sweep, flick.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-ring" />
              <div>
                <strong>Time it</strong> as the yellow ring closes: <kbd>J</kbd> defend, <kbd>K</kbd> along the ground, <kbd>L</kbd> lofted, <kbd>H</kbd> leave.
                Driving at the one going away finds the edge; the one coming back goes through the gate.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip" />
              <div>
                Calls: <kbd>R</kbd> yes, <kbd>F</kbd> no, <kbd>G</kbd> wait. <kbd>I</kbd> instant replay.
              </div>
            </li>
          </ol>
        ) : (
          <ol className="ck-howto-steps">
            <li>
              <span className="ck-howto-pip ck-howto-pip-marker" />
              <div>
                <strong>Pick the delivery</strong> with the number keys: swing, cutters, yorker, bouncer, slower ball; or for spinners the stock ball, the other
                one, the arm ball and the top-spinner.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-aim" />
              <div>
                <strong>Aim the marker</strong> with <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> or by tapping the pitch: the bands are yorker, full, good and short.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip ck-howto-pip-ring" />
              <div>
                <strong>Run in and release.</strong> <kbd>Space</kbd> runs in; press <kbd>Space</kbd> again as the needle climbs the arc. Green is clean, the bright
                middle is perfect (full pace, late swing); early red is loose, late red a no-ball.
              </div>
            </li>
            <li>
              <span className="ck-howto-pip" />
              <div>
                <kbd>G</kbd> field editor, <kbd>F</kbd> next field preset, <kbd>V</kbd> round the wicket. While they run, <kbd>J</kbd> throws to the keeper and{' '}
                <kbd>L</kbd> to the bowler.
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
      <p key={lines[0]} className="ck-comm-now">
        {lines[0]}
      </p>
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

/** Batting: the shot pad, footwork, the shot buttons (defend, ground, lofted, leave), timing and the running calls. */
function BattingHud({ h, game, touch }: { h: HudState; game: Game | null; touch: boolean }) {
  const hint = h.phase === 'flight' || h.phase === 'runup' ? (h.toContact > 0.6 || h.toContact < 0 ? 'Watch it…' : h.toContact > 0.12 ? 'Get ready' : 'NOW') : h.phase === 'predelivery' ? 'Pick a direction, then time it' : ''
  const live = h.live || h.phase === 'dead'
  return (
    <>
      <div className="ck-bat2-left">
        <ShotPad h={h} game={game} touch={touch} />
        {!live && <FeetToggle h={h} game={game} />}
      </div>
      <div className="ck-bat2-right">
        <div className="ck-bat2-info">
          {h.timing ? <div className={`ck-timing ck-timing-${h.timing.split(' ')[0].toLowerCase()}`}>{h.timing}</div> : hint && <div className={`ck-timing-hint ${hint === 'NOW' ? 'is-now' : ''}`}>{hint}</div>}
          <div className="ck-confidence" title="Confidence: the timing window widens when he is in">
            <span>IN</span>
            <div className="ck-meter-bar">
              <div style={{ width: `${Math.round(h.confidence * 100)}%` }} />
            </div>
          </div>
          {(h.nets || h.timings.length > 0) && <TimingStrip timings={h.timings} />}
        </div>
        <div className={`ck-actions ${live ? 'is-run' : ''}`}>
          {live ? (
            <>
              <button className="ck-act ck-act-yes" onClick={() => game?.press('run')}>
                <kbd>R</kbd>
                <b>YES</b>
                <span>Run</span>
              </button>
              <button className="ck-act ck-act-wait" onClick={() => game?.press('wait')}>
                <kbd>G</kbd>
                <b>WAIT</b>
                <span>Hold</span>
              </button>
              <button className="ck-act ck-act-no" onClick={() => game?.press('back')}>
                <kbd>F</kbd>
                <b>NO</b>
                <span>{h.running ? 'Go back' : 'Stay'}</span>
              </button>
            </>
          ) : (
            <>
              <button className="ck-act ck-act-def" onClick={() => game?.press('defend')}>
                <kbd>J</kbd>
                <b>DEFEND</b>
              </button>
              <button className="ck-act ck-act-ground" onClick={() => game?.press('ground')}>
                <kbd>K</kbd>
                <b>GROUND</b>
              </button>
              <button className="ck-act ck-act-loft" onClick={() => game?.press('loft')}>
                <kbd>L</kbd>
                <b>LOFT</b>
              </button>
              <button className="ck-act ck-act-leave" onClick={() => game?.press('leave')}>
                <kbd>H</kbd>
                <b>LEAVE</b>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/** Bowling: the delivery picker, the curved release meter, the field and the angle of approach. */
function BowlingHud({ h, game, touch, onField }: { h: HudState; game: Game | null; touch: boolean; onField: () => void }) {
  const pre = h.phase === 'predelivery'
  const run = h.phase === 'runup'
  return (
    <>
      {h.delivery && (pre || run) && <DeliveryPicker h={h} game={game} />}
      {h.meter && <BowlMeter h={h} game={game} />}
      <div className="ck-bowl2">
        {pre && (
          <div className="ck-bowl2-row">
            <button className="pill" onClick={onField} disabled={!h.canEditField}>
              <kbd>G</kbd> Field: {PRESET_NAMES[h.preset]}
            </button>
            <button className="pill" onClick={() => game?.press('preset')}>
              <kbd>F</kbd> Next preset
            </button>
            {h.delivery && (
              <button className="pill" onClick={() => game?.submit({ t: 'wicketside', side: game.opts.localSide })}>
                <kbd>V</kbd> {h.delivery.around ? 'Round the wicket' : 'Over the wicket'}
              </button>
            )}
          </div>
        )}
        {(pre || (run && h.meter?.running)) && (
          <button className="ck-act ck-act-bowl" onClick={() => game?.press('bowl')}>
            <kbd>Space</kbd>
            <b>{pre ? 'BOWL' : 'RELEASE'}</b>
          </button>
        )}
        {h.phase === 'live' && (
          <div className="ck-bowl2-row">
            <button className="pill" onClick={() => game?.submit({ t: 'throw', side: game.opts.localSide, end: 'keeper' })}>
              <kbd>J</kbd> Throw to the keeper
            </button>
            <button className="pill" onClick={() => game?.submit({ t: 'throw', side: game.opts.localSide, end: 'bowler' })}>
              <kbd>L</kbd> To the bowler
            </button>
          </div>
        )}
        {pre && !touch && <p className="ck-hint">WASD or tap the pitch: aim the marker · 1–{h.delivery?.options.length ?? 6} delivery</p>}
      </div>
    </>
  )
}

/** Choosing the next bowler: cards by type (pace, swing, spin) with figures and the quota left. */
function ChooseBowler({ h, send, side }: { h: HudState; send: (c: Command) => void; side: number }) {
  const opts = h.chooseBowler!.options
  return (
    <div className="ck-panel ck-center ck-choose">
      <h3>Choose your bowler</h3>
      <div className="ck-choose-grid">
        {opts.map((o, i) => (
          <button key={o.player} className={`ck-choose-card ck-type-${o.type}`} onClick={() => send({ t: 'bowler', side, player: o.player })}>
            <span className="ck-choose-tag">
              <kbd>{i + 1}</kbd> {o.tag}
            </span>
            <strong>{o.name}</strong>
            <span className="ck-choose-bars">
              <span>
                Pace <i style={{ width: `${o.pace}%` }} />
              </span>
              <span>
                Skill <i style={{ width: `${o.skill}%` }} />
              </span>
            </span>
            <span className="ck-choose-fig">
              {o.overs} ov · {o.figures}
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">Fast for pace and bounce, swing for the new ball under lights, spin on a dry pitch. Nobody bowls two overs in a row.</p>
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
