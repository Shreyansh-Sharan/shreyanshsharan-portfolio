// Piano Key Bridge (logic). A bridge of piano keys runs across an open grand piano, two keys to a row: one holds,
// one sinks into the strings. Every key plays a note when it is stepped on (a sweet one when it holds, a sour
// thunk when it sinks), so everyone hears and sees which keys are safe: go first and risk it, or wait and
// follow. After a while the fallboard starts closing behind the crowd and shoves the cautious onto the keys.
// The last rows are narrow black keys. Dirty tricks: a decoy note that makes a trap key look safe, a key that
// springs a rival into the air, and a hush that mutes the notes and glows on a rival's screen.
import * as THREE from 'three'
import { avoidWalls, skill, steerTo } from '../engine/bots'
import { buildAttic, textSprite } from '../engine/helpers'
import { canvasTex, roundRect } from '../engine/paint'
import { bubbleWrap } from '../engine/sabotage'
import { defineLevel } from '../engine/types'

const WHITE_ROWS = 10
const BLACK_ROWS = 3
const ROWS = WHITE_ROWS + BLACK_ROWS
const KL = 2.1 // key length along z
const RG = 0.14 // gap between rows
const PITCH = KL + RG
const Z0 = 0.2 // where row 0 starts
const WHITE_W = 1.95
const WHITE_X = 1.2 // lane centre (the gap between lanes is 0.45 m)
const BLACK_W = 0.9
const BLACK_X = 1.05
const START_Z = -8
const FINISH_Z = Z0 + ROWS * PITCH + 0.2
const RAIL_X = 4
const PUSH_FROM = 28 // the fallboard starts closing
const DUR = 110
/** A wrong key wobbles this long before it drops: a quick hop to the other key can save you. */
const SINK_DELAY = 0.42

// The held key in each row plays the next note up a scale, so crossing plays a tune.
const NOTES = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 73, 75, 78]

interface PBState {
  /** Per key (row*2 + side): 0 untouched, 1 held (revealed), 2 sunk. */
  key: number[]
  /** When each key sank (round time). */
  sunkAt: number[]
  /** The decoy: key index, until (round time), who planted it. */
  decoy: [number, number, number]
  /** Furthest row each toy has reached (-1 on the start ledge). */
  best: number[]
  falls: number[]
  // Host only.
  safe: number[]
  // Visuals.
  vis: {
    keys: THREE.Mesh[]
    mats: THREE.MeshStandardMaterial[]
    press: number[]
    notes: THREE.Sprite[]
    hushT: number
    board: THREE.Object3D | null
    lastSink: number[]
  }
}

const rowZ = (r: number) => Z0 + r * PITCH + KL / 2
const isBlack = (r: number) => r >= WHITE_ROWS
const laneX = (r: number, side: number) => (side ? 1 : -1) * (isBlack(r) ? BLACK_X : WHITE_X)
const keyW = (r: number) => (isBlack(r) ? BLACK_W : WHITE_W)

/** Which key a point is over: [row, side] or null. */
function keyAt(x: number, z: number): [number, number] | null {
  const r = Math.floor((z - Z0) / PITCH)
  if (r < 0 || r >= ROWS) return null
  const zz = z - (Z0 + r * PITCH)
  if (zz > KL + 0.05) return null
  const side = x > 0 ? 1 : 0
  if (Math.abs(x - laneX(r, side)) > keyW(r) / 2 + 0.05) return null
  return [r, side]
}

/** Where the fallboard's front edge is at round time t. */
function boardZ(t: number, dur: number) {
  const k = THREE.MathUtils.clamp((t - PUSH_FROM) / (dur - PUSH_FROM - 12), 0, 1)
  return THREE.MathUtils.lerp(START_Z, Z0 - 0.35, THREE.MathUtils.smoothstep(k, 0, 1))
}

function frontier(st: PBState) {
  for (let r = 0; r < ROWS; r++) if (st.key[r * 2] !== 1 && st.key[r * 2 + 1] !== 1) return r
  return ROWS
}

