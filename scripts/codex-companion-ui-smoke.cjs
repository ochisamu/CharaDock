// SPDX-License-Identifier: Apache-2.0
// Real Electron UI + IPC, isolated profile and synthetic Codex log. No AI calls.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: electron codex-companion-ui-smoke.cjs SOURCE FRESH_OUTPUT');
const profile = path.join(output, 'profile');
if (fs.existsSync(profile)) throw new Error('Use a fresh output directory');
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'preferences.json'), JSON.stringify({ onboardingComplete: true,
  continuationStartupSpeechEnabled: false, launchAtLogin: false, remoteAccessEnabled: false,
  updateChecksEnabled: false, ttsEnabled: false, jevEnabled: false, atomEchoEnabled: false,
  characterDeviceProfiles: { 'rlcd42-default': { enabled: false } } }));
const codexHome = path.join(output, 'codex-fixture');
const sessions = path.join(codexHome, 'sessions');
fs.mkdirSync(sessions, { recursive: true });
const log = path.join(sessions, 'rollout-companion-qa.jsonl');
const event = (type, payload = {}) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type, ...payload } }) + '\n';
fs.writeFileSync(log, JSON.stringify({ type: 'session_meta', payload: { id: 'companion-qa', source: 'vscode', originator: 'Codex Desktop', cwd: '/example/project' } }) + '\n'
  + event('task_started', { turn_id: 'qa-turn' })
  + event('item_completed', { turn_id: 'qa-turn', item: { type: 'AgentMessage', phase: 'commentary', content: '表示と音声処理のテストを確認しています。' } }));
process.env.CODEX_HOME = codexHome;
app.setPath('userData', profile);
app.setName('CharaDock Companion QA');
app.getAppPath = () => source;
app.setLoginItemSettings = () => {};
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, details) => {
    const message = typeof details === 'object' ? details.message : '';
    if (/Uncaught|ReferenceError|TypeError/.test(message || '')) errors.push(message);
  });
});
require(path.join(source, 'desktop/main.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Companion UI QA timeout'); app.exit(1); }, 90000);
(async () => {
  await app.whenReady();
  let window;
  for (let i=0; i<150; i++) {
    window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/control.html') && !w.webContents.isLoading());
    if (window) break; await sleep(200);
  }
  assert.ok(window, 'Control window loads');
  const js = code => window.webContents.executeJavaScript(code);
  await sleep(800);
  await js(`document.querySelector('[data-page="companion"]').click(); document.querySelector('#companionRefresh').click()`);
  for (let i=0; i<30; i++) { if (await js(`document.querySelector('#companionThread').options.length > 1`)) break; await sleep(100); }
  await js(`const s=document.querySelector('#companionThread');s.selectedIndex=1;s.dispatchEvent(new Event('change'));document.querySelector('#companionStart').click()`);
  for (let i=0; i<30; i++) { if ((await js(`document.querySelector('#companionBadge').textContent`)) === '作業中') break; await sleep(100); }
  assert.equal(await js(`document.querySelector('#companionBadge').textContent`), '作業中');
  assert.equal(await js(`document.querySelector('#chatInput').disabled`), true);
  assert.equal(await js(`window.mascotDesktop.sendChat('must not submit').then(()=>false,e=>e.message.includes('閲覧専用'))`), true);
  window.showInactive();
  fs.writeFileSync(path.join(output, 'running.png'), (await window.capturePage()).toPNG());
  fs.appendFileSync(log, event('task_complete', { turn_id: 'qa-turn', last_agent_message: '修正が完了しました。テストも成功しています。\n<unsafe>はテキストとして表示します。' }));
  for (let i=0; i<35; i++) { if ((await js(`document.querySelector('#companionBadge').textContent`)) === '完了') break; await sleep(100); }
  assert.equal(await js(`document.querySelector('#companionBadge').textContent`), '完了');
  assert.equal(await js(`document.querySelector('#companionResult unsafe') === null`), true);
  assert.match(await js(`document.querySelector('#companionResult').textContent`), /修正が完了/);
  fs.writeFileSync(path.join(output, 'completed.png'), (await window.capturePage()).toPNG());
  const mascot = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/?mode=obs'));
  assert.ok(mascot, 'Mascot loads');
  assert.equal(await mascot.webContents.executeJavaScript(`document.querySelector('#desktopMascotInput').disabled`), true);
  assert.match(await mascot.webContents.executeJavaScript(`document.body.textContent`), /修正が完了/);
  await js(`document.querySelector('#companionStop').click()`);
  for (let i=0; i<30; i++) { if (!(await js(`document.querySelector('#chatInput').disabled`))) break; await sleep(100); }
  assert.equal(await js(`document.querySelector('#chatInput').disabled`), false);
  assert.equal(await js(`document.querySelector('#companionBadge').textContent`), '停止中');
  assert.equal(await mascot.webContents.executeJavaScript(`document.querySelector('#desktopMascotInput').disabled`), false);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, scenarios: ['list', 'start', 'read-only', 'progress', 'completion', 'text-not-html', 'mascot', 'stop'], errors }, null, 2));
  console.log('PASS: isolated real Companion UI, IPC, character display and read-only role');
  clearTimeout(timeout); app.quit();
})().catch(error => { console.error(error.stack); app.exit(1); });
