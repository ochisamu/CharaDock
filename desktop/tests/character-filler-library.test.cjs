// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CharacterFillerLibrary, validateVocabulary, FUNCTIONS } = require('../lib/character-filler-library.cjs');
const { fillerCandidates } = require('../lib/contextual-filler.cjs');
const vocabulary = label => Object.fromEntries(FUNCTIONS.map(name => [name, [`${label}-${name}-a`, `${label}-${name}-b`]]));
const profile = { id: 'custom', language: 'ja', name: '先生', personality: '古風', persona: '語尾はのう', examples: [] };
function setup(t, generate, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filler-library-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'library.json');
  return { file, library: new CharacterFillerLibrary({ file, generate, ...options }) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('generated vocabulary persists across restart, excludes common stock and is scoped to exact identity/language', async t => {
  let count = 0;
  const { file, library } = setup(t, async () => { count++; return vocabulary('generated'); });
  assert.deepEqual(library.get(profile), []);
  const values = await library.ensure(profile);
  assert.equal(values.length, 12);
  const restarted = new CharacterFillerLibrary({ file, generate: () => assert.fail('cached') });
  assert.deepEqual(await restarted.ensure(profile), values);
  assert.deepEqual(fillerCandidates({ thinkingFillers: ['固定文'] }, { generated: values }), values);
  for (const change of [{ language: 'en' }, { id: 'other' }, { persona: '敬語で話す' }, { name: '別名' }, { examples: ['新しい口調'] }]) {
    assert.deepEqual(restarted.get({ ...profile, ...change }), []);
  }
  assert.equal(count, 1);
});

test('in-flight work is deduplicated and stale edits/deletions never publish', async t => {
  const pending = [];
  const { library } = setup(t, p => new Promise(resolve => pending.push({ p, resolve })));
  const first = library.ensure(profile);
  assert.equal(library.ensure(profile), first);
  await tick();
  const updated = { ...profile, persona: '関西弁' };
  const next = library.ensure(updated);
  pending[0].resolve(vocabulary('old')); await first; await tick();
  assert.deepEqual(library.get(profile), []);
  assert.equal(pending[1].p.persona, '関西弁');
  pending[1].resolve(vocabulary('new')); await next;
  assert.ok(library.get(updated)[0].startsWith('new'));
  const another = library.ensure({ ...updated, persona: 'さらに変更' }); await tick();
  library.remove(profile.id); pending[2].resolve(vocabulary('removed')); await another;
  assert.deepEqual(library.get(updated), []);
});

test('rapid A/B/A changes publish only the latest job even when the identity returns to its original value', async t => {
  const pending = [];
  const { library } = setup(t, () => new Promise(resolve => pending.push(resolve)));
  const a = library.ensure(profile); await tick();
  const b = library.ensure({ ...profile, persona: '別の口調' });
  const a2 = library.ensure(profile);
  pending[0](vocabulary('stale')); await a; await b; await tick();
  assert.deepEqual(library.get(profile), []);
  pending[1](vocabulary('latest')); await a2;
  assert.ok(library.get(profile)[0].startsWith('latest'));
});

test('generation failure backs off without blocking callers, then retries; closing discards late results', async t => {
  let now = 0, count = 0;
  const { library } = setup(t, async () => { count++; return count === 1 ? 'invalid' : vocabulary('ok'); }, { now: () => now, retryMs: 100 });
  assert.deepEqual(await library.ensure(profile), []);
  await library.ensure(profile); assert.equal(count, 1);
  now = 101; assert.equal((await library.ensure(profile)).length, 12);
  let resolve;
  const closed = setup(t, () => new Promise(done => { resolve = done; })).library;
  const job = closed.ensure(profile); await tick(); closed.close(); resolve(vocabulary('late')); await job;
  assert.deepEqual(closed.get(profile), []);
});

test('invalid, duplicate or incomplete generated data and corrupt persisted records are ignored', async t => {
  for (const value of ['not JSON', [], {}, { ...vocabulary('ok'), empathy: ['single'] }, { ...vocabulary('ok'), interest: ['duplicate', 'duplicate'] }, { ...vocabulary('ok'), reflection: ['<tool>', 'https://example.com'] }]) assert.equal(validateVocabulary(value), null);
  const { file } = setup(t, async () => vocabulary('ok'));
  fs.writeFileSync(file, '{broken');
  const library = new CharacterFillerLibrary({ file, generate: async () => vocabulary('repaired') });
  assert.equal((await library.ensure(profile)).length, 12);
});


test('unwritable cache does not publish an unsaved library or retry on every state broadcast', async t => {
  let now = 0, calls = 0;
  const { library } = setup(t, async () => { calls++; return vocabulary('ok'); }, { now: () => now, retryMs: 100 });
  const save = library.save.bind(library);
  library.save = () => { throw Error('disk unavailable'); };
  assert.deepEqual(await library.ensure(profile), []);
  assert.deepEqual(library.get(profile), []);
  await library.ensure(profile); assert.equal(calls, 1);
  library.save = save; now = 101;
  assert.equal((await library.ensure(profile)).length, 12);
});

test('different characters generate serially and retain separate persisted vocabularies', async t => {
  const pending = [];
  const { library } = setup(t, p => new Promise(resolve => pending.push({ p, resolve })));
  const first = library.ensure(profile), other = { ...profile, id: 'other', language: 'en' };
  const second = library.ensure(other); await tick();
  assert.equal(pending.length, 1);
  pending[0].resolve(vocabulary('first')); await first; await tick();
  assert.equal(pending.length, 2);
  pending[1].resolve(vocabulary('second')); await second;
  assert.ok(library.get(profile)[0].startsWith('first'));
  assert.ok(library.get(other)[0].startsWith('second'));
});
