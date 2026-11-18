/* LivLiv Player 0.5.1, Apache-2.0, Copyright 2026 LivLiv. See LICENSE, NOTICE and UPSTREAM.md. */
var LivLivPlayer = (() => {
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

  // vendor/livliv-player/entry.ts
  var entry_exports = {};
  __export(entry_exports, {
    Player: () => Player,
    VERSION: () => VERSION
  });

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
  var FB_ANKLE = 0.5;
  var FB_GAIN = 0.7;
  var FB_WAIST = 0.5;
  var FB_ANKLE_BAND = [0, 0.3];
  var FB_CAM_SWAY = 3;
  var CROUCH_CAM = 0.04;
  var FB_HIP_SLIDE = 0.7;
  var FB_HIP_BACK = 0.35;
  var FB_HIP_IDLE = 0.035;
  var FB_HIP_K = 9;
  var FB_HIP_C = 4.2;
  var FB_HIP_REACH = 0.11;
  var FB_HIP_TILT = 2.2 * Math.PI / 180;
  var FB_SHOULDER_ANSWER = 0.5;
  var FB_HEM_LAG = 0.4;
  var FB_HEM_K = 16;
  var FB_HEM_C = 3.2;
  var FB_HEM_WIND = 0.018;
  var FB_HEM_MAX = 0.3;
  function fullBody(A, canvas) {
    const B = A.body, fw = Math.max(1, A.face[2] - A.face[0]);
    const hx = (B.hip_l[0] + B.hip_r[0]) / 2, hy = (B.hip_l[1] + B.hip_r[1]) / 2;
    const ankleY = Math.max(hy + 1, Math.min(B.ankle_l[1], B.ankle_r[1]));
    const ax = (B.ankle_l[0] + B.ankle_r[0]) / 2, ay = (B.ankle_l[1] + B.ankle_r[1]) / 2;
    const F = A.frame ?? [0, 0, canvas[0], canvas[1]];
    const knees = [B.knee_l, B.knee_r].filter((k) => !!k && k[2] >= 0.3 && k[1] > hy && k[1] < ankleY);
    const kneeY = knees.length ? knees.reduce((s, k) => s + k[1], 0) / knees.length : hy + 0.5 * (ankleY - hy);
    return { hx, hy, ankleY, ax, ay, groundY: B.ground_y, fw, uw: F[2] - F[0], uh: F[3] - F[1], kneeY };
  }
  function fitBox(fit, A, canvas, fb) {
    const F = A.frame;
    if (!F || fit === "whole") return null;
    if (fit === "frame" || !fb) return F;
    const y0 = F[1], y1 = Math.min(canvas[1], fb.kneeY + 0.18 * (fb.ankleY - fb.kneeY));
    if (!(y1 - y0 > F[3] - F[1])) return F;
    const cx = (F[0] + F[2]) / 2, w = (y1 - y0) * (F[2] - F[0]) / (F[3] - F[1]);
    return [cx - w / 2, y0, cx + w / 2, y1];
  }

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
    const A = m.anchors, hd = A?.head, inRange2 = (v) => num(v) && Math.abs(v) <= BIG;
    if (!hd || ![hd.cx, hd.cy, hd.rx, hd.ry, A.neck_y, A.top_y, A.bottom_y, A.hair_root_y].every(inRange2) || !(hd.rx > 1e-3 && hd.ry > 1e-3) || !Array.isArray(A.face) || A.face.length !== 4 || !A.face.every(inRange2)) bad("its anchors are missing or not numbers");
    const sane = (v, what) => {
      if (v != null && !inRange2(v)) bad(`${what} is not a number in range`);
    };
    const nums = (v, lo, hi, what) => {
      if (v == null) return;
      if (!Array.isArray(v) || v.length < lo || v.length > hi || !v.every(inRange2)) bad(`${what} is not a list of ${lo} to ${hi} numbers`);
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
      if (!inRange2(B.ground_y)) bad("anchors.body.ground_y is not a number in range");
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

  // vendor/livliv-player/src/anchors.ts
  function projectedAnchor(center, right, heightOverWidth) {
    const dx = right[0] - center[0], dy = (right[1] - center[1]) * heightOverWidth;
    return { x: center[0], y: center[1], rotation: Math.atan2(dy, dx), scale: Math.hypot(dx, dy) * 2 };
  }

  // vendor/livliv-player/src/runtime/params.ts
  var defaultParams = () => ({
    angleX: 0,
    angleY: 0,
    angleZ: 0,
    eyeLOpen: 1,
    eyeROpen: 1,
    eyeBallX: 0,
    eyeBallY: 0,
    browLY: 0,
    browRY: 0,
    mouthOpen: 0,
    smile: 0,
    vowel: 0,
    bodyX: 0,
    bodyZ: 0,
    breath: 0
  });
  var PARAM_RANGES = {
    angleX: [-30, 30],
    angleY: [-30, 30],
    angleZ: [-30, 30],
    eyeLOpen: [0, 1],
    eyeROpen: [0, 1],
    eyeBallX: [-1, 1],
    eyeBallY: [-1, 1],
    browLY: [-1, 1],
    browRY: [-1, 1],
    mouthOpen: [0, 1],
    smile: [0, 1],
    vowel: [-1, 1],
    bodyX: [-10, 10],
    bodyZ: [-10, 10],
    breath: [0, 1]
  };
  var smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // vendor/livliv-player/src/runtime/puppet.ts
  var defaultRig = () => ({
    yaw: 0.27,
    pitch: 0.22,
    roll: 0.5,
    bulge: 0.6,
    hair: { front: [140, 11, 0.022, 70, 7], back: [48, 5.5, 0.06, 24, 3.5] },
    hair_limit: 0.25,
    wind: 1,
    breath: 1,
    sway: 1,
    brow: 0.06,
    body: { yaw: 0.35, roll: 0.3, breath: 1, bust: 0 }
  });
  var defaultTuning = () => ({ turn: 1, nod: 1, hair: 1, blink: 1, expr: 1, mouth: 1, breath: 1, gaze: 1 });
  var FRINGE_MAX = 0.3;
  function fringeScale(d, k) {
    const f = typeof k === "number" && Number.isFinite(k) && k >= 0 ? k : 1;
    if (f === 1 || !(d > 0)) return 1;
    return Math.min(Math.max(d, FRINGE_MAX), d * f) / d;
  }
  var VS = `#version 300 es
in vec2 aPos; in vec2 aUv; uniform vec4 uView; out vec2 vUv;
void main(){ vUv=aUv; vec2 p=aPos*uView.xy+uView.zw; gl_Position=vec4(p.x,-p.y,0.,1.); }`;
  var FS = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; uniform float uAlpha; uniform float uCut; out vec4 o;
uniform int uMode; uniform sampler2D uMask; uniform highp ivec2 uMaskOff; uniform vec4 uMaskSel; uniform float uSoft;
void main(){ vec4 c=texture(uTex,vUv); if(c.a<uCut) discard;
  if(uMode==1){ o=vec4(c.a); return; }
  if(uMode==2){ highp ivec2 q=ivec2(gl_FragCoord.xy)-uMaskOff, n=textureSize(uMask,0);
    float m=all(greaterThanEqual(q,ivec2(0)))&&all(lessThan(q,n))?dot(texelFetch(uMask,q,0),uMaskSel):0.;
    c*=mix(step(.5,m),m,uSoft); }
  o=c*uAlpha; }`;
  var MOUTH_AT = [0.12, 0.5];
  var MOUTH_HYST = 0.04;
  var MOUTH_HOLD = 0.055;
  var NECK_SHADOW = 0.3;
  var VOWEL_IN = 0.65;
  var VOWEL_OUT = 0.35;
  var TALK_LATCH = 0.4;
  var interp = (xs, ys, x) => {
    if (x <= xs[0]) return ys[0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[ys.length - 1];
  };
  var browWx = (b, x) => 1 - smooth(0, (b[2] - b[0]) * 0.45, Math.max(b[0] - x, x - b[2], 0));
  var browUp = (b) => (b[3] - b[1]) * 1.6 + 6;
  function browWeight(b, line, x, y) {
    if (y < b[1]) return browWx(b, x) * (1 - smooth(0, browUp(b), b[1] - y));
    const bot = interp(line.x, line.bottom, x);
    return y <= bot ? browWx(b, x) : browWx(b, x) * (1 - smooth(bot, interp(line.x, line.lid, x), y));
  }
  function browLimits(A, amp) {
    let up = amp, down = amp, any = false;
    A.brows?.forEach((b, side) => {
      const line = A.brow_lines?.[side];
      if (!b || !line) return;
      any = true;
      up = Math.min(up, 0.6 * browUp(b));
      line.x.forEach((x, k) => {
        down = Math.min(down, 0.6 * (line.lid[k] - line.bottom[k]) / Math.max(1e-3, browWx(b, x)));
      });
    });
    return any ? [up, down] : [0, 0];
  }
  var spring = () => ({ x: 0, y: 0, vx: 0, vy: 0 });
  var SIDE_AT = [0.5, 0.85];
  var Puppet = class {
    gl;
    canvas;
    model;
    anchorModel = null;
    layers = [];
    byId = /* @__PURE__ */ new Map();
    params = defaultParams();
    prog;
    uView;
    uAlpha;
    uTex;
    uCut;
    uMode;
    uMaskOff;
    uMaskSel;
    uSoft;
    /** softIris: the whites of the eyes whose iris moved, drawn as they show this frame over the eyes' box (a channel
     *  each), and that box's size as allocated (it only grows) */
    maskFb = null;
    maskTex = null;
    maskSize = [0, 0];
    /** per hair group a 2-segment chain [root->mid, mid->tip]: the bangs', long hair's (side hair takes either by where it
     *  lies, place()'s f), and the side hair's when the rig has one (rig.hair.side) */
    chains = { front: [spring(), spring()], back: [spring(), spring()], side: [spring(), spring()] };
    lastHead = { x: 0, y: 0, roll: 0 };
    /** rig.hair_drive's pivot: the face's centre on the head, its smoothed velocity and acceleration (model px, s) */
    drive = { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, started: false };
    /** smoothed torso pose (degrees): the body lags the head */
    body = { yaw: 0, roll: 0 };
    /** chest spring: position / velocity, relative to the chest anchor's rigid motion */
    bust = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 };
    time = 0;
    background = [0, 0, 0, 0];
    zoom = 1;
    panY = 0;
    /** where the user put the character, on top of zoom / panY: x, y as shares of the canvas width / height (y up), s a
     *  scale around the canvas center (dragging and zooming in the live window) */
    view = { x: 0, y: 0, s: 1 };
    /** automatic movement on top of that, same units (talking hops, head position, actions). It never lifts a bottom
     *  edge the drawing is cut off at (half-body characters) above where `view` alone puts it: render() moves the
     *  picture down by whatever it would show */
    move = { x: 0, y: 0, s: 1 };
    /** the drawing reaches its bottom edge (cut off there): set on load from anchors.bottom_y (never on a full-body model) */
    cutBottom = false;
    /** what the camera fits into the view on a full-body model: its head-chest frame (the default, as a half-body
     *  picture), the whole figure, or down to the knees. A model without anchors.frame always fits its canvas */
    fit = "frame";
    /** full-body models: the crouch and the talking dip automatic movement asks for (setMove; shares of the frame's
     *  height, <= 0). The crouch drops the hips, the legs shorten as straight lines and the feet stay; the dip lowers
     *  only what is above the waist band */
    crouch = 0;
    dip = 0;
    /** full-body models: the share of the hips' slow shift of weight (0: they stay still); physicsScale scales
     *  all of the hips' and the hem's motion */
    fbIdle = 1;
    /** the model stands on a ground line (anchors.body): automatic movement keeps its feet there */
    get grounded() {
      return !!this.fb;
    }
    fb = null;
    /** the hips' shift (model px) and its speed, their tilt (rad), the hem's spring (model px) */
    fbm = { hs: 0, hv: 0, tilt: 0, tanTilt: 0, hem: 0, hemV: 0, breath: 0 };
    /** body layers take the hips' tilt and the hem on top (deform sets it per layer; hair has its own chains) */
    fbParts = false;
    /** a full-body model's pose, worked out once per change (bodyOffset runs for every vertex): the waist's and the
     *  ankles' turns (rad, with their cos / sin), the hips' shift, the crouch and the dip (model px) */
    pv = { roll: NaN, cr: NaN, dp: NaN, mx: NaN, hs: NaN, tilt: NaN, aw: 0, cw: 1, sw: 0, aa: 0, ca: 1, sa: 0, x: 0, y: 0, dip: 0 };
    /** device pixels per CSS pixel at most (the power-saving mode draws at 1) */
    maxDpr = 2;
    /** draw at exactly this many pixels (a video's frame) instead of the canvas's size on the page */
    size = null;
    physicsScale = 1;
    hidden = /* @__PURE__ */ new Set();
    tuning = defaultTuning();
    /** the bangs layer's own depth (0: none), which the brows over them (alt) were weighted with: tuning.fringe scales it */
    bangsDepth = 0;
    rig = defaultRig();
    /** extra expression weights by layer param name (smile lives in params) */
    expr = {};
    /** displayed smile: eases toward params.smile so switching it never pops */
    smileShown = 0;
    /** mouth frame shown (0 the picture's own mouth, 1 half, 2 open, then round / wide / shut where the build has them, see vis): follows
     *  mouthOpen and vowel with hysteresis and a minimum hold, and switches at once. Any fade between two different
     *  drawings shows both half transparent (a pale double mouth), and while talking the frames change so often that a
     *  ~70 ms fade meant the mouth was nearly always mid-fade.
     *  mouthW: each frame's weight for the jaw, which eases after the frame in ~40 ms */
    mouthFrame = 0;
    mouthW = [1, 0, 0];
    mouthHeld = 1;
    /** loudness level (0 closed, 1 half, 2 open) and vowel shape of the frame shown: the states the hysteresis runs from */
    mouthAmp = 0;
    mouthShape = "";
    /** frame index of the round / wide mouth, when the build has them, and of the closed mouth a picture drawn with
     *  its mouth open talks with between syllables */
    vis = {};
    /** each frame's kind (closed, half, open, round, wide) and jaw drop (model px) */
    frameKind = ["closed", "half", "open"];
    frameJaw = [0, 0, 0];
    /** jaw drop for builds whose edits measured none (most in newer builds: the open edits rarely move the drawn jaw line), as a
     *  share of the face height at the open frame (half 0.45, round 0.7, wide 0.35 of it). 1.5 %: the chin line moves
     *  4-8 px, no gap at the neck on the 20 shown characters open / turned / tilted. 0 turns it off; set before load() */
    procJaw = 0.015;
    /** the chin as one piece while talking and nodding: the mouth frames hold
     *  the original lower face round the mouth (and on some builds the chin line): they follow the jaw like the face, the
     *  frame's own squeeze fading out toward the chin; the neck right under the chin follows the head and the jaw, so the
     *  drawn chin shadow stays under the chin. false: as before. Set before load() */
    chinFollow = true;
    /** how far below the chin the neck still follows the head, as a share of the face height (chinFollow) */
    chinNeck = 0.08;
    /** across, from the face's centre line: the neck follows fully within the first share of the face width and not at
     *  all past the second (chinFollow) */
    chinNeckX = [0.2, 0.34];
    /** the shoulders by the neck tilt with the head's roll this much, fading out within neckFollowY face heights
     *  below the neck line and from neckFollowX face widths across; 0: still, as before. Set before load() */
    neckFollow = 0.2;
    neckFollowY = 0.6;
    neckFollowX = [0.6, 1.3];
    /** time left of 'talking' (TALK_LATCH after the last half / open frame) */
    talkLeft = 0;
    /** center the view on the head (eval / close-up shots) */
    focusHead = false;
    /** the model's keyforms (param, value, and the tuning they were measured at); kfOff: the rig alone (while measuring
     *  it, and for side-by-side comparisons) */
    keys = [];
    /** keyforms.json's interp 'hermite': per key, the key on the other side of 0 of the same angle (-1: none) */
    kfPair = null;
    kfOff = false;
    /** each key's weight (Puppet.keys order) set by the caller instead of taken from the angle: a player switching
     *  between puppets of drawn views morphs each toward the other's layout over a fixed time */
    keyWeights = null;
    /** draw only the layers this accepts (a player composing one picture from several puppets: the hair of one, the face
     *  of another); null draws all */
    only = null;
    /** draw the mask layers (roles hole, edge, edge_wide: moved like any layer, never drawn otherwise) */
    masks = false;
    /** a half-closed eye squashes toward the closed lash its lid layer draws, column by column, on the models lidCurveFits
     *  allows; false: toward one height per eye on every model, as before (for comparisons). Set before load() */
    lidCurve = true;
    /** a half-closed eye covers the iris like a lid: the eye patch and its whites squash as before; the iris above
     *  the line they squash toward keeps its shape, drops irisDrop of the way its centre would have gone (the pupil
     *  stays in the slit) and goes under the upper lid, the part below squashes with the lower lid (its round bottom
     *  stays on the lower lash: cut there instead, a big iris came out a box at 45 %). Only irises with gaze travel: one
     *  without fills its eye (a chibi's bead, a mascot's pupil), and cut flat by an undrawn lid it read as a dark bar;
     *  it squashes whole, as before. false: every iris squashes with its patch, flat (for comparisons) */
    irisLid = true;
    irisDrop = 0.3;
    /** an iris off its eye patch (a glance, a blink) is cut by the whites' alpha, antialiased; false: by the 1-bit
     *  stencil at mask alpha 0.5 everywhere, stepped along the cut (for comparisons). At rest it is the
     *  stencil either way, so the rest pose stays as built */
    softIris = true;
    /** a look toward the nose stops the iris's inner edge at the drawn inner corner, where the whites end: past it
     *  the whites' straight end cut the iris. Its far edge travels on, so the iris narrows as an eyeball
     *  turning does, to irisNasalNarrow of its width at most, and then stops whole (1: stops whole at the corner, the eyes
     *  diverge). Outward, up and down as before; false: the build's travel both ways (for comparisons) */
    irisNasal = true;
    irisNasalNarrow = 0.7;
    /** per eye side (L / R): its iris's room toward the nose, measured at load */
    nasal = {};
    /** the model's swinging pieces (rig.chains), simulated in update() */
    chainRuns = [];
    /** a model with swinging chains (rig.chains): its highlights follow the gaze and sparkle */
    get chained() {
      return this.chainRuns.length > 0;
    }
    /** multi-view players (one puppet per drawn view): leave out the body (a side view drawn over the front one keeps the
     *  front's torso) or everything but the body (the front's head once the side view has taken over) */
    bodyHidden = false;
    headHidden = false;
    /** the last frame's view transform (render): scale x / y, offset x / y in clip space, and the drawing buffer size */
    lastView = [1, 1, 0, 0, 1, 1];
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true, stencil: true });
      if (!gl) throw new Error("this browser has no WebGL2");
      this.gl = gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.bindAttribLocation(p, 1, "aUv");
      gl.linkProgram(p);
      this.prog = p;
      this.uView = gl.getUniformLocation(p, "uView");
      this.uAlpha = gl.getUniformLocation(p, "uAlpha");
      this.uTex = gl.getUniformLocation(p, "uTex");
      this.uCut = gl.getUniformLocation(p, "uCut");
      this.uMode = gl.getUniformLocation(p, "uMode");
      this.uMaskOff = gl.getUniformLocation(p, "uMaskOff");
      this.uMaskSel = gl.getUniformLocation(p, "uMaskSel");
      this.uSoft = gl.getUniformLocation(p, "uSoft");
      gl.useProgram(p);
      gl.uniform1i(gl.getUniformLocation(p, "uMask"), 1);
    }
    /** baseUrl: the model's folder, or its model.json (the SDK: any name ending in .json); the images are read relative to
     *  it. png: load the lossless layer PNGs even where a WebP copy exists (eval: rest-pose PSNR is scored against the
     *  source, and quality-92 WebP alone costs 1.3–6.4 dB on line art). pack: try the server's textures.bin first (an
     *  exported package has none: the SDK turns it off rather than ask for it and get a 404). signal: calls the load off
     *  until the model starts going in, which then happens at once and whole; it rejects with the signal's reason and the
     *  model before stays. onImage: each image that has come in, of how many */
    async load(baseUrl, { png = false, pack: usePack = true, signal, onImage } = {}) {
      const { file, base, query } = locate(baseUrl);
      const r = await fetch(file + (query ? `?${query}` : ""), { cache: "no-store", signal });
      if (!r.ok) throw Object.assign(new Error(r.status === 404 ? "model not found" : `model.json ${r.status}`), { status: r.status });
      const text = await r.text();
      if (text.length > LIMITS.modelJson) throw coded("too-large", `model.json is larger than ${LIMITS.modelJson} bytes`);
      const model = readModel(JSON.parse(text));
      let tag = model.tex;
      if (!tag) {
        const sig = JSON.stringify(model.layers) + (r.headers.get("last-modified") || "");
        let h = 0;
        for (let i = 0; i < sig.length; i++) h = h * 31 + sig.charCodeAt(i) | 0;
        tag = (h >>> 0).toString(36);
      }
      const v = `?v=${tag}${query ? `&${query}` : ""}`;
      const keyforms = model.keyforms ? fetch(base + model.keyforms + v, { signal }).then(async (k) => {
        const t = k.ok ? await k.text() : "";
        return t && t.length <= LIMITS.keyforms ? JSON.parse(t) : void 0;
      }).catch(() => void 0) : void 0;
      const pack = png || !usePack ? null : await loadPack(packUrl(baseUrl, tag), signal);
      const fetched = (f) => signal ? fetchImage(base + f + v, signal) : loadImage(base + f + v);
      await this.loadModel(model, (f) => {
        const b = pack?.get(f);
        return b ? loadBlob(b) : fetched(f);
      }, { png, keyforms, signal, onImage });
    }
    /** a model from anywhere (the SDK: files the user picked): its model.json, and each image it names by its path there */
    async loadModel(raw, image, { png = false, keyforms: keyformsComing, signal, onImage } = {}) {
      const model = readModel(raw);
      let asked = 0, came = 0;
      const arrived = (i) => {
        onImage?.(++came, asked);
        return i;
      };
      const [imgs, keyforms] = await Promise.all([Promise.all(model.layers.map(async (L) => {
        const load = (p) => {
          asked++;
          return image(L.webp && !png ? p.replace(/\.png$/, ".webp") : p).then(arrived);
        };
        const [main, frames, mask, talk, brows] = await Promise.all([
          load(L.texture),
          Promise.all((L.frames || []).map(load)),
          L.mask ? load(L.mask) : void 0,
          L.talk ? load(L.talk) : void 0,
          L.brow_tex ? load(L.brow_tex) : void 0
        ]);
        return { main, frames, mask, talk, brows };
      })), keyformsComing]);
      if (signal?.aborted) throw signal.reason;
      const most = Math.min(LIMITS.texture, this.gl?.getParameter(this.gl.MAX_TEXTURE_SIZE) || LIMITS.texture);
      let texels = 0;
      for (const im of imgs) for (const i of [im.main, ...im.frames, im.mask, im.talk, im.brows]) {
        if (!i) continue;
        const w = i.naturalWidth || i.width, h = i.naturalHeight || i.height;
        if (w > most || h > most || (texels += w * h) > LIMITS.texels) {
          throw coded("too-large", `this model's images are too large (${w} x ${h}: ${most} px a side and ${LIMITS.texels} pixels in all at most)`);
        }
      }
      this.install(model, imgs, keyforms);
    }
    /** the model in place of the one before, or, if anything throws on the way (its layers, its keyforms, the GPU out of
     *  memory), the one before exactly as it was: its layers on the GPU, every field, every spring. All in one go: no frame
     *  runs in between. The GPU holds both for that moment */
    install(model, imgs, keyforms) {
      const gl = this.gl;
      const before = {
        ...this,
        drive: { ...this.drive },
        chains: Object.fromEntries(Object.entries(this.chains).map(([g, c]) => [g, c.map((q) => ({ ...q }))]))
      };
      const built = [];
      for (let i = 0; i < 8 && gl.getError(); i++) ;
      try {
        this.build(model, imgs, keyforms, built);
        for (let i = 0, e; i < 8 && (e = gl.getError()); i++) {
          if (e === gl.OUT_OF_MEMORY) throw coded("too-large", "the GPU ran out of memory for this model");
        }
      } catch (e) {
        this.freeLayers(built);
        Object.assign(this, before);
        throw e;
      }
      this.freeLayers(before.layers);
      this.freeMask();
    }
    build(model, imgs, keyforms, built) {
      this.model = model;
      this.chainRuns = (model.rig?.chains || []).map(chainRun);
      const mouth = model.layers.find((L) => L.role === "mouth");
      this.frameKind = (mouth?.frames || ["", "", ""]).map((_, i) => mouth?.visemes?.[i] || ["closed", "half", "open"][i] || "");
      const J = model.anchors.jaw;
      this.frameJaw = this.frameKind.map((k) => J && k !== "closed" && (k !== "half" || J.open > 0) ? J[k] || 0 : 0);
      const procJaw = this.procJaw > 0 ? model.rig?.jaw ?? this.procJaw : 0;
      if (J && procJaw > 0 && !this.frameJaw.some((j) => j > 0)) {
        const fh = model.anchors.face[3] - model.anchors.face[1], amt = { half: 0.45, open: 1, round: 0.7, wide: 0.35 };
        this.frameJaw = this.frameKind.map((k) => procJaw * fh * (amt[k] ?? 0));
      }
      this.vis = {};
      this.frameKind.forEach((k, i) => {
        if (k === "round" || k === "wide" || k === "shut") this.vis[k] = i;
      });
      const fi = model.layers.findIndex((L) => L.group === "hair_front");
      const bangs = fi >= 0 ? { img: imgs[fi].main, def: model.layers[fi] } : void 0;
      this.bangsDepth = bangs?.def.depth ?? 0;
      model.layers.forEach((L, i) => built.push(this.buildLayer(
        L,
        imgs[i].main,
        imgs[i].frames,
        imgs[i].mask,
        imgs[i].talk,
        imgs[i].brows,
        L.id === "brows" || L.role === "expr_brows" || L.brow_tex ? bangs : void 0
      )));
      this.layers = built;
      this.byId = new Map(this.layers.map((l) => [l.def.id, l]));
      this.nasal = {};
      const eyes = model.anchors.eyes;
      if (eyes && eyes.length >= 2) {
        const mid = eyes.reduce((s, b) => s + (b[0] + b[2]) / 2, 0) / eyes.length;
        model.layers.forEach((I, i) => {
          const side = I.role?.startsWith("iris_") ? I.role.slice(5) : "";
          const j = I.clip ? model.layers.findIndex((E) => E.id === I.clip) : -1;
          const mask = j >= 0 ? imgs[j].mask : void 0;
          if (!side || !I.range || !mask || this.nasal[side]) return;
          const n = nasalRoom(imgs[i].main, I, mask, model.layers[j], mid > I.x + I.w / 2 ? 1 : -1);
          if (n) this.nasal[side] = n;
        });
      }
      if (this.lidCurve && lidCurveFits(model)) {
        for (const side of ["L", "R"]) {
          const i = model.layers.findIndex((L) => L.role === `lid_${side}`);
          const line = i >= 0 ? closedLashLine(imgs[i].main, model.layers[i]) : null;
          if (!line) continue;
          for (const L of this.layers) {
            if (L.def.role !== `eye_${side}` && L.def.role !== `iris_${side}` && L.def.role !== `shine_${side}`) continue;
            L.pivY = new Float32Array(L.rest.length / 2);
            for (let k = 0; k < L.pivY.length; k++) L.pivY[k] = line(L.rest[2 * k]);
            L.pivC = line(L.def.x + L.def.w / 2);
          }
        }
      }
      this.tuning = { ...defaultTuning(), ...model.tuning || {} };
      this.rig = {
        ...defaultRig(),
        ...model.rig || {},
        hair: { ...defaultRig().hair, ...model.rig?.hair || {} },
        body: { ...defaultRig().body, ...model.rig?.body || {}, bust: 0 }
      };
      this.expr = {};
      this.resetMouth();
      this.talkLeft = 0;
      this.fb = model.anchors.body ? fullBody(model.anchors, model.canvas) : null;
      this.cutBottom = !this.fb && model.anchors.bottom_y >= model.canvas[1] - 4;
      this.resetPhysics();
      this.keys = [];
      this.kfPair = null;
      if (keyforms && keyformsFit(keyforms)) this.prepareKeyforms(keyforms);
      else if (keyforms) console.warn("LivLiv: keyforms.json is not one this player reads; the character plays on the rig alone");
    }
    /** each key pose's fields, as a per-vertex offset from the rig's own pose at that key: measured once here with the
     *  springs at rest, the torso settled and the face neutral, so at the key the character stands exactly as in the clip
     *  and everything else (physics, blinks, mouth, brows, roll) keeps moving on top of it */
    prepareKeyforms(K) {
      const seen = /* @__PURE__ */ new Map();
      const bytes = (b64) => {
        let out = seen.get(b64);
        if (!out) {
          const text = atob(b64);
          out = new Uint8Array(text.length);
          for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
          seen.set(b64, out);
        }
        return out;
      };
      const save = {
        params: this.params,
        body: { ...this.body },
        bust: { ...this.bust },
        mouthW: this.mouthW,
        smile: this.smileShown,
        chains: Object.values(this.chains).map((c) => c.map((q) => ({ ...q })))
      };
      const B = this.rig.body, tt = this.tuning.turn;
      K.keys.forEach((key, ki) => {
        const P = { ...defaultParams(), [key.param]: key.value };
        this.params = P;
        this.body = { yaw: P.bodyX + P.angleX * B.yaw * tt, roll: P.bodyZ + P.angleZ * this.rig.body.roll * tt };
        for (const c of Object.values(this.chains)) for (const q of c) Object.assign(q, spring());
        Object.assign(this.bust, { x: 0, y: 0, vx: 0, vy: 0 });
        this.mouthW = [1, 0, 0];
        this.smileShown = 0;
        this.kfOff = true;
        this.deform();
        this.kfOff = false;
        for (const L of this.layers) {
          const has = (f2) => !!key.fields[f2] || !!key.same?.includes(f2);
          const g = Object.hasOwn(key.fields, L.def.id) ? L.def.id : L.def.group === "head" ? "head" : L.def.group.startsWith("hair") ? "hair" : L.def.group === "body" && has("torso") ? "torso" : L.def.id;
          const b64 = key.fields[g] ?? (key.same?.includes(g) ? key.fields.head : void 0);
          L.kf ||= [];
          if (!b64) {
            L.kf[ki] = null;
            continue;
          }
          const raw = bytes(b64);
          const f = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1);
          const m = K.mask?.[g] ? bytes(K.mask[g]) : void 0;
          const d = new Float32Array(L.rest.length);
          for (let i = 0; i < d.length; i += 2) {
            const [dx, dy] = sampleField(f, K, L.rest[i], L.rest[i + 1]);
            const w = m ? sampleMask(m, K, L.rest[i], L.rest[i + 1]) : 1;
            d[i] = (L.rest[i] + dx - L.out[i]) * w;
            d[i + 1] = (L.rest[i + 1] + dy - L.out[i + 1]) * w;
          }
          L.kf[ki] = d;
        }
        const nod = key.param === "angleY";
        this.keys.push({ param: key.param, value: key.value, scale: tt * (nod ? this.tuning.nod : 1) / (K.turn * (nod ? K.nod : 1)) });
      });
      this.params = save.params;
      this.body = save.body;
      Object.assign(this.bust, save.bust);
      this.mouthW = save.mouthW;
      this.smileShown = save.smile;
      Object.values(this.chains).forEach((c, i) => c.forEach((q, j) => Object.assign(q, save.chains[i][j])));
      this.kfPair = K.interp === "hermite" ? this.keys.map((k) => this.keys.findIndex((o) => o.param === k.param && k.param !== "diag" && o.value === -k.value)) : null;
    }
    dispose() {
      this.anchorModel = null;
      this.freeLayers(this.layers);
      this.freeMask();
      this.layers = [];
    }
    freeLayers(layers) {
      const gl = this.gl;
      for (const L of layers) {
        gl.deleteTexture(L.tex);
        L.frames.forEach((t) => gl.deleteTexture(t));
        if (L.mask) gl.deleteTexture(L.mask);
        if (L.talk) gl.deleteTexture(L.talk);
        if (L.browTex) gl.deleteTexture(L.browTex);
        gl.deleteVertexArray(L.vao);
        gl.deleteBuffer(L.pos);
        gl.deleteBuffer(L.uvs);
        gl.deleteBuffer(L.tris);
      }
    }
    freeMask() {
      const gl = this.gl;
      if (this.maskFb) {
        gl.deleteFramebuffer(this.maskFb);
        gl.deleteTexture(this.maskTex);
        this.maskFb = this.maskTex = null;
        this.maskSize = [0, 0];
      }
    }
    texture(img) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      } catch (e) {
        gl.deleteTexture(t);
        throw e;
      }
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    buildLayer(L, img, frames, mask, talk, brows, bangs) {
      const gl = this.gl;
      const A = this.model.anchors;
      const browLayer = this.model.layers.some((l) => l.id === "brows");
      const cell = latticeOf(this.model);
      const gx0 = Math.floor(L.x / cell), gy0 = Math.floor(L.y / cell);
      const cols = Math.ceil((L.x + L.w) / cell) - gx0, rows = Math.ceil((L.y + L.h) / cell) - gy0;
      const occ = alphaGrid([img, ...frames], cols, rows, (L.x - gx0 * cell) / cell, (L.y - gy0 * cell) / cell, L.w / cell, L.h / cell);
      const vid = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
      const pos = [], uv = [], idx = [];
      const vert = (c, r) => {
        const k = r * (cols + 1) + c;
        if (vid[k] < 0) {
          vid[k] = pos.length / 2;
          const X = (gx0 + c) * cell, Y = (gy0 + r) * cell;
          pos.push(X, Y);
          uv.push((X - L.x) / L.w, (Y - L.y) / L.h);
        }
        return vid[k];
      };
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!occ[r * cols + c]) continue;
        const a = vert(c, r), b = vert(c + 1, r), d = vert(c, r + 1), e = vert(c + 1, r + 1);
        idx.push(a, b, d, b, e, d);
      }
      const n = pos.length / 2;
      const rest = new Float32Array(pos);
      const wHead = new Float32Array(n), wPhys1 = new Float32Array(n), wPhys2 = new Float32Array(n);
      const dep = new Float32Array(n), wBrow = new Float32Array(n), browSide = new Int8Array(n).fill(-1), wFront = new Float32Array(n);
      const browCap = new Float32Array(n).fill(Infinity);
      const wJaw = new Float32Array(n);
      const wNeck = this.neckFollow > 0 && L.group === "body" ? new Float32Array(n) : void 0;
      const NT = this.model.rig?.neck;
      const wTwist = NT && NT.twist > 0 && L.group === "body" ? new Float32Array(n) : void 0;
      const fol = bangs && (L.id === "brows" || L.role === "expr_brows") ? coverAt(img, L, bangs.img, bangs.def, rest, cell) : void 0;
      const folB = bangs && brows ? coverAt(brows, L, bangs.img, bangs.def, rest, cell) : void 0;
      const alt = fol || folB ? new Float32Array(5 * n) : void 0;
      const fw = A.face[2] - A.face[0];
      const h = A.head;
      const hairTop = A.neck_y - 0.1 * h.ry;
      const hairLen = Math.max(1, (A.body && A.hair_bottom_y != null ? A.hair_bottom_y : A.bottom_y) - hairTop);
      for (let i = 0; i < n; i++) {
        const x = rest[2 * i], y = rest[2 * i + 1];
        const rr = Math.hypot((x - h.cx) / h.rx, (y - h.cy) / h.ry);
        dep[i] = L.group === "head" ? L.depth : L.group === "hair_front" ? L.depth * smooth(L.fall_end ?? 1, L.fall ?? 0.55, rr) : L.depth * smooth(L.fall_end ?? 1, L.fall_end === void 0 ? 0.7 : L.fall ?? 0.7, rr);
        const longHead = 1 - smooth(A.neck_y + 0.05 * h.ry, A.neck_y + 1.1 * h.ry, y);
        const tl = Math.min(1, Math.max(0, (y - hairTop) / hairLen));
        const lp1 = smooth(0, 0.55, tl), lp2 = Math.pow(smooth(0.25, 1, tl), 1.3);
        const f = smooth(0.95, 0.7, rr) * (1 - smooth(A.neck_y - 0.2 * h.ry, A.neck_y + 0.3 * h.ry, y));
        const tb = smooth(A.hair_root_y + 0.25 * h.ry, h.cy + 0.7 * h.ry, y);
        if (L.group === "head") wHead[i] = 1;
        else if (L.group === "body") wHead[i] = 0;
        else {
          wHead[i] = f + (1 - f) * longHead;
          wPhys1[i] = f * tb + (1 - f) * lp1;
          wPhys2[i] = f * tb * tb + (1 - f) * lp2;
          wFront[i] = f;
          if (L.group === "hair_inner") {
            wHead[i] *= 0.5;
            wPhys1[i] *= 0.35;
            wPhys2[i] *= 0.35;
          }
        }
        if (alt && bangs) {
          const k = 5 * i;
          alt[k] = bangs.def.depth * smooth(1, bangs.def.fall ?? 0.55, rr);
          alt[k + 1] = f + (1 - f) * longHead;
          alt[k + 2] = f * tb + (1 - f) * lp1;
          alt[k + 3] = f * tb * tb + (1 - f) * lp2;
          alt[k + 4] = f;
        }
        const hairFront = L.group === "hair_side" || L.group === "hair_front";
        const mouthCopy = this.chinFollow && L.role === "mouth";
        if ((L.id === "face" || L.role === "expr" || hairFront || mouthCopy || L.role === "neck_shadow") && A.jaw && this.frameJaw.some((j) => j > 0)) {
          const vy = smooth(A.jaw.top - 0.02 * h.ry, A.jaw.chin, y) * (hairFront ? 1 - smooth(A.jaw.chin, A.jaw.chin + 0.15 * h.ry, y) : 1);
          const vx = 1 - smooth(0.22 * fw, 0.5 * fw, Math.abs(x - h.cx));
          wJaw[i] = vy * vx;
        }
        if (L.role === "neck_shadow" && A.jaw) {
          const k = 1 - smooth(A.jaw.chin, A.jaw.chin + NECK_SHADOW * (A.face[3] - A.face[1]), y);
          wHead[i] = k;
          wJaw[i] *= k;
        }
        if (this.chinFollow && L.group === "body" && A.jaw) {
          const fh = A.face[3] - A.face[1];
          const wy = 1 - smooth(A.jaw.chin, A.jaw.chin + this.chinNeck * fh, y);
          const wx = 1 - smooth(this.chinNeckX[0] * fw, this.chinNeckX[1] * fw, Math.abs(x - h.cx));
          const w = wy * wx;
          if (w > 0) {
            wHead[i] = w;
            if (this.frameJaw.some((j) => j > 0)) {
              const vy = smooth(A.jaw.top - 0.02 * h.ry, A.jaw.chin, y);
              wJaw[i] = vy * (1 - smooth(0.22 * fw, 0.5 * fw, Math.abs(x - h.cx))) * w;
            }
          }
        }
        if (wNeck) {
          const fh = A.face[3] - A.face[1];
          wNeck[i] = Math.max(0, this.neckFollow * (1 - smooth(A.neck_y, A.neck_y + this.neckFollowY * fh, y)) * (1 - smooth(this.neckFollowX[0] * fw, this.neckFollowX[1] * fw, Math.abs(x - h.cx))) - wHead[i]);
        }
        if (wTwist && NT) {
          const fh = A.face[3] - A.face[1], cy = A.jaw?.chin ?? A.neck_y;
          wTwist[i] = Math.max(0, NT.twist * (1 - smooth(cy, cy + (NT.reach ?? 0.45) * fh, y)) * (1 - smooth(this.chinNeckX[0] * fw, this.chinNeckX[1] * fw, Math.abs(x - h.cx))) - wHead[i]);
        }
        if (A.brows && L.group === "head" && !(L.role || "").startsWith("iris_") && (!browLayer || L.id === "brows")) {
          A.brows.forEach((b, side) => {
            const line = A.brow_lines?.[side];
            if (!b || !line) return;
            const w = browWeight(b, line, x, y);
            if (w > wBrow[i]) {
              wBrow[i] = w;
              browSide[i] = side;
              browCap[i] = line.cap ? interp(line.x, line.cap, x) : Infinity;
            }
          });
        }
      }
      const skin = L.bones?.length ? this.skinOf(L.bones, rest) : void 0;
      if (skin && !L.bones.every((id) => this.chainRuns.find((c) => c.def.id === id)?.def.reach !== void 0)) {
        wPhys1.fill(0);
        wPhys2.fill(0);
      }
      if (L.rigid) {
        wPhys1.fill(0);
        wPhys2.fill(0);
      }
      const altSkin = alt && bangs?.def.bones?.length ? this.skinOf(bangs.def.bones, rest) : void 0;
      if (alt && altSkin) for (let i = 0; i < n; i++) {
        alt[5 * i + 2] = 0;
        alt[5 * i + 3] = 0;
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const pb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb);
      gl.bufferData(gl.ARRAY_BUFFER, rest, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ub = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ub);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      const tri = new Uint32Array(idx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tri, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const made = [];
      const texture = (i) => {
        const t = this.texture(i);
        made.push(t);
        return t;
      };
      let tex, frameTex, maskTex, talkTex, browTex;
      try {
        tex = texture(img);
        frameTex = frames.map(texture);
        maskTex = mask && texture(mask);
        talkTex = talk && texture(talk);
        browTex = brows && texture(brows);
      } catch (e) {
        made.forEach((t) => gl.deleteTexture(t));
        gl.deleteVertexArray(vao);
        gl.deleteBuffer(pb);
        gl.deleteBuffer(ub);
        gl.deleteBuffer(ib);
        throw e;
      }
      return {
        def: L,
        tex,
        frames: frameTex,
        mask: maskTex,
        talk: talkTex,
        browTex,
        vao,
        pos: pb,
        uvs: ub,
        tris: ib,
        count: idx.length,
        rest,
        out: new Float32Array(rest.length),
        tri,
        tw: img.naturalWidth || img.width,
        th: img.naturalHeight || img.height,
        wHead,
        wPhys1,
        wPhys2,
        dep,
        wBrow,
        browSide,
        browCap,
        wFront,
        wJaw,
        wNeck,
        wTwist,
        fol,
        folB,
        alt,
        outB: folB ? new Float32Array(rest.length) : void 0,
        stencilRef: 0,
        soft: 0,
        maskCh: -1,
        skin,
        altSkin
      };
    }
    /** each vertex's place on the chains `ids` (rig.chains): its nearest point on each chain's line (segment, how far
     *  along), its offset from there, and a weight by distance (a Gaussian of sigma, normalised over the chains) */
    skinOf(ids, rest) {
      const cs = ids.map((id) => this.chainRuns.findIndex((c) => c.def.id === id)).filter((c) => c >= 0);
      if (!cs.length) return void 0;
      const n = rest.length / 2, B = cs.length;
      const S = {
        B,
        c: new Int16Array(n * B),
        seg: new Int16Array(n * B),
        t: new Float32Array(n * B),
        ux: new Float32Array(n * B),
        uy: new Float32Array(n * B),
        w: new Float32Array(n * B),
        sum: new Float32Array(n)
      };
      for (let i = 0; i < n; i++) {
        const x = rest[2 * i], y = rest[2 * i + 1];
        let sum = 0;
        cs.forEach((ci, b) => {
          const C = this.chainRuns[ci], R = C.R, m = R.length / 2;
          let best = Infinity, bk = 0, bt = 0;
          for (let k2 = 0; k2 < m - 1; k2++) {
            const ax = R[2 * k2], ay = R[2 * k2 + 1], dx = R[2 * k2 + 2] - ax, dy = R[2 * k2 + 3] - ay;
            const L2 = dx * dx + dy * dy || 1;
            let t = ((x - ax) * dx + (y - ay) * dy) / L2;
            if (k2 > 0) t = Math.max(0, t);
            if (k2 < m - 2) t = Math.min(1, t);
            const px2 = ax + dx * t, py2 = ay + dy * t, d = Math.hypot(x - px2, y - py2);
            if (d < best) {
              best = d;
              bk = k2;
              bt = t;
            }
          }
          const j = i * B + b, k = bk, tt = Math.min(1, bt);
          const px = R[2 * k] + (R[2 * k + 2] - R[2 * k]) * tt, py = R[2 * k + 1] + (R[2 * k + 3] - R[2 * k + 1]) * tt;
          const sg = C.def.sigma ?? 40;
          S.c[j] = ci;
          S.seg[j] = k;
          S.t[j] = bt;
          S.ux[j] = x - px;
          S.uy[j] = y - py;
          S.w[j] = Math.exp(-((best / sg) ** 2)) + 1e-6;
          sum += S.w[j];
        });
        let near = Infinity, reach = Infinity;
        for (let b = 0; b < B; b++) {
          const C = this.chainRuns[S.c[i * B + b]];
          S.w[i * B + b] /= sum;
          if (C.def.reach !== void 0) reach = Math.min(reach, C.def.reach);
          near = Math.min(near, Math.hypot(S.ux[i * B + b], S.uy[i * B + b]));
        }
        if (reach < Infinity) {
          const k = 1 - smooth(reach, 1.6 * reach, near);
          for (let b = 0; b < B; b++) S.w[i * B + b] *= k;
        }
        for (let b = 0; b < B; b++) S.sum[i] += S.w[i * B + b];
      }
      return S;
    }
    /** a vertex's offset from the chains bending it (world px), into o */
    skinOffset(S, i, o) {
      let ox = 0, oy = 0;
      if (S.sum[i] < 1e-4) {
        o[0] = 0;
        o[1] = 0;
        return;
      }
      for (let b = 0; b < S.B; b++) {
        const j = i * S.B + b, C = this.chainRuns[S.c[j]], k = S.seg[j];
        if (!C.moving) continue;
        const t = Math.min(1, Math.max(0, S.t[j])), e = S.t[j] < 0 ? 0 : 1;
        const dx = (C.disp[2 * k] + (C.disp[2 * k + 2] - C.disp[2 * k]) * t) * e;
        const dy = (C.disp[2 * k + 1] + (C.disp[2 * k + 3] - C.disp[2 * k + 1]) * t) * e;
        const be = (C.beta[k] + (C.beta[k + 1] - C.beta[k]) * t) * e;
        const c = Math.cos(be), s = Math.sin(be), ux = S.ux[j], uy = S.uy[j];
        const lx = dx + ux * c - uy * s - ux, ly = dy + ux * s + uy * c - uy;
        const cr = Math.cos(C.rho), sr = Math.sin(C.rho);
        ox += S.w[j] * (lx * cr - ly * sr);
        oy += S.w[j] * (lx * sr + ly * cr);
      }
      o[0] = ox;
      o[1] = oy;
    }
    /** where a chain's root is in the world and how far its frame is turned (rad), into o: [x, y, rho] */
    chainRoot(def, P, nb, o) {
      const [rx, ry] = def.points[0], A = this.model.anchors;
      if (def.attach === "body") {
        const b = [0, 0];
        this.bodyOffset(rx, ry, P, b);
        o[0] = rx + b[0];
        o[1] = ry + b[1];
        o[2] = this.fb ? this.fbTurn(ry) : this.body.roll * Math.PI / 180 * smooth(A.bottom_y, A.neck_y, ry);
      } else {
        const h = [0, 0];
        this.headXform(rx, ry, def.depth ?? 0, P, h);
        o[0] = h[0] + nb[0];
        o[1] = h[1] + nb[1];
        o[2] = P.angleZ * Math.PI / 180 * this.rig.roll * this.tuning.turn;
      }
    }
    /** how opaque an expression patch (or its brows) is drawn */
    exprAlpha(d) {
      return smooth(0.3, 0.7, d.param === "smile" || !d.param ? this.smileShown : this.expr[d.param] ?? 0);
    }
    /** a layer's opacity from its show / hide expressions (1 without them) */
    moodAlpha(d) {
      const sum = (m) => {
        let a = 0;
        for (const [k, v] of Object.entries(m || {})) a += v * this.exprValue(k);
        return Math.min(1, a);
      };
      return (d.show ? sum(d.show) : 1) * (d.hide ? 1 - sum(d.hide) : 1);
    }
    /** whether render() will draw the layer this frame (deform() skips the rest) */
    shown(L) {
      const d = L.def, role = d.role || "";
      if (this.hidden.has(d.id)) return false;
      if (d.group === "body" ? this.bodyHidden : this.headHidden) return false;
      if ((d.show || d.hide) && this.moodAlpha(d) <= 0.01) return false;
      if (role === "expr" || role === "expr_brows") return this.exprAlpha(d) > 0.01;
      if (role.startsWith("lid_")) return 1 - smooth(0.05, 0.35, role === "lid_L" ? this.params.eyeLOpen : this.params.eyeROpen) > 0.01;
      if (role === "blush") {
        let a = 0;
        for (const [k, v] of Object.entries(d.blush || {})) a += v * this.exprValue(k);
        return a > 0.01;
      }
      return true;
    }
    /** an expression's weight as shown (smile eases, the others are set by the page) */
    exprValue(param) {
      return param === "smile" ? this.smileShown : this.expr[param] ?? 0;
    }
    /** every chain one step: verlet rope pulled toward its drawn shape (counter-turned by the tilt as far as it hangs,
     *  bent by expressions, swayed by wind), thrown by its root's acceleration, its segments kept at length */
    stepChains(dt) {
      if (!this.chainRuns.length || dt <= 0) return;
      const P = this.params, A = this.model.anchors;
      const nb = [0, 0];
      this.bodyOffset(A.head.cx, A.neck_y, P, nb);
      const g = this.physicsScale * (this.tuning.hairBack ?? this.tuning.hair), r = [0, 0, 0];
      for (const C of this.chainRuns) {
        const d = C.def, R = C.R, p = C.p, q = C.q, m = R.length / 2;
        this.chainRoot(d, P, nb, r);
        if (!C.started) {
          C.W = [r[0], r[1]];
          C.V = [0, 0];
          C.acc = [0, 0];
          C.started = true;
        }
        const vx = (r[0] - C.W[0]) / dt, vy = (r[1] - C.W[1]) / dt;
        const ax = (vx - C.V[0]) / dt, ay = (vy - C.V[1]) / dt;
        C.W = [r[0], r[1]];
        C.V = [vx, vy];
        C.rho = r[2];
        const ks = Math.min(1, dt * 30);
        C.acc[0] += (ax - C.acc[0]) * ks;
        C.acc[1] += (ay - C.acc[1]) * ks;
        const cr = Math.cos(-C.rho), sr = Math.sin(-C.rho);
        const lax = C.acc[0] * cr - C.acc[1] * sr, lay = C.acc[0] * sr + C.acc[1] * cr;
        let bias = 0;
        for (const [k, v] of Object.entries(d.bias || {})) bias += v * this.exprValue(k);
        const turn = -C.rho * d.hang + bias * Math.PI / 180, ct = Math.cos(turn), st = Math.sin(turn);
        const f = d.freq ?? 0.5, wt = 2 * Math.PI * f * this.time + C.phase;
        const wind = d.wind * g * this.rig.wind * (Math.sin(wt) + 0.4 * Math.sin(1.7 * wt + 2 * C.phase));
        const damp = Math.max(0, 1 - d.damp * dt);
        for (let j = 1; j < m; j++) {
          const s = C.s[j], k = d.k[0] + (d.k[1] - d.k[0]) * s;
          const tx = R[2 * j] - R[0], ty = R[2 * j + 1] - R[1];
          const gx = R[0] + tx * ct - ty * st + wind * s, gy = R[1] + tx * st + ty * ct;
          const fx = k * (gx - p[2 * j]) - d.drive * g * lax, fy = k * (gy - p[2 * j + 1]) - d.drive * g * lay;
          const nx = p[2 * j] + (p[2 * j] - q[2 * j]) * damp + fx * dt * dt;
          const ny = p[2 * j + 1] + (p[2 * j + 1] - q[2 * j + 1]) * damp + fy * dt * dt;
          q[2 * j] = p[2 * j];
          q[2 * j + 1] = p[2 * j + 1];
          p[2 * j] = nx;
          p[2 * j + 1] = ny;
        }
        const lim = d.limit ?? Infinity;
        for (let j = 1; j < m; j++) {
          const dx = p[2 * j] - p[2 * j - 2], dy = p[2 * j + 1] - p[2 * j - 1], l = Math.hypot(dx, dy) || 1;
          p[2 * j] = p[2 * j - 2] + dx / l * C.len[j];
          p[2 * j + 1] = p[2 * j - 1] + dy / l * C.len[j];
          const ex = p[2 * j] - R[2 * j], ey = p[2 * j + 1] - R[2 * j + 1], e = Math.hypot(ex, ey);
          if (e > lim) {
            p[2 * j] = R[2 * j] + ex * lim / e;
            p[2 * j + 1] = R[2 * j + 1] + ey * lim / e;
          }
        }
        let mv = 0;
        for (let j = 0; j < m; j++) {
          C.disp[2 * j] = p[2 * j] - R[2 * j];
          C.disp[2 * j + 1] = p[2 * j + 1] - R[2 * j + 1];
          mv = Math.max(mv, Math.abs(C.disp[2 * j]), Math.abs(C.disp[2 * j + 1]));
        }
        C.moving = mv > 1e-3;
        const al = [];
        for (let k = 0; k < m - 1; k++) {
          const rx = R[2 * k + 2] - R[2 * k], ry = R[2 * k + 3] - R[2 * k + 1], cx = p[2 * k + 2] - p[2 * k], cy = p[2 * k + 3] - p[2 * k + 1];
          al.push(Math.atan2(rx * cy - ry * cx, rx * cx + ry * cy));
        }
        C.beta[0] = 0;
        for (let j = 1; j < m - 1; j++) C.beta[j] = 0.5 * (al[j - 1] + al[j]);
        C.beta[m - 1] = al[m - 2];
      }
    }
    // ---------------------------------------------------------------- rig
    /** the head's turn, nod and roll as sines and cosines: the same for every vertex of a frame, so worked out once per
     *  pose (it was six trig calls per vertex, the biggest part of a frame) */
    hxC = { ax: NaN, ay: NaN, az: NaN, t: NaN, n: NaN, ry: NaN, rp: NaN, rr: NaN, pe: NaN, cy: 1, sy: 0, cp: 1, sp: 0, cr: 1, sr: 0 };
    headTrig(P) {
      const c = this.hxC, R = this.rig, tt = this.tuning.turn, nd = this.tuning.nod ?? 1, pe = R.pitch_ease ?? 0.25;
      if (c.ax !== P.angleX || c.ay !== P.angleY || c.az !== P.angleZ || c.t !== tt || c.n !== nd || c.ry !== R.yaw || c.rp !== R.pitch || c.rr !== R.roll || c.pe !== pe) {
        const py = P.angleY / 30;
        const yaw = P.angleX / 30 * R.yaw * tt, pitch = py * (1 - pe * py * py) * R.pitch * tt * nd;
        const roll = P.angleZ * Math.PI / 180 * R.roll * tt;
        Object.assign(c, {
          ax: P.angleX,
          ay: P.angleY,
          az: P.angleZ,
          t: tt,
          n: nd,
          ry: R.yaw,
          rp: R.pitch,
          rr: R.roll,
          pe,
          cy: Math.cos(yaw),
          sy: Math.sin(yaw),
          cp: Math.cos(pitch),
          sp: Math.sin(pitch),
          cr: Math.cos(roll),
          sr: Math.sin(roll)
        });
      }
      return c;
    }
    headXform(x, y, depth, P, out) {
      const h = this.model.anchors.head;
      const u = (x - h.cx) / h.rx, v = (y - h.cy) / h.ry;
      const R = this.rig;
      const q = R.bulge_shape ?? 1;
      const E = R.bulge_extent;
      let ex = E ? E[0] : 1;
      if (E && E.length > 3 && v > 0) {
        const t = Math.min(1, v / (E[2] * (E[4] ?? 1)));
        ex += (E[3] - E[0]) * t * t * (3 - 2 * t);
      }
      const bu = E ? u / ex : u, bv = E ? v / (v < 0 ? E[1] : E[2]) : v;
      const bulge = R.bulge * Math.max(0, q === 1 ? 1 - bu * bu - bv * bv : 1 - Math.pow(bu * bu + bv * bv, q));
      const z = bulge + depth;
      const { cy, sy, cp, sp, cr, sr } = this.headTrig(P);
      let u2 = u * cy + z * sy;
      const z2 = -u * sy + z * cy;
      let v2 = v * cp - z2 * sp;
      const dr = R.drift;
      u2 += (dr ? dr[0] : 0.12) * sy;
      v2 -= (dr ? dr[1] : 0.08) * sp;
      let X = h.cx + u2 * h.rx, Y = h.cy + v2 * h.ry;
      const nx = h.cx, ny = this.model.anchors.neck_y;
      const dx = X - nx, dy = Y - ny;
      X = nx + dx * cr - dy * sr;
      Y = ny + dx * sr + dy * cr;
      out[0] = X;
      out[1] = Y;
    }
    /** rigid torso motion at (x, y): breathing, turn-follow, lean; plus the chest bump when `bust`. A full-body model
     *  (anchors.body) moves by fullBodyOffset instead */
    bodyOffset(x, y, P, out, bust = true) {
      if (this.fb) {
        this.fullBodyOffset(x, y, P, out, bust);
        return;
      }
      const A = this.model.anchors, h = A.head, B = this.rig.body;
      const t = smooth(A.bottom_y, A.neck_y, y);
      const fw = A.face[2] - A.face[0];
      const br = P.breath * this.tuning.breath * this.rig.breath * B.breath;
      let dx = (x - h.cx) * 0.01 * br * t;
      let dy = -br * 0.024 * h.ry * Math.pow(t, 1.3);
      const yaw = this.body.yaw / 30;
      const bw = 1.4 * fw;
      const u = Math.max(-1.6, Math.min(1.6, (x - h.cx) / bw));
      dx += yaw * bw * 0.16 * Math.pow(t, 1.2) * (1 - 0.18 * u * u) + yaw * (x - h.cx) * -0.04 * Math.sign(u) * t;
      const a = this.body.roll * Math.PI / 180 * t;
      if (a !== 0) {
        const px = h.cx, py = A.bottom_y + 0.4 * (A.bottom_y - A.neck_y);
        const rx = x - px, ry = y - py, c = Math.cos(a), s = Math.sin(a);
        dx += rx * (c - 1) - ry * s;
        dy += rx * s + ry * (c - 1);
      }
      const C = A.chest;
      if (C && bust) {
        const ux = (x - C.cx) / C.rx, uy = (y - C.cy) / C.ry, d = Math.sqrt(ux * ux + uy * uy);
        const w = 1 - smooth(0.2, 1.15, d);
        if (w > 0) {
          dy -= br * 0.012 * h.ry * w * (0.4 + B.bust);
          dx += this.bust.x * w;
          dy += this.bust.y * w;
        }
      }
      out[0] = dx;
      out[1] = dy;
    }
    /** the upper body's own motion at (x, y) on a full-body model, `t` of the way from the hips (0) to the neck (1):
     *  breathing and the turn-follow slide as bodyOffset has them (the slide FB_GAIN of it), and the waist's turn about
     *  the hips' midpoint by its weight `w` there (0 below the waist band, 1 above it: the upper body turns as one piece
     *  and stays straight) */
    upperOffset(x, y, t, w, P, out, bust, v = this.fbPose()) {
      const A = this.model.anchors, h = A.head, B = this.rig.body, fb = this.fb;
      const br = P.breath * this.tuning.breath * this.rig.breath * B.breath;
      let dx = (x - h.cx) * 0.01 * br * t;
      let dy = -br * 0.024 * h.ry * Math.pow(t, 1.3);
      const yaw = this.body.yaw / 30 * FB_GAIN;
      const bw = 1.4 * fb.fw;
      const u = Math.max(-1.6, Math.min(1.6, (x - h.cx) / bw));
      dx += yaw * bw * 0.16 * Math.pow(t, 1.2) * (1 - 0.18 * u * u) + yaw * (x - h.cx) * -0.04 * Math.sign(u) * t;
      if (v.aw !== 0 && w > 0) {
        const rx = x - fb.hx, ry = y - fb.hy;
        dx += (rx * (v.cw - 1) - ry * v.sw) * w;
        dy += (rx * v.sw + ry * (v.cw - 1)) * w;
      }
      const C = A.chest;
      if (C && bust) {
        const ux = (x - C.cx) / C.rx, uy = (y - C.cy) / C.ry, d = Math.sqrt(ux * ux + uy * uy);
        const wc = 1 - smooth(0.2, 1.15, d);
        if (wc > 0) {
          dy -= br * 0.012 * h.ry * wc * (0.4 + B.bust);
          dx += this.bust.x * wc;
          dy += this.bust.y * wc;
        }
      }
      out[0] = dx;
      out[1] = dy;
    }
    /** a full-body model's weight of the waist's turn (and the talking dip) at height y: 0 below the waist band, 1 above */
    fbWaist(y) {
      const fb = this.fb;
      return smooth(fb.hy + FB_WAIST * fb.fw, fb.hy - FB_WAIST * fb.fw, y);
    }
    /** ... and of the sway from the ankles: 0 at the ankles and below (the feet stay), 1 above the ankle band */
    fbAnkle(y) {
      const fb = this.fb;
      return smooth(fb.ankleY - FB_ANKLE_BAND[0] * fb.fw, fb.ankleY - FB_ANKLE_BAND[1] * fb.fw, y);
    }
    /** how far a full-body model's body is turned at height y (rad): the waist's turn and the ankles' by their weights */
    fbTurn(y) {
      const v = this.fbPose();
      return v.aw * this.fbWaist(y) + v.aa * this.fbAnkle(y);
    }
    /** a full-body model's pose (model px, rad), worked out again only when what it is made of changed: the lean
     *  (body.roll, FB_GAIN of it) split into the waist's turn (1 - FB_ANKLE, less the shoulders' answer to the hips'
     *  tilt) and the ankles' (FB_ANKLE), the webcam's sideways move added to the ankles' as the angle that moves the neck
     *  by move.x frame widths (at most about FB_CAM_SWAY), the hips' shift, the crouch and the dip */
    fbPose() {
      const v = this.pv, m = this.fbm;
      if (v.roll === this.body.roll && v.cr === this.crouch && v.dp === this.dip && v.mx === this.move.x && v.hs === m.hs && v.tilt === m.tilt) return v;
      const fb = this.fb, A = this.model.anchors;
      const lean = this.body.roll * FB_GAIN * Math.PI / 180, lim = FB_CAM_SWAY * Math.PI / 180;
      const cam = lim * Math.tanh(Math.atan2(this.move.x * fb.uw, Math.max(1, fb.ankleY - A.neck_y)) / lim);
      const aw = lean * (1 - FB_ANKLE) - FB_SHOULDER_ANSWER * m.tilt, aa = lean * FB_ANKLE + cam;
      v.roll = this.body.roll;
      v.cr = this.crouch;
      v.dp = this.dip;
      v.mx = this.move.x;
      v.hs = m.hs;
      v.tilt = m.tilt;
      v.aw = aw;
      v.cw = Math.cos(aw);
      v.sw = Math.sin(aw);
      v.aa = aa;
      v.ca = Math.cos(aa);
      v.sa = Math.sin(aa);
      v.x = m.hs;
      v.y = -this.crouch * fb.uh;
      v.dip = -this.dip * fb.uh;
      return v;
    }
    /** a full-body model's body motion at (x, y), the waist's part first, then the ankles':
     *  - the upper body's own motion (upperOffset: breathing and the turn-follow from the hips up, the waist's turn as one
     *    piece above the waist band);
     *  - the legs take the hips' shift and the crouch by a weight going straight from 1 at the hips to 0 at the ankles, so
     *    a leg stays a straight line and the feet stay; the talking dip moves only what is above the waist band;
     *  - body layers: the hips' tilt and the hem (partsOffset);
     *  - then everything above the ankle band turns about the ankles' midpoint (the legs lean as straight lines).
     *  Arms go by height: a hand hanging beside the thigh moves with the thigh */
    fullBodyOffset(x, y, P, out, bust) {
      const fb = this.fb, A = this.model.anchors;
      const t = smooth(fb.hy, A.neck_y, y), w = this.fbWaist(y), v = this.fbPose();
      this.upperOffset(x, y, t, w, P, out, bust, v);
      if (v.x !== 0 || v.y !== 0) {
        const wl = Math.min(1, Math.max(0, (fb.ankleY - y) / (fb.ankleY - fb.hy)));
        out[0] += v.x * wl;
        out[1] += v.y * wl;
      }
      if (v.dip !== 0) out[1] += v.dip * w;
      if (this.fbParts) this.partsOffset(x, y, out);
      if (v.aa !== 0) {
        const wa = this.fbAnkle(y);
        if (wa > 0) {
          const X = x + out[0] - fb.ax, Y = y + out[1] - fb.ay, top = fb.ankleY - FB_ANKLE_BAND[1] * fb.fw;
          const wl = Math.min(1, Math.max(0, (top - y) / Math.max(1, top - fb.hy)));
          out[0] += (X * (v.ca - 1) - Y * v.sa) * wa;
          out[1] += (X * v.sa * wl + Y * (v.ca - 1)) * wa;
        }
      }
    }
    /** what a full-body model's body layers take on top: the hips' tilt (its own band at the hips, and down the legs) and
     *  the hem (from a little above the hips, most at the hem line, gone a little below it), with a slow breath across
     *  its width */
    partsOffset(x, y, out) {
      const fb = this.fb, m = this.fbm, B = this.model.anchors.body, fw = fb.fw;
      if (m.tilt !== 0) {
        const below = Math.min(1, Math.max(0, (fb.ankleY - y) / Math.max(1, fb.ankleY - fb.hy)));
        const band = y < fb.hy ? smooth(fb.hy - 1.3 * fw, fb.hy - 0.2 * fw, y) : below;
        out[1] += m.tanTilt * (x - fb.hx) * band;
      }
      const top = fb.hy - 0.4 * fw;
      if (B.hem_y != null && y > top) {
        const hem = B.hem_y;
        const g = y <= hem ? Math.pow(Math.min(1, Math.max(0, (y - top) / Math.max(1, hem - top))), 1.6) : 1 - smooth(hem, hem + 0.45 * fw, y);
        if (g > 0) {
          const hx0 = B.hem_x ? (B.hem_x[0] + B.hem_x[1]) / 2 : fb.hx;
          out[0] += (m.hem + (x - hx0) * 0.012 * m.breath) * g;
        }
      }
    }
    /** a full-body model's springs, one sub-step: the hips follow the upper body and shift their weight a little by
     *  themselves, the hem hangs behind the hips and the sway. physicsScale scales all of it (0: they rest) */
    stepFb(dt) {
      const fb = this.fb, m = this.fbm, t = this.time, A = this.model.anchors, fw = fb.fw, k = this.physicsScale;
      const v = this.fbPose();
      const slide = this.body.yaw / 30 * FB_GAIN * 1.4 * fw * 0.16, leanMove = Math.sin(v.aw) * (fb.hy - A.neck_y);
      const idle = FB_HIP_IDLE * fw * (Math.sin(t * 2 * Math.PI / 8.6) * 0.75 + Math.sin(t * 2 * Math.PI / 3.9 + 1.1) * 0.25);
      const target = k * (FB_HIP_SLIDE * slide - FB_HIP_BACK * leanMove + this.fbIdle * idle);
      m.hv += (-FB_HIP_K * (m.hs - target) - FB_HIP_C * m.hv) * dt;
      m.hs += m.hv * dt;
      m.tilt = -FB_HIP_TILT * Math.max(-1.2, Math.min(1.2, m.hs / (FB_HIP_REACH * fw)));
      m.tanTilt = Math.tan(m.tilt);
      if (this.model.anchors.body.hem_y == null) return;
      m.breath = Math.sin(t * 1.7) * k;
      const push = -k * FB_HEM_LAG * (m.hs + (fb.ankleY - fb.hy) * Math.sin(v.aa) * 0.6);
      const wind = k * FB_HEM_WIND * fw * (Math.sin(t * 1.3) + 0.5 * Math.sin(t * 2.9 + 0.6));
      m.hemV += (-FB_HEM_K * (m.hem - push - wind) - FB_HEM_C * m.hemV) * dt;
      m.hem = Math.max(-FB_HEM_MAX * fw, Math.min(FB_HEM_MAX * fw, m.hem + m.hemV * dt));
    }
    /** torso lags the head; the chest spring lags the torso (only when the rig asks for it) */
    stepBody(dt) {
      const P = this.params, B = this.rig.body;
      const tt = this.tuning.turn;
      const ty = P.bodyX + P.angleX * B.yaw * tt, tr = P.bodyZ + P.angleZ * B.roll * tt;
      const k = Math.min(1, dt * 5);
      this.body.yaw += (ty - this.body.yaw) * k;
      this.body.roll += (tr - this.body.roll) * k;
      const C = this.model.anchors.chest;
      if (!C || B.bust <= 0) {
        this.bust.x = this.bust.y = 0;
        return;
      }
      const o = [0, 0];
      this.bodyOffset(C.cx, C.cy, P, o, false);
      const inv = 1 / Math.max(dt, 1e-4);
      const ax = (o[0] - this.bust.px) * inv, ay = (o[1] - this.bust.py) * inv;
      this.bust.px = o[0];
      this.bust.py = o[1];
      const s = B.bust * this.physicsScale;
      const K = 70, D = 7;
      this.bust.vx += (-K * this.bust.x - D * this.bust.vx - ax * 3.2 * s) * dt;
      this.bust.vy += (-K * this.bust.y - D * this.bust.vy - ay * 4.2 * s) * dt;
      this.bust.x += this.bust.vx * dt;
      this.bust.y += this.bust.vy * dt;
      const lim = 0.035 * this.model.anchors.head.ry * (0.5 + s);
      this.bust.x = Math.max(-lim, Math.min(lim, this.bust.x));
      this.bust.y = Math.max(-lim, Math.min(lim, this.bust.y));
    }
    /** automatic movement (the player's drivers and actions): the webcam's sideways move `x` and distance `s`, a talking bob `talkHop`
     *  (<= 0), an action's move `actY` (a hop: a crouch, then a flight) and the webcam's lean `camY`, as shares of the view
     *  (y up). A half-body model moves the picture by their sum, as `move` always has. A full-body model (anchors.body)
     *  keeps its feet on the ground line: the sideways move sways it from the ankles (fbPose; render() does not slide
     *  it), a hop's crouch and the webcam's lean down (at most CROUCH_CAM) crouch it, the talking bob dips only the upper
     *  body, only an action's flight lifts the whole figure, and a lean up is not followed (it would float) */
    setMove(x, s, talkHop, actY, camY) {
      this.move.x = x;
      this.move.s = s;
      if (!this.fb) {
        this.move.y = talkHop + actY + camY;
        this.crouch = 0;
        this.dip = 0;
        return;
      }
      this.move.y = Math.max(0, actY);
      this.crouch = Math.min(0, actY) + Math.max(-CROUCH_CAM, Math.min(0, camY));
      this.dip = Math.min(0, talkHop);
    }
    /** closed mouth, no hold pending (a new model, a test starting a clip) */
    resetMouth() {
      this.mouthFrame = 0;
      this.mouthAmp = 0;
      this.mouthShape = "";
      this.mouthHeld = 1;
      this.mouthW = this.frameKind.map((_, i) => i === 0 ? 1 : 0);
    }
    stepMouth(dt) {
      const m = Math.min(1, Math.max(0, this.params.mouthOpen)), v = Math.min(1, Math.max(-1, this.params.vowel || 0));
      const [t1, t2] = MOUTH_AT, h = MOUTH_HYST;
      this.mouthHeld += dt;
      let a = this.mouthAmp;
      if (a === 0 && m > t1 + h) a = m > t2 + h ? 2 : 1;
      else if (a === 1 && (m < t1 - h || m > t2 + h)) a = m < t1 - h ? 0 : 2;
      else if (a === 2 && m < t2 - h) a = m < t1 - h ? 0 : 1;
      let s = this.mouthShape;
      if (!s || (s === "round" ? v > -VOWEL_OUT : v < VOWEL_OUT)) s = v < -VOWEL_IN ? "round" : v > VOWEL_IN ? "wide" : "";
      let want = a > 0 && s && this.vis[s] !== void 0 ? this.vis[s] : a;
      if (want === 0 && this.talkLeft > 0 && this.vis.shut !== void 0) want = this.vis.shut;
      if (want === this.mouthFrame) {
        this.mouthAmp = a;
        this.mouthShape = s;
      } else if (this.mouthHeld >= MOUTH_HOLD) {
        this.mouthFrame = want;
        this.mouthAmp = a;
        this.mouthShape = s;
        this.mouthHeld = 0;
      }
      const f = this.mouthFrame;
      this.talkLeft = f > 0 && f !== this.vis.shut ? TALK_LATCH : Math.max(0, this.talkLeft - dt);
      const k = Math.min(1, dt * 28);
      for (let i = 0; i < this.mouthW.length; i++) this.mouthW[i] += ((i === f ? 1 : 0) - this.mouthW[i]) * k;
    }
    /** how far frame `i` is along with mouthOpen `m` (0..1): within a frame the opening keeps moving a little */
    frameEase(i, m) {
      const [t1, t2] = MOUTH_AT, kind = this.frameKind[i];
      return kind === "half" ? smooth(t1, t2, m) : kind === "open" ? smooth(t2, 1, m) : smooth(t1, 1, m);
    }
    stepPhysics(dt) {
      const P = this.params, A = this.model.anchors;
      const ht = [0, 0];
      this.headXform(A.head.cx, A.hair_root_y, 0, P, ht);
      const inv = 1 / Math.max(dt, 1e-4);
      const vx = (ht[0] - this.lastHead.x) * inv, vy = (ht[1] - this.lastHead.y) * inv;
      this.lastHead = { x: ht[0], y: ht[1], roll: P.angleZ };
      const D = this.rig.hair_drive, dv = this.drive;
      if (D) {
        const fp = [0, 0];
        this.headXform(A.head.cx, A.head.cy, 0, P, fp);
        if (!dv.started) Object.assign(dv, { x: fp[0], y: fp[1], vx: 0, vy: 0, ax: 0, ay: 0, started: true });
        const ks = Math.min(1, dt * 25);
        const svx = dv.vx + ((fp[0] - dv.x) * inv - dv.vx) * ks, svy = dv.vy + ((fp[1] - dv.y) * inv - dv.vy) * ks;
        dv.ax += ((svx - dv.vx) * inv - dv.ax) * ks;
        dv.ay += ((svy - dv.vy) * inv - dv.ay) * ks;
        Object.assign(dv, { x: fp[0], y: fp[1], vx: svx, vy: svy });
      }
      const R = this.rig;
      const cfg = { front: R.hair.front, back: R.hair.back, side: R.hair.side };
      const lim = A.head.ry * R.hair_limit;
      for (const key of R.hair.side ? ["front", "back", "side"] : ["front", "back"]) {
        const [k1, c1, g, k2, c2] = cfg[key];
        const [a, b] = this.chains[key];
        const s = this.physicsScale * ((key === "back" ? this.tuning.hairBack : this.tuning.hairFront) ?? this.tuning.hair);
        const wind = key === "side" ? Math.sin(this.time * 1.5 + 0.7) * 1.2 * s * R.wind : Math.sin(this.time * (key === "front" ? 1.9 : 1.15)) * (key === "front" ? 0.6 : 1.8) * s * R.wind;
        const gravity = -P.angleZ * 0.2 * s;
        let ax = -k1 * (a.x - wind - gravity) - c1 * a.vx - vx * g * k1 * 0.06 * s;
        let ay = -k1 * a.y - c1 * a.vy - vy * g * k1 * 0.04 * s;
        if (D) {
          const m = (key === "front" ? D[0] : key === "back" ? D[1] : D[2] ?? D[0]) * s;
          ax -= dv.ax * m;
          ay -= dv.ay * m;
        }
        a.vx += ax * dt;
        a.vy += ay * dt;
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        const bx = -k2 * (b.x - a.x * 1.6) - c2 * b.vx;
        const by = -k2 * (b.y - a.y * 1.4) - c2 * b.vy;
        b.vx += bx * dt;
        b.vy += by * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        for (const q of [a, b]) {
          q.x = Math.max(-lim, Math.min(lim, q.x));
          q.y = Math.max(-lim * 0.6, Math.min(lim * 0.6, q.y));
        }
      }
    }
    /** one frame: time, physics, the mesh. `mesh` false keeps the physics going without moving the mesh (a puppet not
     *  drawn this frame: the multi-view player's drawn views, only one or two of which show at a time) */
    update(dt, mesh = true) {
      if (!this.model) return;
      this.time += dt;
      const P = this.params;
      this.smileShown += (P.smile - this.smileShown) * Math.min(1, dt * 7);
      this.stepMouth(dt);
      for (const k of ["angleX", "angleY", "angleZ"]) P[k] = Math.max(PARAM_RANGES[k][0], Math.min(PARAM_RANGES[k][1], P[k]));
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      this.fbParts = false;
      for (let i = 0; i < steps; i++) {
        this.stepBody(dt / steps);
        this.stepPhysics(dt / steps);
        this.stepChains(dt / steps);
        if (this.fb) this.stepFb(dt / steps);
      }
      if (mesh) this.deform();
    }
    /** every layer's vertices at the current params, springs and torso: into each layer's out */
    deform() {
      const P = this.params, A = this.model.anchors;
      this.fbParts = false;
      const neckBody = [0, 0];
      this.bodyOffset(A.head.cx, A.neck_y, P, neckBody);
      const hp = [0, 0], bp = [0, 0];
      const [liftUp, liftDown] = browLimits(A, A.head.ry * this.rig.brow);
      const lift = (v) => v > 0 ? Math.min(1, v) * liftUp : Math.max(-1, v) * liftDown;
      const browLift = [lift(P.browLY), lift(P.browRY)];
      const mo = Math.min(1, Math.max(0, P.mouthOpen));
      let jawDrop = 0;
      this.mouthW.forEach((w, i) => {
        if (w > 0 && this.frameJaw[i] > 0) jawDrop += w * this.frameJaw[i] * (this.frameKind[i] === "half" ? 0.6 + 0.4 * this.frameEase(i, mo) : 0.75 + 0.25 * this.frameEase(i, mo));
      });
      const pt = [0, 0];
      const sideOn = !!this.rig.hair.side;
      const place = (x, y, wh, dep, w1, w2, f) => {
        if (wh < 1) this.bodyOffset(x, y, P, bp);
        else {
          bp[0] = 0;
          bp[1] = 0;
        }
        let X = x + bp[0], Y = y + bp[1];
        if (wh > 0) {
          this.headXform(x, y, dep, P, hp);
          X = X * (1 - wh) + (hp[0] + neckBody[0]) * wh;
          Y = Y * (1 - wh) + (hp[1] + neckBody[1]) * wh;
        }
        if ((w1 > 0 || w2 > 0) && sideOn) {
          const b = this.chains.back, chain = this.chains.front, sc = this.chains.side;
          const sd = smooth(SIDE_AT[0], SIDE_AT[1], Math.abs(x - A.head.cx) / A.head.rx), ff = f * (1 - sd), fs = f * sd;
          const c0x = chain[0].x * ff + sc[0].x * fs + b[0].x * (1 - f), c0y = chain[0].y * ff + sc[0].y * fs + b[0].y * (1 - f);
          const c1x = chain[1].x * ff + sc[1].x * fs + b[1].x * (1 - f), c1y = chain[1].y * ff + sc[1].y * fs + b[1].y * (1 - f);
          X += c0x * w1 + c1x * w2;
          Y += c0y * w1 + c1y * w2;
        } else if (w1 > 0 || w2 > 0) {
          const b = this.chains.back;
          const chain = this.chains.front;
          const c0x = chain[0].x * f + b[0].x * (1 - f), c0y = chain[0].y * f + b[0].y * (1 - f);
          const c1x = chain[1].x * f + b[1].x * (1 - f), c1y = chain[1].y * f + b[1].y * (1 - f);
          X += c0x * w1 + c1x * w2;
          Y += c0y * w1 + c1y * w2;
        }
        pt[0] = X;
        pt[1] = Y;
      };
      const so = [0, 0];
      const kw = this.kfOff ? [] : this.keyWeights ?? this.keys.map((k) => k.param === "diag" ? 0 : Math.min(2, Math.max(0, P[k.param] * k.scale / k.value)));
      if (this.kfPair && !this.kfOff && !this.keyWeights) {
        const u = kw.slice();
        for (let k = 0; k < u.length; k++) {
          const j = this.kfPair[k];
          if (j < 0 || u[k] <= 0 || u[k] >= 1) continue;
          const t = u[k], h10 = t * t * t - 2 * t * t + t;
          kw[k] = 3 * t * t - 2 * t * t * t + 0.5 * h10 + t * t * t - t * t;
          kw[j] -= 0.5 * h10;
        }
      }
      const roll = P.angleZ * Math.PI / 180 * this.rig.roll * this.tuning.turn;
      const g = this.tuning.gaze, gz = typeof g === "number" && g >= 0 && g < 1 ? g : 1;
      let chinDx = 0;
      if (this.rig.neck) {
        const cy = A.jaw?.chin ?? A.neck_y;
        this.headXform(A.head.cx, cy, 0, P, hp);
        this.bodyOffset(A.head.cx, cy, P, bp);
        chinDx = hp[0] + neckBody[0] - (A.head.cx + bp[0]);
      }
      const fringeB = fringeScale(this.bangsDepth, this.tuning.fringe);
      for (const L of this.layers) {
        this.fbParts = !!this.fb && L.def.group === "body";
        if (!this.kfOff && !this.shown(L)) continue;
        const d = L.def, r = L.rest, o = L.out;
        const fringeL = d.group === "hair_front" ? fringeScale(d.depth, this.tuning.fringe) : 1;
        L.uploaded = false;
        const n = r.length / 2;
        const role = d.role || "";
        const eyeSide = role.endsWith("_L") ? "L" : role.endsWith("_R") ? "R" : "";
        const isEye = role.startsWith("eye_") || role.startsWith("iris_") || role.startsWith("shine_");
        const open = eyeSide === "L" ? P.eyeLOpen : eyeSide === "R" ? P.eyeROpen : 1;
        const squash = 0.12 + 0.88 * open;
        const iris = role.startsWith("iris_");
        let ix = 0, iy = 0;
        if (iris && d.range) {
          ix = P.eyeBallX * d.range[0] * gz;
          iy = -P.eyeBallY * d.range[1] * gz;
        }
        if (this.chained && role.startsWith("shine_") && d.range) {
          ix = P.eyeBallX * d.range[0] * gz;
          iy = -P.eyeBallY * d.range[1] * gz;
        }
        let nx = ix, nk = 0;
        const nz = this.irisNasal && ix !== 0 ? this.nasal[eyeSide] : void 0;
        if (nz && ix * nz.sign > nz.room) {
          const far = Math.min(ix * nz.sign, nz.room + (1 - this.irisNasalNarrow) * nz.w);
          nk = -(far - nz.room) / nz.w;
          nx = nz.sign * nz.room - nk * nz.inner;
        }
        const lidIris = iris && this.irisLid && !!d.pivot && !!d.range && (d.range[0] > 0 || d.range[1] > 0);
        if (lidIris) iy += this.irisDrop * (1 - squash) * ((L.pivC ?? d.pivot[1]) - (d.y + d.h / 2));
        if (iris) L.soft = Math.min(1, Math.hypot(ix, iy) + (lidIris ? (1 - squash) * d.h / 2 : 0));
        const tw = this.chained && role.startsWith("shine_") ? twinkle(this.time + (eyeSide === "R" ? 1.3 : 0)) : 1;
        const tcx = d.x + d.w / 2, tcy = d.y + d.h / 2;
        let rgx = 0, rgy = 0;
        if (d.rigid) {
          this.headXform(d.rigid[0], d.rigid[1], d.depth, P, hp);
          rgx = hp[0] + neckBody[0];
          rgy = hp[1] + neckBody[1];
        }
        const rc = Math.cos(roll), rs = Math.sin(roll);
        for (let i = 0; i < n; i++) {
          let x = r[2 * i], y = r[2 * i + 1];
          if (tw !== 1) {
            x = tcx + (x - tcx) * tw;
            y = tcy + (y - tcy) * tw;
          }
          if (isEye && d.pivot) {
            const py = L.pivY ? L.pivY[i] : d.pivot[1];
            x += nx + nk * r[2 * i];
            y += iy;
            if (!lidIris || y > py) y = py + (y - py) * squash;
          }
          if (L.browSide[i] >= 0) {
            const v = browLift[L.browSide[i]];
            y -= Math.sign(v) * Math.min(Math.abs(v), L.browCap[i]) * L.wBrow[i];
          }
          if (jawDrop > 0 && L.wJaw[i] > 0) y += jawDrop * L.wJaw[i];
          if (d.rigid) {
            const vx = x - d.rigid[0], vy = y - d.rigid[1];
            pt[0] = rgx + vx * rc - vy * rs;
            pt[1] = rgy + vx * rs + vy * rc;
          } else place(x, y, L.wHead[i], fringeL === 1 ? L.dep[i] : L.dep[i] * fringeL, L.wPhys1[i], L.wPhys2[i], L.wFront[i]);
          if (L.skin) {
            this.skinOffset(L.skin, i, so);
            pt[0] += so[0];
            pt[1] += so[1];
          }
          let X = pt[0], Y = pt[1];
          if (L.wTwist && L.wTwist[i] > 0) X += chinDx * L.wTwist[i];
          if (L.wNeck && L.wNeck[i] > 0) {
            const a = roll * L.wNeck[i], c2 = Math.cos(a), s = Math.sin(a);
            const nx2 = A.head.cx + neckBody[0], ny = A.neck_y + neckBody[1], dx = X - nx2, dy = Y - ny;
            X = nx2 + dx * c2 - dy * s;
            Y = ny + dx * s + dy * c2;
          }
          const c = L.fol ? L.fol[i] : 0, cB = L.folB ? L.folB[i] : 0;
          if (c > 0 || cB > 0) {
            const k = 5 * i, al = L.alt;
            const X0 = X, Y0 = Y;
            place(x, y, al[k + 1], fringeB === 1 ? al[k] : al[k] * fringeB, al[k + 2], al[k + 3], al[k + 4]);
            if (L.altSkin) {
              this.skinOffset(L.altSkin, i, so);
              pt[0] += so[0];
              pt[1] += so[1];
            }
            X += (pt[0] - X0) * c;
            Y += (pt[1] - Y0) * c;
            if (L.outB) {
              L.outB[2 * i] = X0 + (pt[0] - X0) * cB;
              L.outB[2 * i + 1] = Y0 + (pt[1] - Y0) * cB;
            }
          } else if (L.outB) {
            L.outB[2 * i] = X;
            L.outB[2 * i + 1] = Y;
          }
          if (L.kf) {
            let dx = 0, dy = 0;
            for (let k = 0; k < kw.length; k++) {
              const f = L.kf[k];
              if (f && kw[k] !== 0) {
                dx += kw[k] * f[2 * i];
                dy += kw[k] * f[2 * i + 1];
              }
            }
            if (dx !== 0 || dy !== 0) {
              const a = roll * L.wHead[i], c2 = Math.cos(a), s = Math.sin(a);
              const ox = dx * c2 - dy * s, oy = dx * s + dy * c2;
              X += ox;
              Y += oy;
              if (L.outB) {
                L.outB[2 * i] += ox;
                L.outB[2 * i + 1] += oy;
              }
            }
          }
          o[2 * i] = X;
          o[2 * i + 1] = Y;
        }
      }
    }
    // ---------------------------------------------------------------- draw
    drawLayer(L, tex, alpha, verts, cut = 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, L.pos);
      if (verts) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        L.uploaded = false;
      } else if (!L.uploaded) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, L.out);
        L.uploaded = true;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1f(this.uAlpha, alpha);
      gl.uniform1f(this.uCut, cut);
      gl.bindVertexArray(L.vao);
      gl.drawElements(gl.TRIANGLES, L.count, gl.UNSIGNED_INT, 0);
    }
    /** softIris: the whites of each eye whose iris sits off it (a glance, a blink), as they show this frame, into a
     *  channel each (maskCh) of a texture over their box in drawing-buffer pixels; the iris is then drawn times them
     *  (uMode 2) instead of through the stencil, whose 1-bit cut at alpha 0.5 is a staircase wherever the iris crosses
     *  it. First thing in the frame: switching framebuffers half way through costs a tiled GPU a store and a
     *  reload of the canvas */
    drawMasks(w, h, sx, sy, ox, oy) {
      const gl = this.gl;
      const eyes = [];
      for (const L of this.layers) L.maskCh = -1;
      for (const L of this.softIris ? this.layers : []) {
        const parent = L.def.clip ? this.byId.get(L.def.clip) : void 0;
        if (!(L.def.role || "").startsWith("iris_") || !parent?.mask || !(L.soft > 0) || parent.maskCh >= 0 || eyes.length >= 4) continue;
        if (this.hidden.has(L.def.id) || this.hidden.has(parent.def.id)) continue;
        parent.maskCh = eyes.length;
        eyes.push(parent);
      }
      if (!eyes.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const E of eyes) {
        for (let i = 0; i < E.out.length; i += 2) {
          const X = (E.out[i] * sx + ox + 1) * w / 2, Y = (1 - (E.out[i + 1] * sy + oy)) * h / 2;
          x0 = Math.min(x0, X);
          x1 = Math.max(x1, X);
          y0 = Math.min(y0, Y);
          y1 = Math.max(y1, Y);
        }
      }
      x0 = Math.max(0, Math.floor(x0) - 2);
      y0 = Math.max(0, Math.floor(y0) - 2);
      x1 = Math.min(w, Math.ceil(x1) + 2);
      y1 = Math.min(h, Math.ceil(y1) + 2);
      if (x1 <= x0 || y1 <= y0) {
        for (const E of eyes) E.maskCh = -1;
        return;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      if (!this.maskFb || x1 - x0 > this.maskSize[0] || y1 - y0 > this.maskSize[1]) {
        const W = Math.max(this.maskSize[0], Math.ceil((x1 - x0) / 64) * 64), H = Math.max(this.maskSize[1], Math.ceil((y1 - y0) / 64) * 64);
        this.maskTex ||= gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.maskFb ||= gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTex, 0);
        this.maskSize = [W, H];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFb);
      gl.viewport(-x0, -y0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.uniform1i(this.uMode, 1);
      eyes.forEach((E, k) => {
        gl.colorMask(k === 0, k === 1, k === 2, k === 3);
        this.drawLayer(E, E.mask, 1);
      });
      gl.colorMask(true, true, true, true);
      gl.uniform1i(this.uMode, 0);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2i(this.uMaskOff, x0, y0);
    }
    render() {
      const gl = this.gl, cv = this.canvas;
      const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
      const [w, h] = this.size ?? [Math.round(cv.clientWidth * dpr), Math.round(cv.clientHeight * dpr)];
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      gl.viewport(0, 0, w, h);
      const clear = () => {
        gl.clearColor(...this.background);
        gl.clearStencil(0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      };
      if (!this.model) {
        clear();
        return;
      }
      gl.useProgram(this.prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.uTex, 0);
      gl.uniform1i(this.uMode, 0);
      const [MW, MH] = this.model.canvas;
      const V = this.view, M = this.move, A = this.model.anchors, hd = A.head;
      const F = A.frame ? fitBox(this.focusHead ? "frame" : this.fit, A, this.model.canvas, this.fb) : null;
      const BW = F ? F[2] - F[0] : MW, BH = F ? F[3] - F[1] : MH, cx2 = F ? F[0] + F[2] : MW, cy2 = F ? F[1] + F[3] : MH;
      const offY = (k, y) => (this.focusHead ? -(hd.cy + hd.ry * 0.15) * (2 * k) / h : -cy2 * k / h) + this.panY - 2 * y;
      const bottom = (k, oy2) => -(MH * (2 * k) / h + oy2);
      const base = Math.min(w / BW, h / BH) * this.zoom;
      const s = base * V.s * M.s;
      const sx = 2 * s / w, sy = 2 * s / h;
      let oy = offY(s, V.y + M.y);
      if (this.cutBottom) {
        const allowed = Math.max(bottom(base * V.s, offY(base * V.s, V.y)), -1);
        oy += Math.max(0, bottom(s, oy) - allowed);
      }
      if (this.fb && !F && !this.focusHead && M.s !== 1) oy += (MH - 2 * this.fb.groundY) * (s - base * V.s) / h;
      const ox = (this.focusHead ? -hd.cx * sx : -cx2 * s / w) + 2 * (V.x + (this.fb ? 0 : M.x));
      gl.uniform4f(this.uView, sx, sy, ox, oy);
      this.drawMasks(w, h, sx, sy, ox, oy);
      clear();
      this.lastView = [sx, sy, ox, oy, w, h];
      this.anchorModel = this.model;
      const P = this.params;
      const drawMouth = (L) => {
        const m = Math.min(1, Math.max(0, P.mouthOpen)), f = this.mouthFrame;
        const py = L.def.pivot ? L.def.pivot[1] : L.def.y;
        const k = this.frameKind[f] === "half" ? 0.88 + 0.12 * this.frameEase(f, m) : 0.9 + 0.1 * this.frameEase(f, m);
        let verts;
        if (f > 0 && f !== this.vis.shut) {
          verts = L.out.slice();
          const fade = this.chinFollow ? L.wJaw : void 0;
          for (let i = 1; i < verts.length; i += 2) verts[i] += (L.rest[i] - py) * (k - 1) * (fade ? 1 - fade[i >> 1] : 1);
        }
        this.drawLayer(L, L.frames[f], 1, verts);
      };
      const lastExpr = this.talkLeft > 0 ? this.layers.findLastIndex((l) => l.def.role === "expr") : -1;
      const exprShown = (d) => this.exprAlpha(d);
      let deferred = null;
      const lastBrow = this.layers.findLastIndex((l) => l.def.id === "brows" || l.def.role === "expr_brows");
      let newBrows = lastBrow < 0;
      const drawNewBrows = () => {
        newBrows = true;
        if (this.headHidden) return;
        for (const E of this.layers) {
          if (E.browTex && E.def.role === "expr" && !this.hidden.has(E.def.id) && !(this.only && !this.only(E.def))) {
            const a = exprShown(E.def);
            if (a > 0.01) this.drawLayer(E, E.browTex, a, E.outB);
          }
        }
      };
      let ref = 0;
      for (let li = 0; li < this.layers.length; li++) {
        const L = this.layers[li];
        const d = L.def, role = d.role || "";
        if (deferred && li > lastExpr) {
          drawMouth(deferred);
          deferred = null;
        }
        if (!newBrows && li > lastBrow) drawNewBrows();
        if (this.hidden.has(d.id) || (d.group === "body" ? this.bodyHidden : this.headHidden) || this.only && !this.only(d)) continue;
        if ((role === "hole" || role === "edge" || role === "edge_wide") && !this.masks) continue;
        if (role === "mouth" && L.frames.length >= 3) {
          if (li < lastExpr) deferred = L;
          else drawMouth(L);
          continue;
        }
        if (role === "expr") {
          const a = exprShown(d);
          if (a > 0.01) this.drawLayer(L, this.talkLeft > 0 && L.talk ? L.talk : L.tex, a);
          continue;
        }
        if (role === "expr_brows") {
          const a = exprShown(d);
          if (a > 0.01) this.drawLayer(L, L.tex, a);
          continue;
        }
        if (d.id === "brows") {
          let fade = 0;
          for (const E of this.layers) {
            if (E.def.role === "expr" && E.def.brows === "redrawn" && !this.hidden.has(E.def.id)) fade = Math.max(fade, exprShown(E.def));
          }
          if (fade < 0.99) this.drawLayer(L, L.tex, 1 - fade);
          continue;
        }
        if (role.startsWith("lid_")) {
          const open = role === "lid_L" ? P.eyeLOpen : P.eyeROpen;
          const a = 1 - smooth(0.05, 0.35, open);
          if (a > 0.01) this.drawLayer(L, L.tex, a);
          continue;
        }
        if (role.startsWith("eye_")) {
          const open = role === "eye_L" ? P.eyeLOpen : P.eyeROpen;
          this.drawLayer(L, L.tex, smooth(0.02, 0.2, open));
          L.stencilRef = 0;
          if (L.mask && L.maskCh < 0) {
            ref = ref % 250 + 1;
            L.stencilRef = ref;
            gl.enable(gl.STENCIL_TEST);
            gl.stencilFunc(gl.ALWAYS, ref, 255);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
            gl.colorMask(false, false, false, false);
            this.drawLayer(L, L.mask, 1, void 0, 0.5);
            gl.colorMask(true, true, true, true);
            gl.disable(gl.STENCIL_TEST);
          }
          continue;
        }
        if (role === "blush") {
          let a = 0;
          for (const [k, v] of Object.entries(d.blush || {})) a += v * this.exprValue(k);
          if (a > 0.01) this.drawLayer(L, L.tex, Math.min(1, a));
          continue;
        }
        if (role.startsWith("iris_") || role.startsWith("shine_")) {
          const parent = d.clip ? this.byId.get(d.clip) : void 0;
          const open = role.endsWith("_L") ? P.eyeLOpen : P.eyeROpen;
          if (parent && parent.maskCh >= 0) {
            const c = parent.maskCh;
            gl.uniform1i(this.uMode, 2);
            gl.uniform4f(this.uMaskSel, +(c === 0), +(c === 1), +(c === 2), +(c === 3));
            gl.uniform1f(this.uSoft, L.soft);
            this.drawLayer(L, L.tex, smooth(0.02, 0.2, open));
            gl.uniform1i(this.uMode, 0);
          } else if (parent && parent.stencilRef) {
            gl.enable(gl.STENCIL_TEST);
            gl.stencilFunc(gl.EQUAL, parent.stencilRef, 255);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            this.drawLayer(L, L.tex, smooth(0.02, 0.2, open));
            gl.disable(gl.STENCIL_TEST);
          }
          continue;
        }
        const ma = d.show || d.hide ? this.moodAlpha(d) : 1;
        if (ma > 0.01) this.drawLayer(L, L.tex, ma);
      }
      if (deferred) drawMouth(deferred);
      if (!newBrows) drawNewBrows();
      gl.bindVertexArray(null);
    }
    /** An attachment follows the same deformations and projection as the last rendered frame. */
    anchor(name) {
      if (!this.model || this.anchorModel !== this.model) return null;
      const A = this.model.anchors, P = this.params, h = A.head;
      const x = name === "head" ? h.cx : A.chest?.cx ?? h.cx;
      const y = name === "head" ? h.cy : A.chest?.cy ?? (A.neck_y + (this.fb ? this.fb.hy : A.bottom_y)) / 2;
      const radius = name === "head" ? h.rx : h.rx * 1.5;
      const neck = [0, 0];
      if (name === "head") this.bodyOffset(h.cx, A.neck_y, P, neck);
      const point = (x2) => {
        const out = [0, 0];
        if (name === "head") {
          this.headXform(x2, y, 0, P, out);
          out[0] += neck[0];
          out[1] += neck[1];
        } else {
          this.bodyOffset(x2, y, P, out);
          out[0] += x2;
          out[1] += y;
        }
        const [sx, sy, ox, oy] = this.lastView;
        return [(out[0] * sx + ox + 1) / 2, (out[1] * sy + oy + 1) / 2];
      };
      const [, , , , w, height] = this.lastView;
      return projectedAnchor(point(x), point(x + radius), height / w);
    }
    /** a point on the canvas (CSS px from its top-left) in model px, as the last frame drew it */
    canvasToModel(px, py) {
      const [sx, sy, ox, oy, w, h] = this.lastView, cv = this.canvas;
      const cx = 2 * px * (w / Math.max(1, cv.clientWidth)) / w - 1, cy = 2 * py * (h / Math.max(1, cv.clientHeight)) / h - 1;
      return [(cx - ox) / sx, (cy - oy) / sy];
    }
    /** a flick at model point (x, y): every chain passing near it is thrown, the nearest joint hardest (a tap on a twin
     *  tail, the ahoge, a cord). Returns how many chains it moved */
    poke(x, y, strength = 1) {
      let hit = 0;
      for (const C of this.chainRuns) {
        const R = C.R, m = R.length / 2, reach = 1.5 * (C.def.sigma ?? 40) + 20;
        let near = Infinity;
        for (let j = 0; j < m; j++) near = Math.min(near, Math.hypot(R[2 * j] - x, R[2 * j + 1] - y));
        if (near > reach) continue;
        hit++;
        const side = x < R[0] ? 1 : -1;
        for (let j = 1; j < m; j++) {
          const k = (1 - near / reach) * C.s[j] * 9 * strength;
          C.q[2 * j] -= side * k;
          C.q[2 * j + 1] += k * 0.3;
        }
      }
      return hit;
    }
    /** springs back to rest (eval / screenshots must not inherit wind sway) */
    resetPhysics() {
      for (const C of this.chainRuns) {
        C.p.set(C.R);
        C.q.set(C.R);
        C.disp.fill(0);
        C.beta.fill(0);
        C.started = false;
        C.moving = false;
      }
      for (const c of Object.values(this.chains)) for (const q of c) Object.assign(q, spring());
      this.lastHead = { x: 0, y: 0, roll: 0 };
      this.drive.started = false;
      this.body = { yaw: 0, roll: 0 };
      this.bust = { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0 };
      this.fbm = { hs: 0, hv: 0, tilt: 0, tanTilt: 0, hem: 0, hemV: 0, breath: 0 };
      this.crouch = 0;
      this.dip = 0;
      this.pv.roll = NaN;
    }
    snapshot() {
      return this.canvas.toDataURL("image/png");
    }
  };
  function keyformsFit(K) {
    const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    const pos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (K?.version !== 1 || !int(K.cols, 2, 4096) || !int(K.rows, 2, 4096) || K.cols * K.rows > 2 ** 22) return false;
    if (![K.cell, K.units, K.turn, K.nod].every(pos) || !Array.isArray(K.keys) || K.keys.length > 32) return false;
    const b64 = (bytes) => Math.ceil(bytes / 3) * 4, field = b64(K.cols * K.rows * 4), mask = b64(K.cols * K.rows);
    for (const k of K.keys) {
      if (!k || !["angleX", "angleY", "diag"].includes(k.param) || !Number.isFinite(k.value) || k.param !== "diag" && !k.value) return false;
      if (!k.fields || typeof k.fields !== "object" || Object.values(k.fields).some((v) => typeof v !== "string" || v.length !== field)) return false;
      if (k.same !== void 0 && !(Array.isArray(k.same) && k.same.every((g) => typeof g === "string"))) return false;
    }
    return Object.values(K.mask || {}).every((v) => typeof v === "string" && v.length === mask);
  }
  function chainRun(def) {
    const m = def.points.length, R = new Float32Array(def.points.flat());
    const len = new Float32Array(m), s = new Float32Array(m);
    for (let j = 1; j < m; j++) {
      len[j] = Math.hypot(R[2 * j] - R[2 * j - 2], R[2 * j + 1] - R[2 * j - 1]);
      s[j] = s[j - 1] + len[j];
    }
    const total = s[m - 1] || 1;
    for (let j = 1; j < m; j++) s[j] /= total;
    let h = 0;
    for (const ch of def.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return {
      def,
      R,
      p: R.slice(),
      q: R.slice(),
      len,
      s,
      disp: new Float32Array(2 * m),
      beta: new Float32Array(m),
      W: [0, 0],
      V: [0, 0],
      acc: [0, 0],
      rho: 0,
      started: false,
      phase: h / 997 * 2 * Math.PI,
      moving: false
    };
  }
  function twinkle(t) {
    const k = Math.floor(t / 5.3), u = t - k * 5.3 - k * 7919 % 13 / 13 * 3.5;
    const spark = u > 0 && u < 0.35 ? Math.sin(u / 0.35 * Math.PI) : 0;
    return 1 + 0.03 * Math.sin(t * 2.1) + 0.12 * spark;
  }
  function locate(baseUrl) {
    const [path, query = ""] = baseUrl.split("?");
    const file = path.endsWith(".json") ? path : (path.endsWith("/") ? path : path + "/") + "model.json";
    return { file, base: file.slice(0, file.lastIndexOf("/") + 1), query };
  }
  function packUrl(baseUrl, tag) {
    const { base, query } = locate(baseUrl);
    return base + `textures.bin?v=${tag}${query ? `&${query}` : ""}`;
  }
  async function loadPack(url, signal) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const n = new DataView(buf).getUint32(0, true);
      const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
      return new Map(Object.entries(head).filter((e) => Array.isArray(e[1])).map(([k, [o, len]]) => [k, new Blob([new Uint8Array(buf, 4 + n + o, len)], { type: k.endsWith(".png") ? "image/png" : "image/webp" })]));
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
  }
  function loadBlob(b) {
    const u = URL.createObjectURL(b);
    return loadImage(u).finally(() => URL.revokeObjectURL(u));
  }
  async function fetchImage(src, signal) {
    let b;
    try {
      const r = await fetch(src, { signal });
      if (!r.ok) throw new Error();
      b = await r.blob();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Error("image " + src);
    }
    return loadBlob(b);
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image " + src));
      i.src = src;
    });
  }
  function sampleField(f, K, x, y) {
    const gx = Math.min(K.cols - 1.001, Math.max(0, x / K.cell)), gy = Math.min(K.rows - 1.001, Math.max(0, y / K.cell));
    const c = Math.floor(gx), r = Math.floor(gy), tx = gx - c, ty = gy - r;
    const at = (cc, rr, k) => f[2 * (rr * K.cols + cc) + k];
    const v = (k) => (at(c, r, k) * (1 - tx) + at(c + 1, r, k) * tx) * (1 - ty) + (at(c, r + 1, k) * (1 - tx) + at(c + 1, r + 1, k) * tx) * ty;
    return [v(0) * K.units, v(1) * K.units];
  }
  function sampleMask(m, K, x, y) {
    const gx = Math.min(K.cols - 1.001, Math.max(0, x / K.cell)), gy = Math.min(K.rows - 1.001, Math.max(0, y / K.cell));
    const c = Math.floor(gx), r = Math.floor(gy), tx = gx - c, ty = gy - r;
    const at = (cc, rr) => m[rr * K.cols + cc];
    return ((at(c, r) * (1 - tx) + at(c + 1, r) * tx) * (1 - ty) + (at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx) * ty) / 255;
  }
  function coverAt(img, L, under, U, pts, cell) {
    const c = document.createElement("canvas");
    c.width = L.w;
    c.height = L.h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, L.w, L.h);
    const a = g.getImageData(0, 0, L.w, L.h).data;
    g.clearRect(0, 0, L.w, L.h);
    g.drawImage(under, U.x - L.x, U.y - L.y, U.w, U.h);
    const b = g.getImageData(0, 0, L.w, L.h).data;
    const out = new Float32Array(pts.length / 2);
    for (let i = 0; i < out.length; i++) {
      const cx = pts[2 * i] - L.x, cy = pts[2 * i + 1] - L.y;
      let sa = 0, sab = 0, sb = 0, k = 0;
      for (let y = Math.max(0, Math.round(cy - cell)); y < Math.min(L.h, Math.round(cy + cell)); y++) {
        for (let x = Math.max(0, Math.round(cx - cell)); x < Math.min(L.w, Math.round(cx + cell)); x++) {
          const j = 4 * (y * L.w + x) + 3, wa = a[j] / 255, wb = b[j] / 255;
          sa += wa;
          sab += wa * wb;
          sb += wb;
          k++;
        }
      }
      out[i] = sa > 1 ? sab / sa : k ? sb / k : 0;
    }
    return out;
  }
  function lidCurveFits(m) {
    const p = m.profile, i = p?.class?.input;
    return !!p && (p.id === "anime_half" || p.id === "painterly") && i?.facing === "front" && i.glasses !== true && !m.layers.some((L) => L.id === "glasses");
  }
  function nasalRoom(iris, I, mask, E, sign) {
    const read2 = (img) => {
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return { w, h, d: g.getImageData(0, 0, w, h).data };
    };
    const a = read2(iris), m = read2(mask);
    const ux = I.w / a.w, uy = I.h / a.h;
    const white = (x, y) => {
      const u = Math.floor((x - E.x) / E.w * m.w), v = Math.floor((y - E.y) / E.h * m.h);
      return u >= 0 && v >= 0 && u < m.w && v < m.h && m.d[4 * (v * m.w + u) + 3] >= 128;
    };
    const rows = [];
    for (let v = 0; v < a.h; v++) {
      const y = I.y + (v + 0.5) * uy;
      let n = 0, lo = Infinity, hi = -Infinity;
      for (let u = 0; u < a.w; u++) {
        const x = I.x + (u + 0.5) * ux;
        if (a.d[4 * (v * a.w + u) + 3] < 200 || !white(x, y)) continue;
        n++;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      if (n) rows.push([y, n, sign > 0 ? hi : lo, sign > 0 ? lo : hi]);
    }
    if (!rows.length) return null;
    const top = Math.max(...rows.map((r) => r[1]));
    const room = [], inner = [], width = [];
    for (const [y, n, near, far] of rows) {
      if (n < 0.9 * top) continue;
      let k = 0;
      while (white(near + sign * (k + 1) * ux, y)) k++;
      room.push(k * ux);
      inner.push(near + sign * ux / 2);
      width.push(Math.abs(near - far) + ux);
    }
    const med = (v) => v.sort((p, q) => p - q)[v.length >> 1];
    return { room: med(room), sign, inner: med(inner), w: med(width) };
  }
  function closedLashLine(img, L) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    const ys = new Array(w).fill(NaN);
    for (let x = 0; x < w; x++) {
      let best = 255, by = -1;
      for (let y = 0; y < h; y++) {
        const k = 4 * (y * w + x);
        if (d[k + 3] < 200) continue;
        const l = 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2];
        if (l < best) {
          best = l;
          by = y;
        }
      }
      if (by >= 0 && best < 110) ys[x] = by;
    }
    const found = ys.filter((v) => !Number.isNaN(v)).length;
    if (found < 0.2 * w) return null;
    const pts = [];
    ys.forEach((v, x) => {
      if (!Number.isNaN(v)) pts.push([L.x + (x + 0.5) * (L.w / w), L.y + (v + 0.5) * (L.h / h)]);
    });
    const fit = (P) => {
      const m = P.reduce((s, p) => s + p[0], 0) / P.length, sc = Math.max(1, (P[P.length - 1][0] - P[0][0]) / 2);
      const S = new Array(5).fill(0), T = [0, 0, 0];
      for (const [x, y] of P) {
        const u = (x - m) / sc;
        let q = 1;
        for (let k = 0; k < 5; k++) {
          S[k] += q;
          if (k < 3) T[k] += q * y;
          q *= u;
        }
      }
      const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
      const det = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
      const D = det(M);
      if (!(Math.abs(D) > 1e-9)) return null;
      const co = [0, 1, 2].map((j) => det(M.map((r, i) => r.map((v, k) => k === j ? T[i] : v))) / D);
      if (!co.every(Number.isFinite)) return null;
      return (x) => {
        const u = (x - m) / sc;
        return co[0] + co[1] * u + co[2] * u * u;
      };
    };
    let f = fit(pts);
    if (!f) return null;
    const res = pts.map(([x, y]) => Math.abs(y - f(x))).sort((a, b) => a - b);
    const tol = Math.max(1.5, 2.5 * res[res.length >> 1]);
    let used = pts;
    const kept = pts.filter(([x, y]) => Math.abs(y - f(x)) <= tol);
    const refit = kept.length >= 0.6 * pts.length ? fit(kept) : null;
    if (refit) {
      f = refit;
      used = kept;
    }
    const x0 = used[0][0], x1 = used[used.length - 1][0], line = f;
    return (x) => line(Math.min(x1, Math.max(x0, x)));
  }
  function alphaGrid(imgs, cols, rows, ox = 0, oy = 0, w = cols, h = rows) {
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    for (const img of imgs) g.drawImage(img, ox, oy, w, h);
    const d = g.getImageData(0, 0, cols, rows).data;
    const occ = new Uint8Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) occ[i] = d[4 * i + 3] > 0 ? 1 : 0;
    const out = occ.slice();
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      if (occ[r * cols + q]) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
        const rr = r + dr, qq = q + dq;
        if (rr >= 0 && rr < rows && qq >= 0 && qq < cols && occ[rr * cols + qq]) out[r * cols + q] = 1;
      }
    }
    return out;
  }

  // vendor/livliv-player/src/runtime/actions.ts
  var DUR = { nod: 0.95, shake: 1.05, tilt: 1.8, hop: 0.65, shy: 2.4 };
  var env = (t, d) => smooth(0, 0.18, t) * (1 - smooth(d - 0.22, d, t));
  function curve(id, t, grounded = false) {
    const d = DUR[id], e = env(t, d), o = {};
    let y = 0;
    if (id === "nod") o.angleY = -(t < 0.45 ? 11 * Math.sin(Math.PI * t / 0.45) : 6 * Math.sin(Math.PI * Math.min(t - 0.45, 0.45) / 0.45)) * e;
    if (id === "shake") {
      o.angleX = 13 * Math.sin(2 * Math.PI * t / 0.5) * e;
      o.bodyX = o.angleX * 0.15;
    }
    if (id === "tilt") {
      o.angleZ = 11 * e;
      o.angleX = 3 * e;
      o.angleY = 2 * e;
    }
    if (id === "hop") {
      y = t < 0.2 ? -0.025 * Math.sin(Math.PI * t / 0.2) : t < 0.6 ? 0.04 * Math.sin(Math.PI * (t - 0.2) / 0.4) : grounded ? -0.012 * Math.sin(Math.PI * Math.min(t - 0.6, 0.05) / 0.05) : 0;
      o.angleY = t > 0.2 && t < 0.6 ? 5 * Math.sin(Math.PI * (t - 0.2) / 0.4) * e : 0;
    }
    if (id === "shy") {
      o.angleY = -12 * e;
      o.angleX = 9 * e;
      o.angleZ = -4 * e;
      o.eyeBallX = 0.7 * e;
      o.eyeBallY = -0.5 * e;
    }
    return { offsets: o, x: 0, y };
  }
  var AWAY = { eyeLOpen: 0, eyeROpen: 0, angleY: -11, angleZ: 5, angleX: 0, mouthOpen: 0, smile: 0, eyeBallX: 0, eyeBallY: 0 };
  var ActionPlayer = class {
    /** out: seconds since it was replaced by the same action pressed again (it fades out over 0.15 s), else -1 */
    playing = [];
    /** away: on; auto: entered because no face was seen (leaves by itself when one is back) */
    away = false;
    auto = false;
    /** how far into the away pose (0..1) */
    awayW = 0;
    off = {};
    y = 0;
    /** the character stands on a ground line (a full-body model): the hop lands with a dip */
    grounded = false;
    play(id, strength = 1) {
      if (id === "away") {
        this.setAway(!this.away);
        return;
      }
      for (const p of this.playing) if (p.id === id && p.out < 0) p.out = 0;
      this.playing.push({ id, t: 0, out: -1, strength: Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 1 });
    }
    setAway(on, auto = false) {
      this.away = on;
      this.auto = on && auto;
    }
    get busy() {
      return this.playing.length > 0 || this.awayW > 0;
    }
    /** offsets to add this frame; `y` holds the vertical move */
    update(dt) {
      const o = this.off;
      for (const k of Object.keys(o)) delete o[k];
      this.y = 0;
      for (const p of this.playing) {
        p.t += dt;
        if (p.out >= 0) p.out += dt;
        const m = curve(p.id, Math.min(p.t, DUR[p.id]), this.grounded), f = p.strength * (p.out < 0 ? 1 : 1 - smooth(0, 0.15, p.out));
        for (const [k, v] of Object.entries(m.offsets)) o[k] = (o[k] ?? 0) + v * f;
        this.y += m.y * f;
      }
      this.playing = this.playing.filter((p) => p.t < DUR[p.id] && p.out < 0.15);
      this.awayW += ((this.away ? 1 : 0) - this.awayW) * Math.min(1, dt * (this.away ? 2.2 : 4));
      if (this.awayW < 2e-3 && !this.away) this.awayW = 0;
      return o;
    }
    /** the away pose at time t (breathing slower than awake) */
    awayPose(t) {
      return { ...AWAY, breath: 0.5 + 0.5 * Math.sin(t * 1.15) };
    }
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

  // vendor/livliv-player/src/runtime/idle.ts
  var smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  var knee = (v, k, cap) => {
    const a = Math.abs(v);
    return a <= k ? v : Math.sign(v) * (k + (cap - k) * Math.tanh((a - k) / (cap - k)));
  };
  var env2 = (s, a, h, d) => s < 0 || s > a + h + d ? 0 : s < a ? smoothstep(0, a, s) : 1 - smoothstep(a + h, a + h + d, s);
  function noise(t, seed) {
    const h = (n) => {
      const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
    return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
  }
  var fbm = (t, seed) => noise(t, seed) * 0.7 + noise(t * 2.3, seed + 17) * 0.3;
  function sample(k, t) {
    if (t <= k[0][0]) return k[0][1];
    const n = k.length - 1;
    if (t >= k[n][0]) return k[n][1];
    let i = 0;
    while (t > k[i + 1][0]) i++;
    const slope = (j) => j <= 0 || j >= n ? 0 : (k[j + 1][1] - k[j - 1][1]) / (k[j + 1][0] - k[j - 1][0]);
    const h = k[i + 1][0] - k[i][0], u = (t - k[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * k[i][1] + (u3 - 2 * u2 + u) * slope(i) * h + (-2 * u3 + 3 * u2) * k[i + 1][1] + (u3 - u2) * slope(i + 1) * h;
  }
  var IDLE_MOVES = {
    // eyes flick to one side, the head follows, holds, comes back
    glance: { dur: 4, tracks: {
      eyeBallX: [[0, 0], [0.15, 0.8], [2.5, 0.75], [2.8, 0]],
      eyeBallY: [[0, 0], [0.15, 0.25], [2.5, 0.2], [2.8, 0]],
      angleX: [[0, 0], [0.6, 11], [2.5, 10], [3.4, 0]],
      angleY: [[0, 0], [0.6, 4], [2.5, 3], [3.4, 0]],
      angleZ: [[0, 0], [0.7, -4], [2.5, -3], [3.4, 0]],
      bodyX: [[0, 0], [1, 2], [2.6, 1.5], [3.8, 0]],
      brow: [[0, 0], [0.4, 0.25], [2.5, 0.2], [3.2, 0]],
      breath: [[0, 0.1], [0.6, 0.7], [2.6, 0.6], [3.6, 0], [4, 0.15]]
    } },
    // one side, then the other
    lookAround: { dur: 5, tracks: {
      eyeBallX: [[0, 0], [0.2, -0.8], [1.4, -0.75], [1.7, 0.1], [2, 0.8], [3.2, 0.75], [3.5, 0]],
      angleX: [[0, 0], [0.7, -15], [1.5, -14], [2.4, 15], [3.3, 14], [4.2, 0]],
      angleY: [[0, 0], [0.8, 3], [2.4, 3], [4.2, 0]],
      angleZ: [[0, 0], [0.8, 3], [1.7, 0], [2.5, -3], [4.2, 0]],
      bodyX: [[0, 0], [1, -3], [2.7, 3], [4.4, 0]],
      brow: [[0, 0], [0.5, 0.3], [3.4, 0.25], [4.2, 0]],
      breath: [[0, 0.2], [0.6, 0.8], [3.4, 0.7], [4.4, 0], [5, 0.1]]
    } },
    // a slow side-to-side with the body
    sway: { dur: 6, tracks: {
      bodyZ: [[0, 0], [1.5, 3.5], [3, -3.5], [4.5, 3], [6, 0]],
      bodyX: [[0, 0], [1.5, 2], [3, -2], [4.5, 1.5], [6, 0]],
      angleZ: [[0, 0], [1.6, -7], [3.1, 7], [4.6, -6], [6, 0]],
      angleX: [[0, 0], [1.6, 4], [3.1, -4], [4.6, 3], [6, 0]],
      eyeBallX: [[0, 0], [1.6, -0.25], [3.1, 0.25], [4.6, -0.2], [6, 0]],
      eye: [[0, 1], [0.8, 0.88], [5.2, 0.88], [6, 1]],
      breath: [[0, 0], [0.75, 1], [1.5, 0], [2.25, 1], [3, 0], [3.75, 1], [4.5, 0], [5.25, 0.8], [6, 0]]
    } },
    // eyes up and aside, the head tilts, the brows lift
    think: { dur: 4.4, tracks: {
      eyeBallX: [[0, 0], [0.3, -0.6], [3.4, -0.55], [3.8, 0]],
      eyeBallY: [[0, 0], [0.3, 0.6], [3.4, 0.55], [3.8, 0]],
      angleX: [[0, 0], [0.8, -9], [3.4, -8], [4.2, 0]],
      angleY: [[0, 0], [0.8, 6], [3.4, 5], [4.2, 0]],
      angleZ: [[0, 0], [0.9, 6], [3.4, 5], [4.2, 0]],
      brow: [[0, 0], [0.6, 0.35], [3.4, 0.3], [4.2, 0]],
      eye: [[0, 1], [0.6, 0.92], [3.4, 0.92], [4, 1]]
    } },
    // a quick look down (at notes, at chat) and back to the viewer
    lookDown: { dur: 2.4, tracks: {
      eyeBallY: [[0, 0], [0.2, -0.85], [1.4, -0.8], [1.65, 0]],
      eyeBallX: [[0, 0], [0.2, -0.1], [1.4, -0.1], [1.65, 0]],
      angleY: [[0, 0], [0.45, -8], [1.4, -7], [1.9, 1], [2.4, 0]],
      angleZ: [[0, 0], [0.5, 2], [1.5, 2], [2.4, 0]],
      eye: [[0, 1], [0.3, 0.8], [1.4, 0.8], [1.65, 1]]
    } }
  };
  var SPRING = {
    angleX: [55, 0.72],
    angleY: [55, 0.72],
    angleZ: [45, 0.75],
    bodyX: [14, 0.9],
    bodyZ: [12, 0.9]
  };
  var IDLE_STYLE = { wander: 1, look: 1, moves: 1, bodyTurn: 0, bodyTilt: 0, pointer: "attend", smile: 0.4 };
  var ATTEND = {
    yaw: 9,
    yawKnee: 10,
    yawCap: 13,
    pitch: 5,
    pitchKnee: 6,
    pitchCap: 10,
    /** the head's tilt and the body's lean toward the pointer's side, and the body's own turn: small, so the head moves
     *  against the shoulders (with a tilt of 5 and a lean of 2, head and chest
     *  swaying together read as the whole picture tilting, the face still frontal) */
    roll: 2,
    rollKnee: 8,
    rollCap: 12,
    lean: 0,
    bodyTurn: 1.5,
    /** the gaze: its share of the pointer's place, then the limit, an ellipse through 0.78 sideways and 0.55 up / down
     *  (the iris's travel is 1), eased into from 70 % of it (at 0.8 of the place up to 0.7 it was hard
     *  to tell where the character looked) */
    eyeX: 1,
    eyeY: 0.8,
    eyeXCap: 0.78,
    eyeYCap: 0.55,
    eyeKnee: 0.7,
    /** seconds a still pointer off the face keeps the attention before the character looks back at the viewer */
    hold: 2.2
  };
  function pointAt(lv, p, x, y, w, h, on) {
    const hd = p.model?.anchors.head, [sx, sy, ox, oy, vw] = p.lastView;
    const drawn = !!hd && vw > 1;
    const fx = drawn ? (hd.cx * sx + ox + 1) / 2 : 0.5, fy = drawn ? (hd.cy * sy + oy + 1) / 2 : 0.3;
    const rx = drawn ? Math.abs(hd.rx * sx) / 2 : 0.12, ry = drawn ? Math.abs(hd.ry * sy) / 2 : 0.1;
    const u = x / Math.max(1, w), v = y / Math.max(1, h);
    lv.pointer = { x: clamp((u - fx) * 2, -1, 1), y: clamp(-(v - fy) * 1.6, -1, 1), d: Math.hypot((u - fx) / rx, (v - fy) / ry), on };
  }
  var LivelyIdle = class {
    nextBlink = 2;
    blinkT = -1;
    blinkAt = -99;
    look = { x: 0, y: 0 };
    blinkRate = 1;
    nextSaccade = 1;
    gaze = { x: 0, y: 0 };
    /** set by the caller while the character talks or plays an action: no idle move starts then, and one playing fades */
    busy = false;
    /** how much the idle moves move (0 turns them off) */
    moves = 1;
    style = { ...IDLE_STYLE };
    /** the head as shown last frame, everything layered over the idle included (the player sets it): what the body follows */
    shown = { x: 0, z: 0 };
    /** the pointer for the 'attend' style (pointAt); `look` stays the 'turn' style's input. keep: a target of the caller's
     *  own (LivLiv Stage: the character who speaks), x, y in the same look units, that holds the attention however long it
     *  stays still (a pointer at rest lets go after ATTEND.hold) */
    pointer = { x: 0, y: 0, d: 99, on: false };
    /** set by the Driver while the webcam drives the character: this idle (what shows while no face is seen) keeps the
     *  'turn' style then, so what tracking shows stays exactly as it was */
    tracked = false;
    /** set by the Driver: no expression shows, so a smile (a whole face) may */
    faceFree = true;
    smiling = false;
    /** 'attend': the pointer last frame and when it last moved, its speed (look units a second), whether it holds the
     *  attention and since when, the attention as the head and eyes follow it, the gaze target's slow follower (a big step
     *  away from it blinks), the soft squint, the tilt's side, and when the notice, the look back and a smile began */
    att = {
      px: 0,
      py: 0,
      on: false,
      moved: -99,
      speed: 0,
      engaged: false,
      since: 0,
      x: 0,
      y: 0,
      slow: { x: 0, y: 0 },
      soft: 0,
      side: 1,
      notice: -99,
      back: -99,
      smile: -99,
      smiled: -99,
      jitter: { x: 0, y: 0 }
    };
    /** the body's share of it, through two short lags */
    fol = { x: 0, z: 0, x2: 0, z2: 0 };
    /** the move playing (name, seconds in, mirrored), and when the next one may start */
    move = null;
    nextMove = 6;
    last = "";
    s = Object.fromEntries(Object.keys(SPRING).map((k) => [k, { x: 0, v: 0 }]));
    /** the targets eased first (0.12 s): a saccade steps the head's target, and a spring pulled by a step starts with a jolt */
    aim = null;
    breathPhase = 0;
    breathPeriod = 3.8;
    double = false;
    seed = Math.random() * 100;
    breath(dt) {
      this.breathPhase += dt / this.breathPeriod;
      if (this.breathPhase >= 1) {
        this.breathPhase -= 1;
        this.breathPeriod = 3.2 + Math.random() * 1.4;
      }
      const x = this.breathPhase;
      return x < 0.4 ? smoothstep(0, 0.4, x) : x < 0.88 ? 1 - smoothstep(0.4, 0.88, x) : 0;
    }
    apply(P, t, dt) {
      dt = dt > 0 ? Math.min(dt, 0.1) : 0;
      const st = this.style;
      const A = st.pointer === "attend" && !this.tracked;
      if (A) this.attend(t, dt);
      const quiet = this.busy || A && this.att.engaged;
      if (this.move) {
        this.move.t += dt;
        if (quiet) this.move.fade = Math.max(0, this.move.fade - dt / 0.4);
        if (this.move.t >= IDLE_MOVES[this.move.id].dur || this.move.fade <= 0) this.move = null;
      } else if (quiet) this.nextMove = Math.max(this.nextMove, t + 3);
      else if (this.moves > 0 && t > this.nextMove) {
        const ids = Object.keys(IDLE_MOVES).filter((k) => k !== this.last);
        const id = ids[Math.floor(Math.random() * ids.length)];
        this.move = { id, t: 0, side: Math.random() < 0.5 ? -1 : 1, fade: 1 };
        this.last = id;
        this.nextMove = t + IDLE_MOVES[id].dur + 10 + Math.random() * 10;
      }
      const m = this.move, M = m ? IDLE_MOVES[m.id] : null;
      const w = m ? m.fade * smoothstep(0, 0.15, m.t) * (1 - smoothstep(M.dur - 0.25, M.dur, m.t)) : 0;
      const mv = (k, rest = 0) => {
        const tr = M?.tracks[k];
        if (!tr) return rest;
        const v = sample(tr, m.t), mirrored = k === "angleX" || k === "angleZ" || k === "bodyX" || k === "bodyZ" || k === "eyeBallX" ? m.side : 1;
        return rest + (v * mirrored - rest) * w * this.moves * (k.startsWith("angle") || k.startsWith("body") ? st.moves : 1);
      };
      let open = 1;
      if (this.blinkT < 0 && t > this.nextBlink) {
        this.blinkT = 0;
        this.blinkAt = t;
      }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const b = this.blinkT / 0.075;
        open = clamp(b < 1 ? 1 - b : b < 2.6 ? (b - 1) / 1.6 : 1, 0, 1);
        if (b >= 2.6) {
          this.blinkT = -1;
          if (!this.double && Math.random() < 0.18) {
            this.double = true;
            this.nextBlink = t + 0.08;
          } else {
            this.double = false;
            this.nextBlink = t + (1.8 + Math.random() * 3.8) / Math.max(0.2, this.blinkRate);
          }
        }
      }
      const eye = clamp(mv("eye", 1), 0, 1) * open;
      P.eyeLOpen = P.eyeROpen = A ? eye * (1 - 0.16 * this.att.soft) : eye;
      const sd = this.seed, L = this.look, lk = st.look, wd = st.wander;
      let gx, gy;
      let target;
      if (A) {
        const a2 = this.att, K = ATTEND;
        if (t > this.nextSaccade) {
          a2.jitter = { x: (Math.random() - 0.5) * 0.2, y: (Math.random() - 0.5) * 0.16 };
          this.nextSaccade = t + 0.6 + Math.random() * 1.6;
        }
        this.gaze = { x: K.eyeX * a2.x + a2.jitter.x, y: K.eyeY * a2.y + a2.jitter.y };
        const ex = this.gaze.x + mv("eyeBallX"), ey = this.gaze.y + mv("eyeBallY"), e = Math.hypot(ex / K.eyeXCap, ey / K.eyeYCap);
        const k = e > K.eyeKnee ? knee(e, K.eyeKnee, 1) / e : 1;
        gx = ex * k;
        gy = ey * k;
        const s = a2.slow;
        if (Math.hypot(gx - s.x, gy - s.y) > 0.5) {
          if (this.blinkT < 0 && t - this.blinkAt > 1.2) this.nextBlink = Math.min(this.nextBlink, t);
          s.x = gx;
          s.y = gy;
        }
        s.x += (gx - s.x) * Math.min(1, dt / 0.35);
        s.y += (gy - s.y) * Math.min(1, dt / 0.35);
        const nod = this.moves > 0 ? 3 * env2(t - a2.notice, 0.12, 0.15, 0.5) - 2.5 * env2(t - a2.back, 0.15, 0.1, 0.45) : 0;
        target = {
          angleX: knee(a2.x * K.yaw * lk + fbm(t * 0.17, sd) * 4 * wd + this.gaze.x * 2 + mv("angleX"), K.yawKnee, K.yawCap),
          angleY: knee(a2.y * K.pitch * lk + fbm(t * 0.13, sd + 1) * 3 * wd + this.gaze.y * 2 + nod + mv("angleY"), K.pitchKnee, K.pitchCap),
          // the tilt toward the pointer's side (+angleZ: the top of the head to the viewer's right), and a little more to
          // one side while it rests on the face
          angleZ: knee(a2.x * K.roll * lk + a2.side * 3 * a2.soft + fbm(t * 0.11, sd + 2) * 5 * wd + mv("angleZ"), K.rollKnee, K.rollCap),
          bodyX: a2.x * K.bodyTurn * lk + fbm(t * 0.09, sd + 3) * 3 * wd + mv("bodyX"),
          bodyZ: a2.x * K.lean * lk + fbm(t * 0.08, sd + 4) * 2.5 * wd + mv("bodyZ")
        };
      } else {
        if (t > this.nextSaccade) {
          this.gaze = { x: this.look.x + (Math.random() - 0.5) * 0.25, y: this.look.y * 0.8 + (Math.random() - 0.5) * 0.2 };
          this.nextSaccade = t + 0.6 + Math.random() * 1.6;
        }
        gx = clamp(this.gaze.x * 1.2 + mv("eyeBallX"), -1, 1);
        gy = clamp(this.gaze.y + mv("eyeBallY"), -1, 1);
        target = {
          angleX: L.x * 20 * lk + fbm(t * 0.17, sd) * 7 * wd + this.gaze.x * 5 + mv("angleX"),
          angleY: L.y * 13 * lk + fbm(t * 0.13, sd + 1) * 4 * wd + this.gaze.y * 3 + mv("angleY"),
          angleZ: -L.x * 4 * lk + fbm(t * 0.11, sd + 2) * 6 * wd + mv("angleZ"),
          bodyX: L.x * 4 * lk + fbm(t * 0.09, sd + 3) * 3 * wd + mv("bodyX"),
          bodyZ: fbm(t * 0.08, sd + 4) * 2.5 * wd + mv("bodyZ")
        };
      }
      P.eyeBallX += (gx - P.eyeBallX) * Math.min(1, dt * 18);
      P.eyeBallY += (gy - P.eyeBallY) * Math.min(1, dt * 18);
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const aim = this.aim ??= { ...target };
      for (const k of Object.keys(SPRING)) {
        const [K, z] = SPRING[k], c = 2 * Math.sqrt(K) * z, s = this.s[k];
        for (let i = 0; i < n; i++) {
          aim[k] += (target[k] - aim[k]) * Math.min(1, dt / n / 0.12);
          s.v += (K * (aim[k] - s.x) - c * s.v) * (dt / n);
          s.x += s.v * (dt / n);
        }
        P[k] = s.x;
      }
      const fl = this.fol, a = Math.min(1, dt / 0.12);
      fl.x += (st.bodyTurn * this.shown.x - fl.x) * a;
      fl.x2 += (fl.x - fl.x2) * a;
      fl.z += (st.bodyTilt * this.shown.z - fl.z) * a;
      fl.z2 += (fl.z - fl.z2) * a;
      if (st.bodyTurn || st.bodyTilt) {
        P.bodyX = clamp(P.bodyX + fl.x2, -10, 10);
        P.bodyZ = clamp(P.bodyZ + fl.z2, -10, 10);
      }
      P.breath = clamp(mv("breath", this.breath(dt)), 0, 1);
      const bt = (A ? this.attendBrow(t) : L.y > 0.4 ? 0.5 : 0) - (1 - open) * 0.15 + mv("brow");
      P.browLY += (bt - P.browLY) * Math.min(1, dt * 10);
      P.browRY = P.browLY;
      if (A) {
        P.smile = t >= this.att.smile && t < this.att.smile + 1.6 ? 1 : 0;
        this.smiling = P.smile > 0;
      } else if (this.smiling) {
        P.smile = 0;
        this.smiling = false;
      }
    }
    /** 'attend': this frame's pointer (onto the stage, moving, resting, gone) and where the attention goes */
    attend(t, dt) {
      const a = this.att, q = this.pointer;
      if (q.on && !a.on) {
        a.notice = t;
        a.moved = t;
        a.px = q.x;
        a.py = q.y;
        a.side = Math.random() < 0.5 ? -1 : 1;
      }
      if (q.on) {
        const step = Math.hypot(q.x - a.px, q.y - a.py);
        a.speed += (step / Math.max(dt, 1e-3) - a.speed) * Math.min(1, dt / 0.15);
        if (step > 3e-3) a.moved = t;
        a.px = q.x;
        a.py = q.y;
      } else a.speed *= Math.max(0, 1 - dt / 0.15);
      a.on = q.on;
      const onFace = q.on && q.d < 1;
      const engaged = q.on && (onFace || !!q.keep || t - a.moved < ATTEND.hold);
      if (engaged !== a.engaged) {
        if (!engaged && t - a.since > 0.8) {
          a.back = t;
          this.nextMove = Math.max(this.nextMove, t + 6);
        }
        a.since = t;
        a.engaged = engaged;
      }
      const sm = this.style.smile ?? 0;
      if (onFace && t - a.moved > 1.2 && sm > 0 && this.faceFree && !this.busy && t - a.smiled > 25 && t > a.smile + 1.6) {
        if (a.smiled < 0 || Math.random() < sm) a.smile = t;
        a.smiled = t;
      }
      const smiling = t >= a.smile && t < a.smile + 1.6;
      const soft = smiling ? 0 : Math.max(onFace && t - a.moved > 0.5 ? 1 : 0, env2(t - a.back, 0.2, 0.6, 0.6));
      a.soft += (soft - a.soft) * Math.min(1, dt / 0.25);
      a.x = engaged ? q.x : 0;
      a.y = engaged ? q.y : 0;
    }
    /** 'attend': the brows' lift (before the blink's dip and the idle move's) */
    attendBrow(t) {
      const a = this.att, q = this.pointer;
      const near = q.on && t - a.moved < 0.3 ? 1 - smoothstep(1, 2.2, q.d) : 0;
      return Math.min(0.7, 0.4 * smoothstep(0.35, 0.9, a.y) + 0.3 * smoothstep(1.5, 5, a.speed) + 0.15 * near + 0.45 * env2(t - a.notice, 0.08, 0.25, 0.35) + 0.2 * env2(t - a.back, 0.15, 0.3, 0.5) + 0.12 * a.soft);
    }
  };

  // vendor/livliv-player/src/follow.ts
  var IDLE_KEYS = ["angleX", "angleY", "angleZ", "eyeLOpen", "eyeROpen", "eyeBallX", "eyeBallY", "browLY", "browRY", "bodyX", "bodyZ", "breath"];
  var clamp2 = (v, a, b) => Math.min(b, Math.max(a, v));
  var Idle = class {
    lv = new LivelyIdle();
    P = defaultParams();
    /** the 'turn' style's input, which the idle keeps while a face tracker drives (what tracking shows stays as it was) */
    turn = { x: 0, y: 0 };
    /** lookAt's target holds the attention: the pointer is not followed meanwhile */
    held = false;
    constructor() {
      if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) this.lv.moves = 0;
    }
    /** one frame of the idle motion into P: the keys it sets, and its smile over P's */
    apply(P, t, dt, now) {
      const lv = this.lv;
      lv.busy = now.busy;
      lv.tracked = now.tracked;
      lv.faceFree = now.faceFree;
      lv.look = this.turn;
      lv.apply(this.P, t, dt);
      for (const k of IDLE_KEYS) P[k] = this.P[k];
      P.smile = Math.max(P.smile, this.P.smile);
    }
    /** after the frame: the head as shown, everything over the idle included (the body follows it) */
    shown(P) {
      this.lv.shown.x = P.angleX;
      this.lv.shown.z = P.angleZ;
    }
    /** the pointer at (x, y), CSS px from the canvas's top left (w × h its CSS size); on: it counts as on the stage (off,
     *  the character looks back) */
    pointer(p, x, y, w, h, on) {
      if (this.held) return;
      pointAt(this.lv, p, x, y, w, h, on);
      if (on) this.turn = { x: clamp2((x / Math.max(1, w) - 0.5) * 2, -1, 1), y: clamp2(-(y / Math.max(1, h) - 0.3) * 1.6, -1, 1) };
    }
    /** the pointer left the page */
    leave() {
      if (!this.held) this.lv.pointer.on = false;
      this.turn = { x: 0, y: 0 };
    }
    /** looks toward (x, y), each -1..1 from the canvas center (y up), and keeps looking there; null lets go */
    lookAt(p, x, y, w, h) {
      this.held = false;
      if (x === null) {
        this.lv.pointer = { ...this.lv.pointer, on: false, keep: false };
        this.turn = { x: 0, y: 0 };
        return;
      }
      this.pointer(p, (x + 1) / 2 * w, (1 - y) / 2 * h, w, h, true);
      this.lv.pointer.keep = true;
      this.held = true;
      this.turn = { x, y };
    }
    blink(t) {
      this.lv.nextBlink = Math.min(this.lv.nextBlink, t);
    }
  };

  // vendor/livliv-player/src/release.ts
  var spent = /* @__PURE__ */ new WeakSet();
  var going = /* @__PURE__ */ new WeakMap();
  function releaseCanvas(canvas, gl) {
    if (!gl || spent.has(canvas) || going.has(canvas)) return;
    const timer = setTimeout(() => {
      going.delete(canvas);
      spent.add(canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    });
    going.set(canvas, () => clearTimeout(timer));
  }
  function claimCanvas(canvas) {
    going.get(canvas)?.();
    going.delete(canvas);
    if (spent.has(canvas)) throw new LivLivError("released", "LivLiv: this canvas gave up its WebGL context with dispose({ release: true }): use a new canvas");
  }

  // vendor/livliv-player/src/profile.ts
  var TRACKING_PARAMETERS = ["angleX", "angleY", "angleZ", "eyeLOpen", "eyeROpen", "eyeBallX", "eyeBallY", "browLY", "browRY", "mouthOpen", "smile", "bodyX"];
  var clamp3 = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function parameterRule(key) {
    return { input: [...PARAM_RANGES[key]], output: [...PARAM_RANGES[key]], smoothing: 0, curve: 1 };
  }
  function readTrackingProfile(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result = {};
    for (const key of TRACKING_PARAMETERS) {
      const raw = value[key];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const r = raw, rule = parameterRule(key), [lo, hi] = PARAM_RANGES[key];
      const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? [clamp3(v[0], lo, hi), clamp3(v[1], lo, hi)] : null;
      const input = pair(r.input), output = pair(r.output);
      if (input && input[1] - input[0] > 1e-6) rule.input = input;
      if (output) rule.output = output;
      if (typeof r.smoothing === "number" && Number.isFinite(r.smoothing)) rule.smoothing = clamp3(r.smoothing, 0, 1);
      if (typeof r.curve === "number" && Number.isFinite(r.curve)) rule.curve = clamp3(r.curve, 0.2, 3);
      result[key] = rule;
    }
    return result;
  }
  var TrackingFilter = class {
    rules = {};
    previous = {};
    last = null;
    constructor(profile) {
      this.profile = profile ?? {};
    }
    get profile() {
      return readTrackingProfile(this.rules);
    }
    set profile(value) {
      const next = readTrackingProfile(value);
      for (const key of TRACKING_PARAMETERS) {
        if (JSON.stringify(next[key]) !== JSON.stringify(this.rules[key])) delete this.previous[key];
      }
      this.rules = next;
    }
    get sample() {
      return this.last && { input: { ...this.last.input }, output: { ...this.last.output } };
    }
    apply(input, dt) {
      const output = { ...input };
      for (const key of Object.keys(this.rules)) {
        const r = this.rules[key], [a, b] = r.input;
        let t = clamp3((input[key] - a) / (b - a), 0, 1);
        if (a < 0 && b > 0) {
          const zero = -a / (b - a);
          t = t < zero ? zero - zero * Math.pow((zero - t) / zero, r.curve) : zero + (1 - zero) * Math.pow((t - zero) / (1 - zero), r.curve);
        } else t = Math.pow(t, r.curve);
        const target = r.output[0] + t * (r.output[1] - r.output[0]), previous = this.previous[key] ?? target;
        const alpha = r.smoothing ? 1 - Math.exp(-Math.max(0, dt) / (0.5 * r.smoothing)) : 1;
        output[key] = this.previous[key] = previous + (target - previous) * alpha;
      }
      this.last = { input: { ...input }, output };
      return output;
    }
    reset() {
      this.previous = {};
      this.last = null;
    }
  };

  // vendor/livliv-player/src/base.ts
  var clamp4 = (v, a, b) => Math.min(b, Math.max(a, v));
  var aborted = (why) => new DOMException(`LivLiv: ${why}`, "AbortError");
  var contextGone = () => new LivLivError("context-lost", "LivLiv: this canvas has lost its WebGL context: use a new canvas and a new player");
  async function readBody(r, job, share = (p) => p) {
    const size = r.headers.get("content-encoding") ? 0 : Number(r.headers.get("content-length")) || 0;
    if (!r.body) return r.blob();
    const reader = r.body.getReader(), parts = [];
    let got = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
      if (size) job.progress(share(Math.min(1, got / size)));
    }
    return new Blob(parts);
  }
  var DEFAULTS = defaultParams();
  var KEYS = Object.keys(PARAM_RANGES);
  function inRange(P) {
    for (const k of KEYS) {
      const v = +P[k];
      P[k] = v === v ? clamp4(v, PARAM_RANGES[k][0], PARAM_RANGES[k][1]) : DEFAULTS[k];
    }
  }
  var finite = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
  var FITS = ["frame", "whole", "knee"];
  var DOWN = 0.15;
  var PlayerBase = class {
    canvas;
    /** your values for the pose and face (ranges in PARAM_RANGES). The player never changes them */
    params = defaultParams();
    /** see PlayerOptions.idle */
    idle;
    /** Scale torso turn and lean before the user parameter mapping (0..1). Replayed poses are already scaled. */
    bodyMotion = 1;
    /** see PlayerOptions.followPointer */
    followPointer;
    /** see PlayerOptions.renderWhenHidden */
    renderWhenHidden;
    view = { x: 0, y: 0, zoom: 1, head: false, fit: "frame" };
    /** see PlayerOptions.lang */
    lang;
    /** Called when the canvas's WebGL context is lost (a phone reclaiming the page's GPU memory, a driver reset, too many
     *  contexts on the page). The character is gone from this canvas and does not come back by itself: put a new canvas in
     *  its place and make a new player. On a page with many players, a new context can push out another: release those
     *  that have left (dispose({ release: true })) */
    onContextLost;
    /** Called after a frame is drawn, with an independent copy of its final pose. */
    onFrame;
    /** @internal */
    replaying = false;
    replaySize = null;
    renderSize = null;
    /** @internal */
    info = null;
    /** @internal */
    disposed = false;
    idler = new Idle();
    parameterFilter = new TrackingFilter();
    /** last frame's: a face tracker drove it, the mouth moved (the idle starts no move while the character talks) */
    was = { tracked: false, mouth: 0 };
    /** @internal */
    actions = new ActionPlayer();
    drivers = [];
    expr = {};
    smile = 0;
    raf = 0;
    last = 0;
    visible = true;
    io;
    queue = Promise.resolve();
    lost = false;
    /** the load that a new one replaces */
    running = null;
    /** the canvas's own background while a poster is showing */
    posterOver = null;
    /** @internal */
    frame;
    /** a full-body character's crouch and dip this frame, and the talking bob they came from (see PlaybackPose)
     *  @internal */
    ground = { crouch: 0, dip: 0, talk: 0 };
    /** pose: the Params the subclass draws from, written to each frame */
    constructor(canvas, pose, options) {
      this.canvas = canvas;
      this.parameterProfile = options.parameterProfile ?? {};
      this.idle = options.idle ?? true;
      this.followPointer = options.followPointer ?? "page";
      this.lang = options.lang || uiLang();
      this.renderWhenHidden = options.renderWhenHidden ?? false;
      this.frame = {
        params: pose,
        dt: 0,
        time: 0,
        tracked: false,
        move: { x: 0, y: 0, s: 1 },
        talk: 0,
        grounded: false,
        add(o) {
          for (const [k, v] of Object.entries(o)) {
            if (v) pose[k] = clamp4(pose[k] + v, PARAM_RANGES[k][0], PARAM_RANGES[k][1]);
          }
        }
      };
      addEventListener("pointermove", this.onMove);
      document.addEventListener("pointerleave", this.onLeave);
      canvas.addEventListener("webglcontextlost", this.onLost);
      if (typeof IntersectionObserver !== "undefined") {
        this.io = new IntersectionObserver((e) => {
          this.visible = e[e.length - 1].isIntersecting;
        });
        this.io.observe(canvas);
      }
      if (options.autoplay ?? true) this.play();
    }
    /** the character stands on a ground line (a full-body character)
     *  @internal */
    get grounded() {
      return false;
    }
    /** this frame's move from the drivers' (frame.move), their talking bob (frame.talk) and an action's (actY): added up,
     *  as a half-body character moves. A full-body character's player turns them into a sway, a crouch and a dip
     *  @internal */
    place(actY) {
      const f = this.frame;
      f.move.y = f.move.y + f.talk + actY;
      this.ground.crouch = 0;
      this.ground.dip = 0;
      this.ground.talk = 0;
    }
    /** the canvas's WebGL context is gone: nothing draws, and load() rejects with code 'context-lost' */
    get contextLost() {
      return this.lost || !!this.gl?.isContextLost();
    }
    /** the loaded character (null before the first load) */
    get model() {
      return this.info;
    }
    // the return type is the model's own expressions: without it the declaration emitter resolves Info['expressions']
    // to the constraint ({ id: string }[]) and consumers lose `label` / `labels`
    get expressions() {
      return this.info?.expressions ?? [];
    }
    get playing() {
      return this.raf !== 0;
    }
    /** runs a load: the one running is called off, and this one's steps are told how to be. A load called off rejects like
     *  any other, but nobody has to catch it (player.load(a); player.load(b) reports nothing); a real error is still
     *  reported when nobody catches it
     *  @internal */
    start({ signal, onProgress, poster }, load) {
      let give, refuse;
      const out = new Promise((a, b) => {
        give = a;
        refuse = b;
      });
      const fail2 = (e) => {
        if (e?.name === "AbortError") out.catch(() => {
        });
        refuse(e);
      };
      if (signal?.aborted) {
        fail2(signal.reason);
        return out;
      }
      if (this.disposed) {
        fail2(aborted("the player was disposed"));
        return out;
      }
      if (this.contextLost) {
        fail2(contextGone());
        return out;
      }
      this.running?.abort(aborted("a newer load took its place"));
      const ctl = this.running = new AbortController();
      const calledOff = () => ctl.abort(signal.reason);
      signal?.addEventListener("abort", calledOff, { once: true });
      this.setPoster(poster);
      const tell = (p) => {
        try {
          onProgress?.(p);
        } catch (e) {
          console.error(e);
        }
      };
      let shown = -1, built = false;
      const job = {
        signal: ctl.signal,
        progress(share) {
          if (share > shown && !built) {
            shown = share;
            tell({ step: "download", progress: share });
          }
        },
        build() {
          if (!built) {
            if (shown >= 0 && shown < 1) tell({ step: "download", progress: 1 });
            built = true;
            tell({ step: "build" });
          }
        }
      };
      const end = () => {
        signal?.removeEventListener("abort", calledOff);
        if (this.running === ctl) this.running = null;
      };
      load(job).then((v) => {
        end();
        give(v);
      }, (e) => {
        const mine = this.running === ctl;
        end();
        if (mine) this.setPoster();
        fail2(ctl.signal.aborted ? ctl.signal.reason : e);
      });
      return out;
    }
    /** the poster over an empty canvas, or none */
    setPoster(url) {
      const s = this.canvas.style;
      if (this.posterOver) {
        for (const [k, v] of Object.entries(this.posterOver)) s.setProperty(k, v);
        this.posterOver = null;
      }
      if (!url || this.info) return;
      const set = { "background-image": `url(${JSON.stringify(String(url))})`, "background-position": "center", "background-size": "contain", "background-repeat": "no-repeat" };
      this.posterOver = Object.fromEntries(Object.keys(set).map((k) => [k, s.getPropertyValue(k)]));
      for (const [k, v] of Object.entries(set)) s.setProperty(k, v);
    }
    /** runs `load` after the loads before it
     *  @internal */
    inTurn(load) {
      const run = this.queue.then(load);
      this.queue = run.catch(() => {
      });
      return run;
    }
    /** a new character starts on a neutral face
     *  @internal */
    neutral() {
      this.expr = {};
      this.smile = 0;
      this.replaying = false;
      this.parameterFilter.reset();
      this.ground = { crouch: 0, dip: 0, talk: 0 };
    }
    /** Shared motion response for idle, pointer, tracking and speech. Setting it does not restart drivers. */
    get parameterProfile() {
      return this.parameterFilter.profile;
    }
    set parameterProfile(value) {
      this.parameterFilter.profile = value;
    }
    /** Final live parameters before and after the response mapping; null before the first live frame. */
    get parameterSample() {
      return this.parameterFilter.sample;
    }
    /** Shows an expression (an id from `expressions`), easing over from the one before; null goes back to neutral.
     *  weight: how strongly, 0..1. False when the model has no such expression */
    setExpression(id, weight = 1) {
      if (id !== null && !this.expressions.some((e) => e.id === id)) return false;
      const w = clamp4(weight, 0, 1);
      this.smile = id === "smile" ? w : 0;
      this.expr = id === null || id === "smile" ? {} : { [id]: w };
      return true;
    }
    /** Plays a short move over whatever drives the character: nod, shake, tilt, hop, shy */
    act(action, strength = 1) {
      if (action === "away") throw new TypeError("LivLiv: act('away') is setAway(true) now");
      this.actions.play(action, strength);
    }
    /** Dozes (eyes closed, head down, a slow breath, expressions hidden), easing in, until setAway(false) */
    setAway(on) {
      this.actions.setAway(on);
    }
    /** Looks toward (x, y), each -1..1 from the canvas center (y up), instead of following the pointer; null goes back to
     *  following it. Needs the idle motion on */
    lookAt(x, y = 0) {
      this.idler.lookAt(this.seen(), x === null ? null : clamp4(x, -1, 1), clamp4(y, -1, 1), this.canvas.clientWidth || this.canvas.width, this.canvas.clientHeight || this.canvas.height);
    }
    /** Blinks now (with the idle motion on) */
    blink() {
      this.idler.blink(this.clock);
    }
    /** Adds a driver; returns a function that removes it. On a disposed player it is disposed at once: what started
     *  while the player went (a camera, a microphone) does not stay on */
    use(driver) {
      if (this.disposed) {
        driver.dispose?.();
        return () => {
        };
      }
      this.drivers.push(driver);
      this.drivers.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return () => {
        const i = this.drivers.indexOf(driver);
        if (i >= 0) {
          this.drivers.splice(i, 1);
          driver.dispose?.();
        }
      };
    }
    play() {
      if (this.raf || this.disposed) return;
      this.replaying = false;
      this.last = performance.now();
      const loop = (now) => {
        this.raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - this.last) / 1e3);
        this.last = now;
        if (this.visible || this.renderWhenHidden) this.draw(dt);
      };
      this.raf = requestAnimationFrame(loop);
    }
    pause() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    /** CharaDock: draw one frame from the host loop. */
    advance(dt) {
      this.draw(clamp4(dt, 0, 0.05));
    }
    /** CharaDock: a detached canvas has no CSS size; its buffer is sized by the host. */
    get detachedSize() {
      return this.canvas.isConnected ? null : [this.canvas.width, this.canvas.height];
    }
    /** Draws now at the canvas's current size. A playing player follows the size by itself; call this after resizing a
     *  paused one */
    resize() {
      if (this.replaying) this.renderPose(this.getPose());
      else this.draw(0);
    }
    /** The current frame as an image (PNG data URL), as the pose is now, the mark included */
    snapshot() {
      if (this.replaying) this.renderPose(this.getPose(), 0, this.replaySize ?? void 0);
      else this.draw(0);
      return this.canvas.toDataURL("image/png");
    }
    /** The final pose of the last frame, copied so a recording cannot change the player. */
    getPose() {
      const pose = { params: { ...this.frame.params }, move: { ...this.frame.move }, expr: { ...this.shownExpr }, view: { ...this.view } };
      if (this.grounded) Object.assign(pose, this.ground);
      return pose;
    }
    /** Draws a recorded pose without running idle motion, drivers or actions again. Pause first. `dt` advances hair and
     *  other physics; `size` sets exact output pixels even on a detached canvas. The model's mark is retained. The player
     *  takes the pose's view. Nothing is drawn before a model is loaded, after dispose() or once the context is lost */
    renderPose(pose, dt = 0, size) {
      if (this.playing) throw new TypeError("LivLiv: pause the player before rendering a recorded pose");
      if (!Number.isFinite(dt) || dt < 0 || size && (size.length !== 2 || size.some((n) => !Number.isInteger(n) || n < 1))) {
        throw new TypeError("LivLiv: renderPose needs a nonnegative dt and positive integer output dimensions");
      }
      if (!this.drawable || this.disposed || this.contextLost) return;
      const f = this.frame, V = this.view, M = pose.move, W = pose.view;
      Object.assign(f.params, pose.params);
      inRange(f.params);
      Object.assign(f.move, { x: finite(M?.x, 0), y: finite(M?.y, 0), s: finite(M?.s, 1) });
      const g = this.grounded, down = (v) => g ? clamp4(finite(v, 0), -DOWN, 0) : 0;
      if (g) f.move.y = Math.max(0, f.move.y);
      this.ground = { crouch: down(pose.crouch), dip: down(pose.dip), talk: down(pose.talk) };
      Object.assign(V, {
        x: finite(W?.x, V.x),
        y: finite(W?.y, V.y),
        zoom: finite(W?.zoom, V.zoom),
        head: typeof W?.head === "boolean" ? W.head : V.head,
        fit: FITS.includes(W?.fit) ? W.fit : V.fit
      });
      const expr = this.shownExpr;
      for (const key of Object.keys(expr)) delete expr[key];
      for (const [key, w] of Object.entries(pose.expr ?? {})) expr[key] = clamp4(finite(w, 0), 0, 1);
      this.replaying = true;
      this.replaySize = size ?? null;
      this.renderSize = this.replaySize;
      try {
        this.show(dt);
      } finally {
        this.renderSize = null;
      }
      this.onFrame?.(this.getPose());
    }
    /** Stops, removes the drivers and frees the GPU memory. A load still running rejects. The canvas keeps its WebGL context
     *  and can take a new player afterwards. release: also give the context up, when the canvas is leaving the page: a
     *  browser allows about 16 at once and drops the oldest past that, which may be a character still showing. A canvas
     *  released this way takes no new player, unless it is made at once, in the same task (a framework's unmount and mount).
     *  Safari does not get the room back: reuse canvases there */
    dispose({ release = false } = {}) {
      const gl = this.gl;
      this.stop();
      if (release) releaseCanvas(this.canvas, gl);
    }
    stop() {
      if (this.disposed) return;
      this.pause();
      this.disposed = true;
      this.running?.abort(aborted("the player was disposed"));
      this.setPoster();
      removeEventListener("pointermove", this.onMove);
      document.removeEventListener("pointerleave", this.onLeave);
      this.canvas.removeEventListener("webglcontextlost", this.onLost);
      this.io?.disconnect();
      for (const d of this.drivers.splice(0)) d.dispose?.();
      this.onFrame = void 0;
      this.free();
      this.info = null;
    }
    draw(dt) {
      if (!this.drawable || this.disposed || this.contextLost) return;
      const f = this.frame, P = f.params, t = this.clock, E = this.shownExpr, A = this.actions;
      this.idler.shown(P);
      Object.assign(P, this.params);
      if (this.idle) {
        this.idler.apply(P, t, dt, {
          busy: A.busy || this.was.mouth > 0.05,
          tracked: this.was.tracked,
          faceFree: !this.smile && !Object.values(E).some((v) => v > 0.02)
        });
      }
      Object.assign(f, { dt, time: t, tracked: false, talk: 0, grounded: this.grounded });
      Object.assign(f.move, { x: 0, y: 0, s: 1 });
      for (const d of this.drivers) d.update(f, this);
      this.was = { tracked: f.tracked, mouth: P.mouthOpen };
      A.grounded = f.grounded;
      f.add(A.update(dt));
      const body = Number.isFinite(this.bodyMotion) ? clamp4(this.bodyMotion, 0, 1) : 1;
      P.bodyX *= body;
      P.bodyZ *= body;
      if (this.smile) P.smile = Math.max(P.smile, this.smile);
      if (A.awayW) for (const [k, v] of Object.entries(A.awayPose(t))) P[k] += (v - P[k]) * A.awayW;
      inRange(P);
      Object.assign(P, this.parameterFilter.apply(P, dt));
      for (const k of Object.keys(this.expr)) if (!(k in E)) E[k] = 0;
      for (const k of Object.keys(E)) E[k] += ((this.expr[k] ?? 0) * (1 - A.awayW) - E[k]) * Math.min(1, dt * 8);
      const M = f.move;
      M.x = finite(M.x, 0);
      M.y = finite(M.y, 0);
      M.s = finite(M.s, 1);
      f.talk = finite(f.talk, 0);
      this.place(A.y);
      this.show(dt);
      this.onFrame?.(this.getPose());
      if (this.posterOver) this.setPoster();
    }
    onMove = (e) => {
      if (!this.followPointer) return;
      const r = this.canvas.getBoundingClientRect();
      const inside = !(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      this.idler.pointer(this.seen(), e.clientX - r.left, e.clientY - r.top, r.width, r.height, this.followPointer === "page" || inside);
    };
    onLeave = () => this.idler.leave();
    onLost = () => {
      this.lost = true;
      this.running?.abort(contextGone());
      this.onContextLost?.();
    };
  };

  // vendor/livliv-player/src/runtime/brand.ts
  var BRAND_MARK = "LivLiv";
  var CORAL = "#ff4d5e";
  var LOGO_BOX = [27, 44, 430, 133];
  var LETTERS = "M101.5 62.5V141.5Q101.5 158.5 115.5 158.5M145 107.5V158.5M176.3 107.5L200.5 158.5L224.7 107.5M257.5 62.5V141.5Q257.5 158.5 271.5 158.5M303 107.5V158.5M335.3 107.5L359.5 158.5L383.7 107.5";
  var BLUSH = "M40.5 122L49.5 142.1M60.5 122L69.5 142.1M421.5 122L412.5 142.1M441.5 122L432.5 142.1";
  var EYE = { cx: 145, cy: 67, r: 13.5 };
  var WINK = "M293.5 69H312.5A8 8 0 0 1 312.5 85H293.5A8 8 0 0 1 293.5 69Z";
  var WATERMARK = {
    center: 0.3,
    centerY: 0.62,
    centerAlpha: 0.3,
    centerRim: 0.2,
    centerEdge: 3.2,
    corner: 0.13,
    cornerMin: 64,
    margin: 0.035,
    text: 0.026,
    top: 0.12
    // a portrait video's corner mark starts this far down (cornerSpot)
  };
  function eyeOpen(ms) {
    const f = ms % 5500 / 5500;
    if (f < 0.93) return 1;
    return f < 0.955 ? 1 - (f - 0.93) / 0.025 * 0.88 : 0.12 + (f - 0.955) / 0.045 * 0.88;
  }
  function drawLogo(g, right, bottom, height, color, ms = 0, accent = CORAL, edge = 0, edgeColor = "#222") {
    const [x0, y0, w, h] = LOGO_BOX;
    const k = height / h;
    g.save();
    g.translate(right - w * k, bottom - height);
    g.scale(k, k);
    g.translate(-x0, -y0);
    g.lineCap = "round";
    g.lineJoin = "round";
    if (edge) {
      g.strokeStyle = edgeColor;
      g.lineWidth = 25 + edge * 2;
      g.stroke(new Path2D(LETTERS));
      g.lineWidth = 12.5 + edge * 2;
      g.stroke(new Path2D(BLUSH));
      g.lineWidth = edge * 2;
      g.beginPath();
      g.ellipse(EYE.cx, EYE.cy, EYE.r, EYE.r * eyeOpen(ms), 0, 0, Math.PI * 2);
      g.stroke();
      g.stroke(new Path2D(WINK));
    }
    g.strokeStyle = color;
    g.lineWidth = 25;
    g.stroke(new Path2D(LETTERS));
    g.strokeStyle = accent;
    g.lineWidth = 12.5;
    g.stroke(new Path2D(BLUSH));
    g.fillStyle = accent;
    g.beginPath();
    g.ellipse(EYE.cx, EYE.cy, EYE.r, EYE.r * eyeOpen(ms), 0, 0, Math.PI * 2);
    g.fill();
    g.fill(new Path2D(WINK));
    g.restore();
  }
  function cornerSpot(w, h, top = false, px = 1) {
    const { corner, cornerMin, margin, text } = WATERMARK;
    const s = Math.min(w, h), m = Math.max(12 * px, s * margin);
    return {
      right: w - m,
      y: top ? h > w ? h * WATERMARK.top : m : h - m,
      top,
      logo: Math.max(cornerMin * px, s * corner) * LOGO_BOX[3] / LOGO_BOX[2],
      text: Math.max(12 * px, s * text)
    };
  }
  function drawCornerLogo(g, w, h, ms = 0, px = 1, top = false, outline = false) {
    const c = cornerSpot(w, h, top, px);
    g.save();
    if (!outline) {
      g.shadowColor = "rgba(0,0,0,.55)";
      g.shadowBlur = c.logo * 0.12;
    }
    drawLogo(g, c.right, c.top ? c.y + c.logo : c.y, c.logo, outline ? "#fff" : "rgba(255,255,255,.95)", ms, CORAL, outline ? 9 : 0);
    g.restore();
  }
  function drawMarkText(g, w, h, text, px = 1, top = false) {
    const c = cornerSpot(w, h, top, px);
    g.save();
    g.shadowColor = "rgba(0,0,0,.6)";
    g.shadowBlur = c.text * 0.25;
    g.font = `600 ${c.text}px system-ui, sans-serif`;
    g.textAlign = "right";
    g.textBaseline = c.top ? "top" : "bottom";
    g.fillStyle = "rgba(255,255,255,.85)";
    g.fillText(text, c.right, c.y);
    g.restore();
  }
  var SPRITE_PAD = 4;
  var sprites = /* @__PURE__ */ new Map();
  function sprite(w, h) {
    return typeof OffscreenCanvas === "undefined" ? Object.assign(document.createElement("canvas"), { width: w, height: h }) : new OffscreenCanvas(w, h);
  }
  function centerLogo(cw, ch, ms) {
    const eye = Math.round(eyeOpen(ms) * 10), key = `${ch.toFixed(2)}:${eye}`;
    let out = sprites.get(key);
    if (out) return out;
    const { centerAlpha, centerRim, centerEdge } = WATERMARK;
    const w = Math.ceil(cw) + SPRITE_PAD * 2, h = Math.ceil(ch) + SPRITE_PAD * 2, right = cw + SPRITE_PAD, bottom = ch + SPRITE_PAD;
    const ring = sprite(w, h), r = ring.getContext("2d");
    drawLogo(r, right, bottom, ch, "#000", ms, "#000", centerEdge, "#000");
    r.globalCompositeOperation = "destination-out";
    drawLogo(r, right, bottom, ch, "#000", ms, "#000");
    out = sprite(w, h);
    const g = out.getContext("2d");
    g.globalAlpha = centerRim;
    g.drawImage(ring, 0, 0);
    g.globalAlpha = centerAlpha;
    drawLogo(g, right, bottom, ch, "#fff", ms, "#fff");
    if (sprites.size > 64) sprites.clear();
    sprites.set(key, out);
    return out;
  }
  function drawWatermark(g, w, h, ms = 0, px = 1, top = false) {
    const { center, centerY } = WATERMARK;
    const cw = Math.min(w, h) * center, ch = cw * LOGO_BOX[3] / LOGO_BOX[2];
    g.drawImage(centerLogo(cw, ch, ms), (w - cw) / 2 - SPRITE_PAD, h * centerY - ch / 2 - SPRITE_PAD);
    drawCornerLogo(g, w, h, ms, px, top);
  }

  // vendor/livliv-player/src/mark.ts
  var VS2 = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv=vec2(aPos.x*.5+.5,.5-aPos.y*.5); gl_Position=vec4(aPos,0.,1.); }`;
  var FS2 = `#version 300 es
