// The character's own voice in chat. Sentences arrive one by one as URLs; they download in parallel and play back to
// back with no gap (Web Audio, each piece scheduled at the end of the one before). A sentence still being made comes
// as a WAV stream (16-bit PCM) and starts playing with its first piece, while the rest is still being made; one made
// before is an MP3 (or an older WAV), decoded whole. The mouth follows a loudness envelope worked out from the sound as
// it comes in, read at the moment the sound leaves the speakers.
//  - speech band only (150-1500 Hz): vowels open the mouth, hiss (s, sh, f) hardly does
//  - normalized per clip: a loud or quiet voice opens the mouth the same amount
//  - local contrast: the mouth closes a little between syllables instead of hanging open through a phrase
//  - leads the sound by 30 ms, as lips do
//  - with it, the vowel (vowel.ts): which mouth shape the sound makes, o / u round or i / e wide
// A sentence may come with hooks (a stage running several characters): told when it starts being heard and when it has been
// heard to the end, by the same clock as the mouth. Chat passes none and plays exactly as before.

import { VowelCue, vowelTrack } from './vowel'

const FPS = 100 // envelope frames per second
const LEAD = 3  // frames (30 ms) the mouth leads the sound
const SETTLE = 10 + LEAD + 2 // last frames of what has arrived that the next piece may still change (local contrast)
const RATE = 24000 // the voices' sample rate: the context runs at it (not on WebKit), so the pieces of a sentence join sample-exact

type Piece = { at: number; from: number; n: number; src: AudioBufferSourceNode; over?: boolean } // context time, samples
type Clip = { pieces: Piece[]; rate: number; x: Grow; env: Float32Array; vowel: Float32Array; envDone: number; vowelDone: number; complete?: boolean; hooks?: ClipHooks; started?: boolean }
/** one queued sentence, as its caller hears about it: onStart when its first sound reaches the listener, then exactly
 *  one of onEnd (heard to the end) or onFail (no sound came, its download broke off, or stop() dropped it) */
export type ClipHooks = { onStart?: () => void; onEnd?: () => void; onFail?: () => void }
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }
type AudioNav = Navigator & { audioSession?: { type: string } }

export class SpeechPlayer {
  private ctx: AudioContext | null = null
  private gen = 0                                  // bumped by stop(): clips of an interrupted reply are dropped
  private loads = new AbortController()            // their downloads too
  private order: Promise<void> = Promise.resolve() // clips play in the order they were queued
  private clips: Clip[] = []
  private tail = 0                                 // context time the last scheduled piece ends
  private pending = 0                              // clips still coming in
  private watchdog = 0
  private cue = new VowelCue() // the voice's own balance, carried from one sentence to the next
  private out: GainNode | null = null              // every piece plays through it: the volume
  private volume = 1
  private capture: MediaStreamAudioDestinationNode | null = null
  private owed = new Set<ClipHooks>()              // sentences with hooks whose onEnd / onFail is still to come
  private ticker = 0                               // watches them start and end while there are any
  /** called when the voice goes quiet: nothing playing and nothing left to load */
  onIdle?: () => void
  /** called when the audio context starts or stops running (a browser's autoplay rule keeps it suspended until a tap) */
  onState?: () => void

  /** the sound can be heard: the audio context is running */
  get running() { return this.ctx?.state === 'running' }

  /** Post-volume voice for calls or recording. Owned here; available after unlock(), made on first use (a page that
   *  never asks for it runs no extra audio node) */
  get stream() {
    if (!this.capture && this.ctx && this.out) {
      try { this.capture = this.ctx.createMediaStreamDestination(); this.out.connect(this.capture) } catch { /* not supported */ }
    }
    return this.capture?.stream ?? null
  }

  /** 0 (silent, still playing on time: a muted preview) .. 1 */
  setVolume(v: number) { this.volume = v; if (this.out) this.out.gain.value = v }

