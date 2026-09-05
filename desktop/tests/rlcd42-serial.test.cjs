// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Rlcd42SerialGateway } = require("../lib/rlcd42-serial.cjs");
const {
  DeviceProtocolV2Decoder,
  FRAME_TYPES,
  encodeFrame,
} = require("../lib/device-protocol-v2.cjs");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("ACK deadline also bounds a stalled transport write callback", async () => {
  const gateway = new Rlcd42SerialGateway();
  gateway.connectionState = "ready";
  gateway.writeBytes = () => new Promise(() => {});
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(gateway.writeWithAck(FRAME_TYPES.AUDIO_CHUNK, Buffer.alloc(2), { timeoutMs: 10 }), /AUDIO_CHUNK/);
    assert.equal(gateway.pending.size, 0);
  } finally { clearTimeout(keepAlive); }
});

test("failed old playback never stops a replacement playback", async () => {
  const gateway = new Rlcd42SerialGateway();
  gateway.connectionState = "ready";
  gateway.capabilities = { capabilities: { audio: { playback: true } } };
  let stopped = false;
  gateway.stopPlayback = async () => { stopped = true; };
  gateway.writeWithAck = async (type) => {
    if (type === FRAME_TYPES.AUDIO_CHUNK) {
      gateway.playbackGeneration++;
      gateway.activePlayback = { generation: gateway.playbackGeneration };
      throw new Error("old transfer failed");
    }
  };
  await assert.rejects(gateway.playPcm16(Buffer.alloc(640)), /old transfer/);
  assert.equal(stopped, false);
  assert.equal(gateway.activePlayback.generation, gateway.playbackGeneration);
});

for (const failedType of [FRAME_TYPES.AUDIO_BEGIN, FRAME_TYPES.AUDIO_CHUNK, FRAME_TYPES.AUDIO_END]) {
  test(`failed playback ${failedType} sends STOP and restores idle`, async () => {
    const gateway = new Rlcd42SerialGateway();
    gateway.connectionState = "ready";
    gateway.capabilities = { capabilities: { audio: { playback: true } } };
    const commands = [];
    gateway.writeWithAck = async (type, payload) => {
      commands.push([type, payload]);
      if (type === failedType) throw new Error("test timeout");
    };
    await assert.rejects(gateway.playPcm16(Buffer.alloc(640)), /test timeout/);
    assert.equal(gateway.activePlayback, null);
    assert.ok(commands.some(([type]) => type === FRAME_TYPES.AUDIO_STOP));
    assert.equal(commands.at(-1)[0], FRAME_TYPES.STATE);
    assert.equal(commands.at(-1)[1][0], 0);
  });
}

test("disconnect before write completion does not create an unhandled ACK rejection", async () => {
  const gateway = new Rlcd42SerialGateway();
  const pending = gateway.pendingResponse("ack:test", 1000, "timeout");
  gateway.rejectPending("disconnected");
  await nextTurn();
  await assert.rejects(pending.promise, /disconnected/);
  assert.equal(gateway.pending.size, 0);
});
const waitUntil = async (predicate, timeoutMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for RLCD test condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

class FakeRlcdSerialPort extends EventEmitter {
  static instances = [];
  static cacheCharacter = false;
  static droppedHostHelloAcks = 0;
  static captureSupported = true;
  static async list() {
    return [{ path: "COM7", vendorId: "303a", productId: "1001", manufacturer: "Espressif" }];
  }

  constructor({ path, baudRate }) {
    super();
    this.path = path;
    this.baudRate = baudRate;
    this.isOpen = false;
    this.decoder = new DeviceProtocolV2Decoder();
    this.hostFrames = [];
    FakeRlcdSerialPort.instances.push(this);
  }

  open(callback) {
    this.isOpen = true;
    callback();
  }

  close(callback) {
    this.isOpen = false;
    this.emit("close");
    callback?.();
  }

  write(bytes, callback) {
    for (const frame of this.decoder.push(bytes)) {
      this.hostFrames.push(frame);
      if (frame.type === FRAME_TYPES.DEVICE_HELLO && frame.payload.length === 0) {
        this.reply(frame.type, frame.sequence, {
          board: "waveshare-esp32-s3-rlcd-4.2",
          firmware: "0.1.0-preview",
          deviceId: "cd-rlcd-001122334455",
          transport: "usb",
        });
      } else if (frame.type === FRAME_TYPES.CAPABILITIES && frame.payload.length === 0) {
        this.reply(frame.type, frame.sequence, {
          protocol: 2,
          board: "waveshare-esp32-s3-rlcd-4.2",
          capabilities: {
            display: { width: 400, height: 300, bitsPerPixel: 1, bitmap: ["raw1-msb"] },
            audio: { capture: FakeRlcdSerialPort.captureSupported, playback: true, format: "pcm-s16le-mono", sampleRates: [16000] },
          },
        });
      } else if (frame.type === FRAME_TYPES.WIFI_STATUS && frame.payload.length === 0) {
        this.reply(frame.type, frame.sequence, {
          configured: true,
          connected: false,
          ssid: "test-network",
          ip: "",
        });
      } else if (frame.type === FRAME_TYPES.SENSOR_REPORT && frame.payload.length === 0) {
        const sensor = Buffer.alloc(18);
        sensor[0] = 1;
        sensor[1] = 0x07;
        sensor.writeInt16LE(2500, 2);
        sensor.writeUInt16LE(5000, 4);
        sensor.writeUInt16LE(3900, 6);
        sensor[8] = 72;
        this.reply(frame.type, frame.sequence, sensor);
      } else {
        if (frame.type === FRAME_TYPES.HOST_HELLO && frame.payload.length === 0
          && FakeRlcdSerialPort.droppedHostHelloAcks > 0) {
          FakeRlcdSerialPort.droppedHostHelloAcks -= 1;
          continue;
        }
        const applyResult = frame.type === FRAME_TYPES.CHARACTER_CHANGED && FakeRlcdSerialPort.cacheCharacter ? 2 : 0;
        setImmediate(() => this.emit("data", encodeFrame(
          FRAME_TYPES.ACK,
          frame.sequence,
          Buffer.from([frame.type, applyResult, 0, 0]),
        )));
      }
    }
    callback?.();
  }

  reply(type, sequence, value) {
    const payload = Buffer.isBuffer(value) ? value : JSON.stringify(value);
    setImmediate(() => this.emit("data", encodeFrame(type, sequence, payload)));
  }
}

test("RLCD gateway validates Protocol v2 capabilities and syncs time", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = false;
  FakeRlcdSerialPort.droppedHostHelloAcks = 0;
  const gateway = new Rlcd42SerialGateway({ SerialPortClass: FakeRlcdSerialPort });
  const status = await gateway.configure({ enabled: true });
  assert.equal(status.connected, true);
  assert.equal(status.port, "COM7");
  assert.equal(status.device.deviceId, "cd-rlcd-001122334455");
  assert.equal(status.capabilities.audio.playback, true);
  assert.equal(status.sensors.temperatureC, 25);
  const port = FakeRlcdSerialPort.instances[0];
  assert.equal(port.baudRate, 500000);
  assert.ok(port.hostFrames.some((frame) => frame.type === FRAME_TYPES.TIME_SYNC));
  await gateway.configure({ enabled: false });
});

