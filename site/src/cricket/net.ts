// Online 1v1 over the site's peer-to-peer transport (PeerJS rooms, or BroadcastChannel tabs with `?net=local`).
// The host's browser runs the match director and streams snapshots 20 times a second (and the full scorecard when it
// changes); the guest sends its commands, timing its own shots against its own copy of the released ball.
import type { Game } from './game'
import type { Link } from '../racer/net'
import type { Command, GameEvent, Phase, Pose } from './sim/director'
import { cloneBall, step, DT } from './sim/ball'
import { BatFrame } from './sim/geo'
import type { MatchSetup, MatchState } from './sim/match'
import { V3 } from './sim/vec'
import type { DeliveryType } from './sim/delivery'
import type { FieldPreset } from './sim/fields'
import type { ReviewInfo } from './sim/director'
import type { Team } from './sim/teams'

export { hostRoom, joinRoom, type Link } from '../racer/net'

export interface CricketNet {
  link: Link
  role: 'host' | 'client'
}

export type CricketMsg =
  | { t: 'c-hello'; team: Team }
  | { t: 'c-lobby'; hostTeam: string; guestTeam: string; format: string; pitch: string; time: string }
  | { t: 'c-start'; setup: MatchSetup }
  | { t: 'c-cmd'; c: Command }
  | { t: 'c-snap'; s: Snap; e: GameEvent[]; st?: unknown }
  | { t: 'c-ball'; b: unknown; type: DeliveryType; fr: [number, boolean] }
  | { t: 'c-bye' }

export function isCricketMsg(m: unknown): m is CricketMsg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string' && (m as { t: string }).t.startsWith('c-')
}

interface Snap {
  ph: Phase
  pt: number
  a: number[][]
  v: string[]
  b: number[]
  bid: number
  m: number[] // marker x z, meter value, green, half, running
  dl: DeliveryType
  ar: boolean
  pr: FieldPreset
  ban: [string, number]
  toss: [number, number, number]
  rw: [boolean, number, number]
  rv: ReviewInfo
  fr: [number, boolean]
  kmh: number
  tim: [string, number, string]
}

const POSES: Pose[] = ['hidden', 'idle', 'walk', 'run', 'stance', 'shot', 'slide', 'batslide', 'runup', 'deliver', 'follow', 'keeper', 'keepertake', 'ready', 'dive', 'catch', 'pickup', 'throw', 'celebrate', 'appeal', 'dejected', 'umpire', 'signal', 'leave', 'hit', 'getup']
const r2 = (v: number) => Math.round(v * 100) / 100

/** Wires a running game to the link: host streams, guest mirrors. Returns a cleanup function. */
export function attachNet(game: Game, net: CricketNet): () => void {
  const d = game.director
  const link = net.link
  const unsub: (() => void)[] = []
  if (net.role === 'host') {
    let version = -1
    let pending: GameEvent[] = []
    const prevOnEvent = game.onEvent
    game.onEvent = (e) => {
      prevOnEvent?.(e)
      if (e.type !== 'phase') pending.push(e)
      if (e.type === 'release') link.send({ t: 'c-ball', b: d.ball, type: d.plan.type, fr: [d.state.current.strikerEnd, !d.battingTeam.players[d.state.current.striker].leftBat] } satisfies CricketMsg)
    }
    const timer = window.setInterval(() => {
      const s: Snap = {
        ph: d.phase,
        pt: r2(d.phaseTime),
        a: d.actors.map((a) => [r2(a.pos.x), r2(a.pos.z), Math.round(a.yaw), POSES.indexOf(a.pose), r2(a.poseTime), Math.round(a.aim), a.loft ? 1 : 0, ['auto', 'front', 'back', 'charge'].indexOf(a.feet), a.hasBall ? 1 : 0, a.visible ? 1 : 0, a.left ? 1 : 0, r2(a.vel.x), r2(a.vel.z), a.player, a.kind === 'keeper' ? 1 : a.kind === 'bowler' ? 2 : a.kind === 'umpire' ? 3 : 0]),
        v: d.actors.map((a) => a.variant),
        b: [r2(d.ball.pos.x * 10) / 10, r2(d.ball.pos.y * 10) / 10, r2(d.ball.pos.z * 10) / 10, d.ballVisible ? 1 : 0, r2(d.ball.time)],
        bid: d.ballId,
        m: [r2(d.marker.x), r2(d.marker.z), r2(d.meterValue), d.meterGreen, r2(d.meterHalfWidth), d.meterRunning ? 1 : 0],
        dl: d.selectedDelivery,
        ar: d.around,
        pr: d.preset,
        ban: [d.banner, r2(d.bannerTime)],
        toss: [d.tossCall, d.tossResult, d.state.tossWinner],
        rw: [d.reviewWindowOpen, d.reviewSide, r2(d.reviewCountdown)],
        rv: d.review,
        fr: [d.state.current?.strikerEnd ?? 1, d.state.current ? !d.battingTeam.players[d.state.current.striker].leftBat : true],
        kmh: Math.round(d.lastKmh),
        tim: [d.lastTiming, r2(d.lastTimingError), d.lastShotNote],
      }
      const msg: CricketMsg = { t: 'c-snap', s, e: pending }
      if (d.version !== version) {
        version = d.version
        msg.st = serializeState(d.state)
      }
      pending = []
      link.send(msg)
    }, 50)
    unsub.push(() => window.clearInterval(timer))
    unsub.push(
      link.onMessage((m) => {
        if (!isCricketMsg(m)) return
        if (m.t === 'c-cmd') d.submit({ ...m.c, side: 1 } as Command)
      }),
    )
  } else {
    // Guest: everything comes from the host.
    game.sendCommand = (c) => link.send({ t: 'c-cmd', c } satisfies CricketMsg)
    let local: ReturnType<typeof cloneBall> | null = null
    let localT = 0
    unsub.push(
      link.onMessage((m) => {
        if (!isCricketMsg(m)) return
        if (m.t === 'c-ball') {
          const b = m.b as ReturnType<typeof cloneBall>
          local = cloneBall({ ...b, pos: V3.from([b.pos.x, b.pos.y, b.pos.z]), vel: V3.from([b.vel.x, b.vel.y, b.vel.z]), spin: V3.from([b.spin.x, b.spin.y, b.spin.z]), swingDir: V3.from([b.swingDir.x, b.swingDir.y, b.swingDir.z]), firstBounce: new V3() })
          d.frame = BatFrame.for(m.fr[0], m.fr[1])
          d.plan.type = m.type
          d.ball = cloneBall(local)
          d.mirrorPredict()
          localT = 0
        } else if (m.t === 'c-snap') applySnap(game, m.s, m.st)
        for (const e of m.t === 'c-snap' ? m.e : []) d.raise(e)
      }),
    )
    // Advance the guest's own copy of the delivery so shots are timed against what is on screen.
    const timer = window.setInterval(() => {
      if (!local || d.phase !== 'flight') return
      const target = localT + 0.016
      while (local.time < target) step(local, d.env, DT)
      localT = target
      d.ball.time = local.time
      d.ball.pos = local.pos.clone()
    }, 16)
    unsub.push(() => window.clearInterval(timer))
  }
  unsub.push(
    link.onPeer((ev, id) => {
      if (ev === 'leave' && (net.role === 'host' || id === 'host')) d.raise({ type: 'banner', text: 'Your opponent left the match', f: 4 })
    }),
  )
  return () => unsub.forEach((u) => u())
}

