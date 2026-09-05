// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

test("RLCD commits each audio sentence before playback, including streamed tail", async () => {
  const events = [];
  const ctx = vm.createContext({
    RLCD42_TTS_OWNER_ID: "test", rlcd42SpeechGeneration: 0, atomEchoReplyGeneration: 0,
    rlcd42SpeechActive: false, rlcd42SpeechStream: null, rlcd42PlaybackCaption: "",
    configuredSpeechText: (text) => text, rlcd42SpeakerSelected: () => true,
    characterTtsSettings: () => ({ provider: "test" }), activeCharacter: () => ({ id: "test" }),
    synthesizeConfiguredTts: async () => ({ audioDataUrls: ["a", "b"], audioTexts: ["一文目。", "二文目。"], streamId: "tail" }),
    nextIrodoriTtsChunk: async () => ({ audioDataUrl: "c", audioText: "最後の文。", done: true }),
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
  const result = await ctx.playRlcd42Speech("回答全文");
  assert.equal(result.spoken, true);
  assert.deepEqual(events.slice(0, 9), [
    ["scene", "一文目。"], ["caption", "一文目。"], ["audio", "a"],
    ["scene", "一文目。 二文目。"], ["caption", "二文目。"], ["audio", "b"],
    ["scene", "二文目。 最後の文。"], ["caption", "最後の文。"], ["audio", "c"],
  ]);
  assert.equal(events.at(-1)[0], "done");
  assert.equal(ctx.rlcd42PlaybackCaption, "");
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
  assert.ok(icons.length >= 10);
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
