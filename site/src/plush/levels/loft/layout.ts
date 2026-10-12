// Where everything in the Loft stands (metres; the attic floor runs ±18 on x and z, the roof ridge runs along z
// and comes down to 4 m knee walls at x = ±18). Shared by the decor builders and the hidden games.

export const DISCO = {
  /** The light-up dance floor (Freeze Dance): n × n board-game tiles. */
  floor: { x: -12, z: -10.3, n: 6, tile: 1.1 },
  wardrobe: { x: -12.5, z: -16.3, w: 6, h: 5.4, d: 2.6 },
  /** Coat-hanger balcony inside the wardrobe (top height) and the shoebox step up to it. */
  balcony: { y: 1.5, z0: -16.9, z1: -15.1, x0: -15.0, x1: -10.0 },
  step: { x: -12.5, z: -14.55, h: 0.75 },
  ballY: 6.4,
} as const

export const JUNGLE = {
  /** Vine Swing: vines hang from a bamboo hoop round a big potted plant; the raised planter bed below. */
  ring: { x: 12, z: -11.6, r: 3.6, n: 9, anchorY: 5.5, rope: 2.3 },
  bed: { r: 4.7, h: 0.5 },
  pot: { r: 1.45, h: 1.7 },
  /** The start pad (pots as steps) at the ring's room side. */
  start: { x: 8.7, z: -8.4 },
  can: { x: 7.4, z: -16.6 },
  pond: { x: 6.5, z: -14.4, r: 1.05 },
} as const

export const BEACH = {
  tub: { x: 15.1, z: 9.6, len: 6.4, wid: 3.2, h: 2.1, water: 1.55 },
  /** Bath Bomb Bowling lane: from the foul line (x0) down to the backstop (x1), along z. */
  lane: { x0: 13.0, x1: 2.6, z: 16.2, w: 1.9 },
  headPin: 4.9,
  pad: { x: 13.9, z: 16.2 },
  duck: { x: 11.2, z: 13.4 },
  towel: { x: 9.4, z: 9.6 },
} as const

export const ARCADE = {
  claw: { x: -11.5, z: 15.3, size: 2.6 },
  /** Where you stand to work the claw. */
  pad: { x: -11.5, z: 13.0 },
  cabinets: { x: -16.0, z: [7.6, 9.7, 11.8] },
} as const

export const SEW = {
  podium: { x: 5.6, z: 5.9, r: 0.95, h: 0.32 },
  mirror: { x: 7.9, z: 7.8 },
} as const

export const BOARD = { x: 0, y: 3.3, z: -17.85, w: 7.2, h: 4.2 } as const
