import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { bootLoader, setDefaultLoaderScene } from './lib/loader3d'
import { islandScene } from './lib/loading'
import App from './App.tsx'

// Take over the static loading shell from index.html before React paints anything, so there is never a black frame.
// Every loading screen without a context of its own shows the island (the same look as the static shell).
setDefaultLoaderScene(islandScene())
bootLoader({ status: 'Starting up…', progress: null, scene: islandScene() })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
