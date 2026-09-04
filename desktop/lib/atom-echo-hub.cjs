// SPDX-License-Identifier: Apache-2.0
const { AtomEchoSerialGateway } = require("./atom-echo-serial.cjs");
const { AtomEchoWifiGateway } = require("./atom-echo-wifi.cjs");

class AtomEchoHub {
  constructor({ onPttStart, onPcmChunk, onPttEnd, onInterrupt, onWifiStatus, onCaptureStatus, onStatus = () => {}, logger = null } = {}) {
    this.enabled = false;
    this.onStatus = onStatus;
    this.onInterrupt = onInterrupt;
    this.inputSource = "";
    this.inputCapture = null;
    this.captureMode = "push-to-talk";
    this.vadThreshold = 120;
    this.wifiSetupStatus = {};
    const active = (source) => this.inputSource === source || (!this.inputSource && this.activeSource() === source);
    const callbacks = (source) => ({
      onPttStart: async () => {
        if (!this.enabled || this.activeSource() !== source) return;
        const previous = this.inputCapture;
        if (previous && !previous.endPending) throw new Error("ATOM Echo is already capturing audio.");
        const capture = { source, endPending: false, finished: false };
        this.inputCapture = capture;
        this.inputSource = source;
        try {
          return await onPttStart?.();
        } catch (error) {
          // Recognition may still own the previous response. Restore it only
          // if it has not completed and this start was not interrupted.
          if (this.releaseInput(capture) && previous && !previous.finished) {
            this.inputCapture = previous;
            this.inputSource = previous.source;
          }
          throw error;
        }
      },
      onPcmChunk: async (chunk) => this.inputCapture?.source === source && !this.inputCapture.endPending
        ? onPcmChunk?.(chunk) : undefined,
      onPttEnd: async () => {
        const capture = this.inputCapture;
        if (!capture || capture.source !== source || capture.endPending) return;
        capture.endPending = true;
        try { return await onPttEnd?.(); }
        finally { this.releaseInput(capture); }
      },
      onInterrupt: async () => {
        // A response may still belong to USB after Wi-Fi becomes preferred.
        if (!active(source) && !(this.inputCapture?.endPending && this.activeSource() === source)) return;
        this.releaseInput(this.inputCapture);
        return onInterrupt?.();
      },
      onCaptureStatus: async (status) => active(source) ? onCaptureStatus?.({ ...status, source }) : undefined,
      onStatus: () => {
        const sourceStatus = source === "wifi" ? this.wifi?.status() : this.serial?.status();
        if (this.inputCapture?.source === source && sourceStatus && !sourceStatus.connected) {
          this.interruptInput().catch((error) => {
            logger?.("warn", `ATOM Echo ${source} capture disconnect cleanup failed: ${error.message}`);
          });
        }
        this.onStatus(this.status());
      },
      logger,
    });
    this.serial = new AtomEchoSerialGateway({
      ...callbacks("usb"),
      onWifiStatus: async (status) => {
        this.wifiSetupStatus = status && typeof status === "object" ? { ...status } : {};
        this.onStatus(this.status());
        return onWifiStatus?.(this.wifiSetupStatus);
      },
    });
    this.wifi = new AtomEchoWifiGateway(callbacks("wifi"));
  }

  releaseInput(capture) {
    // Object identity distinguishes successive utterances on one transport.
    if (!capture) return false;
    capture.finished = true;
    if (this.inputCapture !== capture) return false;
    this.inputCapture = null;
    this.inputSource = "";
    return true;
  }

  async interruptInput() {
    if (!this.releaseInput(this.inputCapture)) return;
    await this.onInterrupt?.();
  }

  activeSource() {
    if (this.wifi.status().connected) return "wifi";
    if (this.serial.status().connected) return "usb";
    return "";
  }

  activeGateway() {
    return this.activeSource() === "wifi" ? this.wifi : this.activeSource() === "usb" ? this.serial : null;
  }

