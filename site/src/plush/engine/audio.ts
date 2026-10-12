// Every sound in PLUSH PANIC is made here with WebAudio: boops, squeaks, crunches, cheers, and a wind-up
// music box that plays an original waltz, speeds up, and winds down when the ballerina is about to look.
import { isMuted } from '../../lib/sound'

type Ctx = AudioContext

// An original sixteen-bar waltz in G (MIDI note, beats). Three beats a bar.
const MELODY: [number, number][] = [
  [71, 1], [74, 1], [79, 1], [78, 2], [76, 1], [74, 1], [76, 1], [74, 1], [71, 3],
  [72, 1], [76, 1], [81, 1], [79, 2], [78, 1], [76, 1], [78, 1], [81, 1], [74, 3],
  [71, 1], [74, 1], [79, 1], [83, 2], [81, 1], [79, 1], [76, 1], [72, 1], [71, 2], [74, 1],
  [72, 1], [71, 1], [69, 1], [74, 1], [78, 1], [81, 1], [79, 1.5], [78, 0.5], [81, 1], [79, 3],
]
// Bass root per bar.
const BASS = [55, 50, 55, 55, 48, 55, 57, 50, 55, 55, 48, 55, 57, 50, 50, 55]

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

export class MusicBox {
  playing = false
  /** Beats per minute; the level raises it each verse. */
  tempo = 150
  private a: PlushAudio
  private next = 0 // audio time of the next note
  private idx = 0
  private beatInBar = 0
  private bar = 0
  private wind = 1 // pitch factor while winding down
  private windRate = 0
  private out: GainNode | null = null

  constructor(a: PlushAudio) {
    this.a = a
  }

  start(tempo: number) {
    const c = this.a.ensure()
    this.tempo = tempo
    this.wind = 1
    this.windRate = 0
    if (!c) {
      this.playing = true
      return
    }
    if (!this.out) {
      this.out = c.createGain()
      this.out.gain.value = 0.5
      this.out.connect(this.a.bus!)
    }
    if (!this.playing) this.next = c.currentTime + 0.05
    this.playing = true
  }

  /** Slow down and drop in pitch over `seconds`, then stop: the tell before the freeze. */
  windDown(seconds: number) {
    this.windRate = 1 / Math.max(0.1, seconds)
  }

  stop() {
    this.playing = false
    this.windRate = 0
    this.wind = 1
  }

  /** Schedule notes a little ahead. Call every frame. */
  update(dt: number) {
    const c = this.a.ctx
    if (!this.playing || !c || !this.out) return
    if (this.windRate > 0) {
      this.wind = Math.max(0.55, this.wind - this.windRate * dt * 0.45)
      if (this.wind <= 0.56) this.stop()
    }
    const ahead = c.currentTime + 0.15
    while (this.next < ahead && this.playing) {
      const [note, beats] = MELODY[this.idx]
      const beat = 60 / (this.tempo * this.wind)
      const f = this.wind < 1 ? 1 - (1 - this.wind) * 0.12 : 1
      this.a.pling(this.out, midi(note) * f, this.next, 0.22)
      if (this.beatInBar === 0) this.a.pling(this.out, midi(BASS[this.bar % BASS.length]) * f, this.next, 0.14)
      else if (Number.isInteger(this.beatInBar)) this.a.pling(this.out, midi(BASS[this.bar % BASS.length] + 12) * f, this.next, 0.05)
      this.next += beats * beat
      this.beatInBar += beats
      while (this.beatInBar >= 3) {
        this.beatInBar -= 3
        this.bar++
      }
      this.idx = (this.idx + 1) % MELODY.length
      if (this.idx === 0) {
        this.bar = 0
        this.beatInBar = 0
      }
    }
  }
}

export class PlushAudio {
  ctx: Ctx | null = null
  bus: GainNode | null = null
  readonly music: MusicBox
  private noiseBuf: AudioBuffer | null = null
  /** Listener position for distance falloff (set from the camera each frame). */
  lx = 0
  ly = 0
  lz = 0
  private last = new Map<string, number>()

  constructor() {
    this.music = new MusicBox(this)
  }

