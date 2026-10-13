// The console-style home screen: a top bar (tabs, search, settings, avatar, clock), a row of square tiles, the
// selected tile's key art full-bleed behind its title and actions, and info cards along the bottom. Arrow keys, a
// gamepad, swipes and the mouse wheel move between tiles; Enter runs the primary action.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Briefcase,
  Ellipsis,
  Gamepad2,
  LayoutGrid,
  ListChecks,
  Search,
  Settings,
  Sparkles,
  Trophy,
  User,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { profile, tiles, type Tile } from '../data/content'
import { GAME_INFO, HOME_TABS, homeTabFor, missionsDone, previewCards, readProgress, tileKind, tilesForTab, type HomeTab } from '../data/home'
import { useActions, type Action } from '../lib/input'
import { isMuted, play, setMuted } from '../lib/sound'
import { isLowGraphics, setLowGraphics } from '../lib/graphics'
import { setPrefs, usePrefs } from '../lib/prefs'
import { navigate } from '../lib/router'
import { openGame } from '../data/gameLinks'
import { accentVars } from '../lib/style'
import { world } from '../world/store'
import { TileRow } from './home/TileRow'
import { HeroBackdrop } from './home/HeroBackdrop'
import { preloadHeroes } from '../lib/art'
import { tileActions, type HomeAction } from './home/actions'
import { HintBar } from './HintBar'
import './home/home.css'

type Zone = 'top' | 'tiles' | 'actions' | 'cards'

