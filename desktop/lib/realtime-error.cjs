// SPDX-License-Identifier: Apache-2.0

const REALTIME_UNAVAILABLE_MESSAGE = "ChatGPT側でGPT-Live / Codex Voiceがこのアカウントにまだ提供されていません。";
const REALTIME_COMPATIBILITY_MESSAGE = "現在、Codex Realtime側の一時的な互換性問題でLiveを開始できません。通常の音声入力・TTSはそのまま利用できます。しばらくしてから再試行してください。";

function isRealtimeUnavailableError(value) {
  const message = String(value?.message || value || "");
  return /(?:\b404\b|not found|codex\/realtime\/calls|realtime[^\n]{0,80}not available)/i.test(message);
}

function isRealtimeCompatibilityError(value) {
  const message = String(value?.message || value || "");
  return /field [`']?session\.model[`']? is not allowed|session\.model[^\n]*not allowed|invalid_quicksilver_alpha_header|requires openai-alpha:\s*quicksilver=v2/i.test(message);
}

function userFacingRealtimeError(value) {
  if (isRealtimeCompatibilityError(value)) return REALTIME_COMPATIBILITY_MESSAGE;
  if (isRealtimeUnavailableError(value)) return REALTIME_UNAVAILABLE_MESSAGE;
  const message = String(value?.message || value || "").trim();
  return message || "GPT-Live / Codex Voiceを開始できませんでした。";
}

module.exports = {
  REALTIME_COMPATIBILITY_MESSAGE,
  REALTIME_UNAVAILABLE_MESSAGE,
  isRealtimeCompatibilityError,
  isRealtimeUnavailableError,
  userFacingRealtimeError,
};
