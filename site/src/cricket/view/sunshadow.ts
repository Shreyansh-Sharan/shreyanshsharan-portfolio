// The venue's own shadows, baked once per match: the sun is fixed for the whole game, so the stands, roofs, the
// pavilion and the scoreboard are drawn into one wide depth map at the start, and the stands, the crowd, the outfield
// and the players look it up (a few taps of a texture, no shadow pass per frame). The roofs shade the upper tiers,
// the stands throw their shadow onto the grass by the rope, and a fielder at long-on walks out of the sun. The
// play area's sharp, moving shadows (players, stumps, ball) stay with the sun's own tight shadow map.
import * as THREE from 'three'

export const VENUE_LAYER = 3

export interface VenueShadowUniforms {
  [k: string]: THREE.IUniform
  uVenueDepth: THREE.IUniform<THREE.Texture | null>
  uVenueMatrix: THREE.IUniform<THREE.Matrix4>
  uVenueOn: THREE.IUniform<number>
  uVenueTexel: THREE.IUniform<number>
}

/** One match's venue shadow uniforms, shared by every material that receives them. */
export function venueShadowUniforms(): VenueShadowUniforms {
  return {
    uVenueDepth: { value: null },
    uVenueMatrix: { value: new THREE.Matrix4() },
    uVenueOn: { value: 0 },
    uVenueTexel: { value: 1 / 2048 },
  }
}

/**
 * Patches a lit material's shader (inside its onBeforeCompile) so its direct light is shadowed by the venue.
 * `taps`: 5, 1, or 0 (none: the material is left alone).
 */
export function receiveVenueShadow(sh: THREE.WebGLProgramParametersWithUniforms, venueShadow: VenueShadowUniforms, taps = 5) {
  if (taps <= 0) return
  Object.assign(sh.uniforms, venueShadow)
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nuniform mat4 uVenueMatrix;\nvarying vec4 vVenueCoord;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 vw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vw = instanceMatrix * vw;
        #endif
        vVenueCoord = uVenueMatrix * modelMatrix * vw;
      }`,
    )
  const tapCode =
    taps > 1
      ? `float s = 0.0;
        s += step(c.z, texture2D(uVenueDepth, c.xy).r);
        s += step(c.z, texture2D(uVenueDepth, c.xy + vec2(uVenueTexel, 0.0)).r);
        s += step(c.z, texture2D(uVenueDepth, c.xy - vec2(uVenueTexel, 0.0)).r);
        s += step(c.z, texture2D(uVenueDepth, c.xy + vec2(0.0, uVenueTexel)).r);
        s += step(c.z, texture2D(uVenueDepth, c.xy - vec2(0.0, uVenueTexel)).r);
        venueLit = s * 0.2;`
      : 'venueLit = step(c.z, texture2D(uVenueDepth, c.xy).r);'
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uVenueDepth;\nuniform float uVenueOn;\nuniform float uVenueTexel;\nvarying vec4 vVenueCoord;')
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      {
        float venueLit = 1.0;
        vec3 c = vVenueCoord.xyz / vVenueCoord.w;
        if (uVenueOn > 0.5 && c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) {
          c.z -= 0.0008;
          ${tapCode}
        }
        reflectedLight.directDiffuse *= venueLit;
        reflectedLight.directSpecular *= venueLit;
      }`,
    )
}

/**
 * Renders the casters (objects on VENUE_LAYER) into a depth map seen from the sun and points the shared uniforms
 * at it. Returns the render target (dispose it with the match).
 */
export function bakeVenueShadow(renderer: THREE.WebGLRenderer, scene: THREE.Scene, venueShadow: VenueShadowUniforms, sunDir: THREE.Vector3, size: number, extent: number) {
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true })
  rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType)
  rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter
  const cam = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 1, 900)
  cam.position.copy(sunDir).normalize().multiplyScalar(400)
  cam.up.set(0, 1, 0)
  if (Math.abs(sunDir.y) > 0.99) cam.up.set(0, 0, 1)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  cam.layers.set(VENUE_LAYER)
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  const prevOverride = scene.overrideMaterial
  const prevBg = scene.background
  const prevFog = scene.fog
  const prevTarget = renderer.getRenderTarget()
  const prevShadow = renderer.shadowMap.enabled
  scene.overrideMaterial = mat
  scene.background = null
  scene.fog = null
  renderer.shadowMap.enabled = false
  const prevScissor = renderer.getScissorTest()
  renderer.setScissorTest(false)
  renderer.setRenderTarget(rt)
  renderer.clear(true, true, true)
  renderer.render(scene, cam)
  renderer.setRenderTarget(prevTarget)
  renderer.setScissorTest(prevScissor)
  renderer.shadowMap.enabled = prevShadow
  scene.overrideMaterial = prevOverride
  scene.background = prevBg
  scene.fog = prevFog
  mat.dispose()
  // World -> [0,1] shadow coordinates.
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  venueShadow.uVenueMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse)
  venueShadow.uVenueDepth.value = rt.depthTexture
  venueShadow.uVenueTexel.value = 1.5 / size
  venueShadow.uVenueOn.value = 1
  return rt
}
