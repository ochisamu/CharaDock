// SPDX-License-Identifier: Apache-2.0
const { handleCaptureFrame, resetCaptureQueue } = require("./device-capture-queue.cjs");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const net = require("node:net");
const {
  AtomEchoFrameDecoder,
  DEVICE_STATES,
  FRAME_TYPES,
  captureConfigPayload,
  encodeFrame,
  normalizeVadThreshold,
  parseAck,
  parseCaptureStatus,
} = require("./atom-echo-protocol.cjs");

const DEFAULT_DISCOVERY_PORT = 41721;
const DEFAULT_AUDIO_PORT = 41722;
const DISCOVERY_PREFIX = "CHARADOCK_ATOM_DISCOVER_V1 ";
const HOST_PREFIX = "CHARADOCK_ATOM_HOST_V1 ";
const PLAYBACK_CHUNK_BYTES = 1024;
const PLAYBACK_ACK_WINDOW = 6;

function validDeviceId(value) {
  return /^atom-echo-[a-f0-9]{12}$/.test(String(value || "").toLowerCase());
}

class AtomEchoWifiGateway {
  constructor({
    discoveryPort = DEFAULT_DISCOVERY_PORT,
    audioPort = DEFAULT_AUDIO_PORT,
    host = "0.0.0.0",
    onPttStart = async () => {},
    onPcmChunk = async () => {},
    onPttEnd = async () => {},
    onInterrupt = async () => {},
    onCaptureStatus = async () => {},
    onStatus = () => {},
    logger = null,
  } = {}) {
    this.discoveryPort = discoveryPort;
    this.audioPort = audioPort;
    this.host = host;
    this.callbacks = { onPttStart, onPcmChunk, onPttEnd, onInterrupt, onCaptureStatus, onStatus };
    this.logger = logger;
    this.enabled = false;
    this.expectedDeviceId = "";
    this.pairingToken = "";
    this.connectionState = "off";
    this.deviceState = "idle";
    this.lastError = "";
    this.deviceInfo = null;
    this.captureMode = "push-to-talk";
    this.vadThreshold = 120;
    this.remoteAddress = "";
    this.udpSocket = null;
    this.tcpServer = null;
    this.candidates = new Set();
    this.activeCandidate = null;
    this.sequence = 0;
    this.pendingAcks = new Map();
    this.playbackGeneration = 0;
    this.playbackChunkAcks = [];
    this.captureQueue = Promise.resolve();
    this.interactionActive = false;
  }

  status() {
    return {
      enabled: this.enabled,
      connectionState: this.connectionState,
      deviceState: this.deviceState,
      connected: this.connectionState === "ready" && Boolean(this.activeCandidate?.socket),
      device: this.deviceInfo ? { ...this.deviceInfo } : null,
      deviceId: this.expectedDeviceId,
      remoteAddress: this.remoteAddress,
      discoveryPort: this.udpSocket?.address?.().port || this.discoveryPort,
      audioPort: this.tcpServer?.address?.()?.port || this.audioPort,
      error: this.lastError,
      transport: "wifi",
      vadThreshold: this.vadThreshold,
    };
  }

  notify() {
    this.callbacks.onStatus(this.status());
  }

  log(level, event, detail = {}) {
    this.logger?.(level, event, detail);
  }

  async configure({ enabled, deviceId = "", token = "", captureMode = this.captureMode, vadThreshold = this.vadThreshold } = {}) {
    this.enabled = enabled === true;
    this.captureMode = captureMode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    this.expectedDeviceId = validDeviceId(deviceId) ? String(deviceId).toLowerCase() : "";
    this.pairingToken = /^[a-f0-9]{64}$/.test(String(token || "").toLowerCase()) ? String(token).toLowerCase() : "";
    if (!this.enabled) {
      await this.disconnect();
      return this.status();
    }
    if (!this.tcpServer || !this.udpSocket) await this.start();
    this.connectionState = this.activeCandidate ? "ready" : this.expectedDeviceId && this.pairingToken ? "waiting" : "setup-required";
    this.lastError = "";
    this.notify();
    return this.status();
  }

