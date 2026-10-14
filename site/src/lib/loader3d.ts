// Full-screen loading screen, one system for every context: the thing being loaded fills the screen (a game's key
// art, the district being entered, the island at boot) with its title, a line of lore, a rotating tip and real
// progress, plus a small holographic cube (three.js) that unfolds as the bar fills. Framework-free (plain DOM +
// three.js), so the same file ships unchanged with each game that was split out of the portfolio.
//
//   const h = showLoader({ status: 'Loading the island…', scene: { title: 'Harbour Town', art: 'home/hero/profile.webp' } })
//   h.update({ progress: 0.42 })     // 0..1, or null while the size of the work is unknown
//   h.release()                      // hides once every holder has released (min 600 ms on screen, then a fade)
//
// A screen that owns a context (a game route, say) can claim it with claimLoaderScene(), so every loader shown
// while it is mounted (its chunk download, its own asset loader) carries that game's art and tips without each
// call site having to pass it. An explicit `scene` always wins.
//
// Progress is real: loadMonitor() watches three's DefaultLoadingManager (every GLTFLoader / TextureLoader that
// is not given its own manager reports there), and the overlay can follow it with trackManager(). three itself is
// imported lazily so the overlay (art, status + bar) appears before the 3D chunk has downloaded.

import type * as ThreeNS from 'three'

/** What is loading: shown full-screen behind the progress. Every field is optional. */
export interface LoaderScene {
  /** Small label above the title, e.g. "Now loading · Game" or "Entering district". */
  kicker?: string
  title?: string
  /** One line of lore or description under the title. */
  sub?: string
  /** Full-bleed image URL, and an optional srcset for it (sizes cover the screen). */
  art?: string
  artSet?: string
  /** The same image as AVIF (a srcset), for browsers that take it; often already cached by the page. */
  artAvif?: string
  /** A small copy (usually cached already), shown blurred at once while the full image loads. */
  artThumb?: string
  /** Rotating tips, one every few seconds. */
  tips?: string[]
  /** Progress bar and glow colours. */
  accent?: [string, string]
}

