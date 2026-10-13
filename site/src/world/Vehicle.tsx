// The drivable car parked on the harbour quay and the airship that ferries you between districts.
import { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useModel } from './Models'
import { car, DECK, MOOR_HEIGHT, ship, stepCar, stepShip, stopAt } from './rides'
import { AIRSHIP_STOPS } from './regions'
import { heightAt } from './terrain'
import { emit, SHAPE } from './particles'

const dust = new THREE.Color('#c9b99c')

function CarModel() {
  const obj = useModel('car', 1.35)
  // The racer's cars face +x; the world's forward is +z (sin/cos of the yaw).
  useMemo(() => {
    obj.rotation.y = -Math.PI / 2
  }, [obj])
  const ref = useRef<THREE.Group>(null)
  const tilt = useRef<THREE.Group>(null)
  const trail = useRef(0)
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    stepCar(dt)
    const g = ref.current
    if (!g) return
    g.position.copy(car.pos)
    g.rotation.y = car.yaw
    if (tilt.current) tilt.current.rotation.set(car.pitch, 0, -car.roll)
    if (car.driving && Math.abs(car.speed) > 4) {
      trail.current += dt
      if (trail.current > 0.08) {
        trail.current = 0
        const bx = car.pos.x - Math.sin(car.yaw) * 1.6, bz = car.pos.z - Math.cos(car.yaw) * 1.6
        emit({ count: car.drift > 0.5 ? 3 : 1, x: bx, y: car.pos.y + 0.15, z: bz, spread: 0.4, speed: [0.3, 0.8 + car.drift * 1.5], up: 0.3, color: dust, size: [0.35, 0.6 + car.drift * 0.5], life: [0.4, 0.8], shape: SHAPE.smoke, grow: true, drag: 3 })
      }
    }
  })
  return (
    <group ref={ref}>
      <group ref={tilt}>
        <primitive object={obj} />
        <pointLight position={[0, 0.7, 2.2]} color="#fff4d6" intensity={car.driving ? 8 : 0} distance={14} />
      </group>
    </group>
  )
}

function AirshipModel() {
  const obj = useModel('airship', 15)
  // The hull runs along z in the file; nose forward.
  useMemo(() => {
    obj.rotation.y = Math.PI
  }, [obj])
  const ref = useRef<THREE.Group>(null)
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    stepShip(dt)
    const g = ref.current
    if (!g) return
    g.position.copy(ship.pos)
    g.rotation.y = ship.yaw
    g.rotation.z = Math.sin(ship.bob * 0.5) * 0.015
  })
  return (
    <group ref={ref}>
      <primitive object={obj} />
      {/* The deck you stand on while sailing: a plank over the gondola. */}
      <mesh position={[0, DECK - 0.1, 0]} receiveShadow>
        <boxGeometry args={[4, 0.2, 10]} />
        <meshStandardMaterial color="#5b4636" roughness={0.9} />
      </mesh>
      <pointLight position={[0, DECK + 1, 0]} color="#ffd9a0" intensity={6} distance={12} />
    </group>
  )
}

/** Rope ladder from the moored ship down to the quay, and the mooring posts in every district. */
function Moorings() {
  const posts = useMemo(() => AIRSHIP_STOPS.map((_, i) => stopAt(i)), [])
  const ladder = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const l = ladder.current
    if (!l) return
    l.visible = !ship.flying
    const m = stopAt(ship.stop)
    const h = MOOR_HEIGHT - 1
    l.position.set(m.x, m.y - h / 2 - 0.5, m.z)
    l.scale.y = h
  })
  return (
    <group>
      {posts.map((p, i) => (
        <group key={i} position={[p.x, heightAt(p.x, p.z), p.z]}>
          <mesh position={[0, 2, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.22, 4, 10]} />
            <meshStandardMaterial color="#6b4f3a" roughness={0.85} />
          </mesh>
          <mesh position={[0, 4.2, 0]}>
            <sphereGeometry args={[0.35, 12, 10]} />
            <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
            <ringGeometry args={[2.2, 2.6, 32]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <mesh ref={ladder}>
        <cylinderGeometry args={[0.05, 0.05, 1, 6]} />
        <meshStandardMaterial color="#d9c7a3" />
      </mesh>
    </group>
  )
}

export function Vehicles() {
  return (
    <>
      <Suspense fallback={null}>
        <CarModel />
      </Suspense>
      <Suspense fallback={null}>
        <AirshipModel />
      </Suspense>
      <Moorings />
    </>
  )
}
