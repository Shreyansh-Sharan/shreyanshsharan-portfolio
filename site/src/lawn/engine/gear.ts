// Throwables, traps and the shared garden tools. The sim reads the numbers; the menu shows the names and blurbs.

export type ThrowKind = 'balloon' | 'gnome' | 'egg' | 'paint' | 'jar' | 'golfball'
export type TrapKind = 'beartrap' | 'rake' | 'marbles' | 'alarm' | 'sprinkler' | 'pit'

export interface Throwable {
  kind: ThrowKind
  name: string
  blurb: string
  /** Launch speed (m/s) and gravity (m/s²). */
  speed: number
  gravity: number
  /** Damage to players and to pieces on a direct hit. */
  dmg: number
  pieces: number
  /** Splash radius (m) and effect on players inside it. */
  splash: number
  effect: 'wet' | 'blind' | 'sticky' | 'none'
  effectTime: number
  /** Starting count per match. */
  ammo: number
  /** Bounces off the first surface instead of breaking. */
  bounce?: boolean
}

export const THROWABLES: Record<ThrowKind, Throwable> = {
  balloon: { kind: 'balloon', name: 'Water balloon', blurb: 'Soaks everyone in a 2 m splash: wet players slide and run 25% slower for four seconds.', speed: 16, gravity: 12, dmg: 6, pieces: 4, splash: 2.2, effect: 'wet', effectTime: 4, ammo: 5 },
  gnome: { kind: 'gnome', name: 'Garden gnome', blurb: 'Heavy. Hurts whatever it lands on, player or trophy case.', speed: 13, gravity: 14, dmg: 28, pieces: 40, splash: 0, effect: 'none', effectTime: 0, ammo: 3 },
  egg: { kind: 'egg', name: 'Egg carton', blurb: 'Blinds whoever it hits for two seconds.', speed: 19, gravity: 11, dmg: 5, pieces: 3, splash: 1.2, effect: 'blind', effectTime: 2, ammo: 6 },
  paint: { kind: 'paint', name: 'Paint can', blurb: 'Splats the screen of whoever it hits and marks walls for the team.', speed: 14, gravity: 13, dmg: 12, pieces: 18, splash: 1.8, effect: 'blind', effectTime: 2.6, ammo: 3 },
  jar: { kind: 'jar', name: 'Cookie jar', blurb: 'Shatters into a sticky puddle that slows everyone standing in it.', speed: 14, gravity: 13, dmg: 10, pieces: 14, splash: 2.4, effect: 'sticky', effectTime: 5, ammo: 3 },
  golfball: { kind: 'golfball', name: 'Golf balls', blurb: 'Fast and hard. Bounces once.', speed: 24, gravity: 10, dmg: 16, pieces: 10, splash: 0, effect: 'none', effectTime: 0, ammo: 6, bounce: true },
}
export const THROW_IDS = Object.keys(THROWABLES) as ThrowKind[]

export interface Trap {
  kind: TrapKind
  name: string
  blurb: string
  /** Trigger radius (m). */
  radius: number
  dmg: number
  /** Seconds the victim is held / dizzy / slowed. */
  hold: number
  effect: 'root' | 'stun' | 'slip' | 'alarm' | 'wet' | 'pit'
  /** Starting count per match. */
  ammo: number
  /** Rearms after triggering (seconds, 0 = single use). */
  rearm: number
  /** Can be placed outdoors as well as inside the house. */
  outdoor?: boolean
}

export const TRAPS: Record<TrapKind, Trap> = {
  beartrap: { kind: 'beartrap', name: 'Bear trap', blurb: 'Clamps the first raider who steps on it for three seconds.', radius: 0.7, dmg: 22, hold: 3, effect: 'root', ammo: 2, rearm: 0 },
  rake: { kind: 'rake', name: 'Rake on the floor', blurb: 'The classic: step on it, take a handle to the face, see stars.', radius: 0.6, dmg: 12, hold: 1.4, effect: 'stun', ammo: 3, rearm: 6 },
  marbles: { kind: 'marbles', name: 'Marbles', blurb: 'Anyone running across them slips and falls.', radius: 1.0, dmg: 4, hold: 1.6, effect: 'slip', ammo: 3, rearm: 4 },
  alarm: { kind: 'alarm', name: 'Alarm cans', blurb: 'A string of tin cans: rattles and pings raiders on the whole team\'s screen.', radius: 1.2, dmg: 0, hold: 6, effect: 'alarm', ammo: 2, rearm: 8 },
  sprinkler: { kind: 'sprinkler', name: 'Sprinkler', blurb: 'Soaks a 3 m circle every few seconds: wet raiders slide and slow down.', radius: 3, dmg: 0, hold: 3, effect: 'wet', ammo: 2, rearm: 5, outdoor: true },
  pit: { kind: 'pit', name: 'Doormat pit', blurb: 'A doormat over a hole. Whoever steps on it drops in and climbs out two seconds later.', radius: 0.7, dmg: 10, hold: 2.2, effect: 'pit', ammo: 1, rearm: 0 },
}
export const TRAP_IDS = Object.keys(TRAPS) as TrapKind[]

