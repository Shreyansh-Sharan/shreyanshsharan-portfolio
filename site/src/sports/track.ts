// The F1 circuit: a closed spline around the complex, sampled every couple of metres. Builds the road, kerbs, tyre
// barriers, the start/finish gantry and one sector gate per career role, and answers "where am I on the lap?".
import * as THREE from 'three'
import { CONFIG } from './config'
import { fit, model, yawFromX, type SportsAssets } from './assets'
import { asphaltTexture, decal, kerbTexture, labelTexture } from './textures'
import type { Role } from './progress'

/** Control points, clockwise from the start/finish straight on the west side (heading north). */
const POINTS: [number, number][] = [
  [-120, 60],
  [-122, -30],
  [-116, -100],
  [-90, -148],
  [-50, -176],
  [0, -186],
  [50, -180],
  [92, -158],
  [118, -122],
  [124, -84],
  [150, -66],
  [180, -42],
  [188, 0],
  [178, 40],
  [150, 58],
  [126, 50],
  [108, 66],
  [112, 98],
  [88, 124],
  [48, 120],
  [18, 100],
  [-12, 118],
  [-44, 132],
  [-84, 126],
  [-112, 100],
]

export class Track {
  readonly n: number
  readonly length: number
  readonly px: Float32Array
  readonly pz: Float32Array
  readonly tx: Float32Array
  readonly tz: Float32Array
  readonly s: Float32Array
  readonly curv: Float32Array
  /** +1 or -1: the side of the centreline (along the normal (-tz, tx)) that faces the inside of the loop. */
  readonly inner: number
  readonly sectorStart: number[] // arc length where each sector begins

