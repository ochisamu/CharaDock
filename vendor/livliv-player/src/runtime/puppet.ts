// LivLiv puppet runtime: loads a LivLiv model (layers + anchors: format.ts reads model.json, v4 `livliv-model` or v3
// `livemaker-puppet`) and animates it with an automatic rig. WebGL2, no dependencies.
//
// Rig summary (procedural, derived from anchors written by the pipeline):
//  - head layers sit on a paraboloid "head bulge"; yaw/pitch rotate it and
//    per-layer depth adds parallax (front hair > eyes > face > back hair);
//    hair depth fades to zero on the skull ellipse so hair never tears
//  - hair is skinned between head and body by height and driven by a
//    two-segment spring chain (head motion + roll "gravity" + idle wind)
//  - eyes: blank-white eye patch squashes onto the lid line over the closed
//    patch; the iris slides inside the whites, cut by them (a soft mask once it
//    moves); a closing lid covers the iris instead of squashing it
//  - mouth: closed -> half -> open frames by loudness, and (in newer builds) a round o / u and a wide i / e frame by
//    the voice's vowel (vowel.ts); smile is a whole-face expression
//  - brows: local lift of every head layer but the irises (one field: no layer's copy of the lid slides out), or of
//    the `brows` layer alone where the build gave the brows one (drawn over the bangs); that layer moves with
//    the bangs where it lies over them
//  - body: lags the head turn / tilt, breathes (shoulders + chest), optional chest spring
import { projectedAnchor, type AnchorName, type AttachmentAnchor } from '../anchors'
import { LIMITS, coded, latticeOf, readModel, type Labels, type ModelFiles, type ModelMeta } from './format'
import { CROUCH_CAM, FB_ANKLE, FB_ANKLE_BAND, FB_CAM_SWAY, FB_GAIN, FB_HEM_C, FB_HEM_K, FB_HEM_LAG, FB_HEM_MAX, FB_HEM_WIND,
  FB_HIP_BACK, FB_HIP_C, FB_HIP_IDLE, FB_HIP_K, FB_HIP_REACH, FB_HIP_SLIDE, FB_HIP_TILT, FB_SHOULDER_ANSWER, FB_WAIST,
  fitBox, fullBody, type BodyAnchors, type Fit, type FullBody } from './fullbody'
import { PARAM_RANGES, defaultParams, smooth, type Params } from './params'

export { PARAM_RANGES, defaultParams, smooth, type Params }

export interface LayerDef {
  id: string; name: string; texture: string
  frames?: string[]; mask?: string
  /** the mouth's frames by name: closed, half, open (and round, wide in newer builds); older builds have no list */
  visemes?: string[]
  /** an expression patch as drawn while the character talks: without its own mouth; older builds have none */
  talk?: string
  x: number; y: number; w: number; h: number
  group: 'head' | 'body' | 'hair_back' | 'hair_side' | 'hair_front' | 'hair_inner'
  depth: number; role?: string; pivot?: [number, number]
  clip?: string; range?: [number, number]; param?: string
  /** an expression patch that changed the brows ("redrawn"): the neutral `brows` layer fades out under it, and the
   *  layer of role `expr_brows` with the same param (that expression's brow zone) fades in over the bangs */
  brows?: string
  /** the brows that expression drew, matted, drawn above the bangs after the brows layers while it shows:
   *  where a frown or raised brows moved them, outside the `expr_brows` zone, the patch under the bangs showed them in
   *  pieces between the strands */
  brow_tex?: string
  /** a .webp copy exists next to each of this layer's PNGs (much smaller) */
  webp?: boolean
  /** chains (rig.chains ids) that bend this layer: each vertex takes them by its distance to their lines (a strand,
   *  a twin tail, a cord). Its hair springs are off: the chains replace them */
  bones?: string[]
  /** the whole layer hangs from this point and moves as the head does there (turned with its roll), instead of
   *  following the head's surface vertex by vertex: a twin tail tied at its ribbon, a lock hanging from behind the jaw */
  rigid?: [number, number]
  /** role blush: its opacity by expression (smile, or an expression layer's param), summed */
  blush?: Record<string, number>
  /** shown only with these expressions (opacity: weight x the expression, summed, at most 1) / faded out by them: a
   *  drooping ahoge drawn for sad in place of the upright one */
  show?: Record<string, number>; hide?: Record<string, number>
  /** front hair: how far out from the head's centre (share of the head ellipse) its depth stays whole before fading to
   *  none at the outline; 0.55 when missing. Deep bangs need it smaller, or their side edge slides over the hair behind */
  fall?: number
  /** a hair layer: where (share of the head ellipse) its depth has faded to none (1 when missing: the head's outline).
   *  Past 1 the hair round the head turns with it, not only the hair over it; side / back hair use
   *  `fall` for where the fade starts too (0.7 when missing) */
  fall_end?: number
}
type Box = [number, number, number, number]
/** model.json's `format` and the newest `version` this runtime reads (format.ts). The models livliv.ai
 *  builds are v3 (`livemaker-puppet`), an export v4: both arrive here as
 *  ModelDef, the v3 shape */
export { FORMAT, FORMAT_VERSION, LEGACY_FORMAT, readModel } from './format'
/** a model as the runtime draws it: model.json v3 as it is, or v4 lowered to it (format.ts readModel) */
export interface ModelDef {
  format: string; version: number; name: string; canvas: [number, number]
  anchors: {
    head: { cx: number; cy: number; rx: number; ry: number }
    face: Box; neck_y: number; top_y: number; bottom_y: number
    /** full-body models: the body's points and ground line. With it the upper body turns about the hips, the
     *  figure sways from the ankles with the feet on the ground, the hips and a hem follow (fullbody.ts) */
    body?: BodyAnchors
    /** full-body models: the head-chest window the camera fits by default (Puppet.fit), as a half-body picture fills
     *  its canvas */
    frame?: Box
    /** full-body models: the lowest hair pixel, where long hair swings with its full weight */
    hair_bottom_y?: number
    /** the top of the choker or collar (drawn views of a multi-view character) */
    collar_y?: number
    hair_root_y: number; eyes?: Box[]
    /** per eye; null: no brow found (under the bangs, or not told from the hair). Only builds with brow_lines move them */
    brows?: (Box | null)[]; brow_lines?: (BrowLine | null)[]
    jaw?: { top: number; chin: number; half: number; open: number; round?: number; wide?: number }
    chest?: { cx: number; cy: number; rx: number; ry: number }
  }
  layers: LayerDef[]
  tuning?: Partial<Tuning>
  /** labels: every language's name (v4), label the one picked for this page */
  expressions?: { id: string; label: string; labels?: Labels; key?: string }[]
  /** class.input: what the build saw in the picture, read by lidCurveFits */
  profile?: { id: string; label: string; class?: { input?: { facing?: string; glasses?: boolean } } }
  rig?: Partial<Rig>
  /** the version of the layer images, added by the server: a hash of their names and bytes */
  tex?: string
  /** head-turn keyforms measured from a generated video: a file next to model.json. Optional, an
   *  older player ignores it */
  keyforms?: string
  /** the corner mark an exported package carries: "LivLiv" on the free plan, the owner's own text,
   *  or null. The SDK draws it; livliv.ai draws its own over the live window. A v4 package's is meta.watermark */
  watermark?: string | null
  /** v4 only: the package's meta (author, license, generator, the mark it asks for) and its optional files */
  meta?: ModelMeta
  files?: ModelFiles
}
/** keyforms.json: for each key pose (angleX or angleY at `value`, at the model's turn / nod tuning of the time) one
 *  displacement field per layer group on a `cell` px grid, int16 dx, dy in `units` px, rows x cols, base64: "head" for
 *  every head layer, "hair" for every hair layer (one field, like the hair weights: no seam between two hair layers can
 *  open), or a layer's own id */
export interface KeyformFile {
  version: number; cell: number; cols: number; rows: number; units: number; turn: number; nod: number
  /** param 'diag': a key only a caller weights (keyWeights), not an angle (the multi-view player's corners) */
  keys: { param: 'angleX' | 'angleY' | 'diag'; value: number; fields: Record<string, string>
    /** groups whose field is the head's, stored once (a field written three times tripled the file) */
    same?: string[] }[]
  /** per group, on the same grid (uint8, 255 = all of it, base64): how much of the measured pose a vertex takes, the
   *  rest staying as the rig puts it ("face only": the features move as measured, the face's outline as the rig) */
  mask?: Record<string, string>
  /** 'hermite': each angle's two keys (-v, +v) blend so the motion's speed is the same on both sides of 0: linearly, a turn whose left and right keys differ changed speed as it crossed the front. Missing: linear */
  interp?: 'hermite'
}
/** per-category rig recipe written by the pipeline */
export type Rig = {
  yaw: number; pitch: number; roll: number; bulge: number
  /** spring chains [k1, c1, gain, k2, c2]: the bangs', long hair's, and (optional) the side hair's: hair beside
   *  the face at head height takes it instead of the bangs' by how far out it lies (SIDE_AT); without it, the bangs' */
  hair: { front: number[]; back: number[]; side?: number[] }; hair_limit: number
  /** how much each chain [front, back, side] is thrown by the head's own acceleration: the face's centre on the
   *  head is the pivot, so a turn or nod leaves the hair behind and lets it swing back when the head stops, as a Cubism
   *  pendulum does. Missing: the chains only take the hair root's speed (gain) and the wind */
  hair_drive?: number[]
  wind: number; breath: number; sway: number; brow: number
  /** torso: share of the head turn / tilt it follows, breathing amount, chest spring (0 = none) */
  body: { yaw: number; roll: number; breath: number; bust: number }
  /** pieces that swing on their own (hand-rigged builds); optional */
  chains?: ChainDef[]
  /** how much a nod eases off toward the ends of its range (0.25 when missing); 0 keeps it linear, which a player
   *  blending puppets of several drawn views needs (they meet half way only if each moves in proportion) */
  pitch_ease?: number
  /** the bulge's profile, 1 - r^(2 * bulge_shape) (1 when missing: a paraboloid). Above 1 the middle of the face is
   *  flatter and the cheeks steeper: the eyes keep their width on a turn while the face's sides foreshorten (per character) */
  bulge_shape?: number
  /** how far the whole head drifts toward a turn / a nod, in head radii at a full one ([0.12, 0.08] when missing) */
  drift?: [number, number]
  /** the bulge's reach, in head radii sideways, up and down ([1, 1, 1] when missing: the skull ellipse). Past 1 the
   *  hair round the skull (crown, temples, ears, a hat) lies on the same rounded volume and turns with the face, and the
   *  face keeps its shape on a turn: the foreshortening is spread over the whole head instead of piling up at the face's
   *  edge (the rig template). A 4th value is the reach sideways low on the head: from the skull's middle down
   *  the sideways reach eases to it, reached at the 5th value (a share of the reach down; 1 when missing: at the chin),
   *  so what hangs beside the jaw and the neck stays with the body (v3) */
  bulge_extent?: [number, number, number] | [number, number, number, number] | [number, number, number, number, number]
  /** the neck twists with the head: under what chinFollow moves with the head, the neck's column takes
   *  `twist` of the head's sideways shift at the chin, fading to none `reach` face heights below the chin (0.45 when
   *  missing). Missing: the neck stays with the body, as before */
  neck?: { twist: number; reach?: number }
  /** the jaw drop for builds whose edits measured none, as a share of the face height at the open frame (procJaw,
   *  0.015, when missing) */
  jaw?: number
  /** the mesh lattice's cell (model px), pinned: a full-body model keeps the head-chest density (12) on its tall
   *  canvas. Missing: from the canvas (format.ts latticeCell) */
  lattice?: number
}
/** one swinging piece: a rope of points (root first, model px) pulled toward its drawn shape in the frame of what it
 *  hangs from, thrown by that root's acceleration, kept hanging down by gravity as far as `hang` says. Cubism's
 *  physics does the same with pendulums driving parameters; here the rope bends the layers' meshes directly */
export interface ChainDef {
  id: string
  /** what the root moves with: the head (at `depth`, like a head layer) or the torso */
  attach?: 'head' | 'body'; depth?: number
  points: [number, number][]
  /** pull toward the drawn shape at the root end and at the tip (1/s²): stiff roots, loose tips */
  k: [number, number]
  /** velocity damping (1/s) */
  damp: number
  /** how far the root's acceleration throws it (1: like a free pendulum) */
  drive: number
  /** 0: the shape turns with the head / torso; 1: it keeps hanging straight down when they tilt */
  hang: number
  /** idle sway at the tip (model px) and its rate (Hz) */
  wind: number; freq?: number
  /** how far a joint may leave its rest place (model px) */
  limit?: number
  /** skinning falloff (model px): between two chains a vertex takes the nearer one */
  sigma?: number
  /** how far from its line (model px) the chain still bends the layer, fading out to 1.6x that; none: the whole layer
   *  (a strand, a tail). With it a chain bends one part of a big layer (a side volume of the back hair) and the rest
   *  keeps the layer's hair springs */
  reach?: number
  /** degrees the chain bends (around its root) at a full expression, by expression param: an ahoge drooping when sad */
  bias?: Record<string, number>
}
export const defaultRig = (): Rig => ({
  yaw: 0.27, pitch: 0.22, roll: 0.5, bulge: 0.6,
  hair: { front: [140, 11, 0.022, 70, 7], back: [48, 5.5, 0.06, 24, 3.5] }, hair_limit: 0.25,
  wind: 1, breath: 1, sway: 1, brow: 0.06,
  body: { yaw: 0.35, roll: 0.3, breath: 1, bust: 0 },
})
/** user-facing "feel" settings (livliv.ai's feel sliders); 1 = default. nod scales up / down on top of turn. hair is how
 *  freely the hair swings; hairFront (the bangs' springs) and hairBack (long hair's, and the swinging pieces': chains)
 *  each take its place when set, so a model saved with hair alone moves both as before.
 *  gaze: the share of the iris's travel it uses, 0-1. Less shows less of what a far look uncovers in the whites and fixes
 *  none of it; above 1 only shows more, so it stops at 1.
 *  fringe: how far the bangs stand off the face, their depth times this (fringeScale): 0 lies on the face, more only up
 *  to FRINGE_MAX */
export type Tuning = { turn: number; nod: number; hair: number; blink: number; expr: number; mouth: number; breath: number; hairFront?: number; hairBack?: number; gaze: number; fringe?: number }
export const defaultTuning = (): Tuning => ({ turn: 1, nod: 1, hair: 1, blink: 1, expr: 1, mouth: 1, breath: 1, gaze: 1 })
/** the deepest the bangs go when tuning.fringe pulls them out: the usual 0.15 bangs reach 2x; at 0.45 (3x) strands
 *  crossed the eyes on a turn. A layer drawn deeper keeps its own depth */
export const FRINGE_MAX = 0.3
/** what tuning.fringe at `k` does to a layer of depth `d`: a factor on its depth, 1 at k = 1 exactly (nothing else read), so a
 *  character nobody moved it on draws as before bit for bit. Per layer, not per vertex: the fall-off at the skull's edge stays */
export function fringeScale(d: number, k: number | undefined): number {
  const f = typeof k === 'number' && Number.isFinite(k) && k >= 0 ? k : 1
  if (f === 1 || !(d > 0)) return 1
  return Math.min(Math.max(d, FRINGE_MAX), d * f) / d
}
/** how far tuning.fringe can go on a character whose bangs have depth `d` (2 at most; 0 when it has no bangs depth to scale) */
export const fringeTop = (d: number) => (d > 0 ? Math.min(2, Math.max(d, FRINGE_MAX) / d) : 0)

interface GLLayer {
  def: LayerDef
  tex: WebGLTexture; frames: WebGLTexture[]; mask?: WebGLTexture; talk?: WebGLTexture; browTex?: WebGLTexture
  vao: WebGLVertexArrayObject; pos: WebGLBuffer; uvs: WebGLBuffer; tris: WebGLBuffer; count: number
  rest: Float32Array; out: Float32Array
  /** the mesh's triangles (vertex indices, the index buffer's) */
  tri: Uint32Array
  /** the main texture's size in texels */
  tw: number; th: number
  /** the GL buffer holds `out` as deform left it (several renders of one frame, as the multi-view player does, upload
   *  it once: re-uploading a buffer a draw still uses waited on that draw, 94 ms a frame drawing one puppet thrice) */
  uploaded?: boolean
  wHead: Float32Array; wPhys1: Float32Array; wPhys2: Float32Array; dep: Float32Array; wFront: Float32Array
  wBrow: Float32Array; browSide: Int8Array; wJaw: Float32Array
  /** the most the brow field moves each vertex (model px; Infinity: no cap), from brow_lines' cap */
  browCap: Float32Array
  /** body (neckFollow): how much of the head's roll each vertex takes about the neck */
  wNeck?: Float32Array
  /** body (rig.neck): how much of the head's sideways shift at the chin each vertex takes */
  wTwist?: Float32Array
  /** brows drawn over the bangs: per vertex how far it moves as the front hair does instead of as the head
   *  (fol; folB for the brows an expression drew, browTex, drawn from outB), and the front hair's weights there (alt:
   *  dep, wHead, wPhys1, wPhys2, wFront per vertex) */
  fol?: Float32Array; folB?: Float32Array; outB?: Float32Array; alt?: Float32Array
  stencilRef: number
  /** eye patch and iris (lidCurve): per vertex, the height its column squashes toward, the closed lash the lid layer draws */
  pivY?: Float32Array
  /** iris (lidCurve): that height at the iris's centre, where irisLid's drop is measured */
  pivC?: number
  /** iris: how far it sits off its eye patch this frame (model px, at most 1): 0 at rest, where the stencil cuts it as
   *  always; above it the soft mask takes over (softIris). Eye patch: the channel of the mask texture its whites
   *  were drawn into this frame, -1 none (the stencil) */
  soft: number
  maskCh: number
  /** per keyform (Puppet.keys order): how far each vertex sits from where the rig alone puts it at that key pose */
  kf?: (Float32Array | null)[]
  /** the chains bending it (LayerDef.bones), and for brows over chained bangs the bangs' chains (alt) */
  skin?: Skin; altSkin?: Skin
}
/** per vertex and bone (n x B, flat): the chain (index into Puppet.chainRuns), the segment its nearest point lies on, how
 *  far along it, the vertex's offset from that point, and its weight */
/** an iris's room toward the nose (model px, nasalRoom): how far its eye's whites go on past its inner visible edge,
 *  the side the nose is on (+1: +x), that edge at rest, and the iris's visible width */
