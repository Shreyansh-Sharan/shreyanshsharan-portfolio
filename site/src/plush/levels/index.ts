// The level registry. To add a level: write levels/<id>.ts exporting `defineLevel({...})` and add it to LEVELS.
// The Show planner draws rounds from this list by type; Quick Play lists every non-hub level.
import type { AnyLevel } from '../engine/types'
import loft from './loft'
import cookieCutter from './cookie-cutter'
import musicBox from './music-box'
import topSumo from './top-sumo'
import sockDrawer from './sock-drawer'
import bookshelf from './bookshelf'
import trainSet from './train-set'
import duckRapids from './duck-rapids'
import pinball from './pinball'
import conveyor from './conveyor'
import hamster from './hamster'

export const LEVELS: AnyLevel[] = [loft, musicBox, cookieCutter, topSumo, sockDrawer, bookshelf, trainSet, duckRapids, pinball, conveyor, hamster]

export function levelById(id: string): AnyLevel | undefined {
  return LEVELS.find((l) => l.id === id)
}

/** Levels you can pick in Quick Play (everything except the hub and hidden Loft games). */
export function quickPlayLevels() {
  return LEVELS.filter((l) => l.type !== 'hub' && l.type !== 'hidden')
}
