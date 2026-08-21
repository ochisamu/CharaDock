// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CODEX_MASCOT_INSTRUCTIONS,
  CodexAppServerClient,
  appServerArgs,
  isBenignCodexStderr,
  isOfficialComputerUseSkill,
  normalizeSkillName,
  permissionProfileForSandbox,
  workspaceSandboxPolicy,
} = require("../backend/codex-client.cjs");

test("Codex client suppresses only the known non-fatal models cache warning", () => {
  assert.equal(isBenignCodexStderr("failed to load models cache: missing field `base_instructions` at line 94"), true);
  assert.equal(isBenignCodexStderr("failed to renew cache TTL: missing field `supports_parallel_tool_calls` at line 97"), true);
  assert.equal(isBenignCodexStderr("failed to renew cache TTL: missing field `unknown_field` at line 97"), false);
  assert.equal(isBenignCodexStderr("failed to renew cache TTL: missing field `supports_parallel_tool_calls`\nauthentication failed"), false);
  assert.equal(isBenignCodexStderr("authentication failed"), false);
});

test("Codex work client can explicitly enable live web search", () => {
  assert.deepEqual(appServerArgs("live"), [
    "app-server", "--stdio", "--enable", "realtime_conversation", "-c", 'web_search="live"',
  ]);
  assert.deepEqual(appServerArgs("live", "workspace-write"), [
    "app-server", "--stdio", "--enable", "realtime_conversation",
    "-c", 'web_search="live"', "-c", 'sandbox_mode="workspace-write"',
  ]);
  assert.deepEqual(appServerArgs("live", "workspace-write", true), [
    "app-server", "--stdio", "--enable", "realtime_conversation",
    "-c", 'web_search="live"', "-c", 'sandbox_mode="workspace-write"',
    "-c", "sandbox_workspace_write.network_access=true",
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
  assert.deepEqual(workspaceSandboxPolicy("workspace-write", cwd, [home], true), {
    type: "workspaceWrite",
    writableRoots: [cwd, home],
    networkAccess: true,
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

  const networkClient = new CodexAppServerClient({
    cwd,
    sandbox: "workspace-write",
    workspaceRoots: [home],
    networkAccess: true,
  });
  networkClient.ensureStarted = async () => {};
  let networkThreadParams;
  networkClient.request = async (method, params) => {
    assert.equal(method, "thread/start");
    networkThreadParams = params;
    return { thread: { id: "thread-network" } };
  };
  await networkClient.ensureThread();
  assert.deepEqual(networkThreadParams.runtimeWorkspaceRoots, [cwd, home]);
  assert.equal(networkThreadParams.sandbox, "workspace-write");
  assert.equal(Object.prototype.hasOwnProperty.call(networkThreadParams, "permissions"), false);
  assert.equal(networkClient.usesPermissionProfile, false);
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

test("Codex Work sends the explicit outbound-network policy only when enabled", async () => {
  const client = new CodexAppServerClient({
    cwd: "/workspace/project",
    sandbox: "workspace-write",
    networkAccess: true,
  });
  client.ensureStarted = async () => {};
  client.ensureThread = async () => "thread-network-work";
  let turnParams;
  client.request = async (method, params) => {
    if (method !== "turn/start") return {};
    turnParams = params;
    setImmediate(() => {
      client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-network-work", delta: "ok" },
      }));
      client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: "turn-network-work", status: "completed" } },
      }));
    });
    return { turn: { id: "turn-network-work" } };
  };
  await client.sendMessage("外部APIを確認して");
  assert.deepEqual(turnParams.sandboxPolicy, {
    type: "workspaceWrite",
    writableRoots: ["/workspace/project"],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  });
});

