// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  injectMcpAppGuestBridge,
  isCompletedMcpAppToolItem,
  mcpAppContentSecurityPolicy,
  mcpAppResourceContent,
  mcpAppResourceUri,
  normalizeMcpAppCsp,
  publicMcpApp,
} = require("../lib/mcp-apps.cjs");

test("MCP App metadata supports current and legacy CSP shapes without arbitrary schemes", () => {
  const normalized = normalizeMcpAppCsp({
    ui: { csp: { connectDomains: ["https://api.example.test/path"], frameDomains: ["javascript:alert(1)"] } },
    "openai/widgetCSP": { resource_domains: ["https://images.example.test", "file:///tmp/private"] },
  });
  assert.deepEqual(normalized.connectDomains, ["https://api.example.test"]);
  assert.deepEqual(normalized.resourceDomains, ["https://images.example.test"]);
  assert.deepEqual(normalized.frameDomains, []);
  const policy = mcpAppContentSecurityPolicy({ ui: { csp: normalized } });
  assert.match(policy, /connect-src https:\/\/api\.example\.test/);
  assert.match(policy, /img-src data: blob: https:\/\/images\.example\.test/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /form-action 'none'/);
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

test("settings chat, desktop chat, and Realtime all feed the shared MCP App observer", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "main.cjs"), "utf8");
  assert.match(source, /ipcMain\.handle\("chat:send"[\s\S]{0,1200}sendChatMessage/);
  assert.match(source, /ipcMain\.handle\("mascotInline:chat"[\s\S]{0,1200}handleMascotConversation/);
  assert.match(source, /async function handleMascotConversation[\s\S]{0,1800}sendChatMessage/);
  assert.match(source, /observeMcpAppEvent\(conversationClient, event\)/);
  assert.match(source, /observeMcpAppEvent\(worker, message\)/);
  assert.match(source, /observeMcpAppEvent\(realtimeClient, message\)/);
});
