// The idle motion the players play when nothing else drives the character. Same interface as puppet.ts
// IdleDriver, the older one, kept for comparisons. What it changes:
//  - the head and body wander on smooth value noise, not on a few sines: the classic idle repeats exactly (turn every
//    9.0 s, nod 7.0 s, tilt 12.6 s, all three every 62.8 s)
//  - head and body follow their targets through damped springs (the head overshoots a little, the body trails), not
//    an exponential ease: a turn has a follow-through
//  - breaths are uneven: in for 40 % of the cycle, out for 48 %, a pause, each cycle 3.2-4.6 s (classic: 2.99 s, even)
//  - one blink in six is a double blink; the brows dip a little with each blink
//  - 10-20 s after the last one, while the character is not talking or playing a move, a small idle move (a glance
//    aside, looking around, a sway, thinking, a look down): several parameters at once, the head no further than 16
//    degrees (2D turns read well within about 15). No sigh or daydream: a sigh read as bored on a cheerful character,
//    and the daydream's slow blink held the half-closed frames. Every 5-11 s looked restless beside a chat
// The idea comes from Mesh Avatar Studio (shinshin86/mesh-avatar-studio, MIT); the curves and numbers here are our own.
//
// Following the pointer. A sideways head turn is where a 2D puppet shows it is flat (at 30
// degrees the bangs move 2.5 px against a face that moves 61), so the 'attend' style (the default) turns the head at
// most ~13 degrees, all of the idle's yaw together, and puts the attention in the eyes, which lead and say where it
// looks (within 78 % of their travel sideways: the extremes cut the iris), and the face: the brows
// lifting when it moves fast or comes near, a soft squint while it rests on the face (a smile after a while), a blink
// with a large gaze shift, a brow flash when it comes onto the stage, small nods, and a look back at the viewer when it
// rests elsewhere or leaves. The head moves against the shoulders, not with them (a lean and a tilt toward the pointer
// read as the whole picture tilting). The 'turn' style is the follow of before (the head up to
// ~25-30 degrees, the eyes all the way); the idle under the webcam keeps it, so the params while tracking are exactly
// what they were
import type { Params, Puppet } from './puppet'

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
/** v as it is up to k, then easing toward cap (never past it): a soft limit on everything that adds up to an angle */
const knee = (v: number, k: number, cap: number) => { const a = Math.abs(v); return a <= k ? v : Math.sign(v) * (k + (cap - k) * Math.tanh((a - k) / (cap - k))) }
/** an envelope s seconds after an event: up over `a`, held `h`, down over `d`; 0 before and after */
const env = (s: number, a: number, h: number, d: number) => (s < 0 || s > a + h + d ? 0 : s < a ? smoothstep(0, a, s) : 1 - smoothstep(a + h, a + h + d, s))

/** smooth 1D value noise in -1..1: random values at whole numbers, eased between */
function noise(t: number, seed: number) {
  const h = (n: number) => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x) }
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f)
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1
}
const fbm = (t: number, seed: number) => noise(t, seed) * 0.7 + noise(t * 2.3, seed + 17) * 0.3

/** a keyframed track [[seconds, value], ...]: cubic through the keys, flat at the first and last */
type Track = [number, number][]
function sample(k: Track, t: number) {
  if (t <= k[0][0]) return k[0][1]
  const n = k.length - 1
  if (t >= k[n][0]) return k[n][1]
  let i = 0
  while (t > k[i + 1][0]) i++
  const slope = (j: number) => (j <= 0 || j >= n ? 0 : (k[j + 1][1] - k[j - 1][1]) / (k[j + 1][0] - k[j - 1][0]))
  const h = k[i + 1][0] - k[i][0], u = (t - k[i][0]) / h, u2 = u * u, u3 = u2 * u
  return (2 * u3 - 3 * u2 + 1) * k[i][1] + (u3 - 2 * u2 + u) * slope(i) * h + (-2 * u3 + 3 * u2) * k[i + 1][1] + (u3 - u2) * slope(i + 1) * h
}

/** idle moves. Head / body tracks are degrees added to the wander's targets (so the springs smooth them too); eyeBall
 *  adds to the gaze; eye multiplies the eye opening; brow adds to both brows; breath replaces the breathing. A move
 *  mirrors at random (side: the sign of every X and Z track) */
