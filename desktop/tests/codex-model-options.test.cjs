// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../control.js"), "utf8");

test("Chat and Work can select Astra with a stale or current Codex model list", () => {
  for (const codexModels of [[], [{ model: "gpt-6-astra", displayName: "GPT-6 Astra" }]]) {
    const ctx = vm.createContext({ codexModels, localized: (ja) => ja,
      Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    });
    vm.runInContext(source.slice(source.indexOf("  function setCodexModelOptions("), source.indexOf("  async function refreshCodexModels(")), ctx);
    for (const selected of ["", "gpt-6-astra", "gpt-5.6-luna"]) {
      const select = { options: [], replaceChildren(option) { this.options = [option]; }, appendChild(option) { this.options.push(option); } };
      ctx.setCodexModelOptions(select, selected);
      assert.equal(select.options.filter((option) => option.value === "gpt-6-astra").length, 1);
      assert.equal(select.options.find((option) => option.value === "gpt-6-astra").text, "GPT-6 Astra");
      assert.equal(select.options[0].text, "既定（GPT-6 Astra）");
      assert.equal(select.value, selected);
    }
  }
  assert.match(source, /setCodexModelOptions\(\$\("#codexChatModelInput"\)/);
  assert.match(source, /setCodexModelOptions\(\$\("#codexWorkModelInput"\)/);
});
