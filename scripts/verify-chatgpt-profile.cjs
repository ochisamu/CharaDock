// SPDX-License-Identifier: Apache-2.0
// Run with Windows Electron after closing the CharaDock instance using PROFILE.
// SOURCE PROFILE OUTPUT [--sign-in]. Uses production UI/IPC and keeps the app open.
// Browser authentication is completed by the user; never read Codex auth.json.
const { app, BrowserWindow, safeStorage } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const [source, profile, output, action] = process.argv.slice(2);
if (!source || !profile || !output || !fs.existsSync(path.join(profile,"preferences.json"))) throw new Error("Supply SOURCE PROFILE OUTPUT [--sign-in]");
fs.mkdirSync(output,{recursive:true}); app.setPath("userData",profile); app.setName("CharaDock"); app.getAppPath=()=>source;
const errors=[];
app.on("web-contents-created",(_event,contents)=>contents.on("console-message",(_event,details)=>{
  if (/Uncaught|ReferenceError|TypeError/.test(details?.message||"")) errors.push("renderer_error");
}));
require(path.join(source,"desktop/main.cjs"));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const status={stage:"starting", realProfile:true};
const write=()=>fs.writeFileSync(path.join(output,"verification.json"),JSON.stringify(status,null,2));
async function checkInference() {
  const {ChatGPTSignIn,PROVIDER_ARGS}=require(path.join(source,"desktop/lib/chatgpt-sign-in.cjs"));
  const {CodexAppServerClient}=require(path.join(source,"desktop/backend/codex-client.cjs"));
  const {resolveCodexCommand}=require(path.join(source,"desktop/lib/codex-command.cjs"));
  const {resolveInstalledWslCodexCommand,wslCommandArgsForPath,windowsPathToWsl}=require(path.join(source,"desktop/lib/codex-command.cjs"));
  const auth=new ChatGPTSignIn({directory:path.join(profile,"chatgpt-connection"),safeStorage});
  const catalog=await auth.models(); const model=catalog.find(model=>model.model==="gpt-6-luna")?.model||catalog[0]?.model;
  assert.ok(model); const options={authMode:"chatgpt",configOverrides:PROVIDER_ARGS,accessTokenProvider:()=>auth.getAccessToken(),model,reasoningEffort:"low",webSearchMode:"disabled"};
  const directory=fs.mkdtempSync(path.join(app.getPath("temp"),"charadock-siwc-work-"));
  const command=await resolveCodexCommand({cacheDirectory:path.join(profile,"codex-bin")});
  const chat=new CodexAppServerClient({...options,command,cwd:directory,developerInstructions:"Reply to the request without tools."});
  try { const reply=await chat.sendMessage("Reply with exactly CHARADOCK_CHAT_OK"); assert.equal(reply.text.trim(),"CHARADOCK_CHAT_OK"); status.chat={passed:true,model}; write(); }
  finally {chat.stop();}
  const wslCommand=await resolveInstalledWslCodexCommand({cacheDirectory:path.join(profile,"codex-bin")}); assert.ok(wslCommand,"WSL Codex is required for this Windows Work test");
  const work=new CodexAppServerClient({...options,command:"wsl.exe",commandArgs:wslCommandArgsForPath(directory,["env","-u","CODEX_HOME",wslCommand]),cwd:windowsPathToWsl(directory),spawnCwd:directory,pathMapper:windowsPathToWsl,sandbox:"workspace-write",approvalPolicy:"never",developerInstructions:"Create only the requested file in the current workspace."});
  try {
    await work.sendMessage("Create RESULT.txt containing exactly CHARADOCK_WORK_OK followed by a newline. Do not create any other file.");
    assert.equal(fs.readFileSync(path.join(directory,"RESULT.txt"),"utf8"),"CHARADOCK_WORK_OK\n"); status.work={passed:true,model,runtime:"WSL"}; write();
  } finally {work.stop(); auth.dispose(); fs.rmSync(directory,{recursive:true,force:true});}
}
(async()=>{
  await app.whenReady(); let control;
  for(let attempt=0;attempt<200;attempt++) {control=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes("/control.html")&&!win.webContents.isLoading()); if(control)break; await sleep(150);}
  assert.ok(control); const js=code=>control.webContents.executeJavaScript(code); await sleep(1200);
  const before=await js("window.mascotDesktop.getState()"); control.showInactive();
  await js(`document.querySelector('[data-page="connection"]').click()`); await sleep(250);
  assert.equal(await js(`Boolean(document.querySelector('#openaiSettings')||document.querySelector('input[name="backend"]')||document.querySelector('#speechInputProviderSelect option[value="openai"]'))`),false);
  assert.equal(await js(`document.querySelector('#jevSettings').contains(document.querySelector('#apiKeyInput'))`),true);
  fs.writeFileSync(path.join(output,"connection.png"),(await control.capturePage()).toPNG());
  const remote=await js("window.mascotDesktop.getRemoteStatus()");
  if(remote.active && remote.pairingUrl) {
    const previousIds=new Set(remote.devices.map(device=>device.id));
    const mobile=new BrowserWindow({width:390,height:844,show:false,webPreferences:{contextIsolation:true,sandbox:true,partition:`siwc-qa-${Date.now()}`}});
    await mobile.loadURL(remote.pairingUrl); await sleep(1800);
    fs.writeFileSync(path.join(output,"mobile.png"),(await mobile.capturePage()).toPNG());
    assert.equal(await mobile.webContents.executeJavaScript(`document.querySelector('#pairingView').hidden`),true);
    mobile.destroy(); const after=await js("window.mascotDesktop.getRemoteStatus()");
    for(const device of after.devices) if(!previousIds.has(device.id)) await js(`window.mascotDesktop.revokeRemoteSession(${JSON.stringify(device.id)})`);
    status.mobile={passed:true};
  }
  const after=await js("window.mascotDesktop.getState()"); assert.equal(after.characterId,before.characterId); assert.deepEqual(after.characterTts,before.characterTts); assert.deepEqual(after.conversationHistory,before.conversationHistory);
  status.ui={passed:true,characterVoiceHistoryPreserved:true,errors}; assert.deepEqual(errors,[]); status.stage="ui-verified"; write();
  if(action!=="--sign-in") return;
  await js(`{const radio=document.querySelector('input[name="codexAuthMode"][value="chatgpt"]');radio.checked=true;radio.dispatchEvent(new Event('change'));}`);
  for(let attempt=0;attempt<100;attempt++){if((await js("window.mascotDesktop.getState()")).codexAuthMode==="chatgpt")break;await sleep(100);}
  await sleep(350); await js("window.mascotDesktop.startCodexLogin()"); status.stage="awaiting-user-sign-in"; write();
  for(let attempt=0;attempt<600;attempt++){
    await sleep(1000); const account=await js("window.mascotDesktop.getCodexAccount()");
    if(account.signedIn){status.stage="checking-inference";write();await checkInference();status.stage="passed";status.passed=true;write();console.log("PASS CharaDock ChatGPT authentication, Chat and WSL Work");return;}
    if(!account.pending){status.stage="sign-in-ended";write();return;}
  }
  status.stage="sign-in-timeout";write();
})().catch(error=>{status.stage="failed";status.error=String(error.message).replace(/eyJ[A-Za-z0-9_.-]+/g,"[redacted]");write();console.error("CharaDock authentication verification failed; see verification.json");});
