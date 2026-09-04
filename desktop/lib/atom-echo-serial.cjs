// SPDX-License-Identifier: Apache-2.0
const { handleCaptureFrame, resetCaptureQueue } = require("./device-capture-queue.cjs");
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

const DEFAULT_BAUD_RATE = 500_000;
const PLAYBACK_CHUNK_BYTES = 1024;

function publicPort(port = {}) {
  return {
    path: String(port.path || "").slice(0, 120),
    manufacturer: String(port.manufacturer || "").slice(0, 120),
    vendorId: String(port.vendorId || "").toLowerCase().slice(0, 8),
    productId: String(port.productId || "").toLowerCase().slice(0, 8),
    friendlyName: String(port.friendlyName || port.pnpId || "").slice(0, 180),
  };
}

function likelyAtomEchoPort(port = {}) {
  const item = publicPort(port);
  return item.vendorId === "0403" && item.productId === "6001";
}

class AtomEchoSerialGateway {
  constructor({
    SerialPortClass = null,
    listPorts = null,
    onPttStart = async () => {},
    onPcmChunk = async () => {},
    onPttEnd = async () => {},
    onInterrupt = async () => {},
    onWifiStatus = async () => {},
    onCaptureStatus = async () => {},
    onStatus = () => {},
    logger = null,
  } = {}) {
    this.SerialPortClass = SerialPortClass;
    this.listPortsOverride = listPorts;
    this.callbacks = { onPttStart, onPcmChunk, onPttEnd, onInterrupt, onWifiStatus, onCaptureStatus, onStatus };
    this.logger = logger;
    this.enabled = false;
    this.requestedPort = "";
    this.portPath = "";
    this.connectionState = "off";
    this.deviceState = "idle";
    this.lastError = "";
    this.deviceInfo = null;
    this.captureMode = "push-to-talk";
    this.vadThreshold = 120;
    this.port = null;
    this.intentionalCloses = new WeakSet();
    this.decoder = new AtomEchoFrameDecoder();
    this.sequence = 0;
    this.pendingAcks = new Map();
    this.reconnectTimer = null;
    this.connectGeneration = 0;
    this.playbackGeneration = 0;
    this.captureQueue = Promise.resolve();
  }

  async serialApi() {
    if (this.SerialPortClass) return { SerialPort: this.SerialPortClass };
    // Keep native serial bindings out of test and non-Windows startup paths
    // until the user explicitly enables the hardware adapter.
    const api = require("serialport");
    this.SerialPortClass = api.SerialPort;
    return api;
  }

  async listPorts() {
    const raw = this.listPortsOverride
      ? await this.listPortsOverride()
      : await (await this.serialApi()).SerialPort.list();
    return (Array.isArray(raw) ? raw : []).map(publicPort).filter((port) => port.path);
  }

  status() {
    return {
      enabled: this.enabled,
      requestedPort: this.requestedPort,
      port: this.portPath,
      connectionState: this.connectionState,
      deviceState: this.deviceState,
      connected: this.connectionState === "ready",
      device: this.deviceInfo ? { ...this.deviceInfo } : null,
      error: this.lastError,
      vadThreshold: this.vadThreshold,
    };
  }

  notify() {
    this.callbacks.onStatus(this.status());
  }

  log(level, event, detail = {}) {
    this.logger?.(level, event, detail);
  }

  async configure({ enabled, port = "", captureMode = this.captureMode, vadThreshold = this.vadThreshold } = {}) {
    this.enabled = enabled === true;
    this.requestedPort = String(port || "").trim().slice(0, 120);
    this.captureMode = captureMode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    this.connectGeneration += 1;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (!this.enabled) {
      await this.disconnect();
      this.connectionState = "off";
      this.lastError = "";
      this.notify();
      return this.status();
    }
    await this.connect(this.connectGeneration);
    return this.status();
  }

