// SPDX-License-Identifier: Apache-2.0

// Consent is deliberately separate from requests. An imperative can open the
// permission UI, but it must never silently grant a retained control lease.
const DENY = /\b(?:no(?:\s+thanks)?|cancel|stop|never mind|nevermind)\b|\b(?:do not|don't|cannot|can't|not now|rather not|without permission)\b/i;
const APPROVE = /^(?:yes|yeah|yep|sure|okay|ok|please do|go ahead|you may|i (?:allow|approve|agree))(?:[\s,.!]*(?:please|go ahead|do it|you may|that's fine|that is fine|thanks|thank you))*[\s,.!]*$/i;
const ACTION = /\b(?:open|launch|click|press|type|control|operate|switch to|scroll)\b/i;
const EXPLANATION = /\b(?:explain|meaning|what (?:is|are|does)|how (?:do|does|can|to))\b/i;

function englishControlConsent(message) {
  const text = String(message || "").trim();
  if (DENY.test(text)) return "deny";
  return text.length <= 80 && APPROVE.test(text) ? "approve" : "";
}

function englishControlRequest(message, kind) {
  const text = String(message || "");
  if (DENY.test(text) || EXPLANATION.test(text)) return false;
  if (kind === "screen") return /\b(?:screen|screenshot|display|desktop)\b/i.test(text)
    && /\b(?:look at|take a look|view|read|check|inspect|capture|share|see what's|see what is)\b/i.test(text);
  if (kind === "computer") return /\b(?:computer|PC|Windows|Mac|macOS|desktop|app|window|notepad|file explorer)\b/i.test(text) && ACTION.test(text);
  return /\b(?:open|visit|read|check|inspect|browse|search|navigate|look at|use|control|launch)\b/i.test(text);
}

function englishControlContinuation(message, kind) {
  const text = String(message || "");
  if (/^(?:please\s+)?(?:stop|cancel|that's enough|that is enough|we're done|we are done|no more)(?:\b|[.!])/i.test(text)) return "stop";
  if (DENY.test(text) || EXPLANATION.test(text)) return "";
  const reference = /\b(?:continue|keep going|next|then|again|same|that|this|go back)\b/i.test(text);
  const action = kind === "browser"
    ? /\b(?:open|click|press|type|scroll|read|check|inspect|select|follow|go back)\b/i.test(text)
    : ACTION.test(text);
  return reference && action ? "continue" : "";
}

module.exports = { englishControlConsent, englishControlRequest, englishControlContinuation };
