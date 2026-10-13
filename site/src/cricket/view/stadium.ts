// The venue: a ring of grandstand sections (one model, instanced) round the game's oval with the pavilion square of
// the wicket, a scoreboard in a gap of the ring, sight screens behind both ends, floodlight towers on the diagonals
// and the pitch roller parked by the rope (all original models made for this project), the game's own ground
// (mowing stripes, pitch with creases and wear, the 30-yard circle, rope, scrolling boundary boards), an instanced
// crowd seated on the stands' seats, and sky and lighting for day, dusk and night. Built once per match; the quality
// tier decides the crowd size and shadows.
import * as THREE from 'three'
import type { CricketAssets } from '../assets'
import type { QualitySettings } from '../quality'
import type { PitchType, TimeOfDay } from '../sim/conditions'
import { Geo } from '../sim/geo'
import { Crowd, ringSeats } from './crowd'

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const RX = Geo.BoundarySquare
const RZ = Geo.BoundaryStraight

/** The stands' front edge, beyond the rope (m). */
const STAND_AT = 12
/** Stand sections are 40 m wide; spaced a little closer so neighbours overlap at the front. */
const STAND_STEP = 37.5
/** Where the pavilion and the scoreboard sit (ellipse angles: 0 down the ground towards +z, pi/2 square at +x). */
const PAVILION_ANGLE = Math.PI / 2
const SCOREBOARD_ANGLE = Math.PI * 1.32
const TOWER_ANGLES = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75]
const TOWER_AT = 36
/** The boundary boards' line, beyond the rope (m). */
const BOARDS_AT = 3.2

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

/** The yaw that turns a model's front (+Z) to face in from the ellipse at `angle` (along its inward normal). */
function inwardYaw(angle: number, extra = 0) {
  const nx = Math.sin(angle) / (RX + extra)
  const nz = Math.cos(angle) / (RZ + extra)
  return Math.atan2(-nx, -nz)
}

/**
 * Ellipse angles for pieces `width` metres wide round the ellipse `extra` metres out, at most `step` metres apart,
 * spread evenly through the free stretches between the given windows (centre angle, half-width in metres), so the
 * pieces meet the buildings in the windows without gaps.
 */
