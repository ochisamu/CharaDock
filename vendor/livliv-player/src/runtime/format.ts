// model.json as the player reads it: the public format, `livliv-model` version 4, lowered to the shape the
// runtime has always drawn from (ModelDef, the v3 `livemaker-puppet` layout), and v3 itself, read as it is, for good.
// The runtime below never sees a v4 file: what changed in v4 is names, places and what is left out, not how a model
// is drawn (a v3 model and its v4 export draw the same pixels).
import { BODY_NEEDS, BODY_POINTS } from './fullbody'
import type { ChainDef, LayerDef, ModelDef, Tuning } from './puppet'

/** model.json's `format` and the newest `version` of it this player reads. A v4 file names, in `requires`, the
 *  features a player must have to draw it right (FEATURES: full_body since 4.1, a full-body character); fields it does
 *  not know it ignores */
export const FORMAT = 'livliv-model', FORMAT_VERSION = 4
/** the format every model built before v4 has, and exports made until then: read as it is, whatever comes later */
export const LEGACY_FORMAT = 'livemaker-puppet', LEGACY_VERSION = 3
export const FEATURES: readonly string[] = ['full_body']

/** names by language (BCP 47 tag -> text): an expression's, a layer's */
export type Labels = Record<string, string>
/** center (kind livliv only): false draws the logo in the corner alone, without the light one over the character (the
 *  featured characters); missing or true, both (the free plan's) */
export interface Watermark { kind: 'livliv' | 'text' | 'none'; text?: string; center?: boolean }
/** v4's `meta`: who and what made the package, under what terms, and the mark it asks the player to draw */
export interface ModelMeta {
  generator: { name: string; build?: string }
  created?: string
  author?: { name: string; url?: string }
  license?: { id: string; url?: string; text?: string }
  watermark?: Watermark
}
/** v4's `files`: the optional files in the package, by what they are for */
export interface ModelFiles { keyforms?: string; avatar?: string; cover?: string; preview?: string }

/** limits a package is held to before anything is fetched, and before its images reach the GPU. A
 *  model.json is untrusted input (a package from anyone): these keep a broken or hostile one from hanging the page or
 *  filling its memory. The largest models LivLiv has built use a tenth of them or less (53 layers, 73 images, 8.5 M
 *  texels, 1536 px, a 22 KB model.json, 3 MB of keyforms) */
export const LIMITS = {
  canvas: 8192, layers: 512, images: 2048, expressions: 256, eyes: 16, chains: 64, points: 256,
  /** an image's side (px) and all the model's images' pixels */
  texture: 8192, texels: 64 * 2 ** 20,
  /** model.json and keyforms.json (bytes) */
  modelJson: 4 * 2 ** 20, keyforms: 32 * 2 ** 20,
  /** a layer's mesh covers its box on one lattice (latticeCell), whatever its image: the vertices of all the boxes, and of
   *  the layers bent by chains times how many bend them. The heaviest of 111 models here: 46 000 and 40 000 */
  vertices: 2 ** 21, skinned: 2 ** 20,
}
/** an error a player can tell apart by its `code` (the SDK's LivLivError); livliv.ai reads only the words */
export const coded = (code: string, message: string) => Object.assign(new Error(message), { code })

/** no number in a model comes near this; past it sums overflow to Infinity and then NaN, and the character is gone */
const BIG = 1e6
const GROUPS = ['head', 'body', 'hair_back', 'hair_side', 'hair_front', 'hair_inner']
/** the lattice every layer's mesh sits on, in model px (the same for all: see Puppet.buildLayer) */
export const latticeCell = (w: number, h: number) => Math.max(6, Math.round(Math.max(w, h) / 128))
/** a model's lattice: rig.lattice when the model pins it (a full-body model keeps the head-chest density on its tall
 *  canvas), else latticeCell of its canvas */
export const latticeOf = (m: Pick<ModelDef, 'canvas' | 'rig'>) => m.rig?.lattice ?? latticeCell(m.canvas[0], m.canvas[1])
const IMAGE = /^textures\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:webp|png)$/
const FILE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/

const read = new WeakSet<object>()

/** A model.json as the runtime draws it: v3 as it is (the same object), v4 lowered into a new one. Throws on anything
 *  else, on a newer version than this player reads, and on a feature in `requires` it does not have. `lang` picks the
 *  expressions' `label` from their names by language (all of them stay in `labels`). Reading a result again returns
 *  it as it is */
