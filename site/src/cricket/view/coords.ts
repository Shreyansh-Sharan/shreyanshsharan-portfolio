// The simulation keeps the original (left-handed) numbers; the view mirrors x so everything renders the right way
// round in three.js (a right-hander's off side is on the bowler's left, as on TV).
import * as THREE from 'three'
import type { V3 } from '../sim/vec.ts'

export const toView = (v: V3 | readonly number[], out = new THREE.Vector3()) =>
  Array.isArray(v) ? out.set(-(v as number[])[0], (v as number[])[1], (v as number[])[2]) : out.set(-(v as V3).x, (v as V3).y, (v as V3).z)

/** Simulation yaw (degrees, 0 = +z, clockwise from above) to a three.js rotation.y. */
export const yawToView = (deg: number) => (-deg * Math.PI) / 180

/** A view point back to simulation coordinates. */
export const toSim = (v: THREE.Vector3) => [-v.x, v.y, v.z] as const
