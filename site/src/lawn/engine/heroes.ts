// The six household heroes. Every number here is read by the sim (hp, speed, melee), the bots (ranges) and the
// hero sheet in the menu (cards, perks). Original characters: a cookie-baking grandma, the over-competitive dad,
// the mischievous kid, the HOA president, the retired grandpa and the family dog.

export type HeroId = 'nana' | 'dad' | 'kid' | 'hoa' | 'gramps' | 'dog'
export type UltKind = 'cookies' | 'blower' | 'rccar' | 'towtruck' | 'mower' | 'zoomies'
export type MeleeKind = 'rollingpin' | 'golfclub' | 'slingshot' | 'clipboard' | 'cane' | 'bite' | 'bat' | 'hammer' | 'pan' | 'rake' | 'shovel' | 'hose'

export interface Melee {
  kind: MeleeKind
  /** Light swing: damage to players / to pieces. */
  light: number
  lightPieces: number
  /** Heavy swing (wind-up, knockback, blockable). */
  heavy: number
  heavyPieces: number
  /** Reach in metres and half-angle of the swing arc in radians. */
  reach: number
  arc: number
  /** Seconds: light wind-up, light recovery, heavy wind-up, heavy recovery. */
  lightUp: number
  lightDown: number
  heavyUp: number
  heavyDown: number
  /** Knockback impulse (m/s) on a heavy hit. */
  knock: number
  /** Ranged: a slingshot fires a pebble instead of swinging. */
  ranged?: { speed: number; gravity: number; dmg: number; pieces: number; chargeTime: number }
}

export interface Ability {
  name: string
  blurb: string
  /** Icon id for the card art (drawn procedurally in the menu). */
  icon: string
}

export interface Perk {
  name: string
  blurb: string
  /** Hero level needed. */
  level: number
  /** Stat deltas applied by the sim when unlocked. */
  mods: Partial<{ hp: number; speed: number; dmg: number; stamina: number; ultRate: number; throwAmmo: number; trapAmmo: number; ladders: number; knockRes: number }>
}

export interface Hero {
  id: HeroId
  name: string
  role: string
  tagline: string
  blurb: string
  hp: number
  /** m/s walking; sprint multiplies by 1.45. */
  speed: number
  /** Body size for collisions: half width and height (m). */
  halfWidth: number
  height: number
  /** Metres the camera sits above the feet. */
  eye: number
  melee: Melee
  ult: UltKind
  ultName: string
  ultBlurb: string
  /** Damage dealt (players + pieces) that fills the ultimate. */
  ultCharge: number
  /** Passive and gadget cards shown on the sheet. */
  passive: Ability
  gadget: Ability
  perks: [Perk, Perk]
  /** Palette: [primary clothing, accent, skin, hair]. */
  colors: [string, string, string, string]
  /** Which character build the view uses. */
  build: 'nana' | 'dad' | 'kid' | 'hoa' | 'gramps' | 'dog'
  /** Flags read by the sim. */
  tiny?: boolean
  dogflap?: boolean
  sniff?: boolean
  shieldPassive?: boolean
  umbrella?: boolean
  fineOnHit?: boolean
  sprintBoost?: number
  /** Bot tuning. */
  prefRange: number
}

const base = { lightUp: 0.09, lightDown: 0.19, heavyUp: 0.38, heavyDown: 0.4 }

