// Bot navigation: a 1 m grid in three layers (ground, upper floor, roof deck) sampled from the collision pieces,
// with stair and ladder links between layers and drop edges off balconies. Cells blocked by a breakable piece are
// passable at a cost (the bot smashes through), so barricaded doors and walls are obstacles, not dead ends.
import { FLOOR_H, ROOF_Y } from './houses.ts'
import { boxOf, type Box, type Piece } from './pieces.ts'
import type { Sim } from './sim.ts'

export const LAYER_Y = [0, FLOOR_H, ROOF_Y + 0.3]
/** Grid cell size in metres. */
export const CELL = 0.5
const BREAK_COST = 14
const TRAP_COST = 30

export interface Cell {
  walkable: boolean
  /** Floor height. */
  y: number
  /** Breakable piece in the way (walk into it and smash). */
  blocker: Piece | null
  cost: number
}

export interface Link {
  from: number
  to: number
  cost: number
  kind: 'stairs' | 'ladder' | 'drop'
  /** Waypoints to follow (world coords). */
  path: { x: number; y: number; z: number }[]
  piece?: Piece
}

export interface NavPoint {
  x: number
  y: number
  z: number
  /** Piece to break before entering this point. */
  breakPiece?: Piece
  link?: Link
}

export class Nav {
  readonly w: number
  readonly h: number
  readonly cells: Cell[][] = []
  readonly links = new Map<number, Link[]>()
  private sim: Sim
  private tmp: Piece[] = []
  version = 0

