// SPDX-License-Identifier: Apache-2.0
const { handleCaptureFrame, resetCaptureQueue } = require("./device-capture-queue.cjs");
const {
  DeviceProtocolV2Decoder,
  FRAME_TYPES,
  MAX_FRAME_PAYLOAD_BYTES,
  assetChunkPayload,
  assetMetaPayload,
  captureConfigPayload,
  characterChangedPayload,
  displayCommitPayload,
  displayScenePayload,
  displayTextPayload,
  encodeFrame,
  normalizeVadThreshold,
  parseApplyResponse,
  parseCaptureStatus,
  parseInputEvent,
  parseJsonPayload,
  parseSensorReport,
  timeSyncPayload,
} = require("./device-protocol-v2.cjs");

const DEFAULT_BAUD_RATE = 500_000;
const EXPECTED_BOARD = "waveshare-esp32-s3-rlcd-4.2";
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 8_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const PLAYBACK_CHUNK_BYTES = 4096;
const PLAYBACK_SAMPLE_RATE = 16_000;

function publicPort(port = {}) {
  return {
    path: String(port.path || "").slice(0, 120),
    manufacturer: String(port.manufacturer || "").slice(0, 120),
    vendorId: String(port.vendorId || "").toLowerCase().slice(0, 8),
    productId: String(port.productId || "").toLowerCase().slice(0, 8),
    friendlyName: String(port.friendlyName || port.pnpId || "").slice(0, 180),
  };
}

function likelyRlcd42Port(port = {}) {
  const item = publicPort(port);
  const description = `${item.manufacturer} ${item.friendlyName}`.toLowerCase();
  if (/waveshare|rlcd|esp32[ -]?s3|usb jtag\/serial/.test(description)) return true;
  return ["303a", "1a86", "10c4"].includes(item.vendorId);
}

function validatedDevice(hello, capabilities) {
  if (!hello || hello.board !== EXPECTED_BOARD) throw new Error("選択したポートはWaveshare RLCD 4.2ではありません。");
  if (!capabilities || Number(capabilities.protocol) !== 2 || capabilities.board !== EXPECTED_BOARD) {
    throw new Error("RLCD 4.2のDevice Protocol v2ファームウェアを確認できません。");
  }
  const display = capabilities.capabilities?.display;
  if (Number(display?.width) !== 400 || Number(display?.height) !== 300 || Number(display?.bitsPerPixel) !== 1) {
    throw new Error("RLCD 4.2の表示能力がファームウェア仕様と一致しません。");
  }
  if (!Array.isArray(display.bitmap) || !display.bitmap.includes("raw1-msb")) {
    throw new Error("RLCD 4.2ファームウェアがraw1-msb画像に対応していません。");
  }
  return {
    board: EXPECTED_BOARD,
    firmware: String(hello.firmware || capabilities.firmware || "").slice(0, 80),
    deviceId: String(hello.deviceId || capabilities.deviceId || "").slice(0, 80),
    transport: String(hello.transport || "usb").slice(0, 20),
  };
}

function responseError(response) {
  return `RLCD 4.2が要求を拒否しました（${response?.applyResultName || "unknown"} / ${response?.assetResultName || "unknown"} / ${response?.audioResultName || "unknown"}）。`;
}

