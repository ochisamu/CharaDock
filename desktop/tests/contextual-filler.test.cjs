// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fillerCandidates, decideFiller } = require('../lib/contextual-filler.cjs');
const answer = (choice, needed = .9) => ({ needed: { type: 'noul', noul: needed }, filler: { type: 'choice', choice, probabilities: { [choice]: .4 } } });
const source = fs.readFileSync(require.resolve('../main.cjs'), 'utf8');
const characters = vm.runInNewContext(source.slice(source.indexOf('const CHARACTERS ='), source.indexOf('let projectRoot =')) + ';CHARACTERS');

test('all built-ins in both languages and new characters retain a broad contextual vocabulary', () => {
  for (const character of [...characters, { id: 'custom', thinkingFillers: ['ほう、興味深いのう。'], personality: '古風な学者' }, {}]) {
    for (const language of ['ja', 'en']) {
      const localized = { ...character, ...(character.locales?.[language] || {}) };
      const phrases = fillerCandidates(localized, { language });
      assert.ok(phrases.length >= 14 && phrases.length <= 32);
      assert.ok(phrases.some(text => language === 'ja' ? text === 'それは悩むね。' : text === 'That sounds difficult.'));
      assert.ok(phrases.some(text => language === 'ja' ? text === 'それはうれしいね。' : text === "That's lovely to hear."));
    }
  }
});

test('model receives effective persona, context and repetition evidence; no lexical intent routing', async () => {
  const character = { id: 'new-character', name: '先生', personality: '古風で穏やか', director: { speechStyle: '語尾はのう', relationship: '対等な友人' }, thinkingFillers: ['ほう、興味深いのう。'] };
  const recentFillers = ['前のひとことじゃ。'];
  const client = { ask: async (state, questions, timeout) => {
    assert.equal(timeout, 900);
    assert.equal(state.character.speechStyle, '語尾はのう');
    assert.equal(state.character.personality, character.personality);
    assert.equal(state.previousReply, '今日はどうだった？');
    assert.deepEqual(state.recentFillers, recentFillers);
    assert.deepEqual(state.runtime.observedActions, []);
    assert.equal(questions.filler.criteria.phrase_0, character.thinkingFillers[0]);
    assert.ok(questions.filler.criteria.none);
    // The model chooses fresh character-authored wording.
    return answer('phrase_0');
  } };
  assert.equal((await decideFiller(client, 'ありがとう', { character, previousReply: '今日はどうだった？', recentFillers })).text, character.thinkingFillers[0]);
});

test('model-selected contextual wording is authoritative, including silence and arbitrary imported phrases', async () => {
  const candidates = ['うん、聞いているよ。', 'それはうれしいね。', '一緒に考えよう。', '確認は完了したよ。'];
  for (const selected of ['phrase_0', 'phrase_1', 'phrase_2', 'none', 'unknown']) {
    const result = await decideFiller({ ask: async () => answer(selected) }, '同じ入力', { candidates });
    assert.equal(result.text, ['phrase_0', 'phrase_1', 'phrase_2'].includes(selected) ? candidates[Number(selected.slice(7))] : '');
  }
  const rejectUnsafe = { ask: async (_state, questions) => {
    // Unsafe claims are judged semantically by the model, not a keyword list.
    assert.equal(questions.filler.criteria.phrase_3, candidates[3]);
    assert.match(questions.filler.instructions, /Never claim completion/);
    return answer('none');
  } };
  assert.equal((await decideFiller(rejectUnsafe, '調べて', { candidates })).text, '');
});

test('invalid or low-confidence model responses stay silent; malformed candidate data is bounded', async () => {
  const phrases = fillerCandidates({ thinkingFillers: [null, {}, 42, 'x'.repeat(81), '<tool>', 'a\nb', 'https://example.com', 'それはすてきだね。'] });
  assert.equal(phrases[0], 'それはすてきだね。');
  for (const response of [null, {}, answer('phrase_0', .69), answer('phrase_0', NaN), answer('phrase_0', 1.1), { ...answer('phrase_0'), filler: { type: 'choice', choice: 'phrase_0', probabilities: {} } }]) {
    assert.equal((await decideFiller({ ask: async () => response }, '相談', { candidates: ['考えてみるね。'] })).text, '');
  }
  assert.equal((await decideFiller({ ask: () => assert.fail('no valid candidates') }, '相談', { candidates: [] })).text, '');
});

test('shared Chat runtime supplies effective character and does not gate filler by greeting regex', () => {
  const block = source.slice(source.indexOf('  let thinkingFiller = null;'), source.indexOf('  const stopThinkingFiller ='));
  assert.doesNotMatch(block, /fastSocialTurn|safeFillerCandidates|Math.random/);
  assert.match(block, /previousReply, character, language/);
  assert.match(block, /recentFillers: recentThinkingFillers/);
  assert.match(block, /interfaceLanguage\(\) === language/);
});
