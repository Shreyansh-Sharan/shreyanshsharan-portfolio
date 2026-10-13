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
  /** Requested teleport from the minimap or the arcade (yaw: camera heading to face on arrival). */
  teleport: { x: number; z: number; n: number; yaw?: number } | null
  assetsReady: boolean
  /** Asked to start exploring (e.g. from the boot screen) before the world finished loading. */
  requestPlay: boolean
  /** Tile whose spot explore mode should start at (the home screen's "Explore Open World"); consumed on spawn. */
  arrive: string | null
  /** The mission fight in progress, for the HUD counter (see combat.ts). */
  fight: { tile: string; name: string; wave: number; waves: number; left: number; total: number } | null
  /** The last mission won, for the celebration banner (n increments per win). */
  cheer: { n: number; name: string } | null
  /** Short HUD notices (loot, captures, level-ups); n increments per notice. */
  toast: { n: number; text: string } | null
  /** Bumped each time the player is knocked out (the HUD shows the overlay). */
  ko: number
  /** The mini-game in progress, as the HUD shows it (see minigames.ts). */
  minigame: MinigameHud | null
  /** Photo mode (P): time frozen, free orbit. */
  photo: boolean
  /** The HUD panel open over the world ('pals' = roster, bestiary and Palbox; 'hub' = the arcade's game tiles). */
  panel: 'none' | 'pals' | 'hub' | 'credits' | 'airship'
  /** Bumped whenever the pal roster or the bestiary changes. */
  palsN: number
  /** The exhibit being read (a plaque, a board, a trophy), or null. */
  exhibit: { title: string; subtitle?: string; lines: string[]; accent: string } | null
  /** Tile the arcade opens on (a cabinet was used). */
  hubTile: string | null
  /** What fills the tab: the island, or the sports complex entered through the stadium gate. */
  scene: 'world' | 'sports'
  /** The room the player walked into (the arcade hall, the keep's great hall), or null outdoors. */
  room: 'arcade' | 'hall' | null
}

export interface MinigameHud {
  id: string
  name: string
  /** Seconds elapsed. */
  t: number
  /** Progress line ("3/10 bottles"), and an optional second line of instructions. */
  progress: string
  hint: string
  /** 0..1 when the game has a meter to show (fishing's cast bar, reel tension). */
  meter: number | null
  /** The end card once the game is over. */
  result: { won: boolean; time: number; coins: number; trophy: boolean; best: number | null; note: string } | null
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
  arrive: null,
  fight: null,
  cheer: null,
  toast: null,
  ko: 0,
  minigame: null,
  photo: false,
  panel: 'none',
  palsN: 0,
  exhibit: null,
  hubTile: null,
  scene: 'world',
  room: null,
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
  /** A short HUD notice. */
  notify(text: string) {
    world.set({ toast: { n: (state.toast?.n ?? 0) + 1, text } })
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useWorld<T>(select: (s: WorldState) => T): T {
  return useSyncExternalStore(world.subscribe, () => select(state))
}
