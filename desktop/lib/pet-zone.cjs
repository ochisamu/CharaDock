// SPDX-License-Identifier: Apache-2.0

const DEFAULT_TOUCH_HEAD_RATIO = 0.66;

function normalizeTouchHeadRatio(value, fallback = DEFAULT_TOUCH_HEAD_RATIO) {
  const parsed = Number(value);
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : DEFAULT_TOUCH_HEAD_RATIO;
  return Math.max(0.55, Math.min(0.78, Number.isFinite(parsed) ? parsed : normalizedFallback));
}

function normalizeTouchYRatio(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function resolvePetTouchZone(payload = {}, touchHeadRatio = DEFAULT_TOUCH_HEAD_RATIO) {
  const yRatio = normalizeTouchYRatio(payload?.yRatio);
  if (yRatio !== null) return yRatio <= normalizeTouchHeadRatio(touchHeadRatio) ? "head" : "body";
  return payload?.zone === "head" ? "head" : "body";
}

module.exports = {
  DEFAULT_TOUCH_HEAD_RATIO,
  normalizeTouchHeadRatio,
  normalizeTouchYRatio,
  resolvePetTouchZone,
};
