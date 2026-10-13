// In-engine renders of each hero (public/siege/portraits, made by the portrait tool from the live models).
import type { HeroId } from './engine/heroes'

const base = `${import.meta.env.BASE_URL}siege/portraits/`

/** 256² head-and-shoulders portrait. */
export const portrait = (hero: HeroId) => `${base}${hero}.webp`
/** 320×480 full-body card. */
export const heroCard = (hero: HeroId) => `${base}${hero}-card.webp`
