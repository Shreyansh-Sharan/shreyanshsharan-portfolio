// The four corners of the Loft, built from primitives at toy scale: the Disco Closet (a wardrobe nightclub),
// the Houseplant Jungle, Bathtub Beach and the Cardboard Arcade. Static pieces are batched per material; the
// few moving bits come back as small update hooks. The hidden games add their own interactive parts.
import * as THREE from 'three'
import type { LevelCtx } from '../../engine/types'
import { textSprite } from '../../engine/helpers'
import { Batch, ctex, G, glowTex, keepMat, T, tmat } from './kit'
import { ARCADE, BEACH, DISCO, JUNGLE } from './layout'

export interface Decor {
  /** Every frame on every screen: t = Loft clock, beat = 0..1 pulse from the disco. */
  update(t: number, dt: number, beat: number): void
}

const PI = Math.PI

/* ---------- Textures ---------- */

function woodTex() {
  return ctex('wood', 128, 128, (g, w, h) => {
    g.fillStyle = '#8a5a36'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = i % 3 ? 'rgba(60,32,16,0.25)' : 'rgba(255,220,170,0.12)'
      g.lineWidth = 1 + (i % 4)
      g.beginPath()
      const y = (i * 37) % h
      g.moveTo(0, y)
      g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2)
      g.stroke()
    }
  }, [1, 1])
}

function cardboardTex() {
  return ctex('cardboard', 128, 128, (g, w, h) => {
    g.fillStyle = '#c99a62'
    g.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 6) {
      g.fillStyle = 'rgba(120,80,40,0.12)'
      g.fillRect(x, 0, 2, h)
    }
    g.fillStyle = 'rgba(230,200,140,0.55)'
    g.fillRect(0, h * 0.42, w, 16)
    g.fillStyle = 'rgba(90,60,30,0.35)'
    g.font = 'bold 14px sans-serif'
    g.fillText('THIS SIDE UP ↑', 8, 24)
    g.fillText('FRAGILE', 70, 110)
  })
}

function sockTex(a: string, b: string) {
  return ctex(`sock:${a}:${b}`, 64, 64, (g, w, h) => {
    g.fillStyle = a
    g.fillRect(0, 0, w, h)
    g.fillStyle = b
    for (let i = 0; i < 4; i++) g.fillRect(0, i * 16, w, 8)
    g.fillStyle = 'rgba(255,255,255,0.18)'
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h)
  }, [2, 1])
}

/* ---------- Disco Closet ---------- */

