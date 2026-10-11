// Tiny synthesised UI sounds (no audio files to download).
let ctx: AudioContext | null = null
let muted = readMuted()

function readMuted(): boolean {
  try {
    return localStorage.getItem('ss-muted') === '1'
  } catch {
    return false
  }
}

export function isMuted() {
  return muted
}

export function setMuted(value: boolean) {
  muted = value
  try {
    localStorage.setItem('ss-muted', value ? '1' : '0')
  } catch {
    // Storage can be unavailable (private mode); the setting just won't persist.
  }
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine') {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
  amp.gain.setValueAtTime(0, ctx.currentTime + start)
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(ctx.currentTime + start)
  osc.stop(ctx.currentTime + start + duration + 0.02)
}

export type Sound = 'move' | 'select' | 'back' | 'boot'

export function play(sound: Sound) {
  if (muted) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    return
  }
  switch (sound) {
    case 'move':
      tone(1320, 0, 0.05, 0.035, 'triangle')
      break
    case 'select':
      tone(880, 0, 0.09, 0.05)
      tone(1320, 0.06, 0.14, 0.045)
      break
    case 'back':
      tone(990, 0, 0.08, 0.04)
      tone(660, 0.05, 0.12, 0.035)
      break
    case 'boot':
      tone(220, 0, 1.4, 0.05)
      tone(330, 0.15, 1.3, 0.04)
      tone(440, 0.3, 1.2, 0.035)
      tone(660, 0.45, 1.1, 0.025)
      break
  }
}
