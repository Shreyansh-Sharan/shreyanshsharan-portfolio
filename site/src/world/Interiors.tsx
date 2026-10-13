// The rooms you can walk into (see interiors.ts) and the stadium's pitch. A room is only built while the player is
// in or next to it; its props stream in behind the 3D loader the first time, lit by their own lamps so the hall is
// never dark (the sun does not reach in: nothing inside casts or takes its shadows).
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { placed, useModel } from './Models'
import { Cabinet } from './Exhibits'
import { exhibits, stadiumGate, type Exhibit } from './exhibits'
import { tiles } from '../data/content'
import { registerRooms, roomAt, ROOMS, type Room, type RoomId } from './interiors'
import { PITCH_HALF, STADIUM_PITCH } from './districts'
import { regionById, type ModelName } from './regions'
import { heightAt } from './terrain'
import { player } from './Characters'
import { world } from './store'
import { showLoader, trackManager } from '../lib/loader3d'

const texCache = new Map<string, { tex: THREE.Texture; copies: THREE.Texture[]; ready: boolean }>()
/**
 * A room texture, returned at once and filled in when the image arrives: the room's walls and floor go up straight
 * away (plain until then) instead of waiting behind a suspense boundary. Tiled copies are refreshed on arrival too.
 */
function roomTexture(name: string, repeat?: [number, number]) {
  let e = texCache.get(name)
  if (!e) {
    const entry: { tex: THREE.Texture; copies: THREE.Texture[]; ready: boolean } = { tex: new THREE.Texture(), copies: [], ready: false }
    entry.tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}world/textures/${name}.webp`, () => {
      entry.ready = true
      for (const c of entry.copies) c.needsUpdate = true
    })
    entry.tex.colorSpace = THREE.SRGBColorSpace
    texCache.set(name, entry)
    e = entry
  }
  if (!repeat) return e.tex
  const t = e.tex.clone()
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  if (e.ready) t.needsUpdate = true
  else e.copies.push(t)
  return t
}

type PropProps = { model: ModelName; height: number; at: [number, number, number]; rot?: number; hangs?: boolean }

/** A piece of furniture; each streams in on its own, so the room fills in piece by piece. */
function Prop(props: PropProps) {
  return (
    <Suspense fallback={null}>
      <PropModel {...props} />
    </Suspense>
  )
}

/** Props inside rooms neither cast nor receive the sun's shadow (it cannot reach in). */
function PropModel({ model, height, at, rot = 0, hangs = false }: PropProps) {
  const obj = useModel(model, height)
  // Standing furniture is checked by the grounding test; a chandelier hangs on purpose.
  useEffect(() => {
    if (hangs) return
    const key = `room:${model}:${at.join(',')}`
    placed.set(key, { name: model, region: 'room', obj })
    return () => {
      placed.delete(key)
    }
  }, [obj, model, at, hangs])
  useEffect(() => {
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = false
        m.receiveShadow = false
      }
    })
  }, [obj])
  return (
    <group position={at} rotation={[0, (rot * Math.PI) / 180, 0]}>
      <primitive object={obj} />
    </group>
  )
}

/** A label painted on a canvas (the exit sign). */
function useLabel(text: string, color: string) {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 96
    const g = c.getContext('2d')!
    g.fillStyle = '#0b0f19'
    g.fillRect(0, 0, 256, 96)
    g.fillStyle = color
    g.font = '800 54px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 128, 50)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false })
  }, [text, color])
}

/** Floor, walls and ceiling of a room, facing in, and the glowing exit on the south wall. */
function Shell({ room, floor, wall, floorRepeat, wallRepeat, ceiling, exitColor }: { room: Room; floor: string; wall: string | null; floorRepeat: number; wallRepeat: number; ceiling: string; exitColor: string }) {
  const { w, d, h } = room
  const mats = useMemo(() => {
    const f = roomTexture(floor, [w / floorRepeat, d / floorRepeat])
    const wallMat = (len: number) => {
      if (!wall) return new THREE.MeshStandardMaterial({ color: '#1b1430', roughness: 0.9 })
      const t = roomTexture(wall, [len / wallRepeat, h / wallRepeat])
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 })
    }
    return {
      floor: new THREE.MeshStandardMaterial({ map: f, roughness: 0.85 }),
      long: wallMat(d),
      wide: wallMat(w),
      ceiling: new THREE.MeshStandardMaterial({ color: ceiling, roughness: 0.95 }),
      exit: new THREE.MeshStandardMaterial({ color: exitColor, emissive: exitColor, emissiveIntensity: 2.2 }),
      door: new THREE.MeshBasicMaterial({ color: '#fff7e0' }),
    }
  }, [floor, wall, w, d, h, floorRepeat, wallRepeat, ceiling, exitColor])
  const label = useLabel('EXIT · E', exitColor)
  const [ex, ez] = room.exit
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={mats.floor}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh position={[0, h, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.ceiling}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh position={[0, h / 2, -d / 2]} material={mats.wide}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh position={[0, h / 2, d / 2]} rotation={[0, Math.PI, 0]} material={mats.wide}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh position={[-w / 2, h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={mats.long}>
        <planeGeometry args={[d, h]} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={mats.long}>
        <planeGeometry args={[d, h]} />
      </mesh>
      {/* The way out: a lit doorway in the south wall. */}
      <group position={[ex, 0, d / 2 - 0.05]} rotation={[0, Math.PI, 0]}>
        <mesh position={[0, 1.6, 0]} material={mats.door}>
          <planeGeometry args={[2.4, 3.2]} />
        </mesh>
        {[-1.35, 1.35].map((x) => (
          <mesh key={x} position={[x, 1.7, 0.05]} material={mats.exit}>
            <boxGeometry args={[0.25, 3.4, 0.2]} />
          </mesh>
        ))}
        <mesh position={[0, 3.4, 0.05]} material={mats.exit}>
          <boxGeometry args={[2.95, 0.25, 0.2]} />
        </mesh>
        <mesh position={[0, 4.1, 0.1]} material={label}>
          <planeGeometry args={[1.8, 0.68]} />
        </mesh>
      </group>
      <pointLight position={[ex, 3, ez - 2]} color={exitColor} intensity={6} distance={9} />
    </group>
  )
}

/* ---------- The castle arcade ---------- */

/** The game's key art, lit like a backlit poster, above its cabinet. */
function Poster({ e, at, rot }: { e: Exhibit; at: [number, number, number]; rot: number }) {
  const cover = tiles.find((t) => t.id === e.tile)?.cover
  const mats = useMemo(() => {
    const frame = new THREE.MeshStandardMaterial({ color: e.accent, emissive: e.accent, emissiveIntensity: 1.6, toneMapped: false })
    if (!cover) return { frame, art: null }
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}${cover}`)
    t.colorSpace = THREE.SRGBColorSpace
    return { frame, art: new THREE.MeshBasicMaterial({ map: t, toneMapped: false }) }
  }, [cover, e.accent])
  if (!mats.art) return null
  return (
    <group position={at} rotation={[0, rot, 0]}>
      <mesh position={[0, 0, -0.02]} material={mats.frame}>
        <planeGeometry args={[3.5, 2.05]} />
      </mesh>
      <mesh material={mats.art}>
        <planeGeometry args={[3.2, 1.8]} />
      </mesh>
    </group>
  )
}

