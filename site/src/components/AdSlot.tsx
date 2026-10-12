import { useEffect, useRef } from 'react'
import { ADSENSE_CLIENT, AD_SLOTS, loadAds } from '../lib/ads'

/**
 * A responsive AdSense display unit for menus and results screens (never over gameplay). Renders nothing until
 * the site is built with a publisher ID and an ad unit ID for the placement.
 */
export function AdSlot({ placement = 'lobby', className = '' }: { placement?: keyof typeof AD_SLOTS; className?: string }) {
  const slot = AD_SLOTS[placement] || AD_SLOTS.lobby
  const ref = useRef<HTMLModElement>(null)

  useEffect(() => {
    if (!ADSENSE_CLIENT || !slot || !ref.current) return
    let cancelled = false
    void loadAds().then(() => {
      // Each <ins> is filled once; React may remount the component, which gives it a fresh element.
      if (cancelled || !ref.current || ref.current.dataset.adsbygoogleStatus) return
      try {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
      } catch {
        // An ad blocker or a policy refusal: leave the space empty.
      }
    })
    return () => {
      cancelled = true
    }
  }, [slot])

  if (!ADSENSE_CLIENT || !slot) return null
  return (
    <aside className={`ad-slot ${className}`} aria-label="Advertisement">
      <span className="ad-label">Advertisement</span>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  )
}
