// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

test("control preload exposes only the agreed Jev config and test IPC methods", async () => {
  let bridge;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, "preload-control.cjs"), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "mascotDesktop"); bridge = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } },
    }),
  });
  const payload = { enabled: true, mediaEnabled: false, expressionEnabled: true, apiKey: "secret" };
  await bridge.setJevConfig(payload);
  await bridge.testJevConnection();
  assert.deepEqual(calls, [["jev:setConfig", payload], ["jev:testConnection"]]);
  await bridge.previewJevPerformance("ponder");
  assert.deepEqual(calls[2], ["jev:previewPerformance", "ponder"]);
  assert.deepEqual(Object.keys(bridge).filter((key) => /jev/i.test(key)), ["setJevConfig", "previewJevPerformance", "testJevConnection"]);
});

function renderer(api = {}) {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { checked: false, disabled: false, value: "", textContent: "" });
    return nodes.get(id);
  };
  const context = vm.createContext({
    $, $$: () => [], api, jevBusy: false,
    state: { jevEnabled: false, jevMediaEnabled: true, jevExpressionEnabled: true, jevApiKeyConfigured: false },
    localized: (_ja, en) => en,
    setStatus: (node, message, error) => { node.textContent = message; node.error = error; },
    syncUi: () => {},
  });
  const source = fs.readFileSync(path.join(root, "control.js"), "utf8");
  vm.runInContext(source.slice(source.indexOf("  function decisionKeyConfigured()"), source.indexOf("  function syncUi()")), context);
  context.syncJevUi();
  return { context, $ };
}

test("Jev UI gates features and tests behind opt-in and saves flags without draft secrets", async () => {
  let payload;
  const { context, $ } = renderer({ setJevConfig: async (value) => { payload = value; return { jevEnabled: value.enabled, jevMediaEnabled: value.mediaEnabled, jevExpressionEnabled: value.expressionEnabled }; } });
  assert.equal($("#jevMediaEnabledToggle").checked, true);
  assert.equal($("#jevMediaEnabledToggle").disabled, true);
  assert.equal($("#jevExpressionEnabledToggle").disabled, true);
  assert.equal($("#testJevConnectionButton").disabled, true);
  $("#jevApiKeyInput").value = "draft-secret";
  $("#jevEnabledToggle").checked = true;
  await context.saveJevConfig();
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { provider: "jev", enabled: true, mediaEnabled: true, expressionEnabled: true, nikePerformanceEnabled: false, kohakuPerformanceEnabled: false, addressMode: "off" });
  assert.equal($("#jevMediaEnabledToggle").disabled, false);
  assert.equal($("#testJevConnectionButton").disabled, true);
});

test("key save and clear blank the password field and use explicit IPC key semantics", async () => {
  const calls = [];
  const { context, $ } = renderer({ setJevConfig: async (payload) => { calls.push(payload); assert.equal($("#jevApiKeyInput").value, ""); return { jevApiKeyConfigured: Boolean(payload.apiKey) }; } });
  $("#jevApiKeyInput").value = " secret ";
  await context.saveJevConfig("save");
  assert.equal(calls[0].apiKey, "secret");
  await context.saveJevConfig("clear");
  assert.equal(calls[1].apiKey, "");
  assert.equal($("#jevApiKeyState").textContent, "API key not configured");
});

test("connection tests show latency, suppress raw errors and never run while disabled", async () => {
  let calls = 0;
  let result = { ok: true, latencyMs: 12.4 };
  const { context, $ } = renderer({ testJevConnection: async () => { calls++; return result; } });
  await context.testJevConnection();
  assert.equal(calls, 0);
  context.state = { jevEnabled: true, jevApiKeyConfigured: true };
  await context.testJevConnection();
  assert.equal($("#jevStatus").textContent, "Connected. (12 ms)");
  result = { ok: false, latencyMs: 3, error: "secret" };
  await context.testJevConnection();
  assert.equal($("#jevStatus").textContent.includes("secret"), false);
  assert.equal($("#jevStatus").error, true);
  $("#jevApiKeyInput").value = "unsaved";
  await context.testJevConnection();
  assert.equal(calls, 2);
});

test("failed IPC clears the submitted secret and restores saved settings", async () => {
  const { context, $ } = renderer({ setJevConfig: async () => { throw Error("secret"); } });
  $("#jevEnabledToggle").checked = true;
  $("#jevApiKeyInput").value = "secret";
  await context.saveJevConfig("save");
  assert.equal($("#jevApiKeyInput").value, "");
  assert.equal($("#jevEnabledToggle").checked, false);
  assert.equal(context.jevBusy, false);
  assert.equal($("#jevStatus").textContent.includes("secret"), false);
});

test("Jev settings provide a password field and bilingual opt-in consent", () => {
  const html = fs.readFileSync(path.join(root, "control.html"), "utf8");
  assert.match(html, /id="jevApiKeyInput" type="password" autocomplete="new-password"/);
  assert.match(html, /data-jev-en="Only when enabled, the minimum necessary recognized instruction and response text is sent to the selected service\."/);
  assert.match(html, /有効な場合のみ、認識した指示・応答の必要最小限のテキストを選択したサービスへ送信します。/);
});


test("Decisions UI manages its dedicated key, preserves JEV draft and switches back", async () => {
  let calls = 0, payload;
  const { context, $ } = renderer({ testJevConnection: async () => { calls++; return {ok:true}; },
    setJevConfig: async value => { payload = value; return { ...context.state, decisionProvider: value.provider }; } });
  context.state = {decisionProvider:'decisions',jevEnabled:true,hasApiKey:true,jevApiKeyConfigured:false};
  $('#jevApiKeyInput').value = 'unsaved-jev-key';
  context.syncJevUi();
  assert.equal($('#decisionJevKeySettings').hidden,true);
  assert.equal($('#decisionOpenAIKeySettings').hidden,false);
  assert.equal($('#testJevConnectionButton').disabled,false);
  await context.testJevConnection();
  assert.equal(calls,1);
  context.state.hasApiKey = false;
  context.syncJevUi();
  assert.equal($('#testJevConnectionButton').disabled,true);
  await context.testJevConnection();
  assert.equal(calls,1);
  $('#decisionProviderSelect').value = 'jev';
  await context.saveJevConfig();
  assert.equal(payload.provider,'jev');
  assert.equal(Object.hasOwn(payload,'apiKey'),false);
  assert.equal($('#jevApiKeyInput').value,'unsaved-jev-key');
  assert.equal($('#decisionJevKeySettings').hidden,false);
});
