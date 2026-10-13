// Signature powers, status effects, the counter rules between them and the map power-ups, all as data. The sim
// (sim.ts) applies the rules; the menu and HUD read the same tables, so what the hero sheet promises is what the
// match does.
//
// The counter web is a cycle where every power beats the next two and loses to the two before it:
//
//   FURNACE ─▶ ROOK ─▶ WREN ─▶ FLICK ─▶ PIKE ─▶ FURNACE …       (each also beats the one two steps ahead)
//   FURNACE melts ROOK's wall · burns SALVE's healing     ROOK's wall stops WREN's rail and FLICK's SMG
//   WREN's scan strips FLICK's cloak and decoys · knocks FURNACE out of the vent    FLICK slips PIKE's toxin · decoys SALVE's homing needles
//   PIKE's gas chokes FURNACE's vent and ROOK's charge; shells lob over walls    SALVE cleanses PIKE's toxin, reflects WREN's marks
import type { HeroId } from './heroes.ts'

/** What an effect is. Counter rules are written between tags, never between heroes. */
export type Tag =
  | 'shield'
  | 'block'
  | 'deployable'
  | 'cloak'
  | 'decoy'
  | 'channel'
  | 'slow'
  | 'dot'
  | 'mark'
  | 'reveal'
  | 'heal'
  | 'healblock'
  | 'knockback'
  | 'heat'
  | 'cleanse'
  | 'lob'
  | 'homing'
  | 'blink'
  | 'buff'
  | 'immune'
  | 'choke'

export type PowerKind = 'wall' | 'dart' | 'vent' | 'blink' | 'toxin' | 'purge'

export interface PowerDef {
  name: string
  blurb: string
  /** Seconds (shortened by the Capacitor gear). */
  cooldown: number
  /** What the power is (what can counter it). */
  is: Tag[]
  /** What the power does (what it counters). */
  does: Tag[]
  /** Lucide icon name for the UI. */
  icon: 'brick-wall-shield' | 'scan-eye' | 'flame' | 'ghost' | 'biohazard' | 'heart-pulse'
  color: string
}

export const POWERS: Record<PowerKind, PowerDef> = {
  wall: {
    name: 'Riot Wall',
    blurb: 'Raises a 3 m energy barrier off the forearm shield for 5 s. It moves with you and stops enemy fire, dipping for a moment each time you shoot. Lobbed shells sail over.',
    cooldown: 9,
    is: ['deployable', 'shield'],
    does: ['block'],
    icon: 'brick-wall-shield',
    color: '#f97316',
  },
  dart: {
    name: 'Scan Dart',
    blurb: 'A concussive dart (its knock breaks channels) that pulses where it lands: strips cloaks, pops decoys and marks enemies (+80% damage taken) for 5 s.',
    cooldown: 8,
    is: [],
    does: ['reveal', 'mark', 'knockback'],
    icon: 'scan-eye',
    color: '#22d3ee',
  },
  vent: {
    name: 'Heat Vent',
    blurb: 'Boosters fire you forward, then a blast melts shields and gadgets and Scorches enemies: burning, no healing or barriers, no cleanse.',
    cooldown: 9,
    is: ['channel'],
    does: ['heat', 'dot', 'healblock'],
    icon: 'flame',
    color: '#fb923c',
  },
  blink: {
    name: 'Blink Decoy',
    blurb: 'Blink 6 m and leave a hologram that runs at the enemy, soaking fire and homing shots. Blinking sheds slows and poison.',
    cooldown: 5,
    is: ['decoy'],
    does: ['blink', 'decoy'],
    icon: 'ghost',
    color: '#c084fc',
  },
  toxin: {
    name: 'Toxin Shell',
    blurb: 'A lobbed canister: the burst knocks enemies back, then a gas cloud poisons, slows and chokes: no dashing, no charges, no flames.',
    cooldown: 8,
    is: ['dot', 'slow'],
    does: ['lob', 'knockback', 'dot', 'slow', 'choke'],
    icon: 'biohazard',
    color: '#a3e635',
  },
  purge: {
    name: 'Purge Pulse',
    blurb: 'Cleanses you and nearby allies of poison, slows, marks and reveals (a cleansed mark bounces back onto the marker for 2 s), heals, and grants a 150 barrier and 4.5 s of immunity.',
    cooldown: 9,
    is: ['heal', 'shield'],
    does: ['cleanse', 'heal', 'immune'],
    icon: 'heart-pulse',
    color: '#f472b6',
  },
}

