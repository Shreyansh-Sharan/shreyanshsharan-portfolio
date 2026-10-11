// Shared state for the profile stroll: the page writes where the visitor has scrolled, the 3D stage reads it every
// frame (a plain mutable object, so scrolling never re-renders the canvas).

export type Move = 'idle' | 'walk' | 'run' | 'jump' | 'spell' | 'wave' | 'swing' | 'dance' | 'flip' | 'cheer' | 'talk'

export interface District {
  id: string
  /** Section heading. */
  chapter: string
  /** Where the walk has got to. */
  place: string
  img: string
  /** Which side of the screen the character stands on; the text sits on the other side. */
  side: -1 | 1
  /** The move he does when the section settles, and what he does between repeats. */
  move: Move
  rest: Move
  // Street colours for the district.
  road: string
  walk: string
  line: string
  lamp: string
  fog: string
  key: string
}

export const DISTRICTS: District[] = [
  {
    id: 'overview',
    chapter: 'Overview',
    place: 'Home Street',
    img: 'home',
    side: -1,
    move: 'walk',
    rest: 'walk',
    road: '#5b616c',
    walk: '#a9b1bb',
    line: '#f6f6f2',
    lamp: '#ffe2a0',
    fog: '#cfe2f2',
    key: '#fff3dc',
  },
  {
    id: 'experience',
    chapter: 'Experience',
    place: 'Business District',
    img: 'business',
    side: 1,
    move: 'spell',
    rest: 'talk',
    road: '#4c5763',
    walk: '#9fb3c4',
    line: '#e6f3ff',
    lamp: '#bfe4ff',
    fog: '#b9dcf2',
    key: '#ffffff',
  },
  {
    id: 'skills',
    chapter: 'Skill tree',
    place: 'Neon Quarter',
    img: 'neon',
    side: -1,
    move: 'flip',
    rest: 'idle',
    road: '#251a40',
    walk: '#3f2d66',
    line: '#ff4fd8',
    lamp: '#38e8ff',
    fog: '#3b2168',
    key: '#d4c4ff',
  },
  {
    id: 'trophies',
    chapter: 'Trophies',
    place: 'Trophy Plaza',
    img: 'stadium',
    side: 1,
    move: 'cheer',
    rest: 'idle',
    road: '#1d2754',
    walk: '#33427e',
    line: '#ffd257',
    lamp: '#ffd257',
    fog: '#1a2558',
    key: '#eef2ff',
  },
  {
    id: 'finale',
    chapter: 'Off the clock',
    place: 'Seaside Boardwalk',
    img: 'boardwalk',
    side: -1,
    move: 'dance',
    rest: 'dance',
    road: '#8c5b3b',
    walk: '#b98058',
    line: '#ffd9a8',
    lamp: '#ffcf7a',
    fog: '#f0a06a',
    key: '#ffe0bf',
  },
]

export const stroll = {
  /** Section the middle of the screen is in. */
  active: 0,
  /** When the visitor last scrolled (ms, performance.now()). */
  lastScroll: -1e9,
  /** A move asked for from the page (the "surprise me" button). */
  request: null as Move | null,
  /** How fast the street is sliding under him (m/s); written by the walker, read by the street. */
  speed: 0,
  /** Where he is across the street. */
  x: 0,
  /** Bumped when he cheers, to throw confetti. */
  burst: 0,
}

export function reset() {
  stroll.active = 0
  stroll.lastScroll = -1e9
  stroll.request = null
  stroll.speed = 0
  stroll.burst = 0
}

/** Scrolling counts as walking for a moment after each scroll event. */
export function isScrolling() {
  return performance.now() - stroll.lastScroll < 350
}
