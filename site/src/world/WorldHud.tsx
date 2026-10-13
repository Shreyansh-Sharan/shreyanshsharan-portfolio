// The creature and mini-game overlays of the explore HUD: health bar and damage vignette, the knock-out card, the
// capture reticle, the party strip, the pals / bestiary panel (the Palbox at the harbour beacon), the mini-game
// timer, end card and treasure map, photo mode's frame, and the notice toasts. PlayHud.tsx mounts them.
import { useEffect, useRef, useState } from 'react'
import { BookOpen, Camera, Heart, Timer, Trophy, X } from 'lucide-react'
import { REGIONS } from './regions'
import { player } from './Characters'
import { controls } from './controls'
import { aimedCreature, bestiary, captureChance, nearPalbox, renamePal, ride, roster, setActive, SPECIES, SPECIES_LIST, xpToNext, type Pal } from './creatures'
import { closeMinigame, game, GAME_PROMPT_DISTANCE, GAMES, photo, pressKey, type GameDef } from './minigames'
import { world, useWorld } from './store'
import { play } from '../lib/sound'

const fmt = (t: number) => {
  const m = Math.floor(t / 60), s = t - m * 60
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)} s`
}

/* ---------- Health ---------- */

export function Vitals() {
  const f = player.hp / player.maxHp
  const low = f < 0.3
  return (
    <div className={`vitals ${low ? 'is-low' : ''} ${player.hurt > 0 ? 'is-hurt' : ''}`} role="status" aria-label={`Health ${Math.round(player.hp)} of ${player.maxHp}`}>
      <Heart size={14} />
      <span className="vitals-bar">
        <i style={{ width: `${f * 100}%` }} />
      </span>
      <span className="vitals-num">{Math.round(player.hp)}</span>
    </div>
  )
}

export function HurtVignette() {
  const f = player.hp / player.maxHp
  const a = Math.min(1, player.hurt * 1.6 + (f < 0.3 ? (0.3 - f) * 1.4 : 0))
  if (a <= 0.02) return null
  return <div className="hurt-vignette" style={{ opacity: a }} />
}

export function KnockedOut() {
  const ko = useWorld((s) => s.ko)
  const [show, setShow] = useState(0)
  useEffect(() => {
    if (!ko) return
    setShow(ko)
    const id = window.setTimeout(() => setShow(0), 2600)
    return () => window.clearTimeout(id)
  }, [ko])
  if (!show) return null
  return (
    <div className="ko-overlay" key={show}>
      <strong>You were knocked out</strong>
      <span>Waking up at the last beacon · coins kept</span>
    </div>
  )
}

/* ---------- Capture reticle ---------- */

export function Reticle() {
  const c = aimedCreature(player)
  if (!c || photo.active) return null
  const f = c.hp / c.maxHp
  const chance = Math.round(captureChance(c) * 100)
  return (
    <div className="reticle" style={{ ['--c' as string]: c.spec.color }}>
      <span className="reticle-ring" />
      <div className="reticle-card">
        <strong>
          {c.alpha ? 'Alpha ' : ''}
          {c.spec.name}
        </strong>
        <span className="reticle-bar">
          <i style={{ width: `${f * 100}%`, background: f > 0.5 ? '#4ade80' : f > 0.25 ? '#fbbf24' : '#f43f5e' }} />
        </span>
        <span className="reticle-capture">
          <kbd>G</kbd> Spark Sphere · {chance}%
        </span>
      </div>
    </div>
  )
}

/* ---------- Party strip ---------- */

const ICON: Record<string, string> = { thornback: '🐗', grizzlebear: '🐻', scrapdrone: '🛸', snapcrab: '🦀', gargoyle: '🦇' }

export function PartyStrip({ touch }: { touch: boolean }) {
  useWorld((s) => s.palsN)
  const active = roster.active.map((id) => roster.pals.find((p) => p.id === id)!).filter(Boolean)
  const mount = ride.pal
  return (
    <div className="party">
      <Vitals />
      {active.length > 0 && (
        <div className="pal-strip">
          {active.map((pal) => {
            const s = SPECIES[pal.species]
            const riding = mount && roster.pals[mount.tame] === pal
            return (
              <div key={pal.id} className={`pal-card ${riding ? 'is-riding' : ''} ${pal.rest > 0 ? 'is-resting' : ''}`} style={{ ['--c' as string]: s.color }}>
                <span className="pal-icon">{ICON[pal.species]}</span>
                <span className="pal-name">
                  {pal.name} <em>Lv {pal.level}</em>
                </span>
                <span className="pal-sub">{pal.rest > 0 ? `resting ${Math.ceil(pal.rest)} s` : riding ? 'riding' : s.ride ? (touch ? 'tap to ride' : 'R to ride') : s.name}</span>
                {touch && s.ride && pal.rest <= 0 && <button className="pal-ride" onPointerDown={() => (controls.ride = true)} aria-label="Ride" />}
              </div>
            )
          })}
        </div>
      )}
      <button className="pill party-open" onClick={() => world.set({ panel: 'pals' })} title="Pals and bestiary (B)">
        <BookOpen size={13} /> Pals {roster.pals.length} · <Trophy size={13} /> {roster.trophies}
      </button>
    </div>
  )
}

/* ---------- Pals & bestiary panel ---------- */

function PalRow({ pal, box }: { pal: Pal; box: boolean }) {
  const s = SPECIES[pal.species]
  const on = roster.active.includes(pal.id)
  const full = roster.active.length >= 3
  const [name, setName] = useState(pal.name)
  return (
    <li className="pal-row" style={{ ['--c' as string]: s.color }}>
      <span className="pal-icon">{ICON[pal.species]}</span>
      <div className="pal-row-main">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => renamePal(pal.id, name)} maxLength={16} aria-label="Pal name" />
        <span className="pal-row-sub">
          {s.name} · Lv {pal.level} · {s.ride ? (s.ride === 'fly' ? 'flying mount' : 'fast mount') : 'fighter'}
        </span>
        <span className="xp-bar">
          <i style={{ width: `${(pal.xp / xpToNext(pal.level)) * 100}%` }} />
        </span>
      </div>
      <button className={`btn ${on ? 'btn-secondary' : 'btn-primary'}`} disabled={!box || (!on && full)} title={box ? '' : 'Swap pals at the harbour beacon (the Palbox)'} onClick={() => setActive(pal.id, !on)}>
        {on ? 'In party' : full ? 'Party full' : 'Add'}
      </button>
    </li>
  )
}

export function PalsPanel({ onClose }: { onClose: () => void }) {
  useWorld((s) => s.palsN)
  const [tab, setTab] = useState<'party' | 'bestiary'>('party')
  const box = nearPalbox(player)
  return (
    <div className="briefing-backdrop" onClick={onClose}>
      <article className="briefing pals-panel" onClick={(e) => e.stopPropagation()}>
        <button className="briefing-close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="eyebrow">
          Pals · {roster.pals.length} caught · <Trophy size={12} /> {roster.trophies} trophies
        </p>
        <div className="pals-tabs">
          <button className={tab === 'party' ? 'is-on' : ''} onClick={() => setTab('party')}>
            Party & Palbox
          </button>
          <button className={tab === 'bestiary' ? 'is-on' : ''} onClick={() => setTab('bestiary')}>
            Bestiary
          </button>
        </div>
        {tab === 'party' ? (
          <>
            <p className="briefing-sub">
              Up to three pals follow you, fight beside you and gain levels. {box ? 'You are at the Palbox: swap who comes along.' : 'Walk to the harbour beacon (Basecamp) to swap pals in and out of the Palbox.'}
            </p>
            {roster.pals.length === 0 ? (
              <p className="pals-empty">
                No pals yet. Weaken a wild creature, aim at it and press <kbd>G</kbd> to throw a Spark Sphere. The lower its health, the better the odds.
              </p>
            ) : (
              <ul className="pal-list">
                {roster.pals.map((pal) => (
                  <PalRow key={pal.id} pal={pal} box={box} />
                ))}
              </ul>
            )}
          </>
        ) : (
          <ul className="bestiary">
            {SPECIES_LIST.map((s) => {
              const seen = bestiary.seen.includes(s.id)
              return (
                <li key={s.id} className={seen ? '' : 'is-unknown'} style={{ ['--c' as string]: s.color }}>
                  <span className="pal-icon">{seen ? ICON[s.id] : '?'}</span>
                  <div>
                    <strong>{seen ? s.name : '???'}</strong>
                    <span className="bestiary-habitat">{s.habitat}</span>
                    {seen && <p>{s.blurb}</p>}
                    <span className="bestiary-badges">
                      <b className={seen ? 'is-on' : ''}>Seen</b>
                      <b className={bestiary.caught.includes(s.id) ? 'is-on' : ''}>Caught</b>
                      <b className={bestiary.alphas.includes(s.id) ? 'is-on' : ''}>Alpha defeated</b>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </article>
    </div>
  )
}

/* ---------- Mini-games ---------- */

/** The nearest mini-game start within reach, if nothing else is going on. */
export function nearGame(x: number, z: number): GameDef | null {
  let best: GameDef | null = null
  let bestD = GAME_PROMPT_DISTANCE
  for (const g of GAMES()) {
    const d = Math.hypot(g.x - x, g.z - z)
    if (d < bestD) {
      bestD = d
      best = g
    }
  }
  return best
}

export function GameHud({ below }: { below: boolean }) {
  const hud = useWorld((s) => s.minigame)
  if (!hud) return null
  if (hud.result) {
    const r = hud.result
    return (
      <div className="briefing-backdrop" onClick={closeMinigame}>
        <article className={`briefing game-card ${r.won ? 'is-won' : 'is-lost'}`} onClick={(e) => e.stopPropagation()}>
          <p className="eyebrow">{hud.name}</p>
          <h2 className="briefing-title">{r.won ? 'Complete!' : 'Not this time'}</h2>
          {r.note && <p className="briefing-sub">{r.note}</p>}
          <div className="briefing-stats">
            <div>
              <strong>{fmt(r.time)}</strong>
              <span>Time</span>
            </div>
            <div>
              <strong>{r.won ? `+${r.coins}` : '0'}</strong>
              <span>Coins</span>
            </div>
            <div>
              <strong>{r.best !== null ? fmt(r.best) : '—'}</strong>
              <span>Best</span>
            </div>
            {r.trophy && (
              <div>
                <strong>🏆</strong>
                <span>Trophy</span>
              </div>
            )}
          </div>
          <div className="briefing-actions">
            <button className="btn btn-primary" onClick={closeMinigame}>
              Close <kbd>E</kbd>
            </button>
          </div>
        </article>
      </div>
    )
  }
  return (
    <div className={`fight-hud game-hud ${below ? 'is-below' : ''}`} role="status">
      <span className="fight-title">
        <Timer size={15} /> {hud.name}
      </span>
      <span className="fight-wave">{fmt(hud.t)}</span>
      {hud.meter !== null && (
        <span className={`fight-bar game-meter ${hud.id === 'fishing' && hud.hint.startsWith('Space') ? 'is-cast' : ''}`}>
          <i style={{ width: `${hud.meter * 100}%` }} />
        </span>
      )}
      <span className="fight-left">
        <strong>{hud.progress}</strong> · {hud.hint}
      </span>
      <button className="game-quit" onClick={closeMinigame} title="Give up">
        <X size={14} />
      </button>
    </div>
  )
}

export function GameTip({ def }: { def: GameDef }) {
  const bests = useWorld((s) => s.done)
  const done = bests.includes(`game:${def.id}`)
  return (
    <div className="game-tip">
      <strong>
        {def.icon} {def.name}
        {done ? ' ✓' : ''}
      </strong>
      <p>{def.blurb}</p>
      <span>{def.controls}</span>
    </div>
  )
}

/** Touch buttons for the fishing game (keys otherwise). */
export function FishingTouch() {
  const hud = useWorld((s) => s.minigame)
  if (!hud || hud.id !== 'fishing' || hud.result) return null
  return (
    <div className="fish-touch">
      <button className="touch-btn" onPointerDown={() => pressKey('KeyA')} aria-label="Reel left">
        ◀
      </button>
      <button className="touch-btn touch-btn-strong" onPointerDown={() => pressKey('Space')} aria-label="Cast or hook">
        🎣
      </button>
      <button className="touch-btn" onPointerDown={() => pressKey('KeyD')} aria-label="Reel right">
        ▶
      </button>
    </div>
  )
}

/** The treasure hunt's map scrap: the grove, the clock tower, you, and the X (vaguer with each tier). */
export function TreasureMap() {
  const ref = useRef<HTMLCanvasElement>(null)
  const hud = useWorld((s) => s.minigame)
  const p = world.get().player
  useEffect(() => {
    const g = game
    const c = ref.current
    if (!c || !g || g.id !== 'treasure') return
    const ctx = c.getContext('2d')!
    const size = 150
    const dpr = window.devicePixelRatio || 1
    c.width = c.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const r = REGIONS.find((x) => x.id === 'campus')!
    const scale = size / 100
    const toMap = (x: number, z: number) => [size / 2 + (x - r.center[0]) * scale, size / 2 + (z - r.center[1]) * scale]
    ctx.fillStyle = '#e9d8b0'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = '#8a6a44'
    ctx.lineWidth = 2
    ctx.strokeRect(3, 3, size - 6, size - 6)
    ctx.fillStyle = '#b7c98a'
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, r.radius * scale, 0, Math.PI * 2)
    ctx.fill()
    // The clock tower.
    ctx.fillStyle = '#5b4632'
    ctx.fillRect(size / 2 - 4, size / 2 - 9, 8, 18)
    // The X, or a search circle on the hardest map.
    const [sx, sz] = toMap(g.shown.x, g.shown.z)
    ctx.strokeStyle = '#b91c1c'
    ctx.lineWidth = 3
    if (g.tier === 2) {
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(sx, sz, 12 * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.beginPath()
      ctx.moveTo(sx - 6, sz - 6)
      ctx.lineTo(sx + 6, sz + 6)
      ctx.moveTo(sx + 6, sz - 6)
      ctx.lineTo(sx - 6, sz + 6)
      ctx.stroke()
    }
    const [px, pz] = toMap(p.x, p.z)
    ctx.fillStyle = '#1d4ed8'
    ctx.beginPath()
    ctx.arc(px, pz, 4, 0, Math.PI * 2)
    ctx.fill()
  })
  if (!hud || hud.id !== 'treasure' || hud.result) return null
  return <canvas ref={ref} className="treasure-map" style={{ width: 150, height: 150 }} title="Map scrap" />
}

/* ---------- Photo mode ---------- */

export function PhotoFrame({ touch }: { touch: boolean }) {
  const on = useWorld((s) => s.photo)
  if (!on) return null
  return (
    <div className="photo-frame">
      <span className="photo-corner tl" />
      <span className="photo-corner tr" />
      <span className="photo-corner bl" />
      <span className="photo-corner br" />
      <div className="photo-bar">
        <Camera size={15} /> Photo mode · {touch ? 'drag to orbit · tap to snap' : <>drag to orbit · <kbd>W</kbd>/<kbd>S</kbd> zoom · <kbd>Space</kbd> or click snaps · <kbd>P</kbd> exit</>} · album {photo.album.length} species
      </div>
      {touch && (
        <div className="photo-touch">
          <button className="touch-btn touch-btn-strong" onPointerDown={() => (controls.attack = true)} aria-label="Snap">
            <Camera size={20} />
          </button>
          <button className="touch-btn" onPointerDown={() => (controls.photo = true)} aria-label="Exit photo mode">
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------- Toasts ---------- */

export function Toasts() {
  const toast = useWorld((s) => s.toast)
  const [shown, setShown] = useState<{ n: number; text: string }[]>([])
  useEffect(() => {
    if (!toast) return
    setShown((list) => [...list.slice(-2), toast])
    const id = window.setTimeout(() => setShown((list) => list.filter((t) => t.n !== toast.n)), 2600)
    return () => window.clearTimeout(id)
  }, [toast])
  if (!shown.length) return null
  return (
    <div className="world-toasts">
      {shown.map((t) => (
        <div key={t.n} className="world-toast" role="status">
          {t.text}
        </div>
      ))}
    </div>
  )
}

/** Keys the overlays handle (capturing, before the game): returns true when consumed. */
export function hudKey(e: KeyboardEvent): boolean {
  const s = world.get()
  if (e.code === 'KeyB' && !s.open) {
    world.set({ panel: s.panel === 'pals' ? 'none' : 'pals' })
    play('select')
    return true
  }
  if (e.code === 'Escape' && s.panel !== 'none') {
    world.set({ panel: 'none' })
    return true
  }
  if (s.minigame?.result && (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Escape')) {
    closeMinigame()
    return true
  }
  if (s.minigame && !s.minigame.result && pressKey(e.code)) return true
  return false
}
