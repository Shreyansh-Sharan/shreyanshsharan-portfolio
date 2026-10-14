// LAWN WARS page: the menu (modes, streets, hero picker with hero sheets, house customisation, daily jobs,
// settings, online rooms, credits) and the stage where the engine runs a match. The engine is a separate chunk.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Gift, Globe, Home as HomeIcon, LogIn, Moon, Sparkles, Sun, Swords, Users, Zap } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { useBackToSetup } from '../lib/backToSetup'
import { setInputSuspended } from '../lib/input'
import { play as uiSound } from '../lib/sound'
import { rewardedAd } from '../lib/ads'
import { Page } from '../components/Page'
import { AdSlot } from '../components/AdSlot'
import { GearShelf } from '../components/GearShelf'
import { Loader3D } from '../components/Loader3D'
import { loadLawnAssets, type LawnAssets } from './engine/assets'
import { HEROES, HERO_IDS, heroLevel, heroXpForLevel, type HeroId } from './engine/heroes'
import { LAYOUTS, type LayoutId } from './engine/houses'
import { MAPS, MAP_IDS, type MapId, type TimeOfDay } from './engine/maps'
import { MODE_INFO, type ModeId } from './engine/sim'
import { THROWABLES, THROW_IDS, TRAPS, TRAP_IDS, type ThrowKind, type TrapKind } from './engine/gear'
import { COLOURS, HOUSE_THEMES, HOUSE_THEME_IDS, buyColour, colourHex, level, loadProfile, openChest, ownsColour, perksUnlocked, saveProfile, throwFor, trapsFor, xpForLevel, CHEST_COST, type HouseTheme, type Profile, type Settings } from './engine/progress'
import { resolveQuality } from './engine/quality'
import type { Game, Hud } from './engine/game'
import type { NetSession } from './engine/net'
import { LawnHud } from './Hud'
import { Lobby3D } from './Lobby3D'
import { useLobbyStage, type LobbyHandle } from './lobbyStage'
import { portrait } from './portraits'
import { CHARACTER_CREDITS, MODEL_CREDITS } from './credits'
import './lawn.css'

const accent = tiles.find((t) => t.id === 'lawn-wars')?.accent ?? (['#2f7d32', '#ffd93b'] as [string, string])
const KEYART = `${import.meta.env.BASE_URL}lawn/keyart.webp`

type Launch = { kind: 'solo'; mode: ModeId; map: MapId; time: TimeOfDay } | { kind: 'host' } | { kind: 'join'; code: string }

