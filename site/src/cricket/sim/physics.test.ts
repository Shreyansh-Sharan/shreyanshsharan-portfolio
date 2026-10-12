// Offline physics checks (a port of the original PhysicsSim harness): bowls and hits balls with the game's own
// simulation and checks the calibration against real cricket numbers.
// Run: node src/cricket/sim/physics.test.ts   (from site/; Node 22.18+ runs TypeScript directly)
declare const process: { argv: string[]; exitCode?: number }
import { advance, crossesZ, dragK, hitsStumps, newBall, step, DT } from './ball.ts'
import { makeEnv, pitchSurface, type PitchType, type TimeOfDay } from './conditions.ts'
import { DELIVERIES, releaseBall, type BowlStyle, type DeliveryType } from './delivery.ts'
import { BatFrame, beyondRope, Geo, poppingZ, stumpsZ } from './geo.ts'
import { classifyTiming, resolveShot, type Footwork, type ShotType } from './shots.ts'
import { DEG, Rng, V3 } from './vec.ts'

let failures = 0
function check(label: string, value: number, min: number, max: number) {
  const ok = value >= min && value <= max
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'} ${label}: ${value.toFixed(2)} (expected ${min}..${max})`)
}

const f1 = (v: number) => v.toFixed(1)
const f2 = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)
const dist = (a: V3, b: V3) => a.flatDist(b)

interface BowlResult {
  creaseKmh: number
  creaseHeight: number
  turnDeg: number
  swing: number
  hitting: boolean
}

function bowl(label: string, pitch: PitchType, time: TimeOfDay, type: DeliveryType, style: BowlStyle, kmh: number, length: number, lineOff: number): BowlResult {
  const env = makeEnv(pitch, time, new V3())
  const rng = new Rng(7)
  const frame = BatFrame.for(1, true)
  const target = frame.local(lineOff, length)
  const spec = DELIVERIES[type]
  const { ball: s, aimed } = releaseBall({ type, style, leftArm: false, around: false, target, speedKmh: kmh * spec.speedFactor, releaseError: 0, noBall: false }, 0, frame.off, 2, 0.8, env, rng)
  const release = s.pos.clone()
  const launchV = s.vel.clone()
  let atCrease = new V3()
  let atStumps = new V3()
  let bounceAt = new V3()
  let tCrease = 0
  let vBefore = 0
  let vAfter = 0
  let vCrease = 0
  let gotCrease = false
  let gotStumps = false
  let pre = new V3()
  let post = new V3()
  const creaseZ = poppingZ(1)
  const sZ = stumpsZ(1)
  let prev = s.pos.clone()
  const path: string[] = []
  for (let i = 0; i < 4000 && !gotStumps; i++) {
    const vb = s.vel.clone()
    const r = step(s, env, DT)
    if (r.bounced && s.bounces === 1) {
      bounceAt = r.bouncePos
      vBefore = vb.len
      vAfter = s.vel.len
      pre = vb.flat().norm()
      post = s.vel.flat().norm()
    }
    const c = !gotCrease ? crossesZ(prev, s.pos, creaseZ) : null
    if (c) {
      gotCrease = true
      atCrease = c
      tCrease = s.time
      vCrease = s.vel.len
    }
    const st = crossesZ(prev, s.pos, sZ)
    if (st) {
      gotStumps = true
      atStumps = st
    }
    if (i % 50 === 0) path.push(`${f1(s.pos.z)}/${s.pos.y.toFixed(2)}`)
    prev = s.pos.clone()
  }
  const turnDeg = pre.cross(post).y / DEG
  const straight = launchV.flat().norm()
  const land = bounceAt.sub(release).flat()
  const swing = straight.cross(land.norm()).y * land.len
  const hit = hitsStumps(atStumps)
  console.log(`-- ${label}: ${Math.round(kmh * spec.speedFactor)} km/h release, spin ${Math.round(s.spin.len / (2 * Math.PI))} rev/s`)
  console.log(`   release ${release}  aimed ${aimed}  pitched ${bounceAt} (${frame.offsetFwd(bounceAt).toFixed(2)} m from the batter's stumps, off ${f2(frame.offsetOff(bounceAt))})`)
  console.log(`   speed at bounce ${Math.round(vBefore * 3.6)} -> ${Math.round(vAfter * 3.6)} km/h, at the popping crease ${Math.round(vCrease * 3.6)} km/h after ${tCrease.toFixed(3)} s; swing ${f2(swing)} m; deviation off the pitch ${turnDeg.toFixed(1)} deg`)
  console.log(`   at the crease: height ${atCrease.y.toFixed(2)} m, off ${f2(frame.offsetOff(atCrease))} m; at the stumps: height ${atStumps.y.toFixed(2)} m, off ${f2(frame.offsetOff(atStumps))} m -> ${hit ? 'HITTING' : 'missing'}`)
  console.log(`   path (every 0.1 s, z/y): ${path.join(' ')}`)
  return { creaseKmh: vCrease * 3.6, creaseHeight: atCrease.y, turnDeg, swing, hitting: hit }
}

