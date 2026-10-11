import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useActions } from '../lib/input'
import { play } from '../lib/sound'
import { HintBar } from './HintBar'

/** Shared shell for sub-pages: a back button, a scrollable body, and arrow/gamepad scrolling. */
export function Page({
  onBack,
  backLabel = 'Home',
  className = '',
  children,
}: {
  onBack: () => void
  backLabel?: string
  className?: string
  children: ReactNode
}) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    bodyRef.current?.focus({ preventScroll: true })
  }, [])

  useActions((action) => {
    const body = bodyRef.current
    if (action === 'back') {
      play('back')
      onBack()
      return true
    }
    if (!body) return false
    if (action === 'down' || action === 'up') {
      body.scrollBy({ top: action === 'down' ? 140 : -140, behavior: 'smooth' })
      return true
    }
    return false
  })

  return (
    <div className={`page ${className}`}>
      <button
        className="back-btn"
        onClick={() => {
          play('back')
          onBack()
        }}
      >
        <ArrowLeft size={18} /> {backLabel}
      </button>
      <div className="page-body" ref={bodyRef} tabIndex={-1}>
        <div className="page-inner">{children}</div>
      </div>
      <HintBar hints={[['↑ ↓', 'Scroll'], ['Esc', 'Back']]} />
    </div>
  )
}
