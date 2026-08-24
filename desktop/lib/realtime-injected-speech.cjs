// SPDX-License-Identifier: Apache-2.0

function comparableInjectedSpeech(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s、。！？!?.,・「」『』（）()]/g, "")
    .toLowerCase();
}

function recentInjectedSpeech(entries, now = Date.now(), maxAgeMs = 30_000) {
  const cutoff = Number(now) - Math.max(1_000, Number(maxAgeMs) || 30_000);
  return (Array.isArray(entries) ? entries : []).filter((entry) => Number(entry?.createdAt) >= cutoff);
}

function consumeInjectedSpeech(entries, text, {
  now = Date.now(),
  responseStartedAt = 0,
  newestPendingInputCreatedAt = 0,
} = {}) {
  const pending = recentInjectedSpeech(entries, now);
  const comparable = comparableInjectedSpeech(text);
  let index = pending.findIndex((entry) => {
    const expected = comparableInjectedSpeech(entry?.text);
    return expected && comparable && (expected === comparable || expected.includes(comparable) || comparable.includes(expected));
  });
  // Realtime may rephrase appendSpeech. Falling back to the oldest injected
  // Chat response is safe only when no newer user input can own this response,
  // or when this assistant response demonstrably began before that input.
  // Otherwise keep the injected entry for its own later transcript instead of
  // pairing a stale spoken caption with the user's new turn.
  if (index < 0) {
    const pendingInputAt = Number(newestPendingInputCreatedAt) || 0;
    const responseAt = Number(responseStartedAt) || 0;
    const candidateIndex = pending.findIndex((entry) => entry?.kind === "chat");
    const candidateCreatedAt = Number(pending[candidateIndex]?.createdAt) || 0;
    const fallbackAllowed = candidateIndex >= 0 && (
      !pendingInputAt
      || pendingInputAt <= candidateCreatedAt
      || (responseAt > 0 && responseAt < pendingInputAt)
    );
    if (fallbackAllowed) index = candidateIndex;
  }
  if (index < 0) return { entry: null, entries: pending };
  const [entry] = pending.splice(index, 1);
  return { entry: entry || null, entries: pending };
}

module.exports = { comparableInjectedSpeech, consumeInjectedSpeech, recentInjectedSpeech };
