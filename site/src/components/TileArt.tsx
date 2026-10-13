import type { Tile } from '../data/content'
import { accentVars } from '../lib/style'
import { hasVariants, heroSrcSet, thumbSrcSet } from '../lib/art'

/**
 * Art for a tile: the square thumbnail (`thumb`, 512/1024 px, AVIF or WebP) on tiles and the hero backdrop (`hero`)
 * as key art, falling back to `cover`, then to generated gradient art with the tile's icon.
 */
export function TileArt({
  tile,
  variant,
  eager = false,
  sizes,
}: {
  tile: Tile
  variant: 'tile' | 'key'
  eager?: boolean
  /** Rendered width, for picking the right file. */
  sizes?: string
}) {
  const Icon = tile.icon
  const src = variant === 'tile' ? (tile.thumb ?? tile.cover) : (tile.hero ?? tile.cover)
  const img = { alt: '', loading: eager ? ('eager' as const) : ('lazy' as const), decoding: 'async' as const, draggable: false }
  let art = null
  if (hasVariants(src)) {
    const set = variant === 'tile' ? thumbSrcSet : heroSrcSet
    const sz = sizes ?? (variant === 'tile' ? '(max-width: 760px) 92px, 150px' : '(max-width: 860px) 100vw, 55vw')
    art = (
      <picture>
        <source type="image/avif" srcSet={set(src, 'avif')} sizes={sz} />
        <img src={src} srcSet={set(src, 'webp')} sizes={sz} {...img} />
      </picture>
    )
  } else if (src) art = <img src={src} {...img} />

  return (
    <div className={`art art-${variant}`} style={accentVars(tile.accent)} aria-hidden="true">
      {art ?? (
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
