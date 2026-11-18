// @livliv-dev/player/body: characters that aren't LivLiv models, on the surface of Player. A Body draws one (a PNGTuber's
// pictures: @livliv-dev/player/png; a VRM: @livliv-dev/player/vrm; or your own); the BodyPlayer gives it what a LivLiv model gets
// from Player: the idle motion, expressions, actions and drivers, so lip sync (@livliv-dev/player/voice) and face tracking
// (@livliv-dev/player/tracking) work for it the same way. Each frame the pose is put together as Player does it (your params,
// the idle motion, the drivers, actions, expressions); the Body turns it into its own picture.
import { projectedAnchor, type AnchorName, type AttachmentAnchor } from './anchors'
export type { AnchorName, AttachmentAnchor } from './anchors'
import { pickLabel, type Labels } from './runtime/format'
import { defaultParams, type Params } from './runtime/params'
import { LivLivError, PlayerBase, aborted, contextGone, readBody, type LoadJob, type LoadOptions, type PlayerOptions } from './base'
import type { Seen } from './follow'
import { claimCanvas } from './release'

export { LivLivError }
export type { ParameterProfile, ParameterSample, ParameterRule } from './profile'
export type { ActionId, Driver, Frame, Host, LivLivErrorCode, LoadOptions, LoadProgress, PlaybackPose, PlayerOptions, View } from './base'

/** an expression a Body can show: `labels` its names by language (BCP 47 tag -> name), `label` the one to fall back on */
export interface BodyExpression { id: string; label: string; labels?: Labels }

/** one frame's pose, as a Body draws it: the params, the picture's move (x, y shares of the canvas, y up; s a scale)
 *  and each expression's weight (0..1, eased) */
export interface Pose { params: Params; move: { x: number; y: number; s: number }; expr: Record<string, number> }

export interface Body {
  /** what kind of character it draws ('png', 'vrm', ...): BodyInfo.format */
  readonly format: string
  /** optional: called before load with the canvas it will draw on; throw if it cannot draw there (the canvas already has
   *  another kind of context), and load() rejects with that */
  attach?(canvas: HTMLCanvasElement): void
  /** loads from its files (by file name); its name and the expressions it can show. If it rejects, the character before
   *  must stay as it is */
  load(files: Map<string, Blob>): Promise<{ name: string; expressions: BodyExpression[]; meta?: BodyMeta }>
  /** optional: the WebGL context it draws with, once it has one: what lets the player say when it is lost and give it up
   *  (dispose({ release: true })). A Body without WebGL leaves this out */
  context?(): WebGLRenderingContext | WebGL2RenderingContext | null
  /** draws the pose into the canvas, w × h device pixels, dt seconds after the last frame */
  render(canvas: HTMLCanvasElement, pose: Pose, w: number, h: number, dt: number): void
  /** where the head is, in shares of the canvas (from the top left) and its radii */
  head(): { x: number; y: number; rx: number; ry: number }
  /** optional rendered attachment points, in canvas shares (custom bodies may supply these) */
  anchor?(name: AnchorName): AttachmentAnchor | null
  dispose(): void
}

/** who made a body character and under what terms, as its file says */
export interface BodyMeta { author?: { name: string } | null; license?: { id?: string; url?: string } | null }

/** a loaded body character */
export interface BodyInfo {
  name: string
  /** the Body's format: 'png', 'vrm', ... */
  format: string
  /** what setExpression() takes (smile is always there: a param, not an expression) */
  expressions: { id: string; label: string; labels: Labels }[]
  /** what the file says about itself, where it does: a VRM's author and terms (VrmTerms). null otherwise */
  meta: BodyMeta | null
}

/** its files: a URL (one file, a .vrm say), a File / Blob, a FileList / File[], or a map or object of file name -> Blob
 *  or URL (`{ closed: 'me-closed.png', open: 'me-open.png' }`). Files are known by their name, without folders */
export type BodySource = string | URL | Blob | FileList | Iterable<File> | Map<string, Blob | string> | Record<string, Blob | string>

export type BodyPlayerOptions = PlayerOptions

/** the most a body's files may hold in all (a VRM is usually 5-50 MB) */
export const BODY_LIMIT = 256 * 2 ** 20

const SMILE: Labels = { en: 'Smile', zh: '笑', 'zh-Hant': '笑', ja: '笑顔' }

/** Plays a character a Body draws, with the API of Player where it applies (no mark, no `puppet`, no `view.head`) */
export class BodyPlayer extends PlayerBase<BodyInfo> {
  readonly body: Body
  /** CharaDock: preserve the host movement control for VRM. */
  motionScale = 1
  get frameParams() { return this.pose.params }
  /** see PlayerOptions.maxPixelRatio */
  maxPixelRatio: number
  private pose: Pose
  private time = 0

  constructor(canvas: HTMLCanvasElement, body: Body, options: BodyPlayerOptions = {}) {
    claimCanvas(canvas)
    const pose: Pose = { params: defaultParams(), move: { x: 0, y: 0, s: 1 }, expr: {} }
    super(canvas, pose.params, options)
    this.pose = pose
    this.body = body
    this.maxPixelRatio = options.maxPixelRatio ?? 2
  }

  /** the Body's own word for it: asking the canvas would start a context on one that may be meant for 2D
   *  @internal */
  protected get gl() { return this.body.context?.() ?? null }
  /** @internal */
  protected get drawable() { return !!this.info }
  /** @internal */
  protected get clock() { return this.time }
  /** @internal */
  protected get shownExpr() { return this.pose.expr }

