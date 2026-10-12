// Picture Frame Fit (survival). Giant picture frames slide down a hallway towards the toys, each with holes
// cut in it for one, two or four toys, and raised holes you have to jump through as it passes. Stand in a gap
// or the frame sweeps you back off the landing into the stairwell. Crowding a hole means shoving. Frames get
// faster, come two at a time, and leave less room. Tricks: a spring-loaded boxing glove that punches a rival
// sideways, sticky tape on a rival's feet, and (Normal spice and up) sliding the next frame sideways at the
// last second.
import * as THREE from 'three'
import { skill, steerTo } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { PROP_GROUPS, type RigidBody } from '../engine/physics'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'
import { flat, paint, r1, r2, rbox, soft, survivalTimeUp } from './kit'

/** Hall half width, the landing's back edge and the invisible front wall. */
const W = 8.5
const EDGE = -4.5
const FRONT = 5.5
const H = 4.4
const T = 0.5
/** Frames extend into the walls so a sideways shift never opens a gap. */
const XW = W + 2.2
const Z_SPAWN = 44
const Z_END = -16
/** Hole kinds: width, bottom, top, capacity, label. */
const KINDS = [
  { w: 1.2, y0: 0, y1: 1.95, cap: 1, label: '1' },
  { w: 2.3, y0: 0, y1: 1.95, cap: 2, label: '2' },
  { w: 4.4, y0: 0, y1: 1.95, cap: 4, label: '4' },
  { w: 2.4, y0: 0.95, y1: 2.6, cap: 2, label: 'JUMP' },
]

/** A frame on its way: synced as [id, t0, speed, shift, shiftAt, ...holes as (x, kind)]. */
interface Frame {
  id: number
  t0: number
  speed: number
  shift: number
  shiftAt: number
  holes: { x: number; k: number }[]
}

interface FrameState {
  frames: Frame[]
  nextId: number
  /** Round time the next frame reaches the toys. */
  nextArrive: number
  /** Sticky tape until (per toy). */
  tape: number[]
  /** Frames passed (for Sprinkles), host. */
  passed: Set<number>
  // Every screen: built frames by id.
  built: Map<number, { body: RigidBody; mesh: THREE.Mesh; mats: THREE.Material[]; tex: THREE.Texture }>
  vis: {
    patches: THREE.InstancedMesh | null
    patchCol: THREE.Color
    gloves: { mesh: THREE.Object3D; t: number; from: THREE.Vector3; to: THREE.Vector3 }[]
    tape: THREE.InstancedMesh | null
    whoosh: Set<number>
  }
}

/* ---------------- Frames ---------------- */

function frameZ(f: Frame, t: number) {
  return Z_SPAWN - f.speed * (t - f.t0)
}

function frameX(f: Frame, t: number) {
  if (!f.shift) return 0
  return f.shift * THREE.MathUtils.smoothstep(t, f.shiftAt, f.shiftAt + 0.7)
}

/** When the frame's front face reaches z (the toys stand round z = 0..2). */
function arriveAt(f: Frame, z: number) {
  return f.t0 + (Z_SPAWN - T / 2 - z) / f.speed
}

function holesFor(ctx: LevelCtx, cap: number, allowJump: boolean) {
  // Pick hole kinds that add up to the capacity and fit the hall.
  const kinds: number[] = []
  let left = cap
  let width = 0
  for (let guard = 0; left > 0 && guard < 20; guard++) {
    let k: number
    if (left >= 4 && ctx.rng.chance(0.4)) k = 2
    else if (left >= 2 && ctx.rng.chance(0.55)) k = allowJump && ctx.rng.chance(0.4) ? 3 : 1
    else k = 0
    if (width + KINDS[k].w + 0.8 > W * 2 - 1) break
    kinds.push(k)
    width += KINDS[k].w + 0.8
    left -= KINDS[k].cap
  }
  if (!kinds.length) kinds.push(0)
  // Shuffle and spread across the hall with random gaps (at least 0.8 m of frame between holes).
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = ctx.rng.int(0, i + 1)
    ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
  }
  const total = kinds.reduce((a, k) => a + KINDS[k].w, 0)
  const free = W * 2 - 1 - total - 0.8 * (kinds.length - 1)
  const cuts = kinds.map(() => ctx.rng.range(0, 1))
  cuts.push(ctx.rng.range(0, 1))
  const sum = cuts.reduce((a, b) => a + b, 0)
  let x = -W + 0.5
  return kinds.map((k, i) => {
    x += (cuts[i] / sum) * Math.max(0, free) + (i ? 0.8 : 0)
    const hx = x + KINDS[k].w / 2
    x += KINDS[k].w
    return { x: r2(hx), k }
  })
}

