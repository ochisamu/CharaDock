// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { SpeechEnhancement } = require('../lib/speech-enhancement.cjs');
function setup({ ready = true, respond = true, ...options } = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.messages = [];
  child.send = m => child.stdout.write(JSON.stringify(m) + '\n');
  child.stdin = new Writable({ write(data, _encoding, done) {
    for (const line of data.toString().trim().split('\n')) {
      const m = JSON.parse(line); child.messages.push(m);
      if (m.type === 'enhance' && respond) {
        const pcm = Buffer.concat(child.messages.filter(x => x.id === m.id && x.type === 'chunk').map(x => Buffer.from(x.pcm, 'base64')));
        process.nextTick(() => { child.send({ type: 'chunk', id: m.id, seq: 0, pcm: pcm.toString('base64') }); child.send({ type: 'end', id: m.id, samples: pcm.length / 2, stop: 'complete' }); });
      }
    }
    done();
  } });
  child.kill = () => { child.killed = true; };
  const client = new SpeechEnhancement('/tmp/reuse-unit', { getEnabled: () => true, spawnImpl: () => child, ...options });
  client.models = { status: () => ({ installed: true }), installedPaths: () => ({ executablePath: 'speech', modelPath: 'reuse.gguf' }) };
  if (ready) process.nextTick(() => child.send({ type: 'ready', protocol: 4, version: '0.11.0', model: { task: 'enhancement', architecture: 'semamba' } }));
  return { client, child };
}
const input = () => ({ samples: new Float32Array([0.2, -0.3, 0, 0.9]), sampleRate: 16000 });
test('disabled enhancement preserves input without loading an engine', async () => {
  const { client } = setup({ ready: false, getEnabled: () => false }); const payload = input();
  assert.equal((await client.enhance(payload)).samples, payload.samples); assert.equal(client.worker, null); client.stop();
});
test('worker receives ordered PCM and returns the original duration at the requested rate', async () => {
  const { client, child } = setup();
  try {
    const result = await client.enhance(input()); assert.equal(result.enhanced, true); assert.equal(result.samples.length, 4); assert.equal(result.sampleRate, 16000);
    assert.ok(Math.abs(result.samples[1] + .3) < .0001);
    assert.equal(child.messages.at(-1).type, 'enhance'); assert.equal(child.messages.at(-1).sample_rate, 16000);
  } finally { client.stop(); }
});
test('cancelling active enhancement rejects promptly and ignores late audio', async () => {
  const { client, child } = setup({ respond: false }); const abort = new AbortController();
  try {
    const promise = client.enhance(input(), { signal: abort.signal });
    while (!child.messages.some(m => m.type === 'enhance')) await new Promise(r => setImmediate(r));
    const id = child.messages.at(-1).id; abort.abort(new Error('test interrupted'));
    await assert.rejects(promise, /test interrupted/); assert.equal(client.pending.size, 0);
    child.send({ type: 'chunk', id, seq: 0, pcm: 'AAAAAA==' }); assert.equal(child.killed, undefined);
    assert.ok(child.messages.some(m => m.type === 'cancel' && m.id === id));
  } finally { client.stop(); }
});
test('cancelling during model warmup does not wait for ready', async () => {
  const { client } = setup({ ready: false }); const abort = new AbortController();
  const promise = client.enhance(input(), { signal: abort.signal }); abort.abort(new Error('warmup cancelled'));
  await assert.rejects(promise, /warmup cancelled/); client.stop();
});
test('wrong sequence and truncated terminal audio reject and stop the broken engine', async () => {
  for (const mode of ['sequence', 'truncated']) {
    const { client, child } = setup({ respond: false });
    const promise = client.enhance(input());
    while (!child.messages.some(m => m.type === 'enhance')) await new Promise(r => setImmediate(r));
    const id = child.messages.at(-1).id;
    child.send(mode === 'sequence' ? { type: 'chunk', id, seq: 3, pcm: 'AAAAAA==' } : { type: 'end', id, samples: 0, stop: 'complete' });
    await assert.rejects(promise); assert.equal(child.killed, true); client.stop();
  }
});
test('timeout settles the request and frees the worker', async () => {
  const { client, child } = setup({ respond: false, requestTimeoutMs: 15 });
  await assert.rejects(client.enhance(input()), /時間切れ/); assert.equal(client.pending.size, 0); assert.equal(child.killed, true); client.stop();
});
test('invalid or overlong audio is refused before engine startup', async () => {
  const { client } = setup({ ready: false });
  await assert.rejects(client.enhance({ samples: [NaN], sampleRate: 16000 }));
  await assert.rejects(client.enhance({ samples: new Float32Array(16000 * 31), sampleRate: 16000 }));
  assert.equal(client.worker, null); client.stop();
});