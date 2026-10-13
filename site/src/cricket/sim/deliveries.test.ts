// Offline checks for the bowling and fielding model: every delivery type does what its name says (swing in the air,
// conventional against late, cutters and spin off the pitch, drift, bounce), the release meter matters, pitch wear
// adds turn, the field presets obey the fielding restrictions, and a match replays identically from its seed.
// Run: node src/cricket/sim/deliveries.test.ts   (from site/)
declare const process: { argv: string[]; exitCode?: number }
import { step, DT, type BallState } from './ball.ts'
import { makeEnv, type PitchType } from './conditions.ts'
import { DELIVERIES, deliveriesFor, releaseBall, type BowlStyle, type DeliveryType } from './delivery.ts'
import { BatFrame, poppingZ } from './geo.ts'
import { checkField, customSpots, enforce, presetSpots, PRESET_ORDER } from './fields.ts'
import { Director } from './director.ts'
import { builtInTeams, cloneTeam } from './teams.ts'
import { Rng, V3 } from './vec.ts'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const f2 = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)

interface Flight {
  /** Sideways position (+ off side) every 0.05 s until the popping crease. */
  path: number[]
  /** Sideways movement from the launch line at the crease (+ off). */
  dev: number
  /** Turn off the pitch, degrees (+ towards off). */
  turn: number
  /** Height at the popping crease. */
  creaseY: number
  /** Lateral movement in the air: the last third of the pre-bounce flight vs the first two thirds. */
  airEarly: number
  airLate: number
  kmh: number
  late: boolean
}

function bowl(type: DeliveryType, style: BowlStyle, opts: { pitch?: PitchType; wear?: number; err?: number; kmh?: number; len?: number; off?: number; skill?: number } = {}): Flight {
  const env = makeEnv(opts.pitch ?? 'flat', 'dusk', new V3(), opts.wear ?? 0)
  const frame = BatFrame.for(1, true)
  const spec = DELIVERIES[type]
  const kmh = (opts.kmh ?? (spec.spin ? 85 : style === 'fast' ? 142 : 128)) * spec.speedFactor
  const target = frame.local(opts.off ?? 0.1, opts.len ?? spec.defaultLength)
  const r = releaseBall({ type, style, leftArm: false, around: false, target, speedKmh: kmh, releaseError: opts.err ?? 0, noBall: false }, 0, frame.off, 2, opts.skill ?? 0.8, env, new Rng(21))
  const s: BallState = r.ball
  const p0 = s.pos.clone()
  const v0 = s.vel.clone()
  const path: number[] = []
  const air: { t: number; u: number }[] = []
  let pre = new V3()
  let post = new V3()
  let creaseY = 0
  let at = new V3()
  for (let i = 0; i < 4000; i++) {
    const prev = s.pos.clone()
    const vb = s.vel.clone()
    const st = step(s, env, DT)
    if (i % 25 === 0) path.push(frame.offsetOff(s.pos))
    if (!s.pitched) air.push({ t: s.time, u: frame.offsetOff(s.pos) - frame.offsetOff(p0.add(v0.mul(s.time))) })
    if (st.bounced && s.bounces === 1) {
      pre = vb.flat().norm()
      post = s.vel.flat().norm()
    }
    if (prev.z < poppingZ(1) && s.pos.z >= poppingZ(1)) {
      at = s.pos.clone()
      creaseY = s.pos.y
      break
    }
  }
  const k = (poppingZ(1) - p0.z) / v0.z
  const dev = frame.offsetOff(at) - frame.offsetOff(p0.add(v0.mul(k)))
  // Turn: the change of heading at the bounce, signed towards off.
  const turn = (Math.asin(Math.max(-1, Math.min(1, pre.cross(post).y))) * 180) / Math.PI * Math.sign(frame.off.x)
  const n = air.length
  const a1 = air[Math.floor(n * 0.66)]?.u ?? 0
  const a2 = air[n - 1]?.u ?? 0
  return { path, dev, turn, creaseY, airEarly: a1, airLate: a2 - a1, kmh, late: r.late }
}

