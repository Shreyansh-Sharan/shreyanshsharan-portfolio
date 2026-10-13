// The buttons the home screen offers for a tile, by kind: games get Play Game and Explore Open World, career
// chapters View Details and Explore, the showcase and profile tiles their own equivalents; the "..." menu adds
// details, sharing, the key art viewer and contact links.
import type { LucideIcon } from 'lucide-react'
import { Download, ExternalLink, FileText, Gamepad2, Image as ImageIcon, Info, Briefcase, Mail, Map as MapIcon, Play, Share2 } from 'lucide-react'
import { profile, type Tile } from '../../data/content'
import { tileKind } from '../../data/home'
import { externalGameUrl } from '../../data/gameLinks'

export interface HomeAction {
  id: string
  label: string
  icon: LucideIcon
  /** Run on click (buttons). */
  run?: () => void
  /** Or a link (downloads, external pages). */
  href?: string
  download?: boolean
  external?: boolean
}

export interface ActionContext {
  /** Open an in-site route (with the launch zoom when `zoom`). */
  go: (to: string, zoom?: boolean) => void
  /** Open an external site in a new tab. */
  open: (url: string) => void
  /** Explore the open world at this tile's spot; undefined when the world cannot run. */
  explore?: (tileId: string) => void
  share: (tile: Tile) => void
  viewArt: () => void
}

export interface TileActions {
  primary: HomeAction
  secondary?: HomeAction
  menu: HomeAction[]
}

const resumeLink: HomeAction = { id: 'resume', label: 'Download resume (PDF)', icon: Download, href: profile.resumePdf, download: true }
const linkedin: HomeAction = { id: 'linkedin', label: 'LinkedIn', icon: Briefcase, href: profile.linkedin, external: true }
const email: HomeAction = { id: 'email', label: 'Email', icon: Mail, href: `mailto:${profile.email}` }

export function tileActions(tile: Tile, ctx: ActionContext): TileActions {
  const kind = tileKind(tile)
  const explore: HomeAction | undefined = ctx.explore && {
    id: 'explore',
    label: 'Explore Open World',
    icon: MapIcon,
    run: () => ctx.explore!(tile.id),
  }
  const share: HomeAction = { id: 'share', label: 'Share link', icon: Share2, run: () => ctx.share(tile) }
  const art: HomeAction = { id: 'art', label: 'View key art', icon: ImageIcon, run: ctx.viewArt }
  const quick: HomeAction = { id: 'quick', label: 'Quick View resume', icon: FileText, run: () => ctx.go('#/resume') }

  switch (kind) {
    case 'game': {
      const url = externalGameUrl(tile.id)
      const to = tile.action.kind === 'route' ? tile.action.to : `#/game/${tile.id}`
      return {
        primary: url
          ? { id: 'play', label: 'Play Game', icon: ExternalLink, run: () => ctx.open(url), external: true }
          : { id: 'play', label: 'Play Game', icon: Play, run: () => ctx.go(to, true) },
        secondary: explore,
        menu: [
          { id: 'details', label: 'Game details', icon: Info, run: () => ctx.go(`#/game/${tile.id}`) },
          share,
          art,
          ...(url ? [{ id: 'site', label: 'Open the game site', icon: ExternalLink, href: url, external: true }] : []),
        ],
      }
    }
    case 'career':
      return {
        primary: { id: 'details', label: 'View Details', icon: Info, run: () => ctx.go(`#/game/${tile.id}`, true) },
        secondary: explore,
        menu: [resumeLink, linkedin, email, quick, share, art],
      }
    case 'showcase': {
      if (tile.action.kind === 'iframe') {
        const site = tile.action.url
        return {
          primary: { id: 'open', label: 'Open', icon: Play, run: () => ctx.go(`#/embed/${tile.id}`, true) },
          secondary: explore,
          menu: [
            { id: 'details', label: 'Details', icon: Info, run: () => ctx.go(`#/game/${tile.id}`) },
            { id: 'site', label: 'Open in a new tab', icon: ExternalLink, href: site, external: true },
            share,
            art,
          ],
        }
      }
      break
    }
    case 'profile':
      if (tile.action.kind === 'download') {
        return {
          primary: { id: 'download', label: tile.action.label, icon: Download, href: tile.action.href, download: true },
          secondary: { id: 'quick', label: 'Quick View', icon: FileText, run: () => ctx.go('#/resume') },
          menu: [linkedin, email, share, art],
        }
      }
      break
  }
  // Pages with their own route (the profile, trophies, the skill tree).
  const to = tile.action.kind === 'route' ? tile.action.to : `#/game/${tile.id}`
  const label = tile.action.kind === 'route' ? tile.action.label : 'Open'
  return {
    primary: { id: 'open', label: label.replace(/^\w/, (c) => c.toUpperCase()), icon: tile.id === 'profile' ? Gamepad2 : Play, run: () => ctx.go(to, true) },
    secondary: explore,
    menu: tile.id === 'profile' ? [resumeLink, linkedin, email, quick, share, art] : [resumeLink, share, art],
  }
}
