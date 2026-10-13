// On-field guides that make a delivery readable: where it will pitch, the timing ring that closes on the batter as
// the ball arrives, the aim wedge for the shot direction, the bowler's length zones and the ball's motion ghosts.
// All drawn on top of the pitch (no depth test) so the broadcast camera's shallow angle never hides them.
import * as THREE from 'three'
import { Geo } from '../sim/geo'

const flat = (color: string, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide })

/** A label drawn on a canvas, shown as a sprite that always faces the camera. */
export function textSprite(text: string, color = '#ffffff', size = 48, bg = 'rgba(8,12,24,0.7)') {
  const c = document.createElement('canvas')
  const x = c.getContext('2d')!
  x.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`
  const w = Math.ceil(x.measureText(text).width) + size
  c.width = w
  c.height = size * 1.7
  x.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`
  x.fillStyle = bg
  const r = size * 0.35
  x.beginPath()
  x.roundRect(0, 0, w, c.height, r)
  x.fill()
  x.fillStyle = color
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText(text, w / 2, c.height / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
  const s = new THREE.Sprite(m)
  s.scale.set((w / c.height) * 0.42, 0.42, 1)
  s.renderOrder = 30
  return s
}

export type ShotColour = 'none' | 'defend' | 'ground' | 'loft'
export const SHOT_COLOURS: Record<ShotColour, string> = { none: '#e2e8f0', defend: '#38bdf8', ground: '#4ade80', loft: '#f472b6' }

export class Guides {
  group = new THREE.Group()
  /** Where the delivery will land (the batter's read of it). */
  pitch = new THREE.Group()
  private pitchRing: THREE.Mesh
  private pitchDisc: THREE.Mesh
  private pitchCross: THREE.Mesh[] = []
  private pitchLabel: THREE.Sprite | null = null
  /** The timing ring: an outer ring that shrinks onto the inner target as the ball arrives. */
  timing = new THREE.Group()
  private timingOuter: THREE.Mesh
  private timingInner: THREE.Mesh
  private timingFill: THREE.Mesh
  /** The aim wedge from the striker in the shot direction. */
  aim = new THREE.Group()
  private aimWedge: THREE.Mesh
  private aimArrow: THREE.Mesh
  /** Length zones for the bowler, with labels. */
  zones = new THREE.Group()
  private zoneLabels: THREE.Sprite[] = []
  /** Fading copies of the ball behind it (a short motion trail). */
  ghosts: THREE.Mesh[] = []
  private ghostMat: THREE.MeshBasicMaterial[] = []
  /** A soft glow around the ball so it reads at distance. */
  glow: THREE.Sprite

  constructor() {
    // Pitch marker: a bright ring with a dot and a cross, scaled like a dinner plate.
    this.pitchRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 40), flat('#67e8f9', 0.95))
    this.pitchDisc = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), flat('#22d3ee', 0.3))
    for (let i = 0; i < 2; i++) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(i === 0 ? 0.9 : 0.05, i === 0 ? 0.05 : 0.9), flat('#cffafe', 0.8))
      this.pitchCross.push(bar)
    }
    for (const m of [this.pitchRing, this.pitchDisc, ...this.pitchCross]) {
      m.rotation.x = -Math.PI / 2
      m.renderOrder = 20
      this.pitch.add(m)
    }
    this.pitch.position.y = 0.025
    this.pitch.visible = false
    this.group.add(this.pitch)

    // Timing ring.
    this.timingInner = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 48), flat('#f8fafc', 0.95))
    this.timingOuter = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64), flat('#fde047', 0.9))
    this.timingFill = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), flat('#4ade80', 0))
    for (const m of [this.timingInner, this.timingOuter, this.timingFill]) {
      m.rotation.x = -Math.PI / 2
      m.renderOrder = 21
      this.timing.add(m)
    }
    this.timing.position.y = 0.03
    this.timing.visible = false
    this.group.add(this.timing)

    // Aim wedge: a 24-degree sector from the striker, with an arrow head. Rotated +90° about X so the geometry's
    // +Y (the sector's centre line) points along the group's +Z, which setAim turns towards the shot.
    const wedge = new THREE.CircleGeometry(7, 24, Math.PI / 2 - 0.21, 0.42)
    this.aimWedge = new THREE.Mesh(wedge, flat(SHOT_COLOURS.none, 0.22))
    const arrow = new THREE.Shape()
    arrow.moveTo(-0.45, 6.0)
    arrow.lineTo(0, 7.4)
    arrow.lineTo(0.45, 6.0)
    arrow.lineTo(0, 6.4)
    this.aimArrow = new THREE.Mesh(new THREE.ShapeGeometry(arrow), flat(SHOT_COLOURS.none, 0.9))
    for (const m of [this.aimWedge, this.aimArrow]) {
      m.rotation.x = Math.PI / 2
      m.renderOrder = 19
      this.aim.add(m)
    }
    this.aim.position.y = 0.028
    this.aim.visible = false
    this.group.add(this.aim)

    this.zones.visible = false
    this.group.add(this.zones)

    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#fff7ed', transparent: true, opacity: 0.35 - i * 0.05, depthWrite: false })
      const m = new THREE.Mesh(new THREE.SphereGeometry(Geo.BallRadius, 10, 8), mat)
      m.visible = false
      m.renderOrder = 3
      this.ghosts.push(m)
      this.ghostMat.push(mat)
      this.group.add(m)
    }

    const c = document.createElement('canvas')
    c.width = c.height = 64
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(32, 32, 4, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.35, 'rgba(255,240,200,0.45)')
    g.addColorStop(1, 'rgba(255,220,160,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(c)
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }))
    this.glow.visible = false
    this.glow.renderOrder = 5
    this.group.add(this.glow)
  }

  /** Shows the landing marker at `pos` with the given opacity (0 hides it) and a size pulse. */
  setPitch(pos: THREE.Vector3 | null, opacity: number, pulse = 1) {
    const show = !!pos && opacity > 0.01
    this.pitch.visible = show
    if (!show || !pos) return
    this.pitch.position.set(pos.x, 0.025, pos.z)
    this.pitch.scale.setScalar(pulse)
    ;(this.pitchRing.material as THREE.MeshBasicMaterial).opacity = 0.95 * opacity
    ;(this.pitchDisc.material as THREE.MeshBasicMaterial).opacity = 0.3 * opacity
    for (const b of this.pitchCross) (b.material as THREE.MeshBasicMaterial).opacity = 0.8 * opacity
    if (this.pitchLabel) this.pitchLabel.material.opacity = opacity
  }

  /** A word under the landing marker ("Good length"), replaced when the text changes. */
  setPitchLabel(text: string | null) {
    const cur = this.pitchLabel?.userData.text
    if (cur === text) return
    if (this.pitchLabel) {
      this.pitch.remove(this.pitchLabel)
      this.pitchLabel.material.map?.dispose()
      this.pitchLabel.material.dispose()
      this.pitchLabel = null
    }
    if (!text) return
    const s = textSprite(text, '#cffafe', 44)
    s.userData.text = text
    s.position.set(0, 0.35, 0)
    s.scale.multiplyScalar(0.75)
    this.pitchLabel = s
    this.pitch.add(s)
  }

  /**
   * The timing ring at the contact point. `closing` is 1 when the ball is far away and 0 when the bat should meet it;
   * `inWindow` colours it green in the perfect window, `late` red once the moment has passed.
   */
  setTiming(pos: THREE.Vector3 | null, closing: number, inWindow: boolean, late: boolean, flash: number) {
    this.timing.visible = !!pos
    if (!pos) return
    this.timing.position.set(pos.x, 0.03, pos.z)
    const s = 1 + Math.max(0, closing) * 3.2
    this.timingOuter.scale.setScalar(s)
    const outer = this.timingOuter.material as THREE.MeshBasicMaterial
    const inner = this.timingInner.material as THREE.MeshBasicMaterial
    const fill = this.timingFill.material as THREE.MeshBasicMaterial
    outer.color.set(late ? '#f87171' : inWindow ? '#4ade80' : '#fde047')
    outer.opacity = late ? 0.5 : 0.9
    inner.color.set(inWindow ? '#4ade80' : '#f8fafc')
    fill.opacity = flash > 0 ? 0.55 * flash : inWindow ? 0.28 : 0
    fill.color.set(flash > 0 ? '#ffffff' : '#4ade80')
  }

  /** The aim wedge from `from`, pointing along the view-space yaw (radians), coloured by the shot type. */
  setAim(from: THREE.Vector3 | null, yaw: number, kind: ShotColour, length: number) {
    this.aim.visible = !!from
    if (!from) return
    this.aim.position.set(from.x, 0.028, from.z)
    this.aim.rotation.y = yaw
    const k = length / 7
    this.aim.scale.set(1, 1, k)
    const col = SHOT_COLOURS[kind]
    ;(this.aimWedge.material as THREE.MeshBasicMaterial).color.set(col)
    ;(this.aimArrow.material as THREE.MeshBasicMaterial).color.set(col)
    ;(this.aimWedge.material as THREE.MeshBasicMaterial).opacity = kind === 'none' ? 0.2 : 0.32
  }

  /**
   * Length zones in front of the striker's stumps, in view coordinates: bands from the stumps towards the bowler
   * (`dirZ` is the direction from the striker's stumps to the bowler's end), each labelled beside the pitch.
   */
  buildZones(stumpsZ: number, dirZ: number, labelSide: number) {
    for (const c of [...this.zones.children]) {
      this.zones.remove(c)
      const m = c as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | undefined
      if (mat && 'map' in mat) (mat as THREE.SpriteMaterial).map?.dispose()
      mat?.dispose()
    }
    this.zoneLabels = []
    const bands: { name: string; from: number; to: number; color: string }[] = [
      { name: 'YORKER', from: 0, to: 2.2, color: '#f97316' },
      { name: 'FULL', from: 2.2, to: 4.6, color: '#facc15' },
      { name: 'GOOD', from: 4.6, to: 7.4, color: '#4ade80' },
      { name: 'SHORT', from: 7.4, to: 12.5, color: '#38bdf8' },
    ]
    const w = Geo.PitchWidth - 0.3
    for (const b of bands) {
      const len = b.to - b.from
      const g = new THREE.PlaneGeometry(w, len)
      const m = new THREE.Mesh(g, flat(b.color, 0.16))
      m.rotation.x = -Math.PI / 2
      m.position.set(0, 0.02, stumpsZ + dirZ * (b.from + len / 2))
      m.renderOrder = 15
      this.zones.add(m)
      const line = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.04), flat(b.color, 0.65))
      line.rotation.x = -Math.PI / 2
      line.position.set(0, 0.021, stumpsZ + dirZ * b.to)
      line.renderOrder = 16
      this.zones.add(line)
      const label = textSprite(b.name, b.color, 40)
      label.position.set(labelSide * (w / 2 + 0.55), 0.3, stumpsZ + dirZ * (b.from + len / 2))
      label.scale.multiplyScalar(0.8)
      this.zoneLabels.push(label)
      this.zones.add(label)
    }
  }

  setZonesVisible(v: boolean) {
    this.zones.visible = v
  }

  /** Ghosts along the recent ball positions (newest first). */
  setGhosts(points: THREE.Vector3[], scale: number) {
    for (let i = 0; i < this.ghosts.length; i++) {
      const p = points[i]
      const g = this.ghosts[i]
      g.visible = !!p
      if (!p) continue
      g.position.copy(p)
      g.scale.setScalar(scale * (1 - i * 0.12))
    }
  }

  setGlow(pos: THREE.Vector3 | null, size: number) {
    this.glow.visible = !!pos
    if (!pos) return
    this.glow.position.copy(pos)
    this.glow.scale.set(size, size, 1)
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | undefined
      if (mat && 'map' in mat) (mat as THREE.SpriteMaterial).map?.dispose()
      mat?.dispose()
    })
  }
}

/** Plain words for a landing spot: the length (from the batter's stumps, m) and the line (off-side offset, m). */
export function lengthWords(length: number, off: number) {
  const len = length < 0 ? 'Full toss' : length < 1.4 ? 'Yorker' : length < 2.2 ? 'Very full' : length < 4.6 ? 'Full' : length < 7.4 ? 'Good length' : length < 9.5 ? 'Back of a length' : 'Short'
  const line = off > 0.75 ? 'wide outside off' : off > 0.3 ? 'outside off' : off > 0.12 ? 'on off stump' : off > -0.12 ? 'on the stumps' : off > -0.3 ? 'on leg stump' : 'down the leg side'
  return { length: len, line, text: `${len}, ${line}` }
}
