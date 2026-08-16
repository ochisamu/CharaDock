// SPDX-License-Identifier: Apache-2.0

const { characterReactionTuning } = require("../generated/runtime/character-director.js");

function expressionForText(text, { listening = false, characterId = "" } = {}) {
  const value = String(text || "");
  const durationScale = listening ? 0.72 : 1;
  const make = (emotion, forceMouth, forceEyesClosed, durationMs) => ({
    emotion,
    reaction: emotion,
    forceMouth,
    forceEyesClosed,
    durationMs: Math.round(durationMs * durationScale),
  });

  const tune = (expression) => {
    if (!characterId) return expression;
    const tuning = characterReactionTuning(characterId, expression.reaction || expression.emotion);
    return {
      ...expression,
      durationMs: Math.round(expression.durationMs * tuning.durationScale),
      intensity: tuning.intensity,
    };
  };

  if (/眠|おやす|疲れ|休も|休ん|つら|辛い|悲し|さみし|寂し|ごめん|残念/.test(value)) {
    return tune({ ...make("soft", 0, false, 2200), reaction: "sad" });
  }
  if (/怒|むかつ|腹が立|許せな|最悪/.test(value)) {
    return tune({ ...make("surprised", 1, false, 1700), reaction: "angry" });
  }
  if (/[!?！？]{2,}|びっくり|驚|まさか|すごい|本当[？?]|えっ|わっ/.test(value)) {
    return tune(make("surprised", 2, false, 1500));
  }
  if (/ありがとう|うれし|嬉し|よかった|楽しい|好き|最高|できた|成功|おめでとう|😊|😄|笑|ｗ/.test(value)) {
    return tune(make("happy", 1, false, 2100));
  }
  if (/[?？]|どう思|なぜ|なんで|教えて|考え/.test(value)) {
    return tune(make("thinking", 0, false, 1150));
  }
  return tune(make(listening ? "listening" : "neutral", listening ? 0 : 1, false, listening ? 850 : 1050));
}

function messageExpression(text, options = {}) {
  return expressionForText(text, { ...options, listening: true });
}

function responseExpression(text, options = {}) {
  return expressionForText(text, options);
}

function estimatedSpeechDurationMs(text) {
  const value = String(text || "").trim();
  const characters = value.replace(/\s/g, "").length;
  const pauses = (value.match(/[、。！？!?]/g) || []).length;
  return Math.max(1200, Math.min(9000, 650 + characters * 105 + pauses * 170));
}

// During speech the audio envelope must own the mouth and normal blinking must
// remain available. Only the optional emotion artwork is held for the segment.
function speechExpression(text, options = {}) {
  const expression = responseExpression(text, options);
  return {
    ...expression,
    forceMouth: null,
    forceEyesClosed: null,
    durationMs: Math.max(expression.durationMs, estimatedSpeechDurationMs(text)),
  };
}

module.exports = {
  estimatedSpeechDurationMs,
  expressionForText,
  messageExpression,
  responseExpression,
  speechExpression,
};
