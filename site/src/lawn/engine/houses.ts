// The modular house kit: two floors of wall panels laid out on a facade grid (doors and windows line up storey to
// storey), an interior with stairs, a front porch whose roof is the upstairs balcony, a pitched roof over the whole
// upper storey (gable, hip or cross-gable, by house style) that can be climbed and walked on, an attached garage
// under its own gable, a chimney on the gable wall, and furniture plus the tagged valuables placed by a layout
// preset. Built in a local frame (front faces +z, front door at x = 0) and mirrored into the world per household.
import { VALUABLES, type ValuableKind } from './gear.ts'
import { makePiece, type Piece } from './pieces.ts'

export type LayoutId = 'classic' | 'bunker' | 'spread' | 'garage'
export const LAYOUTS: Record<LayoutId, { name: string; blurb: string }> = {
  classic: { name: 'Classic', blurb: 'TV and aquarium in the living room, trophies upstairs, mower in the garage.' },
  bunker: { name: 'Bunker', blurb: 'Everything that fits goes upstairs. Hold the stairs.' },
  spread: { name: 'Spread out', blurb: 'One valuable per room. Raiders have to cover the whole house.' },
  garage: { name: 'Garage sale', blurb: 'The garage holds the big ones behind one tough door.' },
}

export const WALL_HP = 120
export const INNER_WALL_HP = 90
export const DOOR_HP = 80
export const BARRICADE_HP = 120
export const GARAGE_HP = 180
export const WINDOW_HP = 25
export const FURNITURE_HP = 55
export const FLOOR_H = 3.2
/** Top of the upper-storey walls: the attic floor the roof sits on. */
export const ROOF_Y = 6.2
/** Storey wall height. */
export const WALL_H = 3.0
/** Window sill and head heights above the storey floor; doors share the head height. */
export const SILL_H = 0.9
export const HEAD_H = 2.2

/* ---------- roof geometry (shared by the sim's walkable steps and the view's roof planes) ---------- */

/** Half extents of the main block's outer wall faces. */
export const MAIN_HX = 6.15
export const MAIN_HZ = 4.65
/** Eave overhang past the wall face, and the rake overhang at gable ends. */
export const EAVE_OH = 0.5
export const RAKE_OH = 0.3
/** Height of the eave edge (bottom of the roof plane at the drip edge). */
export const EAVE_Y = 6.25
/** Rise over run: a 8-in-12 pitch. Walkable as 0.3 m steps every 0.45 m. */
export const PITCH = 0.3 / 0.45
export const STEP_RUN = 0.45
/** Garage block (local, outer faces) and its gable roof, ridge running front to back. */
export const GARAGE = { x0: 6.15, x1: 10.15, z0: -4.65, z1: 1.65, ridgeX: 8.15, eaveY: 3.05, oh: 0.4 }
/** The front porch: deck footprint, posts and the balcony on its roof. */
export const PORCH = { x0: -2.2, x1: 2.2, z0: 4.65, z1: 6.85, deck: 0.18 }
/** The cross gable's half width over the porch bay (outer edge of its rake). */
export const CROSS_HW = 2.6

export type RoofKind = 'gable' | 'hip' | 'cross'
export interface HouseStyle {
  roof: RoofKind
  /** 5 bays: four single windows a floor plus the door bay; 3 bays: two wide double windows a floor. */
  bays: 3 | 5
  /** Ground storey dressed in brick (the upper storey keeps the siding). */
  brick: boolean
  /** Square craftsman posts or round columns on the porch. */
  columns: 'square' | 'round'
}

const STYLES: Record<string, HouseStyle> = {
  lemon: { roof: 'gable', bays: 5, brick: false, columns: 'round' },
  mint: { roof: 'cross', bays: 3, brick: true, columns: 'square' },
  coral: { roof: 'hip', bays: 5, brick: false, columns: 'round' },
  sky: { roof: 'gable', bays: 3, brick: true, columns: 'square' },
  timber: { roof: 'hip', bays: 3, brick: true, columns: 'square' },
  slate: { roof: 'cross', bays: 5, brick: false, columns: 'square' },
}

