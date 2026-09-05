// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const routes = require("../lib/conversation-submit.cjs");

const main = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
// Exercise the production wiring with actual client references (including
// null after reset), rather than only precomputed active/conflict booleans.
function routingHarness(overrides = {}) {
  const context = vm.createContext({
    ...routes,
    macComputerSkillClient: null, computerCodexClient: null,
    browserCodexClient: null, workCodexClient: null, codexClient: null,
    openAIClient: null,
    activeWorkRunId: null, activeRealtimeStarting: false,
    activeRealtimeTarget: "", remoteRealtimeStartReservation: "",
    currentRealtimeClient: () => null,
    turnCoordinator: { snapshot: () => ({ status: "complete" }) },
    diagnosticLog: null,
    ...overrides,
  });
  vm.runInContext(main.slice(main.indexOf("function activeCodexInteractionClient("),
    main.indexOf("function rememberActiveInteractionFollowUp(")), context);
  return context;
}

test("idle Chat stays available before and after resetting the Work client", () => {
  const ctx = routingHarness({ workCodexClient: undefined });
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "new-turn");
  ctx.workCodexClient = { hasActiveTurn: () => false };
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "new-turn");
  ctx.workCodexClient = null;
  assert.equal(ctx.activeNormalInteractionMode(null), "");
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "new-turn");
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat", { capturedSubmitRoute: "new-turn" }), "new-turn");
});

