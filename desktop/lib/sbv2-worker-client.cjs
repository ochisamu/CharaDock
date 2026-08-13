// SPDX-License-Identifier: Apache-2.0
const { fork } = require("node:child_process");
const path = require("node:path");

function isBenignOrtAssignmentWarning(value) {
  return /VerifyEachNodeIsAssignedToAnEp|Some nodes were not assigned|Rerunning with verbose output|shape related ops to CPU|negative impact on performance/i.test(String(value || ""));
}

function createStderrCollector(log, delayMs = 100) {
  let buffer = "";
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const text = buffer.trim();
    buffer = "";
    if (text && !isBenignOrtAssignmentWarning(text)) log(text);
  };
  return {
    push(chunk) {
      buffer += String(chunk || "");
      clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}

class Sbv2WorkerClient {
  constructor({
    executablePath = process.execPath,
    workerPath = path.join(__dirname, "sbv2-worker.cjs"),
    cacheDirectory,
    forkImpl = fork,
    onProgress = null,
  } = {}) {
    this.executablePath = executablePath;
    this.workerPath = workerPath;
    this.cacheDirectory = String(cacheDirectory || "");
    this.forkImpl = forkImpl;
    this.onProgress = onProgress;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stderrCollector = null;
  }

  ensureStarted() {
    if (this.child?.connected) return this.child;
    const child = this.forkImpl(this.workerPath, [], {
      execPath: this.executablePath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CHARADOCK_SBV2_CACHE_DIR: this.cacheDirectory },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "json",
      windowsHide: true,
    });
    this.child = child;
    const stderrCollector = createStderrCollector((text) => console.warn(`JP-Extra worker: ${text}`));
    this.stderrCollector = stderrCollector;
    child.stderr?.on("data", (chunk) => stderrCollector.push(chunk));
    child.on("message", (message) => this.handleMessage(message));
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code, signal) => {
      stderrCollector.flush();
      if (this.stderrCollector === stderrCollector) this.stderrCollector = null;
      if (this.child === child) this.child = null;
      this.rejectAll(new Error(`JP-Extraワーカーが停止しました（${signal || code || "unknown"}）。`));
    });
    return child;
  }

  handleMessage(message) {
    if (message?.event === "progress") {
      this.onProgress?.({ ...message, id: undefined });
      return;
    }
    if (message?.event !== "result") return;
    const pending = this.pending.get(String(message.id || ""));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(String(message.id));
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(String(message.error || "JP-Extraワーカーでエラーが発生しました。")));
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(type, payload = {}, timeoutMs = 300_000) {
    const child = this.ensureStarted();
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("JP-Extraの処理が時間切れになりました。"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ id, type, payload }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  inspect(modelPath) { return this.request("inspect", { modelPath }, 60_000); }
  prewarm(payload) { return this.request("prewarm", payload, 300_000); }
  synthesize(payload) { return this.request("synthesize", payload, 300_000); }
  release() { return this.child?.connected ? this.request("release", {}, 30_000) : Promise.resolve({ released: true }); }

  stop() {
    const child = this.child;
    this.child = null;
    this.stderrCollector?.flush();
    this.stderrCollector = null;
    this.rejectAll(new Error("JP-Extraワーカーを終了しました。"));
    if (child?.connected) child.disconnect();
    setTimeout(() => { if (!child?.killed) child?.kill(); }, 3000).unref?.();
  }
}

module.exports = { Sbv2WorkerClient, createStderrCollector, isBenignOrtAssignmentWarning };
