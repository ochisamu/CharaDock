// Talking without a camera (lip sync only): the voice also moves the head, brows and eyes, the way people move
// while they speak. Without it only the mouth moves, over the idle sway, and the character looks dubbed.
//  - syllable onsets nod the head a little (not every one: people stress some), a phrase start a little more
//  - while talking the head drifts slowly and turns toward a new direction at each phrase
//  - loud onsets now and then lift the brows; the eyes come back to the viewer
//  - a pause after talking brings a blink
//  - bounce (optional): the whole character hops a little on syllables, as PNGTubers do
import { smooth, type Params } from './params'

/** a syllable: the mouth opens by RISE above the last low point, to at least ONSET (within a phrase the voice rarely
 *  closes it between syllables, so a fixed threshold misses most); the next one counts once it has come down by FALL.
 *  QUIET: below this the voice counts as silent */
const RISE = 0.25, ONSET = 0.35, FALL = 0.15, QUIET = 0.2

type Spring = { x: number; v: number }
/** semi-implicit Euler step of a damped spring toward 0 */
const step = (s: Spring, k: number, c: number, dt: number) => { s.v += (-k * s.x - c * s.v) * dt; s.x += s.v * dt }

export class TalkMotion {
  /** strength, 0 (off) to 2 */
  amount = 1
  bounce = false
  /** set for one update after a pause in talking: the caller starts a blink */
  pauseBlink = false
  /** how much the character is talking now (0..1): rises fast, fades over about a second after the last syllable */
  act = 0
  /** how far to move the picture up, as a share of its height. Half-body characters are cut off at the bottom
   *  edge, so a hop must never lift that edge into view: with bounce on the character sits lower by the most a hop
   *  reaches, and a hop only brings it back up to where it was (always <= 0). A full-body character (grounded) stands
   *  where it was and dips on a syllable instead (Puppet.setMove makes that a crouch: the feet stay on the ground) */
  hop = 0
  /** the character stands on a ground line (a full-body model) */
  grounded = false
  stats = { onsets: 0, nods: 0, brows: 0, blinks: 0 }
  private armed = true
  private valley = 0
  private peak = 0
  private quiet = 10       // seconds since the voice was last above QUIET
  private sinceNod = 10
  private sinceBrow = 10
  private nod: Spring = { x: 0, v: 0 }
  private lift: Spring = { x: 0, v: 0 }
  private browAge = 10      // seconds since the brows were last lifted
  private dir = { x: 0, y: 0 }
  private aim = { x: 0, y: 0 }
  private phase = [Math.random() * 9, Math.random() * 9, Math.random() * 9]
  private t = 0
  private off: Partial<Params> = {}

  /** level: the mouth openness the voice drives (0..1), once per frame. Returns offsets to add to the idle pose */
  update(level: number, dt: number, P: Params): Partial<Params> {
    this.t += dt; this.quiet += dt; this.sinceNod += dt; this.sinceBrow += dt
    this.pauseBlink = false
    const was = this.act
    if (level > QUIET) this.quiet = 0
    this.act += ((this.quiet < 0.35 ? 1 : 0) - this.act) * Math.min(1, dt * (this.quiet < 0.35 ? 6 : 1.2))
    if (was > 0.6 && this.act <= 0.6 && this.quiet > 0.4) { this.pauseBlink = true; this.stats.blinks++ }
    if (!this.armed) {
      this.peak = Math.max(this.peak, level)
      if (level < this.peak - FALL) { this.armed = true; this.valley = level }
    } else if ((this.valley = Math.min(this.valley, level)), level - this.valley > RISE && level > ONSET) {
      this.armed = false; this.peak = level; this.stats.onsets++
      const phrase = this.act < 0.3  // the first syllable after a pause
      if (phrase) this.aim = { x: (Math.random() * 2 - 1) * 5, y: (Math.random() - 0.3) * 2.5 }
      if (this.sinceNod > 0.35 && (phrase || Math.random() < 0.35)) {
        this.nod.v -= (phrase ? 70 : 35 + Math.random() * 30) * this.amount; this.sinceNod = 0; this.stats.nods++
      }
      if (this.sinceBrow > 1.2 && Math.random() < (phrase ? 0.5 : 0.18)) { this.browAge = 0; this.sinceBrow = 0; this.stats.brows++ }
      if (this.bounce) this.lift.v += (0.3 + Math.random() * 0.12) * this.amount
    }
    // springs: a nod dips and comes back in ~0.4 s; the hop lands in ~0.3 s
    const n = Math.max(1, Math.ceil(dt / (1 / 120)))
    for (let i = 0; i < n; i++) { step(this.nod, 150, 15, dt / n); step(this.lift, 230, 19, dt / n) }
    this.browAge += dt
    const a = this.act * this.amount, ph = this.phase, t = this.t
    // toward the phrase's direction while talking; after it the head stays there a while and drifts back slowly
    const talking = this.quiet < 0.35, back = Math.min(1, dt * (talking ? 3 : 0.45))
    this.dir.x += ((talking ? this.aim.x : 0) - this.dir.x) * back
    this.dir.y += ((talking ? this.aim.y : 0) - this.dir.y) * back
    const driftX = (Math.sin(t * 0.9 + ph[0]) * 0.6 + Math.sin(t * 1.7 + ph[1]) * 0.4) * 3.5 * a
    const driftZ = (Math.sin(t * 0.7 + ph[2]) * 0.6 + Math.sin(t * 1.3 + ph[0]) * 0.4) * 2.5 * a
    const o = this.off
    o.angleX = this.dir.x * this.amount + driftX
    o.angleY = this.nod.x + this.dir.y * this.amount
    o.angleZ = driftZ
    o.bodyX = o.angleX * 0.15
    // brows: up in 0.12 s, held, down by 0.65 s
    o.browLY = o.browRY = smooth(0, 0.12, this.browAge) * (1 - smooth(0.3, 0.65, this.browAge)) * 0.55 * this.amount
    // the eyes come back to the viewer while talking (the idle driver's gaze wanders after the pointer)
    o.eyeBallX = -P.eyeBallX * 0.7 * this.act
    o.eyeBallY = -P.eyeBallY * 0.7 * this.act
    const cap = 0.02 * this.amount
    const up = Math.min(cap, Math.max(0, this.lift.x))
    this.hop = this.bounce ? (this.grounded ? -up : up - cap) : 0
    return o
  }

  reset() {
    this.act = 0; this.hop = 0; this.armed = true; this.valley = 0; this.peak = 0; this.quiet = 10; this.browAge = 10
    this.nod = { x: 0, v: 0 }; this.lift = { x: 0, v: 0 }; this.dir = { x: 0, y: 0 }; this.aim = { x: 0, y: 0 }
  }
}