export function readModel(raw: unknown, lang = uiLang()): ModelDef {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw coded('not-a-model', 'not a LivLiv model (model.json is not an object)')
  if (read.has(raw)) return raw as ModelDef
  const m = raw as Record<string, unknown>
  if (m.format === undefined || m.format === LEGACY_FORMAT) {
    const v = (m.version as number | undefined) ?? LEGACY_VERSION
    if (v > LEGACY_VERSION) throw coded('not-a-model', `this model says format "${LEGACY_FORMAT}" version ${v}, which never existed`)
    check(m as unknown as ModelDef)
    read.add(m)
    return m as unknown as ModelDef
  }
  if (m.format !== FORMAT) throw coded('not-a-model', `not a LivLiv model (format "${String(m.format)}")`)
  const v = m.version as number
  if (typeof v !== 'number' || v > FORMAT_VERSION) {
    throw coded('newer-format', `this model is format version ${v}; this player reads up to ${FORMAT_VERSION}: update the player`)
  }
  const missing = ((m.requires as string[] | undefined) || []).filter((f) => !FEATURES.includes(f))
  if (missing.length) throw coded('missing-feature', `this model needs ${missing.join(', ')}, which this player does not have: update the player`)
  const out = lower(m as unknown as V4, lang)
  check(out)
  read.add(out)
  return out
}

/** what any model must be before it is drawn, whatever wrote it: sizes and counts in range (LIMITS), numbers finite,
 *  every image and file a path inside the package. Throws on the first thing wrong */