interface Nasal { room: number; sign: number; inner: number; w: number }
interface Skin { B: number; c: Int16Array; seg: Int16Array; t: Float32Array; ux: Float32Array; uy: Float32Array; w: Float32Array
  /** per vertex, how much of the chains it takes in all (0: out of their reach, skipped) */
  sum: Float32Array }
interface ChainRun {
  def: ChainDef
  /** rest joints, current and previous joints (the root's frame, model px), segment lengths, arc length (0..1) */
  R: Float32Array; p: Float32Array; q: Float32Array; len: Float32Array; s: Float32Array
  /** per joint: displacement from rest and how far the rope turned there (rad) */
  disp: Float32Array; beta: Float32Array
  /** the root in the world, its velocity, its smoothed acceleration, and the turn of its frame (rad) */
  W: [number, number]; V: [number, number]; acc: [number, number]; rho: number; started: boolean; phase: number
  /** any joint off its rest place (else the chain bends nothing and its layers skip it) */
  moving: boolean
}

const VS = `#version 300 es
in vec2 aPos; in vec2 aUv; uniform vec4 uView; out vec2 vUv;
void main(){ vUv=aUv; vec2 p=aPos*uView.xy+uView.zw; gl_Position=vec4(p.x,-p.y,0.,1.); }`
/** uMode 0: a layer; 1: an eye's whites as coverage, into the mask texture; 2: an iris times its whites there (the
 *  channel uMaskSel picks, at this pixel), from the 0.5 cut the stencil makes (uSoft 0) to their alpha (1) */
