// Full-screen loading overlay with a small three.js scene: a holographic cube that unfolds as the progress bar
// fills, hovering over a slowly spinning neon disc. Framework-free (plain DOM + three.js), so the same file ships
// unchanged with each game that was split out of the portfolio.
//
//   const h = showLoader({ status: 'Loading the island…' })
//   h.update({ progress: 0.42 })     // 0..1, or null while the size of the work is unknown
//   h.release()                      // hides once every holder has released (min 600 ms on screen, then a fade)
//
// Progress is real: loadMonitor() watches three's DefaultLoadingManager (every GLTFLoader / TextureLoader that
// is not given its own manager reports there), and the overlay can follow it with trackManager(). three itself is
// imported lazily so the overlay (status + bar) appears before the 3D chunk has downloaded.

import type * as ThreeNS from 'three'

export interface LoaderState {
  /** One line under the scene, e.g. "Loading the island…". */
  status?: string
  /** 0..1 fraction of the work done, or null when the amount of work is unknown. */
  progress?: number | null
}

export interface LoaderHandle {
  update(state: LoaderState): void
  release(): void
}

export interface LoadActivity {
  /** True while the loading manager has items in flight. */
  active: boolean
  loaded: number
  total: number
}

const MIN_MS = 600
const FADE_MS = 380
const IDLE_GRACE_MS = 260
const STALL_MS = 20000
const DRAIN_MS = 1500
const ID = 'ld3'

const CSS = `
.ld3{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:#05060f;color:#f4f6fb;
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;transition:opacity ${FADE_MS}ms ease;
  --ld3-a:#22d3ee;--ld3-b:#f0abfc}
.ld3.is-out{opacity:0;pointer-events:none}
.ld3-box{display:grid;justify-items:center;gap:14px;width:min(360px,80vw)}
.ld3-stage{position:relative;width:min(280px,60vw);aspect-ratio:1;display:grid;place-items:center}
.ld3-stage canvas{width:100%;height:100%;display:block}
.ld3-logo{width:96px;height:96px;display:grid;place-items:center;border-radius:22px;font-weight:800;font-size:34px;
  letter-spacing:.04em;color:#fff;border:1px solid rgba(255,255,255,.14);
  background:linear-gradient(150deg,rgba(34,211,238,.28),rgba(240,171,252,.22));
  box-shadow:0 0 44px rgba(34,211,238,.25),inset 0 0 24px rgba(240,171,252,.18)}
.ld3-text{display:flex;justify-content:space-between;width:100%;font-size:13px;letter-spacing:.08em;
  text-transform:uppercase;color:rgba(244,246,251,.64)}
.ld3-pct{font-variant-numeric:tabular-nums;color:#f4f6fb}
.ld3-bar{position:relative;width:100%;height:4px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}
.ld3-bar i{position:absolute;inset:0;width:auto;animation:none;transform-origin:0 50%;transform:scaleX(0);border-radius:4px;
  background:linear-gradient(90deg,var(--ld3-a),var(--ld3-b));transition:transform .18s ease-out}
.ld3-bar.is-wait i{animation:ld3-wait 1.4s ease-in-out infinite;transform:none;width:40%;left:0}
@keyframes ld3-wait{0%{left:-40%}100%{left:100%}}
@media (prefers-reduced-motion:reduce){.ld3{transition:none}.ld3-bar i{transition:none}.ld3-bar.is-wait i{animation:none;left:0;width:100%;opacity:.5}}
`

