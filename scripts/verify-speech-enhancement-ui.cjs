// SPDX-License-Identifier: Apache-2.0
// Run only with a sanitized QA profile containing model links, never the live profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const [source, profile, output, audioFile] = process.argv.slice(2);
fs.mkdirSync(output,{recursive:true}); app.setName('CharaDock'); app.setPath('userData',profile); app.getAppPath=()=>source;
process.argv.push('--charadock-user-data',profile);
process.env.CODEX_HOME=path.join(profile,'codex-home');fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
const handlers=new Map(), errors=[], tts=[];
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,callback)=>{handlers.set(channel,callback);originalHandle(channel,async(event,...args)=>{
 const value=await callback(event,...args); if(['tts:synthesize','tts:nextChunk'].includes(channel)&&value?.pcmChunk)tts.push(Buffer.from(value.pcmChunk,'base64'));return value;
});};
app.on('web-contents-created',(_event,contents)=>{contents.setAudioMuted(true);contents.on('console-message',(_e,details)=>{if(/Uncaught|ReferenceError|TypeError|Unable to load preload/.test(details?.message||''))errors.push(details.message);});});
const { SpeechEnhancement }=require(path.join(source,'desktop/lib/speech-enhancement.cjs'));
const enhance=SpeechEnhancement.prototype.enhance, calls=[];
SpeechEnhancement.prototype.enhance=async function(payload,options){const result=await enhance.call(this,payload,options);calls.push({enhanced:result.enhanced,samples:result.samples.length});return result;};
require(path.join(source,'desktop/main.cjs'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('UI verification timed out');}
const result={stage:'starting',checks:[]};
const save=()=>fs.writeFileSync(path.join(output,'ui-verification.json'),JSON.stringify(result,null,2));
(async()=>{
 await app.whenReady();let control,mascot;
 await wait(()=>{control=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());mascot=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=obs')&&!w.webContents.isLoading());return control&&mascot;});
 const js=code=>control.webContents.executeJavaScript(code);
 await wait(()=>js("Boolean(window.mascotDesktop && document.querySelector('#speechEnhancementToggle'))"));await sleep(700);
 assert.equal(app.getPath('userData'),profile);
 await js("document.querySelector('[data-page=voice-input]').click();document.querySelector('#speechNoiseDetails').open=true;document.querySelector('#speechEnhancementSettings').scrollIntoView({block:'center'})");
 control.showInactive();
 const state=await js('window.mascotDesktop.getState()');assert.equal(state.speechEnhancement.installed,true);assert.equal(state.speechEnhancementEnabled,true);
 assert.equal(await js("document.querySelector('#speechEnhancementToggle').disabled"),false);result.checks.push('installed and enabled in local-input settings');save();
 const bytes=fs.readFileSync(audioFile).subarray(44), encoded=bytes.toString('base64');
 await js(`{const raw=atob(${JSON.stringify(encoded)});window.reuseQA=Array.from({length:raw.length/2},(_,i)=>{let v=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);if(v>=32768)v-=65536;return v/32768;});}`);
 await js("document.querySelector('#speechEnhancementToggle').click()");await wait(async()=>!(await js('window.mascotDesktop.getState()')).speechEnhancementEnabled);
 result.off=await js("(async()=>{const api=window.mascotDesktop;await api.startStreamingSpeech({sessionId:'reuse-off'});await api.appendStreamingSpeech({sessionId:'reuse-off',samples:window.reuseQA,sampleRate:16000});return api.finishStreamingSpeech({sessionId:'reuse-off'});})()");
 assert.ok(result.off.text);assert.equal(calls.at(-1).enhanced,false);result.checks.push('settings chat input bypasses RE-USE when off');save();
 await js("document.querySelector('#speechEnhancementToggle').click()");await wait(async()=>(await js('window.mascotDesktop.getState()')).speechEnhancementEnabled);
 result.on=await js("(async()=>{const api=window.mascotDesktop;await api.startStreamingSpeech({sessionId:'reuse-on'});await api.appendStreamingSpeech({sessionId:'reuse-on',samples:window.reuseQA,sampleRate:16000});return api.finishStreamingSpeech({sessionId:'reuse-on'});})()");
 assert.ok(result.on.text);assert.equal(calls.at(-1).enhanced,true);result.checks.push('settings chat input enhances only the final recognition');save();
 const samples=new Float32Array(bytes.length/2);for(let i=0;i<samples.length;i++)samples[i]=bytes.readInt16LE(i*2)/32768;
 result.mascot=await handlers.get('mascotInline:transcribeStreamingSpeech')({sender:mascot.webContents,senderFrame:mascot.webContents.mainFrame},{samples,sampleRate:16000});
 assert.ok(typeof result.mascot === 'string' && result.mascot.length);assert.equal(calls.at(-1).enhanced,true);result.checks.push('desktop mascot IPC uses the same enhancer');save();
 await js("document.querySelector('#ttsTestButton').click()");
 await wait(async()=>tts.length>0&&!(await js("document.querySelector('#ttsTestButton').disabled")),180000);
 const {waveDataUrl}=require(path.join(source,'desktop/lib/speech-cpp-client.cjs'));
 fs.writeFileSync(path.join(output,'settings-button.wav'),Buffer.from(waveDataUrl(Buffer.concat(tts).toString('base64'),48000).split(',')[1],'base64'));
 result.checks.push('actual voice-test button finishes with native speech.cpp audio');
 assert.deepEqual(errors,[]);result.errors=errors;result.stage='complete';result.passed=true;save();
 await js("document.querySelector('#speechEnhancementSettings').scrollIntoView({block:'center'})");
 console.log('UI_VERIFICATION_COMPLETE');
})().catch(error=>{result.stage='failed';result.error=error.stack;result.errors=errors;save();console.error(error.message);app.exit(1);}).finally(()=>{if(!process.argv.includes('--keep-open')&&result.passed)app.quit();});