export function buildDisco(ctx: LevelCtx): Decor {
  const root = ctx.root
  const high = ctx.quality === 'high'
  const W = DISCO.wardrobe
  const b = new Batch()
  const wood = tmat('wood', woodTex())
  const x0 = W.x - W.w / 2, x1 = W.x + W.w / 2, zb = W.z - W.d / 2, zf = W.z + W.d / 2
  // Carcass: back, sides, top, base, with a crown moulding.
  b.addMat(G.box, wood, T(W.x, W.h / 2, zb + 0.1, 0, 0, 0, W.w, W.h, 0.2), 'wood')
  for (const x of [x0 + 0.15, x1 - 0.15]) b.addMat(G.box, wood, T(x, W.h / 2, W.z, 0, 0, 0, 0.3, W.h, W.d), 'wood')
  b.addMat(G.box, wood, T(W.x, W.h - 0.15, W.z, 0, 0, 0, W.w + 0.3, 0.3, W.d + 0.25), 'wood')
  b.addMat(G.box, wood, T(W.x, 0.15, W.z, 0, 0, 0, W.w, 0.3, W.d), 'wood')
  b.add(G.box, '#5b3a22', T(W.x, W.h + 0.05, W.z, 0, 0, 0, W.w + 0.5, 0.12, W.d + 0.45))
  // Doors swung wide, one with a long mirror inside.
  for (const [sx, x] of [[-1, x0], [1, x1]] as const) {
    const dx = x + sx * 1.45 * Math.cos(0.35), dz = zf + 1.45 * Math.sin(0.35) + 0.2
    b.addMat(G.box, wood, T(dx, W.h / 2, dz, 0, sx * 0.35 + (sx < 0 ? PI : 0), 0, 3, W.h - 0.4, 0.14), 'wood')
    b.add(G.sphere, '#d4a017', T(dx + sx * 1.2 * Math.cos(0.35), 2.4, dz + 0.25, 0, 0, 0, 0.16), 'metal')
    if (sx > 0) b.add(G.box, '#dbeafe', T(dx - 0.05, W.h / 2, dz - 0.1, 0, -0.35 + PI, 0, 2.2, W.h - 1.4, 0.03), 'gloss')
  }
  // Interior: rail, hangers with clothes, the coat-hanger balcony and a shoebox step.
  const B = DISCO.balcony
  b.add(G.cyl, '#cbd5e1', T(W.x, 4.6, W.z - 0.2, 0, 0, PI / 2, 0.1, W.w - 0.5, 0.1), 'metal')
  const clothes = ['#f472b6', '#60a5fa', '#facc15', '#a78bfa', '#34d399', '#fb923c', '#f87171']
  for (let i = 0; i < 9; i++) {
    const x = x0 + 0.7 + i * ((W.w - 1.4) / 8)
    // Wire hanger: hook and shoulders.
    b.add(G.torus, '#e5e7eb', T(x, 4.62, W.z - 0.2, 0, PI / 2, 0, 0.16, 0.16, 0.5), 'metal')
    b.add(G.cyl6, '#e5e7eb', T(x, 4.32, W.z - 0.2, 0, 0, PI / 2, 0.03, 0.75, 0.03), 'metal')
    if (i % 2 === 0) b.add(G.box, clothes[i % clothes.length], T(x, 3.55, W.z - 0.35, 0, 0, 0, 0.62, 1.5, 0.12))
    // Wires down to the balcony plank.
    b.add(G.cyl6, '#9ca3af', T(x, (4.3 + B.y) / 2, B.z1 - 0.15, 0, 0, 0, 0.025, 4.3 - B.y, 0.025), 'metal')
  }
  b.addMat(G.box, wood, T((B.x0 + B.x1) / 2, B.y - 0.08, (B.z0 + B.z1) / 2, 0, 0, 0, B.x1 - B.x0, 0.16, B.z1 - B.z0), 'wood')
  ctx.phys.box({ x: (B.x0 + B.x1) / 2, y: B.y - 0.08, z: (B.z0 + B.z1) / 2 }, { x: (B.x1 - B.x0) / 2, y: 0.08, z: (B.z1 - B.z0) / 2 })
  const S = DISCO.step
  b.add(G.box, '#ef4444', T(S.x, S.h / 2, S.z, 0, 0, 0, 1.4, S.h, 0.9))
  b.add(G.box, '#fef3c7', T(S.x, S.h + 0.02, S.z, 0, 0, 0, 1.45, 0.06, 0.95))
  ctx.phys.box({ x: S.x, y: S.h / 2, z: S.z }, { x: 0.7, y: S.h / 2, z: 0.45 })
  // Colliders: back, sides, top (the doors are decor).
  ctx.phys.box({ x: W.x, y: W.h / 2, z: zb + 0.1 }, { x: W.w / 2, y: W.h / 2, z: 0.1 })
  for (const x of [x0 + 0.15, x1 - 0.15]) ctx.phys.box({ x, y: W.h / 2, z: W.z }, { x: 0.15, y: W.h / 2, z: W.d / 2 })
  // Matchbox speakers either side of the floor.
  const F = DISCO.floor
  const half = (F.n * F.tile) / 2
  const speakers: THREE.Vector3[] = [new THREE.Vector3(F.x - half - 0.9, 0, F.z + 1), new THREE.Vector3(F.x + half + 0.9, 0, F.z + 1.5)]
  for (const p of speakers) {
    b.add(G.box, '#1f2937', T(p.x, 1.1, p.z, 0, 0, 0, 1.1, 2.2, 0.9))
    ctx.phys.box({ x: p.x, y: 1.1, z: p.z }, { x: 0.55, y: 1.1, z: 0.45 })
  }
  b.flush(root, { key: 'disco' })

  // Speaker cones pulse with the beat.
  const coneMat = keepMat('l:cone', () => new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.5, flatShading: true }))
  const cones: THREE.Mesh[] = []
  for (const p of speakers)
    for (const [y, r] of [[1.55, 0.36], [0.6, 0.22]] as const) {
      const c = new THREE.Mesh(G.cone, coneMat)
      c.rotation.x = -PI / 2
      c.position.set(p.x, y, p.z + 0.46)
      c.scale.set(r * 2, 0.25, r * 2)
      c.userData.r = r
      root.add(c)
      cones.push(c)
    }

  // The foil mirror ball: a crumpled icosahedron, hung from the roof, with glints sweeping the floor.
  const ballGeo = new THREE.IcosahedronGeometry(0.85, 2)
  const pos = ballGeo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + Math.sin(i * 12.9898) * 0.04
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k)
  }
  ballGeo.computeVertexNormals()
  const ball = new THREE.Mesh(ballGeo, keepMat('l:foil', () => new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 1, roughness: 0.18, flatShading: true, envMapIntensity: 1.6 })))
  ball.position.set(F.x, DISCO.ballY, F.z)
  ball.castShadow = true
  root.add(ball)
  const string = new THREE.Mesh(G.cyl6, keepMat('l:string', () => new THREE.MeshBasicMaterial({ color: '#d6d3d1' })))
  const roofY = 4 + 16 * (1 - Math.abs(F.x) / 18)
  string.scale.set(0.02, roofY - DISCO.ballY, 0.02)
  string.position.set(F.x, (roofY + DISCO.ballY) / 2, F.z)
  root.add(string)
  const glintMat = keepMat('l:glint', () => new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: '#fff5d6' }))
  const glints = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2), glintMat, high ? 28 : 12)
  glints.frustumCulled = false
  root.add(glints)
  const gm = new THREE.Matrix4()

  // Sweeping spotlights from the wardrobe top (additive cones), high quality only.
  const spots: THREE.Mesh[] = []
  if (high) {
    const beamTex = ctex('beam', 4, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h)
      gr.addColorStop(0, 'rgba(255,255,255,0.6)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
    })
    const beamGeo = new THREE.CylinderGeometry(0.08, 1.1, 6, 16, 1, true).translate(0, -3, 0)
    for (const [i, col] of ['#f472b6', '#22d3ee', '#facc15'].entries()) {
      const m = new THREE.Mesh(beamGeo, keepMat(`l:beam:${col}`, () => new THREE.MeshBasicMaterial({ map: beamTex, color: col, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })))
      m.position.set(x0 + 1 + i * 2, W.h + 0.2, zf)
      m.userData.i = i
      root.add(m)
      spots.push(m)
    }
  }
  const sign = textSprite('Disco Closet', { bg: '#701a75', size: 0.65 })
  sign.position.set(W.x, W.h + 0.9, zf)
  root.add(sign)

  return {
    update(t, _dt, beat) {
      ball.rotation.y = t * 0.6
      for (const c of cones) {
        const s = c.userData.r * 2 * (1 + beat * 0.18)
        c.scale.set(s, 0.25 + beat * 0.1, s)
      }
      const n = glints.count
      for (let i = 0; i < n; i++) {
        const a = t * 0.6 + (i / n) * PI * 2 * 3.7
        const r = 1 + ((i * 7) % 5) * 0.62
        const sz = 0.28 + ((i * 3) % 4) * 0.06
        gm.makeScale(sz, 1, sz).setPosition(F.x + Math.cos(a) * r, 0.1 + (i % 3) * 0.003, F.z + Math.sin(a) * r)
        glints.setMatrixAt(i, gm)
      }
      glints.instanceMatrix.needsUpdate = true
      for (const s of spots) {
        const i = s.userData.i as number
        s.rotation.set(0.55 + Math.sin(t * 0.7 + i * 2) * 0.35, 0, Math.sin(t * 0.9 + i) * 0.5)
      }
    },
  }
}

