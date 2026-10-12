// Input for explore mode: keyboard, mouse/touch drag to look, the on-screen joystick and buttons, and a gamepad.
export const controls = {
  keys: new Set<string>(),
  /** Joystick vector from the HUD, each axis in [-1, 1]. */
  stick: { x: 0, y: 0 },
  run: false,
  jump: false,
  /** Accumulated look deltas in pixels, consumed by the camera each frame. */
  look: { x: 0, y: 0 },
  /** A spell cast was requested (the cast key); consumed per frame. */
  cast: false,
  /** A melee attack was requested (quick click, J, gamepad B); consumed per frame. */
  attack: false,
  /** The spin attack was requested directly (Q, gamepad Y). */
  spin: false,
  /** Take off / land was requested (double-tap Space, X, gamepad LB). */
  fly: false,
  /** Ascend / descend held while flying (Space / Ctrl or C, or the touch buttons). */
  up: false,
  down: false,
  /** Gamepad left stick and run trigger, refreshed by pollPad(). */
  pad: { x: 0, y: 0, run: false, up: false, down: false },
  /** The mouse is captured by the world (pointer lock): moving it looks around, Esc frees it. */
  locked: false,
}

let attached = false
let lastSpace = 0

export function attachControls() {
  if (attached) return () => {}
  attached = true
  const down = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    controls.keys.add(e.code)
    if (e.code === 'Space') {
      e.preventDefault()
      if (!e.repeat) {
        controls.jump = true
        // A quick second tap takes off.
        const now = performance.now()
        if (now - lastSpace < 320) controls.fly = true
        lastSpace = now
      }
    }
    if (e.repeat) return
    if (e.code === 'KeyF') controls.cast = true
    if (e.code === 'KeyJ') controls.attack = true
    if (e.code === 'KeyQ') controls.spin = true
    if (e.code === 'KeyX') controls.fly = true
    if (e.code.startsWith('Arrow')) e.preventDefault()
  }
  const up = (e: KeyboardEvent) => controls.keys.delete(e.code)
  const blur = () => controls.keys.clear()

  // Mouse: the first click over the world captures the pointer (like a desktop game); from then on moving the
  // mouse looks around with no feedback from the character, left click attacks and right click casts. Esc
  // releases it. Touch and pen keep drag-to-look.
  let dragging = false
  let last = { x: 0, y: 0 }
  let start = { x: 0, y: 0 }
  let moved = 0
  const overWorld = (t: HTMLElement | null) => !!t && !!t.closest('canvas') && !t.closest('button, a, .play-hud .prompt, .play-hud .objective')
  const pd = (e: PointerEvent) => {
    const t = e.target as HTMLElement | null
    if (!overWorld(t)) return
    if (e.pointerType === 'mouse') {
      if (controls.locked) {
        if (e.button === 2) controls.cast = true
        else if (e.button === 0) controls.attack = true
      } else {
        const canvas = t!.closest('canvas') as HTMLCanvasElement
        canvas.requestPointerLock?.()
      }
      return
    }
    dragging = true
    last = { x: e.clientX, y: e.clientY }
    start = { x: e.clientX, y: e.clientY }
    moved = 0
  }
  const pm = (e: PointerEvent) => {
    if (!dragging) return
    controls.look.x += e.clientX - last.x
    controls.look.y += e.clientY - last.y
    last = { x: e.clientX, y: e.clientY }
  }
  const pu = (e: PointerEvent) => {
    if (dragging) {
      moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      // A near-stationary tap (not a drag-to-look) attacks.
      if (moved < 6) controls.attack = true
    }
    dragging = false
  }
  const mm = (e: MouseEvent) => {
    if (!controls.locked) return
    // Captured mouse: relative movement, scaled down a little against the drag sensitivity.
    controls.look.x += e.movementX * 0.65
    controls.look.y += e.movementY * 0.65
  }
  const lockChange = () => {
    controls.locked = !!document.pointerLockElement
    controls.look.x = controls.look.y = 0
  }
  const menu = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('canvas')) e.preventDefault()
  }

  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  window.addEventListener('pointerdown', pd)
  window.addEventListener('pointermove', pm)
  window.addEventListener('pointerup', pu)
  window.addEventListener('mousemove', mm)
  document.addEventListener('pointerlockchange', lockChange)
  window.addEventListener('contextmenu', menu)
  return () => {
    attached = false
    controls.keys.clear()
    controls.locked = false
    if (document.pointerLockElement) document.exitPointerLock()
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
    window.removeEventListener('pointerdown', pd)
    window.removeEventListener('pointermove', pm)
    window.removeEventListener('pointerup', pu)
    window.removeEventListener('mousemove', mm)
    document.removeEventListener('pointerlockchange', lockChange)
    window.removeEventListener('contextmenu', menu)
  }
}

const prevButtons: boolean[] = []

/** Read the first gamepad (if any): stick and held buttons into `controls.pad`, presses into the one-shot flags. */
export function pollPad() {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null
  const gp = pads ? Array.from(pads).find(Boolean) : null
  const pad = controls.pad
  if (!gp) {
    pad.x = pad.y = 0
    pad.run = pad.up = pad.down = false
    return
  }
  const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
  pad.x = dz(gp.axes[0] ?? 0)
  pad.y = -dz(gp.axes[1] ?? 0)
  controls.look.x += dz(gp.axes[2] ?? 0) * 9
  controls.look.y += dz(gp.axes[3] ?? 0) * 6
  const held = (i: number) => !!gp.buttons[i]?.pressed
  const pressed = (i: number) => {
    const now = held(i)
    const was = prevButtons[i] ?? false
    prevButtons[i] = now
    return now && !was
  }
  pad.run = held(7) || held(10) // RT or left-stick click
  pad.up = held(0)
  pad.down = held(6) // LT
  if (pressed(0)) controls.jump = true // A
  if (pressed(2)) controls.attack = true // X
  if (pressed(1)) controls.cast = true // B
  if (pressed(3)) controls.spin = true // Y
  if (pressed(4) || pressed(5)) controls.fly = true // bumpers
}

export function moveAxes() {
  const k = controls.keys
  let x = controls.stick.x + controls.pad.x, y = controls.stick.y + controls.pad.y
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1
  if (k.has('KeyS') || k.has('ArrowDown')) y -= 1
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1
  const len = Math.hypot(x, y)
  if (len > 1) {
    x /= len
    y /= len
  }
  return { x, y, run: controls.run || controls.pad.run || k.has('ShiftLeft') || k.has('ShiftRight') }
}

/** Vertical input while flying: +1 up, -1 down, 0 hover. */
export function flyAxis() {
  const k = controls.keys
  const up = controls.up || controls.pad.up || k.has('Space')
  const down = controls.down || controls.pad.down || k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC')
  return (up ? 1 : 0) - (down ? 1 : 0)
}
