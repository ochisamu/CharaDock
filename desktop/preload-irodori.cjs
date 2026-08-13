// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { ipcRenderer } = require("electron");

const { irodoriGenerationSettings, resolveIrodoriModelDirectory } = require("./lib/irodori-webgpu.cjs");
const { wavDataUrl } = require("./lib/supertonic-tts.cjs");

const V3_MODEL_NAMES = Object.freeze({
  text: "text_encoder",
  speaker: "speaker_encoder",
  duration: "duration",
  dit: "dit",
  dac: "dacvae_decoder",
  enc: "dacvae_encoder",
});
const V4_MODEL_NAMES = Object.freeze({
  backbone: "text_backbone",
  text: "text_projector",
  caption: "caption_projector",
  speaker: "speaker_encoder",
  duration: "duration",
  dit: "dit_v4",
  dac: "dacvae_decoder",
  enc: "dacvae_encoder",
});
let cached = null;
const referenceCache = new Map();
const v4SpeakerCache = new Map();
let synthesisQueue = Promise.resolve();
let prewarmKey = "";

function enqueueSynthesis(task) {
  const run = synthesisQueue.then(task, task);
  synthesisQueue = run.catch(() => {});
  return run;
}

function decodeWav(bytes, maxSeconds = 120) {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("参照音声はPCMまたはFloat形式のWAVファイルを使用してください。");
  }
  let offset = 12, format = null, data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8, end = Math.min(buffer.length, start + size);
    if (id === "fmt " && end - start >= 16) {
      const rawType = buffer.readUInt16LE(start);
      format = {
        type: rawType === 0xfffe && end - start >= 40 ? buffer.readUInt16LE(start + 24) : rawType,
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4), bits: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") data = buffer.subarray(start, end);
    offset = start + size + (size % 2);
  }
  if (!format || !data || ![1, 3].includes(format.type) || format.channels < 1 || format.channels > 8) {
    throw new Error("このWAV形式には対応していません。PCMまたは32-bit Floatを使用してください。");
  }
  const bytesPerSample = format.bits / 8;
  if (![2, 3, 4].includes(bytesPerSample) || (format.type === 3 && format.bits !== 32)) throw new Error("WAVのビット深度には対応していません。");
  const frameBytes = bytesPerSample * format.channels;
  const frames = Math.floor(data.length / frameBytes);
  if (frames < format.sampleRate * .4) throw new Error("参照音声が短すぎます。1秒以上の明瞭な音声を使用してください。");
  if (frames > format.sampleRate * maxSeconds) throw new Error(`参照音声は${maxSeconds}秒以内にしてください。`);
  const mono = new Float32Array(frames);
  const sample = (at) => {
    if (format.type === 3) { const value = data.readFloatLE(at); return Number.isFinite(value) ? value : 0; }
    if (format.bits === 16) return data.readInt16LE(at) / 32768;
    if (format.bits === 24) return data.readIntLE(at, 3) / 8388608;
    return data.readInt32LE(at) / 2147483648;
  };
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) sum += sample(frame * frameBytes + channel * bytesPerSample);
    mono[frame] = sum / format.channels;
  }
  return { samples: mono, sampleRate: format.sampleRate };
}

