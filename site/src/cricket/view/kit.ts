// Team kits painted at runtime. Every body is modelled in a neutral grey kit; its kit mask says, per texel, which
// part of the kit it is (shirt, trim, trousers, cap or helmet, pads, gloves) or skin. The body material repaints
// those texels in the team's colours in the shader, keeping the modelled shading (each texel's brightness against
// its class's reference tone), so one shared program serves every player and nothing is baked per team. The team
// name on the chest and the player's name and number on the back are decals: small skinned patches cut from the
// body's own surface (cached per body), textured with a canvas per player, all fictional.
import * as THREE from 'three'
import type { CricketBody } from '../assets'

/** Mask class ids (the mask stores id * 32). */
export const KIT = { shirt: 1, trim: 2, trousers: 3, headwear: 4, pads: 5, gloves: 6, skin: 7 } as const

export interface KitPaint {
  shirt: string
  trim: string
  trousers: string
  headwear: string
  pads: string
  gloves: string
  /** Multiplier over the modelled skin. */
  skin: string
}

export interface ShirtSpec {
  /** Chest text (the team name). */
  chest: string
  /** Back of the shirt: a surname above the number (either may be empty). */
  back: string
  number: string
  ink: string
  /** For left-handers: the body is mirrored on screen, so the decals are pre-mirrored to read right. */
  mirror?: boolean
}

const KIT_FRAGMENT = `#include <map_fragment>
  {
    int kid = int(floor(texture2D(kitMask, vMapUv).r * 255.0 / 32.0 + 0.5));
    if (kid == 7) diffuseColor.rgb *= kitCol[7];
    else if (kid > 0) {
      float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = kitCol[kid] * min(1.7, l / max(kitRef[kid], 0.002));
    }
  }`

/** One decal patch: the body triangles inside a box on its front or back, with planar UVs into part of the canvas. */
interface Patch {
  x: number
  y0: number
  y1: number
  /** +1 front (chest), -1 back. */
  side: 1 | -1
  /** Canvas rows (v range) this patch maps to. */
  v0: number
  v1: number
}

export class Kits {
  private cache = new Map<string, THREE.CanvasTexture>()
  private decalGeo = new Map<CricketBody, THREE.BufferGeometry | null>()
  private size: number

  constructor(size = 512) {
    this.size = size
  }

  /** A body material in a team's kit (a clone of the body's own material, sharing its textures and program). */
  bodyMaterial(body: CricketBody, src: THREE.MeshStandardMaterial, paint: KitPaint) {
    const m = src.clone()
    const col = new Array(8).fill(0).map(() => new THREE.Color(1, 1, 1))
    col[KIT.shirt].set(paint.shirt)
    col[KIT.trim].set(paint.trim)
    col[KIT.trousers].set(paint.trousers)
    col[KIT.headwear].set(paint.headwear)
    col[KIT.pads].set(paint.pads)
    col[KIT.gloves].set(paint.gloves)
    col[KIT.skin].set(paint.skin)
    const refs = new Array(8).fill(0.5).map((v, i) => body.refs[i] || v)
    m.onBeforeCompile = (sh) => {
      sh.uniforms.kitMask = { value: body.mask }
      sh.uniforms.kitCol = { value: col }
      sh.uniforms.kitRef = { value: refs }
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D kitMask;\nuniform vec3 kitCol[8];\nuniform float kitRef[8];')
        .replace('#include <map_fragment>', KIT_FRAGMENT)
    }
    m.customProgramCacheKey = () => 'cricket-kit'
    return m
  }

