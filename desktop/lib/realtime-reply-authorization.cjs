// SPDX-License-Identifier: Apache-2.0

const NATIVE_HANDOFF_REPLY_GRACE_MS = 12_000;

function realtimeReplyAuthorized({
  pendingInput = false,
  injectedSpeech = false,
  activeNativeHandoff = false,
  completionPending = false,
  lastNativeHandoffCompletedAt = 0,
  now = Date.now(),
  completionGraceMs = NATIVE_HANDOFF_REPLY_GRACE_MS,
} = {}) {
  if (pendingInput || injectedSpeech || activeNativeHandoff || completionPending) return true;
  const completedAt = Number(lastNativeHandoffCompletedAt) || 0;
  const currentTime = Number(now) || 0;
  const grace = Math.max(0, Number(completionGraceMs) || 0);
  return completedAt > 0 && currentTime >= completedAt && currentTime - completedAt <= grace;
}

module.exports = {
  NATIVE_HANDOFF_REPLY_GRACE_MS,
  realtimeReplyAuthorized,
};
