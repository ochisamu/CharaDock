// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  atomEchoConversationRoute,
  atomEchoStandardCaptureRoute,
  atomEchoStandardDeliveryOptions,
} = require("../lib/atom-echo-conversation-route.cjs");

test("ATOM Echo follows the PC speech input selection", () => {
  assert.deepEqual(atomEchoConversationRoute({ speechInputProvider: "streaming-local" }), {
    mode: "standard", startLive: false, blocked: "",
  });
  assert.deepEqual(atomEchoConversationRoute({ speechInputProvider: "realtime", backend: "codex" }), {
    mode: "live", startLive: true, blocked: "",
  });
});

test("ATOM Echo reuses its own Live session but never competes with PC or remote Live", () => {
  assert.deepEqual(atomEchoConversationRoute({
    speechInputProvider: "realtime", backend: "codex", activeRealtime: true, activeRealtimeTarget: "atom-echo",
  }), { mode: "live", startLive: false, blocked: "" });
  assert.equal(atomEchoConversationRoute({
    speechInputProvider: "realtime", backend: "codex", activeRealtime: true, activeRealtimeTarget: "control",
  }).blocked, "other-live");
  assert.equal(atomEchoConversationRoute({
    speechInputProvider: "realtime", backend: "openai",
  }).blocked, "backend");
});

test("RLCD 4.2 reuses its own Live session but never steals another target", () => {
  assert.deepEqual(atomEchoConversationRoute({
    speechInputProvider: "realtime",
    backend: "codex",
    activeRealtime: true,
    activeRealtimeTarget: "rlcd42",
    deviceTarget: "rlcd42",
  }), { mode: "live", startLive: false, blocked: "" });
  assert.equal(atomEchoConversationRoute({
    speechInputProvider: "realtime",
    backend: "codex",
    activeRealtime: true,
    activeRealtimeTarget: "atom-echo",
    deviceTarget: "rlcd42",
  }).blocked, "other-live");
  assert.equal(atomEchoConversationRoute({
    speechInputProvider: "realtime",
    backend: "codex",
    activeRealtime: true,
    activeRealtimeTarget: "control",
    deviceTarget: "rlcd42",
  }).blocked, "other-live");
});

test("ATOM Echo standard input inherits PC Chat or Work and steers an active turn", () => {
  assert.deepEqual(atomEchoStandardDeliveryOptions(), { suppressPcAudio: true });
  assert.deepEqual(atomEchoStandardDeliveryOptions("new-turn"), {
    suppressPcAudio: true,
    capturedSubmitRoute: "new-turn",
  });
  assert.deepEqual(atomEchoStandardDeliveryOptions("follow-up"), {
    suppressPcAudio: true,
    capturedSubmitRoute: "follow-up",
  });
  assert.deepEqual(atomEchoStandardCaptureRoute("new-turn"), {
    route: "new-turn", allowed: true, followUp: false,
  });
  assert.deepEqual(atomEchoStandardCaptureRoute("follow-up"), {
    route: "follow-up", allowed: true, followUp: true,
  });
  assert.equal(atomEchoStandardCaptureRoute("busy").allowed, false);
  assert.equal(atomEchoStandardCaptureRoute("active-live").allowed, false);
});

test("ESP32 device Live uses one hidden WebRTC owner while keeping PC captions in the shared turn", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "..", "main.cjs"), "utf8");
  assert.match(main, /startCodexRealtimeVoice\(payload, activeEsp32VoiceDevice\)/);
  assert.match(main, /isEsp32VoiceTarget\(target\)[\s\S]{0,500}contents\.send\("chat:stream", message\)/);
  assert.match(main, /atomEchoLiveWindow\.webContents\.send\("atomEcho:realtimeEvent", forwarded\)/);
  assert.match(main, /handleMascotConversation\([\s\S]{0,120}atomEchoStandardDeliveryOptions\(capture\.submitRoute\)/);
  assert.match(main, /if \(result\?\.followUp\)[\s\S]{0,300}setDeviceState\("thinking"\)/);
  assert.match(main, /resetAtomEchoLiveBridgeForInteractionModeChange\(previousMode, nextMode\)/);
  assert.match(main, /atom-echo-interaction-mode-reset/);
  assert.match(main, /if \(capture\.generation !== atomEchoTurnGeneration\) return;/);
});
