// Shared bits for the team pack (Yarn Tug, Pillow Fort Siege, Tidy Up Time, Sock Hoops, Egg Hunt Heist): toy-like
// materials, canvas-painted textures, a wicker basket, team spawns, carrying bots and synced loose props.
// Not a level: nothing here is registered.
import * as THREE from 'three'
import { avoidWalls, hopObstacles, steerTo } from '../engine/bots'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import type { LevelCtx, Spawn, Toy } from '../engine/types'

/** Soft, flat-shaded toy material. */
export function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra })
}

/** A canvas texture painted by `draw` (sRGB, repeating). */
export function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat = 1) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  return t
}

/** Woven wicker (baskets). */
export function wickerTex(base = '#c58b4e', dark = '#8a5a2b') {
  return paint(64, 64, (g, w, h) => {
    g.fillStyle = dark
    g.fillRect(0, 0, w, h)
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        g.fillStyle = base
        const horiz = (x + y) % 2 === 0
        if (horiz) g.fillRect(x * 16 + 1, y * 16 + 4, 14, 8)
        else g.fillRect(x * 16 + 4, y * 16 + 1, 8, 14)
        g.fillStyle = 'rgba(255,255,255,0.18)'
        if (horiz) g.fillRect(x * 16 + 2, y * 16 + 5, 12, 2)
        else g.fillRect(x * 16 + 5, y * 16 + 2, 2, 12)
      }
  })
}

/** Patchwork quilt with stitched squares. */
export function quiltTex(colors: string[], squares = 4) {
  return paint(256, 256, (g, w) => {
    const s = w / squares
    for (let y = 0; y < squares; y++)
      for (let x = 0; x < squares; x++) {
        g.fillStyle = colors[(x * 3 + y * 5) % colors.length]
        g.fillRect(x * s, y * s, s, s)
        // A little motif per patch: dots or a cross.
        g.fillStyle = 'rgba(255,255,255,0.35)'
        if ((x + y) % 2) for (let k = 0; k < 4; k++) g.fillRect(x * s + s * (0.2 + 0.2 * k), y * s + s * (0.25 + 0.5 * (k % 2)), 5, 5)
        else {
          g.fillRect(x * s + s / 2 - 2, y * s + s * 0.25, 4, s / 2)
          g.fillRect(x * s + s * 0.25, y * s + s / 2 - 2, s / 2, 4)
        }
      }
    g.strokeStyle = 'rgba(255,248,230,0.75)'
    g.lineWidth = 2
    g.setLineDash([6, 5])
    for (let i = 0; i <= squares; i++) {
      g.beginPath()
      g.moveTo(i * s + 1, 0)
      g.lineTo(i * s + 1, w)
      g.moveTo(0, i * s + 1)
      g.lineTo(w, i * s + 1)
      g.stroke()
    }
  })
}

/** Stripes (yarn, socks, beach towels). */
export function stripeTex(colors: string[], n = 8, vertical = false) {
  return paint(64, 64, (g, w, h) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length]
      if (vertical) g.fillRect((i * w) / n, 0, w / n + 1, h)
      else g.fillRect(0, (i * h) / n, w, h / n + 1)
    }
  })
}

/** An open wicker basket (no colliders): a tapered tube, a base and a rolled rim. Sits on y = 0. */
export function basketMesh(radius: number, height: number, tint = '#ffffff', tex = wickerTex()) {
  const g = new THREE.Group()
  tex.repeat.set(Math.round(radius * 5), Math.max(1, Math.round(height * 2.5)))
  const m = new THREE.MeshStandardMaterial({ map: tex, color: tint, roughness: 0.9, side: THREE.DoubleSide })
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.86, height, 22, 1, true), m)
  wall.position.y = height / 2
  wall.castShadow = true
  wall.receiveShadow = true
  const base = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86, 22).rotateX(-Math.PI / 2), m)
  base.position.y = 0.03
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.07, 6, 26).rotateX(Math.PI / 2), mat('#7a4a22'))
  rim.position.y = height
  g.add(wall, base, rim)
  return g
}