export function houseStyle(theme: string): HouseStyle {
  return STYLES[theme] ?? STYLES.lemon
}

/** Window centres (local x) along the front and back walls, and their width. */
export function facadeBays(style: HouseStyle) {
  return style.bays === 5 ? { xs: [-4.4, -2.2, 2.2, 4.4], w: 1.0 } : { xs: [-3.6, 3.6], w: 1.6 }
}

export interface RoofBox {
  x0: number
  x1: number
  z0: number
  z1: number
  /** Bottom and top of the step. */
  y0: number
  y1: number
}

/**
 * The roof as nested steps (local coords): each a box from the attic floor up to the roof plane at its mid run, so
 * the surface climbs 0.3 m every 0.45 m. Walkable with the normal step-up, and the view draws the smooth planes.
 */
export function roofSteps(style: HouseStyle): RoofBox[] {
  const out: RoofBox[] = []
  const ex = MAIN_HX + (style.roof === 'hip' ? EAVE_OH : RAKE_OH)
  const ez = MAIN_HZ + EAVE_OH
  for (let i = 0; ; i++) {
    const hz = ez - STEP_RUN * i
    if (hz < 0.15) break
    const hx = style.roof === 'hip' ? ex - STEP_RUN * i : ex
    if (hx < 0.15) break
    out.push({ x0: -hx, x1: hx, z0: -hz, z1: hz, y0: ROOF_Y, y1: EAVE_Y + PITCH * STEP_RUN * (i + 0.5) })
  }
  if (style.roof === 'cross') {
    // The cross gable over the porch bay: ridge front to back, meeting the main slope at the valley.
    const back = MAIN_HZ + EAVE_OH - CROSS_HW
    for (let j = 0; ; j++) {
      const hx = CROSS_HW - STEP_RUN * j
      if (hx < 0.15) break
      out.push({ x0: -hx, x1: hx, z0: back, z1: MAIN_HZ + EAVE_OH, y0: ROOF_Y, y1: EAVE_Y + PITCH * STEP_RUN * (j + 0.5) })
    }
  }
  return out
}

/** The garage's walkable gable steps (local coords). */
export function garageSteps(): RoofBox[] {
  const out: RoofBox[] = []
  const g = GARAGE
  const hw = g.x1 + g.oh - g.ridgeX
  for (let i = 0; ; i++) {
    const h = hw - STEP_RUN * i
    if (h < 0.15) break
    out.push({ x0: Math.max(g.x0, g.ridgeX - h), x1: g.ridgeX + h, z0: g.z0 - 0.3, z1: g.z1 + 0.3, y0: WALL_H, y1: g.eaveY + PITCH * STEP_RUN * (i + 0.5) })
  }
  return out
}

/** Main roof ridge height, for the chimney and the view. */
export function ridgeY(style: HouseStyle) {
  void style
  return EAVE_Y + PITCH * (MAIN_HZ + EAVE_OH)
}

export interface Waypoint {
  x: number
  z: number
  y: number
}

export interface HouseInfo {
  team: number
  ox: number
  oz: number
  /** +1 faces +z, -1 faces -z (mirrored). */
  dir: number
  style: HouseStyle
  pieces: Piece[]
  /** Footprint of the main house and the garage. */
  main: { x0: number; z0: number; x1: number; z1: number }
  garage: { x0: number; z0: number; x1: number; z1: number }
  spawns: { x: number; z: number; yaw: number }[]
  doors: Piece[]
  valuables: Piece[]
  stairs: { bottom: Waypoint; top: Waypoint; path: Waypoint[] }
  balcony: Waypoint
  balconyDoor: Piece
  frontDoor: Piece
  /** Where bots lean ladders to reach the upper floor. */
  ladderSpot: { x: number; z: number; yaw: number }
  /** Outside spots in front of the doors, for traps and defenders. */
  doorSteps: Waypoint[]
  /** Indoor floor cells used to pick trap spots. */
  insideSpots: Waypoint[]
}

