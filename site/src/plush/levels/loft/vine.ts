// Vine Swing (Houseplant Jungle): nine vines hang from a bamboo hoop round a giant potted plant. Swing on a
// leaf, let go with Space near the top of the swing to fly, and press Space again as you reach the next leaf
// to grab it. Miss and you drop into the planter. Leaves wilt for a while after you leave them. Score: metres
// travelled round the hoop in 60 seconds.
import * as THREE from 'three'
import type { LevelCtx, Toy } from '../../engine/types'
import { FOOT } from '../../engine/toy'
import { Batch, G, keepMat, T } from './kit'
import { JUNGLE } from './layout'
import { claim, nearPrompt, scoreEvent, station, stationTick, type LoftActivity, type Station } from './station'

const R = JUNGLE.ring
const GRAV = 9
const AMP = 0.85
const LIMIT = 60
const WILT = 11

/** mode: 0 idle, 1 swinging, 2 flying, 3 falling, 4 landed (short pause before the score). */
export interface VineState extends Station {
  mode: number
  vine: number
  /** Arc position of the held vine's anchor (keeps counting up as you loop the hoop). */
  base: number
  /** Pendulum angle and angular speed (positive swings forward round the hoop). */
  th: number
  om: number
  /** Rope length for the current vine (catching low or high changes it). */
  len: number
  /** Position along the hoop (arc metres) and height, plus flight velocity. */
  s: number
  y: number
  vs: number
  vy: number
  dist: number
  t0: number
  endT: number
  /** Seconds each vine stays wilted (synced, rounded). */
  wilt: number[]
  /** Visuals: per-vine pose helpers (not rendered) feeding two instanced meshes, ropes and leaves. */
  vines: THREE.Group[]
  ropes: THREE.InstancedMesh | null
  leaves: THREE.InstancedMesh | null
  sign: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; last: string } | null
}

const N = R.n
const SPACING = (Math.PI * 2 * R.r) / N
/** Vine i's angle round the hoop; vine 0 faces the start pad. */
const A0 = Math.atan2(JUNGLE.start.z - R.z, JUNGLE.start.x - R.x)
const angOf = (s: number) => A0 + s / R.r
const vineS = (i: number) => i * SPACING

function world(s: number, y: number, out: THREE.Vector3) {
  const a = angOf(s)
  return out.set(R.x + Math.cos(a) * R.r, y, R.z + Math.sin(a) * R.r)
}

const _v = new THREE.Vector3()
const _look = new THREE.Vector3()
const BROWN = new THREE.Color('#8a6b3a')
const GREEN = new THREE.Color('#3f9b4f')
const _c = new THREE.Color()