precision mediump float; in vec2 vUv; uniform sampler2D uTex; out vec4 o;
void main(){ o=texture(uTex,vUv); }`;
  var Mark = class {
    /** the logo (the free plan's watermark), or `text` in the corner (the owner's own), or nothing */
    logo = false;
    text = null;
    gl;
    prog;
    vao;
    buf;
    tex;
    c = document.createElement("canvas");
    /** what the texture holds now: size, text and (the logo's first i is an eye that blinks) how open the eye is */
    drawn = "";
    constructor(gl) {
      this.gl = gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const p = this.prog = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS2));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS2));
      gl.bindAttribLocation(p, 0, "aPos");
      gl.linkProgram(p);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    /** what to draw: a package's meta.watermark kind ("livliv": the logo; "text": `text`; "none"). center: the logo also
     *  light over the character (the free plan's); false, in the corner only (meta.watermark.center: the featured
     *  characters) */
    set(kind, text, center = true) {
      this.logo = kind === "livliv";
      this.text = kind === "text" ? text : null;
      this.center = center;
    }
    center = true;
    /** over the frame just rendered; `dpr`: drawing-buffer pixels per CSS pixel, so the mark is as big as on livliv.ai */
    draw(now, dpr) {
      const text = this.logo ? BRAND_MARK : this.text, gl = this.gl;
      if (!text) return;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const key = `${w}x${h}:${dpr}:${this.logo ? Math.round(eyeOpen(now) * 10) : ""}:${this.logo}:${this.center}:${text}`;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      if (key !== this.drawn) {
        this.drawn = key;
        const c = this.c;
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const g = c.getContext("2d");
        g.clearRect(0, 0, w, h);
        g.save();
        if (this.logo && this.center) drawWatermark(g, w, h, now, dpr);
        else if (this.logo) drawCornerLogo(g, w, h, now, dpr);
        else drawMarkText(g, w, h, text, dpr);
        g.restore();
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      }
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.prog);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }
    dispose() {
      const gl = this.gl;
      gl.deleteTexture(this.tex);
      gl.deleteBuffer(this.buf);
      gl.deleteVertexArray(this.vao);
      gl.deleteProgram(this.prog);
    }
  };

  // vendor/livliv-player/src/zip.ts
  var ZIP_LIMITS = { entries: 2048, bytes: 256 * 2 ** 20, modelJson: LIMITS.modelJson, keyforms: LIMITS.keyforms };
  var fail = (why, code = "invalid") => new LivLivError(code, `LivLiv: ${why}`);
  var TYPES = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json" };
  async function isZip(b) {
    const h = new Uint8Array(await b.slice(0, 4).arrayBuffer());
    return h.length === 4 && h[0] === 80 && h[1] === 75 && (h[2] === 3 && h[3] === 4 || h[2] === 5 && h[3] === 6);
  }
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

  // vendor/livliv-player/src/index.ts
  var VERSION = "0.5.1";
  var SMILE = { zh: "\u7B11", "zh-Hant": "\u7B11", en: "Smile", ja: "\u7B11\u9854" };
  var NO_WEBGL2 = "this browser has no WebGL2";
  var Player = class extends PlayerBase {
    /** the renderer underneath: not part of the API, and not in the types
     *  @internal */
    puppet;
    mark;
    /** Whether this browser can play a LivLiv model (WebGL2 starts on a new canvas). Where it cannot, new Player() throws */
    static isSupported() {
      const gl = document.createElement("canvas").getContext("webgl2");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return !!gl;
    }
    constructor(canvas, options = {}) {
      claimCanvas(canvas);
      let puppet;
      try {
        puppet = new Puppet(canvas);
      } catch (e) {
        if (canvas.getContext("webgl2")?.isContextLost()) throw new LivLivError("context-lost", "LivLiv: this canvas has lost its WebGL context: use a new canvas", { cause: e });
        throw new LivLivError("no-webgl", typeof WebGL2RenderingContext === "undefined" ? "LivLiv: this browser has no WebGL2" : e.message === NO_WEBGL2 ? "LivLiv: could not start WebGL2 on this canvas: it is turned off in this browser, or the canvas already draws in 2D" : `LivLiv: could not start WebGL2 on this canvas (${e.message})`, { cause: e });
      }
      super(canvas, puppet.params, options);
      this.puppet = puppet;
      this.puppet.maxDpr = options.maxPixelRatio ?? 2;
      this.mark = new Mark(this.puppet.gl);
    }
    /** see PlayerOptions.maxPixelRatio */
    get maxPixelRatio() {
      return this.puppet.maxDpr;
    }
    set maxPixelRatio(v) {
      this.puppet.maxDpr = v;
    }
    /** @internal */
    get gl() {
      return this.puppet.gl;
    }
    /** @internal */
    get drawable() {
      return !!this.puppet.model;
    }
    /** @internal */
    get clock() {
      return this.puppet.time;
    }
    /** @internal */
    get shownExpr() {
      return this.puppet.expr;
    }
    /** @internal */
    seen() {
      return this.puppet;
    }
    /** A point on the canvas (CSS px from its top left) in the model's own px, as the last frame drew it */
    canvasToModel(x, y) {
      return this.puppet.canvasToModel(x, y);
    }
    /** A flick at a point in the model's px (canvasToModel): the swinging pieces passing near it are thrown, the nearest
     *  joint hardest (a tap on a twin tail). Returns how many it moved: none on a model without any */
    poke(x, y, strength = 1) {
      return this.puppet.poke(x, y, strength);
    }
    /** Loads a model (see ModelSource) and shows it in place of the one before. A load that fails keeps it; a new load
     *  replaces one still running, which rejects with an AbortError (see LoadOptions) */
    load(source, options = {}) {
      return this.start(options, (job) => this.loadNow(source, job));
    }
    async loadNow(source, job) {
      const p = this.puppet, { signal } = job;
      let files = null;
      if (typeof source === "string" || source instanceof URL) {
        const url = new URL(String(source), document.baseURI);
        if (/\.(livliv|zip)$/i.test(url.pathname)) {
          job.progress(0);
          files = await fetchPackage(url.href, job);
          if (signal.aborted) throw signal.reason;
        } else {
          job.progress(0);
          await p.load(url.href, { pack: false, signal, onImage: (came, of) => {
            job.progress(came / of);
            if (came === of) job.build();
          } }).catch((e) => {
            throw explain(e, url.href);
          });
        }
      } else files = source;
      if (files) {
        job.build();
        const { model, image, keyforms } = await fromFiles(files);
        if (signal.aborted) throw signal.reason;
        await p.loadModel(model, image, { keyforms, signal }).catch((e) => {
          throw explain(e, "model.json");
        });
      }
      if (this.disposed) {
        p.dispose();
        throw aborted("the player was disposed");
      }
      if (p.gl.isContextLost()) throw contextGone();
      const m = p.model;
      const ex = m.expressions || (m.layers.some((l) => l.id === "expr_smile") ? [{ id: "smile", label: "", labels: SMILE }] : []);
      this.info = {
        name: m.name,
        format: m.format || LEGACY_FORMAT,
        version: m.version ?? 3,
        size: m.canvas,
        fullBody: p.grounded,
        // a legacy package names each expression once, in the language its owner wrote it in
        expressions: ex.map(({ id, label, labels }) => {
          const all = labels || { [langOf(label)]: label };
          return { id, label: pickLabel(all, this.lang, id), labels: all };
        }),
        watermark: m.watermark ?? null,
        meta: m.meta ?? null
      };
      const kind = m.meta ? m.meta.watermark?.kind ?? "none" : m.watermark === "LivLiv" ? "livliv" : m.watermark ? "text" : "none";
      this.mark.set(kind, m.watermark ?? null, m.meta?.watermark?.center !== false);
      this.neutral();
      if (!this.playing) this.resize();
      return this.info;
    }
    /** The head or torso as drawn in the last frame, including view, action and body motion. */
    getAnchor(name) {
      return this.info && !this.disposed ? this.puppet.anchor(name) : null;
    }
    /** @internal */
    get grounded() {
      return this.puppet.grounded;
    }
    /** a full-body character keeps its feet on the ground: the sideways move sways it from the ankles, a hop's crouch and
     *  a lean toward the camera crouch it, the talking bob dips its upper body, and only a hop's flight lifts it
     *  @internal */
    place(actY) {
      const p = this.puppet, f = this.frame;
      if (!p.grounded) {
        super.place(actY);
        return;
      }
      p.setMove(f.move.x, f.move.s, f.talk, actY, f.move.y);
      f.move.y = p.move.y;
      this.ground = { crouch: p.crouch, dip: p.dip, talk: f.talk };
    }
    /** @internal */
    show(dt) {
      const p = this.puppet, f = this.frame, V = this.view, G = this.ground;
      p.view = { x: V.x, y: V.y, s: V.zoom };
      p.focusHead = V.head;
      p.fit = V.fit === "whole" || V.fit === "knee" ? V.fit : "frame";
      p.move = { ...f.move };
      p.crouch = G.crouch;
      p.dip = G.dip;
      p.size = this.renderSize ?? this.detachedSize;
      p.update(dt);
      p.render();
      this.mark.draw(performance.now(), p.size ? 1 : p.gl.drawingBufferWidth / Math.max(1, this.canvas.clientWidth));
    }
    /** @internal */
    free() {
      const gl = this.puppet.gl;
      this.puppet.dispose();
      this.mark.dispose();
      gl.deleteProgram(this.puppet.prog);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  };
  function explain(e, where) {
    const err = e;
    if (err instanceof LivLivError || err?.name === "AbortError") return e;
    const msg = String(err?.message || e), cause = e;
    if (err?.status) return new LivLivError("http", `LivLiv: could not load ${where} (HTTP ${err.status})`, { status: err.status, cause });
    if (msg.startsWith("image ")) {
      return new LivLivError("missing-file", `LivLiv: could not load the image ${msg.slice(6)}: it is missing, or on another origin that sends no CORS header`, { cause });
    }
    if (err instanceof SyntaxError) return new LivLivError("not-a-model", `LivLiv: ${where} is not a model.json (${msg})`, { cause });
    if (err instanceof TypeError && /fetch|load failed|network/i.test(msg)) {
      return new LivLivError("unreachable", `LivLiv: could not load ${where}: unreachable, or on another origin that sends no CORS header`, { cause });
    }
    return new LivLivError(err?.code ?? "invalid", msg.startsWith("LivLiv") ? msg : `LivLiv: ${msg}`, { cause });
  }
  var vrmHere = () => new LivLivError("not-a-model", "LivLiv: this is a VRM or glTF file, and a Player plays LivLiv models: use a BodyPlayer with VrmBody (@livliv-dev/player/vrm)");
  var isGlb = async (b) => {
    const d = new DataView(await b.slice(0, 4).arrayBuffer());
    return d.byteLength === 4 && d.getUint32(0, true) === 1179937895;
  };
  async function fetchPackage(url, job) {
    for (let again = true; ; again = false) {
      try {
        const r = await fetch(url, { signal: job.signal });
        if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
        return await readBody(r, job);
      } catch (e) {
        if (job.signal.aborted) throw e;
        const status = e.status;
        if (status && status < 500) throw explain(e, url);
        if (!again) throw status ? explain(e, url) : new LivLivError("unreachable", `LivLiv: could not load ${url}: unreachable or the connection dropped, or on another origin that sends no CORS header`, { cause: e });
      }
    }
  }
  async function fromFiles(source) {
    const files = /* @__PURE__ */ new Map();
    const norm = (k) => k.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
    const unpack = async (b) => {
      if (await isGlb(b)) throw vrmHere();
      if (!await isZip(b)) throw new LivLivError("not-a-model", "LivLiv: this file is not a .livliv package (not a ZIP)");
      return unzip(b).catch((e) => {
        throw explain(e, "the package");
      });
    };
    if (source instanceof Blob) (await unpack(source)).forEach((b, k) => files.set(k, b));
    else if (source instanceof Map) source.forEach((b, k) => files.set(norm(k), b));
    else if (Symbol.iterator in source) for (const f of source) files.set(norm(f.webkitRelativePath || f.name), f);
    else for (const [k, b] of Object.entries(source)) files.set(norm(k), b);
    const isJson = (k) => k === "model.json" || k.endsWith("/model.json");
    if (!(source instanceof Blob) && ![...files.keys()].some(isJson)) {
      for (const b of files.values()) {
        if (await isZip(b)) {
          const z = await unpack(b);
          files.clear();
          z.forEach((v, k) => files.set(k, v));
          break;
        }
      }
    }
    const json = [...files.keys()].filter(isJson).sort((a, b) => a.length - b.length)[0];
    if (!json && [...files.keys()].some((k) => /\.(vrm|glb)$/i.test(k))) throw vrmHere();
    if (!json) throw new LivLivError("missing-file", "LivLiv: no model.json among the files");
    const dir = json.slice(0, json.length - "model.json".length);
    if (files.get(json).size > ZIP_LIMITS.modelJson) throw new LivLivError("too-large", `LivLiv: ${json} is larger than ${ZIP_LIMITS.modelJson} bytes`);
    let model;
    try {
      model = readModel(JSON.parse(await files.get(json).text()));
    } catch (e) {
      throw explain(e, json);
    }
    const byName = /* @__PURE__ */ new Map();
    files.forEach((b, k) => byName.set(k.slice(k.lastIndexOf("/") + 1), b));
    const find = (path) => files.get(dir + norm(path)) ?? byName.get(path.slice(path.lastIndexOf("/") + 1));
    const image = (path) => {
      const b = find(path);
      return b ? loadBlob(b) : Promise.reject(new LivLivError("missing-file", `LivLiv: ${path} is not among the files`));
    };
    let keyforms;
    const kf = model.keyforms ? find(model.keyforms) : void 0;
    if (kf && kf.size <= ZIP_LIMITS.keyforms) keyforms = await kf.text().then((t) => JSON.parse(t)).catch(() => void 0);
    if (model.keyforms && !keyforms) console.warn(`LivLiv: ${model.keyforms} is missing or unreadable; the character plays on the rig alone`);
    return { model, image, keyforms };
  }
  return __toCommonJS(entry_exports);
})();
