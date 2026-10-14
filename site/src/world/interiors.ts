// Rooms you can walk into: the castle arcade's hall on Games Plaza and the great hall of Khotyn Keep. Each room is
// built in the sky over open country (same scene, nothing to swap), reached through a door on the island: E at the
// door moves the player inside, E at the glowing exit puts them back on the doorstep. Walls are colliders and the
// floor is a set floor, so walking, jumping and the camera behave as they do outside.
import type * as THREE from 'three'
import { boxCollider, setExtraColliders, setLandmarkFloor, type Collider } from './colliders'
import { KEEP_AT } from './districts'
import { regionById } from './regions'
import { heightAt } from './terrain'
import { world } from './store'
import { play } from '../lib/sound'
import { showLoader, type LoaderHandle } from '../lib/loader3d'
import { roomScene } from '../lib/loading'

export type RoomId = 'arcade' | 'hall'

export interface Room {
  id: RoomId
  name: string
  /** Centre of the floor (world). */
  x: number
  y: number
  z: number
  /** Inner width (x), depth (z) and ceiling height, metres. */
  w: number
  d: number
  h: number
  /** Where you appear inside (room space, just in from the exit) and the exit door (room space, on the south wall). */
  spawn: [number, number]
  exit: [number, number]
  /** The door outside (world) and which way you face stepping out. */
  door: () => { x: number; z: number; yaw: number }
}

const FLOOR_Y = 240

export const ROOMS: Record<RoomId, Room> = {
  arcade: {
    id: 'arcade',
    name: 'the Castle Arcade',
    x: 150, y: FLOOR_Y, z: 60, w: 34, d: 26, h: 9,
    spawn: [0, 4.5], exit: [0, 12.2],
    door: () => {
      const r = regionById('dunes')
      return { x: r.center[0], z: r.center[1] - 16, yaw: 0 }
    },
  },
  hall: {
    id: 'hall',
    name: 'the great hall',
    x: 170, y: FLOOR_Y, z: -230, w: 24, d: 40, h: 14,
    spawn: [0, 12], exit: [0, 19.2],
    door: () => {
      const r = regionById('ridge')
      return { x: r.center[0] + KEEP_AT[0], z: r.center[1] + KEEP_AT[1] + 15, yaw: 0 }
    },
  },
}

/** World position of a point given in room space. */
export const roomPoint = (r: Room, lx: number, lz: number): [number, number, number] => [r.x + lx, r.y, r.z + lz]

/** The room a point is inside, if any. */
export function roomAt(x: number, y: number, z: number): Room | null {
  for (const r of Object.values(ROOMS))
    if (Math.abs(x - r.x) <= r.w / 2 + 0.5 && Math.abs(z - r.z) <= r.d / 2 + 0.5 && y >= r.y - 2 && y <= r.y + r.h + 1) return r
  return null
}

/** Keep a camera position inside the room it looks into (walls and ceiling stay in front of it). */
export function clampToRoom(r: Room, p: THREE.Vector3) {
  const m = 0.6
  p.x = Math.min(r.x + r.w / 2 - m, Math.max(r.x - r.w / 2 + m, p.x))
  p.z = Math.min(r.z + r.d / 2 - m, Math.max(r.z - r.d / 2 + m, p.z))
  p.y = Math.min(r.y + r.h - m, Math.max(r.y + 0.8, p.y))
}

/** Solid furniture per room (room space): [x, z, half x, half z, height]. */
const FURNITURE: Record<RoomId, [number, number, number, number, number][]> = {
  arcade: [[0, -11.4, 2.7, 1.2, 4]],
  hall: [
    [0, -1.4, 1.3, 6.8, 1.4], // banquet tables and benches
    [0, -17, 2.2, 2, 4], // throne dais
    [11, 0, 1.2, 2.2, 5], // fireplace
  ],
}

/** Walls, furniture and the floor of every room, registered once with the collision system. */
export function registerRooms(extra: Partial<Record<RoomId, Collider[]>> = {}) {
  for (const r of Object.values(ROOMS)) {
    const t = 0.6
    const top = r.y + r.h + 2, bottom = r.y - 1.5
    const wall = (x: number, z: number, hx: number, hz: number) => boxCollider(r.x + x, r.z + z, hx, hz, 0, top, bottom)
    const list: Collider[] = [
      wall(0, -r.d / 2 - t, r.w / 2 + t, t),
      wall(0, r.d / 2 + t, r.w / 2 + t, t),
      wall(-r.w / 2 - t, 0, t, r.d / 2 + t),
      wall(r.w / 2 + t, 0, t, r.d / 2 + t),
      ...FURNITURE[r.id].map(([x, z, hx, hz, h]) => boxCollider(r.x + x, r.z + z, hx, hz, 0, r.y + h, bottom)),
      ...(extra[r.id] ?? []),
    ]
    setExtraColliders(`room:${r.id}`, list)
    // One floor cell per 2 m across the room, at the room's floor height.
    const floor = new Map<string, number>()
    const cell = 2
    for (let gx = Math.floor(-r.w / 2 / cell) - 1; gx <= Math.ceil(r.w / 2 / cell); gx++)
      for (let gz = Math.floor(-r.d / 2 / cell) - 1; gz <= Math.ceil(r.d / 2 / cell); gz++) floor.set(`${gx},${gz}`, 0)
    setLandmarkFloor(`room:${r.id}`, { x: r.x, z: r.z, y: r.y, yaw: 0, cell, floor })
  }
}

type Mover = { pos: THREE.Vector3; yaw: number; camYaw?: number }

/** Rooms visited this session, and the loader a door put up for a first visit (the room takes it over). */
const visited = new Set<RoomId>()
const doorLoader: Partial<Record<RoomId, LoaderHandle>> = {}
export function takeRoomLoader(id: RoomId) {
  const h = doorLoader[id] ?? null
  delete doorLoader[id]
  return h
}

/** Through the door: into the room, facing in. */
export function enterRoom(id: RoomId, player: Mover) {
  const r = ROOMS[id]
  if (!visited.has(id)) {
    visited.add(id)
    const h = showLoader({ status: `Entering ${r.name}…`, progress: null, scene: roomScene(id) })
    doorLoader[id] = h
    // The room takes the loader over as it mounts; never leave it up if it does not.
    window.setTimeout(() => {
      if (doorLoader[id] === h) {
        delete doorLoader[id]
        h.release()
      }
    }, 3000)
  }
  const [x, y, z] = roomPoint(r, r.spawn[0], r.spawn[1])
  player.pos.set(x, y, z)
  // Facing north, into the room (the camera sits behind, towards the exit).
  player.yaw = Math.PI
  if (player.camYaw !== undefined) player.camYaw = 0
  play('select')
  world.set({ room: id })
  world.notify(`Welcome to ${r.name} · E at the glowing door to leave`)
}

/** Back out onto the doorstep. */
export function leaveRoom(id: RoomId, player: Mover) {
  const d = ROOMS[id].door()
  const x = d.x + Math.sin(d.yaw) * 3, z = d.z + Math.cos(d.yaw) * 3
  player.pos.set(x, heightAt(x, z), z)
  player.yaw = d.yaw
  if (player.camYaw !== undefined) player.camYaw = d.yaw + Math.PI
  play('select')
  world.set({ room: null })
}
