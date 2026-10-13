// The rigged characters: the player (the visitor's low-poly avatar: walk, run, fly, jump, a melee combo, a stomp
// and the spell cast) and the waving guide.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { ISLAND_RADIUS, WATER_LEVEL, regionForTile } from './regions'
import { heightAt } from './terrain'
import { modelUrl } from './Models'
import { GUIDE_SPOT } from './layout'
import { blocked, groundAt, resolve, roofAt } from './colliders'
import { animals } from './wildlife'
import { aimedCreature, HERO_HP, hitCreatures, MOUNT, nearestWild, pushOutOfCreatures, ride, saddleHeight, stepCreatures, throwSphere, toggleRide } from './creatures'
import { flightAllowed, parkourBoots, photo, playerLocked, requestSnap, stepMinigames, togglePhoto } from './minigames'
import { controls, flyAxis, moveAxes, pollPad } from './controls'
import { gameDt, hitEnemies, impact, nearestEnemy, newSwing, stepCombat, type HitShape } from './combat'
import { emit, SHAPE, type Emit } from './particles'
import { MISSIONS, INTERACT_DISTANCE } from './missions'
import { lastCast } from './spells'
import { car, DECK, exitCar, inTransit, ship } from './rides'
import { world } from './store'

/** Shared player state, read by the camera rig. */
export const player = {
  pos: new THREE.Vector3(0, 3, 8),
  yaw: 0,
  camYaw: Math.PI,
  camPitch: 0.32,
  speed: 0,
  /** Vertical velocity (negative while falling), read by the animals' bounce check. */
  vy: 0,
  /** Upward speed to apply on the next frame after landing on an animal (0 = none). */
  bounce: 0,
  /** Flying, and how fast (0..1), for the camera and the speed lines. */
  flying: false,
  fly: 0,
  /** Shove from an enemy bump, m/s on the ground plane (decays). */
  knock: new THREE.Vector2(),
  /** Bumped per melee swing / stomp landing, for the swoosh and shockwave visuals (PlayerFx.tsx). */
  swoosh: { n: 0, move: 'punch' as string },
  stomp: { n: 0 },
  /** Height of the ground under the player (for the contact shadow while airborne). */
  ground: 0,
  /** The clip playing on the body (test hook). */
  anim: '',
  /** Health (creatures.ts hurts it, regen refills it), the hit timers and the knock-out countdown. */
  hp: HERO_HP,
  maxHp: HERO_HP,
  invuln: 0,
  hurt: 0,
  calm: 10,
  ko: 0,
  /** The last mission beacon stood next to: where a knocked-out player wakes up. */
  beacon: { x: MISSIONS[0].x, z: MISSIONS[0].z },
  /** Jumps taken since leaving the ground (the parkour boots allow a second one). */
  jumps: 0,
}

/**
 * Meshy rigs come out in real metres (rigged at a known height) but store the body under a 0.01-scaled
 * armature, so geometry bounds are misleading. Scale from the known rig height instead.
 */
function prepare(scene: THREE.Object3D, height: number, rigHeight: number) {
  const root = cloneSkinned(scene)
  root.scale.setScalar(height / rigHeight)
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
      m.frustumCulled = false
    }
  })
  return root
}

/** Place the player by the beacon of the region the visitor was looking at, facing its landmark. */
export function spawnPlayer() {
  const r = regionForTile(world.get().focus)
  const bx = r.center[0] + r.beacon[0], bz = r.center[1] + r.beacon[1]
  // Stand a few metres beyond the beacon, on the side away from the landmark.
  const away = new THREE.Vector2(bx - r.center[0], bz - r.center[1]).normalize()
  let x = bx + away.x * 5, z = bz + away.y * 5
  // Never start inside a prop: walk a widening ring around the intended spot until it is clear for the
  // player and for the camera a few metres behind them.
  const clear = (px: number, pz: number) => !blocked(px, pz, 0.8) && !blocked(px + away.x * 7.5, pz + away.y * 7.5, 1.2, heightAt(px, pz) + 1)
  if (!clear(x, z)) {
    search: for (let ring = 2; ring <= 24; ring += 2) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2
        const cx = x + Math.cos(a) * ring, cz = z + Math.sin(a) * ring
        if (clear(cx, cz)) {
          x = cx
          z = cz
          break search
        }
      }
    }
  }
  player.pos.set(x, heightAt(x, z), z)
  // Camera behind the player, looking towards the landmark.
  player.camYaw = Math.atan2(x - r.center[0], z - r.center[1])
  player.yaw = player.camYaw + Math.PI
  player.camPitch = 0.28
}

/* ---------- Guide NPC ---------- */

export function Guide() {
  const gltf = useGLTF(modelUrl('guide'), false, true)
  const model = useMemo(() => prepare(gltf.scene, 1.9, 1.8), [gltf])
  const group = useRef<THREE.Group>(null)
  const { actions, names } = useAnimations(gltf.animations, group)
  useEffect(() => {
    const a = actions[names[0]]
    a?.reset().setLoop(THREE.LoopRepeat, Infinity).play()
  }, [actions, names])
  const { x, z } = GUIDE_SPOT
  return (
    <group ref={group} position={[x, heightAt(x, z), z]} rotation={[0, Math.PI * 0.08, 0]}>
      <primitive object={model} />
    </group>
  )
}

