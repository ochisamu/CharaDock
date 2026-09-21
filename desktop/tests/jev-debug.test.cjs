const test = require("node:test");
const assert = require("node:assert/strict");
const { createJevDebug, jevFailureReason } = require("../lib/jev-debug.cjs");
const { JevExpressionDirector } = require("../lib/jev-expression-director.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
test("Jev console is development-only and allows only safe metadata", () => {
  const logs = []; let packaged = true;
  const log = createJevDebug({ isPackaged: () => packaged, write: (...args) => logs.push(args), now: () => 1234 });
  log("media-started"); assert.equal(logs.length, 0);
  packaged = false;
  log("media-classified", { action: "next", latencyMs: 231.2, apiKey: "SECRET", text: "PRIVATE" });
  log("expression-failed", { reason: "PRIVATE", emotion: "SECRET", error: "SECRET" });
  log("SECRET", {});
  assert.deepEqual(logs, [["[Jev] media-classified", { at: 1234, action: "next", latencyMs: 231 }], ["[Jev] expression-failed", { at: 1234 }]]);
  assert.doesNotThrow(() => createJevDebug({ isPackaged: () => false, write: () => { throw new Error("EPIPE"); } })("media-started"));
  assert.equal(jevFailureReason(new Error("Jev HTTP 401")), "http-401");
  assert.equal(jevFailureReason(new Error("Jev request timed out")), "timeout");
  assert.equal(jevFailureReason(new Error("secret response body")), "request-or-apply-failed");
});
test("expression logs distinguish applied, stale, duplicate and failure without text", async () => {
  const events = []; let resolve, fail = false;
  const director = new JevExpressionDirector({ enabled: () => true, context: () => "private-id", apply: () => {},
    observe: (event, data) => events.push({ event, ...data }),
    classify: () => fail ? Promise.reject(new Error("SECRET")) : new Promise(r => { resolve = r; }),
  });
  director.request("PRIVATE"); director.request("PRIVATE");
  resolve({ emotion: "happy", reaction: "happy" }); await tick();
  director.request("SECOND"); director.cancel(); resolve({ emotion: "thinking" }); await tick();
  fail = true; director.request("THIRD"); await tick();
  assert.ok(events.some(e => e.event === "expression-applied" && e.emotion === "happy"));
  assert.ok(events.some(e => e.reason === "duplicate"));
  assert.ok(events.some(e => e.reason === "stale"));
  assert.ok(events.some(e => e.event === "expression-failed"));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|SECOND|THIRD|SECRET|private-id/);
});
