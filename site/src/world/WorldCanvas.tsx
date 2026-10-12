// The open world behind the site: browsing shows a cinematic fly-over, ⌘K drops you in as the explorer.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, PerformanceMonitor, Preload } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { buildTerrain } from './terrain'
import { Landmarks, Scatters } from './Models'
import { Vegetation } from './Vegetation'
import { Lighting, SkyClouds, SkyDome, Water } from './Environment'
import { Ambient } from './Ambient'
import { Guide, Player, player, spawnPlayer } from './Characters'
import { animals } from './wildlife'
import { colliderList } from './colliders'
import { castSpell, spellById, type SpellId } from './spells'
import { Animals } from './Animals'
import { SpellFx } from './SpellFx'
import { Enemies } from './Enemies'
import { endFight, enemies, fight, results } from './combat'
import { PlayerFx } from './PlayerFx'
import { CameraRig } from './CameraRig'
import { world, useWorld } from './store'
import { isLowGraphics } from '../lib/graphics'

export type SceneMode = 'boot' | 'home' | 'page'

/** A rough GPU check: weak integrated graphics (common on Windows laptops) should start on the light path. */
function weakGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const r = (info && gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) as string | undefined
    if (!r) return false
    // Intel HD/UHD integrated, software renderers, and Microsoft's fallback are the usual culprits.
    return /(Intel.*(HD|UHD) Graphics|Microsoft Basic Render|SwiftShader|llvmpipe|Software)/i.test(r)
  } catch {
    return false
  }
}

function quality() {
  // The user's explicit "low graphics" choice always wins — a guaranteed fallback for weak GPUs.
  if (isLowGraphics()) return 'low'
  const small = window.innerWidth < 820 || matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  const deviceMem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8
  return small || cores <= 4 || deviceMem <= 4 || weakGpu() ? 'low' : 'high'
}

function Terrain({ segments }: { segments: number }) {
  const geo = useMemo(() => buildTerrain(560, segments), [segments])
  return (
    <mesh geometry={geo} receiveShadow castShadow={false}>
      <meshStandardMaterial vertexColors flatShading roughness={0.93} metalness={0} />
    </mesh>
  )
}

function Ready({ onReady }: { onReady?: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    // Wait a couple of frames so the first visible frame is fully composed.
    if (++frames.current === 3) {
      onReady?.()
      world.set({ assetsReady: true })
    }
  })
  return null
}

export default function WorldCanvas({ mode, paused = false, onReady }: { mode: SceneMode; paused?: boolean; onReady?: () => void }) {
  // A lost WebGL context (the GPU gave up, usually under load) used to leave a black screen for good. Now the
  // canvas is rebuilt from scratch on the light path, which is what the GPU can clearly handle.
  const [lost, setLost] = useState(0)
  const tier = useMemo(() => (lost ? 'low' : quality()), [lost])
  const high = tier === 'high'
  const playing = useWorld((s) => s.playing)
  // Dropped by the performance monitor when frames run long; never raised again in a session.
  const [degraded, setDegraded] = useState(false)
  // Behind sub-pages the world is ~90% dimmed: let the camera settle, then stop rendering it altogether.
  const [frozen, setFrozen] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.quality = tier
  }, [tier])

  useEffect(() => {
    if (playing) spawnPlayer()
    // Leaving explore mode abandons any mission fight in progress.
    else if (fight) endFight()
  }, [playing])

  useEffect(() => {
    setFrozen(false)
    if (mode !== 'page' || playing) return
    let id = window.setTimeout(() => setFrozen(true), 1800)
    // Resizing clears a WebGL canvas: render a moment at the new size, then freeze again.
    const onResize = () => {
      setFrozen(false)
      window.clearTimeout(id)
      id = window.setTimeout(() => setFrozen(true), 500)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('resize', onResize)
    }
  }, [mode, playing])

  // The costly passes (ambient occlusion, multisampling) only while exploring on a capable, unstrained GPU;
  // the fly-over behind the home screen stays light.
  const rich = high && playing && !degraded
  // Once the GPU is struggling, also shed the heaviest always-on costs (shadow maps, dense terrain and
  // clouds) — not just the explore-only effects. This is what rescues weak laptop GPUs that start "high".
  const heavy = high && !degraded

  return (
    <Canvas
      key={lost}
      className="world-canvas"
      shadows={heavy ? { type: THREE.PCFShadowMap } : false}
      dpr={heavy ? [1, 1.25] : [1, 1]}
      frameloop={paused || frozen ? 'never' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 48, near: 0.3, far: 4000, position: [0, 180, 320] }}
      aria-hidden="true"
      onCreated={(state) => {
        // Test hook: `?snap` exposes the scene for automated checks.
        if (new URLSearchParams(window.location.search).has('snap')) {
          const w = window as unknown as { __r3f: unknown; __world: unknown }
          w.__r3f = state
          w.__world = { player, animals, colliders: colliderList, cast: (id: SpellId) => castSpell(spellById(id), player.pos, player.yaw), enemies, fight: () => fight, results }
        }
        // Recover from a lost WebGL context instead of leaving a permanent black canvas.
        const canvas = state.gl.domElement
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          // Give the driver a moment, then rebuild the whole canvas on the light path.
          window.setTimeout(() => setLost((n) => n + 1), 400)
        })
      }}
    >
      <color attach="background" args={['#9fc0de']} />
      <fog attach="fog" args={['#a9c6e0', 220, 1300]} />
      <SkyDome />
      <Lighting shadows={heavy} live={playing} />
      <Terrain segments={heavy ? 240 : 170} />
      <Water />
      <Suspense fallback={null}>
        <SkyClouds count={heavy ? 8 : 6} />
      </Suspense>
      <Suspense fallback={null}>
        <Landmarks />
        <Scatters />
        <Vegetation grass={playing} />
        <Ambient />
        <Guide />
        {playing && <Player />}
        <Animals casting={playing} />
        {playing && <SpellFx />}
        {playing && <Enemies />}
        {playing && <PlayerFx />}
        <Preload all />
      </Suspense>
      <CameraRig playing={playing} mode={mode} />
      <Ready onReady={onReady} />
      <AdaptiveDpr pixelated={false} />
      {/* Below ~45 fps for a few seconds: drop to the light path (no AO or MSAA, 1x pixel ratio). */}
      <PerformanceMonitor bounds={() => [45, 120]} flipflops={1} ms={200} iterations={6} onDecline={() => setDegraded(true)} />
      {/* Post-processing only on a capable, unstrained GPU. A mis-sized composer buffer is a common
          cause of a partly-black frame on some drivers, so the light path renders the scene plainly.
          No ambient-occlusion pass: it cost more than everything else put together on laptop GPUs. */}
      {heavy && (
        <EffectComposer multisampling={rich ? 2 : 0} enableNormalPass={false}>
          <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0.7} />
          <Vignette offset={0.3} darkness={0.45} />
        </EffectComposer>
      )}
    </Canvas>
  )
}
