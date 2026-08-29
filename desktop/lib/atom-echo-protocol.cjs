// SPDX-License-Identifier: Apache-2.0
const FRAME_MAGIC = Buffer.from([0x43, 0x44]); // "CD"
const FRAME_VERSION = 1;
const FRAME_HEADER_BYTES = 12;
const MAX_FRAME_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_VAD_THRESHOLD_RMS = 120;

const FRAME_TYPES = Object.freeze({
  DEVICE_HELLO: 0x01,
  HOST_HELLO: 0x02,
  AUTH_CHALLENGE: 0x03,
  DEVICE_AUTH: 0x04,
  PTT_START: 0x10,
  PCM_CHUNK: 0x11,
  PTT_END: 0x12,
  INTERRUPT: 0x13,
  STATE: 0x20,
  AUDIO_BEGIN: 0x21,
  AUDIO_CHUNK: 0x22,
  AUDIO_END: 0x23,
  AUDIO_STOP: 0x24,
  WIFI_CONFIG: 0x30,
  WIFI_STATUS: 0x31,
  CAPTURE_CONFIG: 0x32,
  CAPTURE_STATUS: 0x33,
  ACK: 0x7e,
  ERROR: 0x7f,
});

const DEVICE_STATES = Object.freeze({
  idle: 0,
  listening: 1,
  thinking: 2,
  speaking: 3,
  error: 4,
  connecting: 5,
});

let crcTable;
function crc32(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  crcTable ||= Array.from({ length: 256 }, (_unused, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    return crc >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizePayload(payload) {
  if (payload === undefined || payload === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload)) return payload;
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (typeof payload === "string") return Buffer.from(payload, "utf8");
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function encodeFrame(type, sequence, payload) {
  const body = normalizePayload(payload);
  if (!Number.isInteger(type) || type < 0 || type > 0xff) throw new TypeError("Frame type must fit in one byte.");
  if (body.length > MAX_FRAME_PAYLOAD_BYTES) throw new RangeError("Frame payload is too large.");
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length);
  FRAME_MAGIC.copy(frame, 0);
  frame[2] = FRAME_VERSION;
  frame[3] = type;
  frame.writeUInt16LE(Number(sequence) & 0xffff, 4);
  frame.writeUInt16LE(body.length, 6);
  body.copy(frame, FRAME_HEADER_BYTES);
  const checksumInput = Buffer.concat([frame.subarray(2, 8), body]);
  frame.writeUInt32LE(crc32(checksumInput), 8);
  return frame;
}

function ackPayload(type, sequence) {
  const payload = Buffer.allocUnsafe(3);
  payload[0] = Number(type) & 0xff;
  payload.writeUInt16LE(Number(sequence) & 0xffff, 1);
  return payload;
}

function parseAck(payload) {
  const bytes = normalizePayload(payload);
  if (bytes.length !== 3) return null;
  return { type: bytes[0], sequence: bytes.readUInt16LE(1) };
}

function parseCaptureStatus(payload) {
  const bytes = normalizePayload(payload);
  if (bytes.length !== 12) return null;
  return {
    monitoring: Boolean(bytes[0] & 1),
    active: Boolean(bytes[0] & 2),
    rms: bytes.readUInt16LE(1),
    noiseFloor: bytes.readUInt16LE(3),
    startThreshold: bytes.readUInt16LE(5),
    continueThreshold: bytes.readUInt16LE(7),
    speechChunks: bytes[9],
    silenceChunks: bytes[10],
    calibrationChunks: bytes[11],
  };
}

function normalizeVadThreshold(value) {
  return Math.max(80, Math.min(800, Math.round(Number(value) || DEFAULT_VAD_THRESHOLD_RMS)));
}

function captureConfigPayload(mode, vadThreshold = DEFAULT_VAD_THRESHOLD_RMS, { includeThreshold = true } = {}) {
  const payload = Buffer.alloc(includeThreshold ? 3 : 1);
  payload[0] = mode === "hands-free" ? 1 : 0;
  if (includeThreshold) payload.writeUInt16LE(normalizeVadThreshold(vadThreshold), 1);
  return payload;
}

class AtomEchoFrameDecoder {
  constructor({ maxPayloadBytes = MAX_FRAME_PAYLOAD_BYTES } = {}) {
    this.maxPayloadBytes = Math.max(1, Math.min(0xffff, Number(maxPayloadBytes) || MAX_FRAME_PAYLOAD_BYTES));
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const bytes = normalizePayload(chunk);
    if (!bytes.length) return [];
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, bytes]) : Buffer.from(bytes);
    const frames = [];
    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      const magicIndex = this.buffer.indexOf(FRAME_MAGIC);
      if (magicIndex < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 1));
        break;
      }
      if (magicIndex > 0) this.buffer = this.buffer.subarray(magicIndex);
      if (this.buffer.length < FRAME_HEADER_BYTES) break;
      if (this.buffer[2] !== FRAME_VERSION) {
        this.buffer = this.buffer.subarray(2);
        continue;
      }
      const length = this.buffer.readUInt16LE(6);
      if (length > this.maxPayloadBytes) {
        this.buffer = this.buffer.subarray(2);
        continue;
      }
      const frameLength = FRAME_HEADER_BYTES + length;
      if (this.buffer.length < frameLength) break;
      const candidate = this.buffer.subarray(0, frameLength);
      const payload = candidate.subarray(FRAME_HEADER_BYTES);
      const checksumInput = Buffer.concat([candidate.subarray(2, 8), payload]);
      if (candidate.readUInt32LE(8) !== crc32(checksumInput)) {
        this.buffer = this.buffer.subarray(2);
        continue;
      }
      frames.push({
        version: candidate[2],
        type: candidate[3],
        sequence: candidate.readUInt16LE(4),
        payload: Buffer.from(payload),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }
    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

module.exports = {
  AtomEchoFrameDecoder,
  DEFAULT_VAD_THRESHOLD_RMS,
  DEVICE_STATES,
  FRAME_HEADER_BYTES,
  FRAME_MAGIC,
  FRAME_TYPES,
  FRAME_VERSION,
  MAX_FRAME_PAYLOAD_BYTES,
  ackPayload,
  captureConfigPayload,
  crc32,
  encodeFrame,
  normalizeVadThreshold,
  parseAck,
  parseCaptureStatus,
};
