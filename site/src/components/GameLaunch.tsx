import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import { tiles } from '../data/content'
import { openGame } from '../data/gameLinks'
import { navigate } from '../lib/router'
import { play } from '../lib/sound'
import { Page } from './Page'

/**
 * Stand-in for a game route once that game lives on its own site: opens it in a new tab and keeps a link on
 * screen for browsers that block the pop-up (deep links and the world's mission briefings land here).
 */
export function GameLaunch({ tileId, url, onAccent }: { tileId: string; url: string; onAccent: (a: [string, string], emblem: string) => void }) {
  const tile = tiles.find((t) => t.id === tileId)
  const opened = useRef(false)

  useEffect(() => {
    if (tile) onAccent(tile.accent, tile.id)
  }, [tile, onAccent])

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    openGame(url)
  }, [url])

  return (
    <Page onBack={() => navigate(tile ? `#/home/${tile.id}` : '#/home')} className="launch-page">
      <header className="page-header">
        <p className="eyebrow">Games · New tab</p>
        <h1 className="page-title">{tile?.title ?? 'Game'}</h1>
        <p className="page-lead">
          {tile?.title ?? 'The game'} now runs on its own site and has opened in a new tab. If nothing appeared, your browser blocked
          the pop-up: use the button below.
        </p>
      </header>
      <div className="hero-actions">
        <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer" onClick={() => play('select')}>
          <ExternalLink size={16} /> Open {tile?.title ?? 'the game'}
        </a>
        <button className="btn btn-secondary" onClick={() => navigate(tile ? `#/home/${tile.id}` : '#/home')}>
          Back to the console
        </button>
      </div>
    </Page>
  )
}
