// Transient spell visuals that aren't owned by the creature itself: a dropped boulder, a car that
// zooms through, a projectile from the player, and a lightning strike. Each is time-boxed and removed.
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { heightAt } from './terrain'
import { critter, drainCast, type SpellId } from './spells'

interface ActiveFx {
  id: number
  spell: SpellId
  t: number
  dur: number
  from: THREE.Vector3
  at: THREE.Vector3
}

export function SpellFx() {
  const [fx, setFx] = useState<ActiveFx[]>([])
  const lastSeen = useRef(0)
  const idc = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    // Pick up a new cast.
    const cast = drainCast(lastSeen.current)
    if (cast) {
      lastSeen.current = cast.n
      if (['rockDrop', 'carRun', 'gunShot', 'lightning'].includes(cast.spell.id)) {
        idc.current += 1
        setFx((list) => [
          ...list,
          {
            id: idc.current,
            spell: cast.spell.id,
            t: 0,
            dur: cast.spell.duration,
            from: cast.from.clone(),
            at: critter.pos.clone(),
          },
        ])
      }
    }
    // Advance / expire.
    setFx((list) => {
      if (!list.length) return list
      const next = list.map((f) => ({ ...f, t: f.t + dt })).filter((f) => f.t < f.dur)
      return next.length === list.length && next.every((f, i) => f.t === list[i].t) ? list : next
    })
  })

  return (
    <>
      {fx.map((f) =>
        f.spell === 'rockDrop' ? (
          <RockDrop key={f.id} fx={f} />
        ) : f.spell === 'carRun' ? (
          <CarRun key={f.id} fx={f} />
        ) : f.spell === 'gunShot' ? (
          <GunShot key={f.id} fx={f} />
        ) : (
          <Lightning key={f.id} fx={f} />
        ),
      )}
    </>
  )
}

/** A boulder falls from the sky onto the critter and thumps. */
function RockDrop({ fx }: { fx: ActiveFx }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!ref.current) return
    const t = fx.t / fx.dur
    const dropY = THREE.MathUtils.lerp(18, 0.6, Math.min(1, t * 1.6))
    ref.current.position.set(critter.pos.x, critter.pos.y + dropY, critter.pos.z)
    ref.current.rotation.x += 0.1
    ref.current.rotation.z += 0.07
    const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
    ;(ref.current.material as THREE.MeshStandardMaterial).opacity = fade
  })
  return (
    <mesh ref={ref}>
      <dodecahedronGeometry args={[0.8, 0]} />
      <meshStandardMaterial color="#7c7368" roughness={1} flatShading transparent />
    </mesh>
  )
}

/** A little car zooms along a straight line through the critter and off into the distance. */
function CarRun({ fx }: { fx: ActiveFx }) {
  const ref = useRef<THREE.Group>(null)
  const dir = useRef(new THREE.Vector3(1, 0, 0.2).normalize())
  useFrame(() => {
    if (!ref.current) return
    const t = fx.t / fx.dur
    const span = 26
    const d = (t - 0.5) * span
    const x = fx.at.x + dir.current.x * d
    const z = fx.at.z + dir.current.z * d
    ref.current.position.set(x, heightAt(x, z) + 0.4, z)
    ref.current.rotation.y = Math.atan2(dir.current.x, dir.current.z)
  })
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[1.8, 0.5, 0.9]} />
        <meshStandardMaterial color="#e23b3b" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[-0.1, 0.4, 0]}>
        <boxGeometry args={[0.9, 0.4, 0.8]} />
        <meshStandardMaterial color="#9fd7ff" roughness={0.2} metalness={0.1} />
      </mesh>
    </group>
  )
}

/** A fast projectile from the player to the critter, with a muzzle flash and a little knockback. */
function GunShot({ fx }: { fx: ActiveFx }) {
  const bolt = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!bolt.current) return
    const t = Math.min(1, (fx.t / fx.dur) * 2.2)
    const p = new THREE.Vector3().lerpVectors(
      new THREE.Vector3(fx.from.x, fx.from.y + 1.1, fx.from.z),
      new THREE.Vector3(critter.pos.x, critter.pos.y + 0.6, critter.pos.z),
      t,
    )
    bolt.current.position.copy(p)
    bolt.current.visible = t < 1
  })
  return (
    <mesh ref={bolt}>
      <sphereGeometry args={[0.14, 10, 10]} />
      <meshBasicMaterial color="#ffd23f" toneMapped={false} />
    </mesh>
  )
}

/** A bright bolt from the sky to the critter, with a flash. */
function Lightning({ fx }: { fx: ActiveFx }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!ref.current) return
    const t = fx.t / fx.dur
    // Flicker the bolt for the first part, then fade.
    const on = t < 0.5 && Math.sin(fx.t * 60) > -0.3
    ref.current.visible = on
    ref.current.position.set(critter.pos.x, critter.pos.y + 7, critter.pos.z)
  })
  return (
    <mesh ref={ref}>
      <cylinderGeometry args={[0.08, 0.22, 14, 6]} />
      <meshBasicMaterial color="#ade8ff" toneMapped={false} />
    </mesh>
  )
}
