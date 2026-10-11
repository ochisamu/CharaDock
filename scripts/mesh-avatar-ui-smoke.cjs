// SPDX-License-Identifier: Apache-2.0
// Windows production IPC + PC renderer + paired Link, user-supplied project remains unchanged.
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,output,project]=process.argv.slice(2);
if(!source||!output||!project||fs.existsSync(path.join(output,'profile')))throw Error('Supply SOURCE, fresh OUTPUT, Mesh PROJECT');
fs.mkdirSync(path.join(output,'profile'),{recursive:true});app.setPath('userData',path.join(output,'profile'));app.setName('CharaDock Mesh QA');app.getAppPath=()=>source;app.setLoginItemSettings=()=>{};
fs.writeFileSync(path.join(output,'profile/preferences.json'),JSON.stringify({onboardingComplete:true,characterId:'amber-avatar',continuationStartupSpeechEnabled:false,launchAtLogin:false,
 remoteAccessEnabled:false,updateChecksEnabled:false,jevEnabled:false,atomEchoEnabled:false,characterDeviceProfiles:{'rlcd42-default':{enabled:false}},ttsEnabled:false,characterProfiles:{'amber-avatar':{name:'コハク',personality:'既存の性格を維持するテスト'}},characterTtsProfiles:{'amber-avatar':{provider:'system'}}}));