console.log('=== Delivery types ===')
for (const style of ['fast', 'swing', 'medium', 'offspin', 'legspin'] as BowlStyle[]) {
  const list = deliveriesFor(style)
  check(`${style}: ${list.join(', ')}`, list.length >= 4 && list.every((t) => DELIVERIES[t].spin === (style === 'offspin' || style === 'legspin')))
}
check('pace menu has in/outswing, both cutters, yorker, bouncer, slower ball', ['inswing', 'outswing', 'offcutter', 'legcutter', 'yorker', 'bouncer', 'slower'].every((t) => deliveriesFor('fast').includes(t as DeliveryType)))
check('off-spin menu has the doosra and arm ball; leg-spin the googly and top-spinner', deliveriesFor('offspin').includes('doosra') && deliveriesFor('offspin').includes('armball') && deliveriesFor('legspin').includes('googly') && deliveriesFor('legspin').includes('topspinner'))

console.log('\n=== Swing in the air ===')
const outC = bowl('outswing', 'swing', { pitch: 'green', err: 0.8 })
const outL = bowl('outswing', 'swing', { pitch: 'green', err: 0 })
const inL = bowl('inswing', 'swing', { pitch: 'green', err: 0 })
const outFast = bowl('outswing', 'fast', { pitch: 'green', err: 0.8 })
console.log(`   outswinger conventional: dev ${f2(outC.dev)} m, air early ${f2(outC.airEarly)} late ${f2(outC.airLate)}`)
console.log(`   outswinger late:         dev ${f2(outL.dev)} m, air early ${f2(outL.airEarly)} late ${f2(outL.airLate)} (late=${outL.late})`)
console.log(`   inswinger late:          dev ${f2(inL.dev)} m`)
console.log(`   fast bowler outswinger:  dev ${f2(outFast.dev)} m`)
check('outswinger moves away (towards off) by 0.25-0.9 m', outC.dev > 0.25 && outC.dev < 0.9, f2(outC.dev))
check('inswinger moves in (towards leg)', inL.dev < -0.25, f2(inL.dev))
check('a perfect release from a swing bowler swings late', outL.late && !outC.late)
check('late swing does more of its bending in the last third of the flight', outL.airLate / Math.max(0.01, Math.abs(outL.airEarly) + Math.abs(outL.airLate)) > outC.airLate / Math.max(0.01, Math.abs(outC.airEarly) + Math.abs(outC.airLate)) + 0.15)
check('a swing bowler swings it more than a tearaway', outC.dev > outFast.dev * 1.5, `${f2(outC.dev)} v ${f2(outFast.dev)}`)
const loose = bowl('outswing', 'swing', { pitch: 'green', err: 1.9 })
check('a loose release (in the red) swings less', Math.abs(loose.dev) < Math.abs(outC.dev) * 0.8, f2(loose.dev))

console.log('\n=== Off the pitch ===')
const offc = bowl('offcutter', 'medium', { pitch: 'dusty' })
const legc = bowl('legcutter', 'medium', { pitch: 'dusty' })
console.log(`   off-cutter turn ${f2(offc.turn)} deg, leg-cutter ${f2(legc.turn)} deg`)
check('off-cutter comes back in, leg-cutter goes away', offc.turn < -0.5 && legc.turn > 0.5)
const ob = bowl('offbreak', 'offspin', { pitch: 'dusty' })
const doosra = bowl('doosra', 'offspin', { pitch: 'dusty' })
const lb = bowl('legbreak', 'legspin', { pitch: 'dusty' })
const goog = bowl('googly', 'legspin', { pitch: 'dusty' })
console.log(`   off-break ${f2(ob.turn)}, doosra ${f2(doosra.turn)}, leg-break ${f2(lb.turn)}, googly ${f2(goog.turn)} deg`)
check('off-break turns in, doosra turns away', ob.turn < -2 && doosra.turn > 2)
check('leg-break turns away, googly turns in', lb.turn > 2 && goog.turn < -2)
const obNew = bowl('offbreak', 'offspin', { pitch: 'flat', wear: 0 })
const obWorn = bowl('offbreak', 'offspin', { pitch: 'flat', wear: 1 })
console.log(`   off-break on a new flat pitch ${f2(obNew.turn)}, worn ${f2(obWorn.turn)} deg`)
check('a worn pitch turns more', Math.abs(obWorn.turn) > Math.abs(obNew.turn) + 0.4)
const obWeak = bowl('offbreak', 'offspin', { pitch: 'dusty', skill: 0.2 })
check('a better spinner gets more turn (more revs)', Math.abs(ob.turn) > Math.abs(obWeak.turn) + 0.2, `${f2(ob.turn)} v ${f2(obWeak.turn)}`)
const top = bowl('topspinner', 'legspin', { pitch: 'dusty', len: 5 })
const slider = bowl('slider', 'legspin', { pitch: 'dusty', len: 5 })
console.log(`   top-spinner at the crease ${top.creaseY.toFixed(2)} m, slider ${slider.creaseY.toFixed(2)} m`)
check('the slider skids on lower than the top-spinner', slider.creaseY < top.creaseY - 0.03)
const arm = bowl('armball', 'offspin', { pitch: 'dusty' })
check('the arm ball barely turns', Math.abs(arm.turn) < Math.abs(ob.turn) * 0.4, f2(arm.turn))
// Drift: an off-break drifts away in the air before it turns back.
const drift = ob.path[Math.floor(ob.path.length * 0.6)] - ob.path[0]
console.log(`   off-break sideways drift in the air ${f2(drift)} m`)

