// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AtomEchoFrameDecoder,
  DEFAULT_VAD_THRESHOLD_RMS,
  FRAME_TYPES,
  ackPayload,
  captureConfigPayload,
  encodeFrame,
  normalizeVadThreshold,
  parseAck,
  parseCaptureStatus,
} = require("../lib/atom-echo-protocol.cjs");
const {
  AtomEchoPcmProcessor,
  decodePcmWaveDataUrl,
  float32ToPcm16,
  processAtomEchoPcm16,
  resamplePcm16,
} = require("../lib/device-audio.cjs");

function waveDataUrl(samples, sampleRate = 24_000, channels = 1) {
  const data = Buffer.alloc(samples.length * channels * 2);
  for (let index = 0; index < samples.length; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) data.writeInt16LE(samples[index], (index * channels + channel) * 2);
  }
  const wave = Buffer.alloc(44 + data.length);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(36 + data.length, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(channels, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * channels * 2, 28);
  wave.writeUInt16LE(channels * 2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(data.length, 40);
  data.copy(wave, 44);
  return `data:audio/wav;base64,${wave.toString("base64")}`;
}

function processedToneMetrics(frequency, amplitude, options = {}) {
  const sampleRate = 16_000;
  const sampleCount = 3200;
  const source = float32ToPcm16(Float32Array.from(
    { length: sampleCount },
    (_, index) => Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude,
  ));
  const pcm = processAtomEchoPcm16(source, { sampleRate, fadeMs: 0, ...options });
  let peak = 0;
  let squared = 0;
  let count = 0;
  for (let index = sampleCount / 2; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE(index * 2) / 32768;
    peak = Math.max(peak, Math.abs(sample));
    squared += sample * sample;
    count += 1;
  }
  return { peak, rms: Math.sqrt(squared / count) };
}

test("ATOM Echo frame decoder handles split frames and binary payloads", () => {
  const decoder = new AtomEchoFrameDecoder();
  const payload = Buffer.from([0, 1, 2, 0x43, 0x44, 255]);
  const frame = encodeFrame(FRAME_TYPES.PCM_CHUNK, 42, payload);
  assert.deepEqual(decoder.push(frame.subarray(0, 5)), []);
  const decoded = decoder.push(frame.subarray(5));
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].type, FRAME_TYPES.PCM_CHUNK);
  assert.equal(decoded[0].sequence, 42);
  assert.deepEqual(decoded[0].payload, payload);
});

test("ATOM Echo frame decoder resynchronizes after noise and a bad checksum", () => {
  const decoder = new AtomEchoFrameDecoder();
  const bad = Buffer.from(encodeFrame(FRAME_TYPES.STATE, 1, Buffer.from([2])));
  bad[8] ^= 0xff;
  const good = encodeFrame(FRAME_TYPES.PTT_END, 2);
  const decoded = decoder.push(Buffer.concat([Buffer.from("noise"), bad, good]));
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].type, FRAME_TYPES.PTT_END);
});

test("ATOM Echo ACK payload round-trips", () => {
  assert.deepEqual(parseAck(ackPayload(FRAME_TYPES.AUDIO_CHUNK, 65535)), {
    type: FRAME_TYPES.AUDIO_CHUNK,
    sequence: 65535,
  });
});

test("ATOM Echo protocol reserves a capture configuration frame", () => {
  assert.equal(FRAME_TYPES.CAPTURE_CONFIG, 0x32);
  assert.equal(FRAME_TYPES.CAPTURE_STATUS, 0x33);
});

test("ATOM Echo capture status exposes calibrated VAD levels", () => {
  const payload = Buffer.alloc(12);
  payload[0] = 3;
  payload.writeUInt16LE(184, 1);
  payload.writeUInt16LE(74, 3);
  payload.writeUInt16LE(134, 5);
  payload.writeUInt16LE(99, 7);
  payload[9] = 2;
  payload[10] = 4;
  payload[11] = 0;
  assert.deepEqual(parseCaptureStatus(payload), {
    monitoring: true,
    active: true,
    rms: 184,
    noiseFloor: 74,
    startThreshold: 134,
    continueThreshold: 99,
    speechChunks: 2,
    silenceChunks: 4,
    calibrationChunks: 0,
  });
  assert.equal(parseCaptureStatus(Buffer.alloc(11)), null);
});

test("ATOM Echo capture configuration carries mode and a bounded RMS floor", () => {
  assert.equal(DEFAULT_VAD_THRESHOLD_RMS, 120);
  assert.equal(normalizeVadThreshold(20), 80);
  assert.equal(normalizeVadThreshold(2_000), 800);
  assert.deepEqual(captureConfigPayload("hands-free", 180), Buffer.from([1, 180, 0]));
  assert.deepEqual(captureConfigPayload("push-to-talk", 120, { includeThreshold: false }), Buffer.from([0]));
});

