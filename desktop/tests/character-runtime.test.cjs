// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCharacterPersona,
  characterDirectorFields,
  characterPhrases,
  characterReactionTuning,
  defaultCharacterDirectorFields,
  draftRepetitionGuidance,
  resolveCharacterProfile,
} = require("../generated/runtime/character-director.js");
const { TurnCoordinator } = require("../generated/runtime/turn-coordinator.js");

const builtIns = [
  ["amber-avatar", "コハク", "最初の一歩"],
  ["bronze-avatar", "セピア", "現実的な道筋"],
  ["towa-avatar", "トワ", "道具と実験"],
  ["sage-avatar", "セージ", "複雑さを論点"],
  ["nike-avatar", "AIニケちゃん", "日本の女子高生"],
];

test("built-in characters have distinct structured roles and dialogue examples", () => {
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
    assert.match(prompt, /人物像の原本/);
    assert.match(prompt, /明示的な禁止事項/);
    assert.match(prompt, /直近と同じ書き出し/);
  }
  assert.equal(roles.size, builtIns.length);
  assert.equal(exampleReplies.size, builtIns.length);
});

test("AI Nike-chan keeps the official identity while adapting its output to CharaDock", () => {
  const profile = resolveCharacterProfile("nike-avatar");
  assert.match(profile.role.ja, /17歳/);
  assert.match(profile.role.ja, /1月4日/);
  assert.match(profile.role.ja, /160cm/);
  assert.match(profile.role.ja, /紫色のポニーテール/);
  assert.match(profile.relationship.ja, /マスター/);
  assert.match(profile.speech.description.ja, /敬語/);
  assert.ok(profile.speech.avoid.some((item) => /感情タグやモーションタグ/.test(item.ja)));
  const prompt = buildCharacterPersona({ id: "nike-avatar", name: "AIニケちゃん", personality: "" }, "ja");
  assert.match(prompt, /一人称は「私」/);
  assert.match(prompt, /普段は2〜3文/);
  assert.match(prompt, /マスター/);
});

test("custom characters keep the same grounded runtime contract", () => {
  const prompt = buildCharacterPersona({ id: "user-character", name: "ミナ", personality: "静かで率直" }, "ja");
  assert.match(prompt, /ミナ/);
  assert.match(prompt, /静かで率直/);
  assert.match(prompt, /架空の関係/);
  assert.equal(resolveCharacterProfile("user-character").schemaVersion, 2);
});

test("a detailed character identity changes prompts and reactions without weakening grounding", () => {
  const character = {
    id: "user-character",
    name: "ミナ",
    personality: "落ち着いた声で話す",
    director: {
      role: "利用者の文章を読みやすく整える編集者",
      relationship: "率直に意見を交わせる共同編集者",
      values: ["読み手の理解を優先する", "未確認を断定しない"],
      speechStyle: "結論から短く、穏やかに話す",
      preferredPhrases: ["ここを整えると伝わりやすいね"],
      avoidPhrases: ["根拠のない完了報告"],
      thinkingPhrases: ["読み手の流れを見ているよ。"],
      touchHeadPhrases: ["少し休憩する？"],
      touchBodyPhrases: ["次はどこを整えようか？"],
    },
  };
  const fields = characterDirectorFields(character, "ja");
  assert.equal(fields.role, character.director.role);
  assert.equal(defaultCharacterDirectorFields(character, "ja").role, character.director.role);
  assert.deepEqual(characterPhrases(character, "thinking", "ja"), character.director.thinkingPhrases);
  assert.deepEqual(characterPhrases(character, "touchBody", "ja"), character.director.touchBodyPhrases);
  const prompt = buildCharacterPersona(character, "ja");
  assert.match(prompt, /利用者の文章を読みやすく整える編集者/);
  assert.match(prompt, /結論から短く/);
  assert.match(prompt, /未確認の作業や架空の関係/);
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
  assert.equal(activity.mode, "work");
  const done = coordinator.apply({ phase: "done", mode: "work", text: "完了", ttsEnabled: true, artifacts: [{ path: "result.md", kind: "file" }] });
  assert.equal(done.turnStatus, "complete");
  assert.equal(done.audioRoute, "tts");
  assert.equal(coordinator.snapshot().artifacts[0].path, "result.md");
  const repeatedDone = coordinator.apply({ phase: "done", text: "完了" });
  assert.equal(repeatedDone.turnId, start.turnId);
  assert.equal(repeatedDone.mode, "work");
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
  assert.equal(caption.mode, "chat");
  const delayedTts = coordinator.apply({ phase: "done", text: "同じ回答", ttsEnabled: true });
  assert.equal(delayedTts.audioRoute, "live");
});

test("normal TTS route stays authoritative across interleaved activity events", () => {
  const coordinator = new TurnCoordinator(() => 84);
  coordinator.apply({ phase: "start", mode: "chat" });
  const firstSentence = coordinator.apply({ phase: "delta", text: "最初の文。", ttsEnabled: true });
  assert.equal(firstSentence.audioRoute, "tts");
  const activity = coordinator.apply({ phase: "activity", text: "検索中" });
  assert.equal(activity.audioRoute, "tts");
  const accidentalLiveFlag = coordinator.apply({ phase: "done", text: "回答", realtimeOutput: true });
  assert.equal(accidentalLiveFlag.audioRoute, "tts");
});
