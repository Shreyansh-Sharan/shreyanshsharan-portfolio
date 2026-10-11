import type { Tile } from '../data/content'
import { accentVars } from '../lib/style'

/** Generated cover art for a tile: gradient, pattern and the tile's icon. Uses `tile.cover` when provided. */
export function TileArt({ tile, variant }: { tile: Tile; variant: 'tile' | 'key' }) {
  const Icon = tile.icon
  return (
    <div className={`art art-${variant}`} style={accentVars(tile.accent)} aria-hidden="true">
      {tile.cover ? (
        <img src={tile.cover} alt="" loading="lazy" decoding="async" />
      ) : (
        <>
          <div className="art-pattern" />
          <Icon className="art-icon" strokeWidth={variant === 'key' ? 1.1 : 1.6} />
          {variant === 'key' && (
            <div className="art-caption">
              <span className="art-title">{tile.title}</span>
              <span className="art-tagline">{tile.tagline}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
