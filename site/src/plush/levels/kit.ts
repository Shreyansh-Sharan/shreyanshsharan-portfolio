// Small shared helpers for the survival pack's levels (not a level: it is not in LEVELS). Warm toy-like
// materials, canvas-painted textures, a soft blob shadow, a pulsing warning ring and a few maths bits.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { LevelCtx, Toy } from '../engine/types'

/** A soft, smooth-shaded toy material. */
export function soft(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra })
}

/** The engine's flat-shaded look, for wooden and hard things. */
export function flat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra })
}

/** A rounded box (few segments: cheap). */
export function rbox(w: number, h: number, d: number, r = 0.08, seg = 2) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
}

/** Paint a canvas texture. `repeat` turns on wrapping. */
export function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
  }
  return t
}

/** Felt or fabric: a base colour with soft fibre speckle. Uses a tiny LCG so it is the same everywhere. */
export function feltTexture(base: string, fleck = 'rgba(255,255,255,0.08)', dark = 'rgba(0,0,0,0.07)', repeat: [number, number] = [2, 2]) {
  let seed = 1234567
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  return paint(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = base
      g.fillRect(0, 0, w, h)
      for (let i = 0; i < 900; i++) {
        g.fillStyle = rnd() < 0.5 ? fleck : dark
        const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI
        g.save()
        g.translate(x, y)
        g.rotate(a)
        g.fillRect(-2, -0.5, 4, 1)
        g.restore()
      }
    },
    repeat,
  )
}

let blob: THREE.Texture | null = null
/** A round soft shadow (radial gradient), shared. */
export function blobTexture() {
  if (blob) return blob
  blob = paint(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    gr.addColorStop(0, 'rgba(0,0,0,0.85)')
    gr.addColorStop(0.55, 'rgba(0,0,0,0.45)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, w, h)
  })
  return blob
}

/** A flat blob shadow mesh (unit radius: scale it). */
export function blobShadow(opacity = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity, color: '#000000' }),
  )
  m.renderOrder = 2
  return m
}

/** A flat warning ring (unit radius: scale it), additive-ish, for tells. */
export function warnRing(color = '#ef4444') {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  )
  m.renderOrder = 3
  return m
}

/** Wrap an angle to -π..π. */
export function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Round to 2 decimals for pack(). */
export const r2 = (v: number) => Math.round(v * 100) / 100
export const r1 = (v: number) => Math.round(v * 10) / 10

/** Survival pressure: 0..1 extra intensity once the round is past `from` of its length and too many are left. */
export function pressure(time: number, duration: number, active: number, target: number, from = 0.55) {
  const k = THREE.MathUtils.clamp((time / duration - from) / (1 - from), 0, 1)
  const crowd = target > 0 ? THREE.MathUtils.clamp((active - target) / Math.max(1, target), 0, 1) : 0
  return k * (0.4 + 0.6 * crowd)
}

/**
 * Time's up in a survival round: in a normal round everyone still standing goes through; in a final the best by
 * `ranked` take the places, with level-flavoured notes (instead of the engine's generic "too slow").
 */
export function survivalTimeUp(ctx: LevelCtx, ranked: Toy[], winNote: string, loseNote: string) {
  if (ctx.mode === 'quick') return
  if (!ctx.round.final) {
    for (const t of ctx.active()) ctx.qualify(t, 'survived')
    return
  }
  let room = ctx.target - ctx.qualifiedCount()
  for (const t of ranked) {
    if (t.status !== 'play') continue
    if (room > 0) {
      ctx.qualify(t, winNote)
      room--
    } else ctx.fail(t, loseNote)
  }
}
