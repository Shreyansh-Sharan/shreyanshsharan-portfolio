// Seeded random numbers so a match (and its tests) replay the same way from the same seed.
export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9
  }
  /** [0, 1) */
  next() {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next()
  }
  int(n: number) {
    return Math.floor(this.next() * n)
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }
  chance(p: number) {
    return this.next() < p
  }
}

export function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
