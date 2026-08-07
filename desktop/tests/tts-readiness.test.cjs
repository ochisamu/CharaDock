// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { ttsSetupGuidance } = require("../lib/tts-readiness.cjs");

test("TTS readiness gives an actionable download-or-change message for missing models", () => {
  assert.match(ttsSetupGuidance("supertonic-3", { ready: false }, "ja"), /サンプルをダウンロード.*音声方式を変更/);
  assert.match(ttsSetupGuidance("irodori-webgpu", { modelReady: false, version: "v4-small" }, "en"), /Download model.*another voice method/);
  assert.match(ttsSetupGuidance("irodori-webgpu", { modelReady: false, version: "500m-v3" }, "ja"), /500M-v3.*既存フォルダー/);
  assert.equal(ttsSetupGuidance("kokoro", { ready: true }, "ja"), "");
  assert.match(ttsSetupGuidance("sbv2-jp-extra", { ready: false }, "ja"), /AIVMXモデルを追加/);
});

test("Irodori readiness distinguishes reference audio and WebGPU problems", () => {
  assert.match(ttsSetupGuidance("irodori-webgpu", { modelReady: true, referenceReady: false }, "ja"), /参照音声/);
  assert.match(ttsSetupGuidance("irodori-webgpu", { modelReady: true, referenceReady: true, webgpuAvailable: false }, "en"), /WebGPU/);
});
