// SPDX-License-Identifier: Apache-2.0
const { createHash } = require("node:crypto");

const MAX_MCP_SERVERS = 24;
const DEFAULT_API_KEY_HEADER = "Authorization";
const DEFAULT_API_KEY_PREFIX = "Bearer";
const MCP_ID_PATTERN = /^mcp-[a-f0-9]{16}$/;
const MCP_HEADER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const FORBIDDEN_HEADERS = new Set([
  "accept", "connection", "content-length", "content-type", "host",
  "mcp-protocol-version", "mcp-session-id", "transfer-encoding",
]);

function normalizeMcpServerId(value) {
  const id = String(value || "").trim().toLowerCase();
  return MCP_ID_PATTERN.test(id) ? id : "";
}

function normalizeMcpServerUrl(value) {
  const source = String(value || "").trim();
  if (!source || source.length > 2_000) return "";
  try {
    const url = new URL(source);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return "";
    if (url.username || url.password || url.hash) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeMcpHeaderName(value) {
  const header = String(value || DEFAULT_API_KEY_HEADER).trim();
  if (!MCP_HEADER_PATTERN.test(header) || FORBIDDEN_HEADERS.has(header.toLowerCase())) return "";
  return header;
}

function normalizeMcpServerRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = normalizeMcpServerId(value.id);
  const name = String(value.name || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  const url = normalizeMcpServerUrl(value.url);
  const authType = value.authType === "api-key" ? "api-key" : "none";
  const apiKeyHeader = normalizeMcpHeaderName(value.apiKeyHeader);
  if (!id || !name || !url || (authType === "api-key" && !apiKeyHeader)) return null;
  return {
    id,
    name,
    url,
    enabled: value.enabled !== false,
    authType,
    apiKeyHeader: authType === "api-key" ? apiKeyHeader : DEFAULT_API_KEY_HEADER,
    apiKeyPrefix: authType === "api-key"
      ? String(value.apiKeyPrefix ?? DEFAULT_API_KEY_PREFIX).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40)
      : DEFAULT_API_KEY_PREFIX,
    createdAt: String(value.createdAt || "").slice(0, 40),
    updatedAt: String(value.updatedAt || "").slice(0, 40),
  };
}

function normalizeMcpServers(value) {
  if (!Array.isArray(value)) return [];
  const records = [];
  const ids = new Set();
  for (const candidate of value.slice(0, MAX_MCP_SERVERS)) {
    const record = normalizeMcpServerRecord(candidate);
    if (!record || ids.has(record.id)) continue;
    ids.add(record.id);
    records.push(record);
  }
  return records;
}

function normalizeMcpAssignments(value, serverIds = []) {
  const allowed = new Set((Array.isArray(serverIds) ? serverIds : []).map(normalizeMcpServerId).filter(Boolean));
  const ids = (items) => [...new Set((Array.isArray(items) ? items : [])
    .map(normalizeMcpServerId)
    .filter((id) => id && allowed.has(id)))];
  const characters = value?.characters && typeof value.characters === "object" && !Array.isArray(value.characters)
    ? Object.fromEntries(Object.entries(value.characters).slice(0, 100).flatMap(([characterId, items]) => {
      const id = String(characterId || "").trim().slice(0, 120);
      const assigned = ids(items);
      return id && assigned.length ? [[id, assigned]] : [];
    }))
    : {};
  return { all: ids(value?.all), characters };
}

function assignedMcpServerIds(assignments, characterId = "") {
  const normalizedCharacterId = String(characterId || "").trim().slice(0, 120);
  return [...new Set([
    ...(Array.isArray(assignments?.all) ? assignments.all : []),
    ...(normalizedCharacterId && Array.isArray(assignments?.characters?.[normalizedCharacterId])
      ? assignments.characters[normalizedCharacterId]
      : []),
  ].map(normalizeMcpServerId).filter(Boolean))];
}

function validateMcpServerInput(value) {
  const record = normalizeMcpServerRecord(value);
  if (record) return record;
  if (!normalizeMcpServerId(value?.id)) throw new Error("MCPサーバーIDが正しくありません。");
  if (!String(value?.name || "").trim()) throw new Error("MCPサーバー名を入力してください。");
  if (!normalizeMcpServerUrl(value?.url)) {
    throw new Error("MCP URLはHTTPSを使用してください。ローカル接続だけはlocalhostのHTTPも利用できます。");
  }
  if (value?.authType === "api-key" && !normalizeMcpHeaderName(value?.apiKeyHeader)) {
    throw new Error("APIキーヘッダー名が正しくありません。");
  }
  throw new Error("MCPサーバー設定が正しくありません。");
}

function publicMcpServers(records, hasApiKey = () => false) {
  return normalizeMcpServers(records).map((record) => ({
    ...record,
    hasApiKey: record.authType === "api-key" && Boolean(hasApiKey(record.id)),
  }));
}

function tomlString(value) {
  return JSON.stringify(String(value || ""));
}

function configNameForMcpServer(id) {
  return `charadock_${normalizeMcpServerId(id).replace(/-/g, "_")}`;
}

function mcpEnvironmentName(id) {
  return `CHARADOCK_MCP_API_KEY_${normalizeMcpServerId(id).replace(/-/g, "_").toUpperCase()}`;
}

function buildMcpRuntime(records, getApiKey = () => "", selectedIds = null, { includeDisabled = false } = {}) {
  const selection = selectedIds ? new Set([...selectedIds].map(normalizeMcpServerId).filter(Boolean)) : null;
  const environment = {};
  const servers = [];
  const signatureInput = [];
  for (const record of normalizeMcpServers(records)) {
    if (selection && !selection.has(record.id)) continue;
    const apiKey = record.authType === "api-key" ? String(getApiKey(record.id) || "").trim() : "";
    const ready = record.authType === "none" || Boolean(apiKey);
    signatureInput.push({ ...record, hasCredential: Boolean(apiKey), credentialHash: apiKey ? createHash("sha256").update(apiKey).digest("hex") : "" });
    if ((!record.enabled && !includeDisabled) || !ready) continue;
    const runtime = {
      id: record.id,
      name: configNameForMcpServer(record.id),
      displayName: record.name,
      url: record.url,
      authType: record.authType,
      apiKeyHeader: record.apiKeyHeader,
      apiKeyPrefix: record.apiKeyPrefix,
      environmentName: "",
    };
    if (record.authType === "api-key") {
      runtime.environmentName = mcpEnvironmentName(record.id);
      const codexAddsBearer = record.apiKeyHeader.toLowerCase() === "authorization"
        && record.apiKeyPrefix === DEFAULT_API_KEY_PREFIX;
      environment[runtime.environmentName] = codexAddsBearer
        ? apiKey
        : record.apiKeyPrefix ? `${record.apiKeyPrefix} ${apiKey}` : apiKey;
    }
    servers.push(runtime);
  }
  return {
    servers,
    environment,
    signature: createHash("sha256").update(JSON.stringify(signatureInput)).digest("hex"),
  };
}

function mcpAppServerConfigArgs(servers = []) {
  const args = [];
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!/^charadock_mcp_[a-f0-9]{16}$/.test(String(server?.name || ""))) continue;
    const url = normalizeMcpServerUrl(server.url);
    if (!url) continue;
    const root = `mcp_servers.${server.name}`;
    args.push(
      "-c", `${root}.url=${tomlString(url)}`,
      "-c", `${root}.enabled=true`,
      "-c", `${root}.required=false`,
      "-c", `${root}.startup_timeout_sec=15`,
      "-c", `${root}.tool_timeout_sec=60`,
      // CharaDock currently has no inline MCP approval sheet. Assigning a
      // connection to a character (or explicitly selecting it for one turn)
      // is the user's trust decision, so configured tools must not be routed
      // into app-server's otherwise-unanswerable approval prompt.
      "-c", `${root}.default_tools_approval_mode=${tomlString("approve")}`,
    );
    if (server.authType !== "api-key" || !server.environmentName) continue;
    if (String(server.apiKeyHeader).toLowerCase() === "authorization" && server.apiKeyPrefix === DEFAULT_API_KEY_PREFIX) {
      // bearer_token_env_var adds the Bearer prefix itself, so the environment
      // stores only the raw token for this common path.
      args.push("-c", `${root}.bearer_token_env_var=${tomlString(server.environmentName)}`);
      continue;
    }
    args.push("-c", `${root}.env_http_headers={${tomlString(server.apiKeyHeader)}=${tomlString(server.environmentName)}}`);
  }
  return args;
}

module.exports = {
  DEFAULT_API_KEY_HEADER,
  DEFAULT_API_KEY_PREFIX,
  MAX_MCP_SERVERS,
  assignedMcpServerIds,
  buildMcpRuntime,
  configNameForMcpServer,
  mcpAppServerConfigArgs,
  normalizeMcpAssignments,
  normalizeMcpHeaderName,
  normalizeMcpServerId,
  normalizeMcpServerUrl,
  normalizeMcpServers,
  publicMcpServers,
  validateMcpServerInput,
};
