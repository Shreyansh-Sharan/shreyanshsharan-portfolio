import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Crosshair, Expand, LogOut, Users } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { useBackToSetup } from '../lib/backToSetup'
import { play } from '../lib/sound'
import { Page } from './Page'
import { AdSlot } from './AdSlot'
import { GearShelf } from './GearShelf'
import { adBreak, useGameAds } from '../lib/ads'
import { Loader3D } from './Loader3D'

const accent = tiles.find((t) => t.id === 'arena')!.accent
const GAME_URL = 'games/arena/index.html'

type Mode = 'solo' | 'host' | 'join'

const MAPS = [
  { id: 'dunes', label: 'Dunes', blurb: 'Sunny desert: long lane to A, catwalk from mid, tunnels to B.' },
  { id: 'harbor', label: 'Harbor Night', blurb: 'Container port at dusk with a roofed warehouse lane and an open quay.' },
  { id: 'frost', label: 'Frost Outpost', blurb: 'Snowbound base: a courtyard bunker, a hangar lane and a trench lane.' },
  {
    id: 'sandstorm',
    label: 'Sandstorm',
    blurb: 'Bleached sandstone town: long A through double doors, a mid door, a raised catwalk and tunnels to B.',
  },
  {
    id: 'villa',
    label: 'Villa',
    blurb: 'Italian village: a curved lane over a stone bridge to the church courtyard, alleys and a balcony over A.',
  },
  {
    id: 'bazaar',
    label: 'Bazaar',
    blurb: 'Market town at dusk: palace square, apartments to the market, and a sniper window over mid.',
  },
] as const

type MapId = (typeof MAPS)[number]['id']

const GUNS = [
  { id: 'smg', label: 'SMG' },
  { id: 'rifle', label: 'Rifle' },
  { id: 'sniper', label: 'Sniper' },
  { id: 'shotgun', label: 'Shotgun' },
] as const

type GunId = (typeof GUNS)[number]['id']

interface ArenaMessage {
  source: 'arena'
  type: 'ready' | 'started' | 'code' | 'map' | 'error' | 'left' | 'progress'
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

/** Turn the game's raw connection error into something a player can act on. */
function describeError(raw: string) {
  const text = (raw || '').toLowerCase()
  if (text.includes('project') && (text.includes('cloud') || text.includes('id')))
    return 'Online play isn’t set up yet: the game needs to be linked to a Unity Cloud project. Solo mode still works.'
  if (text.includes('not found') || text.includes('404') || text.includes('code'))
    return 'No match with that code. Check it, or ask your friend to host again.'
  if (text.includes('full')) return 'That match is full.'
  if (text.includes('network') || text.includes('websocket') || text.includes('timeout'))
    return 'Couldn’t reach the game servers. Check your connection and try again.'
  return raw ? `Couldn’t connect: ${raw}` : 'Couldn’t connect. Check the code, or try solo mode.'
}

const BUILD_FILES = ['games/arena/Build/arena.loader.js', 'games/arena/Build/arena.framework.js.unityweb', 'games/arena/Build/arena.data.unityweb', 'games/arena/Build/arena.wasm.unityweb']

/** Skip the warm-up on data saver, slow connections and phones (the game needs a mouse and keyboard anyway). */
function shouldPrefetch() {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (c?.saveData || /2g/.test(c?.effectiveType ?? '')) return false
  return !(matchMedia('(pointer: coarse)').matches && window.innerWidth < 900)
}

/**
 * Pull the game's files (about 15 MB) into the browser cache while the visitor reads the lobby, so pressing
 * Deploy starts the match from cache instead of a cold download. Reports bytes so the lobby can show progress.
 */
async function warmBuild(onProgress: (done: number, total: number) => void, signal: AbortSignal) {
  const heads = await Promise.all(BUILD_FILES.map((u) => fetch(u, { method: 'HEAD', signal }).catch(() => null)))
  const sizes = heads.map((h) => Number(h?.headers.get('content-length') ?? 0))
  const total = sizes.reduce((a, b) => a + b, 0)
  let done = 0
  onProgress(0, total)
  for (const url of BUILD_FILES) {
    const res = await fetch(url, { signal, priority: 'low' } as RequestInit)
    if (!res.ok || !res.body) continue
    const reader = res.body.getReader()
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      done += value?.byteLength ?? 0
      onProgress(done, total)
    }
  }
  onProgress(total || done, total || done)
}