const FS = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; uniform float uAlpha; uniform float uCut; out vec4 o;
uniform int uMode; uniform sampler2D uMask; uniform highp ivec2 uMaskOff; uniform vec4 uMaskSel; uniform float uSoft;
void main(){ vec4 c=texture(uTex,vUv); if(c.a<uCut) discard;
  if(uMode==1){ o=vec4(c.a); return; }
  if(uMode==2){ highp ivec2 q=ivec2(gl_FragCoord.xy)-uMaskOff, n=textureSize(uMask,0);
    float m=all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,n))?dot(texelFetch(uMask,q,0),uMaskSel):0.;
    c*=mix(step(.5,m),m,uSoft); }
  o=c*uAlpha; }`

/** mouthOpen where the half and the open frame take over, the dead band around each switch, and how long a frame is
 *  held at least (s): a voice envelope crosses the thresholds ~11 times a second and a fifth of its swings last a single
 *  frame, which as mouth shapes is flicker, not speech. 55 ms: no shape shorter than 50 ms, 97% of loud syllables still
 *  reach the open frame (20 chat voice clips) */
const MOUTH_AT = [0.12, 0.5], MOUTH_HYST = 0.04, MOUTH_HOLD = 0.055
/** how far below the chin the build's jaw-shadow layer reaches, in face heights */
const NECK_SHADOW = 0.3
/** |vowel| that switches an open mouth to the round / wide frame, and below which it goes back to the loudness frames:
 *  the cue crosses 0.65 on held o / u / i / e and on the w of "wa" (rounded lips: right), stays under it on a and
 *  on the glides of ia / iao */
const VOWEL_IN = 0.65, VOWEL_OUT = 0.35
/** how long after the last open frame the character still counts as talking (s): the gaps between syllables */
const TALK_LATCH = 0.4

/** cap (optional): per sample the most the brow may move there (model px), where it lies under opaque bangs */
export type BrowLine = { x: number[]; bottom: number[]; lid: number[]; cap?: number[] }
const interp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1])
  return ys[ys.length - 1]
}
const browWx = (b: number[], x: number) => 1 - smooth(0, (b[2] - b[0]) * 0.45, Math.max(b[0] - x, x - b[2], 0))
const browUp = (b: number[]) => (b[3] - b[1]) * 1.6 + 6
/** brow lift weight at (x, y): fading out above the brow box, full down to the brow's lowest pixel in this column and
 *  gone at the lash's highest (brow_lines, in newer builds), so a drooping brow moves whole and the lash never does.
 *  Older builds took the top of the lash for the brow on almost every character: lifting it ghosted the lash, and moving
 *  the whole eye stack stretches the eye instead, so their brows stay still (no brow_lines) */
function browWeight(b: number[], line: BrowLine, x: number, y: number) {
  if (y < b[1]) return browWx(b, x) * (1 - smooth(0, browUp(b), b[1] - y))
  const bot = interp(line.x, line.bottom, x)
  return y <= bot ? browWx(b, x) : browWx(b, x) * (1 - smooth(bot, interp(line.x, line.lid, x), y))
}

/** how far the brows may move (model px) before the mesh folds: the falloff above the brow (raise) and the gap between
 *  brow and lash (lower) must stay ~1.5x longer than the move where it applies. Both brows share the smaller limit */
function browLimits(A: ModelDef['anchors'], amp: number): [number, number] {
  let up = amp, down = amp, any = false
  A.brows?.forEach((b, side) => {
    const line = A.brow_lines?.[side]
    if (!b || !line) return
    any = true
    up = Math.min(up, 0.6 * browUp(b))
    line.x.forEach((x, k) => { down = Math.min(down, (0.6 * (line.lid[k] - line.bottom[k])) / Math.max(1e-3, browWx(b, x))) })
  })
  return any ? [up, down] : [0, 0]
}

/** what a caller may give a load: see Puppet.load */
interface LoadExtras { signal?: AbortSignal; onImage?: (came: number, of: number) => void }

/** a layer's images, as they came in */
interface LayerImages { main: HTMLImageElement; frames: HTMLImageElement[]; mask?: HTMLImageElement; talk?: HTMLImageElement; brows?: HTMLImageElement }

interface Spring { x: number; y: number; vx: number; vy: number }
const spring = (): Spring => ({ x: 0, y: 0, vx: 0, vy: 0 })
type Group = 'front' | 'back' | 'side'
/** where hair at head height takes the side chain instead of the bangs' (rig.hair.side): from 0 to 1 between
 *  these distances from the head's centre line, in skull half-widths. One function of position, like place()'s f, so
 *  two layers meeting at a seam swing alike */
const SIDE_AT = [0.5, 0.85]

export class Puppet {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement
  model!: ModelDef
  private anchorModel: ModelDef | null = null
  layers: GLLayer[] = []
  byId = new Map<string, GLLayer>()
  params: Params = defaultParams()
  prog: WebGLProgram
  uView: WebGLUniformLocation; uAlpha: WebGLUniformLocation; uTex: WebGLUniformLocation; uCut: WebGLUniformLocation
  uMode: WebGLUniformLocation; uMaskOff: WebGLUniformLocation; uMaskSel: WebGLUniformLocation; uSoft: WebGLUniformLocation
  /** softIris: the whites of the eyes whose iris moved, drawn as they show this frame over the eyes' box (a channel
   *  each), and that box's size as allocated (it only grows) */
  maskFb: WebGLFramebuffer | null = null
  maskTex: WebGLTexture | null = null
  maskSize: [number, number] = [0, 0]
  /** per hair group a 2-segment chain [root->mid, mid->tip]: the bangs', long hair's (side hair takes either by where it
   *  lies, place()'s f), and the side hair's when the rig has one (rig.hair.side) */
  chains: Record<Group, [Spring, Spring]> = { front: [spring(), spring()], back: [spring(), spring()], side: [spring(), spring()] }
  lastHead = { x: 0, y: 0, roll: 0 }
  /** rig.hair_drive's pivot: the face's centre on the head, its smoothed velocity and acceleration (model px, s) */
  drive = { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, started: false }
  /** smoothed torso pose (degrees): the body lags the head */
  body = { yaw: 0, roll: 0 }
  /** chest spring: position / velocity, relative to the chest anchor's rigid motion */
  bust = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 }
  time = 0
  background: [number, number, number, number] = [0, 0, 0, 0]
  zoom = 1
  panY = 0
  /** where the user put the character, on top of zoom / panY: x, y as shares of the canvas width / height (y up), s a
   *  scale around the canvas center (dragging and zooming in the live window) */
  view = { x: 0, y: 0, s: 1 }
  /** automatic movement on top of that, same units (talking hops, head position, actions). It never lifts a bottom
   *  edge the drawing is cut off at (half-body characters) above where `view` alone puts it: render() moves the
   *  picture down by whatever it would show */
  move = { x: 0, y: 0, s: 1 }
  /** the drawing reaches its bottom edge (cut off there): set on load from anchors.bottom_y (never on a full-body model) */
  cutBottom = false
  /** what the camera fits into the view on a full-body model: its head-chest frame (the default, as a half-body
   *  picture), the whole figure, or down to the knees. A model without anchors.frame always fits its canvas */
  fit: Fit = 'frame'
  /** full-body models: the crouch and the talking dip automatic movement asks for (setMove; shares of the frame's
   *  height, <= 0). The crouch drops the hips, the legs shorten as straight lines and the feet stay; the dip lowers
   *  only what is above the waist band */
  crouch = 0
  dip = 0
  /** full-body models: the share of the hips' slow shift of weight (0: they stay still); physicsScale scales
   *  all of the hips' and the hem's motion */
  fbIdle = 1
  /** the model stands on a ground line (anchors.body): automatic movement keeps its feet there */
  get grounded() { return !!this.fb }
  private fb: FullBody | null = null
  /** the hips' shift (model px) and its speed, their tilt (rad), the hem's spring (model px) */
  private fbm = { hs: 0, hv: 0, tilt: 0, tanTilt: 0, hem: 0, hemV: 0, breath: 0 }
  /** body layers take the hips' tilt and the hem on top (deform sets it per layer; hair has its own chains) */
  private fbParts = false
  /** a full-body model's pose, worked out once per change (bodyOffset runs for every vertex): the waist's and the
   *  ankles' turns (rad, with their cos / sin), the hips' shift, the crouch and the dip (model px) */
  private pv = { roll: NaN, cr: NaN, dp: NaN, mx: NaN, hs: NaN, tilt: NaN, aw: 0, cw: 1, sw: 0, aa: 0, ca: 1, sa: 0, x: 0, y: 0, dip: 0 }
  /** device pixels per CSS pixel at most (the power-saving mode draws at 1) */
  maxDpr = 2
  /** draw at exactly this many pixels (a video's frame) instead of the canvas's size on the page */
  size: [number, number] | null = null
  physicsScale = 1
  hidden = new Set<string>()
  tuning: Tuning = defaultTuning()
  /** the bangs layer's own depth (0: none), which the brows over them (alt) were weighted with: tuning.fringe scales it */
  bangsDepth = 0
  rig: Rig = defaultRig()
  /** extra expression weights by layer param name (smile lives in params) */
  expr: Record<string, number> = {}
  /** displayed smile: eases toward params.smile so switching it never pops */
  smileShown = 0
  /** mouth frame shown (0 the picture's own mouth, 1 half, 2 open, then round / wide / shut where the build has them, see vis): follows
   *  mouthOpen and vowel with hysteresis and a minimum hold, and switches at once. Any fade between two different
   *  drawings shows both half transparent (a pale double mouth), and while talking the frames change so often that a
   *  ~70 ms fade meant the mouth was nearly always mid-fade.
   *  mouthW: each frame's weight for the jaw, which eases after the frame in ~40 ms */
  mouthFrame = 0
  mouthW = [1, 0, 0]
  mouthHeld = 1
  /** loudness level (0 closed, 1 half, 2 open) and vowel shape of the frame shown: the states the hysteresis runs from */
  mouthAmp = 0
  mouthShape: '' | 'round' | 'wide' = ''
  /** frame index of the round / wide mouth, when the build has them, and of the closed mouth a picture drawn with
   *  its mouth open talks with between syllables */
  vis: { round?: number; wide?: number; shut?: number } = {}
  /** each frame's kind (closed, half, open, round, wide) and jaw drop (model px) */
  frameKind: string[] = ['closed', 'half', 'open']
  frameJaw: number[] = [0, 0, 0]
  /** jaw drop for builds whose edits measured none (most in newer builds: the open edits rarely move the drawn jaw line), as a
   *  share of the face height at the open frame (half 0.45, round 0.7, wide 0.35 of it). 1.5 %: the chin line moves
   *  4-8 px, no gap at the neck on the 20 shown characters open / turned / tilted. 0 turns it off; set before load() */
  procJaw = 0.015
  /** the chin as one piece while talking and nodding: the mouth frames hold
   *  the original lower face round the mouth (and on some builds the chin line): they follow the jaw like the face, the
   *  frame's own squeeze fading out toward the chin; the neck right under the chin follows the head and the jaw, so the
   *  drawn chin shadow stays under the chin. false: as before. Set before load() */
  chinFollow = true
  /** how far below the chin the neck still follows the head, as a share of the face height (chinFollow) */
  chinNeck = 0.08
  /** across, from the face's centre line: the neck follows fully within the first share of the face width and not at
   *  all past the second (chinFollow) */
  chinNeckX: [number, number] = [0.2, 0.34]
  /** the shoulders by the neck tilt with the head's roll this much, fading out within neckFollowY face heights
   *  below the neck line and from neckFollowX face widths across; 0: still, as before. Set before load() */
  neckFollow = 0.2
  neckFollowY = 0.6
  neckFollowX: [number, number] = [0.6, 1.3]
  /** time left of 'talking' (TALK_LATCH after the last half / open frame) */
  talkLeft = 0
  /** center the view on the head (eval / close-up shots) */
  focusHead = false
  /** the model's keyforms (param, value, and the tuning they were measured at); kfOff: the rig alone (while measuring
   *  it, and for side-by-side comparisons) */
  keys: { param: 'angleX' | 'angleY' | 'diag'; value: number; scale: number }[] = []
  /** keyforms.json's interp 'hermite': per key, the key on the other side of 0 of the same angle (-1: none) */
  private kfPair: number[] | null = null
  kfOff = false
  /** each key's weight (Puppet.keys order) set by the caller instead of taken from the angle: a player switching
   *  between puppets of drawn views morphs each toward the other's layout over a fixed time */
  keyWeights: number[] | null = null
  /** draw only the layers this accepts (a player composing one picture from several puppets: the hair of one, the face
   *  of another); null draws all */
  only: ((d: LayerDef) => boolean) | null = null
  /** draw the mask layers (roles hole, edge, edge_wide: moved like any layer, never drawn otherwise) */
  masks = false
  /** a half-closed eye squashes toward the closed lash its lid layer draws, column by column, on the models lidCurveFits
   *  allows; false: toward one height per eye on every model, as before (for comparisons). Set before load() */
  lidCurve = true
  /** a half-closed eye covers the iris like a lid: the eye patch and its whites squash as before; the iris above
   *  the line they squash toward keeps its shape, drops irisDrop of the way its centre would have gone (the pupil
   *  stays in the slit) and goes under the upper lid, the part below squashes with the lower lid (its round bottom
   *  stays on the lower lash: cut there instead, a big iris came out a box at 45 %). Only irises with gaze travel: one
   *  without fills its eye (a chibi's bead, a mascot's pupil), and cut flat by an undrawn lid it read as a dark bar;
   *  it squashes whole, as before. false: every iris squashes with its patch, flat (for comparisons) */
  irisLid = true
  irisDrop = 0.3
  /** an iris off its eye patch (a glance, a blink) is cut by the whites' alpha, antialiased; false: by the 1-bit
   *  stencil at mask alpha 0.5 everywhere, stepped along the cut (for comparisons). At rest it is the
   *  stencil either way, so the rest pose stays as built */
  softIris = true
  /** a look toward the nose stops the iris's inner edge at the drawn inner corner, where the whites end: past it
   *  the whites' straight end cut the iris. Its far edge travels on, so the iris narrows as an eyeball
   *  turning does, to irisNasalNarrow of its width at most, and then stops whole (1: stops whole at the corner, the eyes
   *  diverge). Outward, up and down as before; false: the build's travel both ways (for comparisons) */
  irisNasal = true
  irisNasalNarrow = 0.7
  /** per eye side (L / R): its iris's room toward the nose, measured at load */
  private nasal: Partial<Record<string, Nasal>> = {}
  /** the model's swinging pieces (rig.chains), simulated in update() */
  chainRuns: ChainRun[] = []
  /** a model with swinging chains (rig.chains): its highlights follow the gaze and sparkle */
  get chained() { return this.chainRuns.length > 0 }
  /** multi-view players (one puppet per drawn view): leave out the body (a side view drawn over the front one keeps the
   *  front's torso) or everything but the body (the front's head once the side view has taken over) */
  bodyHidden = false
  headHidden = false
  /** the last frame's view transform (render): scale x / y, offset x / y in clip space, and the drawing buffer size */
  lastView: [number, number, number, number, number, number] = [1, 1, 0, 0, 1, 1]

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true, stencil: true })
    if (!gl) throw new Error('this browser has no WebGL2')
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUv')
    gl.linkProgram(p)
    this.prog = p
    this.uView = gl.getUniformLocation(p, 'uView')!
    this.uAlpha = gl.getUniformLocation(p, 'uAlpha')!
    this.uTex = gl.getUniformLocation(p, 'uTex')!
    this.uCut = gl.getUniformLocation(p, 'uCut')!
    this.uMode = gl.getUniformLocation(p, 'uMode')!
    this.uMaskOff = gl.getUniformLocation(p, 'uMaskOff')!
    this.uMaskSel = gl.getUniformLocation(p, 'uMaskSel')!
    this.uSoft = gl.getUniformLocation(p, 'uSoft')!
    gl.useProgram(p)
    gl.uniform1i(gl.getUniformLocation(p, 'uMask'), 1)
  }

  /** baseUrl: the model's folder, or its model.json (the SDK: any name ending in .json); the images are read relative to
   *  it. png: load the lossless layer PNGs even where a WebP copy exists (eval: rest-pose PSNR is scored against the
   *  source, and quality-92 WebP alone costs 1.3–6.4 dB on line art). pack: try the server's textures.bin first (an
   *  exported package has none: the SDK turns it off rather than ask for it and get a 404). signal: calls the load off
   *  until the model starts going in, which then happens at once and whole; it rejects with the signal's reason and the
   *  model before stays. onImage: each image that has come in, of how many */
  async load(baseUrl: string, { png = false, pack: usePack = true, signal, onImage }: { png?: boolean; pack?: boolean } & LoadExtras = {}) {
    const { file, base, query } = locate(baseUrl)
    const r = await fetch(file + (query ? `?${query}` : ''), { cache: 'no-store', signal })
    if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'model not found' : `model.json ${r.status}`), { status: r.status })
    const text = await r.text()
    if (text.length > LIMITS.modelJson) throw coded('too-large', `model.json is larger than ${LIMITS.modelJson} bytes`)
    const model = readModel(JSON.parse(text))
    // layer files keep their names when a character is rebuilt and are cached for hours, while model.json never is:
    // tag them with the version of their bytes the server sends with it (tex), so a save of the feel settings, which rewrites
    // model.json, keeps them cached. Without it (a copy served elsewhere), a hash of the layer list and of model.json's
    // date: a rebuild can keep every layer's box, and with the list alone browsers kept
    // drawing the old images for up to four hours
    let tag = model.tex
    if (!tag) {
      const sig = JSON.stringify(model.layers) + (r.headers.get('last-modified') || '')
      let h = 0
      for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0
      tag = (h >>> 0).toString(36)
    }
    const v = `?v=${tag}${query ? `&${query}` : ''}`
    // alongside the images, not before them. Without it the character still plays, on the rig alone
    const keyforms = model.keyforms ? fetch(base + model.keyforms + v, { signal }).then(async (k) => {
      const t = k.ok ? await k.text() : ''
      return t && t.length <= LIMITS.keyforms ? JSON.parse(t) as KeyformFile : undefined
    }).catch(() => undefined) : undefined
    // all of them in one file when the server has it: one request instead of ~30
    const pack = png || !usePack ? null : await loadPack(packUrl(baseUrl, tag), signal)
    // (an <img> cannot be called off: setting src to '' is an error, removing it never ends)
    const fetched = (f: string) => (signal ? fetchImage(base + f + v, signal) : loadImage(base + f + v))
    await this.loadModel(model, (f) => { const b = pack?.get(f); return b ? loadBlob(b) : fetched(f) }, { png, keyforms, signal, onImage })
  }

  /** a model from anywhere (the SDK: files the user picked): its model.json, and each image it names by its path there */
  async loadModel(raw: ModelDef, image: (path: string) => Promise<HTMLImageElement>,
    { png = false, keyforms: keyformsComing, signal, onImage }: { png?: boolean; keyforms?: KeyformFile | Promise<KeyformFile | undefined> } & LoadExtras = {}) {
    const model = readModel(raw)
    let asked = 0, came = 0
    const arrived = (i: HTMLImageElement) => { onImage?.(++came, asked); return i }
    // every image at once: a layer's second image waiting for its first cost a round trip each on a slow path
    const [imgs, keyforms] = await Promise.all([Promise.all(model.layers.map(async (L) => {
      const load = (p: string) => { asked++; return image(L.webp && !png ? p.replace(/\.png$/, '.webp') : p).then(arrived) }
      const [main, frames, mask, talk, brows] = await Promise.all([load(L.texture), Promise.all((L.frames || []).map(load)),
        L.mask ? load(L.mask) : undefined, L.talk ? load(L.talk) : undefined, L.brow_tex ? load(L.brow_tex) : undefined])
      return { main, frames, mask, talk, brows }
    })), keyformsComing])
    if (signal?.aborted) throw signal.reason
    // before anything reaches the GPU (an image's size is known once it loads, before it is decoded in full)
    const most = Math.min(LIMITS.texture, (this.gl?.getParameter(this.gl.MAX_TEXTURE_SIZE) as number) || LIMITS.texture)
    let texels = 0
    for (const im of imgs) for (const i of [im.main, ...im.frames, im.mask, im.talk, im.brows]) {
      if (!i) continue
      const w = i.naturalWidth || i.width, h = i.naturalHeight || i.height
      if (w > most || h > most || (texels += w * h) > LIMITS.texels) {
        throw coded('too-large', `this model's images are too large (${w} x ${h}: ${most} px a side and ${LIMITS.texels} pixels in all at most)`)
      }
    }
    this.install(model, imgs, keyforms)
  }

  /** the model in place of the one before, or, if anything throws on the way (its layers, its keyforms, the GPU out of
   *  memory), the one before exactly as it was: its layers on the GPU, every field, every spring. All in one go: no frame
   *  runs in between. The GPU holds both for that moment */
  private install(model: ModelDef, imgs: LayerImages[], keyforms: KeyformFile | undefined) {
    const gl = this.gl
    // every field; copies of the two this changes in place rather than replaces
    const before = { ...this, drive: { ...this.drive },
      chains: Object.fromEntries(Object.entries(this.chains).map(([g, c]) => [g, c.map((q) => ({ ...q }))])) as Puppet['chains'] }
    const built: GLLayer[] = []
    for (let i = 0; i < 8 && gl.getError(); i++);  // an error left by anything earlier is not this model's
    try {
      this.build(model, imgs, keyforms, built)
      for (let i = 0, e; i < 8 && (e = gl.getError()); i++) {  // (one flag at a time, in no set order)
        if (e === gl.OUT_OF_MEMORY) throw coded('too-large', 'the GPU ran out of memory for this model')
      }
    } catch (e) {
      this.freeLayers(built)
      Object.assign(this, before)
      throw e
    }
    this.freeLayers(before.layers)
    this.freeMask()
  }

  private build(model: ModelDef, imgs: LayerImages[], keyforms: KeyformFile | undefined, built: GLLayer[]) {
    this.model = model
    this.chainRuns = (model.rig?.chains || []).map(chainRun)
    const mouth = model.layers.find((L) => L.role === 'mouth')
    this.frameKind = (mouth?.frames || ['', '', '']).map((_, i) => mouth?.visemes?.[i] || ['closed', 'half', 'open'][i] || '')
    // the jaw drop each frame was drawn with (a half drop moves the jaw only where the open one does, as it always has)
    const J = model.anchors.jaw as Record<string, number> | undefined
    this.frameJaw = this.frameKind.map((k) => (J && k !== 'closed' && (k !== 'half' || J.open > 0) ? J[k] || 0 : 0))
    const procJaw = this.procJaw > 0 ? model.rig?.jaw ?? this.procJaw : 0  // off stays off (comparisons)
    if (J && procJaw > 0 && !this.frameJaw.some((j) => j > 0)) {
      const fh = model.anchors.face[3] - model.anchors.face[1], amt: Record<string, number> = { half: 0.45, open: 1, round: 0.7, wide: 0.35 }
      this.frameJaw = this.frameKind.map((k) => procJaw * fh * (amt[k] ?? 0))
    }
    this.vis = {}
    this.frameKind.forEach((k, i) => { if (k === 'round' || k === 'wide' || k === 'shut') this.vis[k] = i })
    // the brows layers lie over the bangs where the build put them there: they follow what is under them
    const fi = model.layers.findIndex((L) => L.group === 'hair_front')
    const bangs = fi >= 0 ? { img: imgs[fi].main, def: model.layers[fi] } : undefined
    this.bangsDepth = bangs?.def.depth ?? 0
    model.layers.forEach((L, i) => built.push(this.buildLayer(L, imgs[i].main, imgs[i].frames, imgs[i].mask, imgs[i].talk, imgs[i].brows,
      L.id === 'brows' || L.role === 'expr_brows' || L.brow_tex ? bangs : undefined)))
    this.layers = built
    this.byId = new Map(this.layers.map((l) => [l.def.id, l]))
    // each iris's room toward the nose: the nose lies toward the eyes' midpoint (a view with one eye has no limit)
    this.nasal = {}
    const eyes = model.anchors.eyes
    if (eyes && eyes.length >= 2) {
      const mid = eyes.reduce((s, b) => s + (b[0] + b[2]) / 2, 0) / eyes.length
      model.layers.forEach((I, i) => {
        const side = I.role?.startsWith('iris_') ? I.role.slice(5) : ''
        const j = I.clip ? model.layers.findIndex((E) => E.id === I.clip) : -1
        const mask = j >= 0 ? imgs[j].mask : undefined
        if (!side || !I.range || !mask || this.nasal[side]) return
        const n = nasalRoom(imgs[i].main, I, mask, model.layers[j], mid > I.x + I.w / 2 ? 1 : -1)
        if (n) this.nasal[side] = n
      })
    }
    if (this.lidCurve && lidCurveFits(model)) {
      for (const side of ['L', 'R']) {
        const i = model.layers.findIndex((L) => L.role === `lid_${side}`)
        const line = i >= 0 ? closedLashLine(imgs[i].main, model.layers[i]) : null
        if (!line) continue  // no lash found: the single pivot, as before
        for (const L of this.layers) {
          if (L.def.role !== `eye_${side}` && L.def.role !== `iris_${side}` && L.def.role !== `shine_${side}`) continue
          L.pivY = new Float32Array(L.rest.length / 2)
          for (let k = 0; k < L.pivY.length; k++) L.pivY[k] = line(L.rest[2 * k])
          L.pivC = line(L.def.x + L.def.w / 2)
        }
      }
    }
    this.tuning = { ...defaultTuning(), ...(model.tuning || {}) }
    // the chest spring (rig.body.bust) is off for every model, as on livliv.ai: a value saved in a model is not applied.
    // Breathing stays, with the chest lift every other figure has
    this.rig = { ...defaultRig(), ...(model.rig || {}), hair: { ...defaultRig().hair, ...(model.rig?.hair || {}) },
      body: { ...defaultRig().body, ...(model.rig?.body || {}), bust: 0 } }
    this.expr = {}
    this.resetMouth(); this.talkLeft = 0
    this.fb = model.anchors.body ? fullBody(model.anchors, model.canvas) : null
    this.cutBottom = !this.fb && model.anchors.bottom_y >= model.canvas[1] - 4
    // all that carries over from frame to frame starts again: nothing of the model before moves this one (and a NaN
    // in the torso's smoothing once stayed there for good, whatever was loaded next)
    this.resetPhysics()
    this.keys = []; this.kfPair = null
    if (keyforms && keyformsFit(keyforms)) this.prepareKeyforms(keyforms)
    else if (keyforms) console.warn('LivLiv: keyforms.json is not one this player reads; the character plays on the rig alone')
  }

  /** each key pose's fields, as a per-vertex offset from the rig's own pose at that key: measured once here with the
   *  springs at rest, the torso settled and the face neutral, so at the key the character stands exactly as in the clip
   *  and everything else (physics, blinks, mouth, brows, roll) keeps moving on top of it */
  private prepareKeyforms(K: KeyformFile) {
    // base64 to bytes, each field once (one field can serve every head layer). A plain loop: Uint8Array.from(text, mapper)
    // calls back per character, which took half of the refined Nana's load
    const seen = new Map<string, Uint8Array>()
    const bytes = (b64: string) => {
      let out = seen.get(b64)
      if (!out) {
        const text = atob(b64)
        out = new Uint8Array(text.length)
        for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
        seen.set(b64, out)
      }
      return out
    }
    const save = { params: this.params, body: { ...this.body }, bust: { ...this.bust }, mouthW: this.mouthW, smile: this.smileShown,
      chains: Object.values(this.chains).map((c) => c.map((q) => ({ ...q }))) }
    const B = this.rig.body, tt = this.tuning.turn
    K.keys.forEach((key, ki) => {
      const P = { ...defaultParams(), [key.param]: key.value }
      this.params = P
      this.body = { yaw: P.bodyX + P.angleX * B.yaw * tt, roll: P.bodyZ + P.angleZ * this.rig.body.roll * tt }
      for (const c of Object.values(this.chains)) for (const q of c) Object.assign(q, spring())
      Object.assign(this.bust, { x: 0, y: 0, vx: 0, vy: 0 })
      this.mouthW = [1, 0, 0]; this.smileShown = 0
      this.kfOff = true
      this.deform()
      this.kfOff = false
      for (const L of this.layers) {
        // "torso": one field for every body layer (a drawn view's neck and collar), where the file has one
        const has = (f: string) => !!key.fields[f] || !!key.same?.includes(f)
        const g = Object.hasOwn(key.fields, L.def.id) ? L.def.id : L.def.group === 'head' ? 'head' : L.def.group.startsWith('hair') ? 'hair'
          : L.def.group === 'body' && has('torso') ? 'torso' : L.def.id
        const b64 = key.fields[g] ?? (key.same?.includes(g) ? key.fields.head : undefined)
        L.kf ||= []
        if (!b64) { L.kf[ki] = null; continue }
        const raw = bytes(b64)
        const f = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1)
        const m = K.mask?.[g] ? bytes(K.mask[g]) : undefined
        const d = new Float32Array(L.rest.length)
        for (let i = 0; i < d.length; i += 2) {
          const [dx, dy] = sampleField(f, K, L.rest[i], L.rest[i + 1])
          const w = m ? sampleMask(m, K, L.rest[i], L.rest[i + 1]) : 1
          d[i] = (L.rest[i] + dx - L.out[i]) * w; d[i + 1] = (L.rest[i + 1] + dy - L.out[i + 1]) * w
        }
        L.kf[ki] = d
      }
      // the key's angle in the tuning of today: a change in the feel settings of turn / nod scales the rig's turn, and the key with it
      const nod = key.param === 'angleY'
      this.keys.push({ param: key.param, value: key.value, scale: (tt * (nod ? this.tuning.nod : 1)) / (K.turn * (nod ? K.nod : 1)) })
    })
    this.params = save.params; this.body = save.body; Object.assign(this.bust, save.bust); this.mouthW = save.mouthW
    this.smileShown = save.smile
    Object.values(this.chains).forEach((c, i) => c.forEach((q, j) => Object.assign(q, save.chains[i][j])))
    this.kfPair = K.interp === 'hermite'
      ? this.keys.map((k) => this.keys.findIndex((o) => o.param === k.param && k.param !== 'diag' && o.value === -k.value)) : null
  }

  dispose() {
    this.anchorModel = null
    this.freeLayers(this.layers)
    this.freeMask()
    this.layers = []
  }

  private freeLayers(layers: GLLayer[]) {
    const gl = this.gl
    for (const L of layers) {
      gl.deleteTexture(L.tex); L.frames.forEach((t) => gl.deleteTexture(t)); if (L.mask) gl.deleteTexture(L.mask); if (L.talk) gl.deleteTexture(L.talk)
      if (L.browTex) gl.deleteTexture(L.browTex)
      gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.pos); gl.deleteBuffer(L.uvs); gl.deleteBuffer(L.tris)
    }
  }

  private freeMask() {
    const gl = this.gl
    if (this.maskFb) { gl.deleteFramebuffer(this.maskFb); gl.deleteTexture(this.maskTex); this.maskFb = this.maskTex = null; this.maskSize = [0, 0] }
  }

  private texture(img: HTMLImageElement) {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    } catch (e) {
      gl.deleteTexture(t)
      throw e
    }
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private buildLayer(L: LayerDef, img: HTMLImageElement, frames: HTMLImageElement[], mask?: HTMLImageElement, talk?: HTMLImageElement,
    brows?: HTMLImageElement, bangs?: { img: HTMLImageElement; def: LayerDef }): GLLayer {
    const gl = this.gl
    const A = this.model.anchors
    const browLayer = this.model.layers.some((l) => l.id === 'brows')
    // every layer's vertices sit on ONE global lattice, so the piecewise-linear deformation is identical
    // for overlapping layers: patches (eyes, mouth, expressions) can never drift off the face at big angles
    const cell = latticeOf(this.model)
    const gx0 = Math.floor(L.x / cell), gy0 = Math.floor(L.y / cell)
    const cols = Math.ceil((L.x + L.w) / cell) - gx0, rows = Math.ceil((L.y + L.h) / cell) - gy0
    const occ = alphaGrid([img, ...frames], cols, rows, (L.x - gx0 * cell) / cell, (L.y - gy0 * cell) / cell, L.w / cell, L.h / cell)
    const vid = new Int32Array((cols + 1) * (rows + 1)).fill(-1)
    const pos: number[] = [], uv: number[] = [], idx: number[] = []
    const vert = (c: number, r: number) => {
      const k = r * (cols + 1) + c
      if (vid[k] < 0) {
        vid[k] = pos.length / 2
        const X = (gx0 + c) * cell, Y = (gy0 + r) * cell
        pos.push(X, Y); uv.push((X - L.x) / L.w, (Y - L.y) / L.h) // outside [0,1] samples the transparent crop pad
      }
      return vid[k]
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!occ[r * cols + c]) continue
      const a = vert(c, r), b = vert(c + 1, r), d = vert(c, r + 1), e = vert(c + 1, r + 1)
      idx.push(a, b, d, b, e, d)
    }
    const n = pos.length / 2
    const rest = new Float32Array(pos)
    const wHead = new Float32Array(n), wPhys1 = new Float32Array(n), wPhys2 = new Float32Array(n)
    const dep = new Float32Array(n), wBrow = new Float32Array(n), browSide = new Int8Array(n).fill(-1), wFront = new Float32Array(n)
    const browCap = new Float32Array(n).fill(Infinity)
    const wJaw = new Float32Array(n)
    const wNeck = this.neckFollow > 0 && L.group === 'body' ? new Float32Array(n) : undefined
    const NT = this.model.rig?.neck
    const wTwist = NT && NT.twist > 0 && L.group === 'body' ? new Float32Array(n) : undefined
    // a brows layer moves, near each vertex, as what it is drawn over at rest: the front hair as far as the bangs are
    // opaque under its strokes, the head elsewhere. It carries the strand outlines crossing a brow and is unmixed
    // against the bangs under it; moved with the head alone, the brow and those bits of strand slid 2-4 px off the
    // bangs on every tilt and turn, a dark bar with a comb of strand pieces over black hair (Rei), 1-2 px on Aster
    // The brows an expression drew likewise: unmixed against the bangs under them, they show only where
    // they differ from them
    const fol = bangs && (L.id === 'brows' || L.role === 'expr_brows') ? coverAt(img, L, bangs.img, bangs.def, rest, cell) : undefined
    const folB = bangs && brows ? coverAt(brows, L, bangs.img, bangs.def, rest, cell) : undefined
    const alt = fol || folB ? new Float32Array(5 * n) : undefined
    const fw = A.face[2] - A.face[0]
    const h = A.head
    // long hair only starts to swing below the jaw: anything at head height (hats, side locks) stays rigid
    const hairTop = A.neck_y - 0.1 * h.ry
    // ... and swings fully at its own tips: on a full-body model the drawing's bottom is the feet, far below them
    const hairLen = Math.max(1, (A.body && A.hair_bottom_y != null ? A.hair_bottom_y : A.bottom_y) - hairTop)
    for (let i = 0; i < n; i++) {
      const x = rest[2 * i], y = rest[2 * i + 1]
      const rr = Math.hypot((x - h.cx) / h.rx, (y - h.cy) / h.ry)
      dep[i] = L.group === 'head' ? L.depth
        : L.group === 'hair_front' ? L.depth * smooth(L.fall_end ?? 1.0, L.fall ?? 0.55, rr)
          : L.depth * smooth(L.fall_end ?? 1.0, L.fall_end === undefined ? 0.7 : L.fall ?? 0.7, rr)
      // long-hair skinning / physics (shared by side + back, and by front hair near the skull outline)
      const longHead = 1 - smooth(A.neck_y + 0.05 * h.ry, A.neck_y + 1.1 * h.ry, y) // hair beside the jaw moves with the head
      const tl = Math.min(1, Math.max(0, (y - hairTop) / hairLen))
      const lp1 = smooth(0, 0.55, tl), lp2 = Math.pow(smooth(0.25, 1, tl), 1.3)
      // ONE weight field for every hair layer, a function of position only: two layers that overlap at a seam
      // always get the same head-follow and physics weights, so they can never tear apart on a tilt or turn.
      // f = 1 inside the skull and above the neck (bangs-like), 0 for long hair; blends smoothly in between.
      const f = smooth(0.95, 0.7, rr) * (1 - smooth(A.neck_y - 0.2 * h.ry, A.neck_y + 0.3 * h.ry, y))
      const tb = smooth(A.hair_root_y + 0.25 * h.ry, h.cy + 0.7 * h.ry, y)
      if (L.group === 'head') wHead[i] = 1
      else if (L.group === 'body') wHead[i] = 0
      else {
        wHead[i] = f + (1 - f) * longHead
        wPhys1[i] = f * tb + (1 - f) * lp1; wPhys2[i] = f * tb * tb + (1 - f) * lp2
        wFront[i] = f
        if (L.group === 'hair_inner') { wHead[i] *= 0.5; wPhys1[i] *= 0.35; wPhys2[i] *= 0.35 }
      }
      if (alt && bangs) {  // the front hair's own weights at this vertex: the same lattice point moves the same way
        const k = 5 * i
        alt[k] = bangs.def.depth * smooth(1.0, bangs.def.fall ?? 0.55, rr); alt[k + 1] = f + (1 - f) * longHead
        alt[k + 2] = f * tb + (1 - f) * lp1; alt[k + 3] = f * tb * tb + (1 - f) * lp2; alt[k + 4] = f
      }
      const hairFront = L.group === 'hair_side' || L.group === 'hair_front'
      const mouthCopy = this.chinFollow && L.role === 'mouth'
      // the jaw's shadow on the neck is cast by the jaw: it drops with it, like the chin over it
      if ((L.id === 'face' || L.role === 'expr' || hairFront || mouthCopy || L.role === 'neck_shadow') && A.jaw && this.frameJaw.some((j) => j > 0)) {
        // lower face follows the jaw when the mouth opens (chin line meets the open-mouth frame). The same field, a
        // function of position only, for every layer that holds a copy of the lower face: the expression patches (a still
        // patch over the dropped face showed two chin lines while the character talked with one held, Elio) and the hair
        // in front of it, around the jaw line only (strands over the jaw keep a piece of the chin line: left behind, the
        // chin line broke into steps beside the hair, Nemo / Mochi)
        const vy = smooth(A.jaw.top - 0.02 * h.ry, A.jaw.chin, y) * (hairFront ? 1 - smooth(A.jaw.chin, A.jaw.chin + 0.15 * h.ry, y) : 1)
        const vx = 1 - smooth(0.22 * fw, 0.5 * fw, Math.abs(x - h.cx))
        wJaw[i] = vy * vx
      }
      if (L.role === 'neck_shadow' && A.jaw) {
        // the jaw's shadow on the neck goes with the head and the jaw right under the jaw and less further down,
        // to still at the depth the build split it to: one piece on a turn. Moved rigidly with the head, the end of a long
        // shadow slid off the neck's own shading and its tip doubled (Elio)
        const k = 1 - smooth(A.jaw.chin, A.jaw.chin + NECK_SHADOW * (A.face[3] - A.face[1]), y)
        wHead[i] = k
        wJaw[i] *= k
      }
      if (this.chinFollow && L.group === 'body' && A.jaw) {
        // the neck right under the chin goes with the head and the jaw: the chin's shadow is drawn on the body, and with
        // the body still the chin slid off it, a light band and the shadow's edge as a second chin line on every look
        // up (the hidden neck under the face, lit, came out) and on a talking jaw drop. Under the face the body moves as
        // the face does; below the chin that fades out within chinNeck face heights, on the neck's width only (a collar
        // or the hair beside it stays with the body)
        const fh = A.face[3] - A.face[1]
        const wy = 1 - smooth(A.jaw.chin, A.jaw.chin + this.chinNeck * fh, y)
        const wx = 1 - smooth(this.chinNeckX[0] * fw, this.chinNeckX[1] * fw, Math.abs(x - h.cx))
        const w = wy * wx
        if (w > 0) {
          wHead[i] = w
          if (this.frameJaw.some((j) => j > 0)) {
            const vy = smooth(A.jaw.top - 0.02 * h.ry, A.jaw.chin, y)
            wJaw[i] = vy * (1 - smooth(0.22 * fw, 0.5 * fw, Math.abs(x - h.cx))) * w
          }
        }
      }
      if (wNeck) {
        // the shoulders and collar by the neck tilt a little with the head: the hair resting on them follows the
        // head almost fully there and the body only with its own lean, so a twin tail lifted off Nana's hoodie and left
        // a gap on every tilt. The roll alone: following the whole head as well, a turn bent the neck's outline below
        // the chin. What chinFollow already moves with the head takes only the rest
        const fh = A.face[3] - A.face[1]
        wNeck[i] = Math.max(0, this.neckFollow * (1 - smooth(A.neck_y, A.neck_y + this.neckFollowY * fh, y))
          * (1 - smooth(this.neckFollowX[0] * fw, this.neckFollowX[1] * fw, Math.abs(x - h.cx))) - wHead[i])
      }
      if (wTwist && NT) {
        // the neck's column below the chin goes a share of the way the chin goes sideways: with the neck
        // still, a turn slid the jaw across a front-facing neck and its shading. On the neck's width only, like
        // chinFollow; what chinFollow already moves with the head takes only the rest
        const fh = A.face[3] - A.face[1], cy = A.jaw?.chin ?? A.neck_y
        wTwist[i] = Math.max(0, NT.twist * (1 - smooth(cy, cy + (NT.reach ?? 0.45) * fh, y))
          * (1 - smooth(this.chinNeckX[0] * fw, this.chinNeckX[1] * fw, Math.abs(x - h.cx))) - wHead[i])
      }
      if (A.brows && L.group === 'head' && !(L.role || '').startsWith('iris_') && (!browLayer || L.id === 'brows')) {
        // ONE brow field for every head layer, a function of position only (like the hair weights): eye patches, lid
        // skin and expression patches hold their own copy of the skin, crease and lash near the brow, and lifting
        // the face alone slid the face's copy out from under them, a second lash line / brow over each eye.
        // The iris follows the gaze instead. Brows with a layer of their own move alone: no other layer holds
        // them, and bending the face there slid the skin and bangs drawn on it against the strand lines
        A.brows.forEach((b, side) => {
          const line = A.brow_lines?.[side]
          if (!b || !line) return
          const w = browWeight(b, line, x, y)
          if (w > wBrow[i]) { wBrow[i] = w; browSide[i] = side; browCap[i] = line.cap ? interp(line.x, line.cap, x) : Infinity }
        })
      }
    }
    // chained layers: the chains replace the hair springs (the brows over chained bangs follow the bangs' chains)
    const skin = L.bones?.length ? this.skinOf(L.bones, rest) : undefined
    // the chains replace the hair springs, except where reaching chains leave a layer partly to them
    if (skin && !L.bones!.every((id) => this.chainRuns.find((c) => c.def.id === id)?.def.reach !== undefined)) { wPhys1.fill(0); wPhys2.fill(0) }
    if (L.rigid) { wPhys1.fill(0); wPhys2.fill(0) }
    const altSkin = alt && bangs?.def.bones?.length ? this.skinOf(bangs.def.bones, rest) : undefined
    if (alt && altSkin) for (let i = 0; i < n; i++) { alt[5 * i + 2] = 0; alt[5 * i + 3] = 0 }
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const pb = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, rest, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const ub = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0)
    const ib = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    const tri = new Uint32Array(idx)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tri, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    // an upload can throw (a canvas's image it may not read): nothing of this layer stays on the GPU
    const made: WebGLTexture[] = []
    const texture = (i: HTMLImageElement) => { const t = this.texture(i); made.push(t); return t }
    let tex: WebGLTexture, frameTex: WebGLTexture[], maskTex: WebGLTexture | undefined, talkTex: WebGLTexture | undefined, browTex: WebGLTexture | undefined
    try {
      tex = texture(img); frameTex = frames.map(texture); maskTex = mask && texture(mask); talkTex = talk && texture(talk); browTex = brows && texture(brows)
    } catch (e) {
      made.forEach((t) => gl.deleteTexture(t))
      gl.deleteVertexArray(vao); gl.deleteBuffer(pb); gl.deleteBuffer(ub); gl.deleteBuffer(ib)
      throw e
    }
    return {
      def: L, tex, frames: frameTex, mask: maskTex, talk: talkTex, browTex,
      vao, pos: pb, uvs: ub, tris: ib, count: idx.length, rest, out: new Float32Array(rest.length), tri, tw: img.naturalWidth || img.width, th: img.naturalHeight || img.height,
      wHead, wPhys1, wPhys2, dep, wBrow, browSide, browCap, wFront, wJaw, wNeck, wTwist, fol, folB, alt,
      outB: folB ? new Float32Array(rest.length) : undefined, stencilRef: 0, soft: 0, maskCh: -1, skin, altSkin,
    }
  }

  /** each vertex's place on the chains `ids` (rig.chains): its nearest point on each chain's line (segment, how far
   *  along), its offset from there, and a weight by distance (a Gaussian of sigma, normalised over the chains) */
  private skinOf(ids: string[], rest: Float32Array): Skin | undefined {
    const cs = ids.map((id) => this.chainRuns.findIndex((c) => c.def.id === id)).filter((c) => c >= 0)
    if (!cs.length) return undefined
    const n = rest.length / 2, B = cs.length
    const S: Skin = { B, c: new Int16Array(n * B), seg: new Int16Array(n * B), t: new Float32Array(n * B),
      ux: new Float32Array(n * B), uy: new Float32Array(n * B), w: new Float32Array(n * B), sum: new Float32Array(n) }
    for (let i = 0; i < n; i++) {
      const x = rest[2 * i], y = rest[2 * i + 1]
      let sum = 0
      cs.forEach((ci, b) => {
        const C = this.chainRuns[ci], R = C.R, m = R.length / 2
        let best = Infinity, bk = 0, bt = 0
        for (let k = 0; k < m - 1; k++) {
          const ax = R[2 * k], ay = R[2 * k + 1], dx = R[2 * k + 2] - ax, dy = R[2 * k + 3] - ay
          const L2 = dx * dx + dy * dy || 1
          let t = ((x - ax) * dx + (y - ay) * dy) / L2
          // before the root and past the tip the line goes on straight: the area round the root turns with it too
          if (k > 0) t = Math.max(0, t)
          if (k < m - 2) t = Math.min(1, t)
          const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py)
          if (d < best) { best = d; bk = k; bt = t }
        }
        const j = i * B + b, k = bk, tt = Math.min(1, bt)  // past the tip: the offset from the tip, turning with it
        const px = R[2 * k] + (R[2 * k + 2] - R[2 * k]) * tt, py = R[2 * k + 1] + (R[2 * k + 3] - R[2 * k + 1]) * tt
        const sg = C.def.sigma ?? 40
        S.c[j] = ci; S.seg[j] = k; S.t[j] = bt; S.ux[j] = x - px; S.uy[j] = y - py
        S.w[j] = Math.exp(-((best / sg) ** 2)) + 1e-6
        sum += S.w[j]
      })
      // reach: a vertex beyond it keeps less of the chains (the normalised weights scaled down by its distance)
      let near = Infinity, reach = Infinity
      for (let b = 0; b < B; b++) {
        const C = this.chainRuns[S.c[i * B + b]]
        S.w[i * B + b] /= sum
        if (C.def.reach !== undefined) reach = Math.min(reach, C.def.reach)
        near = Math.min(near, Math.hypot(S.ux[i * B + b], S.uy[i * B + b]))
      }
      if (reach < Infinity) { const k = 1 - smooth(reach, 1.6 * reach, near); for (let b = 0; b < B; b++) S.w[i * B + b] *= k }
      for (let b = 0; b < B; b++) S.sum[i] += S.w[i * B + b]
    }
    return S
  }

  /** a vertex's offset from the chains bending it (world px), into o */
  private skinOffset(S: Skin, i: number, o: [number, number]) {
    let ox = 0, oy = 0
    if (S.sum[i] < 1e-4) { o[0] = 0; o[1] = 0; return }
    for (let b = 0; b < S.B; b++) {
      const j = i * S.B + b, C = this.chainRuns[S.c[j]], k = S.seg[j]
      if (!C.moving) continue
      // before the root the rope has not moved; past the tip it goes on as the last segment does
      const t = Math.min(1, Math.max(0, S.t[j])), e = S.t[j] < 0 ? 0 : 1
      const dx = (C.disp[2 * k] + (C.disp[2 * k + 2] - C.disp[2 * k]) * t) * e
      const dy = (C.disp[2 * k + 1] + (C.disp[2 * k + 3] - C.disp[2 * k + 1]) * t) * e
      const be = (C.beta[k] + (C.beta[k + 1] - C.beta[k]) * t) * e
      const c = Math.cos(be), s = Math.sin(be), ux = S.ux[j], uy = S.uy[j]
      const lx = dx + ux * c - uy * s - ux, ly = dy + ux * s + uy * c - uy
      const cr = Math.cos(C.rho), sr = Math.sin(C.rho)  // the root's frame is turned with the head / torso
      ox += S.w[j] * (lx * cr - ly * sr); oy += S.w[j] * (lx * sr + ly * cr)
    }
    o[0] = ox; o[1] = oy
  }

  /** where a chain's root is in the world and how far its frame is turned (rad), into o: [x, y, rho] */
  private chainRoot(def: ChainDef, P: Params, nb: [number, number], o: number[]) {
    const [rx, ry] = def.points[0], A = this.model.anchors
    if (def.attach === 'body') {
      const b: [number, number] = [0, 0]
      this.bodyOffset(rx, ry, P, b)
      o[0] = rx + b[0]; o[1] = ry + b[1]
      // the torso's lean there, as bodyOffset turns it (a full-body model: the waist's and the ankles' turns)
      o[2] = this.fb ? this.fbTurn(ry) : (this.body.roll * Math.PI) / 180 * smooth(A.bottom_y, A.neck_y, ry)
    } else {
      const h: [number, number] = [0, 0]
      this.headXform(rx, ry, def.depth ?? 0, P, h)
      o[0] = h[0] + nb[0]; o[1] = h[1] + nb[1]
      o[2] = (P.angleZ * Math.PI) / 180 * this.rig.roll * this.tuning.turn
    }
  }

  /** how opaque an expression patch (or its brows) is drawn */
  private exprAlpha(d: LayerDef) {
    return smooth(0.3, 0.7, d.param === 'smile' || !d.param ? this.smileShown : (this.expr[d.param] ?? 0))
  }

  /** a layer's opacity from its show / hide expressions (1 without them) */
  private moodAlpha(d: LayerDef) {
    const sum = (m?: Record<string, number>) => { let a = 0; for (const [k, v] of Object.entries(m || {})) a += v * this.exprValue(k); return Math.min(1, a) }
    return (d.show ? sum(d.show) : 1) * (d.hide ? 1 - sum(d.hide) : 1)
  }

  /** whether render() will draw the layer this frame (deform() skips the rest) */
  private shown(L: GLLayer) {
    const d = L.def, role = d.role || ''
    if (this.hidden.has(d.id)) return false
    if (d.group === 'body' ? this.bodyHidden : this.headHidden) return false
    if ((d.show || d.hide) && this.moodAlpha(d) <= 0.01) return false
    if (role === 'expr' || role === 'expr_brows') return this.exprAlpha(d) > 0.01
    if (role.startsWith('lid_')) return 1 - smooth(0.05, 0.35, role === 'lid_L' ? this.params.eyeLOpen : this.params.eyeROpen) > 0.01
    if (role === 'blush') {
      let a = 0
      for (const [k, v] of Object.entries(d.blush || {})) a += v * this.exprValue(k)
      return a > 0.01
    }
    return true
  }

  /** an expression's weight as shown (smile eases, the others are set by the page) */
  private exprValue(param: string) { return param === 'smile' ? this.smileShown : this.expr[param] ?? 0 }

  /** every chain one step: verlet rope pulled toward its drawn shape (counter-turned by the tilt as far as it hangs,
   *  bent by expressions, swayed by wind), thrown by its root's acceleration, its segments kept at length */
  private stepChains(dt: number) {
    if (!this.chainRuns.length || dt <= 0) return
    const P = this.params, A = this.model.anchors
    const nb: [number, number] = [0, 0]
    this.bodyOffset(A.head.cx, A.neck_y, P, nb)
    const g = this.physicsScale * (this.tuning.hairBack ?? this.tuning.hair), r = [0, 0, 0]  // long hair, pendants
    for (const C of this.chainRuns) {
      const d = C.def, R = C.R, p = C.p, q = C.q, m = R.length / 2
      this.chainRoot(d, P, nb, r)
      if (!C.started) { C.W = [r[0], r[1]]; C.V = [0, 0]; C.acc = [0, 0]; C.started = true }
      const vx = (r[0] - C.W[0]) / dt, vy = (r[1] - C.W[1]) / dt
      const ax = (vx - C.V[0]) / dt, ay = (vy - C.V[1]) / dt
      C.W = [r[0], r[1]]; C.V = [vx, vy]; C.rho = r[2]
      const ks = Math.min(1, dt * 30)  // one frame's jitter in the root is not a throw
      C.acc[0] += (ax - C.acc[0]) * ks; C.acc[1] += (ay - C.acc[1]) * ks
      const cr = Math.cos(-C.rho), sr = Math.sin(-C.rho)
      const lax = C.acc[0] * cr - C.acc[1] * sr, lay = C.acc[0] * sr + C.acc[1] * cr
      let bias = 0
      for (const [k, v] of Object.entries(d.bias || {})) bias += v * this.exprValue(k)
      const turn = -C.rho * d.hang + (bias * Math.PI) / 180, ct = Math.cos(turn), st = Math.sin(turn)
      const f = d.freq ?? 0.5, wt = 2 * Math.PI * f * this.time + C.phase
      const wind = d.wind * g * this.rig.wind * (Math.sin(wt) + 0.4 * Math.sin(1.7 * wt + 2 * C.phase))
      const damp = Math.max(0, 1 - d.damp * dt)
      for (let j = 1; j < m; j++) {
        const s = C.s[j], k = d.k[0] + (d.k[1] - d.k[0]) * s
        const tx = R[2 * j] - R[0], ty = R[2 * j + 1] - R[1]
        const gx = R[0] + tx * ct - ty * st + wind * s, gy = R[1] + tx * st + ty * ct
        const fx = k * (gx - p[2 * j]) - d.drive * g * lax, fy = k * (gy - p[2 * j + 1]) - d.drive * g * lay
        const nx = p[2 * j] + (p[2 * j] - q[2 * j]) * damp + fx * dt * dt
        const ny = p[2 * j + 1] + (p[2 * j + 1] - q[2 * j + 1]) * damp + fy * dt * dt
        q[2 * j] = p[2 * j]; q[2 * j + 1] = p[2 * j + 1]; p[2 * j] = nx; p[2 * j + 1] = ny
      }
      // segments keep their length, root pinned; no joint wanders further than limit
      const lim = d.limit ?? Infinity
      for (let j = 1; j < m; j++) {
        const dx = p[2 * j] - p[2 * j - 2], dy = p[2 * j + 1] - p[2 * j - 1], l = Math.hypot(dx, dy) || 1
        p[2 * j] = p[2 * j - 2] + (dx / l) * C.len[j]; p[2 * j + 1] = p[2 * j - 1] + (dy / l) * C.len[j]
        const ex = p[2 * j] - R[2 * j], ey = p[2 * j + 1] - R[2 * j + 1], e = Math.hypot(ex, ey)
        if (e > lim) { p[2 * j] = R[2 * j] + (ex * lim) / e; p[2 * j + 1] = R[2 * j + 1] + (ey * lim) / e }
      }
      let mv = 0
      for (let j = 0; j < m; j++) {
        C.disp[2 * j] = p[2 * j] - R[2 * j]; C.disp[2 * j + 1] = p[2 * j + 1] - R[2 * j + 1]
        mv = Math.max(mv, Math.abs(C.disp[2 * j]), Math.abs(C.disp[2 * j + 1]))
      }
      C.moving = mv > 1e-3
      // how far each segment turned, then per joint; the root joint does not turn (what lies round and before the
      // root stays put, so the layer cannot tear there)
      const al: number[] = []
      for (let k = 0; k < m - 1; k++) {
        const rx = R[2 * k + 2] - R[2 * k], ry = R[2 * k + 3] - R[2 * k + 1], cx = p[2 * k + 2] - p[2 * k], cy = p[2 * k + 3] - p[2 * k + 1]
        al.push(Math.atan2(rx * cy - ry * cx, rx * cx + ry * cy))
      }
      C.beta[0] = 0
      for (let j = 1; j < m - 1; j++) C.beta[j] = 0.5 * (al[j - 1] + al[j])
      C.beta[m - 1] = al[m - 2]
    }
  }

  // ---------------------------------------------------------------- rig
  /** the head's turn, nod and roll as sines and cosines: the same for every vertex of a frame, so worked out once per
   *  pose (it was six trig calls per vertex, the biggest part of a frame) */
  private hxC = { ax: NaN, ay: NaN, az: NaN, t: NaN, n: NaN, ry: NaN, rp: NaN, rr: NaN, pe: NaN, cy: 1, sy: 0, cp: 1, sp: 0, cr: 1, sr: 0 }
  private headTrig(P: Params) {
    const c = this.hxC, R = this.rig, tt = this.tuning.turn, nd = this.tuning.nod ?? 1, pe = R.pitch_ease ?? 0.25
    if (c.ax !== P.angleX || c.ay !== P.angleY || c.az !== P.angleZ || c.t !== tt || c.n !== nd || c.ry !== R.yaw ||
      c.rp !== R.pitch || c.rr !== R.roll || c.pe !== pe) {
      // up / down eases off toward the ends of the range (a full nod turns 25% less, small nods the same): live
      // tracking reaches ±30 on every big nod, and that is where the bangs slide furthest over the face
      const py = P.angleY / 30
      const yaw = (P.angleX / 30) * R.yaw * tt, pitch = py * (1 - pe * py * py) * R.pitch * tt * nd
      const roll = (P.angleZ * Math.PI) / 180 * R.roll * tt
      Object.assign(c, { ax: P.angleX, ay: P.angleY, az: P.angleZ, t: tt, n: nd, ry: R.yaw, rp: R.pitch, rr: R.roll, pe,
        cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch), cr: Math.cos(roll), sr: Math.sin(roll) })
    }
    return c
  }

  private headXform(x: number, y: number, depth: number, P: Params, out: [number, number]) {
    const h = this.model.anchors.head
    const u = (x - h.cx) / h.rx, v = (y - h.cy) / h.ry
    const R = this.rig
    const q = R.bulge_shape ?? 1  // q = 1: the paraboloid, the same float operations as before the field
    const E = R.bulge_extent  // the head's volume past the skull ellipse: u, v as shares of it
    let ex = E ? E[0] : 1
    if (E && E.length > 3 && v > 0) {
      const t = Math.min(1, v / (E[2] * (E[4] ?? 1)))
      ex += (E[3]! - E[0]) * t * t * (3 - 2 * t)
    }
    const bu = E ? u / ex : u, bv = E ? v / (v < 0 ? E[1] : E[2]) : v
    const bulge = R.bulge * Math.max(0, q === 1 ? 1 - bu * bu - bv * bv : 1 - Math.pow(bu * bu + bv * bv, q))
    const z = bulge + depth
    const { cy, sy, cp, sp, cr, sr } = this.headTrig(P)
    let u2 = u * cy + z * sy
    const z2 = -u * sy + z * cy
    let v2 = v * cp - z2 * sp
    const dr = R.drift
    u2 += (dr ? dr[0] : 0.12) * sy; v2 -= (dr ? dr[1] : 0.08) * sp // whole head drifts a little toward the turn
    let X = h.cx + u2 * h.rx, Y = h.cy + v2 * h.ry
    const nx = h.cx, ny = this.model.anchors.neck_y
    const dx = X - nx, dy = Y - ny
    X = nx + dx * cr - dy * sr; Y = ny + dx * sr + dy * cr
    out[0] = X; out[1] = Y
  }

  /** rigid torso motion at (x, y): breathing, turn-follow, lean; plus the chest bump when `bust`. A full-body model
   *  (anchors.body) moves by fullBodyOffset instead */
  private bodyOffset(x: number, y: number, P: Params, out: [number, number], bust = true) {
    if (this.fb) { this.fullBodyOffset(x, y, P, out, bust); return }
    const A = this.model.anchors, h = A.head, B = this.rig.body
    const t = smooth(A.bottom_y, A.neck_y, y) // 0 at the bottom edge, 1 at the neck
    const fw = A.face[2] - A.face[0]
    const br = P.breath * this.tuning.breath * this.rig.breath * B.breath
    // breathing: shoulders rise, the chest widens a little
    let dx = (x - h.cx) * 0.01 * br * t
    let dy = -br * 0.024 * h.ry * Math.pow(t, 1.3)
    // turn-follow: the upper torso slides toward the turn, the far side compresses (reads as a rotation)
    const yaw = this.body.yaw / 30
    const bw = 1.4 * fw
    const u = Math.max(-1.6, Math.min(1.6, (x - h.cx) / bw))
    dx += yaw * bw * 0.16 * Math.pow(t, 1.2) * (1 - 0.18 * u * u) + yaw * (x - h.cx) * -0.04 * Math.sign(u) * t
    // lean: rotate the upper body about a pivot below the hips
    const a = (this.body.roll * Math.PI / 180) * t
    if (a !== 0) {
      const px = h.cx, py = A.bottom_y + 0.4 * (A.bottom_y - A.neck_y)
      const rx = x - px, ry = y - py, c = Math.cos(a), s = Math.sin(a)
      dx += rx * (c - 1) - ry * s; dy += rx * s + ry * (c - 1)
    }
    const C = A.chest
    if (C && bust) {
      const ux = (x - C.cx) / C.rx, uy = (y - C.cy) / C.ry, d = Math.sqrt(ux * ux + uy * uy)  // per vertex: hypot allocates
      const w = 1 - smooth(0.2, 1.15, d)
      if (w > 0) {
        dy -= br * 0.012 * h.ry * w * (0.4 + B.bust) // the chest lifts more than the shoulders when breathing in
        dx += this.bust.x * w; dy += this.bust.y * w
      }
    }
    out[0] = dx; out[1] = dy
  }

  /** the upper body's own motion at (x, y) on a full-body model, `t` of the way from the hips (0) to the neck (1):
   *  breathing and the turn-follow slide as bodyOffset has them (the slide FB_GAIN of it), and the waist's turn about
   *  the hips' midpoint by its weight `w` there (0 below the waist band, 1 above it: the upper body turns as one piece
   *  and stays straight) */
  private upperOffset(x: number, y: number, t: number, w: number, P: Params, out: [number, number], bust: boolean, v = this.fbPose()) {
    const A = this.model.anchors, h = A.head, B = this.rig.body, fb = this.fb!
    const br = P.breath * this.tuning.breath * this.rig.breath * B.breath
    let dx = (x - h.cx) * 0.01 * br * t
    let dy = -br * 0.024 * h.ry * Math.pow(t, 1.3)
    const yaw = (this.body.yaw / 30) * FB_GAIN
    const bw = 1.4 * fb.fw
    const u = Math.max(-1.6, Math.min(1.6, (x - h.cx) / bw))
    dx += yaw * bw * 0.16 * Math.pow(t, 1.2) * (1 - 0.18 * u * u) + yaw * (x - h.cx) * -0.04 * Math.sign(u) * t
    if (v.aw !== 0 && w > 0) {
      const rx = x - fb.hx, ry = y - fb.hy
      dx += (rx * (v.cw - 1) - ry * v.sw) * w; dy += (rx * v.sw + ry * (v.cw - 1)) * w
    }
    const C = A.chest
    if (C && bust) {
      const ux = (x - C.cx) / C.rx, uy = (y - C.cy) / C.ry, d = Math.sqrt(ux * ux + uy * uy)
      const wc = 1 - smooth(0.2, 1.15, d)
      if (wc > 0) {
        dy -= br * 0.012 * h.ry * wc * (0.4 + B.bust)
        dx += this.bust.x * wc; dy += this.bust.y * wc
      }
    }
    out[0] = dx; out[1] = dy
  }

  /** a full-body model's weight of the waist's turn (and the talking dip) at height y: 0 below the waist band, 1 above */
  private fbWaist(y: number) {
    const fb = this.fb!
    return smooth(fb.hy + FB_WAIST * fb.fw, fb.hy - FB_WAIST * fb.fw, y)
  }

  /** ... and of the sway from the ankles: 0 at the ankles and below (the feet stay), 1 above the ankle band */
  private fbAnkle(y: number) {
    const fb = this.fb!
    return smooth(fb.ankleY - FB_ANKLE_BAND[0] * fb.fw, fb.ankleY - FB_ANKLE_BAND[1] * fb.fw, y)
  }

  /** how far a full-body model's body is turned at height y (rad): the waist's turn and the ankles' by their weights */
  private fbTurn(y: number) {
    const v = this.fbPose()
    return v.aw * this.fbWaist(y) + v.aa * this.fbAnkle(y)
  }

  /** a full-body model's pose (model px, rad), worked out again only when what it is made of changed: the lean
   *  (body.roll, FB_GAIN of it) split into the waist's turn (1 - FB_ANKLE, less the shoulders' answer to the hips'
   *  tilt) and the ankles' (FB_ANKLE), the webcam's sideways move added to the ankles' as the angle that moves the neck
   *  by move.x frame widths (at most about FB_CAM_SWAY), the hips' shift, the crouch and the dip */
  private fbPose() {
    const v = this.pv, m = this.fbm
    if (v.roll === this.body.roll && v.cr === this.crouch && v.dp === this.dip && v.mx === this.move.x && v.hs === m.hs
      && v.tilt === m.tilt) return v
    const fb = this.fb!, A = this.model.anchors
    const lean = (this.body.roll * FB_GAIN * Math.PI) / 180, lim = (FB_CAM_SWAY * Math.PI) / 180
    // a soft limit: a hard one stopped the sway dead at 3 degrees while the head still turned
    const cam = lim * Math.tanh(Math.atan2(this.move.x * fb.uw, Math.max(1, fb.ankleY - A.neck_y)) / lim)
    const aw = lean * (1 - FB_ANKLE) - FB_SHOULDER_ANSWER * m.tilt, aa = lean * FB_ANKLE + cam
    v.roll = this.body.roll; v.cr = this.crouch; v.dp = this.dip; v.mx = this.move.x; v.hs = m.hs; v.tilt = m.tilt
    v.aw = aw; v.cw = Math.cos(aw); v.sw = Math.sin(aw); v.aa = aa; v.ca = Math.cos(aa); v.sa = Math.sin(aa)
    v.x = m.hs; v.y = -this.crouch * fb.uh; v.dip = -this.dip * fb.uh
    return v
  }

  /** a full-body model's body motion at (x, y), the waist's part first, then the ankles':
   *  - the upper body's own motion (upperOffset: breathing and the turn-follow from the hips up, the waist's turn as one
   *    piece above the waist band);
   *  - the legs take the hips' shift and the crouch by a weight going straight from 1 at the hips to 0 at the ankles, so
   *    a leg stays a straight line and the feet stay; the talking dip moves only what is above the waist band;
   *  - body layers: the hips' tilt and the hem (partsOffset);
   *  - then everything above the ankle band turns about the ankles' midpoint (the legs lean as straight lines).
   *  Arms go by height: a hand hanging beside the thigh moves with the thigh */
  private fullBodyOffset(x: number, y: number, P: Params, out: [number, number], bust: boolean) {
    const fb = this.fb!, A = this.model.anchors
    const t = smooth(fb.hy, A.neck_y, y), w = this.fbWaist(y), v = this.fbPose()
    this.upperOffset(x, y, t, w, P, out, bust, v)
    if (v.x !== 0 || v.y !== 0) {
      const wl = Math.min(1, Math.max(0, (fb.ankleY - y) / (fb.ankleY - fb.hy)))
      out[0] += v.x * wl; out[1] += v.y * wl
    }
    if (v.dip !== 0) out[1] += v.dip * w
    if (this.fbParts) this.partsOffset(x, y, out)
    if (v.aa !== 0) {
      const wa = this.fbAnkle(y)
      if (wa > 0) {
        // the turn's rise and fall (X sin) builds up from the ankle band's top to the hips: in one go within the band a
        // wide stance had one shin stretched and the other pressed by up to 15 %
        const X = x + out[0] - fb.ax, Y = y + out[1] - fb.ay, top = fb.ankleY - FB_ANKLE_BAND[1] * fb.fw
        const wl = Math.min(1, Math.max(0, (top - y) / Math.max(1, top - fb.hy)))
        out[0] += (X * (v.ca - 1) - Y * v.sa) * wa; out[1] += (X * v.sa * wl + Y * (v.ca - 1)) * wa
      }
    }
  }

  /** what a full-body model's body layers take on top: the hips' tilt (its own band at the hips, and down the legs) and
   *  the hem (from a little above the hips, most at the hem line, gone a little below it), with a slow breath across
   *  its width */
  private partsOffset(x: number, y: number, out: [number, number]) {
    const fb = this.fb!, m = this.fbm, B = this.model.anchors.body!, fw = fb.fw
    if (m.tilt !== 0) {
      const below = Math.min(1, Math.max(0, (fb.ankleY - y) / Math.max(1, fb.ankleY - fb.hy)))
      const band = y < fb.hy ? smooth(fb.hy - 1.3 * fw, fb.hy - 0.2 * fw, y) : below
      out[1] += m.tanTilt * (x - fb.hx) * band
    }
    const top = fb.hy - 0.4 * fw
    if (B.hem_y != null && y > top) {
      const hem = B.hem_y
      const g = y <= hem ? Math.pow(Math.min(1, Math.max(0, (y - top) / Math.max(1, hem - top))), 1.6) : 1 - smooth(hem, hem + 0.45 * fw, y)
      if (g > 0) {
        const hx0 = B.hem_x ? (B.hem_x[0] + B.hem_x[1]) / 2 : fb.hx
        out[0] += (m.hem + (x - hx0) * 0.012 * m.breath) * g
      }
    }
  }

  /** a full-body model's springs, one sub-step: the hips follow the upper body and shift their weight a little by
   *  themselves, the hem hangs behind the hips and the sway. physicsScale scales all of it (0: they rest) */
  private stepFb(dt: number) {
    const fb = this.fb!, m = this.fbm, t = this.time, A = this.model.anchors, fw = fb.fw, k = this.physicsScale
    const v = this.fbPose()
    const slide = (this.body.yaw / 30) * FB_GAIN * 1.4 * fw * 0.16, leanMove = Math.sin(v.aw) * (fb.hy - A.neck_y)
    const idle = FB_HIP_IDLE * fw * (Math.sin((t * 2 * Math.PI) / 8.6) * 0.75 + Math.sin((t * 2 * Math.PI) / 3.9 + 1.1) * 0.25)
    const target = k * (FB_HIP_SLIDE * slide - FB_HIP_BACK * leanMove + this.fbIdle * idle)
    m.hv += (-FB_HIP_K * (m.hs - target) - FB_HIP_C * m.hv) * dt
    m.hs += m.hv * dt
    m.tilt = -FB_HIP_TILT * Math.max(-1.2, Math.min(1.2, m.hs / (FB_HIP_REACH * fw)))
    m.tanTilt = Math.tan(m.tilt)
    if (this.model.anchors.body!.hem_y == null) return
    m.breath = Math.sin(t * 1.7) * k  // the hem's slow breath across its width (partsOffset)
    const push = -k * FB_HEM_LAG * (m.hs + (fb.ankleY - fb.hy) * Math.sin(v.aa) * 0.6)
    const wind = k * FB_HEM_WIND * fw * (Math.sin(t * 1.3) + 0.5 * Math.sin(t * 2.9 + 0.6))
    m.hemV += (-FB_HEM_K * (m.hem - push - wind) - FB_HEM_C * m.hemV) * dt
    m.hem = Math.max(-FB_HEM_MAX * fw, Math.min(FB_HEM_MAX * fw, m.hem + m.hemV * dt))
  }

  /** torso lags the head; the chest spring lags the torso (only when the rig asks for it) */
  private stepBody(dt: number) {
    const P = this.params, B = this.rig.body
    const tt = this.tuning.turn
    const ty = P.bodyX + P.angleX * B.yaw * tt, tr = P.bodyZ + P.angleZ * B.roll * tt
    const k = Math.min(1, dt * 5)
    this.body.yaw += (ty - this.body.yaw) * k
    this.body.roll += (tr - this.body.roll) * k
    const C = this.model.anchors.chest
    if (!C || B.bust <= 0) { this.bust.x = this.bust.y = 0; return }
    const o: [number, number] = [0, 0]
    this.bodyOffset(C.cx, C.cy, P, o, false)
    const inv = 1 / Math.max(dt, 1e-4)
    const ax = (o[0] - this.bust.px) * inv, ay = (o[1] - this.bust.py) * inv // chest anchor velocity
    this.bust.px = o[0]; this.bust.py = o[1]
    const s = B.bust * this.physicsScale
    const K = 70, D = 7 // ~1.3 Hz, a few soft overshoots
    this.bust.vx += (-K * this.bust.x - D * this.bust.vx - ax * 3.2 * s) * dt
    this.bust.vy += (-K * this.bust.y - D * this.bust.vy - ay * 4.2 * s) * dt
    this.bust.x += this.bust.vx * dt; this.bust.y += this.bust.vy * dt
    const lim = 0.035 * this.model.anchors.head.ry * (0.5 + s)
    this.bust.x = Math.max(-lim, Math.min(lim, this.bust.x)); this.bust.y = Math.max(-lim, Math.min(lim, this.bust.y))
  }

  /** automatic movement (the player's drivers and actions): the webcam's sideways move `x` and distance `s`, a talking bob `talkHop`
   *  (<= 0), an action's move `actY` (a hop: a crouch, then a flight) and the webcam's lean `camY`, as shares of the view
   *  (y up). A half-body model moves the picture by their sum, as `move` always has. A full-body model (anchors.body)
   *  keeps its feet on the ground line: the sideways move sways it from the ankles (fbPose; render() does not slide
   *  it), a hop's crouch and the webcam's lean down (at most CROUCH_CAM) crouch it, the talking bob dips only the upper
   *  body, only an action's flight lifts the whole figure, and a lean up is not followed (it would float) */
  setMove(x: number, s: number, talkHop: number, actY: number, camY: number) {
    this.move.x = x; this.move.s = s
    if (!this.fb) { this.move.y = talkHop + actY + camY; this.crouch = 0; this.dip = 0; return }
    this.move.y = Math.max(0, actY)
    this.crouch = Math.min(0, actY) + Math.max(-CROUCH_CAM, Math.min(0, camY))
    this.dip = Math.min(0, talkHop)
  }

  /** closed mouth, no hold pending (a new model, a test starting a clip) */
  resetMouth() {
    this.mouthFrame = 0; this.mouthAmp = 0; this.mouthShape = ''; this.mouthHeld = 1
    this.mouthW = this.frameKind.map((_, i) => (i === 0 ? 1 : 0))
  }

  private stepMouth(dt: number) {
    const m = Math.min(1, Math.max(0, this.params.mouthOpen)), v = Math.min(1, Math.max(-1, this.params.vowel || 0))
    const [t1, t2] = MOUTH_AT, h = MOUTH_HYST
    this.mouthHeld += dt
    // loudness: closed / half / open, each step from the level shown
    let a = this.mouthAmp
    if (a === 0 && m > t1 + h) a = m > t2 + h ? 2 : 1
    else if (a === 1 && (m < t1 - h || m > t2 + h)) a = m < t1 - h ? 0 : 2
    else if (a === 2 && m < t2 - h) a = m < t1 - h ? 0 : 1
    // vowel: an open mouth (half or more) takes the round / wide frame while the cue holds past VOWEL_IN; a model
    // without them talks with the three loudness frames as before
    let s = this.mouthShape
    if (!s || (s === 'round' ? v > -VOWEL_OUT : v < VOWEL_OUT)) s = v < -VOWEL_IN ? 'round' : v > VOWEL_IN ? 'wide' : ''
    let want = a > 0 && s && this.vis[s] !== undefined ? this.vis[s]! : a
    // a picture drawn with its mouth open (a fanged grin) keeps it at rest, frame 0, and closes it between syllables
    // while talking; with only frame 0 it never closed its mouth while talking
    if (want === 0 && this.talkLeft > 0 && this.vis.shut !== undefined) want = this.vis.shut
    if (want === this.mouthFrame) { this.mouthAmp = a; this.mouthShape = s }
    else if (this.mouthHeld >= MOUTH_HOLD) { this.mouthFrame = want; this.mouthAmp = a; this.mouthShape = s; this.mouthHeld = 0 }
    const f = this.mouthFrame
    this.talkLeft = f > 0 && f !== this.vis.shut ? TALK_LATCH : Math.max(0, this.talkLeft - dt)
    const k = Math.min(1, dt * 28)
    for (let i = 0; i < this.mouthW.length; i++) this.mouthW[i] += ((i === f ? 1 : 0) - this.mouthW[i]) * k
  }

  /** how far frame `i` is along with mouthOpen `m` (0..1): within a frame the opening keeps moving a little */
  private frameEase(i: number, m: number) {
    const [t1, t2] = MOUTH_AT, kind = this.frameKind[i]
    return kind === 'half' ? smooth(t1, t2, m) : kind === 'open' ? smooth(t2, 1, m) : smooth(t1, 1, m)
  }

  private stepPhysics(dt: number) {
    const P = this.params, A = this.model.anchors
    const ht: [number, number] = [0, 0]
    this.headXform(A.head.cx, A.hair_root_y, 0, P, ht)
    const inv = 1 / Math.max(dt, 1e-4)
    const vx = (ht[0] - this.lastHead.x) * inv, vy = (ht[1] - this.lastHead.y) * inv
    this.lastHead = { x: ht[0], y: ht[1], roll: P.angleZ }
    const D = this.rig.hair_drive, dv = this.drive
    if (D) {  // the pivot's acceleration, low-passed (~40 ms) so a tracked face's jitter does not shake the hair
      const fp: [number, number] = [0, 0]
      this.headXform(A.head.cx, A.head.cy, 0, P, fp)
      if (!dv.started) Object.assign(dv, { x: fp[0], y: fp[1], vx: 0, vy: 0, ax: 0, ay: 0, started: true })
      const ks = Math.min(1, dt * 25)
      const svx = dv.vx + ((fp[0] - dv.x) * inv - dv.vx) * ks, svy = dv.vy + ((fp[1] - dv.y) * inv - dv.vy) * ks
      dv.ax += ((svx - dv.vx) * inv - dv.ax) * ks; dv.ay += ((svy - dv.vy) * inv - dv.ay) * ks
      Object.assign(dv, { x: fp[0], y: fp[1], vx: svx, vy: svy })
    }
    // [k1, c1, gain, k2, c2]: roots stiffer than tips, bangs stiffer than long hair
    const R = this.rig
    const cfg = { front: R.hair.front, back: R.hair.back, side: R.hair.side } as Record<Group, number[]>
    const lim = A.head.ry * R.hair_limit
    for (const key of (R.hair.side ? ['front', 'back', 'side'] : ['front', 'back']) as Group[]) {
      const [k1, c1, g, k2, c2] = cfg[key]
      const [a, b] = this.chains[key]
      // the feel settings' two hair sliders: every hair vertex blends the two chains by one field of its position (place()'s
      // f), so two levels part smoothly across the bangs' edge instead of tearing a seam
      // the side hair goes with the bangs' slider: both frame the face at head height
      const s = this.physicsScale * ((key === 'back' ? this.tuning.hairBack : this.tuning.hairFront) ?? this.tuning.hair)
      const wind = key === 'side' ? Math.sin(this.time * 1.5 + 0.7) * 1.2 * s * R.wind
        : Math.sin(this.time * (key === 'front' ? 1.9 : 1.15)) * (key === 'front' ? 0.6 : 1.8) * s * R.wind
      const gravity = -P.angleZ * 0.2 * s
      let ax = -k1 * (a.x - wind - gravity) - c1 * a.vx - vx * g * k1 * 0.06 * s
      let ay = -k1 * a.y - c1 * a.vy - vy * g * k1 * 0.04 * s
      if (D) {
        const m = (key === 'front' ? D[0] : key === 'back' ? D[1] : D[2] ?? D[0]) * s
        ax -= dv.ax * m; ay -= dv.ay * m
      }
      a.vx += ax * dt; a.vy += ay * dt; a.x += a.vx * dt; a.y += a.vy * dt
      const bx = -k2 * (b.x - a.x * 1.6) - c2 * b.vx
      const by = -k2 * (b.y - a.y * 1.4) - c2 * b.vy
      b.vx += bx * dt; b.vy += by * dt; b.x += b.vx * dt; b.y += b.vy * dt
      for (const q of [a, b]) {
        q.x = Math.max(-lim, Math.min(lim, q.x)); q.y = Math.max(-lim * 0.6, Math.min(lim * 0.6, q.y))
      }
    }
  }

  /** one frame: time, physics, the mesh. `mesh` false keeps the physics going without moving the mesh (a puppet not
   *  drawn this frame: the multi-view player's drawn views, only one or two of which show at a time) */
  update(dt: number, mesh = true) {
    if (!this.model) return
    this.time += dt
    const P = this.params
    this.smileShown += (P.smile - this.smileShown) * Math.min(1, dt * 7)
    this.stepMouth(dt)
    // inputs never leave their range (webcam yaw can overshoot); the rig maps the range to a modest turn
    for (const k of ['angleX', 'angleY', 'angleZ'] as const) P[k] = Math.max(PARAM_RANGES[k][0], Math.min(PARAM_RANGES[k][1], P[k]))
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))) // sub-step physics for stability
    this.fbParts = false
    for (let i = 0; i < steps; i++) {
      this.stepBody(dt / steps); this.stepPhysics(dt / steps); this.stepChains(dt / steps)
      if (this.fb) this.stepFb(dt / steps)
    }
    if (mesh) this.deform()
  }

  /** every layer's vertices at the current params, springs and torso: into each layer's out */
  private deform() {
    const P = this.params, A = this.model.anchors
    this.fbParts = false
    const neckBody: [number, number] = [0, 0]
    this.bodyOffset(A.head.cx, A.neck_y, P, neckBody)
    const hp: [number, number] = [0, 0], bp: [number, number] = [0, 0]
    const [liftUp, liftDown] = browLimits(A, A.head.ry * this.rig.brow)
    const lift = (v: number) => (v > 0 ? Math.min(1, v) * liftUp : Math.max(-1, v) * liftDown)
    const browLift = [lift(P.browLY), lift(P.browRY)]
    // the jaw follows the frame shown (each frame was drawn with its own jaw drop), opening a little further with mouthOpen
    const mo = Math.min(1, Math.max(0, P.mouthOpen))
    let jawDrop = 0
    this.mouthW.forEach((w, i) => {
      if (w > 0 && this.frameJaw[i] > 0) jawDrop += w * this.frameJaw[i] * (this.frameKind[i] === 'half' ? 0.6 + 0.4 * this.frameEase(i, mo) : 0.75 + 0.25 * this.frameEase(i, mo))
    })
    // where the head, the body and the hair springs take the point (x, y) of a layer with these weights: into pt
    const pt: [number, number] = [0, 0]
    const sideOn = !!this.rig.hair.side
    const place = (x: number, y: number, wh: number, dep: number, w1: number, w2: number, f: number) => {
      // a point that moves with the head alone takes nothing of the torso: no need to work it out
      if (wh < 1) this.bodyOffset(x, y, P, bp); else { bp[0] = 0; bp[1] = 0 }
      let X = x + bp[0], Y = y + bp[1]
      if (wh > 0) {
        this.headXform(x, y, dep, P, hp)
        X = X * (1 - wh) + (hp[0] + neckBody[0]) * wh
        Y = Y * (1 - wh) + (hp[1] + neckBody[1]) * wh
      }
      if ((w1 > 0 || w2 > 0) && sideOn) {
        // the side chain takes the head-height share (f) by how far out the point lies, one function of position
        const b = this.chains.back, chain = this.chains.front, sc = this.chains.side
        const sd = smooth(SIDE_AT[0], SIDE_AT[1], Math.abs(x - A.head.cx) / A.head.rx), ff = f * (1 - sd), fs = f * sd
        const c0x = chain[0].x * ff + sc[0].x * fs + b[0].x * (1 - f), c0y = chain[0].y * ff + sc[0].y * fs + b[0].y * (1 - f)
        const c1x = chain[1].x * ff + sc[1].x * fs + b[1].x * (1 - f), c1y = chain[1].y * ff + sc[1].y * fs + b[1].y * (1 - f)
        X += c0x * w1 + c1x * w2; Y += c0y * w1 + c1y * w2
      } else if (w1 > 0 || w2 > 0) {
        const b = this.chains.back
        const chain = this.chains.front
        // blend the bangs chain into the long-hair chain at the seam
        const c0x = chain[0].x * f + b[0].x * (1 - f), c0y = chain[0].y * f + b[0].y * (1 - f)
        const c1x = chain[1].x * f + b[1].x * (1 - f), c1y = chain[1].y * f + b[1].y * (1 - f)
        X += c0x * w1 + c1x * w2; Y += c0y * w1 + c1y * w2
      }
      pt[0] = X; pt[1] = Y
    }
    // keyform weights: 0 at rest, 1 at the key pose, on along the same side up to the end of the range (at most 2x)
    const so: [number, number] = [0, 0]
    const kw = this.kfOff ? [] : this.keyWeights ?? this.keys.map((k) => k.param === 'diag' ? 0 : Math.min(2, Math.max(0, (P[k.param] * k.scale) / k.value)))
    if (this.kfPair && !this.kfOff && !this.keyWeights) {
      // Hermite between 0 and the key (u = 1), its slope at 0 the mean of both sides' (the same speed through the
      // front, and exactly linear where the two keys mirror each other), linear past the key
      const u = kw.slice()
      for (let k = 0; k < u.length; k++) {
        const j = this.kfPair[k]
        if (j < 0 || u[k] <= 0 || u[k] >= 1) continue
        const t = u[k], h10 = t * t * t - 2 * t * t + t
        kw[k] = 3 * t * t - 2 * t * t * t + 0.5 * h10 + t * t * t - t * t
        kw[j] -= 0.5 * h10
      }
    }
    const roll = (P.angleZ * Math.PI) / 180 * this.rig.roll * this.tuning.turn
    const g = this.tuning.gaze, gz = typeof g === 'number' && g >= 0 && g < 1 ? g : 1  // the feel settings' eye movement; anything else is the full travel
    // rig.neck: how far the chin goes sideways from where the torso alone puts it (model px)
    let chinDx = 0
    if (this.rig.neck) {
      const cy = A.jaw?.chin ?? A.neck_y
      this.headXform(A.head.cx, cy, 0, P, hp); this.bodyOffset(A.head.cx, cy, P, bp)
      chinDx = hp[0] + neckBody[0] - (A.head.cx + bp[0])
    }
    // tuning.fringe: the bangs' depth, and the brows over them that move as the bangs do (alt), scaled where read
    const fringeB = fringeScale(this.bangsDepth, this.tuning.fringe)
    for (const L of this.layers) {
      this.fbParts = !!this.fb && L.def.group === 'body'
      // a layer not drawn this frame (an expression that is off, closed lashes on an open eye) is not moved either;
      // measuring keyforms needs every layer where the rig puts it
      if (!this.kfOff && !this.shown(L)) continue
      const d = L.def, r = L.rest, o = L.out
      const fringeL = d.group === 'hair_front' ? fringeScale(d.depth, this.tuning.fringe) : 1
      L.uploaded = false
      const n = r.length / 2
      const role = d.role || ''
      const eyeSide = role.endsWith('_L') ? 'L' : role.endsWith('_R') ? 'R' : ''
      const isEye = role.startsWith('eye_') || role.startsWith('iris_') || role.startsWith('shine_')
      const open = eyeSide === 'L' ? P.eyeLOpen : eyeSide === 'R' ? P.eyeROpen : 1
      const squash = 0.12 + 0.88 * open
      const iris = role.startsWith('iris_')
      let ix = 0, iy = 0
      if (iris && d.range) { ix = P.eyeBallX * d.range[0] * gz; iy = -P.eyeBallY * d.range[1] * gz }
      // (a model with swinging chains: its highlights follow the gaze too)
      if (this.chained && role.startsWith('shine_') && d.range) { ix = P.eyeBallX * d.range[0] * gz; iy = -P.eyeBallY * d.range[1] * gz }
      // irisNasal: past its room toward the nose the inner edge stays put and the far edge travels on (at a
      // vertex the shift is nx + nk * its rest x); the eye's highlights go with it
      let nx = ix, nk = 0
      const nz = this.irisNasal && ix !== 0 ? this.nasal[eyeSide] : undefined
      if (nz && ix * nz.sign > nz.room) {
        const far = Math.min(ix * nz.sign, nz.room + (1 - this.irisNasalNarrow) * nz.w)
        nk = -(far - nz.room) / nz.w; nx = nz.sign * nz.room - nk * nz.inner
      }
      // irisLid: an iris with gaze travel drops a little (irisDrop of the way the squash moves its centre) and
      // squashes only below the line its patch squashes toward; above it the closing lid, the squashed whites, covers it
      const lidIris = iris && this.irisLid && !!d.pivot && !!d.range && (d.range[0] > 0 || d.range[1] > 0)
      if (lidIris) iy += this.irisDrop * (1 - squash) * ((L.pivC ?? d.pivot![1]) - (d.y + d.h / 2))
      // how far it sits off its eye patch: a glance, and the lid's travel over it
      if (iris) L.soft = Math.min(1, Math.hypot(ix, iy) + (lidIris ? (1 - squash) * d.h / 2 : 0))
      // highlights breathe a little and now and then sparkle (a quick swell), each eye on its own phase (chained models)
      const tw = this.chained && role.startsWith('shine_') ? twinkle(this.time + (eyeSide === 'R' ? 1.3 : 0)) : 1
      const tcx = d.x + d.w / 2, tcy = d.y + d.h / 2
      // a layer hanging from one point: where the head puts that point, turned with the head's roll
      let rgx = 0, rgy = 0
      if (d.rigid) { this.headXform(d.rigid[0], d.rigid[1], d.depth, P, hp); rgx = hp[0] + neckBody[0]; rgy = hp[1] + neckBody[1] }
      const rc = Math.cos(roll), rs = Math.sin(roll)
      for (let i = 0; i < n; i++) {
        let x = r[2 * i], y = r[2 * i + 1]
        if (tw !== 1) { x = tcx + (x - tcx) * tw; y = tcy + (y - tcy) * tw }
        if (isEye && d.pivot) {
          const py = L.pivY ? L.pivY[i] : d.pivot[1]
          x += nx + nk * r[2 * i]; y += iy
          if (!lidIris || y > py) y = py + (y - py) * squash
        }
        if (L.browSide[i] >= 0) {  // at most the cap where the brow lies under opaque bangs
          const v = browLift[L.browSide[i]]
          y -= Math.sign(v) * Math.min(Math.abs(v), L.browCap[i]) * L.wBrow[i]
        }
        if (jawDrop > 0 && L.wJaw[i] > 0) y += jawDrop * L.wJaw[i]
        if (d.rigid) {
          const vx = x - d.rigid[0], vy = y - d.rigid[1]
          pt[0] = rgx + vx * rc - vy * rs; pt[1] = rgy + vx * rs + vy * rc
        } else place(x, y, L.wHead[i], fringeL === 1 ? L.dep[i] : L.dep[i] * fringeL, L.wPhys1[i], L.wPhys2[i], L.wFront[i])
        if (L.skin) { this.skinOffset(L.skin, i, so); pt[0] += so[0]; pt[1] += so[1] }
        let X = pt[0], Y = pt[1]
        if (L.wTwist && L.wTwist[i] > 0) X += chinDx * L.wTwist[i]
        if (L.wNeck && L.wNeck[i] > 0) {  // neckFollow: the head's roll about the neck, as headXform turns it
          const a = roll * L.wNeck[i], c = Math.cos(a), s = Math.sin(a)
          const nx = A.head.cx + neckBody[0], ny = A.neck_y + neckBody[1], dx = X - nx, dy = Y - ny
          X = nx + dx * c - dy * s; Y = ny + dx * s + dy * c
        }
        const c = L.fol ? L.fol[i] : 0, cB = L.folB ? L.folB[i] : 0
        if (c > 0 || cB > 0) {  // over the bangs: as the front hair moves at this point, lifted brow and all
          const k = 5 * i, al = L.alt!
          const X0 = X, Y0 = Y
          place(x, y, al[k + 1], fringeB === 1 ? al[k] : al[k] * fringeB, al[k + 2], al[k + 3], al[k + 4])
          if (L.altSkin) { this.skinOffset(L.altSkin, i, so); pt[0] += so[0]; pt[1] += so[1] }
          X += (pt[0] - X0) * c; Y += (pt[1] - Y0) * c
          if (L.outB) { L.outB[2 * i] = X0 + (pt[0] - X0) * cB; L.outB[2 * i + 1] = Y0 + (pt[1] - Y0) * cB }
        } else if (L.outB) { L.outB[2 * i] = X; L.outB[2 * i + 1] = Y }
        if (L.kf) {  // the measured pose's offsets, turned with the head's roll
          let dx = 0, dy = 0
          for (let k = 0; k < kw.length; k++) {
            const f = L.kf[k]
            if (f && kw[k] !== 0) { dx += kw[k] * f[2 * i]; dy += kw[k] * f[2 * i + 1] }
          }
          if (dx !== 0 || dy !== 0) {
            const a = roll * L.wHead[i], c = Math.cos(a), s = Math.sin(a)
            const ox = dx * c - dy * s, oy = dx * s + dy * c
            X += ox; Y += oy
            if (L.outB) { L.outB[2 * i] += ox; L.outB[2 * i + 1] += oy }
          }
        }
        o[2 * i] = X; o[2 * i + 1] = Y
      }
    }
  }

  // ---------------------------------------------------------------- draw
  private drawLayer(L: GLLayer, tex: WebGLTexture, alpha: number, verts?: Float32Array, cut = 0) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, L.pos)
    if (verts) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts); L.uploaded = false }
    else if (!L.uploaded) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, L.out); L.uploaded = true }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1f(this.uAlpha, alpha)
    gl.uniform1f(this.uCut, cut)
    gl.bindVertexArray(L.vao)
    gl.drawElements(gl.TRIANGLES, L.count, gl.UNSIGNED_INT, 0)
  }

  /** softIris: the whites of each eye whose iris sits off it (a glance, a blink), as they show this frame, into a
   *  channel each (maskCh) of a texture over their box in drawing-buffer pixels; the iris is then drawn times them
   *  (uMode 2) instead of through the stencil, whose 1-bit cut at alpha 0.5 is a staircase wherever the iris crosses
   *  it. First thing in the frame: switching framebuffers half way through costs a tiled GPU a store and a
   *  reload of the canvas */
  private drawMasks(w: number, h: number, sx: number, sy: number, ox: number, oy: number) {
    const gl = this.gl
    const eyes: GLLayer[] = []
    for (const L of this.layers) L.maskCh = -1
    for (const L of this.softIris ? this.layers : []) {
      const parent = L.def.clip ? this.byId.get(L.def.clip) : undefined
      if (!(L.def.role || '').startsWith('iris_') || !parent?.mask || !(L.soft > 0) || parent.maskCh >= 0 || eyes.length >= 4) continue
      if (this.hidden.has(L.def.id) || this.hidden.has(parent.def.id)) continue
      parent.maskCh = eyes.length
      eyes.push(parent)
    }
    if (!eyes.length) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const E of eyes) {
      for (let i = 0; i < E.out.length; i += 2) {  // as the vertex shader places them, y up
        const X = (E.out[i] * sx + ox + 1) * w / 2, Y = (1 - (E.out[i + 1] * sy + oy)) * h / 2
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y)
      }
    }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2)
    x1 = Math.min(w, Math.ceil(x1) + 2); y1 = Math.min(h, Math.ceil(y1) + 2)
    if (x1 <= x0 || y1 <= y0) { for (const E of eyes) E.maskCh = -1; return }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null)  // not read while it is drawn into
    gl.activeTexture(gl.TEXTURE0)
    if (!this.maskFb || x1 - x0 > this.maskSize[0] || y1 - y0 > this.maskSize[1]) {
      const W = Math.max(this.maskSize[0], Math.ceil((x1 - x0) / 64) * 64), H = Math.max(this.maskSize[1], Math.ceil((y1 - y0) / 64) * 64)
      this.maskTex ||= gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      this.maskFb ||= gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTex, 0)
      this.maskSize = [W, H]
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb)
    gl.viewport(-x0, -y0, w, h)  // the canvas's pixel grid, shifted: texel (i, j) is pixel (x0 + i, y0 + j)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.BLEND)
    gl.uniform1i(this.uMode, 1)
    eyes.forEach((E, k) => {
      gl.colorMask(k === 0, k === 1, k === 2, k === 3)
      this.drawLayer(E, E.mask!, 1)
    })
    gl.colorMask(true, true, true, true)
    gl.uniform1i(this.uMode, 0)
    gl.enable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform2i(this.uMaskOff, x0, y0)
  }

  render() {
    const gl = this.gl, cv = this.canvas
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1)
    const [w, h] = this.size ?? [Math.round(cv.clientWidth * dpr), Math.round(cv.clientHeight * dpr)]
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
    gl.viewport(0, 0, w, h)
    const clear = () => {
      gl.clearColor(...this.background)
      gl.clearStencil(0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    }
    if (!this.model) { clear(); return }
    gl.useProgram(this.prog)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.uTex, 0)
    gl.uniform1i(this.uMode, 0)
    const [MW, MH] = this.model.canvas
    const V = this.view, M = this.move, A = this.model.anchors, hd = A.head
    // what the camera fits (model px): the canvas, or on a full-body model its head-chest frame (a close-up's size too),
    // the whole figure or down to the knees (fit). cx2 / cy2: twice its centre
    const F = A.frame ? fitBox(this.focusHead ? 'frame' : this.fit, A, this.model.canvas, this.fb) : null
    const BW = F ? F[2] - F[0] : MW, BH = F ? F[3] - F[1] : MH, cx2 = F ? F[0] + F[2] : MW, cy2 = F ? F[1] + F[3] : MH
    // vertical offset for scale k (the y of uView; larger moves the picture down) and the clip-space y of the drawing's
    // bottom edge under it
    const offY = (k: number, y: number) => (this.focusHead ? -(hd.cy + hd.ry * 0.15) * (2 * k) / h : -cy2 * k / h) + this.panY - 2 * y
    const bottom = (k: number, oy: number) => -(MH * (2 * k) / h + oy)
    const base = Math.min(w / BW, h / BH) * this.zoom
    const s = base * V.s * M.s
    const sx = (2 * s) / w, sy = (2 * s) / h
    let oy = offY(s, V.y + M.y)
    if (this.cutBottom) {  // automatic movement shows no more of the cut edge than the user's placement does
      const allowed = Math.max(bottom(base * V.s, offY(base * V.s, V.y)), -1)
      oy += Math.max(0, bottom(s, oy) - allowed)
    }
    // the whole figure scales with the webcam's distance about the ground line, where it stands (other shots about
    // their centre, as a half-body picture)
    if (this.fb && !F && !this.focusHead && M.s !== 1) oy += (MH - 2 * this.fb.groundY) * (s - base * V.s) / h
    // a full-body model takes the sideways move as a sway from the ankles (fbPose): sliding it would slide the feet
    const ox = (this.focusHead ? -hd.cx * sx : -cx2 * s / w) + 2 * (V.x + (this.fb ? 0 : M.x))
    gl.uniform4f(this.uView, sx, sy, ox, oy)
    this.drawMasks(w, h, sx, sy, ox, oy)
    clear()
    this.lastView = [sx, sy, ox, oy, w, h]
    this.anchorModel = this.model
    const P = this.params
    const drawMouth = (L: GLLayer) => {
      // one frame, opaque (stepMouth switches them); within a frame the opening keeps moving a little:
      // every open frame stretches down from the mouth's top edge as mouthOpen grows
      const m = Math.min(1, Math.max(0, P.mouthOpen)), f = this.mouthFrame
      const py = L.def.pivot ? L.def.pivot[1] : L.def.y
      const k = this.frameKind[f] === 'half' ? 0.88 + 0.12 * this.frameEase(f, m) : 0.9 + 0.1 * this.frameEase(f, m)
      let verts: Float32Array | undefined
      if (f > 0 && f !== this.vis.shut) {  // the closed mouth is drawn as it is, like frame 0
        verts = L.out.slice()
        // the squeeze is the drawn mouth's: toward the chin it fades as the jaw takes over (chinFollow), so a frame's
        // copy of the chin stays on the face's chin
        const fade = this.chinFollow ? L.wJaw : undefined
        for (let i = 1; i < verts.length; i += 2) verts[i] += (L.rest[i] - py) * (k - 1) * (fade ? 1 - fade[i >> 1] : 1)
      }
      this.drawLayer(L, L.frames[f], 1, verts)
    }
    // while talking the mouth frames are drawn above the expression layers: every expression patch holds its own still
    // mouth (a smile, a pout), and chat keeps the reply's expression on while the voice plays, so the character talked
    // with a frozen mouth; with only the open frames on top, the smile's wide grin came back between syllables, the
    // biggest mouth where the voice is quietest. Once the voice stops, the expression's own mouth shows
    const lastExpr = this.talkLeft > 0 ? this.layers.findLastIndex((l) => l.def.role === 'expr') : -1
    const exprShown = (d: LayerDef) => this.exprAlpha(d)
    let deferred: GLLayer | null = null
    // the brows an expression drew, once, right after the last brows layer: above the bangs, over the neutral
    // brows fading out and the expression's own brow zone (expr_brows) fading in
    const lastBrow = this.layers.findLastIndex((l) => l.def.id === 'brows' || l.def.role === 'expr_brows')
    let newBrows = lastBrow < 0
    const drawNewBrows = () => {
      newBrows = true
      if (this.headHidden) return
      for (const E of this.layers) {
        if (E.browTex && E.def.role === 'expr' && !this.hidden.has(E.def.id) && !(this.only && !this.only(E.def))) {
          const a = exprShown(E.def)
          if (a > 0.01) this.drawLayer(E, E.browTex, a, E.outB)
        }
      }
    }
    let ref = 0
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li]
      const d = L.def, role = d.role || ''
      if (deferred && li > lastExpr) { drawMouth(deferred); deferred = null }
      if (!newBrows && li > lastBrow) drawNewBrows()
      if (this.hidden.has(d.id) || (d.group === 'body' ? this.bodyHidden : this.headHidden) || (this.only && !this.only(d))) continue
      // a mask the player asks for (role hole: where the face hides the back hair; edge / edge_wide: where a drawn view's
      // face layer was cut straight under its hair), moved like any layer, never drawn otherwise
      if ((role === 'hole' || role === 'edge' || role === 'edge_wide') && !this.masks) continue
      if (role === 'mouth' && L.frames.length >= 3) {
        if (li < lastExpr) deferred = L
        else drawMouth(L)
        continue
      }
      if (role === 'expr') {
        const a = exprShown(d)
        // while talking, the patch without its own mouth: the face's neutral skin under the talking mouth, never the
        // expression's grin round it. Builds before it keep the whole patch, with the mouth drawn over it
        if (a > 0.01) this.drawLayer(L, this.talkLeft > 0 && L.talk ? L.talk : L.tex, a)
        continue
      }
      if (role === 'expr_brows') {
        // that expression's own brow zone, over the bangs like the neutral brows it replaces: the brows layer also
        // carries the strand outlines crossing a brow, and with it faded out each crossing showed as a soft blob
        const a = exprShown(d)
        if (a > 0.01) this.drawLayer(L, L.tex, a)
        continue
      }
      if (d.id === 'brows') {
        // an expression patch that redrew the brows (the build marks it) shows its own: a frown and the neutral brows
        // were both drawn, two pairs of brows on angry / shy. The neutral layer fades out with that expression
        let fade = 0
        for (const E of this.layers) {
          if (E.def.role === 'expr' && E.def.brows === 'redrawn' && !this.hidden.has(E.def.id)) fade = Math.max(fade, exprShown(E.def))
        }
        if (fade < 0.99) this.drawLayer(L, L.tex, 1 - fade)
        continue
      }
      if (role.startsWith('lid_')) {
        // closed lashes only appear in the last part of the blink
        const open = role === 'lid_L' ? P.eyeLOpen : P.eyeROpen
        const a = 1 - smooth(0.05, 0.35, open)
        if (a > 0.01) this.drawLayer(L, L.tex, a)
        continue
      }
      if (role.startsWith('eye_')) {
        const open = role === 'eye_L' ? P.eyeLOpen : P.eyeROpen
        this.drawLayer(L, L.tex, smooth(0.02, 0.2, open)) // squash, don't fade: fading ghosts the lashes
        L.stencilRef = 0
        if (L.mask && L.maskCh < 0) {  // its iris at rest (or softIris off): the stencil, as built
          // write the (squashed) sclera into the stencil so the iris stays inside the whites
          ref = (ref % 250) + 1
          L.stencilRef = ref
          gl.enable(gl.STENCIL_TEST)
          gl.stencilFunc(gl.ALWAYS, ref, 0xff)
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
          gl.colorMask(false, false, false, false)
          this.drawLayer(L, L.mask, 1, undefined, 0.5)
          gl.colorMask(true, true, true, true)
          gl.disable(gl.STENCIL_TEST)
        }
        continue
      }
      if (role === 'blush') {
        let a = 0
        for (const [k, v] of Object.entries(d.blush || {})) a += v * this.exprValue(k)
        if (a > 0.01) this.drawLayer(L, L.tex, Math.min(1, a))
        continue
      }
      if (role.startsWith('iris_') || role.startsWith('shine_')) {
        const parent = d.clip ? this.byId.get(d.clip) : undefined
        const open = role.endsWith('_L') ? P.eyeLOpen : P.eyeROpen
        if (parent && parent.maskCh >= 0) {  // off its patch: times the whites drawn for it this frame (drawMasks)
          const c = parent.maskCh
          gl.uniform1i(this.uMode, 2)
          gl.uniform4f(this.uMaskSel, +(c === 0), +(c === 1), +(c === 2), +(c === 3))
          gl.uniform1f(this.uSoft, L.soft)
          this.drawLayer(L, L.tex, smooth(0.02, 0.2, open))
          gl.uniform1i(this.uMode, 0)
        } else if (parent && parent.stencilRef) {
          gl.enable(gl.STENCIL_TEST)
          gl.stencilFunc(gl.EQUAL, parent.stencilRef, 0xff)
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
          this.drawLayer(L, L.tex, smooth(0.02, 0.2, open))
          gl.disable(gl.STENCIL_TEST)
        }
        continue
      }
      const ma = d.show || d.hide ? this.moodAlpha(d) : 1
      if (ma > 0.01) this.drawLayer(L, L.tex, ma)
    }
    if (deferred) drawMouth(deferred)
    if (!newBrows) drawNewBrows()
    gl.bindVertexArray(null)
  }

  /** An attachment follows the same deformations and projection as the last rendered frame. */
  anchor(name: AnchorName): AttachmentAnchor | null {
    if (!this.model || this.anchorModel !== this.model) return null
    const A = this.model.anchors, P = this.params, h = A.head
    const x = name === 'head' ? h.cx : A.chest?.cx ?? h.cx
    const y = name === 'head' ? h.cy : A.chest?.cy ?? (A.neck_y + (this.fb ? this.fb.hy : A.bottom_y)) / 2
    const radius = name === 'head' ? h.rx : h.rx * 1.5
    const neck: [number, number] = [0, 0]
    if (name === 'head') this.bodyOffset(h.cx, A.neck_y, P, neck)
    const point = (x: number): [number, number] => {
      const out: [number, number] = [0, 0]
      if (name === 'head') { this.headXform(x, y, 0, P, out); out[0] += neck[0]; out[1] += neck[1] }
      else { this.bodyOffset(x, y, P, out); out[0] += x; out[1] += y }
      const [sx, sy, ox, oy] = this.lastView
      return [(out[0] * sx + ox + 1) / 2, (out[1] * sy + oy + 1) / 2]
    }
    const [, , , , w, height] = this.lastView
    return projectedAnchor(point(x), point(x + radius), height / w)
  }

  /** a point on the canvas (CSS px from its top-left) in model px, as the last frame drew it */
  canvasToModel(px: number, py: number): [number, number] {
    const [sx, sy, ox, oy, w, h] = this.lastView, cv = this.canvas
    const cx = (2 * px * (w / Math.max(1, cv.clientWidth))) / w - 1, cy = (2 * py * (h / Math.max(1, cv.clientHeight))) / h - 1
    return [(cx - ox) / sx, (cy - oy) / sy]
  }

  /** a flick at model point (x, y): every chain passing near it is thrown, the nearest joint hardest (a tap on a twin
   *  tail, the ahoge, a cord). Returns how many chains it moved */
  poke(x: number, y: number, strength = 1) {
    let hit = 0
    for (const C of this.chainRuns) {
      const R = C.R, m = R.length / 2, reach = 1.5 * (C.def.sigma ?? 40) + 20
      let near = Infinity
      for (let j = 0; j < m; j++) near = Math.min(near, Math.hypot(R[2 * j] - x, R[2 * j + 1] - y))
      if (near > reach) continue
      hit++
      const side = x < R[0] ? 1 : -1  // pushed away from the tap
      for (let j = 1; j < m; j++) {
        const k = (1 - near / reach) * C.s[j] * 9 * strength
        C.q[2 * j] -= side * k; C.q[2 * j + 1] += k * 0.3  // verlet: moving the previous position is a velocity kick
      }
    }
    return hit
  }

  /** springs back to rest (eval / screenshots must not inherit wind sway) */
  resetPhysics() {
    for (const C of this.chainRuns) { C.p.set(C.R); C.q.set(C.R); C.disp.fill(0); C.beta.fill(0); C.started = false; C.moving = false }
    for (const c of Object.values(this.chains)) for (const q of c) Object.assign(q, spring())
    this.lastHead = { x: 0, y: 0, roll: 0 }
    this.drive.started = false
    this.body = { yaw: 0, roll: 0 }
    this.bust = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 }
    this.fbm = { hs: 0, hv: 0, tilt: 0, tanTilt: 0, hem: 0, hemV: 0, breath: 0 }
    this.crouch = 0; this.dip = 0; this.pv.roll = NaN
  }

  snapshot(): string { return this.canvas.toDataURL('image/png') }


}