function check(m: ModelDef) {
  const bad = (why: string, code = 'invalid'): never => { throw coded(code, `this model is not valid: ${why}`) }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const list = (v: unknown, most: number, what: string) => {
    if (v === undefined) return []
    if (!Array.isArray(v) || v.length > most) bad(`${what} is not a list of at most ${most}`)
    return v as unknown[]
  }
  const [w = NaN, h = NaN] = Array.isArray(m.canvas) ? m.canvas : []
  if (!(num(w) && num(h) && w > 0 && h > 0 && w <= LIMITS.canvas && h <= LIMITS.canvas)) bad(`its canvas ${w} x ${h} is out of range`, w > LIMITS.canvas || h > LIMITS.canvas ? 'too-large' : 'invalid')
  if (!Array.isArray(m.layers) || !m.layers.length) bad('it has no layers')
  if (m.layers.length > LIMITS.layers) bad(`it has ${m.layers.length} layers, more than ${LIMITS.layers}`, 'too-large')
  const A = m.anchors, hd = A?.head, inRange = (v: unknown) => num(v) && Math.abs(v) <= BIG
  if (!hd || ![hd.cx, hd.cy, hd.rx, hd.ry, A.neck_y, A.top_y, A.bottom_y, A.hair_root_y].every(inRange) || !(hd.rx > 1e-3 && hd.ry > 1e-3)
    || !Array.isArray(A.face) || A.face.length !== 4 || !A.face.every(inRange)) bad('its anchors are missing or not numbers')
  // what the rig computes with: a number in range, a list of them, an object of them. Missing (or null: a build's None) is
  // the player's default. Anything else came out as NaN, a character gone for this player's whole life, or as an error
  // thrown once the model before it had been dropped
  const sane = (v: unknown, what: string) => { if (v != null && !inRange(v)) bad(`${what} is not a number in range`) }
  const nums = (v: unknown, lo: number, hi: number, what: string) => {
    if (v == null) return
    if (!Array.isArray(v) || v.length < lo || v.length > hi || !v.every(inRange)) bad(`${what} is not a list of ${lo} to ${hi} numbers`)
  }
  const fields = (o: unknown, names: string, what: string) => {
    if (o == null) return
    if (typeof o !== 'object') bad(`${what} is not an object`)
    for (const n of names.split(' ')) sane((o as Record<string, unknown>)[n], `${what}.${n}`)
  }
  const weights = (o: unknown, what: string) => {
    if (o == null) return
    if (typeof o !== 'object' || Array.isArray(o)) bad(`${what} is not an object`)
    for (const [k, v] of Object.entries(o as object)) sane(v, `${what}.${k.slice(0, 60)}`)
  }
  sane(A.collar_y, 'anchors.collar_y')
  // a full-body model: its frame on the canvas (it may reach past an edge, as a half-body build's crop
  // leaves room above the head; within a canvas of it, like a layer's box), its body's points as [x, y, confidence],
  // the hips above the ankles; it is drawn by its frame, so a body without one is not valid
  if (A.frame != null) {
    nums(A.frame, 4, 4, 'anchors.frame')
    const [x0, y0, x1, y1] = A.frame
    if (!(x0 >= -w && y0 >= -h && x1 <= 2 * w && y1 <= 2 * h && x1 - x0 >= 16 && y1 - y0 >= 16)) bad('anchors.frame is not a box on the canvas')
  }
  sane(A.hair_bottom_y, 'anchors.hair_bottom_y')
  if (A.body != null) {
    const B = A.body as unknown as Record<string, unknown>
    if (typeof B !== 'object' || Array.isArray(B)) bad('anchors.body is not an object')
    BODY_POINTS.forEach((k, i) => { if (i < BODY_NEEDS || B[k] != null) nums(B[k] ?? null, 3, 3, `anchors.body.${k}`); if (i < BODY_NEEDS && B[k] == null) bad(`anchors.body has no ${k}`) })
    if (!inRange(B.ground_y)) bad('anchors.body.ground_y is not a number in range')
    sane(B.hem_y, 'anchors.body.hem_y'); nums(B.hem_x, 2, 2, 'anchors.body.hem_x')
    const b = A.body
    if (Math.max(b.hip_l[1], b.hip_r[1]) >= Math.min(b.ankle_l[1], b.ankle_r[1])) bad('anchors.body has its hips below its ankles')
    if (Math.min(b.hip_l[1], b.hip_r[1]) <= A.neck_y + 1) bad('anchors.body has its hips above its neck')
    if (!(A.face[2] > A.face[0])) bad('anchors.face has no width')
    if (A.frame == null) bad('anchors.body comes without anchors.frame')
  }
  fields(A.jaw, 'top chin half open round wide', 'anchors.jaw')
  fields(A.chest, 'cx cy rx ry', 'anchors.chest')
  for (const b of list(A.eyes, LIMITS.eyes, 'anchors.eyes')) { if (b == null) bad('anchors.eyes has an empty entry'); nums(b, 4, 4, 'anchors.eyes') }
  for (const b of list(A.brows, LIMITS.eyes, 'anchors.brows')) nums(b, 4, 4, 'anchors.brows')
  for (const line of list(A.brow_lines, LIMITS.eyes, 'anchors.brow_lines') as ({ x?: unknown; bottom?: unknown; lid?: unknown; cap?: unknown } | null)[]) {
    if (line == null) continue
    const n = list(line.x, LIMITS.points, 'a brow line').length
    if (!n) bad('a brow line has no points')
    nums(line.x, n, n, 'a brow line'); nums(line.bottom ?? [], n, n, 'a brow line'); nums(line.lid ?? [], n, n, 'a brow line')
    if (line.cap != null) nums(line.cap, n, n, 'a brow line')
  }
  fields(m.tuning, 'turn nod hair blink expr mouth breath hairFront hairBack fringe', 'tuning')
  const R = m.rig
  fields(R, 'yaw pitch roll bulge bulge_shape hair_limit wind breath sway brow pitch_ease jaw', 'rig')
  nums(R?.bulge_extent, 3, 5, 'rig.bulge_extent'); nums(R?.drift, 2, 2, 'rig.drift'); nums(R?.hair_drive, 3, 3, 'rig.hair_drive')
  fields(R?.body, 'yaw roll breath bust', 'rig.body'); fields(R?.neck, 'twist reach', 'rig.neck')
  // a lattice of 1 px would be millions of vertices before LIMITS could say so: whole, and at least the smallest cell a
  // canvas ever gets
  if (R?.lattice != null && !(Number.isInteger(R.lattice) && R.lattice >= 6 && R.lattice <= 256)) bad('rig.lattice is not a whole number from 6 to 256')
  if (R?.hair != null) for (const k of ['front', 'back', 'side'] as const) nums(R.hair[k], 5, 5, `rig.hair.${k}`)
  for (const c of list(R?.chains, LIMITS.chains, 'rig.chains') as (ChainDef | null)[]) {
    if (!c || typeof c.id !== 'string') bad('a chain has no id')
    const what = `chain ${c!.id.slice(0, 60)}`, points = list(c!.points, LIMITS.points, `${what}'s points`)
    if (points.length < 2) bad(`${what} has fewer than two points`)
    for (const q of points) { if (q == null) bad(`${what} has an empty point`); nums(q, 2, 2, `${what}'s points`) }
    if (!c!.k) bad(`${what} has no k`)
    nums(c!.k, 2, 2, `${what}'s k`)
    for (const n of ['damp', 'drive', 'hang', 'wind'] as const) if (!num(c![n])) bad(`${what} has no ${n}`)
    fields(c, 'depth damp drive hang wind freq limit sigma reach', what)
    weights(c!.bias, `${what}'s bias`)
  }
  const cell = latticeOf(m)
  const bangs = m.layers.find((L) => L?.group === 'hair_front')?.bones
  let images = 0, vertices = 0, skinned = 0, read = 0
  for (const L of m.layers) {
    if (!L || typeof L !== 'object' || typeof L.id !== 'string') bad('a layer has no id')
    if (![L.x, L.y, L.w, L.h].every(num) || !(L.w > 0 && L.h > 0) || L.x < -w || L.y < -h || L.x + L.w > 2 * w || L.y + L.h > 2 * h) {
      bad(`layer ${L.id.slice(0, 60)}'s box is out of range`)
    }
    if (typeof L.texture !== 'string') bad(`layer ${L.id.slice(0, 60)} has no texture`)
    for (const p of [L.texture, ...list(L.frames, LIMITS.images, `layer ${L.id.slice(0, 60)}'s frames`), L.mask, L.talk, L.brow_tex]) {
      if (p === undefined) continue
      if (typeof p !== 'string' || !FILE.test(p)) bad(`layer ${L.id.slice(0, 60)}: "${String(p).slice(0, 80)}" is not a path inside the package`)
      if (++images > LIMITS.images) bad(`it names more than ${LIMITS.images} images`)
    }
    const what = `layer ${L.id.slice(0, 60)}`
    if (!GROUPS.includes(L.group)) bad(`${what}'s group is not one a player knows`)
    for (const n of ['role', 'clip', 'param'] as const) if (L[n] != null && typeof L[n] !== 'string') bad(`${what}'s ${n} is not text`)
    if (L.visemes != null && !(Array.isArray(L.visemes) && L.visemes.every((v) => typeof v === 'string'))) bad(`${what}'s visemes are not text`)
    sane(L.depth, `${what}'s depth`); sane(L.fall, `${what}'s fall`); sane(L.fall_end, `${what}'s fall_end`)
    nums(L.pivot, 2, 2, `${what}'s pivot`); nums(L.range, 2, 2, `${what}'s range`); nums(L.rigid, 2, 2, `${what}'s rigid`)
    weights(L.blush, `${what}'s blush`); weights(L.show, `${what}'s show`); weights(L.hide, `${what}'s hide`)
    // what its mesh will cost, by its box alone: a 1 x 1 picture stretched over a big box was a 150 000 vertex layer
    const bones = list(L.bones, LIMITS.chains, `${what}'s bones`)
    if (new Set(bones).size !== bones.length) bad(`${what} names a chain twice`)
    if (!bones.every((b) => typeof b === 'string')) bad(`${what}'s bones are not chain ids`)
    const verts = (Math.ceil((L.x + L.w) / cell) - Math.floor(L.x / cell) + 1) * (Math.ceil((L.y + L.h) / cell) - Math.floor(L.y / cell) + 1)
    const overBangs = L.id === 'brows' || L.role === 'expr_brows' || !!L.brow_tex  // these read their whole box back, and follow the bangs' chains
    vertices += verts
    skinned += verts * (bones.length + (overBangs && Array.isArray(bangs) ? bangs.length : 0))
    if (overBangs) read += L.w * L.h
  }
  if (vertices > LIMITS.vertices) bad(`its layers' meshes would have ${vertices} vertices, more than ${LIMITS.vertices}`, 'too-large')
  if (skinned > LIMITS.skinned) bad(`its chains would bend ${skinned} vertices, more than ${LIMITS.skinned}`, 'too-large')
  if (read > LIMITS.texels) bad(`its brows layers cover ${read} pixels, more than ${LIMITS.texels}`, 'too-large')
  for (const e of list(m.expressions, LIMITS.expressions, 'expressions') as ({ id?: unknown } | null)[]) if (!e || typeof e.id !== 'string') bad('an expression has no id')
  if (m.keyforms !== undefined && (typeof m.keyforms !== 'string' || !FILE.test(m.keyforms))) bad('keyforms is not a path inside the package')
  if (m.watermark != null && typeof m.watermark !== 'string') bad('its watermark is not text')
}

