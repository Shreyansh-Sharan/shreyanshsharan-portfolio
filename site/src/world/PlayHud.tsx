// DOM overlay for explore mode: mission log, objective compass, minimap, prompts, briefing, touch controls.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, Compass, Crosshair, Feather, Footprints, Gauge, Map as MapIcon, Swords, X, Zap } from 'lucide-react'
import { MISSIONS, type Mission } from './missions'
import { ISLAND_RADIUS, REGIONS } from './regions'
import { controls } from './controls'
import { lastCast } from './spells'
import { player } from './Characters'
import { results, startFight, wavesFor } from './combat'
import { world, useWorld } from './store'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { isLowGraphics, setLowGraphics } from '../lib/graphics'

function usePlayerTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 150)
    return () => window.clearInterval(id)
  }, [])
  return world.get().player
}

function Minimap({ target }: { target: Mission | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const p = world.get().player
  const done = useWorld((s) => s.done)
  const size = 176
  const scale = size / (ISLAND_RADIUS * 2.3)
  const toMap = (x: number, z: number) => [size / 2 + x * scale, size / 2 + z * scale]

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    c.width = size * dpr
    c.height = size * dpr
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, size, size)
    g.fillStyle = 'rgba(20, 60, 90, 0.85)'
    g.beginPath()
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#6b9a4f'
    g.beginPath()
    g.arc(size / 2, size / 2, ISLAND_RADIUS * scale, 0, Math.PI * 2)
    g.fill()
    for (const r of REGIONS) {
      const [x, y] = toMap(r.center[0], r.center[1])
      g.fillStyle = r.accent + 'cc'
      g.beginPath()
      g.arc(x, y, r.radius * scale, 0, Math.PI * 2)
      g.fill()
    }
    for (const m of MISSIONS) {
      const [x, y] = toMap(m.x, m.z)
      g.fillStyle = done.includes(m.tile.id) ? '#4ade80' : '#ffffff'
      g.beginPath()
      g.arc(x, y, m === target ? 4.5 : 3, 0, Math.PI * 2)
      g.fill()
      if (m === target) {
        g.strokeStyle = '#fbbf24'
        g.lineWidth = 2
        g.stroke()
      }
    }
    const [px, py] = toMap(p.x, p.z)
    g.save()
    g.translate(px, py)
    g.rotate(-p.heading)
    g.fillStyle = '#fbbf24'
    g.beginPath()
    g.moveTo(0, -7)
    g.lineTo(5, 6)
    g.lineTo(0, 3)
    g.lineTo(-5, 6)
    g.closePath()
    g.fill()
    g.restore()
  })

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * size, my = ((e.clientY - rect.top) / rect.height) * size
    let best: Mission | null = null
    let bestD = 14
    for (const m of MISSIONS) {
      const [x, y] = toMap(m.x, m.z)
      const d = Math.hypot(mx - x, my - y)
      if (d < bestD) {
        bestD = d
        best = m
      }
    }
    if (best) {
      play('select')
      world.set({ teleport: { x: best.x + 3, z: best.z + 4, n: (world.get().teleport?.n ?? 0) + 1 } })
    }
  }

  return <canvas ref={ref} className="minimap" style={{ width: size, height: size }} onClick={onClick} title="Click a beacon to fast travel" />
}

function Joystick() {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const id = useRef<number | null>(null)
  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    controls.stick.x = dx
    controls.stick.y = -dy
    setKnob({ x: dx, y: dy })
  }
  const end = () => {
    id.current = null
    controls.stick.x = controls.stick.y = 0
    setKnob({ x: 0, y: 0 })
  }
  return (
    <div
      ref={base}
      className="joystick"
      onPointerDown={(e) => {
        id.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        update(e)
      }}
      onPointerMove={(e) => id.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span className="joystick-knob" style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
    </div>
  )
}

