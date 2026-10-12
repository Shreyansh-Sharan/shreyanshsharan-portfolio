// High quality only: ambient occlusion, a little bloom on the floodlights and boards, ACES tone mapping and a
// vignette, via the pmndrs postprocessing composer (loaded on demand).
import * as THREE from 'three'

export interface Post {
  render(dt: number): void
  setSize(w: number, h: number): void
  dispose(): void
}

export async function makePost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, night: boolean): Promise<Post> {
  const P = await import('postprocessing')
  const composer = new P.EffectComposer(renderer, { multisampling: 4, frameBufferType: THREE.HalfFloatType })
  composer.addPass(new P.RenderPass(scene, camera))
  const normalPass = new P.NormalPass(scene, camera, { resolutionScale: 0.5 })
  composer.addPass(normalPass)
  const ssao = new P.SSAOEffect(camera, normalPass.texture, {
    worldDistanceThreshold: 40,
    worldDistanceFalloff: 8,
    worldProximityThreshold: 0.5,
    worldProximityFalloff: 0.25,
    luminanceInfluence: 0.6,
    radius: 0.06,
    intensity: 2.2,
    samples: 9,
    rings: 7,
    resolutionScale: 0.5,
  })
  const bloom = new P.BloomEffect({ intensity: night ? 0.9 : 0.35, luminanceThreshold: night ? 0.75 : 0.9, mipmapBlur: true })
  const tone = new P.ToneMappingEffect({ mode: P.ToneMappingMode.ACES_FILMIC })
  const vignette = new P.VignetteEffect({ darkness: 0.32, offset: 0.4 })
  composer.addPass(new P.EffectPass(camera, ssao, bloom, tone, vignette))
  const prevTone = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h) => composer.setSize(w, h, false),
    dispose: () => {
      renderer.toneMapping = prevTone
      composer.dispose()
    },
  }
}
