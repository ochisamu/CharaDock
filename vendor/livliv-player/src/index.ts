// @livliv-dev/player: plays a LivLiv model (an exported model package: model.json and textures/) on a canvas, outside
// livliv.ai. The renderer is livliv.ai's own (src/runtime/puppet.ts); this wraps it in a small API: load, a frame
// loop with the idle motion, params, expressions, actions, the corner mark the package carries, and drivers. Face
// tracking and lip sync are separate imports ('@livliv-dev/player/tracking', '@livliv-dev/player/voice'), so the core stays small.
import type { AnchorName, AttachmentAnchor } from './anchors'
export type { AnchorName, AttachmentAnchor } from './anchors'
import { langOf, pickLabel, readModel, type Labels, type ModelMeta } from './runtime/format'
import { FORMAT, FORMAT_VERSION, LEGACY_FORMAT, PARAM_RANGES, Puppet, defaultParams, loadBlob, type KeyformFile, type ModelDef, type Params } from './runtime/puppet'
import { LivLivError, PlayerBase, aborted, contextGone, readBody, type LivLivErrorCode, type LoadJob, type LoadOptions, type PlayerOptions } from './base'
import { Mark } from './mark'
import { claimCanvas } from './release'
import { ZIP_LIMITS, isZip, unzip } from './zip'

export { FORMAT, FORMAT_VERSION, LEGACY_FORMAT, PARAM_RANGES, defaultParams }
export type { Labels, ModelDef, ModelMeta, Params }
export { modelFiles } from './files'
export { LivLivError }
export type { ParameterProfile, ParameterSample, ParameterRule } from './profile'
export type { ActionId, Driver, Fit, Frame, Host, LivLivErrorCode, LoadOptions, LoadProgress, PlaybackPose, PlayerOptions, View } from './base'

/** this package's version */
export const VERSION = '0.5.1'

/** where a model comes from: the URL of its model.json, of the folder holding it, or of a .livliv package (relative URLs
 *  resolve against the page); a .livliv package itself (a File or Blob: a ZIP of the folder); or its files: a FileList /
 *  File[] from an <input type="file"> (a folder with webkitdirectory, or one picked .livliv), or a map of path -> Blob */
export type ModelSource = string | URL | Blob | FileList | Iterable<File> | Map<string, Blob> | Record<string, Blob>

export interface ModelInfo {
  name: string
  /** model.json's format: FORMAT ("livliv-model"), or LEGACY_FORMAT ("livemaker-puppet") for packages exported before v4 */
  format: string
  /** its version (FORMAT_VERSION is the newest this player reads; a legacy package is 3) */
  version: number
  /** the size the character was drawn at, in pixels */
  size: [number, number]
  /** a full-body character: drawn standing on a ground line, its feet kept there, framed by `view.fit` */
  fullBody: boolean
  /** what setExpression() takes: `id` (smile, shy, angry ... mean the same on every model; x_… is the model's own),
   *  `label` its name in the player's language, `labels` every language's (BCP 47 tag -> name) */
  expressions: { id: string; label: string; labels: Labels }[]
  /** the mark drawn over the character: "LivLiv" (the free plan's), the owner's own text, or null */
  watermark: string | null
  /** v4 packages: who made it (author), the terms it comes under (license), what wrote it and when; null before v4 */
  meta: ModelMeta | null
}

/** the build's smile on a model whose list was never written (packages from before 2026-10) */
const SMILE: Labels = { zh: '笑', 'zh-Hant': '笑', en: 'Smile', ja: '笑顔' }

/** what the runtime throws when a canvas gives it no WebGL2 context */
const NO_WEBGL2 = 'this browser has no WebGL2'

/** Plays one LivLiv model on a canvas. Size the canvas with CSS; the drawing follows its size. */
export class Player extends PlayerBase<ModelInfo> {
  /** the renderer underneath: not part of the API, and not in the types
   *  @internal */
  readonly puppet: Puppet
  private mark: Mark

  /** Whether this browser can play a LivLiv model (WebGL2 starts on a new canvas). Where it cannot, new Player() throws */
  static isSupported(): boolean {
    const gl = document.createElement('canvas').getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()  // the try takes none of the contexts a page may have at once
    return !!gl
  }

