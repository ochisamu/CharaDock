// A full-body model: one tall canvas (1536 x 3072) through the same build, with the body's points in
// anchors.body and the head-chest window in anchors.frame. The upper body moves as on a half-body model; the whole
// figure stays with it (no body capture: the upper body leads, the rest follows):
// - the upper body turns as one piece above the waist band, and the whole figure sways from the ankles (the feet stay);
// - the hips follow the upper body through a spring and shift their weight a little by themselves, tilting as they go;
// - a skirt's or coat's hem hangs behind the hips and the sway.
// Arms go with the body by height, no knees. Puppet does the per-vertex work; this file holds the model's geometry
// and the numbers.

/** [x, y, confidence], model px */
export type Pt = [number, number, number]

/** a full-body model's body (model px): a pose estimator's points on the full-body picture (OpenPose's sides: _r is the
 *  character's right, on the viewer's left), the ground line the soles stand on, and where a skirt or coat ends. The
 *  player reads the hips, the ankles, ground_y and the hem; the other points are kept for later work */
export interface BodyAnchors {
  hip_l: Pt; hip_r: Pt; ankle_l: Pt; ankle_r: Pt
  knee_l?: Pt; knee_r?: Pt; shoulder_l?: Pt; shoulder_r?: Pt; elbow_l?: Pt; elbow_r?: Pt; wrist_l?: Pt; wrist_r?: Pt; neck?: Pt
  ground_y: number
  /** the hem's height and its left and right ends there; missing: nothing hangs */
  hem_y?: number; hem_x?: [number, number]
}
/** the points a body may have, the four the player reads first */
export const BODY_POINTS = ['hip_l', 'hip_r', 'ankle_l', 'ankle_r', 'knee_l', 'knee_r', 'shoulder_l', 'shoulder_r', 'elbow_l',
  'elbow_r', 'wrist_l', 'wrist_r', 'neck'] as const
export const BODY_NEEDS = 4

/** the lean (body.roll) the whole figure takes as a sway from the ankles: a rigid turn about the ankles' midpoint, so
 *  the legs lean as straight lines; the rest bends at the waist */
export const FB_ANKLE = 0.5
/** the half-body follow (rig.body.roll / yaw, the idle sway's bodyZ) is tuned on a picture cut off at the chest; on a
 *  whole figure it reads bigger, so the lean and the turn-follow slide take this share of it */
export const FB_GAIN = 0.7
/** the waist band, in face widths either side of the hips' midpoint: below it the legs, above it the upper body as one
 *  piece; the waist turn and the talking dip go from 0 to 1 across it */
export const FB_WAIST = 0.5
/** the ankle band, in face widths above the higher ankle: the sway from the ankles goes from 0 to 1 across it */
export const FB_ANKLE_BAND: [number, number] = [0, 0.3]
/** the webcam's sideways move sways the figure from the ankles instead of sliding the picture (the feet would slide):
 *  the neck moves by move.x frame widths, as a half-body picture slides in its default framing, softly kept under this
 *  angle (degrees) */
export const FB_CAM_SWAY = 3
/** how far the webcam's lean down may crouch the character (share of the frame's height) */
export const CROUCH_CAM = 0.04
/** the hips follow the upper body through a spring: FB_HIP_SLIDE of its sideways slide, FB_HIP_BACK of its lean's
 *  move the other way (a lean from the waist balances over the feet), and a slow shift of weight of their own
 *  (FB_HIP_IDLE face widths). They tilt with how far they are off centre (the hip on the side
 *  the weight went to rises) and the shoulders answer the tilt */
export const FB_HIP_SLIDE = 0.7, FB_HIP_BACK = 0.35, FB_HIP_IDLE = 0.035, FB_HIP_K = 9, FB_HIP_C = 4.2
export const FB_HIP_REACH = 0.11, FB_HIP_TILT = (2.2 * Math.PI) / 180, FB_SHOULDER_ANSWER = 0.5
/** a hem hangs: it stays behind this share of the hips' and the sway's sideways move, through a spring, with a little
 *  wind (face widths), never further out than FB_HEM_MAX face widths */
export const FB_HEM_LAG = 0.4, FB_HEM_K = 16, FB_HEM_C = 3.2, FB_HEM_WIND = 0.018, FB_HEM_MAX = 0.3

type Box = [number, number, number, number]
type Anchors = { face: Box; neck_y: number; body?: BodyAnchors; frame?: Box }

/** a full-body model's geometry, worked out once at load: the hips' midpoint (the upper body turns about it), the higher
 *  ankle's height (below it the feet stay) and the ankles' midpoint (the figure sways about it), the ground line, the
 *  face width (the unit of every band), the frame's size (the unit of the moves) and the knees' height (the knee shot) */
export interface FullBody {
  hx: number; hy: number; ankleY: number; ax: number; ay: number; groundY: number; fw: number
  uw: number; uh: number; kneeY: number
}

export function fullBody(A: Anchors, canvas: [number, number]): FullBody {
  const B = A.body!, fw = Math.max(1, A.face[2] - A.face[0])
  const hx = (B.hip_l[0] + B.hip_r[0]) / 2, hy = (B.hip_l[1] + B.hip_r[1]) / 2
  const ankleY = Math.max(hy + 1, Math.min(B.ankle_l[1], B.ankle_r[1]))
  const ax = (B.ankle_l[0] + B.ankle_r[0]) / 2, ay = (B.ankle_l[1] + B.ankle_r[1]) / 2
  const F = A.frame ?? [0, 0, canvas[0], canvas[1]]
  const knees = [B.knee_l, B.knee_r].filter((k): k is Pt => !!k && k[2] >= 0.3 && k[1] > hy && k[1] < ankleY)
  const kneeY = knees.length ? knees.reduce((s, k) => s + k[1], 0) / knees.length : hy + 0.5 * (ankleY - hy)
  return { hx, hy, ankleY, ax, ay, groundY: B.ground_y, fw, uw: F[2] - F[0], uh: F[3] - F[1], kneeY }
}

/** what the camera fits into the view (model px): the head-chest frame by default, as a half-body picture fills it;
 *  'whole' the canvas; 'knee' the frame's top down to a little below the knees, as wide as the frame's shape asks */
export type Fit = 'frame' | 'whole' | 'knee'
export function fitBox(fit: Fit, A: Anchors, canvas: [number, number], fb: FullBody | null): Box | null {
  const F = A.frame
  if (!F || fit === 'whole') return null
  if (fit === 'frame' || !fb) return F
  const y0 = F[1], y1 = Math.min(canvas[1], fb.kneeY + 0.18 * (fb.ankleY - fb.kneeY))
  if (!(y1 - y0 > F[3] - F[1])) return F  // knees inside the frame (an odd model): the frame, never a flipped box
  const cx = (F[0] + F[2]) / 2, w = (y1 - y0) * (F[2] - F[0]) / (F[3] - F[1])
  return [cx - w / 2, y0, cx + w / 2, y1]
}