/* ---------- Houseplant Jungle ---------- */

function leafGeo() {
  // A heart-shaped monstera-ish leaf on the xz plane, tip towards +z, a little cupped.
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.bezierCurveTo(0.55, 0.15, 0.6, 0.8, 0, 1.25)
  s.bezierCurveTo(-0.6, 0.8, -0.55, 0.15, 0, 0)
  const g = new THREE.ShapeGeometry(s, 6)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i)
    p.setXYZ(i, x, Math.abs(x) * 0.25 - y * y * 0.08, y)
  }
  g.computeVertexNormals()
  return g
}

export function buildJungle(ctx: LevelCtx): Decor {
  const root = ctx.root
  const R = JUNGLE.ring
  const b = new Batch()
  const terracotta = '#c2410c'
  // Raised planter bed (you fall into it) with a terracotta rim, and the big pot in the middle.
  b.add(G.cyl24, '#5b3a1e', T(R.x, JUNGLE.bed.h / 2, R.z, 0, 0, 0, JUNGLE.bed.r * 2, JUNGLE.bed.h, JUNGLE.bed.r * 2))
  b.add(new THREE.TorusGeometry(JUNGLE.bed.r, 0.16, 6, 40), terracotta, T(R.x, JUNGLE.bed.h, R.z, PI / 2))
  // Moss and pebbles on the soil.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * PI * 2 + 0.3
    const r = 2 + (i % 4) * 0.6
    b.add(G.ico, i % 3 ? '#65a30d' : '#a8a29e', T(R.x + Math.cos(a) * r, JUNGLE.bed.h, R.z + Math.sin(a) * r, 0, a, 0, i % 3 ? 0.5 : 0.22, i % 3 ? 0.08 : 0.14, i % 3 ? 0.4 : 0.2))
  }
  ctx.phys.cylinder({ x: R.x, y: JUNGLE.bed.h / 2, z: R.z }, JUNGLE.bed.h / 2, JUNGLE.bed.r)
  const P = JUNGLE.pot
  const pot = new THREE.LatheGeometry([new THREE.Vector2(0.75, 0), new THREE.Vector2(1, 0.75), new THREE.Vector2(1, 0.88), new THREE.Vector2(0.92, 0.9), new THREE.Vector2(0.92, 0.82)], 20)
  b.add(pot, terracotta, T(R.x, JUNGLE.bed.h, R.z, 0, 0, 0, P.r, P.h, P.r))
  b.add(G.cyl24, '#3f2a17', T(R.x, JUNGLE.bed.h + P.h * 0.8, R.z, 0, 0, 0, P.r * 1.8, 0.06, P.r * 1.8))
  ctx.phys.cylinder({ x: R.x, y: (JUNGLE.bed.h + P.h) / 2, z: R.z }, (JUNGLE.bed.h + P.h) / 2, P.r)
  // Bamboo stake, hoop and spokes the vines hang from.
  const top = R.anchorY
  b.add(G.cyl6, '#a3b14b', T(R.x, top / 2 + 0.3, R.z, 0, 0, 0, 0.16, top, 0.16))
  b.add(new THREE.TorusGeometry(R.r, 0.07, 5, 48), '#b5c25a', T(R.x, top, R.z, PI / 2))
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + 0.3
    b.add(G.cyl6, '#a3b14b', T(R.x + Math.cos(a) * R.r * 0.5, top, R.z + Math.sin(a) * R.r * 0.5, 0, -a, PI / 2, 0.08, R.r, 0.08))
  }
  for (let k = 0; k < 6; k++) b.add(G.torus, '#8a9a3a', T(R.x, 1 + k * 0.8, R.z, PI / 2, 0, 0, 0.32, 0.32, 0.6))
  // The monstera in the big pot: stems and broad leaves.
  const leaf = leafGeo()
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2 + 0.2
    // Kept inside the hoop and below the vines' leaves, so swingers stay in view.
    const h = 1.1 + (i % 3) * 0.5
    const len = 0.95 + (i % 3) * 0.2
    b.add(G.cyl6, '#4d7c0f', T(R.x + Math.cos(a) * 0.35, JUNGLE.bed.h + P.h * 0.8 + h / 2, R.z + Math.sin(a) * 0.35, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3, 0.07, h, 0.07))
    b.add(leaf, i % 2 ? '#2f7d3f' : '#3f9b4f', T(R.x + Math.cos(a) * 0.75, JUNGLE.bed.h + P.h * 0.8 + h, R.z + Math.sin(a) * 0.75, -0.35, PI / 2 - a, 0, len * 1.4, len * 1.4, len * 1.4))
  }
  // Potted plants round the edge: pots with leaf clusters (cones and leaves).
  const spots: [number, number, number][] = [[16.2, -15.4, 0.9], [15.8, -6.6, 0.8], [9.3, -16.9, 0.7], [6.9, -11.2, 0.75], [17.0, -11.6, 0.7]]
  for (const [x, z, s] of spots) {
    b.add(pot, i2c(x), T(x, 0, z, 0, 0, 0, s, s * 1.3, s))
    ctx.phys.cylinder({ x, y: s * 0.6, z }, s * 0.6, s * 0.85)
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * PI * 2 + x
      b.add(leaf, k % 2 ? '#3f9b4f' : '#65a30d', T(x + Math.cos(a) * 0.2, s * 1.15 + 0.3 + (k % 3) * 0.2, z + Math.sin(a) * 0.2, -0.7 - (k % 3) * 0.15, PI / 2 - a, 0, s * 1.3, s * 1.3, s * 1.3))
    }
  }
  // Watering-can waterfall: a big can tipped on a crate, pouring into a saucer pond.
  const C = JUNGLE.can
  b.add(G.box, '#9a6b3f', T(C.x, 1.1, C.z, 0, 0.2, 0, 2.2, 2.2, 1.8))
  ctx.phys.box({ x: C.x, y: 1.1, z: C.z }, { x: 1.1, y: 1.1, z: 0.9 }, { rotY: 0.2 })
  const can = new THREE.Group()
  const canB = new Batch()
  canB.add(G.cyl, '#60a5fa', T(0, 0.8, 0, 0, 0, 0, 1.5, 1.6, 1.5), 'gloss')
  canB.add(G.cyl, '#3b82f6', T(0, 1.62, 0, 0, 0, 0, 1.3, 0.08, 1.3), 'gloss')
  canB.add(G.cyl, '#60a5fa', T(1.15, 1.25, 0, 0, 0, -1.0, 0.18, 1.7, 0.18), 'gloss')
  canB.add(G.cone, '#3b82f6', T(1.85, 1.75, 0, 0, 0, -1.0 - PI, 0.42, 0.4, 0.42), 'gloss')
  canB.add(G.torus, '#3b82f6', T(-0.75, 1.15, 0, 0, 0, 0.3, 1.2, 1.2, 1), 'gloss')
  canB.flush(can, { key: 'can' })
  can.position.set(C.x - 0.2, 2.2, C.z + 0.1)
  can.rotation.set(0, -0.95, -0.35)
  root.add(can)
  const Pd = JUNGLE.pond
  b.add(G.cyl24, '#e7e5e4', T(Pd.x, 0.12, Pd.z, 0, 0, 0, Pd.r * 2.2, 0.24, Pd.r * 2.2))
  ctx.phys.cylinder({ x: Pd.x, y: 0.12, z: Pd.z }, 0.12, Pd.r * 1.1)
  // Sock tents with a little glow at the door.
  const tents: [number, number, number, string, string][] = [[16.85, -17.3, -PI / 2, '#f87171', '#fff7ed'], [13.3, -17.3, -PI / 2 + 0.15, '#60a5fa', '#fde68a']]
  // A-frame tents: two sock panels leaning together, a rounded toe closing the back, a dark doorway.
  const lean = 1.0, side = 1.25
  for (const [x, z, ry, a, c] of tents) {
    const tm = tmat(`sock:${a}`, sockTex(a, c), { roughness: 1, side: THREE.DoubleSide })
    const base = T(x, 0, z, 0, ry, 0)
    for (const sx of [-1, 1])
      b.addMat(G.box, tm, base.clone().multiply(T(sx * 0.5 * side * Math.cos(lean), 0.5 * side * Math.sin(lean), 0, 0, 0, -sx * lean, side, 0.05, 2.1)), `sock:${a}`)
    b.add(G.sphere, a, base.clone().multiply(T(0, 0.35, -1.0, 0, 0, 0, 1.25, 1.0, 0.55)))
    b.add(G.box, '#3f2a17', base.clone().multiply(T(0, 0.33, 0.98, 0, 0, 0, 0.42, 0.62, 0.02)))
    b.add(G.cyl6, '#fde68a', base.clone().multiply(T(0, side * Math.sin(lean) + 0.05, 0, PI / 2, 0, 0, 0.05, 2.2, 0.05)))
    ctx.phys.box({ x, y: 0.5, z }, { x: 0.6, y: 0.5, z: 1.05 }, { rotY: ry })
  }
  b.flush(root, { key: 'jungle' })

  // The water ribbon (scrolling) and pond surface.
  const waterTex = ctex('stream', 32, 128, (g, w, h) => {
    g.fillStyle = 'rgba(147,197,253,0.65)'
    g.fillRect(0, 0, w, h)
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + (i % 3) * 0.15})`
      g.fillRect((i * 7) % w, (i * 23) % h, 2, 10 + (i % 4) * 6)
    }
  }, [1, 2])
  const streamMat = keepMat('l:stream', () => new THREE.MeshBasicMaterial({ map: waterTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
  const spout = new THREE.Vector3(1.85, 1.75, 0).applyEuler(can.rotation).add(can.position)
  const fall = new THREE.Vector3(Pd.x, 0.25, Pd.z)
  const len = spout.distanceTo(fall)
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, len, 8, 1, true), streamMat)
  stream.position.copy(spout).lerp(fall, 0.5)
  stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spout.clone().sub(fall).normalize())
  root.add(stream)
  const pondTex = ctex('pond', 64, 64, (g, w, h) => {
    g.fillStyle = '#7dd3fc'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(255,255,255,0.5)'
    for (let r = 6; r < 32; r += 7) {
      g.beginPath()
      g.arc(w / 2, h / 2, r, 0, PI * 2)
      g.stroke()
    }
  })
  const pond = new THREE.Mesh(new THREE.CircleGeometry(Pd.r * 1.02, 24).rotateX(-PI / 2), keepMat('l:pond', () => new THREE.MeshStandardMaterial({ map: pondTex, roughness: 0.1, transparent: true, opacity: 0.9 })))
  pond.position.set(Pd.x, 0.25, Pd.z)
  root.add(pond)
  const sign = textSprite('Houseplant Jungle', { bg: '#166534', size: 0.6 })
  sign.position.set(JUNGLE.start.x - 0.6, 3.1, JUNGLE.start.z + 0.6)
  root.add(sign)
  let splashT = 0
  return {
    update(t, dt) {
      waterTex.offset.y = -t * 1.6
      pond.rotation.y = t * 0.2
      splashT -= dt
      if (splashT <= 0) {
        splashT = 0.35
        ctx.fxLocal.puff({ x: Pd.x, y: 0.35, z: Pd.z }, 'milk', 3)
      }
    },
  }
}

const i2c = (x: number) => (Math.round(x) % 2 ? '#c2410c' : '#b45309')

/* ---------- Bathtub Beach ---------- */

function roundRect(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2 + r, -h / 2)
  s.lineTo(w / 2 - r, -h / 2)
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  s.lineTo(w / 2, h / 2 - r)
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  s.lineTo(-w / 2 + r, h / 2)
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  s.lineTo(-w / 2, -h / 2 + r)
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  return s
}

export function buildBeach(ctx: LevelCtx): Decor {
  const root = ctx.root
  const U = BEACH.tub
  const b = new Batch()
  // The clawfoot tub: rounded walls (an extruded ring), a rolled rim, gold claw feet; mint outside.
  const outer = roundRect(U.wid, U.len, 1.3)
  const inner = roundRect(U.wid - 0.36, U.len - 0.36, 1.12)
  outer.holes.push(inner)
  const wall = new THREE.ExtrudeGeometry(outer, { depth: U.h - 0.35, bevelEnabled: false, curveSegments: 6 }).rotateX(-PI / 2)
  b.add(wall, '#a7f3d0', T(U.x, 0.35, U.z), 'gloss')
  const basin = new THREE.ShapeGeometry(roundRect(U.wid - 0.3, U.len - 0.3, 1.15), 6).rotateX(-PI / 2)
  b.add(basin, '#f8fafc', T(U.x, 0.4, U.z), 'gloss')
  const pts = outer.getPoints(10).map((p) => new THREE.Vector3(p.x, 0, -p.y))
  const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 80, 0.16, 6, true)
  b.add(rim, '#f8fafc', T(U.x, U.h, U.z), 'gloss')
  for (const fx of [-1, 1])
    for (const fz of [-1, 1]) {
      const x = U.x + fx * (U.wid / 2 - 0.45), z = U.z + fz * (U.len / 2 - 0.7)
      b.add(G.sphere, '#d4a017', T(x, 0.3, z, 0, 0, 0, 0.55), 'metal')
      for (let k = 0; k < 3; k++) b.add(G.cone, '#d4a017', T(x + Math.cos(k * 2.1) * 0.25, 0.07, z + Math.sin(k * 2.1) * 0.25, PI / 2, 0, -k * 2.1, 0.14, 0.3, 0.14), 'metal')
    }
  // Tub colliders: four walls and a shallow water floor you can wade in.
  ctx.phys.box({ x: U.x - U.wid / 2 + 0.1, y: U.h / 2, z: U.z }, { x: 0.18, y: U.h / 2, z: U.len / 2 })
  ctx.phys.box({ x: U.x + U.wid / 2 - 0.1, y: U.h / 2, z: U.z }, { x: 0.18, y: U.h / 2, z: U.len / 2 })
  ctx.phys.box({ x: U.x, y: U.h / 2, z: U.z - U.len / 2 + 0.1 }, { x: U.wid / 2, y: U.h / 2, z: 0.18 })
  ctx.phys.box({ x: U.x, y: U.h / 2, z: U.z + U.len / 2 - 0.1 }, { x: U.wid / 2, y: U.h / 2, z: 0.18 })
  ctx.phys.box({ x: U.x, y: U.water / 2 - 0.25, z: U.z }, { x: U.wid / 2, y: U.water / 2 - 0.25, z: U.len / 2 })
  // Brass taps at the wall end.
  b.add(G.cyl, '#d4a017', T(U.x, U.h + 0.5, U.z + U.len / 2 - 0.2, 0, 0, 0, 0.16, 1, 0.16), 'metal')
  b.add(G.cyl, '#d4a017', T(U.x, U.h + 0.95, U.z + U.len / 2 - 0.45, PI / 2, 0, 0, 0.14, 0.6, 0.14), 'metal')
  for (const sx of [-1, 1]) b.add(G.torus, '#e5e7eb', T(U.x + sx * 0.4, U.h + 0.7, U.z + U.len / 2 - 0.2, 0, 0, 0, 0.3, 0.3, 0.8), 'metal')
  // Lifeguard tower of popsicle sticks, with a ring buoy.
  const D = BEACH.duck
  const stick = '#f5deb3'
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add(G.box, stick, T(D.x + sx * 0.5, 1.1, D.z + sz * 0.5, sz * 0.12, 0, -sx * 0.12, 0.14, 2.3, 0.05))
  for (let k = 0; k < 3; k++) b.add(G.box, stick, T(D.x, 0.5 + k * 0.6, D.z + 0.62, 0, 0, (k % 2 ? 1 : -1) * 0.5, 1.4, 0.12, 0.05))
  b.add(G.box, stick, T(D.x, 2.25, D.z, 0, 0, 0, 1.3, 0.1, 1.3))
  b.add(G.torus, '#ef4444', T(D.x, 1.2, D.z + 0.68, 0, 0, 0, 0.9, 0.9, 1.6))
  ctx.phys.box({ x: D.x, y: 1.15, z: D.z }, { x: 0.65, y: 1.15, z: 0.65 })
  // Towel sand with a cocktail umbrella and a sugar-cube castle.
  const Tw = BEACH.towel
  const towelTex = ctex('towel', 128, 128, (g, w, h) => {
    g.fillStyle = '#fde3a7'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#f9a8d4'
    for (let i = 0; i < 4; i++) g.fillRect(0, 10 + i * 32, w, 10)
    g.fillStyle = 'rgba(255,255,255,0.35)'
    for (let i = 0; i < 300; i++) g.fillRect((i * 53) % w, (i * 31) % h, 1, 1)
  })
  b.addMat(G.box, tmat('towel', towelTex, { roughness: 1 }), T(Tw.x, 0.04, Tw.z, 0, 0.25, 0, 4.2, 0.08, 3.1), 'towel')
  b.add(G.cyl6, '#fef3c7', T(Tw.x + 1, 1.2, Tw.z - 0.6, 0.05, 0, 0.1, 0.06, 2.4, 0.06))
  const umb = ctex('umbrella', 64, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#fff7ed' : '#22d3ee'
      g.beginPath()
      g.moveTo(w / 2, h / 2)
      g.arc(w / 2, h / 2, w, (i / 8) * PI * 2, ((i + 1) / 8) * PI * 2)
      g.fill()
    }
  })
  b.addMat(new THREE.ConeGeometry(1, 0.55, 8, 1, true), tmat('umb', umb, { side: THREE.DoubleSide }), T(Tw.x + 1.12, 2.5, Tw.z - 0.6, 0.05, 0, 0.1, 1.15, 0.8, 1.15), 'umb')
  for (let i = 0; i < 9; i++) b.add(G.box, '#fffbeb', T(Tw.x - 1 + (i % 3) * 0.32, 0.22 + Math.floor(i / 3) * 0.3, Tw.z + 0.6 + (i % 2) * 0.05, 0, 0.25, 0, 0.3, 0.3, 0.3))
  // The bowling lane: a bath mat runway with rolled-towel bumpers and a folded-towel backstop.
  const L = BEACH.lane
  const matTex = ctex('bathmat', 64, 256, (g, w, h) => {
    g.fillStyle = '#7dd3fc'
    g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(255,255,255,0.55)'
    for (let y = 6; y < h; y += 12) for (let x = 6 + ((y / 12) % 2) * 6; x < w; x += 12) g.fillRect(x - 2, y - 2, 4, 4)
    g.fillStyle = '#0ea5e9'
    g.fillRect(0, 0, 4, h)
    g.fillRect(w - 4, 0, 4, h)
  }, [1, 3])
  const lx = (L.x0 + L.x1) / 2, ll = L.x0 - L.x1
  b.addMat(G.box, tmat('bathmat', matTex, { roughness: 0.9 }), T(lx, 0.03, L.z, 0, PI / 2, 0, L.w, 0.06, ll), 'bathmat')
  for (const sz of [-1, 1]) {
    b.add(G.cyl, sz > 0 ? '#fda4af' : '#c4b5fd', T(lx, 0.22, L.z + sz * (L.w / 2 + 0.2), 0, 0, PI / 2, 0.44, ll, 0.44))
    ctx.phys.box({ x: lx, y: 0.25, z: L.z + sz * (L.w / 2 + 0.2) }, { x: ll / 2, y: 0.25, z: 0.2 }, { friction: 0.1, restitution: 0.4 })
  }
  for (let k = 0; k < 3; k++) b.add(G.box, ['#fda4af', '#fde68a', '#93c5fd'][k], T(L.x1 - 0.3, 0.2 + k * 0.4, L.z, 0, 0, 0, 0.7, 0.4, L.w + 0.9))
  ctx.phys.box({ x: L.x1 - 0.3, y: 0.6, z: L.z }, { x: 0.35, y: 0.6, z: L.w / 2 + 0.45 })
  b.add(G.box, '#f8fafc', T(L.x0 + 0.05, 0.065, L.z, 0, 0, 0, 0.12, 0.02, L.w))
  b.flush(root, { key: 'beach' })

  // Water: rippling surface (scrolling) with foam bubbles; the sponge raft bobs.
  const ripple = ctex('ripple', 64, 64, (g, w, h) => {
    g.fillStyle = '#67e8f9'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = 'rgba(255,255,255,0.45)'
    g.lineWidth = 2
    for (let i = 0; i < 9; i++) {
      g.beginPath()
      const y = i * 8 + 3
      g.moveTo(0, y)
      g.bezierCurveTo(w * 0.33, y - 4, w * 0.66, y + 4, w, y)
      g.stroke()
    }
  }, [2, 4])
  const water = new THREE.Mesh(new THREE.ShapeGeometry(roundRect(U.wid - 0.34, U.len - 0.34, 1.1), 6).rotateX(-PI / 2), keepMat('l:water', () => new THREE.MeshStandardMaterial({ map: ripple, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 })))
  water.position.set(U.x, U.water, U.z)
  water.receiveShadow = true
  root.add(water)
  const foam = new THREE.InstancedMesh(G.sphere, keepMat('l:foam', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, transparent: true, opacity: 0.85 })), 22)
  const fm = new THREE.Matrix4()
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * PI * 2
    const s = 0.2 + (i % 4) * 0.08
    fm.makeScale(s, s * 0.8, s).setPosition(U.x + Math.cos(a) * (U.wid / 2 - 0.45), U.water + 0.05, U.z + Math.sin(a) * (U.len / 2 - 0.6))
    foam.setMatrixAt(i, fm)
  }
  root.add(foam)
  const spongeTex = ctex('sponge', 64, 64, (g, w, h) => {
    g.fillStyle = '#fde047'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#eab308'
    for (let i = 0; i < 40; i++) {
      g.beginPath()
      g.arc((i * 41) % w, (i * 23) % h, 1.5 + (i % 3), 0, PI * 2)
      g.fill()
    }
  })
  const raft = new THREE.Mesh(G.box, tmat('sponge', spongeTex, { roughness: 1 }))
  raft.scale.set(1.2, 0.36, 1.7)
  raft.castShadow = true
  root.add(raft)
  ctx.phys.box({ x: U.x, y: U.water + 0.1, z: U.z - 1.2 }, { x: 0.6, y: 0.18, z: 0.85 })
  // The duck lifeguard on top of the tower (watches you).
  const duck = rubberDuck(0.75)
  duck.position.set(D.x, 2.3, D.z)
  root.add(duck)
  const sign = textSprite('Bathtub Beach', { bg: '#0e7490', size: 0.6 })
  sign.position.set(U.x - 1.2, U.h + 2.2, U.z - 3.6)
  root.add(sign)
  const lane = textSprite('Bath Bomb Bowling', { bg: '#0369a1', size: 0.5 })
  lane.position.set(L.x1 - 0.2, 2.1, L.z)
  root.add(lane)
  const look = new THREE.Vector3()
  return {
    update(t, dt) {
      ripple.offset.set(t * 0.03, t * 0.05)
      raft.position.set(U.x + Math.sin(t * 0.4) * 0.2, U.water + 0.08 + Math.sin(t * 1.7) * 0.05, U.z - 1.2 + Math.cos(t * 0.3) * 0.2)
      raft.rotation.set(Math.sin(t * 1.3) * 0.04, Math.sin(t * 0.2) * 0.3, Math.cos(t * 1.1) * 0.04)
      const me = ctx.me
      if (me) look.set(me.pos.x - D.x, 0, me.pos.z - D.z)
      const want = me && look.lengthSq() < 140 ? Math.atan2(look.x, look.z) : Math.sin(t * 0.3) * 1.2 + PI
      let d = want - duck.rotation.y
      d = Math.atan2(Math.sin(d), Math.cos(d))
      duck.rotation.y += d * Math.min(1, dt * 2)
      duck.position.y = 2.3 + Math.abs(Math.sin(t * 2)) * 0.04
    },
  }
}

/** A rubber duck, facing +z (shared look with the duck lifeguard's whistle and visor). */
export function rubberDuck(s: number) {
  const g = new THREE.Group()
  const b = new Batch()
  b.add(G.sphere, '#facc15', T(0, 0.45, 0, 0, 0, 0, 1.2, 0.85, 1.4), 'gloss')
  b.add(G.sphere, '#facc15', T(0, 1.05, 0.35, 0, 0, 0, 0.8), 'gloss')
  b.add(G.sphere, '#f97316', T(0, 0.98, 0.78, 0, 0, 0, 0.42, 0.16, 0.42), 'gloss')
  for (const sx of [-1, 1]) {
    b.add(G.sphere, '#111827', T(sx * 0.22, 1.18, 0.66, 0, 0, 0, 0.1), 'gloss')
    b.add(G.sphere, '#fbbf24', T(sx * 0.58, 0.5, -0.05, 0, 0, sx * 0.5, 0.25, 0.5, 0.7), 'gloss')
  }
  b.add(new THREE.ConeGeometry(0.5, 0.25, 12, 1, true), '#ef4444', T(0, 1.42, 0.45, -0.35, 0, 0, 0.9, 1, 0.9))
  b.add(G.cyl, '#e5e7eb', T(0.25, 0.8, 0.85, PI / 2, 0, 0, 0.1, 0.25, 0.1), 'metal')
  b.flush(g, { key: 'duck' })
  g.scale.setScalar(s)
  return g
}

/* ---------- Cardboard Arcade ---------- */

export function buildArcade(ctx: LevelCtx): Decor {
  const root = ctx.root
  const b = new Batch()
  const card = tmat('cardboard', cardboardTex())
  // A patterned arcade carpet.
  const carpet = ctex('carpet', 128, 128, (g, w, h) => {
    g.fillStyle = '#312e81'
    g.fillRect(0, 0, w, h)
    const cols = ['#f472b6', '#22d3ee', '#facc15', '#a3e635']
    g.lineWidth = 3
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = cols[i % 4]
      g.beginPath()
      const x = (i * 37) % w, y = (i * 53) % h
      g.moveTo(x, y)
      g.quadraticCurveTo(x + 10, y - 12, x + 20, y)
      g.quadraticCurveTo(x + 30, y + 12, x + 40, y)
      g.stroke()
    }
  }, [3, 3])
  b.addMat(G.box, tmat('carpet', carpet, { roughness: 1 }), T(-12.6, 0.02, 11.6, 0, 0, 0, 8, 0.04, 9), 'carpet')
  // Three cabinets cut from boxes, screens facing the room (+x).
  const C = ARCADE.cabinets
  const screenUv: number[] = []
  C.z.forEach((z, i) => {
    b.addMat(G.box, card, T(C.x, 1.8, z, 0, 0, 0, 1.6, 3.6, 1.8), 'card')
    b.add(G.box, ['#f472b6', '#22d3ee', '#a3e635'][i], T(C.x + 0.4, 3.4, z, 0, 0, 0, 0.9, 0.5, 1.9))
    b.add(G.box, '#1f2937', T(C.x + 0.86, 2.35, z, 0, 0, 0, 0.1, 1.15, 1.45))
    b.addMat(G.box, card, T(C.x + 1.0, 1.25, z, 0, 0, -0.5, 0.7, 0.18, 1.6), 'card')
    for (const [dz, col] of [[-0.45, '#ef4444'], [0.0, '#facc15'], [0.45, '#22c55e']] as const) b.add(G.cyl, col, T(C.x + 1.1, 1.42, z + dz + 0.15, 0, 0, -0.5, 0.2, 0.12, 0.2), 'gloss')
    b.add(G.cyl6, '#facc15', T(C.x + 1.05, 1.62, z - 0.45, 0, 0, -0.5, 0.06, 0.45, 0.06))
    b.add(G.sphere, '#ef4444', T(C.x + 1.15, 1.85, z - 0.45, 0, 0, 0, 0.16), 'gloss')
    ctx.phys.box({ x: C.x, y: 1.8, z }, { x: 0.8, y: 1.8, z: 0.9 })
    screenUv.push(i)
  })
  // The claw machine: cardboard base with a chute flap, plastic-wrap glass, a red roof and marquee.
  const K = ARCADE.claw
  const half = K.size / 2
  b.addMat(G.box, card, T(K.x, 0.85, K.z, 0, 0, 0, K.size, 1.7, K.size), 'card')
  b.add(G.box, '#1f2937', T(K.x + half * 0.55, 0.75, K.z - half - 0.01, 0, 0, 0, 0.8, 0.7, 0.04))
  b.add(G.box, '#ef4444', T(K.x, 4.55, K.z, 0, 0, 0, K.size + 0.2, 0.5, K.size + 0.2), 'gloss')
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add(G.box, '#ef4444', T(K.x + sx * (half - 0.05), 3.05, K.z + sz * (half - 0.05), 0, 0, 0, 0.1, 2.7, 0.1), 'gloss')
  // Control ledge in front with a joystick and a big drop button.
  b.addMat(G.box, card, T(K.x, 1.45, K.z - half - 0.35, 0, 0, 0, 1.6, 0.25, 0.7), 'card')
  b.add(G.cyl6, '#e5e7eb', T(K.x - 0.35, 1.75, K.z - half - 0.4, 0, 0, 0, 0.05, 0.5, 0.05), 'metal')
  b.add(G.sphere, '#ef4444', T(K.x - 0.35, 2.0, K.z - half - 0.4, 0, 0, 0, 0.18), 'gloss')
  b.add(G.cyl, '#22c55e', T(K.x + 0.35, 1.62, K.z - half - 0.4, 0, 0, 0, 0.3, 0.1, 0.3), 'gloss')
  ctx.phys.box({ x: K.x, y: 2.3, z: K.z }, { x: half, y: 2.3, z: half })
  ctx.phys.box({ x: K.x, y: 0.8, z: K.z - half - 0.35 }, { x: 0.8, y: 0.8, z: 0.35 })
  b.flush(root, { key: 'arcade' })

  const glass = new THREE.Mesh(G.box, keepMat('l:wrap', () => new THREE.MeshStandardMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false })))
  glass.scale.set(K.size - 0.12, 2.6, K.size - 0.12)
  glass.position.set(K.x, 3.0, K.z)
  glass.renderOrder = 4
  root.add(glass)
  const marquee = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.5),
    keepMat('l:marquee', () =>
      new THREE.MeshBasicMaterial({
        map: ctex('marquee', 256, 48, (g, w, h) => {
          g.fillStyle = '#7f1d1d'
          g.fillRect(0, 0, w, h)
          g.fillStyle = '#fde68a'
          g.font = '800 30px ui-rounded, sans-serif'
          g.textAlign = 'center'
          g.textBaseline = 'middle'
          g.fillText('BUTTON CLAW', w / 2, h / 2 + 2)
        }),
        toneMapped: false,
      }),
    ),
  )
  marquee.position.set(K.x, 4.55, K.z - half - 0.12)
  marquee.rotation.y = PI
  root.add(marquee)

  // Cabinet screens: one canvas, three panels, redrawn at a few frames a second while you're nearby.
  const scr = document.createElement('canvas')
  scr.width = 192
  scr.height = 64
  const sg = scr.getContext('2d')!
  const st = new THREE.CanvasTexture(scr)
  st.colorSpace = THREE.SRGBColorSpace
  st.magFilter = THREE.NearestFilter
  st.userData.keep = false
  const screenMat = new THREE.MeshBasicMaterial({ map: st, toneMapped: false })
  C.z.forEach((z, i) => {
    const g = new THREE.PlaneGeometry(1.4, 1.0)
    const uv = g.attributes.uv
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3)
    const m = new THREE.Mesh(g, screenMat)
    m.position.set(C.x + 0.92, 2.35, z)
    m.rotation.y = PI / 2
    root.add(m)
  })
  const neon = textSprite('Cardboard Arcade', { bg: '#4c1d95', color: '#f0abfc', size: 0.65 })
  neon.position.set(-12.6, 5.3, 16.6)
  root.add(neon)
  let drawT = 0
  const pix = (x: number, y: number, c: string) => {
    sg.fillStyle = c
    sg.fillRect(x * 4, y * 4, 4, 4)
  }
  return {
    update(t, dt) {
      drawT -= dt
      const cam = ctx.cam.camera.position
      if (drawT > 0 || Math.hypot(cam.x - C.x, cam.z - 10) > 26) return
      drawT = 0.12
      sg.fillStyle = '#020617'
      sg.fillRect(0, 0, 192, 64)
      // Panel 1: a bouncing button.
      const bx = Math.abs(((t * 9) % 28) - 14), by = Math.abs(((t * 7) % 24) - 12)
      pix(1 + bx, 1 + by, '#facc15')
      pix(2 + bx, 1 + by, '#facc15')
      pix(1 + bx, 2 + by, '#facc15')
      pix(2 + bx, 2 + by, '#facc15')
      // Panel 2: a wriggling yarn worm.
      for (let k = 0; k < 8; k++) pix(16 + ((Math.floor(t * 6) + k) % 15), 7 + Math.round(Math.sin(t * 3 + k * 0.7) * 4), k ? '#22d3ee' : '#f472b6')
      // Panel 3: falling stars and a paddle.
      for (let k = 0; k < 5; k++) pix(33 + ((k * 5) % 14), Math.floor((t * 8 + k * 3.3) % 15), '#a3e635')
      const px = 33 + Math.floor((Math.sin(t * 1.4) * 0.5 + 0.5) * 12)
      for (let k = 0; k < 3; k++) pix(px + k, 15, '#f8fafc')
      st.needsUpdate = true
    },
  }
}
