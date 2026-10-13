// Where each game lives once it has moved to its own repository (see scripts/split-game.mjs). While GAMES_EXTERNAL
// is off, Play still opens the in-repo route; flip it once the external sites are live and Play opens the game in
// a new tab instead. Replace a URL with a custom domain whenever one is set up.

/** Flip to true once the split repositories are deployed. */
export const GAMES_EXTERNAL = false

/** Each game is its own Vercel project on a subdomain of the portfolio's domain (DNS lives in Cloudflare). */
const DOMAIN = 'shreyanshsharan.com'
const sub = (name: string) => `https://${name}.${DOMAIN}/`

/** Tile id → external URL. */
export const GAME_LINKS: Record<string, string> = {
  arena: sub('dunes-arena'),
  cricket: sub('cricket'),
  'volt-riot': sub('volt-riot'),
  'bogey-brawl': sub('bogey-brawl'),
  'plush-panic': sub('plush-panic'),
  'neon-siege': sub('neon-siege'),
  'sports-complex': sub('sports'),
}

/** In-repo route name → tile id, so deep links (`#/racer`) can be redirected too. */
export const ROUTE_TILE: Record<string, string> = {
  arena: 'arena',
  cricket: 'cricket',
  racer: 'volt-riot',
  golf: 'bogey-brawl',
  plush: 'plush-panic',
  siege: 'neon-siege',
  sports: 'sports-complex',
}

/** The external URL for a tile when the games have moved out, else undefined (use the in-repo route). */
export function externalGameUrl(tileId: string): string | undefined {
  return GAMES_EXTERNAL ? GAME_LINKS[tileId] : undefined
}

/** Open a game's site in a new tab (with noopener, browsers return null here, so there is no result to check). */
export function openGame(url: string) {
  window.open(url, '_blank', 'noopener')
}
