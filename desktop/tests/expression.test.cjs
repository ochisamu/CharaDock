// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  estimatedSpeechDurationMs,
  messageExpression,
  responseExpression,
  speechExpression,
} = require("../lib/expression.cjs");

test("conversation text maps to distinct mascot expressions", () => {
  assert.equal(responseExpression("できた！ありがとう").emotion, "happy");
  assert.equal(responseExpression("えっ！？まさか！").emotion, "surprised");
  assert.equal(responseExpression("今日は疲れた。おやすみ").emotion, "soft");
  assert.equal(responseExpression("どう思う？").emotion, "thinking");
  assert.equal(responseExpression("今日は疲れた。おやすみ").reaction, "sad");
  assert.equal(responseExpression("それは許せない、腹が立つ").reaction, "angry");
});

test("user-message reaction is shorter than the reply expression", () => {
  assert.ok(messageExpression("ありがとう").durationMs < responseExpression("ありがとう").durationMs);
});

test("spoken expressions leave mouth and blinking under live audio control", () => {
  const expression = speechExpression("できた！ありがとう。次も一緒にやろうね。");
  assert.equal(expression.emotion, "happy");
  assert.equal(expression.forceMouth, null);
  assert.equal(expression.forceEyesClosed, null);
  assert.ok(expression.durationMs >= estimatedSpeechDurationMs("できた！ありがとう。次も一緒にやろうね。"));
});

test("longer speech segments retain their expression for longer", () => {
  assert.ok(estimatedSpeechDurationMs("少し長めの文章をゆっくり読み上げます。") > estimatedSpeechDurationMs("短いよ。"));
});

test("built-in characters tune the same semantic reaction differently", () => {
  const kohaku = speechExpression("できた！ありがとう。", { characterId: "amber-avatar" });
  const sepia = speechExpression("できた！ありがとう。", { characterId: "bronze-avatar" });
  assert.equal(kohaku.emotion, "happy");
  assert.equal(sepia.emotion, "happy");
  assert.ok(kohaku.intensity > sepia.intensity);
  assert.ok(sepia.durationMs > kohaku.durationMs);
  assert.equal(kohaku.forceMouth, null);
});
