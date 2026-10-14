// Contact shadows: a soft dark pool on the grass under every player (ambient occlusion where the boots meet the
// ground), so nobody floats, on every tier. One instanced draw; each pool follows the player's hips, spreads and
// fades as he leaves the ground (a dive, a jump) and leans a little away from the sun.
import * as THREE from 'three'

let tex: THREE.Texture | null = null
function poolTexture() {
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(0.35, 'rgba(0,0,0,0.65)')
  g.addColorStop(0.7, 'rgba(0,0,0,0.18)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  tex = new THREE.CanvasTexture(c)
  return tex
}

export interface Grounded {
  root: THREE.Object3D
  bones: { Hips: THREE.Object3D }
}

const _p = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _t = new THREE.Vector3()
const _y = new THREE.Vector3(0, 1, 0)

export class ContactShadows {
  mesh: THREE.InstancedMesh
  private fade: THREE.InstancedBufferAttribute
  private lean: THREE.Vector2

  constructor(max: number, sunDir: THREE.Vector3, strength: number) {
    const geo = new THREE.PlaneGeometry(1, 1)
    geo.rotateX(-Math.PI / 2)
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1)
    geo.setAttribute('aFade', this.fade)
    const mat = new THREE.MeshBasicMaterial({ map: poolTexture(), color: '#0b1408', transparent: true, opacity: strength, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vFade;')
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, max)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    this.mesh.count = 0
    // The pool leans a little away from the sun (a hint of the cast shadow where there is no shadow map).
    const h = new THREE.Vector2(-sunDir.x, -sunDir.z)
    this.lean = h.lengthSq() > 1e-6 ? h.normalize().multiplyScalar(Math.min(0.35, 0.18 / Math.max(0.2, sunDir.y))) : new THREE.Vector2()
  }

  update(people: (Grounded | null)[]) {
    let n = 0
    for (const c of people) {
      if (!c || !c.root.visible) continue
      c.bones.Hips.getWorldPosition(_p)
      const lift = Math.max(0, _p.y - 0.95)
      const k = THREE.MathUtils.clamp(1 - lift * 1.4, 0.15, 1)
      const r = 1.05 + lift * 0.8
      _s.set(r * 1.15, 1, r)
      _q.setFromAxisAngle(_y, Math.atan2(this.lean.x, this.lean.y))
      _m.compose(_t.set(_p.x + this.lean.x * k, 0.014, _p.z + this.lean.y * k), _q, _s)
      this.mesh.setMatrixAt(n, _m)
      this.fade.setX(n, k)
      n++
      if (n >= this.mesh.instanceMatrix.count) break
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    this.fade.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
