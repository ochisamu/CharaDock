// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  WorkVoiceReporter,
  contextualizeWorkProgress,
  conciseWorkAnnouncement,
  isMeaningfulWorkProgress,
  workAcknowledgementFallback,
} = require("../lib/work-voice-reporter.cjs");

function fakeClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    cancel(id) { timers.delete(id); },
    advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const next = [...timers.entries()].sort((left, right) => left[1].at - right[1].at)[0];
        if (!next || next[1].at > target) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      time = target;
    },
  };
}

test("work acknowledgements are content-aware", () => {
  const nagoya = workAcknowledgementFallback("名古屋の週間天気をHTMLにしてプレビューしてください。お願いします");
  const osaka = workAcknowledgementFallback("大阪の予算表をPDFにまとめてください");
  assert.match(nagoya, /名古屋/);
  assert.match(nagoya, /天気/);
  assert.match(nagoya, /HTML/);
  assert.match(workAcknowledgementFallback("Windows版をビルドして"), /Windows版.*ビルド/);
  assert.match(workAcknowledgementFallback("このバグを修正して"), /このバグ.*修正/);
  assert.equal(
    workAcknowledgementFallback("CharaDock Voice Sequence 123 という名古屋の天気ダッシュボードを、artifacts/demo に4ファイルで作ってください。"),
    "名古屋の天気ダッシュボードを作るね。",
  );
  assert.notEqual(nagoya, osaka);
});

test("work announcements never speak links, paths, or code fences", () => {
  const text = conciseWorkAnnouncement("確認中です https://example.com `npm test` C:\\Users\\name\\secret.txt artifacts/result.html");
  assert.equal(text, "確認中です");
  const acknowledgement = workAcknowledgementFallback("artifacts/result.html を作成してください。見出しに 天気ダッシュボード、本文に予報を入れてください。");
  assert.equal(acknowledgement, "天気ダッシュボードのHTMLを作成するね。");
  assert.doesNotMatch(acknowledgement, /artifacts|result|[\\/]/i);
  assert.equal(
    contextualizeWorkProgress("ファイルを更新中…", "artifacts/result.html を作成してください。見出しに 天気ダッシュボード、本文に予報を入れてください。"),
    "天気ダッシュボードのHTMLをファイルへ反映しているよ。",
  );
});

test("progress speech keeps concrete milestones and drops context-management chatter", () => {
  assert.equal(isMeaningfulWorkProgress("HTMLとCSSのつながりを確認しているよ。"), true);
  assert.equal(isMeaningfulWorkProgress("原因が分かって、構成が固まったよ。"), true);
  assert.equal(isMeaningfulWorkProgress("前のやつは文脈として見てるだけで、今の依頼だけ進めるよ。"), false);
  assert.equal(
    contextualizeWorkProgress("ファイルを更新しているよ。", "Windows版をビルドして"),
    "Windows版のビルドをファイルへ反映しているよ。",
  );
});

