// Concrete River: a storm-drain river channel and downtown streets at sunset. Down a ramp into the wide sloped
// concrete basin, under arched bridges, round the long bend (or through the spillway), up and off the exit ramp
// onto the streets, under the freeways and back to the line. Original layout and buildings.
import * as THREE from 'three'
import { facadeMat, unitBox, type Kit } from './circuits'
import { concreteTexture, facadeTexture, signTexture, tarmacTexture, chainLinkTexture } from './paint'
import { archGeometry, fence, merge, pylonGeometry, streetLight, tallPalm, vcMat, worldUv } from './props3d'

/** The rest of the river, beyond the stretch the circuit uses (scenery only): north, and on west past the exit. */
const NORTH: [number, number, number][] = [[372, -900, -7.5], [372, -400, -7.5], [372, 0, -7.5], [372, 220, -7.5]]
const SOUTH: [number, number, number][] = [[160, 862, -7.5], [40, 880, -7.5], [-100, 918, -7.5], [-300, 958, -7.5], [-700, 1010, -7.5], [-1100, 1040, -7.5]]
const CH_HALF = 14
const SLOPE = 0.62 // rise per metre up the channel side

/** Freeways on stilts (x, z), 12 m up. */
const FREEWAYS: [number, number][][] = [
  [[-900, 470], [-600, 466], [-300, 470], [0, 476], [250, 470], [700, 440]],
  [[64, -700], [60, -300], [60, 0], [68, 300], [100, 560], [180, 700]],
]