/** The marquee over the prize counter. */
function Marquee({ at }: { at: [number, number, number] }) {
  const mat = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const g = c.getContext('2d')!
    g.fillStyle = '#12082a'
    g.fillRect(0, 0, 512, 128)
    g.strokeStyle = '#ff3fb4'
    g.lineWidth = 8
    g.strokeRect(6, 6, 500, 116)
    g.fillStyle = '#ffd23f'
    g.font = '900 70px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('PRIZES', 256, 68)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false })
  }, [])
  return (
    <mesh position={at} material={mat}>
      <planeGeometry args={[5, 1.25]} />
    </mesh>
  )
}

const NEON = ['#ff3fb4', '#22e3ff', '#ffd23f', '#7cff6b']

function ArcadeHall({ room }: { room: Room }) {
  const { w, d, h } = room
  const strips = useMemo(() => NEON.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.4, toneMapped: false })), [])
  const cabinets = useMemo(() => exhibits().filter((e) => e.kind === 'cabinet'), [])
  return (
    <group>
      <Shell room={room} floor="carpet" wall={null} floorRepeat={6} wallRepeat={1} ceiling="#120d24" exitColor="#22e3ff" />
      {/* Neon tubes along the walls at two heights, and across the ceiling. */}
      {[1.2, h - 1.2].map((y, row) =>
        [
          [0, -d / 2 + 0.08, w, 0],
          [0, d / 2 - 0.08, w, Math.PI],
          [-w / 2 + 0.08, 0, d, Math.PI / 2],
          [w / 2 - 0.08, 0, d, -Math.PI / 2],
        ].map(([x, z, len, rot], i) => (
          <mesh key={`${row}-${i}`} position={[x, y, z]} rotation={[0, rot, 0]} material={strips[(i + row) % strips.length]}>
            <boxGeometry args={[len - 0.4, 0.12, 0.08]} />
          </mesh>
        )),
      )}
      {[-8, 0, 8].map((z, i) => (
        <mesh key={z} position={[0, h - 0.1, z]} material={strips[i % strips.length]}>
          <boxGeometry args={[w - 4, 0.08, 0.3]} />
        </mesh>
      ))}
      <Prop model="prize-counter" height={4} at={[0, 0, -d / 2 + 1.6]} />
      {cabinets.map((e) => {
        // Above each cabinet on its wall, facing into the hall.
        const west = e.x < room.x
        return <Poster key={`p${e.id}`} e={e} at={[west ? -w / 2 + 0.08 : w / 2 - 0.08, 4.4, e.z - room.z]} rot={west ? Math.PI / 2 : -Math.PI / 2} />
      })}
      <Marquee at={[0, 6.4, -d / 2 + 0.08]} />
      {cabinets.map((e) => (
        <group key={e.id} position={[-room.x, -room.y, -room.z]}>
          <Cabinet e={e} />
        </group>
      ))}
      <hemisphereLight args={['#b9a8ff', '#2a1840', 0.9]} />
      <pointLight position={[-9, h - 1.5, -4]} color="#ff3fb4" intensity={30} distance={22} />
      <pointLight position={[9, h - 1.5, -4]} color="#22e3ff" intensity={30} distance={22} />
      <pointLight position={[0, h - 1.5, 6]} color="#fff1d6" intensity={26} distance={24} />
      <pointLight position={[0, 3, -d / 2 + 4]} color="#ffd23f" intensity={14} distance={12} />
    </group>
  )
}

