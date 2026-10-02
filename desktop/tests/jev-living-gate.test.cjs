// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JevAddressGate } = require('../lib/jev-address-gate.cjs');
const { JevClient } = require('../lib/jev-client.cjs');

function setup() {
  const state = { mode: 'living', enabled: true, context: 'kohaku', name: 'コハク', time: 0, result: 'addressed', calls: [] };
  const gate = new JevAddressGate({ mode: () => state.mode, enabled: () => state.enabled,
    context: () => state.context, now: () => state.time,
    classify: async (text, options) => { state.calls.push({ text, options }); return state.result; } });
  const check = (text, source = 'rlcd42') => gate.check(text, { handsfree: true, source });
  return { state, gate, check };
}

test('household speech classified unrelated or uncertain cannot start a conversation', async () => {
  const { state, check } = setup();
  for (const result of ['unrelated', 'uncertain', 'non_speech', 'unclear_speech']) {
    state.result = result;
    for (const text of ['ご飯できた？', 'テレビ消して', '明日は何時に出る？', 'はい', 'フッ', 'コハクの絵がかわいい']) {
      assert.deepEqual(await check(text), { accepted: false, reason: result });
    }
  }
  assert.equal(state.calls.length, 24);
});
test('natural questions and greetings do not require any character name', async () => {
  const { state, check } = setup();
  for (const context of ['kohaku', 'nike', 'custom-character']) {
    state.context = context;
    for (const text of ['今日のニュースを教えて', '旅行の計画を一緒に考えて']) {
      state.result = 'addressed'; assert.equal((await check(text)).accepted, true);
    }
    state.result = 'greeting'; assert.equal((await check('こんにちは')).accepted, true);
  }
});
test('quotation/noise/uncertainty cannot arm followups even if a name is present', async () => {
  const { state, gate, check } = setup();
  for (const result of ['unrelated', 'uncertain', 'non_speech', 'unclear_speech', null, 'reply']) {
    state.result = result; assert.equal((await check('コハク、こんにちは')).accepted, false);
    gate.remember('他の会話の回答');
    state.result = 'reply'; assert.equal((await check('はい')).accepted, false);
  }
  state.result = 'greeting'; assert.equal((await check('コハク、こんにちは')).accepted, true);
});
test('only admitted input gains a 15-second semantic followup window', async () => {
  const { state, gate, check } = setup();
  assert.equal((await check('コハク、傘いるかな')).accepted, true);
  gate.remember('雨の予報です。折りたたみ傘にしますか？', { userText: 'コハク、傘いるかな' });
  state.result = 'reply';
  assert.equal((await check('はい')).accepted, true);
  assert.match(state.calls.at(-1).options.previousReply, /折りたたみ傘/);
  assert.equal((await check('はい', 'desktop')).accepted, false);
  assert.equal((await check('はい', 'atom-echo')).accepted, false);
  state.time = 15000; assert.equal((await check('はい')).accepted, false);
});
test('unrelated and uncertain household speech cannot extend the reply window', async () => {
  const { state, gate, check } = setup();
  await check('コハク、天気を教えて'); gate.remember('雨の予報です。', { userText: 'コハク、天気を教えて' });
  for (const result of ['uncertain', 'unrelated', 'non_speech', 'unclear_speech']) {
    state.time += 2000; state.result = result;
    assert.equal((await check('テレビ消して')).accepted, false);
  }
  state.time = 15000; state.result = 'reply';
  assert.equal((await check('その予報について教えて')).accepted, false);
});
test('manual input and other character answers never wake an unattended device', async () => {
  const { state, gate, check } = setup();
  await gate.check('コハク、天気を教えて', { source: 'rlcd42' });
  gate.remember('傘を持ちますか？'); state.result = 'reply';
  assert.equal((await check('はい')).accepted, false);
  state.result = 'addressed'; await check('コハク、こんにちは');
  state.context = 'towa'; state.name = 'トワ'; gate.remember('こんにちは');
  state.result = 'reply';
  assert.equal((await check('はい')).accepted, false);
  state.context = 'kohaku'; state.name = 'コハク';
  assert.equal((await check('はい')).accepted, false);
});
test('late answers cannot open a new window, while timely answers refresh it', async () => {
  const { state, gate, check } = setup();
  await check('コハク、教えて'); state.time = 180000; gate.remember('どうしますか？', { userText: 'コハク、教えて' });
  state.result = 'reply'; assert.equal((await check('はい')).accepted, false);
  state.result = 'addressed'; await check('コハク、教えて'); gate.remember('どうしますか？', { userText: 'コハク、教えて' });
  state.result = 'reply'; state.time += 10000; await check('はい');
  gate.remember('他も調べますか？', { userText: 'はい' }); state.time += 10000;
  assert.equal((await check('いいえ')).accepted, true);
});
test('settings reset invalidates pending classification and remembered windows', async () => {
  const { gate, check } = setup(); let resolve;
  gate.classify = () => new Promise(r => { resolve = r; });
  const pending = check('コハク、こんにちは');
  gate.reset(); resolve('addressed');
  assert.equal((await pending).reason, 'stale');
  gate.classify = async () => 'reply';
  gate.remember('どうしますか？'); assert.equal((await check('はい')).accepted, false);
});
test('Jev failure does not arm the device; manual PTT still bypasses without a key', async () => {
  const { state, gate, check } = setup();
  gate.classify = async () => { throw Error('synthetic failure'); };
  assert.equal((await check('コハク、こんにちは')).reason, 'unavailable');
  gate.remember('こんにちは'); gate.classify = async () => 'reply'; assert.equal((await check('はい')).accepted, false);
  state.enabled = false;
  assert.equal((await gate.check('普通の質問', { handsfree: false })).accepted, true);
  assert.equal((await check('コハク、こんにちは')).accepted, false);
});
test('living prompt is name-free but requires 92 percent confidence', async () => {
  let score = .85, request;
  const client = new JevClient({ getApiKey: () => 'synthetic', fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, text: async () => JSON.stringify({ answers: {
      communicative: { type: 'choice', choice: 'speech', probabilities: { speech: .99 } },
      recipient: { type: 'choice', choice: 'greeting', probabilities: { greeting: score } },
    } }) };
  } });
  const options = { mode: 'living', character: 'コハク', previousReply: '' };
  assert.equal(await client.address('コハク、こんにちは', options), 'uncertain');
  score = .92; assert.equal(await client.address('コハク、こんにちは', options), 'greeting');
  assert.match(request.questions.recipient.instructions, /household ambient listening/);
  assert.match(request.questions.recipient.instructions, /bare はい\/うん is uncertain/);
  assert.match(request.questions.recipient.instructions, /No wake word or character name is required/);
  assert.doesNotMatch(request.questions.recipient.instructions, /does NOT require the character name/);
  assert.equal(Object.hasOwn(request.state, 'directCall'), false);
});
test('an unrelated manual answer cannot arm a previously admitted but failed device turn', async () => {
  const { state, gate, check } = setup();
  await check('今日のニュースを教えて');
  gate.remember('どこに行きますか？', { userText: '旅行の計画を立てて' });
  state.result = 'reply'; assert.equal((await check('はい')).accepted, false);
});
test('specific replies use a lower threshold only with recent reply context', async () => {
  let score = .83;
  const client = new JevClient({ getApiKey: () => 'synthetic', fetchImpl: async () => ({
    ok: true, text: async () => JSON.stringify({ answers: {
      communicative: { type: 'choice', choice: 'speech', probabilities: { speech: .99 } },
      recipient: { type: 'choice', choice: 'reply', probabilities: { reply: score } },
    } }),
  }) });
  assert.equal(await client.address('はい', { mode: 'living', previousReply: '傘にしますか？' }), 'reply');
  assert.equal(await client.address('はい', { mode: 'living', previousReply: '' }), 'uncertain');
  score = .79;
  assert.equal(await client.address('はい', { mode: 'living', previousReply: '傘にしますか？' }), 'uncertain');
});
test('PC, ATOM Echo and RLCD keep the same post-ASR admission; VAD module stays independent', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /jevAddressGate\.check\(message, \{ handsfree: capture.handsfree, source: deviceKind \}\)/);
  assert.match(main, /jevAddressGate\.check\(text, \{ handsfree: true, source: "desktop" \}\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../lib/device-speech-gate.cjs'), 'utf8'), /Jev/);
});
