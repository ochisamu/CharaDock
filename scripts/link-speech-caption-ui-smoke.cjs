// SPDX-License-Identifier: Apache-2.0
// Real WebAudio timing with silent fixture WAVs. No microphone/model/user data.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,output]=process.argv.slice(2);
if(!source||!output||fs.existsSync(path.join(output,'profile')))throw Error('Supply SOURCE and fresh OUTPUT');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
const {RemoteCompanionServer}=require(path.join(source,'desktop/lib/remote-server.cjs'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const guard=setTimeout(()=>app.exit(1),90000);
function silentWav(seconds=1) {
  const samples=Math.round(16000*seconds),b=Buffer.alloc(44+samples*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
  return 'data:audio/wav;base64,'+b.toString('base64');
}
(async()=>{
  await app.whenReady();const wav=silentWav(),chunks=['最初の音声です。','二つ目の音声を読んでいます。','三つ目で読み上げが終わります。'];
  const full=chunks.join('')+'全文はここからも履歴で読めます。'.repeat(20);
  let nextIndex=1,ttsRequests=0;
  const files={backHair:'back-hair.png',frontHair:'front-hair.png'};
  for(const e of ['open','closed'])for(const m of ['closed','half','open'])files[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`]=`eyes-${e}-mouth-${m}.png`;
  let state={language:'ja',character:{id:'amber-avatar',name:'コハク',assetKeys:Object.keys(files),motion:{}},characters:[{id:'amber-avatar',name:'コハク'}],
    voice:{responseMode:'tts'},mobileTtsAllowed:true,workAllowed:true,conversationHistory:[],workHistory:{runs:[]},lastDisplayText:'以前の回答'};
  const server=new RemoteCompanionServer({rootDir:path.join(source,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,
    callbacks:{getState:()=>state,getAvatarAsset:key=>files[key]?{body:fs.readFileSync(path.join(source,'assets/amber-avatar',files[key])),contentType:'image/png'}:null,
      sendMessage:()=>{server.publish('stream',{phase:'start',turnId:'fixture-turn',remoteTtsEnabled:true});
        server.publish('stream',{phase:'done',turnId:'fixture-turn',audioRoute:'mobile-tts',text:full,displayText:full,speechSegments:[{text:chunks.join('')} ]});
        state={...state,lastDisplayText:full};return {accepted:true};},
      synthesizeTts:()=>{ttsRequests++;return {audioDataUrls:[wav],audioTexts:[chunks[0]],streamId:'fixture-tts'};},
      nextTtsChunk:()=>{const i=nextIndex++;return {audioDataUrl:wav,audioText:chunks[i],done:i===2};},
      cancelTts:()=>({cancelled:true}),
    }});
  await server.start();const win=new BrowserWindow({width:430,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  win.webContents.setAudioMuted(true);await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');
  const cdp=(method,params={})=>win.webContents.debugger.sendCommand(method,params);
  await cdp('Page.enable');await cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.qaAudioStarts=[];window.qaErrors=[];const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer.duration>.5)window.qaAudioStarts.push({
      caption:document.querySelector('#responseText').textContent,full:document.querySelector('#historyCurrentText').textContent,
      current:document.querySelector('.caption-current')?.textContent});return start.apply(this,args);};
    window.addEventListener('error',e=>window.qaErrors.push(e.message));`});
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await win.loadURL(server.pairingUrl());win.showInactive();const js=code=>win.webContents.executeJavaScript(code);
  for(let i=0;i<100&&await js("document.querySelector('#companionView').hidden");i++)await sleep(100);
  await js("document.querySelector('#messageInput').value='fixture';document.querySelector('#sendButton').click()");
  for(let i=0;i<150&&await js('window.qaAudioStarts.length')<3;i++) {
    if(await js('window.qaAudioStarts.length')>0)server.publish('state',state); // hostile full-answer snapshots while speaking
    await sleep(80);
  }
  const starts=await js('window.qaAudioStarts');assert.equal(ttsRequests,1);assert.equal(nextIndex,3);assert.equal(starts.length,3);
  assert.deepEqual(starts.map(x=>x.current),chunks);
  assert.deepEqual(starts.map(x=>x.caption),[chunks[0],chunks.slice(0,2).join('\n'),chunks.slice(1).join('\n')]);
  assert.ok(starts.every(x=>x.full===full),'full answer is independent');
  await sleep(1200);server.publish('state',state);await sleep(150);
  assert.equal(await js("document.querySelector('#responseText').textContent"),chunks.slice(1).join('\n'));
  await js("document.querySelector('#bubbleExpandButton').click()");
  assert.equal(await js("document.querySelector('#historySheet').open"),true);
  assert.equal(await js("document.querySelector('#historyCurrentText').textContent"),full);
  await js("document.querySelector('#closeHistoryButton').click()");
  fs.writeFileSync(path.join(output,'caption.png'),(await win.capturePage()).toPNG());
  server.publish('stream',{phase:'realtime-caption',audioRoute:'live',text:'過去の文。次の文。現在の文。'});await sleep(200);
  assert.equal(await js("document.querySelector('#responseText').textContent"),'次の文。現在の文。');
  assert.deepEqual(await js('window.qaErrors'),[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,starts,scope:'actual WebAudio starts/decoding, silent fixture WAVs and paired HTTP/SSE; no real TTS/API/mic'},null,2));
  clearTimeout(guard);win.destroy();await server.stop();console.log('PASS Link captions: 3 actual audio starts, singular continuation chunks, snapshot protection, full answer, Live window');app.quit();
})().catch(e=>{console.error(e.stack);app.exit(1);});