function arcSlots(extra: number, step: number, skip: [number, number][], width = step) {
  const N = 2048
  const len: number[] = [0]
  let prev = ellipse(0, extra)
  for (let i = 1; i <= N; i++) {
    const p = ellipse((i / N) * Math.PI * 2, extra)
    len.push(len[i - 1] + p.distanceTo(prev))
    prev = p
  }
  const total = len[N]
  const angleAt = (d: number) => {
    d = ((d % total) + total) % total
    let i = 1
    while (i < N && len[i] < d) i++
    return ((i - 1 + (d - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1])) / N) * Math.PI * 2
  }
  const lenAt = (a: number) => len[Math.round(((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * N)]
  const out: number[] = []
  if (!skip.length) {
    const n = Math.ceil(total / step)
    for (let k = 0; k < n; k++) out.push(angleAt((k / n) * total))
    return out
  }
  const windows = skip.map(([a, half]) => [lenAt(a) - half, lenAt(a) + half]).sort((a, b) => a[0] - b[0])
  for (let w = 0; w < windows.length; w++) {
    const from = windows[w][1]
    const to = w + 1 < windows.length ? windows[w + 1][0] : windows[0][0] + total
    const free = to - from
    if (free < width * 0.75) continue
    const n = Math.max(1, Math.ceil((free - width) / step) + 1)
    const gap = n > 1 ? (free - width) / (n - 1) : 0
    for (let k = 0; k < n; k++) out.push(angleAt(n > 1 ? from + width / 2 + k * gap : from + free / 2))
  }
  return out
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
  /** The venue materials, one per source material (lit for the time of day). */
  private venueMats: Map<THREE.Material, THREE.MeshStandardMaterial>
  private glow: THREE.Color

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
    this.venueMats = new Map()
    this.glow = new THREE.Color(night ? '#2c3650' : dusk ? '#2a1c12' : '#000000')
    g.add(this.adBoards(assets))
    g.add(this.sightScreens(assets))
    const standAngles = arcSlots(STAND_AT + 2, STAND_STEP, [
      [PAVILION_ANGLE, 24],
      [SCOREBOARD_ANGLE, 14],
    ], 40)
    g.add(this.stands(assets, standAngles))
    g.add(this.buildings(assets))
    this.crowd = new Crowd(standSeats(assets, standAngles, opts.quality.crowd), opts.colors, night)
    g.add(this.crowd.mesh)
    g.add(this.floodlightGlow(night))
    this.screenCanvas = document.createElement('canvas')
    this.screenCanvas.width = 620
    this.screenCanvas.height = 256
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas)
    this.screenTex.colorSpace = THREE.SRGBColorSpace
    g.add(this.bigScreen(assets))
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

  private adBoards(assets: CricketAssets) {
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
    // The ribbon is the boards' LED face: the board model's dark panel, a hair in front of it.
    const face = assets.adBoardFace.length === 5 ? assets.adBoardFace : [-2.3, 0.12, 2.3, 0.99, -0.27]
    const y0 = face[1]
    const hgt = face[3]
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const p = ellipse(a, BOARDS_AT)
      if (i > 0) u += p.distanceTo(ellipse(((i - 1) / n) * Math.PI * 2, BOARDS_AT)) / 24
      positions.push(p.x, y0, p.z, p.x, hgt, p.z)
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
    // The boards themselves (frames and legs), one every board length round the ribbon, faces on its line.
    const g = new THREE.Group()
    g.add(m)
    const width = face[2] - face[0]
    const angles = arcSlots(BOARDS_AT, width + 0.04, [])
    const frames = new THREE.InstancedMesh(assets.adBoard.geometry, this.venueMaterial(assets.adBoard.material as THREE.Material), angles.length)
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    const mat4 = new THREE.Matrix4()
    angles.forEach((a, i) => {
      const yaw = inwardYaw(a, BOARDS_AT)
      // Origin at the board's front: its face sits `face[4]` behind it, 2 cm behind the ribbon.
      const p = ellipse(a, BOARDS_AT).add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-face[4] - 0.02))
      frames.setMatrixAt(i, mat4.compose(p, q.setFromAxisAngle(Y_AXIS, yaw), one))
    })
    frames.computeBoundingSphere()
    frames.userData.shared = true
    g.add(frames)
    return g
  }

  private sightScreens(assets: CricketAssets) {
    const g = new THREE.Group()
    for (const end of [-1, 1]) {
      // Two screens side by side behind each end, faces towards the far stumps.
      for (const side of [-1, 1]) {
        const m = this.venueClone(assets.sightScreen)
        m.position.set(side * 4.56, 0, end * (RZ + 5.5))
        m.rotation.y = end > 0 ? Math.PI : 0
        g.add(m)
      }
    }
    return g
  }

  /** A venue material for a model's material (shared per source): lit for the time of day. */
  private venueMaterial(src: THREE.Material) {
    const hit = this.venueMats.get(src)
    if (hit) return hit
    const night = this.opts.time === 'night'
    const dusk = this.opts.time === 'dusk'
    const mat = (src as THREE.MeshStandardMaterial).clone()
    mat.metalness = Math.min(mat.metalness, 0.3)
    mat.envMapIntensity = 0.6
    const glow = this.glow
    // The stands catch the floodlights at night (a flat lift on the surface colour).
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = { value: glow }
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * diffuseColor.rgb;')
    }
    mat.customProgramCacheKey = () => `venue-${night ? 'n' : dusk ? 'd' : 'y'}`
    this.venueMats.set(src, mat)
    return mat
  }

  /** A copy of a venue model with venue materials, no shadows (the shadow map only covers the field). */
  private venueClone(src: THREE.Object3D) {
    const o = src.clone()
    o.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      m.material = this.venueMaterial(m.material as THREE.Material)
      m.castShadow = false
      m.receiveShadow = false
      m.userData.shared = true
    })
    return o
  }

  /** The ring of stand sections, one instanced model. */
  private stands(assets: CricketAssets, angles: number[]) {
    const src = this.opts.quality.tier === 'low' ? assets.standLow : assets.stand
    const m = new THREE.InstancedMesh(src.geometry, this.venueMaterial(src.material as THREE.Material), angles.length)
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    const mat4 = new THREE.Matrix4()
    angles.forEach((a, i) => m.setMatrixAt(i, mat4.compose(ellipse(a, STAND_AT), q.setFromAxisAngle(Y_AXIS, inwardYaw(a, STAND_AT)), one)))
    m.computeBoundingSphere()
    m.userData.shared = true
    return m
  }

  /** The pavilion, floodlight towers and the roller. */
  private buildings(assets: CricketAssets) {
    const g = new THREE.Group()
    const pav = this.venueClone(assets.pavilion)
    pav.position.copy(ellipse(PAVILION_ANGLE, STAND_AT - 2))
    pav.rotation.y = inwardYaw(PAVILION_ANGLE, STAND_AT)
    g.add(pav)
    for (const a of TOWER_ANGLES) {
      const t = this.venueClone(assets.floodlight)
      t.position.copy(ellipse(a, TOWER_AT))
      t.rotation.y = inwardYaw(a, TOWER_AT)
      g.add(t)
    }
    const roller = this.venueClone(assets.roller)
    const ra = PAVILION_ANGLE + 0.42
    roller.position.copy(ellipse(ra, BOARDS_AT + 3))
    roller.rotation.y = inwardYaw(ra, BOARDS_AT) + Math.PI / 2
    g.add(roller)
    return g
  }

  private floodlightGlow(night: boolean) {
    const g = new THREE.Group()
    if (!night) return g
    for (const a of TOWER_ANGLES) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff7d6', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }))
      glow.scale.set(22, 16, 1)
      glow.position.copy(ellipse(a, TOWER_AT - 1.5)).setY(43)
      g.add(glow)
    }
    return g
  }

  /** The scoreboard in its gap of the ring, the match screen on its LED face. */
  private bigScreen(assets: CricketAssets) {
    const g = new THREE.Group()
    g.add(this.venueClone(assets.scoreboard))
    const f = assets.scoreboardFace.length === 5 ? assets.scoreboardFace : [-11.1, 14.9, 11.1, 24, 1.72]
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(f[2] - f[0], f[3] - f[1]), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }))
    scr.position.set((f[0] + f[2]) / 2, (f[1] + f[3]) / 2, f[4] + 0.04)
    g.add(scr)
    g.position.copy(ellipse(SCOREBOARD_ANGLE, STAND_AT + 2))
    g.rotation.y = inwardYaw(SCOREBOARD_ANGLE, STAND_AT)
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
      // The models' geometry belongs to the shared assets; everything else is this stadium's own.
      if (m.geometry && !m.userData.shared) m.geometry.dispose()
      // Instanced pieces own their instance buffers even when the geometry is shared.
      else if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}

/**
 * Seats for the crowd: the stand model's seats (sampled on its seat-coloured faces when it was built), shared out
 * across the sections and turned to face the middle. Falls back to a plain ring if the model has none.
 */
function standSeats(assets: CricketAssets, angles: number[], count: number): Float32Array {
  const local = assets.standSeats
  const per = local.length / 3
  if (per < 20 || !angles.length) return ringSeats(count, 7, RX + 15, RZ + 17, 13, 3, 17)
  const out = new Float32Array(count * 4)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const v = new THREE.Vector3()
  let n = 0
  for (let i = 0; i < count; i++) {
    const s = Math.floor(i / angles.length)
    if (s >= per) break
    const a = angles[i % angles.length]
    m.compose(ellipse(a, STAND_AT), q.setFromAxisAngle(Y_AXIS, inwardYaw(a, STAND_AT)), one)
    v.set(local[s * 3], local[s * 3 + 1], local[s * 3 + 2]).applyMatrix4(m)
    out[n * 4] = v.x
    out[n * 4 + 1] = v.y
    out[n * 4 + 2] = v.z
    out[n * 4 + 3] = Math.atan2(-v.x, -v.z)
    n++
  }
  return out.subarray(0, n * 4)
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
