// Match objects built from the downloaded models (ball, stumps and bails that fly) plus the small procedural kit
// (pads, gloves, caps) and the bowler's landing marker.
import * as THREE from 'three'
import { Geo, stumpsZ } from '../sim/geo'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CricketAssets } from '../assets'

/** The photoscanned ball, lifted a touch so it never goes black under lights (its line must stay readable). */
export function makeBall(assets: CricketAssets) {
  const src = assets.ball.material as THREE.MeshStandardMaterial
  const mat = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, roughness: 0.5, metalness: 0, emissive: '#ff3b30', emissiveIntensity: 0.16 })
  if (mat.map) mat.map.anisotropy = 4
  const m = new THREE.Mesh(assets.ball.geometry, mat)
  m.castShadow = true
  return m
}

interface FlyingBail {
  mesh: THREE.Mesh
  home: THREE.Vector3
  vel: THREE.Vector3
  spin: THREE.Vector3
  flying: boolean
}

/** One set of stumps and bails (in view coordinates), from the stump model: three upright stumps, two bails. */
export class Wicket {
  group = new THREE.Group()
  stumps: THREE.Mesh[] = []
  bails: FlyingBail[] = []
  private stumpLean: { mesh: THREE.Mesh; axis: THREE.Vector3; angle: number; target: number }[] = []
  broken = false
  end: number

  constructor(end: number, assets: CricketAssets) {
    this.end = end
    const wood = new THREE.MeshStandardMaterial({ color: '#f3ead7', roughness: 0.5 })
    const z = stumpsZ(end)
    for (let i = -1; i <= 1; i++) {
      const s = new THREE.Mesh(assets.stump, wood)
      s.position.set(i * (Geo.StumpsHalfWidth - Geo.StumpRadius), 0, z)
      s.castShadow = true
      this.group.add(s)
      this.stumps.push(s)
    }
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(assets.bail, wood)
      const home = new THREE.Vector3((i - 0.5) * 0.112, Geo.StumpHeight + 0.0075, z)
      b.position.copy(home)
      b.castShadow = true
      this.group.add(b)
      this.bails.push({ mesh: b, home, vel: new THREE.Vector3(), spin: new THREE.Vector3(), flying: false })
    }
  }

  /** Knocks the bails off (and the stumps back) from an impact at `at` with the ball going `speed` m/s. */
  break(at: THREE.Vector3, speed: number, dirZ: number) {
    this.broken = true
    const k = THREE.MathUtils.clamp(speed / 30, 0.35, 1.2)
    for (const b of this.bails) {
      b.flying = true
      b.vel.set((Math.random() - 0.5) * 4 * k + (b.home.x - at.x) * 6, 3 + Math.random() * 3 * k, dirZ * (3 + Math.random() * 5) * k)
      b.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20)
    }
    this.stumpLean = []
    for (const s of this.stumps) {
      const near = Math.abs(s.position.x - at.x) < 0.09
      if (!near && Math.random() < 0.6) continue
      this.stumpLean.push({ mesh: s, axis: new THREE.Vector3(1, 0, 0), angle: 0, target: dirZ * (near ? 0.5 + k * 0.5 : 0.15) * (0.7 + Math.random() * 0.5) })
    }
  }

  reset() {
    this.broken = false
    for (const b of this.bails) {
      b.flying = false
      b.mesh.position.copy(b.home)
      b.mesh.rotation.set(0, 0, 0)
    }
    for (const s of this.stumps) s.rotation.set(0, 0, 0)
    this.stumpLean = []
  }

  update(dt: number) {
    for (const b of this.bails) {
      if (!b.flying) continue
      b.vel.y -= 9.81 * dt
      b.mesh.position.addScaledVector(b.vel, dt)
      b.mesh.rotation.x += b.spin.x * dt
      b.mesh.rotation.y += b.spin.y * dt
      if (b.mesh.position.y < 0.01) {
        b.mesh.position.y = 0.01
        b.vel.multiplyScalar(0.35)
        b.vel.y = Math.abs(b.vel.y) * 0.3
        b.spin.multiplyScalar(0.5)
        if (b.vel.length() < 0.2) b.flying = false
      }
    }
    for (const l of this.stumpLean) {
      l.angle += (l.target - l.angle) * Math.min(1, dt * 18)
      l.mesh.rotation.x = l.angle
    }
  }
}

/** The bowler's landing marker on the pitch (a ring with a cross). */
export function makeMarker() {
  const g = new THREE.Group()
  // Drawn on top: at the broadcast camera's shallow angle the pitch would otherwise hide it.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.25, 32), new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }))
  ring.rotation.x = -Math.PI / 2
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), new THREE.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }))
  dot.rotation.x = -Math.PI / 2
  ring.renderOrder = dot.renderOrder = 10
  g.add(ring, dot)
  g.position.y = 0.02
  return g
}

/** Pads, gloves and caps, authored in the body's bind pose (model space, metres, facing +Z). */
export const KitGeometry = {
  pad(side: 1 | -1) {
    // A shin pad with knee roll: vertical box with three rolls.
    const parts: THREE.BufferGeometry[] = []
    const body = new THREE.BoxGeometry(0.15, 0.56, 0.06)
    body.translate(0, 0.33, 0.07)
    parts.push(body)
    for (let i = 0; i < 3; i++) {
      const roll = new THREE.CylinderGeometry(0.028, 0.028, 0.5, 6)
      roll.translate((i - 1) * 0.048, 0.33, 0.1)
      parts.push(roll)
    }
    const knee = new THREE.BoxGeometry(0.16, 0.13, 0.09)
    knee.translate(0, 0.63, 0.08)
    parts.push(knee)
    const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!
    g.translate(side * 0.1, 0, 0)
    return g
  },
  glove() {
    const g = new THREE.BoxGeometry(0.075, 0.1, 0.085)
    return g
  },
  cap() {
    const parts: THREE.BufferGeometry[] = []
    const crown = new THREE.SphereGeometry(0.118, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)
    crown.scale(1, 0.85, 1.1)
    parts.push(crown.toNonIndexed())
    const peak = new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12, 1, false, -Math.PI / 2, Math.PI)
    peak.scale(1, 1, 0.85)
    peak.translate(0, 0, 0.1)
    parts.push(peak.toNonIndexed())
    return mergeGeometries(parts)!
  },
  hat() {
    const parts: THREE.BufferGeometry[] = []
    const crown = new THREE.CylinderGeometry(0.1, 0.12, 0.11, 12)
    crown.translate(0, 0.05, 0)
    parts.push(crown.toNonIndexed())
    const brim = new THREE.CylinderGeometry(0.22, 0.22, 0.01, 16)
    parts.push(brim.toNonIndexed())
    return mergeGeometries(parts)!
  },
  keeperGlove() {
    const g = new THREE.BoxGeometry(0.1, 0.13, 0.11)
    return g
  },
}
