// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { boundedConversationHistory, continuityEntries, recentConversationContext, sharedContinuityContext } = require("../lib/conversation-context.cjs");

test("recent conversation context preserves an elliptical weather follow-up", () => {
  const history = boundedConversationHistory([], "名古屋の天気は？", "今日は晴れです。");
  const context = recentConversationContext(history);
  assert.match(context, /ユーザー: 名古屋の天気は？/);
  assert.match(context, /キャラクター: 今日は晴れです。/);
  assert.match(context, /『明日は？』/);
});

test("conversation backup stays bounded", () => {
  let history = [];
  for (let index = 0; index < 30; index += 1) history = boundedConversationHistory(history, `u${index}`, `a${index}`);
  assert.equal(history.length, 40);
  assert.equal(history[0].text, "u10");
  assert.equal(history.at(-1).text, "a29");
});

test("shared continuity merges conversation and completed Work in chronological order", () => {
  const context = sharedContinuityContext({
    characterId: "kohaku",
    workspaceKey: "workspace-a",
    language: "ja",
    conversationHistory: [
      { role: "user", text: "名古屋の天気をまとめて", createdAt: "2026-08-12T00:00:00.000Z" },
      { role: "assistant", text: "HTMLにまとめるね。", createdAt: "2026-08-12T00:00:01.000Z" },
    ],
    workHistory: [{
      status: "completed", characterId: "kohaku", workspaceKey: "workspace-a",
      request: "天気のHTMLを作って", result: "weather.htmlを作成しました。", artifacts: [{ path: "weather.html" }],
      finishedAt: "2026-08-12T00:00:02.000Z",
    }],
  });
  assert.match(context, /Chat・Live・Work・リモート/);
  assert.ok(context.indexOf("ユーザー: 名古屋") < context.indexOf("Work依頼: 天気"));
  assert.match(context, /成果物: weather\.html/);
});

test("shared continuity excludes another character, workspace, and unfinished work", () => {
  const entries = continuityEntries({
    characterId: "kohaku",
    workspaceKey: "workspace-a",
    workHistory: [
      { status: "completed", characterId: "towa", workspaceKey: "workspace-a", request: "other character", result: "done" },
      { status: "completed", characterId: "kohaku", workspaceKey: "workspace-b", request: "other project", result: "done" },
      { status: "running", characterId: "kohaku", workspaceKey: "workspace-a", request: "unfinished", result: "" },
      { status: "completed", characterId: "kohaku", workspaceKey: "workspace-a", request: "same project", result: "done" },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].request, "same project");
});

test("shared continuity can exclude persisted history from before this app session", () => {
  const sessionStart = Date.parse("2026-08-12T10:00:00.000Z");
  const entries = continuityEntries({
    since: sessionStart,
    conversationHistory: [
      { role: "user", text: "前回の会話", createdAt: "2026-08-11T10:00:00.000Z" },
      { role: "user", text: "今回の会話", createdAt: "2026-08-12T10:00:01.000Z" },
    ],
    workHistory: [
      { status: "completed", request: "古い作業", result: "完了", finishedAt: "2026-08-11T10:00:00.000Z" },
      { status: "completed", request: "今回の作業", result: "完了", finishedAt: "2026-08-12T10:00:02.000Z" },
    ],
  });
  assert.deepEqual(entries.map((entry) => entry.type === "work" ? entry.request : entry.text), ["今回の会話", "今回の作業"]);
});
