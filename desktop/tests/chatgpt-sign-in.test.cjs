// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { ChatGPTSignIn, PLAN_SCOPE, PROVIDER_ARGS } = require("../lib/chatgpt-sign-in.cjs");
const { CodexAppServerClient, childProcessEnvironment } = require("../backend/codex-client.cjs");
const { Preferences } = require("../lib/preferences.cjs");
const discovery = { issuer: "https://auth.openai.com", authorization_endpoint: "https://auth.openai.com/oauth/authorize", token_endpoint: "https://auth.openai.com/api/accounts/oauth/token", jwks_uri: "https://auth.openai.com/jwks" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-siwc-test-"));
  const requests = [], opened = [], cleanupClients = [], encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "dpapi",
    encryptString: value => {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
      const body = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString: bytes => { const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, bytes.subarray(0,12)); cipher.setAuthTag(bytes.subarray(12,28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); },
  };
  const client = new ChatGPTSignIn({ directory, safeStorage, openExternal: url => opened.push(new URL(url)),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), ...init });
      if (String(url).includes(".well-known")) return json(discovery);
      if (String(url).endsWith("/models")) return json({ models: [{slug:"allowed", display_name:"Allowed", visibility:"list"}, {slug:"hidden",visibility:"hide"}] });
      return json({access_token:"private-access", refresh_token:"private-refresh",id_token:"private-id",expires_in:3600,scope:PLAN_SCOPE});
    }, verifyIdentity: (token, audience, nonce) => ({ sub: "test-user", exp: Math.floor(Date.now()/1000)+3600, nonce }), ...options });
  t.after(async () => {
    // Windows keeps the child's cwd locked until close, even after kill().
    // Stop owned workers before deleting their fixture, in this same hook.
    for (const worker of cleanupClients) {
      const child = worker.proc;
      const closed = child && child.exitCode === null ? new Promise(resolve => child.once('close', resolve)) : Promise.resolve();
      worker.stop(); await closed;
    }
    client.dispose();
    await fs.promises.rm(directory, {recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  return { client, directory, safeStorage, requests, opened, cleanupClients };
}
async function login(f) {
  await f.client.beginSignIn();
  const authorize = f.opened.at(-1), callback = new URL(authorize.searchParams.get("redirect_uri"));
  callback.searchParams.set("state",authorize.searchParams.get("state")); callback.searchParams.set("client_id","issued-client"); callback.searchParams.set("code","one-time-code");
  const response = await fetch(callback);
  await response.text();
  return { response, authorize, callback };
}
test("PKCE loopback login validates state, stores only encrypted credentials and returns only public status", async t => {
  const f = fixture(t); await f.client.beginSignIn();
  const auth = f.opened[0]; assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(auth.searchParams.get("agent_name_hint"), "CharaDock");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  const callback = new URL(auth.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", "wrong"); assert.equal((await fetch(callback)).status,400);
  assert.equal(f.client.state().pending,true);
  const result = await login(f); assert.equal(result.response.status,200);
  const tokenRequest = f.requests.find(request => request.method === "POST");
  const form = tokenRequest.body;
  assert.equal(crypto.createHash("sha256").update(form.get("code_verifier")).digest("base64url"), auth.searchParams.get("code_challenge"));
  assert.equal(form.get("client_id"), "issued-client");
  const disk = fs.readFileSync(f.client.file,"utf8"); assert.doesNotMatch(disk,/private-|test-user/);
  assert.doesNotMatch(JSON.stringify(f.client.state()),/private-|test-user/);
  assert.equal(new ChatGPTSignIn({directory:f.directory,safeStorage:f.safeStorage}).state().signedIn,true);
  assert.deepEqual(await f.client.models(),[{model:"allowed",displayName:"Allowed",hidden:false}]);
});
for (const variant of ["nonce", "permission", "client-id", "subject"]) test(`rejects invalid OAuth ${variant} without replacing a session`, async t => {
  const f=fixture(t); if (variant === "nonce") f.client.verifyIdentity=()=>({sub:"test",exp:9999999999,nonce:"wrong"});
  if(variant === "permission") f.client.fetch=async url => String(url).includes(".well-known") ? json(discovery) : json({access_token:"secret",id_token:"id",expires_in:3600,scope:"openid"});
  if(variant === "client-id") f.client.registration.clientId="another-client";
  if(variant === "subject") f.client.registration.subjectHash="other-user";
  assert.equal((await login(f)).response.status,400); assert.equal(f.client.state().signedIn,false);
  assert.doesNotMatch(fs.readFileSync(f.client.file,"utf8"),/private-access|secret/);
});
test("real JWT verification rejects wrong issuer, audience, signature and nonce",async t=>{
  const jose=await import("jose"), keys=await jose.generateKeyPair("RS256"), jwk=await jose.exportJWK(keys.publicKey); jwk.kid="test";
  const f=fixture(t,{verifyIdentity:null,fetchImpl:async url=>String(url).includes(".well-known") ? json(discovery) : json({keys:[jwk]})});
  const sign=async(overrides={},key=keys.privateKey)=>new jose.SignJWT({sub:"user",nonce:"nonce",...overrides}).setProtectedHeader({alg:"RS256",kid:"test"}).setIssuer(overrides.iss||discovery.issuer).setAudience(overrides.aud||"issued").setExpirationTime(overrides.exp || "1h").sign(key);
  assert.equal((await f.client.identity(await sign(),"issued","nonce")).sub,"user");
  for(const overrides of [{iss:"https://wrong.invalid"},{aud:"wrong"},{nonce:"wrong"},{exp:1}]) await assert.rejects(f.client.identity(await sign(overrides),"issued","nonce"));
  const other=await jose.generateKeyPair("RS256"); await assert.rejects(f.client.identity(await sign({},other.privateKey),"issued","nonce"));
});
test("refresh serializes requests, rotates credentials and omits scope; logout blocks a late refresh",async t=>{
  const f=fixture(t); await login(f); f.client.credentials.expiresAt=0;
  let release; f.client.fetch=async(url,init)=>{ f.requests.push({url,...init}); return new Promise(resolve=>{release=()=>resolve(json({access_token:"new-access",refresh_token:"rotated",expires_in:3600}));}); };
  const first=f.client.getAccessToken(), second=f.client.getAccessToken(); await new Promise(setImmediate);
  const form=f.requests.at(-1).body; assert.equal(form.get("grant_type"),"refresh_token"); assert.equal(form.has("scope"),false); assert.equal(form.get("resource"),"https://api.openai.com/v1");
  release(); assert.deepEqual(await Promise.all([first,second]),["new-access","new-access"]); assert.equal(f.client.credentials.refreshToken,"rotated");
  f.client.credentials.expiresAt=0; const late=f.client.getAccessToken(); await new Promise(setImmediate); f.client.logout(); release(); await assert.rejects(late); assert.equal(f.client.state().signedIn,false);
  assert.doesNotMatch(fs.readFileSync(f.client.file,"utf8"),/encrypted|new-access|rotated/);
});
test("terminal refresh failures require sign-in while transient failures keep credentials",async t=>{
  const f=fixture(t); await login(f); f.client.credentials.expiresAt=0;
  f.client.fetch=async()=>json({error:"temporarily_unavailable"},503); await assert.rejects(f.client.getAccessToken()); assert.equal(f.client.state().signedIn,true);
  f.client.fetch=async()=>json({error:"invalid_grant",description:"private-refresh"},400); await assert.rejects(f.client.getAccessToken(),error=>!error.message.includes("private-refresh")); assert.equal(f.client.state().error,"reauthorize"); assert.equal(f.client.state().signedIn,false);
});
test("basic_text encryption fallback never persists OAuth secrets",async t=>{
  const f=fixture(t,{safeStorage:{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>"basic_text"}}); await login(f);
  assert.equal(f.client.state().persistence,"session"); assert.equal(f.client.state().signedIn,true); assert.doesNotMatch(fs.readFileSync(f.client.file,"utf8"),/encrypted|private-/);
});
test("parallel sign-in creates one browser and logout cancels preparation",async t=>{
  const f=fixture(t); await Promise.all([f.client.beginSignIn(),f.client.beginSignIn()]); assert.equal(f.opened.length,1); f.client.logout(); assert.equal(f.client.state().pending,false);
});
test("migration preserves existing Codex selection, encrypted Decisions key and rejects retired conversation/STT options",t=>{
  const f=fixture(t), file=path.join(f.directory,"preferences.json");
  const existing=new Preferences(file,f.safeStorage); existing.setDecisionApiKey("decision-secret"); const saved=JSON.parse(fs.readFileSync(file)); delete saved.codexAuthMode; saved.backend="codex"; saved.speechInputProvider="openai"; fs.writeFileSync(file,JSON.stringify(saved));
  const migrated=new Preferences(file,f.safeStorage); assert.equal(migrated.data.codexAuthMode,"codex"); assert.equal(migrated.data.speechInputProvider,"browser"); assert.equal(migrated.getDecisionApiKey(),"decision-secret");
  migrated.patch({backend:"openai",codexAuthMode:"bad",speechInputProvider:"openai"}); assert.equal(migrated.data.backend,"codex"); assert.equal(migrated.data.codexAuthMode,"codex"); assert.equal(migrated.data.speechInputProvider,"browser");
  saved.backend="openai"; fs.writeFileSync(file,JSON.stringify(saved)); assert.equal(new Preferences(file,f.safeStorage).data.codexAuthMode,"chatgpt");
  assert.equal(new Preferences(path.join(f.directory,"fresh.json")).data.codexAuthMode,"chatgpt"); assert.doesNotMatch(JSON.stringify(migrated.publicState()),/decision-secret|encryptedApiKey|openaiModel|transcriptionModel/);
});
test("token rotation preserves thread identity without aborting the next turn; cancelled preparation cannot start",async()=>{
  let token="one"; const client=new CodexAppServerClient({accessTokenProvider:async()=>token,authMode:"chatgpt",configOverrides:PROVIDER_ARGS});
  await client.prepareAuthentication(); const signal=client.conversationController.signal; let killed=false;
  client.proc={kill:()=>{killed=true;},killed:false}; client.threadId="existing-thread"; token="two";
  await client.prepareAuthentication(); assert.equal(killed,true); assert.equal(signal.aborted,false); assert.equal(client.resumeThreadId,"existing-thread");
  const calls=[]; client.request=async(method,params)=>{calls.push({method,params});return {thread:{id:"existing-thread"}};};
  await client.ensureThread(); assert.equal(calls[0].method,"thread/resume"); assert.equal(calls[0].params.threadId,"existing-thread"); assert.equal(calls[0].params.ephemeral,undefined);
  let release; client.accessTokenProvider=()=>new Promise(resolve=>{release=resolve;}); const pending=client.ensureStarted(); client.stop(); release("three"); await assert.rejects(pending); assert.equal(client.proc,null);
  const env=childProcessEnvironment("wsl.exe",{CHARADOCK_CHATGPT_ACCESS_TOKEN:"dummy"},{PATH:"x"}); assert.equal(env.WSLENV,"CHARADOCK_CHATGPT_ACCESS_TOKEN");
  await assert.rejects(client.beginRealtime({}),/Live/);
});
test("app-server receives provider flags after its subcommand and uses the matching application name",async t=>{
  const f=fixture(t), fake=path.join(f.directory,"fake-server.cjs");
  fs.writeFileSync(fake,`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const message=JSON.parse(line);if(message.id)console.log(JSON.stringify({id:message.id,result:message.method==='initialize'?{args:process.argv.slice(2),client:message.params.clientInfo.name,token:process.env.CHARADOCK_CHATGPT_ACCESS_TOKEN,originator:process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE}:{}}));});`);
  const client=new CodexAppServerClient({command:process.execPath,commandArgs:[fake],cwd:f.directory,accessTokenProvider:async()=>"dummy",authMode:"chatgpt",configOverrides:PROVIDER_ARGS,environment:{CODEX_INTERNAL_ORIGINATOR_OVERRIDE:"Codex Desktop"}}); f.cleanupClients.push(client);
  const original=client.request.bind(client); let init;
  client.request=async(...args)=>{const result=await original(...args);if(args[0]==="initialize")init=result;return result;};
  await client.ensureStarted(); assert.equal(init.client,"CharaDock"); assert.equal(init.token,"dummy"); assert.equal(init.args[0],"app-server"); assert.ok(init.args.indexOf(PROVIDER_ARGS[0])>init.args.indexOf("app-server"));
  assert.equal(init.originator,"CharaDock");
  const forwarded=childProcessEnvironment("wsl.exe",client.environment,{}); assert.match(forwarded.WSLENV,/CODEX_INTERNAL_ORIGINATOR_OVERRIDE/); assert.equal(forwarded.CODEX_INTERNAL_ORIGINATOR_OVERRIDE,"CharaDock");
});

test("unreadable encrypted connection survives a cancelled sign-in until explicitly disconnected",async t=>{
  const f=fixture(t); await login(f);
  const original=JSON.parse(fs.readFileSync(f.client.file,"utf8")).encrypted;
  const broken=new ChatGPTSignIn({directory:f.directory,safeStorage:{...f.safeStorage,decryptString:()=>{throw new Error("Unavailable OS key");}},openExternal:async()=>{},fetchImpl:f.client.fetch});
  t.after(()=>broken.dispose()); assert.equal(broken.state().error,"saved_connection_unavailable");
  await broken.beginSignIn(); broken.dispose();
  assert.equal(JSON.parse(fs.readFileSync(f.client.file,"utf8")).encrypted,original);
  broken.logout(); assert.equal(JSON.parse(fs.readFileSync(f.client.file,"utf8")).encrypted,undefined);
});