type Move = { dur: number; tracks: Partial<Record<'angleX' | 'angleY' | 'angleZ' | 'bodyX' | 'bodyZ' | 'eyeBallX' | 'eyeBallY' | 'eye' | 'brow' | 'breath', Track>> }
export const IDLE_MOVES: Record<string, Move> = {
  // eyes flick to one side, the head follows, holds, comes back
  glance: { dur: 4.0, tracks: {
    eyeBallX: [[0, 0], [0.15, 0.8], [2.5, 0.75], [2.8, 0]], eyeBallY: [[0, 0], [0.15, 0.25], [2.5, 0.2], [2.8, 0]],
    angleX: [[0, 0], [0.6, 11], [2.5, 10], [3.4, 0]], angleY: [[0, 0], [0.6, 4], [2.5, 3], [3.4, 0]], angleZ: [[0, 0], [0.7, -4], [2.5, -3], [3.4, 0]],
    bodyX: [[0, 0], [1.0, 2], [2.6, 1.5], [3.8, 0]], brow: [[0, 0], [0.4, 0.25], [2.5, 0.2], [3.2, 0]],
    breath: [[0, 0.1], [0.6, 0.7], [2.6, 0.6], [3.6, 0], [4.0, 0.15]] } },
  // one side, then the other
  lookAround: { dur: 5.0, tracks: {
    eyeBallX: [[0, 0], [0.2, -0.8], [1.4, -0.75], [1.7, 0.1], [2.0, 0.8], [3.2, 0.75], [3.5, 0]],
    angleX: [[0, 0], [0.7, -15], [1.5, -14], [2.4, 15], [3.3, 14], [4.2, 0]], angleY: [[0, 0], [0.8, 3], [2.4, 3], [4.2, 0]],
    angleZ: [[0, 0], [0.8, 3], [1.7, 0], [2.5, -3], [4.2, 0]], bodyX: [[0, 0], [1.0, -3], [2.7, 3], [4.4, 0]],
    brow: [[0, 0], [0.5, 0.3], [3.4, 0.25], [4.2, 0]], breath: [[0, 0.2], [0.6, 0.8], [3.4, 0.7], [4.4, 0], [5.0, 0.1]] } },
  // a slow side-to-side with the body
  sway: { dur: 6.0, tracks: {
    bodyZ: [[0, 0], [1.5, 3.5], [3.0, -3.5], [4.5, 3], [6.0, 0]], bodyX: [[0, 0], [1.5, 2], [3.0, -2], [4.5, 1.5], [6.0, 0]],
    angleZ: [[0, 0], [1.6, -7], [3.1, 7], [4.6, -6], [6.0, 0]], angleX: [[0, 0], [1.6, 4], [3.1, -4], [4.6, 3], [6.0, 0]],
    eyeBallX: [[0, 0], [1.6, -0.25], [3.1, 0.25], [4.6, -0.2], [6.0, 0]], eye: [[0, 1], [0.8, 0.88], [5.2, 0.88], [6.0, 1]],
    breath: [[0, 0], [0.75, 1], [1.5, 0], [2.25, 1], [3.0, 0], [3.75, 1], [4.5, 0], [5.25, 0.8], [6.0, 0]] } },
  // eyes up and aside, the head tilts, the brows lift
  think: { dur: 4.4, tracks: {
    eyeBallX: [[0, 0], [0.3, -0.6], [3.4, -0.55], [3.8, 0]], eyeBallY: [[0, 0], [0.3, 0.6], [3.4, 0.55], [3.8, 0]],
    angleX: [[0, 0], [0.8, -9], [3.4, -8], [4.2, 0]], angleY: [[0, 0], [0.8, 6], [3.4, 5], [4.2, 0]], angleZ: [[0, 0], [0.9, 6], [3.4, 5], [4.2, 0]],
    brow: [[0, 0], [0.6, 0.35], [3.4, 0.3], [4.2, 0]], eye: [[0, 1], [0.6, 0.92], [3.4, 0.92], [4.0, 1]] } },
  // a quick look down (at notes, at chat) and back to the viewer
  lookDown: { dur: 2.4, tracks: {
    eyeBallY: [[0, 0], [0.2, -0.85], [1.4, -0.8], [1.65, 0]], eyeBallX: [[0, 0], [0.2, -0.1], [1.4, -0.1], [1.65, 0]],
    angleY: [[0, 0], [0.45, -8], [1.4, -7], [1.9, 1], [2.4, 0]], angleZ: [[0, 0], [0.5, 2], [1.5, 2], [2.4, 0]],
    eye: [[0, 1], [0.3, 0.8], [1.4, 0.8], [1.65, 1]] } },
}

