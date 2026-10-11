import { tiles, type Tile } from '../data/content'
import { HUB_MISSIONS, REGIONS } from './regions'
import { heightAt } from './terrain'

export interface Mission {
  tile: Tile
  name: string
  region: string
  regionName: string
  accent: string
  x: number
  z: number
  y: number
}

const tileById = (id: string) => tiles.find((t) => t.id === id)!

export const MISSIONS: Mission[] = [
  ...REGIONS.map((r) => {
    const x = r.center[0] + r.beacon[0], z = r.center[1] + r.beacon[1]
    return { tile: tileById(r.tile), name: r.mission, region: r.id, regionName: r.name, accent: r.accent, x, z, y: heightAt(x, z) }
  }),
  ...HUB_MISSIONS.map((m) => {
    const hub = REGIONS.find((r) => r.id === m.region) ?? REGIONS[0]
    const x = hub.center[0] + m.at[0], z = hub.center[1] + m.at[1]
    return { tile: tileById(m.tile), name: m.name, region: hub.id, regionName: hub.name, accent: hub.accent, x, z, y: heightAt(x, z) }
  }),
]

export const INTERACT_DISTANCE = 6
