// The island's wandering animals: shared, framework-free state (like controls.ts) that the renderer
// (Animals.tsx), the player (bounce and collisions) and the spell system all read and write.
import * as THREE from 'three'
import { REGIONS, WATER_LEVEL } from './regions'
import { heightAt } from './terrain'
import { blocked } from './colliders'
import type { Spell } from './spells'

export type AnimalKind = 'critter' | 'sheep' | 'fox' | 'bunny' | 'pig'

export interface KindSpec {
  name: string
  /** Footprint radius and height in metres at scale 1. */
  radius: number
  height: number
  /** Walking speed, m/s. */
  speed: number
  /** Hoppers bounce along; waddlers sway. */
  gait: 'hop' | 'waddle'
}

export const KINDS: Record<AnimalKind, KindSpec> = {
  critter: { name: 'Critter', radius: 0.55, height: 1.15, speed: 2.6, gait: 'hop' },
  sheep: { name: 'Sheep', radius: 0.6, height: 1.1, speed: 1.2, gait: 'waddle' },
  fox: { name: 'Fox', radius: 0.5, height: 1.05, speed: 3.1, gait: 'waddle' },
  bunny: { name: 'Bunny', radius: 0.38, height: 1.05, speed: 2.4, gait: 'hop' },
  pig: { name: 'Pig', radius: 0.7, height: 1.05, speed: 1.6, gait: 'waddle' },
}

export interface SpellEffect {
  spell: Spell
  /** Seconds since the cast. */
  t: number
  /** Where the caster stood. */
  from: THREE.Vector3
  /** Horizontal direction of the hit (car path, shot direction), unit length. */
  dir: THREE.Vector3
  /** Time of the last particle puff from the reaction (for rate-limited trickles). */
  tick: number
  /** Internal flags so one-shot reactions (impact, ice break) fire once. */
  hit: boolean
  ended: boolean
}

export interface Animal {
  id: number
  kind: AnimalKind
  spec: KindSpec
  pos: THREE.Vector3
  vy: number
  /** Knock-back velocity on the ground plane, decays to zero. */
  kick: THREE.Vector2
  grounded: boolean
  yaw: number
  home: { x: number; z: number; r: number }
  wander: THREE.Vector3
  /** Seconds left standing still (grazing / looking around). */
  pause: number
  phase: number
  stuck: number
  /** Bounce squash from the player landing on it, 0..1. */
  squash: number
  /** Seconds left running away from the player after a rough spell. */
  flee: number
  /** Current overall scale (shrink / grow), written by the renderer for collisions and the bounce. */
  scale: number
  effect: SpellEffect | null
}

const region = (id: string) => REGIONS.find((r) => r.id === id)!

/** Where each animal lives: a region and an offset from its centre (they roam around it). */
const SPAWNS: { kind: AnimalKind; region: string; at: [number, number]; roam?: number }[] = [
  { kind: 'critter', region: 'hub', at: [8, 12] },
  { kind: 'bunny', region: 'hub', at: [-13, 15] },
  { kind: 'sheep', region: 'highland', at: [-20, -16] },
  { kind: 'sheep', region: 'highland', at: [-15, -21] },
  { kind: 'sheep', region: 'highland', at: [-25, -11] },
  { kind: 'fox', region: 'ridge', at: [12, 20] },
  { kind: 'critter', region: 'campus', at: [10, 14] },
  { kind: 'fox', region: 'campus', at: [-12, 9] },
  { kind: 'bunny', region: 'lab', at: [10, 18] },
  { kind: 'pig', region: 'plains', at: [16, 18] },
]

const walkable = (x: number, z: number, r: number) => heightAt(x, z) > WATER_LEVEL + 0.4 && !blocked(x, z, r + 0.2)

function makeAnimals(): Animal[] {
  return SPAWNS.map((s, id) => {
    const reg = region(s.region)
    const spec = KINDS[s.kind]
    let x = reg.center[0] + s.at[0], z = reg.center[1] + s.at[1]
    // Nudge the spawn onto dry, open ground if the nominal spot is in water or inside a prop.
    for (let i = 0; i < 40 && !walkable(x, z, spec.radius); i++) {
      const a = i * 2.4, r = 1 + i * 0.6
      x = reg.center[0] + s.at[0] + Math.cos(a) * r
      z = reg.center[1] + s.at[1] + Math.sin(a) * r
    }
    return {
      id,
      kind: s.kind,
      spec,
      pos: new THREE.Vector3(x, heightAt(x, z), z),
      vy: 0,
      kick: new THREE.Vector2(),
      grounded: true,
      yaw: id * 1.7,
      home: { x, z, r: s.roam ?? 14 },
      wander: new THREE.Vector3(x, 0, z),
      pause: 1 + (id % 3),
      phase: id,
      stuck: 0,
      squash: 0,
      flee: 0,
      scale: 1,
      effect: null,
    }
  })
}

let list: Animal[] | null = null

/** All animals (created on first use, once the colliders can be queried). */
export function animals(): Animal[] {
  list ??= makeAnimals()
  return list
}

/** A new wander target near the animal's home on dry, open ground. */
export function pickWander(a: Animal, rnd: () => number = Math.random) {
  for (let i = 0; i < 10; i++) {
    const ang = rnd() * Math.PI * 2
    const r = 3 + rnd() * a.home.r
    const x = a.home.x + Math.cos(ang) * r, z = a.home.z + Math.sin(ang) * r
    if (walkable(x, z, a.spec.radius)) {
      a.wander.set(x, 0, z)
      return
    }
  }
  a.wander.set(a.home.x, 0, a.home.z)
}

/** Can an animal step onto (x, z)? Dry land only. */
export const dryLand = (x: number, z: number) => heightAt(x, z) > WATER_LEVEL + 0.25

/** The nearest animal within `range` metres (horizontally) of a point, or null. */
export function nearestAnimal(x: number, z: number, range: number): Animal | null {
  let best: Animal | null = null
  let bestD = range
  for (const a of animals()) {
    const d = Math.hypot(a.pos.x - x, a.pos.z - z)
    if (d < bestD) {
      bestD = d
      best = a
    }
  }
  return best
}