type S = { x: number; v: number }
/** [stiffness, damping ratio]: the eyes lead, the head follows with a slight overshoot, the body trails */
const SPRING: Record<'angleX' | 'angleY' | 'angleZ' | 'bodyX' | 'bodyZ', [number, number]> = {
  angleX: [55, 0.72], angleY: [55, 0.72], angleZ: [45, 0.75], bodyX: [14, 0.9], bodyZ: [12, 0.9],
}

/** how far the idle moves things. The defaults are livliv.ai's character pages'; its home
 *  page's is calmer and its body follows the head */
export type IdleStyle = {
  /** the head's and body's own wander (shares of their noise's degrees) */
  wander: number
  /** how far the head turns toward the pointer (the eyes still look all the way) */
  look: number
  /** how far the idle moves turn the head and body (their eyes, brows and breaths unchanged) */
  moves: number
  /** the share of the head's turn and tilt, as shown (moods, moves and all), that the body takes on top of its own sway,
   *  about a quarter second later: a person's shoulders come along when they turn or tilt their head. The rig already
   *  turns and leans the torso with the head (puppet.ts stepBody, rig.body), at once and by little. The lean pivots
   *  below the hips and carries the head sideways with it, so it takes a smaller share */
  bodyTurn: number
  bodyTilt: number
  /** how the character follows the pointer: 'attend' (IDLE_STYLE's, so the players') or 'turn' (the
   *  head turns most of the way, as before). Missing, 'turn': a caller that sets a style of its own and drives `look`
   *  itself (LivLiv Stage) moves as it did until it asks for 'attend' */
  pointer?: 'attend' | 'turn'
  /** 'attend': the pointer resting on the face 1.2 s brings a smile the first time, then with this chance, at most every
   *  25 s (the whole-face swap at full strength, 1.6 s; never while an expression shows or the character talks). 0:
   *  never. (A smile as the character looked back read as a laugh at nothing) */
  smile?: number
}
export const IDLE_STYLE: IdleStyle = { wander: 1, look: 1, moves: 1, bodyTurn: 0, bodyTilt: 0, pointer: 'attend', smile: 0.4 }

/** the 'attend' style's amounts. Angles in degrees at the pointer's full reach (the stage's side), before
 *  `look`; the soft limits hold everything the idle adds up (wander, idle moves, the gaze's pull): moods, actions and
 *  talking come on top, as before */
const ATTEND = {
  yaw: 9, yawKnee: 10, yawCap: 13,
  pitch: 5, pitchKnee: 6, pitchCap: 10,
  /** the head's tilt and the body's lean toward the pointer's side, and the body's own turn: small, so the head moves
   *  against the shoulders (with a tilt of 5 and a lean of 2, head and chest
   *  swaying together read as the whole picture tilting, the face still frontal) */
  roll: 2, rollKnee: 8, rollCap: 12, lean: 0, bodyTurn: 1.5,
  /** the gaze: its share of the pointer's place, then the limit, an ellipse through 0.78 sideways and 0.55 up / down
   *  (the iris's travel is 1), eased into from 70 % of it (at 0.8 of the place up to 0.7 it was hard
   *  to tell where the character looked) */
  eyeX: 1, eyeY: 0.8, eyeXCap: 0.78, eyeYCap: 0.55, eyeKnee: 0.7,
  /** seconds a still pointer off the face keeps the attention before the character looks back at the viewer */
  hold: 2.2,
}

/** the pointer at (x, y), CSS px from the canvas's top left (w x h its CSS size), for the 'attend' style: its place round
 *  the face as drawn at rest in look units (the canvas's sides at ±1, the scale `look` has), its distance from the face's
 *  centre in face radii, and whether it is on the stage. A player calls it on every pointer move (on: false when it
 *  leaves) */
