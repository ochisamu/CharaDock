// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { beatriceHostArguments } = require("../lib/beatrice-host-client.cjs");
const {
  beatriceStatus,
  describeBeatriceModel,
  findBeatriceInstallation,
  findBeatriceModels,
  normalizeBeatriceMode,
  normalizeBeatriceVoiceId,
  parseBeatriceVoices,
  resolveBeatriceHostExecutable,
} = require("../lib/beatrice-v2.cjs");

test("Beatrice installation discovery finds a VST3 bundle, model TOML, and voices", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beatrice-v2-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vst = path.join(root, "beatrice_2.0.0.vst3");
  const model = path.join(root, "models", "beatrice_voice.toml");
  fs.mkdirSync(vst);
  fs.mkdirSync(path.dirname(model));
  fs.writeFileSync(model, `[model]
name = "Test"
description = """
Test model description.
https://example.com/model
"""
[voice.0]
name = "Alice"
description = "Single-line voice description"
[voice.12]
name = "Bob"
description = """
Bob's voice terms.
https://example.com/voice
"""
`);
  const found = findBeatriceInstallation(root);
  assert.equal(found.vstPath, vst);
  assert.equal(found.modelPath, model);
  assert.deepEqual(found.voices, [
    { id: 0, name: "Alice", description: "Single-line voice description" },
    { id: 12, name: "Bob", description: "Bob's voice terms.\nhttps://example.com/voice" },
  ]);
  assert.equal(found.models[0].name, "Test");
  assert.equal(describeBeatriceModel(model).name, "Test");
  assert.equal(describeBeatriceModel(model).description, "Test model description.\nhttps://example.com/model");
  assert.deepEqual(findBeatriceModels(path.dirname(model)).map((item) => item.id), [found.models[0].id]);
  assert.deepEqual(parseBeatriceVoices(model), found.voices);
  const status = beatriceStatus({ hostPath: __filename, vstPath: vst, modelPath: model, voiceId: 12 });
  assert.equal(status.ready, true);
  assert.equal(status.selectedVoice.name, "Bob");
  assert.equal(status.selectedVoice.description, "Bob's voice terms.\nhttps://example.com/voice");
});

test("Beatrice settings are bounded and packaged helper path is deterministic", () => {
  assert.equal(normalizeBeatriceMode("beatrice-v2"), "beatrice-v2");
  assert.equal(normalizeBeatriceMode("rvc"), "none");
  assert.equal(normalizeBeatriceVoiceId(5000), 999);
  assert.equal(resolveBeatriceHostExecutable({ packaged: true, resourcesPath: "C:\\App\\resources", platform: "win32", arch: "x64" }), path.join("C:\\App\\resources", "bin", "charadock-beatrice-host.exe"));
  assert.equal(resolveBeatriceHostExecutable({ packaged: true, resourcesPath: "/Applications/CharaDock.app/Contents/Resources", platform: "darwin", arch: "arm64" }), path.join("/Applications/CharaDock.app/Contents/Resources", "bin", "charadock-beatrice-host"));
  assert.equal(resolveBeatriceHostExecutable({ packaged: false, appPath: "/src/CharaDock", platform: "darwin", arch: "arm64" }), path.join("/src/CharaDock", "native", "bin", "charadock-beatrice-host"));
  assert.equal(resolveBeatriceHostExecutable({ packaged: false, appPath: "/src/CharaDock", platform: "darwin", arch: "x64" }), "");
  assert.equal(resolveBeatriceHostExecutable({ packaged: false, appPath: "/src/CharaDock", platform: "linux", arch: "arm64" }), "");
});

test("Beatrice host receives all per-character tuning parameters", () => {
  const args = beatriceHostArguments({
    vstPath: "C:\\Beatrice\\plugin.vst3", modelPath: "C:\\Beatrice\\voice.toml", voiceId: 12,
    pitchShift: 1.25, formantShift: -.5, inputGain: -3, outputGain: 2,
    intonation: 1.3, pitchCorrection: .4, pitchCorrectionType: 1,
  });
  const value = (key) => args[args.indexOf(key) + 1];
  assert.equal(value("--voice"), "12");
  assert.equal(value("--pitch-shift"), "1.25");
  assert.equal(value("--formant-shift"), "-0.5");
  assert.equal(value("--input-gain"), "-3");
  assert.equal(value("--output-gain"), "2");
  assert.equal(value("--intonation"), "1.3");
  assert.equal(value("--pitch-correction"), "0.4");
  assert.equal(value("--pitch-correction-type"), "1");
});
