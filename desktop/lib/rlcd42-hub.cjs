// SPDX-License-Identifier: Apache-2.0
const { Rlcd42SerialGateway } = require("./rlcd42-serial.cjs");
const { Rlcd42WifiGateway } = require("./rlcd42-wifi.cjs");

class Rlcd42Hub {
  constructor({
    onInput,
    onPttStart,
    onPcmChunk,
    onPttEnd,
    onInterrupt,
    onWifiStatus,
    onCaptureStatus,
    onReady,
    onStatus = () => {},
    logger = null,
  } = {}) {
    this.enabled = false;
    this.transportPreference = "auto";
    this.captureMode = "push-to-talk";
    this.vadThreshold = 120;
    this.microphoneEnabled = true;
    this.inputSource = "";
    this.wifiSetupStatus = {};
    this.lastError = "";
    this.onStatus = onStatus;

    const active = (source) => this.inputSource === source || (!this.inputSource && this.activeSource() === source);
    const callbacks = (source) => ({
      onInput: async (event) => this.activeSource() === source ? onInput?.(event) : undefined,
      onPttStart: async () => {
        if (this.activeSource() !== source) return;
        this.inputSource = source;
        try {
          return await onPttStart?.();
        } catch (error) {
          this.inputSource = "";
          throw error;
        }
      },
      onPcmChunk: async (chunk) => active(source) ? onPcmChunk?.(chunk) : undefined,
      onPttEnd: async () => {
        if (!active(source)) return;
        try { return await onPttEnd?.(); }
        finally { this.inputSource = ""; }
      },
      onInterrupt: async () => {
        if (!active(source)) return;
        this.inputSource = "";
        return onInterrupt?.();
      },
      onCaptureStatus: async (status) => active(source) ? onCaptureStatus?.({ ...status, source }) : undefined,
      onReady: async (status) => this.activeSource() === source ? onReady?.({ ...status, source }) : undefined,
      onStatus: () => {
        const sourceStatus = source === "wifi" ? this.wifi?.status() : this.serial?.status();
        if (this.inputSource === source && sourceStatus && !sourceStatus.connected) {
          this.inputSource = "";
          Promise.resolve(onInterrupt?.()).catch((error) => {
            logger?.("warn", `RLCD ${source} capture disconnect cleanup failed: ${error.message}`);
          });
        }
        this.onStatus(this.status());
      },
      logger,
    });

    this.serial = new Rlcd42SerialGateway({
      ...callbacks("usb"),
      onWifiStatus: async (status) => {
        this.wifiSetupStatus = status && typeof status === "object" ? { ...status } : {};
        this.onStatus(this.status());
        return onWifiStatus?.(this.wifiSetupStatus);
      },
    });
    this.wifi = new Rlcd42WifiGateway(callbacks("wifi"));
  }

  activeSource() {
    if (this.transportPreference === "usb") return this.serial.status().connected ? "usb" : "";
    if (this.transportPreference === "wifi") return this.wifi.status().connected ? "wifi" : "";
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
    if (this.enabled) {
      if (active?.connected) connectionState = source === "usb" && this.transportPreference === "auto" ? "usb-ready" : "ready";
      else if (wifi.connectionState === "setup-required" && this.transportPreference !== "usb") connectionState = "setup-required";
      else connectionState = "connecting";
    }
    return {
      enabled: this.enabled,
      requestedPort: usb.requestedPort,
      port: source === "wifi" ? wifi.remoteAddress : usb.port,
      connectionState,
      connected: Boolean(active?.connected),
      wirelessConnected: Boolean(wifi.connected),
      transport: source,
      transportPreference: this.transportPreference,
      device: active?.device || usb.device || wifi.device || null,
      capabilities: active?.capabilities || usb.capabilities || wifi.capabilities || null,
      sensors: active?.sensors || usb.sensors || wifi.sensors || null,
      captureMode: this.captureMode,
      vadThreshold: this.vadThreshold,
      microphoneEnabled: this.microphoneEnabled,
      // A deliberately inactive fallback (for example a disconnected USB
      // cable while Wi-Fi is healthy) must not make the active route look
      // broken in Settings.
      error: this.lastError || (active ? active.error : (wifi.error || usb.error)) || "",
      wifi,
      usb,
      wifiSetup: { ...this.wifiSetupStatus },
    };
  }

