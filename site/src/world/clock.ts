// The world's day/night clock. Runs only while exploring (the fly-over behind the site stays in daylight), and
// is the one thing the night-only creatures key off. Framework-free, like controls.ts.

/** One full day, in seconds of play. */
export const DAY_LENGTH = 420

export const dayClock = {
  /** Time of day, 0..1 (0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight). */
  t: 0.12,
  /** Advancing (explore mode) or held (the site). */
  running: false,
  /** Seconds of simulated time since the session started (respawn timers count in this). */
  now: 0,
}

export function stepClock(dt: number) {
  dayClock.now += dt
  if (dayClock.running) dayClock.t = (dayClock.t + dt / DAY_LENGTH) % 1
}

/** Night runs from dusk to dawn. */
export const isNight = () => dayClock.t > 0.55 && dayClock.t < 0.95

/** How much daylight there is, 0 (deep night) .. 1 (full day), with soft dusk and dawn. */
export function daylight() {
  if (!dayClock.running) return 1
  const t = dayClock.t
  const edge = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)))
  // Dusk from 0.5 to 0.58, dawn from 0.92 to 1.0.
  return 1 - (edge(0.5, 0.58) * (1 - edge(0.92, 1)))
}