/** The overlay element from index.html, if the page ships a static shell (logo + bar) for the first paint. */
function adoptShell(): HTMLElement | null {
  const el = document.getElementById(ID)
  return el && el.classList.contains('ld3') ? el : null
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/* ---------- Loading manager monitor ---------- */

type Listener = (a: LoadActivity) => void
const listeners = new Set<Listener>()
const activity: LoadActivity = { active: false, loaded: 0, total: 0 }
let idleTimer = 0
let monitorInstalled = false

function emit() {
  for (const l of listeners) l({ ...activity })
}

/** Current state of three's default loading manager (the burst since it was last idle). */
export function loadActivity(): LoadActivity {
  return { ...activity }
}

/** Follow the default loading manager. Each burst of loads counts from zero, so progress is meaningful per screen. */
export function subscribeLoading(listener: Listener): () => void {
  listeners.add(listener)
  listener({ ...activity })
  return () => {
    listeners.delete(listener)
  }
}

function installMonitor(THREE: typeof ThreeNS) {
  if (monitorInstalled) return
  monitorInstalled = true
  const m = THREE.DefaultLoadingManager
  const start = m.itemStart.bind(m)
  const end = m.itemEnd.bind(m)
  const error = m.itemError.bind(m)
  const settle = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      if (activity.loaded < activity.total) return
      activity.active = false
      activity.loaded = activity.total = 0
      emit()
    }, IDLE_GRACE_MS)
  }
  m.itemStart = (url: string) => {
    window.clearTimeout(idleTimer)
    activity.total++
    activity.active = true
    emit()
    start(url)
  }
  m.itemEnd = (url: string) => {
    activity.loaded = Math.min(activity.total, activity.loaded + 1)
    emit()
    if (activity.loaded >= activity.total) settle()
    end(url)
  }
  m.itemError = (url: string) => {
    error(url)
  }
}

let threePromise: Promise<typeof ThreeNS> | null = null
function three() {
  if (!threePromise) {
    threePromise = import('three').then((mod) => {
      installMonitor(mod)
      return mod
    })
  }
  return threePromise
}

/** Start watching the loading manager now (otherwise it starts with the first overlay). */
export function loadMonitor() {
  void three()
}

/* ---------- Overlay ---------- */

interface Overlay {
  root: HTMLElement
  stage: HTMLElement
  status: HTMLElement
  pct: HTMLElement
  bar: HTMLElement
  fill: HTMLElement
  scene: Scene | null
  shownAt: number
  lastFrame: number
  target: number | null
  shown: number
  raf: number
  hideTimer: number
  fading: boolean
}

let overlay: Overlay | null = null
let holders = 0

function build(): Overlay {
  if (!document.getElementById(ID + '-style')) {
    const style = document.createElement('style')
    style.id = ID + '-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }
  let root = adoptShell()
  if (!root) {
    root = document.createElement('div')
    root.id = ID
    root.className = 'ld3'
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'polite')
    document.body.appendChild(root)
  }
  root.innerHTML =
    '<div class="ld3-box"><div class="ld3-stage"></div>' +
    '<div class="ld3-text"><span class="ld3-status"></span><span class="ld3-pct"></span></div>' +
    '<div class="ld3-bar is-wait"><i></i></div></div>'
  const q = (c: string) => root.querySelector<HTMLElement>('.' + c)!
  const o: Overlay = {
    root,
    stage: q('ld3-stage'),
    status: q('ld3-status'),
    pct: q('ld3-pct'),
    bar: q('ld3-bar'),
    fill: q('ld3-bar i'),
    scene: null,
    shownAt: performance.now(),
    lastFrame: performance.now(),
    target: null,
    shown: 0,
    raf: 0,
    hideTimer: 0,
    fading: false,
  }
  o.status.textContent = 'Loading…'
  if (reducedMotion()) {
    const logo = document.createElement('div')
    logo.className = 'ld3-logo'
    logo.textContent = document.documentElement.dataset.loaderMark || 'SS'
    o.stage.appendChild(logo)
  } else {
    const canvas = document.createElement('canvas')
    o.stage.appendChild(canvas)
    three()
      .then((THREE) => {
        if (overlay !== o || o.fading) return
        o.scene = makeScene(THREE, canvas)
        if (!o.scene) {
          canvas.remove()
          const logo = document.createElement('div')
          logo.className = 'ld3-logo'
          logo.textContent = document.documentElement.dataset.loaderMark || 'SS'
          o.stage.appendChild(logo)
        }
      })
      .catch(() => {})
    const tick = (now: number) => {
      o.raf = requestAnimationFrame(tick)
      // Ease the displayed value towards the target so bursts of small items read as one smooth fill.
      const dt = Math.min(0.1, (now - o.lastFrame) / 1000)
      o.lastFrame = now
      if (o.target !== null) o.shown += (o.target - o.shown) * (1 - Math.exp(-dt * 7))
      o.scene?.render(now, o.target === null ? null : o.shown)
    }
    o.raf = requestAnimationFrame(tick)
  }
  return o
}