function paintFrame(f: Frame) {
  // The picture: a wallpaper-ish print with gilt rims round the holes and their sizes written above them.
  const prints = [
    ['#fde68a', '#f59e0b'],
    ['#bfdbfe', '#3b82f6'],
    ['#fbcfe8', '#db2777'],
    ['#bbf7d0', '#16a34a'],
    ['#ddd6fe', '#7c3aed'],
  ]
  const [bg, fg] = prints[f.id % prints.length]
  const wpx = 1024, hpx = Math.round((1024 * H) / (XW * 2))
  return paint(wpx, hpx, (g, w, h) => {
    const sx = w / (XW * 2), sy = h / H
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.fillStyle = fg
    g.globalAlpha = 0.22
    const style = f.id % 3
    for (let x = 0; x < w; x += 28)
      for (let y = 0; y < h; y += 28) {
        if (style === 0) {
          g.beginPath()
          g.arc(x + ((y / 28) % 2) * 14, y, 5, 0, Math.PI * 2)
          g.fill()
        } else if (style === 1) g.fillRect(x, 0, 9, h)
        else {
          g.beginPath()
          g.moveTo(x, y + 8)
          g.lineTo(x + 8, y)
          g.lineTo(x + 16, y + 8)
          g.lineTo(x + 8, y + 16)
          g.fill()
        }
      }
    g.globalAlpha = 1
    for (const hole of f.holes) {
      const k = KINDS[hole.k]
      // Mirrored: the toys see the frame from -z, where +x is on their left.
      const x0 = (XW - hole.x - k.w / 2) * sx, x1 = (XW - hole.x + k.w / 2) * sx
      const y0 = h - k.y1 * sy, y1 = h - k.y0 * sy
      g.strokeStyle = '#d4a017'
      g.lineWidth = 9
      g.beginPath()
      g.roundRect(x0 - 5, y0 - 5, x1 - x0 + 10, y1 - y0 + 10, 18)
      g.stroke()
      g.strokeStyle = '#fff3c4'
      g.lineWidth = 2
      g.stroke()
      g.fillStyle = hole.k === 3 ? '#ea580c' : '#1f2937'
      g.font = `800 ${Math.round(sy * 0.75)}px ui-rounded, system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'bottom'
      g.fillText(k.label, (x0 + x1) / 2, y0 - 10)
    }
    // Gilt border along the top.
    g.fillStyle = '#c9971c'
    g.fillRect(0, 0, w, sy * 0.35)
  })
}

function buildFrame(ctx: LevelCtx, s: FrameState, f: Frame) {
  // Outline along the bottom with notches for the ground-level holes; raised holes are real holes.
  const r = 0.3
  const shape = new THREE.Shape()
  shape.moveTo(-XW, 0)
  for (const hole of [...f.holes].sort((a, b) => a.x - b.x)) {
    const k = KINDS[hole.k]
    const x0 = hole.x - k.w / 2, x1 = hole.x + k.w / 2
    if (k.y0 > 0) continue
    shape.lineTo(x0, 0)
    shape.lineTo(x0, k.y1 - r)
    shape.quadraticCurveTo(x0, k.y1, x0 + r, k.y1)
    shape.lineTo(x1 - r, k.y1)
    shape.quadraticCurveTo(x1, k.y1, x1, k.y1 - r)
    shape.lineTo(x1, 0)
  }
  shape.lineTo(XW, 0)
  shape.lineTo(XW, H)
  shape.lineTo(-XW, H)
  shape.closePath()
  for (const hole of f.holes) {
    const k = KINDS[hole.k]
    if (k.y0 === 0) continue
    const x0 = hole.x - k.w / 2, x1 = hole.x + k.w / 2
    const p = new THREE.Path()
    p.moveTo(x0 + r, k.y0)
    p.lineTo(x1 - r, k.y0)
    p.quadraticCurveTo(x1, k.y0, x1, k.y0 + r)
    p.lineTo(x1, k.y1 - r)
    p.quadraticCurveTo(x1, k.y1, x1 - r, k.y1)
    p.lineTo(x0 + r, k.y1)
    p.quadraticCurveTo(x0, k.y1, x0, k.y1 - r)
    p.lineTo(x0, k.y0 + r)
    p.quadraticCurveTo(x0, k.y0, x0 + r, k.y0)
    shape.holes.push(p)
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 3 })
  geo.translate(0, 0, -T / 2)
  const tex = paintFrame(f)
  tex.repeat.set(-1 / (XW * 2), 1 / H)
  tex.offset.set(0.5, 0)
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
  const gilt = flat('#b8860b', { metalness: 0.5, roughness: 0.35 })
  const mesh = new THREE.Mesh(geo, [face, gilt])
  mesh.castShadow = true
  mesh.receiveShadow = true
  ctx.root.add(mesh)
  // Colliders: full-height posts between holes, lintels over them, sills under the raised ones.
  const body = ctx.phys.kinematic({ x: 0, y: 0, z: frameZ(f, ctx.time) })
  const box = (x0: number, x1: number, y0: number, y1: number) => {
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02) return
    ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, T / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, 0), { friction: 0.2, groups: PROP_GROUPS })
  }
  const holes = [...f.holes].sort((a, b) => a.x - b.x)
  let cur = -XW
  for (const hole of holes) {
    const k = KINDS[hole.k]
    box(cur, hole.x - k.w / 2, 0, H)
    box(hole.x - k.w / 2, hole.x + k.w / 2, k.y1, H)
    if (k.y0 > 0) box(hole.x - k.w / 2, hole.x + k.w / 2, 0, k.y0)
    cur = hole.x + k.w / 2
  }
  box(cur, XW, 0, H)
  s.built.set(f.id, { body, mesh, mats: [face, gilt], tex })
}

/** Create and remove frame bodies/meshes to match the synced list (every screen). */
function syncFrames(ctx: LevelCtx, s: FrameState) {
  for (const f of s.frames) if (!s.built.has(f.id)) buildFrame(ctx, s, f)
  for (const [id, b] of s.built) {
    if (s.frames.some((f) => f.id === id)) continue
    ctx.phys.remove(b.body)
    b.mesh.removeFromParent()
    b.mesh.geometry.dispose()
    for (const m of b.mats) m.dispose()
    b.tex.dispose()
    s.built.delete(id)
  }
}

/** The next frame that has not reached the toys yet (front face still ahead of z). */
function nextFrame(s: FrameState, t: number, z = -0.5) {
  let best: Frame | null = null
  for (const f of s.frames) {
    if (frameZ(f, t) - T / 2 < z) continue
    if (!best || arriveAt(f, z) < arriveAt(best, z)) best = f
  }
  return best
}

/** Standing slots along each hole of a frame (shifted where the frame is going to be). */
function slots(f: Frame, t: number) {
  const out: { x: number; k: number }[] = []
  const dx = f.shift ? f.shift * (t > f.shiftAt - 0.4 ? 1 : 0) : 0
  for (const h of f.holes) {
    const k = KINDS[h.k]
    for (let i = 0; i < k.cap; i++) out.push({ x: h.x + dx + (i - (k.cap - 1) / 2) * (k.w / k.cap), k: h.k })
  }
  return out
}

/* ---------------- Scenery ---------------- */

function wallpaper() {
  return paint(256, 256, (g, w, h) => {
    g.fillStyle = '#7f9c8a'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#8fae99'
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 14, h)
    g.fillStyle = 'rgba(255,240,210,0.35)'
    for (let x = 16; x < w; x += 64)
      for (let y = 16; y < h; y += 64) {
        g.beginPath()
        g.ellipse(x + 7, y, 6, 11, 0, 0, Math.PI * 2)
        g.fill()
      }
  }, [8, 1])
}

function runner() {
  return paint(256, 512, (g, w, h) => {
    g.fillStyle = '#9f1239'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#fbbf24'
    g.lineWidth = 6
    g.strokeRect(14, 14, w - 28, h - 28)
    g.fillStyle = '#1e3a8a'
    for (let y = 60; y < h - 40; y += 80) {
      g.beginPath()
      g.moveTo(w / 2, y - 26)
      g.lineTo(w / 2 + 40, y)
      g.lineTo(w / 2, y + 26)
      g.lineTo(w / 2 - 40, y)
      g.fill()
    }
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (let i = 0; i < 1500; i++) g.fillRect((i * 37) % w, (i * 91) % h, 2, 2)
  })
}

const _m4 = new THREE.Matrix4()
const _v = new THREE.Vector3()
const _look = new THREE.Vector3()

export default defineLevel<FrameState>({
  id: 'picture-frame',
  name: 'Picture Frame Fit',
  type: 'survival',
  blurb: 'Frames slide towards you with shaped holes. Stand in the gap or get swept off.',
  howTo: [
    'Each frame has holes for 1, 2 or 4 toys: stand in one as it passes',
    'Orange JUMP holes are raised: jump just before it reaches you',
    'Not enough room? Shove your way in (or dive into a gap)',
    'Frames come faster, then two at a time',
  ],
  accent: '#d4a017',
  players: [2, 16],
  duration: 90,
  camera: { kind: 'chase', dist: 7.5, height: 1.4 },
  introOrbit: { radius: 12, height: 7, center: [0, 1, 6] },
  sprinkles: { start: 2 },
  fallY: -6,
  sky: { color: '#20160e', fogNear: 40, fogFar: 95 },

  tricks: [
    {
      id: 'glove',
      name: 'Spring Glove',
      icon: 'slam',
      cost: 2,
      cooldown: 8,
      busy: 0.6,
      target: 'rival',
      range: 9,
      desc: 'A boxing glove on a spring punches a rival sideways, out of their hole.',
      counter: 'Bubble Wrap, or claim your hole late.',
      apply: (ctx, _s, user, target) => {
        if (!target) return
        const sx = Math.sign(target.pos.x - user.pos.x) || (ctx.rng.chance(0.5) ? 1 : -1)
        ctx.knock(target, { x: sx * 8, y: 3, z: 0 }, 0.5, user)
        ctx.emit({ k: 'glove', a: user.idx, b: target.idx })
        ctx.fx.sfx('boing', target.pos)
        ctx.fx.hitStop(0.06)
      },
      botUse: (ctx, s, user) => {
        // Punch whoever is in the hole we want, just before the frame arrives.
        const f = nextFrame(s, ctx.time)
        if (!f || arriveAt(f, 1) - ctx.time > 1.6) return false
        let best: Toy | null = null, bd = 2.5
        for (const t of ctx.toys) {
          if (t === user || t.status !== 'play') continue
          const d = t.pos.distanceTo(user.pos)
          if (d < bd) {
            bd = d
            best = t
          }
        }
        return best ?? false
      },
    },
    {
      id: 'tape',
      name: 'Sticky Tape',
      icon: 'tack',
      cost: 2,
      cooldown: 10,
      busy: 0.5,
      target: 'rival',
      desc: "Tape a rival's feet to the floor: 3 seconds of shuffling, no jumping.",
      counter: 'Get to your hole early and stay put.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.tape[target.idx] = ctx.time + 3
        ctx.fx.sfx('snip', target.pos)
        ctx.fx.popup(target, 'Taped!', '#d1d5db')
      },
      botUse: (ctx, s, user) => {
        const f = nextFrame(s, ctx.time)
        if (!f || arriveAt(f, 1) - ctx.time > 3.5) return false
        const r = ctx.toys.filter((t) => t !== user && t.status === 'play' && s.tape[t.idx] < ctx.time)
        return r.length ? ctx.rng.pick(r) : false
      },
    },
    {
      id: 'shift',
      name: 'Shift the Frame',
      icon: 'frame',
      cost: 4,
      cooldown: 12,
      busy: 1,
      once: true,
      minSpice: 1,
      target: 'none',
      desc: 'Nudge the next frame: it slides 1.6 m sideways just before it arrives. Everyone has to adjust, you too.',
      counter: 'Watch the gilt rims, not the floor marks, in the last second.',
      can: (ctx, s) => {
        const f = nextFrame(s, ctx.time, 1)
        if (!f || f.shift) return 'No frame to shift'
        return arriveAt(f, 1) - ctx.time > 1.6 ? true : 'Too late for this one'
      },
      apply: (ctx, s) => {
        const f = nextFrame(s, ctx.time, 1)
        if (!f) return
        f.shift = ctx.rng.chance(0.5) ? 1.6 : -1.6
        f.shiftAt = r1(arriveAt(f, 1) - 1.1)
        ctx.fx.say('THE NEXT FRAME IS GOING TO SHIFT!', '#fbbf24', 1.4)
      },
      botUse: (ctx, s) => {
        const f = nextFrame(s, ctx.time, 1)
        return f && !f.shift && arriveAt(f, 1) - ctx.time > 2.5 && ctx.rng.chance(0.3) ? null : false
      },
    },
    bubbleWrap<FrameState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 30, hd: 56, ridge: 40, knee: 14, y: -12, lights: ctx.quality === 'low' ? 30 : 50, quality: ctx.quality })
    // The hallway floor: a raised slab ending at the landing's edge, over the stairwell.
    const len = Z_SPAWN + 4 - EDGE
    ctx.phys.box({ x: 0, y: -0.5, z: EDGE + len / 2 }, { x: W + 2, y: 0.5, z: len / 2 }, { friction: 0.8 })
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 4, 1, len), [
      flat('#5b3a22'), flat('#5b3a22'), new THREE.MeshStandardMaterial({ map: paint(64, 512, (g, w, h) => {
        g.fillStyle = '#a0703f'
        g.fillRect(0, 0, w, h)
        g.fillStyle = 'rgba(60,30,10,0.35)'
        for (let y = 0; y < h; y += 24) g.fillRect(0, y, w, 2)
        g.fillRect(w / 2, 0, 2, h)
      }, [3, len / 6]), roughness: 0.8 }), flat('#5b3a22'), flat('#4a2e1a'), flat('#4a2e1a'),
    ])
    floor.position.set(0, -0.5, EDGE + len / 2)
    floor.receiveShadow = true
    ctx.root.add(floor)
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.4, FRONT - EDGE - 0.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: runner(), roughness: 1 }))
    rug.position.set(0, 0.01, (EDGE + FRONT) / 2)
    rug.receiveShadow = true
    ctx.root.add(rug)
    // Walls with wallpaper and a dado rail, solid for toys.
    const paper = new THREE.MeshStandardMaterial({ map: wallpaper(), roughness: 0.9 })
    ;(paper.map as THREE.Texture).repeat.set(len / 4, 1.6)
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, len), paper)
      wall.position.set(sx * (W + 0.3), 3.5, EDGE + len / 2)
      wall.receiveShadow = true
      ctx.root.add(wall)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, len), flat('#6b4423'))
      rail.position.set(sx * W, 1.2, EDGE + len / 2)
      ctx.root.add(rail)
      ctx.phys.box({ x: sx * (W + 0.3), y: 4, z: EDGE + len / 2 }, { x: 0.3, y: 4, z: len / 2 })
      // Little framed pictures along the wall.
      for (let i = 0; i < 4; i++) {
        const z = 9 + i * 8 + (sx > 0 ? 4 : 0)
        const art = new THREE.Mesh(rbox(0.15, 1.6, 2.2, 0.05, 1), [
          new THREE.MeshStandardMaterial({ map: paint(64, 64, (g, w, h) => {
            g.fillStyle = ['#fde68a', '#bae6fd', '#fbcfe8', '#bbf7d0'][i]
            g.fillRect(0, 0, w, h)
            g.fillStyle = ['#ea580c', '#0369a1', '#be185d', '#15803d'][i]
            g.beginPath()
            g.arc(w / 2, h * 0.45, 14, 0, Math.PI * 2)
            g.fill()
            g.fillRect(w * 0.3, h * 0.62, w * 0.4, h * 0.3)
          }) }),
          flat('#b8860b'), flat('#b8860b'), flat('#b8860b'), flat('#b8860b'), flat('#b8860b'),
        ])
        art.position.set(sx * (W - 0.05), 3.2, z)
        art.rotation.y = sx > 0 ? Math.PI : 0
        ctx.root.add(art)
      }
    }
    // Keep toys on the landing (frames pass through this; it only stops toys).
    ctx.phys.box({ x: 0, y: 3, z: FRONT + 0.5 }, { x: W, y: 3, z: 0.5 })
    // The landing's edge: a newel post and banister stubs, and the stairwell drop.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 1.2, 0.3, 0.3), flat('#e7c78f'))
    edge.position.set(0, 0.02, EDGE + 0.15)
    ctx.root.add(edge)
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 0.7), flat('#6b4423'))
      post.position.set(sx * (W - 0.4), 1.6, EDGE + 0.4)
      post.castShadow = true
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), flat('#6b4423'))
      cap.position.set(sx * (W - 0.4), 3.4, EDGE + 0.4)
      ctx.root.add(post, cap)
      ctx.phys.box({ x: sx * (W - 0.4), y: 1.6, z: EDGE + 0.4 }, { x: 0.35, y: 1.6, z: 0.35 })
    }
    const sign = textSprite('Mind the stairs!', { bg: '#7c2d12', size: 0.7 })
    sign.position.set(0, 3.4, EDGE - 0.2)
    ctx.root.add(sign)
    // Steps going down into the dark.
    for (let i = 0; i < 6; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(W * 1.6, 0.4, 1.2), flat(i % 2 ? '#5b3a22' : '#6b4423'))
      step.position.set(0, -2.2 - i * 1.6, EDGE - 2.6 - i * 1.4)
      ctx.root.add(step)
    }
  },

  init(ctx) {
    const st: FrameState = {
      frames: [],
      nextId: 0,
      nextArrive: 7,
      tape: ctx.toys.map(() => 0),
      passed: new Set(),
      built: new Map(),
      vis: { patches: null, patchCol: new THREE.Color(), gloves: [], tape: null, whoosh: new Set() },
    }
    // Light patches on the floor that show where the next frame's holes will be.
    const patches = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
      12,
    )
    patches.count = 0
    patches.renderOrder = 2
    patches.frustumCulled = false
    ctx.root.add(patches)
    st.vis.patches = patches
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group()
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), soft('#dc2626', { roughness: 0.4 }))
      glove.scale.set(1, 0.85, 1.2)
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 10).rotateX(Math.PI / 2), soft('#fef2f2'))
      cuff.position.z = -0.42
      const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6).rotateX(Math.PI / 2), flat('#9ca3af', { metalness: 0.7 }))
      spring.position.z = -1
      g.add(glove, cuff, spring)
      g.visible = false
      ctx.root.add(g)
      st.vis.gloves.push({ mesh: g, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() })
    }
    const tape = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.1, 0.35).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#d4d4d8', roughness: 0.3, transparent: true, opacity: 0.85 }),
      16,
    )
    tape.count = 0
    ctx.root.add(tape)
    st.vis.tape = tape
    // Frames slide on every screen from the synced list; tape is predicted on the taped toy's own screen.
    ctx.hazards.add({
      predict: true,
      update(c, t) {
        for (const f of st.frames) {
          const b = st.built.get(f.id)
          if (b) b.body.setNextKinematicTranslation({ x: frameX(f, t), y: 0, z: frameZ(f, t) })
        }
        void c
      },
      affect(c, toy) {
        if (toy.status !== 'play' || st.tape[toy.idx] <= c.time || toy.mode !== 'walk') return
        const lv = toy.body.linvel()
        const sp = Math.hypot(lv.x, lv.z)
        const k = sp > 1.5 && toy.stun <= 0 ? 1.5 / sp : 1
        toy.body.setLinvel({ x: lv.x * k, y: Math.min(lv.y, toy.grounded ? 0.5 : lv.y), z: lv.z * k }, true)
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnGrid(n, { x: 0, z: 0.6, yaw: 0, spacing: 1.5, cols: Math.min(n, 8) })[i]
  },

  tick(ctx, s, dt) {
    const t = ctx.time
    const active = ctx.active()
    const press = ctx.mode === 'show' ? Math.max(0, (t / 90 - 0.45) / 0.55) * (active.length > ctx.target ? 1 : 0.2) : 0
    // Launch frames so they reach the toys on schedule; later ones come faster and in pairs.
    const speed = Math.min(10, 5 + t * 0.045 + press * 1.5)
    if (t + Z_SPAWN / speed >= s.nextArrive && t < 86) {
      const doubled = t > 32 && ctx.rng.chance(0.35 + press * 0.3)
      const n = active.length
      const lose = ctx.mode === 'show' ? (t < 15 ? ctx.rng.int(0, 2) : t < 45 ? ctx.rng.int(1, 3) : ctx.rng.int(1, 4)) : 1
      const make = (arrive: number, cap: number, sp: number) => {
        const f: Frame = { id: s.nextId++, t0: 0, speed: r1(sp), shift: 0, shiftAt: 0, holes: holesFor(ctx, Math.max(1, cap), t > 10) }
        f.t0 = r2(arrive - (Z_SPAWN - T / 2 - 1) / f.speed)
        s.frames.push(f)
      }
      make(s.nextArrive, n - lose, speed)
      if (doubled) make(s.nextArrive + ctx.rng.range(0.9, 1.3), n - (ctx.mode === 'show' ? ctx.rng.int(0, 2) : 0), speed)
      s.nextArrive += Math.max(4.2, 7.5 - t * 0.04 - press * 1.5) + (doubled ? 1.5 : 0)
    }
    // Retire frames that have gone past the landing; everyone still standing earns a Sprinkle.
    for (const f of s.frames) {
      if (frameZ(f, t) < EDGE - 2 && !s.passed.has(f.id)) {
        s.passed.add(f.id)
        for (const a of active) ctx.addSprinkles(a, 1)
      }
    }
    const before = s.frames.length
    s.frames = s.frames.filter((f) => frameZ(f, t) > Z_END)
    if (s.frames.length !== before || s.frames.some((f) => !s.built.has(f.id))) syncFrames(ctx, s)
    void dt
  },

  bot(ctx, s, toy, dt) {
    const sk = skill(ctx)
    const t = ctx.time
    const d = toy.data as { fid?: number; sx?: number; jumped?: number; jitter?: number }
    const f = nextFrame(s, t, toy.pos.z - 0.2)
    if (!f) {
      steerTo(toy, (toy.idx % 5) * 2 - 4, 1.5, { pace: 0.5, stop: 0.5 })
      return
    }
    const eta = arriveAt(f, toy.pos.z + 0.3) - t
    if (eta > 7) {
      steerTo(toy, (toy.idx % 5) * 2 - 4, 1.5, { pace: 0.5, stop: 0.5 })
      return
    }
    // Claim a slot: nearest one that fewer toys are already heading for.
    if (d.fid !== f.id || (f.shift && t > f.shiftAt - 0.4 + sk.reaction && d.jitter !== f.shiftAt)) {
      if (f.shift && t > f.shiftAt - 0.4) d.jitter = f.shiftAt
      d.fid = f.id
      const sl = slots(f, t)
      let best = sl[0], bs = -1e9
      for (const slot of sl) {
        let taken = 0
        for (const o of ctx.toys) {
          if (o === toy || o.status !== 'play') continue
          const od = o.data as { fid?: number; sx?: number }
          if (od.fid === f.id && Math.abs((od.sx ?? 99) - slot.x) < 0.4) taken++
        }
        const sc = -Math.abs(slot.x - toy.pos.x) * 0.5 - taken * 4 + ctx.rng.range(-0.6, 0.6) + (slot.k === 3 ? -0.8 * (1 - sk.accuracy) * 5 : 0)
        if (sc > bs) {
          bs = sc
          best = slot
        }
      }
      d.sx = best.x
    }
    const sx = d.sx ?? 0
    steerTo(toy, sx, 0.8, { pace: sk.pace, stop: 0.15 })
    // Jump holes: leave the ground about a quarter second before the frame's sill reaches us.
    const hole = f.holes.find((h) => Math.abs(h.x + frameX(f, t) - sx) < KINDS[h.k].w / 2 + 0.1)
    const ttc = (frameZ(f, t) - T / 2 - 0.3 - toy.pos.z) / f.speed
    if (hole && hole.k === 3 && toy.grounded && Math.abs(toy.pos.x - sx) < 0.9 && ttc < 0.27 + (1 - sk.accuracy) * ctx.rng.range(-0.5, 0.5) && ttc > 0.05 && d.jumped !== f.id) {
      d.jumped = f.id
      toy.pad.jump = true
    }
    // Someone in our spot as it arrives: shove them out (or dive in).
    if (eta < 1.6) {
      for (const o of ctx.toys) {
        if (o === toy || o.status !== 'play') continue
        if (Math.abs(o.pos.x - sx) < 0.45 && o.pos.distanceTo(toy.pos) < 1.4 && ctx.rng.chance(sk.aggression * 4 * dt)) {
          toy.pad.mx = o.pos.x - toy.pos.x
          toy.pad.mz = o.pos.z - toy.pos.z
          toy.pad.shove = true
        }
      }
      if (Math.abs(toy.pos.x - sx) > 1.8 && eta < 0.7 && ctx.rng.chance(sk.accuracy * 0.5)) toy.pad.dive = true
    }
  },

  rank(ctx) {
    return ctx.active().sort((a, b) => b.pos.z - a.pos.z)
  },
  onTimeUp(ctx, s) {
    survivalTimeUp(ctx, this.rank!(ctx, s), 'front of the landing', "too far back")
  },

  onFall(ctx, _s, toy) {
    ctx.fail(toy, 'swept down the stairs')
  },

  retry(ctx, _s, toy) {
    ctx.respawn(toy, { x: ctx.rng.range(-3, 3), y: 0, z: 1.5, yaw: 0 }, 1)
  },

  pack(_c, s) {
    return [s.frames.map((f) => [f.id, f.t0, f.speed, f.shift, f.shiftAt, ...f.holes.flatMap((h) => [h.x, h.k])]), s.tape.map(r1)]
  },

  unpack(ctx, s, d) {
    const [frames, tape] = d as [number[][], number[]]
    s.frames = frames.map((row) => {
      const holes: Frame['holes'] = []
      for (let i = 5; i < row.length; i += 2) holes.push({ x: row[i], k: row[i + 1] })
      return { id: row[0], t0: row[1], speed: row[2], shift: row[3], shiftAt: row[4], holes }
    })
    s.tape = tape
    syncFrames(ctx, s)
  },

  onEvent(ctx, s, data) {
    const e = data as { k?: string; a?: number; b?: number }
    if (e.k !== 'glove') return
    const a = ctx.toys[e.a ?? -1], b = ctx.toys[e.b ?? -1]
    const g = s.vis.gloves.find((x) => x.t <= 0)
    if (!a || !b || !g) return
    g.t = 0.45
    const side = Math.sign(b.pos.x - a.pos.x) || 1
    g.from.set(b.pos.x - side * 2.4, b.pos.y + 0.1, b.pos.z)
    g.to.set(b.pos.x - side * 0.3, b.pos.y + 0.1, b.pos.z)
    ctx.fxLocal.puff(b.pos, 'spark', 10)
  },

  visual(ctx, s, dt) {
    const t = ctx.time
    const v = s.vis
    // Frames: fade the ones that have passed the camera's toy so they don't fill the screen.
    const fz = ctx.cam.focus.z
    for (const f of s.frames) {
      const b = s.built.get(f.id)
      if (!b) continue
      const z = frameZ(f, Math.max(0, t))
      b.mesh.position.set(frameX(f, t), 0, z)
      const behind = z < fz - 0.6
      for (const m of b.mats) {
        if (m.transparent !== behind) {
          m.transparent = behind
          m.opacity = behind ? 0.22 : 1
          m.depthWrite = !behind
          m.needsUpdate = true
        }
      }
      b.mesh.castShadow = !behind
      // A whoosh as it reaches the landing.
      if (!v.whoosh.has(f.id) && z < FRONT + 1) {
        v.whoosh.add(f.id)
        ctx.fxLocal.sfx('whoosh', { x: 0, y: 1, z: FRONT })
        ctx.fxLocal.shake(0.12)
      }
    }
    // Floor patches for the next frame's holes, brightening as it nears.
    const p = v.patches
    if (p) {
      const f = nextFrame(s, t, 0)
      let n = 0
      if (f && ctx.phase === 'play') {
        const eta = arriveAt(f, 1) - t
        const k = THREE.MathUtils.clamp(1 - (eta - 1) / 4, 0, 1)
        ;(p.material as THREE.MeshBasicMaterial).opacity = 0.18 + k * 0.35 + (eta < 1.2 ? Math.sin(t * 20) * 0.1 : 0)
        const dx = frameX(f, Math.max(t, f.shift ? f.shiftAt + 1 : t))
        for (const h of f.holes) {
          if (n >= 12) break
          const kk = KINDS[h.k]
          _m4.makeScale(kk.w, 1, FRONT - EDGE - 1.2).setPosition(h.x + (t > f.shiftAt - 0.2 && f.shift ? dx : 0), 0.03, (EDGE + FRONT) / 2)
          p.setMatrixAt(n, _m4)
          p.setColorAt(n, v.patchCol.set(h.k === 3 ? '#fb923c' : '#fef08a'))
          n++
        }
      }
      p.count = n
      p.instanceMatrix.needsUpdate = true
      if (p.instanceColor) p.instanceColor.needsUpdate = true
    }
    // Boxing gloves.
    for (const g of v.gloves) {
      if (g.t <= 0) {
        g.mesh.visible = false
        continue
      }
      g.t -= dt
      const k = g.t > 0.3 ? 1 - (g.t - 0.3) / 0.15 : g.t / 0.3
      g.mesh.visible = true
      g.mesh.position.lerpVectors(g.from, g.to, THREE.MathUtils.clamp(k, 0, 1))
      g.mesh.lookAt(_v.copy(g.to).multiplyScalar(2).sub(g.from))
    }
    // Tape under taped toys.
    if (v.tape) {
      let n = 0
      for (const toy of ctx.toys) {
        if (toy.status !== 'play' || (s.tape[toy.idx] ?? 0) <= t || n >= 16) continue
        _m4.makeRotationY(toy.idx).setPosition(toy.pos.x, toy.feet + 0.02, toy.pos.z)
        v.tape.setMatrixAt(n++, _m4)
      }
      v.tape.count = n
      v.tape.instanceMatrix.needsUpdate = true
    }
  },

  cameraUpdate(ctx, _s, cam, dt) {
    // Behind the toys, looking down the hallway at the frames coming.
    const me = ctx.me
    if (!me || me.status === 'failed' || ctx.phase === 'intro') return false
    cam.yaw = 0
    cam.focus.set(me.pos.x, me.pos.y, me.pos.z)
    _v.set(me.pos.x * 0.7, Math.max(4.2, me.pos.y + 4), Math.min(me.pos.z, 3) - 6.6)
    _look.set(me.pos.x * 0.85, 1.1, me.pos.z + 5)
    cam.place(_v, _look, dt, 6)
    return true
  },

  hud(ctx, s, me) {
    const t = ctx.time
    const f = nextFrame(s, t, 0)
    const chips: string[] = []
    let status: { text: string; color: string; pulse?: boolean } | undefined
    let prompt: string | undefined
    if (f && ctx.phase === 'play') {
      const eta = arriveAt(f, 1) - t
      const room = f.holes.reduce((a, h) => a + KINDS[h.k].cap, 0)
      chips.push(`Next frame: room for ${room}`, `${Math.max(0, eta).toFixed(1)} s`)
      if (eta < 2.2) status = { text: 'GET IN A HOLE!', color: '#fbbf24', pulse: true }
      if (me && me.status === 'play') {
        const mine = f.holes.find((h) => Math.abs(h.x + frameX(f, t) - me.pos.x) < KINDS[h.k].w / 2)
        if (mine && mine.k === 3) prompt = 'JUMP hole: jump just before the frame reaches you!'
        else if (!mine && eta < 3) prompt = 'Find a gap in the frame: the glowing strips on the floor!'
        else if (s.tape[me.idx] > t) prompt = 'Taped down! Shuffle into place.'
      }
    }
    return { chips, status, prompt }
  },
})
