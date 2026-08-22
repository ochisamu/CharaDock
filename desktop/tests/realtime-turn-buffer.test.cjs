// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const { RealtimeTurnBuffer } = require("../lib/realtime-turn-buffer.cjs");

test("Realtime turn buffer preserves every consecutive voice turn", () => {
  const buffer = new RealtimeTurnBuffer();
  assert.equal(buffer.hasPendingInput(), false);
  assert.equal(buffer.addUser("最初の質問"), null);
  assert.equal(buffer.hasPendingInput(), true);
  assert.deepEqual(buffer.addAssistant("最初の回答"), { user: "最初の質問", assistant: "最初の回答", source: "voice" });
  assert.equal(buffer.hasPendingInput(), false);
  assert.equal(buffer.addUser("次の質問"), null);
  assert.deepEqual(buffer.addAssistant("次の回答"), { user: "次の質問", assistant: "次の回答", source: "voice" });
});

test("Realtime turn buffer pairs typed input even when transcript events arrive late", () => {
  const buffer = new RealtimeTurnBuffer();
  buffer.addTyped("文字の質問");
  assert.equal(buffer.hasPendingInput(), true);
  assert.deepEqual(buffer.addAssistant("Liveの回答"), { user: "文字の質問", assistant: "Liveの回答", source: "typed" });
  assert.equal(buffer.hasPendingInput(), false);
  assert.equal(buffer.addUser("文字の質問"), null);
  assert.equal(buffer.pendingUsers.length, 0);
});

test("Realtime turn buffer tolerates assistant and user event reordering", () => {
  const buffer = new RealtimeTurnBuffer();
  assert.equal(buffer.addAssistant("先に届いた回答"), null);
  assert.deepEqual(buffer.addUser("後から届いた質問"), { user: "後から届いた質問", assistant: "先に届いた回答", source: "voice" });
});

test("Realtime turn buffer does not duplicate typed input when its transcript wins the request race", () => {
  const buffer = new RealtimeTurnBuffer();
  assert.equal(buffer.addUser("先に通知された文字入力"), null);
  buffer.addTyped("先に通知された文字入力");
  assert.equal(buffer.pendingTyped.length, 1);
  assert.deepEqual(buffer.addAssistant("一度だけ保存する回答"), {
    user: "先に通知された文字入力",
    assistant: "一度だけ保存する回答",
    source: "typed",
  });
  assert.equal(buffer.pendingTyped.length, 0);
});

test("Realtime turn buffer can revoke a request that failed before producing an answer", () => {
  const buffer = new RealtimeTurnBuffer();
  buffer.addTyped("送信に失敗した質問");
  assert.equal(buffer.discardInput("送信に失敗した質問"), true);
  assert.equal(buffer.hasPendingInput(), false);
  assert.equal(buffer.discardInput("送信に失敗した質問"), false);
});

test("Realtime turn buffer folds active-turn follow-ups into one answer and clears authorization", () => {
  const buffer = new RealtimeTurnBuffer();
  buffer.addTyped("最初の依頼");
  buffer.addTyped("条件を追加", { followUp: true });
  buffer.addTyped("出力は短く", { followUp: true });
  assert.deepEqual(buffer.addAssistant("まとめた回答"), {
    user: "最初の依頼\n条件を追加\n出力は短く",
    assistant: "まとめた回答",
    source: "typed",
    followUps: ["条件を追加", "出力は短く"],
  });
  assert.equal(buffer.hasPendingInput(), false);
});

test("Realtime turn buffer keeps a later independent typed turn separate", () => {
  const buffer = new RealtimeTurnBuffer();
  buffer.addTyped("最初の依頼");
  buffer.addTyped("次の依頼");
  assert.deepEqual(buffer.addAssistant("最初の回答"), {
    user: "最初の依頼",
    assistant: "最初の回答",
    source: "typed",
  });
  assert.equal(buffer.hasPendingInput(), true);
  assert.deepEqual(buffer.addAssistant("次の回答"), {
    user: "次の依頼",
    assistant: "次の回答",
    source: "typed",
  });
});

test("Realtime turn buffer folds typed follow-ups into a voice-started turn", () => {
  const buffer = new RealtimeTurnBuffer();
  buffer.addUser("最初は音声でお願い");
  buffer.addTyped("出力はMarkdownで", { followUp: true });

  assert.deepEqual(buffer.addAssistant("Markdownにまとめたよ"), {
    user: "最初は音声でお願い\n出力はMarkdownで",
    assistant: "Markdownにまとめたよ",
    source: "voice",
    followUps: ["出力はMarkdownで"],
  });
  assert.equal(buffer.addUser("出力はMarkdownで"), null);
});

test("Realtime turn buffer folds voice follow-ups into a typed-started turn", () => {
  const buffer = new RealtimeTurnBuffer();
  buffer.addTyped("ニュースを調べて");
  buffer.addUser("国内だけで", { followUp: true });

  assert.deepEqual(buffer.addAssistant("国内ニュースをまとめたよ"), {
    user: "ニュースを調べて\n国内だけで",
    assistant: "国内ニュースをまとめたよ",
    source: "typed",
    followUps: ["国内だけで"],
  });
});

test("Realtime turn buffer exposes the newest pending input time for transcript ownership", () => {
  let now = 1_000;
  const buffer = new RealtimeTurnBuffer({ now: () => now });
  buffer.addTyped("先の文字入力");
  now = 1_250;
  buffer.addUser("後の音声入力");
  assert.equal(buffer.newestPendingInputCreatedAt(), 1_250);
  buffer.discardInput("先の文字入力");
  assert.equal(buffer.newestPendingInputCreatedAt(), 1_250);
  buffer.clear();
  assert.equal(buffer.newestPendingInputCreatedAt(), 0);
});
