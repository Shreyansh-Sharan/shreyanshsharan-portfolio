// The in-match overlay: score and clock, the valuables tracker, team portraits, your health / stamina / ultimate,
// gadget slots, crosshair and context hints, the kill feed, prep-phase briefing, KO / blind / wet effects, the
// online lobby, results with rewards (and an ad break between matches), and the touch controls.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Crown, DoorOpen, Play, Shield, Users, Zap } from 'lucide-react'
import { adBreak } from '../lib/ads'
import { HEROES } from './engine/heroes'
import { MAPS, MAP_IDS, type MapId, type TimeOfDay } from './engine/maps'
import { MODE_INFO, type ModeId } from './engine/sim'
import { THROWABLES, TRAPS } from './engine/gear'
import type { Game, Hud } from './engine/game'
import type { Profile } from './engine/progress'
import { portrait } from './portraits'

const TEAM = ['#ffd93b', '#5ee0a3']

export function LawnHud({ hud, game, profile, onQuit }: { hud: Hud; game: Game; profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; onQuit: () => void }) {
  const me = hud.me
  const hero = HEROES[me.hero]
  const playing = hud.phase === 'play' || hud.phase === 'prep'
  const mm = Math.floor(hud.left / 60)
  const ss = Math.floor(hud.left % 60)
  const mine = hud.myTeam
  const theirs = 1 - mine
  return (
    <div className={`lw-hud ${hud.touch ? 'is-touch' : ''} ${me.blind ? 'is-blind' : ''} ${me.wet ? 'is-wet' : ''}`} style={{ ['--lw-flash' as string]: hud.flash }}>
      <div className="lw-flash" />
      {hud.phase === 'lobby' && <Lobby hud={hud} game={game} profile={profile} onQuit={onQuit} />}
      {playing && (
        <>
          <div className="lw-top">
            <button className="lw-quit" onClick={onQuit} aria-label="Leave the match">
              <DoorOpen size={16} />
            </button>
            <div className="lw-score">
              {hud.mode === 'robots' ? (
                <>
                  <span className="lw-team" style={{ ['--lw-team' as string]: TEAM[0] }}>
                    <Shield size={14} /> {hud.valuables[0]} left
                  </span>
                  <span className="lw-clock">
                    {hud.phase === 'prep' ? 'PREP ' : `WAVE ${hud.wave} `}
                    {mm}:{ss.toString().padStart(2, '0')}
                  </span>
                  <span className="lw-team" style={{ ['--lw-team' as string]: '#ff6a6a' }}>
                    {hud.waveLeft} robots
                  </span>
                </>
              ) : (
                <>
                  <span className={`lw-team ${mine === 0 ? 'is-mine' : ''}`} style={{ ['--lw-team' as string]: TEAM[0] }}>
                    {hud.score[0]}
                  </span>
                  <span className="lw-clock">
                    {hud.phase === 'prep' ? 'PREP ' : ''}
                    {mm}:{ss.toString().padStart(2, '0')}
                  </span>
                  <span className={`lw-team ${mine === 1 ? 'is-mine' : ''}`} style={{ ['--lw-team' as string]: TEAM[1] }}>
                    {hud.score[1]}
                  </span>
                </>
              )}
            </div>
            <div className="lw-modetag">
              {MODE_INFO[hud.mode].name} · {MAPS[hud.map].name}
              {hud.tod === 'night' ? ' · night' : ''}
            </div>
          </div>
          {hud.mode !== 'brawl' && (
            <div className="lw-valuables" data-testid="lw-valuables">
              <span style={{ color: TEAM[mine] }}>
                Ours {valuableDots(hud.valuables[mine])}
              </span>
              {hud.mode === 'destruction' && (
                <span style={{ color: TEAM[theirs] }}>
                  Theirs {valuableDots(hud.valuables[theirs])}
                </span>
              )}
            </div>
          )}
          <ul className="lw-feed">
            {hud.feed.map((f) => (
              <li key={f.key} style={{ color: f.team >= 0 ? TEAM[f.team] : '#fff' }}>
                {f.text}
              </li>
            ))}
          </ul>
          <div className="lw-teamlist">
            {hud.team.map((t) => (
              <div key={t.id} className={`lw-mate ${t.me ? 'is-me' : ''} ${t.alive ? '' : 'is-down'}`}>
                <img src={portrait(t.hero)} alt="" />
                <div>
                  <span>{t.name}</span>
                  <i>
                    <b style={{ width: `${Math.max(0, (t.hp / t.maxHp) * 100)}%` }} />
                  </i>
                </div>
              </div>
            ))}
          </div>
          {hud.phase === 'prep' && (
            <div className="lw-prep" data-testid="lw-prep">
              <strong>PREP PHASE · {Math.ceil(hud.prepLeft)}s</strong>
              <span>
                <kbd>E</kbd> barricade doors, place traps ({me.traps.map((t, i) => `${i + 1}: ${TRAPS[t].name}`).join(' · ')}) and move valuables · <kbd>F</kbd> ladder
              </span>
            </div>
          )}
          {!me.alive && (
            <div className="lw-ko" data-testid="lw-ko">
              <strong>KNOCKED OUT</strong>
              <span>Back on the lawn in {Math.ceil(me.respawnIn)}…</span>
            </div>
          )}
          {hud.chaos && <div className="lw-chaos">{hud.chaos === 'seagulls' ? 'SEAGULLS' : hud.chaos === 'icecream' ? 'ICE-CREAM TRUCK' : 'RAINSTORM'}</div>}
          <div className={`lw-cross ${me.charge > 0.05 ? 'is-charging' : ''}`} style={{ ['--lw-charge' as string]: me.charge }}>
            <i />
          </div>
          {hud.hint && <div className="lw-hint">{hud.hint}</div>}
          <div className="lw-me">
            <div className="lw-mehero" style={{ ['--lw-accent' as string]: hero.colors[0] }}>
              <img src={portrait(me.hero)} alt="" />
              <span>{hero.name.split(' ')[0]}</span>
            </div>
            <div className="lw-bars">
              <div className="lw-hp">
                <i style={{ width: `${Math.max(0, (me.hp / me.maxHp) * 100)}%` }} />
                <span>
                  {Math.max(0, Math.round(me.hp))} / {me.maxHp}
                </span>
              </div>
              <div className="lw-stam">
                <i style={{ width: `${Math.max(0, me.stamina)}%` }} />
              </div>
              <button
                className={`lw-ultbtn ${me.ult >= 1 ? 'is-ready' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault()
                  game.input.touchButton('ult', true)
                }}
                onPointerUp={() => game.input.touchButton('ult', false)}
                onPointerLeave={() => game.input.touchButton('ult', false)}
                aria-label="Ultimate"
                data-testid="lw-ult"
              >
                <Zap size={14} />
                <i style={{ width: `${Math.min(100, me.ult * 100)}%` }} />
                <span>{me.ult >= 1 ? `${hero.ultName} · Q` : `${Math.round(me.ult * 100)}%`}</span>
              </button>
            </div>
          </div>
          <div className="lw-gadgets" data-testid="lw-gadgets">
            <div className="lw-gadget lw-gadget-throw" title={THROWABLES[me.throwKind].name}>
              <span>G</span>
              <strong>{THROWABLES[me.throwKind].name}</strong>
              <em>×{me.throwAmmo}</em>
            </div>
            {me.traps.map((t, i) => (
              <button
                key={t}
                className={`lw-gadget ${me.slot === i ? 'is-on' : ''}`}
                onClick={() => game.input.setSlot(i)}
                title={TRAPS[t].blurb}
              >
                <span>{i + 1}</span>
                <strong>{TRAPS[t].name}</strong>
                <em>×{me.trapAmmo[i] ?? 0}</em>
              </button>
            ))}
            <div className="lw-gadget">
              <span>F</span>
              <strong>Ladder</strong>
              <em>×{me.ladders}</em>
            </div>
            {me.tool && (
              <div className="lw-gadget is-tool">
                <span>Tool</span>
                <strong>{me.tool}</strong>
              </div>
            )}
          </div>
          {!hud.touch && !hud.locked && !hud.pad && (
            <div className="lw-lockprompt" data-testid="lw-lock">
              <strong>Click to grab the mouse</strong>
              <span>WASD move · mouse look · LMB swing (hold for heavy) · RMB block · E use · F ladder · Q ultimate</span>
            </div>
          )}
          {hud.touch && <TouchControls game={game} />}
        </>
      )}
      {hud.phase === 'over' && hud.results && <ResultsPanel hud={hud} game={game} onQuit={onQuit} />}
    </div>
  )
}

function valuableDots(n: number) {
  return '◆'.repeat(Math.max(0, n)) + '◇'.repeat(Math.max(0, 8 - n))
}

/* ---------- Lobby ---------- */

function Lobby({ hud, game, profile, onQuit }: { hud: Hud; game: Game; profile: Profile; onQuit: () => void }) {
  const host = hud.role === 'host'
  const link = `${window.location.origin}${window.location.pathname}#/lawn?join=${hud.code}`
  const [copied, setCopied] = useState(false)
  return (
    <div className="lw-lobby" data-testid="lw-lobby">
      <div className="lw-lobbycard">
        <h2>Street {hud.code}</h2>
        <p className="muted small">Share the code or the link. {host ? 'You are the host: pick the mode and street, then start.' : 'The host picks the mode and starts the match.'}</p>
        <div className="lw-online">
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
          <button className="btn" onClick={onQuit}>
            Leave
          </button>
        </div>
        <ul className="lw-players">
          {hud.players.map((pl) => (
            <li key={pl.peer} style={{ ['--lw-team' as string]: TEAM[pl.team] }}>
              <img src={portrait(pl.hero)} alt="" />
              <span>
                {pl.name} · {HEROES[pl.hero].name.split(' ')[0]}
              </span>
              <em>{pl.peer === 'host' ? 'host' : ''}</em>
            </li>
          ))}
        </ul>
        {host ? (
          <>
            <div className="lw-modes lw-modes-lobby">
              {(Object.keys(MODE_INFO) as ModeId[]).map((m) => (
                <button key={m} className={`lw-modecard ${hud.settings.mode === m ? 'is-on' : ''}`} onClick={() => game.setSettings({ mode: m })}>
                  <strong>{MODE_INFO[m].name}</strong>
                </button>
              ))}
            </div>
            <div className="lw-maps lw-maps-lobby">
              {MAP_IDS.map((id: MapId) => (
                <button key={id} className={`lw-mapcard ${hud.settings.map === id ? 'is-on' : ''}`} onClick={() => game.setSettings({ map: id })}>
                  <strong>{MAPS[id].name}</strong>
                </button>
              ))}
              {(['day', 'night'] as TimeOfDay[]).map((t) => (
                <button key={t} className={`lw-mapcard ${hud.settings.time === t ? 'is-on' : ''}`} onClick={() => game.setSettings({ time: t })}>
                  <strong>{t === 'day' ? 'Day' : 'Night'}</strong>
                </button>
              ))}
            </div>
            <button className="btn btn-primary arena-start" onClick={() => game.startOnline()} data-testid="lw-start">
              <Play size={18} /> Start the match
            </button>
          </>
        ) : (
          <p className="muted">
            <Users size={14} /> {MODE_INFO[hud.settings.mode].name} on {MAPS[hud.settings.map].name} · waiting for {profile.name === 'PLAYER' ? 'the host' : 'the host'}…
          </p>
        )}
      </div>
    </div>
  )
}

/* ---------- Results ---------- */

function ResultsPanel({ hud, game, onQuit }: { hud: Hud; game: Game; onQuit: () => void }) {
  const r = hud.results!
  const [busy, setBusy] = useState(false)
  const again = () => {
    setBusy(true)
    adBreak('lawn-between-matches', {
      pause: () => game.pause(true),
      resume: () => game.pause(false),
      done: () => {
        setBusy(false)
        if (hud.role === 'solo') onQuit()
        else game.backToLobby()
      },
    })
  }
  const title = r.mode === 'robots' ? (r.win ? `HOUSE DEFENDED · ${r.waves} waves` : `OVERRUN · wave ${r.waves + 1}`) : r.winner < 0 ? 'DRAW' : r.win ? 'YOUR STREET' : 'THEIR STREET'
  return (
    <div className="lw-results" data-testid="lw-results">
      <div className="lw-resultcard">
        <h2 className={r.win ? 'is-win' : ''}>
          <Crown size={20} /> {title}
        </h2>
        {r.mode !== 'robots' && (
          <p className="lw-finalscore">
            <span style={{ color: TEAM[0] }}>{r.score[0]}</span> · <span style={{ color: TEAM[1] }}>{r.score[1]}</span>
          </p>
        )}
        <table className="lw-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Hero</th>
              <th>KOs</th>
              <th>Downs</th>
              <th>Breaks</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id} className={row.me ? 'is-me' : ''} style={{ ['--lw-team' as string]: TEAM[row.team] }}>
                <td>{row.name}</td>
                <td>{HEROES[row.hero].name.split(' ')[0]}</td>
                <td>{row.kills}</td>
                <td>{row.deaths}</td>
                <td>{row.breaks}</td>
                <td>{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.reward && (
          <p className="lw-reward">
            +{r.reward.coins} coins · +{r.reward.xp} XP · +{r.reward.heroXp} hero XP{r.reward.levelUp ? ' · LEVEL UP' : ''}
            {r.reward.heroLevelUp ? ' · HERO LEVEL UP (new perk)' : ''}
            {r.reward.jobsDone.length ? ` · job done: ${r.reward.jobsDone.join(', ')}` : ''}
          </p>
        )}
        <div className="lw-online">
          <button className="btn btn-primary" disabled={busy} onClick={again} data-testid="lw-again">
            <Play size={16} /> {hud.role === 'solo' ? 'Back to the menu' : 'Back to the lobby'}
          </button>
          {hud.role !== 'solo' && (
            <button className="btn" onClick={onQuit}>
              Leave
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Touch ---------- */

function TouchControls({ game }: { game: Game }) {
  return (
    <div className="lw-touch" data-testid="lw-touch">
      <Stick onMove={(x, y) => game.input.touchMove(x, y)} className="lw-stick-move" />
      <LookPad onLook={(dx, dy) => game.input.touchLook(dx, dy)} />
      <div className="lw-tbuttons">
        <Btn game={game} name="light" label="SWING" />
        <Btn game={game} name="heavy" label="HEAVY" />
        <Btn game={game} name="block" label="BLOCK" hold />
        <Btn game={game} name="jump" label="JUMP" />
      </div>
      <div className="lw-tbuttons lw-tbuttons-2">
        <Btn game={game} name="throw" label="THROW" />
        <Btn game={game} name="use" label="USE" />
        <Btn game={game} name="ladder" label="LADDER" />
        <Btn game={game} name="ult" label="ULT" />
        <Btn game={game} name="sprint" label="RUN" hold />
      </div>
    </div>
  )
}

function Btn({ game, name, label, hold }: { game: Game; name: string; label: string; hold?: boolean }) {
  return (
    <button
      className={`lw-tbtn lw-tbtn-${name}`}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        game.input.touchButton(name, true)
      }}
      onPointerUp={() => game.input.touchButton(name, false)}
      onPointerCancel={() => game.input.touchButton(name, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
      {hold ? '' : ''}
    </button>
  )
}

function Stick({ onMove, className }: { onMove: (x: number, y: number) => void; className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLSpanElement>(null)
  const id = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const el = ref.current!
    const R = 44
    const set = (dx: number, dy: number) => {
      const l = Math.hypot(dx, dy)
      const k = l > R ? R / l : 1
      dx *= k
      dy *= k
      if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`
      onMove(dx / R, dy / R)
    }
    const down = (e: PointerEvent) => {
      if (id.current !== null) return
      id.current = e.pointerId
      el.setPointerCapture(e.pointerId)
      origin.current = { x: e.clientX, y: e.clientY }
      set(0, 0)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id.current) return
      set(e.clientX - origin.current.x, e.clientY - origin.current.y)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id.current) return
      id.current = null
      set(0, 0)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [onMove])
  return (
    <div ref={ref} className={`lw-stick ${className}`}>
      <span ref={knob} />
    </div>
  )
}

function LookPad({ onLook }: { onLook: (dx: number, dy: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    let id: number | null = null
    let lx = 0
    let ly = 0
    const down = (e: PointerEvent) => {
      if (id !== null) return
      id = e.pointerId
      el.setPointerCapture(e.pointerId)
      lx = e.clientX
      ly = e.clientY
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return
      onLook(e.clientX - lx, e.clientY - ly)
      lx = e.clientX
      ly = e.clientY
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId === id) id = null
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [onLook])
  return <div ref={ref} className="lw-lookpad" />
}

export type { ReactNode }
