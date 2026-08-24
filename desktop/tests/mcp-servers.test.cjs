// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assignedMcpServerIds,
  buildMcpRuntime,
  configNameForMcpServer,
  mcpAppServerConfigArgs,
  normalizeMcpAssignments,
  normalizeMcpServerUrl,
  normalizeMcpServers,
  publicMcpServers,
  validateMcpServerInput,
} = require("../lib/mcp-servers.cjs");

const SERVER_ID = "mcp-0123456789abcdef";

test("MCP server settings accept HTTPS and local HTTP without credentials in the URL", () => {
  assert.equal(normalizeMcpServerUrl("https://example.com/api/mcp"), "https://example.com/api/mcp");
  assert.equal(normalizeMcpServerUrl("http://localhost:3000/mcp"), "http://localhost:3000/mcp");
  assert.equal(normalizeMcpServerUrl("http://127.0.0.1:3000/mcp"), "http://127.0.0.1:3000/mcp");
  assert.equal(normalizeMcpServerUrl("http://192.168.1.10/mcp"), "");
  assert.equal(normalizeMcpServerUrl("https://user:secret@example.com/mcp"), "");
  assert.throws(() => validateMcpServerInput({ id: SERVER_ID, name: "Unsafe", url: "http://example.com/mcp" }), /HTTPS/);
});

test("MCP normalization drops invalid and duplicate records", () => {
  const records = normalizeMcpServers([
    { id: SERVER_ID, name: "Docs", url: "https://example.com/mcp", authType: "none" },
    { id: SERVER_ID, name: "Duplicate", url: "https://duplicate.example/mcp" },
    { id: "bad", name: "Bad", url: "https://example.com/mcp" },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Docs");
  assert.equal(records[0].enabled, true);
  assert.equal(records[0].authType, "none");
});

test("MCP assignments separate global and per-character connections", () => {
  const secondId = "mcp-fedcba9876543210";
  const assignments = normalizeMcpAssignments({
    all: [SERVER_ID, "bad", SERVER_ID],
    characters: {
      kohaku: [secondId, SERVER_ID],
      empty: ["bad"],
    },
  }, [SERVER_ID, secondId]);
  assert.deepEqual(assignments, {
    all: [SERVER_ID],
    characters: { kohaku: [secondId, SERVER_ID] },
  });
  assert.deepEqual(assignedMcpServerIds(assignments, "kohaku"), [SERVER_ID, secondId]);
  assert.deepEqual(assignedMcpServerIds(assignments, "another"), [SERVER_ID]);
});

test("MCP Bearer keys stay in the child environment and never enter command arguments", () => {
  const records = [{
    id: SERVER_ID,
    name: "Private MCP",
    url: "https://example.com/mcp",
    enabled: true,
    authType: "api-key",
    apiKeyHeader: "Authorization",
    apiKeyPrefix: "Bearer",
  }];
  const runtime = buildMcpRuntime(records, () => "top-secret-token");
  assert.equal(runtime.servers.length, 1);
  assert.equal(runtime.environment.CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF, "top-secret-token");
  const args = mcpAppServerConfigArgs(runtime.servers);
  assert.equal(args.join(" ").includes("top-secret-token"), false);
  assert.ok(args.includes('mcp_servers.charadock_mcp_0123456789abcdef.default_tools_approval_mode="approve"'));
  assert.ok(args.includes("mcp_servers.charadock_mcp_0123456789abcdef.bearer_token_env_var=\"CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF\""));
});

test("MCP custom API key headers use env_http_headers and preserve an optional prefix", () => {
  const records = [{
    id: SERVER_ID,
    name: "Header MCP",
    url: "https://example.com/mcp",
    enabled: true,
    authType: "api-key",
    apiKeyHeader: "X-API-Key",
    apiKeyPrefix: "Token",
  }];
  const runtime = buildMcpRuntime(records, () => "secret");
  assert.equal(runtime.environment.CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF, "Token secret");
  const args = mcpAppServerConfigArgs(runtime.servers);
  assert.ok(args.includes('mcp_servers.charadock_mcp_0123456789abcdef.env_http_headers={"X-API-Key"="CHARADOCK_MCP_API_KEY_MCP_0123456789ABCDEF"}'));
});

test("MCP runtime omits disabled servers and API-key servers without a key", () => {
  const records = [
    { id: SERVER_ID, name: "Missing key", url: "https://example.com/mcp", enabled: true, authType: "api-key" },
    { id: "mcp-fedcba9876543210", name: "Disabled", url: "https://example.com/other", enabled: false, authType: "none" },
  ];
  assert.equal(buildMcpRuntime(records, () => "").servers.length, 0);
  assert.equal(buildMcpRuntime(records, () => "", ["mcp-fedcba9876543210"], { includeDisabled: true }).servers.length, 1);
  assert.equal(publicMcpServers(records, () => false)[0].hasApiKey, false);
  assert.equal(configNameForMcpServer(SERVER_ID), "charadock_mcp_0123456789abcdef");
});
