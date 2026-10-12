// Spinning Top Sumo (survival). Every toy rides a big bouncy ball on a round wooden stool: momentum is
// everything. Shove and dive to knock rivals off; the giant scissors snip the edge every 20 seconds so the
// stool shrinks; wandering spinning tops scatter everyone. Tricks: a thumbtack pops a rival's ball for a few
// seconds, and the magnet button drags a rival towards the cut edge.
import * as THREE from 'three'
import { prop } from '../engine/assets'
import { skill } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import type { Hazard } from '../engine/hazards'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel } from '../engine/types'

const R0 = 9
const RADII = [9, 7.6, 6.3, 5.1, 4.1, 3.3, 2.7]
const CUT_EVERY = 20
const CUT_TIME = 2.2
const WARN = 3
const TOP_R = 1.0

interface SumoState {
  cuts: number
  nextCut: number
  /** Magnet pull left per toy (seconds). */
  magnet: number[]
  /** Falls per toy (Quick Play keeps score instead of eliminating). */
  falls: number[]
  // Host only.
  alive: number[]
  topHit: Map<string, number>
  disc: (Hazard & { state: { radius: number }; shrink(to: number, at: number, seconds: number): void }) | null
  // Visuals.
  vis: { topTex: THREE.Texture | null; warn: THREE.Mesh | null; scissors: THREE.Object3D | null; tops: THREE.Object3D[]; snipT: number; topPos: THREE.Vector3[] }
}

function mat(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra })
}

/** Where top i is at round time t (the same on every screen). */
function topPos(i: number, t: number, radius: number, seed: number, out: THREE.Vector3) {
  const ph = (seed % 97) * 0.13 + i * 2.1
  const w = (0.32 + i * 0.09) * (i % 2 ? -1 : 1)
  const a = ph + t * w + 0.8 * Math.sin(t * 0.37 + i)
  const r = Math.max(0, radius - 1.6) * (0.3 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.23 + i * 2.7 + ph)))
  return out.set(Math.sin(a) * r, 0, Math.cos(a) * r)
}

function topCount(t: number) {
  return t < 45 ? 2 : 3
}

