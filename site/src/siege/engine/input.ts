// Twin-stick input: WASD + mouse, a standard gamepad (left stick move, right stick aim), and two virtual sticks on
// touch screens (fed by the HUD). One frame of input per render; the game turns it into a sim Input.

export interface InputFrame {
  /** Move: x right, z down the screen (world +Z), -1..1. */
  mx: number
  mz: number
  /** Aim as a world direction (sticks), or null when the mouse should decide. */
  aimDir: { x: number; z: number } | null
  /** Pointer in normalised device coordinates (mouse / touch tap). */
  pointer: { x: number; y: number } | null
  fire: boolean
  dash: boolean
  super: boolean
  /** Whether the aim stick is deflected (sticks fire while held). */
  aiming: boolean
  touch: boolean
  pad: boolean
}

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']

export class SiegeInput {
  enabled = true
  onGesture: (() => void) | null = null
  private el: HTMLElement
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private mouseDown = false
  private pointer: { x: number; y: number } | null = null
  private padPrev: boolean[] = []
  private padUsed = false
  private touchMoveV = { x: 0, z: 0 }
  private touchAimV = { x: 0, z: 0, on: false }
  private touchHeld = new Set<string>()
  private touchPressed = new Set<string>()
  private isTouch = false
  private frame: InputFrame = { mx: 0, mz: 0, aimDir: null, pointer: null, fire: false, dash: false, super: false, aiming: false, touch: false, pad: false }

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    el.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    el.addEventListener('contextmenu', this.onContext)
    this.isTouch = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    this.el.removeEventListener('contextmenu', this.onContext)
  }

  /* ---------- Touch API (virtual sticks from the HUD) ---------- */

  touchMove(x: number, z: number) {
    this.isTouch = true
    this.touchMoveV.x = x
    this.touchMoveV.z = z
  }

  touchAim(x: number, z: number, on: boolean) {
    this.isTouch = true
    this.onGesture?.()
    this.touchAimV.x = x
    this.touchAimV.z = z
    this.touchAimV.on = on
  }

  touchButton(name: string, down: boolean) {
    this.isTouch = true
    this.onGesture?.()
    if (down) {
      if (!this.touchHeld.has(name)) this.touchPressed.add(name)
      this.touchHeld.add(name)
    } else this.touchHeld.delete(name)
  }

  /** Whether this looks like a touch device (the HUD shows the sticks). */
  get isTouchDevice() {
    return this.isTouch
  }

  /** Programmatic key press/release (tests). */
  key(code: string, down: boolean) {
    if (down) {
      if (!this.keys.has(code)) this.pressed.add(code)
      this.keys.add(code)
    } else this.keys.delete(code)
  }

  /* ---------- Events ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (KEYS.includes(e.code)) e.preventDefault()
    this.onGesture?.()
    if (!this.keys.has(e.code)) this.pressed.add(e.code)
    this.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    this.mouseDown = false
    this.touchHeld.clear()
  }

  private ndc(e: PointerEvent) {
    const r = this.el.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, y: -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1 }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return
    this.onGesture?.()
    if (e.pointerType === 'touch') {
      this.isTouch = true
      return
    }
    this.pointer = this.ndc(e)
    if (e.button === 0) this.mouseDown = true
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    this.pointer = this.ndc(e)
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (e.button === 0) this.mouseDown = false
  }

  private onContext = (e: Event) => e.preventDefault()

  /* ---------- Poll ---------- */

  poll(): InputFrame {
    const k = this.keys
    const p = this.pressed
    const tp = this.touchPressed
    const f = this.frame
    f.mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    f.mz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0)
    f.aimDir = null
    f.pointer = this.pointer
    f.fire = this.mouseDown || k.has('KeyF') || k.has('KeyJ')
    f.dash = p.has('Space') || p.has('ShiftLeft') || p.has('ShiftRight') || tp.has('dash')
    f.super = p.has('KeyQ') || p.has('KeyE') || p.has('KeyK') || tp.has('super')
    f.aiming = false
    f.touch = this.isTouch
    f.pad = false
    if (Math.hypot(this.touchMoveV.x, this.touchMoveV.z) > 0.1) {
      f.mx = this.touchMoveV.x
      f.mz = this.touchMoveV.z
    }
    if (this.touchAimV.on && Math.hypot(this.touchAimV.x, this.touchAimV.z) > 0.25) {
      f.aimDir = { x: this.touchAimV.x, z: this.touchAimV.z }
      f.aiming = true
      f.fire = true
    }
    this.pollPad(f)
    const l = Math.hypot(f.mx, f.mz)
    if (l > 1) {
      f.mx /= l
      f.mz /= l
    }
    this.pressed.clear()
    this.touchPressed.clear()
    if (!this.enabled) {
      f.mx = f.mz = 0
      f.fire = f.dash = f.super = false
    }
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
    if (lx || ly) {
      f.mx = lx
      f.mz = ly
    }
    if (Math.hypot(rx, ry) > 0.4) {
      f.aimDir = { x: rx, z: ry }
      f.aiming = true
      f.fire = true
    }
    if (b(7) || b(5)) f.fire = true
    if (hit(0) || hit(6) || hit(4)) f.dash = true
    if (hit(3) || hit(2) || hit(1)) f.super = true
    this.padPrev = gp.buttons.map((x) => x.pressed)
  }
}
