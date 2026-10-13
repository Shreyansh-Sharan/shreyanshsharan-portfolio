// Frame-time buckets for the game loop (window.__cricket.profile in tests): how many milliseconds each part of the
// frame takes, the longest frame, long tasks and the JS heap growth per frame. Cheap enough to leave on.
export interface Bucket {
  n: number
  total: number
  max: number
  /** Frames over 6 ms. */
  slow: number
}

export class Profile {
  buckets: Record<string, Bucket> = {}
  frames = 0
  longTasks = 0
  longTaskMs = 0
  /** Bytes of JS heap growth summed over frames (allocation rate, roughly). */
  allocBytes = 0
  private heapAtStart = 0
  private observer: PerformanceObserver | null = null

  constructor() {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longTasks++
          this.longTaskMs += e.duration
        }
      })
      this.observer.observe({ entryTypes: ['longtask'] })
    } catch {
      this.observer = null
    }
  }

  now() {
    return performance.now()
  }

  /** Adds the time since `t0` to a bucket and returns the current time (to chain measurements). */
  add(name: string, t0: number) {
    const t = performance.now()
    const ms = t - t0
    let b = this.buckets[name]
    if (!b) b = this.buckets[name] = { n: 0, total: 0, max: 0, slow: 0 }
    b.n++
    b.total += ms
    if (ms > b.max) b.max = ms
    if (ms > 6) b.slow++
    return t
  }

  frameStart() {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    this.heapAtStart = mem ? mem.usedJSHeapSize : 0
  }

  frameEnd() {
    this.frames++
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    if (mem && this.heapAtStart > 0) {
      const d = mem.usedJSHeapSize - this.heapAtStart
      if (d > 0) this.allocBytes += d
    }
  }

  reset() {
    this.buckets = {}
    this.frames = 0
    this.longTasks = 0
    this.longTaskMs = 0
    this.allocBytes = 0
  }

  /** A table of mean and max milliseconds per bucket. */
  report() {
    const rows: Record<string, { mean: number; max: number; slow: number; n: number }> = {}
    for (const [k, b] of Object.entries(this.buckets)) rows[k] = { mean: +(b.total / Math.max(1, b.n)).toFixed(3), max: +b.max.toFixed(2), slow: b.slow, n: b.n }
    return { frames: this.frames, longTasks: this.longTasks, longTaskMs: +this.longTaskMs.toFixed(1), allocKbPerFrame: +(this.allocBytes / 1024 / Math.max(1, this.frames)).toFixed(1), rows }
  }

  dispose() {
    this.observer?.disconnect()
  }
}