/* ---------- Player ---------- */

/** The player character: the low-poly avatar from the profile page (one Meshy rig, all clips on one skeleton). */
const AVATAR_URL = `${import.meta.env.BASE_URL}profile/lowpoly.glb`
const AVATAR_CLIPS = {
  idle: /\|Idle\|/,
  walk: /Casual_Walk/,
  run: /RunFast/,
  jump: /Regular_Jump/,
  spell: /Charged_Spell_Cast/,
  fly: /\|Fly_Cruise\|/,
  boost: /\|Fly_Boost\|/,
  hover: /\|Fly_Hover\|/,
  takeoff: /\|Fly_TakeOff\|/,
  land: /\|Fly_Land\|/,
  punch: /Kung_Fu_Punch/,
  kick: /Roundhouse_Kick/,
  dash: /Flying_Fist_Kick/,
  spin: /360_Power_Spin_Jump/,
  cheer: /Victory_Cheer/,
}
type Anim = keyof typeof AVATAR_CLIPS
/** If a clip is missing from the model, play this one instead. */
const FALLBACK: Partial<Record<Anim, Anim>> = { fly: 'run', hover: 'idle', takeoff: 'jump', land: 'idle', punch: 'spell', kick: 'spell', dash: 'run', spin: 'spell', cheer: 'spell' }
const ONCE = new Set<Anim>(['jump', 'spell', 'punch', 'kick', 'dash', 'spin', 'cheer', 'takeoff', 'land'])
/** Clips whose hips must stay over the feet (physics owns where the body goes). */
const PINNED = new Set<Anim>(['punch', 'kick', 'dash', 'spin', 'fly', 'boost', 'hover', 'takeoff', 'land', 'cheer'])
/** Regular_Jump: crouch, take-off ~0.45 s, peak 0.83 s, landing ~1.25 s. Physics owns the height, so play from take-off. */
const JUMP_FROM = 0.42
/** The spell clip is long (2.7 s); play it briskly so a cast reads as a flick of the wrists. */
const SPELL_SPEED = 1.6

/**
 * Flight has its own clips on the rig: the classic superhero cruise (body flat, head up, lead fist ahead, the
 * other tucked at the chest, legs trailing with a knee flexing in turn), a both-fists boost blended in with speed,
 * an upright hover, a crouch-and-spring take-off and the kneeling fist-down landing. `flyPose` is an optional
 * additive tweak laid over the cruise / boost after the mixer (local Euler angles per bone, empty by default);
 * `?snap` exposes it as `__world.flyPose` for tuning.
 */
export const flyPose: Record<string, [number, number, number]> = {}
/** Take-off clip: crouch on the ground for this long before springing up; total length of the clip. */
const TAKEOFF_CROUCH = 0.28
const TAKEOFF = 0.9
/** Landing clip: the touchdown pose holds the player this long unless they move off (then it is cut short). */
const LANDING = 1.5
const LANDING_LOCK = 0.3
const poseQuat = new THREE.Quaternion()
const poseAdd = new THREE.Quaternion()
const poseEuler = new THREE.Euler()

/** Movement tiers (m/s): walk < run < fly (about 2.5x a run). */
const WALK = 4.6
const RUN = 9
const FLY = 22
const FLY_BOOST = 30
/** Flight ceiling above the ground, and absolute. */
const FLY_CEILING = 60
const FLY_MAX_Y = 95

type Move = 'punch' | 'kick' | 'spin' | 'dash'
interface MoveSpec {
  dur: number
  /** Active window (seconds into the move) when it can connect. */
  hit: [number, number]
  range: number
  arc: number
  damage: number
  knock: number
  lift: number
  /** What a follow-up press during this move chains into. */
  next?: Move
  /** How much walking is allowed while it plays (0 = rooted). */
  move: number
}

/** The melee set: punch -> roundhouse -> 360 spin combo, plus a dash attack while running. */
const MOVES: Record<Move, MoveSpec> = {
  punch: { dur: 0.42, hit: [0.1, 0.26], range: 1.8, arc: 1.0, damage: 1, knock: 5, lift: 3, next: 'kick', move: 0.25 },
  kick: { dur: 0.6, hit: [0.16, 0.38], range: 2.3, arc: 1.5, damage: 1, knock: 8, lift: 4.5, next: 'spin', move: 0.2 },
  spin: { dur: 0.78, hit: [0.12, 0.58], range: 2.9, arc: Math.PI, damage: 2, knock: 9, lift: 6, move: 0.35 },
  dash: { dur: 0.58, hit: [0.04, 0.4], range: 2.1, arc: 1.2, damage: 2, knock: 10, lift: 5, move: 0 },
}

/** The player's footprint radius for collisions. */
const PLAYER_RADIUS = 0.4

