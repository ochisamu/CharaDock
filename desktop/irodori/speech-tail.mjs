// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NOGUCHI Shoji
// Conservative cleanup for a single clause: remove resumed speech after silence.
export function findTrailingUtteranceCutoff(audio, sampleRate, {
  windowMs = 40,
  minInitialSpeechMs = 200,
  minSilenceMs = 480,
  resumeLookaheadMs = 800,
  minResumedSpeechMs = 160,
  tailPaddingMs = 80,
} = {}) {
  if (!(audio instanceof Float32Array) || !(sampleRate > 0) || audio.length < 1) return audio?.length ?? 0;
  const windowSamples = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const windows = Math.ceil(audio.length / windowSamples);
  const levels = new Float32Array(windows);
  let peakDb = -120;
  for (let window = 0; window < windows; window++) {
    const start = window * windowSamples;
    const end = Math.min(audio.length, start + windowSamples);
    let sumSquares = 0;
    for (let i = start; i < end; i++) sumSquares += audio[i] * audio[i];
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    const db = 20 * Math.log10(Math.max(1e-8, rms));
    levels[window] = db;
    peakDb = Math.max(peakDb, db);
  }
  if (peakDb < -45) return audio.length;

  const speechThreshold = Math.max(-38, peakDb - 28);
  const silenceThreshold = Math.max(-55, peakDb - 38);
  const initialSpeechWindows = Math.max(1, Math.ceil(minInitialSpeechMs / windowMs));
  const silenceWindows = Math.max(1, Math.ceil(minSilenceMs / windowMs));
  const lookaheadWindows = Math.max(1, Math.ceil(resumeLookaheadMs / windowMs));
  const resumedSpeechWindows = Math.max(1, Math.ceil(minResumedSpeechMs / windowMs));
  let speechSeen = 0;

  for (let window = 0; window < windows; window++) {
    if (levels[window] >= speechThreshold) speechSeen += 1;
    if (speechSeen < initialSpeechWindows || levels[window] > silenceThreshold) continue;

    let silenceEnd = window;
    while (silenceEnd < windows && levels[silenceEnd] <= silenceThreshold) silenceEnd += 1;
    if (silenceEnd - window < silenceWindows) {
      window = silenceEnd;
      continue;
    }

    const lookaheadEnd = Math.min(windows, silenceEnd + lookaheadWindows);
    let resumedSpeech = 0;
    let longestResumedSpeech = 0;
    for (let next = silenceEnd; next < lookaheadEnd; next++) {
      if (levels[next] >= speechThreshold) {
        resumedSpeech += 1;
        longestResumedSpeech = Math.max(longestResumedSpeech, resumedSpeech);
      } else {
        resumedSpeech = 0;
      }
    }
    if (longestResumedSpeech >= resumedSpeechWindows) {
      const cutoff = window * windowSamples + Math.round(sampleRate * tailPaddingMs / 1000);
      return Math.max(1, Math.min(audio.length, cutoff));
    }
    window = silenceEnd;
  }
  return audio.length;
}


