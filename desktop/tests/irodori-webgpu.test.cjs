// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { IRODORI_CHUNK_LENGTH, IRODORI_CHUNK_OVERFLOW, IRODORI_FIRST_CHUNK_LENGTH, IRODORI_V4_MIN_STEPS, MODEL_NAMES, V3_MODEL_NAMES, irodoriGenerationSettings, irodoriModelStatus, resolveIrodoriModelDirectory, splitIrodoriText, validateIrodoriModelDirectory } = require("../lib/irodori-webgpu.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-irodori-"));
  const models = path.join(root, "onnx_fp16");
  const tokenizer = path.join(root, "tokenizer", "irodori_v4");
  fs.mkdirSync(models, { recursive: true });
  fs.mkdirSync(tokenizer, { recursive: true });
  for (const name of MODEL_NAMES) {
    fs.writeFileSync(path.join(models, `${name}.onnx`), name);
    fs.writeFileSync(path.join(models, `${name}.onnx.data`), name);
  }
  fs.writeFileSync(path.join(tokenizer, "tokenizer.json"), "{}");
  fs.writeFileSync(path.join(tokenizer, "tokenizer_config.json"), "{}");
  return root;
}

function int4Fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-irodori-int4-"));
  const models = path.join(root, "onnx_int4_webgpu_official");
  const tokenizer = path.join(root, "tokenizer", "irodori_v4");
  fs.mkdirSync(models, { recursive: true });
  fs.mkdirSync(tokenizer, { recursive: true });
  for (const name of MODEL_NAMES) {
    fs.writeFileSync(path.join(models, `${name}.onnx`), name);
    fs.writeFileSync(path.join(models, `${name}.onnx.data`), name);
  }
  fs.writeFileSync(path.join(tokenizer, "tokenizer.json"), "{}");
  fs.writeFileSync(path.join(tokenizer, "tokenizer_config.json"), "{}");
  return root;
}

function v3Fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-irodori-v3-"));
  const models = path.join(root, "onnx_fp16");
  const tokenizer = path.join(root, "tokenizer", "llmjp_tok");
  fs.mkdirSync(models, { recursive: true });
  fs.mkdirSync(tokenizer, { recursive: true });
  for (const name of V3_MODEL_NAMES) {
    fs.writeFileSync(path.join(models, `${name}.onnx`), name);
    fs.writeFileSync(path.join(models, `${name}.onnx.data`), name);
  }
  fs.writeFileSync(path.join(tokenizer, "tokenizer.json"), "{}");
  fs.writeFileSync(path.join(tokenizer, "tokenizer_config.json"), "{}");
  return root;
}

