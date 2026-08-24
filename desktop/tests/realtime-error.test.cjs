// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REALTIME_COMPATIBILITY_MESSAGE,
  REALTIME_UNAVAILABLE_MESSAGE,
  isRealtimeCompatibilityError,
  isRealtimeUnavailableError,
  userFacingRealtimeError,
} = require("../lib/realtime-error.cjs");

test("Realtime protocol rollout mismatches are actionable and are not mislabeled as account availability", () => {
  const errors = [
    "Field `session.model` is not allowed for this Codex realtime session",
    '{"error":{"message":"AVAS requires OpenAI-Alpha: quicksilver=v2.","code":"invalid_quicksilver_alpha_header"}}',
  ];
  for (const raw of errors) {
    assert.equal(isRealtimeCompatibilityError(raw), true);
    assert.equal(isRealtimeUnavailableError(raw), false);
    assert.equal(userFacingRealtimeError(raw), REALTIME_COMPATIBILITY_MESSAGE);
  }
});

test("Codex Realtime backend 404 is recognized as account availability", () => {
  const raw = "unexpected status 404 Not Found: {\"detail\":\"Not Found\"}, url: https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver";
  assert.equal(isRealtimeUnavailableError(raw), true);
  assert.equal(userFacingRealtimeError(raw), REALTIME_UNAVAILABLE_MESSAGE);
  assert.equal(userFacingRealtimeError(raw).includes("https://"), false);
});

test("other Codex Realtime errors retain their useful message", () => {
  assert.equal(isRealtimeUnavailableError("microphone permission denied"), false);
  assert.equal(userFacingRealtimeError(new Error("microphone permission denied")), "microphone permission denied");
});
