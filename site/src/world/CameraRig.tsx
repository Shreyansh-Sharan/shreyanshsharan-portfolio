import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ISLAND_RADIUS, regionForTile } from './regions'
import { heightAt } from './terrain'
import { lookTarget } from './Environment'
import { controls, moveAxes } from './controls'
import { player } from './Characters'
import { world } from './store'
import { feel } from './combat'
import { blocked } from './colliders'
import { photo } from './minigames'
import { ride, saddleHeight } from './creatures'
import { car, ship } from './rides'
import { clampToRoom, roomAt } from './interiors'

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

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const s = state.current

    if (playing && photo.active) {
      // Photo mode: a free orbit around the (frozen) player; W / S or the stick zoom.
      photo.yaw -= controls.look.x * 0.005
      photo.pitch = THREE.MathUtils.clamp(photo.pitch + controls.look.y * 0.004, -0.6, 1.3)
      controls.look.x = controls.look.y = 0
      const move = moveAxes()
      photo.dist = THREE.MathUtils.clamp(photo.dist - move.y * dt * 10, 2.5, 30)
      tmpTarget.set(player.pos.x, player.pos.y + 1.4, player.pos.z)
      tmpPos.set(
        tmpTarget.x + Math.sin(photo.yaw) * Math.cos(photo.pitch) * photo.dist,
        tmpTarget.y + Math.sin(photo.pitch) * photo.dist,
        tmpTarget.z + Math.cos(photo.yaw) * Math.cos(photo.pitch) * photo.dist,
      )
      const floor = heightAt(tmpPos.x, tmpPos.z) + 0.6
      if (tmpPos.y < floor) tmpPos.y = floor
      s.pos.lerp(tmpPos, SNAP ? 1 : 1 - Math.exp(-dt * 12))
      s.target.lerp(tmpTarget, SNAP ? 1 : 1 - Math.exp(-dt * 12))
      camera.position.copy(s.pos)
      camera.lookAt(s.target)
      lookTarget.copy(s.target)
      return
    }

    if (playing) {
      const dragged = controls.look.x !== 0 || controls.look.y !== 0
      player.camYaw -= controls.look.x * 0.005
      player.camPitch = THREE.MathUtils.clamp(player.camPitch + controls.look.y * 0.004, 0.05, 1.1)
      controls.look.x = controls.look.y = 0

      // Auto-follow: with the mouse captured the camera is entirely the player's, like a desktop game. Without
      // it (touch, or before the first click), ease back behind the heading only while moving straight ahead.
      // Movement is camera-relative, so recentering while strafing fed the turn back into the input and sent
      // the character spiralling; a sideways or diagonal input now leaves the camera where it is.
      if (dragged) s.lookIdle = 0
      else s.lookIdle += dt
      const move = moveAxes()
      const straight = move.y > 0.5 && Math.abs(move.x) < 0.2
      if (!controls.locked && s.lookIdle > 0.6 && player.speed > 0.05 && straight) {
        // Behind the player: camYaw such that the camera sits opposite the facing direction.
        const desired = player.yaw + Math.PI
        let d = desired - player.camYaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        const rate = THREE.MathUtils.clamp(dt * 1.6, 0, 1)
        player.camYaw += d * rate
        player.camPitch = THREE.MathUtils.lerp(player.camPitch, 0.3, Math.min(1, dt * 1.2))
      }
      // Pull back a little (and widen the lens) as flight speeds up.
      const mount = ride.pal
      const dist = 7.5 + player.fly * 3.5 + (mount ? mount.size * 1.5 : 0) + (car.driving ? 4 + Math.abs(car.speed) * 0.1 : 0) + (ship.aboard ? 14 : 0)
      tmpTarget.set(player.pos.x, player.pos.y + 1.6 + (mount ? saddleHeight(mount) : 0), player.pos.z)
      tmpPos.set(
        tmpTarget.x + Math.sin(player.camYaw) * Math.cos(player.camPitch) * dist,
        tmpTarget.y + Math.sin(player.camPitch) * dist,
        tmpTarget.z + Math.cos(player.camYaw) * Math.cos(player.camPitch) * dist,
      )
      // Don't sit inside a tree or a wall: if a prop stands between the player and the camera, pull in.
      for (let i = 1; i <= 4; i++) {
        const t = i / 4
        const x = tmpTarget.x + (tmpPos.x - tmpTarget.x) * t, y = tmpTarget.y + (tmpPos.y - tmpTarget.y) * t
        const z = tmpTarget.z + (tmpPos.z - tmpTarget.z) * t
        if (blocked(x, z, 1.1, y - 1)) {
          const k = Math.max(2.4 / dist, t * 0.8)
          tmpPos.set(tmpTarget.x + (tmpPos.x - tmpTarget.x) * k, tmpTarget.y + (tmpPos.y - tmpTarget.y) * k, tmpTarget.z + (tmpPos.z - tmpTarget.z) * k)
          break
        }
      }
      // Still inside something (standing against a building: the pulled-in spot can be within its wall)?
      // Then look over the shoulder from just behind the head rather than from inside the dark.
      if (blocked(tmpPos.x, tmpPos.z, 0.6, tmpPos.y - 1)) {
        tmpPos.set(tmpTarget.x + Math.sin(player.camYaw) * 1.4, tmpTarget.y + 0.9, tmpTarget.z + Math.cos(player.camYaw) * 1.4)
      }
      const floor = heightAt(tmpPos.x, tmpPos.z) + 0.8
      if (tmpPos.y < floor) tmpPos.y = floor
      // Indoors the camera stays within the walls and under the ceiling.
      const room = roomAt(player.pos.x, player.pos.y, player.pos.z)
      if (room) clampToRoom(room, tmpPos)
      // Follow faster as flight speeds up so the camera keeps the player in frame (a slow follow fell
      // so far behind at high speed that the player flew out of view and the screen went to fog/black).
      const follow = 10 + player.fly * 16
      const k = SNAP ? 1 : 1 - Math.exp(-dt * follow)
      s.target.lerp(tmpTarget, k)
      s.pos.lerp(tmpPos, k)
      // Hard cap on how far the camera may lag its ideal spot, so it can never lose the player.
      const maxLag = dist + 6
      if (s.pos.distanceTo(tmpPos) > maxLag) {
        s.pos.copy(tmpPos).add(s.pos.clone().sub(tmpPos).setLength(maxLag))
      }
      camera.position.copy(s.pos)
      // Screen shake from hits and stomps (see combat.ts), decaying quickly.
      if (feel.shake > 0.001) {
        const a = feel.shake * 0.35
        camera.position.x += (Math.random() - 0.5) * a
        camera.position.y += (Math.random() - 0.5) * a
        camera.position.z += (Math.random() - 0.5) * a
        feel.shake = Math.max(0, feel.shake - dt * 2.4)
      }
      const persp = frame.camera as THREE.PerspectiveCamera
      const fov = 48 + player.fly * 14
      if (Math.abs(persp.fov - fov) > 0.05) {
        persp.fov += (fov - persp.fov) * Math.min(1, dt * 3)
        persp.updateProjectionMatrix()
      }
      camera.lookAt(s.target)
      lookTarget.copy(s.target)
      return
    }

    // Cinematic orbit (back to the normal lens if we just left a flight).
    const lens = frame.camera as THREE.PerspectiveCamera
    if (lens.fov !== 48) {
      lens.fov = 48
      lens.updateProjectionMatrix()
    }
    const focus = world.get().focus
    let radius: number, height: number, cx: number, cz: number, cy: number
    if (mode === 'boot') {
      radius = 300
      height = 150
      cx = 0
      cz = 0
      cy = 10
      s.angle += dt * 0.035
    } else if (regionForTile(focus).shot) {
      const r = regionForTile(focus)
      const sh = r.shot!
      cx = r.center[0] + sh.at[0]
      cz = r.center[1] + sh.at[1]
      cy = heightAt(cx, cz) + sh.lift
      radius = sh.radius
      height = sh.height
      s.angle += dt * 0.05
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
    const shot = mode !== 'boot' ? regionForTile(focus).shot : undefined
    if (shot) {
      const yaw = shot.yaw + Math.sin(s.angle) * shot.sway
      tmpPos.set(cx + Math.sin(yaw) * radius, cy + height, cz + Math.cos(yaw) * radius)
    }

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
