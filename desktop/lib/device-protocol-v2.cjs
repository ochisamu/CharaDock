// SPDX-License-Identifier: Apache-2.0
const FRAME_MAGIC = Buffer.from([0x43, 0x44]); // "CD"
const FRAME_VERSION = 2;
const FRAME_HEADER_BYTES = 12;
const MAX_FRAME_PAYLOAD_BYTES = 4096;
const MAX_BUFFERED_BYTES = (FRAME_HEADER_BYTES + MAX_FRAME_PAYLOAD_BYTES) * 3;

const FRAME_TYPES = Object.freeze({
  DEVICE_HELLO: 0x01,
  HOST_HELLO: 0x02,
  AUTH_CHALLENGE: 0x03,
  DEVICE_AUTH: 0x04,
  CAPABILITIES: 0x05,
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
  TIME_SYNC: 0x34,
  CHARACTER_CHANGED: 0x40,
  PRESENTATION_CONFIG: 0x41,
  EXPRESSION: 0x42,
  MOUTH_LEVEL: 0x43,
  MOTION: 0x44,
  ASSET_META: 0x50,
  ASSET_CHUNK: 0x51,
  ASSET_END: 0x52,
  ASSET_INVALIDATE: 0x53,
  DISPLAY_MODE: 0x54,
  DISPLAY_SCENE: 0x55,
  DISPLAY_TEXT: 0x56,
  SENSOR_REPORT: 0x57,
  INPUT_EVENT: 0x58,
  DISPLAY_COMMIT: 0x59,
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
  working: 6,
  completed: 7,
  approval: 8,
  "approval-required": 8,
  offline: 9,
});

const SCENE_IDS = Object.freeze({
  home: 0,
  conversation: 1,
  work: 2,
  offline: 3,
  recovery: 4,
});

const TEXT_TARGETS = Object.freeze({
  caption: 0,
  activity: 1,
  next: 2,
  nextAction: 2,
  footer: 3,
});

const APPLY_RESULTS = Object.freeze([
  "applied",
  "asset-completed",
  "asset-cache-hit",
  "ignored",
  "invalid-payload",
  "asset-rejected",
  "audio-rejected",
]);

const ASSET_RESULTS = Object.freeze([
  "ok",
  "storage-unavailable",
  "invalid-metadata",
  "transfer-not-active",
  "unexpected-offset",
  "too-large",
  "incomplete",
  "checksum-mismatch",
]);

const AUDIO_RESULTS = Object.freeze([
  "ok",
  "unavailable",
  "invalid-format",
  "invalid-state",
  "buffer-full",
  "codec-failure",
]);

let crcTable;
function crc32(value) {
  const bytes = normalizePayload(value);
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
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffff) throw new TypeError("Frame sequence must fit in two bytes.");
  if (body.length > MAX_FRAME_PAYLOAD_BYTES) throw new RangeError("Frame payload exceeds 4096 bytes.");
  const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length);
  FRAME_MAGIC.copy(frame, 0);
  frame[2] = FRAME_VERSION;
  frame[3] = type;
  frame.writeUInt16LE(sequence, 4);
  frame.writeUInt16LE(body.length, 6);
  body.copy(frame, FRAME_HEADER_BYTES);
  frame.writeUInt32LE(crc32(Buffer.concat([frame.subarray(2, 8), body])), 8);
  return frame;
}

function boundedUnsigned(value, maximum, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) throw new RangeError(`${field} is out of range.`);
  return number;
}

function enumValue(value, values, field) {
  if (Number.isInteger(value) && Object.values(values).includes(value)) return value;
  if (Object.prototype.hasOwnProperty.call(values, value)) return values[value];
  throw new RangeError(`Unsupported ${field}: ${value}`);
}

function displayText(value, { field, maximum, required = false, singleLine = false } = {}) {
  const text = String(value ?? "");
  if (required && !text) throw new RangeError(`${field} cannot be empty.`);
  if (singleLine && /[\r\n]/.test(text)) throw new RangeError(`${field} must be one line.`);
  if (/\u0000|[\u0001-\u0008\u000b-\u000d\u000e-\u001f\u007f]/.test(text)) throw new RangeError(`${field} contains a control character.`);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > maximum) throw new RangeError(`${field} exceeds ${maximum} UTF-8 bytes.`);
  return bytes;
}

