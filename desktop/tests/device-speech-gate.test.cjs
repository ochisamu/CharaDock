// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const { DeviceSpeechGate } = require("../lib/device-speech-gate.cjs");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("main routes both devices through independent gates and cancels pending model startup", async () => {
  const main = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
  const events = [];
  let detectors = 0;
  const profile = { captureMode: "hands-free" };
  const ctx = vm.createContext({ DeviceSpeechGate,
    codexCompanion: { state: { enabled: false } },
    embeddedSherpaVad: { ensureModel: async () => {}, baseDirectory: "." },
    EmbeddedSherpaVad: class {
      constructor() { detectors++; }
      async start(profile) { assert.equal(profile, "normal"); }
      accept() { return { detected: true }; }
      stop() {}
    },
    preferences: { data: { atomEchoCaptureMode: "hands-free" } },
    rlcd42Profile: () => profile,
    stackchanProfile: () => false,
    stackchanPrivacyMuted: false,
    atomEchoUsesRealtime: () => false, diagnosticLog: null,
    esp32PttStart: async (device) => events.push(device), esp32PcmChunk: async () => {},
    esp32PttEnd: async () => {},
  });
  vm.runInContext(main.slice(main.indexOf("function rlcd42CaptureModeForDevice("), main.indexOf("function publicRlcd42State(")), ctx);
  vm.runInContext(main.slice(main.indexOf("function esp32SpeechOutput("), main.indexOf("function pcm16Samples(")), ctx);
  for (const device of ["atom-echo", "rlcd42"]) {
    await ctx.esp32InputStart(device);
    await ctx.esp32InputGate(device).chunk(Buffer.alloc(1024));
    await ctx.esp32InputGate(device).end();
  }
  assert.deepEqual(events, ["atom-echo", "rlcd42"]);
  assert.equal(detectors, 2);
  profile.microphoneEnabled = false;
  assert.equal(await ctx.esp32InputStart("rlcd42"), false);
  profile.microphoneEnabled = true;
  ctx.stackchanPrivacyMuted = true;
  assert.equal(await ctx.esp32InputStart("rlcd42"), false);
  ctx.stackchanPrivacyMuted = false;
  profile.cameraEnabled = false;
  profile.captureMode = "camera-hands-free";
  assert.equal(ctx.rlcd42CaptureModeForDevice(profile), "push-to-talk");
  profile.cameraEnabled = true;
  profile.captureMode = "hands-free";
  ctx.esp32SpeechOutput(true);
  await ctx.esp32InputStart("rlcd42");
  await ctx.esp32InputGate("rlcd42").chunk(Buffer.alloc(1024));
  assert.equal(detectors, 2);
  assert.equal(events.length, 2);
  ctx.esp32SpeechOutput(false);
  await ctx.esp32InputStart("atom-echo");
  assert.equal(detectors, 2, "cooldown also suppresses capture");
  assert.match(main, /function invalidateEsp32SpeechInput\(\)[\s\S]*gate\.cancel\(\)/);
});

function harness({ detectAt = Infinity, suppress = () => false, createVad } = {}) {
  const events = []; let frames = 0, stopped = 0;
  const vad = { accept: () => ({ detected: ++frames >= detectAt }), stop: () => stopped++ };
  const gate = new DeviceSpeechGate({
    createVad: createVad || (async () => vad), suppress,
    onStart: async () => events.push("start"),
    onChunk: async (bytes) => events.push(Buffer.from(bytes)),
    onEnd: async () => events.push("end"),
    onReject: async (reason) => events.push(reason),
  });
  return { gate, events, stopped: () => stopped };
}

for (const device of ["atom-echo", "rlcd42"]) {
  test(`${device}: noise never starts recognition or conversation`, async () => {
    const { gate, events } = harness();
    await gate.begin({ handsfree: true });
    for (let i = 0; i < 100; i++) await gate.chunk(Buffer.alloc(1024));
    assert.ok(gate.current.buffered <= 8000);
    await gate.end();
    assert.deepEqual(events, ["non-speech"]);
    assert.equal(gate.current, null);
  });
}

test("speech confirmation delivers pre-roll and remainder exactly once", async () => {
  const { gate, events } = harness({ detectAt: 4 });
  const audio = Buffer.alloc(10000);
  for (let i = 0; i < audio.length / 2; i++) audio.writeInt16LE(i, i * 2);
  await gate.begin(); await gate.chunk(audio); await gate.end();
  assert.equal(events[0], "start");
  assert.deepEqual(Buffer.concat(events.filter(Buffer.isBuffer)), audio);
  assert.equal(events.at(-1), "end");
});

test("playback suppression drops the whole hands-free capture but not manual input", async () => {
  const { gate, events } = harness({ detectAt: 1, suppress: () => true });
  await gate.begin({ handsfree: true }); await gate.chunk(Buffer.alloc(1024)); await gate.end();
  assert.deepEqual(events, ["suppressed"]);
  await gate.begin({ handsfree: false }); await gate.chunk(Buffer.alloc(1024)); await gate.end();
  assert.equal(events[1], "start");
  assert.equal(events.at(-1), "end");
});

