import type { CSSProperties } from 'react'

/** CSS custom properties for a tile's two accent colours. */
export function accentVars(accent: [string, string]): CSSProperties {
  return { ['--a' as string]: accent[0], ['--b' as string]: accent[1] }
}
