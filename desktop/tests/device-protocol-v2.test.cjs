// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DeviceProtocolV2Decoder,
  FRAME_TYPES,
  assetChunkPayload,
  assetMetaPayload,
  displayCommitPayload,
  displayScenePayload,
  displayTextPayload,
  encodeFrame,
  parseApplyResponse,
  parseInputEvent,
  parseSensorReport,
  timeSyncPayload,
} = require("../lib/device-protocol-v2.cjs");

test("Device Protocol v2 matches the firmware framing vector", () => {
  assert.deepEqual(
    encodeFrame(FRAME_TYPES.DISPLAY_MODE, 0x1234, Buffer.from([1])),
    Buffer.from([0x43, 0x44, 0x02, 0x54, 0x34, 0x12, 0x01, 0x00, 0x45, 0x5f, 0x98, 0x45, 0x01]),
  );
});

test("Device Protocol v2 decoder resynchronizes around debug text and corrupt frames", () => {
  const decoder = new DeviceProtocolV2Decoder();
  const bad = Buffer.from(encodeFrame(FRAME_TYPES.STATE, 3, Buffer.from([2])));
  bad[8] ^= 0xff;
  const good = encodeFrame(FRAME_TYPES.DISPLAY_COMMIT, 4, displayCommitPayload(99));
  const frames = decoder.push(Buffer.concat([Buffer.from("# display ready\r\n"), bad, good]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, FRAME_TYPES.DISPLAY_COMMIT);
  assert.equal(frames[0].sequence, 4);
  assert.ok(decoder.rejectedFrames >= 1);
});

test("RLCD scenes use an atomic revision across scene and text payloads", () => {
  const scene = displayScenePayload({
    scene: "conversation",
    state: "speaking",
    revision: 123,
    characterName: "アンバー",
    modeLabel: "LIVE",
    live: true,
  });
  assert.equal(scene[0], 1);
  assert.equal(scene[1], 1);
  assert.equal(scene[2], 3);
  assert.equal(scene[3], 3);
  assert.equal(scene.readUInt32LE(4), 123);
  assert.equal(scene.subarray(16, 28).toString("utf8"), "アンバー");

  const caption = displayTextPayload({ revision: 123, target: "caption", fontSize: 16, text: "こんにちは" });
  assert.equal(caption.readUInt32LE(4), 123);
  assert.equal(caption.subarray(10).toString("utf8"), "こんにちは");
  assert.deepEqual(displayCommitPayload(123), Buffer.from([1, 123, 0, 0, 0]));
});

test("RLCD payload validation rejects stale identifiers and oversized labels", () => {
  assert.throws(() => displayScenePayload({ revision: 0 }), /non-zero/);
  assert.throws(() => displayScenePayload({ revision: 1, modeLabel: "x".repeat(25) }), /24 UTF-8 bytes/);
  assert.throws(() => displayTextPayload({ revision: 1, target: "footer", text: "x".repeat(161) }), /160 UTF-8 bytes/);
  assert.throws(() => assetMetaPayload({ pixels: Buffer.alloc(15000), revision: "spaces are unsafe" }), /safe identifier/);
});

test("RLCD bitmap metadata and chunk payloads match raw1-msb layout", () => {
  const pixels = Buffer.alloc(15000, 0xaa);
  const meta = assetMetaPayload({ pixels, revision: "sha256:0123", frameName: "portrait" });
  assert.equal(meta[0], 1);
  assert.equal(meta.readUInt16LE(1), 400);
  assert.equal(meta.readUInt16LE(3), 300);
  assert.equal(meta.readUInt32LE(5), 15000);
  assert.equal(meta[13], 11);
  assert.equal(meta.subarray(15, 26).toString("ascii"), "sha256:0123");
  assert.deepEqual(assetChunkPayload(4092, Buffer.from([1, 2])), Buffer.from([0xfc, 0x0f, 0, 0, 1, 2]));
});

test("RLCD apply, input, sensor, and time payloads are parsed without JSON", () => {
  assert.deepEqual(parseApplyResponse(Buffer.from([FRAME_TYPES.DISPLAY_COMMIT, 0, 0, 0])), {
    requestType: FRAME_TYPES.DISPLAY_COMMIT,
    applyResult: 0,
    applyResultName: "applied",
    assetResult: 0,
    assetResultName: "ok",
    audioResult: 0,
    audioResultName: "ok",
    accepted: true,
  });
  assert.deepEqual(parseInputEvent(Buffer.from([1, 0, 1, 0xa4, 1, 0, 0])), { button: 0, event: 1, durationMs: 420 });

  const sensor = Buffer.alloc(18);
  sensor[0] = 1;
  sensor[1] = 0x1f;
  sensor.writeInt16LE(2367, 2);
  sensor.writeUInt16LE(5123, 4);
  sensor.writeUInt16LE(4012, 6);
  sensor[8] = 88;
  sensor.writeUInt16LE(2026, 9);
  sensor.set([9, 1, 12, 34, 56], 11);
  const parsed = parseSensorReport(sensor);
  assert.equal(parsed.temperatureC, 23.67);
  assert.equal(parsed.humidityPercent, 51.23);
  assert.equal(parsed.batteryVolts, 4.012);
  assert.equal(parsed.batteryPercent, 88);
  assert.deepEqual(parsed.rtc, { year: 2026, month: 9, day: 1, hour: 12, minute: 34, second: 56 });
  assert.equal(parsed.available.microphoneCodec, true);

  const instant = new Date("2026-09-01T03:04:05.000Z");
  const sync = timeSyncPayload(instant);
  assert.equal(sync.length, 11);
  assert.equal(sync.readBigUInt64LE(1), BigInt(Math.floor(instant.getTime() / 1000)));
});
