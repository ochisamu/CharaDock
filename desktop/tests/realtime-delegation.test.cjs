// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { realtimeDelegationHistoryText, realtimeDelegationInput } = require("../lib/realtime-delegation.cjs");

test("Realtime Work history keeps only the current delegated input", () => {
  const wrapped = [
    "<realtime_delegation>",
    "<input>マークダウンにしといて</input>",
    "<transcript_delta>assistant: できたよ user: マークダウンにしといて</transcript_delta>",
    "</realtime_delegation>",
  ].join(" ");
  assert.equal(realtimeDelegationInput(wrapped), "マークダウンにしといて");
});

test("Realtime delegation input decodes XML without changing normal requests", () => {
  assert.equal(realtimeDelegationInput("READMEを直して"), "READMEを直して");
  assert.equal(realtimeDelegationInput("<realtime_delegation><input>A &amp; Bを確認</input></realtime_delegation>"), "A & Bを確認");
  assert.equal(realtimeDelegationInput("<realtime_delegation><transcript_delta>private context</transcript_delta></realtime_delegation>"), "");
});

test("persisted malformed delegation history is replaced without exposing internal context", () => {
  assert.equal(
    realtimeDelegationHistoryText("<realtime_delegation><transcript_delta>private context</transcript_delta></realtime_delegation>", "Liveで依頼された作業"),
    "Liveで依頼された作業",
  );
  assert.equal(realtimeDelegationHistoryText("通常の履歴", "fallback"), "通常の履歴");
});
