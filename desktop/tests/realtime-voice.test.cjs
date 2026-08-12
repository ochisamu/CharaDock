// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { normalizeRealtimeVoice, normalizeRealtimeVoiceList } = require("../lib/realtime-voice.cjs");

test("realtime voice selection accepts current app-server voices only", () => {
  assert.equal(normalizeRealtimeVoice("Ember"), "ember");
  assert.equal(normalizeRealtimeVoice("marin"), "cove");
});

test("realtime voice list exposes only the voice set accepted by Realtime V3", () => {
  assert.deepEqual(normalizeRealtimeVoiceList({ voices: {
    v2: ["marin", "cedar", "invalid"],
    v1: ["cove", "ember"],
    defaultV1: "cove",
  } }), {
    voices: ["cove", "ember"],
    defaultVoice: "cove",
  });
});

test("Realtime sessions start only from voice input, accept typed turns, and keep transcript deltas intact", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "control.html"), "utf8");
  const control = fs.readFileSync(path.join(root, "control.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "preload-control.cjs"), "utf8");
  const mascot = fs.readFileSync(path.join(root, "preload-mascot.cjs"), "utf8");
  assert.doesNotMatch(html, /id="realtimeVoiceTestButton"/);
  assert.match(html, /聞こえ方の目安/);
  assert.match(control, /await startCodexRealtimeVoice\(\)/);
  assert.match(control, /await api\.appendCodexRealtimeText\(message\)/);
  assert.match(mascot, /mascotInline:realtimeAppendText/);
  assert.doesNotMatch(mascot, /playbackText|realtimePlaybackOnly/);
  assert.match(control, /cove: \{ impression: "男性寄り", description: "落ち着いて率直" \}/);
  assert.match(control, /maple: \{ impression: "女性寄り", description: "陽気で率直" \}/);
  assert.match(control, /arbor: \{ impression: "中性的", description: "気さくで万能" \}/);
  assert.match(main, /const realtimeClient = codexClient/);
  assert.match(main, /clientManagedHandoffs: workMode/);
  assert.match(main, /delegationAckFiller: workMode \? false/);
  assert.match(main, /sendChatMessage\(normalized, \{[\s\S]{0,300}realtimeOutput: true,[\s\S]{0,200}workAcknowledged: source === "voice"/);
  assert.match(main, /interactionMode === "work" && activeRealtimeWorkDispatcher[\s\S]*dispatch\(normalized, "typed", \{/);
  assert.match(main, /appendRealtimeText\(normalized, "user"\)/);
  assert.match(main, /sandbox: "workspace-write"/);
  assert.match(main, /await stopActiveRealtime\(\)\.catch/);
  assert.match(preload, /audio:realtimeStart/);
  assert.match(main, /if \(!assistantTranscript\.active\) assistantTranscript\.text = ""/);
  assert.match(main, /new RealtimeTurnBuffer\(\)/);
  assert.match(main, /currentSharedContinuityContext\(1_000\)/);
  assert.match(main, /realtimeTurnBuffer\.addAssistant\(assistantTranscript\.text\)/);
  assert.match(main, /realtimeTurnBuffer\.addUser\(request\)/);
  assert.match(main, /await appendRealtimeReactionSpeech\(spokenText\)/);
  assert.match(main, /phase: "realtime-caption"/);
  assert.doesNotMatch(main, /if \(workMode && realtimeWorkRun\)[\s\S]*status: "completed"/);
  assert.match(main, /client\.hasActiveTurn\?\.\(\)/);
  assert.match(control, /if \(!realtimeAssistantActive\)/);
  assert.match(control, /realtimeAssistantMessage = null;\s+realtimeAssistantText = ""/);
  assert.match(control, /realtimeAssistantText \+= delta/);
  assert.match(control, /textContent = realtimeAssistantText/);
});
