// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { consumeInjectedSpeech, recentInjectedSpeech } = require("../lib/realtime-injected-speech.cjs");

test("injected speech consumes punctuation variants without touching a newer user answer", () => {
  const entries = [{ text: "結果をまとめたよ。", kind: "chat", createdAt: 1_000 }];
  const consumed = consumeInjectedSpeech(entries, "結果をまとめたよ！", {
    now: 2_000,
    responseStartedAt: 1_100,
    newestPendingInputCreatedAt: 1_500,
  });
  assert.equal(consumed.entry.text, "結果をまとめたよ。");
  assert.deepEqual(consumed.entries, []);
});

test("a newer user turn prevents blind consumption of an unrelated injected Chat reply", () => {
  const entries = [{ text: "最初の答えだよ", kind: "chat", createdAt: 1_000 }];
  const result = consumeInjectedSpeech(entries, "追加条件を反映した答えだよ", {
    now: 2_000,
    responseStartedAt: 1_700,
    newestPendingInputCreatedAt: 1_500,
  });
  assert.equal(result.entry, null);
  assert.equal(result.entries.length, 1);
});

test("a response that began before the next input may consume a rephrased injected Chat reply", () => {
  const entries = [{ text: "確認結果を伝えるね", kind: "chat", createdAt: 1_000 }];
  const result = consumeInjectedSpeech(entries, "調べた内容を話すね", {
    now: 2_000,
    responseStartedAt: 1_200,
    newestPendingInputCreatedAt: 1_500,
  });
  assert.equal(result.entry.kind, "chat");
  assert.deepEqual(result.entries, []);
});

test("an older pending request does not block consumption of its injected answer", () => {
  const entries = [{ text: "確認結果を伝えるね", kind: "chat", createdAt: 1_000 }];
  const result = consumeInjectedSpeech(entries, "調べた内容を話すね", {
    now: 2_000,
    responseStartedAt: 1_200,
    newestPendingInputCreatedAt: 500,
  });
  assert.equal(result.entry.kind, "chat");
});

test("stale injected speech cannot authorize or consume a later transcript", () => {
  const entries = [{ text: "古い発話", kind: "chat", createdAt: 1_000 }];
  assert.deepEqual(recentInjectedSpeech(entries, 31_001), []);
  const result = consumeInjectedSpeech(entries, "別の回答", { now: 31_001 });
  assert.equal(result.entry, null);
  assert.deepEqual(result.entries, []);
});