function resample48k(input, sampleRate) {
  if (sampleRate === 48000) return input;
  const length = Math.max(1, Math.round(input.length * 48000 / sampleRate));
  const output = new Float32Array(length);
  const ratio = sampleRate / 48000;
  for (let i = 0; i < length; i++) {
    const position = i * ratio, left = Math.floor(position), right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

async function loadEngine(modelDirectory, requestedVersion = "v4-small") {
  const resolved = resolveIrodoriModelDirectory(modelDirectory, requestedVersion);
  if (cached?.root === resolved.root && cached?.version === resolved.version) return cached.engine;
  if (!navigator.gpu) throw new Error("このPCまたはElectronではWebGPUを利用できません。");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU対応GPUアダプターを取得できません。");
  const [ort, tokenizers, pipeline] = await Promise.all([
    import("onnxruntime-web/webgpu"),
    import("@huggingface/tokenizers"),
    import(pathToFileURL(path.join(__dirname, "irodori", resolved.version === "500m-v3" ? "pipeline.mjs" : "v4-pipeline.mjs")).href),
  ]);
  ort.env.wasm.numThreads = 1;
  let ortDist = path.dirname(require.resolve("onnxruntime-web/webgpu"));
  ortDist = ortDist.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  ort.env.wasm.wasmPaths = pathToFileURL(ortDist + path.sep).href;
  const sessions = {};
  const modelNames = resolved.version === "500m-v3" ? V3_MODEL_NAMES : V4_MODEL_NAMES;
  for (const [key, name] of Object.entries(modelNames)) {
    const [model, externalData] = await Promise.all([
      fs.readFile(path.join(resolved.models, `${name}.onnx`)),
      fs.readFile(path.join(resolved.models, `${name}.onnx.data`)),
    ]);
    sessions[key] = await ort.InferenceSession.create(new Uint8Array(model), {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
      externalData: [{ path: `${name}.onnx.data`, data: new Uint8Array(externalData) }],
    });
  }
  const [tokenizerJson, tokenizerConfig] = await Promise.all([
    fs.readFile(path.join(resolved.tokenizer, "tokenizer.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(resolved.tokenizer, "tokenizer_config.json"), "utf8").then(JSON.parse),
  ]);
  const tokenizer = new tokenizers.Tokenizer(tokenizerJson, tokenizerConfig);
  const tokenizerAdapter = { encode: (text, options) => tokenizer.encode(text, options).ids };
  const engine = resolved.version === "500m-v3"
    ? new pipeline.IrodoriTTS({ ort, sessions, tokenizer: tokenizerAdapter })
    : new pipeline.IrodoriV4TTS({ ort, sessions, tokenizer: tokenizerAdapter });
  cached = { root: resolved.root, version: resolved.version, engine, pipeline };
  v4SpeakerCache.clear();
  return engine;
}

async function loadReference(referenceAudioPath, maxSeconds = 120) {
  const resolvedPath = path.resolve(String(referenceAudioPath || ""));
  const stat = await fs.stat(resolvedPath);
  const key = `${resolvedPath}:${stat.size}:${Math.round(stat.mtimeMs)}:${maxSeconds}`;
  if (referenceCache.has(key)) {
    const cachedReference = referenceCache.get(key);
    referenceCache.delete(key);
    referenceCache.set(key, cachedReference);
    return { ...cachedReference, cacheHit: true };
  }
  const decoded = decodeWav(await fs.readFile(resolvedPath), maxSeconds);
  const value = { key, samples: resample48k(decoded.samples, decoded.sampleRate) };
  referenceCache.set(key, value);
  while (referenceCache.size > 8) referenceCache.delete(referenceCache.keys().next().value);
  return { ...value, cacheHit: false };
}

async function synthesizeRequest(request) {
  const startedAt = performance.now();
  const version = request.version === "500m-v3" ? "500m-v3" : "v4-small";
  const mode = version === "v4-small" && request.mode === "design" ? "design" : "reference";
  const generation = irodoriGenerationSettings(version, {
    numSteps: request.numSteps,
    tScheduleMode: request.tScheduleMode,
    cfgExecution: request.cfgExecution,
  });
  const engine = await loadEngine(request.modelDirectory, version);
  const reference = mode === "reference" ? await loadReference(request.referenceAudioPath, version === "500m-v3" ? 60 : 120) : null;
  const preparedAt = performance.now();
  const options = {
    numSteps: generation.numSteps,
    swayCoeff: -1,
    seed: Math.max(0, Math.round(Number(request.seed) || 0)),
  };
  if (version === "500m-v3") {
    const result = await engine.synthesize(String(request.text || ""), reference.samples, 48000, {
      ...options,
      tScheduleMode: generation.tScheduleMode,
      speakerCacheKey: reference.key,
    });
    return {
      result,
      metrics: {
        ...(result.timings || {}),
        prepareMs: preparedAt - startedAt,
        elapsedMs: performance.now() - startedAt,
        audioSeconds: result.audio.length / result.sampleRate,
        referenceCacheHit: reference.cacheHit,
        speakerCacheHit: Boolean(result.speakerCacheHit),
        captionCacheHit: false,
        generationSchedule: generation.tScheduleMode,
        generationSteps: generation.numSteps,
        generationCfgExecution: generation.cfgExecution,
        modelVersion: version,
        modelPrecision: "fp16",
        modelRelease: String(request.modelRelease || ""),
        textLength: Array.from(String(request.text || "")).length,
        captionLength: 0,
      },
    };
  }

  const captionCacheHitsBefore = Number(engine.captionCacheHits) || 0;
  let speakerCacheHit = false;
  let speaker = cached.pipeline.noSpeakerCondition();
  if (reference) {
    const speakerKey = `${version}:${reference.key}`;
    speakerCacheHit = v4SpeakerCache.has(speakerKey);
    if (speakerCacheHit) speaker = v4SpeakerCache.get(speakerKey);
    else {
      speaker = await engine.encodeReferenceAudio(reference.samples, 48000, { maxRefSeconds: 120 });
      v4SpeakerCache.set(speakerKey, speaker);
      while (v4SpeakerCache.size > 8) v4SpeakerCache.delete(v4SpeakerCache.keys().next().value);
    }
  }
  const result = await engine.synthesize(
    String(request.text || ""),
    String(request.caption || "自然で明瞭な日本語。落ち着いた親しみやすい口調で話す。"),
    {
      ...options,
      speaker,
      schedule: generation.tScheduleMode,
      cfgExecution: generation.cfgExecution,
      trimTrailingUtterance: true,
    },
  );
  return {
    result,
    metrics: {
      ...(result.timings || {}),
      prepareMs: preparedAt - startedAt,
      elapsedMs: performance.now() - startedAt,
      audioSeconds: result.audio.length / result.sampleRate,
      referenceCacheHit: reference?.cacheHit || false,
      speakerCacheHit,
      captionCacheHit: (Number(engine.captionCacheHits) || 0) > captionCacheHitsBefore,
      generationSchedule: generation.tScheduleMode,
      generationSteps: generation.numSteps,
      generationCfgExecution: generation.cfgExecution,
      modelVersion: version,
      modelPrecision: request.precision === "int4" ? "int4" : "fp16",
      modelRelease: String(request.modelRelease || ""),
      textLength: Array.from(String(request.text || "")).length,
      captionLength: Array.from(String(request.caption || "")).length,
      sequenceLength: Number(result.sequenceLength) || 0,
      trimmedSequenceLength: Number(result.trimmedSequenceLength) || 0,
      trailingUtteranceTrimmed: Boolean(result.trailingUtteranceTrimmed),
    },
  };
}

ipcRenderer.on("irodori:synthesize", async (_event, request = {}) => {
  const requestId = String(request.requestId || "");
  try {
    const { result, metrics } = await enqueueSynthesis(() => synthesizeRequest(request));
    ipcRenderer.send("irodori:result", { requestId, audioDataUrl: wavDataUrl(result.audio, result.sampleRate), metrics });
  } catch (error) {
    ipcRenderer.send("irodori:result", { requestId, error: String(error?.message || error) });
  }
});

ipcRenderer.on("irodori:prewarm", async (_event, request = {}) => {
  try {
    const version = request.version === "500m-v3" ? "500m-v3" : "v4-small";
    const resolved = resolveIrodoriModelDirectory(request.modelDirectory, version);
    const designMode = version === "v4-small" && request.mode === "design";
    const reference = designMode ? null : await loadReference(request.referenceAudioPath, version === "500m-v3" ? 60 : 120);
    const key = `${resolved.root}:${version}:${request.mode}:${reference?.key || "design"}:${request.tScheduleMode}:${request.numSteps}`;
    if (prewarmKey === key) return;
    const { metrics } = await enqueueSynthesis(() => synthesizeRequest({ ...request, text: "準備中です。" }));
    prewarmKey = key;
    ipcRenderer.send("irodori:prewarmed", { metrics });
  } catch (error) {
    ipcRenderer.send("irodori:prewarmed", { error: String(error?.message || error) });
  }
});

ipcRenderer.on("irodori:convertReference", async (_event, request = {}) => {
  const requestId = String(request.requestId || "");
  try {
    const bytes = await fs.readFile(String(request.sourcePath || ""));
    if (bytes.length > 100 * 1024 * 1024) throw new Error("参照音声は100MB以内にしてください。");
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audioContext = new AudioContext({ sampleRate: 48000 });
    try {
      const decoded = await audioContext.decodeAudioData(source);
      if (decoded.duration < .4) throw new Error("参照音声が短すぎます。1秒以上の明瞭な音声を使用してください。");
      const maxSeconds = request.version === "500m-v3" ? 60 : 120;
      if (decoded.duration > maxSeconds) throw new Error(`参照音声は${maxSeconds}秒以内にしてください。`);
      const mono = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const samples = decoded.getChannelData(channel);
        for (let index = 0; index < samples.length; index += 1) mono[index] += samples[index] / decoded.numberOfChannels;
      }
      const converted = resample48k(mono, decoded.sampleRate);
      ipcRenderer.send("irodori:referenceConverted", {
        requestId,
        audioDataUrl: wavDataUrl(converted, 48000),
      });
    } finally {
      await audioContext.close();
    }
  } catch (error) {
    ipcRenderer.send("irodori:referenceConverted", { requestId, error: String(error?.message || error) });
  }
});

window.addEventListener("DOMContentLoaded", () => {
  ipcRenderer.send("irodori:ready", { webgpuAvailable: Boolean(navigator.gpu) });
});
