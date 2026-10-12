// Bath Bomb Bowling (Bathtub Beach): roll a fizzing bath bomb down a bath-mat lane at ten shampoo-bottle pins.
// Slide to aim, Space when the power meter peaks, then steer the spin while it rolls. Ten frames, real
// scoring (strikes and spares carry over), and a strike sends bubbles floating across the Loft.
import * as THREE from 'three'
import type { LevelCtx, Toy } from '../../engine/types'
import { PROP_GROUPS, type RigidBody } from '../../engine/physics'
import { FOOT } from '../../engine/toy'
import { ctex, keepMat } from './kit'
import { BEACH } from './layout'
import { claim, nearPrompt, scoreEvent, station, stationTick, type LoftActivity, type Station } from './station'

const L = BEACH.lane
const BALL_R = 0.3
const PIN_H = 0.78
const PIN_R = 0.15

/** Pin spots: a triangle, head pin nearest the bowler (the lane runs towards -x). */
const SPOTS: [number, number][] = []
for (let row = 0; row < 4; row++) for (let j = 0; j <= row; j++) SPOTS.push([BEACH.headPin - row * 0.5, L.z + (j - row / 2) * 0.56])

/** ph: 0 idle, 1 aim, 2 rolling, 3 settling, 4 game over (pause). */
export interface BowlState extends Station {
  ph: number
  t: number
  frame: number
  /** Pins knocked per roll, in order (the scoresheet). */
  rolls: number[]
  /** Rolls taken in this frame. */
  inFrame: number
  aim: number
  spin: number
  power: number
  /** Standing pins (bit i). */
  standing: number
  standingAtRoll: number
  /** Visuals and bodies (built on every screen). */
  ball: RigidBody | null
  pins: RigidBody[]
  pinMesh: THREE.InstancedMesh | null
  poses: THREE.Object3D[]
  /** Floating bubbles after a strike (local to each screen). */
  bubbles: { m: THREE.InstancedMesh; list: { x: number; y: number; z: number; vx: number; vz: number; age: number; s: number }[] } | null
  meter: THREE.Mesh | null
}

const _q = new THREE.Quaternion()
const _up = new THREE.Vector3()
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _one = new THREE.Vector3(1, 1, 1)

/** Total score so far from a list of rolls (ten-pin rules). */
export function bowlScore(rolls: number[]) {
  let score = 0, i = 0
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (rolls[i] === 10) {
      score += 10 + (rolls[i + 1] ?? 0) + (rolls[i + 2] ?? 0)
      i += 1
    } else if ((rolls[i] ?? 0) + (rolls[i + 1] ?? 0) === 10) {
      score += 10 + (rolls[i + 2] ?? 0)
      i += 2
    } else {
      score += (rolls[i] ?? 0) + (rolls[i + 1] ?? 0)
      i += 2
    }
  }
  return score
}

function placePins(s: BowlState, which: number) {
  s.pins.forEach((p, i) => {
    if (which & (1 << i)) {
      p.setTranslation({ x: SPOTS[i][0], y: PIN_H / 2 + 0.07, z: SPOTS[i][1] }, true)
      p.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
      p.setLinvel({ x: 0, y: 0, z: 0 }, true)
      p.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } else {
      // Swept away: parked under the floor out of the way.
      p.setTranslation({ x: SPOTS[i][0], y: -3 - i, z: SPOTS[i][1] + 30 }, true)
      p.setLinvel({ x: 0, y: 0, z: 0 }, true)
      p.sleep()
    }
  })
}

function parkBall(s: BowlState) {
  s.ball?.setTranslation({ x: L.x0 + 0.5, y: BALL_R + 0.1, z: L.z + s.aim }, true)
  s.ball?.setLinvel({ x: 0, y: 0, z: 0 }, true)
  s.ball?.setAngvel({ x: 0, y: 0, z: 0 }, true)
}

