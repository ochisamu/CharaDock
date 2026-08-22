// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { completionMinimumAssistantSequence, completionTranscriptEligible } = require("../lib/realtime-completion-gate.cjs");

test("an acknowledgement already speaking before Work completion cannot finish the final voice phase", () => {
  const minimum = completionMinimumAssistantSequence({
    assistantSequence: 3,
    assistantActive: true,
    assistantStartedAt: 1_000,
    finalAvailableAt: 2_000,
    expectedText: "ファイルを更新しました",
    currentText: "確認してみるね",
  });
  assert.equal(minimum, 4);
  assert.equal(completionTranscriptEligible({
    sequence: 3,
    minimumSequence: minimum,
    expectedText: "ファイルを更新しました",
    actualText: "確認してみるね",
  }), false);
});

test("the next grounded Live response may paraphrase the Codex result without triggering a duplicate retry", () => {
  assert.equal(completionTranscriptEligible({
    sequence: 4,
    minimumSequence: 4,
    expectedText: "READMEを更新し、テストを実行しました。",
    actualText: "READMEの更新とテストまで終わったよ。",
  }), true);
});

test("a final response already speaking when turn completion arrives remains eligible", () => {
  const minimum = completionMinimumAssistantSequence({
    assistantSequence: 5,
    assistantActive: true,
    assistantStartedAt: 2_050,
    finalAvailableAt: 2_100,
    expectedText: "完了しました",
    currentText: "完了したよ",
  });
  assert.equal(minimum, 5);
  assert.equal(completionTranscriptEligible({ sequence: 5, minimumSequence: minimum }), true);
});

test("an answer to a newer user input cannot masquerade as delayed Work completion", () => {
  assert.equal(completionTranscriptEligible({
    sequence: 7,
    minimumSequence: 7,
    expectedText: "READMEを更新しました。",
    actualText: "明日の天気は晴れだよ。",
    completionCreatedAt: 2_000,
    newestPendingInputCreatedAt: 2_200,
    responseStartedAt: 2_300,
  }), false);
  assert.equal(completionTranscriptEligible({
    sequence: 7,
    minimumSequence: 7,
    expectedText: "READMEを更新しました。",
    actualText: "READMEを更新しました！",
    completionCreatedAt: 2_000,
    newestPendingInputCreatedAt: 2_200,
    responseStartedAt: 2_300,
  }), true);
});
