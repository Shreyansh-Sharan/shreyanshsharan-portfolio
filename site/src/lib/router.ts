// Minimal hash router: works on static hosts (GitHub Pages) without server rewrites.
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'boot' }
  | { name: 'home'; tile?: string }
  | { name: 'game'; id: string }
  | { name: 'trophies' }
  | { name: 'skills' }
  | { name: 'profile' }
  | { name: 'resume' }

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  switch (parts[0]) {
    case 'home':
      return { name: 'home', tile: parts[1] }
    case 'game':
      return parts[1] ? { name: 'game', id: parts[1] } : { name: 'home' }
    case 'trophies':
    case 'skills':
    case 'profile':
    case 'resume':
      return { name: parts[0] }
    default:
      return { name: 'boot' }
  }
}

export function navigate(to: string) {
  if (window.location.hash !== to) window.location.hash = to
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
