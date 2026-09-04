// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { createRealtimeUnsolicitedGuard } = require("../lib/realtime-unsolicited-guard.cjs");

test("authorized assistant output keeps the Live session open", () => {
  let scheduled = 0;
  const guard = createRealtimeUnsolicitedGuard({
    terminate: () => {},
    schedule: () => { scheduled += 1; },
  });

  assert.equal(guard.observe({ authorized: true }), false);
  assert.equal(guard.terminating, false);
  assert.equal(scheduled, 0);
});

test("the first unsolicited assistant event closes Live exactly once", async () => {
  const scheduled = [];
  const terminated = [];
  const guard = createRealtimeUnsolicitedGuard({
    terminate: (detail) => { terminated.push(detail); },
    schedule: (callback) => { scheduled.push(callback); },
  });

  assert.equal(guard.observe({ authorized: false, method: "thread/realtime/transcript/delta" }), true);
  assert.equal(guard.observe({ authorized: false, method: "thread/realtime/transcript/done" }), false);
  assert.equal(guard.terminating, true);
  assert.equal(scheduled.length, 1);

  scheduled[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(terminated, [{ method: "thread/realtime/transcript/delta" }]);
});

test("a failed safety close is reported without an unhandled rejection", async () => {
  const errors = [];
  const guard = createRealtimeUnsolicitedGuard({
    terminate: async () => { throw new Error("stop failed"); },
    onError: (error) => { errors.push(error.message); },
  });

  guard.observe({ authorized: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ["stop failed"]);
});
