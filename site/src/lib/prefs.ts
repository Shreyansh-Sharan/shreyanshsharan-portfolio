// Home screen preferences saved in the browser: reduced motion (UI transitions) and the backdrop (key art or the
// live open world). Each read and write tolerates storage being unavailable (private mode).
import { useSyncExternalStore } from 'react'

export type Backdrop = 'art' | 'world'

export interface Prefs {
  reduceMotion: boolean
  backdrop: Backdrop
}

const KEY = 'ss-home-prefs'

function read(): Prefs {
  let reduce = false
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // Old browsers: assume motion is fine.
  }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null
    return { reduceMotion: raw?.reduceMotion ?? reduce, backdrop: raw?.backdrop === 'world' ? 'world' : 'art' }
  } catch {
    return { reduceMotion: reduce, backdrop: 'art' }
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
