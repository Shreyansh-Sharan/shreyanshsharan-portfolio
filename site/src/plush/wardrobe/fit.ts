// Fitting cosmetics to the four Stitchlings. Each toy has a different head (a sock is all head, the bear has
// ears, the dino has spikes, the bunny tall ears), so instead of hand offsets we measure each kind once: the
// skinned vertices of the head and body in the idle pose, in the toy's own space (metres, y up, facing +z).
// The numbers give the dome of the head (ignoring narrow ears, tufts and spikes), its width, the front of the
// face, the back, the hands and the feet. A small table of per-kind nudges (eye height, eye spacing) on top.
import * as THREE from 'three'
import type { ToyKind } from '../engine/assets'
import type { ToyRig } from '../engine/rig'

export interface Fit {
  kind: ToyKind
  head: {
    /** Centre of the head's box. */
    x: number
    y: number
    z: number
    /** Full width (x) and depth (z) of the head. */
    w: number
    d: number
    /** Bottom of the head, and the top of its dome (narrow ears/spikes/tufts left out). */
    bottom: number
    top: number
    /** Width of the dome a little below its top (hat size). */
    topW: number
    /** Front of the face at the centre line, at eye height. */
    front: number
    back: number
    eyeY: number
    eyeDX: number
    mouthY: number
  }
  body: { backY: number; backZ: number; frontZ: number; w: number; shoulderY: number }
  /** Toy-space positions of the bones cosmetics hang from, in the idle pose. */
  bones: Record<'Head' | 'Spine02' | 'RightHand' | 'LeftHand' | 'RightFoot' | 'LeftFoot', THREE.Vector3>
  hands: { R: THREE.Vector3; L: THREE.Vector3; size: number }
  feet: { R: THREE.Vector3; L: THREE.Vector3; len: number; wid: number }
  /** Front surface of the head (z) at a toy-space x, y. */
  faceZ(x: number, y: number): number
  /** Back surface (z, the most negative) along the midline at a toy-space height. */
  backZ(y: number): number
}

/** Per-kind nudges where measuring can't know where the stitched eyes and mouth are (checked by eye). */
const TUNE: Record<string, { eye: number; dx: number; mouth: number }> = {
  sock: { eye: 0.52, dx: 0.27, mouth: 0.33 },
  bear: { eye: 0.55, dx: 0.2, mouth: 0.3 },
  dino: { eye: 0.55, dx: 0.21, mouth: 0.3 },
  bunny: { eye: 0.5, dx: 0.13, mouth: 0.33 },
}

const cache = new Map<string, Fit>()
const HEAD = new Set(['Head', 'head_end', 'headfront'])
const FEET_R = new Set(['RightFoot', 'RightToeBase'])
const FEET_L = new Set(['LeftFoot', 'LeftToeBase'])
const HAND_R = new Set(['RightHand'])
const HAND_L = new Set(['LeftHand'])

/** Measure (once per kind) where things go on this rig. */
export function fitFor(rig: ToyRig): Fit {
  const hit = cache.get(rig.kind)
  if (hit) return hit
  const f = measure(rig)
  cache.set(rig.kind, f)
  return f
}

