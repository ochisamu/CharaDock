// Actions: short moves on top of whatever drives the character (webcam, idle, voice), the way VTube Studio plays a
// one-shot animation over tracking. Each is a curve of parameter offsets that fades in and out (~0.2 s), so starting
// one mid-move or pressing it again never jumps. "away" is a state, not a move: eyes closed, head down, slow breath,
// until it is turned off (or, entered because no face was seen for a while, until a face is back for a second).
import { smooth, type Params } from './params'

export type ActionId = 'nod' | 'shake' | 'tilt' | 'hop' | 'shy' | 'away'

type Move = { offsets: Partial<Params>; x: number; y: number }
const DUR: Record<Exclude<ActionId, 'away'>, number> = { nod: 0.95, shake: 1.05, tilt: 1.8, hop: 0.65, shy: 2.4 }
const env = (t: number, d: number) => smooth(0, 0.18, t) * (1 - smooth(d - 0.22, d, t))

/** offsets at t seconds into an action (y: share of the picture's height, up). grounded (a full-body model):
 *  the hop also lands, a short dip after the flight (Puppet.setMove makes the dips crouches, the feet on the ground) */
function curve(id: Exclude<ActionId, 'away'>, t: number, grounded = false): Move {
  const d = DUR[id], e = env(t, d), o: Partial<Params> = {}
  let y = 0
  if (id === 'nod') o.angleY = -(t < 0.45 ? 11 * Math.sin((Math.PI * t) / 0.45) : 6 * Math.sin((Math.PI * Math.min(t - 0.45, 0.45)) / 0.45)) * e
  if (id === 'shake') { o.angleX = 13 * Math.sin((2 * Math.PI * t) / 0.5) * e; o.bodyX = o.angleX * 0.15 }
  if (id === 'tilt') { o.angleZ = 11 * e; o.angleX = 3 * e; o.angleY = 2 * e }
  if (id === 'hop') {  // crouch, then up: a half-body character can't rise past its cut edge, so for it this is a bob
    y = t < 0.2 ? -0.025 * Math.sin((Math.PI * t) / 0.2) : t < 0.6 ? 0.04 * Math.sin((Math.PI * (t - 0.2)) / 0.4)
      : grounded ? -0.012 * Math.sin((Math.PI * Math.min(t - 0.6, 0.05)) / 0.05) : 0
    o.angleY = t > 0.2 && t < 0.6 ? 5 * Math.sin((Math.PI * (t - 0.2)) / 0.4) * e : 0
  }
  if (id === 'shy') { o.angleY = -12 * e; o.angleX = 9 * e; o.angleZ = -4 * e; o.eyeBallX = 0.7 * e; o.eyeBallY = -0.5 * e }
  return { offsets: o, x: 0, y }
}

/** the away pose (the player eases toward it by awayW, after everything else, and undoes it next frame) */
const AWAY: Partial<Params> = { eyeLOpen: 0, eyeROpen: 0, angleY: -11, angleZ: 5, angleX: 0, mouthOpen: 0, smile: 0, eyeBallX: 0, eyeBallY: 0 }

export class ActionPlayer {
  /** out: seconds since it was replaced by the same action pressed again (it fades out over 0.15 s), else -1 */
  private playing: { id: Exclude<ActionId, 'away'>; t: number; out: number; strength: number }[] = []
  /** away: on; auto: entered because no face was seen (leaves by itself when one is back) */
  away = false
  auto = false
  /** how far into the away pose (0..1) */
  awayW = 0
  private off: Partial<Params> = {}
  y = 0
  /** the character stands on a ground line (a full-body model): the hop lands with a dip */
  grounded = false

  play(id: ActionId, strength = 1) {
    if (id === 'away') { this.setAway(!this.away); return }
    for (const p of this.playing) if (p.id === id && p.out < 0) p.out = 0  // pressed again: the running one fades out
    this.playing.push({ id, t: 0, out: -1, strength: Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 1 })
  }
  setAway(on: boolean, auto = false) { this.away = on; this.auto = on && auto }
  get busy() { return this.playing.length > 0 || this.awayW > 0 }

  /** offsets to add this frame; `y` holds the vertical move */
  update(dt: number): Partial<Params> {
    const o = this.off
    for (const k of Object.keys(o) as (keyof Params)[]) delete o[k]
    this.y = 0
    for (const p of this.playing) {
      p.t += dt
      if (p.out >= 0) p.out += dt
      const m = curve(p.id, Math.min(p.t, DUR[p.id]), this.grounded), f = p.strength * (p.out < 0 ? 1 : 1 - smooth(0, 0.15, p.out))
      for (const [k, v] of Object.entries(m.offsets) as [keyof Params, number][]) o[k] = (o[k] ?? 0) + v * f
      this.y += m.y * f
    }
    this.playing = this.playing.filter((p) => p.t < DUR[p.id] && p.out < 0.15)
    this.awayW += ((this.away ? 1 : 0) - this.awayW) * Math.min(1, dt * (this.away ? 2.2 : 4))
    if (this.awayW < 0.002 && !this.away) this.awayW = 0
    return o
  }

  /** the away pose at time t (breathing slower than awake) */
  awayPose(t: number): Partial<Params> { return { ...AWAY, breath: 0.5 + 0.5 * Math.sin(t * 1.15) } }
}
