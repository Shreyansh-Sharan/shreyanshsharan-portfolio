// The six heroes: numbers tuned so each has a counter (brawlers beat runners up close, snipers beat brawlers at
// range, the tank shrugs off chip damage but loses to the grenadier's splash, the medic keeps a team in the fight).

export type HeroId = 'rook' | 'wren' | 'furnace' | 'flick' | 'pike' | 'salve'
export type WeaponKind = 'scatter' | 'rifle' | 'flame' | 'smg' | 'launcher' | 'needler'
export type SuperKind = 'bulwark' | 'sentry' | 'pulse' | 'cloak' | 'mines' | 'mend'

export interface Weapon {
  kind: WeaponKind
  /** Damage per bullet / pellet / flame tick. */
  dmg: number
  /** Seconds between shots (or bursts). */
  cooldown: number
  /** Metres. */
  range: number
  /** Bullet speed, m/s. */
  speed: number
  /** Pellets per shot (scatter) or shots per burst (needler). */
  count: number
  /** Spread half-angle in radians. */
  spread: number
  /** Splash radius for launchers (m). */
  splash: number
  /** Seconds between burst shots. */
  burstGap: number
}

export interface Hero {
  id: HeroId
  name: string
  role: string
  blurb: string
  hp: number
  /** m/s */
  speed: number
  weapon: Weapon
  superKind: SuperKind
  superName: string
  superBlurb: string
  /** Damage dealt to fill the super from empty. */
  chargeDmg: number
  /** Distance bots try to keep from their target. */
  prefRange: number
  /** Skin palette accents: [primary, trim]. */
  colors: [string, string]
  /** Which model files this hero uses (see assets.ts manifest). */
  model: string
  gun: string
}

export const HEROES: Record<HeroId, Hero> = {
  rook: {
    id: 'rook',
    name: 'ROOK',
    role: 'Brawler',
    blurb: 'Riot scattergun. Brutal up close, useless at range.',
    hp: 1500,
    speed: 5.2,
    weapon: { kind: 'scatter', dmg: 112, cooldown: 0.85, range: 8.2, speed: 36, count: 6, spread: 0.28, splash: 0, burstGap: 0 },
    superKind: 'bulwark',
    superName: 'Bulwark Dash',
    superBlurb: 'A shielded charge that rams anyone in the way.',
    chargeDmg: 2200,
    prefRange: 3.5,
    colors: ['#f97316', '#fde68a'],
    model: 'char-rook',
    gun: 'gun-rook',
  },
  wren: {
    id: 'wren',
    name: 'WREN',
    role: 'Marksman',
    blurb: 'A long rail rifle. Two clean hits end most fights.',
    hp: 950,
    speed: 5.0,
    weapon: { kind: 'rifle', dmg: 400, cooldown: 1.35, range: 22, speed: 80, count: 1, spread: 0.012, splash: 0, burstGap: 0 },
    superKind: 'sentry',
    superName: 'Sentry Pod',
    superBlurb: 'Drops a turret that covers a lane for 12 seconds.',
    chargeDmg: 2000,
    prefRange: 14,
    colors: ['#22d3ee', '#e0f2fe'],
    model: 'char-wren',
    gun: 'gun-wren',
  },
  furnace: {
    id: 'furnace',
    name: 'FURNACE',
    role: 'Tank',
    blurb: 'A flamethrower and a lot of armour. Slow, but nothing gets past.',
    hp: 2700,
    speed: 4.9,
    weapon: { kind: 'flame', dmg: 50, cooldown: 0.09, range: 6.8, speed: 14, count: 1, spread: 0.13, splash: 0, burstGap: 0 },
    superKind: 'pulse',
    superName: 'Armour Pulse',
    superBlurb: 'A shockwave that throws enemies back and hardens the plating.',
    chargeDmg: 2600,
    prefRange: 3,
    colors: ['#ef4444', '#fb923c'],
    model: 'char-furnace',
    gun: 'gun-furnace',
  },
  flick: {
    id: 'flick',
    name: 'FLICK',
    role: 'Runner',
    blurb: 'A fast SMG and faster legs. Hit, run, repeat.',
    hp: 1050,
    speed: 6.3,
    weapon: { kind: 'smg', dmg: 68, cooldown: 0.11, range: 11, speed: 42, count: 1, spread: 0.07, splash: 0, burstGap: 0 },
    superKind: 'cloak',
    superName: 'Ghost Cloak',
    superBlurb: 'Vanish for five seconds. The first shot gives you away.',
    chargeDmg: 2100,
    prefRange: 7,
    colors: ['#a855f7', '#f0abfc'],
    model: 'char-flick',
    gun: 'gun-flick',
  },
  pike: {
    id: 'pike',
    name: 'PIKE',
    role: 'Grenadier',
    blurb: 'Lobs grenades over cover. Ruins anyone who stands still.',
    hp: 1150,
    speed: 4.8,
    weapon: { kind: 'launcher', dmg: 620, cooldown: 1.5, range: 13, speed: 16, count: 1, spread: 0.03, splash: 2.4, burstGap: 0 },
    superKind: 'mines',
    superName: 'Minefield',
    superBlurb: 'Scatters five proximity mines around you.',
    chargeDmg: 2400,
    prefRange: 9,
    colors: ['#84cc16', '#d9f99d'],
    model: 'char-pike',
    gun: 'gun-pike',
  },
  salve: {
    id: 'salve',
    name: 'SALVE',
    role: 'Medic',
    blurb: 'A three-shot needler and a steady hand. Keeps the squad standing.',
    hp: 1200,
    speed: 5.4,
    weapon: { kind: 'needler', dmg: 115, cooldown: 0.8, range: 10.5, speed: 44, count: 3, spread: 0.03, splash: 0, burstGap: 0.08 },
    superKind: 'mend',
    superName: 'Mend Zone',
    superBlurb: 'A healing field that patches up everyone inside.',
    chargeDmg: 1700,
    prefRange: 8,
    colors: ['#ec4899', '#fbcfe8'],
    model: 'char-salve',
    gun: 'gun-salve',
  },
}

export const HERO_IDS: HeroId[] = ['rook', 'wren', 'furnace', 'flick', 'pike', 'salve']

export const DASH = { speedMul: 3.6, duration: 0.2, cooldown: 2.8 }

export const SUPER = {
  bulwark: { duration: 2.4, shield: 700, speedMul: 1.9, ramDmg: 320, ramRadius: 1.3, knock: 5 },
  sentry: { duration: 12, hp: 900, range: 12.5, dmg: 95, cooldown: 0.36, speed: 46 },
  pulse: { radius: 4.2, dmg: 260, knock: 5.5, shield: 900, shieldTime: 4 },
  cloak: { duration: 5, speedMul: 1.25 },
  mines: { count: 5, ring: 2.3, dmg: 520, radius: 2.1, arm: 0.8, life: 25 },
  mend: { duration: 6, radius: 3.4, hps: 230 },
}
