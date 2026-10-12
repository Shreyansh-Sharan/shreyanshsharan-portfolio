// Each corner of the Loft has its own sound, made with WebAudio on every screen and mixed by how close the
// camera is: a disco groove (kick, hats, bass) that is also Freeze Dance's music and cuts out on the freeze,
// birdsong and the watering-can trickle in the Houseplant Jungle, slow bathwater waves and squeaks on Bathtub
// Beach, and chiptune blips in the Cardboard Arcade. Nothing plays until the player has interacted.
import { isMuted } from '../../../lib/sound'
import type { LevelCtx } from '../../engine/types'
import { BEACH, DISCO, JUNGLE } from './layout'

type Zone = 'disco' | 'jungle' | 'beach' | 'arcade'
const SPOTS: Record<Zone, { x: number; z: number; near: number; far: number }> = {
  disco: { x: DISCO.floor.x, z: DISCO.floor.z, near: 5, far: 20 },
  jungle: { x: JUNGLE.ring.x, z: JUNGLE.ring.z, near: 5, far: 17 },
  beach: { x: BEACH.tub.x - 2, z: BEACH.tub.z + 2, near: 5, far: 17 },
  arcade: { x: -13, z: 12, near: 4, far: 15 },
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
// An original two-bar bass line (MIDI) for the disco, eighth notes.
const BASS = [40, 40, 52, 40, 43, 43, 55, 43, 45, 45, 57, 45, 47, 47, 59, 50]
// Arcade arpeggio (MIDI), sixteenth notes.
const ARP = [72, 76, 79, 84, 79, 76, 74, 77, 81, 86, 81, 77]

export class LoftAmbience {
  private ctx: LevelCtx
  private ac: AudioContext | null = null
  private out: GainNode | null = null
  private gains = {} as Record<Zone, GainNode>
  private sources: AudioScheduledSourceNode[] = []
  private noise: AudioBuffer | null = null
  /** Disco groove: the next eighth-note time and index; `bpm` and `on` come from Freeze Dance. */
  private nextBeat = 0
  private beatIdx = 0
  private nextArp = 0
  private arpIdx = 0
  private nextChirp = 0
  private nextSqueak = 0
  bpm = 112
  on = true
  /** 0..1 pulse on each beat (for the lights), decays. */
  pulse = 0
  /** Audio-clock time of the last kick (to keep visuals in step). */
  private kicks: number[] = []

  constructor(ctx: LevelCtx) {
    this.ctx = ctx
  }

  private start() {
    // Wait for the engine's context (made on the player's first key or tap) rather than creating one.
    const ac = this.ctx.sound.ctx
    const bus = this.ctx.sound.bus
    if (!ac || !bus || ac.state !== 'running') return false
    this.ac = ac
    this.out = ac.createGain()
    this.out.gain.value = 0.9
    this.out.connect(bus)
    for (const z of Object.keys(SPOTS) as Zone[]) {
      const g = ac.createGain()
      g.gain.value = 0
      g.connect(this.out)
      this.gains[z] = g
    }
    const n = ac.sampleRate * 2
    this.noise = ac.createBuffer(1, n, ac.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    // Jungle trickle: band-passed noise, always running (silent when far away).
    this.loopNoise(this.gains.jungle, 'bandpass', 2400, 0.9, 0.05)
    // Beach waves: low-passed noise swelling slowly (an LFO on its gain).
    const wave = this.loopNoise(this.gains.beach, 'lowpass', 700, 0.5, 0.08)
    const lfo = ac.createOscillator()
    lfo.frequency.value = 0.13
    const depth = ac.createGain()
    depth.gain.value = 0.07
    lfo.connect(depth).connect(wave.gain)
    lfo.start()
    this.sources.push(lfo)
    this.nextBeat = this.nextArp = ac.currentTime + 0.1
    return true
  }

  private loopNoise(dest: AudioNode, type: BiquadFilterType, f: number, q: number, vol: number) {
    const ac = this.ac!
    const s = ac.createBufferSource()
    s.buffer = this.noise
    s.loop = true
    const filt = ac.createBiquadFilter()
    filt.type = type
    filt.frequency.value = f
    filt.Q.value = q
    const g = ac.createGain()
    g.gain.value = vol
    s.connect(filt).connect(g).connect(dest)
    s.start()
    this.sources.push(s)
    return g
  }

  private hit(dest: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine') {
    const ac = this.ac!
    const o = ac.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private hat(dest: AudioNode, t: number, vol: number) {
    const ac = this.ac!
    const s = ac.createBufferSource()
    s.buffer = this.noise
    const f = ac.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7000
    const g = ac.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    s.connect(f).connect(g).connect(dest)
    s.start(t, Math.random())
    s.stop(t + 0.06)
  }

  /** A record-scratch stop for the freeze. */
  scratch() {
    if (!this.ac) return
    const t = this.ac.currentTime
    this.hit(this.gains.disco, t, 900, 120, 0.35, 0.25, 'sawtooth')
  }

  /** Every frame: listener distance mixing and scheduling a little ahead. */
  update(dt: number) {
    this.pulse = Math.max(0, this.pulse - dt * 4)
    if (!this.ac && !this.start()) return
    const ac = this.ac!
    const muted = isMuted()
    const cam = this.ctx.cam.camera.position
    const level = {} as Record<Zone, number>
    for (const z of Object.keys(SPOTS) as Zone[]) {
      const s = SPOTS[z]
      const d = Math.hypot(cam.x - s.x, cam.z - s.z)
      const k = muted ? 0 : Math.max(0, Math.min(1, 1 - (d - s.near) / (s.far - s.near)))
      level[z] = k
      this.gains[z].gain.setTargetAtTime(k * k, ac.currentTime, 0.15)
    }
    const ahead = ac.currentTime + 0.12
    // Disco: eighth notes. Kick on beats, hats off-beat, bass every eighth.
    const eighth = 60 / this.bpm / 2
    if (this.nextBeat < ac.currentTime - 0.5) this.nextBeat = ac.currentTime + 0.05
    while (this.nextBeat < ahead) {
      const t = this.nextBeat
      const i = this.beatIdx++
      if (this.on && level.disco > 0.01) {
        const dst = this.gains.disco
        if (i % 2 === 0) this.hit(dst, t, 150, 45, 0.18, 0.55)
        else this.hat(dst, t, 0.12)
        if (i % 4 === 2) this.hat(dst, t, 0.06)
        this.hit(dst, t, midi(BASS[i % BASS.length]), midi(BASS[i % BASS.length]) * 0.98, eighth * 0.9, 0.12, 'triangle')
        if (i % 8 === 4) this.hit(dst, t, midi(64), midi(64), 0.18, 0.05, 'square')
      }
      if (this.on && i % 2 === 0) this.kicks.push(t)
      this.nextBeat += eighth
    }
    while (this.kicks.length && this.kicks[0] <= ac.currentTime) {
      this.kicks.shift()
      this.pulse = 1
    }
    // Arcade: a quiet arpeggio and the odd coin blip.
    const six = 0.11
    if (this.nextArp < ac.currentTime - 0.5) this.nextArp = ac.currentTime + 0.05
    while (this.nextArp < ahead) {
      if (level.arcade > 0.01) {
        const n = ARP[this.arpIdx % ARP.length] + (Math.floor(this.arpIdx / 48) % 2 ? -5 : 0)
        this.hit(this.gains.arcade, this.nextArp, midi(n), midi(n), 0.08, 0.035, 'square')
        if (this.arpIdx % 37 === 0) this.hit(this.gains.arcade, this.nextArp, 988, 1318, 0.12, 0.05, 'square')
      }
      this.arpIdx++
      this.nextArp += six
    }
    // Jungle birds and beach squeaks, now and then.
    if (ac.currentTime > this.nextChirp) {
      this.nextChirp = ac.currentTime + 1.2 + Math.random() * 3
      if (level.jungle > 0.05) {
        const f = 2200 + Math.random() * 1600
        for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this.hit(this.gains.jungle, ac.currentTime + k * 0.11, f, f * 1.25, 0.08, 0.06)
      }
    }
    if (ac.currentTime > this.nextSqueak) {
      this.nextSqueak = ac.currentTime + 3 + Math.random() * 5
      if (level.beach > 0.05) {
        const t = ac.currentTime
        this.hit(this.gains.beach, t, 1100, 1700, 0.07, 0.06, 'triangle')
        this.hit(this.gains.beach, t + 0.08, 1600, 1000, 0.09, 0.05, 'triangle')
      }
    }
  }

  dispose() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // Already stopped.
      }
    }
    this.sources = []
    this.out?.disconnect()
    this.out = null
    this.ac = null
  }
}
