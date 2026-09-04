// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CODEX_MASCOT_INSTRUCTIONS,
  CodexAppServerClient,
  appServerArgs,
  childProcessEnvironment,
  configuredMcpServers,
  configuredMcpServerNames,
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
  assert.equal(isBenignCodexStderr("ignoring interface.icon_small: icon path with '..' must resolve under plugin assets/"), true);
  assert.equal(isBenignCodexStderr("ignoring interface.icon_large: icon path with '..' must resolve under plugin assets/"), true);
  assert.equal(isBenignCodexStderr("ignoring interface.icon_small: invalid absolute path"), false);
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

test("configured MCP server names are discovered for CharaDock isolation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "charadock-codex-home-"));
  try {
    fs.writeFileSync(path.join(root, "config.toml"), [
      "[mcp_servers.alpha]",
      "url = 'https://example.com/a'",
      "[mcp_servers.alpha.env]",
      "TOKEN = 'hidden'",
      "[mcp_servers.\"name.with.dots\"]",
      "url = 'https://example.com/b'",
      "[other]",
      "enabled = true",
    ].join("\n"));
    assert.deepEqual(configuredMcpServerNames({ CODEX_HOME: root }), ["alpha", "name.with.dots"]);
    assert.deepEqual(configuredMcpServers({ CODEX_HOME: root }), [
      { name: "alpha", url: "https://example.com/a" },
      { name: "name.with.dots", url: "https://example.com/b" },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("app server args disable inherited MCP servers before adding CharaDock servers", () => {
  const args = appServerArgs("", "read-only", false, [{
    name: "charadock_mcp_1111111111111111",
    url: "https://example.com/mcp",
    authType: "none",
  }], [
    { name: "global-server", url: "https://example.com/global" },
    { name: "name.with.dots", url: "https://example.com/dots" },
  ]);
  assert.ok(args.includes('mcp_servers.global-server.url="https://example.com/global"'));
  assert.ok(args.includes("mcp_servers.global-server.enabled=false"));
  assert.ok(args.includes('mcp_servers."name.with.dots".url="https://example.com/dots"'));
  assert.ok(args.includes('mcp_servers."name.with.dots".enabled=false'));
  assert.ok(args.includes("mcp_servers.charadock_mcp_1111111111111111.enabled=true"));
  assert.ok(args.indexOf("mcp_servers.global-server.enabled=false") < args.indexOf("mcp_servers.charadock_mcp_1111111111111111.enabled=true"));
});

test("Codex forwards MCP secret environment names into a WSL app-server without command-line values", () => {
  const environment = childProcessEnvironment("C:\\Windows\\System32\\wsl.exe", {
    CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF: "secret",
  }, { PATH: "C:\\Windows", WSLENV: "EXISTING/u" });
  assert.equal(environment.CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF, "secret");
  assert.equal(environment.WSLENV, "EXISTING/u:CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF");
  const nativeEnvironment = childProcessEnvironment("codex", { CHARADOCK_MCP_API_KEY_TEST: "secret" }, { PATH: "/usr/bin" });
  assert.equal(nativeEnvironment.WSLENV, undefined);
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

test("Codex client lists MCP server status through app-server", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  const calls = [];
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (!params.cursor) return { data: [{ name: "charadock_mcp_test", tools: {}, resources: [], resourceTemplates: [] }], nextCursor: "next" };
    return { data: [{ name: "other", tools: {}, resources: [], resourceTemplates: [] }], nextCursor: null };
  };
  const servers = await client.listMcpServerStatus();
  assert.deepEqual(servers.map((server) => server.name), ["charadock_mcp_test", "other"]);
  assert.deepEqual(calls[0], {
    method: "mcpServerStatus/list",
    params: { cursor: null, detail: "toolsAndAuthOnly", limit: 100, threadId: null },
  });
  assert.equal(calls[1].params.cursor, "next");
});

test("Codex client waits for configured MCP tools before starting the first thread", async () => {
  const client = new CodexAppServerClient({
    mcpServers: [{ name: "charadock_mcp_0123456789abcdef" }],
  });
  client.ensureStarted = async () => {};
  const calls = [];
  let statusReads = 0;
  client.request = async (method) => {
    calls.push(method);
    if (method === "mcpServerStatus/list") {
      statusReads += 1;
      return statusReads === 1
        ? { data: [{ name: "charadock_mcp_0123456789abcdef", serverInfo: { name: "handshake-only" }, tools: {} }] }
        : { data: [{ name: "charadock_mcp_0123456789abcdef", serverInfo: { name: "ready" }, tools: { search: { name: "search" } } }] };
    }
    if (method === "thread/start") return { thread: { id: "thread-mcp-ready" } };
    if (method === "turn/start") {
      setImmediate(() => client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: "turn-mcp-ready", status: "completed" } },
      })));
      return { turn: { id: "turn-mcp-ready" } };
    }
    return {};
  };
  client.handleLine = ((original) => (line) => {
    const message = JSON.parse(line);
    if (message.method === "turn/completed") {
      const collector = client.turnCollectors.get("turn-mcp-ready");
      if (collector) collector.finalText = "ready";
    }
    original.call(client, line);
  })(client.handleLine);

  const result = await client.sendMessage("Use the MCP connection", { timeoutMs: 5_000 });
  assert.equal(result.text, "ready");
  assert.equal(statusReads, 2);
  assert.ok(calls.indexOf("mcpServerStatus/list") < calls.indexOf("thread/start"));
});