export const vineSwing: LoftActivity<VineState> = {
  id: 'vine',

  build(ctx) {
    // Start pad: stacked pots as steps by the ring.
    const b = new Batch()
    const S = JUNGLE.start
    b.add(G.cyl, '#c2410c', T(S.x, 0.25, S.z, 0, 0, 0, 1.6, 0.5, 1.6))
    b.add(G.cyl, '#fef3c7', T(S.x, 0.52, S.z, 0, 0, 0, 1.4, 0.04, 1.4))
    b.flush(ctx.root, { key: 'vinepad' })
    ctx.phys.cylinder({ x: S.x, y: 0.25, z: S.z }, 0.25, 0.8)
  },

  init(ctx) {
    const vines: THREE.Group[] = []
    const ropeMat = keepMat('l:vine', () => new THREE.MeshStandardMaterial({ color: '#4d7c0f', roughness: 0.9, flatShading: true }))
    const leafMat = keepMat('l:leaf', () => new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true, side: THREE.DoubleSide }))
    const ropes = new THREE.InstancedMesh(G.cyl6, ropeMat, N)
    const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 6), leafMat, N)
    ropes.frustumCulled = leaves.frustumCulled = false
    leaves.castShadow = true
    for (let i = 0; i < N; i++) {
      // Pose helper: local x runs along the hoop (the swing plane), the rope hangs down local -y.
      const g = new THREE.Group()
      world(vineS(i), R.anchorY, _v)
      g.position.copy(_v)
      g.rotation.y = -angOf(vineS(i)) - Math.PI / 2
      const rope = new THREE.Object3D()
      const leaf = new THREE.Object3D()
      g.add(rope, leaf)
      vines.push(g)
      leaves.setColorAt(i, GREEN)
    }
    ctx.root.add(ropes, leaves)
    // The distance sign: a big leaf-shaped board by the start.
    const cvs = document.createElement('canvas')
    cvs.width = 256
    cvs.height = 128
    const tex = new THREE.CanvasTexture(cvs)
    tex.colorSpace = THREE.SRGBColorSpace
    const sign = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }))
    sign.scale.set(1.1, 0.6, 1)
    const S = JUNGLE.start
    sign.position.set(S.x - 1.4, 1.8, S.z + 0.7)
    sign.rotation.y = Math.atan2(-(S.x - 1.4), -(S.z + 0.7))
    ctx.root.add(sign)
    const post = new THREE.Mesh(G.cyl6, ropeMat)
    post.scale.set(0.08, 1.4, 0.08)
    post.position.set(S.x - 1.4, 0.7, S.z + 0.7)
    ctx.root.add(post)
    return {
      ...station(), mode: 0, vine: 0, base: 0, th: 0, om: 0, len: R.rope, s: 0, y: 0, vs: 0, vy: 0, dist: 0, t0: 0, endT: 0, wilt: new Array(N).fill(0),
      vines, ropes, leaves, sign: { tex, g: cvs.getContext('2d')!, last: '' },
    }
  },

  tick(ctx, s, dt) {
    for (let i = 0; i < N; i++) s.wilt[i] = Math.max(0, s.wilt[i] - dt)
    const join = stationTick(ctx, s, JUNGLE.start, 1.6, 'Vine Swing')
    if (join) start(ctx, s, join)
    const toy = s.player >= 0 ? ctx.toys[s.player] : null
    if (!toy) {
      s.player = -1
      s.mode = 0
      return
    }
    const press = toy.pad.jump || toy.pad.act
    const el = ctx.time - s.t0
    if (s.mode === 1) {
      // A pendulum that keeps its swing up (the toy pumps its legs).
      s.om += (-(GRAV / s.len) * Math.sin(s.th)) * dt
      const e = 0.5 * s.om * s.om * s.len - GRAV * Math.cos(s.th)
      const want = -GRAV * Math.cos(AMP)
      s.om *= 1 + THREE.MathUtils.clamp((want - e) * 0.02, -0.02, 0.02)
      s.th += s.om * dt
      s.s = s.base + Math.sin(s.th) * s.len
      s.y = R.anchorY - Math.cos(s.th) * s.len
      if (press && el > 0.3) {
        s.mode = 2
        s.vs = s.om * s.len * Math.cos(s.th)
        s.vy = s.om * s.len * Math.sin(s.th)
        s.wilt[s.vine] = WILT
        ctx.fx.sfx('whoosh', toy.pos)
      }
    } else if (s.mode === 2 || s.mode === 3) {
      const before = s.s
      s.s += s.vs * dt
      s.vy -= GRAV * dt
      s.y += s.vy * dt
      if (s.s > before) s.dist += s.s - before
      if (s.mode === 2 && press) {
        // Grab the nearest fresh leaf in reach, or flail and drop.
        let got = -1
        for (let k = -1; k <= 2; k++) {
          const i = (((s.vine + k) % N) + N) % N
          if (k === 0 || s.wilt[i] > 0) continue
          const ds = s.s - nearestS(s.s, i)
          const leafY = R.anchorY - R.rope
          if (Math.abs(ds) < 0.95 && s.y > leafY - 0.75 && s.y < leafY + 0.9) got = i
        }
        if (got >= 0) {
          const base = nearestS(s.s, got)
          const dx = s.s - base, dy = R.anchorY - s.y
          s.vine = got
          s.len = THREE.MathUtils.clamp(Math.hypot(dx, dy), R.rope - 0.6, R.rope + 0.4)
          s.th = Math.atan2(dx, dy)
          // Keep the momentum along the swing.
          s.om = (s.vs * Math.cos(s.th) + s.vy * Math.sin(s.th)) / s.len
          s.s = base + Math.sin(s.th) * s.len
          s.mode = 1
          s.base = base
          ctx.fx.sfx('squeak', toy.pos)
          ctx.fx.popup(toy, `${s.dist.toFixed(1)} m`, '#86efac')
        } else {
          s.mode = 3
          ctx.fx.popup(toy, 'Missed!', '#fca5a5')
        }
      }
      if (s.y < JUNGLE.bed.h + 0.05) {
        // Into the planter.
        world(s.s, JUNGLE.bed.h, _v)
        ctx.fx.puff({ x: _v.x, y: JUNGLE.bed.h + 0.2, z: _v.z }, 'crumbs', 22)
        ctx.fx.sfx('thud', _v)
        finish(ctx, s, toy, 'Into the pot!')
        return
      }
    }
    if (s.mode === 1 || s.mode === 2 || s.mode === 3) {
      if (el > LIMIT) {
        finish(ctx, s, toy, "Time's up!")
        return
      }
      if (toy.pad.dive) {
        finish(ctx, s, toy, 'Dropped off')
        return
      }
      // The toy hangs under the leaf (seated: the host moves it).
      world(s.s, s.y - 0.95, _v)
      const yaw = -angOf(s.s) + (s.vs < 0 || (s.mode === 1 && s.om < 0) ? Math.PI : 0)
      toy.seat = { x: _v.x, y: _v.y + FOOT, z: _v.z, yaw }
      toy.pos.set(_v.x, _v.y + FOOT, _v.z)
      toy.yaw = yaw
    }
  },

  visual(ctx, s) {
    const t = ctx.time
    if (!s.ropes || !s.leaves) return
    for (let i = 0; i < N; i++) {
      const g = s.vines[i]
      const held = s.mode === 1 && s.vine === i
      g.rotation.z = held ? s.th : Math.sin(t * 0.9 + i * 1.3) * 0.05
      const w = s.wilt[i] > 0 ? Math.min(1, s.wilt[i] / 2) : 0
      const len = held ? s.len : R.rope
      const [rope, leaf] = g.children
      rope.scale.set(0.05, len, 0.05)
      rope.position.y = -len / 2
      leaf.position.y = -len
      leaf.rotation.x = w * 0.9
      leaf.scale.set(1.5, 0.14 * (1 - w * 0.5), 0.95 * (1 - w * 0.25))
      g.updateMatrixWorld(true)
      s.ropes.setMatrixAt(i, rope.matrixWorld)
      s.leaves.setMatrixAt(i, leaf.matrixWorld)
      s.leaves.setColorAt(i, _c.copy(GREEN).lerp(BROWN, w))
    }
    s.ropes.instanceMatrix.needsUpdate = true
    s.leaves.instanceMatrix.needsUpdate = true
    if (s.leaves.instanceColor) s.leaves.instanceColor.needsUpdate = true
    // The player hangs from the leaf, arms up.
    const p = s.player >= 0 ? ctx.toys[s.player] : null
    for (const toy of ctx.toys) if (toy.animHint === 'hang' && toy !== p) toy.animHint = ''
    if (p) p.animHint = s.mode === 3 ? 'knock' : s.mode >= 1 ? 'hang' : ''
    // Sign: this run or the best on this screen.
    const sg = s.sign
    if (sg) {
      const text = s.player >= 0 ? `${s.dist.toFixed(1)} m` : 'Vine Swing'
      if (text !== sg.last) {
        sg.last = text
        const g = sg.g
        g.fillStyle = '#3f9b4f'
        g.fillRect(0, 0, 256, 128)
        g.strokeStyle = '#dcfce7'
        g.lineWidth = 4
        g.beginPath()
        g.moveTo(10, 64)
        g.lineTo(246, 64)
        g.stroke()
        g.fillStyle = '#f0fdf4'
        g.font = '800 46px ui-rounded, system-ui, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(text, 128, 66)
        sg.tex.needsUpdate = true
      }
    }
  },

  pack: (s) => [s.player, s.mode, s.vine, r3(s.th), r2(s.s), r2(s.y), r2(s.dist), r2(s.t0), r2(s.len), r2(s.base), s.queue.length, ...s.queue, ...s.wilt.map((w) => Math.ceil(w))],

  unpack(_ctx, s, d) {
    const a = d as number[]
    ;[s.player, s.mode, s.vine, s.th, s.s, s.y, s.dist, s.t0, s.len, s.base] = a
    const q = a[10]
    s.queue = a.slice(11, 11 + q)
    const w = a.slice(11 + q)
    for (let i = 0; i < N; i++) s.wilt[i] = w[i] ?? 0
  },

  hud(ctx, s, me) {
    if (s.player === me.idx) {
      const left = Math.max(0, LIMIT - (ctx.time - s.t0))
      return {
        status: { text: s.mode === 1 ? 'SWING' : s.mode === 2 ? 'GRAB!' : 'Whoops', color: s.mode === 2 ? '#fde68a' : '#86efac', pulse: s.mode === 2 },
        prompt: s.mode === 1 ? 'Space: let go near the top of the swing · Shift: drop off' : 'Space as you reach the next fresh leaf to grab it',
        chips: [`${s.dist.toFixed(1)} m`, `${Math.ceil(left)} s left`],
        bars: [{ label: 'Time', value: left / LIMIT, color: '#86efac', danger: left < 10 }],
      }
    }
    const S = JUNGLE.start
    if (Math.hypot(me.pos.x - S.x, me.pos.z - S.z) > 3) return null
    return nearPrompt(ctx, s, me, 'Vine Swing', `${s.dist.toFixed(1)} m`)
  },

  camera(_ctx, s, cam, me, dt) {
    if (s.player !== me.idx || s.mode === 0) return false
    // From the room side of the corner (the hoop sits against the walls), following the toy round.
    const a = angOf(s.s)
    const cx = R.x - 6.2 + Math.cos(a) * 1.5, cz = R.z + 6.2 + Math.sin(a) * 1.5
    cam.place(_v.set(cx, 5.2, cz), _look.set(me.pos.x * 0.8 + R.x * 0.2, me.pos.y - 0.2, me.pos.z * 0.8 + R.z * 0.2), dt, 4)
    return true
  },
}

