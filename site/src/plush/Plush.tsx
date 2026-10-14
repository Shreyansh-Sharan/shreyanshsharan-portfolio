// PLUSH PANIC page: the menu (Show, Quick Play, online rooms, your toy and the Show settings), and the stage
// where the engine runs the Loft, the rounds and the results. The engine is a separate chunk loaded on demand;
// physics loads with it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Cookie, Crown, Globe, LogIn, Sparkles, Users } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { useBackToSetup } from '../lib/backToSetup'
import { setInputSuspended } from '../lib/input'
import { play as uiSound } from '../lib/sound'
import { Page } from '../components/Page'
import { loadPlushAssets, type PlushAssets } from './engine/assets'
import { loadProfile, MAX_PEOPLE, MAX_SHOW, saveProfile, type Profile, type ProfilePatch } from './engine/show'
import { emotesOwned } from './wardrobe/store'
import { quickPlayLevels } from './levels'
import type { Game, Hud } from './engine/game'
import type { NetSession } from './engine/net'
import { Customise, SettingsForm } from './Forms'
import { PlushHud } from './Hud'
import { AdSlot } from '../components/AdSlot'
import { GearShelf } from '../components/GearShelf'
import { Loader3D } from '../components/Loader3D'

const accent = tiles.find((t) => t.id === 'plush-panic')?.accent ?? (['#7c2d12', '#fbbf24'] as [string, string])
const KEYART = `${import.meta.env.BASE_URL}plush/keyart.webp`

type Launch = { kind: 'loft' } | { kind: 'quick'; level: string } | { kind: 'host' } | { kind: 'join'; code: string } | { kind: 'board' }

export function Plush({ auto, level, join, onAccent }: { auto?: string; level?: string; join?: string; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'plush-panic'), [onAccent])
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [assets, setAssets] = useState<PlushAssets | null>(null)
  const [pct, setPct] = useState(0)
  const initial: Launch | null = join
    ? { kind: 'join', code: join }
    : auto === 'quick' && level
      ? { kind: 'quick', level }
      : auto === 'host'
        ? { kind: 'host' }
        : auto === 'board'
          ? { kind: 'board' }
          : auto
            ? { kind: 'loft' }
            : null
  const [launch, setLaunch] = useState<Launch | null>(initial)
  const [run, setRun] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadPlushAssets((d, t) => alive && setPct(d / t)).then((a) => {
      if (!alive) return
      setAssets(a)
      setPct(1)
    })
    return () => {
      alive = false
    }
  }, [])

  // Patches can be functions of the current profile (buying, rewards), so updates never work from a stale copy.
  const update = (patch: ProfilePatch) => {
    setProfile((prev) => {
      const p = typeof patch === 'function' ? patch(prev) : patch
      const next = { ...prev, ...p, settings: { ...prev.settings, ...(p.settings ?? {}) } }
      saveProfile(next)
      return next
    })
  }

  // Back (browser, phone or mouse) from a match returns to this setup page.
  useBackToSetup(launch !== null, () => {
    setError(null)
    setLaunch(null)
    setRun((r) => r + 1)
  })

  if (launch)
    return (
      <Stage
        key={run}
        launch={launch}
        assets={assets}
        pct={pct}
        profile={profile}
        onProfile={update}
        onExit={(why) => {
          setError(why ?? null)
          setLaunch(null)
          setRun((r) => r + 1)
        }}
      />
    )

  return (
    <Menu
      profile={profile}
      assets={assets}
      pct={pct}
      error={error}
      onProfile={update}
      onLaunch={(l) => {
        uiSound('select')
        setError(null)
        setLaunch(l)
      }}
    />
  )
}

/* ---------- Menu ---------- */

