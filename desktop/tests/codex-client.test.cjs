// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CODEX_MASCOT_INSTRUCTIONS,
  CodexAppServerClient,
  appServerArgs,
  isOfficialComputerUseSkill,
  normalizeSkillName,
  permissionProfileForSandbox,
  workspaceSandboxPolicy,
} = require("../backend/codex-client.cjs");

test("Codex work client can explicitly enable live web search", () => {
  assert.deepEqual(appServerArgs("live"), [
    "app-server", "--stdio", "--enable", "realtime_conversation", "-c", 'web_search="live"',
  ]);
  assert.deepEqual(appServerArgs("live", "workspace-write"), [
    "app-server", "--stdio", "--enable", "realtime_conversation",
    "-c", 'web_search="live"', "-c", 'sandbox_mode="workspace-write"',
  ]);
  assert.deepEqual(appServerArgs("invalid"), ["app-server", "--stdio", "--enable", "realtime_conversation"]);
  assert.deepEqual(appServerArgs("disabled"), [
    "app-server", "--stdio", "--enable", "realtime_conversation", "-c", 'web_search="disabled"',
  ]);
  assert.match(CODEX_MASCOT_INSTRUCTIONS, /read-only web search/);
  assert.doesNotMatch(CODEX_MASCOT_INSTRUCTIONS, /Do not .*invoke tools/);
});

