// Hero portraits rendered in-engine (see scratchpad tools) and saved under public/lawn/portraits/.
import type { HeroId } from './engine/heroes'

const base = `${import.meta.env.BASE_URL}lawn/portraits/`

export function portrait(id: HeroId) {
  return `${base}${id}.webp`
}

export function heroCard(id: HeroId) {
  return `${base}${id}-card.webp`
}
