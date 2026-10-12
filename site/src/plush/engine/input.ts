// Local controls: keyboard + mouse (pointer lock for mouse-look, or a free pointer for tracing and clicking),
// gamepads (standard mapping) and touch (an on-screen stick and buttons from the HUD, drags on the canvas).
// Everything is merged into one InputFrame per rendered frame.

export interface InputFrame {
  /** Stick: x right, y forward, -1..1. */
  moveX: number
  moveY: number
  /** Camera turn this frame (radians). */
  lookX: number
  lookY: number
  zoom: number
  jump: boolean
  jumpHeld: boolean
  dive: boolean
  shove: boolean
  grab: boolean
  act: boolean
  /** Free-pointer levels: the pointer (normalised device coords) and whether it is pressed. */
  pointer: { x: number; y: number } | null
  down: boolean
  /** A click/tap at this NDC position (free pointer), for picking a rival. */
  click: { x: number; y: number } | null
  /** Number key / d-pad slot pressed this frame (0-based), or -1. */
  slot: number
  cycle: boolean
  prev: boolean
  next: boolean
  usingPad: boolean
  touch: boolean
}

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']

export class LocalInput {
  /** 'look' locks the pointer for mouse-look; 'free' leaves it visible. */
  mode: 'look' | 'free' = 'look'
  locked = false
  enabled = true
  private el: HTMLElement
  private keys = new Set<string>()
  private pressed = new Set<string>()
  private mouseL = false
  private mouseR = false
  private clickL = false
  private lookX = 0
  private lookY = 0
  private wheel = 0
  private pointer: { x: number; y: number } | null = null
  private click: { x: number; y: number } | null = null
  private padPrev: boolean[] = []
  private padUsed = false
  private touchStick = { x: 0, y: 0 }
  private touchHeld = new Set<string>()
  private touchPressed = new Set<string>()
  private touchLook: { id: number; x: number; y: number } | null = null
  private isTouch = false
  private frame = {} as InputFrame
  /** Called on the first gesture (to unlock audio). */
  onGesture: (() => void) | null = null

  constructor(el: HTMLElement) {
    this.el = el
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    el.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', this.onContext)
    document.addEventListener('pointerlockchange', this.onLock)
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.el.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    this.el.removeEventListener('wheel', this.onWheel)
    this.el.removeEventListener('contextmenu', this.onContext)
    document.removeEventListener('pointerlockchange', this.onLock)
    if (document.pointerLockElement === this.el) document.exitPointerLock()
  }

  setMode(mode: 'look' | 'free') {
    if (mode === this.mode) return
    this.mode = mode
    if (mode === 'free' && document.pointerLockElement === this.el) document.exitPointerLock()
  }

  /* ---------- Touch API (called by the HUD's on-screen controls) ---------- */

  touchMove(x: number, y: number) {
    this.isTouch = true
    this.touchStick.x = x
    this.touchStick.y = y
  }

  touchButton(name: string, down: boolean) {
    this.isTouch = true
    this.onGesture?.()
    if (down) {
      if (!this.touchHeld.has(name)) this.touchPressed.add(name)
      this.touchHeld.add(name)
    } else this.touchHeld.delete(name)
  }

  /** A one-shot from a HUD button: 'slot:N', 'cycle', 'prev', 'next', 'act'. */
  tap(name: string) {
    this.touchPressed.add(name)
  }

