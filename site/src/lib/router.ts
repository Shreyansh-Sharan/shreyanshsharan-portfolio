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
  | { name: 'embed'; id: string }
  | { name: 'arena'; join?: string }
  | { name: 'cricket'; join?: string; auto?: boolean }
  | { name: 'racer'; auto?: 'race' | 'combat' | 'deathmatch'; map?: 'harbor' | 'river' | 'gothic' | 'pier' | 'bowl'; join?: string }
  | { name: 'golf'; auto?: boolean }
  | { name: 'sports'; auto?: boolean }
  | { name: 'plush'; auto?: string; level?: string; join?: string }
  | { name: 'siege'; auto?: string; map?: string; join?: string }
  | { name: 'lawn'; auto?: string; map?: string; join?: string }

export function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean)
  switch (parts[0]) {
    case 'arena':
      return { name: 'arena', join: new URLSearchParams(query).get('join') ?? undefined }
    case 'cricket': {
      const q = new URLSearchParams(query)
      return { name: 'cricket', join: q.get('join') ?? undefined, auto: q.has('auto') }
    }
    case 'racer': {
      const q = new URLSearchParams(query)
      return {
        name: 'racer',
        auto: (['race', 'combat', 'deathmatch'] as const).find((m) => m === q.get('auto')),
        // `map` (Dust Bowl) or `track` (a circuit) for the auto-start test hooks.
        map: (['harbor', 'river', 'gothic', 'pier', 'bowl'] as const).find((m) => m === (q.get('track') ?? q.get('map'))),
        join: q.get('join') ?? undefined,
      }
    }
    case 'golf':
      return { name: 'golf', auto: new URLSearchParams(query).has('auto') }
    case 'sports':
      return { name: 'sports', auto: new URLSearchParams(query).has('auto') }
    case 'plush': {
      // `?auto=loft|show|quick|host` skips the menu (tests and deep links); `level` picks the Quick Play level.
      const q = new URLSearchParams(query)
      return { name: 'plush', auto: q.get('auto') ?? undefined, level: q.get('level') ?? undefined, join: q.get('join') ?? undefined }
    }
    case 'siege': {
      // `?auto=tdm|capture|br&map=` starts a solo match straight away (tests and deep links).
      const q = new URLSearchParams(query)
      return { name: 'siege', auto: q.get('auto') ?? undefined, map: q.get('map') ?? undefined, join: q.get('join') ?? undefined }
    }
    case 'lawn': {
      // `?auto=destruction|brawl|robots&map=culdesac|snowline&time=night` starts a solo match straight away.
      const q = new URLSearchParams(query)
      return { name: 'lawn', auto: q.get('auto') ?? undefined, map: q.get('map') ?? undefined, join: q.get('join') ?? undefined }
    }
    case 'home':
      return { name: 'home', tile: parts[1] }
    case 'game':
      return parts[1] ? { name: 'game', id: parts[1] } : { name: 'home' }
    case 'embed':
      return parts[1] ? { name: 'embed', id: parts[1] } : { name: 'home' }
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
