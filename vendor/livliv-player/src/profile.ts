import { PARAM_RANGES, type Params } from './runtime/params'

export const TRACKING_PARAMETERS = ['angleX', 'angleY', 'angleZ', 'eyeLOpen', 'eyeROpen', 'eyeBallX', 'eyeBallY', 'browLY', 'browRY', 'mouthOpen', 'smile', 'bodyX'] as const
export type TrackingParameter = (typeof TRACKING_PARAMETERS)[number]

/** A standard tracking parameter mapped to a model's preferred range. Reversing output reverses motion. */
export interface ParameterRule {
  input: [number, number]
  output: [number, number]
  /** Additional smoothing, 0 (immediate) .. 1 (half a second). */
  smoothing: number
  /** Response exponent, .2 .. 3; 1 is linear. Signed response curves preserve the linear zero-input result. */
  curve: number
}
export type ParameterProfile = Partial<Record<TrackingParameter, ParameterRule>>
export type ParameterSample = { input: Params; output: Params }
export type TrackingProfile = ParameterProfile
export type TrackingSample = ParameterSample

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export function parameterRule(key: keyof Params): ParameterRule {
  return { input: [...PARAM_RANGES[key]], output: [...PARAM_RANGES[key]], smoothing: 0, curve: 1 }
}
/** Reads a saved/imported profile; unknown channels and invalid ranges do not become driver instructions. */
export function readTrackingProfile(value: unknown): TrackingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: TrackingProfile = {}
  for (const key of TRACKING_PARAMETERS) {
    const raw = (value as Record<string, unknown>)[key]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const r = raw as Record<string, unknown>, rule = parameterRule(key), [lo, hi] = PARAM_RANGES[key]
    const pair = (v: unknown): [number, number] | null => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [clamp(v[0], lo, hi), clamp(v[1], lo, hi)] : null
    const input = pair(r.input), output = pair(r.output)
    if (input && input[1] - input[0] > 1e-6) rule.input = input
    if (output) rule.output = output
    if (typeof r.smoothing === 'number' && Number.isFinite(r.smoothing)) rule.smoothing = clamp(r.smoothing, 0, 1)
    if (typeof r.curve === 'number' && Number.isFinite(r.curve)) rule.curve = clamp(r.curve, .2, 3)
    result[key] = rule
  }
  return result
}

/** Maps normalized tracking parameters for camera, controller or network inputs. */
export class TrackingFilter {
  private rules: TrackingProfile = {}
  private previous: Partial<Params> = {}
  private last: TrackingSample | null = null
  constructor(profile?: TrackingProfile) { this.profile = profile ?? {} }
  get profile(): TrackingProfile { return readTrackingProfile(this.rules) }
  set profile(value: TrackingProfile) {
    const next = readTrackingProfile(value)
    for (const key of TRACKING_PARAMETERS) {
      if (JSON.stringify(next[key]) !== JSON.stringify(this.rules[key])) delete this.previous[key]
    }
    this.rules = next
  }
  get sample(): TrackingSample | null { return this.last && { input: { ...this.last.input }, output: { ...this.last.output } } }
  apply(input: Params, dt: number): Params {
    const output = { ...input }
    for (const key of Object.keys(this.rules) as TrackingParameter[]) {
      const r = this.rules[key]!, [a, b] = r.input
      let t = clamp((input[key] - a) / (b - a), 0, 1)
      if (a < 0 && b > 0) {
        const zero = -a / (b - a)
        t = t < zero ? zero - zero * Math.pow((zero - t) / zero, r.curve) : zero + (1 - zero) * Math.pow((t - zero) / (1 - zero), r.curve)
      } else t = Math.pow(t, r.curve)
      const target = r.output[0] + t * (r.output[1] - r.output[0]), previous = this.previous[key] ?? target
      const alpha = r.smoothing ? 1 - Math.exp(-Math.max(0, dt) / (.5 * r.smoothing)) : 1
      output[key] = this.previous[key] = previous + (target - previous) * alpha
    }
    this.last = { input: { ...input }, output }
    return output
  }
  reset() { this.previous = {}; this.last = null }
}
