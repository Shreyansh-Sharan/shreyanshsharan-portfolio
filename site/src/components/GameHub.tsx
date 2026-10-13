import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, CircleCheck, ExternalLink, FileText, Gamepad2, Play, Trophy } from 'lucide-react'
import { tiles, type Tile } from '../data/content'
import { GAME_INFO, previewCards, tileKind, tilesForTab } from '../data/home'
import { externalGameUrl, openGame } from '../data/gameLinks'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { Page } from './Page'
import { TileArt } from './TileArt'
import { accentVars } from '../lib/style'

/** Career chapters (the original detail pages), and since the console home, the games and the showcase too. */
const careers = tiles.filter((t) => t.action.kind === 'hub')

function siblings(tile: Tile): Tile[] {
  const kind = tileKind(tile)
  if (kind === 'career') return careers
  if (kind === 'game') return tilesForTab('games')
  return [tile]
}

export function GameHub({ id, onAccent }: { id: string; onAccent: (a: [string, string], emblem: string) => void }) {
  const found = tiles.find((t) => t.id === id)
  // Pages with their own route (profile, trophies, skills) go there instead.
  const redirect = found && found.action.kind === 'route' && tileKind(found) === 'profile' ? found.action.to : null
  const tile = found && !redirect ? found : undefined
  const games = tile ? siblings(tile) : []
  const index = tile ? games.findIndex((t) => t.id === tile.id) : -1

  useEffect(() => {
    if (tile) onAccent(tile.accent, tile.id)
    else navigate(redirect ?? '#/home')
  }, [tile, redirect, onAccent])

  if (!tile) return null
  const prev = games[index - 1]
  const next = games[index + 1]
  const isGame = tileKind(tile) === 'game'
  const info = GAME_INFO[tile.id]
  const features = tile.activities.length ? [] : previewCards(tile)
  const external = externalGameUrl(tile.id)
  const playGame = () => {
    play('select')
    if (external) openGame(external)
    else if (tile.action.kind === 'route') navigate(tile.action.to)
    else if (tile.action.kind === 'iframe') navigate(`#/embed/${tile.id}`)
  }

  return (
    // key resets scroll position when moving between games
    <Page key={tile.id} onBack={() => navigate(`#/home/${tile.id}`)} className="hub">
      <header className="hub-hero" style={accentVars(tile.accent)}>
        <div className="hub-key">
          <TileArt tile={tile} variant="key" />
        </div>
        <div className="hub-info">
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
          {(isGame || tile.action.kind === 'iframe') && (
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={playGame}>
                {external ? <ExternalLink size={16} /> : <Play size={16} />} {isGame ? 'Play Game' : 'Open'}
              </button>
            </div>
          )}
        </div>
      </header>

      {info && (
        <section className="section">
          <h2 className="section-title">How to play</h2>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label">Modes</span>
              <span className="hub-fact">{info.modes}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Players</span>
              <span className="hub-fact">{info.players}</span>
            </div>
            <div className="stat">
              <span className="stat-label">
                <Gamepad2 size={14} /> Controls
              </span>
              <span className="hub-fact">{info.howTo}</span>
            </div>
          </div>
        </section>
      )}

      {features.length > 0 && (
        <section className="section">
          <h2 className="section-title">Features</h2>
          <ol className="activity-list">
            {features.map((a) => (
              <li className="activity is-feature" key={a.title}>
                <CircleCheck className="activity-check" size={20} aria-hidden="true" />
                <div>
                  <h3>{a.title}</h3>
                  <p>{a.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {tile.stats.length > 0 && (
        <section className="section">
          <h2 className="section-title">Stats</h2>
          <div className="stat-grid">
            {tile.stats.map((s) => (
              <div className="stat" key={s.label}>
                <span className="stat-value">{s.value}</span>
                <span className="stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tile.activities.length > 0 && (
      <section className="section">
        <h2 className="section-title">Activities</h2>
        <ol className="activity-list">
          {tile.activities.map((a) => (
            <li className="activity" key={a.title}>
              <CircleCheck className="activity-check" size={20} aria-hidden="true" />
              <div>
                <h3>{a.title}</h3>
                <p>{a.detail}</p>
              </div>
              <span className="activity-status">Completed</span>
            </li>
          ))}
        </ol>
      </section>
      )}

      {tile.achievements && (
        <section className="section">
          <h2 className="section-title">Trophies earned</h2>
          <div className="chip-row">
            {tile.achievements.map((a) => (
              <span className="chip chip-gold" key={a}>
                <Trophy size={14} /> {a}
              </span>
            ))}
          </div>
        </section>
      )}

      {tile.stack && (
        <section className="section">
          <h2 className="section-title">Tech stack</h2>
          <div className="chip-row">
            {tile.stack.map((s) => (
              <span className="chip" key={s}>
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      <nav className="hub-nav" aria-label="More games">
        {prev ? (
          <button
            className="btn btn-secondary"
            onClick={() => {
              play('move')
              navigate(`#/game/${prev.id}`)
            }}
          >
            <ChevronLeft size={16} /> {prev.title}
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-secondary" onClick={() => navigate('#/resume')}>
          <FileText size={16} /> Quick View
        </button>
        {next ? (
          <button
            className="btn btn-secondary"
            onClick={() => {
              play('move')
              navigate(`#/game/${next.id}`)
            }}
          >
            {next.title} <ChevronRight size={16} />
          </button>
        ) : (
          <span />
        )}
      </nav>
    </Page>
  )
}
