// Fast travel to a portfolio tile's spot on the island: a game's arcade cabinet on the plaza, the stadium gate for
// the sports games, a career chapter's plaque (or its board on the harbour timeline), the trophy hall, the skills
// signpost. Used by the home screen's "Explore Open World" (via world.arrive, consumed when the player spawns) and by
// the in-world arcade (a teleport while already exploring).
import { tiles } from '../data/content'
import { REGIONS, regionForTile } from './regions'
import { arcadeDoor, exhibits, stadiumGate } from './exhibits'
import { world } from './store'

export interface TravelSpot {
  x: number
  z: number
  /** The point to face on arrival. */
  lookX: number
  lookZ: number
  label: string
}

/** Stand `d` metres from (tx, tz) along the heading `yaw` (0 = +z) and face it. */
function before(tx: number, tz: number, yaw: number, d: number, label: string): TravelSpot {
  return { x: tx + Math.sin(yaw) * d, z: tz + Math.cos(yaw) * d, lookX: tx, lookZ: tz, label }
}

const SPORTS_GATE = new Set(['cricket', 'sports-complex'])

export function travelSpot(tileId: string): TravelSpot {
  const title = tiles.find((t) => t.id === tileId)?.title ?? tileId
  const ex = exhibits()
  const find = (id: string) => ex.find((e) => e.id === id)

  if (SPORTS_GATE.has(tileId)) {
    const g = stadiumGate()
    return before(g.x, g.z, 0, 4.5, 'Stadium gate')
  }
  const cabinet = find(`cabinet:${tileId}`)
  if (cabinet) return before(cabinet.x, cabinet.z, cabinet.yaw, 3.2, `Games Plaza · ${title} cabinet`)
  if (tileId === 'lawn-wars') {
    const d = arcadeDoor()
    return before(d.x, d.z, 0, 6, 'Games Plaza · the arcade')
  }
  if (tileId === 'trophies') {
    const t = find('trophy:4')
    if (t) return before(t.x, t.z, t.yaw, 4, 'Khotyn Keep · trophy hall')
  }
  if (tileId === 'skill-tree') {
    const s = find('sign:0')
    if (s) return before(s.x, s.z, Math.PI / 2, 4, 'Harbour Town · skills signpost')
  }
  if (tileId === 'profile' || tileId === 'resume') {
    const p = find('plaque:profile')
    if (p) return before(p.x, p.z, p.yaw, 4, 'Harbour Town · welcome plaque')
  }
  const plaque = find(`plaque:${tileId}`)
  if (plaque) {
    const r = REGIONS.find((x) => x.tile === tileId)
    return before(plaque.x, plaque.z, plaque.yaw, 4, `${r?.name ?? 'District'} · ${title}`)
  }
  const board = find(`timeline:${tileId}`)
  if (board) return before(board.x, board.z, board.yaw, 3.5, `Harbour Town · career timeline · ${title}`)

  const r = regionForTile(tileId)
  const bx = r.center[0] + r.beacon[0], bz = r.center[1] + r.beacon[1]
  return { x: bx + 3, z: bz + 4, lookX: r.center[0], lookZ: r.center[1], label: r.name }
}

/** Camera heading (the player's camYaw convention) for standing at (x, z) and looking at (tx, tz). */
export const yawToward = (x: number, z: number, tx: number, tz: number) => Math.atan2(x - tx, z - tz)

/** Teleport while already exploring. */
export function teleportTo(tileId: string) {
  const s = travelSpot(tileId)
  world.set({ teleport: { x: s.x, z: s.z, n: (world.get().teleport?.n ?? 0) + 1, yaw: yawToward(s.x, s.z, s.lookX, s.lookZ) }, panel: 'none', hubTile: null })
  world.notify(`Fast travel: ${s.label}`)
}
