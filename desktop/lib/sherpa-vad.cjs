// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SILERO_VAD_MODEL = Object.freeze({
  fileName: "silero_vad.onnx",
  downloadUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
  bytes: 643_854,
  sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
});

const SILERO_VAD_PROFILES = Object.freeze({
  low: Object.freeze({ threshold: .68, minSpeechDuration: .22, minSilenceDuration: 1.15 }),
  normal: Object.freeze({ threshold: .5, minSpeechDuration: .16, minSilenceDuration: .9 }),
  high: Object.freeze({ threshold: .35, minSpeechDuration: .1, minSilenceDuration: .72 }),
});

class EmbeddedSherpaVad {
  constructor(baseDirectory, { fetchImpl = globalThis.fetch } = {}) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.modelPath = path.join(this.baseDirectory, SILERO_VAD_MODEL.fileName);
    this.fetchImpl = fetchImpl;
    this.downloadPromise = null;
    this.detector = null;
  }

  isInstalled() {
    try { return fs.statSync(this.modelPath).size === SILERO_VAD_MODEL.bytes; } catch { return false; }
  }

  async ensureModel() {
    if (this.isInstalled()) return this.modelPath;
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = this.downloadModel().finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async downloadModel() {
    fs.mkdirSync(this.baseDirectory, { recursive: true });
    const temporary = `${this.modelPath}.download`;
    try {
      const response = await this.fetchImpl(SILERO_VAD_MODEL.downloadUrl, { redirect: "follow" });
      if (!response?.ok || !response.body) throw new Error(`Silero VADをダウンロードできませんでした (HTTP ${response?.status || "unknown"})`);
      const output = fs.openSync(temporary, "w", 0o600);
      const hash = crypto.createHash("sha256");
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          fs.writeSync(output, chunk);
          hash.update(chunk);
        }
      } finally {
        fs.closeSync(output);
      }
      if (hash.digest("hex") !== SILERO_VAD_MODEL.sha256) throw new Error("Silero VADモデルのSHA-256が一致しません。");
      fs.renameSync(temporary, this.modelPath);
      return this.modelPath;
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch {}
    }
  }

  async start(sensitivity = "normal") {
    await this.ensureModel();
    const profile = SILERO_VAD_PROFILES[sensitivity] || SILERO_VAD_PROFILES.normal;
    const { Vad } = require("sherpa-onnx-node");
    this.detector = new Vad({
      sileroVad: {
        model: this.modelPath,
        threshold: profile.threshold,
        minSpeechDuration: profile.minSpeechDuration,
        minSilenceDuration: profile.minSilenceDuration,
        windowSize: 512,
        maxSpeechDuration: 20,
      },
      sampleRate: 16_000,
      numThreads: 1,
      provider: "cpu",
      debug: 0,
    }, 30);
    return { engine: "silero", sensitivity, installed: true };
  }

  accept(samples) {
    if (!this.detector) throw new Error("Silero VADが開始されていません。");
    const waveform = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    if (!waveform.length || waveform.length > 32_768) return { detected: this.detector.isDetected(), segmentComplete: false, segmentSamples: null };
    this.detector.acceptWaveform(waveform);
    const segmentComplete = !this.detector.isEmpty();
    let segmentSamples = null;
    if (segmentComplete) {
      // Copy before pop(): front() may be backed by detector-owned native
      // memory. Returning the actual Silero segment lets final recognition use
      // the same VAD boundary as Mojicast instead of reconstructing it from
      // delayed renderer callbacks.
      // The sherpa-onnx Node addon defaults to an external ArrayBuffer here.
      // Electron rejects that buffer on Windows ("External buffers are not
      // allowed"), so request an owned buffer before pop() invalidates it.
      const segment = this.detector.front(false);
      segmentSamples = segment?.samples instanceof Float32Array
        ? segment.samples.slice()
        : new Float32Array(segment?.samples || []);
      this.detector.pop();
    }
    return { detected: this.detector.isDetected(), segmentComplete, segmentSamples };
  }

  stop() {
    this.detector?.reset?.();
    this.detector = null;
    return true;
  }
}

module.exports = { EmbeddedSherpaVad, SILERO_VAD_MODEL, SILERO_VAD_PROFILES };