const dust = new THREE.Color('#cdbf9f')
const wind = new THREE.Color('#dff3ff')
const fxOpts: Emit = { count: 0, x: 0, y: 0, z: 0, speed: [0, 0], color: dust, size: [0, 0], life: [0, 0] }
function puff(count: number, x: number, y: number, z: number, color: THREE.Color, speed: number, life: number, size: number, smoke: boolean) {
  fxOpts.count = count
  fxOpts.x = x
  fxOpts.y = y
  fxOpts.z = z
  fxOpts.color = color
  fxOpts.color2 = undefined
  fxOpts.spread = smoke ? 0.4 : 0.15
  fxOpts.up = smoke ? 0.15 : 0.2
  fxOpts.speed = [speed * 0.5, speed]
  fxOpts.size = [size * 0.7, size]
  fxOpts.life = [life * 0.6, life]
  fxOpts.shape = smoke ? SHAPE.smoke : SHAPE.glow
  fxOpts.grow = smoke
  fxOpts.drag = smoke ? 3 : 1
  fxOpts.gravity = 0
  fxOpts.hdr = smoke ? 1 : 1.6
  emit(fxOpts)
}

const hitShape: HitShape = { x: 0, y: 0, z: 0, yaw: 0, arc: 0, range: 0, damage: 0, knock: 0, lift: 0, swing: 0 }

