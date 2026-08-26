// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  NATIVE_HANDOFF_REPLY_GRACE_MS,
  realtimeReplyAuthorized,
} = require("../lib/realtime-reply-authorization.cjs");

test("an active native handoff keeps segmented Live answers authorized after input pairing", () => {
  assert.equal(realtimeReplyAuthorized({ pendingInput: false, activeNativeHandoff: true }), true);
  assert.equal(realtimeReplyAuthorized({ pendingInput: false, completionPending: true }), true);
});

test("a native handoff result may begin just after the Codex turn completes", () => {
  const completedAt = 10_000;
  assert.equal(realtimeReplyAuthorized({
    lastNativeHandoffCompletedAt: completedAt,
    now: completedAt + NATIVE_HANDOFF_REPLY_GRACE_MS,
  }), true);
});

test("an unrelated assistant event remains suppressed outside the handoff window", () => {
  const completedAt = 10_000;
  assert.equal(realtimeReplyAuthorized({ now: 50_000 }), false);
  assert.equal(realtimeReplyAuthorized({
    lastNativeHandoffCompletedAt: completedAt,
    now: completedAt + NATIVE_HANDOFF_REPLY_GRACE_MS + 1,
  }), false);
});
