// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { isSocialConversationTurn } = require("../lib/interaction-intent.cjs");

test("short greetings and thanks remain conversation turns while Work is selected", () => {
  for (const value of ["こんにちは", "ありがとう！", "お疲れさまです。", "うん、了解", "Thanks!"]) {
    assert.equal(isSocialConversationTurn(value), true, value);
  }
});

test("a social phrase combined with a task stays a Work request", () => {
  for (const value of [
    "ありがとう。次はREADMEを直して",
    "こんにちは、名古屋の天気を調べて",
    "了解。Windows版をビルドして",
    "これって何？",
  ]) assert.equal(isSocialConversationTurn(value), false, value);
});
