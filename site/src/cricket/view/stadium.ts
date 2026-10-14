// The venue: a ring of grandstand sections (one model, instanced) round the game's oval with the pavilion square of
// the wicket, a scoreboard in a gap of the ring, sight screens behind both ends, floodlight towers on the diagonals
// and the pitch roller parked by the rope (all original models made for this project), the game's own ground
// (mowing stripes, pitch with creases and wear, the 30-yard circle, rope, scrolling boundary boards), an instanced
// crowd seated on the stands' seats with flags and fans' banners, and the sky and light for the time of day (see
// env.ts). The venue's own shadows are baked once from the fixed sun (sunshadow.ts). Built once per match; the quality
// tier decides the crowd size, the texture sizes and the shadows.
import * as THREE from 'three'
import type { CricketAssets } from '../assets'
import type { QualitySettings } from '../quality'
import type { PitchType, TimeOfDay } from '../sim/conditions'
import { Geo } from '../sim/geo'
import { Crowd, ringSeats } from './crowd'
import { LOOKS, makeSky, type Look } from './env'
import { bakeVenueShadow, receiveVenueShadow, venueShadowUniforms, VENUE_LAYER } from './sunshadow'

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
  /** The teams' names (the fans' banners). */
  names?: [string, string]
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

const BANNERS = ['GO {A}!', '{A} ARMY', 'SIX PLEASE!', 'COME ON {B}!', 'HOWZAT!', '{B} TILL I DIE', 'WE LOVE CRICKET', 'HIT IT HERE!']

export class Stadium {
  group = new THREE.Group()
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  crowd: Crowd
  look: Look
  private boards: THREE.Mesh[] = []
  private boardTex: THREE.CanvasTexture | null = null
  private boardScroll = 0
  private screenCanvas: HTMLCanvasElement
  private screenTex: THREE.CanvasTexture
  private opts: StadiumOptions
  /** The venue materials, one per source material (lit for the time of day). */
  private venueMats: Map<string, THREE.MeshStandardMaterial>
  private glow: THREE.Color
  private skyU: ReturnType<typeof makeSky>['uniforms']
  private flagU = { uTime: { value: 0 } }
  private wearU = { uWear: { value: 0 } }
  private wearCanvas: HTMLCanvasElement
  private wearTex: THREE.CanvasTexture
  private venueRt: THREE.WebGLRenderTarget | null = null
  private taps: number
  /** The venue's baked shadows (the players' kit receives them too). */
  venueU = venueShadowUniforms()