/** a keyforms.json the runtime can read safely (an untrusted file: a field of the wrong size would be read past its
 *  end): version 1, its grid in range, at most 32 keys, every field and mask exactly the grid's size in base64 */
function keyformsFit(K: KeyformFile): boolean {
  const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0
  if (K?.version !== 1 || !int(K.cols, 2, 4096) || !int(K.rows, 2, 4096) || K.cols * K.rows > 2 ** 22) return false
  if (![K.cell, K.units, K.turn, K.nod].every(pos) || !Array.isArray(K.keys) || K.keys.length > 32) return false
  const b64 = (bytes: number) => Math.ceil(bytes / 3) * 4, field = b64(K.cols * K.rows * 4), mask = b64(K.cols * K.rows)
  for (const k of K.keys) {
    if (!k || !['angleX', 'angleY', 'diag'].includes(k.param) || !Number.isFinite(k.value) || (k.param !== 'diag' && !k.value)) return false
    if (!k.fields || typeof k.fields !== 'object' || Object.values(k.fields).some((v) => typeof v !== 'string' || v.length !== field)) return false
    if (k.same !== undefined && !(Array.isArray(k.same) && k.same.every((g) => typeof g === 'string'))) return false
  }
  return Object.values(K.mask || {}).every((v) => typeof v === 'string' && v.length === mask)
}

