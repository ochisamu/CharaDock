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
  const remote = fs.readFileSync(path.join(root, "remote", "remote.js"), "utf8");
  assert.doesNotMatch(html, /id="realtimeVoiceTestButton"/);
  assert.match(html, /聞こえ方の目安/);
  assert.match(control, /await startCodexRealtimeVoice\(\)/);
  assert.match(control, /await api\.appendCodexRealtimeText\(message, selectedSkillIds, selectedMcpServerIds\)/);
  assert.match(mascot, /mascotInline:realtimeAppendText/);
  assert.doesNotMatch(mascot, /playbackText|realtimePlaybackOnly/);
  assert.match(control, /cove: \{ impression: "男性寄り", description: "落ち着いて率直" \}/);
  assert.match(control, /maple: \{ impression: "女性寄り", description: "陽気で率直" \}/);
  assert.match(control, /arbor: \{ impression: "中性的", description: "気さくで万能" \}/);
  assert.match(main, /const realtimeClient = workMode[\s\S]{0,120}ensureWorkClient\(initialTurnMcpServerIds\)[\s\S]{0,120}ensureConversationCodexClient\(initialTurnMcpServerIds\)/);
  assert.match(main, /prompt: undefined,[\s\S]*clientManagedHandoffs: false/);
  assert.match(main, /codexResponseHandoffMode: "thinking"/);
  assert.match(main, /delegationAckFiller: false/);
  assert.match(main, /includeStartupContext: !workMode/);
  assert.match(main, /initialItems: \[\{[\s\S]*realtimeWorkFrontendContext[\s\S]*realtimeChatFrontendContext/);
  assert.match(main, /Chat is conversational and strictly read-only/);
  assert.match(main, /For current information, web research, verification, or read-only inspection, request exactly one Codex delegation/);
  assert.match(main, /never repeat, quote, or paraphrase the user's request as assistant dialogue/);
  assert.match(main, /the assistant must not echo a request ending in '教えて'/);
  assert.match(main, /Never create, edit, rename, move, or delete files/);
  assert.match(main, /realtime-chat-native-handoff-started/);
  assert.match(main, /!workMode && !nativeChatTurnIds\.size/);
  assert.match(main, /Never claim that work started, changed something, or completed unless/);
  assert.match(main, /speak that text verbatim without translating/);
  assert.match(main, /realtimeDelegationInput\(request\)/);
  assert.match(main, /handleNativeWorkEvent\(message\)/);
  assert.match(main, /realtime-work-native-handoff-started/);
  assert.match(main, /realtime-work-skill-handoff-failed/);
  assert.match(main, /steerActiveTurn\(state\.skillSteerText, \{ skillItems: state\.skillItems, turnId: state\.turnId \}\)/);
  assert.match(main, /cannot read Skill files yourself[\s\S]*attaches the actual Skill files/);
  assert.match(main, /transcript_deltaは過去会話の参考情報[\s\S]*作業ルート外へ成果物を作成・変更しない/);
  assert.match(main, /!userText\.includes\("<charadock_handoff_control>"\)/);
  assert.match(main, /interactionMode === "work" && activeRealtimeWorkDispatcher[\s\S]*dispatchTyped/);
  assert.match(main, /return \{ accepted: true, delegated: true \}/);
  assert.match(mascot, /streamOwnsBusyState = appState\?\.interactionMode === "work" && Boolean\(route\?\.delegated\)/);
  assert.match(main, /realtimeClient\.sendMessage\(normalized, \{ skillItems \}\)/);
  assert.match(main, /realtimeClient\.steerActiveTurn\(normalized, \{ skillItems, turnId: activeTurnId \}\)/);
  assert.match(main, /dispatchVoiceFollowUp\(request\)/);
  assert.match(main, /realtime-work-voice-follow-up/);
  assert.match(main, /appendNativeWorkFollowUp\(state, normalized\)/);
  assert.match(main, /if \(activeState\) appendNativeWorkFollowUp\(activeState, normalized\)/);
  assert.match(main, /if \(activeTurnId && !accepted\)[\s\S]*realtimeTurnBuffer\.discardInput\(normalized\)/);
  assert.match(main, /phase: "follow-up"[\s\S]*statusText[\s\S]*workRunId/);
  assert.match(control, /liveWorkFollowUp[\s\S]*appendCodexRealtimeText\(message, selectedSkillIds, selectedMcpServerIds\)[\s\S]*if \(chatBusy\)/);
  assert.match(mascot, /liveWorkFollowUp[\s\S]*mascotInline:realtimeAppendText[\s\S]*if \(sending\)/);
  assert.match(main, /Realtime V3 appendText is context-only[\s\S]*await client\.sendMessage\(normalized\)/);
  assert.match(main, /activeRealtimeTurnBuffer\?\.addTyped\(normalized, \{ followUp: activeTurn \}\)/);
  assert.match(main, /rememberActiveInteractionFollowUp\(client, normalized\)/);
  assert.match(main, /const followUps = consumeActiveInteractionFollowUps\(client\)/);
  assert.match(main, /route: "native-handoff"/);
  assert.match(main, /sandbox: "workspace-write"/);
  assert.match(main, /await stopActiveRealtime\(\)\.catch/);
  assert.match(preload, /audio:realtimeStart/);
  assert.match(main, /if \(!assistantTranscript\.active\) assistantTranscript\.text = ""/);
  assert.match(main, /new RealtimeTurnBuffer\(\)/);
  assert.match(main, /currentSharedContinuityContext\(1_000\)/);
  assert.match(main, /realtimeWorkFrontendContext\(realtimeClient, initialTurnSkillIds, initialTurnMcpServerIds, realtimeMemoryContext, sharedContext\)/);
  assert.match(main, /unfinishedWorkContext\(\{[\s\S]*workspaceKey: workDirectoryKey\(\)/);
  assert.match(main, /短い単一目的[\s\S]*`rm -f`、`rm -rf`/);
  assert.match(main, /realtimeTurnBuffer\.addAssistant\(assistantTranscript\.text\)/);
  assert.match(main, /realtimeTurnBuffer\.addUser\(request, \{[\s\S]*nativeWorkTurn\?\.run\?\.status === "running"[\s\S]*realtimeClient\.hasActiveTurn/);
  assert.match(main, /realtimeTurnBuffer\.hasPendingInput\(\)[\s\S]*realtime-unsolicited-assistant-suppressed/);
  assert.match(main, /params: \{ \.\.\.forwarded\.params, suppressed: true \}/);
  assert.match(main, /await appendRealtimeReactionSpeech\(spokenText\)/);
  assert.match(main, /phase: "realtime-caption"/);
  assert.match(main, /deferDisplayToRealtime: true,[\s\S]*realtimeSpeechPending: true/);
  assert.match(main, /setTimeout\(recoverNativeRealtimeWorkSpeech, 6_000\)/);
  assert.match(main, /finishNativeRealtimeWork\(\{ revealFallback: true \}\)/);
  assert.match(main, /client\.hasActiveTurn\?\.\(\)/);
  assert.match(control, /if \(!realtimeAssistantActive\)/);
  assert.match(control, /realtimeAssistantMessage = null;\s+realtimeAssistantText = ""/);
  assert.match(control, /realtimeAssistantText \+= delta/);
  assert.match(control, /textContent = realtimeAssistantText/);
  assert.match(control, /Work history is rendered exclusively from work:history[\s\S]*if \(mode === "work"\)/);
  assert.match(control, /previousProvider === "realtime" && state\?\.speechInputProvider !== "realtime"[\s\S]*closeRealtimeAudio\(\)/);
  assert.match(control, /params\.suppressed[\s\S]*setRealtimeOutputSuppressed\(true\)/);
  assert.match(mascot, /previousProvider === "realtime" && appState\.speechInputProvider !== "realtime"[\s\S]*closeRealtime\(\)/);
  assert.match(mascot, /setRealtimeOutputSuppressed\(Boolean\(params\.suppressed\)\)[\s\S]*if \(params\.suppressed\) return/);
  assert.match(mascot, /payload\?\.phase === "start"[\s\S]*setSendingControls\(true\)/);
  assert.match(mascot, /thread\/realtime\/closed[\s\S]*setSendingControls\(false\)/);
  assert.match(main, /const terminalTurnPayload = !workMode && \["thinking", "speaking"\]\.includes\(currentTurnStatus\)/);
  assert.match(main, /terminalTurnPayload \|\| \{ phase: "done", mode: "chat"/);
  assert.match(remote, /setRemoteLiveOutputSuppressed\(Boolean\(params\.suppressed\)\)/);
  assert.match(mascot, /thread\/realtime\/transcript\/done[\s\S]*Listening…[\s\S]*話してください…/);
});
