// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_END_HOLD_MS, LiveOutputGate } = require("../atom-echo-live-audio.js");
const { AtomEchoLiveAudioRoute } = require("../lib/atom-echo-live-audio.cjs");

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
