// The parts of a house that never break, drawn once per household in its local frame: the pitched roof (gable, hip
// or cross gable) with shingles, ridge and hip caps, fascia, soffits, gutters and downspouts; the gable walls and
// their vents; the garage's gable roof; corner boards, the foundation plinth, the belly band between storeys and
// the frieze under the eaves; the upstairs and garage ceilings; porch, coach and interior lamps; and a soft contact
// shadow skirt where the walls meet the ground.
import * as THREE from 'three'
import { CROSS_HW, DOORWAY, EAVE_OH, EAVE_Y, FLOOR_H, GARAGE, HX, HZ, MAIN_HX, MAIN_HZ, PITCH, PORCH, RAKE_OH, ROOMS, WALL_H, type HouseStyle, type RoomId } from '../engine/houses'
import { Kit, polygon } from './kit'
import { M, cached, paint } from './housemats'
import { ramp } from './surfaces'

export interface ShellTheme {
  siding: string
  trim: string
  roof: string
  door: string
}

export interface ShellOptions {
  style: HouseStyle
  theme: ShellTheme
  snow: boolean
  shadows: boolean
  /** World origin and facing of the household. */
  ox: number
  oz: number
  dir: number
  /** Interior lamps to light (0..6), their brightness, and whether the porch and coach lamps are lit. */
  lamps: number
  lampScale: number
  outdoorLamps: boolean
}

const TH = 0.16
const K = Math.sqrt(1 + PITCH * PITCH)
const LAMP = '#ffc98a'

