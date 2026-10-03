// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { CodexCompanion, reduceRecord, initialSnapshot } = require('../lib/codex-companion.cjs');
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
      async start() { starts++; this.state.enabled = true; return this.snapshot(); } },
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
