// SPDX-License-Identifier: Apache-2.0
// Windows Electron: SCRIPT SOURCE PROFILE OUTPUT [--activate].
// Default: production Live on a profile copy, real Decisions and muted voice,
// with a recording media executor. --activate enables Decisions in the real
// profile through production IPC, verifies preservation, and leaves it open.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const [source, profile, output, mode] = process.argv.slice(2);
if (!source || !profile || !output) throw Error('Supply SOURCE PROFILE OUTPUT');
fs.mkdirSync(output, { recursive: true });
const activate = mode === '--activate';
const userData = activate ? profile : path.join(output, 'profile');
if (!activate) {
  fs.mkdirSync(userData, { recursive: true });
  fs.copyFileSync(path.join(profile, 'Local State'), path.join(userData, 'Local State'));
  const preferences = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
  for (const character of preferences.customCharacters || []) {
    if (!character.generated || !character.assetDir) continue;
    const original = path.resolve(character.assetDir);
    assert.equal(path.dirname(original), path.join(profile, 'generated-characters'));
    const destination = path.join(userData, 'generated-characters', path.basename(original));
    fs.cpSync(original, destination, { recursive: true });
    character.assetDir = destination;
  }
  Object.assign(preferences, { atomEchoEnabled: false, deviceProfiles: {}, remoteAccessEnabled: false,
    remoteTailscaleManaged: false, updateChecksEnabled: false, continuationStartupSpeechEnabled: false,
    codexAuthMode: 'codex', interactionMode: 'chat', realtimeAutoStartOnText: false });
  fs.writeFileSync(path.join(userData, 'preferences.json'), JSON.stringify(preferences));
}
app.setPath('userData', userData); app.setName('CharaDock'); app.getAppPath = () => source;
const result = { stage: 'starting', realProfile: activate, realDecisions: true, mediaExecutedOnWindows: false,
  decisions: [], expressions: [], media: [] };