function safeIdentifier(value, { field = "identifier", maximum = 64, allowEmpty = false, allowColon = false } = {}) {
  const text = String(value ?? "");
  const pattern = allowColon ? /^[A-Za-z0-9._:-]+$/ : /^[A-Za-z0-9._-]+$/;
  const bytes = Buffer.from(text, "ascii");
  if ((!allowEmpty && !text) || bytes.length > maximum || (text && !pattern.test(text))) {
    throw new RangeError(`${field} is not a safe identifier.`);
  }
  return bytes;
}

function statePayload(state) {
  return Buffer.from([enumValue(state, DEVICE_STATES, "device state")]);
}

function normalizeVadThreshold(value) {
  return Math.max(80, Math.min(800, Math.round(Number(value) || 120)));
}

function captureConfigPayload(mode = "push-to-talk", vadThreshold = 120, { enabled = true } = {}) {
  const modes = { "push-to-talk": 0, "hands-free": 1, disabled: 2 };
  const resolvedMode = enabled === false ? 2 : modes[mode] ?? 0;
  const payload = Buffer.alloc(3);
  payload[0] = resolvedMode;
  payload.writeUInt16LE(normalizeVadThreshold(vadThreshold), 1);
  return payload;
}

function displayScenePayload({
  scene = "home",
  state = "idle",
  revision,
  characterName = "CharaDock",
  modeLabel = "",
  elapsedSeconds = 0,
  artifactCount = 0,
  flags,
  connected = true,
  live = false,
  beatrice = false,
  approval = false,
} = {}) {
  const name = displayText(characterName, { field: "characterName", maximum: 48, required: true, singleLine: true });
  const mode = displayText(modeLabel, { field: "modeLabel", maximum: 24, singleLine: true });
  const resolvedFlags = flags === undefined
    ? (connected ? 1 : 0) | (live ? 2 : 0) | (beatrice ? 4 : 0) | (approval ? 8 : 0)
    : boundedUnsigned(flags, 0x0f, "flags");
  const payload = Buffer.alloc(16 + name.length + mode.length);
  payload[0] = 1;
  payload[1] = enumValue(scene, SCENE_IDS, "scene");
  payload[2] = enumValue(state, DEVICE_STATES, "device state");
  payload[3] = resolvedFlags;
  const normalizedRevision = boundedUnsigned(revision, 0xffffffff, "revision");
  if (!normalizedRevision) throw new RangeError("revision must be non-zero.");
  payload.writeUInt32LE(normalizedRevision, 4);
  payload.writeUInt32LE(boundedUnsigned(elapsedSeconds, 0xffffffff, "elapsedSeconds"), 8);
  payload.writeUInt16LE(boundedUnsigned(artifactCount, 0xffff, "artifactCount"), 12);
  payload[14] = name.length;
  payload[15] = mode.length;
  name.copy(payload, 16);
  mode.copy(payload, 16 + name.length);
  return payload;
}

const TEXT_LIMITS = Object.freeze({ 0: 1024, 1: 384, 2: 256, 3: 160 });
function displayTextPayload({ revision, target = "caption", text = "", fontSize = 16 } = {}) {
  const targetValue = enumValue(target, TEXT_TARGETS, "text target");
  if (![12, 16].includes(Number(fontSize))) throw new RangeError("fontSize must be 12 or 16.");
  const content = displayText(text, { field: String(target), maximum: TEXT_LIMITS[targetValue] });
  const payload = Buffer.alloc(10 + content.length);
  payload[0] = 1;
  payload[1] = targetValue;
  payload[2] = Number(fontSize);
  payload[3] = 0;
  const normalizedRevision = boundedUnsigned(revision, 0xffffffff, "revision");
  if (!normalizedRevision) throw new RangeError("revision must be non-zero.");
  payload.writeUInt32LE(normalizedRevision, 4);
  payload.writeUInt16LE(content.length, 8);
  content.copy(payload, 10);
  return payload;
}

function displayCommitPayload(revision) {
  const normalized = boundedUnsigned(revision, 0xffffffff, "revision");
  if (!normalized) throw new RangeError("revision must be non-zero.");
  const payload = Buffer.alloc(5);
  payload[0] = 1;
  payload.writeUInt32LE(normalized, 1);
  return payload;
}

