// A .livliv package: the model's folder as a ZIP, read here without a library. LivLiv writes every entry
// stored and keyforms.json deflated; a ZIP made by hand (Finder's or Windows' "compress", any tool) is read too, its
// files inside one folder or not, deflated entries wherever the browser has DecompressionStream('deflate-raw'). Only
// what a package can hold: no encryption, no ZIP64, no paths outside the package.

import { LIMITS } from './runtime/format'
import { LivLivError, type LivLivErrorCode } from './errors'

/** what a package may hold before anything is decoded; model.json and keyforms.json as format.ts says */
export const ZIP_LIMITS = { entries: 2048, bytes: 256 * 2 ** 20, modelJson: LIMITS.modelJson, keyforms: LIMITS.keyforms }

const fail = (why: string, code: LivLivErrorCode = 'invalid') => new LivLivError(code, `LivLiv: ${why}`)

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json' }

/** whether these bytes begin a ZIP (a local file header, or the end record of an empty one) */
export async function isZip(b: Blob): Promise<boolean> {
  const h = new Uint8Array(await b.slice(0, 4).arrayBuffer())
  return h.length === 4 && h[0] === 0x50 && h[1] === 0x4b && ((h[2] === 3 && h[3] === 4) || (h[2] === 5 && h[3] === 6))
}

/** the package's files by path (no folders, no __MACOSX / ._ / .DS_Store litter). Throws on what it cannot or must
 *  not read; a deflated keyforms.json the browser cannot inflate is left out (the character plays on the rig alone) */
export async function unzip(zip: Blob, signal?: AbortSignal): Promise<Map<string, Blob>> {
  signal?.throwIfAborted()
  const tailLen = Math.min(zip.size, 22 + 0xffff)
  const tail = new DataView(await zip.slice(zip.size - tailLen).arrayBuffer())
  let e = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break }
  if (e < 0) throw fail('this is not a ZIP (no end record)', 'not-a-model')
  const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw fail('ZIP64 packages are not supported', 'too-large')
  if (count > ZIP_LIMITS.entries) throw fail(`the package has ${count} entries, more than ${ZIP_LIMITS.entries}`, 'too-large')
  const cd = new DataView(await zip.slice(cdOff, cdOff + cdSize).arrayBuffer())
  const utf8 = new TextDecoder()
  const out = new Map<string, Blob>()
  let total = 0
  for (let o = 0, n = 0; n < count; n++) {
    signal?.throwIfAborted()
    if (o + 46 > cd.byteLength || cd.getUint32(o, true) !== 0x02014b50) throw fail('the package is damaged (central directory)')
    const flags = cd.getUint16(o + 8, true), method = cd.getUint16(o + 10, true)
    const csize = cd.getUint32(o + 20, true), usize = cd.getUint32(o + 24, true)
    const nlen = cd.getUint16(o + 28, true), elen = cd.getUint16(o + 30, true), clen = cd.getUint16(o + 32, true)
    const local = cd.getUint32(o + 42, true)
    const raw = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nlen))
    o += 46 + nlen + elen + clen
    const name = raw.replace(/\\/g, '/')
    const base = name.slice(name.lastIndexOf('/') + 1)
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db') continue
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some((s) => s === '..' || s === '.')) {
      throw fail(`the package holds a path outside itself: ${raw}`)
    }
    if (flags & 1) throw fail(`${name} is encrypted`)
    if (out.has(name)) throw fail(`${name} is in the package twice`)
    const isKeyforms = base === 'keyforms.json'
    const cap = base === 'model.json' ? ZIP_LIMITS.modelJson : isKeyforms ? ZIP_LIMITS.keyforms : ZIP_LIMITS.bytes
    if (usize > cap || (total += usize) > ZIP_LIMITS.bytes) throw fail(`${name} is too large (${usize} bytes)`, 'too-large')
    const h = new DataView(await zip.slice(local, local + 30).arrayBuffer())
    if (h.byteLength < 30 || h.getUint32(0, true) !== 0x04034b50) throw fail(`the package is damaged (${name})`)
    const start = local + 30 + h.getUint16(26, true) + h.getUint16(28, true)
    const data = zip.slice(start, start + csize)
    const type = TYPES[base.slice(base.lastIndexOf('.') + 1).toLowerCase()] || ''
    if (start + csize > zip.size) throw fail(`the package is damaged (${name} runs past its end)`)
    if (method === 0) {
      if (csize !== usize) throw fail(`the package is damaged (${name})`)
      out.set(name, data.slice(0, csize, type))
    } else if (method === 8) {
      if (!canInflate()) {
        if (isKeyforms) { console.warn(`LivLiv: this browser cannot inflate ${name}; the character plays without it`); continue }
        throw fail(`this browser cannot open the compressed ${name} (no DecompressionStream): store it uncompressed`, 'missing-feature')
      }
      out.set(name, await inflate(data, usize, name, type, signal))
    } else {
      throw fail(`${name} uses ZIP method ${method}; a package stores its files or deflates them`)
    }
  }
  signal?.throwIfAborted()
  return out
}

let inflates: boolean | undefined
function canInflate() {
  if (inflates === undefined) {
    try { inflates = typeof DecompressionStream !== 'undefined' && !!new DecompressionStream('deflate-raw') } catch { inflates = false }
  }
  return inflates
}

/** a deflated entry, never past the size its directory gives (a ZIP bomb stops there) */
async function inflate(data: Blob, size: number, name: string, type: string, signal?: AbortSignal): Promise<Blob> {
  const reader = data.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const parts: Uint8Array[] = []
  let n = 0
  try {
    for (;;) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      if (n > size) { void reader.cancel(); throw fail(`${name} inflates past its ${size} bytes`) }
      parts.push(value)
    }
  } catch (e) {
    if (signal?.aborted) { await reader.cancel(signal.reason); throw signal.reason }
    throw (e as Error).message?.startsWith(name) ? e : fail(`the package is damaged (${name}: ${(e as Error).message})`)
  }
  if (n !== size) throw fail(`the package is damaged (${name}: ${n} bytes, ${size} expected)`)
  return new Blob(parts as BlobPart[], { type })
}
