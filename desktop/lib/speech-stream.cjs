// SPDX-License-Identifier: Apache-2.0

const { findNaturalSpeechBoundary } = require("./natural-speech-chunks.cjs");

// Keep URL matching deliberately ASCII-oriented. `\S+` also consumes Japanese
// prose directly following a URL, while a Unicode word boundary can miss URLs
// placed next to Japanese punctuation. These patterns remove the destination
// from speech without changing the text shown in the bubble.
const URL_SCHEME_PATTERN = /(?:https?|ftp):(?:\/\/|／／)[A-Za-z0-9\-._~%!$&'*+,;=:@/?#\[\]]+/giu;
const WWW_PATTERN = /(?:www\.)[A-Za-z0-9\-._~%!$&'*+,;=:@/?#\[\]]+/giu;
const BARE_DOMAIN_PATTERN = /(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?\.)+(?:co\.jp|com|net|org|info|biz|io|ai|app|dev|tech|me|co|jp)(?:[/:?#][A-Za-z0-9\-._~%!$&'*+,;=:@/?#\[\]]*)?/giu;
const URL_TOKEN_PATTERN = /(?:https?|ftp):(?:\/\/|／／)[A-Za-z0-9\-._~%!$&'*+,;=:@/?#\[\]]+|(?:www\.)[A-Za-z0-9\-._~%!$&'*+,;=:@/?#\[\]]+|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?\.)+(?:co\.jp|com|net|org|info|biz|io|ai|app|dev|tech|me|co|jp)(?:[/:?#][A-Za-z0-9\-._~%!$&'*+,;=:@/?#\[\]]*)?/giu;

function stripSpeechUrls(value) {
  return String(value || "")
    .replace(/^\s*\[[^\]]+\]:\s*(?:https?|ftp):\S+.*$/gimu, " ")
    .replace(/<\s*(?:https?|ftp):[^>]+>/giu, " ")
    .replace(URL_SCHEME_PATTERN, " ")
    .replace(WWW_PATTERN, " ")
    .replace(BARE_DOMAIN_PATTERN, " ");
}

function sanitizeSpeechText(value) {
  const cleaned = stripSpeechUrls(value)
    .replace(/cite[^]*(?:|$)/gu, " ")
    .replace(/cite(?:[^]*)?$/gu, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/```[\s\S]*$/g, " ")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+(?:\s*[-,]\s*\d+)*\]/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/`+/g, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, " ")
    .replace(/\b[A-Za-z]:\\[^\s]+/g, " ")
    .replace(/(^|\s)(?:\.{0,2}\/|\/)[^\s]+/g, "$1")
    .replace(/(^|[\s、。,:：；;（(])(?:[\w.-]+[\\/])+[\w.-]+(?=\s|$|[、。！？!?])/g, "$1")
    .replace(/(^|\s)--?[a-z][\w-]*/g, "$1")
    .replace(/\b[\w-]+\.(?:html?|css|js|cjs|mjs|ts|tsx|jsx|json|yaml|yml|toml|ini|exe|dll|wasm|onnx|bin|zip|png|jpe?g|webp|wav|mp3|md)\b/gi, " ")
    .replace(/(^|\s)(?:[\w.-]+[\\/])+(?=\s|$)/g, "$1")
    .replace(/\b[A-Fa-f0-9]{20,}\b/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+] |\d+[.)] )/gm, "")
    .replace(/^\s*[-*_~=|]{3,}\s*$/gm, " ")
    .replace(/[\p{Extended_Pictographic}\p{S}\uFE0F]/gu, " ")
    .replace(/[>*_~#@&^<>\[\]{}|=+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

class StreamingTextSegmenter {
  constructor({ maxLength = 90 } = {}) {
    this.maxLength = Math.max(24, Math.min(160, Number(maxLength) || 90));
    this.maxOverflow = Math.min(6, Math.max(2, Math.ceil(this.maxLength * .1)));
    this.minimumTail = Math.max(6, Math.floor(this.maxLength * .25));
    this.fullText = "";
    this.consumed = 0;
  }

  reset() {
    this.fullText = "";
    this.consumed = 0;
  }

  push(value, { flush = false } = {}) {
    const next = String(value || "");
    if (!next.startsWith(this.fullText)) this.reset();
    this.fullText = next;
    const output = [];

    while (this.consumed < this.fullText.length) {
      const remaining = this.fullText.slice(this.consumed);
      URL_TOKEN_PATTERN.lastIndex = 0;
      const leadingUrl = URL_TOKEN_PATTERN.exec(remaining);
      if (leadingUrl && /^\s*$/u.test(remaining.slice(0, leadingUrl.index))) {
        const skipLength = leadingUrl.index + leadingUrl[0].length;
        // Do not consume a URL token that may still be arriving. Otherwise a
        // later delta would start speaking only its newly appended suffix.
        if (!flush && skipLength === remaining.length) break;
        this.consumed += skipLength;
        continue;
      }
      const sentence = remaining.match(/^[\s\S]*?[。！？!?]+[」』】）)\]"'”’]*(?:\s+|$)?/);
      let length = sentence?.[0]?.length || 0;
      const trailingLength = length ? remaining.length - length : 0;
      if (length >= this.maxLength - this.minimumTail && trailingLength < this.minimumTail) {
        const remainingIsComplete = /[。！？!?][」』】）)\]"'”’]*\s*$/u.test(remaining);
        if (trailingLength > 0 && remainingIsComplete && remaining.length <= this.maxLength + this.maxOverflow) {
          length = remaining.length;
        } else if (!flush) {
          // Wait for a few more streamed characters before committing a nearly
          // full chunk. This small buffer prevents the next delta becoming a
          // standalone two- or three-character utterance.
          length = 0;
        }
      }
      if (length > this.maxLength && length <= this.maxLength + this.maxOverflow) {
        // A very small overflow is preferable to a separate two- or
        // three-character utterance for engines that accept soft limits.
      } else if (length > this.maxLength) {
        const boundaryLimit = length - this.maxLength < this.minimumTail
          ? Math.max(Math.floor(this.maxLength * .55), length - this.minimumTail)
          : this.maxLength;
        length = findNaturalSpeechBoundary(remaining, boundaryLimit, { minimumRatio: .4 });
      }
      if (!length && remaining.length >= this.maxLength + this.minimumTail) {
        const boundaryLimit = remaining.length - this.maxLength < this.minimumTail
          ? Math.max(Math.floor(this.maxLength * .55), remaining.length - this.minimumTail)
          : this.maxLength;
        length = findNaturalSpeechBoundary(remaining, boundaryLimit, { minimumRatio: .4 });
      }
      if (!length && flush) length = remaining.length;
      if (!length) break;
      if (length > this.maxLength + this.maxOverflow) length = findNaturalSpeechBoundary(remaining, this.maxLength, { minimumRatio: .4 });

      URL_TOKEN_PATTERN.lastIndex = 0;
      const crossedUrl = URL_TOKEN_PATTERN.exec(remaining);
      if (crossedUrl && crossedUrl.index < length && crossedUrl.index + crossedUrl[0].length > length) {
        // Commit the prose before the URL. The next loop skips the destination
        // as one token, even when it is longer than the configured TTS chunk.
        length = crossedUrl.index;
        if (!length) {
          const skipLength = crossedUrl[0].length;
          if (!flush && skipLength === remaining.length) break;
          this.consumed += skipLength;
          continue;
        }
      }

      const raw = remaining.slice(0, length);
      this.consumed += length;
      const spoken = sanitizeSpeechText(raw);
      if (spoken) output.push(spoken);
    }
    return output;
  }
}

module.exports = { StreamingTextSegmenter, sanitizeSpeechText, stripSpeechUrls };
