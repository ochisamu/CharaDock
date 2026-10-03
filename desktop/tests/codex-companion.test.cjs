// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { CodexCompanion, reduceRecord, initialSnapshot, chooseAutomatic } = require('../lib/codex-companion.cjs');
const record = (type, extra = {}) => ({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type, ...extra } });
const line = r => JSON.stringify(r) + '\n';
async function fixture(t, records) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'charadock-companion-test-'));
  const file = path.join(root, 'rollout-test.jsonl');
  await fs.writeFile(file, line({ type: 'session_meta', payload: { id: 'test-thread', originator: 'Codex Desktop', source: 'vscode', cwd: '/test/project', base_instructions: 'PRIVATE' } }) + records.map(line).join(''));
  const observer = new CodexCompanion({ root });
  t.after(async () => { observer.stop(false); await fs.rm(root, { recursive: true, force: true }); });
  const entries = await observer.list();
  return { root, file, observer, entries };
}
test('reducer separates commentary, final answer, completion and ignores secrets', () => {
  let s = reduceRecord(initialSnapshot(), record('task_started', { turn_id: 't1' }));
  assert.equal(s.status, 'running');
  s = reduceRecord(s, { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: '調べています' }] } });
  assert.equal(s.activity, '調べています'); assert.equal(s.result, '');
  for (const type of ['reasoning', 'custom_tool_call_output']) {
    assert.equal(reduceRecord(s, { type: 'response_item', payload: { type, output: 'SECRET' } }), s);
  }
  s = reduceRecord(s, record('item_completed', { turn_id: 't1', item: { type: 'CommandExecution', command: 'SECRET', stdout: 'SECRET' } }));
  assert.equal(s.activity, 'コマンドを実行しています'); assert.ok(!JSON.stringify(s).includes('SECRET'));
  s = reduceRecord(s, record('item_completed', { turn_id: 't1', item: { type: 'AgentMessage', phase: 'final_answer', content: '完了した結果' } }));
  assert.equal(s.result, '完了した結果'); assert.equal(s.status, 'running');
  s = reduceRecord(s, record('task_complete', { turn_id: 't1', last_agent_message: '最終回答' }));
  assert.equal(s.status, 'completed'); assert.equal(s.result, '最終回答');
});
test('assistant progress after an input request releases the input-wait priority', () => {
  let s = reduceRecord({ ...initialSnapshot(), status: 'unknown' }, record('item_completed', { item: { type: 'function_call', name: 'request_user_input' } }));
  assert.equal(s.status, 'needs-input');
  s = reduceRecord(s, record('item_completed', { item: { type: 'AgentMessage', phase: 'commentary', content: '続けます' } }));
  assert.equal(s.status, 'running');
});
test('unknown phases never become a result; stale turn completions cannot end a new turn', () => {
  let s = reduceRecord(initialSnapshot(), record('task_started', { turn_id: 'new' }));
  const old = record('task_complete', { turn_id: 'old', last_agent_message: '古い回答' });
  assert.equal(reduceRecord(s, old), s);
  assert.equal(reduceRecord(s, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'UNKNOWN' }] } }), s);
  s = reduceRecord(s, record('turn_aborted', { turn_id: 'new' })); assert.equal(s.status, 'interrupted');
});
test('list reads metadata only, start reads a selected thread, no file changes', async t => {
  const { file, observer, entries } = await fixture(t, [record('task_started', { turn_id: 't1' }), record('task_complete', { turn_id: 't1', last_agent_message: '回答です' })]);
  const before = await fs.readFile(file);
  assert.equal(entries[0].source, 'Codex Desktop'); assert.ok(!JSON.stringify(entries).includes('PRIVATE'));
  assert.equal(observer.snapshot().enabled, false);
  await assert.rejects(observer.start(file)); // arbitrary paths cannot select a file
  const s = await observer.start(entries[0].key);
  assert.equal(s.status, 'completed'); assert.equal(s.result, '回答です');
  assert.deepEqual(await fs.readFile(file), before);
});
test('partial UTF-8 record is buffered and applied once after newline', async t => {
  const { file, observer, entries } = await fixture(t, [record('task_started', { turn_id: 't1' })]);
  await observer.start(entries[0].key);
  const b = Buffer.from(line(record('task_complete', { turn_id: 't1', last_agent_message: '日本語です' })));
  const split = b.indexOf(Buffer.from('日本語')) + 1;
  await fs.appendFile(file, b.subarray(0, split)); await observer.poll();
  assert.equal(observer.snapshot().status, 'running');
  await fs.appendFile(file, b.subarray(split)); await observer.poll();
  assert.equal(observer.snapshot().result, '日本語です');
  const count = observer.snapshot().events.length; await observer.poll(); assert.equal(observer.snapshot().events.length, count);
});
test('new turn clears result; truncate reloads; missing log is not completion', async t => {
  const { file, observer, entries } = await fixture(t, [record('task_complete', { last_agent_message: '以前の回答' })]);
  await observer.start(entries[0].key);
  await fs.appendFile(file, line(record('task_started', { turn_id: 't2' }))); await observer.poll();
  assert.equal(observer.snapshot().result, '');
  await fs.writeFile(file, line(record('turn_aborted', { turn_id: 't3' }))); await observer.poll();
  assert.equal(observer.snapshot().status, 'interrupted');
  await fs.unlink(file); await observer.poll(); assert.equal(observer.snapshot().status, 'unknown'); assert.ok(observer.snapshot().error);
});
test('stop clears all watched content; symlink replacement outside root is rejected', async t => {
  const { root, file, observer, entries } = await fixture(t, [record('task_started')]);
  await observer.start(entries[0].key); observer.stop(); await observer.poll();
  assert.equal(observer.snapshot().enabled, false); assert.equal(observer.snapshot().threadId, '');
  const outside = path.join(path.dirname(root), path.basename(root) + '-outside.jsonl');
  t.after(() => fs.rm(outside, { force: true }));
  await fs.writeFile(outside, line(record('task_complete', { last_agent_message: 'SECRET' })));
  await fs.unlink(file); await fs.symlink(outside, file);
  await observer.start(entries[0].key);
  assert.equal(observer.snapshot().status, 'unknown'); assert.ok(!JSON.stringify(observer.snapshot()).includes('SECRET'));
});
test('no updates makes active state uncertain, never completed', async t => {
  const { observer, entries } = await fixture(t, [{ ...record('task_started'), timestamp: '2000-01-01T00:00:00Z' }]);
  await observer.start(entries[0].key); assert.equal(observer.snapshot().stale, true);
  assert.equal(observer.snapshot().status, 'running');
});
test('stop during an in-flight read never resurrects the selected conversation', async t => {
  const { observer, entries } = await fixture(t, [record('task_started', { turn_id: 't1' })]);
  const pending = observer.start(entries[0].key);
  observer.stop(false); await pending;
  assert.equal(observer.snapshot().enabled, false);
  assert.equal(observer.snapshot().threadId, '');
  assert.equal(observer.timer, null);
});
test('unknown log shape remains unknown and event history is bounded', async t => {
  const { observer, entries } = await fixture(t, [{ type: 'unknown', payload: { text: 'PRIVATE' } }]);
  await observer.start(entries[0].key); assert.equal(observer.snapshot().status, 'unknown'); assert.equal(observer.snapshot().result, '');
  let s = initialSnapshot();
  for (let i=0; i<30; i++) s = reduceRecord(s, record('item_completed', { item: { type: 'AgentMessage', phase: 'commentary', content: `進捗${i}` } }));
  assert.equal(s.events.length, 8);
});
test('main and renderer keep Companion read-only and off at restart', async () => {
  const main = await fs.readFile(path.join(__dirname, '../main.cjs'), 'utf8');
  for (const section of ['async function sendChatMessage(', 'async function startCodexRealtimeVoice(', 'async function startRemoteRealtime(']) {
    const code = main.slice(main.indexOf(section), main.indexOf(section)+1600);
    assert.match(code, /assertConversationRole\(\)/);
  }
  assert.match(main, /async function esp32PttStart[^]*codexCompanion.state.enabled \|\| companionTransitioning\) return false/);
  assert.match(main, /suppress: \(\) => codexCompanion.state.enabled/);
  assert.match(main, /companion:start[^]*assertTrustedSender/);
  assert.doesNotMatch(main, /preferences.patch\(\{[^}]*companionEnabled/);
});
test('main activation blocks new conversations while closing Live and honors cancellation', async () => {
  const main = await fs.readFile(path.join(__dirname, '../main.cjs'), 'utf8');
  let closeLive, starts = 0, closures = 0;
  const ctx = vm.createContext({
    companionTransitioning: false, companionActivation: 0,
    codexCompanion: { state: { enabled: false }, files: new Map([['valid', {}]]),
      snapshot() { return { enabled: this.state.enabled }; },
      async start() { starts++; this.state.enabled = true; return this.snapshot(); },
      async select() { return this.snapshot(); } },
    activeWorkRunId: null, activeCodexInteractionClient: () => null,
    openAIClient: { hasActiveTurn: () => false }, atomEchoCapture: null, atomEchoRecognizingCapture: null,
    turnCoordinator: { snapshot: () => ({ status: 'idle' }) },
    stopActiveRealtime: () => { closures++; return new Promise(resolve => { closeLive = resolve; }); },
    invalidateEsp32SpeechInput() {}, jevExpressionDirector: { cancel() {} },
    clearTimeout() {}, mcpPrewarmTimer: null, broadcastAppState() {},
  });
  vm.runInContext(main.slice(main.indexOf('function assertConversationRole()'), main.indexOf('const { PNG }')), ctx);
  await assert.rejects(ctx.startCodexCompanion('invalid'));
  assert.equal(closures, 0);
  const pending = ctx.startCodexCompanion('valid');
  assert.throws(() => ctx.assertConversationRole(), /閲覧専用/);
  ctx.companionActivation++; // companion:stop cancels the pending activation
  closeLive(); await pending;
  assert.equal(starts, 0); assert.equal(ctx.companionTransitioning, false);
  const next = ctx.startCodexCompanion('valid'); closeLive(); await next;
  assert.equal(starts, 1); assert.equal(ctx.codexCompanion.state.enabled, true);
});

