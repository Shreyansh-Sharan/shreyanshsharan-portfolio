// Pier & Promenade: an English seaside town under a grey-blue sky. A long promenade straight above a pebble beach
// with beach huts and groynes, a pier with a funfair at the end (big wheel, helter-skelter, domed pavilion), the
// skeleton of an old pier out in the sea, white terraces with bay windows, a run through a glass-roofed covered
// market arcade, and a short cut through the narrow lanes. Original layout and buildings.
import * as THREE from 'three'
import { facadeMat, unitBox, type Kit } from './circuits'
import { facadeTexture, groundDetailTexture, pavingTexture, pebbleTexture, signTexture, stripeTexture, tarmacTexture } from './paint'
import { archGeometry, merge, tint, vcMat, victorianLamp } from './props3d'

const SHORE = 512 // promenade edge; the beach falls away to the sea beyond
const PIER_X = 80

const town = (z: number) => 1 + 11 * (1 - THREE.MathUtils.smoothstep(z, 230, 470))
const beach = (z: number) => THREE.MathUtils.lerp(1, -3.4, THREE.MathUtils.smoothstep(z, SHORE + 3, 612))

export function buildPier(kit: Kit) {
  const t = kit.track
  const rnd = kit.rnd

  kit.ground({
    base: (_x, z) => (z > SHORE ? beach(z) : town(z) + Math.max(0, 120 - z) * 0.04),
    color: (x, z, y, d, _h, out) => {
      const n = Math.sin(x * 0.06 + Math.sin(z * 0.04) * 2) * 0.5 + 0.5
      if (z > SHORE + 2) out.set(y < -0.5 ? '#6f6a60' : '#9b958a').multiplyScalar(0.92 + n * 0.1)
      else if (d < 6 || d > 1e5) out.set('#a7a49e')
      else out.set('#7e8a62').lerp(new THREE.Color('#a39f97'), THREE.MathUtils.smoothstep(n, 0.3, 0.7))
    },
    detail: groundDetailTexture(),
    detailScale: 7,
  })

  // Pebbles over the beach, and the sea.
  const pg = new THREE.PlaneGeometry(1500, 130, 150, 13).rotateX(-Math.PI / 2)
  const pp = pg.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i) - 150, z = pp.getZ(i) + SHORE + 67
    pp.setXYZ(i, x, kit.heightAt(x, z) + 0.06, z)
  }
  pg.computeVertexNormals()
  const pebbles = pebbleTexture()
  pebbles.repeat.set(300, 26)
  kit.group.add(new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: pebbles, roughness: 0.95, color: '#d8d2c8' })))
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(7000, 3200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4e6b74', roughness: 0.16, metalness: 0.3 }))
  sea.position.set(0, -1.1, SHORE + 1650)
  kit.group.add(sea)

  // Tarmac with double yellow lines along the edges and white centre dashes.
  kit.road({
    map: tarmacTexture(), scale: 6, color: '#77777b', roughness: 0.75,
    edgeLine: [0.98, 0.8, 0.12], doubleEdge: true, centre: 'dash', centreColor: [0.95, 0.95, 0.93], kerb: null, glow: [0.05, 0.12, 0.13],
  })
  kit.gantry('#5eead4')

  // Barriers: turquoise seafront railings on the promenade's sea side, kerbs everywhere else.
  const railMat = new THREE.MeshStandardMaterial({ color: '#2aa198', roughness: 0.45, metalness: 0.4 })
  const kerbMat = new THREE.MeshStandardMaterial({ map: pavingTexture(190), color: '#d2cfc8', roughness: 0.9 })
  kit.barriers((e) => (e.road < 0 && (e.ay + e.by) / 2 < 2.2 && e.nz > 0.6 ? 'railing' : 'kerb'), { railing: railMat, kerb: kerbMat, stone: kerbMat })
  // Black bollards up in the town, white posts with red reflectors along the seafront.
  kit.roadside({ post: '#20201f', reflector: '#d8c27a', step: 8, bollard: true, where: (s) => t.heightAtS(s) >= 2.2 })
  kit.roadside({ post: '#efefea', reflector: '#ff4a3d', step: 10, where: (s) => t.heightAtS(s) < 2.2 })

  // Victorian lamps along the promenade, plain ones up in the town.
  const prom: number[][] = []
  const townLamps: number[][] = []
  kit.along(24, 0.9, (x, y, z, yaw, s, side) => {
    if (t.heightAtS(s) < 2.2) prom.push([x, y, z, yaw + Math.PI / 2])
    else if ((Math.round(s / 24) % 2 ? 1 : -1) === side) townLamps.push([x, y, z, yaw + Math.PI / 2])
  }, { clear: 0.4 })
  const [post, lanterns] = victorianLamp('#1d5f5b')
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.0, 1.6), toneMapped: false })
  kit.instances(post, vcMat(0.5, 0.4), [...prom, ...townLamps])
  kit.instances(lanterns, glow, [...prom, ...townLamps])

  terraces(kit)
  arcade(kit)
  const wheel = pierAndFair(kit)
  seaside(kit)

  // The clock tower at a town junction.
  const s10 = t.s[t.nearest(-30, 200).i]
  for (const side of [1, -1]) {
    const p = t.point(s10, side * (t.halfAt(s10) + 9))
    if (kit.clearance(p.x, p.z) > 6) {
      kit.propInstances('clock-tower', { height: 21 }, [[p.x, t.heightAtS(s10) - 0.3, p.z, 0]])
      break
    }
  }
  void rnd
  return wheel
}

