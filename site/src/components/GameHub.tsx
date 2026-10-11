import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, CircleCheck, FileText, Trophy } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { Page } from './Page'
import { TileArt } from './TileArt'
import { accentVars } from '../lib/style'

const games = tiles.filter((t) => t.action.kind === 'hub')

export function GameHub({ id, onAccent }: { id: string; onAccent: (a: [string, string], emblem: string) => void }) {
  const index = games.findIndex((t) => t.id === id)
  const tile = games[index]

  useEffect(() => {
    if (tile) onAccent(tile.accent, tile.id)
    else navigate('#/home')
  }, [tile, onAccent])

  if (!tile) return null
  const prev = games[index - 1]
  const next = games[index + 1]

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
        </div>
      </header>

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