export interface LoaderState {
  /** One line by the progress bar, e.g. "Loading the island…". */
  status?: string
  /** 0..1 fraction of the work done, or null when the amount of work is unknown. */
  progress?: number | null
  /** What is loading (falls back to the claimed scene, see claimLoaderScene). */
  scene?: LoaderScene
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
const FADE_MS = 420
const IN_MS = 220
const TIP_MS = 5200
const IDLE_GRACE_MS = 260
const STALL_MS = 20000
const DRAIN_MS = 1500
const ID = 'ld3'

// Kept in step with the static shell's copy in index.html (first paint, before this module runs).
const CSS = `
.ld3{position:fixed;inset:0;z-index:1000;overflow:hidden;color:#fff;background:#05060f;
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  --ld3-a:#22d3ee;--ld3-b:#f0abfc;--ld3-gx:clamp(20px,4.4vw,84px);transition:opacity ${FADE_MS}ms ease}
.ld3::before{content:'';position:absolute;inset:0;background:radial-gradient(110% 90% at 78% 28%,color-mix(in srgb,var(--ld3-a) 20%,transparent),transparent 62%),radial-gradient(80% 70% at 6% 100%,color-mix(in srgb,var(--ld3-b) 14%,transparent),transparent 62%)}
.ld3.is-pre{opacity:0;transition-duration:${IN_MS}ms}
.ld3.is-out{opacity:0;pointer-events:none}
.ld3-art{position:absolute;inset:0}
.ld3-art picture{position:absolute;inset:0}
.ld3-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:68% 35%;opacity:0;transform:scale(1.07);
  transition:opacity .8s ease,transform 10s cubic-bezier(.2,.7,.2,1)}
.ld3-art img.is-in{opacity:1;transform:scale(1)}
.ld3-art img.ld3-blur{filter:blur(28px) saturate(1.2);transform:scale(1.12);transition:opacity .3s ease}
.ld3-art img.ld3-blur.is-in{opacity:.85;transform:scale(1.12)}
.ld3-scrim{position:absolute;inset:0;background:
  linear-gradient(90deg,rgba(3,5,12,.9) 0%,rgba(3,5,12,.66) 28%,rgba(3,5,12,.16) 56%,rgba(3,5,12,0) 70%),
  linear-gradient(180deg,rgba(3,5,12,.5) 0%,rgba(3,5,12,0) 22%,rgba(3,5,12,0) 44%,rgba(3,5,12,.66) 76%,rgba(3,5,12,.95) 100%)}
.ld3-ui{position:absolute;left:var(--ld3-gx);right:var(--ld3-gx);bottom:clamp(28px,7vh,80px);display:grid;gap:clamp(22px,3.6vh,40px);max-width:780px}
.ld3-kicker{display:flex;align-items:center;gap:10px;margin:0;font-size:14px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.86)}
.ld3-kicker::before{content:'';flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--ld3-a);box-shadow:0 0 14px var(--ld3-a);animation:ld3-pulse 1.6s ease-in-out infinite}
.ld3-kicker:empty{display:none}
.ld3-title{margin:12px 0 0;font-size:clamp(40px,5.2vw,96px);font-weight:800;line-height:.98;letter-spacing:-.02em;text-wrap:balance;text-shadow:0 4px 34px rgba(0,0,0,.5)}
.ld3-title:empty,.ld3-sub:empty{display:none}
.ld3-sub{margin:14px 0 0;max-width:48ch;font-size:clamp(17px,calc(.5vw + 11px),21px);line-height:1.5;color:rgba(255,255,255,.9);text-shadow:0 2px 14px rgba(0,0,0,.6)}
.ld3-foot{display:flex;align-items:center;gap:18px;max-width:640px}
.ld3-stage{position:relative;flex:0 0 auto;width:84px;height:84px;display:grid;place-items:center}
.ld3-stage canvas{width:100%;height:100%;display:block}
.ld3-logo{width:56px;height:56px;display:grid;place-items:center;border-radius:16px;font-weight:800;font-size:20px;letter-spacing:.04em;color:#fff;
  border:1px solid rgba(255,255,255,.16);background:linear-gradient(150deg,color-mix(in srgb,var(--ld3-a) 30%,transparent),color-mix(in srgb,var(--ld3-b) 24%,transparent));
  box-shadow:0 0 34px color-mix(in srgb,var(--ld3-a) 28%,transparent)}
.ld3-meter{flex:1;min-width:0;display:grid;gap:10px}
.ld3-text{display:flex;justify-content:space-between;gap:12px;font-size:14px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.8)}
.ld3-status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ld3-pct{font-variant-numeric:tabular-nums;color:#fff}
.ld3-bar{position:relative;width:100%;height:4px;border-radius:4px;background:rgba(255,255,255,.16);overflow:hidden}
.ld3-bar i{position:absolute;inset:0;width:auto;animation:none;transform-origin:0 50%;transform:scaleX(0);border-radius:4px;
  background:linear-gradient(90deg,var(--ld3-b),var(--ld3-a));transition:transform .18s ease-out}
.ld3-bar.is-wait i{animation:ld3-wait 1.4s ease-in-out infinite;transform:none;width:40%;left:0}
.ld3-tip{margin:4px 0 0;min-height:3em;font-size:clamp(15px,calc(.3vw + 11px),17px);line-height:1.5;color:rgba(255,255,255,.86);transition:opacity .35s ease}
.ld3-tip b{display:inline-block;margin-right:10px;padding:2px 8px;border-radius:5px;font-size:11.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  vertical-align:1px;color:#0b0d14;background:color-mix(in srgb,var(--ld3-a) 70%,#fff)}
.ld3-tip.is-swap{opacity:0}
.ld3-tip:empty{display:none}
@keyframes ld3-wait{0%{left:-40%}100%{left:100%}}
@keyframes ld3-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@media (max-width:760px){
  .ld3-scrim{background:linear-gradient(180deg,rgba(3,5,12,.45) 0%,rgba(3,5,12,0) 24%,rgba(3,5,12,.2) 42%,rgba(3,5,12,.86) 66%,rgba(3,5,12,.97) 100%)}
  .ld3-art img{object-position:72% 40%}
  .ld3-ui{bottom:calc(24px + env(safe-area-inset-bottom));gap:20px}
  .ld3-title{font-size:clamp(32px,10vw,46px)}
  .ld3-sub{font-size:16px}
  .ld3-stage{width:60px;height:60px}
  .ld3-logo{width:44px;height:44px;font-size:16px;border-radius:12px}
  .ld3-tip{font-size:15px}
}
@media (prefers-reduced-motion:reduce){.ld3,.ld3-tip{transition:none}.ld3-art img{transition:opacity .2s;transform:none}.ld3-kicker::before{animation:none}
  .ld3-bar i{transition:none}.ld3-bar.is-wait i{animation:none;left:0;width:100%;opacity:.5}}
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

/* ---------- Scene context ---------- */

let claimed: LoaderScene | null = null
let fallback: LoaderScene | null = null

/** The scene used by loaders that do not pass one, while `scene` is claimed (a game route, say). */
export function claimLoaderScene(scene: LoaderScene) {
  claimed = scene
  if (overlay && !overlay.fading) applyScene(overlay, scene)
}

/** Give the claim back (only if it is still this scene's). */
export function releaseLoaderScene(scene: LoaderScene) {
  if (claimed === scene) claimed = null
}

/** The scene of last resort, for loaders shown with nothing claimed (the site's own look). */
export function setDefaultLoaderScene(scene: LoaderScene | null) {
  fallback = scene
}

/* ---------- Overlay ---------- */

interface Overlay {
  root: HTMLElement
  stage: HTMLElement
  art: HTMLElement
  kicker: HTMLElement
  title: HTMLElement
  sub: HTMLElement
  tip: HTMLElement
  status: HTMLElement
  pct: HTMLElement
  bar: HTMLElement
  fill: HTMLElement
  scene: Scene | null
  /** The scene on screen. */
  shown3: LoaderScene | null
  artSrc: string
  tips: string[]
  tipAt: number
  tipTimer: number
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

const MARKUP =
  '<div class="ld3-art" aria-hidden="true"></div><div class="ld3-scrim" aria-hidden="true"></div>' +
  '<div class="ld3-ui"><div class="ld3-copy"><p class="ld3-kicker"></p><h2 class="ld3-title"></h2><p class="ld3-sub"></p></div>' +
  '<div class="ld3-foot"><div class="ld3-stage" aria-hidden="true"></div><div class="ld3-meter">' +
  '<div class="ld3-text"><span class="ld3-status"></span><span class="ld3-pct"></span></div>' +
  '<div class="ld3-bar is-wait"><i></i></div><p class="ld3-tip"></p></div></div></div>'

const mark = () => document.documentElement.dataset.loaderMark || 'SS'

function logo(stage: HTMLElement) {
  const el = document.createElement('div')
  el.className = 'ld3-logo'
  el.textContent = mark()
  stage.appendChild(el)
}

function build(): Overlay {
  if (!document.getElementById(ID + '-style')) {
    const style = document.createElement('style')
    style.id = ID + '-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }
  let root = adoptShell()
  const adopted = !!root
  if (!root) {
    root = document.createElement('div')
    root.id = ID
    root.className = 'ld3 is-pre'
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'polite')
    document.body.appendChild(root)
    // Fade in over whatever was on screen (two frames, so the starting opacity is painted first).
    const el = root
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-pre')))
  }
  // The static shell from index.html already has this markup (and its art loading): keep it, so nothing flashes.
  if (!root.querySelector('.ld3-ui')) root.innerHTML = MARKUP
  const q = (c: string) => root.querySelector<HTMLElement>('.' + c)!
  const o: Overlay = {
    root,
    stage: q('ld3-stage'),
    art: q('ld3-art'),
    kicker: q('ld3-kicker'),
    title: q('ld3-title'),
    sub: q('ld3-sub'),
    tip: q('ld3-tip'),
    status: q('ld3-status'),
    pct: q('ld3-pct'),
    bar: q('ld3-bar'),
    fill: q('ld3-bar i'),
    scene: null,
    shown3: null,
    artSrc: adopted ? (root.dataset.art ?? '') : '',
    tips: [],
    tipAt: 0,
    tipTimer: 0,
    shownAt: performance.now(),
    lastFrame: performance.now(),
    target: null,
    shown: 0,
    raf: 0,
    hideTimer: 0,
    fading: false,
  }
  o.stage.textContent = ''
  if (!o.status.textContent) o.status.textContent = 'Loading…'
  if (reducedMotion()) logo(o.stage)
  else {
    const canvas = document.createElement('canvas')
    o.stage.appendChild(canvas)
    three()
      .then((THREE) => {
        if (overlay !== o || o.fading) return
        o.scene = makeScene(THREE, canvas)
        if (!o.scene) {
          canvas.remove()
          logo(o.stage)
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

/** Cross-fade to a new full-bleed image; older ones go once it has landed. */
function setArt(o: Overlay, src: string | undefined, set: string | undefined, avif: string | undefined, thumb?: string) {
  if ((src ?? '') === o.artSrc) return
  o.artSrc = src ?? ''
  o.root.dataset.art = o.artSrc
  const old = [...o.art.children] as HTMLElement[]
  const hideOld = () => old.forEach((i) => (i.tagName === 'IMG' ? i : i.querySelector('img'))?.classList.remove('is-in'))
  if (!src) {
    hideOld()
    return
  }
  let blur: HTMLImageElement | null = null
  if (thumb) {
    blur = document.createElement('img')
    blur.alt = ''
    blur.className = 'ld3-blur'
    const b = blur
    b.onload = () => b.classList.add('is-in')
    b.src = thumb
    o.art.appendChild(b)
  }
  const img = document.createElement('img')
  img.alt = ''
  img.decoding = 'async'
  img.setAttribute('fetchpriority', 'high')
  if (set) {
    img.srcset = set
    img.sizes = '(orientation: portrait) 178vh, 100vw'
  }
  img.src = src
  const land = () => {
    img.classList.add('is-in')
    window.setTimeout(() => {
      old.forEach((i) => i.remove())
      blur?.remove()
    }, 900)
  }
  img.onload = () => {
    if (img.decode) img.decode().then(land, land)
    else land()
  }
  img.onerror = () => {
    holder.remove()
    hideOld()
  }
  let holder: HTMLElement = img
  if (avif) {
    holder = document.createElement('picture')
    const source = document.createElement('source')
    source.type = 'image/avif'
    source.srcset = avif
    source.sizes = img.sizes
    holder.append(source, img)
  }
  o.art.appendChild(holder)
}

function showTip(o: Overlay, fade: boolean) {
  if (!o.tips.length) {
    o.tip.textContent = ''
    return
  }
  const text = o.tips[o.tipAt % o.tips.length]
  const put = () => {
    o.tip.innerHTML = '<b>Tip</b>'
    o.tip.appendChild(document.createTextNode(text))
    o.tip.classList.remove('is-swap')
  }
  if (!fade || reducedMotion()) return put()
  o.tip.classList.add('is-swap')
  window.setTimeout(put, 350)
}

function applyScene(o: Overlay, sc: LoaderScene | null) {
  if (sc === o.shown3) return
  o.shown3 = sc
  o.kicker.textContent = sc?.kicker ?? ''
  o.title.textContent = sc?.title ?? ''
  o.sub.textContent = sc?.sub ?? ''
  if (sc?.accent) {
    o.root.style.setProperty('--ld3-a', sc.accent[0])
    o.root.style.setProperty('--ld3-b', sc.accent[1])
  }
  setArt(o, sc?.art, sc?.artSet, sc?.artAvif, sc?.artThumb)
  window.clearInterval(o.tipTimer)
  o.tips = sc?.tips ?? []
  o.tipAt = 0
  showTip(o, false)
  if (o.tips.length > 1)
    o.tipTimer = window.setInterval(() => {
      o.tipAt++
      showTip(o, true)
    }, TIP_MS)
}

function apply(o: Overlay, s: LoaderState) {
  if (s.scene) applyScene(o, s.scene)
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
  window.clearInterval(o.tipTimer)
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
  // Without a scene of its own, a loader shows the claimed one (the latest context wins), or the site's default.
  if (!state.scene) {
    if (claimed) applyScene(o, claimed)
    else if (!o.shown3) applyScene(o, fallback)
  }
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