function Briefing({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const done = useWorld((s) => s.done.includes(mission.tile.id))
  const t = mission.tile
  const waves = wavesFor(MISSIONS.indexOf(mission))
  const exitTo = (to: string) => {
    world.complete(t.id)
    world.set({ open: null, playing: false })
    navigate(to)
  }
  const special =
    t.id === 'arena'
      ? { label: 'Launch Dunes Arena', to: '#/arena' }
      : t.action.kind === 'route'
        ? { label: t.action.label, to: t.action.to }
        : t.action.kind === 'hub'
          ? { label: 'Open full mission file', to: `#/game/${t.id}` }
          : null
  return (
    <div className="briefing-backdrop" onClick={onClose}>
      <article className="briefing" style={{ ['--b' as string]: mission.accent }} onClick={(e) => e.stopPropagation()}>
        <button className="briefing-close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="eyebrow">
          {mission.regionName} · Mission
        </p>
        <h2 className="briefing-title">{mission.name}</h2>
        <p className="briefing-sub">
          {t.title} <span>·</span> {t.tagline} <span>·</span> {t.period}
        </p>
        <p className="briefing-blurb">{t.blurb}</p>
        {t.stats.length > 0 && (
          <div className="briefing-stats">
            {t.stats.map((s) => (
              <div key={s.label}>
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {t.activities.length > 0 && (
          <ul className="briefing-list">
            {t.activities.slice(0, 5).map((a) => (
              <li key={a.title}>
                <CircleCheck size={16} />
                <div>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="briefing-fight">
          <Swords size={15} /> Clear {waves.length === 1 ? 'a wave' : `${waves.length} waves`} of {waves.reduce((a, b) => a + b, 0)} mischief-makers around the beacon to complete it.
        </p>
        <div className="briefing-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              play('select')
              onClose()
              startFight(mission)
            }}
          >
            {done ? 'Replay mission ✓' : 'Start mission'}
          </button>
          {special && (
            <button className="btn btn-secondary" onClick={() => exitTo(special.to)}>
              {special.label}
            </button>
          )}
        </div>
      </article>
    </div>
  )
}

export function PlayHud({ onExit }: { onExit: () => void }) {
  const p = usePlayerTick()
  const near = useWorld((s) => s.near)
  const open = useWorld((s) => s.open)
  const done = useWorld((s) => s.done)
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches, [])
  // With a mouse, the first click over the world captures the pointer for looking around.
  const [locked, setLocked] = useState(() => !!document.pointerLockElement)
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement)
    document.addEventListener('pointerlockchange', on)
    return () => document.removeEventListener('pointerlockchange', on)
  }, [])
  const fightState = useWorld((s) => s.fight)
  const flying = player.flying

  // Graphics tier, switchable without leaving the world; the canvas listens for the change. The world also
  // announces when it dropped the tier itself after seeing nothing but black frames.
  const [lowGfx, setLowGfx] = useState(isLowGraphics)
  const [gfxNote, setGfxNote] = useState<string | null>(null)
  useEffect(() => {
    const on = () => setGfxNote('The picture went blank, so the world switched to lighter graphics')
    window.addEventListener('ss-gfx-auto', on)
    return () => window.removeEventListener('ss-gfx-auto', on)
  }, [])
  useEffect(() => {
    if (!gfxNote) return
    const id = window.setTimeout(() => setGfxNote(null), 4000)
    return () => window.clearTimeout(id)
  }, [gfxNote])

  // The victory banner shows for a few seconds after a mission is won.
  const won = useWorld((s) => s.cheer)
  const [seenWin, setSeenWin] = useState(won?.n ?? 0)
  const cheer = won && won.n !== seenWin ? won : null
  useEffect(() => {
    if (!won) return
    const id = window.setTimeout(() => setSeenWin(won.n), 3200)
    return () => window.clearTimeout(id)
  }, [won])

  // Show a brief toast naming the last spell cast and the animal it hit.
  const [spellToast, setSpellToast] = useState<{ n: number; label: string } | null>(null)
  useEffect(() => {
    let seen = 0
    const id = window.setInterval(() => {
      const c = lastCast()
      if (c && c.n !== seen) {
        seen = c.n
        // Zaps in a fight are too frequent for a toast.
        if (c.spell.id !== 'zap') setSpellToast({ n: c.n, label: `${c.spell.icon} ${c.spell.name}${c.target ? ` → ${c.target}` : ' (no animal nearby)'}` })
      }
    }, 120)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    if (!spellToast) return
    const id = window.setTimeout(() => setSpellToast(null), 1600)
    return () => window.clearTimeout(id)
  }, [spellToast])

  const nextMission = useMemo(() => {
    let best: Mission | null = null
    let bestD = Infinity
    for (const m of MISSIONS) {
      if (done.includes(m.tile.id)) continue
      const d = Math.hypot(m.x - p.x, m.z - p.z)
      if (d < bestD) {
        bestD = d
        best = m
      }
    }
    return best
  }, [done, p.x, p.z])

  const nearMission = MISSIONS.find((m) => m.tile.id === near) ?? null
  const openMission = MISSIONS.find((m) => m.tile.id === open) ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyE' || e.code === 'Enter') {
        const n = world.get().near
        if (n && !world.get().open) {
          play('select')
          world.set({ open: n })
        }
      }
      if (e.code === 'Escape' && world.get().open) {
        e.stopPropagation()
        world.set({ open: null })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  let arrow = 0
  let distance = 0
  if (nextMission) {
    const ang = Math.atan2(nextMission.x - p.x, nextMission.z - p.z)
    // Forward bearing is heading + π; the arrow turns clockwise towards targets on the right.
    arrow = p.heading + Math.PI - ang
    distance = Math.hypot(nextMission.x - p.x, nextMission.z - p.z)
  }

  return (
    <div className="play-hud">
      <section className="mission-log">
        <p className="eyebrow">
          <Crosshair size={13} /> Missions {done.filter((d) => MISSIONS.some((m) => m.tile.id === d)).length}/{MISSIONS.length}
        </p>
        <ul>
          {MISSIONS.map((m) => (
            <li key={m.tile.id} className={done.includes(m.tile.id) ? 'is-done' : m === nextMission ? 'is-next' : ''}>
              <span className="dot" style={{ background: done.includes(m.tile.id) ? '#4ade80' : m.accent }} />
              {m.name}
            </li>
          ))}
        </ul>
      </section>

      <div className="coin-pill" title="Coins from popped enemies and won missions">
        <span className="coin" aria-hidden="true" />
        {results.coins}
      </div>

      {fightState && (
        <div className="fight-hud" role="status">
          <span className="fight-title">
            <Swords size={15} /> {fightState.name}
          </span>
          <span className="fight-wave">
            Wave {fightState.wave}/{fightState.waves}
          </span>
          <span className="fight-bar">
            <i style={{ width: `${(1 - fightState.left / Math.max(1, fightState.total)) * 100}%` }} />
          </span>
          <span className="fight-left">{fightState.left === 0 ? 'Wave cleared!' : `${fightState.left} left`}</span>
        </div>
      )}

      {cheer && (
        <div className="mission-cheer" key={cheer.n} role="status">
          <span className="mission-cheer-stars">★ ★ ★</span>
          <strong>Mission complete!</strong>
          <span>{cheer.name}</span>
        </div>
      )}

      {!fightState && nextMission && (
        <div className="objective">
          <Compass size={16} />
          <span className="objective-arrow" style={{ transform: `rotate(${arrow}rad)` }}>
            ▲
          </span>
          <span>
            <strong>{nextMission.name}</strong> · {nextMission.regionName} · {Math.round(distance)} m
          </span>
        </div>
      )}
      {!fightState && !nextMission && <div className="objective">All missions complete. Thanks for exploring!</div>}

      {!touch && !locked && !open && <div className="look-hint">Click the world to look around with the mouse · Esc frees it</div>}

      <div className="map-wrap">
        <Minimap target={nextMission} />
        <span className="map-hint">
          <MapIcon size={12} /> Click a beacon to travel
        </span>
      </div>

      <button className="pill exit-play" onClick={onExit}>
        Exit <kbd>⌘K</kbd>
      </button>
      <button
        className={`pill gfx-play ${lowGfx ? 'is-low' : ''}`}
        title={lowGfx ? 'Low graphics is on: click for full graphics' : 'Switch to low graphics (fixes lag or a black picture)'}
        onClick={() => {
          const next = !lowGfx
          setLowGraphics(next)
          setLowGfx(next)
          window.dispatchEvent(new Event('ss-gfx'))
        }}
      >
        {lowGfx ? <Zap size={14} /> : <Gauge size={14} />} {lowGfx ? 'Low graphics' : 'Full graphics'}
      </button>
      {gfxNote && (
        <div className="spell-toast" role="status">
          {gfxNote}
        </div>
      )}

      {nearMission && !openMission && (
        <button
          className="prompt"
          onClick={() => {
            play('select')
            world.set({ open: nearMission.tile.id })
          }}
        >
          <kbd>E</kbd> {done.includes(nearMission.tile.id) ? 'Revisit' : 'Start'} mission: {nearMission.name}
        </button>
      )}

      {openMission && <Briefing mission={openMission} onClose={() => world.set({ open: null })} />}

      {touch ? (
        <>
          <Joystick />
          <div className="touch-buttons">
            <button
              className="touch-btn"
              onPointerDown={() => (controls.run = !controls.run)}
              aria-label="Toggle run"
            >
              <Footprints size={20} />
            </button>
            <button className="touch-btn" onPointerDown={() => (controls.jump = true)} aria-label="Jump">
              ⤒
            </button>
            <button className="touch-btn" onPointerDown={() => (controls.fly = true)} aria-label="Fly or land">
              <Feather size={20} />
            </button>
            {flying && (
              <button
                className="touch-btn"
                onPointerDown={() => (controls.down = true)}
                onPointerUp={() => (controls.down = false)}
                onPointerCancel={() => (controls.down = false)}
                aria-label="Fly down"
              >
                ⤓
              </button>
            )}
            <button className="touch-btn touch-btn-strong" onPointerDown={() => (controls.attack = true)} aria-label="Attack">
              <Swords size={20} />
            </button>
            <button className="touch-btn" onPointerDown={() => (controls.cast = true)} aria-label="Zap or cast a spell">
              <Zap size={20} />
            </button>
          </div>
        </>
      ) : (
        <p className="play-help">
          <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump, double-tap to fly ({flying ? <><kbd>Space</kbd>/<kbd>C</kbd> up/down</> : <><kbd>X</kbd> too</>}) · click / <kbd>J</kbd> attack · <kbd>Q</kbd> spin · <kbd>F</kbd> zap / spell · <kbd>E</kbd> interact · <kbd>⌘K</kbd> exit
        </p>
      )}

      {spellToast && (
        <div className="spell-toast" role="status" key={spellToast.n}>
          {spellToast.label}
        </div>
      )}
    </div>
  )
}