class Rlcd42SerialGateway {
  constructor({
    SerialPortClass = null,
    listPorts = null,
    onInput = async () => {},
    onPttStart = async () => {},
    onPcmChunk = async () => {},
    onPttEnd = async () => {},
    onInterrupt = async () => {},
    onWifiStatus = async () => {},
    onCaptureStatus = async () => {},
    onReady = async () => {},
    onStatus = () => {},
    logger = null,
    reconnectDelayMs = RECONNECT_DELAY_MS,
    maxReconnectDelayMs = MAX_RECONNECT_DELAY_MS,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS,
  } = {}) {
    this.SerialPortClass = SerialPortClass;
    this.listPortsOverride = listPorts;
    this.callbacks = {
      onInput, onPttStart, onPcmChunk, onPttEnd, onInterrupt,
      onWifiStatus, onCaptureStatus, onReady, onStatus,
    };
    this.logger = logger;
    this.reconnectDelayMs = Math.max(10, Number(reconnectDelayMs) || RECONNECT_DELAY_MS);
    this.maxReconnectDelayMs = Math.max(this.reconnectDelayMs, Number(maxReconnectDelayMs) || MAX_RECONNECT_DELAY_MS);
    this.heartbeatIntervalMs = Math.max(10, Number(heartbeatIntervalMs) || HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimeoutMs = Math.max(10, Number(heartbeatTimeoutMs) || HEARTBEAT_TIMEOUT_MS);
    this.enabled = false;
    this.requestedPort = "";
    this.portPath = "";
    this.connectionState = "off";
    this.lastError = "";
    this.device = null;
    this.capabilities = null;
    this.sensors = null;
    this.wifiSetup = {};
    this.transport = "usb";
    this.captureMode = "push-to-talk";
    this.vadThreshold = 120;
    this.microphoneEnabled = true;
    this.port = null;
    this.externallyManaged = false;
    this.decoder = new DeviceProtocolV2Decoder();
    this.sequence = 0;
    this.sceneRevision = 0;
    this.pending = new Map();
    this.intentionalCloses = new WeakSet();
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.reconnectAttempt = 0;
    this.lastFrameAt = 0;
    this.lastHeartbeatAt = 0;
    this.connectGeneration = 0;
    this.operationQueue = Promise.resolve();
    this.playbackGeneration = 0;
    this.activePlayback = null;
    this.captureQueue = Promise.resolve();
  }

  async serialApi() {
    if (this.SerialPortClass) return { SerialPort: this.SerialPortClass };
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
      connected: this.connectionState === "ready",
      device: this.device ? { ...this.device } : null,
      capabilities: this.capabilities ? structuredClone(this.capabilities.capabilities || {}) : null,
      sensors: this.sensors ? structuredClone(this.sensors) : null,
      wifiSetup: { ...this.wifiSetup },
      transport: this.transport,
      captureMode: this.captureMode,
      vadThreshold: this.vadThreshold,
      microphoneEnabled: this.microphoneEnabled,
      reconnectAttempt: this.reconnectAttempt,
      lastFrameAt: this.lastFrameAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      error: this.lastError,
    };
  }

  notify() {
    this.callbacks.onStatus(this.status());
  }

  log(level, event, detail = {}) {
    this.logger?.(level, event, detail);
  }

