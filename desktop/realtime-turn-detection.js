// SPDX-License-Identifier: Apache-2.0
(function exposeRealtimeTurnDetection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CharaDockRealtimeTurnDetection = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  // Frameless Codex Live currently owns a fixed 500 ms Server VAD and rejects
  // client-side turn_detection updates. Preserve a short, low-level fragment
  // of the user's real voice after it falls silent so a breath or clause pause
  // does not become a separate turn. This processed track is sent only to Live
  // and is never played through the user's speakers.
  const LIVE_INPUT_HANGOVER_MS = 650;
  const SPEECH_RMS_MINIMUM = .006;
  const HELD_VOICE_TARGET_RMS = .012;

  function createHangoverProcessor({ sampleRate = 48_000, hangoverMs = LIVE_INPUT_HANGOVER_MS } = {}) {
    const maximumSilenceSamples = Math.max(1, Math.round(sampleRate * hangoverMs / 1000));
    const tailSamples = Math.max(80, Math.round(sampleRate * .02));
    let noiseFloor = .0015;
    let voiceTail = new Float32Array(0);
    let voiceTailRms = 0;
    let tailCursor = 0;
    let silentSamples = maximumSilenceSamples + 1;

    const rms = (samples, start = 0, end = samples.length) => {
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
      return Math.sqrt(sum / Math.max(1, end - start));
    };

    const rememberTail = (samples) => {
      const length = Math.min(tailSamples, samples.length);
      let bestStart = Math.max(0, samples.length - length);
      let bestRms = 0;
      for (let end = samples.length; end >= length; end -= Math.max(1, Math.floor(length / 2))) {
        const start = end - length;
        const candidateRms = rms(samples, start, end);
        if (candidateRms > bestRms) {
          bestRms = candidateRms;
          bestStart = start;
        }
      }
      voiceTail = samples.slice(bestStart, bestStart + length);
      voiceTailRms = Math.max(bestRms, rms(voiceTail));
      tailCursor = 0;
    };

    const process = (source) => {
      const input = source instanceof Float32Array ? source : new Float32Array(source || []);
      const output = input.slice();
      if (!input.length) return output;
      const level = rms(input);
      const speechThreshold = Math.max(SPEECH_RMS_MINIMUM, noiseFloor * 3.2);
      if (level >= speechThreshold) {
        rememberTail(input);
        silentSamples = 0;
        return output;
      }
      noiseFloor = noiseFloor * .985 + Math.min(level, SPEECH_RMS_MINIMUM) * .015;
      if (!voiceTail.length || silentSamples > maximumSilenceSamples) return output;
      const startSilentSamples = silentSamples;
      silentSamples += input.length;
      const baseScale = Math.min(1, HELD_VOICE_TARGET_RMS / Math.max(voiceTailRms, .0001));
      for (let index = 0; index < output.length; index += 1) {
        const elapsed = startSilentSamples + index;
        if (elapsed >= maximumSilenceSamples) break;
        const remainingRatio = (maximumSilenceSamples - elapsed) / maximumSilenceSamples;
        const envelope = .45 + .55 * Math.min(1, remainingRatio * 3);
        output[index] += voiceTail[tailCursor] * baseScale * envelope;
        tailCursor = (tailCursor + 1) % voiceTail.length;
      }
      return output;
    };

    return Object.freeze({ process });
  }

  async function createInputBridge(sourceStream, {
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  } = {}) {
    if (!sourceStream?.getAudioTracks?.().length || typeof AudioContextClass !== "function") {
      return { stream: sourceStream, close() {} };
    }
    let context;
    let source;
    let processor;
    let destination;
    let silentMonitor;
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
      if (typeof context.createScriptProcessor !== "function") throw new Error("Audio processing is unavailable.");
      source = context.createMediaStreamSource(sourceStream);
      processor = context.createScriptProcessor(1024, 1, 1);
      destination = context.createMediaStreamDestination();
      silentMonitor = context.createGain();
      silentMonitor.gain.value = 0;
      const hangover = createHangoverProcessor({ sampleRate: context.sampleRate });
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        event.outputBuffer.getChannelData(0).set(hangover.process(input));
      };
      source.connect(processor);
      processor.connect(destination);
      processor.connect(silentMonitor);
      silentMonitor.connect(context.destination);
      await context.resume();
    } catch {
      try { source?.disconnect(); } catch {}
      try { processor?.disconnect(); } catch {}
      try { silentMonitor?.disconnect(); } catch {}
      for (const track of destination?.stream?.getTracks?.() || []) track.stop();
      await context?.close?.().catch(() => {});
      return { stream: sourceStream, close() {} };
    }
    let closed = false;
    return {
      stream: destination.stream,
      close() {
        if (closed) return;
        closed = true;
        processor.onaudioprocess = null;
        try { source.disconnect(); } catch {}
        try { processor.disconnect(); } catch {}
        try { silentMonitor.disconnect(); } catch {}
        for (const track of destination.stream.getTracks()) track.stop();
        context.close().catch(() => {});
      },
    };
  }

  return Object.freeze({
    HELD_VOICE_TARGET_RMS,
    LIVE_INPUT_HANGOVER_MS,
    SPEECH_RMS_MINIMUM,
    createHangoverProcessor,
    createInputBridge,
  });
});