test("OpenAI request cannot be bypassed by captured input and is not steerable", () => {
  const ctx = routingHarness({ openAIClient: { hasActiveTurn: () => true } });
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "busy");
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat", { capturedSubmitRoute: "new-turn" }), "busy");
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function speechHarness(overrides = {}) {
  const states = [], cancelled = [], spoken = [];
  const gateway = {
    status: () => ({ connected: true, transport: "wifi" }),
    setDeviceState: async (state) => { states.push(state); },
  };
  const ctx = vm.createContext({
    ...require("../lib/atom-echo-conversation-route.cjs"),
    atomEchoCapture: null, atomEchoRecognizingCapture: null,
    atomEchoTurnGeneration: 0, atomEchoReplyGeneration: 0,
    rlcd42LastDisplayText: "", rlcd42VoiceStage: "", rlcd42LastSceneSignature: "",
    preferences: { data: { interactionMode: "chat", streamingSpeechModelId: "test" } },
    esp32VoiceGateway: () => gateway, esp32VoiceLabel: () => "RLCD",
    mainText: (ja) => ja, scheduleRlcd42SceneSync: () => {},
    atomEchoUsesRealtime: () => false,
    normalConversationSubmitRouteForMode: () => "new-turn",
    streamingSpeechRecognition: { status: () => ({ installed: true }), cancel: (id) => cancelled.push(id) },
    startStreamingSpeechSession: async () => ({}),
    stopRlcd42Speech: async () => {},
    finishStreamingSpeechSession: async () => ({ text: "こんにちは" }),
    handleMascotConversation: async () => ({ text: "返事です" }),
    diagnosticLog: null, setTimeout, clearTimeout, rlcd42SpeechActive: false,
    playRlcd42Speech: async (text) => { spoken.push(text); },
    ...overrides,
  });
  vm.runInContext(main.slice(main.indexOf("async function esp32PttStart("), main.indexOf("async function esp32PcmChunk("))
    + main.slice(main.indexOf("async function esp32PttEnd("), main.indexOf("async function esp32Interrupt(")), ctx);
  return { ctx, gateway, states, cancelled, spoken };
}

test("failed recognition startup releases the session and permits retry", async () => {
  const h = speechHarness({ startStreamingSpeechSession: async () => { throw new Error("worker failed"); } });
  await assert.rejects(h.ctx.esp32PttStart("rlcd42"), /worker failed/);
  assert.equal(h.ctx.atomEchoCapture, null);
  assert.equal(h.cancelled.length, 1);
  h.ctx.startStreamingSpeechSession = async () => ({});
  await h.ctx.esp32PttStart("rlcd42");
  assert.equal(h.ctx.rlcd42VoiceStage, "listening");
});

test("playback failure returns to idle and permits the next utterance", async () => {
  let recover;
  const h = speechHarness({
    setTimeout: (fn) => { recover = fn; return {}; }, clearTimeout: () => {},
    playRlcd42Speech: async () => { throw new Error("AUDIO_CHUNK timeout"); },
  });
  await h.ctx.esp32PttStart("rlcd42");
  await assert.rejects(h.ctx.esp32PttEnd("rlcd42"), /AUDIO_CHUNK/);
  assert.equal(h.ctx.rlcd42VoiceStage, "playback-error");
  recover();
  assert.equal(h.ctx.rlcd42VoiceStage, "");
  assert.equal(h.states.at(-1), "idle");
  await h.ctx.esp32PttStart("rlcd42");
  recover();
  assert.equal(h.ctx.rlcd42VoiceStage, "listening");
});

test("interrupt during startup cannot resurrect a recording", async () => {
  const start = deferred();
  const h = speechHarness({ startStreamingSpeechSession: () => start.promise });
  const pending = h.ctx.esp32PttStart("rlcd42");
  h.ctx.invalidateEsp32SpeechInput();
  start.resolve({});
  await pending;
  assert.equal(h.ctx.atomEchoCapture, null);
  assert.equal(h.states.includes("listening"), false);
  assert.ok(h.cancelled.length);
});

test("thinking-state transport failure still cleans up recognition", async () => {
  const h = speechHarness();
  await h.ctx.esp32PttStart("rlcd42");
  h.gateway.setDeviceState = async () => { throw new Error("disconnected"); };
  await assert.rejects(h.ctx.esp32PttEnd("rlcd42"), /disconnected/);
  assert.equal(h.ctx.atomEchoCapture, null);
  assert.equal(h.ctx.atomEchoRecognizingCapture, null);
  assert.equal(h.cancelled.length, 1);
});

test("late cancelled STT failure cannot overwrite a newer recording", async () => {
  const recognition = deferred();
  const h = speechHarness({ finishStreamingSpeechSession: () => recognition.promise });
  await h.ctx.esp32PttStart("rlcd42");
  const pending = h.ctx.esp32PttEnd("rlcd42");
  await Promise.resolve();
  assert.ok(h.ctx.atomEchoRecognizingCapture);
  h.ctx.invalidateEsp32SpeechInput();
  await h.ctx.esp32PttStart("rlcd42");
  recognition.reject(new Error("cancelled old worker"));
  await pending;
  assert.equal(h.ctx.rlcd42VoiceStage, "listening");
  assert.ok(h.ctx.atomEchoCapture);
  assert.equal(h.states.includes("error"), false);
});

test("duplicate PTT cannot orphan the active session", async () => {
  const h = speechHarness();
  await h.ctx.esp32PttStart("rlcd42");
  const capture = h.ctx.atomEchoCapture;
  await assert.rejects(h.ctx.esp32PttStart("rlcd42"));
  assert.equal(h.ctx.atomEchoCapture, capture);
});

test("follow-up recording preserves the original device answer owner", async () => {
  const answer = deferred();
  const submitted = deferred();
  const h = speechHarness({ handleMascotConversation: () => { submitted.resolve(); return answer.promise; } });
  await h.ctx.esp32PttStart("rlcd42");
  const pending = h.ctx.esp32PttEnd("rlcd42");
  // Let state update and recognition finish before the next PTT press.
  await submitted.promise;
  h.ctx.normalConversationSubmitRouteForMode = () => "follow-up";
  h.ctx.handleMascotConversation = async () => ({ followUp: true });
  await h.ctx.esp32PttStart("rlcd42");
  await h.ctx.esp32PttEnd("rlcd42");
  answer.resolve({ text: "追加入力込みの返事" });
  await pending;
  assert.deepEqual(h.spoken, ["追加入力込みの返事"]);
  assert.equal(h.ctx.rlcd42VoiceStage, "");
});

test("production routing respects real Chat, Work and Live owners", () => {
  const ctx = routingHarness({ workCodexClient: { hasActiveTurn: () => true } });
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "busy");
  assert.equal(ctx.normalConversationSubmitRouteForMode("work"), "follow-up");
  ctx.workCodexClient = null;
  ctx.codexClient = { hasActiveTurn: () => true };
  assert.equal(ctx.normalConversationSubmitRouteForMode("work"), "busy");
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "follow-up");
  ctx.activeRealtimeTarget = "rlcd42";
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "active-live");
});

