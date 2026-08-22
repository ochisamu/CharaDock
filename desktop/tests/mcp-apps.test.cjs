// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  boundedMcpAppToolArguments,
  boundedMcpAppWidgetState,
  injectMcpAppGuestBridge,
  isCompletedMcpAppToolItem,
  mcpAppContentSecurityPolicy,
  mcpAppExternalLinkAllowed,
  mcpAppResourceContent,
  mcpAppResourceUri,
  mcpAppToolAllowsDirectCall,
  mcpAppToolVisibleToApp,
  normalizeMcpAppCsp,
  publicMcpApp,
} = require("../lib/mcp-apps.cjs");

test("MCP App metadata supports current and legacy CSP shapes without arbitrary schemes", () => {
  const normalized = normalizeMcpAppCsp({
    ui: { csp: { connectDomains: ["https://api.example.test/path"], frameDomains: ["javascript:alert(1)"] } },
    "openai/widgetCSP": {
      resource_domains: ["https://images.example.test", "file:///tmp/private"],
      redirect_domains: ["https://links.example.test/path"],
    },
  });
  assert.deepEqual(normalized.connectDomains, ["https://api.example.test"]);
  assert.deepEqual(normalized.resourceDomains, ["https://images.example.test"]);
  assert.deepEqual(normalized.frameDomains, []);
  assert.deepEqual(normalized.redirectDomains, ["https://links.example.test"]);
  const policy = mcpAppContentSecurityPolicy({ ui: { csp: normalized } });
  assert.match(policy, /connect-src https:\/\/api\.example\.test/);
  assert.match(policy, /img-src data: blob: https:\/\/images\.example\.test/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /form-action 'none'/);
});

test("MCP App external links require a declared HTTP origin", () => {
  const meta = { "openai/widgetCSP": { redirect_domains: ["https://allowed.example.test"] } };
  assert.equal(mcpAppExternalLinkAllowed(meta, "https://allowed.example.test/result/1"), true);
  assert.equal(mcpAppExternalLinkAllowed(meta, "https://other.example.test/result/1"), false);
  assert.equal(mcpAppExternalLinkAllowed(meta, "https://user:secret@allowed.example.test/result/1"), false);
  assert.equal(mcpAppExternalLinkAllowed(meta, "javascript:alert(1)"), false);
});

