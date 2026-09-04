// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const mascot = fs.readFileSync(path.join(__dirname, "../preload-mascot.cjs"), "utf8");
const control = fs.readFileSync(path.join(__dirname, "../control.js"), "utf8");

// Execute the shipped renderer functions with controllable media and IPC timing.
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing renderer section: ${start}`);
  return source.slice(from, to);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Recorder {
  constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.finished = this.onstop(); }
}

function vadHarness(transcription) {
  const timers = new Map();
  const events = [];
  let timerId = 0;
  const context = vm.createContext({
    Blob, Float32Array, performance,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }, cancelAnimationFrame() {},
    ipcRenderer: { invoke: async (channel) => channel.endsWith(":transcribeStreamingSpeech") ? transcription.promise : {} },
    input: { value: "" }, resizeInput() {}, setOpen() {}, setStatus() {}, setVadUi() {},
    transcribeRecordedBlob: () => transcription.promise,
    cleanupVadMedia() { events.push("cleanup"); context.vadStream = null; },
    autoSendCountdown: { hidden: true }, dock: { classList: { remove() {}, add() {} } },
    form: { requestSubmit() { events.push("submit"); } },
    appState: { voiceAutoSend: true, voiceAutoSendCountdown: false },
    autoSendCountdownTimer: null, autoSendCountdownCommand: "", autoSendCountdownEndsAt: 0,
    vadGeneration: 0, vadActive: true, vadStream: {}, vadFrame: 0, vadSpeaking: false,
    vadChunks: [], vadPreRoll: [], vadStreamingPreRoll: [], vadStreamingError: null,
    vadStreamingSessionId: "", vadStreamingQueue: Promise.resolve(), vadProcessing: false,
    vadRecorder: { mimeType: "audio/webm" }, vadProvider: "streaming-local", sending: false,
  });
  vm.runInContext([
    section(mascot, "  const clearAutoSendCountdown =", "  const setSendingControls ="),
    section(mascot, "  const waitingVoiceStatus =", "  const appendVadStreamingSamples ="),
    section(mascot, "  const finishVadUtterance =", "  const beginVadUtterance ="),
    section(mascot, "  const stopVadListening =", "  const startVadListening ="),
    "globalThis.actions = { processVadTranscript, stopVadListening, finishVadUtterance, beginAutoSendCountdown };",
  ].join("\n"), context);
  return { context, events, timers };
}

test("stopping VAD discards an in-flight transcript and releases capture immediately", async () => {
  const d = deferred();
  const { context: c, events, timers } = vadHarness(d);
  const processing = c.actions.processVadTranscript({}, "openai");
  c.actions.stopVadListening();
  assert.deepEqual(events, ["cleanup"]);
  d.resolve("do not send this");
  await processing;
  assert.equal(c.input.value, "");
  assert.equal(timers.size, 0);
  assert.equal(c.vadProcessing, false);
});

test("stopping VAD cancels an already scheduled auto-send", () => {
  const { context: c, timers } = vadHarness(deferred());
  c.input.value = "pending command";
  c.actions.beginAutoSendCountdown(c.input.value);
  assert.equal(timers.size, 1);
  c.actions.stopVadListening();
  assert.equal(timers.size, 0);
});

test("a cancelled VAD result cannot overwrite or clean up a restarted capture", async () => {
  const d = deferred();
  const { context: c, events } = vadHarness(d);
  const processing = c.actions.processVadTranscript({}, "sherpa-onnx");
  c.actions.stopVadListening();
  c.vadActive = true;
  c.vadStream = { newCapture: true };
  c.vadProcessing = true;
  c.input.value = "new input";
  d.resolve("old input");
  await processing;
  assert.equal(c.input.value, "new input");
  assert.equal(c.vadProcessing, true);
  assert.equal(c.vadStream.newCapture, true);
  assert.deepEqual(events, ["cleanup"]);
});

test("cancelled streaming VAD finalization never schedules a command", async () => {
  const d = deferred();
  const { context: c, timers } = vadHarness(d);
  c.vadSpeaking = true;
  c.vadStreamingSessionId = "old-session";
  c.actions.finishVadUtterance(new Float32Array([1, 2, 3]));
  await new Promise(setImmediate);
  c.actions.stopVadListening();
  d.resolve("old streaming command");
  await new Promise(setImmediate);
  assert.equal(c.input.value, "");
  assert.equal(timers.size, 0);
});

test("an active VAD transcription still auto-sends normally", async () => {
  const d = deferred();
  const { context: c, events, timers } = vadHarness(d);
  const processing = c.actions.processVadTranscript({}, "openai");
  d.resolve("send this");
  await processing;
  for (const fn of [...timers.values()]) fn();
  assert.equal(c.input.value, "send this");
  assert.deepEqual(events, ["submit"]);
});

test("retrying manual recording preserves the new microphone and ignores the old transcript", async () => {
  const d = deferred();
  const tracks = [];
  const c = vm.createContext({
    Blob, MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      return { getTracks: () => [track] };
    } } },
    recordedSpeechRecorder: null, recordedSpeechStream: null, manualStreamingSpeechSessionId: "",
    micButton: { setAttribute() {} }, input: { value: "", focus() {} },
    resizeInput() {}, setStatus() {}, transcribeRecordedBlob: () => d.promise,
  });
  vm.runInContext(section(mascot, "  const toggleRecordedSpeech =", "  const resampleStreamingSpeechSamples =")
    + "globalThis.toggle = toggleRecordedSpeech;", c);
  await c.toggle("openai");
  const first = c.recordedSpeechRecorder;
  await c.toggle("openai");
  assert.equal(tracks[0].stopped, true);
  await c.toggle("openai");
  c.input.value = "new draft";
  d.resolve("old transcript");
  await first.finished;
  assert.equal(tracks[1].stopped, false);
  assert.equal(c.recordedSpeechStream.getTracks()[0], tracks[1]);
  assert.equal(c.input.value, "new draft");
});

for (const fails of [false, true]) {
  test(`control STT ${fails ? "failure" : "success"} preserves the active conversation lock`, async () => {
    const reply = { text: "active reply" };
    const input = { value: "", setAttribute() {} };
    const c = vm.createContext({
      Blob, Uint8Array, MediaRecorder: Recorder, ensureAudioStream: async () => ({}),
      mediaRecorder: null, chatBusy: true, streamingMessage: reply, $: () => input,
      setStatus() {}, setChatBusy(value) { c.chatBusy = value; },
      api: { transcribe: async () => { if (fails) throw new Error("STT failed"); return "recognized"; } },
    });
    vm.runInContext(section(control, "  async function toggleRecordedSpeechInput(", "  function resampleSpeechChunk(")
      + "globalThis.toggle = toggleRecordedSpeechInput;", c);
    await c.toggle();
    await c.toggle();
    await c.mediaRecorder.finished;
    assert.equal(c.chatBusy, true);
    assert.equal(c.streamingMessage, reply);
    assert.equal(input.value, fails ? "" : "recognized");
  });
}
