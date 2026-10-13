// What E does here: the nearest thing you can use (a plaque to read, a cabinet, the car, the airship's ladder,
// the arcade door, the stadium gate). Framework-free; the HUD shows the prompt and runs the action.
import type * as THREE from 'three'
import { arcadeDoor, exhibits, stadiumGate, type Exhibit } from './exhibits'
import { AIRSHIP_STOPS } from './regions'
import { board, car, disembark, enterCar, exitCar, ship, stopAt } from './rides'
import { world } from './store'
import { play } from '../lib/sound'

export interface Interaction {
  label: string
  run: () => void
}

type Mover = { pos: THREE.Vector3; yaw: number }

const near = (x: number, z: number, px: number, pz: number, r: number) => Math.hypot(x - px, z - pz) < r

/** The nearest usable thing within reach of (x, z), or null. */
export function nearestInteraction(x: number, z: number, player: Mover): Interaction | null {
  const s = world.get()
  if (s.open || s.panel !== 'none' || s.exhibit || s.minigame) return null
  // In the car: only getting out.
  if (car.driving) return { label: 'Get out', run: () => exitCar(player) }
  // On the airship: pick a destination, or climb down once moored.
  if (ship.aboard) {
    if (ship.flying) return null
    return { label: 'Climb down', run: () => disembark(player) }
  }
  let best: { d: number; it: Interaction } | null = null
  const consider = (d: number, r: number, it: Interaction) => {
    if (d < r && (!best || d < best.d)) best = { d, it }
  }
  consider(Math.hypot(car.pos.x - x, car.pos.z - z), 3.6, { label: 'Drive the car', run: enterCar })
  if (!ship.flying) {
    const m = stopAt(ship.stop)
    consider(Math.hypot(m.x - x, m.z - z), 6, { label: 'Board the airship', run: board })
  }
  const door = arcadeDoor()
  consider(Math.hypot(door.x - x, door.z - z), door.r, { label: 'Enter the Arcade', run: () => openHub(null) })
  const gate = stadiumGate()
  consider(Math.hypot(gate.x - x, gate.z - z), gate.r, { label: 'Enter the Sports Complex', run: () => world.set({ scene: 'sports' }) })
  for (const e of exhibits()) {
    if (!near(e.x, e.z, x, z, 4.2)) continue
    const d = Math.hypot(e.x - x, e.z - z)
    if (e.kind === 'cabinet') consider(d, 3, { label: `Play ${e.title}`, run: () => openHub(e.tile ?? null) })
    else if (e.kind === 'sign') consider(d, 4.2, { label: 'Read the skills signpost', run: () => readSign() })
    else consider(d, 4.2, { label: e.kind === 'trophy' ? `Read: ${e.title}` : `Read the ${e.kind === 'plaque' ? 'plaque' : 'exhibit'}`, run: () => read(e) })
  }
  return best ? (best as { d: number; it: Interaction }).it : null
}

export function openHub(tile: string | null) {
  play('select')
  world.set({ panel: 'hub', hubTile: tile })
}

function read(e: Exhibit) {
  play('select')
  world.set({ exhibit: { title: e.title, subtitle: e.subtitle, lines: e.lines, accent: e.accent } })
}

function readSign() {
  play('select')
  const signs = exhibits().filter((e) => e.kind === 'sign')
  world.set({ exhibit: { title: 'Skill tree', subtitle: `${signs.length} branches`, lines: signs.flatMap((s) => [`${s.title}: ${s.lines.join(', ')}`, '']), accent: '#38bdf8' } })
}

/** The airship's next mooring choices, for the HUD. */
export function airshipStops() {
  return AIRSHIP_STOPS.map((_, i) => ({ i, region: stopAt(i).region, here: i === ship.stop }))
}
