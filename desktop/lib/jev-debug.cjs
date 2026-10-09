// SPDX-License-Identifier: Apache-2.0
function jevFailureReason(error) {
  const message = error?.message;
  if (/^(Jev|Decisions) request timed out$/.test(message)) return "timeout";
  if (/^(Jev|Decisions) API key is not configured$/.test(message)) return "key-not-configured";
  if (/^(Jev|Decisions) HTTP \d{3}$/.test(message)) return message.replace(/^(Jev|Decisions) HTTP /, "http-");
  return "request-or-apply-failed";
}
function createJevDebug({ isPackaged, getProvider = () => "jev", write = (...args) => console.info(...args), now = Date.now }) {
  const allowed = {
    provider: ["jev", "decisions"],
    action: ["none", "next", "previous", "pause", "play"],
    emotion: ["neutral", "happy", "thinking", "surprised", "soft", "joy", "worried", "proud", "exasperated"],
    source: ["user", "assistant"],
    reaction: ["neutral", "happy", "thinking", "surprised", "sad"],
    nikePerformance: ["none", "nod", "ponder", "celebrate", "recoil", "reassure", "explain"],
    reason: ["greeting", "non_speech", "unclear_speech", "addressed", "reply", "unrelated", "unavailable", "busy", "disabled", "empty", "duplicate", "superseded", "stale", "uncertain", "timeout", "key-not-configured", "request-or-apply-failed"],
  };
  return (event, detail = {}) => {
    if (isPackaged()) return;
    if (!/^(address|media|expression|connection|request)-(started|classified|applied|skipped|failed|succeeded)$/.test(event)) return;
    const safe = { at: now() };
    if (event === "address-classified" && typeof detail.accepted === "boolean") safe.accepted = detail.accepted;
    for (const [key, values] of Object.entries(allowed)) {
      if (values.includes(detail[key]) || (key === "reason" && /^http-\d{3}$/.test(detail[key]))) safe[key] = detail[key];
    }
    if (Number.isFinite(detail.latencyMs)) safe.latencyMs = Math.max(0, Math.round(detail.latencyMs));
    // Broken stdout must not interrupt a speech turn (stdio guard also covers
    // asynchronous EPIPE at application bootstrap).
    try {
      const provider = safe.provider || getProvider();
      write(`[${provider === "decisions" ? "Decisions" : "Jev"}] ${event}`, safe);
    } catch { /* Logging is best effort. */ }
  };
}
module.exports = { createJevDebug, jevFailureReason };
