// SPDX-License-Identifier: Apache-2.0
const { AtomEchoPcmProcessor, resamplePcm16 } = require("./device-audio.cjs");

const DEFAULT_CHUNK_BYTES = 1024;
const DEFAULT_MAX_PENDING_BYTES = 16_000 * 2 * 3;

class AtomEchoLiveAudioRoute {
  constructor({
    gateway,
    sampleRate = 16_000,
    chunkBytes = DEFAULT_CHUNK_BYTES,
    maxPendingBytes = DEFAULT_MAX_PENDING_BYTES,
    processorOptions = {},
    onError = () => {},
  } = {}) {
    if (!gateway) throw new Error("ATOM Echo audio gateway is required.");
    this.gateway = gateway;
    this.sampleRate = sampleRate;
    this.chunkBytes = chunkBytes;
    this.maxPendingBytes = maxPendingBytes;
    this.processorOptions = processorOptions;
    this.onError = onError;
    this.generation = 0;
    this.session = null;
    this.remainder = Buffer.alloc(0);
    this.pendingBytes = 0;
    this.queue = Promise.resolve();
    this.processor = null;
    this.failure = null;
  }

  active() {
    return Boolean(this.session || this.remainder.length || this.pendingBytes);
  }

  enqueue(generation, bytes, operation) {
    this.pendingBytes += bytes;
    this.queue = this.queue.then(async () => {
      try {
        if (generation !== this.generation) return;
        await operation();
      } catch (error) {
        if (generation === this.generation) {
          this.failure = error;
          this.generation += 1;
          this.session = null;
          this.remainder = Buffer.alloc(0);
          this.processor = null;
          this.onError(error);
        }
      } finally {
        this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
      }
    });
  }

  start() {
    const generation = ++this.generation;
    this.session = null;
    this.remainder = Buffer.alloc(0);
    const processorOptions = typeof this.processorOptions === "function"
      ? this.processorOptions()
      : this.processorOptions;
    this.processor = new AtomEchoPcmProcessor({ sampleRate: this.sampleRate, ...(processorOptions || {}) });
    this.failure = null;
    this.enqueue(generation, 0, async () => {
      await this.gateway.stopPlayback().catch(() => {});
      if (generation !== this.generation) return;
      this.session = await this.gateway.beginPcm16Playback(this.sampleRate);
    });
    return generation;
  }

  push(samples, sourceRate = 48_000) {
    const generation = this.generation;
    if (!generation) return false;
    const resampled = resamplePcm16(samples, sourceRate, this.sampleRate);
    const pcm = this.processor?.push(resampled) || Buffer.alloc(0);
    if (!pcm.length) return true;
    if (this.pendingBytes + this.remainder.length + pcm.length > this.maxPendingBytes) {
      const error = new Error("ATOM EchoのLive音声転送が追いつきませんでした。");
      this.failure = error;
      this.onError(error);
      this.interrupt();
      return false;
    }
    let combined = this.remainder.length ? Buffer.concat([this.remainder, pcm]) : pcm;
    while (combined.length >= this.chunkBytes) {
      const chunk = Buffer.from(combined.subarray(0, this.chunkBytes));
      combined = combined.subarray(this.chunkBytes);
      this.enqueue(generation, chunk.length, async () => {
        if (!this.session) return;
        const result = await this.gateway.writePcm16PlaybackChunk(chunk, this.session);
        if (result?.interrupted) this.generation += 1;
      });
    }
    this.remainder = Buffer.from(combined);
    return true;
  }

  end() {
    const generation = this.generation;
    if (!generation) return Promise.resolve();
    const processedTail = this.processor?.finish() || Buffer.alloc(0);
    this.processor = null;
    let tail = this.remainder.length ? Buffer.concat([this.remainder, processedTail]) : processedTail;
    this.remainder = Buffer.alloc(0);
    while (tail.length) {
      const chunk = Buffer.from(tail.subarray(0, this.chunkBytes));
      tail = tail.subarray(chunk.length);
      this.enqueue(generation, chunk.length, async () => {
        if (!this.session) return;
        await this.gateway.writePcm16PlaybackChunk(chunk, this.session);
      });
    }
    this.enqueue(generation, 0, async () => {
      if (!this.session) return;
      const session = this.session;
      this.session = null;
      await this.gateway.endPcm16Playback(session);
    });
    return this.queue.then(() => {
      if (this.failure) throw this.failure;
      return { interrupted: generation !== this.generation };
    });
  }

  interrupt() {
    this.generation += 1;
    this.session = null;
    this.remainder = Buffer.alloc(0);
    this.processor = null;
    this.queue = this.queue.then(() => this.gateway.stopPlayback().catch(() => {}));
    return this.queue;
  }
}

module.exports = {
  AtomEchoLiveAudioRoute,
  DEFAULT_CHUNK_BYTES,
  DEFAULT_MAX_PENDING_BYTES,
};
