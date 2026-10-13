// The field editor: the ground from above (the striker's end at the top), the nine fielders as discs you drag to
// any spot, the named positions to snap to, the 30-yard circle, and the fielding restrictions checked live (how many
// outside the circle in this phase, two behind square on the leg side, five on the leg side). Presets load a field to
// start from; Apply sends it to the match.
import { useMemo, useRef, useState } from 'react'
import type { Game } from '../game'
import { checkField, enforce, presetSpots, PRESET_BLURB, PRESET_NAMES, PRESET_ORDER, SPOTS, spotName, spotToWorld, type FieldPreset, type FieldSpot } from '../sim/fields'
import { beyondRope, Geo, inward } from '../sim/geo'
import { isSpinStyle } from '../sim/delivery'
import { V3 } from '../sim/vec'

interface Props {
  game: Game
  onClose: () => void
}

export function FieldEditor({ game, onClose }: Props) {
  const d = game.director
  const inn = d.state.current
  const frame = d.frame
  const dz = inward(1 - inn.strikerEnd)
  const bowler = d.fieldingTeam.players[inn.bowler]
  const spin = isSpinStyle(bowler.bowl)
  const maxOut = d.maxOutside
  const [spots, setSpots] = useState<FieldSpot[]>(() => d.field.map((s) => ({ ...s })))
  const [preset, setPreset] = useState<FieldPreset>(d.preset)
  const [drag, setDrag] = useState(-1)
  const svg = useRef<SVGSVGElement>(null)
  const check = checkField(spots, maxOut)

  const toSvg = (s: FieldSpot) => {
    const p = spotToWorld(s, frame)
    return [p.x * dz, -p.z * dz]
  }
  const fromSvg = (sx: number, sy: number) => {
    let p = new V3(sx * dz, 0, -sy * dz)
    const beyond = beyondRope(p, 3)
    if (beyond > 0) p = p.sub(p.norm().mul(beyond))
    let angle = frame.angleOf(p)
    let dist = Math.max(4, p.flatDist(frame.origin))
    // Snap to a named position close by.
    let best: FieldSpot | null = null
    let bestD = 4.5
    for (const x of Object.values(SPOTS)) {
      const q = spotToWorld(x, frame)
      const dd = q.flatDist(p)
      if (dd < bestD) {
        bestD = dd
        best = x
      }
    }
    if (best) {
      angle = best.angle
      dist = best.dist
    }
    return { name: best ? best.name : spotName(angle, dist), angle, dist }
  }
  const named = useMemo(() => Object.values(SPOTS).map((x) => ({ x, p: toSvg(x) })), [frame, dz]) // eslint-disable-line react-hooks/exhaustive-deps

  const pointer = (e: React.PointerEvent) => {
    if (drag < 0 || !svg.current) return
    const pt = svg.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.current.getScreenCTM()
    if (!m) return
    const q = pt.matrixTransform(m.inverse())
    const s = fromSvg(q.x, q.y)
    setSpots((list) => list.map((x, i) => (i === drag ? s : x)))
    setPreset('custom')
  }

  const loadPreset = (p: FieldPreset) => {
    setPreset(p)
    setSpots(enforce(presetSpots(p, spin), maxOut))
  }

  const apply = () => {
    if (!check.ok) return
    const side = game.opts.localSide
    if (preset !== 'custom') game.submit({ t: 'preset', side, preset })
    else game.submit({ t: 'field', side, spots: spots.map((s) => [s.angle, s.dist]) })
    onClose()
  }

  const ring = Geo.InnerCircle
  const sz = -dz * frame.origin.z * 1 // striker's stumps (top)
  return (
    <div className="ck-overlay ck-fe-wrap" onPointerUp={() => setDrag(-1)}>
      <div className="ck-panel ck-fe" role="dialog" aria-label="Set the field">
        <div className="ck-fe-head">
          <div>
            <p className="ck-howto-eyebrow">Field placings · {bowler.name}</p>
            <h3>Set your field</h3>
          </div>
          <div className={`ck-fe-rules ${check.ok ? 'is-ok' : 'is-bad'}`}>
            <span>
              Outside the circle <b>{check.outside}</b> / {maxOut}
              {d.state.isPowerplay ? ' (powerplay)' : ''}
            </span>
            <span>
              Behind square, leg side <b>{check.behindSquareLeg}</b> / 2
            </span>
            <span>
              Leg side <b>{check.legSide}</b> / 5
            </span>
          </div>
        </div>
        <div className="ck-fe-body">
          <svg ref={svg} className="ck-fe-svg" viewBox="-72 -76 144 152" onPointerMove={pointer} style={{ touchAction: 'none' }}>
            <ellipse cx="0" cy="0" rx={Geo.BoundarySquare} ry={Geo.BoundaryStraight} className="ck-fe-ground" />
            <path d={`M ${-ring} ${-Geo.HalfPitch} A ${ring} ${ring} 0 0 1 ${ring} ${-Geo.HalfPitch} L ${ring} ${Geo.HalfPitch} A ${ring} ${ring} 0 0 1 ${-ring} ${Geo.HalfPitch} Z`} className={`ck-fe-ring ${check.outside > maxOut ? 'is-bad' : ''}`} />
            <rect x={-1.6} y={-Geo.HalfPitch - 1.3} width={3.2} height={Geo.PitchLength + 2.6} className="ck-fe-pitch" />
            {named.map(({ x, p }) => (
              <g key={x.name} className="ck-fe-named">
                <circle cx={p[0]} cy={p[1]} r={0.9} />
                <text x={p[0]} y={p[1] + 3.6}>
                  {x.name}
                </text>
              </g>
            ))}
            {[d.keeperActor, d.bowlerActor].map((a, i) =>
              a ? (
                <g key={i} className="ck-fe-fixed">
                  <circle cx={a.pos.x * dz} cy={-a.pos.z * dz} r={2.8} />
                  <text x={a.pos.x * dz} y={-a.pos.z * dz + 1.1}>
                    {i === 0 ? 'WK' : 'B'}
                  </text>
                </g>
              ) : null,
            )}
            <circle cx={0} cy={sz} r={1.6} className="ck-fe-striker" />
            <text x={0} y={sz - 3} className="ck-fe-label-strong">
              STRIKER
            </text>
            {spots.map((s, i) => {
              const [x, y] = toSvg(s)
              const out = s.dist > Geo.InnerCircle + 2
              return (
                <g
                  key={i}
                  className={`ck-fe-man ${drag === i ? 'is-drag' : ''} ${out ? 'is-out' : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
                    setDrag(i)
                  }}
                  onPointerUp={() => setDrag(-1)}
                >
                  <circle cx={x} cy={y} r={3.4} />
                  <text x={x} y={y + 1.3}>
                    {i + 1}
                  </text>
                  <text x={x} y={y - 4.8} className="ck-fe-name">
                    {s.name}
                  </text>
                </g>
              )
            })}
          </svg>
          <div className="ck-fe-side">
            <div className="ck-fe-presets">
              {PRESET_ORDER.map((p) => (
                <button key={p} className={`ck-fe-preset ${preset === p ? 'is-on' : ''}`} onClick={() => loadPreset(p)}>
                  <b>{PRESET_NAMES[p]}</b>
                  <span>{PRESET_BLURB[p]}</span>
                </button>
              ))}
              {preset === 'custom' && (
                <div className="ck-fe-preset is-on">
                  <b>Custom</b>
                  <span>Drag a fielder; he snaps to the nearest named position</span>
                </div>
              )}
            </div>
            {!check.ok && (
              <ul className="ck-fe-problems">
                {check.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <div className="ck-row">
              <button className="btn btn-primary" disabled={!check.ok} onClick={apply}>
                Apply field
              </button>
              <button className="btn" onClick={onClose}>
                Cancel <kbd>Esc</kbd>
              </button>
            </div>
            <p className="muted small">Fielding restrictions: in the powerplay only two may be outside the 30-yard circle, five after it.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
