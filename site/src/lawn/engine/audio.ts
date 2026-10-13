// Synthesised cartoon sound: swooshes, thwacks, wood splinters, glass, water balloons, eggs, bear traps, alarm
// cans, ladders, KO stars, ultimates, the ice-cream jingle, seagulls, and a bouncy ukulele-ish loop. Everything is
// generated with WebAudio; nothing is downloaded.
import { isMuted } from '../../lib/sound'
import type { UltKind } from './heroes'

export class LawnAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private musicBus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private nextBeat = 0
  private beat = 0
  private musicOn = true
  private mood: 'calm' | 'raid' = 'calm'
  /** Listener position for distance attenuation. */
  lx = 0
  lz = 0

  start() {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
    } catch {
      return
    }
    const ctx = this.ctx
    this.master = ctx.createGain()
    this.master.gain.value = isMuted() ? 0 : 0.8
    this.master.connect(ctx.destination)
    this.sfx = ctx.createGain()
    this.sfx.gain.value = 0.9
    this.sfx.connect(this.master)
    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = this.musicOn ? 0.22 : 0
    this.musicBus.connect(this.master)
    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.nextBeat = ctx.currentTime + 0.2
  }

  setMusic(on: boolean) {
    this.musicOn = on
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.1)
  }

  setMood(m: 'calm' | 'raid') {
    this.mood = m
  }

  private att(x?: number, z?: number) {
    if (x === undefined || z === undefined) return 1
    const d = Math.hypot(x - this.lx, z - this.lz)
    return Math.max(0.05, 1 - d / 30)
  }

  private tone(freq: number, type: OscillatorType, t0: number, dur: number, vol: number, freqEnd?: number) {
    if (!this.ctx || !this.sfx || vol < 0.004) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(this.sfx)
    o.start(t0)
    o.stop(t0 + dur + 0.02)
  }

  private hiss(t0: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', sweepTo?: number) {
    if (!this.ctx || !this.sfx || !this.noise || vol < 0.004) return
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t0)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    s.connect(f).connect(g).connect(this.sfx)
    s.start(t0)
    s.stop(t0 + dur + 0.02)
  }

  private get t() {
    return this.ctx?.currentTime ?? 0
  }

  /* ---------- one-shots ---------- */

  swing(heavy: boolean) {
    this.hiss(this.t, heavy ? 0.28 : 0.16, heavy ? 0.22 : 0.14, heavy ? 500 : 900, 0.8, 'bandpass', heavy ? 180 : 400)
  }

  thwack(heavy: boolean, x?: number, z?: number) {
    const a = this.att(x, z)
    this.tone(heavy ? 150 : 220, 'square', this.t, 0.09, 0.2 * a, 60)
    this.hiss(this.t, 0.08, 0.18 * a, 1800, 1.5)
    if (heavy) this.tone(70, 'sine', this.t, 0.2, 0.25 * a, 40)
  }

  block(parry: boolean) {
    this.tone(parry ? 1400 : 600, 'triangle', this.t, parry ? 0.3 : 0.12, 0.22, parry ? 1900 : 300)
    this.hiss(this.t, 0.08, 0.1, 3000, 2)
  }

  chip(model: string, x?: number, z?: number) {
    const a = this.att(x, z)
    if (model === 'window') {
      this.tone(2400, 'triangle', this.t, 0.06, 0.12 * a, 1800)
      this.hiss(this.t, 0.1, 0.12 * a, 5000, 2)
    } else {
      this.tone(180, 'square', this.t, 0.05, 0.12 * a, 90)
      this.hiss(this.t, 0.12, 0.14 * a, 900, 0.7, 'bandpass', 300)
    }
  }

  crash(model: string, x?: number, z?: number) {
    const a = this.att(x, z)
    if (model === 'window' || model.includes('aquarium') || model.includes('tv') || model.includes('vase')) {
      for (let i = 0; i < 5; i++) this.tone(1800 + i * 350, 'triangle', this.t + i * 0.02, 0.18, 0.1 * a, 900)
      this.hiss(this.t, 0.4, 0.2 * a, 4500, 1.2, 'highpass')
    } else {
      this.tone(90, 'sawtooth', this.t, 0.3, 0.3 * a, 35)
      this.hiss(this.t, 0.35, 0.3 * a, 500, 0.6, 'lowpass', 120)
      for (let i = 0; i < 3; i++) this.tone(300 + i * 120, 'square', this.t + 0.05 + i * 0.05, 0.06, 0.08 * a, 120)
    }
    if (model.includes('valuable')) this.tone(880, 'sine', this.t + 0.1, 0.5, 0.12, 1320)
  }

  throw_() {
    this.hiss(this.t, 0.18, 0.12, 1200, 1, 'bandpass', 2600)
  }

  splash(kind: string, x?: number, z?: number) {
    const a = this.att(x, z)
    if (kind === 'balloon') {
      this.hiss(this.t, 0.3, 0.3 * a, 1400, 0.8, 'bandpass', 500)
      this.tone(320, 'sine', this.t, 0.1, 0.12 * a, 120)
    } else if (kind === 'egg') {
      this.tone(500, 'square', this.t, 0.05, 0.12 * a, 140)
      this.hiss(this.t, 0.14, 0.14 * a, 2500, 1)
    } else if (kind === 'paint' || kind === 'jar') {
      this.tone(1500, 'triangle', this.t, 0.1, 0.1 * a, 700)
      this.hiss(this.t, 0.3, 0.22 * a, 2000, 0.9, 'bandpass', 600)
    } else if (kind === 'gnome') {
      this.tone(160, 'square', this.t, 0.1, 0.22 * a, 50)
      this.hiss(this.t, 0.15, 0.16 * a, 1200, 1)
    } else {
      this.tone(700, 'triangle', this.t, 0.05, 0.12 * a, 300)
    }
  }

  trap(kind: string, x?: number, z?: number) {
    const a = this.att(x, z)
    if (kind === 'beartrap') {
      this.tone(2200, 'square', this.t, 0.04, 0.2 * a, 900)
      this.tone(120, 'sawtooth', this.t + 0.03, 0.15, 0.25 * a, 50)
    } else if (kind === 'rake') {
      this.tone(900, 'square', this.t, 0.05, 0.18 * a, 300)
      this.tone(1600, 'sine', this.t + 0.06, 0.35, 0.12 * a, 2600)
    } else if (kind === 'marbles') {
      for (let i = 0; i < 8; i++) this.tone(2400 + (i % 3) * 400, 'sine', this.t + i * 0.04, 0.05, 0.06 * a)
      this.tone(200, 'square', this.t + 0.3, 0.1, 0.18 * a, 60)
    } else if (kind === 'alarm') {
      for (let i = 0; i < 12; i++) this.tone(3000 + ((i * 7) % 5) * 300, 'square', this.t + i * 0.07, 0.04, 0.12 * a)
    } else if (kind === 'pit') {
      this.tone(600, 'sine', this.t, 0.4, 0.2 * a, 90)
      this.hiss(this.t + 0.3, 0.2, 0.15 * a, 800, 1)
    } else this.hiss(this.t, 0.4, 0.1 * a, 3000, 0.5)
  }

  place() {
    this.tone(420, 'triangle', this.t, 0.07, 0.12)
    this.tone(640, 'triangle', this.t + 0.07, 0.1, 0.1)
  }

  ladder(x?: number, z?: number) {
    const a = this.att(x, z)
    this.tone(300, 'square', this.t, 0.06, 0.14 * a, 150)
    this.tone(260, 'square', this.t + 0.1, 0.08, 0.12 * a, 120)
  }

  barricade(x?: number, z?: number) {
    const a = this.att(x, z)
    for (let i = 0; i < 3; i++) this.tone(400 - i * 60, 'square', this.t + i * 0.09, 0.06, 0.16 * a, 150)
  }

  ko(mine: boolean, x?: number, z?: number) {
    const a = mine ? 1 : this.att(x, z)
    this.tone(500, 'sine', this.t, 0.5, 0.2 * a, 80)
    for (let i = 0; i < 6; i++) this.tone(1200 + i * 160, 'sine', this.t + 0.1 + i * 0.07, 0.12, 0.06 * a)
  }

  respawn() {
    this.tone(660, 'triangle', this.t, 0.1, 0.1)
    this.tone(990, 'triangle', this.t + 0.1, 0.15, 0.1)
  }

  ult(kind: UltKind, x?: number, z?: number) {
    const a = this.att(x, z)
    const t = this.t
    switch (kind) {
      case 'cookies':
        this.tone(220, 'sawtooth', t, 0.3, 0.2 * a, 90)
        this.hiss(t + 0.2, 1.2, 0.18 * a, 2500, 0.6, 'highpass')
        break
      case 'blower':
        this.hiss(t, 1.6, 0.3 * a, 300, 0.5, 'lowpass', 900)
        this.tone(80, 'sawtooth', t, 1.6, 0.14 * a, 140)
        break
      case 'rccar':
        this.tone(900, 'sawtooth', t, 1.2, 0.1 * a, 1600)
        break
      case 'towtruck':
        this.tone(55, 'sawtooth', t, 2.5, 0.25 * a, 110)
        this.tone(440, 'square', t, 0.25, 0.14 * a)
        this.tone(440, 'square', t + 0.35, 0.25, 0.14 * a)
        break
      case 'mower':
        this.tone(60, 'sawtooth', t, 3, 0.2 * a, 95)
        this.hiss(t, 3, 0.12 * a, 400, 0.6, 'lowpass')
        break
      case 'zoomies':
        this.tone(900, 'square', t, 0.08, 0.14 * a, 1400)
        this.tone(900, 'square', t + 0.12, 0.08, 0.14 * a, 1400)
        this.hiss(t, 1, 0.2 * a, 1500, 0.7, 'bandpass', 3500)
        break
    }
  }

  explode(x?: number, z?: number) {
    const a = this.att(x, z)
    this.tone(60, 'sine', this.t, 0.6, 0.4 * a, 25)
    this.hiss(this.t, 0.7, 0.35 * a, 700, 0.5, 'lowpass', 90)
    for (let i = 0; i < 4; i++) this.tone(900 + i * 500, 'square', this.t + 0.1 + i * 0.08, 0.05, 0.05 * a)
  }

  ultReady() {
    this.tone(880, 'sine', this.t, 0.12, 0.1)
    this.tone(1320, 'sine', this.t + 0.12, 0.2, 0.1)
  }

  score() {
    for (let i = 0; i < 4; i++) this.tone(660 * Math.pow(1.26, i), 'triangle', this.t + i * 0.07, 0.14, 0.11)
  }

  seagull() {
    for (let i = 0; i < 3; i++) this.tone(1800, 'sawtooth', this.t + i * 0.25, 0.18, 0.08, 1100)
  }

  icecream(on: boolean) {
    if (!on) return
    const notes = [523, 659, 784, 659, 523, 659, 784, 880]
    notes.forEach((n, i) => this.tone(n, 'triangle', this.t + i * 0.22, 0.2, 0.1))
  }

  alarm() {
    for (let i = 0; i < 6; i++) this.tone(2600, 'square', this.t + i * 0.12, 0.05, 0.08)
  }

  whistle(start: boolean) {
    if (start) {
      this.tone(1500, 'sine', this.t, 0.6, 0.16, 2200)
      this.hiss(this.t, 0.6, 0.08, 4000, 3)
    } else this.tone(1100, 'sine', this.t, 0.15, 0.12)
  }

  stinger(win: boolean) {
    const t = this.t
    const seq = win ? [523, 659, 784, 1047] : [392, 349, 311, 262]
    seq.forEach((f, i) => this.tone(f, 'triangle', t + i * 0.16, 0.3, 0.16))
  }

  /* ---------- music ---------- */

  update(dt: number) {
    void dt
    if (!this.ctx || !this.musicOn || !this.musicBus) return
    const ctx = this.ctx
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.playBeat(this.nextBeat, this.beat)
      const bpm = this.mood === 'raid' ? 128 : 104
      this.nextBeat += 60 / bpm / 2
      this.beat++
    }
  }

  private playBeat(t: number, beat: number) {
    if (!this.ctx || !this.musicBus) return
    const ctx = this.ctx
    const chords = [
      [261.6, 329.6, 392],
      [349.2, 440, 523.3],
      [392, 493.9, 587.3],
      [349.2, 440, 523.3],
    ]
    const bar = Math.floor(beat / 8) % 4
    const chord = chords[bar]
    const pluck = (f: number, when: number, vol: number, dur = 0.28) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, when)
      g.gain.exponentialRampToValueAtTime(vol, when + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
      o.connect(g).connect(this.musicBus!)
      o.start(when)
      o.stop(when + dur + 0.02)
    }
    // Ukulele-ish strum on the off-beats, bass on the downbeat, a shaker every half beat.
    if (beat % 2 === 1) chord.forEach((f, i) => pluck(f * 2, t + i * 0.012, 0.11))
    if (beat % 8 === 0) pluck(chord[0] / 2, t, 0.2, 0.5)
    if (beat % 4 === 2) pluck(chord[0] / 2, t, 0.14, 0.3)
    if (this.noise) {
      const s = ctx.createBufferSource()
      s.buffer = this.noise
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = 6000
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(beat % 2 ? 0.05 : 0.025, t + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
      s.connect(f).connect(g).connect(this.musicBus)
      s.start(t)
      s.stop(t + 0.1)
    }
    if (this.mood === 'raid' && beat % 16 === 14) [chord[2] * 2, chord[1] * 2, chord[0] * 2].forEach((f, i) => pluck(f, t + i * 0.09, 0.09, 0.15))
  }

  dispose() {
    void this.ctx?.close()
    this.ctx = null
  }
}
