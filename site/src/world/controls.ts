// Input for explore mode: keyboard, mouse/touch drag to look, and the on-screen joystick.
export const controls = {
  keys: new Set<string>(),
  /** Joystick vector from the HUD, each axis in [-1, 1]. */
  stick: { x: 0, y: 0 },
  run: false,
  jump: false,
  /** Accumulated look deltas in pixels, consumed by the camera each frame. */
  look: { x: 0, y: 0 },
  /** A spell cast was requested (quick click or the cast key); consumed per frame. */
  cast: false,
}

let attached = false

export function attachControls() {
  if (attached) return () => {}
  attached = true
  const down = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
    controls.keys.add(e.code)
    if (e.code === 'Space') {
      controls.jump = true
      e.preventDefault()
    }
    if (e.code === 'KeyF') controls.cast = true
    if (e.code.startsWith('Arrow')) e.preventDefault()
  }
  const up = (e: KeyboardEvent) => controls.keys.delete(e.code)
  const blur = () => controls.keys.clear()

  let dragging = false
  let last = { x: 0, y: 0 }
  let start = { x: 0, y: 0 }
  let moved = 0
  const pd = (e: PointerEvent) => {
    const t = e.target as HTMLElement
    // Ignore presses on HUD buttons/links so casting only happens over the world.
    if (!t.closest('canvas') || t.closest('button, a, .play-hud .prompt, .play-hud .objective')) return
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
      // A near-stationary click (not a drag-to-look) casts a spell.
      if (moved < 6) controls.cast = true
    }
    dragging = false
  }

  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  window.addEventListener('pointerdown', pd)
  window.addEventListener('pointermove', pm)
  window.addEventListener('pointerup', pu)
  return () => {
    attached = false
    controls.keys.clear()
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
    window.removeEventListener('pointerdown', pd)
    window.removeEventListener('pointermove', pm)
    window.removeEventListener('pointerup', pu)
  }
}

export function moveAxes() {
  const k = controls.keys
  let x = controls.stick.x, y = controls.stick.y
  if (k.has('KeyW') || k.has('ArrowUp')) y += 1
  if (k.has('KeyS') || k.has('ArrowDown')) y -= 1
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1
  const len = Math.hypot(x, y)
  if (len > 1) {
    x /= len
    y /= len
  }
  return { x, y, run: controls.run || k.has('ShiftLeft') || k.has('ShiftRight') }
}
