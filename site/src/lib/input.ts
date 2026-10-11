// Unified keyboard + gamepad input. Screens push a handler; only the top-most one receives actions.
import { useEffect, useRef } from 'react'

export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'prevTab' | 'nextTab'
type Handler = (action: Action) => boolean | void

const stack: { current: Handler }[] = []

let suspended = false

/** While exploring the 3D world, menu navigation is switched off. */
export function setInputSuspended(value: boolean) {
  suspended = value
}

function dispatch(action: Action): boolean {
  if (suspended) return false
  const top = stack[stack.length - 1]
  return top ? top.current(action) !== false : false
}

const KEYS: Record<string, Action> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  q: 'prevTab',
  e: 'nextTab',
}

let started = false

function start() {
  if (started) return
  started = true

  window.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return
    const target = ev.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    const action = KEYS[ev.key] ?? KEYS[ev.key.toLowerCase()]
    if (!action) return
    // Let Enter on a focused button or link fall through to the native click instead of firing twice.
    if (action === 'confirm' && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) return
    if (dispatch(action)) ev.preventDefault()
  })

  // Gamepad: standard mapping. 0 = bottom face button, 1 = right face button, 4/5 = shoulders, 12–15 = d-pad.
  const BUTTONS: [number, Action][] = [
    [12, 'up'],
    [13, 'down'],
    [14, 'left'],
    [15, 'right'],
    [0, 'confirm'],
    [1, 'back'],
    [4, 'prevTab'],
    [5, 'nextTab'],
  ]
  const held = new Map<Action, number>()
  let polling = false

  const poll = (now: number) => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    const pad = Array.from(pads).find(Boolean)
    if (!pad) {
      polling = false
      held.clear()
      return
    }
    const pressed = new Set<Action>()
    for (const [i, a] of BUTTONS) if (pad.buttons[i]?.pressed) pressed.add(a)
    const [x = 0, y = 0] = pad.axes
    if (x < -0.5) pressed.add('left')
    if (x > 0.5) pressed.add('right')
    if (y < -0.5) pressed.add('up')
    if (y > 0.5) pressed.add('down')

    for (const a of pressed) {
      const since = held.get(a)
      const repeatable = a !== 'confirm' && a !== 'back'
      if (since === undefined) {
        held.set(a, now)
        dispatch(a)
      } else if (repeatable && now - since > 380) {
        held.set(a, now - 260) // repeat roughly every 120ms while held
        dispatch(a)
      }
    }
    for (const a of [...held.keys()]) if (!pressed.has(a)) held.delete(a)
    requestAnimationFrame(poll)
  }

  const startPolling = () => {
    if (polling) return
    polling = true
    requestAnimationFrame(poll)
  }
  window.addEventListener('gamepadconnected', startPolling)
  if (navigator.getGamepads && Array.from(navigator.getGamepads()).some(Boolean)) startPolling()
}

/** Subscribe the calling screen to input actions while `active` is true. Return false to leave an action unhandled. */
export function useActions(handler: Handler, active = true) {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!active) return
    start()
    const entry = { current: ((a: Action) => ref.current(a)) as Handler }
    stack.push(entry)
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