test('automatic priority is input, new error/completion, then stable running work', () => {
  const now = Date.now(), started = now - 1000;
  const c = (key, status, age = 0, extra = {}) => ({ key, state: { status, updatedAt: new Date(now-age).toISOString(), ...extra } });
  const a = c('a', 'running', 500), b = c('b', 'running');
  assert.equal(chooseAutomatic([a, b], 'a', started, now).key, 'a');
  const complete = c('done', 'completed');
  assert.equal(chooseAutomatic([a, b, complete], 'a', started, now).key, 'done');
  assert.equal(chooseAutomatic([a, complete, c('input', 'needs-input')], 'a', started, now).key, 'input');
  assert.equal(chooseAutomatic([c('old', 'completed', 2000)], '', started, now), null);
  assert.equal(chooseAutomatic([c('old', 'completed', 40000)], '', now-50000, now), null);
  assert.equal(chooseAutomatic([c('old', 'running', 300000, { stale: true })], '', started, now), null);
  assert.equal(chooseAutomatic([c('a', 'running', 130000, { stale: true })], 'a', started, now).state.stale, true);
});

test('automatic start ignores history, expires completion, retains result only in the PC result panel', async t => {
  let now = Date.now();
  const { file, observer } = await fixture(t, [{ ...record('task_complete', { last_agent_message: '古い回答' }), timestamp: new Date(now-5000).toISOString() }]);
  observer.now = () => now;
  await observer.start();
  assert.equal(observer.snapshot().status, 'idle'); assert.equal(observer.snapshot().result, '');
  assert.equal(observer.snapshot().lastResult, null);
  now += 10;
  await fs.appendFile(file, line({ ...record('task_started', { turn_id: 'new' }), timestamp: new Date(now).toISOString() }));
  await observer.poll(); assert.equal(observer.snapshot().status, 'running');
  now += 10;
  await fs.appendFile(file, line({ ...record('task_complete', { turn_id: 'new', last_agent_message: '新しい回答' }), timestamp: new Date(now).toISOString() }));
  await observer.poll(); assert.equal(observer.snapshot().result, '新しい回答');
  now += 30001; await observer.poll();
  assert.equal(observer.snapshot().status, 'idle'); assert.equal(observer.snapshot().result, '');
  assert.equal(observer.snapshot().lastResult.text, '新しい回答');
  await observer.poll(); assert.equal(observer.snapshot().result, '');
});