test("Codex workspace-write client scopes writes to the selected folder", async () => {
  const cwd = process.platform === "win32" ? "C:\\Users\\test\\Downloads\\project" : "/tmp/project";
  assert.deepEqual(workspaceSandboxPolicy("workspace-write", cwd), {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
  const home = process.platform === "win32" ? "C:\\Users\\test\\AppData\\CharacterHome" : "/tmp/character-home";
  assert.deepEqual(workspaceSandboxPolicy("workspace-write", cwd, [home]), {
    type: "workspaceWrite",
    writableRoots: [cwd, home],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
  assert.equal(workspaceSandboxPolicy("read-only", cwd), null);
  assert.equal(permissionProfileForSandbox("workspace-write"), ":workspace");
  assert.equal(permissionProfileForSandbox("read-only"), ":read-only");

  const client = new CodexAppServerClient({ cwd, sandbox: "workspace-write", workspaceRoots: [home] });
  client.ensureStarted = async () => {};
  let threadParams;
  client.request = async (method, params) => {
    assert.equal(method, "thread/start");
    threadParams = params;
    return { thread: { id: "thread-workspace" } };
  };
  await client.ensureThread();
  assert.deepEqual(threadParams.runtimeWorkspaceRoots, [cwd, home]);
  assert.equal(threadParams.permissions, ":workspace");
  assert.equal(Object.prototype.hasOwnProperty.call(threadParams, "sandbox"), false);
});

test("Codex client registers and answers app-server dynamic tools", async () => {
  const tools = [{ type: "function", name: "read_page", description: "Read", inputSchema: { type: "object" } }];
  const client = new CodexAppServerClient({
    dynamicTools: tools,
    onDynamicToolCall: async (params) => ({
      success: true,
      contentItems: [{ type: "inputText", text: `called:${params.tool}` }],
    }),
  });
  client.ensureStarted = async () => {};
  let threadParams;
  client.request = async (method, params) => {
    assert.equal(method, "thread/start");
    threadParams = params;
    return { thread: { id: "thread-tools" } };
  };
  await client.ensureThread();
  assert.deepEqual(threadParams.dynamicTools, tools);
  let response;
  client.proc = { stdin: { writable: true } };
  client.send = (payload) => { response = payload; };
  client.handleLine(JSON.stringify({
    id: 44,
    method: "item/tool/call",
    params: { threadId: "thread-tools", turnId: "turn-tools", callId: "call-1", tool: "read_page", arguments: {} },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response.id, 44);
  assert.equal(response.result.success, true);
  assert.equal(response.result.contentItems[0].text, "called:read_page");
});

test("Codex client reads account state through app-server", async () => {
  const client = new CodexAppServerClient();
  const calls = [];
  client.ensureStarted = async () => {};
  client.request = async (method, params) => {
    calls.push({ method, params });
    return { requiresOpenaiAuth: true, account: { type: "chatgpt", planType: "plus" } };
  };
  const result = await client.getAccount();
  assert.equal(result.account.type, "chatgpt");
  assert.deepEqual(calls, [{ method: "account/read", params: { refreshToken: false } }]);
});

test("Codex client starts the managed ChatGPT OAuth flow", async () => {
  const client = new CodexAppServerClient();
  let request;
  client.ensureStarted = async () => {};
  client.request = async (method, params) => {
    request = { method, params };
    return { type: "chatgpt", authUrl: "https://auth.openai.com/example", loginId: "login-1" };
  };
  const result = await client.startChatGPTLogin();
  assert.equal(result.loginId, "login-1");
  assert.equal(request.method, "account/login/start");
  assert.equal(request.params.type, "chatgpt");
  assert.equal(request.params.appBrand, "codex");
  assert.equal(request.params.useHostedLoginSuccessPage, true);
});

test("Codex client logs out through app-server and resets its conversation", async () => {
  const client = new CodexAppServerClient();
  client.threadId = "thread-1";
  client.ensureStarted = async () => {};
  let request;
  client.request = async (method, params) => {
    request = { method, params };
    return {};
  };
  assert.equal(await client.logout(), true);
  assert.deepEqual(request, { method: "account/logout", params: null });
  assert.equal(client.threadId, null);
});

test("Codex client checks image-generation capability", async () => {
  const client = new CodexAppServerClient();
  let request;
  client.ensureStarted = async () => {};
  client.request = async (method, params) => {
    request = { method, params };
    return { imageGeneration: true, namespaceTools: true, webSearch: true };
  };
  const result = await client.getModelProviderCapabilities();
  assert.equal(result.imageGeneration, true);
  assert.deepEqual(request, { method: "modelProvider/capabilities/read", params: {} });
});

test("Codex client lists all visible model picker pages", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  const calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (!params.cursor) return { data: [{ model: "model-a" }], nextCursor: "page-2" };
    return { data: [{ model: "model-b" }], nextCursor: null };
  };
  const models = await client.listModels();
  assert.deepEqual(models.map((model) => model.model), ["model-a", "model-b"]);
  assert.equal(calls[0].method, "model/list");
  assert.equal(calls[0].params.includeHidden, false);
  assert.equal(calls[1].params.cursor, "page-2");
});

test("Codex client lists realtime voices through the experimental app-server method", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  let request;
  client.request = async (method, params) => {
    request = { method, params };
    return { voices: { v2: ["marin", "cedar"], v1: ["cove"], defaultV2: "marin", defaultV1: "cove" } };
  };
  const result = await client.listRealtimeVoices();
  assert.deepEqual(result.voices.v2, ["marin", "cedar"]);
  assert.deepEqual(request, { method: "thread/realtime/listVoices", params: {} });
});

test("Codex conversation reuses one thread so follow-up turns keep context", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  let starts = 0;
  client.request = async (method) => {
    if (method === "thread/start") {
      starts += 1;
      return { thread: { id: "thread-conversation" } };
    }
    return {};
  };
  assert.equal(await client.ensureThread(), "thread-conversation");
  assert.equal(await client.ensureThread(), "thread-conversation");
  assert.equal(starts, 1);
});

test("Codex client sends per-turn model and reasoning effort overrides", async () => {
  const client = new CodexAppServerClient({
    model: "chat-model",
    reasoningEffort: "high",
    pathMapper: (value) => `/mapped${value}`,
  });
  client.ensureStarted = async () => {};
  client.ensureThread = async () => "thread-1";
  let turnParams;
  client.request = async (method, params) => {
    if (method === "turn/start") {
      turnParams = params;
      setImmediate(() => client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-1", delta: "ok" },
      })));
      setImmediate(() => client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: "turn-1", status: "completed" } },
      })));
      return { turn: { id: "turn-1" } };
    }
    return {};
  };
  const pending = client.sendMessage("hello", { localAudioPath: "/voice.webm" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(turnParams.model, "chat-model");
  assert.equal(turnParams.effort, "high");
  assert.deepEqual(turnParams.input, [
    { type: "text", text: "hello" },
    { type: "localAudio", path: "/mapped/voice.webm" },
  ]);
  await pending;
});

