// SPDX-License-Identifier: Apache-2.0

const NATIVE_HANDOFF_REPLY_GRACE_MS = 12_000;

function realtimeReplyAuthorized({
  pendingInput = false,
  transcribingInput = false,
  injectedSpeech = false,
  activeNativeHandoff = false,
  completionPending = false,
  lastNativeHandoffCompletedAt = 0,
  now = Date.now(),
  completionGraceMs = NATIVE_HANDOFF_REPLY_GRACE_MS,
} = {}) {
  // A Realtime assistant transcript can begin after the first user transcript
  // delta but before the user's transcript/done event has entered the turn
  // buffer. That in-flight transcript is still a grounded physical input and
  // must authorize the answer; otherwise audio begins and is muted mid-word.
  if (pendingInput || transcribingInput || injectedSpeech || activeNativeHandoff || completionPending) return true;
  const completedAt = Number(lastNativeHandoffCompletedAt) || 0;
  const currentTime = Number(now) || 0;
  const grace = Math.max(0, Number(completionGraceMs) || 0);
  return completedAt > 0 && currentTime >= completedAt && currentTime - completedAt <= grace;
}

module.exports = {
  NATIVE_HANDOFF_REPLY_GRACE_MS,
  realtimeReplyAuthorized,
};