test('automatic scope excludes CLI and discovers new Desktop chats without selection', async t => {
  let now = Date.now();
  const { root, file, observer } = await fixture(t, [record('task_started', { turn_id: 'work' })]);
  observer.now = () => now;
  const add = async (name, originator, records) => {
    const target = path.join(root, `rollout-${name}.jsonl`);
    await fs.writeFile(target, line({ type: 'session_meta', payload: { id: name, source: 'vscode', originator, cwd: '/other' } }) + records.map(line).join(''));
    return target;
  };
  await add('cli', 'Codex CLI', [record('task_started'), record('item_completed', { item: { type: 'function_call', name: 'request_user_input' } })]);
  await observer.start(); assert.equal(observer.snapshot().threadId, 'test-thread');
  assert.equal(observer.snapshot().watchedCount, 1);
  const other = await add('desktop', 'Codex Desktop', [record('task_started'), record('item_completed', { item: { type: 'function_call', name: 'request_user_input' } })]);
  now += 5001; await observer.poll();
  assert.equal(observer.snapshot().threadId, 'desktop'); assert.equal(observer.snapshot().status, 'needs-input');
  const key = [...observer.files.values()].find(e => e.threadId === 'test-thread').key;
  await observer.select(key); assert.equal(observer.snapshot().threadId, 'test-thread'); assert.equal(observer.snapshot().watchingMode, 'pinned');
  await observer.select(''); assert.equal(observer.snapshot().threadId, 'desktop');
  await fs.appendFile(other, line(record('turn_aborted'))); await observer.poll();
  assert.equal(observer.snapshot().threadId, 'test-thread');
  await observer.select(key); await fs.unlink(file); await observer.poll();
  assert.equal(observer.snapshot().status, 'unknown'); assert.equal(observer.snapshot().pinnedKey, key);
});

