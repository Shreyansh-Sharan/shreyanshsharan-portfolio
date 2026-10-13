import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { tiles } from './data/content'
import { useRoute } from './lib/router'
import { setInputSuspended } from './lib/input'
import { play } from './lib/sound'
import { Background } from './components/Background'
import { Boot } from './components/Boot'
import { Home } from './components/Home'
import { GameHub } from './components/GameHub'
import { Trophies } from './components/Trophies'
import { Skills } from './components/Skills'
import { Profile } from './components/Profile'
import { Embed } from './components/Embed'
import { QuickView } from './components/QuickView'
import { Arena } from './components/Arena'
import { GameLaunch } from './components/GameLaunch'
import { GameRoute, Loader3D, LoadingGate } from './components/Loader3D'
import { endBoot } from './lib/loader3d'
import { ROUTE_TILE, externalGameUrl } from './data/gameLinks'
import { world, useWorld } from './world/store'
import { attachControls } from './world/controls'
import { CanvasErrorBoundary } from './world/CanvasErrorBoundary'
import type { SceneMode } from './world/WorldCanvas'

// The open world is a separate chunk so the first screen paints before three.js downloads.
const WorldCanvas = lazy(() => import('./world/WorldCanvas'))
const Racer = lazy(() => import('./racer/Racer').then((m) => ({ default: m.Racer })))
const Golf = lazy(() => import('./golf/Golf').then((m) => ({ default: m.Golf })))
const Cricket = lazy(() => import('./components/Cricket').then((m) => ({ default: m.Cricket })))
const Sports = lazy(() => import('./sports/Sports').then((m) => ({ default: m.Sports })))
const Plush = lazy(() => import('./plush/Plush').then((m) => ({ default: m.Plush })))
const Siege = lazy(() => import('./siege/Siege').then((m) => ({ default: m.Siege })))
const Lawn = lazy(() => import('./lawn/Lawn').then((m) => ({ default: m.Lawn })))
const PlayHud = lazy(() => import('./world/PlayHud').then((m) => ({ default: m.PlayHud })))

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
  const [accent, setAccentState] = useState<[string, string]>(tiles[0].accent)
  const [use3D] = useState(canRun3D)
  const [ready3D, setReady3D] = useState(false)
  const [hide2D, setHide2D] = useState(false)
  const [gameRunning, setGameRunning] = useState(false)
  const playing = useWorld((s) => s.playing)
  const requestPlay = useWorld((s) => s.requestPlay)
  // Loader phases: the boot overlay (until the world's first frames), its asset burst, and entering explore mode.
  const [bootStuck, setBootStuck] = useState(false)
  const [worldSettled, setWorldSettled] = useState(false)
  const [entering, setEntering] = useState(false)

  // The boot overlay stays up until the first screen is really there: with the world on, its first rendered frames.
  useEffect(() => {
    if (!use3D || ready3D || bootStuck) endBoot()
  }, [use3D, ready3D, bootStuck])

  // If the world never reports ready (lost context, a slow GPU that gives up) the site must still appear.
  useEffect(() => {
    if (!use3D || ready3D) return
    const id = window.setTimeout(() => setBootStuck(true), 20000)
    return () => window.clearTimeout(id)
  }, [use3D, ready3D])

  useEffect(() => {
    const onArena = (ev: Event) => setGameRunning(Boolean((ev as CustomEvent<boolean>).detail))
    window.addEventListener('arena-running', onArena)
    return () => window.removeEventListener('arena-running', onArena)
  }, [])

  // Keep the 2D background under the world while it fades in, then drop it to save GPU time.
  useEffect(() => {
    if (!ready3D) return
    const id = window.setTimeout(() => setHide2D(true), 1500)
    return () => window.clearTimeout(id)
  }, [ready3D])

  const setAccent = useCallback((next: [string, string], focus: string) => {
    setAccentState((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next))
    if (world.get().focus !== focus) world.set({ focus })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('has-3d', ready3D)
  }, [ready3D])

  // ⌘K / Ctrl+K drops into the world as the explorer; again (or Esc) returns to the site.
  const setPlaying = useCallback(
    (next: boolean) => {
      if (next && (!use3D || !ready3D)) return
      play(next ? 'boot' : 'back')
      // The world streams its characters and props in as the explorer appears; the loader covers that burst.
      if (next) setEntering(true)
      world.set({ playing: next, open: null, near: null })
    },
    [use3D, ready3D],
  )

  useEffect(() => {
    if (!requestPlay) return
    if (!use3D) world.set({ requestPlay: false })
    else if (ready3D) {
      world.set({ requestPlay: false })
      setPlaying(true)
    }
  }, [requestPlay, ready3D, use3D, setPlaying])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (route.name === 'arena' || route.name === 'cricket' || route.name === 'racer' || route.name === 'golf' || route.name === 'sports' || route.name === 'plush' || route.name === 'siege' || route.name === 'lawn') return
        setPlaying(!world.get().playing)
      } else if (e.key === 'Escape' && world.get().playing && !world.get().open) {
        setPlaying(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route.name, setPlaying])

  useEffect(() => {
    setInputSuspended(playing)
    document.documentElement.classList.toggle('is-playing', playing)
    if (!playing) return
    return attachControls()
  }, [playing])

  // Leaving the site for a route (e.g. from a mission briefing) ends explore mode.
  useEffect(() => {
    if ((route.name === 'arena' || route.name === 'cricket' || route.name === 'racer' || route.name === 'golf' || route.name === 'sports' || route.name === 'plush' || route.name === 'siege' || route.name === 'lawn') && world.get().playing) world.set({ playing: false })
  }, [route.name])

  const mode: SceneMode = route.name === 'boot' ? 'boot' : route.name === 'home' ? 'home' : 'page'

  // Once a game has moved to its own site, its route opens that site in a new tab instead.
  const external = ROUTE_TILE[route.name] ? externalGameUrl(ROUTE_TILE[route.name]) : undefined

  let screen
  if (external) screen = <GameLaunch key={route.name} tileId={ROUTE_TILE[route.name]} url={external} onAccent={setAccent} />
  else switch (route.name) {
    case 'boot':
      screen = <Boot onAccent={setAccent} canExplore={use3D} />
      break
    case 'home':
      screen = <Home key={route.tile ?? ''} initialTile={route.tile} onAccent={setAccent} onExplore={use3D ? () => setPlaying(true) : undefined} />
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
    case 'embed':
      screen = <Embed id={route.id} onAccent={setAccent} />
      break
    case 'resume':
      screen = <QuickView onAccent={setAccent} />
      break
    case 'arena':
      screen = <Arena key={route.join ?? ''} join={route.join} onAccent={setAccent} />
      break
    case 'cricket':
      screen = (
        <GameRoute title="Cricket Arena">
          <Cricket key={(route.join ?? '') + (route.auto ? '-auto' : '')} join={route.join} auto={route.auto} onAccent={setAccent} />
        </GameRoute>
      )
      break
    case 'racer':
      screen = (
        <GameRoute title="VOLT RIOT">
          <Racer key={route.auto ?? route.join ?? 'menu'} auto={route.auto} join={route.join} onAccent={setAccent} />
        </GameRoute>
      )
      break
    case 'golf':
      screen = (
        <GameRoute title="BOGEY BRAWL">
          <Golf auto={route.auto} onAccent={setAccent} />
        </GameRoute>
      )
      break
    case 'sports':
      screen = (
        <GameRoute title="SPORTS COMPLEX">
          <Sports auto={route.auto} onAccent={setAccent} />
        </GameRoute>
      )
      break
    case 'plush':
      screen = (
        <GameRoute title="PLUSH PANIC">
          <Plush key={route.join ?? route.auto ?? 'menu'} auto={route.auto} level={route.level} join={route.join} onAccent={setAccent} />
        </GameRoute>
      )
      break
    case 'siege':
      screen = (
        <GameRoute title="NEON SIEGE">
          <Siege key={route.join ?? route.auto ?? 'menu'} auto={route.auto} map={route.map} join={route.join} onAccent={setAccent} />
        </GameRoute>
      )
      break
    case 'lawn':
      screen = (
        <GameRoute title="LAWN WARS">
          <Lawn key={route.join ?? route.auto ?? 'menu'} auto={route.auto} map={route.map} join={route.join} onAccent={setAccent} />
        </GameRoute>
      )
      break
  }

  return (
    <>
      {use3D && !ready3D && !bootStuck && <Loader3D status="Loading the island…" />}
      {use3D && ready3D && !worldSettled && <LoadingGate status="Loading the island…" onDone={() => setWorldSettled(true)} />}
      {entering && <LoadingGate status="Entering the open world…" onDone={() => setEntering(false)} />}
      {!hide2D && <Background accent={accent} />}
      {use3D && (
        <CanvasErrorBoundary>
          <Suspense fallback={null}>
            <div className={`scene-layer ${ready3D ? 'is-ready' : ''}`}>
              <WorldCanvas mode={mode} paused={gameRunning} onReady={() => setReady3D(true)} />
            </div>
          </Suspense>
        </CanvasErrorBoundary>
      )}
      <main className={`app ${playing ? 'is-hidden' : ''}`} aria-hidden={playing}>
        {screen}
      </main>
      {playing && (
        <Suspense fallback={null}>
          <PlayHud onExit={() => setPlaying(false)} />
        </Suspense>
      )}
    </>
  )
}