  async configure({
    enabled,
    transport = this.transportPreference,
    port = "",
    deviceId = "",
    token = "",
    captureMode = this.captureMode,
    vadThreshold = this.vadThreshold,
    microphoneEnabled = this.microphoneEnabled,
  } = {}) {
    this.enabled = enabled === true;
    this.transportPreference = ["usb", "wifi"].includes(transport) ? transport : "auto";
    this.captureMode = captureMode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = Math.max(80, Math.min(800, Math.round(Number(vadThreshold) || 120)));
    this.microphoneEnabled = microphoneEnabled !== false;
    if (!this.enabled) {
      await Promise.all([
        this.serial.configure({ enabled: false }),
        this.wifi.configure({ enabled: false }),
      ]);
      this.inputSource = "";
      this.onStatus(this.status());
      return this.status();
    }

    const wifiEnabled = this.transportPreference !== "usb";
    const serialMicrophone = this.transportPreference !== "wifi" && this.microphoneEnabled;
    const results = await Promise.allSettled([
      this.serial.configure({
        enabled: true,
        port,
        captureMode: this.captureMode,
        vadThreshold: this.vadThreshold,
        microphoneEnabled: serialMicrophone,
      }),
      this.wifi.configure({
        enabled: wifiEnabled,
        deviceId,
        token,
        captureMode: this.captureMode,
        vadThreshold: this.vadThreshold,
        microphoneEnabled: this.microphoneEnabled,
      }),
    ]);
    if (results.every((result) => result.status === "rejected")) throw results[0].reason;
    this.onStatus(this.status());
    return this.status();
  }

  async setPairing({ deviceId, token } = {}) {
    return this.wifi.configure({
      enabled: this.enabled && this.transportPreference !== "usb",
      deviceId,
      token,
      captureMode: this.captureMode,
      vadThreshold: this.vadThreshold,
      microphoneEnabled: this.microphoneEnabled,
    });
  }

  async setCaptureMode(mode, vadThreshold = this.vadThreshold, microphoneEnabled = this.microphoneEnabled) {
    this.captureMode = mode === "hands-free" ? "hands-free" : "push-to-talk";
    this.vadThreshold = Math.max(80, Math.min(800, Math.round(Number(vadThreshold) || 120)));
    this.microphoneEnabled = microphoneEnabled !== false;
    await Promise.all([
      this.serial.setCaptureMode(
        this.captureMode,
        this.vadThreshold,
        this.transportPreference !== "wifi" && this.microphoneEnabled,
      ),
      this.wifi.setCaptureMode(this.captureMode, this.vadThreshold, this.microphoneEnabled),
    ]);
    return this.captureMode;
  }

  provisionWifi(options) { return this.serial.provisionWifi(options); }
  listPorts() { return this.serial.listPorts(); }

  clearError() {
    if (!this.lastError) return;
    this.lastError = "";
    this.onStatus(this.status());
  }

  reportError(error) {
    this.lastError = String(error?.message || error || "").slice(0, 500);
    this.onStatus(this.status());
  }

  requireGateway() {
    const gateway = this.activeGateway();
    if (!gateway) throw new Error("RLCD 4.2が接続されていません。");
    return gateway;
  }

  sendPortrait(...args) { return this.requireGateway().sendPortrait(...args); }
  sendPortraitFrame(...args) { return this.requireGateway().sendPortraitFrame(...args); }
  sendScene(...args) { return this.requireGateway().sendScene(...args); }
  setDeviceState(...args) { return this.requireGateway().setDeviceState(...args); }
  playPcm16(...args) { return this.requireGateway().playPcm16(...args); }

  async stopPlayback() {
    const gateways = [this.wifi, this.serial].filter((gateway) => gateway.status().connected);
    await Promise.all(gateways.map((gateway) => gateway.stopPlayback().catch(() => {})));
    return { interrupted: Boolean(gateways.length) };
  }

  async beginPcm16Playback(sampleRate) {
    const gateway = this.requireGateway();
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
    this.inputSource = "";
    await Promise.all([
      this.serial.configure({ enabled: false }),
      this.wifi.configure({ enabled: false }),
    ]);
  }
}

module.exports = { Rlcd42Hub };