process.env.CODEX_HOME=path.join(output,'codex-fixture');fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
const errors=[];app.on('web-contents-created',(_event,c)=>c.on('console-message',(_event,details)=>{const m=details?.message||'';if(/Uncaught|ReferenceError|TypeError|Mesh avatar unavailable/.test(m))errors.push(m);}));
require(path.join(source,'desktop/main.cjs'));const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const guard=setTimeout(()=>{console.error('Mesh QA timeout');app.exit(1);},180000);
(async()=>{
 await app.whenReady();let control,mascot;
 for(let i=0;i<200;i++){control=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());
 mascot=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=obs'));if(control&&mascot)break;await sleep(150);}
 assert.ok(control);assert.ok(mascot);control.showInactive();const js=code=>control.webContents.executeJavaScript(code),pc=code=>mascot.webContents.executeJavaScript(code);
 await sleep(700);await mascot.loadURL(mascot.webContents.getURL()+'&mesh-avatar-preview=1');
 const before=await js('window.mascotDesktop.getState()');
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});
 const imported=await js('window.mascotDesktop.importMeshAvatar()');const id=imported.avatarAppearance.selected;
 assert.notEqual(id,'standard');assert.equal(imported.characterId,'amber-avatar');
 assert.deepEqual(imported.characterProfiles,before.characterProfiles);assert.deepEqual(imported.characterTts,before.characterTts);
 assert.deepEqual(imported.conversationHistory,before.conversationHistory);assert.equal(JSON.stringify(imported).includes(project),false);
 await js(`document.querySelector('[data-page="character"]').click();document.querySelector('#characterAppearanceSelect').scrollIntoView({block:'center'});`);
 for(let i=0;i<250;i++){if(await pc('window.CharaDockMeshPreview?.status().ready'))break;await sleep(150);}
 const status=await pc('window.CharaDockMeshPreview?.status()');console.log('PC_STATUS',JSON.stringify(status));assert.equal(status.ready,true);
 await sleep(300);await js(`document.querySelector('#characterAppearanceTitle').scrollIntoView({block:'center'});`);await sleep(350);
 assert.equal(await js(`{const r=document.querySelector('#characterAppearanceSelect').getBoundingClientRect(); r.top>0&&r.bottom<innerHeight}`),true);
 fs.writeFileSync(path.join(output,'settings.png'),(await control.capturePage()).toPNG());fs.writeFileSync(path.join(output,'pc-neutral.png'),(await mascot.capturePage()).toPNG());
 await pc(`window.CharaDockMeshPreview.expression({emotion:'happy',forceMouth:2,forceEyesClosed:true,durationMs:500})`);await sleep(120);
 const talking=await pc('window.CharaDockMeshPreview.status().parameters');assert.equal(talking.mouthOpen,1);assert.equal(talking.eyeLOpen,0);
 fs.writeFileSync(path.join(output,'pc-speaking.png'),(await mascot.capturePage()).toPNG());await sleep(600);
 assert.equal((await pc('window.CharaDockMeshPreview.status().parameters')).mouthOpen,0);
 await js(`window.mascotDesktop.setCharacterAppearance('standard')`);await sleep(400);assert.equal(await pc('window.CharaDockMeshPreview.status().ready'),false);
 fs.writeFileSync(path.join(output,'pc-original.png'),(await mascot.capturePage()).toPNG());
 await js(`window.mascotDesktop.setCharacterAppearance(${JSON.stringify(id)})`);
 await js(`window.mascotDesktop.setCharacter('sage-avatar')`);const other=await js('window.mascotDesktop.getState()');assert.equal(other.avatarAppearance.options.length,1);
 await js(`window.mascotDesktop.setCharacter('amber-avatar')`);assert.equal((await js('window.mascotDesktop.getState()')).avatarAppearance.selected,id);
 const {MeshAvatarStore}=require(path.join(source,'desktop/lib/mesh-avatar-store.cjs')),store=new MeshAvatarStore(path.join(output,'profile/mesh-avatars'));
 const descriptor=store.descriptor('amber-avatar',id),{RemoteCompanionServer}=require(path.join(source,'desktop/lib/remote-server.cjs'));
 const files={backHair:'back-hair.png',frontHair:'front-hair.png'};
 for(const e of ['open','closed'])for(const m of ['closed','half','open'])files[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`]=`eyes-${e}-mouth-${m}.png`;
 let state={language:'ja',character:{id:'amber-avatar',name:'コハク',assetVersion:'mesh-fixture',assetKeys:Object.keys(files),motion:{idleMotionEnabled:true},meshAvatar:descriptor},characters:[{id:'amber-avatar',name:'コハク'}],voice:{responseMode:'tts'},conversationHistory:[],workHistory:{runs:[]},workAllowed:false,mobileTtsAllowed:false};
 const server=new RemoteCompanionServer({rootDir:path.join(source,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,callbacks:{getState:()=>state,
 getMeshAsset:(key,file)=>state.character.meshAvatar?.id===key?store.read('amber-avatar',key,file):null,
 getAvatarAsset:key=>files[key]?{body:fs.readFileSync(path.join(source,'assets/amber-avatar',files[key])),contentType:'image/png'}:null}});
 await server.start();const link=new BrowserWindow({width:430,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 await link.loadURL('about:blank');link.webContents.debugger.attach('1.3');await link.webContents.debugger.sendCommand('Page.enable');
 await link.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`let meshApi;Object.defineProperty(window,'CharaDockRemoteMeshAvatar',{get:()=>meshApi,set:api=>{meshApi=api;const original=api.create;api.create=options=>{const avatar=original(options);window.meshQa=avatar;return avatar;};}});`});
 await link.loadURL(server.pairingUrl());link.showInactive();const mobile=code=>link.webContents.executeJavaScript(code);
 for(let i=0;i<250;i++){if(await mobile('window.meshQa?.status().ready'))break;await sleep(150);}
 console.log('LINK_STATUS',JSON.stringify(await mobile('window.meshQa?.status()')));assert.equal(await mobile('window.meshQa?.status().ready'),true);
 await sleep(300);assert.equal(await mobile("document.querySelector('#avatarMesh').hidden"),false);fs.writeFileSync(path.join(output,'link-neutral.png'),(await link.capturePage()).toPNG());
 server.publish('expression',{characterId:'amber-avatar',emotion:'happy',durationMs:400});await mobile("window.meshQa.audio('open',.3);window.meshQa.blink(true)");await sleep(150);
 const linkTalking=await mobile('window.meshQa.status().parameters');assert.equal(linkTalking.mouthOpen,1);assert.equal(linkTalking.eyeLOpen,0);
 fs.writeFileSync(path.join(output,'link-speaking.png'),(await link.capturePage()).toPNG());await mobile("window.meshQa.audio('closed',0);window.meshQa.blink(false)");
 await link.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(200);
 assert.equal((await mobile('window.meshQa.status().parameters')).angleZ,0);
 state={...state,character:{...state.character,meshAvatar:null}};server.publish('state',state);await sleep(400);
 assert.equal(await mobile("document.querySelector('#avatarMesh').hidden"),true);assert.equal(await mobile("getComputedStyle(document.querySelector('#avatarFace')).visibility"),'visible');
 fs.writeFileSync(path.join(output,'link-original.png'),(await link.capturePage()).toPNG());assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,scenarios:['native-folder-import-IPC','same-character-settings-history-voice','PC-WebGL-render','PC-lip-blink-expiry','standard-toggle','per-character-selection','paired-Link-render','Link-expression-lip-blink','reduced-motion','Link-standard-toggle'],errors,scope:'Actual project assets and Electron PC/paired Link. Synthetic voice levels; no AI call or real microphone.'},null,2));
 await server.stop();clearTimeout(guard);console.log('PASS Mesh Avatar import, PC and paired Link');app.quit();
})().catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack);console.error(error.stack);app.exit(1);});
