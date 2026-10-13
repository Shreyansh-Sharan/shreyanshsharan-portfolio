// DOM panels over the world: the arcade's game tiles (the PS5-style hub, in-world), the exhibit reader, the
// airship's destination board and the 3D-model credits.
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Gamepad2, MapPin, Play, X } from 'lucide-react'
import { tiles, type Tile } from '../data/content'
import { TileRow } from '../components/home/TileRow'
import { HeroBackdrop } from '../components/home/HeroBackdrop'
import { accentVars } from '../lib/style'
import { externalGameUrl, openGame } from '../data/gameLinks'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { regionForTile } from './regions'
import { GAME_IDS } from './exhibits'
import { airshipStops } from './interact'
import { sail } from './rides'
import { MODEL_CREDITS } from './credits'
import { teleportTo } from './travel'
import { world, useWorld } from './store'

type Section = 'games' | 'districts' | 'profile'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'games', label: 'Games' },
  { id: 'districts', label: 'Districts' },
  { id: 'profile', label: 'Profile' },
]

const isGame = (t: Tile) => GAME_IDS.includes(t.id)
function tilesFor(section: Section): Tile[] {
  switch (section) {
    case 'games':
      return GAME_IDS.map((id) => tiles.find((t) => t.id === id)).filter((t): t is Tile => !!t)
    case 'districts':
      return tiles.filter((t) => t.tab === 'career' && t.id !== 'profile')
    case 'profile':
      return tiles.filter((t) => t.tab === 'profile' || t.id === 'trophies' || t.id === 'skill-tree').filter((t, i, a) => a.findIndex((u) => u.id === t.id) === i)
  }
}

/** Blink to a tile's spot: its cabinet, the stadium gate, its plaque or board (see travel.ts). */
const fastTravel = teleportTo

function primaryFor(tile: Tile): { label: string; icon: 'play' | 'pin' | 'link'; run: () => void } {
  if (isGame(tile)) {
    const url = externalGameUrl(tile.id)
    if (url) return { label: 'Play Game', icon: 'link', run: () => openGame(url) }
    if (tile.action.kind === 'route') {
      const to = tile.action.to
      return { label: 'Play Game', icon: 'play', run: () => navigate(to) }
    }
    if (tile.action.kind === 'iframe') {
      const url = tile.action.url
      return { label: tile.action.label, icon: 'link', run: () => openGame(url) }
    }
  }
  if (tile.id === 'resume' && tile.action.kind === 'download') {
    const href = tile.action.href
    return { label: tile.action.label, icon: 'link', run: () => openGame(href) }
  }
  return { label: `Travel to ${regionForTile(tile.id).name}`, icon: 'pin', run: () => fastTravel(tile.id) }
}

