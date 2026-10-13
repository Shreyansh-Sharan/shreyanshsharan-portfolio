import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { bootLoader } from './lib/loader3d'
import App from './App.tsx'

// Take over the static loading shell from index.html before React paints anything, so there is never a black frame.
bootLoader({ status: 'Starting up…', progress: null })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
