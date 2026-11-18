/* LivLiv Player 0.5.1, Apache-2.0, Copyright 2026 LivLiv. See LICENSE, NOTICE and UPSTREAM.md. */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// vendor/livliv-player/package-reader.ts
var package_reader_exports = {};
__export(package_reader_exports, {
  ZIP_LIMITS: () => ZIP_LIMITS,
  unzip: () => unzip
});
module.exports = __toCommonJS(package_reader_exports);

// vendor/livliv-player/src/runtime/fullbody.ts
var FB_HIP_TILT = 2.2 * Math.PI / 180;

// vendor/livliv-player/src/runtime/format.ts
var LIMITS = {
  canvas: 8192,
  layers: 512,
  images: 2048,
  expressions: 256,
  eyes: 16,
  chains: 64,
  points: 256,
  /** an image's side (px) and all the model's images' pixels */
  texture: 8192,
  texels: 64 * 2 ** 20,
  /** model.json and keyforms.json (bytes) */
  modelJson: 4 * 2 ** 20,
  keyforms: 32 * 2 ** 20,
  /** a layer's mesh covers its box on one lattice (latticeCell), whatever its image: the vertices of all the boxes, and of
   *  the layers bent by chains times how many bend them. The heaviest of 111 models here: 46 000 and 40 000 */
  vertices: 2 ** 21,
  skinned: 2 ** 20
};

// vendor/livliv-player/src/errors.ts
var LivLivError = class extends Error {
  code;
  /** with code 'http': the HTTP status */
  status;
  constructor(code, message, options = {}) {
    super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "LivLivError";
    this.code = code;
    if (options.status !== void 0) this.status = options.status;
  }
};

// vendor/livliv-player/src/zip.ts
var ZIP_LIMITS = { entries: 2048, bytes: 256 * 2 ** 20, modelJson: LIMITS.modelJson, keyforms: LIMITS.keyforms };
var fail = (why, code = "invalid") => new LivLivError(code, `LivLiv: ${why}`);
var TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json" };
async function unzip(zip, signal) {
  signal?.throwIfAborted();
  const tailLen = Math.min(zip.size, 22 + 65535);
  const tail = new DataView(await zip.slice(zip.size - tailLen).arrayBuffer());
  let e = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 101010256) {
    e = i;
    break;
  }
  if (e < 0) throw fail("this is not a ZIP (no end record)", "not-a-model");
  const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true);
  if (count === 65535 || cdSize === 4294967295 || cdOff === 4294967295) throw fail("ZIP64 packages are not supported", "too-large");
  if (count > ZIP_LIMITS.entries) throw fail(`the package has ${count} entries, more than ${ZIP_LIMITS.entries}`, "too-large");
  const cd = new DataView(await zip.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const utf8 = new TextDecoder();
  const out = /* @__PURE__ */ new Map();
  let total = 0;
  for (let o = 0, n = 0; n < count; n++) {
    signal?.throwIfAborted();
    if (o + 46 > cd.byteLength || cd.getUint32(o, true) !== 33639248) throw fail("the package is damaged (central directory)");
    const flags = cd.getUint16(o + 8, true), method = cd.getUint16(o + 10, true);
    const csize = cd.getUint32(o + 20, true), usize = cd.getUint32(o + 24, true);
    const nlen = cd.getUint16(o + 28, true), elen = cd.getUint16(o + 30, true), clen = cd.getUint16(o + 32, true);
    const local = cd.getUint32(o + 42, true);
    const raw = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nlen));
    o += 46 + nlen + elen + clen;
    const name = raw.replace(/\\/g, "/");
    const base = name.slice(name.lastIndexOf("/") + 1);
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || base.startsWith("._") || base === ".DS_Store" || base === "Thumbs.db") continue;
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").some((s) => s === ".." || s === ".")) {
      throw fail(`the package holds a path outside itself: ${raw}`);
    }
    if (flags & 1) throw fail(`${name} is encrypted`);
    if (out.has(name)) throw fail(`${name} is in the package twice`);
    const isKeyforms = base === "keyforms.json";
    const cap = base === "model.json" ? ZIP_LIMITS.modelJson : isKeyforms ? ZIP_LIMITS.keyforms : ZIP_LIMITS.bytes;
    if (usize > cap || (total += usize) > ZIP_LIMITS.bytes) throw fail(`${name} is too large (${usize} bytes)`, "too-large");
    const h = new DataView(await zip.slice(local, local + 30).arrayBuffer());
    if (h.byteLength < 30 || h.getUint32(0, true) !== 67324752) throw fail(`the package is damaged (${name})`);
    const start = local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const data = zip.slice(start, start + csize);
    const type = TYPES[base.slice(base.lastIndexOf(".") + 1).toLowerCase()] || "";
    if (start + csize > zip.size) throw fail(`the package is damaged (${name} runs past its end)`);
    if (method === 0) {
      if (csize !== usize) throw fail(`the package is damaged (${name})`);
      out.set(name, data.slice(0, csize, type));
    } else if (method === 8) {
      if (!canInflate()) {
        if (isKeyforms) {
          console.warn(`LivLiv: this browser cannot inflate ${name}; the character plays without it`);
          continue;
        }
        throw fail(`this browser cannot open the compressed ${name} (no DecompressionStream): store it uncompressed`, "missing-feature");
      }
      out.set(name, await inflate(data, usize, name, type, signal));
    } else {
      throw fail(`${name} uses ZIP method ${method}; a package stores its files or deflates them`);
    }
  }
  signal?.throwIfAborted();
  return out;
}
var inflates;
function canInflate() {
  if (inflates === void 0) {
    try {
      inflates = typeof DecompressionStream !== "undefined" && !!new DecompressionStream("deflate-raw");
    } catch {
      inflates = false;
    }
  }
  return inflates;
}
async function inflate(data, size, name, type, signal) {
  const reader = data.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let n = 0;
  try {
    for (; ; ) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > size) {
        void reader.cancel();
        throw fail(`${name} inflates past its ${size} bytes`);
      }
      parts.push(value);
    }
  } catch (e) {
    if (signal?.aborted) {
      await reader.cancel(signal.reason);
      throw signal.reason;
    }
    throw e.message?.startsWith(name) ? e : fail(`the package is damaged (${name}: ${e.message})`);
  }
  if (n !== size) throw fail(`the package is damaged (${name}: ${n} bytes, ${size} expected)`);
  return new Blob(parts, { type });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ZIP_LIMITS,
  unzip
});