/** White Regency terraces facing the sea along the promenade, with bay windows; houses up in the town and the lanes. */
function terraces(kit: Kit) {
  const t = kit.track
  const rnd = kit.rnd
  const white: number[][] = []
  const bays: number[][] = []
  const town: number[][][] = [[], []]
  const place = (list: number[][], x: number, y: number, z: number, yaw: number, off: number, w: number, d: number, h: number) => {
    const cx = x - Math.sin(yaw) * (off + d / 2), cz = z - Math.cos(yaw) * (off + d / 2)
    if (!kit.fits(cx, cz, yaw, w, d, 0.9)) return false
    list.push([cx, y - 3, cz, yaw, w, h + 3, d])
    return true
  }
  kit.along(26, 0, (x, y, z, yaw, s) => {
    const prom = t.heightAtS(s) < 2.2
    if (prom && Math.cos(yaw) > 0.5) {
      // Landward side of the promenade: a long terrace, bay windows on its face.
      const h = 19 + rnd() * 3
      if (place(white, x, y, z, yaw, 8, 26, 16, h)) {
        for (let k = -1; k <= 1; k++) {
          const fx = x - Math.sin(yaw) * 7.2 + Math.cos(yaw) * k * 8, fz = z - Math.cos(yaw) * 7.2 - Math.sin(yaw) * k * 8
          bays.push([fx, y, fz, yaw, 4, h * 0.62, 1.8])
        }
      }
    } else if (!prom) place(town[rnd() < 0.55 ? 0 : 1], x, y, z, yaw, 2.4, 22 + rnd() * 4, 14, 11 + rnd() * 7)
  }, { clear: -1 })
  kit.alongBranches(11, 0, (x, y, z, yaw) => place(town[1], x, y, z, yaw, 1.4, 10, 10, 8 + rnd() * 4), -1)
  const regency = facadeMat(facadeTexture('regency', 31), { tileW: 16, tileH: 18, roof: '#5d6168', glow: 0.25, tint: '#cfccc4' })
  kit.instances(unitBox(), regency, white)
  kit.instances(unitBox(), regency, bays)
  kit.instances(unitBox(), facadeMat(facadeTexture('regency', 32), { tileW: 16, tileH: 18, roof: '#5d6168', glow: 0.25, tint: '#d6cbbd' }), town[0])
  kit.instances(unitBox(), facadeMat(facadeTexture('brick', 33), { tileW: 16, tileH: 14, roof: '#4f4b48', glow: 0.25 }), town[1])
  // Cornices and black balcony rails along the terraces.
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ color: '#dedbd4', roughness: 0.7 }), white.map(([x, y, z, yaw, w, h, d]) => [x, y + h - 0.2, z, yaw, w + 0.6, 0.8, d + 0.6]))
}

