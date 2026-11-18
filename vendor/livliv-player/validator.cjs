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

// vendor/livliv-player/src/runtime/format.ts
var format_exports = {};
__export(format_exports, {
  FEATURES: () => FEATURES,
  FORMAT: () => FORMAT,
  FORMAT_VERSION: () => FORMAT_VERSION,
  LEGACY_FORMAT: () => LEGACY_FORMAT,
  LEGACY_VERSION: () => LEGACY_VERSION,
  LIMITS: () => LIMITS,
  coded: () => coded,
  langOf: () => langOf,
  latticeCell: () => latticeCell,
  latticeOf: () => latticeOf,
  pickLabel: () => pickLabel,
  readModel: () => readModel,
  uiLang: () => uiLang
});
module.exports = __toCommonJS(format_exports);

// vendor/livliv-player/src/runtime/fullbody.ts
var BODY_POINTS = [
  "hip_l",
  "hip_r",
  "ankle_l",
  "ankle_r",
  "knee_l",
  "knee_r",
  "shoulder_l",
  "shoulder_r",
  "elbow_l",
  "elbow_r",
  "wrist_l",
  "wrist_r",
  "neck"
];
var BODY_NEEDS = 4;
var FB_HIP_TILT = 2.2 * Math.PI / 180;

// vendor/livliv-player/src/runtime/format.ts
var FORMAT = "livliv-model";
var FORMAT_VERSION = 4;
var LEGACY_FORMAT = "livemaker-puppet";
var LEGACY_VERSION = 3;
var FEATURES = ["full_body"];
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
var coded = (code, message) => Object.assign(new Error(message), { code });
var BIG = 1e6;
var GROUPS = ["head", "body", "hair_back", "hair_side", "hair_front", "hair_inner"];
var latticeCell = (w, h) => Math.max(6, Math.round(Math.max(w, h) / 128));
var latticeOf = (m) => m.rig?.lattice ?? latticeCell(m.canvas[0], m.canvas[1]);
var IMAGE = /^textures\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:webp|png)$/;
var FILE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
var read = /* @__PURE__ */ new WeakSet();
function readModel(raw, lang = uiLang()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw coded("not-a-model", "not a LivLiv model (model.json is not an object)");
  if (read.has(raw)) return raw;
  const m = raw;
  if (m.format === void 0 || m.format === LEGACY_FORMAT) {
    const v2 = m.version ?? LEGACY_VERSION;
    if (v2 > LEGACY_VERSION) throw coded("not-a-model", `this model says format "${LEGACY_FORMAT}" version ${v2}, which never existed`);
    check(m);
    read.add(m);
    return m;
  }
  if (m.format !== FORMAT) throw coded("not-a-model", `not a LivLiv model (format "${String(m.format)}")`);
  const v = m.version;
  if (typeof v !== "number" || v > FORMAT_VERSION) {
    throw coded("newer-format", `this model is format version ${v}; this player reads up to ${FORMAT_VERSION}: update the player`);
  }
  const missing = (m.requires || []).filter((f) => !FEATURES.includes(f));
  if (missing.length) throw coded("missing-feature", `this model needs ${missing.join(", ")}, which this player does not have: update the player`);
  const out = lower(m, lang);
  check(out);
  read.add(out);
  return out;
}
function check(m) {
  const bad = (why, code = "invalid") => {
    throw coded(code, `this model is not valid: ${why}`);
  };
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const list = (v, most, what) => {
    if (v === void 0) return [];
    if (!Array.isArray(v) || v.length > most) bad(`${what} is not a list of at most ${most}`);
    return v;
  };
  const [w = NaN, h = NaN] = Array.isArray(m.canvas) ? m.canvas : [];
  if (!(num(w) && num(h) && w > 0 && h > 0 && w <= LIMITS.canvas && h <= LIMITS.canvas)) bad(`its canvas ${w} x ${h} is out of range`, w > LIMITS.canvas || h > LIMITS.canvas ? "too-large" : "invalid");
  if (!Array.isArray(m.layers) || !m.layers.length) bad("it has no layers");
  if (m.layers.length > LIMITS.layers) bad(`it has ${m.layers.length} layers, more than ${LIMITS.layers}`, "too-large");
  const A = m.anchors, hd = A?.head, inRange = (v) => num(v) && Math.abs(v) <= BIG;
  if (!hd || ![hd.cx, hd.cy, hd.rx, hd.ry, A.neck_y, A.top_y, A.bottom_y, A.hair_root_y].every(inRange) || !(hd.rx > 1e-3 && hd.ry > 1e-3) || !Array.isArray(A.face) || A.face.length !== 4 || !A.face.every(inRange)) bad("its anchors are missing or not numbers");
  const sane = (v, what) => {
    if (v != null && !inRange(v)) bad(`${what} is not a number in range`);
  };
  const nums = (v, lo, hi, what) => {
    if (v == null) return;
    if (!Array.isArray(v) || v.length < lo || v.length > hi || !v.every(inRange)) bad(`${what} is not a list of ${lo} to ${hi} numbers`);
  };
  const fields = (o, names, what) => {
    if (o == null) return;
    if (typeof o !== "object") bad(`${what} is not an object`);
    for (const n of names.split(" ")) sane(o[n], `${what}.${n}`);
  };
  const weights = (o, what) => {
    if (o == null) return;
    if (typeof o !== "object" || Array.isArray(o)) bad(`${what} is not an object`);
    for (const [k, v] of Object.entries(o)) sane(v, `${what}.${k.slice(0, 60)}`);
  };
  sane(A.collar_y, "anchors.collar_y");
  if (A.frame != null) {
    nums(A.frame, 4, 4, "anchors.frame");
    const [x0, y0, x1, y1] = A.frame;
    if (!(x0 >= -w && y0 >= -h && x1 <= 2 * w && y1 <= 2 * h && x1 - x0 >= 16 && y1 - y0 >= 16)) bad("anchors.frame is not a box on the canvas");
  }
  sane(A.hair_bottom_y, "anchors.hair_bottom_y");
  if (A.body != null) {
    const B = A.body;
    if (typeof B !== "object" || Array.isArray(B)) bad("anchors.body is not an object");
    BODY_POINTS.forEach((k, i) => {
      if (i < BODY_NEEDS || B[k] != null) nums(B[k] ?? null, 3, 3, `anchors.body.${k}`);
      if (i < BODY_NEEDS && B[k] == null) bad(`anchors.body has no ${k}`);
    });
    if (!inRange(B.ground_y)) bad("anchors.body.ground_y is not a number in range");
    sane(B.hem_y, "anchors.body.hem_y");
    nums(B.hem_x, 2, 2, "anchors.body.hem_x");
    const b = A.body;
    if (Math.max(b.hip_l[1], b.hip_r[1]) >= Math.min(b.ankle_l[1], b.ankle_r[1])) bad("anchors.body has its hips below its ankles");
    if (Math.min(b.hip_l[1], b.hip_r[1]) <= A.neck_y + 1) bad("anchors.body has its hips above its neck");
    if (!(A.face[2] > A.face[0])) bad("anchors.face has no width");
    if (A.frame == null) bad("anchors.body comes without anchors.frame");
  }
  fields(A.jaw, "top chin half open round wide", "anchors.jaw");
  fields(A.chest, "cx cy rx ry", "anchors.chest");
  for (const b of list(A.eyes, LIMITS.eyes, "anchors.eyes")) {
    if (b == null) bad("anchors.eyes has an empty entry");
    nums(b, 4, 4, "anchors.eyes");
  }
  for (const b of list(A.brows, LIMITS.eyes, "anchors.brows")) nums(b, 4, 4, "anchors.brows");
  for (const line of list(A.brow_lines, LIMITS.eyes, "anchors.brow_lines")) {
    if (line == null) continue;
    const n = list(line.x, LIMITS.points, "a brow line").length;
    if (!n) bad("a brow line has no points");
    nums(line.x, n, n, "a brow line");
    nums(line.bottom ?? [], n, n, "a brow line");
    nums(line.lid ?? [], n, n, "a brow line");
    if (line.cap != null) nums(line.cap, n, n, "a brow line");
  }
  fields(m.tuning, "turn nod hair blink expr mouth breath hairFront hairBack fringe", "tuning");
  const R = m.rig;
  fields(R, "yaw pitch roll bulge bulge_shape hair_limit wind breath sway brow pitch_ease jaw", "rig");
  nums(R?.bulge_extent, 3, 5, "rig.bulge_extent");
  nums(R?.drift, 2, 2, "rig.drift");
  nums(R?.hair_drive, 3, 3, "rig.hair_drive");
  fields(R?.body, "yaw roll breath bust", "rig.body");
  fields(R?.neck, "twist reach", "rig.neck");
  if (R?.lattice != null && !(Number.isInteger(R.lattice) && R.lattice >= 6 && R.lattice <= 256)) bad("rig.lattice is not a whole number from 6 to 256");
  if (R?.hair != null) for (const k of ["front", "back", "side"]) nums(R.hair[k], 5, 5, `rig.hair.${k}`);
  for (const c of list(R?.chains, LIMITS.chains, "rig.chains")) {
    if (!c || typeof c.id !== "string") bad("a chain has no id");
    const what = `chain ${c.id.slice(0, 60)}`, points = list(c.points, LIMITS.points, `${what}'s points`);
    if (points.length < 2) bad(`${what} has fewer than two points`);
    for (const q of points) {
      if (q == null) bad(`${what} has an empty point`);
      nums(q, 2, 2, `${what}'s points`);
    }
    if (!c.k) bad(`${what} has no k`);
    nums(c.k, 2, 2, `${what}'s k`);
    for (const n of ["damp", "drive", "hang", "wind"]) if (!num(c[n])) bad(`${what} has no ${n}`);
    fields(c, "depth damp drive hang wind freq limit sigma reach", what);
    weights(c.bias, `${what}'s bias`);
  }
  const cell = latticeOf(m);
  const bangs = m.layers.find((L) => L?.group === "hair_front")?.bones;
  let images = 0, vertices = 0, skinned = 0, read2 = 0;
  for (const L of m.layers) {
    if (!L || typeof L !== "object" || typeof L.id !== "string") bad("a layer has no id");
    if (![L.x, L.y, L.w, L.h].every(num) || !(L.w > 0 && L.h > 0) || L.x < -w || L.y < -h || L.x + L.w > 2 * w || L.y + L.h > 2 * h) {
      bad(`layer ${L.id.slice(0, 60)}'s box is out of range`);
    }
    if (typeof L.texture !== "string") bad(`layer ${L.id.slice(0, 60)} has no texture`);
    for (const p of [L.texture, ...list(L.frames, LIMITS.images, `layer ${L.id.slice(0, 60)}'s frames`), L.mask, L.talk, L.brow_tex]) {
      if (p === void 0) continue;
      if (typeof p !== "string" || !FILE.test(p)) bad(`layer ${L.id.slice(0, 60)}: "${String(p).slice(0, 80)}" is not a path inside the package`);
      if (++images > LIMITS.images) bad(`it names more than ${LIMITS.images} images`);
    }
    const what = `layer ${L.id.slice(0, 60)}`;
    if (!GROUPS.includes(L.group)) bad(`${what}'s group is not one a player knows`);
    for (const n of ["role", "clip", "param"]) if (L[n] != null && typeof L[n] !== "string") bad(`${what}'s ${n} is not text`);
    if (L.visemes != null && !(Array.isArray(L.visemes) && L.visemes.every((v) => typeof v === "string"))) bad(`${what}'s visemes are not text`);
    sane(L.depth, `${what}'s depth`);
    sane(L.fall, `${what}'s fall`);
    sane(L.fall_end, `${what}'s fall_end`);
    nums(L.pivot, 2, 2, `${what}'s pivot`);
    nums(L.range, 2, 2, `${what}'s range`);
    nums(L.rigid, 2, 2, `${what}'s rigid`);
    weights(L.blush, `${what}'s blush`);
    weights(L.show, `${what}'s show`);
    weights(L.hide, `${what}'s hide`);
    const bones = list(L.bones, LIMITS.chains, `${what}'s bones`);
    if (new Set(bones).size !== bones.length) bad(`${what} names a chain twice`);
    if (!bones.every((b) => typeof b === "string")) bad(`${what}'s bones are not chain ids`);
    const verts = (Math.ceil((L.x + L.w) / cell) - Math.floor(L.x / cell) + 1) * (Math.ceil((L.y + L.h) / cell) - Math.floor(L.y / cell) + 1);
    const overBangs = L.id === "brows" || L.role === "expr_brows" || !!L.brow_tex;
    vertices += verts;
    skinned += verts * (bones.length + (overBangs && Array.isArray(bangs) ? bangs.length : 0));
    if (overBangs) read2 += L.w * L.h;
  }
  if (vertices > LIMITS.vertices) bad(`its layers' meshes would have ${vertices} vertices, more than ${LIMITS.vertices}`, "too-large");
  if (skinned > LIMITS.skinned) bad(`its chains would bend ${skinned} vertices, more than ${LIMITS.skinned}`, "too-large");
  if (read2 > LIMITS.texels) bad(`its brows layers cover ${read2} pixels, more than ${LIMITS.texels}`, "too-large");
  for (const e of list(m.expressions, LIMITS.expressions, "expressions")) if (!e || typeof e.id !== "string") bad("an expression has no id");
  if (m.keyforms !== void 0 && (typeof m.keyforms !== "string" || !FILE.test(m.keyforms))) bad("keyforms is not a path inside the package");
  if (m.watermark != null && typeof m.watermark !== "string") bad("its watermark is not text");
}
function lower(m, lang) {
  if (!Array.isArray(m.layers) || !m.layers.length) throw coded("invalid", "this model has no layers");
  if (m.layers.length > LIMITS.layers) throw coded("too-large", `this model has ${m.layers.length} layers, more than ${LIMITS.layers}`);
  const [w, h] = m.canvas || [];
  if (!(w > 0 && h > 0 && w <= LIMITS.canvas && h <= LIMITS.canvas)) throw coded(w > LIMITS.canvas || h > LIMITS.canvas ? "too-large" : "invalid", `this model's canvas ${w} x ${h} is out of range`);
  for (const L of m.layers) {
    for (const p2 of [L.texture, ...L.frames || [], L.mask, L.talk, L.brow_tex]) {
      if (p2 !== void 0 && !IMAGE.test(p2)) throw coded("invalid", `layer ${L.id}: "${p2}" is not an image path of the package`);
    }
  }
  for (const [k, p2] of Object.entries(m.files || {})) {
    if (!k.startsWith("x-") && (typeof p2 !== "string" || !FILE.test(p2))) throw coded("invalid", `files.${k}: "${p2}" is not a path in the package`);
  }
  const layers = m.layers.map(({ label, expression, ...L }) => ({ ...L, depth: L.depth ?? 0, name: label ? pickLabel(label, "en", L.id) : L.id, ...expression ? { param: expression } : {} }));
  let tuning;
  if (m.tuning) {
    const { hair_front, hair_back, ...t } = m.tuning;
    tuning = { ...t, ...hair_front !== void 0 ? { hairFront: hair_front } : {}, ...hair_back !== void 0 ? { hairBack: hair_back } : {} };
  }
  const p = m.profile;
  const mark = m.meta?.watermark;
  return {
    format: m.format,
    version: m.version,
    name: m.name,
    canvas: m.canvas,
    anchors: m.anchors,
    layers,
    rig: m.rig,
    tuning,
    // lidCurveFits reads the two things v4 keeps of the classifier's view where v3 kept all of it
    profile: p && { id: p.id, label: "", class: { input: { facing: p.facing, glasses: p.glasses } } },
    expressions: (m.expressions || []).map((e) => ({
      id: e.id,
      label: pickLabel(e.label, lang, e.id),
      labels: e.label,
      ...e.hotkey ? { key: e.hotkey } : {}
    })),
    keyforms: m.files?.keyforms,
    watermark: mark?.kind === "livliv" ? "LivLiv" : mark?.kind === "text" ? mark.text ?? null : null,
    meta: m.meta,
    files: m.files
  };
}
function uiLang() {
  return typeof navigator !== "undefined" && navigator.language || "en";
}
function pickLabel(labels, lang, fallback) {
  if (!labels) return fallback;
  const keys = Object.keys(labels), find = (t) => keys.find((k) => k.toLowerCase() === t.toLowerCase());
  const tag = lang || "en", base = tag.split("-")[0].toLowerCase();
  const hant = base === "zh" && /-(hant|tw|hk|mo)\b/i.test(tag);
  for (const t of [tag, ...base === "zh" ? [hant ? "zh-Hant" : "zh-Hans"] : [], base, ...hant ? ["zh"] : [], "en", "zh"]) {
    const k = find(t);
    if (k && labels[k]) return labels[k];
  }
  return keys.length ? labels[keys[0]] : fallback;
}
function langOf(text) {
  if (/[぀-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[一-鿿]/.test(text)) return "zh";
  return "en";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FEATURES,
  FORMAT,
  FORMAT_VERSION,
  LEGACY_FORMAT,
  LEGACY_VERSION,
  LIMITS,
  coded,
  langOf,
  latticeCell,
  latticeOf,
  pickLabel,
  readModel,
  uiLang
});
