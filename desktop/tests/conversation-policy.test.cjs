// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { isFastSocialTurn, fastReasoningEffort, decideFiller, safeFillerCandidates, PendingFiller } = require('../lib/turn-policy.cjs');
const { saveCharacterMemory, activeCharacterMemories, removeCharacterMemory, normalizeCharacterMemories } = require('../lib/character-memory.cjs');
const { selectStartupTopic, markStartupOffered, COOLDOWN_MS } = require('../lib/startup-topic.cjs');

test('only standalone social turns reduce reasoning; confirmations and tool requests retain it', () => {
  for (const text of ['こんにちは', 'ありがとう！', 'お疲れさまです']) assert.equal(isFastSocialTurn(text), true);
  for (const text of ['うん', '了解', 'ありがとう、はい', 'ありがとう。次は修正して', 'こんにちは、原因を考えて']) assert.equal(isFastSocialTurn(text), false);
  assert.equal(isFastSocialTurn('ありがとう', { previousReply: 'このファイルを削除する？' }), false);
  assert.equal(isFastSocialTurn('ありがとう', { previousReply: '削除する？確認を待つよ。' }), false);
  assert.equal(isFastSocialTurn('こんにちは', { hasAttachments: true }), false);
  assert.equal(isFastSocialTurn('こんにちは', { hasTools: true }), false);
  assert.equal(fastReasoningEffort('gpt-6-astra'), 'low');
  assert.equal(fastReasoningEffort('gpt-6.1-sol'), 'low');
  assert.equal(fastReasoningEffort('gpt-6-luna'), 'none');
  assert.equal(fastReasoningEffort('custom'), undefined);
  assert.equal(fastReasoningEffort('gpt-6-luna', [{ reasoningEffort: 'low' }]), 'low');
  assert.equal(fastReasoningEffort('custom', ['medium']), undefined);
});

test('filler uses only supplied neutral phrases and high-confidence decisions', async () => {
  const candidates = safeFillerCandidates(['少し考えるね。', '少し考えるね。', 'もう少しだけ待ってね。', '確認しているよ。', 'Almost there.', 'Give me a moment.']);
  assert.deepEqual(candidates, ['少し考えるね。', 'Give me a moment.']);
  let probability = .9, selected = 'phrase_0';
  const client = { ask: async (_state, questions, timeout) => {
    assert.equal(timeout, 900); assert.equal(questions.needed.type, 'noul');
    return { needed: { type: 'noul', noul: probability }, filler: { type: 'choice', choice: selected, probabilities: { [selected]: .5 } } };
  } };
  assert.equal((await decideFiller(client, '相談', { candidates })).text, candidates[0]);
  probability = .5; assert.equal((await decideFiller(client, '相談', { candidates })).text, '');
  selected = 'invented'; probability = 1; assert.equal((await decideFiller(client, '相談', { candidates })).text, '');
});

test('filler loses races to answers, cancellation, changed turns and rejected decisions', async () => {
  for (const event of ['answer', 'cancel', 'changed', 'failure', 'speak']) {
    let callback, resolve, reject, current = true; const spoken = [];
    const decision = new Promise((yes, no) => { resolve = yes; reject = no; });
    const filler = new PendingFiller({ decision, emit: text => spoken.push(text), isCurrent: () => current,
      setTimer: cb => { callback = cb; }, clearTimer: () => {} });
    const running = callback();
    if (event === 'answer' || event === 'cancel') filler.stop();
    if (event === 'changed') current = false;
    if (event === 'failure') reject(Error('unavailable')); else resolve({ text: '少し考えるね。' });
    await running;
    assert.deepEqual(spoken, event === 'speak' ? ['少し考えるね。'] : []);
  }
});

test('recent topics have separate capacity and expire without evicting durable facts', () => {
  const now = new Date('2026-10-12T00:00:00Z'); let memories = {};
  for (let i = 0; i < 24; i++) memories = saveCharacterMemory(memories, 'a', { content: `好みの記録${i}`, category: 'preference' }, now).memoriesByCharacter;
  for (let i = 0; i < 12; i++) memories = saveCharacterMemory(memories, 'a', { content: `最近読んだ本${i}`, category: 'recent' }, now).memoriesByCharacter;
  assert.equal(normalizeCharacterMemories(memories).a.length, 32);
  assert.equal(activeCharacterMemories(memories, 'a', now.getTime()).length, 32);
  assert.equal(activeCharacterMemories(memories, 'a', now.getTime() + 15 * 86400000).length, 24);
  assert.equal(activeCharacterMemories(memories, 'b', now.getTime()).length, 0);
});

test('startup topics are scoped, grounded, deduplicated across launches and forgettable', () => {
  const now = Date.parse('2026-10-12T00:00:00Z');
  const saved = saveCharacterMemory({}, 'a', { content: '最近将棋を始めた', category: 'recent' }, new Date(now));
  const input = { characterId: 'a', scopeKey: 'home', memories: saved.memoriesByCharacter, now };
  const topic = selectStartupTopic(input);
  assert.equal(topic.kind, 'memory'); assert.equal(topic.summary.nextStep, saved.record.content);
  const offers = markStartupOffered({}, topic, now);
  assert.equal(selectStartupTopic({ ...input, offers, now: now + 1000 }), null);
  assert.ok(selectStartupTopic({ ...input, offers, now: now + COOLDOWN_MS }));
  assert.equal(selectStartupTopic({ ...input, characterId: 'b' }), null);
  assert.equal(selectStartupTopic({ ...input, memories: removeCharacterMemory(saved.memoriesByCharacter, 'a', saved.record.id) }), null);
  assert.equal(selectStartupTopic({ ...input, now: now + 15 * 86400000 }), null);
});