/** Tuning for each power. */
export const POWER = {
  wall: { hp: 900, life: 5, half: 1.6, dist: 1.25, speedMul: 1, lowerOnFire: 0.45 },
  dart: { speed: 62, range: 24, dmg: 140, radius: 6.5, reveal: 4.5, mark: 5, markMul: 1.8, knock: 7 },
  vent: { windup: 0.45, radius: 4.4, dmg: 220, scorch: 4, scorchDps: 75, lunge: 5.5 },
  blink: { dist: 6, decoyLife: 4, decoyHp: 420, decoySpeed: 5 },
  toxin: { range: 12, speed: 15, radius: 3.3, life: 5, dps: 95, slow: 0.4, knock: 6, dmg: 120 },
  purge: { radius: 5, heal: 260, immune: 4.5, shield: 150, reflect: 2 },
}

/* ---------- Status effects ---------- */

export type StatusKind =
  | 'slow'
  | 'toxin'
  | 'scorch'
  | 'mark'
  | 'revealed'
  | 'purged'
  | 'hyper'
  | 'haste'
  | 'amp'
  | 'ricochet'
  | 'magnet'
  | 'overshield'
  | 'phased'
  | 'revive'

export interface StatusDef {
  name: string
  tags: Tag[]
  /** Negative effects show red in the HUD; buffs show in their colour. */
  debuff: boolean
  /** A cleanse cannot remove it. */
  sticky?: boolean
  color: string
}

export const STATUS_KINDS: StatusKind[] = ['slow', 'toxin', 'scorch', 'mark', 'revealed', 'purged', 'hyper', 'haste', 'amp', 'ricochet', 'magnet', 'overshield', 'phased', 'revive']

export const STATUS_INFO: Record<StatusKind, StatusDef> = {
  slow: { name: 'Slowed', tags: ['slow'], debuff: true, color: '#2dd4bf' },
  toxin: { name: 'Poisoned', tags: ['dot', 'choke'], debuff: true, color: '#a3e635' },
  scorch: { name: 'Scorched', tags: ['dot', 'healblock'], debuff: true, sticky: true, color: '#fb923c' },
  mark: { name: 'Marked', tags: ['mark'], debuff: true, color: '#f43f5e' },
  revealed: { name: 'Revealed', tags: ['reveal'], debuff: true, color: '#22d3ee' },
  purged: { name: 'Immune', tags: ['immune', 'buff'], debuff: false, color: '#fbcfe8' },
  hyper: { name: 'Overclock', tags: ['buff'], debuff: false, color: '#fb923c' },
  haste: { name: 'Speed Boots', tags: ['buff'], debuff: false, color: '#4ade80' },
  amp: { name: 'Damage Amp', tags: ['buff'], debuff: false, color: '#f43f5e' },
  ricochet: { name: 'Ricochet', tags: ['buff'], debuff: false, color: '#facc15' },
  magnet: { name: 'Magnet', tags: ['buff'], debuff: false, color: '#38bdf8' },
  overshield: { name: 'Overshield', tags: ['shield', 'buff'], debuff: false, color: '#bae6fd' },
  phased: { name: 'Phase Cloak', tags: ['cloak', 'buff'], debuff: false, color: '#c084fc' },
  revive: { name: 'Revive Token', tags: ['buff'], debuff: false, color: '#f9a8d4' },
}

