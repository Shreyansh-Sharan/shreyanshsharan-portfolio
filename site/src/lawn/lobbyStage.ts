// Owns the lobby's one shared 3D preview canvas. The engine module is imported only after the models have loaded
// and the browser is idle, so the menu paints first with the still portrait and house sketch; on the low graphics
// tier (phones, weak GPUs) or without WebGL the lobby keeps pre-rendered images instead.
import { useEffect, useState } from 'react'
import type { LawnAssets } from './engine/assets'
import { resolveQuality, type QualityTier } from './engine/quality'
import type { LobbyStage } from './view/lobby'

let webgl: boolean | null = null
function hasWebGL() {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') ?? c.getContext('webgl')
      webgl = !!gl
      ;(gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      webgl = false
    }
  }
  return webgl
}

/** The graphics tier the lobby uses: a `?quality=` override, else the player's setting. */
export function lobbyTier(choice: QualityTier | 'auto'): QualityTier {
  const q = new URLSearchParams(window.location.search).get('quality')
  const forced = q === 'low' || q === 'medium' || q === 'high' ? q : null
  return resolveQuality(forced ?? choice).tier
}

export interface LobbyHandle {
  /** The live stage once it is ready to attach (null while loading or when static). */
  stage: LobbyStage | null
  /** Pre-rendered images only (low tier, no WebGL, or the stage failed to start). */
  still: boolean
}

export function useLobbyStage(assets: LawnAssets | null, choice: QualityTier | 'auto'): LobbyHandle {
  const tier = lobbyTier(choice)
  const off = tier === 'low' || !hasWebGL()
  const [stage, setStage] = useState<LobbyStage | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (off || !assets) return
    let alive = true
    let made: LobbyStage | null = null
    const start = () => {
      import('./view/lobby')
        .then(({ LobbyStage }) => {
          if (!alive) return
          made = new LobbyStage(assets, resolveQuality(tier))
          if (new URLSearchParams(window.location.search).has('snap')) (window as unknown as { __lawnLobby: LobbyStage }).__lawnLobby = made
          setStage(made)
        })
        .catch(() => alive && setFailed(true))
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    const idle = w.requestIdleCallback ? w.requestIdleCallback(start, { timeout: 600 }) : window.setTimeout(start, 150)
    return () => {
      alive = false
      if (w.cancelIdleCallback) w.cancelIdleCallback(idle)
      else window.clearTimeout(idle)
      made?.dispose()
      setStage(null)
    }
  }, [assets, off, tier])
  return { stage: off || failed ? null : stage, still: off || failed }
}
