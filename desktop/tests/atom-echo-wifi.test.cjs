// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const net = require("node:net");
const test = require("node:test");
const {
  AtomEchoFrameDecoder,
  FRAME_TYPES,
  ackPayload,
  encodeFrame,
} = require("../lib/atom-echo-protocol.cjs");
const {
  AtomEchoWifiGateway,
  DISCOVERY_PREFIX,
  HOST_PREFIX,
  PLAYBACK_ACK_WINDOW,
} = require("../lib/atom-echo-wifi.cjs");

function waitFor(predicate, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 10);
  });
}

test("ATOM Echo Wi-Fi gateway discovers, authenticates, and streams one ordered turn", async (context) => {
  const token = "ab".repeat(32);
  const deviceId = "atom-echo-5002918f0974";
  const events = [];
  const vadStatuses = [];
  const gateway = new AtomEchoWifiGateway({
    discoveryPort: 0,
    audioPort: 0,
    host: "127.0.0.1",
    onPttStart: async () => events.push("start"),
    onPcmChunk: async (chunk) => events.push(`pcm:${chunk.length}`),
    onPttEnd: async () => events.push("end"),
    onCaptureStatus: async (status) => vadStatuses.push(status),
  });
  context.after(() => gateway.disconnect());
  await gateway.configure({ enabled: true, deviceId, token, captureMode: "hands-free", vadThreshold: 180 });

  const udp = dgram.createSocket("udp4");
  context.after(() => { try { udp.close(); } catch {} });
  const response = new Promise((resolve, reject) => {
    udp.once("message", (message) => resolve(message.toString("utf8")));
    udp.once("error", reject);
  });
  udp.send(Buffer.from(`${DISCOVERY_PREFIX}${deviceId}`), gateway.status().discoveryPort, "127.0.0.1");
  assert.equal(await response, `${HOST_PREFIX}${gateway.status().audioPort}`);

  const socket = net.createConnection({ host: "127.0.0.1", port: gateway.status().audioPort });
  context.after(() => socket.destroy());
  const decoder = new AtomEchoFrameDecoder();
  let sequence = 0;
  let sawHostHello = false;
  let captureModePayload = null;
  const delayedPlaybackChunks = [];
  let maximumUnacknowledgedPlaybackChunks = 0;
  let playbackAcksReleased = false;
  let audioEndedAfterPlaybackAcks = false;
  socket.on("data", (chunk) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.type === FRAME_TYPES.AUTH_CHALLENGE) {
        const proof = crypto.createHmac("sha256", Buffer.from(token, "hex")).update(frame.payload).digest();
        socket.write(encodeFrame(FRAME_TYPES.DEVICE_AUTH, ++sequence, proof));
      } else if (frame.type === FRAME_TYPES.HOST_HELLO) {
        sawHostHello = true;
      } else if (frame.type === FRAME_TYPES.CAPTURE_CONFIG) {
        captureModePayload = Buffer.from(frame.payload);
        socket.write(encodeFrame(FRAME_TYPES.ACK, ++sequence, ackPayload(frame.type, frame.sequence)));
      } else if (frame.type === FRAME_TYPES.AUDIO_CHUNK) {
        delayedPlaybackChunks.push(frame);
        maximumUnacknowledgedPlaybackChunks = Math.max(maximumUnacknowledgedPlaybackChunks, delayedPlaybackChunks.length);
        if (delayedPlaybackChunks.length === PLAYBACK_ACK_WINDOW) {
          const pendingChunks = delayedPlaybackChunks.splice(0);
          setTimeout(() => {
            for (const pending of pendingChunks) {
              socket.write(encodeFrame(FRAME_TYPES.ACK, ++sequence, ackPayload(pending.type, pending.sequence)));
            }
            playbackAcksReleased = true;
          }, 25);
        }
      } else if (frame.type === FRAME_TYPES.AUDIO_END) {
        audioEndedAfterPlaybackAcks = playbackAcksReleased;
        socket.write(encodeFrame(FRAME_TYPES.ACK, ++sequence, ackPayload(frame.type, frame.sequence)));
      } else if ([FRAME_TYPES.AUDIO_BEGIN, FRAME_TYPES.AUDIO_STOP, FRAME_TYPES.CAPTURE_CONFIG].includes(frame.type)) {
        socket.write(encodeFrame(FRAME_TYPES.ACK, ++sequence, ackPayload(frame.type, frame.sequence)));
      }
    }
  });
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  socket.write(encodeFrame(FRAME_TYPES.DEVICE_HELLO, ++sequence, Buffer.from(JSON.stringify({
    board: "atom-echo",
    firmware: "0.5.1-handsfree-vad-mvp",
    deviceId,
    sampleRate: 16_000,
    transport: "wifi",
  }))));
  await waitFor(() => gateway.status().connected && sawHostHello && captureModePayload);
  assert.deepEqual(captureModePayload, Buffer.from([1, 180, 0]));

  const statusPayload = Buffer.alloc(12);
  statusPayload[0] = 1;
  statusPayload.writeUInt16LE(155, 1);
  statusPayload.writeUInt16LE(65, 3);
  statusPayload.writeUInt16LE(180, 5);
  statusPayload.writeUInt16LE(100, 7);
  socket.write(encodeFrame(FRAME_TYPES.CAPTURE_STATUS, ++sequence, statusPayload));
  await waitFor(() => vadStatuses.length === 1);
  assert.equal(vadStatuses[0].rms, 155);

  socket.write(Buffer.concat([
    encodeFrame(FRAME_TYPES.PTT_START, ++sequence),
    encodeFrame(FRAME_TYPES.PCM_CHUNK, ++sequence, Buffer.alloc(320)),
    encodeFrame(FRAME_TYPES.PTT_END, ++sequence),
  ]));
  await waitFor(() => events.length === 3);
  assert.deepEqual(events, ["start", "pcm:320", "end"]);

  assert.deepEqual(await gateway.playPcm16(Buffer.alloc(PLAYBACK_ACK_WINDOW * 1_024), 16_000), { interrupted: false });
  assert.equal(maximumUnacknowledgedPlaybackChunks, PLAYBACK_ACK_WINDOW);
  assert.equal(audioEndedAfterPlaybackAcks, true);
  assert.equal(gateway.status().remoteAddress, "127.0.0.1");
});

test("ATOM Echo Wi-Fi gateway rejects a proof made with another pairing token", async (context) => {
  const token = "12".repeat(32);
  const deviceId = "atom-echo-5002918f0974";
  const gateway = new AtomEchoWifiGateway({ discoveryPort: 0, audioPort: 0, host: "127.0.0.1" });
  context.after(() => gateway.disconnect());
  await gateway.configure({ enabled: true, deviceId, token });
  const socket = net.createConnection({ host: "127.0.0.1", port: gateway.status().audioPort });
  context.after(() => socket.destroy());
  const decoder = new AtomEchoFrameDecoder();
  socket.on("data", (chunk) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.type !== FRAME_TYPES.AUTH_CHALLENGE) continue;
      const badProof = crypto.createHmac("sha256", Buffer.from("34".repeat(32), "hex")).update(frame.payload).digest();
      socket.write(encodeFrame(FRAME_TYPES.DEVICE_AUTH, 2, badProof));
    }
  });
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  socket.write(encodeFrame(FRAME_TYPES.DEVICE_HELLO, 1, Buffer.from(JSON.stringify({ deviceId }))));
  await new Promise((resolve) => socket.once("close", resolve));
  assert.equal(gateway.status().connected, false);
});
