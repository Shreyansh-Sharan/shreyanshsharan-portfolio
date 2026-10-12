// Seeded random numbers. Every screen builds a level from the same seed, so layouts match without syncing them.

export interface Rng {
  /** 0 ≤ x < 1 */
  next(): number
  /** a ≤ x < b */
  range(a: number, b: number): number
  /** Integer a ≤ n < b */
  int(a: number, b: number): number
  pick<T>(list: readonly T[]): T
  chance(p: number): boolean
  shuffle<T>(list: T[]): T[]
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a) * next()),
    pick: (list) => list[Math.floor(next() * list.length) % list.length],
    chance: (p) => next() < p,
    shuffle: (list) => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const t = list[i]
        list[i] = list[j]
        list[j] = t
      }
      return list
    },
  }
  return rng
}

/** Smooth deterministic noise in about [-1, 1] from a time and a channel: the same on every screen. */
export function wobble(t: number, ch: number) {
  return Math.sin(t * 7.3 + ch * 1.7) * 0.6 + Math.sin(t * 13.1 + ch * 4.1) * 0.3 + Math.sin(t * 23.7 + ch * 2.3) * 0.1
}
