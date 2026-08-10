// SPDX-License-Identifier: Apache-2.0
const assert = require("node:assert/strict");
const test = require("node:test");

const { RealtimeWorkSpeechCoordinator } = require("../lib/realtime-work-speech.cjs");

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("Realtime Work waits for its tailored acknowledgement and serializes progress and completion", async (t) => {
  const appended = [];
  const coordinator = new RealtimeWorkSpeechCoordinator({ appendSpeech: async (text) => { appended.push(text); return true; } });
  t.after(() => coordinator.stop());
  coordinator.beginAcknowledgement();
  const progress = coordinator.enqueue("天気データをページへ反映しているよ。", "progress");
  await tick();
  assert.deepEqual(appended, []);
  assert.deepEqual(coordinator.assistantTranscriptDone("名古屋の天気ページを作るんだね。始めるよ。"), {
    kind: "ack", text: "名古屋の天気ページを作るんだね。始めるよ。", injected: false,
  });
  await tick();
  assert.deepEqual(appended, ["天気データをページへ反映しているよ。"]);
  const completion = coordinator.enqueue("天気ページが完成したよ。", "completion");
  coordinator.assistantTranscriptDone("天気データをページへ反映しているよ");
  assert.equal(await progress, true);
  await tick();
  assert.deepEqual(appended, ["天気データをページへ反映しているよ。", "天気ページが完成したよ。"]);
  const completionEvent = coordinator.assistantTranscriptDone("うん、天気のページはできあがったよ。");
  assert.equal(completionEvent.kind, "completion");
  assert.equal(completionEvent.matched, false);
  assert.equal(await completion, true);
});

test("Realtime Work speech queue rejects pending updates when the session stops", async () => {
  const coordinator = new RealtimeWorkSpeechCoordinator({ appendSpeech: async () => true });
  coordinator.beginAcknowledgement();
  const pending = coordinator.enqueue("まだ送らない進捗", "progress");
  coordinator.stop();
  assert.equal(await pending, false);
});

test("Realtime Work keeps only the latest queued progress before completion", async () => {
  const appended = [];
  const coordinator = new RealtimeWorkSpeechCoordinator({ appendSpeech: async (text) => { appended.push(text); return true; } });
  coordinator.beginAcknowledgement();
  const stale = coordinator.enqueue("古い進捗", "progress");
  const latest = coordinator.enqueue("新しい進捗", "progress");
  const completion = coordinator.enqueue("完了したよ", "completion");
  assert.equal(await stale, false);
  assert.equal(await latest, false);
  coordinator.assistantTranscriptDone("依頼に合わせて始めるよ");
  await tick();
  assert.deepEqual(appended, ["完了したよ"]);
  coordinator.assistantTranscriptDone("完了したよ");
  assert.equal(await completion, true);
  coordinator.stop();
});

test("a spoken follow-up cancels active progress before waiting for its new acknowledgement", async (t) => {
  const appended = [];
  const coordinator = new RealtimeWorkSpeechCoordinator({ appendSpeech: async (text) => { appended.push(text); return true; } });
  t.after(() => coordinator.stop());
  const oldProgress = coordinator.enqueue("古い作業の進捗だよ", "progress");
  await tick();
  assert.deepEqual(appended, ["古い作業の進捗だよ"]);

  assert.equal(coordinator.beginAcknowledgement(), true);
  assert.equal(await oldProgress, true, "an already accepted Live route remains delivered even when interrupted");
  const newProgress = coordinator.enqueue("新しい依頼を確認しているよ", "progress");
  assert.deepEqual(coordinator.assistantTranscriptDone("新しい依頼を始めるね"), {
    kind: "ack", text: "新しい依頼を始めるね", injected: false,
  });
  await tick();
  assert.deepEqual(appended, ["古い作業の進捗だよ", "新しい依頼を確認しているよ"]);
  coordinator.assistantTranscriptDone("新しい依頼を確認しているよ");
  assert.equal(await newProgress, true);
});

test("accepted Live speech never falls back to TTS when its transcript is delayed", async () => {
  const clock = [];
  const coordinator = new RealtimeWorkSpeechCoordinator({
    appendSpeech: async () => true,
    transcriptTimeoutMs: 5000,
    schedule: (callback) => { clock.push(callback); return callback; },
    cancel: () => {},
  });
  const delivered = coordinator.enqueue("完了したよ", "completion");
  await tick();
  assert.equal(await delivered, true, "acceptance fixes the route to Live immediately");
  clock.shift()?.();
  coordinator.stop();
});
