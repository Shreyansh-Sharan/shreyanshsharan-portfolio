import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Crosshair, Expand, LogOut, Users } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { Page } from './Page'

const accent = tiles.find((t) => t.id === 'arena')!.accent
const GAME_URL = 'games/arena/index.html'

type Mode = 'solo' | 'host' | 'join'

interface ArenaMessage {
  source: 'arena'
  type: 'ready' | 'started' | 'code' | 'error' | 'left'
  payload: string
}

function readName() {
  try {
    return localStorage.getItem('arena-name') ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem('arena-name', name)
  } catch {
    // Not persisted in private mode; that's fine.
  }
}

/** Lobby for the Unity WebGL shooter, plus the full-screen player that embeds it. */
export function Arena({ join, onAccent }: { join?: string; onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'arena'), [onAccent])

  const [mode, setMode] = useState<Mode>(join ? 'join' : 'solo')
  const [name, setName] = useState(readName)
  const [bots, setBots] = useState(5)
  const [skill, setSkill] = useState(1)
  const [code, setCode] = useState((join ?? '').toUpperCase())
  const [src, setSrc] = useState<string | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    // Dev servers answer unknown .html paths with the site itself, so look for the Unity loader, not just a 200.
    fetch(GAME_URL, { cache: 'no-store' })
      .then(async (r) => !cancelled && setAvailable(r.ok && (await r.text()).includes('createUnityInstance')))
      .catch(() => !cancelled && setAvailable(false))
    return () => {
      cancelled = true
    }
  }, [])

  const canStart = available !== false && (mode !== 'join' || code.trim().length >= 4)

  const start = () => {
    if (!canStart) return
    saveName(name)
    play('select')
    const params = new URLSearchParams({ mode, bots: String(bots), diff: String(skill), name: name.trim() || 'Player' })
    if (mode === 'join') params.set('code', code.trim().toUpperCase())
    setSrc(`${GAME_URL}?${params}`)
  }

  if (src) return <ArenaPlayer src={src} onExit={() => setSrc(null)} />

  return (
    <Page onBack={() => navigate('#/home/arena')} className="arena-page">
      <header className="page-header">
        <p className="eyebrow">Extras · Unity 6</p>
        <h1 className="page-title">Dunes Arena</h1>
        <p className="page-lead">
          A lightweight multiplayer shooter on an original desert map: a long lane to A, a catwalk from mid, tunnels to B.
          Fight bots or invite friends with a code.
        </p>
      </header>

      <div className="arena-grid">
        <section className="arena-panel">
          <div className="seg" role="tablist" aria-label="Mode">
            {(
              [
                ['solo', 'Solo vs bots'],
                ['host', 'Host online'],
                ['join', 'Join with code'],
              ] as [Mode, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                className={`seg-btn ${mode === id ? 'is-active' : ''}`}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Call sign</span>
            <input value={name} maxLength={16} placeholder="Player" onChange={(e) => setName(e.target.value)} />
          </label>

          {mode !== 'join' && (
            <>
              <label className="field">
                <span>
                  AI bots <strong>{bots}</strong>
                </span>
                <input type="range" min={0} max={9} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
              </label>
              <div className="field">
                <span>Bot skill</span>
                <div className="seg seg-sm">
                  {['Easy', 'Normal', 'Hard'].map((label, i) => (
                    <button key={label} className={`seg-btn ${skill === i ? 'is-active' : ''}`} onClick={() => setSkill(i)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {mode === 'join' && (
            <label className="field">
              <span>Invite code</span>
              <input
                className="code-input"
                value={code}
                maxLength={12}
                placeholder="ABC123"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
          )}

          <button className="btn btn-primary arena-start" disabled={!canStart} onClick={start}>
            <Crosshair size={18} /> {mode === 'solo' ? 'Deploy' : mode === 'host' ? 'Create match' : 'Join match'}
          </button>
          {mode === 'host' && (
            <p className="muted small">You'll get a code and an invite link to share once the match is up. Bots fill the empty slots.</p>
          )}
          {available === false && (
            <p className="notice">
              The game build isn't published yet. Open <code>unity/ArenaShooter</code> in Unity 6 and run{' '}
              <strong>Arena → 2. Build WebGL into Portfolio Site</strong>, then redeploy.
            </p>
          )}
          <p className="muted small mobile-only">Best on a desktop with a mouse and keyboard.</p>
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">Powers</h2>
          <ul className="keys">
            <li><kbd>Space</kbd> ×2 Double jump</li>
            <li><kbd>Q</kbd> / <kbd>Shift</kbd> Dash</li>
            <li><kbd>E</kbd> Overshield (+50)</li>
            <li><kbd>F</kbd> Pulse scan: see enemies through walls</li>
          </ul>
          <h2 className="section-title">Power-ups</h2>
          <ul className="keys">
            <li><span className="dot" style={{ background: '#4ade80' }} /> Health</li>
            <li><span className="dot" style={{ background: '#38bdf8' }} /> Shield cell</li>
            <li><span className="dot" style={{ background: '#fb923c' }} /> Overdrive: double damage</li>
            <li><span className="dot" style={{ background: '#c084fc' }} /> Haste: speed boost</li>
          </ul>
          <h2 className="section-title">Controls</h2>
          <p className="muted small">
            WASD move · Mouse aim · Click fire · Right click zoom · R reload · Tab scoreboard · Esc release mouse. First to
            20 kills wins the round.
          </p>
        </section>
      </div>
    </Page>
  )
}

function ArenaPlayer({ src, onExit }: { src: string; onExit: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const inviteLink = useMemo(() => {
    if (!code) return ''
    return `${window.location.origin}${window.location.pathname}#/arena?join=${encodeURIComponent(code)}`
  }, [code])

  // Pause the site's 3D scene while the game runs so the GPU is all the game's.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('arena-running', { detail: true }))
    return () => {
      window.dispatchEvent(new CustomEvent('arena-running', { detail: false }))
    }
  }, [])

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow) return
      const msg = ev.data as ArenaMessage
      if (!msg || msg.source !== 'arena') return
      if (msg.type === 'code') setCode(msg.payload)
      if (msg.type === 'error') setError('Couldn’t connect. Check the code, or try solo mode.')
      if (msg.type === 'started') setError(null)
      if (msg.type === 'left') onExit()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onExit])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this invite link', inviteLink)
    }
  }

  return (
    <div className="arena-player">
      <div className="arena-bar">
        <button className="pill" onClick={onExit}>
          <LogOut size={16} /> Exit
        </button>
        {code && (
          <div className="invite">
            <Users size={16} />
            <span className="muted">Invite code</span>
            <strong>{code}</strong>
            <button className="pill" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
        {error && <span className="arena-error">{error}</span>}
        <button className="icon-btn" aria-label="Full screen" onClick={() => frame.current?.requestFullscreen?.()}>
          <Expand size={16} />
        </button>
      </div>
      <iframe
        ref={frame}
        className="arena-frame"
        src={src}
        title="Dunes Arena"
        allow="fullscreen; autoplay; clipboard-write; gamepad"
        allowFullScreen
      />
    </div>
  )
}