export function pointAt(lv: LivelyIdle, p: Puppet, x: number, y: number, w: number, h: number, on: boolean) {
  const hd = p.model?.anchors.head, [sx, sy, ox, oy, vw] = p.lastView
  const drawn = !!hd && vw > 1  // rendered once: lastView maps the model to the canvas (as pick() reads it)
  const fx = drawn ? (hd.cx * sx + ox + 1) / 2 : 0.5, fy = drawn ? (hd.cy * sy + oy + 1) / 2 : 0.3
  const rx = drawn ? Math.abs(hd.rx * sx) / 2 : 0.12, ry = drawn ? Math.abs(hd.ry * sy) / 2 : 0.1
  const u = x / Math.max(1, w), v = y / Math.max(1, h)
  lv.pointer = { x: clamp((u - fx) * 2, -1, 1), y: clamp(-(v - fy) * 1.6, -1, 1), d: Math.hypot((u - fx) / rx, (v - fy) / ry), on }
}

export class LivelyIdle {
  nextBlink = 2; blinkT = -1; blinkAt = -99; look = { x: 0, y: 0 }
  blinkRate = 1
  nextSaccade = 1; gaze = { x: 0, y: 0 }
  /** set by the caller while the character talks or plays an action: no idle move starts then, and one playing fades */
  busy = false
  /** how much the idle moves move (0 turns them off) */
  moves = 1
  style: IdleStyle = { ...IDLE_STYLE }
  /** the head as shown last frame, everything layered over the idle included (the player sets it): what the body follows */
  shown = { x: 0, z: 0 }
  /** the pointer for the 'attend' style (pointAt); `look` stays the 'turn' style's input. keep: a target of the caller's
   *  own (LivLiv Stage: the character who speaks), x, y in the same look units, that holds the attention however long it
   *  stays still (a pointer at rest lets go after ATTEND.hold) */
  pointer: { x: number; y: number; d: number; on: boolean; keep?: boolean } = { x: 0, y: 0, d: 99, on: false }
  /** set by the Driver while the webcam drives the character: this idle (what shows while no face is seen) keeps the
   *  'turn' style then, so what tracking shows stays exactly as it was */
  tracked = false
  /** set by the Driver: no expression shows, so a smile (a whole face) may */
  faceFree = true
  private smiling = false
  /** 'attend': the pointer last frame and when it last moved, its speed (look units a second), whether it holds the
   *  attention and since when, the attention as the head and eyes follow it, the gaze target's slow follower (a big step
   *  away from it blinks), the soft squint, the tilt's side, and when the notice, the look back and a smile began */
  private att = { px: 0, py: 0, on: false, moved: -99, speed: 0, engaged: false, since: 0, x: 0, y: 0, slow: { x: 0, y: 0 },
    soft: 0, side: 1, notice: -99, back: -99, smile: -99, smiled: -99, jitter: { x: 0, y: 0 } }
  /** the body's share of it, through two short lags */
  private fol = { x: 0, z: 0, x2: 0, z2: 0 }
  /** the move playing (name, seconds in, mirrored), and when the next one may start */
  move: { id: string; t: number; side: number; fade: number } | null = null
  nextMove = 6
  last = ''
  private s = Object.fromEntries(Object.keys(SPRING).map((k) => [k, { x: 0, v: 0 }])) as Record<keyof typeof SPRING, S>
  /** the targets eased first (0.12 s): a saccade steps the head's target, and a spring pulled by a step starts with a jolt */
  private aim: Record<keyof typeof SPRING, number> | null = null
  private breathPhase = 0
  private breathPeriod = 3.8
  private double = false
  private seed = Math.random() * 100

  private breath(dt: number) {
    this.breathPhase += dt / this.breathPeriod
    if (this.breathPhase >= 1) { this.breathPhase -= 1; this.breathPeriod = 3.2 + Math.random() * 1.4 }
    const x = this.breathPhase
    return x < 0.4 ? smoothstep(0, 0.4, x) : x < 0.88 ? 1 - smoothstep(0.4, 0.88, x) : 0
  }