function Menu(p: { profile: Profile; assets: PlushAssets | null; pct: number; error: string | null; onProfile: (p: Partial<Profile>) => void; onLaunch: (l: Launch) => void }) {
  const { profile } = p
  const [code, setCode] = useState('')
  const levels = useMemo(() => quickPlayLevels(), [])
  return (
    <Page onBack={() => navigate('#/home/plush-panic')} backLabel="Games" portfolio className="racer-page pp-page">
      <header className="page-header pp-hero">
        <img className="pp-keyart" src={KEYART} alt="Plush toys tumbling on a stool in a sunny attic while giant scissors snip the edge" />
        <div>
          <p className="eyebrow">Games · Party brawler</p>
          <h1 className="page-title pp-title">PLUSH PANIC</h1>
          <p className="page-lead">
            Squishy Stitchlings meet in a cosy attic, then play a Show: short, chaotic rounds where the field shrinks until one toy wears the crown. Every
            level has dirty tricks, and knocked-out toys throw crumbs from the rafters.
          </p>
          <p className="pp-wallet">
            <Sparkles size={16} /> {profile.buttons} buttons · {profile.shows} shows · {profile.wins} crowns
          </p>
        </div>
      </header>

      <div className="vr-grid pp-menu">
        <section className="arena-panel">
          <h2 className="section-title">Play</h2>
          <button className="btn btn-primary arena-start" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'loft' })}>
            <Crown size={18} /> Play a Show
          </button>
          <p className="muted small">You start in the Loft. Jump into the toy chest to start a Show of {profile.settings.rounds} rounds against bots.</p>
          <h3 className="pp-sub">Quick Play</h3>
          <div className="pp-levels">
            {levels.map((l) => (
              <button key={l.id} className="pp-levelcard" style={{ ['--pp-accent' as string]: l.accent }} disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'quick', level: l.id })}>
                <strong>{l.name}</strong>
                <span className="pp-type">{l.type}</span>
                <span className="muted small">{l.blurb}</span>
              </button>
            ))}
          </div>
          <h3 className="pp-sub">Toy Box Trail</h3>
          <div className="pp-boardcard">
            <p className="muted small">
              A board game across the attic floor: roll the foam die, hop the playing cards, buy dirty tricks, win duels and race to the cookie jar.
            </p>
            <label className="pp-boardsize">
              Toys at the table
              <select value={profile.settings.boardSize ?? 4} onChange={(e) => p.onProfile({ settings: { ...profile.settings, boardSize: Number(e.target.value) } })}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'board' })} data-testid="pp-board-start">
              <Cookie size={16} /> Play Toy Box Trail
            </button>
          </div>
          <h3 className="pp-sub">Online</h3>
          <div className="pp-online">
            <button className="btn" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'host' })}>
              <Globe size={16} /> Host a room
            </button>
            <input className="code-input" value={code} maxLength={8} placeholder="CODE" aria-label="Room code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn" disabled={!p.assets || code.trim().length < 4} onClick={() => p.onLaunch({ kind: 'join', code })}>
              <LogIn size={16} /> Join
            </button>
          </div>
          <p className="muted small">Up to {MAX_PEOPLE} people per room, with bots filling the Show to {MAX_SHOW}. Peer-to-peer: the host's browser runs the game.</p>
          {p.error && <p className="notice">{p.error}</p>}
          {p.pct < 1 && <p className="muted small">Loading toys and attic: {Math.round(p.pct * 100)}%</p>}
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">Your toy</h2>
          <Customise profile={profile} assets={p.assets} onProfile={p.onProfile} />
          <h2 className="section-title">Show settings</h2>
          <SettingsForm settings={profile.settings} onChange={(s) => p.onProfile({ settings: s })} />
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">Sabotage your friends</h2>
          <ul className="pp-rules">
            <li><strong>Mischief costs you.</strong> Tricks cost Sprinkles and tie up your paws for a moment.</li>
            <li><strong>Grudges.</strong> Whoever hit you last gets a red stitch over their head, and revenge on them is half price.</li>
            <li><strong>Peanut gallery.</strong> Knocked out? Throw crumbs, paper balls and feathers from the rafters.</li>
            <li><strong>Awards.</strong> Biggest Menace, Most Betrayed, Revenge Served and Saint pay out buttons.</li>
          </ul>
          <h2 className="section-title">Controls</h2>
          <ul className="keys">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · mouse to look (click to lock)</li>
            <li><kbd>Space</kbd> jump · <kbd>Shift</kbd> dive · <kbd>E</kbd> grab (hold) · <kbd>LMB</kbd>/<kbd>F</kbd> shove</li>
            <li><kbd>1</kbd>–<kbd>7</kbd> tricks · <kbd>Tab</kbd> pick a rival · <kbd>R</kbd> level action</li>
            <li>Gamepad: stick, A jump, B dive, X shove, RT grab, d-pad tricks · touch: on-screen buttons</li>
          </ul>
        </section>
      </div>
      <AdSlot />
      <GearShelf topic="party" />
    </Page>
  )
}