  async configure({
    enabled,
    port = "",
    captureMode = this.captureMode,
    vadThreshold = this.vadThreshold,
    microphoneEnabled = this.microphoneEnabled,
  } = {}) {
    this.enabled = enabled === true;
    this.requestedPort = String(port || "").trim().slice(0, 120);
    this.captureMode = captureMode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    this.microphoneEnabled = microphoneEnabled !== false;
    this.connectGeneration += 1;
    this.reconnectAttempt = 0;
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
      if (!exact) throw new Error(`${this.requestedPort} が見つかりません。RLCD 4.2をUSB接続してください。`);
      return exact;
    }
    const candidates = ports.filter(likelyRlcd42Port);
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) throw new Error("RLCD 4.2のUSBシリアルが見つかりません。");
    throw new Error("ESP32-S3の候補が複数あります。使用するUSBポートを選択してください。");
  }

  async connect(generation = this.connectGeneration) {
    if (!this.enabled || generation !== this.connectGeneration) return;
    await this.disconnect();
    if (!this.enabled || generation !== this.connectGeneration) return;
    this.externallyManaged = false;
    this.transport = "usb";
    this.connectionState = "connecting";
    this.lastError = "";
    this.device = null;
    this.capabilities = null;
    this.sensors = null;
    this.notify();
    try {
      const selected = await this.selectPort();
      if (!this.enabled || generation !== this.connectGeneration) return;
      const { SerialPort } = await this.serialApi();
      if (!this.enabled || generation !== this.connectGeneration) return;
      const port = new SerialPort({ path: selected.path, baudRate: DEFAULT_BAUD_RATE, autoOpen: false });
      this.bindPort(port, { path: selected.path, transport: "usb", externallyManaged: false });
      await new Promise((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
      if (!this.enabled || generation !== this.connectGeneration) {
        this.intentionalCloses.add(port);
        await new Promise((resolve) => port.close(() => resolve()));
        return;
      }
      await this.initializeOpenedPort(port, generation);
    } catch (error) {
      if (!this.enabled || generation !== this.connectGeneration) return;
      this.connectionState = "error";
      this.lastError = String(error?.message || error);
      this.log("warn", "rlcd42-connect-failed", { port: this.requestedPort, error: this.lastError });
      this.notify();
      this.closeCurrentPort();
      this.scheduleReconnect(generation);
    }
  }

  bindPort(port, { path = "", transport = "usb", externallyManaged = false } = {}) {
    const epoch = this.portEpoch = (this.portEpoch || 0) + 1;
    const current = () => this.port === port && this.portEpoch === epoch;
    this.decoder.reset();
    this.port = port;
    this.portPath = String(path || "").slice(0, 120);
    this.transport = transport === "wifi" ? "wifi" : "usb";
    this.externallyManaged = externallyManaged === true;
    port.on("data", (chunk) => { if (current()) this.receive(chunk); });
    port.on("error", (error) => { if (current()) this.handlePortFailure(error); });
    port.on("close", () => { if (current()) this.handlePortClose(port); });
    port.resumeInput?.();
  }

  async initializeOpenedPort(port, generation, hostHelloPayload = null) {
    const helloPayload = hostHelloPayload === null
      ? Buffer.from(JSON.stringify({ protocol: 2, host: "CharaDock", transport: this.transport }), "utf8")
      : Buffer.from(hostHelloPayload);
    await this.writeWithAck(
      FRAME_TYPES.HOST_HELLO,
      helloPayload,
      { requireReady: false },
    );
    const hello = await this.requestFrame(FRAME_TYPES.DEVICE_HELLO, Buffer.alloc(0), FRAME_TYPES.DEVICE_HELLO, 4_000);
    const capabilities = await this.requestFrame(FRAME_TYPES.CAPABILITIES, Buffer.alloc(0), FRAME_TYPES.CAPABILITIES, 4_000);
    this.device = validatedDevice(parseJsonPayload(hello.payload), parseJsonPayload(capabilities.payload));
    this.device.transport = this.transport;
    this.capabilities = parseJsonPayload(capabilities.payload);
    await this.writeWithAck(FRAME_TYPES.TIME_SYNC, timeSyncPayload(), { requireReady: false });
    // 0.1.x display/speaker firmware did not know CaptureConfig.  Keep that
    // useful subset connectable and let the capability-driven UI ask for a
    // firmware update only when microphone input is actually requested.
    if (this.capabilities?.capabilities?.audio?.capture === true) {
      await this.writeWithAck(
        FRAME_TYPES.CAPTURE_CONFIG,
        captureConfigPayload(this.captureMode, this.vadThreshold, { enabled: this.microphoneEnabled }),
        { requireReady: false },
      );
    }
    try {
      const sensorFrame = await this.requestFrame(
        FRAME_TYPES.SENSOR_REPORT,
        Buffer.alloc(0),
        FRAME_TYPES.SENSOR_REPORT,
        2_000,
      );
      this.sensors = parseSensorReport(sensorFrame.payload);
    } catch (error) {
      this.log("warn", "rlcd42-initial-sensor-query-failed", { error: String(error?.message || error) });
    }
    if (this.transport === "usb") {
      try {
        const statusFrame = await this.requestFrame(FRAME_TYPES.WIFI_STATUS, Buffer.alloc(0), FRAME_TYPES.WIFI_STATUS, 2_000);
        this.wifiSetup = parseJsonPayload(statusFrame.payload) || {};
        Promise.resolve(this.callbacks.onWifiStatus(this.wifiSetup)).catch((error) => this.reportCallbackError(error));
      } catch (error) {
        this.log("warn", "rlcd42-initial-wifi-query-failed", { error: String(error?.message || error) });
      }
    }
    if (!this.enabled || generation !== this.connectGeneration || this.port !== port) return;
    this.connectionState = "ready";
    this.lastError = "";
    this.reconnectAttempt = 0;
    this.startHeartbeat(generation);
    this.notify();
    this.log("info", "rlcd42-ready", { port: this.portPath, transport: this.transport, device: this.device });
    Promise.resolve(this.callbacks.onReady(this.status())).catch((error) => this.reportCallbackError(error));
  }

  async adoptOpenPort(port, { path = "", transport = "wifi", hostProof = null } = {}) {
    if (!port?.isOpen) throw new Error("RLCD 4.2の無線ソケットが開いていません。");
    if (transport === "wifi" && (!Buffer.isBuffer(hostProof) || hostProof.length !== 32)) {
      throw new Error("RLCD 4.2の相互認証情報が正しくありません。");
    }
    this.enabled = true;
    this.connectGeneration += 1;
    const generation = this.connectGeneration;
    await this.disconnect();
    if (!this.enabled || generation !== this.connectGeneration || !port.isOpen) return this.status();
    this.connectionState = "connecting";
    this.lastError = "";
    this.device = null;
    this.capabilities = null;
    this.sensors = null;
    this.bindPort(port, { path, transport, externallyManaged: true });
    this.notify();
    try {
      await this.initializeOpenedPort(port, generation, hostProof);
      return this.status();
    } catch (error) {
      if (this.port === port) {
        this.connectionState = "error";
        this.lastError = String(error?.message || error);
        this.notify();
        this.closeCurrentPort();
      }
      throw error;
    }
  }

  scheduleReconnect(generation = this.connectGeneration) {
    if (this.externallyManaged || !this.enabled || generation !== this.connectGeneration || this.reconnectTimer) return;
    const exponent = Math.min(this.reconnectAttempt, 8);
    const delayMs = Math.min(this.maxReconnectDelayMs, this.reconnectDelayMs * (2 ** exponent));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(generation).catch(() => {});
    }, delayMs);
    this.reconnectTimer.unref?.();
    this.log("info", "rlcd42-reconnect-scheduled", { attempt: this.reconnectAttempt, delayMs });
  }

  stopHeartbeat() {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  startHeartbeat(generation = this.connectGeneration) {
    this.stopHeartbeat();
    const tick = async () => {
      this.heartbeatTimer = null;
      if (!this.enabled || generation !== this.connectGeneration || this.connectionState !== "ready") return;
      try {
        await this.writeWithAck(FRAME_TYPES.HOST_HELLO, Buffer.alloc(0), { timeoutMs: this.heartbeatTimeoutMs });
        this.lastHeartbeatAt = Date.now();
      } catch (error) {
        if (this.enabled && generation === this.connectGeneration) this.handlePortFailure(error);
        return;
      }
      if (!this.enabled || generation !== this.connectGeneration || this.connectionState !== "ready") return;
      this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs);
      this.heartbeatTimer.unref?.();
    };
    this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  rejectPending(message) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
  }

  async disconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.rejectPending("RLCD 4.2との接続が切れました。");
    const port = this.port;
    this.port = null;
    this.decoder.reset();
    this.portPath = "";
    this.device = null;
    this.capabilities = null;
    this.sensors = null;
    resetCaptureQueue(this);
    this.playbackGeneration += 1;
    this.activePlayback = null;
    if (port?.isOpen) {
      this.intentionalCloses.add(port);
      await new Promise((resolve) => port.close(() => resolve()));
    }
    this.externallyManaged = false;
  }

  closeCurrentPort() {
    resetCaptureQueue(this);
    this.stopHeartbeat();
    const port = this.port;
    this.port = null;
    this.decoder.reset();
    this.rejectPending("RLCD 4.2との接続が切れました。");
    if (port?.isOpen) {
      this.intentionalCloses.add(port);
      port.close(() => {});
    }
  }

  handlePortFailure(error) {
    if (!this.enabled) return;
    const reconnect = !this.externallyManaged;
    this.lastError = String(error?.message || error);
    this.connectionState = "error";
    this.notify();
    this.log("warn", "rlcd42-serial-error", { port: this.portPath, error: this.lastError });
    this.closeCurrentPort();
    if (reconnect) this.scheduleReconnect(this.connectGeneration);
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
    const reconnect = !this.externallyManaged;
    this.connectionState = "error";
    this.lastError ||= "RLCD 4.2との接続が切れました。再接続しています。";
    this.notify();
    if (reconnect) this.scheduleReconnect(this.connectGeneration);
  }

  nextSequence() {
    this.sequence = (this.sequence + 1) & 0xffff;
    if (!this.sequence) this.sequence = 1;
    return this.sequence;
  }

  nextSceneRevision() {
    const candidate = Date.now() >>> 0;
    this.sceneRevision = candidate && candidate !== this.sceneRevision ? candidate : ((this.sceneRevision + 1) >>> 0) || 1;
    return this.sceneRevision;
  }

  async writeBytes(bytes) {
    const port = this.port;
    if (!port?.isOpen) throw new Error("RLCD 4.2が接続されていません。");
    await new Promise((resolve, reject) => port.write(bytes, (error) => error ? reject(error) : resolve()));
  }

  pendingResponse(key, timeoutMs, timeoutMessage) {
    let request;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      timer.unref?.();
      request = { resolve, reject, timer };
      this.pending.set(key, request);
    });
    // Disconnect can reject the ACK before the socket write has finished.
    // Handle that interval; the original promise still rejects for the caller.
    promise.catch(() => {});
    return { promise, request };
  }

  async requestFrame(type, payload, responseType, timeoutMs = 3_000) {
    const sequence = this.nextSequence();
    const key = `frame:${responseType}:${sequence}`;
    const pending = this.pendingResponse(key, timeoutMs, "RLCD 4.2ファームウェアから応答がありません。");
    try {
      const [, response] = await Promise.all([
        this.writeBytes(encodeFrame(type, sequence, payload)), pending.promise,
      ]);
      return response;
    } catch (error) {
      clearTimeout(pending.request.timer);
      this.pending.delete(key);
      throw error;
    }
  }

  async writeWithAck(type, payload, { timeoutMs = 4_000, requireReady = true } = {}) {
    if (requireReady && this.connectionState !== "ready") throw new Error("RLCD 4.2の接続準備ができていません。");
    const sequence = this.nextSequence();
    const key = `ack:${sequence}`;
    const command = Object.entries(FRAME_TYPES).find(([, value]) => value === type)?.[0] || String(type);
    const pending = this.pendingResponse(key, timeoutMs, `RLCD 4.2への転送が時間切れになりました（${command} / ${this.transport}）。`);
    pending.request.requestType = type;
    try {
      // A stalled socket write callback must not bypass the ACK deadline.
      const [, response] = await Promise.all([
        this.writeBytes(encodeFrame(type, sequence, payload)), pending.promise,
      ]);
      if (!response.accepted) throw new Error(responseError(response));
      return response;
    } catch (error) {
      clearTimeout(pending.request.timer);
      this.pending.delete(key);
      throw error;
    }
  }

  receive(chunk) {
    const epoch = this.portEpoch;
    for (const frame of this.decoder.push(chunk)) {
      if (epoch !== this.portEpoch || (this.portEpoch && !this.port)) break;
      this.lastFrameAt = Date.now();
      this.handleFrame(frame);
    }
  }

  handleFrame(frame) {
    const responseKey = `frame:${frame.type}:${frame.sequence}`;
    const responseRequest = this.pending.get(responseKey);
    if (responseRequest) {
      clearTimeout(responseRequest.timer);
      this.pending.delete(responseKey);
      responseRequest.resolve(frame);
      return;
    }
    if (frame.type === FRAME_TYPES.ACK || frame.type === FRAME_TYPES.ERROR) {
      const result = parseApplyResponse(frame.payload);
      const key = `ack:${frame.sequence}`;
      const request = this.pending.get(key);
      if (!request || !result || result.requestType !== request.requestType) return;
      clearTimeout(request.timer);
      this.pending.delete(key);
      request.resolve({ ...result, responseType: frame.type, accepted: frame.type === FRAME_TYPES.ACK && result.accepted });
      return;
    }
    if (frame.type === FRAME_TYPES.DEVICE_HELLO) {
      const hello = parseJsonPayload(frame.payload);
      if (hello?.board === EXPECTED_BOARD) this.device = { ...this.device, ...hello };
      return;
    }
    if (frame.type === FRAME_TYPES.CAPABILITIES) {
      const capabilities = parseJsonPayload(frame.payload);
      if (capabilities?.board === EXPECTED_BOARD) this.capabilities = capabilities;
      return;
    }
    if (frame.type === FRAME_TYPES.SENSOR_REPORT) {
      const sensors = parseSensorReport(frame.payload);
      if (sensors) {
        this.sensors = sensors;
        this.notify();
      }
      return;
    }
    if (frame.type === FRAME_TYPES.WIFI_STATUS) {
      const status = parseJsonPayload(frame.payload) || {};
      this.wifiSetup = status;
      this.notify();
      Promise.resolve(this.callbacks.onWifiStatus(status)).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (frame.type === FRAME_TYPES.CAPTURE_STATUS) {
      const status = parseCaptureStatus(frame.payload);
      if (status) Promise.resolve(this.callbacks.onCaptureStatus(status)).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (frame.type === FRAME_TYPES.INPUT_EVENT) {
      const event = parseInputEvent(frame.payload);
      if (event) Promise.resolve(this.callbacks.onInput(event)).catch((error) => this.reportCallbackError(error));
      return;
    }
    if (handleCaptureFrame(this, frame, FRAME_TYPES)) return;
    if (frame.type === FRAME_TYPES.INTERRUPT) {
      resetCaptureQueue(this);
      this.playbackGeneration += 1;
      Promise.resolve(this.callbacks.onInterrupt()).catch((error) => this.reportCallbackError(error));
    }
  }

  reportCallbackError(error) {
    this.log("warn", "rlcd42-callback-failed", { error: String(error?.message || error) });
  }

  enqueue(operation) {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => {});
    return result;
  }

  async sendPortraitFrame(portrait, frameName = "portrait") {
    return this.enqueue(async () => {
      const pixels = Buffer.from(portrait?.pixels || []);
      const revision = String(portrait?.revision || "");
      // Validate the complete local transfer before changing any device state.
      // A malformed portrait must not invalidate or replace the last verified
      // image already visible on the RLCD.
      const changedPayload = frameName === "portrait" ? characterChangedPayload(revision) : null;
      const metadataPayload = assetMetaPayload({
        pixels,
        width: portrait?.width,
        height: portrait?.height,
        revision,
        frameName,
      });
      const chunks = [];
      for (let offset = 0; offset < pixels.length; offset += MAX_FRAME_PAYLOAD_BYTES - 4) {
        chunks.push(assetChunkPayload(offset, pixels.subarray(offset, offset + MAX_FRAME_PAYLOAD_BYTES - 4)));
      }
      if (changedPayload) {
        const changed = await this.writeWithAck(FRAME_TYPES.CHARACTER_CHANGED, changedPayload);
        if (changed.applyResultName === "asset-cache-hit") return { cached: true, revision, bytes: pixels.length };
      }
      await this.writeWithAck(FRAME_TYPES.ASSET_META, metadataPayload);
      for (const chunk of chunks) await this.writeWithAck(FRAME_TYPES.ASSET_CHUNK, chunk);
      await this.writeWithAck(FRAME_TYPES.ASSET_END, Buffer.alloc(0));
      return { cached: false, revision, bytes: pixels.length };
    });
  }

  async sendPortrait(portrait) {
    return this.sendPortraitFrame(portrait, "portrait");
  }

  async sendScene(snapshot = {}) {
    return this.enqueue(async () => {
      const revision = snapshot.revision || this.nextSceneRevision();
      const fields = [
        ["caption", snapshot.caption, snapshot.captionFont || 16],
        ["activity", snapshot.activity, snapshot.activityFont || 16],
        ["nextAction", snapshot.nextAction, snapshot.nextActionFont || 12],
        ["footer", snapshot.footer, snapshot.footerFont || 12],
      ];
      const scenePayload = displayScenePayload({ ...snapshot, revision });
      const textPayloads = fields.flatMap(([target, text, fontSize]) => text
        ? [{ target, payload: displayTextPayload({ revision, target, text, fontSize }) }]
        : []);
      const commitPayload = displayCommitPayload(revision);
      await this.writeWithAck(FRAME_TYPES.DISPLAY_SCENE, scenePayload);
      for (const item of textPayloads) await this.writeWithAck(FRAME_TYPES.DISPLAY_TEXT, item.payload);
      await this.writeWithAck(FRAME_TYPES.DISPLAY_COMMIT, commitPayload);
      return { revision };
    });
  }

  requirePlayback() {
    if (this.connectionState !== "ready") throw new Error("RLCD 4.2が接続されていません。");
    if (this.capabilities?.capabilities?.audio?.playback !== true) {
      throw new Error("RLCD 4.2のスピーカー対応ファームウェアへ更新してください。");
    }
  }

  async setDeviceState(state) {
    const values = { idle: 0, listening: 1, thinking: 2, speaking: 3, error: 4 };
    const normalized = Object.prototype.hasOwnProperty.call(values, state) ? state : "idle";
    await this.writeWithAck(FRAME_TYPES.STATE, Buffer.from([values[normalized]]));
  }

  async setCaptureMode(mode, vadThreshold = this.vadThreshold, microphoneEnabled = this.microphoneEnabled) {
    this.captureMode = mode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    this.microphoneEnabled = microphoneEnabled !== false;
    if (this.connectionState === "ready") {
      if (this.microphoneEnabled && this.capabilities?.capabilities?.audio?.capture !== true) {
        throw new Error("RLCD 4.2のマイク対応ファームウェアへ更新してください。");
      }
      if (this.capabilities?.capabilities?.audio?.capture === true) {
        await this.writeWithAck(
          FRAME_TYPES.CAPTURE_CONFIG,
          captureConfigPayload(this.captureMode, this.vadThreshold, { enabled: this.microphoneEnabled }),
        );
      }
    }
    this.notify();
    return this.captureMode;
  }

  async provisionWifi({ ssid, password, token } = {}) {
    if (this.connectionState !== "ready" || this.transport !== "usb") {
      throw new Error("初回設定のためRLCD 4.2をUSB接続してください。");
    }
    const network = String(ssid || "").trim();
    const secret = String(password || "");
    const pairingToken = String(token || "").toLowerCase();
    if (!network || Buffer.byteLength(network, "utf8") > 32) throw new Error("Wi-Fi名は32バイト以内で入力してください。");
    if (Buffer.byteLength(secret, "utf8") > 64) throw new Error("Wi-Fiパスワードは64バイト以内で入力してください。");
    if (!/^[a-f0-9]{64}$/.test(pairingToken)) throw new Error("RLCD 4.2のペアリング情報が正しくありません。");
    const payload = Buffer.from(JSON.stringify({ ssid: network, password: secret, token: pairingToken }), "utf8");
    await this.writeWithAck(FRAME_TYPES.WIFI_CONFIG, payload, { timeoutMs: 10_000 });
    return { device: this.device ? { ...this.device } : null, ssid: network };
  }

  async stopPlayback() {
    this.playbackGeneration += 1;
    this.activePlayback = null;
    if (this.connectionState !== "ready") return { interrupted: true };
    await this.writeWithAck(FRAME_TYPES.AUDIO_STOP, Buffer.alloc(0), { timeoutMs: 5_000 }).catch(() => {});
    await this.setDeviceState("idle").catch(() => {});
    return { interrupted: true };
  }

  async beginPcm16Playback(sampleRate = PLAYBACK_SAMPLE_RATE, totalSamples = 0xffffffff) {
    this.requirePlayback();
    const rate = Math.round(Number(sampleRate) || 0);
    const samples = Number(totalSamples) === 0xffffffff
      ? 0xffffffff
      : Math.round(Number(totalSamples) || 0);
    if (rate !== PLAYBACK_SAMPLE_RATE || samples <= 0 || samples > 0xffffffff) {
      throw new Error("RLCD 4.2へ送るPCM音声の形式が正しくありません。");
    }
    const generation = ++this.playbackGeneration;
    const begin = Buffer.allocUnsafe(8);
    begin.writeUInt32LE(rate, 0);
    begin.writeUInt32LE(samples >>> 0, 4);
    await this.setDeviceState("speaking");
    await this.writeWithAck(FRAME_TYPES.AUDIO_BEGIN, begin, { timeoutMs: 5_000 });
    this.activePlayback = { generation, sampleRate: rate, totalSamples: samples };
    return generation;
  }

  async writePcm16PlaybackChunk(pcm, generation) {
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2 || bytes.length > PLAYBACK_CHUNK_BYTES) {
      throw new Error("RLCD 4.2へ送るPCM音声チャンクが正しくありません。");
    }
    if (generation !== this.playbackGeneration) return { interrupted: true };
    await this.writeWithAck(FRAME_TYPES.AUDIO_CHUNK, bytes, { timeoutMs: 5_000 });
    return { interrupted: generation !== this.playbackGeneration };
  }

  async endPcm16Playback(generation) {
    if (generation !== this.playbackGeneration) return { interrupted: true };
    const playback = this.activePlayback;
    await this.writeWithAck(FRAME_TYPES.AUDIO_END, Buffer.alloc(0), { timeoutMs: 5_000 });
    if (playback?.totalSamples !== 0xffffffff) {
      const durationMs = Math.ceil(playback.totalSamples * 1000 / playback.sampleRate) + 250;
      await new Promise((resolve) => setTimeout(resolve, durationMs));
    }
    if (generation !== this.playbackGeneration) return { interrupted: true };
    this.activePlayback = null;
    await this.setDeviceState("idle").catch(() => {});
    return { interrupted: false };
  }

  async playPcm16(pcm, sampleRate = PLAYBACK_SAMPLE_RATE) {
    const bytes = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (!bytes.length || bytes.length % 2) throw new Error("RLCD 4.2へ送るPCM音声が正しくありません。");
    const totalSamples = bytes.length / 2;
    // Known-length utterances up to the device's 512 KiB PSRAM ring are
    // generated/transferred completely before playback. Longer/Live streams
    // use the device's rolling prebuffer.
    const advertisedSamples = bytes.length <= 512 * 1024 ? totalSamples : 0xffffffff;
    // begin can fail after STATE or AUDIO_BEGIN reached the device. Track
    // ownership before awaiting so a partial start is cleaned up as well.
    const expectedGeneration = this.playbackGeneration + 1;
    try {
      const generation = await this.beginPcm16Playback(sampleRate, advertisedSamples);
      for (let offset = 0; offset < bytes.length; offset += PLAYBACK_CHUNK_BYTES) {
        if (generation !== this.playbackGeneration) return { interrupted: true };
        const result = await this.writePcm16PlaybackChunk(
          bytes.subarray(offset, offset + PLAYBACK_CHUNK_BYTES),
          generation,
        );
        if (result.interrupted) return result;
      }
      return await this.endPcm16Playback(generation);
    } catch (error) {
      if (this.playbackGeneration === expectedGeneration) {
        await this.stopPlayback().catch(() => {});
      }
      this.log("warn", "rlcd42-playback-failed", { error: String(error?.message || error), transport: this.transport });
      throw error;
    }
  }
}

module.exports = {
  DEFAULT_BAUD_RATE,
  EXPECTED_BOARD,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_RECONNECT_DELAY_MS,
  PLAYBACK_CHUNK_BYTES,
  PLAYBACK_SAMPLE_RATE,
  RECONNECT_DELAY_MS,
  Rlcd42SerialGateway,
  likelyRlcd42Port,
  publicPort,
  validatedDevice,
};