function serializeState(st: MatchState) {
  return { innings: st.innings, tossWinner: st.tossWinner, tossWinnerBats: st.tossWinnerBats, finished: st.finished, winner: st.winner, result: st.result, superOvers: st.superOvers }
}

function applySnap(game: Game, s: Snap, st: unknown) {
  const d = game.director
  if (st) Object.assign(d.state, st as object)
  if (d.phase !== s.ph) d.raise({ type: 'phase', text: s.ph })
  d.phase = s.ph
  d.phaseTime = s.pt
  s.a.forEach((row, i) => {
    const a = d.actors[i]
    a.pos.set(row[0], 0, row[1])
    a.yaw = row[2]
    a.pose = POSES[row[3]] ?? 'idle'
    a.poseTime = row[4]
    a.aim = row[5]
    a.loft = row[6] > 0
    a.feet = (['auto', 'front', 'back', 'charge'] as const)[row[7]] ?? 'auto'
    a.hasBall = row[8] > 0
    a.visible = row[9] > 0
    a.left = row[10] > 0
    a.vel.set(row[11], 0, row[12])
    a.player = row[13]
    a.kind = i === 0 ? 'striker' : i === 1 ? 'nonstriker' : row[14] === 1 ? 'keeper' : row[14] === 2 ? 'bowler' : row[14] === 3 ? 'umpire' : 'fielder'
    a.variant = s.v[i] ?? ''
    a.team = i < 2 ? (d.state.current?.battingTeam ?? 0) : i >= 13 ? -1 : 1 - (d.state.current?.battingTeam ?? 0)
  })
  if (s.ph !== 'flight') d.ball.pos.set(s.b[0], s.b[1], s.b[2])
  d.ballVisible = s.b[3] > 0
  d.ballId = s.bid
  d.marker.set(s.m[0], 0, s.m[1])
  d.meterValue = s.m[2]
  d.meterGreen = s.m[3]
  d.meterHalfWidth = s.m[4]
  d.meterRunning = s.m[5] > 0
  d.selectedDelivery = s.dl
  d.around = s.ar
  d.preset = s.pr
  d.banner = s.ban[0]
  d.bannerTime = s.ban[1]
  d.tossCall = s.toss[0]
  d.tossResult = s.toss[1]
  d.state.tossWinner = s.toss[2]
  d.reviewWindowOpen = s.rw[0]
  d.reviewSide = s.rw[1]
  d.reviewDeadline = d.phaseTime + s.rw[2]
  d.review = s.rv
  d.lastKmh = s.kmh
  d.lastTiming = s.tim[0] as typeof d.lastTiming
  d.lastTimingError = s.tim[1]
  d.lastShotNote = s.tim[2]
  if (d.state.current) d.frame = BatFrame.for(s.fr[0], s.fr[1])
}