  apply(P: Params, t: number, dt: number) {
    // a spring stepped backwards runs away (a player's first frame can come with a step below zero)
    dt = dt > 0 ? Math.min(dt, 0.1) : 0
    const st = this.style
    // 'attend' follows the pointer with the face; under the webcam this idle is the 'turn' one, as before
    const A = st.pointer === 'attend' && !this.tracked
    if (A) this.attend(t, dt)
    // the move: started now and then while idle, faded out (0.4 s) when the character starts talking, or (attend) when
    // the pointer holds its attention: it is looking at it
    const quiet = this.busy || (A && this.att.engaged)
    if (this.move) {
      this.move.t += dt
      if (quiet) this.move.fade = Math.max(0, this.move.fade - dt / 0.4)
      if (this.move.t >= IDLE_MOVES[this.move.id].dur || this.move.fade <= 0) this.move = null
    } else if (quiet) this.nextMove = Math.max(this.nextMove, t + 3)
    else if (this.moves > 0 && t > this.nextMove) {
      const ids = Object.keys(IDLE_MOVES).filter((k) => k !== this.last)
      const id = ids[Math.floor(Math.random() * ids.length)]
      this.move = { id, t: 0, side: Math.random() < 0.5 ? -1 : 1, fade: 1 }
      this.last = id
      this.nextMove = t + IDLE_MOVES[id].dur + 10 + Math.random() * 10
    }
    const m = this.move, M = m ? IDLE_MOVES[m.id] : null
    const w = m ? m.fade * smoothstep(0, 0.15, m.t) * (1 - smoothstep(M!.dur - 0.25, M!.dur, m.t)) : 0
    const mv = (k: keyof Move['tracks'], rest = 0) => {
      const tr = M?.tracks[k]
      if (!tr) return rest
      const v = sample(tr, m!.t), mirrored = k === 'angleX' || k === 'angleZ' || k === 'bodyX' || k === 'bodyZ' || k === 'eyeBallX' ? m!.side : 1
      return rest + (v * mirrored - rest) * w * this.moves * (k.startsWith('angle') || k.startsWith('body') ? st.moves : 1)
    }

    // blinks: fast close (75 ms), slower open (120 ms), one in six followed by a second one
    let open = 1
    if (this.blinkT < 0 && t > this.nextBlink) { this.blinkT = 0; this.blinkAt = t }
    if (this.blinkT >= 0) {
      this.blinkT += dt
      const b = this.blinkT / 0.075
      open = clamp(b < 1 ? 1 - b : b < 2.6 ? (b - 1) / 1.6 : 1, 0, 1)
      if (b >= 2.6) {
        this.blinkT = -1
        if (!this.double && Math.random() < 0.18) { this.double = true; this.nextBlink = t + 0.08 }
        else { this.double = false; this.nextBlink = t + (1.8 + Math.random() * 3.8) / Math.max(0.2, this.blinkRate) }
      }
    }
    const eye = clamp(mv('eye', 1), 0, 1) * open
    // (attend: a soft squint while the pointer rests on the face, and a moment as the character looks back)
    P.eyeLOpen = P.eyeROpen = A ? eye * (1 - 0.16 * this.att.soft) : eye

    const sd = this.seed, L = this.look, lk = st.look, wd = st.wander
    let gx: number, gy: number
    let target: Record<keyof typeof SPRING, number>
    if (A) {
      // the eyes lead: straight to the attention (the pointer, or the viewer), a small drift of their own at saccades,
      // never past 70 % of their travel; the head follows through its springs, only so far
      const a = this.att, K = ATTEND
      if (t > this.nextSaccade) {
        a.jitter = { x: (Math.random() - 0.5) * 0.2, y: (Math.random() - 0.5) * 0.16 }
        this.nextSaccade = t + 0.6 + Math.random() * 1.6
      }
      this.gaze = { x: K.eyeX * a.x + a.jitter.x, y: K.eyeY * a.y + a.jitter.y }
      // the limit is an ellipse (a diagonal glance reaches the almond's corners, where the lids cut the iris first)
      const ex = this.gaze.x + mv('eyeBallX'), ey = this.gaze.y + mv('eyeBallY'), e = Math.hypot(ex / K.eyeXCap, ey / K.eyeYCap)
      const k = e > K.eyeKnee ? knee(e, K.eyeKnee, 1) / e : 1
      gx = ex * k; gy = ey * k
      // a big, quick shift of the gaze comes with a blink (people blink with large saccades): a step of 0.5 away from
      // where the gaze has been over the last ~0.35 s, not within 1.2 s of the last blink
      const s = a.slow
      if (Math.hypot(gx - s.x, gy - s.y) > 0.5) {
        if (this.blinkT < 0 && t - this.blinkAt > 1.2) this.nextBlink = Math.min(this.nextBlink, t)
        s.x = gx; s.y = gy
      }
      s.x += (gx - s.x) * Math.min(1, dt / 0.35); s.y += (gy - s.y) * Math.min(1, dt / 0.35)
      // a small lift of the chin as it notices the pointer, a small nod as it looks back (not asked for less motion)
      const nod = this.moves > 0 ? 3 * env(t - a.notice, 0.12, 0.15, 0.5) - 2.5 * env(t - a.back, 0.15, 0.1, 0.45) : 0
      target = {
        angleX: knee(a.x * K.yaw * lk + fbm(t * 0.17, sd) * 4 * wd + this.gaze.x * 2 + mv('angleX'), K.yawKnee, K.yawCap),
        angleY: knee(a.y * K.pitch * lk + fbm(t * 0.13, sd + 1) * 3 * wd + this.gaze.y * 2 + nod + mv('angleY'), K.pitchKnee, K.pitchCap),
        // the tilt toward the pointer's side (+angleZ: the top of the head to the viewer's right), and a little more to
        // one side while it rests on the face
        angleZ: knee(a.x * K.roll * lk + a.side * 3 * a.soft + fbm(t * 0.11, sd + 2) * 5 * wd + mv('angleZ'), K.rollKnee, K.rollCap),
        bodyX: a.x * K.bodyTurn * lk + fbm(t * 0.09, sd + 3) * 3 * wd + mv('bodyX'),
        bodyZ: a.x * K.lean * lk + fbm(t * 0.08, sd + 4) * 2.5 * wd + mv('bodyZ'),
      }
    } else {
      // eyes lead the head: saccades toward the pointer (and the move's gaze), the head follows through its springs
      if (t > this.nextSaccade) {
        this.gaze = { x: this.look.x + (Math.random() - 0.5) * 0.25, y: this.look.y * 0.8 + (Math.random() - 0.5) * 0.2 }
        this.nextSaccade = t + 0.6 + Math.random() * 1.6
      }
      gx = clamp(this.gaze.x * 1.2 + mv('eyeBallX'), -1, 1); gy = clamp(this.gaze.y + mv('eyeBallY'), -1, 1)
      target = {
        angleX: L.x * 20 * lk + fbm(t * 0.17, sd) * 7 * wd + this.gaze.x * 5 + mv('angleX'),
        angleY: L.y * 13 * lk + fbm(t * 0.13, sd + 1) * 4 * wd + this.gaze.y * 3 + mv('angleY'),
        angleZ: -L.x * 4 * lk + fbm(t * 0.11, sd + 2) * 6 * wd + mv('angleZ'),
        bodyX: L.x * 4 * lk + fbm(t * 0.09, sd + 3) * 3 * wd + mv('bodyX'),
        bodyZ: fbm(t * 0.08, sd + 4) * 2.5 * wd + mv('bodyZ'),
      }
    }
    P.eyeBallX += (gx - P.eyeBallX) * Math.min(1, dt * 18)
    P.eyeBallY += (gy - P.eyeBallY) * Math.min(1, dt * 18)

    const n = Math.max(1, Math.ceil(dt / (1 / 120)))
    const aim = this.aim ??= { ...target }
    for (const k of Object.keys(SPRING) as (keyof typeof SPRING)[]) {
      const [K, z] = SPRING[k], c = 2 * Math.sqrt(K) * z, s = this.s[k]
      for (let i = 0; i < n; i++) {
        aim[k] += (target[k] - aim[k]) * Math.min(1, dt / n / 0.12)
        s.v += (K * (aim[k] - s.x) - c * s.v) * (dt / n); s.x += s.v * (dt / n)
      }
      P[k] = s.x
    }
    // the body takes its share of the head's turn and tilt as shown, through two 0.12 s lags (~0.25 s behind)
    const fl = this.fol, a = Math.min(1, dt / 0.12)
    fl.x += (st.bodyTurn * this.shown.x - fl.x) * a; fl.x2 += (fl.x - fl.x2) * a
    fl.z += (st.bodyTilt * this.shown.z - fl.z) * a; fl.z2 += (fl.z - fl.z2) * a
    if (st.bodyTurn || st.bodyTilt) { P.bodyX = clamp(P.bodyX + fl.x2, -10, 10); P.bodyZ = clamp(P.bodyZ + fl.z2, -10, 10) }
    P.breath = clamp(mv('breath', this.breath(dt)), 0, 1)
    // brows: up when looking up, a little down with each blink, plus the move's; attend: also up when the pointer moves
    // fast or comes near the face, a flash as it comes onto the stage, a lift as the character looks back
    const bt = (A ? this.attendBrow(t) : L.y > 0.4 ? 0.5 : 0) - (1 - open) * 0.15 + mv('brow')
    P.browLY += (bt - P.browLY) * Math.min(1, dt * 10); P.browRY = P.browLY
    // attend: the smile the look back may bring, at full strength (a whole face: half of it shows both). Left for the
    // 'turn' idle (the webcam came on mid-smile: the Driver copied it over), it is taken back once, else it would stay
    if (A) { P.smile = t >= this.att.smile && t < this.att.smile + 1.6 ? 1 : 0; this.smiling = P.smile > 0 }
    else if (this.smiling) { P.smile = 0; this.smiling = false }
  }