test("RLCD gateway keeps legacy display and speaker firmware connectable without sending CaptureConfig", async (context) => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.captureSupported = false;
  context.after(() => { FakeRlcdSerialPort.captureSupported = true; });
  const gateway = new Rlcd42SerialGateway({ SerialPortClass: FakeRlcdSerialPort });
  context.after(() => gateway.configure({ enabled: false }));
  const status = await gateway.configure({ enabled: true, microphoneEnabled: true });
  assert.equal(status.connected, true);
  assert.equal(status.capabilities.audio.capture, false);
  assert.equal(
    FakeRlcdSerialPort.instances[0].hostFrames.some((frame) => frame.type === FRAME_TYPES.CAPTURE_CONFIG),
    false,
  );
  await assert.rejects(
    gateway.setCaptureMode("push-to-talk", 120, true),
    /マイク対応ファームウェア/,
  );
});

test("RLCD gateway uploads a 400x300 portrait and commits a scene atomically", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = false;
  FakeRlcdSerialPort.droppedHostHelloAcks = 0;
  const gateway = new Rlcd42SerialGateway({ SerialPortClass: FakeRlcdSerialPort });
  await gateway.configure({ enabled: true, port: "COM7" });
  const portrait = await gateway.sendPortrait({
    width: 400,
    height: 300,
    pixels: Buffer.alloc(15000, 0xa5),
    revision: "sha256:0123456789abcdef0123456789abcdef",
  });
  assert.deepEqual(portrait, {
    cached: false,
    revision: "sha256:0123456789abcdef0123456789abcdef",
    bytes: 15000,
  });
  await gateway.sendScene({
    scene: "home",
    state: "idle",
    characterName: "アンバー",
    modeLabel: "CHAT",
    activity: "ボタンを短く押すと表示を切り替えます",
    footer: "USB CONNECTED",
  });
  const frames = FakeRlcdSerialPort.instances[0].hostFrames;
  assert.equal(frames.filter((frame) => frame.type === FRAME_TYPES.ASSET_CHUNK).length, 4);
  const sceneIndex = frames.findIndex((frame) => frame.type === FRAME_TYPES.DISPLAY_SCENE);
  const textIndex = frames.findIndex((frame) => frame.type === FRAME_TYPES.DISPLAY_TEXT);
  const commitIndex = frames.findIndex((frame) => frame.type === FRAME_TYPES.DISPLAY_COMMIT);
  assert.ok(sceneIndex >= 0 && textIndex > sceneIndex && commitIndex > textIndex);
  await gateway.configure({ enabled: false });
});

