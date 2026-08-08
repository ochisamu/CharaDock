// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cleanAssistantText,
  latestWorkDisplayText,
  workCompletionDisplayText,
  workCompletionSpeechText,
} = require("../lib/assistant-text.cjs");

test("assistant text removes Codex citation control tokens", () => {
  assert.equal(cleanAssistantText("名古屋は晴れです。 citeturn5search2"), "名古屋は晴れです。");
  assert.equal(cleanAssistantText("回答 citeturn5", { streaming: true }), "回答 ");
});

test("work completion speech summarizes the real final answer without reading metadata", () => {
  const answer = [
    "作成しました、ばっちりです！",
    "",
    "作成ファイル: `artifacts/demo/STATUS.md`",
    "",
    "検証済み:",
    "- ファイルの存在を確認",
    "- 見出しを確認",
    "",
    "継続記録も更新しました。",
  ].join("\n");
  assert.equal(workCompletionSpeechText(answer), "作成しました、ばっちりです！ 確認も完了しているよ。");
  assert.doesNotMatch(workCompletionSpeechText(answer), /artifacts|STATUS|継続記録/iu);
  assert.doesNotMatch(workCompletionDisplayText(answer), /継続記録/u);
});

test("work display keeps only the latest message while retaining a bounded layout", () => {
  assert.equal(latestWorkDisplayText("調査しています。\nファイルを更新しています。"), "ファイルを更新しています。");
  assert.equal(latestWorkDisplayText("確認しました。次にテストします。"), "次にテストします。");
  assert.ok(latestWorkDisplayText("長い説明".repeat(100)).length <= 181);
});

test("work completion keeps the natural final answer instead of only its last sentence", () => {
  const answer = "天気ページを作成しました。\n表示とリンクを確認済みです。\nプレビューボタンから開けます。";
  assert.equal(workCompletionDisplayText(answer), answer);
  assert.match(workCompletionDisplayText(answer), /^天気ページを作成しました。/u);
  assert.notEqual(workCompletionDisplayText(answer), "プレビューボタンから開けます。");

  const bounded = workCompletionDisplayText(`${"説明です。".repeat(200)}最後です。`, 260);
  assert.ok(bounded.length <= 261);
  assert.match(bounded, /^説明です。/u);
  assert.match(bounded, /…$/u);
});
