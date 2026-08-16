// SPDX-License-Identifier: Apache-2.0
// Small, dependency-free motion controllers shared by the editor and desktop renderer.
(function motionRuntimeFactory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PuruPuruMotionRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const mix = (from, to, amount) => from + (to - from) * amount;
  const smoothstep = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  const REACTION_PRESETS = Object.freeze({
    neutral: Object.freeze({ durationMs: 650, fadeMs: 300 }),
    listening: Object.freeze({ durationMs: 950, fadeMs: 380, tilt: -0.008, idleAmplitude: 0.72, idleSpeed: 0.82 }),
    thinking: Object.freeze({ durationMs: 1300, fadeMs: 440, tilt: -0.018, offsetY: 0.006, idleAmplitude: 0.58, idleSpeed: 0.72 }),
    soft: Object.freeze({ durationMs: 1900, fadeMs: 520, offsetY: 0.008, scale: -0.012, idleAmplitude: 0.56, idleSpeed: 0.68 }),
    sad: Object.freeze({ durationMs: 2100, fadeMs: 560, offsetY: 0.012, tilt: 0.012, scale: -0.018, idleAmplitude: 0.42, idleSpeed: 0.6 }),
    happy: Object.freeze({ durationMs: 1900, fadeMs: 420, bounce: 0.018, scalePop: 0.035, tiltKick: -0.012, idleAmplitude: 0.9, idleSpeed: 1.08 }),
    surprised: Object.freeze({ durationMs: 1350, fadeMs: 360, bounce: 0.026, scalePop: 0.06, tiltKick: 0.018, idleAmplitude: 0.34, idleSpeed: 0.78 }),
    angry: Object.freeze({ durationMs: 1550, fadeMs: 390, shake: 0.006, tiltKick: -0.014, scalePop: 0.022, idleAmplitude: 0.72, idleSpeed: 1.12 }),
  });

  function normalizeReactionKind(value) {
    const key = String(value || "neutral").toLowerCase();
    return Object.prototype.hasOwnProperty.call(REACTION_PRESETS, key) ? key : "neutral";
  }

  function createReactionController() {
    let kind = "neutral";
    let preset = REACTION_PRESETS.neutral;
    let startedAt = 0;
    let endsAt = 0;
    let fading = false;
    let intensity = 1;

    function trigger(nextKind, nowMs = 0, durationMs = null, nextIntensity = 1) {
      kind = normalizeReactionKind(nextKind);
      preset = REACTION_PRESETS[kind];
      startedAt = Number(nowMs) || 0;
      const requestedDuration = Number(durationMs);
      const duration = durationMs !== null && durationMs !== undefined && Number.isFinite(requestedDuration)
        ? clamp(requestedDuration, 100, 10000)
        : preset.durationMs;
      endsAt = startedAt + duration;
      fading = false;
      intensity = clamp(Number(nextIntensity) || 1, 0.55, 1.2);
      return kind;
    }

    function clear(nowMs = 0) {
      if (!fading) {
        endsAt = Math.min(endsAt || Number(nowMs) || 0, Number(nowMs) || 0);
        fading = true;
      }
    }

    function update(nowMs = 0) {
      const now = Number(nowMs) || 0;
      if (now >= endsAt) fading = true;
      const attack = smoothstep((now - startedAt) / 150);
      const fade = fading ? 1 - smoothstep((now - endsAt) / Math.max(120, preset.fadeMs)) : 1;
      const weight = clamp(attack * fade, 0, 1);
      const motionWeight = weight * intensity;
      const impulseAge = Math.max(0, (now - startedAt) / 1000);
      const impulseDecay = Math.exp(-impulseAge * 5.4) * weight;
      const bounce = -(preset.bounce || 0) * Math.sin(Math.min(Math.PI, impulseAge * 8.4)) * impulseDecay;
      const scalePop = (preset.scalePop || 0) * Math.exp(-impulseAge * 6.2) * weight;
      const tiltKick = (preset.tiltKick || 0) * Math.sin(Math.min(Math.PI, impulseAge * 7.6)) * impulseDecay;
      const shake = (preset.shake || 0) * Math.sin(impulseAge * 62) * Math.exp(-impulseAge * 5.8) * weight;
      return {
        kind,
        active: weight > 0.001,
        weight,
        offsetY: (preset.offsetY || 0) * motionWeight + bounce * intensity,
        tilt: (preset.tilt || 0) * motionWeight + tiltKick * intensity,
        scale: 1 + (preset.scale || 0) * motionWeight + scalePop * intensity,
        shakeX: shake * intensity,
        idleAmplitudeScale: mix(1, preset.idleAmplitude ?? 1, motionWeight),
        idleSpeedScale: mix(1, preset.idleSpeed ?? 1, motionWeight),
      };
    }

    return { trigger, clear, update, get kind() { return kind; } };
  }

  function createIdleGazeController({ random = Math.random } = {}) {
    let phase = "waiting";
    let phaseStartedAt = 0;
    let phaseDuration = 0;
    let from = 0;
    let target = 0;
    let value = 0;
    const between = (min, max) => min + clamp(Number(random()) || 0, 0, 1) * (max - min);

    function planWait(nowMs, immediate = false) {
      phase = "waiting";
      phaseStartedAt = nowMs;
      phaseDuration = immediate ? between(700, 1400) : between(5000, 14000);
      from = value;
      target = value;
    }

    function planTurn(nowMs, speedScale) {
      const side = random() < 0.5 ? -1 : 1;
      const largeTurn = random() >= 0.3;
      from = value;
      target = side * between(largeTurn ? 0.56 : 0.18, largeTurn ? 0.92 : 0.34);
      phase = "turning";
      phaseStartedAt = nowMs;
      phaseDuration = between(720, 1280) / clamp(speedScale, 0.5, 1.5);
    }

    function reset(nowMs = 0, { immediate = false } = {}) {
      value = 0;
      planWait(Number(nowMs) || 0, immediate);
      return value;
    }

    function update(nowMs = 0, { enabled = true, amplitudeScale = 1, speedScale = 1 } = {}) {
      const now = Number(nowMs) || 0;
      if (!enabled) return { gaze: value, phase, justSettled: false };
      if (!phaseDuration) planWait(now, false);
      let justSettled = false;
      const elapsed = now - phaseStartedAt;
      if (elapsed >= phaseDuration) {
        if (phase === "waiting") {
          planTurn(now, speedScale);
        } else if (phase === "turning") {
          value = target;
          phase = "holding";
          phaseStartedAt = now;
          phaseDuration = between(650, 1800);
          justSettled = true;
        } else if (phase === "holding") {
          from = value;
          target = 0;
          phase = "returning";
          phaseStartedAt = now;
          phaseDuration = between(900, 1500) / clamp(speedScale, 0.5, 1.5);
        } else {
          value = 0;
          planWait(now, false);
          justSettled = true;
        }
      }
      if (phase === "turning" || phase === "returning") {
        const t = smoothstep((now - phaseStartedAt) / Math.max(1, phaseDuration));
        value = mix(from, target, t);
      }
      return { gaze: clamp(value * clamp(amplitudeScale, 0.25, 1.25), -1, 1), phase, justSettled };
    }

    reset(0);
    return { reset, update, get phase() { return phase; } };
  }

  return { REACTION_PRESETS, normalizeReactionKind, createReactionController, createIdleGazeController };
});