/** Where toy i goes among its own team: its rank within the team and the team's size. */
export function teamSlot(ctx: LevelCtx, toy: Toy, i: number) {
  let k = 0, n = 0
  ctx.toys.forEach((t, j) => {
    if (t.team !== toy.team) return
    n++
    if (j < i) k++
  })
  return { k, n: Math.max(1, n) }
}

/** Spawn a team in a grid round (x, z) facing yaw. */
export function teamSpawn(ctx: LevelCtx, toy: Toy, i: number, x: number, z: number, yaw: number, spacing = 1.5): Spawn {
  const { k, n } = teamSlot(ctx, toy, i)
  return ctx.spawnGrid(n, { x, z, yaw, spacing, cols: Math.min(n, 4) })[k]
}

/** A loose prop body (box or ball) on the prop collision group. */
export function looseBody(ctx: LevelCtx, pos: THREE.Vector3Like, shape: { ball?: number; box?: [number, number, number]; capsule?: [number, number] }, o: { density?: number; friction?: number; restitution?: number; damping?: number } = {}) {
  const b = ctx.phys.dynamic(pos, { damping: o.damping ?? 0.3, ccd: true })
  const R = ctx.RAPIER
  const d = shape.ball ? R.ColliderDesc.ball(shape.ball) : shape.capsule ? R.ColliderDesc.capsule(shape.capsule[0], shape.capsule[1]) : R.ColliderDesc.cuboid(...(shape.box ?? [0.3, 0.3, 0.3]))
  d.setDensity(o.density ?? 0.5)
  ctx.phys.attach(b, d, { friction: o.friction ?? 0.7, restitution: o.restitution ?? 0.25, groups: PROP_GROUPS })
  return b
}

/** Park a pooled prop out of play (frozen, far below) / bring it back. */
export function park(b: RigidBody, i = 0) {
  b.setGravityScale(0, false)
  b.setLinvel({ x: 0, y: 0, z: 0 }, false)
  b.setAngvel({ x: 0, y: 0, z: 0 }, false)
  b.setTranslation({ x: i * 2, y: -60, z: 0 }, false)
  b.sleep()
}
export function unpark(b: RigidBody, x: number, y: number, z: number, vy = 0) {
  b.setGravityScale(1, true)
  b.setTranslation({ x, y, z }, true)
  b.setLinvel({ x: 0, y: vy, z: 0 }, true)
  b.setAngvel({ x: 0, y: 0, z: 0 }, true)
  b.wakeUp()
}
export const parked = (b: RigidBody) => b.translation().y < -40

/** Who is holding this body right now (or null). */
export function holderOf(ctx: LevelCtx, b: RigidBody): Toy | null {
  for (const t of ctx.toys) if (t.holdingProp === b && t.status === 'play') return t
  return null
}

/**
 * Track who holds which body between ticks. `prev` keeps the last holder per body (toy index or -1). Returns the
 * bodies let go of this tick, with whoever dropped them and whether they were thrown (moving fast) or dropped.
 */
export function holdChanges(ctx: LevelCtx, bodies: readonly RigidBody[], prev: number[]) {
  const by = new Map<RigidBody, Toy>()
  for (const t of ctx.toys) if (t.holdingProp && t.status === 'play') by.set(t.holdingProp, t)
  const out: { i: number; by: Toy; tossed: boolean }[] = []
  bodies.forEach((b, i) => {
    const h = by.get(b)
    const now = h ? h.idx : -1
    const was = prev[i] ?? -1
    if (was >= 0 && now !== was) {
      const v = b.linvel()
      out.push({ i, by: ctx.toys[was], tossed: Math.hypot(v.x, v.z) > 4 })
    }
    prev[i] = now
  })
  return out
}

