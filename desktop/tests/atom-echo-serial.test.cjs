// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { AtomEchoSerialGateway } = require("../lib/atom-echo-serial.cjs");
const {
  AtomEchoFrameDecoder,
  FRAME_TYPES,
  ackPayload,
  encodeFrame,
} = require("../lib/atom-echo-protocol.cjs");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

class FakeSerialPort extends EventEmitter {
  static instances = [];
  static async list() {
    return [{ path: "COM3", vendorId: "0403", productId: "6001", manufacturer: "FTDI" }];
  }

  constructor({ path, baudRate }) {
    super();
    this.path = path;
    this.baudRate = baudRate;
    this.isOpen = false;
    this.decoder = new AtomEchoFrameDecoder();
    this.hostFrames = [];
    FakeSerialPort.instances.push(this);
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
      if (frame.type === FRAME_TYPES.HOST_HELLO) {
        setImmediate(() => this.emit("data", encodeFrame(
          FRAME_TYPES.DEVICE_HELLO,
          8,
          JSON.stringify({ board: "atom-echo", firmware: "0.5.1-handsfree-vad-mvp" }),
        )));
      }
      if ([FRAME_TYPES.AUDIO_BEGIN, FRAME_TYPES.AUDIO_CHUNK, FRAME_TYPES.AUDIO_END, FRAME_TYPES.CAPTURE_CONFIG].includes(frame.type)) {
        setImmediate(() => this.emit("data", encodeFrame(FRAME_TYPES.ACK, 9, ackPayload(frame.type, frame.sequence))));
      }
    }
    callback?.();
  }
}

test("ATOM Echo gateway auto-detects COM3, streams playback, and preserves PTT order", async () => {
  FakeSerialPort.instances.length = 0;
  const events = [];
  const vadStatuses = [];
  const gateway = new AtomEchoSerialGateway({
    SerialPortClass: FakeSerialPort,
    onPttStart: async () => events.push("start"),
    onPcmChunk: async (bytes) => events.push(`pcm:${bytes.length}`),
    onPttEnd: async () => events.push("end"),
    onCaptureStatus: async (status) => vadStatuses.push(status),
  });
  await gateway.configure({ enabled: true, captureMode: "hands-free", vadThreshold: 180 });
  await nextTurn();
  assert.equal(gateway.status().connected, true);
  assert.equal(gateway.status().port, "COM3");
  const port = FakeSerialPort.instances[0];
  assert.deepEqual(port.hostFrames.find((frame) => frame.type === FRAME_TYPES.CAPTURE_CONFIG)?.payload, Buffer.from([1, 180, 0]));

  const statusPayload = Buffer.alloc(12);
  statusPayload[0] = 1;
  statusPayload.writeUInt16LE(160, 1);
  statusPayload.writeUInt16LE(70, 3);
  statusPayload.writeUInt16LE(180, 5);
  statusPayload.writeUInt16LE(105, 7);
  port.emit("data", encodeFrame(FRAME_TYPES.CAPTURE_STATUS, 19, statusPayload));
  await nextTurn();
  assert.equal(vadStatuses[0]?.rms, 160);
  assert.equal(vadStatuses[0]?.startThreshold, 180);

  const played = await gateway.playPcm16(Buffer.alloc(2500), 16_000);
  assert.deepEqual(played, { interrupted: false });
  assert.equal(port.hostFrames.filter((frame) => frame.type === FRAME_TYPES.AUDIO_CHUNK).length, 3);

  port.emit("data", Buffer.concat([
    encodeFrame(FRAME_TYPES.PTT_START, 20),
    encodeFrame(FRAME_TYPES.PCM_CHUNK, 21, Buffer.alloc(640)),
    encodeFrame(FRAME_TYPES.PTT_END, 22),
  ]));
  await nextTurn();
  await nextTurn();
  assert.deepEqual(events, ["start", "pcm:640", "end"]);
  await gateway.configure({ enabled: false });
});