  constructor(canvas: HTMLCanvasElement, options: PlayerOptions = {}) {
    claimCanvas(canvas)
    let puppet: Puppet
    try {
      puppet = new Puppet(canvas)
    } catch (e) {
      if (canvas.getContext('webgl2')?.isContextLost()) throw new LivLivError('context-lost', 'LivLiv: this canvas has lost its WebGL context: use a new canvas', { cause: e })
      throw new LivLivError('no-webgl', typeof WebGL2RenderingContext === 'undefined' ? 'LivLiv: this browser has no WebGL2'
        : (e as Error).message === NO_WEBGL2 ? 'LivLiv: could not start WebGL2 on this canvas: it is turned off in this browser, or the canvas already draws in 2D'
          : `LivLiv: could not start WebGL2 on this canvas (${(e as Error).message})`, { cause: e })
    }
    super(canvas, puppet.params, options)
    this.puppet = puppet
    this.puppet.maxDpr = options.maxPixelRatio ?? 2
    this.mark = new Mark(this.puppet.gl)
  }

  /** see PlayerOptions.maxPixelRatio */
  get maxPixelRatio() { return this.puppet.maxDpr }
  set maxPixelRatio(v: number) { this.puppet.maxDpr = v }

  /** @internal */
  protected get gl() { return this.puppet.gl }
  /** @internal */
  protected get drawable() { return !!this.puppet.model }
  /** @internal */
  protected get clock() { return this.puppet.time }
  /** @internal */
  protected get shownExpr() { return this.puppet.expr }
  /** @internal */
  protected seen() { return this.puppet }

  /** A point on the canvas (CSS px from its top left) in the model's own px, as the last frame drew it */
  canvasToModel(x: number, y: number): [number, number] { return this.puppet.canvasToModel(x, y) }

  /** A flick at a point in the model's px (canvasToModel): the swinging pieces passing near it are thrown, the nearest
   *  joint hardest (a tap on a twin tail). Returns how many it moved: none on a model without any */
  poke(x: number, y: number, strength = 1): number { return this.puppet.poke(x, y, strength) }

  /** Loads a model (see ModelSource) and shows it in place of the one before. A load that fails keeps it; a new load
   *  replaces one still running, which rejects with an AbortError (see LoadOptions) */
  load(source: ModelSource, options: LoadOptions = {}): Promise<ModelInfo> {
    return this.start(options, (job) => this.loadNow(source, job))
  }

  private async loadNow(source: ModelSource, job: LoadJob): Promise<ModelInfo> {
    const p = this.puppet, { signal } = job
    let files: Exclude<ModelSource, string | URL> | null = null
    if (typeof source === 'string' || source instanceof URL) {
      const url = new URL(String(source), document.baseURI)
      if (/\.(livliv|zip)$/i.test(url.pathname)) {
        job.progress(0)
        files = await fetchPackage(url.href, job)
        if (signal.aborted) throw signal.reason
      } else {
        job.progress(0)
        await p.load(url.href, { pack: false, signal, onImage: (came, of) => { job.progress(came / of); if (came === of) job.build() } }).catch((e) => { throw explain(e, url.href) })
      }
    } else files = source
    if (files) {
      job.build()
      const { model, image, keyforms } = await fromFiles(files)
      if (signal.aborted) throw signal.reason
      await p.loadModel(model, image, { keyforms, signal }).catch((e) => { throw explain(e, 'model.json') })
    }
    // the model is in: from here it is this load's, whatever came after it
    // (disposed in the moment since: nothing of it may stay or be drawn)
    if (this.disposed) { p.dispose(); throw aborted('the player was disposed') }
    if (p.gl.isContextLost()) throw contextGone()
    const m = p.model
    const ex = m.expressions || (m.layers.some((l) => l.id === 'expr_smile') ? [{ id: 'smile', label: '', labels: SMILE }] : [])
    this.info = {
      name: m.name, format: m.format || LEGACY_FORMAT, version: m.version ?? 3, size: m.canvas, fullBody: p.grounded,
      // a legacy package names each expression once, in the language its owner wrote it in
      expressions: ex.map(({ id, label, labels }) => {
        const all = labels || { [langOf(label)]: label }
        return { id, label: pickLabel(all, this.lang, id), labels: all }
      }),
      watermark: m.watermark ?? null, meta: m.meta ?? null,
    }
    // v4 says which mark it is; before it the text "LivLiv" meant the logo
    const kind = m.meta ? m.meta.watermark?.kind ?? 'none' : m.watermark === 'LivLiv' ? 'livliv' : m.watermark ? 'text' : 'none'
    this.mark.set(kind, m.watermark ?? null, m.meta?.watermark?.center !== false)
    this.neutral()
    if (!this.playing) this.resize()
    return this.info
  }

