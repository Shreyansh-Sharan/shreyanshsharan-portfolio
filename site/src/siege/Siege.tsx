// NEON SIEGE page: the menu (modes, maps, heroes, skins, gear, quests, settings, online rooms) and the stage where
// the engine runs a match. The engine is a separate chunk loaded on demand.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Globe, LogIn, Sparkles, Swords, Users, Zap } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { setInputSuspended } from '../lib/input'
import { play as uiSound } from '../lib/sound'
import { Page } from '../components/Page'
import { AdSlot } from '../components/AdSlot'
import { GearShelf } from '../components/GearShelf'
import { Loader3D } from '../components/Loader3D'
import { loadSiegeAssets, type SiegeAssets } from './engine/assets'
import { HEROES, HERO_IDS, type HeroId } from './engine/heroes'
import { ARENA_MAPS, MAPS, type MapId } from './engine/maps'
import { MODE_INFO, type ModeId } from './engine/sim'
import { buySkin, level, loadProfile, ownsSkin, saveProfile, selectSkin, SKINS, SKIN_IDS, xpForLevel, type Profile, type Settings } from './engine/progress'
import { resolveQuality } from './engine/quality'
import type { Game, Hud } from './engine/game'
import type { NetSession } from './engine/net'
import { SiegeHud } from './Hud'
import { GearScreen } from './Gear'
import './siege.css'

const accent = tiles.find((t) => t.id === 'neon-siege')?.accent ?? (['#4c1d95', '#f0abfc'] as [string, string])
const KEYART = `${import.meta.env.BASE_URL}siege/keyart.webp`

type Launch = { kind: 'solo'; mode: ModeId; map: MapId } | { kind: 'host' } | { kind: 'join'; code: string }

export function Siege({ auto, map, join, onAccent }: { auto?: string; map?: string; join?: string; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'neon-siege'), [onAccent])
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [assets, setAssets] = useState<SiegeAssets | null>(null)
  const [pct, setPct] = useState(0)
  const autoMode = (['tdm', 'capture', 'br'] as const).find((m) => m === auto)
  const autoMap = (Object.keys(MAPS) as MapId[]).find((m) => m === map)
  const initial: Launch | null = join
    ? { kind: 'join', code: join }
    : auto === 'host'
      ? { kind: 'host' }
      : autoMode
        ? { kind: 'solo', mode: autoMode, map: autoMap ?? (autoMode === 'br' ? 'sector' : 'kessho') }
        : null
  const [launch, setLaunch] = useState<Launch | null>(initial)
  const [run, setRun] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadSiegeAssets((d, t) => alive && setPct(d / t)).then((a) => {
      if (!alive) return
      setAssets(a)
      setPct(1)
    })
    return () => {
      alive = false
    }
  }, [])

  const update = (patch: Profile | ((p: Profile) => Profile)) => {
    setProfile((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : patch
      saveProfile(next)
      return next
    })
  }

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

