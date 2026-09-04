// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const net = require("node:net");
const test = require("node:test");
const {
  DeviceProtocolV2Decoder,
  FRAME_TYPES,
  encodeFrame,
} = require("../lib/device-protocol-v2.cjs");
const {
  DISCOVERY_PREFIX,
  HOST_PROOF_DOMAIN,
  HOST_PREFIX,
  Rlcd42WifiGateway,
} = require("../lib/rlcd42-wifi.cjs");

const BOARD = "waveshare-esp32-s3-rlcd-4.2";

function waitFor(predicate, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for RLCD Wi-Fi condition"));
      }
    }, 10);
  });
}

function ack(type, sequence) {
  return encodeFrame(FRAME_TYPES.ACK, sequence, Buffer.from([type, 0, 0, 0]));
}

test("RLCD Wi-Fi gateway discovers, authenticates, and streams ordered microphone input", async (context) => {
  const token = "ab".repeat(32);
  const deviceId = "cd-rlcd-001122334455";
  const events = [];
  const captureStatuses = [];
  const gateway = new Rlcd42WifiGateway({
    discoveryPort: 0,
    audioPort: 0,
    host: "127.0.0.1",
    onPttStart: async () => events.push("start"),
    onPcmChunk: async (chunk) => events.push(`pcm:${chunk.length}`),
    onPttEnd: async () => events.push("end"),
    onCaptureStatus: async (status) => captureStatuses.push(status),
  });
  context.after(() => gateway.disconnect());
  await gateway.configure({
    enabled: true,
    deviceId,
    token,
    captureMode: "hands-free",
    vadThreshold: 180,
  });

  const udp = dgram.createSocket("udp4");
  context.after(() => { try { udp.close(); } catch {} });
  const discoveryResponse = new Promise((resolve, reject) => {
    udp.once("message", (message) => resolve(message.toString("utf8")));
    udp.once("error", reject);
  });
  udp.send(
    Buffer.from(`${DISCOVERY_PREFIX}${deviceId} ${BOARD}`),
    gateway.status().discoveryPort,
    "127.0.0.1",
  );
  assert.equal(
    await discoveryResponse,
    `${HOST_PREFIX}127.0.0.1 ${gateway.status().audioPort}`,
  );

  const socket = net.createConnection({ host: "127.0.0.1", port: gateway.status().audioPort });
  context.after(() => socket.destroy());
  const decoder = new DeviceProtocolV2Decoder();
  let sequence = 1;
  let captureConfig = null;
  let challenge = null;
  let receivedHostProof = null;
  socket.on("data", (chunk) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.type === FRAME_TYPES.AUTH_CHALLENGE) {
        challenge = Buffer.from(frame.payload);
        const proof = crypto.createHmac("sha256", Buffer.from(token, "hex")).update(frame.payload).digest();
        socket.write(encodeFrame(FRAME_TYPES.DEVICE_AUTH, ++sequence, proof));
      } else if (frame.type === FRAME_TYPES.DEVICE_HELLO && frame.payload.length === 0) {
        socket.write(encodeFrame(FRAME_TYPES.DEVICE_HELLO, frame.sequence, Buffer.from(JSON.stringify({
          board: BOARD,
          firmware: "0.2.0-test",
          deviceId,
          transport: "wifi",
        }))));
      } else if (frame.type === FRAME_TYPES.CAPABILITIES && frame.payload.length === 0) {
        socket.write(encodeFrame(FRAME_TYPES.CAPABILITIES, frame.sequence, Buffer.from(JSON.stringify({
          protocol: 2,
          board: BOARD,
          capabilities: {
            display: { width: 400, height: 300, bitsPerPixel: 1, bitmap: ["raw1-msb"] },
            audio: { capture: true, playback: true, format: "pcm-s16le-mono", sampleRates: [16000] },
          },
        }))));
      } else if (frame.type === FRAME_TYPES.SENSOR_REPORT && frame.payload.length === 0) {
        socket.write(encodeFrame(FRAME_TYPES.SENSOR_REPORT, frame.sequence, Buffer.alloc(18)));
      } else {
        if (frame.type === FRAME_TYPES.HOST_HELLO) receivedHostProof = Buffer.from(frame.payload);
        if (frame.type === FRAME_TYPES.CAPTURE_CONFIG) captureConfig = Buffer.from(frame.payload);
        socket.write(ack(frame.type, frame.sequence));
      }
    }
  });
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  socket.write(encodeFrame(FRAME_TYPES.DEVICE_HELLO, sequence, Buffer.from(JSON.stringify({
    board: BOARD,
    firmware: "0.2.0-test",
    deviceId,
    transport: "wifi",
  }))));
  await waitFor(() => gateway.status().connected && captureConfig);
  const expectedHostProof = crypto.createHmac("sha256", Buffer.from(token, "hex"))
    .update(HOST_PROOF_DOMAIN)
    .update(challenge)
    .digest();
  assert.deepEqual(receivedHostProof, expectedHostProof);
  assert.deepEqual(captureConfig, Buffer.from([1, 180, 0]));

  const status = Buffer.alloc(12);
  status[0] = 1;
  status.writeUInt16LE(155, 1);
  status.writeUInt16LE(65, 3);
  status.writeUInt16LE(180, 5);
  status.writeUInt16LE(100, 7);
  socket.write(Buffer.concat([
    encodeFrame(FRAME_TYPES.CAPTURE_STATUS, ++sequence, status),
    encodeFrame(FRAME_TYPES.PTT_START, ++sequence),
    encodeFrame(FRAME_TYPES.PCM_CHUNK, ++sequence, Buffer.alloc(320)),
    encodeFrame(FRAME_TYPES.PTT_END, ++sequence),
  ]));
  await waitFor(() => captureStatuses.length === 1 && events.length === 3);
  assert.equal(captureStatuses[0].rms, 155);
  assert.deepEqual(events, ["start", "pcm:320", "end"]);
  assert.equal(gateway.status().remoteAddress, "127.0.0.1");
});

test("RLCD Wi-Fi gateway rejects a proof made with another pairing token", async (context) => {
  const token = "12".repeat(32);
  const deviceId = "cd-rlcd-001122334455";
  const gateway = new Rlcd42WifiGateway({ discoveryPort: 0, audioPort: 0, host: "127.0.0.1" });
  context.after(() => gateway.disconnect());
  await gateway.configure({ enabled: true, deviceId, token });
  const socket = net.createConnection({ host: "127.0.0.1", port: gateway.status().audioPort });
  context.after(() => socket.destroy());
  const decoder = new DeviceProtocolV2Decoder();
  socket.on("data", (chunk) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.type !== FRAME_TYPES.AUTH_CHALLENGE) continue;
      const proof = crypto.createHmac("sha256", Buffer.from("34".repeat(32), "hex")).update(frame.payload).digest();
      socket.write(encodeFrame(FRAME_TYPES.DEVICE_AUTH, 2, proof));
    }
  });
  await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
  socket.write(encodeFrame(FRAME_TYPES.DEVICE_HELLO, 1, Buffer.from(JSON.stringify({ board: BOARD, deviceId }))));
  await new Promise((resolve) => socket.once("close", resolve));
  assert.equal(gateway.status().connected, false);
});
