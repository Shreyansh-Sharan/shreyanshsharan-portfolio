// Third-party content used by LAWN WARS: shown in the menu's credits panel and mirrored in public/lawn/CREDITS.md.
// Every model and texture is an original made for this project; the only outside content left is the CC0 animation
// library whose clips are baked onto the heroes' skeletons. Rows are copied from the source pages.
export interface Credit {
  use: string
  name: string
  author: string
  authorUrl: string
  url: string
  licence: string
  licenceUrl: string
}

export const CC0 = { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }

export const CHARACTER_CREDITS: Credit[] = [
  { use: 'Hero animations (retargeted onto the heroes)', name: 'Universal Animation Library', author: 'Quaternius', authorUrl: 'https://quaternius.com', url: 'https://quaternius.com/packs/universalanimationlibrary.html', licence: 'CC0 1.0', licenceUrl: CC0.url },
]

/** Downloaded props still in use (none: every prop is an original model). */
export const MODEL_CREDITS: Credit[] = []