/** The covered market: iron arches and a glass barrel roof over the road, shopfronts with awnings each side. */
function arcade(kit: Kit) {
  const t = kit.track
  const sA = t.s[t.nearest(-250, 230).i], sB = t.s[t.nearest(-120, 230).i]
  const iron: THREE.BufferGeometry[] = []
  const shops: number[][] = []
  const awnings: number[][] = []
  const lamps: number[][] = []
  const half = t.halfAt((sA + sB) / 2) + 3.2
  for (let s = sA - 4; s <= sB + 4; s += 6) {
    const i = t.index(s)
    const p = t.point(s)
    const g = archGeometry(half * 2, 6, 0.45, 0.45, false)
    g.deleteAttribute('uv')
    g.rotateY(Math.atan2(t.tx[i], t.tz[i]))
    g.translate(p.x, t.py[i], p.z)
    iron.push(g)
    lamps.push([p.x, t.py[i] + 7.4, p.z, 0])
    for (const side of [-1, 1]) {
      const q = t.point(s, side * (half + 1.2))
      const yaw = Math.atan2(side * t.tz[i], -side * t.tx[i])
      shops.push([q.x, t.py[i] - 1, q.z, yaw, 6.1, 9, 3])
      const a = t.point(s, side * (half - 0.6))
      awnings.push([a.x, t.py[i] + 3.2, a.z, yaw, 5.6, 0.25, 1.6])
    }
  }
  kit.group.add(new THREE.Mesh(merge(iron.map((g) => (g.index ? g.toNonIndexed() : g))), new THREE.MeshStandardMaterial({ color: '#2c4a3f', metalness: 0.6, roughness: 0.4 })))
  // Glass barrel roof along the arcade.
  const mid = t.point((sA + sB) / 2), im = t.index((sA + sB) / 2)
  const len = sB - sA + 12
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(half + 0.2, half + 0.2, len, 24, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.85, 1),
    new THREE.MeshStandardMaterial({ color: '#cfe6ee', transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  )
  roof.rotation.y = Math.atan2(t.tx[im], t.tz[im]) + Math.PI / 2
  roof.position.set(mid.x, t.py[im] + 6, mid.z)
  kit.group.add(roof)
  kit.instances(unitBox(), facadeMat(facadeTexture('brick', 41), { tileW: 8, tileH: 9, roof: '#3a3634', glow: 0.6 }), shops)
  const colors = ['#c0392b', '#2471a3', '#d4ac0d', '#239b56', '#884ea0'].map((c) => new THREE.Color(c))
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ roughness: 0.8 }), awnings, awnings.map((_, k) => colors[k % colors.length]))
  kit.instances(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 1.6), toneMapped: false }), lamps)
  // Name boards over both entrances.
  const tex = signTexture(['MARKET ARCADE'], '#163a33', '#f3e7c9', 1024, 160)
  for (const s of [sA - 6, sB + 6]) {
    const i = t.index(s), p = t.point(s)
    kit.sign(tex, half * 1.6, 2.4, p.x, t.py[i] + 12.2, p.z, Math.atan2(t.tx[i], t.tz[i]) + Math.PI)
  }
}

/** The pier: deck on iron piles, railings and bulbs, a gateway, a domed pavilion, kiosks, the big wheel and a
 * helter-skelter. Returns the animation (the wheel turns). */
