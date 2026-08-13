// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { Sbv2ModelLibrary, normalizeManifest } = require("../lib/sbv2-models.cjs");
const { createStderrCollector, isBenignOrtAssignmentWarning } = require("../lib/sbv2-worker-client.cjs");

const manifest = {
  name: "Test Voice",
  modelArchitecture: "Style-Bert-VITS2 (JP-Extra)",
  version: "1.0.0",
  speakers: [{ name: "Speaker", localId: 2, supportedLanguages: ["ja"], styles: [
    { name: "Normal", localId: 3 },
    { name: "Happy", localId: 4 },
  ] }],
};

test("JP-Extra hides ONNX provider assignment diagnostics but keeps real errors", () => {
  assert.equal(isBenignOrtAssignmentWarning("VerifyEachNodeIsAssignedToAnEp Some nodes were not assigned"), true);
  assert.equal(isBenignOrtAssignmentWarning("model file is missing"), false);
});

test("JP-Extra stderr collector joins split provider warnings without hiding later errors", async () => {
  const logged = [];
  const collector = createStderrCollector((value) => logged.push(value), 5);
  collector.push("Some nodes were not assi");
  collector.push("gned to the preferred execution providers");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(logged, []);
  collector.push("model file is missing");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(logged, ["model file is missing"]);
});

test("JP-Extra AIVMX models are copied into app-owned storage and remain selectable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-sbv2-models-"));
  const source = path.join(root, "external.aivmx");
  fs.writeFileSync(source, Buffer.from("model bytes"));
  const library = new Sbv2ModelLibrary(path.join(root, "app-models"));
  const imported = await library.importAivmx(source, manifest, []);
  fs.unlinkSync(source);

  assert.equal(imported.record.architecture, "Style-Bert-VITS2 (JP-Extra)");
  assert.equal(fs.readFileSync(library.modelPath(imported.record), "utf8"), "model bytes");
  assert.equal(library.selectedModel(imported.models, imported.record.id).id, imported.record.id);
  assert.deepEqual(library.publicModels(imported.models, imported.record.id)[0].speakers[0].styles.map((style) => style.localId), [3, 4]);

  assert.deepEqual(library.remove(imported.models, imported.record.id), []);
  assert.equal(fs.existsSync(library.modelDirectory(imported.record.id)), false);
});

test("model import rejects standard SBV2 and accepts JP-Extra only", () => {
  assert.throws(() => normalizeManifest({ ...manifest, modelArchitecture: "Style-Bert-VITS2" }), /JP-Extra/);
  assert.equal(normalizeManifest(manifest).speakers[0].localId, 2);
});