function measure(rig: ToyRig): Fit {
  rig.settle()
  const inv = new THREE.Matrix4().copy(rig.root.matrixWorld).invert()
  const head: THREE.Vector3[] = []
  const body: THREE.Vector3[] = []
  const fr: THREE.Vector3[] = [], fl: THREE.Vector3[] = [], hr: THREE.Vector3[] = [], hl: THREE.Vector3[] = []
  const v = new THREE.Vector3()
  rig.model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    const g = m.geometry
    const pos = g.attributes.position
    const si = g.attributes.skinIndex
    const sw = g.attributes.skinWeight
    const bones = m.skeleton.bones
    for (let i = 0; i < pos.count; i++) {
      let bi = 0, bw = -1
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k)
        if (w > bw) {
          bw = w
          bi = si.getComponent(i, k)
        }
      }
      const name = bones[bi]?.name ?? ''
      // The auto-rig gives belly and back to the leg and shoulder bones, so the trunk is every vertex near the
      // midline (measured below by position), while the head, hands and feet are picked by bone.
      const list = HEAD.has(name) ? head : FEET_R.has(name) ? fr : FEET_L.has(name) ? fl : HAND_R.has(name) ? hr : HAND_L.has(name) ? hl : null
      v.fromBufferAttribute(pos, i)
      m.applyBoneTransform(i, v)
      v.applyMatrix4(m.matrixWorld).applyMatrix4(inv)
      const p = v.clone()
      body.push(p)
      list?.push(p)
    }
  })
  const bonePos = (name: string) => {
    let b: THREE.Object3D | undefined
    rig.model.traverse((o) => {
      if (!b && o.name === name) b = o
    })
    return b ? b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : new THREE.Vector3(0, 0.6, 0)
  }
  const bones = {
    Head: bonePos('Head'),
    Spine02: bonePos('Spine02'),
    RightHand: bonePos('RightHand'),
    LeftHand: bonePos('LeftHand'),
    RightFoot: bonePos('RightFoot'),
    LeftFoot: bonePos('LeftFoot'),
  }

  // Fallback for a model without bones (the procedural lump): a rough head.
  if (head.length < 50) {
    return fallbackFit(rig.kind, bones)
  }
  const hb = new THREE.Box3().setFromPoints(head)
  const hs = hb.getSize(new THREE.Vector3())
  const hc = hb.getCenter(new THREE.Vector3())
  // The midline is the head bone's x (a floppy ear or a tuft would pull the box's centre sideways).
  hc.x = bones.Head.x
  // Every vertex: the face and back surfaces don't care which bone owns them.
  const trunk = body
  // Rows of the head by height: the dome top is the highest row still at least 60% of the widest row.
  const ROWS = 24
  const rowMin = new Array(ROWS).fill(Infinity), rowMax = new Array(ROWS).fill(-Infinity)
  const rowOf = (y: number) => Math.max(0, Math.min(ROWS - 1, Math.floor(((y - hb.min.y) / Math.max(1e-4, hs.y)) * ROWS)))
  for (const p of head) {
    // Only the central slab front to back, so ears that stick out sideways don't count as width up high.
    if (Math.abs(p.z - hc.z) > hs.z * 0.35) continue
    const r = rowOf(p.y)
    rowMin[r] = Math.min(rowMin[r], p.x)
    rowMax[r] = Math.max(rowMax[r], p.x)
  }
  const widths = rowMin.map((mn, i) => (Number.isFinite(mn) ? rowMax[i] - mn : 0))
  const maxW = Math.max(...widths)
  let topRow = ROWS - 1
  while (topRow > 0 && widths[topRow] < maxW * 0.6) topRow--
  const top = hb.min.y + ((topRow + 1) / ROWS) * hs.y
  const topW = widths[Math.max(0, topRow - 2)] || maxW

  // A coarse grid of the face's front surface: max z per (x, y) cell, over the front half of the head.
  const GX = 14, GY = ROWS
  const grid = new Float32Array(GX * GY).fill(-Infinity)
  const colOf = (x: number) => Math.max(0, Math.min(GX - 1, Math.floor(((x - hb.min.x) / Math.max(1e-4, hs.x)) * GX)))
  for (const p of trunk) {
    if (p.y < hb.min.y - 0.05) continue
    const k = rowOf(p.y) * GX + colOf(p.x)
    if (p.z > grid[k]) grid[k] = p.z
  }
  const faceZ = (x: number, y: number) => {
    const r0 = rowOf(y), c0 = colOf(x)
    for (let d = 0; d < 4; d++) {
      let best = -Infinity
      for (let r = r0 - d; r <= r0 + d; r++)
        for (let c = c0 - d; c <= c0 + d; c++) if (r >= 0 && r < GY && c >= 0 && c < GX) best = Math.max(best, grid[r * GX + c])
      if (Number.isFinite(best)) return best
    }
    return hb.max.z
  }

  const tune = TUNE[rig.kind] ?? { eye: 0.52, dx: 0.22, mouth: 0.32 }
  const domeH = top - hb.min.y
  const eyeY = hb.min.y + domeH * tune.eye
  const mouthY = hb.min.y + domeH * tune.mouth
  let back = hb.max.z
  for (const p of head) if (Math.abs(p.x - hc.x) < hs.x * 0.2 && p.z < back) back = p.z

  // Body: the back and front surfaces at the spine bone's height (head and body vertices both count).
  const sy = bones.Spine02.y
  let backZ = Infinity, frontZ = -Infinity, bmin = Infinity, bmax = -Infinity
  for (const p of trunk) {
    if (Math.abs(p.y - sy) > 0.06) continue
    if (Math.abs(p.x - hc.x) < 0.1) {
      backZ = Math.min(backZ, p.z)
      frontZ = Math.max(frontZ, p.z)
    }
    // Width of the trunk only (arms stick out further than the head is wide).
    if (Math.abs(p.x - hc.x) < hs.x * 0.55) {
      bmin = Math.min(bmin, p.x)
      bmax = Math.max(bmax, p.x)
    }
  }
  if (!Number.isFinite(backZ)) {
    backZ = back
    frontZ = hb.max.z
  }
  const bodyW = Number.isFinite(bmin) ? bmax - bmin : hs.x
  // Shoulders: where the trunk is still nearly as wide as the head below the face, or the head's bottom.
  const shoulderY = Math.max(sy + 0.04, Math.min(hb.min.y + 0.04, sy + 0.2))
  // The back's profile: the most negative z near the midline, in 4 cm slices from the floor up.
  const backRows = new Float32Array(30).fill(Infinity)
  for (const p of trunk) {
    if (Math.abs(p.x - hc.x) > 0.1 || p.y < 0) continue
    const r = Math.min(29, Math.floor(p.y / 0.04))
    if (p.z < backRows[r]) backRows[r] = p.z
  }
  const backAt = (y: number) => {
    const r0 = Math.max(0, Math.min(29, Math.floor(y / 0.04)))
    for (let d = 0; d < 6; d++) for (const r of [r0 - d, r0 + d]) if (r >= 0 && r < 30 && Number.isFinite(backRows[r])) return backRows[r]
    return backZ
  }

  const centre = (pts: THREE.Vector3[], fallback: THREE.Vector3) => (pts.length ? new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3()) : fallback.clone())
  const footBox = new THREE.Box3().setFromPoints(fr.length ? fr : [bones.RightFoot])
  const fsz = footBox.getSize(new THREE.Vector3())
  const handBox = new THREE.Box3().setFromPoints(hr.length ? hr : [bones.RightHand])

  return {
    kind: rig.kind,
    head: { x: hc.x, y: hc.y, z: hc.z, w: hs.x, d: hs.z, bottom: hb.min.y, top, topW, front: Math.max(faceZ(hc.x - hs.x * tune.dx, eyeY), faceZ(hc.x + hs.x * tune.dx, eyeY)), back, eyeY, eyeDX: hs.x * tune.dx, mouthY },
    body: { backY: sy, backZ, frontZ, w: bodyW, shoulderY },
    bones,
    hands: { R: centre(hr, bones.RightHand), L: centre(hl, bones.LeftHand), size: Math.max(0.06, handBox.getSize(new THREE.Vector3()).length() * 0.5) },
    feet: { R: centre(fr, bones.RightFoot), L: centre(fl, bones.LeftFoot), len: Math.max(0.12, fsz.z), wid: Math.max(0.1, fsz.x) },
    faceZ,
    backZ: backAt,
  }
}

function fallbackFit(kind: ToyKind, bones: Fit['bones']): Fit {
  return {
    kind,
    head: { x: 0, y: 0.7, z: 0, w: 0.6, d: 0.6, bottom: 0.45, top: 0.95, topW: 0.5, front: 0.3, back: -0.3, eyeY: 0.72, eyeDX: 0.11, mouthY: 0.6 },
    body: { backY: 0.5, backZ: -0.3, frontZ: 0.3, w: 0.6, shoulderY: 0.6 },
    bones,
    hands: { R: bones.RightHand.clone(), L: bones.LeftHand.clone(), size: 0.08 },
    feet: { R: bones.RightFoot.clone(), L: bones.LeftFoot.clone(), len: 0.18, wid: 0.12 },
    faceZ: () => 0.3,
    backZ: () => -0.3,
  }
}
