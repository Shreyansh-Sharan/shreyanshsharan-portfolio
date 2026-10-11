// A funny PalWorld-ish creature you can bounce on (Mario-style) and zap with random spells.
// Built procedurally so it needs no asset, and it reacts to the active spell in spells.ts.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { heightAt } from './terrain'
import { ISLAND_RADIUS, REGIONS, WATER_LEVEL } from './regions'
import { player } from './Characters'
import { controls } from './controls'
import { critter, castSpell, randomSpell } from './spells'
import { world } from './store'
import { play } from '../lib/sound'

const BODY = '#ffcf5c'
const BELLY = '#fff2cf'
const CHEEK = '#ff8da1'

/** A wander target the critter ambles toward, re-rolled when reached. */
function pickWander(from: THREE.Vector3) {
  const hub = REGIONS[0]
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 6 + Math.random() * 26
    const x = THREE.MathUtils.clamp(from.x + Math.cos(a) * r, -ISLAND_RADIUS + 6, ISLAND_RADIUS - 6)
    const z = THREE.MathUtils.clamp(from.z + Math.sin(a) * r, -ISLAND_RADIUS + 6, ISLAND_RADIUS - 6)
    if (heightAt(x, z) > WATER_LEVEL) return new THREE.Vector3(x, 0, z)
  }
  return new THREE.Vector3(hub.center[0], 0, hub.center[1])
}