export function buildRiver(kit: Kit) {
  const t = kit.track
  const g = kit.group
  const rnd = kit.rnd
  const concrete = concreteTexture()

  // Ground: flat basin city; the channel's trapezoid sides wherever a road or the river runs low.
  kit.ground({
    base: () => 0,
    bank: (d, h, b) => {
      const def = d < 2.5 ? h - 0.15 : THREE.MathUtils.lerp(h - 0.15, b, THREE.MathUtils.smoothstep(d, 2.5, 30))
      const ch = d < 0.3 ? h - 0.12 : Math.min(b, h - 0.12 + (d - 0.3) * SLOPE)
      return THREE.MathUtils.lerp(def, ch, THREE.MathUtils.smoothstep(-h, 1.5, 3.5))
    },
    color: (x, z, y, d, h, out) => {
      const n = Math.sin(x * 0.05 + Math.sin(z * 0.03) * 2) * 0.5 + 0.5
      if (y < -0.3 && d < 40) out.set(y < h + 0.9 ? '#a39d92' : '#c4beb2').multiplyScalar(0.94 + n * 0.08)
      else if (d < 4) out.set('#aaa59b')
      else if (h < -2.5 && d < 46) out.set('#9b8f5c').lerp(new THREE.Color('#7f7a52'), n)
      else out.set('#6f6b66').lerp(new THREE.Color('#5d5b5a'), n * 0.7)
    },
    detail: concrete,
    detailScale: 8,
    extras: [
      { pts: NORTH, half: CH_HALF },
      { pts: SOUTH, half: CH_HALF },
    ],
  })

  // Road: concrete bed with the wet low-flow channel in the river, worn asphalt on the streets.
  kit.road({
    map: tarmacTexture(), scale: 6, color: '#7b7b80', roughness: 0.8,
    alt: { map: concrete, scale: 8, color: '#d6d0c4', below: -3.2 },
    edgeLine: [0.93, 0.92, 0.86], centre: 'dash', centreColor: [0.95, 0.76, 0.18], kerb: [0.75, 0.12, 0.1], glow: [0.35, 0.16, 0.05], channel: true,
  })
  kit.gantry('#fb923c')

  // Barriers: none in the channel (its sloped sides are the walls), concrete on the ramps and streets.
  const concMat = new THREE.MeshStandardMaterial({ map: concrete, color: '#cfc9bd', roughness: 0.85 })
  kit.barriers((e) => (e.road >= 0 || (e.ay + e.by) / 2 < -4 ? 'none' : 'concrete'), { concrete: concMat })
  kit.roadside({ post: '#e8e6e0', reflector: '#ffb347', step: 10 })

  // Chain-link fences along the top of the channel sides, palms beyond them.
  const link = chainLinkTexture()
  const topOff = (h: number) => 0.3 + (0 - h) / SLOPE + 1.5 // from the road edge to just past the top of the slope
  const palms: number[][] = []
  for (const side of [-1, 1]) {
    let run: [number, number, number][] = []
    const flush = () => {
      if (run.length > 2) g.add(fence(run, 2.4, link))
      run = []
    }
    for (let s = 0; s < t.length; s += 6) {
      const i = t.index(s)
      const h = t.py[i]
      if (h > -6.5) {
        flush()
        continue
      }
      const p = t.point(s, side * (t.hw[i] + topOff(h)))
      if (kit.clearance(p.x, p.z) < topOff(h) - 1) {
        flush()
        continue
      }
      run.push([p.x, kit.heightAt(p.x, p.z), p.z])
      if (Math.round(s / 6) % 7 === 0) {
        const q = t.point(s, side * (t.hw[i] + topOff(h) + 6))
        if (kit.clearance(q.x, q.z) > 8) palms.push([q.x, 0, q.z, rnd() * 6, 1, 0.85 + rnd() * 0.35, 1])
      }
    }
    flush()
  }
  for (const pts of [NORTH, SOUTH]) {
    for (const side of [-1, 1]) {
      const run: [number, number, number][] = []
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1]
        const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len
        for (let u = 0; u < len; u += 8) {
          const x = ax + ((bx - ax) * u) / len + nx * side * (CH_HALF + topOff(-7.5)), z = az + ((bz - az) * u) / len + nz * side * (CH_HALF + topOff(-7.5))
          if (kit.clearance(x, z) < topOff(-7.5) - 1) continue
          run.push([x, kit.heightAt(x, z), z])
          if (Math.round(u / 8) % 5 === 0) palms.push([x + nx * side * 6, 0, z + nz * side * 6, rnd() * 6, 1, 0.85 + rnd() * 0.35, 1])
        }
      }
      if (run.length > 2) g.add(fence(run, 2.4, link))
    }
  }

  // Downtown streets: tall palms on the pavements, street lamps, billboards.
  kit.along(30, 3, (x, y, z, _yaw, s) => {
    if (t.heightAtS(s) < -1.5) return
    palms.push([x, y, z, rnd() * 6, 1, 0.8 + rnd() * 0.3, 1])
  }, { clear: 2 })
  kit.instances(tallPalm(20), vcMat(0.85), palms)

  const lamps: number[][] = []
  kit.along(38, 1.4, (x, y, z, yaw, s) => {
    if (t.heightAtS(s) > -2) lamps.push([x, y, z, yaw])
  }, { clear: 1 })
  const [pole, head] = streetLight(9)
  kit.instances(pole, vcMat(0.5, 0.6), lamps)
  kit.instances(head, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2, 1.7), toneMapped: false }), lamps)
  const boards: number[][] = []
  kit.along(230, 9, (x, y, z, yaw, s, side) => {
    if (t.heightAtS(s) > -1 && (Math.round(s / 230) % 2 ? 1 : -1) === side) boards.push([x, y, z, yaw])
  }, { clear: 5 })
  kit.propInstances('billboard', { height: 15 }, boards)

  bridges(kit, concrete)
  freeways(kit, concrete)
  skyline(kit)
  pylons(kit)
  return null
}

