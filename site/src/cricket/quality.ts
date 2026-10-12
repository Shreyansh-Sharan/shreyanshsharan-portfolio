// Graphics quality tiers that actually change the cost: resolution, shadows, crowd density, ambient occlusion,
// character detail. Auto-detected like the site's 3D world (and the user's "low graphics" choice always wins).
import { isLowGraphics } from '../lib/graphics'

export type QualityTier = 'low' | 'medium' | 'high'

export interface QualitySettings {
  tier: QualityTier
  /** Max device pixel ratio. */
  dpr: number
  shadows: boolean
  shadowMapSize: number
  /** Spectators in the stands. */
  crowd: number
  /** Screen-space ambient occlusion (N8AO-like SAO pass) and bloom. */
  post: boolean
  antialias: boolean
  /** Fielders use the low-detail body beyond this distance (m); 0 = always. */
  lodDistance: number
  /** Stadium detail: roofs, floodlight towers' lamps, extra stand tiers. */
  detail: number
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: { tier: 'low', dpr: 1, shadows: false, shadowMapSize: 1024, crowd: 2200, post: false, antialias: false, lodDistance: 0, detail: 0 },
  medium: { tier: 'medium', dpr: 1.25, shadows: true, shadowMapSize: 1024, crowd: 6000, post: false, antialias: true, lodDistance: 35, detail: 1 },
  high: { tier: 'high', dpr: 2, shadows: true, shadowMapSize: 2048, crowd: 12000, post: true, antialias: true, lodDistance: 70, detail: 2 },
}

const KEY = 'cricket-quality'

function weakGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const r = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    return /(Intel.*(HD|UHD) Graphics|Microsoft Basic Render|SwiftShader|llvmpipe|Software)/i.test(r)
  } catch {
    return false
  }
}

/** What this device can probably run. */
export function detectQuality(): QualityTier {
  if (isLowGraphics()) return 'low'
  const small = window.innerWidth < 820 || matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
  if (small || weakGpu() || mem <= 2) return 'low'
  if (cores <= 4 || mem <= 4) return 'medium'
  return 'high'
}

/** The saved choice ('auto' when none). */
export function savedQuality(): QualityTier | 'auto' {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'low' || v === 'medium' || v === 'high' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveQuality(q: QualityTier | 'auto') {
  try {
    if (q === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, q)
  } catch {
    // Not remembered.
  }
}

export function resolveQuality(q: QualityTier | 'auto' = savedQuality()): QualityTier {
  return q === 'auto' ? detectQuality() : q
}
