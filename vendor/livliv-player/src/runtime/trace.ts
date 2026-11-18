// Face tracking traces: record what MediaPipe saw, play it back instead of the camera, or play a synthetic one, so
// changes to the tracking feel (smoothing, calibration, a lost face) can be measured without anyone in front of a
// camera. FaceTracker.trace picks one: 'synth', 'synth-narrow', 'rec' (TraceRecorder.save() downloads it) or the
// URL of a recording. During a synthetic run, window.__trackStats holds the numbers of the last full loop.
import type { Params } from './puppet'

/** the blendshapes the tracker reads, in the order a Frame stores them */
export const BS = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'eyeLookOutLeft', 'eyeLookInRight', 'eyeLookInLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'browInnerUp', 'browOuterUpLeft',
  'browOuterUpRight', 'browDownLeft', 'browDownRight', 'mouthSmileLeft', 'mouthSmileRight',
] as const
/** landmarks kept: forehead top, upper and lower inner lip, chin (the lip gap over the face height) */
export const LM = [10, 13, 14, 152] as const

/** one detection at `t` ms: the face transform (column-major 4x4), the BS scores, the LM points (x, y each).
 *  Neither m nor b: no face in this frame */
export type Frame = { t: number; m?: number[]; b?: number[]; l?: number[] }

/** plays frames in a loop at their own pace; next() gives each frame once, when its time has come */
export class TraceSource {
  private t0 = -1
  private i = -1
  readonly frames: Frame[]
  readonly synth: boolean
  readonly dur: number
  constructor(frames: Frame[], synth = false) {
    this.frames = frames; this.synth = synth
    this.dur = frames.length ? frames[frames.length - 1].t + 33 : 0
  }
  /** position in the trace (ms) */
  at(now: number) { return this.t0 < 0 || !this.dur ? 0 : (now - this.t0) % this.dur }
  next(now: number): Frame | null {
    if (!this.frames.length) return null
    if (this.t0 < 0) this.t0 = now
    const at = this.at(now)
    let j = this.i
    if (j >= 0 && this.frames[j].t > at) j = -1 // looped
    while (j + 1 < this.frames.length && this.frames[j + 1].t <= at) j++
    if (j === this.i || j < 0) return null
    this.i = j
    return this.frames[j]
  }
}