/* ---------- The keep's great hall ---------- */

function Hanging({ map, w, h, at, rot, emissive = 0 }: { map: THREE.Texture; w: number; h: number; at: [number, number, number]; rot: number; emissive?: number }) {
  const mat = useMemo(() => {
    return new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, emissive: emissive ? '#ffffff' : '#000000', emissiveMap: emissive ? map : null, emissiveIntensity: emissive, roughness: 0.8 })
  }, [map, emissive])
  return (
    <mesh position={at} rotation={[0, rot, 0]} material={mat}>
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}

function GreatHall({ room }: { room: Room }) {
  const [tapestry, glass] = useMemo(() => [roomTexture('tapestry'), roomTexture('stained-glass')], [])
  const { w, d, h } = room
  const beam = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.9 }), [])
  const flicker = useRef<THREE.PointLight>(null)
  useFrame(({ clock }) => {
    if (flicker.current) flicker.current.intensity = 26 + Math.sin(clock.elapsedTime * 9) * 3 + Math.sin(clock.elapsedTime * 23) * 2
  })
  return (
    <group>
      <Shell room={room} floor="flagstone" wall="ashlar" floorRepeat={4} wallRepeat={4} ceiling="#2b1d14" exitColor="#ffb347" />
      {/* Timber roof beams. */}
      {[-15, -9, -3, 3, 9, 15].map((z) => (
        <mesh key={z} position={[0, h - 0.5, z]} material={beam}>
          <boxGeometry args={[w, 0.6, 0.6]} />
        </mesh>
      ))}
      <Prop model="throne" height={4} at={[0, 0, -d / 2 + 3]} />
      {[-5.8, -1.4, 3].map((z) => (
        <Prop key={`t${z}`} model="banquet-table" height={1.7} at={[0, 0, z]} />
      ))}
      {[-9, -1, 7].map((z) => (
        <Prop key={z} model="chandelier" height={2.6} at={[0, h - 3.6, z]} hangs />
      ))}
      <Prop model="fireplace" height={5} at={[w / 2 - 1.2, 0, 0]} rot={-90} />
      {[-12, 8].map((z) => (
        <Prop key={`a${z}`} model="armour-stand" height={2.5} at={[-w / 2 + 1.4, 0, z]} rot={90} />
      ))}
      {[-12, 10].map((z) => (
        <Prop key={`b${z}`} model="armour-stand" height={2.5} at={[w / 2 - 1.4, 0, z]} rot={-90} />
      ))}
      {[-6, 6].map((x) => (
        <Prop key={`r${x}`} model="weapon-rack" height={2.6} at={[x, 0, -d / 2 + 1.2]} />
      ))}
      {/* Stained glass down the west wall and above the throne; tapestries either side of the hearth. */}
      {[-12, -2, 8].map((z) => (
        <Hanging key={`g${z}`} map={glass} w={2.6} h={7.4} at={[-w / 2 + 0.06, 6.2, z]} rot={Math.PI / 2} emissive={1.2} />
      ))}
      <Hanging map={glass} w={3} h={8.6} at={[0, 8.6, -d / 2 + 0.06]} rot={0} emissive={1.2} />
      {[-7, 7].map((z) => (
        <Hanging key={`t${z}`} map={tapestry} w={3.2} h={4.8} at={[w / 2 - 0.08, 5.8, z]} rot={-Math.PI / 2} />
      ))}
      {[-8, 8].map((x) => (
        <Hanging key={`n${x}`} map={tapestry} w={2.6} h={3.9} at={[x, 6.5, -d / 2 + 0.08]} rot={0} />
      ))}
      <hemisphereLight args={['#ffe6c4', '#3a2a1c', 0.85]} />
      <pointLight ref={flicker} position={[w / 2 - 3, 2.2, 0]} color="#ff9a3c" intensity={26} distance={20} />
      {[-9, -1, 7].map((z) => (
        <pointLight key={z} position={[0, h - 4.2, z]} color="#ffd9a0" intensity={22} distance={18} />
      ))}
      <pointLight position={[-w / 2 + 2, 6, -2]} color="#9ab8ff" intensity={10} distance={16} />
    </group>
  )
}

