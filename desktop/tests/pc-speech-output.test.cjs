// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const main = fs.readFileSync(require.resolve("../main.cjs"), "utf8");
const source = main.slice(main.indexOf("async function synthesizeConfiguredTtsForRenderer("), main.indexOf("function rememberConversationTurn("));

for (const enabled of [true, false]) {
  test(`PC TTS stays on the requesting renderer with peripheral speaker ${enabled}`, async () => {
    const calls = [];
    const audio = { audioDataUrls: ["data:audio/wav;base64,test"], streamId: "stream", audioTexts: ["返事"] };
    const ctx = vm.createContext({
      rlcd42SpeakerSelected: () => enabled,
      playRlcd42Speech: async () => assert.fail("PC reply must not play on RLCD/StackChan"),
      synthesizeConfiguredTts: async (...args) => { calls.push(args); return audio; },
    });
    vm.runInContext(source, ctx);
    for (const ownerId of [1, 2]) {
      assert.equal(await ctx.synthesizeConfiguredTtsForRenderer("返事", ownerId), audio);
    }
    assert.deepEqual(calls, [["返事", 1], ["返事", 2]]);
  });
}

test("PC synthesis error does not fall back to an external speaker", async () => {
  const ctx = vm.createContext({
    rlcd42SpeakerSelected: () => true,
    playRlcd42Speech: async () => assert.fail("No peripheral fallback"),
    synthesizeConfiguredTts: async () => { throw new Error("unavailable"); },
  });
  vm.runInContext(source, ctx);
  const result = await ctx.synthesizeConfiguredTtsForRenderer("返事", 1);
  assert.equal(result.error, "unavailable");
  assert.equal(result.audioDataUrls.length, 0);
});