  /** Create the context (needs a user gesture to actually sound; harmless before). */
  ensure(): Ctx | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
      return this.ctx
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      this.ctx = new AC()
      this.bus = this.ctx.createGain()
      this.bus.gain.value = isMuted() ? 0 : 0.55
      this.bus.connect(this.ctx.destination)
      const n = this.ctx.sampleRate
      this.noiseBuf = this.ctx.createBuffer(1, n, n)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    } catch {
      this.ctx = null
    }
    return this.ctx
  }

  setMuted(m: boolean) {
    if (this.bus) this.bus.gain.value = m ? 0 : 0.55
  }

  dispose() {
    this.music.stop()
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }

  /** One music-box tine: a bright sine with an inharmonic shimmer and a long ring. */
  pling(out: AudioNode, f: number, t: number, vol: number) {
    const c = this.ctx!
    const g = c.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0008, t + 1.4)
    g.connect(out)
    const o1 = c.createOscillator()
    o1.frequency.value = f
    o1.connect(g)
    const g2 = c.createGain()
    g2.gain.setValueAtTime(vol * 0.5, t)
    g2.gain.exponentialRampToValueAtTime(0.0005, t + 0.25)
    g2.connect(out)
    const o2 = c.createOscillator()
    o2.frequency.value = f * 4.07
    o2.connect(g2)
    o1.start(t)
    o2.start(t)
    o1.stop(t + 1.5)
    o2.stop(t + 0.3)
  }

  private env(t: number, a: number, peak: number, d: number) {
    const g = this.ctx!.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
    return g
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0, out?: AudioNode) {
    const c = this.ctx!
    const t = c.currentTime + at
    const o = c.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = this.env(t, 0.006, vol, dur)
    o.connect(g).connect(out ?? this.bus!)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private noise(dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', at = 0, sweep?: number) {
    const c = this.ctx!
    const t = c.currentTime + at
    const s = c.createBufferSource()
    s.buffer = this.noiseBuf
    s.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = c.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t)
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur)
    f.Q.value = q
    const g = this.env(t, 0.004, vol, dur)
    s.connect(f).connect(g).connect(this.bus!)
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.05)
  }

  /**
   * Play a named effect. `pos` attenuates with distance from the listener. Rapid repeats of the same sound are
   * thinned out so a pile-up doesn't clip.
   */
  play(name: string, pos?: { x: number; y: number; z: number }, vol = 1) {
    const c = this.ctx
    if (!c || !this.bus || isMuted()) return
    const now = c.currentTime
    if ((this.last.get(name) ?? -1) > now - 0.045) return
    this.last.set(name, now)
    let v = vol
    if (pos) {
      const d = Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz)
      v *= Math.max(0, 1 - d / 45)
      if (v < 0.03) return
    }
    const r = 0.9 + Math.random() * 0.2
    switch (name) {
      case 'boop':
        this.tone('sine', 520 * r, 260 * r, 0.14, 0.25 * v)
        break
      case 'squeak':
        this.tone('triangle', 900 * r, 1700 * r, 0.07, 0.12 * v)
        this.tone('triangle', 1700 * r, 1100 * r, 0.09, 0.1 * v, 0.07)
        break
      case 'pop':
        this.tone('sine', 900 * r, 120, 0.09, 0.35 * v)
        this.noise(0.05, 0.2 * v, 3000)
        break
      case 'crunch':
        for (let i = 0; i < 5; i++) this.noise(0.05 + Math.random() * 0.05, 0.35 * v, 1800 + Math.random() * 2500, 2, 'bandpass', i * 0.035)
        break
      case 'crack':
        this.noise(0.12, 0.6 * v, 2600, 0.7, 'highpass')
        this.tone('square', 220, 70, 0.12, 0.12 * v)
        this.noise(0.3, 0.25 * v, 900, 3, 'bandpass', 0.05, 300)
        break
      case 'cheer':
        this.noise(0.9, 0.12 * v, 1400, 0.6, 'bandpass', 0, 2600)
        for (let i = 0; i < 4; i++) this.tone('triangle', 600 + i * 150, 900 + i * 220, 0.12, 0.06 * v, i * 0.08)
        break
      case 'whoosh':
        this.noise(0.25, 0.2 * v, 500, 1.2, 'bandpass', 0, 2400)
        break
      case 'thud':
        this.tone('sine', 140 * r, 45, 0.22, 0.45 * v)
        this.noise(0.08, 0.18 * v, 400, 1, 'lowpass')
        break
      case 'ding':
        this.tone('sine', 1320, 1310, 0.5, 0.18 * v)
        this.tone('sine', 1980, 1970, 0.35, 0.08 * v)
        break
      case 'coin':
        this.tone('square', 990, 990, 0.06, 0.06 * v)
        this.tone('square', 1320, 1320, 0.12, 0.06 * v, 0.06)
        break
      case 'buzz':
        this.tone('sawtooth', 160, 110, 0.4, 0.14 * v)
        break
      case 'zap':
        this.tone('sawtooth', 1400, 90, 0.35, 0.16 * v)
        this.noise(0.3, 0.12 * v, 4000, 0.8, 'highpass')
        break
      case 'tick':
        this.tone('square', 1800, 1800, 0.025, 0.05 * v)
        break
      case 'snip':
        this.noise(0.05, 0.4 * v, 5000, 2, 'highpass')
        this.tone('triangle', 2400, 1800, 0.06, 0.08 * v, 0.02)
        this.noise(0.08, 0.3 * v, 3000, 2, 'bandpass', 0.12)
        break
      case 'slam':
        this.tone('sine', 110, 40, 0.35, 0.6 * v)
        this.noise(0.2, 0.4 * v, 300, 0.8, 'lowpass')
        break
      case 'splash':
        this.noise(0.4, 0.3 * v, 1200, 0.5, 'bandpass', 0, 400)
        break
      case 'wind':
        for (let i = 0; i < 6; i++) this.tone('square', 2200, 2100, 0.02, 0.04 * v, i * 0.05)
        break
      case 'boing':
        this.tone('sine', 180, 520, 0.18, 0.25 * v)
        this.tone('sine', 520, 260, 0.2, 0.15 * v, 0.16)
        break
      case 'throw':
        this.noise(0.15, 0.15 * v, 1500, 1, 'bandpass', 0, 600)
        break
      case 'out':
        this.tone('triangle', 440, 220, 0.25, 0.18 * v)
        this.tone('triangle', 330, 150, 0.35, 0.16 * v, 0.2)
        break
      case 'go':
        this.tone('square', 880, 880, 0.25, 0.1 * v)
        break
      case 'count':
        this.tone('square', 440, 440, 0.12, 0.08 * v)
        break
      default:
        this.tone('sine', 600, 300, 0.1, 0.15 * v)
    }
  }
}
