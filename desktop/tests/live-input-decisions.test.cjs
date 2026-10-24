// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveInputDecisions } = require('../lib/live-input-decisions.cjs');
const { JevMediaGate } = require('../lib/jev-media-gate.cjs');
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture({ classify = async () => 'next' } = {}) {
  const calls = { expressions: [], classified: [], executed: [], receipts: [], cancelled: 0 };
  let active = true, enabled = true, now = 1000;
  const media = new JevMediaGate({
    enabled: () => active,
    classify: text => { calls.classified.push(text); return classify(text); },
    execute: async (args, key) => { calls.executed.push({ args, key }); return { ok: true, accepted: true }; },
  });
  const input = new LiveInputDecisions({ media, active: () => active, expressionEnabled: () => enabled,
    expression: (text, options) => calls.expressions.push({ text, ...options }),
    cancelExpression: () => calls.cancelled++,
    onReceipt: result => calls.receipts.push(result), now: () => now,
  });
  return { input, media, calls, disable: () => { enabled = false; }, deactivate: () => { active = false; }, advance: () => { now += 700; } };
}
test('listening reacts before final input without operating music', async t => {
  const f = fixture(); t.after(() => f.input.close());
  f.input.delta('仕事で失敗してしまって、');
  assert.equal(f.calls.expressions.length, 0);
  f.input.delta('とても落ち込んでいます。');
  assert.equal(f.calls.expressions.length, 1);
  assert.equal(f.calls.expressions[0].source, 'user');
  assert.equal(f.calls.classified.length, 0);
  assert.equal(f.calls.executed.length, 0);
});
test('final negation is authoritative even after a partial music command', async t => {
  const f = fixture({ classify: async text => text === '音楽は止めないで' ? null : 'pause' }); t.after(() => f.input.close());
  f.input.delta('音楽を止め');
  assert.equal(f.calls.classified.length, 0);
  f.input.finish('音楽は止めないで'); await f.input.input.completion;
  assert.deepEqual(f.calls.classified, ['音楽は止めないで']);
  assert.equal(f.calls.executed.length, 0);
});
test('duplicate final and native handoff share exactly one execution and receipt', async t => {
  const pending = deferred(); const f = fixture({ classify: () => pending.promise }); t.after(() => f.input.close());
  f.input.delta('次の曲にして'); f.media.bind('turn1');
  assert.equal(f.input.finish('次の曲にして'), true);
  assert.equal(f.input.finish('次の曲にして'), false);
  const native = f.media.tool({ action: 'next' }, 'turn1', () => assert.fail('duplicate'));
  pending.resolve('next'); await Promise.all([native, f.input.input.completion]);
  assert.equal(f.calls.classified.length, 1); assert.equal(f.calls.executed.length, 1); assert.equal(f.calls.receipts.length, 1);
});
test('new deltas permit a second intentional identical command', async t => {
  const f = fixture(); t.after(() => f.input.close());
  for (let i = 0; i < 2; i++) {
    f.input.delta('次の曲にして'); assert.equal(f.input.finish('次の曲にして'), true); await f.input.input.completion;
  }
  assert.equal(f.calls.executed.length, 2);
  assert.notEqual(f.calls.executed[0].key, f.calls.executed[1].key);
});
test('an assistant cue takes precedence over a delayed final listener cue', t => {
  const f = fixture(); t.after(() => f.input.close());
  f.input.delta('今日は'); f.input.assistantCue();
  f.input.finish('今日はすごくうれしいことがありました。');
  assert.equal(f.calls.expressions.length, 0);
  f.input.delta('大丈夫、もう元気になったよ。');
  assert.equal(f.calls.expressions.length, 1);
});
test('ASR correction classifies the revised phrase rather than an old cursor', async t => {
  const f = fixture(); t.after(() => f.input.close());
  f.input.delta('大丈夫、失敗しても私は味方だよ。');
  f.advance(); f.input.finish('うれしい知らせです。一緒にお祝いしよう。'); await f.input.input.completion;
  assert.equal(f.calls.expressions.at(-1).text, 'うれしい知らせです。一緒にお祝いしよう。');
});
test('closing while classification runs prevents operation and late receipt', async () => {
  const pending = deferred(); const f = fixture({ classify: () => pending.promise });
  f.input.delta('次の曲にして'); f.input.finish('次の曲にして'); const completed = f.input.input.completion;
  f.input.close(); pending.resolve('next'); await completed;
  assert.equal(f.calls.executed.length, 0); assert.equal(f.calls.receipts.length, 0);
  f.input.delta('hello'); assert.equal(f.input.finish('next'), false);
});
test('changing the active session prevents a delayed media operation', async t => {
  const pending = deferred(); const f = fixture({ classify: () => pending.promise }); t.after(() => f.input.close());
  f.input.delta('次の曲にして'); f.input.finish('次の曲にして'); const completed = f.input.input.completion;
  f.deactivate(); pending.resolve('next'); await completed;
  assert.equal(f.calls.executed.length, 0); assert.equal(f.calls.receipts.length, 0);
});
test('disabled expressions and empty final input do not call auxiliary models', async t => {
  const f = fixture(); t.after(() => f.input.close()); f.disable();
  assert.equal(f.input.finish(''), false);
  assert.equal(f.calls.cancelled, 0);
  f.input.delta('やった、うまくいったね。'); f.input.finish(''); await f.input.input.completion;
  assert.equal(f.calls.expressions.length, 0); assert.equal(f.calls.classified.length, 0);
});
test('streaming expression decisions stay bounded during a long utterance', t => {
  const f = fixture(); t.after(() => f.input.close());
  for (let i = 0; i < 100; i++) { f.advance(); f.input.delta('今日はとてもうれしいことがありました。'); }
  assert.ok(f.calls.expressions.length > 0 && f.calls.expressions.length <= 5);
  assert.equal(f.calls.classified.length, 0);
});
