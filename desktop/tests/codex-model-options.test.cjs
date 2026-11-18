// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../control.js"), "utf8");

test("Chat and Work can select Astra, Sol, Terra and Luna with stale, current or duplicate model lists", () => {
  const models = { "gpt-6-astra": "GPT-6 Astra", "gpt-6-sol": "GPT-6 Sol", "gpt-6.1-terra": "GPT-6.1 Terra", "gpt-6-luna": "GPT-6 Luna" };
  const listed = Object.keys(models).map(model => ({ model, displayName: model }));
  for (const codexModels of [[], [listed[0]], listed, [...listed, ...listed]]) {
    const ctx = vm.createContext({ state: {codexAuthMode:"codex"}, codexModels, localized: (ja) => ja,
      Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    });
    vm.runInContext(source.slice(source.indexOf("  function setCodexModelOptions("), source.indexOf("  async function refreshCodexModels(")), ctx);
    for (const selected of ["", ...Object.keys(models), "gpt-5.6-luna"]) {
      const select = { options: [], replaceChildren(option) { this.options = [option]; }, appendChild(option) { this.options.push(option); } };
      ctx.setCodexModelOptions(select, selected);
      for (const [id, label] of Object.entries(models)) {
        assert.equal(select.options.filter((option) => option.value === id).length, 1);
        assert.equal(select.options.find((option) => option.value === id).text, label);
      }
      assert.equal(select.options[0].text, "既定（GPT-6 Astra）");
      assert.equal(select.value, selected);
    }
  }
  assert.match(source, /setCodexModelOptions\(\$\("#codexChatModelInput"\)/);
  assert.match(source, /setCodexModelOptions\(\$\("#codexWorkModelInput"\)/);
});

function pickerContext(codexModels = [], authMode = "codex") {
  const select = value => ({ value, options: [], replaceChildren(option) { this.options = [option]; }, appendChild(option) { this.options.push(option); } });
  const chat = select("gpt-6.1-terra"), work = select("future-model"), errors = [], pending = [];
  const ctx = vm.createContext({ state: { codexAuthMode: authMode, codexChatModel: "saved-chat", codexWorkModel: "saved-work" },
    codexModels, codexModelsRefreshEpoch: 0, loginPollEpoch: 0, localized: ja => ja,
    $: selector => selector === "#codexChatModelInput" ? chat : selector === "#codexWorkModelInput" ? work : { dataset: {} },
    setStatus: (_node, message) => errors.push(message),
    api: { getCodexModels: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
  });
  vm.runInContext(source.slice(source.indexOf("  function setCodexModelOptions("), source.indexOf("  function syncRealtimeVoiceUi(")), ctx);
  return { ctx, chat, work, errors, pending };
}

test("unknown future models are added automatically; hidden and invalid entries are excluded", () => {
  const { ctx, chat } = pickerContext([{ model: "future-model", displayName: "Future", description: "From the server" },
    { model: "future-model" }, { model: "hidden-model", hidden: true }, null, { model: 123 }, { model: " " }]);
  ctx.setCodexModelOptions(chat, "future-model");
  assert.equal(chat.options.filter(option => option.value === "future-model").length, 1);
  assert.equal(chat.options.find(option => option.value === "future-model").title, "From the server");
  assert.equal(chat.options.some(option => option.value === "hidden-model"), false);
  assert.equal(chat.value, "future-model");
});

test("ChatGPT sign-in uses its own catalog without injecting unavailable fallback models", () => {
  const { ctx, chat } = pickerContext([{ model: "gpt-6.1-terra", displayName: "Terra" }], "chatgpt");
  ctx.setCodexModelOptions(chat, "saved-model");
  assert.deepEqual(chat.options.map(option => option.value), ["", "gpt-6.1-terra", "saved-model"]);
});

test("refresh preserves current Chat and Work selections and automatically adds newly returned IDs", async () => {
  const { ctx, chat, work, pending } = pickerContext();
  const refresh = ctx.refreshCodexModels();
  pending[0].resolve([{ model: "unreleased-next", displayName: "Next" }, { model: "hidden", hidden: true }]);
  await refresh;
  assert.equal(chat.value, "gpt-6.1-terra");
  assert.equal(work.value, "future-model");
  for (const picker of [chat, work]) {
    assert.ok(picker.options.some(option => option.value === "unreleased-next"));
    assert.equal(picker.options.some(option => option.value === "hidden"), false);
  }
});

test("latest refresh wins and late errors cannot replace its catalog or status", async () => {
  const { ctx, chat, pending, errors } = pickerContext();
  const old = ctx.refreshCodexModels(), latest = ctx.refreshCodexModels();
  pending[1].resolve([{ model: "new-model" }]); await latest;
  pending[0].reject(new Error("stale failure")); await old;
  assert.ok(chat.options.some(option => option.value === "new-model"));
  assert.deepEqual(errors, []);
});

test("auth switches and logout discard old catalog responses", async () => {
  for (const change of [ctx => { ctx.state.codexAuthMode = "chatgpt"; }, ctx => { ctx.loginPollEpoch++; }]) {
    const { ctx, chat, pending } = pickerContext();
    const refresh = ctx.refreshCodexModels(); change(ctx);
    pending[0].resolve([{ model: "old-account-model" }]); await refresh;
    assert.equal(chat.options.length, 0);
  }
});

test("a failed refresh retains the last successful catalog and selections", async () => {
  const { ctx, chat, pending, errors } = pickerContext([{ model: "previous-model" }]);
  const refresh = ctx.refreshCodexModels(); pending[0].reject(new Error("offline")); await refresh;
  assert.ok(chat.options.some(option => option.value === "previous-model"));
  assert.equal(chat.value, "gpt-6.1-terra"); assert.match(errors[0], /offline/);
  assert.match(source, /if \(name === "connection" \|\| name === "work"\) void refreshCodexModels\(\)/);
});
