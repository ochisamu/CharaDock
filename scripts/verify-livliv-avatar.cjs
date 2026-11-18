// SPDX-License-Identifier: Apache-2.0
// Real Electron PC + paired Link; fresh QA profile only, never point this at the live profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,output]=process.argv.slice(2);
if(!source||!output||fs.existsSync(path.join(output,'profile')))throw Error('Supply SOURCE and fresh OUTPUT');
const profile=path.join(output,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setName('CharaDock LivLiv QA');app.getAppPath=()=>source;app.setLoginItemSettings=()=>{};
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({onboardingComplete:true,characterId:'amber-avatar',continuationStartupSpeechEnabled:false,launchAtLogin:false,remoteAccessEnabled:false,updateChecksEnabled:false,jevEnabled:false,atomEchoEnabled:false,characterDeviceProfiles:{'rlcd42-default':{enabled:false}},ttsEnabled:false}));
process.env.CODEX_HOME=path.join(output,'codex-fixture');fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
const errors=[],outside=[];app.on('web-contents-created',(_event,c)=>{c.setAudioMuted(true);c.on('console-message',(_event,d)=>{const m=d?.message||'';if(/Uncaught|ReferenceError|TypeError|LivLiv avatar unavailable/.test(m))errors.push(m);});});
require(path.join(source,'desktop/main.cjs'));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(100);}throw Error('LivLiv QA timeout');}
let server;const result={checks:[]};const save=()=>fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(result,null,2));
const guard=setTimeout(()=>{result.error='verification timeout';save();app.exit(1);},180000);
(async()=>{
 await app.whenReady();let control,mascot;
 await wait(()=>{control=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());mascot=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=obs')&&!w.webContents.isLoading());return control&&mascot;});
 const js=code=>control.webContents.executeJavaScript(code),pc=code=>mascot.webContents.executeJavaScript(code);await sleep(600);
 const before=await js('window.mascotDesktop.getState()');await mascot.loadURL(mascot.webContents.getURL()+'&livliv-avatar-preview=1');
 await js("document.querySelector('[data-page=character]').click();document.querySelector('#characterAppearanceSelect').value='livliv-kohaku';document.querySelector('#characterAppearanceSelect').dispatchEvent(new Event('change'))");
 await wait(()=>pc('window.CharaDockLivlivPreview?.status().ready'));await sleep(400);
 const selected=await js('window.mascotDesktop.getState()');assert.equal(selected.avatarAppearance.selected,'livliv-kohaku');assert.deepEqual(selected.characterTts,before.characterTts);assert.deepEqual(selected.conversationHistory,before.conversationHistory);
 result.checks.push('appearance selected through real settings; voice and history preserved');
 control.showInactive();await js("document.querySelector('#characterAppearanceTitle').scrollIntoView({block:'center'})");await sleep(200);
 fs.writeFileSync(path.join(output,'settings.png'),(await control.capturePage()).toPNG());fs.writeFileSync(path.join(output,'pc-neutral.png'),(await mascot.capturePage()).toPNG());
 await pc("window.CharaDockLivlivPreview.expression({emotion:'happy',forceMouth:2,forceEyesClosed:true,durationMs:600})");await sleep(150);
 let parameters=await pc('window.CharaDockLivlivPreview.status().parameters');assert.equal(parameters.mouthOpen,1);assert.equal(parameters.eyeLOpen,0);fs.writeFileSync(path.join(output,'pc-speaking.png'),(await mascot.capturePage()).toPNG());
 await sleep(750);assert.equal((await pc('window.CharaDockLivlivPreview.status().parameters')).mouthOpen,0);result.checks.push('PC real WebGL mouth, blink, smile, expiry');
 for(const emotion of ['thinking','worried','angry','surprised']){
  await js("window.mascotDesktop.setExpression("+JSON.stringify({emotion,durationMs:600})+")");
  await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().activeExpression'))===emotion);
 }
 result.checks.push('PC decision-style shared expression IPC selects all four authored expressions');
 const scoped={characterId:'amber-avatar',modelId:selected.avatarAppearance.livliv.id,version:selected.avatarAppearance.livliv.version};
 await js(`window.mascotDesktop.setLivlivControls(${JSON.stringify({...scoped,patch:{params:{angleX:12},view:{zoom:1.1},idle:false,motionStrength:1.3}})})`);
 await wait(async()=>Math.abs((await pc('window.CharaDockLivlivPreview.status().parameters')).angleX-12)<.01);
 assert.equal((await pc('window.CharaDockLivlivPreview.status().controls')).view.zoom,1.1);
 assert.equal((await pc('window.CharaDockLivlivPreview.status().controls')).motionStrength,1.3);
 await js(`window.mascotDesktop.livlivCommand(${JSON.stringify({...scoped,action:'blink'})})`);await sleep(50);assert.equal((await pc('window.CharaDockLivlivPreview.status().parameters')).eyeLOpen,0);await sleep(200);
 assert.ok((await pc('window.CharaDockLivlivSnapshot()')).startsWith('data:image/png;base64,'));
 await js(`window.mascotDesktop.setLivlivControls(${JSON.stringify({...scoped,patch:{paused:true}})})`);await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().controls')).paused);
 await js(`window.mascotDesktop.setLivlivControls(${JSON.stringify({...scoped,patch:{reset:true}})})`);
 result.checks.push('PC authoritative parameters/view, real SSE blink, pause/reset, PNG snapshot');
 const {dialog:saveDialog}=require('electron'),saveAs=saveDialog.showSaveDialog,snapshotPath=path.join(output,'saved-avatar.png');saveDialog.showSaveDialog=async()=>({canceled:false,filePath:snapshotPath});
 try{assert.equal((await js(`window.mascotDesktop.saveLivlivSnapshot(${JSON.stringify(scoped)})`)).saved,true);}finally{saveDialog.showSaveDialog=saveAs;}
 const {PNG}=require(path.join(source,'node_modules/pngjs'));const savedPng=PNG.sync.read(fs.readFileSync(snapshotPath));assert.equal(savedPng.width,768);assert.ok(savedPng.data.some((value,i)=>i%4===3&&value>0));
 result.checks.push('PC PNG save IPC writes a real nonempty transparent image through the native save dialog path');
 const AdmZip=require(path.join(source,'node_modules/adm-zip')),zip=new AdmZip(),modelDir=path.join(source,'assets/amber-avatar/livliv');
 for(const file of Object.keys(JSON.parse(fs.readFileSync(path.join(modelDir,'BUILD.json'))).files))zip.addFile('avatar/'+file,fs.readFileSync(path.join(modelDir,file)));
 const importedFile=path.join(output,'test-avatar.livliv');fs.writeFileSync(importedFile,zip.toBuffer());const {dialog}=require('electron'),open=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[importedFile]});
 try{await js('window.mascotDesktop.importLivlivAvatar()');}finally{dialog.showOpenDialog=open;}
 await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().ready'))&&(await pc('window.CharaDockLivlivPreview.status().identity')).split(':')[1]!=='kohaku');
 assert.ok(/^[a-f0-9-]{36}$/.test((await js('window.mascotDesktop.getState()')).avatarAppearance.livliv.id));
 result.checks.push('PC native import dialog path reads real .livliv ZIP and renders imported model');
 await js("window.mascotDesktop.setCharacterAppearance('standard')");await wait(async()=>!(await pc('window.CharaDockLivlivPreview.status().ready')));
 await js("window.mascotDesktop.setCharacterAppearance('livliv-kohaku')");await wait(()=>pc('window.CharaDockLivlivPreview.status().ready'));result.checks.push('PC original/LivLiv switching');
 await js("window.mascotDesktop.setCharacter('sage-avatar')");assert.equal((await js('window.mascotDesktop.getState()')).avatarAppearance.options.some(x=>x.id==='livliv-kohaku'),false);
 await js("window.mascotDesktop.setCharacter('amber-avatar')");assert.equal((await js('window.mascotDesktop.getState()')).avatarAppearance.selected,'livliv-kohaku');result.checks.push('per-character scope');
 const {kohakuLivliv}=require(path.join(source,'desktop/lib/livliv-avatar.cjs')),pack=kohakuLivliv(source),{RemoteCompanionServer}=require(path.join(source,'desktop/lib/remote-server.cjs'));
 const files={backHair:'back-hair.png',frontHair:'front-hair.png'};for(const e of ['open','closed'])for(const m of ['closed','half','open'])files[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`]=`eyes-${e}-mouth-${m}.png`;
 let state={language:'ja',character:{avatarAppearance:(await js('window.mascotDesktop.getState()')).avatarAppearance,id:'amber-avatar',name:'コハク',assetVersion:'livliv-qa',assetKeys:Object.keys(files),motion:{idleMotionEnabled:true},livlivAvatar:pack.descriptor},characters:[{id:'amber-avatar',name:'コハク'}],voice:{responseMode:'tts'},conversationHistory:[],workHistory:{runs:[]},workAllowed:false,mobileTtsAllowed:false};
 server=new RemoteCompanionServer({rootDir:path.join(source,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,callbacks:{getState:()=>state,setLivlivControls:async input=>{const updated=await js('window.mascotDesktop.setLivlivControls('+JSON.stringify(input)+')');state={...state,character:{...state.character,livlivAvatar:updated.avatarAppearance.livliv}};server.publish('state',state);return state;},getLivlivAsset:(id,file)=>state.character.livlivAvatar&&id==='kohaku'?pack.read(file):null,getAvatarAsset:key=>files[key]?{body:fs.readFileSync(path.join(source,'assets/amber-avatar',files[key])),contentType:'image/png'}:null}});await server.start();
 const link=new BrowserWindow({width:430,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,partition:'livliv-link-qa'}});
 link.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);const external=!['127.0.0.1','localhost',''].includes(url.hostname)&&!['data:','blob:','about:'].includes(url.protocol);if(external)outside.push(details.url);callback({cancel:external});});
 await link.loadURL(server.origin()+'/?livliv-avatar-preview=1'+new URL(server.pairingUrl()).hash);link.showInactive();const mobile=code=>link.webContents.executeJavaScript(code);
 await wait(()=>mobile('window.CharaDockLivlivPreview?.status().ready'));await sleep(300);assert.equal(await mobile("document.querySelector('#avatarLivliv').hidden"),false);
 fs.writeFileSync(path.join(output,'link-neutral.png'),(await link.capturePage()).toPNG());
 server.publish('expression',{characterId:'amber-avatar',emotion:'happy',durationMs:600});await mobile("window.CharaDockLivlivPreview.audio('open',.3);window.CharaDockLivlivPreview.blink(true)");await sleep(150);
 parameters=await mobile('window.CharaDockLivlivPreview.status().parameters');assert.equal(parameters.mouthOpen,1);assert.equal(parameters.eyeLOpen,0);fs.writeFileSync(path.join(output,'link-speaking.png'),(await link.capturePage()).toPNG());
 await mobile("window.CharaDockLivlivPreview.audio('closed',0);window.CharaDockLivlivPreview.blink(false)");
 result.checks.push('paired Link renders real local model and receives shared expression/mouth/blink cues');
 for(const emotion of ['thinking','worried','angry','surprised']){server.publish('expression',{characterId:'amber-avatar',emotion,durationMs:600});await wait(async()=>(await mobile('window.CharaDockLivlivPreview.status().activeExpression'))===emotion);}
 result.checks.push('paired Link shared expression events select all four authored expressions');

 await mobile("document.querySelector('#settingsButton').click()");await sleep(100);
 assert.equal(await mobile("document.querySelector('#livlivControls').hidden"),false);
 await mobile("{const select=document.querySelector('#livlivControls [data-livliv-control=expression]');select.value='angry';select.dispatchEvent(new Event('change'));}");
 await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().activeExpression'))==='angry'&&(await mobile('window.CharaDockLivlivPreview.status().activeExpression'))==='angry');
 await mobile("window.CharaDockLivlivPreview.audio('open',.3);window.CharaDockLivlivPreview.blink(true)");await sleep(250);
 assert.equal((await mobile('window.CharaDockLivlivPreview.status().parameters')).mouthOpen,1);assert.equal((await mobile('window.CharaDockLivlivPreview.status().parameters')).eyeLOpen,0);
 fs.writeFileSync(path.join(output,'link-expression-speaking.png'),(await link.capturePage()).toPNG());
 await mobile("window.CharaDockLivlivPreview.audio('closed',0);window.CharaDockLivlivPreview.blink(false)");
 await mobile("{const select=document.querySelector('#livlivControls [data-livliv-control=expression]');select.value='';select.dispatchEvent(new Event('change'));}");
 await wait(async()=>!(await pc('window.CharaDockLivlivPreview.status().controls')).expression);
 result.checks.push('Link native expression menu synchronizes to PC, retaining live mouth/blink control');

 await mobile("const toggle=document.querySelector('#livlivControls [data-livliv-control=paused]');toggle.click()");
 await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().controls')).paused&&(await mobile('window.CharaDockLivlivPreview.status().controls')).paused);
 fs.writeFileSync(path.join(output,'link-controls.png'),(await link.capturePage()).toPNG());
 await mobile("{const size=document.querySelector('#livlivControls [data-livliv-control=motionStrength]');size.value=.8;size.dispatchEvent(new Event('input'))}");
 await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().controls')).motionStrength===.8&&(await mobile('window.CharaDockLivlivPreview.status().controls')).motionStrength===.8);
 await mobile("{const size=document.querySelector('#livlivControls [data-livliv-control=motionStrength]');size.value=1;size.dispatchEvent(new Event('input'))}");
 await wait(async()=>(await pc('window.CharaDockLivlivPreview.status().controls')).motionStrength===1);
 result.checks.push('Link movement-size slider persists and synchronizes to the PC');
 await mobile("document.querySelector('#livlivControls [data-livliv-control=paused]').click()");
 await wait(async()=>!(await pc('window.CharaDockLivlivPreview.status().controls')).paused&&!(await mobile('window.CharaDockLivlivPreview.status().controls')).paused);
 assert.ok((await mobile('window.CharaDockLivlivPreview.snapshot()')).startsWith('data:image/png;base64,'));
 await mobile("document.querySelector('#closeSettingsButton').click()");
 result.checks.push('Link real controls panel, authenticated HTTP settings, PC/Link synchronized pause/resume, PNG snapshot');
 state={...state,character:{...state.character,livlivAvatar:null}};server.publish('state',state);await sleep(450);assert.equal(await mobile("document.querySelector('#avatarLivliv').hidden"),true);assert.equal(await mobile("getComputedStyle(document.querySelector('#avatarFace')).visibility"),'visible');
 result.checks.push('Link original appearance restored on switch');assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);
 result.errors=errors;result.outsideRequests=outside;result.passed=true;result.scope='Real PC and paired Link rendering; controlled mouth levels, not microphone/ASR';save();
 await server.stop();clearTimeout(guard);console.log('LIVLIV_QA_PASSED');app.quit();
})().catch(async error=>{clearTimeout(guard);result.error=error.stack;result.errors=errors;save();await server?.stop().catch(()=>{});console.error(error.message);app.exit(1);});
