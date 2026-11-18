// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { StreamingReplyPhrases } = require("../lib/speech-stream.cjs");
const main = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");

test("completed captions expire and no longer seed a later utterance", () => {
  let now = 1000, timer, syncs = 0;
  const ctx = vm.createContext({ Date: { now: () => now },
    remoteLastDisplayText: "全文", controlWindow: null, mascotWindow: null,
    setTimeout: (callback) => { timer = callback; return 1; }, clearTimeout: () => { timer = null; },
    rlcd42SpeechActive: false, atomEchoCapture: null, atomEchoRecognizingCapture: null,
    rlcd42LastDisplayText: "最後の文", rlcd42LastSceneSignature: "old",
    scheduleRlcd42SceneSync: () => syncs++,
  });
  vm.runInContext(main.slice(main.indexOf("function scheduleRlcd42CaptionExpiry("), main.indexOf("function rlcd42SpeakerSelected(")), ctx);
  ctx.publishSpeechCaption({ source: "rlcd42", text: "前の文" });
  ctx.publishSpeechCaption({ source: "rlcd42", done: true });
  now += 16000;
  assert.equal(ctx.publishSpeechCaption({ source: "rlcd42", text: "新しい文" }, true), "新しい文");
  ctx.scheduleRlcd42CaptionExpiry(); timer();
  assert.equal(ctx.rlcd42LastDisplayText, ""); assert.equal(syncs, 1);
  ctx.rlcd42LastDisplayText = "新しい回答";
  ctx.scheduleRlcd42CaptionExpiry(); ctx.scheduleRlcd42CaptionExpiry(-1);
  assert.equal(timer, null); assert.equal(ctx.rlcd42LastDisplayText, "新しい回答");
});

function playbackHarness() {
  const events = [];
  let held = false;
  const holds = [];
  const ctx = vm.createContext({
    speechCpp: { cancelOwner() {} },
    RLCD42_TTS_OWNER_ID: "test", rlcd42SpeechGeneration: 0, atomEchoReplyGeneration: 0,
    rlcd42SpeechActive: false, rlcd42SpeechStream: null, rlcd42SpeechPhrases: null, rlcd42PlaybackCaption: "",
    configuredSpeechText: (text) => text, rlcd42SpeakerSelected: () => true,
    stackchanProfile: () => false, rlcd42Profile: () => ({}),
    characterTtsSettings: () => ({ provider: "test" }), activeCharacter: () => ({ id: "test" }),
    synthesizeConfiguredTts: async () => ({ audioDataUrls: ["a", "b"], audioTexts: ["一文目。", "二文目。"], streamId: "tail" }),
    nextIrodoriTtsChunk: async () => {
      assert.equal(held, true, "hands-free suppression must survive the synthesis gap");
      return { audioDataUrl: "c", audioText: "最後の文。", done: true };
    },
    esp32SpeechOutput: (active) => { held = active; holds.push(active); },
    cancelIrodoriTtsStream: () => {},
    rlcd42Gateway: {
      status: () => ({ connected: true, capabilities: { audio: { playback: true } } }),
      stopPlayback: async () => {},
      playPcm16: async (pcm) => { events.push(["audio", pcm]); return {}; },
    },
    syncRlcd42Scene: async () => { events.push(["scene", ctx.rlcd42PlaybackCaption]); },
    remoteLastDisplayText: "回答全文", controlWindow: null,
    mascotWindow: { isDestroyed: () => false, webContents: { isDestroyed: () => false,
      send: (_channel, payload) => events.push([payload.done ? "done" : "caption", payload.text]) } },
    scheduleRlcd42SceneSync: () => {},
    decodePcmWaveDataUrl: (value) => ({ samples: value, sampleRate: 16000 }),
    resamplePcm16: (value) => value, processAtomEchoPcm16: (value) => value,
    rlcd42OutputProfile: () => ({}), mainText: (ja) => ja, diagnosticLog: null,
    waitForEsp32PlaybackSlot: async (isCurrent) => isCurrent(),
  });
  vm.runInContext(main.slice(main.indexOf("function publishSpeechCaption("), main.indexOf("function rlcd42SpeakerSelected(")), ctx);
  vm.runInContext(main.slice(main.indexOf("async function stopRlcd42Speech("), main.indexOf("async function esp32PttEnd(")), ctx);
  return { ctx, events, holds };
}

