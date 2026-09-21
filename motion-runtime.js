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

  // Opt-in Nike performance: semantic cues, locally animated. No API per frame.
  const PERFORMANCE_KINDS = ["none", "nod", "ponder", "celebrate", "recoil", "reassure", "explain"];
  function createPerformanceController() {
    let kind = "none", start = 0, last = null;
    let speech = 0, releaseAt = 2600, releasing = false;
    const value = { x: 0, y: 0, tilt: 0, scale: 0, head: 0, shoulder: 0, hand: 0 };
    const velocity = Object.fromEntries(Object.keys(value).map(key => [key, 0]));
    const poses = { ponder: 0, explain: 0, celebrate: 0 };
    return {
      reset() { kind = "none"; last = null; speech = 0; for (const key of Object.keys(value)) { value[key] = 0; velocity[key] = 0; } for (const key of Object.keys(poses)) poses[key] = 0; },
      trigger(next, now) { kind = PERFORMANCE_KINDS.includes(next) ? next : "none"; start = now; releaseAt = now + 2600; releasing = false; },
      update(now, reduced = false, { speakingLevel = 0, enabled = false } = {}) {
        const dt = last === null ? 0 : clamp((now - last) / 1000, 0, .05); last = now;
        // Critically damped springs retain velocity when a new cue interrupts.
        // Audio provides phrase emphasis; silence never invents mouth movement.
        speech += ((enabled && !reduced ? clamp(Number(speakingLevel) || 0, 0, 1) : 0) - speech) * (1 - Math.exp(-dt * 9));
        const t = Math.max(0, (now - start) / 1000);
        // Extend only a living gesture. Brief speech gaps retain the pose;
        // later audio must never resurrect an already released gesture.
        if (!releasing && now < releaseAt && enabled && speech > .025) releaseAt = Math.min(start + 6000, Math.max(releaseAt, now + 650));
        if (now >= releaseAt) releasing = true;
        const envelope = smoothstep(t / .22) * (1 - smoothstep((now - releaseAt) / 800));
        const stroke = (delay, duration) => Math.sin(Math.PI * clamp((t - delay) / duration, 0, 1)) ** 2;
        let x = 0, y = 0, tilt = 0, scale = 0;
        if (kind === "nod") y = .016 * stroke(.15, .55) + .009 * stroke(.85, .5);
        if (kind === "ponder") { x = -.025; tilt = -.075; y = .006; }
        if (kind === "celebrate") { y = -.035 * Math.abs(Math.sin(t * 5)) * Math.exp(-t * .5); tilt = .045 * Math.sin(t * 4); scale = .025; }
        if (kind === "recoil") { const surprise = stroke(.05, 1.1); x = .03 * surprise; y = .014 * surprise; scale = -.05 * surprise; tilt = .07 * surprise; }
        if (kind === "reassure") { x = -.018; y = .006; tilt = -.025; scale = .025 * smoothstep(t / .8); }
        if (kind === "explain") { const gesture = stroke(.2, 1.25) - .55 * stroke(1.8, 1.2); x = .022 * gesture; tilt = .03 * gesture; y = -.005 * gesture; }
        const weight = reduced || kind === "none" ? 0 : envelope;
        const anticipation = -Math.sin(Math.PI * clamp(t / .3, 0, 1)) * .012;
        const accent = speech * Math.sin(now * .006);
        const headGesture = kind === "nod" ? .045 * (stroke(.12, .55) - .4 * stroke(.75, .5))
          : kind === "ponder" ? -.025 * smoothstep(t / .8)
          : kind === "reassure" ? .025 * stroke(.35, 1.5)
          : .025 * Math.sin(t * 2.5 - .4) * Math.exp(-t * .7);
        const target = { x, y, tilt, scale,
          head: (headGesture + anticipation) * weight + accent * .018,
          shoulder: -.012 * stroke(.35, 1.4) * weight - accent * .007,
          hand: (.055 * stroke(.35, 1.2) - .025 * stroke(1.9, 1) + anticipation) * weight + accent * .022 };
        const blend = 1 - Math.exp(-dt * 12);
        for (const key of Object.keys(value)) {
          const goal = reduced ? 0 : target[key] * (["x", "y", "tilt", "scale"].includes(key) ? weight : 1);
          const omega = key === "shoulder" ? 10 : key === "head" ? 14 : 18;
          // Exact critically damped integration: stable across frame rates.
          const offset = value[key] - goal, c = velocity[key] + omega * offset;
          const decay = Math.exp(-omega * dt);
          value[key] = goal + (offset + c * dt) * decay;
          velocity[key] = (velocity[key] - omega * c * dt) * decay;
        }
        for (const pose of Object.keys(poses)) poses[pose] += ((pose === kind ? weight : 0) - poses[pose]) * blend;
        return { ...value, poses: { ...poses }, kind, active: Object.values(value).some(v => Math.abs(v) > .0001) };
      },
    };
  }
  // Normalized joints for the registered Nike prototype, never applied to other
  // characters. A rigid head region preserves eyes/mouth; smooth neck falloff
  // and local sleeve masks add follow-through without moving the whole cutout.
  function performanceWarpPoint(x, y, motion, pose = "", width = 1536, height = 1536) {
    const px = x / width, py = y / height;
    const rotate = (cx, cy, angle, weight) => {
      const a = angle * weight, dx = x - cx * width, dy = y - cy * height;
      x = cx * width + dx * Math.cos(a) - dy * Math.sin(a);
      y = cy * height + dx * Math.sin(a) + dy * Math.cos(a);
    };
    if (!pose) {
      rotate(.452, .60, motion.head || 0, 1 - smoothstep((py - .52) / .16));
      rotate(.48, .88, motion.shoulder || 0, smoothstep((py - .55) / .2));
    } else {
      const joints = pose === "celebrate" ? [[.25, .69], [.75, .73]] : pose === "explain" ? [[.61, .76]] : [];
      for (const [cx, cy] of joints) {
        const radius = Math.hypot((px - cx) / .16, (py - cy) / .18);
        rotate(cx, cy, (motion.hand || 0) * (cx < .5 ? -1 : 1), 1 - smoothstep(radius));
      }
    }
    return { x, y };
  }
  return { REACTION_PRESETS, normalizeReactionKind, createReactionController, createIdleGazeController, createPerformanceController, performanceWarpPoint, PERFORMANCE_KINDS };
});
