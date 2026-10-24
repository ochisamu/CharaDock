// SPDX-License-Identifier: Apache-2.0
(function(root,factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CharaDockPcmSpeech = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function decodePcm(pcm) {
    const raw = atob(pcm);
    if (!raw.length || raw.length % 2) throw new Error("Invalid PCM audio");
    const samples = new Float32Array(raw.length / 2);
    for (let i = 0; i < samples.length; i++) {
      let value = raw.charCodeAt(i*2) | raw.charCodeAt(i*2+1) << 8;
      if (value >= 32768) value -= 65536;
      samples[i] = value / 32768;
    }
    return samples;
  }
  function encodePcm(samples) {
    const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) throw Error('Invalid PCM sample');
      view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), true);
    }
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function createUploadQueue({ send, onError, maxSamples = 48000, maxQueuedSamples = 144000 }) {
    let frames = [], samples = 0, busy = false, closed = false;
    async function pump() {
      if (busy || closed) return;
      busy = true;
      try {
        while (!closed && samples) {
          const batch = new Float32Array(Math.min(samples, maxSamples));
          let offset = 0;
          while (offset < batch.length) {
            const frame = frames[0], count = Math.min(frame.length, batch.length - offset);
            batch.set(frame.subarray(0, count), offset); offset += count; samples -= count;
            if (count === frame.length) frames.shift(); else frames[0] = frame.subarray(count);
          }
          await send(batch);
        }
      } catch (error) { if (!closed) { stop(); onError(error); } }
      finally { busy = false; }
    }
    function stop() { closed = true; frames = []; samples = 0; }
    function push(frame) {
      if (closed || !frame.length) return;
      if (samples + frame.length > maxQueuedSamples) { stop(); onError(Error('Audio upload backlog')); return; }
      frames.push(frame); samples += frame.length; void pump();
    }
    return { push, stop };
  }
  function createQueue({ context, destination = context.destination, bufferMs = 250, adaptive = true, maxBufferSeconds = 4, onSchedule = () => {}, onIdle = () => {} }) {
    let end = 0, pending = [], pendingSeconds = 0, timer = 0, stopped = false, started = false;
    let target = Math.max(0, Math.min(1000, bufferMs)) / 1000;
    const sources = new Set();
    function flush() {
      clearTimeout(timer); timer = 0;
      if (stopped || !pending.length) return;
      const frames = pending; pending = []; pendingSeconds = 0;
      const now = context.currentTime;
      end = Math.max(end, now + .025);
      started = true;
      for (const item of frames) {
        const audio = context.createBuffer(1, item.samples.length, item.sampleRate);
        audio.copyToChannel(item.samples, 0);
        const source = context.createBufferSource(); source.buffer = audio;
        source.playbackRate.value = item.rate; source.connect(destination);
        const start = end, duration = item.samples.length / item.sampleRate / item.rate;
        end += duration; sources.add(source);
        source.onended = () => { sources.delete(source); source.disconnect(); if (!sources.size && !pending.length) onIdle(); };
        source.start(start); onSchedule({ ...item, source, start, duration });
      }
    }
    function push(samples, { sampleRate = 48000, rate = 1, ...metadata } = {}) {
      if (stopped || !samples.length) return;
      if (started && !pending.length && end <= context.currentTime) {
        if (adaptive) target = Math.min(1, target + .1);
        started = false;
      }
      const duration = samples.length / sampleRate / rate;
      if (Math.max(0, end - context.currentTime) + pendingSeconds + duration > maxBufferSeconds) throw Error('Audio playback backlog');
      pending.push({ samples, sampleRate, rate, ...metadata }); pendingSeconds += duration;
      if (started || pendingSeconds >= target) flush();
      else if (!timer) timer = setTimeout(flush, Math.max(25, target * 1000));
    }
    function stop() {
      stopped = true; clearTimeout(timer); timer = 0; pending = []; pendingSeconds = 0;
      for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
      sources.clear();
    }
    return { push, flush, stop, get end() { return end; }, get size() { return sources.size + pending.length; }, get targetMs() { return target * 1000; } };
  }
  async function playChunks({ first, next, play, signal, isCurrent = () => true }) {
    let chunk = first, played = false;
    const streamId = first.streamId;
    let abort;
    const cancelled = new Promise(resolve => { abort = () => resolve({ cancelled: true }); });
    signal?.addEventListener('abort', abort, { once: true });
    try { while (isCurrent() && !signal?.aborted) {
      if (chunk?.error) throw Error(chunk.error);
      // Start the next transfer while the current phrase is still audible.
      // Handle rejection immediately so cancellation never leaves a rejection.
      const ahead = streamId && !chunk.done ? Promise.resolve().then(() => next(streamId)).then(value => ({ value }), error => ({ error })) : null;
      played = await play(chunk) || played;
      if (!isCurrent() || signal?.aborted || !ahead) break;
      const result = await Promise.race([ahead, cancelled]);
      if (!isCurrent() || signal?.aborted || result.cancelled) break;
      if (result.error) throw result.error;
      chunk = result.value;
    } } finally { signal?.removeEventListener('abort', abort); }
    return played;
  }
  function create({ context, next, cancel, bufferMs = 0, isCurrent = () => true, onStart = () => {}, onLevel = () => {}, scheduleFrame = cb => requestAnimationFrame(cb), cancelFrame = id => cancelAnimationFrame(id) }) {
    let stopped = false, frame = 0, caption = "", pullingDone = false, finish;
    const timers = new Set();
    const analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.connect(context.destination);
    const data = new Float32Array(analyser.fftSize);
    const cancelled = new Promise(resolve => { finish = resolve; });
    const queue = createQueue({ context, destination: analyser, bufferMs, adaptive: bufferMs > 0, maxBufferSeconds: Infinity,
      onIdle: () => { if (pullingDone) finish(); },
      onSchedule: ({ caption: text, start }) => {
        if (caption === text) return;
        caption = text;
        const timer = setTimeout(() => { timers.delete(timer); if (!stopped && isCurrent()) onStart(text); }, Math.max(0, (start-context.currentTime)*1000)); timers.add(timer);
      },
    });
    function level() {
      if (stopped) return;
      if (!isCurrent()) { stop(); return; }
      analyser.getFloatTimeDomainData(data);
      let energy = 0; for (const v of data) energy += v*v;
      onLevel(Math.min(1,Math.sqrt(energy/data.length)*8));
      frame = scheduleFrame(level);
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      queue.stop();
      cancelFrame(frame); for (const timer of timers) clearTimeout(timer); timers.clear();
      analyser.disconnect(); onLevel(0); finish();
      Promise.resolve(cancel?.()).catch(() => {});
    }
    function enqueue(chunk) {
      if (stopped || !isCurrent()) return;
      if (chunk.sampleRate !== 48000) throw new Error("Unsupported PCM sample rate");
      const samples = decodePcm(chunk.pcmChunk);
      queue.push(samples, { sampleRate: chunk.sampleRate, rate: Math.min(2,Math.max(.5,Number(chunk.playbackRate)||1)), caption: chunk.audioText || '' });
    }
    async function play(first) {
      try {
        await context.resume();
        if (stopped || !isCurrent()) { stop(); return; }
        if (context.state !== "running") throw new Error("Audio output is waiting for a user gesture.");
        level(); let chunk = first;
        while (!stopped && isCurrent()) {
          if (chunk?.error) throw new Error(chunk.error);
          if (chunk?.pcmChunk) enqueue(chunk);
          if (chunk?.done || !first.streamId) break;
          // Fetch concurrently with playback, keeping at most two seconds scheduled.
          const pause = Math.max(0,(queue.end-context.currentTime-1.5)*1000);
          if (pause) {
            let timer;
            await Promise.race([cancelled,new Promise(resolve => { timer = setTimeout(() => { timers.delete(timer); resolve(); },pause); timers.add(timer); })]);
          }
          if (stopped || !isCurrent()) break;
          chunk = await Promise.race([next(first.streamId),cancelled.then(() => ({done:true}))]);
        }
        pullingDone = true;
        queue.flush();
        if (queue.size && !stopped && isCurrent()) await cancelled;
      } finally { stop(); }
    }
    return { play, stop };
  }
  return { create, decodePcm, encodePcm, createQueue, createUploadQueue, playChunks };
});