/** a chain from its definition, at rest */
function chainRun(def: ChainDef): ChainRun {
  const m = def.points.length, R = new Float32Array(def.points.flat())
  const len = new Float32Array(m), s = new Float32Array(m)
  for (let j = 1; j < m; j++) { len[j] = Math.hypot(R[2 * j] - R[2 * j - 2], R[2 * j + 1] - R[2 * j - 1]); s[j] = s[j - 1] + len[j] }
  const total = s[m - 1] || 1
  for (let j = 1; j < m; j++) s[j] /= total
  let h = 0
  for (const ch of def.id) h = (h * 31 + ch.charCodeAt(0)) % 997
  return { def, R, p: R.slice(), q: R.slice(), len, s, disp: new Float32Array(2 * m), beta: new Float32Array(m),
    W: [0, 0], V: [0, 0], acc: [0, 0], rho: 0, started: false, phase: (h / 997) * 2 * Math.PI, moving: false }
}

/** an eye highlight's scale at time t: a slow 3 % breath and, about every 5 s, a 0.35 s sparkle up to 12 % */
function twinkle(t: number) {
  const k = Math.floor(t / 5.3), u = t - k * 5.3 - ((k * 7919) % 13) / 13 * 3.5
  const spark = u > 0 && u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0
  return 1 + 0.03 * Math.sin(t * 2.1) + 0.12 * spark
}

