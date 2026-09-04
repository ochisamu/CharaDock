// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const { Rlcd42SerialGateway } = require("../lib/rlcd42-serial.cjs");
const { AtomEchoSerialGateway } = require("../lib/atom-echo-serial.cjs");
const { Rlcd42WifiGateway } = require("../lib/rlcd42-wifi.cjs");
const { AtomEchoWifiGateway } = require("../lib/atom-echo-wifi.cjs");
const rlcd = require("../lib/device-protocol-v2.cjs");
const atom = require("../lib/atom-echo-protocol.cjs");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

for (const [name, Gateway, protocol] of [
  ["RLCD serial/Wi-Fi inner", Rlcd42SerialGateway, rlcd],
  ["ATOM serial", AtomEchoSerialGateway, atom],
  ["ATOM Wi-Fi", AtomEchoWifiGateway, atom],
]) {
  const F = protocol.FRAME_TYPES;
  test(`${name}: duplicate start preserves startup barrier and PCM`, async () => {
    const start = deferred();
    const events = [];
    const gateway = new Gateway({
      onPttStart: async () => { events.push("start"); await start.promise; events.push("ready"); },
      onPcmChunk: () => events.push("pcm"),
      onPttEnd: () => events.push("end"),
    });
    for (const type of [F.PTT_START, F.PTT_START, F.PCM_CHUNK, F.PTT_END]) {
      gateway.handleFrame({ type, payload: Buffer.alloc(2) });
    }
    await tick();
    assert.deepEqual(events, ["start"]);
    start.resolve();
    await gateway.captureQueue;
    assert.deepEqual(events, ["start", "ready", "pcm", "end"]);
  });

  test(`${name}: new start follows old PCM/end without waiting for reply`, async () => {
    const pcm = deferred();
    const reply = deferred();
    const events = [];
    const gateway = new Gateway({
      onPttStart: () => events.push("start"),
      onPcmChunk: async () => { await pcm.promise; events.push("pcm"); },
      onPttEnd: () => { events.push("end"); return reply.promise; },
    });
    for (const type of [F.PTT_START, F.PCM_CHUNK, F.PTT_END, F.PTT_START]) {
      gateway.handleFrame({ type, payload: Buffer.alloc(2) });
    }
    await tick();
    assert.deepEqual(events, ["start"]);
    pcm.resolve();
    await gateway.captureQueue;
    assert.deepEqual(events, ["start", "pcm", "end", "start"]);
    reply.resolve();
  });

  test(`${name}: disconnect invalidates queued old input after reconnect`, async () => {
    const start = deferred();
    const events = [];
    const gateway = new Gateway({
      onPttStart: () => start.promise,
      onPcmChunk: () => events.push("pcm"),
      onPttEnd: () => events.push("end"),
    });
    for (const type of [F.PTT_START, F.PCM_CHUNK, F.PTT_END]) gateway.handleFrame({ type, payload: Buffer.alloc(2) });
    await tick();
    const oldQueue = gateway.captureQueue;
    await gateway.disconnect();
    gateway.handleFrame({ type: F.PTT_START });
    start.resolve();
    await oldQueue;
    await gateway.captureQueue;
    assert.deepEqual(events, []);
  });

  test(`${name}: failed startup drops its queued PCM/end and permits next utterance`, async () => {
    let starts = 0;
    const events = [];
    const gateway = new Gateway({
      onPttStart: () => { if (++starts === 1) throw new Error("startup failed"); },
      onPcmChunk: () => events.push("pcm"),
      onPttEnd: () => events.push("end"),
    });
    gateway.reportCallbackError = (error) => events.push(error.message);
    for (let utterance = 0; utterance < 2; utterance += 1) {
      for (const type of [F.PTT_START, F.PCM_CHUNK, F.PTT_END]) gateway.handleFrame({ type, payload: Buffer.alloc(2) });
      await gateway.captureQueue;
    }
    assert.deepEqual(events, ["startup failed", "pcm", "end"]);
  });

  for (const failure of ["startup", "append"]) {
    test(`${name}: retries after ${failure} failure without an END frame`, async () => {
      let starts = 0;
      const events = [];
      const gateway = new Gateway({
        onPttStart: () => {
          starts += 1;
          if (starts === 1 && failure === "startup") throw new Error("input failed");
        },
        onPcmChunk: () => {
          if (starts === 1) throw new Error("input failed");
          events.push("pcm");
        },
        onPttEnd: () => events.push("end"),
      });
      gateway.reportCallbackError = (error) => events.push(error.message);
      for (const type of [F.PTT_START, F.PCM_CHUNK]) gateway.handleFrame({ type, payload: Buffer.alloc(2) });
      await gateway.captureQueue;
      // Firmware aborts the failed utterance without sending END.
      for (const type of [F.PTT_START, F.PCM_CHUNK, F.PTT_END]) gateway.handleFrame({ type, payload: Buffer.alloc(2) });
      await gateway.captureQueue;
      assert.equal(starts, 2);
      assert.deepEqual(events, ["input failed", "pcm", "end"]);
    });
  }
}