  /* ---------- Events ---------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (MOVE_KEYS.includes(e.code)) e.preventDefault()
    this.onGesture?.()
    if (!this.keys.has(e.code)) this.pressed.add(e.code)
    this.keys.add(e.code)
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => {
    this.keys.clear()
    this.mouseL = this.mouseR = false
    this.touchHeld.clear()
  }

  private ndc(e: PointerEvent | MouseEvent) {
    const r = this.el.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, y: -((e.clientY - r.top) / Math.max(1, r.height)) * 2 + 1 }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return
    this.onGesture?.()
    if (e.pointerType === 'touch') {
      this.isTouch = true
      if (this.mode === 'free') {
        this.pointer = this.ndc(e)
        this.click = this.ndc(e)
        this.mouseL = true
      } else if (!this.touchLook) this.touchLook = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    if (this.mode === 'look' && !this.locked) {
      this.el.requestPointerLock?.()
      return
    }
    if (e.button === 0) {
      this.mouseL = true
      this.clickL = true
      if (this.mode === 'free') this.click = this.ndc(e)
    } else if (e.button === 2) this.mouseR = true
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (this.mode === 'free' && this.mouseL) this.pointer = this.ndc(e)
      else if (this.touchLook && this.touchLook.id === e.pointerId) {
        this.lookX += (e.clientX - this.touchLook.x) * 0.006
        this.lookY += (e.clientY - this.touchLook.y) * 0.004
        this.touchLook.x = e.clientX
        this.touchLook.y = e.clientY
      }
      return
    }
    if (this.mode === 'free') {
      if (e.target === this.el || this.el.contains(e.target as Node)) this.pointer = this.ndc(e)
      return
    }
    if (!this.locked) return
    this.lookX += e.movementX * 0.0028
    this.lookY += e.movementY * 0.0022
  }

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (this.touchLook?.id === e.pointerId) this.touchLook = null
      if (this.mode === 'free') this.mouseL = false
      return
    }
    if (e.button === 0) this.mouseL = false
    else if (e.button === 2) this.mouseR = false
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.wheel += Math.sign(e.deltaY)
  }

  private onContext = (e: Event) => e.preventDefault()

  private onLock = () => {
    this.locked = document.pointerLockElement === this.el
  }

  /** Merge every device into this frame's input and clear the one-shots. */
  poll(): InputFrame {
    const k = this.keys
    const p = this.pressed
    const tp = this.touchPressed
    const f: InputFrame = Object.assign(this.frame, {
      moveX: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      moveY: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      lookX: this.lookX,
      lookY: this.lookY,
      zoom: this.wheel,
      jump: p.has('Space') || tp.has('jump'),
      jumpHeld: k.has('Space') || this.touchHeld.has('jump'),
      dive: p.has('ShiftLeft') || p.has('ShiftRight') || tp.has('dive'),
      shove: p.has('KeyF') || (this.mode === 'look' && this.clickL) || tp.has('shove'),
      grab: k.has('KeyE') || this.mouseR || this.touchHeld.has('grab'),
      act: p.has('KeyR') || tp.has('act'),
      pointer: this.mode === 'free' ? this.pointer : null,
      down: this.mode === 'free' && this.mouseL,
      click: this.click,
      slot: -1,
      cycle: p.has('Tab') || p.has('KeyT') || tp.has('cycle'),
      prev: p.has('KeyQ') || tp.has('prev'),
      next: p.has('KeyE') || tp.has('next'),
      usingPad: false,
      touch: this.isTouch,
    })
    for (let i = 1; i <= 9; i++) if (p.has(`Digit${i}`) || tp.has(`slot:${i - 1}`)) f.slot = i - 1
    if (Math.hypot(this.touchStick.x, this.touchStick.y) > 0.1) {
      f.moveX = this.touchStick.x
      f.moveY = this.touchStick.y
    }
    this.pollPad(f)
    const len = Math.hypot(f.moveX, f.moveY)
    if (len > 1) {
      f.moveX /= len
      f.moveY /= len
    }
    this.pressed.clear()
    this.touchPressed.clear()
    this.clickL = false
    this.click = null
    this.lookX = this.lookY = 0
    this.wheel = 0
    if (!this.enabled) {
      f.moveX = f.moveY = 0
      f.jump = f.dive = f.shove = f.act = f.grab = f.cycle = false
      f.slot = -1
    }
    return f
  }

  private pollPad(f: InputFrame) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    const gp = Array.from(pads ?? []).find((g) => g && g.connected)
    if (!gp) return
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
    const b = (i: number) => !!gp.buttons[i]?.pressed
    const was = (i: number) => !!this.padPrev[i]
    const hit = (i: number) => b(i) && !was(i)
    const ax = dz(gp.axes[0] ?? 0), ay = dz(gp.axes[1] ?? 0)
    const lx = dz(gp.axes[2] ?? 0), ly = dz(gp.axes[3] ?? 0)
    const any = ax || ay || lx || ly || gp.buttons.some((x) => x.pressed)
    if (any) this.padUsed = true
    if (!this.padUsed) return
    f.usingPad = true
    if (ax || ay) {
      f.moveX = ax
      f.moveY = -ay
    }
    f.lookX += lx * 0.05
    f.lookY += ly * 0.035
    if (hit(0)) f.jump = true
    if (b(0)) f.jumpHeld = true
    if (hit(1)) f.dive = true
    if (hit(2)) f.shove = true
    if (hit(3)) f.act = true
    if (b(5) || b(7)) f.grab = true
    if (hit(4)) f.cycle = true
    if (b(6)) f.down = true
    const dpad = [12, 15, 13, 14]
    dpad.forEach((bi, i) => {
      if (hit(bi)) f.slot = i
    })
    if (hit(8)) f.slot = 4
    if (hit(9)) f.slot = 5
    if (hit(10)) f.prev = true
    if (hit(11)) f.next = true
    this.padPrev = gp.buttons.map((x) => x.pressed)
  }
}
