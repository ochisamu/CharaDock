// Webcam face tracking -> puppet params, via MediaPipe Face Landmarker (runs locally in the browser).
import { smooth, type Params } from './params'
import { OneEuro } from './filters'
import { BS, LM, SynthStats, TraceRecorder, TraceSource, synthTrace, type Frame } from './trace'

type Landmarker = import('@mediapipe/tasks-vision').FaceLandmarker
type Result = import('@mediapipe/tasks-vision').FaceLandmarkerResult

// The face model: the MediaPipe runtime (wasm) and the landmarker model, ~17 MB (~8 MB over the wire). Served with a
// year's cache under URLs that carry the package version: bump V with @mediapipe/tasks-vision, or browsers
// keep runtime files that no longer match its JavaScript. Sizes: for the download progress (uncompressed)
export const V = '1.1.1'
const RUNTIME = { simd: ['vision_wasm_internal', 13_519_922], plain: ['vision_wasm_nosimd_internal', 12_627_509] } as const
const MODEL_SIZE = 3_758_596
/** where those files are: livliv.ai serves them itself; the SDK points elsewhere (setFaceModelFiles) before loading */
const FILES = { wasm: '/mediapipe/wasm', model: '/mediapipe/face_landmarker.task' }
export function setFaceModelFiles(f: Partial<typeof FILES>) { Object.assign(FILES, f) }

/** where starting the camera is: downloading the model (progress 0..1; the first time only), preparing it (compiling,
 *  the GPU), the camera (the permission prompt, the first picture) */
export type StartStep = { step: 'download'; progress: number } | { step: 'prepare' } | { step: 'camera' }

let shared: Promise<Landmarker> | null = null
let progress = 0
const watchers = new Set<(p: number) => void>()
/** the download while it runs, and who still wants it: the trackers waiting for their camera (by their ticket), or anyone
 *  who asked ahead of time (`ahead`, for good: hovering a button says the model will be wanted) */
let download: AbortController | null = null
const waiting = new Set<object>()
let ahead = false

/** The face model, loaded once per page and kept: every tracker and every camera toggle reuses it. Call it early
 *  (hovering the camera button, the live dialog) and the camera opens without waiting for it. The files are read with
 *  progress and land in the HTTP cache, where the live window, opened in another tab, finds them */
export function loadFaceModel(onProgress?: (p: number) => void, ticket?: object): Promise<Landmarker> {
  if (onProgress) { watchers.add(onProgress); onProgress(progress) }
  const done = () => { if (onProgress) watchers.delete(onProgress) }
  if (ticket) waiting.add(ticket); else ahead = true
  if (!shared) {
    const { signal } = (download = new AbortController())
    shared = (async () => {
      const vision = await import('@mediapipe/tasks-vision')
      const [name, size] = (await vision.FilesetResolver.isSimdSupported()) ? RUNTIME.simd : RUNTIME.plain
      const runtime = `${FILES.wasm.replace(/\/$/, '')}/${name}`
      const got = [0, 0], total = size + MODEL_SIZE
      const read = async (url: string, i: number) => {
        const r = await fetch(url, { signal })
        if (!r.ok || !r.body) throw new Error(`${url} ${r.status}`)
        const reader = r.body.getReader(), parts: Uint8Array[] = []
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          parts.push(value); got[i] += value.length
          progress = Math.min(0.99, (got[0] + got[1]) / total)
          watchers.forEach((w) => w(progress))
        }
        const out = new Uint8Array(got[i])
        parts.reduce((at, p) => { out.set(p, at); return at + p.length }, 0)
        return out
      }
      // the runtime is read only to have it cached (MediaPipe loads it by URL again); the model is handed over as it is
      const [, model] = await Promise.all([read(`${runtime}.wasm?v=${V}`, 0), read(`${FILES.model}?v=${V}`, 1)])
      progress = 1; watchers.forEach((w) => w(1))
      download = null
      return vision.FaceLandmarker.createFromOptions({ wasmLoaderPath: `${runtime}.js?v=${V}`, wasmBinaryPath: `${runtime}.wasm?v=${V}` }, {
        baseOptions: { modelAssetBuffer: model, delegate: 'GPU' },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      })
    })()
    shared.catch(() => { shared = null; progress = 0; download = null })  // a failed download is tried again next time
  }
  shared.then(done, done)
  return shared
}
/** a tracker no longer waits for the model (its camera was refused, or it was stopped): with nobody else waiting and nobody
 *  having asked ahead, the download stops. It runs beside the camera's prompt to save time, and a refusal should not
 *  cost 7 MB */