/** Arc position of vine i nearest to s (the hoop loops). */
function nearestS(s: number, i: number) {
  const loop = SPACING * N
  const base = vineS(i)
  return base + Math.round((s - base) / loop) * loop
}

function start(ctx: LevelCtx, s: VineState, toy: Toy) {
  s.player = toy.idx
  s.mode = 1
  s.vine = 0
  s.len = R.rope
  s.th = -0.4
  s.om = 0.9
  s.s = vineS(0) + Math.sin(s.th) * s.len
  s.y = R.anchorY - Math.cos(s.th) * s.len
  s.dist = 0
  s.t0 = ctx.time
  s.base = 0
  for (let i = 0; i < N; i++) s.wilt[i] = 0
  claim(toy, 'vine')
  toy.release(false)
  ctx.setBodyMode(toy, 'seated')
  ctx.fx.sfx('boing', toy.pos)
  ctx.fx.say('VINE SWING', '#86efac', 1.4, toy)
}

function finish(ctx: LevelCtx, s: VineState, toy: Toy, why: string) {
  const score = Math.round(s.dist * 10) / 10
  ctx.fx.popup(toy, `${why} ${score.toFixed(1)} m`, '#fde68a')
  scoreEvent(ctx, 'vine', toy, score, true)
  ctx.fx.feed(`${toy.name} swung ${score.toFixed(1)} m in the Houseplant Jungle`)
  claim(toy, null)
  ctx.setBodyMode(toy, 'walk')
  const S = JUNGLE.start
  ctx.respawn(toy, { x: S.x + 1.2, y: 0, z: S.z + 1.2, yaw: Math.atan2(R.x - S.x, R.z - S.z) }, 0.6)
  s.player = -1
  s.mode = 0
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
