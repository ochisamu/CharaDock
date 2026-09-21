const test = require('node:test');
const assert = require('node:assert/strict');
const { JevAddressGate } = require('../lib/jev-address-gate.cjs');
const { JevClient } = require('../lib/jev-client.cjs');
function setup() {
  const state = { mode: 'standard', enabled: true, context: 'Nike', time: 0, result: 'addressed', calls: 0 };
  const gate = new JevAddressGate({ mode: () => state.mode, enabled: () => state.enabled,
    context: () => state.context, now: () => state.time,
    classify: async () => { state.calls++; return state.result; } });
  return { gate, state, check: () => gate.check('test', { handsfree: true }) };
}
test('manual and disabled mode bypass without network', async () => {
  const { gate, state, check } = setup();
  assert.equal((await gate.check('test')).accepted, true);
  state.mode = 'off'; assert.equal((await check()).accepted, true);
  assert.equal(state.calls, 0);
});
test('standard vetoes unrelated, not uncertain; malformed and unavailable remain closed', async () => {
  const { state, check } = setup();
  for (const result of ['unrelated', null, 'invalid']) {
    state.result = result; assert.equal((await check()).accepted, false);
  }
  state.result = 'uncertain'; assert.equal((await check()).accepted, true);
  state.result = 'addressed'; assert.equal((await check()).accepted, true);
  state.enabled = false; assert.equal((await check()).accepted, false);
});
test('short replies require recent same-character context and expire', async () => {
  const { state, gate, check } = setup(); state.mode = 'strict'; state.result = 'reply';
  assert.equal((await check()).accepted, false);
  gate.remember('Would you like another?'); assert.equal((await check()).accepted, true);
  state.time = 30001; assert.equal((await check()).accepted, false);
  gate.remember('Continue?'); state.context = 'other'; assert.equal((await check()).accepted, false);
});
test('strict reply window is shorter', async () => {
  const { state, gate, check } = setup(); state.mode = 'strict'; state.result = 'reply';
  gate.remember('Continue?'); state.time = 15001; assert.equal((await check()).accepted, false);
});
test('in-flight duplicate and stale mode are rejected, and errors recover', async () => {
  const { state, gate, check } = setup(); let resolve;
  gate.classify = () => new Promise(r => { resolve = r; });
  const pending = check(); assert.equal((await check()).reason, 'busy');
  state.mode = 'strict'; resolve('addressed'); assert.equal((await pending).reason, 'stale');
  gate.classify = async () => { throw Error('secret'); };
  assert.deepEqual(await check(), { accepted: false, reason: 'unavailable' });
  gate.classify = async () => 'addressed'; assert.equal((await check()).accepted, true);
});
test('client validates confidence and strict threshold using mocked transport', async () => {
  const client = new JevClient({ getApiKey: () => 'synthetic', fetchImpl: async () => ({ ok: true,
    text: async () => JSON.stringify({ answers: { communicative: { type: 'choice', choice: 'speech', probabilities: { speech: .99 } }, recipient: { type: 'choice', choice: 'addressed', probabilities: { addressed: .85 } } } }) }) });
  assert.equal(await client.address('hello', { mode: 'standard' }), 'addressed');
  assert.equal(await client.address('hello', { mode: 'strict' }), null);
});

for (const mode of ['standard', 'strict']) {
  test(`${mode}: greetings pass without context; noise is never an uncertain-recipient bypass`, async () => {
    const { state, check } = setup(); state.mode = mode;
    state.result = 'greeting'; assert.equal((await check()).accepted, true);
    for (const result of ['non_speech', 'unclear_speech', 'unrelated']) {
      state.result = result; assert.equal((await check()).accepted, false);
    }
  });
}
const selected = (value, probability = .99) => ({ type: 'choice', choice: value, probabilities: { [value]: probability } });
test('client separates communicative intent from recipient in a single request', async () => {
  let answers = { communicative: selected('speech'), recipient: selected('greeting', .85) };
  let calls = 0;
  const client = new JevClient({ getApiKey: () => 'synthetic', fetchImpl: async (_url, request) => {
    calls++;
    const payload = JSON.parse(request.body);
    assert.ok(payload.questions.communicative); assert.ok(payload.questions.recipient);
    return { ok: true, text: async () => JSON.stringify({ answers }) };
  } });
  const options = { mode: 'strict' };
  assert.equal(await client.address('こんにちは', options), 'greeting');
  assert.equal(calls, 1);
  answers = { communicative: selected('non_speech'), recipient: selected('uncertain') };
  assert.equal(await client.address('フッ', { mode: 'standard' }), 'non_speech');
  answers = { communicative: selected('speech', .4), recipient: selected('greeting') };
  assert.equal(await client.address('fragment', options), 'unclear_speech');
  answers = { recipient: selected('greeting') };
  assert.equal(await client.address('fragment', options), null);
  answers = { communicative: selected('speech'), recipient: selected('unrelated') };
  assert.equal(await client.address('田中さん、こんにちは', options), 'unrelated');
});