function dropFaceModel(ticket: object) {
  waiting.delete(ticket)
  if (!waiting.size && !ahead) download?.abort()
}

/** a face unseen this long (s) is lost: the player hands the character back to its idle motion */
export const LOST_AFTER = 0.4

/** a head pose (angles), the head's position in front of the camera (px, py, pz: cm, y up, z larger = closer) and the
 *  resting blink scores of the user's own left / right eye (narrow eyes, glasses rest well above 0). In the current
 *  view's terms; stored, x, z and px are in the mirrored view's (they flip with it) */
type Pose = { x: number; y: number; z: number; px: number; py: number; pz: number; bl: number; br: number }

export class FaceTracker {
  video = document.createElement('video')
  deviceId = ''
  lm?: Landmarker
  stream?: MediaStream
  last = -1
  target: Partial<Params> = {}
  mouthGain = 1
  exprGain = 1
  /** like a mirror (default): turn to your left and the character turns toward the screen's left. Off: it turns the
   *  way you do, as if it were you seen from the front (left/right, tilt, gaze and which eye blinks swap) */
  mirror = true
  /** the user's natural pose (calibrated) is 'front': its angles are subtracted, its blink scores are 'eyes open' */
  zero: Pose = { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, bl: 0, br: 0 }
  raw = { x: 0, y: 0, z: 0 }
  /** the head's position relative to the calibrated one (cm, smoothed; x in the view's terms): the player moves the
   *  character with it. Zero until a resting position is known */
  pos = { x: 0, y: 0, z: 0 }
  /** how much the head's sideways position also leans the body (the live setting `follow`, 0..2) */
  follow = 0.3
  /** process every n-th camera frame (power saving: 2) */
  every = 1
  /** detections per second at most. The model runs on the main thread, inside the frame: 14-16 ms each on an M4 with a
   *  busy machine, so on a phone it can take the frame rate with it. 'auto': a detection takes at most half of the main
   *  thread's time, by what the last ones took, and never under 5 a second (a face is lost after LOST_AFTER). Unset: every
   *  new camera frame, as livliv.ai has always done */
  maxFps?: number | 'auto'
  /** how long a detection takes (ms, smoothed) and when the next may run */
  private detectMs = 0
  private detectAt = 0
  /** set: calibration is remembered on this device for this character (localStorage), and found again next time */
  calibId?: string
  calibrated = false
  /** a calibration saved before positions were part of it: the resting position is taken on the next still second */
  private posKnown = false
  private frameNo = 0
  /** the eye turned away from the camera reads half closed (a wink that isn't): 'turn' links the eyes once the head
   *  turns past ~12°, 'always' links them all the time, 'off' never */
  blinkSync: 'turn' | 'always' | 'off' = 'turn'
  ok = false
  private stopped = false
  /** while start() runs: what it is waiting for */
  onStep?: (s: StartStep) => void
  /** seconds since a face was last seen (Infinity before the first); faces seen per second; the picture too dark */
  lostFor = Infinity
  fps = 0
  dark = false
  /** '' (camera), 'rec' (camera, recorded), 'synth' / 'synth-narrow', or the URL of a recording (see trace.ts) */
  trace = ''
  rec?: TraceRecorder
  private src?: TraceSource
  private stats?: SynthStats
  private recent: Pose[] = []
  private seenAt = -1
  private counted = 0
  private countAt = 0
  private light?: CanvasRenderingContext2D | null
  // One Euro filters on the measurements (tuned on the synthetic trace: about 40% less jitter at rest than the old
  // per-frame easing alone, and no more lag on turns); the per-frame easing in apply() only bridges the 30 fps camera
  private f = { x: new OneEuro(0.5, 0.05), y: new OneEuro(0.5, 0.05), z: new OneEuro(0.5, 0.05),
    gx: new OneEuro(1.5, 0.5), gy: new OneEuro(1.5, 0.5), brow: new OneEuro(1, 0.5),
    px: new OneEuro(0.6, 0.08), py: new OneEuro(0.6, 0.08), pz: new OneEuro(0.6, 0.08) }