  /** Create / resume the audio context. Call it inside a user gesture (tap, key press), or playback stays blocked. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as AudioWindow).webkitAudioContext
      if (!AC) return
      // WebKit (Safari, every iOS browser) keeps the device's own rate: a chosen one has played distorted there (WebKit
      // bugs 219201, 274507), and its pieces are resampled one by one instead
      const own = !!(window as AudioWindow).webkitAudioContext
      try { this.ctx = own ? new AC() : new AC({ sampleRate: RATE }) } catch { this.ctx = new AC() }
      try { const s = (navigator as AudioNav).audioSession; if (s) s.type = 'playback' } catch { /* not supported */ } // iOS: not muted by the silent switch
      this.out = this.ctx.createGain(); this.out.gain.value = this.volume; this.out.connect(this.ctx.destination)
      this.ctx.onstatechange = () => this.onState?.()
    }
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {})
      // iOS unlocks only once something actually starts inside the gesture
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource()
      s.buffer = b; s.connect(this.ctx.destination); s.start()
    }
  }

  get busy() { return this.pending > 0 || this.clips.length > 0 }

  /** queue one sentence; it plays right after the ones before it, from its first piece on */
  enqueue(url: string | Response, hooks?: ClipHooks) {
    this.unlock()
    const ctx = this.ctx
    if (!ctx) { hooks?.onFail?.(); return }
    const h = hooks && { ...hooks } // its own: the same hooks queued twice are two sentences
    if (h) this.owed.add(h)
    const gen = this.gen, coming = new Incoming(url, ctx, this.loads.signal)
    this.pending++
    this.order = this.order.then(async () => {
      let clip: Clip | null = null
      for (let x; (x = await coming.next()) && gen === this.gen;) clip = this.play(clip, x, coming.rate, h)
      if (gen !== this.gen) return // stop() has told its hooks
      this.pending--
      if (clip) { clip.complete = true; if (coming.failed) this.settle(h, false); this.update(clip); this.retire(clip) }
      else this.settle(h, false) // no sound came
      this.check()
    })
  }

  /** silence now: stop what plays, drop what is still loading */
  stop() {
    this.gen++
    this.loads.abort(); this.loads = new AbortController()
    this.pending = 0
    for (const c of this.clips) for (const p of c.pieces) { p.src.onended = null; try { p.src.stop() } catch { /* not started */ } }
    this.clips = []
    this.tail = 0
    clearTimeout(this.watchdog)
    clearInterval(this.ticker); this.ticker = 0
    const owed = [...this.owed]
    this.owed.clear()
    for (const h of owed) h.onFail?.()
  }

  /** mouth openness 0..1 for the frame being drawn */
  read(): number { return this.at('env') }

  /** the vowel for the frame being drawn: -1 round (o, u) .. +1 wide (i, e), 0 neither (vowel.ts) */
  vowel(): number { return this.at('vowel') }

  private at(track: 'env' | 'vowel'): number {
    const ctx = this.ctx
    if (!ctx || !this.clips.length) return 0
    const t = this.heardTime(ctx)
    for (const c of this.clips) {
      for (const p of c.pieces) {
        if (t >= p.at && t < p.at + p.n / c.rate) {
          const f = (p.from / c.rate + t - p.at) * FPS, i = Math.floor(f), k = f - i, x = c[track]
          const a = x[i] ?? 0, b = x[i + 1] ?? 0
          return a + (b - a) * k
        }
      }
    }
    return 0
  }

  dispose() { this.stop(); this.onIdle = undefined; this.capture?.stream.getTracks().forEach((track) => track.stop()); this.capture = null; this.ctx?.close().catch(() => {}); this.ctx = null; this.out = null }

  /** context time of the sound reaching the listener now (output latency included: Bluetooth adds 100-250 ms) */
  private heardTime(ctx: AudioContext) {
    const ts = ctx.getOutputTimestamp?.()
    if (ts && ts.contextTime && ts.performanceTime) return ts.contextTime + Math.max(0, performance.now() - ts.performanceTime) / 1000
    return ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0)
  }

  /** schedule the next piece of a sentence (the first one starts its clip) */
  private play(clip: Clip | null, x: Float32Array, rate: number, hooks?: ClipHooks): Clip {
    const ctx = this.ctx!
    const c = clip ?? { pieces: [], rate, x: new Grow(), env: new Float32Array(0), vowel: new Float32Array(0), envDone: 0, vowelDone: 0, hooks }
    if (!clip) this.clips.push(c)
    const buf = ctx.createBuffer(1, x.length, c.rate), src = ctx.createBufferSource()
    buf.getChannelData(0).set(x)
    const at = Math.max(ctx.currentTime + 0.04, this.tail) // later than the tail only when the sound came too slowly
    src.buffer = buf; src.connect(this.out ?? ctx.destination); src.start(at)
    const p: Piece = { at, from: c.x.n, n: x.length, src }
    c.pieces.push(p)
    c.x.push(x)
    this.tail = at + x.length / c.rate
    this.update(c)
    // ended = the context played it; it is heard a little later, so the clip stays readable until then (retire)
    src.onended = () => { p.over = true; this.retire(c) }
    // a context the browser keeps suspended never ends its pieces: give up on them so the face can rest
    clearTimeout(this.watchdog)
    const t0 = ctx.currentTime
    this.watchdog = window.setTimeout(() => { if (ctx.currentTime - t0 < 0.1 && this.clips.length) { this.stop(); this.check() } }, (this.tail - t0 + 2) * 1000)
    if (c.hooks && !this.ticker) this.ticker = window.setInterval(() => this.tick(), 25)
    return c
  }

  /** the hooked sentences that have started or ended being heard since the last look (every 25 ms while any is owed) */
  private tick() {
    const ctx = this.ctx
    if (ctx) {
      const t = this.heardTime(ctx)
      for (const c of this.clips) {
        const first = c.pieces[0], last = c.pieces[c.pieces.length - 1]
        if (!c.hooks || !first) continue
        if (!c.started && t >= first.at) this.begin(c)
        if (c.started && c.complete && t >= last.at + last.n / c.rate) this.settle(c.hooks, true)
      }
    }
    if (!this.owed.size) { clearInterval(this.ticker); this.ticker = 0 }
  }

  private begin(c: Clip) { c.started = true; c.hooks?.onStart?.() }

  /** a hooked sentence is over: heard to the end, or not to be heard; told once */
  private settle(h: ClipHooks | undefined, heard: boolean) {
    if (!h || !this.owed.delete(h)) return
    if (heard) h.onEnd?.(); else h.onFail?.()
  }

  /** the clip's envelope and vowel for what has arrived: frames far enough from the end are final (the vowel's cue sees
   *  each once, in order), the last few are redone with the next piece */
  private update(c: Clip) {
    const x = c.x.view(), e = envelope(x, c.rate), n = e.length
    const done = c.complete ? n : Math.max(c.envDone, n - SETTLE)
    const env = new Float32Array(n), vowel = new Float32Array(n)
    env.set(c.env.subarray(0, c.envDone)); env.set(e.subarray(c.envDone), c.envDone)
    vowel.set(c.vowel.subarray(0, c.vowelDone))
    vowelTrack(x, c.rate, env, FPS, LEAD, this.cue, c.vowelDone, done, vowel)
    c.env = env; c.vowel = vowel; c.envDone = c.vowelDone = done
  }

  /** a clip that is complete and has been played leaves once it has been heard */
  private retire(c: Clip) {
    const ctx = this.ctx
    if (!ctx || !c.complete || c.pieces.some((p) => !p.over)) return
    const lag = Math.max(0, ctx.currentTime - this.heardTime(ctx))
    window.setTimeout(() => {
      this.clips = this.clips.filter((x) => x !== c)
      if (c.hooks && this.owed.has(c.hooks)) { if (!c.started) this.begin(c); this.settle(c.hooks, true) } // heard, even if the ticker looked away
      this.check()
    }, Math.min(400, lag * 1000))
  }

  private check() { if (!this.busy) this.onIdle?.() }
}