function hit(label: string, speed: number, elevationDeg: number, backspinRevs: number, wind = new V3()) {
  const env = makeEnv('flat', 'day', wind)
  const dir = new V3(0, 0, -1)
  const el = elevationDeg * DEG
  const s = newBall(new V3(0, 0.5, poppingZ(1)))
  s.vel = dir.mul(Math.cos(el)).add(new V3(0, Math.sin(el), 0)).mul(speed)
  s.spin = new V3(dir.z, 0, -dir.x).mul(-backspinRevs * 2 * Math.PI)
  const start = s.pos.clone()
  let carry = -1
  let maxH = 0
  let tBoundary = -1
  let vBoundary = 0
  let t = 0
  while (t < 12 && !s.stopped) {
    const r = advance(s, env, 0.02)
    t += 0.02
    maxH = Math.max(maxH, s.pos.y)
    if (r.bounced && carry < 0) carry = dist(start, r.bouncePos)
    if (tBoundary < 0 && beyondRope(s.pos) >= 0) {
      tBoundary = t
      vBoundary = s.vel.len
      break
    }
  }
  const fate = tBoundary >= 0 ? (carry < 0 ? `SIX (carried the rope at ${Math.round(dist(start, s.pos))} m)` : `FOUR after ${f1(tBoundary)} s, still ${f1(vBoundary)} m/s`) : `stopped at ${Math.round(dist(start, s.pos))} m after ${f1(t)} s`
  console.log(`-- ${label}: ${speed} m/s at ${elevationDeg} deg, back spin ${backspinRevs} rev/s${wind.len > 0 ? `, wind ${wind.z} m/s` : ''}: carry ${carry < 0 ? 'beyond the rope' : f1(carry) + ' m'}, apex ${f1(maxH)} m -> ${fate}`)
  return { carry, maxH, boundary: tBoundary >= 0, reach: carry < 0 && tBoundary >= 0 ? dist(start, s.pos) : carry }
}

function stroke(label: string, type: ShotType, feet: Footwork, aim: number, loft: boolean, err: number) {
  const f = BatFrame.for(1, true)
  const ballPos = f.local(0.25, Geo.CreaseDepth + 0.62, 0.55)
  const ctx = { frame: f, ballPos, ballVel: f.fwd.mul(-33).add(new V3(0, 2, 0)), length: 5.5, lateMovement: 0.02, spin: false, batterSkill: 0.8, batterPower: 0.7, guard: 0, window: 1 }
  const rng = new Rng(11)
  let edges = 0
  let misses = 0
  const n = 200
  let speed = 0
  let dir = 0
  let elev = 0
  let carry = 0
  let middled = 0
  let sixes = 0
  let fours = 0
  const env = makeEnv('flat', 'day', new V3())
  for (let i = 0; i < n; i++) {
    const r = resolveShot({ type, feet, aim, loft, played: true, timingError: err, power: 0 }, ctx, rng)
    if (r.contact === 'edge') {
      edges++
      continue
    }
    if (r.contact !== 'middle') {
      misses++
      continue
    }
    middled++
    speed += r.exitVel.len
    dir += r.direction
    elev += Math.asin(r.exitVel.norm().y) / DEG
    const s = newBall(ballPos.clone())
    s.vel = r.exitVel.clone()
    s.spin = r.exitSpin.clone()
    let c = -1
    let bounced = false
    for (let k = 0; k < 800 && !s.stopped; k++) {
      const res = advance(s, env, 0.02)
      if (res.bounced && !bounced) {
        bounced = true
        c = dist(ballPos, res.bouncePos)
      }
      if (beyondRope(s.pos) >= 0) {
        if (!bounced) sixes++
        else fours++
        break
      }
    }
    carry += c < 0 ? 80 : c
  }
  if (middled === 0) {
    console.log(`-- ${label}: never middled (edges ${edges}, misses ${misses} of ${n})`)
    return { exit: 0, carry: 0 }
  }
  console.log(
    `-- ${label}: timing ${classifyTiming(err, 1)}; middled ${Math.round((middled * 100) / n)}%, edged ${Math.round((edges * 100) / n)}%, missed ${Math.round((misses * 100) / n)}%; exit ${f1(speed / middled)} m/s (${Math.round((speed / middled) * 3.6)} km/h) at ${Math.round(elev / middled)} deg towards ${Math.round(dir / middled)} deg; carry ${Math.round(carry / middled)} m; fours ${Math.round((fours * 100) / middled)}% sixes ${Math.round((sixes * 100) / middled)}%`,
  )
  return { exit: speed / middled, carry: carry / middled }
}

