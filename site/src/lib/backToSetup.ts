// While a match (or an online room, or a results screen) is open, the browser or phone back button returns to the
// game's setup page instead of leaving the game. Starting a match adds one history entry at the same URL; going
// back off it runs `onBack`, the same handler the game's own Quit / Leave button uses. Quitting from inside the
// game removes that entry again, so the next back press leaves the setup page as usual.
import { useEffect, useRef } from 'react'

type State = { inMatch?: boolean } | null

export function useBackToSetup(active: boolean, onBack: () => void) {
  const handler = useRef(onBack)
  useEffect(() => {
    handler.current = onBack
  })

  useEffect(() => {
    if (!active) return
    window.history.pushState({ ...((window.history.state as object | null) ?? {}), inMatch: true }, '', window.location.href)
    let popped = false
    const onPop = (e: PopStateEvent) => {
      if ((e.state as State)?.inMatch) return
      popped = true
      handler.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Left through the game's own button: drop the entry this match added.
      if (!popped && (window.history.state as State)?.inMatch) window.history.back()
    }
  }, [active])
}