/** Tags a cleanse removes (unless the status is sticky) and an immunity keeps off. */
export const CLEANSABLE: Tag[] = ['slow', 'dot', 'mark', 'reveal']

export function statusHas(kind: StatusKind, tag: Tag) {
  return STATUS_INFO[kind].tags.includes(tag)
}

/* ---------- Counter rules ---------- */

export type CounterId = 'melt' | 'scrap' | 'uncloak' | 'expose' | 'interrupt' | 'choke' | 'cleanse' | 'reflect' | 'block' | 'healblock' | 'slip' | 'lure'

export interface CounterRule {
  /** The popup word: BROKEN! when something is destroyed or cancelled, COUNTERED! when it is negated. */
  word: 'BROKEN!' | 'COUNTERED!'
  label: string
  /** The counter's tag and the tag it beats. */
  by: Tag
  beats: Tag
  color: string
}

export const COUNTER_RULES: Record<CounterId, CounterRule> = {
  melt: { word: 'BROKEN!', label: 'Shield melted', by: 'heat', beats: 'shield', color: '#fb923c' },
  scrap: { word: 'BROKEN!', label: 'Gadget melted', by: 'heat', beats: 'deployable', color: '#fb923c' },
  uncloak: { word: 'BROKEN!', label: 'Cloak stripped', by: 'reveal', beats: 'cloak', color: '#22d3ee' },
  expose: { word: 'BROKEN!', label: 'Decoy exposed', by: 'reveal', beats: 'decoy', color: '#22d3ee' },
  interrupt: { word: 'BROKEN!', label: 'Interrupted', by: 'knockback', beats: 'channel', color: '#a3e635' },
  choke: { word: 'COUNTERED!', label: 'Choked', by: 'choke', beats: 'channel', color: '#a3e635' },
  cleanse: { word: 'COUNTERED!', label: 'Cleansed', by: 'cleanse', beats: 'dot', color: '#f472b6' },
  reflect: { word: 'COUNTERED!', label: 'Mark reflected', by: 'cleanse', beats: 'mark', color: '#f472b6' },
  block: { word: 'COUNTERED!', label: 'Blocked', by: 'block', beats: 'shield', color: '#f97316' },
  healblock: { word: 'COUNTERED!', label: 'Heal blocked', by: 'healblock', beats: 'heal', color: '#fb923c' },
  slip: { word: 'COUNTERED!', label: 'Slipped free', by: 'blink', beats: 'slow', color: '#c084fc' },
  lure: { word: 'COUNTERED!', label: 'Decoyed', by: 'decoy', beats: 'homing', color: '#c084fc' },
}

export const COUNTER_IDS = Object.keys(COUNTER_RULES) as CounterId[]

/** Hero matchups the counter rules produce (shown on the hero sheet; balance.test.ts checks they hold). */
export const MATCHUPS: Record<HeroId, { beats: HeroId; why: string; rule: CounterId }[]> = {
  rook: [
    { beats: 'wren', why: 'Riot Wall stops rail shots and Scan Darts', rule: 'block' },
    { beats: 'flick', why: 'Riot Wall eats SMG fire; the scattergun shreds runners up close', rule: 'block' },
  ],
  wren: [
    { beats: 'flick', why: 'Scan Dart strips the cloak and pops decoys', rule: 'uncloak' },
    { beats: 'furnace', why: 'The dart’s knock breaks the vent lunge; marked tanks take +80%', rule: 'interrupt' },
  ],
  furnace: [
    { beats: 'rook', why: 'Heat Vent melts shields and Riot Walls', rule: 'melt' },
    { beats: 'salve', why: 'Scorch blocks healing, barriers and immunity, and cannot be cleansed', rule: 'healblock' },
  ],
  flick: [
    { beats: 'pike', why: 'Blink sheds poison and slows; decoys soak shells', rule: 'slip' },
    { beats: 'salve', why: 'Decoys pull homing needles and the medic’s aim', rule: 'lure' },
  ],
  pike: [
    { beats: 'furnace', why: 'Gas smothers the flamethrower and chokes the Heat Vent', rule: 'choke' },
    { beats: 'rook', why: 'Shells lob over Riot Walls; gas chokes dashes and the Bulwark charge', rule: 'choke' },
  ],
  salve: [
    { beats: 'pike', why: 'Purge cleanses Toxin and blocks it for 4.5 s', rule: 'cleanse' },
    { beats: 'wren', why: 'Purge clears marks and reflects them back onto the marker', rule: 'reflect' },
  ],
}

