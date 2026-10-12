// Worked example from the README: Robo-Vac Sweep (survival). A robot vacuum hunts the rug; get sucked up and you
// are out. Not registered in LEVELS: copy it, rename it, and add it to levels/index.ts to try it.
import * as THREE from 'three'
import { avoidWalls, nearestRival, skill, steerTo } from '../engine/bots'
import { buildAttic } from '../engine/helpers'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel, type LevelCtx, type Toy } from '../engine/types'

const RUG = 9 // rug radius (metres)

interface VacState {
  /** Vacuums: position, heading and who they chase (synced). */
  vacs: { x: number; z: number; yaw: number; lure: number; lureT: number }[]
  /** Visuals, built on every screen (not synced). */
  meshes: THREE.Object3D[]
}

function vacMesh() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.5, 24), new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.4 }))
  body.position.y = 0.3
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: '#22d3ee', toneMapped: false }))
  eye.position.set(0, 0.6, 0.9)
  g.add(body, eye)
  return g
}

/** The toy a vacuum chases: a lured target while the lure lasts, else whoever is nearest. */
function quarry(ctx: LevelCtx, v: VacState['vacs'][number]): Toy | null {
  if (v.lureT > ctx.time && ctx.toys[v.lure]?.status === 'play') return ctx.toys[v.lure]
  return ctx.nearest({ x: v.x, y: 0, z: v.z })
}

export default defineLevel<VacState>({
  id: 'robo-vac',
  name: 'Robo-Vac Sweep',
  type: 'survival',
  blurb: 'A robot vacuum hunts the rug. Get sucked up and you are out.',
  howTo: ['It chases whoever is closest', 'Jump over its bumper to escape', 'Throw lint to lure it onto a rival'],
  accent: '#22d3ee',
  players: [2, 16],
  duration: 90,
  sprinkles: { start: 2 },
  camera: { kind: 'chase', dist: 8 },

  tricks: [
    {
      id: 'lint',
      name: 'Lint Lure',
      icon: 'star',
      cost: 2,
      cooldown: 10,
      busy: 0.5,
      target: 'rival',
      desc: 'Stick a lint ball on a rival: every vacuum chases them for 4 seconds.',
      counter: 'Run behind someone else, or jump the bumper.',
      apply: (ctx, s, _user, target) => {
        if (!target) return
        for (const v of s.vacs) {
          v.lure = target.idx
          v.lureT = ctx.time + 4
        }
        ctx.fx.popup(target, 'LINT!', '#e5e7eb')
      },
    },
    bubbleWrap<VacState>(2),
  ],

  build(ctx) {
    // Colliders and visuals that never change. Same seed on every screen → same layout.
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 16, hd: 16, ridge: 16, knee: 4, lights: 40, quality: ctx.quality })
    const rug = new THREE.Mesh(new THREE.CircleGeometry(RUG, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7c3aed', roughness: 1 }))
    rug.position.y = 0.01
    rug.receiveShadow = true
    ctx.root.add(rug)
  },

  init(ctx) {
    const st: VacState = { vacs: [{ x: 0, z: 0, yaw: 0, lure: -1, lureT: 0 }], meshes: [] }
    st.meshes.push(vacMesh())
    st.meshes.push(vacMesh()) // the second one joins after 45 s
    for (const m of st.meshes) ctx.root.add(m)
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnRing(n, { x: 0, z: 0, radius: RUG - 1.5, faceIn: true })[i]
  },

  // Host only, 60 Hz: the rules.
  tick(ctx, s, dt) {
    if (ctx.time > 45 && s.vacs.length < 2) s.vacs.push({ x: 0, z: -RUG + 1, yaw: 0, lure: -1, lureT: 0 })
    for (const v of s.vacs) {
      const q = quarry(ctx, v)
      if (!q) continue
      const want = Math.atan2(q.pos.x - v.x, q.pos.z - v.z)
      let d = want - v.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      v.yaw += Math.max(-2, Math.min(2, d / dt)) * dt
      const speed = 3.2 + ctx.time * 0.02
      v.x += Math.sin(v.yaw) * speed * dt
      v.z += Math.cos(v.yaw) * speed * dt
      // Sucked up: close, and not jumping over the bumper.
      for (const t of ctx.toys) {
        if (t.status !== 'play') continue
        if (Math.hypot(t.pos.x - v.x, t.pos.z - v.z) < 1.2 && t.feet < 0.45) ctx.fail(t, 'sucked up')
      }
    }
  },

  // Host only: write the bot's pad (stick, jump, dive...).
  bot(ctx, s, toy) {
    const sk = skill(ctx)
    const v = s.vacs.reduce((a, b) => (Math.hypot(b.x - toy.pos.x, b.z - toy.pos.z) < Math.hypot(a.x - toy.pos.x, a.z - toy.pos.z) ? b : a))
    const dx = toy.pos.x - v.x, dz = toy.pos.z - v.z
    const d = Math.hypot(dx, dz) || 1
    // Run away, but stay on the rug; hop the bumper when it is right there.
    const away = { x: toy.pos.x + (dx / d) * 3, z: toy.pos.z + (dz / d) * 3 }
    const r = Math.hypot(away.x, away.z)
    if (r > RUG - 1) {
      away.x *= (RUG - 1) / r
      away.z *= (RUG - 1) / r
    }
    steerTo(toy, away.x, away.z, { pace: sk.pace })
    avoidWalls(ctx, toy)
    if (d < 1.8 && ctx.rng.chance(sk.accuracy)) toy.pad.jump = true
    const rival = nearestRival(ctx, toy, 1.4)
    if (rival && ctx.rng.chance(sk.aggression * 0.02)) toy.pad.shove = true
  },

  // Synced state: only what clients need to draw.
  pack(_c, s) {
    return s.vacs.map((v) => [Math.round(v.x * 100) / 100, Math.round(v.z * 100) / 100, Math.round(v.yaw * 100) / 100])
  },
  unpack(_c, s, d) {
    const rows = d as number[][]
    rows.forEach((row, i) => {
      s.vacs[i] ??= { x: 0, z: 0, yaw: 0, lure: -1, lureT: 0 }
      ;[s.vacs[i].x, s.vacs[i].z, s.vacs[i].yaw] = row
    })
  },

  // Every screen, every frame: move the meshes to the (synced) state.
  visual(_ctx, s) {
    s.meshes.forEach((m, i) => {
      const v = s.vacs[i]
      m.visible = !!v
      if (!v) return
      m.position.set(v.x, 0, v.z)
      m.rotation.y = v.yaw
    })
  },

  hud(ctx, s) {
    return { chips: [`${s.vacs.length} vacuum${s.vacs.length > 1 ? 's' : ''}`], prompt: ctx.time < 3 ? 'Keep away from the robot vacuum!' : undefined }
  },
})
