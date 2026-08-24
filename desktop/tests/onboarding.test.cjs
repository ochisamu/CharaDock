// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildOnboardingFirstWorkPrompt,
  normalizeOnboardingFirstWork,
} = require("../lib/onboarding.cjs");

test("first-work setup validates and bounds user input", () => {
  assert.deepEqual(normalizeOnboardingFirstWork({
    goal: "  個人アプリを\n形にしたい  ",
    theme: "bright",
    delivery: "live",
  }), {
    goal: "個人アプリを 形にしたい",
    theme: "bright",
    delivery: "live",
  });
  assert.throws(() => normalizeOnboardingFirstWork({ goal: "\n\t" }), /入力/);
  assert.equal(normalizeOnboardingFirstWork({ goal: "test", theme: "unknown", delivery: "unknown" }).theme, "calm");
  assert.equal(normalizeOnboardingFirstWork({ goal: "test", theme: "unknown", delivery: "unknown" }).delivery, "text");
});

test("first-work prompt creates one safe offline preview artifact", () => {
  const prompt = buildOnboardingFirstWorkPrompt({ goal: "今週を整理したい", theme: "minimal" }, "ja");
  assert.match(prompt, /今週を整理したい/);
  assert.match(prompt, /artifacts\/charadock-start\.html/);
  assert.match(prompt, /localStorage/);
  assert.match(prompt, /CDNや外部通信は使わない/);
  assert.match(prompt, /未確認の進捗は作らない/);
});

test("first-work prompt supports English without changing the artifact contract", () => {
  const prompt = buildOnboardingFirstWorkPrompt({ goal: "Plan my week", theme: "calm" }, "en");
  assert.match(prompt, /Plan my week/);
  assert.match(prompt, /artifacts\/charadock-start\.html/);
  assert.match(prompt, /self-contained offline HTML/);
  assert.match(prompt, /do not invent progress/);
});