/** Heroes that beat this one. */
export function weakAgainst(hero: HeroId) {
  const out: { by: HeroId; why: string; rule: CounterId }[] = []
  for (const h of Object.keys(MATCHUPS) as HeroId[]) for (const m of MATCHUPS[h]) if (m.beats === hero) out.push({ by: h, why: m.why, rule: m.rule })
  return out
}

/* ---------- Power-up pads ---------- */

export type PowerUpKind = 'hyper' | 'overshield' | 'haste' | 'amp' | 'reset' | 'ricochet' | 'magnet' | 'phase' | 'medkit' | 'revive'

export interface PowerUpDef {
  name: string
  blurb: string
  /** Seconds the buff lasts (0 = instant). */
  dur: number
  color: string
  /** Battle royale only. */
  brOnly?: boolean
}

export const POWERUP_KINDS: PowerUpKind[] = ['hyper', 'overshield', 'haste', 'amp', 'reset', 'ricochet', 'magnet', 'phase', 'medkit', 'revive']

export const POWERUPS: Record<PowerUpKind, PowerUpDef> = {
  hyper: { name: 'Overclock', blurb: 'Fire rate +55%', dur: 8, color: '#fb923c' },
  overshield: { name: 'Overshield', blurb: '+650 shield', dur: 10, color: '#bae6fd' },
  haste: { name: 'Speed Boots', blurb: 'Move speed +30%', dur: 8, color: '#4ade80' },
  amp: { name: 'Damage Amp', blurb: 'Damage +30%', dur: 8, color: '#f43f5e' },
  reset: { name: 'Reset Chip', blurb: 'Power and dash ready, +25% super', dur: 0, color: '#22d3ee' },
  ricochet: { name: 'Ricochet Rounds', blurb: 'Shots bounce off walls once', dur: 10, color: '#facc15' },
  magnet: { name: 'Magnet', blurb: 'Pulls coins and loot to you', dur: 12, color: '#38bdf8' },
  phase: { name: 'Phase Cloak', blurb: 'Invisible for 4 s (firing reveals you)', dur: 4, color: '#c084fc' },
  medkit: { name: 'Medkit', blurb: 'Heal 50%', dur: 0, color: '#4ade80' },
  revive: { name: 'Revive Token', blurb: 'Get back up once when downed', dur: 0, color: '#f9a8d4', brOnly: true },
}

export const POWERUP = {
  hyperMul: 0.65,
  hasteMul: 1.3,
  ampMul: 1.3,
  overshield: 650,
  magnetRange: 8,
  magnetPull: 10,
  firstSpawn: 8,
  respawn: 18,
  centreFirst: 20,
  centreRespawn: 24,
  shardCoins: 10,
}

/** Rotation per pad: mirrored pads share a slot so both sides see the same kind. */
export function padKind(slot: number, spawn: number, br: boolean, centre: boolean): PowerUpKind {
  const arena: PowerUpKind[] = ['hyper', 'haste', 'overshield', 'ricochet', 'medkit', 'magnet', 'phase', 'amp', 'reset']
  const middle: PowerUpKind[] = ['amp', 'overshield', 'reset', 'hyper']
  const royale: PowerUpKind[] = ['revive', 'hyper', 'overshield', 'haste', 'amp', 'medkit', 'ricochet', 'phase', 'magnet', 'reset']
  const pool = centre ? middle : br ? royale : arena
  return pool[(slot * 3 + spawn * 5) % pool.length]
}
