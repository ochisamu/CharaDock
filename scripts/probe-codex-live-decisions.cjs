// SPDX-License-Identifier: Apache-2.0
// Windows Electron: SCRIPT SOURCE PROFILE OUTPUT [--wsl|--external-only].
// Default: native Windows + external Decisions; --wsl: native WSL only.
// Synthetic speech only;
// never execute media commands, change the profile, or read Codex auth.json.
const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const [source, profile, output, mode] = process.argv.slice(2);
if (!source || !profile || !output) throw Error('Supply SOURCE PROFILE OUTPUT');
fs.mkdirSync(output, { recursive: true });
const isolated = path.join(output, 'electron');
fs.mkdirSync(isolated, { recursive: true });
if (fs.existsSync(path.join(profile, 'Local State'))) fs.copyFileSync(path.join(profile, 'Local State'), path.join(isolated, 'Local State'));
app.setPath('userData', isolated);
const { CodexAppServerClient } = require(path.join(source, 'desktop/backend/codex-client.cjs'));
const { resolveCodexCommand, resolveInstalledWslCodexCommand, wslCommandArgsForPath, windowsPathToWsl } = require(path.join(source, 'desktop/lib/codex-command.cjs'));
const result = { stage: 'starting', syntheticInput: true, mediaExecution: false, profileModified: false, rpc: [] };
const save = () => fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
const clean = value => String(value || '').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 700);
console.warn = () => {};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(100); }
  return false;
}
let client, window;
const guard = setTimeout(() => { result.error = 'Probe timeout'; save(); client?.stop(); app.exit(1); }, 120000);
(async () => {
  await app.whenReady();
  if (mode !== '--external-only') {
  const useWsl = mode === '--wsl';
  const command = useWsl ? await resolveInstalledWslCodexCommand() : await resolveCodexCommand({ cacheDirectory: path.join(output, 'runtime') });
  result.version = execFileSync(useWsl ? 'wsl.exe' : command, useWsl ? ['--exec', command, '--version'] : ['--version'], { windowsHide: true }).toString().trim();
  client = new CodexAppServerClient({ command: useWsl ? 'wsl.exe' : command,
    commandArgs: useWsl ? wslCommandArgsForPath(output, ['env', '-u', 'CODEX_HOME', command]) : [],
    cwd: useWsl ? windowsPathToWsl(output) : output, spawnCwd: output,
    sandbox: 'read-only', approvalPolicy: 'never', webSearchMode: 'disabled' });
  result.accountType = (await client.getAccount()).account?.type;
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<title>CharaDock Decisions voice probe</title>');
  const js = code => window.webContents.executeJavaScript(code);
  const sdp = await js(`(async()=>{
    window.events=[];window.audibleSamples=0;window.peer=new RTCPeerConnection();window.context=new AudioContext();await context.resume();
    const destination=context.createMediaStreamDestination(),osc=context.createOscillator(),gain=context.createGain();
    gain.gain.value=0;osc.connect(gain).connect(destination);osc.start();peer.addTrack(destination.stream.getAudioTracks()[0],destination.stream);
    peer.ontrack=e=>{window.remoteAudio=new Audio();remoteAudio.muted=true;remoteAudio.srcObject=new MediaStream([e.track]);remoteAudio.play().catch(()=>{});
      const input=context.createMediaStreamSource(new MediaStream([e.track]));
      const processor=context.createScriptProcessor(4096,1,1),mute=context.createGain();mute.gain.value=0;
      processor.onaudioprocess=e=>{for(const sample of e.inputBuffer.getChannelData(0))if(Math.abs(sample)>.0001)audibleSamples++;};
      input.connect(processor).connect(mute).connect(context.destination);window.audioNodes={input,processor,mute};};
    window.dc=peer.createDataChannel('oai-events');
    dc.onmessage=({data})=>{try{const e=JSON.parse(data);events.push({type:e.type,event_id:e.event_id,client_event_id:e.client_event_id,
      error:e.error?{type:e.error.type,code:e.error.code,message:e.error.message,param:e.error.param}:undefined,
      source_event_type:e.source_event_type,source_event_id:e.source_event_id,trigger_id:e.trigger_id,
      decisionType:e.event?.type,answers:e.event?.decision?.answers,
      sessionKeys:e.session?Object.keys(e.session):undefined,triggers:e.session?.triggers});}catch{events.push({type:'non-json'});}};
    await peer.setLocalDescription(await peer.createOffer());return peer.localDescription.sdp;
  })()`);
  result.stage = 'native-start'; save();
  await client.beginRealtime({ sdp, includeStartupContext: false, onEvent: e => {
    result.rpc.push({ method: e.method, role: e.params?.role, text: clean(e.params?.text || e.params?.message) });
    if (e.method === 'thread/realtime/sdp') js(`peer.setRemoteDescription(${JSON.stringify({ type: 'answer', sdp: e.params.sdp })})`).catch(() => {});
  } });
  result.connected = await until(() => js("peer.connectionState==='connected'&&dc.readyState==='open'"));
  if (!result.connected) throw Error('Native WebRTC did not connect');
  await client.appendRealtimeSpeech('こんにちは。音声接続のテストです。');
  result.baselineAudio = await until(() => js('audibleSamples>480'));
  result.stage = 'native-triggers'; save();
  const trigger = event_type => ({ type: 'decisions', event_type, decisions: { questions: [
    { type: 'choice', name: 'expression', instructions: 'Choose a restrained expression matching the speaker: happy for celebration, concerned for worry, neutral otherwise.', choices: ['neutral', 'happy', 'concerned'].map(value => ({ value })) },
    { type: 'choice', name: 'gesture', instructions: 'Choose nod for agreement or congratulations, none otherwise.', choices: [{ value: 'none' }, { value: 'nod' }] },
  ] } });
  const update = { type: 'session.update', event_id: 'charadock_decisions_probe', session: { triggers: [trigger('session.input_transcript.delta'), trigger('session.output_transcript.delta')] } };
  await js(`dc.send(${JSON.stringify(JSON.stringify(update))})`);
  await until(() => js("events.some(e=>e.type==='session.updated'||e.type==='error')"), 8000);
  await client.appendRealtimeSpeech('やった、うまくいったね。とてもうれしいよ。');
  await until(() => js("events.some(e=>e.type==='decision.event')"), 8000);
  result.nativeEvents = await js('events');
  result.nativeDecisionReceived = result.nativeEvents.some(e => e.type === 'decision.event' && e.decisionType === 'decision.completed');
  await client.stopRealtime(); client.stop(); client = null;
  }
  if (mode === '--wsl') { result.stage = 'complete'; return; }
  result.stage = 'external-decisions'; save();
  const preferencesFile = path.join(output, 'preferences-copy.json');
  fs.copyFileSync(path.join(profile, 'preferences.json'), preferencesFile);
  const { Preferences } = require(path.join(source, 'desktop/lib/preferences.cjs'));
  const settings = new Preferences(preferencesFile, safeStorage);
  const { DecisionsClient } = require(path.join(source, 'desktop/lib/decisions-client.cjs'));
  const decisions = new DecisionsClient({ getApiKey: () => settings.getDecisionApiKey(), timeoutMs: 15000 });
  result.external = [];
  for (const [name, run] of [
    ['media-next', () => decisions.media('次の曲にして')],
    ['media-negated', () => decisions.media('音楽は止めないで')],
    ['expression', () => decisions.expression('やった、うまくいったね。とてもうれしいよ。', { nikePerformance: true })],
    ['media-next-warm', () => decisions.media('次の曲にして')],
    ['media-pause', () => decisions.media('音楽を一時停止して')],
    ['kohaku-expression', () => decisions.expression('やった、うまくいったね。とてもうれしいよ。', {
      nikePerformance: true, allowedEmotions: ['neutral', 'happy', 'thinking', 'surprised', 'soft', 'exasperated'],
    })],
  ]) {
    const start = Date.now();
    try { result.external.push({ name, result: await run(), latencyMs: Date.now() - start }); }
    catch (e) { result.external.push({ name, error: clean(e.message), latencyMs: Date.now() - start }); }
    save();
  }
  result.stage = 'complete';
})().catch(e => { result.error = clean(e.message); result.stage = 'failed'; }).finally(() => {
  clearTimeout(guard); save(); client?.stop(); window?.destroy(); app.exit(result.stage === 'complete' ? 0 : 1);
});