test("RLCD commits each audio sentence before playback, including streamed tail", async () => {
  const { ctx, events, holds } = playbackHarness();
  const result = await ctx.playRlcd42Speech("回答全文");
  assert.deepEqual(holds, [true, false], "one output lease spans the entire reply");
  assert.equal(result.spoken, true);
  assert.deepEqual(events.slice(0, 9), [
    ["scene", "一文目。"], ["caption", "一文目。"], ["audio", "a"],
    ["scene", "一文目。 二文目。"], ["caption", "二文目。"], ["audio", "b"],
    ["scene", "二文目。 最後の文。"], ["caption", "最後の文。"], ["audio", "c"],
  ]);
  assert.equal(events.at(-1)[0], "done");
  assert.equal(ctx.rlcd42PlaybackCaption, "");
});

test("StackChan finishes streaming speech independently of the caption acknowledgement", async () => {
  const { ctx, events } = playbackHarness();
  ctx.stackchanProfile = () => true;
  ctx.stackchanGestures = { active: true, generation: 0, reset() {} };
  ctx.splitIrodoriText = (text) => [text];
  ctx.requestLiveExpressionCue = () => {};
  ctx.jevEnabled = () => false;
  ctx.syncRlcd42Scene = async () => { throw new Error("caption acknowledgement lost"); };
  ctx.scheduleRlcd42SceneSync = (delay) => {
    if (delay === 0) events.push(["scene", ctx.rlcd42PlaybackCaption]);
  };
  assert.equal((await ctx.playRlcd42Speech("回答全文")).spoken, true);
  assert.deepEqual(events.filter(([type]) => type === "audio"), [["audio", "a"], ["audio", "b"], ["audio", "c"]]);
  assert.equal(events.filter(([type]) => type === "scene").length, 3);
});

test("StackChan plays a rejected staged phrase through the normal audio path", async () => {
  const { ctx, events } = playbackHarness();
  ctx.stackchanProfile = () => true;
  ctx.stackchanGestures = { active: true, generation: 0, reset() {} };
  ctx.splitIrodoriText = text => [text];
  ctx.requestLiveExpressionCue = () => {};
  ctx.jevEnabled = () => false;
  ctx.rlcd42Gateway.status = () => ({
    connected: true, capabilities: { audio: { playback: true, stagedPlaybackSamples: 100 } },
  });
  ctx.rlcd42Gateway.stagePcm16 = async (pcm) => ({ pcm });
  ctx.rlcd42Gateway.playStagedPcm16 = async ({ pcm }) => {
    events.push(["stage-refused", pcm]);
    return { stagedRejected: true };
  };
  ctx.rlcd42Gateway.playPcm16 = async (pcm, _rate, options) => {
    events.push(["audio", pcm]);
    options.onPlaybackCommitted({});
    return {};
  };
  assert.equal((await ctx.playRlcd42Speech("回答全文")).spoken, true);
  assert.deepEqual(events.filter(([type]) => type === "audio" || type === "stage-refused"), [
    ["audio", "a"], ["stage-refused", "b"], ["audio", "b"], ["stage-refused", "c"], ["audio", "c"],
  ]);
});

test("RLCD prepares the next Chat phrase as the current phrase plays", async () => {
  const { ctx, events, holds } = playbackHarness();
  const first = "先に一文を読み上げるよ。";
  const second = "次の文が届いたよ。";
  const phrases = new StreamingReplyPhrases();
  let firstPlaying, secondPrepared, release;
  const playing = new Promise(resolve => { firstPlaying = resolve; });
  const prepared = new Promise(resolve => { secondPrepared = resolve; });
  const drain = new Promise(resolve => { release = resolve; });
  ctx.synthesizeConfiguredTts = async (text, _owner, { wholeSentence }) => {
    assert.equal(wholeSentence, true);
    if (text === second) secondPrepared();
    return { audioDataUrls: [text] };
  };
  ctx.rlcd42Gateway.playPcm16 = async (text) => {
    events.push(["audio", text]);
    if (text === first) {
      firstPlaying();
      await drain;
    }
    return { interrupted: false };
  };
  phrases.push(first);
  const playback = ctx.playRlcd42Speech("", "test", { phrases });
  await playing;
  phrases.push(first + second);
  await prepared;
  assert.deepEqual(events.filter(([type]) => type === "audio"), [["audio", first]]);
  phrases.finish(first + second);
  release();
  assert.equal((await playback).spoken, true);
  assert.deepEqual(events.filter(([type]) => type === "caption" || type === "audio"),
    [["caption", first], ["audio", first], ["caption", second], ["audio", second]]);
  assert.deepEqual(holds, [true, false]);
});

