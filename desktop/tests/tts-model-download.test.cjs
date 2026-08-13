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
  sha256File,
} = require("../lib/tts-model-download.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "charadock-tts-model-test-"));
}

function streamResponse(bytes) {
  return new Response(bytes, { status: 200 });
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function incrementalFixtureModel() {
  const shared = Buffer.from("shared model payload");
  const changed = Buffer.from("new duration payload");
  return {
    model: {
      id: "fixture-webgpu",
      label: "Fixture WebGPU",
      description: "Incremental download fixture",
      directoryName: "fixture-v2",
      obsoleteDirectoryNames: ["fixture-v1"],
      downloadBytes: shared.length + changed.length,
      sourceUrl: "https://example.invalid/source",
      licenseUrl: "https://example.invalid/license",
      files: [
        {
          name: "shared.onnx",
          relativePath: "models/shared.onnx",
          url: "https://example.invalid/shared.onnx",
          bytes: shared.length,
          sha256: sha256(shared),
        },
        {
          name: "duration.onnx",
          relativePath: "models/duration.onnx",
          url: "https://example.invalid/duration.onnx",
          bytes: changed.length,
          sha256: sha256(changed),
        },
      ],
    },
    shared,
    changed,
  };
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

test("sha256File hashes large files without monopolizing the event loop", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.alloc(10 * 1024 * 1024, 0x5a);
  const filePath = path.join(directory, "large-model.onnx");
  fs.writeFileSync(filePath, bytes);
  let immediateRan = false;
  setImmediate(() => { immediateRan = true; });

  const result = await sha256File(filePath, { expectedBytes: bytes.length });

  assert.equal(result.sha256, sha256(bytes));
  assert.equal(result.bytes, bytes.length);
  assert.equal(immediateRan, true);
});

test("incremental model update hardlinks verified files and downloads only changed files", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { model, shared, changed } = incrementalFixtureModel();
  const oldDirectory = path.join(directory, "fixture-v1");
  const oldShared = path.join(oldDirectory, "models", "shared.onnx");
  fs.mkdirSync(path.dirname(oldShared), { recursive: true });
  fs.writeFileSync(oldShared, shared);
  fs.writeFileSync(path.join(oldDirectory, "models", "duration.onnx"), Buffer.from("old duration payload"));
  const oldSharedInode = fs.statSync(oldShared).ino;
  const fetched = [];
  const progressPhases = [];
  const models = new EmbeddedTtsModels(directory, {
    models: { [model.id]: model },
    fetchImpl: async (url) => {
      fetched.push(url);
      if (url === model.files[1].url) return streamResponse(changed);
      if (url === model.files[0].url) return streamResponse(shared);
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(models.status(model.id).upgradeAvailable, true);
  assert.equal(models.installedPaths(model.id).modelDirectory, oldDirectory);
  const status = await models.download(model.id, (value) => progressPhases.push(value.progress?.phase));

  const destination = path.join(directory, model.directoryName);
  assert.deepEqual(fetched, [model.files[1].url]);
  assert.deepEqual(fs.readFileSync(path.join(destination, "models", "shared.onnx")), shared);
  assert.deepEqual(fs.readFileSync(path.join(destination, "models", "duration.onnx")), changed);
  assert.equal(fs.statSync(path.join(destination, "models", "shared.onnx")).ino, oldSharedInode);
  assert.ok(progressPhases.includes("verifying"));
  assert.ok(progressPhases.includes("reusing"));
  assert.equal(fs.existsSync(oldDirectory), false);
  assert.equal(status.installed, true);
  assert.equal(status.upgradeAvailable, false);
});

test("failed incremental update keeps the old model and removes temporary output", async (t) => {
  const directory = temporaryDirectory();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { model, shared } = incrementalFixtureModel();
  const oldDirectory = path.join(directory, "fixture-v1");
  const oldShared = path.join(oldDirectory, "models", "shared.onnx");
  fs.mkdirSync(path.dirname(oldShared), { recursive: true });
  fs.writeFileSync(oldShared, shared);
  fs.writeFileSync(path.join(oldDirectory, "models", "duration.onnx"), Buffer.from("old duration payload"));
  const models = new EmbeddedTtsModels(directory, {
    models: { [model.id]: model },
    fetchImpl: async () => streamResponse(Buffer.from("corrupt")),
  });

  await assert.rejects(models.download(model.id), /サイズ|SHA-256/);

  assert.equal(fs.existsSync(oldDirectory), true);
  assert.deepEqual(fs.readFileSync(oldShared), shared);
  assert.equal(fs.existsSync(path.join(directory, model.directoryName)), false);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.startsWith(".download-")), []);
  assert.equal(models.status(model.id).upgradeAvailable, true);

  models.remove(model.id);
  assert.equal(fs.existsSync(oldDirectory), false);
  assert.equal(models.status(model.id).upgradeAvailable, false);
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

test("Irodori v4.1 uses the improved duration predictor and installs the runtime layout", () => {
  const model = TTS_MODELS["irodori-webgpu"];
  assert.equal(model.downloadBytes, 1_771_102_085);
  assert.equal(model.incrementalDownloadBytes, 43_861_055);
  assert.equal(model.files.length, 19);
  assert.deepEqual(model.obsoleteDirectoryNames, [
    "irodori-tts-v4-small-webgpu-fp16",
    "irodori-tts-v4-small-webgpu-fp16-r1",
    "irodori-tts-v4-small-webgpu-fp16-r2",
  ]);
  assert.match(model.files.find((file) => file.relativePath === "models/duration.onnx").url, /v4\.1-small-webgpu-duration-r1\/fp16-duration\.onnx$/);
  assert.match(model.files.find((file) => file.relativePath === "models/model-config.json").url, /v4\.1-small-webgpu-duration-r1\/fp16-model-config\.json$/);
  assert.match(model.files.find((file) => file.relativePath === "models/dit_v4.onnx").url, /v4-small-e4aaac4-webgpu-fp16-r2\/dit_v4\.onnx$/);
  assert.ok(model.files.some((file) => file.relativePath === "models/dit_v4.onnx.data"));
  assert.ok(model.files.some((file) => file.relativePath === "tokenizer/irodori_v4/tokenizer.json"));
});

test("Irodori v4.1 INT4 uses the improved quantized duration predictor", () => {
  const model = TTS_MODELS["irodori-webgpu-int4"];
  assert.equal(model.downloadBytes, 853_297_043);
  assert.equal(model.incrementalDownloadBytes, 43_861_081);
  assert.equal(model.files.length, 19);
  assert.deepEqual(model.obsoleteDirectoryNames, ["irodori-tts-v4-small-quantized-webgpu-int4-r1"]);
  assert.match(model.files.find((file) => file.relativePath === "models/duration.onnx").url, /v4\.1-small-webgpu-duration-r1\/int4-duration\.onnx$/);
  assert.match(model.files.find((file) => file.relativePath === "models/dit_v4.onnx").url, /v4-small-quantized-4a5a4d6-webgpu-int4-r1\/dit_v4\.onnx$/);
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
  const staleInt4 = path.join(directory, ".download-irodori-webgpu-int4-5678");
  const unrelated = path.join(directory, ".download-user-backup-1234");
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(staleInt4, { recursive: true });
  fs.mkdirSync(unrelated, { recursive: true });
  new EmbeddedTtsModels(directory, { platform: "win32" });
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(staleInt4), false);
  assert.equal(fs.existsSync(unrelated), true);
});
