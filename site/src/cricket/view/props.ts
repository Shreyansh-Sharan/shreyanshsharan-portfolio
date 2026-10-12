// Simple procedural kit and match objects: bat, ball, stumps with bails that fly, the bowler's landing marker.
import * as THREE from 'three'
import { Geo, stumpsZ } from '../sim/geo'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Bat: grip point at the origin, blade running down local -Y, face towards +Z. */
export function makeBat(gripColor = '#1f2937') {
  const g = new THREE.Group()
  const willow = new THREE.MeshStandardMaterial({ color: '#e8d3a2', roughness: 0.55 })
  const grip = new THREE.MeshStandardMaterial({ color: gripColor, roughness: 0.8 })
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.3, 8), grip)
  handle.position.y = 0.04
  // Blade: slightly tapered with a rounded back.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.56, 0.04), willow)
  blade.position.y = -0.39
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.46, 8, 1, false, Math.PI, Math.PI), willow)
  spine.rotation.y = Math.PI
  spine.scale.set(1.2, 1, 0.9)
  spine.position.set(0, -0.37, -0.016)
  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.035), willow)
  shoulder.position.y = -0.11
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.16), new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.6 }))
  sticker.position.set(0, -0.3, 0.0205)
  g.add(handle, blade, spine, shoulder, sticker)
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true))
  return g
}

export function makeBall() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 32
  const x = c.getContext('2d')!
  x.fillStyle = '#f7f7f2'
  x.fillRect(0, 0, 64, 32)
  x.fillStyle = '#9ca3af'
  x.fillRect(0, 15, 64, 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.SphereGeometry(Geo.BallRadius * 1.15, 16, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, emissive: '#ffffff', emissiveIntensity: 0.12 }))
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

/** One set of stumps and bails (in view coordinates). */
export class Wicket {
  group = new THREE.Group()
  stumps: THREE.Mesh[] = []
  bails: FlyingBail[] = []
  private stumpLean: { mesh: THREE.Mesh; axis: THREE.Vector3; angle: number; target: number }[] = []
  broken = false
  end: number

  constructor(end: number) {
    this.end = end
    const wood = new THREE.MeshStandardMaterial({ color: '#f3ead7', roughness: 0.5 })
    const z = stumpsZ(end)
    for (let i = -1; i <= 1; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(Geo.StumpRadius, Geo.StumpRadius * 0.85, Geo.StumpHeight, 10), wood)
      s.geometry.translate(0, Geo.StumpHeight / 2, 0)
      s.position.set(i * (Geo.StumpsHalfWidth - Geo.StumpRadius), 0, z)
      s.castShadow = true
      this.group.add(s)
      this.stumps.push(s)
    }
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6), wood)
      b.rotation.z = Math.PI / 2
      const home = new THREE.Vector3((i - 0.5) * 0.11, Geo.StumpHeight + 0.008, z)
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
      b.mesh.rotation.set(0, 0, Math.PI / 2)
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

/** Pads, gloves, helmet and caps, authored in the body's bind pose (model space, metres, facing +Z). */
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
  helmet() {
    const parts: THREE.BufferGeometry[] = []
    const shell = new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)
    shell.scale(1, 1.02, 1.12)
    parts.push(shell.toNonIndexed())
    const peak = new THREE.BoxGeometry(0.2, 0.012, 0.07)
    peak.translate(0, 0.005, 0.15)
    parts.push(peak.toNonIndexed())
    return mergeGeometries(parts)!
  },
  grille() {
    const parts: THREE.BufferGeometry[] = []
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.TorusGeometry(0.13, 0.004, 4, 16, Math.PI)
      bar.rotateZ(Math.PI)
      bar.scale(1, 0.9, 1.25)
      bar.translate(0, -0.03 - i * 0.035, 0)
      parts.push(bar.toNonIndexed())
    }
    const v = new THREE.BoxGeometry(0.006, 0.11, 0.006)
    v.translate(0, -0.07, 0.16)
    parts.push(v.toNonIndexed())
    return mergeGeometries(parts)!
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
