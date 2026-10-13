// Graphics tiers: resolution, shadows, particle budget and post effects. Auto-detection is shared with the other games.
import { detectQuality, type QualityTier } from '../../cricket/quality'

export type { QualityTier }

export interface Quality {
  tier: QualityTier
  level: 0 | 1 | 2
  dpr: number
  shadows: boolean
  shadowMapSize: number
  /** Particle pool size. */
  particles: number
  antialias: boolean
  /** Weather particles (rain / snow) count. */
  weather: number
  /** Fracture chunks per broken piece. */
  chunks: number
  /** Post stack (bloom, tone mapping, grade) and its MSAA samples; ambient occlusion samples (0 = off). */
  post: boolean
  msaa: number
  aoSamples: number
  /** Half size of the sun's shadow box that follows the camera (metres), and its PCF blur radius. */
  shadowExtent: number
  shadowRadius: number
  /** Warm lamps per house interior (0 = none by day, one per storey at night). */
  lamps: number
}

export const QUALITY: Record<QualityTier, Quality> = {
  low: { tier: 'low', level: 0, dpr: 1, shadows: false, shadowMapSize: 1024, particles: 500, antialias: false, weather: 300, chunks: 6, post: false, msaa: 0, aoSamples: 0, shadowExtent: 26, shadowRadius: 1, lamps: 0 },
  medium: { tier: 'medium', level: 1, dpr: 1.5, shadows: true, shadowMapSize: 2048, particles: 1200, antialias: true, weather: 900, chunks: 9, post: true, msaa: 2, aoSamples: 8, shadowExtent: 30, shadowRadius: 3, lamps: 6 },
  high: { tier: 'high', level: 2, dpr: 2, shadows: true, shadowMapSize: 4096, particles: 2500, antialias: true, weather: 1800, chunks: 12, post: true, msaa: 4, aoSamples: 12, shadowExtent: 36, shadowRadius: 3, lamps: 8 },
}

export function resolveQuality(choice: QualityTier | 'auto'): Quality {
  return QUALITY[choice === 'auto' ? detectQuality() : choice]
}
