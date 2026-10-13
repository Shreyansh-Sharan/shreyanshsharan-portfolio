// The modular house kit: two floors of 2 m wall panels with doors and windows, an interior with stairs, a balcony
// over the front door, a flat roof deck with a parapet, an attached garage, and furniture plus the tagged valuables
// placed by a layout preset. Built in a local frame (front faces +z) and mirrored into the world per household.
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
export const ROOF_Y = 6.2

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
  /** Where bots lean ladders to reach the balcony. */
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
  /** Theme id for the view (paint/roof colours). */
  theme: string
}

export function buildHouse(team: number, ox: number, oz: number, dir: number, opts: HouseOptions): HouseInfo {
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

  /** A wall along x at local z, from x0 to x1, with openings; `floor` picks the hp and the nav floor. */
  const wallX = (z: number, x0: number, x1: number, y: number, h: number, openings: Opening[], inner = false, floor = 0) => {
    const segs: { a: number; b: number; open?: Opening }[] = []
    let cur = x0
    const sorted = [...openings].sort((p, q) => p.a - q.a)
    for (const o of sorted) {
      if (o.a > cur) segs.push({ a: cur, b: o.a })
      segs.push({ a: o.a, b: o.b, open: o })
      cur = o.b
    }
    if (cur < x1) segs.push({ a: cur, b: x1 })
    for (const s of segs) {
      if (s.open) {
        emitOpening(s.open, (s.a + s.b) / 2, z, s.b - s.a, T, y, h, 0, floor)
        continue
      }
      // Split long runs into 2 m panels so chips and breaks stay local.
      const n = Math.max(1, Math.round((s.b - s.a) / 2))
      const len = (s.b - s.a) / n
      for (let i = 0; i < n; i++)
        add({ kind: 'wall', model: inner ? 'innerwall' : 'wall', x: s.a + len * (i + 0.5), z, w: len, d: T, h, y, hp: inner ? INNER_WALL_HP : WALL_HP, inside: inner, floor, yaw: 0 })
    }
  }
  const wallZ = (x: number, z0: number, z1: number, y: number, h: number, openings: Opening[], inner = false, floor = 0) => {
    const segs: { a: number; b: number; open?: Opening }[] = []
    let cur = z0
    const sorted = [...openings].sort((p, q) => p.a - q.a)
    for (const o of sorted) {
      if (o.a > cur) segs.push({ a: cur, b: o.a })
      segs.push({ a: o.a, b: o.b, open: o })
      cur = o.b
    }
    if (cur < z1) segs.push({ a: cur, b: z1 })
    for (const s of segs) {
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
      add({ kind: 'wall', model: 'sill', x, z, w, d, h: 0.9, y, hp: 0, breakable: false, floor, yaw })
      add({ kind: 'window', model: 'window', x, z, w, d, h: 1.3, y: y + 0.9, hp: WINDOW_HP, floor, yaw })
      add({ kind: 'wall', model: 'header:window', x, z, w, d, h: h - 2.2, y: y + 2.2, hp: 0, breakable: false, floor, yaw })
      return
    }
    if (o.kind === 'garage') {
      const g = add({ kind: 'garage', model: 'garagedoor', x, z, w, d, h: 2.5, y, hp: GARAGE_HP, floor, yaw })
      doors.push(g)
      add({ kind: 'wall', model: 'header:garage', x, z, w, d, h: h - 2.5, y: y + 2.5, hp: 0, breakable: false, floor, yaw })
      return
    }
    // A door: open to everyone until barricaded (then it is solid with hit points), with a dog flap on the back door.
    const door = add({ kind: 'door', model: 'door', x, z, w, d, h: 2.1, y, hp: DOOR_HP, solid: false, floor, yaw, flap: o.flap })
    door.level = 0
    doors.push(door)
    const front = y < 1 && z > 0 && Math.abs(x - 0.75) < 0.1
    // The header's model tells the view which kit frame to draw (the front door also gets the portico).
    add({ kind: 'wall', model: front ? 'header:frontdoor' : 'header:door', x, z, w, d, h: h - 2.1, y: y + 2.1, hp: 0, breakable: false, floor, yaw })
    if (y > 1) balconyDoor = door
    else if (front) frontDoor = door
  }

  /* ---------- ground floor ---------- */
  const H = 3.0
  add({ kind: 'slab', model: 'floor', x: 0, z: 0, w: 12, d: 9, h: 0.03, y: 0, hp: 0, breakable: false, solid: false, inside: true, floor: 0 })
  add({ kind: 'slab', model: 'garagefloor', x: 8, z: -1.5, w: 4, d: 6, h: 0.03, y: 0, hp: 0, breakable: false, solid: false, inside: true, floor: 0 })
  wallX(4.5, -6, 6, 0, H, [{ a: 0.25, b: 1.25, kind: 'door' }, { a: -4.5, b: -2.5, kind: 'window' }, { a: 3, b: 5, kind: 'window' }])
  wallX(-4.5, -6, 6, 0, H, [{ a: 0.25, b: 1.25, kind: 'door', flap: true }, { a: -4.5, b: -2.5, kind: 'window' }, { a: 3, b: 5, kind: 'window' }])
  wallZ(-6, -4.5, 4.5, 0, H, [{ a: -1, b: 1, kind: 'window' }])
  wallZ(6, 1.5, 4.5, 0, H, [{ a: 2.5, b: 3.5, kind: 'window' }])
  // Wall shared with the garage: interior door through to it.
  wallZ(6, -4.5, 1.5, 0, H, [{ a: -1, b: 0, kind: 'gap' }], true)
  // Garage.
  wallX(1.5, 6, 10, 0, H, [{ a: 6.5, b: 9.5, kind: 'garage' }])
  wallX(-4.5, 6, 10, 0, H, [])
  wallZ(10, -4.5, 1.5, 0, H, [])
  add({ kind: 'slab', model: 'garageroof', x: 8, z: -1.5, w: 4.3, d: 6.3, h: 0.3, y: H, hp: 0, breakable: false, floor: 1 })
  // Interior walls: living | hall | kitchen.
  wallZ(-0.5, -4.5, 4.5, 0, H, [{ a: 1.5, b: 2.5, kind: 'gap' }, { a: -3.5, b: -2.5, kind: 'gap' }], true)
  wallZ(2, -4.5, 4.5, 0, H, [{ a: 1.5, b: 2.5, kind: 'gap' }, { a: -3.5, b: -2.5, kind: 'gap' }], true)
  // Stairs in the hall, rising toward the back.
  const stairPath: Waypoint[] = []
  for (let i = 0; i < 12; i++) {
    const top = 0.25 * (i + 1)
    const zc = 3.6 - 0.3 * (i + 0.5)
    add({ kind: 'step', model: 'step', x: 1.5, z: zc, w: 1.0, d: 0.3, h: top, y: 0, hp: 0, breakable: false, inside: true, floor: 0 })
    if (i % 3 === 1) stairPath.push({ x: W(1.5), z: Z(zc), y: top })
  }
  /* ---------- upper floor ---------- */
  const Y1 = FLOOR_H
  // Slabs leave the stairwell open (x 0.9..2.1, z 0.3..2.7).
  const slab = (x0: number, z0: number, x1: number, z1: number) => add({ kind: 'slab', model: 'slab', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, h: 0.2, y: Y1 - 0.2, hp: 0, breakable: false, inside: true, floor: 1 })
  slab(-6, -4.5, 0.9, 4.5)
  slab(2.1, -4.5, 6, 4.5)
  slab(0.9, 2.7, 2.1, 4.5)
  slab(0.9, -4.5, 2.1, 0.3)
  wallX(4.5, -6, 6, Y1, H, [{ a: -1.5, b: -0.5, kind: 'door' }, { a: -4.5, b: -2.5, kind: 'window' }, { a: 3, b: 5, kind: 'window' }], false, 1)
  wallX(-4.5, -6, 6, Y1, H, [{ a: -4.5, b: -2.5, kind: 'window' }, { a: 3, b: 5, kind: 'window' }], false, 1)
  wallZ(-6, -4.5, 4.5, Y1, H, [{ a: -1, b: 1, kind: 'window' }], false, 1)
  wallZ(6, -4.5, 4.5, Y1, H, [{ a: -1, b: 1, kind: 'window' }], false, 1)
  wallZ(-0.5, -4.5, 4.5, Y1, H, [{ a: 1.5, b: 2.5, kind: 'gap' }], true, 1)
  wallZ(2, -4.5, 4.5, Y1, H, [{ a: -3.5, b: -2.5, kind: 'gap' }, { a: 1.5, b: 2.5, kind: 'gap' }], true, 1)
  wallX(-1, 2, 6, Y1, H, [{ a: 2, b: 3, kind: 'gap' }], true, 1)
  // Balcony over the front door.
  add({ kind: 'slab', model: 'balcony', x: -1, z: 5.5, w: 4, d: 2, h: 0.2, y: Y1 - 0.2, hp: 0, breakable: false, floor: 1 })
  add({ kind: 'rail', model: 'rail', x: -1, z: 6.45, w: 4, d: 0.1, h: 1.0, y: Y1, hp: 0, breakable: false, floor: 1 })
  add({ kind: 'rail', model: 'rail', x: -2.95, z: 5.5, w: 0.1, d: 2, h: 1.0, y: Y1, hp: 0, breakable: false, floor: 1, yaw: Math.PI / 2 })
  add({ kind: 'rail', model: 'rail', x: 0.95, z: 5.5, w: 0.1, d: 2, h: 1.0, y: Y1, hp: 0, breakable: false, floor: 1, yaw: Math.PI / 2 })
  // Roof deck with a parapet, and the attic ridge behind it.
  add({ kind: 'roof', model: 'roof', x: 0, z: 0, w: 12.3, d: 9.3, h: 0.3, y: ROOF_Y, hp: 0, breakable: false, floor: 2 })
  add({ kind: 'rail', model: 'parapet', x: 0, z: 4.55, w: 12.3, d: 0.2, h: 0.5, y: ROOF_Y + 0.3, hp: 0, breakable: false, floor: 2 })
  add({ kind: 'rail', model: 'parapet', x: 0, z: -4.55, w: 12.3, d: 0.2, h: 0.5, y: ROOF_Y + 0.3, hp: 0, breakable: false, floor: 2 })
  add({ kind: 'rail', model: 'parapet', x: -6.05, z: 0, w: 0.2, d: 9.3, h: 0.5, y: ROOF_Y + 0.3, hp: 0, breakable: false, floor: 2, yaw: Math.PI / 2 })
  add({ kind: 'rail', model: 'parapet', x: 6.05, z: 0, w: 0.2, d: 9.3, h: 0.5, y: ROOF_Y + 0.3, hp: 0, breakable: false, floor: 2, yaw: Math.PI / 2 })
  add({ kind: 'roof', model: 'attic', x: 0, z: -1.9, w: 12.3, d: 5.3, h: 2.3, y: ROOF_Y + 0.3, hp: 0, breakable: false, floor: 2 })

  /* ---------- furniture ---------- */
  const furn = (model: string, x: number, z: number, w: number, d: number, h: number, floor = 0, yaw = 0, solid = true) =>
    add({ kind: 'furniture', model: `furniture:${model}`, x, z, w, d, h, y: floor ? Y1 : 0, hp: solid ? FURNITURE_HP : 0, breakable: solid, solid, inside: true, floor, yaw })
  furn('sofa', -3, 2.6, 2.2, 0.9, 0.9, 0, 0)
  furn('coffeetable', -3, 0.8, 1.2, 0.6, 0.45)
  furn('rug', -3, 1.2, 3.2, 2.4, 0.02, 0, 0, false)
  furn('counter', 4, -4.0, 3.6, 0.7, 0.95)
  furn('table', 4.2, 1.5, 1.4, 1.0, 0.75)
  furn('chair', 3.3, 1.5, 0.5, 0.5, 0.9, 0, Math.PI / 2)
  furn('chair', 5.1, 1.5, 0.5, 0.5, 0.9, 0, -Math.PI / 2)
  furn('bed', -3.6, -2.4, 1.8, 2.2, 0.7, 1, 0)
  furn('wardrobe', -5.6, 2.5, 0.6, 1.6, 2.1, 1, Math.PI / 2)
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
      ['piano', -2.2, -3.8, 0, 0],
      ['fridge', 5.4, -2.0, 0, Math.PI / 2],
      ['trophy', -5.5, 0.4, 1, Math.PI / 2],
      ['console', 2.8, 3.9, 1, 0],
      ['mower', 7.2, -0.2, 0, 0],
    ],
    bunker: [
      ['tv', -5.5, 0.8, 1, Math.PI / 2],
      ['aquarium', -1.4, -3.9, 1, 0],
      ['clock', -5.6, -3.9, 1, Math.PI / 2],
      ['piano', 4.2, 3.6, 1, 0],
      ['trophy', 4.5, 0.2, 1, Math.PI],
      ['console', -4, 4.0, 1, 0],
      ['fridge', 5.4, -2.0, 0, Math.PI / 2],
      ['mower', 7.2, -0.2, 0, 0],
    ],
    spread: [
      ['tv', -5.5, 0, 0, Math.PI / 2],
      ['piano', -2.2, -3.8, 0, 0],
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
    pieces,
    main: norm(W(-6), Z(-4.5), W(6), Z(4.5)),
    garage: norm(W(6), Z(-4.5), W(10), Z(1.5)),
    spawns: [
      { x: W(0.2), z: Z(3.6), yaw: front > 0 ? 0 : Math.PI },
      { x: W(-3), z: Z(0), yaw: front > 0 ? 0 : Math.PI },
      { x: W(4), z: Z(-1), yaw: front > 0 ? 0 : Math.PI },
      { x: W(-2), z: Z(-2.5), yaw: front > 0 ? 0 : Math.PI },
    ],
    doors,
    valuables,
    stairs: { bottom: { x: W(1.5), z: Z(4.0), y: 0 }, top: { x: W(1.5), z: Z(-0.4), y: FLOOR_H }, path: stairPath },
    balcony: { x: W(-1), z: Z(5.5), y: FLOOR_H },
    balconyDoor: balconyDoor!,
    frontDoor: frontDoor!,
    ladderSpot: { x: W(-1), z: Z(7.1), yaw: front > 0 ? Math.PI : 0 },
    doorSteps: [
      { x: W(0.75), z: Z(5.4), y: 0 },
      { x: W(0.75), z: Z(-5.4), y: 0 },
      { x: W(8), z: Z(2.6), y: 0 },
    ],
    insideSpots: [
      { x: W(0.75), z: Z(3.4), y: 0 },
      { x: W(0.75), z: Z(-3.4), y: 0 },
      { x: W(-1.2), z: Z(2), y: 0 },
      { x: W(1.6), z: Z(2), y: 0 },
      { x: W(-3), z: Z(-1.5), y: 0 },
      { x: W(4), z: Z(0), y: 0 },
      { x: W(0.2), z: Z(-3), y: 0 },
      { x: W(1), z: Z(0.5), y: FLOOR_H },
      { x: W(-1), z: Z(2), y: FLOOR_H },
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