/** one sentence coming in: its samples as they arrive (a WAV stream), or all at once (an MP3) */
class Incoming {
  rate = RATE
  failed = false
  private got: Float32Array[] = []
  private ended = false
  private wake: (() => void) | null = null

  constructor(url: string | Response, ctx: BaseAudioContext, signal: AbortSignal) {
    this.load(url, ctx, signal)
      .catch(() => { this.failed = true })
      .finally(() => { this.ended = true; this.poke() })
  }

  /** what came since the last call; null when there is no more */
  async next(): Promise<Float32Array | null> {
    for (;;) {
      if (this.got.length) { const x = join(this.got); this.got = []; return x }
      if (this.ended) return null
      await new Promise<void>((r) => { this.wake = r })
    }
  }

  private poke() { const w = this.wake; this.wake = null; w?.() }
  private push(x: Float32Array) { if (x.length) { this.got.push(x); this.poke() } }

  private async load(url: string | Response, ctx: BaseAudioContext, signal: AbortSignal) {
    const r = typeof url === 'string' ? await fetch(url, { signal }) : url
    if (!r.ok) throw new Error(String(r.status))
    if (!r.body) { await this.decode(await r.arrayBuffer(), ctx); return }
    const reader = r.body.getReader(), cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
    if (signal.aborted) { cancel(); return }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      if (/wav/.test(r.headers.get('content-type') || '')) await this.pcm(reader, ctx)
      else {
        const parts: Uint8Array[] = []
        for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(value) }
        const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
        let at = 0
        for (const part of parts) { bytes.set(part, at); at += part.length }
        if (!signal.aborted) await this.decode(bytes.buffer, ctx)
      }
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
  }

  private async decode(b: ArrayBuffer, ctx: BaseAudioContext) {
    const buf = await ctx.decodeAudioData(b)
    this.rate = buf.sampleRate
    if (buf.duration > 0.05) this.push(buf.getChannelData(0))
  }

  /** a WAV read as it arrives: 16-bit PCM goes out a piece at a time (anything else is decoded whole at the end) */
  private async pcm(reader: ReadableStreamDefaultReader<Uint8Array>, ctx: BaseAudioContext) {
    let b: Uint8Array = new Uint8Array(0), fmt: WavFmt | null | undefined
    for (;;) {
      const { value, done } = await reader.read()
      if (value?.length) b = b.length ? cat(b, value) : value
      if (fmt === undefined) fmt = wavFmt(b, !!done)
      if (fmt) { // whole sample frames out now, a split one waits for its other byte
        if (fmt.rate >= 3000 && fmt.rate <= 384000) this.rate = fmt.rate // the file's own rate, not the voices' 24000
        const step = 2 * fmt.channels, n = Math.floor((b.length - fmt.data) / step)
        if (n > 0) { this.push(pcm16(b, fmt.data, n, step)); b = b.slice(fmt.data + n * step); fmt.data = 0 }
      }
      if (done) break
    }
    if (fmt === null) await this.decode(b.slice().buffer as ArrayBuffer, ctx)
  }
}