  /** 'attend': this frame's pointer (onto the stage, moving, resting, gone) and where the attention goes */
  private attend(t: number, dt: number) {
    const a = this.att, q = this.pointer
    // onto the stage: the brows flash, the chin lifts a little; the side the head tilts to while the pointer rests on the face
    if (q.on && !a.on) { a.notice = t; a.moved = t; a.px = q.x; a.py = q.y; a.side = Math.random() < 0.5 ? -1 : 1 }
    if (q.on) {
      const step = Math.hypot(q.x - a.px, q.y - a.py)
      a.speed += (step / Math.max(dt, 1e-3) - a.speed) * Math.min(1, dt / 0.15)
      if (step > 0.003) a.moved = t
      a.px = q.x; a.py = q.y
    } else a.speed *= Math.max(0, 1 - dt / 0.15)
    a.on = q.on
    // it holds the attention while it moves, for `hold` seconds after, and while it is on the face
    const onFace = q.on && q.d < 1
    const engaged = q.on && (onFace || !!q.keep || t - a.moved < ATTEND.hold)
    if (engaged !== a.engaged) {
      // it rested elsewhere or left, after holding the attention a while: look back at the viewer
      if (!engaged && t - a.since > 0.8) {
        a.back = t
        this.nextMove = Math.max(this.nextMove, t + 6)  // it stays with the viewer a while before an idle move looks away
      }
      a.since = t; a.engaged = engaged
    }
    // resting on the face 1.2 s: a smile the first time, then now and then (style.smile), at most every 25 s
    const sm = this.style.smile ?? 0
    if (onFace && t - a.moved > 1.2 && sm > 0 && this.faceFree && !this.busy && t - a.smiled > 25 && t > a.smile + 1.6) {
      if (a.smiled < 0 || Math.random() < sm) a.smile = t
      a.smiled = t  // (a draw that does not smile waits as long as one that does)
    }
    const smiling = t >= a.smile && t < a.smile + 1.6
    const soft = smiling ? 0 : Math.max(onFace && t - a.moved > 0.5 ? 1 : 0, env(t - a.back, 0.2, 0.6, 0.6))
    a.soft += (soft - a.soft) * Math.min(1, dt / 0.25)
    a.x = engaged ? q.x : 0; a.y = engaged ? q.y : 0
  }

  /** 'attend': the brows' lift (before the blink's dip and the idle move's) */
  private attendBrow(t: number) {
    const a = this.att, q = this.pointer
    const near = q.on && t - a.moved < 0.3 ? 1 - smoothstep(1, 2.2, q.d) : 0
    return Math.min(0.7, 0.4 * smoothstep(0.35, 0.9, a.y) + 0.3 * smoothstep(1.5, 5, a.speed) + 0.15 * near
      + 0.45 * env(t - a.notice, 0.08, 0.25, 0.35) + 0.2 * env(t - a.back, 0.15, 0.3, 0.5) + 0.12 * a.soft)
  }
}
