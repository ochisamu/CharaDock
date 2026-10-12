// SPDX-License-Identifier: Apache-2.0
const test = require('node:test'), assert = require('node:assert/strict');
const { PendingFiller, decideFiller } = require('../lib/turn-policy.cjs');
function harness(decide) {
  let now = 0, timer; const spoken = [], attempts = [];
  const pending = new PendingFiller({ decide, emit: text => spoken.push(text), observe: detail => attempts.push(detail),
    now: () => now, setTimer: (callback, delay) => { timer = { callback, at: now + delay }; }, clearTimer: () => { timer = null; } });
  return { pending, spoken, attempts, next: async () => { const current = timer; timer = null; now = current.at; await current.callback(); }, get at() { return timer?.at; } };
}
test('silent decision is reassessed at actual 2/5/9 seconds and emits at most once', async () => {
  const calls = [];
  const h = harness(async state => { calls.push(state); return { text: state.attempt === 3 ? '少し待ってね。' : '' }; });
  for (const at of [2000, 5000, 9000]) { assert.equal(h.at, at); await h.next(); }
  assert.deepEqual(calls.map(v => v.waitingMs), [2000, 5000, 9000]);
  assert.deepEqual(h.spoken, ['少し待ってね。']); assert.equal(h.at, undefined);
});
test('answer/cancellation during a retry prevents any late speech or further decisions', async () => {
  let resolve; const h = harness(state => state.attempt === 1 ? { text: '' } : new Promise(done => { resolve = done; }));
  await h.next(); const running = h.next(); h.pending.stop(); resolve({ text: '遅い結果' }); await running;
  assert.deepEqual(h.spoken, []); assert.equal(h.at, undefined);
});
test('failed decisions retry within the bounded budget and never force a filler', async () => {
  const h = harness(async () => { throw Error('timeout'); });
  await h.next(); await h.next(); await h.next();
  assert.equal(h.attempts.length, 3); assert.equal(h.at, undefined); assert.deepEqual(h.spoken, []);
});
test('elapsed wait and observed search are passed to the model; recent normalized repeats cannot be selected', async () => {
  let calls = 0;
  const client = { ask: async (state, questions) => {
    calls++;
    assert.equal(state.runtime.waitingSeconds, 5.3);
    assert.equal(state.runtime.previouslySilent, true);
    assert.deepEqual(state.runtime.observedActions, ['web_search_started']);
    assert.equal(questions.filler.criteria.phrase_0, '少し時間をちょうだい。');
    assert.equal(Object.values(questions.filler.criteria).includes('少し考えるね！'), false);
    return { needed: { type: 'noul', noul: .8 }, filler: { type: 'choice', choice: 'phrase_0', probabilities: { phrase_0: .8 } } };
  } };
  const result = await decideFiller(client, '今日の名古屋のニュース', { waitingMs: 5300, attempt: 2, observedActions: ['web_search_started', 'invented'], recentFillers: ['少し考えるね。'], candidates: ['少し考えるね！', '少し時間をちょうだい。'] });
  assert.equal(result.text, '少し時間をちょうだい。');
  assert.equal((await decideFiller(client, 'ニュース', { candidates: ['少し考えるね！'], recentFillers: ['少し考えるね。'] })).reason, 'no_fresh_candidates');
  assert.equal(calls, 1);
});