/** The arcade's game tiles: the same console layout as the site's home screen, over the island. */
export function ArcadeHub({ onClose }: { onClose: () => void }) {
  const hubTile = useWorld((s) => s.hubTile)
  const [section, setSection] = useState<Section>(() => {
    const t = hubTile && tiles.find((x) => x.id === hubTile)
    return t ? (isGame(t) ? 'games' : t.tab === 'career' ? 'districts' : 'profile') : 'games'
  })
  const list = useMemo(() => tilesFor(section), [section])
  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((t) => t.id === hubTile)))
  const tile = list[Math.min(index, list.length - 1)]
  const primary = primaryFor(tile)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'ArrowRight') setIndex((i) => Math.min(list.length - 1, i + 1))
      else if (e.code === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const k = SECTIONS.findIndex((s) => s.id === section)
        setSection(SECTIONS[(k + (e.code === 'ArrowDown' ? 1 : SECTIONS.length - 1)) % SECTIONS.length].id)
        setIndex(0)
      } else if (e.code === 'Enter') primary.run()
      else return
      e.preventDefault()
      e.stopPropagation()
      play('move')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [list.length, section, primary])

  const Icon = primary.icon === 'play' ? Play : primary.icon === 'link' ? ExternalLink : MapPin
  return (
    <div className={`hub-overlay ps-home ps-hub kind-${isGame(tile) ? 'game' : 'career'}`} style={accentVars(tile.accent)} role="dialog" aria-label="Arcade">
      <HeroBackdrop tile={tile} />
      <div className="ps-scrim" aria-hidden="true" />
      <header className="ps-top">
        <div className="ps-hub-left">
          <span className="hub-brand">
            <Gamepad2 size={18} /> <span>Games Plaza · Arcade</span>
          </span>
          <nav className="ps-tabs" aria-label="Sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`ps-tab ${s.id === section ? 'is-active' : ''}`}
                aria-current={s.id === section ? 'page' : undefined}
                onClick={() => {
                  setSection(s.id)
                  setIndex(0)
                  play('move')
                }}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>
        <button className="ps-icon-btn" onClick={onClose} aria-label="Close the arcade">
          <X size={20} />
        </button>
      </header>
      <TileRow
        tiles={list}
        index={Math.min(index, list.length - 1)}
        focused
        label={`${SECTIONS.find((s) => s.id === section)?.label} tiles`}
        onSelect={(i) => {
          setIndex(i)
          play('move')
        }}
        onActivate={() => primary.run()}
      />
      <section className="ps-info" key={tile.id} aria-labelledby="ps-hub-title">
        <p className="ps-meta">
          <span className="ps-chip">{isGame(tile) ? 'Game' : tile.tab === 'career' ? 'District' : 'Profile'}</span>
          <span>{tile.genre}</span>
        </p>
        <h1 className="ps-title" id="ps-hub-title">
          {tile.title}
        </h1>
        <p className="ps-tagline">{tile.tagline}</p>
        <p className="ps-blurb">{tile.blurb}</p>
        <div className="ps-actions">
          <button className="ps-btn ps-btn-primary is-focused" onClick={primary.run}>
            <Icon size={18} /> {primary.label}
          </button>
          {isGame(tile) && (
            <button className="ps-btn ps-btn-secondary" onClick={() => fastTravel(tile.id)}>
              <MapPin size={18} /> {tile.id === 'cricket' || tile.id === 'sports-complex' ? 'Walk to the stadium gate' : 'Go to its cabinet'}
            </button>
          )}
          {tile.tab === 'career' && <span className="hub-hint">The district tells this chapter on its plaques and exhibit boards.</span>}
        </div>
      </section>
      <div className="hub-foot">
        <kbd>←</kbd> <kbd>→</kbd> tiles · <kbd>↑</kbd> <kbd>↓</kbd> sections · <kbd>Enter</kbd> play · <kbd>Tab</kbd> / <kbd>Esc</kbd> back to the island
      </div>
    </div>
  )
}

export function ExhibitCard() {
  const ex = useWorld((s) => s.exhibit)
  useEffect(() => {
    if (!ex) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        world.set({ exhibit: null })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ex])
  if (!ex) return null
  return (
    <div className="exhibit-card" style={{ ['--accent' as string]: ex.accent }} role="dialog">
      <h2>{ex.title}</h2>
      {ex.subtitle && <p className="exhibit-sub">{ex.subtitle}</p>}
      <div className="exhibit-body">
        {ex.lines.map((l, i) => (l ? <p key={i}>{l}</p> : <br key={i} />))}
      </div>
      <button className="pill" onClick={() => world.set({ exhibit: null })}>
        Close <kbd>E</kbd>
      </button>
    </div>
  )
}

export function AirshipBoard() {
  const stops = airshipStops()
  const here = stops.find((s) => s.here)
  return (
    <div className="exhibit-card airship-board" role="dialog">
      <h2>Airship</h2>
      <p className="exhibit-sub">Moored over {here?.region.name ?? 'the harbour'} · pick a district to sail to</p>
      <div className="airship-stops">
        {stops.map((s) => (
          <button key={s.i} className={`btn ${s.here ? 'btn-secondary' : 'btn-primary'}`} disabled={s.here} onClick={() => sail(s.i)}>
            <MapPin size={14} /> {s.region.name}
            <span className="muted small"> {s.region.tagline}</span>
          </button>
        ))}
      </div>
      <button className="pill" onClick={() => world.set({ panel: 'none' })}>
        Stay moored <kbd>Esc</kbd>
      </button>
    </div>
  )
}

export function CreditsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="exhibit-card credits-panel" role="dialog" aria-label="3D model credits">
      <h2>3D models</h2>
      <p className="exhibit-sub">
        The island's buildings, trees, vehicles and the furniture in its halls are original models made for this project. The low-poly city props
        (taxis, streetlights, shelters, shopfronts) come from the site owner's licensed 3D asset library.
      </p>
      {MODEL_CREDITS.length > 0 && (
        <>
          <p className="exhibit-sub">
            These Creative Commons models are licensed{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              CC BY 4.0
            </a>{' '}
            by their authors:
          </p>
          <ul className="credits-list">
            {MODEL_CREDITS.map((c) => (
              <li key={c.model_url}>
                <a href={c.model_url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>{' '}
                by{' '}
                <a href={c.author_url} target="_blank" rel="noreferrer">
                  {c.author}
                </a>
                {c.use && <span className="muted small"> · {c.use}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="pill" onClick={onClose}>
        Close <kbd>Esc</kbd>
      </button>
    </div>
  )
}