export function Lawn({ auto, map, join, onAccent }: { auto?: string; map?: string; join?: string; onAccent: (a: [string, string], focus: string) => void }) {
  useEffect(() => onAccent(accent, 'lawn-wars'), [onAccent])
  const [profile, setProfile] = useState<Profile>(loadProfile)
  const [assets, setAssets] = useState<LawnAssets | null>(null)
  const [pct, setPct] = useState(0)
  const q = new URLSearchParams(window.location.search)
  const autoMode = (['destruction', 'brawl', 'robots'] as const).find((m) => m === auto)
  const autoMap = MAP_IDS.find((m) => m === map) ?? 'culdesac'
  const autoTime: TimeOfDay = q.get('time') === 'night' ? 'night' : 'day'
  const initial: Launch | null = join ? { kind: 'join', code: join } : auto === 'host' ? { kind: 'host' } : autoMode ? { kind: 'solo', mode: autoMode, map: autoMap, time: autoTime } : null
  const [launch, setLaunch] = useState<Launch | null>(initial)
  const [run, setRun] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadLawnAssets((d, t) => alive && setPct(d / t)).then((a) => {
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

type Tab = 'heroes' | 'house' | 'settings'

function Menu(p: { profile: Profile; assets: LawnAssets | null; pct: number; error: string | null; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; onLaunch: (l: Launch) => void }) {
  const { profile } = p
  const [mode, setMode] = useState<ModeId>('destruction')
  const [map, setMap] = useState<MapId>('culdesac')
  const [tod, setTod] = useState<TimeOfDay>('day')
  const [code, setCode] = useState('')
  const [tab, setTab] = useState<Tab>((new URLSearchParams(window.location.search).get('tab') as Tab) || 'heroes')
  const hero = HEROES[profile.hero]
  const lvl = level(profile.xp)
  const lvlPct = Math.round(((profile.xp - xpForLevel(lvl)) / Math.max(1, xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100)
  const jobs = profile.jobs.list
  // One shared preview canvas for the hero sheet and the house turntable (only one tab shows at a time).
  const lobby = useLobbyStage(p.assets, profile.settings.quality)
  return (
    <Page onBack={() => navigate('#/home/lawn-wars')} backLabel="Games" portfolio className="racer-page lw-page">
      <header className="page-header lw-hero">
        <img className="lw-keyart" src={KEYART} alt="Six neighbours charging across a sunny cul-de-sac with garden tools" />
        <div>
          <p className="eyebrow">Games · First-person family brawler</p>
          <h1 className="page-title lw-title">LAWN WARS</h1>
          <p className="page-lead">
            Two households, one street. Sixty seconds to trap your house, eight minutes to wreck theirs. Six heroes with garden tools, thrown junk, ladders to the balcony, a
            tow truck through the living room, and the dog.
          </p>
          <p className="lw-wallet">
            <Sparkles size={16} /> {profile.coins} coins · Level {lvl} ({lvlPct}%) · {profile.wins} wins / {profile.matches} matches
          </p>
        </div>
      </header>

      <div className="vr-grid lw-menu">
        <section className="arena-panel">
          <h2 className="section-title">Play</h2>
          <div className="lw-modes">
            {(Object.keys(MODE_INFO) as ModeId[]).map((m) => (
              <button key={m} className={`lw-modecard ${mode === m ? 'is-on' : ''}`} onClick={() => setMode(m)} data-testid={`lw-mode-${m}`}>
                <strong>{MODE_INFO[m].name}</strong>
                <span className="muted small">{MODE_INFO[m].blurb}</span>
              </button>
            ))}
          </div>
          <h3 className="lw-sub">Street</h3>
          <div className="lw-maps">
            {MAP_IDS.map((id) => (
              <button key={id} className={`lw-mapcard ${map === id ? 'is-on' : ''} lw-map-${id}`} onClick={() => setMap(id)} data-testid={`lw-map-${id}`}>
                <strong>{MAPS[id].name}</strong>
                <span className="muted small">{MAPS[id].blurb}</span>
              </button>
            ))}
          </div>
          <div className="lw-tod">
            <button className={tod === 'day' ? 'is-on' : ''} onClick={() => setTod('day')} data-testid="lw-day">
              <Sun size={14} /> Day
            </button>
            <button className={tod === 'night' ? 'is-on' : ''} onClick={() => setTod('night')} data-testid="lw-night">
              <Moon size={14} /> Night raid
            </button>
          </div>
          <button className="btn btn-primary arena-start lw-deploy" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'solo', mode, map, time: tod })} data-testid="lw-deploy">
            <Crosshair size={18} /> Play as {hero.name.split(' ')[0]}
          </button>
          <h3 className="lw-sub">Online 4v4</h3>
          <div className="lw-online">
            <button className="btn" disabled={!p.assets} onClick={() => p.onLaunch({ kind: 'host' })} data-testid="lw-host">
              <Globe size={16} /> Host a street
            </button>
            <input className="code-input" value={code} maxLength={8} placeholder="CODE" aria-label="Room code" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn" disabled={!p.assets || code.trim().length < 4} onClick={() => p.onLaunch({ kind: 'join', code })} data-testid="lw-join">
              <LogIn size={16} /> Join
            </button>
          </div>
          <p className="muted small">Up to eight people per street; bots fill the households. Peer-to-peer: the host's browser runs the match.</p>
          {p.error && <p className="notice">{p.error}</p>}
          {p.pct < 1 && <p className="muted small">Loading the neighbourhood: {Math.round(p.pct * 100)}%</p>}
          <h3 className="lw-sub">Daily jobs</h3>
          <ul className="lw-jobs">
            {jobs.map((j) => (
              <li key={j.id} className={j.claimed ? 'is-done' : ''}>
                <span>{j.text}</span>
                <span className="lw-jprog">
                  {Math.min(j.progress, j.goal)} / {j.goal} · {j.reward}c
                </span>
                <i style={{ width: `${Math.min(100, (j.progress / j.goal) * 100)}%` }} />
              </li>
            ))}
          </ul>
        </section>

        <section className="arena-panel arena-info lw-wide">
          <div className="lw-tabs">
            <button className={tab === 'heroes' ? 'is-on' : ''} onClick={() => setTab('heroes')} data-testid="lw-tab-heroes">
              <Swords size={14} /> Heroes
            </button>
            <button className={tab === 'house' ? 'is-on' : ''} onClick={() => setTab('house')} data-testid="lw-tab-house">
              <HomeIcon size={14} /> Your house
            </button>
            <button className={tab === 'settings' ? 'is-on' : ''} onClick={() => setTab('settings')} data-testid="lw-tab-settings">
              <Zap size={14} /> Controls & settings
            </button>
          </div>
          {tab === 'heroes' && <HeroPicker profile={profile} onProfile={p.onProfile} lobby={lobby} />}
          {tab === 'house' && <HouseScreen profile={profile} onProfile={p.onProfile} lobby={lobby} />}
          {tab === 'settings' && <SettingsScreen profile={profile} onProfile={p.onProfile} />}
        </section>
      </div>
      <AdSlot />
      <GearShelf topic="gaming" />
    </Page>
  )
}

/* ---------- Hero picker + sheet ---------- */

function HeroPicker({ profile, onProfile, lobby }: { profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; lobby: LobbyHandle }) {
  const hero = HEROES[profile.hero]
  const hxp = profile.heroXp[profile.hero] ?? 0
  const hl = heroLevel(hxp)
  const hpct = Math.round(((hxp - heroXpForLevel(hl)) / Math.max(1, heroXpForLevel(hl + 1) - heroXpForLevel(hl))) * 100)
  const unlocked = perksUnlocked(profile, profile.hero)
  const stat = (label: string, v: number, max: number) => (
    <div className="lw-stat">
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
      </i>
      <em>{Math.round(v)}</em>
    </div>
  )
  const m = hero.melee
  const dps = m.ranged ? m.ranged.dmg / 0.7 : m.light / (m.lightUp + m.lightDown)
  const colour = colourHex(profile, profile.hero)
  return (
    <div className="lw-herosheet-wrap">
      <div className="lw-heroes" role="tablist">
        {HERO_IDS.map((id) => (
          <button key={id} className={`lw-herocard ${profile.hero === id ? 'is-on' : ''}`} style={{ ['--lw-accent' as string]: HEROES[id].colors[0], ['--lw-trim' as string]: HEROES[id].colors[1] }} onClick={() => onProfile((p) => ({ ...p, hero: id }))} data-testid={`lw-hero-${id}`}>
            <img src={portrait(id)} alt="" loading="lazy" />
            <strong>{HEROES[id].name.split(' ')[0]}</strong>
            <span>{HEROES[id].role}</span>
          </button>
        ))}
      </div>
      <div className="lw-herosheet" style={{ ['--lw-accent' as string]: hero.colors[0], ['--lw-trim' as string]: hero.colors[1] }} data-testid="lw-herosheet">
        <div className="lw-sheetportrait">
          <Lobby3D
            mode="hero"
            stage={lobby.stage}
            spec={{ hero: profile.hero, colour }}
            className="lw-3d-hero"
            testId="lw-hero3d"
            fallback={<img src={portrait(profile.hero)} alt={`${hero.name}, the ${hero.role.toLowerCase()}`} />}
          />
          <div className="lw-sheetlevel">
            Hero level {hl}
            <i>
              <b style={{ width: `${hpct}%` }} />
            </i>
          </div>
        </div>
        <div className="lw-sheetbody">
          <p className="eyebrow">{hero.role}</p>
          <h3 className="lw-sheetname">{hero.name}</h3>
          <p className="lw-tagline">“{hero.tagline}”</p>
          <p className="muted small">{hero.blurb}</p>
          <div className="lw-stats">
            {stat('Health', hero.hp, 160)}
            {stat('Speed', hero.speed, 6)}
            {stat('Damage / s', dps, 60)}
            {stat('Reach', m.ranged ? 9 : m.reach, 9)}
          </div>
          <div className="lw-cards">
            <div className="lw-card lw-card-passive">
              <span className="lw-cardkind">Passive</span>
              <strong>{hero.passive.name}</strong>
              <p>{hero.passive.blurb}</p>
            </div>
            <div className="lw-card lw-card-gadget">
              <span className="lw-cardkind">Gadget</span>
              <strong>{hero.gadget.name}</strong>
              <p>{hero.gadget.blurb}</p>
            </div>
            <div className="lw-card lw-card-ult">
              <span className="lw-cardkind">Ultimate · Q</span>
              <strong>{hero.ultName}</strong>
              <p>{hero.ultBlurb}</p>
            </div>
          </div>
          <h4 className="lw-sub">Perks</h4>
          <div className="lw-perks">
            {hero.perks.map((perk, i) => (
              <div key={perk.name} className={`lw-perk ${i < unlocked ? 'is-on' : 'is-locked'}`}>
                <strong>{perk.name}</strong>
                <span>{perk.blurb}</span>
                <em>{i < unlocked ? 'Unlocked' : `Hero level ${perk.level}`}</em>
              </div>
            ))}
          </div>
          <h4 className="lw-sub">Appearance</h4>
          <div className="lw-colours">
            {COLOURS.map((c) => {
              const owned = ownsColour(profile, c.id)
              const on = (profile.colours[profile.hero] ?? 'stock') === c.id
              return (
                <button
                  key={c.id}
                  className={`lw-colour ${on ? 'is-on' : ''} ${owned ? '' : 'is-locked'}`}
                  style={{ ['--lw-swatch' as string]: c.hex || hero.colors[0] }}
                  title={owned ? c.name : `${c.name} · ${c.cost} coins`}
                  onClick={() =>
                    onProfile((p) => {
                      if (ownsColour(p, c.id)) return { ...p, colours: { ...p.colours, [p.hero]: c.id } }
                      const bought = buyColour(p, c.id)
                      if (bought) uiSound('select')
                      return bought ? { ...bought, colours: { ...bought.colours, [p.hero]: c.id } } : p
                    })
                  }
                  data-testid={`lw-colour-${c.id}`}
                >
                  <i />
                  <span>{c.name}</span>
                  {!owned && <small>{c.cost}c</small>}
                </button>
              )
            })}
          </div>
          <div className="lw-emotes">
            {['Wave', 'Victory dance', 'Slow clap'].map((e, i) => (
              <span key={e} className={`lw-emote ${i === 0 ? 'is-on' : ''}`}>
                {e} <small>{i === 0 ? 'R' : 'soon'}</small>
              </span>
            ))}
          </div>
          <p className="muted small">
            Playing as <b style={{ color: colour }}>{hero.name.split(' ')[0]}</b> in {COLOURS.find((c) => c.id === (profile.colours[profile.hero] ?? 'stock'))?.name ?? 'Stock'}.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ---------- House customisation ---------- */

function HouseScreen({ profile, onProfile, lobby }: { profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; lobby: LobbyHandle }) {
  const theme = HOUSE_THEMES[profile.house.theme]
  const [cutaway, setCutaway] = useState(false)
  const { layout } = profile.house
  const traps = trapsFor(profile, profile.hero)
  const throwKind = throwFor(profile, profile.hero)
  const setTheme = (t: HouseTheme) => onProfile((p) => ({ ...p, house: { ...p.house, theme: t } }))
  const setLayout = (l: LayoutId) => onProfile((p) => ({ ...p, house: { ...p.house, layout: l } }))
  const toggleTrap = (k: TrapKind) =>
    onProfile((p) => {
      const cur = trapsFor(p, p.hero)
      let next: TrapKind[]
      if (cur.includes(k)) next = cur.filter((x) => x !== k)
      else next = [...cur.slice(cur.length >= 3 ? 1 : 0), k]
      while (next.length < 3) next.push(TRAP_IDS.find((t) => !next.includes(t))!)
      return { ...p, house: { ...p.house, traps: { ...p.house.traps, [p.hero]: next } } }
    })
  const setThrow = (k: ThrowKind) => onProfile((p) => ({ ...p, house: { ...p.house, throwKind: { ...p.house.throwKind, [p.hero]: k } } }))
  return (
    <div className="lw-house" data-testid="lw-house">
      <div className="lw-housepreview">
        <Lobby3D
          mode="house"
          stage={lobby.stage}
          spec={{ theme: profile.house.theme, layout, cutaway }}
          className="lw-3d-house"
          testId="lw-house3d"
          fallback={lobby.still ? <HouseStill theme={profile.house.theme} layout={layout} cutaway={cutaway} /> : <HousePreview theme={theme} layout={layout} />}
        />
        <div className="lw-houserow">
          <label className="lw-check lw-cutaway">
            <input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} data-testid="lw-cutaway" /> Cutaway
          </label>
          <span className="lw-legend">
            <i className="lw-dot-ground" /> ground floor <i className="lw-dot-up" /> upstairs
          </span>
        </div>
        <p className="muted small">
          {theme.name} · {LAYOUTS[profile.house.layout].name}. Saved in your browser and used in every match you host or play solo.
        </p>
      </div>
      <div>
        <h4 className="lw-sub">Paint, siding and roof</h4>
        <div className="lw-themes">
          {HOUSE_THEME_IDS.map((id) => (
            <button key={id} className={`lw-theme ${profile.house.theme === id ? 'is-on' : ''}`} onClick={() => setTheme(id)} data-testid={`lw-theme-${id}`} title={HOUSE_THEMES[id].name}>
              <i style={{ background: HOUSE_THEMES[id].siding }} />
              <i style={{ background: HOUSE_THEMES[id].roof }} />
              <i style={{ background: HOUSE_THEMES[id].door }} />
              <span>{HOUSE_THEMES[id].name}</span>
            </button>
          ))}
        </div>
        <h4 className="lw-sub">Valuables layout</h4>
        <div className="lw-layouts">
          {(Object.keys(LAYOUTS) as LayoutId[]).map((id) => (
            <button key={id} className={`lw-layout ${profile.house.layout === id ? 'is-on' : ''}`} onClick={() => setLayout(id)} data-testid={`lw-layout-${id}`}>
              <strong>{LAYOUTS[id].name}</strong>
              <span className="muted small">{LAYOUTS[id].blurb}</span>
            </button>
          ))}
        </div>
        <h4 className="lw-sub">Trap loadout for {HEROES[profile.hero].name.split(' ')[0]} (pick three)</h4>
        <div className="lw-traps">
          {TRAP_IDS.map((k) => (
            <button key={k} className={`lw-trap ${traps.includes(k) ? 'is-on' : ''}`} onClick={() => toggleTrap(k)} data-testid={`lw-trap-${k}`}>
              <strong>
                {traps.includes(k) ? `${traps.indexOf(k) + 1} · ` : ''}
                {TRAPS[k].name}
              </strong>
              <span className="muted small">{TRAPS[k].blurb}</span>
              <em>×{TRAPS[k].ammo}</em>
            </button>
          ))}
        </div>
        <h4 className="lw-sub">Throwable</h4>
        <div className="lw-throws">
          {THROW_IDS.map((k) => (
            <button key={k} className={`lw-throw ${throwKind === k ? 'is-on' : ''}`} onClick={() => setThrow(k)} data-testid={`lw-throw-${k}`}>
              <strong>{THROWABLES[k].name}</strong>
              <span className="muted small">{THROWABLES[k].blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The low-graphics preview: a picture of the same 3D house, rendered ahead of time per paint, layout and cutaway. */
function HouseStill({ theme, layout, cutaway }: { theme: HouseTheme; layout: LayoutId; cutaway: boolean }) {
  const [bad, setBad] = useState('')
  const src = `${import.meta.env.BASE_URL}lawn/houses/${theme}-${layout}${cutaway ? '-cut' : ''}.webp`
  if (bad === src) return <HousePreview theme={HOUSE_THEMES[theme]} layout={layout} />
  return <img src={src} alt={`${HOUSE_THEMES[theme].name} house, ${LAYOUTS[layout].name} layout`} onError={() => setBad(src)} data-testid="lw-housestill" />
}

/** A stylised front elevation of the house in the chosen theme, with the valuables layout as a floor plan (shown until the 3D preview is ready). */
function HousePreview({ theme, layout }: { theme: (typeof HOUSE_THEMES)[HouseTheme]; layout: LayoutId }) {
  const spots: Record<LayoutId, [number, number, number][]> = {
    classic: [[8, 62, 0], [22, 20, 0], [8, 92, 0], [38, 92, 0], [92, 70, 0], [8, 40, 1], [66, 22, 1], [118, 56, 0]],
    bunker: [[8, 40, 1], [36, 92, 1], [8, 92, 1], [80, 24, 1], [88, 62, 1], [22, 20, 1], [92, 70, 0], [118, 56, 0]],
    spread: [[8, 62, 0], [38, 92, 0], [92, 70, 0], [66, 22, 0], [8, 40, 1], [80, 24, 1], [88, 80, 1], [118, 56, 0]],
    garage: [[122, 48, 0], [110, 90, 0], [118, 56, 0], [124, 72, 0], [92, 70, 0], [22, 20, 0], [8, 92, 0], [66, 22, 1]],
  }
  return (
    <svg viewBox="0 0 150 120" className="lw-housesvg" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect x="0" y="0" width="150" height="120" fill="#7ec8ff" />
      <rect x="0" y="98" width="150" height="22" fill="#6cbf3a" />
      <polygon points="10,50 70,18 130,50" fill={theme.roof} />
      <rect x="16" y="50" width="108" height="48" fill={theme.siding} stroke={theme.trim} strokeWidth="2" />
      <rect x="124" y="64" width="22" height="34" fill={theme.siding} stroke={theme.trim} strokeWidth="2" />
      <rect x="127" y="72" width="16" height="26" fill="#d9d4c8" />
      <rect x="62" y="70" width="14" height="28" fill={theme.door} stroke={theme.trim} strokeWidth="1.5" />
      <rect x="26" y="58" width="16" height="14" fill="#cfefff" stroke={theme.trim} strokeWidth="1.5" />
      <rect x="92" y="58" width="16" height="14" fill="#cfefff" stroke={theme.trim} strokeWidth="1.5" />
      <rect x="50" y="34" width="40" height="12" fill={theme.siding} stroke={theme.trim} strokeWidth="1.5" />
      <rect x="54" y="36" width="12" height="9" fill="#cfefff" />
      <rect x="74" y="36" width="12" height="9" fill="#cfefff" />
      <rect x="48" y="46" width="44" height="2" fill={theme.trim} />
      <g>
        {spots[layout].map(([x, y, f], i) => (
          <g key={i} transform={`translate(${16 + (x / 130) * 108} ${54 + (y / 100) * 40})`}>
            <circle r="3.2" fill={f ? '#ffd93b' : '#ff8a2b'} stroke="#2a1a0a" strokeWidth="0.8" />
          </g>
        ))}
      </g>
    </svg>
  )
}

/* ---------- Settings, chest, credits ---------- */

function SettingsScreen({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void }) {
  const setSettings = (s: Partial<Settings>) => onProfile((prev) => ({ ...prev, settings: { ...prev.settings, ...s } }))
  const [chest, setChest] = useState<string | null>(null)
  const chestNow = (viaAd: boolean) => {
    const open = () =>
      onProfile((p) => {
        const r = openChest(p)
        setChest(r.got)
        return viaAd ? r.profile : { ...r.profile, coins: r.profile.coins - CHEST_COST }
      })
    if (viaAd) rewardedAd('lawn-chest', { granted: (ok) => (ok ? open() : setChest('No ad available right now: buy a chest with coins instead.')) })
    else if (profile.coins >= CHEST_COST) open()
  }
  return (
    <>
      <h2 className="section-title">Controls</h2>
      <ul className="keys lw-keys">
        <li>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · mouse look · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> jump · <kbd>C</kbd> crouch
        </li>
        <li>
          <kbd>LMB</kbd> tap: light swing · hold: heavy swing · <kbd>RMB</kbd> block (umbrella for Walt) · parry by blocking as a heavy lands
        </li>
        <li>
          <kbd>G</kbd> / <kbd>MMB</kbd> throw · <kbd>E</kbd> use: barricade a door, place a trap, pick up a valuable, take a tool · <kbd>1</kbd>–<kbd>3</kbd> trap slot
        </li>
        <li>
          <kbd>F</kbd> lean a ladder against a wall (walk into it to climb) · <kbd>Q</kbd> ultimate · <kbd>Esc</kbd> release the mouse
        </li>
        <li>Gamepad: sticks move/look, RT light, RB heavy, LT block, A jump, X use, Y throw, B ladder, LB ultimate</li>
        <li>Touch: left stick moves, drag the right side to look, buttons for swings, block, jump, throw, use, ladder and the ultimate</li>
      </ul>
      <h2 className="section-title">Settings</h2>
      <div className="lw-settings">
        <label>
          Name
          <input value={profile.name} maxLength={12} onChange={(e) => onProfile((prev) => ({ ...prev, name: e.target.value.toUpperCase() || 'PLAYER' }))} />
        </label>
        <label>
          Graphics
          <select value={profile.settings.quality} onChange={(e) => setSettings({ quality: e.target.value as Settings['quality'] })} data-testid="lw-quality">
            <option value="auto">Auto ({resolveQuality('auto').tier})</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Look sensitivity {profile.settings.sensitivity.toFixed(1)}
          <input type="range" min={0.3} max={3} step={0.1} value={profile.settings.sensitivity} onChange={(e) => setSettings({ sensitivity: Number(e.target.value) })} />
        </label>
        <label>
          Field of view {profile.settings.fov}°
          <input type="range" min={65} max={100} step={1} value={profile.settings.fov} onChange={(e) => setSettings({ fov: Number(e.target.value) })} />
        </label>
        <label className="lw-check">
          <input type="checkbox" checked={profile.settings.invertY} onChange={(e) => setSettings({ invertY: e.target.checked })} /> Invert look
        </label>
        <label className="lw-check">
          <input type="checkbox" checked={profile.settings.shake} onChange={(e) => setSettings({ shake: e.target.checked })} /> Screen shake
        </label>
        <label className="lw-check">
          <input type="checkbox" checked={profile.settings.music} onChange={(e) => setSettings({ music: e.target.checked })} /> Music
        </label>
      </div>
      <h2 className="section-title">Cosmetic chest</h2>
      <div className="lw-chest">
        <button className="btn" onClick={() => chestNow(true)} data-testid="lw-chest-ad">
          <Gift size={16} /> Watch an ad: free chest
        </button>
        <button className="btn" disabled={profile.coins < CHEST_COST} onClick={() => chestNow(false)} data-testid="lw-chest-buy">
          <Sparkles size={16} /> Open a chest · {CHEST_COST} coins
        </button>
        {chest && <p className="notice">Chest opened: {chest}</p>}
      </div>
      <h2 className="section-title">How it plays</h2>
      <ul className="lw-rules">
        <li>
          <strong>Prep phase.</strong> Barricade your doors (two layers each), lay your three traps, and carry valuables to safer rooms. Your own doors always open for you.
        </li>
        <li>
          <strong>Raid.</strong> Only the tagged valuables score: TV, fridge, trophy case, aquarium, clock, piano, console, mower. Walls, windows and furniture break too, but for free.
        </li>
        <li>
          <strong>Ladders.</strong> Lean one against a wall under the balcony or the roof to skip the front door. Defenders can smash ladders.
        </li>
        <li>
          <strong>Chaos.</strong> Seagulls steal throwables, the ice-cream truck heals whoever reaches the cones, rain makes every lawn a slide.
        </li>
      </ul>
      <Credits />
    </>
  )
}

function Credits() {
  const [open, setOpen] = useState(false)
  const row = (c: (typeof MODEL_CREDITS)[number]) => (
    <li key={c.url + c.use}>
      <em>{c.use}</em>{' '}
      <a href={c.url} target="_blank" rel="noreferrer">
        {c.name}
      </a>{' '}
      by{' '}
      <a href={c.authorUrl} target="_blank" rel="noreferrer">
        {c.author}
      </a>
      ,{' '}
      <a href={c.licenceUrl} target="_blank" rel="noreferrer">
        {c.licence}
      </a>
    </li>
  )
  return (
    <div className="lw-credits">
      <h2 className="section-title">
        <button className="lw-creditsbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="lw-credits">
          Credits {open ? '−' : '+'}
        </button>
      </h2>
      <p className="muted small">The heroes, the dog, the robots, every prop and the house kit are original models made for this game; the houses, street, effects and sound are built in code. Hero animations come from a CC0 library.</p>
      {open && (
        <>
          <h3 className="lw-sub">Animations</h3>
          <ul className="lw-creditlist">{CHARACTER_CREDITS.map(row)}</ul>
          {MODEL_CREDITS.length > 0 && (
            <>
              <h3 className="lw-sub">Props</h3>
              <ul className="lw-creditlist">{MODEL_CREDITS.map(row)}</ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/* ---------- Stage ---------- */

function Stage(p: { launch: Launch; assets: LawnAssets | null; pct: number; profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void; onExit: (why?: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)
  const [status, setStatus] = useState('Loading the neighbourhood…')
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

  const lookKey = JSON.stringify([p.profile.name, p.profile.hero, p.profile.colours, p.profile.settings, p.profile.house])
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
          setStatus(p.launch.kind === 'host' ? 'Opening the street…' : 'Finding the street…')
          const { hostRoom, joinRoom } = await import('./engine/net')
          const link = p.launch.kind === 'host' ? await hostRoom() : await joinRoom(p.launch.code)
          if (cancelled) {
            link.close()
            return
          }
          net = { link, role: link.isHost ? 'host' : 'client' }
        }
        setStatus('Mowing the lawns…')
        const { Game } = await import('./engine/game')
        if (cancelled || !host.current) return
        const quality = resolveQuality(q.get('quality') === 'low' || q.get('quality') === 'medium' || q.get('quality') === 'high' ? (q.get('quality') as 'low') : profileRef.current.settings.quality)
        const lineup = q.get('lineup')?.split(',').filter((h): h is HeroId => HERO_IDS.includes(h as HeroId))
        const seed = q.get('seed') ? Number(q.get('seed')) : undefined
        game = new Game(host.current, { assets: p.assets!, profile: profileRef.current, quality, net: net ?? undefined, snap: q.has('snap'), autopilot: q.has('autopilot'), lineup, seed })
        gameRef.current = game
        game.onHud = setHud
        game.onResult = (_r, prof) => p.onProfile(prof)
        game.onDisconnect = (why) => onExit(why)
        if (q.has('snap') || q.get('net') === 'local' || q.has('autopilot')) (window as unknown as { __lawn: Game }).__lawn = game
        if (net?.role === 'client') game.hello()
        if (p.launch.kind === 'solo') game.startSolo(p.launch.mode, p.launch.map, p.launch.time)
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

  const statusText = useMemo(() => status, [status])
  return (
    <div className="racer-stage lw-stage">
      <div ref={host} className="racer-host lw-host" />
      {!ready && <Loader3D status="Loading the neighbourhood…" progress={p.pct} />}
      {ready && statusText && (
        <div className="vr-loading lw-loading">
          <img src={KEYART} alt="" />
          <span>{statusText}</span>
        </div>
      )}
      {hud && gameRef.current && <LawnHud hud={hud} game={gameRef.current} profile={p.profile} onProfile={p.onProfile} onQuit={() => onExit()} />}
      {!hud && ready && !statusText && (
        <div className="lw-wait">
          <Users size={18} /> Waiting for the host…
        </div>
      )}
    </div>
  )
}