test("Irodori recognizes the v4 Small FP16 artifact layout", () => {
  const root = fixture();
  const resolved = resolveIrodoriModelDirectory(root);
  assert.equal(resolved.models, path.join(root, "onnx_fp16"));
  assert.equal(validateIrodoriModelDirectory(root), root);
  assert.equal(irodoriModelStatus(root).modelReady, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Irodori recognizes the v4 Small WebGPU INT4 artifact layout", () => {
  const root = int4Fixture();
  const resolved = resolveIrodoriModelDirectory(root);
  assert.equal(resolved.models, path.join(root, "onnx_int4_webgpu_official"));
  assert.equal(validateIrodoriModelDirectory(root), root);
  assert.equal(irodoriModelStatus(root, "", true, { mode: "design" }).ready, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Irodori identifies original V4 and V4.1 model metadata", () => {
  const root = fixture();
  const configPath = path.join(root, "onnx_fp16", "model-config.json");
  fs.writeFileSync(configPath, JSON.stringify({ repo: "Aratako/Irodori-TTS-v4-Small" }));
  assert.equal(irodoriModelStatus(root).modelOutdated, true);
  assert.equal(irodoriModelStatus(root).modelRelease, "v4");
  fs.writeFileSync(configPath, JSON.stringify({ repo: "Aratako/Irodori-TTS-v4.1-Small" }));
  assert.equal(irodoriModelStatus(root).modelOutdated, false);
  assert.equal(irodoriModelStatus(root).modelRelease, "v4.1");
  fs.rmSync(root, { recursive: true, force: true });
});

test("Irodori v4 reference mode requires a reference WAV", () => {
  const root = fixture();
  const reference = path.join(root, "voice.wav");
  assert.equal(irodoriModelStatus(root, reference).ready, false);
  fs.writeFileSync(reference, "RIFF");
  assert.equal(irodoriModelStatus(root, reference).ready, true);
  assert.equal(irodoriModelStatus(root, "", true, { mode: "design" }).ready, true);
  fs.rmSync(path.join(root, "tokenizer", "irodori_v4", "tokenizer.json"));
  assert.equal(irodoriModelStatus(root, reference).modelReady, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Irodori recognizes the legacy 500M-v3 WebGPU layout without confusing it with v4", () => {
  const root = v3Fixture();
  const reference = path.join(root, "voice.wav");
  fs.writeFileSync(reference, "RIFF");
  const resolved = resolveIrodoriModelDirectory(root, "500m-v3");
  assert.equal(resolved.version, "500m-v3");
  assert.equal(resolved.models, path.join(root, "onnx_fp16"));
  assert.equal(resolved.tokenizer, path.join(root, "tokenizer", "llmjp_tok"));
  assert.equal(validateIrodoriModelDirectory(root, "500m-v3"), root);
  assert.equal(irodoriModelStatus(root, reference, true, { version: "500m-v3", mode: "design" }).ready, true);
  assert.equal(irodoriModelStatus(root, "", true, { version: "500m-v3", mode: "design" }).referenceRequired, true);
  assert.equal(irodoriModelStatus(root, reference, true, { version: "v4-small" }).modelReady, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("Irodori splits long Japanese text at punctuation into short inference chunks", () => {
  const chunks = splitIrodoriText("最初の文章です。次の文章は少し長いので、自然な読点でも区切れるようにします。".repeat(8));
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= IRODORI_CHUNK_LENGTH + IRODORI_CHUNK_OVERFLOW));
  assert.match(chunks[0], /。$/);
});

test("Irodori keeps short sentences in separate inference chunks", () => {
  assert.deepEqual(splitIrodoriText("今日は晴れです。明日は雨です！でも出かけます？"), [
    "今日は晴れです。",
    "明日は雨です！",
    "でも出かけます？",
  ]);
});

test("Irodori v4 uses the validated Linear profile for FP16 and INT4", () => {
  assert.equal(IRODORI_V4_MIN_STEPS, 16);
  for (const precision of ["fp16", "int4"]) {
    assert.deepEqual(irodoriGenerationSettings("v4-small", {
      precision,
      numSteps: 8,
      tScheduleMode: "sway",
      cfgExecution: "batched",
    }), {
      numSteps: 16,
      tScheduleMode: "linear",
      cfgExecution: "sequential",
    });
  }
  assert.deepEqual(irodoriGenerationSettings("v4-small", { numSteps: 24, tScheduleMode: "sway" }), {
    numSteps: 24,
    tScheduleMode: "linear",
    cfgExecution: "sequential",
  });
});

test("Irodori 500M-v3 keeps the selectable accelerated profile", () => {
  assert.deepEqual(irodoriGenerationSettings("500m-v3", { numSteps: 8, tScheduleMode: "sway" }), {
    numSteps: 8,
    tScheduleMode: "sway",
    cfgExecution: "sequential",
  });
  assert.equal(irodoriGenerationSettings("500m-v3", { cfgExecution: "batched" }).cfgExecution, "batched");
});

test("Irodori uses a 40-character natural-boundary ceiling without losing text", () => {
  const chunks = splitIrodoriText("これは最初の音声を早く再生するために、意図的に少し長くしている文章です。続きもあります。");
  assert.ok(chunks.length > 1);
  assert.equal(IRODORI_CHUNK_LENGTH, 40);
  assert.equal(IRODORI_CHUNK_OVERFLOW, 4);
  assert.equal(IRODORI_FIRST_CHUNK_LENGTH, 40);
  assert.ok(chunks[0].length <= IRODORI_FIRST_CHUNK_LENGTH + IRODORI_CHUNK_OVERFLOW);
  assert.equal(chunks.join(""), "これは最初の音声を早く再生するために、意図的に少し長くしている文章です。続きもあります。");
});