test("Codex client returns the final agent answer without replaying commentary", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => "thread-final";
  const deltas = [];
  client.request = async (method) => {
    if (method !== "turn/start") return {};
    setImmediate(() => {
      client.handleLine(JSON.stringify({
        method: "item/started",
        params: { turnId: "turn-final", item: { id: "comment-1", type: "agentMessage", phase: "commentary" } },
      }));
      client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-final", itemId: "comment-1", delta: "ファイルを更新しています。" },
      }));
      client.handleLine(JSON.stringify({
        method: "item/completed",
        params: { turnId: "turn-final", item: { id: "comment-1", type: "agentMessage", phase: "commentary", text: "ファイルを更新しています。" } },
      }));
      client.handleLine(JSON.stringify({
        method: "item/started",
        params: { turnId: "turn-final", item: { id: "answer-1", type: "agentMessage", phase: "final_answer" } },
      }));
      client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-final", itemId: "answer-1", delta: "作成できました。確認も完了です。" },
      }));
      client.handleLine(JSON.stringify({
        method: "item/completed",
        params: { turnId: "turn-final", item: { id: "answer-1", type: "agentMessage", phase: "final_answer", text: "作成できました。確認も完了です。" } },
      }));
      client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: "turn-final", status: "completed" } },
      }));
    });
    return { turn: { id: "turn-final" } };
  };

  const result = await client.sendMessage("ページを作って", {
    onDelta: (delta, fullText) => deltas.push({ delta, fullText }),
  });
  assert.equal(result.text, "作成できました。確認も完了です。");
  assert.equal(result.transcriptText, "ファイルを更新しています。作成できました。確認も完了です。");
  assert.deepEqual(deltas, [{ delta: "作成できました。確認も完了です。", fullText: "作成できました。確認も完了です。" }]);
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

test("per-turn Skills override defaults without resetting the active thread", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.threadId = "thread-existing";
  client.ensureThread = async () => client.threadId;
  client.setTurnStartSkillItems([{ name: "default-skill", path: "/skills/default" }]);
  client.threadId = "thread-existing";
  let turnParams;
  client.request = async (method, params) => {
    if (method !== "turn/start") return {};
    turnParams = params;
    setImmediate(() => {
      client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId: "turn-picked-skill", delta: "done" },
      }));
      client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: "turn-picked-skill", status: "completed" } },
      }));
    });
    return { turn: { id: "turn-picked-skill" } };
  };
  await client.sendMessage("この送信だけ", { skillItems: [{ name: "picked-skill", path: "/skills/picked" }] });
  assert.equal(client.threadId, "thread-existing");
  assert.deepEqual(turnParams.input, [
    { type: "text", text: "この送信だけ" },
    { type: "skill", name: "picked-skill", path: "/skills/picked" },
  ]);
  assert.deepEqual(client.turnStartSkillItems, [{ name: "default-skill", path: "/skills/default" }]);
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
    if (method === "thread/realtime/start") queueMicrotask(() => client.handleLine(JSON.stringify({
      method: "thread/realtime/started",
      params: { threadId: "thread-voice" },
    })));
    return {};
  };
  const result = await client.startRealtime({
    sdp: "v=0\r\n...",
    prompt: "日本語",
    voice: "maple",
    clientManagedHandoffs: true,
    codexResponseHandoffMode: "thinking",
    delegationAckFiller: false,
    includeStartupContext: false,
    initialItems: [{ role: "developer", text: "Use the selected Work skill." }],
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.threadId, "thread-voice");
  assert.equal(calls[0].method, "thread/realtime/start");
  assert.equal(calls[0].params.outputModality, "audio");
  assert.equal(calls[0].params.version, "v3");
  assert.equal(calls[0].params.codexResponseHandoffMode, "thinking");
  assert.equal(calls[0].params.clientManagedHandoffs, true);
  assert.equal(calls[0].params.delegationAckFiller, false);
  assert.equal(calls[0].params.includeStartupContext, false);
  assert.deepEqual(calls[0].params.initialItems, [{ role: "developer", text: "Use the selected Work skill." }]);
  assert.equal(calls[0].params.voice, "maple");
  assert.equal(calls[0].params.prompt, "日本語");
  assert.deepEqual(calls[0].params.transport, { type: "webrtc", sdp: "v=0\r\n..." });
  client.handleLine(JSON.stringify({ method: "thread/realtime/transcript/delta", params: { threadId: "thread-voice", role: "user", delta: "こんにちは" } }));
  assert.equal(events.find((event) => event.method === "thread/realtime/transcript/delta")?.params.delta, "こんにちは");
});