  constructor(sectors: number) {
    const curve = new THREE.CatmullRomCurve3(
      POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    )
    const approx = curve.getLength()
    const n = Math.round(approx / CONFIG.track_sample)
    const pts = curve.getSpacedPoints(n).slice(0, n)
    this.n = n
    this.px = new Float32Array(n)
    this.pz = new Float32Array(n)
    this.tx = new Float32Array(n)
    this.tz = new Float32Array(n)
    this.s = new Float32Array(n)
    this.curv = new Float32Array(n)
    pts.forEach((p, i) => {
      this.px[i] = p.x
      this.pz[i] = p.z
    })
    let acc = 0
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n, b = (i + 1) % n
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a]
      const l = Math.hypot(dx, dz) || 1
      this.tx[i] = dx / l
      this.tz[i] = dz / l
      this.s[i] = acc
      acc += Math.hypot(this.px[b] - this.px[i], this.pz[b] - this.pz[i])
    }
    this.length = acc
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n
      const h1 = Math.atan2(this.tx[a], this.tz[a]), h2 = Math.atan2(this.tx[b], this.tz[b])
      let d = h2 - h1
      d = Math.atan2(Math.sin(d), Math.cos(d))
      this.curv[i] = d / (4 * CONFIG.track_sample)
    }
    // Which side is inside: probe 20 m along the normal and test against the centreline polygon.
    const probeX = this.px[0] - this.tz[0] * 20, probeZ = this.pz[0] + this.tx[0] * 20
    this.inner = this.inside(probeX, probeZ) ? 1 : -1
    this.sectorStart = Array.from({ length: sectors }, (_, k) => (k * this.length) / sectors)
  }

  /** Point-in-polygon against the centreline. */
  inside(x: number, z: number) {
    let c = false
    for (let i = 0, j = this.n - 1; i < this.n; j = i++) {
      const xi = this.px[i], zi = this.pz[i], xj = this.px[j], zj = this.pz[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
    }
    return c
  }

  /** Nearest sample; with a hint, only searches nearby (cheap per-frame tracking). */
  nearest(x: number, z: number, hint = -1) {
    let best = -1, bd = Infinity
    if (hint >= 0) {
      for (let k = -24; k <= 24; k++) {
        const i = (hint + k + this.n) % this.n
        const dx = this.px[i] - x, dz = this.pz[i] - z
        const d = dx * dx + dz * dz
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (bd < 400) return best
    }
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x, dz = this.pz[i] - z
      const d = dx * dx + dz * dz
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  /** Signed distance from the centreline at sample i (positive along the normal (-tz, tx)). */
  offset(i: number, x: number, z: number) {
    return (x - this.px[i]) * -this.tz[i] + (z - this.pz[i]) * this.tx[i]
  }

  /** Arc length of (x, z) near sample i, wrapped to [0, length). */
  arc(i: number, x: number, z: number) {
    const along = (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i]
    return (((this.s[i] + along) % this.length) + this.length) % this.length
  }

  /** Sample index at arc length s. */
  indexAt(s: number) {
    const w = ((s % this.length) + this.length) % this.length
    return Math.min(this.n - 1, Math.floor((w / this.length) * this.n))
  }

  heading(i: number) {
    return Math.atan2(this.tx[i], this.tz[i])
  }

  /** Keep a walker off the circuit: inside the loop, no closer than the inner barrier. Returns true if it pushed. */
  keepInside(pos: THREE.Vector3, radius: number) {
    const i = this.nearest(pos.x, pos.z)
    const off = this.offset(i, pos.x, pos.z) * this.inner
    const wall = CONFIG.track_half_width + CONFIG.track_runoff + 0.5 + radius
    if (off >= wall) return false
    // Only push walkers who are by the circuit, not the far side of the map.
    const push = wall - off
    pos.x += -this.tz[i] * this.inner * push
    pos.z += this.tx[i] * this.inner * push
    return true
  }

  /* ---------- Meshes ---------- */

  build(assets: SportsAssets | null, roles: Role[]) {
    const g = new THREE.Group()
    g.name = 'circuit'
    const n = this.n
    const hw = CONFIG.track_half_width

    // Road ribbon (u across, v along in metres).
    const ribbon = (inner: number, outer: number, y: number, vScale: number) => {
      const pos = new Float32Array((n + 1) * 2 * 3)
      const uv = new Float32Array((n + 1) * 2 * 2)
      const idx: number[] = []
      for (let k = 0; k <= n; k++) {
        const i = k % n
        const nx = -this.tz[i], nz = this.tx[i]
        const v = (k === n ? this.length : this.s[i]) * vScale
        pos.set([this.px[i] + nx * inner, y, this.pz[i] + nz * inner, this.px[i] + nx * outer, y, this.pz[i] + nz * outer], k * 6)
        uv.set([0, v, 1, v], k * 4)
        if (k < n) {
          const a = k * 2
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      geo.setIndex(idx)
      geo.computeVertexNormals()
      // Wound so the face points up whichever way the loop runs.
      if (geo.attributes.normal.getY(0) < 0) {
        const ix = geo.index!.array as Uint16Array | Uint32Array
        for (let t = 0; t < ix.length; t += 3) {
          const tmp = ix[t + 1]
          ix[t + 1] = ix[t + 2]
          ix[t + 2] = tmp
        }
        geo.computeVertexNormals()
      }
      return geo
    }
    const road = new THREE.Mesh(ribbon(-hw, hw, 0.04, 1 / 12), decal(new THREE.MeshStandardMaterial({ map: asphaltTexture([1, 1]), roughness: 0.92 }), 2))
    road.receiveShadow = true
    g.add(road)

    // Kerbs on the corners, both sides.
    const kerbMat = decal(new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.7 }), 3)
    const kerbGeo = (side: number) => {
      const pos: number[] = []
      const uv: number[] = []
      const idx: number[] = []
      let run = 0
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const hot = Math.abs(this.curv[i]) > 0.006 || Math.abs(this.curv[j]) > 0.006
        if (!hot) continue
        const quad = (k: number, u: number) => {
          const nx = -this.tz[k], nz = this.tx[k]
          pos.push(this.px[k] + nx * side * hw, 0.07, this.pz[k] + nz * side * hw, this.px[k] + nx * side * (hw + 1.3), 0.09, this.pz[k] + nz * side * (hw + 1.3))
          uv.push(u, 0, u, 1)
        }
        const base = pos.length / 3
        quad(i, run / 4)
        run += CONFIG.track_sample
        quad(j, run / 4)
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      geo.setIndex(idx)
      kerbMat.side = THREE.DoubleSide
      return geo
    }
    for (const side of [1, -1]) {
      const k = new THREE.Mesh(kerbGeo(side), kerbMat)
      k.receiveShadow = true
      g.add(k)
    }

    // Tyre barriers: alternating red/white blocks along both sides (one instanced mesh). Where the inside of a
    // tight bend folds back over another stretch, the blocks that would land on that stretch are left out.
    const wall = hw + CONFIG.track_runoff
    const mats: THREE.Matrix4[] = []
    const cols: THREE.Color[] = []
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const p = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const red = new THREE.Color('#dc2626'), white = new THREE.Color('#f1f5f9'), blue = new THREE.Color('#1d4ed8')
    for (const side of [1, -1])
      for (let i = 0; i < n; i++) {
        const nx = -this.tz[i], nz = this.tx[i]
        p.set(this.px[i] + nx * side * (wall + 0.35), 0.47, this.pz[i] + nz * side * (wall + 0.35))
        const j = this.nearest(p.x, p.z)
        if (Math.hypot(this.px[j] - p.x, this.pz[j] - p.z) < wall - 0.2) continue
        q.setFromAxisAngle(up, this.heading(i))
        mats.push(new THREE.Matrix4().compose(p, q, one))
        cols.push(i % 4 < 2 ? red : side === this.inner ? blue : white)
      }
    const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.95, CONFIG.track_sample * 1.02), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 }), mats.length)
    mats.forEach((mm, k) => {
      bar.setMatrixAt(k, mm)
      bar.setColorAt(k, cols[k])
    })
    bar.castShadow = true
    bar.receiveShadow = true
    bar.computeBoundingSphere()
    g.add(bar)

    // Start/finish line and grid boxes.
    const cv = document.createElement('canvas')
    cv.width = 128
    cv.height = 16
    const cg = cv.getContext('2d')!
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 2; y++) {
        cg.fillStyle = (x + y) % 2 ? '#111' : '#fff'
        cg.fillRect(x * 8, y * 8, 8, 8)
      }
    const chk = new THREE.CanvasTexture(cv)
    chk.colorSpace = THREE.SRGBColorSpace
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.4).rotateX(-Math.PI / 2), decal(new THREE.MeshStandardMaterial({ map: chk, roughness: 0.8 }), 4))
    line.position.set(this.px[0], 0.06, this.pz[0])
    line.rotation.y = this.heading(0)
    g.add(line)
    const gridMat = decal(new THREE.MeshBasicMaterial({ color: '#f8fafc' }), 4)
    for (let k = 1; k <= 4; k++) {
      const i = this.indexAt(this.length - k * 9)
      const box = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25).rotateX(-Math.PI / 2), gridMat)
      const side = k % 2 ? 1 : -1
      box.position.set(this.px[i] - this.tz[i] * side * 3, 0.06, this.pz[i] + this.tx[i] * side * 3)
      box.rotation.y = this.heading(i)
      g.add(box)
    }

    // The start gantry (arch with the red lights) over the line, spanning the road.
    const gantry = fit(model(assets, 'gantry'), [null, null, hw * 2 + 5])
    gantry.position.set(this.px[0], 0, this.pz[0])
    gantry.rotation.y = yawFromX(this.tx[0], this.tz[0])
    g.add(gantry)

    // One gate per sector: posts, a crossbar and the role's banner on both faces.
    const postMat = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.6, metalness: 0.4 })
    roles.forEach((r, k) => {
      // Sector 1's banner hangs under the start gantry's arch; the others get their own posts.
      const i = this.indexAt(this.sectorStart[k] + (k === 0 ? 0.8 : 0))
      const gate = new THREE.Group()
      const span = hw * 2 + 3
      const h = k === 0 ? 8.8 : 6.6
      if (k > 0) {
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, h + 1.2, 0.5), postMat)
          post.position.set(side * (span / 2), (h + 1.2) / 2, 0)
          post.castShadow = true
          gate.add(post)
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.5, 0.35, 0.4), postMat)
        beam.position.y = h + 1.1
        gate.add(beam)
      }
      const tex = labelTexture(`S${k + 1} · ${r.title.toUpperCase()}`, { bg: r.deep, sub: `${r.org} · ${r.period}`, border: r.color, w: 1024, h: 192 })
      // Two single-sided faces so the text reads correctly from both directions.
      const bmat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 })
      const bgeo = new THREE.PlaneGeometry(span - 1, 1.9)
      for (const turn of [0, Math.PI]) {
        const banner = new THREE.Mesh(bgeo, bmat)
        banner.position.set(0, h, turn ? 0.03 : -0.03)
        banner.rotation.y = turn ? 0 : Math.PI // the side approaching cars see first
        gate.add(banner)
      }
      gate.position.set(this.px[i], 0, this.pz[i])
      gate.rotation.y = this.heading(i)
      g.add(gate)
    })

    // Billboards on the outside of a few straights, facing the road.
    const signs: [number, string, string][] = [
      [0.12, 'SPORTS COMPLEX', 'F1 · Football · Badminton · Table tennis'],
      [0.4, 'DATA & AI', 'Lakehouse · GenAI · DevOps'],
      [0.62, 'FULL THROTTLE', 'One sector per role'],
      [0.86, 'SHREYANSH SHARAN', 'Solution Architect'],
    ]
    for (const [f, title, sub] of signs) {
      const i = this.indexAt(this.length * f)
      const out = -this.inner
      const bx = this.px[i] - this.tz[i] * out * (wall + 5), bz = this.pz[i] + this.tx[i] * out * (wall + 5)
      const bb = new THREE.Group()
      bb.add(fit(model(assets, 'billboard'), [null, 9, null]))
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(4.7, 7.1),
        new THREE.MeshBasicMaterial({ map: labelTexture(title, { bg: '#0f172a', sub, border: '#f97316', w: 600, h: 900, font: 96 }), toneMapped: false }),
      )
      face.position.set(1.12, 4.95, 0)
      face.rotation.y = Math.PI / 2
      bb.add(face)
      bb.position.set(bx, 0, bz)
      bb.rotation.y = yawFromX(this.px[i] - bx, this.pz[i] - bz)
      g.add(bb)
    }
    return g
  }
}