function Menu(p: { profile: Profile; assets: SiegeAssets | null; pct: number; error: string | null; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; onLaunch: (l: Launch) => void }) {
  const { profile } = p
  const [mode, setMode] = useState<ModeId>('tdm')
  const [map, setMap] = useState<MapId>('kessho')
  const [code, setCode] = useState('')
  const [tab, setTab] = useState<'hero' | 'gear'>('hero')
  const hero = HEROES[profile.hero]
  const lvl = level(profile.xp)
  const lvlPct = Math.round(((profile.xp - xpForLevel(lvl)) / Math.max(1, xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100)
  const maps = useMemo(() => (mode === 'br' ? (['sector'] as MapId[]) : ARENA_MAPS), [mode])
  const chosenMap = mode === 'br' ? 'sector' : map
  const setSettings = (s: Partial<Settings>) => p.onProfile((prev) => ({ ...prev, settings: { ...prev.settings, ...s } }))
  const quests = profile.quests.list
  return (
    <Page onBack={() => navigate('#/home/neon-siege')} className="racer-page sg-page">
      <header className="page-header sg-hero">
        <img className="sg-keyart" src={KEYART} alt="Six fighters charging across a neon-lit street block under holo-ads" />
        <div>
          <p className="eyebrow">Games · Top-down arena shooter</p>
          <h1 className="page-title sg-title">NEON SIEGE</h1>
          <p className="page-lead">
            Six heroes, three neon arenas and a shrinking grid. Fight 3v3 for takedowns or the core, or drop solo into Grid Royale with sixteen rivals.
            Earn coins, merge gear, pick a palette, finish the daily jobs.
          </p>
          <p className="sg-wallet">
            <Sparkles size={16} /> {profile.coins} coins · Level {lvl} ({lvlPct}%) · {profile.wins} wins / {profile.matches} matches
          </p>
        </div>
      </header>

      <div className="vr-grid sg-menu">
        <section className="arena-panel">
          <h2 className="section-title">Play</h2>
          <div className="sg-modes">
            {(Object.keys(MODE_INFO) as ModeId[]).map((m) => (
              <button key={m} className={`sg-modecard ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m)} data-testid={`sg-mode-${m}`}>
                <strong>{MODE_INFO[m].name}</strong>
                <span className="muted small">{MODE_INFO[m].blurb}</span>
              </button>
            ))}
          </div>
          <h3 className="sg-sub">Map</h3>
          <div className="sg-maps">
            {maps.map((id) => (
              <button key={id} className={`sg-mapcard ${chosenMap === id ? 'is-on' : ''}`} style={{ ['--sg-accent' as string]: MAPS[id].colors[0] }} onClick={() => setMap(id)} data-testid={`sg-map-${id}`}>
                <strong>{MAPS[id].name}</strong>
                <span className="muted small">{MAPS[id].blurb}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-primary arena-start sg-deploy" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'solo', mode, map: chosenMap })} data-testid="sg-deploy">
            <Crosshair size={18} /> Deploy as {hero.name}
          </button>
          <h3 className="sg-sub">Online 3v3</h3>
          <div className="sg-online">
            <button className="btn" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'host' })} data-testid="sg-host">
              <Globe size={16} /> Host a room
            </button>
            <input className="code-input" value={code} maxLength={8} placeholder="CODE" aria-label="Room code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn" disabled={!p.assets || code.trim().length < 4} onClick={() => p.onLaunch({ kind: 'join', code })} data-testid="sg-join">
              <LogIn size={16} /> Join
            </button>
          </div>
          <p className="muted small">Up to six people per room; bots fill the squads. Peer-to-peer: the host's browser runs the match.</p>
          {p.error && <p className="notice">{p.error}</p>}
          {p.pct < 1 && <p className="muted small">Loading heroes and props: {Math.round(p.pct * 100)}%</p>}
          <h3 className="sg-sub">Daily jobs</h3>
          <ul className="sg-quests">
            {quests.map((q) => (
              <li key={q.id} className={q.claimed ? 'is-done' : ''}>
                <span>{q.text}</span>
                <span className="sg-qprog">
                  {Math.min(q.progress, q.goal).toLocaleString()} / {q.goal.toLocaleString()} · {q.reward}c
                </span>
                <i style={{ width: `${Math.min(100, (q.progress / q.goal) * 100)}%` }} />
              </li>
            ))}
          </ul>
        </section>

        <section className="arena-panel arena-info">
          <div className="sg-tabs">
            <button className={tab === 'hero' ? 'is-on' : ''} onClick={() => setTab('hero')}>
              <Swords size={14} /> Hero
            </button>
            <button className={tab === 'gear' ? 'is-on' : ''} onClick={() => setTab('gear')} data-testid="sg-tab-gear">
              <Zap size={14} /> Gear
            </button>
          </div>
          {tab === 'hero' ? <HeroPicker profile={profile} onProfile={p.onProfile} /> : <GearScreen profile={profile} onProfile={p.onProfile} />}
        </section>

        <section className="arena-panel arena-info">
          <h2 className="section-title">Controls</h2>
          <ul className="keys">
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · mouse aims · <kbd>LMB</kbd> fire (or auto-fire)</li>
            <li><kbd>Space</kbd> dash · <kbd>Q</kbd>/<kbd>E</kbd> super</li>
            <li>Gamepad: left stick move, right stick aim + fire, A dash, Y super</li>
            <li>Touch: left stick move, right stick aim + fire, buttons for dash and super</li>
          </ul>
          <h2 className="section-title">Settings</h2>
          <div className="sg-settings">
            <label>
              Name
              <input value={profile.name} maxLength={12} onChange={(e) => p.onProfile((prev) => ({ ...prev, name: e.target.value.toUpperCase() || 'PLAYER' }))} />
            </label>
            <label>
              Graphics
              <select value={profile.settings.quality} onChange={(e) => setSettings({ quality: e.target.value as Settings['quality'] })} data-testid="sg-quality">
                <option value="auto">Auto ({resolveQuality('auto').tier})</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High (bloom)</option>
              </select>
            </label>
            <label className="sg-check">
              <input type="checkbox" checked={profile.settings.autoFire} onChange={(e) => setSettings({ autoFire: e.target.checked })} /> Auto-fire at enemies in range
            </label>
            <label className="sg-check">
              <input type="checkbox" checked={profile.settings.shake} onChange={(e) => setSettings({ shake: e.target.checked })} /> Screen shake
            </label>
            <label className="sg-check">
              <input type="checkbox" checked={profile.settings.music} onChange={(e) => setSettings({ music: e.target.checked })} /> Music
            </label>
          </div>
          <h2 className="section-title">How it plays</h2>
          <ul className="sg-rules">
            <li><strong>Supers charge from damage.</strong> Each hero has one: a shield dash, a sentry, a shockwave, a cloak, a minefield, a heal zone.</li>
            <li><strong>Cover matters.</strong> Walls stop everything; low cover stops bullets but not grenades; crates break.</li>
            <li><strong>Grid Royale.</strong> The neon grid shrinks every half minute and burns anyone outside. Crack loot crates for gear.</li>
          </ul>
        </section>
      </div>
      <AdSlot />
      <GearShelf topic="gaming" />
    </Page>
  )
}

function HeroPicker({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void }) {
  const hero = HEROES[profile.hero]
  const skin = profile.skins[profile.hero] ?? 'default'
  const stat = (label: string, v: number, max: number) => (
    <div className="sg-stat">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
      </i>
      <em>{Math.round(v)}</em>
    </div>
  )
  const dps = (hero.weapon.dmg * hero.weapon.count) / Math.max(hero.weapon.cooldown, hero.weapon.kind === 'needler' ? hero.weapon.cooldown : hero.weapon.cooldown)
  return (
    <>
      <div className="sg-heroes">
        {HERO_IDS.map((id) => (
          <button key={id} className={`sg-herocard ${profile.hero === id ? 'is-on' : ''}`} style={{ ['--sg-accent' as string]: HEROES[id].colors[0] }} onClick={() => onProfile((p) => ({ ...p, hero: id }))} data-testid={`sg-hero-${id}`}>
            <strong>{HEROES[id].name}</strong>
            <span>{HEROES[id].role}</span>
          </button>
        ))}
      </div>
      <h3 className="sg-sub" style={{ color: hero.colors[1] }}>
        {hero.name} · {hero.role}
      </h3>
      <p className="muted small">{hero.blurb}</p>
      {stat('Health', hero.hp, 2800)}
      {stat('Speed', hero.speed, 7)}
      {stat('Damage / s', dps, 900)}
      {stat('Range', hero.weapon.range, 22)}
      <p className="sg-super">
        <Zap size={14} /> <strong>{hero.superName}</strong> · {hero.superBlurb}
      </p>
      <h3 className="sg-sub">Palette</h3>
      <div className="sg-skins">
        {SKIN_IDS.map((id) => {
          const s = SKINS[id]
          const owned = ownsSkin(profile, profile.hero, id)
          return (
            <button
              key={id}
              className={`sg-skin ${skin === id ? 'is-on' : ''} ${owned ? '' : 'is-locked'}`}
              style={{ ['--sg-tint' as string]: s.tint, ['--sg-glow' as string]: s.glow }}
              title={owned ? s.name : `${s.name} · ${s.cost} coins`}
              onClick={() =>
                onProfile((p) => {
                  if (ownsSkin(p, p.hero, id)) return selectSkin(p, p.hero, id)
                  const bought = buySkin(p, p.hero, id)
                  if (bought) uiSound('select')
                  return bought ?? p
                })
              }
              data-testid={`sg-skin-${id}`}
            >
              <i />
              <span>{s.name}</span>
              {!owned && <small>{s.cost}c</small>}
            </button>
          )
        })}
      </div>
    </>
  )
}

/* ---------- Stage ---------- */

function Stage(p: { launch: Launch; assets: SiegeAssets | null; pct: number; profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; onExit: (why?: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const [status, setStatus] = useState('Loading heroes and props…')
  const profileRef = useRef(p.profile)
  profileRef.current = p.profile
  const { onExit } = p
  const ready = !!p.assets

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('arena-running', { detail: true }))
    setInputSuspended(true)
    return () => {
      window.dispatchEvent(new CustomEvent('arena-running', { detail: false }))
      setInputSuspended(false)
    }
  }, [])

  // The engine keeps a copy of the profile for the look and settings.
  const lookKey = JSON.stringify([p.profile.name, p.profile.hero, p.profile.skins, p.profile.settings, p.profile.equipped])
  useEffect(() => {
    gameRef.current?.setProfile(profileRef.current)
  }, [lookKey])

  useEffect(() => {
    if (!ready || !host.current) return
    let cancelled = false
    let game: Game | null = null
    let net: NetSession | null = null
    const q = new URLSearchParams(window.location.search)
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
        setStatus('Powering up the grid…')
        const { Game } = await import('./engine/game')
        if (cancelled || !host.current) return
        const quality = resolveQuality(q.get('quality') === 'low' || q.get('quality') === 'medium' || q.get('quality') === 'high' ? (q.get('quality') as 'low') : profileRef.current.settings.quality)
        const lineup = q.get('lineup')?.split(',').filter((h): h is HeroId => HERO_IDS.includes(h as HeroId))
        game = new Game(host.current, { assets: p.assets!, profile: profileRef.current, quality, net: net ?? undefined, snap: q.has('snap'), autopilot: q.has('autopilot'), lineup })
        gameRef.current = game
        game.onHud = setHud
        game.onResult = (_r, prof) => p.onProfile(prof)
        game.onDisconnect = (why) => onExit(why)
        if (q.has('snap') || q.get('net') === 'local' || q.has('autopilot')) (window as unknown as { __siege: Game }).__siege = game
        if (net?.role === 'client') game.hello()
        if (p.launch.kind === 'solo') game.startSolo(p.launch.mode, p.launch.map)
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
    <div className="racer-stage sg-stage">
      <div ref={host} className="racer-host sg-host" />
      {!ready && <Loader3D status="Loading heroes and props…" progress={p.pct} />}
      {ready && status && (
        <div className="vr-loading sg-loading">
          <img src={KEYART} alt="" />
          <span>{status}</span>
        </div>
      )}
      {hud && gameRef.current && <SiegeHud hud={hud} game={gameRef.current} profile={p.profile} onProfile={p.onProfile} onQuit={() => onExit()} />}
      {!hud && ready && !status && (
        <div className="sg-wait">
          <Users size={18} /> Waiting for the host…
        </div>
      )}
    </div>
  )
}
