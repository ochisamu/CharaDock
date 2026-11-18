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

// vendor/livliv-player/vrm-reader.ts
var vrm_reader_exports = {};
__export(vrm_reader_exports, {
  VRM_LIMITS: () => VRM_LIMITS,
  checkGlb: () => checkGlb,
  vrmTerms: () => vrmTerms
});
module.exports = __toCommonJS(vrm_reader_exports);

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

// vendor/livliv-player/src/vrm.ts
var D = Math.PI / 180;
var VRM_LIMITS = { json: 32 * 2 ** 20, textureSide: 8192, texels: 512 * 2 ** 20, vertices: 16 * 2 ** 20 };
function vrmTerms(m) {
  if (!m) return void 0;
  const text = (v) => typeof v === "string" && v.trim() && v !== "undefined" ? v.trim() : void 0;
  const yes = (v) => typeof v === "boolean" ? v : v === "Allow" ? true : v === "Disallow" ? false : null;
  if (m.metaVersion === "0") {
    const url2 = text(m.otherLicenseUrl), id = text(m.licenseName);
    return {
      spec: "0",
      author: text(m.author) ? { name: text(m.author) } : null,
      license: id || url2 ? { id, url: url2 } : null,
      use: m.allowedUserName === "Everyone" ? "everyone" : m.allowedUserName === "ExplicitlyLicensedPerson" ? "licensed" : m.allowedUserName === "OnlyAuthor" ? "author" : null,
      commercial: m.commercialUssageName === "Allow" ? "allow" : m.commercialUssageName === "Disallow" ? "disallow" : null,
      violence: yes(m.violentUssageName),
      sexual: yes(m.sexualUssageName),
      redistribution: null,
      modification: null,
      raw: m
    };
  }
  const authors = (Array.isArray(m.authors) ? m.authors : []).map(text).filter(Boolean);
  const url = text(m.licenseUrl);
  return {
    spec: "1",
    author: authors.length ? { name: authors.join(", ") } : null,
    license: url ? { url } : null,
    use: m.avatarPermission === "everyone" ? "everyone" : m.avatarPermission === "onlySeparatelyLicensedPerson" ? "licensed" : m.avatarPermission === "onlyAuthor" ? "author" : null,
    commercial: m.commercialUsage === "corporation" ? "corporation" : m.commercialUsage === "personalProfit" ? "personal profit" : m.commercialUsage === "personalNonProfit" ? "personal non-profit" : null,
    violence: yes(m.allowExcessivelyViolentUsage),
    sexual: yes(m.allowExcessivelySexualUsage),
    redistribution: yes(m.allowRedistribution),
    modification: text(m.modification) ?? null,
    raw: m
  };
}
var COMPRESSED = { KHR_draco_mesh_compression: "Draco", EXT_meshopt_compression: "Meshopt", KHR_texture_basisu: "KTX2" };
async function checkGlb(file, name, noDecoders) {
  const bad = (why, code = "invalid") => {
    throw new LivLivError(code, `LivLiv: ${name} ${why}`);
  };
  const head = new DataView(await file.slice(0, 20).arrayBuffer());
  if (head.byteLength < 20 || head.getUint32(0, true) !== 1179937895) bad("is not a VRM: it should begin as a binary glTF does", "not-a-model");
  if (head.getUint32(4, true) !== 2) bad(`is a glTF of version ${head.getUint32(4, true)}, and VRM uses 2`, "not-a-model");
  const jsonLen = head.getUint32(12, true);
  if (head.getUint32(16, true) !== 1313821514) bad("is damaged (no JSON where a binary glTF has it)");
  if (jsonLen > VRM_LIMITS.json) bad(`is not one this player reads: its JSON has ${jsonLen} bytes, more than ${VRM_LIMITS.json}`, "too-large");
  if (20 + jsonLen > file.size) bad("is damaged or cut short");
  let gltf;
  try {
    gltf = JSON.parse(await file.slice(20, 20 + jsonLen).text());
  } catch {
    return bad("is damaged (its JSON does not parse)");
  }
  for (const o of [...gltf.buffers ?? [], ...gltf.images ?? []]) {
    if (o?.uri && !o.uri.startsWith("data:")) bad(`names a file outside itself (${String(o.uri).slice(0, 80)}), and a .vrm has to hold everything it needs`);
  }
  if (noDecoders) {
    for (const [ext, what] of Object.entries(COMPRESSED)) {
      if (gltf.extensionsUsed?.includes(ext)) bad(`is compressed with ${what}, and this page has no decoder for that. Export it uncompressed, or pass VrmBody a configureLoader`, "missing-feature");
    }
  }
  const positions = /* @__PURE__ */ new Set();
  for (const m of gltf.meshes ?? []) for (const p of m?.primitives ?? []) if (typeof p?.attributes?.POSITION === "number") positions.add(p.attributes.POSITION);
  let vertices = 0;
  for (const i of positions) vertices += gltf.accessors?.[i]?.count ?? 0;
  if (vertices > VRM_LIMITS.vertices) bad(`has ${vertices} vertices, more than ${VRM_LIMITS.vertices}`, "too-large");
  const binary = 20 + jsonLen + 8;
  let texels = 0;
  for (const im of gltf.images ?? []) {
    const bv = typeof im?.bufferView === "number" ? gltf.bufferViews?.[im.bufferView] : void 0;
    if (!bv) continue;
    const size = await pictureSize(file.slice(binary + (bv.byteOffset ?? 0), binary + (bv.byteOffset ?? 0) + (bv.byteLength ?? 0)));
    if (!size) continue;
    if (size[0] > VRM_LIMITS.textureSide || size[1] > VRM_LIMITS.textureSide || (texels += size[0] * size[1]) > VRM_LIMITS.texels) {
      bad(`has pictures too large for this player (${size[0]} x ${size[1]}; ${VRM_LIMITS.textureSide} px a side and ${VRM_LIMITS.texels} pixels in all at most)`, "too-large");
    }
  }
}
async function pictureSize(b) {
  const d = new DataView(await b.slice(0, 64 * 1024).arrayBuffer());
  if (d.byteLength >= 24 && d.getUint32(0) === 2303741511) return [d.getUint32(16), d.getUint32(20)];
  if (d.byteLength < 4 || d.getUint16(0) !== 65496) return null;
  for (let i = 2; i + 9 < d.byteLength; ) {
    if (d.getUint8(i) !== 255) {
      i++;
      continue;
    }
    const m = d.getUint8(i + 1);
    if (m >= 192 && m <= 207 && m !== 196 && m !== 200 && m !== 204) return [d.getUint16(i + 7), d.getUint16(i + 5)];
    i += 2 + d.getUint16(i + 2);
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VRM_LIMITS,
  checkGlb,
  vrmTerms
});
