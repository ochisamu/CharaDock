// Boot the real app in an isolated QA profile; leave the running user app alone.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const [source,model,output]=process.argv.slice(2);
if(!output)throw new Error('ui-smoke.cjs SOURCE MF_MODEL OUTPUT');
const profile=path.join(output,'profile');
fs.mkdirSync(profile,{recursive:true});
if(fs.existsSync(path.join(profile,'preferences.json')))throw new Error('Use a fresh QA output directory');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({onboardingComplete:true,continuationStartupSpeechEnabled:false,launchAtLogin:false,remoteAccessEnabled:false,irodoriMfModelDirectory:model}));
app.setPath('userData',profile);
app.setName('CharaDock MF QA');
app.getAppPath=()=>source;
// Do not modify OS startup configuration from this disposable test profile.
app.setLoginItemSettings=()=>{};
require(path.join(source,'desktop/main.cjs'));
const timeout=setTimeout(()=>{console.error('QA timeout');app.exit(1);},120000);
(async()=>{
 await app.whenReady();
 let window;
 for(let i=0;i<100;i++){
   window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());
   if(window)break;
   await new Promise(r=>setTimeout(r,300));
 }
 assert.ok(window,'Settings window must load');
 const state=await window.webContents.executeJavaScript(`window.mascotDesktop.saveSettings({ttsEnabled:true,ttsProvider:'irodori-webgpu',irodoriVersion:'v4-mf',irodoriPrecision:'int4',irodoriMode:'reference',irodoriVoiceId:'builtin-kohaku',irodoriCaption:'自然で明瞭な日本語。',launchAtLogin:false})`);
 assert.equal(state.irodoriVersion,'v4-mf');assert.equal(state.irodoriPrecision,'fp16');assert.equal(state.irodori.modelReady,true);
 await new Promise(r=>setTimeout(r,500));
 const ui=await window.webContents.executeJavaScript(`(()=>{
   const select=document.querySelector('#irodoriVersionSelect');
   const precision=document.querySelector('#irodoriPrecisionSelect');
   return {version:select.value,precision:precision.value,locked:precision.disabled,downloadHidden:getComputedStyle(document.querySelector('#irodoriModelDownloadButton').closest('.local-model-download')).display==='none',title:document.querySelector('#irodoriV4Title').textContent,generation:document.querySelector('#irodoriV4GenerationProfile').textContent};
 })()`);
 assert.equal(ui.version,'v4-mf');assert.equal(ui.precision,'fp16');assert.equal(ui.locked,true);assert.equal(ui.downloadHidden,true);
 assert.match(ui.generation,/4ステップ/);assert.doesNotMatch(ui.generation,/16ステップ/);
 const result=await window.webContents.executeJavaScript(`window.mascotDesktop.synthesizeTts('こんにちは。今日はいい天気ですね。')`);
 fs.writeFileSync(path.join(output,'ui.json'),JSON.stringify({ui,ready:state.irodori.ready,resultKeys:Object.keys(result)},null,2));
 const audio=result.audioDataUrl||result.audioDataUrls?.[0];
 if(audio){fs.writeFileSync(path.join(output,'preview.wav'),Buffer.from(audio.split(',')[1],'base64'));}
 else throw new Error(result.error||'TTS preview did not return audio');
 assert.ok(result.streamId,'Multi-sentence preview must create a stream');
 assert.equal(await window.webContents.executeJavaScript(`window.mascotDesktop.cancelTtsStream(${JSON.stringify(result.streamId)})`),true);
 const cancelled=await window.webContents.executeJavaScript(`window.mascotDesktop.nextTtsChunk(${JSON.stringify(result.streamId)})`);
 assert.equal(cancelled.done,true);assert.equal(cancelled.audioDataUrl,undefined);
 window.showInactive();
 await window.webContents.executeJavaScript(`document.querySelector('.nav-tab[data-page="voice"]').click()`);
 await new Promise(r=>setTimeout(r,250));
 await window.webContents.executeJavaScript(`document.querySelector('#irodoriSettings').scrollIntoView({block:'start'});document.querySelector('.main-panel').scrollBy(0,-100)`);
 await new Promise(r=>setTimeout(r,250));
 const visible=await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#irodoriVersionSelect').getBoundingClientRect();return document.querySelector('.nav-tab[data-page="voice"]').classList.contains('is-active')&&r.width>0&&r.top>=0&&r.bottom<innerHeight;})()`);
 assert.equal(visible,true);
 fs.writeFileSync(path.join(output,'settings.png'),(await window.capturePage()).toPNG());
 console.log('PASS: real settings save, MF selection/precision, main TTS preview and cancellation');
 clearTimeout(timeout);app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
