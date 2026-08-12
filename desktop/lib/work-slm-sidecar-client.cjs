// SPDX-License-Identifier: Apache-2.0
const { spawn } = require("node:child_process");

const SIDECAR_CHANNEL = "charadock-work-slm-sidecar";

class WorkSlmSidecarClient {
  constructor({
    executablePath,
    appPath = "",
    userDataPath,
    packaged = false,
    spawnImpl = spawn,
    onProgress = () => {},
    onAvailability = () => {},
    onExit = () => {},
    onStderr = () => {},
  } = {}) {
    this.executablePath = executablePath;
    this.appPath = appPath;
    this.userDataPath = userDataPath;
    this.packaged = Boolean(packaged);
    this.spawnImpl = spawnImpl;
    this.onProgress = onProgress;
    this.onAvailability = onAvailability;
    this.onExit = onExit;
    this.onStderr = onStderr;
    this.child = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stopping = false;
  }

  start() {
    if (this.child && this.readyPromise) return this.readyPromise;
    this.stopping = false;
    const args = [
      ...(!this.packaged && this.appPath ? [this.appPath] : []),
      "--work-slm-sidecar",
      "--work-slm-user-data",
      this.userDataPath,
    ];
    const child = this.spawnImpl(this.executablePath, args, {
      env: { ...process.env },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    });
    this.child = child;
    this.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("Work SLMサイドカーの起動が時間切れになりました。");
        reject(error);
        if (this.child === child && !child.killed) child.kill();
      }, 20_000);
      this.resolveReady = (payload) => { clearTimeout(timer); resolve(payload); };
      this.rejectReady = (error) => { clearTimeout(timer); reject(error); };
    });
    child.on("message", (message) => this.handleMessage(message));
    child.stderr?.on("data", (chunk) => this.onStderr(String(chunk || "").trim()));
    child.on("error", (error) => this.handleExit(error));
    child.on("exit", (code, signal) => this.handleExit(new Error(`Work SLMサイドカーが停止しました（${signal ?? code ?? "unknown"}）。`)));
    return this.readyPromise;
  }

  handleMessage(message) {
    if (message?.channel !== SIDECAR_CHANNEL) return;
    if (message.event === "ready") {
      this.onAvailability(message.payload || {});
      this.resolveReady?.(message.payload || {});
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.event === "progress") {
      this.onProgress(message.payload || {});
      return;
    }
    if (message.event !== "result") return;
    const requestId = String(message.payload?.requestId || "");
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (message.payload.error) pending.reject(Object.assign(new Error(String(message.payload.error)), {
      errorKind: String(message.payload.errorKind || ""),
      diagnosticOutput: String(message.payload.diagnosticOutput || ""),
    }));
    else pending.resolve(message.payload);
  }

  handleExit(error) {
    if (!this.child) return;
    this.child = null;
    this.readyPromise = null;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onExit(error, this.stopping);
  }

  async request(action, payload = {}, { timeoutMs = 5_000, allowDownload = false } = {}) {
    await this.start();
    const child = this.child;
    if (!child?.connected || typeof child.send !== "function") throw new Error("Work SLMサイドカーへ接続できません。");
    const requestId = `work-slm-${Date.now()}-${this.nextId++}`;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Work SLMの応答が時間切れになりました。"));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    try {
      child.send({
        channel: SIDECAR_CHANNEL,
        event: "request",
        payload: { requestId, action, allowDownload, ...payload },
      });
    } catch (error) {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      clearTimeout(pending?.timer);
      pending?.reject(error);
    }
    return result;
  }

  stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    if (child.connected) child.send({ channel: SIDECAR_CHANNEL, event: "shutdown" });
    setTimeout(() => { if (this.child === child && !child.killed) child.kill(); }, 2_000).unref?.();
  }
}

module.exports = { SIDECAR_CHANNEL, WorkSlmSidecarClient };
