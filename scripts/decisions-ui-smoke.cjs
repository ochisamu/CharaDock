// SPDX-License-Identifier: Apache-2.0
// Real settings renderer + production IPC/router, isolated profile and fake API replies.
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [source,output]=process.argv.slice(2);
if(!source||!output||fs.existsSync(path.join(output,'profile'))) throw Error('Supply SOURCE and fresh OUTPUT');
const profile=path.join(output,'profile');fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({onboardingComplete:true,
  continuationStartupSpeechEnabled:false,launchAtLogin:false,remoteAccessEnabled:false,updateChecksEnabled:false,
  ttsEnabled:false,jevEnabled:false,atomEchoEnabled:false,characterDeviceProfiles:{'rlcd42-default':{enabled:false}}}));
process.env.CODEX_HOME=path.join(output,'codex-fixture');fs.mkdirSync(process.env.CODEX_HOME,{recursive:true});
app.setPath('userData',profile);app.setName('CharaDock Decisions QA');app.getAppPath=()=>source;app.setLoginItemSettings=()=>{};
const requests=[],errors=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=> {
  if(['https://api.openai.com/v1/decisions','https://api.typesafe.ai/v1/systemone'].includes(url)) {
    const body=JSON.parse(options.body);requests.push({url,body});
    assert.equal(options.headers.Authorization,url.includes('openai')?'Bearer synthetic-openai-key':'Bearer synthetic-jev-key');
    return {ok:true,text:async()=>JSON.stringify({answers:url.includes('openai')?[{name:'ready',type:'predicate',probability:1}]:{ready:{type:'noul',noul:1}}})};
  }
  return originalFetch(url,options);
};
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',(_event,details)=>{
  const message=typeof details==='object'?details.message:'';
  if(/Uncaught|ReferenceError|TypeError/.test(message||''))errors.push(message);
}));
require(path.join(source,'desktop/main.cjs'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const guard=setTimeout(()=>{console.error('Decisions UI QA timeout');app.exit(1);},90000);
(async()=>{
  await app.whenReady();let win;
  for(let i=0;i<200;i++) {win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/control.html')&&!w.webContents.isLoading());if(win)break;await sleep(150);}
  assert.ok(win);const js=code=>win.webContents.executeJavaScript(code);
  await sleep(800);
  await js(`document.querySelector('[data-page="connection"]').click()`);
  await js(`document.querySelector('#apiKeyInput').value='synthetic-openai-key';document.querySelector('#saveApiKeyButton').click()`);await sleep(150);
  await js(`window.mascotDesktop.setJevConfig({apiKey:'synthetic-jev-key',enabled:true})`);
  await sleep(200);
  await js(`{const el=document.querySelector('#decisionProviderSelect');el.value='decisions';el.dispatchEvent(new Event('change'));}`);
  for(let i=0;i<30;i++){if(await js(`document.querySelector('#decisionOpenAIKeyNote').hidden===false&&!document.querySelector('#decisionProviderSelect').disabled`))break;await sleep(100);}
  assert.equal(await js(`document.querySelector('#decisionJevKeySettings').hidden`),true);
  assert.equal(await js(`document.querySelector('#testJevConnectionButton').disabled`),false);
  assert.match(await js(`document.querySelector('#jevApiKeyState').textContent`),/OpenAI/);
  await js(`document.querySelector('#testJevConnectionButton').click()`);await sleep(200);
  assert.match(await js(`document.querySelector('#jevStatus').textContent`),/接続できました/);
  assert.equal(requests.at(-1).url,'https://api.openai.com/v1/decisions');
  win.setSize(1300,1200);win.webContents.setZoomFactor(.85);
  await js(`{const el=document.querySelector('#jevSettings');el.style.scrollMarginTop='90px';el.scrollIntoView({block:'start'});}`);await sleep(200);
  fs.writeFileSync(path.join(output,'decisions.png'),(await win.capturePage()).toPNG());
  await js(`{const el=document.querySelector('#decisionProviderSelect');el.value='jev';el.dispatchEvent(new Event('change'));}`);await sleep(200);
  assert.equal(await js(`document.querySelector('#decisionJevKeySettings').hidden`),false);
  await js(`document.querySelector('#testJevConnectionButton').click()`);await sleep(200);
  assert.equal(requests.at(-1).url,'https://api.typesafe.ai/v1/systemone');
  fs.writeFileSync(path.join(output,'jev.png'),(await win.capturePage()).toPNG());
  await js(`window.mascotDesktop.setJevConfig({provider:'decisions'})`);await js(`document.querySelector('#apiKeyInput').value='';document.querySelector('#saveApiKeyButton').click()`);await sleep(200);
  assert.equal(await js(`document.querySelector('#testJevConnectionButton').disabled`),true);
  assert.match(await js(`document.querySelector('#jevApiKeyState').textContent`),/設定してください/);
  const prefs=JSON.parse(fs.readFileSync(path.join(profile,'preferences.json'),'utf8'));
  assert.equal(prefs.decisionProvider,'decisions');assert.ok(prefs.encryptedJevApiKey);assert.equal(prefs.encryptedApiKey,undefined);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,requests:requests.map(r=>({url:r.url,model:r.body.model})),scenarios:['switch-decisions','profile-key-status','connection-ipc','switch-jev','missing-profile-key','persist-provider'],errors,scope:'Real Windows Electron control renderer and production IPC/provider; isolated fake credentials and API responses; no live API calls'},null,2));
  console.log('PASS Decisions settings, profile key, real IPC and both providers');clearTimeout(guard);app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
