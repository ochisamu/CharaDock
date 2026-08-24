// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const path = require("node:path");

const { EmbeddedSherpaOnnx } = require("./sherpa-embedded.cjs");

const STREAMING_SPEECH_MODELS = Object.freeze({
  "reazonspeech-streaming": Object.freeze({
    id: "reazonspeech-streaming",
    label: "ReazonSpeech ストリーミング",
    labelEn: "ReazonSpeech progressive recognition",
    description: "既存の日本語特化モデルを逐次再認識。精度を優先し、途中結果を表示します",
    descriptionEn: "Repeatedly recognizes the accumulated utterance with the existing Japanese model, prioritizing accuracy while showing interim results",
    engine: "sherpa-simulated",
    recommended: true,
    sharedSherpaModelId: "reazonspeech-ja-int8",
    downloadBytes: 713_097_333,
    latency: "balanced",
  }),
});

const DEFAULT_STREAMING_SPEECH_MODEL_ID = "reazonspeech-streaming";
const TARGET_SAMPLE_RATE = 16_000;
const MAX_UTTERANCE_SAMPLES = TARGET_SAMPLE_RATE * 30;
const STREAMING_PARTIAL_INITIAL_SAMPLES = Math.round(TARGET_SAMPLE_RATE * .32);
const STREAMING_PARTIAL_INTERVAL_SAMPLES = Math.round(TARGET_SAMPLE_RATE * .4);
const REAZONSPEECH_END_PADDING_SAMPLES = Math.round(TARGET_SAMPLE_RATE * .9);

function padWaveform(samples, padding) {
  const padded = new Float32Array(samples.length + padding * 2);
  padded.set(samples, padding);
  return padded;
}

function padReazonSpeechWaveform(samples) {
  // ReazonSpeech k2 was trained and is normally invoked with silence on both
  // sides of an utterance. VAD output has very tight boundaries, so trailing-
  // only padding can still clip the first mora of short microphone input.
  // Mojicast follows the upstream ReazonSpeech wrapper and pads 0.9 seconds
  // before and after the detected segment; keep the same contract here.
  const padding = REAZONSPEECH_END_PADDING_SAMPLES;
  return padWaveform(samples, padding);
}

function modelForId(modelId) {
  return STREAMING_SPEECH_MODELS[String(modelId || "")] || null;
}

function normalizeSamples(samples) {
  const waveform = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  if (!waveform.length) return waveform;
  if (waveform.byteLength > 4 * 1024 * 1024) throw new Error("音声チャンクが大きすぎます。");
  return waveform;
}