  /**
   * The decal geometry for a body (cached): the chest band and the back panel cut from the skinned mesh in its rest
   * pose, lifted a few millimetres off the shirt, with UVs into the top (chest) and bottom (back) halves of a canvas.
   */
  decalGeometry(body: CricketBody, mesh: THREE.SkinnedMesh) {
    if (this.decalGeo.has(body)) return this.decalGeo.get(body)!
    const bones: Record<string, THREE.Vector3> = {}
    body.scene.updateMatrixWorld(true)
    body.scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
    })
    const g = mesh.geometry
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    const si = g.getAttribute('skinIndex')
    const sw = g.getAttribute('skinWeight')
    const idx = g.index
    if (!pos || !nor || !si || !sw || !idx || !bones.Spine1 || !bones.Neck) {
      this.decalGeo.set(body, null)
      return null
    }
    const s1 = bones.Spine1.y
    const neck = bones.Neck.y
    const s2 = bones.Spine2.y
    const cz = bones.Spine2.z
    const patches: Patch[] = [
      { x: 0.13, y0: s2 - 0.075, y1: s2 + 0.035, side: 1, v0: 0.5, v1: 1 },
      { x: 0.15, y0: s1 - 0.06, y1: neck - 0.035, side: -1, v0: 0, v1: 0.5 },
    ]
    // The compressed geometry keeps its vertices quantised (the skin's bone inverses undo it), so find each vertex's
    // rest position and normal in metres by skinning it in the rest pose; the patch keeps the stored values.
    const src = body.scene.getObjectByName(mesh.name) as THREE.SkinnedMesh | undefined
    const rest = src?.isSkinnedMesh ? src : mesh
    rest.skeleton.update()
    const count = pos.count
    const RP = new Float32Array(count * 3)
    const RN = new Float32Array(count * 3)
    const scale = new Float32Array(count)
    {
      const v = new THREE.Vector3()
      const m = new THREE.Matrix4()
      const nm = new THREE.Matrix3()
      for (let i = 0; i < count; i++) {
        rest.applyBoneTransform(i, v.fromBufferAttribute(pos, i))
        RP.set([v.x, v.y, v.z], i * 3)
        const b = si.getX(i)
        m.multiplyMatrices(rest.skeleton.bones[b].matrixWorld, rest.skeleton.boneInverses[b])
        scale[i] = m.getMaxScaleOnAxis()
        v.fromBufferAttribute(nor, i).applyMatrix3(nm.setFromMatrix4(m)).normalize()
        RN.set([v.x, v.y, v.z], i * 3)
      }
    }
    const P: number[] = []
    const N: number[] = []
    const UV: number[] = []
    const SI: number[] = []
    const SW: number[] = []
    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    for (const p of patches) {
      for (let t = 0; t < idx.count; t += 3) {
        let inside = true
        for (let k = 0; k < 3 && inside; k++) {
          const i = idx.getX(t + k)
          v.fromArray(RP, i * 3)
          n.fromArray(RN, i * 3)
          inside = Math.abs(v.x) < p.x + 0.03 && v.y > p.y0 - 0.03 && v.y < p.y1 + 0.03 && n.z * p.side > 0.25 && (v.z - cz) * p.side > 0
        }
        if (!inside) continue
        for (let k = 0; k < 3; k++) {
          const i = idx.getX(t + k)
          const lift = 0.004 / Math.max(1e-6, scale[i])
          n.fromBufferAttribute(nor, i)
          P.push(pos.getX(i) + n.x * lift, pos.getY(i) + n.y * lift, pos.getZ(i) + n.z * lift)
          N.push(n.x, n.y, n.z)
          v.fromArray(RP, i * 3)
          // Read from the viewer's side: the back's left-right runs the other way.
          const u = 0.5 + (p.side * v.x) / (2 * p.x)
          const vv = p.v0 + ((v.y - p.y0) / (p.y1 - p.y0)) * (p.v1 - p.v0)
          UV.push(u, vv)
          SI.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i))
          SW.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i))
        }
      }
    }
    if (!P.length) {
      this.decalGeo.set(body, null)
      return null
    }
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
    out.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2))
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4))
    out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4))
    out.computeBoundingSphere()
    this.decalGeo.set(body, out)
    return out
  }

  /** Text in a box of the canvas (fractions of its size), fitted to the box's width. */
  private label(x: CanvasRenderingContext2D, text: string, cx: number, cy: number, w: number, h: number, color: string, outline: string) {
    if (!text) return
    const S = this.size
    let size = h * S
    x.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`
    const tw = x.measureText(text).width
    if (tw > w * S) {
      size *= (w * S) / tw
      x.font = `800 ${size}px ui-sans-serif, system-ui, sans-serif`
    }
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    x.lineJoin = 'round'
    x.lineWidth = Math.max(1.5, size * 0.09)
    x.strokeStyle = outline
    x.strokeText(text, cx * S, cy * S)
    x.fillStyle = color
    x.fillText(text, cx * S, cy * S)
  }

  /** A player's shirt decals: the team name on the top half, surname and number on the bottom half. */
  decal(s: ShirtSpec) {
    const key = `${s.chest}|${s.back}|${s.number}|${s.ink}|${s.mirror ? 'm' : ''}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const S = this.size
    const c = document.createElement('canvas')
    c.width = c.height = S
    const x = c.getContext('2d')!
    if (s.mirror) {
      x.translate(S, 0)
      x.scale(-1, 1)
    }
    const outline = luminance(s.ink) > 0.5 ? 'rgba(10,12,20,0.8)' : 'rgba(255,255,255,0.8)'
    this.label(x, s.chest.toUpperCase(), 0.5, 0.25, 0.9, 0.2, s.ink, outline)
    this.label(x, s.back.toUpperCase(), 0.5, 0.585, 0.86, 0.09, s.ink, outline)
    this.label(x, s.number, 0.5, 0.81, 0.8, 0.34, s.ink, outline)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    this.cache.set(key, tex)
    return tex
  }

  /** Uploads every painted texture to the GPU now (so the first frame they appear in costs nothing). */
  upload(renderer: THREE.WebGLRenderer) {
    for (const t of this.cache.values()) renderer.initTexture(t)
  }

  dispose() {
    for (const t of this.cache.values()) t.dispose()
    this.cache.clear()
    for (const g of this.decalGeo.values()) g?.dispose()
    this.decalGeo.clear()
  }
}

/** sRGB bytes of a '#rrggbb' colour. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