type WavFmt = { rate: number; channels: number; data: number }

/** where a WAV's samples start and how to read them; undefined while its header is still incomplete, null when it is
 *  not 16-bit PCM (or not a WAV). The data size is not read: a WAV written as a stream says ~2 GB */
function wavFmt(b: Uint8Array, done: boolean): WavFmt | null | undefined {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (b.length >= 12 && (tag(0) !== 'RIFF' || tag(8) !== 'WAVE')) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let o = 12, rate = 0, channels = 0, ok = false
  while (b.length >= 12 && o + 8 <= b.length) {
    const id = tag(o), size = v.getUint32(o + 4, true)
    if (id === 'data') return ok ? { rate, channels, data: o + 8 } : null
    if (id === 'fmt ') {
      if (o + 24 > b.length) break
      ok = v.getUint16(o + 8, true) === 1 && v.getUint16(o + 22, true) === 16
      channels = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true)
    }
    o += 8 + size + (size & 1) // other chunks are skipped
  }
  return done ? null : undefined
}

/** the first channel of n 16-bit frames from byte `at` */
function pcm16(b: Uint8Array, at: number, n: number, step: number): Float32Array {
  const v = new DataView(b.buffer, b.byteOffset + at), out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * step, true) / 32768
  return out
}

function cat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a); out.set(b, a.length)
  return out
}

function join(xs: Float32Array[]): Float32Array {
  if (xs.length === 1) return xs[0]
  const out = new Float32Array(xs.reduce((s, x) => s + x.length, 0))
  let o = 0
  for (const x of xs) { out.set(x, o); o += x.length }
  return out
}

/** samples that grow as a sentence comes in */
class Grow {
  private a = new Float32Array(1 << 14)
  n = 0
  push(x: Float32Array) {
    if (this.n + x.length > this.a.length) { const b = new Float32Array(Math.max(2 * this.a.length, this.n + x.length)); b.set(this.a.subarray(0, this.n)); this.a = b }
    this.a.set(x, this.n); this.n += x.length
  }
  view() { return this.a.subarray(0, this.n) }
}

/** mouth openness per 1/FPS s for the samples `x` (one clip, or what has arrived of it) */
export function envelope(x: Float32Array, sr: number): Float32Array {
  const hop = Math.max(1, Math.round(sr / FPS)), n = Math.ceil(x.length / hop)
  // speech band: one-pole low-pass at 1500 Hz minus its own low-pass at 150 Hz
  const lp = 1 - Math.exp((-2 * Math.PI * 1500) / sr), hp = 1 - Math.exp((-2 * Math.PI * 150) / sr)
  const sum = new Float32Array(n)
  let a = 0, b = 0
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - a) * lp; b += (a - b) * hp
    const v = a - b
    sum[Math.floor(i / hop)] += v * v
  }
  const e = new Float32Array(n)
  let max = 0
  for (let i = 0; i < n; i++) { e[i] = Math.sqrt((sum[i] + (sum[i + 1] ?? 0)) / (2 * hop)); max = Math.max(max, e[i]) } // 20 ms windows
  if (!max) return new Float32Array(n)
  const voiced = Array.from(e).filter((v) => v > max * 0.05).sort((p, q) => p - q)
  const ref = voiced[Math.floor(voiced.length * 0.9)] || max, gate = ref * 0.1
  const lv = e.map((v) => Math.pow(Math.min(1, Math.max(0, (v - gate) / Math.max(ref - gate, 1e-6))), 0.75))
  // local contrast: level against its own 210 ms average
  const K = 10, out = new Float32Array(n)
  let s = 0
  for (let i = 0; i < n; i++) {
    let avg = 0
    for (let j = i - K; j <= i + K; j++) avg += lv[Math.min(n - 1, Math.max(0, j))]
    avg /= 2 * K + 1
    const o = Math.min(1, Math.max(0, lv[i] * 0.6 + (lv[i] - avg) * 1.2))
    s += (o - s) * (o > s ? 0.6 : 0.45) // opens fast, closes a little slower
    out[i] = s
  }
  return Float32Array.from({ length: n }, (_, i) => out[i + LEAD] ?? 0)
}