const TAB_ICONS: Record<HomeTab, LucideIcon> = { games: Gamepad2, career: Briefcase, showcase: Sparkles, profile: User }
// Top bar items after the tabs.
const TOP_EXTRA = ['search', 'settings', 'avatar'] as const

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(id)
  }, [])
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD')
function searchTiles(q: string): Tile[] {
  const words = norm(q).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return tiles.filter((t) => {
    const hay = norm([t.title, t.tagline, t.genre, t.org, t.blurb, ...(t.stack ?? [])].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

export function Home({
  initialTile,
  onAccent,
  canExplore,
}: {
  initialTile?: string
  onAccent: (a: [string, string], emblem: string) => void
  canExplore: boolean
}) {
  const start = tiles.find((t) => t.id === initialTile)
  const [tab, setTab] = useState<HomeTab>(() => (start ? homeTabFor(start.id) : 'games'))
  const [indexByTab, setIndexByTab] = useState<Record<HomeTab, number>>(() => {
    const out = { games: 0, career: 0, showcase: 0, profile: 0 }
    if (start) out[homeTabFor(start.id)] = Math.max(0, tilesForTab(homeTabFor(start.id)).findIndex((t) => t.id === start.id))
    return out
  })
  const [query, setQuery] = useState<string | null>(null)
  const [searchIndex, setSearchIndex] = useState(0)
  const [zone, setZone] = useState<Zone>('tiles')
  const [topIdx, setTopIdx] = useState(0)
  const [actionIdx, setActionIdx] = useState(0)
  const [cardIdx, setCardIdx] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [artView, setArtView] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const prefs = usePrefs()
  const clock = useClock()

  const searching = query !== null && query.trim() !== ''
  const list = useMemo(() => (searching ? searchTiles(query!) : tilesForTab(tab)), [searching, query, tab])
  const index = Math.max(0, Math.min(searching ? searchIndex : indexByTab[tab], list.length - 1))
  const tile: Tile | undefined = list[index]

  const topRefs = useRef<(HTMLElement | null)[]>([])
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([])
  const actionRefs = useRef<(HTMLElement | null)[]>([])
  const cardRefs = useRef<(HTMLElement | null)[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tile) return
    onAccent(tile.accent, tile.id)
    window.history.replaceState(null, '', `#/home/${tile.id}`)
  }, [tile, onAccent])

  useEffect(() => preloadHeroes(list, index), [list, index])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(id)
  }, [toast])

  const select = (i: number) => {
    if (i === index || !list[i]) return
    play('move')
    if (searching) setSearchIndex(i)
    else setIndexByTab((prev) => ({ ...prev, [tab]: i }))
    setActionIdx(0)
    setCardIdx(0)
    setMenuOpen(false)
  }

  const switchTab = (next: HomeTab) => {
    setQuery(null)
    if (next === tab) return
    play('move')
    setTab(next)
    setActionIdx(0)
    setCardIdx(0)
    setMenuOpen(false)
  }

  const go = (to: string, zoom = false) => {
    if (launching) return
    play('select')
    if (!zoom || document.documentElement.classList.contains('reduce-motion')) return navigate(to)
    setLaunching(true)
    window.setTimeout(() => navigate(to), 380)
  }

  const explore = canExplore
    ? (tileId: string) => {
        play('select')
        world.set({ arrive: tileId, requestPlay: true })
      }
    : undefined

  const share = async (t: Tile) => {
    const url = `${window.location.origin}${window.location.pathname}#/home/${t.id}`
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: `${t.title} · ${profile.name}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setToast('Link copied to the clipboard')
    } catch {
      setToast(url)
    }
  }

  const acts = tile
    ? tileActions(tile, {
        go,
        open: (url) => {
          play('select')
          openGame(url)
        },
        explore,
        share,
        viewArt: () => {
          setMenuOpen(false)
          setArtView(true)
        },
      })
    : null
  // Action buttons in order: primary, secondary, "...".
  const actionCount = acts ? (acts.secondary ? 3 : 2) : 0
  const cards = tile ? infoCards(tile) : []

  // Keep DOM focus on the highlighted element so keyboard, screen readers and the focus ring all follow it.
  useEffect(() => {
    if (menuOpen || settingsOpen || artView) return
    const el =
      zone === 'top' ? topRefs.current[topIdx] : zone === 'tiles' ? tileRefs.current[index] : zone === 'actions' ? actionRefs.current[actionIdx] : cardRefs.current[cardIdx]
    el?.focus({ preventScroll: true })
    if (zone === 'cards') el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [zone, topIdx, index, actionIdx, cardIdx, menuOpen, settingsOpen, artView, tab, searching])

  // The mouse wheel anywhere on the screen (outside the panels) steps through the tiles too.
  const wheel = useRef({ at: 0, acc: 0 })
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.ps-row, .ps-cards, .ps-menu, .ps-settings, .ps-search')) return
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const now = performance.now()
      if (now - wheel.current.at > 300) wheel.current.acc = 0
      wheel.current.acc += d
      if (Math.abs(wheel.current.acc) >= 60 && now - wheel.current.at > 160) {
        el.dispatchEvent(new CustomEvent('ps-step', { detail: Math.sign(wheel.current.acc) }))
        wheel.current.acc = 0
        wheel.current.at = now
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const stepRef = useRef((d: number) => select(index + d))
  useEffect(() => {
    stepRef.current = (d: number) => select(index + d)
  })
  useEffect(() => {
    const el = rootRef.current
    const on = (e: Event) => stepRef.current((e as CustomEvent<number>).detail)
    el?.addEventListener('ps-step', on)
    return () => el?.removeEventListener('ps-step', on)
  }, [])

  const topCount = HOME_TABS.length + TOP_EXTRA.length
  const clamp = (n: number, len: number) => Math.max(0, Math.min(len - 1, n))

  useActions((action: Action) => {
    if (action === 'prevTab' || action === 'nextTab') {
      const i = HOME_TABS.findIndex((t) => t.id === tab)
      switchTab(HOME_TABS[clamp(i + (action === 'nextTab' ? 1 : -1), HOME_TABS.length)].id)
      setZone('tiles')
      return true
    }
    const dir = action === 'right' ? 1 : -1
    const horizontal = action === 'left' || action === 'right'
    switch (zone) {
      case 'top':
        if (horizontal) {
          const next = clamp(topIdx + dir, topCount)
          setTopIdx(next)
          if (next < HOME_TABS.length) switchTab(HOME_TABS[next].id)
          play('move')
        } else if (action === 'down' || action === 'back') setZone('tiles')
        else if (action === 'confirm') topRefs.current[topIdx]?.click()
        else return false
        return true
      case 'tiles':
        if (horizontal) select(clamp(index + dir, list.length))
        else if (action === 'up') {
          setTopIdx(searching ? HOME_TABS.length : Math.max(0, HOME_TABS.findIndex((t) => t.id === tab)))
          setZone('top')
        } else if (action === 'down' && tile) setZone('actions')
        else if (action === 'confirm') actionRefs.current[0]?.click()
        else if (action === 'back' && query !== null) setQuery(null)
        else return false
        return true
      case 'actions':
        if (horizontal) setActionIdx((i) => clamp(i + dir, actionCount))
        else if (action === 'up' || action === 'back') setZone('tiles')
        else if (action === 'down' && cards.length) setZone('cards')
        else if (action === 'confirm') actionRefs.current[actionIdx]?.click()
        else return action === 'down'
        return true
      case 'cards':
        if (horizontal) setCardIdx((i) => clamp(i + dir, cards.length))
        else if (action === 'up') setZone('actions')
        else if (action === 'back') setZone('tiles')
        else if (action === 'confirm') cardRefs.current[cardIdx]?.click()
        else return action === 'down'
        return true
    }
  })

  const openSearch = () => {
    play('select')
    setQuery((q) => q ?? '')
    setSearchIndex(0)
    setTopIdx(HOME_TABS.length)
    setZone('top')
  }

  const kind = tile ? tileKind(tile) : 'game'
  const [doneMissions] = useState(missionsDone)

  const tabButtons = (where: 'top' | 'bottom') =>
    HOME_TABS.map((t, i) => {
      const Icon = TAB_ICONS[t.id]
      const active = !searching && t.id === tab
      return (
        <button
          key={t.id}
          ref={
            where === 'top'
              ? (el) => {
                  topRefs.current[i] = el
                }
              : undefined
          }
          className={`ps-tab ${active ? 'is-active' : ''} ${where === 'top' && zone === 'top' && topIdx === i ? 'is-focused' : ''}`}
          aria-current={active ? 'page' : undefined}
          onFocus={where === 'top' ? () => {
            setZone('top')
            setTopIdx(i)
          } : undefined}
          onClick={() => {
            switchTab(t.id)
            setTopIdx(i)
            setZone('tiles')
          }}
        >
          {where === 'bottom' && <Icon size={20} aria-hidden="true" />}
          <span>{t.label}</span>
        </button>
      )
    })

  const renderAction = (a: HomeAction, i: number, cls: string) => {
    const common = {
      ref: (el: HTMLElement | null) => {
        actionRefs.current[i] = el
      },
      className: `ps-btn ${cls} ${zone === 'actions' && actionIdx === i ? 'is-focused' : ''}`,
      onFocus: () => {
        setZone('actions')
        setActionIdx(i)
      },
    }
    const Icon = a.icon
    const body = (
      <>
        <Icon size={18} aria-hidden="true" />
        <span>{a.label}</span>
      </>
    )
    if (a.href)
      return (
        <a key={a.id} {...common} href={a.href} download={a.download || undefined} target={a.external ? '_blank' : undefined} rel={a.external ? 'noreferrer' : undefined} onClick={() => play('select')}>
          {body}
        </a>
      )
    return (
      <button key={a.id} {...common} onClick={a.run}>
        {body}
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className={`ps-home kind-${kind} ${launching ? 'is-launching' : ''} ${artView ? 'is-art-view' : ''} ${searching ? 'is-searching' : ''}`}
      style={tile ? accentVars(tile.accent) : undefined}
    >
      {tile && <HeroBackdrop tile={tile} hidden={prefs.backdrop === 'world'} />}
      <div className="ps-scrim" aria-hidden="true" />

      <header className="ps-top">
        <span className="ps-top-title" aria-hidden="true">
          {searching ? 'Results' : HOME_TABS.find((t) => t.id === tab)?.label}
        </span>
        <nav className="ps-tabs" aria-label="Sections">
          {tabButtons('top')}
          {searching && <span className="ps-tab is-active ps-tab-results">Results</span>}
        </nav>
        <div className="ps-top-right">
          {query !== null ? (
            <div className="ps-search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={(el) => {
                  topRefs.current[HOME_TABS.length] = el
                }}
                type="search"
                value={query}
                placeholder="Search games, roles, skills"
                aria-label="Search tiles"
                autoFocus
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSearchIndex(0)
                }}
                onFocus={() => {
                  setZone('top')
                  setTopIdx(HOME_TABS.length)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setQuery(null)
                    setZone('tiles')
                  } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault()
                    setZone('tiles')
                  }
                }}
              />
              <button
                className="ps-icon-btn ps-search-close"
                aria-label="Close search"
                onClick={() => {
                  setQuery(null)
                  setZone('tiles')
                }}
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              ref={(el) => {
                topRefs.current[HOME_TABS.length] = el
              }}
              className={`ps-icon-btn ${zone === 'top' && topIdx === HOME_TABS.length ? 'is-focused' : ''}`}
              aria-label="Search"
              onFocus={() => {
                setZone('top')
                setTopIdx(HOME_TABS.length)
              }}
              onClick={openSearch}
            >
              <Search size={20} />
            </button>
          )}
          <button
            ref={(el) => {
              topRefs.current[HOME_TABS.length + 1] = el
            }}
            className={`ps-icon-btn ${zone === 'top' && topIdx === HOME_TABS.length + 1 ? 'is-focused' : ''}`}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            onFocus={() => {
              setZone('top')
              setTopIdx(HOME_TABS.length + 1)
            }}
            onClick={() => {
              play('select')
              setSettingsOpen(true)
            }}
          >
            <Settings size={20} />
          </button>
          <button
            ref={(el) => {
              topRefs.current[HOME_TABS.length + 2] = el
            }}
            className={`ps-avatar ${zone === 'top' && topIdx === HOME_TABS.length + 2 ? 'is-focused' : ''}`}
            aria-label={`${profile.name}: open the player profile`}
            onFocus={() => {
              setZone('top')
              setTopIdx(HOME_TABS.length + 2)
            }}
            onClick={() => go('#/profile')}
          >
            <img src="home/tiles/profile.webp" alt="" />
            <span className="ps-avatar-dot" aria-hidden="true" />
          </button>
          <span className="ps-clock" aria-label={`Time ${clock}`}>
            {clock}
          </span>
        </div>
      </header>

      {list.length > 0 ? (
        <TileRow
          tiles={list}
          index={index}
          focused={zone === 'tiles'}
          label={searching ? 'Search results' : `${HOME_TABS.find((t) => t.id === tab)?.label} tiles`}
          onSelect={(i) => {
            select(i)
            setZone('tiles')
          }}
          onActivate={() => actionRefs.current[0]?.click()}
          tileRef={(i, el) => {
            tileRefs.current[i] = el
          }}
        />
      ) : (
        <div className="ps-row ps-row-empty" role="status">
          No tiles match “{query}”. Try a game, a role or a skill.
        </div>
      )}

      {tile && acts && (
        <section className="ps-info" key={tile.id} aria-labelledby="ps-title">
          <p className="ps-meta">
            <span className="ps-chip">{kindLabel(kind)}</span>
            <span>{tile.genre}</span>
            <span aria-hidden="true">·</span>
            <span>{tile.period}</span>
          </p>
          <h1 className="ps-title" id="ps-title">
            {tile.title}
          </h1>
          <p className="ps-tagline">{tile.tagline}</p>
          <p className="ps-blurb">{tile.blurb}</p>
          <div className="ps-actions">
            {renderAction(acts.primary, 0, 'ps-btn-primary')}
            {acts.secondary && renderAction(acts.secondary, 1, 'ps-btn-secondary')}
            <div className="ps-more-wrap">
              <button
                ref={(el) => {
                  actionRefs.current[actionCount - 1] = el
                }}
                className={`ps-btn ps-btn-more ${zone === 'actions' && actionIdx === actionCount - 1 ? 'is-focused' : ''}`}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onFocus={() => {
                  setZone('actions')
                  setActionIdx(actionCount - 1)
                }}
                onClick={() => {
                  play('select')
                  setMenuOpen((o) => !o)
                }}
              >
                <Ellipsis size={22} />
              </button>
              {menuOpen && (
                <ActionMenu
                  items={acts.menu}
                  onClose={() => {
                    setMenuOpen(false)
                    actionRefs.current[actionCount - 1]?.focus({ preventScroll: true })
                  }}
                />
              )}
            </div>
          </div>
        </section>
      )}

      {tile && cards.length > 0 && (
        <section className="ps-cards" aria-label={`${tile.title} details`} key={`cards-${tile.id}`}>
          {cards.map((c, i) => {
            const Icon = c.icon
            return (
              <button
                key={c.title}
                ref={(el) => {
                  cardRefs.current[i] = el
                }}
                className={`ps-card ${c.wide ? 'is-wide' : ''} ${zone === 'cards' && cardIdx === i ? 'is-focused' : ''}`}
                style={{ animationDelay: `${80 + i * 50}ms` }}
                onFocus={() => {
                  setZone('cards')
                  setCardIdx(i)
                }}
                onClick={() => {
                  if (kind === 'game' || kind === 'career' || tile.action.kind === 'iframe') go(`#/game/${tile.id}`)
                  else actionRefs.current[0]?.click()
                }}
              >
                <span className="ps-card-head">
                  <Icon size={16} aria-hidden="true" />
                  {c.title}
                </span>
                {c.body(doneMissions)}
              </button>
            )
          })}
        </section>
      )}

      <nav className="ps-bottom-tabs" aria-label="Sections">
        {tabButtons('bottom')}
      </nav>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => {
            setSettingsOpen(false)
            setZone('top')
            setTopIdx(HOME_TABS.length + 1)
          }}
        />
      )}

      {artView && tile && <ArtViewer tile={tile} onClose={() => setArtView(false)} />}

      {toast && (
        <div className="ps-toast" role="status">
          {toast}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {tile ? `${tile.title}. ${tile.tagline}.` : ''}
      </div>

      <HintBar
        hints={[
          ['← →', 'Tiles'],
          ['↑ ↓', 'Menus'],
          ['Enter', acts?.primary.label ?? 'Open'],
          ['Q / E', 'Tabs'],
        ]}
      />
    </div>
  )
}

