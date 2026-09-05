// SPDX-License-Identifier: Apache-2.0
// Transport-independent, 16kHz PCM16 admission gate. No ASR or conversation
// side effects until Silero confirms speech. Each device owns its detector.
class DeviceSpeechGate {
  constructor({ createVad, onStart, onChunk, onEnd, onReject = async () => {},
    suppress = () => false, preRollSamples = 8000 }) {
    Object.assign(this, { createVad, onStart, onChunk, onEnd, onReject, suppress, preRollSamples });
    this.current = null;
  }

  cancel() {
    const session = this.current;
    this.current = null;
    if (session) {
      session.vad?.stop();
      session.buffers = [];
    }
  }

  async begin({ bypass = false, handsfree = false } = {}) {
    this.cancel();
    const session = this.current = { bypass, handsfree, accepted: bypass, buffers: [], buffered: 0, samples: 0, squared: 0, measured: 0 };
    session.rejected = !bypass && handsfree && this.suppress();
    if (session.rejected) return;
    try {
      if (bypass) return await this.onStart();
      const vad = await this.createVad();
      if (this.current !== session) { vad.stop(); return; }
      session.vad = vad;
    } catch (error) {
      if (this.current === session) this.cancel();
      throw error; // Fail closed if the model cannot initialize.
    }
  }

  async chunk(bytes) {
    const s = this.current;
    if (!s || s.rejected) return;
    if (s.bypass) return this.onChunk(bytes);
    if (!bytes.length || bytes.length % 2) { this.cancel(); throw new Error("Invalid device PCM16 audio"); }
    if (s.handsfree && !s.accepted && this.suppress()) {
      s.rejected = true;
      s.vad?.stop(); s.buffers = [];
      return;
    }
    s.samples += bytes.length / 2;
    if (s.samples > 16000 * 30) {
      if (!s.accepted) { s.rejected = true; s.vad?.stop(); s.buffers = []; return; }
      // Main's existing accepted-capture limit owns cleanup and user feedback.
      return this.onChunk(bytes);
    }
    if (s.accepted) return this.onChunk(bytes);
    try {
      // Test at the model window granularity even for large transport chunks.
      for (let offset = 0; offset < bytes.length; offset += 1024) {
        const block = Buffer.from(bytes.subarray(offset, offset + 1024));
        s.buffers.push(block); s.buffered += block.length / 2;
        while (s.buffered > this.preRollSamples && s.buffers.length > 1) {
          s.buffered -= s.buffers.shift().length / 2;
        }
        const samples = new Float32Array(block.length / 2);
        for (let i = 0; i < samples.length; i++) {
          const pcm = block.readInt16LE(i * 2);
          samples[i] = pcm / 32768;
          s.squared += pcm * pcm;
          s.measured++;
        }
        const result = s.vad.accept(samples);
        if (!result.detected && !result.segmentComplete) continue;
        s.accepted = true;
        s.vad.stop();
        await this.onStart();
        if (this.current !== s) return;
        const initial = Buffer.concat(s.buffers);
        s.buffers = [];
        await this.onChunk(initial);
        if (this.current !== s) return;
        if (offset + block.length < bytes.length) await this.onChunk(bytes.subarray(offset + block.length));
        return;
      }
    } catch (error) {
      if (this.current === s) this.cancel();
      throw error;
    }
  }

  async end() {
    const s = this.current;
    this.current = null; // Reply may be slow; it must not own the next candidate.
    if (!s) return;
    s.vad?.stop(); s.buffers = [];
    if (s.accepted) return this.onEnd();
    return this.onReject(s.rejected ? "suppressed" : "non-speech", {
      durationMs: Math.round(s.samples / 16), rms: s.measured ? Math.round(Math.sqrt(s.squared / s.measured)) : 0,
    });
  }
}

module.exports = { DeviceSpeechGate };
