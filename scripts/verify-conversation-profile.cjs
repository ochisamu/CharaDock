// SPDX-License-Identifier: Apache-2.0
// Opt-in Windows Electron verification: SOURCE EXISTING_PROFILE OUTPUT.
// Close the running app first. Uses its real auth, models and voice; restores
// test preferences/history in finally and leaves the verified app open.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), Module = require('node:module');
const [source, profile, output] = process.argv.slice(2);
if (!source || !profile || !output || !fs.existsSync(path.join(profile, 'preferences.json'))) throw Error('Supply SOURCE EXISTING_PROFILE OUTPUT');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', profile); app.setName('CharaDock'); app.getAppPath = () => source;
const report = { stage: 'starting', realProfile: true, checks: {} };
const write = () => fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check, timeout = 90000) { const until = Date.now() + timeout; while (Date.now() < until) { if (await check()) return; await sleep(100); } throw Error('Verification wait timed out'); }
const levels = [], streams = [], turns = [], errors = [], synthesized = [];
let delayNextTurnStartMs = 0;
let speechStartAt = 0;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, callback) => handle(channel, async (event, ...args) => {
  if (['mascot:voice', 'mascotInline:voice'].includes(channel)) levels.push({ level: Number(args[0]), at: Date.now() });
  const result = await callback(event, ...args);
  if (['tts:synthesize', 'mascotInline:synthesizeTts'].includes(channel)) synthesized.push({ text: String(args[0]), at: Date.now(), ok: Boolean(result) });
  return result;
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, detail) => { if (/Uncaught|ReferenceError|TypeError|Unable to load preload/.test(detail?.message || '')) errors.push('renderer-error'); });
  const send = contents.send.bind(contents);
  contents.send = (channel, payload, ...args) => {
    if (channel === 'mascot:speech' || (channel === 'mascot:stream' && payload?.phase === 'start')) speechStartAt = Date.now();
    if (channel === 'mascot:stream') streams.push({ ...payload, at: Date.now() });
    return send(channel, payload, ...args);
  };
});
const { CodexAppServerClient } = require(path.join(source, 'desktop/backend/codex-client.cjs'));
const request = CodexAppServerClient.prototype.request;
CodexAppServerClient.prototype.request = function(method, params, ...args) {
  if (method === 'turn/start') turns.push({ effort: params.effort, threadId: params.threadId, at: Date.now() });
  if (method === 'turn/start' && delayNextTurnStartMs) {
    const delay = delayNextTurnStartMs; delayNextTurnStartMs = 0;
    return sleep(delay).then(() => request.call(this, method, params, ...args));
  }
  return request.call(this, method, params, ...args);
};
// Suppress only the scheduled greeting so the test can invoke that same
// production entry point after its controlled conversation has been saved.
const originalTimer = global.setTimeout;
global.setTimeout = (callback, delay, ...args) => delay === 800 && String(callback).includes('maybeOfferStartupContinuation')
  ? originalTimer(() => {}, 0) : originalTimer(callback, delay, ...args);
