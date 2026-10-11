// The Higgsfield-generated, rigged characters: the player (the visitor's low-poly avatar, with idle, walk, run,
// jump and spell-cast clips) and the waving guide.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { REGIONS, ISLAND_RADIUS, WATER_LEVEL, regionForTile } from './regions'
import { heightAt } from './terrain'
import { modelUrl } from './Models'
import { neonBlocks } from './Ambient'
import { controls, moveAxes } from './controls'
import { MISSIONS, INTERACT_DISTANCE } from './missions'
import { lastCast } from './spells'
import { world } from './store'

/** Shared player state, read by the camera rig. */
export const player = {
  pos: new THREE.Vector3(0, 3, 8),
  yaw: 0,
  camYaw: Math.PI,
  camPitch: 0.32,
  speed: 0,
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
  const x = bx + away.x * 5, z = bz + away.y * 5
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
  const hub = REGIONS[0]
  const x = hub.center[0] - 3, z = hub.center[1] + 9
  return (
    <group ref={group} position={[x, heightAt(x, z), z]} rotation={[0, Math.PI * 0.08, 0]}>
      <primitive object={model} />
    </group>
  )
}

/* ---------- Player ---------- */

// Solid landmarks (buildings): a radius roughly matching each landmark's footprint so the player
// can't walk through them. Scaled up from the old 0.62 factor which let the player clip into buildings.
const CIRCLE_COLLIDERS = REGIONS.flatMap((r) =>
  r.landmarks.map((l) => ({ x: r.center[0] + l.at[0], z: r.center[1] + l.at[1], r: (l.pad ?? 4) * 0.95 })),
)

// Neon skyline towers are rectangular; collide against their footprints so the player can't walk through.
const BOX_COLLIDERS = neonBlocks().map((b) => ({ x: b.x, z: b.z, hw: b.w / 2 + 0.4, hd: b.d / 2 + 0.4 }))

/** The player character: the low-poly avatar from the profile page (one Meshy rig, all clips on one skeleton). */
const AVATAR_URL = `${import.meta.env.BASE_URL}profile/lowpoly.glb`
const AVATAR_CLIPS = { idle: /\|Idle\|/, walk: /Casual_Walk/, run: /RunFast/, jump: /Regular_Jump/, spell: /Charged_Spell_Cast/ }
type Anim = keyof typeof AVATAR_CLIPS
/** Regular_Jump: crouch, take-off ~0.45 s, peak 0.83 s, landing ~1.25 s. Physics owns the height, so play from take-off. */
const JUMP_FROM = 0.42
/** The spell clip is long (2.7 s); play it briskly so a cast reads as a flick of the wrists. */
const SPELL_SPEED = 1.6