test("PCM WAV decoder reads stereo and resamples to the ATOM rate", () => {
  const decoded = decodePcmWaveDataUrl(waveDataUrl([0, 16384, -16384, 32767], 24_000, 2));
  assert.equal(decoded.sampleRate, 24_000);
  assert.equal(decoded.samples.length, 4);
  assert.ok(Math.abs(decoded.samples[1] - .5) < .001);
  const pcm = resamplePcm16(decoded.samples, decoded.sampleRate, 16_000);
  assert.equal(pcm.length, 6);
});

test("ATOM downsampling averages ultrasonic source energy instead of aliasing it", () => {
  const source = Float32Array.from({ length: 480 }, (_, index) => [1, -.5, -.5][index % 3]);
  const pcm = resamplePcm16(source, 48_000, 16_000);
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
  assert.ok(peak <= 1, `expected anti-aliased near-silence, got PCM peak ${peak}`);
});

test("ATOM speaker processing attenuates DC, bounds peaks, and fades both ends", () => {
  const source = float32ToPcm16(Float32Array.from({ length: 1600 }, (_, index) => .8 + Math.sin(index / 8) * .2));
  const pcm = processAtomEchoPcm16(source, { sampleRate: 16_000 });
  assert.equal(pcm.length, source.length);
  assert.ok(Math.abs(pcm.readInt16LE(0)) < 400);
  assert.equal(pcm.readInt16LE(pcm.length - 2), 0);
  let peak = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)));
  assert.ok(peak <= 22938, `expected the speaker-safe ceiling, got ${peak}`);
  let settledMean = 0;
  for (let offset = 1200 * 2; offset < 1600 * 2; offset += 2) settledMean += pcm.readInt16LE(offset);
  assert.ok(Math.abs(settledMean / 400) < 1000, "expected the high-pass filter to remove the DC offset");
});

test("ATOM speaker profile lifts ordinary voice-band audio while retaining protected headroom", () => {
  const source = float32ToPcm16(Float32Array.from(
    { length: 1600 },
    (_, index) => Math.sin(2 * Math.PI * 1000 * index / 16_000) * .3,
  ));
  const pcm = processAtomEchoPcm16(source, { sampleRate: 16_000 });
  let settledPeak = 0;
  for (let offset = 256 * 2; offset < (1600 - 256) * 2; offset += 2) {
    settledPeak = Math.max(settledPeak, Math.abs(pcm.readInt16LE(offset)));
  }
  assert.ok(settledPeak >= 17_000, `expected raised voice-band output, got ${settledPeak}`);
  assert.ok(settledPeak <= 22_938, `expected voice-band output to retain headroom, got ${settledPeak}`);
});

test("ATOM speaker profile spends headroom on speech presence instead of inaudible bass", () => {
  const neutralDynamics = {
    gain: 1,
    compressorMakeupDb: 0,
    compressorRatio: 1,
    limiterThreshold: .99,
    limiterCeiling: 1,
  };
  const bass = processedToneMetrics(100, .1, {
    ...neutralDynamics,
    bodyEqDb: 0,
    presenceEqDb: 0,
  });
  const body = processedToneMetrics(550, .1, neutralDynamics);
  const presence = processedToneMetrics(2600, .1, neutralDynamics);
  assert.ok(bass.rms < body.rms * .1, `expected strong sub-voice attenuation, got ${bass.rms}/${body.rms}`);
  assert.ok(presence.rms > body.rms * 1.7, `expected presence emphasis over boxy mids, got ${presence.rms}/${body.rms}`);
});

test("ATOM speaker compressor raises quiet speech and protects sustained loud speech", () => {
  const quiet = processedToneMetrics(1000, .1);
  const loud = processedToneMetrics(1000, .8);
  assert.ok(quiet.rms > .12, `expected audible quiet speech, got RMS ${quiet.rms}`);
  assert.ok(loud.peak <= .701, `expected protected loud speech, got peak ${loud.peak}`);
  assert.ok(loud.rms / quiet.rms < 4, "expected compression to narrow the input's 8x level difference");
});

test("ATOM speaker overall gain scales ordinary speech without exceeding the limiter", () => {
  const quieter = processedToneMetrics(1000, .08, { outputGain: .5 });
  const louder = processedToneMetrics(1000, .08, { outputGain: 1.5 });
  assert.ok(louder.rms > quieter.rms * 2.5, `expected overall gain scaling, got ${louder.rms}/${quieter.rms}`);
  assert.ok(louder.peak <= .701, `expected limiter protection, got peak ${louder.peak}`);
});

test("ATOM speaker processing keeps filter state and a single fade across chunks", () => {
  const source = float32ToPcm16(Float32Array.from({ length: 3200 }, (_, index) => Math.sin(index / 15) * .7));
  const whole = processAtomEchoPcm16(source, { sampleRate: 16_000 });
  const processor = new AtomEchoPcmProcessor({ sampleRate: 16_000 });
  const chunked = Buffer.concat([
    processor.push(source.subarray(0, 1400)),
    processor.push(source.subarray(1400, 4100)),
    processor.push(source.subarray(4100)),
    processor.finish(),
  ]);
  assert.deepEqual(chunked, whole);
});