function pierAndFair(kit: Kit) {
  const g = kit.group
  const z0 = SHORE + 2, z1 = 940, W = 26, Y = 2.4
  const deckMat = new THREE.MeshStandardMaterial({ map: stripeTexture('#8a6f55', '#7a604a', 24, false), color: '#d9cbb8', roughness: 0.9 })
  ;(deckMat.map as THREE.Texture).repeat.set(1, 30)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.8, z1 - z0), deckMat)
  deck.position.set(PIER_X, Y - 0.4, (z0 + z1) / 2)
  g.add(deck)
  const piles: number[][] = []
  for (let z = z0 + 10; z < z1; z += 12) for (const x of [-11, -4, 4, 11]) piles.push([PIER_X + x, -7, z, 0, 0.7, Y + 6.6, 0.7])
  kit.instances(new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#33413a', metalness: 0.5, roughness: 0.6 }), piles)
  // Railings and a string of bulbs down both sides.
  const rails: number[][] = []
  const bulbs: number[][] = []
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) {
    rails.push([PIER_X + x, Y + 1.0, (z0 + z1) / 2, 0, 0.12, 0.12, z1 - z0])
    rails.push([PIER_X + x, Y + 0.5, (z0 + z1) / 2, 0, 0.08, 0.08, z1 - z0])
    for (let z = z0; z < z1; z += 3) {
      rails.push([PIER_X + x, Y, z, 0, 0.1, 1.1, 0.1])
      bulbs.push([PIER_X + x, Y + 1.6 + Math.sin(z * 0.5) * 0.05, z, 0])
    }
  }
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5 }), rails)
  const bulbCols = ['#ffe28a', '#ff8a8a', '#8ad0ff', '#a8ff9a'].map((c) => new THREE.Color(c).multiplyScalar(2.2))
  kit.instances(new THREE.SphereGeometry(0.18, 6, 4), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbs, bulbs.map((_, k) => bulbCols[k % 4]))
  // Gateway with the name board.
  const gate = merge([
    tint(new THREE.BoxGeometry(3, 9, 3).translate(-W / 2 + 1.5, Y + 4.5, z0 + 2), '#f4efe6'),
    tint(new THREE.BoxGeometry(3, 9, 3).translate(W / 2 - 1.5, Y + 4.5, z0 + 2), '#f4efe6'),
    tint(new THREE.BoxGeometry(W, 2.6, 2).translate(0, Y + 10, z0 + 2), '#f4efe6'),
    tint(new THREE.SphereGeometry(1.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(-W / 2 + 1.5, Y + 9, z0 + 2), '#7fb7b0'),
    tint(new THREE.SphereGeometry(1.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(W / 2 - 1.5, Y + 9, z0 + 2), '#7fb7b0'),
  ])
  const gm = new THREE.Mesh(gate, vcMat(0.6))
  gm.position.x = PIER_X
  g.add(gm)
  kit.sign(signTexture(['THE PIER'], '#123a5c', '#ffe9a8', 768, 160), W - 4, 2.2, PIER_X, Y + 10, z0 + 0.9, Math.PI, 1.4)
  // Domed pavilion, then kiosks with striped roofs.
  const pav = merge([
    tint(new THREE.BoxGeometry(22, 8, 34).translate(0, Y + 4, 610), '#f6f2ea'),
    tint(new THREE.SphereGeometry(6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, Y + 8, 610), '#8fc1ba'),
    tint(new THREE.CylinderGeometry(0.2, 0.2, 5, 6).translate(0, Y + 16, 610), '#d4af37'),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => tint(new THREE.SphereGeometry(2.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(sx * 9, Y + 8, 610 + sz * 14), '#8fc1ba'))),
  ])
  const pm = new THREE.Mesh(pav, vcMat(0.6))
  pm.position.x = PIER_X
  g.add(pm)
  const kiosks: number[][] = []
  const roofs: number[][] = []
  for (let z = 650; z < 900; z += 34) {
    if (Math.abs(z - 740) < 20) continue
    for (const x of [-8, 8]) {
      kiosks.push([PIER_X + x, Y, z, 0, 5, 3.2, 5])
      roofs.push([PIER_X + x, Y + 3.2, z, Math.PI / 4, 1, 1, 1])
    }
  }
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.7 }), kiosks)
  const stripes = stripeTexture('#e8463a', '#f8f4ec', 10, false)
  kit.instances(new THREE.ConeGeometry(4.2, 2.2, 4).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }), roofs)

  // Helter-skelter: a striped tower wrapped in a spiral slide.
  const hs = new THREE.Group()
  hs.position.set(PIER_X + 6, Y, 880)
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 17, 16).translate(0, 8.5, 0), new THREE.MeshStandardMaterial({ map: stripeTexture('#d6362e', '#fbf6ee', 6, true), roughness: 0.6 }))
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.4, 4.5, 16).translate(0, 19.2, 0), new THREE.MeshStandardMaterial({ color: '#d6362e', roughness: 0.6 }))
  const helix = new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, k) => new THREE.Vector3(Math.cos(k * 0.42) * 4.6, 16.5 - k * 0.26, Math.sin(k * 0.42) * 4.6)))
  const slide = new THREE.Mesh(new THREE.TubeGeometry(helix, 160, 0.75, 6), new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5 }))
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3).translate(1.1, 0, 0), new THREE.MeshStandardMaterial({ color: '#2b6cb0', side: THREE.DoubleSide }))
  flag.position.y = 22.6
  hs.add(tower, cap, slide, flag)
  g.add(hs)

  // The big wheel: rims, spokes and gondolas that stay upright as it turns. Its face looks along the promenade.
  const R = 30, hub = new THREE.Vector3(PIER_X, Y + R + 4, 740)
  const wheel = new THREE.Group()
  wheel.position.copy(hub)
  const white = new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.4, metalness: 0.3 })
  const rimParts: THREE.BufferGeometry[] = []
  for (const x of [-1.6, 1.6]) {
    rimParts.push(new THREE.TorusGeometry(R, 0.28, 6, 64).rotateY(Math.PI / 2).translate(x, 0, 0).toNonIndexed())
    for (let k = 0; k < 16; k++) rimParts.push(new THREE.BoxGeometry(0.16, R * 2, 0.16).rotateX((k / 16) * Math.PI).translate(x, 0, 0).toNonIndexed())
  }
  rimParts.push(new THREE.CylinderGeometry(0.9, 0.9, 4.2, 12).rotateZ(Math.PI / 2).toNonIndexed())
  const rim = new THREE.Mesh(merge(rimParts.map((p) => (p.deleteAttribute('uv'), p))), white)
  wheel.add(rim)
  g.add(wheel)
  const legs = merge(
    [-1, 1].flatMap((sx) => [-1, 1].map((sz) => {
      const len = Math.hypot(R + 4, 12)
      return tint(new THREE.BoxGeometry(1.0, len, 1.0).translate(0, -len / 2, 0).rotateX(sz * Math.atan2(12, R + 4)).translate(sx * 3.4, 0, 0), '#e9e9e4')
    })),
  )
  const lm = new THREE.Mesh(legs, vcMat(0.5, 0.3))
  lm.position.copy(hub)
  g.add(lm)
  const N = 16
  const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 2.8, 2.6).translate(0, -1.6, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), N)
  const pal = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'].map((c) => new THREE.Color(c))
  for (let k = 0; k < N; k++) cars.setColorAt(k, pal[k % 4])
  g.add(cars)
  const m = new THREE.Matrix4()
  const turn = (time: number) => {
    const a0 = time * 0.12
    wheel.rotation.x = a0
    for (let k = 0; k < N; k++) {
      const a = a0 + (k / N) * Math.PI * 2
      m.makeTranslation(hub.x, hub.y + Math.cos(a) * R, hub.z - Math.sin(a) * R)
      cars.setMatrixAt(k, m)
    }
    cars.instanceMatrix.needsUpdate = true
  }
  turn(0)
  cars.computeBoundingSphere()
  return (time: number) => turn(time)
}

