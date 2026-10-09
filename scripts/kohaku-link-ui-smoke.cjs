// SPDX-License-Identifier: Apache-2.0
// Real Link + paired HTTP/SSE + shared renderer. Fixture expressions, no AI or microphone.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,output]=process.argv.slice(2);
if(!source||!output||fs.existsSync(path.join(output,'profile')))throw Error('Supply SOURCE and fresh OUTPUT');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
const {RemoteCompanionServer}=require(path.join(source,'desktop/lib/remote-server.cjs'));
const {kohakuPackage,remoteExpression}=require(path.join(source,'desktop/lib/remote-kohaku.cjs'));
const {MascotStaticServer}=require(path.join(source,'desktop/lib/static-server.cjs'));
const {JevClient}=require(path.join(source,'desktop/lib/jev-client.cjs'));
const {JevExpressionDirector}=require(path.join(source,'desktop/lib/jev-expression-director.cjs'));
const {KOHAKU_EMOTIONS}=require(path.join(source,'desktop/lib/expressive-character.cjs'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const guard=setTimeout(()=>{console.error('Link QA timeout');app.exit(1);},150000);
(async()=>{
  await app.whenReady();const pack=kohakuPackage(source),settings=JSON.parse(fs.readFileSync(path.join(source,'assets/amber-avatar/default-settings.json'))).state;
  const files={backHair:'back-hair.png',frontHair:'front-hair.png'};
  for(const e of ['open','closed'])for(const m of ['closed','half','open'])files[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`]=`eyes-${e}-mouth-${m}.png`;
  let state={language:'ja',character:{id:'amber-avatar',name:'コハク',assetVersion:'fixture',assetKeys:Object.keys(files),motion:settings,
    authoredMotion:{manifestUrl:'/api/authored/manifest.json',version:pack.version}},characters:[{id:'amber-avatar',name:'コハク'}],
    voice:{responseMode:'tts'},conversationHistory:[],workHistory:{runs:[]},workAllowed:false,mobileTtsAllowed:false};
  const server=new RemoteCompanionServer({rootDir:path.join(source,'desktop/remote'),address:'127.0.0.1',port:0,allowLoopbackForTests:true,
    callbacks:{getState:()=>state,getAuthoredAsset:f=>pack.read(f),getAvatarAsset:key=>files[key]?{
      body:fs.readFileSync(path.join(source,'assets/amber-avatar',files[key])),contentType:'image/png'}:null}});
  await server.start();const local=new MascotStaticServer(source,{onInput:input=>{const e=remoteExpression(input,state.character.id);if(e)server.publish('expression',e);}});
  const win=new BrowserWindow({width:430,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  win.webContents.setAudioMuted(true);await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`
    let linkApi; Object.defineProperty(window,'CharaDockRemoteAuthoredAvatar',{get:()=>linkApi,set:api=>{
      linkApi=api;const original=api.create;api.create=options=>{const avatar=original(options);window.linkQaAvatar=avatar;return avatar;};
    }});window.addEventListener('error',e=>(window.linkQaErrors||=[]).push(e.message));`});
  await win.loadURL(server.pairingUrl());win.showInactive();
  const js=code=>win.webContents.executeJavaScript(code);
  for(let i=0;i<300;i++){if(await js('Boolean(window.linkQaAvatar?.status().ready)'))break;await sleep(200);}
  console.log('LOAD_STATUS',JSON.stringify(await js(`({ready:window.linkQaAvatar?.status().ready,loading:window.linkQaAvatar?.status().loading,pairing:!document.querySelector('#pairingView').hidden,errors:window.linkQaErrors||[]})`)));
  assert.equal(await js('window.linkQaAvatar.status().ready'),true);
  const results={};let emotion='neutral';
  const client=new JevClient();client.ask=async()=>({emotion:{type:'choice',choice:emotion,probabilities:{[emotion]:1}},
    gesture:{type:'choice',choice:'neutral',probabilities:{neutral:1}},performance:{type:'choice',choice:'none',probabilities:{none:1}}});
  const director=new JevExpressionDirector({enabled:()=>true,context:()=>state.character.id,
    classify:(text,opts)=>client.expression(text,{...opts,nikePerformance:true,allowedEmotions:KOHAKU_EMOTIONS}),apply:e=>local.pushInput(e)});
  const expected={neutral:'neutral',happy:'delighted_agreement',thinking:'curious_tilt',surprised:'curious_tilt',soft:'attentive_listening',exasperated:'doubtful_side_eye'};
  for(emotion of KOHAKU_EMOTIONS){
    const id=await director.prepare('fixture');assert.equal(director.activate(id),true);await sleep(1300);
    for(let i=0;i<4;i++)local.pushInput({voiceRaw:.7,targetX:.3});
    await js("window.linkQaAvatar.audio('open',.3);window.linkQaAvatar.blink(true)");await sleep(160);
    const value=await js('window.linkQaAvatar.status().output');
    // A previous head tilt settles continuously while the next facial cel is
    // already visible. The controller's pose name still describes that tilt.
    const activeCel=[...(value.cels||[])].sort((a,b)=>b.weight-a.weight)[0]?.name;
    assert.ok(value.pose===expected[emotion] || activeCel===expected[emotion],emotion+' must reach the current drawing');
    assert.equal(value.mouthState,2);assert.equal(value.blinkClosed,true);
    results[emotion]={pose:value.pose,activeCel,mouth:value.mouthState,blink:value.blinkClosed};
    fs.writeFileSync(path.join(output,emotion+'.png'),(await win.capturePage()).toPNG());
    await js("window.linkQaAvatar.audio('closed',0);window.linkQaAvatar.blink(false)");
  }
  const before=await js('window.linkQaAvatar.status().output.now');await sleep(500);
  assert.ok(await js('window.linkQaAvatar.status().output.now')>before,'RAF keeps moving');
  state={...state,character:{...state.character,id:'custom',authoredMotion:null,assetVersion:'custom'}};server.publish('state',state);await sleep(700);
  assert.equal(await js("document.querySelector('#avatarAuthored').hidden"),true);
  assert.equal(await js("getComputedStyle(document.querySelector('#avatarFace')).visibility"),'visible');
  state={...state,character:{...state.character,id:'amber-avatar',authoredMotion:{manifestUrl:'/api/authored/manifest.json',version:pack.version}}};server.publish('state',state);
  for(let i=0;i<300;i++){if(await js('window.linkQaAvatar.status().ready'))break;await sleep(200);}
  assert.equal(await js('window.linkQaAvatar.status().ready'),true);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await sleep(200);assert.equal(await js('window.linkQaAvatar.status().output.reducedMotion'),true);
  state={...state,character:{...state.character,authoredMotion:null}};server.publish('state',state);await sleep(300);
  assert.equal(await js('window.linkQaAvatar.status().ready'),false);
  assert.deepEqual(await js('window.linkQaErrors || []'),[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,results,scope:'paired Link at 430x900; actual Jev parser/director/SSE; fixture responses and synthetic audio levels, not real phone/API/microphone'},null,2));
  director.cancel();clearTimeout(guard);win.destroy();await server.stop();console.log('PASS Link: 6 Jev poses, audio/blink, reduced motion, character switch and OFF');app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