  async start() {
    await this.stopServers();
    try {
      const tcpServer = net.createServer((socket) => this.acceptSocket(socket));
      await new Promise((resolve, reject) => {
        tcpServer.once("error", reject);
        tcpServer.listen(this.audioPort, this.host, () => {
          tcpServer.off("error", reject);
          resolve();
        });
      });
      this.tcpServer = tcpServer;
      tcpServer.on("error", (error) => this.serverFailure(error));

      const udpSocket = dgram.createSocket("udp4");
      await new Promise((resolve, reject) => {
        udpSocket.once("error", reject);
        udpSocket.bind(this.discoveryPort, this.host, () => {
          udpSocket.off("error", reject);
          resolve();
        });
      });
      this.udpSocket = udpSocket;
      udpSocket.on("error", (error) => this.serverFailure(error));
      udpSocket.on("message", (message, remote) => this.handleDiscovery(message, remote));
      this.connectionState = this.expectedDeviceId && this.pairingToken ? "waiting" : "setup-required";
      this.lastError = "";
      this.notify();
      this.log("info", "atom-echo-wifi-listening", {
        discoveryPort: udpSocket.address().port,
        audioPort: tcpServer.address().port,
      });
    } catch (error) {
      await this.stopServers();
      this.connectionState = "error";
      this.lastError = `ATOM Echoの無線待受を開始できません: ${String(error?.message || error)}`;
      this.notify();
      throw error;
    }
  }

  handleDiscovery(message, remote) {
    if (!this.enabled || !this.expectedDeviceId || !this.pairingToken || !this.udpSocket || !this.tcpServer) return;
    const request = message.toString("utf8").trim();
    if (request !== `${DISCOVERY_PREFIX}${this.expectedDeviceId}`) return;
    const response = Buffer.from(`${HOST_PREFIX}${this.tcpServer.address().port}`, "utf8");
    this.udpSocket.send(response, remote.port, remote.address, (error) => {
      if (error) this.log("warn", "atom-echo-wifi-discovery-reply-failed", { error: error.message });
    });
  }

