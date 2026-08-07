// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EmbeddedTtsModels,
  TTS_MODELS,
  downloadVerifiedFile,
  requiredPaths,
} = require("../lib/tts-model-download.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "charadock-tts-model-test-"));
}

function streamResponse(bytes) {
  return new Response(bytes, { status: 200 });
}

test("TTS model manifests have fixed sizes and SHA-256 values", () => {
  assert.deepEqual(Object.keys(TTS_MODELS), ["piper-plus", "supertonic-3", "kokoro", "irodori-webgpu", "irodori-webgpu-int4", "irodori-500m-v3"]);
  for (const model of Object.values(TTS_MODELS)) {
    const files = [model.runtime, model.archive, ...(model.files || [])].filter(Boolean);
    assert.equal(files.reduce((sum, file) => sum + file.bytes, 0), model.downloadBytes);
    for (const file of files) {
      assert.match(file.url, /^https:\/\//);
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert.ok(file.bytes > 0);
    }
  }
});

test("downloadVerifiedFile streams, hashes, and atomically stores a file", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("verified local voice model");
  const destination = path.join(directory, "nested", "model.onnx");
  let progress = 0;
  await downloadVerifiedFile({
    fetchImpl: async () => streamResponse(bytes),
    file: {
      name: "model.onnx",
      url: "https://example.invalid/model.onnx",
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    },
    destination,
    onChunk: (value) => { progress += value; },
  });
  assert.deepEqual(fs.readFileSync(destination), bytes);
  assert.equal(progress, bytes.length);
  assert.equal(fs.existsSync(`${destination}.download`), false);
});

test("downloadVerifiedFile rejects a hash mismatch", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("bad model");
  const destination = path.join(directory, "model.onnx");
  await assert.rejects(downloadVerifiedFile({
    fetchImpl: async () => streamResponse(bytes),
    file: {
      name: "model.onnx",
      url: "https://example.invalid/model.onnx",
      bytes: bytes.length,
      sha256: "0".repeat(64),
    },
    destination,
  }), /SHA-256/);
  assert.equal(fs.existsSync(destination), false);
});

test("managed model status only reports complete installations", (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const models = new EmbeddedTtsModels(directory, { platform: "win32" });
  for (const model of Object.values(TTS_MODELS)) {
    assert.equal(models.status(model.id).installed, false);
    const destination = path.join(directory, model.directoryName);
    for (const filePath of requiredPaths(model, destination)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "test");
    }
    assert.equal(models.status(model.id).installed, true);
    assert.equal(models.status(model.id).supported, true);
  }
  const piperPaths = models.installedPaths("piper-plus");
  assert.equal(path.basename(piperPaths.executablePath), "piper.exe");
  assert.equal(path.extname(piperPaths.modelPath), ".onnx");
});

test("piper-plus automatic runtime is marked Windows-only", (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const models = new EmbeddedTtsModels(directory, { platform: "linux" });
  assert.equal(models.status("piper-plus").supported, false);
  assert.equal(models.status("supertonic-3").supported, true);
  assert.equal(models.status("kokoro").supported, true);
  assert.equal(models.status("irodori-webgpu").supported, true);
  assert.equal(models.status("irodori-webgpu-int4").supported, true);
});

test("Irodori v4 uses a pinned GitHub release and installs the runtime layout", () => {
  const model = TTS_MODELS["irodori-webgpu"];
  assert.equal(model.downloadBytes, 1_771_099_224);
  assert.equal(model.files.length, 19);
  assert.deepEqual(model.obsoleteDirectoryNames, [
    "irodori-tts-v4-small-webgpu-fp16",
    "irodori-tts-v4-small-webgpu-fp16-r1",
  ]);
  for (const file of model.files) {
    assert.match(file.url, /ochisamu\/irodori-tts-v4-webgpu-models\/releases\/download\/v4-small-e4aaac4-webgpu-fp16-r2\//);
  }
  assert.ok(model.files.some((file) => file.relativePath === "models/dit_v4.onnx.data"));
  assert.ok(model.files.some((file) => file.relativePath === "tokenizer/irodori_v4/tokenizer.json"));
});

test("Irodori v4 INT4 uses the official-quantized WebGPU release", () => {
  const model = TTS_MODELS["irodori-webgpu-int4"];
  assert.equal(model.downloadBytes, 853_295_612);
  assert.equal(model.files.length, 19);
  assert.ok(model.files.every((file) => file.url.includes("ochisamu/irodori-tts-v4-webgpu-models/releases/download/v4-small-quantized-4a5a4d6-webgpu-int4-r1/")));
  assert.ok(model.files.some((file) => file.relativePath === "models/dit_v4.onnx.data" && file.bytes === 253_895_424));
  assert.ok(model.files.some((file) => file.relativePath === "tokenizer/irodori_v4/tokenizer.json"));
});

test("Irodori v4 download removes only obsolete v4 Small installations", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const model = TTS_MODELS["irodori-webgpu"];
  const models = new EmbeddedTtsModels(directory, { platform: "win32" });

  for (const filePath of requiredPaths(model, path.join(directory, model.directoryName))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "current r2");
  }
  for (const obsolete of model.obsoleteDirectoryNames) {
    fs.mkdirSync(path.join(directory, obsolete), { recursive: true });
    fs.writeFileSync(path.join(directory, obsolete, "old-model.bin"), "old v4 Small");
  }
  const former500m = path.join(directory, TTS_MODELS["irodori-500m-v3"].directoryName);
  const userDirectory = path.join(directory, "irodori-user-model");
  fs.mkdirSync(former500m, { recursive: true });
  fs.mkdirSync(userDirectory, { recursive: true });

  const status = await models.download("irodori-webgpu");

  assert.equal(status.installed, true);
  for (const obsolete of model.obsoleteDirectoryNames) {
    assert.equal(fs.existsSync(path.join(directory, obsolete)), false);
  }
  assert.equal(fs.existsSync(former500m), true);
  assert.equal(fs.existsSync(userDirectory), true);
});

test("Irodori 500M-v3 keeps the former pinned Hugging Face WebGPU artifacts", () => {
  const model = TTS_MODELS["irodori-500m-v3"];
  assert.equal(model.downloadBytes, 1_261_860_326);
  assert.equal(model.files.length, 14);
  assert.ok(model.files.every((file) => file.url.includes("noguchis/irodori-tts-onnx/resolve/b75a9bbf2c10e12682d37e91e0efaf6d4e54bd29/")));
  assert.ok(model.files.some((file) => file.relativePath === "onnx_fp16/dit.onnx.data"));
  assert.ok(model.files.some((file) => file.relativePath === "tokenizer/llmjp_tok/tokenizer.json"));
});

test("stale managed downloads are cleaned without touching other folders", (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stale = path.join(directory, ".download-irodori-webgpu-1234");
  const unrelated = path.join(directory, ".download-user-backup-1234");
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(unrelated, { recursive: true });
  new EmbeddedTtsModels(directory, { platform: "win32" });
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(unrelated), true);
});
