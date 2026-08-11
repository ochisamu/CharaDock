// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WORK_SLM_MODEL_ID,
  generatedTextFromPipeline,
  parseWorkSlmOutput,
  workSlmExpression,
  workSlmMessages,
} = require("../lib/work-slm.cjs");

test("Work SLM prompt limits the model to grounded spoken progress", () => {
  const messages = workSlmMessages({
    language: "ja",
    kind: "progress",
    request: "READMEを公開向けに整えて",
    sourceText: "README.mdの構成を確認しています",
    characterName: "コハク",
    personality: "明るく親しみやすい",
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /JSONオブジェクト一つだけ/);
  assert.match(messages[0].content, /完了.*捏造しません/);
  assert.match(messages[1].content, /README\.mdの構成を確認しています/);
  assert.equal(WORK_SLM_MODEL_ID, "onnx-community/Qwen2.5-0.5B-Instruct");
});

test("Work SLM output parser accepts chat pipeline output", () => {
  const output = [{ generated_text: [
    { role: "user", content: "input" },
    { role: "assistant", content: '{"text":"公開向けの構成を見直しているよ。","emotion":"thinking"}' },
  ] }];
  assert.equal(generatedTextFromPipeline(output).startsWith("{"), true);
  assert.deepEqual(parseWorkSlmOutput(output, { sourceText: "構成を確認中", kind: "progress" }), {
    text: "公開向けの構成を見直しているよ。",
    emotion: "thinking",
  });
});

test("Work SLM output parser rejects invented completion and strips speech-hostile markup", () => {
  assert.throws(() => parseWorkSlmOutput(
    '{"text":"全部完成したよ。","emotion":"happy"}',
    { sourceText: "ファイルを確認中", kind: "progress" },
  ), /completion too early/);
  assert.deepEqual(parseWorkSlmOutput(
    '{"text":"`README` のリンク https://example.com を確認しているよ。","emotion":"unknown"}',
    { sourceText: "リンクを確認中", kind: "progress" },
  ), { text: "のリンク を確認しているよ。", emotion: "neutral" });
});

test("Work SLM emotion maps to the existing restrained expression palette", () => {
  assert.equal(workSlmExpression("concerned", "少し確認しているよ").reaction, "sad");
  assert.equal(workSlmExpression("excited", "いい形になってきたよ").reaction, "surprised");
  assert.equal(workSlmExpression("invalid", "確認中").reaction, "neutral");
});