class Port extends EventEmitter {
  static instances = [];
  static async list() { return [{ path: "COM7", vendorId: "303a" }]; }
  constructor() { super(); this.isOpen = false; Port.instances.push(this); }
  open(callback) { this.isOpen = true; callback(); }
  close(callback) { this.isOpen = false; this.emit("close"); callback?.(); }
}

for (const [name, Gateway, protocol] of [["RLCD", Rlcd42SerialGateway, rlcd], ["ATOM", AtomEchoSerialGateway, atom]]) {
  test(`${name}: superseded open closes only its own port`, async () => {
    const ports = [];
    class DelayedPort extends Port {
      constructor() { super(); ports.push(this); }
      open(callback) { this.finishOpen = () => { this.isOpen = true; callback(); }; }
    }
    const gateway = new Gateway({ SerialPortClass: DelayedPort });
    gateway.initializeOpenedPort = async () => {};
    gateway.writeFrame = gateway.setDeviceState = async () => {};
    const first = gateway.configure({ enabled: true, port: "COM7" });
    await tick();
    const second = gateway.configure({ enabled: true, port: "COM7" });
    await tick();
    assert.equal(ports.length, 2);
    ports[1].finishOpen();
    await second;
    ports[0].finishOpen();
    await first;
    assert.equal(gateway.port, ports[1]);
    assert.equal(ports[1].isOpen, true);
    assert.equal(ports[0].isOpen, false);
    await gateway.configure({ enabled: false });
  });

  test(`${name}: old port partial data/error/close cannot poison replacement`, async () => {
    const gateway = new Gateway({ SerialPortClass: Port });
    gateway.initializeOpenedPort = async () => {};
    gateway.writeFrame = async () => {};
    gateway.setDeviceState = async () => {};
    await gateway.configure({ enabled: true, port: "COM7" });
    const old = gateway.port;
    await gateway.configure({ enabled: true, port: "COM7" });
    const fresh = gateway.port;
    const frames = [];
    gateway.handleFrame = (frame) => frames.push(frame);
    const partial = protocol.encodeFrame(protocol.FRAME_TYPES.PCM_CHUNK, 1, Buffer.alloc(1024)).subarray(0, 13);
    old.emit("data", partial);
    old.emit("error", new Error("late error"));
    old.emit("close");
    const valid = protocol.encodeFrame(protocol.FRAME_TYPES.PTT_START, 2);
    fresh.emit("data", valid.subarray(0, 5));
    fresh.emit("data", valid.subarray(5));
    assert.equal(gateway.port, fresh);
    assert.equal(fresh.isOpen, true);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, protocol.FRAME_TYPES.PTT_START);
    await gateway.configure({ enabled: false });
  });
}

for (const [name, Gateway, protocol, deviceId] of [
  ["RLCD", Rlcd42WifiGateway, rlcd, "cd-rlcd-001122334455"],
  ["ATOM", AtomEchoWifiGateway, atom, "atom-echo-001122334455"],
]) {
  test(`${name}: AUTH coalesced frames and split payload survive handoff`, async () => {
    const gateway = new Gateway();
    gateway.enabled = true;
    gateway.expectedDeviceId = deviceId;
    gateway.pairingToken = "ab".repeat(32);
    const socket = new EventEmitter();
    socket.remoteAddress = "127.0.0.1";
    socket.setNoDelay = socket.setKeepAlive = () => {};
    socket.write = (_bytes, callback) => { callback?.(); return true; };
    socket.destroy = () => { socket.destroyed = true; socket.emit("close"); };
    const frames = [];
    const adoption = deferred();
    if (name === "RLCD") {
      gateway.inner.initializeOpenedPort = async () => {};
      const adopt = gateway.inner.adoptOpenPort.bind(gateway.inner);
      gateway.inner.adoptOpenPort = async (...args) => { await adoption.promise; return adopt(...args); };
      gateway.inner.handleFrame = (frame) => frames.push(frame);
    } else {
      gateway.writeFrame = gateway.setDeviceState = gateway.setCaptureMode = async () => {};
      gateway.handleFrame = (frame) => frames.push(frame);
    }
    gateway.acceptSocket(socket);
    const candidate = [...gateway.candidates][0];
    candidate.deviceInfo = { deviceId };
    const proof = crypto.createHmac("sha256", Buffer.from(gateway.pairingToken, "hex")).update(candidate.challenge).digest();
    const F = protocol.FRAME_TYPES;
    const payload = Buffer.alloc(48, 0x7b);
    const pcm = protocol.encodeFrame(F.PCM_CHUNK, 3, payload);
    socket.emit("data", Buffer.concat([
      protocol.encodeFrame(F.DEVICE_AUTH, 1, proof),
      protocol.encodeFrame(F.PTT_START, 2),
      pcm.subarray(0, 17),
    ]));
    socket.emit("data", pcm.subarray(17));
    adoption.resolve();
    await tick();
    assert.deepEqual(frames.map((frame) => frame.type), [F.PTT_START, F.PCM_CHUNK]);
    assert.deepEqual(frames[1].payload, payload);
    await gateway.disconnect();
  });
}
