// SPDX-License-Identifier: Apache-2.0
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const net = require("node:net");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const {
  DeviceProtocolV2Decoder,
  FRAME_TYPES,
  encodeFrame,
  normalizeVadThreshold,
  parseJsonPayload,
} = require("./device-protocol-v2.cjs");
const { EXPECTED_BOARD, Rlcd42SerialGateway } = require("./rlcd42-serial.cjs");

const DEFAULT_DISCOVERY_PORT = 41721;
const DEFAULT_AUDIO_PORT = 41722;
const DISCOVERY_PREFIX = "CHARADOCK_DEVICE_DISCOVER_V2 ";
const HOST_PREFIX = "CHARADOCK_DEVICE_HOST_V2 ";
const HOST_PROOF_DOMAIN = Buffer.from("CHARADOCK_HOST_V2:", "ascii");

function validDeviceId(value) {
  return /^cd-rlcd-[a-f0-9]{12}$/.test(String(value || "").toLowerCase());
}

function ipv4Number(value) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

function matchingLocalAddress(remoteAddress) {
  const remote = ipv4Number(remoteAddress);
  const candidates = Object.values(os.networkInterfaces()).flat().filter((entry) =>
    entry && entry.family === "IPv4" && !entry.internal && ipv4Number(entry.address) !== null);
  if (remote !== null) {
    const match = candidates.find((entry) => {
      const local = ipv4Number(entry.address);
      const mask = ipv4Number(entry.netmask);
      return local !== null && mask !== null && (local & mask) === (remote & mask);
    });
    if (match) return match.address;
  }
  return candidates[0]?.address || "0.0.0.0";
}

class SocketPortAdapter extends EventEmitter {
  constructor(socket) {
    super();
    // A socket may fail in the tiny interval before the protocol gateway
    // attaches its listener. Keep EventEmitter's special `error` event from
    // becoming an uncaught exception during that hand-off.
    this.on("error", () => {});
    this.socket = socket;
    this.isOpen = Boolean(socket && !socket.destroyed);
    this.onData = (bytes) => this.emit("data", bytes);
    this.onError = (error) => this.emit("error", error);
    this.onClose = () => {
      this.isOpen = false;
      this.emit("close");
    };
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  write(bytes, callback) {
    if (!this.isOpen || this.socket.destroyed) {
      callback?.(new Error("RLCD 4.2の無線接続がありません。"));
      return false;
    }
    return this.socket.write(bytes, callback);
  }

  close(callback) {
    if (!this.isOpen) {
      callback?.();
      return;
    }
    this.isOpen = false;
    this.socket.destroy();
    setImmediate(() => callback?.());
  }
}

class Rlcd42WifiGateway {
  constructor({
    discoveryPort = DEFAULT_DISCOVERY_PORT,
    audioPort = DEFAULT_AUDIO_PORT,
    host = "0.0.0.0",
    onInput = async () => {},
    onPttStart = async () => {},
    onPcmChunk = async () => {},
    onPttEnd = async () => {},
    onInterrupt = async () => {},
    onCaptureStatus = async () => {},
    onReady = async () => {},
    onStatus = () => {},
    logger = null,
  } = {}) {
    this.discoveryPort = discoveryPort;
    this.audioPort = audioPort;
    this.host = host;
    this.onStatus = onStatus;
    this.logger = logger;
    this.enabled = false;
    this.expectedDeviceId = "";
    this.pairingToken = "";
    this.connectionState = "off";
    this.lastError = "";
    this.remoteAddress = "";
    this.captureMode = "push-to-talk";
    this.vadThreshold = 120;
    this.microphoneEnabled = true;
    this.udpSocket = null;
    this.tcpServer = null;
    this.candidates = new Set();
    this.activeCandidate = null;
    this.sequence = 0;
    this.inner = new Rlcd42SerialGateway({
      onInput,
      onPttStart,
      onPcmChunk,
      onPttEnd,
      onInterrupt,
      onCaptureStatus,
      onReady,
      onStatus: () => {
        if (this.inner.status().connected) {
          this.connectionState = "ready";
          this.lastError = "";
        }
        this.notify();
      },
      logger,
    });
  }

  log(level, event, detail = {}) {
    this.logger?.(level, event, detail);
  }

  status() {
    const runtime = this.inner.status();
    const connected = Boolean(this.activeCandidate && runtime.connected);
    return {
      ...runtime,
      enabled: this.enabled,
      connectionState: connected ? "ready" : this.connectionState,
      connected,
      wirelessConnected: connected,
      transport: "wifi",
      port: this.remoteAddress,
      remoteAddress: this.remoteAddress,
      deviceId: this.expectedDeviceId,
      discoveryPort: this.udpSocket?.address?.().port || this.discoveryPort,
      audioPort: this.tcpServer?.address?.()?.port || this.audioPort,
      captureMode: this.captureMode,
      vadThreshold: this.vadThreshold,
      microphoneEnabled: this.microphoneEnabled,
      error: this.lastError || runtime.error,
    };
  }

  notify() {
    this.onStatus(this.status());
  }

