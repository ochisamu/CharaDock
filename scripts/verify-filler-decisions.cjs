// SPDX-License-Identifier: Apache-2.0
// Windows Electron: SOURCE PROFILE OUTPUT. Read-only access to configured
// credentials; only synthetic prompts go to the selected decision provider.
const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const [source, profile, output] = process.argv.slice(2);
if (!source || !profile || !output) throw Error('Supply SOURCE PROFILE OUTPUT');
fs.mkdirSync(output, { recursive: true });
const runtime = path.join(output, 'decision-runtime');
fs.mkdirSync(runtime, { recursive: true });
// Chromium's encrypted key is profile-local. Copy only its crypto state into
// this private temporary directory, never open a second writer on the live profile.
fs.copyFileSync(path.join(profile, 'Local State'), path.join(runtime, 'Local State'));
app.setName('CharaDock'); app.setPath('userData', runtime);
app.whenReady().then(async () => {
  const { Preferences } = require(path.join(source, 'desktop/lib/preferences.cjs'));
  // Reuse key accessors without invoking preference loading/migration/saving.
  const preferences = Object.assign(Object.create(Preferences.prototype), { safeStorage,
    data: JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8')) });
  const { DecisionClient } = require(path.join(source, 'desktop/lib/decision-client.cjs'));
  const { decideFiller } = require(path.join(source, 'desktop/lib/turn-policy.cjs'));
  const client = new DecisionClient({ getProvider: () => preferences.data.decisionProvider,
    getJevApiKey: () => preferences.getJevApiKey(), getOpenAIApiKey: () => preferences.getDecisionApiKey() });
  let answers;
  const ask = client.ask.bind(client);
  client.ask = async (...args) => { answers = await ask(...args); return answers; };
  const prompts = [
    ['greeting', 'こんにちは'],
    ['thanks', 'ありがとう'],
    ['comparison', '旅行計画について、鉄道と車と飛行機それぞれの長所と短所をじっくり比較してほしい。'],
    ['design', 'オフラインでも動く共同編集アプリの同期方式を設計したい。競合解決、整合性、復旧手順のトレードオフを比較して、使い分けを一緒に考えて。'],
    ['reflection', '新しい趣味を始めたいけれど、好きなものが多くて決められない。何を軸に選ぶと続けやすいか、一緒に考えてもらえる？'],
  ];
  const rows = [];
  for (const [kind, prompt] of prompts) {
    const started = Date.now();
    try {
      const result = await decideFiller(client, prompt, { candidates: ['少し考えるね。', 'ちょっと待ってね。'] });
      rows.push({ kind, spoken: Boolean(result.text), needed: answers?.needed?.noul, selected: answers?.filler?.choice, elapsedMs: Date.now() - started });
    } catch (error) { rows.push({ kind, failed: true, reason: /^(?:Jev|Decisions) /.test(error.message) ? error.message : 'Verification failed' }); }
  }
  fs.writeFileSync(path.join(output, 'filler-decisions.json'), JSON.stringify({ provider: client.provider(), rows }, null, 2));
  app.quit();
}).catch(() => { fs.writeFileSync(path.join(output, 'filler-decisions.json'), JSON.stringify({ failed: true })); app.exit(1); });