function sheetMusic() {
  return canvasTex(512, 384, (g, w, h) => {
    g.fillStyle = '#fbf3df'
    g.fillRect(0, 0, w, h)
    g.strokeStyle = '#3b2f2f'
    g.lineWidth = 2
    for (let s = 0; s < 4; s++) {
      const y0 = 50 + s * 84
      for (let l = 0; l < 5; l++) {
        g.beginPath()
        g.moveTo(24, y0 + l * 9)
        g.lineTo(w - 24, y0 + l * 9)
        g.stroke()
      }
      g.fillStyle = '#3b2f2f'
      for (let n = 0; n < 12; n++) {
        const x = 70 + n * 34, y = y0 + 36 - ((n * 7 + s * 3) % 9) * 4.5
        g.beginPath()
        g.ellipse(x, y, 6, 4.5, -0.4, 0, Math.PI * 2)
        g.fill()
        g.fillRect(x + 5, y - 26, 2, 26)
      }
    }
    g.font = 'italic 700 26px Georgia, serif'
    g.fillStyle = '#7c2d12'
    g.fillText('Bridge Waltz', 24, 30)
  })
}

function keyTexture(black: boolean) {
  return canvasTex(64, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h)
    if (black) {
      grd.addColorStop(0, '#3f3f46')
      grd.addColorStop(0.15, '#18181b')
      grd.addColorStop(1, '#09090b')
    } else {
      grd.addColorStop(0, '#fffdf7')
      grd.addColorStop(1, '#efe6d2')
    }
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
    g.strokeStyle = black ? 'rgba(255,255,255,0.12)' : 'rgba(120,100,70,0.35)'
    g.lineWidth = 3
    roundRect(g, 3, 3, w - 6, h - 6, 6)
    g.stroke()
  })
}

