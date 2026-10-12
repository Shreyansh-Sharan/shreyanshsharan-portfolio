// The Loft's mood: warm god-rays through the round window with dust motes drifting in them, a pool of light on
// the floorboards, string lights on sagging wires that twinkle, the notice board with your stats and the Loft
// records, and the Sewing Table's tape-measure podium and mirror.
import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import type { LevelCtx } from '../../engine/types'
import { loadProfile } from '../../engine/show'
import { Batch, ctex, G, glowTex, keepMat, rrect, T } from './kit'
import { BOARD, SEW } from './layout'
import { LOFT_GAME_INFO, LOFT_GAMES, loadRecords, recordsVersion } from './records'

const PI = Math.PI
const _gs = new THREE.Vector3(0.75, 0.75, 0.75)

export interface Atmos {
  update(t: number, dt: number): void
  dispose(): void
}

/** Window at the +z gable: centre and radius (matches buildAttic for the Loft's size). */
export function windowSpot(hd: number, ridge: number, knee: number, hw: number) {
  const winY = Math.min(ridge * 0.55, knee + (ridge - knee) * 0.45)
  const winR = Math.min(hw * 0.22, (ridge - knee) * 0.32)
  return { x: 0, y: winY, z: hd, r: winR }
}

const MOTE_VERT = `
uniform float uTime;
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = position;
  float s = aSeed;
  p.x += sin(uTime * (0.13 + s * 0.1) + s * 40.0) * 0.6;
  p.y += mod(uTime * (0.05 + s * 0.06) + s * 9.0, 7.0) - 3.5;
  p.z += cos(uTime * (0.11 + s * 0.08) + s * 17.0) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(5.0, (0.8 + s * 1.2) * (120.0 / max(0.5, -mv.z)));
  // Twinkle, and fade out right in front of the camera so motes never blow up into blobs.
  vA = (0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * (1.0 + s * 2.0) + s * 60.0))) * smoothstep(1.5, 4.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const MOTE_FRAG = `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(1.0, 0.86, 0.6, vA * smoothstep(0.5, 0.1, d) * 0.6);
}`

export function buildAtmos(ctx: LevelCtx, o: { hw: number; hd: number; ridge: number; knee: number }): Atmos {
  const root = ctx.root
  const high = ctx.quality === 'high'
  const win = windowSpot(o.hd, o.ridge, o.knee, o.hw)
  // Where the beam lands: down and into the room.
  const land = new THREE.Vector3(0.8, 0.02, o.hd - 13)

  // Extra light shafts: crossed soft planes from the window to the floor, gently breathing.
  const shaftTex = ctex('shaft', 64, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, 'rgba(255,220,160,0.55)')
    gr.addColorStop(0.6, 'rgba(255,205,140,0.22)')
    gr.addColorStop(1, 'rgba(255,200,140,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, w, h)
    const side = g.createLinearGradient(0, 0, w, 0)
    side.addColorStop(0, 'rgba(0,0,0,1)')
    side.addColorStop(0.3, 'rgba(0,0,0,0)')
    side.addColorStop(0.7, 'rgba(0,0,0,0)')
    side.addColorStop(1, 'rgba(0,0,0,1)')
    g.globalCompositeOperation = 'destination-out'
    g.fillStyle = side
    g.fillRect(0, 0, w, h)
  })
  const shaftMat = keepMat('l:shaft', () => new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, opacity: 0.16 }))
  const from = new THREE.Vector3(win.x, win.y, win.z - 0.2)
  const dir = land.clone().sub(from)
  const len = dir.length()
  const shafts: THREE.Mesh[] = []
  const nShafts = high ? 5 : 3
  for (let i = 0; i < nShafts; i++) {
    const g = new THREE.PlaneGeometry(win.r * (0.7 + (i % 3) * 0.3), len).translate(0, -len / 2, 0)
    const m = new THREE.Mesh(g, shaftMat)
    m.position.copy(from).add(new THREE.Vector3((i - (nShafts - 1) / 2) * win.r * 0.45, ((i * 7) % 3) * 0.4 - 0.4, 0))
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize())
    m.rotateY((i / nShafts) * PI)
    m.renderOrder = 3
    root.add(m)
    shafts.push(m)
  }
  // A warm pool of light where the beam lands.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32).rotateX(-PI / 2),
    keepMat('l:pool', () => new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.42, color: '#ffd7a0' })),
  )
  pool.scale.set(win.r * 2.3, 1, win.r * 3.2)
  pool.position.copy(land)
  pool.renderOrder = 2
  root.add(pool)

  // Dust motes drifting in the beam (all the motion is in the vertex shader).
  const n = high ? 260 : 110
  const pos = new Float32Array(n * 3)
  const seed = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const k = ((i * 0.618) % 1)
    const p = from.clone().lerp(land, 0.1 + k * 0.85)
    const spread = win.r * (0.4 + k * 1.3)
    pos[i * 3] = p.x + Math.sin(i * 12.9898) * spread
    pos[i * 3 + 1] = p.y + Math.sin(i * 78.233) * spread * 0.6
    pos[i * 3 + 2] = p.z + Math.sin(i * 39.425) * spread
    seed[i] = (Math.sin(i * 4.1414) * 0.5 + 0.5)
  }
  const mg = new THREE.BufferGeometry()
  mg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  const moteUni = { uTime: { value: 0 } }
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ uniforms: moteUni, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  motes.frustumCulled = false
  motes.renderOrder = 5
  root.add(motes)

  // String lights: warm bulbs on catenary wires between the rafters, each with a soft glow; they twinkle.
  const strands: [THREE.Vector3, THREE.Vector3][] = []
  const yTop = o.knee + (o.ridge - o.knee) * 0.5
  for (let i = 0; i < 5; i++) {
    const z = -o.hd * 0.75 + i * ((o.hd * 1.5) / 4)
    strands.push([new THREE.Vector3(-o.hw * 0.62, yTop - 1.2, z + 2), new THREE.Vector3(o.hw * 0.62, yTop - 1.2, z - 2)])
  }
  strands.push([new THREE.Vector3(-o.hw * 0.5, yTop + 1.5, -o.hd * 0.9), new THREE.Vector3(-o.hw * 0.5, yTop + 1.5, o.hd * 0.9)])
  strands.push([new THREE.Vector3(o.hw * 0.5, yTop + 1.5, -o.hd * 0.9), new THREE.Vector3(o.hw * 0.5, yTop + 1.5, o.hd * 0.9)])
  const per = high ? 18 : 11
  const total = strands.length * per
  const wire: number[] = []
  const bulbPos: THREE.Vector3[] = []
  for (const [a, b] of strands) {
    const sag = a.distanceTo(b) * 0.09
    let prev: THREE.Vector3 | null = null
    for (let i = 0; i <= per * 2; i++) {
      const t = i / (per * 2)
      const p = a.clone().lerp(b, t)
      p.y -= Math.sin(t * PI) * sag
      if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z)
      prev = p
      if (i % 2 === 1) bulbPos.push(p.clone().add(new THREE.Vector3(0, -0.14, 0)))
    }
  }
  const wg = new THREE.BufferGeometry()
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3))
  root.add(new THREE.LineSegments(wg, keepMat('l:wire', () => new THREE.LineBasicMaterial({ color: '#3b2a1e' }))))
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), keepMat('l:bulb', () => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })), total)
  const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), keepMat('l:bulbglow', () => new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })), high ? total : 0)
  const bcols = ['#ffd27a', '#ff9f6b', '#fff1c1', '#ffb4c8', '#bde0ff']
  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  bulbPos.forEach((p, i) => {
    bulbs.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z))
    bulbs.setColorAt(i, col.set(bcols[i % bcols.length]))
    if (high) glows.setColorAt(i, col.set(bcols[i % bcols.length]).multiplyScalar(0.55))
  })
  bulbs.count = bulbPos.length
  bulbs.frustumCulled = false
  root.add(bulbs)
  if (high) {
    glows.count = bulbPos.length
    glows.frustumCulled = false
    glows.renderOrder = 6
    root.add(glows)
  }

  const board = buildBoard(ctx)
  const sewing = buildSewing(ctx)

  let twinkleT = 0
  const camQ = new THREE.Quaternion()
  return {
    update(t, dt) {
      moteUni.uTime.value = t
      shaftMat.opacity = 0.14 + Math.sin(t * 0.35) * 0.04
      pool.material.opacity = 0.36 + Math.sin(t * 0.35) * 0.06
      twinkleT -= dt
      if (twinkleT <= 0) {
        twinkleT = high ? 0.12 : 0.3
        for (let i = 0; i < bulbs.count; i++) {
          const k = 0.75 + 0.25 * Math.sin(t * (1.3 + (i % 5) * 0.4) + i * 1.7)
          col.set(bcols[i % bcols.length]).multiplyScalar(k)
          bulbs.setColorAt(i, col)
          if (high) glows.setColorAt(i, col.multiplyScalar(0.35 * k))
        }
        if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
        if (high && glows.instanceColor) glows.instanceColor.needsUpdate = true
      }
      if (high) {
        // Glow quads face the camera.
        camQ.copy(ctx.cam.camera.quaternion)
        const s = _gs
        for (let i = 0; i < glows.count; i++) {
          const p = bulbPos[i]
          glows.setMatrixAt(i, m4.compose(p, camQ, s))
        }
        glows.instanceMatrix.needsUpdate = true
      }
      board.update()
      sewing.update(t, dt)
    },
    dispose() {
      sewing.dispose()
    },
  }
}

/* ---------- Notice board ---------- */

function buildBoard(ctx: LevelCtx) {
  const B = BOARD
  const cvs = document.createElement('canvas')
  cvs.width = 1024
  cvs.height = 600
  const g = cvs.getContext('2d')!
  const tex = new THREE.CanvasTexture(cvs)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const b = new Batch()
  b.add(G.box, '#7c4a21', T(B.x, B.y, B.z, 0, 0, 0, B.w + 0.4, B.h + 0.4, 0.2))
  b.flush(ctx.root, { key: 'board' })
  const face = new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }))
  face.position.set(B.x, B.y, B.z + 0.11)
  ctx.root.add(face)
  let ver = -1
  let pver = ''
  const draw = () => {
    const p = loadProfile()
    const r = loadRecords()
    // Cork.
    g.fillStyle = '#c69261'
    g.fillRect(0, 0, 1024, 600)
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = i % 2 ? 'rgba(120,70,30,0.25)' : 'rgba(255,230,190,0.18)'
      g.fillRect((i * 97) % 1024, (i * 61) % 600, 3, 2)
    }
    const card = (x: number, y: number, w: number, h: number, rot: number, bg: string) => {
      g.save()
      g.translate(x + w / 2, y + h / 2)
      g.rotate(rot)
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.fillRect(-w / 2 + 6, -h / 2 + 8, w, h)
      g.fillStyle = bg
      g.fillRect(-w / 2, -h / 2, w, h)
      g.fillStyle = '#ef4444'
      g.beginPath()
      g.arc(0, -h / 2 + 14, 9, 0, PI * 2)
      g.fill()
      g.restore()
    }
    g.textBaseline = 'alphabetic'
    // Your stats.
    card(36, 40, 400, 520, -0.03, '#fef9c3')
    g.save()
    g.translate(236, 300)
    g.rotate(-0.03)
    g.fillStyle = '#7c2d12'
    g.font = '800 40px ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText(p.name || 'Stitchling', 0, -190)
    g.font = '600 24px ui-rounded, system-ui, sans-serif'
    g.fillStyle = '#92400e'
    g.fillText('YOUR STATS', 0, -155)
    const rows: [string, string | number][] = [
      ['Shows played', p.shows],
      ['Crowns', p.wins],
      ['Biggest Menace', p.awards?.menace ?? 0],
      ['Revenge Served', p.awards?.revenge ?? 0],
      ['Buttons', p.buttons],
      ['Wardrobe', `${(p.owned ?? []).length} pieces`],
    ]
    g.textAlign = 'left'
    rows.forEach(([k, v], i) => {
      g.font = '600 28px ui-rounded, system-ui, sans-serif'
      g.fillStyle = '#44403c'
      g.fillText(k, -170, -95 + i * 52)
      g.textAlign = 'right'
      g.font = '800 30px ui-rounded, system-ui, sans-serif'
      g.fillStyle = '#b45309'
      g.fillText(String(v), 170, -95 + i * 52)
      g.textAlign = 'left'
    })
    g.restore()
    // Loft records: one index card per game.
    LOFT_GAMES.forEach((id, i) => {
      const x = 470 + (i % 2) * 270, y = 40 + Math.floor(i / 2) * 270
      card(x, y, 250, 245, (i % 2 ? 0.035 : -0.025) * (i > 1 ? -1 : 1), ['#dbeafe', '#dcfce7', '#fce7f3', '#ede9fe'][i])
      g.save()
      g.translate(x + 125, y + 122)
      g.rotate((i % 2 ? 0.035 : -0.025) * (i > 1 ? -1 : 1))
      const info = LOFT_GAME_INFO[id]
      g.textAlign = 'center'
      g.fillStyle = '#1e293b'
      g.font = '800 24px ui-rounded, system-ui, sans-serif'
      g.fillText(info.name, 0, -80)
      g.font = '600 16px ui-rounded, system-ui, sans-serif'
      g.fillStyle = '#64748b'
      g.fillText(info.zone, 0, -58)
      const list = r.board[id]
      if (!list.length) {
        g.fillStyle = '#94a3b8'
        g.font = 'italic 600 20px ui-rounded, system-ui, sans-serif'
        g.fillText('No scores yet', 0, 10)
      }
      list.slice(0, 4).forEach((e, k) => {
        g.textAlign = 'left'
        g.font = `${e.me ? 800 : 600} 20px ui-rounded, system-ui, sans-serif`
        g.fillStyle = k === 0 ? '#b45309' : '#334155'
        g.fillText(`${k + 1}. ${e.name}`, -105, -22 + k * 32)
        g.textAlign = 'right'
        g.fillText(id === 'vine' ? e.score.toFixed(1) : String(e.score), 105, -22 + k * 32)
      })
      g.restore()
    })
    tex.needsUpdate = true
  }
  const title = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 0.6),
    keepMat('l:boardtitle', () =>
      new THREE.MeshBasicMaterial({
        map: ctex('boardtitle', 420, 60, (g2, w, h) => {
          g2.fillStyle = '#7c2d12'
          rrect(g2, 0, 0, w, h, 14)
          g2.fill()
          g2.fillStyle = '#fde68a'
          g2.font = '800 34px ui-rounded, system-ui, sans-serif'
          g2.textAlign = 'center'
          g2.textBaseline = 'middle'
          g2.fillText('LOFT NOTICE BOARD', w / 2, h / 2 + 2)
        }),
        transparent: true,
        toneMapped: false,
      }),
    ),
  )
  title.position.set(B.x, B.y + B.h / 2 + 0.55, B.z + 0.12)
  ctx.root.add(title)
  let check = 0
  return {
    update() {
      if (--check > 0) return
      check = 30
      const p = loadProfile()
      const key = `${p.name}|${p.shows}|${p.wins}|${p.buttons}|${JSON.stringify(p.awards ?? {})}|${(p.owned ?? []).length}`
      if (ver === recordsVersion() && key === pver) return
      ver = recordsVersion()
      pver = key
      draw()
    },
  }
}

/* ---------- Sewing Table: tape-measure podium, pincushion stool and a mirror ---------- */

function buildSewing(ctx: LevelCtx) {
  const S = SEW.podium
  const root = ctx.root
  const b = new Batch()
  // The tape measure case (yellow) with its tape spooling out across the floor.
  b.add(G.cyl24, '#facc15', T(S.x, S.h / 2, S.z, 0, 0, 0, S.r * 2, S.h, S.r * 2), 'gloss')
  b.add(G.cyl24, '#1f2937', T(S.x + S.r * 0.95, S.h / 2, S.z, 0, 0, 0, 0.18, S.h * 0.5, 0.5))
  const tapeTex = ctex('tape', 256, 32, (g, w, h) => {
    g.fillStyle = '#fde047'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#1c1917'
    for (let i = 0; i < 64; i++) g.fillRect(i * 4, 0, 1, i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6)
    g.font = 'bold 10px sans-serif'
    for (let i = 0; i < 7; i++) g.fillText(String(i * 10), i * 40 + 2, 26)
  }, [3, 1])
  b.addMat(G.box, new THREE.MeshStandardMaterial({ map: tapeTex, roughness: 0.6 }), T(S.x + S.r + 1.6, 0.012, S.z + 0.3, 0, -0.15, 0, 3.2, 0.02, 0.32), 'tape')
  // Pincushion stool beside the table.
  b.add(G.sphere, '#dc2626', T(S.x - 1.6, 0.55, S.z + 0.9, 0, 0, 0, 1.1, 0.8, 1.1))
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4
    b.add(G.cyl6, '#d1d5db', T(S.x - 1.6 + Math.cos(a) * 0.3, 0.98, S.z + 0.9 + Math.sin(a) * 0.3, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4, 0.015, 0.4, 0.015), 'metal')
    b.add(G.sphere, ['#22d3ee', '#facc15', '#a78bfa', '#34d399'][i % 4], T(S.x - 1.6 + Math.cos(a) * 0.38, 1.16, S.z + 0.9 + Math.sin(a) * 0.38, 0, 0, 0, 0.08), 'gloss')
  }
  ctx.phys.cylinder({ x: S.x - 1.6, y: 0.4, z: S.z + 0.9 }, 0.4, 0.5)
  // Mirror frame (an embroidery hoop on a stand).
  const M = SEW.mirror
  const face = Math.atan2(S.x - M.x, S.z - M.z)
  b.add(new THREE.TorusGeometry(0.9, 0.08, 6, 28), '#b45309', T(M.x, 1.55, M.z, 0, face, 0, 1, 1.25, 1))
  b.add(G.cyl6, '#92400e', T(M.x, 0.4, M.z, 0, 0, 0, 0.1, 0.8, 0.1))
  b.add(G.cyl, '#92400e', T(M.x, 0.05, M.z, 0, 0, 0, 0.9, 0.1, 0.9))
  ctx.phys.cylinder({ x: M.x, y: 1, z: M.z }, 1, 0.35)
  b.flush(root, { key: 'sewing' })
  // The podium's top disc spins (anyone standing on it is turned by the Loft for a look from every side).
  const top = new THREE.Mesh(new THREE.CylinderGeometry(S.r * 0.98, S.r * 0.98, 0.04, 28), new THREE.MeshStandardMaterial({
    map: ctex('podiumtop', 128, 128, (g, w, h) => {
      g.fillStyle = '#fef08a'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#a16207'
      g.lineWidth = 3
      for (let r = 12; r < 64; r += 12) {
        g.beginPath()
        g.arc(w / 2, h / 2, r, 0, PI * 2)
        g.stroke()
      }
      g.fillStyle = '#a16207'
      g.font = 'bold 16px sans-serif'
      g.textAlign = 'center'
      g.fillText('STAND HERE', w / 2, h / 2 + 5)
    }),
    roughness: 0.5,
  }))
  top.position.set(S.x, S.h + 0.02, S.z)
  top.receiveShadow = true
  root.add(top)
  ctx.phys.cylinder({ x: S.x, y: S.h / 2, z: S.z }, S.h / 2, S.r)
  // The mirror: a real reflection on high quality (only rendered while you're close), else a shiny disc.
  let mirror: THREE.Object3D
  let reflector: Reflector | null = null
  if (ctx.quality === 'high') {
    reflector = new Reflector(new THREE.CircleGeometry(0.88, 28), { textureWidth: 384, textureHeight: 480, color: 0xd9e2ec, clipBias: 0.003 })
    mirror = reflector
  } else {
    mirror = new THREE.Mesh(new THREE.CircleGeometry(0.88, 28), new THREE.MeshStandardMaterial({ color: '#dbeafe', metalness: 1, roughness: 0.05 }))
  }
  mirror.scale.y = 1.25
  mirror.position.set(M.x, 1.55, M.z)
  mirror.rotation.y = face
  root.add(mirror)
  return {
    update(t: number, dt: number) {
      top.rotation.y += dt * 0.9
      void t
      if (reflector) {
        const c = ctx.cam.camera.position
        reflector.visible = Math.hypot(c.x - M.x, c.z - M.z) < 14
      }
    },
    dispose() {
      reflector?.dispose()
    },
  }
}
