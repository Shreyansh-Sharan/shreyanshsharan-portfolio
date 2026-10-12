import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Mountain, Volume2, VolumeX } from 'lucide-react'
import { profile, skillTree, tiles, trophies, type Activity, type Tile } from '../data/content'
import { useActions, type Action } from '../lib/input'
import { isMuted, play, setMuted } from '../lib/sound'
import { navigate } from '../lib/router'
import { TileArt } from './TileArt'
import { accentVars } from '../lib/style'
import { HintBar } from './HintBar'

type Tab = Tile['tab']
type Zone = 'tabs' | 'tiles' | 'actions' | 'cards'

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Home' },
  { id: 'career', label: 'Career' },
  { id: 'showcase', label: 'Showcase' },
  { id: 'extras', label: 'Games' },
]

const TAB_IDS = TABS.map((t) => t.id)

function previewCards(tile: Tile): Activity[] {
  switch (tile.id) {
    case 'trophies':
      return trophies.slice(0, 4).map((t) => ({ title: t.name, detail: `${t.issuer} · ${t.kind}` }))
    case 'skill-tree':
      return skillTree.slice(0, 4).map((b) => ({ title: b.branch, detail: b.skills.slice(0, 4).join(' · ') }))
    case 'profile':
      return [
        { title: 'Role', detail: profile.headline },
        { title: 'Experience', detail: '8+ years · 30+ enterprise clients across Pharma, CPG/FMCG, Financial Services, Agriculture and Construction' },
        { title: 'Hobbies', detail: profile.hobbies.join(' · ') },
        { title: 'Education', detail: 'B.Tech, NIT Jalandhar' },
        { title: 'Based in', detail: profile.location },
      ]
    case 'arena':
      return [
        { title: 'Modes', detail: 'Solo vs up to 9 AI bots, or host an online match and invite friends with a code.' },
        { title: 'Powers', detail: 'Dash, double jump, overshield and a wall-piercing scan; health, shield, Overdrive and Haste pickups.' },
        { title: 'Weapons', detail: 'Pistol, SMG, assault rifle, bolt-action sniper and shotgun. Keys 1–5 or the wheel; hold right click to aim, scope in twice.' },
        { title: 'Maps', detail: 'Sandstorm (long doors, catwalk), Villa (curved lane, church square), Bazaar (sniper window, market), plus Dunes, Harbor Night and Frost Outpost.' },
      ]
    case 'volt-riot':
      return [
        { title: 'Power-ups', detail: 'Shunt, Barge, Bolt, Mine, Shock, Nitro, Shield, Repair, Railgun, Flak, Oil Slick and Ram, each with a forward and backward mode.' },
        { title: 'Modes', detail: 'A 3-lap Race against 7 AI rivals, a 4-track Combat Points series, or Deathmatch on any circuit or in the Dust Bowl arena.' },
        { title: 'Circuits', detail: 'Harbor Loop, Concrete River (storm channel and downtown), Gothic Quarter (cobbled old town and seafront) and Pier & Promenade, with hills, jumps and short cuts.' },
        { title: 'Progression', detail: 'Fan Points, Fan Runs and up to 5 Lights per event, saved in your browser.' },
        { title: 'Assets', detail: 'Eight custom 3D cars, street lamps, billboards, towers, cranes and hand-made textures.' },
      ]
    case 'bogey-brawl':
      return [
        { title: 'Holes', detail: 'Lakeside Bend (par 4), Rattlesnake Canyon (par 5, ramps and cactus), Frostbite Fjord (par 4, ice and wind) and Magma Isle (par 3, lava at night), or all four as a Tour.' },
        { title: 'Chaos', detail: 'Drive golf carts over rivals and their balls, and grab 17 items from briefcases: Orbital Laser, Tornado, Ball Swap, Banana Peel, Meteor and more. Random chaos events every 30 s.' },
        { title: 'Scoring', detail: 'First to hole out scores 100, plus par bonuses and knockouts. Unfinished at the end of overtime costs 50.' },
        { title: 'Assets', detail: 'A rigged golfer with run, idle and swing animations, plus rideable carts, cactus, neon towers, snowmen and a volcano.' },
      ]
    case 'plush-panic':
      return [
        { title: 'The Show', detail: 'Up to 16 toys (bots fill the gaps) play rounds that shrink the field, ending in a crown final. Knocked-out toys heckle from the peanut gallery.' },
        { title: 'Levels', detail: 'Cookie Cutter (trace a biscuit without cracking it), Music Box Freeze (move only while the tune plays) and Spinning Top Sumo (ride a ball off a shrinking stool).' },
        { title: 'Sabotage', detail: 'Crumb Flick, Table Slam, Milk Splash, Plate Swap, thumbtacks, magnets and Bubble Wrap. Grudges make revenge half price; awards for the Biggest Menace.' },
        { title: 'Online', detail: 'Host a room and share the code: the host runs the physics, friends join peer to peer. Walk round the Loft together between Shows.' },
      ]
    case 'sports-complex':
      return [
        { title: 'F1 circuit', detail: 'Drive through the career, one sector per role.' },
        { title: 'Stadium', detail: 'Score penalties to unlock achievements.' },
        { title: 'Rally hall', detail: 'Win badminton and table tennis points to unlock skills.' },
        { title: 'Hub', detail: 'Walk the landscaped complex as the low-poly avatar. Unlocks are saved in your browser.' },
      ]
    default:
      return tile.activities.slice(0, 4)
  }
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Tiles shown under a tab: the tab's own tiles, plus any tile that opts in via `alsoIn`. */
function tilesFor(tab: Tab) {
  const own = tiles.filter((t) => t.tab === tab)
  const shared = tiles.filter((t) => t.alsoIn === tab)
  return [...own, ...shared]
}

export function Home({
  initialTile,
  onAccent,
  onExplore,
}: {
  initialTile?: string
  onAccent: (a: [string, string], emblem: string) => void
  onExplore?: () => void
}) {
  const start = tiles.find((t) => t.id === initialTile) ?? tiles[0]
  const [tab, setTab] = useState<Tab>(start.tab)
  const [indexByTab, setIndexByTab] = useState<Record<Tab, number>>(() =>
    Object.fromEntries(TABS.map((t) => [t.id, t.id === start.tab ? Math.max(0, tilesFor(t.id).indexOf(start)) : 0])) as Record<Tab, number>,
  )
  const [zone, setZone] = useState<Zone>('tiles')
  const [actionIdx, setActionIdx] = useState(0)
  const [cardIdx, setCardIdx] = useState(0)
  const [muted, setMutedState] = useState(isMuted)
  const [toast, setToast] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const clock = useClock()

  const list = useMemo(() => tilesFor(tab), [tab])
  const index = Math.min(indexByTab[tab], list.length - 1)
  const tile = list[index]
  const cards = previewCards(tile)

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([])
  const actionRefs = useRef<(HTMLElement | null)[]>([])
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    onAccent(tile.accent, tile.id)
    window.history.replaceState(null, '', `#/home/${tile.id}`)
  }, [tile, onAccent])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  // Keep DOM focus on the highlighted element so keyboard, screen readers and scrolling all follow it.
  useEffect(() => {
    const el =
      zone === 'tabs'
        ? tabRefs.current[TABS.findIndex((t) => t.id === tab)]
        : zone === 'tiles'
          ? tileRefs.current[index]
          : zone === 'actions'
            ? actionRefs.current[actionIdx]
            : cardRefs.current[cardIdx]
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [zone, tab, index, actionIdx, cardIdx])

  const setIndex = (i: number) => setIndexByTab((prev) => ({ ...prev, [tab]: i }))

  const switchTab = (next: Tab) => {
    if (next === tab) return
    play('move')
    setTab(next)
    setCardIdx(0)
    setActionIdx(0)
  }

  // Step to the neighbouring tab (clamped at the ends).
  const stepTab = (dir: 1 | -1) => {
    const i = TAB_IDS.indexOf(tab)
    const next = TAB_IDS[Math.max(0, Math.min(TAB_IDS.length - 1, i + dir))]
    switchTab(next)
  }

  const runPrimary = (t: Tile = tile) => {
    const a = t.action
    switch (a.kind) {
      case 'hub':
        launch(`#/game/${t.id}`)
        break
      case 'route':
        play('select')
        navigate(a.to)
        break
      case 'iframe':
        play('select')
        navigate(`#/embed/${t.id}`)
        break
      case 'download':
        actionRefs.current[0]?.click()
        break
      case 'soon':
        play('back')
        setToast(`${t.title} is in development. Check back soon.`)
        break
    }
  }

  // Game-launch feel: the emblem rushes at the camera and the UI zooms away before the route changes.
  const launch = (to: string) => {
    if (launching) return
    play('select')
    setLaunching(true)
    window.dispatchEvent(new Event('emblem-launch'))
    window.setTimeout(() => navigate(to), 420)
  }

  const openQuickView = () => {
    play('select')
    navigate('#/resume')
  }

  const openCard = () => {
    if (tile.action.kind === 'hub') launch(`#/game/${tile.id}`)
    else runPrimary()
  }

  const step = (n: number, len: number, dir: 1 | -1) => Math.max(0, Math.min(len - 1, n + dir))

  useActions((action: Action) => {
    if (action === 'prevTab' || action === 'nextTab') {
      stepTab(action === 'nextTab' ? 1 : -1)
      return true
    }
    const horizontal = action === 'left' || action === 'right'
    const dir = action === 'right' ? 1 : -1

    switch (zone) {
      case 'tabs':
        if (horizontal) stepTab(dir)
        else if (action === 'down' || action === 'confirm') setZone('tiles')
        else if (action === 'back') setZone('tiles')
        else return false
        return true
      case 'tiles':
        if (horizontal) {
          const next = step(index, list.length, dir)
          if (next !== index) {
            setIndex(next)
            setCardIdx(0)
            setActionIdx(0)
            play('move')
          }
        } else if (action === 'up') setZone('tabs')
        else if (action === 'down') setZone('actions')
        else if (action === 'confirm') runPrimary()
        else return false
        return true
      case 'actions':
        if (horizontal) setActionIdx((i) => step(i, 2, dir))
        else if (action === 'up' || action === 'back') setZone('tiles')
        else if (action === 'down' && cards.length) setZone('cards')
        else if (action === 'confirm') {
          if (actionIdx === 0) runPrimary()
          else openQuickView()
        } else return action === 'down'
        return true
      case 'cards':
        if (horizontal) setCardIdx((i) => step(i, cards.length, dir))
        else if (action === 'up') setZone('actions')
        else if (action === 'back') setZone('tiles')
        else if (action === 'confirm') openCard()
        else return action === 'down'
        return true
    }
  })

  const primaryLabel = tile.action.kind === 'hub' ? 'Play' : tile.action.label

  return (
    <div className={`home ${launching ? 'is-launching' : ''}`} style={accentVars(tile.accent)}>
      <header className="topbar">
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              className={`tab ${t.id === tab ? 'is-active' : ''} ${zone === 'tabs' && t.id === tab ? 'is-focused' : ''}`}
              aria-pressed={t.id === tab}
              onClick={() => {
                switchTab(t.id)
                setZone('tiles')
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {onExplore && (
            <button className="pill pill-explore" onClick={onExplore} title="Explore the open world (⌘K / Ctrl+K)">
              <Mountain size={16} /> <span className="hide-sm">Explore world</span> <kbd className="hide-sm">⌘K</kbd>
            </button>
          )}
          <button className="pill" onClick={openQuickView}>
            <FileText size={16} /> <span className="hide-sm">Quick View</span>
          </button>
          <button
            className="icon-btn"
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            onClick={() => {
              setMuted(!muted)
              setMutedState(!muted)
            }}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="avatar" aria-label="Player profile" onClick={() => navigate('#/profile')}>
            {profile.initials}
          </button>
          <span className="clock hide-sm">{clock}</span>
        </div>
      </header>

      <div className="tile-row" role="listbox" aria-label={`${tab} tiles`}>
        {list.map((t, i) => (
          <Fragment key={t.id}>
            <button
              ref={(el) => {
                tileRefs.current[i] = el
              }}
              role="option"
              aria-selected={i === index}
              aria-label={`${t.title}: ${t.tagline}`}
              className={`tile ${i === index ? 'is-selected' : ''} ${i === index && zone === 'tiles' ? 'is-focused' : ''}`}
              onClick={() => {
                if (i === index) runPrimary(t)
                else {
                  setIndex(i)
                  setCardIdx(0)
                  setActionIdx(0)
                  play('move')
                }
                setZone('tiles')
              }}
            >
              <TileArt tile={t} variant="tile" />
            </button>
            {i === index && <span className="tile-label">{t.title}</span>}
          </Fragment>
        ))}
      </div>

      <section className="hero" key={tile.id} aria-live="polite">
        <div className="hero-info">
          <div className="hero-meta">
            <span className="genre">{tile.genre}</span>
            <span>{tile.period}</span>
          </div>
          <h1 className="hero-title">
            {tile.title}
            <span className="hero-tagline">{tile.tagline}</span>
          </h1>
          <p className="hero-org">{tile.org}</p>
          <p className="hero-blurb">{tile.blurb}</p>
          <div className="hero-actions">
            {tile.action.kind === 'download' ? (
              <a
                ref={(el) => {
                  actionRefs.current[0] = el
                }}
                className={`btn btn-primary ${zone === 'actions' && actionIdx === 0 ? 'is-focused' : ''}`}
                href={tile.action.href}
                download
                onClick={() => play('select')}
              >
                {primaryLabel}
              </a>
            ) : (
              <button
                ref={(el) => {
                  actionRefs.current[0] = el
                }}
                className={`btn btn-primary ${zone === 'actions' && actionIdx === 0 ? 'is-focused' : ''} ${
                  tile.action.kind === 'soon' ? 'is-muted' : ''
                }`}
                onClick={() => {
                  setZone('actions')
                  setActionIdx(0)
                  runPrimary()
                }}
              >
                {primaryLabel}
              </button>
            )}
            <button
              ref={(el) => {
                actionRefs.current[1] = el
              }}
              className={`btn btn-secondary ${zone === 'actions' && actionIdx === 1 ? 'is-focused' : ''}`}
              onClick={openQuickView}
            >
              <FileText size={16} /> Quick View
            </button>
          </div>
        </div>
        <div className="hero-key">
          <TileArt tile={tile} variant="key" />
        </div>
      </section>

      {cards.length > 0 && (
        <section className="cards" aria-label="Highlights">
          <h2 className="cards-title">{tile.tab === 'career' && tile.id !== 'profile' ? 'Activities' : 'Preview'}</h2>
          <div className="card-row">
            {cards.map((c, i) => (
              <button
                key={c.title}
                style={{ animationDelay: `${120 + i * 70}ms` }}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
                className={`card ${zone === 'cards' && i === cardIdx ? 'is-focused' : ''}`}
                onClick={() => {
                  setZone('cards')
                  setCardIdx(i)
                  openCard()
                }}
              >
                <span className="card-title">{c.title}</span>
                <span className="card-detail">{c.detail}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <HintBar
        hints={[
          ['← → ↑ ↓', 'Navigate'],
          ['Enter', 'Open'],
          ['Q / E', 'Switch tab'],
          ['Esc', 'Back'],
        ]}
      />
    </div>
  )
}
