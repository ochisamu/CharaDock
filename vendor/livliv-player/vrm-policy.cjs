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

// vendor/livliv-player/charadock-vrm-expression-policy.ts
var charadock_vrm_expression_policy_exports = {};
__export(charadock_vrm_expression_policy_exports, {
  VrmExpressionPolicy: () => VrmExpressionPolicy
});
module.exports = __toCommonJS(charadock_vrm_expression_policy_exports);
var FEELINGS = ["happy", "angry", "sad", "relaxed", "surprised"];
var RESERVED = /* @__PURE__ */ new Set(["neutral", "aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight", "lookUp", "lookDown", "lookLeft", "lookRight"]);
var VrmExpressionPolicy = class {
  constructor(manager) {
    this.manager = manager;
    this.records = new Map((manager?.expressions || []).map((object) => [object.expressionName, { object, mouth: object.overrideMouth || "none", blink: object.overrideBlink || "none" }]));
    for (const [name, r] of this.records) if (!RESERVED.has(name)) {
      r.object.overrideMouth = "none";
      r.object.overrideBlink = "none";
    }
  }
  manager;
  records;
  hold = 0;
  apply(params, expression, dt) {
    this.hold = params.mouthOpen > 0.015 ? 0.18 : Math.max(0, this.hold - dt);
    const speaking = this.hold > 0, open = Math.min(params.eyeLOpen, params.eyeROpen), weights = /* @__PURE__ */ new Map();
    const put = (name, value) => {
      if (this.records.has(name)) weights.set(name, Math.max(weights.get(name) || 0, Math.max(0, Math.min(1, value))));
    };
    const safe = (name, value) => {
      const r = this.records.get(name);
      if (!r) return;
      put(name, value * (speaking && r.mouth !== "none" ? 0 : 1) * (r.blink !== "none" ? open : 1));
    };
    for (const feeling of FEELINGS) {
      const value = Math.max(expression[feeling] || 0, feeling === "happy" ? (params.smile || 0) * 0.6 : 0);
      if (this.records.has("brow_" + feeling) && this.records.has(feeling + "_eye")) {
        put("brow_" + feeling, value);
        put(feeling + "_eye", value * open);
        if (!speaking) put(feeling + "_mouth", value);
      } else safe(feeling, value);
    }
    for (const [name, value] of Object.entries(expression)) if (!FEELINGS.includes(name) && !RESERVED.has(name)) safe(name, value);
    for (const name of this.records.keys()) if (!RESERVED.has(name)) this.manager.setValue(name, weights.get(name) || 0);
    return { speaking, weights: Object.fromEntries(weights) };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VrmExpressionPolicy
});
