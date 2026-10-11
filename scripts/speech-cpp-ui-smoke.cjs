// SPDX-License-Identifier: Apache-2.0
// Opt-in real-profile verification; leaves CharaDock open with speech.cpp selected.
const {app,BrowserWindow,ipcMain}=require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const [source,profile,output]=process.argv.slice(2);
if(!source||!profile||!output||!fs.existsSync(path.join(profile,"preferences.json")))throw Error("Supply SOURCE, existing PROFILE, OUTPUT");
fs.mkdirSync(output,{recursive:true});app.setPath("userData",profile);app.setName("CharaDock");app.getAppPath=()=>source;
const errors=[],levels=[],captions=[],native=[],settingsPcm=[];let capturingSettings=false;
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,callback)=>handle(channel,async(event,...args)=>{
 if(["mascot:voice","mascotInline:voice"].includes(channel))levels.push({channel,level:Number(args[0]),at:Date.now()});
 if(channel==="mascotInline:speechCaption")captions.push({text:args[0]?.text,at:Date.now()});
 const value=await callback(event,...args);
 if(capturingSettings&&["tts:synthesize","tts:nextChunk"].includes(channel)&&value?.pcmChunk)settingsPcm.push(Buffer.from(value.pcmChunk,"base64"));
 if(channel.includes("synthesizeTts")&&value?.pcmChunk)native.push({channel,sampleRate:value.sampleRate,at:Date.now()});
 return value;
});
app.on("web-contents-created",(_event,contents)=>contents.on("console-message",(_event,details)=>{if(/Uncaught|ReferenceError|TypeError|Unable to load preload/.test(details?.message||""))errors.push(details.message);}));
// Startup continuation is unrelated to this voice check. Suppress only its
// scheduled offer in the QA process so it cannot add history or overlap audio.
const originalSetTimeout = global.setTimeout;
global.setTimeout = (callback, delay, ...args) => {
  if (delay === 800 && String(callback).includes("maybeOfferStartupContinuation")) return originalSetTimeout(() => {}, 0);
  return originalSetTimeout(callback, delay, ...args);
};
const nativeRequests=[];
const {SpeechCppClient}=require(path.join(source,"desktop/lib/speech-cpp-client.cjs"));
const nativeWrite=SpeechCppClient.prototype.write;
SpeechCppClient.prototype.write=function(message){if(message.type==="synthesize")nativeRequests.push({...message,modelPath:JSON.parse(this.key)[1]});return nativeWrite.call(this,message);};
require(path.join(source,"desktop/main.cjs"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(check,timeout=90000){const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await sleep(60);}throw Error("Verification wait timed out");}
const guard=setTimeout(()=>{fs.writeFileSync(path.join(output,"ui-error.txt"),"Verification timeout");},240000);
(async()=>{
 await app.whenReady();let control,mascot;
 await wait(()=>{control=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("/control.html")&&!w.webContents.isLoading());mascot=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("mode=obs")&&!w.webContents.isLoading());return control&&mascot;});
 const js=code=>control.webContents.executeJavaScript(code);await sleep(500);
 const before=await js("window.mascotDesktop.getState()");assert.equal(before.speechCpp.sampleModel.installed,true);assert.equal(before.speechCpp.ready,true);
 // Compare both engines through the same production IPC, voice, text and MF settings.
 const benchmark=[];
 const benchmarkText="新しい音声エンジンでも、いつもの声で話せるよ。";
 if (!process.argv.includes("--skip-benchmark")) for (const provider of ["speech-cpp","irodori-webgpu"]) {
   await js(`window.mascotDesktop.saveSettings({...${JSON.stringify(before)},ttsProvider:${JSON.stringify(provider)},irodoriVersion:'v4-mf',irodoriPrecision:'fp16',irodoriMode:'reference',irodoriAutoEmotion:false,irodoriSpeed:1,irodoriSeed:42})`);
   const rows=[];
   for(let run=0;run<4;run++) {
     const started=performance.now();const first=await js(`window.mascotDesktop.synthesizeTts(${JSON.stringify(benchmarkText)})`);
     if(first.error)throw Error(first.error);const firstAudioMs=Math.round(performance.now()-started);
     let buffers=(first.audioDataUrls||[]).map(url=>Buffer.from(url.split(',')[1],'base64').subarray(44)),chunks=buffers.length,id=first.streamId;
     while(id){const next=await js(`window.mascotDesktop.nextTtsChunk(${JSON.stringify(id)})`);if(next.audioDataUrl){buffers.push(Buffer.from(next.audioDataUrl.split(',')[1],'base64').subarray(44));chunks++;}if(next.done)break;}
     const generationMs=Math.round(performance.now()-started),pcm=Buffer.concat(buffers),durationSeconds=pcm.length/96000;
     const {waveDataUrl}=require(path.join(source,'desktop/lib/speech-cpp-client.cjs'));
     fs.writeFileSync(path.join(output,`${provider}-${run}.wav`),Buffer.from(waveDataUrl(pcm.toString('base64'),48000).split(',')[1],'base64'));
     rows.push({run,cold:run===0,firstAudioMs,generationMs,durationSeconds,chunks});console.log('BENCHMARK',provider,JSON.stringify(rows.at(-1)));
   }
   benchmark.push({provider,rows});fs.writeFileSync(path.join(output,'benchmark.json'),JSON.stringify({hardware:'NVIDIA GeForce RTX 5060 Ti 16 GB',text:benchmarkText,model:'Irodori v4.1 Small MF FP16',voiceId:before.characterTts.irodoriVoiceId,seed:42,speed:1,autoEmotion:false,benchmark},null,2));
 }
 await js(`window.mascotDesktop.saveSettings({...${JSON.stringify(before)},ttsProvider:'speech-cpp'})`);
 control.showInactive();await js(`document.querySelector('[data-page="voice"]').click();document.querySelector('#ttsProviderSelect').value='speech-cpp';document.querySelector('#ttsProviderSelect').dispatchEvent(new Event('change',{bubbles:true}));`);
 await wait(async()=> (await js("window.mascotDesktop.getState()")).ttsProvider==="speech-cpp");
 await js("document.querySelector('#ttsProviderSelect').scrollIntoView({block:'start'})");await sleep(300);
 assert.equal(await js("document.querySelector('#speechCppSettings').hidden"),false);assert.equal(await js("getComputedStyle(document.querySelector('#irodoriVersionSelect').parentElement).display"),"none");
 assert.ok((await js("document.querySelector('#speechCppModelDownloadStatus').textContent")).includes("導入済み"));
 console.log("STAGE settings");fs.writeFileSync(path.join(output,"settings-native.png"),(await control.capturePage()).toPNG());
 // Use the actual button with both native models and distinct saved step values.
 async function button(stem) {
   const begin=Date.now(),offset=settingsPcm.length;capturingSettings=true;
   await js("document.querySelector('#ttsTestButton').click()");
   await wait(()=>levels.some(x=>x.channel==="mascot:voice"&&x.level>.02&&x.at>begin));
   await wait(async()=> !(await js("document.querySelector('#ttsTestButton').disabled"))&&(await js("document.querySelector('#ttsStatus').textContent")).includes("接続と再生"));
   capturingSettings=false;const frames=settingsPcm.slice(offset);assert.ok(frames.length);
   const {waveDataUrl}=require(path.join(source,"desktop/lib/speech-cpp-client.cjs"));
   fs.writeFileSync(path.join(output,stem+".wav"),Buffer.from(waveDataUrl(Buffer.concat(frames).toString("base64"),48000).split(",")[1],"base64"));
   const result=levels.filter(x=>x.channel==="mascot:voice"&&x.at>begin);assert.ok(result.some(x=>x.level>.1));assert.equal(result.at(-1).level,0);return result;
 }
 const settingsLevels=await button("settings-button");
 assert.equal(await js("document.querySelector('#speechCppModelSelect').value"),before.speechCppModelVariant);
 const mfSteps=before.speechCppMfSteps||6,smallSteps=before.speechCppSmallSteps||16;
 await js("document.querySelector('#speechCppStepsInput').value=8;document.querySelector('#speechCppStepsInput').dispatchEvent(new Event('change',{bubbles:true}))");
 await wait(async()=> (await js("window.mascotDesktop.getState()")).speechCppMfSteps===8);
 await js("document.querySelector('#speechCppModelSelect').value='small';document.querySelector('#speechCppModelSelect').dispatchEvent(new Event('change',{bubbles:true}))");
 await wait(async()=> (await js("window.mascotDesktop.getState()")).speechCppModelVariant==="small");
 assert.equal(Number(await js("document.querySelector('#speechCppStepsInput').value")),smallSteps);
 assert.equal((await js("window.mascotDesktop.getState()")).speechCpp.sampleModel.provider,"speech-cpp-small");
 assert.equal((await js("window.mascotDesktop.getState()")).speechCpp.ready,true);
 await js("document.querySelector('#speechCppStepsInput').value=24;document.querySelector('#speechCppStepsInput').dispatchEvent(new Event('change',{bubbles:true}))");
 await wait(async()=> (await js("window.mascotDesktop.getState()")).speechCppSmallSteps===24);
 await button("settings-small-24");
 const rfRequests=nativeRequests.filter(x=>!x.keep_tail&&x.modelPath.includes("859M"));assert.ok(rfRequests.length>=2);assert.ok(rfRequests.every(x=>x.steps===24));
 assert.equal(await js("document.querySelector('#irodoriModelDownloadButton').closest('.local-model-download').hidden"),true);
 await js("document.querySelector('#speechCppSettings').scrollIntoView({block:'center'})");await sleep(300);
 fs.writeFileSync(path.join(output,"settings-small.png"),(await control.capturePage()).toPNG());
 await js("document.querySelector('#speechCppModelSelect').value='mf';document.querySelector('#speechCppModelSelect').dispatchEvent(new Event('change',{bubbles:true}))");
 await wait(async()=> (await js("window.mascotDesktop.getState()")).speechCppModelVariant==="mf");
 assert.equal(Number(await js("document.querySelector('#speechCppStepsInput').value")),8);
 await button("settings-mf-8");
 assert.ok(nativeRequests.some(x=>!x.keep_tail&&x.modelPath.includes("866M")&&x.steps===8));
 await js(`window.mascotDesktop.saveSettings({...${JSON.stringify(before)},ttsProvider:'speech-cpp',speechCppModelVariant:'mf',speechCppMfSteps:${mfSteps},speechCppSmallSteps:${smallSteps}})`);
 console.log("STAGE mascot");
 // Actual sandboxed mascot preload, captions and mouth updates.
 const mascotBegin=Date.now();mascot.webContents.send("mascot:speech",{text:"いつもの声で話せるよ。新しい音声エンジンも選べるようになったよ。",durationMs:12000,ttsEnabled:true,ttsProvider:"speech-cpp",speechLanguage:"ja-JP"});
 await wait(()=>levels.some(x=>x.channel==="mascotInline:voice"&&x.level>.02&&x.at>mascotBegin));await sleep(1000);
 fs.writeFileSync(path.join(output,"mascot-speaking.png"),(await mascot.capturePage()).toPNG());
 await wait(()=>{const rows=levels.filter(x=>x.channel==="mascotInline:voice"&&x.at>mascotBegin);return rows.length>10&&rows.at(-1).level===0&&Date.now()-rows.at(-1).at>800;});
 assert.ok(captions.some(x=>x.at>mascotBegin&&x.text?.includes("いつもの声")));
 // Interrupt a pending native request before its first audio arrives.
 mascot.webContents.send("mascot:speech",{text:"これは途中停止の確認です。止めたあとから声が流れてこないことを確認しています。",durationMs:15000,ttsEnabled:true,ttsProvider:"speech-cpp",speechLanguage:"ja-JP"});
 await sleep(20);mascot.webContents.send("audio:stopNormalSpeech");await sleep(150);const stoppedAt=Date.now();await sleep(1000);
 assert.equal(levels.some(x=>x.channel==="mascotInline:voice"&&x.at>stoppedAt&&x.level>.01),false);
 console.log("STAGE link");
 // Paired Link UI with the production main TTS handlers and the actual profile's model/reference.
 const {RemoteCompanionServer}=require(path.join(source,"desktop/lib/remote-server.cjs"));
 const files={backHair:"back-hair.png",frontHair:"front-hair.png"};for(const e of ["open","closed"])for(const m of ["closed","half","open"])files[`eyes${e[0].toUpperCase()+e.slice(1)}Mouth${m[0].toUpperCase()+m.slice(1)}`]=`eyes-${e}-mouth-${m}.png`;
 const text="音声テストです。これからよろしくね。";let linkTurn=0;
 const expectedLinkCaptions=require(path.join(source,"desktop/lib/irodori-webgpu.cjs")).splitIrodoriText(text);
 const state={language:"ja",character:{id:before.characterId,name:before.characters.find(x=>x.id===before.characterId)?.name||"キャラクター",assetKeys:Object.keys(files),motion:{}},characters:before.characters,voice:{responseMode:"tts"},mobileTtsAllowed:true,workAllowed:false,conversationHistory:[],workHistory:{runs:[]}};
 const invoke=async(channel,...args)=>{console.log("LINK_IPC",channel);const value=await ipcMain._invokeHandlers.get(channel)({sender:control.webContents,senderFrame:control.webContents.mainFrame},...args);console.log("LINK_RESULT",channel,Boolean(value?.pcmChunk),value?.done,value?.error||"");return value;};
 const server=new RemoteCompanionServer({rootDir:path.join(source,"desktop/remote"),address:"127.0.0.1",port:0,allowLoopbackForTests:true,callbacks:{getState:()=>state,
 getAvatarAsset:key=>files[key]?{body:fs.readFileSync(path.join(source,"assets",before.characterId,files[key])),contentType:"image/png"}:null,
 sendMessage:()=>{console.log("LINK_MESSAGE");const turnId=`native-link-${++linkTurn}`;server.publish("stream",{phase:"start",turnId,remoteTtsEnabled:true});server.publish("stream",{phase:"done",turnId,audioRoute:"mobile-tts",text,displayText:text,speechSegments:[{text}]});return{accepted:true};},
 synthesizeTts:value=>invoke("tts:synthesize",value),nextTtsChunk:id=>invoke("tts:nextChunk",id),cancelTts:id=>invoke("tts:cancelStream",id)}});
 await server.start();const link=new BrowserWindow({width:430,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 await link.loadURL(server.pairingUrl());link.showInactive();const mobile=code=>link.webContents.executeJavaScript(code,true).catch(error=>{throw new Error(`Link script: ${code}\n${error.message}`);});
 await wait(()=>mobile("Boolean(window.CharaDockPcmSpeech && document.querySelector('#pairingView').hidden)"));
 await mobile(`window.nativeQa={peak:0,captions:[],done:false};const old=window.CharaDockPcmSpeech.create;window.CharaDockPcmSpeech.create=options=>{const level=options.onLevel,start=options.onStart;options.onLevel=value=>{window.nativeQa.peak=Math.max(window.nativeQa.peak,value);window.nativeQa.lastLevel=value;if(value>.01)window.nativeQa.nonzeroEvents=(window.nativeQa.nonzeroEvents||0)+1;level(value);};options.onStart=text=>{window.nativeQa.captions.push(text);start(text);};const player=old(options),play=player.play;player.play=async(...args)=>{try{return await play(...args);}finally{window.nativeQa.done=true;}};return player;};if (!document.querySelector('#audioButton').classList.contains('is-active')) document.querySelector('#audioButton').click();`);
 await sleep(200);await mobile("document.querySelector('#messageInput').value='音声確認';document.querySelector('#sendButton').click()");
 await wait(async()=>{const result=await mobile("({qa:window.nativeQa,audio:document.querySelector('#audioButton').className,hint:document.querySelector('#composerHint')?.textContent,caption:document.querySelector('#responseText')?.textContent})");fs.writeFileSync(path.join(output,"link-status.json"),JSON.stringify(result));return result.qa.peak>.1;});await sleep(400);fs.writeFileSync(path.join(output,"link-speaking.png"),(await link.capturePage()).toPNG());
 await wait(()=>mobile("window.nativeQa.done"));const linkResult=await mobile("window.nativeQa");assert.deepEqual(linkResult.captions,expectedLinkCaptions);assert.ok(linkResult.peak>.1);
 assert.equal(await mobile("document.querySelector('#avatarMotion').classList.contains('is-speaking')"),false);
 // Stop an actual Link playback, reject late held frames, then replay the same text.
 await mobile("window.nativeQa={peak:0,captions:[],done:false};document.querySelector('#messageInput').value='もう一度';document.querySelector('#sendButton').click()");
 await wait(()=>mobile("window.nativeQa.peak>.1"));await mobile("document.querySelector('#audioButton').click()");
 await wait(()=>mobile("window.nativeQa.done && window.nativeQa.lastLevel===0"));
 await sleep(150);const nonzeroAtStop=await mobile("window.nativeQa.nonzeroEvents");await sleep(1000);
 assert.equal(await mobile("window.nativeQa.nonzeroEvents"),nonzeroAtStop);
 assert.equal(await mobile("document.querySelector('#avatarMotion').classList.contains('is-speaking')"),false);
 await mobile("window.nativeQa={peak:0,captions:[],done:false};document.querySelector('#audioButton').click();document.querySelector('#messageInput').value='再生確認';document.querySelector('#sendButton').click()");
 await wait(()=>mobile("window.nativeQa.done && window.nativeQa.peak>.1"));
 assert.deepEqual(await mobile("window.nativeQa.captions"),expectedLinkCaptions);
 // The same paired Link route also synthesizes the selected Small model.
 const beforeRfLink=nativeRequests.length;
 await js(`window.mascotDesktop.saveSettings({...${JSON.stringify(before)},ttsProvider:'speech-cpp',speechCppModelVariant:'small'})`);
 await mobile("window.nativeQa={peak:0,captions:[],done:false};document.querySelector('#messageInput').value='Smallの再生確認';document.querySelector('#sendButton').click()");
 await wait(()=>mobile("window.nativeQa.done && window.nativeQa.peak>.1"));
 assert.deepEqual(await mobile("window.nativeQa.captions"),expectedLinkCaptions);
 assert.ok(nativeRequests.slice(beforeRfLink).some(x=>!x.keep_tail&&x.modelPath.includes("859M")&&x.steps===smallSteps));
 await js(`window.mascotDesktop.saveSettings({...${JSON.stringify(before)},ttsProvider:'speech-cpp'})`);
 link.destroy();await server.stop();
 console.log("STAGE switching");
 // Selecting the existing engine remains available; return to the new one.
 await js(`document.querySelector('#ttsProviderSelect').value='irodori-webgpu';document.querySelector('#ttsProviderSelect').dispatchEvent(new Event('change',{bubbles:true}));`);
 await wait(async()=> (await js("window.mascotDesktop.getState()")).ttsProvider==="irodori-webgpu");
 await js(`document.querySelector('#ttsProviderSelect').value='speech-cpp';document.querySelector('#ttsProviderSelect').dispatchEvent(new Event('change',{bubbles:true}));`);
 await wait(async()=> (await js("window.mascotDesktop.getState()")).ttsProvider==="speech-cpp");
 const after=await js("window.mascotDesktop.getState()");assert.deepEqual(after.characterProfiles,before.characterProfiles);assert.deepEqual(after.conversationHistory,before.conversationHistory);assert.deepEqual(after.avatarAppearance,before.avatarAppearance);
 const {provider,...voiceAfter}=after.characterTts;const {provider:oldProvider,...voiceBefore}=before.characterTts;assert.deepEqual(voiceAfter,voiceBefore);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,"ui-verification.json"),JSON.stringify({passed:true,realProfile:true,provider:after.ttsProvider,settingsPeak:Math.max(...settingsLevels.map(x=>x.level)),mascotPeak:Math.max(...levels.filter(x=>x.channel==="mascotInline:voice").map(x=>x.level)),mascotCaptions:captions.filter(x=>x.at>mascotBegin).map(x=>x.text),link:linkResult,linkInterruption:true,linkReplay:true,interruption:true,originalEngineSelectable:true,modelSelection:true,perModelStepsPreserved:true,linkSmallModel:true,nativeRequests:nativeRequests.map(({text,steps,keep_tail,modelPath})=>({text,steps,privateTiming:Boolean(keep_tail),model:path.basename(modelPath)})),nameVoiceHistoryAppearancePreserved:true,errors},null,2));
 global.setTimeout = originalSetTimeout;clearTimeout(guard);console.log("PASS native settings, sandboxed mascot, paired Link, stop, engine switching");
})().catch(error=>{global.setTimeout = originalSetTimeout;clearTimeout(guard);console.error(error.stack);fs.writeFileSync(path.join(output,"ui-error.txt"),error.stack);});