export function Player() {
  const gltf = useGLTF(AVATAR_URL, false, true)
  const model = useMemo(() => {
    const root = prepare(gltf.scene, 1.8, 1.75)
    // Flat shading for the faceted low-poly look.
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
  const hips = useMemo(() => {
    let h: THREE.Object3D | null = null
    model.traverse((o) => {
      if (!h && (o as THREE.Bone).isBone && o.name === 'Hips') h = o
    })
    return h ? { bone: h as THREE.Object3D, restY: (h as THREE.Object3D).position.y } : null
  }, [model])
  const group = useRef<THREE.Group>(null)
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
  const { actions } = useAnimations(clips, group)
  const state = useRef({ vy: 0, grounded: true, current: '' as string, near: null as string | null, teleportN: 0, castN: lastCast()?.n ?? 0, casting: 0 })

  useEffect(() => {
    state.current.teleportN = world.get().teleport?.n ?? 0
    // Bouncing on the critter launches the player upward (Mario-style).
    const onBounce = () => {
      state.current.vy = 10
      state.current.grounded = false
    }
    window.addEventListener('critter-bounce', onBounce)
    return () => window.removeEventListener('critter-bounce', onBounce)
  }, [])

  const fadeTo = (name: Anim, from = 0) => {
    const s = state.current
    if (s.current === name) return
    const next = actions[name]
    if (!next) return
    const once = name === 'jump' || name === 'spell'
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = once
    next.time = from
    next.setEffectiveWeight(1).fadeIn(0.2).play()
    if (s.current) actions[s.current]?.fadeOut(0.2)
    s.current = name
  }

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = state.current
    const g = group.current
    if (!g) return

    const tp = world.get().teleport
    if (tp && tp.n !== s.teleportN) {
      s.teleportN = tp.n
      player.pos.set(tp.x, heightAt(tp.x, tp.z), tp.z)
    }

    const modalOpen = world.get().open !== null
    const { x, y, run } = modalOpen ? { x: 0, y: 0, run: false } : moveAxes()
    const speed = (run ? 9 : 4.6) * Math.min(1, Math.hypot(x, y))
    if (speed > 0.1) {
      // Move relative to the camera's heading.
      const fwd = new THREE.Vector3(-Math.sin(player.camYaw), 0, -Math.cos(player.camYaw))
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
      const dir = fwd.multiplyScalar(y).add(right.multiplyScalar(x)).normalize()
      const nx = player.pos.x + dir.x * speed * dt, nz = player.pos.z + dir.z * speed * dt
      const deep = heightAt(nx, nz) < WATER_LEVEL - 0.9
      const outside = Math.hypot(nx, nz) > ISLAND_RADIUS + 10
      if (!deep && !outside) {
        player.pos.x = nx
        player.pos.z = nz
      }
      const targetYaw = Math.atan2(dir.x, dir.z)
      let d = targetYaw - player.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      player.yaw += d * Math.min(1, dt * 12)
    }
    // Push out of circular landmark footprints.
    for (const c of CIRCLE_COLLIDERS) {
      const dx = player.pos.x - c.x, dz = player.pos.z - c.z
      const d = Math.hypot(dx, dz)
      if (d < c.r && d > 1e-3) {
        player.pos.x = c.x + (dx / d) * c.r
        player.pos.z = c.z + (dz / d) * c.r
      }
    }
    // Push out of rectangular neon-tower footprints (resolve along the shallower axis).
    const pr = 0.4 // player radius padding
    for (const b of BOX_COLLIDERS) {
      const dx = player.pos.x - b.x, dz = player.pos.z - b.z
      const px = b.hw + pr - Math.abs(dx)
      const pz = b.hd + pr - Math.abs(dz)
      if (px > 0 && pz > 0) {
        if (px < pz) player.pos.x = b.x + Math.sign(dx || 1) * (b.hw + pr)
        else player.pos.z = b.z + Math.sign(dz || 1) * (b.hd + pr)
      }
    }

    // Gravity and jumping.
    const ground = Math.max(heightAt(player.pos.x, player.pos.z), WATER_LEVEL - 0.9)
    if (controls.jump && s.grounded && !modalOpen) {
      s.vy = 7.5
      s.grounded = false
    }
    controls.jump = false
    s.vy -= 22 * dt
    player.pos.y += s.vy * dt
    if (player.pos.y <= ground) {
      player.pos.y = ground
      s.vy = 0
      s.grounded = true
    }
    player.speed = speed

    g.position.copy(player.pos)
    g.rotation.y = player.yaw

    // A new spell cast plays the casting clip (moving cancels it; the spell itself still fires).
    const cast = lastCast()
    if (cast && cast.n !== s.castN) {
      s.castN = cast.n
      s.casting = (actions.spell?.getClip().duration ?? 0) / SPELL_SPEED
      s.current = '' // restart even if a cast is already playing
      fadeTo('spell')
      if (actions.spell) actions.spell.timeScale = SPELL_SPEED
    }
    if (s.casting > 0) {
      s.casting -= dt
      if (speed > 0.1 || !s.grounded) s.casting = 0
    }

    // Animation: airborne → jump, casting → spell, otherwise walk / run / idle by speed.
    if (!s.grounded) {
      fadeTo('jump', JUMP_FROM)
      // Physics owns the height: keep the clip's crouch but drop its own upward hip travel.
      if (actions.jump) actions.jump.timeScale = 1.1
    } else if (s.casting > 0) {
      // Keep playing the cast.
    } else if (speed > 2.5) {
      fadeTo('run')
      if (actions.run) actions.run.timeScale = THREE.MathUtils.clamp(speed / 7, 0.7, 1.35)
    } else if (speed > 0.1) {
      fadeTo('walk')
      if (actions.walk) actions.walk.timeScale = THREE.MathUtils.clamp(speed / 1.4, 0.6, 1.6)
    } else fadeTo('idle')

    // Nearest mission within reach.
    let near: string | null = null
    let best = INTERACT_DISTANCE
    for (const m of MISSIONS) {
      const d = Math.hypot(m.x - player.pos.x, m.z - player.pos.z)
      if (d < best) {
        best = d
        near = m.tile.id
      }
    }
    if (near !== s.near) {
      s.near = near
      world.set({ near })
    }
    world.setPlayer({ x: player.pos.x, z: player.pos.z, heading: player.camYaw })
  })

  // After the mixer (useAnimations updates in its own frame callback), cap the jump clip's hip lift.
  useFrame(() => {
    if (hips && state.current.current === 'jump') hips.bone.position.y = Math.min(hips.bone.position.y, hips.restY)
  }, 1)

  return (
    <group ref={group}>
      <primitive object={model} />
      {/* Soft contact shadow so the player reads as grounded even without shadow maps. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <circleGeometry args={[0.55, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </group>
  )
}

useGLTF.preload(modelUrl('guide'), false, true)