export default defineLevel<PBState>({
  id: 'piano-bridge',
  name: 'Piano Key Bridge',
  type: 'logic',
  blurb: 'Cross a bridge of piano keys: in every row one key holds and one sinks.',
  howTo: [
    'Each row has two keys: one holds, one sinks into the strings',
    'A held key plays a sweet note and glows; a sinking one plays a sour thunk',
    'Go first and risk it, or wait and follow, but the fallboard closes behind you',
    'Jump to change lanes. The last rows are narrow black keys',
  ],
  accent: '#e7e5e4',
  players: [2, 16],
  duration: DUR,
  camera: { kind: 'chase', dist: 7.5, height: 1.2 },
  introOrbit: { radius: 16, height: 10, center: [0, 0, 10] },
  sprinkles: { start: 1 },
  fallY: -4,
  sky: { color: '#1b120c', fogNear: 45, fogFar: 130 },

  tricks: [
    {
      id: 'decoy',
      name: 'Decoy Note',
      icon: 'star',
      cost: 2,
      cooldown: 12,
      busy: 0.6,
      target: 'none',
      desc: 'The trap key in the next untested row plays a sweet note and glows as if it held, for 4 seconds.',
      counter: 'A real safe key stays lit. A decoy fades after a few seconds, so wait a beat.',
      can: (_c, s) => (frontier(s) < ROWS ? true : 'Every row is known'),
      apply: (ctx, s, user) => {
        const r = frontier(s)
        if (r >= ROWS) return
        const trap = r * 2 + (1 - s.safe[r])
        s.decoy = [trap, ctx.time + 4, user.idx]
        ctx.emit({ k: trap, ok: 1, d: 1 })
        // Bots in the crowd may believe it.
        for (const t of ctx.toys) {
          if (!t.bot || t === user || !ctx.rng.chance(0.75 - ctx.difficulty * 0.2)) continue
          const fooled = (t.data.fooled ??= {}) as Record<number, number>
          fooled[r] = 1 - s.safe[r]
        }
      },
      botUse: (ctx, s, user) => {
        // Plant it while I'm safely behind and others are about to test the row.
        const r = frontier(s)
        if (r >= ROWS || s.best[user.idx] >= r) return false
        const near = ctx.toys.filter((t) => t !== user && t.status === 'play' && s.best[t.idx] === r - 1).length
        return near > 0 ? null : false
      },
    },
    {
      id: 'spring',
      name: 'Spring Key',
      icon: 'zap',
      cost: 2,
      cooldown: 9,
      busy: 0.6,
      target: 'rival',
      range: 14,
      desc: 'The key under them springs up and pops them into the air with a sideways wobble.',
      counter: 'Steer back onto a lit key while you are in the air.',
      can: (ctx, _s, _u, target) => (target && keyAt(target.pos.x, target.pos.z) && target.grounded ? true : ctx.phase === 'play' ? 'Only on someone standing on a key' : 'Not yet'),
      apply: (ctx, _s, user, target) => {
        if (!target) return
        const side = ctx.rng.chance(0.5) ? 1 : -1
        ctx.knock(target, { x: side * 1.7, y: 7, z: ctx.rng.range(-0.4, 0.9) }, 0, user)
        ctx.fx.sfx('boing', target.pos)
        ctx.fx.popup(target, 'Boing!', '#fde68a')
      },
    },
    {
      id: 'hush',
      name: 'Hush',
      icon: 'tickle',
      cost: 2,
      cooldown: 14,
      busy: 0.5,
      target: 'rival',
      desc: 'For 6 seconds their screen hears no notes and sees no glow on the keys.',
      counter: 'Remember the lit keys before it lands, or follow the toys ahead.',
      apply: (ctx, _s, _user, target) => {
        if (!target) return
        ctx.emit({ hush: 6 }, target)
        ctx.fx.popup(target, 'Shhh!', '#c4b5fd')
        if (target.bot) target.data.hush = ctx.time + 6
      },
    },
    bubbleWrap<PBState>(2),
  ],

  build(ctx) {
    buildAttic(ctx.root, ctx.assets, null, { hw: 22, hd: 34, ridge: 26, knee: 6, y: -6, lights: ctx.quality === 'low' ? 26 : 50, quality: ctx.quality })
    // Start ledge (the key slip) and the finish (the music desk).
    const wood = new THREE.MeshStandardMaterial({ color: '#5b3416', roughness: 0.5 })
    const lacquer = new THREE.MeshStandardMaterial({ color: '#0b0a0a', roughness: 0.32, metalness: 0, envMapIntensity: 0.35 })
    const gold = new THREE.MeshStandardMaterial({ color: '#d4a54a', roughness: 0.3, metalness: 0.8 })
    const startLen = Z0 - START_Z
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(RAIL_X * 2, 1, startLen), wood)
    ledge.position.set(0, -0.5, START_Z + startLen / 2)
    ledge.receiveShadow = true
    ctx.root.add(ledge)
    ctx.phys.box({ x: 0, y: -0.5, z: START_Z + startLen / 2 - 0.02 }, { x: RAIL_X, y: 0.5, z: startLen / 2 }, { friction: 0.8 })
    const fin = new THREE.Mesh(new THREE.BoxGeometry(RAIL_X * 2, 1, 6), wood)
    fin.position.set(0, -0.5, FINISH_Z + 3)
    fin.receiveShadow = true
    ctx.root.add(fin)
    ctx.phys.box({ x: 0, y: -0.5, z: FINISH_Z + 3 }, { x: RAIL_X, y: 0.5, z: 3 }, { friction: 0.8 })
    const line = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_X * 2, 0.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fde68a' }))
    line.position.set(0, 0.02, FINISH_Z + 0.3)
    ctx.root.add(line)
    // The piano case: glossy black rails down both sides (walls), gold trim.
    const len = FINISH_Z + 6 - START_Z
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4.6, len), lacquer)
      rail.position.set(sx * (RAIL_X + 0.4), -1.7, START_Z + len / 2)
      rail.castShadow = rail.receiveShadow = true
      ctx.root.add(rail)
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, len), gold)
      trim.position.set(sx * (RAIL_X + 0.4), 0.62, START_Z + len / 2)
      ctx.root.add(trim)
      ctx.phys.box({ x: sx * (RAIL_X + 0.4), y: 2, z: START_Z + len / 2 }, { x: 0.4, y: 5, z: len / 2 })
    }
    ctx.phys.box({ x: 0, y: 2, z: START_Z - 0.5 }, { x: RAIL_X, y: 5, z: 0.5 })
    ctx.phys.box({ x: 0, y: 2, z: FINISH_Z + 6.5 }, { x: RAIL_X, y: 5, z: 0.5 })
    // The piano's insides below the bridge: a soundboard, gold strings and red felt.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_X * 2, FINISH_Z - Z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c08a4a', roughness: 0.6 }))
    board.position.set(0, -3.6, (Z0 + FINISH_Z) / 2)
    ctx.root.add(board)
    const nStr = 22
    const strings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, FINISH_Z - Z0, 5).rotateX(Math.PI / 2), gold, nStr)
    const m = new THREE.Matrix4()
    for (let i = 0; i < nStr; i++) strings.setMatrixAt(i, m.makeTranslation(-RAIL_X + 0.3 + (i * (RAIL_X * 2 - 0.6)) / (nStr - 1), -2.9 - (i % 2) * 0.1, (Z0 + FINISH_Z) / 2))
    ctx.root.add(strings)
    for (const z of [Z0 + 3, FINISH_Z - 3]) {
      const felt = new THREE.Mesh(new THREE.BoxGeometry(RAIL_X * 2, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: '#991b1b', roughness: 1 }))
      felt.position.set(0, -2.7, z)
      ctx.root.add(felt)
    }
    // A music desk with sheet music past the finish, and the raised lid behind it.
    const stand = new THREE.Mesh(new THREE.BoxGeometry(RAIL_X * 2 - 1, 4.5, 0.25), wood)
    stand.position.set(0, 2.3, FINISH_Z + 5.6)
    stand.rotation.x = -0.18
    ctx.root.add(stand)
    const sheetMat = new THREE.MeshStandardMaterial({ map: sheetMusic(), roughness: 0.9 })
    for (const sx of [-1.7, 1.7]) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), sheetMat)
      sheet.position.set(sx, 0.4, -0.14)
      sheet.rotation.y = Math.PI
      stand.add(sheet)
    }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(RAIL_X * 2 + 1.6, 0.3, 16), lacquer)
    lid.position.set(-2, 6.5, FINISH_Z + 3)
    lid.rotation.z = 0.7
    lid.castShadow = true
    ctx.root.add(lid)
    const sign = textSprite('Finish!', { bg: '#7c2d12', size: 0.9 })
    sign.position.set(0, 2.2, FINISH_Z + 0.3)
    ctx.root.add(sign)
  },

  init(ctx) {
    const n = ctx.toys.length || 16
    const st: PBState = {
      key: new Array(ROWS * 2).fill(0), sunkAt: new Array(ROWS * 2).fill(0), decoy: [-1, 0, -1], best: new Array(n).fill(-1), falls: new Array(n).fill(0),
      safe: [], vis: { keys: [], mats: [], press: new Array(ROWS * 2).fill(0), notes: [], hushT: 0, board: null, lastSink: [] },
    }
    for (let r = 0; r < ROWS; r++) st.safe.push(ctx.rng.int(0, 2))
    const whiteTex = keyTexture(false), blackTex = keyTexture(true)
    const noteTex = canvasTex(64, 64, (g) => {
      g.fillStyle = '#fde68a'
      g.font = '900 54px Georgia, serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('♪', 32, 34)
    })
    const colliders: ReturnType<typeof ctx.phys.box>[] = []
    for (let r = 0; r < ROWS; r++) {
      const black = isBlack(r)
      const geo = new THREE.BoxGeometry(keyW(r), black ? 0.7 : 0.45, KL)
      for (const side of [0, 1]) {
        const mat = new THREE.MeshStandardMaterial({ map: black ? blackTex : whiteTex, roughness: black ? 0.2 : 0.35, emissive: '#facc15', emissiveIntensity: 0 })
        const key = new THREE.Mesh(geo, mat)
        key.castShadow = key.receiveShadow = true
        ctx.root.add(key)
        st.vis.keys.push(key)
        st.vis.mats.push(mat)
        const note = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, transparent: true, depthWrite: false, opacity: 0.9 }))
        note.scale.setScalar(0.7)
        note.visible = false
        ctx.root.add(note)
        st.vis.notes.push(note)
        colliders.push(ctx.phys.box({ x: laneX(r, side), y: -0.25, z: rowZ(r) }, { x: keyW(r) / 2, y: 0.25, z: KL / 2 }, { friction: 0.8 }))
      }
    }
    // Keys move with the state on every screen (and their colliders go when they sink).
    ctx.hazards.add({
      update(_c, t) {
        for (let i = 0; i < ROWS * 2; i++) {
          const r = i >> 1, side = i & 1
          const black = isBlack(r)
          const h = black ? 0.7 : 0.45
          let y = -h / 2
          if (st.key[i] === 2) {
            const el = t - st.sunkAt[i]
            y -= el < SINK_DELAY ? el * 0.8 : 0.15 + (el - SINK_DELAY) * (el - SINK_DELAY) * 10
            colliders[i].setEnabled(el < SINK_DELAY)
          } else colliders[i].setEnabled(true)
          y -= st.vis.press[i] * 0.08
          const k = st.vis.keys[i]
          k.position.set(laneX(r, side), Math.max(-8, y), rowZ(r))
          k.visible = y > -7.5
          k.rotation.x = st.key[i] === 2 ? Math.min(0.5, Math.max(0, t - st.sunkAt[i]) * 0.8) : 0
        }
      },
    })
    // The fallboard: a big lacquered panel that closes in from behind after a while, pushing the cautious on.
    const boardBody = ctx.phys.kinematic({ x: 0, y: 1, z: START_Z - 0.6 })
    ctx.phys.attach(boardBody, ctx.RAPIER.ColliderDesc.cuboid(RAIL_X, 1.5, 0.3), { friction: 0.1 })
    const fb = new THREE.Group()
    const panel = new THREE.Mesh(new THREE.BoxGeometry(RAIL_X * 2, 3, 0.6), new THREE.MeshStandardMaterial({ color: '#1c1917', roughness: 0.15 }))
    panel.castShadow = true
    const plate = textSprite('Fallboard', { bg: '#a16207', size: 0.5 })
    plate.position.set(0, 0.6, -0.4)
    fb.add(panel, plate)
    ctx.root.add(fb)
    st.vis.board = fb
    ctx.hazards.add({
      update(c, t) {
        const z = (c.phase === 'play' ? boardZ(t, DUR) : START_Z) - 0.3
        boardBody.setNextKinematicTranslation({ x: 0, y: 1.5, z })
        fb.position.set(0, 1.5, z)
      },
      affect(c, toy) {
        // Squeeze: anyone right in front of the closing board gets nudged forward.
        if (c.phase !== 'play' || toy.status !== 'play') return
        const z = boardZ(c.time, DUR)
        if (toy.pos.z < z + 0.7 && toy.pos.z > z - 1 && toy.pos.y < 2.5) {
          const v = toy.body.linvel()
          toy.body.setLinvel({ x: v.x, y: v.y, z: Math.max(v.z, 2.6) }, true)
        }
      },
    })
    return st
  },

  spawn(ctx, _s, _toy, i, n) {
    return ctx.spawnGrid(n, { x: 0, z: START_Z + 3.2, yaw: 0, spacing: 1.25, cols: Math.min(n, 6) })[i]
  },

  tick(ctx, st) {
    const t = ctx.time
    if (st.decoy[0] >= 0 && t > st.decoy[1]) st.decoy = [-1, 0, -1]
    for (const toy of ctx.toys) {
      if (toy.status !== 'play') continue
      if (toy.pos.z > FINISH_Z + 0.4 && toy.feet > -0.3) {
        // Through: step aside onto the music desk's bench so the finish stays clear.
        const n = ctx.qualifiedCount()
        ctx.qualify(toy, `#${n + 1}`)
        ctx.respawn(toy, { x: -3 + (n % 7) * 1, y: 0, z: FINISH_Z + 4.6 - Math.floor(n / 7) * 1.1, yaw: Math.PI }, 0)
        toy.frozen = true
        continue
      }
      if (!toy.grounded || toy.feet < -0.3 || toy.feet > 0.3) {
        toy.data.onKey = -1
        continue
      }
      const k = keyAt(toy.pos.x, toy.pos.z)
      const idx = k ? k[0] * 2 + k[1] : -1
      if (idx !== toy.data.onKey && idx >= 0) {
        const [r, side] = k!
        st.best[toy.idx] = Math.max(st.best[toy.idx], r)
        if (st.key[idx] === 0) {
          if (st.safe[r] === side) {
            st.key[idx] = 1
            ctx.emit({ k: idx, ok: 1 })
            ctx.addSprinkles(toy, 1, 'brave')
            if (st.decoy[0] === r * 2 + (1 - side)) st.decoy = [-1, 0, -1]
          } else {
            st.key[idx] = 2
            st.sunkAt[idx] = t
            ctx.emit({ k: idx, ok: 0 })
            ctx.fx.shake(0.25)
          }
        } else if (st.key[idx] === 1) ctx.emit({ k: idx, ok: 1, q: 1 })
      }
      toy.data.onKey = idx
    }
  },

  onFall(ctx, st, toy) {
    st.falls[toy.idx]++
    ctx.fx.sfx('crunch', toy.pos)
    if (ctx.mode === 'show') ctx.fail(toy, 'sank into the strings')
    else ctx.fail(toy, 'into the strings!')
  },

  retry(ctx, st, toy) {
    // Quick Play: back to the last held key you reached (or the ledge).
    let r = st.best[toy.idx]
    while (r >= 0 && st.key[r * 2 + st.safe[r]] !== 1) r--
    if (r >= 0) ctx.respawn(toy, { x: laneX(r, st.safe[r]), y: 0.1, z: rowZ(r), yaw: 0 }, 1)
    else ctx.respawn(toy, { x: 0, y: 0.1, z: Math.max(boardZ(ctx.time, DUR) + 1.5, START_Z + 2), yaw: 0 }, 1)
  },

  rank(ctx, st) {
    return ctx.active().sort((a, b) => b.pos.z - a.pos.z || st.falls[a.idx] - st.falls[b.idx])
  },

  bot(ctx, st, toy, dt) {
    const sk = skill(ctx)
    const d = toy.data as { saveTry?: number; atRow?: number; wait?: number; pick?: Record<number, [number, number]>; fooled?: Record<number, number>; hush?: number; lane?: number }
    d.pick ??= {}
    // How long this bot dithers before testing an unknown row itself (bold bots go sooner).
    if (d.wait === undefined) d.wait = ctx.rng.range(4, 18) * (1.45 - sk.aggression)
    const here = keyAt(toy.pos.x, toy.pos.z)
    const row = here ? here[0] : toy.pos.z > FINISH_Z ? ROWS : -1
    const next = row + 1
    let gx = toy.pos.x, gz = toy.pos.z
    if (next >= ROWS) {
      gx = 0
      gz = FINISH_Z + 2.5
    } else {
      // Which side of the next row? Lit (known) rows: the lit key, unless memory slips. Unknown: guess, or a decoy.
      const lit = st.key[next * 2] === 1 ? 0 : st.key[next * 2 + 1] === 1 ? 1 : -1
      const sunk = st.key[next * 2] === 2 ? 0 : st.key[next * 2 + 1] === 2 ? 1 : -1
      const hushed = (d.hush ?? 0) > ctx.time
      const info = (lit >= 0 && !hushed) || sunk >= 0 ? 2 : d.fooled?.[next] !== undefined ? 1 : 0
      const cur = d.pick[next]
      if (info > 0 && (!cur || cur[1] < info)) {
        if (lit >= 0 && !hushed) d.pick[next] = [ctx.rng.chance(Math.min(0.99, sk.accuracy + 0.1)) ? lit : 1 - lit, 2]
        else if (sunk >= 0) d.pick[next] = [1 - sunk, 2]
        else d.pick[next] = [d.fooled![next], 1]
      }
      const known = !!d.pick[next] && d.pick[next][1] > 0
      const pressure = boardZ(ctx.time, DUR) > START_Z + 1 && row < 0
      // Arriving on a new row in front of an untested one: dither a little before risking it.
      if (row !== d.atRow) {
        d.atRow = row
        if (!known && row >= 0) d.wait = Math.max(d.wait ?? 0, ctx.time + ctx.rng.range(2, 8) * (1.45 - sk.aggression))
      }
      // Only one pioneer at a time: nobody tests a row someone else is already testing.
      const testing = !known && ctx.toys.some((o) => o !== toy && o.status === 'play' && o.pos.z > Z0 + next * PITCH - 0.2 && o.pos.z < Z0 + (next + 1) * PITCH)
      const brave = (ctx.time > (d.wait ?? 0) && !testing) || pressure || ctx.timeLeft < 25
      // Room on that key? Wait back if three toys are already on it.
      const want = d.pick[next]?.[0] ?? -1
      let crowd = 0
      if (want >= 0) for (const o of ctx.toys) if (o !== toy && o.status === 'play') {
        const k = keyAt(o.pos.x, o.pos.z)
        if (k && k[0] === next && k[1] === want) crowd++
      }
      if ((known || brave) && crowd < 3) {
        d.pick[next] ??= [ctx.rng.int(0, 2), 0]
        gx = laneX(next, d.pick[next][0])
        gz = rowZ(next) - KL * 0.15
        // From the ledge, line up with the lane before stepping off (the gap between lanes is deadly).
        if (row < 0 && toy.pos.z > Z0 - 1.6 && Math.abs(toy.pos.x - gx) > 0.45) gz = Math.min(toy.pos.z, Z0 - 0.6)
        // Change lanes with a running diagonal hop from near the front of this key (never over the hole
        // beside it): walk up the lane, then cut across and jump as the feet leave the key.
        if (here && Math.abs(laneX(here[0], here[1]) - gx) > 0.9) {
          const lane = laneX(here[0], here[1])
          const edge = Z0 + here[0] * PITCH + KL
          if (toy.pos.z < edge - 1.1) {
            gx = lane
            gz = edge
          } else {
            gz = rowZ(next) + 0.2
            const inner = Math.abs(toy.pos.x - lane) > keyW(here[0]) / 2 - 0.4
            if (toy.grounded && inner) toy.pad.jump = true
          }
        }
      } else {
        // Wait at the edge of what is known, a little back from the unknown row.
        gx = row >= 0 ? laneX(row, here![1]) : (d.lane ??= ctx.rng.range(-2.5, 2.5))
        gz = row >= 0 ? rowZ(row) : Z0 - 1.4 - (toy.idx % 4) * 1.1
        // A cheeky shove: push whoever is dithering at the brink onto the untested keys.
        const brink = Z0 + frontier(st) * PITCH
        for (const o of ctx.toys) {
          if (o === toy || o.status !== 'play' || ctx.time < 5 || o.pos.z < brink - 1.5 || o.pos.z > brink) continue
          const dz = o.pos.z - toy.pos.z, dx = o.pos.x - toy.pos.x
          if (dz > 0.2 && dz < 1.3 && Math.abs(dx) < 0.7 && ctx.rng.chance(sk.aggression * 0.6 * dt)) {
            toy.pad.mx = dx * 0.5
            toy.pad.mz = 1
            toy.yaw = Math.atan2(dx, dz)
            toy.pad.shove = true
            return
          }
        }
      }
    }
    // My key is sinking: hop across to the other one (if quick enough).
    if (here && st.key[here[0] * 2 + here[1]] === 2) {
      const el = ctx.time - st.sunkAt[here[0] * 2 + here[1]]
      gx = laneX(here[0], 1 - here[1])
      gz = toy.pos.z + 0.3
      if (el > sk.reaction * 0.8 && toy.grounded && !d.saveTry) {
        d.saveTry = 1
        if (ctx.rng.chance(sk.accuracy * 0.75)) toy.pad.jump = true
      }
      steerTo(toy, gx, gz, { pace: 1, stop: 0.05 })
      return
    }
    d.saveTry = 0
    // Queue: don't climb up the back of the toy in front (that is how crowds fall off keys).
    if (here || toy.pos.z > Z0 - 2) {
      for (const o of ctx.toys) {
        if (o === toy || o.status !== 'play') continue
        const dz = o.pos.z - toy.pos.z, dx = o.pos.x - toy.pos.x
        if (dz > 0.1 && dz < 1.1 && Math.abs(dx) < 0.75 && gz > toy.pos.z + 0.3) gz = toy.pos.z
      }
      // On a key, keep to the middle of the lane.
      if (here && Math.abs(toy.pos.x - laneX(here[0], here[1])) > 0.3 && Math.abs(gx - laneX(here[0], here[1])) < 0.5) gz = toy.pos.z
    }
    // When a decoy fades, a fooled bot notices (if it was not already committed).
    if (d.fooled && st.decoy[0] < 0)
      for (const k of Object.keys(d.fooled).map(Number)) {
        delete d.fooled[k]
        if (d.pick[k]?.[1] === 1 && k > row) delete d.pick[k]
      }
    steerTo(toy, gx, gz, { pace: sk.pace * 0.85, stop: 0.25 })
    avoidWalls(ctx, toy)
  },

  pack(_c, st) {
    return [st.key, st.sunkAt.map((x) => Math.round(x * 100) / 100), st.decoy.map((x) => Math.round(x * 10) / 10), st.best, st.falls]
  },

  unpack(_c, st, d) {
    const a = d as [number[], number[], [number, number, number], number[], number[]]
    st.key = a[0]
    st.sunkAt = a[1]
    st.decoy = a[2]
    st.best = a[3]
    st.falls = a[4]
  },

  onEvent(ctx, st, data) {
    const e = data as { k?: number; ok?: number; q?: number; d?: number; hush?: number }
    if (e.hush !== undefined) {
      st.vis.hushT = e.hush
      ctx.fxLocal.sfx('whoosh')
      return
    }
    if (e.k === undefined) return
    const r = e.k >> 1
    st.vis.press[e.k] = 1
    if (st.vis.hushT > 0) return
    const pos = { x: laneX(r, e.k & 1), y: 0.3, z: rowZ(r) }
    if (e.ok) {
      ctx.fxLocal.sfx(`note:${NOTES[r]}`, pos)
      if (!e.q) ctx.fxLocal.puff(pos, 'spark', 10)
    } else {
      ctx.fxLocal.sfx(`note:${NOTES[r]}:sour`, pos)
      ctx.fxLocal.puff(pos, 'dust', 14)
    }
  },

  visual(ctx, st, dt) {
    const v = st.vis
    const t = ctx.time
    v.hushT = Math.max(0, v.hushT - dt)
    const me = ctx.me
    for (let i = 0; i < ROWS * 2; i++) {
      v.press[i] = Math.max(0, v.press[i] - dt * 4)
      const lit = st.key[i] === 1
      const decoy = st.decoy[0] === i && (!me || me.idx !== st.decoy[2])
      const mine = st.decoy[0] === i && !!me && me.idx === st.decoy[2]
      const glowing = (lit || decoy) && v.hushT <= 0
      const want = glowing ? 0.35 + v.press[i] * 0.6 + Math.sin(t * 3 + i) * 0.05 : mine ? 0.12 + Math.sin(t * 10) * 0.08 : 0
      const m = v.mats[i]
      m.emissiveIntensity += (want - m.emissiveIntensity) * Math.min(1, dt * 10)
      if (mine) m.emissive.set('#a78bfa')
      else m.emissive.set('#facc15')
      const n = v.notes[i]
      n.visible = glowing
      if (n.visible) {
        const r = i >> 1
        n.position.set(laneX(r, i & 1), 0.9 + Math.sin(t * 2.5 + i) * 0.15 + v.press[i] * 0.4, rowZ(r))
      }
    }
  },

  hud(ctx, st, me) {
    const f = frontier(st)
    const chips = [`Rows known: ${f}/${ROWS}`]
    const bz = boardZ(ctx.time, DUR)
    const closing = ctx.phase === 'play' && ctx.time > PUSH_FROM
    if (ctx.phase === 'play' && !closing) chips.push(`Fallboard closes in ${Math.ceil(PUSH_FROM - ctx.time)} s`)
    if (ctx.mode === 'quick' && me) chips.push(`Falls: ${st.falls[me.idx] ?? 0}`)
    let prompt: string | undefined
    if (me?.status === 'play') {
      const here = keyAt(me.pos.x, me.pos.z)
      if (st.vis.hushT > 0) prompt = 'Hushed! No notes or glows for a few seconds.'
      else if (closing && me.pos.z < Z0 && bz > START_Z + 0.5) prompt = 'The fallboard is closing: get onto the keys!'
      else if (!here && me.pos.z < Z0) prompt = 'Step onto a key: lit ones are safe. Jump to change lanes.'
      else if (here && here[0] + 1 === f) prompt = 'Next row is untested: risk it, or wait for someone to go first.'
    }
    const prog = me ? THREE.MathUtils.clamp((me.pos.z - Z0) / (FINISH_Z - Z0), 0, 1) : 0
    return {
      chips,
      prompt,
      status: closing && bz < Z0 - 1 ? { text: 'FALLBOARD CLOSING', color: '#fca5a5', pulse: true } : undefined,
      bars: me ? [{ label: 'Across', value: prog, color: '#fde68a' }] : [],
    }
  },
})

