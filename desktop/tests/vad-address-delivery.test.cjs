const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../preload-mascot.cjs'), 'utf8');
const block = source.slice(source.indexOf('  const waitingVoiceStatus ='), source.indexOf('  const appendVadStreamingSamples ='));
function setup(mode, admission, throws = false) {
  const calls = { ipc: 0, sent: [], statuses: [] };
  const ctx = vm.createContext({ appState: { jevAddressMode: mode }, vadGeneration: 1,
    vadActive: true, vadProcessing: false, input: { value: '' },
    vadResumeAt: 0, autoSendCountdownEndsAt: 0, vadPreRoll: [], vadStreamingPreRoll: [],
    vadLoudSince: 0, vadSilentSince: 0, performance: { now: () => 1 },
    setVadUi() {}, setStatus(text) { calls.statuses.push(text); }, resizeInput() {}, setOpen() {}, cleanupVadMedia() {},
    transcribeRecordedBlob: async () => '今日の予定は？',
    beginAutoSendCountdown(text) { calls.sent.push(text); },
    ipcRenderer: { async invoke() { calls.ipc++; if (throws) throw Error('offline'); return admission; } },
  });
  vm.runInContext(block + '\nglobalThis.runText = processVadRecognizedText; globalThis.runBlob = processVadTranscript;', ctx);
  return { ctx, calls };
}
for (const route of ['runText', 'runBlob']) {
  test(`${route}: OFF preserves original auto-send without classifier IPC`, async () => {
    const { ctx, calls } = setup('off', null, true);
    await ctx[route]('今日の予定は？', 'streaming-local');
    assert.equal(calls.sent.length, 1); assert.equal(calls.ipc, 0); assert.equal(ctx.vadProcessing, false);
  });
  test(`${route}: accepted ASR resumes original countdown exactly once`, async () => {
    const { ctx, calls } = setup('standard', { accepted: true, reason: 'uncertain' });
    await ctx[route]('今日の予定は？', 'streaming-local');
    assert.equal(calls.sent.length, 1); assert.equal(calls.ipc, 1); assert.equal(ctx.vadProcessing, false);
  });
  test(`${route}: rejection is visible and releases VAD for the next utterance`, async () => {
    const admission = { accepted: false, reason: 'unrelated' };
    const { ctx, calls } = setup('standard', admission);
    await ctx[route]('test', 'streaming-local');
    assert.equal(calls.sent.length, 0); assert.match(calls.statuses.at(-1), /除外/);
    assert.equal(ctx.vadProcessing, false);
    admission.accepted = true;
    await ctx[route]('test', 'streaming-local'); assert.equal(calls.sent.length, 1);
  });
  test(`${route}: failed IPC is visible and does not leave VAD busy`, async () => {
    const { ctx, calls } = setup('standard', null, true);
    await ctx[route]('test', 'streaming-local');
    assert.equal(calls.sent.length, 0); assert.match(calls.statuses.at(-1), /通信に失敗/);
    assert.equal(ctx.vadProcessing, false);
  });
}
