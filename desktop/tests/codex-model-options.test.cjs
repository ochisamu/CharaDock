// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../control.js"), "utf8");

test("Chat and Work can select Astra, Sol and Luna with stale, current or duplicate model lists", () => {
  const models = { "gpt-6-astra": "GPT-6 Astra", "gpt-6-sol": "GPT-6 Sol", "gpt-6-luna": "GPT-6 Luna" };
  const listed = Object.keys(models).map(model => ({ model, displayName: model }));
  for (const codexModels of [[], [listed[0]], listed, [...listed, ...listed]]) {
    const ctx = vm.createContext({ codexModels, localized: (ja) => ja,
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
