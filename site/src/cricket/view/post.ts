// High quality only: ambient occlusion (players and stumps sit in the grass, the stands' rows read), a little bloom
// on what is really bright (the sun's glints, the floodlights and LED boards), then the match's colour grade and tone
// mapping (the same grade the other tiers get from the renderer, see env.ts) and a soft vignette, via the pmndrs
// postprocessing composer (loaded on demand).
import * as THREE from 'three'
import { gradeGlsl, type Look } from './env'

export interface Post {
  render(dt: number): void
  setSize(w: number, h: number): void
  dispose(): void
}

export async function makePost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, look: Look): Promise<Post> {
  const P = await import('postprocessing')
  class GradeEffect extends P.Effect {
    constructor() {
      super('CricketGrade', `uniform float uExposure;\n${gradeGlsl(look)}\nvoid mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(cricketGrade(inputColor.rgb, uExposure), inputColor.a); }`, {
        uniforms: new Map([['uExposure', new THREE.Uniform(1)]]),
      })
    }
  }
  const composer = new P.EffectComposer(renderer, { multisampling: 4, frameBufferType: THREE.HalfFloatType })
  composer.addPass(new P.RenderPass(scene, camera))
  const normalPass = new P.NormalPass(scene, camera, { resolutionScale: 0.5 })
  composer.addPass(normalPass)
  const ssao = new P.SSAOEffect(camera, normalPass.texture, {
    worldDistanceThreshold: 40,
    worldDistanceFalloff: 8,
    worldProximityThreshold: 0.6,
    worldProximityFalloff: 0.3,
    luminanceInfluence: 0.5,
    radius: 0.07,
    intensity: 2.0,
    samples: 9,
    rings: 7,
    resolutionScale: 0.5,
  })
  const bloom = new P.BloomEffect({ intensity: look.bloom.intensity, luminanceThreshold: look.bloom.threshold, luminanceSmoothing: 0.08, mipmapBlur: true })
  const grade = new GradeEffect()
  const vignette = new P.VignetteEffect({ darkness: 0.28, offset: 0.42 })
  composer.addPass(new P.EffectPass(camera, ssao, bloom, grade, vignette))
  const exposure = grade.uniforms.get('uExposure')!
  const prevTone = renderer.toneMapping
  renderer.toneMapping = THREE.NoToneMapping
  return {
    render: (dt) => {
      exposure.value = renderer.toneMappingExposure
      composer.render(dt)
    },
    setSize: (w, h) => composer.setSize(w, h, false),
    dispose: () => {
      renderer.toneMapping = prevTone
      composer.dispose()
    },
  }
}
