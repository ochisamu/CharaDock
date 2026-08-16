// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCharacterPersona,
  characterPhrases,
  characterReactionTuning,
  draftRepetitionGuidance,
  resolveCharacterProfile,
} = require("../generated/runtime/character-director.js");
const { TurnCoordinator } = require("../generated/runtime/turn-coordinator.js");

const builtIns = [
  ["amber-avatar", "コハク", "最初の一歩"],
  ["bronze-avatar", "セピア", "現実的な道筋"],
  ["towa-avatar", "トワ", "道具と実験"],
  ["sage-avatar", "セージ", "複雑さを論点"],
];

test("four built-in characters have distinct structured roles and dialogue examples", () => {
  const roles = new Set();
  const exampleReplies = new Set();
  for (const [id, name, roleFragment] of builtIns) {
    const profile = resolveCharacterProfile(id);
    assert.equal(profile.schemaVersion, 2);
    assert.match(profile.role.ja, new RegExp(roleFragment));
    assert.ok(profile.values.length >= 3);
    assert.ok(profile.examples.length >= 2);
    assert.ok(profile.phrases.thinking.length >= 3);
    roles.add(profile.role.ja);
    exampleReplies.add(profile.examples[0].reply.ja);
    const prompt = buildCharacterPersona({ id, name, personality: "利用者が編集した追加設定" }, "ja");
    assert.match(prompt, new RegExp(`あなたは「${name}」`));
    assert.match(prompt, /利用者が編集した追加設定/);
    assert.match(prompt, /未確認/);
    assert.match(prompt, /直近と同じ書き出し/);
  }
  assert.equal(roles.size, 4);
  assert.equal(exampleReplies.size, 4);
});

test("custom characters keep the same grounded runtime contract", () => {
  const prompt = buildCharacterPersona({ id: "user-character", name: "ミナ", personality: "静かで率直" }, "ja");
  assert.match(prompt, /ミナ/);
  assert.match(prompt, /静かで率直/);
  assert.match(prompt, /架空の関係/);
  assert.equal(resolveCharacterProfile("user-character").schemaVersion, 2);
});

test("character phrase sets and motion tuning differ without relying on randomness", () => {
  assert.notDeepEqual(characterPhrases("amber-avatar", "thinking", "ja"), characterPhrases("sage-avatar", "thinking", "ja"));
  const kohaku = characterReactionTuning("amber-avatar", "happy");
  const sepia = characterReactionTuning("bronze-avatar", "happy");
  const towa = characterReactionTuning("towa-avatar", "surprised");
  assert.ok(kohaku.intensity > sepia.intensity);
  assert.ok(towa.intensity > 1);
  assert.ok(sepia.durationScale > 1);
});

test("repetition review only adds guidance when recent character phrasing repeats", () => {
  assert.equal(draftRepetitionGuidance(["結論は一つです。", "別の観点があります。"], "", "ja"), "");
  const guidance = draftRepetitionGuidance(["うん、確認してみるね。", "うん、確認してみるよ。"], "", "ja");
  assert.match(guidance, /似た書き出し/);
  assert.match(guidance, /無理に話題を変えない/);
});

test("turn coordinator exposes one authoritative status and audio route", () => {
  let now = 1000;
  const coordinator = new TurnCoordinator(() => now++);
  const start = coordinator.apply({ phase: "start", mode: "work", ttsEnabled: true, workRunId: "run-1" });
  assert.equal(start.turnStatus, "working");
  assert.equal(start.audioRoute, "none");
  const activity = coordinator.apply({ phase: "activity", mode: "work", text: "確認中" });
  assert.equal(activity.turnId, start.turnId);
  assert.equal(activity.turnStatus, "working");
  const done = coordinator.apply({ phase: "done", mode: "work", text: "完了", ttsEnabled: true, artifacts: [{ path: "result.md", kind: "file" }] });
  assert.equal(done.turnStatus, "complete");
  assert.equal(done.audioRoute, "tts");
  assert.equal(coordinator.snapshot().artifacts[0].path, "result.md");
  const repeatedDone = coordinator.apply({ phase: "done", mode: "work", text: "完了" });
  assert.equal(repeatedDone.turnId, start.turnId);
  const next = coordinator.apply({ phase: "start", mode: "chat", realtimeOutput: true });
  assert.notEqual(next.turnId, start.turnId);
  assert.equal(next.audioRoute, "live");
});

test("live route remains authoritative during a realtime turn", () => {
  const coordinator = new TurnCoordinator(() => 42);
  const start = coordinator.apply({ phase: "start", mode: "chat", realtimeOutput: true });
  const caption = coordinator.apply({ phase: "realtime-caption", text: "話しているよ" });
  assert.equal(caption.turnId, start.turnId);
  assert.equal(caption.turnStatus, "speaking");
  assert.equal(caption.audioRoute, "live");
});
