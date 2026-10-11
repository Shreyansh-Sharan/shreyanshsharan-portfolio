// The Higgsfield-generated, rigged characters: the player (walk + idle clips) and the waving guide.
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

export function Player() {
  const walk = useGLTF(modelUrl('explorer'), false, true)
  const idle = useGLTF(modelUrl('explorer-idle'), false, true)
  const model = useMemo(() => prepare(walk.scene, 1.8, 1.75), [walk])
  const group = useRef<THREE.Group>(null)
  const clips = useMemo(() => {
    const w = walk.animations[0]?.clone()
    const i = idle.animations[0]?.clone()
    if (w) w.name = 'walk'
    if (i) i.name = 'idle'
    return [w, i].filter(Boolean) as THREE.AnimationClip[]
  }, [walk, idle])
  const { actions } = useAnimations(clips, group)
  const state = useRef({ vy: 0, grounded: true, current: '' as string, near: null as string | null, teleportN: 0, runBlend: 0, runPhase: 0 })

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

  const fadeTo = (name: string) => {
    const s = state.current
    if (s.current === name) return
    const next = actions[name]
    if (!next) return
    next.reset().setEffectiveWeight(1).fadeIn(0.25).play()
    if (s.current) actions[s.current]?.fadeOut(0.25)
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

    if (speed > 0.1) {
      fadeTo('walk')
      const a = actions.walk
      if (a) a.timeScale = run ? 2.0 : 1.05
    } else fadeTo(actions.idle ? 'idle' : 'walk')
    if (!actions.idle && speed <= 0.1 && actions.walk) actions.walk.timeScale = 0

    // Procedural run: the model only ships walk + idle clips, so running is read through a forward
    // lean plus a faster vertical bob and a subtle side sway layered on top of the sped-up walk clip.
    const runAmt = run && speed > 4 ? 1 : 0
    s.runBlend = THREE.MathUtils.lerp(s.runBlend, runAmt, Math.min(1, dt * 6))
    if (s.runBlend > 0.001) {
      s.runPhase += dt * (10 + speed) // cadence rises with speed
      const b = s.runBlend
      g.rotation.x = 0.16 * b // forward lean
      g.position.y += Math.abs(Math.sin(s.runPhase)) * 0.12 * b // vertical bob
      g.rotation.z = Math.sin(s.runPhase) * 0.05 * b // side sway
    } else {
      g.rotation.x = 0
      g.rotation.z = 0
    }

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