/** Beach huts, groynes, and the iron skeleton of an old pier out in the sea. */
function seaside(kit: Kit) {
  const rnd = kit.rnd
  const huts: number[][] = []
  const hutCols: THREE.Color[] = []
  const pastel = ['#f6a5a5', '#a5d8f6', '#f6e7a5', '#b5f2c2', '#d7b5f6', '#ffffff', '#f6c7a5'].map((c) => new THREE.Color(c))
  for (let x = -660; x < -420; x += 3.4) {
    const z = SHORE + 9
    if (kit.clearance(x, z) < 3) continue
    huts.push([x, kit.heightAt(x, z) - 0.2, z, Math.PI, 2.8, 2.7, 2.6])
    hutCols.push(pastel[Math.floor(rnd() * pastel.length)])
  }
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ roughness: 0.7 }), huts, hutCols)
  kit.instances(new THREE.ConeGeometry(2.2, 1.2, 4).rotateY(Math.PI / 4).scale(1, 1, 1).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: '#c7c2b8', roughness: 0.8 }), huts.map(([x, y, z, yaw, , h]) => [x, y + h, z, yaw]))
  const groynes: number[][] = []
  for (let x = -680; x < 520; x += 75) {
    if (Math.abs(x - PIER_X) < 30) continue
    groynes.push([x, -2.2, SHORE + 48, 0, 0.6, 3.2, 80])
  }
  kit.instances(unitBox(), new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 1 }), groynes)
  // The old pier: rows of rusted piles and the bare frame of its pavilion, cut off from the shore.
  const ox = -440, rust = new THREE.MeshStandardMaterial({ color: '#4a3a33', roughness: 0.9, metalness: 0.3 })
  const piles: number[][] = []
  for (let z = 650; z < 800; z += 9) for (const x of [-9, -3, 3, 9]) if (rnd() < 0.82) piles.push([ox + x, -6, z, 0, 0.5, 6 + rnd() * 3, 0.5])
  const frame: number[][] = []
  const fy = 3
  for (const [w, d] of [[30, 40]]) {
    for (const sx of [-1, 1]) for (let z = -d / 2; z <= d / 2; z += 5) frame.push([ox + (sx * w) / 2, fy, 760 + z, 0, 0.35, 10, 0.35])
    for (const sz of [-1, 1]) for (let x = -w / 2; x <= w / 2; x += 5) frame.push([ox + x, fy, 760 + (sz * d) / 2, 0, 0.35, 10, 0.35])
    frame.push([ox, fy + 10, 760 - d / 2, 0, w, 0.4, 0.4], [ox, fy + 10, 760 + d / 2, 0, w, 0.4, 0.4], [ox - w / 2, fy + 10, 760, 0, 0.4, 0.4, d], [ox + w / 2, fy + 10, 760, 0, 0.4, 0.4, d])
    for (let k = -3; k <= 3; k++) frame.push([ox + k * 4, fy + 10, 760, 0, 0.3, 0.3 + (3 - Math.abs(k)) * 1.6, d])
  }
  frame.push([ox, fy - 0.4, 760, 0, 32, 0.5, 44])
  kit.instances(unitBox(), rust, [...piles, ...frame])
}