console.log('\n=== Release meter ===')
const green = bowl('seam', 'fast', { err: 0 })
const red = bowl('seam', 'fast', { err: -1.8 })
let spreadGreen = 0
let spreadRed = 0
for (let i = 0; i < 12; i++) {
  const frame = BatFrame.for(1, true)
  const env = makeEnv('flat', 'day', new V3())
  const g = releaseBall({ type: 'seam', style: 'fast', leftArm: false, around: false, target: frame.local(0.1, 6), speedKmh: 140, releaseError: 0, noBall: false }, 0, frame.off, 2, 0.8, env, new Rng(100 + i))
  const r = releaseBall({ type: 'seam', style: 'fast', leftArm: false, around: false, target: frame.local(0.1, 6), speedKmh: 140, releaseError: -1.8, noBall: false }, 0, frame.off, 2, 0.8, env, new Rng(100 + i))
  spreadGreen += Math.abs(frame.offsetOff(g.aimed) - 0.1)
  spreadRed += Math.abs(frame.offsetOff(r.aimed) - 0.1)
}
console.log(`   mean line error: green ${(spreadGreen / 12).toFixed(2)} m, early red ${(spreadRed / 12).toFixed(2)} m (${green.kmh.toFixed(0)} km/h aimed both)`)
check('early in the red the line strays', spreadRed > spreadGreen * 2.5)
void red

console.log('\n=== Fields ===')
for (const p of PRESET_ORDER) {
  for (const spin of [false, true]) {
    const spots = presetSpots(p, spin)
    const pp = enforce(spots, 2)
    const c = checkField(pp, 2)
    check(`${p}${spin ? ' (spin)' : ''}: 9 fielders, legal in the powerplay after enforcing`, spots.length === 9 && c.ok, c.problems.join('; ') || `${checkField(spots, 5).outside} out`)
  }
}
const silly = customSpots([[-150, 60], [-160, 62], [-120, 58], [-100, 60], [-60, 62], [-30, 66], [30, 66], [60, 62], [100, 60]])
const bad = checkField(silly, 2)
check('a custom field with 9 out and 4 behind square leg is flagged', !bad.ok && bad.outside === 9 && bad.behindSquareLeg === 4, bad.problems.join('; '))
const fixed = enforce(silly, 2)
check('enforcing it brings seven in and leaves two behind square', checkField(fixed, 2).ok, checkField(fixed, 2).problems.join('; '))
check('custom spots are named', customSpots([[162, 19], [95, 22], [-155, 60]]).slice(0, 3).map((x) => x.name).join(',') === '1st slip,Point,Fine leg')

console.log('\n=== Determinism (the online host and the replays rely on it) ===')
function run(seed: number) {
  const teams = builtInTeams()
  const d = new Director({ format: 'blitz', difficulty: 1, pitch: 'dusty', time: 'night', superOverOnTie: false, seed, teams: [cloneTeam(teams[1]), cloneTeam(teams[4])], online: false }, { sideHuman: [false, false] })
  for (let i = 0; i < 60 * 60 * 30 && d.phase !== 'end'; i++) d.update(1 / 60)
  return d.state.innings.map((x) => `${x.runs}/${x.wickets} ${x.log.map((b) => b.runs + b.extras + (b.wicket ? 'W' : '') + b.delivery[0]).join('')}`).join(' | ')
}
const a = run(77)
const b = run(77)
check('same seed, same match ball by ball', a === b && a.length > 20, a.slice(0, 60) + '…')

console.log(failures === 0 ? '\nAll delivery and field checks passed.' : `\n${failures} check(s) FAILED.`)
process.exitCode = failures === 0 ? 0 : 1
