// Microphone -> mouth open (PNGTuber-style lip sync, all local).
//  - speech band only (band-pass around 200-2000 Hz): breaths, fan noise and hiss barely move the mouth
//  - automatic gain: the room's noise floor and the speaker's own loudness are tracked, so a quiet voice on a
//    laptop mic and a loud one on a headset both open the mouth the full range (`gain` still scales it)
//  - opens fast, closes a little slower; the renderer adds hysteresis between mouth frames
//  - the vowel (vowel.ts) from the unfiltered spectrum: o / u round, i / e wide
import { VowelCue } from './vowel'

/** an <audio> / <video> element routed through Web Audio plays only through that context from then on, and an element
 *  can be routed once: each keeps its context and source for good, and stop() only unplugs the meter from it */
const routed = new WeakMap<HTMLMediaElement, { ctx: AudioContext; src: MediaElementAudioSourceNode }>()

export class VoiceMeter {
  ctx?: AudioContext; an?: AnalyserNode; stream?: MediaStream; buf = new Float32Array(1024); level = 0; gain = 1
  /** -1 round (o, u) .. +1 wide (i, e), 0 neither; updated by read() */
  vowel = 0
  private spec?: AnalyserNode  // the whole spectrum (the level's analyser only hears the band-passed voice)
  private db = new Float32Array(512)
  private pw = new Float32Array(512)
  private cue = new VowelCue()
  private floor = 0.004 // noise floor (RMS), follows quiet moments quickly and rises slowly
  private peak = 0.05   // recent speaking loudness, decays over a few seconds
  private last = 0

  private el?: HTMLAudioElement
  /** the page's own element (start), and what the meter plugged into it */
  private tap?: { src: AudioNode; to: AudioNode[] }
  /** the voice as a stream, for recording it alongside */
  out?: MediaStream

  /** file: play this audio (looped, audible) instead of listening to the microphone: tests without anyone talking.
   *  The SDK also passes a stream (a call's remote voice: listened to, not played) or an <audio> / <video> element the
   *  page plays itself (its sound goes on through the speakers) */
  async start(file?: string | MediaStream | HTMLMediaElement) {
    if (!file) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const own = file instanceof HTMLMediaElement ? file : undefined
    let r = own && routed.get(own)
    if (own && !r) {
      const c = new AudioContext()
      r = { ctx: c, src: c.createMediaElementSource(own) }
      r.src.connect(c.destination)
      routed.set(own, r)
    }
    const ctx = this.ctx = r ? r.ctx : new AudioContext()
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'; band.frequency.value = 650; band.Q.value = 0.55
    this.an = ctx.createAnalyser(); this.an.fftSize = 1024
    const spec = this.spec = ctx.createAnalyser(); spec.fftSize = 1024; spec.smoothingTimeConstant = 0 // ~21 ms at 48 kHz
    const dest = ctx.createMediaStreamDestination()
    this.out = dest.stream
    const stream = this.stream || (file instanceof MediaStream ? file : undefined)
    if (stream) { const src = ctx.createMediaStreamSource(stream); src.connect(band); src.connect(spec); src.connect(dest) }
    else if (r) {
      r.src.connect(band); r.src.connect(spec); r.src.connect(dest)
      this.tap = { src: r.src, to: [band, spec, dest] }
      if (ctx.state !== 'running') addEventListener('pointerdown', () => ctx.resume(), { once: true })  // autoplay rules
    } else {
      const el = this.el = new Audio(file as string); el.loop = true
      const src = ctx.createMediaElementSource(el)
      src.connect(band); src.connect(spec); src.connect(ctx.destination); src.connect(dest)
      // autoplay needs a click first in most browsers
      el.play().catch(() => addEventListener('pointerdown', () => { ctx.resume(); el.play() }, { once: true }))
    }
    band.connect(this.an)
  }

  /** (a stream the page passed in stays on: it is theirs) */
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop()); this.el?.pause()
    if (this.tap) { const { src, to } = this.tap; to.forEach((n) => src.disconnect(n)); this.tap = undefined }
    else this.ctx?.close()
  }

  /** 0..1 mouth openness, smoothed; call once per frame */
  read(): number {
    if (!this.an) return 0
    const now = performance.now(), dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 1 / 60)
    this.last = now
    this.an.getFloatTimeDomainData(this.buf)
    let s = 0
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i]
    const rms = Math.sqrt(s / this.buf.length)
    this.floor = rms < this.floor ? this.floor + (rms - this.floor) * Math.min(1, dt * 4) : this.floor + (rms - this.floor) * dt * 0.05
    this.floor = Math.max(0.0005, this.floor)
    const gate = this.floor * 2.2
    this.peak = Math.max(rms, gate * 3, 0.012, this.peak * Math.exp(-dt / 3))
    const x = Math.min(1, Math.max(0, (rms - gate) / (this.peak - gate)))
    const target = Math.min(1, Math.pow(x, 0.8) * 1.1 * this.gain)
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 30 : 14))
    if (this.spec && this.ctx) {
      this.spec.getFloatFrequencyData(this.db)
      for (let k = 0; k < this.db.length; k++) this.pw[k] = Math.pow(10, this.db[k] / 10)
      this.vowel = this.cue.push(this.pw, this.ctx.sampleRate / this.spec.fftSize, this.level, dt)
    }
    return this.level
  }
}
