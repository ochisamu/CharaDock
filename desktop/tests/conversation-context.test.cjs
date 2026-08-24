// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { boundedConversationHistory, continuityEntries, recentConversationContext, scopedWorkHistory, searchContinuityEntries, sharedContinuityContext, unfinishedWorkContext } = require("../lib/conversation-context.cjs");

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

test("the same routed turn is recorded once when Live and Codex complete together", () => {
  const first = boundedConversationHistory([], "同じ入力", "同じ回答");
  const repeated = boundedConversationHistory(first, "同じ入力", "同じ回答");
  assert.equal(repeated.length, 2);
  const older = first.map((entry) => ({ ...entry, createdAt: "2026-01-01T00:00:00.000Z" }));
  assert.equal(boundedConversationHistory(older, "同じ入力", "同じ回答").length, 4);
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
      { status: "completed", characterId: "", workspaceKey: "workspace-a", request: "unknown character", result: "done" },
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
    workspaceKey: "workspace-a",
    conversationHistory: [
      { role: "user", text: "前回の会話", createdAt: "2026-08-11T10:00:00.000Z" },
      { role: "user", text: "今回の会話", createdAt: "2026-08-12T10:00:01.000Z" },
    ],
    workHistory: [
      { status: "completed", workspaceKey: "workspace-a", request: "古い作業", result: "完了", finishedAt: "2026-08-11T10:00:00.000Z" },
      { status: "completed", workspaceKey: "workspace-a", request: "今回の作業", result: "完了", finishedAt: "2026-08-12T10:00:02.000Z" },
    ],
  });
  assert.deepEqual(entries.map((entry) => entry.type === "work" ? entry.request : entry.text), ["今回の会話", "今回の作業"]);
});

test("shared continuity includes retained context by default and never mixes unscoped Work", () => {
  const history = [{ role: "user", text: "前回の会話", createdAt: "2026-08-01T10:00:00.000Z" }];
  const work = [{ status: "completed", workspaceKey: "workspace-a", request: "前回の作業", result: "完了", finishedAt: "2026-08-01T10:01:00.000Z" }];
  assert.match(sharedContinuityContext({ conversationHistory: history, workHistory: work }), /前回の会話/);
  assert.doesNotMatch(sharedContinuityContext({ conversationHistory: history, workHistory: work }), /前回の作業/);
  assert.match(sharedContinuityContext({ conversationHistory: history, workHistory: work, workspaceKey: "workspace-a" }), /前回の作業/);
});

test("history search finds older retained Chat and only current-workspace Work", () => {
  const matches = searchContinuityEntries({
    query: "ニュース",
    characterId: "kohaku",
    workspaceKey: "workspace-a",
    conversationHistory: [
      { role: "user", text: "ニュースを調べたい", createdAt: "2026-08-01T10:00:00.000Z" },
      { role: "assistant", text: "了解", createdAt: "2026-08-01T10:00:01.000Z" },
    ],
    workHistory: [
      { status: "completed", characterId: "kohaku", workspaceKey: "workspace-a", request: "ニュースをMarkdown化", result: "news.mdを作成", finishedAt: "2026-08-01T10:02:00.000Z" },
      { status: "completed", characterId: "kohaku", workspaceKey: "workspace-b", request: "別のニュース", result: "secret.mdを作成", finishedAt: "2026-08-01T10:03:00.000Z" },
    ],
  });
  assert.deepEqual(matches.map((entry) => entry.type === "work" ? entry.request : entry.text), ["ニュースをMarkdown化", "ニュースを調べたい"]);
});

test("unfinished Work context keeps only the latest matching unverified request", () => {
  const context = unfinishedWorkContext({
    characterId: "kohaku",
    workspaceKey: "workspace-a",
    language: "ja",
    workHistory: [
      { status: "interrupted", characterId: "kohaku", workspaceKey: "workspace-a", request: "古い未完了", activities: ["調査中"], finishedAt: "2026-08-20T10:00:00.000Z" },
      { status: "interrupted", characterId: "kohaku", workspaceKey: "workspace-a", request: "直前の修正を続ける", activities: ["テストを確認中"], finishedAt: "2026-08-20T11:00:00.000Z" },
      { status: "interrupted", characterId: "towa", workspaceKey: "workspace-a", request: "別キャラの作業", finishedAt: "2026-08-20T12:00:00.000Z" },
      { status: "interrupted", characterId: "kohaku", workspaceKey: "workspace-b", request: "別フォルダーの作業", finishedAt: "2026-08-20T13:00:00.000Z" },
      { status: "interrupted", characterId: "", workspaceKey: "workspace-a", request: "不明なキャラの作業", finishedAt: "2026-08-20T13:30:00.000Z" },
      { status: "completed", characterId: "kohaku", workspaceKey: "workspace-a", request: "完了済み", finishedAt: "2026-08-20T14:00:00.000Z" },
    ],
  });
  assert.match(context, /直前の修正を続ける/);
  assert.match(context, /テストを確認中/);
  assert.match(context, /未完了・未検証/);
  assert.doesNotMatch(context, /古い未完了|別キャラ|別フォルダー|不明なキャラ|完了済み/);
});

test("unfinished Work context is empty without an exact workspace", () => {
  const history = [{ status: "interrupted", characterId: "kohaku", workspaceKey: "workspace-a", request: "続き" }];
  assert.equal(unfinishedWorkContext({ characterId: "kohaku", workHistory: history }), "");
  assert.equal(unfinishedWorkContext({ characterId: "kohaku", workspaceKey: "workspace-b", workHistory: history }), "");
});

test("visible Work history never crosses character or workspace scope", () => {
  const history = [
    { id: "current", characterId: "kohaku", workspaceKey: "workspace-a" },
    { id: "other-character", characterId: "nike", workspaceKey: "workspace-a" },
    { id: "other-workspace", characterId: "kohaku", workspaceKey: "workspace-b" },
    { id: "legacy-unscoped", characterId: "", workspaceKey: "" },
  ];
  assert.deepEqual(scopedWorkHistory(history, { characterId: "kohaku", workspaceKey: "workspace-a" }).map((run) => run.id), ["current"]);
  assert.deepEqual(scopedWorkHistory(history, { characterId: "kohaku" }), []);
});
