// The open world behind the site: browsing shows a cinematic fly-over, ⌘K drops you in as the explorer.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, Preload } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { buildTerrain } from './terrain'
import { Landmarks, Scatters } from './Models'
import { Lighting, SkyClouds, SkyDome, Water } from './Environment'
import { Ambient } from './Ambient'
import { Guide, Player, spawnPlayer } from './Characters'
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

  useEffect(() => {
    document.documentElement.dataset.quality = tier
  }, [tier])

  useEffect(() => {
    if (playing) spawnPlayer()
  }, [playing])

  return (
    <Canvas
      className="world-canvas"
      shadows={high ? { type: THREE.PCFSoftShadowMap } : false}
      dpr={high ? [1, 1.75] : [1, 1.25]}
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 48, near: 0.3, far: 4000, position: [0, 180, 320] }}
      aria-hidden="true"
      onCreated={(state) => {
        // Test hook: `?snap` exposes the scene for automated checks.
        if (new URLSearchParams(window.location.search).has('snap')) (window as unknown as { __r3f: unknown }).__r3f = state
      }}
    >
      <color attach="background" args={['#9fc0de']} />
      <fog attach="fog" args={['#a9c6e0', 220, 1300]} />
      <SkyDome />
      <Lighting shadows={high} />
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
        <Preload all />
      </Suspense>
      <CameraRig playing={playing} mode={mode} />
      <Ready onReady={onReady} />
      <AdaptiveDpr pixelated={false} />
      <EffectComposer multisampling={high ? 4 : 0} enableNormalPass={false}>
        {high ? <N8AO halfRes aoRadius={2.2} intensity={1.6} distanceFalloff={1.2} quality="medium" /> : <></>}
        <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0.7} />
        <Vignette offset={0.3} darkness={0.45} />
      </EffectComposer>
    </Canvas>
  )
}