test("Codex client omits a Realtime prompt so app-server can retain native delegation", async () => {
  const calls = [];
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => {
    client.threadId = "thread-native-handoff";
    return client.threadId;
  };
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/realtime/start") queueMicrotask(() => client.handleLine(JSON.stringify({
      method: "thread/realtime/started",
      params: { threadId: "thread-native-handoff" },
    })));
    return {};
  };
  await client.startRealtime({ sdp: "v=0\r\n...", clientManagedHandoffs: false });
  assert.equal(calls[0].method, "thread/realtime/start");
  assert.equal(Object.hasOwn(calls[0].params, "prompt"), false);
});

test("Codex client does not expose Realtime until the started notification arrives", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => {
    client.threadId = "thread-ready-gate";
    return client.threadId;
  };
  let requestResolved = false;
  client.request = async () => {
    requestResolved = true;
    return {};
  };
  let completed = false;
  const starting = client.startRealtime({ sdp: "v=0\r\n..." }).then((value) => {
    completed = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestResolved, true);
  assert.equal(completed, false);
  client.handleLine(JSON.stringify({
    method: "thread/realtime/started",
    params: { threadId: "thread-ready-gate" },
  }));
  assert.deepEqual(await starting, { threadId: "thread-ready-gate" });
  assert.equal(completed, true);
});

test("Codex client steers an active Realtime Work turn with text and Skills", async () => {
  const calls = [];
  const client = new CodexAppServerClient({ pathMapper: (value) => `/mapped${value}` });
  client.threadId = "thread-live-work";
  client.activeTurnId = "turn-live-work";
  client.request = async (method, params) => {
    calls.push({ method, params });
    return { turnId: "turn-live-work" };
  };
  assert.equal(await client.steerActiveTurn("READMEも更新して", {
    skillItems: [{ name: "docs", path: "/skill/docs" }],
  }), true);
  assert.deepEqual(calls[0], {
    method: "turn/steer",
    params: {
      threadId: "thread-live-work",
      expectedTurnId: "turn-live-work",
      input: [
        { type: "text", text: "READMEも更新して" },
        { type: "skill", name: "docs", path: "/mapped/skill/docs" },
      ],
    },
  });
});

test("Codex client can steer a tracked Work turn by explicit id during an active-id race", async () => {
  const calls = [];
  const client = new CodexAppServerClient();
  client.threadId = "thread-live-work";
  client.activeTurnId = "";
  client.request = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  assert.equal(await client.steerActiveTurn("同じ作業に追記して", { turnId: "turn-tracked-work" }), true);
  assert.deepEqual(calls, [{
    method: "turn/steer",
    params: {
      threadId: "thread-live-work",
      expectedTurnId: "turn-tracked-work",
      input: [{ type: "text", text: "同じ作業に追記して" }],
    },
  }]);
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

test("Codex client appends typed user input as realtime text", async () => {
  const client = new CodexAppServerClient();
  assert.equal(await client.appendRealtimeText("作業して", "user"), false);
  client.threadId = "thread-voice";
  client.realtimeHandlers.set("thread-voice", () => {});
  let call;
  client.request = async (method, params) => { call = { method, params }; return {}; };
  assert.equal(await client.appendRealtimeText("  HTMLを作って  ", "user"), true);
  assert.deepEqual(call, {
    method: "thread/realtime/appendText",
    params: { threadId: "thread-voice", text: "HTMLを作って", role: "user" },
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
