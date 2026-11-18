// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_END_HOLD_MS, LiveOutputGate } = require("../atom-echo-live-audio.js");
const { AtomEchoLiveAudioRoute } = require("../lib/atom-echo-live-audio.cjs");
const { STACKCHAN_LIVE_PLAYBACK_OPTIONS } = require("../lib/stackchan-serial.cjs");

test("StackChan Realtime resampling keeps speech frequencies and rejects aliasing across chunk boundaries", () => {
  const { Realtime48kTo16k, resamplePcm16 } = require("../lib/device-audio.cjs");
  const tone = frequency => Float32Array.from({ length: 4800 },
    (_, index) => .5 * Math.sin(2 * Math.PI * frequency * index / 48_000));
  const rms = pcm => {
    let squared = 0;
    for (let offset = 160; offset < pcm.length; offset += 2)
      squared += (pcm.readInt16LE(offset) / 32768) ** 2;
    return Math.sqrt(squared / ((pcm.length - 160) / 2));
  };
  const speechTone = tone(1000);
  const noiseTone = tone(10000);
  const full = new Realtime48kTo16k();
  const chunked = new Realtime48kTo16k();
  const parts = [];
  for (let offset = 0; offset < speechTone.length; offset += 127)
    parts.push(chunked.push(speechTone.subarray(offset, offset + 127)));
  parts.push(chunked.finish());
  const expected = Buffer.concat([full.push(speechTone), full.finish()]);
  assert.deepEqual(Buffer.concat(parts), expected);
  assert.ok(rms(expected) > .34);
  const filteredNoise = new Realtime48kTo16k().push(noiseTone);
  assert.ok(rms(filteredNoise) < .001);
  assert.ok(rms(resamplePcm16(noiseTone, 48_000)) > .10);
});

test("Live renderer stays silent after interrupt until a new physical turn", async () => {
  const { readFileSync } = require("node:fs");
  const { runInNewContext } = require("node:vm");
  let command, transcript, gate;
  const api = {
    onCommand: callback => { command = callback; },
    onRealtime: callback => { transcript = callback; },
    onBeatriceAudio() {}, onBeatriceError() {}, ready() {},
  };
  class OutputGate extends LiveOutputGate {
    constructor(options) {
      super(options);
      gate = this;
    }
  }
  runInNewContext(readFileSync(require.resolve("../atom-echo-live.js"), "utf8"), {
    window: { atomEchoLive: api, CharaDockAtomEchoLiveAudio: { DEFAULT_END_HOLD_MS, LiveOutputGate: OutputGate } },
  });
  const receive = role => transcript({ method: "thread/realtime/transcript/delta", params: { role } });
  await receive("assistant");
  assert.equal(gate.suppressed, false);
  command({ type: "interrupt" });
  await receive("assistant");
  await receive("user");
  assert.equal(gate.suppressed, true);
  command({ type: "input-start" });
  assert.equal(gate.suppressed, true);
  await receive("user");
  assert.equal(gate.suppressed, false);
});

test("LiveOutputGate opens on speech, retains pre-roll, and closes after bounded silence", () => {
  const events = [];
  const gate = new LiveOutputGate({
    threshold: .01,
    preRollMs: 20,
    endHoldMs: 30,
    onStart: () => events.push("start"),
    onChunk: (samples) => events.push(samples[0] ? "voice" : "silence"),
    onEnd: () => events.push("end"),
  });
  gate.push(new Float32Array(480), 48_000);
  gate.push(Float32Array.from({ length: 480 }, () => .1), 48_000);
  gate.push(new Float32Array(480), 48_000);
  gate.push(new Float32Array(480), 48_000);
  gate.push(new Float32Array(480), 48_000);
  assert.deepEqual(events, ["start", "silence", "voice", "silence", "silence", "silence", "end"]);
  assert.equal(gate.active, false);
});

test("LiveOutputGate suppression immediately ends the active route and blocks late audio", () => {
  const events = [];
  const gate = new LiveOutputGate({
    threshold: .01,
    onStart: () => events.push("start"),
    onChunk: () => events.push("chunk"),
    onEnd: () => events.push("end"),
  });
  gate.push(Float32Array.from({ length: 480 }, () => .2), 48_000);
  gate.setSuppressed(true);
  gate.push(Float32Array.from({ length: 480 }, () => .2), 48_000);
  assert.deepEqual(events, ["start", "chunk", "end"]);
});

test("LiveOutputGate keeps a natural clause pause inside one ATOM playback", () => {
  const events = [];
  const gate = new LiveOutputGate({
    threshold: .01,
    onStart: () => events.push("start"),
    onChunk: () => {},
    onEnd: () => events.push("end"),
  });
  gate.push(new Float32Array(480).fill(.1), 48_000);
  for (let elapsed = 0; elapsed < DEFAULT_END_HOLD_MS - 100; elapsed += 10) {
    gate.push(new Float32Array(480), 48_000);
  }
  gate.push(new Float32Array(480).fill(.1), 48_000);
  assert.deepEqual(events, ["start"]);
  assert.equal(gate.active, true);
});

