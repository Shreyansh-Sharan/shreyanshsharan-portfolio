// The open world behind the site: browsing shows a cinematic fly-over, ⌘K drops you in as the explorer.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { AdaptiveDpr, PerformanceMonitor, Preload } from '@react-three/drei'
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { buildTerrain } from './terrain'
import { Landmarks, Scatters } from './Models'
import { Vegetation } from './Vegetation'
import { Lighting, SkyClouds, SkyDome, Water } from './Environment'
import { Ambient } from './Ambient'
import { Guide, Player, flyPose, player, spawnPlayer } from './Characters'
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

/**
 * Watches the finished picture while exploring. A canvas that shows nothing but black for a couple of seconds
 * (a failed post-processing pass on some drivers, a dead context, the camera inside a wall) is handed up so the
 * world can fall back to a simpler render path instead of staying dark. The read-back goes through a pixel
 * buffer and a fence, so the CPU never waits for the GPU (a plain readPixels stalls the whole frame).
 */
function BlackFrameGuard({ active, renders, onBlack }: { active: boolean; renders: boolean; onBlack: () => void }) {
  const { gl } = useThree()
  const s = useRef({ frames: 0, dark: 0, px: new Uint8Array(3 * 16 * 4), buf: null as WebGLBuffer | null, sync: null as WebGLSync | null })
  useEffect(() => {
    const st = s.current
    return () => {
      const ctx = gl.getContext() as WebGL2RenderingContext
      if (st.buf) ctx.deleteBuffer(st.buf)
      if (st.sync) ctx.deleteSync(st.sync)
      st.buf = st.sync = null
    }
  }, [gl])
  useFrame(({ scene, camera }) => {
    // Any prioritised frame callback takes rendering over from the fibre loop: do it here on the plain path.
    if (renders) gl.render(scene, camera)
    const st = s.current
    if (!active) {
      st.dark = 0
      return
    }
    const ctx = gl.getContext() as WebGL2RenderingContext
    if (typeof ctx.fenceSync !== 'function') return
    if (st.sync) {
      // Collect the previous read once the GPU has got there. Asking is a round trip to the GPU process, so ask
      // only every few frames; by then the fence has long been passed.
      if (++st.frames % 10 !== 0) return
      const status = ctx.clientWaitSync(st.sync, 0, 0)
      if (status === ctx.TIMEOUT_EXPIRED) return
      ctx.deleteSync(st.sync)
      st.sync = null
      if (status === ctx.WAIT_FAILED) return
      ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, st.buf)
      ctx.getBufferSubData(ctx.PIXEL_PACK_BUFFER, 0, st.px)
      ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
      let lit = false
      for (let i = 0; i < st.px.length; i += 4) {
        if (st.px[i] + st.px[i + 1] + st.px[i + 2] > 24) {
          lit = true
          break
        }
      }
      if (lit) st.dark = 0
      else if (++st.dark >= 4) {
        st.dark = 0
        onBlack()
      }
      return
    }
    // Twice a second: queue a read of three 4x4 patches of the finished frame into the pixel buffer.
    if (++st.frames % 30 !== 0) return
    if (!st.buf) {
      st.buf = ctx.createBuffer()
      ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, st.buf)
      ctx.bufferData(ctx.PIXEL_PACK_BUFFER, st.px.byteLength, ctx.STREAM_READ)
      ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
    }
    const w = gl.domElement.width, h = gl.domElement.height
    ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, st.buf)
    const spots = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.7]]
    spots.forEach(([fx, fy], i) => ctx.readPixels(Math.floor(w * fx), Math.floor(h * fy), 4, 4, ctx.RGBA, ctx.UNSIGNED_BYTE, i * 64))
    ctx.bindBuffer(ctx.PIXEL_PACK_BUFFER, null)
    st.sync = ctx.fenceSync(ctx.SYNC_GPU_COMMANDS_COMPLETE, 0)
  }, renders ? 1 : 2)
  return null
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
  // The HUD's graphics switch re-tiers the world in place (no reload).
  const [gfx, setGfx] = useState(0)
  useEffect(() => {
    const on = () => setGfx((n) => n + 1)
    window.addEventListener('ss-gfx', on)
    return () => window.removeEventListener('ss-gfx', on)
  }, [])
  const tier = useMemo(() => (lost ? 'low' : quality()), [lost, gfx])
  // Black-frame fallbacks taken this session: first shed the effects, then rebuild on the light path.
  const [trips, setTrips] = useState(0)
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

  // The costly passes only while exploring on a capable, unstrained GPU; the fly-over behind the home screen
  // stays light.
  // Once the GPU is struggling, also shed the heaviest always-on costs (shadow maps, dense terrain and
  // clouds) — not just the explore-only effects. This is what rescues weak laptop GPUs that start "high".
  const heavy = high && !degraded
  const onBlack = () => {
    setTrips((n) => n + 1)
    if (trips === 0 && heavy) setDegraded(true)
    else setLost((n) => n + 1)
    window.dispatchEvent(new Event('ss-gfx-auto'))
  }

  return (
    <Canvas
      key={`${lost}-${tier}`}
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
          w.__world = { player, flyPose, animals, colliders: colliderList, cast: (id: SpellId) => castSpell(spellById(id), player.pos, player.yaw), enemies, fight: () => fight, results }
        }
        // Recover from a lost WebGL context instead of leaving a permanent black canvas.
        const canvas = state.gl.domElement
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          // Unmounting a canvas (a tier switch) forces a context loss on the old one: that is not the GPU giving up.
          if (!canvas.isConnected) return
          // Give the driver a moment, then rebuild the whole canvas on the light path.
          window.setTimeout(() => {
            if (canvas.isConnected) setLost((n) => n + 1)
          }, 400)
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
      <BlackFrameGuard key={String(heavy)} active={playing && trips < 2} renders={!heavy} onBlack={onBlack} />
      {/* Below ~45 fps for a few seconds: drop to the light path (no AO or MSAA, 1x pixel ratio). */}
      <PerformanceMonitor bounds={() => [45, 120]} flipflops={1} ms={200} iterations={6} onDecline={() => setDegraded(true)} />
      {/* Post-processing only on a capable, unstrained GPU. A mis-sized composer buffer is a common
          cause of a partly-black frame on some drivers, so the light path renders the scene plainly.
          No ambient-occlusion pass: it cost more than everything else put together on laptop GPUs. */}
      {heavy && (
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.12} intensity={0.7} />
          <Vignette offset={0.3} darkness={0.45} />
          {/* Edge smoothing as a shader pass: a multisampled composer buffer came out black on some Mac drivers. */}
          <SMAA />
        </EffectComposer>
      )}
    </Canvas>
  )
}
