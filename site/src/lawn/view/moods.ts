// Lighting moods: one preset per time of day and street. Each sets the sky, the key light (sun or moon), the fill
// (hemisphere + image-based light baked from the sky), fog, exposure, the colour grade, bloom, ambient occlusion
// and how bright the interior lamps, window glow and street lamps run.
import type { MapId, TimeOfDay } from '../engine/maps'

export type MoodId = 'sunny' | 'golden' | 'night' | 'snowday' | 'snownight'

export interface Mood {
  id: MoodId
  night: boolean
  snow: boolean
  sky: { zenith: string; horizon: string; ground: string; sun: string; glow: number; disc: number; clouds: number; cloudTint: string; stars: number }
  /** Sun (or moon) azimuth and elevation in degrees; azimuth 0 looks down +z, 90 down +x. */
  sunAz: number
  sunEl: number
  sunColour: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  envIntensity: number
  fog: string
  fogNear: number
  fogFar: number
  exposure: number
  grade: { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number]; saturation: number; contrast: number; vignette: number }
  bloom: { intensity: number; threshold: number }
  ao: number
  /** Interior lamp intensity scale (0 = off), indoor ambient scale, window glow, street and porch lamps on. */
  lamps: number
  indoor: number
  windows: number
  street: boolean
}

export const MOODS: Record<MoodId, Mood> = {
  sunny: {
    id: 'sunny',
    night: false,
    snow: false,
    sky: { zenith: '#3f86e0', horizon: '#cfe6fb', ground: '#7d8f62', sun: '#fff1d0', glow: 0.55, disc: 30, clouds: 0.55, cloudTint: '#ffffff', stars: 0 },
    sunAz: 145,
    sunEl: 50,
    sunColour: '#fff0d6',
    sunIntensity: 3.1,
    hemiSky: '#cfe2ff',
    hemiGround: '#7f8a5a',
    hemiIntensity: 0.35,
    envIntensity: 0.75,
    fog: '#cfe3f6',
    fogNear: 70,
    fogFar: 260,
    exposure: 0.95,
    grade: { lift: [0.01, 0.008, 0.0], gamma: [1.0, 1.0, 0.98], gain: [1.02, 1.0, 0.97], saturation: 1.12, contrast: 1.06, vignette: 0.28 },
    bloom: { intensity: 0.25, threshold: 1.05 },
    ao: 0.85,
    lamps: 1.15,
    indoor: 0.6,
    windows: 0,
    street: false,
  },
  golden: {
    id: 'golden',
    night: false,
    snow: false,
    sky: { zenith: '#4a76c4', horizon: '#f6c690', ground: '#6f6248', sun: '#ffb46a', glow: 1.0, disc: 40, clouds: 0.5, cloudTint: '#ffd2a8', stars: 0 },
    sunAz: 292,
    sunEl: 14,
    sunColour: '#ffb26a',
    sunIntensity: 3.0,
    hemiSky: '#a9bde6',
    hemiGround: '#6e5c3e',
    hemiIntensity: 0.35,
    envIntensity: 0.7,
    fog: '#e3c4a4',
    fogNear: 60,
    fogFar: 230,
    exposure: 1.0,
    grade: { lift: [0.015, 0.006, 0.0], gamma: [1.02, 1.0, 0.95], gain: [1.06, 0.99, 0.9], saturation: 1.12, contrast: 1.08, vignette: 0.34 },
    bloom: { intensity: 0.4, threshold: 1.0 },
    ao: 1.0,
    lamps: 1.1,
    indoor: 0.58,
    windows: 0.25,
    street: false,
  },
  night: {
    id: 'night',
    night: true,
    snow: false,
    sky: { zenith: '#050a1e', horizon: '#1f2d55', ground: '#0d1218', sun: '#c7d6ff', glow: 0.25, disc: 6, clouds: 0.25, cloudTint: '#3a4a70', stars: 1 },
    sunAz: 140,
    sunEl: 38,
    sunColour: '#9db4ff',
    sunIntensity: 0.55,
    hemiSky: '#3b4f8a',
    hemiGround: '#141a24',
    hemiIntensity: 0.3,
    envIntensity: 0.6,
    fog: '#121c38',
    fogNear: 28,
    fogFar: 140,
    exposure: 1.25,
    grade: { lift: [0.0, 0.006, 0.02], gamma: [0.98, 1.0, 1.04], gain: [1.02, 1.0, 1.04], saturation: 1.1, contrast: 1.08, vignette: 0.42 },
    bloom: { intensity: 0.85, threshold: 0.75 },
    ao: 0.9,
    lamps: 1.6,
    indoor: 0.5,
    windows: 1.6,
    street: true,
  },
  snowday: {
    id: 'snowday',
    night: false,
    snow: true,
    sky: { zenith: '#6f9fd6', horizon: '#e6eef6', ground: '#dde6ee', sun: '#fff5e6', glow: 0.5, disc: 25, clouds: 0.75, cloudTint: '#f4f7fb', stars: 0 },
    sunAz: 140,
    sunEl: 32,
    sunColour: '#fff4e4',
    sunIntensity: 2.5,
    hemiSky: '#d6e4f6',
    hemiGround: '#c9d3df',
    hemiIntensity: 0.35,
    envIntensity: 0.7,
    fog: '#dfe8f1',
    fogNear: 55,
    fogFar: 220,
    exposure: 0.82,
    grade: { lift: [0.0, 0.004, 0.012], gamma: [0.99, 1.0, 1.02], gain: [0.99, 1.0, 1.03], saturation: 1.08, contrast: 1.07, vignette: 0.3 },
    bloom: { intensity: 0.22, threshold: 1.1 },
    ao: 1.0,
    lamps: 1.15,
    indoor: 0.6,
    windows: 0.1,
    street: false,
  },
  snownight: {
    id: 'snownight',
    night: true,
    snow: true,
    sky: { zenith: '#070d1f', horizon: '#26385e', ground: '#232c3c', sun: '#cbd9ff', glow: 0.3, disc: 6, clouds: 0.35, cloudTint: '#46557a', stars: 0.8 },
    sunAz: 150,
    sunEl: 40,
    sunColour: '#a9bfff',
    sunIntensity: 0.6,
    hemiSky: '#45599a',
    hemiGround: '#3a4560',
    hemiIntensity: 0.32,
    envIntensity: 0.6,
    fog: '#17223a',
    fogNear: 26,
    fogFar: 130,
    exposure: 1.1,
    grade: { lift: [0.0, 0.006, 0.022], gamma: [0.98, 1.0, 1.04], gain: [1.02, 1.0, 1.04], saturation: 1.08, contrast: 1.08, vignette: 0.42 },
    bloom: { intensity: 0.85, threshold: 0.75 },
    ao: 0.9,
    lamps: 1.6,
    indoor: 0.5,
    windows: 1.6,
    street: true,
  },
}

/** The mood for a match: snowy streets get the snow presets; some sunny matches play out at golden hour. */
export function moodFor(map: MapId, time: TimeOfDay, seed: number, override?: string | null): Mood {
  if (override && override in MOODS) return MOODS[override as MoodId]
  const snow = map === 'snowline'
  if (time === 'night') return MOODS[snow ? 'snownight' : 'night']
  if (snow) return MOODS.snowday
  return MOODS[seed % 4 === 3 ? 'golden' : 'sunny']
}
