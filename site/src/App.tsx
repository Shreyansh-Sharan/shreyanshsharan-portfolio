import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { tiles } from './data/content'
import { useRoute } from './lib/router'
import { Background } from './components/Background'
import { Boot } from './components/Boot'
import { Home } from './components/Home'
import { GameHub } from './components/GameHub'
import { Trophies } from './components/Trophies'
import { Skills } from './components/Skills'
import { Profile } from './components/Profile'
import { QuickView } from './components/QuickView'
import { Arena } from './components/Arena'
import type { SceneMode } from './three/Scene3D'

// The 3D layer is a separate chunk so the first screen paints before three.js downloads.
const Scene3D = lazy(() => import('./three/Scene3D'))

function canRun3D() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    if (new URLSearchParams(window.location.search).has('lite')) return false
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export default function App() {
  const route = useRoute()
  const [look, setLook] = useState<{ accent: [string, string]; emblem: string }>({
    accent: tiles[0].accent,
    emblem: 'boot',
  })
  const [use3D] = useState(canRun3D)
  const [ready3D, setReady3D] = useState(false)
  const [hide2D, setHide2D] = useState(false)
  const [gameRunning, setGameRunning] = useState(false)

  useEffect(() => {
    const onArena = (ev: Event) => setGameRunning(Boolean((ev as CustomEvent<boolean>).detail))
    window.addEventListener('arena-running', onArena)
    return () => window.removeEventListener('arena-running', onArena)
  }, [])

  // Keep the 2D background under the 3D layer while it fades in, then drop it to save GPU time.
  useEffect(() => {
    if (!ready3D) return
    const id = window.setTimeout(() => setHide2D(true), 1200)
    return () => window.clearTimeout(id)
  }, [ready3D])

  const setAccent = useCallback((accent: [string, string], emblem: string) => {
    setLook((prev) =>
      prev.accent[0] === accent[0] && prev.accent[1] === accent[1] && prev.emblem === emblem ? prev : { accent, emblem },
    )
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('has-3d', ready3D)
  }, [ready3D])

  const mode: SceneMode = route.name === 'boot' ? 'boot' : route.name === 'home' ? 'home' : 'page'

  let screen
  switch (route.name) {
    case 'boot':
      screen = <Boot onAccent={setAccent} />
      break
    case 'home':
      screen = <Home key={route.tile ?? ''} initialTile={route.tile} onAccent={setAccent} />
      break
    case 'game':
      screen = <GameHub id={route.id} onAccent={setAccent} />
      break
    case 'trophies':
      screen = <Trophies onAccent={setAccent} />
      break
    case 'skills':
      screen = <Skills onAccent={setAccent} />
      break
    case 'profile':
      screen = <Profile onAccent={setAccent} />
      break
    case 'resume':
      screen = <QuickView onAccent={setAccent} />
      break
    case 'arena':
      screen = <Arena key={route.join ?? ''} join={route.join} onAccent={setAccent} />
      break
  }

  return (
    <>
      {!hide2D && <Background accent={look.accent} />}
      {use3D && (
        <Suspense fallback={null}>
          <div className={`scene-layer ${ready3D ? 'is-ready' : ''}`}>
            <Scene3D accent={look.accent} emblem={look.emblem} mode={mode} paused={gameRunning} onReady={() => setReady3D(true)} />
          </div>
        </Suspense>
      )}
      <main className="app">{screen}</main>
    </>
  )
}