  status() {
    const wifi = this.wifi.status();
    const usb = this.serial.status();
    const source = this.activeSource();
    const active = source === "wifi" ? wifi : source === "usb" ? usb : null;
    let connectionState = "off";
    if (this.enabled) connectionState = wifi.connected ? "ready" : usb.connected ? "usb-ready" : wifi.connectionState === "setup-required" ? "setup-required" : "connecting";
    const error = active ? active.error : wifi.error || (wifi.connectionState === "error" ? wifi.error : "");
    return {
      enabled: this.enabled,
      requestedPort: usb.requestedPort,
      port: source === "wifi" ? wifi.remoteAddress : usb.port,
      connectionState,
      deviceState: active?.deviceState || "idle",
      connected: Boolean(active?.connected),
      wirelessConnected: Boolean(wifi.connected),
      transport: source,
      device: active?.device || usb.device || wifi.device || null,
      error,
      wifi,
      usb,
      wifiSetup: { ...this.wifiSetupStatus },
    };
  }

  async configure({ enabled, port = "", deviceId = "", token = "", captureMode = this.captureMode, vadThreshold = this.vadThreshold } = {}) {
    this.enabled = enabled === true;
    this.captureMode = captureMode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = Math.max(80, Math.min(800, Math.round(Number(vadThreshold) || 120)));
    if (!this.enabled) {
      await this.disconnect();
      this.onStatus(this.status());
      return this.status();
    }
    const results = await Promise.allSettled([
      this.wifi.configure({ enabled: true, deviceId, token, captureMode: this.captureMode, vadThreshold: this.vadThreshold }),
      this.serial.configure({ enabled: true, port, captureMode: this.captureMode, vadThreshold: this.vadThreshold }),
    ]);
    const bothFailed = results.every((result) => result.status === "rejected");
    if (bothFailed) throw results[0].reason;
    this.onStatus(this.status());
    return this.status();
  }

  async setPairing({ deviceId, token } = {}) {
    return this.wifi.configure({ enabled: this.enabled, deviceId, token, captureMode: this.captureMode, vadThreshold: this.vadThreshold });
  }

  async setCaptureMode(mode, vadThreshold = this.vadThreshold) {
    this.captureMode = mode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = Math.max(80, Math.min(800, Math.round(Number(vadThreshold) || 120)));
    await Promise.all([
      this.serial.setCaptureMode(this.captureMode, this.vadThreshold),
      this.wifi.setCaptureMode(this.captureMode, this.vadThreshold),
    ]);
    return this.captureMode;
  }

  async provisionWifi(options) {
    return this.serial.provisionWifi(options);
  }

  listPorts() {
    return this.serial.listPorts();
  }

  async setDeviceState(state) {
    const gateway = this.activeGateway();
    if (!gateway) throw new Error("ATOM Echoが接続されていません。");
    return gateway.setDeviceState(state);
  }

  async stopPlayback() {
    const gateways = [this.wifi, this.serial].filter((gateway) => gateway.status().connected);
    await Promise.all(gateways.map((gateway) => gateway.stopPlayback().catch(() => {})));
  }

  async playPcm16(pcm, sampleRate) {
    const gateway = this.activeGateway();
    if (!gateway) throw new Error("ATOM Echoが接続されていません。");
    return gateway.playPcm16(pcm, sampleRate);
  }

  async beginPcm16Playback(sampleRate) {
    const gateway = this.activeGateway();
    if (!gateway) throw new Error("ATOM Echoが接続されていません。");
    const generation = await gateway.beginPcm16Playback(sampleRate);
    return { gateway, generation };
  }

  async writePcm16PlaybackChunk(pcm, session) {
    if (!session?.gateway || session.gateway !== this.activeGateway()) return { interrupted: true };
    return session.gateway.writePcm16PlaybackChunk(pcm, session.generation);
  }

  async endPcm16Playback(session) {
    if (!session?.gateway || session.gateway !== this.activeGateway()) return { interrupted: true };
    return session.gateway.endPcm16Playback(session.generation);
  }

  async disconnect() {
    this.enabled = false;
    await Promise.all([
      this.interruptInput(),
      this.serial.configure({ enabled: false }),
      this.wifi.configure({ enabled: false }),
    ]);
  }
}

module.exports = { AtomEchoHub };