test('automatic mode supports empty scope and cancellation during initial discovery', async t => {
  const { file, observer } = await fixture(t, []);
  await fs.unlink(file);
  await observer.start(); assert.equal(observer.snapshot().enabled, true);
  assert.equal(observer.snapshot().watchedCount, 0); assert.equal(observer.snapshot().status, 'idle');
  observer.stop(false);
  const pending = observer.start(); observer.stop(false); await pending;
  assert.equal(observer.snapshot().enabled, false); assert.equal(observer.timer, null); assert.equal(observer.readers.size, 0);
});

test('automatic monitoring has bounded readers; CLI can only be added by explicit pin', async t => {
  const { root, observer } = await fixture(t, []);
  for (let i=0; i<25; i++) {
    await fs.writeFile(path.join(root, `rollout-${i}.jsonl`), line({ type: 'session_meta', payload: { id: `chat-${i}`, originator: 'Codex Desktop' } }) + line(record('task_started')));
  }
  const cli = path.join(root, 'rollout-cli.jsonl');
  await fs.writeFile(cli, line({ type: 'session_meta', payload: { id: 'cli', originator: 'Codex CLI' } }) + line(record('task_started')));
  await observer.start(); assert.equal(observer.readers.size, 20);
  const key = [...observer.files.values()].find(e => e.threadId === 'cli').key;
  assert.ok(!observer.readers.has(key));
  await observer.select(key); assert.equal(observer.snapshot().threadId, 'cli');
  assert.equal(observer.readers.size, 21);
  await observer.select(''); assert.equal(observer.readers.size, 20);
});

