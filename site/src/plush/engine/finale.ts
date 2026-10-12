// The crown: a shared crown mesh for finals, and a crown ceremony a final level runs from its visual() and
// cameraUpdate() hooks: when the round ends with a winner, every screen plays a fanfare, rains confetti, puts a
// spotlight on the winner (who does the victory cheer) and swings the camera round them. Purely local, so it
// needs no syncing: it reads toy statuses, which every screen already has.
import * as THREE from 'three'
import type { PlushAssets } from './assets'
import type { CamRig } from './camera'
import { FOOT } from './toy'
import type { LevelCtx, Toy } from './types'

/** The crown model, `width` metres across and resting on y = 0 (a gold band if the model is missing). */
export function crownMesh(assets: PlushAssets, width = 0.42): THREE.Object3D {
  const g = new THREE.Group()
  g.name = 'crown'
  const src = assets.props.crown
  if (!src) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(width / 2, width * 0.42, width * 0.45, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: '#facc15', metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide, emissive: '#7c4a03', emissiveIntensity: 0.3 }),
    )
    band.position.y = width * 0.22
    g.add(band)
    return g
  }
  const obj = src.clone(true)
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj)
  const s = box.getSize(new THREE.Vector3())
  const k = width / Math.max(s.x, s.z, 1e-4)
  const c = box.getCenter(new THREE.Vector3())
  obj.scale.multiplyScalar(k)
  obj.position.set(-c.x * k, -box.min.y * k, -c.z * k)
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.castShadow = true
  })
  g.add(obj)
  return g
}

export interface Ceremony {
  on: boolean
  /** Seconds since it began. */
  t: number
  /** Round index of the winner. */
  who: number
  next: number
  beam: THREE.Mesh | null
  ring: THREE.Mesh | null
  angle: number
}

export function ceremony(): Ceremony {
  return { on: false, t: 0, who: -1, next: 0, beam: null, ring: null, angle: 0 }
}

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

/**
 * Run the crown ceremony (every screen, from visual()). It starts once the round has ended with a qualified
 * toy (the winner), and returns the winner while it runs. `title` replaces the banner text.
 */
export function crownCeremony(ctx: LevelCtx, c: Ceremony, dt: number, title?: (winner: Toy) => string): Toy | null {
  if (ctx.phase === 'intro' || ctx.phase === 'countdown') {
    c.on = false
    if (c.beam) c.beam.visible = false
    if (c.ring) c.ring.visible = false
    return null
  }
  if (ctx.phase !== 'end') return null
  let w: Toy | null = c.on ? (ctx.toys[c.who] ?? null) : null
  if (!c.on) {
    for (const t of ctx.toys) if (t.status === 'qualified' && (!w || t.doneAt < w.doneAt)) w = t
    if (!w) return null
    c.on = true
    c.t = 0
    c.next = 0
    c.who = w.idx
    c.angle = Math.atan2(ctx.cam.camera.position.x - w.pos.x, ctx.cam.camera.position.z - w.pos.z)
    const crown = ctx.mode === 'show' && ctx.round.final
    ctx.fxLocal.say(title ? title(w) : crown ? `${w.name} WINS THE CROWN!` : `${w.name} WINS!`, '#fde047', 4)
    ctx.fxLocal.sfx('fanfare')
    ctx.fxLocal.sfx('cheer')
    ctx.fxLocal.hitStop(0.2)
    w.rig?.kick(0.35)
    if (!c.beam) {
      c.beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 1.6, 14, 24, 1, true).translate(0, 7, 0),
        new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
      )
      c.ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1.05, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }),
      )
      ctx.root.add(c.beam, c.ring)
    }
  }
  if (!w) return null
  c.t += dt
  const feet = w.pos.y - FOOT
  if (c.beam && c.ring) {
    c.beam.visible = c.ring.visible = true
    c.beam.position.set(w.pos.x, feet, w.pos.z)
    ;(c.beam.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(c.t * 5) * 0.04
    c.ring.position.set(w.pos.x, feet + 0.05, w.pos.z)
    c.ring.rotation.y += dt * 2
    c.ring.scale.setScalar(1 + Math.sin(c.t * 4) * 0.12)
  }
  // Confetti rains round the winner for a few seconds, with sparkles.
  if (c.t < 4 && c.t >= c.next) {
    c.next += 0.35
    const a = Math.random() * Math.PI * 2
    ctx.fxLocal.confetti({ x: w.pos.x + Math.sin(a) * 1.4, y: w.pos.y + 0.5, z: w.pos.z + Math.cos(a) * 1.4 })
    ctx.fxLocal.puff({ x: w.pos.x, y: w.pos.y + 0.6, z: w.pos.z }, 'spark', 6)
  }
  return w
}

/** Swing the camera slowly round the winner while the ceremony runs. Returns true when it placed the camera. */
export function ceremonyCamera(ctx: LevelCtx, c: Ceremony, cam: CamRig, dt: number) {
  if (!c.on || ctx.phase !== 'end') return false
  const w = ctx.toys[c.who]
  if (!w) return false
  c.angle += dt * 0.35
  let r = 4.8 - Math.min(1.2, c.t * 0.4)
  _w.set(w.pos.x, w.pos.y + 0.35, w.pos.z)
  // Pull in if scenery is in the way (as the chase camera does).
  _v.set(Math.sin(c.angle), 0.5, Math.cos(c.angle)).normalize()
  const hit = ctx.phys.cast(_w, _v, r + 0.3)
  if (hit >= 0) r = Math.max(1.2, hit - 0.35)
  _v.multiplyScalar(r).add(_w)
  // Look a little above the winner so they sit in the lower third, clear of the round card.
  _w.y += 1.25
  cam.place(_v, _w, dt, 3)
  return true
}