function apply(o: Overlay, s: LoaderState) {
  if (s.status !== undefined) o.status.textContent = s.status
  if (s.progress !== undefined) {
    if (s.progress === null) {
      o.target = null
      o.bar.classList.add('is-wait')
      o.fill.style.transform = ''
      o.pct.textContent = ''
    } else {
      // Never run backwards within one showing: counters restart per burst but the bar should only ever fill.
      const p = Math.max(o.target ?? 0, Math.min(1, Math.max(0, s.progress)))
      o.target = p
      o.bar.classList.remove('is-wait')
      o.fill.style.transform = `scaleX(${p})`
      o.pct.textContent = `${Math.round(p * 100)}%`
    }
  }
}

function teardown(o: Overlay) {
  cancelAnimationFrame(o.raf)
  o.scene?.dispose()
  o.root.remove()
}

function hide(o: Overlay) {
  o.fading = true
  o.root.classList.add('is-out')
  window.setTimeout(() => {
    if (overlay === o) overlay = null
    teardown(o)
  }, reducedMotion() ? 0 : FADE_MS)
}

/** Show the overlay (or join the one already showing). Every holder must release() it. */
export function showLoader(state: LoaderState = {}): LoaderHandle {
  holders++
  if (!overlay || overlay.fading) {
    if (overlay) {
      window.clearTimeout(overlay.hideTimer)
      teardown(overlay)
    }
    overlay = build()
  }
  window.clearTimeout(overlay.hideTimer)
  const o = overlay
  apply(o, state)
  let released = false
  return {
    update(next) {
      if (!released && overlay === o) apply(o, next)
    },
    release() {
      if (released) return
      released = true
      holders = Math.max(0, holders - 1)
      if (holders > 0 || overlay !== o) return
      const wait = Math.max(0, MIN_MS - (performance.now() - o.shownAt))
      o.hideTimer = window.setTimeout(() => {
        if (holders === 0 && overlay === o) hide(o)
      }, wait)
    },
  }
}

let boot: LoaderHandle | null = null

/** First paint: show the overlay before the app renders (adopting the static shell from index.html, if any). */
export function bootLoader(state: LoaderState = { status: 'Starting up…', progress: null }) {
  if (!boot) boot = showLoader(state)
  return boot
}

/** The app has its first screen ready; the boot overlay goes once everyone else has released it too. */
export function endBoot() {
  boot?.release()
  boot = null
}

/** True while an overlay is on screen (fading counts as gone). */
export function loaderVisible() {
  return !!overlay && !overlay.fading
}

/**
 * Keep a handle's progress in step with the loading manager until it goes idle (nothing in flight for a short
 * grace period). Resolves when idle; the caller decides whether to release the handle.
 */
