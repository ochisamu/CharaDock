// SPDX-License-Identifier: Apache-2.0
(function exposeRealtimeBeatrice(global) {
  const exactArrayBuffer = (value) => {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return null;
  };

  class RealtimeBeatriceConverter {
    constructor(api, onError = () => {}, onLevel = () => {}) {
      this.api = api;
      this.onError = onError;
      this.onLevel = onLevel;
      this.context = null;
      this.output = null;
      this.decodeAudio = null;
      this.unsubscribeAudio = null;
      this.unsubscribeError = null;
      this.captureReader = null;
      this.captureTask = null;
      this.captureFrames = [];
      this.captureSamples = 0;
      this.captureOffset = 0;
      this.playbackFrames = [];
      this.playbackSamples = 0;
      this.nextPlaybackTime = 0;
      this.playbackSources = new Set();
      this.levelTimers = new Set();
      this.playbackFlushTimer = 0;
      this.muted = false;
    }

    flushPlayback() {
      clearTimeout(this.playbackFlushTimer);
      this.playbackFlushTimer = 0;
      if (!this.playbackSamples) return;
      const context = this.context;
      if (!context || context.state === "closed") return;
      const combined = new Float32Array(this.playbackSamples);
      let offset = 0;
      for (const frame of this.playbackFrames) {
        combined.set(frame, offset);
        offset += frame.length;
      }
      this.playbackFrames = [];
      this.playbackSamples = 0;
      const audioBuffer = context.createBuffer(1, combined.length, 48000);
      audioBuffer.copyToChannel(combined, 0);
      const playback = context.createBufferSource();
      playback.buffer = audioBuffer;
      playback.connect(this.output || context.destination);
      if (!this.nextPlaybackTime || this.nextPlaybackTime < context.currentTime + .02) {
        this.nextPlaybackTime = context.currentTime + .08;
      }
      const playbackTime = this.nextPlaybackTime;
      playback.start(playbackTime);
      this.nextPlaybackTime += combined.length / 48000;
      let sum = 0;
      for (const sample of combined) sum += sample * sample;
      const rms = Math.sqrt(sum / combined.length);
      const levelTimer = setTimeout(() => {
        this.levelTimers.delete(levelTimer);
        this.onLevel(rms, performance.now());
      }, Math.max(0, (playbackTime - context.currentTime) * 1000));
      this.levelTimers.add(levelTimer);
      this.playbackSources.add(playback);
      playback.onended = () => {
        this.playbackSources.delete(playback);
        if (!this.playbackSources.size && !this.playbackSamples) this.onLevel(0, performance.now());
      };
    }

    queuePlayback(value) {
      const buffer = exactArrayBuffer(value);
      if (!buffer || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT) {
        this.onError(new Error("Beatrice 2の音声データ形式を処理できません。"));
        return;
      }
      const samples = new Float32Array(buffer);
      if (!samples.length) return;
      this.playbackFrames.push(samples);
      this.playbackSamples += samples.length;
      // Schedule fewer, larger buffers to avoid one main-thread audio source
      // per 10 ms native frame, but flush a short final group after an audio
      // gap so sentence tails are not discarded.
      clearTimeout(this.playbackFlushTimer);
      if (this.playbackSamples >= 1920) this.flushPlayback();
      else this.playbackFlushTimer = setTimeout(() => this.flushPlayback(), 26);
    }

    pushCaptureSamples(samples) {
      if (!samples.length) return;
      this.captureFrames.push(samples);
      this.captureSamples += samples.length;
      while (this.captureSamples >= 480) {
        const frame = new Float32Array(480);
        let written = 0;
        while (written < frame.length) {
          const source = this.captureFrames[0];
          const count = Math.min(frame.length - written, source.length - this.captureOffset);
          frame.set(source.subarray(this.captureOffset, this.captureOffset + count), written);
          written += count;
          this.captureOffset += count;
          this.captureSamples -= count;
          if (this.captureOffset === source.length) {
            this.captureFrames.shift();
            this.captureOffset = 0;
          }
        }
        this.api.pushBeatriceAudio(frame.buffer);
      }
    }

    startCapture(track) {
      if (typeof MediaStreamTrackProcessor !== "function") throw new Error("このElectronではRealtime回答音声を変換できません。");
      const processor = new MediaStreamTrackProcessor({ track });
      const reader = processor.readable.getReader();
      this.captureReader = reader;
      this.captureTask = (async () => {
        try {
          while (this.captureReader === reader) {
            const { value: audio, done } = await reader.read();
            if (done) break;
            try {
              const frames = audio.numberOfFrames;
              const channels = audio.numberOfChannels;
              const mono = new Float32Array(frames);
              for (let channel = 0; channel < channels; channel += 1) {
                const plane = new Float32Array(frames);
                audio.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
                for (let index = 0; index < frames; index += 1) mono[index] += plane[index] / channels;
              }
              if (audio.sampleRate === 48000) {
                this.pushCaptureSamples(mono);
              } else {
                const outputLength = Math.max(1, Math.round(mono.length * 48000 / audio.sampleRate));
                const resampled = new Float32Array(outputLength);
                const scale = audio.sampleRate / 48000;
                for (let index = 0; index < outputLength; index += 1) {
                  const position = index * scale;
                  const left = Math.min(mono.length - 1, Math.floor(position));
                  const right = Math.min(mono.length - 1, left + 1);
                  const mix = position - left;
                  resampled[index] = mono[left] * (1 - mix) + mono[right] * mix;
                }
                this.pushCaptureSamples(resampled);
              }
            } finally {
              audio.close();
            }
          }
        } catch (error) {
          if (this.captureReader === reader) this.onError(error);
        }
      })();
    }

    async start(stream) {
      await this.stop();
      await this.api.startBeatrice();
      const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
      const output = context.createGain();
      output.connect(context.destination);
      const decodeAudio = new Audio();
      decodeAudio.autoplay = true;
      decodeAudio.muted = true;
      decodeAudio.srcObject = stream;
      this.context = context;
      this.output = output;
      output.gain.value = this.muted ? 0 : 1;
      this.decodeAudio = decodeAudio;
      this.unsubscribeAudio = this.api.onBeatriceAudio((audio) => this.queuePlayback(audio));
      this.unsubscribeError = this.api.onBeatriceError((message) => this.onError(new Error(String(message))));
      await context.resume();
      if (context.state !== "running") throw new Error("Beatrice 2の音声再生を開始できません。");
      await decodeAudio.play();
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("Realtimeの回答音声トラックがありません。");
      this.startCapture(track);
    }

    setMuted(value) {
      this.muted = Boolean(value);
      if (this.output) this.output.gain.setTargetAtTime(this.muted ? 0 : 1, this.context?.currentTime || 0, .012);
    }

    async stop() {
      this.unsubscribeAudio?.();
      this.unsubscribeError?.();
      this.unsubscribeAudio = null;
      this.unsubscribeError = null;
      const captureReader = this.captureReader;
      this.captureReader = null;
      try { await captureReader?.cancel(); } catch {}
      this.captureTask = null;
      this.captureFrames = [];
      this.captureSamples = 0;
      this.captureOffset = 0;
      try { this.output?.disconnect(); } catch {}
      try { this.decodeAudio?.pause(); } catch {}
      if (this.decodeAudio) this.decodeAudio.srcObject = null;
      for (const playback of this.playbackSources) {
        try { playback.stop(); } catch {}
        try { playback.disconnect(); } catch {}
      }
      this.playbackSources.clear();
      for (const timer of this.levelTimers) clearTimeout(timer);
      this.levelTimers.clear();
      clearTimeout(this.playbackFlushTimer);
      this.playbackFlushTimer = 0;
      this.playbackFrames = [];
      this.playbackSamples = 0;
      this.nextPlaybackTime = 0;
      try { await this.context?.close(); } catch {}
      this.context = null;
      this.output = null;
      this.decodeAudio = null;
      this.onLevel(0, performance.now());
      await this.api.stopBeatrice?.().catch(() => {});
    }
  }

  global.RealtimeBeatriceConverter = RealtimeBeatriceConverter;
})(window);
