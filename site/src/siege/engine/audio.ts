// Synthesised sound: blasters per weapon, hits, explosions, supers, dashes, loot, the countdown, round stingers
// and a synthwave loop. Everything is generated with WebAudio; nothing is downloaded.
import { isMuted } from '../../lib/sound'
import type { HeroId } from './heroes'
import type { PowerKind } from './powers'
import type { ProjKind } from './sim'

export class SiegeAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private musicBus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private nextBeat = 0
  private beat = 0
  private musicOn = true
  private timer = 0
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
    this.musicBus.gain.value = this.musicOn ? 0.26 : 0
    this.musicBus.connect(this.master)
    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.nextBeat = ctx.currentTime + 0.2
  }

  setMusic(on: boolean) {
    this.musicOn = on
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.26 : 0, this.ctx.currentTime, 0.1)
  }

  /** Volume for something at (x, z) relative to the listener. */
  private att(x?: number, z?: number) {
    if (x === undefined || z === undefined) return 1
    const d = Math.hypot(x - this.lx, z - this.lz)
    return Math.max(0.08, 1 - d / 34)
  }

  private tone(freq: number, type: OscillatorType, t0: number, dur: number, vol: number, freqEnd?: number) {
    if (!this.ctx || !this.sfx) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g).connect(this.sfx)
    o.start(t0)
    o.stop(t0 + dur + 0.02)
  }

  private hiss(t0: number, dur: number, vol: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass', sweepTo?: number) {
    if (!this.ctx || !this.sfx || !this.noise) return
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    s.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.setValueAtTime(freq, t0)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    s.connect(f).connect(g).connect(this.sfx)
    s.start(t0)
    s.stop(t0 + dur + 0.02)
  }

  /* ---------- One-shots ---------- */

  shot(kind: ProjKind, x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = this.att(x, z)
    switch (kind) {
      case 'pellet':
        this.hiss(t, 0.16, 0.5 * v, 900, 0.6, 'lowpass')
        this.tone(140, 'square', t, 0.12, 0.25 * v, 50)
        break
      case 'rail':
        this.tone(1800, 'sawtooth', t, 0.22, 0.22 * v, 220)
        this.hiss(t, 0.2, 0.3 * v, 3000, 2, 'bandpass', 500)
        break
      case 'flame':
        if (Math.random() < 0.35) this.hiss(t, 0.18, 0.12 * v, 500, 0.5, 'lowpass')
        break
      case 'bullet':
        this.tone(900, 'square', t, 0.06, 0.12 * v, 300)
        this.hiss(t, 0.05, 0.18 * v, 2500, 1)
        break
      case 'needle':
        this.tone(1400, 'triangle', t, 0.08, 0.14 * v, 900)
        break
      case 'grenade':
        this.tone(220, 'sine', t, 0.25, 0.3 * v, 90)
        this.hiss(t, 0.12, 0.25 * v, 700, 0.7, 'lowpass')
        break
      case 'turret':
        this.tone(700, 'square', t, 0.06, 0.1 * v, 400)
        break
      case 'dart':
        this.tone(2400, 'sine', t, 0.12, 0.18 * v, 1200)
        this.hiss(t, 0.1, 0.16 * v, 5000, 3)
        break
      case 'toxin':
        this.tone(160, 'triangle', t, 0.25, 0.3 * v, 80)
        this.hiss(t, 0.3, 0.2 * v, 900, 0.8, 'lowpass')
        break
    }
  }

  /** Signature powers, one voice each. */
  power(kind: PowerKind, x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = this.att(x, z)
    switch (kind) {
      case 'wall':
        this.tone(90, 'square', t, 0.35, 0.3 * v, 180)
        this.tone(440, 'sawtooth', t + 0.05, 0.4, 0.12 * v, 660)
        break
      case 'dart':
        break
      case 'vent':
        this.hiss(t, 0.5, 0.45 * v, 400, 0.6, 'bandpass', 2400)
        this.tone(80, 'sawtooth', t, 0.45, 0.25 * v, 220)
        break
      case 'blink':
        this.tone(300, 'sine', t, 0.18, 0.22 * v, 2200)
        this.tone(1800, 'triangle', t + 0.06, 0.16, 0.12 * v, 600)
        break
      case 'toxin':
        break
      case 'purge':
        for (let i = 0; i < 3; i++) this.tone(660 * Math.pow(1.5, i), 'sine', t + i * 0.05, 0.35, 0.14 * v)
        this.hiss(t, 0.35, 0.12 * v, 6000, 1, 'highpass')
        break
    }
  }

  /** A counter landed: glassy shatter for BROKEN!, a bright deflect for COUNTERED!. */
  counter(broken: boolean, x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = Math.max(0.35, this.att(x, z))
    if (broken) {
      this.hiss(t, 0.35, 0.55 * v, 5200, 0.7, 'highpass', 1800)
      for (let i = 0; i < 4; i++) this.tone(2600 - i * 420 + Math.random() * 120, 'square', t + i * 0.035, 0.09, 0.09 * v)
      this.tone(110, 'sawtooth', t, 0.3, 0.25 * v, 45)
    } else {
      this.tone(880, 'triangle', t, 0.1, 0.2 * v, 1760)
      this.tone(1320, 'sine', t + 0.07, 0.22, 0.16 * v, 1980)
      this.hiss(t, 0.12, 0.2 * v, 3500, 4)
    }
  }

  /** Scan Dart pulse: a sonar ping. */
  scan(x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = this.att(x, z)
    this.tone(1760, 'sine', t, 0.5, 0.18 * v, 1650)
    this.tone(2640, 'sine', t + 0.12, 0.35, 0.08 * v)
  }

  powerup() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    ;[660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 'square', t + i * 0.05, 0.12, 0.1))
    this.tone(220, 'sawtooth', t, 0.3, 0.12, 440)
  }

  hit(mine: boolean, x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.tone(mine ? 420 : 620, 'triangle', t, 0.07, 0.14 * this.att(x, z), mine ? 180 : 420)
  }

  explosion(big: boolean, x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = this.att(x, z)
    this.hiss(t, big ? 0.7 : 0.35, (big ? 0.9 : 0.5) * v, big ? 300 : 700, 0.5, 'lowpass', 60)
    this.tone(big ? 70 : 120, 'sine', t, big ? 0.5 : 0.25, (big ? 0.6 : 0.35) * v, 30)
  }

  death(x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = this.att(x, z)
    this.tone(500, 'sawtooth', t, 0.35, 0.25 * v, 60)
    this.hiss(t, 0.4, 0.4 * v, 1200, 0.6, 'lowpass', 100)
  }

  superUse(hero: HeroId, x?: number, z?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const v = this.att(x, z)
    switch (hero) {
      case 'rook':
        this.tone(120, 'sawtooth', t, 0.5, 0.35 * v, 400)
        break
      case 'wren':
        this.tone(600, 'square', t, 0.12, 0.2 * v, 900)
        this.tone(900, 'square', t + 0.15, 0.12, 0.2 * v, 1300)
        break
      case 'furnace':
        this.hiss(t, 0.6, 0.7 * v, 200, 0.4, 'lowpass', 2000)
        this.tone(60, 'sine', t, 0.5, 0.5 * v, 40)
        break
      case 'flick':
        this.tone(1600, 'sine', t, 0.5, 0.2 * v, 200)
        this.hiss(t, 0.5, 0.2 * v, 4000, 2, 'bandpass', 300)
        break
      case 'pike':
        for (let i = 0; i < 5; i++) this.tone(300 + i * 40, 'triangle', t + i * 0.07, 0.1, 0.18 * v, 150)
        break
      case 'salve':
        for (let i = 0; i < 4; i++) this.tone(520 * Math.pow(1.26, i), 'sine', t + i * 0.09, 0.3, 0.18 * v)
        break
    }
  }

  dash(x?: number, z?: number) {
    if (!this.ctx) return
    this.hiss(this.ctx.currentTime, 0.18, 0.25 * this.att(x, z), 1500, 1.2, 'bandpass', 400)
  }

  pickup() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.tone(880, 'sine', t, 0.1, 0.2)
    this.tone(1320, 'sine', t + 0.09, 0.16, 0.2)
  }

  superReady() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.tone(660, 'square', t, 0.08, 0.12)
    this.tone(990, 'square', t + 0.1, 0.14, 0.12)
  }

  countdown(final: boolean) {
    if (!this.ctx) return
    this.tone(final ? 880 : 440, 'square', this.ctx.currentTime, final ? 0.4 : 0.12, 0.2)
  }

  grid() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.tone(220, 'sawtooth', t, 0.4, 0.2, 110)
    this.tone(330, 'sawtooth', t + 0.2, 0.4, 0.2, 165)
  }

  stinger(win: boolean) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const seq = win ? [523, 659, 784, 1047] : [392, 349, 311, 262]
    seq.forEach((f, i) => this.tone(f, 'square', t + i * 0.14, 0.4, 0.2))
    this.tone(win ? 130 : 98, 'sawtooth', t, 1.0, 0.25)
  }

  /* ---------- Music: a 126 BPM synthwave loop ---------- */

  update(dt: number) {
    this.timer += dt
    if (!this.ctx || !this.musicBus || !this.musicOn) return
    const ctx = this.ctx
    const bus = this.musicBus
    const spb = 60 / 126 / 2 // eighth notes
    while (this.nextBeat < ctx.currentTime + 0.25) {
      const t0 = this.nextBeat
      const b = this.beat
      const bar = Math.floor(b / 16) % 4
      const root = [55, 49, 41.2, 43.65][bar] // A, G, E, F
      // Kick on quarters, snare-ish noise on 2 and 4.
      if (b % 2 === 0) this.kick(t0, bus)
      if (b % 4 === 2) this.snare(t0, bus)
      // Bass: root eighths with octave bounce.
      this.synth(b % 2 ? root * 2 : root, 'sawtooth', t0, spb * 0.9, 0.16, bus, 300)
      // Arpeggio.
      const arp = [1, 1.5, 2, 3, 2, 1.5]
      this.synth(root * 4 * arp[b % arp.length], 'square', t0, spb * 0.6, 0.05, bus, 1800)
      // Pad every bar.
      if (b % 16 === 0) {
        this.synth(root * 2, 'triangle', t0, spb * 16, 0.05, bus, 900)
        this.synth(root * 3, 'triangle', t0, spb * 16, 0.04, bus, 900)
      }
      this.beat++
      this.nextBeat += spb
    }
  }

  private synth(freq: number, type: OscillatorType, t0: number, dur: number, vol: number, out: AudioNode, cutoff: number) {
    if (!this.ctx) return
    const o = this.ctx.createOscillator()
    const f = this.ctx.createBiquadFilter()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.value = freq
    f.type = 'lowpass'
    f.frequency.value = cutoff
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(f).connect(g).connect(out)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }

  private kick(t0: number, out: AudioNode) {
    if (!this.ctx) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.frequency.setValueAtTime(150, t0)
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.12)
    g.gain.setValueAtTime(0.5, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2)
    o.connect(g).connect(out)
    o.start(t0)
    o.stop(t0 + 0.22)
  }

  private snare(t0: number, out: AudioNode) {
    if (!this.ctx || !this.noise) return
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 1800
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.25, t0)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12)
    s.connect(f).connect(g).connect(out)
    s.start(t0)
    s.stop(t0 + 0.14)
  }

  dispose() {
    void this.ctx?.close()
    this.ctx = null
  }
}