function kindLabel(kind: ReturnType<typeof tileKind>) {
  return kind === 'game' ? 'Game' : kind === 'career' ? 'Career' : kind === 'showcase' ? 'Showcase' : 'Profile'
}

interface InfoCard {
  title: string
  icon: LucideIcon
  wide?: boolean
  body: (done: string[]) => ReactNode
}

/** The cards along the bottom: progress, modes and controls for a game; role, highlights and skills for a career chapter. */
function infoCards(tile: Tile): InfoCard[] {
  const kind = tileKind(tile)
  const mission = (done: string[]) =>
    done.includes(tile.id) ? <span className="ps-card-foot is-done">Open-world beacon complete</span> : null

  if (kind === 'game') {
    const info = GAME_INFO[tile.id]
    const cards: InfoCard[] = [
      {
        title: 'Progress',
        icon: Trophy,
        body: (done) => {
          const p = readProgress(tile.id)
          return (
            <>
              <span className="ps-card-value">{p ? p.value : 'Not started'}</span>
              <span className="ps-card-detail">{p ? p.detail : 'Play to start earning. Progress is saved in this browser.'}</span>
              {p?.pct != null && (
                <span className="ps-bar" role="img" aria-label={`${p.pct}% win rate`}>
                  <span style={{ transform: `scaleX(${p.pct / 100})` }} />
                </span>
              )}
              {mission(done)}
            </>
          )
        },
      },
    ]
    if (info)
      cards.push(
        {
          title: 'Modes',
          icon: LayoutGrid,
          body: () => (
            <>
              <span className="ps-card-detail is-strong">{info.modes}</span>
              <span className="ps-card-detail">
                <Users size={13} aria-hidden="true" /> {info.players}
              </span>
            </>
          ),
        },
        {
          title: 'How to play',
          icon: Gamepad2,
          wide: true,
          body: () => <span className="ps-card-detail">{info.howTo}</span>,
        },
      )
    const feature = previewCards(tile)[0]
    if (feature)
      cards.push({
        title: feature.title,
        icon: Sparkles,
        wide: true,
        body: () => <span className="ps-card-detail">{feature.detail}</span>,
      })
    return cards
  }

  if (kind === 'career' || tile.action.kind === 'iframe') {
    const [company, rolePart] = tile.org.includes(' · ') ? tile.org.split(' · ') : [tile.org, tile.genre]
    // A one-word label ("Product") says less than the chapter's genre.
    const role = rolePart.includes(' ') ? rolePart : tile.genre
    const highlights =
      tile.stats.length >= 2
        ? tile.stats.slice(0, 3).map((s) => `${s.value} ${s.label}`)
        : tile.achievements?.length
          ? tile.achievements.slice(0, 3)
          : tile.activities.slice(0, 3).map((a) => a.title)
    const skills = tile.stack ?? []
    const cards: InfoCard[] = [
      {
        title: kind === 'career' ? 'Role' : 'Product',
        icon: Briefcase,
        body: (done) => (
          <>
            <span className="ps-card-value is-small">{role}</span>
            <span className="ps-card-detail">
              {company} · {tile.period}
            </span>
            {mission(done)}
          </>
        ),
      },
      {
        title: 'Highlights',
        icon: ListChecks,
        wide: true,
        body: () => (
          <ul className="ps-card-list">
            {highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ),
      },
    ]
    if (skills.length)
      cards.push({
        title: 'Skills',
        icon: Wrench,
        wide: true,
        body: () => (
          <span className="ps-chips">
            {skills.slice(0, 6).map((s) => (
              <span className="ps-skill" key={s}>
                {s}
              </span>
            ))}
          </span>
        ),
      })
    return cards
  }

  return previewCards(tile)
    .slice(0, 4)
    .map((c, i) => ({
      title: c.title,
      icon: i === 0 ? Sparkles : ListChecks,
      wide: i > 0,
      body: () => <span className="ps-card-detail">{c.detail}</span>,
    }))
}

/** The "..." menu: arrows move, Enter picks, Esc closes. */
function ActionMenu({ items, onClose }: { items: HomeAction[]; onClose: () => void }) {
  const [i, setI] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    refs.current[i]?.focus({ preventScroll: true })
  }, [i])
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.ps-more-wrap')) onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])
  useActions((a) => {
    if (a === 'up' || a === 'down') {
      setI((k) => (k + (a === 'down' ? 1 : -1) + items.length) % items.length)
      play('move')
    } else if (a === 'back' || a === 'left' || a === 'right') {
      play('back')
      onClose()
    } else if (a === 'confirm') refs.current[i]?.click()
    else return false
    return true
  })
  return (
    <div className="ps-menu" role="menu" aria-label="More options">
      {items.map((m, k) => {
        const Icon = m.icon
        const props = {
          ref: (el: HTMLElement | null) => {
            refs.current[k] = el
          },
          role: 'menuitem',
          className: `ps-menu-item ${k === i ? 'is-focused' : ''}`,
          onFocus: () => setI(k),
        }
        const body = (
          <>
            <Icon size={17} aria-hidden="true" /> {m.label}
          </>
        )
        return m.href ? (
          <a key={m.id} {...props} href={m.href} download={m.download || undefined} target={m.external ? '_blank' : undefined} rel={m.external ? 'noreferrer' : undefined} onClick={() => onClose()}>
            {body}
          </a>
        ) : (
          <button
            key={m.id}
            {...props}
            onClick={() => {
              onClose()
              m.run?.()
            }}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}

/** Graphics, sound, motion and backdrop settings. */
function SettingsPanel({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs()
  const [muted, setMutedState] = useState(isMuted)
  const lowGfx = isLowGraphics()
  const [row, setRow] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])

  const rows: { id: string; label: string; note?: string; options: [string, string]; value: 0 | 1; set: (v: 0 | 1) => void }[] = [
    {
      id: 'gfx',
      label: 'Graphics',
      note: 'Low is lighter on older laptops. Changing it reloads the page.',
      options: ['High', 'Low'],
      value: lowGfx ? 1 : 0,
      set: (v) => {
        if ((v === 1) === lowGfx) return
        setLowGraphics(v === 1)
        window.location.reload()
      },
    },
    {
      id: 'sound',
      label: 'Sound',
      options: ['On', 'Off'],
      value: muted ? 1 : 0,
      set: (v) => {
        setMuted(v === 1)
        setMutedState(v === 1)
      },
    },
    {
      id: 'motion',
      label: 'Reduced motion',
      note: 'Cuts the zooms and fades on this screen.',
      options: ['Off', 'On'],
      value: prefs.reduceMotion ? 1 : 0,
      set: (v) => setPrefs({ reduceMotion: v === 1 }),
    },
    {
      id: 'backdrop',
      label: 'Backdrop',
      note: 'Show the key art, or the live open-world fly-over.',
      options: ['Key art', 'Live world'],
      value: prefs.backdrop === 'world' ? 1 : 0,
      set: (v) => setPrefs({ backdrop: v === 1 ? 'world' : 'art' }),
    },
  ]

  useEffect(() => {
    refs.current[row]?.focus({ preventScroll: true })
  }, [row])

  useActions((a) => {
    if (a === 'up' || a === 'down') {
      setRow((r) => Math.max(0, Math.min(rows.length, r + (a === 'down' ? 1 : -1))))
      play('move')
    } else if ((a === 'left' || a === 'right' || a === 'confirm') && row < rows.length) {
      const r = rows[row]
      r.set(a === 'confirm' ? (r.value === 1 ? 0 : 1) : a === 'right' ? 1 : 0)
      play('move')
    } else if (a === 'confirm') onClose()
    else if (a === 'back') {
      play('back')
      onClose()
    } else return false
    return true
  })

  return (
    <div className="ps-settings-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ps-settings" role="dialog" aria-modal="true" aria-labelledby="ps-settings-title">
        <h2 id="ps-settings-title">
          <Settings size={18} aria-hidden="true" /> Settings
        </h2>
        {rows.map((r, k) => (
          <div className={`ps-set-row ${row === k ? 'is-focused' : ''}`} key={r.id}>
            <div className="ps-set-text">
              <span className="ps-set-label" id={`ps-set-${r.id}`}>
                {r.label}
              </span>
              {r.note && <span className="ps-set-note">{r.note}</span>}
            </div>
            <div
              className="ps-seg"
              role="radiogroup"
              aria-labelledby={`ps-set-${r.id}`}
              ref={(el) => {
                refs.current[k] = el
              }}
              tabIndex={-1}
            >
              {r.options.map((o, v) => (
                <button
                  key={o}
                  role="radio"
                  aria-checked={r.value === v}
                  className={r.value === v ? 'is-on' : ''}
                  onClick={() => {
                    setRow(k)
                    r.set(v as 0 | 1)
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          className={`ps-btn ps-btn-secondary ps-set-done ${row === rows.length ? 'is-focused' : ''}`}
          ref={(el) => {
            refs.current[rows.length] = el
          }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  )
}

/** The key art on its own, UI hidden; any button returns. */
function ArtViewer({ tile, onClose }: { tile: Tile; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  useActions(() => {
    onClose()
    return true
  })
  return (
    <button ref={ref} className="ps-art-view" onClick={onClose} aria-label={`${tile.title} key art. Press any button to return.`}>
      <span className="ps-art-hint">
        {tile.title} · press any button to return
      </span>
    </button>
  )
}