test("caption window previews without advancing, keeps repeats, and bounds old context", () => {
  const sent = [];
  const ctx = vm.createContext({ remoteLastDisplayText: "全文", controlWindow: null,
    mascotWindow: { isDestroyed: () => false, webContents: { isDestroyed: () => false,
      send: (_channel, payload) => sent.push(payload) } } });
  vm.runInContext(main.slice(main.indexOf("function publishSpeechCaption("), main.indexOf("function rlcd42SpeakerSelected(")), ctx);
  const send = ctx.publishSpeechCaption;
  send({ text: "はい。" });
  assert.equal(send({ text: "はい。" }, true), "はい。 はい。");
  assert.equal(sent.length, 1);
  send({ text: "はい。" });
  assert.equal(sent.at(-1).displayText, "はい。 はい。");
  send({ text: "前".repeat(80) });
  const current = "今".repeat(80);
  const fitted = send({ text: current }, true);
  assert.ok(fitted.endsWith(current));
  assert.equal([...fitted].length, 88);
  send.last = null;
  send({ text: "別の会話。" });
  assert.equal(sent.at(-1).previousText, "");
  send({ source: "rlcd42", text: "出力先変更。" });
  assert.equal(sent.at(-1).previousText, "");
});

test("left navigation has a distinct existing icon for every destination", () => {
  const html = fs.readFileSync(path.join(__dirname, "../control.html"), "utf8");
  const icons = [...html.matchAll(/class="nav-tab[^"]*"[^>]*><span class="ui-symbol ui-symbol-([\w-]+)"/g)].map((m) => m[1]);
  const sidebar = html.match(/<nav class="nav-tabs"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.ok(sidebar);
  assert.equal(icons.length, [...sidebar.matchAll(/<button\b/g)].length);
  assert.equal(new Set(icons).size, icons.length);
  for (const icon of icons) assert.ok(fs.existsSync(path.join(__dirname, "../../assets/ui/icons", `${icon}.svg`)));
});

test("Irodori prefetch preserves the text belonging to the returned audio", async () => {
  const streams = new Map();
  const ctx = vm.createContext({
    irodoriTtsStreams: streams, preferences: { data: { irodoriSpeed: 1 } },
    clearTimeout: () => {}, scheduleIrodoriStreamExpiry: () => {},
    synthesizeIrodoriSegment: async (text) => `wav:${text}`,
  });
  vm.runInContext(main.slice(main.indexOf("function beginIrodoriStreamChunk("), main.indexOf("function cancelIrodoriTtsStream(")), ctx);
  const stream = { ownerId: 12, chunks: ["前半。", "後半。"], nextIndex: 0 };
  streams.set("id", stream);
  ctx.beginIrodoriStreamChunk("id", stream);
  const first = await ctx.nextIrodoriTtsChunk("id", 12);
  assert.equal(first.audioText, "前半。");
  assert.equal(first.audioDataUrl, "wav:前半。");
  assert.equal(first.done, false);
  const last = await ctx.nextIrodoriTtsChunk("id", 12);
  assert.equal(last.audioText, "後半。");
  assert.equal(last.done, true);
  assert.equal(streams.has("id"), false);
});

test("spoken Work uses the readable caption panel while retaining its WORK label", () => {
  const { buildRlcd42Scene } = require("../lib/rlcd42-presentation.cjs");
  const snapshot = buildRlcd42Scene({ turn: { status: "speaking", mode: "work" }, caption: "いま読んでいる文。" });
  assert.equal(snapshot.scene, "conversation");
  assert.equal(snapshot.modeLabel, "WORK");
  assert.equal(snapshot.caption, "いま読んでいる文。");
});