  /** the current pose becomes 'front' (the last few frames, so one noisy frame doesn't decide it) */
  calibrate() {
    const r = this.recent.slice(-10)
    if (!r.length) return  // no face seen yet: nothing to take as front
    this.setZero(r); this.save()
  }
  /** smoothing, 0 (quick, shakier) .. 1 (steady, slower); 0.5 is what the head filters were tuned to. Both the cutoff at
   *  rest and how fast it opens with speed scale (the cutoff alone barely changes the jitter: noise opens the filter).
   *  Synthetic trace, offline: 0 -> jitter 0.33°, lag 36 ms; 0.5 -> 0.19°, 56 ms; 1 -> 0.09°, 96 ms */
  setSmoothing(s: number) {
    const c = s <= 0.5 ? 0.5 * 6 ** (1 - 2 * s) : 0.5 / (10 / 3) ** (2 * s - 1)  // 3 Hz .. 0.5 .. 0.15
    for (const f of [this.f.x, this.f.y, this.f.z]) { f.minCutoff = c; f.beta = 0.05 * 4 ** (1 - 2 * s) }  // 0.2 .. 0.05 .. 0.0125
  }
  setMirror(on: boolean) {
    if (on === this.mirror) return
    this.mirror = on
    this.zero = { ...this.zero, x: -this.zero.x, z: -this.zero.z, px: -this.zero.px }  // the calibrated front stays the front
    this.recent = this.recent.map((p) => ({ ...p, x: -p.x, z: -p.z, px: -p.px }))
    this.f.x.reset(); this.f.z.reset(); this.f.gx.reset(); this.f.px.reset()
  }