/** Give a thrown body a proper throw: `speed` along the thrower's facing (or towards `at`), plus some lift. */
export function throwBody(b: RigidBody, toy: Toy, speed: number, up: number, at?: { x: number; z: number }) {
  let fx = Math.sin(toy.yaw), fz = Math.cos(toy.yaw)
  if (at) {
    const dx = at.x - toy.pos.x, dz = at.z - toy.pos.z
    const l = Math.hypot(dx, dz)
    if (l > 0.1) {
      fx = dx / l
      fz = dz / l
    }
  }
  b.setLinvel({ x: fx * speed + toy.vel.x * 0.3, y: up, z: fz * speed + toy.vel.z * 0.3 }, true)
}

/** Ground distance from a toy to a body. */
export function distTo(toy: Toy, b: RigidBody) {
  const p = b.translation()
  return Math.hypot(p.x - toy.pos.x, p.z - toy.pos.z)
}

/**
 * Bot: walk to a loose body and pick it up (hold Grab when close and facing it). Returns true while holding it.
 * `pace` is the skill pace.
 */
export function fetch(ctx: LevelCtx, toy: Toy, b: RigidBody, pace: number) {
  if (toy.holdingProp === b) {
    toy.pad.grab = true
    return true
  }
  const p = b.translation()
  const d = steerTo(toy, p.x, p.z, { stop: 0.55, pace })
  avoidWalls(ctx, toy)
  hopObstacles(ctx, toy)
  if (d < 1.4) {
    // Face it, then grab.
    const dx = p.x - toy.pos.x, dz = p.z - toy.pos.z
    const l = Math.hypot(dx, dz) || 1
    toy.pad.mx = (dx / l) * 0.35
    toy.pad.mz = (dz / l) * 0.35
    const f = toy.facing()
    if ((dx * f.x + dz * f.z) / l > 0.4) toy.pad.grab = true
  }
  return false
}

/** Bot: carry what it holds to (x, z); returns the distance left. Keeps Grab held. */
export function carryTo(ctx: LevelCtx, toy: Toy, x: number, z: number, pace: number, stop = 0.6) {
  toy.pad.grab = true
  const d = steerTo(toy, x, z, { stop, pace })
  avoidWalls(ctx, toy)
  return d
}

/** Seconds-based pulse 0..1 (for blinking indicators). */
export const pulse = (t: number, hz = 2) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * hz)

/** Round to 2 decimals (pack). */
export const r2 = (x: number) => Math.round(x * 100) / 100

/** An instanced set of one geometry with per-instance colour (for clutter: books, yarn balls, leaves). */
export function instanced(geo: THREE.BufferGeometry, material: THREE.Material, items: { pos: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number]; color?: string }[], shadows = false) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, items.length))
  const o = new THREE.Object3D()
  const c = new THREE.Color()
  items.forEach((it, i) => {
    o.position.set(...it.pos)
    o.rotation.set(...(it.rot ?? [0, 0, 0]))
    o.scale.set(...(it.scale ?? [1, 1, 1]))
    o.updateMatrix()
    m.setMatrixAt(i, o.matrix)
    if (it.color) m.setColorAt(i, c.set(it.color))
  })
  m.count = items.length
  m.instanceMatrix.needsUpdate = true
  if (m.instanceColor) m.instanceColor.needsUpdate = true
  m.castShadow = shadows
  m.receiveShadow = true
  return m
}

/** "Fluff's", "Feathers'". */
export const poss = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`)

/**
 * Run speeds set by the rules on the host (slow carriers, duvets, lint) go to clients too, so an online player's
 * own predicted toy moves at the same speed the host expects.
 */
export const speeds = (ctx: LevelCtx) => ctx.toys.map((t) => Math.round(t.runSpeed * 10) / 10)
export function setSpeeds(ctx: LevelCtx, v: unknown) {
  if (!Array.isArray(v)) return
  ctx.toys.forEach((t, i) => {
    if (typeof v[i] === 'number') t.runSpeed = v[i]
  })
}
