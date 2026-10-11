// The running race: canvas host, pause menu and the HUD.
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, LogOut, Pause, Play, RotateCcw, Trophy, Wifi } from 'lucide-react'
import { setInputSuspended } from '../lib/input'
import { CONFIG } from './config'
import { glyphUrl } from './fx'
import { POWER_COLORS } from './track'
import { POWER_NAMES } from './save'
import type { RacerAssets } from './assets'
import type { Game, GameOptions, Hud, Mode, RaceResult } from './game'

export function RaceStage(p: {
  options: Omit<GameOptions, 'assets'>
  assets: RacerAssets | null
  loadPct: number
  onFinish: (r: RaceResult) => void
  onQuit: () => void
  onRestart?: () => void
  onDisconnect?: (reason: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const [paused, setPaused] = useState(false)
  const { onFinish, onDisconnect } = p
  const ready = !!p.assets
  const online = !!p.options.net

  // The site's world pauses and menu input is off while racing.
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
    import('./game').then(({ Game }) => {
      if (cancelled || !host.current) return
      game = new Game(host.current, { ...p.options, assets: p.assets ?? undefined })
      gameRef.current = game
      game.minimap = map.current
      game.onHud = setHud
      game.onPause = setPaused
      game.onFinish = onFinish
      game.onDisconnect = (r) => onDisconnect?.(r)
      // ?snap (tests): no live loop; the test advances the game with simulate().
      if (new URLSearchParams(window.location.search).has('snap')) {
        ;(window as unknown as { __racer: Game }).__racer = game
        game.simulate(0)
      } else game.start()
    })
    return () => {
      cancelled = true
      game?.dispose()
      gameRef.current = null
    }
    // The stage is keyed by run, so options are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div className="racer-stage">
      <div ref={host} className="racer-host" />
      {!ready && <div className="vr-loading">Loading cars and track… {Math.round(p.loadPct * 100)}%</div>}
      {hud && <RaceHud hud={hud} mode={p.options.mode} round={p.options.round} />}
      <canvas ref={map} className="vr-minimap" width={360} height={360} />
      {paused && (
        <div className="vr-pause">
          <h2>{online ? 'Menu' : 'Paused'}</h2>
          {online && <p className="muted small">The race keeps running for everyone else.</p>}
          <button className="btn btn-primary" onClick={() => gameRef.current?.setPaused(false)}>
            <Play size={16} /> {online ? 'Back to the race' : 'Resume'}
          </button>
          {p.onRestart && (
            <button className="btn" onClick={p.onRestart}>
              <RotateCcw size={16} /> Restart
            </button>
          )}
          <button className="btn" onClick={p.onQuit}>
            <LogOut size={16} /> {online ? 'Leave the match' : 'Quit to menu'}
          </button>
        </div>
      )}
      <button className="pill vr-pausebtn" aria-label="Pause" onClick={() => gameRef.current?.setPaused(true)}>
        <Pause size={16} />
      </button>
    </div>
  )
}

function RaceHud({ hud, mode, round }: { hud: Hud; mode: Mode; round: number }) {
  const hp = Math.ceil(hud.health)
  const frac = hud.health / CONFIG.max_health
  const hpClass = frac <= CONFIG.fire_below ? 'is-critical' : frac <= CONFIG.smoke_below ? 'is-low' : ''
  return (
    <div className="vr-hud">
      {hud.hitFlash && <div className="vr-edge" style={{ boxShadow: `inset 0 0 120px 30px ${hud.hitFlash}`, opacity: hud.hitFlashAmt }} />}

      <div className="vr-tl">
        <div className="vr-pos">
          {hud.place}
          <span>/{hud.cars}</span>
        </div>
        {mode === 'deathmatch' ? (
          <div className="vr-lap">DEATHMATCH</div>
        ) : (
          <div className="vr-lap">
            LAP {hud.lap}/{hud.laps}
          </div>
        )}
        {hud.online && (
          <div className="vr-online">
            <Wifi size={12} /> ONLINE
          </div>
        )}
        {hud.combat && (
          <div className="vr-combat">
            <strong>{hud.combat.score} CP</strong>
            <span>
              {mode === 'combat' ? `Track ${round + 1}/${CONFIG.combat_tracks} · ` : ''}
              {Math.floor(hud.combat.timeLeft / 60)}:{String(Math.floor(hud.combat.timeLeft % 60)).padStart(2, '0')} left
            </span>
            <span className="muted">
              Leader: {hud.combat.leader} {hud.combat.leaderScore}
            </span>
          </div>
        )}
      </div>

      {mode === 'race' && (
        <div className="vr-fans">
          <Trophy size={14} /> {hud.fans.toLocaleString()} <span className="muted">/ {hud.fanTarget.toLocaleString()} fans</span>
        </div>
      )}

      {hud.fanRun && (
        <div className="vr-fanrun">
          <strong>FAN RUN</strong> {hud.fanRun.label}
          <div className="vr-fanrun-bar">
            <i style={{ width: `${Math.min(1, hud.fanRun.progress / hud.fanRun.goal) * 100}%` }} />
          </div>
          <span>{hud.fanRun.time.toFixed(1)} s</span>
        </div>
      )}

      {hud.phase === 'intro' && (
        <div className="vr-intro">
          {hud.intro.map((l, i) => (
            <p key={i} style={{ animationDelay: `${i * 0.6}s` }}>
              {l}
            </p>
          ))}
          {!hud.online && <span className="muted small">Press Enter to skip</span>}
        </div>
      )}
      {hud.countdown >= 0 && hud.phase !== 'intro' && (
        <div className="vr-count" key={hud.countdown}>
          {hud.countdown === 0 ? 'GO' : hud.countdown}
        </div>
      )}
      {hud.phase === 'countdown' && <div className="vr-hint">Hit the throttle right on GO for a perfect launch</div>}

      {hud.banner && (
        <div className="vr-banner" style={{ color: hud.banner.color }}>
          {hud.banner.text}
          {hud.wrecked > 0 && <span>Respawn in {Math.ceil(hud.wrecked)}</span>}
        </div>
      )}

      <div className="vr-popups">
        {hud.popups.map((pp) => (
          <div key={pp.id} style={{ color: pp.color, transform: `translateY(${-pp.age * 40}px)`, opacity: 1 - pp.age / 1.6 }}>
            {pp.text}
          </div>
        ))}
      </div>

      {hud.reticle && (
        <div className="vr-reticle" style={{ left: hud.reticle.x, top: hud.reticle.y }}>
          <span>{hud.reticle.name}</span>
        </div>
      )}
      {hud.incoming !== null && (
        <div className="vr-incoming" style={{ transform: `translate(-50%, -50%) rotate(${hud.incoming}rad)` }}>
          <ArrowUp size={44} />
          <span>SHUNT</span>
        </div>
      )}
      {hud.lookBack && <div className="vr-lookback">LOOKING BACK</div>}

      <div className="vr-bottom">
        <div className="vr-health">
          <span className="vr-label">
            HEALTH {hud.shield > 0 && <em>SHIELD {hud.shield.toFixed(1)}</em>}
            {hud.invuln && <em>INVULNERABLE</em>}
          </span>
          <div className={`vr-segs ${hpClass}`}>
            {Array.from({ length: CONFIG.max_health }, (_, i) => (
              <i key={i} className={i < hp ? 'on' : ''} />
            ))}
          </div>
        </div>

        <div className="vr-center">
          {(hud.killFeed.length > 0 || hud.chain) && (
            <div className="vr-feed">
              {hud.chain && (
                <div className="vr-chain">
                  CHAIN ×{hud.chain.mult.toFixed(1)} <i style={{ width: `${(hud.chain.time / CONFIG.combat_chain_window) * 100}%` }} />
                </div>
              )}
              {hud.killFeed.map((k) => (
                <div key={k.id} className={k.mine ? 'is-mine' : ''}>
                  {k.text}
                </div>
              ))}
            </div>
          )}
          <div className="vr-bay">
            {hud.bay.map((s, i) => (
              <div key={i} className={`vr-slot ${i === hud.active ? 'is-active' : ''}`} style={s ? { ['--pc' as string]: POWER_COLORS[s.type] } : undefined}>
                {s ? (
                  <>
                    <img src={glyphUrl(s.type)} alt={POWER_NAMES[s.type]} />
                    {s.count > 1 && <b>×{s.count}</b>}
                    <span>{POWER_NAMES[s.type]}</span>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="vr-speed">
          <strong>{hud.speed}</strong>
          <span>km/h</span>
          <div className={`vr-nitro ${hud.nitro > 0 ? 'on' : ''} ${hud.boosting ? 'boost' : ''}`}>
            <i style={{ width: `${Math.min(1, hud.nitro / CONFIG.nitro_duration) * 100}%` }} />
            <span>{hud.nitro > 0 ? `NITRO ${hud.nitro.toFixed(1)}` : hud.boosting ? 'BOOST' : 'NITRO'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Results ---------- */
