// SPDX-License-Identifier: Apache-2.0
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs"),path=require("node:path");
const main=fs.readFileSync(path.join(__dirname,"../main.cjs"),"utf8");
test("dedicated Chat/Work authentication never supplies a token to Live",()=>{
  const context=vm.createContext({preferences:{data:{codexAuthMode:"chatgpt"}},PROVIDER_ARGS:["provider"],chatgptSignIn:{getAccessToken:()=>"private"}});
  vm.runInContext(main.slice(main.indexOf("function codexAuthenticationOptions("),main.indexOf("function legacyCodexLoginClient(")),context);
  assert.equal(context.codexAuthenticationOptions().authMode,"chatgpt");assert.equal(context.codexAuthenticationOptions().accessTokenProvider(),"private");
  assert.equal(context.codexAuthenticationOptions(true).authMode,"codex");assert.equal(context.codexAuthenticationOptions(true).accessTokenProvider,undefined);
  context.preferences.data.codexAuthMode="codex"; assert.equal(context.codexAuthenticationOptions().accessTokenProvider,undefined);
});
function ipcHarness(mode="chatgpt"){
 const handlers={},events=[];const context=vm.createContext({
   ipcMain:{handle:(name,fn)=>handlers[name]=fn},assertTrustedSender:()=>{},assertAuthenticationMutable:()=>{},
   codexCommand:"codex",preferences:{data:{codexAuthMode:mode}},chatgptSignIn:{state:()=>({signedIn:true,authMode:"chatgpt"}),beginSignIn:()=>events.push("own-login"),logout:()=>events.push("own-logout")},
   legacyCodexLoginClient:()=>({getAccount:async()=>({account:{type:"chatgpt"}}),logout:()=>events.push("codex-logout"),startChatGPTLogin:async()=>({authUrl:"https://auth.openai.com/login"})}),
   refreshAuthenticatedClients:()=>events.push("reset-inference"),shell:{openExternal:()=>events.push("browser")},URL,
 });
 vm.runInContext(main.slice(main.indexOf('  ipcMain.handle("codex:account"'),main.indexOf('  ipcMain.handle("chat:send"')),context);
 return {handlers,events,context};
}
test("own logout and Live account/login stay separate through production IPC",async()=>{
 const {handlers,events}=ipcHarness();assert.equal((await handlers["codex:account"]({})).authMode,"chatgpt");
 await handlers["codex:login"]({});await handlers["codex:logout"]({});assert.deepEqual(events,["own-login","own-logout","reset-inference"]);
 assert.equal((await handlers["codex:liveAccount"]({})).signedIn,true);await handlers["codex:liveLogin"]({});assert.equal(events.at(-1),"browser");assert.equal(events.includes("codex-logout"),false);
});
test("authentication mutations reject active conversations before touching either login",async()=>{
 const h=ipcHarness();h.context.assertAuthenticationMutable=()=>{throw new Error("busy");};
 for(const route of ["codex:login","codex:logout","codex:liveLogin"])await assert.rejects(h.handlers[route]({}),/busy/);
 assert.deepEqual(h.events,[]);
 const ctx=vm.createContext({activeCodexInteractionClient:()=>({}),activeWorkRunId:null,currentRealtimeClient:()=>null,activeRealtimeStarting:false,mainText:ja=>ja});
 vm.runInContext(main.slice(main.indexOf("function assertAuthenticationMutable("),main.indexOf("function refreshAuthenticatedClients(")),ctx);
 assert.throws(()=>ctx.assertAuthenticationMutable());ctx.activeCodexInteractionClient=()=>null;ctx.currentRealtimeClient=()=>({});assert.throws(()=>ctx.assertAuthenticationMutable());ctx.currentRealtimeClient=()=>null;ctx.assertAuthenticationMutable();
});
test("dedicated connection reset preserves a current Live owner",()=>{
 const live={hasActiveTurn:()=>false},events=[];
 const ctx=vm.createContext({codexClient:live,workCodexClient:null,currentRealtimeClient:()=>live,resetConversationClient:()=>events.push("chat"),resetWorkClient:()=>events.push("work")});
 vm.runInContext(main.slice(main.indexOf("function refreshAuthenticatedClients("),main.indexOf("function createConversationCodexClient(")),ctx);
 ctx.refreshAuthenticatedClients();assert.deepEqual(events,["work"]);
});