test("Codex client shares one MCP readiness check across concurrent callers", async () => {
  const client = new CodexAppServerClient({
    mcpServers: [{ name: "charadock_mcp_0123456789abcdef" }],
  });
  client.ensureStarted = async () => {};
  let statusReads = 0;
  client.listMcpServerStatus = async () => {
    statusReads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return [{ name: "charadock_mcp_0123456789abcdef", serverInfo: { name: "ready" }, tools: { search: { name: "search" } } }];
  };
  const [first, second] = await Promise.all([
    client.ensureMcpServersReady(),
    client.ensureMcpServersReady(),
  ]);
  assert.equal(statusReads, 1);
  assert.equal(first[0].name, "charadock_mcp_0123456789abcdef");
  assert.equal(second[0].name, "charadock_mcp_0123456789abcdef");
});

test("Codex client skips MCP startup work when no CharaDock connections are configured", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {
    throw new Error("should not start");
  };
  assert.deepEqual(await client.ensureMcpServersReady(), []);
});

test("an unavailable assigned MCP does not break ordinary chat, while an explicit MCP turn fails closed", async () => {
  const ordinary = new CodexAppServerClient({ mcpServers: [{ name: "charadock_mcp_unavailable" }] });
  ordinary.ensureStarted = async () => {};
  ordinary.ensureMcpServersReady = async () => {
    throw new Error("MCP unavailable");
  };
  ordinary.ensureThread = async () => {
    throw new Error("ordinary chat reached thread startup");
  };
  await assert.rejects(ordinary.sendMessage("hello"), /ordinary chat reached thread startup/);

  const explicit = new CodexAppServerClient({ mcpServers: [{ name: "charadock_mcp_unavailable" }] });
  explicit.ensureStarted = async () => {};
  explicit.ensureMcpServersReady = async () => {
    throw new Error("MCP unavailable");
  };
  let threadStarted = false;
  explicit.ensureThread = async () => {
    threadStarted = true;
    return "thread-should-not-start";
  };
  await assert.rejects(explicit.sendMessage("use MCP", { requireMcpReady: true }), /MCP unavailable/);
  assert.equal(threadStarted, false);
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

test("Codex client replays a turn that completes before turn/start returns without leaving ghost ownership", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => "thread-early";
  client.request = async (method) => {
    if (method !== "turn/start") return {};
    client.handleLine(JSON.stringify({
      method: "item/completed",
      params: {
        turnId: "turn-early",
        item: { id: "answer-early", type: "agentMessage", phase: "final_answer", text: "すぐ返したよ。" },
      },
    }));
    client.handleLine(JSON.stringify({
      method: "turn/completed",
      params: { turn: { id: "turn-early", status: "completed" } },
    }));
    return { turn: { id: "turn-early" } };
  };

  const result = await client.sendMessage("短い応答");
  assert.equal(result.text, "すぐ返したよ。");
  assert.equal(client.hasActiveTurn(), false);
  assert.equal(client.earlyTurnMessages.size, 0);
});

test("Codex client releases an orphaned active turn even after its collector is gone", () => {
  const client = new CodexAppServerClient();
  client.activeTurnId = "turn-orphaned";
  client.handleLine(JSON.stringify({
    method: "turn/completed",
    params: { turn: { id: "turn-orphaned", status: "completed" } },
  }));
  assert.equal(client.hasActiveTurn(), false);
});

test("Codex client recovers only orphaned normal-message ownership", () => {
  const client = new CodexAppServerClient();
  client.activeTurnId = "turn-message-orphan";
  client.activeTurnSource = "message";
  assert.equal(client.recoverOrphanedActiveTurn(), true);
  assert.equal(client.hasActiveTurn(), false);

  client.activeTurnId = "turn-message-live";
  client.activeTurnSource = "message";
  client.threadId = "thread-live";
  client.realtimeHandlers.set("thread-live", () => {});
  assert.equal(client.recoverOrphanedActiveTurn(), false);
  assert.equal(client.hasActiveTurn(), true);

  client.realtimeHandlers.clear();
  client.activeTurnId = "turn-realtime";
  client.activeTurnSource = "realtime";
  assert.equal(client.recoverOrphanedActiveTurn(), false);
  assert.equal(client.hasActiveTurn(), true);
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

test("queued turns keep their own Skill selection and restore character defaults on the next turn", async () => {
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.threadId = "thread-skill-queue";
  client.ensureThread = async () => client.threadId;
  client.setTurnStartSkillItems([{ name: "character-default", path: "/skills/default" }]);
  const starts = [];
  let sequence = 0;
  client.request = async (method, params) => {
    if (method !== "turn/start") return {};
    const turnId = `turn-skill-${++sequence}`;
    starts.push(params.input);
    setImmediate(() => {
      client.handleLine(JSON.stringify({
        method: "item/agentMessage/delta",
        params: { turnId, delta: "done" },
      }));
      client.handleLine(JSON.stringify({
        method: "turn/completed",
        params: { turn: { id: turnId, status: "completed" } },
      }));
    });
    return { turn: { id: turnId } };
  };

  const selected = client.sendMessage("選択あり", { skillItems: [{ name: "one-turn", path: "/skills/one" }] });
  const normal = client.sendMessage("次は通常");
  await Promise.all([selected, normal]);
  assert.deepEqual(starts, [
    [{ type: "text", text: "選択あり" }, { type: "skill", name: "one-turn", path: "/skills/one" }],
    [{ type: "text", text: "次は通常" }, { type: "skill", name: "character-default", path: "/skills/default" }],
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
  await assert.rejects(pending, /実行しませんでした|not approved/);
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
  assert.equal(calls[0].params.model, "gpt-live-1-codex");
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

test("Codex client uses the approved top-level Realtime model workaround without unsafe protocol fallback", async () => {
  const calls = [];
  const events = [];
  const client = new CodexAppServerClient();
  client.ensureStarted = async () => {};
  client.ensureThread = async () => {
    client.threadId = "thread-live-model-rejected";
    return client.threadId;
  };
  client.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/realtime/start") {
      queueMicrotask(() => client.handleLine(JSON.stringify({
        method: "thread/realtime/error",
        params: { threadId: params.threadId, message: "Field `session.model` is not allowed for this Codex realtime session" },
      })));
    }
    return {};
  };
  await assert.rejects(
    () => client.startRealtime({ sdp: "v=0\r\n...", voice: "maple", onEvent: (event) => events.push(event) }),
    /session\.model.*not allowed/i,
  );
  const starts = calls.filter((call) => call.method === "thread/realtime/start");
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].params.transport, { type: "webrtc", sdp: "v=0\r\n..." });
  assert.equal(starts[0].params.model, "gpt-live-1-codex");
  assert.equal(Object.hasOwn(starts[0].params, "session"), false, "The Realtime model must not be nested under session");
  assert.equal(events.filter((event) => event.method === "thread/realtime/error").length, 1);
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
  assert.deepEqual(await starting, { threadId: "thread-ready-gate", transport: "webrtc", version: "v3" });
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

test("Codex client waits briefly for turn/start before steering an immediate follow-up", async () => {
  const calls = [];
  const client = new CodexAppServerClient();
  client.turnStarting = true;
  client.request = async (method, params) => {
    calls.push({ method, params });
    return {};
  };
  setTimeout(() => {
    client.threadId = "thread-starting";
    client.activeTurnId = "turn-starting";
    client.turnStarting = false;
  }, 25);
  assert.equal(await client.steerActiveTurn("すぐ追加して"), true);
  assert.deepEqual(calls, [{
    method: "turn/steer",
    params: {
      threadId: "thread-starting",
      expectedTurnId: "turn-starting",
      input: [{ type: "text", text: "すぐ追加して" }],
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

test("stopping Realtime settles local ownership before returning", async () => {
  const client = new CodexAppServerClient();
  client.threadId = "thread-stop";
  const events = [];
  client.realtimeHandlers.set("thread-stop", (event) => {
    events.push({ method: event.method, activeDuringCallback: client.hasActiveRealtime() });
  });
  client.request = async (method, params) => {
    assert.equal(method, "thread/realtime/stop");
    assert.deepEqual(params, { threadId: "thread-stop" });
    return {};
  };

  assert.equal(await client.stopRealtime(), true);
  assert.equal(client.hasActiveRealtime(), false);
  assert.deepEqual(events, [{
    method: "thread/realtime/closed",
    activeDuringCallback: false,
  }]);
});

test("a failed Realtime stop still fails closed locally", async () => {
  const client = new CodexAppServerClient();
  client.threadId = "thread-stop-error";
  const events = [];
  client.realtimeHandlers.set("thread-stop-error", (event) => {
    events.push({ method: event.method, activeDuringCallback: client.hasActiveRealtime() });
  });
  client.request = async () => { throw new Error("stop failed"); };

  await assert.rejects(client.stopRealtime(), /stop failed/);
  assert.equal(client.hasActiveRealtime(), false);
  assert.deepEqual(events, [{
    method: "thread/realtime/closed",
    activeDuringCallback: false,
  }]);
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