// Hold only a candidate silent gap / resumption, never ordinary speech. Native
// chunks can straddle the gap, so examining each chunk separately is insufficient.
export class StreamingSpeechTailGate {
  constructor(sampleRate, { windowMs = 40, minInitialSpeechMs = 200,
    minSilenceMs = 480, resumeLookaheadMs = 800, minResumedSpeechMs = 160,
    tailPaddingMs = 80, cleanEndpoint = false, removeResumedSpeech = true,
    endpointQuietMs = 320, endpointNoiseMs = 80 } = {}) {
    this.windowSamples = Math.max(1, Math.round(sampleRate * windowMs / 1000));
    this.initialWindows = Math.max(1, Math.ceil(minInitialSpeechMs / windowMs));
    this.silenceWindows = Math.max(1, Math.ceil(minSilenceMs / windowMs));
    this.lookaheadWindows = Math.max(1, Math.ceil(resumeLookaheadMs / windowMs));
    this.resumeWindows = Math.max(1, Math.ceil(minResumedSpeechMs / windowMs));
    this.cleanEndpoint = cleanEndpoint; this.removeResumedSpeech = removeResumedSpeech;
    this.endpointQuietWindows = Math.max(1, Math.ceil(endpointQuietMs / windowMs));
    this.endpointNoiseWindows = Math.max(1, Math.ceil(endpointNoiseMs / windowMs));
    this.endFadeSamples = Math.max(2, Math.round(sampleRate * .005));
    this.held = new Float32Array();
    this.paddingSamples = Math.round(sampleRate * tailPaddingMs / 1000);
    this.fadeSamples = Math.round(sampleRate * .03);
    this.partial = new Float32Array(); this.pending = null;
    this.peakDb = -120; this.speechSeen = 0; this.processedSamples = 0;
    this.cutoffSamples = null;
  }
  push(audio) {
    if (!(audio instanceof Float32Array)) throw new TypeError("PCM must be Float32Array");
    if (this.cutoffSamples !== null) return [];
    const joined = new Float32Array(this.partial.length + audio.length);
    joined.set(this.partial); joined.set(audio, this.partial.length);
    const output = [];
    let offset = 0;
    for (; offset + this.windowSamples <= joined.length; offset += this.windowSamples) {
      this.window(joined.slice(offset, offset + this.windowSamples), output);
      if (this.cutoffSamples !== null) break;
    }
    this.partial = this.cutoffSamples === null ? joined.slice(offset) : new Float32Array();
    return this.deliver(output);
  }
  finish() {
    if (this.cutoffSamples !== null) return this.deliver([], true);
    const output = [];
    if (this.partial.length) this.window(this.partial, output);
    this.partial = new Float32Array();
    const p = this.pending;
    if (p && this.cutoffSamples === null) {
      // Only EOF establishes that a <=80 ms resumption is a terminal burst.
      // A longer resumed phrase is preserved, including clause pauses.
      if (this.cleanEndpoint && p.silence >= this.endpointQuietWindows && p.lookahead <= this.endpointNoiseWindows) this.cutPending(output);
      else output.push(...p.frames);
    }
    this.pending = null;
    return this.deliver(output, true);
  }
  deliver(frames, final = false) {
    if (!this.cleanEndpoint) return frames;
    // Keep one 40 ms frame so the last sample can be faded even when the worker's
    // final chunk and end notification arrive in separate stdout messages.
    const length = this.held.length + frames.reduce((sum, frame) => sum + frame.length, 0);
    const joined = new Float32Array(length); let offset = this.held.length;
    joined.set(this.held);
    for (const frame of frames) { joined.set(frame, offset); offset += frame.length; }
    if (final) {
      this.held = new Float32Array();
      const count = Math.min(joined.length, this.endFadeSamples);
      for (let i = 0; i < count; i++) joined[joined.length - count + i] *= count === 1 ? 0 : 1 - i / (count - 1);
      return joined.length ? [joined] : [];
    }
    const split = Math.max(0, joined.length - this.windowSamples);
    this.held = joined.slice(split);
    return split ? [joined.subarray(0, split)] : [];
  }
  cutPending(output) {
    const p = this.pending, kept = new Float32Array(this.paddingSamples);
    let offset = 0;
    for (const part of p.frames) {
      const count = Math.min(part.length, kept.length - offset);
      kept.set(part.subarray(0, count), offset); offset += count;
      if (offset === kept.length) break;
    }
    const count = Math.min(kept.length, this.fadeSamples);
    for (let i = 0; i < count; i++) kept[kept.length - count + i] *= count === 1 ? 0 : 1 - i / (count - 1);
    if (kept.length) output.push(kept);
    this.cutoffSamples = p.start + kept.length; this.pending = null;
  }
  window(frame, output) {
    const start = this.processedSamples; this.processedSamples += frame.length;
    let energy = 0; for (const sample of frame) energy += sample * sample;
    const db = 20 * Math.log10(Math.max(1e-8, Math.sqrt(energy / frame.length)));
    this.peakDb = Math.max(this.peakDb, db);
    const speechThreshold = Math.max(-38, this.peakDb - 28);
    const silenceThreshold = Math.max(-55, this.peakDb - 38);
    if (db >= speechThreshold && this.peakDb >= -45) this.speechSeen++;
    if (!this.pending) {
      if (this.speechSeen >= this.initialWindows && db <= silenceThreshold) {
        this.pending = { start, frames: [frame], silence: 1, lookahead: 0, resumed: 0 };
      } else output.push(frame);
      return;
    }
    const p = this.pending; p.frames.push(frame);
    if (p.lookahead === 0 && db <= silenceThreshold) { p.silence++; return; }
    p.lookahead++;
    p.resumed = db >= speechThreshold ? p.resumed + 1 : 0;
    if (p.silence < this.silenceWindows || !this.removeResumedSpeech) {
      // Hold a short EOF candidate, but release ordinary speech without changing
      // sentence-internal pauses or treating a comma's next clause as a tail.
      if (!(this.cleanEndpoint && p.silence >= this.endpointQuietWindows && p.lookahead <= this.endpointNoiseWindows)) {
        output.push(...p.frames); this.pending = null;
      }
      return;
    }
    if (p.resumed >= this.resumeWindows) {
      this.cutPending(output);
    } else if (p.lookahead >= this.lookaheadWindows) {
      // Uncertain resumption / isolated noises must not truncate real speech.
      output.push(...p.frames); this.pending = null;
    }
  }
}