function timeSyncPayload(date = new Date()) {
  const instant = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(instant.getTime())) throw new TypeError("A valid time is required.");
  const unixSeconds = BigInt(Math.floor(instant.getTime() / 1000));
  const offsetMinutes = -instant.getTimezoneOffset();
  if (offsetMinutes < -720 || offsetMinutes > 840) throw new RangeError("Timezone offset is outside the supported range.");
  const payload = Buffer.alloc(11);
  payload[0] = 1;
  payload.writeBigUInt64LE(unixSeconds, 1);
  payload.writeInt16LE(offsetMinutes, 9);
  return payload;
}

function characterChangedPayload(revision) {
  return safeIdentifier(revision, { field: "revision", maximum: 64, allowColon: true });
}

function assetMetaPayload({ pixels, width = 400, height = 300, revision, frameName = "portrait", checksum } = {}) {
  const body = normalizePayload(pixels);
  const normalizedWidth = boundedUnsigned(width, 400, "width");
  const normalizedHeight = boundedUnsigned(height, 300, "height");
  if (!normalizedWidth || !normalizedHeight || body.length !== Math.ceil(normalizedWidth / 8) * normalizedHeight || body.length > 15000) {
    throw new RangeError("Monochrome bitmap dimensions do not match its byte count.");
  }
  const revisionBytes = safeIdentifier(revision, { field: "revision", maximum: 64, allowColon: true });
  const frameBytes = safeIdentifier(frameName, { field: "frameName", maximum: 32, allowEmpty: true });
  const payload = Buffer.alloc(15 + revisionBytes.length + frameBytes.length);
  payload[0] = 1; // raw1-msb
  payload.writeUInt16LE(normalizedWidth, 1);
  payload.writeUInt16LE(normalizedHeight, 3);
  payload.writeUInt32LE(body.length, 5);
  payload.writeUInt32LE(checksum === undefined ? crc32(body) : boundedUnsigned(checksum, 0xffffffff, "checksum"), 9);
  payload[13] = revisionBytes.length;
  payload[14] = frameBytes.length;
  revisionBytes.copy(payload, 15);
  frameBytes.copy(payload, 15 + revisionBytes.length);
  return payload;
}

function assetChunkPayload(offset, bytes) {
  const body = normalizePayload(bytes);
  if (!body.length || body.length > MAX_FRAME_PAYLOAD_BYTES - 4) throw new RangeError("Asset chunk must contain 1 to 4092 bytes.");
  const payload = Buffer.alloc(4 + body.length);
  payload.writeUInt32LE(boundedUnsigned(offset, 15000, "asset offset"), 0);
  body.copy(payload, 4);
  return payload;
}

