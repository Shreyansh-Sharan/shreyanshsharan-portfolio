// The in-match overlay: score and clock, your health / super / dash, the kill feed, the royale grid timer, the
// online lobby, results with rewards (and an ad break between matches), and the twin-stick touch controls.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Crown, DoorOpen, Play, Skull, Users, Zap } from 'lucide-react'
import { adBreak } from '../lib/ads'
import { HEROES, HERO_IDS } from './engine/heroes'
import { ARENA_MAPS, MAPS, type MapId } from './engine/maps'
import { MODE_INFO, type ModeId } from './engine/sim'
import type { Game, Hud } from './engine/game'
import type { Profile } from './engine/progress'
import { portrait } from './portraits'

export function SiegeHud({ hud, game, profile, onQuit }: { hud: Hud; game: Game; profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; onQuit: () => void }) {
  const me = hud.me
  const hero = HEROES[me.hero]
  const playing = hud.phase === 'play' || hud.phase === 'countdown'
  const team = hud.mode !== 'br'
  const mm = Math.floor(hud.timeLeft / 60)
  const ss = Math.floor(hud.timeLeft % 60)
  return (
    <div className={`sg-hud ${hud.touch ? 'is-touch' : ''}`}>
      {hud.phase === 'lobby' && <Lobby hud={hud} game={game} profile={profile} onQuit={onQuit} />}
      {playing && (
        <>
          <div className="sg-top">
            <button className="sg-quit" onClick={onQuit} aria-label="Leave the match">
              <DoorOpen size={16} />
            </button>
            <div className="sg-score">
              {team ? (
                <>
                  <span className={`sg-team sg-a ${hud.myTeam === 0 ? 'is-mine' : ''}`}>{hud.score[0]}</span>
                  <span className="sg-clock">
                    {mm}:{ss.toString().padStart(2, '0')}
                  </span>
                  <span className={`sg-team sg-b ${hud.myTeam === 1 ? 'is-mine' : ''}`}>{hud.score[1]}</span>
                </>
              ) : (
                <>
                  <span className="sg-team sg-a">
                    <Users size={14} /> {hud.br?.alive ?? 0}
                  </span>
                  <span className="sg-clock">
                    {mm}:{ss.toString().padStart(2, '0')}
                  </span>
                  <span className="sg-team sg-b">
                    <Skull size={14} /> {me.kills}
                  </span>
                </>
              )}
            </div>
            <div className="sg-modetag">
              {MODE_INFO[hud.mode].name} · {team ? `first to ${hud.target}` : `stage ${hud.br?.stage ?? 0}`}
            </div>
          </div>
          <ul className="sg-feed">
            {hud.feed.map((f) => (
              <li key={f.key}>{f.text}</li>
            ))}
          </ul>
          {hud.br && hud.br.shrinkIn < 8 && <div className="sg-gridwarn">Grid closes in {Math.ceil(hud.br.shrinkIn)}s</div>}
          {hud.br?.outside && me.alive && <div className="sg-outside">OUTSIDE THE GRID</div>}
          {hud.phase === 'countdown' && <div className="sg-countdown">{hud.countdown > 0 ? hud.countdown : 'GO'}</div>}
          {!me.alive && hud.mode !== 'br' && <div className="sg-respawn">Back in {Math.ceil(me.respawnIn)}…</div>}
          {!me.alive && hud.mode === 'br' && <div className="sg-respawn">Eliminated · spectating</div>}
          <div className="sg-me">
            <div className="sg-mehero" style={{ ['--sg-accent' as string]: hero.colors[0] }}>
              <img src={portrait(me.hero)} alt="" />
              {hero.name}
            </div>
            <div className="sg-hp">
              <i style={{ width: `${Math.max(0, (me.hp / me.maxHp) * 100)}%` }} />
              <span>
                {Math.max(0, Math.round(me.hp))} / {me.maxHp}
              </span>
            </div>
            <div className="sg-bars">
              <button className={`sg-superbtn ${me.super >= 1 ? 'is-ready' : ''}`} onPointerDown={(e) => {
                e.preventDefault()
                game.input.touchButton('super', true)
              }} onPointerUp={() => game.input.touchButton('super', false)} onPointerLeave={() => game.input.touchButton('super', false)} aria-label="Super">
                <Zap size={16} />
                <i style={{ width: `${Math.min(100, me.super * 100)}%` }} />
                <span>{me.super >= 1 ? hero.superName : `${Math.round(me.super * 100)}%`}</span>
              </button>
              <div className={`sg-dash ${me.dashCd <= 0 ? 'is-ready' : ''}`}>
                <i style={{ width: `${(1 - Math.min(1, me.dashCd / 2.8)) * 100}%` }} />
                <span>DASH</span>
              </div>
            </div>
          </div>
          {hud.touch && <TouchControls game={game} superReady={me.super >= 1} />}
          {!hud.touch && hud.phase === 'play' && hud.time < 6 && <div className="sg-hint">WASD move · mouse aim · LMB fire · Space dash · Q/E super</div>}
        </>
      )}
      {hud.phase === 'over' && hud.results && <ResultsPanel hud={hud} game={game} onQuit={onQuit} />}
    </div>
  )
}

