// SPDX-License-Identifier: Apache-2.0
// Electron SCRIPT SOURCE PROFILE OUTPUT: copied profile, loopback pairing,
// synthetic microphone, actual Codex Live and Beatrice, 200ms HTTP latency.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const [source, profile, output] = process.argv.slice(2);
if (!source || !profile || !output) throw Error('Supply SOURCE PROFILE OUTPUT');
const testProfile = path.join(output, 'profile'); fs.mkdirSync(testProfile, { recursive: true });
const inputWavePath = path.join(output, 'speech-input.wav');
// Offline Windows speech provides a repeatable microphone fixture without
// recording the user's microphone or downloading another voice model.
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $synth.SetOutputToWaveFile($env:CHARADOCK_NETWORK_TEST_WAV); $synth.Speak('Hello. Please say hello back to me.') } finally { $synth.Dispose() }"],
  { windowsHide: true, env: { ...process.env, CHARADOCK_NETWORK_TEST_WAV: inputWavePath } });
fs.copyFileSync(path.join(profile, 'Local State'), path.join(testProfile, 'Local State'));
function copyModelFiles(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const input = path.join(from, entry.name), destination = path.join(to, entry.name);
    if (entry.isDirectory()) copyModelFiles(input, destination);
    else if (entry.isFile()) {
      if (fs.statSync(input).size > 1024 * 1024) fs.linkSync(input, destination);
      else fs.copyFileSync(input, destination);
    }
  }
}
// Share immutable large weights through hardlinks; mutable metadata is copied.
const models = path.join(profile, 'tts-models');
for (const name of fs.readdirSync(models).filter(name => name.startsWith('speech-cpp-'))) copyModelFiles(path.join(models, name), path.join(testProfile, 'tts-models', name));
if (fs.existsSync(path.join(profile, 'irodori-voices'))) fs.cpSync(path.join(profile, 'irodori-voices'), path.join(testProfile, 'irodori-voices'), { recursive: true });
const preferences = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
for (const character of preferences.customCharacters || []) {
  if (!character.generated || !character.assetDir) continue;
  const original = path.resolve(character.assetDir); assert.equal(path.dirname(original), path.join(profile, 'generated-characters'));
  character.assetDir = path.join(testProfile, 'generated-characters', path.basename(original));
  fs.cpSync(original, character.assetDir, { recursive: true });
}
Object.assign(preferences, { atomEchoEnabled: false, deviceProfiles: {}, remoteAccessEnabled: false, remoteTrustedDevices: [],
  remoteTailscaleManaged: false, updateChecksEnabled: false, continuationStartupSpeechEnabled: false,
  codexAuthMode: 'codex', interactionMode: 'chat', remoteResponseMode: 'live', remoteStartupGreetingEnabled: false });