/** Lobby for the Unity WebGL shooter, plus the full-screen player that embeds it. */
export function Arena({ join, onAccent }: { join?: string; onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'arena'), [onAccent])

  const [mode, setMode] = useState<Mode>(join ? 'join' : 'solo')
  const [name, setName] = useState(readName)
  const [bots, setBots] = useState(5)
  const [skill, setSkill] = useState(1)
  const [map, setMap] = useState<MapId>('dunes')
  const [gun, setGun] = useState<GunId>('rifle')
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

  // Warm the browser cache with the build as soon as the lobby opens.
  const [warm, setWarm] = useState<{ done: number; total: number } | null>(null)
  useEffect(() => {
    if (available !== true || !shouldPrefetch()) return
    const ctrl = new AbortController()
    warmBuild((done, total) => setWarm({ done, total }), ctrl.signal).catch(() => {})
    return () => ctrl.abort()
  }, [available])
  const warmPct = warm && warm.total ? Math.min(100, Math.round((warm.done / warm.total) * 100)) : null
  const warmDone = warm !== null && warm.total > 0 && warm.done >= warm.total

  const canStart = available !== false && (mode !== 'join' || code.trim().length >= 4)

  const start = () => {
    if (!canStart) return
    saveName(name)
    play('select')
    const params = new URLSearchParams({ mode, map, gun, bots: String(bots), diff: String(skill), name: name.trim() || 'Player' })
    if (mode === 'join') params.set('code', code.trim().toUpperCase())
    setSrc(`${GAME_URL}?${params}`)
  }

  // Back (browser, phone or mouse) from a match returns to this setup page.
  useBackToSetup(src !== null, () => setSrc(null))

  if (src) return <ArenaPlayer src={src} onExit={() => setSrc(null)} />

  return (
    <Page onBack={() => navigate('#/home/arena')} backLabel="Games" portfolio className="arena-page">
      <header className="page-header">
        <p className="eyebrow">Games · Unity 6</p>
        <h1 className="page-title">Dunes Arena</h1>
        <p className="page-lead">
          A lightweight multiplayer shooter on six original maps, from the Dunes desert and a night-time harbour to three
          classic-style arenas: Sandstorm, Villa and Bazaar. Five weapons, right-click aiming and a scoped sniper. Fight bots
          or invite friends with a code.
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
              <div className="field">
                <span>Map</span>
                <div className="seg seg-sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderRadius: 20 }}>
                  {MAPS.map(({ id, label }) => (
                    <button key={id} className={`seg-btn ${map === id ? 'is-active' : ''}`} onClick={() => setMap(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="muted small">{MAPS.find((m) => m.id === map)?.blurb}</span>
              </div>
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

          <div className="field">
            <span>Primary weapon</span>
            <div className="seg seg-sm">
              {GUNS.map(({ id, label }) => (
                <button key={id} className={`seg-btn ${gun === id ? 'is-active' : ''}`} onClick={() => setGun(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

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
          {warmPct !== null && (
            <div className="cricket-progress" aria-live="polite">
              <div className="cricket-progress-bar">
                <div style={{ width: `${warmPct}%` }} />
              </div>
              <span className="muted small">{warmDone ? 'Game files ready: the match will start straight away.' : `Preparing the game in the background… ${warmPct}%`}</span>
            </div>
          )}
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
          <h2 className="section-title">Weapons</h2>
          <ul className="keys">
            <li><kbd>1</kbd> P9 Sidearm: always carried</li>
            <li><kbd>2</kbd> Vespa SMG: fast, accurate on the move</li>
            <li><kbd>3</kbd> Kestrel AR: the all-rounder</li>
            <li><kbd>4</kbd> Longbow: bolt-action, two-level scope</li>
            <li><kbd>5</kbd> Mastiff: pump shotgun, brutal up close</li>
          </ul>
          <h2 className="section-title">Power-ups</h2>
          <ul className="keys">
            <li><span className="dot" style={{ background: '#4ade80' }} /> Health</li>
            <li><span className="dot" style={{ background: '#38bdf8' }} /> Shield cell</li>
            <li><span className="dot" style={{ background: '#fb923c' }} /> Overdrive: double damage</li>
            <li><span className="dot" style={{ background: '#c084fc' }} /> Haste: speed boost</li>
            <li><span className="dot" style={{ background: '#e879f9' }} /> Weapon crates: add a gun until you die</li>
          </ul>
          <h2 className="section-title">Controls</h2>
          <p className="muted small">
            WASD move · Mouse aim · Click fire · Hold right click to aim down sights (sniper: right click steps through two
            scope zooms, wheel zooms while scoped) · 1–5 or mouse wheel switch weapons · R reload · Tab scoreboard · Esc
            release mouse. Headshots deal extra damage; a sniper headshot always kills. First to 20 kills wins the round.
          </p>
        </section>
      </div>
      <AdSlot />
      <GearShelf topic="gaming" />
    </Page>
  )
}

function ArenaPlayer({ src, onExit: exit }: { src: string; onExit: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  // Leaving a match is a natural break for an interstitial; the lobby comes back once it's done.
  const onExit = useCallback(() => adBreak('arena-exit', { done: exit }), [exit])
  useGameAds(frame, 'arena')
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // The Unity page reports its download progress; the 3D loader covers the frame until it reaches 1.
  const [unityProgress, setUnityProgress] = useState(0)
  const [unityReady, setUnityReady] = useState(false)

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
      if (msg.type === 'progress') {
        const p = Number(msg.payload)
        if (Number.isFinite(p)) setUnityProgress(p)
        if (p >= 1) setUnityReady(true)
      }
      if (msg.type === 'ready' || msg.type === 'started' || msg.type === 'error') setUnityReady(true)
      if (msg.type === 'code') setCode(msg.payload)
      if (msg.type === 'error') setError(describeError(msg.payload))
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
      {!unityReady && <Loader3D status="Loading Dunes Arena…" progress={unityProgress} />}
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
