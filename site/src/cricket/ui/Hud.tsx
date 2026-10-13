// The broadcast layer over the match: the lower-third scorebug with the over's balls, the context strip (fielding
// restrictions, the chase, the partnership), the radar of the field, the batter PIP frame, the bowler card and speed
// gun, milestone cards, running calls, the replay captions and ball-tracking readout, the curved release meter, the
// delivery picker, and the batting pad (8 directions, footwork, defend / ground / lofted / leave) that also works by
// touch. The game moves the fast parts (the meter needle, the radar dots) straight on the DOM.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Game, HudState } from '../game'
import { METER_ARC } from '../game'
import { DELIVERIES, type DeliveryType } from '../sim/delivery'
import { Geo } from '../sim/geo'

/* ---------------- scorebug ---------------- */

const ballClass = (s: string) => (s === 'W' ? 'w' : s === '4' ? 'four' : s === '6' ? 'six' : s === '•' ? 'dot' : /wd|nb/.test(s) ? 'extra' : 'run')

export function Scorebug({ h }: { h: HudState }) {
  const balls = [...h.thisOver]
  const legal = balls.filter((b) => !/wd|nb/.test(b)).length
  for (let i = legal; i < 6; i++) balls.push('')
  return (
    <div className="ck-lower" style={{ ['--bat' as string]: h.batting.color, ['--bowl' as string]: h.fielding.color }}>
      <div className="ck-lower-team">
        <span className="ck-lower-short">{h.batting.short}</span>
        <span className="ck-lower-v">v {h.fielding.short}</span>
      </div>
      <div className="ck-lower-score">
        <strong>{h.score}</strong>
        <span className="ck-lower-overs">
          {h.overs}
          {!h.nets && <small> / {h.maxOvers}</small>}
        </span>
      </div>
      <div className="ck-lower-bats">
        {h.batters.map((b) => (
          <div key={b.name + (b.onStrike ? '*' : '')} className={`ck-lower-bat ${b.onStrike ? 'is-on' : ''}`}>
            <span className="ck-lower-name">
              {b.onStrike && <i className="ck-strike" aria-label="on strike" />}
              {b.name}
            </span>
            <span className="ck-lower-runs">
              {b.runs}
              <small>{b.balls}</small>
            </span>
          </div>
        ))}
      </div>
      {h.bowler && (
        <div className="ck-lower-bowl">
          <span className="ck-lower-name">{h.bowler.name}</span>
          <span className="ck-lower-fig">{h.bowler.figures}</span>
        </div>
      )}
      <div className="ck-lower-over" aria-label="This over">
        {balls.map((s, i) => (
          <span key={i} className={`ck-b ${s ? `ck-b-${ballClass(s)}` : 'ck-b-empty'}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The strip above the scorebug: fielding restrictions, the chase or the run rate, the partnership. */
export function ContextStrip({ h }: { h: HudState }) {
  const r = h.restrictions
  return (
    <div className="ck-context">
      {h.superOver && <span className="ck-ctx ck-ctx-hot">SUPER OVER</span>}
      {h.freeHit && <span className="ck-ctx ck-ctx-hot">FREE HIT</span>}
      {r?.powerplay && (
        <span className="ck-ctx ck-ctx-pp">
          <b>P</b> FIELDING RESTRICTIONS APPLY · {r.outside}/{r.maxOutside} OUT
        </span>
      )}
      {h.nets && <span className="ck-ctx">PRACTICE NETS</span>}
      {h.target > 0 && h.need ? (
        <span className="ck-ctx ck-ctx-need">{h.need}</span>
      ) : (
        !h.nets && <span className="ck-ctx">CRR {h.runRate}</span>
      )}
      {!h.nets && h.partnership && <span className="ck-ctx ck-ctx-dim">P'SHIP {h.partnership}</span>}
    </div>
  )
}

/* ---------------- radar and picture-in-picture ---------------- */

/** The field from above (the striker's end at the top, like the broadcast camera); the game moves the dots. */
export function Radar({ game }: { game: Game | null }) {
  const g = useRef<SVGGElement>(null)
  useEffect(() => {
    if (!game) return
    game.attachRadar(g.current)
    return () => game.attachRadar(null)
  }, [game])
  const ring = Geo.InnerCircle
  return (
    <div className="ck-radar" aria-hidden="true">
      <svg viewBox="-72 -76 144 152">
        <ellipse cx="0" cy="0" rx={Geo.BoundarySquare} ry={Geo.BoundaryStraight} className="ck-radar-field" />
        <path d={`M ${-ring} ${-Geo.HalfPitch} A ${ring} ${ring} 0 0 1 ${ring} ${-Geo.HalfPitch} L ${ring} ${Geo.HalfPitch} A ${ring} ${ring} 0 0 1 ${-ring} ${Geo.HalfPitch} Z`} className="ck-radar-ring" />
        <rect x={-1.6} y={-Geo.HalfPitch - 1} width={3.2} height={Geo.PitchLength + 2} className="ck-radar-pitch" />
        <g ref={g} />
      </svg>
    </div>
  )
}

export function PipFrame({ pip }: { pip: NonNullable<HudState['pip']> }) {
  return (
    <div className="ck-pip" style={{ left: pip.x, top: pip.y, width: pip.w, height: pip.h }}>
      <span>{pip.label}</span>
    </div>
  )
}

/* ---------------- bowler card, speed gun, milestones, calls ---------------- */

export function BowlerCard({ c, team, bowling }: { c: NonNullable<HudState['bowlerCard']>; team: string; bowling: boolean }) {
  return (
    <div className="ck-bcard" style={{ ['--bowl' as string]: team }}>
      <div className="ck-bcard-top">
        <span className="ck-bcard-tag">{c.tag}</span>
        <span className="ck-bcard-pace">
          PACE <b>{c.pace}</b>
        </span>
        <span className="ck-bcard-pace">
          SKILL <b>{c.skill}</b>
        </span>
      </div>
      <div className="ck-bcard-name">{c.name}</div>
      <div className="ck-bcard-row">
        <span>{c.figures}</span>
        {bowling && (
          <span className="ck-bcard-stam" title="Stamina">
            <i style={{ width: `${c.stamina}%` }} />
          </span>
        )}
      </div>
    </div>
  )
}

/** The speed gun after release: km/h to a tenth, the delivery, where it pitched. */
export function SpeedGun({ card }: { card: NonNullable<HudState['card']> }) {
  return (
    <div className={`ck-gun ${card.age > 2.7 ? 'is-fading' : ''}`}>
      <div className="ck-gun-speed">
        {card.kmhTenths.toFixed(1)}
        <small>KM/H</small>
      </div>
      <div className={`ck-gun-type ${card.spin ? 'is-spin' : ''}`}>
        {card.type}
        {card.late && <em>LATE SWING</em>}
      </div>
      <div className="ck-gun-words">{card.words}</div>
    </div>
  )
}

export function Milestone({ m }: { m: NonNullable<HudState['milestone']> }) {
  return (
    <div key={m.title + m.name} className={`ck-mile ck-mile-${m.kind} ${m.age > 3.6 ? 'is-out' : ''}`}>
      <span className="ck-mile-title">{m.title}</span>
      <span className="ck-mile-name">{m.name}</span>
      <span className="ck-mile-line">{m.line}</span>
    </div>
  )
}

export function RunCall({ c }: { c: NonNullable<HudState['runCall']> }) {
  return (
    <div key={c.text + c.who} className={`ck-call ck-call-${c.text.toLowerCase()}`}>
      <small>{c.who === 0 ? 'STRIKER' : 'NON-STRIKER'}</small>
      {c.text}!
    </div>
  )
}

/* ---------------- replays ---------------- */

export function ReplayOverlay({ r, onSkip }: { r: NonNullable<HudState['replay']>; onSkip: () => void }) {
  return (
    <>
      <div className="ck-replay">
        <span className="ck-replay-badge">{r.owner === 'tv' ? 'TV UMPIRE' : r.owner === 'instant' ? 'INSTANT REPLAY' : 'REPLAY'}</span>
        <span className="ck-replay-label">{r.label}</span>
        {r.count > 1 && (
          <span className="ck-replay-dots">
            {Array.from({ length: r.count }, (_, i) => (
              <i key={i} className={i === r.index ? 'is-on' : i < r.index ? 'is-done' : ''} />
            ))}
          </span>
        )}
        {r.slow && <span className="ck-replay-slow">SLOW MO</span>}
      </div>
      {r.owner !== 'tv' && (
        <button className="ck-skip" onClick={onSkip}>
          Skip <kbd>Space</kbd>
        </button>
      )}
      {r.track && (
        <div className="ck-track">
          <div className="ck-drs-head">BALL TRACKING</div>
          <TrackRow at={0.6} t={r.track.time} label="Pitching" value={r.track.pitching} />
          {r.track.impact && <TrackRow at={1.6} t={r.track.time} label="Impact" value={r.track.impact} />}
          <TrackRow at={r.track.impact ? 3.8 : 1.8} t={r.track.time} label="Wickets" value={r.track.wickets} />
        </div>
      )}
    </>
  )
}

function TrackRow({ at, t, label, value }: { at: number; t: number; label: string; value: string }) {
  return (
    <div className={`ck-drs-row ${t >= at ? 'is-on' : ''}`}>
      <span>{label}</span>
      <strong className={`ck-zone ck-zone-${value.toLowerCase().replace(/[^a-z]/g, '')}`}>{t >= at ? value : '…'}</strong>
    </div>
  )
}

/* ---------------- bowling ---------------- */

const polar = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return [100 + r * Math.sin(a), 100 - r * Math.cos(a)]
}
const arcPath = (r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(r, a0)
  const [x1, y1] = polar(r, a1)
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

/**
 * The curved release meter: the needle climbs the arc through the last strides of the run-up. Green is a clean
 * release (the middle of it is the perfect one: full pace and late swing); early in the red the ball is loose, late
 * in the red it is a no-ball.
 */
export function BowlMeter({ h, game }: { h: HudState; game: Game | null }) {
  const m = h.meter!
  const wrap = useRef<HTMLDivElement>(null)
  const needle = useRef<SVGGElement>(null)
  useEffect(() => {
    if (!game) return
    game.attachMeter(wrap.current, needle.current as unknown as HTMLElement)
    return () => game.attachMeter(null, null)
  }, [game])
  const A = (v: number) => METER_ARC.from + Math.max(0, Math.min(1, v)) * (METER_ARC.to - METER_ARC.from)
  const g = m.green
  const hw = m.half
  const zones: [number, number, string][] = [
    [0, g - 2 * hw, 'red'],
    [g - 2 * hw, g - hw, 'amber'],
    [g - hw, g + hw, 'green'],
    [g + hw, g + 1.15 * hw, 'amber'],
    [g + 1.15 * hw, 1, 'red'],
  ]
  return (
    <div ref={wrap} className={`ck-arc ${m.running ? 'is-running' : ''}`} data-green="0">
      <svg viewBox="0 0 200 200" aria-label="Release meter">
        <path d={arcPath(80, METER_ARC.from, METER_ARC.to)} className="ck-arc-track" />
        {zones.map(([a, b, c], i) => (b > a ? <path key={i} d={arcPath(80, A(a), A(b))} className={`ck-arc-zone ck-arc-${c}`} /> : null))}
        <path d={arcPath(80, A(g - hw * 0.2), A(g + hw * 0.2))} className="ck-arc-sweet" />
        <g ref={needle} className="ck-arc-needle" style={{ transform: `rotate(${A(m.value)}deg)` }}>
          <line x1="100" y1="100" x2="100" y2="12" />
          <circle cx="100" cy="16" r="7" />
        </g>
        <circle cx="100" cy="100" r="5" className="ck-arc-hub" />
        <ArcLabel v={(g + 1.15 * hw + 1) / 2} text="NO BALL" cls="r" A={A} />
        <ArcLabel v={g} text="PERFECT" cls="g" A={A} />
        <ArcLabel v={Math.max(0.06, (g - 2 * hw) / 2)} text="LOOSE" cls="a" A={A} />
      </svg>
      <div className="ck-arc-text">
        {m.running ? (
          <>
            <b>RELEASE</b>
            <span>
              <kbd>Space</kbd> in the green
            </span>
          </>
        ) : h.phase === 'runup' ? (
          <b>RUNNING IN</b>
        ) : (
          <>
            <b>RUN IN</b>
            <span>
              <kbd>Space</kbd> or tap Bowl
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function ArcLabel({ v, text, cls, A }: { v: number; text: string; cls: string; A: (v: number) => number }) {
  const [x, y] = polar(106, A(v))
  return (
    <text x={x} y={y + 3} className={`ck-arc-label ${cls}`} textAnchor="end">
      {text}
    </text>
  )
}

export function DeliveryPicker({ h, game }: { h: HudState; game: Game | null }) {
  const dl = h.delivery!
  return (
    <div className="ck-dpick">
      <div className="ck-dpick-head">
        <span>{h.bowlerCard?.tag ?? ''}</span>
        <span className="ck-dpick-words">{h.markerWords}</span>
      </div>
      <div className="ck-dpick-list">
        {dl.options.map((o) => {
          const spec = DELIVERIES[o.type as DeliveryType]
          return (
            <button key={o.type} className={`ck-dpick-btn ${o.type === dl.selected ? 'is-on' : ''} ${spec.spin ? 'is-spin' : ''}`} onClick={() => game?.submit({ t: 'delivery', side: game.opts.localSide, type: o.type })} title={spec.blurb}>
              <kbd>{o.key}</kbd>
              <span>{o.name}</span>
            </button>
          )
        })}
      </div>
      <div className="ck-dpick-blurb">{DELIVERIES[dl.selected].blurb}</div>
    </div>
  )
}

/* ---------------- batting ---------------- */

const DIRS: [number, number][] = [
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

/**
 * The shot pad: the 8 directions (held keys light up; by touch it is a thumb pad: press and slide). The game
 * turns screen directions into the batter's: off side and leg side swap for a left-hander.
 */
export function ShotPad({ h, game, touch }: { h: HudState; game: Game | null; touch: boolean }) {
  const [held, setHeld] = useState<[number, number] | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const x = held ? held[0] : h.aim.x
  const y = held ? held[1] : h.aim.y
  const fromEvent = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
    const dy = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const q = (v: number) => (v > 0.33 ? 1 : v < -0.33 ? -1 : 0)
    return [q(dx), q(dy)] as [number, number]
  }
  const set = (v: [number, number] | null) => {
    setHeld(v)
    game?.setTouchDir(v ? v[0] : 0, v ? v[1] : 0)
  }
  const deg = h.aimDeg
  const label = deg === null ? 'Natural shot' : deg === 0 ? 'Straight' : deg > 0 ? (deg < 60 ? 'Off drive' : deg < 120 ? 'Square, off side' : 'Behind, off side') : deg > -60 ? 'On drive' : deg > -120 ? 'Square, leg side' : 'Fine leg'
  return (
    <div
      ref={ref}
      className={`ck-pad ${touch ? 'is-touch' : ''}`}
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        set(fromEvent(e))
      }}
      onPointerMove={(e) => held && set(fromEvent(e))}
      onPointerUp={() => set(null)}
      onPointerCancel={() => set(null)}
    >
      {DIRS.map(([dx, dy]) => (
        <span key={`${dx},${dy}`} className={`ck-pad-cell ${dx === 0 && dy === 0 ? 'is-mid' : ''} ${x === dx && y === dy && (dx || dy) ? 'is-on' : ''}`}>
          {dx === 0 && dy === 0 ? '' : <i style={{ transform: `rotate(${Math.atan2(dx, dy) * (180 / Math.PI)}deg)` }} />}
        </span>
      ))}
      <span className="ck-pad-label">{label}</span>
    </div>
  )
}

export function FeetToggle({ h, game }: { h: HudState; game: Game | null }) {
  const f = h.aim.feet
  const hold = (v: 'front' | 'back' | 'auto') => game?.setTouchFeet(v)
  return (
    <div className="ck-feet2">
      {(['front', 'back'] as const).map((v) => (
        <button key={v} className={f === v ? 'is-on' : ''} onPointerDown={() => hold(v)} onPointerUp={() => hold('auto')} onPointerLeave={() => f === v && hold('auto')}>
          <kbd>{v === 'front' ? 'Shift' : 'Space'}</kbd> {v === 'front' ? 'Front foot' : 'Back foot'}
        </button>
      ))}
    </div>
  )
}
