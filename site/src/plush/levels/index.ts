// The level registry. To add a level: write levels/<id>.ts exporting `defineLevel({...})` and add it to LEVELS.
// The Show planner draws rounds from this list by type; Quick Play lists every non-hub level.
import type { AnyLevel } from '../engine/types'
import loft from './loft'
import cookieCutter from './cookie-cutter'
import musicBox from './music-box'
import topSumo from './top-sumo'
import yarnTug from './yarn-tug'
import pillowFort from './pillow-fort'
import tidyUp from './tidy-up'
import sockHoops from './sock-hoops'
import eggHunt from './egg-hunt'

export const LEVELS: AnyLevel[] = [loft, musicBox, cookieCutter, topSumo, yarnTug, pillowFort, tidyUp, sockHoops, eggHunt]

export function levelById(id: string): AnyLevel | undefined {
  return LEVELS.find((l) => l.id === id)
}

/** Levels you can pick in Quick Play (everything except the hub and hidden Loft games). */
export function quickPlayLevels() {
  return LEVELS.filter((l) => l.type !== 'hub' && l.type !== 'hidden')
}
