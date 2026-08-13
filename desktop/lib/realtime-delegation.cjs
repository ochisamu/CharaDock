// SPDX-License-Identifier: Apache-2.0

function decodeXmlText(value) {
  const decodeCodePoint = (match, code, radix) => {
    const parsed = Number.parseInt(code, radix);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10FFFF && !(parsed >= 0xD800 && parsed <= 0xDFFF)
      ? String.fromCodePoint(parsed)
      : match;
  };
  return String(value || "")
    .replace(/&#(\d+);/gu, (match, code) => decodeCodePoint(match, code, 10))
    .replace(/&#x([0-9a-f]+);/giu, (match, code) => decodeCodePoint(match, code, 16))
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'")
    .replace(/&amp;/giu, "&");
}

function realtimeDelegationInput(value) {
  const text = String(value || "").trim();
  if (!/<realtime_delegation(?:\s|>)/iu.test(text)) return text;
  const input = text.match(/<input>([\s\S]*?)<\/input>/iu)?.[1];
  if (input === undefined) return "";
  return decodeXmlText(input).replace(/\s+/gu, " ").trim();
}

function realtimeDelegationHistoryText(value, fallback = "") {
  const text = String(value || "").trim();
  const input = realtimeDelegationInput(text);
  if (input) return input;
  return /<realtime_delegation(?:\s|>)/iu.test(text) ? String(fallback || "").trim() : text;
}

module.exports = { realtimeDelegationHistoryText, realtimeDelegationInput };
