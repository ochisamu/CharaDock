// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { LiveIdleTimer } = require("../lib/live-idle-timer.cjs");

function fakeClock() {
  const scheduled = new Map();
  let nextId = 1;
  return {
    scheduled,
    setTimer(callback, timeoutMs) {
      const id = nextId++;
      scheduled.set(id, { callback, timeoutMs });
      return id;
    },
    clearTimer(id) { scheduled.delete(id); },
    fire(id) {
      const entry = scheduled.get(id);
      scheduled.delete(id);
      entry?.callback();
    },
  };
}

test("Live idle timer stays inactive by default", () => {
  const clock = fakeClock();
  const timer = new LiveIdleTimer({ onTimeout() {}, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  assert.equal(timer.touch(), false);
  assert.equal(timer.active, false);
  assert.equal(clock.scheduled.size, 0);
});

test("Live idle timer rearms for five minutes after the latest conversation", async () => {
  const clock = fakeClock();
  let timeouts = 0;
  const timer = new LiveIdleTimer({
    onTimeout() { timeouts += 1; },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  timer.setEnabled(true);
  assert.equal(timer.touch(), true);
  const firstId = [...clock.scheduled.keys()][0];
  assert.equal(clock.scheduled.get(firstId).timeoutMs, 300_000);
  timer.touch();
  const secondId = [...clock.scheduled.keys()][0];
  assert.notEqual(secondId, firstId);
  assert.equal(clock.scheduled.has(firstId), false);
  clock.fire(secondId);
  await Promise.resolve();
  assert.equal(timeouts, 1);
  assert.equal(timer.active, false);
});

test("disabling Live idle auto-close cancels a pending close", () => {
  const clock = fakeClock();
  const timer = new LiveIdleTimer({ onTimeout() {}, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  timer.setEnabled(true, { arm: true });
  assert.equal(timer.active, true);
  timer.setEnabled(false);
  assert.equal(timer.active, false);
  assert.equal(clock.scheduled.size, 0);
});
