// A user-set "low graphics" preference, saved like the mute setting. When on, the 3D world always
// takes the light render path (no shadows, post-processing, dense terrain) — a guaranteed fallback
// for weak GPUs / laggy laptops where auto-detection isn't enough.
const KEY = 'ss-low-gfx'

export function isLowGraphics(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setLowGraphics(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    // Storage can be unavailable (private mode); the setting just won't persist.
  }
}