  acceptSocket(socket) {
    if (!this.enabled || !this.expectedDeviceId || !this.pairingToken) {
      socket.destroy();
      return;
    }
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 5_000);
    const candidate = {
      socket,
      decoder: new AtomEchoFrameDecoder({ maxPayloadBytes: 2_048 }),
      challenge: crypto.randomBytes(32),
      deviceInfo: null,
      authenticated: false,
      timer: null,
    };
    this.candidates.add(candidate);
    candidate.timer = setTimeout(() => this.rejectCandidate(candidate, "authentication timeout"), 6_000);
    candidate.timer.unref?.();
    socket.on("data", (chunk) => this.receiveCandidate(candidate, chunk));
    socket.on("error", (error) => this.closeCandidate(candidate, error));
    socket.on("close", () => this.closeCandidate(candidate));
  }

  receiveCandidate(candidate, chunk) {
    if (!this.candidates.has(candidate) || candidate.socket.destroyed) return;
    for (const frame of candidate.decoder.push(chunk)) {
      if (!candidate.authenticated) this.handleAuthenticationFrame(candidate, frame);
      else if (candidate === this.activeCandidate) this.handleFrame(frame);
    }
  }

  handleAuthenticationFrame(candidate, frame) {
    if (frame.type === FRAME_TYPES.DEVICE_HELLO) {
      let info = {};
      try { info = JSON.parse(frame.payload.toString("utf8")); } catch {}
      if (String(info.deviceId || "").toLowerCase() !== this.expectedDeviceId) {
        this.rejectCandidate(candidate, "unexpected device");
        return;
      }
      candidate.deviceInfo = info;
      this.writeCandidateFrame(candidate, FRAME_TYPES.AUTH_CHALLENGE, candidate.challenge).catch(() => this.rejectCandidate(candidate, "challenge write failed"));
      return;
    }
    if (frame.type !== FRAME_TYPES.DEVICE_AUTH || !candidate.deviceInfo || frame.payload.length !== 32) return;
    const expected = crypto.createHmac("sha256", Buffer.from(this.pairingToken, "hex")).update(candidate.challenge).digest();
    if (!crypto.timingSafeEqual(expected, frame.payload)) {
      this.rejectCandidate(candidate, "authentication failed");
      return;
    }
    clearTimeout(candidate.timer);
    candidate.timer = null;
    candidate.authenticated = true;
    if (this.activeCandidate && this.activeCandidate !== candidate) this.activeCandidate.socket.destroy();
    resetCaptureQueue(this);
    this.activeCandidate = candidate;
    this.deviceInfo = candidate.deviceInfo;
    this.remoteAddress = String(candidate.socket.remoteAddress || "").replace(/^::ffff:/, "");
    this.connectionState = "ready";
    this.lastError = "";
    this.notify();
    this.log("info", "atom-echo-wifi-ready", { deviceId: this.expectedDeviceId, address: this.remoteAddress });
    this.writeFrame(FRAME_TYPES.HOST_HELLO, Buffer.from(JSON.stringify({ protocol: 1, host: "CharaDock", transport: "wifi" }), "utf8"))
      .then(() => this.setDeviceState(this.deviceState))
      .then(() => this.setCaptureMode(this.captureMode, this.vadThreshold))
      .catch((error) => { if (this.activeCandidate === candidate) this.activeFailure(error); });
  }

  rejectCandidate(candidate, reason) {
    this.log("warn", "atom-echo-wifi-auth-rejected", { reason, address: candidate.socket.remoteAddress });
    candidate.socket.destroy();
  }

  closeCandidate(candidate, error = null) {
    clearTimeout(candidate.timer);
    candidate.timer = null;
    this.candidates.delete(candidate);
    if (candidate !== this.activeCandidate) return;
    resetCaptureQueue(this);
    this.activeCandidate = null;
    this.deviceInfo = null;
    this.remoteAddress = "";
    this.rejectPending("ATOM Echoとの無線接続が切れました。");
    if (this.enabled && this.interactionActive) {
      this.interactionActive = false;
      Promise.resolve(this.callbacks.onInterrupt()).catch(() => {});
    }
    if (!this.enabled) return;
    this.connectionState = "waiting";
    this.lastError = error ? String(error.message || error) : "";
    this.notify();
  }

  serverFailure(error) {
    if (!this.enabled) return;
    this.connectionState = "error";
    this.lastError = String(error?.message || error);
    this.notify();
    this.log("warn", "atom-echo-wifi-server-error", { error: this.lastError });
  }

  activeFailure(error) {
    this.lastError = String(error?.message || error);
    this.notify();
    this.activeCandidate?.socket.destroy();
  }

  nextSequence() {
    this.sequence = (this.sequence + 1) & 0xffff;
    return this.sequence;
  }

  async writeCandidateFrame(candidate, type, payload) {
    if (!candidate?.socket || candidate.socket.destroyed) throw new Error("ATOM Echoの無線接続がありません。");
    const frame = encodeFrame(type, this.nextSequence(), payload);
    await new Promise((resolve, reject) => candidate.socket.write(frame, (error) => error ? reject(error) : resolve()));
  }

  async writeFrame(type, payload, { waitForAck = false, timeoutMs = 4_000 } = {}) {
    const candidate = this.activeCandidate;
    if (!candidate?.socket || candidate.socket.destroyed) throw new Error("ATOM Echoが無線接続されていません。");
    const sequence = this.nextSequence();
    const frame = encodeFrame(type, sequence, payload);
    let ackPromise = null;
    if (waitForAck) {
      const key = `${type}:${sequence}`;
      ackPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingAcks.delete(key);
          reject(new Error("ATOM Echoの無線音声転送が時間切れになりました。"));
        }, timeoutMs);
        timer.unref?.();
        this.pendingAcks.set(key, { resolve, reject, timer });
      });
    }
    await new Promise((resolve, reject) => candidate.socket.write(frame, (error) => error ? reject(error) : resolve()));
    return ackPromise || sequence;
  }

  handleFrame(frame) {
    if (frame.type === FRAME_TYPES.ACK) {
      const ack = parseAck(frame.payload);
      const key = ack ? `${ack.type}:${ack.sequence}` : "";
      const pending = this.pendingAcks.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAcks.delete(key);
        pending.resolve(ack);
      }
      return;
    }
    if (frame.type === FRAME_TYPES.PTT_START) this.interactionActive = true;
    if (handleCaptureFrame(this, frame, FRAME_TYPES)) return;
    if (frame.type === FRAME_TYPES.INTERRUPT) {
      resetCaptureQueue(this);
      this.playbackGeneration += 1;
      this.playbackChunkAcks = [];
      this.interactionActive = false;
      Promise.resolve(this.callbacks.onInterrupt()).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (frame.type === FRAME_TYPES.CAPTURE_STATUS) {
      const status = parseCaptureStatus(frame.payload);
      if (status) Promise.resolve(this.callbacks.onCaptureStatus(status)).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (frame.type === FRAME_TYPES.ERROR) {
      this.lastError = frame.payload.toString("utf8").slice(0, 300) || "ATOM Echoでエラーが発生しました。";
      this.notify();
    }
  }

  reportCallbackError(error) {
    this.lastError = String(error?.message || error);
    this.setDeviceState("error").catch(() => {});
    this.notify();
    this.log("warn", "atom-echo-wifi-callback-failed", { error: this.lastError });
  }

  rejectPending(message) {
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pendingAcks.clear();
  }

  async setDeviceState(state) {
    const normalized = Object.prototype.hasOwnProperty.call(DEVICE_STATES, state) ? state : "idle";
    this.deviceState = normalized;
    if (normalized === "idle") this.interactionActive = false;
    this.notify();
    if (this.status().connected) await this.writeFrame(FRAME_TYPES.STATE, Buffer.from([DEVICE_STATES[normalized]]));
  }

  async setCaptureMode(mode, vadThreshold = this.vadThreshold) {
    this.captureMode = mode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    const supportsCaptureConfig = String(this.deviceInfo?.firmware || "").includes("handsfree");
    const supportsVadThreshold = String(this.deviceInfo?.firmware || "").includes("handsfree-vad");
    if (this.captureMode === "hands-free" && this.deviceInfo && !supportsCaptureConfig) {
      throw new Error("ハンズフリー対応のATOM Echoファームウェアへ更新してください。");
    }
    if (this.status().connected) {
      await this.writeFrame(
        FRAME_TYPES.CAPTURE_CONFIG,
        captureConfigPayload(this.captureMode, this.vadThreshold, { includeThreshold: supportsVadThreshold }),
        { waitForAck: supportsCaptureConfig },
      );
    }
    return this.captureMode;
  }

  async stopPlayback() {
    this.playbackGeneration += 1;
    this.playbackChunkAcks = [];
    this.interactionActive = false;
    if (this.status().connected) await this.writeFrame(FRAME_TYPES.AUDIO_STOP).catch(() => {});
    await this.setDeviceState("idle").catch(() => {});
  }

  async beginPcm16Playback(sampleRate = 16_000) {
    const generation = ++this.playbackGeneration;
    this.playbackChunkAcks = [];
    await this.setDeviceState("speaking");
    const begin = Buffer.allocUnsafe(8);
    begin.writeUInt32LE(Math.round(Number(sampleRate) || 16_000), 0);
    // The firmware streams AUDIO_CHUNK frames directly to I2S. A sentinel
    // keeps the framing compatible with finite WAV playback while allowing a
    // Realtime answer whose final length is not known at AUDIO_BEGIN.
    begin.writeUInt32LE(0xffffffff, 4);
    await this.writeFrame(FRAME_TYPES.AUDIO_BEGIN, begin, { waitForAck: true });
    return generation;
  }

  trackPlaybackChunkAck(ackPromise, generation) {
    const tracked = Promise.resolve(ackPromise).then(
      () => ({ generation, error: null }),
      (error) => ({ generation, error }),
    );
    this.playbackChunkAcks.push(tracked);
  }

  async waitForOldestPlaybackChunkAck(generation) {
    const tracked = this.playbackChunkAcks.shift();
    if (!tracked) return;
    const result = await tracked;
    if (generation !== this.playbackGeneration || result.generation !== generation) return;
    if (result.error) throw result.error;
  }

  async flushPlaybackChunkAcks(generation) {
    while (this.playbackChunkAcks.length) {
      await this.waitForOldestPlaybackChunkAck(generation);
      if (generation !== this.playbackGeneration) return;
    }
  }

  async writePcm16PlaybackChunk(pcm, generation) {
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2 || bytes.length > PLAYBACK_CHUNK_BYTES) {
      throw new Error("ATOM Echoへ送るPCM音声チャンクが正しくありません。");
    }
    if (generation !== this.playbackGeneration) return { interrupted: true };
    this.trackPlaybackChunkAck(
      this.writeFrame(FRAME_TYPES.AUDIO_CHUNK, bytes, { waitForAck: true }),
      generation,
    );
    if (this.playbackChunkAcks.length >= PLAYBACK_ACK_WINDOW) {
      await this.waitForOldestPlaybackChunkAck(generation);
    }
    return { interrupted: generation !== this.playbackGeneration };
  }

  async endPcm16Playback(generation) {
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.flushPlaybackChunkAcks(generation);
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.writeFrame(FRAME_TYPES.AUDIO_END, null, { waitForAck: true });
    this.interactionActive = false;
    if (generation === this.playbackGeneration) await this.setDeviceState("idle");
    return { interrupted: generation !== this.playbackGeneration };
  }

  async playPcm16(pcm, sampleRate = 16_000) {
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2) throw new Error("ATOM Echoへ送るPCM音声が正しくありません。");
    const generation = await this.beginPcm16Playback(sampleRate);
    for (let offset = 0; offset < bytes.length; offset += PLAYBACK_CHUNK_BYTES) {
      if (generation !== this.playbackGeneration) return { interrupted: true };
      const result = await this.writePcm16PlaybackChunk(bytes.subarray(offset, offset + PLAYBACK_CHUNK_BYTES), generation);
      if (result.interrupted) return result;
    }
    return this.endPcm16Playback(generation);
  }

  async stopServers() {
    resetCaptureQueue(this);
    for (const candidate of this.candidates) {
      clearTimeout(candidate.timer);
      candidate.socket.destroy();
    }
    this.candidates.clear();
    this.activeCandidate = null;
    this.rejectPending("ATOM Echoの無線待受を停止しました。");
    const udpSocket = this.udpSocket;
    const tcpServer = this.tcpServer;
    this.udpSocket = null;
    this.tcpServer = null;
    if (udpSocket) await new Promise((resolve) => { try { udpSocket.close(resolve); } catch { resolve(); } });
    if (tcpServer) await new Promise((resolve) => { try { tcpServer.close(resolve); } catch { resolve(); } });
  }

  async disconnect() {
    this.enabled = false;
    this.playbackGeneration += 1;
    this.interactionActive = false;
    await this.stopServers();
    this.connectionState = "off";
    this.deviceInfo = null;
    this.remoteAddress = "";
    this.lastError = "";
    this.notify();
  }
}

module.exports = {
  AtomEchoWifiGateway,
  DEFAULT_AUDIO_PORT,
  DEFAULT_DISCOVERY_PORT,
  DISCOVERY_PREFIX,
  HOST_PREFIX,
  PLAYBACK_ACK_WINDOW,
  validDeviceId,
};
