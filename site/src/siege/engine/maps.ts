// Hand-written layouts on a 2 m grid. Arena maps are written as a left half and mirrored; the battle-royale map
// is a quadrant mirrored both ways, then the sim sprinkles extra crates from the match seed.
//
//   Tall (block walking, bullets and grenades):  #  wall   n  wall with a neon sign   h  holo-ad pillar
//                                                k  transformer kiosk / generator     U  box truck (runs of U = one truck)
//   Low cover (block walking and bullets, grenades lob over):  =  barrier   T  taxi   d  dumpster   s  sandbags
//   Destructible cover:  x  crate   b  barrel stack          ~  void / drop (blocks walking only)
//   Floor:  .   l  streetlight (decor)   A  B  team spawns   S  solo spawn   *  objective   $  loot crate (battle royale)

export type MapId = 'kessho' | 'helipad' | 'underpass' | 'sector'
export type Theme = 'street' | 'roof' | 'subway' | 'district'

export interface MapDef {
  id: MapId
  name: string
  blurb: string
  theme: Theme
  /** Cells across / down. */
  w: number
  h: number
  rows: string[]
  /** Objective zone radius (m) for Core Control. */
  zone: number
  /** Accent colours: [neon, floor tint]. */
  colors: [string, string]
  br: boolean
  /** Power-up pads in metres. Mirrored pads share a slot (same rotation of kinds); centre pads run their own. */
  pads: PadSpot[]
}

export interface PadSpot {
  x: number
  z: number
  slot: number
  centre: boolean
}

/** Pads from cell coordinates on the left half (mirrored across x), the top-left quadrant (`both`), plus centre pads. */
function pads(w: number, h: number, half: [number, number][], centre: [number, number][], both = false): PadSpot[] {
  const out: PadSpot[] = []
  const m = (c: number) => (c + 0.5) * CELL
  half.forEach(([cx, cz], slot) => {
    out.push({ x: m(cx), z: m(cz), slot, centre: false }, { x: m(w - 1 - cx), z: m(cz), slot, centre: false })
    if (both) out.push({ x: m(cx), z: m(h - 1 - cz), slot, centre: false }, { x: m(w - 1 - cx), z: m(h - 1 - cz), slot, centre: false })
  })
  centre.forEach(([cx, cz], i) => out.push({ x: m(cx), z: m(cz), slot: 100 + i, centre: true }))
  return out
}

export const CELL = 2

function mirrorX(half: string[]): string[] {
  const swap = (c: string) => (c === 'A' ? 'B' : c === 'B' ? 'A' : c)
  return half.map((r) => r + [...r].reverse().map(swap).join(''))
}

function mirrorY(top: string[]): string[] {
  return [...top, ...[...top].reverse()]
}

const KESSHO = mirrorX([
  '############',
  '#A.......l..',
  '#A...x......',
  '#A....#n....',
  '#.....#.....',
  '#..T..k..x..',
  '#..T.....x..',
  '#.......dd..',
  '#..##.......',
  '#..##..l..*.',
  '#.......ss..',
  '#..T.....x..',
  '#..T..k..x..',
  '#.....#.....',
  '#A....#n....',
  '#A...b......',
  '#A.......l..',
  '############',
])

const HELIPAD = mirrorX([
  '~~~~~~~~~~~~',
  '~A.......~~~',
  '~A..x....~~~',
  '~A......s~~~',
  '~....k...~~~',
  '~....#....~~',
  '~~~......~~~',
  '~~~~.....b..',
  '~~~~..=.....',
  '~~~~..=...*.',
  '~~~~.....b..',
  '~~~......~~~',
  '~....#....~~',
  '~....k...~~~',
  '~A......s~~~',
  '~A..x....~~~',
  '~A.......~~~',
  '~~~~~~~~~~~~',
])

const UNDERPASS = mirrorX([
  '############',
  '#A....h.....',
  '#A..........',
  '#A..#..x..d.',
  '#...#.......',
  '#.......b...',
  '#==.........',
  '#~~~.~~~~.~.',
  '#~~~.~~~~.~*',
  '#~~~.~~~~.~.',
  '#~~~.~~~~.~.',
  '#==.........',
  '#.......b...',
  '#...#.......',
  '#A..#..x..d.',
  '#A..........',
  '#A....h.....',
  '############',
])

const SECTOR = mirrorY(
  mirrorX([
    '########################',
    '#S.....S......S.......S.',
    '#......x.....l...x......',
    '#..##......$.......##...',
    '#..##..........T...##...',
    '#........h......T.......',
    '#S..b......##.......$...',
    '#..........##.....l.....',
    '#...$...........x..kk...',
    '#......UU.....##...kk...',
    '#......=.$....##........',
    '#..##..........~~.......',
    '#S.##....x.....~~..b....',
    '#.....l........~~.......',
    '#....$...##..........$..',
    '#........##...d....x....',
    '#...x.........d.........',
    '#........$.....##.......',
    '#S......s......##...nn..',
    '#.......s...........n...',
    '#...##.........$........',
    '#...##....b.........l...',
    '#............T..........',
    '#.....$......UU....x..$.',
  ]),
)

export const MAPS: Record<MapId, MapDef> = {
  kessho: {
    id: 'kessho',
    name: 'Kessho Row',
    blurb: 'A neon street block: shop fronts, parked taxis and one lit-up crossing.',
    theme: 'street',
    w: 24,
    h: 18,
    rows: KESSHO,
    zone: 3.2,
    colors: ['#f0abfc', '#1a1030'],
    br: false,
    pads: pads(24, 18, [[8, 4], [8, 13]], [[11.5, 8]]),
  },
  helipad: {
    id: 'helipad',
    name: 'Helipad Seven',
    blurb: 'Two rooftop pads joined by a windy bridge. Mind the drop.',
    theme: 'roof',
    w: 24,
    h: 18,
    rows: HELIPAD,
    zone: 3.2,
    colors: ['#22d3ee', '#0f1a2a'],
    br: false,
    pads: pads(24, 18, [[7, 7], [7, 10]], [[11.5, 8]]),
  },
  underpass: {
    id: 'underpass',
    name: 'Underpass Nine',
    blurb: 'Two platforms, a track trench and three crossings. Snipers love it.',
    theme: 'subway',
    w: 24,
    h: 18,
    rows: UNDERPASS,
    zone: 3.2,
    colors: ['#facc15', '#171a22'],
    br: false,
    pads: pads(24, 18, [[6, 4], [6, 13]], [[11.5, 2], [11.5, 15]]),
  },
  sector: {
    id: 'sector',
    name: 'Sector Grid',
    blurb: 'Four districts around a central plaza. The grid closes in; loot crates hold the gear.',
    theme: 'district',
    w: 48,
    h: 48,
    rows: SECTOR,
    zone: 0,
    colors: ['#f0abfc', '#120c22'],
    br: true,
    pads: pads(48, 48, [[6, 4], [11, 13], [21, 21]], [[23.5, 23.5]], true),
  },
}

export const ARENA_MAPS: MapId[] = ['kessho', 'helipad', 'underpass']

/** Cell classes the simulation cares about. */
export type CellKind = 'floor' | 'wall' | 'low' | 'crate' | 'void'

export function cellKind(c: string): CellKind {
  switch (c) {
    case '#':
    case 'n':
    case 'h':
    case 'k':
    case 'U':
      return 'wall'
    case '=':
    case 'T':
    case 'd':
    case 's':
      return 'low'
    case 'x':
    case 'b':
    case '$':
      return 'crate'
    case '~':
      return 'void'
    default:
      return 'floor'
  }
}
