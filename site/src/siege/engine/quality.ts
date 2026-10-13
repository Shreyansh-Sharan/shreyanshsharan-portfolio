// Graphics tiers: resolution, shadows, bloom and particle budget. Auto-detection is shared with the cricket game.
import { detectQuality, type QualityTier } from '../../cricket/quality'

export type { QualityTier }

export interface Quality {
  tier: QualityTier
  level: 0 | 1 | 2
  dpr: number
  shadows: boolean
  shadowMapSize: number
  bloom: boolean
  antialias: boolean
}

export const QUALITY: Record<QualityTier, Quality> = {
  low: { tier: 'low', level: 0, dpr: 1, shadows: false, shadowMapSize: 1024, bloom: false, antialias: false },
  medium: { tier: 'medium', level: 1, dpr: 1.5, shadows: true, shadowMapSize: 1024, bloom: false, antialias: true },
  high: { tier: 'high', level: 2, dpr: 2, shadows: true, shadowMapSize: 2048, bloom: true, antialias: true },
}

export function resolveQuality(choice: QualityTier | 'auto'): Quality {
  return QUALITY[choice === 'auto' ? detectQuality() : choice]
}
