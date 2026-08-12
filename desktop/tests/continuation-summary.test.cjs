// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMMON_SCOPE_KEY,
  HOME_SCOPE_KEY,
  MAX_AGE_MS,
  continuationEligibility,
  continuationFallbackMessage,
  continuationPromptContext,
  continuationSummary,
  mergeContinuationCandidate,
  mergeVerifiedWork,
  normalizeContinuationSummaries,
  saveContinuationSummary,
  validateGroundedContinuationMessage,
} = require("../lib/continuation-summary.cjs");

const NOW = new Date("2026-08-12T08:00:00.000Z");
const PROJECT_A = "project-1111111111111111";
const PROJECT_B = "project-2222222222222222";

test("continuation summaries stay isolated by character and exact project scope", () => {
  let summaries = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    scopeKey: PROJECT_A,
    projectName: "CharaDock",
    summary: { goal: "公開準備", pending: ["Windows版を検証する"], nextStep: "Windows版を検証する" },
    now: NOW,
  }).summaries;
  summaries = saveContinuationSummary(summaries, {
    characterId: "amber-avatar",
    scopeKey: COMMON_SCOPE_KEY,
    summary: { goal: "次の企画を相談する", nextStep: "候補を比較する" },
    now: NOW,
  }).summaries;
  summaries = saveContinuationSummary(summaries, {
    characterId: "amber-avatar",
    scopeKey: HOME_SCOPE_KEY,
    projectName: "キャラクターホーム",
    summary: { goal: "ホームでデモを作る", nextStep: "HTMLを作る" },
    now: NOW,
  }).summaries;
  summaries = saveContinuationSummary(summaries, {
    characterId: "towa-avatar",
    scopeKey: PROJECT_A,
    projectName: "CharaDock",
    summary: { nextStep: "READMEを読む" },
    now: NOW,
  }).summaries;

  assert.equal(continuationSummary(summaries, "amber-avatar", PROJECT_A).nextStep, "Windows版を検証する");
  assert.equal(continuationSummary(summaries, "amber-avatar", COMMON_SCOPE_KEY).nextStep, "候補を比較する");
  assert.equal(continuationSummary(summaries, "amber-avatar", HOME_SCOPE_KEY).nextStep, "HTMLを作る");
  assert.equal(continuationSummary(summaries, "amber-avatar", HOME_SCOPE_KEY).scopeType, "home");
  assert.equal(continuationSummary(summaries, "towa-avatar", PROJECT_A).nextStep, "READMEを読む");
  assert.equal(continuationSummary(summaries, "amber-avatar", PROJECT_B), null);
});

test("verified Character Home Work accumulates independently from shared chat", () => {
  const summaries = mergeVerifiedWork({}, {
    characterId: "amber-avatar",
    scopeKey: HOME_SCOPE_KEY,
    projectName: "キャラクターホーム",
    runId: "work-home-1",
    status: "completed",
    request: "デモページを作る",
    result: "ホーム内にデモページを作成しました。次は表示を確認します。",
    artifacts: [{ path: "artifacts/demo.html" }],
    now: NOW,
  }).summaries;
  const home = continuationSummary(summaries, "amber-avatar", HOME_SCOPE_KEY);
  assert.equal(home.completed[0].sourceId, "work-home-1");
  assert.equal(home.nextStep, "表示を確認します");
  assert.equal(continuationSummary(summaries, "amber-avatar", COMMON_SCOPE_KEY), null);
});

