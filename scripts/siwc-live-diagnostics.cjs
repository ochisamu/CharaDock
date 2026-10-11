// SPDX-License-Identifier: Apache-2.0
// Opt-in Windows Electron probe: SOURCE OUTPUT [--sign-in | --profile PROFILE].
// --profile uses only CharaDock's own encrypted connection, never Codex auth.json.
// Every app-server uses a separate empty CODEX_HOME.
const { app, BrowserWindow, shell, safeStorage } = require("electron");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { execFileSync, spawn } = require("node:child_process");
const [source, output, action, profile] = process.argv.slice(2);
if (!source || !output) throw new Error("Supply SOURCE OUTPUT [--sign-in]");
fs.mkdirSync(output, { recursive: true });
// Windows safeStorage keys are scoped to userData. Use the actual profile for
// encrypted credentials, including across separate verification processes.
app.setName("CharaDock");
app.setPath("userData", ["--profile", "--work-only"].includes(action) ? profile : path.join(output, "electron"));
const { CodexAppServerClient } = require(path.join(source, "desktop/backend/codex-client.cjs"));
const { ChatGPTSignIn, PROVIDER_ARGS } = require(path.join(source, "desktop/lib/chatgpt-sign-in.cjs"));
const { resolveCodexCommand, resolveInstalledWslCodexCommand, windowsPathToWsl, wslCommandArgsForPath } = require(path.join(source, "desktop/lib/codex-command.cjs"));
const results = { stage: "starting", isolated: true, credentialsPersisted: false, checks: [] };
const secrets = [], clients = [];
let auth, peerWindow, captureServer, wslCapture;
const write = () => fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(results, null, 2));
const safe = value => {
  let text = String(value || "");
  for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
  return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted JWT]").slice(0, 1200);
};
console.warn = (...args) => console.log(...args.map(safe));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(run, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const result = await run(); if (result) return result; await sleep(100); }
  throw new Error("Verification timed out");
}
async function check(name, run) {
  results.stage = name; write(); const started = Date.now();
  try { results.checks.push({ name, passed: true, ...await run(), elapsedMs: Date.now() - started }); }
  catch (error) { results.checks.push({ name, passed: false, error: safe(error.message), diagnostics: error.diagnostics, elapsedMs: Date.now() - started }); }
  write(); console.log(JSON.stringify(results.checks.at(-1)));
}
(async () => {
  await app.whenReady();
  const command = await resolveCodexCommand({ cacheDirectory: path.join(output, "runtime") });
  const wsl = await resolveInstalledWslCodexCommand({ cacheDirectory: path.join(output, "runtime") });
  if (!command || !wsl) throw new Error("Windows and WSL Codex installations required");
  const versions = { windows: execFileSync(command, ["--version"], { windowsHide: true }).toString().trim(),
    wsl: execFileSync("wsl.exe", ["--exec", wsl, "--version"], { windowsHide: true }).toString().trim() };
  results.versions = versions; write();
  function client(kind, useWsl, token, extra = [], version = "v3", model = "gpt-live-1-codex", authMode = "codex") {
    const cwd = path.join(output, kind), home = path.join(cwd, "home"); fs.mkdirSync(home, { recursive: true });
    const value = new CodexAppServerClient({ command: useWsl ? "wsl.exe" : command,
      commandArgs: useWsl ? wslCommandArgsForPath(cwd, [wsl]) : [],
      cwd: useWsl ? windowsPathToWsl(cwd) : cwd, spawnCwd: cwd,
      model: "gpt-6-luna", sandbox: "read-only", approvalPolicy: "never", webSearchMode: "disabled",
      authMode,
      environment: { CODEX_HOME: useWsl ? windowsPathToWsl(home) : home, CHARADOCK_CHATGPT_ACCESS_TOKEN: token,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "CharaDock" },
      configOverrides: [...PROVIDER_ARGS, ...extra] });
    // Research only: bypass the product's unsupported-SIWC guard, preserving the same provider.
    // Never load a legacy account or allow requires_openai_auth to select a different credential.
    const request = value.request.bind(value);
    value.request = (method, params, ...rest) => request(method,
      method === "initialize" ? { ...params, clientInfo: { ...params.clientInfo, name: "CharaDock" } } :
      method === "thread/realtime/start" ? { ...params, version, model } : params, ...rest);
    clients.push(value); return value;
  }
  let captured;
  captureServer = http.createServer(async (request, response) => {
    let body = ""; for await (const chunk of request) body += chunk;
    captured = { path: request.url, alpha: request.headers["openai-alpha"], originator: request.headers.originator,
      credentialMatches: request.headers.authorization === "Bearer synthetic-only",
      accountHeaderPresent: Boolean(request.headers["chatgpt-account-id"]),
      modelPresent: body.includes('"model":"gpt-live-1-codex"'), multipart: /multipart/.test(request.headers["content-type"] || "") };
    response.writeHead(400, { "Content-Type": "application/json" }); response.end('{"error":{"message":"isolated capture complete","type":"invalid_request_error"}}');
  });
  await new Promise(resolve => captureServer.listen(0, "127.0.0.1", resolve));
  const captureBase = `http://127.0.0.1:${captureServer.address().port}`;
  // WSL NAT cannot reach Windows loopback. Capture the Linux runtime inside WSL.
  const linuxCaptureFile = path.join(output, "capture-server.cjs");
  fs.writeFileSync(linuxCaptureFile, `const http=require('node:http');const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;console.log(JSON.stringify({request:{path:req.url,alpha:req.headers['openai-alpha'],originator:req.headers.originator,credentialMatches:req.headers.authorization==='Bearer synthetic-only',accountHeaderPresent:Boolean(req.headers['chatgpt-account-id']),modelPresent:body.includes('"model":"gpt-live-1-codex"'),multipart:/multipart/.test(req.headers['content-type']||'')}}));res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":{"message":"isolated capture complete","type":"invalid_request_error"}}');});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));`);
  let linuxPort, buffer = "";
  wslCapture = spawn("wsl.exe", ["--exec", "/usr/bin/node", windowsPathToWsl(linuxCaptureFile)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  wslCapture.stdout.on("data", chunk => {
    buffer += chunk; let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); try { const item = JSON.parse(line); if (item.port) linuxPort = item.port; if (item.request) captured = item.request; } catch {} }
  });
  await until(() => linuxPort, 10000);
  for (const useWsl of [false, true]) for (const backend of [false, true]) await check(`Capture ${useWsl ? "WSL" : "Windows"} ${backend ? "backend" : "public"}`, async () => {
    captured = null;
    const base = `${useWsl ? `http://127.0.0.1:${linuxPort}` : captureBase}${backend ? "/backend-api/codex" : "/v1"}`;
    const c = client(`capture-${useWsl}-${backend}`, useWsl, "synthetic-only", [`experimental_realtime_webrtc_call_base_url=${JSON.stringify(base)}`]);
    let error;
    try { await c.beginRealtime({ sdp: "v=0\r\n", includeStartupContext: false }); } catch (failure) { error = safe(failure.message); }
    finally { c.stop(); }
    if (!captured?.credentialMatches || !captured.modelPresent) throw new Error(`Expected synthetic request not captured: ${error}`);
    return { request: captured };
  });
  captureServer.close(); captureServer = null; wslCapture.kill(); wslCapture = null;
  if (!["--sign-in", "--profile", "--work-only"].includes(action)) { results.stage = "complete"; write(); return; }
  const useProfile = ["--profile", "--work-only"].includes(action);
  if (useProfile && !profile) throw new Error("Supply the CharaDock profile");
  auth = new ChatGPTSignIn({ directory: useProfile ? path.join(profile, "chatgpt-connection") : path.join(output, "registration"), safeStorage: useProfile ? safeStorage : null,
    openExternal: url => {
      const authorize = new URL(url);
      // Reuse already-granted consent without interacting with a login dialog.
      // If OpenID requires interaction, the callback fails and the probe stops.
      if (action === "--work-only") authorize.searchParams.set("prompt", "none");
      return shell.openExternal(authorize.href);
    }, onChange: state => { results.authState = { signedIn: state.signedIn, pending: state.pending, error: state.error }; write(); } });
  results.credentialsPersisted = useProfile && auth.canEncrypt();
  if (!auth.state().signedIn) { await auth.beginSignIn(); results.stage = "awaiting-user-sign-in"; write(); }
  await until(() => { const state = auth.state(); if (!state.signedIn && !state.pending) throw new Error("Authentication requires user interaction"); return state.signedIn; }, 10 * 60000);
  const token = await auth.getAccessToken(); secrets.push(token, auth.credentials?.refreshToken, auth.credentials?.idToken);
  for (const useWsl of [false, true]) await check(useWsl ? "SIWC Work file" : "SIWC Chat", async () => {
    const kind = useWsl ? "work-file" : "chat-turn", c = client(kind, useWsl, token, useWsl ? ['sandbox_mode="workspace-write"'] : [], "v3", "gpt-live-1-codex", "chatgpt");
    if (useWsl) c.sandbox = "workspace-write";
    const completed = [], items = [];
    try {
      const response = await c.sendMessage(useWsl ? "Create RESULT.txt in the current temporary directory containing exactly SIWC_WORK_OK followed by a newline. Do not create or change other files." : "Reply with exactly SIWC_CHAT_OK. Do not use tools.", { onEvent: event => { if (event.method === "turn/completed") completed.push(event.params?.turn?.status); if (event.method === "item/completed") items.push({ type: event.params?.item?.type, command: safe(event.params?.item?.command), status: event.params?.item?.status, output: safe(event.params?.item?.aggregatedOutput) }); } });
      results.inferenceDiagnostics = { response: safe(response.text), completed, items }; write();
      const actual = useWsl ? fs.readFileSync(path.join(output, kind, "RESULT.txt"), "utf8").trim() : response.text.trim();
      if (actual !== (useWsl ? "SIWC_WORK_OK" : "SIWC_CHAT_OK") || !completed.includes("completed")) throw new Error("Inference verification did not complete");
      return { completed: true, fileCreated: useWsl, marker: actual };
    } finally { c.stop(); }
  });
  if (action === "--work-only") { results.stage = "complete"; write(); return; }
  peerWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await peerWindow.loadURL("data:text/html,<title>CharaDock isolated audio verification</title>");
  const js = code => peerWindow.webContents.executeJavaScript(code);
  async function offer() { return js(`(async()=>{
    window.peer?.close();await window.context?.close();window.qa={state:'new',audibleSamples:0,peak:0};
    window.peer=new RTCPeerConnection();window.context=new AudioContext();await context.resume();
    const dest=context.createMediaStreamDestination(),osc=context.createOscillator(),gain=context.createGain();
    gain.gain.value=0;osc.connect(gain).connect(dest);osc.start();peer.addTrack(dest.stream.getAudioTracks()[0],dest.stream);
    window.dc=peer.createDataChannel('oai-events');peer.onconnectionstatechange=()=>qa.state=peer.connectionState;
    peer.ontrack=e=>{const incoming=context.createMediaStreamSource(new MediaStream([e.track]));
      const processor=context.createScriptProcessor(4096,1,1),mute=context.createGain();mute.gain.value=0;
      processor.onaudioprocess=ev=>{for(const sample of ev.inputBuffer.getChannelData(0)){qa.peak=Math.max(qa.peak,Math.abs(sample));if(Math.abs(sample)>0.0001)qa.audibleSamples++;}};
      incoming.connect(processor).connect(mute).connect(context.destination);window.audioNodes={incoming,processor,mute};};
    await peer.setLocalDescription(await peer.createOffer());return peer.localDescription.sdp;
  })()`); }
  async function native(kind, useWsl, credential, extra = [], version = "v3", model = "gpt-live-1-codex") {
    const c = client(kind, useWsl, credential, extra, version, model), sdp = await offer(), events = [];
    try {
      await c.beginRealtime({ sdp, includeStartupContext: false, onEvent: event => {
        events.push({ method: event.method, role: event.params?.role, text: safe(event.params?.text), message: safe(event.params?.message) });
        if (event.method === "thread/realtime/sdp") js(`peer.setRemoteDescription(${JSON.stringify({ type: "answer", sdp: event.params.sdp })})`).catch(() => {});
      } });
      await until(() => js("qa.state==='connected'"));
      await c.appendRealtimeText("日本語で、こんにちは、とだけ音声で返答してください。");
      await until(async () => (await js("qa.audibleSamples>480")) && events.some(e => e.role === "assistant" && e.text), 60000);
      return { connected: true, audio: await js("qa"), transcript: events.filter(e => e.role === "assistant" && e.text).map(e => e.text) };
    } catch (error) {
      error.diagnostics = { sdpReceived: events.some(e => e.method === "thread/realtime/sdp"), started: events.some(e => e.method === "thread/realtime/started"), methods: [...new Set(events.map(e => e.method))], peer: await js("qa") };
      throw error;
    } finally { await c.stopRealtime().catch(() => {}); c.stop(); }
  }
  for (const useWsl of [false, true]) await check(`Native SIWC ${useWsl ? "WSL" : "Windows"}`, () => native(`native-${useWsl}`, useWsl, token));
  const backendArgs = ['experimental_realtime_webrtc_call_base_url="https://chatgpt.com/backend-api/codex"',
    'experimental_realtime_ws_base_url="wss://api.openai.com/v1"'];
  await check("Native SIWC backend route", () => native("backend-route", false, token, backendArgs));
  await check("Native SIWC public Live model", () => native("public-model", false, token, [], "v3", "gpt-live-1"));
  await check("Native SIWC legacy query parameters", () => native("query-parameters", false, token, ['model_providers.openai_chatgpt_plan.query_params={intent="quicksilver",architecture="avas"}']));
  let ephemeral;
  async function mintSecret(model) {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: { type: "realtime", model } }), signal: AbortSignal.timeout(30000) });
    const data = await response.json(); if (data.value) secrets.push(data.value);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${safe(data.error?.code)} ${safe(data.error?.message)}`);
    if (!data.value) throw new Error("Client secret missing"); return data.value;
  }
  await check("Realtime client secret", async () => {
    ephemeral = await mintSecret("gpt-realtime");
    return { authorized: true, audioTested: false };
  });
  if (ephemeral) await check("Native Live with Realtime secret", () => native("ephemeral-native", false, ephemeral));
  await check("Native Live with matching-model secret", async () => native("ephemeral-matching", false, await mintSecret("gpt-live-1-codex")));
  if (ephemeral) await check("Native Live fresh-secret retry", async () => native("ephemeral-retry", false, await mintSecret("gpt-realtime")));
  await check("Public Realtime voice control", async () => {
    ephemeral = await mintSecret("gpt-realtime-2.1");
    const sdp = await offer();
    await js(`dc.onmessage=event=>{const item=JSON.parse(event.data);if(item.type==='error')qa.error=item.error?.message;
      if(item.type==='response.output_audio_transcript.done')qa.transcript=item.transcript;
      if(item.type==='response.done')qa.status=item.response?.status;};void 0;`);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${ephemeral}`, "Content-Type": "application/sdp" }, body: sdp, signal: AbortSignal.timeout(30000) });
    const answer = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${safe(answer)}`);
    await js(`peer.setRemoteDescription(${JSON.stringify({ type: "answer", sdp: answer })})`);
    await until(() => js("qa.state==='connected'&&dc.readyState==='open'"));
    await js(`dc.send(JSON.stringify({type:'response.create',response:{instructions:'日本語で、こんにちは、とだけ音声で返答してください。',output_modalities:['audio']}}))`);
    await until(async () => { const state = await js("qa"); if (state.error) throw new Error(safe(state.error)); return state.status === "completed" && state.audibleSamples > 480 && state.transcript; }, 60000);
    return { actualVoiceResponse: true, audio: await js("qa") };
  });
  results.stage = "complete"; write();
})().catch(error => { results.stage = "failed"; results.error = safe(error.message); write(); }).finally(() => {
  for (const c of clients) c.stop(); auth?.dispose(); peerWindow?.destroy(); captureServer?.close(); wslCapture?.kill(); secrets.fill(""); app.exit(results.stage === "complete" ? 0 : 1);
});