test("playback starting during a pending candidate suppresses it", async () => {
  let playing = false;
  const { gate, events } = harness({ detectAt: 2, suppress: () => playing });
  await gate.begin({ handsfree: true }); await gate.chunk(Buffer.alloc(1024));
  playing = true; await gate.chunk(Buffer.alloc(1024)); await gate.end();
  assert.deepEqual(events, ["suppressed"]);
});

test("StackChan closes steady noise before opening a Live turn", async () => {
  let started = 0, requested = 0;
  const gate = new DeviceSpeechGate({
    createVad: async () => ({ accept: () => ({ detected: false }), stop() {} }),
    onStart: () => { started += 1; }, onChunk: () => {},
    onEnd: () => assert.fail("Noise must not start a Live turn"),
    requestEnd: () => { requested += 1; },
  });
  await gate.begin({ handsfree: true, localEndpoint: true });
  for (let block = 0; block < 85; block += 1) await gate.chunk(Buffer.alloc(640, 1));
  assert.equal(started, 0);
  assert.equal(requested, 1);
  await gate.end();
});

test("StackChan releases captures suppressed before and during VAD admission", async () => {
  let playing = true;
  let stops = 0;
  const events = [];
  const gate = new DeviceSpeechGate({
    suppress: () => playing,
    createVad: async () => ({ accept: () => ({ detected: false }), stop() {} }),
    onStart: () => assert.fail("Suppressed audio must never start a turn"),
    onChunk: () => assert.fail("Suppressed audio must never be forwarded"),
    requestEnd: () => { stops += 1; },
    onReject: reason => events.push(reason),
  });
  for (const suppressedAtStart of [true, false]) {
    playing = suppressedAtStart;
    await gate.begin({ handsfree: true, localEndpoint: true });
    await gate.chunk(Buffer.alloc(640));
    playing = true;
    await gate.chunk(Buffer.alloc(640));
    await gate.chunk(Buffer.alloc(640));
    await gate.end();
  }
  assert.equal(stops, 2);
  assert.deepEqual(events, ["suppressed", "suppressed"]);
});

test("StackChan keeps Silero through the end of speech and sends each block once", async () => {
  const chunks = [];
  let blocks = 0, requested = 0, ended = 0;
  const gate = new DeviceSpeechGate({
    createVad: async () => ({ accept() {
      blocks += 1;
      return { detected: blocks === 2, segmentComplete: blocks === 4 };
    }, stop() {} }),
    onStart() {}, onChunk: chunk => chunks.push(chunk),
    onEnd: () => { ended += 1; }, requestEnd: () => { requested += 1; },
  });
  await gate.begin({ handsfree: true, localEndpoint: true });
  for (let i = 1; i <= 5; i += 1) await gate.chunk(Buffer.alloc(640, i));
  await gate.end();
  assert.deepEqual(chunks, [Buffer.concat([Buffer.alloc(640, 1), Buffer.alloc(640, 2)]),
    Buffer.alloc(640, 3), Buffer.alloc(640, 4)]);
  assert.equal(requested, 1);
  assert.equal(ended, 1);
});

test("Live bypass never initializes Silero and forwards unchanged audio", async () => {
  const { gate, events } = harness({ createVad: () => { throw new Error("must not load"); }, suppress: () => true });
  await gate.begin({ bypass: true, handsfree: true });
  await gate.chunk(Buffer.alloc(64)); await gate.end();
  assert.equal(events[0], "start"); assert.equal(events.at(-1), "end");
});

test("interrupt during asynchronous model initialization cannot resurrect a capture", async () => {
  let resolve, stopped = 0;
  const { gate, events } = harness({ createVad: () => new Promise((r) => { resolve = r; }) });
  const pending = gate.begin(); gate.cancel();
  resolve({ stop: () => stopped++ }); await pending;
  await gate.chunk(Buffer.alloc(1024)); await gate.end();
  assert.deepEqual(events, []); assert.equal(stopped, 1);
});

test("model failure fails closed and the next capture can recover", async () => {
  let fail = true;
  const { gate, events } = harness({ createVad: async () => {
    if (fail) throw new Error("model unavailable");
    return { accept: () => ({ detected: true }), stop: () => {} };
  } });
  await assert.rejects(gate.begin(), /unavailable/);
  await gate.chunk(Buffer.alloc(1024)); assert.deepEqual(events, []);
  fail = false; await gate.begin(); await gate.chunk(Buffer.alloc(1024)); await gate.end();
  assert.equal(events[0], "start"); assert.equal(events.at(-1), "end");
});

test("rejected long noise is bounded and independent detectors do not leak state", async () => {
  const a = harness(), b = harness({ detectAt: 1 });
  await a.gate.begin(); await b.gate.begin();
  for (let i = 0; i < 31; i++) await a.gate.chunk(Buffer.alloc(32000));
  assert.equal(a.gate.current.buffers.length, 0);
  await b.gate.chunk(Buffer.alloc(1024)); await a.gate.end(); await b.gate.end();
  assert.deepEqual(a.events, ["suppressed"]); assert.equal(b.events[0], "start");
});
