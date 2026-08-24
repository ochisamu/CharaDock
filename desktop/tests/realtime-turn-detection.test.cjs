// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  HELD_VOICE_TARGET_RMS,
  LIVE_INPUT_HANGOVER_MS,
  createHangoverProcessor,
  createInputBridge,
} = require("../realtime-turn-detection.js");

const rms = (samples) => Math.sqrt(
  samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length),
);

test("Live keeps a 600 ms clause pause inside one Japanese utterance", () => {
  const sampleRate = 1_000;
  const processor = createHangoverProcessor({ sampleRate });
  const phraseBeforePause = new Float32Array(200).fill(.05); // 「次の音声を」
  const silenceBlock = new Float32Array(100);
  const phraseAfterPause = new Float32Array(200).fill(-.045); // 「反映しています」

  assert.deepEqual(processor.process(phraseBeforePause), phraseBeforePause);
  for (let elapsed = 100; elapsed <= 600; elapsed += 100) {
    const bridgedPause = processor.process(silenceBlock);
    assert.ok(rms(bridgedPause) >= HELD_VOICE_TARGET_RMS * .44, `pause ended at ${elapsed} ms`);
  }
  assert.deepEqual(processor.process(phraseAfterPause), phraseAfterPause);
});

test("Live hangover is bounded and returns to real silence", () => {
  const sampleRate = 1_000;
  const processor = createHangoverProcessor({ sampleRate });
  processor.process(new Float32Array(200).fill(.05));
  let bridgedSamples = 0;
  for (let index = 0; index < 10; index += 1) {
    const output = processor.process(new Float32Array(100));
    bridgedSamples += output.filter((sample) => sample !== 0).length;
  }
  assert.equal(LIVE_INPUT_HANGOVER_MS, 650);
  assert.equal(bridgedSamples, 650);
  assert.equal(rms(processor.process(new Float32Array(100))), 0);
});

test("Live input bridge processes only its outgoing stream and closes independently", async () => {
  const rawTrack = { stopped: false, stop() { this.stopped = true; } };
  const outgoingTrack = { stopped: false, stop() { this.stopped = true; } };
  const rawStream = { getAudioTracks: () => [rawTrack] };
  const output = new Float32Array(8);
  const source = { connect() {}, disconnect() {} };
  const processor = { connect() {}, disconnect() {}, onaudioprocess: null };
  const destination = { stream: { getTracks: () => [outgoingTrack] } };
  const silentMonitor = { gain: { value: 1 }, connect() {}, disconnect() {} };
  class FakeAudioContext {
    constructor() { this.sampleRate = 1_000; this.destination = {}; }
    createMediaStreamSource() { return source; }
    createScriptProcessor() { return processor; }
    createMediaStreamDestination() { return destination; }
    createGain() { return silentMonitor; }
    async resume() {}
    async close() {}
  }

  const bridge = await createInputBridge(rawStream, { AudioContextClass: FakeAudioContext });
  processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array(8).fill(.05) },
    outputBuffer: { getChannelData: () => output },
  });
  assert.ok(rms(output) > 0);
  bridge.close();
  assert.equal(outgoingTrack.stopped, true);
  assert.equal(rawTrack.stopped, false, "the caller still owns the real microphone track");
  assert.equal(processor.onaudioprocess, null);
});

test("Live falls back to the raw microphone when processing is unavailable", async () => {
  const rawStream = { getAudioTracks: () => [{}] };
  class UnsupportedAudioContext {
    createMediaStreamSource() { return { disconnect() {} }; }
    async close() {}
  }
  const bridge = await createInputBridge(rawStream, { AudioContextClass: UnsupportedAudioContext });
  assert.equal(bridge.stream, rawStream);
  assert.doesNotThrow(() => bridge.close());
});

test("settings, desktop mascot, remote, and packaged smoke test share the Live pause guard", () => {
  const root = path.resolve(__dirname, "..", "..");
  const control = fs.readFileSync(path.join(root, "desktop", "control.js"), "utf8");
  const mascot = fs.readFileSync(path.join(root, "desktop", "preload-mascot.cjs"), "utf8");
  const remote = fs.readFileSync(path.join(root, "desktop", "remote", "remote.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  const sources = [control, mascot, remote, main];

  assert.match(control, /CharaDockRealtimeTurnDetection\.createInputBridge\(stream\)/);
  assert.match(mascot, /createRealtimeInputBridge\(realtimeStream\)/);
  assert.match(remote, /CharaDockRealtimeTurnDetection\.createInputBridge\(liveInputStream\)/);
  assert.match(main, /CharaDockRealtimeTurnDetection\.createInputBridge\(stream\)/);
  for (const source of sources) assert.doesNotMatch(source, /["']session\.update["']/);
});
