// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const routes = require("../lib/conversation-submit.cjs");
const { StreamingReplyPhrases } = require("../lib/speech-stream.cjs");

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

test("retired API conversation does not own or block the conversation route", () => {
  const ctx = routingHarness({ openAIClient: { hasActiveTurn: () => true } });
  assert.equal(ctx.normalConversationSubmitRouteForMode("chat"), "new-turn");
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
    codexCompanion: { state: { enabled: false } },
    companionTransitioning: false,
    ...require("../lib/atom-echo-conversation-route.cjs"),
    StreamingReplyPhrases,
    atomEchoCapture: null, atomEchoRecognizingCapture: null,
    atomEchoTurnGeneration: 0, atomEchoReplyGeneration: 0,
    rlcd42SpeechPhrases: null, stackchanLiveReplyWait: null, rlcd42SpeakerSelected: () => true,
    rlcd42LastDisplayText: "", rlcd42VoiceStage: "", rlcd42LastSceneSignature: "",
    preferences: { data: { interactionMode: "chat", streamingSpeechModelId: "test" } },
    esp32VoiceGateway: () => gateway, esp32VoiceLabel: () => "RLCD", esp32SpeechOutput: () => {},
    stackchanProfile: () => false, rlcd42Profile: () => ({}), stackchanPrivacyMuted: false,
    mainText: (ja) => ja, scheduleRlcd42SceneSync: () => {},
    atomEchoUsesRealtime: () => false,
    normalConversationSubmitRouteForMode: () => "new-turn",
    streamingSpeechRecognition: { status: () => ({ installed: true }), cancel: (id) => cancelled.push(id) },
    startStreamingSpeechSession: async () => ({}),
    stopRlcd42Speech: async () => {},
    finishStreamingSpeechSession: async () => ({ text: "こんにちは" }),
    jevAddressGate: { check: async () => ({ accepted: true, reason: "bypass" }) },
    handleMascotConversation: async () => ({ text: "返事です" }),
    diagnosticLog: null, setTimeout, clearTimeout, rlcd42SpeechActive: false,
    playRlcd42Speech: async (text) => { spoken.push(text); },
    ...overrides,
  });
  vm.runInContext(main.slice(main.indexOf("async function setEsp32VoiceState("), main.indexOf("async function esp32PcmChunk("))
    + main.slice(main.indexOf("function cancelStackchanLiveReplyWait("), main.indexOf("async function esp32Interrupt(")), ctx);
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
    codexCompanion: { state: { enabled: false } }, companionTransitioning: false,
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
  ctx.codexCompanion.state.enabled = true;
  await callback();
  assert.equal(replacements, 1, "Companion must not prewarm a second client");
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

for (const board of ["StackChan", "RLCD 4.2"]) {
  test(`${board} starts a completed Chat phrase early and never replays the full reply`, async () => {
    const first = deferred(), answer = deferred();
    const heard = [];
    let starts = 0;
    const h = speechHarness({
      stackchanProfile: () => board === "StackChan",
      stackchanGestures: { beginTurn() {}, waitForReply() {}, reset() {} },
      RLCD42_TTS_OWNER_ID: "stackchan",
      handleMascotConversation: async (_text, { onReplyText }) => {
        onReplyText("川沿いを散歩");
        assert.equal(starts, 0);
        onReplyText("川沿いを散歩したよ。");
        await answer.promise;
        const text = "川沿いを散歩したよ。また一緒に行こうね";
        onReplyText(text, { final: true });
        return { text };
      },
      playRlcd42Speech: async (_text, _owner, { phrases }) => {
        starts++;
        for await (const phrase of phrases) {
          heard.push(phrase);
          first.resolve();
        }
        return { spoken: true };
      },
    });
    await h.ctx.esp32PttStart("rlcd42");
    const spoken = h.ctx.esp32PttEnd("rlcd42");
    await first.promise;
    assert.deepEqual(heard, ["川沿いを散歩したよ。"]);
    answer.resolve();
    await spoken;
    assert.equal(starts, 1);
    assert.deepEqual(heard, ["川沿いを散歩したよ。", "また一緒に行こうね"]);
  });
}

