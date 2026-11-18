// SPDX-License-Identifier: Apache-2.0
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { EmbeddedTtsModels } = require('./tts-model-download.cjs');
const manifest = require('./speech-enhancement-manifest.json');

function withAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error("音声入力を中止しました。"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

class SpeechEnhancement {
  constructor(baseDirectory, { getEnabled = () => false, spawnImpl = spawn, fetchImpl = globalThis.fetch,
    platform = process.platform, startupTimeoutMs = 120000, requestTimeoutMs = 120000, idleTimeoutMs = 120000 } = {}) {
    Object.assign(this, { getEnabled, spawnImpl, startupTimeoutMs, requestTimeoutMs, idleTimeoutMs });
    this.models = new EmbeddedTtsModels(baseDirectory, { fetchImpl, platform, models: { 're-use': manifest } });
    this.pending = new Map();
    this.worker = null;
    this.ready = null;
  }
  status() { return { ...this.models.status('re-use'), enabled: this.getEnabled() === true }; }
  download(onProgress) { return this.models.download('re-use', onProgress); }
  remove() { this.stop(); return this.models.remove('re-use'); }
  async prepare() {
    if (!this.getEnabled()) return;
    if (!this.models.installedPaths('re-use').modelPath) throw new Error('音声入力のノイズ低減モデルを設定からダウンロードしてください。');
    if (this.worker) return this.ready;
    clearTimeout(this.idleTimer);
    const { executablePath, modelPath } = this.models.installedPaths('re-use');
    const child = this.spawnImpl(executablePath, ['worker', modelPath, '--threads', '4'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.worker = child;
    let buffer = '', loaded = false;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('ノイズ低減エンジンの準備が時間切れになりました。')), this.startupTimeoutMs);
      this.rejectStartup = reject;
      const fail = error => {
        if (this.worker !== child) return;
        clearTimeout(timer); reject(error); this.rejectStartup = null;
        this.stop(error);
      };
      this.startupTimer = timer;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        if (this.worker !== child) return;
        buffer += data;
        if (buffer.length > 8 * 1024 * 1024) return fail(new Error('ノイズ低減エンジンの応答が大きすぎます。'));
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const m = JSON.parse(line);
            if (!loaded) {
              if (m.type !== 'ready' || m.protocol !== 4 || !['0.10.1', '0.11.0'].includes(m.version)
                || m.model?.task !== 'enhancement' || m.model?.architecture !== 'semamba') {
                throw new Error('ノイズ低減エンジンまたはモデルが対応していません。');
              }
              loaded = true; clearTimeout(timer); this.rejectStartup = null; resolve(m); this.armIdle();
            } else this.message(m);
          } catch (error) { fail(error); return; }
        }
      });
      child.stderr.on('data', () => {});
      child.on('error', () => fail(new Error('ノイズ低減エンジンを起動できません。')));
      child.on('exit', () => fail(new Error('ノイズ低減エンジンが停止しました。')));
      child.stdin.on('error', () => fail(new Error('ノイズ低減エンジンとの接続が切れました。')));
    });
    this.ready.catch(() => {});
    return this.ready;
  }
  armIdle() {
    clearTimeout(this.idleTimer);
    if (!this.pending.size) { this.idleTimer = setTimeout(() => this.stop(), this.idleTimeoutMs); this.idleTimer.unref?.(); }
  }
  message(m) {
    if (typeof m.id !== 'string') throw new Error('ノイズ低減エンジンの応答形式が正しくありません。');
    const req = this.pending.get(m.id);
    if (!req) return; // An interrupted request can still return a late chunk.
    if (m.type === 'progress') return;
    if (m.type === 'chunk') {
      if (m.seq !== req.seq++ || typeof m.pcm !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.pcm)) throw new Error('ノイズ低減の音声データが正しくありません。');
      const chunk = Buffer.from(m.pcm, 'base64'); req.bytes += chunk.length;
      if (!chunk.length || chunk.length % 2 || req.bytes > req.expectedBytes) throw new Error('ノイズ低減の音声データの長さが正しくありません。');
      req.chunks.push(chunk); return;
    }
    if (m.type === 'end') {
      if (m.stop !== 'complete' || m.samples * 2 !== req.bytes || req.bytes !== req.expectedBytes) throw new Error('ノイズ低減が途中で終了しました。');
      const pcm = Buffer.concat(req.chunks), samples = new Float32Array(pcm.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
      req.settle(null, { samples, sampleRate: req.sampleRate, enhanced: true, latencyMs: Date.now() - req.started });
    } else if (m.type === 'error' || m.type === 'cancelled') req.settle(new Error(m.type === 'cancelled' ? '音声入力を中止しました。' : '音声のノイズを低減できませんでした。OFFにして再試行できます。'));
    else throw new Error('ノイズ低減エンジンから未対応の応答が届きました。');
  }
  async enhance({ samples, sampleRate = 16000 } = {}, { signal } = {}) {
    if (!this.getEnabled()) return { samples, sampleRate, enhanced: false };
    signal?.throwIfAborted();
    const waveform = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000
      || !waveform.length || waveform.length > sampleRate * 30) throw new Error('ノイズ低減には30秒以内の音声を使ってください。');
    const pcm = Buffer.alloc(waveform.length * 2);
    for (let i = 0; i < waveform.length; i++) {
      if (!Number.isFinite(waveform[i])) throw new Error('録音音声の形式が正しくありません。');
      pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, waveform[i])) * 32767), i * 2);
    }
    await withAbort(this.prepare(), signal); signal?.throwIfAborted();
    if (this.pending.size >= 4) throw new Error('ほかの音声を処理しています。少し待ってから再試行してください。');
    clearTimeout(this.idleTimer);
    const id = randomUUID(), child = this.worker;
    return new Promise((resolve, reject) => {
      const req = { seq: 0, chunks: [], bytes: 0, expectedBytes: pcm.length, sampleRate, started: Date.now() };
      const cancel = () => {
        if (this.pending.get(id) !== req) return;
        try { if (this.worker === child && child.stdin.writable) child.stdin.write(JSON.stringify({ type: 'cancel', id }) + '\n'); } catch { /* Best effort; settle cancellation even after the pipe closes. */ }
        req.settle(signal?.reason || new Error('音声入力を中止しました。'));
      };
      req.settle = (error, value) => {
        if (this.pending.get(id) !== req) return;
        clearTimeout(req.timer); signal?.removeEventListener('abort', cancel); this.pending.delete(id); this.armIdle();
        if (error) reject(error); else resolve(value);
      };
      this.pending.set(id, req);
      req.timer = setTimeout(() => this.stop(new Error('ノイズ低減の処理が時間切れになりました。')), this.requestTimeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      try {
        for (let offset = 0, seq = 0; offset < pcm.length; offset += 64000, seq++) child.stdin.write(JSON.stringify({ type: 'chunk', id, seq, pcm: pcm.subarray(offset, offset + 64000).toString('base64') }) + '\n');
        child.stdin.write(JSON.stringify({ type: 'enhance', id, sample_rate: sampleRate }) + '\n');
      } catch { this.stop(new Error('ノイズ低減エンジンとの接続が切れました。')); }
    });
  }
  stop(error = new Error('音声入力のノイズ低減を終了しました。')) {
    clearTimeout(this.idleTimer); clearTimeout(this.startupTimer);
    const child = this.worker; this.worker = null; this.ready = null;
    this.rejectStartup?.(error); this.rejectStartup = null;
    for (const req of [...this.pending.values()]) req.settle(error);
    clearTimeout(this.idleTimer); child?.kill();
  }
}
module.exports = { SpeechEnhancement };