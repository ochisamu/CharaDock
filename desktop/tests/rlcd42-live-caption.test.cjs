// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { liveCaptionWindow, buildRlcd42Scene } = require("../lib/rlcd42-presentation.cjs");
const main = fs.readFileSync(require.resolve("../main.cjs"), "utf8");

function harness(target = "rlcd42") {
  const syncs = [], expiry = [], pc = [];
  const ctx = vm.createContext({ target, liveCaptionWindow,
    rlcd42LiveCaption: "", rlcd42LastDisplayText: "", rlcd42VoiceStage: "waiting",
    atomEchoCapture: null, atomEchoRecognizingCapture: null, rlcd42SceneTimer: null,
    scheduleRlcd42CaptionExpiry: (ms) => expiry.push(ms),
    scheduleRlcd42SceneSync: (ms) => { syncs.push(ms); ctx.rlcd42SceneTimer = 1; },
    mascotWindow: null,
    controlWindow: { isDestroyed: () => false, webContents: {
      isDestroyed: () => false, send: (_channel, value) => pc.push(value),
    } },
    isEsp32VoiceTarget: (value) => ["rlcd42", "atom-echo"].includes(value),
  });
  vm.runInContext(main.slice(main.indexOf("function syncRlcd42LiveCaption("), main.indexOf("function publishSpeechCaption(")), ctx);
  vm.runInContext(main.slice(main.indexOf("  const sendMascotStream ="), main.indexOf('  let pendingNativeWorkRequest =')) + "\nglobalThis.send = sendMascotStream;", ctx);
  return { ctx, syncs, expiry, pc };
}

test("actual Live dispatch forwards captions to RLCD even without a mascot window", () => {
  const h = harness();
  const payload = { phase: "realtime-caption", text: "こんにちは。今日は晴れです。" };
  h.ctx.send(payload);
  assert.equal(h.ctx.rlcd42LiveCaption, payload.text);
  assert.equal(h.ctx.rlcd42VoiceStage, "");
  assert.deepEqual(h.syncs, [180]);
  assert.deepEqual(h.pc, [payload], "PC receives the original text exactly once");
});

test("continuous deltas do not postpone display; final flushes and expires", () => {
  const h = harness();
  for (let i = 0; i < 50; i++) h.ctx.send({ phase: "realtime-caption", text: "文".repeat(i + 1) });
  assert.deepEqual(h.syncs, [180]);
  h.ctx.send({ phase: "realtime-caption", text: "最終文。", final: true });
  assert.deepEqual(h.syncs, [180, 0]);
  assert.equal(h.expiry.at(-1), 15000);
  h.ctx.send({ phase: "start" });
  assert.equal(h.ctx.rlcd42LiveCaption, "");
  assert.equal(h.ctx.rlcd42LastDisplayText, "");
});

test("PC and ATOM Live do not overwrite the RLCD display", () => {
  for (const target of ["mascot", "control", "remote", "atom-echo"]) {
    const h = harness(target);
    h.ctx.send({ phase: "realtime-caption", text: "別端末の声。" });
    assert.equal(h.ctx.rlcd42LiveCaption, "");
    assert.equal(h.syncs.length, 0);
  }
});

test("Live shows a bounded recent window without corrupting Unicode", () => {
  assert.equal(liveCaptionWindow("最初。次。最後。"), "次。最後。");
  assert.equal(Array.from(liveCaptionWindow("😀".repeat(120))).length, 88);
  assert.equal(liveCaptionWindow("あ".repeat(200) + "末尾" ).endsWith("末尾"), true);
});

test("final Live caption remains visible without claiming audio is speaking", () => {
  for (const mode of ["chat", "work"]) {
    const scene = buildRlcd42Scene({ turn: { status: "complete", mode },
      interactionMode: mode, caption: "最後の回答。", liveCaption: true });
    assert.equal(scene.scene, "conversation");
    assert.equal(scene.caption, "最後の回答。");
    assert.notEqual(scene.state, "speaking");
  }
  assert.equal(buildRlcd42Scene({ liveCaption: true, caption: "字幕", captionMode: "off" }).caption, "");
});
