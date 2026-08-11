// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_WORK_SLM_MODEL_ID,
  WORK_SLM_MODELS,
  generatedTextFromPipeline,
  normalizeWorkSlmModelId,
  parseWorkSlmOutput,
  prefilledWorkSlmJson,
  workSlmAnchors,
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
  assert.doesNotMatch(messages[0].content, /"text":"\.\.\."/);
  assert.match(messages[0].content, /完了.*捏造しません/);
  assert.match(messages[0].content, /進行形/);
  assert.match(messages[1].content, /README\.mdの構成を確認しています/);
  assert.match(messages[1].content, /根拠語.*README\.md/);
  assert.equal(DEFAULT_WORK_SLM_MODEL_ID, "onnx-community/Qwen3.5-0.8B-ONNX-OPT");
});

test("Work SLM keeps Qwen and Japanese LFM models as bounded selectable models", () => {
  assert.deepEqual(WORK_SLM_MODELS.map((model) => model.family), ["qwen3.5", "lfm2.5-jp", "qwen2.5"]);
  assert.equal(normalizeWorkSlmModelId("LiquidAI/LFM2.5-1.2B-JP-202606-ONNX"), "LiquidAI/LFM2.5-1.2B-JP-202606-ONNX");
  assert.equal(WORK_SLM_MODELS[1].dtype, "q4f16");
  assert.match(WORK_SLM_MODELS[1].licenseNotice, /1,000万/);
  assert.equal(WORK_SLM_MODELS[2].dtype, "q8");
  assert.equal(normalizeWorkSlmModelId("onnx-community/Qwen2.5-0.5B-Instruct"), "onnx-community/Qwen2.5-0.5B-Instruct");
  assert.equal(normalizeWorkSlmModelId("untrusted/model"), DEFAULT_WORK_SLM_MODEL_ID);
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

test("Work SLM normalizes assistant-prefilled continuations into bounded JSON", () => {
  assert.deepEqual(JSON.parse(prefilledWorkSlmJson('READMEの構成を確認しているよ。","emotion":"thinking"}')), {
    text: "READMEの構成を確認しているよ。",
    emotion: "thinking",
  });
  assert.deepEqual(JSON.parse(prefilledWorkSlmJson("ファイルを順番に見直しているよ。\n余計な説明")), {
    text: "ファイルを順番に見直しているよ。",
    emotion: "neutral",
  });
});

test("Work SLM extracts concrete grounding terms and rejects unrelated chatter", () => {
  assert.deepEqual(workSlmAnchors("README.mdの構成と説明を確認しています"), ["README.md", "構成", "説明"]);
  assert.throws(() => parseWorkSlmOutput(
    '{"text":"今日はとても良い天気だね。","emotion":"neutral"}',
    { sourceText: "READMEの構成を確認しています", request: "READMEを整えて", kind: "progress" },
  ), /not grounded/);
  assert.throws(() => parseWorkSlmOutput(
    '{"text":"READMEを公開向けに整理しました。","emotion":"happy"}',
    { sourceText: "READMEの構成を確認しています", request: "READMEを整えて", kind: "progress" },
  ), /completion too early/);
  assert.deepEqual(parseWorkSlmOutput(
    '{"text":"READMEを公開向けに整理しましたよ。構成と説明を確認中だよ。","emotion":"happy"}',
    { sourceText: "READMEの構成と説明を確認しています", request: "READMEを整えて", kind: "progress" },
  ), { text: "構成と説明を確認中だよ。", emotion: "happy" });
  assert.throws(() => parseWorkSlmOutput(
    '{"text":"依頼: READMEの構成を確認していただけますか？","emotion":"neutral"}',
    { sourceText: "READMEの構成を確認しています", request: "READMEを整えて", kind: "progress" },
  ), /asked the user/);
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
