// The creature's spell system: a registry of silly spells, a random picker, and a tiny event bus the
// FX layer drains each frame. Kept framework-free (like controls.ts) so the 3D components just read it.
import * as THREE from 'three'

export type SpellId = 'bloom' | 'shrink' | 'grow' | 'freeze' | 'bounce' | 'rockDrop' | 'carRun' | 'gunShot' | 'lightning'

export interface Spell {
  id: SpellId
  name: string
  /** How long the effect lasts, seconds. */
  duration: number
  /** Emoji/label for the HUD toast. */
  icon: string
}

export const SPELLS: Spell[] = [
  { id: 'bloom', name: 'Bloom', duration: 2.6, icon: '🌸' },
  { id: 'shrink', name: 'Shrink', duration: 2.2, icon: '🔽' },
  { id: 'grow', name: 'Grow', duration: 2.2, icon: '🔼' },
  { id: 'freeze', name: 'Deep Freeze', duration: 2.4, icon: '🧊' },
  { id: 'bounce', name: 'Launch', duration: 2.0, icon: '🚀' },
  { id: 'rockDrop', name: 'Rock Drop', duration: 1.8, icon: '🪨' },
  { id: 'carRun', name: 'Hit and Run', duration: 1.8, icon: '🚗' },
  { id: 'gunShot', name: 'Pew Pew', duration: 1.4, icon: '🔫' },
  { id: 'lightning', name: 'Thunderbolt', duration: 1.6, icon: '⚡' },
]

const BY_ID = new Map(SPELLS.map((s) => [s.id, s]))
export const spellById = (id: SpellId) => BY_ID.get(id)!

let lastId: SpellId | null = null

/** A random spell, avoiding an immediate repeat so it feels varied. */
export function randomSpell(): Spell {
  let s = SPELLS[Math.floor(Math.random() * SPELLS.length)]
  if (SPELLS.length > 1) {
    while (s.id === lastId) s = SPELLS[Math.floor(Math.random() * SPELLS.length)]
  }
  lastId = s.id
  return s
}

/** Shared creature state, read by the camera/FX and written by Critter. */
export const critter = {
  pos: new THREE.Vector3(14, 0, 10),
  vy: 0,
  grounded: true,
  baseScale: 1,
  /** The active spell effect, or null. Set by a cast, cleared when it times out. */
  effect: null as null | { spell: Spell; t: number; from: THREE.Vector3 },
}

/** A one-shot cast event the FX layer picks up (incremented counter + payload). */
export interface CastEvent {
  n: number
  spell: Spell
  /** Where the cast originated (the player), for projectiles. */
  from: THREE.Vector3
}

let castN = 0
let pending: CastEvent | null = null

/** Queue a spell cast from `from` (usually the player position). */
export function castSpell(spell: Spell, from: THREE.Vector3) {
  castN += 1
  pending = { n: castN, spell, from: from.clone() }
  critter.effect = { spell, t: 0, from: from.clone() }
}

/** FX layer drains the latest cast once. Returns null if nothing new. */
export function drainCast(lastSeen: number): CastEvent | null {
  if (pending && pending.n > lastSeen) return pending
  return null
}

/** For the HUD: the most recently cast spell and its cast counter. */
export function lastCast(): { spell: Spell; n: number } | null {
  return pending ? { spell: pending.spell, n: pending.n } : null
}
