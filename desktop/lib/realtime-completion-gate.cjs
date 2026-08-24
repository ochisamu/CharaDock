// SPDX-License-Identifier: Apache-2.0
const { comparableInjectedSpeech } = require("./realtime-injected-speech.cjs");

function comparableOverlap(left, right) {
  const first = comparableInjectedSpeech(left);
  const second = comparableInjectedSpeech(right);
  return Boolean(first && second && (first.includes(second) || second.includes(first)));
}

function completionMinimumAssistantSequence({
  assistantSequence = 0,
  assistantActive = false,
  assistantStartedAt = 0,
  finalAvailableAt = 0,
  expectedText = "",
  currentText = "",
} = {}) {
  const sequence = Math.max(0, Number(assistantSequence) || 0);
  const currentMatches = comparableOverlap(expectedText, currentText);
  const beganAfterGrounding = Boolean(
    assistantActive
    && Number(assistantStartedAt) > 0
    && Number(finalAvailableAt) > 0
    && Number(assistantStartedAt) >= Number(finalAvailableAt) - 250
  );
  return currentMatches || beganAfterGrounding ? sequence : sequence + 1;
}

function completionTranscriptEligible({
  sequence = 0,
  minimumSequence = 0,
  expectedText = "",
  actualText = "",
  responseStartedAt = 0,
  completionCreatedAt = 0,
  newestPendingInputCreatedAt = 0,
} = {}) {
  if (comparableOverlap(expectedText, actualText)) return true;
  if (Math.max(0, Number(sequence) || 0) < Math.max(1, Number(minimumSequence) || 1)) return false;
  const pendingAt = Number(newestPendingInputCreatedAt) || 0;
  const completionAt = Number(completionCreatedAt) || 0;
  const responseAt = Number(responseStartedAt) || 0;
  // A new user input submitted after Work completed owns any response that
  // begins after it. Do not mistake that answer for the delayed completion
  // voice merely because it is the next assistant transcript in sequence.
  return !(pendingAt > completionAt && responseAt >= pendingAt);
}

module.exports = { comparableOverlap, completionMinimumAssistantSequence, completionTranscriptEligible };