/** where load() finds a model: its model.json, the folder its images are read from, and the query every file carries
 *  (a token, where there is no login) */
function locate(baseUrl: string) {
  const [path, query = ''] = baseUrl.split('?')
  const file = path.endsWith('.json') ? path : (path.endsWith('/') ? path : path + '/') + 'model.json'
  return { file, base: file.slice(0, file.lastIndexOf('/') + 1), query }
}

/** textures.bin of the model at baseUrl at its images' version (tex), as load() asks for it: a page that knows the
 *  version beforehand can start fetching it before the player loads */
export function packUrl(baseUrl: string, tag: string) {
  const { base, query } = locate(baseUrl)
  return base + 'textures.bin' + `?v=${tag}${query ? `&${query}` : ''}`
}

/** textures.bin: the header's length (4 bytes, little-endian), the header (JSON {path: [offset,
 *  length]}, and tex: the images' version), the files. null when it is not there or unreadable: the files are then
 *  fetched one by one */
async function loadPack(url: string, signal?: AbortSignal): Promise<Map<string, Blob> | null> {
  try {
    const r = await fetch(url, { signal })
    if (!r.ok) return null
    const buf = await r.arrayBuffer()
    const n = new DataView(buf).getUint32(0, true)
    const head: Record<string, [number, number] | string> = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)))
    return new Map(Object.entries(head).filter((e): e is [string, [number, number]] => Array.isArray(e[1])).map(([k, [o, len]]) =>
      [k, new Blob([new Uint8Array(buf, 4 + n + o, len)], { type: k.endsWith('.png') ? 'image/png' : 'image/webp' })]))
  } catch (e) {
    if (signal?.aborted) throw e
    return null
  }
}