export function Critter() {
  const group = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const flower = useRef<THREE.Group>(null)
  const ice = useRef<THREE.Mesh>(null)
  const state = useRef({
    wander: new THREE.Vector3(14, 0, 10),
    yaw: 0,
    hopPhase: 0,
    squash: 0,
    spin: 0,
    lastCastN: 0,
    cooldown: 0,
  })

  // Spawn near the hub where the player starts.
  const start = useMemo(() => {
    const hub = REGIONS[0]
    const x = hub.center[0] + 8
    const z = hub.center[1] + 8
    critter.pos.set(x, heightAt(x, z), z)
    state.current.wander.set(x + 6, 0, z)
    return critter.pos
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const g = group.current
    if (!g || world.get().open !== null) return
    const s = state.current

    // ---- Cast handling: a click or F near the world fires a random spell at the critter. ----
    if (controls.cast) {
      controls.cast = false
      if (s.cooldown <= 0) {
        s.cooldown = 0.35
        const spell = randomSpell()
        castSpell(spell, player.pos)
        play('select')
      }
    }
    s.cooldown = Math.max(0, s.cooldown - dt)

    const eff = critter.effect
    const effId = eff?.spell.id ?? null
    if (eff) {
      eff.t += dt
      if (eff.t >= eff.spell.duration) critter.effect = null
    }

    // ---- Wander AI (paused while frozen or launched). ----
    const frozen = effId === 'freeze'
    const launched = effId === 'bounce'
    if (!frozen && !launched) {
      const toTarget = new THREE.Vector2(s.wander.x - critter.pos.x, s.wander.z - critter.pos.z)
      if (toTarget.length() < 2) s.wander = pickWander(critter.pos)
      else {
        const dir = toTarget.normalize()
        const sp = 2.6
        const nx = critter.pos.x + dir.x * sp * dt
        const nz = critter.pos.z + dir.y * sp * dt
        if (heightAt(nx, nz) > WATER_LEVEL && Math.hypot(nx, nz) < ISLAND_RADIUS - 4) {
          critter.pos.x = nx
          critter.pos.z = nz
        } else s.wander = pickWander(critter.pos)
        s.yaw = Math.atan2(dir.x, dir.y)
        s.hopPhase += dt * 7
      }
    }

    // ---- Vertical physics (gravity + launch). ----
    const ground = Math.max(heightAt(critter.pos.x, critter.pos.z), WATER_LEVEL)
    if (launched && eff && eff.t < 0.05) {
      critter.vy = 11
      critter.grounded = false
      s.spin = 1
    }
    critter.vy -= 24 * dt
    critter.pos.y += critter.vy * dt
    if (critter.pos.y <= ground) {
      critter.pos.y = ground
      critter.vy = 0
      critter.grounded = true
    }

    // ---- Mario-style bounce: the player landing on the critter bounces off and squashes it. ----
    const dx = player.pos.x - critter.pos.x
    const dz = player.pos.z - critter.pos.z
    const horiz = Math.hypot(dx, dz)
    const above = player.pos.y - critter.pos.y
    if (horiz < 1.3 && above > 0.6 && above < 2.6) {
      // Read the player's falling velocity indirectly: if close and descending, bounce.
      player.pos.y = critter.pos.y + 2.4
      // Push the player upward by writing to the shared jump impulse via a small hop.
      bouncePlayer()
      s.squash = 1
      play('move')
    }

    // ---- Scale: base, shrink/grow spells, squash on bounce. ----
    let scale = critter.baseScale
    if (effId === 'shrink') scale *= THREE.MathUtils.lerp(1, 0.4, pulse(eff!.t, eff!.spell.duration))
    if (effId === 'grow') scale *= THREE.MathUtils.lerp(1, 2.1, pulse(eff!.t, eff!.spell.duration))
    s.squash = Math.max(0, s.squash - dt * 3)

    // ---- Apply transforms. ----
    g.position.set(critter.pos.x, critter.pos.y, critter.pos.z)
    g.rotation.y = s.yaw
    if (s.spin > 0 && launched) {
      g.rotation.y += eff!.t * 14
      s.spin = Math.max(0, s.spin - dt)
    }
    const hop = frozen ? 0 : Math.abs(Math.sin(s.hopPhase)) * 0.18
    g.position.y += hop
    if (body.current) {
      const sq = 1 - s.squash * 0.4
      body.current.scale.set(scale * (1 + s.squash * 0.3), scale * sq, scale * (1 + s.squash * 0.3))
    }

    // ---- Spell visuals owned by the critter (bloom + freeze); other spells live in SpellFx. ----
    const blooming = effId === 'bloom'
    if (body.current) body.current.visible = !blooming
    if (flower.current) {
      flower.current.visible = blooming
      if (blooming) {
        const t = pulse(eff!.t, eff!.spell.duration)
        flower.current.scale.setScalar(scale * THREE.MathUtils.lerp(0.1, 1, t))
        flower.current.rotation.y += dt * 1.2
      }
    }
    if (ice.current) {
      ice.current.visible = frozen
      if (frozen) ice.current.scale.setScalar(scale * 1.25)
    }
  })

  return (
    <group ref={group} position={start.toArray()}>
      {/* Body: a round blob with belly, eyes, cheeks, ears and little feet. */}
      <group ref={body}>
        <mesh castShadow position={[0, 0.55, 0]}>
          <sphereGeometry args={[0.55, 24, 20]} />
          <meshStandardMaterial color={BODY} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.42, 0.42]}>
          <sphereGeometry args={[0.34, 20, 16]} />
          <meshStandardMaterial color={BELLY} roughness={0.8} />
        </mesh>
        {/* Eyes */}
        {[-0.2, 0.2].map((x) => (
          <mesh key={x} position={[x, 0.72, 0.44]}>
            <sphereGeometry args={[0.1, 14, 12]} />
            <meshStandardMaterial color="#20232e" roughness={0.3} />
          </mesh>
        ))}
        {/* Cheeks */}
        {[-0.34, 0.34].map((x) => (
          <mesh key={x} position={[x, 0.6, 0.4]}>
            <sphereGeometry args={[0.09, 12, 10]} />
            <meshStandardMaterial color={CHEEK} roughness={0.9} />
          </mesh>
        ))}
        {/* Ears */}
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, 1.02, 0]} rotation={[0, 0, x < 0 ? 0.3 : -0.3]}>
            <coneGeometry args={[0.16, 0.34, 10]} />
            <meshStandardMaterial color={BODY} roughness={0.7} />
          </mesh>
        ))}
        {/* Feet */}
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} castShadow position={[x, 0.08, 0.1]}>
            <sphereGeometry args={[0.15, 12, 10]} />
            <meshStandardMaterial color="#e0a93f" roughness={0.8} />
          </mesh>
        ))}
      </group>

      {/* Flower form (bloom spell). */}
      <group ref={flower} visible={false}>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.05, 0.07, 0.6, 8]} />
          <meshStandardMaterial color="#3f9b46" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.7, 0]}>
          <sphereGeometry args={[0.14, 16, 12]} />
          <meshStandardMaterial color="#ffd23f" roughness={0.6} />
        </mesh>
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2
          return (
            <mesh key={i} position={[Math.cos(a) * 0.24, 0.7, Math.sin(a) * 0.24]} rotation={[0, -a, 0]}>
              <coneGeometry args={[0.1, 0.3, 8]} />
              <meshStandardMaterial color={CHEEK} roughness={0.7} />
            </mesh>
          )
        })}
      </group>

      {/* Ice block (freeze spell). */}
      <mesh ref={ice} visible={false} position={[0, 0.6, 0]}>
        <boxGeometry args={[1.1, 1.3, 1.1]} />
        <meshPhysicalMaterial color="#bfe9ff" transmission={0.6} transparent opacity={0.55} roughness={0.1} metalness={0} />
      </mesh>
    </group>
  )
}

/** 0→1→0 envelope over a duration so spells ease in and out. */
function pulse(t: number, dur: number) {
  const x = THREE.MathUtils.clamp(t / dur, 0, 1)
  return Math.sin(x * Math.PI)
}

/** Nudge the player upward (bounce). Reuses the jump impulse convention in Characters. */
function bouncePlayer() {
  // Characters reads controls.jump; emulate a strong hop by setting a transient upward position
  // offset — Characters' own gravity then takes over on the next frame.
  player.pos.y += 0.1
  // A custom event the Player listens for to apply upward velocity.
  window.dispatchEvent(new CustomEvent('critter-bounce'))
}