/* ---------- Mounting: build a room only while the player is near it ---------- */

const loaded = new Set<RoomId>()

function RoomMount({ room }: { room: Room }) {
  const [near, setNear] = useState(false)
  const frame = useRef(0)
  useFrame(() => {
    if (frame.current++ % 10 !== 0) return
    const d = Math.hypot(player.pos.x - room.x, player.pos.y - room.y, player.pos.z - room.z)
    if (!near && d < 60) setNear(true)
    else if (near && d > 90) setNear(false)
    // Keep the store's idea of where you are honest (teleports, the minimap), without waiting for a door.
    const inside = roomAt(player.pos.x, player.pos.y, player.pos.z)?.id ?? null
    if (inside === room.id && world.get().room !== room.id) world.set({ room: room.id })
    if (inside === null && world.get().room === room.id) world.set({ room: null })
  })
  // The first visit downloads the furniture: the explorer gets the loader while it does.
  useEffect(() => {
    if (!near || loaded.has(room.id)) return
    loaded.add(room.id)
    if (!world.get().playing) return
    const h = showLoader({ status: `Entering ${room.name}…`, progress: null })
    const ctrl = new AbortController()
    const id = window.setTimeout(() => {
      trackManager(h, ctrl.signal, 12000).then(() => {
        h.update({ progress: 1 })
        h.release()
      })
    }, 100)
    return () => {
      window.clearTimeout(id)
      ctrl.abort()
      h.release()
    }
  }, [near, room])
  if (!near) return null
  return (
    <group position={[room.x, room.y, room.z]}>
      <Suspense fallback={null}>{room.id === 'arcade' ? <ArcadeHall room={room} /> : <GreatHall room={room} />}</Suspense>
    </group>
  )
}

export function Interiors() {
  useEffect(() => registerRooms(), [])
  return (
    <>
      {Object.values(ROOMS).map((r) => (
        <RoomMount key={r.id} room={r} />
      ))}
      <Pitch />
    </>
  )
}

/* ---------- The stadium's pitch ---------- */

/** Mown stripes, the white lines and the kick-off spot that opens the Sports Complex (E). */
function Pitch() {
  const region = regionById('speedway')
  const cx = region.center[0] + STADIUM_PITCH[0], cz = region.center[1] + STADIUM_PITCH[1]
  const [hx, hz] = PITCH_HALF
  const y = heightAt(cx, cz) + 0.06
  const mat = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 448
    const g = c.getContext('2d')!
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#3f8f3a' : '#4aa043'
      g.fillRect(0, i * 32, 256, 32)
    }
    g.strokeStyle = 'rgba(255,255,255,0.92)'
    g.lineWidth = 3
    g.strokeRect(6, 6, 244, 436)
    g.beginPath()
    g.moveTo(6, 224)
    g.lineTo(250, 224)
    g.stroke()
    g.beginPath()
    g.arc(128, 224, 40, 0, Math.PI * 2)
    g.stroke()
    g.strokeRect(60, 6, 136, 64)
    g.strokeRect(60, 378, 136, 64)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 })
  }, [])
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.7, depthWrite: false }), [])
  const spin = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (spin.current) spin.current.rotation.z = clock.elapsedTime * 0.8
  })
  const gate = stadiumGate()
  return (
    <group>
      <mesh position={[cx, y, cz]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow>
        <planeGeometry args={[hx * 2 + 4, hz * 2 + 4]} />
      </mesh>
      <mesh ref={spin} position={[gate.x, y + 0.04, gate.z]} rotation={[-Math.PI / 2, 0, 0]} material={ring}>
        <ringGeometry args={[gate.r - 0.6, gate.r, 48, 1, 0, Math.PI * 1.7]} />
      </mesh>
    </group>
  )
}
