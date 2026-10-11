// Synthesised audio for the racer: engine, power-up cues and a 128 BPM loop. No files to download.
import { isMuted } from '../lib/sound'
import type { PowerType } from './track'

const PICKUP_PITCH: Record<PowerType, number> = {
  shunt: 660, barge: 392, bolt: 880, mine: 523, shock: 988, nitro: 740, shield: 1175, repair: 784, rail: 1046, flak: 587, oil: 330, ram: 440,
}

export class RacerAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfx: GainNode | null = null
  private musicBus: GainNode | null = null
  private engineOsc: OscillatorNode | null = null
  private engineOsc2: OscillatorNode | null = null
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null
  private noise: AudioBuffer | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private musicOn = true
  private nextBeat = 0
  private beat = 0
  private lockTimer = 0

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
    this.musicBus.gain.value = 0.32
    this.musicBus.connect(this.master)
    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    // Engine: two detuned saws through a low-pass.
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 600
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc2 = ctx.createOscillator()
    this.engineOsc2.type = 'square'
    this.engineOsc.connect(this.engineFilter)
    this.engineOsc2.connect(this.engineFilter)
    this.engineFilter.connect(this.engineGain).connect(this.sfx)
    this.engineOsc.start()
    this.engineOsc2.start()
    // Wind rush: looped noise through a band-pass that opens up and gets louder with speed.
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.frequency.value = 500
    this.windFilter.Q.value = 0.7
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    const wind = ctx.createBufferSource()
    wind.buffer = this.noise
    wind.loop = true
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfx)
    wind.start()
    this.nextBeat = ctx.currentTime + 0.1
  }

  stop() {
    void this.ctx?.close()
    this.ctx = null
  }

  setPaused(p: boolean) {
    if (!this.ctx) return
    if (p) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  toggleMusic() {
    this.musicOn = !this.musicOn
    return this.musicOn
  }

  /** Called every frame. */
  update(dt: number, speedFrac: number, throttle: number, nitro: boolean, running: boolean) {
    const ctx = this.ctx
    if (!ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain || !this.engineFilter) return
    if (this.master) this.master.gain.value = isMuted() ? 0 : 0.8
    const gear = Math.min(4, Math.floor(speedFrac * 5))
    const inGear = speedFrac * 5 - gear
    const rpm = 0.25 + inGear * 0.6 + throttle * 0.15
    const f = 45 + rpm * 90 + gear * 6
    const t = ctx.currentTime
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05)
    this.engineOsc2.frequency.setTargetAtTime(f * 0.501, t, 0.05)
    this.engineFilter.frequency.setTargetAtTime(400 + rpm * 1400 + (nitro ? 900 : 0), t, 0.08)
    this.engineGain.gain.setTargetAtTime(running ? 0.06 + throttle * 0.05 : 0, t, 0.1)
    if (this.windGain && this.windFilter) {
      const w = Math.min(1.3, speedFrac)
      this.windGain.gain.setTargetAtTime(running ? w * w * 0.16 + (nitro ? 0.05 : 0) : 0, t, 0.15)
      this.windFilter.frequency.setTargetAtTime(380 + w * 2600 + (nitro ? 800 : 0), t, 0.15)
    }
    if (this.lockTimer > 0) this.lockTimer -= dt
    this.scheduleMusic()
  }

  private scheduleMusic() {
    const ctx = this.ctx
    if (!ctx || !this.musicBus) return
    const spb = 60 / 128 / 2 // eighth notes at 128 BPM
    while (this.nextBeat < ctx.currentTime + 0.2) {
      const t = this.nextBeat
      const b = this.beat % 32
      if (this.musicOn) {
        if (b % 2 === 0) this.kick(t)
        if (b % 2 === 1) this.hat(t, 0.05)
        if (b % 8 === 4) this.hat(t, 0.12, 0.18)
        const bass = [41, 41, 53, 41, 44, 44, 56, 44][Math.floor(b / 4) % 8]
        if (b % 2 === 1 || b % 4 === 0) this.synth(t, midi(bass), spb * 0.9, 0.12, 'sawtooth', 380)
        if (b % 4 === 2) this.synth(t, midi(bass + 24 + [0, 7, 12, 7][(b / 4) % 4 | 0]), spb * 0.6, 0.035, 'square', 2400)
      }
      this.nextBeat += spb
      this.beat++
    }
  }

  private kick(t: number) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12)
    g.gain.setValueAtTime(0.9, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    o.connect(g).connect(this.musicBus!)
    o.start(t)
    o.stop(t + 0.3)
  }

  private hat(t: number, dur: number, gain = 0.1) {
    this.noiseBurst(t, dur, gain, 'highpass', 7000, this.musicBus!)
  }

  private synth(t: number, f: number, dur: number, gain: number, type: OscillatorType, cutoff: number, bus = this.musicBus) {
    const ctx = this.ctx
    if (!ctx || !bus) return
    const o = ctx.createOscillator()
    const flt = ctx.createBiquadFilter()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    flt.type = 'lowpass'
    flt.frequency.value = cutoff
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(flt).connect(g).connect(bus)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private noiseBurst(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, bus = this.sfx, sweepTo?: number) {
    const ctx = this.ctx
    if (!ctx || !this.noise || !bus) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const flt = ctx.createBiquadFilter()
    flt.type = type
    flt.frequency.setValueAtTime(freq, t)
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(flt).connect(g).connect(bus)
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.02)
  }

  private now() {
    return this.ctx?.currentTime ?? 0
  }

  pickup(type: PowerType) {
    const t = this.now()
    const f = PICKUP_PITCH[type]
    this.synth(t, f, 0.12, 0.12, 'triangle', 6000, this.sfx)
    this.synth(t + 0.06, f * 1.5, 0.18, 0.1, 'triangle', 6000, this.sfx)
  }

  refused() {
    this.synth(this.now(), 180, 0.15, 0.08, 'square', 900, this.sfx)
  }

  fire(type: PowerType) {
    const t = this.now()
    switch (type) {
      case 'shunt':
        this.synth(t, 300, 0.4, 0.12, 'sawtooth', 1800, this.sfx)
        this.noiseBurst(t, 0.3, 0.12, 'bandpass', 1200, this.sfx, 300)
        break
      case 'bolt':
        this.synth(t, 1400, 0.09, 0.09, 'square', 5000, this.sfx)
        break
      case 'mine':
        this.synth(t, 220, 0.15, 0.1, 'triangle', 2000, this.sfx)
        break
      case 'barge':
        this.synth(t, 90, 0.5, 0.35, 'sine', 400, this.sfx)
        this.noiseBurst(t, 0.35, 0.18, 'lowpass', 600, this.sfx, 80)
        break
      case 'shock':
        this.crackle()
        break
      case 'nitro':
        this.noiseBurst(t, 0.9, 0.18, 'bandpass', 500, this.sfx, 3000)
        break
      case 'shield':
        this.synth(t, 880, 0.4, 0.08, 'sine', 8000, this.sfx)
        this.synth(t + 0.08, 1320, 0.4, 0.06, 'sine', 8000, this.sfx)
        break
      case 'repair':
        for (let k = 0; k < 3; k++) this.synth(t + k * 0.07, 660 * (1 + k * 0.25), 0.18, 0.08, 'triangle', 6000, this.sfx)
        break
      case 'rail': {
        // Charge whine rising over the charge time; railShot() is the crack.
        const ctx = this.ctx
        if (!ctx || !this.sfx) break
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'sawtooth'
        o.frequency.setValueAtTime(220, t)
        o.frequency.exponentialRampToValueAtTime(2400, t + 0.4)
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.07, t + 0.38)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
        o.connect(g).connect(this.sfx)
        o.start(t)
        o.stop(t + 0.5)
        break
      }
      case 'flak':
        this.noiseBurst(t, 0.25, 0.32, 'lowpass', 3200, this.sfx, 300)
        this.synth(t, 110, 0.18, 0.2, 'square', 800, this.sfx)
        break
      case 'oil':
        this.synth(t, 160, 0.25, 0.12, 'sine', 600, this.sfx)
        this.noiseBurst(t + 0.05, 0.3, 0.1, 'lowpass', 500, this.sfx, 120)
        break
      case 'ram':
        this.synth(t, 70, 0.6, 0.18, 'sawtooth', 500, this.sfx)
        this.synth(t + 0.1, 105, 0.6, 0.12, 'sawtooth', 900, this.sfx)
        this.noiseBurst(t, 0.4, 0.12, 'bandpass', 300, this.sfx, 1200)
        break
    }
  }

  railShot() {
    const t = this.now()
    this.noiseBurst(t, 0.35, 0.35, 'highpass', 1800, this.sfx, 6000)
    this.synth(t, 1800, 0.3, 0.12, 'square', 9000, this.sfx)
    this.synth(t, 90, 0.4, 0.25, 'sine', 400, this.sfx)
  }

  airBrake() {
    this.noiseBurst(this.now(), 0.4, 0.2, 'bandpass', 2400, this.sfx, 400)
  }

  crackle() {
    const t = this.now()
    for (let k = 0; k < 6; k++) this.noiseBurst(t + k * 0.04 + Math.random() * 0.03, 0.05, 0.16, 'highpass', 2500)
  }

  hit(heavy: boolean) {
    const t = this.now()
    this.noiseBurst(t, heavy ? 0.45 : 0.15, heavy ? 0.4 : 0.18, 'lowpass', heavy ? 1500 : 3000, this.sfx, 200)
    if (heavy) this.synth(t, 70, 0.4, 0.3, 'sine', 300, this.sfx)
  }

  shieldBreak() {
    const t = this.now()
    this.noiseBurst(t, 0.25, 0.25, 'highpass', 4000)
    this.synth(t, 2200, 0.2, 0.06, 'triangle', 9000, this.sfx)
  }

  explosion() {
    const t = this.now()
    this.noiseBurst(t, 1.4, 0.55, 'lowpass', 2500, this.sfx, 60)
    this.synth(t, 55, 1.0, 0.45, 'sine', 300, this.sfx)
  }

  lockOn() {
    if (this.lockTimer > 0) return
    this.lockTimer = 0.18
    this.synth(this.now(), 1600, 0.06, 0.06, 'square', 8000, this.sfx)
  }

  countdown(go: boolean) {
    this.synth(this.now(), go ? 1046 : 523, go ? 0.5 : 0.2, 0.15, 'square', 4000, this.sfx)
  }

  crowd() {
    const t = this.now()
    this.noiseBurst(t, 1.6, 0.22, 'bandpass', 900, this.sfx, 1600)
    this.noiseBurst(t + 0.1, 1.4, 0.15, 'bandpass', 1800, this.sfx, 1200)
  }

  fans() {
    this.synth(this.now(), 1318, 0.08, 0.04, 'sine', 9000, this.sfx)
  }

  wall() {
    this.noiseBurst(this.now(), 0.2, 0.2, 'lowpass', 900, this.sfx, 200)
  }
}

function midi(n: number) {
  return 440 * Math.pow(2, (n - 69) / 12)
}