function resampleLinear(samples, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  const rate = Math.round(Number(sourceRate));
  if (rate < 8_000 || rate > 192_000) throw new Error("音声のサンプルレートが正しくありません。");
  if (rate === targetRate) return samples.slice();
  const outputLength = Math.max(1, Math.round(samples.length * targetRate / rate));
  const output = new Float32Array(outputLength);
  const scale = rate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * scale;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function concatenateFloat32(chunks, totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)) {
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

class SimulatedStreamingSession {
  constructor(transcribe, queueInference, {
    initialSamples = STREAMING_PARTIAL_INITIAL_SAMPLES,
    intervalSamples = STREAMING_PARTIAL_INTERVAL_SAMPLES,
    now = () => performance.now(),
  } = {}) {
    this.transcribe = transcribe;
    this.queueInference = queueInference;
    this.initialSamples = initialSamples;
    this.intervalSamples = intervalSamples;
    this.now = now;
    this.chunks = [];
    this.totalSamples = 0;
    this.lastDecodedSamples = 0;
    this.nextPartialSamples = initialSamples;
    this.lastText = "";
    this.lastDecodeSucceeded = false;
    this.closed = false;
  }

  async append(samples) {
    if (this.closed) throw new Error("音声認識セッションは終了しています。");
    if (this.totalSamples + samples.length > MAX_UTTERANCE_SAMPLES) throw new Error("一度の音声入力は30秒以内にしてください。");
    this.chunks.push(samples.slice());
    this.totalSamples += samples.length;
    if (this.totalSamples < this.nextPartialSamples) {
      return { text: this.lastText, partial: true, changed: false };
    }
    return this.decode(false);
  }

  async decode(final) {
    if (!this.totalSamples) return { text: "", partial: !final, changed: false };
    const snapshot = concatenateFloat32(this.chunks, this.totalSamples);
    let result;
    const startedAt = this.now();
    try {
      result = await this.queueInference(() => this.transcribe(snapshot));
    } catch (error) {
      // Short prefixes can be below an offline recognizer's minimum duration.
      // Keep a partial miss from tearing down the microphone session; final
      // decoding still reports actual model/runtime errors to the user.
      if (final) throw error;
      this.lastDecodeSucceeded = false;
      this.lastDecodedSamples = this.totalSamples;
      this.nextPartialSamples = this.totalSamples + this.intervalSamples;
      return { text: this.lastText, partial: true, changed: false };
    }
    const elapsedMs = Math.max(0, this.now() - startedAt);
    const text = String(result?.text ?? result ?? "").trim();
    const changed = text !== this.lastText;
    this.lastDecodeSucceeded = true;
    this.lastText = text;
    this.lastDecodedSamples = this.totalSamples;
    // Keep the first feedback quick, then avoid an inference backlog on slower
    // CPUs by limiting progressive decoding to roughly half of wall-clock time.
    // Finalization remains controlled separately by each surface's VAD gate.
    if (!final) {
      const adaptiveGap = Math.max(
        this.intervalSamples,
        Math.ceil(elapsedMs * TARGET_SAMPLE_RATE * 2 / 1000),
      );
      this.nextPartialSamples = this.totalSamples + adaptiveGap;
    }
    return { text, partial: !final, changed };
  }

  async finish() {
    if (this.closed) return { text: this.lastText, partial: false, changed: false };
    this.closed = true;
    // A partial is tentative even when it happened to consume the latest
    // sample. Always run the authoritative final decode so a renderer can
    // never commit a low-quality prefix merely because no later audio chunk
    // arrived between the partial and VAD completion.
    return this.decode(true);
  }

  cancel() {
    this.closed = true;
    this.chunks = [];
  }
}

class StreamingSpeechRecognition {
  constructor(baseDirectory, {
    fetchImpl = globalThis.fetch,
    modelId = DEFAULT_STREAMING_SPEECH_MODEL_ID,
    sherpaBaseDirectory = path.join(baseDirectory, "..", "sherpa-onnx-models"),
  } = {}) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.modelId = modelForId(modelId)?.id || DEFAULT_STREAMING_SPEECH_MODEL_ID;
    this.sherpa = new EmbeddedSherpaOnnx(sherpaBaseDirectory, { modelId: "reazonspeech-ja-int8", fetchImpl });
    this.downloadPromise = null;
    this.downloadModelId = "";
    this.progress = null;
    this.sessions = new Map();
    this.inferenceQueue = Promise.resolve();
    this.preparePromises = new Map();
  }

  get model() {
    return STREAMING_SPEECH_MODELS[this.modelId];
  }

  hasModel(modelId) {
    return Boolean(modelForId(modelId));
  }

  selectModel(modelId) {
    const model = modelForId(modelId);
    if (!model) throw new Error("対応していないストリーミング音声認識モデルです。");
    this.modelId = model.id;
    return this.status();
  }

  isModelInstalled(modelId) {
    const model = modelForId(modelId);
    return Boolean(model && this.sherpa.isModelInstalled(model.sharedSherpaModelId));
  }

  status() {
    const selected = this.model;
    const modelStatus = (model) => ({
      modelId: model.id,
      label: model.label,
      labelEn: model.labelEn,
      description: model.description,
      descriptionEn: model.descriptionEn,
      recommended: Boolean(model.recommended),
      experimental: Boolean(model.experimental),
      lightweight: Boolean(model.lightweight),
      shared: true,
      latency: model.latency,
      downloadBytes: model.downloadBytes,
      installed: this.isModelInstalled(model.id),
      supported: true,
      downloading: this.downloadModelId === model.id,
    });
    const current = modelStatus(selected);
    return {
      ...current,
      downloading: Boolean(this.downloadPromise),
      downloadingModelId: this.downloadModelId,
      progress: this.progress,
      models: Object.values(STREAMING_SPEECH_MODELS).map(modelStatus),
    };
  }

  emitProgress(onProgress, model, phase, receivedBytes = 0, totalBytes = model.downloadBytes) {
    this.progress = { modelId: model.id, phase, receivedBytes, totalBytes };
    onProgress?.(this.status());
  }

  async download(onProgress, modelId = this.modelId) {
    const model = modelForId(modelId);
    if (!model) throw new Error("対応していないストリーミング音声認識モデルです。");
    if (this.isModelInstalled(model.id)) return this.status();
    if (this.downloadPromise) {
      if (this.downloadModelId !== model.id) throw new Error("別の音声認識モデルをダウンロード中です。");
      return this.downloadPromise;
    }
    this.downloadModelId = model.id;
    this.downloadPromise = this.downloadModel(model, onProgress).then(async () => {
      await this.prepare(model.id);
      return this.status();
    }).finally(() => {
      this.downloadPromise = null;
      this.downloadModelId = "";
      this.progress = null;
    });
    return this.downloadPromise;
  }

  async downloadModel(model, onProgress) {
    await this.sherpa.download((sherpaStatus) => {
      const transfer = sherpaStatus.progress || {};
      this.emitProgress(onProgress, model, transfer.phase || "downloading", transfer.receivedBytes || 0, transfer.totalBytes || model.downloadBytes);
    }, model.sharedSherpaModelId);
    return this.status();
  }

  remove(modelId = this.modelId) {
    const model = modelForId(modelId);
    if (!model) throw new Error("対応していないストリーミング音声認識モデルです。");
    if (this.downloadPromise && this.downloadModelId === model.id) throw new Error("モデルのダウンロード中は削除できません。");
    if (this.preparePromises.has(model.id)) throw new Error("モデルの準備中は削除できません。少し待ってからもう一度お試しください。");
    for (const [sessionId, entry] of this.sessions) {
      if (entry.modelId === model.id) {
        entry.session.cancel();
        this.sessions.delete(sessionId);
      }
    }
    this.sherpa.remove(model.sharedSherpaModelId);
    return this.status();
  }

  queueInference(task) {
    const operation = this.inferenceQueue.then(task, task);
    this.inferenceQueue = operation.catch(() => {});
    return operation;
  }

  async prepare(modelId = this.modelId) {
    const model = modelForId(modelId);
    if (!model) throw new Error("対応していないストリーミング音声認識モデルです。");
    if (!this.isModelInstalled(model.id)) throw new Error(`${model.label}が未ダウンロードです。設定からダウンロードしてください。`);
    if (this.preparePromises.has(model.id)) return this.preparePromises.get(model.id);
    const operation = (async () => {
      await this.sherpa.recognizer();
      return this.status();
    })().finally(() => this.preparePromises.delete(model.id));
    this.preparePromises.set(model.id, operation);
    return operation;
  }

  async createModelSession() {
    return new SimulatedStreamingSession(
      (samples) => this.sherpa.transcribe({
        samples: padReazonSpeechWaveform(samples),
        sampleRate: TARGET_SAMPLE_RATE,
      }),
      (task) => this.queueInference(task),
    );
  }

  async start(sessionId, modelId = this.modelId) {
    const id = String(sessionId || "").trim().slice(0, 160);
    if (!id) throw new Error("音声認識セッションIDがありません。");
    const model = modelForId(modelId);
    if (!model) throw new Error("対応していないストリーミング音声認識モデルです。");
    if (!this.isModelInstalled(model.id)) throw new Error(`${model.label}が未ダウンロードです。設定からダウンロードしてください。`);
    // Finish runtime initialization before the renderer switches into a
    // listening state so the first audio chunk cannot fail after the UI has
    // already reported that the microphone is ready.
    await this.prepare(model.id);
    const staleBefore = Date.now() - 2 * 60_000;
    for (const [staleId, entry] of this.sessions) {
      if (entry.updatedAt >= staleBefore) continue;
      entry.session.cancel();
      this.sessions.delete(staleId);
    }
    const previous = this.sessions.get(id);
    previous?.session.cancel();
    const session = await this.createModelSession();
    this.sessions.set(id, { modelId: model.id, session, updatedAt: Date.now() });
    return { sessionId: id, modelId: model.id, text: "", partial: true };
  }

  async append(sessionId, { samples, sampleRate = TARGET_SAMPLE_RATE } = {}) {
    const id = String(sessionId || "").trim();
    const entry = this.sessions.get(id);
    if (!entry) throw new Error("音声認識セッションが見つかりません。もう一度マイクを開始してください。");
    const waveform = resampleLinear(normalizeSamples(samples), sampleRate);
    entry.updatedAt = Date.now();
    return { sessionId: id, modelId: entry.modelId, ...(await entry.session.append(waveform)) };
  }

  async finish(sessionId) {
    const id = String(sessionId || "").trim();
    const entry = this.sessions.get(id);
    if (!entry) throw new Error("音声認識セッションが見つかりません。もう一度マイクを開始してください。");
    this.sessions.delete(id);
    const result = await entry.session.finish();
    return { sessionId: id, modelId: entry.modelId, ...result };
  }

  cancel(sessionId) {
    const id = String(sessionId || "").trim();
    const entry = this.sessions.get(id);
    if (!entry) return { cancelled: false };
    entry.session.cancel();
    this.sessions.delete(id);
    return { cancelled: true };
  }

  close() {
    for (const entry of this.sessions.values()) entry.session.cancel();
    this.sessions.clear();
    this.inferenceQueue = Promise.resolve();
  }

  async transcribe(payload = {}, modelId = this.modelId) {
    const temporaryId = `once-${crypto.randomUUID()}`;
    await this.start(temporaryId, modelId);
    try {
      await this.append(temporaryId, payload);
      return (await this.finish(temporaryId)).text;
    } catch (error) {
      this.cancel(temporaryId);
      throw error;
    }
  }
}

module.exports = {
  DEFAULT_STREAMING_SPEECH_MODEL_ID,
  REAZONSPEECH_END_PADDING_SAMPLES,
  STREAMING_SPEECH_MODELS,
  STREAMING_PARTIAL_INITIAL_SAMPLES,
  STREAMING_PARTIAL_INTERVAL_SAMPLES,
  SimulatedStreamingSession,
  StreamingSpeechRecognition,
  padReazonSpeechWaveform,
  resampleLinear,
};
