// Text commentary generated from what happened (no text packs to load). All names are the fictional players'.
import type { ShotResult } from './shots.ts'
import type { BallOutcome, ExtraType, MatchState } from './match.ts'
import { scoreText } from './match.ts'
import type { Rng } from './vec.ts'

const pick = (rng: Rng, ...lines: string[]) => lines[rng.int(0, lines.length)]

export function shotWord(s: ShotResult) {
  switch (s.shot) {
    case 'drive':
      return s.direction > 60 ? 'square drive' : s.direction > 25 ? 'cover drive' : s.direction < -10 ? 'on-drive' : 'straight drive'
    case 'cut':
      return s.direction > 125 ? 'late cut' : 'cut'
    case 'pull':
      return s.direction < -120 ? 'hook' : 'pull'
    case 'sweep':
      return 'sweep'
    case 'flick':
      return s.direction < -100 ? 'glance' : 'flick'
    default:
      return 'shot'
  }
}

export const C = {
  four(batter: string, shot: ShotResult, rng: Rng) {
    if (shot.contact === 'edge') return pick(rng, `Edged and four! ${batter} gets away with that through the vacant slip area.`, `Off the edge, past the keeper, four. Lucky ${batter}.`)
    const w = shotWord(shot)
    return pick(
      rng,
      `FOUR! A glorious ${w} from ${batter}, the fielder had no chance.`,
      `Beautifully timed! ${batter} threads the ${w} into the gap for four.`,
      `Crack! That's raced away to the rope. ${batter} is seeing it like a beach ball.`,
      `Four more! Pierces the field with a crisp ${w}.`,
      `That's a stroke of the highest class. ${w[0].toUpperCase() + w.slice(1)}, four.`,
    )
  },
  six(batter: string, rng: Rng) {
    return pick(rng, `SIX! ${batter} has launched that into the crowd!`, `That is huge! ${batter} clears the rope with ease.`, `Up, up and away! Maximum for ${batter}.`, `Oh my word, that's gone all the way. Six!`, `Into the second tier! ${batter} means business.`)
  },
  wide(rng: Rng) {
    return pick(rng, 'Wide, called by the umpire. Strayed too far.', "That's a wide. Extra run to the total.", 'Down the leg side and signalled wide.')
  },
  runs(runs: number, extra: ExtraType, batter: string, rng: Rng) {
    if (extra === 'bye') return `${runs} bye${runs > 1 ? 's' : ''}, the keeper couldn't gather it.`
    if (extra === 'legbye') return `${runs} leg bye${runs > 1 ? 's' : ''} off the pads.`
    if (extra === 'wide') return `Wide, and they scamper ${runs} more.`
    if (extra === 'noball') return `No-ball, and ${runs} more to the total.`
    switch (runs) {
      case 1:
        return pick(rng, `Worked away for a single by ${batter}.`, 'Quick single, good running.', 'Pushed into the gap, they take one.', 'Dabbed down and they scurry through.')
      case 2:
        return pick(rng, 'Placed into the gap and they come back for two.', `Two runs, excellent running from ${batter} and his partner.`, 'Hard running, they turn the one into two.')
      case 3:
        return 'Three runs! Chased down just inside the rope.'
      default:
        return `${runs} runs, all run!`
    }
  },
  dot(shot: ShotResult, batter: string, rng: Rng) {
    if (shot.contact === 'miss') return pick(rng, `Beaten! Past the outside edge, ${batter} had a waft at that.`, 'Played and missed. Lovely delivery.', 'Whistles past the edge. So close.')
    if (shot.shot === 'leave') return pick(rng, `${batter} shoulders arms and lets that go.`, 'Left alone outside off. Good judgement.')
    if (shot.shot === 'defend') return pick(rng, 'Solid in defence, straight back to the bowler.', 'Dead bat, no run.', `${batter} gets right behind that one.`)
    return pick(rng, 'Straight to the fielder, no run.', 'Good fielding saves a run there.', 'Dot ball. Pressure building.')
  },
  drop(fielder: string, rng: Rng) {
    return pick(rng, `Dropped! ${fielder} put that down. That could be costly.`, `Oh, a chance goes down! ${fielder} couldn't hold on.`, 'Put down! Should have been taken.')
  },
  wicket(o: BallOutcome, edged: boolean, batter: string, bowler: string, fielder: string, rng: Rng) {
    switch (o.how) {
      case 'bowled':
        return pick(rng, `BOWLED HIM! ${bowler} knocks back the stumps and ${batter} has to go.`, `Timber! The bails are flying and ${batter} is bowled.`, `Through the gate! ${bowler} cleans up ${batter}.`)
      case 'caught':
        if (edged) return pick(rng, `Edged and taken! ${bowler} gets his man, ${batter} caught by ${fielder}.`, `Nicked off! A thin edge and ${fielder} holds it. ${batter} departs.`)
        return pick(rng, `Caught! ${batter} picks out ${fielder} and ${bowler} strikes.`, `In the air... and taken by ${fielder}! ${batter} has to walk.`, `Holds on! A fine catch from ${fielder} and a big wicket.`)
      case 'lbw':
        return pick(rng, `Trapped in front! ${batter} is LBW to ${bowler}.`, `Up goes the finger, plumb LBW. ${batter} is gone.`)
      case 'stumped':
        return `Stumped! ${batter} was miles out of his ground and ${fielder} whips the bails off.`
      case 'runout':
        return pick(rng, `Run out! A terrible mix-up and ${fielder} makes them pay.`, `Short of his ground. Run out by ${fielder}!`)
      case 'hitwicket':
        return `Hit wicket! ${batter} has knocked his own stumps over.`
      default:
        return `${batter} is out.`
    }
  },
  endOfOver(st: MatchState) {
    const inn = st.current
    const overs = Math.floor(inn.legalBalls / 6)
    const score = `${st.batting.name} ${scoreText(inn)} after ${overs} over${overs === 1 ? '' : 's'}`
    if (inn.target > 0) return `End of the over: ${score}. They need ${st.runsNeeded} from ${st.ballsLeft} balls.`
    return `End of the over: ${score}, run rate ${((inn.runs * 6) / Math.max(1, inn.legalBalls)).toFixed(2)}.`
  },
  release(name: string, kmh: number, spin: boolean, rng: Rng) {
    if (spin) return pick(rng, `${name} gives it some air...`, `${name} tosses it up...`, `Flighted by ${name}...`)
    return kmh > 145 ? pick(rng, `${name} steams in... ${Math.round(kmh)} km/h!`, `Rapid from ${name}, ${Math.round(kmh)} on the gun.`) : ''
  },
}