fs.writeFileSync(path.join(testProfile, 'preferences.json'), JSON.stringify(preferences));
app.setPath('userData', testProfile); app.setName('CharaDock'); app.getAppPath = () => source;
const result = { stage: 'starting', originalProfileModified: false, requestLatencyMs: 200 };
const save = () => fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 40000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(150); } throw Error('Timeout at ' + result.stage); }
const { RemoteCompanionServer } = require(path.join(source, 'desktop/lib/remote-server.cjs'));
const start = RemoteCompanionServer.prototype.start;
RemoteCompanionServer.prototype.start = function() {
  this.address = '127.0.0.1'; this.port = 0; this.allowLoopbackForTests = true;
  const state = this.callbacks.getState;
  this.callbacks.getState = async (...args) => {
    const value = await state(...args);
    // Emulate a phone whose cached setting predates a PC conversion change.
    return { ...value, voice: { ...value.voice, realtimeConversion: 'none' } };
  };
  return start.call(this);
};
require(path.join(source, 'desktop/main.cjs'));
let phone;
const guard = setTimeout(() => { result.stage = 'failed'; result.error = 'Timeout'; save(); app.exit(1); }, 180000);
(async () => {
  await app.whenReady(); let control;
  await until(() => { control = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/control.html') && !w.webContents.isLoading()); return control; });
  const js = code => control.webContents.executeJavaScript(code); await sleep(800);
  await js("window.mascotDesktop.setRemoteConfig({enabled:true,responseMode:'live',ttsEnabled:true,pcAudioEnabled:false,port:42319})");
  const status = await js('window.mascotDesktop.getRemoteStatus()'); assert.ok(status.pairingUrl);
  phone = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { sandbox: true, contextIsolation: true,
    partition: `network-audio-${Date.now()}`, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false } });
  phone.webContents.setAudioMuted(true);
  phone.webContents.session.webRequest.onBeforeRequest({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    setTimeout(() => callback({}), /\/api\/(?:live\/beatrice\/audio|tts\/next)/.test(details.url) ? 200 : 0);
  });
  await phone.loadURL(status.pairingUrl); const pj = code => phone.webContents.executeJavaScript(code);
  await until(() => pj("document.querySelector('#pairingView').hidden"));
  const inputWave = fs.readFileSync(inputWavePath).toString('base64');
  await pj(`window.stats={uploads:0,maxUploadSamples:0,scheduled:0,voicedSamples:0,playbackGaps:0};
    const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer{constructor(...args){super(...args);this.addEventListener('connectionstatechange',()=>{stats.peerState=this.connectionState;});}};
    const fetchOriginal=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await fetchOriginal(...args);
      if(String(args[0]).includes('/api/live/start')){const r=await response.clone().json();stats.startReturned=true;stats.startError=r.beatriceError||r.error;stats.beatriceActive=r.beatriceActive;stats.sessionConfirmed=!!r.beatriceSessionId;}
      return response;};
    const upload=CharaDockPcmSpeech.createUploadQueue;CharaDockPcmSpeech.createUploadQueue=options=>upload({...options,send:samples=>{stats.uploads++;stats.maxUploadSamples=Math.max(stats.maxUploadSamples,samples.length);return options.send(samples);}});
    const queue=CharaDockPcmSpeech.createQueue;CharaDockPcmSpeech.createQueue=options=>queue({...options,onSchedule:item=>{stats.scheduled++;if(stats.end&&item.start-stats.end>.002)stats.playbackGaps++;stats.end=item.start+item.duration;for(const s of item.samples)if(Math.abs(s)>.0001)stats.voicedSamples++;options.onSchedule?.(item);}});
    navigator.mediaDevices.getUserMedia=async()=>{window.testContext=new AudioContext();await testContext.resume();window.testMicOut=testContext.createMediaStreamDestination();const osc=testContext.createOscillator(),mute=testContext.createGain();mute.gain.value=0;osc.connect(mute).connect(testMicOut);osc.start();return testMicOut.stream;};void 0;`);
  result.stage = 'live-beatrice'; save();
  await pj("document.querySelector('#microphoneButton').click()");
  await until(async () => { const state = await pj('stats'); if (state.startReturned && !state.beatriceActive) throw Error('Beatrice start failed: ' + state.startError); return state.sessionConfirmed; });
  await until(() => pj("stats.peerState==='connected'"));
  await sleep(500);
  // A real spoken microphone turn elicits native Live output; appendText is
  // context-only on some server versions and is not an audio test.
  await pj(`(async()=>{const bytes=Uint8Array.from(atob('${inputWave}'),c=>c.charCodeAt(0));const audio=await testContext.decodeAudioData(bytes.buffer);const source=testContext.createBufferSource();source.buffer=audio;source.connect(testMicOut);source.start();})()`);
  await until(() => pj('stats.voicedSamples>4800'), 60000);
  await sleep(8000);
  result.live = await pj('stats');
  assert.equal(result.live.beatriceActive, true); assert.ok(result.live.maxUploadSamples > 3840);
  assert.equal(result.live.playbackGaps, 0);
  fs.writeFileSync(path.join(output, 'phone-live.png'), (await phone.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'pc.png'), (await control.capturePage()).toPNG());
  await pj("document.querySelector('#microphoneButton').click()"); await sleep(800);
  result.stage = 'standard-tts'; save();
  result.tts = await pj(`(async()=>{const state=await(await fetch('/api/state')).json();
    const post=async(url,body)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CharaDock-CSRF':state.csrfToken},body:JSON.stringify(body)});if(!r.ok)throw Error('TTS HTTP '+r.status);return r.json();};
    const first=await post('/api/tts',{text:'音声テストです。少し長めの文章を、途切れずになめらかに読み上げます。'});
    if(first.error)throw Error(first.error);let chunks=0,samples=0;
    if(first.pcmChunk){const context=new AudioContext();const player=CharaDockPcmSpeech.create({context,bufferMs:300,next:id=>post('/api/tts/next',{streamId:id})});
      const begin=context.createBufferSource.bind(context);context.createBufferSource=()=>{const source=begin();chunks++;return source;};await player.play(first);await context.close();return{pcm:true,chunks};}
    await CharaDockPcmSpeech.playChunks({first,next:id=>post('/api/tts/next',{streamId:id}),play:async part=>{for(const item of CharaDockRemoteSpeechCaption.audioChunks(part,'')){const r=await fetch(item.url);if(!r.ok)throw Error('Audio fetch failed');const context=new AudioContext();const audio=await context.decodeAudioData(await r.arrayBuffer());samples+=audio.length;chunks++;await context.close();}return true;}});return{pcm:false,chunks,samples};})()`);
  assert.ok(result.tts.chunks > 0); result.stage = 'passed'; result.passed = true; save();
  clearTimeout(guard); phone.destroy(); app.quit();
})().catch(async error => { result.stage = 'failed'; result.error = String(error.message).replace(/eyJ[\w.-]+/g, '[redacted]').slice(0, 600);
  if (phone && !phone.isDestroyed()) {
    result.phone = await phone.webContents.executeJavaScript("({stats:window.stats,hint:document.querySelector('#voiceRouteHint')?.textContent,connection:document.querySelector('#connectionStatus')?.textContent})").catch(() => null);
    fs.writeFileSync(path.join(output, 'phone-failed.png'), (await phone.capturePage()).toPNG());
  }
  save(); clearTimeout(guard); phone?.destroy(); app.exit(1); });
