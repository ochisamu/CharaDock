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
  function create({ context, next, cancel, isCurrent = () => true, onStart = () => {}, onLevel = () => {}, scheduleFrame = cb => requestAnimationFrame(cb), cancelFrame = id => cancelAnimationFrame(id) }) {
    let stopped = false, frame = 0, end = 0, caption = "", pullingDone = false, finish;
    const sources = new Set(), timers = new Set();
    const analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.connect(context.destination);
    const data = new Float32Array(analyser.fftSize);
    const cancelled = new Promise(resolve => { finish = resolve; });
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
      cancelFrame(frame); for (const timer of timers) clearTimeout(timer); timers.clear();
      for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
      sources.clear(); analyser.disconnect(); onLevel(0); finish();
      Promise.resolve(cancel?.()).catch(() => {});
    }
    function enqueue(chunk) {
      if (stopped || !isCurrent()) return;
      if (chunk.sampleRate !== 48000) throw new Error("Unsupported PCM sample rate");
      const samples = decodePcm(chunk.pcmChunk);
      const buffer = context.createBuffer(1,samples.length,chunk.sampleRate); buffer.copyToChannel(samples,0);
      const source = context.createBufferSource(); source.buffer = buffer;
      const rate = Math.min(2,Math.max(.5,Number(chunk.playbackRate)||1)); source.playbackRate.value = rate; source.connect(analyser);
      const start = Math.max(end,context.currentTime + .025); end = start + samples.length/chunk.sampleRate/rate;
      sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); if (pullingDone && !sources.size) finish(); };
      if (caption !== chunk.audioText) {
        caption = chunk.audioText || ""; const text = caption;
        const timer = setTimeout(() => { timers.delete(timer); if (!stopped && isCurrent()) onStart(text); },Math.max(0,(start-context.currentTime)*1000)); timers.add(timer);
      }
      source.start(start);
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
          const pause = Math.max(0,(end-context.currentTime-1.5)*1000);
          if (pause) {
            let timer;
            await Promise.race([cancelled,new Promise(resolve => { timer = setTimeout(() => { timers.delete(timer); resolve(); },pause); timers.add(timer); })]);
          }
          if (stopped || !isCurrent()) break;
          chunk = await Promise.race([next(first.streamId),cancelled.then(() => ({done:true}))]);
        }
        pullingDone = true;
        if (sources.size && !stopped && isCurrent()) await cancelled;
      } finally { stop(); }
    }
    return { play, stop };
  }
  return { create, decodePcm };
});
