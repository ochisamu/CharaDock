// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeTouchHeadRatio,
  normalizeTouchYRatio,
  resolvePetTouchZone,
} = require("../lib/pet-zone.cjs");

test("pet touch uses the character neck boundary instead of the window midpoint", () => {
  assert.equal(resolvePetTouchZone({ yRatio: 0.6 }, 0.67), "head");
  assert.equal(resolvePetTouchZone({ yRatio: 0.7 }, 0.67), "body");
  assert.equal(resolvePetTouchZone({ yRatio: 0.67 }, 0.67), "head");
});

test("pet touch keeps explicit-zone compatibility when coordinates are unavailable", () => {
  assert.equal(resolvePetTouchZone({ zone: "head" }, 0.67), "head");
  assert.equal(resolvePetTouchZone({ zone: "body" }, 0.67), "body");
  assert.equal(resolvePetTouchZone({}, 0.67), "body");
});

test("pet touch ratios are finite and bounded", () => {
  assert.equal(normalizeTouchHeadRatio(undefined), 0.66);
  assert.equal(normalizeTouchHeadRatio(0.1), 0.55);
  assert.equal(normalizeTouchHeadRatio(0.99), 0.78);
  assert.equal(normalizeTouchYRatio(-2), 0);
  assert.equal(normalizeTouchYRatio(3), 1);
  assert.equal(normalizeTouchYRatio("not-a-number"), null);
});