test("AtomEchoLiveAudioRoute resamples and emits one ordered streaming playback", async () => {
  const events = [];
  const session = { id: 7 };
  const gateway = {
    async stopPlayback() { events.push("stop"); },
    async beginPcm16Playback(sampleRate) { events.push(["begin", sampleRate]); return session; },
    async writePcm16PlaybackChunk(chunk, active) {
      assert.equal(active, session);
      events.push(["chunk", chunk.length]);
      return { interrupted: false };
    },
    async endPcm16Playback(active) { assert.equal(active, session); events.push("end"); return { interrupted: false }; },
  };
  const route = new AtomEchoLiveAudioRoute({ gateway });
  route.start();
  route.push(Float32Array.from({ length: 4_800 }, (_, index) => Math.sin(index / 10) * .2), 48_000);
  await route.end();
  assert.deepEqual(events, [
    "stop",
    ["begin", 16_000],
    ["chunk", 1024],
    ["chunk", 1024],
    ["chunk", 1024],
    ["chunk", 128],
    "end",
  ]);
});

test("AtomEchoLiveAudioRoute interrupt invalidates queued output", async () => {
  let releaseBegin;
  const events = [];
  const gateway = {
    async stopPlayback() { events.push("stop"); },
    async beginPcm16Playback() {
      events.push("begin");
      await new Promise((resolve) => { releaseBegin = resolve; });
      return { id: 1 };
    },
    async writePcm16PlaybackChunk() { events.push("chunk"); return { interrupted: false }; },
    async endPcm16Playback() { events.push("end"); return { interrupted: false }; },
  };
  const route = new AtomEchoLiveAudioRoute({ gateway });
  route.start();
  route.push(new Float32Array(4_800).fill(.2), 48_000);
  await new Promise((resolve) => setImmediate(resolve));
  const interrupted = route.interrupt();
  releaseBegin();
  await interrupted;
  assert.deepEqual(events, ["stop", "begin", "stop"]);
  assert.equal(route.active(), false);
});

test("AtomEchoLiveAudioRoute reads fresh speaker processor options for each answer", async () => {
  let calls = 0;
  const gateway = {
    async stopPlayback() {},
    async beginPcm16Playback() { return { id: calls }; },
    async writePcm16PlaybackChunk() { return { interrupted: false }; },
    async endPcm16Playback() { return { interrupted: false }; },
  };
  const route = new AtomEchoLiveAudioRoute({
    gateway,
    processorOptions: () => { calls += 1; return { outputGain: calls === 1 ? .5 : 1.5 }; },
  });
  route.start();
  route.push(new Float32Array(480).fill(.05), 48_000);
  await route.end();
  route.start();
  route.push(new Float32Array(480).fill(.05), 48_000);
  await route.end();
  assert.equal(calls, 2);
});

test("StackChan preserves queued speech when Live resumes before the device received End", async () => {
  const events = [];
  const gateway = {
    async stopPlayback() { events.push("stop"); },
    async beginPcm16Playback() { events.push("begin"); return 1; },
    async writePcm16PlaybackBatch(batch) { events.push(...batch.map(chunk => chunk.length)); },
    async endPcm16Playback() { events.push("end"); },
  };
  const route = new AtomEchoLiveAudioRoute({ gateway, playbackOptions: () => STACKCHAN_LIVE_PLAYBACK_OPTIONS });
  const first = route.start();
  route.push(new Float32Array(4800).fill(.1), 48_000);
  const pause = route.end();
  assert.equal(route.start(), first);
  route.push(new Float32Array(4800).fill(.2), 48_000);
  assert.deepEqual(await pause, { interrupted: true });
  assert.deepEqual(await route.end(), { interrupted: false });
  assert.equal(events.filter(event => event === "begin").length, 1);
  assert.equal(events.filter(event => event === "end").length, 1);
  assert.equal(events.filter(Number.isFinite).reduce((sum, chunk) => sum + chunk, 0), 6400);
});

test("StackChan coalesces a burst into one ordered Live reply without truncation", async () => {
  const chunks = [];
  const batchSizes = [];
  const events = [];
  const gateway = {
    async stopPlayback(options) { events.push(["stop", options?.preserveVoiceMotion === true]); },
    async beginPcm16Playback() { events.push("begin"); return 1; },
    async writePcm16PlaybackBatch(batch) {
      batchSizes.push(batch.length);
      chunks.push(...batch);
      return { interrupted: false };
    },
    async endPcm16Playback() {
      assert.equal(route.active(), true, "capture stays blocked while the speaker drains");
      events.push("end");
    },
  };
  const route = new AtomEchoLiveAudioRoute({
    gateway,
    playbackOptions: () => STACKCHAN_LIVE_PLAYBACK_OPTIONS,
    onError: assert.fail,
  });
  route.start();
  for (let index = 0; index < 600; index += 1)
    assert.equal(route.push(new Float32Array(480).fill(.1), 48_000), true);
  assert.deepEqual(await route.end(), { interrupted: false });
  assert.equal(route.active(), false);
  await route.interrupt();
  assert.deepEqual(events, [["stop", true], "begin", "end", ["stop", false]]);
  assert.equal(Buffer.concat(chunks).length, 16_000 * 2 * 6);
  assert.equal(chunks.slice(0, -1).every(chunk => chunk.length === STACKCHAN_LIVE_PLAYBACK_OPTIONS.chunkBytes), true);
  assert.equal(Math.max(...batchSizes), STACKCHAN_LIVE_PLAYBACK_OPTIONS.chunkWindow);
});