export const bathBowling: LoftActivity<BowlState> = {
  id: 'bowl',

  build() {},

  init(ctx) {
    const pinTex = ctex('shampoo', 64, 128, (g, w, h) => {
      g.fillStyle = '#fdf2f8'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#f472b6'
      g.fillRect(0, 40, w, 46)
      g.fillStyle = '#fff'
      g.font = 'bold 13px sans-serif'
      g.textAlign = 'center'
      g.fillText('BUBBLY', w / 2, 60)
      g.fillText('POP', w / 2, 76)
      g.fillStyle = '#22d3ee'
      g.fillRect(0, 86, w, 6)
      // The cap (the top of the lathe profile maps to the top of the texture).
      g.fillRect(0, 0, w, 16)
    })
    const pinGeo = new THREE.LatheGeometry(
      [[0.001, 0], [0.13, 0], [0.15, 0.08], [0.15, 0.5], [0.11, 0.6], [0.07, 0.66], [0.075, 0.68], [0.075, 0.78], [0.001, 0.78]].map(([x, y]) => new THREE.Vector2(x, y)),
      12,
    ).translate(0, -PIN_H / 2, 0)
    const pinMat = keepMat('l:pin', () => new THREE.MeshStandardMaterial({ map: pinTex, roughness: 0.35 }))
    // One instanced mesh for all ten pins; each body drives a pose helper the engine syncs.
    const pinMesh = new THREE.InstancedMesh(pinGeo, pinMat, 10)
    pinMesh.castShadow = true
    pinMesh.frustumCulled = false
    ctx.root.add(pinMesh)
    const pins: RigidBody[] = []
    const poses: THREE.Object3D[] = []
    for (let i = 0; i < 10; i++) {
      const body = ctx.phys.dynamic({ x: SPOTS[i][0], y: PIN_H / 2 + 0.07, z: SPOTS[i][1] }, { damping: 0.3 })
      ctx.phys.attach(body, ctx.RAPIER.ColliderDesc.cylinder(PIN_H / 2, PIN_R).setDensity(0.35), { friction: 0.5, restitution: 0.2, groups: PROP_GROUPS })
      const pose = new THREE.Object3D()
      ctx.syncProp(body, pose)
      pins.push(body)
      poses.push(pose)
    }
    // The bath bomb: a fizzy pastel sphere.
    const bombTex = ctex('bathbomb', 64, 64, (g, w, h) => {
      g.fillStyle = '#c4b5fd'
      g.fillRect(0, 0, w, h)
      const cols = ['#f9a8d4', '#a5f3fc', '#fef08a', '#ffffff']
      for (let i = 0; i < 70; i++) {
        g.fillStyle = cols[i % 4]
        g.beginPath()
        g.arc((i * 23) % w, (i * 41) % h, 1.5 + (i % 3), 0, Math.PI * 2)
        g.fill()
      }
    })
    const ballBody = ctx.phys.dynamic({ x: L.x0 + 0.5, y: BALL_R + 0.1, z: L.z }, { damping: 0.12, ccd: true })
    ctx.phys.attach(ballBody, ctx.RAPIER.ColliderDesc.ball(BALL_R).setDensity(3.2), { friction: 0.6, restitution: 0.15, groups: PROP_GROUPS })
    const ballMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 2), keepMat('l:bomb', () => new THREE.MeshStandardMaterial({ map: bombTex, roughness: 0.85, flatShading: true })))
    ballMesh.castShadow = true
    ctx.root.add(ballMesh)
    ctx.syncProp(ballBody, ballMesh)
    // Power meter beside the foul line (a thermometer-like bar).
    const meter = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.16), keepMat('l:meter', () => new THREE.MeshBasicMaterial({ color: '#f472b6', toneMapped: false })))
    meter.position.set(L.x0 + 0.9, 0.5, L.z - L.w / 2 - 0.6)
    meter.visible = false
    ctx.root.add(meter)
    // Bubbles that float across the Loft after a strike.
    const bm = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.5, 14, 10),
      keepMat('l:bubble', () => new THREE.MeshStandardMaterial({ color: '#e0f2fe', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.38, envMapIntensity: 2, depthWrite: false })),
      40,
    )
    bm.count = 0
    bm.frustumCulled = false
    ctx.root.add(bm)
    return {
      ...station(), ph: 0, t: 0, frame: 0, rolls: [], inFrame: 0, aim: 0, spin: 0, power: 0, standing: 1023, standingAtRoll: 1023,
      ball: ballBody, pins, pinMesh, poses, bubbles: { m: bm, list: [] }, meter,
    }
  },

  tick(ctx, s, dt) {
    const join = stationTick(ctx, s, BEACH.pad, 1.5, 'Bath Bomb Bowling')
    if (join) start(ctx, s, join)
    const toy = s.player >= 0 ? ctx.toys[s.player] : null
    if (!toy) {
      s.player = -1
      s.ph = 0
      return
    }
    s.t += dt
    // Stick across the lane (camera-relative stick, so use world z: the lane runs along x).
    const across = toy.pad.mz
    if (s.ph === 1) {
      s.aim = THREE.MathUtils.clamp(s.aim + across * dt * 1.4, -L.w / 2 + 0.35, L.w / 2 - 0.35)
      s.power = 0.5 + 0.5 * Math.abs(Math.sin(s.t * 2.1))
      toy.teleport(L.x0 + 1.15, FOOT + 0.05, L.z + s.aim, -Math.PI / 2)
      parkBall(s)
      if ((toy.pad.jump || toy.pad.act) && s.t > 0.35) {
        s.ph = 2
        s.t = 0
        s.spin = 0
        s.standingAtRoll = s.standing
        s.ball?.setLinvel({ x: -(6.5 + s.power * 9), y: 0, z: 0 }, true)
        ctx.fx.sfx('whoosh', toy.pos)
      } else if (toy.pad.dive) {
        finish(ctx, s, toy, false)
      }
      return
    }
    if (s.ph === 2) {
      // Spin control while it rolls: a sideways nudge for the first second and a half.
      const b = s.ball!
      if (s.t < 1.6) {
        s.spin = THREE.MathUtils.clamp(s.spin + across * dt * 2, -1, 1)
        const v = b.linvel()
        b.setLinvel({ x: v.x, y: v.y, z: v.z + s.spin * 3.2 * dt }, true)
      }
      const p = b.translation()
      const v = b.linvel()
      if (p.x < L.x1 + 0.6 || s.t > 6 || (s.t > 0.8 && Math.hypot(v.x, v.z) < 0.25) || p.y < -2) {
        s.ph = 3
        s.t = 0
      }
      return
    }
    if (s.ph === 3 && s.t > 1.8) {
      // Count what's still standing: upright and near its spot.
      let now = 0
      s.pins.forEach((p, i) => {
        if (!(s.standingAtRoll & (1 << i))) return
        const tr = p.translation(), q = p.rotation()
        _up.set(0, 1, 0).applyQuaternion(_q.set(q.x, q.y, q.z, q.w))
        if (_up.y > 0.8 && Math.hypot(tr.x - SPOTS[i][0], tr.z - SPOTS[i][1]) < 0.35) now |= 1 << i
      })
      const knocked = bits(s.standingAtRoll) - bits(now)
      s.rolls.push(knocked)
      s.inFrame++
      const first = s.inFrame === 1
      const tenth = s.frame === 9
      const strike = first && knocked === 10
      const spare = !first && bits(now) === 0 && !(tenth && s.rolls[s.rolls.length - 2] === 10 && s.inFrame === 2)
      if (strike || (tenth && bits(now) === 0)) {
        ctx.fx.say(strike ? 'STRIKE!' : 'SPARE!', strike ? '#f0abfc' : '#93c5fd', 1.6, toy)
        ctx.fx.feed(`${toy.name} bowled a ${strike ? 'strike' : 'spare'}!`)
        ctx.fx.confetti({ x: BEACH.headPin - 0.8, y: 0.5, z: L.z })
        ctx.emit({ k: 'bubbles', x: BEACH.headPin - 0.7, z: L.z, n: strike ? 14 : 6 })
      } else if (spare) {
        ctx.fx.say('SPARE!', '#93c5fd', 1.4, toy)
        ctx.emit({ k: 'bubbles', x: BEACH.headPin - 0.7, z: L.z, n: 6 })
      } else ctx.fx.popup(toy, knocked ? `${knocked} pin${knocked > 1 ? 's' : ''}` : 'Gutter!', knocked ? '#fde68a' : '#fca5a5')
      ctx.fx.sfx(knocked >= 7 ? 'cheer' : 'crunch', { x: BEACH.headPin, y: 0.5, z: L.z })
      // Next roll or frame.
      let frameDone: boolean
      if (!tenth) frameDone = strike || s.inFrame >= 2
      else {
        const r = s.rolls.slice(-s.inFrame)
        frameDone = s.inFrame >= 3 || (s.inFrame === 2 && r[0] + r[1] < 10 && r[0] !== 10)
      }
      if (frameDone) {
        s.frame++
        s.inFrame = 0
        s.standing = 1023
        if (s.frame >= 10) {
          finish(ctx, s, toy, true)
          return
        }
      } else s.standing = tenth && bits(now) === 0 ? 1023 : now
      placePins(s, s.standing)
      s.ph = 1
      s.t = 0
      s.aim = 0
      parkBall(s)
    }
  },

  visual(ctx, s, dt) {
    if (s.pinMesh) {
      s.poses.forEach((p, i) => s.pinMesh!.setMatrixAt(i, _m.compose(p.position, p.quaternion, _one)))
      s.pinMesh.instanceMatrix.needsUpdate = true
    }
    // The player stands at the foul line, then throws.
    const p = s.player >= 0 ? ctx.toys[s.player] : null
    for (const t of ctx.toys) if (t.animHint === 'push' && t !== p) t.animHint = ''
    if (p) p.animHint = s.ph === 2 && s.t < 0.6 ? 'push' : ''
    // Fizz trail from the bath bomb while it rolls.
    if (s.ph === 2 && s.ball) {
      const tr = s.ball.translation()
      if (Math.random() < dt * 30) ctx.fxLocal.puff({ x: tr.x + 0.2, y: tr.y, z: tr.z }, 'spark', 2)
    }
    if (s.meter) {
      s.meter.visible = s.ph === 1
      s.meter.scale.y = 0.1 + s.power * 1.4
      s.meter.position.y = s.meter.scale.y / 2
      ;(s.meter.material as THREE.MeshBasicMaterial).color.setHSL(0.9 - s.power * 0.35, 0.85, 0.6)
    }
    // Bubbles drift up and across the Loft, wobbling, then pop.
    const B = s.bubbles
    if (B) {
      let n = 0
      for (let i = B.list.length - 1; i >= 0; i--) {
        const b = B.list[i]
        b.age += dt
        b.x += b.vx * dt
        b.z += b.vz * dt
        b.y += (0.35 + Math.sin(b.age * 2 + i) * 0.15) * dt
        if (b.age > 22 || b.y > 12) {
          ctx.fxLocal.puff({ x: b.x, y: b.y, z: b.z }, 'milk', 4)
          B.list.splice(i, 1)
        }
      }
      for (const b of B.list) {
        const w = 1 + Math.sin(b.age * 5) * 0.06
        B.m.setMatrixAt(n++, _m.makeScale(b.s * w, b.s / w, b.s * w).setPosition(b.x, b.y, b.z))
      }
      B.m.count = n
      if (n) B.m.instanceMatrix.needsUpdate = true
    }
  },

  onEvent(_ctx, s, d) {
    if (d.k !== 'bubbles' || !s.bubbles) return
    const n = Number(d.n) || 6
    for (let i = 0; i < n && s.bubbles.list.length < 40; i++) {
      const a = Math.random() * Math.PI * 2
      s.bubbles.list.push({ x: Number(d.x) + Math.cos(a) * 0.5, y: 0.6 + Math.random() * 0.8, z: Number(d.z) + Math.sin(a) * 0.5, vx: 0.15 + Math.random() * 0.6, vz: -0.4 - Math.random() * 0.9, age: 0, s: 0.25 + Math.random() * 0.35 })
    }
  },

  pack: (s) => [s.player, s.ph, Math.round(s.t * 100) / 100, s.frame, s.inFrame, Math.round(s.aim * 100) / 100, Math.round(s.power * 100) / 100, s.standing, s.queue.length, ...s.queue, ...s.rolls],

  unpack(_ctx, s, d) {
    const a = d as number[]
    ;[s.player, s.ph, s.t, s.frame, s.inFrame, s.aim, s.power, s.standing] = a
    const q = a[8]
    s.queue = a.slice(9, 9 + q)
    s.rolls = a.slice(9 + q)
  },

  hud(ctx, s, me) {
    const total = bowlScore(s.rolls)
    if (s.player === me.idx) {
      return {
        status: { text: `Frame ${Math.min(10, s.frame + 1)} · ${total}`, color: '#93c5fd' },
        prompt: s.ph === 1 ? 'A/D slide · Space at full power to roll · Shift to stop' : s.ph === 2 ? 'Steer the spin with A/D!' : 'Counting pins…',
        chips: [sheet(s.rolls)],
        bars: s.ph === 1 ? [{ label: 'Power', value: s.power, color: '#f472b6' }] : [],
      }
    }
    if (Math.hypot(me.pos.x - BEACH.pad.x, me.pos.z - BEACH.pad.z) > 3) return null
    return nearPrompt(ctx, s, me, 'Bath Bomb Bowling', `${total} after ${s.frame} frames`)
  },

  camera(_ctx, s, cam, me, dt) {
    if (s.player !== me.idx || s.ph === 0) return false
    // Look down the lane (-x), so A/D slide across it.
    cam.yaw = -Math.PI / 2
    const b = s.ball?.translation()
    if (s.ph === 1 || !b) cam.place(_v.set(L.x0 + 3.6, 2.4, L.z + s.aim * 0.5), _look.set(BEACH.headPin - 1, 0.3, L.z), dt, 8)
    else cam.place(_v.set(Math.max(BEACH.headPin + 1.5, b.x + 3.4), 1.9, L.z + (b.z - L.z) * 0.5), _look.set(BEACH.headPin - 1.2, 0.3, L.z), dt, 5)
    return true
  },
}

