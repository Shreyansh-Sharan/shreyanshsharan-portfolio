// Home screen preferences saved in the browser: reduced motion (UI transitions), the backdrop (the live open world
// on the profile with key art for games and careers, key art everywhere, or the live world everywhere) and whether
// the open-world coach mark has been seen. Each read and write tolerates storage being unavailable (private mode).
import { useSyncExternalStore } from 'react'

export type Backdrop = 'auto' | 'art' | 'world'

export interface Prefs {
  reduceMotion: boolean
  backdrop: Backdrop
  /** The "there is an open world" coach mark was dismissed (or the world was explored). */
  coachSeen: boolean
}

const KEY = 'ss-home-prefs-v2'
// The first version stored the backdrop as 'art' by default; only its motion setting carries over.
const OLD_KEY = 'ss-home-prefs'

function read(): Prefs {
  let reduce = false
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // Old browsers: assume motion is fine.
  }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null
    const old = raw ? null : (JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null') as Partial<Prefs> | null)
    const backdrop = raw?.backdrop === 'art' || raw?.backdrop === 'world' ? raw.backdrop : old?.backdrop === 'world' ? 'world' : 'auto'
    return { reduceMotion: raw?.reduceMotion ?? old?.reduceMotion ?? reduce, backdrop, coachSeen: !!raw?.coachSeen }
  } catch {
    return { reduceMotion: reduce, backdrop: 'auto', coachSeen: false }
  }
}

let prefs = read()
const listeners = new Set<() => void>()

function apply() {
  document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion)
  document.documentElement.dataset.backdrop = prefs.backdrop
}
apply()

export function getPrefs() {
  return prefs
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // The setting applies for this visit only.
  }
  apply()
  listeners.forEach((l) => l())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => prefs,
  )
}
