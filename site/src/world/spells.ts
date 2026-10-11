// The spell system: a registry of silly spells, a random picker, and a tiny event bus the FX layer
// drains each frame. Kept framework-free (like controls.ts) so the 3D components just read it.
// A cast targets the nearest animal in range; that animal plays a matching reaction (Animals.tsx).
import * as THREE from 'three'
import { nearestAnimal, type Animal } from './wildlife'

export type SpellId = 'bloom' | 'shrink' | 'grow' | 'freeze' | 'bounce' | 'rockDrop' | 'carRun' | 'gunShot' | 'lightning' | 'zap'

export interface Spell {
  id: SpellId
  name: string
  /** How long the spell's own visual (rock, car, bolt...) lasts, seconds. */
  duration: number
  /** How long the target animal's reaction lasts, seconds. */
  react: number
  /** Emoji/label for the HUD toast. */
  icon: string
}

export const SPELLS: Spell[] = [
  { id: 'bloom', name: 'Bloom', duration: 2.6, react: 2.6, icon: '🌸' },
  { id: 'shrink', name: 'Shrink', duration: 2.2, react: 2.6, icon: '🔽' },
  { id: 'grow', name: 'Grow', duration: 2.2, react: 2.6, icon: '🔼' },
  { id: 'freeze', name: 'Deep Freeze', duration: 2.4, react: 2.8, icon: '🧊' },
  { id: 'bounce', name: 'Launch', duration: 2.0, react: 2.2, icon: '🚀' },
  { id: 'rockDrop', name: 'Rock Drop', duration: 1.8, react: 3.4, icon: '🪨' },
  { id: 'carRun', name: 'Hit and Run', duration: 1.8, react: 3.6, icon: '🚗' },
  { id: 'gunShot', name: 'Pew Pew', duration: 1.2, react: 3.0, icon: '🔫' },
  { id: 'lightning', name: 'Thunderbolt', duration: 1.6, react: 2.6, icon: '⚡' },
]

/** When the spell's visual physically hits the target (seconds after the cast), for synced reactions. */
export const IMPACT: Partial<Record<SpellId, number>> = { rockDrop: 1.1, carRun: 0.9, gunShot: 0.46, lightning: 0 }

/** Spells reach animals within this many metres of the caster. */
export const CAST_RANGE = 28

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

/** A one-shot cast event the FX layer picks up (incremented counter + payload). */
export interface CastEvent {
  n: number
  spell: Spell
  /** Where the cast originated (the player), for projectiles. */
  from: THREE.Vector3
  /** The animal hit, or null when nothing was in range (the spell then lands in front of the caster). */
  target: Animal | null
  /** Where the spell lands when there is no target. */
  at: THREE.Vector3
  /** Horizontal travel direction for the car / shot, unit length. */
  dir: THREE.Vector3
}

let castN = 0
let pending: CastEvent | null = null

/**
 * Cast `spell` from `from` (the player). The nearest animal within range becomes the target and starts
 * its reaction; with nobody around, the spell lands a few metres ahead along `facing` (yaw, radians).
 */
export function castSpell(spell: Spell, from: THREE.Vector3, facing: number) {
  castN += 1
  const target = nearestAnimal(from.x, from.z, CAST_RANGE)
  const at = target ? target.pos.clone() : new THREE.Vector3(from.x + Math.sin(facing) * 7, from.y, from.z + Math.cos(facing) * 7)
  // Shots fly from the caster to the target; the car crosses the line of sight so it reads on screen.
  const toTarget = new THREE.Vector3(at.x - from.x, 0, at.z - from.z)
  if (toTarget.lengthSq() < 1e-4) toTarget.set(Math.sin(facing), 0, Math.cos(facing))
  toTarget.normalize()
  const dir = spell.id === 'carRun' ? new THREE.Vector3(-toTarget.z, 0, toTarget.x) : toTarget
  pending = { n: castN, spell, from: from.clone(), target, at, dir }
  if (target) target.effect = { spell, t: 0, from: from.clone(), dir: dir.clone(), tick: -1, hit: false, ended: false }
}

/** The ranged attack during a mission fight: a quick electric zap from the hands (not one of the random spells). */
export const ZAP: Spell = { id: 'zap', name: 'Zap', duration: 0.3, react: 0, icon: '⚡' }

/** Zap from the caster's hands to a point (an enemy); the FX layer draws the arc. */
export function castZap(from: THREE.Vector3, to: THREE.Vector3, facing: number) {
  castN += 1
  const dir = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing))
  pending = { n: castN, spell: ZAP, from: from.clone(), target: null, at: to.clone(), dir }
}

/** FX layer drains the latest cast once. Returns null if nothing new. */
export function drainCast(lastSeen: number): CastEvent | null {
  if (pending && pending.n > lastSeen) return pending
  return null
}

/** For the HUD: the most recently cast spell, its cast counter and who it hit. */
export function lastCast(): { spell: Spell; n: number; target: string | null } | null {
  return pending ? { spell: pending.spell, n: pending.n, target: pending.target?.spec.name ?? null } : null
}
