// Street layouts for the districts built from kits of original buildings: the harbour lane, Neon City's downtown
// grid, the walk-in stadium, the village below the keep and the keep's bailey. Coordinates are region space.
import type { Landmark, ModelName } from './regions'

/** Fortress module sizes at the heights they are placed at (metres, measured from the models). */
const WALL = { len: 19.6, height: 8, depth: 3.3 }
export const GATE = { width: 18, height: 14 }

/**
 * A walled bailey from the fortress modules: wall sections around a w x d rectangle (centred on cx, cz), round
 * towers on the corners and the open gatehouse in the middle of the south side, flanked by pillars.
 */
export function bailey(cx: number, cz: number, w: number, d: number): Landmark[] {
  const out: Landmark[] = []
  const wall = (x: number, z: number, rot: number) =>
    out.push({ model: 'fortress-wall', at: [x, z], height: WALL.height, rot, pad: 7, set: true, foot: [WALL.len, WALL.depth] })
  const nx = Math.round(w / WALL.len), nz = Math.round(d / WALL.len)
  for (let i = 0; i < nx; i++) {
    const x = cx - w / 2 + (i + 0.5) * (w / nx)
    wall(x, cz - d / 2, 180)
    // The south side leaves the middle open for the gatehouse.
    if (Math.abs(x - cx) > GATE.width / 2 + WALL.len / 2 - 1) wall(x, cz + d / 2, 0)
  }
  for (let i = 0; i < nz; i++) {
    const z = cz - d / 2 + (i + 0.5) * (d / nz)
    wall(cx - w / 2, z, -90)
    wall(cx + w / 2, z, 90)
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    out.push({ model: 'fortress-tower', at: [cx + (sx * w) / 2, cz + (sz * d) / 2], height: 19, pad: 5, set: true, foot: [8, 8] })
  out.push({ model: 'fortress-gate', at: [cx, cz + d / 2], height: GATE.height, rot: 0, pad: 10, passage: [2.8, 7.5], foot: [GATE.width, 6] })
  for (const sx of [-1, 1])
    out.push({ model: 'fortress-pillar', at: [cx + sx * (GATE.width / 2 + 2.5), cz + d / 2 + 4], height: 11, pad: 3, set: true, foot: [3, 3] })
  return out
}

/** Harbour Town: a lane of fishermen's houses, townhouses, the tavern and the fish market behind the quay. */
export function harbourTown(): Landmark[] {
  const north: [ModelName, number, number, number][] = [
    ['fisher-house', -58, 8, 0],
    ['harbour-townhouse', -48.5, 12, 0],
    ['harbour-townhouse', -42, 11, 0],
    ['tavern', -32, 9, 0],
    ['harbour-townhouse', -22.5, 12.5, 0],
    ['fisher-house', -13, 8, -10],
  ]
  const south: [ModelName, number, number, number][] = [
    ['fish-market', -50, 6, 90],
    ['harbour-townhouse', -38, 11.5, 180],
    ['fisher-house', -29, 8, 180],
    ['harbour-townhouse', -20, 12, 180],
  ]
  const foot = (m: ModelName): [number, number] =>
    m === 'fish-market' ? [11, 7] : m === 'harbour-townhouse' ? [5.5, 5.5] : m === 'tavern' ? [7, 8.5] : [7.5, 8]
  return [
    ...north.map(([model, x, height, rot]): Landmark => ({ model, at: [x, -21], height, rot, pad: 5, foot: foot(model) })),
    ...south.map(([model, x, height, rot]): Landmark => ({ model, at: [x, 10], height, rot, pad: 5, foot: foot(model) })),
  ]
}

/**
 * Neon City's downtown: a 4 x 4 grid of 30 m blocks between 10 m streets, each block a different mix of towers,
 * brownstones, corner shops and cyberpunk stacks (one block left open as a plaza).
 */
export function neonGrid(): Landmark[] {
  type Slot = [ModelName, number, number, number, number, [number, number]]
  const patterns: Slot[][] = [
    [['city-glass-tower', -7, -6, 44, 0, [11, 11]], ['city-brownstone', 5, 8, 16, 0, [14, 9]], ['city-corner', 8, -7, 13, 0, [10, 10]]],
    [['city-deco-tower', 6, -6, 40, 0, [10, 10]], ['city-brownstone', -4, 8, 15, 0, [14, 9]], ['city-corner', -8, -7, 12, 90, [10, 10]]],
    [['cyber-tower', -6, 6, 36, 0, [10, 11]], ['cyber-shop', 6, -7, 9, 180, [12, 10]], ['city-glass-tower', 7, 7, 38, 0, [11, 11]]],
    [['scifi-tower', 0, -4, 40, 0, [11, 11]], ['city-brownstone', -6, 9, 15, 0, [14, 9]], ['cyber-shop', 8, 8, 8.5, 0, [12, 10]]],
  ]
  const out: Landmark[] = []
  let i = 0
  for (const bz of [-80, -40, 0, 40])
    for (const bx of [-60, -20, 20, 60]) {
      const k = i++
      if (bx === 20 && bz === 0) continue
      const turn = (k * 90) % 360
      const yaw = (turn * Math.PI) / 180
      const c = Math.cos(yaw), s = Math.sin(yaw)
      for (const [model, lx, lz, height, rot, foot] of patterns[k % patterns.length]) {
        // Rotate the slot about the block centre (three.js yaw convention) and the building with it.
        const x = bx + lx * c + lz * s, z = bz - lx * s + lz * c
        out.push({ model, at: [x, z], height: height * (0.92 + ((k * 37) % 17) / 100), rot: rot + turn, pad: 5, foot })
      }
    }
  return out
}

/** Centre of the walk-in stadium's pitch (region space) and its half extents (x, z). */
export const STADIUM_PITCH: [number, number] = [0, -100]
export const PITCH_HALF: [number, number] = [25, 44]

/** Yaw (degrees) that turns a piece at the (sx, sz) corner to face the pitch centre. */
const facePitch = (sx: number, sz: number) => (Math.atan2(-sx, -sz) * 180) / Math.PI
/** Extra yaw that brings the corner stand's curve into line with facePitch (measured from the model). */
export const CORNER_TURN = 0

/**
 * The walk-in stadium: straight grandstands down both touchlines and behind the north goal, curved corner stands,
 * the players' tunnel through the south end, floodlights, and the closed bowl standing in for all of it from afar.
 */
export function walkInStadium(cx: number, cz: number): Landmark[] {
  const [hx, hz] = PITCH_HALF
  const D = 15.9 // stand depth at 16 m
  const out: Landmark[] = [{ model: 'stadium-bowl', at: [cx, cz], height: 36, rot: 90, lod: 'far', ghost: true, pad: 64, foot: [90, 100] }]
  const stand = (x: number, z: number, rot: number, height = 16, foot: [number, number] = [45, D]) =>
    out.push({ model: 'stadium-stand', at: [cx + x, cz + z], height, rot, stand: true, lod: 'near', foot, pad: 4 })
  for (const sz of [-1, 1]) {
    stand(-(hx + 2 + D / 2), (sz * 45) / 2, 90)
    stand(hx + 2 + D / 2, (sz * 45) / 2, -90)
  }
  stand(0, -(hz + 2 + D / 2), 0)
  for (const sx of [-1, 1]) stand(sx * 19.5, hz + 2 + 5, 180, 10, [28, 10])
  out.push({ model: 'stadium-tunnel', at: [cx, cz + hz + 2 + 5], height: 10, rot: 180, passage: [2.6, 5.2, true], lod: 'near', foot: [11, 14], pad: 4 })
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    out.push({ model: 'stand-corner', at: [cx + sx * (hx + 12), cz + sz * (hz + 12)], height: 14, rot: facePitch(sx, sz) + CORNER_TURN, stand: true, lod: 'near', foot: [16, 16], pad: 4 })
    out.push({ model: 'floodlight', at: [cx + sx * (hx + 26), cz + sz * (hz + 22)], height: 32, rot: facePitch(sx, sz), lod: 'near', pad: 3 })
  }
  return out
}

/** The village below the keep: cottages, stone houses and the forge round a small green. */
export function village(cx: number, cz: number): Landmark[] {
  const list: [ModelName, number, number, number, number][] = [
    ['village-cottage', -8, -6, 7, 30],
    ['village-stonehouse', 7, -8, 9, -20],
    ['village-forge', -2, 9, 7, 160],
    ['village-cottage', 13, 8, 6.5, 200],
    ['village-stonehouse', -17, 6, 8.5, 100],
  ]
  return list.map(([model, x, z, height, rot]): Landmark => ({ model, at: [cx + x, cz + z], height, rot, pad: 6, foot: [10, 10] }))
}

/** The keep inside the bailey; its door leads into the great hall. */
export const KEEP_AT: [number, number] = [0, -30]