console.log(`Constants: pitch ${Geo.PitchLength} m, ball ${Geo.BallMass} kg, radius ${Geo.BallRadius} m, drag k ${dragK(makeEnv('flat', 'day', new V3())).toFixed(5)} 1/m`)
console.log(`Pitch restitution: green ${pitchSurface('green').restitution}, flat ${pitchSurface('flat').restitution}, dusty ${pitchSurface('dusty').restitution}`)
console.log('\n=== Deliveries (from end 0 to a right-hander at end 1) ===')
const seam = bowl('Fast seam-up, good length, flat', 'flat', 'day', 'seam', 'fast', 145, 6.5, 0.05)
const bouncer = bowl('Fast bouncer, green', 'green', 'day', 'bouncer', 'fast', 148, 10.5, 0)
const dugIn = bowl('Fast bouncer dug in short, green', 'green', 'day', 'bouncer', 'fast', 148, 12.5, 0)
const yorker = bowl('Fast yorker, flat', 'flat', 'day', 'yorker', 'fast', 146, 1.3, 0)
const outswing = bowl('Medium outswinger, green, under lights', 'green', 'night', 'outswing', 'medium', 128, 5, 0.1)
const inswing = bowl('Medium inswinger, flat, day', 'flat', 'day', 'inswing', 'medium', 126, 5.5, 0.05)
bowl('Slower ball, flat', 'flat', 'day', 'slower', 'fast', 145, 6, 0)
const offDusty = bowl('Off-break, dusty', 'dusty', 'day', 'offbreak', 'offspin', 86, 4.6, 0.1)
const offFlat = bowl('Off-break, flat', 'flat', 'day', 'offbreak', 'offspin', 86, 4.6, 0.1)
const legDusty = bowl('Leg-break, dusty', 'dusty', 'day', 'legbreak', 'legspin', 82, 4.8, 0.1)
const googly = bowl('Googly, dusty', 'dusty', 'day', 'googly', 'legspin', 80, 4.6, 0.1)
bowl('Arm ball, flat', 'flat', 'day', 'armball', 'offspin', 90, 5, 0.1)
bowl('Top-spinner, dusty', 'dusty', 'day', 'topspinner', 'legspin', 82, 5.2, 0)

console.log('\n=== Shots off the bat (from the popping crease straight down the ground, no wind) ===')
hit('Perfect drive along the ground', 32, 3, 0)
hit('Firm push', 14, 1, 0)
hit('Defensive block', 4, -8, 0)
const lofted = hit('Lofted drive, middled', 37, 30, 30)
hit('Lofted drive, mistimed', 26, 32, 20)
hit('Slog, top-edged skier', 24, 70, 10)
hit('Pull, middled', 35, 18, 25)
hit('Lofted drive into a 6 m/s headwind', 37, 30, 30, new V3(0, 0, 6))
hit('Lofted drive with a 6 m/s tailwind', 37, 30, 30, new V3(0, 0, -6))

console.log('\n=== Shot model (135 km/h good-length ball outside off, right-hander) ===')
const drive = stroke('Front-foot drive, perfect', 'drive', 'front', 30, false, 0)
stroke('Front-foot drive, 40 ms early', 'drive', 'front', 30, false, -0.04)
stroke('Front-foot drive, 40 ms late', 'drive', 'front', 30, false, 0.04)
stroke('Lofted drive, perfect', 'drive', 'front', 10, true, 0)
stroke('Lofted drive, 60 ms late', 'drive', 'front', 10, true, 0.06)
stroke('Cut on the back foot to a full ball', 'cut', 'back', 100, false, 0)
stroke('Forward defence', 'defend', 'front', 0, false, 0)

console.log('\n=== Calibration ===')
check('145 km/h seam-up at the popping crease (km/h)', seam.creaseKmh, 115, 123)
check('Bouncer (dug in short) height at the popping crease (m)', dugIn.creaseHeight, 1.75, 2.05)
check('Bouncer (back of a length) height at the popping crease (m)', bouncer.creaseHeight, 1.0, 1.5)
check('Off-break turn on a dusty pitch (deg)', Math.abs(offDusty.turnDeg), 4.0, 5.2)
check('Off-break turn on a flat pitch (deg)', Math.abs(offFlat.turnDeg), 1.7, 2.7)
check('Middled lofted drive carry (m)', lofted.reach, 72, 82)
check('Perfect drive exit speed (m/s)', drive.exit, 28, 32)
check('Yorker height at the popping crease (m)', yorker.creaseHeight, 0, 0.3)
check('Off-break and leg-break turn opposite ways (sign product)', Math.sign(offDusty.turnDeg) * Math.sign(legDusty.turnDeg), -1, -1)
check('Googly turns like an off-break (sign product)', Math.sign(offDusty.turnDeg) * Math.sign(googly.turnDeg), 1, 1)
check('Outswing moves towards off, inswing towards leg (sign product)', Math.sign(outswing.swing) * Math.sign(inswing.swing), -1, -1)
console.log(failures === 0 ? '\nAll calibration checks passed.' : `\n${failures} calibration check(s) FAILED.`)
process.exitCode = failures === 0 ? 0 : 1