export function trackManager(handle: LoaderHandle, signal?: AbortSignal, stallMs = STALL_MS): Promise<void> {
  return new Promise((resolve) => {
    let finished = false
    let stall = 0
    // subscribeLoading calls back synchronously with the current state, so `off` must exist before it runs.
    let off = () => {}
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(stall)
      off()
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    let drained = 0
    off = subscribeLoading((a) => {
      if (!a.active) return finish()
      handle.update({ progress: a.total ? a.loaded / a.total : null })
      // Everything that was started has finished. A scene that keeps trickling in small items (a canvas texture
      // a frame, say) would otherwise never let the manager settle, so a drained burst counts as done after a
      // moment even if the trickle continues.
      if (a.total > 0 && a.loaded >= a.total) {
        drained ||= performance.now()
        if (performance.now() - drained > DRAIN_MS) return finish()
      }
      // A load that never reports back (a lost request, a decoder that gave up) must not pin the overlay forever.
      window.clearTimeout(stall)
      stall = window.setTimeout(finish, stallMs)
    })
    signal?.addEventListener('abort', finish)
    // The manager is only wired once three has loaded; make sure that happens.
    loadMonitor()
  })
}

/* ---------- The scene ---------- */

interface Scene {
  render(now: number, progress: number | null): void
  dispose(): void
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

function makeScene(THREE: typeof ThreeNS, canvas: HTMLCanvasElement): Scene | null {
  let renderer: ThreeNS.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  camera.position.set(0, 2.9, 6.4)
  camera.lookAt(0, 0.35, 0)

  const A = new THREE.Color('#22d3ee')
  const B = new THREE.Color('#f0abfc')

  // Disc with a soft neon rim.
  const disc = new THREE.Group()
  disc.position.y = -0.95
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 64),
    new THREE.MeshBasicMaterial({ color: 0x0b1024, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  )
  plate.rotation.x = -Math.PI / 2
  disc.add(plate)
  const rim = (r0: number, r1: number, color: ThreeNS.Color, opacity: number) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(r0, r1, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    m.rotation.x = -Math.PI / 2
    return m
  }
  disc.add(rim(1.5, 1.62, A, 0.9), rim(1.62, 1.95, A, 0.16), rim(1.1, 1.13, B, 0.45))
  // Tick marks around the rim, so the spin reads.
  const ticks = new THREE.Group()
  for (let i = 0; i < 24; i++) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(0.05, i % 6 === 0 ? 0.22 : 0.1), new THREE.MeshBasicMaterial({ color: i % 6 === 0 ? B : A, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    const a = (i / 24) * Math.PI * 2
    t.position.set(Math.cos(a) * 1.35, 0.001, Math.sin(a) * 1.35)
    t.rotation.set(-Math.PI / 2, 0, -a)
    ticks.add(t)
  }
  disc.add(ticks)
  scene.add(disc)

  // Holographic face material: gradient, scanlines and a bright border.
  const faceMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uA: { value: A }, uB: { value: B } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
      void main(){
        vec3 c = mix(uA, uB, vUv.y);
        float scan = 0.5 + 0.5 * sin(vUv.y * 60.0 - uTime * 3.0);
        float edge = 1.0 - smoothstep(0.0, 0.08, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
        float a = 0.16 + 0.1 * scan + 0.7 * edge;
        gl_FragColor = vec4(c * (0.6 + 0.5 * edge), a);
      }`,
  })
  const faceGeo = new THREE.PlaneGeometry(1, 1)
  const edgeGeo = new THREE.EdgesGeometry(faceGeo)
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
  const face = () => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(faceGeo, faceMat), new THREE.LineSegments(edgeGeo, edgeMat))
    return g
  }

  // Cube net: the base stays, four sides hinge on the base's edges, the lid hinges on the back side's top edge.
  const cube = new THREE.Group()
  const base = face()
  base.rotation.x = -Math.PI / 2
  cube.add(base)
  const hinges: { pivot: ThreeNS.Group; axis: 'x' | 'z'; sign: number; from: number; to: number }[] = []
  const side = (dx: number, dz: number, from: number, to: number) => {
    // Pivot at the base edge; the face stands up from it. Rotation about the edge lays it flat outward.
    const pivot = new THREE.Group()
    pivot.position.set(dx * 0.5, 0, dz * 0.5)
    const f = face()
    f.position.y = 0.5
    pivot.add(f)
    // Face the plane outward.
    if (dz !== 0) f.rotation.y = dz > 0 ? 0 : Math.PI
    else f.rotation.y = dx > 0 ? Math.PI / 2 : -Math.PI / 2
    cube.add(pivot)
    hinges.push({ pivot, axis: dz !== 0 ? 'x' : 'z', sign: dz !== 0 ? dz : -dx, from, to })
    return pivot
  }
  side(0, 1, 0.04, 0.42) // front
  side(1, 0, 0.16, 0.54) // right
  const back = side(0, -1, 0.28, 0.66)
  side(-1, 0, 0.4, 0.78) // left
  // Lid: hinged on the back face's top edge (in the back pivot's frame, the face's top is at y = 1).
  const lid = new THREE.Group()
  lid.position.set(0, 1, 0)
  const lidFace = face()
  lidFace.rotation.x = -Math.PI / 2
  lidFace.position.z = 0.5
  lid.add(lidFace)
  back.add(lid)
  cube.position.y = -0.95
  scene.add(cube)

  // Motes drifting around the disc.
  const N = 70
  const pos = new Float32Array(N * 3)
  const seeds = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    seeds[i * 3] = 0.9 + Math.random() * 1.6
    seeds[i * 3 + 1] = Math.random() * Math.PI * 2
    seeds[i * 3 + 2] = Math.random() * 1.8
  }
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const motes = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: A, size: 0.045, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }))
  scene.add(motes)

  const t0 = performance.now()
  let last = t0
  let idleT = 0
  const resize = () => {
    const w = canvas.clientWidth || 280
    const h = canvas.clientHeight || 280
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) renderer.setSize(w, h, false)
  }
  resize()
  let disposed = false
  return {
    render(now, progress) {
      if (disposed) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = (now - t0) / 1000
      resize()
      faceMat.uniforms.uTime.value = t
      // Unknown amount of work: breathe between a quarter and half open so it still reads as "working".
      let p: number
      if (progress === null) {
        idleT += dt
        p = 0.3 + 0.2 * Math.sin(idleT * 1.4)
      } else p = progress
      for (const h of hinges) {
        const a = smooth((p - h.from) / (h.to - h.from)) * (Math.PI / 2) * h.sign
        if (h.axis === 'x') h.pivot.rotation.x = a
        else h.pivot.rotation.z = a
      }
      lid.rotation.x = -smooth((p - 0.62) / 0.38) * (Math.PI / 2)
      cube.rotation.y = t * 0.55
      cube.position.y = -0.95 + 0.62 * (1 - smooth(p)) + 0.07 * Math.sin(t * 1.7) + 0.02
      cube.scale.setScalar(1 - 0.1 * smooth(p))
      disc.rotation.y = -t * 0.18
      ticks.rotation.y = t * 0.08
      const arr = pGeo.attributes.position.array as Float32Array
      for (let i = 0; i < N; i++) {
        const r = seeds[i * 3]
        const a = seeds[i * 3 + 1] + t * (0.25 + 0.15 / r)
        const y = -0.9 + ((seeds[i * 3 + 2] + t * 0.12) % 1.8)
        arr[i * 3] = Math.cos(a) * r
        arr[i * 3 + 1] = y
        arr[i * 3 + 2] = Math.sin(a) * r
      }
      pGeo.attributes.position.needsUpdate = true
      renderer.render(scene, camera)
    },
    dispose() {
      disposed = true
      faceGeo.dispose()
      edgeGeo.dispose()
      pGeo.dispose()
      faceMat.dispose()
      edgeMat.dispose()
      scene.traverse((o) => {
        const m = o as ThreeNS.Mesh
        if (m.geometry && m.geometry !== faceGeo && m.geometry !== edgeGeo && m.geometry !== pGeo) m.geometry.dispose()
        const mat = m.material as ThreeNS.Material | undefined
        if (mat && mat !== faceMat && mat !== edgeMat) mat.dispose()
      })
      renderer.dispose()
    },
  }
}