function Lobby({ hud, game, profile, onQuit }: { hud: Hud; game: Game; profile: Profile; onQuit: () => void }) {
  const host = hud.role === 'host'
  const link = `${window.location.origin}${window.location.pathname}#/siege?join=${hud.code}`
  const [copied, setCopied] = useState(false)
  return (
    <div className="sg-lobby" data-testid="sg-lobby">
      <div className="sg-lobbycard">
        <h2>Room {hud.code}</h2>
        <p className="muted small">
          Share the code or the link. {host ? 'You are the host: pick the mode and map, then start.' : 'The host picks the mode and starts the match.'}
        </p>
        <div className="sg-online">
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true))
            }}
          >
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
        </div>
        <ul className="sg-players">
          {hud.players.map((p) => (
            <li key={p.peer}>
              <img className="sg-avatar" src={portrait(p.hero)} alt="" />
              <strong>{p.name}</strong> <span className="muted small">{HEROES[p.hero].name}</span>
              {p.peer === 'host' && <em>host</em>}
            </li>
          ))}
          {hud.players.length < 6 && <li className="muted small">{6 - hud.players.length} slots left (bots fill the rest)</li>}
        </ul>
        {host && (
          <div className="sg-lobbyset">
            <label>
              Mode
              <select value={hud.settings.mode} onChange={(e) => game.setSettings({ mode: e.target.value as ModeId, map: e.target.value === 'br' ? 'sector' : hud.settings.map === 'sector' ? 'kessho' : hud.settings.map })}>
                {(Object.keys(MODE_INFO) as ModeId[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_INFO[m].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Map
              <select value={hud.settings.map} disabled={hud.settings.mode === 'br'} onChange={(e) => game.setSettings({ map: e.target.value as MapId })}>
                {(hud.settings.mode === 'br' ? (['sector'] as MapId[]) : ARENA_MAPS).map((m) => (
                  <option key={m} value={m}>
                    {MAPS[m].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hero
              <select value={profile.hero} onChange={(e) => game.setProfile({ ...profile, hero: e.target.value as (typeof HERO_IDS)[number] })}>
                {HERO_IDS.map((h) => (
                  <option key={h} value={h}>
                    {HEROES[h].name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {!host && (
          <p className="muted small">
            Playing as <strong>{HEROES[profile.hero].name}</strong>
          </p>
        )}
        <div className="sg-online">
          {host && (
            <button className="btn btn-primary" onClick={() => game.startOnline()} data-testid="sg-start-online">
              <Play size={16} /> Start match
            </button>
          )}
          <button className="btn" onClick={onQuit}>
            Leave
          </button>
        </div>
      </div>
    </div>
  )
}

function ResultsPanel({ hud, game, onQuit }: { hud: Hud; game: Game; onQuit: () => void }) {
  const r = hud.results!
  const [busy, setBusy] = useState(false)
  const title = r.mode === 'br' ? (r.placement === 1 ? 'VICTORY' : `#${r.placement || '-'} of 17`) : r.win ? 'VICTORY' : r.winner < 0 ? 'DRAW' : 'DEFEAT'
  const next = () => {
    setBusy(true)
    // A natural break for an interstitial between matches (solo only, so online players stay in step).
    const go = () => (hud.role === 'solo' ? onQuit() : game.backToLobby())
    if (hud.role === 'solo') adBreak('siege-results', { pause: () => game.pause(true), resume: () => game.pause(false), done: go })
    else go()
  }
  return (
    <div className="sg-results" data-testid="sg-results">
      <div className="sg-resultscard">
        <h2 className={r.win ? 'is-win' : ''}>
          {r.win && <Crown size={22} />} {title}
        </h2>
        {r.reward && (
          <p className="sg-reward">
            +{r.reward.coins} coins · +{r.reward.xp} XP
            {r.reward.questsDone.length > 0 && <span> · Job done: {r.reward.questsDone.join(', ')}</span>}
          </p>
        )}
        <table className="sg-table">
          <thead>
            <tr>
              <th>{r.mode === 'br' ? '#' : 'Team'}</th>
              <th>Fighter</th>
              <th>K</th>
              <th>D</th>
              <th>Damage</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id} className={row.me ? 'is-me' : ''}>
                <td>{r.mode === 'br' ? row.placement || '-' : row.team === 0 ? 'A' : 'B'}</td>
                <td className="sg-fighter">
                  <img className="sg-avatar" src={portrait(row.hero)} alt="" />
                  {row.name} <span className="muted small">{HEROES[row.hero].name}</span>
                </td>
                <td>{row.kills}</td>
                <td>{row.deaths}</td>
                <td>{row.damage.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sg-online">
          <button className="btn btn-primary" disabled={busy} onClick={next} data-testid="sg-continue">
            {hud.role === 'solo' ? 'Back to the menu' : 'Back to the lobby'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Touch: two virtual sticks ---------- */

function Stick({ onMove, onEnd, label, className }: { onMove: (x: number, y: number) => void; onEnd: () => void; label: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const id = useRef<number | null>(null)
  const move = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || id.current !== e.pointerId) return
    const r = el.getBoundingClientRect()
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const l = Math.hypot(x, y)
    if (l > 1) {
      x /= l
      y /= l
    }
    onMove(x, y)
    if (knob.current) knob.current.style.transform = `translate(${x * 36}px, ${y * 36}px)`
  }
  const end = () => {
    id.current = null
    onEnd()
    if (knob.current) knob.current.style.transform = ''
  }
  return (
    <div
      ref={ref}
      className={`sg-stick ${className}`}
      onPointerDown={(e) => {
        id.current = e.pointerId
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        move(e)
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={knob} className="sg-knob" />
      <span>{label}</span>
    </div>
  )
}

function TouchControls({ game, superReady }: { game: Game; superReady: boolean }) {
  useEffect(() => () => game.input.touchMove(0, 0), [game])
  return (
    <div className="sg-touch" data-testid="sg-touch">
      <Stick className="sg-stick-move" label="MOVE" onMove={(x, y) => game.input.touchMove(x, y)} onEnd={() => game.input.touchMove(0, 0)} />
      <Stick className="sg-stick-aim" label="AIM · FIRE" onMove={(x, y) => game.input.touchAim(x, y, true)} onEnd={() => game.input.touchAim(0, 0, false)} />
      <button
        className={`sg-tbtn sg-tbtn-super ${superReady ? 'is-ready' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault()
          game.input.touchButton('super', true)
        }}
        onPointerUp={() => game.input.touchButton('super', false)}
        onPointerCancel={() => game.input.touchButton('super', false)}
      >
        SUPER
      </button>
      <button
        className="sg-tbtn sg-tbtn-dash"
        onPointerDown={(e) => {
          e.preventDefault()
          game.input.touchButton('dash', true)
        }}
        onPointerUp={() => game.input.touchButton('dash', false)}
        onPointerCancel={() => game.input.touchButton('dash', false)}
      >
        DASH
      </button>
    </div>
  )
}