const _look = new THREE.Vector3()

function bits(n: number) {
  let c = 0
  for (let i = 0; i < 10; i++) if (n & (1 << i)) c++
  return c
}

/** A compact scoresheet: X for strikes, / for spares. */
function sheet(rolls: number[]) {
  const out: string[] = []
  let i = 0
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    if (f === 9) {
      out.push(rolls.slice(i).map((r, k, a) => (r === 10 ? 'X' : k > 0 && a[k - 1] !== 10 && a[k - 1] + r === 10 ? '/' : r === 0 ? '-' : String(r))).join(''))
      break
    }
    if (rolls[i] === 10) {
      out.push('X')
      i++
    } else {
      const a = rolls[i], b = rolls[i + 1]
      out.push(`${a || '-'}${b === undefined ? '' : a + b === 10 ? '/' : b || '-'}`)
      i += 2
    }
  }
  return out.join(' ') || 'Frame 1'
}

function start(ctx: LevelCtx, s: BowlState, toy: Toy) {
  s.player = toy.idx
  s.ph = 1
  s.t = 0
  s.frame = 0
  s.inFrame = 0
  s.rolls = []
  s.aim = 0
  s.standing = 1023
  claim(toy, 'bowl')
  toy.release(false)
  toy.frozen = true
  placePins(s, 1023)
  parkBall(s)
  ctx.fx.say('BATH BOMB BOWLING', '#93c5fd', 1.4, toy)
}

function finish(ctx: LevelCtx, s: BowlState, toy: Toy, done: boolean) {
  const total = bowlScore(s.rolls)
  if (done) {
    ctx.fx.say(`${total} POINTS`, '#fde68a', 2.2, toy)
    ctx.fx.feed(`${toy.name} bowled ${total} at Bathtub Beach`)
    scoreEvent(ctx, 'bowl', toy, total, true)
  }
  claim(toy, null)
  toy.frozen = false
  toy.animHint = ''
  ctx.respawn(toy, { x: BEACH.pad.x, y: 0, z: BEACH.pad.z - 1.6, yaw: Math.PI }, 0.2)
  s.player = -1
  s.ph = 0
  s.standing = 1023
  placePins(s, 1023)
  parkBall(s)
}