test("interrupt targets the active client, not an idle browser/computer client", async () => {
  const interrupted = [];
  const ctx = routingHarness({
    macComputerSkillClient: { hasActiveTurn: () => false, interruptActiveTurn: async () => { interrupted.push("idle"); return false; } },
    codexClient: { hasActiveTurn: () => true, interruptActiveTurn: async () => { interrupted.push("chat"); return true; } },
    preferences: { data: { backend: "codex" } },
  });
  vm.runInContext(main.slice(main.indexOf("async function interruptActiveInteraction("), main.indexOf("function activeCodexInteractionClient(")), ctx);
  assert.equal((await ctx.interruptActiveInteraction()).interrupted, true);
  assert.deepEqual(interrupted, ["chat"]);
});

test("MCP prewarm never replaces the client of an active conversation", async () => {
  let callback, replacements = 0;
  const ctx = vm.createContext({
    mcpPrewarmTimer: null, clearTimeout: () => {}, setTimeout: (fn) => { callback = fn; },
    preferences: { data: { backend: "codex", interactionMode: "chat" } }, codexCommand: "codex",
    effectiveMcpServerIds: () => ["test"], quitting: false, activeWorkRunId: null,
    activeCodexInteractionClient: () => ({}), activeRealtimeStarting: false, currentRealtimeClient: () => null,
    ensureConversationCodexClient: () => { replacements++; return { ensureMcpServersReady: async () => [] }; },
    diagnosticLog: null,
  });
  vm.runInContext(main.slice(main.indexOf("function scheduleMcpPrewarm("), main.indexOf("async function refreshCodexInstallation(")), ctx);
  ctx.scheduleMcpPrewarm();
  await callback();
  assert.equal(replacements, 0);
  ctx.activeCodexInteractionClient = () => null;
  ctx.scheduleMcpPrewarm();
  await callback();
  assert.equal(replacements, 1);
});

test("playback failure is distinct from recognition failure and retains the reply", async () => {
  const h = speechHarness({ playRlcd42Speech: async () => { throw new Error("speaker disconnected"); } });
  await h.ctx.esp32PttStart("rlcd42");
  await assert.rejects(h.ctx.esp32PttEnd("rlcd42"), /speaker disconnected/);
  assert.equal(h.ctx.rlcd42VoiceStage, "playback-error");
  assert.equal(h.ctx.rlcd42LastDisplayText, "返事です");
  assert.equal(h.ctx.atomEchoRecognizingCapture, null);
});

test("repeated recognition failures and successful retries leave no capture owner", async () => {
  const h = speechHarness();
  for (let index = 0; index < 50; index++) {
    h.ctx.finishStreamingSpeechSession = async () => ({ text: index % 2 ? "こんにちは" : "" });
    await h.ctx.esp32PttStart("rlcd42");
    if (index % 2) await h.ctx.esp32PttEnd("rlcd42");
    else await assert.rejects(h.ctx.esp32PttEnd("rlcd42"), /聞き取れません/);
    assert.equal(h.ctx.atomEchoCapture, null);
    assert.equal(h.ctx.atomEchoRecognizingCapture, null);
  }
  assert.equal(h.spoken.length, 25);
  assert.equal(h.cancelled.length, 25);
});

test("interrupted device reply never starts late playback", async () => {
  const answer = deferred(), submitted = deferred();
  const h = speechHarness({ handleMascotConversation: () => { submitted.resolve(); return answer.promise; } });
  await h.ctx.esp32PttStart("rlcd42");
  const pending = h.ctx.esp32PttEnd("rlcd42");
  await submitted.promise;
  h.ctx.invalidateEsp32SpeechInput();
  answer.resolve({ text: "古い返事" });
  await pending;
  assert.equal(h.spoken.length, 0);
});