  /** the body's head in the terms the idle's pointAt reads a puppet in (its canvas shares as clip space)
   *  @internal */
  protected seen(): Seen {
    const hd = this.info ? this.body.head() : { x: 0.5, y: 0.3, rx: 0.15, ry: 0.12 }
    return { model: { anchors: { head: { cx: 2 * hd.x - 1, cy: 2 * hd.y - 1, rx: 2 * hd.rx, ry: 2 * hd.ry } } } as Seen['model'], lastView: [1, 1, 0, 0, 2, 2] }
  }

  /** Loads a character from its files (see BodySource) in place of the one before (a failed load keeps it). A new load
   *  replaces one still downloading or waiting, which rejects with an AbortError (see LoadOptions); one whose character is
   *  already going in finishes first, since a Body swaps it inside, and the newer one then follows */
  load(source: BodySource, options: LoadOptions = {}): Promise<BodyInfo> {
    return this.start(options, (job) => this.inTurn(async () => {
      const { signal } = job
      if (signal.aborted) throw signal.reason
      this.body.attach?.(this.canvas)
      const files = await filesOf(source, job)
      if (signal.aborted) throw signal.reason
      job.build()
      const got = await this.body.load(files)
      if (this.disposed) { this.body.dispose(); throw aborted('the player was disposed') }  // disposed while it loaded: nothing of it may stay
      if (this.contextLost) throw contextGone()
      const ex = [{ id: 'smile', label: '', labels: SMILE }, ...got.expressions.filter((e) => e.id !== 'smile')
        .map((e) => ({ id: e.id, label: e.label, labels: e.labels ?? { en: e.label } }))]
      this.info = { name: got.name, format: this.body.format, meta: got.meta ?? null,
        expressions: ex.map((e) => ({ id: e.id, label: pickLabel(e.labels, this.lang, e.label || e.id), labels: e.labels })) }
      this.neutral(); this.pose.expr = {}
      if (!this.playing) this.resize()
      return this.info
    }))
  }

  /** Rendered attachment point; a custom Body without anchors exposes only its existing head centre. */
  getAnchor(name: AnchorName): AttachmentAnchor | null {
    if (!this.info || this.disposed) return null
    if (this.body.anchor) return this.body.anchor(name)
    if (name !== 'head') return null
    const h = this.body.head()
    return projectedAnchor([h.x, h.y], [h.x + h.rx, h.y], (this.canvas.clientHeight || this.canvas.height) / Math.max(1, this.canvas.clientWidth || this.canvas.width))
  }

  /** @internal */
  protected place(actY: number) {
    super.place(actY)
    const params = this.pose.params
    for (const key of ['angleX', 'angleY', 'angleZ', 'bodyX', 'bodyZ'] as const) params[key] *= this.motionScale
  }

  /** @internal */
  protected show(dt: number) {
    const f = this.frame, V = this.view
    this.pose.move = { x: f.move.x + V.x, y: f.move.y + V.y, s: f.move.s * V.zoom }
    const dpr = Math.min(this.maxPixelRatio, window.devicePixelRatio || 1)
    const [w, h] = this.renderSize ?? this.detachedSize ?? [Math.round(this.canvas.clientWidth * dpr), Math.round(this.canvas.clientHeight * dpr)]
    if (w >= 2 && h >= 2) this.body.render(this.canvas, this.pose, w, h, dt)
    this.time += dt
  }

  /** @internal */
  protected free() { this.body.dispose() }
}

/** a body's files by name, URLs fetched */
async function filesOf(source: BodySource, job: LoadJob): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>()
  let total = 0
  // files given by URL come one after another: each is its share of the download
  const given = source instanceof Map ? [...source.values()] : typeof source === 'object' && !(source instanceof URL) && !(Symbol.iterator in source) && !(source instanceof Blob) ? Object.values(source) : []
  const urls = typeof source === 'string' || source instanceof URL ? 1 : given.filter((v) => typeof v === 'string').length
  let came = 0
  const add = async (key: string, v: Blob | string) => {
    const name = key.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'file'
    let b: Blob
    if (typeof v === 'string') {
      const url = new URL(v, document.baseURI).href
      job.progress(came / urls)
      const unreachable = (e: unknown) => {
        if (job.signal.aborted) throw e
        throw new LivLivError('unreachable', `LivLiv: could not load ${url}: unreachable, or on another origin that sends no CORS header`, { cause: e })
      }
      const r = await fetch(url, { signal: job.signal }).catch(unreachable)
      if (!r.ok) throw new LivLivError('http', `LivLiv: could not load ${url} (HTTP ${r.status})`, { status: r.status })
      b = await readBody(r, job, (p) => (came + p) / urls).catch(unreachable)
      came++
      job.progress(came / urls)
    } else b = v
    if ((total += b.size) > BODY_LIMIT) throw new LivLivError('too-large', `LivLiv: the files are larger than ${BODY_LIMIT} bytes`)
    out.set(name, b)
  }
  if (typeof source === 'string' || source instanceof URL) {
    const u = new URL(String(source), document.baseURI)
    await add(decodeURIComponent(u.pathname), u.href)
  } else if (source instanceof Blob) await add((source as File).name || 'file', source)
  else if (source instanceof Map) for (const [k, v] of source) await add(k, v)
  else if (Symbol.iterator in source) for (const f of source as Iterable<File>) await add(f.name, f)
  else for (const [k, v] of Object.entries(source)) await add(k, v)
  return out
}