/** Bridges over the channel: tied arches over the deck (alternating with plain lamp-lit decks), piers on the slopes. */
function bridges(kit: Kit, concrete: THREE.Texture) {
  const t = kit.track
  const deck: THREE.BufferGeometry[] = []
  const white: THREE.BufferGeometry[] = []
  const lights: number[][] = []
  const place = (x: number, z: number, ang: number, span: number, arch: boolean) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(1, 1, 1))
    const W = 14
    const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(span, 1.5, W).translate(0, 0.9, 0)]
    for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(span, 1.0, 0.4).translate(0, 2.1, sz * (W / 2 - 0.2)))
    for (const sx of [-1, 1]) {
      // Piers on the channel sides and abutments on the banks.
      parts.push(new THREE.BoxGeometry(2.2, 9, W * 0.8).translate(sx * (CH_HALF + 4), -4, 0))
      parts.push(new THREE.BoxGeometry(6, 3, W + 2).translate(sx * (span / 2 - 3), -0.6, 0))
    }
    deck.push(...parts.map((p) => p.applyMatrix4(m)))
    if (arch) {
      for (const sz of [-1, 1]) {
        const a = archGeometry(span * 0.62, 1.2, 1.1, 1.0, false, true)
        a.deleteAttribute('uv')
        a.translate(0, 1.6, sz * (W / 2 - 0.5))
        white.push(a.applyMatrix4(m))
        for (let k = -4; k <= 4; k++) {
          const hx = (k / 5) * span * 0.31
          const hh = Math.sqrt(Math.max(0, 1 - (hx / (span * 0.34)) ** 2)) * span * 0.3 * 0.85
          if (hh > 1) white.push(new THREE.BoxGeometry(0.25, hh, 0.25).translate(hx, 2.4 + hh / 2, sz * (W / 2 - 0.5)).applyMatrix4(m))
        }
      }
    } else {
      for (let k = -3; k <= 3; k += 2)
        for (const sz of [-1, 1]) {
          const p = new THREE.Vector3((k / 7) * span, 0, sz * (W / 2 - 0.3)).applyMatrix4(m)
          lights.push([p.x, 2.6, p.z, ang])
        }
    }
  }
  // Over the circuit's stretch of the channel.
  let k = 0, lastX = 1e9, lastZ = 1e9
  for (let s = 0; s < t.length; s += 20) {
    const i = t.index(s)
    if (t.py[i] > -7.3 || t.curv[i] > 0.004) continue
    const p = t.point(s)
    if (Math.hypot(p.x - lastX, p.z - lastZ) < 170) continue
    lastX = p.x
    lastZ = p.z
    place(p.x, p.z, Math.atan2(-t.tx[i], -t.tz[i]), 2 * (t.hw[i] + 0.3 + 7.6 / SLOPE + 5), k++ % 2 === 0)
  }
  // Over the river's other reaches.
  for (const [x, z, ang] of [[372, 20, 0], [372, -220, 0], [372, -520, 0], [-200, 938, -1.37], [-520, 985, -1.44]] as const)
    place(x, z, ang, 2 * (CH_HALF + 0.3 + 7.6 / SLOPE + 5), k++ % 2 === 1)
  const conc = merge(deck.map((d) => (d.index ? d.toNonIndexed() : d)).map((d) => (d.deleteAttribute('uv'), d)))
  kit.group.add(new THREE.Mesh(worldUv(conc, 6), new THREE.MeshStandardMaterial({ map: concrete, color: '#bdb6aa', roughness: 0.9 })))
  if (white.length) kit.group.add(new THREE.Mesh(merge(white.map((d) => (d.index ? d.toNonIndexed() : d)).map((d) => (d.deleteAttribute('uv'), d))), new THREE.MeshStandardMaterial({ color: '#efe9de', roughness: 0.6 })))
  const [post, head] = [new THREE.CylinderGeometry(0.08, 0.1, 5, 6).translate(0, 2.5, 0), new THREE.SphereGeometry(0.3, 8, 6).translate(0, 5.1, 0)]
  kit.instances(post, new THREE.MeshStandardMaterial({ color: '#2d2f33' }), lights)
  kit.instances(head, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(2), toneMapped: false }), lights)
}

