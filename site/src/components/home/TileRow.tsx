// The console's row of square tiles. Every tile sits on a fixed slot and moves only by transform: the selected tile
// scales up (pushing the later ones along) and the track slides so the selection keeps its place near the left
// edge, the way the console does it. Swipe, the mouse wheel and clicks step the selection; arrow keys and the
// gamepad are handled by the screen that owns the row.
import { useEffect, useRef, type CSSProperties } from 'react'
import type { Tile } from '../../data/content'
import { TileArt } from '../TileArt'

export function TileRow({
  tiles,
  index,
  focused,
  label = 'Tiles',
  onSelect,
  onActivate,
  tileRef,
  className = '',
}: {
  tiles: Tile[]
  index: number
  /** The row holds keyboard focus (draws the focus ring). */
  focused: boolean
  label?: string
  onSelect: (i: number) => void
  onActivate: (i: number) => void
  tileRef?: (i: number, el: HTMLButtonElement | null) => void
  className?: string
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  // Keep the latest callbacks for the native listeners below without re-binding them.
  const live = useRef({ index, count: tiles.length, onSelect })
  useEffect(() => {
    live.current = { index, count: tiles.length, onSelect }
  })

  // Swipe (touch) and the mouse wheel / trackpad step the selection.
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    let x0 = 0, y0 = 0, tracking = false
    let wheelAt = 0, wheelAcc = 0
    const step = (d: number) => {
      const { index: i, count, onSelect: select } = live.current
      const next = Math.max(0, Math.min(count - 1, i + d))
      if (next !== i) select(next)
    }
    const slot = () => {
      const t = parseFloat(getComputedStyle(el).getPropertyValue('--t')) || 80
      const g = parseFloat(getComputedStyle(el).getPropertyValue('--g')) || 12
      return t + g
    }
    const onStart = (e: TouchEvent) => {
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      tracking = true
    }
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return
      step(-Math.sign(dx) * Math.max(1, Math.round(Math.abs(dx) / slot())))
    }
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!d) return
      e.preventDefault()
      const now = performance.now()
      if (now - wheelAt > 300) wheelAcc = 0
      wheelAcc += d
      if (Math.abs(wheelAcc) >= 40 && now - wheelAt > 140) {
        step(Math.sign(wheelAcc))
        wheelAcc = 0
        wheelAt = now
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // One slot of the previous tile stays in view; the selection keeps its place from there on.
  const shift = Math.max(0, index - 1)
  const selected = tiles[index]
  return (
    <div
      ref={rowRef}
      className={`ps-row ${focused ? 'is-focused' : ''} ${className}`}
      style={{ ['--shift' as string]: shift, ['--lx' as string]: Math.min(index, 1) } as CSSProperties}
    >
      <div className="ps-row-track" role="listbox" aria-label={label} aria-orientation="horizontal">
        {tiles.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => tileRef?.(i, el)}
            id={`ps-tile-${t.id}`}
            role="option"
            aria-selected={i === index}
            aria-label={`${t.title}, ${t.genre}`}
            tabIndex={i === index ? 0 : -1}
            className={`ps-tile ${i === index ? 'is-selected' : ''} ${i < shift ? 'is-gone' : ''}`}
            style={{ ['--i' as string]: i, ['--after' as string]: i > index ? 1 : 0 } as CSSProperties}
            onClick={() => (i === index ? onActivate(i) : onSelect(i))}
          >
            <TileArt tile={t} variant="tile" eager={i < 10} />
          </button>
        ))}
      </div>
      {selected && (
        <span className="ps-tile-label" key={selected.id} aria-hidden="true">
          {selected.title}
        </span>
      )}
    </div>
  )
}
