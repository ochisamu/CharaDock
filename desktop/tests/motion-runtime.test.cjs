// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");
const { createIdleGazeController, createReactionController } = require("../../motion-runtime.js");

test("emotion reactions add a short impulse and settle without a hard cut", () => {
  const controller = createReactionController();
  controller.trigger("happy", 1000, 1000);
  const impulse = controller.update(1120);
  assert.equal(impulse.kind, "happy");
  assert.equal(impulse.active, true);
  assert.ok(impulse.scale > 1);
  const fading = controller.update(2150);
  assert.ok(fading.weight > 0 && fading.weight < 1);
  assert.equal(controller.update(2700).active, false);
});

test("quiet idle gaze waits, turns gently, holds, and returns", () => {
  const controller = createIdleGazeController({ random: () => 0.5 });
  controller.reset(0);
  assert.equal(controller.update(9000).phase, "waiting");
  assert.equal(controller.update(9501).phase, "turning");
  const settled = controller.update(10502);
  assert.equal(settled.phase, "holding");
  assert.equal(settled.justSettled, true);
  assert.ok(settled.gaze > 0.5 && settled.gaze < 1);
});

test("character reaction intensity changes motion without changing its semantic kind", () => {
  const restrained = createReactionController();
  const expressive = createReactionController();
  restrained.trigger("happy", 1000, 1000, 0.7);
  expressive.trigger("happy", 1000, 1000, 1.15);
  const restrainedFrame = restrained.update(1120);
  const expressiveFrame = expressive.update(1120);
  assert.equal(restrainedFrame.kind, "happy");
  assert.equal(expressiveFrame.kind, "happy");
  assert.ok(expressiveFrame.scale > restrainedFrame.scale);
});