  /** The head or torso as drawn in the last frame, including view, action and body motion. */
  getAnchor(name: AnchorName): AttachmentAnchor | null { return this.info && !this.disposed ? this.puppet.anchor(name) : null }

  /** @internal */
  protected get grounded() { return this.puppet.grounded }

  /** a full-body character keeps its feet on the ground: the sideways move sways it from the ankles, a hop's crouch and
   *  a lean toward the camera crouch it, the talking bob dips its upper body, and only a hop's flight lifts it
   *  @internal */
  protected place(actY: number) {
    const p = this.puppet, f = this.frame
    if (!p.grounded) { super.place(actY); return }
    p.setMove(f.move.x, f.move.s, f.talk, actY, f.move.y)
    f.move.y = p.move.y
    this.ground = { crouch: p.crouch, dip: p.dip, talk: f.talk }
  }

  /** @internal */
  protected show(dt: number) {
    const p = this.puppet, f = this.frame, V = this.view, G = this.ground
    p.view = { x: V.x, y: V.y, s: V.zoom }
    p.focusHead = V.head
    p.fit = V.fit === 'whole' || V.fit === 'knee' ? V.fit : 'frame'
    p.move = { ...f.move }
    p.crouch = G.crouch; p.dip = G.dip
    p.size = this.renderSize ?? this.detachedSize
    p.update(dt)
    p.render()
    this.mark.draw(performance.now(), p.size ? 1 : p.gl.drawingBufferWidth / Math.max(1, this.canvas.clientWidth))
  }

  /** @internal */
  protected free() {
    const gl = this.puppet.gl
    this.puppet.dispose(); this.mark.dispose(); gl.deleteProgram(this.puppet.prog)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
  }
}

/** errors in the words of someone embedding the player (the runtime's own are written for livliv.ai) */
function explain(e: unknown, where: string): unknown {
  const err = e as Error & { status?: number; code?: LivLivErrorCode }
  if (err instanceof LivLivError || err?.name === 'AbortError') return e
  const msg = String(err?.message || e), cause = e
  if (err?.status) return new LivLivError('http', `LivLiv: could not load ${where} (HTTP ${err.status})`, { status: err.status, cause })
  if (msg.startsWith('image ')) {
    return new LivLivError('missing-file', `LivLiv: could not load the image ${msg.slice(6)}: it is missing, or on another origin that sends no CORS header`, { cause })
  }
  if (err instanceof SyntaxError) return new LivLivError('not-a-model', `LivLiv: ${where} is not a model.json (${msg})`, { cause })
  if (err instanceof TypeError && /fetch|load failed|network/i.test(msg)) {
    return new LivLivError('unreachable', `LivLiv: could not load ${where}: unreachable, or on another origin that sends no CORS header`, { cause })
  }
  return new LivLivError(err?.code ?? 'invalid', msg.startsWith('LivLiv') ? msg : `LivLiv: ${msg}`, { cause })
}

/** a file a Player cannot take but a BodyPlayer can: the words that say so */
const vrmHere = () => new LivLivError('not-a-model', 'LivLiv: this is a VRM or glTF file, and a Player plays LivLiv models: use a BodyPlayer with VrmBody (@livliv-dev/player/vrm)')
const isGlb = async (b: Blob) => { const d = new DataView(await b.slice(0, 4).arrayBuffer()); return d.byteLength === 4 && d.getUint32(0, true) === 0x46546c67 }

