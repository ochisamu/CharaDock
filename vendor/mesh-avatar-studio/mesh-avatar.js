/* Mesh Avatar Studio, MIT, (c) 2026 Yuki Shindo. See LICENSE and UPSTREAM.md. */
var MeshAvatarStudio = (() => {
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

  // vendor/mesh-avatar-studio/entry.js
  var entry_exports = {};
  __export(entry_exports, {
    PARAMS: () => PARAMS,
    create: () => createMeshAvatar
  });

  // vendor/mesh-avatar-studio/rig/validate.ts
  var number = (v, p, e) => {
    if (typeof v !== "number" || !Number.isFinite(v)) e.push(`${p}: expected a finite number`);
  };
  var positive = (v, p, e) => {
    number(v, p, e);
    if (typeof v === "number" && v <= 0) e.push(`${p}: must be positive`);
  };
  var integer = (v, p, e) => {
    positive(v, p, e);
    if (typeof v === "number" && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
  };
  var wholeNumber = (v, p, e) => {
    number(v, p, e);
    if (typeof v === "number" && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
  };
  var string = (v, p, e) => {
    if (typeof v !== "string" || !v.trim()) e.push(`${p}: expected a non-empty string`);
  };
  var array = (item, min = 0, max = Infinity) => (v, p, e) => {
    if (!Array.isArray(v)) {
      e.push(`${p}: expected an array`);
      return;
    }
    if (v.length < min || v.length > max) e.push(`${p}: expected ${min}..${max} items`);
    v.forEach((x, i) => item(x, `${p}[${i}]`, e));
  };
  var point = array(number, 2, 2);
  var band = (v, p, e) => {
    point(v, p, e);
    if (Array.isArray(v) && v.length === 2 && v[0] >= v[1]) e.push(`${p}: start must be less than end`);
  };
  var object = (fields, optional = []) => (v, p, e) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      e.push(`${p}: expected an object`);
      return;
    }
    const record = v;
    for (const [key, check] of Object.entries(fields)) {
      if (record[key] === void 0 && optional.includes(key)) continue;
      check(record[key], `${p}.${key}`, e);
    }
  };
  var ellipseFields = { cx: number, cy: number, rx: positive, ry: positive };
  var ellipse = object(ellipseFields);
  var polygon = array(point, 3);
  var line = array(point, 2);
  var unit = (v, p, e) => {
    number(v, p, e);
    if (typeof v === "number" && (v < 0 || v > 1)) e.push(`${p}: must be between 0 and 1`);
  };
  var schema = (draft) => object({
    version: (v, p, e) => {
      if (v !== 1) e.push(`${p}: only version 1 is supported`);
    },
    image: object({ width: integer, height: integer }),
    head: object({
      ...ellipseFields,
      shiftX: number,
      shiftY: number,
      pivotX: number,
      pivotY: number,
      maxRoll: number,
      weightBand: band,
      turnBand: band
    }),
    body: object({
      pivotX: number,
      pivotY: number,
      maxRoll: number,
      breathBand: band,
      rollBand: band,
      chest: ellipse,
      shoulders: array(ellipse)
    }),
    face: object({
      nose: ellipse,
      mouth: ellipse,
      eyeA: ellipse,
      eyeB: ellipse,
      earL: ellipse,
      earR: ellipse,
      brow: object({ ...ellipseFields, band }),
      jaw: object({ ...ellipseFields, band })
    }),
    buns: object({ bunL: ellipse, bunR: ellipse }, ["bunL", "bunR"]),
    eyes: array(object({
      opening: polygon,
      roi: polygon,
      x0: number,
      x1: number,
      top: array(number, 24, 24),
      bot: array(number, 24, 24)
    }, draft ? ["x0", "x1", "top", "bot"] : []), 2, 2),
    mouth: object({
      cx: number,
      cy: number,
      angle: number,
      halfLen: positive,
      bow: number,
      area: object({ ...ellipseFields, angle: number })
    }),
    cheeks: array(point, 2, 2),
    strands: array(object({ name: string, nodes: line, sigma: positive, k: positive, max: positive })),
    accessories: array(object({
      name: string,
      pivot: point,
      tip: point,
      split: unit,
      box: array(wholeNumber, 4, 4),
      color: object({ redness: unit, minRed: number })
    })),
    hand: object({
      outline: polygon,
      jaw: line,
      jawRange: band,
      background: polygon,
      elbow: point,
      wrist: point,
      knuckle: point,
      contact: point,
      forearmShare: unit,
      armBand: band,
      wristBand: band,
      handBand: band,
      fingerXBand: band,
      fingerYBand: band,
      pinBand: band
    }),
    mesh: object({
      baseCell: integer,
      fine: object({
        x0: wholeNumber,
        x1: wholeNumber,
        y0: wholeNumber,
        y1: wholeNumber,
        cell: integer
      }),
      handCell: integer,
      tasselCell: integer,
      eyeBallCell: integer,
      eyeCell: integer,
      spriteCell: integer
    }),
    view: object({ padTop: number, padSide: number, gazeCenter: point }, ["gazeCenter"])
  }, ["buns", "strands", "accessories", "hand"]);
  function validateRig(value, options = {}) {
    const errors = [];
    schema(options.draft ?? false)(value, "rig", errors);
    if (errors.length) return errors;
    const rig = value;
    rig.eyes.forEach((eye, i) => {
      const curves = ["x0", "x1", "top", "bot"];
      if (options.draft && curves.every((key) => eye[key] === void 0)) return;
      if (curves.some((key) => eye[key] === void 0)) {
        errors.push(`rig.eyes[${i}]: supply all x0/x1/top/bot fields or omit all in a draft`);
        return;
      }
      if (eye.x0 >= eye.x1) errors.push(`rig.eyes[${i}].x1: must exceed x0`);
      if (eye.top.some((y, k) => y > eye.bot[k])) errors.push(`rig.eyes[${i}].top: must not exceed bottom curve`);
    });
    if (rig.mesh.fine.x0 >= rig.mesh.fine.x1 || rig.mesh.fine.y0 >= rig.mesh.fine.y1)
      errors.push("rig.mesh.fine: rectangle must have positive area");
    if (rig.view.padTop <= -1 || rig.view.padTop >= 1 || rig.view.padSide <= -0.5)
      errors.push("rig.view: margins must leave a positive viewport");
    for (const [i, strand] of (rig.strands ?? []).entries()) {
      if (strand.nodes.some((p, j) => j > 0 && p[0] === strand.nodes[j - 1][0] && p[1] === strand.nodes[j - 1][1]))
        errors.push(`rig.strands[${i}].nodes: consecutive nodes must differ`);
    }
    for (const [i, accessory] of (rig.accessories ?? []).entries()) {
      if (accessory.box[0] < 0 || accessory.box[1] < 0 || accessory.box[2] > rig.image.width || accessory.box[3] > rig.image.height)
        errors.push(`rig.accessories[${i}].box: rectangle must stay inside the image`);
      if (accessory.split <= 0 || accessory.split >= 1) errors.push(`rig.accessories[${i}].split: must be strictly between 0 and 1`);
      if (accessory.pivot.every((n, k) => n === accessory.tip[k])) errors.push(`rig.accessories[${i}].tip: must differ from pivot`);
      if (accessory.box[0] >= accessory.box[2] || accessory.box[1] >= accessory.box[3]) errors.push(`rig.accessories[${i}].box: rectangle must have positive area`);
    }
    return errors;
  }
  function parseRig(value) {
    const errors = validateRig(value);
    if (errors.length) throw new Error(`Invalid rig:
${errors.join("\n")}`);
    return structuredClone(value);
  }

  // vendor/mesh-avatar-studio/engine/rig.js
  var PARAMS = [
    { id: "angleX", label: "Face angle X", min: -30, max: 30, def: 0, group: "Head and body" },
    { id: "angleY", label: "Face angle Y", min: -30, max: 30, def: 0, group: "Head and body" },
    { id: "angleZ", label: "Face roll", min: -30, max: 30, def: 0, group: "Head and body" },
    { id: "bodyAngleX", label: "Body angle X", min: -10, max: 10, def: 0, group: "Head and body" },
    { id: "bodyAngleZ", label: "Body roll", min: -10, max: 10, def: 0, group: "Head and body" },
    { id: "breath", label: "Breath", min: 0, max: 1, def: 0, group: "Head and body" },
    { id: "eyeLOpen", label: "Left eye open", min: 0, max: 1.25, def: 1, group: "Eyes and brows" },
    { id: "eyeROpen", label: "Right eye open", min: 0, max: 1.25, def: 1, group: "Eyes and brows" },
    { id: "eyeSmile", label: "Eye smile", min: 0, max: 1, def: 0, group: "Eyes and brows" },
    { id: "gazeX", label: "Gaze X", min: -1, max: 1, def: 0, group: "Eyes and brows" },
    { id: "gazeY", label: "Gaze Y", min: -1, max: 1, def: 0, group: "Eyes and brows" },
    { id: "browY", label: "Brow Y", min: -1, max: 1, def: 0, group: "Eyes and brows" },
    { id: "browAngle", label: "Brow angle", min: -1, max: 1, def: 0, group: "Eyes and brows" },
    { id: "mouthOpen", label: "Mouth open", min: 0, max: 1, def: 0, group: "Mouth and cheeks" },
    { id: "mouthForm", label: "Mouth form (i to o)", min: -1, max: 1, def: 0, group: "Mouth and cheeks" },
    { id: "blush", label: "Blush", min: 0, max: 1, def: 0, group: "Mouth and cheeks" },
    { id: "armAngle", label: "Arm angle", min: -10, max: 10, def: 0, group: "Hand" },
    { id: "handAngle", label: "Wrist angle", min: -10, max: 10, def: 0, group: "Hand" },
    { id: "fingerTap", label: "Finger tap", min: 0, max: 1, def: 0, group: "Hand" }
  ];
  function createRig(rig) {
    const IMG = { w: rig.image.width, h: rig.image.height };
    const gaussian2 = (x, y, a) => a ? Math.exp(-(((x - a.cx) / a.rx) ** 2 + ((y - a.cy) / a.ry) ** 2)) : 0;
    const EYE_N = 24;
    const EYES = rig.eyes;
    function sampled(arr, u) {
      const f = Math.min(1, Math.max(0, u)) * (EYE_N - 1), i = Math.min(Math.floor(f), EYE_N - 2), t = f - i;
      return arr[i] + (arr[i + 1] - arr[i]) * t;
    }
    function eyeLidsRaw(e, u, open, smile) {
      u = Math.min(1, Math.max(0, u));
      const top = sampled(e.top, u), bot = sampled(e.bot, u);
      const b = 1 - open, hump = 4 * u * (1 - u);
      const H2 = sampled(e.bot, 0.5) - sampled(e.top, 0.5);
      const arc = e.top[0] + (e.top[EYE_N - 1] - e.top[0]) * u - 0.3 * H2 * hump;
      const closed = Math.max(top, bot + 1 + (arc - bot - 1) * smile);
      return [(closed - top) * Math.max(b, -0.07), b > 0 ? (closed - bot) * b * smile : 0];
    }
    const LID_TAPS = [[-2, 1], [-1, 2], [0, 3], [1, 2], [2, 1]], LID_STEP = 5;
    function eyeLids(e, x, open, smile) {
      let du = 0, db = 0;
      for (const [k, w] of LID_TAPS) {
        const [a, c] = eyeLidsRaw(e, (x + k * LID_STEP - e.x0) / (e.x1 - e.x0), open, smile);
        du += a * w / 9;
        db += c * w / 9;
      }
      const u = Math.min(1, Math.max(0, (x - e.x0) / (e.x1 - e.x0)));
      const top = sampled(e.top, u), bot = sampled(e.bot, u);
      return { top, bot, b: 1 - open, lid: top + du, bc: bot + db };
    }
    function eyePartY(e, part, x, y, open, smile) {
      const L = eyeLids(e, x, open, smile);
      if (part === "lash") return L.lid - (L.top - y) * (1 - 0.3 * Math.min(1, Math.max(0, L.b)));
      if (part === "low") return y + (L.bc - L.bot);
      if (part === "crease") return y + (L.lid - L.top) * 0.22;
      return y;
    }
    function eyePartAlpha(part, open, smile) {
      const b = Math.min(1, Math.max(0, 1 - open));
      if (part === "low") return 1 - Math.min(1, b * smile * 1.2);
      if (part === "crease") return 1 - 0.45 * b;
      return 1;
    }
    const MOUTH = rig.mouth;
    const CHEEKS = rig.cheeks;
    const HEAD = rig.head;
    const BODY = rig.body;
    const sstep2 = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    function headWeight(x, y) {
      return 1 - sstep2(...HEAD.weightBand, y);
    }
    function turnWeight(x, y) {
      return 1 - sstep2(...HEAD.turnBand, y);
    }
    const STRANDS = rig.strands ?? [];
    function onPolyline(x, y, nodes) {
      let best = Infinity, bt = 0;
      const n = nodes.length - 1;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = nodes[i], [bx, by] = nodes[i + 1];
        const vx = bx - ax, vy = by - ay;
        const u = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
        const d = Math.hypot(x - ax - vx * u, y - ay - vy * u);
        if (d < best) {
          best = d;
          bt = (i + u) / n;
        }
      }
      return [best, bt];
    }
    function strandWeights(x, y, hair) {
      if (hair < 0.02) return [];
      const hits = [];
      let sum = 0;
      STRANDS.forEach((s, i) => {
        const [d, t] = onPolyline(x, y, s.nodes);
        const g = Math.exp(-((d / s.sigma) ** 2));
        if (g < 0.02) return;
        hits.push([i, g, t]);
        sum += g;
      });
      const norm = Math.max(1, sum);
      return hits.map(([i, g, t]) => [i, hair * g / norm * sstep2(0.04, 0.55, t), t]);
    }
    function baseWeights(x, y, hair = 1) {
      return {
        head: headWeight(x, y),
        turn: turnWeight(x, y),
        strands: strandWeights(x, y, hair),
        bunL: gaussian2(x, y, rig.buns?.bunL),
        bunR: gaussian2(x, y, rig.buns?.bunR),
        brow: gaussian2(x, y, rig.face.brow) * (1 - sstep2(...rig.face.brow.band, y)),
        // chin below the mouth line drops a little when the mouth opens
        jaw: gaussian2(x, y, rig.face.jaw) * sstep2(...rig.face.jaw.band, y),
        // per-feature depth for head turns (nose sticks out most, ears sit at the back)
        nose: gaussian2(x, y, rig.face.nose),
        mouth: gaussian2(x, y, rig.face.mouth),
        eyeA: gaussian2(x, y, rig.face.eyeA),
        eyeB: gaussian2(x, y, rig.face.eyeB),
        earR: gaussian2(x, y, rig.face.earR),
        earL: gaussian2(x, y, rig.face.earL),
        chest: gaussian2(x, y, BODY.chest),
        breath: 1 - sstep2(...BODY.breathBand, y),
        shoulder: BODY.shoulders.reduce((sum, area) => sum + gaussian2(x, y, area), 0)
      };
    }
    function turnOffset(x, y, ax, ay) {
      const nx = (x - HEAD.cx) / HEAD.rx, ny = (y - HEAD.cy) / HEAD.ry;
      const t = 1 - nx * nx - ny * ny;
      if (t <= 0) return [0, 0];
      const d = sstep2(0, 0.84, t);
      return [ax * HEAD.shiftX * d, -ay * HEAD.shiftY * d];
    }
    function rotateAround(p, cx, cy, a) {
      const c = Math.cos(a), s = Math.sin(a), dx = p[0] - cx, dy = p[1] - cy;
      p[0] = cx + dx * c - dy * s;
      p[1] = cy + dx * s + dy * c;
    }
    function applyHead(p, w, P, wTurn = w) {
      const o = turnOffset(p[0], p[1], P.angleX / 30, P.angleY / 30);
      p[0] += o[0] * wTurn;
      p[1] += o[1] * wTurn;
      if (w <= 0) return;
      rotateAround(p, HEAD.pivotX, HEAD.pivotY, -P.angleZ / 30 * HEAD.maxRoll * w);
    }
    function applyBody(p, restY, P, chest = 0, breathW = 1, shoulder = 0) {
      const b = P.breath;
      p[1] -= b * (5 * breathW + 4 * shoulder);
      p[0] += (p[0] - BODY.chest.cx) * 0.012 * b * chest;
      p[0] += P.bodyAngleX / 10 * (7 + 9 * chest);
      rotateAround(p, BODY.pivotX, BODY.pivotY, -P.bodyAngleZ / 10 * BODY.maxRoll * (1 - sstep2(...BODY.rollBand, restY)));
    }
    function deformBase(x, y, w, P, phys, out) {
      const p = out;
      p[0] = x;
      p[1] = y;
      const g = phys.gain;
      for (const [i, wi, t] of w.strands) {
        const o = phys.strands?.[i];
        if (!o) continue;
        const f = t * 3, k = Math.min(2, Math.floor(f)), u = f - k;
        p[0] += (o[k][0] + (o[k + 1][0] - o[k][0]) * u) * wi * g;
        p[1] += (o[k][1] + (o[k + 1][1] - o[k][1]) * u) * wi * g;
      }
      p[0] += (phys.bunL[0] * w.bunL + phys.bunR[0] * w.bunR) * g;
      p[1] += (phys.bunL[1] * w.bunL + phys.bunR[1] * w.bunR) * g;
      p[1] -= P.browY * 7 * w.brow;
      if (w.brow > 0.01) {
        const a = P.browAngle * 0.12 * w.brow;
        p[1] += (x - rig.face.brow.cx) * Math.sin(a);
      }
      p[1] += P.mouthOpen * 3.5 * w.jaw;
      const ax = P.angleX / 30, ay = P.angleY / 30;
      p[0] += ax * (8 * w.nose + 5 * w.mouth) + (x - rig.face.eyeA.cx) * 0.12 * ax * w.eyeA - (x - rig.face.eyeB.cx) * 0.12 * ax * w.eyeB - ax * 9 * w.earR + ax * 4 * w.earL - ax * 10 * (w.bunL + w.bunR);
      p[1] -= ay * (6 * w.nose + 3 * w.mouth);
      p[1] += (y - rig.face.eyeA.cy) * -0.06 * Math.abs(ay) * w.eyeA + (y - rig.face.eyeB.cy) * -0.06 * Math.abs(ay) * w.eyeB;
      applyHead(p, w.head, P, w.turn);
      applyBody(p, y, P, w.chest, w.breath, w.shoulder);
      return p;
    }
    const H = rig.hand;
    const ELBOW = H?.elbow ?? [0, 0], WRIST = H?.wrist ?? [0, 0];
    const KNUCKLE = H?.knuckle ?? [0, 0], CONTACT = H?.contact ?? [0, 0];
    const FOREARM_SHARE = H?.forearmShare ?? 0;
    function handWeights(x, y) {
      if (!H) return { arm: 0, wrist: 0, hand: 0, finger: 0, pinBottom: 0 };
      return {
        arm: 1 - sstep2(...H.armBand, y),
        wrist: 1 - sstep2(...H.wristBand, y),
        hand: 1 - sstep2(...H.handBand, y),
        finger: sstep2(...H.fingerXBand, x) * (1 - sstep2(...H.fingerYBand, y)),
        pinBottom: sstep2(...H.pinBand, y)
      };
    }
    const rot = (p, o, c, s) => {
      const dx = p[0] - o[0], dy = p[1] - o[1];
      return [o[0] + dx * c - dy * s, o[1] + dx * s + dy * c];
    };
    const angleOf = (v) => Math.atan2(v[1], v[0]);
    function handFrame(P) {
      const c = [...CONTACT];
      applyHead(c, headWeight(...CONTACT), P, turnWeight(...CONTACT));
      applyBody(c, CONTACT[1], P, 0, 1, 0);
      const e = [...ELBOW];
      applyBody(e, ELBOW[1], P, 0, 0, 0);
      const full = angleOf([c[0] - e[0], c[1] - e[1]]) - angleOf([CONTACT[0] - ELBOW[0], CONTACT[1] - ELBOW[1]]);
      const a = full * FOREARM_SHARE;
      const ca = Math.cos(a), sa = Math.sin(a);
      const tr = (p) => {
        const q = rot(p, ELBOW, ca, sa);
        return [q[0] + e[0] - ELBOW[0], q[1] + e[1] - ELBOW[1]];
      };
      const w = tr(WRIST), c1 = tr(CONTACT);
      const b = angleOf([c[0] - w[0], c[1] - w[1]]) - angleOf([c1[0] - w[0], c1[1] - w[1]]);
      const k = Math.min(1.03, Math.max(0.97, Math.hypot(c[0] - w[0], c[1] - w[1]) / Math.hypot(c1[0] - w[0], c1[1] - w[1])));
      return { tr, w, b, k };
    }
    function deformHand(x, y, w, P, F, out) {
      let p = [x, y];
      p = rot(p, KNUCKLE, Math.cos(P.fingerTap * 0.07 * w.finger), Math.sin(P.fingerTap * 0.07 * w.finger));
      const ha = -P.handAngle / 10 * 0.045 * w.wrist, aa = -P.armAngle / 10 * 0.015 * w.arm;
      p = rot(p, WRIST, Math.cos(ha), Math.sin(ha));
      p = rot(p, ELBOW, Math.cos(aa), Math.sin(aa));
      p = F.tr(p);
      const bw = F.b * w.hand, kw = 1 + (F.k - 1) * w.hand;
      p = rot(p, F.w, Math.cos(bw) * kw, Math.sin(bw) * kw);
      p[1] += (y - p[1]) * w.pinBottom;
      out[0] = p[0];
      out[1] = p[1];
      return out;
    }
    const TASSELS = rig.accessories ?? [];
    function tasselAnchor(t, P, phys, out) {
      const w = baseWeights(t.pivot[0], t.pivot[1]);
      return deformBase(t.pivot[0], t.pivot[1], w, P, phys, out);
    }
    return { IMG, EYES, MOUTH, CHEEKS, STRANDS, TASSELS, headWeight, turnWeight, baseWeights, deformBase, applyHead, applyBody, handWeights, handFrame, deformHand, eyePartY, eyePartAlpha, tasselAnchor };
  }

  // vendor/mesh-avatar-studio/lighting/normals.ts
  function silhouetteDistance(alpha, width, height, cropped = false) {
    const boundary = cropped ? Math.max(width, height) * 2 : 1;
    const d = new Float32Array(alpha.length), diagonal = Math.SQRT2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (alpha[i] <= 3) continue;
      d[i] = Math.min(
        x ? d[i - 1] + 1 : boundary,
        y ? d[i - width] + 1 : boundary,
        x && y ? d[i - width - 1] + diagonal : boundary,
        y && x + 1 < width ? d[i - width + 1] + diagonal : boundary
      );
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!alpha[i] || alpha[i] <= 3) continue;
      d[i] = Math.min(
        d[i],
        x + 1 < width ? d[i + 1] + 1 : boundary,
        y + 1 < height ? d[i + width] + 1 : boundary,
        x && y + 1 < height ? d[i + width - 1] + diagonal : boundary,
        x + 1 < width && y + 1 < height ? d[i + width + 1] + diagonal : boundary
      );
    }
    return d;
  }
  function gaussian(x, y, e) {
    return Math.exp(-(((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2));
  }
  function rigHeight(x, y, rig) {
    const r2 = ((x - rig.head.cx) / rig.head.rx) ** 2 + ((y - rig.head.cy) / rig.head.ry) ** 2;
    let h = rig.head.rx * 0.8 * Math.sqrt(Math.max(0, 1 - r2)) + rig.body.chest.rx * 0.23 * gaussian(x, y, rig.body.chest);
    h += rig.face.nose.rx * 0.2 * gaussian(x, y, rig.face.nose);
    for (const [cx, cy] of rig.cheeks) h += rig.head.rx * 0.012 * gaussian(x, y, { cx, cy, rx: rig.head.rx * 0.3, ry: rig.head.ry * 0.16 });
    return h;
  }
  function boxBlur(src, width, height, radius) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const pass = (input, output, length, lines, step, stride) => {
      for (let line2 = 0; line2 < lines; line2++) {
        const start = line2 * stride;
        let sum = 0, count = 0;
        for (let k = 0; k < Math.min(radius, length - 1) + 1; k++) {
          sum += input[start + k * step];
          count++;
        }
        for (let i = 0; i < length; i++) {
          output[start + i * step] = sum / count;
          const add = i + radius + 1, remove = i - radius;
          if (add < length) {
            sum += input[start + add * step];
            count++;
          }
          if (remove >= 0) {
            sum -= input[start + remove * step];
            count--;
          }
        }
      }
    };
    pass(src, tmp, width, height, 1, width);
    pass(tmp, out, height, width, width, 1);
    return out;
  }
  function detailGradient(luminance, alpha, width, height) {
    const fine = boxBlur(luminance, width, height, 1), coarse = boxBlur(luminance, width, height, 6);
    const relief = new Float32Array(luminance.length);
    for (let i = 0; i < relief.length; i++) relief[i] = alpha[i] > 128 ? fine[i] - coarse[i] : 0;
    const gradient = new Float32Array(luminance.length * 2);
    const at = (x, y) => relief[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (alpha[i] <= 128) continue;
      gradient[2 * i] = Math.max(-1, Math.min(1, -(at(x + 1, y) - at(x - 1, y)) * 4));
      gradient[2 * i + 1] = Math.max(-1, Math.min(1, -(at(x, y + 1) - at(x, y - 1)) * 4));
    }
    return gradient;
  }
  function generateNormals(alpha, width, height, rect, rig, inflate = true, luminance) {
    const cropped = !!rig && rect[0] === 0 && rect[1] === 0 && rect[2] === rig.image.width && rect[3] === rig.image.height;
    const distances = silhouetteDistance(alpha, width, height, cropped), heights = new Float32Array(alpha.length);
    const dx = rect[2] / width, dy = rect[3] / height, unit2 = Math.min(dx, dy);
    const depth = Math.min(rect[2], rect[3]) * 0.08;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      heights[i] = (inflate ? Math.sqrt(distances[i] * unit2 * depth) * 0.55 : 0) + (rig ? rigHeight(rect[0] + (x + 0.5) * dx, rect[1] + (y + 0.5) * dy, rig) : 0);
    }
    const radius = Math.max(1, Math.round(Math.min(width, height) * 0.02));
    heights.set(boxBlur(boxBlur(heights, width, height, radius), width, height, radius));
    const detail = luminance ? detailGradient(luminance, alpha, width, height) : null;
    const normals = new Uint8Array(width * height * 4);
    const sample = (x, y) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const nx = -(sample(x + 2, y) - sample(x - 2, y)) / (4 * dx), ny = -(sample(x, y + 2) - sample(x, y - 2)) / (4 * dy);
      const len = Math.hypot(nx, ny, 1), i = (y * width + x) * 4, j = y * width + x;
      normals[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
      normals[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      normals[i + 2] = Math.round(((detail?.[2 * j] ?? 0) * 0.5 + 0.5) * 255);
      normals[i + 3] = Math.round(((detail?.[2 * j + 1] ?? 0) * 0.5 + 0.5) * 255);
    }
    return normals;
  }
  var cache = /* @__PURE__ */ new WeakMap();
  function layerNormals(image, rect, rig, inflate) {
    const key = JSON.stringify([rect, rig.head, rig.body.chest, rig.face.nose, rig.cheeks, inflate]);
    const cached = cache.get(image);
    if (cached?.key === key) return { ...cached, computed: false, ms: 0 };
    const start = performance.now(), scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data, alpha = new Uint8Array(width * height);
    const luminance = new Float32Array(width * height);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = pixels[4 * i + 3];
      luminance[i] = (0.2126 * pixels[4 * i] + 0.7152 * pixels[4 * i + 1] + 0.0722 * pixels[4 * i + 2]) / 255;
    }
    const result = { key, data: generateNormals(alpha, width, height, rect, rig, inflate, inflate ? luminance : void 0), width, height };
    cache.set(image, result);
    return { ...result, computed: true, ms: performance.now() - start };
  }

  // vendor/mesh-avatar-studio/lighting/settings.ts
  var DEFAULT_LIGHTING = Object.freeze({
    enabled: false,
    x: 0.2,
    y: 0.2,
    z: 0.45,
    color: 16777215,
    strength: 0.8,
    intensity: 0.8,
    ambient: 0.4,
    mode: "soft",
    shadow: false,
    reach: 1.2,
    ambientColor: 15659256,
    softness: 0.45,
    specular: 0.12,
    rim: 0.3,
    detail: 0.4
  });
  var ranges = {
    x: [0, 1],
    y: [0, 1],
    z: [0.1, 2],
    color: [0, 16777215],
    strength: [0, 1],
    intensity: [0, 2],
    ambient: [0, 1],
    reach: [0.2, 3],
    ambientColor: [0, 16777215],
    softness: [0, 1],
    specular: [0, 1],
    rim: [0, 1],
    detail: [0, 1]
  };
  var colors = /* @__PURE__ */ new Set(["color", "ambientColor"]);
  function parseLighting(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const data = input;
    if (Object.keys(data).length !== Object.keys(DEFAULT_LIGHTING).length || Object.keys(data).some((k) => !(k in DEFAULT_LIGHTING))) return null;
    if (![true, false].includes(data.enabled) || ![true, false].includes(data.shadow) || !["soft", "cel"].includes(data.mode)) return null;
    const result = { ...DEFAULT_LIGHTING, enabled: data.enabled, shadow: data.shadow, mode: data.mode };
    for (const key of Object.keys(ranges)) {
      const value = data[key], [min, max] = ranges[key];
      if (typeof value !== "number" || !Number.isFinite(value) || colors.has(key) && !Number.isInteger(value)) return null;
      result[key] = Math.max(min, Math.min(max, value));
    }
    return result;
  }

  // vendor/mesh-avatar-studio/lighting/shading.ts
  var TERMINATOR = -0.1;
  var DETAIL_SCALE = 0.9;
  var SHADOW_SATURATION = 1;
  var MAX_IRRADIANCE = 1.06;
  function shadowOffset(x, y) {
    return [(0.5 - x) * 0.12, (0.5 - y) * 0.12];
  }
  function headRotation(angleX, angleY, angleZ, maxRoll) {
    const yaw = angleX * Math.PI / 180, pitch = angleY * Math.PI / 180, roll = -angleZ / 30 * maxRoll;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    return [
      cr * cy,
      sr * cy,
      -sy,
      cr * sy * sp - sr * cp,
      sr * sy * sp + cr * cp,
      cy * sp,
      cr * sy * cp + sr * sp,
      sr * sy * cp - cr * sp,
      cy * cp
    ];
  }

  // vendor/mesh-avatar-studio/lighting/shadow.js
  var DropShadow = class {
    constructor(gl, compile) {
      this.gl = gl;
      this.program = compile(gl, `#version 300 es
      out vec2 vUv;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0, 1); }`, `#version 300 es
      precision highp float; in vec2 vUv; out vec4 o;
      uniform sampler2D uTex; uniform vec2 uStep; uniform vec2 uShift; uniform int uPass;
      float alphaAt(vec2 p) { if (any(lessThan(p, vec2(0))) || any(greaterThan(p, vec2(1)))) return 0.0; return texture(uTex, p).a; }
      void main() {
        if (uPass == 2) { o = texture(uTex, vUv); return; }
        vec2 p = vUv - uShift;
        float a = alphaAt(p) * 0.227027;
        a += (alphaAt(p + uStep * 1.384615) + alphaAt(p - uStep * 1.384615)) * 0.316216;
        a += (alphaAt(p + uStep * 3.230769) + alphaAt(p - uStep * 3.230769)) * 0.070270;
        o = uPass == 0 ? vec4(0, 0, 0, a) : vec4(vec3(0.035, 0.045, 0.065) * a * 0.28, a * 0.28);
      }`);
      this.vao = gl.createVertexArray();
      this.targets = [];
    }
    target(w, h) {
      const gl = this.gl, texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Shadow framebuffer unavailable");
      return { texture, framebuffer };
    }
    begin(w, h) {
      const gl = this.gl;
      if (this.width !== w || this.height !== h) {
        this.clearTargets();
        this.width = w;
        this.height = h;
        this.targets = [this.target(w, h), this.target(Math.ceil(w / 2), Math.ceil(h / 2))];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    composite(light) {
      const gl = this.gl, { prog, u } = this.program, w = this.width, h = this.height;
      gl.useProgram(prog);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(u.uTex, 0);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[1].framebuffer);
      gl.viewport(0, 0, Math.ceil(w / 2), Math.ceil(h / 2));
      gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
      gl.uniform1i(u.uPass, 0);
      gl.uniform2f(u.uShift, 0, 0);
      gl.uniform2f(u.uStep, 3 / w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[1].texture);
      const offset = shadowOffset(light.x, light.y);
      gl.uniform1i(u.uPass, 1);
      gl.uniform2f(u.uShift, offset[0], -offset[1]);
      gl.uniform2f(u.uStep, 0, 3 / h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
      gl.uniform1i(u.uPass, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }
    clearTargets() {
      for (const t of this.targets) {
        this.gl.deleteTexture(t.texture);
        this.gl.deleteFramebuffer(t.framebuffer);
      }
      this.targets = [];
    }
    destroy() {
      this.clearTargets();
      this.gl.deleteProgram(this.program.prog);
      this.gl.deleteVertexArray(this.vao);
    }
  };

  // vendor/mesh-avatar-studio/engine/renderer.js
  function createRenderer(engine, rig) {
    const { IMG, EYES, MOUTH, CHEEKS } = engine;
    const VS = `#version 300 es
  in vec2 aPos; in vec2 aUv;
  uniform vec2 uScale; uniform vec2 uOffset;
  out vec2 vUv;
  void main() { vUv = aUv; gl_Position = vec4(aPos * uScale + uOffset, 0.0, 1.0); }`;
    const FS = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 outColor;
  uniform sampler2D uTex;
  uniform vec4 uRect;        // layer rect in source px
  uniform int uFace;
  uniform float uAlpha;
  uniform vec4 uEyeBox[2];   // x0, x1, -, -
  uniform float uEyeTop[48]; // 2 eyes x EYE_N samples
  uniform float uEyeBot[48];
  uniform vec4 uEyeState[2]; // open, smile, ballX(px), ballY(px)
  uniform vec4 uMouth;       // cx, cy, angle, halfLen
  uniform vec4 uMouthState;  // open, form, bow, -
  uniform vec4 uCheeks;      // x0, y0, x1, y1
  uniform float uCheek;

  const int EYE_N = 24;
  float crv(int e, bool top, float u) {
    float f = clamp(u, 0.0, 1.0) * float(EYE_N - 1);
    int i = min(int(floor(f)), EYE_N - 2);
    float t = f - float(i);
    int k = e * EYE_N + i;
    return top ? mix(uEyeTop[k], uEyeTop[k + 1], t) : mix(uEyeBot[k], uEyeBot[k + 1], t);
  }

  // Upper lid line and lower lid line of eye e at column u, for the current open/smile state.
  // Must match eyeLids() in rig.js, which moves the lash meshes to the same lines.
  // Must match eyeLidsRaw() / eyeLids() in rig.js.
  vec2 eyeLidsRaw(int e, float u) {
    u = clamp(u, 0.0, 1.0);
    vec4 st = uEyeState[e];
    float top = crv(e, true, u), bot = crv(e, false, u);
    float b = 1.0 - st.x, smile = st.y, hump = 4.0 * u * (1.0 - u);
    float H = crv(e, false, 0.5) - crv(e, true, 0.5);
    float arc = mix(uEyeTop[e * EYE_N], uEyeTop[e * EYE_N + EYE_N - 1], u) - 0.3 * H * hump;
    float closed = max(top, bot + 1.0 + (arc - bot - 1.0) * smile);
    return vec2((closed - top) * max(b, -0.07), b > 0.0 ? (closed - bot) * b * smile : 0.0);
  }

  vec2 eyeLids(int e, float u, float top, float bot) {
    vec4 box = uEyeBox[e];
    float du = 5.0 / (box.y - box.x);
    vec2 raw = eyeLidsRaw(e, u);
    vec2 d = (eyeLidsRaw(e, u - 2.0 * du) + 2.0 * eyeLidsRaw(e, u - du) + 3.0 * raw
            + 2.0 * eyeLidsRaw(e, u + du) + eyeLidsRaw(e, u + 2.0 * du)) / 9.0;
    // for hiding the ball take whichever closes more: the smoothed lash can sit a little
    // above the raw lid near the corners, and the gap must show lid skin, not eye white
    return vec2(top + max(d.x, raw.x), bot + min(d.y, raw.y));
  }

  vec4 texAt(vec2 p) { return texture(uTex, (p - uRect.xy) / uRect.zw); }

  // Eye white + iris layer: shown only between the lids (the lids cover it, it never squashes);
  // the iris slides inside the opening for the gaze.
  vec4 eyeBall(int e, vec2 p) {
    vec4 box = uEyeBox[e]; vec4 st = uEyeState[e];
    float u = clamp((p.x - box.x) / (box.y - box.x), 0.0, 1.0);
    float top = crv(e, true, u), bot = crv(e, false, u);
    vec2 lids = eyeLids(e, u, top, bot);
    float v = clamp((p.y - top) / max(bot - top, 1.0), 0.0, 1.0);
    float w = sqrt(4.0 * u * (1.0 - u)) * sqrt(4.0 * v * (1.0 - v));
    vec4 c = texAt(p - vec2(st.z, st.w) * w);
      // the lash covers ~2px of the ball's upper edge, so the cut can sit under it (no seam)
    return c * smoothstep(lids.x - 1.0, lids.x + 0.5, p.y) * (1.0 - smoothstep(lids.y - 0.9, lids.y + 0.6, p.y));
  }

  vec4 mouth(vec2 p, vec4 base) {
    float open = uMouthState.x;
    if (open < 0.01) return base;
    vec2 d = vec2(cos(uMouth.z), sin(uMouth.z)), n = vec2(-d.y, d.x);
    vec2 r = p - uMouth.xy;
    float s = dot(r, d) / uMouth.w, t = dot(r, n);
    float form = uMouthState.y;                       // -1 wide "i" .. +1 round "o"
    float wf = mix(0.78, 0.46, clamp(form * 0.5 + 0.5, 0.0, 1.0));
    float k = 1.0 - (s / wf) * (s / wf);
    if (k <= 0.0) return base;
    float line = uMouthState.z * (1.0 - s * s);
    float hk = pow(k, mix(0.55, 0.85, clamp(form, 0.0, 1.0)));
    float H = mix(20.0, 26.0, clamp(form, 0.0, 1.0));
    float up = line - 0.6 - open * 2.5 * hk;
    float lo = line + open * H * hk;
    float cov = smoothstep(-0.7, 0.7, t - up) * smoothstep(-0.7, 0.7, lo - t);
    if (cov <= 0.0) return base;
    float tv = clamp((t - up) / max(lo - up, 1.0), 0.0, 1.0);
    vec3 col = mix(vec3(0.24, 0.05, 0.08), vec3(0.48, 0.15, 0.19), tv);
    float tongue = smoothstep(0.5, 0.78, tv) * (1.0 - smoothstep(0.45, 0.8, abs(s) / wf));
    col = mix(col, vec3(0.86, 0.44, 0.47), tongue * 0.9);
    float teeth = (1.0 - smoothstep(0.12, 0.22, tv)) * smoothstep(0.25, 0.45, open) * (1.0 - smoothstep(0.55, 0.85, abs(s) / wf));
    col = mix(col, vec3(0.99, 0.96, 0.94), teeth);
    float rim = 1.0 - smoothstep(0.6, 1.8, lo - t);
    col = mix(col, vec3(0.36, 0.09, 0.11), rim * 0.85);
    return vec4(mix(base.rgb, col, cov), 1.0);
  }

  void main() {
    vec2 p = uRect.xy + vUv * uRect.zw;
    vec4 c;
    if (uFace == 1) {
      c = mouth(p, texAt(p));
      float blush = exp(-dot((p - uCheeks.xy) / vec2(48.0, 22.0), (p - uCheeks.xy) / vec2(48.0, 22.0)))
                  + exp(-dot((p - uCheeks.zw) / vec2(40.0, 20.0), (p - uCheeks.zw) / vec2(40.0, 20.0)));
      c.rgb = mix(c.rgb, c.rgb * vec3(1.0, 0.62, 0.64) , clamp(blush * uCheek * 0.55, 0.0, 1.0) * c.a);
    } else if (uFace >= 2) {
      c = eyeBall(uFace - 2, p);
    } else {
      c = texAt(p);
    }
    outColor = c * uAlpha;
  }`;
    const LIGHT_VS = VS.replace("out vec2 vUv;", "in float aHeadWeight; out float vHeadWeight; out vec2 vScreen; out vec2 vUv;").replace("vUv = aUv;", "vHeadWeight = aHeadWeight; vScreen = vec2((aPos.x * uScale.x + uOffset.x + 1.0) * 0.5, (1.0 - aPos.y * uScale.y - uOffset.y) * 0.5); vUv = aUv;");
    const LIGHT_FS = FS.replace("uniform sampler2D uTex;", `uniform sampler2D uTex;
    uniform sampler2D uNormal; in float vHeadWeight; in vec2 vScreen;
    uniform mat3 uHeadRotation; uniform vec3 uLight; uniform vec3 uLightColor; uniform vec3 uAmbientColor;
    uniform vec4 uLighting; uniform vec4 uSurface; uniform float uAspect; uniform int uCel;`).replace("outColor = c * uAlpha;", `
      // RG hold the smooth surface normal, BA the painting's relief (see lighting/normals.ts).
      vec4 encoded = texture(uNormal, vUv);
      vec2 base = encoded.rg * 2.0 - 1.0;
      vec3 n = vec3(base, sqrt(max(0.0, 1.0 - dot(base, base))));
      n = normalize(n + vec3((encoded.ba * 2.0 - 1.0) * uSurface.w * ${DETAIL_SCALE.toFixed(3)}, 0.0));
      n = normalize(mix(n, uHeadRotation * n, vHeadWeight));
      vec2 toLight = (uLight.xy - vScreen) * vec2(uAspect, 1.0);
      vec3 light = normalize(vec3(toLight, uLight.z));
      float ndl = dot(n, light);
      float diffuse;
      if (uCel == 1) {
        float w = 0.01 + uSurface.x * 0.08;
        diffuse = 0.2 + 0.45 * smoothstep(${TERMINATOR.toFixed(3)} - w, ${TERMINATOR.toFixed(3)} + w, ndl) + 0.35 * smoothstep(0.55 - w, 0.55 + w, ndl);
      } else {
        float s = 0.05 + uSurface.x * 0.5;
        diffuse = smoothstep(${TERMINATOR.toFixed(3)} - s, ${TERMINATOR.toFixed(3)} + s, ndl) * (0.35 + 0.65 * max(0.0, ndl));
      }
      float reach = dot(toLight, toLight) / (uLighting.w * uLighting.w);
      float attenuation = 1.0 / (1.0 + reach);
      vec3 radiance = uLightColor * uLighting.y * attenuation;
      // A light close to the surface may brighten a little, but must not bleach painted colours.
      vec3 irradiance = min(uAmbientColor * uLighting.z + radiance * diffuse, vec3(${MAX_IRRADIANCE.toFixed(3)}));
      // Painted shadows are deeper versions of the base colour, not grey: multiply by the colour
      // itself as the surface turns away from the light.
      vec3 albedo = c.rgb / max(c.a, 1e-4);
      float dark = 1.0 - clamp(dot(irradiance, vec3(0.3333)), 0.0, 1.0);
      vec3 shaded = c.rgb * mix(vec3(1.0), albedo, dark * ${SHADOW_SATURATION.toFixed(3)}) * irradiance;
      float specular = pow(max(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0), 60.0) * uSurface.y;
      if (uCel == 1) specular = smoothstep(0.3, 0.35, specular) * uSurface.y;
      vec2 side = length(n.xy) > 0.001 ? normalize(n.xy) : vec2(0.0);
      float rim = pow(1.0 - max(n.z, 0.0), 4.0) * smoothstep(-0.2, 0.7, dot(side, normalize(toLight + vec2(1e-4)))) * uSurface.z;
      shaded += radiance * (specular * max(0.0, ndl) + rim) * c.a;
      // Strength blends between the original painting and the relit result; alpha is unchanged.
      c.rgb = clamp(mix(c.rgb, shaded, uLighting.x), vec3(0.0), vec3(c.a));
      outColor = c * uAlpha;`);
    const LINE_VS = `#version 300 es
  in vec2 aPos; uniform vec2 uScale; uniform vec2 uOffset;
  void main() { gl_Position = vec4(aPos * uScale + uOffset, 0.0, 1.0); gl_PointSize = 7.0; }`;
    const LINE_FS = `#version 300 es
  precision mediump float; uniform vec4 uColor; out vec4 o; void main() { o = uColor; }`;
    function compile(gl, vs, fs) {
      const prog = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        gl.attachShader(prog, sh);
        gl.deleteShader(sh);
      }
      gl.bindAttribLocation(prog, 0, "aPos");
      gl.bindAttribLocation(prog, 1, "aUv");
      gl.bindAttribLocation(prog, 2, "aHeadWeight");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      const u = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(prog, i).name.replace("[0]", "");
        u[name] = gl.getUniformLocation(prog, name);
      }
      return { prog, u };
    }
    function axis(start, len, cell, fine) {
      const out = [start];
      let v = start;
      while (v < start + len - 0.5) {
        const c = fine && v >= fine.from && v < fine.to ? fine.cell : cell;
        v = Math.min(start + len, v + c);
        out.push(v);
      }
      return out;
    }
    function buildGrid(rect, cell, alpha, alphaW, fine = null) {
      const [rx, ry, rw, rh] = rect;
      const xs = axis(rx, rw, cell, fine && { from: fine.x0, to: fine.x1, cell: fine.cell });
      const ys = axis(ry, rh, cell, fine && { from: fine.y0, to: fine.y1, cell: fine.cell });
      const cols = xs.length - 1, rows = ys.length - 1;
      const nv = (cols + 1) * (rows + 1);
      const rest = new Float32Array(nv * 2), uv = new Float32Array(nv * 2);
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        rest[k * 2] = xs[i];
        rest[k * 2 + 1] = ys[j];
        uv[k * 2] = (xs[i] - rx) / rw;
        uv[k * 2 + 1] = (ys[j] - ry) / rh;
      }
      const tris = [], lines = [];
      const alphaH = alpha.length / alphaW;
      const ax = alphaW === 1 ? 0 : 1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x0 = Math.floor(xs[i] - rx) * ax - 2, x1 = Math.ceil(xs[i + 1] - rx) * ax + 2;
        const y0 = Math.floor(ys[j] - ry) * ax - 2, y1 = Math.ceil(ys[j + 1] - ry) * ax + 2;
        let any = false;
        for (let y = Math.max(0, y0); y < Math.min(alphaH, y1) && !any; y += 1)
          for (let x = Math.max(0, x0); x < Math.min(alphaW, x1); x += 1)
            if (alpha[y * alphaW + x] > 3) {
              any = true;
              break;
            }
        if (!any) continue;
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        tris.push(a, b, c, b, d, c);
        lines.push(a, b, a, c, b, c);
        if (i === cols - 1) lines.push(b, d);
        if (j === rows - 1) lines.push(c, d);
      }
      return { rect, cols, rows, rest, uv, pos: new Float32Array(rest), tris: new Uint32Array(tris), lines: new Uint32Array(lines) };
    }
    class Renderer {
      // padTop / padSide: margin around the image, as a share of its height / width. A negative
      // padTop pushes the top of the image above the canvas (hides a cut-off top edge).
      constructor(canvas, { padTop = 0, padSide = 0, fit = "contain" } = {}) {
        this.pad = { top: padTop, side: padSide };
        this.fit = fit;
        const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true, preserveDrawingBuffer: true });
        if (!gl) throw new Error("WebGL2 is not available");
        this.gl = gl;
        this.canvas = canvas;
        this.main = compile(gl, VS, FS);
        this.line = compile(gl, LINE_VS, LINE_FS);
        this.layers = [];
        this.lighting = DEFAULT_LIGHTING;
        this.lightingStats = { normalMs: 0, computedLayers: 0, cachedLayers: 0 };
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      texture(img) {
        const gl = this.gl, t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      }
      addLayer(name, img, mesh, opts = {}) {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
        for (const prog of [this.main, this.line]) {
          const loc = gl.getAttribLocation(prog.prog, "aPos");
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        }
        const uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
        const uvLoc = gl.getAttribLocation(this.main.prog, "aUv");
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
        const triBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.tris, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        const lineBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW);
        const layer = { name, image: img, mesh, tex: this.texture(img), vao, posBuf, uvBuf, triBuf, lineBuf, visible: true, face: !!opts.face, eyeBall: opts.eyeBall, color: opts.color || [1, 1, 1, 1] };
        this.layers.push(layer);
        return layer;
      }
      destroy() {
        const gl = this.gl;
        for (const layer of this.layers) {
          gl.deleteTexture(layer.tex);
          if (layer.normal) gl.deleteTexture(layer.normal);
          if (layer.headBuf) gl.deleteBuffer(layer.headBuf);
          gl.deleteVertexArray(layer.vao);
          for (const buffer of [layer.posBuf, layer.uvBuf, layer.triBuf, layer.lineBuf]) gl.deleteBuffer(buffer);
        }
        gl.deleteProgram(this.main.prog);
        gl.deleteProgram(this.line.prog);
        if (this.lit) gl.deleteProgram(this.lit.prog);
        this.shadow?.destroy();
        this.layers.length = 0;
      }
      setLighting(value) {
        this.lighting = parseLighting({ ...DEFAULT_LIGHTING, ...value }) ?? DEFAULT_LIGHTING;
        if (!this.lighting.enabled) return;
        const gl = this.gl;
        if (!this.lit) this.lit = compile(gl, LIGHT_VS, LIGHT_FS);
        for (const layer of this.layers) {
          if (layer.normal || layer.overlay) continue;
          const data = layerNormals(layer.image, layer.mesh.rect, rig, !/^(eye|mouth)/.test(layer.name));
          this.lightingStats.normalMs += data.ms;
          this.lightingStats[data.computed ? "computedLayers" : "cachedLayers"]++;
          layer.normal = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, layer.normal);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, data.width, data.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.data);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          const weights = new Float32Array(layer.mesh.rest.length / 2);
          for (let i = 0; i < weights.length; i++) weights[i] = engine.headWeight(layer.mesh.rest[i * 2], layer.mesh.rest[i * 2 + 1]);
          layer.headBuf = gl.createBuffer();
          gl.bindVertexArray(layer.vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, layer.headBuf);
          gl.bufferData(gl.ARRAY_BUFFER, weights, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(2);
          gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
        }
        gl.bindVertexArray(null);
        if (this.lighting.shadow && !this.shadow) this.shadow = new DropShadow(gl, compile);
      }
      resize() {
        const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round((c.clientWidth || c.width / dpr) * dpr), h = Math.round((c.clientHeight || c.height / dpr) * dpr);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const s = (this.fit === "cover" ? Math.max : Math.min)(w / (IMG.w * (1 + 2 * this.pad.side)), h / (IMG.h * (1 + this.pad.top)));
        const ox = (w - IMG.w * s) / 2, oy = (h - IMG.h * s) / (this.fit === "cover" ? 2 : 1);
        this.scale = [2 * s / w, -2 * s / h];
        this.offset = [-1 + 2 * ox / w, 1 - 2 * oy / h];
        this.pxScale = s;
        this.pxOff = [ox, oy];
      }
      draw(state) {
        const gl = this.gl;
        this.resize();
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const lit = this.lighting.enabled, shadow = lit && this.lighting.shadow;
        if (shadow) this.shadow.begin(this.canvas.width, this.canvas.height);
        const m = lit ? this.lit : this.main;
        this.current = m;
        gl.useProgram(m.prog);
        if (lit) {
          const light = this.lighting;
          gl.uniform1i(m.u.uNormal, 1);
          gl.uniform3f(m.u.uLight, light.x, light.y, light.z);
          gl.uniform3f(m.u.uLightColor, (light.color >> 16 & 255) / 255, (light.color >> 8 & 255) / 255, (light.color & 255) / 255);
          gl.uniform3f(m.u.uAmbientColor, (light.ambientColor >> 16 & 255) / 255, (light.ambientColor >> 8 & 255) / 255, (light.ambientColor & 255) / 255);
          gl.uniform4f(m.u.uLighting, light.strength, light.intensity, light.ambient, light.reach);
          gl.uniform4f(m.u.uSurface, light.softness, light.specular, light.rim, light.detail);
          gl.uniform1f(m.u.uAspect, this.canvas.width / this.canvas.height);
          gl.uniform1i(m.u.uCel, light.mode === "cel" ? 1 : 0);
          gl.uniformMatrix3fv(m.u.uHeadRotation, false, headRotation(state.angleX ?? 0, state.angleY ?? 0, state.angleZ ?? 0, rig.head.maxRoll));
        }
        gl.uniform2fv(m.u.uScale, this.scale);
        gl.uniform2fv(m.u.uOffset, this.offset);
        gl.uniform1i(m.u.uTex, 0);
        gl.uniform4fv(m.u.uEyeBox, EYES.flatMap((e) => [e.x0, e.x1, 0, 0]));
        gl.uniform1fv(m.u.uEyeTop, EYES.flatMap((e) => e.top));
        gl.uniform1fv(m.u.uEyeBot, EYES.flatMap((e) => e.bot));
        gl.uniform4fv(m.u.uEyeState, state.eyes);
        gl.uniform4f(m.u.uMouth, MOUTH.cx, MOUTH.cy, MOUTH.angle, MOUTH.halfLen);
        gl.uniform4f(m.u.uMouthState, state.mouthOpen, state.mouthForm, MOUTH.bow, 0);
        gl.uniform4f(m.u.uCheeks, CHEEKS[0][0], CHEEKS[0][1], CHEEKS[1][0], CHEEKS[1][1]);
        gl.uniform1f(m.u.uCheek, state.cheek);
        gl.activeTexture(gl.TEXTURE0);
        for (const L of this.layers) {
          if (!L.visible || L.overlay) continue;
          this.drawLayer(L, L.alpha ?? 1);
        }
        if (this.original && state.originalAlpha > 0) this.drawLayer(this.original, state.originalAlpha);
        if (shadow) this.shadow.composite(this.lighting);
        if (state.showMesh) {
          const l = this.line;
          gl.useProgram(l.prog);
          gl.uniform2fv(l.u.uScale, this.scale);
          gl.uniform2fv(l.u.uOffset, this.offset);
          for (const L of this.layers) {
            if (!L.visible || L.overlay) continue;
            gl.bindVertexArray(L.vao);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.lineBuf);
            gl.uniform4fv(l.u.uColor, L.color);
            gl.drawElements(gl.LINES, L.mesh.lines.length, gl.UNSIGNED_INT, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.triBuf);
          }
          if (state.joints?.length) this.drawPoints(state.joints);
          gl.bindVertexArray(null);
        }
      }
      drawLayer(L, alpha) {
        const gl = this.gl, m = this.current;
        gl.useProgram(m.prog);
        gl.bindVertexArray(L.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, L.posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, L.mesh.pos);
        if (this.lighting.enabled) {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, L.normal);
          gl.activeTexture(gl.TEXTURE0);
        }
        gl.bindTexture(gl.TEXTURE_2D, L.tex);
        gl.uniform4fv(m.u.uRect, L.mesh.rect);
        gl.uniform1i(m.u.uFace, L.eyeBall !== void 0 ? 2 + L.eyeBall : L.face ? 1 : 0);
        gl.uniform1f(m.u.uAlpha, alpha);
        gl.drawElements(gl.TRIANGLES, L.mesh.tris.length, gl.UNSIGNED_INT, 0);
      }
      drawPoints(pts) {
        const gl = this.gl, l = this.line;
        if (!this.pointBuf) {
          this.pointBuf = gl.createBuffer();
          this.pointVao = gl.createVertexArray();
          gl.bindVertexArray(this.pointVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
          const loc = gl.getAttribLocation(l.prog, "aPos");
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        }
        gl.bindVertexArray(this.pointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.flat()), gl.DYNAMIC_DRAW);
        gl.uniform4f(l.u.uColor, 1, 0.85, 0.2, 1);
        gl.drawArrays(gl.POINTS, 0, pts.length);
      }
      // canvas CSS px -> source image px
      toImage(cx, cy) {
        if (!this.pxOff) return null;
        const dpr = this.canvas.width / this.canvas.clientWidth;
        return [(cx * dpr - this.pxOff[0]) / this.pxScale, (cy * dpr - this.pxOff[1]) / this.pxScale];
      }
    }
    return { Renderer, buildGrid };
  }

  // vendor/mesh-avatar-studio/engine/physics.js
  function createPhysics(engine, rig) {
    const { applyHead, applyBody, TASSELS, tasselAnchor } = engine;
    const STRANDS = (rig.strands ?? []).map((strand) => {
      if (strand.nodes.length === 4) return strand;
      const nodes = Array.from({ length: 4 }, (_, i) => {
        const f = i / 3 * (strand.nodes.length - 1);
        const k = Math.min(strand.nodes.length - 2, Math.floor(f));
        const t = f - k;
        return [0, 1].map((axis) => strand.nodes[k][axis] + (strand.nodes[k + 1][axis] - strand.nodes[k][axis]) * t);
      });
      return { ...strand, nodes };
    });
    const STRAND_K = [0, 300, 200, 140], STRAND_COUPLE = 0.9, STRAND_DAMP = 7;
    const HAIR_TUNE = { stiff: 1.7, damp: 1.6, couple: 0.85, reach: 0.9, bind: 4 };
    const FRINGE = Math.min(6, STRANDS.filter((s) => s.name.startsWith("bang")).length);
    const TASSEL_TUNE = { freq: 0.7, zeta: 0.22, hang: 0.85, inertia: 0.32, wind: 0.03, max: 0.55, smooth: 6 };
    const rotV = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
    const softLimit = (v, m) => {
      const l = Math.hypot(v[0], v[1]);
      if (l < 1e-6) return v;
      const k = m * Math.tanh(l / m) / l;
      return [v[0] * k, v[1] * k];
    };
    const HAIR = Object.fromEntries(Object.entries(rig.buns ?? {}).map(([key, area]) => [key, { at: [area.cx, area.cy], k: 260, c: 11, hang: 3, max: 4 }]));
    const clampLen = (v, m) => {
      const l = Math.hypot(v[0], v[1]);
      if (l > m) {
        v[0] *= m / l;
        v[1] *= m / l;
      }
    };
    class Physics {
      constructor() {
        this.gain = 1;
        this.out = { gain: 1, bunL: [0, 0], bunR: [0, 0] };
        this.hair = {};
        for (const k of Object.keys(HAIR)) {
          this.hair[k] = { p: null, v: [0, 0] };
          this.out[k] = [0, 0];
        }
        this.strands = STRANDS.map(() => ({ p: null, v: [[0, 0], [0, 0], [0, 0], [0, 0]] }));
        this.out.strands = STRANDS.map(() => [[0, 0], [0, 0], [0, 0], [0, 0]]);
        this.chains = TASSELS.map((t) => {
          const dx = t.tip[0] - t.pivot[0], dy = t.tip[1] - t.pivot[1], L = Math.hypot(dx, dy);
          const dir = [dx / L, dy / L];
          return { t, dir, L1: L * t.split, L2: L * (1 - t.split), pts: null, prev: null, phi: [0, 0], anchor: [0, 0] };
        });
        this.time = 0;
      }
      hairAnchor(at, P) {
        const p = [at[0], at[1]];
        applyHead(p, 1, P);
        applyBody(p, at[1], P);
        return p;
      }
      step(P, dt) {
        const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
        const h = Math.min(dt, 0.05) / sub;
        const roll = -P.angleZ / 30 * rig.head.maxRoll - P.bodyAngleZ / 10 * rig.body.maxRoll;
        const g = this.gain;
        STRANDS.forEach((cfg, si) => {
          const st = this.strands[si], out = this.out.strands[si];
          const target = cfg.nodes.map((n) => this.hairAnchor(n, P));
          if (!st.p) st.p = target.map((t) => [...t]);
          const phase = si * 1.7;
          for (let i = 0; i < sub; i++) {
            const t = this.time + i * h;
            for (let j = 1; j < 4; j++) {
              const hang = Math.hypot(cfg.nodes[j][0] - cfg.nodes[0][0], cfg.nodes[j][1] - cfg.nodes[0][1]);
              const wind = (Math.sin(t * 1.3) * 0.5 + Math.sin(t * 3.1) * 0.3 + Math.sin(t * 4.7 + phase) * 0.2) * cfg.max * 0.1 * j / 3;
              const parent = [st.p[j - 1][0] - target[j - 1][0], st.p[j - 1][1] - target[j - 1][1]];
              const tx = target[j][0] + parent[0] * STRAND_COUPLE * HAIR_TUNE.couple - Math.sin(roll) * hang * 0.12 + wind;
              const ty = target[j][1] + parent[1] * STRAND_COUPLE * HAIR_TUNE.couple;
              const k = STRAND_K[j] * cfg.k * HAIR_TUNE.stiff / Math.max(0.35, g), c = STRAND_DAMP * HAIR_TUNE.damp * Math.sqrt(HAIR_TUNE.stiff) / Math.max(0.5, Math.sqrt(g));
              const v = st.v[j], q = st.p[j];
              v[0] += (k * (tx - q[0]) - c * v[0]) * h;
              v[1] += (k * (ty - q[1]) - c * v[1]) * h;
              q[0] += v[0] * h;
              q[1] += v[1] * h;
            }
            st.p[0] = [...target[0]];
          }
          for (let j = 0; j < 4; j++) {
            const o = [st.p[j][0] - target[j][0], st.p[j][1] - target[j][1]];
            out[j] = softLimit(o, Math.max(0.5, cfg.max * HAIR_TUNE.reach * Math.max(1, g) * j / 3));
          }
        });
        for (const [k, cfg] of Object.entries(HAIR)) {
          const s = this.hair[k];
          const a = this.hairAnchor(cfg.at, P);
          const wind = Math.sin(this.time * 1.3 + cfg.at[0] * 0.01) * 0.6 + Math.sin(this.time * 2.9 + cfg.at[1] * 0.02) * 0.4;
          const tx = a[0] - Math.sin(roll) * cfg.hang + wind * cfg.max * 0.12;
          const ty = a[1];
          if (!s.p) s.p = [tx, ty];
          const k2 = cfg.k / Math.max(0.35, g), c2 = cfg.c / Math.max(0.5, Math.sqrt(g));
          for (let i = 0; i < sub; i++) {
            s.v[0] += (k2 * (tx - s.p[0]) - c2 * s.v[0]) * h;
            s.v[1] += (k2 * (ty - s.p[1]) - c2 * s.v[1]) * h;
            s.p[0] += s.v[0] * h;
            s.p[1] += s.v[1] * h;
          }
          const o = [s.p[0] - a[0], s.p[1] - a[1]];
          clampLen(o, cfg.max * Math.max(1, g));
          this.out[k] = o;
        }
        this.out.gain = 1;
        const O = this.out.strands;
        for (let pass = 0; pass < HAIR_TUNE.bind; pass++) for (let j = 1; j < 4; j++) {
          const snap = O.slice(0, FRINGE).map((o) => [...o[j]]);
          for (let i = 0; i < FRINGE; i++) {
            const l = snap[Math.max(0, i - 1)], r = snap[Math.min(FRINGE - 1, i + 1)];
            for (const a of [0, 1]) O[i][j][a] = snap[i][a] * 0.5 + (l[a] + r[a]) * 0.25;
          }
        }
        for (const ch of this.chains) {
          const A = tasselAnchor(ch.t, P, this.out, [0, 0]);
          if (!ch.st) ch.st = { th: [0, 0], w: [0, 0], pos: [...A], vel: [0, 0], acc: [0, 0] };
          const st = ch.st, T = TASSEL_TUNE;
          const vel = [(A[0] - st.pos[0]) / Math.max(dt, 1e-3), (A[1] - st.pos[1]) / Math.max(dt, 1e-3)];
          const kf = 1 - Math.exp(-dt * T.smooth);
          const acc = [(vel[0] - st.vel[0]) / Math.max(dt, 1e-3), (vel[1] - st.vel[1]) / Math.max(dt, 1e-3)];
          st.acc = [st.acc[0] + (acc[0] - st.acc[0]) * kf, st.acc[1] + (acc[1] - st.acc[1]) * kf];
          st.vel = [st.vel[0] + (vel[0] - st.vel[0]) * kf, st.vel[1] + (vel[1] - st.vel[1]) * kf];
          st.pos = [...A];
          const nrm = [-ch.dir[1], ch.dir[0]];
          const push = -(st.acc[0] * nrm[0] + st.acc[1] * nrm[1]) / (ch.L1 + ch.L2) * T.inertia;
          const wind = (Math.sin(this.time * 0.9 + ch.t.pivot[0]) * 0.6 + Math.sin(this.time * 0.37 + ch.t.pivot[1]) * 0.4) * T.wind;
          const target = -roll * T.hang + wind;
          const w1 = 2 * Math.PI * T.freq / Math.sqrt(Math.max(0.4, g)), w2 = w1 * 1.35;
          for (let i = 0; i < sub; i++) {
            const a1 = -w1 * w1 * (st.th[0] - target) - 2 * T.zeta * w1 * st.w[0] + push;
            st.w[0] += a1 * h;
            st.th[0] += st.w[0] * h;
            const a2 = -w2 * w2 * (st.th[1] - st.th[0]) - 2 * T.zeta * w2 * st.w[1] + push * 0.4 + a1 * 0.5;
            st.w[1] += a2 * h;
            st.th[1] += st.w[1] * h;
          }
          st.th[0] = Math.max(-T.max, Math.min(T.max, st.th[0]));
          st.th[1] = Math.max(-T.max * 1.4, Math.min(T.max * 1.4, st.th[1]));
          ch.phi = [st.th[0], st.th[1]];
          const d1 = rotV(ch.dir, st.th[0]), d2 = rotV(ch.dir, st.th[1]);
          const p1 = [A[0] + d1[0] * ch.L1, A[1] + d1[1] * ch.L1];
          ch.pts = [[...A], p1, [p1[0] + d2[0] * ch.L2, p1[1] + d2[1] * ch.L2]];
          ch.anchor = A;
        }
        this.time += dt;
        return this.out;
      }
    }
    return { Physics };
  }

  // vendor/mesh-avatar-studio/engine/sprites.js
  function createSpriteModule(engine, rig) {
    const { baseWeights, deformBase, MOUTH } = engine;
    const sstep2 = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const MOUTH_AREA = rig.mouth.area;
    const MOUTH_SHAPES = {
      a: { sprite: "mouth_a", ref: 0.9, width: 1 },
      aHalf: { sprite: "mouth_a_half", ref: 0.55, width: 1 },
      i: { sprite: "mouth_i", ref: 0.55, width: 1 },
      e: { sprite: "mouth_a_half", ref: 0.65, width: 1.06 },
      o: { sprite: "mouth_o", ref: 0.75, width: 1 },
      u: { sprite: "mouth_o", ref: 0.75, width: 0.78 }
    };
    const MOUTH_OPEN_MIN = 0.16;
    function classifyVowel(form, prev) {
      const pad = 0.07;
      const inside = (v, lo, hi) => v >= lo - (prev ? pad : 0) && v < hi + (prev ? pad : 0);
      const regions = [["i", -9, -0.55], ["e", -0.55, -0.2], ["a", -0.2, 0.35], ["o", 0.35, 0.75], ["u", 0.75, 9]];
      const was = prev && regions.find((r) => r[0] === prev || prev === "aHalf" && r[0] === "a");
      if (was && inside(form, was[1], was[2])) return was[0];
      return regions.find((r) => form >= r[1] && form < r[2])[0];
    }
    const EYE_OPEN_MIN = 0.75, EYE_CLOSED_MAX = 0.3, EYE_FADE_SEC = 0.06;
    function eyeSprite(open, smile) {
      if (open >= EYE_OPEN_MIN) return null;
      if (open < EYE_CLOSED_MAX) return smile >= 0.5 ? "eyes_smile" : "eyes_closed";
      return "eyes_half";
    }
    function mouthShape(open, form, prev = null) {
      if (open < MOUTH_OPEN_MIN) return null;
      const v = classifyVowel(form, prev);
      if (v === "a") return open >= 0.6 ? "a" : "aHalf";
      return v;
    }
    function mouthLineY(x) {
      return MOUTH.cy + (x - MOUTH.cx) * Math.tan(MOUTH.angle);
    }
    function mouthCenterX() {
      return MOUTH_AREA.cx;
    }
    function mouthInner(x, y) {
      const c = Math.cos(-MOUTH_AREA.angle), s = Math.sin(-MOUTH_AREA.angle);
      const dx = x - MOUTH_AREA.cx, dy = y - MOUTH_AREA.cy;
      const u = (dx * c - dy * s) / MOUTH_AREA.rx, v = (dx * s + dy * c) / MOUTH_AREA.ry;
      return 1 - sstep2(0.55, 0.95, Math.hypot(u, v));
    }
    function createSprites(R, sheet, imgs, buildGrid, alphaOf2) {
      const items = {};
      const order = (n) => n.startsWith("eyes_half") ? 0 : n.startsWith("eyes_") ? 1 : 2;
      const entries = Object.entries(sheet.layers).sort((x, y) => order(x[0]) - order(y[0]));
      for (const [name, rect] of entries) {
        const mesh = buildGrid(rect, rig.mesh.spriteCell, alphaOf2(imgs[name]), imgs[name].width);
        const W = [], inner = [];
        for (let k = 0; k < mesh.rest.length / 2; k++) {
          const x = mesh.rest[k * 2], y = mesh.rest[k * 2 + 1];
          W.push(baseWeights(x, y, 0));
          inner.push(name.startsWith("mouth") ? mouthInner(x, y) : 0);
        }
        const layer = R.addLayer(name, imgs[name], mesh, { color: [0.4, 1, 0.8, 0.6] });
        layer.visible = false;
        items[name] = { mesh, W, inner, layer };
      }
      const tmp = [0, 0];
      let lastShape = null;
      const eyeState = [0, 1].map(() => ({ cur: "open", prev: "open", t: 1 }));
      function place(item, P, phys, squash, width = 1) {
        const r = item.mesh.rest, o = item.mesh.pos;
        for (let k = 0; k < item.W.length; k++) {
          let x = r[k * 2];
          let y = r[k * 2 + 1];
          const w = item.inner[k];
          if (w > 0) {
            const line2 = mouthLineY(x);
            y = line2 + (y - line2) * (1 + (squash - 1) * w);
            x = mouthCenterX() + (x - mouthCenterX()) * (1 + (width - 1) * w);
          }
          deformBase(x, y, item.W[k], P, phys, tmp);
          o[k * 2] = tmp[0];
          o[k * 2 + 1] = tmp[1];
        }
      }
      return {
        /**
         * Show / hide and deform the sprites for this frame.
         * Returns which eyes are covered by a sprite, so the layered eye parts can be hidden.
         */
        update(P, phys, dt = 1 / 60) {
          for (const it of Object.values(items)) it.layer.visible = false;
          const covered = [false, false];
          const eyes = [
            [P.eyeROpen, P.eyeSmile],
            [P.eyeLOpen, P.eyeSmileL ?? P.eyeSmile]
          ];
          eyes.forEach(([open, smile], i) => {
            const st = eyeState[i];
            const want = eyeSprite(open, smile) ?? "open";
            if (want !== st.cur) {
              st.prev = st.cur;
              st.cur = want;
              st.t = 0;
            }
            st.t = Math.min(1, st.t + dt / EYE_FADE_SEC);
            const k = sstep2(0, 1, st.t);
            const show = (name, alpha) => {
              if (name === "open" || alpha <= 1e-3) return;
              const it = items[`${name}_${i}`];
              if (!it) return;
              it.layer.visible = true;
              it.layer.alpha = alpha;
              place(it, P, phys, 1);
            };
            const rank = (n) => n === "open" ? -1 : n === "eyes_half" ? 0 : 1;
            if (st.t >= 1) show(st.cur, 1);
            else if (rank(st.cur) > rank(st.prev)) {
              show(st.prev, 1);
              show(st.cur, k);
            } else {
              show(st.cur, 1);
              show(st.prev, 1 - k);
            }
            covered[i] = st.cur !== "open" && k >= 0.999;
          });
          const shape = mouthShape(P.mouthOpen, P.mouthForm, lastShape);
          lastShape = shape;
          const def = shape && MOUTH_SHAPES[shape];
          const mt = def && items[def.sprite];
          if (mt) {
            mt.layer.visible = true;
            mt.layer.alpha = sstep2(MOUTH_OPEN_MIN, MOUTH_OPEN_MIN + 0.04, P.mouthOpen);
            const squash = Math.min(1.1, Math.max(0.5, P.mouthOpen / def.ref));
            place(mt, P, phys, squash, def.width);
          }
          return { eyes: covered, mouth: shape };
        }
      };
    }
    return { createSprites, mouthShape, eyeSprite };
  }

  // vendor/mesh-avatar-studio/engine/motions.js
  var ADDITIVE = /* @__PURE__ */ new Set([
    "angleX",
    "angleY",
    "angleZ",
    "bodyAngleX",
    "bodyAngleZ",
    "armAngle",
    "handAngle",
    "gazeX",
    "gazeY"
  ]);
  var MOTIONS = {
    nod: {
      label: "Nod",
      dur: 1.7,
      tracks: {
        angleY: [[0, 0], [0.32, -13], [0.62, 2], [0.95, -9], [1.3, 1], [1.7, 0]],
        angleZ: [[0, 0], [0.4, -2], [1, -1], [1.7, 0]],
        bodyAngleX: [[0, 0], [0.5, -1.5], [1.7, 0]],
        eyeSmile: [[0, 0], [0.3, 0.45], [1.3, 0.45], [1.7, 0]],
        eyeOpen: [[0, 1], [0.3, 0.72], [1.3, 0.72], [1.7, 1]],
        mouthOpen: [[0, 0], [0.3, 0.12], [1.3, 0.12], [1.7, 0]],
        mouthForm: [[0, 0], [0.3, -0.6], [1.7, -0.3]]
      }
    },
    tilt: {
      label: "Head tilt",
      dur: 2.6,
      tracks: {
        angleZ: [[0, 0], [0.55, 17], [2, 15], [2.6, 0]],
        angleX: [[0, 0], [0.6, 8], [2, 7], [2.6, 0]],
        angleY: [[0, 0], [0.6, 4], [2.6, 0]],
        bodyAngleZ: [[0, 0], [0.8, 3], [2, 3], [2.6, 0]],
        gazeX: [[0, 0], [0.4, 0.5], [2.1, 0.4], [2.6, 0]],
        gazeY: [[0, 0], [0.4, 0.35], [2.1, 0.3], [2.6, 0]],
        browAngle: [[0, 0], [0.5, -0.7], [2.1, -0.6], [2.6, 0]],
        browY: [[0, 0], [0.5, 0.35], [2.1, 0.3], [2.6, 0]]
        // closed mouth: a barely open round mouth read as a squashed blob
      }
    },
    think: {
      label: "Thinking",
      dur: 3.6,
      tracks: {
        angleX: [[0, 0], [0.7, -11], [3, -9], [3.6, 0]],
        angleY: [[0, 0], [0.7, 9], [3, 8], [3.6, 0]],
        angleZ: [[0, 0], [0.8, 6], [3, 5], [3.6, 0]],
        gazeX: [[0, 0], [0.35, -0.8], [3.1, -0.7], [3.6, 0]],
        gazeY: [[0, 0], [0.35, 0.7], [3.1, 0.6], [3.6, 0]],
        handAngle: [[0, 0], [0.6, 3], [3, 3], [3.6, 0]],
        fingerTap: [
          [0, 0],
          [0.9, 0],
          [1.05, 1],
          [1.2, 0],
          [1.4, 1],
          [1.55, 0],
          [1.75, 1],
          [1.9, 0],
          [2.3, 0],
          [2.45, 1],
          [2.6, 0],
          [3.6, 0]
        ],
        browY: [[0, 0], [0.6, 0.25], [3, 0.2], [3.6, 0]],
        browAngle: [[0, 0], [0.6, -0.3], [3, -0.3], [3.6, 0]],
        mouthForm: [[0, 0], [0.6, 0.4], [3.6, 0]]
      }
    },
    giggle: {
      label: "Chuckle",
      dur: 2.2,
      tracks: {
        eyeOpen: [[0, 1], [0.2, 0], [1.8, 0], [2.2, 1]],
        eyeSmile: [[0, 0], [0.2, 1], [1.8, 1], [2.2, 0]],
        mouthOpen: [[0, 0], [0.2, 0.5], [0.45, 0.32], [0.7, 0.55], [0.95, 0.34], [1.2, 0.5], [1.8, 0.3], [2.1, 0]],
        mouthForm: [[0, 0], [0.2, -0.8], [2.2, -0.2]],
        blush: [[0, 0], [0.3, 0.7], [1.8, 0.7], [2.2, 0.1]],
        angleY: [[0, 0], [0.2, -5], [0.45, -1], [0.7, -6], [0.95, -2], [1.2, -5], [1.6, -2], [2.2, 0]],
        angleZ: [[0, 0], [0.3, -6], [1.8, -5], [2.2, 0]],
        bodyAngleZ: [[0, 0], [0.25, 2], [0.5, -1], [0.75, 2], [1, -1], [1.3, 1.5], [2.2, 0]],
        browY: [[0, 0], [0.3, 0.3], [1.8, 0.3], [2.2, 0]]
      }
    },
    surprise: {
      label: "Surprise",
      dur: 2,
      tracks: {
        angleY: [[0, 0], [0.12, 10], [0.5, 6], [1.5, 5], [2, 0]],
        angleX: [[0, 0], [0.12, -4], [2, 0]],
        bodyAngleX: [[0, 0], [0.15, -4], [1.5, -3], [2, 0]],
        eyeOpen: [[0, 1], [0.1, 1.25], [1.5, 1.2], [2, 1]],
        browY: [[0, 0], [0.1, 1], [1.5, 0.9], [2, 0]],
        mouthOpen: [[0, 0], [0.12, 0.6], [1.4, 0.45], [2, 0]],
        mouthForm: [[0, 0], [0.12, 0.6], [1.5, 0.55], [2, 0]],
        // o
        armAngle: [[0, 0], [0.15, -4], [1.5, -3], [2, 0]]
      }
    },
    shy: {
      label: "Shy",
      dur: 3.2,
      tracks: {
        angleX: [[0, 0], [0.6, 14], [2.6, 12], [3.2, 0]],
        angleY: [[0, 0], [0.6, -9], [2.6, -8], [3.2, 0]],
        angleZ: [[0, 0], [0.7, -8], [2.6, -7], [3.2, 0]],
        gazeX: [[0, 0], [0.3, 0.8], [1.6, 0.8], [1.9, -0.3], [2.2, 0.8], [2.8, 0.6], [3.2, 0]],
        gazeY: [[0, 0], [0.3, -0.5], [2.8, -0.4], [3.2, 0]],
        eyeOpen: [[0, 1], [0.5, 0.75], [2.7, 0.75], [3.2, 1]],
        eyeSmile: [[0, 0], [0.5, 0.5], [2.7, 0.5], [3.2, 0]],
        blush: [[0, 0], [0.8, 1], [2.7, 1], [3.2, 0]],
        browAngle: [[0, 0], [0.5, -0.6], [2.7, -0.5], [3.2, 0]],
        mouthForm: [[0, 0], [0.5, -0.4], [3.2, 0]],
        handAngle: [[0, 0], [0.8, 4], [2.6, 4], [3.2, 0]]
      }
    },
    no: {
      label: "Shake head",
      dur: 1.9,
      tracks: {
        angleX: [[0, 0], [0.2, 13], [0.45, -13], [0.7, 12], [0.95, -10], [1.2, 5], [1.5, 0]],
        angleY: [[0, 0], [0.2, -3], [1.3, -3], [1.9, 0]],
        bodyAngleX: [[0, 0], [0.3, 1.5], [0.6, -1.5], [0.9, 1], [1.3, 0]],
        eyeOpen: [[0, 1], [0.15, 0], [1.4, 0], [1.9, 1]],
        eyeSmile: [[0, 0], [0.15, 1], [1.4, 1], [1.9, 0]],
        // closed mouth while shaking the head
        browAngle: [[0, 0], [0.2, -0.5], [1.4, -0.5], [1.9, 0]]
      }
    },
    wink: {
      label: "Wink",
      dur: 2,
      tracks: {
        angleZ: [[0, 0], [0.35, -13], [1.5, -12], [2, 0]],
        angleX: [[0, 0], [0.35, 9], [1.5, 8], [2, 0]],
        bodyAngleZ: [[0, 0], [0.5, -2], [1.5, -2], [2, 0]],
        eyeOpenL: [[0, 1], [0.25, 1], [0.4, 0], [1.4, 0], [1.6, 1]],
        eyeSmileL: [[0, 0], [0.3, 1], [1.5, 1], [1.7, 0]],
        mouthOpen: [[0, 0], [2, 0]],
        // wink with a closed smile
        mouthForm: [[0, 0], [0.35, -0.8], [2, 0]],
        blush: [[0, 0], [0.4, 0.5], [1.6, 0.5], [2, 0]]
      }
    },
    greet: {
      label: "Greeting",
      dur: 2.6,
      tracks: {
        angleY: [[0, 0], [0.7, -18], [1.2, -17], [1.9, 2], [2.6, 0]],
        bodyAngleX: [[0, 0], [0.8, 2], [1.8, 0]],
        bodyAngleZ: [[0, 0], [0.8, 1.5], [2, 0]],
        armAngle: [[0, 0], [0.8, 3], [2, 0]],
        eyeOpen: [[0, 1], [0.5, 0], [1.4, 0], [1.8, 1]],
        eyeSmile: [[0, 0], [0.5, 1], [1.6, 1], [2.3, 0.4], [2.6, 0]],
        mouthOpen: [[0, 0], [1.6, 0], [1.8, 0.3], [2.3, 0.2], [2.6, 0]],
        mouthForm: [[0, 0], [1.6, -0.8], [2.6, -0.3]],
        blush: [[0, 0], [1.6, 0.3], [2.6, 0]]
      }
    }
  };
  var IDLE_MOTIONS = {
    lookAround: {
      label: "Look around",
      dur: 5.2,
      idle: true,
      tracks: {
        gazeX: [[0, 0], [0.25, -0.85], [1.5, -0.8], [1.8, 0.1], [2.1, 0.85], [3.4, 0.8], [3.7, 0], [5.2, 0]],
        gazeY: [[0, 0], [0.25, 0.15], [1.8, 0.25], [2.1, 0.1], [3.7, 0], [5.2, 0]],
        angleX: [[0, 0], [0.7, -20], [1.6, -18], [2.5, 19], [3.5, 17], [4.4, 0], [5.2, 0]],
        angleY: [[0, 0], [0.7, 3], [1.8, 5], [2.5, 3], [4.4, 0]],
        angleZ: [[0, 0], [0.8, 4], [1.8, 0], [2.6, -4], [4.4, 0]],
        bodyAngleX: [[0, 0], [1, -4], [2.8, 4], [4.6, 0]],
        bodyAngleZ: [[0, 0], [1, 1.5], [2.8, -1.5], [4.6, 0]],
        handAngle: [[0, 0], [1, -2], [2.8, 2], [4.6, 0]],
        browY: [[0, 0], [0.5, 0.35], [3.6, 0.3], [4.4, 0]],
        // curious: a quick inhale, held while looking, let out at the end
        breath: [[0, 0.2], [0.6, 0.85], [3.6, 0.7], [4.6, 0], [5.2, 0.1]]
      }
    },
    glance: {
      label: "Side glance",
      dur: 4.6,
      idle: true,
      tracks: {
        gazeX: [[0, 0], [0.18, 0.9], [2.6, 0.85], [2.9, 0.15], [3.2, 0], [4.6, 0]],
        gazeY: [[0, 0], [0.18, 0.4], [2.6, 0.35], [3.2, 0]],
        angleX: [[0, 0], [0.6, 13], [2.6, 11], [3.6, 0]],
        angleY: [[0, 0], [0.6, 6], [2.6, 5], [3.6, 0]],
        angleZ: [[0, 0], [0.7, -5], [2.6, -4], [3.6, 0]],
        bodyAngleX: [[0, 0], [1, 2.5], [2.8, 2], [4, 0]],
        eyeOpen: [[0, 1], [0.3, 1.06], [2.5, 1.05], [2.8, 0.85], [3.4, 1]],
        browY: [[0, 0], [0.4, 0.4], [2.5, 0.35], [3.4, 0]],
        browAngle: [[0, 0], [0.4, -0.2], [2.5, -0.2], [3.4, 0]],
        breath: [[0, 0], [0.5, 0.6], [2.6, 0.55], [3.8, 0], [4.6, 0.3]]
      }
    },
    sway: {
      label: "Sway",
      dur: 7,
      idle: true,
      tracks: {
        bodyAngleZ: [[0, 0], [1.6, 6], [3.4, -6], [5.2, 5], [7, 0]],
        bodyAngleX: [[0, 0], [1.6, 3], [3.4, -3], [5.2, 2.5], [7, 0]],
        angleZ: [[0, 0], [1.8, -10], [3.6, 10], [5.4, -8], [7, 0]],
        angleX: [[0, 0], [1.8, 6], [3.6, -6], [5.4, 5], [7, 0]],
        angleY: [[0, 0], [0.9, 3], [1.8, 0], [2.7, 3], [3.6, 0], [4.5, 3], [5.4, 0], [7, 0]],
        armAngle: [[0, 0], [1.6, 3], [3.4, -3], [5.2, 2], [7, 0]],
        handAngle: [[0, 0], [1.8, -4], [3.6, 4], [5.4, -3], [7, 0]],
        gazeX: [[0, 0], [1.8, -0.3], [3.6, 0.3], [5.4, -0.2], [7, 0]],
        eyeOpen: [[0, 1], [0.8, 0.82], [6.2, 0.82], [7, 1]],
        eyeSmile: [[0, 0], [0.8, 0.35], [6.2, 0.35], [7, 0]],
        // slow, even breaths in time with the sway
        breath: [[0, 0], [0.9, 1], [1.8, 0], [2.7, 1], [3.6, 0], [4.5, 1], [5.4, 0], [6.3, 0.8], [7, 0]]
      }
    },
    sigh: {
      label: "Sigh",
      dur: 5.6,
      idle: true,
      tracks: {
        breath: [[0, 0], [1.3, 1.25], [1.9, 1.25], [3.6, 0], [5.6, 0]],
        angleY: [[0, 0], [1.3, 9], [1.9, 9], [3.3, -9], [4.6, -6], [5.6, 0]],
        angleZ: [[0, 0], [1.3, -3], [3.3, 5], [5.6, 0]],
        bodyAngleX: [[0, 0], [1.3, -2.5], [3.3, 2.5], [5.6, 0]],
        bodyAngleZ: [[0, 0], [1.9, 1], [3.3, -1.5], [5.6, 0]],
        armAngle: [[0, 0], [1.3, -2.5], [3.3, 2], [5.6, 0]],
        gazeY: [[0, 0], [1.2, 0.4], [2, 0.3], [3.2, -0.4], [4.8, -0.2], [5.6, 0]],
        eyeOpen: [[0, 1], [1, 0.95], [1.9, 0.6], [3.4, 0.6], [4.6, 0.78], [5.6, 1]],
        browY: [[0, 0], [1.3, 0.35], [3.2, -0.2], [5.6, 0]],
        browAngle: [[0, 0], [1.9, -0.4], [4.6, -0.35], [5.6, 0]]
      }
    },
    doze: {
      label: "Drowsy",
      dur: 7.2,
      idle: true,
      tracks: {
        eyeOpen: [[0, 1], [1.8, 0.78], [3.2, 0.62], [4.5, 0.55], [4.75, 1.1], [5.6, 1.05], [7.2, 1]],
        angleY: [[0, 0], [1.8, -6], [3.2, -9], [4.5, -17], [4.75, 5], [5.6, 2], [7.2, 0]],
        angleZ: [[0, 0], [2, 4], [4.5, 10], [4.75, -2], [7.2, 0]],
        angleX: [[0, 0], [4.5, -4], [4.75, 3], [5.4, -6], [6.2, 5], [7.2, 0]],
        bodyAngleZ: [[0, 0], [4.5, 3], [4.8, -2], [7.2, 0]],
        bodyAngleX: [[0, 0], [4.5, 2], [4.8, -1.5], [7.2, 0]],
        armAngle: [[0, 0], [4.5, 3], [4.8, -2], [7.2, 0]],
        handAngle: [[0, 0], [4.5, 5], [4.8, -1], [7.2, 0]],
        gazeY: [[0, 0], [4.5, -0.4], [4.75, 0.2], [7.2, 0]],
        gazeX: [[0, 0], [4.8, 0], [5.3, -0.6], [6.1, 0.6], [6.8, 0]],
        browY: [[0, 0], [4.5, -0.35], [4.75, 0.8], [5.8, 0.3], [7.2, 0]],
        // long, slow, deepening breaths; a sharp inhale on waking
        breath: [[0, 0], [1.1, 0.7], [2.6, 0], [3.8, 0.6], [4.5, 0.2], [4.8, 1.1], [6, 0.2], [7.2, 0]]
      }
    },
    stretch: {
      label: "Stretch",
      dur: 6.2,
      idle: true,
      tracks: {
        angleZ: [[0, 0], [1.3, -22], [2.3, -21], [3.8, 20], [4.8, 19], [6.2, 0]],
        angleY: [[0, 0], [1.3, 5], [2.3, 7], [3.1, -3], [3.8, 5], [4.8, 6], [6.2, 0]],
        angleX: [[0, 0], [1.3, -5], [3.8, 5], [6.2, 0]],
        bodyAngleZ: [[0, 0], [1.3, 4], [3.8, -4], [6.2, 0]],
        bodyAngleX: [[0, 0], [1.3, -2], [3.8, 2], [6.2, 0]],
        armAngle: [[0, 0], [1.3, 2], [3.8, -2], [6.2, 0]],
        eyeOpen: [[0, 1], [0.8, 0.62], [4.9, 0.62], [5.6, 1]],
        browAngle: [[0, 0], [1, -0.3], [4.9, -0.3], [5.8, 0]],
        breath: [[0, 0], [1.3, 1.1], [2.3, 0.9], [3.1, 0.2], [3.8, 1.1], [4.8, 0.9], [6.2, 0]]
      }
    },
    lean: {
      label: "Peek",
      dur: 4.8,
      idle: true,
      tracks: {
        bodyAngleX: [[0, 0], [0.9, 6], [3.4, 6], [4.4, 0]],
        bodyAngleZ: [[0, 0], [0.9, -3], [3.4, -3], [4.4, 0]],
        angleX: [[0, 0], [0.9, 9], [2, 7], [2.6, 10], [3.4, 8], [4.4, 0]],
        angleY: [[0, 0], [0.9, -6], [3.4, -5], [4.4, 0]],
        angleZ: [[0, 0], [0.9, 10], [2.2, 12], [3.4, 9], [4.4, 0]],
        armAngle: [[0, 0], [0.9, -3], [3.4, -3], [4.4, 0]],
        handAngle: [[0, 0], [0.9, 3], [3.4, 3], [4.4, 0]],
        gazeY: [[0, 0], [0.6, 0.45], [3.4, 0.4], [4.2, 0]],
        gazeX: [[0, 0], [1.5, 0], [1.8, -0.3], [2.3, 0.2], [2.8, 0], [4.2, 0]],
        eyeOpen: [[0, 1], [0.6, 1.1], [3.4, 1.08], [4.2, 1]],
        browY: [[0, 0], [0.6, 0.45], [3.4, 0.4], [4.2, 0]],
        browAngle: [[0, 0], [0.6, -0.3], [3.4, -0.3], [4.2, 0]],
        blush: [[0, 0], [1.2, 0.25], [3.4, 0.25], [4.4, 0]],
        breath: [[0, 0], [0.8, 0.8], [3.4, 0.6], [4.4, 0], [4.8, 0.2]]
      }
    },
    hum: {
      label: "Listen",
      dur: 5.6,
      idle: true,
      tracks: {
        angleY: [[0, 0], [0.45, -5], [0.9, 2], [1.35, -5], [1.8, 2], [2.25, -5], [2.7, 2], [3.15, -5], [3.6, 2], [4.05, -4], [4.8, 0]],
        angleZ: [[0, 0], [0.9, 8], [1.8, -8], [2.7, 8], [3.6, -8], [4.6, 0]],
        angleX: [[0, 0], [0.9, 4], [1.8, -4], [2.7, 4], [3.6, -4], [4.6, 0]],
        bodyAngleZ: [[0, 0], [0.9, -3], [1.8, 3], [2.7, -3], [3.6, 3], [4.6, 0]],
        bodyAngleX: [[0, 0], [1.8, 2], [3.6, -2], [4.8, 0]],
        handAngle: [[0, 0], [0.9, 3], [1.8, -3], [2.7, 3], [3.6, -3], [4.6, 0]],
        fingerTap: [[0, 0], [0.45, 1], [0.9, 0], [1.35, 1], [1.8, 0], [2.25, 1], [2.7, 0], [3.15, 1], [3.6, 0], [5.6, 0]],
        gazeX: [[0, 0], [0.9, 0.3], [1.8, -0.3], [2.7, 0.3], [3.6, -0.3], [4.6, 0]],
        eyeOpen: [[0, 1], [0.4, 0.72], [4.6, 0.72], [5.3, 1]],
        eyeSmile: [[0, 0], [0.4, 0.55], [4.6, 0.55], [5.3, 0]],
        blush: [[0, 0], [0.8, 0.3], [4.6, 0.3], [5.6, 0]],
        browY: [[0, 0], [0.5, 0.25], [4.6, 0.25], [5.4, 0]],
        breath: [[0, 0], [0.9, 0.9], [1.8, 0.2], [2.7, 0.9], [3.6, 0.2], [4.6, 0.8], [5.6, 0]]
      }
    },
    tap: {
      label: "Tap",
      dur: 5,
      idle: true,
      tracks: {
        gazeX: [[0, 0], [0.3, -0.6], [2.2, -0.5], [2.5, -0.1], [2.8, -0.6], [4.2, -0.5], [4.7, 0]],
        gazeY: [[0, 0], [0.3, 0.55], [4.2, 0.5], [4.7, 0]],
        angleX: [[0, 0], [0.8, -11], [2.4, -9], [3, -12], [4.2, -10], [5, 0]],
        angleY: [[0, 0], [0.8, 8], [4.2, 7], [5, 0]],
        angleZ: [[0, 0], [0.8, 6], [2.4, 4], [3, 7], [4.2, 5], [5, 0]],
        bodyAngleX: [[0, 0], [1, -2], [4.2, -2], [5, 0]],
        handAngle: [[0, 0], [0.8, 3], [4.2, 3], [5, 0]],
        fingerTap: [
          [0, 0],
          [0.9, 0],
          [1.05, 1],
          [1.2, 0],
          [1.4, 1],
          [1.55, 0],
          [1.75, 1],
          [1.9, 0],
          [2.6, 0],
          [2.75, 1],
          [2.9, 0],
          [3.1, 1],
          [3.25, 0],
          [5, 0]
        ],
        browY: [[0, 0], [0.6, 0.3], [4.2, 0.25], [5, 0]],
        browAngle: [[0, 0], [0.6, -0.35], [4.2, -0.3], [5, 0]],
        eyeOpen: [[0, 1], [0.6, 0.9], [4.2, 0.9], [5, 1]],
        breath: [[0, 0], [0.8, 0.7], [2.2, 0.4], [3.2, 0.8], [4.4, 0], [5, 0.2]]
      }
    },
    readNote: {
      label: "Read script",
      dur: 2.6,
      idle: true,
      tracks: {
        // a quick look down at the notes on the desk and back to the camera
        gazeY: [[0, 0], [0.2, -0.85], [1.5, -0.8], [1.75, 0], [2.6, 0]],
        gazeX: [[0, 0], [0.2, -0.15], [1.5, -0.1], [1.75, 0]],
        angleY: [[0, 0], [0.45, -9], [1.5, -8], [2, 1], [2.6, 0]],
        angleZ: [[0, 0], [0.5, 2], [1.6, 2], [2.6, 0]],
        eyeOpen: [[0, 1], [0.3, 0.78], [1.5, 0.78], [1.75, 1]],
        breath: [[0, 0.3], [0.8, 0.5], [1.8, 0.2], [2.6, 0.4]]
      }
    },
    waiting: {
      label: "Fidget",
      dur: 6.4,
      idle: true,
      tracks: {
        // shifts her weight, checks the viewer, looks away, shifts back
        bodyAngleZ: [[0, 0], [0.9, 5], [2.4, 4], [3.3, -5], [5.2, -4], [6.4, 0]],
        bodyAngleX: [[0, 0], [0.9, 3], [3.3, -3], [5.2, -2], [6.4, 0]],
        angleZ: [[0, 0], [1, -6], [2.4, -4], [3.4, 6], [5.2, 5], [6.4, 0]],
        angleX: [[0, 0], [1.2, -8], [2.2, 2], [3.6, 12], [5, 10], [6.2, 0]],
        angleY: [[0, 0], [1.2, -3], [2.2, 2], [3.6, -2], [6.2, 0]],
        armAngle: [[0, 0], [0.9, 3], [3.3, -3], [5.2, -2], [6.4, 0]],
        handAngle: [[0, 0], [1.2, 3], [3.4, -3], [6.4, 0]],
        fingerTap: [[0, 0], [4.2, 0], [4.35, 1], [4.5, 0], [4.7, 1], [4.85, 0], [6.4, 0]],
        gazeX: [[0, 0], [0.9, -0.7], [1.9, -0.6], [2.1, 0], [2.7, 0], [2.9, 0.8], [5, 0.7], [5.4, 0], [6.4, 0]],
        gazeY: [[0, 0], [0.9, -0.2], [2.1, 0], [2.9, 0.3], [5.4, 0]],
        eyeOpen: [[0, 1], [2, 1], [2.2, 1.06], [2.8, 1.05], [3.1, 0.85], [5.4, 0.85], [6.2, 1]],
        browAngle: [[0, 0], [0.9, -0.35], [2, -0.35], [2.3, 0], [3.1, -0.4], [5.4, -0.35], [6.4, 0]],
        browY: [[0, 0], [2.2, 0.4], [2.8, 0.35], [3.2, 0], [6.4, 0]],
        breath: [[0, 0.3], [0.9, 0.8], [2, 0.3], [2.6, 0.9], [3.4, 0.2], [4.4, 0.8], [5.6, 0], [6.4, 0.2]]
      }
    },
    spaceOut: {
      label: "Daydream",
      dur: 7.4,
      idle: true,
      tracks: {
        // gaze drifts up and away, breaths get slow and long, one slow blink
        gazeX: [[0, 0], [1.4, -0.55], [4.8, -0.6], [5.6, 0.1], [7, 0]],
        gazeY: [[0, 0], [1.4, 0.6], [4.8, 0.55], [5.6, 0], [7, 0]],
        angleX: [[0, 0], [2, -9], [4.8, -10], [6, 2], [7.4, 0]],
        angleY: [[0, 0], [2, 7], [4.8, 8], [6, -2], [7.4, 0]],
        angleZ: [[0, 0], [2, 9], [4.8, 11], [6, 2], [7.4, 0]],
        bodyAngleZ: [[0, 0], [2.2, 3], [4.8, 3.5], [6.4, 0]],
        bodyAngleX: [[0, 0], [2.2, -2], [4.8, -2], [6.4, 0]],
        handAngle: [[0, 0], [2.2, 4], [4.8, 5], [6.4, 0]],
        armAngle: [[0, 0], [2.2, 2], [4.8, 2], [6.4, 0]],
        eyeOpen: [[0, 1], [1.4, 0.8], [3, 0.8], [3.35, 0.56], [3.8, 0.8], [4.8, 0.8], [5.6, 1.04], [6.4, 1]],
        browY: [[0, 0], [1.6, 0.15], [4.8, 0.15], [5.6, 0.35], [6.6, 0]],
        breath: [[0, 0], [1.6, 0.9], [3.4, 0], [5, 0.9], [6.2, 0.1], [7.4, 0]]
      }
    }
  };
  function sampleTrack(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    const n = keys.length - 1;
    if (t >= keys[n][0]) return keys[n][1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    const tan = (j) => j <= 0 || j >= n ? 0 : (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0]);
    const h = t1 - t0, u = (t - t0) / h;
    const m0 = tan(i) * h, m1 = tan(i + 1) * h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1;
  }

  // vendor/mesh-avatar-studio/engine/kana.js
  var VOWELS = {
    a: { open: 0.9, form: 0, label: "\u3042" },
    i: { open: 0.5, form: -0.85, label: "\u3044" },
    u: { open: 0.4, form: 0.9, label: "\u3046" },
    e: { open: 0.62, form: -0.4, label: "\u3048" },
    o: { open: 0.75, form: 0.6, label: "\u304A" },
    n: { open: 0, form: null, label: "\u3093" }
    // closes with the previous shape
  };
  var ROWS = {
    a: "\u3042\u304B\u3055\u305F\u306A\u306F\u307E\u3084\u3089\u308F\u304C\u3056\u3060\u3070\u3071\u3041",
    i: "\u3044\u304D\u3057\u3061\u306B\u3072\u307F\u308A\u304E\u3058\u3062\u3073\u3074\u3043",
    u: "\u3046\u304F\u3059\u3064\u306C\u3075\u3080\u3086\u308B\u3050\u305A\u3065\u3076\u3077\u3045\u3094",
    e: "\u3048\u3051\u305B\u3066\u306D\u3078\u3081\u308C\u3052\u305C\u3067\u3079\u307A\u3047",
    o: "\u304A\u3053\u305D\u3068\u306E\u307B\u3082\u3088\u308D\u3092\u3054\u305E\u3069\u307C\u307D\u3049"
  };
  var VOWEL_OF = {};
  for (const [v, chars] of Object.entries(ROWS)) for (const c of chars) VOWEL_OF[c] = v;
  var LIPS_CLOSE = /* @__PURE__ */ new Set([..."\u307E\u307F\u3080\u3081\u3082\u3070\u3073\u3076\u3079\u307C\u3071\u3074\u3077\u307A\u307D"]);
  var PLAIN_VOWEL = /* @__PURE__ */ new Set([..."\u3042\u3044\u3046\u3048\u304A\u3041\u3043\u3045\u3047\u3049"]);
  var SMALL_Y = { \u3083: "a", \u3085: "u", \u3087: "o" };
  var PAUSE = /* @__PURE__ */ new Set([..."\u3001\u3002\uFF0C\uFF0E,.\uFF01\uFF1F!? \u3000\u2026"]);
  var toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96));
  function kanaToMoras(text, mora = 0.14) {
    const out = [];
    for (const c of toHiragana(text)) {
      const last = out[out.length - 1];
      if (SMALL_Y[c] && last) {
        last.vowel = SMALL_Y[c];
        continue;
      }
      if (c === "\u30FC" && last) {
        last.dur += mora;
        continue;
      }
      if (c === "\u3063") {
        out.push({ vowel: "n", dur: mora * 0.8, onset: null });
        continue;
      }
      if (c === "\u3093") {
        out.push({ vowel: "n", dur: mora, onset: null });
        continue;
      }
      if (PAUSE.has(c)) {
        out.push({ vowel: "n", dur: mora * 2.2, onset: null });
        continue;
      }
      const v = VOWEL_OF[c];
      if (!v) continue;
      out.push({ vowel: v, dur: mora, onset: LIPS_CLOSE.has(c) ? "lips" : PLAIN_VOWEL.has(c) ? null : "consonant" });
    }
    return out;
  }
  function sampleMoras(moras, t) {
    let start = 0;
    for (const m of moras) {
      if (t < start + m.dur) {
        const x = (t - start) / m.dur;
        const v = VOWELS[m.vowel];
        const onset = m.onset === "lips" ? 0.05 : m.onset === "consonant" ? 0.45 : 1;
        const k = x < 0.35 ? onset + (1 - onset) * (x / 0.35) : 1;
        return { open: v.open * k, form: v.form, vowel: m.vowel };
      }
      start += m.dur;
    }
    return null;
  }

  // vendor/mesh-avatar-studio/engine/motion.js
  var ALL_MOTIONS = { ...MOTIONS, ...IDLE_MOTIONS };
  var IDLE_GAIN = { amp: 1, stiff: 1.8 };
  var IDLE_SCALED = /^(angle|bodyAngle|armAngle|handAngle)/;
  var FACE_TRACKS = /* @__PURE__ */ new Set([
    "eyeOpen",
    "eyeOpenL",
    "eyeSmileL",
    "eyeSmile",
    "mouthOpen",
    "mouthForm",
    "blush",
    "browY",
    "browAngle"
  ]);
  var sstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  function noise(t, seed) {
    const i = Math.floor(t), f = t - i;
    const h = (n) => {
      const x = Math.sin((n + seed * 57.3) * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };
    const u = f * f * (3 - 2 * f);
    return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
  }
  var fbm = (t, s) => noise(t, s) * 0.7 + noise(t * 2.3, s + 9) * 0.3;
  var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  var EXPRESSIONS = {
    normal: { label: "Neutral", p: {} },
    smile: { label: "Smile", p: { eyeOpen: 0, eyeSmile: 1, blush: 0.35, browY: 0.2 } },
    shy: { label: "Blush", p: { eyeOpen: 0.78, eyeSmile: 0.5, blush: 1, browAngle: -0.5, browY: -0.1, glance: [0.7, 0.35] } },
    jito: { label: "Half-lidded", p: { eyeOpen: 0.5, browY: -0.5, browAngle: 0.6 } },
    surprise: { label: "Surprise", p: { eyeOpen: 1.22, browY: 1, mouthOpen: 0.6, mouthForm: 0.6 } },
    wink: { label: "Wink", p: { eyeOpenL: 0, eyeSmileL: 1, blush: 0.3 } },
    // talking faces for AITuber OnAir emotion tags: eyes stay mostly open (closed / ^^ eyes are
    // what a single image fakes worst, and they would stay shut for a whole sentence)
    happyTalk: { label: "happy", p: { eyeOpen: 0.8, eyeSmile: 0.45, blush: 0.35, browY: 0.25, mouthForm: -0.5 } },
    sadTalk: { label: "sad", p: { eyeOpen: 0.78, browAngle: -0.8, browY: -0.2, mouthForm: 0.3, glance: [0, -0.35] } },
    angryTalk: { label: "angry", p: { eyeOpen: 0.72, browAngle: 0.85, browY: -0.55, mouthForm: 0.2 } },
    surprisedTalk: { label: "surprised", p: { eyeOpen: 1.18, browY: 0.9, mouthForm: 0.9 } },
    relaxedTalk: { label: "relaxed", p: { eyeOpen: 0.82, eyeSmile: 0.35, blush: 0.15, browY: 0.1 } }
  };
  var EMOTIONS = {
    happy: ["happyTalk", "nod"],
    sad: ["sadTalk", "sigh"],
    angry: ["angryTalk", "no"],
    surprised: ["surprisedTalk", "surprise"],
    relaxed: ["relaxedTalk", "sway"],
    neutral: ["normal", null]
  };
  var SPRINGS = {
    gazeX: [260, 0.9],
    gazeY: [260, 0.9],
    angleX: [55, 0.72],
    angleY: [55, 0.72],
    angleZ: [45, 0.75],
    bodyAngleX: [14, 0.9],
    bodyAngleZ: [12, 0.9],
    armAngle: [20, 0.85],
    handAngle: [30, 0.8]
  };
  var Motion = class {
    /** @param {number[]} gazeCenter */
    constructor(gazeCenter) {
      this.mode = "auto";
      this.P = Object.fromEntries(PARAMS.map((p) => [p.id, p.def]));
      this.manual = { ...this.P };
      this.cur = { ...this.P };
      this.vel = Object.fromEntries(PARAMS.map((p) => [p.id, 0]));
      this.expr = "normal";
      this.exprMix = {};
      this.t = 0;
      this.blink = { t: 0, start: 1.5, double: false };
      this.gaze = { x: 0, y: 0, next: 0 };
      this.tap = { next: 4, until: -1 };
      this.pointer = null;
      this.faceCenter = [...gazeCenter];
      this.lipOpen = null;
      this.lipForm = 0;
      this.speaking = false;
      this.voice = 0;
      this.mouth = 0;
      this.vowel = "a";
      this.vowelForm = 0;
      this.syllableArmed = true;
      this.voicePeak = 0;
      this.voiceTrough = 0;
      this.kana = null;
      this.lipHold = null;
      this.emotionUntil = 0;
      this.talkGain = 1;
      this.play = null;
      this.autoMotion = true;
      this.nextAuto = 14;
      this.autoIdle = true;
      this.nextIdle = 3;
      this.lastAuto = null;
      this.onMotion = null;
    }
    setExpression(k) {
      this.expr = k;
    }
    hasMotion(id) {
      return id in ALL_MOTIONS;
    }
    // ---- speech (driven from outside, e.g. by the TTS audio analyser) ----
    setVoiceLevel(v) {
      this.voice = Math.min(1, Math.max(0, Number(v) || 0));
    }
    setSpeaking(on) {
      if (on === this.speaking) return;
      this.speaking = !!on;
      if (!on) {
        this.emotionUntil = this.t + 1.2;
        this.voice = 0;
      }
    }
    /** `playMotion: false` changes only the face (a caller that picks motions itself). */
    setEmotion(tag, { playMotion = true } = {}) {
      const e = EMOTIONS[tag] ?? EMOTIONS.neutral;
      this.expr = e[0];
      this.emotionUntil = Infinity;
      if (e[1] && playMotion) this.playMotion(e[1]);
    }
    /** Mouth shapes from kana text, without audio (preview / tuning). */
    /** @param {string} text @param {{ speed?: number, loop?: boolean }} [options] */
    speakKana(text, { speed, loop = false } = {}) {
      this.lipHold = null;
      const moras = kanaToMoras(text, speed === void 0 ? 0.14 : 1 / clamp(Number(speed) || 7, 4, 12));
      this.kana = moras.length ? { moras, t: 0, loop, duration: moras.reduce((sum, m) => sum + m.dur, 0) } : null;
    }
    holdMouth(vowel) {
      this.kana = null;
      this.lipHold = Object.hasOwn(VOWELS, vowel) ? vowel : null;
    }
    stopLipSync() {
      this.kana = null;
      this.lipHold = null;
      this.lipOpen = null;
      this.mouth = 0;
    }
    getLipSyncState() {
      return { active: this.kana !== null || this.lipHold !== null, open: this.P.mouthOpen, form: this.P.mouthForm };
    }
    // Mouth from the TTS loudness. A volume signal has no vowel information, so each syllable
    // (the voice dipping and rising again) gets one vowel at random, weighted towards a, and
    // keeps it until the next syllable: the drawn mouths must not change shape mid-syllable.
    // Syllables are found relative to the recent peak (not an absolute level), and the mouth
    // is scaled by where the voice sits between the recent trough and peak, so it closes in
    // the dip before each mora even when a loud voice never gets quiet.
    speechMouth(dt) {
      if (this.kana || this.lipHold) {
        let m;
        if (this.lipHold) m = VOWELS[this.lipHold];
        else {
          this.kana.t += dt;
          if (this.kana.loop) this.kana.t %= this.kana.duration;
          m = sampleMoras(this.kana.moras, this.kana.t);
        }
        if (!m) {
          this.kana = null;
          return this.mouth > 0.01 ? [this.mouth *= 0.6, this.vowelForm] : null;
        }
        const k2 = m.open > this.mouth ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 22);
        this.mouth += (m.open - this.mouth) * k2;
        if (m.form !== null) this.vowelForm = m.form;
        return [this.mouth, this.vowelForm];
      }
      const v = this.speaking ? this.voice : 0;
      const relax = 1 - Math.exp(-dt * 5);
      this.voicePeak = v > this.voicePeak ? v : this.voicePeak + (v - this.voicePeak) * relax;
      this.voiceTrough = v < this.voiceTrough ? v : this.voiceTrough + (v - this.voiceTrough) * relax;
      const peak = Math.max(this.voicePeak, 0.05);
      if (v < peak * 0.6) this.syllableArmed = true;
      else if (this.syllableArmed && v > peak * 0.8 && v > 0.1) {
        this.syllableArmed = false;
        const r = Math.random();
        this.vowel = r < 0.4 ? "a" : r < 0.58 ? "o" : r < 0.74 ? "e" : r < 0.88 ? "i" : "u";
      }
      const range = this.voicePeak - this.voiceTrough;
      const rise = range < peak * 0.3 ? 1 : Math.max(0, (v - this.voiceTrough) / range);
      const shape = VOWELS[this.vowel ?? "a"];
      const level = Math.min(1, Math.pow(v, 0.7) * 1.15) * Math.pow(rise, 0.3);
      const target = this.speaking ? Math.min(0.95, level) * (0.45 + 0.55 * shape.open / 0.9) : 0;
      const k = target > this.mouth ? 1 - Math.exp(-dt * 40) : 1 - Math.exp(-dt * 32);
      this.mouth += (target - this.mouth) * k;
      if (this.speaking) this.vowelForm = shape.form;
      return this.speaking || this.mouth > 0.01 ? [this.mouth, this.vowelForm] : null;
    }
    // Breathing: inhale ~40% of the cycle, a slower exhale, a short pause at the bottom,
    // and a period that drifts between ~3.2 and 4.6 s so it never looks metronomic.
    breathValue(dt) {
      this.breathPhase = (this.breathPhase ?? 0) + dt / (this.breathPeriod ?? 3.8);
      if (this.breathPhase >= 1) {
        this.breathPhase -= 1;
        this.breathPeriod = 3.2 + Math.random() * 1.4;
      }
      const x = this.breathPhase;
      if (x < 0.4) return sstep(0, 0.4, x);
      if (x < 0.88) return 1 - sstep(0.4, 0.88, x);
      return 0;
    }
    // pick one at random, never the one that just played
    playRandom(ids) {
      const pool = ids.filter((k) => k !== this.lastAuto);
      this.playMotion(pool[Math.floor(Math.random() * pool.length)]);
    }
    playMotion(id) {
      this.lastAuto = id;
      this.play = { id, t: 0 };
      this.onMotion?.(id);
    }
    blinkValue(dt) {
      const b = this.blink;
      b.t += dt;
      if (b.t < b.start) return 1;
      const x = (b.t - b.start) / 0.17;
      if (x >= 1) {
        if (b.double) {
          b.double = false;
          b.start = b.t + 0.07;
        } else {
          b.start = b.t + 1.8 + Math.random() * 4.2;
          b.double = Math.random() < 0.18;
        }
        return 1;
      }
      return x < 0.45 ? 1 - x / 0.45 : (x - 0.45) / 0.55;
    }
    update(dt) {
      this.t += dt;
      const t = this.t;
      const T = {};
      for (const p of PARAMS) T[p.id] = p.def;
      if (this.mode === "manual") {
        Object.assign(T, this.manual);
      } else if (this.mode === "auto") {
        T.angleX = fbm(t * 0.18, 1) * 10 + this.gaze.x * 11;
        T.angleY = fbm(t * 0.15, 2) * 6 - 1 + this.gaze.y * 7;
        T.angleZ = fbm(t * 0.12, 3) * 10;
        T.bodyAngleX = fbm(t * 0.1, 4) * 5;
        T.bodyAngleZ = fbm(t * 0.09, 5) * 4;
        T.armAngle = fbm(t * 0.14, 6) * 5;
        T.handAngle = fbm(t * 0.21, 7) * 5;
        if (t > this.gaze.next) {
          const r = Math.random();
          this.gaze.x = r < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.8;
          this.gaze.y = r < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.5;
          this.gaze.next = t + 0.8 + Math.random() * 2.5;
        }
        T.gazeX = this.gaze.x + T.angleX / 60;
        T.gazeY = this.gaze.y + T.angleY / 60;
        if (t > this.tap.next) {
          this.tap.until = t + 1.1;
          this.tap.next = t + 5 + Math.random() * 6;
        }
        if (this.speaking) {
          this.nextIdle = Math.max(this.nextIdle, t + 2.5);
          this.nextAuto = Math.max(this.nextAuto, t + 6);
          const g = this.talkGain;
          this.talkNod = (this.talkNod ?? 0) + (this.voice * 7 * g - (this.talkNod ?? 0)) * Math.min(1, dt * 6);
          T.angleY -= this.talkNod;
          T.angleX += fbm(t * 0.6, 11) * 5 * g;
          T.angleZ += fbm(t * 0.5, 12) * 4 * g;
        }
        if (!this.speaking && t > this.emotionUntil) {
          this.expr = "normal";
          this.emotionUntil = Infinity;
        }
        if (this.speaking) {
        } else if (!this.play && this.autoMotion && t > this.nextAuto) {
          this.playRandom(Object.keys(MOTIONS).filter((k2) => k2 !== "surprise"));
          this.nextAuto = t + 15 + Math.random() * 10;
          this.nextIdle = Math.max(this.nextIdle, t + 5);
        } else if (!this.play && this.autoIdle && t > this.nextIdle) {
          this.playRandom(Object.keys(IDLE_MOTIONS));
          this.nextIdle = t + 5 + Math.random() * 5;
        }
      } else if (this.mode === "mouse" && this.pointer) {
        const dx = (this.pointer[0] - this.faceCenter[0]) / 500, dy = (this.pointer[1] - this.faceCenter[1]) / 500;
        T.angleX = clamp(dx * 30, -30, 30);
        T.angleY = clamp(-dy * 30, -30, 30);
        T.angleZ = clamp(-dx * dy * 25, -12, 12);
        T.bodyAngleX = clamp(dx * 10, -10, 10) * 0.6;
        T.gazeX = clamp(dx * 1.4, -1, 1);
        T.gazeY = clamp(-dy * 1.4, -1, 1);
        T.handAngle = clamp(dx * 4, -5, 5);
      }
      if (this.mode !== "manual") {
        T.breath = this.breathValue(dt);
        if (t < this.tap.until) T.fingerTap = Math.max(0, Math.sin((this.tap.until - t) * Math.PI * 3.6)) ** 2;
      }
      let M = null, mw = 0;
      if (this.play) {
        const def = ALL_MOTIONS[this.play.id];
        this.play.t += dt;
        if (this.play.t >= def.dur) {
          this.play = null;
          this.onMotion?.(null);
        } else {
          M = {};
          for (const [id, keys2] of Object.entries(def.tracks))
            M[id] = sampleTrack(keys2, this.play.t) * (def.idle && IDLE_SCALED.test(id) ? IDLE_GAIN.amp : 1);
          mw = sstep(0, 0.15, this.play.t) * (1 - sstep(def.dur - 0.25, def.dur, this.play.t));
          for (const [id, v] of Object.entries(M)) {
            if (ADDITIVE.has(id)) T[id] += v;
            else if (id === "breath") T[id] += (v - T[id]) * mw;
            else if (!FACE_TRACKS.has(id)) T[id] = Math.max(T[id], Math.max(0, v));
          }
        }
      }
      if (this.mode !== "manual") T.angleY += T.breath * 1.6;
      const E = EXPRESSIONS[this.expr].p;
      const keys = ["eyeOpen", "eyeOpenL", "eyeSmileL", "eyeSmile", "mouthOpen", "mouthForm", "blush", "browY", "browAngle", "gx", "gy"];
      const target = {
        eyeOpen: E.eyeOpen ?? 1,
        eyeOpenL: E.eyeOpenL ?? E.eyeOpen ?? 1,
        eyeSmileL: E.eyeSmileL ?? E.eyeSmile ?? 0,
        eyeSmile: E.eyeSmile ?? 0,
        mouthOpen: E.mouthOpen ?? 0,
        mouthForm: E.mouthForm ?? 0,
        blush: E.blush ?? 0,
        browY: E.browY ?? 0,
        browAngle: E.browAngle ?? 0,
        gx: E.glance?.[0] ?? 0,
        gy: E.glance?.[1] ?? 0
      };
      const k = 1 - Math.exp(-dt * 9);
      for (const key of keys) {
        if (this.exprMix[key] === void 0) this.exprMix[key] = target[key];
        this.exprMix[key] += (target[key] - this.exprMix[key]) * k;
      }
      const X = this.exprMix;
      const out = {};
      for (const p of PARAMS) {
        const id = p.id;
        if (this.mode === "manual" && !M) {
          out[id] = T[id];
          this.cur[id] = T[id];
          this.vel[id] = 0;
          continue;
        }
        let [stiff, zeta] = SPRINGS[id] ?? [120, 0.95];
        if (M && /^angle|^body/.test(id)) {
          if (ALL_MOTIONS[this.play?.id ?? ""]?.idle) {
            stiff *= IDLE_GAIN.stiff;
            zeta = 0.8;
          } else if (/^angle/.test(id)) {
            stiff *= 4.5;
            zeta = 0.75;
          }
        }
        const damp = 2 * Math.sqrt(stiff) * zeta;
        this.vel[id] += (stiff * (T[id] - this.cur[id]) - damp * this.vel[id]) * dt;
        this.cur[id] += this.vel[id] * dt;
        out[id] = this.cur[id];
      }
      let blink = 1;
      if (this.mode !== "manual") {
        blink = this.blinkValue(dt);
        out.eyeROpen = X.eyeOpen * blink;
        out.eyeLOpen = X.eyeOpenL * blink;
        out.eyeSmile = X.eyeSmile;
        out.eyeSmileL = X.eyeSmileL;
        out.mouthOpen = X.mouthOpen;
        out.mouthForm = X.mouthForm;
        out.blush = X.blush;
        out.browY = X.browY + (out.angleY > 0 ? out.angleY / 60 : 0) - (1 - blink) * 0.18;
        out.browAngle = X.browAngle;
        out.gazeX = clamp(out.gazeX + X.gx, -1, 1);
        out.gazeY = clamp(out.gazeY + X.gy, -1, 1);
      } else {
        out.eyeSmileL = out.eyeSmile;
      }
      if (M) {
        const mix = (key, v) => {
          out[key] += (v - out[key]) * mw;
        };
        const clampEye = (v) => Math.min(1.3, Math.max(0, v));
        if ("eyeOpen" in M) {
          mix("eyeROpen", clampEye(M.eyeOpen) * blink);
          if (!("eyeOpenL" in M)) mix("eyeLOpen", clampEye(M.eyeOpen) * blink);
        }
        if ("eyeOpenL" in M) mix("eyeLOpen", clampEye(M.eyeOpenL) * blink);
        if ("eyeSmile" in M) {
          mix("eyeSmile", M.eyeSmile);
          if (!("eyeSmileL" in M)) mix("eyeSmileL", M.eyeSmile);
        }
        if ("eyeSmileL" in M) mix("eyeSmileL", M.eyeSmileL);
        for (const id of ["mouthOpen", "mouthForm", "blush", "browY", "browAngle"])
          if (id in M) mix(id, id === "mouthOpen" || id === "blush" ? Math.max(0, M[id]) : M[id]);
      }
      const sm = this.speechMouth(dt);
      if (sm) {
        this.lipOpen = sm[0];
        this.lipForm = sm[1];
      } else if (this.lipOpen !== null && !this.speaking && !this.kana) this.lipOpen = null;
      if (this.lipOpen !== null) {
        out.mouthOpen = Math.max(out.mouthOpen * 0.3, this.lipOpen);
        out.mouthForm = clamp(this.lipForm, -1, 1);
      }
      this.P = out;
      return out;
    }
  };

  // vendor/mesh-avatar-studio/engine/createMeshAvatar.js
  var EYE_PARTS = ["ball", "low", "crease", "lash"];
  var imageCache = /* @__PURE__ */ new Map();
  var jsonCache = /* @__PURE__ */ new Map();
  async function loadJson(src) {
    if (!jsonCache.has(src)) jsonCache.set(src, fetch(src).then((r) => {
      if (!r.ok) throw new Error(`failed to load ${src}`);
      return r.json();
    }));
    return jsonCache.get(src);
  }
  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const result = new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`failed to load ${src}`));
      i.src = src;
    });
    imageCache.set(src, result);
    return result;
  }
  function channelOf(img, ch) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const a = new Uint8Array(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + ch];
    return a;
  }
  var alphaOf = (img) => channelOf(img, 3);
  function deformTassel(ch, mesh) {
    const [px, py] = ch.t.pivot, d = ch.dir, P = ch.pts;
    const sstep2 = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const c1 = Math.cos(ch.phi[0]), s1 = Math.sin(ch.phi[0]);
    const c2 = Math.cos(ch.phi[1]), s2 = Math.sin(ch.phi[1]);
    const r = mesh.rest, o = mesh.pos;
    for (let i = 0; i < r.length; i += 2) {
      const vx = r[i] - px, vy = r[i + 1] - py;
      const along = vx * d[0] + vy * d[1];
      const ax = P[0][0] + vx * c1 - vy * s1, ay = P[0][1] + vx * s1 + vy * c1;
      const ux = vx - d[0] * ch.L1, uy = vy - d[1] * ch.L1;
      const bx = P[1][0] + ux * c2 - uy * s2, by = P[1][1] + ux * s2 + uy * c2;
      const w = sstep2(ch.L1 * 0.55, ch.L1 * 1.35, along);
      o[i] = ax + (bx - ax) * w;
      o[i + 1] = ay + (by - ay) * w;
    }
  }
  async function createMeshAvatarImpl(canvas, options) {
    const rig = options.rig;
    const engine = createRig(rig);
    const {
      IMG,
      EYES,
      baseWeights,
      deformBase,
      eyePartY,
      eyePartAlpha,
      handWeights,
      handFrame,
      deformHand,
      TASSELS
    } = engine;
    const { Renderer, buildGrid } = createRenderer(engine, rig);
    const { Physics } = createPhysics(engine, rig);
    const { createSprites } = createSpriteModule(engine, rig);
    const base = (options.assetsBase ?? "/miko-qipao/built/").replace(/\/?$/, "/");
    const asset = (name, build) => {
      if (options.assets) {
        if (!options.assets[name]) throw new Error(`Missing project asset: ${name}`);
        return options.assets[name];
      }
      return `${base}${name}${build === void 0 ? "" : `?b=${build}`}`;
    };
    const meta = await loadJson(asset("layers.json"));
    const names = ["base", ...rig.hand ? ["hand"] : [], ...TASSELS.map((t) => t.name), ...[0, 1].flatMap((i) => EYE_PARTS.map((p) => `eye${i}_${p}`)), "hairmask"];
    const imgs = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadImage(asset(`${n}.png`, meta.build))])));
    const hairMask = channelOf(imgs.hairmask, 0);
    const hairAt = (x, y) => hairMask[Math.min(IMG.h - 1, Math.max(0, Math.round(y))) * IMG.w + Math.min(IMG.w - 1, Math.max(0, Math.round(x)))] / 255;
    const R = new Renderer(canvas, { padTop: options.padTop ?? rig.view.padTop, padSide: options.padSide ?? rig.view.padSide, fit: options.fit });
    const rects = { base: [0, 0, IMG.w, IMG.h], ...meta.layers };
    const baseMesh = buildGrid(rects.base, rig.mesh.baseCell, alphaOf(imgs.base), imgs.base.width, rig.mesh.fine);
    const baseW = [];
    for (let i = 0; i < baseMesh.rest.length / 2; i++) {
      const x = baseMesh.rest[i * 2], y = baseMesh.rest[i * 2 + 1];
      baseW.push(baseWeights(x, y, hairAt(x, y)));
    }
    R.addLayer("base", imgs.base, baseMesh, { face: true });
    const eyeParts = [];
    EYES.forEach((e, i) => {
      for (const part of EYE_PARTS) {
        const n = `eye${i}_${part}`;
        const mesh = buildGrid(rects[n], part === "ball" ? rig.mesh.eyeBallCell : rig.mesh.eyeCell, alphaOf(imgs[n]), imgs[n].width);
        const W = [];
        for (let k = 0; k < mesh.rest.length / 2; k++) W.push(baseWeights(mesh.rest[k * 2], mesh.rest[k * 2 + 1], 0));
        const layer = R.addLayer(n, imgs[n], mesh, { eyeBall: part === "ball" ? i : void 0 });
        eyeParts.push({ e, eye: i, part, mesh, W, layer });
      }
    });
    let sprites = null;
    try {
      {
        const sheet = await loadJson(asset("sprites/sprites.json"));
        const simgs = Object.fromEntries(await Promise.all(Object.keys(sheet.layers).map(async (n) => [n, await loadImage(asset(`sprites/${n}.png`, sheet.build))])));
        sprites = createSprites(R, sheet, simgs, buildGrid, alphaOf);
      }
    } catch (err) {
      console.warn("eye / mouth sprites not loaded:", err);
    }
    const tassels = TASSELS.map((t) => {
      const mesh = buildGrid(rects[t.name], rig.mesh.tasselCell, alphaOf(imgs[t.name]), imgs[t.name].width);
      return R.addLayer(t.name, imgs[t.name], mesh);
    });
    const handMesh = rig.hand ? buildGrid(rects.hand, rig.mesh.handCell, alphaOf(imgs.hand), imgs.hand.width) : { rest: [], pos: [] };
    const handW = [];
    for (let i = 0; i < handMesh.rest.length / 2; i++) handW.push(handWeights(handMesh.rest[i * 2], handMesh.rest[i * 2 + 1]));
    if (rig.hand) R.addLayer("hand", imgs.hand, handMesh);
    const physics = new Physics();
    const motion = new Motion(rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]);
    const listeners = /* @__PURE__ */ new Set();
    motion.onMotion = (id) => {
      for (const fn of listeners) fn(id);
    };
    let parameters = {}, parameterWeight = 1, lastParameters = {};
    const tmp = [0, 0];
    function updateParameters(dt) {
      const P = { ...motion.update(dt) };
      for (const [key, value] of Object.entries(parameters)) P[key] = parameterWeight === 1 ? value : (P[key] ?? 0) + (value - (P[key] ?? 0)) * parameterWeight;
      if (motion.lipOpen !== null) {
        if (!options.preserveMouthOpen || parameters.mouthOpen === void 0) P.mouthOpen = motion.P.mouthOpen;
        if (!options.preserveMouthForm || parameters.mouthForm === void 0) P.mouthForm = motion.P.mouthForm;
      }
      lastParameters = P;
      return P;
    }
    function tick(dt) {
      const P = updateParameters(dt);
      const phys = physics.step(P, dt);
      const bp = baseMesh.pos, br = baseMesh.rest;
      for (let i = 0; i < baseW.length; i++) {
        deformBase(br[i * 2], br[i * 2 + 1], baseW[i], P, phys, tmp);
        bp[i * 2] = tmp[0];
        bp[i * 2 + 1] = tmp[1];
      }
      const eyeOpenFor = (v) => sprites ? 1 : v;
      for (const ep of eyeParts) {
        const open = eyeOpenFor(ep.eye === 0 ? P.eyeROpen : P.eyeLOpen);
        const smile = ep.eye === 0 ? P.eyeSmile : P.eyeSmileL ?? P.eyeSmile;
        ep.layer.alpha = eyePartAlpha(ep.part, open, smile);
        const r = ep.mesh.rest, o = ep.mesh.pos;
        for (let k = 0; k < ep.W.length; k++) {
          const x = r[k * 2], y = r[k * 2 + 1];
          deformBase(x, eyePartY(ep.e, ep.part, x, y, open, smile), ep.W[k], P, phys, tmp);
          o[k * 2] = tmp[0];
          o[k * 2 + 1] = tmp[1];
        }
      }
      const cover = sprites?.update(P, phys, dt);
      if (cover) {
        for (const ep of eyeParts) if (cover.eyes[ep.eye]) ep.layer.alpha = 0;
      }
      const hp = handMesh.pos, hr = handMesh.rest, HF = handFrame(P);
      for (let i = 0; i < handW.length; i++) {
        deformHand(hr[i * 2], hr[i * 2 + 1], handW[i], P, HF, tmp);
        hp[i * 2] = tmp[0];
        hp[i * 2 + 1] = tmp[1];
      }
      physics.chains.forEach((ch, k) => deformTassel(ch, tassels[k].mesh));
      const ball = 7;
      R.draw({
        angleX: P.angleX,
        angleY: P.angleY,
        angleZ: P.angleZ,
        eyes: [
          eyeOpenFor(P.eyeROpen),
          P.eyeSmile,
          P.gazeX * ball,
          -P.gazeY * ball * 0.6,
          eyeOpenFor(P.eyeLOpen),
          P.eyeSmileL ?? P.eyeSmile,
          P.gazeX * ball * 0.85,
          -P.gazeY * ball * 0.6
        ],
        // with sprites the drawn mouths replace the shader-painted one
        mouthOpen: sprites ? 0 : P.mouthOpen,
        mouthForm: P.mouthForm,
        cheek: P.blush,
        showMesh: false,
        originalAlpha: 0,
        joints: []
      });
    }
    let raf = 0, last = performance.now(), destroyed = false;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1e3);
      last = now;
      tick(dt);
      raf = requestAnimationFrame(frame);
    };
    if (!options.manual) raf = requestAnimationFrame(frame);
    const motionList = [
      ...Object.entries(MOTIONS).map(([id, m]) => ({ id, label: m.label, idle: false })),
      ...Object.entries(IDLE_MOTIONS).map(([id, m]) => ({ id, label: m.label, idle: true }))
    ];
    return {
      motions: motionList,
      setParameters(values, weight = 1) {
        parameters = { ...values };
        parameterWeight = Math.min(1, Math.max(0, Number(weight) || 0));
      },
      getParameters() {
        return { ...lastParameters };
      },
      /** 0..1 loudness of the voice being played (e.g. normalised RMS). */
      setVoiceLevel(v) {
        motion.setVoiceLevel(v);
      },
      /** true while TTS audio is playing: idle motions pause and the head nods along. */
      setSpeaking(on) {
        motion.setSpeaking(on);
      },
      /** AITuber OnAir emotion tag: happy / sad / angry / surprised / relaxed / neutral (or null). */
      setEmotion(tag, opts) {
        motion.setEmotion(tag, opts);
      },
      /** How much the head moves with the voice while speaking (1 = default, calmer below). */
      setTalkGain(g) {
        motion.talkGain = Math.max(0, Number(g) || 0);
      },
      /** Play a motion or idle motion by id (see `motions`). */
      play(id) {
        if (motion.hasMotion(id)) motion.playMotion(id);
      },
      /** Move the mouth through the vowels of kana text (no audio; for previews). */
      speakKana(text, options2) {
        motion.speakKana(String(text ?? ""), options2);
      },
      holdMouth(vowel) {
        motion.holdMouth(vowel);
      },
      stopLipSync() {
        motion.stopLipSync();
      },
      getLipSyncState() {
        return motion.getLipSyncState();
      },
      setAutoIdle(on) {
        motion.autoIdle = !!on;
      },
      setLighting(value) {
        R.setLighting(value);
      },
      getLightingStats() {
        return { ...R.lightingStats };
      },
      setAutoMotion(on) {
        motion.autoMotion = !!on;
      },
      /** Hair / tassel sway multiplier (1 = default). */
      setSwayGain(g) {
        physics.gain = g;
      },
      /** Called with the motion id when a motion starts and with null when it ends. */
      onMotion(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      /** Advance the simulation by `sec` and draw (for tests / hidden tabs). */
      advance(sec, fps = 60) {
        if (destroyed) return;
        if (sec === 0) tick(0);
        else for (let i = 0; i < Math.round(sec * fps); i++) tick(1 / fps);
      },
      /** Update motion and lip sync without drawing a hidden preview. */
      advanceParameters(sec) {
        if (!destroyed) updateParameters(sec);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cancelAnimationFrame(raf);
        listeners.clear();
        R.destroy();
        if (options.assetsBase) {
          for (const cache2 of [imageCache, jsonCache]) for (const key of cache2.keys()) if (key.startsWith(options.assetsBase)) cache2.delete(key);
        }
      }
    };
  }

  // vendor/mesh-avatar-studio/engine/index.ts
  async function createMeshAvatar(canvas, options) {
    return createMeshAvatarImpl(canvas, { ...options, rig: parseRig(options.rig) });
  }
  return __toCommonJS(entry_exports);
})();
