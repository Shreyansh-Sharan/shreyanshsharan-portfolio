// The open world behind the site: browsing shows a cinematic fly-over, ⌘K drops you in as the explorer.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, PerformanceMonitor, Preload } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { buildTerrain } from './terrain'
import { Landmarks, Scatters } from './Models'
import { Lighting, SkyClouds, SkyDome, Water } from './Environment'
import { Ambient } from './Ambient'
import { Guide, Player, spawnPlayer } from './Characters'
import { Critter } from './Critter'
import { SpellFx } from './SpellFx'
import { CameraRig } from './CameraRig'
import { world, useWorld } from './store'

export type SceneMode = 'boot' | 'home' | 'page'

function quality() {
  const small = window.innerWidth < 820 || matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  return small || cores <= 4 ? 'low' : 'high'
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
  const tier = useMemo(quality, [])
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

  return (
    <Canvas
      className="world-canvas"
      shadows={high ? { type: THREE.PCFSoftShadowMap } : false}
      dpr={high && !degraded ? [1, 1.5] : [1, 1]}
      frameloop={paused || frozen ? 'never' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 48, near: 0.3, far: 4000, position: [0, 180, 320] }}
      aria-hidden="true"
      onCreated={(state) => {
        // Test hook: `?snap` exposes the scene for automated checks.
        if (new URLSearchParams(window.location.search).has('snap')) (window as unknown as { __r3f: unknown }).__r3f = state
        // Recover from a lost WebGL context instead of leaving a permanent black canvas.
        const canvas = state.gl.domElement
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
        })
        canvas.addEventListener('webglcontextrestored', () => {
          state.gl.setSize(state.size.width, state.size.height, false)
          state.invalidate()
        })
      }}
    >
      <color attach="background" args={['#9fc0de']} />
      <fog attach="fog" args={['#a9c6e0', 220, 1300]} />
      <SkyDome />
      <Lighting shadows={high} live={playing} />
      <Terrain segments={high ? 300 : 170} />
      <Water />
      <Suspense fallback={null}>
        <SkyClouds count={high ? 10 : 6} />
      </Suspense>
      <Suspense fallback={null}>
        <Landmarks />
        <Scatters />
        <Ambient />
        <Guide />
        {playing && <Player />}
        {playing && <Critter />}
        {playing && <SpellFx />}
        <Preload all />
      </Suspense>
      <CameraRig playing={playing} mode={mode} />
      <Ready onReady={onReady} />
      <AdaptiveDpr pixelated={false} />
      {/* Below ~45 fps for a few seconds: drop to the light path (no AO or MSAA, 1x pixel ratio). */}
      <PerformanceMonitor bounds={() => [45, 120]} flipflops={1} onDecline={() => setDegraded(true)} />
      <EffectComposer multisampling={rich ? 4 : 0} enableNormalPass={false}>
        {/* Full-res AO: the half-res buffer could tile parts of the frame black on some drivers. */}
        {rich ? <N8AO aoRadius={2.2} intensity={1.6} distanceFalloff={1.2} quality="medium" /> : <></>}
        <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0.7} />
        <Vignette offset={0.3} darkness={0.45} />
      </EffectComposer>
    </Canvas>
  )
}