const filename = path.join(source, 'desktop/main.cjs');
const entry = new Module(filename, module); entry.filename = filename; entry.paths = Module._nodeModulePaths(path.dirname(filename));
entry._compile(fs.readFileSync(filename, 'utf8') + `
module.exports.verification = {
  get data() { return preferences.data; },
  patch: values => { preferences.patch(values); broadcastAppState(); },
  getHistory: () => conversationHistory,
  restoreHistory: history => { conversationHistory = history; broadcastAppState(); },
  greet: () => maybeOfferStartupContinuation(),
  clearAttempts: () => startupContinuationAttempts.clear(),
  resetClient: () => resetConversationClient(),
  busy: () => Boolean(activeCodexInteractionClient() || activeWorkRunId || currentRealtimeClient()),
  get decisions() { return jevClient; },
  get character() { return activeCharacter(); },
  fillerProfile: () => characterFillerProfile(activeCharacter()),
  ensureFillers: () => getCharacterFillerLibrary().ensure(characterFillerProfile(activeCharacter())),
  generateFillers: profile => generateCharacterFillerCandidates(profile),
  fillerCandidates: () => fillerCandidates(activeCharacter(), { language: interfaceLanguage(), generated: getCharacterFillerLibrary().get(characterFillerProfile(activeCharacter())) }),
  resetFillerCooldown: () => { lastThinkingFillerAt = 0; },
};`, filename);
const qa = entry.exports.verification;
let before, history, mobile, remoteIds;
const keys = ['interactionMode', 'characterMemories', 'conversationHistories', 'continuationSummaries', 'startupTopicOffers', 'continuationStartupSpeechEnabled', 'thinkingFillerEnabled'];
(async () => {
  await app.whenReady(); let control, mascot;
  await wait(() => {
    control = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/control.html') && !win.webContents.isLoading());
    mascot = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('mode=obs') && !win.webContents.isLoading());
    return control && mascot && qa.data;
  });
  const js = code => control.webContents.executeJavaScript(code);
  // A connected RLCD reports its hardware mute state shortly after boot.
  // Let that existing startup synchronization settle before injecting a turn.
  await sleep(12000); assert.equal(qa.busy(), false);
  before = Object.fromEntries(keys.map(key => [key, structuredClone(qa.data[key])])); history = structuredClone(qa.getHistory());
  qa.patch({ interactionMode: 'chat', characterMemories: {}, conversationHistories: {}, continuationSummaries: {}, startupTopicOffers: {}, continuationStartupSpeechEnabled: true, thinkingFillerEnabled: true });
  qa.restoreHistory([]); qa.resetClient();
  const send = message => js(`window.mascotDesktop.sendChat(${JSON.stringify(message)})`);
  const settleAudio = async () => {
    if (!qa.data.ttsEnabled) return;
    const since = speechStartAt;
    await wait(() => levels.some(item => item.at >= since && item.level > .02), 90000);
    await wait(() => levels.at(-1).level <= .01 && Date.now() - levels.at(-1).at > 700, 90000);
  };
  report.stage = 'generated-fillers'; write();
  const { CharacterFillerLibrary } = require(path.join(source, 'desktop/lib/character-filler-library.cjs'));
  const prepared = await qa.ensureFillers();
  assert.ok(prepared.length >= 12, 'Current character has generated vocabulary');
  const reloaded = new CharacterFillerLibrary({ file: path.join(profile, 'character-filler-candidates.json'), generate: () => assert.fail('Persisted vocabulary must be reused') });
  assert.deepEqual(reloaded.get(qa.fillerProfile()), prepared);
  assert.deepEqual(qa.fillerCandidates(), prepared, 'Prepared vocabulary replaces stock list');
  const fixture = new CharacterFillerLibrary({ file: path.join(output, 'custom-filler-library.json'), generate: qa.generateFillers });
  const custom = { id: 'qa-scholar', language: 'ja', name: 'シオン', personality: '古風な学者', persona: '穏やかな学者。一人称はわし、語尾は「のう」「じゃ」。対等な友人として短く話す。', examples: [] };
  const customPhrases = await fixture.ensure(custom);
  assert.ok(customPhrases.length >= 12 && customPhrases.some(text => /のう|じゃ/.test(text)));
  const revised = { ...custom, persona: '穏やかな学者。一人称は私。です・ますの自然な敬語で話す。古風な語尾や「のう」「じゃ」は使わない。' };
  const revisedPhrases = await fixture.ensure(revised);
  assert.ok(revisedPhrases.length >= 12 && revisedPhrases.some(text => /です|ます/.test(text)));
  assert.deepEqual(fixture.get(custom), []);
  report.checks.generatedFillers = { passed: true, persistedAndReloaded: true, currentCount: prepared.length,
    customCount: customPhrases.length, revisedCount: revisedPhrases.length, samples: [customPhrases[0], revisedPhrases[0]], staleProfileExcluded: true }; write();
  report.stage = 'greeting'; write();
  const started = Date.now(), turnOffset = turns.length;
  const greeting = await send('こんにちは'); const replyMs = Date.now() - started; assert.ok(greeting.text);
  const first = turns[turnOffset]; assert.ok(first);
  const { fastReasoningEffort } = require(path.join(source, 'desktop/lib/turn-policy.cjs'));
  assert.equal(first.effort, fastReasoningEffort(qa.data.codexChatModel));
  assert.equal(streams.filter(item => item.at >= started && item.kind === 'filler').length, 0);
  await settleAudio();
  report.checks.greeting = { passed: true, effort: first.effort, responseMs: replyMs, voiceMoved: levels.some(item => item.at >= started && item.level > .02) }; write();
  report.stage = 'memory'; write();
  await send('最近、将棋を始めたんだ。まだ駒の動かし方を覚えているところだよ。');
  await settleAudio();
  const memories = qa.data.characterMemories[qa.data.characterId] || [];
  assert.ok(memories.some(item => item.category === 'recent' && /将棋/.test(item.content)), 'Natural Chat should save a recent topic');
  assert.equal(turns.at(-1).effort || '', qa.data.codexChatReasoningEffort || '');
  // Verify persistence through the same preferences loader used on restart.
  const persisted = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
  assert.ok(persisted.characterMemories[qa.data.characterId].some(item => item.category === 'recent' && /将棋/.test(item.content)));
  report.checks.memory = { passed: true, recentSavedAndPersisted: true }; write();
  report.stage = 'startup'; write();
  qa.clearAttempts(); const startupAt = Date.now();
  assert.equal(await qa.greet(), true, 'Memory-backed startup greeting');
  assert.match(qa.getHistory().at(-1).text, /将棋|駒/);
  await settleAudio(); qa.clearAttempts(); assert.equal(await qa.greet(), false, 'No repeated greeting on rapid relaunch');
  report.checks.startup = { passed: true, grounded: true, repeatSuppressed: true, voiceMoved: levels.some(item => item.at >= startupAt && item.level > .02) }; write();
  control.showInactive(); await js(`document.querySelector('[data-page="character"]').click()`); await sleep(400);
  await js(`document.querySelector('#characterMemoryTitle').scrollIntoView({block:'center'})`); await sleep(500);
  fs.writeFileSync(path.join(output, 'recent-memory.png'), (await control.capturePage()).toPNG());
  report.stage = 'filler'; write();
  const { decideFiller } = require(path.join(source, 'desktop/lib/turn-policy.cjs'));
  const decision = await decideFiller(qa.decisions, '旅行計画について、鉄道と車と飛行機それぞれの長所と短所をじっくり比較してほしい。', { character: qa.character, candidates: qa.fillerCandidates() });
  assert.equal(typeof decision.text, 'string');
  // Controlled slow backend start tests the waiting branch without replacing
  // either the real decision provider or the real answer/TTS providers.
  qa.resetFillerCooldown(); delayNextTurnStartMs = 3500;
  const fillerAt = Date.now();
  await send('新しい趣味を始めたいけれど、好きなものが多くて決められない。何を軸に選ぶと続けやすいか、一緒に考えてもらえる？返事は120文字以内で。');
  await settleAudio();
  const fillers = streams.filter(item => item.at >= fillerAt && item.kind === 'filler');
  assert.equal(fillers.length, 1, 'Slow reflective turn should receive one model-selected filler');
  assert.ok(synthesized.some(item => item.at >= fillerAt && item.ok && item.text.includes(fillers[0].text)), 'Selected filler reaches real TTS');
  report.checks.filler = { passed: true, actualDecision: Boolean(decision.text), emitted: fillers.length,
    text: fillers[0].text, emissionMs: fillers[0].at - fillerAt, synthesized: true,
    simulatedBackendStartDelayMs: 3500, noDuplicates: true }; write();
  report.stage = 'cancel'; write();
  const cancelAt = Date.now(); const pending = send('将棋の歴史について長い解説を考えて。').catch(() => null);
  await wait(() => qa.busy()); await js('window.mascotDesktop.interruptChat()'); await pending; await sleep(3000);
  assert.equal(streams.filter(item => item.at >= cancelAt && item.kind === 'filler').length, 0);
  report.checks.cancellation = { passed: true }; write();
  const remote = await js('window.mascotDesktop.getRemoteStatus()');
  if (remote.active && remote.pairingUrl) {
    report.stage = 'remote'; write(); remoteIds = new Set(remote.devices.map(device => device.id));
    mobile = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { contextIsolation: true, sandbox: true, partition: `conversation-qa-${Date.now()}` } });
    await mobile.loadURL(remote.pairingUrl); await sleep(1600);
    assert.equal(await mobile.webContents.executeJavaScript(`document.querySelector('#pairingView').hidden`), true);
    const mobileAt = Date.now();
    await mobile.webContents.executeJavaScript(`document.querySelector('#messageInput').value='こんにちは';document.querySelector('#messageForm').requestSubmit()`);
    await wait(() => streams.some(item => item.at >= mobileAt && item.phase === 'done'));
    await sleep(2000);
    assert.equal(streams.filter(item => item.at >= mobileAt && item.kind === 'filler').length, 0);
    fs.writeFileSync(path.join(output, 'mobile.png'), (await mobile.capturePage()).toPNG());
    report.checks.remote = { paired: true, actualChat: true, greetingWithoutFiller: true }; write();
    mobile.destroy(); mobile = null;
    const devices = (await js('window.mascotDesktop.getRemoteStatus()')).devices;
    for (const device of devices) if (!remoteIds.has(device.id)) await js(`window.mascotDesktop.revokeRemoteSession(${JSON.stringify(device.id)})`);
  }
  assert.deepEqual(errors, []); report.errors = errors; report.stage = 'passed'; report.passed = true;
})().catch(error => { report.stage = 'failed'; report.error = String(error.message).slice(0, 250); report.passed = false; }).finally(() => {
  if (mobile && !mobile.isDestroyed()) mobile.destroy();
  if (before) { qa.patch(before); qa.restoreHistory(history); qa.resetClient(); report.restored = true; }
  global.setTimeout = originalTimer; write(); console.log('Conversation profile verification:', report.stage);
});