  async configure({
    enabled,
    deviceId = "",
    token = "",
    captureMode = this.captureMode,
    vadThreshold = this.vadThreshold,
    microphoneEnabled = this.microphoneEnabled,
  } = {}) {
    const nextDeviceId = validDeviceId(deviceId) ? String(deviceId).toLowerCase() : "";
    const nextToken = /^[a-f0-9]{64}$/.test(String(token || "").toLowerCase()) ? String(token).toLowerCase() : "";
    const pairingChanged = nextDeviceId !== this.expectedDeviceId || nextToken !== this.pairingToken;
    this.enabled = enabled === true;
    this.expectedDeviceId = nextDeviceId;
    this.pairingToken = nextToken;
    this.captureMode = captureMode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    this.microphoneEnabled = microphoneEnabled !== false;
    await this.inner.setCaptureMode(this.captureMode, this.vadThreshold, this.microphoneEnabled);
    if (!this.enabled) {
      await this.disconnect();
      return this.status();
    }
    if (pairingChanged && this.activeCandidate) this.activeCandidate.socket.destroy();
    if (!this.tcpServer || !this.udpSocket) await this.start();
    this.connectionState = this.activeCandidate
      ? this.connectionState
      : this.expectedDeviceId && this.pairingToken ? "waiting" : "setup-required";
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
          udpSocket.setBroadcast(true);
          resolve();
        });
      });
      this.udpSocket = udpSocket;
      udpSocket.on("error", (error) => this.serverFailure(error));
      udpSocket.on("message", (message, remote) => this.handleDiscovery(message, remote));
      this.connectionState = this.expectedDeviceId && this.pairingToken ? "waiting" : "setup-required";
      this.lastError = "";
      this.notify();
      this.log("info", "rlcd42-wifi-listening", {
        discoveryPort: udpSocket.address().port,
        audioPort: tcpServer.address().port,
      });
    } catch (error) {
      await this.stopServers();
      this.connectionState = "error";
      this.lastError = `RLCD 4.2の無線待受を開始できません: ${String(error?.message || error)}`;
      this.notify();
      throw error;
    }
  }

  handleDiscovery(message, remote) {
    if (!this.enabled || !this.expectedDeviceId || !this.pairingToken || !this.udpSocket || !this.tcpServer) return;
    const request = message.toString("utf8").trim();
    if (request !== `${DISCOVERY_PREFIX}${this.expectedDeviceId} ${EXPECTED_BOARD}`) return;
    const address = this.host !== "0.0.0.0" && ipv4Number(this.host) !== null
      ? this.host
      : matchingLocalAddress(remote.address);
    const response = Buffer.from(`${HOST_PREFIX}${address} ${this.tcpServer.address().port}`, "utf8");
    this.udpSocket.send(response, remote.port, remote.address, (error) => {
      if (error) this.log("warn", "rlcd42-wifi-discovery-reply-failed", { error: error.message });
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
      decoder: new DeviceProtocolV2Decoder(),
      challenge: crypto.randomBytes(32),
      deviceInfo: null,
      challengeSent: false,
      activating: false,
      authenticated: false,
      timer: null,
      onData: null,
    };
    candidate.onData = (chunk) => this.receiveCandidate(candidate, chunk);
    this.candidates.add(candidate);
    candidate.timer = setTimeout(() => this.rejectCandidate(candidate, "authentication timeout"), 6_000);
    candidate.timer.unref?.();
    socket.on("data", candidate.onData);
    socket.on("error", (error) => this.closeCandidate(candidate, error));
    socket.on("close", () => this.closeCandidate(candidate));
  }

  receiveCandidate(candidate, chunk) {
    for (const frame of candidate.decoder.push(chunk)) this.handleAuthenticationFrame(candidate, frame);
  }

  handleAuthenticationFrame(candidate, frame) {
    if (candidate.activating || candidate.authenticated) return;
    if (frame.type === FRAME_TYPES.DEVICE_HELLO) {
      const info = parseJsonPayload(frame.payload) || {};
      if (String(info.deviceId || "").toLowerCase() !== this.expectedDeviceId || info.board !== EXPECTED_BOARD) {
        this.rejectCandidate(candidate, "unexpected device");
        return;
      }
      candidate.deviceInfo = info;
      if (!candidate.challengeSent) {
        candidate.challengeSent = true;
        this.writeCandidateFrame(candidate, FRAME_TYPES.AUTH_CHALLENGE, candidate.challenge)
          .catch(() => this.rejectCandidate(candidate, "challenge write failed"));
      }
      return;
    }
    if (frame.type !== FRAME_TYPES.DEVICE_AUTH || !candidate.deviceInfo || frame.payload.length !== 32) return;
    const expected = crypto.createHmac("sha256", Buffer.from(this.pairingToken, "hex")).update(candidate.challenge).digest();
    if (!crypto.timingSafeEqual(expected, frame.payload)) {
      this.rejectCandidate(candidate, "authentication failed");
      return;
    }
    candidate.activating = true;
    this.activateCandidate(candidate).catch((error) => this.rejectCandidate(candidate, String(error?.message || error)));
  }

  async activateCandidate(candidate) {
    clearTimeout(candidate.timer);
    candidate.timer = null;
    candidate.socket.off("data", candidate.onData);
    candidate.authenticated = true;
    if (this.activeCandidate && this.activeCandidate !== candidate) this.activeCandidate.socket.destroy();
    this.activeCandidate = candidate;
    this.remoteAddress = String(candidate.socket.remoteAddress || "").replace(/^::ffff:/, "");
    this.connectionState = "authenticating";
    this.lastError = "";
    this.notify();
    const adapter = new SocketPortAdapter(candidate.socket);
    candidate.adapter = adapter;
    const hostProof = crypto.createHmac("sha256", Buffer.from(this.pairingToken, "hex"))
      .update(HOST_PROOF_DOMAIN)
      .update(candidate.challenge)
      .digest();
    await this.inner.adoptOpenPort(adapter, {
      path: this.remoteAddress,
      transport: "wifi",
      hostProof,
    });
    if (this.activeCandidate !== candidate || !this.enabled) return;
    this.connectionState = "ready";
    this.notify();
    this.log("info", "rlcd42-wifi-ready", { deviceId: this.expectedDeviceId, address: this.remoteAddress });
  }

  nextSequence() {
    this.sequence = (this.sequence + 1) & 0xffff;
    if (!this.sequence) this.sequence = 1;
    return this.sequence;
  }

  async writeCandidateFrame(candidate, type, payload) {
    if (!candidate?.socket || candidate.socket.destroyed) throw new Error("RLCD 4.2の無線接続がありません。");
    const frame = encodeFrame(type, this.nextSequence(), payload);
    await new Promise((resolve, reject) => candidate.socket.write(frame, (error) => error ? reject(error) : resolve()));
  }

  rejectCandidate(candidate, reason) {
    this.log("warn", "rlcd42-wifi-auth-rejected", {
      reason: String(reason || "authentication failed").slice(0, 240),
      address: candidate.socket.remoteAddress,
    });
    candidate.socket.destroy();
  }

  closeCandidate(candidate, error = null) {
    clearTimeout(candidate.timer);
    candidate.timer = null;
    this.candidates.delete(candidate);
    if (candidate !== this.activeCandidate) return;
    this.activeCandidate = null;
    this.remoteAddress = "";
    this.inner.configure({ enabled: false }).catch(() => {});
    if (!this.enabled) return;
    this.connectionState = this.expectedDeviceId && this.pairingToken ? "waiting" : "setup-required";
    this.lastError = error ? String(error.message || error) : "";
    this.notify();
  }

  serverFailure(error) {
    if (!this.enabled) return;
    this.connectionState = "error";
    this.lastError = String(error?.message || error);
    this.notify();
    this.log("warn", "rlcd42-wifi-server-error", { error: this.lastError });
  }

  async setCaptureMode(mode, vadThreshold = this.vadThreshold, microphoneEnabled = this.microphoneEnabled) {
    this.captureMode = mode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = normalizeVadThreshold(vadThreshold);
    this.microphoneEnabled = microphoneEnabled !== false;
    if (this.status().connected) {
      return this.inner.setCaptureMode(this.captureMode, this.vadThreshold, this.microphoneEnabled);
    }
    return this.captureMode;
  }

  async stopServers() {
    await this.inner.configure({ enabled: false }).catch(() => {});
    for (const candidate of this.candidates) {
      clearTimeout(candidate.timer);
      candidate.socket.destroy();
    }
    this.candidates.clear();
    this.activeCandidate = null;
    const udpSocket = this.udpSocket;
    const tcpServer = this.tcpServer;
    this.udpSocket = null;
    this.tcpServer = null;
    if (udpSocket) await new Promise((resolve) => { try { udpSocket.close(resolve); } catch { resolve(); } });
    if (tcpServer) await new Promise((resolve) => { try { tcpServer.close(resolve); } catch { resolve(); } });
  }

  async disconnect() {
    this.enabled = false;
    await this.stopServers();
    this.connectionState = "off";
    this.lastError = "";
    this.remoteAddress = "";
    this.notify();
  }

  sendPortrait(...args) { return this.inner.sendPortrait(...args); }
  sendPortraitFrame(...args) { return this.inner.sendPortraitFrame(...args); }
  sendScene(...args) { return this.inner.sendScene(...args); }
  setDeviceState(...args) { return this.inner.setDeviceState(...args); }
  stopPlayback(...args) { return this.inner.stopPlayback(...args); }
  playPcm16(...args) { return this.inner.playPcm16(...args); }
  beginPcm16Playback(...args) { return this.inner.beginPcm16Playback(...args); }
  writePcm16PlaybackChunk(...args) { return this.inner.writePcm16PlaybackChunk(...args); }
  endPcm16Playback(...args) { return this.inner.endPcm16Playback(...args); }
}

module.exports = {
  DEFAULT_AUDIO_PORT,
  DEFAULT_DISCOVERY_PORT,
  DISCOVERY_PREFIX,
  HOST_PREFIX,
  HOST_PROOF_DOMAIN,
  Rlcd42WifiGateway,
  SocketPortAdapter,
  matchingLocalAddress,
  validDeviceId,
};