const save = () => fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
const clean = value => String(value || '').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 700);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(100); }
  throw Error('Verification timed out at ' + result.stage);
}
let liveClient, dispatch, peer;
if (!activate) {
  const mediaModule = require(path.join(source, 'desktop/lib/media-control.cjs'));
  const factory = mediaModule.createMediaController;
  mediaModule.createMediaController = (...args) => {
    const controller = factory(...args);
    controller.call = async (args, key) => { result.media.push({ action: args.action, key }); return { ok: true, accepted: true }; };
    return controller;
  };
  const { CodexAppServerClient } = require(path.join(source, 'desktop/backend/codex-client.cjs'));
  const begin = CodexAppServerClient.prototype.beginRealtime;
  CodexAppServerClient.prototype.beginRealtime = function(options) {
    liveClient = this; dispatch = options.onEvent;
    const deliver = options.onEvent;
    return begin.call(this, { ...options, onEvent: message => {
      if (message.method === 'thread/realtime/sdp') globalThis.probeAnswer = message.params.sdp;
      return deliver(message);
    } });
  };
  const { JevExpressionDirector } = require(path.join(source, 'desktop/lib/jev-expression-director.cjs'));
  const request = JevExpressionDirector.prototype.request;
  JevExpressionDirector.prototype.request = function(...args) {
    if (!this.probeWrapped) {
      this.probeWrapped = true; const apply = this.apply;
      this.apply = value => { result.expressions.push(value); apply(value); };
    }
    return request.apply(this, args);
  };
  const { DecisionClient } = require(path.join(source, 'desktop/lib/decision-client.cjs'));
  for (const method of ['test', 'media', 'expression']) {
    const run = DecisionClient.prototype[method];
    DecisionClient.prototype[method] = async function(...args) {
      const at = Date.now();
      try { const value = await run.apply(this, args);
        result.decisions.push({ method, source: args[1]?.source, input: clean(args[0]), value, latencyMs: Date.now() - at }); save(); return value;
      } catch (e) { result.decisions.push({ method, error: clean(e.message) }); save(); throw e; }
    };
  }
}
require(path.join(source, 'desktop/main.cjs'));
const guard = setTimeout(() => { result.error = 'Verification timeout'; save(); app.exit(1); }, 150000);
(async () => {
  await app.whenReady(); let control;
  await until(() => { control = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/control.html') && !w.webContents.isLoading()); return control; });
  const js = code => control.webContents.executeJavaScript(code);
  await sleep(1000);
  const before = await js('window.mascotDesktop.getState()');
  result.stage = 'configure'; save();
  await js("window.mascotDesktop.setJevConfig({provider:'decisions',enabled:true,mediaEnabled:true,expressionEnabled:true})");
  const after = await js('window.mascotDesktop.getState()');
  assert.equal(after.decisionProvider, 'decisions');
  for (const key of ['characterId', 'characterTts', 'conversationHistory', 'codexAuthMode']) assert.deepEqual(after[key], before[key], key);
  result.settingsPreserved = true;
  let connected;
  for (let attempt = 0; attempt < 2; attempt++) {
    connected = await js('window.mascotDesktop.testJevConnection()');
    if (connected.ok) break; await sleep(700);
  }
  assert.equal(connected.ok, true, connected.error);
  result.connection = connected;
  if (activate) {
    await js("document.querySelector('[data-page=\"connection\"]').click()"); await sleep(300);
    control.showInactive();
    fs.writeFileSync(path.join(output, 'connection.png'), (await control.capturePage()).toPNG());
    result.stage = 'passed'; result.passed = true; save(); clearTimeout(guard); return;
  }
  result.stage = 'native-live'; save();
  peer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await peer.loadURL('data:text/html,<title>Muted Live Decisions verification</title>');
  const pj = code => peer.webContents.executeJavaScript(code);
  const sdp = await pj(`(async()=>{window.pc=new RTCPeerConnection();window.ac=new AudioContext();await ac.resume();window.samples=0;
    const dest=ac.createMediaStreamDestination(),osc=ac.createOscillator(),gain=ac.createGain();gain.gain.value=0;osc.connect(gain).connect(dest);osc.start();pc.addTrack(dest.stream.getAudioTracks()[0],dest.stream);
    pc.ontrack=e=>{window.audio=new Audio();audio.muted=true;audio.srcObject=new MediaStream([e.track]);audio.play().catch(()=>{});
      const input=ac.createMediaStreamSource(new MediaStream([e.track])),proc=ac.createScriptProcessor(4096,1,1),mute=ac.createGain();mute.gain.value=0;
      proc.onaudioprocess=e=>{for(const s of e.inputBuffer.getChannelData(0))if(Math.abs(s)>.0001)samples++;};input.connect(proc).connect(mute).connect(ac.destination);window.nodes={input,proc,mute};};
    window.dc=pc.createDataChannel('oai-events');await pc.setLocalDescription(await pc.createOffer());return pc.localDescription.sdp;})()`);
  // The actual app owns the callbacks, including transcript routing and guards.
  const realtime = await js(`window.mascotDesktop.startCodexRealtime(${JSON.stringify({ sdp })})`);
  assert.ok(realtime.threadId);
  const originalDispatch = dispatch;
  assert.ok(globalThis.probeAnswer, 'native SDP answer');
  await pj(`pc.setRemoteDescription(${JSON.stringify({ type: 'answer', sdp: globalThis.probeAnswer })})`);
  await until(() => pj("pc.connectionState==='connected'"));
  const emit = (type, text) => originalDispatch({ method: `thread/realtime/transcript/${type}`, params: {
    threadId: liveClient.threadId, role: 'user', ...(type === 'delta' ? { delta: text } : { text }),
  } });
  result.stage = 'music-final-and-duplicate'; save();
  emit('delta', '次の曲にして'); assert.equal(result.media.length, 0);
  emit('done', '次の曲にして'); emit('done', '次の曲にして');
  await until(() => result.media.length === 1);
  await sleep(700); assert.equal(result.media.length, 1);
  emit('delta', '音楽は止めないで'); emit('done', '音楽は止めないで');
  await until(() => result.decisions.some(d => d.method === 'media' && d.input === '音楽は止めないで'));
  assert.equal(result.media.length, 1);
  result.stage = 'listening-expression'; save();
  const count = result.expressions.length;
  emit('delta', '仕事で失敗してしまって、'); emit('delta', 'とても落ち込んでいます。');
  await until(() => result.expressions.length > count);
  result.listeningBeforeFinal = true;
  const mascot = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=obs'));
  if (mascot) fs.writeFileSync(path.join(output, 'listening.png'), (await mascot.capturePage()).toPNG());
  emit('done', '仕事で失敗してしまって、とても落ち込んでいます。');
  result.stage = 'speaking-expression'; save();
  const spoken = result.decisions.filter(d => d.method === 'expression' && d.source !== 'user').length;
  await js("window.mascotDesktop.appendCodexRealtimeSpeech('大丈夫、私は味方だよ。一緒にゆっくり進めようね。')");
  await until(() => result.decisions.filter(d => d.method === 'expression' && d.source !== 'user').length > spoken);
  await until(() => pj('samples>480'));
  result.audibleSamples = await pj('samples');
  await js('window.mascotDesktop.stopCodexRealtime()');
  result.stage = 'passed'; result.passed = true; save();
  clearTimeout(guard); peer.destroy(); app.quit();
})().catch(e => { result.stage = 'failed'; result.error = clean(e.message); save(); clearTimeout(guard); peer?.destroy(); app.exit(1); });
