// @livliv-dev/player/tracking: the character follows a face in the webcam (MediaPipe Face Landmarker, in the browser; camera
// images stay on the device, though MediaPipe sends Google usage statistics while it runs). A separate import: it needs
// the @mediapipe/tasks-vision package and downloads ~8 MB of model the first time (the wasm runtime and the face model;
// cached by the browser after that).
import { FaceTracker, LOST_AFTER, V, loadFaceModel, setFaceModelFiles, type StartStep } from './runtime/tracking'
import { defaultParams, type Params } from './runtime/params'
import type { Driver, Host } from './base'
import { TrackingFilter, type TrackingProfile, type TrackingSample } from './profile'
export { TrackingFilter, parameterRule, readTrackingProfile, TRACKING_PARAMETERS } from './profile'
export type { ParameterRule, TrackingProfile, TrackingSample, TrackingParameter } from './profile'

export type { StartStep }

export interface FaceModelFiles {
  /** the folder of MediaPipe's wasm files (vision_wasm_internal.js / .wasm and the nosimd pair). Default: jsDelivr's
   *  copy of @mediapipe/tasks-vision 1.1.1. Host them yourself in production */
  wasmUrl?: string
  /** face_landmarker.task. Default: Google's model bucket */
  modelUrl?: string
}

export interface FaceTrackingOptions extends FaceModelFiles {
  /** a camera from navigator.mediaDevices.enumerateDevices(); unset uses the default camera */
  deviceId?: string
  /** move like a mirror image (default true): turn left and the character turns to the screen's left */
  mirror?: boolean
  /** 0 (quick, shakier) .. 1 (steady, slower); default 0.5 */
  smoothing?: number
  /** Per-parameter ranges, response curves and smoothing. Can also be changed live on the returned tracker. */
  profile?: TrackingProfile
  /** how much leaning toward / away from the camera moves the character, 0 (default) .. 2 */
  follow?: number
  /** how many times a second to look for the face at most. 'auto' (default): as often as the camera gives a new picture,
   *  until that would take over half of the page's main thread (the model runs there); then less, 5 at least */
  maxFps?: number | 'auto'
  /** keep the calibration (the user's resting pose) on this device under this name (localStorage) */
  remember?: string
  /** what starting waits for: the download (progress 0..1, first time only), preparing the model, the camera */
  onProgress?: (step: StartStep) => void
  /** play a recorded face trace (a URL) or 'synth' (a built-in 24 s loop: turns, a nod, a lost face, a blink, talking)
   *  instead of the camera: tests without anyone in front of one */
  trace?: string
}

export interface FaceTracking {
  /** the camera preview; null when playing a trace. The tracker owns its stream: stop() releases it. */
  readonly video: HTMLVideoElement | null
  /** a face is seen now */
  readonly face: boolean
  /** faces seen per second */
  readonly fps: number
  /** the picture is too dark to track well */
  readonly dark: boolean
  mirror: boolean
  profile: TrackingProfile
  /** The latest normalized tracking values before and after this profile; null until its first frame. */
  readonly sample: TrackingSample | null
  /** the user's current pose becomes "facing front" (it also calibrates itself on the first still second) */
  calibrate(): void
  /** camera off, the character back to its idle motion (the face model stays loaded for the next start) */
  stop(): void
}

const DEFAULT_FILES = {
  wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${V}/wasm`,
  model: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
}
const files = (o: FaceModelFiles) => setFaceModelFiles({ wasm: o.wasmUrl ?? DEFAULT_FILES.wasm, model: o.modelUrl ?? DEFAULT_FILES.model })

/** Downloads the face model ahead of time (on hover over a camera button, say), so starting is quick. Once per page */
export async function preloadFaceModel(options: FaceModelFiles & { onProgress?: (p: number) => void } = {}): Promise<void> {
  files(options)
  await loadFaceModel(options.onProgress)
}

/** Asks for the camera and drives the character with the face it sees. While no face is seen, the character eases back
 *  to its idle motion */
export async function startFaceTracking(player: Host, options: FaceTrackingOptions = {}): Promise<FaceTracking> {
  files(options)
  const t = new FaceTracker()
  t.deviceId = options.deviceId ?? ''
  t.mirror = options.mirror ?? true
  t.setSmoothing(options.smoothing ?? 0.5)
  t.maxFps = options.maxFps ?? 'auto'
  t.calibId = options.remember
  t.onStep = options.onProgress
  t.trace = options.trace ?? ''
  await t.start()
  const pose = defaultParams(), filter = new TrackingFilter(options.profile)
  const follow = Math.max(0, Math.min(2, options.follow ?? 0))
  let w = 0  // how much the tracked pose shows (eases in 0.3 s after a face appears, out 0.5 s after it is lost)
  const driver: Driver = {
    order: -10,
    update(f) {
      if (!t.ok) return
      t.follow = follow
      const seen = t.poll()
      t.apply(pose, f.dt)
      w = Math.max(0, Math.min(1, w + (seen ? f.dt / 0.3 : -f.dt / 0.5)))
      f.tracked = true
      const k = w * w * (3 - 2 * w)
      if (!k) return
      const P = f.params, adjusted = filter.apply(pose, f.dt)
      for (const key of Object.keys(t.target) as (keyof Params)[]) P[key] += (adjusted[key] - P[key]) * k
      // leaning moves the picture: 10 cm sideways 6% of it, 10 cm closer 12% bigger (at follow 1)
      const d = t.pos, c = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
      f.move.x += c(d.x * 0.006 * follow * k, -0.15, 0.15)
      f.move.y += c(d.y * 0.006 * follow * k, -0.15, 0.15)
      f.move.s *= 1 + c(d.z * 0.012 * follow * k, -0.15, 0.2)
    },
    dispose() { t.stop() },
  }
  const remove = player.use(driver)
  return {
    get video() { return options.trace ? null : t.video },
    get face() { return t.lostFor < LOST_AFTER },
    get fps() { return t.fps },
    get dark() { return t.dark },
    get profile() { return filter.profile },
    set profile(value: TrackingProfile) { filter.profile = value },
    get sample() { return filter.sample },
    get mirror() { return t.mirror },
    set mirror(on: boolean) { t.setMirror(on) },
    calibrate: () => t.calibrate(),
    stop: remove,
  }
}
