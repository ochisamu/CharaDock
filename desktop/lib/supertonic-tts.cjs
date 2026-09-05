// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const path = require("node:path");

const { splitTtsText } = require("./style-bert-vits2.cjs");

const REQUIRED_FILES = Object.freeze([
  "duration_predictor.int8.onnx",
  "text_encoder.int8.onnx",
  "vector_estimator.int8.onnx",
  "vocoder.int8.onnx",
  "tts.json",
  "unicode_indexer.bin",
  "voice.bin",
]);
const VOICES = Object.freeze(["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"]);

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function resolveSupertonicDirectory(directory) {
  const root = path.resolve(String(directory || "."));
  if (REQUIRED_FILES.every((name) => isFile(path.join(root, name)))) return root;
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(root, entry.name);
      if (REQUIRED_FILES.every((name) => isFile(path.join(nested, name)))) return nested;
    }
  } catch {}
  return root;
}

function supertonicStatus(directory) {
  const resolvedDirectory = directory ? resolveSupertonicDirectory(directory) : "";
  const missingFiles = resolvedDirectory
    ? REQUIRED_FILES.filter((name) => !isFile(path.join(resolvedDirectory, name)))
    : [...REQUIRED_FILES];
  return {
    ready: Boolean(resolvedDirectory) && missingFiles.length === 0,
    directoryName: resolvedDirectory ? path.basename(resolvedDirectory) : "",
    missingFiles,
  };
}

function validateSupertonicDirectory(directory) {
  const resolved = resolveSupertonicDirectory(directory);
  const status = supertonicStatus(resolved);
  if (!status.ready) throw new Error(`Supertonic 3モデルが揃っていません（不足: ${status.missingFiles.join(", ")}）。`);
  return resolved;
}

function wavDataUrl(samples, sampleRate) {
  const input = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  if (!input.length || !Number.isFinite(sampleRate) || sampleRate < 8000) throw new Error("Supertonic 3が有効な音声を生成できませんでした。");
  const buffer = Buffer.allocUnsafe(44 + input.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + input.length * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(input.length * 2, 40);
  for (let index = 0; index < input.length; index += 1) {
    const value = Math.max(-1, Math.min(1, Number(input[index]) || 0));
    buffer.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), 44 + index * 2);
  }
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

class EmbeddedSupertonicTts {
  constructor({ sherpaOnnx = null, forceSynchronous = false } = {}) {
    this.sherpaOnnx = sherpaOnnx;
    this.forceSynchronous = Boolean(forceSynchronous);
    this.cached = null;
  }

  runtime() {
    if (this.sherpaOnnx) return this.sherpaOnnx;
    try { return require("sherpa-onnx-node"); } catch (error) {
      throw new Error(`内蔵sherpa-onnxランタイムを読み込めません: ${error.message}`);
    }
  }

  clear() {
    this.cached = null;
  }

  async engine(directory) {
    const modelDirectory = validateSupertonicDirectory(directory);
    if (this.cached?.directory === modelDirectory) return this.cached;
    const sherpaOnnx = this.runtime();
    const file = (name) => path.join(modelDirectory, name);
    const config = {
      model: {
        supertonic: {
          durationPredictor: file("duration_predictor.int8.onnx"),
          textEncoder: file("text_encoder.int8.onnx"),
          vectorEstimator: file("vector_estimator.int8.onnx"),
          vocoder: file("vocoder.int8.onnx"),
          ttsJson: file("tts.json"),
          unicodeIndexer: file("unicode_indexer.bin"),
          voiceStyle: file("voice.bin"),
        },
        numThreads: Math.max(1, Math.min(4, Number(process.env.CHARADOCK_TTS_THREADS) || 2)),
        provider: "cpu",
        debug: false,
      },
      maxNumSentences: 1,
    };
    const tts = !this.forceSynchronous && typeof sherpaOnnx.OfflineTts.createAsync === "function"
      ? await sherpaOnnx.OfflineTts.createAsync(config)
      : new sherpaOnnx.OfflineTts(config);
    this.cached = { directory: modelDirectory, sherpaOnnx, tts };
    return this.cached;
  }

  async synthesize({ text, modelDirectory, voice = "F1", speed = 1, numSteps = 8 } = {}) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) return { audioDataUrls: [] };
    const selectedVoice = VOICES.includes(voice) ? voice : "F1";
    const { sherpaOnnx, tts } = await this.engine(modelDirectory);
    const generationConfig = new sherpaOnnx.GenerationConfig({
      sid: VOICES.indexOf(selectedVoice),
      speed: Math.min(2, Math.max(.5, Number(speed) || 1)),
      numSteps: Math.min(20, Math.max(2, Math.round(Number(numSteps) || 8))),
      extra: { lang: "ja" },
    });
    const audioDataUrls = [];
    const audioTexts = splitTtsText(normalizedText);
    for (const sentence of audioTexts) {
      // sherpa-onnx defaults to an external ArrayBuffer for generated samples.
      // Packaged Electron rejects those buffers even in Node mode, so request
      // an owned buffer that can safely be encoded before leaving the worker.
      const request = { text: sentence, generationConfig, enableExternalBuffer: false };
      const audio = !this.forceSynchronous && typeof tts.generateAsync === "function"
        ? await tts.generateAsync(request)
        : tts.generate(request);
      audioDataUrls.push(wavDataUrl(audio?.samples, audio?.sampleRate || tts.sampleRate));
    }
    return { audioDataUrls, audioTexts };
  }
}

module.exports = {
  EmbeddedSupertonicTts,
  REQUIRED_FILES,
  VOICES,
  resolveSupertonicDirectory,
  supertonicStatus,
  validateSupertonicDirectory,
  wavDataUrl,
};