test("fresh summaries with a goal or concrete next action can prompt on startup", () => {
  const ready = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { goal: "ニュース検索を改善する", nextStep: "当日性の判定を実装する" },
    now: NOW,
  }).record;
  assert.deepEqual(continuationEligibility(ready, NOW), { eligible: true, stale: false, reason: "ready" });

  const goalOnly = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { goal: "ニュース検索を改善する" },
    now: NOW,
  }).record;
  assert.deepEqual(continuationEligibility(goalOnly, NOW), { eligible: true, stale: false, reason: "goal-only" });

  const completeOnly = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { completed: ["検索結果の表示を確認した"] },
    now: NOW,
  }).record;
  assert.equal(continuationEligibility(completeOnly, NOW).reason, "nothing-to-resume");

  const staleNow = new Date(NOW.getTime() + MAX_AGE_MS + 1);
  assert.deepEqual(continuationEligibility(ready, staleNow), { eligible: false, stale: true, reason: "stale" });
  assert.equal(continuationEligibility({ ...ready, updatedAt: "broken" }, NOW).reason, "invalid-date");
});

test("verified Work results update completion while interruption remains unfinished", () => {
  let summaries = mergeVerifiedWork({}, {
    characterId: "amber-avatar",
    scopeKey: PROJECT_A,
    projectName: "CharaDock",
    runId: "work-1",
    status: "completed",
    request: "ニュース検索の当日性を確認する",
    result: "検索日を基準に絞る実装方針をまとめました。次は判定処理を実装します。",
    artifacts: [{ path: "docs/search-plan.md" }],
    now: NOW,
  }).summaries;
  let summary = continuationSummary(summaries, "amber-avatar", PROJECT_A);
  assert.equal(summary.completed[0].source, "work");
  assert.equal(summary.completed[0].sourceId, "work-1");
  assert.deepEqual(summary.completed[0].artifacts, ["docs/search-plan.md"]);
  assert.equal(summary.nextStep, "判定処理を実装します");
  assert.equal(summary.pending.length, 0);

  summaries = mergeVerifiedWork(summaries, {
    characterId: "amber-avatar",
    scopeKey: PROJECT_A,
    status: "interrupted",
    request: "判定処理を実装する",
    now: new Date(NOW.getTime() + 1000),
  }).summaries;
  summary = continuationSummary(summaries, "amber-avatar", PROJECT_A);
  assert.deepEqual(summary.pending, ["判定処理を実装する"]);
  assert.equal(summary.nextStep, "判定処理を実装する");
});

test("model candidates merge durable facts but cannot claim verified completion", () => {
  const result = mergeContinuationCandidate({}, {
    characterId: "amber-avatar",
    scopeKey: COMMON_SCOPE_KEY,
    goal: "公開後の改善を続ける",
    decisions: ["次のリリースでは安定性を優先する"],
    pending: ["利用者フィードバックを整理する"],
    nextStep: "優先順位を決める",
    completed: ["存在しない完了"],
    now: NOW,
  });
  assert.equal(result.record.goal, "公開後の改善を続ける");
  assert.deepEqual(result.record.decisions, ["次のリリースでは安定性を優先する"]);
  assert.deepEqual(result.record.completed, []);
});

test("model candidates cannot silently overwrite a recorded goal", () => {
  const first = mergeContinuationCandidate({}, {
    characterId: "amber-avatar",
    goal: "公開準備を進める",
    nextStep: "READMEを確認する",
    now: NOW,
  });
  const ignored = mergeContinuationCandidate(first.summaries, {
    characterId: "amber-avatar",
    goal: "別アプリを作る",
    nextStep: "アイコンを考える",
    now: new Date(NOW.getTime() + 1000),
  });
  assert.equal(ignored.record.goal, "公開準備を進める");
  const replaced = mergeContinuationCandidate(ignored.summaries, {
    characterId: "amber-avatar",
    goal: "別アプリを作る",
    replaceGoal: true,
    now: new Date(NOW.getTime() + 2000),
  });
  assert.equal(replaced.record.goal, "別アプリを作る");
});

