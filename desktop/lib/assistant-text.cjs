// SPDX-License-Identifier: Apache-2.0

const { findNaturalSpeechBoundary } = require("./natural-speech-chunks.cjs");
const { sanitizeSpeechText } = require("./speech-stream.cjs");

function cleanAssistantText(value, { streaming = false } = {}) {
  let text = String(value || "")
    .replace(/cite[^]*(?:|$)/gu, "")
    .replace(/cite(?:[^]*)?$/gu, "")
    .replace(/[ \t]+([、。！？!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  if (!streaming) text = text.trim();
  return text;
}

function latestWorkDisplayText(value, maxLength = 180) {
  const text = cleanAssistantText(value).replace(/\r/g, "");
  if (!text) return "作業を続けています…";
  const blocks = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  let latest = blocks.at(-1) || text;
  const sentences = latest.match(/[^。！？!?]*[。！？!?]+|[^。！？!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];
  if (sentences.length > 1) latest = sentences.at(-1);
  const limit = Math.max(60, Number(maxLength) || 180);
  return latest.length > limit ? `…${latest.slice(-limit)}` : latest;
}

function workCompletionDisplayText(value, maxLength = 1200) {
  const text = cleanAssistantText(value)
    .replace(/\r/g, "")
    .replace(/^.*(?:Character Home|継続記録|継続メモ|次回のため[^\n]*記録).*$/gimu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";
  const limit = Math.max(240, Math.min(4000, Number(maxLength) || 1200));
  if (text.length <= limit) return text;

  const head = text.slice(0, limit);
  const minimum = Math.floor(limit * .6);
  let boundary = -1;
  for (const match of head.matchAll(/[。！？!?](?:[」』】）)\]"'”’])?|\n/gu)) {
    const end = Number(match.index) + match[0].length;
    if (end >= minimum) boundary = end;
  }
  return `${head.slice(0, boundary > 0 ? boundary : limit).trimEnd()}…`;
}

function workCompletionSpeechText(value, language = "ja", maxLength = 280) {
  const display = workCompletionDisplayText(value, 2000);
  if (!display) return language === "en" ? "The work is complete." : "作業が完了したよ。";
  const blocks = display.split(/\n\s*\n/u).map((part) => sanitizeSpeechText(part)).filter(Boolean);
  let summary = blocks.find((part) => !/^(?:作成ファイル|保存先|出力先|files?|output)\s*[:：]?$/iu.test(part)) || "";
  const verified = /(?:検証済み|確認(?:も|が)?完了|テスト(?:済み|完了|成功)|verified|checks? passed)/iu.test(display);
  if (verified && !/(?:検証|確認|テスト|verified|checked)/iu.test(summary)) {
    summary = `${summary}${language === "en" ? " Verification is complete." : " 確認も完了しているよ。"}`.trim();
  }
  if (summary.length <= maxLength) return summary;
  const boundary = findNaturalSpeechBoundary(summary, maxLength, { minimumRatio: .55 });
  return summary.slice(0, Math.max(1, boundary)).trim();
}

module.exports = {
  cleanAssistantText,
  latestWorkDisplayText,
  workCompletionDisplayText,
  workCompletionSpeechText,
};
