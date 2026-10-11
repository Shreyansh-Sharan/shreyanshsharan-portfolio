// Tiny external store shared by the 3D world and the DOM HUD.
import { useSyncExternalStore } from 'react'

export interface WorldState {
  /** Explore mode: the UI hides and the player walks the world. */
  playing: boolean
  /** Region the background camera frames while browsing. */
  focus: string
  /** Mission (tile id) the player is standing next to. */
  near: string | null
  /** Mission briefing currently open. */
  open: string | null
  done: string[]
  /** Player position and camera heading, for the minimap and compass. */
  player: { x: number; z: number; heading: number }
  /** Requested teleport from the minimap. */
  teleport: { x: number; z: number; n: number } | null
  assetsReady: boolean
  /** Asked to start exploring (e.g. from the boot screen) before the world finished loading. */
  requestPlay: boolean
}

function readDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem('world-missions') ?? '[]')
  } catch {
    return []
  }
}

let state: WorldState = {
  playing: false,
  focus: 'boot',
  near: null,
  open: null,
  done: readDone(),
  player: { x: 0, z: 8, heading: 0 },
  teleport: null,
  assetsReady: false,
  requestPlay: false,
}

const listeners = new Set<() => void>()

export const world = {
  get: () => state,
  set(patch: Partial<WorldState>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  /** Player position updates every frame; only notify the HUD a few times a second. */
  setPlayer(p: WorldState['player']) {
    state.player = p
  },
  complete(tile: string) {
    if (state.done.includes(tile)) return
    const done = [...state.done, tile]
    try {
      localStorage.setItem('world-missions', JSON.stringify(done))
    } catch {
      // Progress just won't persist (private mode).
    }
    world.set({ done })
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useWorld<T>(select: (s: WorldState) => T): T {
  return useSyncExternalStore(world.subscribe, () => select(state))
}
