// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  REAZONSPEECH_END_PADDING_SAMPLES,
  STREAMING_SPEECH_MODELS,
  STREAMING_PARTIAL_INITIAL_SAMPLES,
  STREAMING_PARTIAL_INTERVAL_SAMPLES,
  SimulatedStreamingSession,
  StreamingSpeechRecognition,
  padReazonSpeechWaveform,
  resampleLinear,
} = require("../lib/streaming-speech-recognition.cjs");

test("streaming speech recognition exposes only the verified ReazonSpeech model", () => {
  assert.deepEqual(Object.keys(STREAMING_SPEECH_MODELS), ["reazonspeech-streaming"]);
  assert.equal(STREAMING_SPEECH_MODELS["reazonspeech-streaming"].recommended, true);
  assert.notEqual(STREAMING_SPEECH_MODELS["reazonspeech-streaming"].experimental, true);
});

test("model manager falls back from removed model ids without downloading", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-streaming-stt-"));
  const manager = new StreamingSpeechRecognition(base, { modelId: "removed-streaming-model" });
  const status = manager.status();
  assert.equal(status.modelId, "reazonspeech-streaming");
  assert.equal(status.installed, false);
  assert.equal(status.models.length, 1);
  assert.equal(status.models[0].supported, true);
  assert.throws(() => manager.selectModel("unknown"), /対応していない/);
});

test("model preparation is shared so concurrent surfaces do not load twice", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-streaming-stt-"));
  const manager = new StreamingSpeechRecognition(base, { modelId: "reazonspeech-streaming" });
  let loads = 0;
  manager.sherpa = {
    isModelInstalled: () => true,
    recognizer: async () => {
      loads += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return {};
    },
  };
  await Promise.all([manager.prepare(), manager.prepare()]);
  assert.equal(loads, 1);
});

test("simulated streaming shows an early partial independently from finalization", async () => {
  const decodedLengths = [];
  const session = new SimulatedStreamingSession(
    async (samples) => {
      decodedLengths.push(samples.length);
      return { text: `認識${decodedLengths.length}` };
    },
    (operation) => operation(),
  );
  assert.deepEqual(
    await session.append(new Float32Array(STREAMING_PARTIAL_INITIAL_SAMPLES - 1)),
    { text: "", partial: true, changed: false },
  );
  assert.equal((await session.append(new Float32Array(1))).text, "認識1");
  assert.equal((await session.append(new Float32Array(STREAMING_PARTIAL_INTERVAL_SAMPLES - 1))).changed, false);
  assert.equal((await session.append(new Float32Array(1))).text, "認識2");
  const final = await session.finish();
  assert.equal(final.text, "認識3");
  assert.equal(final.partial, false);
  assert.deepEqual(decodedLengths, [
    STREAMING_PARTIAL_INITIAL_SAMPLES,
    STREAMING_PARTIAL_INITIAL_SAMPLES + STREAMING_PARTIAL_INTERVAL_SAMPLES,
    STREAMING_PARTIAL_INITIAL_SAMPLES + STREAMING_PARTIAL_INTERVAL_SAMPLES,
  ]);
});

test("simulated streaming adapts its partial interval when inference is slow", async () => {
  let clock = 0;
  let calls = 0;
  const session = new SimulatedStreamingSession(
    async () => {
      calls += 1;
      clock += 100;
      return `途中${calls}`;
    },
    (operation) => operation(),
    { initialSamples: 4, intervalSamples: 4, now: () => clock },
  );
  assert.equal((await session.append(new Float32Array(4))).text, "途中1");
  // A 100ms inference waits for 200ms of new audio (3,200 samples), keeping
  // progressive decoding below roughly half of wall-clock time.
  assert.equal((await session.append(new Float32Array(3_199))).changed, false);
  assert.equal((await session.append(new Float32Array(1))).text, "途中2");
  assert.equal(calls, 2);
});

test("a failed short partial does not close the streaming session", async () => {
  let calls = 0;
  const session = new SimulatedStreamingSession(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("short prefix");
      return "東京です";
    },
    (operation) => operation(),
  );
  const partial = await session.append(new Float32Array(STREAMING_PARTIAL_INITIAL_SAMPLES));
  assert.deepEqual(partial, { text: "", partial: true, changed: false });
  const final = await session.finish();
  assert.equal(final.text, "東京です");
});

test("ReazonSpeech pads both VAD boundaries like the upstream k2 wrapper", () => {
  const source = Float32Array.of(.25, -.5, .75);
  const padded = padReazonSpeechWaveform(source);
  assert.equal(padded.length, source.length + REAZONSPEECH_END_PADDING_SAMPLES * 2);
  assert.equal(padded[REAZONSPEECH_END_PADDING_SAMPLES - 1], 0);
  assert.deepEqual(
    [...padded.subarray(REAZONSPEECH_END_PADDING_SAMPLES, REAZONSPEECH_END_PADDING_SAMPLES + source.length)],
    [...source],
  );
  assert.equal(padded.at(-1), 0);
  const maximum = new Float32Array(16_000 * 30);
  assert.equal(padReazonSpeechWaveform(maximum).length, maximum.length + REAZONSPEECH_END_PADDING_SAMPLES * 2);
});

test("linear resampling preserves duration and finite samples", () => {
  const source = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 30));
  const output = resampleLinear(source, 48_000, 16_000);
  assert.equal(output.length, 16_000);
  assert.ok(output.every(Number.isFinite));
  assert.notEqual(output[100], 0);
});

test("session API rejects use before an optional model is installed", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-streaming-stt-"));
  const manager = new StreamingSpeechRecognition(base);
  await assert.rejects(manager.start("test-session"), /未ダウンロード/);
  assert.deepEqual(manager.cancel("missing"), { cancelled: false });
});

test("model manager closes active sessions on app shutdown", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-streaming-stt-"));
  const manager = new StreamingSpeechRecognition(base);
  const closed = [];
  manager.sessions.set("active", { session: { cancel: () => closed.push("session") } });
  manager.close();
  assert.deepEqual(closed, ["session"]);
  assert.equal(manager.sessions.size, 0);
});

test("desktop, settings chat, and remote input all route the streaming provider", () => {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const mascot = fs.readFileSync(path.join(projectRoot, "desktop", "preload-mascot.cjs"), "utf8");
  const control = fs.readFileSync(path.join(projectRoot, "desktop", "control.js"), "utf8");
  const remote = fs.readFileSync(path.join(projectRoot, "desktop", "remote", "remote.js"), "utf8");
  const html = fs.readFileSync(path.join(projectRoot, "desktop", "control.html"), "utf8");
  assert.match(html, /option value="streaming-local"/);
  assert.match(html, /id="streamingSpeechModelSelect"/);
  assert.match(control, /appendStreamingSpeech/);
  assert.match(mascot, /mascotInline:streamingSpeechAppend/);
  assert.match(remote, /api\/streaming-speech\/append/);
  assert.match(remote, /inputProvider === "streaming-local"/);
  assert.match(remote, /voice\?\.commitSilenceMs/);
  assert.match(remote, /streamingSpeechFinalizing/);
});