test("first commentary is the acknowledgement and later progress is throttled", () => {
  const clock = fakeClock();
  const announcements = [];
  const reporter = new WorkVoiceReporter({
    onAnnouncement: (entry) => announcements.push({ ...entry, at: clock.now() }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    progressDelayMs: 6000,
    progressIntervalMs: 10_000,
  });
  reporter.scheduleFallback("フォールバック", 2400);
  clock.advance(400);
  reporter.commentary("天気ページの構成を確認してから作るね。");
  assert.deepEqual(announcements, [{ kind: "ack", text: "天気ページの構成を確認してから作るね。", at: 400 }]);
  reporter.commentary("予報データを確認しているよ。");
  clock.advance(9999);
  assert.equal(announcements.length, 1);
  reporter.commentary("HTMLへ反映しているよ。");
  clock.advance(1);
  assert.deepEqual(announcements.at(-1), { kind: "progress", text: "HTMLへ反映しているよ。", at: 10_400 });
});

test("acknowledgement and delayed progress stay specific to each work request", () => {
  const runScenario = (request, progress) => {
    const clock = fakeClock();
    const announcements = [];
    const reporter = new WorkVoiceReporter({
      onAnnouncement: (entry) => announcements.push({ ...entry, at: clock.now() }),
      now: clock.now,
      schedule: clock.schedule,
      cancel: clock.cancel,
      progressDelayMs: 3000,
      progressIntervalMs: 5000,
    });
    reporter.scheduleFallback(workAcknowledgementFallback(request), 600);
    clock.advance(600);
    reporter.commentary("依頼内容に合わせて始めるね。");
    reporter.activity(progress);
    clock.advance(4999);
    assert.equal(announcements.length, 1, "progress must remain silent until the long-work interval");
    clock.advance(1);
    return announcements;
  };

  const page = runScenario(
    "名古屋の週間天気をHTMLページにして",
    "週間予報をHTMLのカードへ反映しているよ。",
  );
  const build = runScenario(
    "Windows版をビルドして",
    "Windowsインストーラーを検証しているよ。",
  );

  assert.deepEqual(page.map(({ kind, text }) => ({ kind, text })), [
    { kind: "ack", text: "名古屋の週間天気をHTMLページにするね。" },
    { kind: "progress", text: "週間予報をHTMLのカードへ反映しているよ。" },
  ]);
  assert.deepEqual(build.map(({ kind, text }) => ({ kind, text })), [
    { kind: "ack", text: "Windows版をビルドするね。" },
    { kind: "progress", text: "Windowsインストーラーを検証しているよ。" },
  ]);
  assert.notEqual(page[0].text, build[0].text);
  assert.notEqual(page[1].text, build[1].text);
});

test("fast completion cancels a late acknowledgement instead of saying start after done", () => {
  const clock = fakeClock();
  const announcements = [];
  const reporter = new WorkVoiceReporter({
    onAnnouncement: (entry) => announcements.push(entry),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  reporter.scheduleFallback("すぐ始めるね", 2400);
  reporter.complete();
  clock.advance(20_000);
  assert.deepEqual(announcements, []);
});

test("a late first worker commentary is not replayed as progress after fallback", () => {
  const clock = fakeClock();
  const announcements = [];
  const reporter = new WorkVoiceReporter({
    request: "名古屋の天気ページを作って",
    onAnnouncement: (entry) => announcements.push({ ...entry, at: clock.now() }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    progressDelayMs: 3000,
    progressIntervalMs: 5000,
  });
  reporter.scheduleFallback(workAcknowledgementFallback("名古屋の天気ページを作って"), 600);
  clock.advance(600);
  reporter.commentary("名古屋の天気ページを作り始めるね。");
  clock.advance(10_000);
  assert.equal(announcements.length, 1);
  reporter.commentary("週間予報をカードへ反映しているよ。");
  clock.advance(5000);
  assert.deepEqual(announcements.map(({ kind, text }) => ({ kind, text })), [
    { kind: "ack", text: "名古屋の天気ページを作るね。" },
    { kind: "progress", text: "週間予報をカードへ反映しているよ。" },
  ]);
});

test("a generic early model acknowledgement is replaced with the request-specific action", () => {
  const clock = fakeClock();
  const announcements = [];
  const reporter = new WorkVoiceReporter({
    request: "名古屋の週間天気をHTMLにしてプレビューして",
    onAnnouncement: (entry) => announcements.push(entry),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  reporter.scheduleFallback("遅いフォールバック", 600);
  reporter.commentary("了解");
  clock.advance(1000);
  assert.deepEqual(announcements, [{
    kind: "ack",
    text: "名古屋の週間天気をHTMLにしてプレビューするね。",
  }]);
});

test("Realtime acknowledgement suppresses the first worker commentary but keeps later progress", () => {
  const clock = fakeClock();
  const announcements = [];
  const reporter = new WorkVoiceReporter({
    request: "READMEを英語化して",
    alreadyAcknowledged: true,
    onAnnouncement: (entry) => announcements.push({ ...entry, at: clock.now() }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    progressDelayMs: 3000,
    progressIntervalMs: 5000,
  });
  reporter.commentary("READMEの英語化に取りかかるね。");
  reporter.activity("ファイルを更新しているよ。");
  clock.advance(5000);
  assert.deepEqual(announcements.map(({ kind, text }) => ({ kind, text })), [
    { kind: "progress", text: "READMEをファイルへ反映しているよ。" },
  ]);
});