  constructor(assets: CricketAssets, opts: StadiumOptions) {
    this.opts = opts
    const g = this.group
    const night = opts.time === 'night'
    const look = (this.look = LOOKS[opts.time])
    this.taps = opts.quality.venueTaps

    // Sky dome with clouds.
    const sky = makeSky(look, opts.quality.tier)
    this.skyU = sky.uniforms
    g.add(sky.mesh)

    // Lights: the sun (or the floodlights' key) and a little sky fill (the environment map does most of it).
    this.hemi = new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity)
    this.setAmbient(opts.quality)
    g.add(this.hemi)
    this.sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity)
    this.sun.position.copy(look.sunDir).multiplyScalar(120)
    this.sun.target.position.set(0, 0, 0)
    g.add(this.sun, this.sun.target)
    this.configureShadow(opts.quality)
    if (night) {
      // Fill from the other towers (no shadows) so players aren't half black.
      const fill = new THREE.DirectionalLight('#e8eeff', 0.9)
      fill.position.set(50, 70, 40)
      g.add(fill)
    }

    this.wearCanvas = document.createElement('canvas')
    this.wearCanvas.width = 128
    this.wearCanvas.height = 1024
    this.wearTex = new THREE.CanvasTexture(this.wearCanvas)
    this.wearTex.colorSpace = THREE.NoColorSpace

    g.add(this.ground(assets))
    g.add(this.pitchStrip(assets))
    g.add(this.circleMarks())
    g.add(this.rope())
    this.venueMats = new Map()
    this.glow = new THREE.Color(look.standGlow)
    g.add(this.adBoards(assets))
    g.add(this.sightScreens(assets))
    const standAngles = arcSlots(STAND_AT + 2, STAND_STEP, [
      [PAVILION_ANGLE, 24],
      [SCOREBOARD_ANGLE, 14],
    ], 40)
    g.add(this.stands(assets, standAngles))
    g.add(this.buildings(assets))
    if (opts.quality.tier !== 'low') g.add(this.flags(standAngles))
    g.add(this.banners(standAngles))
    this.crowd = new Crowd(standSeats(assets, standAngles, opts.quality.crowd), opts.colors, night, (sh) => receiveVenueShadow(sh, this.venueU, this.taps))
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

  /** The sun's shadow map for a quality tier (live: the game calls this when the tier changes). */
  configureShadow(q: QualitySettings) {
    this.sun.castShadow = q.shadows
    if (!q.shadows) return
    const s = this.sun.shadow
    if (s.mapSize.x !== q.shadowMapSize) {
      s.mapSize.set(q.shadowMapSize, q.shadowMapSize)
      s.map?.dispose()
      s.map = null
    }
    // A tight frustum that the game moves with the play (see Game.followShadow).
    s.camera.left = s.camera.bottom = -30
    s.camera.right = s.camera.top = 30
    s.camera.near = 40
    s.camera.far = 220
    s.camera.updateProjectionMatrix()
    s.bias = -0.0003
    s.normalBias = 0.025
    s.radius = q.tier === 'high' ? 3 : 2
  }

  /** Sky fill for a tier: stronger where there is no environment map to light things. */
  setAmbient(q: QualitySettings) {
    this.hemi.intensity = this.look.hemiIntensity + (q.env ? 0 : this.look.envIntensity * 0.9)
  }

  /** Bakes the venue's shadows (once, after the stadium is in the scene). */
  bakeShadows(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    if (this.opts.time === 'night') return
    this.venueRt?.depthTexture?.dispose()
    this.venueRt?.dispose()
    this.venueRt = bakeVenueShadow(renderer, scene, this.venueU, this.look.sunDir, this.opts.quality.tier === 'low' ? 1024 : 2048, 125)
  }

  /** Pitch wear, 0 (a fresh strip) to 1 (the last over of a long match). */
  setWear(k: number) {
    this.wearU.uWear.value = THREE.MathUtils.clamp(k, 0, 1)
  }

  /** A ball mark where a delivery pitched (view x, z in metres). */
  markPitch(x: number, z: number) {
    if (Math.abs(x) > 1.5 || Math.abs(z) > 12) return
    const c = this.wearCanvas
    const ctx = c.getContext('2d')!
    const px = ((x + 1.525) / 3.05) * c.width
    const pz = ((z + 12) / 24) * c.height
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = 'rgba(0,70,0,1)'
    ctx.beginPath()
    ctx.ellipse(px, pz, 1.6, 2.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    this.wearTex.needsUpdate = true
  }

  private ground(assets: CricketAssets) {
    const night = this.opts.time === 'night'
    const geo = new THREE.CircleGeometry(95, 96)
    geo.rotateX(-Math.PI / 2)
    // Elliptical: squash x so the boundary oval sits inside.
    geo.scale(RX / RZ, 1, 1)
    geo.scale(1.08, 1, 1.08)
    // UVs in metres (the turf tile is 3.6 m square).
    const pos = geo.getAttribute('position')
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 3.6, pos.getZ(i) / 3.6)
    const map = assets.turf.clone()
    map.anisotropy = 8
    map.needsUpdate = true
    const nrm = assets.turfNormal.clone()
    nrm.needsUpdate = true
    const low = this.opts.quality.tier === 'low'
    // One turf sample and one noise below the high tier.
    const simple = this.opts.quality.tier !== 'high'
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: low ? null : nrm, normalScale: new THREE.Vector2(0.55, 0.55), color: night ? '#9bc08a' : '#ffffff', roughness: 0.93, metalness: 0 })
    // The outfield always takes the stands' shadows (one tap on the low tier).
    const taps = Math.max(1, this.taps)
    const venueU = this.venueU
    mat.onBeforeCompile = (sh) => {
      receiveVenueShadow(sh, venueU, taps)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldPos;
          float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }`,
        )
        .replace(
          '#include <map_fragment>',
          `{
          // Two scales of the turf (no visible tiling), large patches of lighter and darker grass, mowing stripes
          // that swap light and dark with the view (the blades lean the way the mower went).
          vec4 t1 = texture2D(map, vMapUv);
          ${simple ? 'vec3 turf = t1.rgb;' : 'vec3 turf = mix(t1.rgb, texture2D(map, vMapUv * 0.27 + vec2(0.31, 0.57)).rgb, 0.35);'}
          float lum = dot(turf, vec3(0.2126, 0.7152, 0.0722));
          turf = mix(vec3(lum), turf, 0.78) * vec3(0.94, 0.98, 0.82);
          vec2 w = vWorldPos.xz;
          ${low ? '' : simple ? 'turf *= mix(0.86, 1.1, gNoise(w * 0.06));' : `float macro = gNoise(w * 0.045) * 0.6 + gNoise(w * 0.13) * 0.4;
          turf *= mix(0.86, 1.1, macro);
          turf = mix(turf, turf * vec3(1.1, 1.04, 0.78), smoothstep(0.62, 0.9, gNoise(w * 0.07 + 7.0)) * 0.35);`}
          float k = sqrt(w.x * w.x / (${RX.toFixed(1)} * ${RX.toFixed(1)}) + w.y * w.y / (${RZ.toFixed(1)} * ${RZ.toFixed(1)}));
          float inner = 1.0 - smoothstep(0.985, 1.0, k);
          float band = mod(floor((w.x + 400.0) / 4.4), 2.0) * 2.0 - 1.0;
          float cross = mod(floor((w.y + 400.0) / 8.8), 2.0) * 2.0 - 1.0;
          vec3 V = cameraPosition - vWorldPos;
          vec2 look = -normalize(V.xz + vec2(1e-4));
          float grain = band * look.y;
          float stripe = 1.0 + inner * (0.085 * grain + 0.035 * band + 0.02 * cross * look.x);
          turf *= stripe;
          turf *= mix(0.84, 1.0, inner);
          // The square: a little paler and drier around the pitch.
          float sq = (1.0 - smoothstep(8.0, 12.0, abs(w.x))) * (1.0 - smoothstep(13.0, 17.0, abs(w.y)));
          turf = mix(turf, turf * vec3(1.08, 1.05, 0.86), sq * 0.55);
          diffuseColor.rgb *= turf;
          }`,
        )
    }
    mat.customProgramCacheKey = () => `ground-${taps}-${low ? 'l' : simple ? 's' : 'h'}`
    const m = new THREE.Mesh(geo, mat)
    m.receiveShadow = true
    m.name = 'ground'
    return m
  }

  private pitchStrip(assets: CricketAssets) {
    const low = this.opts.quality.tier === 'low'
    const w = low ? 256 : 512
    const h = w * 8
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d')!
    const rnd = mulberry(this.opts.pitch === 'green' ? 11 : this.opts.pitch === 'dusty' ? 23 : 37)
    // Base: the rolled soil, tiled down the strip and tinted for the pitch type.
    const img = assets.soil.image as CanvasImageSource
    for (let yy = 0; yy < h; yy += w) x.drawImage(img, 0, yy, w, w)
    const tint = this.opts.pitch === 'green' ? 'rgba(112,140,66,0.42)' : this.opts.pitch === 'dusty' ? 'rgba(232,196,140,0.32)' : 'rgba(210,192,150,0.16)'
    x.fillStyle = tint
    x.fillRect(0, 0, w, h)
    // Live grass creeping in at the edges and in thin patches (more on a green top).
    const grassy = this.opts.pitch === 'green' ? 1 : this.opts.pitch === 'dusty' ? 0.25 : 0.55
    for (let i = 0; i < 2600 * grassy; i++) {
      const edge = rnd() < 0.65
      const gx = edge ? (rnd() < 0.5 ? rnd() * w * 0.09 : w - rnd() * w * 0.09) : rnd() * w
      const gy = rnd() * h
      x.fillStyle = `rgba(${70 + rnd() * 40},${105 + rnd() * 40},${40 + rnd() * 20},${edge ? 0.35 : 0.12})`
      x.fillRect(gx, gy, 1 + rnd() * 2, 2 + rnd() * 5)
    }
    const eg = x.createLinearGradient(0, 0, w, 0)
    eg.addColorStop(0, 'rgba(84,120,52,0.55)')
    eg.addColorStop(0.05, 'rgba(84,120,52,0.0)')
    eg.addColorStop(0.95, 'rgba(84,120,52,0.0)')
    eg.addColorStop(1, 'rgba(84,120,52,0.55)')
    x.fillStyle = eg
    x.fillRect(0, 0, w, h)
    if (this.opts.pitch === 'dusty') {
      // Cracks.
      x.strokeStyle = 'rgba(90,60,30,0.45)'
      x.lineWidth = w / 256
      for (let i = 0; i < 120; i++) {
        let px = rnd() * w
        let py = rnd() * h
        x.beginPath()
        x.moveTo(px, py)
        for (let k = 0; k < 6; k++) {
          px += (rnd() - 0.5) * w * 0.12
          py += (rnd() - 0.5) * w * 0.12
          x.lineTo(px, py)
        }
        x.stroke()
      }
    }
    // The roller's sheen down the middle.
    const grd = x.createLinearGradient(0, 0, w, 0)
    grd.addColorStop(0, 'rgba(0,0,0,0.1)')
    grd.addColorStop(0.5, 'rgba(255,248,230,0.07)')
    grd.addColorStop(1, 'rgba(0,0,0,0.1)')
    x.fillStyle = grd
    x.fillRect(0, 0, w, h)
    // Creases: crisp paint with a scuffed edge. The strip is 3.05 m x 24 m.
    const L = 24
    const pz = (z: number) => ((z + L / 2) / L) * h
    const px = (xm: number) => ((xm + 3.05 / 2) / 3.05) * w
    const line = w / 64
    const paint = (x0: number, y0: number, ww: number, hh: number) => {
      x.fillStyle = 'rgba(250,250,246,0.95)'
      x.fillRect(x0, y0, ww, hh)
      x.fillStyle = 'rgba(160,140,110,0.5)'
      for (let i = 0; i < (ww * hh) / 18; i++) x.fillRect(x0 + rnd() * ww, y0 + rnd() * hh, 1, 1)
    }
    for (const end of [-1, 1]) {
      const stumpsZ = end * Geo.HalfPitch
      const popZ = stumpsZ - end * Geo.CreaseDepth
      // Bowling crease (2.64 m wide), popping crease (full width), return creases.
      paint(px(-1.32), pz(stumpsZ) - line / 2, px(1.32) - px(-1.32), line)
      paint(0, pz(popZ) - line / 2, w, line)
      for (const s of [-1.32, 1.32]) paint(px(s) - line / 2, Math.min(pz(popZ), pz(stumpsZ + end * 0.6)), line, Math.abs(pz(stumpsZ + end * 0.6) - pz(popZ)))
    }
    // Wide guide lines (limited overs).
    for (const end of [-1, 1]) {
      const popZ = end * (Geo.HalfPitch - Geo.CreaseDepth)
      for (const s of [-Geo.WideLineOff, Geo.WideLineOff]) paint(px(s) - line / 3, pz(popZ) - (end > 0 ? w / 14 : -w / 128), (line * 2) / 3, w / 16)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8

    // Where the strip wears (red: footholds and the bowlers' rough, by how early each spot goes; green: ball marks).
    const wx = this.wearCanvas.getContext('2d')!
    wx.fillStyle = '#000'
    wx.fillRect(0, 0, 128, 1024)
    const mz = (z: number) => ((z + 12) / 24) * 1024
    const mx = (xm: number) => ((xm + 1.525) / 3.05) * 128
    const blob = (cx: number, cz: number, rx: number, rz: number, v: number) => {
      const gg = wx.createRadialGradient(mx(cx), mz(cz), 0, mx(cx), mz(cz), 1)
      gg.addColorStop(0, `rgba(${v},0,0,1)`)
      gg.addColorStop(1, 'rgba(0,0,0,0)')
      wx.save()
      wx.translate(mx(cx), mz(cz))
      wx.scale((rx / 3.05) * 128, (rz / 24) * 1024)
      wx.translate(-mx(cx), -mz(cz))
      wx.fillStyle = gg
      wx.globalCompositeOperation = 'lighter'
      wx.beginPath()
      wx.arc(mx(cx), mz(cz), 1, 0, Math.PI * 2)
      wx.fill()
      wx.restore()
    }
    for (const end of [-1, 1]) {
      const popZ = end * (Geo.HalfPitch - Geo.CreaseDepth)
      // The batter's guard and the bowler's landing either side of the stumps.
      blob(0.05, popZ + end * 0.25, 0.45, 0.9, 150)
      for (const side of [-0.55, 0.55]) blob(side, popZ - end * 0.1, 0.4, 0.9, 120)
      // The rough outside the right-hander's off stump and the left-hander's (from the follow-through).
      for (let i = 0; i < 26; i++) {
        const side = rnd() < 0.6 ? -1 : 1
        blob(side * (0.55 + rnd() * 0.75), popZ + end * (0.6 + rnd() * 3.2), 0.12 + rnd() * 0.2, 0.25 + rnd() * 0.35, 40 + rnd() * 70)
      }
      // Scuffs all over the ends.
      for (let i = 0; i < 40; i++) blob((rnd() - 0.5) * 2.4, popZ + end * (rnd() * 4.5 - 0.6), 0.08 + rnd() * 0.12, 0.12 + rnd() * 0.2, 20 + rnd() * 50)
    }
    this.wearTex.needsUpdate = true
    const worn = assets.worn.clone()
    worn.needsUpdate = true
    worn.wrapS = worn.wrapT = THREE.RepeatWrapping
    const geo = new THREE.PlaneGeometry(3.05, L)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.2, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    const wearU = this.wearU
    const wearTex = this.wearTex
    const taps = this.taps
    const venueU = this.venueU
    mat.onBeforeCompile = (sh) => {
      receiveVenueShadow(sh, venueU, taps)
      Object.assign(sh.uniforms, wearU, { uWearMask: { value: wearTex }, uWorn: { value: worn } })
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWear;\nuniform sampler2D uWearMask;\nuniform sampler2D uWorn;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float wearSpot = 0.0;
          {
            vec2 wm = texture2D(uWearMask, vMapUv).rg;
            // Footholds deepen and spread as the match goes on: the earliest spots first.
            float go = 1.0 - (0.42 + uWear * 0.55);
            wearSpot = smoothstep(go, go + 0.3, wm.r) * (0.55 + 0.45 * uWear);
            vec3 worn = texture2D(uWorn, vMapUv * vec2(1.0, 7.87)).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, worn * vec3(0.9, 0.84, 0.78), wearSpot);
            diffuseColor.rgb *= 1.0 - wm.g * 0.35;
            diffuseColor.rgb *= 1.0 - uWear * 0.05;
          }`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = min(1.0, roughnessFactor + wearSpot * 0.12);')
    }
    mat.customProgramCacheKey = () => `pitch-${taps}`
    const m = new THREE.Mesh(geo, mat)
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
    const m = new THREE.InstancedMesh(disc, new THREE.MeshStandardMaterial({ color: '#f4f4ee', roughness: 0.8, transparent: true, opacity: 0.9 }), pts.length)
    m.receiveShadow = true
    const mat = new THREE.Matrix4()
    pts.forEach((p, i) => m.setMatrixAt(i, mat.makeTranslation(p.x, 0.02, p.z)))
    return m
  }

  /** The boundary: a padded cushion (a low triangular profile) in the home colour with a white stripe. */
  private rope() {
    const n = 400
    const P: number[] = []
    const UV: number[] = []
    const idx: number[] = []
    const prof: [number, number, number][] = [
      [-0.22, 0.0, 0],
      [-0.03, 0.2, 0.45],
      [0.03, 0.2, 0.55],
      [0.22, 0.0, 1],
    ]
    let u = 0
    let prev = ellipse(0)
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const p = ellipse(a)
      u += p.distanceTo(prev)
      prev = p
      const nx = Math.sin(a) / RX
      const nz = Math.cos(a) / RZ
      const l = Math.hypot(nx, nz)
      for (const [o, y, v] of prof) {
        P.push(p.x + (nx / l) * o, y, p.z + (nz / l) * o)
        UV.push(u / 6, v)
      }
      if (i < n) {
        const k = i * 4
        for (let j = 0; j < 3; j++) idx.push(k + j, k + j + 4, k + j + 1, k + j + 1, k + j + 4, k + j + 5)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 32
    const x = c.getContext('2d')!
    x.fillStyle = this.opts.colors[0]
    x.fillRect(0, 0, 256, 32)
    x.fillStyle = 'rgba(255,255,255,0.92)'
    x.fillRect(0, 13, 256, 6)
    x.fillStyle = 'rgba(0,0,0,0.25)'
    x.fillRect(0, 0, 256, 3)
    x.fillRect(0, 29, 256, 3)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, side: THREE.DoubleSide }))
    m.receiveShadow = true
    m.name = 'rope'
    return m
  }

  private adBoards(assets: CricketAssets) {
    const c = document.createElement('canvas')
    c.width = 4096
    c.height = 128
    const x = c.getContext('2d')!
    const palette: [string, string, string][] = [
      ['#0b1b3d', '#1d4ed8', '#f8fafc'],
      ['#7c1d0a', '#ea580c', '#fff7ed'],
      ['#053b2c', '#10b981', '#ecfdf5'],
      ['#f8fafc', '#e2e8f0', '#0f172a'],
      ['#3b0764', '#9333ea', '#fdf4ff'],
      ['#facc15', '#fde047', '#1c1917'],
    ]
    const seg = c.width / 6
    for (let i = 0; i < 6; i++) {
      const [a, b, ink] = palette[i]
      const gr = x.createLinearGradient(i * seg, 0, i * seg + seg, 0)
      gr.addColorStop(0, a)
      gr.addColorStop(0.5, b)
      gr.addColorStop(1, a)
      x.fillStyle = gr
      x.fillRect(i * seg, 0, seg, 128)
      // A simple mark and the name.
      const name = SPONSORS[(i * 2) % SPONSORS.length]
      x.font = '900 70px system-ui, sans-serif'
      const tw = x.measureText(name).width
      const cx = i * seg + seg / 2 + 40
      x.fillStyle = ink
      x.beginPath()
      if (i % 3 === 0) x.arc(cx - tw / 2 - 60, 64, 30, 0, Math.PI * 2)
      else if (i % 3 === 1) {
        x.moveTo(cx - tw / 2 - 90, 94)
        x.lineTo(cx - tw / 2 - 60, 34)
        x.lineTo(cx - tw / 2 - 30, 94)
      } else x.rect(cx - tw / 2 - 88, 36, 56, 56)
      x.fill()
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      x.fillText(name, cx, 68)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.anisotropy = 8
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
      if (i > 0) u += p.distanceTo(ellipse(((i - 1) / n) * Math.PI * 2, BOARDS_AT)) / 30
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
    // LED panels: they glow by themselves, enough to read in full sun.
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#202020', map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: night ? 0.9 : 0.75, side: THREE.DoubleSide, roughness: 0.35 }))
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
    // White behind the red ball by day and at dusk; black for the white ball under lights.
    const white = this.opts.time !== 'night'
    for (const end of [-1, 1]) {
      // Two screens side by side behind each end, faces towards the far stumps.
      for (const side of [-1, 1]) {
        const m = this.venueClone(assets.sightScreen, white ? 'white' : '')
        m.position.set(side * 4.56, 0, end * (RZ + 5.5))
        m.rotation.y = end > 0 ? Math.PI : 0
        g.add(m)
      }
    }
    return g
  }

  /** A venue material for a model's material (shared per source): lit for the time of day. */
  private venueMaterial(src: THREE.Material, variant = '') {
    const key = `${src.uuid}-${variant}`
    const hit = this.venueMats.get(key)
    if (hit) return hit
    const mat = (src as THREE.MeshStandardMaterial).clone()
    mat.metalness = Math.min(mat.metalness, 0.6)
    mat.envMapIntensity = 0.8
    const glow = this.glow
    const taps = this.taps
    const venueU = this.venueU
    const white = variant === 'white'
    // The stands catch the floodlights at night (a flat lift on the surface colour), the roofs' shadows by day.
    mat.onBeforeCompile = (sh) => {
      receiveVenueShadow(sh, venueU, taps)
      sh.uniforms.uGlow = { value: glow }
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * diffuseColor.rgb;')
      // The sight screen's dark panels painted white (the frame keeps its colour).
      if (white) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.333)); diffuseColor.rgb = mix(vec3(0.82, 0.83, 0.84), diffuseColor.rgb, smoothstep(0.035, 0.12, l)); }')
    }
    mat.customProgramCacheKey = () => `venue-${this.opts.time}-${taps}-${variant}`
    this.venueMats.set(key, mat)
    return mat
  }

  /** A copy of a venue model with venue materials. It casts into the venue's baked shadows, not the play's. */
  private venueClone(src: THREE.Object3D, variant = '') {
    const o = src.clone()
    o.traverse((c) => {
      const m = c as THREE.Mesh
      if (!m.isMesh) return
      m.material = this.venueMaterial(m.material as THREE.Material, variant)
      m.castShadow = false
      m.receiveShadow = false
      m.layers.enable(VENUE_LAYER)
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
    m.layers.enable(VENUE_LAYER)
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

  /** Flags on poles along the back of the stands' roofs, rippling in the breeze (teams' colours and white). */
  private flags(angles: number[]) {
    const g = new THREE.Group()
    const spots: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    angles.forEach((a, i) => {
      if (i % 2) return
      const base = new THREE.Matrix4().compose(ellipse(a, STAND_AT), q.setFromAxisAngle(Y_AXIS, inwardYaw(a, STAND_AT)), one)
      for (const sx of [-17, 17]) spots.push(new THREE.Matrix4().makeTranslation(sx, 18, -15).premultiply(base))
    })
    const pole = new THREE.CylinderGeometry(0.06, 0.08, 6, 6)
    pole.translate(0, 3, 0)
    const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: '#d4d8de', metalness: 0.7, roughness: 0.35 }), spots.length)
    const cloth = new THREE.PlaneGeometry(3, 1.9, 10, 4)
    cloth.translate(1.5, 5.0, 0)
    const flags = new THREE.InstancedMesh(cloth, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), spots.length)
    const u = this.flagU
    ;(flags.material as THREE.MeshStandardMaterial).onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.11;
        float k = clamp(position.x / 3.0, 0.0, 1.0);
        transformed.z += sin(position.x * 2.1 - uTime * 6.0 + ph) * 0.22 * k + sin(position.y * 3.0 - uTime * 4.3 + ph) * 0.06 * k;
        transformed.y -= k * k * 0.15;`,
      )
    }
    // Every flag streams the same way (the wind), whatever its stand's facing.
    const wind = Math.atan2(0.6, 0.8)
    const cols = [this.opts.colors[0], this.opts.colors[1], '#f8fafc']
    const col = new THREE.Color()
    const p = new THREE.Vector3()
    const m4 = new THREE.Matrix4()
    spots.forEach((s, i) => {
      p.setFromMatrixPosition(s)
      poles.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z))
      flags.setMatrixAt(i, m4.compose(p, q.setFromAxisAngle(Y_AXIS, wind), one))
      flags.setColorAt(i, col.set(cols[i % cols.length]))
    })
    g.add(poles, flags)
    return g
  }

  /** Fans' banners hung on the front of the lower tier (original slogans in the teams' names). */
  private banners(angles: number[]) {
    const names = this.opts.names ?? ['HOME', 'AWAY']
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 512
    const x = c.getContext('2d')!
    const cloth = ['#f8fafc', this.opts.colors[0], '#facc15', this.opts.colors[1], '#111827', '#f8fafc', '#dc2626', '#0ea5e9']
    for (let i = 0; i < 8; i++) {
      const bx = (i % 2) * 512
      const by = Math.floor(i / 2) * 128
      x.fillStyle = cloth[i]
      x.fillRect(bx + 4, by + 4, 504, 120)
      const dark = ['#f8fafc', '#facc15', '#0ea5e9'].includes(cloth[i])
      x.fillStyle = dark ? '#111827' : '#f8fafc'
      const text = BANNERS[i].replace('{A}', names[0].toUpperCase()).replace('{B}', names[1].toUpperCase())
      let size = 64
      x.font = `900 ${size}px system-ui, sans-serif`
      const tw = x.measureText(text).width
      if (tw > 470) {
        size = Math.floor((size * 470) / tw)
        x.font = `900 ${size}px system-ui, sans-serif`
      }
      x.textAlign = 'center'
      x.textBaseline = 'middle'
      x.fillText(text, bx + 256, by + 66)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const P: number[] = []
    const UV: number[] = []
    const N: number[] = []
    const idx: number[] = []
    const rnd = mulberry(91)
    const q = new THREE.Quaternion()
    const one = new THREE.Vector3(1, 1, 1)
    const v = new THREE.Vector3()
    const nrm = new THREE.Vector3()
    angles.forEach((a) => {
      const base = new THREE.Matrix4().compose(ellipse(a, STAND_AT), q.setFromAxisAngle(Y_AXIS, inwardYaw(a, STAND_AT)), one)
      nrm.set(0, 0, 1).applyQuaternion(q)
      const count = 1 + Math.floor(rnd() * 2)
      for (let k = 0; k < count; k++) {
        const tile = Math.floor(rnd() * 8)
        const cx = -14 + rnd() * 28
        const w = 3.6
        const h = 0.9
        const y0 = 1.25 + rnd() * 0.15
        const u0 = (tile % 2) * 0.5
        const v1 = 1 - Math.floor(tile / 2) * 0.25
        const n0 = P.length / 3
        for (const [lx, ly, uu, vv] of [
          [cx - w / 2, y0, u0, v1 - 0.25],
          [cx + w / 2, y0, u0 + 0.5, v1 - 0.25],
          [cx + w / 2, y0 + h, u0 + 0.5, v1],
          [cx - w / 2, y0 + h, u0, v1],
        ]) {
          v.set(lx, ly, 0.06).applyMatrix4(base)
          P.push(v.x, v.y, v.z)
          UV.push(uu, vv)
          N.push(nrm.x, nrm.y, nrm.z)
        }
        idx.push(n0, n0 + 1, n0 + 2, n0, n0 + 2, n0 + 3)
      }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2))
    geo.setIndex(idx)
    const taps = this.taps
    const venueU = this.venueU
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    mat.onBeforeCompile = (sh) => receiveVenueShadow(sh, venueU, taps)
    mat.customProgramCacheKey = () => `banner-${taps}`
    const m = new THREE.Mesh(geo, mat)
    m.name = 'banners'
    return m
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
    const bg = x.createLinearGradient(0, 0, 0, c.height)
    bg.addColorStop(0, '#0b1222')
    bg.addColorStop(1, '#04060c')
    x.fillStyle = bg
    x.fillRect(0, 0, c.width, c.height)
    x.fillStyle = this.opts.colors[0]
    x.fillRect(0, 0, c.width, 10)
    x.fillStyle = this.opts.colors[1]
    x.fillRect(0, c.height - 6, c.width, 6)
    x.textAlign = 'center'
    x.fillStyle = '#f8fafc'
    x.font = 'bold 68px system-ui, sans-serif'
    x.fillText(lines[0] ?? '', c.width / 2, 92)
    x.font = '600 40px system-ui, sans-serif'
    x.fillStyle = '#fde68a'
    x.fillText(lines[1] ?? '', c.width / 2, 160)
    x.font = '34px system-ui, sans-serif'
    x.fillStyle = '#cbd5e1'
    x.fillText(lines[2] ?? '', c.width / 2, 216)
    this.screenTex.needsUpdate = true
  }

  update(dt: number) {
    this.crowd.update(dt)
    this.skyU.uTime.value += dt
    this.flagU.uTime.value += dt
    if (this.boardTex) {
      this.boardScroll += dt * 0.02
      this.boardTex.offset.x = this.boardScroll
    }
  }

  dispose() {
    this.venueU.uVenueOn.value = 0
    this.venueRt?.depthTexture?.dispose()
    this.venueRt?.dispose()
    this.wearTex.dispose()
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

/** A small seeded random (the pitch and banners look the same for everyone in a match). */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
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
