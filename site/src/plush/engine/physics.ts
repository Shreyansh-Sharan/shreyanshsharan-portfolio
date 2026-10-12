// Rapier (WebAssembly physics) for PLUSH PANIC. The module (about 2 MB with its inlined WebAssembly) is fetched
// by loadPhysics() when a game starts, never with the menu. `Phys` wraps one round's world with the helpers
// levels use to build colliders, plus the queries the toys and camera need.
import type * as RapierNS from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

export type Rapier = typeof RapierNS
export type RigidBody = RapierNS.RigidBody
export type Collider = RapierNS.Collider
export type ColliderDesc = RapierNS.ColliderDesc

/** The Rapier module. A live binding: valid once loadPhysics() has resolved. */
// eslint-disable-next-line import/no-mutable-exports
export let RAPIER: Rapier = null as unknown as Rapier

let ready: Promise<void> | null = null

/** Fetch and initialise the WebAssembly module once. */
export function loadPhysics() {
  ready ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = ((m as unknown as { default?: Rapier }).default ?? m) as Rapier
    await R.init()
    RAPIER = R
  })
  return ready
}

/** Collision groups. A collider's groups are (membership << 16) | filter. */
export const G = {
  WORLD: 0x0001,
  TOY: 0x0002,
  PROP: 0x0004,
  SENSOR: 0x0008,
} as const
export const groups = (member: number, filter: number) => (member << 16) | filter
/** Solid level geometry: collides with everything. */
export const WORLD_GROUPS = groups(G.WORLD, 0xffff)
export const TOY_GROUPS = groups(G.TOY, G.WORLD | G.TOY | G.PROP)
export const PROP_GROUPS = groups(G.PROP, 0xffff)

export const GRAVITY = -24
export const STEP = 1 / 60

export interface ColliderOpts {
  friction?: number
  restitution?: number
  /** Default WORLD_GROUPS. */
  groups?: number
  sensor?: boolean
  /** Rotation about Y in radians. */
  rotY?: number
  /** Full rotation (overrides rotY). */
  quat?: THREE.Quaternion
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()

function applyOpts(d: ColliderDesc, o: ColliderOpts = {}) {
  d.setFriction(o.friction ?? 0.6)
  d.setRestitution(o.restitution ?? 0.05)
  d.setCollisionGroups(o.groups ?? WORLD_GROUPS)
  if (o.sensor) d.setSensor(true)
  const q = o.quat ?? (o.rotY ? _q.setFromEuler(_e.set(0, o.rotY, 0)) : null)
  if (q) d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
  return d
}

/** One round's physics world plus builder helpers. */
export class Phys {
  readonly world: RapierNS.World
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 })
    this.world.timestep = STEP
  }

  step() {
    this.world.step()
  }

  free() {
    this.world.free()
  }

  /* ---------- Static geometry ---------- */

  /** A fixed box: `pos` is its centre, `half` its half extents. */
  box(pos: THREE.Vector3Like, half: THREE.Vector3Like, o?: ColliderOpts) {
    const d = applyOpts(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), o).setTranslation(pos.x, pos.y, pos.z)
    return this.world.createCollider(d)
  }

  /** A fixed upright cylinder: `pos` is its centre. */
  cylinder(pos: THREE.Vector3Like, halfHeight: number, radius: number, o?: ColliderOpts) {
    const d = applyOpts(RAPIER.ColliderDesc.cylinder(halfHeight, radius), o).setTranslation(pos.x, pos.y, pos.z)
    return this.world.createCollider(d)
  }

  ball(pos: THREE.Vector3Like, radius: number, o?: ColliderOpts) {
    const d = applyOpts(RAPIER.ColliderDesc.ball(radius), o).setTranslation(pos.x, pos.y, pos.z)
    return this.world.createCollider(d)
  }

  /** A fixed triangle mesh from a three.js mesh (its world transform is baked in). Use for ramps and odd shapes. */
  trimesh(mesh: THREE.Mesh, o?: ColliderOpts) {
    mesh.updateWorldMatrix(true, false)
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const pos = g.attributes.position
    const verts = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      verts.set([_v.x, _v.y, _v.z], i * 3)
    }
    const idx = new Uint32Array(pos.count)
    for (let i = 0; i < idx.length; i++) idx[i] = i
    const d = applyOpts(RAPIER.ColliderDesc.trimesh(verts, idx), o)
    return this.world.createCollider(d)
  }

  /** Invisible walls round a rectangle (x/z half sizes) so nobody walks off the map. */
  walls(cx: number, cz: number, hx: number, hz: number, height = 8, thick = 1) {
    this.box({ x: cx, y: height / 2, z: cz - hz - thick }, { x: hx + thick, y: height / 2, z: thick })
    this.box({ x: cx, y: height / 2, z: cz + hz + thick }, { x: hx + thick, y: height / 2, z: thick })
    this.box({ x: cx - hx - thick, y: height / 2, z: cz }, { x: thick, y: height / 2, z: hz + thick })
    this.box({ x: cx + hx + thick, y: height / 2, z: cz }, { x: thick, y: height / 2, z: hz + thick })
  }

  /* ---------- Moving things ---------- */

  /** A kinematic body (moved by code: platforms, bars, pushers). Add colliders with `attach`. */
  kinematic(pos: THREE.Vector3Like) {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z))
  }

  /** A dynamic prop body (crates, balls). Synced to clients when registered with ctx.syncProp(). */
  dynamic(pos: THREE.Vector3Like, opts: { lockRot?: boolean; damping?: number; ccd?: boolean } = {}) {
    const d = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(opts.damping ?? 0.1).setAngularDamping(0.5)
    if (opts.lockRot) d.lockRotations()
    if (opts.ccd) d.setCcdEnabled(true)
    return this.world.createRigidBody(d)
  }

  attach(body: RigidBody, desc: ColliderDesc, o?: ColliderOpts) {
    return this.world.createCollider(applyOpts(desc, o), body)
  }

  remove(c: Collider | RigidBody | null | undefined) {
    if (!c) return
    if (c instanceof RAPIER.RigidBody) this.world.removeRigidBody(c)
    else this.world.removeCollider(c, true)
  }

  /* ---------- Queries ---------- */

  /**
   * Cast a ray; returns the hit distance or -1. `filter` is a collision-groups value (default: world only).
   * Excludes `exclude` (usually the caster's own body).
   */
  cast(from: THREE.Vector3Like, dir: THREE.Vector3Like, maxDist: number, filter = groups(0xffff, G.WORLD), exclude?: RigidBody) {
    this.ray.origin = { x: from.x, y: from.y, z: from.z }
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z }
    const hit = this.world.castRay(this.ray, maxDist, true, undefined, filter, undefined, exclude)
    return hit ? hit.timeOfImpact : -1
  }

  /** Distance to the ground below a point (world + props + other toys), or -1 within `maxDist`. */
  groundBelow(from: THREE.Vector3Like, maxDist: number, exclude?: RigidBody) {
    return this.cast(from, { x: 0, y: -1, z: 0 }, maxDist, groups(0xffff, G.WORLD | G.PROP | G.TOY), exclude)
  }
}