interface Opening {
  a: number
  b: number
  kind: 'door' | 'window' | 'garage' | 'gap'
  flap?: boolean
}

export interface HouseOptions {
  layout: LayoutId
  /** Theme id for the view (paint/roof colours) and the house style. */
  theme: string
}

export function buildHouse(team: number, ox: number, oz: number, dir: number, opts: HouseOptions): HouseInfo {
  const style = houseStyle(opts.theme)
  const pieces: Piece[] = []
  const doors: Piece[] = []
  const valuables: Piece[] = []
  let balconyDoor: Piece | null = null
  let frontDoor: Piece | null = null
  const W = (lx: number) => ox + lx * dir
  const Z = (lz: number) => oz + lz * dir
  const T = 0.3

  /** Add a piece given in local coords (centre x/z, bottom y). */
  const add = (init: Parameters<typeof makePiece>[0]) => {
    const p = makePiece({ ...init, x: W(init.x), z: Z(init.z), house: team, yaw: dir > 0 ? (init.yaw ?? 0) : (init.yaw ?? 0) + Math.PI })
    pieces.push(p)
    return p
  }

  /** Split a run into wall panels around its openings. */
  const run = (x0: number, x1: number, openings: Opening[]) => {
    const segs: { a: number; b: number; open?: Opening }[] = []
    let cur = x0
    const sorted = [...openings].sort((p, q) => p.a - q.a)
    for (const o of sorted) {
      if (o.a > cur + 1e-6) segs.push({ a: cur, b: o.a })
      segs.push({ a: o.a, b: o.b, open: o })
      cur = o.b
    }
    if (cur < x1 - 1e-6) segs.push({ a: cur, b: x1 })
    return segs
  }
  /** A wall along x at local z, from x0 to x1, with openings; `floor` picks the nav floor. */
  const wallX = (z: number, x0: number, x1: number, y: number, h: number, openings: Opening[], inner = false, floor = 0) => {
    for (const s of run(x0, x1, openings)) {
      if (s.open) {
        emitOpening(s.open, (s.a + s.b) / 2, z, s.b - s.a, T, y, h, 0, floor)
        continue
      }
      // Split long runs into ~2 m panels so chips and breaks stay local.
      const n = Math.max(1, Math.round((s.b - s.a) / 2))
      const len = (s.b - s.a) / n
      for (let i = 0; i < n; i++)
        add({ kind: 'wall', model: inner ? 'innerwall' : 'wall', x: s.a + len * (i + 0.5), z, w: len, d: T, h, y, hp: inner ? INNER_WALL_HP : WALL_HP, inside: inner, floor, yaw: 0 })
    }
  }
  const wallZ = (x: number, z0: number, z1: number, y: number, h: number, openings: Opening[], inner = false, floor = 0) => {
    for (const s of run(z0, z1, openings)) {
      if (s.open) {
        emitOpening(s.open, x, (s.a + s.b) / 2, T, s.b - s.a, y, h, Math.PI / 2, floor)
        continue
      }
      const n = Math.max(1, Math.round((s.b - s.a) / 2))
      const len = (s.b - s.a) / n
      for (let i = 0; i < n; i++)
        add({ kind: 'wall', model: inner ? 'innerwall' : 'wall', x, z: s.a + len * (i + 0.5), w: T, d: len, h, y, hp: inner ? INNER_WALL_HP : WALL_HP, inside: inner, floor, yaw: Math.PI / 2 })
    }
  }
  function emitOpening(o: Opening, x: number, z: number, w: number, d: number, y: number, h: number, yaw: number, floor: number) {
    if (o.kind === 'gap') {
      // A doorway without a door: header above it.
      add({ kind: 'wall', model: 'header:gap', x, z, w, d, h: h - 2.1, y: y + 2.1, hp: 0, breakable: false, floor, yaw })
      return
    }
    if (o.kind === 'window') {
      add({ kind: 'wall', model: 'sill', x, z, w, d, h: SILL_H, y, hp: 0, breakable: false, floor, yaw })
      add({ kind: 'window', model: 'window', x, z, w, d, h: HEAD_H - SILL_H, y: y + SILL_H, hp: WINDOW_HP, floor, yaw })
      add({ kind: 'wall', model: 'header:window', x, z, w, d, h: h - HEAD_H, y: y + HEAD_H, hp: 0, breakable: false, floor, yaw })
      return
    }
    if (o.kind === 'garage') {
      const g = add({ kind: 'garage', model: 'garagedoor', x, z, w, d, h: 2.5, y, hp: GARAGE_HP, floor, yaw })
      doors.push(g)
      add({ kind: 'wall', model: 'header:garage', x, z, w, d, h: h - 2.5, y: y + 2.5, hp: 0, breakable: false, floor, yaw })
      return
    }
    // A door: open to everyone until barricaded (then it is solid with hit points), with a dog flap on the back door.
    const door = add({ kind: 'door', model: 'door', x, z, w, d, h: HEAD_H, y, hp: DOOR_HP, solid: false, floor, yaw, flap: o.flap })
    door.level = 0
    doors.push(door)
    const front = y < 1 && z > 0 && Math.abs(x) < 0.1
    add({ kind: 'wall', model: front ? 'header:frontdoor' : 'header:door', x, z, w, d, h: h - HEAD_H, y: y + HEAD_H, hp: 0, breakable: false, floor, yaw })
    if (y > 1) balconyDoor = door
    else if (front) frontDoor = door
  }

  const bays = facadeBays(style)
  const windows = (xs: number[], w: number): Opening[] => xs.map((c) => ({ a: c - w / 2, b: c + w / 2, kind: 'window' as const }))
  const H = WALL_H
  const Y1 = FLOOR_H

  /* ---------- ground floor ---------- */
  add({ kind: 'slab', model: 'floor', x: 0, z: 0, w: 12, d: 9, h: 0.03, y: 0, hp: 0, breakable: false, solid: false, inside: true, floor: 0 })
  add({ kind: 'slab', model: 'garagefloor', x: 8, z: -1.5, w: 4, d: 6, h: 0.03, y: 0, hp: 0, breakable: false, solid: false, inside: true, floor: 0 })
  wallX(4.5, -6, 6, 0, H, [{ a: -0.5, b: 0.5, kind: 'door' }, ...windows(bays.xs, bays.w)])
  wallX(-4.5, -6, 6, 0, H, [{ a: -0.5, b: 0.5, kind: 'door', flap: true }, ...windows(bays.xs, bays.w)])
  wallZ(-6, -4.5, 4.5, 0, H, windows([-2.2, 2.2], 1.0))
  wallZ(6, 1.5, 4.5, 0, H, windows([3.0], 1.0))
  // Wall shared with the garage: interior door through to it.
  wallZ(6, -4.5, 1.5, 0, H, [{ a: -1, b: 0, kind: 'gap' }], true)
  // Garage.
  wallX(1.5, 6, 10, 0, H, [{ a: 6.5, b: 9.5, kind: 'garage' }])
  wallX(-4.5, 6, 10, 0, H, [])
  wallZ(10, -4.5, 1.5, 0, H, [])
  for (const b of garageSteps()) add({ kind: 'roof', model: 'roofstep', x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, h: b.y1 - b.y0, y: b.y0, hp: 0, breakable: false, floor: 1 })
  // Interior walls: living | hall | kitchen.
  wallZ(-1.25, -4.5, 4.5, 0, H, [{ a: 1.5, b: 2.5, kind: 'gap' }, { a: -3.5, b: -2.5, kind: 'gap' }], true)
  wallZ(1.25, -4.5, 4.5, 0, H, [{ a: 1.5, b: 2.5, kind: 'gap' }, { a: -3.5, b: -2.5, kind: 'gap' }], true)
  // Stairs in the hall, rising toward the back.
  const SX = 0.75
  const stairPath: Waypoint[] = []
  for (let i = 0; i < 12; i++) {
    const top = 0.25 * (i + 1)
    const zc = 3.6 - 0.3 * (i + 0.5)
    add({ kind: 'step', model: 'step', x: SX, z: zc, w: 1.0, d: 0.3, h: top, y: 0, hp: 0, breakable: false, inside: true, floor: 0 })
    if (i % 3 === 1) stairPath.push({ x: W(SX), z: Z(zc), y: top })
  }
  // Front porch: a low deck, two posts and the balcony on its roof.
  const P = PORCH
  add({ kind: 'slab', model: 'porch', x: (P.x0 + P.x1) / 2, z: (P.z0 + P.z1) / 2, w: P.x1 - P.x0, d: P.z1 - P.z0, h: P.deck, y: 0, hp: 0, breakable: false, floor: 0 })
  for (const sx of [-1, 1]) add({ kind: 'rail', model: 'porchpost', x: sx * (P.x1 - 0.2), z: P.z1 - 0.2, w: 0.22, d: 0.22, h: Y1 - 0.2 - P.deck, y: P.deck, hp: 0, breakable: false, floor: 0 })
  // Chimney on the left gable wall.
  add({ kind: 'wall', model: 'chimney', x: -MAIN_HX - 0.32, z: 0, w: 0.64, d: 1.3, h: ridgeY(style) + 0.9, y: 0, hp: 0, breakable: false, floor: 0 })

  /* ---------- upper floor ---------- */
  // Slabs leave the stairwell open (x 0.15..1.35, z 0.3..2.7).
  const slab = (x0: number, z0: number, x1: number, z1: number) => add({ kind: 'slab', model: 'slab', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 0.2, y: Y1 - 0.2, hp: 0, breakable: false, inside: true, floor: 1 })
  slab(-6, -4.5, SX - 0.6, 4.5)
  slab(SX + 0.6, -4.5, 6, 4.5)
  slab(SX - 0.6, 2.7, SX + 0.6, 4.5)
  slab(SX - 0.6, -4.5, SX + 0.6, 0.3)
  wallX(4.5, -6, 6, Y1, H, [{ a: -0.5, b: 0.5, kind: 'door' }, ...windows(bays.xs, bays.w)], false, 1)
  wallX(-4.5, -6, 6, Y1, H, [...windows(bays.xs, bays.w), ...windows([0], 0.8)], false, 1)
  wallZ(-6, -4.5, 4.5, Y1, H, windows([-2.2, 2.2], 1.0), false, 1)
  wallZ(6, -4.5, 4.5, Y1, H, windows([-2.2, 2.2], 1.0), false, 1)
  wallZ(-1.25, -4.5, 4.5, Y1, H, [{ a: 1.5, b: 2.5, kind: 'gap' }], true, 1)
  wallZ(1.25, -4.5, 4.5, Y1, H, [{ a: -3.5, b: -2.5, kind: 'gap' }, { a: 3.1, b: 4.1, kind: 'gap' }], true, 1)
  wallX(-1, 1.25, 6, Y1, H, [{ a: 2, b: 3, kind: 'gap' }], true, 1)
  // The balcony: the porch roof, railed on three sides.
  add({ kind: 'slab', model: 'balcony', x: (P.x0 + P.x1) / 2, z: (P.z0 + P.z1) / 2, w: P.x1 - P.x0, d: P.z1 - P.z0, h: 0.2, y: Y1 - 0.2, hp: 0, breakable: false, floor: 1 })
  add({ kind: 'rail', model: 'rail', x: 0, z: P.z1 - 0.05, w: P.x1 - P.x0, d: 0.1, h: 1.0, y: Y1, hp: 0, breakable: false, floor: 1 })
  for (const sx of [-1, 1]) add({ kind: 'rail', model: 'rail', x: sx * (P.x1 - 0.05), z: (P.z0 + P.z1) / 2 - 0.05, w: 0.1, d: P.z1 - P.z0 - 0.1, h: 1.0, y: Y1, hp: 0, breakable: false, floor: 1, yaw: Math.PI / 2 })
  // The roof: walkable steps under the pitched planes the view draws.
  for (const b of roofSteps(style)) add({ kind: 'roof', model: 'roofstep', x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0, h: b.y1 - b.y0, y: b.y0, hp: 0, breakable: false, floor: 2 })

  /* ---------- furniture ---------- */
  const furn = (model: string, x: number, z: number, w: number, d: number, h: number, floor = 0, yaw = 0, solid = true) =>
    add({ kind: 'furniture', model: `furniture:${model}`, x, z, w, d, h, y: floor ? Y1 : 0, hp: solid ? FURNITURE_HP : 0, breakable: solid, solid, inside: true, floor, yaw })
  furn('sofa', -3.4, 2.6, 2.2, 0.9, 0.9, 0, 0)
  furn('coffeetable', -3.4, 0.8, 1.2, 0.6, 0.45)
  furn('rug', -3.4, 1.2, 3.2, 2.4, 0.02, 0, 0, false)
  furn('counter', 4, -4.0, 3.6, 0.7, 0.95)
  furn('table', 3.9, 1.5, 1.4, 1.0, 0.75)
  furn('chair', 3.0, 1.5, 0.5, 0.5, 0.9, 0, Math.PI / 2)
  furn('chair', 4.8, 1.5, 0.5, 0.5, 0.9, 0, -Math.PI / 2)
  furn('bed', -3.6, -2.4, 1.8, 2.2, 0.7, 1, 0)
  furn('wardrobe', -5.6, 3.5, 0.6, 1.6, 2.1, 1, Math.PI / 2)
  furn('toilet', 5.3, -3.6, 0.6, 0.8, 0.8, 1, 0)
  furn('sink', 3.0, -4.0, 0.7, 0.5, 0.9, 1, 0)
  furn('desk', 5.2, 2.5, 1.4, 0.7, 0.8, 1, Math.PI / 2)
  furn('toolrack', 9.4, -3.5, 0.4, 1.6, 1.6, 0, Math.PI / 2)
  add({ kind: 'prop', model: 'prop:golfcart', x: 8.2, z: -2.5, w: 1.3, d: 2.4, h: 1.6, y: 0, hp: 0, breakable: false, inside: true, floor: 0 })

  /* ---------- valuables by layout ---------- */
  type Spot = [ValuableKind, number, number, number, number]
  const layouts: Record<LayoutId, Spot[]> = {
    classic: [
      ['tv', -5.5, 0, 0, Math.PI / 2],
      ['aquarium', -4, 4.0, 0, 0],
      ['clock', -5.6, -3.9, 0, Math.PI / 2],
      ['piano', -2.6, -3.8, 0, 0],
      ['fridge', 5.4, -2.0, 0, Math.PI / 2],
      ['trophy', -5.5, 0.4, 1, Math.PI / 2],
      ['console', 2.8, 3.9, 1, 0],
      ['mower', 7.2, -0.2, 0, 0],
    ],
    bunker: [
      ['tv', -5.5, 0.8, 1, Math.PI / 2],
      ['aquarium', -2.6, -3.9, 1, 0],
      ['clock', -5.6, -3.9, 1, Math.PI / 2],
      ['piano', 4.2, 3.6, 1, 0],
      ['trophy', 4.5, 0.2, 1, Math.PI],
      ['console', -4, 4.0, 1, 0],
      ['fridge', 5.4, -2.0, 0, Math.PI / 2],
      ['mower', 7.2, -0.2, 0, 0],
    ],
    spread: [
      ['tv', -5.5, 0, 0, Math.PI / 2],
      ['piano', -2.6, -3.8, 0, 0],
      ['fridge', 5.4, -2.0, 0, Math.PI / 2],
      ['clock', 2.8, 3.9, 0, 0],
      ['trophy', -5.5, 0.4, 1, Math.PI / 2],
      ['aquarium', 4.2, 3.6, 1, 0],
      ['console', 4.5, -3.0, 1, Math.PI],
      ['mower', 7.2, -0.2, 0, 0],
    ],
    garage: [
      ['tv', 9.3, 0.3, 0, Math.PI],
      ['piano', 7.4, -3.7, 0, 0],
      ['mower', 7.2, -0.2, 0, 0],
      ['trophy', 9.4, -1.6, 0, Math.PI / 2],
      ['fridge', 5.4, -2.0, 0, Math.PI / 2],
      ['aquarium', -4, 4.0, 0, 0],
      ['clock', -5.6, -3.9, 0, Math.PI / 2],
      ['console', 2.8, 3.9, 1, 0],
    ],
  }
  for (const [kind, x, z, floor, yaw] of layouts[opts.layout]) {
    const v = VALUABLES[kind]
    const rot = Math.abs(((yaw % Math.PI) + Math.PI) % Math.PI - Math.PI / 2) < 0.1
    const p = add({ kind: 'valuable', model: `valuable:${kind}`, x, z, w: rot ? v.d : v.w, d: rot ? v.w : v.d, h: v.h, y: floor ? Y1 : 0, hp: v.hp, value: v.value, name: v.name, inside: true, floor, yaw })
    valuables.push(p)
  }

  const front = dir
  const info: HouseInfo = {
    team,
    ox,
    oz,
    dir,
    style,
    pieces,
    main: norm(W(-6), Z(-4.5), W(6), Z(4.5)),
    garage: norm(W(6), Z(-4.5), W(10), Z(1.5)),
    spawns: [
      { x: W(-0.55), z: Z(3.9), yaw: front > 0 ? 0 : Math.PI },
      { x: W(-3.4), z: Z(0), yaw: front > 0 ? 0 : Math.PI },
      { x: W(3.6), z: Z(-1), yaw: front > 0 ? 0 : Math.PI },
      { x: W(-2.4), z: Z(-2.5), yaw: front > 0 ? 0 : Math.PI },
    ],
    doors,
    valuables,
    stairs: { bottom: { x: W(SX), z: Z(4.0), y: 0 }, top: { x: W(SX), z: Z(-0.4), y: FLOOR_H }, path: stairPath },
    balcony: { x: W(0), z: Z((P.z0 + P.z1) / 2), y: FLOOR_H },
    balconyDoor: balconyDoor!,
    frontDoor: frontDoor!,
    ladderSpot: { x: W(-4.95), z: Z(6.0), yaw: front > 0 ? Math.PI : 0 },
    doorSteps: [
      { x: W(0), z: Z(5.6), y: P.deck },
      { x: W(0), z: Z(-5.4), y: 0 },
      { x: W(8), z: Z(2.6), y: 0 },
    ],
    insideSpots: [
      { x: W(0), z: Z(3.9), y: 0 },
      { x: W(0), z: Z(-3.4), y: 0 },
      { x: W(-2.2), z: Z(2), y: 0 },
      { x: W(2.2), z: Z(2), y: 0 },
      { x: W(-3.4), z: Z(-1.5), y: 0 },
      { x: W(3.6), z: Z(0), y: 0 },
      { x: W(-0.5), z: Z(-3), y: 0 },
      { x: W(-0.6), z: Z(0.8), y: FLOOR_H },
      { x: W(-2.5), z: Z(2), y: FLOOR_H },
      { x: W(-3), z: Z(0.5), y: FLOOR_H },
      { x: W(8), z: Z(0.5), y: 0 },
    ],
  }
  return info
}

function norm(x0: number, z0: number, x1: number, z1: number) {
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) }
}

/** Whether a point lies inside the house (main block or garage). */
export function insideHouse(h: HouseInfo, x: number, z: number) {
  const m = h.main
  const g = h.garage
  return (x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1) || (x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1)
}