  constructor(sim: Sim) {
    this.sim = sim
    this.w = Math.ceil(sim.world.map.w / CELL)
    this.h = Math.ceil(sim.world.map.h / CELL)
    for (let l = 0; l < 3; l++) {
      const layer: Cell[] = new Array(this.w * this.h)
      for (let i = 0; i < layer.length; i++) layer[i] = { walkable: false, y: LAYER_Y[l], blocker: null, cost: 1 }
      this.cells.push(layer)
    }
    for (let l = 0; l < 3; l++) for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) this.sample(l, x, z)
    // Stairs and balcony drops per house.
    for (const house of sim.houses) {
      const b = house.stairs.bottom
      const t = house.stairs.top
      const from = this.key(0, cx(b.x), cx(b.z))
      const to = this.key(1, cx(t.x), cx(t.z))
      const path = [{ x: b.x, y: 0, z: b.z }, ...house.stairs.path, { x: t.x, y: FLOOR_H, z: t.z }]
      this.addLink({ from, to, cost: 8, kind: 'stairs', path })
      this.addLink({ from: to, to: from, cost: 8, kind: 'stairs', path: [...path].reverse() })
      // Drop off the balcony and the garage roof to the ground in front.
      const bal = house.balcony
      const dropFrom = this.key(1, cx(bal.x), cx(bal.z))
      const gx = bal.x
      const gz = bal.z + house.dir * 2.2
      this.addLink({ from: dropFrom, to: this.key(0, cx(gx), cx(gz)), cost: 6, kind: 'drop', path: [{ x: bal.x, y: FLOOR_H, z: bal.z + house.dir * 0.8 }, { x: gx, y: 0, z: gz }] })
    }
  }

  key(l: number, x: number, z: number) {
    return (l * this.h + z) * this.w + x
  }

  decode(k: number) {
    const x = k % this.w
    const rest = (k - x) / this.w
    const z = rest % this.h
    const l = (rest - z) / this.h
    return { l, x, z }
  }

  cell(l: number, x: number, z: number) {
    if (x < 0 || z < 0 || x >= this.w || z >= this.h || l < 0 || l > 2) return null
    return this.cells[l][z * this.w + x]
  }

  private addLink(link: Link) {
    let list = this.links.get(link.from)
    if (!list) this.links.set(link.from, (list = []))
    list.push(link)
  }

  /** Sample what stands at a cell on a layer. */
  private sample(l: number, cx: number, cz: number) {
    const c = this.cells[l][cz * this.w + cx]
    const x = (cx + 0.5) * CELL
    const z = (cz + 0.5) * CELL
    const ly = LAYER_Y[l]
    const sim = this.sim
    // Floor: the highest solid top within 0.5 m of the layer height (the ground counts on layer 0).
    let floor = l === 0 ? 0 : -1
    const fb: Box = { x0: x - 0.2, y0: ly - 1, z0: z - 0.2, x1: x + 0.2, y1: ly + 0.5, z1: z + 0.2 }
    for (const p of sim.hash.query(fb, this.tmp)) {
      if (!p.solid || !p.alive) continue
      const pb = boxOf(p)
      if (pb.x0 < fb.x1 && pb.x1 > fb.x0 && pb.z0 < fb.z1 && pb.z1 > fb.z0 && pb.y1 <= ly + 0.5 && pb.y1 >= ly - 0.45 && pb.y1 > floor) floor = pb.y1
    }
    if (floor < 0) {
      c.walkable = false
      c.blocker = null
      return
    }
    c.y = floor
    // Body band above the floor: anything solid there blocks (breakable things become a cost).
    const bb: Box = { x0: x - 0.34, y0: floor + 0.6, z0: z - 0.34, x1: x + 0.34, y1: floor + 1.6, z1: z + 0.34 }
    let blocker: Piece | null = null
    let hard = false
    for (const p of sim.hash.query(bb, this.tmp)) {
      if (!p.solid || !p.alive) continue
      const pb = boxOf(p)
      if (!(pb.x0 < bb.x1 && pb.x1 > bb.x0 && pb.z0 < bb.z1 && pb.z1 > bb.z0 && pb.y0 < bb.y1 && pb.y1 > bb.y0)) continue
      if (p.breakable && (p.kind === 'wall' || p.kind === 'door' || p.kind === 'garage' || p.kind === 'furniture' || p.kind === 'valuable' || p.kind === 'window')) {
        if (!blocker || p.hp < blocker.hp) blocker = p
      } else {
        hard = true
        break
      }
    }
    c.walkable = !hard
    c.blocker = hard ? null : blocker
    c.cost = blocker ? 1 + BREAK_COST * (blocker.kind === 'valuable' ? 3 : 1) : 1
  }

  /** Re-sample the cells a piece covers after it changed (broken, barricaded, moved). */
  pieceChanged(p: Piece) {
    const b = boxOf(p)
    for (let l = 0; l < 3; l++)
      for (let z = cx(b.z0) - 1; z <= cx(b.z1) + 1; z++)
        for (let x = cx(b.x0) - 1; x <= cx(b.x1) + 1; x++) if (x >= 0 && z >= 0 && x < this.w && z < this.h) this.sample(l, x, z)
    this.version++
  }

  ladderAdded(l: Piece) {
    const fx = Math.sin(l.yaw)
    const fz = Math.cos(l.yaw)
    const footX = l.x - fx * 0.9
    const footZ = l.z - fz * 0.9
    const topX = l.x + fx * 1.3
    const topZ = l.z + fz * 1.3
    const top = l.top ?? FLOOR_H
    const layer = top > 5 ? 2 : 1
    const from = this.key(0, cx(footX), cx(footZ))
    const to = this.key(layer, cx(topX), cx(topZ))
    const path = [{ x: footX, y: 0, z: footZ }, { x: l.x - fx * 0.55, y: top, z: l.z - fz * 0.55 }, { x: topX, y: top, z: topZ }]
    this.addLink({ from, to, cost: 10, kind: 'ladder', path, piece: l })
    this.version++
  }

  /** Which layer a world position sits on. */
  layerOf(y: number) {
    return y > ROOF_Y - 0.5 ? 2 : y > FLOOR_H - 1.2 ? 1 : 0
  }

  /** The nearest walkable cell key to a point (searching outward a little). */
  nearest(x: number, y: number, z: number) {
    const l = this.layerOf(y)
    const ix = cx(x)
    const iz = cx(z)
    for (let r = 0; r < 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const c = this.cell(l, ix + dx, iz + dz)
          if (c?.walkable && !c.blocker) return this.key(l, ix + dx, iz + dz)
        }
    for (let r = 0; r < 6; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const c = this.cell(l, ix + dx, iz + dz)
          if (c?.walkable) return this.key(l, ix + dx, iz + dz)
        }
    return -1
  }

  /**
   * A* from a point to a point. `avoid` adds cost around revealed enemy traps. Returns waypoints (world coords)
   * including break instructions and links, or null when unreachable.
   */
  find(ax: number, ay: number, az: number, bx: number, by: number, bz: number, avoid: { x: number; z: number; y: number }[] = [], team = -1, maxNodes = 24000): NavPoint[] | null {
    // A household walks through its own doors, barricaded or not.
    const own = (c: Cell) => !!c.blocker && (c.blocker.kind === 'door' || c.blocker.kind === 'garage') && c.blocker.house === team
    const start = this.nearest(ax, ay, az)
    const goal = this.nearest(bx, by, bz)
    if (start < 0 || goal < 0) return null
    if (start === goal) return [{ x: bx, y: by, z: bz }]
    const g = new Map<number, number>()
    const came = new Map<number, { from: number; link?: Link }>()
    const open = new Heap()
    const gl = this.decode(goal)
    const hx = gl.x
    const hz = gl.z
    const heur = (k: number) => {
      const d = this.decode(k)
      return Math.hypot(d.x - hx, d.z - hz) + Math.abs(d.l - gl.l) * 8
    }
    const push = (k: number, f: number) => open.push(k, f)
    const trapCost = (x: number, z: number, y: number) => {
      let c = 0
      for (const t of avoid) if (Math.abs(t.y - y) < 1.5 && Math.hypot(t.x - (x + 0.5) * CELL, t.z - (z + 0.5) * CELL) < 1.3) c += TRAP_COST
      return c
    }
    g.set(start, 0)
    push(start, heur(start))
    const closed = new Set<number>()
    let expanded = 0
    while (open.size && expanded++ < maxNodes) {
      const cur = open.pop()
      if (cur === goal) break
      if (closed.has(cur)) continue
      closed.add(cur)
      const gc = g.get(cur)!
      const d = this.decode(cur)
      const here = this.cells[d.l][d.z * this.w + d.x]
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue
          // Thin walls sit on cell edges: never cut a diagonal past a blocked orthogonal neighbour.
          const nx = d.x + dx
          const nz = d.z + dz
          const c = this.cell(d.l, nx, nz)
          if (!c || !c.walkable) continue
          if (Math.abs(c.y - here.y) > 0.6) continue
          if (dx && dz) {
            // No corner cutting through blocked cells.
            const a = this.cell(d.l, d.x + dx, d.z)
            const b = this.cell(d.l, d.x, d.z + dz)
            if (!a?.walkable || !b?.walkable || a.blocker || b.blocker || c.blocker) continue
          }
          const nk = this.key(d.l, nx, nz)
          if (closed.has(nk)) continue
          const step = (dx && dz ? 1.414 : 1) * (own(c) ? 1 : c.cost) + trapCost(nx, nz, c.y)
          const ng = gc + step
          if (ng < (g.get(nk) ?? Infinity)) {
            g.set(nk, ng)
            came.set(nk, { from: cur })
            push(nk, ng + heur(nk))
          }
        }
      const links = this.links.get(cur)
      if (links)
        for (const link of links) {
          if (link.piece && !link.piece.alive) continue
          const nk = link.to
          if (closed.has(nk)) continue
          const target = this.decode(nk)
          const tc = this.cell(target.l, target.x, target.z)
          if (!tc?.walkable) continue
          const ng = gc + link.cost
          if (ng < (g.get(nk) ?? Infinity)) {
            g.set(nk, ng)
            came.set(nk, { from: cur, link })
            push(nk, ng + heur(nk))
          }
        }
    }
    if (!came.has(goal)) return null
    // Walk back.
    const keys: number[] = []
    const linksAt = new Map<number, Link>()
    let k = goal
    while (k !== start) {
      keys.push(k)
      const c = came.get(k)!
      if (c.link) linksAt.set(k, c.link)
      k = c.from
    }
    keys.reverse()
    const out: NavPoint[] = []
    for (const kk of keys) {
      const link = linksAt.get(kk)
      if (link) {
        for (const wp of link.path) out.push({ ...wp, link })
        continue
      }
      const d = this.decode(kk)
      const c = this.cells[d.l][d.z * this.w + d.x]
      out.push({ x: (d.x + 0.5) * CELL, y: c.y, z: (d.z + 0.5) * CELL, breakPiece: c.blocker && !own(c) ? c.blocker : undefined })
    }
    out.push({ x: bx, y: by, z: bz })
    return out
  }
}

/** Cell index of a world coordinate. */
export function cx(v: number) {
  return Math.floor(v / CELL)
}

/** A small binary min-heap of (key, priority). */
class Heap {
  private k: number[] = []
  private f: number[] = []
  get size() {
    return this.k.length
  }
  push(k: number, f: number) {
    this.k.push(k)
    this.f.push(f)
    let i = this.k.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.f[p] <= this.f[i]) break
      this.swap(i, p)
      i = p
    }
  }
  pop() {
    const top = this.k[0]
    const lk = this.k.pop()!
    const lf = this.f.pop()!
    if (this.k.length) {
      this.k[0] = lk
      this.f[0] = lf
      let i = 0
      for (;;) {
        const a = i * 2 + 1
        const b = a + 1
        let m = i
        if (a < this.k.length && this.f[a] < this.f[m]) m = a
        if (b < this.k.length && this.f[b] < this.f[m]) m = b
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }
  private swap(i: number, j: number) {
    const tk = this.k[i]
    this.k[i] = this.k[j]
    this.k[j] = tk
    const tf = this.f[i]
    this.f[i] = this.f[j]
    this.f[j] = tf
  }
}