  async start() {
    if (this.trace && this.trace !== 'rec') {
      const frames = this.trace.startsWith('synth') ? synthTrace(this.trace === 'synth-narrow')
        : await fetch(this.trace).then((r) => { if (!r.ok) throw new Error(`trace ${r.status}`); return r.json() as Promise<Frame[]> })
      this.src = new TraceSource(frames, this.trace.startsWith('synth'))
      if (this.src.synth) this.stats = new SynthStats(() => this.mirror)
      this.ok = true
      return
    }
    this.restore()
    // the camera is asked for at once, so it warms up (and the user answers its prompt) while the model loads
    let modelReady = false
    const say = () => this.onStep?.(!modelReady ? (progress < 1 ? { step: 'download', progress } : { step: 'prepare' }) : { step: 'camera' })
    const model = loadFaceModel(() => say(), this).then((lm) => { modelReady = true; say(); return lm })
    const camera = navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user',
      ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}) } })
    say()
    let stream: MediaStream
    try {
      [this.lm, stream] = await Promise.all([model, camera])
      waiting.delete(this)
    } catch (e) {
      dropFaceModel(this)
      camera.then((s) => s.getTracks().forEach((t) => t.stop()), () => {})  // the model failed: let the camera go
      throw e
    }
    if (this.stopped) { stream.getTracks().forEach((t) => t.stop()); return }  // turned off while starting
    this.stream = stream
    this.video.srcObject = stream
    this.video.muted = true; this.video.playsInline = true
    await this.video.play()
    if (this.trace === 'rec') this.rec = new TraceRecorder()
    this.ok = true
  }

  /** the camera goes off; the face model stays loaded for the next time (loadFaceModel) */
  stop() {
    this.stopped = true
    dropFaceModel(this)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ok = false
  }

  /** Poll once per frame; returns true while a face is seen. */
  poll(): boolean {
    const now = performance.now()
    let f: Frame | null = null
    if (this.src) f = this.src.next(now)
    else if (this.lm && this.video.readyState >= 2 && this.video.currentTime !== this.last && now >= this.detectAt) {
      this.last = this.video.currentTime
      if (++this.frameNo % this.every === 0) {
        const r = this.lm.detectForVideo(this.video, now)
        if (this.maxFps) {  // (the first takes far longer, setting things up: not what later ones will)
          const took = Math.min(200, performance.now() - now)
          this.detectMs = this.detectMs ? this.detectMs + (took - this.detectMs) * 0.15 : took / 8
          this.detectAt = now + (this.maxFps === 'auto' ? Math.min(200, 2 * this.detectMs) : 1000 / this.maxFps)
        }
        f = toFrame(r, now); this.rec?.push(f)
      }
    }
    if (f) this.read(f, now)
    this.lostFor = this.seenAt < 0 ? Infinity : (now - this.seenAt) / 1000
    if (now - this.countAt >= 1000) {
      this.fps = this.countAt ? Math.round((this.counted * 1000) / (now - this.countAt)) : 0
      this.counted = 0; this.countAt = now
      this.checkLight()
    }
    return this.lostFor < LOST_AFTER
  }

  /** after the frame's params are final: numbers for a synthetic run (trace.ts) */
  observe(P: Params) { if (this.stats && this.src) this.stats.observe(this.src.at(performance.now()) / 1000, P) }

  private read(f: Frame, now: number) {
    if (!f.m && !f.b) return
    // back after a lost stretch: the filters start from where the face is now, not ease over from where it left
    const dt = this.seenAt < 0 ? 0 : (now - this.seenAt) / 1000
    if (!dt || dt > LOST_AFTER) for (const k of Object.values(this.f)) k.reset()
    this.seenAt = now; this.counted++
    const b = f.b, g = (n: (typeof BS)[number]) => (b ? b[BS.indexOf(n)] ?? 0 : 0)
    const m = f.m
    if (m) {
      // column-major 4x4; extract yaw/pitch/roll. MediaPipe's space is Y up, the face looking down +Z at the camera, so
      // pitch > 0 is the chin going down: negate it (+angleY is up). Yaw / roll are negated for the mirror view
      const r00 = m[0], r10 = m[1], r20 = m[2], r21 = m[6], r22 = m[10]
      const yaw = Math.atan2(-r20, Math.hypot(r21, r22))
      const pitch = Math.atan2(r21, r22)
      const roll = Math.atan2(r10, r00)
      const s = this.mirror ? -1 : 1
      this.raw = { x: s * deg(yaw) * 1.3, y: -deg(pitch) * 1.3 - 4, z: s * deg(roll) }
      const px = s * m[12], py = m[13], pz = m[14]
      this.recent.push({ ...this.raw, px, py, pz, bl: g('eyeBlinkLeft'), br: g('eyeBlinkRight') })
      if (this.recent.length > 30) this.recent.shift()
      // calibrates itself once, on the first second the head holds still, when this device has none for the character
      if ((!this.calibrated || !this.posKnown) && this.recent.length >= 20) {
        const r = this.recent.slice(-20)
        if (sd(r.map((p) => p.x)) < 1.5 && sd(r.map((p) => p.y)) < 1.5) {
          if (this.calibrated) { const z = this.zero; this.setZero(r); this.zero = { ...this.zero, x: z.x, y: z.y, z: z.z, bl: z.bl, br: z.br } }
          else this.setZero(r)
          this.save()
        }
      }
      if (this.posKnown) {
        this.pos = { x: this.f.px.filter(px, dt) - this.zero.px, y: this.f.py.filter(py, dt) - this.zero.py, z: this.f.pz.filter(pz, dt) - this.zero.pz }
      }
      const x = this.f.x.filter(this.raw.x, dt) - this.zero.x
      this.target.angleX = clamp(x, -30, 30)
      this.target.angleY = clamp(this.f.y.filter(this.raw.y, dt) - this.zero.y, -30, 30)
      // Player roll is Y-down, opposite to MediaPipe's Y-up rotation. Convert after calibration so stored poses keep
      // their existing convention; yaw and horizontal position are unchanged.
      this.target.angleZ = clamp(this.zero.z - this.f.z.filter(this.raw.z, dt), -30, 30)
      this.target.bodyX = clamp(x * 0.2 + this.pos.x * 0.25 * this.follow, -10, 10)
    }
    if (b) {
      // eyes: fully open up to a little above this user's resting score (narrow eyes no longer look half closed);
      // fully shut from 0.65: a webcam blink peaks at about 0.5-0.7 for one or two frames, so 0.775 left blinks half
      // closed (a 0.62 peak showed 0.43 open); mirrored, the user's left eye drives the image-right eye
      const eye = (blink: number, rest: number) => {
        const open = clamp(rest + 0.06, 0.15, 0.5), shut = Math.min(0.95, Math.max(0.65, open + 0.4))
        return clamp(1 - (blink - open) / (shut - open), 0, 1)
      }
      const [uL, uR] = [eye(g('eyeBlinkLeft'), this.zero.bl), eye(g('eyeBlinkRight'), this.zero.br)]
      let l = this.mirror ? uR : uL, r = this.mirror ? uL : uR
      const turned = smooth(9, 15, Math.abs(this.raw.x - this.zero.x))
      const k = this.blinkSync === 'always' ? 1 : this.blinkSync === 'turn' ? turned : 0
      if (k > 0) {  // turned away, the more open eye is the one the camera sees well
        const avg = (l + r) / 2, both = avg + (Math.max(l, r) - avg) * (this.blinkSync === 'always' ? turned : 1)
        l += (both - l) * k; r += (both - r) * k
      }
      this.target.eyeLOpen = l; this.target.eyeROpen = r
      // mouth: the jaw blendshape, or the lips' own gap when they part without much jaw (quick syllables, "e" / "i")
      const L = f.l, d = (i: number, j: number) => L ? Math.hypot(L[2 * i] - L[2 * j], L[2 * i + 1] - L[2 * j + 1]) : 0
      const lips = L ? clamp((d(1, 2) / Math.max(1e-3, d(0, 3)) - 0.015) * 7, 0, 1) : 0 // LM: 10, 13, 14, 152
      this.target.mouthOpen = clamp(Math.max((g('jawOpen') - 0.04) * 2.2, lips) * this.mouthGain, 0, 1)
      // gaze (mirrored): looking to the user's left moves the iris toward screen-left
      const lookLeft = (g('eyeLookOutLeft') + g('eyeLookInRight')) / 2
      const lookRight = (g('eyeLookInLeft') + g('eyeLookOutRight')) / 2
      const up = (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2, down = (g('eyeLookDownLeft') + g('eyeLookDownRight')) / 2
      this.target.eyeBallX = clamp(this.f.gx.filter((lookRight - lookLeft) * 2.2 * (this.mirror ? 1 : -1), dt), -1, 1)
      this.target.eyeBallY = clamp(this.f.gy.filter((up - down) * 2.2, dt), -1, 1)
      const browUp = g('browInnerUp') * 0.6 + (g('browOuterUpLeft') + g('browOuterUpRight')) * 0.2
      const browDown = (g('browDownLeft') + g('browDownRight')) / 2
      this.target.browLY = this.target.browRY = clamp(this.f.brow.filter((browUp - browDown * 0.8) * 2.4, dt), -1, 1)
      this.target.smile = clamp(((g('mouthSmileLeft') + g('mouthSmileRight')) / 2 - 0.35 / this.exprGain) * 2.5 * this.exprGain, 0, 1)
    }
  }

  /** the median of a few still frames becomes 'front', 'here' and 'eyes open' */
  private setZero(r: Pose[]) {
    const med = (k: keyof Pose) => median(r.map((p) => p[k]))
    this.zero = { x: med('x'), y: med('y'), z: med('z'), px: med('px'), py: med('py'), pz: med('pz'), bl: clamp(med('bl'), 0, 0.5), br: clamp(med('br'), 0, 0.5) }
    this.calibrated = this.posKnown = true
    this.f.px.reset(); this.f.py.reset(); this.f.pz.reset()
  }

  /** remembered for the next time on this device (not for traces) */
  private save() {
    if (!this.calibId || this.src) return
    const s = this.mirror ? 1 : -1, z = this.zero
    try { localStorage.setItem(`lm_calib:${this.calibId}`, JSON.stringify({ ...z, x: s * z.x, z: s * z.z, px: s * z.px, at: Date.now() })) } catch { /* private mode */ }
  }

  private restore() {
    if (!this.calibId) return
    try {
      const c = JSON.parse(localStorage.getItem(`lm_calib:${this.calibId}`) || 'null')
      if (!c || ![c.x, c.y, c.z, c.bl, c.br].every(Number.isFinite)) return
      const s = this.mirror ? 1 : -1
      this.posKnown = [c.px, c.py, c.pz].every(Number.isFinite)
      this.zero = { x: s * c.x, y: c.y, z: s * c.z, bl: clamp(c.bl, 0, 0.5), br: clamp(c.br, 0, 0.5),
        px: this.posKnown ? s * c.px : 0, py: this.posKnown ? c.py : 0, pz: this.posKnown ? c.pz : 0 }
      this.calibrated = true
    } catch { /* private mode, or something else stored there */ }
  }

  /** once a second: the mean brightness of a 32x24 copy of the camera picture (dark below ~40 of 255, with hysteresis) */
  private checkLight() {
    if (this.src || this.video.readyState < 2) return
    if (this.light === undefined) {
      const c = document.createElement('canvas'); c.width = 32; c.height = 24
      this.light = c.getContext('2d', { willReadFrequently: true })
    }
    if (!this.light) return
    this.light.drawImage(this.video, 0, 0, 32, 24)
    const d = this.light.getImageData(0, 0, 32, 24).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const luma = sum / (d.length / 4)
    this.dark = this.dark ? luma < 55 : luma < 40
  }

  apply(P: Params, dt: number) {
    const a = Math.min(1, dt * 30), fast = Math.min(1, dt * 25)
    for (const k of Object.keys(this.target) as (keyof Params)[]) {
      const v = this.target[k]
      if (v === undefined) continue
      // an eye closing follows at once: eased, a blink seen for one or two camera frames was over before it got there
      const closing = (k === 'eyeLOpen' || k === 'eyeROpen') && v < P[k]
      const rate = closing ? 1 : k.startsWith('eye') || k === 'mouthOpen' ? fast : k === 'smile' ? Math.min(1, dt * 8.4) : a
      P[k] += (v - P[k]) * rate
    }
  }
}

/** one MediaPipe result as a Frame: only what read() uses */
function toFrame(r: Result, t: number): Frame {
  if (!r.faceLandmarks?.length) return { t }
  const scores = new Map((r.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]))
  const L = r.faceLandmarks[0], m = r.facialTransformationMatrixes?.[0]?.data
  return {
    t, m: m ? Array.from(m) : undefined,
    b: scores.size ? BS.map((n) => scores.get(n) ?? 0) : undefined,
    l: L.length > 152 ? LM.flatMap((i) => [L[i].x, L[i].y]) : undefined,
  }
}

const deg = (r: number) => (r * 180) / Math.PI
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) }
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1] }