/** a .livliv package from a URL, as a Blob. One file is one connection to lose where a folder has dozens, and a dropped one
 *  breaks in the body as often as at the start: tried once more, unless the server said no (4xx). What the page gets is
 *  our words, never the browser's ("Failed to fetch", "Load failed") */
async function fetchPackage(url: string, job: LoadJob): Promise<Blob> {
  for (let again = true; ; again = false) {
    try {
      const r = await fetch(url, { signal: job.signal })
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status })
      return await readBody(r, job)
    } catch (e) {
      if (job.signal.aborted) throw e
      const status = (e as { status?: number }).status
      if (status && status < 500) throw explain(e, url)
      if (!again) throw status ? explain(e, url) : new LivLivError('unreachable', `LivLiv: could not load ${url}: unreachable or the connection dropped, or on another origin that sends no CORS header`, { cause: e })
    }
  }
}

/** a model from files: model.json (the shallowest one) and its images by their paths relative to it, and its keyforms
 *  when it declares them. A .livliv package (a Blob, or the one zip among picked files) is opened first; its files may
 *  sit inside one folder (a ZIP made with the system's "compress") */
async function fromFiles(source: Exclude<ModelSource, string | URL>) {
  const files = new Map<string, Blob>()
  const norm = (k: string) => k.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '')
  const unpack = async (b: Blob) => {
    if (await isGlb(b)) throw vrmHere()
    if (!(await isZip(b))) throw new LivLivError('not-a-model', 'LivLiv: this file is not a .livliv package (not a ZIP)')
    return unzip(b).catch((e) => { throw explain(e, 'the package') })
  }
  if (source instanceof Blob) (await unpack(source)).forEach((b, k) => files.set(k, b))
  else if (source instanceof Map) source.forEach((b, k) => files.set(norm(k), b))
  else if (Symbol.iterator in source) for (const f of source as Iterable<File>) files.set(norm(f.webkitRelativePath || f.name), f)
  else for (const [k, b] of Object.entries(source)) files.set(norm(k), b)
  const isJson = (k: string) => k === 'model.json' || k.endsWith('/model.json')
  if (!(source instanceof Blob) && ![...files.keys()].some(isJson)) {  // one picked package
    for (const b of files.values()) {
      if (await isZip(b)) { const z = await unpack(b); files.clear(); z.forEach((v, k) => files.set(k, v)); break }
    }
  }
  const json = [...files.keys()].filter(isJson).sort((a, b) => a.length - b.length)[0]
  if (!json && [...files.keys()].some((k) => /\.(vrm|glb)$/i.test(k))) throw vrmHere()
  if (!json) throw new LivLivError('missing-file', 'LivLiv: no model.json among the files')
  const dir = json.slice(0, json.length - 'model.json'.length)
  if (files.get(json)!.size > ZIP_LIMITS.modelJson) throw new LivLivError('too-large', `LivLiv: ${json} is larger than ${ZIP_LIMITS.modelJson} bytes`)
  let model: ModelDef
  try {
    model = readModel(JSON.parse(await files.get(json)!.text()))
  } catch (e) {
    throw explain(e, json)
  }
  // by path, or by name alone when the files were picked one by one (no folders)
  const byName = new Map<string, Blob>()
  files.forEach((b, k) => byName.set(k.slice(k.lastIndexOf('/') + 1), b))
  const find = (path: string) => files.get(dir + norm(path)) ?? byName.get(path.slice(path.lastIndexOf('/') + 1))
  const image = (path: string) => {
    const b = find(path)
    return b ? loadBlob(b) : Promise.reject(new LivLivError('missing-file', `LivLiv: ${path} is not among the files`))
  }
  let keyforms: KeyformFile | undefined
  const kf = model.keyforms ? find(model.keyforms) : undefined  // read only within its limit (format.ts LIMITS)
  if (kf && kf.size <= ZIP_LIMITS.keyforms) keyforms = await kf.text().then((t) => JSON.parse(t) as KeyformFile).catch(() => undefined)
  if (model.keyforms && !keyforms) console.warn(`LivLiv: ${model.keyforms} is missing or unreadable; the character plays on the rig alone`)
  return { model, image, keyforms }
}
