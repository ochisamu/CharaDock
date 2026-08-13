// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");
const { splitNaturalSpeechText } = require("./natural-speech-chunks.cjs");

// BudouX still chooses an earlier clause/sentence boundary when available;
// this is only the upper bound for a single inference chunk.
const IRODORI_CHUNK_LENGTH = 40;
const IRODORI_FIRST_CHUNK_LENGTH = 40;
const IRODORI_CHUNK_OVERFLOW = 4;
const IRODORI_MAX_CHUNKS = 24;
const IRODORI_V4_MIN_STEPS = 16;

const V3_MODEL_NAMES = Object.freeze([
  "text_encoder",
  "speaker_encoder",
  "duration",
  "dit",
  "dacvae_decoder",
  "dacvae_encoder",
]);

const V4_MODEL_NAMES = Object.freeze([
  "text_backbone",
  "text_projector",
  "caption_projector",
  "speaker_encoder",
  "duration",
  "dit_v4",
  "dacvae_decoder",
  "dacvae_encoder",
]);

// Kept as the V4 alias for callers introduced with the V4 runtime.
const MODEL_NAMES = V4_MODEL_NAMES;
const IRODORI_VERSIONS = Object.freeze(["500m-v3", "v4-small"]);

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function hasModels(directory, modelNames = V4_MODEL_NAMES) {
  return modelNames.every((name) => isFile(path.join(directory, `${name}.onnx`)) && isFile(path.join(directory, `${name}.onnx.data`)));
}

function irodoriV4ModelRelease(modelsDirectory) {
  const configPath = path.join(String(modelsDirectory || ""), "model-config.json");
  try {
    const stat = fs.statSync(configPath);
    if (!stat.isFile() || stat.size > 128 * 1024) return { modelRelease: "unknown", modelOutdated: false };
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const repository = String(config?.repo || "");
    if (/Irodori-TTS-v4\.1-Small(?:-Quantized)?(?:\/|$)/.test(repository)) {
      return { modelRelease: "v4.1", modelOutdated: false };
    }
    if (/Irodori-TTS-v4-Small(?:-Quantized)?(?:\/|$)/.test(repository)) {
      return { modelRelease: "v4", modelOutdated: true };
    }
  } catch {}
  return { modelRelease: "unknown", modelOutdated: false };
}

function v4CandidateLayouts(root) {
  return [
    { models: root, tokenizer: path.join(root, "tokenizer", "irodori_v4") },
    { models: path.join(root, "models"), tokenizer: path.join(root, "tokenizer", "irodori_v4") },
    { models: path.join(root, "onnx_fp16"), tokenizer: path.join(root, "tokenizer", "irodori_v4") },
    { models: path.join(root, "onnx_int4_webgpu"), tokenizer: path.join(root, "tokenizer", "irodori_v4") },
    { models: path.join(root, "onnx_int4_webgpu_official"), tokenizer: path.join(root, "tokenizer", "irodori_v4") },
    {
      models: path.join(root, "artifacts", "v4-small", "onnx_fp16"),
      tokenizer: path.join(root, "phases", "v4-small-unified", "tokenizer", "irodori_v4"),
    },
    {
      models: path.join(root, "artifacts", "v4-small", "onnx_int4_webgpu"),
      tokenizer: path.join(root, "phases", "v4-small-unified", "tokenizer", "irodori_v4"),
    },
    {
      models: path.join(root, "artifacts", "v4-small", "onnx_int4_webgpu_official"),
      tokenizer: path.join(root, "phases", "v4-small-unified", "tokenizer", "irodori_v4"),
    },
  ];
}

function v3CandidateLayouts(root) {
  return [
    { models: root, tokenizer: path.join(root, "tokenizer", "llmjp_tok") },
    { models: path.join(root, "onnx_fp16"), tokenizer: path.join(root, "tokenizer", "llmjp_tok") },
    { models: path.join(root, "artifacts", "onnx_fp16"), tokenizer: path.join(root, "tokenizer", "llmjp_tok") },
  ];
}

function normalizedVersion(value) {
  return value === "500m-v3" ? "500m-v3" : "v4-small";
}

function irodoriGenerationSettings(version, {
  numSteps = 16,
  tScheduleMode = "linear",
  cfgExecution = "sequential",
} = {}) {
  const normalizedSteps = Math.min(40, Math.max(4, Math.round(Number(numSteps) || 16)));
  if (normalizedVersion(version) === "v4-small") {
    // Keep both V4 precisions on the same known-good recipe as the standalone
    // runtime. The Sway shortcut belongs to the older 500M-v3 integration.
    return {
      numSteps: Math.max(IRODORI_V4_MIN_STEPS, normalizedSteps),
      tScheduleMode: "linear",
      cfgExecution: "sequential",
    };
  }
  return {
    numSteps: normalizedSteps,
    tScheduleMode: tScheduleMode === "linear" ? "linear" : "sway",
    cfgExecution: cfgExecution === "batched" ? "batched" : "sequential",
  };
}

function resolveIrodoriModelDirectory(directory, requestedVersion = "v4-small") {
  const root = path.resolve(String(directory || "."));
  const version = normalizedVersion(requestedVersion);
  const modelNames = version === "500m-v3" ? V3_MODEL_NAMES : V4_MODEL_NAMES;
  const layouts = version === "500m-v3" ? v3CandidateLayouts(root) : v4CandidateLayouts(root);
  for (const candidate of layouts) {
    if (hasModels(candidate.models, modelNames)) return { root, ...candidate, version, modelNames };
  }
  const fallback = layouts[version === "v4-small" ? 1 : 0] || layouts[0];
  return {
    root,
    ...fallback,
    version,
    modelNames,
  };
}

