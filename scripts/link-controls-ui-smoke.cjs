// SPDX-License-Identifier: Apache-2.0
// Coordinate-based touch/mouse regression checks. Isolated profile, fixture API,
// no real microphone, model calls, or user preferences.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const [source, output] = process.argv.slice(2);
if (!source || !output || fs.existsSync(path.join(output, 'profile'))) throw Error('Supply SOURCE and fresh OUTPUT');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const { RemoteCompanionServer } = require(path.join(source, 'desktop/lib/remote-server.cjs'));
const { kohakuPackage } = require(path.join(source, 'desktop/lib/remote-kohaku.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const guard = setTimeout(() => app.exit(1), 120000);
(async () => {
  await app.whenReady();
  const pack = kohakuPackage(source);
  const files = { backHair: 'back-hair.png', frontHair: 'front-hair.png' };
  for (const e of ['open', 'closed']) for (const m of ['closed', 'half', 'open'])
    files[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`] = `eyes-${e}-mouth-${m}.png`;
  let pets = 0, messages = 0, interrupts = 0;
  let state = { language: 'ja', character: { id: 'amber-avatar', name: 'コハク', assetKeys: Object.keys(files),
    motion: {}, authoredMotion: { manifestUrl: '/api/authored/manifest.json', version: pack.version } },
    characters: [{ id: 'amber-avatar', name: 'コハク' }], voice: { responseMode: 'tts' },
    conversationHistory: [], workHistory: { runs: [] }, workAllowed: true, mobileTtsAllowed: true };
  const server = new RemoteCompanionServer({ rootDir: path.join(source, 'desktop/remote'), address: '127.0.0.1',
    port: 0, allowLoopbackForTests: true, callbacks: {
      getState: () => state, getAuthoredAsset: f => pack.read(f),
      getAvatarAsset: key => files[key] ? { body: fs.readFileSync(path.join(source, 'assets/amber-avatar', files[key])), contentType: 'image/png' } : null,
      pet: () => { pets++; return { text: 'fixture', emotion: 'happy' }; },
      sendMessage: () => { messages++; return { accepted: true }; },
      interrupt: () => { interrupts++; return { ok: true }; },
    } });
  await server.start();
  const win = new BrowserWindow({ width: 430, height: 900, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true } });
  win.webContents.setAudioMuted(true);
  await win.loadURL('about:blank');
  const cdp = (method, params = {}) => win.webContents.debugger.sendCommand(method, params);
  win.webContents.debugger.attach('1.3'); await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.linkQaClicks=[];window.linkQaMicStarts=0;window.linkQaErrors=[];
    document.addEventListener('click',e=>window.linkQaClicks.push(e.target.closest('button,textarea')?.id),true);
    window.addEventListener('error',e=>window.linkQaErrors.push(e.message));
    window.SpeechRecognition=class {start(){window.linkQaMicStarts++;} abort(){} stop(){}};
    navigator.mediaDevices.getUserMedia=async()=>{throw new Error('QA never opens a microphone');};
  ` });
  await win.loadURL(server.pairingUrl()); win.showInactive();
  const js = code => win.webContents.executeJavaScript(code);
  for (let i=0;i<300 && await js("document.querySelector('#companionView').hidden");i++) await sleep(100);
  assert.equal(await js("document.querySelector('#companionView').hidden"), false);
  const results = [];
  async function click(id, touch = true) {
    const point = await js(`(()=>{const el=document.getElementById(${JSON.stringify(id)}),r=el.getBoundingClientRect();
      const x=r.x+r.width/2,y=r.y+r.height/2;
      return {x,y,target:document.elementFromPoint(x,y)?.closest('button,textarea')?.id,disabled:el.disabled};})()`);
    assert.equal(point.target, id, `${id} hit target at ${point.x},${point.y}: ${point.target}`);
    assert.equal(point.disabled, false, `${id} enabled`);
    const count = await js('window.linkQaClicks.length');
    if (touch) {
      await cdp('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
      await cdp('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    } else {
      for(const type of ['mousePressed','mouseReleased'])
        await cdp('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1});
    }
    await sleep(120);
    assert.equal(await js(`window.linkQaClicks[${count}]`), id, `${id} receives real click`);
  }
  for (const authored of [true, false]) {
    state = {...state, character: {...state.character, authoredMotion: authored ? {manifestUrl:'/api/authored/manifest.json',version:pack.version} : null}};
    server.publish('state', state); await sleep(authored ? 2200 : 250);
    for (const [width,height] of [[360,640],[390,844],[430,900],[844,390],[1024,768]]) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
      await cdp('Emulation.setTouchEmulationEnabled',{enabled:true}); await sleep(200);
      const initialPets=pets;
      await click('settingsButton'); assert.equal(await js("document.querySelector('#settingsSheet').open"),true);
      await click('closeSettingsButton');
      await click('historyButton'); assert.equal(await js("document.querySelector('#historySheet').open"),true);
      await click('closeHistoryButton');
      await click('workModeButton'); assert.equal(await js("document.querySelector('#workModeButton').getAttribute('aria-checked')"),'true');
      await click('chatModeButton');
      const audioBefore=await js("document.querySelector('#audioButton').classList.contains('is-active')");
      await click('audioButton'); assert.notEqual(await js("document.querySelector('#audioButton').classList.contains('is-active')"),audioBefore);
      await click('microphoneButton'); await click('microphoneButton');
      await click('messageInput'); assert.equal(await js('document.activeElement.id'),'messageInput');
      await cdp('Input.insertText',{text:'fixture control test'});
      const initialMessages=messages;
      await click('sendButton'); assert.equal(messages,initialMessages+1);
      const initialInterrupts=interrupts;
      await click('interruptButton'); assert.equal(interrupts,initialInterrupts+1);
      server.publish('stream',{phase:'done',text:'fixture done',audioRoute:'none'}); await sleep(220);
      assert.equal(pets,initialPets,'dock never triggers character API');
      // Model a stale compositor target underneath the dock. No pressed
      // feedback, drag, character speech, or stop-speech action may run.
      await js(`(()=>{const r=document.querySelector('.control-dock').getBoundingClientRect(),el=document.querySelector('#avatarTapTarget');
        const point={bubbles:true,clientX:r.x+r.width/2,clientY:r.y+10};
        el.dispatchEvent(new PointerEvent('pointerdown',{...point,isPrimary:true,pointerType:'touch'}));
        el.dispatchEvent(new MouseEvent('click',{...point,detail:1}));})()`);
      await sleep(120); assert.equal(pets,initialPets,'stale dock hit must not pet');
      assert.equal(await js("document.querySelector('#avatarTapTarget').classList.contains('is-pressed')"),false);
      if(width===430) { await click('settingsButton',false); await click('closeSettingsButton',false); }
      results.push({authored,width,height,passed:true});
      if(width===430)fs.writeFileSync(path.join(output,authored?'authored.png':'legacy.png'),(await win.capturePage()).toPNG());
    }
  }
  assert.ok(await js('window.linkQaMicStarts') > 0,'fixture recognition received start');
  await cdp('Emulation.setDeviceMetricsOverride',{width:430,height:900,deviceScaleFactor:2,mobile:true});
  const initialPets=pets;
  const p=await js("(()=>{const r=document.querySelector('#avatarTapTarget').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.45};})()");
  await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
  await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await sleep(180);
  assert.equal(pets,initialPets+1,'actual character touch still works');
  assert.deepEqual(await js('window.linkQaErrors'),[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,results,pets,messages,interrupts,
    scope:'actual coordinate touch and mouse, fixture recognition/API; not real mobile hardware'},null,2));
  clearTimeout(guard); win.destroy(); await server.stop(); console.log('PASS Link controls',JSON.stringify(results)); app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