test("late synthesis cannot replace the active RLCD stream cancellation handle", async () => {
  const oldSynthesis = deferred(), oldStarted = deferred(), playback = deferred(), playing = deferred();
  const cancelled = [];
  const ctx = vm.createContext({
    esp32SpeechOutput: () => {},
    speechCpp: { cancelOwner() {} },
    RLCD42_TTS_OWNER_ID: "rlcd", rlcd42SpeechGeneration: 0, atomEchoReplyGeneration: 0,
    rlcd42PlaybackCaption: "", syncRlcd42Scene: async () => {},
    stackchanProfile: () => false, rlcd42Profile: () => ({}),
    publishSpeechCaption: () => {}, scheduleRlcd42SceneSync: () => {},
    rlcd42SpeechActive: false, rlcd42SpeechStream: null, rlcd42SpeechPhrases: null,
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

test("overlong StackChan audio clears the listening state and tells the device to stop capture", async () => {
  const trace = [];
  const ctx = vm.createContext({
    atomEchoTurnGeneration: 1,
    atomEchoCapture: { deviceKind: "rlcd42", generation: 1, samples: 480000, mode: "standard", sessionId: "noise",
      gateway: {
        abortCurrentCapture: async () => trace.push("abort-device"),
        setDeviceState: async (state) => trace.push(state),
      },
    },
    esp32InputGate: () => ({ cancel: () => trace.push("gate") }),
    streamingSpeechRecognition: { cancel: (id) => trace.push(id) },
    rlcd42VoiceStage: "listening", rlcd42LastSceneSignature: "prior",
    scheduleRlcd42SceneSync: () => trace.push("scene"), mainText: ja => ja,
    pcm16Samples: () => [0],
  });
  vm.runInContext(main.slice(main.indexOf("async function releaseOverlongDeviceCapture("),
    main.indexOf("async function waitForEsp32PlaybackSlot(")), ctx);
  await assert.rejects(ctx.esp32PcmChunk(Buffer.alloc(2)), /30/);
  assert.equal(ctx.atomEchoCapture, null);
  assert.equal(ctx.rlcd42VoiceStage, "");
  assert.deepEqual(trace, ["gate", "noise", "scene", "abort-device", "idle"]);
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

test("StackChan listens promptly after confirmed speaker drain and retains echo protection on failure", () => {
  let now = 1000;
  const ctx = vm.createContext({
    Date: { now: () => now }, stackchanProfile: () => true, rlcd42Profile: () => ({}),
    codexCompanion: { state: { enabled: false } },
  });
  vm.runInContext(main.slice(main.indexOf("function esp32SpeechOutput("), main.indexOf("function esp32InputGate(")), ctx);
  ctx.esp32SpeechOutput(true);
  assert.equal(ctx.esp32SpeechSuppressed("rlcd42"), true);
  ctx.esp32SpeechOutput(false, { stackchanDrain: true });
  now += 170;
  assert.equal(ctx.esp32SpeechSuppressed("rlcd42"), false);
  assert.equal(ctx.esp32SpeechSuppressed("atom-echo"), true);
  ctx.esp32SpeechOutput(true);
  ctx.esp32SpeechOutput(false);
  now += 170;
  assert.equal(ctx.esp32SpeechSuppressed("rlcd42"), true);
});

test("StackChan arms the local end detector for hands-free standard TTS and Live", async () => {
  const begun = [];
  const ctx = vm.createContext({
    rlcd42Profile: () => ({ microphoneEnabled: true }),
    stackchanProfile: () => true,
    rlcd42CaptureModeForDevice: () => "hands-free",
    stackchanPrivacyMuted: false,
    rlcd42LiveAudioRoute: { active: () => false },
    rlcd42Gateway: { status: () => ({ capabilities: { audio: { captureFinalize: true } } }) },
    atomEchoUsesRealtime: () => false,
    warmStackchanStandardVoice() {},
    esp32InputGate: () => ({ begin: (options) => begun.push(options) }),
  });
  vm.runInContext(main.slice(main.indexOf("async function esp32InputStart("), main.indexOf("function pcm16Samples(")), ctx);
  await ctx.esp32InputStart("rlcd42");
  ctx.atomEchoUsesRealtime = () => true;
  await ctx.esp32InputStart("rlcd42");
  await ctx.esp32InputStart("rlcd42", { manual: true });
  assert.deepEqual(begun.map(({ bypass, handsfree, localEndpoint }) => [bypass, handsfree, localEndpoint]),
    [[false, true, true], [false, true, true], [true, false, false]]);
});

test("a missed StackChan display state ACK does not abort an accepted capture", async () => {
  const h = speechHarness({
    stackchanProfile: () => true,
    stackchanGestures: { beginTurn() {}, waitForReply() {} },
  });
  h.gateway.setDeviceState = async () => { throw new Error("display ACK missing"); };
  await h.ctx.esp32PttStart("rlcd42");
  assert.equal(h.ctx.atomEchoCapture?.mode, "standard");
  await h.ctx.esp32PttEnd("rlcd42");
  assert.deepEqual(h.spoken, ["返事です"]);
});