function parseJsonPayload(payload) {
  const bytes = normalizePayload(payload);
  if (!bytes.length || bytes.length > MAX_FRAME_PAYLOAD_BYTES) return null;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseApplyResponse(payload) {
  const bytes = normalizePayload(payload);
  if (bytes.length !== 4) return null;
  const applyResult = bytes[1];
  const assetResult = bytes[2];
  return {
    requestType: bytes[0],
    applyResult,
    applyResultName: APPLY_RESULTS[applyResult] || `unknown-${applyResult}`,
    assetResult,
    assetResultName: ASSET_RESULTS[assetResult] || `unknown-${assetResult}`,
    audioResult: bytes[3],
    audioResultName: AUDIO_RESULTS[bytes[3]] || `unknown-${bytes[3]}`,
    accepted: applyResult <= 3,
  };
}

function parseSensorReport(payload) {
  const bytes = normalizePayload(payload);
  if (bytes.length !== 18 || bytes[0] !== 1) return null;
  const flags = bytes[1];
  const year = bytes.readUInt16LE(9);
  return {
    available: {
      temperatureHumidity: Boolean(flags & 0x01),
      rtc: Boolean(flags & 0x02),
      battery: Boolean(flags & 0x04),
      speakerCodec: Boolean(flags & 0x08),
      microphoneCodec: Boolean(flags & 0x10),
    },
    temperatureC: bytes.readInt16LE(2) / 100,
    humidityPercent: bytes.readUInt16LE(4) / 100,
    batteryVolts: bytes.readUInt16LE(6) / 1000,
    batteryPercent: bytes[8],
    rtc: {
      year,
      month: bytes[11],
      day: bytes[12],
      hour: bytes[13],
      minute: bytes[14],
      second: bytes[15],
    },
  };
}

function parseInputEvent(payload) {
  const bytes = normalizePayload(payload);
  if (bytes.length !== 7 || bytes[0] !== 1) return null;
  return { button: bytes[1], event: bytes[2], durationMs: bytes.readUInt32LE(3) };
}

function parseCaptureStatus(payload) {
  const bytes = normalizePayload(payload);
  if (bytes.length !== 12) return null;
  return {
    monitoring: Boolean(bytes[0] & 0x01),
    recording: Boolean(bytes[0] & 0x02),
    rms: bytes.readUInt16LE(1),
    noiseFloor: bytes.readUInt16LE(3),
    startThreshold: bytes.readUInt16LE(5),
    continueThreshold: bytes.readUInt16LE(7),
    speechChunks: bytes[9],
    silenceChunks: bytes[10],
    calibrationChunks: bytes[11],
  };
}

class DeviceProtocolV2Decoder {
  constructor({ maxPayloadBytes = MAX_FRAME_PAYLOAD_BYTES } = {}) {
    this.maxPayloadBytes = Math.max(1, Math.min(MAX_FRAME_PAYLOAD_BYTES, Number(maxPayloadBytes) || MAX_FRAME_PAYLOAD_BYTES));
    this.buffer = Buffer.alloc(0);
    this.rejectedFrames = 0;
  }

  push(chunk) {
    const bytes = normalizePayload(chunk);
    if (bytes.length) this.buffer = this.buffer.length ? Buffer.concat([this.buffer, bytes]) : Buffer.from(bytes);
    if (this.buffer.length > MAX_BUFFERED_BYTES) {
      this.buffer = this.buffer.subarray(this.buffer.length - MAX_BUFFERED_BYTES);
      this.rejectedFrames += 1;
    }
    const frames = [];
    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      const magicIndex = this.buffer.indexOf(FRAME_MAGIC);
      if (magicIndex < 0) {
        this.buffer = this.buffer.subarray(this.buffer[this.buffer.length - 1] === FRAME_MAGIC[0] ? this.buffer.length - 1 : this.buffer.length);
        break;
      }
      if (magicIndex > 0) this.buffer = this.buffer.subarray(magicIndex);
      if (this.buffer.length < FRAME_HEADER_BYTES) break;
      if (this.buffer[2] !== FRAME_VERSION) {
        this.rejectedFrames += 1;
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      const length = this.buffer.readUInt16LE(6);
      if (length > this.maxPayloadBytes) {
        this.rejectedFrames += 1;
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      const frameLength = FRAME_HEADER_BYTES + length;
      if (this.buffer.length < frameLength) break;
      const candidate = this.buffer.subarray(0, frameLength);
      const body = candidate.subarray(FRAME_HEADER_BYTES);
      if (candidate.readUInt32LE(8) !== crc32(Buffer.concat([candidate.subarray(2, 8), body]))) {
        this.rejectedFrames += 1;
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      frames.push({
        version: candidate[2],
        type: candidate[3],
        sequence: candidate.readUInt16LE(4),
        payload: Buffer.from(body),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }
    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.rejectedFrames = 0;
  }
}

module.exports = {
  APPLY_RESULTS,
  AUDIO_RESULTS,
  ASSET_RESULTS,
  DEVICE_STATES,
  DeviceProtocolV2Decoder,
  FRAME_HEADER_BYTES,
  FRAME_MAGIC,
  FRAME_TYPES,
  FRAME_VERSION,
  MAX_FRAME_PAYLOAD_BYTES,
  SCENE_IDS,
  TEXT_TARGETS,
  assetChunkPayload,
  assetMetaPayload,
  captureConfigPayload,
  characterChangedPayload,
  crc32,
  displayCommitPayload,
  displayScenePayload,
  displayTextPayload,
  encodeFrame,
  normalizeVadThreshold,
  parseApplyResponse,
  parseCaptureStatus,
  parseInputEvent,
  parseJsonPayload,
  parseSensorReport,
  statePayload,
  timeSyncPayload,
};