function irodoriModelStatus(directory, referenceAudioPath = "", webgpuAvailable = null, options = {}) {
  const resolved = directory
    ? resolveIrodoriModelDirectory(directory, options.version)
    : { root: "", models: "", tokenizer: "", version: normalizedVersion(options.version), modelNames: normalizedVersion(options.version) === "500m-v3" ? V3_MODEL_NAMES : V4_MODEL_NAMES };
  const missingFiles = resolved.models
    ? resolved.modelNames.flatMap((name) => [`${name}.onnx`, `${name}.onnx.data`]).filter((name) => !isFile(path.join(resolved.models, name)))
    : resolved.modelNames.flatMap((name) => [`${name}.onnx`, `${name}.onnx.data`]);
  const tokenizerReady = Boolean(resolved.tokenizer)
    && isFile(path.join(resolved.tokenizer, "tokenizer.json"))
    && isFile(path.join(resolved.tokenizer, "tokenizer_config.json"));
  const referenceReady = isFile(referenceAudioPath) && path.extname(referenceAudioPath).toLowerCase() === ".wav";
  const referenceRequired = !(resolved.version === "v4-small" && options.mode === "design");
  const release = resolved.version === "v4-small"
    ? irodoriV4ModelRelease(resolved.models)
    : { modelRelease: "500m-v3", modelOutdated: false };
  return {
    ready: Boolean(resolved.root) && missingFiles.length === 0 && tokenizerReady && (!referenceRequired || referenceReady),
    modelReady: Boolean(resolved.root) && missingFiles.length === 0 && tokenizerReady,
    referenceReady,
    referenceRequired,
    ...release,
    version: resolved.version,
    directoryName: resolved.root ? path.basename(resolved.root) : "",
    referenceName: referenceReady ? path.basename(referenceAudioPath) : "",
    missingFiles,
    tokenizerReady,
    webgpuAvailable,
  };
}

function validateIrodoriModelDirectory(directory, version = "v4-small") {
  const resolved = resolveIrodoriModelDirectory(directory, version);
  const status = irodoriModelStatus(resolved.root, "", null, { version: resolved.version });
  if (!status.modelReady) {
    const tokenizerName = resolved.version === "500m-v3" ? "tokenizer/llmjp_tok" : "tokenizer/irodori_v4";
    const detail = !status.tokenizerReady ? `${tokenizerName}/{tokenizer.json, tokenizer_config.json}` : status.missingFiles.slice(0, 3).join(", ");
    throw new Error(`Irodori TTSの変換済みモデル一式が揃っていません（不足: ${detail}）。`);
  }
  return resolved.root;
}

function validateIrodoriReferenceAudio(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  if (!isFile(resolved) || path.extname(resolved).toLowerCase() !== ".wav") {
    throw new Error("Irodori TTSの参照音声はWAVファイルを選択してください。");
  }
  return resolved;
}

function splitIrodoriText(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim().slice(0, IRODORI_CHUNK_LENGTH * IRODORI_MAX_CHUNKS);
  if (!normalized) return [];
  const sentences = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    if (!/[。！？!?]/u.test(normalized[index])) continue;
    let end = index + 1;
    while (end < normalized.length && /[。！？!?]/u.test(normalized[end])) end += 1;
    while (end < normalized.length && /[」』】）)\]"'”’]/u.test(normalized[end])) end += 1;
    const sentence = normalized.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    index = end - 1;
  }
  const remainder = normalized.slice(start).trim();
  if (remainder) sentences.push(remainder);

  const chunks = [];
  for (const sentence of sentences) {
    if (chunks.length >= IRODORI_MAX_CHUNKS) break;
    if (!chunks.length && sentence.length > IRODORI_FIRST_CHUNK_LENGTH) {
      const first = splitNaturalSpeechText(sentence, IRODORI_FIRST_CHUNK_LENGTH, IRODORI_MAX_CHUNKS, { maxOverflow: IRODORI_CHUNK_OVERFLOW })[0];
      if (first) chunks.push(first);
      const remainder = sentence.slice(first?.length || 0).trim();
      if (remainder) chunks.push(...splitNaturalSpeechText(remainder, IRODORI_CHUNK_LENGTH, IRODORI_MAX_CHUNKS - chunks.length, { maxOverflow: IRODORI_CHUNK_OVERFLOW }));
    } else {
      chunks.push(...splitNaturalSpeechText(sentence, IRODORI_CHUNK_LENGTH, IRODORI_MAX_CHUNKS - chunks.length, { maxOverflow: IRODORI_CHUNK_OVERFLOW }));
    }
  }
  return chunks.slice(0, IRODORI_MAX_CHUNKS);
}

module.exports = {
  IRODORI_CHUNK_OVERFLOW,
  IRODORI_CHUNK_LENGTH,
  IRODORI_FIRST_CHUNK_LENGTH,
  IRODORI_V4_MIN_STEPS,
  IRODORI_VERSIONS,
  MODEL_NAMES,
  V3_MODEL_NAMES,
  V4_MODEL_NAMES,
  irodoriModelStatus,
  irodoriV4ModelRelease,
  irodoriGenerationSettings,
  resolveIrodoriModelDirectory,
  splitIrodoriText,
  validateIrodoriModelDirectory,
  validateIrodoriReferenceAudio,
};
