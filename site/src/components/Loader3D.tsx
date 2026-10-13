// React bindings for the shared 3D loader (lib/loader3d.ts). The overlay itself is plain DOM + three.js; these
// components only decide when it shows and what it reports.
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { showLoader, subscribeLoading, trackManager, type LoaderHandle } from '../lib/loader3d'

/**
 * Shows the overlay while mounted. `progress` is 0..1, `null` for "unknown amount of work", or left out to follow
 * three's default loading manager (every GLTF/texture load that is not given its own manager).
 */
export function Loader3D({ status, progress }: { status: string; progress?: number | null }) {
  const handle = useRef<LoaderHandle | null>(null)
  const follow = progress === undefined

  useEffect(() => {
    const h = showLoader({ status, progress: follow ? null : progress })
    handle.current = h
    const off = follow ? subscribeLoading((a) => h.update({ progress: a.active && a.total ? a.loaded / a.total : null })) : undefined
    return () => {
      off?.()
      h.release()
      handle.current = null
    }
    // Mount once; prop changes go through update() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    handle.current?.update({ status })
  }, [status])

  useEffect(() => {
    if (!follow) handle.current?.update({ progress })
  }, [progress, follow])

  return null
}

/**
 * Shows the overlay until the loading manager has been idle for a moment (so the burst of model and texture loads
 * a screen starts on mount has finished), then calls onDone and renders nothing.
 */
export function LoadingGate({ status, onDone }: { status: string; onDone?: () => void }) {
  const finish = useRef(onDone)
  finish.current = onDone

  useEffect(() => {
    const h = showLoader({ status, progress: null })
    const ctrl = new AbortController()
    // Give the screen a frame to kick off its loads before deciding nothing is happening.
    const id = window.setTimeout(() => {
      trackManager(h, ctrl.signal).then(() => {
        if (ctrl.signal.aborted) return
        h.update({ progress: 1 })
        h.release()
        finish.current?.()
      })
    }, 120)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
      h.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

/**
 * Route shell for a lazy game page: the loader covers the chunk download (unknown size) and then the game's own
 * asset burst (real progress from the loading manager), so the page never shows black or half-built.
 */
export function GameRoute({ title, children }: { title: string; children: ReactNode }) {
  const [settled, setSettled] = useState(false)
  return (
    <Suspense fallback={<Loader3D status={`Fetching ${title}…`} progress={null} />}>
      {children}
      {!settled && <LoadingGate status={`Loading ${title}…`} onDone={() => setSettled(true)} />}
    </Suspense>
  )
}