test("late synthesis cannot replace the active RLCD stream cancellation handle", async () => {
  const oldSynthesis = deferred(), oldStarted = deferred(), playback = deferred(), playing = deferred();
  const cancelled = [];
  const ctx = vm.createContext({
    RLCD42_TTS_OWNER_ID: "rlcd", rlcd42SpeechGeneration: 0, atomEchoReplyGeneration: 0,
    rlcd42PlaybackCaption: "", syncRlcd42Scene: async () => {},
    publishSpeechCaption: () => {}, scheduleRlcd42SceneSync: () => {},
    rlcd42SpeechActive: false, rlcd42SpeechStream: null,
    configuredSpeechText: (text) => text, rlcd42SpeakerSelected: () => true,
    characterTtsSettings: () => ({ provider: "local" }), activeCharacter: () => ({ id: "test" }),
    synthesizeConfiguredTts: (text) => {
      if (text === "old") { oldStarted.resolve(); return oldSynthesis.promise; }
      return { audioDataUrls: ["new-audio"], streamId: "new-stream" };
    },
    cancelIrodoriTtsStream: (id) => cancelled.push(id),
    rlcd42Gateway: {
      status: () => ({ connected: true, capabilities: { audio: { playback: true } } }),
      stopPlayback: async () => {},
      playPcm16: () => { playing.resolve(); return playback.promise; },
    },
    decodePcmWaveDataUrl: () => ({ samples: [1], sampleRate: 16000 }),
    resamplePcm16: (samples) => samples, processAtomEchoPcm16: (samples) => samples,
    rlcd42OutputProfile: () => ({}), mainText: (ja) => ja, diagnosticLog: null,
    waitForEsp32PlaybackSlot: async (isCurrent) => isCurrent(),
  });
  vm.runInContext(main.slice(main.indexOf("async function stopRlcd42Speech("), main.indexOf("async function esp32PttEnd(")), ctx);
  const old = ctx.playRlcd42Speech("old");
  await oldStarted.promise;
  const current = ctx.playRlcd42Speech("new");
  await playing.promise;
  oldSynthesis.resolve({ audioDataUrls: ["old-audio"], streamId: "old-stream" });
  assert.equal((await old).interrupted, true);
  assert.equal(ctx.rlcd42SpeechStream.id, "new-stream");
  await ctx.stopRlcd42Speech();
  assert.ok(cancelled.includes("new-stream"));
  playback.resolve({ interrupted: true });
  await current;
});

test("speaker waits for input and abandons speech on cancellation or timeout", async () => {
  let current = true, tick;
  const ctx = vm.createContext({
    atomEchoCapture: {}, atomEchoRecognizingCapture: null,
    setTimeout: (fn) => { tick = fn; }, Date,
  });
  vm.runInContext(main.slice(main.indexOf("async function waitForEsp32PlaybackSlot("), main.indexOf("async function playAtomEchoSpeech(")), ctx);
  const waiting = ctx.waitForEsp32PlaybackSlot(() => current);
  ctx.atomEchoCapture = null;
  tick();
  assert.equal(await waiting, true);
  ctx.atomEchoRecognizingCapture = {};
  const cancelled = ctx.waitForEsp32PlaybackSlot(() => current);
  current = false;
  tick();
  assert.equal(await cancelled, false);
  assert.equal(await ctx.waitForEsp32PlaybackSlot(() => true, 0), false);
});

test("follow-up promoted to a new turn supersedes the old device answer", async () => {
  const oldAnswer = deferred(), submitted = deferred();
  const h = speechHarness({ handleMascotConversation: () => { submitted.resolve(); return oldAnswer.promise; } });
  await h.ctx.esp32PttStart("rlcd42");
  const old = h.ctx.esp32PttEnd("rlcd42");
  await submitted.promise;
  h.ctx.normalConversationSubmitRouteForMode = () => "follow-up";
  await h.ctx.esp32PttStart("rlcd42");
  h.ctx.normalConversationSubmitRouteForMode = () => "new-turn";
  h.ctx.handleMascotConversation = async () => ({ text: "次の返事" });
  await h.ctx.esp32PttEnd("rlcd42");
  oldAnswer.resolve({ text: "古い返事" });
  await old;
  assert.deepEqual(h.spoken, ["次の返事"]);
});