interface V4Layer extends Omit<LayerDef, 'name' | 'depth'> { depth?: number; label?: Labels; expression?: string }
interface V4 {
  format: string; version: number; name: string; meta: ModelMeta; requires?: string[]; files?: ModelFiles
  canvas: [number, number]; profile?: { id: string; facing?: string; glasses?: boolean }
  rig?: ModelDef['rig']; tuning?: Partial<Tuning> & { hair_front?: number; hair_back?: number }
  anchors: ModelDef['anchors']; expressions?: { id: string; label: Labels; hotkey?: string }[]; layers: V4Layer[]
}

function lower(m: V4, lang: string): ModelDef {
  if (!Array.isArray(m.layers) || !m.layers.length) throw coded('invalid', 'this model has no layers')
  if (m.layers.length > LIMITS.layers) throw coded('too-large', `this model has ${m.layers.length} layers, more than ${LIMITS.layers}`)
  const [w, h] = m.canvas || []
  if (!(w > 0 && h > 0 && w <= LIMITS.canvas && h <= LIMITS.canvas)) throw coded(w > LIMITS.canvas || h > LIMITS.canvas ? 'too-large' : 'invalid', `this model's canvas ${w} x ${h} is out of range`)
  for (const L of m.layers) {
    for (const p of [L.texture, ...(L.frames || []), L.mask, L.talk, L.brow_tex]) {
      if (p !== undefined && !IMAGE.test(p)) throw coded('invalid', `layer ${L.id}: "${p}" is not an image path of the package`)
    }
  }
  for (const [k, p] of Object.entries(m.files || {})) {
    if (!k.startsWith('x-') && (typeof p !== 'string' || !FILE.test(p))) throw coded('invalid', `files.${k}: "${p}" is not a path in the package`)
  }
  const layers = m.layers.map(({ label, expression, ...L }) =>
    ({ ...L, depth: L.depth ?? 0, name: label ? pickLabel(label, 'en', L.id) : L.id, ...(expression ? { param: expression } : {}) }) as LayerDef)
  let tuning: Partial<Tuning> | undefined
  if (m.tuning) {
    const { hair_front, hair_back, ...t } = m.tuning
    tuning = { ...t, ...(hair_front !== undefined ? { hairFront: hair_front } : {}), ...(hair_back !== undefined ? { hairBack: hair_back } : {}) }
  }
  const p = m.profile
  const mark = m.meta?.watermark
  return {
    format: m.format, version: m.version, name: m.name, canvas: m.canvas, anchors: m.anchors, layers, rig: m.rig, tuning,
    // lidCurveFits reads the two things v4 keeps of the classifier's view where v3 kept all of it
    profile: p && { id: p.id, label: '', class: { input: { facing: p.facing, glasses: p.glasses } } },
    expressions: (m.expressions || []).map((e) => ({ id: e.id, label: pickLabel(e.label, lang, e.id), labels: e.label,
      ...(e.hotkey ? { key: e.hotkey } : {}) })),
    keyforms: m.files?.keyforms,
    watermark: mark?.kind === 'livliv' ? 'LivLiv' : mark?.kind === 'text' ? mark.text ?? null : null,
    meta: m.meta, files: m.files,
  }
}

