import { LivLivError, type LivLivErrorCode } from './errors'
import { readModel } from './runtime/format'
import { isZip, unzip, ZIP_LIMITS } from './zip'
import type { LoadOptions } from './base'
import type { ModelSource } from './index'

const fail = (message: string) => new LivLivError('too-large', `LivLiv: ${message}`)
const pathOf = (path: string) => {
  const value = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (!value || value.startsWith('/') || /[:?#\0]/.test(value) || value.split('/').some((p) => p === '..' || p === '.')) throw new LivLivError('invalid', 'LivLiv: a model file path is outside its package')
  return value
}

/** model.json read as the player reads it, its errors as a LivLivError */
function manifestOf(text: string) {
  try {
    return readModel(JSON.parse(text))
  } catch (e) {
    const err = e as Error & { code?: LivLivErrorCode }
    throw new LivLivError(e instanceof SyntaxError ? 'not-a-model' : err.code ?? 'invalid', `LivLiv: ${e instanceof SyntaxError ? 'model.json is not JSON' : err.message}`, { cause: e })
  }
}

/** Original model files for a portable project. Keeps the manifest, metadata and watermark unchanged.
 * A remote folder includes all declared textures and optional files; a failed fetch rejects the export. */
export async function modelFiles(source: ModelSource, options: Pick<LoadOptions, 'signal' | 'onProgress'> = {}): Promise<Map<string, Blob>> {
  const { signal, onProgress } = options
  signal?.throwIfAborted()
  let total = 0
  const read = async (url: URL, limit = ZIP_LIMITS.bytes) => {
    const r = await fetch(url, { signal }).catch((e) => {
      if (signal?.aborted || (e as Error)?.name === 'AbortError') throw e
      throw new LivLivError('unreachable', `LivLiv: could not load ${url.pathname}: unreachable, or on another origin that sends no CORS header`, { cause: e })
    })
    if (!r.ok) throw new LivLivError('http', `LivLiv: model file request failed (HTTP ${r.status})`, { status: r.status })
    const reader = r.body?.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []
    if (!reader) {
      const blob = await r.blob()
      total += blob.size
      if (blob.size > limit || total > ZIP_LIMITS.bytes) throw fail('model files exceed the package limit')
      return blob
    }
    let size = 0
    try {
      for (;;) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength; total += value.byteLength
        if (size > limit || total > ZIP_LIMITS.bytes) throw fail('model files exceed the package limit')
        chunks.push(value)
      }
    } catch (error) { await reader.cancel(error); throw error }
    return new Blob(chunks, { type: r.headers.get('content-type') ?? '' })
  }
  if (typeof source === 'string' || source instanceof URL) {
    const url = new URL(String(source), typeof document === 'undefined' ? undefined : document.baseURI)
    if (/\.(livliv|zip)$/i.test(url.pathname)) return modelFiles(await read(url), options)
    if (!url.pathname.endsWith('.json')) url.pathname = url.pathname.replace(/\/?$/, '/') + 'model.json'
    const manifest = await read(url, ZIP_LIMITS.modelJson), model = manifestOf(await manifest.text())
    const paths = new Set<string>()
    for (const layer of model.layers) for (const p of [layer.texture, ...(layer.frames ?? []), layer.mask, layer.talk, layer.brow_tex]) {
      if (p) paths.add(pathOf(layer.webp ? p.replace(/\.png$/, '.webp') : p))
    }
    for (const p of [model.keyforms, model.files?.avatar, model.files?.cover, model.files?.preview]) if (p) paths.add(pathOf(p))
    if (paths.size >= ZIP_LIMITS.entries) throw fail('too many model files')
    const files = new Map<string, Blob>([['model.json', manifest]])
    onProgress?.({ step: 'download', progress: 0 })
    for (const path of paths) {
      const asset = new URL(path, url), base = new URL('.', url), query = new URLSearchParams(url.search)
      if (asset.origin !== base.origin || !asset.pathname.startsWith(base.pathname) || /%(?:2f|5c)/i.test(asset.pathname)) throw new LivLivError('invalid', 'LivLiv: a model resource is outside its folder')
      if (model.tex) query.set('v', model.tex)
      asset.search = query.toString()
      files.set(path, await read(asset))
      onProgress?.({ step: 'download', progress: (files.size - 1) / paths.size })
    }
    signal?.throwIfAborted()
    return files
  }
  let files = new Map<string, Blob>()
  if (source instanceof Blob) return unzip(source, signal)
  if (source instanceof Map) for (const [name, blob] of source) files.set(pathOf(name), blob)
  else if (Symbol.iterator in source) for (const file of source as Iterable<File>) files.set(pathOf(file.webkitRelativePath || file.name), file)
  else for (const [name, blob] of Object.entries(source)) files.set(pathOf(name), blob)
  if (![...files.keys()].some((name) => name === 'model.json' || name.endsWith('/model.json'))) {
    for (const blob of files.values()) if (await isZip(blob)) { files = await unzip(blob, signal); break }
  }
  if (files.size > ZIP_LIMITS.entries) throw fail('too many model files')
  for (const blob of files.values()) { total += blob.size; if (total > ZIP_LIMITS.bytes) throw fail('model files exceed the package limit') }
  signal?.throwIfAborted()
  return files
}
