// SPDX-License-Identifier: Apache-2.0
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CharaDockRemoteAuthoredAvatar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  function create({ canvas, shell, runtime, now = () => performance.now(),
    raf = fn => requestAnimationFrame(fn), cancel = id => cancelAnimationFrame(id),
    visible = () => !document.hidden, reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    onError = () => {} }) {
    let player = null, loading = null, identity = '', characterId = '', frame = null;
    let pending = null, output = null, settings = {}, mouthState = 0, audioLevel = 0, blinkClosed = false;
    const ctx = canvas.getContext('2d');
    const expose = active => { canvas.hidden = !active; shell.classList.toggle('is-authored', active); };
    function stop() { if (frame !== null) cancel(frame); frame = null; }
    function reset() {
      stop(); loading?.abort(); loading = null; player?.dispose(); player = null;
      pending = null; output = null; expose(false);
    }
    function draw() {
      frame = null;
      if (!player || !visible()) return;
      try {
        output = player.update(now(), { mouthState, mouthOpenness: mouthState, audioLevel, blinkClosed,
          reducedMotion: reduced(), idleEnabled: settings.idleMotionEnabled !== false,
          breathStrength: Number(settings.breathStrength ?? 58) / 100,
          rollStrength: Number(settings.rollStrength ?? 45) / 100,
          voiceMotion: Number(settings.pyokoStrength ?? 40) / 100,
          hairStrength: Number(settings.hairWarp ?? 38) / 38, hairSpring: Number(settings.hairSpring ?? 142) / 142 });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!player.render(ctx, { width: canvas.width, height: canvas.height })) throw new Error('Authored render unavailable');
        // Hide the old three-image avatar only after a complete frame exists.
        expose(true);
        frame = raf(draw);
      } catch (error) { reset(); onError(error); }
    }
    function resume() { if (visible() && player && frame === null) frame = raf(draw); else if (!visible()) stop(); }
    function expression(input = {}) {
      if (!identity || input.characterId && input.characterId !== characterId) return;
      if (!['emotion','reaction','nikePerformance'].some(key => Object.hasOwn(input, key))) return;
      const value = { input, receivedAt: now(), durationMs: Math.max(100, Math.min(10000, Number(input.durationMs) || 4500)) };
      if (!player) { if (loading) pending = value; return; }
      player.trigger(runtime.stateForInput(input), now(), value.durationMs);
    }
    async function sync(character) {
      const descriptor = character?.id === 'amber-avatar' ? character.authoredMotion : null;
      const next = descriptor?.manifestUrl === '/api/authored/manifest.json' ? `${character.id}:${descriptor.version}` : '';
      settings = character?.motion || {};
      if (next === identity) return;
      reset(); identity = next; characterId = character?.id || '';
      mouthState = 0; audioLevel = 0; blinkClosed = false;
      if (!next || !ctx || !runtime) return;
      const request = new AbortController(); loading = request;
      try {
        const loaded = await runtime.createPlayer({ manifestUrl: descriptor.manifestUrl, signal: request.signal });
        if (request.signal.aborted || loading !== request) { loaded.dispose(); return; }
        player = loaded; loading = null;
        if (pending) {
          const remaining = pending.durationMs - (now() - pending.receivedAt);
          if (remaining > 0) player.trigger(runtime.stateForInput(pending.input), now(), remaining);
          pending = null;
        }
        resume();
      } catch (error) {
        if (request.signal.aborted || loading !== request) return;
        reset(); onError(error);
      }
    }
    return { sync, expression, visibility: resume,
      audio(mouth, level) { mouthState = ({closed:0,half:1,open:2})[mouth] ?? 0; audioLevel = Math.max(0, Math.min(1, Number(level) || 0)); },
      blink(closed) { blinkClosed = Boolean(closed); },
      dispose() { reset(); identity = ''; characterId = ''; mouthState = audioLevel = 0; blinkClosed = false; },
      status: () => ({ ready: Boolean(player), loading: Boolean(loading), identity, output }) };
  }
  return { create };
});
