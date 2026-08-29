// SPDX-License-Identifier: Apache-2.0

const ACTIVE_TURN_STATUSES = new Set(["thinking", "working", "speaking"]);

function normalConversationSubmitRoute({
  realtimeOutput = false,
  activeWork = false,
  activeInteraction = false,
  conflictingInteraction = false,
  activeRealtime = false,
  turnStatus = "idle",
} = {}) {
  if (realtimeOutput) return "new-turn";
  // Live owns typed input while its transport is present. This check comes
  // before native handoff activity because a still-connected Live session
  // must never accidentally start or steer a normal-TTS route.
  if (activeRealtime) return "active-live";
  // Switching Chat / Work changes the destination of the next turn. Never
  // steer that input into a still-finishing turn owned by the previous mode.
  if (conflictingInteraction) return "busy";
  // Once Live has actually closed, a delegated Codex turn can continue. A
  // normal submit at that point is a follow-up to that turn, not a competing
  // answer and not an error the user needs to understand.
  if (activeWork || activeInteraction) return "follow-up";
  if (ACTIVE_TURN_STATUSES.has(String(turnStatus || ""))) return "busy";
  return "new-turn";
}

function isMissingActiveTurnError(error) {
  return /no active turn to (?:steer|interrupt)/i.test(String(error?.message || error || ""));
}

module.exports = {
  ACTIVE_TURN_STATUSES,
  isMissingActiveTurnError,
  normalConversationSubmitRoute,
};
