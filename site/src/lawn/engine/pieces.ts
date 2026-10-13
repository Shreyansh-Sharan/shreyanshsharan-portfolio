// World pieces: every wall panel, door, window, slab, stair step, railing, furniture item, valuable and street prop
// is an axis-aligned box with hit points. The sim collides against the solid ones, raiders break the breakable
// ones, and the view draws them from `model`.

export type PieceKind = 'wall' | 'door' | 'garage' | 'window' | 'slab' | 'step' | 'roof' | 'rail' | 'furniture' | 'valuable' | 'prop' | 'ground' | 'tree'

export interface Piece {
  id: number
  kind: PieceKind
  /** What the view draws (e.g. 'wall', 'window', 'valuable:tv', 'prop:mailbox'). */
  model: string
  /** Owning household (0 / 1), or -1 for the street. */
  house: number
  /** Centre of the footprint and the bottom (metres). */
  x: number
  y: number
  z: number
  /** Size along x, z and up. */
  w: number
  d: number
  h: number
  /** Yaw for the drawn model (collisions are axis aligned). */
  yaw: number
  hp: number
  maxHp: number
  breakable: boolean
  solid: boolean
  alive: boolean
  /** Points for breaking it (valuables only). */
  value: number
  name: string
  /** 0..3 visible damage state. */
  chip: number
  /** Barricade planks on a door (0..2). */
  level: number
  /** Indoors (true) or outdoors. */
  inside: boolean
  /** Tiny heroes (the kid crouching, the dog) pass through: dog flaps. */
  flap?: boolean
  /** Which floor it belongs to for navigation (0 ground, 1 upper, 2 roof). */
  floor: number
  /** Ladder data: the top it reaches. */
  top?: number
}

export interface Box {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

export function boxOf(p: { x: number; y: number; z: number; w: number; d: number; h: number }): Box {
  return { x0: p.x - p.w / 2, y0: p.y, z0: p.z - p.d / 2, x1: p.x + p.w / 2, y1: p.y + p.h, z1: p.z + p.d / 2 }
}

export function overlaps(a: Box, b: Box) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0
}

export function overlapsXZ(a: Box, b: Box) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0
}

let seq = 1
export function resetPieceIds() {
  seq = 1
}

export interface PieceInit extends Partial<Piece> {
  kind: PieceKind
  model: string
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
}

export function makePiece(init: PieceInit): Piece {
  const hp = init.hp ?? 0
  return {
    id: seq++,
    house: -1,
    yaw: 0,
    hp,
    maxHp: hp,
    breakable: hp > 0,
    solid: true,
    alive: true,
    value: 0,
    name: init.model,
    chip: 0,
    level: 0,
    inside: false,
    floor: 0,
    ...init,
  }
}

/** The grid-cell spatial hash the sim uses for collision queries. */
export class PieceHash {
  private cells = new Map<number, Piece[]>()
  readonly size: number
  constructor(size = 3) {
    this.size = size
  }
  private key(cx: number, cz: number) {
    return (cx + 512) * 2048 + (cz + 512)
  }
  add(p: Piece) {
    const b = boxOf(p)
    const s = this.size
    for (let cx = Math.floor(b.x0 / s); cx <= Math.floor(b.x1 / s); cx++)
      for (let cz = Math.floor(b.z0 / s); cz <= Math.floor(b.z1 / s); cz++) {
        const k = this.key(cx, cz)
        let list = this.cells.get(k)
        if (!list) this.cells.set(k, (list = []))
        list.push(p)
      }
  }
  remove(p: Piece) {
    const b = boxOf(p)
    const s = this.size
    for (let cx = Math.floor(b.x0 / s); cx <= Math.floor(b.x1 / s); cx++)
      for (let cz = Math.floor(b.z0 / s); cz <= Math.floor(b.z1 / s); cz++) {
        const list = this.cells.get(this.key(cx, cz))
        if (!list) continue
        const i = list.indexOf(p)
        if (i >= 0) list.splice(i, 1)
      }
  }
  /** Pieces whose cells touch the box (may repeat across cells; callers de-duplicate by id when it matters). */
  query(b: Box, out: Piece[] = []) {
    out.length = 0
    const s = this.size
    for (let cx = Math.floor(b.x0 / s); cx <= Math.floor(b.x1 / s); cx++)
      for (let cz = Math.floor(b.z0 / s); cz <= Math.floor(b.z1 / s); cz++) {
        const list = this.cells.get(this.key(cx, cz))
        if (list) for (const p of list) if (out.indexOf(p) < 0) out.push(p)
      }
    return out
  }
}
