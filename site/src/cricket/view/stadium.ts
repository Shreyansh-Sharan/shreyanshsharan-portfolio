// The venue: Shayan's low-poly Ekana stadium (CC BY) stretched to wrap the game's oval, with the game's own ground
// (mowing stripes, pitch with creases and wear, the 30-yard circle, rope, ad boards, sight screens, big screen),
// an instanced crowd sampled onto the model's terraces, floodlight glows at its towers, and sky and lighting for
// day, dusk and night. Built once per match; the quality tier decides the crowd size and shadows.
import * as THREE from 'three'
import type { CricketAssets } from '../assets'
import type { QualitySettings } from '../quality'
import type { PitchType, TimeOfDay } from '../sim/conditions'
import { Geo } from '../sim/geo'
import { Crowd, ringSeats } from './crowd'

const RX = Geo.BoundarySquare
const RZ = Geo.BoundaryStraight

/** The stadium model is a 95 m circle with its field inside r 26.5; stretch it round the 63 x 68 m boundary. */
const VENUE_SCALE = new THREE.Vector3(2.95, 1.45, 3.15)
/** The model's floodlight heads (model units, before scaling). */
const TOWERS = [
  [31, 20.6, 0],
  [-31, 20.6, 0],
  [15.5, 20.6, 26.9],
  [-15.5, 20.6, 26.9],
  [15.5, 20.6, -26.9],
  [-15.5, 20.6, -26.9],
]

export interface StadiumOptions {
  pitch: PitchType
  time: TimeOfDay
  quality: QualitySettings
  colors: [string, string]
}

/** A point on an ellipse scaled from the boundary by `k` (and `extra` metres). */
function ellipse(angle: number, extra = 0) {
  return new THREE.Vector3(Math.sin(angle) * (RX + extra), 0, Math.cos(angle) * (RZ + extra))
}

const SPONSORS = ['NORTHWIND AIR', 'KETTLE & CRUMB', 'ZENITH MOBILE', 'PINEWOOD BANK', 'ORBIT COLA', 'HALCYON TYRES', 'LUMEN ENERGY', 'GRAINFIELD', 'VOLT RIOT', 'BOGEY BRAWL', 'SKYLARK TRAVEL', 'IRONLEAF']

export class Stadium {
  group = new THREE.Group()
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  crowd: Crowd
  private boards: THREE.Mesh[] = []
  private boardTex: THREE.CanvasTexture | null = null
  private boardScroll = 0
  private screenCanvas: HTMLCanvasElement
  private screenTex: THREE.CanvasTexture
  private opts: StadiumOptions