/** an image from the pack (or a file the user picked), decoded like any other (the same Image path, so the textures come
 *  out the same) */
export function loadBlob(b: Blob): Promise<HTMLImageElement> {
  const u = URL.createObjectURL(b)
  return loadImage(u).finally(() => URL.revokeObjectURL(u))
}

/** an image that can be called off: fetched, then decoded like any other */
async function fetchImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  let b: Blob
  try {
    const r = await fetch(src, { signal })
    if (!r.ok) throw new Error()
    b = await r.blob()
  } catch (e) {
    if (signal.aborted) throw e
    throw new Error('image ' + src)
  }
  return loadBlob(b)
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous'
    i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + src)); i.src = src
  })
}

/** per vertex of a layer (`img` at box L), how much of what it draws within one lattice cell of the vertex lies over
 *  `under` (another layer's image at its box U): under's alpha, weighted by the layer's own; under's plain mean near a
 *  vertex where the layer draws nothing */
/** a keyform field at (x, y), model px: bilinear between the grid points */
function sampleField(f: Int16Array, K: KeyformFile, x: number, y: number): [number, number] {
  const gx = Math.min(K.cols - 1.001, Math.max(0, x / K.cell)), gy = Math.min(K.rows - 1.001, Math.max(0, y / K.cell))
  const c = Math.floor(gx), r = Math.floor(gy), tx = gx - c, ty = gy - r
  const at = (cc: number, rr: number, k: number) => f[2 * (rr * K.cols + cc) + k]
  const v = (k: number) => (at(c, r, k) * (1 - tx) + at(c + 1, r, k) * tx) * (1 - ty) + (at(c, r + 1, k) * (1 - tx) + at(c + 1, r + 1, k) * tx) * ty
  return [v(0) * K.units, v(1) * K.units]
}

