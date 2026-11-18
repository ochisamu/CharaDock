// SPDX-License-Identifier: Apache-2.0
const { AtomEchoPcmProcessor, Realtime48kTo16k, resamplePcm16 } = require("./device-audio.cjs");

const DEFAULT_CHUNK_BYTES = 1024;
const DEFAULT_MAX_PENDING_BYTES = 16_000 * 2 * 3;

class AtomEchoLiveAudioRoute {
  constructor({
    gateway,
    sampleRate = 16_000,
    chunkBytes = DEFAULT_CHUNK_BYTES,
    maxPendingBytes = DEFAULT_MAX_PENDING_BYTES,
    playbackOptions = () => ({}),
    processorOptions = {},
    onPlaybackReady = () => {},
    onError = () => {},
  } = {}) {
    if (!gateway) throw new Error("ATOM Echo audio gateway is required.");
    this.gateway = gateway;
    this.sampleRate = sampleRate;
    this.chunkBytes = chunkBytes;
    this.maxPendingBytes = maxPendingBytes;
    this.playbackOptions = playbackOptions;
    this.answerChunkBytes = chunkBytes;
    this.answerMaxPendingBytes = maxPendingBytes;
    this.processorOptions = processorOptions;
    this.onPlaybackReady = onPlaybackReady;
    this.onError = onError;
    this.generation = 0;
    this.session = null;
    this.remainder = Buffer.alloc(0);
    this.pendingBytes = 0;
    this.pendingChunks = [];
    this.batchQueued = false;
    this.endTicket = null;
    this.queue = Promise.resolve();
    this.processor = null;
    this.failure = null;
  }

  active() {
    return Boolean(this.session || this.remainder.length || this.pendingBytes);
  }

  invalidate() {
    this.generation += 1;
    this.session = null;
    this.remainder = Buffer.alloc(0);
    this.pendingBytes = 0;
    this.pendingChunks = [];
    this.batchQueued = false;
    this.endTicket = null;
    this.processor = null;
    this.realtimeResampler = null;
    return this.generation;
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
          this.invalidate();
          this.onError(error);
        }
      } finally {
        if (generation === this.generation)
          this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
      }
    });
  }

  start() {
    const playback = this.playbackOptions();
    const resume = playback.chunkWindow > 1 && this.endTicket !== null;
    const generation = resume ? this.generation : this.invalidate();
    this.endTicket = null;
    this.answerChunkBytes = playback.chunkBytes ?? this.chunkBytes;
    this.answerWindow = playback.chunkWindow ?? 1;
    this.filterRealtimeOutput = playback.filterRealtimeOutput === true && this.sampleRate === 16_000;
    this.answerMaxPendingBytes = playback.maxPendingBytes ?? this.maxPendingBytes;
    const processorOptions = typeof this.processorOptions === "function"
      ? this.processorOptions()
      : this.processorOptions;
    this.processor = new AtomEchoPcmProcessor({ sampleRate: this.sampleRate, ...(processorOptions || {}) });
    this.failure = null;
    if (resume) return generation;
    this.enqueue(generation, 0, async () => {
      await this.gateway.stopPlayback(playback.preserveVoiceMotionOnReset ? { preserveVoiceMotion: true } : undefined)
        .catch(() => {});
      if (generation !== this.generation) return;
      const session = await this.gateway.beginPcm16Playback(this.sampleRate);
      if (generation === this.generation) {
        this.session = session;
        this.onPlaybackReady();
      }
    });
    return generation;
  }

  queueChunk(generation, chunk) {
    if (this.answerWindow <= 1) {
      this.enqueue(generation, chunk.length, async () => {
        if (!this.session) return;
        const result = await this.gateway.writePcm16PlaybackChunk(chunk, this.session);
        if (result?.interrupted && generation === this.generation) this.invalidate();
      });
      return;
    }
    this.pendingChunks.push(chunk);
    this.pendingBytes += chunk.length;
    if (this.batchQueued) return;
    this.batchQueued = true;
    this.enqueue(generation, 0, async () => {
      while (generation === this.generation && this.session && this.pendingChunks.length) {
        const chunks = this.pendingChunks.splice(0, this.answerWindow);
        const result = await this.gateway.writePcm16PlaybackBatch(chunks, this.session);
        if (generation !== this.generation) return;
        if (result?.interrupted) {
          this.invalidate();
          return;
        }
        for (const bytes of chunks) this.pendingBytes -= bytes.length;
      }
      if (generation === this.generation) this.batchQueued = false;
    });
  }

  push(samples, sourceRate = 48_000) {
    const generation = this.generation;
    if (!generation) return false;
    if (!this.processor) return true;
    if (this.filterRealtimeOutput && sourceRate === 48_000)
      this.realtimeResampler ??= new Realtime48kTo16k();
    else
      this.realtimeResampler = null;
    const resampled = this.realtimeResampler
      ? this.realtimeResampler.push(samples) : resamplePcm16(samples, sourceRate, this.sampleRate);
    const pcm = this.processor?.push(resampled) || Buffer.alloc(0);
    if (!pcm.length) return true;
    if (this.pendingBytes + this.remainder.length + pcm.length > this.answerMaxPendingBytes) {
      const error = new Error("デバイスへのLive音声転送が追いつきませんでした。");
      this.failure = error;
      this.onError(error);
      this.interrupt();
      return false;
    }
    let combined = this.remainder.length ? Buffer.concat([this.remainder, pcm]) : pcm;
    while (combined.length >= this.answerChunkBytes) {
      const chunk = Buffer.from(combined.subarray(0, this.answerChunkBytes));
      combined = combined.subarray(this.answerChunkBytes);
      this.queueChunk(generation, chunk);
    }
    this.remainder = Buffer.from(combined);
    return true;
  }

  end() {
    const generation = this.generation;
    if (!generation) return Promise.resolve();
    const filterTail = this.realtimeResampler
      ? this.processor.push(this.realtimeResampler.finish()) : Buffer.alloc(0);
    this.realtimeResampler = null;
    const processedTail = Buffer.concat([filterTail, this.processor?.finish() || Buffer.alloc(0)]);
    this.processor = null;
    let tail = this.remainder.length ? Buffer.concat([this.remainder, processedTail]) : processedTail;
    this.remainder = Buffer.alloc(0);
    while (tail.length) {
      const chunk = Buffer.from(tail.subarray(0, this.answerChunkBytes));
      tail = tail.subarray(chunk.length);
      this.queueChunk(generation, chunk);
    }
    const ticket = {};
    this.endTicket = ticket;
    this.enqueue(generation, 0, async () => {
      if (this.endTicket !== ticket) return;
      ticket.sent = true;
      this.endTicket = null;
      if (!this.session) return;
      const session = this.session;
      const result = await this.gateway.endPcm16Playback(session);
      if (generation !== this.generation) return;
      this.session = null;
      if (result?.interrupted) this.invalidate();
    });
    return this.queue.then(() => {
      if (this.failure) throw this.failure;
      return { interrupted: generation !== this.generation || !ticket.sent };
    });
  }

  interrupt() {
    this.invalidate();
    const stop = () => this.gateway.stopPlayback().catch(() => {});
    if (this.answerWindow > 1) {
      // A larger device buffer can continue draining for seconds. Send Stop
      // immediately and still wait for queued operations to relinquish ownership.
      this.queue = Promise.all([this.queue, stop()]);
    } else {
      this.queue = this.queue.then(stop);
    }
    return this.queue;
  }
}

module.exports = {
  AtomEchoLiveAudioRoute,
  DEFAULT_CHUNK_BYTES,
  DEFAULT_MAX_PENDING_BYTES,
};