  constructor(assets: CricketAssets, opts: StadiumOptions) {
    this.opts = opts
    const g = this.group
    const night = opts.time === 'night'
    const dusk = opts.time === 'dusk'

    // Sky dome.
    g.add(this.sky())

    // Lights.
    this.hemi = new THREE.HemisphereLight(night ? '#8fa3c8' : dusk ? '#ffd9b8' : '#d9ecff', night ? '#20301c' : '#4a6b2e', night ? 0.75 : dusk ? 1.35 : 1.1)
    g.add(this.hemi)
    this.sun = new THREE.DirectionalLight(night ? '#f4f7ff' : dusk ? '#ffc184' : '#fff6e5', night ? 2.2 : dusk ? 2.8 : 2.8)
    if (night) this.sun.position.set(-40, 90, -30)
    else if (dusk) this.sun.position.set(-80, 38, 50)
    else this.sun.position.set(-50, 85, 35)
    this.sun.target.position.set(0, 0, 0)
    g.add(this.sun, this.sun.target)
    if (opts.quality.shadows) {
      this.sun.castShadow = true
      const s = this.sun.shadow
      s.mapSize.set(opts.quality.shadowMapSize, opts.quality.shadowMapSize)
      const half = opts.quality.tier === 'high' ? 45 : 32
      s.camera.left = -half
      s.camera.right = half
      s.camera.top = half
      s.camera.bottom = -half
      s.camera.near = 20
      s.camera.far = 220
      s.bias = -0.0004
      s.normalBias = 0.03
    }
    if (night) {
      // Fill from the other towers (no shadows) so players aren't half black.
      const fill = new THREE.DirectionalLight('#e8eeff', 0.9)
      fill.position.set(50, 70, 40)
      g.add(fill)
    }

    g.add(this.ground(assets))
    g.add(this.pitchStrip(assets))
    g.add(this.circleMarks())
    g.add(this.rope())
    g.add(this.adBoards())
    g.add(this.sightScreens(night))
    const venue = this.venue(assets, night, dusk)
    g.add(venue)
    const seats = terraceSeats(assets.stadium, opts.quality.crowd, VENUE_SCALE)
    this.crowd = new Crowd(seats, opts.colors, night)
    g.add(this.crowd.mesh)
    g.add(this.floodlightGlow(night))
    this.screenCanvas = document.createElement('canvas')
    this.screenCanvas.width = 512
    this.screenCanvas.height = 256
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas)
    this.screenTex.colorSpace = THREE.SRGBColorSpace
    g.add(this.bigScreen())
    this.setScreen(['CRICKET', '', 'Welcome'])
  }

  private sky() {
    const night = this.opts.time === 'night'
    const dusk = this.opts.time === 'dusk'
    const geo = new THREE.SphereGeometry(400, 32, 16)
    const top = new THREE.Color(night ? '#060b1d' : dusk ? '#2a3a6e' : '#3d7fd6')
    const mid = new THREE.Color(night ? '#16244a' : dusk ? '#e98b5b' : '#8fc1ef')
    const bot = new THREE.Color(night ? '#2a3a5c' : dusk ? '#f6c48b' : '#dcecf8')
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: top }, mid: { value: mid }, bot: { value: bot }, stars: { value: night ? 1 : 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform float stars; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){ float y = vDir.y; vec3 c = y > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, y)) : mix(bot, mid, smoothstep(-0.05, 0.12, y));
          if (stars > 0.5 && y > 0.2) { vec3 q = floor(vDir * 260.0); float s = step(0.9975, h(q)); c += vec3(s) * 0.7 * smoothstep(0.2, 0.5, y); }
          gl_FragColor = vec4(c, 1.0); }`,
    })
    const m = new THREE.Mesh(geo, mat)
    m.renderOrder = -10
    m.frustumCulled = false
    return m
  }

  private ground(assets: CricketAssets) {
    const night = this.opts.time === 'night'
    const geo = new THREE.CircleGeometry(95, 96)
    geo.rotateX(-Math.PI / 2)
    // Elliptical: squash x so the boundary oval sits inside.
    geo.scale(RX / RZ, 1, 1)
    geo.scale(1.08, 1, 1.08)
    const tex = assets.grass.clone()
    tex.needsUpdate = true
    tex.repeat.set(26, 26)
    const mat = new THREE.MeshStandardMaterial({ map: tex, color: night ? '#5f9c4b' : '#6aa64f', roughness: 0.95, metalness: 0 })
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float k = sqrt(vWorldPos.x*vWorldPos.x/(${RX.toFixed(1)}*${RX.toFixed(1)}) + vWorldPos.z*vWorldPos.z/(${RZ.toFixed(1)}*${RZ.toFixed(1)}));
          float stripe = mod(floor((vWorldPos.z + 400.0) / 6.0), 2.0);
          float cross = mod(floor((vWorldPos.x + 400.0) / 6.0), 2.0);
          float band = mix(0.9, 1.1, stripe) * mix(0.97, 1.03, cross);
          float inner = 1.0 - smoothstep(0.98, 1.0, k);
          diffuseColor.rgb *= mix(0.82, band, inner);
          // Worn square around the pitch.
          float sq = (1.0 - smoothstep(9.0, 12.0, abs(vWorldPos.x))) * (1.0 - smoothstep(14.0, 18.0, abs(vWorldPos.z)));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.04, 0.9), sq * 0.6);`,
        )
    }
    const m = new THREE.Mesh(geo, mat)
    m.receiveShadow = true
    m.name = 'ground'
    return m
  }

  private pitchStrip(assets: CricketAssets) {
    const w = 256
    const h = 2048
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d')!
    // Base: the soil texture, tiled and tinted for the pitch type.
    const img = assets.pitch.image as CanvasImageSource
    for (let yy = 0; yy < h; yy += 256) x.drawImage(img, 0, yy, 256, 256)
    const tint = this.opts.pitch === 'green' ? 'rgba(120,150,70,0.55)' : this.opts.pitch === 'dusty' ? 'rgba(225,190,130,0.45)' : 'rgba(205,190,140,0.35)'
    x.fillStyle = tint
    x.fillRect(0, 0, w, h)
    if (this.opts.pitch === 'dusty') {
      // Cracks.
      x.strokeStyle = 'rgba(90,60,30,0.45)'
      x.lineWidth = 1
      for (let i = 0; i < 90; i++) {
        let px = Math.random() * w
        let py = Math.random() * h
        x.beginPath()
        x.moveTo(px, py)
        for (let k = 0; k < 5; k++) {
          px += (Math.random() - 0.5) * 30
          py += (Math.random() - 0.5) * 30
          x.lineTo(px, py)
        }
        x.stroke()
      }
    }
    // Slight sheen down the middle.
    const grd = x.createLinearGradient(0, 0, w, 0)
    grd.addColorStop(0, 'rgba(0,0,0,0.12)')
    grd.addColorStop(0.5, 'rgba(255,255,255,0.06)')
    grd.addColorStop(1, 'rgba(0,0,0,0.12)')
    x.fillStyle = grd
    x.fillRect(0, 0, w, h)
    // Creases. The strip is 3.05 m x 24 m: 1 m = 256/3.05 px across, 2048/24 px along.
    const L = 24
    const pz = (z: number) => ((z + L / 2) / L) * h
    const px = (xm: number) => ((xm + 3.05 / 2) / 3.05) * w
    x.fillStyle = 'rgba(255,255,255,0.92)'
    for (const end of [-1, 1]) {
      const stumpsZ = end * Geo.HalfPitch
      const popZ = stumpsZ - end * Geo.CreaseDepth
      // Bowling crease (2.64 m wide), popping crease (full width), return creases.
      x.fillRect(px(-1.32), pz(stumpsZ) - 2, px(1.32) - px(-1.32), 4)
      x.fillRect(0, pz(popZ) - 2, w, 4)
      for (const s of [-1.32, 1.32]) x.fillRect(px(s) - 2, Math.min(pz(popZ), pz(stumpsZ + end * 0.6)), 4, Math.abs(pz(stumpsZ + end * 0.6) - pz(popZ)))
      // Footmarks and the bowlers' scuffs.
      x.fillStyle = 'rgba(70,50,30,0.35)'
      for (let i = 0; i < 70; i++) {
        const fx = px((Math.random() - 0.5) * 1.6)
        const fz = pz(popZ + end * (0.3 + Math.random() * 1.8))
        x.beginPath()
        x.ellipse(fx, fz, 5 + Math.random() * 6, 8 + Math.random() * 10, 0, 0, Math.PI * 2)
        x.fill()
      }
      x.fillStyle = 'rgba(255,255,255,0.92)'
    }
    // Wide guide lines (limited overs).
    x.fillStyle = 'rgba(255,255,255,0.7)'
    for (const end of [-1, 1]) {
      const popZ = end * (Geo.HalfPitch - Geo.CreaseDepth)
      for (const s of [-(Geo.WideLineOff + 0.0), Geo.WideLineOff]) x.fillRect(px(s) - 1, pz(popZ) - (end > 0 ? 18 : -2), 2, 16)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const geo = new THREE.PlaneGeometry(3.05, L)
    geo.rotateX(-Math.PI / 2)
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
    m.position.y = 0.005
    m.receiveShadow = true
    m.name = 'pitch'
    return m
  }

  private circleMarks() {
    // The 30-yard circle: two semicircles around the stumps joined by straight lines, dotted.
    const pts: THREE.Vector3[] = []
    const r = Geo.InnerCircle
    const hp = Geo.HalfPitch
    for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.06) pts.push(new THREE.Vector3(Math.sin(a) * r, 0, hp + Math.cos(a) * r))
    for (let a = Math.PI / 2; a <= (3 * Math.PI) / 2; a += 0.06) pts.push(new THREE.Vector3(Math.sin(a) * r, 0, -hp + Math.cos(a) * r))
    for (let z = -hp; z <= hp; z += 1.6) {
      pts.push(new THREE.Vector3(r, 0, z))
      pts.push(new THREE.Vector3(-r, 0, z))
    }
    const disc = new THREE.CircleGeometry(0.14, 8)
    disc.rotateX(-Math.PI / 2)
    const m = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: '#f8fafc', transparent: true, opacity: 0.85 }), pts.length)
    const mat = new THREE.Matrix4()
    pts.forEach((p, i) => m.setMatrixAt(i, mat.makeTranslation(p.x, 0.02, p.z)))
    return m
  }

  private rope() {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 200; i++) pts.push(ellipse((i / 200) * Math.PI * 2, 0).setY(0.07))
    const curve = new THREE.CatmullRomCurve3(pts, true)
    const geo = new THREE.TubeGeometry(curve, 400, 0.09, 6, true)
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this.opts.colors[0], roughness: 0.5, emissive: this.opts.colors[0], emissiveIntensity: 0.15 }))
    m.castShadow = false
    return m
  }

  private adBoards() {
    const c = document.createElement('canvas')
    c.width = 2048
    c.height = 64
    const x = c.getContext('2d')!
    const palette = ['#0f172a', '#7c2d12', '#064e3b', '#1e3a8a', '#581c87', '#831843']
    const seg = c.width / 6
    for (let i = 0; i < 6; i++) {
      x.fillStyle = palette[i % palette.length]
      x.fillRect(i * seg, 0, seg, 64)
      x.fillStyle = i % 2 ? '#fde68a' : '#f8fafc'
      x.font = 'bold 34px system-ui, sans-serif'
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      x.fillText(SPONSORS[(i * 2) % SPONSORS.length], i * seg + seg / 2, 33)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    // The ribbon runs anticlockwise, so flip the texture to read the right way from the field.
    tex.repeat.x = -1
    this.boardTex = tex
    // A continuous ribbon of boards just outside the rope, facing in.
    const n = 160
    const positions: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    let u = 0
    const hgt = 0.95
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const p = ellipse(a, 3.2)
      if (i > 0) u += p.distanceTo(ellipse(((i - 1) / n) * Math.PI * 2, 3.2)) / 24
      positions.push(p.x, 0, p.z, p.x, hgt, p.z)
      uvs.push(u, 0, u, 1)
      if (i < n) {
        const k = i * 2
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const night = this.opts.time === 'night'
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: night ? 0.9 : 0.35, side: THREE.DoubleSide, roughness: 0.6 }))
    this.boards.push(m)
    return m
  }

  private sightScreens(night: boolean) {
    const g = new THREE.Group()
    for (const end of [-1, 1]) {
      const geo = new THREE.BoxGeometry(22, 9, 0.6)
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: night ? '#0b0d12' : '#111318', roughness: 0.9 }))
      m.position.set(0, 4.5, end * (RZ + 7))
      m.castShadow = false
      g.add(m)
    }
    return g
  }

  /** The stadium model round the ground, lit for the time of day (its lamps glow after dark). */
  private venue(assets: CricketAssets, night: boolean, dusk: boolean) {
    const venue = assets.stadium.clone()
    venue.scale.copy(VENUE_SCALE)
    const glow = new THREE.Color(night ? '#2c3650' : dusk ? '#2a1c12' : '#000000')
    venue.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      const mat = src.clone()
      mat.emissiveIntensity = night ? 2.5 : dusk ? 1.2 : 0
      mat.roughness = 0.85
      // The stands catch the floodlights at night (a flat lift on top of the lamp panels' emissive map).
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uGlow = { value: glow }
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * diffuseColor.rgb;')
      }
      mat.customProgramCacheKey = () => `venue-${night ? 'n' : dusk ? 'd' : 'y'}`
      m.material = mat
      m.castShadow = false
      m.receiveShadow = false
      m.frustumCulled = false
    })
    return venue
  }

  private floodlightGlow(night: boolean) {
    const g = new THREE.Group()
    if (!night) return g
    for (const [x, y, z] of TOWERS) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff7d6', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }))
      glow.scale.set(26, 18, 1)
      glow.position.set(x * VENUE_SCALE.x, y * VENUE_SCALE.y + 1, z * VENUE_SCALE.z)
      g.add(glow)
    }
    return g
  }

  private bigScreen() {
    const g = new THREE.Group()
    const a = Math.PI * 0.82
    const p = ellipse(a, 30)
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }))
    const frame = new THREE.Mesh(new THREE.BoxGeometry(23, 12, 1), new THREE.MeshStandardMaterial({ color: '#111827' }))
    frame.position.z = -0.6
    g.add(scr, frame)
    g.position.set(p.x, 28, p.z)
    g.lookAt(0, 18, 0)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 24, 1.2), new THREE.MeshStandardMaterial({ color: '#334155' }))
    leg.position.set(0, -17, -1)
    g.add(leg)
    return g
  }

  /** Updates the big screen (score, a message). */
  setScreen(lines: string[]) {
    const c = this.screenCanvas
    const x = c.getContext('2d')!
    x.fillStyle = '#05070d'
    x.fillRect(0, 0, c.width, c.height)
    x.fillStyle = this.opts.colors[0]
    x.fillRect(0, 0, c.width, 8)
    x.textAlign = 'center'
    x.fillStyle = '#f8fafc'
    x.font = 'bold 64px system-ui, sans-serif'
    x.fillText(lines[0] ?? '', c.width / 2, 92)
    x.font = '600 38px system-ui, sans-serif'
    x.fillStyle = '#fde68a'
    x.fillText(lines[1] ?? '', c.width / 2, 160)
    x.font = '32px system-ui, sans-serif'
    x.fillStyle = '#cbd5e1'
    x.fillText(lines[2] ?? '', c.width / 2, 216)
    this.screenTex.needsUpdate = true
  }

  update(dt: number) {
    this.crowd.update(dt)
    if (this.boardTex) {
      this.boardScroll += dt * 0.02
      this.boardTex.offset.x = this.boardScroll
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh
      // The venue's geometry belongs to the shared asset; everything else is this stadium's own.
      if (m.geometry && !(m.material as THREE.Material)?.name?.startsWith('stadium')) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}

/**
 * Seats for the crowd sampled from the venue model's terraces: the upward-facing triangles of the stand band,
 * area-weighted, then stretched like the model. Falls back to a plain ring if the model has no such surface.
 */
function terraceSeats(model: THREE.Object3D, count: number, scale: THREE.Vector3): Float32Array {
  const tris: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; area: number }[] = []
  let total = 0
  const n = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  model.updateMatrixWorld(true)
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    const idx = m.geometry.index
    const count3 = idx ? idx.count : pos.count
    for (let i = 0; i < count3; i += 3) {
      const ia = idx ? idx.getX(i) : i
      const ib = idx ? idx.getX(i + 1) : i + 1
      const ic = idx ? idx.getX(i + 2) : i + 2
      const a = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld)
      const b = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld)
      const c = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld)
      ab.subVectors(b, a)
      ac.subVectors(c, a)
      n.crossVectors(ab, ac)
      const area = n.length() / 2
      if (area < 1e-4) continue
      n.divideScalar(area * 2)
      const cy = (a.y + b.y + c.y) / 3
      const cr = Math.hypot((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)
      // The terraces: upward faces of the stand band between the arcade roof and the top tier (the roof petals
      // and towers sit higher).
      if (n.y < 0.45 || cr < 26.5 || cr > 32.6 || cy < 2 || cy > 11.5) continue
      tris.push({ a, b, c, area })
      total += area
    }
  })
  if (tris.length < 20) return ringSeats(count, 7, RX + 15, RZ + 17, 13, 3, 17)
  const out = new Float32Array(count * 4)
  let s = 7
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const cum: number[] = []
  let acc = 0
  for (const t of tris) cum.push((acc += t.area))
  for (let i = 0; i < count; i++) {
    const r = rnd() * total
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < r) lo = mid + 1
      else hi = mid
    }
    const t = tris[lo]
    let u = rnd()
    let v = rnd()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    const x = (t.a.x + (t.b.x - t.a.x) * u + (t.c.x - t.a.x) * v) * scale.x
    const y = (t.a.y + (t.b.y - t.a.y) * u + (t.c.y - t.a.y) * v) * scale.y
    const z = (t.a.z + (t.b.z - t.a.z) * u + (t.c.z - t.a.z) * v) * scale.z
    out[i * 4] = x
    out[i * 4 + 1] = y
    out[i * 4 + 2] = z
    out[i * 4 + 3] = Math.atan2(-x, -z)
  }
  return out
}

let glowTex: THREE.Texture | null = null
function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,250,220,0.5)')
  g.addColorStop(1, 'rgba(255,250,220,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}