export class TraceRecorder {
  frames: Frame[] = []
  private t0 = -1
  push(f: Frame) {
    if (this.t0 < 0) this.t0 = f.t
    if (this.frames.length < 30 * 60 * 5) this.frames.push({ ...f, t: Math.round(f.t - this.t0) }) // 5 min at most
  }
  save() {
    const r4 = (a?: number[]) => a?.map((v) => Math.round(v * 1e4) / 1e4)
    const body = JSON.stringify(this.frames.map((f) => ({ t: f.t, m: r4(f.m), b: r4(f.b), l: r4(f.l) })))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    a.download = `face-trace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    a.click()
  }
}

// ---------------------------------------------------------------- synthetic trace
/** a 24 s loop at 30 fps. Seconds: 0-4 still, 4-8 turning left and right, 8-10 looking down (at a phone), 10-12 no
 *  face, 12-15 still with a blink at 13 (as a webcam sees one: 0.35, 0.62, 0.45, 0.2 on four frames), 15-18 turned
 *  20° while the far eye reads half closed (a common misread),
 *  18-21 talking, 21-24 still while leaning 6 cm sideways and 5 cm toward the camera. Head noise ~0.5°, the order of MediaPipe's at rest. `narrow`: eyes that rest at a
 *  blink score of ~0.38 (narrow eyes, glasses), which the default mapping shows half closed */
export function synthTrace(narrow = false): Frame[] {
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd())
  const rest = narrow ? 0.38 : 0.05
  const frames: Frame[] = []
  for (let k = 0; k < 24 * 30; k++) {
    const s = k / 30, t = Math.round(k * 1000 / 30)
    if (s >= 10 && s < 12) { frames.push({ t }); continue }
    let yaw = 0, pitch = 0, roll = 0
    if (s >= 4 && s < 8) yaw = 22 * Math.sin(Math.PI * (s - 4))
    if (s >= 8 && s < 10) pitch = 18 * Math.min(1, (s - 8) / 0.3)
    if (s >= 15 && s < 18) yaw = 20 * Math.min(1, (s - 15) / 0.3)
    yaw += gauss() * 0.5; pitch += gauss() * 0.5; roll += gauss() * 0.4
    let bl = rest + Math.abs(gauss()) * 0.02, br = rest + Math.abs(gauss()) * 0.02
    const bk = Math.round((s - 13) * 30)
    if (bk >= 0 && bk < 4) bl = br = rest + [0.3, 0.57, 0.4, 0.15][bk]
    if (s >= 15.3 && s < 18) br = 0.35 + Math.abs(gauss()) * 0.25 // the far eye
    const jaw = s >= 18 && s < 21 ? 0.45 * Math.max(0, Math.sin(2 * Math.PI * 3.5 * s)) : 0.02
    const b = BS.map((n) => n === 'eyeBlinkLeft' ? bl : n === 'eyeBlinkRight' ? br : n === 'jawOpen' ? jaw
      : n.startsWith('eyeLook') ? Math.abs(gauss()) * 0.04 : n === 'mouthSmileLeft' || n === 'mouthSmileRight' ? 0.1 : 0.02)
    const lean = s >= 21 ? Math.min(1, (s - 21) / 0.6) : 0
    frames.push({ t, m: rotation(yaw, pitch, roll, [6 * lean + gauss() * 0.1, gauss() * 0.1, -45 + 5 * lean + gauss() * 0.2]), b,
      l: [0.5, 0.25, 0.5, 0.62, 0.5, 0.62 + jaw * 0.05, 0.5, 0.8] })
  }
  return frames
}

/** column-major 4x4 R = Rz(roll)·Ry(yaw)·Rx(pitch), degrees: what FaceTracker reads back as yaw / pitch / roll */
function rotation(yaw: number, pitch: number, roll: number, pos: number[]): number[] {
  const r = Math.PI / 180, [a, b, c] = [pitch * r, yaw * r, roll * r]
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c)
  return [
    cc * cb, sc * cb, -sb, 0,
    cc * sb * sa - sc * ca, sc * sb * sa + cc * ca, cb * sa, 0,
    cc * sb * ca + sc * sa, sc * sb * ca - cc * sa, cb * ca, 0,
    pos[0], pos[1], pos[2], 1,
  ]
}

/** the head yaw the synthetic trace holds at s seconds (no noise) */
const synthYaw = (s: number) => (s >= 4 && s < 8 ? 22 * Math.sin(Math.PI * (s - 4)) : s >= 15 && s < 18 ? 20 * Math.min(1, (s - 15) / 0.3) : 0)

/** numbers from the puppet's final params over each loop of the synthetic trace */
export class SynthStats {
  private rows: { s: number; P: Params }[] = []
  private lastS = -1
  private mirror: () => boolean
  constructor(mirror: () => boolean) { this.mirror = mirror }
  observe(s: number, P: Params) {
    ;(window as unknown as { __traceAt?: number }).__traceAt = s  // where the replay is (s): screenshots at known moments
    if (s < this.lastS) { this.publish(); this.rows = [] }
    this.lastS = s
    this.rows.push({ s, P: { ...P } })
  }
  private publish() {
    const R = this.rows, seg = (a: number, b: number) => R.filter((r) => r.s >= a && r.s < b)
    if (!R.length || R[R.length - 1].s < 23) return // a partial loop (the first)
    const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const still = [...seg(1.5, 4), ...seg(21.5, 24)]
    // lag: the shift that best lines the turn up with the true yaw (as the puppet shows it: x1.3, mirrored)
    const turn = seg(4.5, 8), sign = this.mirror() ? -1 : 1
    let best = { lag: 0, err: Infinity }
    for (let lag = 0; lag <= 0.4; lag += 0.008) {
      const err = mean(turn.map((r) => (r.P.angleX - sign * 1.3 * synthYaw(r.s - lag)) ** 2))
      if (err < best.err) best = { lag, err }
    }
    const lost = seg(10.8, 12), far = seg(15.6, 18)
    const r2 = (v: number) => Math.round(v * 100) / 100
    ;(window as unknown as { __trackStats?: object }).__trackStats = {
      stillJitterX: r2(sd(still.map((r) => r.P.angleX))), stillJitterY: r2(sd(still.map((r) => r.P.angleY))),
      stillMeanY: r2(mean(still.map((r) => r.P.angleY))),
      stillEyeOpen: r2(mean(still.map((r) => (r.P.eyeLOpen + r.P.eyeROpen) / 2))),
      turnLagMs: Math.round(best.lag * 1000), turnRmsDeg: r2(Math.sqrt(best.err)),
      lostMotionDeg: r2(sd(lost.map((r) => r.P.angleX)) + sd(lost.map((r) => r.P.angleY))),
      lostEyeOpen: r2(mean(lost.map((r) => Math.min(r.P.eyeLOpen, r.P.eyeROpen)))),
      lostMeanY: r2(mean(lost.map((r) => r.P.angleY))),
      blinkMinOpen: r2(Math.min(...seg(12.9, 13.6).map((r) => Math.max(r.P.eyeLOpen, r.P.eyeROpen)))),
      farEyeWinkShare: r2(far.filter((r) => Math.abs(r.P.eyeLOpen - r.P.eyeROpen) > 0.25).length / Math.max(1, far.length)),
      loops: ((window as unknown as { __trackStats?: { loops?: number } }).__trackStats?.loops || 0) + 1,
    }
  }
}