/** The garden tools anyone can pick up from a tool rack (swapping their hero weapon until they are knocked out). */
export type ToolKind = 'rake' | 'shovel' | 'pan' | 'hose' | 'bat' | 'hammer'
export const TOOLS: Record<ToolKind, { name: string; blurb: string; light: number; lightPieces: number; heavy: number; heavyPieces: number; reach: number; knock: number; heavyUp: number }> = {
  rake: { name: 'Rake', blurb: 'Long reach, light hits.', light: 14, lightPieces: 20, heavy: 28, heavyPieces: 40, reach: 2.8, knock: 6, heavyUp: 0.45 },
  shovel: { name: 'Shovel', blurb: 'Slow, and walls hate it.', light: 18, lightPieces: 34, heavy: 40, heavyPieces: 70, reach: 2.3, knock: 8, heavyUp: 0.6 },
  pan: { name: 'Frying pan', blurb: 'Quick swings; the heavy one rings like a bell.', light: 16, lightPieces: 18, heavy: 32, heavyPieces: 30, reach: 1.9, knock: 7, heavyUp: 0.4 },
  hose: { name: 'Garden hose', blurb: 'A jet of water that pushes raiders back and soaks them.', light: 4, lightPieces: 0, heavy: 8, heavyPieces: 0, reach: 5, knock: 9, heavyUp: 0.3 },
  bat: { name: 'Baseball bat', blurb: 'The wide swing. Big wind-up, big knockback.', light: 17, lightPieces: 24, heavy: 42, heavyPieces: 52, reach: 2.5, knock: 10, heavyUp: 0.55 },
  hammer: { name: 'Sledgehammer', blurb: 'Short overhead smash. Walls go first.', light: 15, lightPieces: 40, heavy: 36, heavyPieces: 90, reach: 2.0, knock: 9, heavyUp: 0.65 },
}
export const TOOL_IDS = Object.keys(TOOLS) as ToolKind[]

/** The valuables a house can hold: score when a raider breaks them. */
export type ValuableKind = 'tv' | 'fridge' | 'trophy' | 'aquarium' | 'clock' | 'piano' | 'console' | 'mower' | 'vase' | 'bookcase'
export const VALUABLES: Record<ValuableKind, { name: string; value: number; hp: number; w: number; d: number; h: number; model: string }> = {
  tv: { name: 'Big TV', value: 150, hp: 70, w: 1.4, d: 0.5, h: 1.0, model: 'tv' },
  fridge: { name: 'Fridge', value: 120, hp: 140, w: 0.9, d: 0.8, h: 1.9, model: 'fridge' },
  trophy: { name: 'Trophy case', value: 200, hp: 110, w: 1.2, d: 0.5, h: 1.8, model: 'trophy' },
  aquarium: { name: 'Aquarium', value: 180, hp: 60, w: 1.4, d: 0.6, h: 1.1, model: 'aquarium' },
  clock: { name: 'Grandfather clock', value: 100, hp: 90, w: 0.6, d: 0.4, h: 2.0, model: 'clock' },
  piano: { name: 'Piano', value: 250, hp: 200, w: 1.5, d: 0.7, h: 1.1, model: 'piano' },
  console: { name: 'Games console', value: 90, hp: 40, w: 0.6, d: 0.5, h: 0.6, model: 'console' },
  mower: { name: 'Mower', value: 100, hp: 120, w: 1.0, d: 1.4, h: 1.0, model: 'mower' },
  vase: { name: 'Heirloom vase', value: 80, hp: 25, w: 0.5, d: 0.5, h: 0.9, model: 'vase' },
  bookcase: { name: 'Bookcase', value: 70, hp: 100, w: 1.2, d: 0.4, h: 2.0, model: 'bookcase' },
}
export const VALUABLE_IDS = Object.keys(VALUABLES) as ValuableKind[]
