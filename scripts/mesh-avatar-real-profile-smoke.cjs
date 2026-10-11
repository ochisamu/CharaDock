// SPDX-License-Identifier: Apache-2.0
// Run only after the normal app using PROFILE has exited. Imports the requested project and keeps the app open.
const {app,BrowserWindow,dialog}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,profile,project,output]=process.argv.slice(2);
if(!source||!profile||!project||!output||!fs.existsSync(path.join(profile,'preferences.json')))throw Error('Supply SOURCE, existing PROFILE, PROJECT and OUTPUT');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',profile);app.setName('CharaDock');app.getAppPath=()=>source;
const errors=[];app.on('web-contents-created',(_event,c)=>c.on('console-message',(_event,d)=>{if(/Uncaught|ReferenceError|TypeError|Mesh avatar unavailable/.test(d?.message||''))errors.push(d.message);}));
require(path.join(source,'desktop/main.cjs'));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const guard=setTimeout(()=>{fs.writeFileSync(path.join(output,'error.txt'),'Real profile Mesh verification timeout');},180000);
(async()=>{
 await app.whenReady();let control,mascot;
 for(let i=0;i<200;i++){control=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());mascot=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=obs'));if(control&&mascot)break;await sleep(150);}
 assert.ok(control);assert.ok(mascot);const js=code=>control.webContents.executeJavaScript(code),pc=code=>mascot.webContents.executeJavaScript(code);
 await sleep(600);const before=await js('window.mascotDesktop.getState()');assert.equal(before.characterId,'amber-avatar','Activate Kohaku before this verification');
 await mascot.loadURL(mascot.webContents.getURL()+'&mesh-avatar-preview=1');
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});const imported=await js('window.mascotDesktop.importMeshAvatar()');dialog.showOpenDialog=originalPicker;
 assert.equal(imported.characterId,before.characterId);assert.deepEqual(imported.characterProfiles,before.characterProfiles);assert.deepEqual(imported.characterTts,before.characterTts);
 assert.deepEqual(imported.conversationHistory,before.conversationHistory);assert.equal(imported.ttsProvider,before.ttsProvider);
 for(let i=0;i<250;i++){if(await pc('window.CharaDockMeshPreview?.status().ready'))break;await sleep(150);}
 assert.equal(await pc('window.CharaDockMeshPreview.status().ready'),true);
 control.showInactive();await js(`document.querySelector('[data-page="character"]').click()`);await sleep(100);await js(`document.querySelector('#characterAppearanceTitle').scrollIntoView({block:'center'})`);await sleep(400);
 fs.writeFileSync(path.join(output,'settings.png'),(await control.capturePage()).toPNG());fs.writeFileSync(path.join(output,'mascot.png'),(await mascot.capturePage()).toPNG());
 // Use the profile's configured local voice through the normal mascot playback/envelope path.
 mascot.webContents.send('mascot:speech',{text:'新しい見た目も選べるようになったよ。',durationMs:12000,ttsEnabled:before.ttsEnabled,ttsProvider:before.ttsProvider,speechLanguage:'ja-JP'});
 let mouthMoved=false,peak=0;
 for(let i=0;i<500;i++){const mouth=(await pc('window.CharaDockMeshPreview.status().parameters'))?.mouthOpen||0;peak=Math.max(peak,mouth);mouthMoved ||= mouth>.05;
 if(mouthMoved && i>10 && mouth<.01)break;await sleep(150);}
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,appearance:imported.avatarAppearance.selected,voiceProvider:before.ttsProvider,
 realProfile:true,namePersonaVoiceHistoryPreserved:true,renderReady:true,mouthMoved,peak,errors},null,2));
 assert.deepEqual(errors,[]);clearTimeout(guard);console.log('PASS real-profile Mesh import; audio mouth movement:',mouthMoved);
 // Restore the native picker before leaving this normal development app open.
 dialog.showOpenDialog=originalPicker;
})().catch(error=>{clearTimeout(guard);fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(error.stack);dialog.showOpenDialog=originalPicker;});
const originalPicker=dialog.showOpenDialog;