/** the page's language (the browser's), for picking names */
export function uiLang(): string {
  return (typeof navigator !== 'undefined' && navigator.language) || 'en'
}

/** a name in `lang`: that tag, its script (zh-TW -> zh-Hant), its language, then English, Chinese, any, `fallback` */
export function pickLabel(labels: Labels | undefined, lang: string, fallback: string): string {
  if (!labels) return fallback
  const keys = Object.keys(labels), find = (t: string) => keys.find((k) => k.toLowerCase() === t.toLowerCase())
  const tag = lang || 'en', base = tag.split('-')[0].toLowerCase()
  const hant = base === 'zh' && /-(hant|tw|hk|mo)\b/i.test(tag)
  for (const t of [tag, ...(base === 'zh' ? [hant ? 'zh-Hant' : 'zh-Hans'] : []), base, ...(hant ? ['zh'] : []), 'en', 'zh']) {
    const k = find(t)
    if (k && labels[k]) return labels[k]
  }
  return keys.length ? labels[keys[0]] : fallback
}

/** the language a name was written in, as v4 stores a name it has in one language only: kana ja, hangul ko, han zh,
 *  anything else en */
export function langOf(text: string): string {
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[가-힯]/.test(text)) return 'ko'
  if (/[一-鿿]/.test(text)) return 'zh'
  return 'en'
}
