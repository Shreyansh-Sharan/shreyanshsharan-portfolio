// The selected tile's key art, full-bleed behind the home screen. Each new image loads at the size the screen needs
// (1280–1920 on phones, up to 3840 on 4K screens; AVIF where supported), is decoded, then cross-fades in over the
// previous one (opacity and a slow settle in scale, so only the compositor works); the layers underneath are dropped
// once it has landed. If an image fails, the older art fades away too and the live open world (or the animated
// background) shows through instead.
import { useState } from 'react'
import type { Tile } from '../../data/content'
import { HERO_SIZES, HERO_WIDTHS_SMALL, SMALL_SCREEN, hasVariants, heroSrcSet } from '../../lib/art'

interface Layer {
  key: number
  id: string
  src: string
  shown: boolean
}

let seq = 0

export function HeroBackdrop({ tile, hidden = false, className = '' }: { tile: Tile; hidden?: boolean; className?: string }) {
  const [layers, setLayers] = useState<Layer[]>([])
  const [current, setCurrent] = useState<Tile | null>(null)

  // A new tile adds a layer on top (state adjusted while rendering, so there is no extra effect pass).
  if (current !== tile) {
    setCurrent(tile)
    const src = tile.hero ?? tile.cover
    if (!src) setLayers((ls) => ls.map((l) => ({ ...l, shown: false })))
    else {
      const key = ++seq
      // Keep at most two layers under the new one; anything older is already hidden beneath them.
      setLayers((ls) => [...ls.filter((l) => l.id !== tile.id).slice(-2), { key, id: tile.id, src, shown: false }])
    }
  }

  const show = (key: number) => setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, shown: true } : l)))
  const fail = (key: number) => setLayers((ls) => ls.filter((l) => l.key !== key).map((l) => ({ ...l, shown: false })))

  // Once a layer has faded in, the ones beneath it can go; faded-out layers go too.
  const settle = (key: number) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.key === key)
      if (i < 0) return ls
      if (!ls[i].shown) return ls.filter((l) => l.key !== key)
      return i > 0 ? ls.slice(i) : ls
    })

  return (
    <div className={`ps-bg ${hidden ? 'is-hidden' : ''} ${className}`} aria-hidden="true">
      {layers.map((l) => {
        const img = (
          <img
            className={`ps-bg-img ${l.shown ? 'is-in' : ''}`}
            src={l.src}
            srcSet={hasVariants(l.src) ? heroSrcSet(l.src, 'webp') : undefined}
            sizes={HERO_SIZES}
            alt=""
            decoding="async"
            fetchPriority="high"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget
              el.decode().then(
                () => show(l.key),
                () => show(l.key),
              )
            }}
            onError={() => fail(l.key)}
            onTransitionEnd={(e) => {
              if (e.propertyName === 'opacity') settle(l.key)
            }}
          />
        )
        if (!hasVariants(l.src)) return <picture key={l.key}>{img}</picture>
        return (
          <picture key={l.key}>
            <source media={SMALL_SCREEN} type="image/avif" srcSet={heroSrcSet(l.src, 'avif', HERO_WIDTHS_SMALL)} sizes={HERO_SIZES} />
            <source media={SMALL_SCREEN} type="image/webp" srcSet={heroSrcSet(l.src, 'webp', HERO_WIDTHS_SMALL)} sizes={HERO_SIZES} />
            <source type="image/avif" srcSet={heroSrcSet(l.src, 'avif')} sizes={HERO_SIZES} />
            {img}
          </picture>
        )
      })}
    </div>
  )
}
