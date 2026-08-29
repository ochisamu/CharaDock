// SPDX-License-Identifier: Apache-2.0
(function exposeAtomEchoLiveAudio(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CharaDockAtomEchoLiveAudio = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const DEFAULT_END_HOLD_MS = 720;

  function rms(samples) {
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return samples.length ? Math.sqrt(sum / samples.length) : 0;
  }

  class LiveOutputGate {
    constructor({
      threshold = .004,
      preRollMs = 80,
      // Keep natural Japanese clause pauses inside one physical I2S playback
      // session. Reopening the ATOM speaker on every short pause can clip the
      // next syllable and produces unnecessary amplifier/driver transitions.
      endHoldMs = DEFAULT_END_HOLD_MS,
      onStart = () => {},
      onChunk = () => {},
      onEnd = () => {},
    } = {}) {
      this.threshold = threshold;
      this.preRollMs = preRollMs;
      this.endHoldMs = endHoldMs;
      this.onStart = onStart;
      this.onChunk = onChunk;
      this.onEnd = onEnd;
      this.active = false;
      this.suppressed = false;
      this.silenceMs = 0;
      this.preRoll = [];
      this.preRollDurationMs = 0;
    }

    setSuppressed(value) {
      this.suppressed = Boolean(value);
      if (this.suppressed) this.reset(true);
    }

    push(value, sampleRate = 48_000) {
      const samples = value instanceof Float32Array ? value : Float32Array.from(value || []);
      if (!samples.length || this.suppressed) return false;
      const durationMs = samples.length * 1000 / sampleRate;
      const voiced = rms(samples) >= this.threshold;
      if (!this.active) {
        this.preRoll.push({ samples: new Float32Array(samples), sampleRate, durationMs });
        this.preRollDurationMs += durationMs;
        while (this.preRoll.length > 1 && this.preRollDurationMs > this.preRollMs) {
          this.preRollDurationMs -= this.preRoll.shift().durationMs;
        }
        if (!voiced) return false;
        this.active = true;
        this.silenceMs = 0;
        this.onStart();
        for (const frame of this.preRoll) this.onChunk(frame.samples, frame.sampleRate);
        this.preRoll = [];
        this.preRollDurationMs = 0;
        return true;
      }
      this.onChunk(samples, sampleRate);
      this.silenceMs = voiced ? 0 : this.silenceMs + durationMs;
      if (this.silenceMs >= this.endHoldMs) this.reset(true);
      return true;
    }

    reset(notify = false) {
      const wasActive = this.active;
      this.active = false;
      this.silenceMs = 0;
      this.preRoll = [];
      this.preRollDurationMs = 0;
      if (notify && wasActive) this.onEnd();
    }
  }

  return { DEFAULT_END_HOLD_MS, LiveOutputGate, rms };
});