/* ---------- Stage ---------- */

function Stage(p: { launch: Launch; assets: PlushAssets | null; pct: number; profile: Profile; onProfile: (p: ProfilePatch) => void; onExit: (why?: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const [status, setStatus] = useState('Loading toys and attic…')
  const profileRef = useRef(p.profile)
  profileRef.current = p.profile
  const { onExit } = p
  const ready = !!p.assets
  // Your look (name, toy, tint, Sewing Table outfit) and unlocked emotes follow the saved profile.
  const lookKey = JSON.stringify([p.profile.name, p.profile.kind, p.profile.tint, p.profile.outfit ?? {}])
  const emoteKey = emotesOwned(p.profile).join()
  useEffect(() => {
    const g = gameRef.current
    if (!g) return
    const pr = profileRef.current
    g.setLook({ name: pr.name, kind: pr.kind, tint: pr.tint, outfit: pr.outfit })
  }, [lookKey])
  useEffect(() => {
    gameRef.current?.setEmotes(emotesOwned(profileRef.current))
  }, [emoteKey])

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
    let cancelled = false
    let game: Game | null = null
    let net: NetSession | null = null
    const q = new URLSearchParams(window.location.search)
    // Closing the tab says goodbye, so the host can hand this toy to a bot straight away.
    const onHide = () => net?.link.close()
    window.addEventListener('pagehide', onHide)
    ;(async () => {
      try {
        if (p.launch.kind === 'host' || p.launch.kind === 'join') {
          setStatus(p.launch.kind === 'host' ? 'Opening a room…' : 'Joining the room…')
          const { hostRoom, joinRoom } = await import('./engine/net')
          const link = p.launch.kind === 'host' ? await hostRoom() : await joinRoom(p.launch.code)
          if (cancelled) {
            link.close()
            return
          }
          net = { link, role: link.isHost ? 'host' : 'client' }
        }
        setStatus('Warming up the physics…')
        const { Game } = await import('./engine/game')
        if (cancelled || !host.current) return
        game = new Game(host.current, { assets: p.assets!, profile: profileRef.current, net: net ?? undefined, snap: q.has('snap') })
        gameRef.current = game
        game.onHud = setHud
        game.onEarn = (prof) => saveProfile(prof)
        game.onReward = (r) =>
          p.onProfile((prev) => {
            const awards = { ...(prev.awards ?? {}) }
            for (const a of r.awards) awards[a] = (awards[a] ?? 0) + 1
            return { buttons: prev.buttons + r.buttons, shows: prev.shows + 1, wins: prev.wins + (r.win ? 1 : 0), awards }
          })
        game.setEmotes(emotesOwned(profileRef.current))
        game.onDisconnect = (why) => onExit(why)
        if (q.has('snap') || q.get('net') === 'local') (window as unknown as { __plush: Game }).__plush = game
        await game.init()
        if (cancelled) return
        if (net?.role === 'client') game.hello()
        if (p.launch.kind === 'quick') game.startQuick(p.launch.level)
        if (p.launch.kind === 'board') game.startBoard()
        setStatus('')
        if (q.has('snap')) game.simulate(0)
        else game.start()
      } catch (e) {
        if (!cancelled) onExit((e as Error).message || 'Could not start the game.')
      }
    })()
    return () => {
      cancelled = true
      window.removeEventListener('pagehide', onHide)
      game?.dispose()
      net?.link.close()
      gameRef.current = null
    }
    // The stage is keyed per launch, so its options are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div className="racer-stage pp-stage">
      <div ref={host} className="racer-host" />
      {!ready && <Loader3D status="Loading toys and attic…" progress={p.pct} />}
      {ready && status && (
        <div className="vr-loading pp-loading">
          <img src={KEYART} alt="" />
          <span>{status}</span>
        </div>
      )}
      {hud && gameRef.current && (
        <PlushHud
          hud={hud}
          game={gameRef.current}
          profile={p.profile}
          assets={p.assets}
          onProfile={(np) => {
            p.onProfile(np)
            if (typeof np !== 'function' && np.settings) gameRef.current?.setSettings({ ...p.profile.settings, ...np.settings })
          }}
          onQuit={() => onExit()}
        />
      )}
      {!hud && ready && !status && (
        <div className="pp-wait">
          <Users size={18} /> Waiting for the host…
        </div>
      )}
    </div>
  )
}