export const HEROES: Record<HeroId, Hero> = {
  nana: {
    id: 'nana',
    name: 'NANA PEARL',
    role: 'Defender',
    tagline: 'Fresh from the oven.',
    blurb: 'A cookie-baking grandma with a rolling pin and a baking tray she holds like a riot shield. Slow to anger, impossible to move once she is.',
    hp: 130,
    speed: 4.9,
    halfWidth: 0.36,
    height: 1.62,
    eye: 1.5,
    melee: { kind: 'rollingpin', light: 14, lightPieces: 18, heavy: 34, heavyPieces: 48, reach: 2.2, arc: 0.95, ...base, knock: 6 },
    ult: 'cookies',
    ultName: 'SCALDING TRAY',
    ultBlurb: 'Slams a tray of scalding cookies down: everyone nearby is burned for five seconds.',
    ultCharge: 420,
    passive: { name: 'Baking-Tray Shield', blurb: 'Blocking soaks 85% of damage instead of 60%, and the tray never breaks.', icon: 'tray' },
    gadget: { name: 'Cookie Jar', blurb: 'Thrown jars shatter into a slow, sticky puddle.', icon: 'jar' },
    perks: [
      { name: 'Hearty Stew', blurb: '+20 health.', level: 2, mods: { hp: 20 } },
      { name: 'Oven Mitts', blurb: 'Heavy swings deal +25% to walls and furniture.', level: 4, mods: { dmg: 0.25 } },
    ],
    colors: ['#c05fa6', '#f8e3a1', '#f1c7a7', '#e8e2e0'],
    build: 'nana',
    shieldPassive: true,
    prefRange: 1.8,
  },
  dad: {
    id: 'dad',
    name: 'BRAD "DADDO" BARNES',
    role: 'Raider',
    tagline: 'Best lawn on the block. Or else.',
    blurb: 'The over-competitive dad swings a golf club and sprints faster than anyone. Cannot pass a rival lawn without commenting.',
    hp: 110,
    speed: 5.4,
    halfWidth: 0.36,
    height: 1.85,
    eye: 1.72,
    melee: { kind: 'golfclub', light: 13, lightPieces: 16, heavy: 36, heavyPieces: 44, reach: 2.6, arc: 0.8, ...base, knock: 8 },
    ult: 'blower',
    ultName: 'LEAF BLOWER',
    ultBlurb: 'A roaring cone of wind that hurls everyone in front of him across the lawn.',
    ultCharge: 380,
    passive: { name: 'Power Walk', blurb: 'Sprints 20% faster and recovers stamina quicker.', icon: 'sprint' },
    gadget: { name: 'Golf Balls', blurb: 'Thrown balls hit hard and bounce once.', icon: 'ball' },
    perks: [
      { name: 'Cardio', blurb: '+30 stamina.', level: 2, mods: { stamina: 30 } },
      { name: 'Trunk Space', blurb: 'Starts with two extra throwables.', level: 4, mods: { throwAmmo: 2 } },
    ],
    colors: ['#2f6fdd', '#ffffff', '#e9b48d', '#5a3a22'],
    build: 'dad',
    sprintBoost: 0.2,
    prefRange: 2.2,
  },
  kid: {
    id: 'kid',
    name: 'PIP',
    role: 'Scout',
    tagline: 'Not it.',
    blurb: 'The mischievous kid with a slingshot. Small enough to crawl through the dog flap, quick enough to get away with it.',
    hp: 80,
    speed: 5.5,
    halfWidth: 0.26,
    height: 1.15,
    eye: 1.05,
    melee: { kind: 'slingshot', light: 6, lightPieces: 6, heavy: 8, heavyPieces: 8, reach: 1.6, arc: 0.9, ...base, knock: 2, ranged: { speed: 26, gravity: 9, dmg: 14, pieces: 12, chargeTime: 0.35 } },
    ult: 'rccar',
    ultName: 'RC CAR BOMB',
    ultBlurb: 'Launches a remote-control car packed with fireworks. It explodes on contact or after four seconds.',
    ultCharge: 330,
    passive: { name: 'Tiny Hitbox', blurb: 'Half-height, fits through dog flaps and broken windows without jumping.', icon: 'small' },
    gadget: { name: 'Egg Carton', blurb: 'Thrown eggs blind whoever they hit for two seconds.', icon: 'egg' },
    perks: [
      { name: 'Sugar Rush', blurb: '+8% move speed.', level: 2, mods: { speed: 0.08 } },
      { name: 'Pocket Full', blurb: 'Starts with three extra throwables.', level: 4, mods: { throwAmmo: 3 } },
    ],
    colors: ['#f0b429', '#2e9c6a', '#f3cfb3', '#3b2a1a'],
    build: 'kid',
    tiny: true,
    dogflap: true,
    prefRange: 7,
  },
  hoa: {
    id: 'hoa',
    name: 'MARGOT VANCE',
    role: 'Controller',
    tagline: 'That is a violation.',
    blurb: 'The HOA president. Every clipboard hit files a fine that slows the target; her ultimate calls the tow truck.',
    hp: 105,
    speed: 5.1,
    halfWidth: 0.36,
    height: 1.74,
    eye: 1.62,
    melee: { kind: 'clipboard', light: 13, lightPieces: 13, heavy: 33, heavyPieces: 36, reach: 2.3, arc: 1.0, ...base, knock: 5 },
    ult: 'towtruck',
    ultName: 'TOW TRUCK',
    ultBlurb: 'A tow truck barrels through in the direction she is facing, smashing walls, doors and anyone in its way.',
    ultCharge: 450,
    passive: { name: 'Citation', blurb: 'Hits apply a fine: the target moves 35% slower for three seconds.', icon: 'fine' },
    gadget: { name: 'Paint Cans', blurb: 'Thrown paint splats the screen of whoever it hits and marks walls.', icon: 'paint' },
    perks: [
      { name: 'Bylaws', blurb: 'Fines last one second longer.', level: 2, mods: {} },
      { name: 'Committee', blurb: 'Starts with one extra trap.', level: 4, mods: { trapAmmo: 1 } },
    ],
    colors: ['#8c2f5a', '#f2e6d8', '#d9a98f', '#1e1a22'],
    build: 'hoa',
    fineOnHit: true,
    prefRange: 2,
  },
  gramps: {
    id: 'gramps',
    name: 'WALT',
    role: 'Tank',
    tagline: 'Back in my day the lawns were greener.',
    blurb: 'The retired grandpa: a cane, an umbrella and 30% more health. Slow, but the ride-on mower makes up for it.',
    hp: 150,
    speed: 4.5,
    halfWidth: 0.38,
    height: 1.7,
    eye: 1.56,
    melee: { kind: 'cane', light: 14, lightPieces: 14, heavy: 38, heavyPieces: 40, reach: 2.3, arc: 0.85, ...base, knock: 7 },
    ult: 'mower',
    ultName: 'RIDE-ON MOWER',
    ultBlurb: 'Hops on the mower and charges: anything in the way is flattened, walls included.',
    ultCharge: 460,
    passive: { name: 'Tough Old Boot', blurb: '+30% health and takes 50% less knockback.', icon: 'boot' },
    gadget: { name: 'Umbrella', blurb: 'Open it to block from the front; hold jump while open to glide down from roofs and ladders.', icon: 'umbrella' },
    perks: [
      { name: 'Afternoon Nap', blurb: 'Respawns two seconds sooner.', level: 2, mods: {} },
      { name: 'Stubborn', blurb: '+20 health.', level: 4, mods: { hp: 20 } },
    ],
    colors: ['#6b4f2a', '#d8c9a3', '#e6b795', '#cfcfcf'],
    build: 'gramps',
    umbrella: true,
    prefRange: 1.9,
  },
  dog: {
    id: 'dog',
    name: 'BISCUIT',
    role: 'Scout',
    tagline: 'Good dog. Bad neighbour.',
    blurb: 'The family dog. Bites, sniffs out traps for the whole team, and the zoomies knock over everything in a straight line.',
    hp: 100,
    speed: 6.1,
    halfWidth: 0.3,
    height: 0.95,
    eye: 0.78,
    melee: { kind: 'bite', light: 14, lightPieces: 10, heavy: 28, heavyPieces: 26, reach: 1.9, arc: 0.8, lightUp: 0.06, lightDown: 0.15, heavyUp: 0.28, heavyDown: 0.3, knock: 4 },
    ult: 'zoomies',
    ultName: 'ZOOMIES',
    ultBlurb: 'Tears off in a straight line, knocking down everyone in the way and leaving them dizzy.',
    ultCharge: 300,
    passive: { name: 'Nose Knows', blurb: 'Enemy traps within 10 m are revealed to the whole team.', icon: 'nose' },
    gadget: { name: 'Fetch', blurb: 'Carries throwables in its mouth; throws are faster but shorter.', icon: 'fetch' },
    perks: [
      { name: 'Zoomier', blurb: 'The ultimate charges 15% faster.', level: 2, mods: { ultRate: 0.15 } },
      { name: 'Thick Coat', blurb: '+15 health.', level: 4, mods: { hp: 15 } },
    ],
    colors: ['#c98a4b', '#f5e6d0', '#c98a4b', '#7a4e24'],
    build: 'dog',
    tiny: true,
    dogflap: true,
    sniff: true,
    prefRange: 1.5,
  },
}

export const HERO_IDS = Object.keys(HEROES) as HeroId[]

/** Hero level from hero XP (shared curve with the profile). */
export function heroLevel(xp: number) {
  return 1 + Math.floor(Math.sqrt(xp / 90))
}

export function heroXpForLevel(l: number) {
  return (l - 1) * (l - 1) * 90
}