/** a keyform mask (0-1) at (x, y), model px: bilinear between the grid points */
function sampleMask(m: Uint8Array, K: KeyformFile, x: number, y: number): number {
  const gx = Math.min(K.cols - 1.001, Math.max(0, x / K.cell)), gy = Math.min(K.rows - 1.001, Math.max(0, y / K.cell))
  const c = Math.floor(gx), r = Math.floor(gy), tx = gx - c, ty = gy - r
  const at = (cc: number, rr: number) => m[rr * K.cols + cc]
  return ((at(c, r) * (1 - tx) + at(c + 1, r) * tx) * (1 - ty) + (at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx) * ty) / 255
}

function coverAt(img: HTMLImageElement, L: LayerDef, under: HTMLImageElement, U: LayerDef, pts: Float32Array, cell: number) {
  const c = document.createElement('canvas'); c.width = L.w; c.height = L.h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, L.w, L.h)
  const a = g.getImageData(0, 0, L.w, L.h).data
  g.clearRect(0, 0, L.w, L.h)
  g.drawImage(under, U.x - L.x, U.y - L.y, U.w, U.h)
  const b = g.getImageData(0, 0, L.w, L.h).data
  const out = new Float32Array(pts.length / 2)
  for (let i = 0; i < out.length; i++) {
    const cx = pts[2 * i] - L.x, cy = pts[2 * i + 1] - L.y
    let sa = 0, sab = 0, sb = 0, k = 0
    for (let y = Math.max(0, Math.round(cy - cell)); y < Math.min(L.h, Math.round(cy + cell)); y++) {
      for (let x = Math.max(0, Math.round(cx - cell)); x < Math.min(L.w, Math.round(cx + cell)); x++) {
        const j = 4 * (y * L.w + x) + 3, wa = a[j] / 255, wb = b[j] / 255
        sa += wa; sab += wa * wb; sb += wb; k++
      }
    }
    out[i] = sa > 1 ? sab / sa : k ? sb / k : 0
  }
  return out
}

/** lidCurve's models: front-view anime and painterly characters, whose closed eye is a drawn row of lashes. Not chibi or
 *  mascot (the closed eye is an arc or a bead: the fitted line came out tilted and the eye closed into a lemon or a half
 *  moon), not glasses (the frame may sit in the lid layer), not turned builds: those were not checked */
export function lidCurveFits(m: ModelDef): boolean {
  const p = m.profile, i = p?.class?.input
  return !!p && (p.id === 'anime_half' || p.id === 'painterly') && i?.facing === 'front' && i.glasses !== true
    && !m.layers.some((L) => L.id === 'glasses')
}

/** the closed lash a lid layer draws, as model y by model x (lidCurve): in each column the darkest opaque pixel, if it is
 *  dark enough to be lash, then one smooth arc through them (a parabola fitted twice, the second time without the
 *  columns far off the first: lash tips, the tail at the outer corner, a strand crossing). Column by column the line
 *  jumps between the top and the bottom of a thick lash and the squashed lash came out as a zigzag. Beyond the lash the
 *  ends hold. null when fewer than a fifth of the columns have lash. The idea comes from Mesh Avatar Studio's eyelid line;
 *  the code is ours */
/** an iris's room toward the nose (sign: the side it is on), from its texture and its eye's whites mask: at the iris's
 *  widest visible rows (alpha 200 inside the whites), how far the whites go on past its inner edge (median) and its
 *  width there; null when no iris shows in the whites */
function nasalRoom(iris: HTMLImageElement, I: LayerDef, mask: HTMLImageElement, E: LayerDef, sign: number): Nasal | null {
  const read = (img: HTMLImageElement) => {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0)
    return { w, h, d: g.getImageData(0, 0, w, h).data }
  }
  const a = read(iris), m = read(mask)
  const ux = I.w / a.w, uy = I.h / a.h
  const white = (x: number, y: number) => {  // as the stencil tests it: mask alpha 0.5
    const u = Math.floor(((x - E.x) / E.w) * m.w), v = Math.floor(((y - E.y) / E.h) * m.h)
    return u >= 0 && v >= 0 && u < m.w && v < m.h && m.d[4 * (v * m.w + u) + 3] >= 128
  }
  const rows: [number, number, number, number][] = []  // y, visible texels, the centres nearest and farthest from the nose
  for (let v = 0; v < a.h; v++) {
    const y = I.y + (v + 0.5) * uy
    let n = 0, lo = Infinity, hi = -Infinity
    for (let u = 0; u < a.w; u++) {
      const x = I.x + (u + 0.5) * ux
      if (a.d[4 * (v * a.w + u) + 3] < 200 || !white(x, y)) continue
      n++; lo = Math.min(lo, x); hi = Math.max(hi, x)
    }
    if (n) rows.push([y, n, sign > 0 ? hi : lo, sign > 0 ? lo : hi])
  }
  if (!rows.length) return null
  const top = Math.max(...rows.map((r) => r[1]))
  const room: number[] = [], inner: number[] = [], width: number[] = []
  for (const [y, n, near, far] of rows) {
    if (n < 0.9 * top) continue
    let k = 0
    while (white(near + sign * (k + 1) * ux, y)) k++
    room.push(k * ux); inner.push(near + sign * ux / 2); width.push(Math.abs(near - far) + ux)
  }
  const med = (v: number[]) => v.sort((p, q) => p - q)[v.length >> 1]
  return { room: med(room), sign, inner: med(inner), w: med(width) }
}

function closedLashLine(img: HTMLImageElement, L: LayerDef): ((x: number) => number) | null {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, w, h).data
  const ys: number[] = new Array(w).fill(NaN)
  for (let x = 0; x < w; x++) {
    let best = 255, by = -1
    for (let y = 0; y < h; y++) {
      const k = 4 * (y * w + x)
      if (d[k + 3] < 200) continue
      const l = 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]
      if (l < best) { best = l; by = y }
    }
    if (by >= 0 && best < 110) ys[x] = by
  }
  const found = ys.filter((v) => !Number.isNaN(v)).length
  if (found < 0.2 * w) return null
  const pts: [number, number][] = []
  ys.forEach((v, x) => { if (!Number.isNaN(v)) pts.push([L.x + (x + 0.5) * (L.w / w), L.y + (v + 0.5) * (L.h / h)]) })
  const fit = (P: [number, number][]) => {  // least squares y = a + b u + c u², u centred and scaled for conditioning
    const m = P.reduce((s, p) => s + p[0], 0) / P.length, sc = Math.max(1, (P[P.length - 1][0] - P[0][0]) / 2)
    const S = new Array(5).fill(0), T = [0, 0, 0]
    for (const [x, y] of P) { const u = (x - m) / sc; let q = 1; for (let k = 0; k < 5; k++) { S[k] += q; if (k < 3) T[k] += q * y; q *= u } }
    const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]]
    const det = (A: number[][]) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
    const D = det(M)
    if (!(Math.abs(D) > 1e-9)) return null  // too few distinct columns for a curve
    const co = [0, 1, 2].map((j) => det(M.map((r, i) => r.map((v, k) => (k === j ? T[i] : v)))) / D)
    if (!co.every(Number.isFinite)) return null
    return (x: number) => { const u = (x - m) / sc; return co[0] + co[1] * u + co[2] * u * u }
  }
  let f = fit(pts)
  if (!f) return null
  const res = pts.map(([x, y]) => Math.abs(y - f!(x))).sort((a, b) => a - b)
  const tol = Math.max(1.5, 2.5 * res[res.length >> 1])
  let used = pts
  const kept = pts.filter(([x, y]) => Math.abs(y - f!(x)) <= tol)
  const refit = kept.length >= 0.6 * pts.length ? fit(kept) : null
  if (refit) { f = refit; used = kept }
  const x0 = used[0][0], x1 = used[used.length - 1][0], line = f
  return (x: number) => line(Math.min(x1, Math.max(x0, x)))
}

function alphaGrid(imgs: HTMLImageElement[], cols: number, rows: number, ox = 0, oy = 0, w = cols, h = rows) {
  const c = document.createElement('canvas'); c.width = cols; c.height = rows
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingEnabled = true
  for (const img of imgs) g.drawImage(img, ox, oy, w, h)
  const d = g.getImageData(0, 0, cols, rows).data
  const occ = new Uint8Array(cols * rows)
  for (let i = 0; i < cols * rows; i++) occ[i] = d[4 * i + 3] > 0 ? 1 : 0
  const out = occ.slice()
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    if (occ[r * cols + q]) continue
    for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
      const rr = r + dr, qq = q + dq
      if (rr >= 0 && rr < rows && qq >= 0 && qq < cols && occ[rr * cols + qq]) out[r * cols + q] = 1
    }
  }
  return out
}

// ---------------------------------------------------------------- idle driver
/** the classic idle: a few sines and a first-order follow. The player's own (livliv.ai's
 *  pages use a livelier one) */
export class IdleDriver {
  nextBlink = 2; blinkT = -1; look = { x: 0, y: 0 }
  blinkRate = 1
  nextSaccade = 1; gaze = { x: 0, y: 0 }
  apply(P: Params, t: number, dt: number) {
    P.breath = 0.5 + 0.5 * Math.sin(t * 2.1)
    if (this.blinkT < 0 && t > this.nextBlink) this.blinkT = 0
    if (this.blinkT >= 0) {
      // fast close (75 ms), slower open (120 ms): reads as a natural blink
      this.blinkT += dt
      const b = this.blinkT / 0.075
      const open = b < 1 ? 1 - b : b < 2.6 ? (b - 1) / 1.6 : 1
      P.eyeLOpen = P.eyeROpen = Math.max(0, Math.min(1, open))
      if (b >= 2.6) { this.blinkT = -1; this.nextBlink = t + (1.8 + Math.random() * 3.8) / Math.max(0.2, this.blinkRate) }
    }
    // eyes lead the head: quick saccades toward the pointer, head follows slower
    if (t > this.nextSaccade) {
      this.gaze = { x: this.look.x + (Math.random() - 0.5) * 0.25, y: this.look.y * 0.8 + (Math.random() - 0.5) * 0.2 }
      this.nextSaccade = t + 0.6 + Math.random() * 1.6
    }
    P.eyeBallX += (Math.max(-1, Math.min(1, this.gaze.x * 1.2)) - P.eyeBallX) * Math.min(1, dt * 18)
    P.eyeBallY += (Math.max(-1, Math.min(1, this.gaze.y)) - P.eyeBallY) * Math.min(1, dt * 18)
    const tx = this.look.x * 20 + Math.sin(t * 0.7) * 3.5, ty = this.look.y * 13 + Math.sin(t * 0.9) * 2
    P.angleX += (tx - P.angleX) * Math.min(1, dt * 3)
    P.angleY += (ty - P.angleY) * Math.min(1, dt * 3)
    P.angleZ += (Math.sin(t * 0.5) * 3 - this.look.x * 4 - P.angleZ) * Math.min(1, dt * 2)
    P.bodyX += (this.look.x * 4 + Math.sin(t * 0.33) * 1.5 - P.bodyX) * Math.min(1, dt * 2)
    P.bodyZ += (Math.sin(t * 0.41 + 1) * 1.2 - P.bodyZ) * Math.min(1, dt * 2)
    const bt = this.look.y > 0.4 ? 0.5 : 0
    P.browLY += (bt - P.browLY) * Math.min(1, dt * 4); P.browRY = P.browLY
  }
}
