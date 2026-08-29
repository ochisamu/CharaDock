// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { isMissingActiveTurnError, normalConversationSubmitRoute } = require("../lib/conversation-submit.cjs");

test("normal submit follows a delegated turn after Live has closed", () => {
  assert.equal(normalConversationSubmitRoute({
    activeInteraction: true,
    activeRealtime: false,
    turnStatus: "working",
  }), "follow-up");
  assert.equal(normalConversationSubmitRoute({
    activeWork: true,
    activeRealtime: false,
    turnStatus: "working",
  }), "follow-up");
});

test("normal submit never competes with a connected Live route", () => {
  assert.equal(normalConversationSubmitRoute({
    activeInteraction: true,
    activeRealtime: true,
    turnStatus: "speaking",
  }), "active-live");
});

test("normal submit preserves non-Live busy and idle boundaries", () => {
  assert.equal(normalConversationSubmitRoute({ turnStatus: "speaking" }), "busy");
  assert.equal(normalConversationSubmitRoute({ turnStatus: "complete" }), "new-turn");
  assert.equal(normalConversationSubmitRoute({ turnStatus: "idle" }), "new-turn");
  assert.equal(normalConversationSubmitRoute({
    realtimeOutput: true,
    activeInteraction: true,
    activeRealtime: true,
    turnStatus: "speaking",
  }), "new-turn");
});

test("normal submit never steers across a Chat or Work mode switch", () => {
  assert.equal(normalConversationSubmitRoute({
    conflictingInteraction: true,
    activeInteraction: false,
    turnStatus: "working",
  }), "busy");
});

test("a follow-up that races turn completion can retry as a new turn", () => {
  assert.equal(isMissingActiveTurnError(new Error("no active turn to steer")), true);
  assert.equal(isMissingActiveTurnError(new Error("no active turn to interrupt")), true);
  assert.equal(isMissingActiveTurnError(new Error("network unavailable")), false);
});
