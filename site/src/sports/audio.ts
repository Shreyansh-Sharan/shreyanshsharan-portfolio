// WebAudio sound for the complex, all synthesised: the F1 engine, crowd ambience and cheers, ball strikes, whistles.
import { isMuted } from '../lib/sound'

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null
  private crowd: { src: AudioBufferSourceNode; gain: GainNode } | null = null

  /** Audio can only start after a user gesture; call from input handlers. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(this.ctx.destination)
      const len = this.ctx.sampleRate * 2
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } catch {
      this.ctx = null
    }
  }

  private get ok() {
    return !!this.ctx && !!this.master && !isMuted()
  }

  beep(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0) {
    if (!this.ok) return
    const a = this.ctx!
    const t = a.currentTime + delay
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.master!)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  /** Filtered noise burst with an attack/decay envelope. */
  noise(dur: number, gain: number, freq: number, type: BiquadFilterType = 'lowpass', attack = 0.005, delay = 0, q = 0.8) {
    if (!this.ok || !this.noiseBuf) return
    const a = this.ctx!
    const t = a.currentTime + delay
    const src = a.createBufferSource()
    src.buffer = this.noiseBuf
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = a.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.master!)
    src.start(t, Math.random())
    src.stop(t + dur + 0.05)
  }

  /* ---------- Stadium ---------- */

  kick(power: number) {
    this.noise(0.09, 0.5 + power * 0.3, 2400)
    this.beep(110 + power * 60, 0.12, 'triangle', 0.16)
  }

  whistle() {
    if (!this.ok) return
    const a = this.ctx!
    const o = a.createOscillator()
    const lfo = a.createOscillator()
    const lg = a.createGain()
    const g = a.createGain()
    o.type = 'sine'
    o.frequency.value = 2900
    lfo.frequency.value = 38
    lg.gain.value = 90
    lfo.connect(lg).connect(o.frequency)
    const t = a.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.02)
    g.gain.setValueAtTime(0.05, t + 0.32)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4)
    o.connect(g).connect(this.master!)
    o.start(t)
    lfo.start(t)
    o.stop(t + 0.42)
    lfo.stop(t + 0.42)
  }

  /** A roar: several swelling bands of noise. */
  cheer(big = 1) {
    this.noise(2.6 * big, 0.32 * big, 1400, 'bandpass', 0.25, 0, 0.5)
    this.noise(2.2 * big, 0.22 * big, 2600, 'bandpass', 0.35, 0.05, 0.7)
    this.noise(1.8 * big, 0.2 * big, 700, 'bandpass', 0.2, 0, 0.6)
    for (let k = 0; k < 5; k++) this.beep(900 + Math.random() * 900, 0.25, 'sine', 0.012, 0.2 + Math.random() * 1.2)
  }

  /** The crowd's "oooh". */
  groan() {
    if (!this.ok || !this.noiseBuf) return
    const a = this.ctx!
    const t = a.currentTime
    const src = a.createBufferSource()
    src.buffer = this.noiseBuf
    const f = a.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 3
    f.frequency.setValueAtTime(700, t)
    f.frequency.exponentialRampToValueAtTime(320, t + 1.3)
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.2)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    src.connect(f).connect(g).connect(this.master!)
    src.start(t, Math.random())
    src.stop(t + 1.6)
  }

  thud() {
    this.noise(0.25, 0.4, 260)
  }

  crowdStart() {
    if (!this.ok || !this.noiseBuf || this.crowd) return
    const a = this.ctx!
    const src = a.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = a.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 900
    f.Q.value = 0.4
    const gain = a.createGain()
    gain.gain.value = 0.0001
    gain.gain.linearRampToValueAtTime(0.07, a.currentTime + 1)
    src.connect(f).connect(gain).connect(this.master!)
    src.start()
    this.crowd = { src, gain }
  }

  crowdStop() {
    if (!this.crowd || !this.ctx) return
    const c = this.crowd
    this.crowd = null
    c.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2)
    c.src.stop(this.ctx.currentTime + 0.8)
  }

  /* ---------- Rally hall ---------- */

  hit(sport: 'badminton' | 'tabletennis', quality: number) {
    if (sport === 'badminton') {
      this.noise(0.06, 0.35 + quality * 0.25, 4200, 'highpass')
      this.beep(520 + quality * 200, 0.05, 'triangle', 0.06)
    } else {
      this.beep(1300 + quality * 300, 0.04, 'square', 0.05)
      this.noise(0.03, 0.25, 5000, 'highpass')
    }
  }

  bounce() {
    this.beep(950, 0.035, 'square', 0.04)
  }

  point(won: boolean) {
    if (won) {
      this.beep(660, 0.12, 'triangle', 0.08)
      this.beep(990, 0.2, 'triangle', 0.08, 0.1)
    } else this.beep(220, 0.3, 'sawtooth', 0.04)
  }

  unlock() {
    this.beep(784, 0.12, 'triangle', 0.08)
    this.beep(1047, 0.14, 'triangle', 0.08, 0.1)
    this.beep(1568, 0.3, 'triangle', 0.07, 0.2)
  }

  /* ---------- F1 ---------- */

  engineStart() {
    if (!this.ok || this.engine) return
    const a = this.ctx!
    const osc = a.createOscillator()
    const osc2 = a.createOscillator()
    osc.type = 'sawtooth'
    osc2.type = 'square'
    const filter = a.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    const gain = a.createGain()
    gain.gain.value = 0.0001
    gain.gain.linearRampToValueAtTime(0.05, a.currentTime + 0.4)
    osc.connect(filter)
    osc2.connect(filter)
    filter.connect(gain).connect(this.master!)
    osc.start()
    osc2.start()
    this.engine = { osc, osc2, filter, gain }
  }

  /** Pitch follows a stepped rev band per gear. */
  engineUpdate(speed: number, throttle: number) {
    if (!this.engine || !this.ctx) return
    const gearSpan = 12
    const gear = Math.min(7, Math.floor(speed / gearSpan))
    const rev = (speed - gear * gearSpan) / gearSpan
    const f = 70 + gear * 9 + rev * 95 + throttle * 12
    const t = this.ctx.currentTime
    this.engine.osc.frequency.setTargetAtTime(f, t, 0.03)
    this.engine.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03)
    this.engine.filter.frequency.setTargetAtTime(500 + rev * 900 + throttle * 600, t, 0.05)
    this.engine.gain.gain.setTargetAtTime(isMuted() ? 0 : 0.03 + throttle * 0.03, t, 0.08)
  }

  engineStop() {
    if (!this.engine || !this.ctx) return
    const e = this.engine
    this.engine = null
    const t = this.ctx.currentTime
    e.gain.gain.setTargetAtTime(0.0001, t, 0.1)
    e.osc.stop(t + 0.5)
    e.osc2.stop(t + 0.5)
  }

  dispose() {
    this.engine = null
    this.crowd = null
    void this.ctx?.close()
    this.ctx = null
  }
}