export function buildShell(o: ShellOptions) {
  const group = new THREE.Group()
  group.position.set(o.ox, 0, o.oz)
  group.rotation.y = o.dir > 0 ? 0 : Math.PI
  const lights: THREE.PointLight[] = []
  const origin = new THREE.Vector3(o.ox, 0, o.oz)
  // Two kits: the base (plinth, belly band, ground-storey trims, lamps below) and the roof group (roof, gables,
  // upper-storey trims, ceilings), which the lobby hides for its cutaway.
  const baseKit = new Kit(new THREE.Matrix4(), origin, o.shadows)
  const roofKit = new Kit(new THREE.Matrix4(), origin, o.shadows)
  let kit = roofKit
  const style = o.style
  const trim = M.trim(o.theme.trim)
  const soffit = M.beadboard(o.theme.trim)
  const siding = M.siding(o.theme.siding)
  const top = o.snow ? M.snow() : M.shingles(o.theme.roof)
  const cap = o.snow ? M.snow() : M.shingles(shade(o.theme.roof, 0.8))
  const gutter = M.trim(o.theme.trim)
  const concrete = M.concrete()
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  /** A flat polygon facing roughly `want`, with planar world UVs. */
  const face = (pts: THREE.Vector3[], want: THREE.Vector3, mat: THREE.Material, uvs?: [number, number][]) => {
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(pts[1], pts[0]), new THREE.Vector3().subVectors(pts[2], pts[0]))
    const flip = n.dot(want) < 0
    const p = flip ? [...pts].reverse() : pts
    const u = uvs && flip ? [...uvs].reverse() : uvs
    kit.geo(polygon(p, u), mat, !!u)
  }
  /** A roof plane over a plan polygon (x, z), with its height function and shingle UVs (u along the eave). */
  const plane = (plan: [number, number][], y: (x: number, z: number) => number, uv: (x: number, z: number) => [number, number], down = 0) => {
    const contour = plan.map(([x, z]) => new THREE.Vector2(x, z))
    const tris = THREE.ShapeUtils.triangulateShape(contour, [])
    const pos: number[] = []
    const uvs: number[] = []
    for (const t of tris)
      for (const k of t) {
        const [x, z] = plan[k]
        pos.push(x, y(x, z) - down, z)
        const [u, v] = uv(x, z)
        uvs.push(u, v)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.computeVertexNormals()
    // Every triangle faces up for the roof surface, down for its underside.
    const n = g.attributes.normal
    const p = g.attributes.position
    const wantUp = down === 0
    for (let i = 0; i < p.count; i += 3) {
      if ((n.getY(i) > 0) !== wantUp) {
        // Swap two vertices of this triangle.
        for (const attr of [p, g.attributes.uv]) {
          const s = attr.itemSize
          for (let k = 0; k < s; k++) {
            const a = attr.getComponent(i + 1, k)
            attr.setComponent(i + 1, k, attr.getComponent(i + 2, k))
            attr.setComponent(i + 2, k, a)
          }
        }
      }
    }
    g.computeVertexNormals()
    return g
  }
  const slope = (plan: [number, number][], y: (x: number, z: number) => number, uv: (x: number, z: number) => [number, number]) => {
    kit.geo(plane(plan, y, uv), top, true)
    kit.geo(plane(plan, y, uv, TH), soffit, false)
  }
  /** A board laid along a line (rake boards, ridge and hip caps): `n` is its broad face's normal, `t` its thickness along n. */
  const beam = (a: THREE.Vector3, b: THREE.Vector3, n: THREE.Vector3, t: number, h: number, mat: THREE.Material, drop = 0) => {
    const d = new THREE.Vector3().subVectors(b, a)
    const len = d.length()
    d.normalize()
    const xA = n.clone().addScaledVector(d, -n.dot(d)).normalize()
    const yA = new THREE.Vector3().crossVectors(d, xA)
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, d))
    const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).addScaledVector(yA.y >= 0 ? yA : yA.negate(), -drop)
    kit.orientedBox(c.x, c.y, c.z, t, h, len, q, mat)
  }
  /** Fascia, gutter and soffit return along an eave running from a to b (at the eave height), facing `out`. */
  const eave = (x0: number, x1: number, z: number, outward: 1 | -1, alongX: boolean) => {
    const yE = EAVE_Y
    const box = (a0: number, a1: number, y0: number, y1: number, b0: number, b1: number, m: THREE.Material) =>
      alongX ? kit.box(a0, a1, y0, y1, Math.min(b0, b1), Math.max(b0, b1), m) : kit.box(Math.min(b0, b1), Math.max(b0, b1), y0, y1, a0, a1, m)
    box(x0, x1, yE - 0.24, yE + 0.02, z, z + outward * 0.045, trim)
    box(x0 + 0.02, x1 - 0.02, yE - 0.22, yE - 0.09, z + outward * 0.045, z + outward * 0.17, gutter)
  }
  const frieze = (a0: number, a1: number, b: number, outward: 1 | -1, alongX: boolean, y1 = EAVE_Y - 0.22) => {
    if (alongX) kit.box(a0, a1, y1 - 0.18, y1, Math.min(b, b + outward * 0.035), Math.max(b, b + outward * 0.035), trim)
    else kit.box(Math.min(b, b + outward * 0.035), Math.max(b, b + outward * 0.035), y1 - 0.18, y1, a0, a1, trim)
  }
  const downspout = (x: number, z: number, outZ: number, yTop: number) => {
    kit.box(x - 0.045, x + 0.045, 0.06, yTop, z - 0.045, z + 0.045, gutter)
    kit.box(x - 0.045, x + 0.045, yTop - 0.09, yTop, Math.min(z, outZ), Math.max(z, outZ), gutter)
    const kz = z + 0.2 * Math.sign(outZ - z || 1)
    kit.box(x - 0.07, x + 0.07, 0.02, 0.06, Math.min(z, kz) - 0.04, Math.max(z, kz) + 0.04, concrete)
  }
  /** A louvred gable vent centred at (x, y) on the plane z = zf (facing +z) or x = xf (facing +x). */
  const vent = (cx: number, cy: number, at: number, axis: 'x' | 'z', sign: 1 | -1, w = 0.55, h = 0.7) => {
    const put = (a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, m: THREE.Material = trim) => {
      const z0 = at + sign * d0
      const z1 = at + sign * d1
      if (axis === 'z') kit.box(cx + a0, cx + a1, y0, y1, Math.min(z0, z1), Math.max(z0, z1), m)
      else kit.box(Math.min(z0, z1), Math.max(z0, z1), y0, y1, cx + a0, cx + a1, m)
    }
    put(-w / 2 - 0.07, w / 2 + 0.07, cy - h / 2 - 0.07, cy - h / 2, 0, 0.04)
    put(-w / 2 - 0.07, w / 2 + 0.07, cy + h / 2, cy + h / 2 + 0.07, 0, 0.04)
    put(-w / 2 - 0.07, -w / 2, cy - h / 2, cy + h / 2, 0, 0.04)
    put(w / 2, w / 2 + 0.07, cy - h / 2, cy + h / 2, 0, 0.04)
    for (let yy = cy - h / 2 + 0.06; yy < cy + h / 2 - 0.02; yy += 0.09) put(-w / 2, w / 2, yy, yy + 0.04, 0.005, 0.03)
    // Dark void behind the slats.
    put(-w / 2, w / 2, cy - h / 2, cy + h / 2, -0.01, 0.002, M.concrete('#2b2a28'))
  }

  /* ---------- main roof ---------- */
  const EZ = MAIN_HZ + EAVE_OH
  const yE = EAVE_Y
  const yR = EAVE_Y + PITCH * EZ
  if (style.roof === 'hip') {
    const EX = MAIN_HX + EAVE_OH
    const r = EX - EZ
    const h = (x: number, z: number) => yE + PITCH * Math.min(EX - Math.abs(x), EZ - Math.abs(z))
    slope([[-EX, EZ], [EX, EZ], [r, 0], [-r, 0]], h, (x, z) => [x, (EZ - z) * K])
    slope([[EX, -EZ], [-EX, -EZ], [-r, 0], [r, 0]], h, (x, z) => [-x, (EZ + z) * K])
    slope([[EX, EZ], [r, 0], [EX, -EZ]], h, (x, z) => [-z, (EX - x) * K])
    slope([[-EX, -EZ], [-r, 0], [-EX, EZ]], h, (x, z) => [z, (EX + x) * K])
    for (const s of [1, -1] as const) {
      eave(-EX, EX, s * EZ, s, true)
      eave(-EZ, EZ, s * EX, s, false)
      kit.box(-EX, EX, yE - 0.24, yE - 0.22, Math.min(s * MAIN_HZ, s * EZ), Math.max(s * MAIN_HZ, s * EZ), soffit)
      kit.box(Math.min(s * MAIN_HX, s * EX), Math.max(s * MAIN_HX, s * EX), yE - 0.24, yE - 0.22, -MAIN_HZ, MAIN_HZ, soffit)
      frieze(-MAIN_HX, MAIN_HX, s * MAIN_HZ, s, true)
      frieze(-MAIN_HZ, MAIN_HZ, s * MAIN_HX, s, false)
    }
    beam(V(-r, yR + 0.03, 0), V(r, yR + 0.03, 0), V(0, 1, 0), 0.1, 0.26, cap)
    for (const sx of [1, -1]) for (const sz of [1, -1]) beam(V(sx * EX, yE + 0.03, sz * EZ), V(sx * r, yR + 0.03, 0), V(0, 1, 0), 0.09, 0.22, cap)
  } else {
    const EX = MAIN_HX + RAKE_OH
    const h = (_x: number, z: number) => yE + PITCH * (EZ - Math.abs(z))
    const cross = style.roof === 'cross'
    const CW = CROSS_HW
    const ZV = EZ - CW
    // Front slope (notched around the cross gable), back slope.
    slope(cross ? [[-EX, EZ], [-CW, EZ], [0, ZV], [CW, EZ], [EX, EZ], [EX, 0], [-EX, 0]] : [[-EX, EZ], [EX, EZ], [EX, 0], [-EX, 0]], h, (x, z) => [x, (EZ - z) * K])
    slope([[EX, -EZ], [-EX, -EZ], [-EX, 0], [EX, 0]], h, (x, z) => [-x, (EZ + z) * K])
    // Front eave (split by the cross gable), back eave, soffits and friezes.
    const PX = PORCH.x1
    if (cross) {
      for (const s of [-1, 1]) {
        const a = s < 0 ? -EX : CW
        const b = s < 0 ? -CW : EX
        eave(a, b, EZ, 1, true)
        kit.box(a, b, yE - 0.24, yE - 0.22, MAIN_HZ, EZ, soffit)
        frieze(s < 0 ? -MAIN_HX : PX, s < 0 ? -PX : MAIN_HX, MAIN_HZ, 1, true)
      }
    } else {
      eave(-EX, EX, EZ, 1, true)
      kit.box(-EX, EX, yE - 0.24, yE - 0.22, MAIN_HZ, EZ, soffit)
      frieze(-MAIN_HX, MAIN_HX, MAIN_HZ, 1, true)
    }
    eave(-EX, EX, -EZ, -1, true)
    kit.box(-EX, EX, yE - 0.24, yE - 0.22, -EZ, -MAIN_HZ, soffit)
    frieze(-MAIN_HX, MAIN_HX, -MAIN_HZ, -1, true)
    // Gable walls, rake boards and vents at both ends.
    for (const s of [1, -1] as const) {
      const x = s * MAIN_HX
      const u = (z: number) => h(0, z) - TH - 0.02
      face([V(x, 5.9, -MAIN_HZ), V(x, 5.9, MAIN_HZ), V(x, u(MAIN_HZ), MAIN_HZ), V(x, u(0), 0), V(x, u(MAIN_HZ), -MAIN_HZ)], V(s, 0, 0), siding)
      frieze(-MAIN_HZ, MAIN_HZ, x, s, false)
      for (const sz of [1, -1]) beam(V(s * (EX - 0.03), yE, sz * (EZ + 0.04)), V(s * (EX - 0.03), yR, 0), V(1, 0, 0), 0.06, 0.26, trim, 0.09)
      vent(0, yR - 1.45, x, 'x', s)
    }
    beam(V(-EX - 0.02, yR + 0.03, 0), V(EX + 0.02, yR + 0.03, 0), V(0, 1, 0), 0.1, 0.28, cap)
    if (cross) {
      const yC = yE + PITCH * CW
      const hc = (x: number) => yE + PITCH * (CW - Math.abs(x))
      kit.geo(plane([[0, ZV], [CW, EZ], [0, EZ]], (x) => hc(x), (x, z) => [z, (CW - x) * K]), top, true)
      kit.geo(plane([[0, ZV], [CW, EZ], [0, EZ]], (x) => hc(x), (x, z) => [z, (CW - x) * K], TH), soffit)
      kit.geo(plane([[0, ZV], [0, EZ], [-CW, EZ]], (x) => hc(x), (x, z) => [-z, (CW + x) * K]), top, true)
      kit.geo(plane([[0, ZV], [0, EZ], [-CW, EZ]], (x) => hc(x), (x, z) => [-z, (CW + x) * K], TH), soffit)
      beam(V(0, yC + 0.03, EZ + 0.03), V(0, yC + 0.03, ZV + 0.2), V(0, 1, 0), 0.1, 0.24, cap)
      for (const sx of [1, -1]) beam(V(sx * (CW + 0.02), yE, EZ + 0.03), V(0, yC, EZ + 0.03), V(0, 0, 1), 0.06, 0.26, trim, 0.09)
      // The gable face over the balcony, with a round window.
      const uc = (x: number) => hc(x) - TH - 0.02
      face([V(-PX, 5.9, MAIN_HZ), V(PX, 5.9, MAIN_HZ), V(PX, uc(PX), MAIN_HZ), V(0, uc(0), MAIN_HZ), V(-PX, uc(PX), MAIN_HZ)], V(0, 0, 1), siding)
      const oy = yE + 0.55
      const ring = new THREE.TorusGeometry(0.34, 0.06, 8, 24)
      ring.translate(0, oy, MAIN_HZ + 0.04)
      kit.geo(ring, trim)
      const glassDisc = new THREE.CircleGeometry(0.33, 24)
      glassDisc.translate(0, oy, MAIN_HZ + 0.02)
      kit.geo(glassDisc, M.glass(0))
      kit.box(-0.33, 0.33, oy - 0.02, oy + 0.02, MAIN_HZ + 0.01, MAIN_HZ + 0.05, trim)
      kit.box(-0.02, 0.02, oy - 0.33, oy + 0.33, MAIN_HZ + 0.01, MAIN_HZ + 0.05, trim)
    }
  }

  /* ---------- garage roof ---------- */
  {
    const g = GARAGE
    const hw = g.x1 + g.oh - g.ridgeX
    const gE = g.eaveY
    const gR = gE + PITCH * hw
    const Zf = g.z1 + 0.3
    const Zb = g.z0 - 0.3
    const XR = g.x1 + g.oh
    const h = (x: number) => gE + PITCH * (hw - Math.abs(x - g.ridgeX))
    slope([[XR, Zf], [XR, Zb], [g.ridgeX, Zb], [g.ridgeX, Zf]], (x) => h(x), (x, z) => [-z, (XR - x) * K])
    slope([[g.x0, Zb], [g.x0, Zf], [g.ridgeX, Zf], [g.ridgeX, Zb]], (x) => h(x), (x, z) => [z, (x - g.x0 + 0.4) * K])
    // Eave on the far side, rake boards front and back, flashing against the house wall.
    kit.box(XR, XR + 0.045, gE - 0.24, gE + 0.02, Zb, Zf, trim)
    kit.box(XR + 0.045, XR + 0.17, gE - 0.22, gE - 0.09, Zb + 0.02, Zf - 0.02, gutter)
    kit.box(g.x1, XR, gE - 0.24, gE - 0.22, g.z0, g.z1, soffit)
    frieze(g.z0, g.z1, g.x1, 1, false, gE - 0.22)
    for (const z of [Zf + 0.03, Zb - 0.03]) {
      beam(V(XR + 0.02, gE, z), V(g.ridgeX, gR, z), V(0, 0, 1), 0.06, 0.24, trim, 0.08)
      beam(V(g.x0, h(g.x0), z), V(g.ridgeX, gR, z), V(0, 0, 1), 0.06, 0.24, trim, 0.08)
    }
    kit.box(g.x0, g.x0 + 0.05, h(g.x0) - 0.05, h(g.x0) + 0.12, Zb, Zf, trim)
    beam(V(g.ridgeX, gR + 0.03, Zb - 0.02), V(g.ridgeX, gR + 0.03, Zf + 0.02), V(0, 1, 0), 0.1, 0.26, cap)
    // Gable walls over the garage door and at the back.
    const u = (x: number) => h(x) - TH - 0.02
    for (const [z, s] of [[g.z1, 1], [g.z0, -1]] as const) {
      face([V(g.x0, WALL_H - 0.1, z), V(g.x1, WALL_H - 0.1, z), V(g.x1, u(g.x1), z), V(g.ridgeX, u(g.ridgeX), z), V(g.x0, u(g.x0), z)], V(0, 0, s), siding)
      vent(g.ridgeX, gR - 0.75, z, 'z', s, 0.45, 0.42)
    }
    downspout(g.x1 + 0.06, g.z1 - 0.12, g.z1 + 0.1, gE - 0.12)
    downspout(g.x1 + 0.06, g.z0 + 0.12, g.z0 - 0.1, gE - 0.12)
  }

  /* ---------- trim: corner boards, plinth, belly band, downspouts ---------- */
  const brick = style.brick
  const corner = (x: number, z: number, y0: number, y1: number) => {
    if (y0 < FLOOR_H && y1 > FLOOR_H) {
      corner(x, z, y0, FLOOR_H)
      corner(x, z, FLOOR_H, y1)
      return
    }
    kit = y0 < FLOOR_H - 0.01 ? baseKit : roofKit
    const sx = Math.sign(x)
    const sz = Math.sign(z)
    const ax = Math.abs(x)
    const az = Math.abs(z)
    kit.box(Math.min(sx * (ax - 0.16), sx * (ax + 0.04)), Math.max(sx * (ax - 0.16), sx * (ax + 0.04)), y0, y1, Math.min(sz * (az - 0.16), sz * (az + 0.04)), Math.max(sz * (az - 0.16), sz * (az + 0.04)), trim)
  }
  const pier = (x: number, z: number, y1: number) => {
    kit = baseKit
    const sx = Math.sign(x)
    const sz = Math.sign(z)
    const ax = Math.abs(x)
    const az = Math.abs(z)
    kit.box(Math.min(sx * (ax - 0.16), sx * (ax + 0.005)), Math.max(sx * (ax - 0.16), sx * (ax + 0.005)), 0, y1, Math.min(sz * (az - 0.16), sz * (az + 0.005)), Math.max(sz * (az - 0.16), sz * (az + 0.005)), M.brick())
  }
  const topY = EAVE_Y - 0.4
  for (const [x, z, ground] of [[-MAIN_HX, MAIN_HZ, true], [MAIN_HX, MAIN_HZ, true], [-MAIN_HX, -MAIN_HZ, true], [MAIN_HX, -MAIN_HZ, false]] as const) {
    if (!ground) corner(x, z, GARAGE.eaveY + 0.35, topY)
    else if (brick) {
      pier(x, z, FLOOR_H - 0.2)
      corner(x, z, FLOOR_H - 0.2, topY)
    } else corner(x, z, 0.3, topY)
  }
  for (const z of [GARAGE.z1, GARAGE.z0]) {
    if (brick) pier(GARAGE.x1, z, WALL_H - 0.2)
    else corner(GARAGE.x1, z, 0.3, GARAGE.eaveY - 0.42)
  }
  kit = baseKit
  // Foundation plinth (left open under the doors and the porch).
  const plinth = (x0: number, x1: number, z0: number, z1: number) => kit.box(x0, x1, 0, 0.32, z0, z1, concrete)
  const P = 0.06
  plinth(-MAIN_HX - P, -PORCH.x1, MAIN_HZ - 0.02, MAIN_HZ + P)
  plinth(PORCH.x1, MAIN_HX + P, MAIN_HZ - 0.02, MAIN_HZ + P)
  plinth(-MAIN_HX - P, -DOORWAY / 2 - 0.05, -MAIN_HZ - P, -MAIN_HZ + 0.02)
  plinth(DOORWAY / 2 + 0.05, GARAGE.x1 + P, -MAIN_HZ - P, -MAIN_HZ + 0.02)
  plinth(-MAIN_HX - P, -MAIN_HX + 0.02, -MAIN_HZ - P, MAIN_HZ + P)
  plinth(MAIN_HX - 0.02, MAIN_HX + P, GARAGE.z1, MAIN_HZ + P)
  plinth(MAIN_HX, 8.25, GARAGE.z1 - 0.02, GARAGE.z1 + P)
  plinth(11.25, GARAGE.x1 + P, GARAGE.z1 - 0.02, GARAGE.z1 + P)
  plinth(GARAGE.x1 - 0.02, GARAGE.x1 + P, GARAGE.z0 - P, GARAGE.z1 + P)
  // Belly band between the storeys.
  const band = (x0: number, x1: number, z0: number, z1: number) => kit.box(x0, x1, FLOOR_H - 0.22, FLOOR_H, z0, z1, trim)
  band(-MAIN_HX - 0.04, -PORCH.x1, MAIN_HZ - 0.02, MAIN_HZ + 0.04)
  band(PORCH.x1, MAIN_HX + 0.04, MAIN_HZ - 0.02, MAIN_HZ + 0.04)
  band(-MAIN_HX - 0.04, MAIN_HX + 0.04, -MAIN_HZ - 0.04, -MAIN_HZ + 0.02)
  band(-MAIN_HX - 0.04, -MAIN_HX + 0.02, -MAIN_HZ - 0.04, MAIN_HZ + 0.04)
  band(MAIN_HX - 0.02, MAIN_HX + 0.04, GARAGE.z1, MAIN_HZ + 0.04)
  kit = roofKit
  // Downspouts at the eave ends.
  const yS = EAVE_Y - 0.12
  if (style.roof === 'hip') {
    for (const sx of [-1, 1]) downspout(sx * (MAIN_HX + 0.07), MAIN_HZ + 0.07, MAIN_HZ + EAVE_OH + 0.1, yS)
    downspout(-(MAIN_HX + 0.07), -(MAIN_HZ + 0.07), -(MAIN_HZ + EAVE_OH + 0.1), yS)
  } else {
    for (const sx of [-1, 1]) downspout(sx * (MAIN_HX - 0.25), MAIN_HZ + 0.07, MAIN_HZ + EAVE_OH + 0.1, yS)
    downspout(-(MAIN_HX - 0.25), -(MAIN_HZ + 0.07), -(MAIN_HZ + EAVE_OH + 0.1), yS)
  }

  /* ---------- ceilings ---------- */
  kit.geo(polygon([V(-HX + 0.15, ROOF_CEIL, -HZ + 0.15), V(HX - 0.15, ROOF_CEIL, -HZ + 0.15), V(HX - 0.15, ROOF_CEIL, HZ - 0.15), V(-HX + 0.15, ROOF_CEIL, HZ - 0.15)]), M.ceiling())
  kit.geo(polygon([V(MAIN_HX, WALL_H - 0.01, GARAGE.z0 + 0.3), V(GARAGE.x1 - 0.3, WALL_H - 0.01, GARAGE.z0 + 0.3), V(GARAGE.x1 - 0.3, WALL_H - 0.01, GARAGE.z1 - 0.3), V(MAIN_HX, WALL_H - 0.01, GARAGE.z1 - 0.3)]), M.ceiling())

  /* ---------- floor coverings upstairs ---------- */
  kit = baseKit
  const cover = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material) => kit.geo(polygon([V(x0, FLOOR_H + 0.004, z1), V(x1, FLOOR_H + 0.004, z1), V(x1, FLOOR_H + 0.004, z0), V(x0, FLOOR_H + 0.004, z0)]), mat)
  const covers: Partial<Record<RoomId, THREE.Material>> = {
    master: M.carpet(o.dir > 0 ? '#c9b49a' : '#b9c6d6'),
    bed2: M.carpet(o.dir > 0 ? '#9fb7c9' : '#c9a9a0'),
    bed3: M.carpet(o.dir > 0 ? '#c4b8d4' : '#bccfae'),
    bath: M.tiles(),
  }
  for (const r of ROOMS) {
    const m = r.upper ? covers[r.id] : undefined
    if (m) cover(r.x0, r.x1, r.z0, r.z1, m)
  }

  /* ---------- lamps ---------- */
  const fixture = (x: number, y: number, z: number, lit: boolean) => {
    kit = y > FLOOR_H ? roofKit : baseKit
    const dome = new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
    dome.translate(x, y, z)
    kit.geo(dome, lit ? M.bulb(LAMP, 2.2 * o.lampScale + 0.4) : M.bulb(LAMP, 0.15))
    kit.box(x - 0.09, x + 0.09, y - 0.005, y + 0.03, z - 0.09, z + 0.09, M.metal('#c9a86a'))
  }
  const G = FLOOR_H - 0.22
  const U = ROOF_CEIL - 0.01
  // A ceiling fixture in every room; the first `lamps` (by this priority) also cast real light.
  const order: RoomId[] = ['living', 'master', 'kitchen', 'bed3', 'dining', 'bed2', 'bath', 'study', 'garage', 'hall', 'wc', 'landing']
  const rooms: [number, number, number, number][] = ROOMS.map((r) => {
    const x = r.id === 'hall' || r.id === 'landing' ? -0.6 : (r.x0 + r.x1) / 2
    const z = r.id === 'hall' ? 4.2 : r.id === 'landing' ? -3.6 : (r.z0 + r.z1) / 2
    const y = r.id === 'garage' ? WALL_H - 0.02 : r.upper ? U : G
    return [x, y, z, order.indexOf(r.id)]
  })
  for (const [x, y, z, prio] of rooms) {
    const lit = prio < o.lamps && o.lampScale > 0
    fixture(x, y, z, o.lampScale > 0)
    if (!lit) continue
    const l = new THREE.PointLight(LAMP, 11 * o.lampScale, 10, 2)
    l.position.set(x, y - 0.35, z)
    group.add(l)
    lights.push(l)
  }
  // Porch ceiling lamp and the coach lamps by the doors.
  const lantern = (x: number, y: number, z: number, sz: number) => {
    kit = baseKit
    kit.box(x - 0.09, x + 0.09, y - 0.16, y + 0.16, z, z + sz * 0.16, M.metal('#2c2c2c'))
    kit.box(x - 0.065, x + 0.065, y - 0.13, y + 0.1, z + sz * 0.02, z + sz * 0.15, o.outdoorLamps ? M.bulb('#ffb860', 3.2) : M.glass(0))
  }
  fixture(0, FLOOR_H - 0.23, (PORCH.z0 + PORCH.z1) / 2, o.outdoorLamps)
  for (const sx of [-1, 1]) lantern(sx * 0.95, 2.05, MAIN_HZ, 1)
  lantern(8.0, 2.2, GARAGE.z1, 1)
  lantern(11.5, 2.2, GARAGE.z1, 1)
  if (o.outdoorLamps) {
    const pl = new THREE.PointLight('#ffc27a', 9, 9, 2)
    pl.position.set(0, FLOOR_H - 0.5, (PORCH.z0 + PORCH.z1) / 2 + 0.2)
    group.add(pl)
    lights.push(pl)
    const gl = new THREE.PointLight('#ffc27a', 6, 7, 2)
    gl.position.set(9.75, 2.3, GARAGE.z1 + 0.6)
    group.add(gl)
    lights.push(gl)
  }

  const roof = new THREE.Group()
  roofKit.build(roof)
  baseKit.build(group)
  group.add(roof)

  /* ---------- contact shadow skirt ---------- */
  const skirtMat = cached('skirt', () => new THREE.MeshBasicMaterial({ color: '#000000', map: ramp(), transparent: true, opacity: 0.42, depthWrite: false }))
  const skirt = (x0: number, x1: number, z0: number, z1: number, side: 'n' | 's' | 'e' | 'w') => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    // Rotate UVs so v runs away from the wall.
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) {
      const u0 = uv.getX(i)
      const v0 = uv.getY(i)
      if (side === 's') uv.setXY(i, u0, v0)
      else if (side === 'n') uv.setXY(i, u0, 1 - v0)
      else if (side === 'e') uv.setXY(i, v0, u0)
      else uv.setXY(i, v0, 1 - u0)
    }
    const m = new THREE.Mesh(g, skirtMat)
    m.scale.set(x1 - x0, 1, z1 - z0)
    m.position.set((x0 + x1) / 2, 0.022, (z0 + z1) / 2)
    m.renderOrder = 1
    group.add(m)
  }
  const W = 1.1
  skirt(-MAIN_HX, -PORCH.x1, MAIN_HZ, MAIN_HZ + W, 'n')
  skirt(PORCH.x1, MAIN_HX, MAIN_HZ, MAIN_HZ + W, 'n')
  skirt(PORCH.x0, PORCH.x1, PORCH.z1, PORCH.z1 + 0.7, 'n')
  skirt(-MAIN_HX, GARAGE.x1, -MAIN_HZ - W, -MAIN_HZ, 's')
  skirt(-MAIN_HX - W, -MAIN_HX, -MAIN_HZ, MAIN_HZ, 'w')
  skirt(MAIN_HX, MAIN_HX + W, GARAGE.z1, MAIN_HZ, 'e')
  skirt(GARAGE.x1, GARAGE.x1 + W, GARAGE.z0, GARAGE.z1, 'e')
  skirt(MAIN_HX, GARAGE.x1, GARAGE.z1, GARAGE.z1 + 0.8, 'n')
  return { group, roof, lights }
}

const ROOF_CEIL = 6.19

function shade(hex: string, k: number) {
  const c = paint(hex, 1)
  c.multiplyScalar(k)
  return '#' + c.getHexString()
}