test("card-originated tool calls fail closed unless the tool is app-visible and read-only", () => {
  const safe = { name: "search", annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
  assert.equal(mcpAppToolVisibleToApp(safe), true);
  assert.equal(mcpAppToolAllowsDirectCall(safe), true);
  assert.equal(mcpAppToolAllowsDirectCall({ ...safe, annotations: { ...safe.annotations, destructiveHint: true } }), false);
  assert.equal(mcpAppToolAllowsDirectCall({ ...safe, annotations: { ...safe.annotations, openWorldHint: true } }), false);
  assert.equal(mcpAppToolAllowsDirectCall({ ...safe, _meta: { ui: { visibility: ["model"] } } }), false);
  assert.equal(mcpAppToolAllowsDirectCall({ name: "unknown" }), false);
});

test("widget state is JSON-only, instance-bounded, and size-bounded", () => {
  assert.deepEqual(boundedMcpAppWidgetState({ selected: "result-1" }), { selected: "result-1" });
  assert.throws(() => boundedMcpAppWidgetState({ value: 1n }), /JSON serializable/);
  assert.throws(() => boundedMcpAppWidgetState({ text: "x".repeat(70_000) }), /too large/);
});

test("card-originated tool arguments are object-only and size-bounded", () => {
  assert.deepEqual(boundedMcpAppToolArguments({ query: "test" }), { query: "test" });
  assert.throws(() => boundedMcpAppToolArguments(["test"]), /JSON object/);
  assert.throws(() => boundedMcpAppToolArguments({ text: "x".repeat(70_000) }), /too large/);
});

test("completed MCP tool items expose an MCP App resource URI", () => {
  const item = {
    type: "mcpToolCall",
    status: "completed",
    appContext: { resourceUri: "ui://ai-nikechan/search-results.html" },
  };
  assert.equal(isCompletedMcpAppToolItem(item), true);
  assert.equal(mcpAppResourceUri(item), "ui://ai-nikechan/search-results.html");
  assert.equal(isCompletedMcpAppToolItem({ ...item, status: "inProgress" }), false);
});

test("MCP App resource extraction and guest bridge preserve the original card", () => {
  const content = mcpAppResourceContent({
    contents: [{ uri: "ui://card/index.html", mimeType: "text/html;profile=mcp-app", text: "<!doctype html><html><head><title>Card</title></head><body><main>Result</main></body></html>" }],
  }, "ui://card/index.html");
  assert.equal(content.uri, "ui://card/index.html");
  const injected = injectMcpAppGuestBridge(content.text);
  assert.match(injected, /window\.openai/);
  assert.match(injected, /value\.prompt/);
  assert.match(injected, /value\.href/);
  assert.match(injected, /ui\/initialize/);
  assert.match(injected, /setWidgetState/);
  assert.match(injected, /<main>Result<\/main>/);
  assert.ok(injected.indexOf("window.openai") < injected.indexOf("<main>Result</main>"));
});

test("public MCP App state does not expose tool arguments, output, or HTML", () => {
  const value = publicMcpApp({
    id: "abc",
    itemId: "item-1",
    title: "Knowledge cards",
    serverTitle: "AI Nike",
    toolName: "search",
    toolInput: { secret: "hidden" },
    toolResult: { structuredContent: { private: true } },
    html: "<script>secret</script>",
    createdAt: 10,
  });
  assert.deepEqual(value, {
    id: "abc",
    itemId: "item-1",
    title: "Knowledge cards",
    subtitle: "AI Nike",
    toolName: "search",
    createdAt: 10,
    updatedAt: 10,
  });
});

test("MCP App host waits for initialized before sending input and result notifications", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "mcp-app-host.js"), "utf8");
  const hostListeners = new Map();
  const frameListeners = new Map();
  const posted = [];
  const frame = {
    contentWindow: { postMessage: (message) => posted.push(message) },
    contentDocument: null,
    addEventListener: (type, listener) => frameListeners.set(type, listener),
    removeEventListener: () => {},
  };
  const sandbox = {
    window: {},
    document: { documentElement: { lang: "ja" } },
    navigator: { language: "ja-JP", userAgent: "test", maxTouchPoints: 0 },
    innerWidth: 800,
    innerHeight: 600,
    Intl,
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, listener) => hostListeners.set(type, listener),
    removeEventListener: () => {},
  };
  vm.runInNewContext(source, sandbox);
  sandbox.window.CharaDockMcpAppHost.mount(frame, { id: "card-1" }, {
    request: async () => ({
      app: { id: "card-1", itemId: "item-1", toolName: "search", title: "Search" },
      toolInput: { query: "test" },
      toolResult: { structuredContent: { results: [1] } },
      widgetState: { selected: 1 },
      csp: {},
    }),
  });
  await frameListeners.get("load")();
  assert.equal(posted.length, 0);
  await hostListeners.get("message")({
    source: frame.contentWindow,
    data: { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} },
  });
  assert.deepEqual(posted.map((message) => message.method || `response:${message.id}`), ["response:1"]);
  await hostListeners.get("message")({
    source: frame.contentWindow,
    data: { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
  });
  assert.deepEqual(posted.slice(1, 4).map((message) => message.method), [
    "ui/notifications/host-context-changed",
    "ui/notifications/tool-input",
    "ui/notifications/tool-result",
  ]);
  assert.deepEqual(posted[1].params.widgetState, { selected: 1 });

  await hostListeners.get("message")({
    source: frame.contentWindow,
    data: { jsonrpc: "2.0", id: 2, method: "ui/request-display-mode", params: { mode: "picture-in-picture" } },
  });
  const unsupportedMode = posted.at(-1);
  assert.equal(unsupportedMode.id, 2);
  assert.equal(unsupportedMode.error.code, -32602);
});

test("settings chat, desktop chat, and Realtime all feed the shared MCP App observer", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "main.cjs"), "utf8");
  assert.match(source, /ipcMain\.handle\("chat:send"[\s\S]{0,1200}sendChatMessage/);
  assert.match(source, /ipcMain\.handle\("mascotInline:chat"[\s\S]{0,1200}handleMascotConversation/);
  assert.match(source, /async function handleMascotConversation[\s\S]{0,1800}sendChatMessage/);
  assert.match(source, /observeMcpAppEvent\(conversationClient, event, \{ mode: "chat"/);
  assert.match(source, /observeMcpAppEvent\(worker, message, \{ mode: "work"/);
  assert.match(source, /observeMcpAppEvent\(realtimeClient, message, \{ mode: workMode \? "work" : "chat"/);
  assert.match(source, /recentMcpAppItemIds\.get\(itemId\)/);
  assert.match(source, /directCallTools\.includes\(toolName\)/);
  assert.match(source, /MCPカードから外部リンクを開きますか/);
  assert.match(source, /widgetScope = source/);
  assert.match(source, /widgetStates\.size >= 16/);
  assert.match(source, /allowedResources:[\s\S]{0,300}\.slice\(0, 100\)/);
});