export function Player() {
  const gltf = useGLTF(AVATAR_URL, false, true)
  const model = useMemo(() => {
    const root = prepare(gltf.scene, 1.8, 1.75)
    // Flat shading for the faceted low-poly look (lit by the sky environment map).
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        const mat = (m.material as THREE.MeshStandardMaterial).clone()
        mat.flatShading = true
        mat.metalness = 0
        mat.roughness = 0.85
        m.material = mat
      }
    })
    return root
  }, [gltf])
  const bones = useMemo(() => {
    const map = new Map<string, THREE.Object3D>()
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) map.set(o.name, o)
    })
    return map
  }, [model])
  const hips = useMemo(() => {
    let h: THREE.Object3D | null = null
    model.traverse((o) => {
      if (!h && (o as THREE.Bone).isBone && o.name === 'Hips') h = o
    })
    const bone = h as THREE.Object3D | null
    return bone ? { bone, rest: bone.position.clone() } : null
  }, [model])
  const group = useRef<THREE.Group>(null)
  const tilt = useRef<THREE.Group>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const clips = useMemo(() => {
    const out: THREE.AnimationClip[] = []
    for (const [name, re] of Object.entries(AVATAR_CLIPS)) {
      const c = gltf.animations.find((a) => re.test(a.name))?.clone()
      if (c) {
        c.name = name
        out.push(c)
      }
    }
    return out
  }, [gltf])
  const { actions, mixer } = useAnimations(clips, group)
  const state = useRef({
    vy: 0,
    grounded: true,
    current: '' as string,
    near: null as string | null,
    teleportN: 0,
    castN: lastCast()?.n ?? 0,
    casting: 0,
    /** Seconds since the feet last touched the ground (a short fall does not start the jump clip). */
    airT: 0,
    /** How much of the flight pose tweak is laid over the clip (0..1), and of the boost clip over the cruise. */
    flyW: 0,
    boostW: 0,
    /** Seconds left of the take-off (crouch, spring) and of the superhero landing. */
    takeoff: 0,
    landing: 0,
    /** Ground speed eased towards the input (m/s), what the input asks for, and the last heading asked for. */
    moveSpeed: 0,
    moveTarget: 0,
    dirX: 0,
    dirZ: 1,
    flying: false,
    flyVel: new THREE.Vector3(),
    bank: 0,
    pitch: 0,
    lastYaw: 0,
    move: null as Move | null,
    moveT: 0,
    queued: false,
    swing: 0,
    stomp: false,
    cheerN: world.get().cheer?.n ?? 0,
    cheering: 0,
    trail: 0,
  })

  useEffect(() => {
    state.current.teleportN = world.get().teleport?.n ?? 0
    return () => {
      player.flying = false
      player.fly = 0
    }
  }, [])

  /** Cross-fade to a clip (or its fallback); `restart` replays a one-shot that's already current. */
  const fadeTo = (want: Anim, from = 0, restart = false) => {
    const s = state.current
    const name: Anim = actions[want] ? want : (FALLBACK[want] ?? want)
    if (s.current === name && !restart) return
    const next = actions[name]
    if (!next) return
    const once = ONCE.has(name)
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = once
    next.time = from
    next.timeScale = 1
    next.setEffectiveWeight(1).fadeIn(0.12).play()
    if (s.current && s.current !== name) actions[s.current]?.fadeOut(0.12)
    s.current = name
  }
  /** Play a one-shot clip squeezed into `dur` seconds. */
  const playMove = (anim: Anim, dur: number) => {
    fadeTo(anim, 0, true)
    const a = actions[state.current.current]
    if (a) a.timeScale = a.getClip().duration / dur
  }

  /** Start a melee move, turning to the nearest enemy close by (friendly auto-aim). */
  const startMove = (m: Move) => {
    const s = state.current
    s.move = m
    s.moveT = 0
    s.queued = false
    s.swing = newSwing()
    const e = nearestEnemy(player.pos.x, player.pos.z, 4.5) ?? nearestWild(player.pos.x, player.pos.z, 4.5)
    if (e) player.yaw = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
    player.swoosh = { n: player.swoosh.n + 1, move: m }
    playMove(m, MOVES[m].dur)
  }

  useFrame((_, rawDt) => {
    const raw = Math.min(rawDt, 0.05)
    // Hit-stop freezes the action (and the animation) for a beat when a blow lands.
    const dt = gameDt(raw)
    mixer.timeScale = dt > 0 ? 1 : 0
    const s = state.current
    const g = group.current
    if (!g) return
    pollPad()

    const tp = world.get().teleport
    if (tp && tp.n !== s.teleportN) {
      s.teleportN = tp.n
      player.pos.set(tp.x, heightAt(tp.x, tp.z), tp.z)
      s.flying = false
    }

    // Photo mode: time stands still; Space / click take the picture.
    if (controls.photo) {
      controls.photo = false
      if (world.get().open === null && world.get().panel === 'none' && !s.move && player.ko <= 0) togglePhoto(player.camYaw, player.camPitch)
    }
    if (photo.active) {
      if (controls.attack || controls.jump) requestSnap()
      controls.attack = controls.jump = controls.spin = controls.fly = controls.throw = controls.ride = false
      return
    }
    if (car.eject) {
      car.eject = false
      exitCar(player)
    }
    // In the car or on the airship: the body goes where the vehicle goes (hidden inside the car).
    if (inTransit()) {
      if (car.driving) {
        player.pos.copy(car.pos)
        player.yaw = car.yaw
        g.visible = false
      } else {
        player.pos.set(ship.pos.x, ship.pos.y + DECK, ship.pos.z)
        player.yaw = ship.yaw
        g.visible = true
        g.position.copy(player.pos)
        g.rotation.y = player.yaw
        fadeTo('idle')
      }
      s.flying = false
      s.grounded = true
      s.vy = 0
      s.move = null
      player.speed = car.driving ? Math.abs(car.speed) : 0
      player.flying = false
      player.fly = 0
      player.ground = player.pos.y
      controls.jump = controls.fly = controls.attack = controls.spin = controls.throw = controls.ride = false
      stepCombat(dt, raw, player)
      stepCreatures(dt, player)
      stepMinigames(dt, player)
      if (s.near) {
        s.near = null
        world.set({ near: null })
      }
      world.setPlayer({ x: player.pos.x, z: player.pos.z, heading: player.camYaw })
      return
    }
    g.visible = true
    // The ride: on and off a pal, with the mount's speeds (a flyer replaces the double-tap flight).
    if (controls.ride) {
      controls.ride = false
      if (world.get().open === null && !s.move && player.ko <= 0) {
        if (!ride.pal && s.flying) s.flying = false
        toggleRide(player)
        if (ride.pal && ride.pal.spec.ride !== 'fly') s.flying = false
      }
    }
    const mount = ride.pal
    const speeds = mount ? (mount.spec.ride === 'fly' ? MOUNT.fly : MOUNT.run) : null
    const WALK_NOW = speeds ? speeds.walk : WALK
    const RUN_NOW = speeds ? speeds.run : RUN
    const FLY_NOW = mount && mount.spec.ride === 'fly' ? MOUNT.fly.fly : FLY
    const BOOST_NOW = mount && mount.spec.ride === 'fly' ? MOUNT.fly.boost : FLY_BOOST
    // A Spark Sphere at the creature in front of the camera.
    if (controls.throw) {
      controls.throw = false
      if (world.get().open === null && player.ko <= 0) throwSphere(player, aimedCreature(player))
    }

    const modalOpen = world.get().open !== null || world.get().panel !== 'none' || playerLocked() || player.ko > 0
    const { x, y, run } = modalOpen ? { x: 0, y: 0, run: false } : moveAxes()
    const mag = Math.min(1, Math.hypot(x, y))
    // Input direction relative to the camera: forward is (-sin, -cos) of its yaw, right is perpendicular.
    const fx = -Math.sin(player.camYaw), fz = -Math.cos(player.camYaw)
    let dx = fx * y - fz * x, dz = fz * y + fx * x
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len

    // ---- Take off / land. ----
    if (controls.fly) {
      controls.fly = false
      const canFly = flightAllowed() && (!mount || mount.spec.ride === 'fly')
      if (!modalOpen && !s.flying && !s.move && canFly) {
        s.flying = true
        // From the ground (on foot): crouch, then spring up; from the air, straight into flight.
        s.takeoff = s.grounded && !mount ? TAKEOFF : 0
        s.landing = 0
        s.grounded = false
        s.stomp = false
        s.vy = Math.max(s.vy, 7)
        const sp = (run ? RUN_NOW : WALK_NOW) * mag
        s.flyVel.set(dx * sp, 0, dz * sp)
        puff(14, player.pos.x, player.pos.y + 0.2, player.pos.z, dust, 3, 0.7, 0.6, true)
        puff(10, player.pos.x, player.pos.y + 1, player.pos.z, wind, 4, 0.4, 0.18, false)
      } else if (s.flying) s.flying = false
    }

    // ---- Attacks. ----
    const wantAttack = controls.attack && !modalOpen && !mount
    const wantSpin = controls.spin && !modalOpen && !mount
    controls.attack = controls.spin = false
    if (wantAttack || wantSpin) {
      if (s.flying || !s.grounded) {
        // From the air: dive into a ground stomp.
        if (!s.stomp) {
          s.flying = false
          s.stomp = true
          s.move = null
          s.vy = -26
          s.flyVel.set(0, 0, 0)
          fadeTo('dash', 0, true)
        }
      } else if (s.move) {
        const spec = MOVES[s.move]
        if (spec.next && s.moveT > spec.hit[0]) s.queued = true
      } else if (wantSpin) startMove('spin')
      else if (player.speed > 6.5) startMove('dash')
      else startMove('punch')
    }

    let speed = 0
    const prevX = player.pos.x, prevZ = player.pos.z
    if (s.flying) {
      // ---- Flight: fastest way across the island, with altitude control and a hover. ----
      const max = run ? BOOST_NOW : FLY_NOW
      const k = Math.min(1, dt * 2.4)
      s.flyVel.x += (dx * max * mag - s.flyVel.x) * k
      s.flyVel.z += (dz * max * mag - s.flyVel.z) * k
      player.pos.x += s.flyVel.x * dt
      player.pos.z += s.flyVel.z * dt
      const axis = modalOpen ? 0 : flyAxis()
      controls.jump = false
      const target = axis * 10 + (axis === 0 ? Math.sin(performance.now() / 420) * 0.35 : 0)
      s.vy += (target - s.vy) * Math.min(1, dt * 4)
      if (s.takeoff > 0) s.takeoff -= dt
      // The take-off crouch keeps the feet down, then the spring launches up.
      if (s.takeoff > TAKEOFF - TAKEOFF_CROUCH) s.vy = Math.max(s.vy, 9)
      else player.pos.y += s.vy * dt
      const ground = Math.max(groundAt(player.pos.x, player.pos.z, player.pos.y), WATER_LEVEL, roofAt(player.pos.x, player.pos.z, player.pos.y))
      const ceiling = Math.min(ground + FLY_CEILING, FLY_MAX_Y)
      if (player.pos.y > ceiling) {
        player.pos.y = ceiling
        s.vy = Math.min(s.vy, 0)
      }
      if (player.pos.y <= ground + 0.02) {
        player.pos.y = ground
        // Touchdown: descending onto the ground lands (over water you just skim).
        if (axis < 0 && ground > WATER_LEVEL + 0.1) {
          s.flying = false
          s.grounded = true
          s.vy = 0
          s.takeoff = 0
          // The superhero landing: one knee and one fist down.
          if (!mount) {
            s.landing = LANDING
            fadeTo('land', 0, true)
          }
          puff(12, player.pos.x, ground + 0.1, player.pos.z, dust, 3, 0.6, 0.5, true)
        } else s.vy = Math.max(s.vy, 0)
      }
      speed = Math.hypot(s.flyVel.x, s.flyVel.z)
      s.moveSpeed = s.moveTarget = Math.min(speed, RUN_NOW)
      if (speed > 1) player.yaw = turnTowards(player.yaw, Math.atan2(s.flyVel.x, s.flyVel.z), dt * 6)
    } else {
      // ---- On foot. ----
      const spec = s.move ? MOVES[s.move] : null
      // Ease between standing, walking and running instead of snapping: the short ramp reads as weight, and
      // a half-pressed stick never flips the animation at a threshold. The heading is remembered so the
      // slow-down after releasing the keys carries on in the direction of travel.
      s.moveTarget = (run ? RUN_NOW : WALK_NOW) * mag * (spec ? spec.move : 1)
      const ramp = s.moveTarget > s.moveSpeed ? 45 : 60
      s.moveSpeed = s.moveTarget > s.moveSpeed ? Math.min(s.moveTarget, s.moveSpeed + ramp * dt) : Math.max(s.moveTarget, s.moveSpeed - ramp * dt)
      speed = s.moveSpeed
      if (mag > 0.01) {
        s.dirX = dx
        s.dirZ = dz
      }
      dx = s.dirX
      dz = s.dirZ
      if (s.move === 'dash' && s.moveT < 0.38) {
        // The flying fist kick lunges forward.
        speed = 13
        dx = Math.sin(player.yaw)
        dz = Math.cos(player.yaw)
      }
      if (speed > 0.1) {
        const nx = player.pos.x + dx * speed * dt, nz = player.pos.z + dz * speed * dt
        const deep = heightAt(nx, nz) < WATER_LEVEL - 0.9
        const outside = Math.hypot(nx, nz) > ISLAND_RADIUS + 10
        if (!deep && !outside) {
          player.pos.x = nx
          player.pos.z = nz
        }
        if (!s.move && mag > 0.01) player.yaw = turnTowards(player.yaw, Math.atan2(dx, dz), dt * 12)
      }
    }
    // Shoved by an enemy bump.
    if (player.knock.lengthSq() > 0.01) {
      player.pos.x += player.knock.x * dt
      player.pos.z += player.knock.y * dt
      player.knock.multiplyScalar(Math.exp(-dt * 6))
    }
    // Keep inside the island while flying out over the sea.
    const fromCentre = Math.hypot(player.pos.x, player.pos.z)
    if (fromCentre > ISLAND_RADIUS + 40) {
      player.pos.x *= (ISLAND_RADIUS + 40) / fromCentre
      player.pos.z *= (ISLAND_RADIUS + 40) / fromCentre
    }

    // Solid world: buildings, trees, rocks, bushes, the neon skyline and the guide (spatial-grid lookup).
    // Props are only solid up to their tops, so you can fly (or jump) over them but never through them.
    const bx = player.pos.x, bz = player.pos.z
    if (resolve(player.pos, PLAYER_RADIUS, player.pos.y) && s.flying) {
      // Hitting a wall in flight kills the speed into it (you slide along instead of grinding).
      const nx = player.pos.x - bx, nz = player.pos.z - bz
      const l = Math.hypot(nx, nz)
      const vn = l > 1e-4 ? (s.flyVel.x * nx + s.flyVel.z * nz) / l : 0
      if (vn < 0) {
        s.flyVel.x -= (vn * nx) / l
        s.flyVel.z -= (vn * nz) / l
      }
    }
    // Animals are solid too, unless you're above them (jumping over, or landing on one to bounce).
    for (const a of animals()) {
      if (player.pos.y - a.pos.y > a.spec.height * a.scale * 0.6) continue
      const r = a.spec.radius * a.scale + PLAYER_RADIUS
      const ax = player.pos.x - a.pos.x, az = player.pos.z - a.pos.z
      const d2 = ax * ax + az * az
      if (d2 >= r * r) continue
      const d = Math.sqrt(d2)
      if (d < 1e-4) player.pos.x += r
      else {
        player.pos.x = a.pos.x + (ax / d) * r
        player.pos.z = a.pos.z + (az / d) * r
      }
    }
    // Creatures are solid too (the one being ridden is under you, not in the way).
    pushOutOfCreatures(player.pos, PLAYER_RADIUS)
    // Never get shoved into deep water on foot: keep last frame's (already resolved) spot instead.
    if (!s.flying && heightAt(player.pos.x, player.pos.z) < WATER_LEVEL - 0.9) {
      player.pos.x = prevX
      player.pos.z = prevZ
    }

    // ---- Gravity, jumping, bouncing off an animal's back, and the stomp landing. ----
    if (!s.flying) {
      // Roofs (the neon blocks, the parkour pads) are floors too when the feet are at their level.
      const ground = Math.max(groundAt(player.pos.x, player.pos.z, player.pos.y), WATER_LEVEL - 0.9, roofAt(player.pos.x, player.pos.z, player.pos.y))
      const boots = parkourBoots()
      if (controls.jump && s.grounded && !modalOpen && !s.move) {
        s.vy = boots ? 10 : 7.5
        s.grounded = false
        player.jumps = 1
      } else if (controls.jump && !s.grounded && !s.stomp && boots && player.jumps < 2 && !modalOpen) {
        // The trial boots: one more jump from the air.
        s.vy = 8.5
        player.jumps = 2
        puff(10, player.pos.x, player.pos.y + 0.1, player.pos.z, wind, 3, 0.4, 0.3, false)
      }
      controls.jump = false
      if (player.bounce > 0) {
        s.vy = player.bounce
        s.grounded = false
        s.stomp = false
        player.bounce = 0
      }
      const wasGrounded = s.grounded
      s.vy -= 22 * dt
      player.pos.y += s.vy * dt
      // Running down a slope or across the terrain's facets is not leaving the ground: while not actually
      // jumping, stay on a floor that is only a step below the feet (otherwise every downhill frame
      // flickered the run into the jump clip and back).
      if (player.pos.y > ground && wasGrounded && s.vy <= 0 && player.pos.y - ground < 0.7) {
        player.pos.y = ground
        s.vy = 0
      }
      if (player.pos.y <= ground) {
        player.pos.y = ground
        s.vy = 0
        s.grounded = true
        player.jumps = 0
        if (s.stomp) {
          // Ground stomp: a shockwave that pops everything around.
          s.stomp = false
          hitShape.x = player.pos.x
          hitShape.y = player.pos.y
          hitShape.z = player.pos.z
          hitShape.yaw = player.yaw
          hitShape.arc = Math.PI
          hitShape.range = 3.8
          hitShape.damage = 2
          hitShape.knock = 9
          hitShape.lift = 7
          hitShape.swing = newSwing()
          hitEnemies(hitShape)
          hitCreatures(hitShape)
          impact(0.05, 0.55)
          player.stomp = { n: player.stomp.n + 1 }
          puff(22, player.pos.x, ground + 0.15, player.pos.z, dust, 6, 0.8, 0.7, true)
          s.move = null
          fadeTo('idle')
        }
      } else s.grounded = false
    }
    s.airT = s.grounded ? 0 : s.airT + dt
    player.vy = s.vy
    player.speed = speed
    player.flying = s.flying
    player.fly = s.flying ? Math.min(1, speed / FLY_BOOST) : 0

    // ---- Melee move timeline: hits during the active window, combo chaining at the end. ----
    if (s.move) {
      const spec = MOVES[s.move]
      s.moveT += dt
      if (s.moveT >= spec.hit[0] && s.moveT <= spec.hit[1]) {
        const reach = s.move === 'spin' ? 0 : spec.range * 0.35
        hitShape.x = player.pos.x + Math.sin(player.yaw) * reach
        hitShape.y = player.pos.y
        hitShape.z = player.pos.z + Math.cos(player.yaw) * reach
        hitShape.yaw = player.yaw
        hitShape.arc = spec.arc
        hitShape.range = spec.range
        hitShape.damage = spec.damage
        hitShape.knock = spec.knock
        hitShape.lift = spec.lift
        hitShape.swing = s.swing
        hitEnemies(hitShape)
        hitCreatures(hitShape)
      }
      if (s.moveT >= spec.dur) {
        const next = s.queued ? spec.next : undefined
        s.move = null
        if (next) startMove(next)
      }
    }

    // ---- Body: position, facing, and the flight tilt (nose-down when flying fast, banking into turns). ----
    g.position.copy(player.pos)
    // In the saddle: the body sits on the mount's back.
    const saddle = mount ? saddleHeight(mount) : 0
    g.position.y += saddle
    g.rotation.y = player.yaw
    // The contact shadow stays on the ground below, shrinking with altitude.
    player.ground = Math.max(groundAt(player.pos.x, player.pos.z, player.pos.y), WATER_LEVEL)
    const alt = player.pos.y - player.ground + saddle
    if (shadow.current) {
      shadow.current.position.y = 0.03 - alt
      shadow.current.scale.setScalar(Math.max(0.35, 1 - alt * 0.03))
      shadow.current.visible = alt < 40
    }
    let yawRate = player.yaw - s.lastYaw
    yawRate = Math.atan2(Math.sin(yawRate), Math.cos(yawRate)) / Math.max(dt, 1e-3)
    s.lastYaw = player.yaw
    // The flight clips already lie flat; at speed the body only noses a little into climbs and dives (and a flying
    // mount's rider leans forward).
    const flat = THREE.MathUtils.clamp(speed / FLY, 0, 1)
    const pitchTo = s.flying ? (mount ? flat * 0.5 : flat * (0.08 - THREE.MathUtils.clamp(s.vy / 10, -1, 1) * 0.3)) : s.stomp ? 0.5 : 0
    const bankTo = s.flying ? THREE.MathUtils.clamp(-yawRate * 0.18, -0.6, 0.6) : 0
    s.pitch += (pitchTo - s.pitch) * Math.min(1, raw * 5)
    s.bank += (bankTo - s.bank) * Math.min(1, raw * 4)
    if (tilt.current) tilt.current.rotation.set(s.pitch, 0, s.bank)
    // A wind trail streams off the hands and feet at speed.
    if (s.flying && speed > 8) {
      s.trail += raw
      if (s.trail > 0.03) {
        s.trail = 0
        puff(1, player.pos.x + Math.cos(player.yaw) * 0.5, player.pos.y + 0.9, player.pos.z - Math.sin(player.yaw) * 0.5, wind, 0.4, 0.45, 0.16, false)
        puff(1, player.pos.x - Math.cos(player.yaw) * 0.5, player.pos.y + 0.9, player.pos.z + Math.sin(player.yaw) * 0.5, wind, 0.4, 0.45, 0.16, false)
      }
    }

    // A new spell cast plays the casting clip (moving cancels it; the spell itself still fires).
    const cast = lastCast()
    if (cast && cast.n !== s.castN) {
      s.castN = cast.n
      if (!s.move && !s.flying) {
        s.casting = (actions.spell?.getClip().duration ?? 0) / SPELL_SPEED
        fadeTo('spell', 0, true)
        if (actions.spell) actions.spell.timeScale = SPELL_SPEED
      }
    }
    if (s.casting > 0) {
      s.casting -= dt
      if (speed > 0.1 || !s.grounded || s.move) s.casting = 0
    }
    // A won mission: a victory cheer.
    const cheer = world.get().cheer
    if (cheer && cheer.n !== s.cheerN) {
      s.cheerN = cheer.n
      if (!s.flying) {
        s.cheering = 2.6
        playMove('cheer', 2.6)
      }
    }
    if (s.cheering > 0) {
      s.cheering -= dt
      if (speed > 0.1 || s.move || s.flying) s.cheering = 0
    }

    // Animation priority: attacks, stomp, flight, airborne, cheer, cast, then walk / run / idle by speed.
    if (s.move) {
      // The move's clip is already playing.
    } else if (s.stomp) {
      // Diving: keep the flying-kick pose.
    } else if (s.flying && !mount) {
      if (s.takeoff > 0 && speed < 12) fadeTo('takeoff')
      else if (speed > (s.current === 'fly' ? 3 : 5)) fadeTo('fly')
      else fadeTo('hover')
    } else if (s.flying) {
      fadeTo('idle')
    } else if (s.landing > 0 && s.grounded && s.current === 'land') {
      // The superhero landing plays out unless the player moves off (or jumps) after the impact.
      s.landing -= dt
      if (LANDING - s.landing > LANDING_LOCK && (s.moveTarget > 0.3 || s.move)) s.landing = 0
    } else if (!s.grounded && (s.vy > 0.5 || s.airT > 0.12)) {
      fadeTo('jump', JUMP_FROM)
      // Physics owns the height: keep the clip's crouch but drop its own upward hip travel.
      if (actions.jump) actions.jump.timeScale = 1.1
    } else if (s.cheering > 0 || s.casting > 0) {
      // Keep playing it.
    } else if (mount) {
      fadeTo('idle')
    } else {
      // Pick the clip from what the input asks for (so a key press goes straight to its clip without a pass
      // through the one in between) with a dead band around each threshold, and pace it to the eased speed.
      const want = s.flying ? speed : s.moveTarget
      const cur = s.current
      const ease = Math.min(1, dt * 10)
      if (want > (cur === 'run' ? 2.2 : 3.2)) {
        fadeTo('run')
        if (actions.run) actions.run.timeScale += (THREE.MathUtils.clamp(speed / 7, 0.7, 1.35) - actions.run.timeScale) * ease
      } else if (want > (cur === 'walk' ? 0.08 : 0.3)) {
        fadeTo('walk')
        if (actions.walk) actions.walk.timeScale += (THREE.MathUtils.clamp(speed / 1.4, 0.6, 1.6) - actions.walk.timeScale) * ease
      } else fadeTo('idle')
    }
    player.anim = s.current
    // Flat out (the boost key): the both-fists streamline is blended over the cruise by speed.
    const boost = actions.boost
    if (boost) {
      const wantBoost = s.current === 'fly' ? THREE.MathUtils.clamp((speed - FLY_NOW) / (BOOST_NOW - FLY_NOW), 0, 1) : 0
      s.boostW += (wantBoost - s.boostW) * Math.min(1, dt * 3)
      if (s.boostW > 0.01) {
        if (!boost.isRunning()) boost.reset().setLoop(THREE.LoopRepeat, Infinity).play()
        boost.weight = s.boostW
        if (actions.fly) actions.fly.weight = 1 - s.boostW
      } else if (boost.isRunning()) {
        boost.stop()
        if (actions.fly) actions.fly.weight = 1
      }
    }

    // The mission fight (enemies, waves), the wild creatures and the mini-game run off the player's clock.
    stepCombat(dt, raw, player)
    stepCreatures(dt, player)
    stepMinigames(dt, player)

    // Nearest mission within reach.
    let near: string | null = null
    let best = INTERACT_DISTANCE
    for (const m of MISSIONS) {
      const d = Math.hypot(m.x - player.pos.x, m.z - player.pos.z)
      if (d < 8) player.beacon = { x: m.x, z: m.z }
      if (d < best) {
        best = d
        near = m.tile.id
      }
    }
    if (s.flying || world.get().fight) near = null
    if (near !== s.near) {
      s.near = near
      world.set({ near })
    }
    world.setPlayer({ x: player.pos.x, z: player.pos.z, heading: player.camYaw })
  })

  // After the mixer (useAnimations updates in its own frame callback): physics owns where the body is, so
  // cap the jump clip's hip lift and pin the hips of moves that travel on their own.
  useFrame((_, rawDt) => {
    const s = state.current
    const cur = s.current as Anim
    if (hips) {
      if (cur === 'jump') hips.bone.position.y = Math.min(hips.bone.position.y, hips.rest.y)
      if (PINNED.has(cur)) {
        hips.bone.position.x = hips.rest.x
        hips.bone.position.z = hips.rest.z
      }
    }
    // The optional flight pose tweak (additive, local) eases in over the cruise and out again when slowing or landing.
    const dt = Math.min(rawDt, 0.05)
    const to = cur === 'fly' ? 1 : 0
    s.flyW += (to - s.flyW) * Math.min(1, dt * (to ? 5 : 7))
    if (s.flyW > 0.002) {
      for (const name in flyPose) {
        const bone = bones.get(name)
        if (!bone) continue
        const e = flyPose[name]
        poseQuat.setFromEuler(poseEuler.set(e[0], e[1], e[2]))
        bone.quaternion.multiply(poseAdd.identity().slerp(poseQuat, s.flyW))
      }
    }
  }, 1)

  return (
    <group ref={group} name="player">
      {/* Flight tilt pivots around the waist. */}
      <group ref={tilt} position={[0, 0.95, 0]}>
        <group position={[0, -0.95, 0]}>
          <primitive object={model} />
        </group>
      </group>
      {/* Soft contact shadow so the player reads as grounded even without shadow maps. */}
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </group>
  )
}

function turnTowards(from: number, to: number, k: number) {
  let d = to - from
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return from + d * Math.min(1, k)
}

useGLTF.preload(modelUrl('guide'), false, true)
