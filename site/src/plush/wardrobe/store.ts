// What this browser's player owns and has earned: free items, bought items, claw prizes and challenge unlocks
// (worked out from the saved profile and the Loft records). Pure functions over the Profile.
import type { EmoteKey } from '../engine/rig'
import type { Profile } from '../engine/show'
import { loadRecords } from '../levels/loft/records'
import { FREE, ITEMS, type ChallengeStats, type Item } from './catalog'

export function ownedSet(p: Pick<Profile, 'owned'>): Set<string> {
  return new Set([...FREE, ...(p.owned ?? [])])
}

export function challengeStats(p: Profile): ChallengeStats {
  const r = loadRecords()
  return {
    shows: p.shows,
    wins: p.wins,
    menace: p.awards?.menace ?? 0,
    freezeBest: r.best.freeze,
    vineBest: r.best.vine,
    bowlBest: r.best.bowl,
    clawWins: r.best.claw,
  }
}

/** Challenge items whose goal is met but which aren't in the wardrobe yet. */
export function earnedChallenges(p: Profile): Item[] {
  const owned = ownedSet(p)
  const s = challengeStats(p)
  return ITEMS.filter((i) => i.how === 'challenge' && !owned.has(i.id) && i.test?.(s))
}

/** Emotes on the Loft keys: the three everyone has, then unlocked ones. */
export function emotesOwned(p: Pick<Profile, 'owned'>): EmoteKey[] {
  const owned = ownedSet(p)
  const extra = ITEMS.filter((i) => i.emote && owned.has(i.id)).map((i) => i.emote!)
  return ['wave', 'dance', 'stomp', ...extra]
}
