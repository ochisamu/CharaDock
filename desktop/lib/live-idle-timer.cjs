// SPDX-License-Identifier: Apache-2.0

class LiveIdleTimer {
  constructor({ timeoutMs = 5 * 60 * 1000, onTimeout, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be positive");
    if (typeof onTimeout !== "function") throw new TypeError("onTimeout is required");
    this.timeoutMs = timeoutMs;
    this.onTimeout = onTimeout;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.enabled = false;
    this.handle = null;
  }

  setEnabled(enabled, { arm = false } = {}) {
    this.enabled = enabled === true;
    this.cancel();
    if (this.enabled && arm) return this.touch();
    return false;
  }

  touch() {
    this.cancel();
    if (!this.enabled) return false;
    this.handle = this.setTimer(() => {
      this.handle = null;
      Promise.resolve(this.onTimeout()).catch(() => {});
    }, this.timeoutMs);
    return true;
  }

  cancel() {
    if (this.handle === null) return false;
    this.clearTimer(this.handle);
    this.handle = null;
    return true;
  }

  get active() {
    return this.handle !== null;
  }
}

module.exports = { LiveIdleTimer };