test("RLCD gateway skips a cached portrait transfer", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = true;
  FakeRlcdSerialPort.droppedHostHelloAcks = 0;
  const gateway = new Rlcd42SerialGateway({ SerialPortClass: FakeRlcdSerialPort });
  await gateway.configure({ enabled: true });
  const result = await gateway.sendPortrait({
    width: 400,
    height: 300,
    pixels: Buffer.alloc(15000),
    revision: "sha256:fedcba9876543210fedcba9876543210",
  });
  assert.equal(result.cached, true);
  assert.equal(FakeRlcdSerialPort.instances[0].hostFrames.some((frame) => frame.type === FRAME_TYPES.ASSET_META), false);
  await gateway.configure({ enabled: false });
});

test("RLCD gateway surfaces sensor and input reports", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = false;
  FakeRlcdSerialPort.droppedHostHelloAcks = 0;
  const inputs = [];
  const gateway = new Rlcd42SerialGateway({
    SerialPortClass: FakeRlcdSerialPort,
    onInput: async (event) => inputs.push(event),
  });
  await gateway.configure({ enabled: true });
  const port = FakeRlcdSerialPort.instances[0];
  const sensor = Buffer.alloc(18);
  sensor[0] = 1;
  sensor[1] = 0x07;
  sensor.writeInt16LE(2500, 2);
  sensor.writeUInt16LE(5000, 4);
  sensor.writeUInt16LE(3900, 6);
  sensor[8] = 72;
  port.emit("data", Buffer.concat([
    encodeFrame(FRAME_TYPES.SENSOR_REPORT, 88, sensor),
    encodeFrame(FRAME_TYPES.INPUT_EVENT, 89, Buffer.from([1, 0, 1, 0xa4, 1, 0, 0])),
  ]));
  await nextTurn();
  assert.equal(gateway.status().sensors.temperatureC, 25);
  assert.deepEqual(inputs, [{ button: 0, event: 1, durationMs: 420 }]);
  await gateway.configure({ enabled: false });
});

test("RLCD gateway validates a portrait before changing device cache state", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = false;
  FakeRlcdSerialPort.droppedHostHelloAcks = 0;
  const gateway = new Rlcd42SerialGateway({ SerialPortClass: FakeRlcdSerialPort });
  await gateway.configure({ enabled: true });
  const port = FakeRlcdSerialPort.instances[0];
  const before = port.hostFrames.length;
  await assert.rejects(gateway.sendPortrait({
    width: 400,
    height: 300,
    pixels: Buffer.alloc(14999),
    revision: "sha256:invalid-size",
  }), /dimensions do not match/i);
  assert.equal(port.hostFrames.length, before);
  assert.equal(port.hostFrames.some((frame, index) => index >= before && frame.type === FRAME_TYPES.CHARACTER_CHANGED), false);
  await gateway.configure({ enabled: false });
});

test("RLCD gateway heartbeats, reconnects, and announces each ready session", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = false;
  FakeRlcdSerialPort.droppedHostHelloAcks = 1;
  const readySessions = [];
  const gateway = new Rlcd42SerialGateway({
    SerialPortClass: FakeRlcdSerialPort,
    heartbeatIntervalMs: 10,
    heartbeatTimeoutMs: 10,
    reconnectDelayMs: 10,
    maxReconnectDelayMs: 20,
    onReady: async (status) => readySessions.push(status.device.deviceId),
  });
  await gateway.configure({ enabled: true });
  await waitUntil(() => FakeRlcdSerialPort.instances.length >= 2 && readySessions.length >= 2, 500);
  assert.ok(FakeRlcdSerialPort.instances[0].hostFrames.some((frame) => frame.type === FRAME_TYPES.HOST_HELLO));
  assert.equal(gateway.status().connected, true);
  assert.equal(gateway.status().reconnectAttempt, 0);
  assert.deepEqual(readySessions, ["cd-rlcd-001122334455", "cd-rlcd-001122334455"]);
  await gateway.configure({ enabled: false });
});

test("RLCD gateway transfers known PCM with an exact sample count", async () => {
  FakeRlcdSerialPort.instances.length = 0;
  FakeRlcdSerialPort.cacheCharacter = false;
  FakeRlcdSerialPort.droppedHostHelloAcks = 0;
  const gateway = new Rlcd42SerialGateway({ SerialPortClass: FakeRlcdSerialPort });
  await gateway.configure({ enabled: true });
  const result = await gateway.playPcm16(Buffer.alloc(5000), 16_000);
  assert.deepEqual(result, { interrupted: false });
  const frames = FakeRlcdSerialPort.instances[0].hostFrames;
  const begin = frames.find((frame) => frame.type === FRAME_TYPES.AUDIO_BEGIN);
  assert.ok(begin);
  assert.equal(begin.payload.readUInt32LE(0), 16_000);
  assert.equal(begin.payload.readUInt32LE(4), 2500);
  assert.equal(frames.filter((frame) => frame.type === FRAME_TYPES.AUDIO_CHUNK).length, 2);
  assert.equal(frames.filter((frame) => frame.type === FRAME_TYPES.AUDIO_CHUNK)
    .reduce((sum, frame) => sum + frame.payload.length, 0), 5000);
  assert.ok(frames.some((frame) => frame.type === FRAME_TYPES.AUDIO_END));
  await gateway.configure({ enabled: false });
});
