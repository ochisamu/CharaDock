// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createQueue, createUploadQueue, encodePcm, decodePcm, playChunks } = require('../pcm-speech-player.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function context() {
  return { currentTime: 0, destination: {}, sources: [],
    createBuffer: (_c, length, rate) => ({ length, rate, copyToChannel(samples) { this.samples = samples.slice(); } }),
    createBufferSource() { const s = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(at) { this.at = at; } }; this.sources.push(s); return s; },
  };
}
test('transient VPN errors preserve the pairing and only rejected credentials end the session', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../remote/remote.js'), 'utf8');
  const start = source.indexOf('    eventSource.onerror = () => {');
  const end = source.indexOf('\n  }\n', start);
  for (const status of [undefined, 500, 401, 403]) {
    const calls = [];
    const env = { eventSource: {}, text: ja => ja, setConnection: () => calls.push('reconnecting'),
      refreshState: async () => { throw Object.assign(Error('offline'), { status }); }, showPairing: () => calls.push('pairing') };
    vm.createContext(env); vm.runInContext(source.slice(start, end), env);
    env.eventSource.onerror(); await tick();
    assert.deepEqual(calls, status === 401 || status === 403 ? ['reconnecting', 'pairing'] : ['reconnecting']);
  }
});
test('HTTP failures preserve their status while transport errors remain transport errors', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../remote/remote.js'), 'utf8');
  const start = source.indexOf('  async function request('), end = source.indexOf('\n  async function registerPwa(', start);
  const env = { csrfToken: '', clearTimeout, fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: 'expired' }) }) };
  vm.createContext(env); vm.runInContext(source.slice(start, end), env);
  await assert.rejects(env.request('/api/state'), error => error.status === 401 && error.message === 'expired');
  env.fetch = async () => { throw Error('offline'); };
  await assert.rejects(env.request('/api/state'), error => error.status === undefined && error.message === 'offline');
});
test('mobile PCM16 transport halves float payload size and preserves audio to 16-bit precision', () => {
  const samples = Float32Array.from([-1, -.3, 0, .2, .999]);
  const encoded = encodePcm(samples), restored = decodePcm(encoded);
  assert.equal(Buffer.from(encoded, 'base64').length, samples.length * 2);
  for (let i = 0; i < samples.length; i++) assert.ok(Math.abs(samples[i] - restored[i]) <= 1 / 32768);
  assert.throws(() => encodePcm(Float32Array.of(NaN)));
});
test('network playback waits for a cushion then schedules every sample contiguously', () => {
  const c = context(), q = createQueue({ context: c, bufferMs: 300 });
  for (let i = 0; i < 2; i++) q.push(new Float32Array(4800));
  assert.equal(c.sources.length, 0);
  q.push(new Float32Array(4800));
  assert.equal(c.sources.length, 3);
  assert.ok(Math.abs(c.sources[1].at - c.sources[0].at - .1) < 1e-6);
  assert.ok(Math.abs(c.sources[2].at - c.sources[1].at - .1) < 1e-6);
  q.stop();
});
test('a delayed burst increases the bounded recovery cushion and never drops a short tail', () => {
  const c = context(), q = createQueue({ context: c, bufferMs: 300 });
  q.push(new Float32Array(14400)); c.currentTime = 1;
  q.push(new Float32Array(480));
  assert.equal(q.targetMs, 400); assert.equal(c.sources.length, 1);
  q.flush(); assert.equal(c.sources.length, 2);
  assert.equal(c.sources[1].buffer.length, 480);
  for (let i = 0; i < 20; i++) { c.currentTime += 2; q.push(new Float32Array(480)); q.flush(); }
  assert.ok(q.targetMs <= 1000); q.stop();
});
test('stop removes prebuffered and scheduled audio without a late restart', async () => {
  const c = context(), q = createQueue({ context: c, bufferMs: 30 });
  q.push(new Float32Array(48)); q.stop(); await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(c.sources.length, 0);
  const playing = createQueue({ context: c, bufferMs: 0 }); playing.push(new Float32Array(480)); playing.stop();
  assert.equal(c.sources[0].stopped, true); assert.equal(c.sources[0].onended, null);
});
test('slow VPN uploads coalesce ordered samples instead of discarding old 80ms frames', async () => {
  const first = deferred(), sent = [];
  const upload = createUploadQueue({ send: async samples => { sent.push(samples); if (sent.length === 1) await first.promise; }, onError: assert.fail });
  for (let i = 0; i < 20; i++) upload.push(new Float32Array(3840).fill(i));
  assert.equal(sent.length, 1); first.resolve(); await tick();
  const all = Float32Array.from(sent.flatMap(frame => [...frame]));
  assert.equal(all.length, 20 * 3840);
  for (let i = 0; i < 20; i++) assert.equal(all[i * 3840], i);
  assert.equal(sent[1].length, 48000); upload.stop();
});
test('an unbounded uplink stall fails explicitly and old failures cannot affect a new session', async () => {
  const pending = deferred(), errors = [];
  const upload = createUploadQueue({ send: () => pending.promise, maxQueuedSamples: 480, onError: error => errors.push(error.message) });
  upload.push(new Float32Array(480)); upload.push(new Float32Array(480)); upload.push(new Float32Array(480));
  assert.deepEqual(errors, ['Audio upload backlog']);
  pending.reject(Error('old network failure')); await tick(); assert.equal(errors.length, 1);
});
test('standard TTS fetches its next phrase while the current phrase is playing', async () => {
  const speaking = deferred(), calls = [];
  const playback = playChunks({ first: { streamId: 's', text: 'one' }, next: async () => { calls.push('fetch'); return { text: 'two', done: true }; },
    play: async chunk => { calls.push(chunk.text); if (chunk.text === 'one') await speaking.promise; return true; } });
  await tick(); assert.deepEqual(calls, ['one', 'fetch']); speaking.resolve(); assert.equal(await playback, true); assert.deepEqual(calls, ['one', 'fetch', 'two']);
});
test('a cancelled phrase ignores a late prefetched response', async () => {
  let current = true; const speak = deferred(), next = deferred(), calls = [];
  const playback = playChunks({ first: { streamId: 's', text: 'old' }, isCurrent: () => current, next: () => next.promise,
    play: async chunk => { calls.push(chunk.text); await speak.promise; return true; } });
  await tick(); current = false; speak.resolve(); await playback; next.reject(Error('offline')); await tick();
  assert.deepEqual(calls, ['old']);
});
test('interruption settles immediately while the prefetched request is stalled', async () => {
  const controller = new AbortController(), pending = deferred();
  const playback = playChunks({ first: { streamId: 's' }, signal: controller.signal, next: () => pending.promise, play: async () => true });
  await tick(); controller.abort(); assert.equal(await playback, true);
  pending.reject(Error('late network error')); await tick();
});
test('production Beatrice ingress validates large PCM16 batches and retains legacy float clients', () => {
  const source = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = source.indexOf('function processRemoteBeatriceAudio('), end = source.indexOf('\nfunction stopRemoteBeatrice(', start);
  const frames = [], env = { Buffer, Float32Array, decodePcm, BEATRICE_BLOCK_SAMPLES: 480, beatriceAudioOwner: 'owner', remoteBeatriceSessionId: 'session', activeRealtimeTarget: 'remote', beatriceAudioStats: null,
    beatriceHostClient: { ready: true, push: frame => { frames.push(new Float32Array(frame)); return true; } } };
  vm.createContext(env); vm.runInContext(source.slice(start, end), env);
  const payload = { remoteTokenHash: 'owner', sessionId: 'session', format: 'pcm16', audio: encodePcm(new Float32Array(48000).fill(.25)) };
  assert.equal(env.processRemoteBeatriceAudio(payload).frames, 100); assert.equal(frames[0][0], .25);
  assert.throws(() => env.processRemoteBeatriceAudio({ ...payload, remoteTokenHash: 'other' }));
  assert.throws(() => env.processRemoteBeatriceAudio({ ...payload, audio: encodePcm(new Float32Array(48001)) }));
  assert.equal(env.processRemoteBeatriceAudio({ ...payload, format: undefined, audio: Buffer.from(new Float32Array(480).buffer).toString('base64') }).frames, 1);
});
test('an early audio track starts conversion after the authoritative HTTP response despite stale phone settings', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../remote/remote.js'), 'utf8');
  const start = source.indexOf('liveSessionId = String(started?.liveSessionId');
  const end = source.indexOf('\n      return true;', start);
  for (const enabled of [true, false]) {
    const calls = [];
    const env = { started: { liveSessionId: 'live', beatriceActive: enabled, beatriceSessionId: enabled ? 'converter' : '' },
      liveBeatriceActive: !enabled, liveAudioSource: {}, liveAudioContext: { currentTime: 0 }, liveAudioGain: { gain: { setTargetAtTime: value => calls.push(['gain', value]) } },
      pumpLiveBeatriceUploads: () => calls.push(['upload']), startLiveBeatriceCapture: async () => calls.push(['capture']),
      stopLiveBeatricePipeline: opts => calls.push(['stop', opts.restoreRaw]), failLiveBeatrice: assert.fail, text: ja => ja };
    vm.createContext(env); await vm.runInContext(`(async()=>{${source.slice(start, end)}})()`, env);
    assert.equal(env.liveBeatriceActive, enabled); assert.equal(env.liveConversionConfirmed, true);
    assert.equal(calls.some(c => c[0] === 'capture'), enabled);
    if (enabled) assert.deepEqual(calls.find(c => c[0] === 'gain'), ['gain', 0]);
    else assert.deepEqual(calls, [['stop', true]]);
  }
});
test('capture startup is serialized and a cancelled worklet load never resurrects a session', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../remote/remote.js'), 'utf8');
  const start = source.indexOf('function startLiveBeatriceCapture('), end = source.indexOf('\n  function queueLiveBeatricePlayback(', start);
  for (const cancel of [false, true]) {
    const loaded = deferred(), nodes = [], audioSource = { connect() {} };
    const c = { audioWorklet: { addModule: () => loaded.promise }, sampleRate: 48000, currentTime: 0, destination: {},
      createGain: () => ({ gain: {}, connect() {} }) };
    const env = { liveBeatriceProcessor: null, liveBeatriceCaptureTask: null, liveBeatriceGeneration: 1, liveBeatriceActive: true, liveAudioSource: audioSource,
      liveOutputSuppressed: false, audioEnabled: true, captureLiveBeatrice() {},
      AudioWorkletNode: class { constructor() { nodes.push(this); this.port = {}; } connect() {} } };
    vm.createContext(env); vm.runInContext(source.slice(start, end), env);
    const a = env.startLiveBeatriceCapture(audioSource, c), b = env.startLiveBeatriceCapture(audioSource, c);
    assert.equal(a, b); if (cancel) env.liveBeatriceGeneration++;
    loaded.resolve(); await Promise.all([a, b]); assert.equal(nodes.length, cancel ? 0 : 1);
  }
});
test('audio worklet preserves mono samples at both 44.1kHz and 48kHz without main-thread capture callbacks', () => {
  const source = fs.readFileSync(path.join(__dirname, '../remote/live-capture-worklet.js'), 'utf8');
  for (const sampleRate of [44100, 48000]) {
    const frames = []; let Processor;
    const env = { sampleRate, Float32Array, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: frame => frames.push(new Float32Array(frame).slice()) }; } },
      registerProcessor: (_name, P) => { Processor = P; } };
    vm.createContext(env); vm.runInContext(source, env); const p = new Processor();
    for (let i = 0; i < 300; i++) p.process([[new Float32Array(128).fill(.2), new Float32Array(128).fill(.4)]], [[new Float32Array(128)]]);
    const size = Math.round(sampleRate * .08);
    assert.equal(frames.length, Math.floor(300 * 128 / size));
    assert.ok(frames.every(f => f.length === size && Math.abs(f[0] - .3) < 1e-6));
  }
});
