// SPDX-License-Identifier: Apache-2.0
// Opt-in real OAuth / Chat / Work / WebRTC probe. Credentials stay in memory.
// Usage: electron SCRIPT SOURCE OUTPUT_WITH_JOSE_INSTALLED
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const [source, output] = process.argv.slice(2);
if (!source || !output) throw Error("Supply SOURCE and isolated OUTPUT");
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "electron-profile"));
app.setName("CharaDock SIWC verification");
const { CodexAppServerClient } = require(path.join(source, "desktop/backend/codex-client.cjs"));
const { resolveCodexCommand, resolveInstalledWslCodexCommand, windowsPathToWsl, wslCommandArgsForPath } = require(path.join(source, "desktop/lib/codex-command.cjs"));
const results = { startedAt: new Date().toISOString(), isolated: true, tokenPersistence: false, checks: [] };
let stage = "preparing", credentials, server, peerWindow;
const clients = [], secrets = [];
function safe(value) {
  let text = String(value || "");
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted JWT]").slice(0, 1500);
}
console.warn = (...args) => console.log(...args.map(safe));
function save() { fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify({ ...results, stage }, null, 2)); }
function record(name, value) { const item = { name, ...value }; results.checks.push(item); console.log(JSON.stringify(item)); save(); }
async function check(name, run) {
  stage = name; save(); const started = Date.now();
  try { const value = await run(); record(name, { passed: true, elapsedMs: Date.now() - started, ...value }); }
  catch (error) { record(name, { passed: false, error: safe(error.message), elapsedMs: Date.now() - started }); }
}
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw Error(`HTTP ${response.status}: ${safe(data.error?.code || data.error || "request_failed")}: ${safe(data.error?.message || data.error_description || "")}`);
  return data;
}
async function waitUntil(check, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const result = await check(); if (result) return result; await new Promise(r => setTimeout(r, 100)); }
  throw Error("Verification timed out");
}
async function runChecks() {
  const token = credentials.access_token;
  const auth = { Authorization: `Bearer ${token}` };
  const catalog = await jsonRequest("https://api.openai.com/v1/models", { headers: auth });
  const models = (catalog.models || []).filter(model => model.visibility === "list");
  results.models = models.map(model => ({ slug: model.slug, displayName: model.display_name })); save();
  const prefs = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "charadock/preferences.json"), "utf8"));
  const chatModel = prefs.codexChatModel || prefs.codexModel;
  const workModel = prefs.codexWorkModel || prefs.codexModel;
  const command = await resolveCodexCommand({ cacheDirectory: path.join(output, "runtime") });
  if (!command) throw Error("Codex executable unavailable");
  const wslCommand = await resolveInstalledWslCodexCommand({ cacheDirectory: path.join(output, "runtime") });
  // The installed CLI ignores -c flags before its app-server subcommand.
  // Use the isolated home's non-secret configuration and verify it after startup.
  const providerConfig = ['model_provider="openai_chatgpt_plan"',
    '[model_providers.openai_chatgpt_plan]', 'name="ChatGPT plan"',
    'base_url="https://api.openai.com/v1"', 'env_key="ACCESS_TOKEN"',
    'wire_api="responses"', 'requires_openai_auth=false', 'supports_websockets=false'].join("\n");
  function client(kind, model, sandbox = "read-only", useWsl = false) {
    const directory = path.join(output, kind); fs.mkdirSync(directory, { recursive: true });
    const codexHome = path.join(output, "codex-home", kind); fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "config.toml"), providerConfig);
    const runtime = useWsl ? {
      cwd: windowsPathToWsl(directory), spawnCwd: directory, command: "wsl.exe",
      commandArgs: wslCommandArgsForPath(directory, [wslCommand]), pathMapper: windowsPathToWsl,
    } : { cwd: directory, command };
    const value = new CodexAppServerClient({ ...runtime, model,
      sandbox, approvalPolicy: "never", webSearchMode: "disabled", reasoningEffort: "low",
      developerInstructions: "Follow the user's verification request exactly. Use tools only when requested. Work only in this temporary directory.",
      environment: { CODEX_HOME: useWsl ? windowsPathToWsl(codexHome) : codexHome, ACCESS_TOKEN: token } });
    const request = value.request.bind(value);
    value.request = (method, params, ...rest) => request(method, method === "initialize" ? { ...params, clientInfo: { ...params.clientInfo, name: "CharaDock" } } : params, ...rest);
    clients.push(value); return value;
  }
  const chat = client("chat", chatModel), work = client("work", workModel, "workspace-write", Boolean(wslCommand));
  results.workRuntime = wslCommand ? "WSL (same runner as CharaDock Work)" : "Windows"; save();
  await check("Provider configuration", async () => {
    await chat.ensureStarted();
    const { config } = await chat.request("config/read", { includeLayers: false }, 30000);
    assert.equal(config.model_provider, "openai_chatgpt_plan");
    assert.equal(config.model_providers.openai_chatgpt_plan.env_key, "ACCESS_TOKEN");
    assert.equal(config.model_providers.openai_chatgpt_plan.supports_websockets, false);
    return { provider: config.model_provider, credentialPassedThroughEnvironment: true };
  });
  await check("Chat", async () => {
    assert.ok(models.some(model => model.slug === chatModel), `Current Chat model not in account catalog: ${chatModel}`);
    const events = [];
    const reply = await chat.sendMessage("Reply with exactly SIWC_CHAT_OK. Do not use tools.", { onEvent: event => { if (event.method === "turn/completed") events.push(event.params?.turn?.status); } });
    assert.equal(reply.text.trim(), "SIWC_CHAT_OK"); assert.ok(events.includes("completed"));
    return { model: chatModel, response: reply.text, completed: true };
  });
  await check("Chat continuity", async () => {
    const reply = await chat.sendMessage("What exact marker did you just return? Return only that marker.");
    assert.equal(reply.text.trim(), "SIWC_CHAT_OK"); return { response: reply.text, threadPreserved: true };
  });
  await check("Work", async () => {
    assert.ok(models.some(model => model.slug === workModel), `Current Work model not in account catalog: ${workModel}`);
    const tools = [], statuses = [];
    const reply = await work.sendMessage("Create RESULT.txt in the current temporary workspace containing exactly SIWC_WORK_OK followed by a newline. Use a local tool to create it. Do not create or change any other file.", { onEvent: event => {
      if (event.params?.item?.type) tools.push(event.params.item.type);
      if (event.method === "turn/completed") statuses.push(event.params?.turn?.status);
    } });
    results.workDiagnostics = { response: reply.text, statuses, itemTypes: [...new Set(tools)] }; save();
    assert.equal(fs.readFileSync(path.join(output, "work/RESULT.txt"), "utf8").trim(), "SIWC_WORK_OK");
    assert.ok(statuses.includes("completed"));
    return { model: workModel, response: reply, fileCreated: true, completed: true, itemTypes: [...new Set(tools)] };
  });
  peerWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await peerWindow.loadURL("data:text/html,<title>CharaDock SIWC WebRTC verification</title>");
  const js = code => peerWindow.webContents.executeJavaScript(code);
  async function makeOffer() { return js(`(async()=>{
    window.peer?.close();await window.context?.close();
    window.qa={state:'new',receivedAudio:false,packets:0,audibleSamples:0,peak:0};window.peer=new RTCPeerConnection();
    window.context=new AudioContext();await context.resume();const destination=context.createMediaStreamDestination();
    window.osc=context.createOscillator();const gain=context.createGain();gain.gain.value=0;osc.connect(gain).connect(destination);osc.start();
    peer.addTrack(destination.stream.getAudioTracks()[0],destination.stream);window.dc=peer.createDataChannel('oai-events');
    peer.onconnectionstatechange=()=>qa.state=peer.connectionState;
    peer.ontrack=e=>{qa.receivedAudio=true;window.remoteAudio=new Audio();remoteAudio.muted=true;
      remoteAudio.srcObject=e.streams[0]||new MediaStream([e.track]);remoteAudio.play().catch(()=>{});
      window.incoming=context.createMediaStreamSource(new MediaStream([e.track]));
      window.processor=context.createScriptProcessor(4096,1,1);window.mute=context.createGain();mute.gain.value=0;
      processor.onaudioprocess=event=>{for(const sample of event.inputBuffer.getChannelData(0)){qa.peak=Math.max(qa.peak,Math.abs(sample));if(Math.abs(sample)>0.0001)qa.audibleSamples++;}};
      incoming.connect(processor).connect(mute).connect(context.destination);
    };await peer.setLocalDescription(await peer.createOffer());return peer.localDescription.sdp;
  })()`); }
  for (const mode of ["Live Chat", "Live Work"]) await check(mode, async () => {
    const offer = await makeOffer();
    const live = client(mode.replace(/ /g, "-").toLowerCase(), mode === "Live Work" ? workModel : chatModel, mode === "Live Work" ? "workspace-write" : "read-only", mode === "Live Work" && Boolean(wslCommand));
    const events = [];
    const result = await live.beginRealtime({ sdp: offer, includeStartupContext: false, onEvent: event => {
      events.push({ method: event.method, role: event.params?.role, status: event.params?.turn?.status, message: safe(event.params?.message), text: safe(event.params?.text) });
      if (event.method === "thread/realtime/sdp") js(`peer.setRemoteDescription(${JSON.stringify({ type: "answer", sdp: event.params.sdp })})`).catch(error => console.log(safe(error.message)));
    } });
    assert.equal(result.transport, "webrtc");
    await waitUntil(() => js("qa.state==='connected'"));
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (mode === "Live Chat") await live.appendRealtimeText("日本語で、こんにちは、とだけ音声で返答してください。");
    else await live.appendRealtimeText("Create LIVE_RESULT.txt in the current temporary workspace containing exactly SIWC_LIVE_WORK_OK followed by a newline. Do not change any other files.");
    await waitUntil(async () => {
      const stats = await js("(async()=>{const stats=await peer.getStats();let packets=0;stats.forEach(s=>{if(s.type==='inbound-rtp'&&(s.kind==='audio'||s.mediaType==='audio'))packets+=s.packetsReceived||0;});return packets;})()");
      const audible = await js("qa.audibleSamples>480");
      const transcript = events.some(event => event.method === "thread/realtime/transcript/done" && event.role === "assistant" && event.text);
      return stats > 0 && audible && transcript && (mode !== "Live Work" || fs.existsSync(path.join(output, "live-work/LIVE_RESULT.txt")));
    }, 60000);
    if (mode === "Live Work") assert.equal(fs.readFileSync(path.join(output, "live-work/LIVE_RESULT.txt"), "utf8").trim(), "SIWC_LIVE_WORK_OK");
    const audio = await js("({audibleSamples:qa.audibleSamples,peak:qa.peak})");
    await live.stopRealtime();
    return { connected: true, actualWebRtc: true, receivedAudioPackets: true, audio, events };
  });
  let realtimeSecret;
  await check("Realtime API authorization", async () => {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ session: { type: "realtime", model: "gpt-realtime" } }), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw Error(`HTTP ${response.status}: ${safe(data.error?.code)}: ${safe(data.error?.message)}`);
    // A client secret proves authorization only, never a completed voice session.
    if (data.value) { secrets.push(data.value); realtimeSecret = data.value; }
    return { authorized: true, sessionTested: false };
  });
  await check("Realtime API voice session", async () => {
    assert.ok(realtimeSecret, "No ephemeral Realtime credential");
    const offer = await makeOffer();
    await js(`dc.onmessage=event=>{const item=JSON.parse(event.data);if(item.type==='error')qa.error=item.error?.message;
      if(item.type==='response.output_audio_transcript.done')qa.transcript=item.transcript;
      if(item.type==='response.done')qa.responseStatus=item.response?.status;};void 0;`);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST",
      headers: { Authorization: `Bearer ${realtimeSecret}`, "Content-Type": "application/sdp" },
      body: offer, signal: AbortSignal.timeout(30000) });
    const answer = await response.text();
    if (!response.ok) throw Error(`HTTP ${response.status}: ${safe(answer)}`);
    await js(`peer.setRemoteDescription(${JSON.stringify({ type: "answer", sdp: answer })})`);
    await waitUntil(() => js("qa.state==='connected'&&dc.readyState==='open'"));
    await js(`dc.send(JSON.stringify({type:'response.create',response:{instructions:'日本語で、こんにちは、とだけ音声で返答してください。',output_modalities:['audio']}}))`);
    await waitUntil(async () => {
      const state = await js("({error:qa.error,status:qa.responseStatus,audibleSamples:qa.audibleSamples,transcript:qa.transcript})");
      if (state.error) throw Error(safe(state.error));
      if (["failed", "cancelled", "incomplete"].includes(state.status)) throw Error(`Realtime response ${state.status}`);
      return state.status === "completed" && state.audibleSamples > 480 && state.transcript;
    }, 60000);
    const audio = await js("({audibleSamples:qa.audibleSamples,peak:qa.peak,transcript:qa.transcript,responseStatus:qa.responseStatus})");
    return { actualWebRtc: true, connected: true, ...audio };
  });
}
(async () => {
  await app.whenReady();
  const jose = await import(pathToFileURL(require.resolve("jose", { paths: [output] })).href);
  const discovery = await jsonRequest("https://auth.openai.com/.well-known/openid-configuration");
  assert.equal(discovery.issuer, "https://auth.openai.com");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) assert.equal(new URL(discovery[key]).origin, "https://auth.openai.com");
  const jwks = jose.createRemoteJWKSet(new URL(discovery.jwks_uri));
  const registrationFile = path.join(output, "registration.json");
  const registration = fs.existsSync(registrationFile) ? JSON.parse(fs.readFileSync(registrationFile, "utf8")) : { hostId: `urn:uuid:${crypto.randomUUID()}` };
  fs.writeFileSync(registrationFile, JSON.stringify(registration));
  const state = crypto.randomBytes(32).toString("base64url"), nonce = crypto.randomBytes(32).toString("base64url"), verifier = crypto.randomBytes(32).toString("base64url");
  let authUrl, redirectUri, accepted = false;
  const authorized = new Promise((resolve, reject) => {
    server = http.createServer(async (request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      response.setHeader("Cache-Control", "no-store");response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (url.pathname === "/") return response.end(`<title>CharaDock Sign in with ChatGPT 検証</title><h1>CharaDock 接続検証</h1><p>ChatGPTプランの利用を許可すると、Chat/WorkとLiveを短いテストで検証します。既存のCodexログインは変更しません。</p><a href="${authUrl}">Continue with ChatGPT</a>`);
      if (url.pathname === "/status") return response.end(`<title>CharaDock 検証状況</title><meta http-equiv="refresh" content="3"><pre>${safe(stage)}</pre>`);
      if (url.pathname !== "/auth/callback") { response.statusCode = 404; return response.end(); }
      try {
        assert.equal(url.searchParams.get("state"), state, "OAuth state mismatch");
        if (url.searchParams.get("error")) throw Error(`OAuth ${safe(url.searchParams.get("error"))}`);
        assert.equal(accepted, false, "Callback already consumed"); accepted = true;
        const clientId = url.searchParams.get("client_id") || registration.clientId;
        assert.ok(clientId && clientId !== "dynamic_agent_client", "Missing issued client ID");
        if (registration.clientId) assert.equal(clientId, registration.clientId, "Client ID changed");
        registration.clientId = clientId; fs.writeFileSync(registrationFile, JSON.stringify(registration));
        const code = url.searchParams.get("code"); assert.ok(code, "Missing authorization code"); secrets.push(code);
        const token = await jsonRequest(discovery.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: "https://api.openai.com/v1" }) });
        secrets.push(token.access_token, token.refresh_token, token.id_token);
        const { payload } = await jose.jwtVerify(token.id_token, jwks, { issuer: discovery.issuer, audience: clientId, algorithms: ["RS256"], clockTolerance: 5 });
        assert.ok(Number.isFinite(payload.exp), "Missing ID token expiration");
        assert.equal(payload.nonce, nonce, "ID token nonce mismatch");assert.ok(payload.sub);
        const subjectHash = crypto.createHash("sha256").update(payload.sub).digest("hex");
        if (registration.subjectHash) assert.equal(subjectHash, registration.subjectHash, "Account identity changed");
        registration.subjectHash = subjectHash; fs.writeFileSync(registrationFile, JSON.stringify(registration));
        const scopes = String(token.scope || "").split(/\s+/);
        assert.ok(scopes.includes("chatgpt.tokens.use.direct"), "ChatGPT plan usage permission was not granted");
        credentials = token;results.auth = { signatureValidated: true, nonceValidated: true, grantedScopes: scopes };stage = "authorized";save();
        response.writeHead(303, { Location: "/status" });response.end();resolve();
      } catch (error) { response.statusCode = 400;response.end("接続検証を開始できませんでした。Codexのチャットに戻ってください。");reject(error); }
    });
  });
  await new Promise(resolve => server.listen(Number(process.env.SIWC_PROBE_PORT || 0), "127.0.0.1", resolve));
  redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
  const authorize = new URL(discovery.authorization_endpoint);
  const parameters = { client_id: registration.clientId || "dynamic_agent_client", ext_agent_host_id: registration.hostId,
    response_type: "code", redirect_uri: redirectUri, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct", resource: "https://api.openai.com/v1",
    state, nonce, code_challenge_method: "S256", code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
  if (!registration.clientId) parameters.agent_name_hint = "CharaDock";
  for (const [key, value] of Object.entries(parameters)) authorize.searchParams.set(key, value);
  authUrl = authorize.href;
  const landingUrl = `http://127.0.0.1:${server.address().port}/`;
  fs.writeFileSync(path.join(output, "landing.json"), JSON.stringify({ url: landingUrl }));
  stage = "awaiting-user-sign-in"; save();console.log("Ready for browser sign-in", landingUrl);
  await Promise.race([authorized, new Promise((_, reject) => setTimeout(() => reject(Error("Sign-in timed out")), 15 * 60000))]);
  await runChecks();stage = "complete";save();console.log("Probe complete");
})().catch(error => { stage = "failed";results.error = safe(error.message);save();console.error(safe(error.message)); }).finally(() => {
  credentials = null;secrets.fill("");for (const client of clients) client.stop();peerWindow?.destroy();
  server?.close();app.exit(stage === "complete" ? 0 : 1);
});