/** Elevated freeways: deck, parapets, T-columns, and green signs where they cross the circuit. */
function freeways(kit: Kit, concrete: THREE.Texture) {
  const H = 12, W = 24
  const parts: THREE.BufferGeometry[] = []
  const signs: [number, number, number, number][] = []
  for (const line of FREEWAYS) {
    for (let k = 0; k < line.length - 1; k++) {
      const [ax, az] = line[k], [bx, bz] = line[k + 1]
      const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bz - az, bx - ax)
      const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang), new THREE.Vector3(1, 1, 1))
      parts.push(new THREE.BoxGeometry(len + 2, 1.8, W).translate(0, H, 0).applyMatrix4(m))
      for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(len + 2, 1.1, 0.5).translate(0, H + 1.45, sz * (W / 2 - 0.25)).applyMatrix4(m))
      // Columns every ~36 m, skipped where they would stand in a road; a sign where the deck passes over one.
      for (let u = 0; u < len; u += 4) {
        const x = ax + ((bx - ax) * u) / len, z = az + ((bz - az) * u) / len
        const ground = kit.heightAt(x, z)
        if (kit.clearance(x, z) < -2 && signs.every(([sx, , sz]) => Math.hypot(sx - x, sz - z) > 60)) signs.push([x, H, z, -ang])
        if (Math.round(u / 4) % 9 !== 0 || kit.clearance(x, z) < 3) continue
        const c = new THREE.Matrix4().compose(new THREE.Vector3(x, ground, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang), new THREE.Vector3(1, 1, 1))
        parts.push(new THREE.BoxGeometry(2.6, H - ground, 2.6).translate(0, (H - ground) / 2, 0).applyMatrix4(c))
        parts.push(new THREE.BoxGeometry(3.4, 1.6, W * 0.8).translate(0, H - 1.6, 0).applyMatrix4(c))
      }
    }
  }
  const geo = merge(parts.map((p) => p.toNonIndexed()).map((p) => (p.deleteAttribute('uv'), p)))
  kit.group.add(new THREE.Mesh(worldUv(geo, 7), new THREE.MeshStandardMaterial({ map: concrete, color: '#b3ab9f', roughness: 0.9 })))
  const texts = [['CIVIC CENTER', 'EXIT 1/2 MILE'], ['RIVER DR', 'NEXT EXIT'], ['DOWNTOWN', 'KEEP LEFT']]
  signs.forEach(([x, y, z, yaw], i) => {
    const tex = signTexture(texts[i % texts.length], '#106a3c', '#ffffff', 512, 192)
    // One on each face of the deck, hung just below it.
    for (const sd of [-1, 1]) {
      const off = sd * (W / 2 + 0.08)
      kit.sign(tex, 10, 3.6, x + Math.sin(yaw) * off, y - 2.4, z + Math.cos(yaw) * off, yaw + (sd > 0 ? 0 : Math.PI))
    }
  })
}

