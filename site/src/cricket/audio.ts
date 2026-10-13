// Procedural WebAudio: a crowd bed that swells and roars, bat crack, edges, pad thuds, stumps, the bounce, catches,
// appeals ("howzat!") and the "ooh" when a batter is beaten. No audio files.
import { isMuted } from '../lib/sound'

export class CricketAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private crowdGain: GainNode | null = null
  private crowdFilter: BiquadFilterNode | null = null
  private noise: AudioBuffer | null = null
  private level = 0.18
  private target = 0.18
  muted = isMuted()

  /** Starts on the first user gesture (browsers block audio before that). */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
    } catch {
      return
    }
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    this.master.connect(ctx.destination)
    // White-ish noise buffer, reused.
    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let b = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b = 0.97 * b + 0.03 * w
      d[i] = w * 0.6 + b * 2
    }
    // Crowd bed: filtered noise with a slow murmur.
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    this.crowdFilter = ctx.createBiquadFilter()
    this.crowdFilter.type = 'bandpass'
    this.crowdFilter.frequency.value = 700
    this.crowdFilter.Q.value = 0.6
    this.crowdGain = ctx.createGain()
    this.crowdGain.gain.value = this.level
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master)
    src.start()
  }

  setMuted(m: boolean) {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  /** Raises the crowd for a while (0..1). */
  swell(level: number, seconds = 2.5) {
    this.target = Math.max(this.target, 0.18 + level * 0.65)
    window.setTimeout(() => (this.target = 0.18), seconds * 1000)
  }

  update(dt: number) {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter) return
    this.level += (this.target - this.level) * Math.min(1, dt * 3)
    const t = this.ctx.currentTime
    const murmur = 1 + Math.sin(t * 0.7) * 0.08 + Math.sin(t * 1.9) * 0.05
    this.crowdGain.gain.setTargetAtTime(this.level * murmur, t, 0.1)
    this.crowdFilter.frequency.setTargetAtTime(600 + this.level * 900, t, 0.2)
  }

  private burst(opts: { freq: number; q: number; gain: number; dur: number; type?: BiquadFilterType; attack?: number; delay?: number }) {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.master) return
    const t = ctx.currentTime + (opts.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = ctx.createBiquadFilter()
    f.type = opts.type ?? 'bandpass'
    f.frequency.value = opts.freq
    f.Q.value = opts.q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(opts.gain, t + (opts.attack ?? 0.003))
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random())
    src.stop(t + opts.dur + 0.05)
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', glide = 0, delay = 0) {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + glide), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  /** Bat on ball: a sharp crack with a woody body, louder for a middled shot. */
  bat(quality: number, edge = false) {
    if (edge) {
      this.burst({ freq: 3200, q: 4, gain: 0.25, dur: 0.06 })
      this.tone(900, 0.05, 0.08, 'triangle', -300)
      return
    }
    const k = 0.4 + quality * 0.6
    this.burst({ freq: 2400, q: 2.5, gain: 0.55 * k, dur: 0.07 })
    this.burst({ freq: 900, q: 3, gain: 0.35 * k, dur: 0.12 })
    this.tone(520 + quality * 140, 0.09, 0.18 * k, 'triangle', -200)
  }

  pad() {
    this.burst({ freq: 300, q: 1.2, gain: 0.35, dur: 0.12 })
  }
  bounce(speed: number) {
    this.burst({ freq: 180, q: 1, gain: Math.min(0.3, 0.06 + speed * 0.006), dur: 0.08 })
  }
  stumps() {
    for (let i = 0; i < 3; i++) this.burst({ freq: 1500 + i * 600, q: 6, gain: 0.3, dur: 0.12, delay: i * 0.03 })
    this.tone(700, 0.15, 0.1, 'square', -200)
  }
  catchSlap() {
    this.burst({ freq: 1100, q: 1.5, gain: 0.3, dur: 0.06 })
  }
  keeper() {
    this.burst({ freq: 600, q: 1.5, gain: 0.3, dur: 0.07 })
  }
  /** A crowd roar (boundary 0.6, six 1, wicket 0.9). */
  roar(level: number) {
    this.swell(level, 3.2)
    this.burst({ freq: 900, q: 0.5, gain: 0.2 + level * 0.35, dur: 2.2 + level, attack: 0.15 })
    this.burst({ freq: 1800, q: 0.7, gain: 0.08 + level * 0.18, dur: 1.6 + level, attack: 0.2 })
  }
  ooh() {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    // Many voices on a vowel: low formant noise that falls.
    this.burst({ freq: 420, q: 3, gain: 0.25, dur: 1.1, attack: 0.08 })
    this.burst({ freq: 780, q: 4, gain: 0.12, dur: 0.9, attack: 0.08 })
    this.swell(0.35, 1.2)
  }
  /** "Howzat!": two shouted syllables. */
  appeal() {
    this.tone(260, 0.18, 0.18, 'sawtooth', 60)
    this.burst({ freq: 900, q: 2, gain: 0.25, dur: 0.2 })
    this.tone(330, 0.35, 0.18, 'sawtooth', -120, 0.2)
    this.burst({ freq: 1200, q: 2, gain: 0.2, dur: 0.35, delay: 0.2 })
    this.swell(0.5, 1.5)
  }
  applause(seconds = 2) {
    for (let i = 0; i < 24; i++) this.burst({ freq: 2000 + Math.random() * 2500, q: 3, gain: 0.05, dur: 0.05, delay: Math.random() * seconds })
  }
  click() {
    this.tone(1200, 0.04, 0.06, 'square')
  }
  release() {
    this.burst({ freq: 400, q: 0.8, gain: 0.08, dur: 0.15 })
  }
  /** A replay's swish between shots. */
  whoosh() {
    this.burst({ freq: 1400, q: 0.7, gain: 0.12, dur: 0.35, attack: 0.12 })
    this.tone(420, 0.3, 0.03, 'sine', 600)
  }
  /** The third umpire / ball tracking: two electronic blips. */
  drs() {
    this.tone(880, 0.09, 0.07, 'square')
    this.tone(1320, 0.12, 0.06, 'square', 0, 0.12)
  }
  /** Broadcast stings: a short chord, rising for runs, falling for a wicket. */
  sting(kind: 'four' | 'six' | 'wicket' | 'milestone' | 'maiden') {
    const chords: Record<string, number[]> = { four: [392, 494, 587], six: [392, 494, 587, 784], wicket: [440, 349, 262], milestone: [523, 659, 784, 1047], maiden: [330, 392] }
    const notes = chords[kind]
    const rising = kind !== 'wicket'
    notes.forEach((f, i) => {
      const d = i * (kind === 'milestone' ? 0.11 : 0.07)
      this.tone(f, 0.5 + (rising ? i * 0.05 : 0), 0.06, 'sawtooth', rising ? 0 : -20, d)
      this.tone(f * 2, 0.35, 0.025, 'triangle', 0, d)
    })
    if (kind === 'wicket' || kind === 'six') this.burst({ freq: 120, q: 0.8, gain: 0.35, dur: 0.5, attack: 0.01 })
  }
  /** A batter's call between the wickets ("yes!", "no!", "wait!"). */
  call(kind: string) {
    const f = kind === 'yes' ? 300 : kind === 'no' ? 220 : 260
    this.tone(f, 0.16, 0.12, 'sawtooth', kind === 'no' ? -60 : 40)
    this.burst({ freq: kind === 'yes' ? 1300 : 800, q: 2, gain: 0.12, dur: 0.14 })
  }
  /** The meter needle crossing into the green. */
  tick() {
    this.tone(1600, 0.03, 0.04, 'square')
  }
  close() {
    void this.ctx?.close()
    this.ctx = null
  }
}
