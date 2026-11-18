// SPDX-License-Identifier: Apache-2.0
// Only after the normal app has exited. Selects Kohaku's local prototype and leaves the development app open.
const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,profile,output]=process.argv.slice(2);if(!source||!profile||!output)throw Error('Supply SOURCE PROFILE OUTPUT');
fs.mkdirSync(output,{recursive:true});app.setName('CharaDock');app.setPath('userData',profile);app.getAppPath=()=>source;process.argv.push('--charadock-user-data',profile);
const errors=[],levels=[];const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,fn)=>handle(channel,async(event,...args)=>{if(channel==='mascotInline:voice')levels.push(Number(args[0])||0);return fn(event,...args);});
app.on('web-contents-created',(_event,c)=>{c.setAudioMuted(true);c.on('console-message',(_e,d)=>{if(/Uncaught|ReferenceError|TypeError|LivLiv avatar unavailable/.test(d?.message||''))errors.push(d.message);});});
require(path.join(source,'desktop/main.cjs'));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('Real profile LivLiv verification timed out');}
const result={};const save=()=>fs.writeFileSync(path.join(output,'real-profile.json'),JSON.stringify(result,null,2));
(async()=>{await app.whenReady();let control,mascot;
await wait(()=>{control=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());mascot=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=obs')&&!w.webContents.isLoading());return control&&mascot;});
const js=code=>control.webContents.executeJavaScript(code),pc=code=>mascot.webContents.executeJavaScript(code);await sleep(600);
const before=await js('window.mascotDesktop.getState()');assert.equal(before.characterId,'amber-avatar');result.previousAppearance=before.avatarAppearance.selected;
await mascot.loadURL(mascot.webContents.getURL()+'&livliv-avatar-preview=1');
await js("window.mascotDesktop.setCharacterAppearance('livliv-kohaku')");await wait(()=>pc('window.CharaDockLivlivPreview?.status().ready'));
const selected=await js('window.mascotDesktop.getState()');assert.deepEqual(selected.characterTts,before.characterTts);assert.deepEqual(selected.conversationHistory,before.conversationHistory);result.settingsPreserved=true;result.nativeVoice=selected.ttsProvider;
const {Preferences}=require(path.join(source,'desktop/lib/preferences.cjs'));assert.equal(new Preferences(path.join(profile,'preferences.json')).data.characterAvatarSelections['amber-avatar'],'livliv-kohaku');result.savedAcrossReload=true;save();
mascot.webContents.send('mascot:speech',{text:'新しい見た目も試せるよ。これからよろしくね。',durationMs:15000,ttsEnabled:true,ttsProvider:before.ttsProvider,speechLanguage:before.speechLanguage||'ja-JP'});
const expectedExpression=selected.avatarAppearance.livliv.controls?.expression||'worried';
await js("window.mascotDesktop.setExpression({emotion:'worried',durationMs:10000})");
const seenExpressions=new Set();let expressionRequested=false;
let peak=0,closedSince=0;const started=Date.now();
await wait(async()=>{const status=await pc('window.CharaDockLivlivPreview.status()'),p=status.parameters;if(p?.mouthOpen>.05){if(status.activeExpression)seenExpressions.add(status.activeExpression);if(!expressionRequested){expressionRequested=true;await js("window.mascotDesktop.setExpression({emotion:'worried',durationMs:10000})");}}result.seenExpressions=[...seenExpressions];result.realTtsPeak=peak;peak=Math.max(peak,p?.mouthOpen||0);if(peak>.05&&p.mouthOpen<.01){closedSince ||= Date.now();return Date.now()-closedSince>1300&&Date.now()-started>7000;}closedSince=0;return false;});
assert.ok(seenExpressions.has(expectedExpression));result.expressionDuringRealSpeech=expectedExpression;
await js("window.mascotDesktop.setExpression({emotion:'neutral',durationMs:100})");
assert.ok(levels.some(v=>v>.01));assert.ok(peak>.05);assert.deepEqual(errors,[]);result.realTtsMouthMoved=true;result.peakMouth=peak;result.levelEvents=levels.length;result.errors=errors;result.passed=true;save();
for(const window of BrowserWindow.getAllWindows())window.webContents.setAudioMuted(false);
await js("document.querySelector('[data-page=character]').click();document.querySelector('#characterAppearanceTitle').scrollIntoView({block:'center'})");control.showInactive();console.log('REAL_PROFILE_LIVLIV_PASSED');
})().catch(error=>{result.error=error.stack;result.errors=errors;save();for(const window of BrowserWindow.getAllWindows())window.webContents.setAudioMuted(false);console.error(error.message);});
