// First-person input: pointer-lock mouse look + WASD, a gamepad, and twin virtual sticks plus buttons on touch
// screens (fed by the HUD). One frame of input per render; the game turns it into a sim Input.

export interface InputFrame {
  mx: number
  mz: number
  /** Look deltas this frame (radians). */
  dyaw: number
  dpitch: number
  jump: boolean
  sprint: boolean
  crouch: boolean
  /** Edge-triggered. */
  light: boolean
  heavy: boolean
  throw: boolean
  use: boolean
  ladder: boolean
  ult: boolean
  emote: boolean
  slot: number
  /** Held. */
  block: boolean
  attackHeld: boolean
  touch: boolean
  pad: boolean
  locked: boolean
}

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'KeyF', 'KeyG', 'KeyC', 'KeyB', 'KeyR', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Tab']

export class LawnInput {
  enabled = true
  onGesture: (() => void) | null = null
  /** Mouse sensitivity (radians per pixel). */
  sensitivity = 0.0022
  invertY = false
  private el: HTMLElement
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private mouseDown = [false, false, false]
  private mouseHit = [false, false, false]
  private heldSince = 0
  private dx = 0
  private dy = 0
  private padPrev: boolean[] = []
  private padUsed = false
  private touchMoveV = { x: 0, z: 0 }
  private touchLookV = { x: 0, y: 0 }
  private touchHeld = new Set<string>()
  private touchPressed = new Set<string>()
  private isTouch = false
  private slot = 0
  private frame: InputFrame = { mx: 0, mz: 0, dyaw: 0, dpitch: 0, jump: false, sprint: false, crouch: false, light: false, heavy: false, throw: false, use: false, ladder: false, ult: false, emote: false, slot: 0, block: false, attackHeld: false, touch: false, pad: false, locked: false }
  private wantLock = false

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    el.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('mousemove', this.onMouseMove)
    el.addEventListener('contextmenu', this.onContext)
    document.addEventListener('pointerlockchange', this.onLockChange)
    this.isTouch = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    this.el.removeEventListener('contextmenu', this.onContext)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    if (document.pointerLockElement === this.el) document.exitPointerLock()
  }

  get locked() {
    return document.pointerLockElement === this.el
  }

  /** Ask for pointer lock (must come from a user gesture). */
  lock() {
    if (this.isTouch) return
    this.wantLock = true
    try {
      const r = this.el.requestPointerLock({ unadjustedMovement: true } as unknown as PointerLockOptions) as unknown as Promise<void> | undefined
      if (r && typeof r.catch === 'function') r.catch(() => this.el.requestPointerLock())
    } catch {
      try {
        this.el.requestPointerLock()
      } catch {
        // Not available (iframe policy): keyboard-only look still works.
      }
    }
  }

  unlock() {
    this.wantLock = false
    if (document.pointerLockElement === this.el) document.exitPointerLock()
  }

  /* ---------- Touch API (from the HUD) ---------- */

  touchMove(x: number, z: number) {
    this.isTouch = true
    this.touchMoveV.x = x
    this.touchMoveV.z = z
  }

  touchLook(dx: number, dy: number) {
    this.isTouch = true
    this.touchLookV.x += dx
    this.touchLookV.y += dy
  }

  touchButton(name: string, down: boolean) {
    this.isTouch = true
    this.onGesture?.()
    if (down) {
      if (!this.touchHeld.has(name)) this.touchPressed.add(name)
      this.touchHeld.add(name)
    } else this.touchHeld.delete(name)
  }

  get isTouchDevice() {
    return this.isTouch
  }

  /** Programmatic input (tests). */
  key(code: string, down: boolean) {
    if (down) {
      if (!this.keys.has(code)) this.pressed.add(code)
      this.keys.add(code)
    } else this.keys.delete(code)
  }

  look(dx: number, dy: number) {
    this.dx += dx
    this.dy += dy
  }

  mouse(button: number, down: boolean) {
    if (down && !this.mouseDown[button]) {
      this.mouseHit[button] = true
      if (button === 0) this.heldSince = performance.now()
    }
    this.mouseDown[button] = down
  }

  setSlot(n: number) {
    this.slot = n
  }

  /* ---------- Events ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (KEYS.includes(e.code)) e.preventDefault()
    this.onGesture?.()
    if (e.repeat) return
    if (!this.keys.has(e.code)) this.pressed.add(e.code)
    this.keys.add(e.code)
    if (e.code.startsWith('Digit')) this.slot = Math.max(0, Math.min(3, Number(e.code.slice(5)) - 1))
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    this.mouseDown = [false, false, false]
    this.touchHeld.clear()
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return
    this.onGesture?.()
    if (e.pointerType === 'touch') {
      this.isTouch = true
      return
    }
    if (!this.locked && !this.isTouch) {
      this.lock()
      return
    }
    this.mouse(e.button, true)
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    this.mouseDown[e.button] = false
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return
    this.dx += e.movementX
    this.dy += e.movementY
  }

  private onContext = (e: Event) => e.preventDefault()

  private onLockChange = () => {
    if (!this.locked) {
      this.mouseDown = [false, false, false]
    }
  }

  /* ---------- Poll ---------- */

  poll(): InputFrame {
    const k = this.keys
    const p = this.pressed
    const tp = this.touchPressed
    const th = this.touchHeld
    const f = this.frame
    f.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    f.mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    f.dyaw = -this.dx * this.sensitivity
    f.dpitch = -this.dy * this.sensitivity * (this.invertY ? -1 : 1)
    this.dx = this.dy = 0
    f.jump = p.has('Space') || tp.has('jump')
    f.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || th.has('sprint')
    f.crouch = k.has('KeyC') || th.has('crouch')
    // Left button: tap = light, hold past 0.28 s = heavy (released as heavy).
    const held = this.mouseDown[0]
    const holdTime = held ? (performance.now() - this.heldSince) / 1000 : 0
    f.light = this.mouseHit[0] && false
    f.heavy = false
    if (!held && this.heldSince > 0) {
      const t = (performance.now() - this.heldSince) / 1000
      this.heldSince = 0
      if (t >= 0.28) f.heavy = true
      else f.light = true
    }
    if (p.has('KeyJ') || tp.has('light')) f.light = true
    if (p.has('KeyK') || tp.has('heavy')) f.heavy = true
    f.attackHeld = held && holdTime >= 0.28
    f.block = this.mouseDown[2] || k.has('KeyB') || th.has('block')
    f.throw = p.has('KeyG') || this.mouseHit[1] || tp.has('throw')
    f.use = p.has('KeyE') || tp.has('use')
    f.ladder = p.has('KeyF') || tp.has('ladder')
    f.ult = p.has('KeyQ') || tp.has('ult')
    f.emote = p.has('KeyR')
    f.slot = this.slot
    f.touch = this.isTouch
    f.pad = false
    f.locked = this.locked || this.isTouch
    if (Math.hypot(this.touchMoveV.x, this.touchMoveV.z) > 0.1) {
      f.mx = this.touchMoveV.x
      f.mz = -this.touchMoveV.z
    }
    if (this.touchLookV.x || this.touchLookV.y) {
      f.dyaw += -this.touchLookV.x * 0.006
      f.dpitch += -this.touchLookV.y * 0.006
      this.touchLookV.x = this.touchLookV.y = 0
    }
    this.pollPad(f)
    const l = Math.hypot(f.mx, f.mz)
    if (l > 1) {
      f.mx /= l
      f.mz /= l
    }
    this.pressed.clear()
    this.touchPressed.clear()
    this.mouseHit = [false, false, false]
    if (!this.enabled) {
      f.mx = f.mz = f.dyaw = f.dpitch = 0
      f.light = f.heavy = f.throw = f.use = f.ladder = f.ult = f.jump = false
      f.block = false
    }
    void this.wantLock
    return f
  }

  private pollPad(f: InputFrame) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    const gp = Array.from(pads ?? []).find((g) => g && g.connected)
    if (!gp) return
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
    const b = (i: number) => !!gp.buttons[i]?.pressed
    const hit = (i: number) => b(i) && !this.padPrev[i]
    const lx = dz(gp.axes[0] ?? 0)
    const ly = dz(gp.axes[1] ?? 0)
    const rx = dz(gp.axes[2] ?? 0)
    const ry = dz(gp.axes[3] ?? 0)
    const any = lx || ly || rx || ry || gp.buttons.some((x) => x.pressed)
    if (any) this.padUsed = true
    if (!this.padUsed) return
    f.pad = true
    f.locked = true
    if (lx || ly) {
      f.mx = lx
      f.mz = -ly
    }
    f.dyaw += -rx * 0.045
    f.dpitch += -ry * 0.035
    if (hit(7)) f.light = true
    if (hit(5)) f.heavy = true
    f.block = f.block || b(6)
    if (hit(0)) f.jump = true
    f.sprint = f.sprint || b(10)
    if (hit(2)) f.use = true
    if (hit(3)) f.throw = true
    if (hit(1)) f.ladder = true
    if (hit(4)) f.ult = true
    if (hit(12)) this.slot = (this.slot + 3) % 4
    if (hit(13)) this.slot = (this.slot + 1) % 4
    f.slot = this.slot
    this.padPrev = gp.buttons.map((x) => x.pressed)
  }
}
