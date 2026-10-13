// Responsive variants of the home screen art (see public/home). A tile's `thumb` and `hero` fields name the default
// WebP file; the other sizes and the AVIF copies sit beside it:
//   thumb  home/tiles/<id>.webp (512)  + <id>.avif, <id>-1024.{avif,webp}
//   hero   home/hero/<id>.webp (1920)  + <id>.avif, <id>-{1280,2560,3840}.{avif,webp}

export const HERO_WIDTHS = [1280, 1920, 2560, 3840] as const
/** Phones and small tablets never get more than this. */
export const HERO_WIDTHS_SMALL = [1280, 1920] as const

const stem = (path: string) => path.replace(/\.webp$/, '')
/** Only the generated art follows the naming scheme; anything else is served as is. */
export const hasVariants = (path: string | undefined): path is string => !!path && path.startsWith('home/') && path.endsWith('.webp')

export function heroSrcSet(hero: string, ext: 'avif' | 'webp', widths: readonly number[] = HERO_WIDTHS) {
  const s = stem(hero)
  return widths.map((w) => `${s}${w === 1920 ? '' : `-${w}`}.${ext} ${w}w`).join(', ')
}

export function thumbSrcSet(thumb: string, ext: 'avif' | 'webp') {
  const s = stem(thumb)
  return `${s}.${ext} 512w, ${s}-1024.${ext} 1024w`
}

/** The 1920 AVIF of a hero (what neighbours are warmed with). */
export const hero1920 = (hero: string) => `${stem(hero)}.avif`

/** The full-bleed backdrop covers the screen: in portrait it is as wide as 16:9 of the height. */
export const HERO_SIZES = '(orientation: portrait) 178vh, 100vw'
export const SMALL_SCREEN = '(max-width: 900px)'

/** Warm the cache with the 1920 AVIF of the tiles either side of the selection (browsers without AVIF skip it). */
const warmed = new Set<string>()
export function preloadHeroes(list: { hero?: string }[], index: number) {
  for (const i of [index + 1, index - 1]) {
    const hero = list[i]?.hero
    if (!hasVariants(hero)) continue
    const href = hero1920(hero)
    if (warmed.has(href)) continue
    warmed.add(href)
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.type = 'image/avif'
    link.href = href
    document.head.appendChild(link)
  }
}