  async selectPort() {
    const ports = await this.listPorts();
    if (this.requestedPort) {
      const exact = ports.find((port) => port.path.toLowerCase() === this.requestedPort.toLowerCase());
      if (!exact) throw new Error(`${this.requestedPort} が見つかりません。ATOM Echoを接続してください。`);
      return exact;
    }
    const candidates = ports.filter(likelyAtomEchoPort);
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) throw new Error("ATOM EchoのUSBシリアルが見つかりません。");
    throw new Error("候補が複数あります。使用するCOMポートを選択してください。");
  }

  async connect(generation = this.connectGeneration) {
    if (!this.enabled || generation !== this.connectGeneration) return;
    await this.disconnect();
    if (!this.enabled || generation !== this.connectGeneration) return;
    this.connectionState = "connecting";
    this.lastError = "";
    this.deviceInfo = null;
    this.notify();
    try {
      const selected = await this.selectPort();
      if (!this.enabled || generation !== this.connectGeneration) return;
      const { SerialPort } = await this.serialApi();
      if (!this.enabled || generation !== this.connectGeneration) return;
      const port = new SerialPort({ path: selected.path, baudRate: DEFAULT_BAUD_RATE, autoOpen: false });
      this.port = port;
      const epoch = this.portEpoch = (this.portEpoch || 0) + 1;
      const current = () => this.port === port && this.portEpoch === epoch;
      this.portPath = selected.path;
      port.on("data", (chunk) => { if (current()) this.receive(chunk); });
      port.on("error", (error) => { if (current()) this.handlePortFailure(error); });
      port.on("close", () => { if (current()) this.handlePortClose(port); });
      await new Promise((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
      if (!this.enabled || generation !== this.connectGeneration) {
        this.intentionalCloses.add(port);
        await new Promise((resolve) => port.close(() => resolve()));
        return;
      }
      await this.writeFrame(FRAME_TYPES.HOST_HELLO, Buffer.from(JSON.stringify({ protocol: 1, host: "CharaDock" }), "utf8"));
      await this.setDeviceState("idle");
      // The firmware replies with DEVICE_HELLO. Keep "connecting" until then,
      // so a serial port occupied by another device never looks ready.
      const helloTimer = setTimeout(() => {
        if (this.enabled && this.port === port && this.connectionState === "connecting") {
          this.handlePortFailure(new Error("ATOM Echoファームウェアから応答がありません。MVPファームを書き込んでください。"));
        }
      }, 3_000);
      helloTimer.unref?.();
    } catch (error) {
      if (!this.enabled || generation !== this.connectGeneration) return;
      this.connectionState = "error";
      this.lastError = String(error?.message || error);
      this.log("warn", "atom-echo-connect-failed", { port: this.requestedPort, error: this.lastError });
      this.notify();
      this.scheduleReconnect(generation);
    }
  }

  scheduleReconnect(generation = this.connectGeneration) {
    if (!this.enabled || generation !== this.connectGeneration || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(generation).catch(() => {});
    }, 2_000);
    this.reconnectTimer.unref?.();
  }

  async disconnect() {
    resetCaptureQueue(this);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.playbackGeneration += 1;
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("ATOM Echoとの接続が切れました。"));
    }
    this.pendingAcks.clear();
    const port = this.port;
    this.port = null;
    this.decoder.reset();
    this.deviceInfo = null;
    this.portPath = "";
    if (port?.isOpen) {
      this.intentionalCloses.add(port);
      await new Promise((resolve) => port.close(() => resolve()));
    }
  }

  handlePortFailure(error) {
    if (!this.enabled) return;
    resetCaptureQueue(this);
    this.decoder.reset();
    this.lastError = String(error?.message || error);
    this.connectionState = "error";
    this.notify();
    this.log("warn", "atom-echo-serial-error", { port: this.portPath, error: this.lastError });
    const generation = this.connectGeneration;
    const port = this.port;
    this.port = null;
    if (port?.isOpen) {
      this.intentionalCloses.add(port);
      port.close(() => {});
    }
    this.scheduleReconnect(generation);
  }

  handlePortClose(port) {
    if (this.intentionalCloses.has(port)) {
      this.intentionalCloses.delete(port);
      return;
    }
    if (this.port !== port) return;
    resetCaptureQueue(this);
    this.decoder.reset();
    if (this.port === port) this.port = null;
    if (!this.enabled) return;
    this.connectionState = "error";
    this.lastError ||= "ATOM Echoとの接続が切れました。再接続しています。";
    this.notify();
    this.scheduleReconnect(this.connectGeneration);
  }

  nextSequence() {
    this.sequence = (this.sequence + 1) & 0xffff;
    return this.sequence;
  }

  async writeFrame(type, payload, { waitForAck = false, timeoutMs = 4_000 } = {}) {
    const port = this.port;
    if (!port?.isOpen) throw new Error("ATOM Echoが接続されていません。");
    const sequence = this.nextSequence();
    const frame = encodeFrame(type, sequence, payload);
    let ackPromise = null;
    if (waitForAck) {
      const key = `${type}:${sequence}`;
      ackPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingAcks.delete(key);
          reject(new Error("ATOM Echoの音声転送が時間切れになりました。"));
        }, timeoutMs);
        this.pendingAcks.set(key, { resolve, reject, timer });
      });
    }
    await new Promise((resolve, reject) => port.write(frame, (error) => error ? reject(error) : resolve()));
    return ackPromise ? ackPromise : sequence;
  }

  receive(chunk) {
    const epoch = this.portEpoch;
    for (const frame of this.decoder.push(chunk)) {
      if (epoch !== this.portEpoch || (this.portEpoch && !this.port)) break;
      this.handleFrame(frame);
    }
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
    if (frame.type === FRAME_TYPES.DEVICE_HELLO) {
      try { this.deviceInfo = JSON.parse(frame.payload.toString("utf8")); }
      catch { this.deviceInfo = { board: "atom-echo" }; }
      this.connectionState = "ready";
      this.lastError = "";
      this.notify();
      this.log("info", "atom-echo-ready", { port: this.portPath, device: this.deviceInfo });
      this.setCaptureMode(this.captureMode, this.vadThreshold).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (handleCaptureFrame(this, frame, FRAME_TYPES)) return;
    if (frame.type === FRAME_TYPES.INTERRUPT) {
      resetCaptureQueue(this);
      this.playbackGeneration += 1;
      Promise.resolve(this.callbacks.onInterrupt()).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (frame.type === FRAME_TYPES.WIFI_STATUS) {
      let status = {};
      try { status = JSON.parse(frame.payload.toString("utf8")); } catch {}
      Promise.resolve(this.callbacks.onWifiStatus(status)).catch((error) => this.reportCallbackError(error));
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
    this.log("warn", "atom-echo-callback-failed", { error: this.lastError });
  }

  async setDeviceState(state) {
    const normalized = Object.prototype.hasOwnProperty.call(DEVICE_STATES, state) ? state : "idle";
    this.deviceState = normalized;
    this.notify();
    if (this.port?.isOpen) await this.writeFrame(FRAME_TYPES.STATE, Buffer.from([DEVICE_STATES[normalized]]));
  }

  async setCaptureMode(mode, vadThreshold = this.vadThreshold) {
    this.captureMode = mode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    const supportsCaptureConfig = String(this.deviceInfo?.firmware || "").includes("handsfree");
    const supportsVadThreshold = String(this.deviceInfo?.firmware || "").includes("handsfree-vad");
    if (this.captureMode === "hands-free" && this.deviceInfo && !supportsCaptureConfig) {
      throw new Error("ハンズフリー対応のATOM Echoファームウェアへ更新してください。");
    }
    if (this.port?.isOpen) {
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
    if (this.port?.isOpen) await this.writeFrame(FRAME_TYPES.AUDIO_STOP).catch(() => {});
    await this.setDeviceState("idle").catch(() => {});
  }

  async beginPcm16Playback(sampleRate = 16_000) {
    const generation = ++this.playbackGeneration;
    await this.setDeviceState("speaking");
    const begin = Buffer.allocUnsafe(8);
    begin.writeUInt32LE(Math.round(Number(sampleRate) || 16_000), 0);
    begin.writeUInt32LE(0xffffffff, 4);
    await this.writeFrame(FRAME_TYPES.AUDIO_BEGIN, begin, { waitForAck: true });
    return generation;
  }

  async writePcm16PlaybackChunk(pcm, generation) {
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2 || bytes.length > PLAYBACK_CHUNK_BYTES) {
      throw new Error("ATOM Echoへ送るPCM音声チャンクが正しくありません。");
    }
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.writeFrame(FRAME_TYPES.AUDIO_CHUNK, bytes, { waitForAck: true });
    return { interrupted: generation !== this.playbackGeneration };
  }

  async endPcm16Playback(generation) {
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.writeFrame(FRAME_TYPES.AUDIO_END, null, { waitForAck: true });
    if (generation === this.playbackGeneration) await this.setDeviceState("idle");
    return { interrupted: generation !== this.playbackGeneration };
  }

  async provisionWifi({ ssid, password, token } = {}) {
    if (this.connectionState !== "ready") throw new Error("USBでATOM Echoを接続してください。");
    const network = String(ssid || "").trim();
    const secret = String(password || "");
    const pairingToken = String(token || "").toLowerCase();
    if (!network || Buffer.byteLength(network, "utf8") > 32) throw new Error("Wi-Fi名は32バイト以内で入力してください。");
    if (Buffer.byteLength(secret, "utf8") > 64) throw new Error("Wi-Fiパスワードは64バイト以内で入力してください。");
    if (!/^[a-f0-9]{64}$/.test(pairingToken)) throw new Error("ATOM Echoのペアリング情報が正しくありません。");
    const payload = Buffer.from(JSON.stringify({ ssid: network, password: secret, token: pairingToken }), "utf8");
    await this.writeFrame(FRAME_TYPES.WIFI_CONFIG, payload, { waitForAck: true, timeoutMs: 10_000 });
    return { device: this.deviceInfo ? { ...this.deviceInfo } : null, ssid: network };
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
}

module.exports = {
  AtomEchoSerialGateway,
  DEFAULT_BAUD_RATE,
  PLAYBACK_CHUNK_BYTES,
  likelyAtomEchoPort,
  publicPort,
};