test("secrets and invalid persisted scopes are rejected without affecting other records", () => {
  assert.throws(() => saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { nextStep: "API key sk-abcdefghijklmnop を使う" },
    now: NOW,
  }), /秘密情報/);
  assert.throws(() => saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { nextStep: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" },
    now: NOW,
  }), /秘密情報/);
  const normalized = normalizeContinuationSummaries({
    "amber-avatar": {
      [PROJECT_A]: { nextStep: "続ける", updatedAt: NOW.toISOString() },
      "project-other": { nextStep: "混ぜない", updatedAt: NOW.toISOString() },
    },
  });
  assert.ok(normalized["amber-avatar"][PROJECT_A]);
  assert.equal(normalized["amber-avatar"]["project-other"], undefined);
});

test("startup context is compact structured data rather than a transcript", () => {
  const summary = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    scopeKey: PROJECT_A,
    projectName: "CharaDock",
    summary: {
      goal: "ニュース検索を改善する",
      decisions: ["検索日を基準にする"],
      completed: ["実装方針をまとめた"],
      pending: ["判定処理を実装する"],
      nextStep: "判定処理を実装する",
    },
    now: NOW,
  }).record;
  const context = continuationPromptContext(summary, "ja");
  assert.match(context, /<continuation_summary>/);
  assert.match(context, /判定処理/);
  assert.doesNotMatch(context, /ユーザー:/);
  assert.ok(context.length < 2000);
});

test("startup speech must quote a recorded fact and cannot invent completion", () => {
  const summary = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { goal: "ニュース検索を改善する", nextStep: "当日性の判定を実装する" },
    now: NOW,
  }).record;
  const valid = validateGroundedContinuationMessage(JSON.stringify({
    message: "前回のテーマはニュース検索を改善することだよ。当日性の判定を実装する？",
    groundingPhrase: "ニュース検索を改善する",
    basis: "recorded-next-step",
  }), summary);
  assert.match(valid, /ニュース検索/);
  assert.equal(validateGroundedContinuationMessage(JSON.stringify({
    message: "ニュース検索を改善する作業は完了したよ。次へ進む？",
    groundingPhrase: "ニュース検索を改善する",
    basis: "recorded-next-step",
  }), summary), "");
  assert.equal(validateGroundedContinuationMessage(JSON.stringify({
    message: "別件を進めようか？",
    groundingPhrase: "別件",
    basis: "recorded-next-step",
  }), summary), "");
});

test("a goal-only summary can produce only an optional grounded suggestion", () => {
  const summary = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { goal: "ニュース検索を改善する" },
    now: NOW,
  }).record;
  assert.equal(validateGroundedContinuationMessage(JSON.stringify({
    message: "ニュース検索を改善するために、まず現在の検索条件を確認してみる？",
    groundingPhrase: "ニュース検索を改善する",
    basis: "goal-suggestion",
  }), summary), "ニュース検索を改善するために、まず現在の検索条件を確認してみる?");
  assert.equal(validateGroundedContinuationMessage(JSON.stringify({
    message: "ニュース検索を改善するために、検索条件を確認するね。",
    groundingPhrase: "ニュース検索を改善する",
    basis: "goal-suggestion",
  }), summary), "");
  assert.equal(validateGroundedContinuationMessage(JSON.stringify({
    message: "ニュース検索を改善するために、検索条件を確認してみる？",
    groundingPhrase: "ニュース検索を改善する",
    basis: "recorded-next-step",
  }), summary), "");
});

test("startup has a grounded local fallback when generation is unavailable", () => {
  const goalOnly = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { goal: "名古屋の主要ニュース" },
    now: NOW,
  }).record;
  assert.equal(continuationFallbackMessage(goalOnly, "ja"), "「名古屋の主要ニュース」の続き、まず次にやることを一緒に決める？");
  const withNext = saveContinuationSummary({}, {
    characterId: "amber-avatar",
    summary: { goal: "ニュース検索を改善する", nextStep: "検索条件を確認する" },
    now: NOW,
  }).record;
  assert.match(continuationFallbackMessage(withNext, "ja"), /検索条件を確認する/);
  assert.match(continuationFallbackMessage(withNext, "en"), /shall we continue/i);
});