test('automatic state becomes uncertain on stale updates or missing log, not a false success', async t => {
  let now = Date.now();
  const { file, observer } = await fixture(t, [record('task_started')]);
  observer.now = () => now;
  await observer.start(); assert.equal(observer.snapshot().status, 'running');
  now += 120001; await observer.poll(); assert.equal(observer.snapshot().stale, true);
  assert.equal(observer.snapshot().status, 'running');
  await fs.unlink(file); await observer.poll();
  assert.equal(observer.snapshot().status, 'unknown'); assert.ok(observer.snapshot().error);
});

test('automatic read rejects symlink replacement and stop during an in-flight poll', async t => {
  const { root, file, observer } = await fixture(t, [record('task_started')]);
  await observer.start();
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.jsonl`);
  t.after(() => fs.rm(outside, { force: true }));
  await fs.writeFile(outside, line(record('task_complete', { last_agent_message: 'SECRET' })));
  await fs.unlink(file); await fs.symlink(outside, file); await observer.poll();
  assert.ok(!JSON.stringify(observer.snapshot()).includes('SECRET'));
  const pending = observer.poll(); observer.stop(false); await pending;
  assert.equal(observer.snapshot().enabled, false); assert.equal(observer.readers.size, 0);
});

test('actual RLCD Companion snapshot clears history on idle and keeps attention distinct', async () => {
  const main = await fs.readFile(path.join(__dirname, '../main.cjs'), 'utf8');
  let snapshot = { enabled: true, status: 'idle', result: '', lastResult: { text: '以前の結果' } };
  const ctx = vm.createContext({
    rlcd42Profile: () => ({ captionMode: 'auto' }),
    rlcd42Gateway: { status: () => ({ transport: 'wifi' }) },
    codexCompanion: { snapshot: () => snapshot },
    activeCharacter: () => ({ name: 'コハク' }), interfaceLanguage: () => 'ja',
    buildRlcd42Scene: require('../lib/rlcd42-presentation.cjs').buildRlcd42Scene,
  });
  vm.runInContext(main.slice(main.indexOf('function rlcd42SceneSnapshot()'), main.indexOf('function rlcd42PortraitPackForCharacter(')), ctx);
  let s = ctx.rlcd42SceneSnapshot();
  assert.equal(s.state, 'idle'); assert.equal(s.scene, 'home'); assert.equal(s.caption, '');
  assert.equal(s.modeLabel, 'CODEX'); assert.match(s.footer, /Wi-Fi/);
  snapshot = { enabled: true, status: 'completed', result: '新しい結果' };
  s = ctx.rlcd42SceneSnapshot(); assert.equal(s.scene, 'conversation'); assert.equal(s.caption, '新しい結果');
  snapshot = { enabled: true, status: 'error' }; assert.equal(ctx.rlcd42SceneSnapshot().scene, 'recovery');
  snapshot = { enabled: true, status: 'needs-input', stale: true };
  s = ctx.rlcd42SceneSnapshot(); assert.equal(s.approval, false); assert.equal(s.nextAction, '');
});

test('long active logs recover from explicit progress without guessing completion', async t => {
  const { file, observer } = await fixture(t, [record('task_started', { turn_id: 'long' })]);
  await fs.appendFile(file, line({ type: 'unknown', payload: { ignored: 'x'.repeat(300000) } }));
  await fs.appendFile(file, line(record('item_completed', { turn_id: 'long', item: { type: 'CommandExecution' } })));
  await observer.start();
  assert.equal(observer.snapshot().status, 'running'); assert.equal(observer.snapshot().turnId, 'long');
  await fs.appendFile(file, line(record('item_completed', { turn_id: 'long', item: { type: 'AgentMessage', phase: 'final_answer', content: '暫定結果' } })));
  await observer.poll(); assert.equal(observer.snapshot().status, 'running'); assert.equal(observer.snapshot().result, '');
  await fs.appendFile(file, line(record('task_complete', { turn_id: 'long', last_agent_message: '確定結果' })));
  await observer.poll(); assert.equal(observer.snapshot().status, 'completed'); assert.equal(observer.snapshot().result, '確定結果');
});
