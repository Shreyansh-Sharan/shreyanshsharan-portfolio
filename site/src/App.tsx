import { useCallback, useState } from 'react'
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

export default function App() {
  const route = useRoute()
  const [accent, setAccentState] = useState<[string, string]>(tiles[0].accent)
  const setAccent = useCallback((next: [string, string]) => {
    setAccentState((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next))
  }, [])

  let screen
  switch (route.name) {
    case 'boot':
      screen = <Boot />
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
  }

  return (
    <>
      <Background accent={accent} />
      <main className="app">{screen}</main>
    </>
  )
}