export default defineLevel<SumoState>({
  id: 'top-sumo',
  name: 'Spinning Top Sumo',
  type: 'survival',
  blurb: 'Ride a bouncy ball and knock everyone off a shrinking stool.',
  howTo: [
    'You ride a ball: steer to roll, momentum is everything',
    'Click to shove, Shift to dash: knock rivals off the edge',
    'The scissors snip the stool smaller every 20 s',
    'Spinning tops wander across and scatter everyone',
  ],
  accent: '#fb923c',
  players: [2, 16],
  duration: 120,
  canBeFinal: true,
  bodyMode: 'ball',
  camera: { kind: 'chase', dist: 8.5 },
  sprinkles: { start: 1 },
  fallY: -5,
  sky: { color: '#26170d', fogNear: 40, fogFar: 120 },

  tricks: [
    {
      id: 'tack',
      name: 'Thumbtack',
      icon: 'tack',
      cost: 2,
      cooldown: 8,
      busy: 0.5,
      target: 'rival',
      desc: "Pops a rival's ball for 3.5 seconds: it goes floppy and slow.",
      counter: 'Roll to the middle and wait for it to puff back up.',
      apply: (ctx, _s, _user, target) => {
        if (!target) return
        target.popped = 3.5
        ctx.fx.sfx('pop', target.pos)
        ctx.fx.puff(target.pos, 'stuff', 14)
        ctx.fx.popup(target, 'POP!', '#fca5a5')
      },
      botUse: (ctx, _s, user) => {
        // Pop whoever is closest to the edge near us.
        const near = ctx.toys.filter((t) => t !== user && t.status === 'play' && t.popped <= 0 && t.pos.distanceTo(user.pos) < 8)
        near.sort((a, b) => Math.hypot(b.pos.x, b.pos.z) - Math.hypot(a.pos.x, a.pos.z))
        return near[0] ?? false
      },
    },
    {
      id: 'magnet',
      name: 'Magnet Button',
      icon: 'magnet',
      cost: 3,
      cooldown: 12,
      busy: 0.8,
      target: 'rival',
      desc: 'Drags a rival towards the cut edge for 2.5 seconds.',
      counter: 'Steer inwards and jump: the magnet only grips on the ground.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        s.magnet[target.idx] = 2.5
        ctx.fx.sfx('zap', target.pos)
        ctx.fx.popup(target, 'MAGNET!', '#93c5fd')
      },
    },
    bubbleWrap<SumoState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 30, hd: 30, ridge: 36, knee: 8, y: -10, lights: ctx.quality === 'low' ? 30 : 60, quality: ctx.quality })
    // Stool legs down to the attic floor.
    const legMat = mat('#6b3f22')
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 10.5, 10), legMat)
      leg.position.set(Math.sin(a) * 5.2, -5.5, Math.cos(a) * 5.2)
      leg.rotation.set(Math.cos(a) * 0.08, 0, -Math.sin(a) * 0.08)
      leg.castShadow = true
      ctx.root.add(leg)
    }
    const rung = new THREE.Mesh(new THREE.TorusGeometry(5.3, 0.3, 6, 32).rotateX(Math.PI / 2), legMat)
    rung.position.y = -6
    ctx.root.add(rung)
  },

  init(ctx) {
    const n = ctx.toys.length || 16
    const st: SumoState = {
      cuts: 0, nextCut: CUT_EVERY, magnet: new Array(n).fill(0), falls: new Array(n).fill(0), alive: new Array(n).fill(0), topHit: new Map(), disc: null,
      vis: { topTex: null, warn: null, scissors: null, tops: [], snipT: 0, topPos: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    }
    // The stool top: a textured disc that the scissors crop (texture stays put, the edge goes).
    const tex = ctx.assets.tex.stool?.clone() ?? null
    if (tex) {
      tex.needsUpdate = true
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    }
    st.vis.topTex = tex
    const seat = new THREE.Group()
    const top = new THREE.Mesh(new THREE.CircleGeometry(R0, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, color: tex ? '#ffffff' : '#8b5a2b', roughness: 0.8 }))
    top.position.y = 0.002
    top.receiveShadow = true
    const side = new THREE.Mesh(new THREE.CylinderGeometry(R0, R0 * 0.98, 1.2, 64, 1, true), mat('#5a3418', { side: THREE.DoubleSide }))
    side.position.y = -0.6
    side.castShadow = true
    seat.add(top, side)
    ctx.root.add(seat)
    st.disc = ctx.hazards.shrinkingDisc({ x: 0, y: 0, z: 0, radius: R0, thick: 1.2, visual: seat }) as SumoState['disc']
    const warn = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0, toneMapped: false, depthWrite: false }))
    warn.position.y = 0.03
    ctx.root.add(warn)
    st.vis.warn = warn
    const sc = prop(ctx.assets, 'scissors', 7, 'max')
    ctx.root.add(sc)
    st.vis.scissors = sc

    // Wandering spinning tops: a custom hazard (pure function of time, so every screen agrees).
    const tops: THREE.Object3D[] = []
    const bodies = [0, 1, 2].map(() => ctx.phys.kinematic({ x: 0, y: -20, z: 0 }))
    for (const b of bodies) ctx.phys.attach(b, ctx.RAPIER.ColliderDesc.cylinder(0.8, TOP_R * 0.8), { restitution: 0.9, friction: 0.1 })
    for (let i = 0; i < 3; i++) {
      const tp = prop(ctx.assets, 'top', 2.3)
      tp.visible = false
      ctx.root.add(tp)
      tops.push(tp)
    }
    st.vis.tops = tops
    const tmp = new THREE.Vector3()
    const seed = ctx.seed
    ctx.hazards.add({
      update(c, t) {
        const radius = st.disc?.state.radius ?? R0
        const live = c.phase === 'play' ? topCount(t) : 0
        for (let i = 0; i < 3; i++) {
          const on = i < live
          topPos(i, Math.max(0, t), radius, seed, tmp)
          st.vis.topPos[i].copy(tmp)
          bodies[i].setNextKinematicTranslation(on ? { x: tmp.x, y: 0.8, z: tmp.z } : { x: 0, y: -20 - i * 3, z: 0 })
        }
      },
      affect(c, toy) {
        if (toy.status !== 'play' || c.phase !== 'play') return
        const live = topCount(c.time)
        for (let i = 0; i < live; i++) {
          const p = st.vis.topPos[i]
          const dx = toy.pos.x - p.x, dz = toy.pos.z - p.z
          const d = Math.hypot(dx, dz)
          const key = `${toy.idx}:${i}`
          if (d > TOP_R + 0.9 || toy.pos.y > 3.5 || (st.topHit.get(key) ?? -9) > c.time - 0.8) continue
          st.topHit.set(key, c.time)
          const k = 1 / Math.max(0.2, d)
          c.knock(toy, { x: dx * k * 6.5, y: 2.5, z: dz * k * 6.5 }, 0.25)
          c.fx.sfx('boing', toy.pos)
          c.fx.puff(toy.pos, 'spark', 8)
        }
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 0, radius: Math.min(6.8, 2.5 + n * 0.35), faceIn: true })[i]
  },

  tick(ctx, st, dt) {
    const t = ctx.time
    // Snip.
    if (t >= st.nextCut && st.cuts < RADII.length - 1) {
      st.cuts++
      st.nextCut = t + CUT_EVERY
      st.disc?.shrink(RADII[st.cuts], t, CUT_TIME)
      ctx.fx.say('SNIP!', '#fb923c', 1.2)
      ctx.fx.shake(0.3)
    }
    const radius = st.disc?.state.radius ?? R0
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      // A Sprinkle for every 12 s on the stool.
      st.alive[toy.idx] += dt
      if (st.alive[toy.idx] >= 12) {
        st.alive[toy.idx] -= 12
        ctx.addSprinkles(toy, 1)
      }
      // Magnet: pulled outwards while on the ground.
      if (st.magnet[toy.idx] > 0) {
        st.magnet[toy.idx] = Math.max(0, st.magnet[toy.idx] - dt)
        if (toy.grounded) {
          const r = Math.hypot(toy.pos.x, toy.pos.z) || 1
          const v = toy.body.linvel()
          toy.body.setLinvel({ x: v.x + (toy.pos.x / r) * 5 * dt, y: v.y, z: v.z + (toy.pos.z / r) * 5 * dt }, true)
        }
      }
      // Roll off the cut edge and you fall (the stool collider shrinks; this nudges stragglers off).
      const r = Math.hypot(toy.pos.x, toy.pos.z)
      if (r > radius + 0.2 && toy.pos.y < 1.6) toy.grounded = false
    }
  },

  onFall(ctx, st, toy) {
    // Whoever hit them last gets the credit.
    const by = toy.grudge
    if (by && by.status === 'play') {
      ctx.addSprinkles(by, 1, 'knock-off')
      ctx.fx.popup(by, 'Knock-off!', '#fde68a')
    }
    st.falls[toy.idx]++
    if (ctx.mode === 'show') ctx.fail(toy, by ? `knocked off by ${by.name}` : 'fell off')
    else {
      const a = ctx.rng.range(0, Math.PI * 2)
      const rr = (st.disc?.state.radius ?? R0) * 0.4
      ctx.respawn(toy, { x: Math.sin(a) * rr, y: 2, z: Math.cos(a) * rr, yaw: a + Math.PI }, 1.5)
      ctx.fx.popup(toy, `Fall ${st.falls[toy.idx]}`, '#fca5a5')
    }
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => st.falls[a.idx] - st.falls[b.idx] || Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const radius = st.disc?.state.radius ?? R0
    // Three moods: roam near the middle, pick on someone nearer the edge, or scramble back from the rim.
    const d = toy.data as { mode?: 'roam' | 'attack'; until?: number; gx?: number; gz?: number; target?: number }
    const px = toy.pos.x, pz = toy.pos.z
    const rC = Math.hypot(px, pz)
    const safe = radius - 2 - (toy.popped > 0 ? 1 : 0) - (st.magnet[toy.idx] > 0 ? 1.2 : 0)
    let gx: number, gz: number
    let speed = 4.2 * sk.pace
    if (!d.mode || (d.until ?? 0) < ctx.time) {
      d.mode = 'roam'
      d.until = ctx.time + ctx.rng.range(2, 4.5)
      const a = ctx.rng.range(0, Math.PI * 2), r = ctx.rng.range(0, radius * 0.45)
      d.gx = Math.sin(a) * r
      d.gz = Math.cos(a) * r
      // Look for someone worth bullying: close by and nearer the edge than us.
      const prey = ctx.toys.filter((t) => t !== toy && t.status === 'play' && t.pos.distanceTo(toy.pos) < 5 && Math.hypot(t.pos.x, t.pos.z) > rC + 0.4)
      if (prey.length && ctx.rng.chance(0.35 + sk.aggression * 0.4)) {
        d.mode = 'attack'
        d.until = ctx.time + ctx.rng.range(1.2, 2.2)
        d.target = ctx.rng.pick(prey).idx
      }
    }
    const tgt = d.mode === 'attack' ? ctx.toys[d.target ?? -1] : null
    if (rC > safe) {
      gx = 0
      gz = 0
      speed = 5
    } else if (tgt && tgt.status === 'play') {
      // Come at them from the inside so the hit sends them outwards.
      const tr = Math.hypot(tgt.pos.x, tgt.pos.z) || 1
      gx = tgt.pos.x - (tgt.pos.x / tr) * 0.6
      gz = tgt.pos.z - (tgt.pos.z / tr) * 0.6
      speed = 5 * sk.pace
      const dist = tgt.pos.distanceTo(toy.pos)
      const inside = rC < tr - 0.3
      if (inside && dist < 2.8 && toy.diveCd <= 0 && ctx.rng.chance(sk.aggression * 1.5 * dt)) toy.pad.dive = true
      if (dist < 2 && toy.shoveCd <= 0 && ctx.rng.chance(sk.aggression * 2 * dt)) toy.pad.shove = true
    } else {
      gx = d.gx ?? 0
      gz = d.gz ?? 0
    }
    let wx = gx - px, wz = gz - pz
    const dist = Math.hypot(wx, wz)
    // Arrive gently; dodge the spinning tops.
    const want = Math.min(speed, dist * 1.4)
    wx = dist > 0.01 ? (wx / dist) * want : 0
    wz = dist > 0.01 ? (wz / dist) * want : 0
    for (let i = 0; i < topCount(ctx.time); i++) {
      const p = st.vis.topPos[i]
      const dx = px - p.x, dz = pz - p.z
      const dd = Math.hypot(dx, dz)
      if (dd < 3.4 && dd > 0.01) {
        wx += (dx / dd) * (3.4 - dd) * 1.6
        wz += (dz / dd) * (3.4 - dd) * 1.6
      }
    }
    // Steer by velocity error so the ball doesn't overshoot (better bots react harder).
    const ex = wx - toy.vel.x, ez = wz - toy.vel.z
    const el = Math.hypot(ex, ez)
    const k = Math.min(1, el / (2.5 - sk.accuracy))
    toy.pad.mx = el > 0.01 ? (ex / el) * k : 0
    toy.pad.mz = el > 0.01 ? (ez / el) * k : 0
    if ((toy.pad.dive || toy.pad.shove) && tgt) toy.yaw = Math.atan2(tgt.pos.x - px, tgt.pos.z - pz)
  },

  pack(_c, st) {
    return [st.cuts, Math.round(st.nextCut * 10) / 10, st.magnet.map((m) => Math.round(m * 10) / 10), st.falls]
  },

  unpack(_c, st, d) {
    const a = d as [number, number, number[], number[]]
    st.cuts = a[0]
    st.nextCut = a[1]
    st.magnet = a[2]
    st.falls = a[3]
  },

  visual(ctx, st, dt) {
    const v = st.vis
    const radius = st.disc?.state.radius ?? R0
    const t = ctx.time
    // Crop the texture with the edge (the doodles near the rim get snipped off).
    if (v.topTex) {
      const s = radius / R0
      v.topTex.repeat.set(s, s)
      v.topTex.offset.set((1 - s) / 2, (1 - s) / 2)
    }
    // Warning ring at the next cut line.
    const next = RADII[Math.min(RADII.length - 1, st.cuts + 1)]
    const warning = ctx.phase === 'play' && st.cuts < RADII.length - 1 && st.nextCut - t < WARN
    if (v.warn) {
      v.warn.scale.setScalar(next)
      const m = v.warn.material as THREE.MeshBasicMaterial
      m.opacity = warning ? 0.5 + Math.sin(t * 14) * 0.35 : 0
      v.warn.visible = warning
    }
    // Scissors: wait at the rim, then run round it while the cut happens.
    if (v.scissors) {
      const cutting = st.cuts > 0 && t - (st.nextCut - CUT_EVERY) < CUT_TIME
      const prog = cutting ? (t - (st.nextCut - CUT_EVERY)) / CUT_TIME : 0
      // Only around a cut: they glide in during the warning, run round the rim, then leave.
      v.scissors.visible = ctx.phase === 'play' && (cutting || warning)
      const a = st.cuts * 1.7 + prog * Math.PI * 2
      const rr = radius + (cutting ? 2.6 : 2.6 + Math.max(0, st.nextCut - t - 0.5) * 2)
      v.scissors.position.set(Math.sin(a) * rr, 0.3 + (cutting ? Math.sin(t * 30) * 0.1 : 0.6), Math.cos(a) * rr)
      v.scissors.rotation.set(0, a + Math.PI / 2, cutting ? Math.sin(t * 25) * 0.15 : 0)
      if (cutting) {
        v.snipT -= dt
        if (v.snipT <= 0) {
          v.snipT = 0.22
          // Local effects: every screen runs visual(), so nothing here is broadcast.
          ctx.fxLocal.sfx('snip', v.scissors.position)
          ctx.fxLocal.puff({ x: Math.sin(a) * radius, y: 0.2, z: Math.cos(a) * radius }, 'dust', 6)
        }
      }
    }
    for (let i = 0; i < 3; i++) {
      const tp = v.tops[i]
      if (!tp) continue
      const on = ctx.phase === 'play' && i < topCount(t)
      tp.visible = on
      if (!on) continue
      tp.position.copy(v.topPos[i])
      tp.rotation.y += dt * 20
      tp.rotation.z = Math.sin(t * 3 + i) * 0.12
    }
  },

  hud(ctx, st, me) {
    const t = ctx.time
    const chips = st.cuts < RADII.length - 1 && ctx.phase === 'play' ? [`Snip in ${Math.max(0, Math.ceil(st.nextCut - t))} s`] : []
    const warning = ctx.phase === 'play' && st.nextCut - t < WARN && st.cuts < RADII.length - 1
    let prompt: string | undefined
    if (me && me.status === 'play') {
      if (me.popped > 0) prompt = 'Your ball is popped! Roll to the middle until it puffs back up.'
      else if (st.magnet[me.idx] > 0) prompt = 'Magnet! Steer inwards and jump.'
      else if (warning) prompt = 'The scissors are coming: stay inside the red line!'
    }
    if (ctx.mode === 'quick' && me) chips.push(`Falls: ${st.falls[me.idx] ?? 0}`)
    return { chips, prompt, status: warning ? { text: 'SNIP INCOMING', color: '#fb923c', pulse: true } : undefined }
  },
})
