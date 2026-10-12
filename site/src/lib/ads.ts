// Google AdSense: display units on lobby pages and H5 game ad breaks (Ad Placement API) between matches.
// Everything is off until the site is built with a publisher ID (see MONETIZATION.md), so local builds and
// forks never load ad code.
import { useEffect, type RefObject } from 'react'

const env = import.meta.env
export const ADSENSE_CLIENT = (env.VITE_ADSENSE_CLIENT as string | undefined)?.trim() || ''
/** Ad unit IDs for display slots, by placement. */
export const AD_SLOTS = {
  lobby: (env.VITE_ADSENSE_SLOT_LOBBY as string | undefined)?.trim() || '',
  side: (env.VITE_ADSENSE_SLOT_SIDE as string | undefined)?.trim() || '',
}
/** H5 game ads (interstitials between matches, rewarded ads) need separate approval from Google. */
export const GAME_ADS = env.VITE_H5_GAME_ADS === 'on'
const TEST = env.VITE_ADSENSE_TEST === 'on'

export const adsEnabled = () => !!ADSENSE_CLIENT

type AdBreakType = 'start' | 'pause' | 'next' | 'browse' | 'reward' | 'preroll'
interface AdBreakOptions {
  type: AdBreakType
  name: string
  beforeAd?: () => void
  afterAd?: () => void
  beforeReward?: (showAdFn: () => void) => void
  adDismissed?: () => void
  adViewed?: () => void
  adBreakDone?: (placementInfo: { breakStatus?: string }) => void
}

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

let loading: Promise<void> | null = null

/** Load the AdSense script once (with Ad Placement API attributes when game ads are on). */
export function loadAds(): Promise<void> {
  if (!ADSENSE_CLIENT) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve) => {
    window.adsbygoogle = window.adsbygoogle || []
    const s = document.createElement('script')
    s.async = true
    s.crossOrigin = 'anonymous'
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`
    if (GAME_ADS) {
      // Google caps how often interstitials can show; this asks for at most one every 2 minutes.
      s.dataset.adFrequencyHint = '120s'
      if (TEST) s.dataset.adbreakTest = 'on'
    }
    s.onload = () => resolve()
    s.onerror = () => resolve() // Blocked by an ad blocker: the site works the same without ads.
    document.head.appendChild(s)
    if (GAME_ADS) push({ preloadAdBreaks: 'on', sound: 'on' })
  })
  return loading
}

function push(o: unknown) {
  window.adsbygoogle = window.adsbygoogle || []
  window.adsbygoogle.push(o)
}

/**
 * Ask for an interstitial at a natural break (between matches, back to the lobby). `done` always runs, whether
 * or not an ad showed, so the caller can resume. Must be called from a user action.
 */
export function adBreak(name: string, hooks: { pause?: () => void; resume?: () => void; done?: () => void } = {}) {
  if (!ADSENSE_CLIENT || !GAME_ADS) {
    hooks.done?.()
    return
  }
  void loadAds()
  const o: AdBreakOptions = {
    type: 'next',
    name,
    beforeAd: () => hooks.pause?.(),
    afterAd: () => hooks.resume?.(),
    adBreakDone: () => hooks.done?.(),
  }
  push(o)
}

/** Offer a rewarded ad. `granted(true)` only when the player watched it to the end. */
export function rewardedAd(name: string, hooks: { pause?: () => void; resume?: () => void; granted: (ok: boolean) => void }) {
  if (!ADSENSE_CLIENT || !GAME_ADS) {
    hooks.granted(false)
    return
  }
  void loadAds()
  let settled = false
  const settle = (ok: boolean) => {
    if (settled) return
    settled = true
    hooks.granted(ok)
  }
  const o: AdBreakOptions = {
    type: 'reward',
    name,
    beforeAd: () => hooks.pause?.(),
    afterAd: () => hooks.resume?.(),
    beforeReward: (show) => show(), // The game already asked the player, so show it straight away.
    adDismissed: () => settle(false),
    adViewed: () => settle(true),
    adBreakDone: () => settle(false),
  }
  push(o)
}

/**
 * Bridge for games in an iframe: the game posts {source, type: 'adbreak' | 'rewarded', placement, id} at natural
 * pauses and gets back {type: 'ad-started'} when an ad actually shows, then {type: 'adbreak-done'} or
 * {type: 'reward-granted' | 'reward-skipped'}, each with the same id. Without ads configured the game is
 * answered at once, so it never waits.
 */
export function useGameAds(frame: RefObject<HTMLIFrameElement | null>, source: string) {
  useEffect(() => {
    // Replies echo the request's id so the game can match them up (the cricket bridge needs it).
    const reply = (type: string, name: string, id?: string) =>
      frame.current?.contentWindow?.postMessage({ source: 'site', type, name, id }, '*')
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.current?.contentWindow) return
      const msg = ev.data as { source?: string; type?: string; name?: string; placement?: string; id?: string }
      if (!msg || msg.source !== source) return
      const name = msg.placement || msg.name || source
      const started = () => reply('ad-started', name, msg.id)
      if (msg.type === 'adbreak') adBreak(name, { pause: started, done: () => reply('adbreak-done', name, msg.id) })
      if (msg.type === 'rewarded')
        rewardedAd(name, { pause: started, granted: (ok) => reply(ok ? 'reward-granted' : 'reward-skipped', name, msg.id) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frame, source])
}
