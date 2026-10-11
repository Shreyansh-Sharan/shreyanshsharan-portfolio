import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ISLAND_RADIUS, regionForTile } from './regions'
import { heightAt } from './terrain'
import { lookTarget } from './Environment'
import { controls } from './controls'
import { player } from './Characters'
import { world } from './store'

// `?snap` jumps the camera instantly (handy for screenshots and slow machines).
const SNAP = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('snap')

const tmpTarget = new THREE.Vector3()
const tmpPos = new THREE.Vector3()
const right = new THREE.Vector3()

/**
 * Browsing: a cinematic orbit around the focused region, flying between regions when the focus changes.
 * Exploring: a third-person follow camera, rotated by dragging.
 */
export function CameraRig({ playing, mode }: { playing: boolean; mode: 'boot' | 'home' | 'page' }) {
  const { camera, size } = useThree()
  const state = useRef({ angle: 0.6, target: new THREE.Vector3(0, 20, 0), pos: new THREE.Vector3(0, 180, 320), init: false, lookIdle: 0 })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = state.current

    if (playing) {
      const dragged = controls.look.x !== 0 || controls.look.y !== 0
      player.camYaw -= controls.look.x * 0.005
      player.camPitch = THREE.MathUtils.clamp(player.camPitch + controls.look.y * 0.004, 0.05, 1.1)
      controls.look.x = controls.look.y = 0

      // When the player isn't actively dragging to look, ease the camera back behind the player's
      // heading so it auto-follows. Only kicks in after a short idle and while the player is moving.
      if (dragged) s.lookIdle = 0
      else s.lookIdle += dt
      if (s.lookIdle > 0.6 && player.speed > 0.2) {
        // Behind the player: camYaw such that the camera sits opposite the facing direction.
        const desired = player.yaw + Math.PI
        let d = desired - player.camYaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        player.camYaw += d * Math.min(1, dt * 2.2)
        // Ease the pitch back to a comfortable default too.
        player.camPitch = THREE.MathUtils.lerp(player.camPitch, 0.3, Math.min(1, dt * 1.5))
      }
      const dist = 7.5
      tmpTarget.set(player.pos.x, player.pos.y + 1.6, player.pos.z)
      tmpPos.set(
        tmpTarget.x + Math.sin(player.camYaw) * Math.cos(player.camPitch) * dist,
        tmpTarget.y + Math.sin(player.camPitch) * dist,
        tmpTarget.z + Math.cos(player.camYaw) * Math.cos(player.camPitch) * dist,
      )
      const floor = heightAt(tmpPos.x, tmpPos.z) + 0.8
      if (tmpPos.y < floor) tmpPos.y = floor
      const k = SNAP ? 1 : 1 - Math.exp(-dt * 10)
      s.target.lerp(tmpTarget, k)
      s.pos.lerp(tmpPos, k)
      camera.position.copy(s.pos)
      camera.lookAt(s.target)
      lookTarget.copy(s.target)
      return
    }

    // Cinematic orbit.
    const focus = world.get().focus
    let radius: number, height: number, cx: number, cz: number, cy: number
    if (mode === 'boot') {
      radius = 300
      height = 150
      cx = 0
      cz = 0
      cy = 10
      s.angle += dt * 0.035
    } else {
      const r = regionForTile(focus)
      radius = r.orbit.radius
      height = r.orbit.height
      const lm = r.landmarks[0]
      cx = r.center[0] + (lm?.at[0] ?? 0)
      cz = r.center[1] + (lm?.at[1] ?? 0)
      cy = heightAt(cx, cz) + (lm ? Math.min(lm.height * 0.5, 14) : 4)
      s.angle += dt * 0.05
    }
    tmpTarget.set(cx, cy, cz)
    // Orbit angle faces the island centre side so regions are seen from the "inside".
    const base = Math.atan2(cz, cx)
    const a = base + Math.sin(s.angle) * 0.5 + (mode === 'boot' ? s.angle * 4 : 0)
    // Low, near-horizontal orbit so the sky and the far side of the island frame each landmark.
    tmpPos.set(cx - Math.cos(a) * radius, cy + height * 0.45, cz - Math.sin(a) * radius)
    if (mode === 'boot') tmpPos.set(Math.cos(s.angle) * radius, height, Math.sin(s.angle) * radius)

    if (!s.init) {
      s.target.copy(tmpTarget)
      s.pos.copy(tmpPos).add(new THREE.Vector3(0, 80, 0))
      s.init = true
    }
    // Long trips arc up over the island.
    const travel = SNAP ? 0 : s.target.distanceTo(tmpTarget)
    const k = SNAP ? 1 : 1 - Math.exp(-dt * 1.4)
    s.target.lerp(tmpTarget, k)
    s.pos.lerp(tmpPos, k)
    s.pos.y = Math.max(s.pos.y, heightAt(s.pos.x, s.pos.z) + 6)
    const lift = Math.min(70, travel * 0.35)
    camera.position.set(s.pos.x, s.pos.y + lift, s.pos.z)
    if (Math.hypot(camera.position.x, camera.position.z) > ISLAND_RADIUS * 3) camera.position.multiplyScalar(0.98)

    // Frame the landmark right of centre (where the key art used to be) on wide screens.
    camera.lookAt(s.target)
    if (mode === 'home' && size.width > 860) {
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      const shift = camera.position.distanceTo(s.target) * 0.3
      camera.lookAt(s.target.x - right.x * shift, s.target.y + 1, s.target.z - right.z * shift)
    }
    lookTarget.copy(s.target)
  })
  return null
}
