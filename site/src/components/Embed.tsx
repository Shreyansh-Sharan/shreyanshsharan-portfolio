import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { tiles } from '../data/content'
import { navigate } from '../lib/router'
import { useActions } from '../lib/input'
import { play } from '../lib/sound'

/**
 * A full-page embed of a first-party site (e.g. FootballIQ) inside an iframe.
 * Shows a thin top bar with Back and "Open in a new tab", a loading state, and
 * a graceful fallback if the embedded site never loads (or refuses to be framed).
 */
export function Embed({ id, onAccent }: { id: string; onAccent: (a: [string, string], emblem: string) => void }) {
  const tile = tiles.find((t) => t.id === id)
  const url = tile && tile.action.kind === 'iframe' ? tile.action.url : null

  const [loaded, setLoaded] = useState(false)
  const [stalled, setStalled] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const back = () => {
    play('back')
    navigate(`#/home/${id}`)
  }

  useEffect(() => {
    if (tile) onAccent(tile.accent, tile.id)
  }, [tile, onAccent])

  // If the frame hasn't loaded in a few seconds, surface the open-in-new-tab fallback.
  useEffect(() => {
    if (!url || loaded) return
    const t = window.setTimeout(() => setStalled(true), 6000)
    return () => window.clearTimeout(t)
  }, [url, loaded])

  useActions((action) => {
    if (action === 'back') {
      back()
      return true
    }
    return false
  })

  if (!url) {
    return (
      <div className="page">
        <button className="back-btn" onClick={back}>
          <ArrowLeft size={18} /> Home
        </button>
        <div className="page-body">
          <div className="page-inner">
            <p className="prose">This page isn’t available.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="embed">
      <header className="embed-bar">
        <button className="back-btn embed-back" onClick={back}>
          <ArrowLeft size={18} /> Home
        </button>
        <span className="embed-title">{tile?.title}</span>
        <a className="btn btn-secondary embed-open" href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={16} /> Open in a new tab
        </a>
      </header>

      <div className="embed-stage">
        {!loaded && (
          <div className="embed-loading" role="status">
            <span className="embed-spinner" aria-hidden="true" />
            <p className="muted">Loading {tile?.title}…</p>
            {stalled && (
              <a className="btn btn-primary" href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} /> Taking a while — open it in a new tab
              </a>
            )}
          </div>
        )}
        <iframe
          ref={frameRef}
          className={`embed-frame ${loaded ? 'is-loaded' : ''}`}
          src={url}
          title={tile?.title ?? 'Embedded site'}
          allow="fullscreen; clipboard-read; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </div>
  )
}