test("Codex client discovers skills for its working directory", async () => {
  const client = new CodexAppServerClient({ cwd: "/Users/test/Documents" });
  client.ensureStarted = async () => {};
  client.request = async (method, params) => {
    assert.equal(method, "skills/list");
    assert.deepEqual(params, { cwds: ["/Users/test/Documents"], forceReload: false });
    return { data: [{ cwd: "/Users/test/Documents", errors: [], skills: [{
      name: "computer-use:computer-use",
      path: "/Users/test/.codex/plugins/cache/openai-bundled/computer-use/1.0/skills/computer-use/SKILL.md",
      enabled: true,
      scope: "user",
    }] }] };
  };
  const skills = await client.listSkills();
  assert.equal(skills[0].scope, "user");
});

test("official Computer Use skill validation rejects aliases and spoofed paths", () => {
  const official = {
    name: "computer-use:computer-use",
    path: "/Users/test/.codex/plugins/cache/openai-bundled/computer-use/1.0/skills/computer-use/SKILL.md",
    enabled: true,
  };
  assert.equal(isOfficialComputerUseSkill(official), true);
  assert.equal(isOfficialComputerUseSkill({ ...official, enabled: false }), false);
  assert.equal(isOfficialComputerUseSkill({ ...official, name: "codex-computer-use" }), false);
  assert.equal(isOfficialComputerUseSkill({ ...official, name: "computer-use:computer-use!" }), false);
  assert.equal(isOfficialComputerUseSkill({ ...official, path: "/tmp/spoof/SKILL.md" }), false);
  assert.equal(normalizeSkillName(" Computer-Use:Computer-Use "), "computer-use:computer-use");
});

test("Codex client injects an explicit skill item into turn/start", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => "thread-skill";
  client.setTurnStartSkillItems([{ name: "computer-use:computer-use", path: "/official/SKILL.md" }]);
  let turnParams;
  client.request = async (method, params) => {
    if (method === "turn/start") {
      turnParams = params;
      setImmediate(() => client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-skill", delta: "done" },
      })));
      setImmediate(() => client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: "turn-skill", status: "completed" } },
      })));
      return { turn: { id: "turn-skill" } };
    }
    return {};
  };
  await client.sendMessage("$computer-use:computer-use 設定を開いて");
  assert.deepEqual(turnParams.input, [
    { type: "text", text: "$computer-use:computer-use 設定を開いて" },
    { type: "skill", name: "computer-use:computer-use", path: "/official/SKILL.md" },
  ]);
});

test("Computer Use clients fail closed on unhandled approval requests", async () => {
  const client = new CodexAppServerClient({ rejectInteractiveRequests: true });
  client.proc = { stdin: { writable: true } };
  let response;
  client.send = (payload) => { response = payload; };
  client.activeTurnId = "turn-approval";
  const pending = new Promise((resolve, reject) => {
    client.turnCollectors.set("turn-approval", { resolve, reject, timer: setTimeout(() => {}, 60_000) });
  });
  client.handleLine(JSON.stringify({
    id: 42,
    method: "tool/requestUserInput",
    params: { turnId: "turn-approval" },
  }));
  await assert.rejects(pending, /not approved/);
  assert.equal(client.activeTurnId, null);
  assert.equal(response.id, 42);
  assert.equal(response.error.code, -32601);
});

test("changing reasoning effort resets the current Codex thread", () => {
  const client = new CodexAppServerClient({ reasoningEffort: "low" });
  client.threadId = "thread-1";
  client.setReasoningEffort("high");
  assert.equal(client.reasoningEffort, "high");
  assert.equal(client.threadId, null);
});

test("Codex client starts WebRTC realtime and forwards transcript events", async () => {
  const client = new CodexAppServerClient();
  const calls = [];
  const events = [];
  client.ensureStarted = async () => {};
  client.ensureThread = async () => {
    client.threadId = "thread-voice";
    return client.threadId;
  };
  client.request = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  const result = await client.startRealtime({ sdp: "v=0\r\n...", prompt: "日本語", voice: "maple", onEvent: (event) => events.push(event) });
  assert.equal(result.threadId, "thread-voice");
  assert.equal(calls[0].method, "thread/realtime/start");
  assert.equal(calls[0].params.outputModality, "audio");
  assert.equal(calls[0].params.version, "v3");
  assert.equal(calls[0].params.codexResponseHandoffMode, "bemTags");
  assert.equal(calls[0].params.voice, "maple");
  assert.deepEqual(calls[0].params.transport, { type: "webrtc", sdp: "v=0\r\n..." });
  client.handleLine(JSON.stringify({ method: "thread/realtime/transcript/delta", params: { threadId: "thread-voice", role: "user", delta: "こんにちは" } }));
  assert.equal(events[0].params.delta, "こんにちは");
});

