const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../main.cjs"), "utf8");
function conversation({ enabled = true, action = "next", ok = true } = {}) {
  const calls = [];
  const context = {
    process: { platform: "win32" }, preferences: { data: { backend: "openai" } },
    jevEnabled: () => enabled, classifyJevMedia: async text => { calls.push(["classify", text]); return action; },
    mediaController: { call: async args => { calls.push(["execute", args.action]); return { ok, accepted: ok }; } },
    randomBytes: () => ({ toString: () => "unique-test-id" }), mainText: ja => ja,
    rememberConversationTurn: (a, b) => calls.push(["history", a, b]), remoteLastDisplayText: "",
    publishRemoteState() {}, requestJevExpression() {}, speechExpression: () => ({}), activeCharacter: () => ({ id: "test" }),
    revokeBrowserAuthorization() {}, revokeComputerAuthorization() {},
    sendChatMessage: async () => { calls.push(["fallback"]); return { text: "normal" }; },
  };
  const start = source.indexOf("async function handleMascotConversation(");
  const end = source.indexOf("\nasync function sendChatMessage(", start);
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  return { run: context.handleMascotConversation, calls };
}
test("normal conversation fast path returns actual operation receipt without model call", async () => {
  const { run, calls } = conversation(); const result = await run("次の曲にして");
  assert.equal(result.provider, "local"); assert.match(result.text, /次の曲/);
  assert.deepEqual(calls.map(x => x[0]), ["classify", "execute", "history"]);
});
test("failed music operation cannot claim success or retry through model", async () => {
  const { run, calls } = conversation({ ok: false }); const result = await run("次の曲にして");
  assert.match(result.text, /操作できなかった/); assert.equal(calls.filter(x => x[0] === "execute").length, 1);
  assert.equal(calls.some(x => x[0] === "fallback"), false);
});
test("disabled, non-media and attachment requests preserve ordinary conversation", async () => {
  for (const [options, delivery] of [[{ enabled: false }, {}], [{ action: null }, {}], [{}, { localAttachments: [{}] }], [{}, { selectedMcpServerIds: ["chosen"] }]]) {
    const { run, calls } = conversation(options); assert.equal((await run("hello", delivery)).text, "normal");
    assert.equal(calls.some(x => x[0] === "execute"), false);
  }
});
test("IPC and Live hooks are restricted and generation requires emotion validation", () => {
  for (const channel of ["jev:setConfig", "jev:testConnection"]) {
    const index = source.indexOf(`ipcMain.handle("${channel}"`);
    assert.ok(index >= 0); assert.match(source.slice(index, index + 160), /assertTrustedSender\(event\)/);
  }
  assert.match(source, /gate\.tool\(params\.arguments, String\(params\.turnId/);
  assert.match(source, /transcript\/done" && params\.role === "user"[\s\S]*?liveInputDecisions\.finish/);
  assert.match(source, /transcript\/delta" && params\.role === "user"[\s\S]*?liveInputDecisions\.delta\(params\.delta\)/);
  assert.match(source, /requireRlcd42: true, requireEmotions: true/);
});
