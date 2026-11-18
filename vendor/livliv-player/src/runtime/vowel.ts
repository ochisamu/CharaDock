// Vowel cue for lip sync: which mouth shape the voice is making, from where its energy sits in the spectrum.
// o / u keep nearly all of it below 900 Hz (low first and second formant); i / e have a strong second / third formant at
// 1.8-3.5 kHz; a sits between, with its first formant at 650-1300 Hz. Two log ratios per ~21 ms frame:
//   back = dB(300-900 Hz / 1800-3500 Hz)    o 33, u 36, a 16, e 9, i 9 (50 synthetic vowels, 10 ja / zh voices)
//   close = dB(250-650 Hz / 650-1300 Hz)    i 23, u 17, e 13, o 3, a -5 (keeps a, which is not that far back, off "wide")
// `back` is measured against the voice's own balance (a slow average over loud frames, ~15 dB for the chat voices), so a
// deep voice or a dull microphone does not turn everything round. The result is -1 (round: o / u) .. +1 (wide: i / e),
// 0 for a and anything unsure: the runtime then shows the amplitude frames as before. Cheap: a few band sums per frame.

const BACK = [300, 900, 1800, 3500], CLOSE = [250, 650, 650, 1300]
const PRIOR = 15     // dB: the chat voices' median `back` over voiced frames (79 clips of several voices)
const ROUND_AT = 10  // dB above the voice's balance: o / u
const WIDE_AT = 3    // dB below it, with `close` over CLOSE_AT: i / e
const CLOSE_AT = 8

export class VowelCue {
  center = PRIOR
  value = 0
  private seen = 0

  /** one frame: `power` the linear power spectrum (bin k at k * hz), `level` its loudness 0..1, `dt` seconds since the
   *  last frame. Returns the smoothed cue -1 (round) .. +1 (wide) */
  push(power: ArrayLike<number>, hz: number, level: number, dt: number): number {
    const sum = (a: number, b: number) => {
      let s = 1e-12
      for (let k = Math.ceil(a / hz); k * hz < b && k < power.length; k++) s += power[k]
      return s
    }
    const back = 10 * Math.log10(sum(BACK[0], BACK[1]) / sum(BACK[2], BACK[3]))
    const close = 10 * Math.log10(sum(CLOSE[0], CLOSE[1]) / sum(CLOSE[2], CLOSE[3]))
    let target = 0
    if (level > 0.15) {
      if (level > 0.3) {  // the voice's balance: settles within a couple of seconds of speech, then drifts slowly
        this.seen += dt
        const k = Math.min(1, dt / Math.min(3, 0.3 + this.seen))
        this.center += (Math.min(24, Math.max(8, back)) - this.center) * k
      }
      const round = (back - this.center) / ROUND_AT
      const wide = ((this.center - back) / WIDE_AT) * Math.min(1, Math.max(0, (close - CLOSE_AT + 4) / 4))
      target = Math.max(-1, Math.min(1, wide > 0 ? wide : -Math.max(0, round)))
    }
    // ~35 ms smoothing: a vowel is held for 80-250 ms, its edges (glides, consonants) are not
    this.value += (target - this.value) * Math.min(1, dt / 0.035)
    return this.value
  }

  reset() { this.value = 0 }
}

/** in-place radix-2 FFT of re / im (length a power of two) */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti
        const c2 = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = c2
      }
    }
  }
}

/** the cue for a clip at `fps` frames a second, given its mouth envelope (same frames, `lead` frames ahead of the
 *  sound like the envelope): what the chat's voice works out as each sentence comes in (speech.ts), frames `from` to
 *  `to` into `out` (all of them by default). Window ~21 ms (Blackman), like the microphone's analyser. `cue` carries the
 *  voice's balance from one frame to the next and from one sentence to the next */
export function vowelTrack(x: Float32Array, sr: number, env: Float32Array, fps: number, lead = 0, cue = new VowelCue(),
  from = 0, to = env.length, out = new Float32Array(env.length)): Float32Array {
  const hop = sr / fps
  const size = 1 << Math.round(Math.log2(0.0213 * sr))
  const win = Float32Array.from({ length: size }, (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (size - 1)))
  const re = new Float32Array(size), im = new Float32Array(size), pw = new Float32Array(size / 2)
  for (let f = from; f < to; f++) {
    const c = Math.round((f + lead) * hop)
    for (let i = 0; i < size; i++) { const j = c - size / 2 + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[i] = 0 }
    fft(re, im)
    for (let k = 0; k < size / 2; k++) pw[k] = re[k] * re[k] + im[k] * im[k]
    out[f] = cue.push(pw, sr / size, env[f], 1 / fps)
  }
  return out
}
