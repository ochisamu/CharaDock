// SPDX-License-Identifier: Apache-2.0
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { speechCppSteps } = require("./speech-cpp-settings.cjs");
let tailHelpers;
function loadTailHelpers() {
  return tailHelpers ||= Promise.all([
    import(pathToFileURL(path.join(__dirname, "../irodori/voicedesign-pipeline.mjs")).href),
    import(pathToFileURL(path.join(__dirname, "../irodori/speech-tail.mjs")).href),
  ]).then(([pipeline, tail]) => ({ shouldTrim: pipeline.shouldTrimTrailingUtterance, Gate: tail.StreamingSpeechTailGate }));
}
function pcmFloats(buffer) {
  const audio = new Float32Array(buffer.length / 2);
  for (let i = 0; i < audio.length; i++) audio[i] = buffer.readInt16LE(i * 2) / 32768;
  return audio;
}
function pcmBuffer(frames) {
  const size = frames.reduce((sum, frame) => sum + frame.length, 0);
  const buffer = Buffer.alloc(size * 2); let offset = 0;
  for (const frame of frames) for (const sample of frame) buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32768))), offset++ * 2);
  return buffer;
}

function speechCppStatus({ executablePath = "", modelPath = "", referenceAudioPath = "", mode = "reference" } = {}) {
  const file = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const modelReady = file(executablePath) && file(modelPath);
  const referenceReady = file(referenceAudioPath);
  return { modelReady, referenceReady, referenceRequired: mode !== "design", ready: modelReady && (mode === "design" || referenceReady) };
}
function waveDataUrl(pcm, sampleRate) {
  const b = Buffer.from(pcm, "base64");
  const h = Buffer.alloc(44);
  h.write("RIFF"); h.writeUInt32LE(b.length + 36, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(b.length, 40);
  return `data:audio/wav;base64,${Buffer.concat([h,b]).toString("base64")}`;
}
class SpeechCppClient {
  constructor({ spawnImpl = spawn, startupTimeoutMs = 180000, requestTimeoutMs = 600000, idleTimeoutMs = 120000, maxBufferedBytes = 64 * 1024 * 1024 } = {}) {
    Object.assign(this, { spawnImpl, startupTimeoutMs, requestTimeoutMs, idleTimeoutMs, maxBufferedBytes });
    this.durationCache = new Map();
    this.streams = new Map(); this.requests = new Map(); this.worker = null; this.key = ""; this.ready = null;
  }
  ensureWorker(options) {
    const ref = options.mode === "design" ? "" : options.referenceAudioPath;
    const key = JSON.stringify([options.executablePath, options.modelPath, ref]);
    if (this.worker && key === this.key) return this.ready;
    this.stop(); this.key = key;
    const args = ["worker", options.modelPath, "--threads", "4"];
    if (ref) args.push("--add-voice", `character=${ref}`);
    const child = this.spawnImpl(options.executablePath, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.worker = child;
    let buffer = "", stderr = "", settled = false;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error("音声エンジンの起動が時間切れになりました。GPUドライバーとモデルを確認してください。")), this.startupTimeoutMs);
      this.stopStartup = () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error("音声エンジンを終了しました。")); } };
      const fail = error => {
        if (this.worker !== child) return;
        clearTimeout(timer);
        if (!settled) { settled = true; reject(error); }
        this.failRequests(error); this.worker = null; this.key = ""; child.kill();
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", data => {
        buffer += data;
        if (buffer.length > 8 * 1024 * 1024) return fail(new Error("音声エンジンの応答が大きすぎます。"));
        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0,index).trim(); buffer = buffer.slice(index+1);
          try {
            const m = JSON.parse(line);
            if (!m || typeof m.type !== "string") throw new Error("音声エンジンの応答形式が正しくありません。");
            if (m.type === "fatal") throw new Error(`音声エンジンを起動できません: ${m.error?.message || "モデルを確認してください。"}`);
            if (m.type === "ready") {
              if (settled || m.protocol !== 3 || m.version !== "0.8.3" || m.model?.sample_rate !== 48000) throw new Error("音声エンジンのバージョンまたはモデルが対応していません。");
              clearTimeout(timer); settled = true; this.sampleRate = m.model.sample_rate; resolve(m); continue;
            }
            if (!settled) throw new Error("音声エンジンが起動前に応答しました。");
            this.message(m);
          } catch (error) { fail(error); return; }
        }
      });
      child.stderr.on("data", data => { stderr = (stderr + data).slice(-2000); });
      child.on("error", () => fail(new Error("音声エンジンを起動できません。実行ファイルとGPUドライバーを確認してください。")));
      child.on("exit", code => fail(new Error(`音声エンジンが停止しました (${code})。${stderr.slice(-600)}`)));
      child.stdin.on("error", () => fail(new Error("音声エンジンとの接続が切れました。")));
    });
    this.ready.catch(() => {});
    return this.ready;
  }
  failRequests(error) {
    for (const stream of this.streams.values()) { if (stream.req) { stream.req.error = error; stream.req.notify?.(); } }
    for (const req of this.requests.values()) { clearTimeout(req.timer); req.error = error; req.ended = true; req.notify?.(); }
    this.requests.clear();
  }
  message(m) {
    if (typeof m.id !== "string") throw new Error(m.error?.message || "音声エンジンの応答に識別子がありません。");
    const req = this.requests.get(m.id);
    // Cancelled requests may still emit chunks before their terminal message.
    if (!req) return;
    if (m.type === "progress") return;
    if (m.type === "chunk") {
      if (m.seq !== req.seq++ || typeof m.pcm !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.pcm)) throw new Error("音声データの順序または形式が正しくありません。");
      const size = Buffer.byteLength(m.pcm, "base64");
      if (!size || size % 2) throw new Error("音声データの長さが正しくありません。");
      req.bytes += size;
      if (req.buffered > this.maxBufferedBytes || req.bytes > 64 * 1024 * 1024) throw new Error("音声データが長すぎます。");
      const output = req.durationProbe ? Buffer.alloc(0) : req.tailGate ? pcmBuffer(req.tailGate.push(pcmFloats(Buffer.from(m.pcm, "base64")))) : Buffer.from(m.pcm, "base64");
      if (output.length) {
        if (req.buffered + output.length > this.maxBufferedBytes) throw new Error("音声データが長すぎます。");
        req.queue.push(output.toString("base64")); req.buffered += output.length;
      }
    } else if (["end", "error", "cancelled"].includes(m.type)) {
      req.ended = true; clearTimeout(req.timer); this.requests.delete(m.id);
      if (m.type === "end" && (m.samples !== req.bytes / 2 || m.stop !== "complete")) req.error = new Error("音声の生成が途中で終了しました。短い文で再試行してください。");
      if (m.type === "end" && !req.error && req.tailGate) {
        const output = pcmBuffer(req.tailGate.finish());
        if (output.length) {
          if (req.buffered + output.length > this.maxBufferedBytes) throw new Error("音声データが長すぎます。");
          req.queue.push(output.toString("base64")); req.buffered += output.length;
        }
      }
      if (m.type === "error") req.error = new Error(`音声を生成できません: ${m.error?.message || "設定を確認してください。"}`);
      if (m.type === "cancelled") { req.queue = []; req.cancelled = true; }
    } else throw new Error("音声エンジンから未対応の応答が届きました。");
    req.notify?.();
  }
  write(message) { this.worker?.stdin.write(`${JSON.stringify(message)}\n`); }
  async start({ ownerId, chunks, ...options }) {
    // Warmup is shared, but cancelling this owner settles immediately.
    const warming = Promise.all([this.ensureWorker(options), loadTailHelpers()]);
    const id = `speech-cpp-stream-${randomUUID()}`;
    const stream = { id, ownerId, options, chunks, index: 0, req: null, cancelled: false, timer: null, reading: false };
    this.streams.set(id, stream);
    const cancelled = new Promise(resolve => { stream.wakeCancel = () => resolve(false); });
    try {
      const ready = await Promise.race([warming, cancelled]);
      if (!ready || stream.cancelled) return { audioDataUrls: [], done: true };
      stream.tailHelpers = ready[1];
      const first = await this.next(id, ownerId);
      return { ...first, audioDataUrls: first.audioDataUrl ? [first.audioDataUrl] : [], audioTexts: [first.audioText || ""], streamId: first.done ? "" : id };
    } catch (error) { this.cancel(id, ownerId); throw error; }
  }
  async next(id, ownerId) {
    const stream = this.streams.get(String(id));
    if (!stream || stream.ownerId !== ownerId || stream.cancelled) return { done: true };
    if (stream.reading) throw new Error("音声の続きを重複して要求しました。");
    clearTimeout(stream.timer); stream.reading = true;
    try {
      while (!stream.cancelled) {
        if (!stream.req) {
          const chunk = stream.chunk ||= stream.chunks[stream.index++];
          if (!chunk) { this.cancel(id, ownerId); return { done: true }; }
          const req = { id: randomUUID(), text: chunk.text, queue: [], buffered: 0, bytes: 0, seq: 0, ended: false, notify: null };
          const speed = Math.min(2,Math.max(.5,Number(stream.options.playbackRate)||1));
          const guard = stream.options.mode !== "design" && stream.options.guardReferenceDuration !== false;
          const durationKey = JSON.stringify([this.key, chunk.text]);
          const predictedSeconds = this.durationCache.get(durationKey);
          if (guard && !predictedSeconds) { req.durationProbe = true; req.durationKey = durationKey; }
          if (!req.durationProbe && stream.options.trimTrailingUtterance !== false) {
            req.tailGate = new stream.tailHelpers.Gate(this.sampleRate, {
              cleanEndpoint: true, removeResumedSpeech: stream.tailHelpers.shouldTrim(chunk.text),
            });
          }
          stream.req = req; this.requests.set(req.id, req);
          req.timer = setTimeout(() => { req.error = new Error("音声の生成が時間切れになりました。"); this.cancel(id, ownerId); req.notify?.(); }, this.requestTimeoutMs);
          // Real synthesis uses the selected model's saved steps. MF defaults to
          // six after a short-sentence regression; private timing stays at one.
          const message = { type: "synthesize", id: req.id, text: chunk.text, voice: stream.options.mode === "design" ? "none" : "character", instructions: chunk.instructions || "", speed, steps: speechCppSteps(stream.options.steps, stream.options.variant === "small" ? 16 : 6) };
          if (Number.isInteger(stream.options.seed) && stream.options.seed >= 0) message.seed = stream.options.seed;
          if (req.durationProbe) Object.assign(message, { voice: "none", instructions: "", steps: 1, keep_tail: true, speed: 1 });
          else if (guard && predictedSeconds) {
            // Probe at normal speed to avoid the predictor's short-duration limit.
            // Native divides fixed seconds by speed once; do not apply it twice.
            message.seconds = Math.max(.5 * speed, predictedSeconds);
          }
          this.write(message);
        }
        const req = stream.req;
        if (req.error) throw req.error;
        if (req.queue.length) {
          const pcmChunk = req.queue.shift(); req.buffered -= Buffer.byteLength(pcmChunk,"base64");
          stream.timer = setTimeout(() => this.cancel(id, ownerId), this.idleTimeoutMs);
          return { pcmChunk, sampleRate: this.sampleRate, audioDataUrl: waveDataUrl(pcmChunk,this.sampleRate), audioText: req.text, playbackRate: 1, done: false };
        }
        if (req.ended) {
          if (req.durationProbe) {
            // Use only the text's learned timing. The reference and caption still
            // condition the real synthesis, but cannot allocate a hallucinated tail.
            const seconds = req.bytes / (this.sampleRate * 2);
            if (!(seconds >= .5 && seconds <= 30)) throw new Error("発話の長さを見積もれませんでした。");
            this.durationCache.set(req.durationKey, seconds);
            if (this.durationCache.size > 128) this.durationCache.delete(this.durationCache.keys().next().value);
          } else stream.chunk = null;
          stream.req = null; continue;
        }
        await new Promise(resolve => { req.notify = resolve; });
        req.notify = null;
      }
      if (stream.req?.error) throw stream.req.error;
      return { done: true };
    } finally { stream.reading = false; }
  }
  cancel(id, ownerId) {
    const stream = this.streams.get(String(id));
    if (!stream || stream.ownerId !== ownerId) return false;
    this.streams.delete(String(id)); stream.cancelled = true; clearTimeout(stream.timer); stream.wakeCancel?.();
    if (stream.req) {
      this.write({ type: "cancel", id: stream.req.id });
      clearTimeout(stream.req.timer); this.requests.delete(stream.req.id); stream.req.queue = []; stream.req.notify?.();
    }
    return true;
  }
  cancelOwner(ownerId) { let cancelled = false; for (const stream of [...this.streams.values()]) if (stream.ownerId === ownerId) cancelled = this.cancel(stream.id,ownerId) || cancelled; return cancelled; }
  stop() {
    for (const stream of [...this.streams.values()]) this.cancel(stream.id,stream.ownerId);
    this.failRequests(new Error("音声エンジンを終了しました。"));
    this.stopStartup?.(); this.stopStartup = null;
    const child = this.worker; this.worker = null; this.key = ""; this.ready = null; child?.kill();
  }
}
module.exports = { SpeechCppClient, speechCppStatus, waveDataUrl };
