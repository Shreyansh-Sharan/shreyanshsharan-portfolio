// Career save (localStorage) and Fan Level maths.
import { CONFIG } from './config'
import type { PowerType } from './track'

export interface Save {
  fans: number
  lights: Record<string, number> // best Lights per event
  seriesWins: number
}

export function readSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem('volt-riot') ?? '') as Save
    return { fans: s.fans ?? 0, lights: s.lights ?? {}, seriesWins: s.seriesWins ?? 0 }
  } catch {
    return { fans: 0, lights: {}, seriesWins: 0 }
  }
}

export function writeSave(s: Save) {
  try {
    localStorage.setItem('volt-riot', JSON.stringify(s))
  } catch {
    // Private mode: progress just isn't kept.
  }
}

export function fanLevel(fans: number) {
  const base = CONFIG.fan_level_base
  const level = Math.min(CONFIG.fan_level_cap, Math.floor(Math.sqrt(fans / base)) + 1)
  const cur = base * (level - 1) ** 2
  const next = base * level ** 2
  return { level, progress: level >= CONFIG.fan_level_cap ? 1 : (fans - cur) / (next - cur), next }
}

export const POWER_NAMES: Record<PowerType, string> = {
  shunt: 'Shunt', barge: 'Barge', bolt: 'Bolt', mine: 'Mine', shock: 'Shock', nitro: 'Nitro', shield: 'Shield', repair: 'Repair',
  rail: 'Railgun', flak: 'Flak', oil: 'Oil Slick', ram: 'Ram',
}