test("Codex client surfaces realtime startup notification errors immediately", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => {
    client.threadId = "thread-voice";
    return client.threadId;
  };
  client.request = async () => new Promise(() => {});
  const starting = client.startRealtime({ sdp: "v=0\r\n..." });
  await new Promise((resolve) => setImmediate(resolve));
  client.handleLine(JSON.stringify({
    method: "thread/realtime/error",
    params: { threadId: "thread-voice", message: "not available" },
  }));
  await assert.rejects(starting, /not available/);
});

test("Codex client stops the active realtime session", async () => {
  const client = new CodexAppServerClient();
  client.threadId = "thread-voice";
  client.realtimeHandlers.set("thread-voice", () => {});
  let call;
  client.request = async (method, params) => { call = { method, params }; return {}; };
  assert.equal(await client.stopRealtime(), true);
  assert.deepEqual(call, { method: "thread/realtime/stop", params: { threadId: "thread-voice" } });
});

test("Codex client appends click and preview speech to the active realtime session", async () => {
  const client = new CodexAppServerClient();
  assert.equal(client.hasActiveRealtime(), false);
  assert.equal(client.hasActiveTurn(), false);
  assert.equal(await client.appendRealtimeSpeech("音声テスト"), false);
  client.threadId = "thread-voice";
  client.realtimeHandlers.set("thread-voice", () => {});
  let call;
  client.request = async (method, params) => { call = { method, params }; return {}; };
  assert.equal(client.hasActiveRealtime(), true);
  client.activeTurnId = "turn-voice";
  assert.equal(client.hasActiveTurn(), true);
  client.activeTurnId = null;
  assert.equal(await client.appendRealtimeSpeech("  なあに？  "), true);
  assert.deepEqual(call, {
    method: "thread/realtime/appendSpeech",
    params: { threadId: "thread-voice", text: "なあに？" },
  });
});

test("Codex client forwards realtime handoff work events and tracks the active turn", () => {
  const client = new CodexAppServerClient();
  client.threadId = "thread-work-voice";
  const events = [];
  client.realtimeHandlers.set("thread-work-voice", (event) => events.push(event));
  client.handleLine(JSON.stringify({
    method: "turn/started",
    params: { threadId: "thread-work-voice", turn: { id: "turn-work-voice" } },
  }));
  client.handleLine(JSON.stringify({
    method: "item/started",
    params: { threadId: "thread-work-voice", item: { type: "commandExecution" } },
  }));
  assert.equal(client.activeTurnId, "turn-work-voice");
  assert.deepEqual(events.map((event) => event.method), ["turn/started", "item/started"]);
  client.handleLine(JSON.stringify({
    method: "turn/completed",
    params: { threadId: "thread-work-voice", turn: { id: "turn-work-voice", status: "completed" } },
  }));
  assert.equal(client.activeTurnId, null);
});

test("Codex client interrupts the active work turn", async () => {
  const client = new CodexAppServerClient();
  client.threadId = "thread-work";
  client.activeTurnId = "turn-work";
  let call;
  client.request = async (method, params) => { call = { method, params }; return {}; };
  assert.equal(await client.interruptActiveTurn(), true);
  assert.deepEqual(call, {
    method: "turn/interrupt",
    params: { threadId: "thread-work", turnId: "turn-work" },
  });
});

test("Codex client remembers an interrupt requested while a turn is starting", async () => {
  const client = new CodexAppServerClient();
  client.turnStarting = true;
  assert.equal(await client.interruptActiveTurn(), true);
  assert.equal(client.interruptRequested, true);
});

test("missing Codex CLI reports a friendly error instead of crashing", async () => {
  const client = new CodexAppServerClient({ command: "charadock-command-that-does-not-exist" });
  await assert.rejects(client.ensureStarted(), /Codex CLIを起動できません.*PATH/);
});

test("an unavailable Codex installation shows install guidance", async () => {
  const client = new CodexAppServerClient({ command: "" });
  await assert.rejects(
    client.ensureStarted(),
    /Codex DesktopまたはCodex CLIをインストール.*npm install -g @openai\/codex/s,
  );
});