/** Downtown: a cluster of towers to the west against the sun, a few landmark crowns, and mid-rise blocks on the streets. */
function skyline(kit: Kit) {
  const t = kit.track
  const rnd = kit.rnd
  const towers: number[][] = []
  const mids: number[][] = []
  const tryTower = (cx: number, cz: number, spread: number, hMin: number, hMax: number, n: number) => {
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * spread, z = cz + (rnd() - 0.5) * spread
      const w = 24 + rnd() * 26, d = 24 + rnd() * 26, yaw = rnd() < 0.7 ? 0 : rnd() * Math.PI
      if (!kit.fits(x, z, yaw, w, d, 14)) continue
      const near = 1 - Math.min(1, Math.hypot(x - cx, z - cz) / (spread * 0.6))
      towers.push([x, kit.heightAt(x, z) - 1, z, yaw, w, hMin + (hMax - hMin) * (0.35 * rnd() + 0.65 * near), d])
    }
  }
  tryTower(-760, 120, 520, 60, 230, 70)
  tryTower(-120, -420, 520, 40, 160, 46)
  tryTower(-650, 760, 360, 30, 90, 26)
  const glass = facadeMat(facadeTexture('tower', 2), { tileW: 26, tileH: 40, roof: '#2a2a30', glow: 0.55, rough: 0.35, metal: 0.5 })
  kit.instances(unitBox(), glass, towers)

  // Landmarks: a round glass tower with a crown ring, a stepped tower with a spire, a tower with a slanted top.
  const lm = new THREE.Group()
  const blue = facadeMat(facadeTexture('glass', 3), { tileW: 16, tileH: 16, roof: '#30343c', glow: 0.4, rough: 0.25, metal: 0.6 })
  const round = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 250, 24).translate(0, 125, 0), blue)
  round.position.set(-610, 0, 260)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(22.5, 1.2, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb36b').multiplyScalar(1.6), toneMapped: false }))
  ring.position.set(-610, 247, 260)
  const stepped = new THREE.Group()
  stepped.position.set(-820, 0, 40)
  for (const [w, h0, h1] of [[40, 0, 150], [30, 150, 205], [20, 205, 240], [10, 240, 262]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h1 - h0, w).translate(0, (h0 + h1) / 2, 0), glass)
    stepped.add(b)
  }
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.2, 40, 6).translate(0, 282, 0), new THREE.MeshStandardMaterial({ color: '#c9c9cf', metalness: 0.8, roughness: 0.3 }))
  stepped.add(spire)
  const slant = new THREE.Mesh(new THREE.BoxGeometry(36, 210, 36, 1, 1, 1).translate(0, 105, 0), blue)
  const sp = slant.geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) > 200) sp.setY(i, sp.getY(i) + (sp.getX(i) > 0 ? 30 : 0))
  slant.geometry.computeVertexNormals()
  slant.position.set(-520, 0, -60)
  lm.add(round, ring, stepped, slant)
  kit.group.add(lm)

  // Mid-rise blocks along the downtown streets.
  const fac = [facadeTexture('brick', 4), facadeTexture('glass', 5), facadeTexture('stucco', 6)]
  kit.along(26, 6, (x, y, z, yaw, s) => {
    if (t.heightAtS(s) < -1.5 || rnd() < 0.15) return
    const w = 18 + rnd() * 10, d = 18 + rnd() * 16
    const off = d / 2
    const cx = x - Math.sin(yaw) * off, cz = z - Math.cos(yaw) * off
    if (!kit.fits(cx, cz, yaw, w, d, 3)) return
    mids.push([cx, y - 2, cz, yaw, w, 12 + rnd() * 34, d, Math.floor(rnd() * 3)])
  }, { clear: 3 })
  fac.forEach((tex, k) => {
    const list = mids.filter((m) => m[7] === k)
    kit.instances(unitBox(), facadeMat(tex, { tileW: 16, tileH: 14, roof: '#55514c', glow: 0.35 }), list)
  })
}

/** Lattice pylons along the far bank of the river, with sagging lines between them. */
function pylons(kit: Kit) {
  const geo = pylonGeometry(36)
  const list: number[][] = []
  for (const pts of [NORTH, SOUTH]) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1]
      const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len
      for (let u = 60; u < len; u += 170) {
        const x = ax + ((bx - ax) * u) / len + nx * 46, z = az + ((bz - az) * u) / len + nz * 46
        if (kit.clearance(x, z) > 12) list.push([x, kit.heightAt(x, z), z, Math.atan2(bx - ax, bz - az)])
      }
    }
  }
  kit.instances(geo, vcMat(0.6, 0.5), list)
  const line: number[] = []
  for (let k = 0; k < list.length - 1; k++) {
    const [ax, ay, az] = list[k], [bx, by, bz] = list[k + 1]
    if (Math.hypot(bx - ax, bz - az) > 260) continue
    for (const off of [-7, 7]) {
      for (let q = 0; q < 12; q++) {
        const f0 = q / 12, f1 = (q + 1) / 12
        const sag = (f: number) => Math.sin(f * Math.PI) * 5
        line.push(ax + (bx - ax) * f0 + off * 0.2, ay + 32 - sag(f0) + (by - ay) * f0, az + (bz - az) * f0 + off)
        line.push(ax + (bx - ax) * f1 + off * 0.2, ay + 32 - sag(f1) + (by - ay) * f1, az + (bz - az) * f1 + off)
      }
    }
  }
  const lg = new THREE.BufferGeometry()
  lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3))
  kit.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#3a3536' })))
}
