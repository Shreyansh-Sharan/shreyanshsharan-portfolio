// Ball-tracking graphics for LBW reviews: the delivery's path drawn in, then the projected path on to the stumps,
// with the pitching strip, the impact point and the wicket zone coloured by the verdict.
import * as THREE from 'three'
import type { Director } from '../sim/director'
import { Geo, stumpsZ } from '../sim/geo'
import { toView } from './coords'

const COL = { good: '#22c55e', bad: '#ef4444', call: '#f59e0b' }

export class Hawkeye {
  group = new THREE.Group()
  private real: THREE.Mesh | null = null
  private proj: THREE.Mesh | null = null
  private realCount = 0
  private projCount = 0
  private zone: THREE.Mesh | null = null
  private wicketBox: THREE.Mesh | null = null
  private impact: THREE.Mesh | null = null
  private pitchDot: THREE.Mesh | null = null
  /** Driven by the DRS review (update) or by a replay's tracking shot (tick). */
  private mode: 'review' | 'replay' = 'review'

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c)
      const m = c as THREE.Mesh
      m.geometry?.dispose()
      ;(m.material as THREE.Material | undefined)?.dispose()
    }
    this.real = this.proj = this.zone = this.wicketBox = this.impact = this.pitchDot = null
    this.group.visible = false
  }

  begin(d: Director) {
    this.clear()
    this.mode = 'review'
    const r = d.review
    if (r.kind !== 'lbw' || !r.track || r.path.length < 3) return
    const pts = r.path.map((p) => toView(p))
    const realPts = pts.slice(0, Math.max(2, r.impactIndex + 1))
    const projPts = pts.slice(Math.max(0, r.impactIndex))
    const tube = (list: THREE.Vector3[], color: string, opacity: number) => {
      const curve = new THREE.CatmullRomCurve3(list)
      const g = new THREE.TubeGeometry(curve, Math.max(8, list.length * 2), Geo.BallRadius, 10, false)
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
      m.renderOrder = 4
      return m
    }
    this.real = tube(realPts, '#e11d48', 0.9)
    this.realCount = this.real.geometry.index!.count
    this.real.geometry.setDrawRange(0, 0)
    this.group.add(this.real)
    if (projPts.length > 1) {
      this.proj = tube(projPts, '#38bdf8', 0.75)
      this.projCount = this.proj.geometry.index!.count
      this.proj.geometry.setDrawRange(0, 0)
      this.group.add(this.proj)
    }
    const t = r.track
    const se = d.state.current.strikerEnd
    // The strip between the two sets of stumps (where the ball must pitch, unless outside off is allowed).
    const zg = new THREE.PlaneGeometry(Geo.StumpsHalfWidth * 2 + Geo.BallRadius * 2, Geo.PitchLength)
    zg.rotateX(-Math.PI / 2)
    const zoneColor = t.pitching === 'inline' || t.pitching === 'na' ? COL.good : t.pitching === 'outsideoff' ? COL.call : COL.bad
    this.zone = new THREE.Mesh(zg, new THREE.MeshBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.28, depthWrite: false }))
    this.zone.position.set(0, 0.03, 0)
    this.group.add(this.zone)
    if (!t.fullToss) {
      this.pitchDot = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), new THREE.MeshBasicMaterial({ color: zoneColor, depthWrite: false }))
      this.pitchDot.rotation.x = -Math.PI / 2
      this.pitchDot.position.copy(toView(t.pitched)).setY(0.035)
      this.pitchDot.visible = false
      this.group.add(this.pitchDot)
    }
    const impColor = t.impactZone === 'inline' ? COL.good : t.impactZone === 'umpirescall' ? COL.call : COL.bad
    this.impact = new THREE.Mesh(new THREE.SphereGeometry(Geo.BallRadius * 1.6, 12, 8), new THREE.MeshBasicMaterial({ color: impColor }))
    this.impact.position.copy(toView(t.impact))
    this.impact.visible = false
    this.group.add(this.impact)
    const wkColor = t.wickets === 'hitting' ? COL.bad : t.wickets === 'umpirescall' ? COL.call : COL.good
    const wg = new THREE.BoxGeometry(Geo.StumpsHalfWidth * 2, Geo.StumpHeight, 0.06)
    this.wicketBox = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: wkColor, transparent: true, opacity: 0.35, depthWrite: false }))
    this.wicketBox.position.set(0, Geo.StumpHeight / 2, stumpsZ(se))
    this.wicketBox.visible = false
    this.group.add(this.wicketBox)
    this.group.visible = true
  }

  /**
   * A replay's ball-tracking freeze: the real path up to `impactIndex` (red), the projection after it (blue), the
   * pitching point, the impact and the wicket zone coloured by the verdict. View coordinates.
   */
  showPath(pts: THREE.Vector3[], impactIndex: number, o: { pitched: THREE.Vector3 | null; strikerZ: number; pitching: string; impact: string | null; wickets: string }) {
    this.clear()
    this.mode = 'replay'
    if (pts.length < 3) return
    const tube = (list: THREE.Vector3[], color: string, opacity: number) => {
      const curve = new THREE.CatmullRomCurve3(list)
      const g = new THREE.TubeGeometry(curve, Math.max(8, list.length * 2), Geo.BallRadius * 1.15, 10, false)
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
      m.renderOrder = 4
      return m
    }
    const real = pts.slice(0, impactIndex + 1)
    const proj = pts.slice(impactIndex)
    this.real = tube(real, '#e11d48', 0.92)
    this.realCount = this.real.geometry.index!.count
    this.real.geometry.setDrawRange(0, 0)
    this.group.add(this.real)
    if (proj.length > 2) {
      this.proj = tube(proj, '#38bdf8', 0.8)
      this.projCount = this.proj.geometry.index!.count
      this.proj.geometry.setDrawRange(0, 0)
      this.group.add(this.proj)
    }
    const zoneColor = o.pitching === 'inline' || o.pitching === 'na' ? COL.good : o.pitching === 'outsideoff' ? COL.call : COL.bad
    const zg = new THREE.PlaneGeometry(Geo.StumpsHalfWidth * 2 + Geo.BallRadius * 2, Geo.PitchLength)
    zg.rotateX(-Math.PI / 2)
    this.zone = new THREE.Mesh(zg, new THREE.MeshBasicMaterial({ color: zoneColor, transparent: true, opacity: 0.26, depthWrite: false }))
    this.zone.position.set(0, 0.03, 0)
    this.group.add(this.zone)
    if (o.pitched) {
      this.pitchDot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: zoneColor, depthWrite: false }))
      this.pitchDot.rotation.x = -Math.PI / 2
      this.pitchDot.position.copy(o.pitched).setY(0.035)
      this.pitchDot.visible = false
      this.group.add(this.pitchDot)
    }
    if (o.impact) {
      const impColor = o.impact === 'inline' ? COL.good : o.impact === 'umpirescall' ? COL.call : COL.bad
      this.impact = new THREE.Mesh(new THREE.SphereGeometry(Geo.BallRadius * 1.7, 12, 8), new THREE.MeshBasicMaterial({ color: impColor }))
      this.impact.position.copy(pts[impactIndex])
      this.impact.visible = false
      this.group.add(this.impact)
    }
    const wkColor = o.wickets === 'hitting' ? COL.bad : o.wickets === 'umpirescall' ? COL.call : COL.good
    const wg = new THREE.BoxGeometry(Geo.StumpsHalfWidth * 2, Geo.StumpHeight, 0.06)
    this.wicketBox = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: wkColor, transparent: true, opacity: 0.38, depthWrite: false }))
    this.wicketBox.position.set(0, Geo.StumpHeight / 2, o.strikerZ)
    this.wicketBox.visible = false
    this.group.add(this.wicketBox)
    this.group.visible = true
  }

  /** Draws a replay's tracking in over time (seconds since the freeze began). */
  tick(t: number) {
    if (!this.group.visible || this.mode !== 'replay') return
    this.draw(t)
  }

  private draw(t: number) {
    const k1 = Math.min(1, t / 1.6)
    if (this.real) this.real.geometry.setDrawRange(0, Math.floor((this.realCount * k1) / 3) * 3)
    if (this.pitchDot) this.pitchDot.visible = t > 0.6
    if (this.impact) this.impact.visible = t > 1.6
    const k2 = Math.min(1, Math.max(0, (t - 2.2) / 1.6))
    if (this.proj) this.proj.geometry.setDrawRange(0, Math.floor((this.projCount * k2) / 3) * 3)
    if (this.wicketBox) this.wicketBox.visible = t > (this.proj ? 3.8 : 1.8)
  }

  update(d: Director, _dt: number) {
    if (!this.group.visible || this.mode !== 'review') return
    if (d.phase !== 'review') {
      if (d.phase !== 'dead') this.clear()
      return
    }
    this.draw(d.review.time)
  }
}
